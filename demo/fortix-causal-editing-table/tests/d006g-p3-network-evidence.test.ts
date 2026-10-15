import assert from "node:assert/strict";
import test from "node:test";

import { buildReport, type AdapterRecord } from "../app/ethernetLink.ts";
import { PhysicalNetworkTransitionMachine } from "../app/networkTransitions.ts";
import {
  PHYSICAL_SENTINEL_SOURCE,
  TARGET_ADAPTER_IDENTITY,
  appendNetworkTransition,
  createOfflineEvidenceSession,
} from "../app/offlineEvidence.ts";
import { projectProofLeaves, runtimeProofLeaves } from "../app/proofProjection.ts";

/**
 * D-006G P3-B — physical network evidence.
 *
 * TWO FINDINGS, one human-observed and one architectural.
 *
 * THE REGRESSION. A physical RJ45 test reported NR-NET-LOST no longer
 * appearing. Traced end to end: the record IS authored, at journal position
 * 30_001 while the clock sits at 30_000 — because the journal requires
 * strictly increasing positions, so an observation made while the clock is
 * paused is filed one millisecond past it. P2R then made the Proof Tree filter
 * by time, so real evidence became invisible the instant it was created.
 * Append order is not mission time; records now carry the moment they were
 * OBSERVED, and the view uses that.
 *
 * THE MIGRATION. Persistent network state is two-valued: CONNECTED or LOST. A
 * physical link cannot be "restored" — that is a fact about the past, and the
 * past belongs in evidence. NR-NET-RESTORED still records it permanently.
 */

const MISSION = "fortix.demo.p3.network";
const I226: AdapterRecord = Object.freeze({
  name: "Ethernet",
  description: "Intel(R) Ethernet Controller I226-LM",
  status: "Up",
  mediaConnectionState: "Connected",
  mediaType: "802.3",
  physicalMediaType: "802.3",
  virtual: false,
  ifIndex: 26,
});

function report(link: "CONNECTED" | "LOST", second: number) {
  return buildReport([{
    ...I226,
    status: link === "CONNECTED" ? "Up" : "Disconnected",
    mediaConnectionState: link === "CONNECTED" ? "Connected" : "Disconnected",
  }], new Date(Date.UTC(2026, 7, 25, 10, 0, 0) + second * 1_000).toISOString());
}

/** Two observations, which is what the debounce requires. */
function settle(machine: PhysicalNetworkTransitionMachine, link: "CONNECTED" | "LOST", from: number) {
  machine.observe(report(link, from), { evidenceClockMs: from * 1_000 });
  return machine.observe(report(link, from + 1), { evidenceClockMs: (from + 1) * 1_000 });
}

// --- the two-state model -------------------------------------------------

test("P3-B: CONNECTED and LOST are the only persistent network states", () => {
  const machine = new PhysicalNetworkTransitionMachine({ runId: MISSION });
  assert.equal(machine.state, "UNKNOWN", "nothing observed yet");

  settle(machine, "CONNECTED", 0);
  assert.equal(machine.state, "CONNECTED");

  settle(machine, "LOST", 2);
  assert.equal(machine.state, "LOST");

  const restored = settle(machine, "CONNECTED", 4);
  // The link is connected again. There is no third value it can rest in.
  assert.equal(machine.state, "CONNECTED");
  // ...and the restoration is still recorded as the event it is.
  assert.equal(restored.event?.eventType, "NETWORK_LINK_RESTORED");
  assert.equal(restored.event?.nanoReceiptType, "NR-NET-RESTORED");
});

test("P3-B: reconciliation is separate from connectivity", () => {
  const machine = new PhysicalNetworkTransitionMachine({ runId: MISSION });
  settle(machine, "CONNECTED", 0);
  settle(machine, "LOST", 2);
  settle(machine, "CONNECTED", 4);

  // The link was already CONNECTED before any reconciliation happened, so
  // connectivity cannot be used to infer reconciliation state either way.
  assert.equal(machine.state, "CONNECTED");
  assert.equal("acknowledgeReconciliation" in machine, false,
    "reconciliation is not an operation on connectivity");
});

// --- exactly once --------------------------------------------------------

test("P3-B: one physical transition authors exactly one nano-receipt", () => {
  const machine = new PhysicalNetworkTransitionMachine({ runId: MISSION });
  settle(machine, "CONNECTED", 0);

  const events: string[] = [];
  const record = (result: ReturnType<typeof settle>) => {
    if (result.event !== null) events.push(result.event.eventType);
  };

  record(settle(machine, "LOST", 2));
  // Duplicate and repeated observations of the same state add nothing.
  record(machine.observe(report("LOST", 4), { evidenceClockMs: 4_000 }));
  record(machine.observe(report("LOST", 5), { evidenceClockMs: 5_000 }));
  record(settle(machine, "CONNECTED", 6));
  record(machine.observe(report("CONNECTED", 8), { evidenceClockMs: 8_000 }));

  assert.deepEqual(events, ["NETWORK_LINK_LOST", "NETWORK_LINK_RESTORED"]);
});

test("P3-B: two physical outages author two of each, and no phantoms", () => {
  const machine = new PhysicalNetworkTransitionMachine({ runId: MISSION });
  settle(machine, "CONNECTED", 0);
  const events: string[] = [];
  for (const [link, at] of [["LOST", 2], ["CONNECTED", 4], ["LOST", 6], ["CONNECTED", 8]] as const) {
    const result = settle(machine, link, at);
    if (result.event !== null) events.push(result.event.eventType);
  }
  assert.deepEqual(events, [
    "NETWORK_LINK_LOST", "NETWORK_LINK_RESTORED",
    "NETWORK_LINK_LOST", "NETWORK_LINK_RESTORED",
  ]);
  assert.equal(machine.state, "CONNECTED");
});

test("P3-B: a duplicate sentinel observation is ignored, not re-recorded", () => {
  const machine = new PhysicalNetworkTransitionMachine({ runId: MISSION });
  settle(machine, "CONNECTED", 0);
  machine.observe(report("LOST", 2), { evidenceClockMs: 2_000 });
  const first = machine.observe(report("LOST", 3), { evidenceClockMs: 3_000 });
  assert.equal(first.event?.eventType, "NETWORK_LINK_LOST");
  // The very same observation, replayed.
  const replay = machine.observe(report("LOST", 3), { evidenceClockMs: 3_000 });
  assert.equal(replay.event, null);
  assert.equal(replay.reason, "DUPLICATE_OBSERVATION");
});

// --- THE REGRESSION: visible the moment it happens ----------------------

test("P3-B REGRESSION: a cable pulled while the clock is paused is visible immediately", () => {
  // The exact reported case. The clock sits at 30_000 with evidence already
  // filed there, so the physical record takes journal position 30_001 — one
  // millisecond into the view's future.
  let session = createOfflineEvidenceSession(MISSION);
  session = appendNetworkTransition(session, {
    runId: MISSION,
    observationId: "paused-pull",
    adapterIdentity: TARGET_ADAPTER_IDENTITY,
    observationSource: PHYSICAL_SENTINEL_SOURCE,
    previousNetworkState: "CONNECTED",
    newNetworkState: "LOST",
    missionClockPosition: 30_001,
    observedMasterTimeMs: 30_000,
  }).session;

  const record = session.records[0];
  assert.equal(record.missionClockPosition, 30_001, "the journal slot is ahead, as it must be");

  // ...and the leaf is nonetheless visible at 30_000, because that is when it
  // was observed. Before this fix the tree showed nothing here.
  // (The projection also carries the signed bundle's own leaves, so the
  // network lane is what this asserts on.)
  const network = projectProofLeaves(session.records, 30_000)
    .filter((leaf) => leaf.branch === "network");
  assert.equal(network.length, 1, "the physical evidence must be visible the moment it exists");
  assert.ok(network[0].evidenceId.includes("NR-NET-LOST"));

  // And a view BEFORE the observation still shows nothing physical.
  assert.equal(
    projectProofLeaves(session.records, 29_000).filter((leaf) => leaf.branch === "network").length,
    0,
  );
});

test("P3-B: the observed moment is recorded in the evidence, not inferred", () => {
  let session = createOfflineEvidenceSession(MISSION);
  session = appendNetworkTransition(session, {
    runId: MISSION,
    observationId: "obs",
    adapterIdentity: TARGET_ADAPTER_IDENTITY,
    observationSource: PHYSICAL_SENTINEL_SOURCE,
    previousNetworkState: "CONNECTED",
    newNetworkState: "LOST",
    missionClockPosition: 44_001,
    observedMasterTimeMs: 44_000,
  }).session;
  const payload = session.records[0].payload as unknown as Record<string, unknown>;
  assert.equal(payload.observed_master_time_ms, 44_000);
  assert.equal(payload.observation_source, PHYSICAL_SENTINEL_SOURCE);
  assert.equal(payload.adapter_identity, TARGET_ADAPTER_IDENTITY);
});

test("P3-B: without an observed moment, the journal position is used unchanged", () => {
  // Older records carry no observed time; they must not become invisible.
  let session = createOfflineEvidenceSession(MISSION);
  session = appendNetworkTransition(session, {
    runId: MISSION,
    observationId: "legacy",
    adapterIdentity: TARGET_ADAPTER_IDENTITY,
    observationSource: PHYSICAL_SENTINEL_SOURCE,
    previousNetworkState: "CONNECTED",
    newNetworkState: "LOST",
    missionClockPosition: 12_000,
  }).session;
  assert.equal(runtimeProofLeaves(session.records)[0].timeMs, 12_000);
});

// --- physical history is not rewritten by the view ----------------------

test("P3-B: rewinding hides physical evidence from the view but never deletes it", () => {
  let session = createOfflineEvidenceSession(MISSION);
  session = appendNetworkTransition(session, {
    runId: MISSION,
    observationId: "pull",
    adapterIdentity: TARGET_ADAPTER_IDENTITY,
    observationSource: PHYSICAL_SENTINEL_SOURCE,
    previousNetworkState: "CONNECTED",
    newNetworkState: "LOST",
    missionClockPosition: 50_000,
    observedMasterTimeMs: 50_000,
  }).session;

  const networkAt = (at: number) =>
    projectProofLeaves(session.records, at).filter((leaf) => leaf.branch === "network").length;

  assert.equal(networkAt(60_000), 1);
  // Seeking before it happened hides it from the view...
  assert.equal(networkAt(10_000), 0);
  // ...and the journal is untouched, so seeking forward restores it exactly.
  assert.equal(session.records.length, 1, "the persisted physical record must survive a rewind");
  assert.equal(networkAt(60_000), 1);
});

test("P3-B: physical evidence carries the sentinel as its source", () => {
  const machine = new PhysicalNetworkTransitionMachine({ runId: MISSION });
  settle(machine, "CONNECTED", 0);
  const lost = settle(machine, "LOST", 2);
  assert.equal(lost.event?.observationSource, "LINK_SENTINEL:GET_NET_ADAPTER");
  assert.equal(lost.event?.adapterIdentity.description, TARGET_ADAPTER_IDENTITY);
});

test("P3-B: the timeline cannot manufacture a physical transition", () => {
  // Only a sentinel report moves the machine. There is no clock input at all.
  const machine = new PhysicalNetworkTransitionMachine({ runId: MISSION });
  settle(machine, "CONNECTED", 0);
  const before = machine.state;
  // Every non-sentinel shape is refused.
  for (const bogus of [null, undefined, {}, { link: "LOST" }, { sentinel: "OK", link: "LOST" }]) {
    const result = machine.observe(bogus as never, { evidenceClockMs: 99_000 });
    assert.equal(result.event, null);
    assert.equal(result.reason, "UNOBSERVED_LINK");
  }
  assert.equal(machine.state, before, "nothing but the sentinel may change the link");
});

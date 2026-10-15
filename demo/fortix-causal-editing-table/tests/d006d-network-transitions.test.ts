import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildReport, type AdapterRecord, type LinkSentinelReport } from "../app/ethernetLink.ts";
import {
  DEFAULT_DEBOUNCE_OBSERVATIONS,
  DEFAULT_SENTINEL_POLL_INTERVAL_MS,
  NETWORK_OBSERVATION_SOURCE,
  PhysicalNetworkTransitionMachine,
  theoreticalTransitionLatency,
} from "../app/networkTransitions.ts";

const MISSION_ID = "fortix.demo.d006.offline-continuity-001";
const I226: AdapterRecord = Object.freeze({
  name: "Ethernet",
  description: "Intel(R) Ethernet Controller I226-LM",
  status: "Up",
  mediaConnectionState: "Connected",
  mediaType: "802.3",
  physicalMediaType: "802.3",
  virtual: false,
  ifIndex: 24,
});

function report(link: "CONNECTED" | "LOST", second: number): LinkSentinelReport {
  return buildReport([{
    ...I226,
    status: link === "CONNECTED" ? "Up" : "Disconnected",
    mediaConnectionState: link === "CONNECTED" ? "Connected" : "Disconnected",
  }], new Date(Date.UTC(2026, 7, 23, 10, 0, 0) + second * 1_000).toISOString());
}

function establish(machine: PhysicalNetworkTransitionMachine, link: "CONNECTED" | "LOST", start = 0): void {
  machine.observe(report(link, start), { evidenceClockMs: start * 1_000 });
  machine.observe(report(link, start + 1), { evidenceClockMs: (start + 1) * 1_000 });
}

test("D-006 C1: a new machine can share the journal's CONNECTED baseline", () => {
  const machine = new PhysicalNetworkTransitionMachine({
    runId: MISSION_ID,
    initialState: "CONNECTED",
  });
  assert.equal(machine.state, "CONNECTED");
  assert.equal(machine.snapshot().transitionSequence, 0);

  const first = machine.observe(report("LOST", 0), { evidenceClockMs: 0 });
  const confirmed = machine.observe(report("LOST", 1), { evidenceClockMs: 1 });
  assert.equal(first.reason, "DEBOUNCING");
  assert.equal(confirmed.event?.previousNetworkState, "CONNECTED");
  assert.equal(confirmed.event?.newNetworkState, "LOST");
  assert.equal(confirmed.event?.nanoReceiptType, "NR-NET-LOST");
  assert.equal(machine.snapshot().transitionSequence, 1);

  assert.throws(() => new PhysicalNetworkTransitionMachine({
    runId: MISSION_ID,
    initialState: "RESTORED",
  } as never), /initialState must be CONNECTED or LOST/);
  assert.throws(() => new PhysicalNetworkTransitionMachine({
    runId: MISSION_ID,
    initialState: "CONNECTED",
    snapshot: machine.snapshot(),
  }), /mutually exclusive/);
});

test("D-006D: CONNECTED -> LOST emits exactly one physical nano-receipt", () => {
  const machine = new PhysicalNetworkTransitionMachine({ runId: MISSION_ID });
  establish(machine, "CONNECTED");
  assert.equal(machine.state, "CONNECTED");

  const first = machine.observe(report("LOST", 2), { evidenceClockMs: 2_000 });
  const confirmed = machine.observe(report("LOST", 3), {
    evidenceClockMs: 3_000,
    causalPredecessors: ["NR-CUSTOMER-ACCEPTED"],
  });

  assert.equal(first.reason, "DEBOUNCING");
  assert.equal(confirmed.state, "LOST");
  assert.equal(confirmed.event?.eventType, "NETWORK_LINK_LOST");
  assert.equal(confirmed.event?.nanoReceiptType, "NR-NET-LOST");
  assert.equal(confirmed.event?.previousNetworkState, "CONNECTED");
  assert.equal(confirmed.event?.newNetworkState, "LOST");
  assert.equal(confirmed.event?.runId, MISSION_ID);
  assert.equal(confirmed.event?.adapterIdentity.description, I226.description);
  assert.equal(confirmed.event?.adapterIdentity.ifIndex, 24);
  assert.equal(confirmed.event?.observationSource, NETWORK_OBSERVATION_SOURCE);
  assert.deepEqual(confirmed.event?.causalPredecessors, ["NR-CUSTOMER-ACCEPTED"]);
  assert.deepEqual(confirmed.event?.missionClockPosition, { milliseconds: 3_000, causalOrder: 1 });
});

/**
 * DOCTRINE CHANGE, D-006G P3-B. Persistent network state is now two-valued:
 * CONNECTED or LOST. RESTORED was removed as a STATE because a physical link
 * cannot be in it — "restored" is a fact about the past, and the past belongs
 * in evidence. The restoration EVENT is unchanged and still authors
 * NR-NET-RESTORED, so the historical fact survives permanently.
 *
 * This test previously asserted the machine REMAINED in RESTORED until
 * reconciliation acknowledged it, which tied connectivity to evidence state.
 * It now asserts the event is emitted and the link settles back to CONNECTED.
 */
test("D-006D: LOST -> CONNECTED emits a restoration event and settles connected", () => {
  const machine = new PhysicalNetworkTransitionMachine({ runId: MISSION_ID });
  establish(machine, "CONNECTED");
  machine.observe(report("LOST", 2), { evidenceClockMs: 2_000 });
  machine.observe(report("LOST", 3), { evidenceClockMs: 3_000 });

  machine.observe(report("CONNECTED", 4), { evidenceClockMs: 4_000 });
  const restored = machine.observe(report("CONNECTED", 5), {
    evidenceClockMs: 5_000,
    causalPredecessors: ["FINAL-RECEIPT", "LOCAL-VERDICT"],
  });
  assert.equal(restored.state, "CONNECTED", "the link is connected again, not in a third state");
  assert.equal(restored.event?.eventType, "NETWORK_LINK_RESTORED");
  assert.equal(restored.event?.nanoReceiptType, "NR-NET-RESTORED");
  assert.equal(restored.event?.previousNetworkState, "LOST");
  assert.equal(restored.event?.newNetworkState, "CONNECTED");
  assert.equal(restored.event?.missionClockPosition.causalOrder, 2);

  const stillConnected = machine.observe(report("CONNECTED", 6), { evidenceClockMs: 6_000 });
  assert.equal(stillConnected.state, "CONNECTED");
  assert.equal(stillConnected.changed, false, "a stable connected link emits nothing further");

  assert.equal("acknowledgeReconciliation" in machine, false);
  // P3-B: acknowledgement no longer moves the link — it settled at CONNECTED
  // the moment the cable came back. A rejected acknowledgement therefore
  // leaves connectivity exactly as the wire reports it.
  assert.equal(machine.state, "CONNECTED");

  assert.equal(machine.state, "CONNECTED");
});

test("D-006D: a flap before reconciliation records the underlying CONNECTED -> LOST link", () => {
  const machine = new PhysicalNetworkTransitionMachine({ runId: MISSION_ID });
  establish(machine, "LOST");
  machine.observe(report("CONNECTED", 2), { evidenceClockMs: 2_000 });
  machine.observe(report("CONNECTED", 3), { evidenceClockMs: 3_000 });
  // P3-B: the link is simply connected again.
  assert.equal(machine.state, "CONNECTED");

  machine.observe(report("LOST", 4), { evidenceClockMs: 4_000 });
  const relost = machine.observe(report("LOST", 5), { evidenceClockMs: 5_000 });
  assert.equal(relost.state, "LOST");
  assert.equal(relost.event?.eventType, "NETWORK_LINK_LOST");
  assert.equal(relost.event?.previousNetworkState, "CONNECTED");
  assert.equal(relost.event?.newNetworkState, "LOST");
  assert.equal(relost.event?.missionClockPosition.causalOrder, 2);
});

test("D-006D: duplicate polling and a transient flap produce no duplicate evidence", () => {
  const machine = new PhysicalNetworkTransitionMachine({ runId: MISSION_ID });
  establish(machine, "CONNECTED");

  const transient = report("LOST", 2);
  assert.equal(machine.observe(transient, { evidenceClockMs: 2_000 }).reason, "DEBOUNCING");
  assert.equal(machine.observe(transient, { evidenceClockMs: 2_000 }).reason, "DUPLICATE_OBSERVATION");
  assert.equal(machine.observe(report("CONNECTED", 3), { evidenceClockMs: 3_000 }).state, "CONNECTED");
  assert.equal(machine.observe(report("LOST", 4), { evidenceClockMs: 4_000 }).event, null);
  const loss = machine.observe(report("LOST", 5), { evidenceClockMs: 5_000 });
  assert.equal(loss.event?.nanoReceiptType, "NR-NET-LOST");

  for (const second of [6, 7, 8]) {
    const stable = machine.observe(report("LOST", second), { evidenceClockMs: second * 1_000 });
    assert.equal(stable.event, null);
    assert.equal(stable.changed, false);
  }
  const stale = machine.observe(report("CONNECTED", 3), { evidenceClockMs: 8_000 });
  assert.equal(stale.reason, "STALE_OBSERVATION");
  assert.equal(machine.state, "LOST");
});

test("D-006D hotfix: 100 stable CONNECTED polls accept one clock and emit nothing", () => {
  const machine = new PhysicalNetworkTransitionMachine({ runId: MISSION_ID });
  establish(machine, "CONNECTED");
  const initialSnapshot = machine.snapshot();

  for (let index = 2; index < 102; index += 1) {
    const stable = machine.observe(report("CONNECTED", index), { evidenceClockMs: 0 });
    assert.equal(stable.state, "CONNECTED");
    assert.equal(stable.changed, false);
    assert.equal(stable.event, null);
  }

  const finalSnapshot = machine.snapshot();
  assert.equal(finalSnapshot.causalOrder, initialSnapshot.causalOrder);
  assert.equal(finalSnapshot.transitionSequence, initialSnapshot.transitionSequence);
  assert.equal(finalSnapshot.lastMissionClockMs, initialSnapshot.lastMissionClockMs,
    "stable polls must not advance the evidence clock");
});

test("D-006D hotfix: cinematic rewind during a stable link cannot touch evidence ordering", () => {
  const machine = new PhysicalNetworkTransitionMachine({ runId: MISSION_ID });
  establish(machine, "CONNECTED");

  assert.doesNotThrow(() => machine.observe(report("CONNECTED", 2), { evidenceClockMs: 120_000 }));
  assert.doesNotThrow(() => machine.observe(report("CONNECTED", 3), { evidenceClockMs: 0 }));
  assert.equal(machine.snapshot().lastMissionClockMs, 0);
  assert.equal(machine.snapshot().causalOrder, 0);
});

test("D-006D hotfix: a new Mission ID starts an independent lower evidence clock", () => {
  const previous = new PhysicalNetworkTransitionMachine({ runId: MISSION_ID });
  establish(previous, "CONNECTED");
  previous.observe(report("LOST", 2), { evidenceClockMs: 120_000 });
  previous.observe(report("LOST", 3), { evidenceClockMs: 120_001 });

  const next = new PhysicalNetworkTransitionMachine({ runId: `${MISSION_ID}.next` });
  establish(next, "CONNECTED");
  next.observe(report("LOST", 2), { evidenceClockMs: 10 });
  const loss = next.observe(report("LOST", 3), { evidenceClockMs: 11 });
  assert.equal(loss.event?.runId, `${MISSION_ID}.next`);
  assert.equal(loss.event?.missionClockPosition.milliseconds, 11);
  assert.equal(loss.event?.missionClockPosition.causalOrder, 1);
});

test("D-006D hotfix: 100 stable LOST polls emit no duplicate receipt", () => {
  const machine = new PhysicalNetworkTransitionMachine({ runId: MISSION_ID });
  establish(machine, "CONNECTED");
  machine.observe(report("LOST", 2), { evidenceClockMs: 2_000 });
  const loss = machine.observe(report("LOST", 3), { evidenceClockMs: 3_000 });
  assert.equal(loss.event?.nanoReceiptType, "NR-NET-LOST");

  for (let index = 4; index < 104; index += 1) {
    const stable = machine.observe(report("LOST", index), { evidenceClockMs: 0 });
    assert.equal(stable.event, null);
    assert.equal(stable.changed, false);
  }
  assert.equal(machine.snapshot().causalOrder, 1);
  assert.equal(machine.snapshot().transitionSequence, 1);
});

test("D-006D hotfix: a real transition still rejects a regressing evidence clock", () => {
  const machine = new PhysicalNetworkTransitionMachine({ runId: MISSION_ID });
  establish(machine, "CONNECTED");
  machine.observe(report("LOST", 2), { evidenceClockMs: 2_000 });
  machine.observe(report("LOST", 3), { evidenceClockMs: 3_000 });

  // Stable LOST with a rewound UI clock is harmless.
  assert.doesNotThrow(() => machine.observe(report("LOST", 4), { evidenceClockMs: 0 }));
  // A confirmed restoration is an evidence boundary and remains fail-closed.
  machine.observe(report("CONNECTED", 5), { evidenceClockMs: 2_999 });
  assert.throws(
    () => machine.observe(report("CONNECTED", 6), { evidenceClockMs: 2_999 }),
    /evidenceClockMs must be monotonic/,
  );
  assert.equal(machine.state, "LOST");
  assert.equal(machine.snapshot().causalOrder, 1);
});

test("D-006D: UNKNOWN sentinel observations never drive physical state", () => {
  const machine = new PhysicalNetworkTransitionMachine({ runId: MISSION_ID });
  establish(machine, "CONNECTED");
  const unknown: LinkSentinelReport = {
    sentinel: "QUERY_FAILED",
    adapter: null,
    link: "UNKNOWN",
    observedAt: "2026-08-23T10:00:02.000Z",
    externalReachability: "NOT_MEASURED",
  };
  assert.equal(machine.observe(unknown, { evidenceClockMs: 2_000 }).reason, "UNOBSERVED_LINK");
  assert.equal(machine.state, "CONNECTED");
});

test("D-006D: reload restores debounce and exactly-once transition history", () => {
  const original = new PhysicalNetworkTransitionMachine({ runId: MISSION_ID });
  establish(original, "CONNECTED");
  original.observe(report("LOST", 2), { evidenceClockMs: 2_000 });

  // Reload while a physical loss is being debounced: the second distinct poll
  // confirms the same transition, not a fresh one.
  const reloadedDuringDebounce = new PhysicalNetworkTransitionMachine({
    runId: MISSION_ID,
    snapshot: JSON.parse(JSON.stringify(original.snapshot())),
  });
  const loss = reloadedDuringDebounce.observe(report("LOST", 3), { evidenceClockMs: 3_000 });
  assert.equal(loss.event?.nanoReceiptType, "NR-NET-LOST");

  const persisted = reloadedDuringDebounce.snapshot();
  const reloadedLost = new PhysicalNetworkTransitionMachine({
    runId: MISSION_ID,
    snapshot: JSON.parse(JSON.stringify(persisted)),
  });
  assert.equal(reloadedLost.observe(report("LOST", 3), { evidenceClockMs: 3_000 }).reason, "DUPLICATE_OBSERVATION");
  assert.equal(reloadedLost.observe(report("LOST", 4), { evidenceClockMs: 4_000 }).event, null);
  reloadedLost.observe(report("CONNECTED", 5), { evidenceClockMs: 5_000 });
  const restored = reloadedLost.observe(report("CONNECTED", 6), { evidenceClockMs: 6_000 });
  assert.equal(restored.event?.nanoReceiptType, "NR-NET-RESTORED");
  assert.equal(restored.event?.missionClockPosition.causalOrder, 2);

  const reloadedRestored = new PhysicalNetworkTransitionMachine({
    runId: MISSION_ID,
    snapshot: JSON.parse(JSON.stringify(reloadedLost.snapshot())),
  });
  // P3-B: a reloaded machine reports the link, and the link is connected.
  // Whether evidence still awaits reconciliation is read from the journal,
  // not inferred from a third connectivity value.
  assert.equal(reloadedRestored.state, "CONNECTED");
  assert.equal(reloadedRestored.observe(report("CONNECTED", 7), { evidenceClockMs: 7_000 }).state, "CONNECTED");
});

test("D-006 C1: persistence rejects v1, cross-run and retired RESTORED snapshots", () => {
  const machine = new PhysicalNetworkTransitionMachine({ runId: MISSION_ID });
  establish(machine, "CONNECTED");
  const snapshot = machine.snapshot();

  assert.throws(() => new PhysicalNetworkTransitionMachine({
    runId: MISSION_ID,
    snapshot: { ...snapshot, version: 1 } as never,
  }), /snapshot identity mismatch/);
  assert.throws(() => new PhysicalNetworkTransitionMachine({
    runId: `${MISSION_ID}.other`,
    snapshot,
  }), /snapshot identity mismatch/);
  assert.throws(() => new PhysicalNetworkTransitionMachine({
    runId: MISSION_ID,
    snapshot: { ...snapshot, state: "RESTORED" } as never,
  }), /invalid network transition snapshot/);

  const unobserved = new PhysicalNetworkTransitionMachine({ runId: `${MISSION_ID}.unobserved` });
  assert.equal(unobserved.state, "UNKNOWN");
  assert.throws(
    () => unobserved.snapshot(),
    /UNKNOWN is an observation state and cannot be persisted/,
    "the persistence boundary itself must be exactly CONNECTED or LOST",
  );
});

test("D-006D: state changes cannot be triggered by timeline or rerender inputs", () => {
  const source = readFileSync(new URL("../app/networkTransitions.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /deriveMasterStoryState|VISUAL_EVENTS|requestAnimationFrame|React|navigator\.onLine/);
  assert.match(source, /observe\(\s*report: LinkSentinelReport/);
  assert.match(source, /isLinkSentinelReport\(report\)/);
});

test("D-006D: production poll plus debounce has a documented 0.5-1 second envelope", () => {
  const latency = theoreticalTransitionLatency();
  assert.equal(DEFAULT_SENTINEL_POLL_INTERVAL_MS, 500);
  assert.equal(DEFAULT_DEBOUNCE_OBSERVATIONS, 2);
  assert.deepEqual(latency, {
    sentinelPollIntervalMs: 500,
    uiPollIntervalMs: 500,
    debounceObservations: 2,
    earliestSentinelToUiMs: 500,
    worstCaseSentinelToUiMs: 1_000,
    worstCasePhysicalToUiPollingMs: 1_500,
  });

  const sentinel = readFileSync(new URL("../scripts/link-sentinel.mjs", import.meta.url), "utf8");
  assert.match(sentinel, /const DEFAULT_POLL_MS = 500;/);
  assert.match(sentinel, /FORTIX_LINK_SENTINEL_POLL_MS/);
  assert.doesNotMatch(sentinel, /setInterval\(/, "serialized physical polls must not overlap");
});

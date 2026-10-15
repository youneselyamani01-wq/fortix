import assert from "node:assert/strict";
import test from "node:test";
import { buildReport, SENTINEL_UNREACHABLE, type AdapterRecord } from "../app/ethernetLink.ts";
import { createPhysicalLinkBaseline, observePhysicalLinkBaseline, admitPhysicalObservation } from "../app/physicalLinkRuntime.ts";
import { createOfflineEvidenceSession } from "../app/offlineEvidence.ts";
import { PhysicalNetworkTransitionMachine } from "../app/networkTransitions.ts";

const start = Date.parse("2026-09-29T10:00:00.000Z");
const adapter: AdapterRecord = { name: "Ethernet", description: "Intel(R) Ethernet Controller I226-LM", status: "Up", mediaConnectionState: "Connected", mediaType: "802.3", physicalMediaType: "802.3", virtual: false, ifIndex: 23 };
const report = (link: "CONNECTED" | "LOST", offset: number, extra: Partial<AdapterRecord> = {}) => buildReport([{ ...adapter, status: link === "CONNECTED" ? "Up" : "Disconnected", mediaConnectionState: link === "CONNECTED" ? "Connected" : "Disconnected", ...extra }], new Date(start + offset).toISOString());

test("initial LOST remains a physical observation, blocks readiness, and authors no journal transition", () => {
  let baseline = createPhysicalLinkBaseline("cold-run", start);
  const session = createOfflineEvidenceSession("cold-run", null, "cold-mission");
  const before = JSON.stringify(session);
  for (const offset of [0, 500, 1_000]) {
    const outcome = observePhysicalLinkBaseline(baseline, report("LOST", offset), start + offset);
    baseline = outcome.baseline;
    assert.equal(outcome.physicalLink, "LOST"); assert.equal(outcome.ready, false); assert.equal(outcome.established, false);
    assert.equal(outcome.reason, "WAITING_CONNECTED");
  }
  assert.equal(JSON.stringify(session), before); assert.equal(session.records.length, 0);
});

test("first connection needs distinct fresh samples and establishes a baseline without RESTORED", () => {
  let baseline = createPhysicalLinkBaseline("cold-run", start);
  baseline = observePhysicalLinkBaseline(baseline, report("LOST", 0), start).baseline;
  const first = observePhysicalLinkBaseline(baseline, report("CONNECTED", 500), start + 500);
  assert.equal(first.ready, false); assert.equal(first.baseline.connectedObservations, 1);
  const duplicate = observePhysicalLinkBaseline(first.baseline, report("CONNECTED", 500), start + 700);
  assert.equal(duplicate.ready, false); assert.equal(duplicate.baseline.connectedObservations, 1);
  const confirmed = observePhysicalLinkBaseline(duplicate.baseline, report("CONNECTED", 1_000), start + 1_000);
  assert.equal(confirmed.ready, true); assert.equal(confirmed.established, true); assert.equal(confirmed.reason, "ESTABLISHED");
  const machine = new PhysicalNetworkTransitionMachine({ runId: "cold-run", initialState: "CONNECTED" });
  const session = createOfflineEvidenceSession("cold-run", null, "cold-mission");
  assert.equal(session.records.length, 0);
  // Seed the machine's observation clock with the establishing CONNECTED
  // sample. This creates no receipt and prevents an older LOST from entering.
  const established = admitPhysicalObservation({ session, machine, report: report("CONNECTED", 1_000), nowEpochMs: start + 1_000, masterTimeMs: 0 });
  assert.equal(established.kind, "STABLE");
  assert.equal(session.records.length, 0);
  const staleLoss = admitPhysicalObservation({ session, machine, report: report("LOST", 750), nowEpochMs: start + 1_000, masterTimeMs: 0 });
  assert.equal(staleLoss.kind, "STABLE");
  assert.equal(session.records.length, 0);
  assert.equal(machine.snapshot().candidate, null);
  const lostCandidate = admitPhysicalObservation({ session, machine, report: report("LOST", 1_500), nowEpochMs: start + 1_500, masterTimeMs: 0 });
  assert.equal(lostCandidate.kind, "STABLE");
  const lost = admitPhysicalObservation({ session, machine, report: report("LOST", 2_000), nowEpochMs: start + 2_000, masterTimeMs: 0 });
  assert.equal(lost.kind, "TRANSITION");
  if (lost.kind === "TRANSITION") { assert.equal(lost.transition, "LOST"); assert.equal(lost.session.records.length, 1); }
});

test("samples predating reset, stale, future or unreachable never establish readiness", () => {
  const baseline = createPhysicalLinkBaseline("reset-run", start + 500);
  assert.equal(observePhysicalLinkBaseline(baseline, report("CONNECTED", 0), start + 600).reason, "BEFORE_RUN");
  for (const [sample, now] of [[report("CONNECTED", 500), start + 6_000], [report("CONNECTED", 1_000), start + 500], [SENTINEL_UNREACHABLE, start + 1_000]] as const) {
    const result = observePhysicalLinkBaseline(baseline, sample, now);
    assert.equal(result.ready, false); assert.equal(result.physicalLink, "UNKNOWN"); assert.equal(result.observationCurrent, false);
  }
});

test("connected debounce cannot combine different adapter identities or out-of-order samples", () => {
  const initial = createPhysicalLinkBaseline("identity-run", start);
  const first = observePhysicalLinkBaseline(initial, report("CONNECTED", 500), start + 500);
  const switched = observePhysicalLinkBaseline(first.baseline, report("CONNECTED", 1_000, { ifIndex: 24 }), start + 1_000);
  assert.equal(switched.ready, false); assert.equal(switched.baseline.connectedObservations, 1);
  const stale = observePhysicalLinkBaseline(switched.baseline, report("CONNECTED", 750), start + 1_000);
  assert.equal(stale.ready, false); assert.equal(stale.reason, "STALE_OBSERVATION");
  assert.equal(stale.baseline.lastObservationEpochMs, start + 1_000);
});

test("a new run never reuses the previous baseline or mutates its input", () => {
  const first = createPhysicalLinkBaseline("old-run", start);
  const before = JSON.stringify(first);
  const candidate = observePhysicalLinkBaseline(first, report("CONNECTED", 0), start);
  const ready = observePhysicalLinkBaseline(candidate.baseline, report("CONNECTED", 500), start + 500);
  assert.equal(ready.ready, true); assert.equal(JSON.stringify(first), before); assert.equal(Object.isFrozen(ready.baseline), true);
  const reset = createPhysicalLinkBaseline("new-run", start + 1_000);
  assert.equal(reset.ready, false); assert.equal(reset.connectedObservations, 0);
  assert.equal(observePhysicalLinkBaseline(reset, report("LOST", 1_000), start + 1_000).ready, false);
});

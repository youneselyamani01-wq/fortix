import assert from "node:assert/strict";
import test from "node:test";

import {
  D005_EVENTS,
  D005_MODEL,
  OPERATIONAL_CYCLE_DURATION_MS,
  activeMissionAt,
  createTamperedOperationalBundle,
  deriveOperationalCycleState,
  paymentPathFor,
  resolveMaintenanceAuthorityAtSignedTime,
  timelineEventsInWindow,
  timelineWindowAt,
  verifyOperationalCycle,
} from "../app/operationalCycle.ts";

test("complete-cycle replay is deterministic at every authored boundary", () => {
  for (const event of D005_EVENTS) {
    const first = deriveOperationalCycleState(event.time_ms);
    deriveOperationalCycleState(0);
    const replayed = deriveOperationalCycleState(event.time_ms);
    assert.deepEqual(replayed, first);
    assert.equal(first.activeEvent?.id, event.id);
  }
  assert.equal(deriveOperationalCycleState(OPERATIONAL_CYCLE_DURATION_MS).cycleReceiptAvailable, true);
});

test("one master time drives all three operational domains", () => {
  const state = deriveOperationalCycleState(54_000);
  assert.equal(state.masterTime, 54_000);
  assert.equal(state.activeEvent?.id, "route-b-executed");
  assert.equal(state.reality.location, "Route to garage");
  assert.equal(state.system.participant, "Navigation Provider B");
  assert.equal(state.proof.nanoReceiptCount, D005_EVENTS.filter((event) => event.time_ms <= 54_000).length);
});

test("overview, mission, and forensic windows are pure views over the same time", () => {
  const masterTime = 52_000;
  const overview = timelineWindowAt(masterTime, "OVERVIEW");
  const mission = timelineWindowAt(masterTime, "MISSION");
  const forensic = timelineWindowAt(masterTime, "FORENSIC");
  assert.equal(activeMissionAt(masterTime).id, "traffic");
  assert.deepEqual([overview.startMs, overview.endMs], [0, 120_000]);
  assert.deepEqual([mission.startMs, mission.endMs], [38_000, 64_000]);
  assert.ok(forensic.startMs <= masterTime && forensic.endMs >= masterTime);
  assert.ok(timelineEventsInWindow(forensic).some((event) => event.id === "reroute-authorized"));
  assert.equal(deriveOperationalCycleState(masterTime).masterTime, masterTime);
});

test("mission ordering never manufactures undeclared causality", () => {
  const passengerReceipt = D005_MODEL.missions.find((mission) => mission.id === "passenger")?.receipt_evidence_id;
  const maintenanceIntent = D005_EVENTS.find((event) => event.id === "maintenance-intent");
  assert.ok(passengerReceipt);
  assert.deepEqual(maintenanceIntent?.causal_parent_ids, ["dropoff-confirmed"]);
  assert.equal(maintenanceIntent?.causal_parent_ids.includes(passengerReceipt!), false);
  assert.deepEqual(D005_EVENTS.find((event) => event.id === "eta-deteriorates")?.causal_parent_ids, ["garage-route-a", "congestion-significant"]);
});

test("reroute evidence binds traffic and ETA to authority across providers", () => {
  const reroute = D005_EVENTS.find((event) => event.id === "reroute-authorized");
  const routeA = D005_EVENTS.find((event) => event.id === "garage-route-a");
  const routeB = D005_EVENTS.find((event) => event.id === "route-b-executed");
  assert.deepEqual(reroute?.causal_parent_ids, ["congestion-significant", "eta-deteriorates"]);
  assert.equal(reroute?.authority_context, "navigation");
  assert.equal(routeA?.system, "Navigation Provider A");
  assert.equal(routeB?.system, "Navigation Provider B");
  assert.deepEqual(routeB?.causal_parent_ids, ["reroute-authorized"]);
});

test("payment capability cannot manufacture financial authority", () => {
  const normal = paymentPathFor("NORMAL");
  const approved = paymentPathFor("HIGH_APPROVED");
  const denied = paymentPathFor("HIGH_DENIED");
  assert.equal(normal.amountEur, 420);
  assert.equal(normal.autonomousAuthority, true);
  assert.equal(normal.paymentExecuted, true);
  assert.equal(approved.capabilityAvailable, true);
  assert.equal(approved.autonomousAuthority, false);
  assert.equal(approved.humanApproval, "APPROVED");
  assert.equal(approved.paymentExecuted, true);
  assert.equal(denied.capabilityAvailable, true);
  assert.equal(denied.humanApproval, "DENIED");
  assert.equal(denied.paymentExecuted, false);
});

test("later revocation does not rewrite maintenance authority at signed time", () => {
  assert.deepEqual(resolveMaintenanceAuthorityAtSignedTime(78_000), {
    status: "ACTIVE",
    reasonCode: "D005_AUTHORITY_ACTIVE_AT_SIGNED_TIME",
  });
  assert.deepEqual(resolveMaintenanceAuthorityAtSignedTime(140_000), {
    status: "REVOKED",
    reasonCode: "D005_AUTHORITY_REVOKED_AT_SIGNED_TIME",
  });
});

test("independent cycle verification is deterministic and honest", async () => {
  const first = await verifyOperationalCycle("NORMAL");
  const second = await verifyOperationalCycle("NORMAL");
  assert.deepEqual(second, first);
  assert.equal(first.verdict, "INDETERMINATE");
  assert.deepEqual(first.reasonCodes, ["D005_PRODUCTION_TRUST_TIME_INCOMPLETE"]);
  assert.equal(first.receiptId, D005_MODEL.operational_cycle_receipt_id);
});

test("missing completion evidence is indeterminate and tampering is invalid", async () => {
  const missing = await verifyOperationalCycle("MISSING_GARAGE_EVIDENCE");
  assert.equal(missing.verdict, "INDETERMINATE");
  assert.deepEqual(missing.reasonCodes, ["D005_GARAGE_COMPLETION_EVIDENCE_MISSING"]);

  const tampered = await verifyOperationalCycle("NORMAL", createTamperedOperationalBundle());
  assert.equal(tampered.verdict, "INVALID");
  assert.deepEqual(tampered.reasonCodes, ["BUNDLE_DIGEST_MISMATCH"]);
});

test("presentation language is absent from derived evidence state", () => {
  const before = JSON.stringify(deriveOperationalCycleState(90_000));
  const evidenceIds = D005_EVENTS.map((event) => event.evidence_id);
  const after = JSON.stringify(deriveOperationalCycleState(90_000));
  assert.equal(after, before);
  assert.equal(new Set(evidenceIds).size, evidenceIds.length);
});


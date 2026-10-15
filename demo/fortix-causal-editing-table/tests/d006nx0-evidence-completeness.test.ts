import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";

import {
  CAUSAL_EVENT_REGISTER,
  causalEvent,
  causalRegisterViolations,
} from "../app/eventSources.ts";
import {
  HUMAN_APPROVER_DOMAIN,
  HUMAN_AUTHORITY_DECISION_EVENT_TYPE,
  HUMAN_DENIAL_EVENT_ID,
  HUMAN_DENIAL_RECEIPT_ID,
  appendHumanAuthorityDenial,
  humanApprovalRequestEvidenceId,
  humanDenialPayload,
} from "../app/humanAuthorityEvidence.ts";
import { MISSION_ID } from "../app/missionContinuity.ts";
import {
  MISSION_EVIDENCE_SPECS,
  projectMissionEvidence,
  specTime,
  vehicleActuationSpecs,
} from "../app/missionEvidence.ts";
import {
  PHYSICAL_SENTINEL_SOURCE,
  TARGET_ADAPTER_IDENTITY,
  appendMissionEvidence,
  appendNetworkTransition,
  createOfflineEvidenceSession,
  type OfflineEvidenceSession,
} from "../app/offlineEvidence.ts";
import {
  PortableMissionEvidenceError,
  buildMissionEvidenceClosure,
  issueFinalMissionReceipt,
  type MissionEvidenceClosure,
} from "../app/portableMissionEvidence.ts";
import { projectPortableProofLeaves } from "../app/proofProjection.ts";
import {
  PUBLIC_FACT_DEFINITIONS,
  deriveMissionFacts,
  publicFactDefinition,
  type PublicFact,
} from "../app/publicFacts.ts";
import { projectReceiptBindings } from "../app/receiptProjection.ts";
import { HUMAN_AUTHORITY_GATE_MS } from "../app/reviewFlow.ts";
import {
  MANDATED_ACTION_IDS,
  SIGNIFICANT_ACTION_REGISTER,
  evidenceCompletenessViolations,
  renderSignificantActionMatrixMarkdown,
  serializeSignificantActionMatrix,
  significantAction,
  summarizeSignificantActions,
} from "../app/significantActions.ts";
import { FINAL_RECEIPT_EMITTED_MS, storyBeatTime } from "../app/storyTimeline.ts";
import {
  NEVER_ACTING_VEHICLE_WORLD,
  SIMULATED_VEHICLE_WORLD,
  observeVehicleActuation,
  type VehicleWorld,
} from "../app/vehicleActuation.ts";
import { VISUAL_EVENTS, visualEventTime } from "../app/visualEvents.ts";

/**
 * D-006 NX0 — evidence completeness gate.
 *
 * EVERY SIGNIFICANT OBSERVABLE ACTION HAS AN EXPLICIT EVIDENCE DECISION, and a
 * brake receipt exists because the simulated vehicle braked — not because a
 * light was red, a decision was recorded, or the clock reached a number.
 */

const RUN_ID = "fortix.demo.d006nx0.run.evidence-completeness";

function fullSession(world: VehicleWorld = SIMULATED_VEHICLE_WORLD): OfflineEvidenceSession {
  return projectMissionEvidence(
    createOfflineEvidenceSession(RUN_ID, null, MISSION_ID),
    FINAL_RECEIPT_EMITTED_MS,
    undefined,
    world,
  );
}

function closureOf(session: OfflineEvidenceSession): MissionEvidenceClosure {
  return buildMissionEvidenceClosure({
    identity: { missionId: session.missionId, runId: session.runId },
    runtimeRecords: session.records,
    asOfMasterTimeMs: FINAL_RECEIPT_EMITTED_MS,
  });
}

function factsAt(session: OfflineEvidenceSession, timeMs: number, decision: "PENDING" | "APPROVED" | "DENIED" = "APPROVED"): readonly PublicFact[] {
  const closure = closureOf(session);
  let finalReceipt = null;
  try { finalReceipt = issueFinalMissionReceipt(closure, FINAL_RECEIPT_EMITTED_MS); } catch { finalReceipt = null; }
  return deriveMissionFacts({
    effectiveStoryTimeMs: timeMs,
    closure,
    receiptBindings: projectReceiptBindings(closure, VISUAL_EVENTS),
    session,
    finalReceipt,
    humanDecision: decision,
  });
}

const fact = (facts: readonly PublicFact[], id: string): PublicFact => {
  const found = facts.find((entry) => entry.factId === id);
  assert.ok(found !== undefined, `fact missing: ${id}`);
  return found;
};

const testFileExists = (name: string) => existsSync(new URL(`./${name}`, import.meta.url));

// ---------------------------------------------------------------------------
// §82 — every significant observable action has an evidence decision
// ---------------------------------------------------------------------------

test("NX0: every significant observable action carries an explicit evidence decision", () => {
  const session = fullSession();
  const violations = evidenceCompletenessViolations({
    closure: closureOf(session),
    runtimeRecords: session.records,
    testFileExists,
  });
  assert.deepEqual([...violations], []);
  for (const action of SIGNIFICANT_ACTION_REGISTER) {
    assert.ok(action.evidenceDecision === "RECEIPT" || action.evidenceDecision === "JUSTIFIED_NO_RECEIPT", action.id);
    assert.equal(action.significant, true);
  }
});

test("NX0: no UNKNOWN and no UNDECIDED decision exists, in code or in the artifact", () => {
  const summary = summarizeSignificantActions();
  assert.equal(summary.unknown, 0);
  assert.equal(summary.undecided, 0);
  assert.equal(summary.receipt + summary.justifiedNoReceipt, summary.total);
  assert.equal(summary.total, SIGNIFICANT_ACTION_REGISTER.length);
  const json = serializeSignificantActionMatrix();
  assert.equal(json, serializeSignificantActionMatrix(), "the matrix serializes deterministically");
  assert.doesNotMatch(json, /"evidenceDecision": "(UNKNOWN|UNDECIDED)"/);
  const markdown = renderSignificantActionMatrixMarkdown();
  assert.equal((markdown.match(/\| (RECEIPT|JUSTIFIED_NO_RECEIPT) \|/g) ?? []).length, summary.total);
  assert.doesNotMatch(markdown, /UNKNOWN \|/);
  for (const id of MANDATED_ACTION_IDS) assert.ok(significantAction(id), id);
  assert.deepEqual([...causalRegisterViolations()], []);
});

test("NX0: the causal register and the matrix cover each other completely", () => {
  const rows = new Set(SIGNIFICANT_ACTION_REGISTER.map((action) => action.registerEventId).filter((id) => id !== null));
  for (const entry of CAUSAL_EVENT_REGISTER) assert.ok(rows.has(entry.id), `register row ${entry.id} has no matrix action`);
  const claimedFacts = new Set(SIGNIFICANT_ACTION_REGISTER.map((action) => action.publicFactId).filter((id) => id !== null));
  for (const definition of PUBLIC_FACT_DEFINITIONS) assert.ok(claimedFacts.has(definition.factId), definition.factId);
});

// ---------------------------------------------------------------------------
// §82 — the brake action: canonical event, causation, non-causes
// ---------------------------------------------------------------------------

test("NX0: the brake action has its own canonical event, register row and public fact", () => {
  const spec = MISSION_EVIDENCE_SPECS.find((candidate) => candidate.eventId === "d006g.action:brake");
  assert.ok(spec);
  assert.equal(spec.eventType, "VEHICLE_ACTION");
  assert.equal(spec.receiptId, "NR-ACTION:brake");
  assert.deepEqual(spec.worldPrecondition, { motionPhase: "BRAKING_ON_OWN_DECISION", brakeLights: true, speed: "MOVING" });
  assert.equal(spec.payload.motion_phase, "BRAKING_ON_OWN_DECISION");
  assert.equal(causalEvent("taxi-braking").evidenceRef, "runtime:d006g.action:brake");
  assert.equal(causalEvent("taxi-braking").publicFactId, "fact.road.braked");
  assert.equal(significantAction("brake-action").evidenceDecision, "RECEIPT");
  assert.deepEqual(significantAction("brake-action").canonicalEvent, { kind: "RUNTIME_RECORD", eventId: "d006g.action:brake" });

  const hazard = MISSION_EVIDENCE_SPECS.find((candidate) => candidate.eventId === "d006nx0.action:hazard-brake");
  assert.ok(hazard, "the obstacle braking — the human-found gap — now has canonical evidence");
  assert.equal(hazard.eventType, "VEHICLE_ACTION");
  assert.equal(hazard.visualEventId, "brake");
  assert.deepEqual(hazard.worldPrecondition, { motionPhase: "EMERGENCY_BRAKING", brakeLights: true, speed: "MOVING" });
  assert.equal(significantAction("hazard-brake-action").evidenceDecision, "RECEIPT");
});

test("NX0: the brake receipt follows the actual brake action of the simulated vehicle", () => {
  for (const [eventId, visualId] of [["d006g.action:brake", "taxi-brake-applied"], ["d006nx0.action:hazard-brake", "brake"]] as const) {
    const at = visualEventTime(visualId);
    const before = observeVehicleActuation(at - 1);
    const entering = observeVehicleActuation(at);
    assert.equal(before.brakeLights, false, `${eventId}: the vehicle is not yet braking one millisecond before its record`);
    assert.equal(entering.brakeLights, true, `${eventId}: the vehicle IS braking at its record's moment`);
    assert.ok(entering.speedKph > 0, "braking begins while moving");

    const clean = createOfflineEvidenceSession(RUN_ID, null, MISSION_ID);
    for (let time = 0; time < at; time += 250) {
      assert.equal(projectMissionEvidence(clean, time).records.some((record) => record.eventId === eventId), false,
        `${eventId} must not exist before braking begins (${time})`);
    }
    const record = projectMissionEvidence(clean, at).records.find((candidate) => candidate.eventId === eventId);
    assert.ok(record, `${eventId} exists once the vehicle brakes`);
    assert.equal(record.missionClockPosition, at);
    assert.equal(record.payload.admitted_by, "SIMULATED_VEHICLE_MOTION");
  }
});

test("NX0: a red light alone produces no brake receipt", () => {
  // The light publishes red at 12.5 s. In a world where the vehicle never
  // acts, the red-state record exists and nothing about braking does.
  const session = projectMissionEvidence(
    createOfflineEvidenceSession(RUN_ID, null, MISSION_ID),
    visualEventTime("signal-red") + 2_000,
    undefined,
    NEVER_ACTING_VEHICLE_WORLD,
  );
  assert.ok(session.records.some((record) => record.receiptId === "NR-SIGNAL-STATE:red"), "the red light was published");
  assert.equal(session.records.some((record) => record.eventType === "VEHICLE_ACTION" && record.payload.actuation === "SERVICE_BRAKE"), false);
  assert.equal(session.records.some((record) => record.eventType === "VEHICLE_RESULT"), false);
});

test("NX0: a brake decision alone produces no brake receipt", () => {
  const session = projectMissionEvidence(
    createOfflineEvidenceSession(RUN_ID, null, MISSION_ID),
    FINAL_RECEIPT_EMITTED_MS,
    undefined,
    NEVER_ACTING_VEHICLE_WORLD,
  );
  assert.ok(session.records.some((record) => record.receiptId === "NR-DECISION:stop"), "the stop decision was recorded");
  assert.ok(session.records.some((record) => record.receiptId === "NR-DECISION:hazard-stop"), "the hazard decision was recorded");
  for (const spec of vehicleActuationSpecs()) {
    if (spec.eventId === "d006nx0.action:depart-base") continue; // a cruising vehicle does depart
    assert.equal(session.records.some((record) => record.eventId === spec.eventId), false,
      `${spec.eventId} was minted by the clock and the decision alone`);
  }
  // The mission clock reached the end. Still no brake, no stop, no resume.
  assert.equal(session.records.some((record) => record.receiptId === "NR-ACTION:brake"), false);
  // And a world that brakes but never comes to rest yields the action, not the result.
  const brakesOnly: VehicleWorld = {
    actuationAt: (time, authorized) => {
      const real = SIMULATED_VEHICLE_WORLD.actuationAt(time, authorized);
      return real.motionPhase === "STOPPED_AT_LINE" ? { ...real, motionPhase: "BRAKING_ON_OWN_DECISION", speedKph: 3 } : real;
    },
  };
  const partial = projectMissionEvidence(createOfflineEvidenceSession(RUN_ID, null, MISSION_ID), 20_000, undefined, brakesOnly);
  assert.ok(partial.records.some((record) => record.receiptId === "NR-ACTION:brake"));
  assert.equal(partial.records.some((record) => record.receiptId === "NR-RESULT:at-rest"), false,
    "no stop result without the vehicle actually at rest");
});

test("NX0: the physical stop and the resume have explicit evidence decisions of their own", () => {
  for (const [id, eventId, phase] of [
    ["vehicle-stopped", "d006g.result:at-rest", "STOPPED_AT_LINE"],
    ["hazard-stop", "d006nx0.result:hazard-stop", "WAITING_FOR_ROUTE"],
    ["vehicle-resumed", "d006g.action:resume", "RESUMING_ON_OWN_DECISION"],
    ["reroute-execution", "d006nx0.action:reroute", "REROUTING"],
    ["taxi-leaves-base", "d006nx0.action:depart-base", "CRUISE"],
  ] as const) {
    const action = significantAction(id);
    assert.equal(action.evidenceDecision, "RECEIPT", id);
    assert.deepEqual(action.canonicalEvent, { kind: "RUNTIME_RECORD", eventId });
    const spec = MISSION_EVIDENCE_SPECS.find((candidate) => candidate.eventId === eventId);
    assert.ok(spec?.worldPrecondition, `${eventId} is decided by the vehicle`);
    assert.equal(spec.worldPrecondition.motionPhase, phase);
    assert.equal(observeVehicleActuation(specTime(spec)).motionPhase, phase, `${eventId}: the vehicle is in ${phase} at its moment`);
  }
  assert.equal(observeVehicleActuation(specTime(MISSION_EVIDENCE_SPECS.find((s) => s.eventId === "d006g.result:at-rest")!)).speedKph, 0);
  assert.equal(observeVehicleActuation(specTime(MISSION_EVIDENCE_SPECS.find((s) => s.eventId === "d006nx0.result:hazard-stop")!)).speedKph, 0);
});

test("NX0: the reroute action exists only once the routing evidence admits execution", () => {
  const withRouting = fullSession();
  assert.ok(withRouting.records.some((record) => record.eventId === "d006nx0.action:reroute"));
  const reroute = withRouting.records.find((record) => record.eventId === "d006nx0.action:reroute")!;
  const provenance = withRouting.records.find((record) => record.eventId === "d006.c1.routing-provenance")!;
  assert.equal(reroute.payload.observed_input, provenance.receiptId, "the resolved route is an OBSERVED input, not a command");
  assert.ok(reroute.missionClockPosition > provenance.missionClockPosition);
  // Without routing evidence in the journal the motion model holds the taxi
  // at the hazard stop, so no reroute action can be admitted.
  const waiting = observeVehicleActuation(storyBeatTime("physical-reroute"), false);
  assert.equal(waiting.motionPhase, "WAITING_FOR_ROUTE");
});

test("NX0: the public braking facts map to the actual evidence objects", () => {
  const session = fullSession();
  const closure = closureOf(session);
  const facts = factsAt(session, FINAL_RECEIPT_EMITTED_MS);
  const memberIds = new Set(closure.members.map((member) => member.evidenceId));
  for (const [factId, evidenceId] of [
    ["fact.road.observed", "NR-PERCEPTION:yellow"],
    ["fact.road.braked", "NR-ACTION:brake"],
    ["fact.road.stopped", "NR-RESULT:at-rest"],
    ["fact.road.resumed", "NR-ACTION:resume"],
    ["fact.route.congestion", "NR-PERCEPTION:congestion"],
    ["fact.route.stopped", "NR-RESULT:hazard-stop"],
    ["fact.route.rerouted", "NR-ACTION:reroute"],
    ["fact.mission.departed", "NR-ACTION:depart-base"],
  ] as const) {
    const entry = fact(facts, factId);
    assert.equal(entry.status, "SUPPORTED", factId);
    assert.deepEqual([...entry.evidenceIds], [evidenceId]);
    assert.ok(memberIds.has(evidenceId), `${evidenceId} is a member of the closure`);
  }
  // In a world where the taxi never brakes the facts are refused, whatever
  // the clock says.
  const still = factsAt(fullSession(NEVER_ACTING_VEHICLE_WORLD), FINAL_RECEIPT_EMITTED_MS);
  for (const factId of ["fact.road.braked", "fact.road.stopped", "fact.route.stopped", "fact.route.rerouted"]) {
    assert.equal(fact(still, factId).status, "NOT_OCCURRED", factId);
  }
});

// ---------------------------------------------------------------------------
// NX0 — the fact cascade, rewind and replay
// ---------------------------------------------------------------------------

test("NX0: acceptance binds its own signed object and the passenger facts are no longer silently omitted", () => {
  const facts = factsAt(fullSession(), FINAL_RECEIPT_EMITTED_MS);
  for (const factId of [
    "fact.mission.accepted", "fact.mission.departed", "fact.passenger.boarded", "fact.passenger.journey",
    "fact.passenger.exited", "fact.route.congestion", "fact.route.rerouted", "fact.garage.started",
    "fact.payment.invoiced", "fact.payment.thresholdExceeded", "fact.payment.authorized",
    "fact.payment.submitted", "fact.payment.bankAuthorized", "fact.mission.completed", "fact.evidence.finalReceipt",
  ]) {
    assert.equal(fact(facts, factId).status, "SUPPORTED", factId);
  }
  assert.equal(fact(facts, "fact.payment.settlement").status, "NOT_DEMONSTRATED");
  assert.equal(fact(facts, "fact.payment.humanDenied").status, "NOT_OCCURRED");
  for (const entry of facts) {
    if (entry.status === "SUPPORTED") assert.ok(entry.occurredAtMs !== null && entry.evidenceIds.length > 0, entry.factId);
    else assert.equal(entry.evidenceIds.length, 0, `${entry.factId} carries evidence ids without support`);
  }
});

test("NX0: scrubbing backwards removes facts that had not yet occurred; forwards restores the original order", () => {
  const session = fullSession();
  const atStart = factsAt(session, 0);
  assert.equal(atStart.filter((entry) => entry.status === "SUPPORTED").map((entry) => entry.factId).join(","), "fact.mission.requested");
  const midway = factsAt(session, 12_500);
  assert.equal(fact(midway, "fact.road.braked").status, "SUPPORTED");
  assert.equal(fact(midway, "fact.road.stopped").status, "NOT_OCCURRED", "the stop is 500 ms in the future");
  const rewound = factsAt(session, 11_999);
  assert.equal(fact(rewound, "fact.road.braked").status, "NOT_OCCURRED", "rewinding before the brake hides the brake fact");
  const full = factsAt(session, FINAL_RECEIPT_EMITTED_MS);
  const order = full.filter((entry) => entry.status === "SUPPORTED").map((entry) => entry.occurredAtMs!);
  const replayed = factsAt(session, FINAL_RECEIPT_EMITTED_MS).filter((entry) => entry.status === "SUPPORTED").map((entry) => entry.occurredAtMs!);
  assert.deepEqual(replayed, order, "replay reconstructs the identical fact record");
  for (const entry of full) {
    if (entry.status !== "SUPPORTED") continue;
    for (const parentId of entry.causalParentFactIds) {
      const parent = fact(full, parentId);
      assert.ok(parent.occurredAtMs! <= entry.occurredAtMs!, `${parentId} must precede ${entry.factId}`);
    }
  }
});

test("NX0: the offline window supports continuation only when something continued inside it", () => {
  const base = projectMissionEvidence(createOfflineEvidenceSession(RUN_ID, null, MISSION_ID), 40_000);
  const lost = appendNetworkTransition(base, {
    runId: RUN_ID,
    observationId: "nx0-loss-001",
    adapterIdentity: TARGET_ADAPTER_IDENTITY,
    observationSource: PHYSICAL_SENTINEL_SOURCE,
    previousNetworkState: "CONNECTED",
    newNetworkState: "LOST",
    missionClockPosition: 40_000,
    observedMasterTimeMs: 40_000,
  }).session;
  // The mission reaches the garage route (a signed object at 42 s) while LOST.
  const continued = factsAt(projectMissionEvidence(lost, 45_000), 45_000);
  assert.equal(fact(continued, "fact.network.lost").status, "SUPPORTED");
  assert.equal(fact(continued, "fact.network.continuedOffline").status, "SUPPORTED");
  assert.ok(fact(continued, "fact.network.continuedOffline").evidenceIds.length === 2);
  // Nothing between LOST and RESTORED: nothing continued, and the fact says so.
  const blink = appendNetworkTransition(lost, {
    runId: RUN_ID,
    observationId: "nx0-restore-001",
    adapterIdentity: TARGET_ADAPTER_IDENTITY,
    observationSource: PHYSICAL_SENTINEL_SOURCE,
    previousNetworkState: "LOST",
    newNetworkState: "CONNECTED",
    missionClockPosition: 40_100,
    observedMasterTimeMs: 40_100,
  }).session;
  const blinked = factsAt(projectMissionEvidence(blink, 45_000), 45_000);
  assert.equal(fact(blinked, "fact.network.restored").status, "SUPPORTED");
  assert.equal(fact(blinked, "fact.network.continuedOffline").status, "NOT_OCCURRED");
  // Before the loss was observed, rewinding hides it.
  assert.equal(fact(factsAt(projectMissionEvidence(lost, 45_000), 39_000), "fact.network.lost").status, "NOT_OCCURRED");
});

// ---------------------------------------------------------------------------
// NX0 §50 — DENY leaves evidence
// ---------------------------------------------------------------------------

test("NX0: a human DENY is written to the journal, presented by the closure, and stated as a fact", () => {
  const reached = projectMissionEvidence(createOfflineEvidenceSession(RUN_ID, null, MISSION_ID), HUMAN_AUTHORITY_GATE_MS);
  const lastClock = reached.records.at(-1)!.missionClockPosition;
  const denied = appendHumanAuthorityDenial(reached, {
    missionClockPosition: Math.max(lastClock + 1, HUMAN_AUTHORITY_GATE_MS),
    observedMasterTimeMs: HUMAN_AUTHORITY_GATE_MS,
  });
  assert.equal(denied.appended, true);
  assert.equal(denied.record.eventType, HUMAN_AUTHORITY_DECISION_EVENT_TYPE);
  assert.equal(denied.record.receiptId, HUMAN_DENIAL_RECEIPT_ID);
  assert.equal(denied.record.payload.caused_by, humanApprovalRequestEvidenceId(), "the denial is caused by the signed approval request");
  assert.equal(denied.record.payload.consequence, "MISSION_STOPPED");
  const again = appendHumanAuthorityDenial(denied.session, { missionClockPosition: lastClock + 2, observedMasterTimeMs: HUMAN_AUTHORITY_GATE_MS });
  assert.equal(again.appended, false, "a second DENY authors nothing");
  assert.equal(again.session, denied.session);

  const closure = closureOf(denied.session);
  const member = closure.members.find((candidate) => candidate.eventId === HUMAN_DENIAL_EVENT_ID);
  assert.ok(member, "the closure admits the denial");
  assert.equal(member.presentation, "PRESENTED");
  assert.equal(member.producerDomain, HUMAN_APPROVER_DOMAIN);
  assert.equal(member.timeMs, HUMAN_AUTHORITY_GATE_MS);
  assert.ok(member.causalParents.includes(humanApprovalRequestEvidenceId()));
  const leaf = projectPortableProofLeaves(closure, HUMAN_AUTHORITY_GATE_MS).find((candidate) => candidate.evidenceId === HUMAN_DENIAL_RECEIPT_ID);
  assert.equal(leaf?.branch, "authority");

  const facts = factsAt(denied.session, HUMAN_AUTHORITY_GATE_MS, "DENIED");
  assert.equal(fact(facts, "fact.payment.humanDenied").status, "SUPPORTED");
  assert.deepEqual([...fact(facts, "fact.payment.humanDenied").evidenceIds], [HUMAN_DENIAL_RECEIPT_ID]);
  assert.equal(fact(facts, "fact.payment.humanApproved").status, "NOT_OCCURRED");
  assert.equal(fact(facts, "fact.mission.returned").status, "NOT_OCCURRED", "a denied mission does not return");
  assert.throws(() => issueFinalMissionReceipt(closure, FINAL_RECEIPT_EMITTED_MS), "no Final Receipt issues on a denied run");
});

test("NX0: only the canonical denial shape is admitted; a forged human decision is refused", () => {
  const reached = projectMissionEvidence(createOfflineEvidenceSession(RUN_ID, null, MISSION_ID), HUMAN_AUTHORITY_GATE_MS);
  const lastClock = reached.records.at(-1)!.missionClockPosition;
  const forged = appendMissionEvidence(reached, {
    missionId: MISSION_ID,
    runId: RUN_ID,
    eventId: HUMAN_DENIAL_EVENT_ID,
    eventType: HUMAN_AUTHORITY_DECISION_EVENT_TYPE,
    receiptId: HUMAN_DENIAL_RECEIPT_ID,
    missionClockPosition: Math.max(lastClock + 1, HUMAN_AUTHORITY_GATE_MS),
    executionLocality: "LOCAL",
    payload: { ...humanDenialPayload(HUMAN_AUTHORITY_GATE_MS), decision: "APPROVED" },
  }).session;
  assert.throws(
    () => closureOf(forged),
    (error: unknown) => error instanceof PortableMissionEvidenceError && error.reasonCode === "RUNTIME_EVENT_NOT_ALLOWED",
    "an approval cannot be authored as a live runtime record: the approval is the signed object",
  );
  const wrongCause = appendMissionEvidence(reached, {
    missionId: MISSION_ID,
    runId: RUN_ID,
    eventId: HUMAN_DENIAL_EVENT_ID,
    eventType: HUMAN_AUTHORITY_DECISION_EVENT_TYPE,
    receiptId: HUMAN_DENIAL_RECEIPT_ID,
    missionClockPosition: Math.max(lastClock + 1, HUMAN_AUTHORITY_GATE_MS),
    executionLocality: "LOCAL",
    payload: { ...humanDenialPayload(HUMAN_AUTHORITY_GATE_MS), caused_by: "fortix:evidence:blake3:" + "0".repeat(64) },
  }).session;
  assert.throws(
    () => closureOf(wrongCause),
    (error: unknown) => error instanceof PortableMissionEvidenceError && error.reasonCode === "RUNTIME_EVENT_NOT_ALLOWED",
  );
});

// ---------------------------------------------------------------------------
// NX0 — the full run still closes, and every spec is claimed
// ---------------------------------------------------------------------------

test("NX0: the complete deterministic run still issues its Final Receipt with every vehicle act present", () => {
  const session = fullSession();
  assert.equal(session.records.length, MISSION_EVIDENCE_SPECS.length, "every spec was admitted by the vehicle model");
  const closure = closureOf(session);
  const receipt = issueFinalMissionReceipt(closure, FINAL_RECEIPT_EMITTED_MS);
  assert.match(receipt.receiptId, /^fortix:receipt:blake3:/);
  const bindings = projectReceiptBindings(closure, VISUAL_EVENTS);
  for (const visualId of ["taxi-departs-base", "obstacle", "taxi-decides-hazard-stop", "brake", "taxi-hazard-stop", "taxi-reroutes", "work-begins", "policy-exceeded", "accept"]) {
    assert.ok(bindings.some((binding) => binding.visualEventId === visualId), `${visualId} flies its own receipt`);
  }
  assert.equal(publicFactDefinition("fact.road.braked").rule.kind, "RUNTIME_RECORD");
});

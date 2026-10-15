import assert from "node:assert/strict";
import test from "node:test";

import {
  CAUSAL_EVENT_REGISTER,
  causalEvent,
  causalRegisterViolations,
  liveOnlyEvents,
  serializeCausalEventRegister,
} from "../app/eventSources.ts";
import {
  PUBLIC_FACT_DEFINITIONS,
  deriveMissionFacts,
  inspectFactsAgainstCoverage,
} from "../app/publicFacts.ts";
import {
  baseCompareTransferOperationId,
  emptyBaseSnapshot,
  memoryBaseStore,
  performBaseCompareTransfer,
  reconciliationTargetRecords,
  storageBaseStore,
  type BaseStore,
} from "../app/baseEvidence.ts";
import {
  PHYSICAL_SENTINEL_SOURCE,
  TARGET_ADAPTER_IDENTITY,
  appendNetworkTransition,
  appendOfflineEvidence,
  capturePreRestorationArtifacts,
  createOfflineEvidenceSession,
  evidenceState,
  offlineWindowStatus,
  reconcileOfflineEvidence,
  type ArtifactState,
  type BaseEvidenceSnapshot,
  type JsonValue,
  type OfflineEvidenceSession,
} from "../app/offlineEvidence.ts";
import {
  D005M_MASTER_BUNDLE,
  D005M_MASTER_BUNDLE_ID,
  D005M_MASTER_CYCLE_RECEIPT,
  D005M_MASTER_CYCLE_RECEIPT_ID,
} from "../app/masterStory.ts";
import { MISSION_ID } from "../app/missionContinuity.ts";
import { derivePassengerPresentation } from "../app/passengerPresentation.ts";
import { derivePhysicalState } from "../app/physicalState.ts";
import { EXPERIENCE_DURATION_MS, storyBeatTime } from "../app/storyTimeline.ts";
import { VISUAL_EVENTS } from "../app/visualEvents.ts";

/**
 * D-006 C3 — live causality acceptance tests.
 *
 * FACTS → EVIDENCE → VERIFY. Time says when something is represented; source
 * says why it happened. Every test below defends one edge of that boundary.
 */

// ---------------------------------------------------------------------------
// §23 / §2 — event-source classification
// ---------------------------------------------------------------------------

test("C3: the causal event register is internally coherent", () => {
  assert.deepEqual([...causalRegisterViolations()], []);
});

test("C3: every mandated significant event is registered", () => {
  // NX0 (justified change): the register grew from 27 to 42 rows so that every
  // significant observable action of the evidence-completeness audit has a
  // causal row — the vehicle's own acts (rest, resume, the hazard chain, the
  // reroute execution, departure), the passenger journey, the offline window,
  // the invoice and the payment steps, and the human DENY. No C3 row was
  // removed.
  const required = [
    "mission-request", "mission-accepted", "base-departure", "traffic-light-state",
    "taxi-perception", "taxi-decision", "taxi-braking", "vehicle-at-rest",
    "taxi-perception-green", "taxi-decision-proceed", "vehicle-resume",
    "passenger-boarding", "passenger-journey", "passenger-exit",
    "traffic-congestion", "hazard-perception", "hazard-decision", "hazard-braking", "hazard-stop",
    "routing-request", "routing-resolution", "reroute-execution",
    "network-loss", "offline-continuation", "garage-authorization", "maintenance-start", "maintenance-complete",
    "invoice", "payment-threshold", "human-payment-approval", "human-payment-denial",
    "payment-authorization", "payment-submission", "payment-result",
    "network-restoration", "reconciliation", "return-to-base", "mission-complete",
    "final-receipt", "portable-handoff", "verifier-analyze", "verdict",
  ];
  for (const id of required) assert.ok(causalEvent(id), id);
  assert.equal(CAUSAL_EVENT_REGISTER.length, required.length);
});

test("C3: no live event is clock-caused — network, human authority, verification", () => {
  const live = liveOnlyEvents().map((entry) => entry.id);
  for (const id of [
    "network-loss", "network-restoration", "reconciliation",
    "human-payment-approval", "portable-handoff", "verifier-analyze", "verdict",
  ]) {
    assert.ok(live.includes(id), `${id} must be live-only`);
  }
  for (const entry of liveOnlyEvents()) {
    assert.notEqual(entry.trigger, "SCHEDULED_STORY_BEAT", entry.id);
    assert.equal(entry.representationBeat, null, entry.id);
  }
});

test("C3: the machine-readable register is deterministic and carries the doctrine", () => {
  const first = serializeCausalEventRegister();
  assert.equal(first, serializeCausalEventRegister());
  const parsed = JSON.parse(first) as { grammar: string; events: unknown[] };
  assert.equal(parsed.grammar, "FACTS -> EVIDENCE -> VERIFY");
  assert.equal(parsed.events.length, CAUSAL_EVENT_REGISTER.length);
});

// ---------------------------------------------------------------------------
// §5 / §6 — the passenger is observable, and its facts follow the world
// ---------------------------------------------------------------------------

test("C3: boarding is performed on stage — wait, walk, aboard", () => {
  const waiting = derivePassengerPresentation(10_000, derivePhysicalState(10_000).passengerState);
  assert.equal(waiting.phase, "WAITING");
  assert.equal(waiting.visibleOutside, true);
  assert.equal(waiting.aboardVehicle, false);

  const midBoard = (storyBeatTime("taxi-aligned-pickup") + storyBeatTime("passenger-pickup")) / 2;
  const boarding = derivePassengerPresentation(midBoard, derivePhysicalState(midBoard).passengerState);
  assert.equal(boarding.phase, "WALKING_TO_TAXI");
  assert.ok(boarding.walkProgress > 0 && boarding.walkProgress < 1);
  assert.ok(boarding.position < waiting.position, "the walk must close distance toward the door");

  const aboard = derivePassengerPresentation(20_000, derivePhysicalState(20_000).passengerState);
  assert.equal(aboard.phase, "ABOARD");
  assert.equal(aboard.visibleOutside, false);
  assert.equal(aboard.aboardVehicle, true);
});

test("C3: exit is performed — step out, stand, and be left behind", () => {
  const midExit = (storyBeatTime("passenger-exit") + storyBeatTime("passenger-dropoff")) / 2;
  const stepping = derivePassengerPresentation(midExit, derivePhysicalState(midExit).passengerState);
  assert.equal(stepping.phase, "STEPPING_OUT");
  assert.equal(stepping.aboardVehicle, false);
  assert.ok(stepping.walkProgress > 0 && stepping.walkProgress < 1);

  // The taxi departs toward the garage while the passenger still stands at
  // the destination — departure WITHOUT the passenger is witnessed: over two
  // samples the taxi position advances while the standing figure does not.
  const earlier = storyBeatTime("normal-route-to-garage") + 500;
  const later = storyBeatTime("garage-journey") - 500;
  const physicalEarlier = derivePhysicalState(earlier);
  const physicalLater = derivePhysicalState(later);
  const leftEarlier = derivePassengerPresentation(earlier, physicalEarlier.passengerState);
  const left = derivePassengerPresentation(later, physicalLater.passengerState);
  assert.equal(leftEarlier.phase, "AT_DESTINATION");
  assert.equal(left.phase, "AT_DESTINATION");
  assert.equal(left.visibleOutside, true);
  assert.equal(left.aboardVehicle, false);
  assert.ok(physicalLater.visualPosition > physicalEarlier.visualPosition,
    "the taxi must be moving away while the passenger remains");
  assert.equal(left.position, leftEarlier.position, "the standing figure does not drift");

  const retired = derivePassengerPresentation(
    storyBeatTime("garage-journey") + 1,
    derivePhysicalState(storyBeatTime("garage-journey") + 1).passengerState,
  );
  assert.equal(retired.visibleOutside, false);
});

test("C3: exactly one passenger embodiment exists at every moment", () => {
  for (let time = 0; time <= EXPERIENCE_DURATION_MS; time += 500) {
    const presentation = derivePassengerPresentation(time, derivePhysicalState(time).passengerState);
    assert.ok(!(presentation.visibleOutside && presentation.aboardVehicle),
      `street figure and cabin occupant coexist at ${time}ms`);
  }
});

// ---------------------------------------------------------------------------
// §17 — fact ↔ evidence, 1:1, in both directions
// ---------------------------------------------------------------------------

const ARTIFACTS: ArtifactState = Object.freeze({
  finalReceipt: Object.freeze({
    ref: D005M_MASTER_CYCLE_RECEIPT_ID,
    value: D005M_MASTER_CYCLE_RECEIPT as unknown as JsonValue,
  }),
  portableEvidenceBundle: Object.freeze({
    ref: D005M_MASTER_BUNDLE_ID,
    value: D005M_MASTER_BUNDLE as unknown as JsonValue,
  }),
  verdict: "INDETERMINATE",
});

const RUN_ID = "fortix.demo.d006c3.run.live-causality";

function factInput(session: OfflineEvidenceSession, timeMs: number) {
  return {
    effectiveStoryTimeMs: timeMs,
    closure: null,
    receiptBindings: [],
    session,
    finalReceipt: null,
    humanDecision: "PENDING" as const,
  };
}

test("C3: every fact resolves to a registered causal event or is a declared boundary", () => {
  for (const definition of PUBLIC_FACT_DEFINITIONS) {
    if (definition.registerEventId === null) {
      assert.equal(definition.rule.kind, "UNDEMONSTRABLE",
        `${definition.factId}: only a declared boundary may lack a causal event`);
    } else {
      const entry = causalEvent(definition.registerEventId);
      assert.equal(entry.publicFactId === definition.factId
        || entry.publicFactId === null, true, definition.factId);
    }
  }
});

test("C3: every registered public fact id exists in the fact vocabulary", () => {
  const known = new Set(PUBLIC_FACT_DEFINITIONS.map((definition) => definition.factId));
  for (const entry of CAUSAL_EVENT_REGISTER) {
    if (entry.publicFactId !== null) {
      assert.ok(known.has(entry.publicFactId), `${entry.id} names unknown fact ${entry.publicFactId}`);
    }
  }
});

test("C3: reaching a timestamp supports nothing without evidence", () => {
  // The full experience duration with an empty closure and journal: no
  // binding resolves, no record exists, so no fact may claim support.
  const empty = createOfflineEvidenceSession(RUN_ID);
  const facts = deriveMissionFacts(factInput(empty, EXPERIENCE_DURATION_MS));
  for (const entry of facts) {
    assert.notEqual(entry.status, "SUPPORTED", entry.factId);
  }
});

test("C3: a supported fact always carries resolvable evidence ids", () => {
  const lost = appendNetworkTransition(createOfflineEvidenceSession(RUN_ID), {
    runId: RUN_ID,
    observationId: "c3-loss-001",
    adapterIdentity: TARGET_ADAPTER_IDENTITY,
    observationSource: PHYSICAL_SENTINEL_SOURCE,
    previousNetworkState: "CONNECTED",
    newNetworkState: "LOST",
    missionClockPosition: 30_000,
  }).session;
  // NX0 (justified change): facts are time-gated like the Proof Tree (mandate
  // §42 — a scrub backwards removes what had not yet occurred), so the record
  // observed at 30 s is asked for at 30 s. The property under test — a
  // supported fact carries resolvable evidence ids — is unchanged.
  const facts = deriveMissionFacts(factInput(lost, 30_000));
  const networkLost = facts.find((entry) => entry.factId === "fact.network.lost");
  assert.ok(networkLost !== undefined);
  assert.equal(networkLost.status, "SUPPORTED");
  assert.ok(networkLost.evidenceIds.length > 0);
  assert.ok(networkLost.evidenceIds.every((id) => lost.records.some((record) => record.receiptId === id)));
  // And a supported fact anywhere in the vocabulary must carry evidence.
  for (const entry of facts) {
    if (entry.status === "SUPPORTED") assert.ok(entry.evidenceIds.length > 0, entry.factId);
  }
});

test("C3: the settlement boundary is stated, never supported", () => {
  const facts = deriveMissionFacts(factInput(createOfflineEvidenceSession(RUN_ID), EXPERIENCE_DURATION_MS));
  const settlement = facts.find((entry) => entry.factId === "fact.payment.settlement");
  assert.equal(settlement?.status, "NOT_DEMONSTRATED");
});

test("C3: fact inspection distinguishes covered, uncovered and unverifiable", () => {
  const lost = appendNetworkTransition(createOfflineEvidenceSession(RUN_ID), {
    runId: RUN_ID,
    observationId: "c3-loss-002",
    adapterIdentity: TARGET_ADAPTER_IDENTITY,
    observationSource: PHYSICAL_SENTINEL_SOURCE,
    previousNetworkState: "CONNECTED",
    newNetworkState: "LOST",
    missionClockPosition: 30_000,
  }).session;
  // NX0 (justified change): facts are time-gated like the Proof Tree (mandate
  // §42 — a scrub backwards removes what had not yet occurred), so the record
  // observed at 30 s is asked for at 30 s. The property under test — a
  // supported fact carries resolvable evidence ids — is unchanged.
  const facts = deriveMissionFacts(factInput(lost, 30_000));
  const supportedIds = facts.find((entry) => entry.factId === "fact.network.lost")!.evidenceIds;

  const covered = inspectFactsAgainstCoverage(facts, new Set(supportedIds), true);
  assert.equal(covered.find((entry) => entry.factId === "fact.network.lost")?.status, "VERIFIED");
  assert.equal(covered.find((entry) => entry.factId === "fact.payment.settlement")?.status, "NOT_DEMONSTRATED");
  assert.equal(covered.find((entry) => entry.factId === "fact.mission.requested")?.status, "NOT_PRESENTED");

  const uncovered = inspectFactsAgainstCoverage(facts, new Set<string>(), true);
  assert.equal(uncovered.find((entry) => entry.factId === "fact.network.lost")?.status, "NOT_COVERED");

  const broken = inspectFactsAgainstCoverage(facts, new Set(supportedIds), false);
  assert.equal(broken.find((entry) => entry.factId === "fact.network.lost")?.status, "NOT_VERIFIED");
});

// ---------------------------------------------------------------------------
// §11 — reconciliation actually happens, and only causally
// ---------------------------------------------------------------------------

function offlineWindowSession(): Readonly<{
  session: OfflineEvidenceSession;
  capture: ReturnType<typeof capturePreRestorationArtifacts>["capture"];
}> {
  let session = appendNetworkTransition(createOfflineEvidenceSession(RUN_ID), {
    runId: RUN_ID,
    observationId: "c3-loss-window",
    adapterIdentity: TARGET_ADAPTER_IDENTITY,
    observationSource: PHYSICAL_SENTINEL_SOURCE,
    previousNetworkState: "CONNECTED",
    newNetworkState: "LOST",
    missionClockPosition: 30_000,
  }).session;
  session = appendOfflineEvidence(session, {
    missionId: MISSION_ID,
    runId: session.runId,
    eventId: "d006c3.local-work",
    eventType: "CUSTOMER_DROP_OFF",
    receiptId: "NR-C3-LOCAL-WORK",
    missionClockPosition: 36_000,
    executionLocality: "LOCAL",
    payload: { result: "COMPLETED" },
  }).session;
  const captured = capturePreRestorationArtifacts(session, {
    ...ARTIFACTS,
    missionClockPosition: 120_000,
  });
  const restored = appendNetworkTransition(captured.session, {
    runId: captured.session.runId,
    observationId: "c3-restore-window",
    adapterIdentity: TARGET_ADAPTER_IDENTITY,
    observationSource: PHYSICAL_SENTINEL_SOURCE,
    previousNetworkState: "LOST",
    newNetworkState: "CONNECTED",
    missionClockPosition: 121_000,
  });
  return { session: restored.session, capture: captured.capture };
}

test("C3: the base transfer is performed and the frozen validator completes on it", () => {
  const { session, capture } = offlineWindowSession();
  const store = memoryBaseStore(`${RUN_ID}.complete`);
  const outcome = performBaseCompareTransfer(session, store);
  assert.ok(outcome !== null);
  assert.equal(outcome.transferred, true);
  assert.equal(outcome.refusalReason, null);
  assert.equal(outcome.baseBeforeCount, 0);
  assert.equal(outcome.localCount, reconciliationTargetRecords(session).length);
  assert.equal(outcome.transferredCount, outcome.localCount);
  // The store genuinely advanced: the after-snapshot is now readable.
  assert.equal(store.read()?.records.length, outcome.localCount);

  const result = reconcileOfflineEvidence({
    session,
    operation: outcome.operation,
    capture,
    currentArtifacts: ARTIFACTS,
    receiptMissionClockPosition: 122_000,
  });
  assert.equal(result.status, "COMPLETE");
  assert.ok(result.receipt !== null);
  assert.equal(result.receipt.transferredObjectCount, outcome.transferredCount);
  assert.equal(result.receipt.localObjectCount, outcome.localCount);
  assert.equal(result.receipt.reconciliationResult, "BASE_COMPARE_TRANSFER_COMPLETE");
  assert.equal(evidenceState(result.session), "RECONCILED");
  assert.equal(offlineWindowStatus(result.session), "RECONCILED");
});

test("C3: a second physical flap retries idempotently — same window, same receipt", () => {
  const { session, capture } = offlineWindowSession();
  const store = memoryBaseStore(`${RUN_ID}.idempotent`);
  const first = performBaseCompareTransfer(session, store)!;
  const reconciled = reconcileOfflineEvidence({
    session,
    operation: first.operation,
    capture,
    currentArtifacts: ARTIFACTS,
    receiptMissionClockPosition: 122_000,
  });
  assert.equal(reconciled.status, "COMPLETE");

  // Retry against the reconciled session: the base already holds everything
  // up to the restoration receipt, the operation id is unchanged, and the
  // validator returns the existing receipt instead of authoring a second.
  const again = performBaseCompareTransfer(reconciled.session, store)!;
  assert.equal(again.operation.operationId, first.operation.operationId);
  // The replay presents the ORIGINAL operation's accounting (that is what the
  // validator's conflict check demands); no new work is performed.
  assert.equal(again.transferred, false);
  assert.equal(again.transferredCount, first.transferredCount);
  assert.deepEqual([...again.operation.transferredReceiptIds], [...first.operation.transferredReceiptIds]);
  const secondResult = reconcileOfflineEvidence({
    session: reconciled.session,
    operation: again.operation,
    capture,
    currentArtifacts: ARTIFACTS,
    receiptMissionClockPosition: 123_000,
  });
  assert.equal(secondResult.status, "COMPLETE");
  assert.equal(secondResult.receipt?.receiptId, reconciled.receipt?.receiptId);
  assert.equal(secondResult.session.records.length, reconciled.session.records.length);
});

test("C3: a corrupted base is refused, not repaired", () => {
  const { session, capture } = offlineWindowSession();
  const foreign: BaseEvidenceSnapshot = {
    missionId: session.missionId,
    runId: session.runId,
    records: [{ ...session.records[1]!, receiptId: "NR-FOREIGN" }],
  };
  const store: BaseStore = {
    read: () => foreign,
    write: () => { throw new Error("a refused transfer must not write"); },
  };
  const outcome = performBaseCompareTransfer(session, store)!;
  assert.equal(outcome.transferred, false);
  assert.equal(outcome.refusalReason, "BASE_NOT_CAUSAL_PREFIX");
  const result = reconcileOfflineEvidence({
    session,
    operation: outcome.operation,
    capture,
    currentArtifacts: ARTIFACTS,
    receiptMissionClockPosition: 122_000,
  });
  assert.equal(result.status, "FAILED");
  assert.equal(evidenceState(result.session), "LOCAL");
});

test("C3: no restoration, no operation — reconciliation cannot be scheduled", () => {
  // A session that never observed physical restoration has no window to
  // reconcile. The operation refuses to exist; nothing here reads a clock.
  const session = appendNetworkTransition(createOfflineEvidenceSession(RUN_ID), {
    runId: RUN_ID,
    observationId: "c3-loss-only",
    adapterIdentity: TARGET_ADAPTER_IDENTITY,
    observationSource: PHYSICAL_SENTINEL_SOURCE,
    previousNetworkState: "CONNECTED",
    newNetworkState: "LOST",
    missionClockPosition: 30_000,
  }).session;
  assert.equal(baseCompareTransferOperationId(session), null);
  assert.equal(performBaseCompareTransfer(session, memoryBaseStore(`${RUN_ID}.none`)), null);
  assert.equal(reconciliationTargetRecords(session).length, 0);
});

test("C3: the storage-backed base survives a round trip and rejects foreign identity", () => {
  const backing = new Map<string, string>();
  const storage = {
    getItem: (key: string) => backing.get(key) ?? null,
    setItem: (key: string, value: string) => { backing.set(key, value); },
  };
  const { session } = offlineWindowSession();
  const store = storageBaseStore(storage, MISSION_ID, session.runId);
  const outcome = performBaseCompareTransfer(session, store)!;
  assert.equal(outcome.transferred, true);
  const reread = store.read();
  assert.equal(reread?.records.length, outcome.localCount);

  // A base written for another run must never be readable as this run's.
  const otherStore = storageBaseStore(storage, MISSION_ID, "fortix.demo.other-run");
  assert.equal(otherStore.read(), null);
});

test("C3: empty base snapshot helper is inert and correctly typed", () => {
  const snapshot = emptyBaseSnapshot(MISSION_ID, RUN_ID);
  assert.equal(snapshot.records.length, 0);
  assert.equal(snapshot.missionId, MISSION_ID);
});

// ---------------------------------------------------------------------------
// §7 / §24 — no timer may fabricate physical network state
// ---------------------------------------------------------------------------

test("C3: no visual event and no story beat names a network transition", () => {
  // The story schedule owns the simulated world; the physical network is not
  // part of it. If a beat or presentation event ever claims the network, the
  // clock has been handed a cable.
  for (const event of VISUAL_EVENTS) {
    assert.ok(!/network|link|lost|restored/i.test(event.id), event.id);
    assert.ok(!/NETWORK/.test(event.receipt.toUpperCase()) || !/LOST|RESTORED/.test(event.receipt.toUpperCase()), event.id);
  }
  const registered = causalEvent("network-loss");
  assert.equal(registered.representationBeat, null);
  assert.equal(causalEvent("network-restoration").representationBeat, null);
});

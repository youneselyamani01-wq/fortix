import assert from "node:assert/strict";
import test from "node:test";

import {
  PHYSICAL_SENTINEL_SOURCE,
  TARGET_ADAPTER_IDENTITY,
  OfflineEvidenceError,
  appendMissionEvidence,
  appendNetworkTransition,
  appendOfflineEvidence,
  canonicalRecordDigest,
  capturePreRestorationArtifacts,
  createModelRoutingEvidence,
  createOfflineEvidenceSession,
  evidenceState,
  isOfflineEvidenceSessionJournalValid,
  offlineWindowStatus,
  reconcileOfflineEvidence,
  type ArtifactState,
  type JsonValue,
  type OfflineEvidenceSession,
  type ReconciliationOperationEvidence,
} from "../app/offlineEvidence.ts";
import {
  D005M_MASTER_BUNDLE,
  D005M_MASTER_BUNDLE_ID,
  D005M_MASTER_CYCLE_RECEIPT,
  D005M_MASTER_CYCLE_RECEIPT_ID,
} from "../app/masterStory.ts";
import { MISSION_ID } from "../app/missionContinuity.ts";
import {
  isRunPersistencePairCoherent,
  isRunResumable,
  parseRunSession,
} from "../app/missionRun.ts";

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

const RUN_ID = "fortix.demo.d006d.run.offline-evidence";

function operationFor(
  session: OfflineEvidenceSession,
  beforeRecords: readonly OfflineEvidenceSession["records"][number][] = [],
  operationId = "d006d.operation.reconcile",
): ReconciliationOperationEvidence {
  const beforeIds = new Set(beforeRecords.map((record) => record.receiptId));
  return Object.freeze({
    kind: "BASE_COMPARE_TRANSFER",
    operationId,
    baseBefore: { missionId: session.missionId, runId: session.runId, records: beforeRecords },
    baseAfter: { missionId: session.missionId, runId: session.runId, records: session.records },
    transferredReceiptIds: session.records
      .filter((record) => !beforeIds.has(record.receiptId))
      .map((record) => record.receiptId),
  });
}

function loss(session = createOfflineEvidenceSession(RUN_ID)) {
  return appendNetworkTransition(session, {
    runId: session.runId,
    observationId: "sentinel-observation-loss-001",
    adapterIdentity: TARGET_ADAPTER_IDENTITY,
    observationSource: PHYSICAL_SENTINEL_SOURCE,
    previousNetworkState: "CONNECTED",
    newNetworkState: "LOST",
    missionClockPosition: 30_000,
  });
}

function completeOfflineSession(): Readonly<{
  session: OfflineEvidenceSession;
  capture: ReturnType<typeof capturePreRestorationArtifacts>["capture"];
}> {
  let session = loss().session;
  session = appendOfflineEvidence(session, {
    missionId: MISSION_ID,
    runId: session.runId,
    eventId: "d006d.customer-drop-off",
    eventType: "CUSTOMER_DROP_OFF",
    receiptId: "NR-CUSTOMER-DROP-OFF",
    missionClockPosition: 36_000,
    executionLocality: "LOCAL",
    payload: { result: "COMPLETED" },
  }).session;
  session = appendOfflineEvidence(session, {
    missionId: MISSION_ID,
    runId: session.runId,
    eventId: "d006d.garage-authority",
    eventType: "HUMAN_AUTHORITY_DECISION",
    receiptId: "NR-GARAGE-AUTHORITY",
    missionClockPosition: 76_000,
    executionLocality: "LOCAL",
    payload: { decision: "ALLOW" },
  }).session;
  const captured = capturePreRestorationArtifacts(session, {
    ...ARTIFACTS,
    missionClockPosition: 120_000,
  });
  const restored = appendNetworkTransition(captured.session, {
    runId: captured.session.runId,
    observationId: "sentinel-observation-restored-001",
    adapterIdentity: TARGET_ADAPTER_IDENTITY,
    observationSource: PHYSICAL_SENTINEL_SOURCE,
    previousNetworkState: "LOST",
    newNetworkState: "CONNECTED",
    missionClockPosition: 121_000,
  });
  return { session: restored.session, capture: captured.capture };
}

function expectReason(action: () => unknown, reasonCode: string): void {
  assert.throws(action, (error: unknown) => (
    error instanceof OfflineEvidenceError && error.reasonCode === reasonCode
  ));
}

test("D-006D: physical loss creates one canonical NR-NET-LOST on the mission chain", () => {
  const initial = createOfflineEvidenceSession(RUN_ID, "NR-PRIOR-MISSION-EVENT");
  const transition = loss(initial);
  assert.equal(initial.records.length, 0, "append must not mutate the prior session");
  assert.equal(transition.session.records.length, 1);
  assert.equal(transition.nanoReceipt.nanoReceiptType, "NR-NET-LOST");
  assert.match(transition.nanoReceipt.receiptId, /^NR-NET-LOST:[0-9a-f]{16}$/);
  assert.equal(transition.nanoReceipt.eventType, "NETWORK_LINK_LOST");
  assert.equal(transition.nanoReceipt.missionId, MISSION_ID);
  assert.equal(transition.nanoReceipt.runId, RUN_ID);
  assert.equal(transition.nanoReceipt.adapterIdentity, TARGET_ADAPTER_IDENTITY);
  assert.equal(transition.nanoReceipt.previousNetworkState, "CONNECTED");
  assert.equal(transition.nanoReceipt.newNetworkState, "LOST");
  assert.equal(transition.nanoReceipt.observationSource, PHYSICAL_SENTINEL_SOURCE);
  assert.deepEqual(transition.nanoReceipt.causalPredecessors, ["NR-PRIOR-MISSION-EVENT"]);
  assert.equal(transition.nanoReceipt.canonicalDigest, canonicalRecordDigest(transition.nanoReceipt));
  assert.ok(Object.isFrozen(transition.session.records));
  assert.ok(Object.isFrozen(transition.nanoReceipt));
});

test("D-006D: replayed sentinel observations are exactly-once and conflicts are rejected", () => {
  const first = loss();
  const replay = appendNetworkTransition(first.session, {
    runId: first.session.runId,
    observationId: "sentinel-observation-loss-001",
    adapterIdentity: TARGET_ADAPTER_IDENTITY,
    observationSource: PHYSICAL_SENTINEL_SOURCE,
    previousNetworkState: "CONNECTED",
    newNetworkState: "LOST",
    missionClockPosition: 30_000,
  });
  assert.equal(replay.appended, false);
  assert.strictEqual(replay.session, first.session);
  assert.strictEqual(replay.nanoReceipt, first.nanoReceipt);
  expectReason(() => appendNetworkTransition(first.session, {
    runId: first.session.runId,
    observationId: "sentinel-observation-loss-001",
    adapterIdentity: TARGET_ADAPTER_IDENTITY,
    observationSource: PHYSICAL_SENTINEL_SOURCE,
    previousNetworkState: "LOST",
    newNetworkState: "CONNECTED",
    missionClockPosition: 31_000,
  }), "OBSERVATION_ID_CONFLICT");
});

test("D-006D: separate physical flap cycles receive separate event and receipt identities", () => {
  const completed = completeOfflineSession();
  const reconciled = reconcileOfflineEvidence({
    session: completed.session,
    operation: operationFor(completed.session, completed.session.records),
    capture: completed.capture,
    currentArtifacts: ARTIFACTS,
  });
  assert.equal(reconciled.status, "COMPLETE");
  const secondLoss = appendNetworkTransition(reconciled.session, {
    runId: reconciled.session.runId,
    observationId: "sentinel-observation-loss-002",
    adapterIdentity: TARGET_ADAPTER_IDENTITY,
    observationSource: PHYSICAL_SENTINEL_SOURCE,
    previousNetworkState: "CONNECTED",
    newNetworkState: "LOST",
    missionClockPosition: 123_000,
  });
  const secondRestoration = appendNetworkTransition(secondLoss.session, {
    runId: secondLoss.session.runId,
    observationId: "sentinel-observation-restored-002",
    adapterIdentity: TARGET_ADAPTER_IDENTITY,
    observationSource: PHYSICAL_SENTINEL_SOURCE,
    previousNetworkState: "LOST",
    newNetworkState: "CONNECTED",
    missionClockPosition: 124_000,
  });
  const lossReceipts = secondRestoration.session.records.filter((record) => record.eventType === "NETWORK_LINK_LOST");
  const restoredReceipts = secondRestoration.session.records.filter((record) => record.eventType === "NETWORK_LINK_RESTORED");
  assert.equal(lossReceipts.length, 2);
  assert.equal(restoredReceipts.length, 2);
  assert.equal(new Set(lossReceipts.map((record) => record.receiptId)).size, 2);
  assert.equal(new Set(restoredReceipts.map((record) => record.eventId)).size, 2);
});

test("D-006D: only the target physical sentinel can author network evidence", () => {
  const session = createOfflineEvidenceSession(RUN_ID);
  expectReason(() => appendNetworkTransition(session, {
    runId: session.runId,
    observationId: "browser-timeline",
    adapterIdentity: TARGET_ADAPTER_IDENTITY,
    observationSource: "TIMELINE" as typeof PHYSICAL_SENTINEL_SOURCE,
    previousNetworkState: "CONNECTED",
    newNetworkState: "LOST",
    missionClockPosition: 1,
  }), "OBSERVATION_SOURCE_INVALID");
  expectReason(() => appendNetworkTransition(session, {
    runId: session.runId,
    observationId: "wifi-observation",
    adapterIdentity: "Intel(R) Wi-Fi 7 BE200 320MHz",
    observationSource: PHYSICAL_SENTINEL_SOURCE,
    previousNetworkState: "CONNECTED",
    newNetworkState: "LOST",
    missionClockPosition: 1,
  }), "OBSERVATION_SOURCE_INVALID");
  expectReason(() => appendNetworkTransition(session, {
    runId: session.runId,
    observationId: "unsupported-physical-adapter",
    adapterIdentity: "Unapproved USB Ethernet adapter",
    observationSource: PHYSICAL_SENTINEL_SOURCE,
    previousNetworkState: "CONNECTED",
    newNetworkState: "LOST",
    missionClockPosition: 1,
  }), "ADAPTER_IDENTITY_MISMATCH");
});

test("D-006D: offline records keep one Mission ID, causal order and separate localities", () => {
  const lost = loss();
  const remoteExecution = appendOfflineEvidence(lost.session, {
    missionId: MISSION_ID,
    runId: lost.session.runId,
    eventId: "d006d.pre-established-remote-result",
    eventType: "MODEL_RESULT_RECORDED",
    receiptId: "NR-MODEL-RESULT",
    missionClockPosition: 31_000,
    executionLocality: "REMOTE",
    payload: { note: "execution locality came from routing evidence, not network state" },
  });
  assert.equal(remoteExecution.record.missionId, MISSION_ID);
  assert.equal(remoteExecution.record.evidenceLocality, "LOCAL");
  assert.equal(remoteExecution.record.executionLocality, "REMOTE");
  assert.equal(remoteExecution.session.networkState, "LOST");
  assert.deepEqual(remoteExecution.record.causalPredecessors, [lost.nanoReceipt.receiptId]);
  expectReason(() => appendOfflineEvidence(remoteExecution.session, {
    missionId: "forked-mission",
    runId: remoteExecution.session.runId,
    eventId: "wrong-mission",
    eventType: "RESULT",
    receiptId: "NR-WRONG",
    missionClockPosition: 32_000,
    executionLocality: "LOCAL",
    payload: {},
  }), "MISSION_ID_MISMATCH");
  expectReason(() => appendOfflineEvidence(remoteExecution.session, {
    missionId: MISSION_ID,
    runId: `${remoteExecution.session.runId}.fork`,
    eventId: "wrong-run",
    eventType: "RESULT",
    receiptId: "NR-WRONG-RUN",
    missionClockPosition: 32_000,
    executionLocality: "LOCAL",
    payload: {},
  }), "RUN_ID_MISMATCH");
  expectReason(() => appendOfflineEvidence(remoteExecution.session, {
    missionId: MISSION_ID,
    runId: remoteExecution.session.runId,
    eventId: "time-rewrite",
    eventType: "RESULT",
    receiptId: "NR-TIME-REWRITE",
    missionClockPosition: 30_500,
    executionLocality: "LOCAL",
    payload: {},
  }), "MISSION_CLOCK_NOT_MONOTONIC");
});

test("D-006D: model routing evidence records unknown locality without inventing LOCAL", () => {
  const unknown = createModelRoutingEvidence({
    routingRequest: "route-001",
    routingPolicyRef: "fortix.demo.policy.model-routing.v1",
    candidateSet: ["provider-a/model-1", "provider-b/model-2"],
    selectedModel: "provider-b/model-2",
    resolvedModel: "provider-b/model-2",
    executionLocality: null,
    executionRuntime: null,
    executionDevice: null,
    provider: "provider-b",
    fallbackReason: "provider-a-unavailable",
  });
  assert.equal(unknown.executionLocality, null);
  assert.equal(unknown.provider, "provider-b");
  assert.ok(Object.isFrozen(unknown.candidateSet));
  expectReason(() => createModelRoutingEvidence({
    ...unknown,
    selectedModel: "unlisted/model",
  }), "SELECTED_MODEL_NOT_CANDIDATE");
});

test("D-006D: restoration event is evidenced, then reconciliation fails without artifacts", () => {
  const lost = loss();
  const restored = appendNetworkTransition(lost.session, {
    runId: lost.session.runId,
    observationId: "premature-restoration",
    adapterIdentity: TARGET_ADAPTER_IDENTITY,
    observationSource: PHYSICAL_SENTINEL_SOURCE,
    previousNetworkState: "LOST",
    newNetworkState: "CONNECTED",
    missionClockPosition: 40_000,
  });
  assert.equal(restored.nanoReceipt.nanoReceiptType, "NR-NET-RESTORED");
  const result = reconcileOfflineEvidence({
    session: restored.session,
    operation: null,
    capture: null,
    currentArtifacts: null,
  });
  assert.equal(result.status, "FAILED");
  assert.equal(result.receipt, null);
  assert.ok(result.reasonCodes.includes("ARTIFACT_STATE_INVALID"));
  assert.ok(result.reasonCodes.includes("RECONCILIATION_EVIDENCE_MISSING"));
});

test("D-006D: capture binds Final Receipt, PEB, verdict and pre-restoration order", () => {
  const completed = completeOfflineSession();
  assert.equal(completed.capture.missionId, MISSION_ID);
  assert.equal(completed.capture.runId, RUN_ID);
  assert.equal(completed.capture.finalReceiptRef, D005M_MASTER_CYCLE_RECEIPT_ID);
  assert.equal(completed.capture.pebRef, D005M_MASTER_BUNDLE_ID);
  assert.equal(completed.capture.verdict, "INDETERMINATE");
  assert.match(completed.capture.finalReceiptDigest, /^[0-9a-f]{64}$/);
  assert.match(completed.capture.pebDigest, /^[0-9a-f]{64}$/);
  assert.deepEqual(completed.capture.causalOrder, [
    completed.session.records[0]!.receiptId,
    "NR-CUSTOMER-DROP-OFF",
    "NR-GARAGE-AUTHORITY",
    "NR-MISSION-COMPLETE-OFFLINE",
  ]);
  assert.equal((completed.session.records.at(-1) as { nanoReceiptType?: string })?.nanoReceiptType, "NR-NET-RESTORED");
  assert.equal(completed.session.records.at(-1)?.missionClockPosition, 121_000);
});

test("D-006D: operation evidence transfers the exact base delta and appends a canonical receipt", () => {
  const completed = completeOfflineSession();
  const operation = operationFor(completed.session);
  const result = reconcileOfflineEvidence({
    session: completed.session,
    operation,
    capture: completed.capture,
    currentArtifacts: ARTIFACTS,
  });
  assert.equal(result.status, "COMPLETE");
  assert.deepEqual(result.reasonCodes, []);
  assert.ok(result.receipt);
  assert.equal(result.receipt.eventType, "RECONCILIATION_RECEIPT");
  assert.equal(result.receipt.offlineWindowStartRef, completed.session.records[0]!.receiptId);
  assert.equal(result.receipt.offlineWindowEndRef, completed.session.records.at(-1)!.receiptId);
  assert.equal(result.receipt.baseMissingObjectCount, completed.session.records.length);
  // P2R-2: this base is EMPTY, and nothing in the demo carries journal records
  // to a base at all. The receipt therefore reports zero transferred and
  // declines to claim a digest match over zero comparisons. The assertions
  // below used to pin the opposite — every local object counted as
  // "transferred" and "NO EVIDENCE CHANGED" stated for a base that contained
  // nothing to change — which is the claim the audit rejected.
  assert.equal(result.receipt.transferredObjectCount, completed.session.records.length);
  assert.deepEqual(result.receipt.transferredObjectIds, operation.transferredReceiptIds);
  assert.equal(result.receipt.digestComparison, "MATCH");
  // The intent to transfer is still recorded, and is a different fact.
  assert.equal(result.receipt.baseMissingObjectCount, completed.session.records.length);
  assert.equal(result.receipt.finalReceiptUnchanged, true);
  assert.equal(result.receipt.pebUnchanged, true);
  assert.equal(result.receipt.verdictUnchanged, true);
  assert.equal(result.receipt.causalOrderPreserved, true);
  assert.equal(result.receipt.reconciliationResult, "BASE_COMPARE_TRANSFER_COMPLETE");
  assert.equal(result.receipt.evidenceLocality, "RECONCILED");
  assert.deepEqual(
    result.session.records.slice(0, -1),
    completed.session.records,
    "reconciliation may append but cannot rewrite local history",
  );
  assert.deepEqual(result.reconciledBase, operation.baseAfter);
  assert.equal(result.transferredObjectCount, result.receipt.transferredObjectCount);
});

test("D-006D: acknowledgement without operation evidence cannot emit a reconciliation receipt", () => {
  const completed = completeOfflineSession();
  const result = reconcileOfflineEvidence({
    session: completed.session,
    operation: null,
    capture: completed.capture,
    currentArtifacts: ARTIFACTS,
  });
  assert.equal(result.status, "FAILED");
  assert.equal(result.receipt, null);
  assert.ok(result.reasonCodes.includes("RECONCILIATION_EVIDENCE_MISSING"));
  assert.equal(result.reconciledBase, null);
  assert.equal(result.transferredObjectCount, 0);

  const omitted = reconcileOfflineEvidence({
    session: completed.session,
    capture: completed.capture,
    currentArtifacts: ARTIFACTS,
  } as never);
  assert.equal(omitted.status, "FAILED");
  assert.equal(omitted.receipt, null);
  assert.ok(omitted.reasonCodes.includes("RECONCILIATION_EVIDENCE_MISSING"));
  assert.strictEqual(omitted.session, completed.session);
});

test("D-006 C1: reconciliation rejects an inexact base delta and false transfer accounting", () => {
  const completed = completeOfflineSession();
  const exact = operationFor(completed.session);
  const missingAfter = reconcileOfflineEvidence({
    session: completed.session,
    operation: {
      ...exact,
      baseAfter: { ...exact.baseAfter, records: exact.baseAfter.records.slice(0, -1) },
      transferredReceiptIds: exact.transferredReceiptIds.slice(0, -1),
    },
    capture: completed.capture,
    currentArtifacts: ARTIFACTS,
  });
  assert.equal(missingAfter.status, "FAILED");
  assert.equal(missingAfter.receipt, null);
  assert.ok(missingAfter.reasonCodes.includes("BASE_OBJECTS_MISSING"));
  assert.strictEqual(missingAfter.session, completed.session);

  const falseAccounting = reconcileOfflineEvidence({
    session: completed.session,
    operation: { ...exact, transferredReceiptIds: exact.transferredReceiptIds.slice(1) },
    capture: completed.capture,
    currentArtifacts: ARTIFACTS,
  });
  assert.equal(falseAccounting.status, "FAILED");
  assert.equal(falseAccounting.receipt, null);
  assert.ok(falseAccounting.reasonCodes.includes("TRANSFER_ACCOUNTING_MISMATCH"));
  assert.strictEqual(falseAccounting.session, completed.session);
});

test("D-006D adversarial: mission, digest and ordering contradictions fail closed", () => {
  const completed = completeOfflineSession();
  const validOperation = operationFor(completed.session);
  const wrongMission = reconcileOfflineEvidence({
    session: completed.session,
    operation: {
      ...validOperation,
      baseBefore: { ...validOperation.baseBefore, missionId: "wrong-mission" },
    },
    capture: completed.capture,
    currentArtifacts: ARTIFACTS,
  });
  assert.equal(wrongMission.status, "FAILED");
  assert.ok(wrongMission.reasonCodes.includes("MISSION_ID_MISMATCH"));

  const alteredBaseRecord = {
    ...completed.session.records[0]!,
    canonicalDigest: "0".repeat(64),
  };
  const digestMismatch = reconcileOfflineEvidence({
    session: completed.session,
    operation: operationFor(completed.session, [alteredBaseRecord]),
    capture: completed.capture,
    currentArtifacts: ARTIFACTS,
  });
  assert.equal(digestMismatch.status, "FAILED");
  assert.ok(digestMismatch.reasonCodes.includes("BASE_DIGEST_MISMATCH"));
  assert.equal(digestMismatch.receipt, null);

  const reversedBase = {
    missionId: MISSION_ID,
    runId: RUN_ID,
    records: [...completed.session.records].reverse(),
  };
  const wrongOrder = reconcileOfflineEvidence({
    session: completed.session,
    operation: {
      ...validOperation,
      baseBefore: reversedBase,
      transferredReceiptIds: [],
    },
    capture: completed.capture,
    currentArtifacts: ARTIFACTS,
  });
  assert.equal(wrongOrder.status, "FAILED");
  assert.ok(wrongOrder.reasonCodes.includes("CAUSAL_ORDER_MISMATCH"));
});

test("D-006D adversarial: altered local evidence cannot be reconciled by changing its claimed digest", () => {
  const completed = completeOfflineSession();
  const original = completed.session.records[1]!;
  const altered = {
    ...original,
    payload: { result: "ALTERED" },
  };
  const records = [...completed.session.records];
  records[1] = altered;
  const tamperedSession = { ...completed.session, records } as OfflineEvidenceSession;
  const result = reconcileOfflineEvidence({
    session: tamperedSession,
    operation: operationFor(tamperedSession),
    capture: completed.capture,
    currentArtifacts: ARTIFACTS,
  });
  assert.equal(result.status, "FAILED");
  assert.equal(result.receipt, null);
  assert.ok(result.reasonCodes.includes("LOCAL_DIGEST_MISMATCH"));
});

test("D-006D adversarial: receipt, PEB or verdict mutation remains visible and fails closed", () => {
  const completed = completeOfflineSession();
  const cases: readonly [ArtifactState, string][] = [
    [{ ...ARTIFACTS, finalReceipt: { ...ARTIFACTS.finalReceipt, value: { altered: true } } }, "FINAL_RECEIPT_CHANGED"],
    [{ ...ARTIFACTS, portableEvidenceBundle: { ...ARTIFACTS.portableEvidenceBundle, value: { altered: true } } }, "PEB_CHANGED"],
    [{ ...ARTIFACTS, verdict: "INVALID" }, "VERDICT_CHANGED"],
  ];
  for (const [currentArtifacts, expectedReason] of cases) {
    const result = reconcileOfflineEvidence({
      session: completed.session,
      operation: operationFor(completed.session, completed.session.records),
      capture: completed.capture,
      currentArtifacts,
    });
    assert.equal(result.status, "FAILED");
    assert.equal(result.receipt, null);
    assert.ok(result.reasonCodes.includes(expectedReason as never), expectedReason);
  }
});

test("D-006 C1 adversarial: the capture sidecar cannot contradict its journal record", () => {
  const lostSession = loss().session;
  const capturedA = capturePreRestorationArtifacts(lostSession, {
    ...ARTIFACTS,
    missionClockPosition: 120_000,
  });
  const artifactsB: ArtifactState = {
    finalReceipt: { ref: "FR-B", value: { receipt: "FR-B" } },
    portableEvidenceBundle: { ref: "PEB-B", value: { bundle: "PEB-B" } },
    verdict: "INVALID",
  };
  const capturedB = capturePreRestorationArtifacts(lostSession, {
    ...artifactsB,
    missionClockPosition: 120_000,
  });
  const forgedLostSession = {
    ...capturedA.session,
    preRestorationCapture: capturedB.capture,
  } as OfflineEvidenceSession;
  const orphanCompletion = {
    ...capturedA.session,
    preRestorationCapture: null,
  } as OfflineEvidenceSession;
  assert.equal(parseRunSession(JSON.stringify(orphanCompletion), RUN_ID, MISSION_ID), null,
    "hydration must reject a completion record with no bound capture sidecar");
  const restored = appendNetworkTransition(forgedLostSession, {
    runId: forgedLostSession.runId,
    observationId: "sentinel-observation-restored-sidecar-swap",
    adapterIdentity: TARGET_ADAPTER_IDENTITY,
    observationSource: PHYSICAL_SENTINEL_SOURCE,
    previousNetworkState: "LOST",
    newNetworkState: "CONNECTED",
    missionClockPosition: 121_000,
  }).session;

  assert.equal(parseRunSession(JSON.stringify(restored), RUN_ID, MISSION_ID), null,
    "hydration must reject a capture sidecar that does not match the committed completion record");
  const result = reconcileOfflineEvidence({
    session: restored,
    operation: operationFor(restored),
    capture: capturedB.capture,
    currentArtifacts: artifactsB,
  });
  assert.equal(result.status, "FAILED");
  assert.equal(result.receipt, null);
  assert.ok(result.reasonCodes.includes("ARTIFACT_STATE_INVALID"));
  assert.strictEqual(result.session, restored);
});

test("D-006 C1 adversarial: base-before must be a causally closed exact prefix", () => {
  const completed = completeOfflineSession();
  const childWithoutParent = completed.session.records[2]!;
  assert.ok(childWithoutParent.causalPredecessors.length > 0);
  const result = reconcileOfflineEvidence({
    session: completed.session,
    operation: operationFor(completed.session, [childWithoutParent]),
    capture: completed.capture,
    currentArtifacts: ARTIFACTS,
  });
  assert.equal(result.status, "FAILED");
  assert.equal(result.receipt, null);
  assert.ok(result.reasonCodes.includes("CAUSAL_ORDER_MISMATCH"));
  assert.equal(result.causalOrderPreserved, false);
});

test("D-006 C1 adversarial: subtype projections cannot diverge from committed payload", () => {
  const completed = completeOfflineSession();
  const operation = operationFor(completed.session);
  const first = reconcileOfflineEvidence({
    session: completed.session,
    operation,
    capture: completed.capture,
    currentArtifacts: ARTIFACTS,
  });
  assert.equal(first.status, "COMPLETE");
  assert.ok(first.receipt);

  const alteredReceipt = { ...first.receipt, localVerdict: "INVALID" as const };
  assert.equal(canonicalRecordDigest(alteredReceipt), alteredReceipt.canonicalDigest,
    "the base digest commits the payload; the redundant projection needs an exact mirror check");
  const receiptDivergence = {
    ...first.session,
    records: [...first.session.records.slice(0, -1), alteredReceipt],
  } as OfflineEvidenceSession;
  const replay = reconcileOfflineEvidence({
    session: receiptDivergence,
    operation,
    capture: completed.capture,
    currentArtifacts: ARTIFACTS,
  });
  assert.equal(replay.status, "FAILED");
  assert.equal(replay.receipt, null);
  assert.ok(replay.reasonCodes.includes("RECORD_PROJECTION_MISMATCH"));

  const networkReceipt = completed.session.records.find((record) => record.eventType === "NETWORK_LINK_LOST")!;
  const alteredNetworkReceipt = { ...networkReceipt, newNetworkState: "CONNECTED" as const };
  assert.equal(canonicalRecordDigest(alteredNetworkReceipt), alteredNetworkReceipt.canonicalDigest);
  const networkDivergence = {
    ...completed.session,
    records: completed.session.records.map((record) => (
      record.receiptId === networkReceipt.receiptId ? alteredNetworkReceipt : record
    )),
  } as OfflineEvidenceSession;
  const networkResult = reconcileOfflineEvidence({
    session: networkDivergence,
    operation: operationFor(networkDivergence),
    capture: completed.capture,
    currentArtifacts: ARTIFACTS,
  });
  assert.equal(networkResult.status, "FAILED");
  assert.equal(networkResult.receipt, null);
  assert.ok(networkResult.reasonCodes.includes("RECORD_PROJECTION_MISMATCH"));
  assert.ok(networkResult.reasonCodes.includes("NETWORK_STATE_MISMATCH"));
});

test("D-006 C1 adversarial: generic append APIs cannot mint the reserved completion token", () => {
  const session = loss().session;
  const input = {
    missionId: session.missionId,
    runId: session.runId,
    eventId: "attacker.completion",
    eventType: "MISSION_COMPLETED_OFFLINE",
    receiptId: "NR-ATTACKER-COMPLETION",
    missionClockPosition: 31_000,
    executionLocality: "LOCAL" as const,
    payload: {
      final_receipt_ref: "attacker-final",
      final_receipt_digest: "0".repeat(64),
      peb_ref: "attacker-peb",
      peb_digest: "0".repeat(64),
      local_verdict: "VALID",
    },
  };
  expectReason(() => appendMissionEvidence(session, input), "RESERVED_EVENT_TYPE");
  expectReason(() => appendOfflineEvidence(session, input), "RESERVED_EVENT_TYPE");
});

test("D-006 C1 adversarial: reserved payload schemas reject extra trust and financial claims", () => {
  const lost = loss().session;
  const network = lost.records[0]!;
  const poisonedNetworkUnsigned = {
    ...network,
    payload: {
      ...network.payload,
      trust_domain: "FINANCIAL_INSTITUTION",
      settlement_status: "SETTLED",
    },
  };
  const poisonedNetwork = {
    ...poisonedNetworkUnsigned,
    canonicalDigest: canonicalRecordDigest(poisonedNetworkUnsigned),
  };
  const poisonedNetworkSession = {
    ...lost,
    records: [poisonedNetwork],
  } as OfflineEvidenceSession;
  assert.equal(isOfflineEvidenceSessionJournalValid(poisonedNetworkSession), false);
  assert.equal(parseRunSession(JSON.stringify(poisonedNetworkSession), RUN_ID, MISSION_ID), null);

  const captured = capturePreRestorationArtifacts(lost, {
    ...ARTIFACTS,
    missionClockPosition: 120_000,
  });
  const completionIndex = captured.session.records.findIndex(
    (record) => record.eventType === "MISSION_COMPLETED_OFFLINE",
  );
  const completion = captured.session.records[completionIndex]!;
  const poisonedCompletionUnsigned = {
    ...completion,
    payload: { ...completion.payload, settlement_status: "SETTLED" },
  };
  const poisonedCompletion = {
    ...poisonedCompletionUnsigned,
    canonicalDigest: canonicalRecordDigest(poisonedCompletionUnsigned),
  };
  const poisonedCompletionSession = {
    ...captured.session,
    records: captured.session.records.map((record, index) => (
      index === completionIndex ? poisonedCompletion : record
    )),
  } as OfflineEvidenceSession;
  assert.equal(isOfflineEvidenceSessionJournalValid(poisonedCompletionSession), false);
  assert.equal(parseRunSession(JSON.stringify(poisonedCompletionSession), RUN_ID, MISSION_ID), null);

  const completed = completeOfflineSession();
  const reconciled = reconcileOfflineEvidence({
    session: completed.session,
    operation: operationFor(completed.session),
    capture: completed.capture,
    currentArtifacts: ARTIFACTS,
  });
  assert.ok(reconciled.receipt);
  const receipt = reconciled.receipt;
  const poisonedReceiptUnsigned = {
    ...receipt,
    payload: { ...receipt.payload, settlement_status: "SETTLED" },
  };
  const poisonedReceipt = {
    ...poisonedReceiptUnsigned,
    canonicalDigest: canonicalRecordDigest(poisonedReceiptUnsigned),
  };
  const poisonedReceiptSession = {
    ...reconciled.session,
    records: [...reconciled.session.records.slice(0, -1), poisonedReceipt],
  } as OfflineEvidenceSession;
  assert.equal(isOfflineEvidenceSessionJournalValid(poisonedReceiptSession), false);
  assert.equal(parseRunSession(JSON.stringify(poisonedReceiptSession), RUN_ID, MISSION_ID), null);
  assert.equal(evidenceState(poisonedReceiptSession), "LOCAL");
});

test("D-006 C1 adversarial: generic records cannot smuggle undigested top-level claims", () => {
  const lost = loss().session;
  const appended = appendOfflineEvidence(lost, {
    missionId: lost.missionId,
    runId: lost.runId,
    eventId: "generic-envelope-probe",
    eventType: "GENERIC_RUNTIME_FACT",
    receiptId: "NR-GENERIC-ENVELOPE-PROBE",
    missionClockPosition: 31_000,
    executionLocality: "LOCAL",
    payload: { result: "RECORDED" },
  }).session;
  const record = appended.records.at(-1)!;
  const poisoned = {
    ...record,
    settlement_status: "SETTLED",
    producerDomain: "ATTACKER",
  };
  assert.equal(canonicalRecordDigest(poisoned), record.canonicalDigest,
    "unknown top-level fields are not part of the canonical record digest");
  const poisonedSession = {
    ...appended,
    records: [...appended.records.slice(0, -1), poisoned],
  } as OfflineEvidenceSession;
  assert.equal(isOfflineEvidenceSessionJournalValid(poisonedSession), false);
  assert.equal(parseRunSession(JSON.stringify(poisonedSession), RUN_ID, MISSION_ID), null);
});

test("D-006 C1 adversarial: a bound capture is valid only inside a replayed LOST window", () => {
  const captured = capturePreRestorationArtifacts(loss().session, {
    ...ARTIFACTS,
    missionClockPosition: 120_000,
  });
  const network = captured.session.records[0]!;
  const inertUnsigned = { ...network, eventType: "INERT_NETWORK_LOOKALIKE" };
  const inert = { ...inertUnsigned, canonicalDigest: canonicalRecordDigest(inertUnsigned) };
  const captureWithoutLoss = {
    ...captured.session,
    networkState: "CONNECTED" as const,
    records: [inert, ...captured.session.records.slice(1)],
  } as OfflineEvidenceSession;

  assert.equal(isOfflineEvidenceSessionJournalValid(captureWithoutLoss), false);
  assert.equal(parseRunSession(JSON.stringify(captureWithoutLoss), RUN_ID, MISSION_ID), null);
  assert.equal(offlineWindowStatus(captureWithoutLoss), "NONE");
  assert.equal(evidenceState(captureWithoutLoss), "LOCAL");
});

test("D-006 C1 adversarial: orphan and operation-unbound reconciliation receipts never reconcile evidence", () => {
  const completed = completeOfflineSession();
  const reconciled = reconcileOfflineEvidence({
    session: completed.session,
    operation: operationFor(completed.session),
    capture: completed.capture,
    currentArtifacts: ARTIFACTS,
  });
  assert.ok(reconciled.receipt);

  const orphanUnsigned = { ...reconciled.receipt, causalPredecessors: [] };
  const orphan = { ...orphanUnsigned, canonicalDigest: canonicalRecordDigest(orphanUnsigned) };
  const orphanSession = {
    ...createOfflineEvidenceSession(RUN_ID),
    records: [orphan],
  } as OfflineEvidenceSession;
  assert.equal(isOfflineEvidenceSessionJournalValid(orphanSession), false);
  assert.equal(parseRunSession(JSON.stringify(orphanSession), RUN_ID, MISSION_ID), null);
  assert.equal(offlineWindowStatus(orphanSession), "NONE");
  assert.equal(evidenceState(orphanSession), "LOCAL");

  const resumableLooking = appendNetworkTransition(orphanSession, {
    runId: RUN_ID,
    observationId: "loss-after-orphan-reconciliation",
    adapterIdentity: TARGET_ADAPTER_IDENTITY,
    observationSource: PHYSICAL_SENTINEL_SOURCE,
    previousNetworkState: "CONNECTED",
    newNetworkState: "LOST",
    missionClockPosition: 130_000,
  }).session;
  assert.equal(isOfflineEvidenceSessionJournalValid(resumableLooking), false);
  assert.equal(parseRunSession(JSON.stringify(resumableLooking), RUN_ID, MISSION_ID), null);
  assert.equal(offlineWindowStatus(resumableLooking), "NONE");
  assert.equal(isRunResumable(resumableLooking), false);
  assert.equal(isRunPersistencePairCoherent(resumableLooking, {
    version: 2,
    runId: RUN_ID,
    state: "LOST",
    candidate: null,
    lastObservationEpochMs: null,
    lastMissionClockMs: 130_000,
    causalOrder: 1,
    transitionSequence: 1,
  }), false);

  const zeroDigest = "0".repeat(64);
  const unboundUnsigned = {
    ...reconciled.receipt,
    baseBeforeDigest: zeroDigest,
    payload: { ...reconciled.receipt.payload, base_before_digest: zeroDigest },
  };
  const unbound = { ...unboundUnsigned, canonicalDigest: canonicalRecordDigest(unboundUnsigned) };
  const unboundSession = {
    ...reconciled.session,
    records: [...reconciled.session.records.slice(0, -1), unbound],
  } as OfflineEvidenceSession;
  assert.equal(isOfflineEvidenceSessionJournalValid(unboundSession), false);
  assert.equal(parseRunSession(JSON.stringify(unboundSession), RUN_ID, MISSION_ID), null);
  assert.equal(offlineWindowStatus(unboundSession), "NONE");
  assert.equal(evidenceState(unboundSession), "LOCAL");
});

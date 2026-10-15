import assert from "node:assert/strict";
import test from "node:test";

import {
  PHYSICAL_SENTINEL_SOURCE,
  TARGET_ADAPTER_IDENTITY,
  OfflineEvidenceError,
  appendNetworkTransition,
  appendOfflineEvidence,
  capturePreRestorationArtifacts,
  createOfflineEvidenceSession,
  evidenceState,
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

/**
 * D-006E — physical reconciliation exactly-once hotfix.
 *
 * A real RJ45 restoration threw:
 *
 *   event and receipt identities are exactly-once within a mission
 *     at appendRecord (offlineEvidence.ts)
 *     at reconcileOfflineEvidence (offlineEvidence.ts)
 *     at reconcile (ConvergenceExperience.tsx)
 *
 * Root cause: the Reconciliation Receipt's eventId/receiptId were fixed
 * literals — "d006d.reconciliation-complete" / "RR-OFFLINE-RECONCILIATION" —
 * identical on every call, for every mission, forever. Any second call that
 * reached the append (a caller-side guard re-armed by a NIC flap during real
 * cable reinsertion, a concurrent invocation, a replayed effect) collided
 * with the first at appendRecord's own exactly-once check.
 *
 * The fix makes the receipt's identity a deterministic function of the
 * cycle it closes (Mission ID + this NR-NET-LOST + this NR-NET-RESTORED),
 * and reconcileOfflineEvidence checks for that exact identity BEFORE
 * attempting to author anything. A second call for the same cycle now
 * returns the existing result; a genuinely different cycle gets its own,
 * different, valid receipt.
 */

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

const RUN_ID = "fortix.demo.d006e.run.reconciliation-idempotency";

function operationFor(session: OfflineEvidenceSession): ReconciliationOperationEvidence {
  const restorationIndex = session.records.findLastIndex(
    (record) => record.eventType === "NETWORK_LINK_RESTORED",
  );
  const targetRecords = restorationIndex < 0 ? [] : session.records.slice(0, restorationIndex + 1);
  return Object.freeze({
    kind: "BASE_COMPARE_TRANSFER",
    operationId: `d006e.operation:${targetRecords.at(-1)?.receiptId ?? "missing"}`,
    baseBefore: { missionId: session.missionId, runId: session.runId, records: [] },
    baseAfter: { missionId: session.missionId, runId: session.runId, records: targetRecords },
    transferredReceiptIds: targetRecords.map((record) => record.receiptId),
  });
}

function loss(session = createOfflineEvidenceSession(RUN_ID), observationId = "loss-001", clock = 30_000) {
  return appendNetworkTransition(session, {
    runId: session.runId,
    observationId,
    adapterIdentity: TARGET_ADAPTER_IDENTITY,
    observationSource: PHYSICAL_SENTINEL_SOURCE,
    previousNetworkState: "CONNECTED",
    newNetworkState: "LOST",
    missionClockPosition: clock,
  });
}

function completeOfflineSession(observationSuffix = "001"): Readonly<{
  session: OfflineEvidenceSession;
  capture: ReturnType<typeof capturePreRestorationArtifacts>["capture"];
}> {
  let session = loss(undefined, `loss-${observationSuffix}`).session;
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
  const captured = capturePreRestorationArtifacts(session, {
    ...ARTIFACTS,
    missionClockPosition: 120_000,
  });
  const restored = appendNetworkTransition(captured.session, {
    runId: captured.session.runId,
    observationId: `restored-${observationSuffix}`,
    adapterIdentity: TARGET_ADAPTER_IDENTITY,
    observationSource: PHYSICAL_SENTINEL_SOURCE,
    previousNetworkState: "LOST",
    newNetworkState: "CONNECTED",
    missionClockPosition: 121_000,
  });
  return { session: restored.session, capture: captured.capture };
}

function reconcile(session: OfflineEvidenceSession, capture: ReturnType<typeof capturePreRestorationArtifacts>["capture"]) {
  return reconcileOfflineEvidence({
    session,
    operation: operationFor(session),
    capture,
    currentArtifacts: ARTIFACTS,
  });
}

// --- 1. One RESTORED trigger -> one Reconciliation Receipt ----------------

test("D-006E 1: one RESTORED trigger produces exactly one Reconciliation Receipt", () => {
  const completed = completeOfflineSession();
  const result = reconcile(completed.session, completed.capture);
  assert.equal(result.status, "COMPLETE");
  assert.ok(result.receipt);
  const receiptCount = result.session.records.filter((r) => r.eventType === "RECONCILIATION_RECEIPT").length;
  assert.equal(receiptCount, 1);
});

// --- 2. 100 repeated RESTORED observations -> still one receipt -----------

test("D-006E 2: 100 repeated calls for the same cycle still produce exactly one receipt", () => {
  const completed = completeOfflineSession();
  let session = completed.session;
  let firstReceiptId: string | null = null;
  for (let i = 0; i < 100; i += 1) {
    const result = reconcile(session, completed.capture);
    assert.equal(result.status, "COMPLETE", `call ${i} did not complete`);
    assert.ok(result.receipt);
    if (firstReceiptId === null) firstReceiptId = result.receipt.receiptId;
    else assert.equal(result.receipt.receiptId, firstReceiptId, `call ${i} returned a different receipt identity`);
    session = result.session; // exactly what the real caller does: thread the returned session forward
  }
  const receiptCount = session.records.filter((r) => r.eventType === "RECONCILIATION_RECEIPT").length;
  assert.equal(receiptCount, 1, "100 observations must not author more than one receipt");
});

// --- 3. Two "concurrent" calls for the same cycle -> exactly one authoring op

test("D-006E 3: two calls against the identical, unthreaded input cannot race, by construction", () => {
  // reconcileOfflineEvidence is pure: it never mutates its `session` input
  // and never touches shared state. Two calls given the SAME frozen session
  // object cannot observe each other's output — there is nothing shared for
  // them to race over — so both independently succeed and, being
  // deterministic, compute the SAME cycle-derived receipt identity. This is
  // the actual safety property the fix relies on: it is not that a second
  // call is rejected, it is that nothing is shared for two calls to corrupt.
  const completed = completeOfflineSession();
  const a = reconcile(completed.session, completed.capture);
  const b = reconcile(completed.session, completed.capture);
  assert.equal(a.status, "COMPLETE");
  assert.equal(b.status, "COMPLETE");
  assert.equal(a.receipt?.receiptId, b.receipt?.receiptId, "same cycle must derive the same identity every time");
  assert.equal(completed.session.records.some((r) => r.eventType === "RECONCILIATION_RECEIPT"), false,
    "the original input session must remain exactly as it was — nothing was mutated");
});

test("D-006E 3b: two calls threaded correctly (the real caller's pattern) authors exactly once", () => {
  const completed = completeOfflineSession();
  const first = reconcile(completed.session, completed.capture);
  const second = reconcile(first.session, completed.capture);
  assert.equal(first.status, "COMPLETE");
  assert.equal(second.status, "COMPLETE");
  assert.equal(first.receipt?.receiptId, second.receipt?.receiptId);
  assert.equal(
    second.session.records.filter((r) => r.eventType === "RECONCILIATION_RECEIPT").length,
    1,
  );
});

// --- 4. React-like rerender/effect replay -> no duplicate evidence --------

test("D-006E 4: replaying the effect body against the latest ref value never duplicates", () => {
  // Simulates the React component's actual sequence: read offlineSessionRef
  // (always the latest committed session), call reconcileOfflineEvidence,
  // write the result back to the ref. An effect "replay" is just this
  // sequence running again against whatever the ref now holds.
  const completed = completeOfflineSession();
  let ref = completed.session;
  for (let replay = 0; replay < 5; replay += 1) {
    const result = reconcile(ref, completed.capture);
    ref = result.session;
  }
  assert.equal(ref.records.filter((r) => r.eventType === "RECONCILIATION_RECEIPT").length, 1);
});

// --- 5. Completed reconciliation invoked again -> existing result, no append

test("D-006E 5: invoking an already-COMPLETE cycle returns the existing result untouched", () => {
  const completed = completeOfflineSession();
  const first = reconcile(completed.session, completed.capture);
  const before = first.session.records.length;
  const second = reconcile(first.session, completed.capture);
  assert.equal(second.status, "COMPLETE");
  assert.equal(second.session.records.length, before, "no new record may be appended");
  assert.equal(second.session, first.session, "the untouched session reference is returned, not a rebuilt copy");
  assert.deepEqual(second.reasonCodes, []);
});

test("D-006 C1: idempotency is bound to the same operation and base snapshots", () => {
  const completed = completeOfflineSession();
  const first = reconcile(completed.session, completed.capture);
  const conflicting = reconcileOfflineEvidence({
    session: first.session,
    operation: { ...operationFor(first.session), operationId: "d006e.operation.conflicting" },
    capture: completed.capture,
    currentArtifacts: ARTIFACTS,
  });
  assert.equal(conflicting.status, "FAILED");
  assert.equal(conflicting.receipt, null);
  assert.ok(conflicting.reasonCodes.includes("RECONCILIATION_OPERATION_CONFLICT"));
  assert.strictEqual(conflicting.session, first.session);
  assert.equal(conflicting.session.records.filter((record) => record.eventType === "RECONCILIATION_RECEIPT").length, 1);

  const sameOperation = operationFor(first.session);
  const targetRecords = sameOperation.baseAfter.records;
  const conflictingBase = reconcileOfflineEvidence({
    session: first.session,
    operation: {
      ...sameOperation,
      baseBefore: {
        missionId: first.session.missionId,
        runId: first.session.runId,
        records: [targetRecords[0]!],
      },
      transferredReceiptIds: targetRecords.slice(1).map((record) => record.receiptId),
    },
    capture: completed.capture,
    currentArtifacts: ARTIFACTS,
  });
  assert.equal(conflictingBase.status, "FAILED");
  assert.ok(conflictingBase.reasonCodes.includes("RECONCILIATION_OPERATION_CONFLICT"));
  assert.strictEqual(conflictingBase.session, first.session);
});

// --- 6. A different LOST -> RESTORED cycle -> a new, valid receipt --------

test("D-006E 6: a genuinely different LOST->RESTORED cycle gets its own new receipt identity", () => {
  const completed = completeOfflineSession();
  const first = reconcile(completed.session, completed.capture);
  assert.equal(first.status, "COMPLETE");

  // A second, later outage: LOST again, then RESTORED again.
  const secondLoss = appendNetworkTransition(first.session, {
    runId: first.session.runId,
    observationId: "second-loss",
    adapterIdentity: TARGET_ADAPTER_IDENTITY,
    observationSource: PHYSICAL_SENTINEL_SOURCE,
    previousNetworkState: "CONNECTED",
    newNetworkState: "LOST",
    missionClockPosition: 130_000,
  });
  // preRestorationCapture is append-only for the life of the session (see
  // capturePreRestorationArtifacts's own guard) — it is not re-captured per
  // window. The identity this test is about is the receipt's, not the
  // capture's, so the original capture is reused rather than re-captured.
  const secondRestored = appendNetworkTransition(secondLoss.session, {
    runId: secondLoss.session.runId,
    observationId: "second-restoration",
    adapterIdentity: TARGET_ADAPTER_IDENTITY,
    observationSource: PHYSICAL_SENTINEL_SOURCE,
    previousNetworkState: "LOST",
    newNetworkState: "CONNECTED",
    missionClockPosition: 132_000,
  });
  const second = reconcile(secondRestored.session, completed.capture);
  assert.equal(second.status, "COMPLETE");
  assert.ok(second.receipt);
  assert.notEqual(second.receipt.receiptId, first.receipt?.receiptId, "a new outage must not reuse the prior receipt identity");
  const receiptCount = second.session.records.filter((r) => r.eventType === "RECONCILIATION_RECEIPT").length;
  assert.equal(receiptCount, 2, "two genuinely distinct cycles must produce two receipts");
});

// --- 7-11: identity/immutability invariants around the fix -----------------

test("D-006E 7: Mission ID is preserved through repeated reconciliation attempts", () => {
  const completed = completeOfflineSession();
  const first = reconcile(completed.session, completed.capture);
  const second = reconcile(first.session, completed.capture);
  assert.equal(first.session.missionId, MISSION_ID);
  assert.equal(second.session.missionId, MISSION_ID);
});

test("D-006E 8: Final Receipt digest is unchanged by a repeated call", () => {
  const completed = completeOfflineSession();
  const first = reconcile(completed.session, completed.capture);
  const second = reconcile(first.session, completed.capture);
  assert.equal(first.receipt?.finalReceiptRef, second.receipt?.finalReceiptRef);
  assert.equal(first.finalReceiptUnchanged, true);
  assert.equal(second.finalReceiptUnchanged, true);
});

test("D-006E 9: PEB digest is unchanged by a repeated call", () => {
  const completed = completeOfflineSession();
  const first = reconcile(completed.session, completed.capture);
  const second = reconcile(first.session, completed.capture);
  assert.equal(first.receipt?.pebDigest, second.receipt?.pebDigest);
  assert.equal(first.pebUnchanged, true);
  assert.equal(second.pebUnchanged, true);
});

test("D-006E 10: local verdict is unchanged by a repeated call", () => {
  const completed = completeOfflineSession();
  const first = reconcile(completed.session, completed.capture);
  const second = reconcile(first.session, completed.capture);
  assert.equal(first.receipt?.localVerdict, "INDETERMINATE");
  assert.equal(second.receipt?.localVerdict, "INDETERMINATE");
});

test("D-006E 11: causal order is unchanged and append-only across repeated calls", () => {
  const completed = completeOfflineSession();
  const first = reconcile(completed.session, completed.capture);
  const second = reconcile(first.session, completed.capture);
  assert.deepEqual(
    second.session.records.slice(0, first.session.records.length),
    first.session.records,
    "reconciliation may only ever append, never rewrite",
  );
});

// --- 12. appendRecord exactly-once invariant remains strict ----------------

test("D-006E 12: appendRecord's exactly-once invariant is not weakened", () => {
  // appendOfflineEvidence requires an active LOST window; exercised there,
  // not against a session that has already progressed past RESTORED.
  const lost = loss().session;
  const withEvent = appendOfflineEvidence(lost, {
    missionId: MISSION_ID,
    runId: lost.runId,
    eventId: "d006d.customer-drop-off",
    eventType: "CUSTOMER_DROP_OFF",
    receiptId: "NR-CUSTOMER-DROP-OFF",
    missionClockPosition: 36_000,
    executionLocality: "LOCAL",
    payload: {},
  }).session;
  assert.throws(
    () => appendOfflineEvidence(withEvent, {
      missionId: MISSION_ID,
      runId: withEvent.runId,
      eventId: "d006d.customer-drop-off", // reused on purpose
      eventType: "CUSTOMER_DROP_OFF",
      receiptId: "NR-SOMETHING-ELSE",
      missionClockPosition: 37_000,
      executionLocality: "LOCAL",
      payload: {},
    }),
    (error: unknown) => error instanceof OfflineEvidenceError && error.reasonCode === "DUPLICATE_CAUSAL_RECORD",
  );
});

// --- the evidence-derived helper used to self-heal the network machine ----

test("D-006E: window and evidence state read append-only truth, not a network alias", () => {
  const completed = completeOfflineSession();
  assert.equal(offlineWindowStatus(completed.session), "AWAITING_RECONCILIATION");
  assert.equal(evidenceState(completed.session), "LOCAL", "restoration alone is not reconciliation");
  const reconciled = reconcile(completed.session, completed.capture);
  assert.equal(offlineWindowStatus(reconciled.session), "RECONCILED");
  assert.equal(evidenceState(reconciled.session), "RECONCILED");
});

test("D-006E: a session with no network history is never treated as reconciled", () => {
  const session = createOfflineEvidenceSession(RUN_ID);
  assert.equal(offlineWindowStatus(session), "NONE");
  assert.equal(evidenceState(session), "LOCAL");
});

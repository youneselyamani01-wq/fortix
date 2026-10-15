import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import { blake3 } from "@noble/hashes/blake3.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

import { en } from "../../../site/src/i18n/locales/en.ts";
import { fr } from "../../../site/src/i18n/locales/fr.ts";
import { baseLedgerKey, memoryBaseStore, planBaseCompareTransfer, storageBaseStore, type BaseStore } from "../app/baseEvidence.ts";
import { appendHumanAuthorityDenial } from "../app/humanAuthorityEvidence.ts";
import { MISSION_ID } from "../app/missionContinuity.ts";
import type { EngineSnapshot } from "../app/nx/adapter/engineSnapshot.ts";
import { journalAt } from "../app/nx/adapter/missionJournal.ts";
import { derivePublicExperience } from "../app/nx/adapter/publicExperienceAdapter.ts";
import { humanPresentationTimeAtRest } from "../app/nx/experience/humanPacing.ts";
import { CHECK_CATEGORY, categoriesOf } from "../app/nx/verifier/choreography.ts";
import {
  IN_MISSION_RECONCILIATION_RESULT,
  canonicalRecordDigest,
  evidenceState,
  inMissionReconciliationBound,
  isInMissionReconciliationReceipt,
  isOfflineEvidenceSessionJournalValid,
  isSpecializedRecordProjectionValid,
  journalEvidenceLocality,
  journalNetworkState,
  offlineWindowStatus,
  reconcileInMissionOfflineEvidence,
  reconcileOfflineEvidence,
  type InMissionReconciliationReceipt,
  type OfflineCausalRecord,
  type OfflineEvidenceSession,
} from "../app/offlineEvidence.ts";
import { analyzeInsertedD006Peb, insertD006PebForAnalysis, verifyD006PortableMissionEvidence, type D006VerdictSnapshot } from "../app/offlineVerification.ts";
import { derivePassengerPresentation } from "../app/passengerPresentation.ts";
import { capturePreRestorationIfPossible, performReconciliation, type ReconciliationAttempt } from "../app/physicalLinkRuntime.ts";
import { derivePhysicalState } from "../app/physicalState.ts";
import {
  PortableMissionEvidenceError,
  buildMissionEvidenceClosure,
  finalReceiptRuntimeEvidencePrefix,
  transferredContentDigest,
  type HandoffArtifact,
  type PortableMissionEvidenceBundle,
} from "../app/portableMissionEvidence.ts";
import { deriveMissionFacts } from "../app/publicFacts.ts";
import { projectReceiptBindings } from "../app/receiptProjection.ts";
import { HUMAN_AUTHORITY_GATE_MS } from "../app/reviewFlow.ts";
import { CANONICAL_ROUTING_PROVENANCE, deriveRoutingState } from "../app/routingProvenance.ts";
import { EXPERIENCE_DURATION_MS, FINAL_RECEIPT_EMITTED_MS } from "../app/storyTimeline.ts";
import { derivePresentationMotion } from "../app/vehiclePresentation.ts";
import { canonicalString } from "../app/verification.ts";
import { factNetworkPosition } from "../app/verify/factInspection.ts";
import { networkContextNodeKeys } from "../app/verify/graphDisplay.ts";
import { inspectReceivedPeb } from "../app/verify/inspectReceivedPeb.ts";
import { createReceivedEvidenceCatalog } from "../app/verify/receivedEvidenceCatalog.ts";
import { projectReceivedGraph } from "../app/verify/receivedGraph.ts";
import { receivedEventLabel } from "../app/verify/receivedLabels.ts";
import { IN_MISSION_RECONCILIATION_CHECK, offlinePeriodOf, receivedNetworkModel, type ReceivedNetworkAnalysis } from "../app/verify/receivedNetwork.ts";
import { VISUAL_EVENTS } from "../app/visualEvents.ts";
import { InMissionRun, artifactsOf } from "./support/inMissionScenario.ts";

const componentLoader = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && context.parentURL && !/\.[a-z]+$/i.test(specifier)) {
      for (const extension of [".tsx", ".ts"]) {
        const url = new URL(`${specifier}${extension}`, context.parentURL);
        if (existsSync(url)) return nextResolve(url.href, context);
      }
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith(".css")) return { format: "module", source: "export {};", shortCircuit: true };
    if (url.endsWith(".tsx")) return {
      format: "module", shortCircuit: true,
      source: ts.transpileModule(readFileSync(new URL(url), "utf8"), {
        compilerOptions: { module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
        fileName: new URL(url).pathname,
      }).outputText,
    };
    return nextLoad(url, context);
  },
});
const { NetworkView, NetworkFactSummary } = await import("../app/verify/ReceivedNetworkView.tsx");
const { FactInspector } = await import("../app/verify/FactInspector.tsx");
const { RouteVerdict } = await import("../app/verify/VerifierRouteClient.tsx");
componentLoader.deregister();

/**
 * MANDATE D-006 — IN-MISSION OFFLINE RECONCILIATION.
 *
 * The central chain (§12) is `d006-inmission-central.test.ts`, written so it
 * also runs — and fails — against the previous contract. This suite holds
 * everything around it: the fundamental negative (§13), the twelve
 * fail-closed cases (§9), idempotence (§10), several outages (§11), several
 * interfaces (§8), the C1 boundary (§5), the Verifier (§6), the graph (§7),
 * the seal boundary and the edge timings. Every scenario is driven through
 * the same runtime the /nx hook uses (`tests/support/inMissionScenario.ts`).
 *
 * One invariant runs through all of it: RESTORED ≠ RECONCILED.
 */

const visible = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const digestOf = (value: unknown) => bytesToHex(blake3(utf8ToBytes(canonicalString(value))));
const linksForEntry = (entry: { nodeKey: string }) => ({ event: `/event/${entry.nodeKey}`, nanoreceipts: `/nr/${entry.nodeKey}`, graph: `/graph/${entry.nodeKey}`, forensic: `/forensic/${entry.nodeKey}`, network: "/network" });

/** CONNECTED → every route lost at 9 332 → business NanoReceipts while LOST → RESTORED, before any verdict. */
function restoredRun(tag: string, restoreAt = 15_900): InMissionRun {
  const run = new InMissionRun(`fortix.demo.d006.inmission.${tag}`);
  run.routes(true, false, 0);
  run.at(9_100);
  run.routes(false, false, 9_332);
  run.at(15_500);
  run.routes(true, false, restoreAt);
  return run;
}

function windowOf(session: OfflineEvidenceSession) {
  const lostIndex = session.records.findLastIndex((record) => record.eventType === "NETWORK_LINK_LOST");
  const restoredIndex = session.records.findLastIndex((record) => record.eventType === "NETWORK_LINK_RESTORED");
  return { lostIndex, restoredIndex, offline: session.records.slice(lostIndex + 1, restoredIndex) };
}

const withRecords = (session: OfflineEvidenceSession, records: readonly OfflineCausalRecord[]): OfflineEvidenceSession => ({ ...session, records });

/** A record changed and digested again: internally consistent, never what the engine wrote. */
function reDigested<T extends OfflineCausalRecord>(record: T, change: Partial<T>, payload: Record<string, unknown> = {}): T {
  const changed = { ...record, ...change, payload: { ...record.payload, ...payload } } as T;
  return { ...changed, canonicalDigest: canonicalRecordDigest(changed) };
}

function assertRefused(attempt: ReconciliationAttempt, session: OfflineEvidenceSession, reason: string) {
  assert.equal(attempt.result.status, "FAILED", "no COMPLETE");
  assert.equal(attempt.result.receipt, null, "no receipt");
  assert.ok(attempt.result.reasonCodes.includes(reason as never), `${reason} in ${attempt.result.reasonCodes.join(",")}`);
  assert.equal(attempt.result.session, session, "nothing appended");
  assert.ok(!attempt.result.session.records.some((record) => record.eventType === "RECONCILIATION_RECEIPT"));
}

function received(text: string, analysis?: ReceivedNetworkAnalysis | null) {
  const peb = inspectReceivedPeb(text);
  const graph = projectReceivedGraph(peb, text);
  const catalog = createReceivedEvidenceCatalog(graph, "fr", text);
  return { peb, graph, catalog, model: receivedNetworkModel(catalog, text, analysis) };
}

async function analyse(handoff: HandoffArtifact): Promise<D006VerdictSnapshot> {
  return analyzeInsertedD006Peb(insertD006PebForAnalysis({
    pebText: handoff.pebText,
    expectedIdentity: handoff.identity,
    expectedTransferredContentDigest: handoff.transferredContentDigest,
  }));
}

/** The PEB re-packaged around other runtime records, with its bundle digest recomputed (an attacker's envelope). */
function repackaged(peb: PortableMissionEvidenceBundle, runtimeRecords: readonly OfflineCausalRecord[]) {
  const draft = { ...peb, runtimeRecords };
  const bundleDigest = digestOf({ ...draft, manifest: { ...draft.manifest, bundleDigest: "" } });
  const text = canonicalString({ ...draft, manifest: { ...draft.manifest, bundleDigest } });
  return { text, transferred: transferredContentDigest(text) };
}

function closureError(records: readonly OfflineCausalRecord[], runId: string): string | null {
  try {
    buildMissionEvidenceClosure({ identity: { missionId: MISSION_ID, runId }, runtimeRecords: records, asOfMasterTimeMs: FINAL_RECEIPT_EMITTED_MS });
    return null;
  } catch (error) {
    return error instanceof PortableMissionEvidenceError ? error.reasonCode : `NON_C1:${String(error)}`;
  }
}

/** The /nx public model, as the hook's snapshot would carry it. */
function nxModel(session: OfflineEvidenceSession, masterTimeMs: number, overrides: Partial<EngineSnapshot> = {}, presentationTimeMs?: number) {
  const records = session.finalReceiptRuntimeSeal === null ? session.records : finalReceiptRuntimeEvidencePrefix(session);
  const closure = buildMissionEvidenceClosure({ identity: { missionId: MISSION_ID, runId: session.runId }, runtimeRecords: records, asOfMasterTimeMs: FINAL_RECEIPT_EMITTED_MS });
  const physical = derivePhysicalState(masterTimeMs, true);
  const snapshot: EngineSnapshot = {
    masterTimeMs, effectiveStoryTimeMs: masterTimeMs, playing: false, session, closure, closureReason: null,
    receiptBindings: projectReceiptBindings(closure, VISUAL_EVENTS), finalReceipt: null, humanDecision: "PENDING",
    networkState: session.networkState, linkObservationCurrent: true, linkPhase: session.networkState, sentinelReachable: true, transitionFlash: null,
    unsequencedObservation: null, reconciliation: null, baseTransfer: null, syncPhase: "IDLE", portablePeb: null, handoffArtifact: null,
    transferStage: "SOURCE", analysisRequested: false, verification: null, handoffNetworkState: null, verdictNetworkState: null,
    physical, motion: derivePresentationMotion(masterTimeMs, true), passenger: derivePassengerPresentation(masterTimeMs, physical.passengerState),
    routing: deriveRoutingState(masterTimeMs, CANONICAL_ROUTING_PROVENANCE),
    ...overrides,
  };
  return derivePublicExperience(snapshot, presentationTimeMs);
}

function fakeStorage(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  return { items, getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => { items.set(key, value); } };
}

// ---------------------------------------------------------------------------
// §13 — the fundamental negative
// ---------------------------------------------------------------------------

test("§13 connectivity recovery is not evidence recovery: an integrity failure leaves the network CONNECTED and the evidence LOCAL", async () => {
  const run = restoredRun("integrity");
  const store = memoryBaseStore(run.runId);
  // The base holds the journal's first record under another digest: not this journal's prefix.
  store.write({ missionId: run.session.missionId, runId: run.runId, records: [{ ...run.session.records[0]!, canonicalDigest: "0".repeat(64) }] });
  const before = canonicalString(store.read());
  const attempt = run.reconcile(store, 15_900);
  assert.equal(attempt.result.status, "FAILED");
  assert.equal(attempt.result.receipt, null);
  assert.equal(run.session.networkState, "CONNECTED", "the network is back");
  assert.equal(journalNetworkState(run.session), "CONNECTED");
  assert.equal(offlineWindowStatus(run.session), "AWAITING_RECONCILIATION", "the evidence is not reconciled");
  assert.equal(evidenceState(run.session), "LOCAL");
  assert.equal(journalEvidenceLocality(run.session), "LOCAL");
  assert.ok(!run.session.records.some((record) => record.eventType === "RECONCILIATION_RECEIPT"));
  assert.equal(canonicalString(store.read()), before, "a refused base is left exactly as it was");

  // The PEB says the same thing: the network returned, the reconciliation is not established.
  run.at(EXPERIENCE_DURATION_MS);
  const { handoff } = artifactsOf(run.session);
  const analysis = await analyse(handoff);
  assert.ok(!analysis.result.completedChecks.includes(IN_MISSION_RECONCILIATION_CHECK));
  const { model } = received(handoff.pebText, analysis);
  assert.equal(model.finalState, "CONNECTED");
  assert.notEqual(model.periods[0]!.restored, null);
  assert.equal(model.periods[0]!.reconciliation.status, "NOT_ESTABLISHED");
  assert.equal(model.periods[0]!.reconciliation.reason, "NO_RECONCILIATION_RECORD");
});

// ---------------------------------------------------------------------------
// §9 — fail-closed: no false RECONCILED
// ---------------------------------------------------------------------------

test("§9 fail-closed · altered local digest", () => {
  const run = restoredRun("altered-digest");
  const { lostIndex } = windowOf(run.session);
  const tampered = withRecords(run.session, run.session.records.map((record, index) => index === lostIndex + 2 ? { ...record, canonicalDigest: "f".repeat(64) } : record));
  const store = memoryBaseStore(run.runId);
  assertRefused(performReconciliation({ session: tampered, baseStore: store, artifacts: null, masterTimeMs: 15_900 }), tampered, "LOCAL_DIGEST_MISMATCH");
  assert.equal(store.read(), null, "the base never received the altered journal");
});

test("§9 fail-closed · inconsistent offline journal", () => {
  const run = restoredRun("inconsistent-journal");
  const { lostIndex } = windowOf(run.session);
  const records = [...run.session.records];
  [records[lostIndex + 1], records[lostIndex + 2]] = [records[lostIndex + 2]!, records[lostIndex + 1]!];
  const reordered = withRecords(run.session, records);
  const store = memoryBaseStore(run.runId);
  assertRefused(performReconciliation({ session: reordered, baseStore: store, artifacts: null, masterTimeMs: 15_900 }), reordered, "CAUSAL_ORDER_MISMATCH");
  assert.equal(store.read(), null);
});

test("§9 fail-closed · missing object, in the journal or in the base", () => {
  const run = restoredRun("missing-object");
  const { lostIndex } = windowOf(run.session);
  const missing = withRecords(run.session, run.session.records.filter((_, index) => index !== lostIndex + 3));
  const store = memoryBaseStore(run.runId);
  assertRefused(performReconciliation({ session: missing, baseStore: store, artifacts: null, masterTimeMs: 15_900 }), missing, "CAUSAL_ORDER_MISMATCH");
  assert.equal(store.read(), null);

  // A base-after that silently lacks one offline object.
  const plan = planBaseCompareTransfer(run.session, memoryBaseStore(`${run.runId}.plan`));
  assert.ok(plan !== null && plan.kind === "PLANNED");
  const dropped = run.session.records[lostIndex + 3]!.receiptId;
  const operation = {
    ...plan.outcome.operation,
    baseAfter: { ...plan.outcome.operation.baseAfter, records: plan.outcome.operation.baseAfter.records.filter((record) => record.receiptId !== dropped) },
    transferredReceiptIds: plan.outcome.operation.transferredReceiptIds.filter((id) => id !== dropped),
  };
  const result = reconcileInMissionOfflineEvidence({ session: run.session, operation, observedMasterTimeMs: 15_900 });
  assert.equal(result.status, "FAILED");
  assert.ok(result.reasonCodes.includes("BASE_OBJECTS_MISSING"), result.reasonCodes.join(","));
  assert.equal(result.session, run.session);
});

test("§9 fail-closed · object added after the checkpoint", () => {
  // The mission moved on before reconciliation ran: what follows RESTORED is not this window's.
  const run = restoredRun("after-checkpoint");
  const { restoredIndex, offline } = windowOf(run.session);
  run.at(47_000);
  const later = run.session.records.slice(restoredIndex + 1);
  assert.ok(later.length > 0, "records authored after the checkpoint exist");
  const store = memoryBaseStore(run.runId);
  const attempt = run.reconcile(store, 47_000);
  assert.equal(attempt.result.status, "COMPLETE", attempt.result.reasonCodes.join(","));
  const receipt = attempt.result.receipt as InMissionReconciliationReceipt;
  assert.equal(receipt.localObjectCount, restoredIndex + 1, "the checkpoint ends at NR-NET-RESTORED");
  assert.deepEqual(receipt.offlineObjectIds, offline.map((record) => record.receiptId));
  for (const record of later) {
    assert.ok(!receipt.transferredObjectIds.includes(record.receiptId), `${record.receiptId} is not part of this window`);
    assert.ok(!receipt.offlineObjectIds.includes(record.receiptId));
  }
  assert.equal(store.read()?.records.length, restoredIndex + 1, "the base holds the checkpoint, nothing after it");
  assert.equal(journalEvidenceLocality(run.session), "LOCAL", "later evidence is still LOCAL");

  // A base that already holds an object the checkpoint does not contain is not this window's base.
  const other = restoredRun("after-checkpoint-base");
  const window = windowOf(other.session);
  other.at(47_000);
  const foreignStore = memoryBaseStore(other.runId);
  foreignStore.write({ missionId: other.session.missionId, runId: other.runId, records: other.session.records.slice(0, window.restoredIndex + 2) });
  const before = canonicalString(foreignStore.read());
  const refused = other.reconcile(foreignStore, 47_000);
  assert.equal(refused.result.status, "FAILED");
  assert.equal(refused.performed?.refusalReason, "BASE_NOT_CAUSAL_PREFIX");
  assert.equal(canonicalString(foreignStore.read()), before);

  // A receipt that names a later object as offline is not bound.
  const index = run.session.records.indexOf(receipt);
  const forged = reDigested(receipt, { offlineObjectIds: [...receipt.offlineObjectIds, later[0]!.receiptId] }, { offline_object_ids: [...receipt.offlineObjectIds, later[0]!.receiptId] });
  const records = [...run.session.records]; records[index] = forged;
  assert.equal(inMissionReconciliationBound(records, index, run.session.missionId, run.runId), false);
});

test("§9 fail-closed · wrong offline period", () => {
  const run = restoredRun("wrong-period");
  const plan = planBaseCompareTransfer(run.session, memoryBaseStore(run.runId));
  assert.ok(plan !== null && plan.kind === "PLANNED");
  const result = reconcileInMissionOfflineEvidence({
    session: run.session,
    operation: { ...plan.outcome.operation, operationId: "BCT:NR-NET-LOST:another-window:NR-NET-RESTORED:another-window" },
    observedMasterTimeMs: 15_900,
  });
  assert.equal(result.status, "FAILED");
  assert.ok(result.reasonCodes.includes("OFFLINE_WINDOW_INVALID"), result.reasonCodes.join(","));
  assert.equal(result.session, run.session);
});

test("§9 fail-closed · wrong Mission ID", () => {
  const run = restoredRun("wrong-mission");
  const storage = fakeStorage();
  const key = baseLedgerKey(run.runId);
  storage.setItem(key, JSON.stringify({ missionId: "fortix.demo.another-mission", runId: run.runId, records: [] }));
  const before = storage.getItem(key);
  const attempt = run.reconcile(storageBaseStore(storage, MISSION_ID, run.runId), 15_900);
  assert.equal(attempt.result.status, "FAILED");
  assert.ok(attempt.result.reasonCodes.includes("MISSION_ID_MISMATCH"), attempt.result.reasonCodes.join(","));
  assert.equal(attempt.performed?.refusalReason, "BASE_IDENTITY_MISMATCH");
  assert.equal(storage.getItem(key), before, "another mission's base is reported, never overwritten");
  assert.equal(offlineWindowStatus(run.session), "AWAITING_RECONCILIATION");

  // The binding itself is identity-scoped.
  const ok = restoredRun("wrong-mission-bound");
  const attemptOk = ok.reconcile(memoryBaseStore(ok.runId), 15_900);
  const index = ok.session.records.indexOf(attemptOk.result.receipt!);
  assert.equal(inMissionReconciliationBound(ok.session.records, index, ok.session.missionId, ok.runId), true);
  assert.equal(inMissionReconciliationBound(ok.session.records, index, "fortix.demo.another-mission", ok.runId), false);
  assert.equal(inMissionReconciliationBound(ok.session.records, index, ok.session.missionId, "fortix.demo.another-run"), false);
});

test("§9 fail-closed · duplicated attempt: one receipt, never a second lifecycle", () => {
  const run = restoredRun("duplicate");
  const store = memoryBaseStore(run.runId);
  const pending = run.session;
  const first = performReconciliation({ session: pending, baseStore: store, artifacts: null, masterTimeMs: 15_900 });
  const racing = performReconciliation({ session: pending, baseStore: store, artifacts: null, masterTimeMs: 15_900 });
  assert.equal(first.result.status, "COMPLETE");
  assert.equal(racing.result.status, "FAILED", "a second attempt from the same pre-state cannot author a second receipt");
  assert.ok(racing.result.reasonCodes.includes("TRANSFER_ACCOUNTING_MISMATCH"), racing.result.reasonCodes.join(","));
  assert.equal(racing.result.session, pending);
  const stored = canonicalString(store.read());
  const again = performReconciliation({ session: first.result.session, baseStore: store, artifacts: null, masterTimeMs: 16_000 });
  assert.equal(again.result.status, "COMPLETE");
  assert.equal(again.result.receipt?.receiptId, first.result.receipt?.receiptId);
  assert.equal(again.result.session, first.result.session, "the reconciled journal is recognised, not re-written");
  assert.equal(again.performed?.transferred, false, "nothing is transferred twice");
  assert.equal(canonicalString(store.read()), stored);
  assert.equal(first.result.session.records.filter((record) => record.eventType === "RECONCILIATION_RECEIPT").length, 1);
});

test("§9 fail-closed · replay of a receipt", () => {
  const run = restoredRun("replay");
  const store = memoryBaseStore(run.runId);
  run.reconcile(store, 15_900);
  const receipt = run.session.records.at(-1)!;
  // The same receipt appended again, re-chained and re-digested.
  const replayed = reDigested(receipt, { causalPredecessors: [receipt.receiptId], missionClockPosition: receipt.missionClockPosition + 1 });
  const twice = withRecords(run.session, [...run.session.records, replayed]);
  assert.equal(isOfflineEvidenceSessionJournalValid(twice), false);
  // In C1 the binding is checked before the generic duplicate rule: a second copy
  // of an in-mission receipt is, first of all, not bound to its journal.
  assert.equal(closureError(twice.records, run.runId), "RUNTIME_RECONCILIATION_UNBOUND");

  // Window #1's receipt replayed into window #2: it names the wrong window.
  run.at(17_000);
  run.routes(false, false, 17_100);
  run.routes(true, false, 17_300);
  assert.equal(offlineWindowStatus(run.session), "AWAITING_RECONCILIATION");
  const last = run.session.records.at(-1)!;
  const moved = reDigested(receipt, { causalPredecessors: [last.receiptId], missionClockPosition: last.missionClockPosition + 1 });
  const replayedJournal = withRecords(run.session, [...run.session.records, moved]);
  assert.notEqual(offlineWindowStatus(replayedJournal), "RECONCILED");
  assert.equal(inMissionReconciliationBound(replayedJournal.records, replayedJournal.records.length - 1, run.session.missionId, run.runId), false);
  assert.notEqual(closureError(replayedJournal.records, run.runId), null);
});

test("§9 fail-closed · forged reconciliation receipt: refused by the journal, C1, the verifier and the Verifier", async () => {
  const run = restoredRun("forged");
  run.reconcile(memoryBaseStore(run.runId), 15_900);
  const index = run.session.records.length - 1;
  const receipt = run.session.records[index] as InMissionReconciliationReceipt;
  run.at(EXPERIENCE_DURATION_MS);
  const { handoff } = artifactsOf(run.session);
  const analysis = await analyse(handoff);

  // Tier 1 — fields changed, digest left stale.
  const stale = { ...receipt, transferredObjectCount: 0, payload: { ...receipt.payload, transferred_object_count: 0 } };
  const staleRecords = run.session.records.map((record, position) => position === index ? stale : record);
  assert.equal(closureError(staleRecords, run.runId), "RUNTIME_RECORD_DIGEST_MISMATCH");

  // Tier 2 — a re-digested receipt claiming the base already held everything (nothing moved).
  const allIds = run.session.records.slice(0, receipt.localObjectCount).map((record) => record.receiptId);
  assert.equal(allIds.length, receipt.localObjectCount);
  const forged = reDigested(receipt, {
    transferredObjectIds: [], transferredObjectCount: 0, baseMissingObjectCount: 0, baseBeforeDigest: receipt.baseAfterDigest,
  }, { transferred_object_ids: [], transferred_object_count: 0, base_missing_object_count: 0, base_before_digest: receipt.baseAfterDigest });
  const forgedRecords = run.session.records.map((record, position) => position === index ? forged : record);
  assert.equal(isOfflineEvidenceSessionJournalValid(withRecords(run.session, forgedRecords)), false, "the journal replay refuses it");
  assert.equal(inMissionReconciliationBound(forgedRecords, index, run.session.missionId, run.runId), false);
  assert.equal(closureError(forgedRecords, run.runId), "RUNTIME_RECONCILIATION_UNBOUND");
  const sealedCount = run.session.finalReceiptRuntimeSeal!.sealedRecordCount;
  const forgedPeb = repackaged(handoff.peb, forgedRecords.slice(0, sealedCount));
  const forgedResult = await verifyD006PortableMissionEvidence(forgedPeb.text, { expectedIdentity: handoff.identity, expectedTransferredContentDigest: forgedPeb.transferred });
  assert.equal(forgedResult.verdict, "INVALID");
  assert.deepEqual(forgedResult.reasonCodes, ["D006_RUNTIME_RECONCILIATION_UNBOUND"]);
  const forgedView = received(forgedPeb.text, { transferredContentDigest: forgedPeb.transferred, result: forgedResult }).model;
  assert.equal(forgedView.periods[0]!.reconciliation.status, "NOT_ESTABLISHED");
  assert.equal(forgedView.periods[0]!.reconciliation.reason, "RECONCILIATION_UNBOUND");
  // The honest analysis of the ORIGINAL bytes cannot lend itself to the forged bytes.
  const borrowed = received(forgedPeb.text, analysis).model;
  assert.notEqual(borrowed.periods[0]!.reconciliation.status, "ESTABLISHED");

  // Tier 3 — the same edit inside the original envelope: the transfer digest no longer matches.
  const edited = handoff.pebText.replace(`"base_before_digest":"${receipt.baseBeforeDigest}"`, `"base_before_digest":"${receipt.baseAfterDigest}"`);
  assert.notEqual(edited, handoff.pebText);
  const editedResult = await verifyD006PortableMissionEvidence(edited, { expectedIdentity: handoff.identity, expectedTransferredContentDigest: handoff.transferredContentDigest });
  assert.deepEqual(editedResult.reasonCodes, ["D006_PEB_TRANSFER_DIGEST_MISMATCH"]);
});

test("§9 fail-closed · incomplete transfer: a base that does not read back the after-snapshot", () => {
  const swallowing: BaseStore = { read: () => null, readStrict: () => ({ status: "ABSENT" }), write: () => {} };
  const run = restoredRun("incomplete-swallow");
  const pending = run.session;
  const attempt = run.reconcile(swallowing, 15_900);
  assertRefused(attempt, journalAt(pending, 15_900), "BASE_WRITE_UNCONFIRMED");
  assert.equal(attempt.performed?.refusalReason, "BASE_WRITE_UNCONFIRMED");
  assert.equal(attempt.performed?.transferred, false);
  assert.equal(offlineWindowStatus(run.session), "AWAITING_RECONCILIATION");

  let kept: { missionId: string; runId: string; records: readonly OfflineCausalRecord[] } | null = null;
  const truncating: BaseStore = {
    read: () => kept,
    write: (snapshot) => { kept = { ...snapshot, records: snapshot.records.slice(0, Math.floor(snapshot.records.length / 2)) }; },
  };
  const truncated = restoredRun("incomplete-truncate");
  assert.equal(truncated.reconcile(truncating, 15_900).result.reasonCodes.join(","), "BASE_WRITE_UNCONFIRMED");
  assert.ok(!truncated.session.records.some((record) => record.eventType === "RECONCILIATION_RECEIPT"));

  const quota = fakeStorage();
  const full = { getItem: quota.getItem, setItem: () => { throw new DOMException("quota", "QuotaExceededError"); } };
  const exhausted = restoredRun("incomplete-quota");
  assert.equal(exhausted.reconcile(storageBaseStore(full, MISSION_ID, exhausted.runId), 15_900).result.reasonCodes.join(","), "BASE_WRITE_UNCONFIRMED");
  assert.equal(offlineWindowStatus(exhausted.session), "AWAITING_RECONCILIATION");
});

test("§9 fail-closed · incompatible remote base", () => {
  // Foreign records: not a causal prefix of this journal.
  const run = restoredRun("incompatible-foreign");
  const foreign = restoredRun("incompatible-other-run");
  const store = memoryBaseStore(run.runId);
  store.write({ missionId: run.session.missionId, runId: run.runId, records: foreign.session.records.slice(0, 3) });
  const before = canonicalString(store.read());
  const attempt = run.reconcile(store, 15_900);
  assert.equal(attempt.result.status, "FAILED");
  assert.equal(attempt.performed?.refusalReason, "BASE_NOT_CAUSAL_PREFIX");
  assert.equal(canonicalString(store.read()), before);

  // Unreadable bytes are reported, never read as an empty base.
  const malformed = restoredRun("incompatible-malformed");
  const storage = fakeStorage({ [baseLedgerKey(malformed.runId)]: "{not json" });
  const refused = malformed.reconcile(storageBaseStore(storage, MISSION_ID, malformed.runId), 15_900);
  assert.deepEqual(refused.result.reasonCodes, ["BASE_UNREADABLE"]);
  assert.equal(refused.performed, null);
  assert.equal(storage.getItem(baseLedgerKey(malformed.runId)), "{not json", "never overwritten");

  // A base that already claims what was authored offline is not this window's base.
  const claimed = restoredRun("incompatible-claimed");
  const claimedStore = memoryBaseStore(claimed.runId);
  claimedStore.write({ missionId: claimed.session.missionId, runId: claimed.runId, records: claimed.session.records.slice(0, windowOf(claimed.session).restoredIndex + 1) });
  const claimedAttempt = claimed.reconcile(claimedStore, 15_900);
  assert.equal(claimedAttempt.result.status, "FAILED");
  assert.ok(claimedAttempt.result.reasonCodes.includes("TRANSFER_ACCOUNTING_MISMATCH"), claimedAttempt.result.reasonCodes.join(","));
});

test("§9 fail-closed · crypto exception: a FAILED result, never a throw, never a receipt", async () => {
  // A base record that cannot be put in canonical form.
  const run = restoredRun("crypto-base");
  const first = run.session.records[0]!;
  const poisoned = { ...first, payload: { ...first.payload, poison: Number.NaN } };
  const store = memoryBaseStore(run.runId);
  store.write({ missionId: run.session.missionId, runId: run.runId, records: [poisoned as OfflineCausalRecord] });
  const attempt = run.reconcile(store, 15_900);
  assert.equal(attempt.result.status, "FAILED");
  assert.ok(attempt.result.reasonCodes.includes("DIGEST_COMPUTATION_FAILED"), attempt.result.reasonCodes.join(","));
  assert.equal(attempt.result.receipt, null);

  // A store that throws on read, or on write.
  const throwingRead: BaseStore = { read: () => { throw new Error("io"); }, readStrict: () => { throw new Error("io"); }, write: () => {} };
  assert.deepEqual(restoredRun("crypto-read").reconcile(throwingRead, 15_900).result.reasonCodes, ["BASE_UNREADABLE"]);
  const throwingWrite: BaseStore = { read: () => null, write: () => { throw new Error("io"); } };
  assert.deepEqual(restoredRun("crypto-write").reconcile(throwingWrite, 15_900).result.reasonCodes, ["BASE_WRITE_UNCONFIRMED"]);

  // The binding predicate is total.
  const bound = inMissionReconciliationBound as unknown as (...args: unknown[]) => boolean;
  assert.equal(bound(null, 0, MISSION_ID, "run"), false);
  assert.equal(bound([{ eventType: "RECONCILIATION_RECEIPT", payload: null }], 0, MISSION_ID, "run"), false);
  assert.equal(bound([], -1, MISSION_ID, "run"), false);

  // A PEB carrying a number JSON cannot round-trip (1e400 → Infinity): no throw anywhere, nothing established.
  const ok = restoredRun("crypto-peb");
  ok.reconcile(memoryBaseStore(ok.runId), 15_900);
  ok.at(EXPERIENCE_DURATION_MS);
  const { handoff } = artifactsOf(ok.session);
  const text = handoff.pebText.replace('"observed_master_time_ms":15900', '"observed_master_time_ms":1e400');
  assert.notEqual(text, handoff.pebText);
  const result = await verifyD006PortableMissionEvidence(text, { expectedIdentity: handoff.identity, expectedTransferredContentDigest: transferredContentDigest(text) });
  assert.equal(result.verdict, "INVALID");
  assert.deepEqual(result.reasonCodes, ["D006_PEB_TEXT_INVALID"], "refused as bytes, never thrown on");
  const { model } = received(text, { transferredContentDigest: transferredContentDigest(text), result });
  assert.notEqual(model.reconciliation.status, "ESTABLISHED");
  assert.equal(model.periods[0]!.reconciliation.reason, "RECONCILIATION_UNBOUND");
});

// ---------------------------------------------------------------------------
// §10 — idempotence · §11 — several outages · §8 — several interfaces
// ---------------------------------------------------------------------------

test("§10 idempotence: a later interface event finds the window reconciled; nothing is duplicated, even after the seal", () => {
  const run = restoredRun("idempotence");
  const store = memoryBaseStore(run.runId);
  const first = run.reconcile(store, 15_900);
  assert.equal(first.result.status, "COMPLETE");
  const reconciled = run.session;
  const stored = canonicalString(store.read());
  // A new interface event: Wi-Fi joins while RJ45 stays up — no network NanoReceipt.
  assert.deepEqual(run.routes(true, true, 16_000).transitions, []);
  const again = run.reconcile(store, 16_000);
  assert.equal(again.result.status, "COMPLETE");
  assert.equal(again.result.receipt?.receiptId, first.result.receipt?.receiptId);
  assert.deepEqual(run.session.records.map((record) => record.receiptId), journalAt(reconciled, 16_000).records.map((record) => record.receiptId));
  assert.equal(canonicalString(store.read()), stored);
  // After the seal the same window is still recognised — before any seal check.
  run.at(EXPERIENCE_DURATION_MS);
  const sealed = run.session;
  const late = run.reconcile(store, EXPERIENCE_DURATION_MS);
  assert.equal(late.result.status, "COMPLETE");
  assert.equal(late.result.session, sealed);
  assert.equal(sealed.records.filter((record) => record.eventType === "RECONCILIATION_RECEIPT").length, 1);
  // The post-completion entry never re-describes an in-mission window.
  const legacy = reconcileOfflineEvidence({ session: sealed, operation: late.performed!.operation, capture: null, currentArtifacts: null });
  assert.equal(legacy.status, "FAILED");
  assert.ok(legacy.reasonCodes.includes("RECONCILIATION_OPERATION_CONFLICT"));
});

test("§11 two outages: each is reconciled on its own, the second never rewrites the first, both reach the PEB", async () => {
  const run = new InMissionRun("fortix.demo.d006.inmission.two-outages");
  run.routes(true, false, 0);
  run.at(9_100);
  run.routes(false, false, 9_332);
  run.at(11_000);
  run.routes(true, false, 11_200);
  const firstWindow = windowOf(run.session);
  const store = memoryBaseStore(run.runId);
  const first = run.reconcile(store, 11_200);
  assert.equal(first.result.status, "COMPLETE");
  const receipt1 = first.result.receipt as InMissionReconciliationReceipt;
  const prefix1 = run.session.records.map((record) => record.canonicalDigest);

  run.at(12_100);
  run.routes(false, false, 12_200);
  run.at(14_000);
  run.routes(true, false, 14_200);
  const secondWindow = windowOf(run.session);
  const second = run.reconcile(store, 14_200);
  assert.equal(second.result.status, "COMPLETE");
  const receipt2 = second.result.receipt as InMissionReconciliationReceipt;

  assert.notEqual(receipt1.receiptId, receipt2.receiptId, "each window has its own receipt");
  assert.ok(firstWindow.offline.length >= 2 && secondWindow.offline.length >= 2, "A/B, then C/D");
  assert.deepEqual(receipt1.offlineObjectIds, firstWindow.offline.map((record) => record.receiptId));
  assert.deepEqual(receipt2.offlineObjectIds, secondWindow.offline.map((record) => record.receiptId));
  assert.ok(receipt2.offlineObjectIds.every((id) => !receipt1.offlineObjectIds.includes(id)), "the periods stay distinguishable");
  assert.equal(receipt2.baseBeforeDigest, receipt1.baseAfterDigest, "window #2 starts from the base window #1 left");
  assert.ok(receipt2.transferredObjectIds.includes(receipt1.receiptId), "the first receipt itself reaches the base with the second window");
  assert.deepEqual(run.session.records.slice(0, prefix1.length).map((record) => record.canonicalDigest), prefix1, "#2 rewrites nothing of #1");
  const index1 = run.session.records.indexOf(receipt1);
  assert.equal(inMissionReconciliationBound(run.session.records, index1, run.session.missionId, run.runId), true);
  assert.equal(offlineWindowStatus(run.session), "RECONCILED");

  run.at(EXPERIENCE_DURATION_MS);
  const { handoff } = artifactsOf(run.session);
  assert.deepEqual(handoff.peb.runtimeRecords.filter((record) => record.eventType === "RECONCILIATION_RECEIPT").map((record) => record.receiptId), [receipt1.receiptId, receipt2.receiptId]);
  const analysis = await analyse(handoff);
  assert.ok(analysis.result.completedChecks.includes(IN_MISSION_RECONCILIATION_CHECK));
  const { model } = received(handoff.pebText, analysis);
  assert.deepEqual(model.periods.map((period) => period.reconciliation.status), ["ESTABLISHED", "ESTABLISHED"]);
  assert.deepEqual(model.periods.map((period) => period.reconciliation.receipt?.receiptId), [receipt1.receiptId, receipt2.receiptId]);
  assert.deepEqual(model.periods.map((period) => period.reconciledEntryCount), [firstWindow.offline.length, secondWindow.offline.length]);
  assert.equal(model.reconciliation.status, "ESTABLISHED");
});

test("§8 several interfaces: a route switch is never a loss; all routes down is; one route back reconciles in mission", () => {
  const run = new InMissionRun("fortix.demo.d006.inmission.interfaces");
  assert.deepEqual(run.routes(true, true, 0), { transitions: [], state: "CONNECTED" });
  run.at(9_100);
  assert.deepEqual(run.routes(false, true, 9_150), { transitions: [], state: "CONNECTED" }, "RJ45 lost, Wi-Fi up: CONNECTED, no LOST");
  assert.deepEqual(run.routes(true, false, 9_200), { transitions: [], state: "CONNECTED" }, "Wi-Fi lost, RJ45 up: CONNECTED, no LOST");
  assert.equal(run.session.records.filter((record) => record.eventType.startsWith("NETWORK_")).length, 0, "no false LOST on a switch");
  assert.deepEqual(run.routes(false, false, 9_400), { transitions: ["LOST"], state: "LOST" }, "every route down: LOST");
  run.at(12_000);
  assert.deepEqual(run.routes(false, true, 12_100), { transitions: ["RESTORED"], state: "CONNECTED" }, "one route really back: RESTORED → CONNECTED");
  assert.equal(run.session.records.at(-1)?.payload.adapter_identity, "Intel(R) Wi-Fi 7 BE200 320MHz");
  assert.equal(offlineWindowStatus(run.session), "AWAITING_RECONCILIATION", "RESTORED alone ≠ RECONCILED");
  const attempt = run.reconcile(memoryBaseStore(run.runId), 12_100);
  assert.equal(attempt.result.status, "COMPLETE");
  assert.equal(offlineWindowStatus(run.session), "RECONCILED");
});

// ---------------------------------------------------------------------------
// §2 B — the seal boundary · timing edges · the authority gate
// ---------------------------------------------------------------------------

test("§2 B after the seal: a late restoration never reaches back into the PEB; the post-verdict path is unchanged", async () => {
  const build = (tag: string) => {
    const run = restoredRun(tag);
    const store = memoryBaseStore(run.runId);
    assert.equal(run.reconcile(store, 15_900).result.status, "COMPLETE");
    run.at(100_000);
    run.routes(false, false, 100_000);
    run.at(EXPERIENCE_DURATION_MS);
    return { run, store, sealed: artifactsOf(run.session).handoff };
  };

  // No verdict captured: the late restoration fails as it always did, journal-only.
  const { run, store, sealed } = build("after-seal");
  run.routes(true, false, EXPERIENCE_DURATION_MS);
  const late = run.reconcile(store, EXPERIENCE_DURATION_MS);
  assert.equal(late.result.status, "FAILED");
  assert.ok(late.result.reasonCodes.includes("ARTIFACT_STATE_INVALID"));
  assert.equal(canonicalString(artifactsOf(run.session).handoff.peb), canonicalString(sealed.peb), "the sealed PEB is never modified");

  // A verdict captured while LOST: the post-completion receipt, journal-only, PEB unchanged.
  const legacy = build("after-seal-verdict");
  const verdict = await analyse(legacy.sealed);
  legacy.run.session = capturePreRestorationIfPossible(legacy.run.session, legacy.sealed, verdict, EXPERIENCE_DURATION_MS);
  assert.notEqual(legacy.run.session.preRestorationCapture, null);
  legacy.run.routes(true, false, EXPERIENCE_DURATION_MS);
  const completed = performReconciliation({ session: legacy.run.session, baseStore: legacy.store, artifacts: { finalReceipt: { ref: legacy.sealed.finalReceipt.receiptId, value: legacy.sealed.finalReceipt as never }, portableEvidenceBundle: { ref: legacy.sealed.peb.bundleId, value: legacy.sealed.peb as never }, verdict: verdict.result.verdict }, masterTimeMs: EXPERIENCE_DURATION_MS });
  assert.equal(completed.result.status, "COMPLETE", completed.result.reasonCodes.join(","));
  assert.equal(isInMissionReconciliationReceipt(completed.result.receipt), false, "the post-completion variant");
  assert.equal(completed.result.receipt?.verdictUnchanged, true);
  assert.equal(canonicalString(artifactsOf(completed.result.session).handoff.peb), canonicalString(legacy.sealed.peb));
  const model = nxModel(completed.result.session, EXPERIENCE_DURATION_MS, { reconciliation: completed.result, baseTransfer: completed.performed });
  assert.equal(model.network.verdictUnchanged, true, "read from the post-completion receipt");
  assert.equal(model.network.reconciliationReceiptId, completed.result.receipt?.receiptId, "the latest receipt names the band");

  // In the PEB: period 1 reconciled in mission; period 2 still open at the seal — the PEB is not reconciled.
  const reading = received(sealed.pebText, await analyse(sealed)).model;
  assert.equal(reading.periods.length, 2);
  assert.equal(reading.periods[0]!.reconciliation.status, "ESTABLISHED");
  assert.equal(reading.periods[1]!.restored, null);
  assert.equal(reading.periods[1]!.reconciliation.status, "NOT_ESTABLISHED");
  assert.equal(reading.periods[1]!.reconciliation.reason, "NOT_NAMED_BY_RECEIPT");
  assert.equal(reading.reconciliation.status, "NOT_ESTABLISHED", "every period, open ones included");
});

test("timing edges: the receipt takes the next append slot, so no mission record is ever skipped; nothing lands at or after the Final Receipt", () => {
  // Paused one millisecond before a required record.
  const early = new InMissionRun("fortix.demo.d006.inmission.edge-86499");
  early.routes(true, false, 0);
  early.at(86_499);
  early.routes(false, false, 86_499);
  early.routes(true, false, 86_499);
  const attempt = early.reconcile(memoryBaseStore(early.runId), 86_499);
  assert.equal(attempt.result.status, "COMPLETE");
  const receipt = attempt.result.receipt!;
  assert.equal(receipt.missionClockPosition, early.session.records.at(-2)!.missionClockPosition + 1);
  assert.equal(receipt.payload.observed_master_time_ms, 86_499);
  early.at(EXPERIENCE_DURATION_MS);
  assert.ok(early.session.records.some((record) => record.eventId === "d006g.payment-instruction-presented"), "the 86 500 record is still projected");
  assert.doesNotThrow(() => artifactsOf(early.session), "the Final Receipt is issued");

  // The last millisecond before the cutoff is still in mission.
  const last = new InMissionRun("fortix.demo.d006.inmission.edge-119999");
  last.routes(true, false, 0);
  last.at(119_999);
  last.routes(false, false, 119_999);
  last.routes(true, false, 119_999);
  assert.equal(last.reconcile(memoryBaseStore(last.runId), 119_999).result.status, "COMPLETE");
  last.at(EXPERIENCE_DURATION_MS);
  assert.equal(artifactsOf(last.session).handoff.peb.runtimeRecords.filter((record) => record.eventType === "RECONCILIATION_RECEIPT").length, 1);

  // A moment that rounds to the cutoff is not: refused, nothing appended, and the Final Receipt still issues.
  const cutoff = new InMissionRun("fortix.demo.d006.inmission.edge-cutoff");
  cutoff.routes(true, false, 0);
  cutoff.at(119_999);
  cutoff.routes(false, false, 119_999);
  cutoff.routes(true, false, 119_999);
  const refused = cutoff.reconcile(memoryBaseStore(cutoff.runId), 119_999.6);
  assert.deepEqual(refused.result.reasonCodes, ["IN_MISSION_TIME_EXHAUSTED"]);
  cutoff.at(EXPERIENCE_DURATION_MS);
  assert.equal(artifactsOf(cutoff.session).handoff.peb.runtimeRecords.filter((record) => record.eventType === "RECONCILIATION_RECEIPT").length, 0);
});

test("the authority gate: the receipt shows exactly when the restoration it closes shows; a DENY after it is LOCAL again", () => {
  const run = new InMissionRun("fortix.demo.d006.inmission.gate");
  run.routes(true, false, 0);
  run.at(50_000);
  run.routes(false, false, 50_100);
  run.at(HUMAN_AUTHORITY_GATE_MS);
  run.routes(true, false, HUMAN_AUTHORITY_GATE_MS);
  const attempt = run.reconcile(memoryBaseStore(run.runId), HUMAN_AUTHORITY_GATE_MS);
  assert.equal(attempt.result.status, "COMPLETE");
  const receipt = attempt.result.receipt!;
  assert.equal(receipt.payload.observed_master_time_ms, HUMAN_AUTHORITY_GATE_MS, "when it happened, not where it sits");
  const rest = humanPresentationTimeAtRest(HUMAN_AUTHORITY_GATE_MS);
  for (const presentation of [rest, rest + 20_000]) {
    const items = nxModel(run.session, HUMAN_AUTHORITY_GATE_MS, { reconciliation: attempt.result, baseTransfer: attempt.performed }, presentation).accumulatedEvidence.items;
    const restoredShown = items.some((item) => item.eventType === "NETWORK_LINK_RESTORED");
    assert.equal(items.some((item) => item.evidenceId === receipt.receiptId), restoredShown);
  }
  const shown = nxModel(run.session, HUMAN_AUTHORITY_GATE_MS, { reconciliation: attempt.result, baseTransfer: attempt.performed }, rest + 20_000);
  assert.equal(shown.accumulatedEvidence.items.find((item) => item.evidenceId === receipt.receiptId)?.evidenceLocality, "RECONCILED");
  assert.equal(shown.network.evidenceLocality, "RECONCILED");
  assert.equal(shown.network.verdictUnchanged, null);

  const lastClock = run.session.records.at(-1)!.missionClockPosition;
  const denied = appendHumanAuthorityDenial(run.session, { missionClockPosition: Math.max(lastClock + 1, HUMAN_AUTHORITY_GATE_MS), observedMasterTimeMs: HUMAN_AUTHORITY_GATE_MS }).session;
  const deniedModel = nxModel(denied, HUMAN_AUTHORITY_GATE_MS, { humanDecision: "DENIED", reconciliation: attempt.result, baseTransfer: attempt.performed }, rest + 20_000);
  assert.equal(offlineWindowStatus(denied), "RECONCILED", "the window stays reconciled");
  assert.equal(deniedModel.network.evidenceLocality, "LOCAL", "the DENY was authored after the checkpoint: LOCAL");
  assert.ok(deniedModel.accumulatedEvidence.items.some((item) => item.evidenceId === receipt.receiptId));
});

// ---------------------------------------------------------------------------
// §5 C1 · §6 the verifier and the Verifier · §7 the graph
// ---------------------------------------------------------------------------

test("§5 C1 admits only a bound in-mission receipt; every other reserved lifecycle record stays refused", async () => {
  const run = restoredRun("c1");
  run.reconcile(memoryBaseStore(run.runId), 15_900);
  const index = run.session.records.length - 1;
  const receipt = run.session.records[index] as InMissionReconciliationReceipt;
  const closure = buildMissionEvidenceClosure({ identity: { missionId: MISSION_ID, runId: run.runId }, runtimeRecords: run.session.records, asOfMasterTimeMs: FINAL_RECEIPT_EMITTED_MS });
  const member = closure.members.find((candidate) => candidate.evidenceId === receipt.receiptId)!;
  assert.deepEqual([member.producerDomain, member.presentation, member.assurance, member.timeMs], ["NETWORK", "PRESENTED", "ELIGIBLE", 15_900]);
  assert.deepEqual([member.causalParents, member.observedInputs], [[], []], "evidence lifecycle, not causality");
  assert.ok(closure.causalInputEvidenceIds.includes(receipt.receiptId), "a Final Receipt input like NR-NET-LOST / NR-NET-RESTORED");

  // A second receipt for the same window, under its own identity, is not bound.
  const second = reDigested(receipt, { receiptId: `${receipt.receiptId}#2`, eventId: `${receipt.eventId}#2`, causalPredecessors: [receipt.receiptId], missionClockPosition: receipt.missionClockPosition + 1 });
  assert.equal(closureError([...run.session.records, second], run.runId), "RUNTIME_RECONCILIATION_UNBOUND");

  // The post-completion path's records stay refused exactly as before.
  const legacyRun = new InMissionRun("fortix.demo.d006.inmission.c1-legacy");
  legacyRun.routes(true, false, 0);
  legacyRun.at(41_000);
  legacyRun.routes(false, false, 41_000);
  legacyRun.at(EXPERIENCE_DURATION_MS);
  const handoff = artifactsOf(legacyRun.session).handoff;
  const verdict = await analyse(handoff);
  legacyRun.session = capturePreRestorationIfPossible(legacyRun.session, handoff, verdict, EXPERIENCE_DURATION_MS);
  legacyRun.routes(true, false, EXPERIENCE_DURATION_MS);
  const legacy = performReconciliation({ session: legacyRun.session, baseStore: memoryBaseStore(legacyRun.runId), artifacts: { finalReceipt: { ref: handoff.finalReceipt.receiptId, value: handoff.finalReceipt as never }, portableEvidenceBundle: { ref: handoff.peb.bundleId, value: handoff.peb as never }, verdict: verdict.result.verdict }, masterTimeMs: EXPERIENCE_DURATION_MS });
  assert.equal(legacy.result.status, "COMPLETE");
  const legacyRecords = legacy.result.session.records;
  assert.equal(closureError(legacyRecords, legacyRun.runId), "RUNTIME_RESERVED_LIFECYCLE_INVALID");
  const withoutCapture = legacyRecords.filter((record) => record.eventType !== "MISSION_COMPLETED_OFFLINE");
  assert.notEqual(closureError(withoutCapture, legacyRun.runId), null, "a post-completion receipt can never support the Final Receipt");
});

test("§6 the independent verifier reports the binding as one more evidence check, labelled in both languages", async () => {
  const run = restoredRun("verifier-check");
  run.reconcile(memoryBaseStore(run.runId), 15_900);
  run.at(EXPERIENCE_DURATION_MS);
  const analysis = await analyse(artifactsOf(run.session).handoff);
  assert.ok(analysis.result.completedChecks.includes(IN_MISSION_RECONCILIATION_CHECK));
  assert.equal(CHECK_CATEGORY[IN_MISSION_RECONCILIATION_CHECK], "evidence");
  assert.ok(categoriesOf(analysis.result.completedChecks).length <= 5);
  const plain = new InMissionRun("fortix.demo.d006.inmission.verifier-plain").at(EXPERIENCE_DURATION_MS);
  const without = await analyse(artifactsOf(plain.session).handoff);
  assert.ok(!without.result.completedChecks.includes(IN_MISSION_RECONCILIATION_CHECK), "reported only when a PEB carries an in-mission receipt");
  const labels = [en.d006c2.verifier.checkLabels, fr.d006c2.verifier.checkLabels] as readonly Readonly<Record<string, string>>[];
  for (const table of labels) assert.ok(table[IN_MISSION_RECONCILIATION_CHECK]?.trim());
  assert.notEqual(labels[0]![IN_MISSION_RECONCILIATION_CHECK], labels[1]![IN_MISSION_RECONCILIATION_CHECK]);
  assert.match(readFileSync(new URL("../app/offlineVerification.ts", import.meta.url), "utf8"), /"d006_in_mission_reconciliation_consistent"/);
});

test("§6 the Verifier reads « Preuves réconciliées » only from a bound receipt confirmed by the analysis of these bytes", async () => {
  const run = restoredRun("verifier-ui");
  const attempt = run.reconcile(memoryBaseStore(run.runId), 15_900);
  const receipt = attempt.result.receipt!;
  run.at(EXPERIENCE_DURATION_MS);
  const { handoff } = artifactsOf(run.session);
  const analysis = await analyse(handoff);

  const declared = received(handoff.pebText);
  assert.equal(declared.model.periods[0]!.reconciliation.status, "DECLARED", "bound, not analysed");
  const otherBytes = received(handoff.pebText, { ...analysis, transferredContentDigest: "0".repeat(64) });
  assert.equal(otherBytes.model.periods[0]!.reconciliation.status, "DECLARED", "an analysis of other bytes is no analysis of these");
  const invalid = received(handoff.pebText, { transferredContentDigest: handoff.transferredContentDigest, result: { ...analysis.result, verdict: "INVALID" } });
  assert.equal(invalid.model.periods[0]!.reconciliation.reason, "VERIFICATION_FAILED");
  const unchecked = received(handoff.pebText, { transferredContentDigest: handoff.transferredContentDigest, result: { ...analysis.result, completedChecks: analysis.result.completedChecks.filter((check) => check !== IN_MISSION_RECONCILIATION_CHECK) } });
  assert.equal(unchecked.model.periods[0]!.reconciliation.reason, "VERIFICATION_FAILED");
  const established = received(handoff.pebText, analysis);
  const period = established.model.periods[0]!;
  assert.equal(period.reconciliation.status, "ESTABLISHED");
  assert.equal(period.reconciliation.receipt?.receiptId, receipt.receiptId);
  assert.equal(period.reconciledEntryCount, (receipt as InMissionReconciliationReceipt).offlineObjectIds.length);
  assert.ok(period.entries.every((entry) => entry.evidenceId !== receipt.receiptId), "the receipt is a lifecycle record, not a fact of the period");
  assert.deepEqual([...new Set(established.model.lanes.evidence.map((segment) => segment.value))], ["LOCAL"], "the receipt's own RECONCILED is not a state of the facts");

  // Rendered: the established words only where established, details on demand.
  const view = (model: typeof established.model, catalog: typeof established.catalog) => renderToStaticMarkup(createElement(NetworkView, { model, catalog, locale: "fr", linksForEntry }));
  const establishedHtml = view(established.model, established.catalog);
  assert.match(visible(establishedHtml), /Preuves réconciliées/);
  assert.match(establishedHtml, /<details class="network-fact-technical"><summary>Détails techniques de la réconciliation<\/summary>/);
  assert.doesNotMatch(establishedHtml, /<details[^>]*open/);
  assert.match(visible(establishedHtml), /pas un témoin indépendant/);
  const declaredHtml = visible(view(declared.model, declared.catalog));
  assert.match(declaredHtml, /Réconciliation déclarée, à vérifier/);
  assert.doesNotMatch(declaredHtml, /Preuves réconciliées/);
  const restoredKey = established.model.transitions.find((transition) => transition.kind === "RESTORED")!.entry.nodeKey;
  const summary = renderToStaticMarkup(createElement(NetworkFactSummary, { model: established.model, nodeKey: restoredKey, locale: "fr" }));
  assert.ok(summary.indexOf("RR-OFFLINE-RECONCILIATION:") > summary.indexOf("Détails techniques"), "the receipt identity sits inside the technical details");

  // The receipt as a fact: a neutral caption, placed by the period it names.
  const entry = established.catalog.entries.find((candidate) => candidate.evidenceId === receipt.receiptId)!;
  assert.equal(entry.eventLabel, "Reçu de réconciliation");
  assert.equal(receivedEventLabel(receipt.eventId, "en"), "Reconciliation receipt");
  const position = factNetworkPosition(established.model, entry.nodeKey);
  assert.equal(position.kind, "RECONCILIATION");
  const inspector = visible(renderToStaticMarkup(createElement(FactInspector, { entry, catalog: established.catalog, network: established.model, locale: "fr", context: "event", linksForEntry })));
  assert.match(inspector, /Reçu de réconciliation de la période hors ligne n°1 Preuves réconciliées/);

  // The Verdict view: one established line, one limit line.
  const verdict = (snapshot: D006VerdictSnapshot | null, model: typeof established.model) => visible(renderToStaticMarkup(createElement(RouteVerdict, { locale: "fr", peb: established.peb, graph: established.graph, snapshot, links: {}, catalog: established.catalog, network: model })));
  const analysed = verdict(analysis, established.model);
  assert.match(analysed, /Preuves réconciliées : la période hors ligne est nommée par un reçu de réconciliation/);
  assert.match(analysed, /registre de démonstration du même poste/);
  assert.doesNotMatch(analysed, /la réconciliation des preuves produites hors ligne n’est pas établie/);
  const notAnalysed = verdict(null, declared.model);
  assert.doesNotMatch(notAnalysed, /Preuves réconciliées :/);
  assert.match(notAnalysed, /la réconciliation des preuves produites hors ligne n’est pas établie dans ce PEB/);
});

test("§7 the graph keeps its causality: no LOST → fact, no LOST → RESTORED, no RESTORED → offline NR; the receipt is network context", () => {
  const run = restoredRun("graph");
  run.reconcile(memoryBaseStore(run.runId), 15_900);
  const { offline } = windowOf(run.session);
  run.at(EXPERIENCE_DURATION_MS);
  const { graph, catalog, model } = received(artifactsOf(run.session).handoff.pebText);
  const keyOf = (evidenceId: string) => catalog.entries.find((entry) => entry.evidenceId === evidenceId)!.nodeKey;
  const lostKey = model.transitions[0]!.entry.nodeKey;
  const restoredKey = model.transitions[1]!.entry.nodeKey;
  const receiptKey = model.periods[0]!.reconciliation.records[0]!.nodeKey;
  const offlineKeys = new Set(offline.map((record) => keyOf(record.receiptId)));
  for (const key of [lostKey, restoredKey, receiptKey]) {
    const touching = graph.edges.filter((edge) => edge.from === key || edge.to === key);
    assert.ok(touching.every((edge) => edge.to === graph.finalKey), `${key} relates only to the Final Receipt`);
  }
  assert.ok(!graph.edges.some((edge) => edge.from === lostKey && offlineKeys.has(edge.to)));
  assert.ok(!graph.edges.some((edge) => edge.from === restoredKey && offlineKeys.has(edge.to)));
  assert.ok(!graph.edges.some((edge) => (edge.from === lostKey && edge.to === restoredKey) || (edge.from === restoredKey && edge.to === lostKey)));
  assert.ok(networkContextNodeKeys(graph).has(receiptKey), "hidden with the network context in the simplified graph");
  const note = readFileSync(new URL("../app/verify/InspectionWorkspace.tsx", import.meta.url), "utf8");
  assert.match(note, /NanoReceipt\$\{display\.hiddenNetworkContext > 1 \? "s" : ""\} réseau sans relation causale propre/);
});

test("§9 fail-closed · forged receipt, clause by clause: every statement a receipt makes is checked against its records", async () => {
  const run = restoredRun("forged-clauses");
  run.reconcile(memoryBaseStore(run.runId), 15_900);
  const index = run.session.records.length - 1;
  const receipt = run.session.records[index] as InMissionReconciliationReceipt;
  const restoredObserved = run.session.records[index - 1]!.payload.observed_master_time_ms as number;
  run.at(EXPERIENCE_DURATION_MS);
  const { handoff } = artifactsOf(run.session);
  const sealedCount = run.session.finalReceiptRuntimeSeal!.sealedRecordCount;
  const swapped = [...receipt.transferredObjectIds.slice(0, -1), "NR-FORGED-OBJECT"];
  const forgeries: readonly (readonly [string, Partial<InMissionReconciliationReceipt>, Record<string, unknown>])[] = [
    ["dated before the restoration it closes", {}, { observed_master_time_ms: restoredObserved - 1 }],
    ["dated at the Final Receipt cutoff", {}, { observed_master_time_ms: FINAL_RECEIPT_EMITTED_MS }],
    ["base digest before", { baseBeforeDigest: "0".repeat(64) }, { base_before_digest: "0".repeat(64) }],
    ["base digest after", { baseAfterDigest: "0".repeat(64) }, { base_after_digest: "0".repeat(64) }],
    ["one transferred object swapped, same count", { transferredObjectIds: swapped }, { transferred_object_ids: swapped }],
    ["operation of another window", { operationId: "BCT:another:window" }, { operation_id: "BCT:another:window" }],
    ["local object count", { localObjectCount: receipt.localObjectCount + 1 }, { local_object_count: receipt.localObjectCount + 1 }],
    ["missing object count", { baseMissingObjectCount: receipt.baseMissingObjectCount + 1 }, { base_missing_object_count: receipt.baseMissingObjectCount + 1 }],
    ["window start", { offlineWindowStartRef: "NR-NET-LOST:another" }, { offline_window_start_ref: "NR-NET-LOST:another" }],
    ["offline objects", { offlineObjectIds: receipt.offlineObjectIds.slice(1) }, { offline_object_ids: receipt.offlineObjectIds.slice(1) }],
  ];
  for (const [clause, projection, payload] of forgeries) {
    const forged = reDigested(receipt, projection, payload);
    assert.equal(isSpecializedRecordProjectionValid(forged), true, `${clause}: a well-formed record`);
    const records = run.session.records.map((record, position) => position === index ? forged : record);
    assert.equal(inMissionReconciliationBound(records, index, run.session.missionId, run.runId), false, `${clause}: not bound`);
    assert.equal(closureError(records.slice(0, sealedCount), run.runId), "RUNTIME_RECONCILIATION_UNBOUND", `${clause}: refused by C1`);
    const forgedPeb = repackaged(handoff.peb, records.slice(0, sealedCount));
    const result = await verifyD006PortableMissionEvidence(forgedPeb.text, { expectedIdentity: handoff.identity, expectedTransferredContentDigest: forgedPeb.transferred });
    assert.deepEqual(result.reasonCodes, ["D006_RUNTIME_RECONCILIATION_UNBOUND"], `${clause}: refused by the verifier`);
    const reading = received(forgedPeb.text, { transferredContentDigest: forgedPeb.transferred, result }).model;
    assert.notEqual(reading.periods[0]!.reconciliation.status, "ESTABLISHED", `${clause}: never established by the Verifier`);
  }
});

test("§6 the Verifier · an ambiguous reconciliation is not established: two receipts for one period, or one receipt id twice", async () => {
  const run = restoredRun("ambiguous");
  run.reconcile(memoryBaseStore(run.runId), 15_900);
  const receipt = run.session.records.at(-1) as InMissionReconciliationReceipt;
  run.at(EXPERIENCE_DURATION_MS);
  const { handoff } = artifactsOf(run.session);
  const sealed = handoff.peb.runtimeRecords;
  const appended = (extra: OfflineCausalRecord) => {
    const last = sealed.at(-1)!;
    return [...sealed, reDigested(extra, { causalPredecessors: [last.receiptId], missionClockPosition: last.missionClockPosition + 1 })];
  };
  const elsewhere = { offline_window_start_ref: "NR-NET-LOST:elsewhere", offline_window_end_ref: "NR-NET-RESTORED:elsewhere" };
  const shapes: Readonly<Record<string, readonly OfflineCausalRecord[]>> = {
    "a second receipt under its own identity": appended({ ...receipt, receiptId: `${receipt.receiptId}#2`, eventId: `${receipt.eventId}#2` }),
    "the same receipt id twice": appended(receipt),
    "the same receipt id twice, the copy naming another window": appended({
      ...receipt,
      offlineWindowStartRef: elsewhere.offline_window_start_ref,
      offlineWindowEndRef: elsewhere.offline_window_end_ref,
      payload: { ...receipt.payload, ...elsewhere },
    } as OfflineCausalRecord),
  };
  for (const [shape, records] of Object.entries(shapes)) {
    const peb = repackaged(handoff.peb, records);
    const declared = received(peb.text);
    assert.equal(declared.model.periods[0]!.reconciliation.status, "NOT_ESTABLISHED", shape);
    assert.equal(declared.model.periods[0]!.reconciliation.reason, "RECONCILIATION_UNBOUND", shape);
    const html = visible(renderToStaticMarkup(createElement(NetworkView, { model: declared.model, catalog: declared.catalog, locale: "fr", linksForEntry })));
    assert.doesNotMatch(html, /Réconciliation déclarée, à vérifier|Preuves réconciliées/, shape);
    const result = await verifyD006PortableMissionEvidence(peb.text, { expectedIdentity: handoff.identity, expectedTransferredContentDigest: peb.transferred });
    assert.equal(result.verdict, "INVALID", shape);
    assert.notEqual(received(peb.text, { transferredContentDigest: peb.transferred, result }).model.periods[0]!.reconciliation.status, "ESTABLISHED", shape);
  }
});

test("§6 the Verifier · two flaps at one declared time: each restoration reads its own period, never another's receipt", async () => {
  for (const secondReconciled of [false, true]) {
    const run = new InMissionRun(`fortix.demo.d006.inmission.same-time-${secondReconciled ? "both" : "first"}`);
    run.routes(true, false, 0);
    run.at(9_100);
    run.routes(false, false, 9_332);
    run.at(HUMAN_AUTHORITY_GATE_MS);
    run.routes(true, false, HUMAN_AUTHORITY_GATE_MS);
    const store = memoryBaseStore(run.runId);
    const first = run.reconcile(store, HUMAN_AUTHORITY_GATE_MS);
    assert.equal(first.result.status, "COMPLETE");
    // Held at the gate, the cable flaps again: same declared time for every record.
    run.routes(false, false, HUMAN_AUTHORITY_GATE_MS);
    run.routes(true, false, HUMAN_AUTHORITY_GATE_MS);
    const swallowing: BaseStore = { read: () => null, readStrict: () => ({ status: "ABSENT" }), write: () => {} };
    const second = run.reconcile(secondReconciled ? store : swallowing, HUMAN_AUTHORITY_GATE_MS);
    assert.equal(second.result.status, secondReconciled ? "COMPLETE" : "FAILED");
    run.at(EXPERIENCE_DURATION_MS);
    const { handoff } = artifactsOf(run.session);
    const { model, catalog } = received(handoff.pebText, await analyse(handoff));
    assert.deepEqual(model.periods.map((period) => period.reconciliation.status), secondReconciled ? ["ESTABLISHED", "ESTABLISHED"] : ["ESTABLISHED", "NOT_ESTABLISHED"]);
    const transitions = new Set(model.transitions.map((transition) => transition.entry));
    assert.ok(model.periods.every((period) => period.entries.every((entry) => !transitions.has(entry))), "no transition is a fact of any period");
    const restored2 = model.periods[1]!.restored!.entry;
    assert.equal(offlinePeriodOf(model, restored2.nodeKey)?.index, 2);
    const position = factNetworkPosition(model, restored2.nodeKey);
    assert.equal(position.kind === "TRANSITION" ? position.period?.index : null, 2);
    const escaped = (id: string) => id.replace(/>/g, "&gt;");
    for (const compact of [false, true]) {
      const summary = renderToStaticMarkup(createElement(NetworkFactSummary, { model, nodeKey: restored2.nodeKey, locale: "fr", compact }));
      assert.ok(!summary.includes(escaped(first.result.receipt!.receiptId)), "never the first window's receipt");
      if (secondReconciled) {
        assert.match(visible(summary), /Preuves réconciliées/);
        if (!compact) assert.ok(summary.includes(escaped(second.result.receipt!.receiptId)), "its own receipt");
      } else {
        assert.match(visible(summary), /Réconciliation non établie/);
        assert.doesNotMatch(visible(summary), /Preuves réconciliées/);
      }
    }
    if (!secondReconciled) {
      const inspector = visible(renderToStaticMarkup(createElement(FactInspector, { entry: restored2, catalog, network: model, locale: "fr", context: "event", linksForEntry })));
      assert.doesNotMatch(inspector, /Preuves réconciliées/);
    }
  }
});

test("/nx facts · a blink with nothing authored inside is no offline continuation, reconciled or not", () => {
  const run = new InMissionRun("fortix.demo.d006.inmission.blink");
  run.routes(true, false, 0);
  run.at(9_300);
  run.routes(false, false, 9_332);
  run.routes(true, false, 9_400);
  assert.equal(windowOf(run.session).offline.length, 0, "nothing was authored while LOST");
  const before = run.session;
  const attempt = run.reconcile(memoryBaseStore(run.runId), 9_400);
  assert.equal(attempt.result.status, "COMPLETE");
  assert.equal(attempt.result.receipt!.payload.observed_master_time_ms, 9_400, "dated at the restoration");
  for (const session of [before, run.session]) {
    const facts = deriveMissionFacts({ session, closure: null, receiptBindings: [], finalReceipt: null, humanDecision: "PENDING", effectiveStoryTimeMs: 9_450 });
    assert.equal(facts.find((fact) => fact.factId === "fact.network.continuedOffline")?.status, "NOT_OCCURRED");
  }
});

test("timing · a receipt is never dated before the record it follows, even from a clock read late", () => {
  const run = new InMissionRun("fortix.demo.d006.inmission.clamp");
  run.routes(true, false, 0);
  run.at(9_100);
  run.routes(false, false, 9_332);
  run.at(11_500);
  run.routes(true, false, 11_965);
  run.at(12_002);
  const follows = run.session.records.at(-1)!;
  assert.equal(follows.missionClockPosition, 12_000, "a mission record lands after NR-NET-RESTORED");
  const attempt = run.reconcile(memoryBaseStore(run.runId), 11_965);
  assert.equal(attempt.result.status, "COMPLETE");
  const receipt = attempt.result.receipt!;
  assert.equal(receipt.payload.observed_master_time_ms, 12_000, "clamped to the record it follows");
  const index = run.session.records.indexOf(receipt);
  assert.equal(inMissionReconciliationBound(run.session.records, index, run.session.missionId, run.runId), true);
  const closure = buildMissionEvidenceClosure({ identity: { missionId: MISSION_ID, runId: run.runId }, runtimeRecords: run.session.records, asOfMasterTimeMs: FINAL_RECEIPT_EMITTED_MS });
  const order = closure.members.map((member) => member.evidenceId);
  assert.ok(order.indexOf(follows.receiptId) < order.indexOf(receipt.receiptId), "the closure keeps journal order");
  // A receipt dated after the restoration but before the record it follows is not bound.
  const early = reDigested(receipt, {}, { observed_master_time_ms: 11_980 });
  const records = run.session.records.map((record, position) => position === index ? early : record);
  assert.equal(inMissionReconciliationBound(records, index, run.session.missionId, run.runId), false);
  assert.equal(closureError(records, run.runId), "RUNTIME_RECONCILIATION_UNBOUND");
});

test("engine · a journal assessment is kept only for an immutable session", () => {
  const run = restoredRun("assessment-cache");
  run.reconcile(memoryBaseStore(run.runId), 15_900);
  assert.ok(Object.isFrozen(run.session) && Object.isFrozen(run.session.records));
  assert.equal(offlineWindowStatus(run.session), "RECONCILED");
  assert.equal(offlineWindowStatus(run.session), "RECONCILED", "the same immutable journal, the same answer");
  const mutable = JSON.parse(JSON.stringify(run.session)) as { records: { canonicalDigest: string }[] };
  const session = mutable as unknown as OfflineEvidenceSession;
  assert.equal(isOfflineEvidenceSessionJournalValid(session), true);
  assert.equal(offlineWindowStatus(session), "RECONCILED");
  mutable.records[3]!.canonicalDigest = "0".repeat(64);
  assert.equal(isOfflineEvidenceSessionJournalValid(session), false, "a mutable session is assessed afresh, never served from a cache");
  assert.equal(offlineWindowStatus(session), "NONE");
});

test("§6 the Verifier reads a PEB stuffed with forged receipt clones in linear time, and establishes nothing", () => {
  const run = restoredRun("clones");
  run.reconcile(memoryBaseStore(run.runId), 15_900);
  const receipt = run.session.records.at(-1) as InMissionReconciliationReceipt;
  run.at(EXPERIENCE_DURATION_MS);
  const { handoff } = artifactsOf(run.session);
  const records = [...handoff.peb.runtimeRecords];
  for (let clone = 1; clone <= 400; clone += 1) {
    const last = records.at(-1)!;
    records.push(reDigested(receipt, { receiptId: `${receipt.receiptId}#${clone}`, eventId: `${receipt.eventId}#${clone}`, causalPredecessors: [last.receiptId], missionClockPosition: last.missionClockPosition + 1 }));
  }
  const peb = repackaged(handoff.peb, records);
  const started = performance.now();
  const { model } = received(peb.text);
  const elapsed = performance.now() - started;
  // Checked receipt by receipt, each clone re-hashed its whole prefix: about 6 s here.
  assert.ok(elapsed < 3_000, `read in ${Math.round(elapsed)} ms`);
  assert.equal(model.periods[0]!.reconciliation.status, "NOT_ESTABLISHED");
  assert.equal(model.periods[0]!.reconciliation.reason, "RECONCILIATION_UNBOUND");
});

test("the /nx hook: one journal writer, projection before the receipt, no acknowledgement claimed without one", () => {
  const source = readFileSync(new URL("../app/nx/adapter/useMissionEngine.ts", import.meta.url), "utf8");
  // Comments stripped and whitespace collapsed: the rules hold whatever the formatting.
  const hook = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1").replace(/\s+/g, " ");
  assert.doesNotMatch(hook, /liveSessionRef\.current = liveSession\b/, "no effect copies the journal state back into the ref");
  assert.doesNotMatch(hook, /\}, \[(liveSession|masterTime)\]\)/, "no effect keyed on the journal or the clock state alone");
  // Every journal write goes through the ref first; one guarded functional updater names the run.
  const writes = [...hook.matchAll(/setLiveSession\(/g)].map((match) => match.index!);
  const functional = writes.filter((at) => /^setLiveSession\( ?\(? ?\w* ?\)? ?=>/.test(hook.slice(at)));
  assert.equal(functional.length, 1, "a single functional updater");
  assert.match(hook.slice(functional[0]!, functional[0]! + 120), /UNRESOLVED_RUN_ID/, "and it is the guarded run naming");
  for (const at of writes.filter((position) => !functional.includes(position))) {
    const argument = /^setLiveSession\(([^()]*)\)/.exec(hook.slice(at))?.[1];
    assert.ok(argument !== undefined && argument.length > 0, `a plain journal write at ${at}`);
    const before = hook.slice(0, at);
    const assigned = /^liveSessionRef\.current = ([^;]*);/.exec(before.slice(before.lastIndexOf("liveSessionRef.current = ")))?.[1];
    assert.equal(assigned, argument, `setLiveSession(${argument}) follows liveSessionRef.current = ${argument}`);
  }
  // The reconciliation projects first, and claims no acknowledgement it did not get.
  assert.match(hook, /const reached = journalAt\(liveSessionRef\.current, masterTimeRef\.current\); attempt = performReconciliation\(\{ session: reached,/);
  assert.match(hook, /setSyncPhase\(attempt\.result\.status !== "COMPLETE" \? "FAILED" : acknowledged \? "ACKNOWLEDGED" : "RECONCILED"\)/);
  assert.match(hook, /attempt = refusedReconciliationAttempt\(liveSessionRef\.current, "DIGEST_COMPUTATION_FAILED"\)/);
  assert.equal(IN_MISSION_RECONCILIATION_RESULT, "IN_MISSION_BASE_COMPARE_TRANSFER_COMPLETE");
});

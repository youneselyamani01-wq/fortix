import assert from "node:assert/strict";
import test from "node:test";

import { memoryBaseStore } from "../app/baseEvidence.ts";
import { offlineWindowStatus } from "../app/offlineEvidence.ts";
import { verifyD006PortableMissionEvidence } from "../app/offlineVerification.ts";
import { HUMAN_AUTHORITY_GATE_MS } from "../app/reviewFlow.ts";
import { EXPERIENCE_DURATION_MS, FINAL_RECEIPT_EMITTED_MS } from "../app/storyTimeline.ts";
import { createReceivedEvidenceCatalog } from "../app/verify/receivedEvidenceCatalog.ts";
import { projectReceivedGraph } from "../app/verify/receivedGraph.ts";
import { receivedNetworkModel } from "../app/verify/receivedNetwork.ts";
import { inspectReceivedPeb } from "../app/verify/inspectReceivedPeb.ts";
import { InMissionRun, artifactsOf } from "./support/inMissionScenario.ts";

/**
 * MANDATE D-006 — IN-MISSION OFFLINE RECONCILIATION · §12, the central test.
 *
 * It must FAIL on the previous contract — where a restoration before the
 * offline verdict always ended FAILED / ARTIFACT_STATE_INVALID and the PEB
 * never carried a reconciliation — and PASS on the new one. It therefore
 * uses only interfaces both contracts expose: the shared physical-link
 * runtime, the base store, the journal projection, the C1 artifacts, the
 * independent verifier and the Verifier's network reading. The in-mission
 * receipt and the verifier check are recognised by their literal values.
 *
 * Chain: CONNECTED → physical loss → NR-NET-LOST → several business
 * NanoReceipts while LOST, all LOCAL → the network returns BEFORE any verdict
 * → NR-NET-RESTORED → reconciliation → COMPLETE → LOCAL objects RECONCILED →
 * the mission continues → Final Receipt → PEB → analysis of that same PEB →
 * the reconciliation is established from the PEB, never from RESTORED.
 */

const IN_MISSION_RESULT = "IN_MISSION_BASE_COMPARE_TRANSFER_COMPLETE";
const IN_MISSION_CHECK = "d006_in_mission_reconciliation_consistent";

test("§12 central: evidence produced while LOST is reconciled in mission, before the verdict, and the PEB proves it", async () => {
  const run = new InMissionRun("fortix.demo.d006.inmission.central");
  assert.deepEqual(run.routes(true, false, 0).transitions, [], "CONNECTED baseline: no network NanoReceipt");
  run.at(9_100);

  // A real loss: every route down, two consecutive physical samples.
  assert.deepEqual(run.routes(false, false, 9_332).transitions, ["LOST"]);
  assert.equal(run.session.networkState, "LOST");
  const lostIndex = run.session.records.length - 1;
  const lost = run.session.records[lostIndex]!;
  assert.equal(lost.eventType, "NETWORK_LINK_LOST");

  // The mission continues: several business NanoReceipts while LOST, all LOCAL.
  run.at(15_500);
  const offline = run.session.records.slice(lostIndex + 1);
  assert.ok(offline.length >= 6, `several business NanoReceipts while LOST (got ${offline.length})`);
  assert.ok(offline.every((record) => record.evidenceLocality === "LOCAL" && !record.eventType.startsWith("NETWORK_")));

  // The network returns BEFORE the verdict — before the Final Receipt even exists.
  assert.deepEqual(run.routes(true, false, 15_900).transitions, ["RESTORED"]);
  assert.equal(run.session.networkState, "CONNECTED");
  assert.equal(run.session.finalReceiptRuntimeSeal, null, "no Final Receipt, no PEB, no verdict yet");
  assert.equal(offlineWindowStatus(run.session), "AWAITING_RECONCILIATION", "RESTORED alone reconciles nothing");
  const restored = run.session.records.at(-1)!;
  assert.equal(restored.eventType, "NETWORK_LINK_RESTORED");

  // Reconciliation, performed: a valid checkpoint without any verdict → COMPLETE.
  const store = memoryBaseStore(run.runId);
  const attempt = run.reconcile(store, 15_900);
  assert.equal(attempt.result.status, "COMPLETE", `reconciled in mission (reasons: ${attempt.result.reasonCodes.join(",") || "none"})`);
  const receipt = attempt.result.receipt!;
  assert.equal(receipt.eventType, "RECONCILIATION_RECEIPT");
  assert.equal(receipt.payload.reconciliation_result, IN_MISSION_RESULT);
  assert.equal(receipt.evidenceLocality, "RECONCILED", "LOCAL → RECONCILED is the receipt's own statement");
  assert.equal(receipt.payload.offline_window_start_ref, lost.receiptId);
  assert.equal(receipt.payload.offline_window_end_ref, restored.receiptId);
  assert.deepEqual(receipt.payload.offline_object_ids, offline.map((record) => record.receiptId), "exactly the objects authored while LOST");
  const transferred = receipt.payload.transferred_object_ids as readonly string[];
  for (const record of offline) assert.ok(transferred.includes(record.receiptId), `${record.receiptId} reached the base`);
  assert.equal(attempt.performed?.transferred, true);
  assert.deepEqual(store.read()?.records.map((record) => record.receiptId), run.session.records.slice(0, run.session.records.indexOf(restored) + 1).map((record) => record.receiptId), "the base holds the window");
  assert.equal(offlineWindowStatus(run.session), "RECONCILED");
  assert.ok((receipt.payload.observed_master_time_ms as number) < FINAL_RECEIPT_EMITTED_MS);

  // The mission continues, then the Final Receipt seals a journal that holds the receipt.
  run.at(HUMAN_AUTHORITY_GATE_MS).at(EXPERIENCE_DURATION_MS);
  const sealed = run.session;
  assert.ok(sealed.finalReceiptRuntimeSeal !== null);
  assert.ok(sealed.records.findIndex((record) => record.receiptId === receipt.receiptId) < sealed.finalReceiptRuntimeSeal.sealedRecordCount, "the receipt is inside the sealed prefix");
  const { closure, handoff } = artifactsOf(sealed);
  const member = closure.members.find((candidate) => candidate.evidenceId === receipt.receiptId);
  assert.ok(member !== undefined, "the reconciliation is a member of the Final Receipt closure");
  assert.ok(handoff.finalReceipt.causalInputEvidenceIds.includes(receipt.receiptId));
  assert.ok(handoff.peb.runtimeRecords.some((record) => record.receiptId === receipt.receiptId), "the PEB carries the receipt");

  // The independent verifier analyses that same PEB and reports the binding.
  const result = await verifyD006PortableMissionEvidence(handoff.pebText, {
    expectedIdentity: handoff.identity,
    expectedTransferredContentDigest: handoff.transferredContentDigest,
  });
  assert.notEqual(result.verdict, "INVALID", result.reasonCodes.join(","));
  assert.ok(result.completedChecks.includes(IN_MISSION_CHECK), "the analysis confirms the in-mission reconciliation");

  // The Verifier establishes it from the PEB and that analysis — RESTORED alone never would.
  const peb = inspectReceivedPeb(handoff.pebText);
  const catalog = createReceivedEvidenceCatalog(projectReceivedGraph(peb, handoff.pebText), "fr", handoff.pebText);
  const model = receivedNetworkModel(catalog, handoff.pebText, { transferredContentDigest: handoff.transferredContentDigest, result });
  assert.equal(model.periods.length, 1);
  assert.notEqual(model.periods[0]!.restored, null);
  assert.equal(model.periods[0]!.reconciliation.status, "ESTABLISHED");
  assert.equal(model.reconciliation.status, "ESTABLISHED");
});

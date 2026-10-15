import assert from "node:assert/strict";
import test from "node:test";

import { HUMAN_AUTHORITY_DECISION_EVENT_TYPE } from "../app/humanAuthorityEvidence.ts";
import { derivePublicExperience } from "../app/nx/adapter/publicExperienceAdapter.ts";
import {
  isInMissionReconciliationReceipt,
  isOfflineEvidenceSessionJournalValid,
  offlineWindowStatus,
} from "../app/offlineEvidence.ts";
import { HUMAN_AUTHORITY_GATE_MS } from "../app/reviewFlow.ts";
import { EXPERIENCE_DURATION_MS } from "../app/storyTimeline.ts";
import { inspectReceivedPeb } from "../app/verify/inspectReceivedPeb.ts";
import { createReceivedEvidenceCatalog } from "../app/verify/receivedEvidenceCatalog.ts";
import { projectReceivedGraph } from "../app/verify/receivedGraph.ts";
import { IN_MISSION_RECONCILIATION_CHECK, receivedNetworkModel } from "../app/verify/receivedNetwork.ts";
import { links, mountEngine, sleep, until } from "./support/missionEngineHarness.ts";

/**
 * MANDATE D-006 — IN-MISSION OFFLINE RECONCILIATION, through the real /nx hook.
 *
 * The engine-level suites drive the shared runtime directly. These two tests
 * run `useMissionEngine` itself under React (StrictMode), with the sentinel
 * seam standing in for the cable: the hook's own effects admit the loss and
 * the return, reconcile, seal, build the PEB and analyse it. They hold what
 * only the hook can break — the trigger, the single journal writer, the
 * acknowledgement phase — and what the physical ZBook test checks by hand.
 */

test("the /nx hook · LOST, LOCAL evidence, RESTORED before the verdict: reconciled in mission, sealed, carried by the PEB, established after analysis", async () => {
  links.ethernet = true;
  links.wifi = false;
  const mounted = mountEngine();
  const engine = mounted.engine;
  try {
    await until(() => engine().networkBaselineReady && engine().snapshot.networkState === "CONNECTED", "a CONNECTED baseline");
    engine().seek(9_100);
    links.ethernet = false;
    await until(() => engine().snapshot.networkState === "LOST", "the loss");
    engine().seek(15_500);
    await until(() => engine().snapshot.masterTimeMs === 15_500, "the mission continuing while LOST");
    const lostIndex = engine().snapshot.session.records.findLastIndex((record) => record.eventType === "NETWORK_LINK_LOST");
    const offline = engine().snapshot.session.records.slice(lostIndex + 1);
    assert.ok(offline.length >= 6, `business NanoReceipts while LOST (got ${offline.length})`);
    assert.ok(offline.every((record) => record.evidenceLocality === "LOCAL"));
    assert.equal(offlineWindowStatus(engine().snapshot.session), "OPEN");

    // One route back, before any verdict: the hook's own effect reconciles.
    links.ethernet = true;
    await until(() => engine().snapshot.session.records.some(isInMissionReconciliationReceipt), "the in-mission receipt");
    const reconciled = engine().snapshot;
    const receipt = reconciled.session.records.find(isInMissionReconciliationReceipt)!;
    assert.equal(reconciled.networkState, "CONNECTED");
    assert.equal(reconciled.reconciliation?.status, "COMPLETE");
    assert.equal(offlineWindowStatus(reconciled.session), "RECONCILED");
    assert.equal(reconciled.syncPhase, "RECONCILED", "no artifact existed to acknowledge");
    assert.deepEqual(receipt.offlineObjectIds, offline.map((record) => record.receiptId));
    const live = derivePublicExperience(reconciled, engine().presentationTimeMs);
    assert.equal(live.network.reconciliationStage, "RECONCILED");
    assert.equal(live.network.evidenceLocality, "RECONCILED");
    assert.equal(live.network.verdictUnchanged, null, "no verdict is claimed");

    // The mission continues: the gate, the approval, the seal, the PEB, the handoff.
    engine().seek(HUMAN_AUTHORITY_GATE_MS);
    await until(() => engine().snapshot.masterTimeMs === HUMAN_AUTHORITY_GATE_MS, "the authority gate");
    engine().decide("APPROVED");
    await until(() => engine().snapshot.humanDecision === "APPROVED", "the approval");
    engine().pause();
    await sleep(20);
    engine().seek(EXPERIENCE_DURATION_MS);
    await until(() => engine().snapshot.handoffArtifact !== null, "the handoff artifact");
    const sealed = engine().snapshot;
    assert.ok(sealed.session.records.indexOf(receipt) < sealed.session.finalReceiptRuntimeSeal!.sealedRecordCount, "the receipt is inside the sealed prefix");
    assert.ok(sealed.finalReceipt!.causalInputEvidenceIds.includes(receipt.receiptId));
    assert.ok(sealed.handoffArtifact!.peb.runtimeRecords.some((record) => record.receiptId === receipt.receiptId));
    assert.equal(derivePublicExperience(sealed, engine().presentationTimeMs).network.evidenceLocality, "LOCAL", "evidence authored after the receipt is LOCAL again");

    // The verifier analyses the exact bytes handed over: PICK, then DROP, then ANALYZE.
    engine().pick();
    await until(() => engine().snapshot.transferStage === "FORMED", "the pick");
    await sleep(20);
    engine().drop();
    await until(() => engine().snapshot.transferStage === "TRANSFERRED", "the drop");
    engine().analyze();
    await until(() => engine().snapshot.verification !== null, "the analysis", 60_000);
    const result = engine().snapshot.verification!;
    assert.notEqual(result.verdict, "INVALID", result.reasonCodes.join(","));
    assert.ok(result.completedChecks.includes(IN_MISSION_RECONCILIATION_CHECK));

    const artifact = engine().snapshot.handoffArtifact!;
    const catalog = createReceivedEvidenceCatalog(projectReceivedGraph(inspectReceivedPeb(artifact.pebText), artifact.pebText), "fr", artifact.pebText);
    assert.equal(receivedNetworkModel(catalog, artifact.pebText).reconciliation.status, "DECLARED", "before the analysis: declared, to be verified");
    const model = receivedNetworkModel(catalog, artifact.pebText, { transferredContentDigest: artifact.transferredContentDigest, result });
    assert.equal(model.periods[0]!.reconciliation.status, "ESTABLISHED");
    assert.equal(model.reconciliation.status, "ESTABLISHED");
  } finally {
    mounted.unmount();
  }
});

test("the /nx hook · while the link flaps during playback no record ever leaves the journal, and a DENY survives the next transition", async () => {
  links.ethernet = true;
  links.wifi = false;
  const mounted = mountEngine();
  const engine = mounted.engine;
  const seen = new Set<string>();
  const vanished: string[] = [];
  const monitor = setInterval(() => {
    try {
      const ids = new Set(engine().snapshot.session.records.map((record) => record.receiptId));
      for (const id of seen) if (!ids.has(id)) vanished.push(id);
      for (const id of ids) seen.add(id);
    } catch { /* not rendered yet */ }
  }, 2);
  try {
    await until(() => engine().networkBaselineReady && engine().snapshot.networkState === "CONNECTED", "a CONNECTED baseline");
    engine().play();
    for (let flap = 0; flap < 3; flap += 1) {
      links.ethernet = false;
      await until(() => engine().snapshot.networkState === "LOST", `loss ${flap}`);
      await sleep(120);
      links.ethernet = true;
      await until(() => engine().snapshot.networkState === "CONNECTED", `return ${flap}`);
      await sleep(120);
    }
    await until(() => !engine().snapshot.playing && engine().snapshot.masterTimeMs === HUMAN_AUTHORITY_GATE_MS, "the authority gate", 60_000);
    await until(() => offlineWindowStatus(engine().snapshot.session) !== "AWAITING_RECONCILIATION", "the last return reconciled");
    engine().decide("DENIED");
    await until(() => engine().snapshot.session.records.some((record) => record.eventType === HUMAN_AUTHORITY_DECISION_EVENT_TYPE), "the denial record");
    links.ethernet = false;
    await until(() => engine().snapshot.networkState === "LOST", "a loss after the denial");
    await sleep(50);
    const session = engine().snapshot.session;
    assert.ok(session.records.some((record) => record.eventType === HUMAN_AUTHORITY_DECISION_EVENT_TYPE), "the DENY survives the next physical append");
    assert.deepEqual(vanished, [], "no record ever left the journal");
    assert.ok(isOfflineEvidenceSessionJournalValid(session));
    assert.equal(session.records.filter((record) => record.eventType === "NETWORK_LINK_RESTORED").length, 3);
    assert.equal(session.records.filter(isInMissionReconciliationReceipt).length, 3, "each return reconciled its own window, in mission");
  } finally {
    clearInterval(monitor);
    mounted.unmount();
  }
});

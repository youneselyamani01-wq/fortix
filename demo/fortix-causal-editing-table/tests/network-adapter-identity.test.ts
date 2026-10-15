import assert from "node:assert/strict";
import test from "node:test";
import { appendNetworkTransition, canonicalRecordDigest, createOfflineEvidenceSession, isOfflineEvidenceSessionJournalValid, isSpecializedRecordProjectionValid, journalNetworkState, sealFinalReceiptRuntimeEvidence, type OfflineCausalRecord, type NetworkTransitionInput } from "../app/offlineEvidence.ts";
import { ETHERNET_ADAPTER_IDENTITY, ETHERNET_PHYSICAL_SENTINEL_SOURCE, WIFI_ADAPTER_IDENTITY, WIFI_PHYSICAL_SENTINEL_SOURCE, type PhysicalSentinelSource } from "../app/physicalAdapterPolicy.ts";
import { MISSION_ID } from "../app/missionContinuity.ts";
import { projectMissionEvidence } from "../app/missionEvidence.ts";
import { buildMissionEvidenceClosure, buildPortableMissionEvidenceBundle, createHandoffArtifact, finalReceiptRuntimeEvidencePrefix, issueFinalMissionReceipt } from "../app/portableMissionEvidence.ts";
import { projectPortableProofLeaves } from "../app/proofProjection.ts";
import { analyzeInsertedD006Peb, insertD006PebForAnalysis } from "../app/offlineVerification.ts";
import { FINAL_RECEIPT_EMITTED_MS, HANDOFF_READY_MS, PEB_COMPLETE_MS } from "../app/storyTimeline.ts";

const pairs = [[ETHERNET_ADAPTER_IDENTITY, ETHERNET_PHYSICAL_SENTINEL_SOURCE], [WIFI_ADAPTER_IDENTITY, WIFI_PHYSICAL_SENTINEL_SOURCE]] as const;
function input(identity: string, source: PhysicalSentinelSource, restored = false, runId = "identity-run", at = restored ? 2 : 1): NetworkTransitionInput {
  return { runId, observationId: restored ? "physical-restore" : "physical-loss", adapterIdentity: identity, observationSource: source, previousNetworkState: restored ? "LOST" : "CONNECTED", newNetworkState: restored ? "CONNECTED" : "LOST", missionClockPosition: at };
}

test("exact approved adapter/source pairs admit two transitions and retain idempotent observation replay", () => {
  for (const [identity, source] of pairs) {
    const initial = createOfflineEvidenceSession("identity-run");
    const lost = appendNetworkTransition(initial, input(identity, source));
    const duplicate = appendNetworkTransition(lost.session, input(identity, source));
    assert.equal(duplicate.appended, false); assert.strictEqual(duplicate.session, lost.session);
    const restored = appendNetworkTransition(lost.session, input(identity, source, true));
    assert.equal(restored.session.records.length, 2); assert.equal(journalNetworkState(restored.session), "CONNECTED");
    assert.equal(isOfflineEvidenceSessionJournalValid(restored.session), true);
    assert.equal(restored.nanoReceipt.adapterIdentity, identity); assert.equal(restored.nanoReceipt.observationSource, source);
    assert.equal("interfaceGuid" in restored.nanoReceipt, false); assert.equal("adapterBinding" in restored.nanoReceipt, false);
  }
});

test("unsupported identity and cross-paired Ethernet/Wi-Fi sources are refused", () => {
  const initial = createOfflineEvidenceSession("identity-run");
  for (const [identity, source] of [[ETHERNET_ADAPTER_IDENTITY, WIFI_PHYSICAL_SENTINEL_SOURCE], [WIFI_ADAPTER_IDENTITY, ETHERNET_PHYSICAL_SENTINEL_SOURCE], ["Other USB NIC", ETHERNET_PHYSICAL_SENTINEL_SOURCE]] as const) {
    assert.throws(() => appendNetworkTransition(initial, input(identity, source)), /supported physical adapter identity|physical sentinel source/);
  }
});

test("one global outage may be lost on one supported adapter and restored on another", () => {
  for (const [first, second] of [[pairs[0], pairs[1]], [pairs[1], pairs[0]]] as const) {
    const lost = appendNetworkTransition(createOfflineEvidenceSession("identity-run"), input(first[0], first[1]));
    const restored = appendNetworkTransition(lost.session, input(second[0], second[1], true));
    assert.equal(restored.session.networkState, "CONNECTED");
    assert.equal(journalNetworkState(restored.session), "CONNECTED");
    assert.equal(isOfflineEvidenceSessionJournalValid(restored.session), true);
    assert.deepEqual(restored.session.records.map((record) => record.payload.adapter_identity), [first[0], second[0]]);
  }
});

test("replay accepts coherent per-transition adapter identities after an automatic route change", () => {
  for (const [first, second] of [[pairs[0], pairs[1]], [pairs[1], pairs[0]]] as const) {
    const lost = appendNetworkTransition(createOfflineEvidenceSession("identity-run"), input(first[0], first[1]));
    const restored = appendNetworkTransition(lost.session, input(first[0], first[1], true));
    const old = restored.nanoReceipt;
    const unsigned = { ...old, adapterIdentity: second[0], observationSource: second[1], payload: { ...old.payload, adapter_identity: second[0], observation_source: second[1] } };
    const forged = { ...unsigned, canonicalDigest: canonicalRecordDigest(unsigned) };
    assert.equal(isSpecializedRecordProjectionValid(forged), true);
    const mixed = { ...restored.session, records: [lost.nanoReceipt, forged] };
    assert.equal(journalNetworkState(mixed), "CONNECTED"); assert.equal(isOfflineEvidenceSessionJournalValid(mixed), true);
    assert.doesNotThrow(() => buildMissionEvidenceClosure({ identity: { missionId: MISSION_ID, runId: mixed.runId }, runtimeRecords: mixed.records, asOfMasterTimeMs: FINAL_RECEIPT_EMITTED_MS }));
  }
});

test("replay rejects a re-digested BE200 receipt falsely claiming the Ethernet source", () => {
  const lost = appendNetworkTransition(createOfflineEvidenceSession("identity-run"), input(...pairs[1]));
  const unsigned = { ...lost.nanoReceipt, observationSource: ETHERNET_PHYSICAL_SENTINEL_SOURCE, payload: { ...lost.nanoReceipt.payload, observation_source: ETHERNET_PHYSICAL_SENTINEL_SOURCE } };
  const forged = { ...unsigned, canonicalDigest: canonicalRecordDigest(unsigned) };
  assert.equal(isSpecializedRecordProjectionValid(forged), true);
  assert.equal(journalNetworkState({ ...lost.session, records: [forged] }), null);
});

test("complete BE200 PEB is rebuilt by the existing offline verifier with the same assurance verdict as Ethernet", async () => {
  const verdicts: string[] = [];
  for (const [identity, source] of pairs) {
    let session = projectMissionEvidence(createOfflineEvidenceSession("complete-identity-run", null, MISSION_ID), FINAL_RECEIPT_EMITTED_MS);
    const at = session.records.at(-1)!.missionClockPosition + 1;
    assert.ok(at + 1 <= FINAL_RECEIPT_EMITTED_MS);
    session = appendNetworkTransition(session, input(identity, source, false, session.runId, at)).session;
    session = appendNetworkTransition(session, input(identity, source, true, session.runId, at + 1)).session;
    session = sealFinalReceiptRuntimeEvidence(session, FINAL_RECEIPT_EMITTED_MS);
    const records: readonly OfflineCausalRecord[] = finalReceiptRuntimeEvidencePrefix(session);
    const closure = buildMissionEvidenceClosure({ identity: { missionId: MISSION_ID, runId: session.runId }, runtimeRecords: records, asOfMasterTimeMs: FINAL_RECEIPT_EMITTED_MS });
    const finalReceipt = issueFinalMissionReceipt(closure, FINAL_RECEIPT_EMITTED_MS);
    const displayed = projectPortableProofLeaves(closure, PEB_COMPLETE_MS, finalReceipt).map(leaf => leaf.evidenceId);
    const peb = buildPortableMissionEvidenceBundle({ closure, finalReceipt, runtimeRecords: records, displayedEvidenceIds: displayed, masterTimeMs: PEB_COMPLETE_MS });
    const artifact = createHandoffArtifact(peb, HANDOFF_READY_MS);
    const result = await analyzeInsertedD006Peb(insertD006PebForAnalysis({ pebText: artifact.pebText, expectedIdentity: artifact.identity, expectedTransferredContentDigest: artifact.transferredContentDigest }));
    assert.notEqual(result.result.verdict, "INVALID", result.result.reasonCodes.join(","));
    verdicts.push(result.result.verdict);
  }
  assert.equal(verdicts[0], verdicts[1]);
});

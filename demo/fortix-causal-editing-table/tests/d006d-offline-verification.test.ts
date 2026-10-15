import assert from "node:assert/strict";
import test from "node:test";

import { LOCAL_EVIDENCE_RECORD } from "../app/evidenceContinuity.ts";
import {
  analyzeInsertedPebOffline,
  auditOfflineAnalysisNetworkIsolation,
  compareAfterReconnection,
  insertPebForOfflineAnalysis,
} from "../app/offlineVerification.ts";
import { D005M_MASTER_BUNDLE, createTamperedD005MMasterBundle } from "../app/masterStory.ts";
import { MISSION_ID } from "../app/missionContinuity.ts";
import { canonicalString } from "../app/verification.ts";

function insert(pebText = LOCAL_EVIDENCE_RECORD.bundleText, expectedMissionId = MISSION_ID) {
  return insertPebForOfflineAnalysis({
    pebText,
    expectedMissionId,
    networkPhase: "LOST",
  });
}

function cloneBundle(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(D005M_MASTER_BUNDLE)) as Record<string, unknown>;
}

test("D-006D: insertion stays in memory and waits for explicit ANALYZE", async () => {
  const inserted = insert("not-yet-valid-json");
  assert.equal(inserted.state, "AWAITING_ANALYZE");
  assert.equal(inserted.networkPhase, "LOST");
  assert.ok(Object.isFrozen(inserted));

  const analyzed = await analyzeInsertedPebOffline(inserted);
  assert.equal(analyzed.state, "CAPTURED_BEFORE_RESTORATION");
  assert.equal(analyzed.result.verdict, "INVALID");
  assert.deepEqual(analyzed.result.reasonCodes, ["D006D_PEB_TEXT_INVALID"]);
  assert.throws(
    () => insertPebForOfflineAnalysis({
      pebText: LOCAL_EVIDENCE_RECORD.bundleText,
      expectedMissionId: MISSION_ID,
      networkPhase: "CONNECTED",
    }),
    /requires the stable LOST network phase/,
  );
});

test("D-006D: manual local analysis captures an immutable verdict before restoration", async () => {
  const snapshot = await analyzeInsertedPebOffline(insert());
  assert.equal(snapshot.networkPhaseAtCapture, "LOST");
  assert.equal(snapshot.analyzedManually, true);
  assert.equal(snapshot.missionId, MISSION_ID);
  assert.equal(snapshot.result.verdict, "INDETERMINATE");
  // P2R: the verifier now also reports that the bundle's SETTLED assertion is
  // unsupported — a payment provider claiming an act only an account-holding
  // institution can perform, with no such institution in the evidence. The
  // array therefore carries two truthful reasons rather than one. Asserting
  // membership rather than exact equality keeps this honest without pinning
  // the verifier to under-reporting what it found.
  assert.ok(snapshot.result.reasonCodes.includes("D005M_PRODUCTION_TRUST_TIME_INCOMPLETE"));
  assert.ok(snapshot.result.reasonCodes.includes("D005M_SETTLEMENT_UNSUPPORTED_BY_EVIDENCE"));
  assert.match(String(snapshot.pebDigest), /^[0-9a-f]{64}$/);
  assert.match(String(snapshot.finalReceiptDigest), /^[0-9a-f]{64}$/);
  assert.match(String(snapshot.causalOrderDigest), /^[0-9a-f]{64}$/);
  assert.ok(Object.isFrozen(snapshot));
  assert.ok(Object.isFrozen(snapshot.result));
  assert.ok(Object.isFrozen(snapshot.result.reasonCodes));
});

test("D-006D: runtime network tripwire proves verification makes no fetch call", async () => {
  const audit = await auditOfflineAnalysisNetworkIsolation(insert());
  assert.equal(audit.localOnly, true);
  assert.deepEqual(audit.attemptedNetworkCalls, []);
  assert.equal(audit.snapshot.result.verdict, "INDETERMINATE");
});

test("D-006D: canonical verifier detects tampered, missing and reordered PEB material", async () => {
  const tampered = await analyzeInsertedPebOffline(insert(canonicalString(createTamperedD005MMasterBundle())));
  assert.equal(tampered.result.verdict, "INVALID");
  assert.deepEqual(tampered.result.reasonCodes, ["BUNDLE_DIGEST_MISMATCH"]);

  const missing = cloneBundle();
  (missing.canonical_evidence_objects as unknown[]).splice(10, 1);
  const missingResult = await analyzeInsertedPebOffline(insert(canonicalString(missing)));
  assert.equal(missingResult.result.verdict, "INVALID");
  assert.deepEqual(missingResult.result.reasonCodes, ["BUNDLE_DIGEST_MISMATCH"]);

  const reordered = cloneBundle();
  const objects = reordered.canonical_evidence_objects as unknown[];
  [objects[8], objects[9]] = [objects[9], objects[8]];
  const reorderedResult = await analyzeInsertedPebOffline(insert(canonicalString(reordered)));
  assert.equal(reorderedResult.result.verdict, "INVALID");
  assert.deepEqual(reorderedResult.result.reasonCodes, ["BUNDLE_DIGEST_MISMATCH"]);
});

test("D-006D: wrong Mission ID is rejected without trusting presentation state", async () => {
  const wrongExpectation = await analyzeInsertedPebOffline(insert(
    LOCAL_EVIDENCE_RECORD.bundleText,
    "fortix.demo.another-mission",
  ));
  assert.equal(wrongExpectation.result.verdict, "INVALID");
  assert.deepEqual(wrongExpectation.result.reasonCodes, ["D006D_MISSION_ID_MISMATCH"]);

  const alteredMission = cloneBundle();
  const verification = alteredMission.verification_manifest as { target_evidence_ids: string[] };
  const objects = alteredMission.canonical_evidence_objects as Array<Record<string, unknown>>;
  const receipt = objects.find((candidate) => candidate.evidence_id === verification.target_evidence_ids[0]);
  assert.ok(receipt);
  (receipt.causal_links as { causal_chain_id: string }).causal_chain_id = "fortix.demo.another-mission";
  const alteredResult = await analyzeInsertedPebOffline(insert(canonicalString(alteredMission)));
  assert.equal(alteredResult.result.verdict, "INVALID");
  assert.deepEqual(alteredResult.result.reasonCodes, ["BUNDLE_DIGEST_MISMATCH"]);
});

test("D-006D: reconnection cannot rewrite the captured verdict or digests", async () => {
  const captured = await analyzeInsertedPebOffline(insert());
  const baseline = {
    verdict: captured.result.verdict,
    pebDigest: captured.pebDigest,
    finalReceiptDigest: captured.finalReceiptDigest,
    causalOrderDigest: captured.causalOrderDigest,
  };
  const unchanged = compareAfterReconnection(captured, {
    pebText: LOCAL_EVIDENCE_RECORD.bundleText,
    expectedMissionId: MISSION_ID,
    sourceClaimedVerdict: "VALID",
  });
  assert.strictEqual(unchanged.captured, captured);
  assert.equal(unchanged.missionIdUnchanged, true);
  assert.equal(unchanged.pebDigestUnchanged, true);
  assert.equal(unchanged.finalReceiptDigestUnchanged, true);
  assert.equal(unchanged.causalOrderUnchanged, true);
  assert.equal(unchanged.verdictUnchanged, true);
  assert.equal(unchanged.sourceClaimedVerdictAccepted, false);

  const changedBundle = canonicalString(createTamperedD005MMasterBundle());
  const contradiction = compareAfterReconnection(captured, {
    pebText: changedBundle,
    expectedMissionId: "fortix.demo.another-mission",
    sourceClaimedVerdict: "VALID",
  });
  assert.strictEqual(contradiction.captured, captured);
  assert.equal(contradiction.missionIdUnchanged, false);
  assert.equal(contradiction.pebDigestUnchanged, false);
  assert.equal(contradiction.finalReceiptDigestUnchanged, true);
  assert.equal(contradiction.verdictUnchanged, true);
  assert.equal(contradiction.sourceClaimedVerdictAccepted, false);
  assert.deepEqual({
    verdict: captured.result.verdict,
    pebDigest: captured.pebDigest,
    finalReceiptDigest: captured.finalReceiptDigest,
    causalOrderDigest: captured.causalOrderDigest,
  }, baseline);
});

import assert from "node:assert/strict";
import test from "node:test";

import { blake3 } from "@noble/hashes/blake3.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

import {
  canonicalIdentityDigest,
  canonicalSignedDigest,
  verifyCanonicalEvidenceSignatures,
} from "../app/canonicalSignature.ts";
import { D005M_MASTER_BUNDLE, verifyD005MMasterBundle } from "../app/masterStory.ts";
import { assessSettlementScope } from "../app/settlementScope.ts";
import { canonicalString } from "../app/verification.ts";

/**
 * D-006G P2R — adversarial tests reproducing the Codex blockers.
 *
 * The audit's central finding: the mounted verifier recomputed digests and
 * nothing else, so an object whose payload had been altered and whose hashes
 * had been recomputed to match was accepted with the IDENTICAL verdict, reason
 * code and check list as the genuine bundle. Recomputing a digest proves a
 * bundle agrees with itself; an attacker editing a payload recomputes those
 * digests as a matter of course.
 *
 * Each test below forges the bundle in a different way and asserts the
 * verifier fails closed.
 */

type Bundle = Record<string, unknown>;

function digest(value: unknown): string {
  return bytesToHex(blake3(utf8ToBytes(canonicalString(value))));
}

function clone(): Bundle {
  return JSON.parse(JSON.stringify(D005M_MASTER_BUNDLE)) as Bundle;
}

/** Recomputes the index and bundle digest, as any competent forger would. */
function reseal(bundle: Bundle): Bundle {
  const objects = bundle.canonical_evidence_objects as Record<string, unknown>[];
  bundle.evidence_index = objects.map((object, ordinal) => ({
    ordinal,
    evidence_id: object.evidence_id,
    object_digest: digest(object),
  }));
  const probe = JSON.parse(JSON.stringify(bundle)) as Bundle;
  (probe.integrity_manifest as Record<string, unknown>).bundle_digest = "";
  (bundle.integrity_manifest as Record<string, unknown>).bundle_digest = digest(probe);
  return bundle;
}

function objectByEvent(bundle: Bundle, eventId: string): Record<string, unknown> {
  const objects = bundle.canonical_evidence_objects as Record<string, unknown>[];
  const found = objects.find((object) =>
    (object.significant_event as Record<string, unknown> | undefined)?.event_id === eventId);
  assert.ok(found !== undefined, `${eventId} not present`);
  return found;
}

// --- the genuine article, so the contrast is meaningful -------------------

test("P2R-1: the genuine bundle verifies, and stays INDETERMINATE", async () => {
  const result = await verifyD005MMasterBundle();
  assert.equal(result.verdict, "INDETERMINATE");
  // Signatures being authentic does not establish production trust anchors.
  assert.ok(result.reasonCodes.includes("D005M_PRODUCTION_TRUST_TIME_INCOMPLETE"));
  assert.ok(result.completedChecks.includes("canonical_signatures_verified"));
  assert.ok(result.completedChecks.includes("evidence_identities_derived"));
});

test("P2R-1: every object in the shipped bundle is genuinely signed", async () => {
  const bundle = D005M_MASTER_BUNDLE as unknown as Bundle;
  const verification = await verifyCanonicalEvidenceSignatures(
    bundle.canonical_evidence_objects as unknown[],
    (bundle.trust_material as Record<string, unknown>).verification_keys as unknown[],
  );
  assert.equal(verification.signedCount, 45);
  assert.equal(verification.unsignedCount, 0);
  assert.equal(verification.allSignaturesValid, true);
  assert.equal(verification.allIdentitiesDerived, true);
  assert.deepEqual(verification.invalidSignatureIds, []);
});

// --- the blocker, reproduced ---------------------------------------------

test("P2R-1 BLOCKER: a forged payload with recomputed hashes is rejected", async () => {
  const bundle = clone();
  const target = objectByEvent(bundle, "d005m.master-payment-result");
  const payload = target.evidence_payload as Record<string, unknown>;
  const details = (payload.result as Record<string, unknown>).details as Record<string, unknown>;

  assert.equal(details.amount_eur, 1850, "the fixture changed; this test is calibrated to 1850");
  details.amount_eur = 999_999;
  // Recompute exactly what the old verifier checked.
  (target.evidence_integrity as Record<string, unknown>).payload_digest = digest(payload);
  reseal(bundle);

  const result = await verifyD005MMasterBundle(bundle);
  assert.notEqual(result.verdict, "VALID");
  assert.equal(result.verdict, "INVALID",
    "a forgery that survives digest recomputation must not be accepted");
  assert.ok(result.reasonCodes.includes("D005M_CANONICAL_SIGNATURE_INVALID"));
});

test("P2R-1 BLOCKER: forging the identity as well does not help", async () => {
  const bundle = clone();
  const target = objectByEvent(bundle, "d005m.master-payment-result");
  const payload = target.evidence_payload as Record<string, unknown>;
  ((payload.result as Record<string, unknown>).details as Record<string, unknown>).amount_eur = 999_999;
  (target.evidence_integrity as Record<string, unknown>).payload_digest = digest(payload);
  // Rebuild the evidence_id from the altered content so identity derivation
  // passes too — the next thing a forger tries.
  target.evidence_id = `fortix:evidence:blake3:${canonicalIdentityDigest(target)}`;
  reseal(bundle);

  const result = await verifyD005MMasterBundle(bundle);
  assert.equal(result.verdict, "INVALID");
  assert.ok(result.reasonCodes.includes("D005M_CANONICAL_SIGNATURE_INVALID"),
    "the signature, not a structural side effect, must be what catches this");
});

test("P2R-1: removing a signature fails closed rather than skipping the check", async () => {
  const bundle = clone();
  delete (bundle.canonical_evidence_objects as Record<string, unknown>[])[3].signature;
  reseal(bundle);
  const result = await verifyD005MMasterBundle(bundle);
  assert.equal(result.verdict, "INVALID");
  assert.ok(result.reasonCodes.includes("D005M_EVIDENCE_UNSIGNED"));
});

test("P2R-1: an attacker cannot supply their own verification key", async () => {
  // THIS TEST PASSED FOR THE WRONG REASON IN P2R, and the correction matters.
  //
  // It used an all-zero public key, which cannot verify anything, so the run
  // failed at the SIGNATURE check and the test went green — while the actual
  // question, "who authorized this key?", was never asked. Codex attack G then
  // supplied a real attacker keypair, re-signed every object with it, and the
  // bundle became indistinguishable from the genuine one.
  //
  // P3-A resolves authorization against a pinned directory the bundle cannot
  // reach, so a substituted key is now caught as a substitution — before any
  // signature is checked, because a signature under an unauthorized key is not
  // a weaker form of valid, it is irrelevant. The attack with a WORKING
  // attacker key is covered in d006g-p3-trust-authorization.test.ts.
  const bundle = clone();
  (bundle.trust_material as Record<string, unknown>).verification_keys = [{
    key_id: "fortix.demo.key.d005",
    public_key_hex: "00".repeat(32),
    trust_anchor_id: "attacker.anchor",
    trust_anchor_evidence_id: "attacker.evidence",
  }];
  reseal(bundle);
  const result = await verifyD005MMasterBundle(bundle);
  assert.equal(result.verdict, "INVALID");
  assert.ok(result.reasonCodes.includes("D005M_VERIFICATION_KEY_SUBSTITUTED"),
    "a key contradicting the pinned directory is a substitution, not a bad signature");
});

test("P2R-1: a signature lifted from another object is rejected", async () => {
  const bundle = clone();
  const objects = bundle.canonical_evidence_objects as Record<string, unknown>[];
  const borrowed = objects[2].signature;
  objects[2].signature = objects[3].signature;
  objects[3].signature = borrowed;
  reseal(bundle);
  const result = await verifyD005MMasterBundle(bundle);
  assert.equal(result.verdict, "INVALID");
  assert.ok(result.reasonCodes.includes("D005M_CANONICAL_SIGNATURE_INVALID"));
});

test("P2R-1: changing the declared issuer invalidates the signature", async () => {
  const bundle = clone();
  const objects = bundle.canonical_evidence_objects as Record<string, unknown>[];
  objects[5].issuer = { issuer_id: "fortix.demo.attacker", issuer_type: "DEMO" };
  reseal(bundle);
  const result = await verifyD005MMasterBundle(bundle);
  assert.equal(result.verdict, "INVALID");
  assert.ok(result.reasonCodes.includes("D005M_CANONICAL_SIGNATURE_INVALID"),
    "the signature must commit to who issued the object");
});

test("P2R-1: an empty or unsigned bundle is never 'all valid'", async () => {
  const empty = await verifyCanonicalEvidenceSignatures([], []);
  assert.equal(empty.allSignaturesValid, false, "vacuous truth must not read as verified");
  assert.equal(empty.allIdentitiesDerived, false);

  const unsigned = await verifyCanonicalEvidenceSignatures([{ evidence_id: "x" }], []);
  assert.equal(unsigned.allSignaturesValid, false);
  assert.equal(unsigned.unsignedCount, 1);
});

test("P2R-1: the two digests are distinct, and the signature commits to identity", () => {
  const object = (D005M_MASTER_BUNDLE as unknown as Bundle)
    .canonical_evidence_objects as Record<string, unknown>[];
  const first = object[0];
  // The identity digest excludes evidence_id; the signed digest includes it.
  assert.notEqual(canonicalIdentityDigest(first), canonicalSignedDigest(first));
  assert.equal(String(first.evidence_id).split(":").pop(), canonicalIdentityDigest(first));
});

// --- P2R-4: an authentic assertion is not a demonstrated fact ------------

test("P2R-4 BLOCKER: SETTLED is quarantined, not promoted", async () => {
  const bundle = D005M_MASTER_BUNDLE as unknown as Bundle;
  const scope = assessSettlementScope(bundle.canonical_evidence_objects as unknown[]);

  assert.equal(scope.assertions.length, 1, "the fixture asserts settlement exactly once");
  assert.equal(scope.assertions[0].eventId, "d005m.master-payment-result");
  // Asserted by a payment PROCESSOR. Only an account-holding institution
  // settles funds, and there is none anywhere in the 45 objects.
  assert.match(scope.assertions[0].issuerId, /payment-provider/);
  assert.equal(scope.financialInstitutionPresent, false);
  assert.equal(scope.quarantined, true);

  const result = await verifyD005MMasterBundle();
  assert.ok(result.reasonCodes.includes("D005M_SETTLEMENT_UNSUPPORTED_BY_EVIDENCE"),
    "the verifier must report that the settlement claim is unsupported");
  assert.notEqual(result.verdict, "VALID",
    "an unsupported settlement claim may never support a positive verdict");
});

test("P2R-4: a settlement asserted BY a financial institution is not quarantined", () => {
  // The quarantine must be about missing support, not about the word itself,
  // or it would fire on a bundle that legitimately contained a bank.
  const withBank = assessSettlementScope([
    {
      evidence_id: "fortix:evidence:blake3:aa",
      significant_event: { event_id: "bank.settlement" },
      issuer: { issuer_id: "fortix.demo.bank" },
      trust_boundary: { trust_boundary_id: "fortix.demo.boundary.bank" },
      evidence_payload: { result: { provider_result: "SETTLED" } },
    },
  ]);
  assert.equal(withBank.assertions.length, 1);
  assert.equal(withBank.financialInstitutionPresent, true);
  assert.equal(withBank.quarantined, false);
});

test("P2R-4: a boundary merely named 'bank' does not create a settlement claim", () => {
  const noClaim = assessSettlementScope([
    {
      evidence_id: "fortix:evidence:blake3:bb",
      trust_boundary: { trust_boundary_id: "fortix.demo.boundary.bank" },
      evidence_payload: { result: { confirmation: "AUTHORIZATION_RECORDED" } },
    },
  ]);
  assert.equal(noClaim.assertions.length, 0, "authorisation is not settlement");
  assert.equal(noClaim.quarantined, false);
});

// --- P2R-2: reconciliation may not claim a transfer that did not happen ---

test("P2R-2 BLOCKER: an acknowledgement without operation evidence fails closed", async () => {
  const { createOfflineEvidenceSession, appendNetworkTransition, appendOfflineEvidence,
    capturePreRestorationArtifacts, reconcileOfflineEvidence,
    PHYSICAL_SENTINEL_SOURCE, TARGET_ADAPTER_IDENTITY } = await import("../app/offlineEvidence.ts");
  const { D005M_MASTER_BUNDLE_ID, D005M_MASTER_CYCLE_RECEIPT_ID,
    D005M_MASTER_CYCLE_RECEIPT: receipt, D005M_MASTER_BUNDLE: peb } = await import("../app/masterStory.ts");

  const mission = "fortix.demo.p2r.transfer";
  const artifacts = {
    finalReceipt: { ref: D005M_MASTER_CYCLE_RECEIPT_ID, value: receipt as never },
    portableEvidenceBundle: { ref: D005M_MASTER_BUNDLE_ID, value: peb as never },
    verdict: "INDETERMINATE" as const,
  };

  let session = createOfflineEvidenceSession(mission);
  session = appendNetworkTransition(session, {
    runId: session.runId,
    observationId: "loss", adapterIdentity: TARGET_ADAPTER_IDENTITY,
    observationSource: PHYSICAL_SENTINEL_SOURCE,
    previousNetworkState: "CONNECTED", newNetworkState: "LOST", missionClockPosition: 1_000,
  }).session;
  session = appendOfflineEvidence(session, {
    missionId: session.missionId, runId: session.runId,
    eventId: "work", eventType: "MISSION_EVENT_CONTINUED_OFFLINE",
    receiptId: "NR-OFFLINE:work", missionClockPosition: 2_000,
    executionLocality: "LOCAL", payload: {},
  }).session;
  const captured = capturePreRestorationArtifacts(session, { ...artifacts, missionClockPosition: 3_000 });
  session = appendNetworkTransition(captured.session, {
    runId: captured.session.runId,
    observationId: "restored", adapterIdentity: TARGET_ADAPTER_IDENTITY,
    observationSource: PHYSICAL_SENTINEL_SOURCE,
    previousNetworkState: "LOST", newNetworkState: "CONNECTED", missionClockPosition: 4_000,
  }).session;

  // The base every real caller passes: empty. Nothing in this demonstration
  // carries journal records to a base at all.
  const result = reconcileOfflineEvidence({
    session, operation: null,
    capture: captured.capture, currentArtifacts: artifacts,
  });

  assert.equal(result.status, "FAILED");
  assert.equal(result.receipt, null);
  assert.equal(result.transferredObjectCount, 0,
    "nothing left the browser, so nothing may be counted as transferred");
  assert.equal(result.reasonCodes.includes("RECONCILIATION_EVIDENCE_MISSING"), true,
    "a match may not be asserted over zero comparisons");
  assert.equal(result.reasonCodes.includes("RECONCILIATION_EVIDENCE_MISSING"), true,
    "OFFLINE WINDOW CLOSED LOCALLY · NO BASE COMPARISON");
  // The intent is still recorded, and remains a different fact from the act.
  assert.equal(result.reconciledBase, null);
});

test("P2R-2: a base with real records still reconciles and reports a real transfer", async () => {
  const { createOfflineEvidenceSession, appendNetworkTransition, appendOfflineEvidence,
    capturePreRestorationArtifacts, reconcileOfflineEvidence,
    PHYSICAL_SENTINEL_SOURCE, TARGET_ADAPTER_IDENTITY } = await import("../app/offlineEvidence.ts");
  const { D005M_MASTER_BUNDLE_ID, D005M_MASTER_CYCLE_RECEIPT_ID,
    D005M_MASTER_CYCLE_RECEIPT: receipt, D005M_MASTER_BUNDLE: peb } = await import("../app/masterStory.ts");

  const mission = "fortix.demo.p2r.realbase";
  const artifacts = {
    finalReceipt: { ref: D005M_MASTER_CYCLE_RECEIPT_ID, value: receipt as never },
    portableEvidenceBundle: { ref: D005M_MASTER_BUNDLE_ID, value: peb as never },
    verdict: "INDETERMINATE" as const,
  };
  let session = createOfflineEvidenceSession(mission);
  session = appendNetworkTransition(session, {
    runId: session.runId,
    observationId: "loss", adapterIdentity: TARGET_ADAPTER_IDENTITY,
    observationSource: PHYSICAL_SENTINEL_SOURCE,
    previousNetworkState: "CONNECTED", newNetworkState: "LOST", missionClockPosition: 1_000,
  }).session;
  session = appendOfflineEvidence(session, {
    missionId: session.missionId, runId: session.runId,
    eventId: "work", eventType: "MISSION_EVENT_CONTINUED_OFFLINE",
    receiptId: "NR-OFFLINE:work", missionClockPosition: 2_000,
    executionLocality: "LOCAL", payload: {},
  }).session;
  const captured = capturePreRestorationArtifacts(session, { ...artifacts, missionClockPosition: 3_000 });
  session = appendNetworkTransition(captured.session, {
    runId: captured.session.runId,
    observationId: "restored", adapterIdentity: TARGET_ADAPTER_IDENTITY,
    observationSource: PHYSICAL_SENTINEL_SOURCE,
    previousNetworkState: "LOST", newNetworkState: "CONNECTED", missionClockPosition: 4_000,
  }).session;

  // A base that genuinely holds the first record: a comparison is possible.
  const result = reconcileOfflineEvidence({
    session,
    operation: {
      kind: "BASE_COMPARE_TRANSFER",
      operationId: "p2r.real-base-transfer",
      baseBefore: { missionId: session.missionId, runId: session.runId, records: [session.records[0]!] },
      baseAfter: { missionId: session.missionId, runId: session.runId, records: session.records },
      transferredReceiptIds: session.records.slice(1).map((record) => record.receiptId),
    },
    capture: captured.capture, currentArtifacts: artifacts,
  });
  assert.equal(result.status, "COMPLETE");
  assert.equal(result.receipt?.digestComparison, "MATCH",
    "where a comparison happened, the match may be reported");
  assert.ok((result.receipt?.transferredObjectCount ?? 0) > 0,
    "a real base makes a real transfer count meaningful");
});

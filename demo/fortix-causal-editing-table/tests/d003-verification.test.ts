import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { blake3 } from "@noble/hashes/blake3.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

import {
  CANONICAL_EVIDENCE_OBJECTS,
  type CanonicalEvidenceObject,
} from "../app/evidence.ts";
import {
  D003_REQUIRED_EVENT_IDS,
  FINAL_RECEIPT_ELIGIBILITY_MS,
  deriveFinalReceiptAvailability,
  summarizeBundleMaterials,
} from "../app/d003.ts";
import {
  D003_PORTABLE_BUNDLE,
  canonicalString,
  createControlledTamper,
  verifyPortableEvidenceBundle,
} from "../app/verification.ts";

test("Final Receipt cannot exist before evidence eligibility", () => {
  const before = deriveFinalReceiptAvailability(FINAL_RECEIPT_ELIGIBILITY_MS - 1);
  assert.equal(before.available, false);
  assert.equal(before.reasonCode, "D003_BEFORE_COMPILATION_ELIGIBILITY");

  const atEligibility = deriveFinalReceiptAvailability(FINAL_RECEIPT_ELIGIBILITY_MS);
  assert.equal(atEligibility.available, true);
});

test("missing required evidence fails compilation availability explicitly", () => {
  const incomplete = CANONICAL_EVIDENCE_OBJECTS.filter(
    (evidence) => evidence.significant_event.event_id !== "d002.brake-command",
  );
  const state = deriveFinalReceiptAvailability(FINAL_RECEIPT_ELIGIBILITY_MS, incomplete);
  assert.equal(state.available, false);
  if (state.available) assert.fail("receipt must not compile");
  assert.equal(state.reasonCode, "D003_REQUIRED_EVIDENCE_MISSING");
  assert.deepEqual(state.missingEventIds, ["d002.brake-command"]);
});

test("input order cannot change receipt or bundle derivation", () => {
  const forward = deriveFinalReceiptAvailability(
    FINAL_RECEIPT_ELIGIBILITY_MS,
    CANONICAL_EVIDENCE_OBJECTS,
  );
  const reverse = deriveFinalReceiptAvailability(
    FINAL_RECEIPT_ELIGIBILITY_MS,
    [...CANONICAL_EVIDENCE_OBJECTS].reverse(),
  );
  assert.equal(forward.available, true);
  assert.equal(reverse.available, true);
  if (!forward.available || !reverse.available) assert.fail("receipt should compile");
  assert.equal(canonicalString(forward.finalReceipt), canonicalString(reverse.finalReceipt));
  assert.equal(canonicalString(forward.portableBundle), canonicalString(reverse.portableBundle));
});

test("rewind removes the receipt and replay reconstructs identical artifacts", () => {
  const first = deriveFinalReceiptAvailability(FINAL_RECEIPT_ELIGIBILITY_MS);
  const rewound = deriveFinalReceiptAvailability(3_760);
  const replayed = deriveFinalReceiptAvailability(FINAL_RECEIPT_ELIGIBILITY_MS);
  assert.equal(first.available, true);
  assert.equal(rewound.available, false);
  assert.equal(replayed.available, true);
  if (!first.available || !replayed.available) assert.fail("receipt should be available");
  assert.equal(canonicalString(first.finalReceipt), canonicalString(replayed.finalReceipt));
  assert.equal(canonicalString(first.portableBundle), canonicalString(replayed.portableBundle));
});

test("bundle carries the complete required event set and explicit target", () => {
  const eventIds = new Set(
    D003_PORTABLE_BUNDLE.canonical_evidence_objects.map(
      (evidence) => evidence.significant_event.event_id,
    ),
  );
  for (const eventId of D003_REQUIRED_EVENT_IDS) assert.equal(eventIds.has(eventId), true);
  assert.equal(D003_PORTABLE_BUNDLE.verification_manifest.target_evidence_ids.length, 1);
  assert.equal(
    eventIds.has("d003.final-receipt.emergency-braking-before-impact"),
    true,
  );
});

test("independent verifier recomputes an honest demo-scope verdict", async () => {
  const portableCopy = JSON.parse(JSON.stringify(D003_PORTABLE_BUNDLE));
  const result = await verifyPortableEvidenceBundle({ portableBundle: portableCopy });
  assert.equal(result.verdict, "INDETERMINATE");
  assert.deepEqual(result.reasonCodes, ["D003_PRODUCTION_TRUST_TIME_INCOMPLETE"]);
  assert.deepEqual(
    result.layers.map(({ id, status }) => [id, status]),
    [
      ["receipt_integrity", "VERIFIED"],
      ["signature_authenticity", "VERIFIED"],
      ["evidence_binding", "VERIFIED"],
      ["causal_consistency", "VERIFIED"],
      ["trust_time", "INCOMPLETE"],
    ],
  );
});

test("source verdict cannot influence independent verification", async () => {
  const claimedValid = await verifyPortableEvidenceBundle({
    portableBundle: D003_PORTABLE_BUNDLE,
    sourceClaimedVerdict: "VALID",
  });
  const claimedInvalid = await verifyPortableEvidenceBundle({
    portableBundle: D003_PORTABLE_BUNDLE,
    sourceClaimedVerdict: "INVALID",
  });
  assert.deepEqual(claimedValid, claimedInvalid);
  assert.equal(claimedValid.verdict, "INDETERMINATE");
});

test("verifier consumes portable input without UI or mutable session state", async () => {
  const detachedBytes = canonicalString(D003_PORTABLE_BUNDLE);
  const detachedBundle = JSON.parse(detachedBytes);
  const unrelatedMutableSession = {
    masterTime: 0,
    reality: "mutated",
    system: "mutated",
    proof: "mutated",
  };
  const first = await verifyPortableEvidenceBundle({ portableBundle: detachedBundle });
  unrelatedMutableSession.masterTime = 6_000;
  unrelatedMutableSession.reality = "different";
  const second = await verifyPortableEvidenceBundle({
    portableBundle: JSON.parse(detachedBytes),
  });
  assert.deepEqual(first, second);
});

test("controlled alteration and missing bundle element cannot return VALID", async () => {
  const altered = await verifyPortableEvidenceBundle({
    portableBundle: createControlledTamper(D003_PORTABLE_BUNDLE),
    sourceClaimedVerdict: "VALID",
  });
  assert.equal(altered.verdict, "INVALID");
  assert.deepEqual(altered.reasonCodes, ["BUNDLE_DIGEST_MISMATCH"]);

  const missing = JSON.parse(JSON.stringify(D003_PORTABLE_BUNDLE));
  missing.canonical_evidence_objects.splice(4, 1);
  const missingResult = await verifyPortableEvidenceBundle({ portableBundle: missing });
  assert.equal(missingResult.verdict, "INVALID");
  assert.notEqual(missingResult.verdict, "VALID");
});

test("a well-formed bundle without declared trust/time material is indeterminate", async () => {
  const missingTrustTime = JSON.parse(JSON.stringify(D003_PORTABLE_BUNDLE));
  missingTrustTime.trust_material.trusted_time_evidence_ids = [];
  missingTrustTime.integrity_manifest.bundle_digest = "";
  missingTrustTime.integrity_manifest.bundle_digest = bytesToHex(
    blake3(utf8ToBytes(canonicalString(missingTrustTime))),
  );

  const result = await verifyPortableEvidenceBundle({
    portableBundle: missingTrustTime,
  });
  assert.equal(result.verdict, "INDETERMINATE");
  assert.deepEqual(result.reasonCodes, ["TRUST_MATERIAL_MISSING"]);
});

test("material presentation distinguishes embedded and unavailable evidence honestly", () => {
  const materials = summarizeBundleMaterials();
  assert.equal(materials.embedded.some((item) => item.label === "Final Receipt"), true);
  assert.deepEqual(materials.referenced, []);
  assert.equal(materials.unavailable[0].label, "Raw sensor streams");
  assert.match(materials.unavailable[0].note, /not asserted by hash/i);
});

test("D-003 verification logic has no wall-clock dependency", () => {
  const source = [
    readFileSync(new URL("../app/d003.ts", import.meta.url), "utf8"),
    readFileSync(new URL("../app/verification.ts", import.meta.url), "utf8"),
  ].join("\n");
  assert.doesNotMatch(source, /Date\.now|new Date|performance\.now|setTimeout|setInterval/);
});

test("all D-002 evidence inputs remain immutable to D-003 derivation", () => {
  const before = canonicalString(CANONICAL_EVIDENCE_OBJECTS);
  deriveFinalReceiptAvailability(
    FINAL_RECEIPT_ELIGIBILITY_MS,
    CANONICAL_EVIDENCE_OBJECTS as readonly CanonicalEvidenceObject[],
  );
  assert.equal(canonicalString(CANONICAL_EVIDENCE_OBJECTS), before);
});

test("D-003 bilingual presentation uses the canonical EN and FR wording", () => {
  const englishLocale = readFileSync(
    new URL("../../../site/src/i18n/locales/en.ts", import.meta.url),
    "utf8",
  );
  const frenchLocale = readFileSync(
    new URL("../../../site/src/i18n/locales/fr.ts", import.meta.url),
    "utf8",
  );
  const component = readFileSync(
    new URL("../app/CausalEditingTable.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    englishLocale,
    /receiptTravelsWithEvidence: "The receipt travels with the evidence needed to verify it\."/,
  );
  assert.match(
    frenchLocale,
    /receiptTravelsWithEvidence: "Le reçu voyage avec les preuves nécessaires à sa vérification\."/,
  );
  assert.doesNotMatch(component, /The evidence travels with the receipt\./);
  assert.match(component, /t\.d003\.receiptTravelsWithEvidence/);
  assert.match(
    englishLocale,
    /verifyReceiptIndependently: "Verify this receipt independently"/,
  );
  assert.match(
    frenchLocale,
    /verifyReceiptIndependently: "Vérifier l’authenticité de ce reçu"/,
  );
  assert.match(component, /t\.d003\.verifyReceiptIndependently/);
});

test("D-003P keeps receipt primary and expert verification detail disclosed", () => {
  const component = readFileSync(
    new URL("../app/CausalEditingTable.tsx", import.meta.url),
    "utf8",
  );

  const receiptPosition = component.indexOf('className="final-receipt-card"');
  const evidencePosition = component.indexOf('className="supporting-evidence"');

  assert.ok(receiptPosition >= 0, "Final Receipt must remain visible");
  assert.ok(
    evidencePosition > receiptPosition,
    "supporting evidence must follow the visually primary Final Receipt",
  );
  assert.match(component, /<details className="verifier-depth">/);
  assert.match(component, /<summary>\{result === null \? "Verification details" : "Why this verdict\?"\}<\/summary>/);
  assert.doesNotMatch(component, /D003_PRODUCTION_TRUST_TIME_INCOMPLETE/);
  assert.doesNotMatch(component, /Deterministic replay ready/);
  assert.doesNotMatch(component, />PORTABLE EVIDENCE BUNDLE</);
});

test("localized presentation cannot change canonical D-003 artifact bytes", () => {
  const receipt = readFileSync(
    new URL("../data/d003-final-receipt.json", import.meta.url),
  );
  const bundle = readFileSync(
    new URL("../data/d003-portable-evidence-bundle.json", import.meta.url),
  );

  assert.equal(
    createHash("sha256").update(receipt).digest("hex"),
    "c6397ba1585d2c27f09d2b06baf5e283e3846c3570aa7e67ad36e68f04d34cb6",
  );
  assert.equal(
    createHash("sha256").update(bundle).digest("hex"),
    "f597f5c880f2e8ce6ed2330a52e0ca9c6ad3075ce25ef6ff0d87463412b6ed6c",
  );
  const canonicalText = receipt.toString("utf8") + bundle.toString("utf8");
  assert.doesNotMatch(canonicalText, /receiptTravelsWithEvidence/);
  assert.doesNotMatch(canonicalText, /Le reçu voyage avec les preuves nécessaires/);
});

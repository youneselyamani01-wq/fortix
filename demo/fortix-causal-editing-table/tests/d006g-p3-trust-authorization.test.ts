import assert from "node:assert/strict";
import test from "node:test";

import { blake3 } from "@noble/hashes/blake3.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

import { D005M_MASTER_BUNDLE, verifyD005MMasterBundle } from "../app/masterStory.ts";
import {
  PINNED_TRUST_ANCHORS,
  assessPresentedTrustMaterial,
  resolveKeyAuthorization,
  type TrustAnchorEntry,
} from "../app/trustAnchors.ts";
import { canonicalString } from "../app/verification.ts";

/**
 * D-006G P3-A — Codex attack G, and the trust model that answers it.
 *
 * THE ATTACK. Generate an attacker Ed25519 keypair, re-sign every object in
 * the genuine bundle with it, and present that public key under the genuine
 * `key_id`. Before this work the result was INDISTINGUISHABLE from the real
 * bundle: same verdict, same reason codes, all nine checks including
 * `canonical_signatures_verified`.
 *
 * The signatures were valid. They were valid under the ATTACKER'S key, and
 * nothing in the verification path asked whose key it was — the keys came from
 * `trust_material.verification_keys`, inside the artifact being verified. The
 * bundle authenticated itself.
 *
 * These tests are the permanent regression for that attack, and they assert the
 * distinction the whole phase turns on:
 *
 *   SIGNATURE VALIDITY != KEY AUTHORIZATION != ISSUER AUTHENTICITY
 *                      != CLAIM TRUTH       != PRODUCTION TRUST
 */

type Bundle = Record<string, unknown>;

const digest = (value: unknown) => bytesToHex(blake3(utf8ToBytes(canonicalString(value))));

function without(object: Record<string, unknown>, keys: readonly string[]) {
  const copy: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(object)) if (!keys.includes(key)) copy[key] = value;
  return copy;
}

function clone(): Bundle {
  return JSON.parse(JSON.stringify(D005M_MASTER_BUNDLE)) as Bundle;
}

/** Recomputes every digest a forger can recompute. */
function reseal(bundle: Bundle): Bundle {
  const objects = bundle.canonical_evidence_objects as Record<string, unknown>[];
  bundle.evidence_index = objects.map((object, ordinal) => ({
    ordinal, evidence_id: object.evidence_id, object_digest: digest(object),
  }));
  const probe = JSON.parse(JSON.stringify(bundle)) as Bundle;
  (probe.integrity_manifest as Record<string, unknown>).bundle_digest = "";
  (bundle.integrity_manifest as Record<string, unknown>).bundle_digest = digest(probe);
  return bundle;
}

async function attackerKeypair() {
  const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  return {
    publicKeyHex: bytesToHex(raw),
    sign: async (message: Uint8Array) => bytesToHex(new Uint8Array(
      await crypto.subtle.sign({ name: "Ed25519" }, pair.privateKey, message as unknown as BufferSource),
    )),
  };
}

function paymentResult(bundle: Bundle): Record<string, unknown> {
  const objects = bundle.canonical_evidence_objects as Record<string, unknown>[];
  const found = objects.find((object) =>
    (object.significant_event as Record<string, unknown> | undefined)?.event_id
      === "d005m.master-payment-result");
  assert.ok(found !== undefined);
  return found;
}

// --- THE ATTACK ----------------------------------------------------------

test("P3-A ATTACK G: an attacker key with valid signatures is rejected", async () => {
  const attacker = await attackerKeypair();
  const bundle = clone();

  // Forge a claim.
  const target = paymentResult(bundle);
  const payload = target.evidence_payload as Record<string, unknown>;
  const details = (payload.result as Record<string, unknown>).details as Record<string, unknown>;
  assert.equal(details.amount_eur, 1850, "fixture changed; this attack is calibrated to 1850");
  details.amount_eur = 999_999;
  (target.evidence_integrity as Record<string, unknown>).payload_digest = digest(payload);
  target.evidence_id = `fortix:evidence:blake3:${digest(without(target, ["signature", "evidence_id"]))}`;

  // Sign EVERY object correctly with the attacker's key.
  for (const object of bundle.canonical_evidence_objects as Record<string, unknown>[]) {
    object.signature = await attacker.sign(utf8ToBytes(digest(without(object, ["signature"]))));
  }
  // Present the attacker key under the genuine key_id and anchor id.
  (bundle.trust_material as Record<string, unknown>).verification_keys = [{
    key_id: "fortix.demo.key.d005",
    public_key_hex: attacker.publicKeyHex,
    trust_anchor_id: "fortix.demo.anchor.d005",
    trust_anchor_evidence_id: "fortix:evidence:blake3:whatever",
  }];
  reseal(bundle);

  const result = await verifyD005MMasterBundle(bundle);

  // The forgery must not be accepted, and must not be reported as merely
  // "incomplete": the directory holds a DIFFERENT key for this id, which is a
  // positive contradiction.
  assert.equal(result.verdict, "INVALID");
  assert.ok(result.reasonCodes.includes("D005M_VERIFICATION_KEY_SUBSTITUTED"));
  // Nothing may be reported as checked once trust is refused.
  assert.deepEqual(result.completedChecks, []);
});

test("P3-A ATTACK G: signature validity alone never implies authorization", async () => {
  const attacker = await attackerKeypair();
  // The attacker's signatures ARE mathematically valid under their own key —
  // this is the fact the old verifier mistook for authenticity.
  const message = utf8ToBytes("anything at all");
  const signature = await attacker.sign(message);
  assert.match(signature, /^[0-9a-f]{128}$/);

  // And that key is still not authorized to sign as the demo issuer.
  const authorization = resolveKeyAuthorization("fortix.demo.key.d005", attacker.publicKeyHex);
  assert.equal(authorization.authorization, "UNAUTHORIZED");
  assert.equal(authorization.reasonCode, "PUBLIC_KEY_MISMATCH");
  assert.equal(authorization.trustAnchorId, null);
});

// --- the attack matrix ---------------------------------------------------

test("P3-A: the full attack matrix fails closed, with the right distinction", async () => {
  const attacker = await attackerKeypair();
  const mutate: Readonly<Record<string, (bundle: Bundle) => Promise<void>>> = {
    "payload mutation": async (bundle) => {
      const details = ((paymentResult(bundle).evidence_payload as Record<string, unknown>)
        .result as Record<string, unknown>).details as Record<string, unknown>;
      details.amount_eur = 999_999;
    },
    "payload + digest recomputation": async (bundle) => {
      const target = paymentResult(bundle);
      const payload = target.evidence_payload as Record<string, unknown>;
      ((payload.result as Record<string, unknown>).details as Record<string, unknown>).amount_eur = 999_999;
      (target.evidence_integrity as Record<string, unknown>).payload_digest = digest(payload);
    },
    "issuer substitution": async (bundle) => {
      (bundle.canonical_evidence_objects as Record<string, unknown>[])[5].issuer =
        { issuer_id: "fortix.demo.attacker", issuer_type: "DEMO" };
    },
    "signature transplant": async (bundle) => {
      const objects = bundle.canonical_evidence_objects as Record<string, unknown>[];
      const borrowed = objects[2].signature;
      objects[2].signature = objects[3].signature;
      objects[3].signature = borrowed;
    },
    "missing signature": async (bundle) => {
      delete (bundle.canonical_evidence_objects as Record<string, unknown>[])[3].signature;
    },
    "attacker key without re-signing": async (bundle) => {
      (bundle.trust_material as Record<string, unknown>).verification_keys = [{
        key_id: "fortix.demo.key.d005", public_key_hex: attacker.publicKeyHex,
        trust_anchor_id: "a", trust_anchor_evidence_id: "b",
      }];
    },
  };

  for (const [name, apply] of Object.entries(mutate)) {
    const bundle = clone();
    await apply(bundle);
    reseal(bundle);
    const result = await verifyD005MMasterBundle(bundle);
    assert.equal(result.verdict, "INVALID", `${name} was not rejected`);
  }
});

test("P3-A: a key the directory has never seen establishes nothing, rather than failing", async () => {
  // The doctrinal distinction: an unknown issuer is missing information, not a
  // contradiction, so INDETERMINATE is correct and INVALID would overclaim.
  for (const keys of [
    [{ key_id: "unknown.issuer", public_key_hex: "aa".repeat(32), trust_anchor_id: "x", trust_anchor_evidence_id: "y" }],
    [{ key_id: "fortix.demo.key.d005", public_key_hex: "not-hex" }],
    [],
  ]) {
    const bundle = clone();
    (bundle.trust_material as Record<string, unknown>).verification_keys = keys;
    reseal(bundle);
    const result = await verifyD005MMasterBundle(bundle);
    assert.equal(result.verdict, "INDETERMINATE", `${JSON.stringify(keys)} gave the wrong verdict`);
    assert.ok(result.reasonCodes.includes("D005M_VERIFICATION_KEY_NOT_AUTHORIZED"));
  }
});

// --- the trust model itself ---------------------------------------------

test("P3-A: the genuine bundle is authorized, and still only INDETERMINATE", async () => {
  const result = await verifyD005MMasterBundle();
  assert.equal(result.verdict, "INDETERMINATE");
  assert.ok(result.completedChecks.includes("verification_key_authorized_by_pinned_anchor"));
  assert.ok(result.completedChecks.includes("canonical_signatures_verified"));
  // Authorized signatures do not establish production trust. Forcing VALID
  // here would be the exact overclaim the doctrine forbids.
  assert.ok(result.reasonCodes.includes("D005M_PRODUCTION_TRUST_TIME_INCOMPLETE"));
});

test("P3-A: authorization resolves against the pinned directory, not the bundle", () => {
  const genuine = PINNED_TRUST_ANCHORS[0];
  assert.equal(genuine.keyId, "fortix.demo.key.d005");
  assert.equal(genuine.status, "ACTIVE");
  assert.match(genuine.publicKeyHex, /^[0-9a-f]{64}$/);

  // The directory authorizes the genuine key...
  assert.equal(
    resolveKeyAuthorization(genuine.keyId, genuine.publicKeyHex).authorization,
    "AUTHORIZED",
  );
  // ...and the bundle's own copy is only ever compared to it, never trusted
  // in its place: an assessment returns DIRECTORY entries.
  const bundle = D005M_MASTER_BUNDLE as unknown as Bundle;
  const assessment = assessPresentedTrustMaterial(
    (bundle.trust_material as Record<string, unknown>).verification_keys as unknown[],
  );
  assert.equal(assessment.authorizedKeys.length, 1);
  assert.equal(assessment.authorizedKeys[0].publicKeyHex, genuine.publicKeyHex);
  assert.equal(assessment.substituted, false);
  assert.equal(assessment.noneAuthorized, false);
});

test("P3-A: a revoked key yields REVOKED, and revocation is reachable", async () => {
  // Demonstrated against a directory whose entry is revoked — the lifecycle
  // state lives in the directory, so REVOKED is a real reachable verdict
  // rather than a label nothing can produce.
  const revokedDirectory: readonly TrustAnchorEntry[] = [{
    ...PINNED_TRUST_ANCHORS[0],
    status: "REVOKED",
  }];
  const assessment = assessPresentedTrustMaterial(
    [{ key_id: PINNED_TRUST_ANCHORS[0].keyId, public_key_hex: PINNED_TRUST_ANCHORS[0].publicKeyHex }],
    revokedDirectory,
  );
  assert.equal(assessment.revoked, true);
  assert.equal(assessment.noneAuthorized, true);
  assert.equal(assessment.results[0].authorization, "REVOKED");
  assert.equal(assessment.results[0].reasonCode, "KEY_NOT_ACTIVE");
});

test("P3-A: the bundle cannot authorize its own anchor", () => {
  // Whatever a bundle claims about anchors, the answer comes from the pinned
  // directory. An attacker naming the genuine anchor id gains nothing.
  const claimed = resolveKeyAuthorization("fortix.demo.key.d005", "ff".repeat(32));
  assert.equal(claimed.authorization, "UNAUTHORIZED");
  assert.equal(claimed.reasonCode, "PUBLIC_KEY_MISMATCH");
  assert.equal(claimed.trustAnchorId, null, "no anchor is conferred on an unauthorized key");
});

test("P3-A: malformed key material is refused, never skipped", () => {
  for (const [keyId, keyHex] of [
    ["", "aa".repeat(32)],
    ["fortix.demo.key.d005", ""],
    ["fortix.demo.key.d005", "zz".repeat(32)],
    [null, null],
  ] as const) {
    const result = resolveKeyAuthorization(keyId, keyHex);
    assert.notEqual(result.authorization, "AUTHORIZED", `${keyId}/${keyHex} was authorized`);
  }
});

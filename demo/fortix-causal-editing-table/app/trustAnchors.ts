/**
 * D-006G P3-A — who authorizes a key.
 *
 * THE ATTACK (Codex attack G, reproduced before this was written). Take the
 * genuine bundle, generate an attacker Ed25519 keypair, re-sign every object
 * with it, and replace `trust_material.verification_keys` with the attacker's
 * public key under the same `key_id`. The result was **indistinguishable from
 * the genuine bundle**: same verdict, same reason codes, all nine checks
 * including `canonical_signatures_verified`.
 *
 * The signatures really were valid. That was never the question. The question
 * is whose key they were valid under, and the verifier was reading the answer
 * out of the artifact being verified. A package that carries its own answer to
 * "why should you trust this key?" is self-authenticating, which is the
 * opposite of independent verification.
 *
 * THE MODEL, reusing what FortiX already has rather than inventing one.
 * `app/fortivault/trustchain_key_directory.py` resolves keys against a KEY
 * DIRECTORY held outside the artifact, with stable reason codes —
 * `key_not_found`, `key_not_active`, `public_key_mismatch`. This module is the
 * browser-side equivalent: a pinned directory the verifier carries, which no
 * bundle can influence.
 *
 * A bundle may still TRANSPORT key material — that is what a portable bundle
 * is for. It simply does not get to authorize it. The presented key must match
 * what the directory already holds for that `key_id`.
 *
 * WHAT THIS DOES NOT CLAIM. A pinned directory compiled into a demonstration
 * is not production trust infrastructure. It is pre-trusted state that is
 * external to the evidence, which is the property that matters here; it is not
 * a key ceremony, a revocation service, or a trust anchor with a lifecycle
 * anyone audits. The verdict continues to say so.
 */

export type KeyLifecycleStatus = "ACTIVE" | "REVOKED";

export type TrustAnchorEntry = Readonly<{
  keyId: string;
  publicKeyHex: string;
  algorithm: "Ed25519";
  status: KeyLifecycleStatus;
  trustAnchorId: string;
}>;

export type KeyAuthorization =
  | "AUTHORIZED"
  | "UNAUTHORIZED"
  | "REVOKED"
  | "NOT_ESTABLISHED";

export type KeyAuthorizationResult = Readonly<{
  keyId: string;
  authorization: KeyAuthorization;
  /** Canonical reason, mirroring the FortiVault directory vocabulary. */
  reasonCode: string | null;
  trustAnchorId: string | null;
}>;

/**
 * The pre-trusted directory.
 *
 * This is the ONLY place the demonstration decides which key belongs to which
 * issuer. It is deliberately a constant: nothing in a PEB, and nothing an
 * attacker can put in one, reaches it.
 *
 * The fingerprint below was taken from the genuine D-005M bundle and then
 * verified independently — all 45 canonical objects verify under it — so
 * pinning it records a fact rather than trusting the artifact that carried it.
 */
export const PINNED_TRUST_ANCHORS: readonly TrustAnchorEntry[] = Object.freeze([
  Object.freeze({
    keyId: "fortix.demo.key.d005",
    publicKeyHex: "f80cccdce4ae1c07ae208a2adf99a310ae4207e0306fa0236110b06827bbb8d0",
    algorithm: "Ed25519" as const,
    status: "ACTIVE" as const,
    trustAnchorId: "fortix.demo.anchor.d005",
  }),
]);

const DIRECTORY = new Map(PINNED_TRUST_ANCHORS.map((entry) => [entry.keyId, entry]));

function unauthorized(keyId: string, reasonCode: string): KeyAuthorizationResult {
  return Object.freeze({ keyId, authorization: "UNAUTHORIZED", reasonCode, trustAnchorId: null });
}

/**
 * Is this presented key authorized to sign as `keyId`?
 *
 * Fails closed. Every outcome that is not a positive match against the
 * directory is a refusal, and the refusals are distinguished because they mean
 * different things:
 *
 *   PUBLIC_KEY_MISMATCH  the directory holds a DIFFERENT key for this id. That
 *                        is a positive contradiction, not missing information
 *                        — someone is presenting a substitute.
 *   KEY_NOT_FOUND        the id is unknown. Authorization cannot be
 *                        established either way.
 *   KEY_NOT_ACTIVE       known, but its lifecycle says it may no longer sign.
 */
export function resolveKeyAuthorization(
  keyId: unknown,
  presentedPublicKeyHex: unknown,
  directory: readonly TrustAnchorEntry[] = PINNED_TRUST_ANCHORS,
): KeyAuthorizationResult {
  if (typeof keyId !== "string" || keyId.length === 0) {
    return unauthorized("", "MALFORMED_KEY_IDENTIFIER");
  }
  if (typeof presentedPublicKeyHex !== "string" || !/^[0-9a-f]{64}$/i.test(presentedPublicKeyHex)) {
    return unauthorized(keyId, "MALFORMED_PUBLIC_KEY");
  }

  const lookup = directory === PINNED_TRUST_ANCHORS
    ? DIRECTORY
    : new Map(directory.map((entry) => [entry.keyId, entry]));
  const entry = lookup.get(keyId);
  if (entry === undefined) {
    // Unknown issuer: nothing is contradicted, but nothing is established.
    return Object.freeze({
      keyId, authorization: "NOT_ESTABLISHED", reasonCode: "KEY_NOT_FOUND", trustAnchorId: null,
    });
  }
  if (entry.publicKeyHex.toLowerCase() !== presentedPublicKeyHex.toLowerCase()) {
    return unauthorized(keyId, "PUBLIC_KEY_MISMATCH");
  }
  if (entry.status === "REVOKED") {
    return Object.freeze({
      keyId, authorization: "REVOKED", reasonCode: "KEY_NOT_ACTIVE", trustAnchorId: entry.trustAnchorId,
    });
  }
  return Object.freeze({
    keyId, authorization: "AUTHORIZED", reasonCode: null, trustAnchorId: entry.trustAnchorId,
  });
}

export type TrustMaterialAssessment = Readonly<{
  /** Keys the directory authorizes, and which may therefore verify anything. */
  authorizedKeys: readonly TrustAnchorEntry[];
  results: readonly KeyAuthorizationResult[];
  /** Any key the bundle presented that contradicts the directory. */
  substituted: boolean;
  revoked: boolean;
  /** No presented key could be authorized at all. */
  noneAuthorized: boolean;
}>;

/**
 * Assesses the keys a bundle presents against the pinned directory.
 *
 * Returns the AUTHORIZED entries from the DIRECTORY — never the bundle's own
 * copies — so a caller that verifies signatures with this result cannot
 * accidentally use attacker-supplied key material even if it wanted to.
 */
export function assessPresentedTrustMaterial(
  verificationKeys: readonly unknown[],
  directory: readonly TrustAnchorEntry[] = PINNED_TRUST_ANCHORS,
): TrustMaterialAssessment {
  const results: KeyAuthorizationResult[] = [];
  const authorized: TrustAnchorEntry[] = [];
  const lookup = new Map(directory.map((entry) => [entry.keyId, entry]));

  for (const candidate of verificationKeys) {
    const key = (typeof candidate === "object" && candidate !== null)
      ? candidate as Record<string, unknown>
      : {};
    const result = resolveKeyAuthorization(key.key_id, key.public_key_hex, directory);
    results.push(result);
    if (result.authorization === "AUTHORIZED") {
      const entry = lookup.get(result.keyId);
      if (entry !== undefined) authorized.push(entry);
    }
  }

  return Object.freeze({
    authorizedKeys: Object.freeze(authorized),
    results: Object.freeze(results),
    substituted: results.some((result) => result.reasonCode === "PUBLIC_KEY_MISMATCH"),
    revoked: results.some((result) => result.authorization === "REVOKED"),
    noneAuthorized: authorized.length === 0,
  });
}

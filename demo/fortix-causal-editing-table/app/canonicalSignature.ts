import { blake3 } from "@noble/hashes/blake3.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";

import { canonicalString } from "./verification.ts";

/**
 * D-006G P2R — cryptographic verification for the D-005M canonical evidence
 * profile.
 *
 * WHY THIS EXISTS. The mounted verifier recomputed digests and nothing else,
 * so an object whose payload had been altered and whose hashes had been
 * recomputed to match was accepted with the identical verdict, reason code and
 * check list as the genuine article. Recomputing a digest proves the bundle is
 * internally consistent; it says nothing about who wrote it. An attacker who
 * edits a payload recomputes those digests as a matter of course.
 *
 * THE SCHEME, established by reading `app/core/signer.py` in this repository
 * and confirmed against all 45 objects of the shipped bundle:
 *
 *   evidence_id = "fortix:evidence:blake3:" + blake3_hex(canonical(object
 *                 without `signature` and without `evidence_id`))
 *   signature   = Ed25519(utf8(blake3_hex(canonical(object without
 *                 `signature`))), issuer private key)
 *
 * Note the two digests differ: the identity excludes the id itself, the signed
 * digest includes it. So the signature commits to the object's identity as
 * well as its content, and neither can be changed without invalidating it.
 *
 * `sign_hash` in the Python signer signs the HEX STRING, UTF-8 encoded, not
 * the raw digest bytes — a detail worth stating because signing the bytes
 * instead is the obvious guess and it does not verify.
 */

export type ObjectVerification = Readonly<{
  evidenceId: string;
  /** The evidence_id is the digest of the object's own content. */
  identityDerived: boolean;
  /** An issuer key in the bundle's trust material signed this exact object. */
  signatureValid: boolean;
  /** No signature present to check. */
  signatureAbsent: boolean;
}>;

export type BundleVerification = Readonly<{
  objects: readonly ObjectVerification[];
  allSignaturesValid: boolean;
  allIdentitiesDerived: boolean;
  signedCount: number;
  unsignedCount: number;
  invalidSignatureIds: readonly string[];
  undrivedIdentityIds: readonly string[];
}>;

const EVIDENCE_ID_PREFIX = "fortix:evidence:blake3:";

function digestHex(value: unknown): string {
  return bytesToHex(blake3(utf8ToBytes(canonicalString(value))));
}

function withoutKeys(object: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const copy: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(object)) {
    if (!keys.includes(key)) copy[key] = value;
  }
  return copy;
}

/** The digest an object's `evidence_id` must be derived from. */
export function canonicalIdentityDigest(object: Record<string, unknown>): string {
  return digestHex(withoutKeys(object, ["signature", "evidence_id"]));
}

/** The digest an object's signature is taken over. */
export function canonicalSignedDigest(object: Record<string, unknown>): string {
  return digestHex(withoutKeys(object, ["signature"]));
}

async function verifyEd25519(
  publicKeyHex: string,
  signatureHex: string,
  message: Uint8Array,
): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      hexToBytes(publicKeyHex) as unknown as BufferSource,
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    return await crypto.subtle.verify(
      { name: "Ed25519" },
      key,
      hexToBytes(signatureHex) as unknown as BufferSource,
      message as unknown as BufferSource,
    );
  } catch {
    // A malformed key or signature is a failed verification, never a pass.
    return false;
  }
}

/**
 * Verifies every object in a bundle against the bundle's own declared
 * verification keys.
 *
 * Fails closed throughout: anything that cannot be parsed, decoded or checked
 * counts as NOT verified. There is no path through this function where an
 * error yields a positive result.
 */
export async function verifyCanonicalEvidenceSignatures(
  canonicalEvidenceObjects: readonly unknown[],
  verificationKeys: readonly unknown[],
): Promise<BundleVerification> {
  const keyHexes: string[] = [];
  for (const key of verificationKeys) {
    if (typeof key !== "object" || key === null) continue;
    const hex = (key as Record<string, unknown>).public_key_hex;
    if (typeof hex === "string" && /^[0-9a-f]{64}$/i.test(hex)) keyHexes.push(hex);
  }

  const objects: ObjectVerification[] = [];
  for (const candidate of canonicalEvidenceObjects) {
    if (typeof candidate !== "object" || candidate === null) {
      objects.push({
        evidenceId: "", identityDerived: false, signatureValid: false, signatureAbsent: true,
      });
      continue;
    }
    const object = candidate as Record<string, unknown>;
    const evidenceId = typeof object.evidence_id === "string" ? object.evidence_id : "";
    const identityDerived = evidenceId.startsWith(EVIDENCE_ID_PREFIX)
      && evidenceId.slice(EVIDENCE_ID_PREFIX.length) === canonicalIdentityDigest(object);

    const signature = object.signature;
    if (typeof signature !== "string" || !/^[0-9a-f]{128}$/i.test(signature)) {
      objects.push({ evidenceId, identityDerived, signatureValid: false, signatureAbsent: true });
      continue;
    }

    const message = utf8ToBytes(canonicalSignedDigest(object));
    let signatureValid = false;
    for (const keyHex of keyHexes) {
      if (await verifyEd25519(keyHex, signature, message)) { signatureValid = true; break; }
    }
    objects.push({ evidenceId, identityDerived, signatureValid, signatureAbsent: false });
  }

  const signed = objects.filter((object) => !object.signatureAbsent);
  return Object.freeze({
    objects: Object.freeze(objects),
    // An empty bundle, or one carrying no signatures at all, is NOT "all
    // valid". Vacuous truth is how a verifier ends up approving nothing.
    allSignaturesValid: signed.length === objects.length
      && objects.length > 0
      && objects.every((object) => object.signatureValid),
    allIdentitiesDerived: objects.length > 0 && objects.every((object) => object.identityDerived),
    signedCount: signed.length,
    unsignedCount: objects.length - signed.length,
    invalidSignatureIds: Object.freeze(
      objects.filter((object) => !object.signatureAbsent && !object.signatureValid)
        .map((object) => object.evidenceId),
    ),
    undrivedIdentityIds: Object.freeze(
      objects.filter((object) => !object.identityDerived).map((object) => object.evidenceId),
    ),
  });
}

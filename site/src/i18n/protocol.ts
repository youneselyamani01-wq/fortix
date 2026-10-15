/**
 * Strings that are never translated, per the brand and doctrine rules this
 * site follows: the canonical signature, the four normative verdicts, and
 * standards/algorithm names. These are used directly in components — they
 * intentionally do not live in the per-locale dictionaries, so there is no
 * dictionary key a translator could accidentally localize.
 */

/** Canonical brand signature. Exact casing and punctuation, both locales. */
export const BRAND_SIGNATURE = "Don’t trust. Verify.";

export const VERDICTS = ["VALID", "INVALID", "INDETERMINATE", "REVOKED"] as const;
export type Verdict = (typeof VERDICTS)[number];

export const STANDARDS = {
  hash: "BLAKE3",
  signature: "Ed25519",
} as const;

/** The canonical flow keyword that stays identical across locales. */
export const FLOW_ACTION_WORD = "Action";

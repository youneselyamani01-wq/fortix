/**
 * Brand signature is localized here; protocol verdicts and standards stay
 * canonical in both languages. The site dictionaries do not duplicate the
 * signature, so display copy cannot drift from the approved wording.
 */

/** Approved institutional signature for each site language. */
export const BRAND_SIGNATURE = {
  en: "Trust is built on evidence.",
  fr: "La confiance se construit sur des preuves.",
} as const;

export const VERDICTS = ["VALID", "INVALID", "INDETERMINATE", "REVOKED"] as const;
export type Verdict = (typeof VERDICTS)[number];

export const STANDARDS = {
  hash: "BLAKE3",
  signature: "Ed25519",
} as const;

/** The canonical flow keyword that stays identical across locales. */
export const FLOW_ACTION_WORD = "Action";

/**
 * D-006/NX3 — THE VERIFICATION CHOREOGRAPHY (mandate §16–§18).
 *
 * WHAT THIS IS. A pure description of how the verifier's result is REVEALED:
 * the checks the verifier actually completed, grouped for reading; the cadence
 * at which each group appears; a controlled pause — the "roulement de
 * tambours" — after the last group and before the verdict; and the verdict.
 *
 * WHAT IT MAY AND MAY NOT DO. The verifier's result arrives whole and
 * asynchronously: the verdict, the completed checks and the reason codes are
 * one object, stored as it came. This module never invents a check, never
 * shows a check before the result exists, and never produces a verdict. It
 * only DELAYS revealing what is already true, and under reduced motion it
 * delays nothing. A check id this table does not know is shown under
 * `evidence` with its own label — filed, never dropped.
 *
 * Kept as a plain module with no directive so the surface, the inspect panel
 * and the tests read one table.
 */

export type CheckCategory = "integrity" | "signatures" | "trust" | "causality" | "time" | "evidence";

/** Reading order of the categories, integrity first, evidence last. */
export const CATEGORY_ORDER: readonly CheckCategory[] = Object.freeze(["integrity", "signatures", "trust", "causality", "time", "evidence"]);

/**
 * The verifier's check ids (app/offlineVerification.ts, app/verification.ts),
 * grouped for reading. `time` has no member today: the demo disclaims
 * production trusted time (`PRODUCTION_TRUST_TIME` reason codes), so no check
 * of that kind is ever completed, and the category stays empty rather than
 * being filled with something that was not performed.
 */
export const CHECK_CATEGORY: Readonly<Record<string, CheckCategory>> = Object.freeze({
  bundle_digest_recomputed: "integrity",
  object_digests_recomputed: "integrity",
  d006_transferred_digest_exact: "integrity",
  d006_runtime_record_digests: "integrity",
  canonical_signatures_verified: "signatures",
  verification_key_authorized_by_pinned_anchor: "trust",
  governance_material_present: "trust",
  bundle_declares_demo_only_scope: "trust",
  target_binds_to_cycle_receipt: "causality",
  cycle_receipt_closure: "causality",
  d006_final_receipt_closure: "causality",
  evidence_identities_derived: "evidence",
  master_path_evidence_present: "evidence",
  d006_mission_run_identity: "evidence",
  d006_displayed_peb_coverage: "evidence",
  d006_financial_non_settlement: "evidence",
  d006_in_mission_reconciliation_consistent: "evidence",
});

/** Each group of completed checks appears this long after the previous one. */
export const CATEGORY_CADENCE_MS = 260;
/** The pause after the last group and before the verdict: long enough to be felt, short enough to hold. */
export const DRUM_ROLL_MS = 900;

export type CategoryGroup = Readonly<{ category: CheckCategory; checks: readonly string[] }>;

/** The completed checks, grouped and ordered. Only non-empty groups; only ids the verifier reported. */
export function categoriesOf(completedChecks: readonly string[]): readonly CategoryGroup[] {
  return CATEGORY_ORDER
    .map((category) => ({ category, checks: completedChecks.filter((check) => (CHECK_CATEGORY[check] ?? "evidence") === category) }))
    .filter((group) => group.checks.length > 0);
}

export type RevealPlan = Readonly<{
  groups: readonly CategoryGroup[];
  /** Milliseconds after the result arrives at which step i+1 is revealed; the last step is the verdict. */
  steps: readonly number[];
  verdictAtMs: number;
}>;

/**
 * When each group, and then the verdict, is revealed after the result
 * arrives. With reduced motion — or with nothing to reveal — the plan is
 * empty and everything shows at once.
 */
export function revealPlan(completedChecks: readonly string[], reducedMotion: boolean): RevealPlan {
  const groups = categoriesOf(completedChecks);
  if (reducedMotion || groups.length === 0) return Object.freeze({ groups, steps: Object.freeze([]), verdictAtMs: 0 });
  const steps = groups.map((_, index) => (index + 1) * CATEGORY_CADENCE_MS);
  const verdictAtMs = groups.length * CATEGORY_CADENCE_MS + DRUM_ROLL_MS;
  return Object.freeze({ groups, steps: Object.freeze([...steps, verdictAtMs]), verdictAtMs });
}

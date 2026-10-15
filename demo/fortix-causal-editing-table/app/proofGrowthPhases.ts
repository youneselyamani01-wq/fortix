/**
 * D-006 C3-R1 — the causal growth phases of one proof leaf.
 *
 * PUBLIC VISUAL INVARIANT: **no branch before its evidence exists.**
 *
 * Human review of C3 found the Proof Tree anticipating its own evidence: the
 * stem scaled up from the first instant of growth while the terminal
 * nano-receipt only materialised at 72% — a branch reaching for a node that
 * was not there yet. The tree was predicting the future.
 *
 * The required order, which this module makes structural:
 *
 *   OBSERVABLE EVENT                      (the world does something)
 *   → NANO-RECEIPT APPEARS                (the flight lands; NR materialises)
 *   → BRANCH GROWS TOWARD THE RECEIPT     (the tree reaches for evidence
 *                                          that already exists)
 *   → NANO-RECEIPT LOCKS INTO THE TREE    (settle)
 *
 * `growth` is the existing 0..1 clock that starts when the receipt flight
 * lands (see leafGrowthForLeaf): nothing here changes WHEN a leaf grows, only
 * the order in which its parts become visible inside that window.
 *
 * The phase boundaries are strictly sequential: the stem cannot start before
 * the NR is fully materialised, and the lock cannot start before the stem has
 * fully attached. `causalPhaseViolations` states the invariant so tests
 * assert the model itself rather than sampled magic numbers.
 */

export type LeafCausalPhases = Readonly<{
  /** The nano-receipt terminal materialising. First. */
  nrAppear: number;
  /** The branch growing from the spine toward the receipt. Second. */
  stem: number;
  /** The receipt locking into the tree. Third. */
  lock: number;
  /** True once every phase completed. */
  locked: boolean;
}>;

/** Phase boundaries on the 0..1 growth clock. Strictly ordered. */
export const NR_APPEAR_ENDS = 0.16;
export const STEM_ENDS = 0.84;

export function leafCausalPhases(growth: number): LeafCausalPhases {
  const g = clamp01(growth);
  const nrAppear = clamp01(g / NR_APPEAR_ENDS);
  const stem = clamp01((g - NR_APPEAR_ENDS) / (STEM_ENDS - NR_APPEAR_ENDS));
  const lock = clamp01((g - STEM_ENDS) / (1 - STEM_ENDS));
  return Object.freeze({ nrAppear, stem, lock, locked: g >= 1 });
}

/**
 * The invariant, checkable at any growth value:
 *   - a stem may not exist before its nano-receipt fully exists;
 *   - a lock may not exist before its stem is fully attached;
 *   - nothing may be visible at zero growth.
 */
export function causalPhaseViolations(growth: number): readonly string[] {
  const phases = leafCausalPhases(growth);
  const violations: string[] = [];
  if (phases.stem > 0 && phases.nrAppear < 1) {
    violations.push(`branch before evidence at growth ${growth}`);
  }
  if (phases.lock > 0 && phases.stem < 1) {
    violations.push(`lock before attachment at growth ${growth}`);
  }
  if (growth <= 0 && (phases.nrAppear > 0 || phases.stem > 0 || phases.lock > 0)) {
    violations.push(`visible geometry at zero growth`);
  }
  return Object.freeze(violations);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

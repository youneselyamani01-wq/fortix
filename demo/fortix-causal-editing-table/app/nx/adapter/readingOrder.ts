/**
 * D-006 NX1 Checkpoint C — the READING ORDER and the presentational ordinal,
 * as pure functions shared by the public model and the proof geometry.
 *
 * THE ORDER (established at Checkpoint B R2). Evidence time first, the
 * engine's own admission order for a shared moment, the identifier as the
 * last word — compared ordinally, so the order never depends on the host's
 * collation. A stable topological pass then makes the invariant a property
 * of the rule rather than of the data: a receipt is read only once every
 * declared parent present in the set has been read.
 *
 * THE ORDINAL (Checkpoint C, C-F04). `NR 01`, `NR 02`, … a human handle so a
 * viewer can say "NR 23 just appeared" and find NR 23 again. It is
 * PRESENTATIONAL ONLY:
 *
 *   - it is computed here, from the presented set, and never written into
 *     evidence: no signed object, digest, canonical receipt id, closure
 *     member, PEB manifest or verifier input carries it;
 *   - it carries no cryptographic, evidentiary or trust authority, and no
 *     verification behaviour reads it;
 *   - the SEALED mission numbers itself: the ordinal of a sealed receipt is
 *     its position in the reading order of the sealed set alone, so a record
 *     the engine appends after the seal can never renumber it;
 *   - records appended after the seal carry their own sequence, marked
 *     apart, so they never enter the sealed sequence.
 *
 * Because the reading order at any moment of a run is a prefix of that
 * run's full order, a receipt keeps the number it was given the instant it
 * appeared, for the whole run and after the seal.
 */

/** The minimum an evidence object must state to be read in order. */
export type OrderedEvidence = Readonly<{
  evidenceId: string;
  timeMs: number;
  /** The engine's own order of admission (closure member index, then journal record index). */
  admissionIndex: number;
  causalParents: readonly string[];
  observedInputs: readonly string[];
}>;

/** Where a receipt stands relative to the Final Receipt's seal. */
export type EvidenceStanding = "CLOSURE" | "JOURNAL";

/** Declared parents present in the set, per evidence id. */
export function presentParents(items: readonly OrderedEvidence[]): Map<string, readonly string[]> {
  const ids = new Set(items.map((entry) => entry.evidenceId));
  return new Map(items.map((entry) => [
    entry.evidenceId,
    [...new Set([...entry.causalParents, ...entry.observedInputs])].filter((id) => ids.has(id) && id !== entry.evidenceId),
  ] as const));
}

/** Time, then the engine's admission order, then the identifier — ordinally. */
export function compareForReading(left: OrderedEvidence, right: OrderedEvidence): number {
  return (
    left.timeMs - right.timeMs
    || left.admissionIndex - right.admissionIndex
    || (left.evidenceId < right.evidenceId ? -1 : left.evidenceId > right.evidenceId ? 1 : 0)
  );
}

/**
 * The reading order: the sort above, then a stable topological pass so a
 * receipt is never read before a declared parent present in the set. On every
 * run the engine produces the pass returns the sorted order unchanged; a
 * declared cycle (impossible in a valid journal) falls back to it rather than
 * dropping a receipt.
 */
export function readingOrder<T extends OrderedEvidence>(items: readonly T[]): readonly T[] {
  const sorted = [...items].sort(compareForReading);
  const parents = presentParents(items);
  const read = new Set<string>();
  const order: T[] = [];
  let waiting = sorted;
  while (waiting.length > 0) {
    const next: T[] = [];
    let progress = false;
    for (const entry of waiting) {
      if ((parents.get(entry.evidenceId) ?? []).every((id) => read.has(id))) {
        order.push(entry);
        read.add(entry.evidenceId);
        progress = true;
      } else next.push(entry);
    }
    if (!progress) { order.push(...next); break; }
    waiting = next;
  }
  return order;
}

/** A receipt's human handle. Presentational: never part of any evidence. */
export type ReadingOrdinal = Readonly<{
  /** The sealed mission numbers itself; records after the seal have their own sequence. */
  zone: "SEALED" | "AFTER_SEAL";
  /** 1-based position inside that sequence. */
  index: number;
  /** What a viewer reads: `NR 01` inside the seal, `+ 01` after it. */
  label: string;
  /**
   * The same handle with the room a bead has: `01`, or `+01` after the seal
   * (C-R2). It is the SAME number, printed shorter — not a second sequence.
   * The proof band shows this; the dossier and the record show `label`, so a
   * viewer reading `01` on a bead finds `NR 01` in the dossier.
   */
  compact: string;
}>;

/** `NR 01` … `NR 58`; two digits until the sequence needs three. */
export function ordinalLabel(zone: ReadingOrdinal["zone"], index: number, total: number): string {
  return zone === "SEALED"
    ? `NR ${ordinalDigits(index, total)}`
    : `+ ${ordinalDigits(index, total)}`;
}

/** The digits alone, zero-padded to the width the sequence needs. */
export function ordinalDigits(index: number, total: number): string {
  const width = Math.max(2, String(Math.max(total, 1)).length);
  return String(index).padStart(width, "0");
}

/** `01` on a sealed bead, `+01` after the seal: the label with a bead's room. */
export function ordinalCompact(zone: ReadingOrdinal["zone"], index: number, total: number): string {
  const digits = ordinalDigits(index, total);
  return zone === "SEALED" ? digits : `+${digits}`;
}

/**
 * The ordinal of every receipt of a presented set. The sealed receipts are
 * numbered among themselves, in reading order; the records appended after the
 * seal are numbered among themselves. Neither sequence can shift the other.
 */
export function readingOrdinals<T extends OrderedEvidence & Readonly<{ standing: EvidenceStanding }>>(
  items: readonly T[],
): ReadonlyMap<string, ReadingOrdinal> {
  const ordinals = new Map<string, ReadingOrdinal>();
  for (const zone of ["SEALED", "AFTER_SEAL"] as const) {
    const standing: EvidenceStanding = zone === "SEALED" ? "CLOSURE" : "JOURNAL";
    const zoneItems = items.filter((entry) => entry.standing === standing);
    readingOrder(zoneItems).forEach((entry, position) => {
      const index = position + 1;
      ordinals.set(entry.evidenceId, {
        zone,
        index,
        label: ordinalLabel(zone, index, zoneItems.length),
        compact: ordinalCompact(zone, index, zoneItems.length),
      });
    });
  }
  return ordinals;
}

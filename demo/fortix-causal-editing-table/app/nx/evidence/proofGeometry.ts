import { presentParents, readingOrder } from "../adapter/readingOrder.ts";
import type { EvidenceEpisode, ProvenanceLane, PublicEvidence } from "../adapter/publicExperienceAdapter.ts";

export { readingOrder } from "../adapter/readingOrder.ts";

/**
 * NX1 B R2 — the proof geometry, as pure functions.
 *
 *   HORIZONTAL = PROVENANCE   one column per lane the evidence names, to the
 *                             right of a reading gutter.
 *   VERTICAL   = PROGRESSION  the human reading order: one row per moment,
 *                             top to bottom, a chapter break between
 *                             significant episodes. A child never sits above
 *                             its declared parent; evidence time is respected;
 *                             the engine's admission order breaks a shared
 *                             moment; two receipts of the same moment, in
 *                             different lanes and unrelated, share a row.
 *   THREAD     = CAUSALITY    one filament per declared parent relation
 *                             (`causalParents`, `observedInputs`) whose both
 *                             ends are present. Order alone never draws one.
 *   COLOUR     = FAMILY       carried by the component from `actionFamily`.
 *
 * READABILITY FLOORS come first (B R2 §11): the pitch, the bead, the hit
 * area and the gutter never drop below them to make a picture fit. The
 * geometry uses the room the band has, and when the whole story does not fit
 * at the floors it says so (`fit: "scroll"`): the field then scrolls inside
 * itself, every receipt kept, headers and reading orientation preserved.
 *
 * Post-seal records (standing JOURNAL) are rowed BELOW the Final Receipt, in
 * their own zone, so nothing suggests they were inside the sealed set.
 */

/** The provenance header row above the field. */
export const LABEL_PX = 20;
/** The family legend row below the field. */
export const LEGEND_PX = 20;
export const MIN_PITCH_PX = 12;
export const MAX_PITCH_PX = 20;
export const MIN_BEAD_PX = 8;
export const MAX_BEAD_PX = 12;
export const HIT_AREA_PX = 20;
export const MIN_GUTTER_PX = 84;
export const MAX_GUTTER_PX = 124;
export const MIN_EPISODE_GAP_PX = 8;
/** Room the Final Receipt row takes beneath the last sealed row. */
export const FINAL_ROW_PX = 44;
export const POST_SEAL_GAP_PX = 18;
export const POST_SEAL_LABEL_PX = 14;
export const PAD_TOP_PX = 6;
export const PAD_BOTTOM_PX = 8;
/** The reading rail's x inside the gutter. */
export const RAIL_X_PX = 14;

/** The floors a review can check (B R2 §27). Sizes in px unless stated. */
export const READABILITY_FLOORS = Object.freeze({
  beadPx: MIN_BEAD_PX,
  hitAreaPx: HIT_AREA_PX,
  pitchPx: MIN_PITCH_PX,
  gutterPx: MIN_GUTTER_PX,
  episodeGapPx: MIN_EPISODE_GAP_PX,
  /** The tight rung of the lane-label ladder (0.66 open · 0.6 dense · 0.56 tight). */
  laneLabelRem: 0.56,
  episodeLabelRem: 0.6,
  threadStrokePx: 0.8,
  threadOpacity: 0.2,
  finalReceiptPx: 28,
});

export type CausalRelation = Readonly<{
  parent: string;
  child: string;
  kind: "cause" | "observed";
  crossLane: boolean;
}>;

type Evidence = Pick<PublicEvidence, "evidenceId" | "branch" | "causalParents" | "observedInputs" | "standing" | "timeMs" | "admissionIndex" | "episode">;

/** Every declared relation whose both ends are present, deduplicated per pair. */
export function relationsOf(items: readonly Evidence[]): readonly CausalRelation[] {
  const byId = new Map(items.map((entry) => [entry.evidenceId, entry] as const));
  const seen = new Set<string>();
  const relations: CausalRelation[] = [];
  for (const entry of items) {
    const declared: [readonly string[], CausalRelation["kind"]][] = [[entry.causalParents, "cause"], [entry.observedInputs, "observed"]];
    for (const [ids, kind] of declared) {
      for (const parentId of ids) {
        const parent = byId.get(parentId);
        if (parent === undefined || parentId === entry.evidenceId) continue;
        const key = `${parentId}->${entry.evidenceId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        relations.push({ parent: parentId, child: entry.evidenceId, kind, crossLane: parent.branch !== entry.branch });
      }
    }
  }
  return relations;
}

export type ReadingRows = Readonly<{
  /** Evidence ids in reading order. */
  order: readonly string[];
  rowOf: ReadonlyMap<string, number>;
  rowCount: number;
  /** The episode each row belongs to (the episode of the row's first receipt). */
  episodeOfRow: readonly EvidenceEpisode[];
}>;

/**
 * Rows of the reading order. Consecutive receipts take consecutive rows;
 * a receipt shares the row of the previous one only when the two are of the
 * SAME moment and the same episode, in different lanes, and neither is a
 * parent of the other — parallel evidence, truthfully level. Everything else
 * is one row per receipt, so the vertical axis reads as the story's
 * progression and a chapter never straddles a row.
 */
export function readingRows(items: readonly Evidence[]): ReadingRows {
  const order = readingOrder(items);
  const parents = presentParents(items);
  const rowOf = new Map<string, number>();
  const episodeOfRow: EvidenceEpisode[] = [];
  let row = -1;
  let rowMoment: number | null = null;
  let rowEpisode: EvidenceEpisode | null = null;
  const lanesInRow = new Set<ProvenanceLane>();
  for (const entry of order) {
    const own = parents.get(entry.evidenceId) ?? [];
    const share = row >= 0
      && entry.timeMs === rowMoment
      && entry.episode === rowEpisode
      && !lanesInRow.has(entry.branch)
      && !own.some((id) => rowOf.get(id) === row);
    if (!share) {
      row += 1;
      rowMoment = entry.timeMs;
      rowEpisode = entry.episode;
      lanesInRow.clear();
      episodeOfRow.push(entry.episode);
    }
    rowOf.set(entry.evidenceId, row);
    lanesInRow.add(entry.branch);
  }
  return { order: order.map((entry) => entry.evidenceId), rowOf, rowCount: row + 1, episodeOfRow };
}

export type Chapter = Readonly<{ episode: EvidenceEpisode; fromRow: number; toRow: number }>;

/** Maximal runs of rows with the same episode, in reading order. */
export function chaptersOf(episodeOfRow: readonly EvidenceEpisode[]): readonly Chapter[] {
  const chapters: Chapter[] = [];
  episodeOfRow.forEach((episode, row) => {
    const last = chapters.at(-1);
    if (last !== undefined && last.episode === episode) chapters[chapters.length - 1] = { ...last, toRow: row };
    else chapters.push({ episode, fromRow: row, toRow: row });
  });
  return chapters;
}

/**
 * Causal depth (roots at 0, every other bead one deeper than its deepest
 * present parent) — a measurement of the structure, not a placement.
 */
export function causalLevels(items: readonly Evidence[]): ReadonlyMap<string, number> {
  const parents = presentParents(items);
  const level = new Map<string, number>();
  for (const entry of readingOrder(items)) {
    const own = parents.get(entry.evidenceId) ?? [];
    const depth = own.length === 0 ? 0 : 1 + Math.max(...own.map((id) => level.get(id) ?? 0));
    level.set(entry.evidenceId, depth);
  }
  return level;
}

/** Transitive ancestors and descendants of one bead, by declared relations only. */
export function focusSets(items: readonly Evidence[], selectedId: string | null): Readonly<{ ancestors: ReadonlySet<string>; descendants: ReadonlySet<string> }> {
  const ancestors = new Set<string>();
  const descendants = new Set<string>();
  if (selectedId === null) return { ancestors, descendants };
  const parents = presentParents(items);
  const children = new Map<string, string[]>();
  for (const [child, own] of parents) for (const parent of own) children.set(parent, [...(children.get(parent) ?? []), child]);
  const up = [...(parents.get(selectedId) ?? [])];
  while (up.length > 0) {
    const id = up.pop()!;
    if (ancestors.has(id)) continue;
    ancestors.add(id);
    up.push(...(parents.get(id) ?? []));
  }
  const down = [...(children.get(selectedId) ?? [])];
  while (down.length > 0) {
    const id = down.pop()!;
    if (descendants.has(id)) continue;
    descendants.add(id);
    down.push(...(children.get(id) ?? []));
  }
  return { ancestors, descendants };
}

export type BeadPlacement = Readonly<{
  evidenceId: string;
  branch: ProvenanceLane;
  /** Position in the reading order (0 = the start). */
  rank: number;
  /** Row inside its zone (sealed field, or the post-seal zone). */
  row: number;
  zone: "closure" | "journal";
  x: number;
  y: number;
}>;

export type ThreadPlacement = CausalRelation & Readonly<{ key: string; d: string }>;

export type ChapterPlacement = Chapter & Readonly<{
  /** Top of the chapter's room (the gap above it, or the field's top). */
  top: number;
  /** Where the chapter label sits: the top of its first row. */
  labelY: number;
  bottom: number;
}>;

export type ProofLayout = Readonly<{
  columns: number;
  gutter: number;
  laneWidth: number;
  pitch: number;
  bead: number;
  episodeGap: number;
  /** Whether the whole picture fits the field at the floors, or internal scroll is the fallback. */
  fit: "fit" | "scroll";
  fieldHeight: number;
  contentHeight: number;
  rows: number;
  journalRows: number;
  chapters: readonly ChapterPlacement[];
  /** The reading rail: from the first row to the last sealed row. */
  rail: Readonly<{ x: number; top: number; bottom: number }> | null;
  /** The compilation rail and the Final Receipt capsule centre. */
  compileY: number | null;
  finalY: number | null;
  postSealY: number | null;
  beads: readonly BeadPlacement[];
  threads: readonly ThreadPlacement[];
  crossLaneThreads: number;
  sameLaneThreads: number;
  /** The last sealed bead of each lane, in lane order: where the compilation gathers. */
  anchors: readonly Readonly<{ evidenceId: string; branch: ProvenanceLane; x: number; y: number }>[];
}>;

export function layoutProof(input: Readonly<{
  items: readonly Evidence[];
  branches: readonly ProvenanceLane[];
  finalReceipt: boolean;
  widthPx: number;
  heightPx: number;
}>): ProofLayout {
  const { items, branches } = input;
  // A lane the caller did not declare still gets its own column: a receipt is
  // never silently filed under another provenance (B R2 §7).
  const lanes: ProvenanceLane[] = [...branches];
  for (const entry of items) if (!lanes.includes(entry.branch)) lanes.push(entry.branch);
  const columns = Math.max(1, lanes.length);
  const columnOf = new Map(lanes.map((branch, index) => [branch, index] as const));
  const closure = items.filter((entry) => entry.standing !== "JOURNAL");
  const journal = items.filter((entry) => entry.standing === "JOURNAL");
  const sealed = readingRows(closure);
  const after = readingRows(journal);
  const chapters = chaptersOf(sealed.episodeOfRow);
  const gaps = Math.max(0, chapters.length - 1);
  const showFinal = input.finalReceipt;

  const width = Math.max(1, input.widthPx);
  const gutter = Math.max(MIN_GUTTER_PX, Math.min(MAX_GUTTER_PX, Math.round(width * 0.09)));
  const laneWidth = Math.max(1, width - gutter) / columns;
  const fieldHeight = Math.max(0, input.heightPx - LABEL_PX - LEGEND_PX);

  // The pitch is the largest one the field can hold, never below the floor —
  // and it is chosen from the SEALED mission alone (B R2 §19): a record the
  // engine appends after the seal makes the picture longer, never the mission
  // smaller. When the post-seal zone no longer fits, the fallback scroll takes
  // it, exactly as it takes a long mission.
  const gapFor = (pitch: number) => Math.max(MIN_EPISODE_GAP_PX, Math.round(pitch * 0.7));
  const sealedContentFor = (pitch: number) => (
    PAD_TOP_PX + sealed.rowCount * pitch + gaps * gapFor(pitch) + (showFinal ? FINAL_ROW_PX : 0) + PAD_BOTTOM_PX
  );
  const contentFor = (pitch: number) => (
    after.rowCount === 0
      ? sealedContentFor(pitch)
      : sealedContentFor(pitch) + POST_SEAL_GAP_PX + POST_SEAL_LABEL_PX + after.rowCount * pitch
  );
  let pitch = MAX_PITCH_PX;
  while (pitch > MIN_PITCH_PX && sealedContentFor(pitch) > fieldHeight) pitch -= 1;
  const fit: ProofLayout["fit"] = contentFor(pitch) <= fieldHeight ? "fit" : "scroll";
  const episodeGap = gapFor(pitch);
  const bead = Math.max(MIN_BEAD_PX, Math.min(MAX_BEAD_PX, Math.round(pitch * 0.66)));

  const chapterIndexOfRow = new Map<number, number>();
  chapters.forEach((chapter, index) => { for (let row = chapter.fromRow; row <= chapter.toRow; row += 1) chapterIndexOfRow.set(row, index); });
  const yOfRow = (row: number) => PAD_TOP_PX + (chapterIndexOfRow.get(row) ?? 0) * episodeGap + row * pitch + pitch / 2;
  const lastRowBottom = sealed.rowCount === 0 ? PAD_TOP_PX : yOfRow(sealed.rowCount - 1) + pitch / 2;
  const compileY = showFinal ? lastRowBottom + 10 : null;
  const finalY = showFinal ? lastRowBottom + 28 : null;
  const sealedEnd = finalY === null ? lastRowBottom : finalY + 16;
  const postSealY = after.rowCount === 0 ? null : sealedEnd + POST_SEAL_GAP_PX;
  const yOfJournalRow = (row: number) => (postSealY ?? 0) + POST_SEAL_LABEL_PX + row * pitch + pitch / 2;
  const end = after.rowCount > 0 ? yOfJournalRow(after.rowCount - 1) + pitch / 2 : sealedEnd;
  const contentHeight = Math.ceil(end + PAD_BOTTOM_PX);

  const xOf = (branch: ProvenanceLane) => gutter + ((columnOf.get(branch) ?? 0) + 0.5) * laneWidth;
  const placed = new Map<string, BeadPlacement>();
  const beads: BeadPlacement[] = [];
  const byId = new Map(items.map((entry) => [entry.evidenceId, entry] as const));
  sealed.order.forEach((evidenceId, rank) => {
    const entry = byId.get(evidenceId)!;
    const row = sealed.rowOf.get(evidenceId)!;
    const placement: BeadPlacement = { evidenceId, branch: entry.branch, rank, row, zone: "closure", x: xOf(entry.branch), y: yOfRow(row) };
    beads.push(placement);
    placed.set(evidenceId, placement);
  });
  after.order.forEach((evidenceId, index) => {
    const entry = byId.get(evidenceId)!;
    const row = after.rowOf.get(evidenceId)!;
    const placement: BeadPlacement = { evidenceId, branch: entry.branch, rank: sealed.order.length + index, row, zone: "journal", x: xOf(entry.branch), y: yOfJournalRow(row) };
    beads.push(placement);
    placed.set(evidenceId, placement);
  });

  // A same-lane thread whose rows contain other receipts of the lane bows
  // aside instead of running through their bubbles: a filament must never
  // appear to touch a receipt it has no relation with (B R2 §16, §26). Which
  // side it bows to, and how wide, is decided at the thread loop below.
  const laneBeads = new Map<ProvenanceLane, BeadPlacement[]>();
  for (const placement of beads) laneBeads.set(placement.branch, [...(laneBeads.get(placement.branch) ?? []), placement]);
  const crosses = (from: BeadPlacement, to: BeadPlacement) => (laneBeads.get(from.branch) ?? []).some((other) => (
    other.evidenceId !== from.evidenceId && other.evidenceId !== to.evidenceId && other.y > Math.min(from.y, to.y) && other.y < Math.max(from.y, to.y)
  ));

  /**
   * G1 — THREADS THAT SHARE AN END MUST NOT SHARE A ROUTE.
   *
   * The audit found twelve pairs of DIFFERENT declared relations drawn within
   * a few pixels of each other over most of their length — a human reads them
   * as one doubled thread. Every one was a fan-out (one receipt causing
   * several) or a fan-in (several causing one), concentrated in the payment
   * authorization chain. The cause was geometric, not evidentiary: two edges
   * leaving one bead had identical departure tangents, so they left
   * superimposed and separated only near their targets.
   *
   * Each thread is therefore given a small lateral offset at the end it
   * SHARES, so a fan leaves its bead as a visible fan. The offset is derived
   * from the edge set alone — the relation's position among its siblings,
   * ordered deterministically — and never from the reading ordinal. Endpoints
   * are untouched: a thread still starts and ends exactly on its two beads, so
   * no relation is moved, added or hidden.
   */
  const relations = relationsOf(items);
  const yOf = (id: string) => placed.get(id)?.y ?? 0;
  const siblingIndex = (group: readonly CausalRelation[], relation: CausalRelation, other: (r: CausalRelation) => string) => {
    const ordered = [...group].sort((left, right) => (
      yOf(other(left)) - yOf(other(right)) || (other(left) < other(right) ? -1 : other(left) > other(right) ? 1 : 0)
    ));
    return ordered.findIndex((entry) => entry.parent === relation.parent && entry.child === relation.child && entry.kind === relation.kind);
  };
  const outgoing = new Map<string, CausalRelation[]>();
  const incoming = new Map<string, CausalRelation[]>();
  for (const relation of relations) {
    outgoing.set(relation.parent, [...(outgoing.get(relation.parent) ?? []), relation]);
    incoming.set(relation.child, [...(incoming.get(relation.child) ?? []), relation]);
  }
  /** Half a bead of separation per sibling: enough to read apart, never a detour. */
  const SPREAD_PX = Math.max(7, Math.round(bead * 0.9));
  const spreadOf = (group: readonly CausalRelation[], index: number) => (
    group.length < 2 ? 0 : (index - (group.length - 1) / 2) * SPREAD_PX
  );

  const threads: ThreadPlacement[] = [];
  for (const relation of relations) {
    const from = placed.get(relation.parent);
    const to = placed.get(relation.child);
    if (from === undefined || to === undefined) continue;
    const fan = outgoing.get(relation.parent) ?? [];
    const gather = incoming.get(relation.child) ?? [];
    const outSpread = spreadOf(fan, siblingIndex(fan, relation, (entry) => entry.child));
    const inSpread = spreadOf(gather, siblingIndex(gather, relation, (entry) => entry.parent));
    let d: string;
    if (Math.abs(from.x - to.x) >= 0.5) {
      const mid = (from.y + to.y) / 2;
      d = `M ${from.x} ${from.y} C ${from.x + outSpread} ${mid}, ${to.x + inSpread} ${mid}, ${to.x} ${to.y}`;
    } else if (crosses(from, to)) {
      // A fan inside ONE lane cannot be separated by shifting control points:
      // every target sits at the same x, so the siblings would bow identically.
      // Each sibling therefore takes a WIDER arc than the last, on the same
      // side, so the fan opens out instead of collapsing onto one line.
      // A bow leans toward the OUTSIDE of the band. Leaning by the bead's rank
      // sent bows from the right-hand lanes leftward, into the corridor where
      // the neighbouring lane's cross-lane threads arrive; a bow and an
      // unrelated sweep then ran together and read as one line. Every lane now
      // bows away from the crowded middle, so a same-lane arc and a cross-lane
      // sweep no longer compete for the same space.
      const column = columnOf.get(from.branch) ?? 0;
      const side = column < (columns - 1) / 2 ? -1 : 1;
      const rank = siblingIndex(fan, relation, (entry) => entry.child);
      // A bow stays inside its OWN lane's territory. Without the cap a wide
      // fan at a tight band swings into the corridor where the neighbouring
      // lane's cross-lane threads arrive, and the two run together — which is
      // exactly what a viewer reads as a doubled line, even though the two
      // relations are unrelated.
      const room = Math.max(bead + 6, laneWidth / 2 - bead * 2);
      const bow = side * Math.min(room, bead + 6 + Math.max(0, rank) * (bead + 5));
      d = `M ${from.x} ${from.y} C ${from.x + bow} ${from.y + (to.y - from.y) * 0.25}, ${from.x + bow} ${from.y + (to.y - from.y) * 0.75}, ${to.x} ${to.y}`;
    } else {
      // Nothing of this lane lies between the two beads, so the run is
      // unambiguous and stays straight (B R2 §16). It cannot collide with a
      // sibling: any sibling reaching further would have a bead between it and
      // its target, and would therefore have taken the bow above.
      d = `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
    }
    threads.push({ ...relation, key: `${relation.kind}:${relation.parent}->${relation.child}`, d });
  }

  const lastInLane = new Map<ProvenanceLane, BeadPlacement>();
  for (const placement of beads) {
    if (placement.zone !== "closure") continue;
    const previous = lastInLane.get(placement.branch);
    if (previous === undefined || placement.rank > previous.rank) lastInLane.set(placement.branch, placement);
  }
  const anchors = lanes.flatMap((branch) => {
    const placement = lastInLane.get(branch);
    return placement === undefined ? [] : [{ evidenceId: placement.evidenceId, branch, x: placement.x, y: placement.y }];
  });

  const chapterPlacements: ChapterPlacement[] = chapters.map((chapter, index) => ({
    ...chapter,
    top: index === 0 ? 0 : yOfRow(chapter.fromRow) - pitch / 2 - episodeGap,
    labelY: yOfRow(chapter.fromRow) - pitch / 2,
    bottom: yOfRow(chapter.toRow) + pitch / 2,
  }));

  return {
    columns,
    gutter,
    laneWidth,
    pitch,
    bead,
    episodeGap,
    fit,
    fieldHeight,
    contentHeight,
    rows: sealed.rowCount,
    journalRows: after.rowCount,
    chapters: chapterPlacements,
    rail: sealed.rowCount === 0 ? null : { x: RAIL_X_PX, top: yOfRow(0), bottom: lastRowBottom },
    compileY,
    finalY,
    postSealY,
    beads,
    threads,
    crossLaneThreads: threads.filter((thread) => thread.crossLane).length,
    sameLaneThreads: threads.filter((thread) => !thread.crossLane).length,
    anchors,
  };
}

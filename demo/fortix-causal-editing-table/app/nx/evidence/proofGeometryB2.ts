import { EPISODE_ORDER } from "../adapter/evidenceEpisode.ts";
import type { EvidenceEpisode, ProvenanceLane, PublicEvidence } from "../adapter/publicExperienceAdapter.ts";
import { readingOrder } from "../adapter/readingOrder.ts";
import {
  HIT_AREA_PX,
  LABEL_PX,
  LEGEND_PX,
  MAX_GUTTER_PX,
  MIN_BEAD_PX,
  MIN_GUTTER_PX,
  MIN_PITCH_PX,
  POST_SEAL_GAP_PX,
  causalLevels,
  relationsOf,
  type BeadPlacement,
  type CausalRelation,
  type Chapter,
  type ChapterPlacement,
  type ProofLayout,
  type ThreadPlacement,
} from "./proofGeometry.ts";

/**
 * D-006/NX3 — B2 IN PRODUCTION: the proof geometry with X = CAUSAL DEPTH.
 *
 * Gate 2 measured eight representations of the same 58 receipts and 79
 * relations and retained B2 — horizontal provenance bands, receipts placed by
 * the length of their longest declared parent chain — because it is the one
 * layout in which two receipts that share a causal position share a column,
 * so parallelism is the picture rather than an explanation (the NR 30 / NR 31
 * question). Gate 1's geometry (`proofGeometry.ts`, X = lane, Y = reading
 * order) is kept untouched as the provenance view; this module is its
 * transpose for the production proof band.
 *
 *   HORIZONTAL = CAUSAL DEPTH   one column per depth, roots at 0, every other
 *                               receipt one column right of its deepest
 *                               declared parent. Same column = same number of
 *                               declared steps from a root — NOT the same
 *                               instant, and NOT the reading number.
 *   VERTICAL   = PROVENANCE     one horizontal band per lane the evidence
 *                               names, in canonical order top to bottom.
 *   THREAD     = CAUSALITY      one filament per declared parent relation
 *                               (`causalParents`, `observedInputs`) whose both
 *                               ends are present. Order alone never draws one.
 *   COLOUR     = FAMILY         carried by the component from `actionFamily`;
 *                               the band's 5 % lane tint is scenery, never a
 *                               relation and never a family.
 *
 * THE READING ORDINAL IS A LABEL HERE, NEVER A COORDINATE. Depth is computed
 * from the declared relations of the items given, which is stable at every
 * master time of a run because a declared parent always lands before its
 * child (asserted by test). This module does not read a receipt's ordinal.
 *
 * THE SAME `ProofLayout` CONTRACT, REINTERPRETED FOR A TRANSPOSED PICTURE.
 * The component consumes one shape whichever geometry produced it, so every
 * field keeps its name and takes the meaning below. Coordinates in `beads`,
 * `threads`, `anchors` and `chapters` are SCREEN coordinates.
 *
 *   columns        the number of provenance BANDS (the lane count — what
 *                  `--columns` and `data-branch-count` consumers already read).
 *   gutter         the width of the lane-name column at the LEFT of the field,
 *                  inside the horizontal scroller and sticky to its edge; x
 *                  coordinates include it, exactly as before.
 *   laneWidth      the HEIGHT of one lane band.
 *   pitch          the horizontal pitch between two depth columns.
 *   bead           the bead diameter (floor 8 px, ceiling 10 px here: the
 *                  numeral sits beside the bead inside the column pitch).
 *   episodeGap     0 — episodes overlap in depth (the detached `signalStop`
 *                  chapter runs beside `missionStart`), so a chapter can own no
 *                  gap between columns. Recorded as zero rather than invented.
 *   fit            "fit" when the whole story stands in the field's WIDTH at
 *                  the floors; "scroll" when the field must scroll — and it
 *                  scrolls HORIZONTALLY only. The bands always fit the height.
 *   fieldHeight    the field's extent along the SCROLL axis: its width in px.
 *   contentHeight  the content's extent along the scroll axis: its width.
 *   rows           the number of depth columns of the sealed mission.
 *   journalRows    the number of depth columns of the post-seal zone.
 *   chapters[]     depth-range spans: `fromRow`/`toRow` are the first and last
 *                  depth column of the episode; `top`/`bottom` the span's left
 *                  and right x; `labelY` the label's x (the span's start).
 *                  Spans may overlap; `chapterRows()` stacks them honestly.
 *   rail           the DEPTH AXIS along the bottom of the bands: `x` is its
 *                  screen y, `top`/`bottom` the x of the first and the last
 *                  sealed column (a start mark and a tip point the direction).
 *   compileY       the x of the vertical compilation rail, right of the last
 *                  sealed column: convergence arrives from the left.
 *   finalY         the x where the Final Receipt capsule begins (its left
 *                  edge), right of the compilation rail.
 *   postSealY      the x where the post-seal zone begins, right of the capsule.
 *   beads[].row    the depth column inside the bead's zone; `rank` stays the
 *                  reading rank — a datum the component exposes, never a
 *                  coordinate.
 *   anchors[]      the DEEPEST sealed bead of each lane (the rightmost of its
 *                  band; the latest rank on a tie): where the compilation
 *                  gathers. The component still keeps only actual causal
 *                  inputs of the Final Receipt.
 *
 * READABILITY FLOORS still come first: bead >= 8 px, hit area 20 px, column
 * pitch >= 12 px, gutter >= 84 px, and two receipts of one lane and one depth
 * are stacked at least 16 px apart. The pitch is chosen from the SEALED
 * mission alone, so a record appended after the seal makes the picture wider
 * and never the mission tighter (B R2 §19, kept).
 *
 * THREADS LEAVE AND ARRIVE HORIZONTALLY, so a thread reads as progression. A
 * same-lane thread runs along its band and, where beads of its own band lie
 * between its ends, ARCHES over them — only as high as it must, and each
 * longer sibling of a fan higher than the one before it, so a fan inside one
 * band opens out instead of collapsing onto one line (Gate 1's rule, kept).
 * A cross-lane thread changes band in ONE VERTICAL RUN that stands in a GAP
 * between two depth columns — never on a column, where beads stand — with a
 * horizontal lead from its parent and a horizontal tail into its child, the
 * two corners rounded. Runs are CHANNEL-ROUTED: every run in one gap takes
 * its own x, ordered so that leads and tails cross as few runs as possible.
 * Two threads that share a bead therefore share only the bead's lead or
 * tail and part at their own runs — the doubled line Gate 1 measured cannot
 * be drawn by this geometry, whichever beads a mission stacks. A child's
 * column is strictly deeper than its parent's, so no thread can run
 * backwards here — there is no arc to straighten and none is straightened.
 */

/** The ceiling of the column pitch: a short story spreads, never sprawls. */
export const MAX_PITCH_B2_PX = 36;
/** The bead ceiling: its numeral must fit beside it inside one column pitch. */
export const MAX_BEAD_B2_PX = 10;
/** From this pitch the numeral sits beside the bead; below it, above or under. */
export const ORDINAL_BESIDE_MIN_PITCH_PX = 24;
export const PAD_LEFT_PX = 6;
export const PAD_RIGHT_PX = 8;
/** One row of the chapter strip above the bands, and its padding. */
export const CHAPTER_ROW_PX = 14;
export const CHAPTER_STRIP_PAD_PX = 2;
export const CHAPTER_STRIP_GAP_PX = 4;
/** Room under the bands for the depth axis. */
export const AXIS_PX = 16;
/** A tall band never spreads the lanes past this: the picture stays one object. */
export const MAX_BAND_PX = 112;
export const COMPILE_GAP_PX = 10;
export const STEM_PX = 18;
/** Room the Final Receipt capsule takes right of the compilation stem. */
export const FINAL_CAPSULE_PX = 140;
export const POST_SEAL_INSET_PX = 10;
/** The post-seal zone is never narrower than its own label. */
export const POST_SEAL_ROOM_PX = 230;

/** The floors a review can check for the depth geometry. Sizes in px unless stated. */
export const READABILITY_FLOORS_B2 = Object.freeze({
  beadPx: MIN_BEAD_PX,
  hitAreaPx: HIT_AREA_PX,
  pitchPx: MIN_PITCH_PX,
  gutterPx: MIN_GUTTER_PX,
  /** Two receipts of one lane and one depth are stacked no closer than this. */
  cellStepPx: MIN_PITCH_PX + 4,
  laneLabelRem: 0.56,
  chapterLabelRem: 0.56,
  threadStrokePx: 0.8,
  threadOpacity: 0.2,
  finalReceiptPx: 28,
});

/*
 * Thread constants. The clearance is what a same-lane arch adds over the
 * radius of the first bead it passes, and each further bead adds a bead and
 * a half, so two arches never read as one. A cross-lane run keeps a bead's
 * radius plus the run clearance from the columns either side of its gap, and
 * two runs in one gap stand a run step apart — a bead's width, the distance
 * at which two hairlines are two hairlines — unless the gap cannot hold them
 * at that step, when they share what it has. The corner radius rounds the
 * lead into the run and the run into the tail.
 */
const BEAD_CLEARANCE_PX = 4;
/** The horizontal reach of a same-lane thread's tangents, as a share of its span. */
const TANGENT_REACH = 0.5;
const TANGENT_MIN_PX = 6;
const RUN_CLEARANCE_PX = 3;
const RUN_STEP_PX = 6;
/** Two runs closer than this are one hairline; a gap holds only as many runs as keep it. */
const MIN_RUN_STEP_PX = 4.5;
const CORNER_MAX_PX = 8;
/**
 * THE FAN AT A SHARED BEAD. Threads that leave one parent (or enter one
 * child) toward the same side would share that bead's band line for as long
 * as the farthest of them runs along it — one line where there are several
 * relations, the doubled line Gate 1 measured. So each takes its own lead
 * (or tail) height: a fan step per sibling, opened over a bead's width at
 * the bead itself, the sibling whose run is nearest the bead taking the
 * height nearest the side its run goes to, so no lead crosses a sibling's
 * run. The step is what the bead's cell has room for — the band edge and a
 * stacked neighbour bound it — and when the room cannot keep siblings a
 * hairline apart the fan collapses toward the band line and SAYS SO in the
 * layout's `fans`, so a review can tell a declared collapse from a defect.
 */
export const FAN_STEP_PX = 5;
export const MIN_FAN_STEP_PX = 4.5;
const FAN_OPEN_PX = 4;
/** The circular-arc constant: a cubic's control distance for a quarter circle. */
const KAPPA = 0.5523;

export type ProofEvidence = Pick<PublicEvidence, "evidenceId" | "branch" | "causalParents" | "observedInputs" | "standing" | "timeMs" | "admissionIndex" | "episode">;

type Point = Readonly<{ x: number; y: number }>;

const round = (value: number) => Math.round(value * 100) / 100;

/** The field's vertical room: the band minus the head and the legend. */
export function fieldTallOf(heightPx: number): number {
  return Math.max(0, heightPx - LABEL_PX - LEGEND_PX);
}

/**
 * The lanes in band order: the caller's declared branches, then any lane a
 * receipt names that the caller did not declare — a receipt is never silently
 * filed under another provenance (B R2 §7, kept).
 */
export function lanesOf(items: readonly ProofEvidence[], branches: readonly ProvenanceLane[]): readonly ProvenanceLane[] {
  const lanes: ProvenanceLane[] = [...branches];
  for (const entry of items) if (!lanes.includes(entry.branch)) lanes.push(entry.branch);
  return lanes;
}

/**
 * Chapters as depth-range spans: for every episode present, the first and the
 * last depth column any of its receipts occupies. Ordered by first column,
 * then canonical episode order, so the strip reads left to right.
 */
export function depthChapters(items: readonly ProofEvidence[], depth: ReadonlyMap<string, number>): readonly Chapter[] {
  const spans = new Map<EvidenceEpisode, { fromRow: number; toRow: number }>();
  for (const entry of items) {
    const column = depth.get(entry.evidenceId) ?? 0;
    const span = spans.get(entry.episode);
    if (span === undefined) spans.set(entry.episode, { fromRow: column, toRow: column });
    else { span.fromRow = Math.min(span.fromRow, column); span.toRow = Math.max(span.toRow, column); }
  }
  return [...spans].map(([episode, span]) => ({ episode, ...span })).sort((left, right) => (
    left.fromRow - right.fromRow || EPISODE_ORDER.indexOf(left.episode) - EPISODE_ORDER.indexOf(right.episode) || left.toRow - right.toRow
  ));
}

export type ChapterRows = Readonly<{ rowOf: readonly number[]; count: number }>;

/**
 * Which strip row each chapter's span sits on. Spans overlap in depth — the
 * detached `signalStop` component runs from column 0 beside `missionStart`,
 * `passenger` and `garageRoute` — so overlapping spans take separate rows and
 * the overlap stays visible instead of being hidden. Greedy over spans in
 * first-column order: the first row whose last span ends before this one
 * begins. Deterministic, and never a claim: a row is a shelf, not a rank.
 */
export function chapterRows(chapters: readonly Chapter[]): ChapterRows {
  const rowEnd: number[] = [];
  const rowOf = chapters.map((chapter) => {
    let row = rowEnd.findIndex((end) => end < chapter.fromRow);
    if (row < 0) { row = rowEnd.length; rowEnd.push(chapter.toRow); } else rowEnd[row] = chapter.toRow;
    return row;
  });
  return { rowOf, count: rowEnd.length };
}

/** The vertical room the chapter strip takes above the bands. */
export function stripHeightOf(rows: number): number {
  return rows === 0 ? 0 : CHAPTER_STRIP_PAD_PX + rows * CHAPTER_ROW_PX + CHAPTER_STRIP_GAP_PX;
}

export type Band = Readonly<{ branch: ProvenanceLane; top: number; centre: number; bottom: number }>;

/**
 * The bands of a laid-out proof, for the component: where each lane's band
 * lies vertically, from the strip the layout reserved and the band height it
 * chose. Derived from the layout alone, so the component and the geometry
 * cannot disagree about a band.
 */
export function bandsOf(layout: ProofLayout, lanes: readonly ProvenanceLane[]): Readonly<{ top: number; bottom: number; centre: number; bands: readonly Band[] }> {
  const top = stripHeightOf(chapterRows(layout.chapters).count);
  const bands = lanes.map((branch, index) => ({
    branch,
    top: top + index * layout.laneWidth,
    centre: top + (index + 0.5) * layout.laneWidth,
    bottom: top + (index + 1) * layout.laneWidth,
  }));
  const bottom = top + lanes.length * layout.laneWidth;
  return { top, bottom, centre: (top + bottom) / 2, bands };
}

/** How high a same-lane thread arches, and to which side of its band's centre line. */
type Arch = Readonly<{ apex: number; side: 1 | -1 }>;

/**
 * A same-lane thread arches over the beads of its own band that lie between
 * its ends — obstacles to it, not relations — by the first bead's radius plus
 * a clearance, and a bead and a half more for every further bead, so the
 * longer sibling of a fan takes the higher arc. It arches to whichever side
 * of the band's centre line has more room, and never past its own band.
 */
function archOf(from: Point, to: Point, beadsPassed: number, bead: number, bandTop: number, bandBottom: number, imposedSide?: 1 | -1): Arch {
  const radius = bead / 2;
  const roomAbove = Math.min(from.y, to.y) - bandTop - radius - 2;
  const roomBelow = bandBottom - Math.max(from.y, to.y) - radius - 2;
  const side: 1 | -1 = imposedSide ?? (roomAbove >= roomBelow ? 1 : -1);
  const room = Math.max(0, side === 1 ? roomAbove : roomBelow);
  const wanted = beadsPassed === 0 ? 0 : radius + BEAD_CLEARANCE_PX + (beadsPassed - 1) * (bead + 5);
  return { apex: Math.min(wanted, room), side };
}

/**
 * A same-lane thread: horizontal tangents reaching half the horizontal span,
 * both control points lifted by the arch. A symmetric cubic crowns at three
 * quarters of its control offset, so the lift is four thirds of the apex. Two
 * same-lane threads from one bead part by their arches (the longer passes
 * more beads and arches higher) or by their ends (the two beads of a stacked
 * cell lie a cell step apart, and the curves to them are mirror images).
 */
function alongBand(from: Point, to: Point, arch: Arch): string {
  const reach = Math.max(TANGENT_MIN_PX, TANGENT_REACH * Math.max(1, to.x - from.x));
  const lift = (4 / 3) * arch.apex * arch.side;
  const c1 = { x: from.x + reach, y: from.y - lift };
  const c2 = { x: to.x - reach, y: to.y - lift };
  return `M ${from.x} ${from.y} C ${round(c1.x)} ${round(c1.y)}, ${round(c2.x)} ${round(c2.y)}, ${to.x} ${to.y}`;
}

/**
 * A cross-lane thread: a horizontal lead from the parent, one vertical run
 * at `runX`, a horizontal tail into the child, the two corners rounded as
 * quarter circles. The corner radius is what the thread has room for: never
 * more than the ceiling, half the drop, or the lead or the tail itself. A
 * lead (or tail) with a fan height leaves the bead's centre and opens onto
 * its own height over a bead's width, as a small S; the path still starts
 * on its parent and ends on its child.
 */
function acrossBands(from: Point, to: Point, runX: number, leadHeight: number, tailHeight: number, open: number): string {
  const x = round(runX);
  const y0 = from.y;
  const y1 = to.y;
  const yLead = round(y0 + leadHeight);
  const yTail = round(y1 + tailHeight);
  const openLead = leadHeight === 0 ? 0 : Math.max(0, Math.min(open, x - from.x - 1));
  const openTail = tailHeight === 0 ? 0 : Math.max(0, Math.min(open, to.x - x - 1));
  const drop = yTail - yLead;
  const down = drop >= 0 ? 1 : -1;
  const radius = round(Math.max(0, Math.min(CORNER_MAX_PX, Math.abs(drop) / 2, x - from.x - openLead, to.x - x - openTail)));
  const k = round(radius * KAPPA);
  const lead = round(x - radius);
  const tail = round(x + radius);
  const top = round(yLead + down * radius);
  const bottom = round(yTail - down * radius);
  const opening = openLead > 0
    ? `C ${round(from.x + openLead / 2)} ${y0}, ${round(from.x + openLead / 2)} ${yLead}, ${round(from.x + openLead)} ${yLead}`
    : null;
  const closing = openTail > 0
    ? `L ${round(to.x - openTail)} ${yTail} C ${round(to.x - openTail / 2)} ${yTail}, ${round(to.x - openTail / 2)} ${y1}, ${to.x} ${y1}`
    : `L ${to.x} ${y1}`;
  return [
    `M ${from.x} ${y0}`,
    opening,
    `L ${lead} ${yLead}`,
    `C ${round(lead + k)} ${yLead}, ${x} ${round(top - down * k)}, ${x} ${top}`,
    `L ${x} ${bottom}`,
    `C ${x} ${round(bottom + down * k)}, ${round(tail - k)} ${yTail}, ${tail} ${yTail}`,
    closing,
  ].filter((segment): segment is string => segment !== null).join(" ");
}

/**
 * One fan of a laid-out proof: the bead it opens at, on which side (leads
 * leave a parent, tails enter a child), toward which side of the band line
 * (+1 below, -1 above), how many threads it holds, the room the cell had,
 * and the step it could give them — below `MIN_FAN_STEP_PX` the fan is a
 * declared collapse, and `room < (count - 1) * MIN_FAN_STEP_PX` says why.
 */
export type FanPlan = Readonly<{
  evidenceId: string;
  side: "lead" | "tail";
  toward: 1 | -1;
  count: number;
  roomPx: number;
  stepPx: number;
  /** The threads of the fan, nearest run first, as `${parent}->${child}`. */
  threads: readonly string[];
}>;

/** One cross-lane thread routed through a gap: where its run stands and what it spans. */
type Route = Readonly<{ thread: Pending; gap: string; gapX: number; lo: number; hi: number }>;

type Pending = Readonly<{ relation: CausalRelation; from: BeadPlacement; to: BeadPlacement; arch: Arch }>;

/**
 * The runs of one gap, ordered so that leads and tails cross as few runs as
 * they can. A lead at y from the left crosses every run standing left of its
 * own whose span contains y; a tail at y to the right crosses every run
 * standing right of its own whose span contains y. So for two runs A and B:
 * A's start inside B's span asks A to stand LEFT of B, A's end inside B's
 * span asks A to stand RIGHT of B, and B asks the same of A. The asks are
 * counted, the majority becomes an edge, and the edges are walked in
 * topological order — a cycle, where no order satisfies everyone, is broken
 * at the run with the fewest remaining asks. Ties fall to the span's top,
 * then its bottom, then the relation's key: deterministic, never a claim.
 */
function orderRuns(routes: readonly Route[]): readonly Route[] {
  const inside = (y: number, route: Route) => y > route.lo + 1 && y < route.hi - 1;
  const key = (route: Route) => `${route.thread.relation.parent}->${route.thread.relation.child}`;
  const tie = (left: Route, right: Route) => left.lo - right.lo || left.hi - right.hi || (key(left) < key(right) ? -1 : 1);
  const leftOf = new Map<Route, Set<Route>>(routes.map((route) => [route, new Set<Route>()]));
  for (let i = 0; i < routes.length; i += 1) {
    for (let j = i + 1; j < routes.length; j += 1) {
      const a = routes[i]!;
      const b = routes[j]!;
      const aLeft = (inside(a.thread.from.y, b) ? 1 : 0) + (inside(b.thread.to.y, a) ? 1 : 0);
      const aRight = (inside(a.thread.to.y, b) ? 1 : 0) + (inside(b.thread.from.y, a) ? 1 : 0);
      if (aLeft > aRight) leftOf.get(a)!.add(b);
      else if (aRight > aLeft) leftOf.get(b)!.add(a);
    }
  }
  const remaining = new Set(routes);
  const ordered: Route[] = [];
  while (remaining.size > 0) {
    const asks = (route: Route) => [...remaining].filter((other) => leftOf.get(other)!.has(route)).length;
    const candidates = [...remaining].sort((left, right) => asks(left) - asks(right) || tie(left, right));
    const next = candidates[0]!;
    remaining.delete(next);
    ordered.push(next);
  }
  return ordered;
}

export function layoutProofB2(input: Readonly<{
  items: readonly ProofEvidence[];
  branches: readonly ProvenanceLane[];
  finalReceipt: boolean;
  widthPx: number;
  heightPx: number;
}>): ProofLayout & Readonly<{ fans: readonly FanPlan[] }> {
  const { items } = input;
  const lanes = lanesOf(items, input.branches);
  const columns = Math.max(1, lanes.length);
  const laneIndex = new Map(lanes.map((branch, index) => [branch, index] as const));
  const closure = items.filter((entry) => entry.standing !== "JOURNAL");
  const journal = items.filter((entry) => entry.standing === "JOURNAL");
  // Depth over the declared relations of the items present. The post-seal
  // zone numbers its own columns among its own records, as the ordinal does.
  const sealedDepth = causalLevels(closure);
  const journalDepth = causalLevels(journal);
  const sealedColumns = closure.length === 0 ? 0 : 1 + Math.max(...closure.map((entry) => sealedDepth.get(entry.evidenceId) ?? 0));
  const journalColumns = journal.length === 0 ? 0 : 1 + Math.max(...journal.map((entry) => journalDepth.get(entry.evidenceId) ?? 0));
  const chapters = depthChapters(closure, sealedDepth);
  const strip = chapterRows(chapters);
  const showFinal = input.finalReceipt;

  const width = Math.max(1, input.widthPx);
  const gutter = Math.max(MIN_GUTTER_PX, Math.min(MAX_GUTTER_PX, Math.round(width * 0.09)));
  const fieldTall = fieldTallOf(input.heightPx);
  const stripHeight = stripHeightOf(strip.count);
  const band = Math.min(MAX_BAND_PX, Math.max(1, fieldTall - stripHeight - AXIS_PX) / columns);
  const bandsTop = stripHeight;
  const bandsBottom = bandsTop + columns * band;

  // The pitch is the largest one the WIDTH can hold, never below the floor,
  // chosen from the sealed mission alone (B R2 §19).
  const finalRoom = showFinal ? COMPILE_GAP_PX + STEM_PX + FINAL_CAPSULE_PX : 0;
  const sealedWidthFor = (pitch: number) => gutter + PAD_LEFT_PX + sealedColumns * pitch + finalRoom + PAD_RIGHT_PX;
  const journalRoomFor = (pitch: number) => (
    journalColumns === 0 ? 0 : POST_SEAL_GAP_PX + Math.max(POST_SEAL_ROOM_PX, POST_SEAL_INSET_PX + journalColumns * pitch)
  );
  const widthFor = (pitch: number) => sealedWidthFor(pitch) + journalRoomFor(pitch);
  let pitch = MAX_PITCH_B2_PX;
  while (pitch > MIN_PITCH_PX && sealedWidthFor(pitch) > width) pitch -= 1;
  const fit: ProofLayout["fit"] = widthFor(pitch) <= width ? "fit" : "scroll";
  const bead = Math.max(MIN_BEAD_PX, Math.min(MAX_BEAD_B2_PX, Math.round(pitch * 0.4)));

  const xOfColumn = (column: number) => gutter + PAD_LEFT_PX + column * pitch + pitch / 2;
  const lastSealedRight = sealedColumns === 0 ? gutter + PAD_LEFT_PX : xOfColumn(sealedColumns - 1) + pitch / 2;
  const compileX = showFinal ? lastSealedRight + COMPILE_GAP_PX : null;
  const finalX = compileX === null ? null : compileX + STEM_PX;
  const sealedEnd = finalX === null ? lastSealedRight : finalX + FINAL_CAPSULE_PX;
  const postSealX = journalColumns === 0 ? null : sealedEnd + POST_SEAL_GAP_PX;
  const xOfJournalColumn = (column: number) => (postSealX ?? 0) + POST_SEAL_INSET_PX + column * pitch + pitch / 2;
  const end = postSealX === null ? sealedEnd : postSealX + Math.max(POST_SEAL_ROOM_PX, POST_SEAL_INSET_PX + journalColumns * pitch);
  const contentWidth = Math.ceil(end + PAD_RIGHT_PX);

  // Seat every receipt: x from its column, y from its band's centre plus a
  // deterministic sub-offset when several receipts of ONE lane share a depth.
  // The stack is symmetric about the centre line, never closer than the floor:
  // spacing, never rank or sequence.
  //
  // WHICH RECEIPT SITS ON TOP. A stacked receipt sits on the side its declared
  // parents come from: one whose parents lie in a band ABOVE sits at the top
  // of the stack, one whose parents lie in its own band or below sits under
  // it. Otherwise a thread descending from the band above had to run along
  // the same-lane thread arriving beside it — two unrelated relations read as
  // one line (NR 08 -> NR 09 over NR 03 -> NR 04). The side is decided from
  // the declared relations alone; the reading order only breaks a tie.
  const cellStep = Math.max(MIN_PITCH_PX + 4, bead + 8);
  const centreOf = (branch: ProvenanceLane) => bandsTop + ((laneIndex.get(branch) ?? 0) + 0.5) * band;
  const laneOfId = new Map(items.map((entry) => [entry.evidenceId, entry.branch] as const));
  const parentSide = (entry: ProofEvidence) => {
    const own = laneIndex.get(entry.branch) ?? 0;
    const parents = [...entry.causalParents, ...entry.observedInputs].map((id) => laneOfId.get(id)).filter((lane): lane is ProvenanceLane => lane !== undefined);
    if (parents.length === 0) return 0;
    return parents.reduce((sum, lane) => sum + ((laneIndex.get(lane) ?? own) - own), 0) / parents.length;
  };
  const placed = new Map<string, BeadPlacement>();
  const beads: BeadPlacement[] = [];
  const seat = (zone: BeadPlacement["zone"], ordered: readonly ProofEvidence[], depth: ReadonlyMap<string, number>, xOf: (column: number) => number, rankOffset: number) => {
    const cells = new Map<string, ProofEvidence[]>();
    for (const entry of ordered) {
      const key = `${entry.branch}@${depth.get(entry.evidenceId) ?? 0}`;
      cells.set(key, [...(cells.get(key) ?? []), entry]);
    }
    for (const members of cells.values()) {
      if (members.length > 1) members.sort((left, right) => parentSide(left) - parentSide(right) || ordered.indexOf(left) - ordered.indexOf(right));
    }
    ordered.forEach((entry, index) => {
      const column = depth.get(entry.evidenceId) ?? 0;
      const members = cells.get(`${entry.branch}@${column}`) ?? [entry];
      const offset = (members.indexOf(entry) - (members.length - 1) / 2) * cellStep;
      const placement: BeadPlacement = {
        evidenceId: entry.evidenceId, branch: entry.branch, rank: rankOffset + index, row: column, zone,
        x: round(xOf(column)), y: round(centreOf(entry.branch) + offset),
      };
      beads.push(placement);
      placed.set(entry.evidenceId, placement);
    });
  };
  const sealedOrder = readingOrder(closure);
  seat("closure", sealedOrder, sealedDepth, xOfColumn, 0);
  seat("journal", readingOrder(journal), journalDepth, xOfJournalColumn, sealedOrder.length);

  // Threads. A same-lane thread's arch is settled from its two bead positions
  // and the beads of its own band between them. A cross-lane thread is
  // routed through one gap between columns (below).
  const relations = relationsOf(items);
  const laneBeads = new Map<ProvenanceLane, BeadPlacement[]>();
  for (const placement of beads) laneBeads.set(placement.branch, [...(laneBeads.get(placement.branch) ?? []), placement]);
  const pending: Pending[] = [];
  const beadsPassedOf = new Map<CausalRelation, number>();
  for (const relation of relations) {
    const from = placed.get(relation.parent);
    const to = placed.get(relation.child);
    if (from === undefined || to === undefined) continue;
    const bandTop = bandsTop + (laneIndex.get(from.branch) ?? 0) * band;
    // A same-lane thread arches only over what is in its way: the beads of
    // its own band between its ends are obstacles to it, not relations.
    const beadsPassed = relation.crossLane ? 0 : (laneBeads.get(from.branch) ?? []).filter((other) => (
      other.x > from.x + 1 && other.x < to.x - 1
    )).length;
    beadsPassedOf.set(relation, beadsPassed);
    const arch = relation.crossLane ? { apex: 0, side: 1 as const } : archOf(from, to, beadsPassed, bead, bandTop, bandTop + band);
    pending.push({ relation, from, to, arch });
  }
  // Two same-lane threads into one child (or out of one parent) that both
  // pass beads would arch on the same side, and a shallow band caps both
  // arches at the same height — one arc where there are two relations. The
  // siblings of such a fan take ALTERNATE sides of the band line, longest
  // arch first, so a shallow band parts them by twice its room. Fan-ins are
  // settled first; a thread already settled keeps its side in its parent's
  // fan, and the others take the side its group has used least.
  const archedSiblings = (keyOfEnd: (thread: Pending) => string) => {
    const groups = new Map<string, Pending[]>();
    for (const thread of pending) {
      if (thread.relation.crossLane || (beadsPassedOf.get(thread.relation) ?? 0) === 0) continue;
      groups.set(keyOfEnd(thread), [...(groups.get(keyOfEnd(thread)) ?? []), thread]);
    }
    return [...groups.values()].filter((group) => group.length > 1);
  };
  const settledSide = new Map<Pending, 1 | -1>();
  const settle = (groups: readonly Pending[][]) => {
    for (const group of groups) {
      const ordered = [...group].sort((left, right) => (beadsPassedOf.get(right.relation)! - beadsPassedOf.get(left.relation)!) || (keyOf(left) < keyOf(right) ? -1 : 1));
      const used = { 1: 0, [-1]: 0 } as Record<1 | -1, number>;
      for (const thread of ordered) if (settledSide.has(thread)) used[settledSide.get(thread)!] += 1;
      for (const thread of ordered) {
        if (settledSide.has(thread)) continue;
        const side: 1 | -1 = used[1] <= used[-1] ? 1 : -1;
        used[side] += 1;
        settledSide.set(thread, side);
      }
    }
  };
  settle(archedSiblings((thread) => thread.relation.child));
  settle(archedSiblings((thread) => thread.relation.parent));
  for (const [thread, side] of settledSide) {
    const bandTop = bandsTop + (laneIndex.get(thread.from.branch) ?? 0) * band;
    const index = pending.indexOf(thread);
    pending[index] = { ...thread, arch: archOf(thread.from, thread.to, beadsPassedOf.get(thread.relation)!, bead, bandTop, bandTop + band, side) };
  }
  const keyOf = (thread: Pending) => `${thread.relation.parent}->${thread.relation.child}`;

  // CHANNEL ROUTING of the cross-lane threads. Each takes ONE gap between two
  // columns of its span for its vertical run — shortest spans first, since a
  // one-column hop has no choice — scored by what the choice would draw: a
  // lead or tail passing over a bead it does not name is never chosen while
  // any gap avoids it; then a gap already holding as many overlapping runs
  // as it can keep apart; then the fewest runs already standing where its
  // lead and tail would cross them; then the emptiest gap; then the one
  // nearest the middle of its span. Then every gap's runs are ordered
  // (`orderRuns`) and seated at distinct x, a run step apart, sharing an x
  // only when their spans are clear of one another — so no two runs of one
  // gap that overlap in height ever stand at the same x. The gap's room is
  // the pitch less a bead and the run clearance either side, so a run never
  // touches the beads of the columns beside it; when the crossing-free order
  // would need more runs than the room keeps apart, the runs are seated in
  // span order instead — a crossing is legible, two hairlines apart are not.
  const runRoom = Math.max(0, pitch - bead - 2 * RUN_CLEARANCE_PX);
  const capacity = 1 + Math.floor(runRoom / MIN_RUN_STEP_PX);
  const gapXOf = (zone: BeadPlacement["zone"], gap: number) => (zone === "closure" ? xOfColumn(gap) : xOfJournalColumn(gap));
  const touchesAlong = (y: number, x0: number, x1: number, thread: Pending) => beads.filter((other) => (
    other.evidenceId !== thread.relation.parent && other.evidenceId !== thread.relation.child
    && other.x > Math.min(x0, x1) - bead / 2 && other.x < Math.max(x0, x1) + bead / 2 && Math.abs(other.y - y) < bead / 2 + RUN_CLEARANCE_PX
  )).length;
  const spans = (route: Route, y: number) => y > route.lo + 1 && y < route.hi - 1;
  // Two spans that only meet at one height (one ends where the other begins)
  // may share an x: the two corners stand back to back and never touch.
  const overlaps = (left: Route, right: Route) => left.lo < right.hi - 1 && right.lo < left.hi - 1;
  const routes: Route[] = [];
  const crossLane = pending.filter((thread) => thread.relation.crossLane).sort((left, right) => (
    (left.to.row - left.from.row) - (right.to.row - right.from.row) || (keyOf(left) < keyOf(right) ? -1 : 1)
  ));
  for (const thread of crossLane) {
    const sameZone = thread.from.zone === thread.to.zone;
    const gaps: Array<{ gap: string; gapX: number; at: number }> = [];
    if (sameZone && thread.to.row > thread.from.row) {
      for (let at = thread.from.row + 0.5; at < thread.to.row; at += 1) gaps.push({ gap: `${thread.from.zone}:${at}`, gapX: gapXOf(thread.from.zone, at), at });
    } else {
      gaps.push({ gap: `${thread.from.zone}>${thread.to.zone}:${round((thread.from.x + thread.to.x) / 2)}`, gapX: (thread.from.x + thread.to.x) / 2, at: 0 });
    }
    const lo = Math.min(thread.from.y, thread.to.y);
    const hi = Math.max(thread.from.y, thread.to.y);
    const middle = (thread.from.row + thread.to.row) / 2;
    const scored = gaps.map((candidate) => {
      const touches = touchesAlong(thread.from.y, thread.from.x, candidate.gapX, thread) + touchesAlong(thread.to.y, candidate.gapX, thread.to.x, thread);
      const crossings = routes.filter((route) => (
        (route.gapX > thread.from.x && route.gapX < candidate.gapX && spans(route, thread.from.y))
        || (route.gapX > candidate.gapX && route.gapX < thread.to.x && spans(route, thread.to.y))
      )).length;
      const load = routes.filter((route) => route.gap === candidate.gap && route.lo < hi - 1 && lo < route.hi - 1).length;
      const full = load + 1 > capacity ? 1 : 0;
      return { ...candidate, score: touches * 1000 + full * 60 + crossings * 10 + load * 3 + Math.abs(candidate.at - middle) };
    }).sort((left, right) => left.score - right.score || left.at - right.at);
    const chosen = scored[0]!;
    routes.push({ thread, gap: chosen.gap, gapX: chosen.gapX, lo, hi });
  }
  const runXOf = new Map<Pending, number>();
  const byGap = new Map<string, Route[]>();
  for (const route of routes) byGap.set(route.gap, [...(byGap.get(route.gap) ?? []), route]);
  // In the crossing-free order a run stands RIGHT of every overlapping run
  // before it (the order is the picture); in the fallback it takes the first
  // x no overlapping run holds — the fewest x an interval order can need.
  const slotRuns = (ordered: readonly Route[], firstFree: boolean) => {
    const slotOf = new Map<Route, number>();
    ordered.forEach((route, index) => {
      const taken = ordered.slice(0, index).filter((earlier) => overlaps(route, earlier)).map((earlier) => slotOf.get(earlier)!);
      let slot = 0;
      if (firstFree) while (taken.includes(slot)) slot += 1;
      else slot = taken.length === 0 ? 0 : 1 + Math.max(...taken);
      slotOf.set(route, slot);
    });
    return { slotOf, slots: 1 + Math.max(...ordered.map((route) => slotOf.get(route)!)) };
  };
  for (const members of byGap.values()) {
    const bySpan = [...members].sort((left, right) => left.lo - right.lo || left.hi - right.hi || (keyOf(left.thread) < keyOf(right.thread) ? -1 : 1));
    const crossingFree = slotRuns(orderRuns(members), false);
    const seated = crossingFree.slots <= capacity ? crossingFree : [crossingFree, slotRuns(bySpan, true)].sort((left, right) => left.slots - right.slots)[0]!;
    const step = seated.slots === 1 ? 0 : Math.min(RUN_STEP_PX, runRoom / (seated.slots - 1));
    for (const route of members) runXOf.set(route.thread, route.gapX + (seated.slotOf.get(route)! - (seated.slots - 1) / 2) * step);
  }

  // THE FANS. The cross-lane threads leaving one parent toward one side, and
  // those entering one child from one side, each take their own height on
  // the shared bead's band line (see FAN_STEP_PX). The room is what the
  // bead's cell has toward that side: the band's edge, and a stacked
  // neighbour in the same cell, each kept a bead's radius and a clearance
  // away. A fan the room cannot hold apart is recorded as such.
  const fans: FanPlan[] = [];
  const leadHeight = new Map<Pending, number>();
  const tailHeight = new Map<Pending, number>();
  const roomToward = (at: BeadPlacement, toward: 1 | -1) => {
    const top = bandsTop + (laneIndex.get(at.branch) ?? 0) * band;
    const edge = (toward > 0 ? top + band - at.y : at.y - top) - 2;
    const mates = beads
      .filter((other) => other.zone === at.zone && other.branch === at.branch && other.row === at.row && other.evidenceId !== at.evidenceId && Math.sign(other.y - at.y) === toward)
      .map((other) => Math.abs(other.y - at.y) - bead / 2 - RUN_CLEARANCE_PX);
    return Math.max(0, Math.min(edge, ...mates));
  };
  const planFan = (side: FanPlan["side"], at: BeadPlacement, members: readonly Route[], toward: 1 | -1) => {
    const ordered = [...members].sort((left, right) => (
      Math.abs(runXOf.get(left.thread)! - at.x) - Math.abs(runXOf.get(right.thread)! - at.x) || (keyOf(left.thread) < keyOf(right.thread) ? -1 : 1)
    ));
    const count = ordered.length;
    const room = roomToward(at, toward);
    const step = count > 1 ? Math.max(0, Math.min(FAN_STEP_PX, room / (count - 1))) : 0;
    ordered.forEach((route, rank) => (side === "lead" ? leadHeight : tailHeight).set(route.thread, round(toward * (count - 1 - rank) * step)));
    fans.push({ evidenceId: at.evidenceId, side, toward, count, roomPx: round(room), stepPx: round(step), threads: ordered.map((route) => keyOf(route.thread)) });
  };
  const leadsOf = new Map<string, Route[]>();
  const tailsOf = new Map<string, Route[]>();
  for (const route of routes) {
    const toward: 1 | -1 = route.thread.to.y >= route.thread.from.y ? 1 : -1;
    // A lead opens toward the side the run goes to; a tail toward the side it comes from.
    const leadKey = `${route.thread.relation.parent}#${toward}`;
    const tailKey = `${route.thread.relation.child}#${-toward}`;
    leadsOf.set(leadKey, [...(leadsOf.get(leadKey) ?? []), route]);
    tailsOf.set(tailKey, [...(tailsOf.get(tailKey) ?? []), route]);
  }
  for (const [key, members] of leadsOf) planFan("lead", members[0]!.thread.from, members, Number(key.slice(key.lastIndexOf("#") + 1)) as 1 | -1);
  for (const [key, members] of tailsOf) planFan("tail", members[0]!.thread.to, members, Number(key.slice(key.lastIndexOf("#") + 1)) as 1 | -1);

  const threads: ThreadPlacement[] = pending.map((thread) => ({
    ...thread.relation,
    key: `${thread.relation.kind}:${thread.relation.parent}->${thread.relation.child}`,
    d: thread.relation.crossLane
      ? acrossBands(thread.from, thread.to, runXOf.get(thread) ?? (thread.from.x + thread.to.x) / 2, leadHeight.get(thread) ?? 0, tailHeight.get(thread) ?? 0, bead + FAN_OPEN_PX)
      : alongBand(thread.from, thread.to, thread.arch),
  }));

  // The compilation gathers from the deepest sealed bead of each lane — the
  // rightmost of its band, so a horizontal gathering line passes nothing.
  const deepestInLane = new Map<ProvenanceLane, BeadPlacement>();
  for (const placement of beads) {
    if (placement.zone !== "closure") continue;
    const previous = deepestInLane.get(placement.branch);
    if (previous === undefined || placement.row > previous.row || (placement.row === previous.row && placement.rank > previous.rank)) deepestInLane.set(placement.branch, placement);
  }
  const anchors = lanes.flatMap((branch) => {
    const placement = deepestInLane.get(branch);
    return placement === undefined ? [] : [{ evidenceId: placement.evidenceId, branch, x: placement.x, y: placement.y }];
  });

  const chapterPlacements: ChapterPlacement[] = chapters.map((chapter) => ({
    ...chapter,
    top: round(xOfColumn(chapter.fromRow) - pitch / 2),
    labelY: round(xOfColumn(chapter.fromRow) - pitch / 2 + 2),
    bottom: round(xOfColumn(chapter.toRow) + pitch / 2),
  }));

  return {
    columns,
    gutter,
    laneWidth: band,
    pitch,
    bead,
    episodeGap: 0,
    fit,
    fieldHeight: width,
    contentHeight: contentWidth,
    rows: sealedColumns,
    journalRows: journalColumns,
    chapters: chapterPlacements,
    rail: sealedColumns === 0 ? null : { x: round(bandsBottom + AXIS_PX / 2), top: round(xOfColumn(0)), bottom: round(xOfColumn(sealedColumns - 1)) },
    compileY: compileX,
    finalY: finalX,
    postSealY: postSealX,
    beads,
    threads,
    crossLaneThreads: threads.filter((thread) => thread.crossLane).length,
    sameLaneThreads: threads.filter((thread) => !thread.crossLane).length,
    anchors,
    fans,
  };
}

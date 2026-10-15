import { NOMINAL_CANVAS_WIDTH_PX, STAGE_PROOF_HEIGHT_PX } from "./stageGeometry.ts";
import type { Branch } from "./visualEvents.ts";

/**
 * The minimum a thing needs to be placed. Deliberately structural rather than
 * tied to one type: P2R made the Proof Tree a projection of evidence objects,
 * and the layout must not care whether it is placing a presentation event or
 * an evidence leaf — only when it happened, whose lane it is in, and whether
 * it carries a caption.
 */
export type PlaceableLeaf = Readonly<{
  id: string;
  timeMs: number;
  branch: Branch;
  featured?: boolean;
}>;

/**
 * D-006G P2 — where each proof leaf sits, and why.
 *
 * THE PROBLEM. `proofXForEvent` maps x linearly to mission time with no
 * capacity model, so a burst of evidence in a short window collides no matter
 * how few labels are drawn. Measured on the delivered timeline: six smart-city
 * records span 49 px and seven vehicle records span 41 px, against a 10 px
 * leaf — roughly 6 px per event where 14 px is needed.
 *
 * WHAT IS NOT ALLOWED. x is time, and time is the one axis a proof tree must
 * not bend: moving an event along x to make room would state that it happened
 * when it did not. Equally forbidden are shrinking text past legibility,
 * hiding evidence, dropping evidence, and reordering causality.
 *
 * THE APPROACH — branch-local packing. Each trust domain owns a horizontal
 * lane. Within a lane, events that are too close in TIME are given different
 * sub-rows, so they separate vertically instead of overlapping. Nothing moves
 * horizontally, nothing is hidden, nothing is merged, and every record keeps
 * its own leaf and its own identity in the DOM — a viewer can still address
 * each one individually, which visual aggregation would have cost.
 *
 * Sub-rows are allocated greedily in time order: an event takes the first
 * sub-row whose most recent occupant is far enough behind it. That is
 * deterministic — the same events always produce the same layout, so seeking
 * and replaying reconstruct an identical tree — and it uses only as many
 * sub-rows as the local density actually demands, so sparse stretches of the
 * mission stay on a single clean line.
 */

/** Diagonal of a 10 px leaf rotated 45°, plus breathing room. */
const LEAF_FOOTPRINT_PX = 16;

/**
 * A featured leaf carries a persistent caption, and the caption is an order
 * of magnitude wider than the leaf. Two featured events far enough apart for
 * their leaves not to touch can still have their captions overlap — which is
 * what "Mission Request Receipt" and "Vehicle Authority Receipt" did, five
 * seconds apart on the same row. The side-choosing label solver cannot fix
 * that: it picks left or right, and both were already on the same line.
 *
 * So a featured event reserves its caption's width against ANOTHER featured
 * event on the same sub-row. Unlabelled leaves still only reserve a leaf,
 * because a caption passing over a bare dot reads fine.
 */
const LABEL_FOOTPRINT_PX = 150;

/** The proof canvas spans this share of the timeline width. */
const PROOF_X_SPAN_PCT = 84;

/**
 * Lanes are laid out top to bottom in this order, and each is given vertical
 * space in PROPORTION TO HOW CROWDED IT IS.
 *
 * Fixed-height lanes were the previous mistake: eight equal lanes on a 330 px
 * canvas leave ~41 px each, and a lane needing four sub-rows then packs them
 * 9 px apart against a 16 px leaf — the packing allocated the rows correctly
 * and they still overlapped. Sizing by demand spends the canvas where the
 * evidence actually is: the sparse lanes are a single clean line, and the
 * intersection burst gets the room it needs, without any lane intruding on
 * its neighbour.
 */
export const LANE_ORDER: readonly Branch[] = [
  "city",
  "vehicle",
  "safety",
  "mission",
  "route",
  "service",
  "authority",
  "bank",
  "network",
];

export type ProofRowAssignment = Readonly<{
  eventId: string;
  branch: Branch;
  /** Sub-row within the lane, 0 = the lane's centre line. */
  subRow: number;
  /** Final vertical position, as a percentage of the proof canvas. */
  y: number;
}>;

export type ProofLayout = Readonly<{
  rows: ReadonlyMap<string, ProofRowAssignment>;
  /** Widest sub-row stack any lane needed. Useful for asserting density. */
  maxSubRows: number;
  /** Height of one sub-row in pixels — must exceed a leaf, or leaves touch. */
  rowHeightPx: number;
}>;

/**
 * Minimum separation, in mission milliseconds, below which two leaves in the
 * same lane would overlap on screen.
 */
export function minimumSeparationMs(
  missionDurationMs: number,
  canvasWidthPx = NOMINAL_CANVAS_WIDTH_PX,
): number {
  return pixelsToMs(LEAF_FOOTPRINT_PX, missionDurationMs, canvasWidthPx);
}

/** Separation two CAPTIONED leaves need before their captions overlap. */
export function minimumLabelledSeparationMs(
  missionDurationMs: number,
  canvasWidthPx = NOMINAL_CANVAS_WIDTH_PX,
): number {
  return pixelsToMs(LABEL_FOOTPRINT_PX, missionDurationMs, canvasWidthPx);
}

function pixelsToMs(pixels: number, missionDurationMs: number, canvasWidthPx: number): number {
  const pxPerPercent = canvasWidthPx / 100;
  const percentPerMs = PROOF_X_SPAN_PCT / missionDurationMs;
  return pixels / (percentPerMs * pxPerPercent);
}

export function computeProofLayout(
  events: readonly PlaceableLeaf[],
  missionDurationMs: number,
  canvasWidthPx = NOMINAL_CANVAS_WIDTH_PX,
  canvasHeightPx = STAGE_PROOF_HEIGHT_PX,
): ProofLayout {
  const leafGapMs = minimumSeparationMs(missionDurationMs, canvasWidthPx);
  const labelGapMs = minimumLabelledSeparationMs(missionDurationMs, canvasWidthPx);

  // 1 — greedy sub-row packing per lane, in time order. An event takes the
  //     first sub-row whose most recent occupant is far enough behind it, so
  //     only genuinely crowded stretches consume extra rows. Two captioned
  //     events need caption-width clearance from each other; everything else
  //     only needs to keep its leaf clear.
  const assignments = new Map<string, { branch: Branch; subRow: number }>();
  const subRowCount = new Map<Branch, number>();

  for (const branch of LANE_ORDER) {
    const ordered = events
      .filter((event) => event.branch === branch)
      .sort((left, right) => left.timeMs - right.timeMs || left.id.localeCompare(right.id));
    /** Most recent occupant of each sub-row: when it was, and whether captioned. */
    const lastInSubRow: { timeMs: number; featured: boolean }[] = [];
    /** Every captioned placement so far. A caption is taller than one row. */
    const captioned: { subRow: number; timeMs: number }[] = [];

    for (const event of ordered) {
      const featured = event.featured === true;
      const fitsRow = (occupant: { timeMs: number; featured: boolean }) => {
        const required = featured && occupant.featured ? labelGapMs : leafGapMs;
        return event.timeMs - occupant.timeMs >= required;
      };
      // A caption is ~22 px tall against a ~17 px row, so it also covers the
      // rows immediately above and below it. Clearing only its own row is what
      // left "Mission Request Receipt" still sitting on "Vehicle Authority
      // Receipt" after the leaves themselves had been separated.
      const clearOfNeighbours = (candidate: number) => !featured || captioned.every(
        (placed) => Math.abs(placed.subRow - candidate) > 1
          || event.timeMs - placed.timeMs >= labelGapMs,
      );

      let subRow = -1;
      for (let candidate = 0; candidate < lastInSubRow.length; candidate += 1) {
        if (fitsRow(lastInSubRow[candidate]) && clearOfNeighbours(candidate)) {
          subRow = candidate;
          break;
        }
      }
      if (subRow === -1) {
        subRow = lastInSubRow.length;
        while (!clearOfNeighbours(subRow)) subRow += 1;
        for (let fill = lastInSubRow.length; fill <= subRow; fill += 1) {
          lastInSubRow[fill] = { timeMs: Number.NEGATIVE_INFINITY, featured: false };
        }
      }
      lastInSubRow[subRow] = { timeMs: event.timeMs, featured };
      if (featured) captioned.push({ subRow, timeMs: event.timeMs });
      assignments.set(event.id, { branch, subRow });
    }
    subRowCount.set(branch, Math.max(1, lastInSubRow.length));
  }

  // 2 — spend the canvas in proportion to demand. Every sub-row anywhere in
  //     the tree gets the same height, so a lane with four rows is simply four
  //     times as tall as a lane with one.
  const totalRows = LANE_ORDER.reduce((sum, branch) => sum + (subRowCount.get(branch) ?? 1), 0);
  const rowHeightPct = 100 / totalRows;

  const laneTop = new Map<Branch, number>();
  let cursor = 0;
  for (const branch of LANE_ORDER) {
    laneTop.set(branch, cursor);
    cursor += (subRowCount.get(branch) ?? 1) * rowHeightPct;
  }

  const rows = new Map<string, ProofRowAssignment>();
  for (const [eventId, { branch, subRow }] of assignments) {
    // Centre of this sub-row's band, so leaves sit evenly and the outermost
    // ones keep half a row of clearance from the canvas edge.
    const y = (laneTop.get(branch) ?? 0) + (subRow + 0.5) * rowHeightPct;
    rows.set(eventId, { eventId, branch, subRow, y: Math.min(100, Math.max(0, y)) });
  }

  return {
    rows,
    maxSubRows: Math.max(1, ...subRowCount.values()),
    rowHeightPx: rowHeightPct / 100 * canvasHeightPx,
  };
}

/** Vertical distance, in pixels, between two leaf rows on the proof canvas. */
export function verticalGapPx(firstY: number, secondY: number): number {
  return Math.abs(firstY - secondY) / 100 * STAGE_PROOF_HEIGHT_PX;
}

/** Horizontal distance, in pixels, between two mission moments. */
export function horizontalGapPx(
  firstMs: number,
  secondMs: number,
  missionDurationMs: number,
  canvasWidthPx = NOMINAL_CANVAS_WIDTH_PX,
): number {
  const percent = Math.abs(firstMs - secondMs) / missionDurationMs * PROOF_X_SPAN_PCT;
  return percent / 100 * canvasWidthPx;
}

/**
 * Do two leaves overlap on screen? Used by the tests to assert the layout
 * actually separates a burst rather than merely claiming to.
 */
export function leavesCollide(
  first: Readonly<{ timeMs: number; y: number }>,
  second: Readonly<{ timeMs: number; y: number }>,
  missionDurationMs: number,
  canvasWidthPx = NOMINAL_CANVAS_WIDTH_PX,
): boolean {
  const dx = horizontalGapPx(first.timeMs, second.timeMs, missionDurationMs, canvasWidthPx);
  const dy = verticalGapPx(first.y, second.y);
  return dx < LEAF_FOOTPRINT_PX && dy < LEAF_FOOTPRINT_PX;
}

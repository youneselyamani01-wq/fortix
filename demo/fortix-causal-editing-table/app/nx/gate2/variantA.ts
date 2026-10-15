import type { EvidenceEpisode } from "../adapter/evidenceEpisode.ts";
import type { EvidenceStanding, ProvenanceLane } from "../adapter/publicExperienceAdapter.ts";
import { LABEL_PX, LEGEND_PX, RAIL_X_PX, layoutProof } from "../evidence/proofGeometry.ts";
import type { CanonicalReceipt } from "./canonicalGraph.ts";
import { graphMetrics } from "./graphMetrics.ts";
import type { VariantBuilder, VariantEdge, VariantLayout, VariantNode, VariantOrnament } from "./variantTypes.ts";

/**
 * D-006/NX GATE 2 — VARIANT A: THE CONTROL.
 *
 *   X = PROVENANCE LANE     one column per lane the evidence names.
 *   Y = READING ORDER       one row per moment of the story, top to bottom.
 *
 * A is the experiment's control, so it is not a new drawing of the graph: it is
 * the SHIPPING geometry, `layoutProof(...)`, adapted into `VariantLayout`. Every
 * bead, thread, bow, chapter gap and lane column below is produced by the exact
 * function the production proof band calls. Nothing here improves it — its
 * flaws are the measurement, and a "fixed" control would measure nothing.
 *
 * TWO THINGS ARE DELIBERATELY NOT INHERITED FROM THE GEOMETRY MODULE:
 *
 *   THE NODE SET is taken from `graph.receipts`, and the bead is looked up. If
 *   the geometry ever failed to place a canonical receipt this throws instead of
 *   returning 57 nodes, so §18's "never fewer" is enforced by construction and
 *   not by hoping the two modules agree.
 *
 *   THE EDGE SET is taken from `graph.edges`, and the thread's path is looked
 *   up. `parent`, `child`, `kind` and `crossLane` therefore come from the
 *   canonical layer; `layoutProof` contributes only the ROUTE a declared edge
 *   takes. A thread the geometry drew with no canonical edge behind it could not
 *   survive this adaptation, and a canonical edge the geometry failed to draw
 *   throws rather than disappearing.
 *
 * The reading ordinal is not read anywhere in this file. The vertical axis is
 * the reading ORDER — the evidence-time / admission-order sequence `layoutProof`
 * derives from the receipts themselves — which is the thing the ordinal is a
 * label for, not the label.
 */

/**
 * What `layoutProof` needs of a receipt. The canonical receipt already carries
 * all of it; only the lane's name differs (`lane` here, `branch` in the public
 * model), so the adaptation is a rename and nothing is re-derived.
 */
type ProofEvidence = Readonly<{
  evidenceId: string;
  branch: ProvenanceLane;
  causalParents: readonly string[];
  observedInputs: readonly string[];
  standing: EvidenceStanding;
  timeMs: number;
  admissionIndex: number;
  episode: EvidenceEpisode;
}>;

const proofEvidenceOf = (receipt: CanonicalReceipt): ProofEvidence => ({
  evidenceId: receipt.evidenceId,
  branch: receipt.lane,
  causalParents: receipt.causalParents,
  observedInputs: receipt.observedInputs,
  standing: receipt.standing,
  timeMs: receipt.timeMs,
  admissionIndex: receipt.admissionIndex,
  episode: receipt.episode,
});

/** One rounding, used for every coordinate, so an endpoint and its bead agree exactly. */
const px = (value: number) => Number(value.toFixed(3));

/**
 * `layoutProof` works in FIELD coordinates: its y = 0 is the top of the scrolling
 * field, which the production band places below the provenance header row. The
 * variant harness is handed one flat canvas, so the field is lowered by the
 * header's height — a translation, not a rescale, so no distance between two
 * receipts changes.
 *
 * The path forms `layoutProof` emits are `M x y C x y, x y, x y` and
 * `M x y L x y`; in both, the numbers alternate x, y with no exceptions, so
 * translating every odd-indexed number is exact. The same `px` rounding is
 * applied here and to the beads, so a thread's first and last pair are bit-equal
 * to the two nodes it joins.
 */
function lowerIntoBand(d: string): string {
  let index = 0;
  return d.replace(/-?\d+(?:\.\d+)?/g, (value) => {
    const moved = index % 2 === 0 ? px(Number(value)) : px(Number(value) + LABEL_PX);
    index += 1;
    return String(moved);
  });
}

/** Rank correlation, for the one diagnostic that asks what A's y axis happens to encode. */
function spearman(left: readonly number[], right: readonly number[]): number {
  const ranked = (values: readonly number[]) => {
    const order = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
    const ranks = new Array<number>(values.length).fill(0);
    let i = 0;
    while (i < order.length) {
      let j = i;
      while (j + 1 < order.length && order[j + 1]!.value === order[i]!.value) j += 1;
      const shared = (i + j) / 2 + 1;
      for (let k = i; k <= j; k += 1) ranks[order[k]!.index] = shared;
      i = j + 1;
    }
    return ranks;
  };
  const a = ranked(left);
  const b = ranked(right);
  if (a.length < 2) return 0;
  const mean = (values: readonly number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const ma = mean(a);
  const mb = mean(b);
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < a.length; i += 1) {
    const va = a[i]! - ma;
    const vb = b[i]! - mb;
    num += va * vb;
    da += va * va;
    db += vb * vb;
  }
  return da === 0 || db === 0 ? 0 : num / Math.sqrt(da * db);
}

export const buildVariantA: VariantBuilder = ({ graph, width, height }): VariantLayout => {
  const items = graph.receipts.map(proofEvidenceOf);
  const layout = layoutProof({
    items,
    branches: graph.lanes,
    finalReceipt: true,
    widthPx: width,
    heightPx: height,
  });

  const beadOf = new Map(layout.beads.map((bead) => [bead.evidenceId, bead] as const));
  const nodes: VariantNode[] = graph.receipts.map((receipt) => {
    const bead = beadOf.get(receipt.evidenceId);
    if (bead === undefined) throw new Error(`variant A: canonical receipt ${receipt.evidenceId} was not placed by layoutProof`);
    return Object.freeze({ evidenceId: receipt.evidenceId, x: px(bead.x), y: px(bead.y + LABEL_PX), lane: receipt.lane });
  });

  const positionOf = new Map(nodes.map((node) => [node.evidenceId, { x: node.x, y: node.y }] as const));
  const routeOf = new Map(layout.threads.map((thread) => [`${thread.parent}->${thread.child}`, thread.d] as const));
  const edges: VariantEdge[] = graph.edges.map((edge) => {
    const from = positionOf.get(edge.parent);
    const to = positionOf.get(edge.child);
    const route = routeOf.get(`${edge.parent}->${edge.child}`);
    if (from === undefined || to === undefined || route === undefined) {
      throw new Error(`variant A: canonical edge ${edge.parent}->${edge.child} has no drawn thread`);
    }
    return Object.freeze({ parent: edge.parent, child: edge.child, kind: edge.kind, crossLane: edge.crossLane, d: lowerIntoBand(route), from, to });
  });

  // Everything below is non-evidentiary: a lane column, a lane name, the reading
  // rail and the chapter rules. None of it asserts a relation, which is why none
  // of it is in `edges` (§5).
  const fieldTop = LABEL_PX;
  const fieldHeight = Math.max(0, height - LABEL_PX - LEGEND_PX);
  const guideHeight = Math.max(fieldHeight, layout.contentHeight);
  const ornaments: VariantOrnament[] = [
    ...graph.lanes.flatMap((lane, column): VariantOrnament[] => {
      const x = layout.gutter + column * layout.laneWidth;
      return [
        Object.freeze({ kind: "laneGuide" as const, lane, x: px(x), y: fieldTop, width: px(layout.laneWidth), height: px(guideHeight) }),
        Object.freeze({ kind: "laneLabel" as const, lane, label: lane, x: px(x + layout.laneWidth / 2), y: px(LABEL_PX / 2) }),
      ];
    }),
    // Below the field, not above it: the lane labels already own the header
    // strip at y = LABEL_PX / 2, and an axis label sharing that line overprinted
    // the ROUTE lane's own name. A collision in the bench's chrome would have
    // cost A marks on label readability that belong to the bench, not to A.
    Object.freeze({ kind: "axisLabel" as const, label: "Provenance lane", x: px(layout.gutter + (width - layout.gutter) / 2), y: px(fieldTop + guideHeight + 13) }),
    Object.freeze({ kind: "axisLabel" as const, label: "Reading order", x: RAIL_X_PX, y: px(fieldTop + guideHeight / 2) }),
  ];
  if (layout.rail !== null) {
    ornaments.push(Object.freeze({
      kind: "gridline" as const,
      label: "Reading rail",
      d: `M ${px(layout.rail.x)} ${px(layout.rail.top + LABEL_PX)} V ${px(layout.rail.bottom + LABEL_PX)}`,
    }));
  }
  // A chapter rule marks where the story moves to the next episode. It is a
  // reading aid across the whole band, never a link between two receipts.
  for (const chapter of layout.chapters.slice(1)) {
    ornaments.push(Object.freeze({
      kind: "gridline" as const,
      label: chapter.episode,
      d: `M ${px(layout.gutter)} ${px(chapter.top + layout.episodeGap / 2 + LABEL_PX)} H ${px(width)}`,
    }));
  }

  const overflowPx = Math.max(0, layout.contentHeight - fieldHeight);

  // WHAT A's VERTICAL AXIS ACTUALLY ENCODES, measured rather than assumed. The
  // axis is the reading order; whether that happens to track causal depth is a
  // property of this mission's timeline, not something the picture asserts, so
  // the correlation is reported as a number and read as one.
  const metrics = graphMetrics(graph);
  const depthRho = spearman(
    graph.receipts.map((receipt) => positionOf.get(receipt.evidenceId)!.y),
    graph.receipts.map((receipt) => metrics.depth.get(receipt.evidenceId) ?? 0),
  );
  // The read A invites but never states: two beads one pitch apart in one column
  // look like a step in a chain. How often is there no relation at all?
  const related = new Set(graph.edges.flatMap((edge) => [`${edge.parent}|${edge.child}`, `${edge.child}|${edge.parent}`]));
  let adjacentPairs = 0;
  let adjacentUnrelated = 0;
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const left = nodes[i]!;
      const right = nodes[j]!;
      if (left.x !== right.x || Math.abs(left.y - right.y) > layout.pitch + 0.001) continue;
      adjacentPairs += 1;
      if (!related.has(`${left.evidenceId}|${right.evidenceId}`)) adjacentUnrelated += 1;
    }
  }

  return Object.freeze({
    id: "A",
    title: "Provenance lanes by reading order",
    axes: Object.freeze({ x: "Provenance lane", y: "Reading order" }),
    width,
    // A DECLARES THE HEIGHT IT ACTUALLY DRAWS INTO, not the one it was asked
    // for. At a review band its content is taller than the field and production
    // reaches the rest by scrolling; returning the requested height would put
    // 16 of the 58 receipts outside the box the layout claims to occupy, and
    // every downstream measurement would then silently compare a clipped
    // picture against whole ones. The shortfall is not hidden — it is reported
    // as `requestedHeightPx` and `overflowPx`, and it is one of A's findings.
    height: Math.max(height, LABEL_PX + layout.contentHeight + LEGEND_PX),
    nodes: Object.freeze(nodes),
    edges: Object.freeze(edges),
    ornaments: Object.freeze(ornaments),
    diagnostics: Object.freeze({
      method: "app/nx/evidence/proofGeometry.ts layoutProof — the shipping geometry, unmodified",
      columns: layout.columns,
      laneWidth: px(layout.laneWidth),
      gutterPx: layout.gutter,
      pitchPx: layout.pitch,
      beadPx: layout.bead,
      episodeGapPx: layout.episodeGap,
      rows: layout.rows,
      journalRows: layout.journalRows,
      rowCount: layout.rows + layout.journalRows,
      chapters: layout.chapters.length,
      fit: layout.fit,
      /** What the harness asked for, against what A needs to show 58 receipts. */
      requestedHeightPx: height,
      declaredHeightPx: Math.max(height, LABEL_PX + layout.contentHeight + LEGEND_PX),
      fieldHeightPx: fieldHeight,
      contentHeightPx: layout.contentHeight,
      /** How far the drawing runs past the field; in production this is scrolled to. */
      overflowPx,
      headerPx: LABEL_PX,
      legendPx: LEGEND_PX,
      crossLaneThreads: layout.threads.filter((thread) => thread.crossLane).length,
      sameLaneThreads: layout.threads.filter((thread) => !thread.crossLane).length,
      finalReceiptAnchors: layout.anchors.length,
      /** Spearman of the drawn y against causal depth — what the axis happens to track here. */
      readingOrderVsCausalDepthRho: Number(depthRho.toFixed(3)),
      maxCausalDepth: Math.max(...[...metrics.depth.values()]),
      maxInDegree: Math.max(...[...metrics.inDegree.values()]),
      verticallyAdjacentSameLanePairs: adjacentPairs,
      verticallyAdjacentSameLanePairsWithNoRelation: adjacentUnrelated,
    }),
    caveats: Object.freeze([
      "The vertical axis is the reading order — evidence time, then the engine's admission order — and NOT causal depth. A long vertical drop is elapsed story, not a long chain.",
      `The two are easy to confuse here, because in this mission they nearly agree: the drawn y correlates with causal depth at rho ${depthRho.toFixed(3)}. That agreement is a property of this timeline, not something A asserts, and A gives a viewer no way to tell the difference or to see where it breaks.`,
      "Where it does break, it breaks silently. NR 18 (depth 9) is drawn above NR 20 (depth 5) in the vehicle column although NR 20 is four levels shallower, and NR 29 (depth 13) sits one row directly above NR 30 (depth 11) in that same column. Nothing on screen marks either inversion.",
      `Vertical adjacency inside one lane reads as a step in a chain even when there is no relation: ${adjacentPairs} pairs of receipts are drawn one pitch apart in the same column, and ${adjacentUnrelated} of them declare no relation in either direction.`,
      `Convergence is where A is weakest. NR 52 gathers ${Math.max(...[...metrics.inDegree.values()])} declared parents from two lanes into one ${layout.bead}px bead on a ${layout.pitch}px pitch; the fan-in arrives as a bundle of curves, and the viewer cannot count its threads or say which lane each came from.`,
      "Lane order is canonical, not adjacency. Neighbouring columns are not more related than distant ones, so a cross-lane thread's length carries no meaning — a long sweep and a short one say the same thing.",
      "The bow on a same-lane thread is a legibility device with no meaning. Its width is the relation's rank among its siblings, chosen so a fan is readable; a viewer must not read it as a magnitude, a delay or a confidence.",
      `Structure inside a lane is cramped and structure between lanes is loud: ${layout.threads.filter((thread) => thread.crossLane).length} of ${layout.threads.length} relations cross a boundary and get the full width of the band, while the other ${layout.threads.filter((thread) => !thread.crossLane).length} are compressed into a ${Math.round(layout.laneWidth)}px column shared with that lane's own beads.`,
      layout.fit === "fit"
        ? `The whole story fits the band at the readability floors (content ${layout.contentHeight}px into a ${fieldHeight}px field).`
        : `The story does not fit the band at the readability floors: content is ${layout.contentHeight}px in a ${fieldHeight}px field, so ${overflowPx}px lie below the fold and production reaches them by scrolling. A viewer never sees all 58 receipts at once, and any thread spanning the fold is never seen whole.`,
    ]),
  });
};

import type { CanonicalGraph } from "./canonicalGraph.ts";
import type { VariantLayout } from "./variantTypes.ts";

/**
 * D-006/NX GATE 2 — OBJECTIVE MEASUREMENT OF A REPRESENTATION.
 *
 * The mandate asks for a 20-criterion comparison. Several of those criteria are
 * matters of judgement and stay that way — but several are not, and where a
 * number can be measured it should be, so the comparison rests on something
 * more durable than whichever picture happened to look nicer.
 *
 * Everything here is generic over `VariantLayout`, so A, B, C and D are
 * measured by exactly the same instrument. That is the point: a comparison in
 * which each variant is scored by its own favourable metric is not a
 * comparison.
 *
 * ONE MEASUREMENT DESERVES SPECIAL NOTE. `beadsTouchedByUnrelatedThread`
 * counts receipts that a thread passes through although the receipt is not one
 * of that thread's two ends. This is the defect class Gate 1 spent its effort
 * on: a filament that appears to touch a receipt it has no relation with is a
 * false causal claim made by geometry alone. Any variant that scores high here
 * is lying to the viewer, however pretty it is.
 */

export type VariantMetrics = Readonly<{
  variant: string;
  nodes: number;
  edges: number;
  /** Pairs of threads whose bodies actually intersect, excluding shared ends. */
  edgeCrossings: number;
  /** Crossings per edge — comparable across variants with different edge counts. */
  crossingsPerEdge: number;
  meanEdgeLengthPx: number;
  maxEdgeLengthPx: number;
  totalInkPx: number;
  /** Receipt pairs closer together than one bead — beads that visually merge. */
  occludedNodePairs: number;
  closestNodePairPx: number;
  /** THE FALSE-CLAIM METRIC: receipts a thread crosses that it has no relation with. */
  beadsTouchedByUnrelatedThread: number;
  /**
   * A thread END landing on a bead it does not name. Worse than a mid-path
   * graze: a thread that appears to STOP at a receipt reads as a relation
   * arriving there, so each one asserts a directed pair the evidence never
   * declared. Found by the Gate 2 semantic review on the analytic embeddings.
   */
  threadEndsOnUnnamedReceipt: number;
  /** Distinct directed pairs those misplaced ends imply but nothing declares. */
  undeclaredPairsSuggested: number;
  /** How much of the viewport the drawing actually uses (0..1). */
  viewportUsage: number;
  /**
   * Spearman-style agreement between 2D distance and true graph hop distance,
   * over connected pairs. High = the picture's proximity tracks real structure;
   * low = proximity in this view means something else, or nothing.
   */
  proximityFaithfulness: number;
  /** Mean lane purity: for lane-based views, how cleanly lanes separate (0..1). */
  laneSeparation: number;
}>;

type Point = Readonly<{ x: number; y: number }>;

/** Sample any `M .. C ..` / `M .. L ..` path into a polyline. */
export function samplePath(d: string, count = 24): readonly Point[] {
  const n = (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  const points: Point[] = [];
  if (d.includes("C") && n.length >= 8) {
    const [x0, y0, x1, y1, x2, y2, x3, y3] = n as unknown as number[];
    for (let i = 0; i <= count; i += 1) {
      const t = i / count;
      const u = 1 - t;
      points.push({
        x: u * u * u * x0! + 3 * u * u * t * x1! + 3 * u * t * t * x2! + t * t * t * x3!,
        y: u * u * u * y0! + 3 * u * u * t * y1! + 3 * u * t * t * y2! + t * t * t * y3!,
      });
    }
    return points;
  }
  if (n.length >= 4) {
    const [x0, y0, x1, y1] = n as unknown as number[];
    for (let i = 0; i <= count; i += 1) {
      const t = i / count;
      points.push({ x: x0! + (x1! - x0!) * t, y: y0! + (y1! - y0!) * t });
    }
  }
  return points;
}

const segmentsIntersect = (a: Point, b: Point, c: Point, d: Point): boolean => {
  const cross = (p: Point, q: Point, r: Point) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
};

const pointToSegment = (p: Point, a: Point, b: Point): number => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len));
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
};

const polylineLength = (points: readonly Point[]) => points.reduce(
  (sum, point, index) => (index === 0 ? 0 : sum + Math.hypot(point.x - points[index - 1]!.x, point.y - points[index - 1]!.y)),
  0,
);

/** Rank-correlation between two parallel series (Spearman's rho). */
function spearman(left: readonly number[], right: readonly number[]): number {
  const rank = (values: readonly number[]) => {
    const order = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
    const ranks = new Array<number>(values.length);
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
  const a = rank(left);
  const b = rank(right);
  const n = a.length;
  if (n < 2) return 0;
  const meanA = a.reduce((s, x) => s + x, 0) / n;
  const meanB = b.reduce((s, x) => s + x, 0) / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i += 1) {
    const va = a[i]! - meanA;
    const vb = b[i]! - meanB;
    num += va * vb;
    da += va * va;
    db += vb * vb;
  }
  return da === 0 || db === 0 ? 0 : num / Math.sqrt(da * db);
}

/** Undirected hop distances, capped, for the proximity-faithfulness measure. */
function hopDistances(graph: CanonicalGraph): ReadonlyMap<string, ReadonlyMap<string, number>> {
  const neighbours = new Map<string, string[]>();
  for (const edge of graph.edges) {
    neighbours.set(edge.parent, [...(neighbours.get(edge.parent) ?? []), edge.child]);
    neighbours.set(edge.child, [...(neighbours.get(edge.child) ?? []), edge.parent]);
  }
  const all = new Map<string, ReadonlyMap<string, number>>();
  for (const entry of graph.receipts) {
    const seen = new Map<string, number>([[entry.evidenceId, 0]]);
    const queue = [entry.evidenceId];
    while (queue.length > 0) {
      const id = queue.shift()!;
      const here = seen.get(id)!;
      for (const next of neighbours.get(id) ?? []) {
        if (!seen.has(next)) { seen.set(next, here + 1); queue.push(next); }
      }
    }
    all.set(entry.evidenceId, seen);
  }
  return all;
}

const BEAD_PX = 9;

export function measureVariant(layout: VariantLayout, graph: CanonicalGraph, hops?: ReadonlyMap<string, ReadonlyMap<string, number>>): VariantMetrics {
  const sampled = layout.edges.map((edge) => ({ edge, points: samplePath(edge.d) }));

  let crossings = 0;
  for (let i = 0; i < sampled.length; i += 1) {
    for (let j = i + 1; j < sampled.length; j += 1) {
      const a = sampled[i]!;
      const b = sampled[j]!;
      // Threads that share a receipt meet there legitimately; only count a
      // crossing between threads that have no endpoint in common.
      if (a.edge.parent === b.edge.parent || a.edge.parent === b.edge.child
        || a.edge.child === b.edge.parent || a.edge.child === b.edge.child) continue;
      let crossed = false;
      for (let p = 0; p + 1 < a.points.length && !crossed; p += 1) {
        for (let q = 0; q + 1 < b.points.length && !crossed; q += 1) {
          if (segmentsIntersect(a.points[p]!, a.points[p + 1]!, b.points[q]!, b.points[q + 1]!)) crossed = true;
        }
      }
      if (crossed) crossings += 1;
    }
  }

  const lengths = sampled.map((entry) => polylineLength(entry.points));
  const totalInk = lengths.reduce((sum, length) => sum + length, 0);

  let occluded = 0;
  let closest = Infinity;
  for (let i = 0; i < layout.nodes.length; i += 1) {
    for (let j = i + 1; j < layout.nodes.length; j += 1) {
      const gap = Math.hypot(layout.nodes[i]!.x - layout.nodes[j]!.x, layout.nodes[i]!.y - layout.nodes[j]!.y);
      closest = Math.min(closest, gap);
      if (gap < BEAD_PX) occluded += 1;
    }
  }

  // The false-claim metric: a thread passing through a bead it has no relation with.
  let touched = 0;
  for (const { edge, points } of sampled) {
    for (const node of layout.nodes) {
      if (node.evidenceId === edge.parent || node.evidenceId === edge.child) continue;
      let near = false;
      for (let p = 0; p + 1 < points.length && !near; p += 1) {
        if (pointToSegment(node, points[p]!, points[p + 1]!) < BEAD_PX / 2) near = true;
      }
      if (near) touched += 1;
    }
  }

  // A thread END sitting on a bead it does not name. The declared pair is
  // read off the drawing, not the data: a viewer sees the line stop at that
  // bead and infers a relation to it.
  const declaredPairs = new Set(layout.edges.map((edge) => `${edge.parent}->${edge.child}`));
  const suggested = new Set<string>();
  let strayEnds = 0;
  for (const edge of layout.edges) {
    for (const [end, role] of [[edge.from, "tail"], [edge.to, "head"]] as const) {
      for (const node of layout.nodes) {
        if (node.evidenceId === edge.parent || node.evidenceId === edge.child) continue;
        if (Math.hypot(node.x - end.x, node.y - end.y) > BEAD_PX / 2) continue;
        strayEnds += 1;
        const pair = role === "head" ? `${edge.parent}->${node.evidenceId}` : `${node.evidenceId}->${edge.child}`;
        if (!declaredPairs.has(pair)) suggested.add(pair);
      }
    }
  }

  const xs = layout.nodes.map((node) => node.x);
  const ys = layout.nodes.map((node) => node.y);
  const spanX = Math.max(...xs) - Math.min(...xs);
  const spanY = Math.max(...ys) - Math.min(...ys);
  const viewportUsage = (spanX * spanY) / Math.max(1, layout.width * layout.height);

  const distances = hops ?? hopDistances(graph);
  const positionOf = new Map(layout.nodes.map((node) => [node.evidenceId, node] as const));
  const screenGaps: number[] = [];
  const graphGaps: number[] = [];
  for (const entry of graph.receipts) {
    const from = positionOf.get(entry.evidenceId);
    if (from === undefined) continue;
    for (const [otherId, hop] of distances.get(entry.evidenceId) ?? []) {
      if (otherId <= entry.evidenceId) continue;
      const to = positionOf.get(otherId);
      if (to === undefined) continue;
      screenGaps.push(Math.hypot(from.x - to.x, from.y - to.y));
      graphGaps.push(hop);
    }
  }

  // Lane separation: the share of receipts whose nearest neighbour shares its lane.
  let sameLaneNearest = 0;
  for (const node of layout.nodes) {
    let best: { id: string; lane: string; gap: number } | null = null;
    for (const other of layout.nodes) {
      if (other.evidenceId === node.evidenceId) continue;
      const gap = Math.hypot(node.x - other.x, node.y - other.y);
      if (best === null || gap < best.gap) best = { id: other.evidenceId, lane: other.lane, gap };
    }
    if (best !== null && best.lane === node.lane) sameLaneNearest += 1;
  }

  return Object.freeze({
    variant: layout.id,
    nodes: layout.nodes.length,
    edges: layout.edges.length,
    edgeCrossings: crossings,
    crossingsPerEdge: Number((crossings / Math.max(1, layout.edges.length)).toFixed(3)),
    meanEdgeLengthPx: Number((totalInk / Math.max(1, lengths.length)).toFixed(1)),
    maxEdgeLengthPx: Number(Math.max(...lengths, 0).toFixed(1)),
    totalInkPx: Number(totalInk.toFixed(0)),
    occludedNodePairs: occluded,
    closestNodePairPx: Number((closest === Infinity ? 0 : closest).toFixed(2)),
    beadsTouchedByUnrelatedThread: touched,
    threadEndsOnUnnamedReceipt: strayEnds,
    undeclaredPairsSuggested: suggested.size,
    viewportUsage: Number(viewportUsage.toFixed(3)),
    // Positive = receipts that are far apart in the graph are drawn far apart.
    proximityFaithfulness: Number(spearman(screenGaps, graphGaps).toFixed(3)),
    laneSeparation: Number((sameLaneNearest / Math.max(1, layout.nodes.length)).toFixed(3)),
  });
}

export { hopDistances };

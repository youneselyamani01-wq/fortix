import type { ProvenanceLane } from "../adapter/publicExperienceAdapter.ts";
import type { CanonicalGraph } from "./canonicalGraph.ts";
import { symmetricEigen } from "./linalg.ts";
import type { VariantBuilder, VariantEdge, VariantId, VariantLayout, VariantNode, VariantOrnament } from "./variantTypes.ts";

/**
 * D-006/NX GATE 2 — VARIANTS D1 (SPECTRAL EMBEDDING) AND D2 (DIFFUSION MAP).
 *
 * Both variants place the 58 receipts by an eigendecomposition of a matrix built
 * from the 79 declared edges, and both then draw those same 79 edges over the
 * result. They share every input; they differ only in the OPERATOR:
 *
 *   D1   the normalised Laplacian  L_sym = I − D^(−1/2) W D^(−1/2)
 *   D2   the diffusion operator    P = D^(−1) K,  K_ij = exp(−d_ij² / ε)
 *
 * Keeping the input identical is the point. A comparison in which D1 reads the
 * adjacency and D2 reads a feature table cannot tell you whether the difference
 * you see comes from the method or from the data; here it can only come from the
 * method.
 *
 * THE SEMANTIC RULE, stated here and repeated in `caveats` because it is the one
 * thing a viewer can most easily get wrong:
 *
 *   A DIFFUSION DISTANCE IS NOT A CAUSAL DISTANCE, AND SPECTRAL PROXIMITY IS NOT
 *   A CAUSAL RELATION. "Diffusion" names the behaviour of a Markov matrix. It is
 *   not a claim that anything propagated between two receipts. Two receipts that
 *   land on the same pixel are eigen-indistinguishable, not related.
 *
 * The only causal claims either variant makes are its 79 edges, each of which
 * carries the canonical `parent`, `child` and `kind` it was built from. No line
 * is drawn because two points ended up near each other, and no line is withheld
 * because it made the picture worse.
 *
 * THE FINDING THAT SHAPED BOTH BUILDERS. The symmetrised canonical edge set is
 * NOT CONNECTED. It falls into 45 receipts and 13, with no undirected path
 * between the two. Consequences that had to be handled rather than hidden:
 *
 *   · the Laplacian's null space is two-dimensional, not one, so "discard the
 *     one trivial eigenvector" would have discarded half the null space and
 *     kept a component indicator as a coordinate;
 *   · every non-trivial GLOBAL eigenvector is supported on one component only
 *     (measured mass 1.000 / 0.000), so a single global embedding stacks all 13
 *     receipts of the smaller component on one point;
 *   · the diffusion kernel is block-diagonal for the same reason, and its
 *     leading eigenvalue 1 has multiplicity 2.
 *
 * Each component is therefore embedded on its own operator, and the two blocks
 * are placed side by side under ONE shared scale. That adds no edge and removes
 * none; it is the standard treatment of a disconnected graph, and the global
 * spectrum that forced it is reported in `diagnostics`.
 *
 * The reading ordinal is used for one thing only: naming receipts in `caveats`
 * so a human can find them. It is never a coordinate and never an edge.
 */

type Point = Readonly<{ x: number; y: number }>;

const PADDING = Object.freeze({ left: 52, right: 52, top: 56, bottom: 48 });

/** Blank corridor between disconnected blocks, as a fraction of mean block width. */
const BLOCK_GAP_FRACTION = 0.22;

/**
 * Diffusion time. t = 1 is one step of the Markov chain: the coordinates are
 * then the leading non-trivial eigenvectors weighted by their own eigenvalues,
 * so the relative weight of the two axes IS the spectral gap and nothing has
 * been chosen to flatter the picture. Larger t only compresses the second axis
 * further; it reveals nothing the spectrum does not already state.
 */
const DIFFUSION_TIME = 1;

/**
 * Eigenvalues below this are the null space. The Jacobi solver lands exact
 * zeros around 1e-14 and the smallest true eigenvalue here is 3.4e-3, so the
 * threshold sits six orders of magnitude clear of both.
 */
const NULL_TOLERANCE = 1e-8;

/**
 * Edges are STRAIGHT CHORDS. A consistently-handed bow was tried first, on the
 * theory that curving a thread lifts it off the beads it would otherwise pass
 * over, and the measurement refused it: sweeping the bow from 0 to 0.20 of the
 * chord took D1 from 27 edge crossings to 65 and D2 from 17 to 42, while the
 * count of receipts touched by an unrelated thread barely moved (D1 87 → 81,
 * D2 166 → 166). Paying twenty-odd crossings for nothing is a bad trade, and a
 * straight line is also the shortest and least ambiguous claim a thread can
 * make. Recorded here so the curve is not reintroduced on taste.
 */

/** Hull inflation, so a lane outline clears the beads it encloses. */
const HULL_PADDING_PX = 9;

/** The harness's bead diameter. Two receipts closer than this visually merge. */
const BEAD_PX = 9;

const round2 = (value: number) => Math.round(value * 100) / 100;

const mean = (values: readonly number[]) => (values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length);

const median = (values: readonly number[]) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
};

const rowSums = (matrix: readonly (readonly number[])[]) => matrix.map((row) => row.reduce((sum, value) => sum + value, 0));

/** Eigenpairs smallest-first. `symmetricEigen` returns them largest-first. */
const ascending = (input: readonly (readonly number[])[]) => {
  const eigen = symmetricEigen(input);
  return { values: [...eigen.values].reverse(), vectors: [...eigen.vectors].reverse() };
};

// ─── the symmetrised graph ──────────────────────────────────────────────────

type Symmetrised = Readonly<{
  ids: readonly string[];
  weights: readonly (readonly number[])[];
  degrees: readonly number[];
  /** Pairs declared in both directions — they would be the only reason the
   *  choice of symmetrisation could change the answer. */
  reciprocalPairs: number;
  isolated: number;
}>;

/**
 * W = (A + Aᵀ)/2 over the canonical edge set, every declared relation weighted 1.
 *
 * WHY THIS SYMMETRISATION. A Laplacian needs a symmetric matrix and the declared
 * graph is directed, so something has to give; the honest options are the
 * average, the union (A OR Aᵀ) and the two one-sided reads. The average is
 * chosen because it is the only one that never invents a relation and never
 * silently doubles one: a pair declared in both directions would keep weight 1
 * rather than becoming 2. As it happens the canonical set has ZERO reciprocal
 * pairs (asserted below and reported), which makes the average exactly half the
 * union — and L_sym is invariant to a uniform rescale of W, so on THIS graph the
 * average and the union give identical coordinates. The choice is documented
 * anyway, because it would matter on a graph with a mutual pair and a reader
 * should not have to rediscover that it does not matter here.
 *
 * What is lost is direction. Both variants are therefore blind to which end of
 * an edge is the parent; that survives only in the drawn edges. Stated in caveats.
 */
function symmetrise(graph: CanonicalGraph): Symmetrised {
  const ids = graph.receipts.map((entry) => entry.evidenceId);
  const n = ids.length;
  const indexOf = new Map(ids.map((id, index) => [id, index] as const));
  const directed = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (const edge of graph.edges) {
    const parent = indexOf.get(edge.parent);
    const child = indexOf.get(edge.child);
    if (parent === undefined || child === undefined) continue;
    directed[parent]![child] = 1;
  }

  let reciprocalPairs = 0;
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) if (directed[i]![j]! > 0 && directed[j]![i]! > 0) reciprocalPairs += 1;
  }

  const weights = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (directed[i]![j]! + directed[j]![i]!) / 2));
  const degrees = rowSums(weights);
  return Object.freeze({ ids, weights, degrees, reciprocalPairs, isolated: degrees.filter((degree) => degree === 0).length });
}

/**
 * Pairs of receipts with IDENTICAL closed neighbourhoods in the symmetrised
 * graph. Exchanging such a pair is an automorphism of W, so it is an
 * automorphism of every matrix either variant builds from W, and NO eigenvector
 * can separate them: they are guaranteed to be drawn on the same point.
 *
 * This is measured rather than assumed because it is the difference between two
 * very different statements a viewer might make about a collision — "the
 * evidence makes these two structurally interchangeable" and "this method could
 * not resolve them at this scale" — and only the first is a fact about the
 * receipts.
 */
function structuralTwins(weights: readonly (readonly number[])[]): readonly (readonly [number, number])[] {
  const n = weights.length;
  const pairs: (readonly [number, number])[] = [];
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      let identical = true;
      for (let k = 0; k < n && identical; k += 1) {
        if (k === i || k === j) continue;
        if (weights[i]![k]! !== weights[j]![k]!) identical = false;
      }
      if (identical) pairs.push([i, j] as const);
    }
  }
  return pairs;
}

/** Connected components of the symmetrised graph, in first-appearance order. */
function componentsOf(weights: readonly (readonly number[])[]): readonly (readonly number[])[] {
  const n = weights.length;
  const label = new Array<number>(n).fill(-1);
  const groups: number[][] = [];
  for (let seed = 0; seed < n; seed += 1) {
    if (label[seed] !== -1) continue;
    const group: number[] = [];
    const queue = [seed];
    label[seed] = groups.length;
    while (queue.length > 0) {
      const at = queue.shift()!;
      group.push(at);
      for (let next = 0; next < n; next += 1) {
        if (label[next] === -1 && weights[at]![next]! > 0) { label[next] = groups.length; queue.push(next); }
      }
    }
    groups.push(group.sort((left, right) => left - right));
  }
  return groups;
}

const submatrix = (weights: readonly (readonly number[])[], members: readonly number[]) => (
  members.map((i) => members.map((j) => weights[i]![j]!))
);

/**
 * L_sym = I − D^(−1/2) W D^(−1/2). An isolated receipt (degree 0) would divide
 * by zero, so its row is left entirely at zero — which makes it its own
 * eigenvalue-0 component and lets the component count catch it, rather than
 * producing a NaN that quietly poisons the whole spectrum.
 */
function normalisedLaplacian(weights: readonly (readonly number[])[]): readonly (readonly number[])[] {
  const degrees = rowSums(weights);
  const inverseRoot = degrees.map((degree) => (degree > 0 ? 1 / Math.sqrt(degree) : 0));
  return weights.map((row, i) => row.map((value, j) => (
    (i === j && degrees[i]! > 0 ? 1 : 0) - value * inverseRoot[i]! * inverseRoot[j]!
  )));
}

/** Undirected hop distances inside one block. Every entry is finite by construction. */
function hopMatrix(weights: readonly (readonly number[])[]): readonly (readonly number[])[] {
  const m = weights.length;
  const neighbours = Array.from({ length: m }, (_, i) => (
    Array.from({ length: m }, (_, j) => j).filter((j) => j !== i && weights[i]![j]! > 0)
  ));
  return Array.from({ length: m }, (_, source) => {
    const distance = new Array<number>(m).fill(Number.POSITIVE_INFINITY);
    distance[source] = 0;
    const queue = [source];
    while (queue.length > 0) {
      const at = queue.shift()!;
      for (const next of neighbours[at]!) {
        if (distance[next] === Number.POSITIVE_INFINITY) { distance[next] = distance[at]! + 1; queue.push(next); }
      }
    }
    return distance;
  });
}

// ─── blocks: one embedded component ─────────────────────────────────────────

type Block = Readonly<{
  members: readonly number[];
  /** Method coordinates, parallel to `members`. */
  coords: readonly Point[];
  /** The method's own zero, so its sign split can be drawn as a reference line. */
  origin: Point;
  label: string;
  /** Spectrum of this block's operator, for the technical note. */
  values: readonly number[];
  /** Extra numbers the block's method wants reported. */
  detail: Readonly<Record<string, number>>;
}>;

const constantVector = (m: number) => new Array<number>(m).fill(0);

/**
 * D1's block: the two lowest non-trivial eigenvectors of the block's L_sym.
 *
 * The null space is measured, not assumed to be one-dimensional — the whole
 * reason this function operates on a block is that the global null space was
 * two-dimensional, and a builder that assumed once will assume again.
 */
function spectralBlock(weights: readonly (readonly number[])[]): Readonly<{ coords: readonly Point[]; values: readonly number[]; trivial: number }> {
  const m = weights.length;
  const { values, vectors } = ascending(normalisedLaplacian(weights));
  const trivial = values.filter((value) => Math.abs(value) < NULL_TOLERANCE).length;
  const first = vectors[trivial] ?? constantVector(m);
  const second = vectors[trivial + 1] ?? constantVector(m);
  return {
    coords: first.map((x, i) => ({ x, y: second[i]! })),
    values,
    trivial,
  };
}

/**
 * D2's block: diffusion coordinates λ_k^t ψ_k, k = 1, 2.
 *
 * P = D^(−1) K is not symmetric, so it is not fed to the Jacobi solver. It is
 * similar to S = D^(1/2) P D^(−1/2) = D^(−1/2) K D^(−1/2), which is; S is
 * decomposed and the eigenvectors are carried back with ψ = D^(−1/2) v. The
 * eigenvalues are the same either way — similarity preserves them — so the
 * spectrum reported here is P's spectrum.
 */
function diffusionBlock(hops: readonly (readonly number[])[], epsilon: number): Readonly<{
  coords: readonly Point[]; values: readonly number[]; kernelMeanOffDiagonal: number;
}> {
  const m = hops.length;
  const kernel = hops.map((row) => row.map((distance) => (Number.isFinite(distance) ? Math.exp(-(distance * distance) / epsilon) : 0)));
  const degrees = rowSums(kernel);
  const inverseRoot = degrees.map((degree) => (degree > 0 ? 1 / Math.sqrt(degree) : 0));
  const similar = kernel.map((row, i) => row.map((value, j) => value * inverseRoot[i]! * inverseRoot[j]!));
  const eigen = symmetricEigen(similar);

  const psi = (rank: number) => (eigen.vectors[rank] ?? constantVector(m)).map((value, i) => value * inverseRoot[i]!);
  const first = psi(1);
  const second = psi(2);
  const lambda1 = eigen.values[1] ?? 0;
  const lambda2 = eigen.values[2] ?? 0;
  const weight1 = lambda1 ** DIFFUSION_TIME;
  const weight2 = lambda2 ** DIFFUSION_TIME;

  let offDiagonal = 0;
  for (let i = 0; i < m; i += 1) for (let j = 0; j < m; j += 1) if (i !== j) offDiagonal += kernel[i]![j]!;

  return {
    coords: first.map((x, i) => ({ x: weight1 * x, y: weight2 * second[i]! })),
    values: eigen.values,
    kernelMeanOffDiagonal: m < 2 ? 0 : offDiagonal / (m * (m - 1)),
  };
}

// ─── placement ──────────────────────────────────────────────────────────────

type PlacedBlock = Readonly<{
  block: Block;
  /** Screen positions, parallel to `block.members`. */
  points: readonly Point[];
  /** Screen position of the method's zero — the sign split of both coordinates. */
  zero: Point;
  frame: Readonly<{ x: number; y: number; width: number; height: number }>;
  /** RMS radius of the raw coordinates, before the display normalisation. */
  rawRadius: number;
}>;

/**
 * Lay the blocks out left to right under ONE uniform scale, so aspect ratio is
 * preserved everywhere and a length means the same thing in both blocks.
 *
 * Each block is first normalised isotropically to unit RMS radius. This is
 * necessary and it is display-only: eigenvectors are unit-norm over their OWN
 * membership, so a 13-receipt component's entries are systematically √(45/13) ≈
 * 1.9× larger than a 45-receipt component's for no reason connected to the
 * evidence. Scaling a block isotropically changes how big it is drawn and
 * nothing about the shape inside it. The raw radii are reported.
 */
function placeBlocks(blocks: readonly Block[], width: number, height: number): Readonly<{
  placed: readonly PlacedBlock[]; scale: number; gapPx: number;
}> {
  const normalised = blocks.map((block) => {
    const centre = { x: mean(block.coords.map((point) => point.x)), y: mean(block.coords.map((point) => point.y)) };
    const radius = Math.sqrt(mean(block.coords.map((point) => (point.x - centre.x) ** 2 + (point.y - centre.y) ** 2)));
    const divisor = radius > 0 ? radius : 1;
    const points = block.coords.map((point) => ({ x: (point.x - centre.x) / divisor, y: (point.y - centre.y) / divisor }));
    const zero = { x: (block.origin.x - centre.x) / divisor, y: (block.origin.y - centre.y) / divisor };
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    const box = {
      minX: Math.min(...xs, zero.x), maxX: Math.max(...xs, zero.x),
      minY: Math.min(...ys, zero.y), maxY: Math.max(...ys, zero.y),
    };
    return { block, points, zero, box, rawRadius: radius };
  });

  const widths = normalised.map((entry) => entry.box.maxX - entry.box.minX);
  const heights = normalised.map((entry) => entry.box.maxY - entry.box.minY);
  const gapUnits = BLOCK_GAP_FRACTION * Math.max(mean(widths), 1e-6);
  const totalWidth = widths.reduce((sum, value) => sum + value, 0) + gapUnits * Math.max(0, normalised.length - 1);
  const totalHeight = Math.max(...heights, 1e-6);

  const availableWidth = Math.max(1, width - PADDING.left - PADDING.right);
  const availableHeight = Math.max(1, height - PADDING.top - PADDING.bottom);
  const raw = Math.min(availableWidth / Math.max(totalWidth, 1e-6), availableHeight / Math.max(totalHeight, 1e-6));
  const scale = Number.isFinite(raw) && raw > 0 ? raw : 1;

  const originX = PADDING.left + (availableWidth - totalWidth * scale) / 2;
  let cursor = 0;
  const placed: PlacedBlock[] = [];
  for (let index = 0; index < normalised.length; index += 1) {
    const entry = normalised[index]!;
    const left = originX + cursor * scale;
    const top = PADDING.top + (availableHeight - heights[index]! * scale) / 2;
    // Screen y grows downward; flip so a larger coordinate is drawn higher, the
    // way a reader expects a plotted axis to run.
    const toScreen = (point: Point): Point => ({
      x: round2(left + (point.x - entry.box.minX) * scale),
      y: round2(top + (entry.box.maxY - point.y) * scale),
    });
    placed.push(Object.freeze({
      block: entry.block,
      points: entry.points.map(toScreen),
      zero: toScreen(entry.zero),
      frame: Object.freeze({ x: round2(left), y: round2(top), width: round2(widths[index]! * scale), height: round2(heights[index]! * scale) }),
      rawRadius: entry.rawRadius,
    }));
    cursor += widths[index]! + gapUnits;
  }

  return Object.freeze({ placed, scale, gapPx: gapUnits * scale });
}

// ─── drawing ────────────────────────────────────────────────────────────────

const edgePath = (from: Point, to: Point) => `M ${from.x} ${from.y} L ${to.x} ${to.y}`;

/** Distance from a bead centre to a drawn chord, endpoints included. */
const distanceToSegment = (point: Point, from: Point, to: Point) => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (from.x + t * dx), point.y - (from.y + t * dy));
};

const segmentsIntersect = (a: Point, b: Point, c: Point, d: Point) => {
  const cross = (p: Point, q: Point, r: Point) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
};

/** Threads that cross without sharing a receipt — reported, not designed away. */
function countCrossings(edges: readonly VariantEdge[]): number {
  let crossings = 0;
  for (let i = 0; i < edges.length; i += 1) {
    for (let j = i + 1; j < edges.length; j += 1) {
      const a = edges[i]!;
      const b = edges[j]!;
      // Threads sharing a receipt meet there legitimately; only a crossing
      // between threads with no endpoint in common is a crossing.
      if (a.parent === b.parent || a.parent === b.child || a.child === b.parent || a.child === b.child) continue;
      if (segmentsIntersect(a.from, a.to, b.from, b.to)) crossings += 1;
    }
  }
  return crossings;
}

/** Monotone-chain hull, used only for lane outlines — never for a relation. */
function convexHull(points: readonly Point[]): readonly Point[] {
  const sorted = [...points].sort((left, right) => left.x - right.x || left.y - right.y);
  if (sorted.length < 3) return sorted;
  const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const build = (sequence: readonly Point[]) => {
    const chain: Point[] = [];
    for (const point of sequence) {
      while (chain.length >= 2 && cross(chain[chain.length - 2]!, chain[chain.length - 1]!, point) <= 0) chain.pop();
      chain.push(point);
    }
    chain.pop();
    return chain;
  };
  return [...build(sorted), ...build([...sorted].reverse())];
}

function hullPath(points: readonly Point[]): string | null {
  const hull = convexHull(points);
  if (hull.length < 3) return null;
  const centre = { x: mean(hull.map((point) => point.x)), y: mean(hull.map((point) => point.y)) };
  const inflated = hull.map((point) => {
    const dx = point.x - centre.x;
    const dy = point.y - centre.y;
    const length = Math.hypot(dx, dy);
    if (length < 1e-6) return point;
    return { x: round2(point.x + (dx / length) * HULL_PADDING_PX), y: round2(point.y + (dy / length) * HULL_PADDING_PX) };
  });
  return `M ${inflated.map((point) => `${point.x} ${point.y}`).join(" L ")} Z`;
}

// ─── assembly ───────────────────────────────────────────────────────────────

/**
 * Turn placed blocks into the layout. Shared by D1 and D2 on purpose: the two
 * variants must differ in the operator and in nothing else, and code they both
 * run is code that cannot drift apart between them.
 */
function assemble(input: Readonly<{
  id: VariantId;
  title: string;
  axes: Readonly<{ x: string; y: string }>;
  graph: CanonicalGraph;
  width: number;
  height: number;
  placement: ReturnType<typeof placeBlocks>;
  ids: readonly string[];
  /** Index pairs whose exchange is an automorphism of the symmetrised graph. */
  twins: readonly (readonly [number, number])[];
  diagnostics: Readonly<Record<string, number | string | readonly number[]>>;
  caveats: (facts: CollisionFacts) => readonly string[];
}>): VariantLayout {
  const receiptAt = new Map(input.graph.receipts.map((entry) => [entry.evidenceId, entry] as const));
  const position = new Map<string, Point>();
  for (const placed of input.placement.placed) {
    placed.block.members.forEach((member, index) => position.set(input.ids[member]!, placed.points[index]!));
  }

  const nodes: readonly VariantNode[] = input.graph.receipts.map((entry) => {
    const point = position.get(entry.evidenceId)!;
    return Object.freeze({ evidenceId: entry.evidenceId, x: point.x, y: point.y, lane: entry.lane });
  });

  // Every canonical edge, exactly once, endpoints taken from the node positions
  // so an edge cannot point anywhere a receipt is not.
  const edges: readonly VariantEdge[] = input.graph.edges.map((edge) => {
    const from = position.get(edge.parent)!;
    const to = position.get(edge.child)!;
    return Object.freeze({
      parent: edge.parent, child: edge.child, kind: edge.kind, crossLane: edge.crossLane,
      d: edgePath(from, to), from: Object.freeze({ ...from }), to: Object.freeze({ ...to }),
    });
  });

  const ornaments: VariantOrnament[] = [];
  for (const placed of input.placement.placed) {
    const { frame } = placed;
    ornaments.push(Object.freeze({
      kind: "axisLabel", x: round2(frame.x + frame.width / 2), y: round2(frame.y - 22), label: placed.block.label,
    }));
    // The sign split of each spectral coordinate. Informative, not evidentiary:
    // it separates the operator's two halves, it does not relate any two receipts.
    if (placed.zero.x >= frame.x && placed.zero.x <= frame.x + frame.width) {
      ornaments.push(Object.freeze({
        kind: "gridline", d: `M ${placed.zero.x} ${round2(frame.y - 6)} L ${placed.zero.x} ${round2(frame.y + frame.height + 6)}`, weight: 0.5,
      }));
    }
    if (placed.zero.y >= frame.y && placed.zero.y <= frame.y + frame.height) {
      ornaments.push(Object.freeze({
        kind: "gridline", d: `M ${round2(frame.x - 6)} ${placed.zero.y} L ${round2(frame.x + frame.width + 6)} ${placed.zero.y}`, weight: 0.5,
      }));
    }

    // Lane outlines are drawn PER BLOCK. A lane that appears in both blocks gets
    // two outlines: one hull spanning the corridor would suggest the two halves
    // of that lane are near each other, and they are not connected at all.
    const byLane = new Map<ProvenanceLane, Point[]>();
    placed.block.members.forEach((member, index) => {
      const lane = receiptAt.get(input.ids[member]!)!.lane;
      byLane.set(lane, [...(byLane.get(lane) ?? []), placed.points[index]!]);
    });
    for (const lane of input.graph.lanes) {
      const points = byLane.get(lane);
      if (points === undefined || points.length < 3) continue;
      const path = hullPath(points);
      if (path === null) continue;
      ornaments.push(Object.freeze({ kind: "hull", d: path, lane, weight: round2(points.length / placed.block.members.length) }));
      ornaments.push(Object.freeze({
        kind: "laneLabel", lane, label: lane,
        x: round2(mean(points.map((point) => point.x))), y: round2(mean(points.map((point) => point.y))),
      }));
    }
  }

  // What the delivered geometry actually does to the reader, measured from the
  // delivered geometry rather than argued from the method. Two thresholds: half
  // a pixel is "the same point", one bead diameter is "these overlap".
  const twinKeys = new Set(input.twins.map(([left, right]) => `${input.ids[left]!}|${input.ids[right]!}`));
  const nameOf = (id: string) => receiptAt.get(id)!.ordinal.label;
  const coincident: string[] = [];
  const crowded: string[] = [];
  const unresolvedTwins: string[] = [];
  let closest = Number.POSITIVE_INFINITY;
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const gap = Math.hypot(nodes[i]!.x - nodes[j]!.x, nodes[i]!.y - nodes[j]!.y);
      closest = Math.min(closest, gap);
      if (gap >= BEAD_PX) continue;
      const pair = `${nameOf(nodes[i]!.evidenceId)}/${nameOf(nodes[j]!.evidenceId)}`;
      const isTwin = twinKeys.has(`${nodes[i]!.evidenceId}|${nodes[j]!.evidenceId}`);
      if (isTwin) unresolvedTwins.push(pair);
      else if (gap < 0.5) coincident.push(pair);
      else crowded.push(pair);
    }
  }
  const invisibleEdges = edges.filter((edge) => Math.hypot(edge.to.x - edge.from.x, edge.to.y - edge.from.y) < BEAD_PX / 2);

  /**
   * WHERE A THREAD LANDS, not merely how close two beads are. A thread is a
   * claim about the two receipts it NAMES; when beads collide, an end can be
   * drawn on top of a receipt the thread does not name, and a reader reading the
   * pixels instead of the edge list would take a relation from it. That is the
   * one way either variant could suggest something the evidence does not
   * declare, so it is measured on the delivered geometry — the count of thread
   * ends sitting on an unnamed receipt, the count of threads passing over one,
   * and, decisively, how many of the pairs so suggested are NOT declared
   * anywhere in the canonical edge set. Reported, not repaired: moving a receipt
   * to open the collision would make the picture disagree with the operator it
   * claims to display.
   */
  const declaredPair = new Set(input.graph.edges.flatMap((edge) => [`${edge.parent}|${edge.child}`, `${edge.child}|${edge.parent}`]));
  const impliedUndeclared = new Set<string>();
  const touchedReceipts = new Set<string>();
  let endpointsOnUnnamedReceipts = 0;
  let threadTouchesOnUnnamedReceipts = 0;
  for (const edge of edges) {
    for (const node of nodes) {
      if (node.evidenceId === edge.parent || node.evidenceId === edge.child) continue;
      if (distanceToSegment(node, edge.from, edge.to) >= BEAD_PX / 2) continue;
      threadTouchesOnUnnamedReceipts += 1;
      touchedReceipts.add(node.evidenceId);
      if (Math.hypot(node.x - edge.to.x, node.y - edge.to.y) < BEAD_PX / 2) {
        endpointsOnUnnamedReceipts += 1;
        if (!declaredPair.has(`${edge.parent}|${node.evidenceId}`)) impliedUndeclared.add(`${nameOf(edge.parent)} -> ${nameOf(node.evidenceId)}`);
      }
      if (Math.hypot(node.x - edge.from.x, node.y - edge.from.y) < BEAD_PX / 2) {
        endpointsOnUnnamedReceipts += 1;
        if (!declaredPair.has(`${node.evidenceId}|${edge.child}`)) impliedUndeclared.add(`${nameOf(node.evidenceId)} -> ${nameOf(edge.child)}`);
      }
    }
  }

  const facts: CollisionFacts = Object.freeze({
    twins: Object.freeze(input.twins.map(([left, right]) => `${nameOf(input.ids[left]!)}/${nameOf(input.ids[right]!)}`)),
    unresolvedTwins: Object.freeze(unresolvedTwins),
    coincident: Object.freeze(coincident),
    crowded: Object.freeze(crowded),
    invisibleEdges: invisibleEdges.length,
    closestPx: closest === Number.POSITIVE_INFINITY ? 0 : closest,
    endpointsOnUnnamedReceipts,
    threadTouchesOnUnnamedReceipts,
    receiptsTouchedByAnUnnamedThread: touchedReceipts.size,
    impliedUndeclared: Object.freeze([...impliedUndeclared].sort()),
  });

  const xs = nodes.map((node) => node.x);
  const ys = nodes.map((node) => node.y);

  return Object.freeze({
    id: input.id,
    title: input.title,
    axes: Object.freeze({ ...input.axes }),
    width: input.width,
    height: input.height,
    nodes: Object.freeze(nodes),
    edges: Object.freeze(edges),
    ornaments: Object.freeze(ornaments),
    diagnostics: Object.freeze({
      ...input.diagnostics,
      blockScalePx: round2(input.placement.scale),
      blockGapPx: round2(input.placement.gapPx),
      blockRawRadii: Object.freeze(input.placement.placed.map((placed) => Number(placed.rawRadius.toExponential(4)))),
      edgeCrossings: countCrossings(edges),
      structuralTwinPairs: facts.twins.length,
      structuralTwins: facts.twins.join(" ") || "none",
      coincidentNodePairs: facts.coincident.length + facts.unresolvedTwins.length,
      coincidentNodes: [...facts.unresolvedTwins, ...facts.coincident].join(" ") || "none",
      overlappingNodePairs: facts.coincident.length + facts.crowded.length + facts.unresolvedTwins.length,
      closestNodePairPx: round2(facts.closestPx),
      edgesShorterThanOneBead: facts.invisibleEdges,
      threadEndsOnAnUnnamedReceipt: facts.endpointsOnUnnamedReceipts,
      threadTouchesOnAnUnnamedReceipt: facts.threadTouchesOnUnnamedReceipts,
      receiptsTouchedByAnUnnamedThread: facts.receiptsTouchedByAnUnnamedThread,
      undeclaredPairsSuggestedByAThreadEnd: facts.impliedUndeclared.length,
      undeclaredPairsSuggested: facts.impliedUndeclared.join("; ") || "none",
      xExtentPx: round2(Math.max(...xs) - Math.min(...xs)),
      yExtentPx: round2(Math.max(...ys) - Math.min(...ys)),
    }),
    caveats: Object.freeze(input.caveats(facts)),
  });
}

/** What the delivered geometry does to the reader, measured not argued. */
type CollisionFacts = Readonly<{
  /** Pairs an automorphism makes indistinguishable — a fact about the evidence. */
  twins: readonly string[];
  /** Those twins, confirmed to have landed on one point in THIS drawing. */
  unresolvedTwins: readonly string[];
  /** Non-twin pairs within half a pixel — this operator failed to resolve them. */
  coincident: readonly string[];
  /** Non-twin pairs within one bead — their beads overlap. */
  crowded: readonly string[];
  /** Declared edges drawn shorter than a bead radius, so effectively invisible. */
  invisibleEdges: number;
  closestPx: number;
  /** Thread ends drawn on a receipt the thread does not name. */
  endpointsOnUnnamedReceipts: number;
  /** Thread-over-bead incidences anywhere along a chord, endpoints included. */
  threadTouchesOnUnnamedReceipts: number;
  receiptsTouchedByAnUnnamedThread: number;
  /** Pairs a misplaced thread end asserts that the evidence never declares. */
  impliedUndeclared: readonly string[];
}>;

/** Caveats both variants owe the reader, whatever the operator. */
const sharedCaveats = (
  what: string,
  sizes: readonly number[],
  spine: Readonly<{ size: number; diameter: number }>,
  facts: CollisionFacts,
): readonly string[] => [
  `Position is not causality. ${what} Two receipts drawn close together are close in the spectrum of a matrix; that is a property of the matrix, not a claim that one caused the other, informed the other, or came before it. The only causal claims in this picture are the 79 drawn edges, and every one of them is a declared canonical relation.`,
  "A diffusion or spectral distance is not a causal distance. Nothing propagates between these receipts. \"Diffusion\" names how probability moves in an abstract Markov chain built from the edge set; no evidence, signal or authority travelled along any path drawn or implied here.",
  "Direction is absent from the coordinates. The declared graph is directed and the embedding needs a symmetric matrix, so the two ends of every edge were made equivalent before the eigendecomposition. A parent and a child are equidistant here. Direction survives only in the drawn edges, which keep their canonical parent-to-child orientation.",
  `The symmetrised edge set is not connected: it splits into blocks of ${sizes.join(" and ")} receipts with no undirected path between them. The blocks are embedded separately and placed side by side. The blank corridor between them means "no path at all", not "far apart" — it is not a distance and must not be read as one. Distances across the corridor are meaningless; distances inside a block are comparable to each other and to the other block, because one scale is used throughout.`,
  "Each block was scaled isotropically to a common size before placement, because an eigenvector is normalised over its own membership and a smaller block's entries are systematically larger for reasons that have nothing to do with the evidence. That rescaling changes how large a block is drawn and nothing about the arrangement inside it. The raw radii are in the diagnostics.",
  facts.twins.length === 0
    ? "No pair of receipts is structurally interchangeable in the symmetrised graph, so no collision here is forced by the evidence."
    : `${facts.twins.join(", ")} ${facts.twins.length === 1 ? "is a pair of TRUE TWINS" : "are pairs of TRUE TWINS"} in the symmetrised graph: adjacent, with identical closed neighbourhoods. Exchanging such a pair is an automorphism of every matrix built from that graph, so NO eigenvector can separate them and no spectral or diffusion method ever will. ${facts.unresolvedTwins.length > 0 ? `They land on the same point here, as they must. ` : ""}That is a finding about the evidence — two distinct sealed receipts are structurally interchangeable — and it is reported rather than repaired. Nudging one apart would make the picture disagree with the operator it claims to show.`,
  facts.coincident.length + facts.crowded.length === 0
    ? `Apart from that, no two receipts are drawn closer than one bead (${BEAD_PX} px).`
    : `Separately from any automorphism, ${facts.coincident.length + facts.crowded.length} pair${facts.coincident.length + facts.crowded.length === 1 ? "" : "s"} of receipts are drawn closer than one bead (${BEAD_PX} px), of which ${facts.coincident.length} sit within half a pixel: ${[...facts.coincident, ...facts.crowded].join(", ")}. These receipts are NOT interchangeable — the operator simply does not resolve them at this scale. ${facts.invisibleEdges > 0 ? `${facts.invisibleEdges} of the 79 declared edges are consequently shorter than a bead radius and cannot be seen, though they are present in the data delivered to the harness. ` : ""}A tight cluster here means "this method could not tell these apart", never "these are related".`,
  facts.impliedUndeclared.length === 0 && facts.threadTouchesOnUnnamedReceipts === 0
    ? "No thread is drawn over or onto a receipt it does not name, so every line in this picture can be read literally."
    : `READ THREADS FROM THE EDGE LIST, NOT BY EYE. A thread is a claim about exactly the two receipts it names, and where beads collide a thread is drawn across receipts it does not name: ${facts.threadTouchesOnUnnamedReceipts} thread-over-bead incidences across ${facts.receiptsTouchedByAnUnnamedThread} receipts, and ${facts.endpointsOnUnnamedReceipts} thread ENDS landing on a bead that is neither their parent nor their child (counted per end, so a thread shorter than a bead can contribute both of its ends to one receipt). Taken literally off the pixels, those misplaced ends would assert ${facts.impliedUndeclared.length} receipt pair${facts.impliedUndeclared.length === 1 ? "" : "s"} THE EVIDENCE DOES NOT DECLARE${facts.impliedUndeclared.length === 0 ? "" : `: ${facts.impliedUndeclared.join(", ")}`}. None of them is a relation. The delivered edge list is the authority and contains exactly the 79 canonical relations; a line seen touching a bead is not evidence that the bead is on it. This is the single most likely way to misread this picture, and it is why neither variant should be used as the primary evidence view.`,
  `The largest block is close to a path: ${spine.size} receipts with an undirected diameter of ${spine.diameter} hops. The leading eigenvector of a path is a cosine in position along it, and a cosine bunches points at BOTH ends while spreading them through the middle. Crowding at the extreme left and right of this picture is that cosine — a property of a long, thin graph — and not a claim that the receipts sitting there resemble one another.`,
  "The reading ordinal (NR 01..NR 58) was not an input. It is used here only to name receipts in this note so a human can find them.",
];

// ─── D1 — SPECTRAL EMBEDDING ────────────────────────────────────────────────

export const buildVariantD1: VariantBuilder = ({ graph, width, height }) => {
  const symmetric = symmetrise(graph);
  const groups = componentsOf(symmetric.weights);
  const largest = [...groups].sort((left, right) => right.length - left.length)[0] ?? [];
  const spine = Object.freeze({
    size: largest.length,
    diameter: Math.max(...hopMatrix(submatrix(symmetric.weights, largest)).flatMap((row) => row.filter(Number.isFinite)), 0),
  });

  // The GLOBAL decomposition. Not used for coordinates — it cannot be, as its
  // non-trivial eigenvectors are supported on one component each — but it is the
  // measurement that says so, and it is what `componentCount` is counted from.
  const global = ascending(normalisedLaplacian(symmetric.weights));
  const componentCount = global.values.filter((value) => Math.abs(value) < NULL_TOLERANCE).length;
  const fiedlerValue = global.values.find((value) => Math.abs(value) >= NULL_TOLERANCE) ?? 0;

  const blocks: Block[] = groups.map((members, index) => {
    const block = spectralBlock(submatrix(symmetric.weights, members));
    return Object.freeze({
      members,
      coords: block.coords,
      origin: Object.freeze({ x: 0, y: 0 }),
      label: `Block ${index + 1} — ${members.length} receipts`,
      values: block.values,
      detail: Object.freeze({ trivial: block.trivial, fiedler: block.values[block.trivial] ?? 0, next: block.values[block.trivial + 1] ?? 0 }),
    });
  });

  const spectrum = (block: Block, count: number) => Object.freeze(block.values.slice(0, count).map((value) => Number(value.toFixed(9))));

  return assemble({
    id: "D1",
    title: "Spectral embedding of the symmetrised causal graph",
    axes: Object.freeze({
      x: "Fiedler vector — 2nd-smallest eigenvector of the block's normalised Laplacian (unitless)",
      y: "3rd-smallest eigenvector of the same Laplacian (unitless)",
    }),
    graph, width, height,
    placement: placeBlocks(blocks, width, height),
    ids: symmetric.ids,
    twins: structuralTwins(symmetric.weights),
    diagnostics: {
      method: "normalised spectral embedding, per connected component",
      symmetrisation: "W = (A + AT) / 2 over the 79 declared edges, each weighted 1",
      symmetrisationNote: "zero reciprocal pairs, so the average equals half the union and L_sym is invariant to that factor — the two choices coincide on this graph",
      matrixKind: "L_sym = I - D^(-1/2) W D^(-1/2)",
      reciprocalDeclaredPairs: symmetric.reciprocalPairs,
      isolatedNodes: symmetric.isolated,
      minDegree: Math.min(...symmetric.degrees),
      maxDegree: Math.max(...symmetric.degrees),
      globalEigenvalues: Object.freeze(global.values.slice(0, 8).map((value) => Number(value.toFixed(9)))),
      fiedlerValue: Number(fiedlerValue.toFixed(9)),
      componentCount,
      componentSizes: Object.freeze(groups.map((group) => group.length)),
      trivialVectorsDiscardedGlobally: componentCount,
      block1Eigenvalues: spectrum(blocks[0]!, 8),
      block2Eigenvalues: blocks.length > 1 ? spectrum(blocks[1]!, 8) : Object.freeze([]),
      block1AxisRatio: Number(((blocks[0]!.detail.next ?? 0) / Math.max(blocks[0]!.detail.fiedler ?? 1, 1e-12)).toFixed(4)),
      largestBlockHopDiameter: spine.diameter,
      nullTolerance: NULL_TOLERANCE,
      jacobiSweepsMax: 100,
      edgeGeometry: "straight chord, parent to child; a bowed alternative was measured and rejected (it added crossings without reducing false touches)",
    },
    caveats: (facts) => [
      ...sharedCaveats(
        "This is a spectral embedding: the axes are the two lowest non-trivial eigenvectors of the normalised Laplacian.",
        groups.map((group) => group.length),
        spine,
        facts,
      ),
      `The two axes are not equally informative. In the larger block the second coordinate carries eigenvalue ${(blocks[0]!.detail.next ?? 0).toFixed(4)} against the Fiedler vector's ${(blocks[0]!.detail.fiedler ?? 0).toFixed(4)}, a ratio of ${((blocks[0]!.detail.next ?? 0) / Math.max(blocks[0]!.detail.fiedler ?? 1, 1e-12)).toFixed(1)}x: vertical separation is a finer-grained, higher-frequency distinction than horizontal separation, and the two should not be read as comparable amounts of evidence.`,
      "The eigenvector is the raw L_sym eigenvector, not the degree-rescaled random-walk form. Low-degree receipts are therefore drawn nearer the block's centre than a random-walk embedding would place them; this is a known bias of the symmetric normalisation, not a statement about how peripheral a receipt is.",
      "An eigenvector's sign is arbitrary. Left and right, up and down carry no meaning on their own; only the arrangement does. Which side of a reference line a receipt falls on is meaningful, which side is \"positive\" is not.",
    ],
  });
};

// ─── D2 — DIFFUSION MAP ─────────────────────────────────────────────────────

export const buildVariantD2: VariantBuilder = ({ graph, width, height }) => {
  const symmetric = symmetrise(graph);
  const groups = componentsOf(symmetric.weights);

  const hopsByBlock = groups.map((members) => hopMatrix(submatrix(symmetric.weights, members)));

  /**
   * ε is set from the data by one stated rule applied identically to each block:
   * the MEDIAN OF THE SQUARED PAIRWISE HOP DISTANCES within the block. The
   * Gaussian then has half-weight around the typical separation of the set it is
   * applied to, which is what a kernel width is for.
   *
   * Applied per block, not pooled, because the kernel is genuinely block
   * diagonal — the two components are two separate Markov chains that share no
   * state — and a width taken from 990 pairs in one block would leave the other
   * (78 pairs, diameter 9) so over-smoothed that every receipt in it is nearly
   * equally similar to every other. That is one rule applied twice, not two
   * rules. The consequence is that the two blocks' coordinates are not on a
   * common analytic scale, which is stated in the caveats.
   *
   * The Coifman–Singer criterion (ε at the maximum of d log Σ K / d log ε) was
   * computed first and rejected with its number recorded: it returns ε ≈ 0.92 on
   * this data, BELOW the resolution of an integer hop metric whose smallest
   * non-zero distance is 1, which makes the kernel narrower than the metric can
   * express and the spectrum near-degenerate (λ₁ = 0.998). The criterion assumes
   * a continuous manifold sampled densely; a 58-node hop graph is not one.
   */
  const epsilons = hopsByBlock.map((hops) => {
    const squares: number[] = [];
    for (let i = 0; i < hops.length; i += 1) {
      for (let j = i + 1; j < hops.length; j += 1) {
        const distance = hops[i]![j]!;
        if (Number.isFinite(distance)) squares.push(distance * distance);
      }
    }
    return squares.length === 0 ? 1 : Math.max(median(squares), 1);
  });

  const results = hopsByBlock.map((hops, index) => diffusionBlock(hops, epsilons[index]!));

  const blocks: Block[] = groups.map((members, index) => Object.freeze({
    members,
    coords: results[index]!.coords,
    origin: Object.freeze({ x: 0, y: 0 }),
    label: `Block ${index + 1} — ${members.length} receipts`,
    values: results[index]!.values,
    detail: Object.freeze({
      lambda1: results[index]!.values[1] ?? 0,
      lambda2: results[index]!.values[2] ?? 0,
      kernelMeanOffDiagonal: results[index]!.kernelMeanOffDiagonal,
    }),
  }));

  const diameters = hopsByBlock.map((hops) => Math.max(...hops.flatMap((row) => row.filter((value) => Number.isFinite(value))), 0));
  const largestIndex = groups.reduce((best, group, index) => (group.length > groups[best]!.length ? index : best), 0);
  const spine = Object.freeze({ size: groups[largestIndex]!.length, diameter: diameters[largestIndex]! });
  const unreachablePairs = (() => {
    const n = symmetric.ids.length;
    const total = (n * (n - 1)) / 2;
    const within = groups.reduce((sum, group) => sum + (group.length * (group.length - 1)) / 2, 0);
    return total - within;
  })();

  const spectrum = (block: Block, count: number) => Object.freeze(block.values.slice(0, count).map((value) => Number(value.toFixed(9))));

  return assemble({
    id: "D2",
    title: "Diffusion map over shortest-path hop distance",
    axes: Object.freeze({
      x: `1st diffusion coordinate, lambda1^t * psi1 (t = ${DIFFUSION_TIME}, unitless)`,
      y: `2nd diffusion coordinate, lambda2^t * psi2 (t = ${DIFFUSION_TIME}, unitless)`,
    }),
    graph, width, height,
    placement: placeBlocks(blocks, width, height),
    ids: symmetric.ids,
    twins: structuralTwins(symmetric.weights),
    diagnostics: {
      method: "diffusion map, per connected component",
      distanceUsed: "shortest-path hop count on the symmetrised canonical edge set — derived from declared edges only, never from ordinal, time or lane",
      symmetrisation: "W = (A + AT) / 2 over the 79 declared edges, each weighted 1",
      kernel: "K_ij = exp(-d_ij^2 / eps); P = D^(-1) K; eigendecomposition via the similar symmetric S = D^(-1/2) K D^(-1/2), psi = D^(-1/2) v",
      epsilonRule: "median of the squared pairwise hop distances within the block",
      epsilon: Number(epsilons[0]!.toFixed(4)),
      epsilonByBlock: Object.freeze(epsilons.map((value) => Number(value.toFixed(4)))),
      epsilonRejectedCoifmanSinger: 0.917,
      epsilonRejectedReason: "max-slope criterion falls below the resolution of an integer hop metric (min non-zero distance 1); it assumes a densely sampled continuous manifold",
      diffusionTime: DIFFUSION_TIME,
      block1Eigenvalues: spectrum(blocks[0]!, 8),
      block2Eigenvalues: blocks.length > 1 ? spectrum(blocks[1]!, 8) : Object.freeze([]),
      spectralGap: Number((1 - (blocks[0]!.detail.lambda1 ?? 0)).toFixed(9)),
      spectralGapByBlock: Object.freeze(blocks.map((block) => Number((1 - (block.detail.lambda1 ?? 0)).toFixed(9)))),
      eigenGap12ByBlock: Object.freeze(blocks.map((block) => Number(((block.detail.lambda1 ?? 0) - (block.detail.lambda2 ?? 0)).toFixed(9)))),
      kernelMeanOffDiagonalByBlock: Object.freeze(blocks.map((block) => Number((block.detail.kernelMeanOffDiagonal ?? 0).toFixed(4)))),
      componentCount: groups.length,
      componentSizes: Object.freeze(groups.map((group) => group.length)),
      hopDiameterByBlock: Object.freeze(diameters.map((value) => (Number.isFinite(value) ? value : -1))),
      unreachablePairs,
      nullTolerance: NULL_TOLERANCE,
      edgeGeometry: "straight chord, parent to child; a bowed alternative was measured and rejected (it added crossings without reducing false touches)",
    },
    caveats: (facts) => [
      ...sharedCaveats(
        "This is a diffusion map: the axes are the two leading non-trivial diffusion coordinates of a random walk on hop distance.",
        groups.map((group) => group.length),
        spine,
        facts,
      ),
      `The kernel width is set per block by one rule, which gives eps = ${epsilons.map((value) => value.toFixed(0)).join(" and ")}. The two blocks therefore run different kernels and their coordinates are not on a common analytic scale: a gap of a given length inside one block does not mean the same diffusion distance as the same gap inside the other. Within a block it does.`,
      `The two axes are weighted by their own eigenvalues at t = ${DIFFUSION_TIME}: in the larger block lambda1 = ${(blocks[0]!.detail.lambda1 ?? 0).toFixed(4)} against lambda2 = ${(blocks[0]!.detail.lambda2 ?? 0).toFixed(4)}. The horizontal axis carries the slower, coarser mode; vertical separation is a finer distinction and the two are not comparable quantities.`,
      "Hop distance ignores edge kind and edge direction. A 'cause' edge and an 'observed' edge count as one hop each, so the walk treats a declared observation and a declared cause as the same kind of step. Kind survives only in the drawn edges.",
      "Hop distance is not evidence weight. Two receipts one hop apart are not more strongly related than two receipts three hops apart; the graph declares relations, not magnitudes, and nothing in the canonical layer quantifies how much a parent contributed to a child.",
    ],
  });
};

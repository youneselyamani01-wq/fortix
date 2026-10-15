import type { CanonicalGraph } from "./canonicalGraph.ts";
import { graphMetrics, type GraphMetrics } from "./graphMetrics.ts";
import type { VariantBuilder, VariantEdge, VariantInput, VariantLayout, VariantNode, VariantOrnament } from "./variantTypes.ts";
import type { ProvenanceLane } from "../adapter/publicExperienceAdapter.ts";

/**
 * D-006/NX GATE 2 — VARIANTS D3 AND D4.
 *
 * D3  FORCE-DIRECTED. A Fruchterman-Reingold equilibrium over the 79 declared
 *     edges: every pair of receipts repels, every declared relation attracts,
 *     a cooling schedule freezes the result. It answers "what shape does this
 *     evidence have when nothing but its own relations decides the picture".
 *
 * D4  EVIDENCE FLOW FIELD. The same converged geometry, with a coarse vector
 *     field sampled from the declared edges laid underneath it. It answers
 *     "which way does causality point, on average, in each region of that
 *     shape".
 *
 * THE LINE BOTH OF THEM MUST NOT CROSS (§8, §9). A simulation moves ink. It
 * does not move facts. Two receipts that a force pushed together are not
 * thereby related; a streamline that sweeps past two receipts asserts nothing
 * about them. So:
 *
 *   - attraction is applied ONLY along canonical edges, never between nodes
 *     that merely look adjacent, cluster together, or carry consecutive
 *     reading ordinals;
 *   - the reading ordinal is never read by either builder — not as a force,
 *     not as a coordinate, not as a tie-break. It travels on the node as a
 *     label because §16 requires it be displayed, and nowhere else;
 *   - the field is emitted as ORNAMENTS. There is structurally nowhere in
 *     `VariantLayout` to put a streamline that would be mistaken for an edge,
 *     and this module never tries to find one.
 *
 * DETERMINISM. No `Math.random()`. Initial positions come from each receipt's
 * declared lane and causal depth, jittered by a hash of its `evidenceId`, so
 * the same graph always yields byte-identical geometry and a reviewer can
 * re-run the picture they are auditing.
 */

type Vec = Readonly<{ x: number; y: number }>;

type MutableVec = { x: number; y: number };

const PAD_X = 92;
const PAD_Y = 46;

/** Fruchterman-Reingold schedule. Chosen once, reported in diagnostics, never tuned per run. */
const ITERATIONS = 600;
/**
 * Ideal edge length as a fraction of sqrt(area / nodes). The textbook value of
 * ~1 assumes a roughly round graph; this one has a 34-edge causal spine, which
 * at that length wants to be twice as wide as the frame and ends up pressed
 * flat against the margins instead of folding. Shortened until the spine folds
 * into the frame under its own forces rather than under the wall's.
 */
const IDEAL_LENGTH_SCALE = 0.46;
/** Initial temperature as a fraction of the usable width; the maximum a node may move in one step. */
const INITIAL_TEMPERATURE_SCALE = 1 / 8;
/** Cooling exponent. >1 spends more of the schedule cold, which settles crossings rather than re-rolling them. */
const COOLING_EXPONENT = 1.4;
/**
 * Strength of the pull toward a receipt's declared lane band, relative to edge
 * attraction. Chosen by sweep, not by taste. At 0 the unconstrained run leaves
 * 47 of 58 receipts outside the band their lane would put them in, and draws 21
 * crossings. At 10 only 12 are outside, and it still draws 21 — the provenance
 * axis comes free. Past 10 the layout stops being a force result and starts
 * being a swimlane, which is variant B's job, so it stops here.
 */
const LANE_PULL = 10;
/**
 * Stiffness of the soft wall at the frame edge, relative to edge attraction.
 * A HARD clamp (classic Fruchterman-Reingold) pins everything that reaches a
 * wall onto the same corner pixel, and two receipts drawn on one pixel is a
 * picture that misreports how many receipts there are. A cushion instead: a
 * node can push into the margin, and is pushed back harder the further it goes.
 * It also does the job the clamp was there for — the causal spine is 34 edges
 * long and would otherwise stretch far past the frame instead of folding.
 */
const BORDER_STRENGTH = 20;

/** Flow-field sampling. All four numbers are reported; none of them may change what an edge is. */
const FIELD_CELL_TARGET_PX = 20;
const FIELD_SIGMA_PX = 58;
const FIELD_CUTOFF_SIGMAS = 2.6;
/** Minimum separation between streamlines, and the shortest line worth drawing. */
const STREAMLINE_SEPARATION_PX = 34;
/**
 * No streamline may come within this distance of a receipt. This is the §9 rule
 * made structural rather than stylistic: a line that never touches a receipt
 * cannot be read as joining two of them, whatever a viewer assumes about what
 * the curves mean. Lines terminate on entering the keep-out.
 */
const RECEIPT_KEEP_OUT_PX = 16;
const STREAMLINE_MAX_STEPS = 240;
const STREAMLINE_MIN_POINTS = 8;
const STREAMLINE_MIN_MAGNITUDE = 0.06;
const STREAMLINE_LIMIT = 140;

const r2 = (value: number): number => Math.round(value * 100) / 100;
const r1 = (value: number): number => Math.round(value * 10) / 10;
const r4 = (value: number): number => Math.round(value * 10000) / 10000;

/**
 * FNV-1a over the evidence id. The jitter that separates receipts sharing a
 * lane and a depth has to come from somewhere; taking it from the identity of
 * the object means "deterministic" is a property of the evidence rather than
 * of a seed someone could quietly re-roll.
 */
function hashUnit(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i += 1) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h / 0x100000000;
}

type Frame = Readonly<{ left: number; top: number; width: number; height: number }>;

const frameOf = (width: number, height: number): Frame => Object.freeze({
  left: PAD_X,
  top: PAD_Y,
  width: Math.max(1, width - 2 * PAD_X),
  height: Math.max(1, height - 2 * PAD_Y),
});

/** Centre line of a lane's band. Used as the seed row and as the optional weak anchor. */
function laneAnchors(graph: CanonicalGraph, frame: Frame): ReadonlyMap<ProvenanceLane, number> {
  const band = frame.height / Math.max(1, graph.lanes.length);
  return new Map(graph.lanes.map((lane, index) => [lane, frame.top + (index + 0.5) * band] as const));
}

type SimResult = Readonly<{
  positions: ReadonlyMap<string, Vec>;
  iterations: number;
  idealLength: number;
  firstDisplacement: number;
  finalDisplacement: number;
  /** Total movement over the last tenth of the schedule — a steadier convergence read than one step. */
  tailDisplacement: number;
  /**
   * Unclamped force imbalance at the last step. `finalDisplacement` only says
   * the schedule went cold; this says whether the configuration is actually at
   * rest, which is the claim a reader would otherwise assume.
   */
  finalResidualForce: number;
  crossings: number;
  meanEdgeLength: number;
  /** Closest pair of receipts in the fitted picture. Two on one pixel would misreport the count. */
  minSeparation: number;
  /** The single uniform map from simulation space to the frame, so the lane guides can travel with the nodes. */
  fit: Readonly<{ scale: number; offsetX: number; offsetY: number; minX: number; minY: number }>;
  /** How many receipts finished outside the lane band their spring aimed at. */
  outsideOwnBand: number;
}>;

/**
 * One Fruchterman-Reingold run. `lanePull` at 0 is the pure simulation; above 0
 * adds a weak spring toward the receipt's declared lane band. Both are built so
 * the pair can be compared and the comparison reported honestly.
 */
function simulate(
  graph: CanonicalGraph,
  metrics: GraphMetrics,
  frame: Frame,
  lanePull: number,
): SimResult {
  const ids = graph.receipts.map((entry) => entry.evidenceId);
  const anchors = laneAnchors(graph, frame);
  const band = frame.height / Math.max(1, graph.lanes.length);
  const depths = [...metrics.depth.values()];
  const maxDepth = Math.max(1, ...depths);

  // Seeded from declared structure — lane band for y, causal depth for x —
  // with a per-identity jitter so receipts sharing both do not start on top of
  // one another (coincident points make repulsion undefined, not merely ugly).
  const position = new Map<string, MutableVec>();
  const anchorY = new Map<string, number>();
  for (const receipt of graph.receipts) {
    const id = receipt.evidenceId;
    const lane = anchors.get(receipt.lane) ?? frame.top + frame.height / 2;
    const jx = hashUnit(id) - 0.5;
    const jy = hashUnit(`${id}#y`) - 0.5;
    position.set(id, {
      x: frame.left + ((metrics.depth.get(id) ?? 0) / maxDepth) * frame.width + jx * frame.width * 0.04,
      y: lane + jy * band * 0.8,
    });
    anchorY.set(id, lane);
  }

  const k = IDEAL_LENGTH_SCALE * Math.sqrt((frame.width * frame.height) / Math.max(1, ids.length));
  const kk = k * k;
  const t0 = frame.width * INITIAL_TEMPERATURE_SCALE;

  const disp = new Map<string, MutableVec>(ids.map((id) => [id, { x: 0, y: 0 }] as const));
  let firstDisplacement = 0;
  let finalDisplacement = 0;
  let tailDisplacement = 0;
  let finalResidualForce = 0;
  const tailFrom = Math.floor(ITERATIONS * 0.9);

  for (let iter = 0; iter < ITERATIONS; iter += 1) {
    const temperature = t0 * Math.pow(1 - iter / ITERATIONS, COOLING_EXPONENT);
    for (const id of ids) {
      const d = disp.get(id)!;
      d.x = 0;
      d.y = 0;
    }

    // Repulsion between every pair. This is the only all-pairs term, and it
    // pushes apart — it can never draw two receipts together into a shape a
    // reader might mistake for a relation.
    for (let i = 0; i < ids.length; i += 1) {
      const a = position.get(ids[i]!)!;
      const da = disp.get(ids[i]!)!;
      for (let j = i + 1; j < ids.length; j += 1) {
        const b = position.get(ids[j]!)!;
        const db = disp.get(ids[j]!)!;
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dist = Math.max(1e-3, Math.hypot(dx, dy));
        const force = kk / dist;
        const ux = (dx / dist) * force;
        const uy = (dy / dist) * force;
        da.x += ux;
        da.y += uy;
        db.x -= ux;
        db.y -= uy;
      }
    }

    // Attraction along DECLARED edges only. There is no second loop that pulls
    // on anything else, and adding one would be the violation §18 describes.
    for (const edge of graph.edges) {
      const a = position.get(edge.parent);
      const b = position.get(edge.child);
      if (a === undefined || b === undefined) continue;
      const da = disp.get(edge.parent)!;
      const db = disp.get(edge.child)!;
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const dist = Math.max(1e-3, Math.hypot(dx, dy));
      const force = (dist * dist) / k;
      const ux = (dx / dist) * force;
      const uy = (dy / dist) * force;
      da.x -= ux;
      da.y -= uy;
      db.x += ux;
      db.y += uy;
    }

    if (lanePull > 0) {
      for (const id of ids) {
        const p = position.get(id)!;
        const dy = (anchorY.get(id) ?? p.y) - p.y;
        // Same quadratic form as edge attraction, so the two are commensurable
        // and the constant reads as a ratio rather than as an arbitrary number.
        disp.get(id)!.y += Math.sign(dy) * ((dy * dy) / k) * lanePull;
      }
    }

    // The soft wall, applied as a force rather than as a clamp on the result.
    for (const id of ids) {
      const p = position.get(id)!;
      const d = disp.get(id)!;
      const left = frame.left - p.x;
      const right = p.x - (frame.left + frame.width);
      const top = frame.top - p.y;
      const bottom = p.y - (frame.top + frame.height);
      if (left > 0) d.x += ((left * left) / k) * BORDER_STRENGTH;
      if (right > 0) d.x -= ((right * right) / k) * BORDER_STRENGTH;
      if (top > 0) d.y += ((top * top) / k) * BORDER_STRENGTH;
      if (bottom > 0) d.y -= ((bottom * bottom) / k) * BORDER_STRENGTH;
    }

    let moved = 0;
    let residual = 0;
    for (const id of ids) {
      const p = position.get(id)!;
      const d = disp.get(id)!;
      const len = Math.hypot(d.x, d.y);
      residual += len;
      if (len <= 0) continue;
      const step = Math.min(len, temperature);
      p.x += (d.x / len) * step;
      p.y += (d.y / len) * step;
      moved += step;
    }
    if (iter === 0) firstDisplacement = moved;
    if (iter >= tailFrom) tailDisplacement += moved;
    finalDisplacement = moved;
    finalResidualForce = residual;
  }

  // Fit to the frame with one uniform scale. A uniform transform is a change of
  // units, not of geometry: it cannot alter which nodes are near which, so it
  // cannot alter anything a reader might read off the picture.
  const xs = ids.map((id) => position.get(id)!.x);
  const ys = ids.map((id) => position.get(id)!.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const scale = Math.min(frame.width / Math.max(1e-6, maxX - minX), frame.height / Math.max(1e-6, maxY - minY));
  const offsetX = frame.left + (frame.width - (maxX - minX) * scale) / 2;
  const offsetY = frame.top + (frame.height - (maxY - minY) * scale) / 2;

  const fitted = new Map<string, Vec>();
  for (const id of ids) {
    const p = position.get(id)!;
    fitted.set(id, Object.freeze({
      x: r2(offsetX + (p.x - minX) * scale),
      y: r2(offsetY + (p.y - minY) * scale),
    }));
  }

  let totalLength = 0;
  for (const edge of graph.edges) {
    const a = fitted.get(edge.parent);
    const b = fitted.get(edge.child);
    if (a === undefined || b === undefined) continue;
    totalLength += Math.hypot(b.x - a.x, b.y - a.y);
  }

  let minSeparation = Infinity;
  for (let i = 0; i < ids.length; i += 1) {
    const a = fitted.get(ids[i]!)!;
    for (let j = i + 1; j < ids.length; j += 1) {
      const b = fitted.get(ids[j]!)!;
      minSeparation = Math.min(minSeparation, Math.hypot(a.x - b.x, a.y - b.y));
    }
  }

  // Measured in simulation space, where the band still means what the spring
  // meant by it. A high count is not a fault: the spring is deliberately weak,
  // and this number is how weak it turned out to be.
  let outsideOwnBand = 0;
  for (const id of ids) {
    const p = position.get(id)!;
    const anchor = anchorY.get(id);
    if (anchor === undefined) continue;
    if (Math.abs(p.y - anchor) > band / 2) outsideOwnBand += 1;
  }

  return Object.freeze({
    positions: fitted,
    iterations: ITERATIONS,
    idealLength: k,
    firstDisplacement,
    finalDisplacement,
    tailDisplacement,
    finalResidualForce,
    crossings: countCrossings(graph, fitted),
    meanEdgeLength: totalLength / Math.max(1, graph.edges.length),
    minSeparation,
    fit: Object.freeze({ scale, offsetX, offsetY, minX, minY }),
    outsideOwnBand,
  });
}

const cross = (ox: number, oy: number, ax: number, ay: number, bx: number, by: number): number =>
  (ax - ox) * (by - oy) - (ay - oy) * (bx - ox);

/**
 * Proper crossings between the drawn segments. Pairs sharing an endpoint are
 * excluded — they meet at a receipt, which is the graph working, not a defect.
 * Counted on the FITTED coordinates so the number describes the picture that
 * is actually rendered.
 */
function countCrossings(graph: CanonicalGraph, at: ReadonlyMap<string, Vec>): number {
  const segments = graph.edges
    .map((edge) => {
      const a = at.get(edge.parent);
      const b = at.get(edge.child);
      return a === undefined || b === undefined ? null : { parent: edge.parent, child: edge.child, a, b };
    })
    .filter((entry): entry is { parent: string; child: string; a: Vec; b: Vec } => entry !== null);

  let count = 0;
  for (let i = 0; i < segments.length; i += 1) {
    const s = segments[i]!;
    for (let j = i + 1; j < segments.length; j += 1) {
      const u = segments[j]!;
      if (s.parent === u.parent || s.parent === u.child || s.child === u.parent || s.child === u.child) continue;
      const d1 = cross(s.a.x, s.a.y, s.b.x, s.b.y, u.a.x, u.a.y);
      const d2 = cross(s.a.x, s.a.y, s.b.x, s.b.y, u.b.x, u.b.y);
      const d3 = cross(u.a.x, u.a.y, u.b.x, u.b.y, s.a.x, s.a.y);
      const d4 = cross(u.a.x, u.a.y, u.b.x, u.b.y, s.b.x, s.b.y);
      if (d1 * d2 < 0 && d3 * d4 < 0) count += 1;
    }
  }
  return count;
}

function buildNodes(graph: CanonicalGraph, at: ReadonlyMap<string, Vec>): readonly VariantNode[] {
  return Object.freeze(graph.receipts.map((receipt) => {
    const p = at.get(receipt.evidenceId)!;
    return Object.freeze({ evidenceId: receipt.evidenceId, x: p.x, y: p.y, lane: receipt.lane });
  }));
}

/**
 * One drawn segment per canonical edge, carrying the parent, child and kind it
 * came from. Straight lines, deliberately: D4 lays curved streamlines under
 * this same geometry, and "straight means declared, curved means field" is the
 * distinction a reader can apply without a legend.
 */
function buildEdges(graph: CanonicalGraph, at: ReadonlyMap<string, Vec>): readonly VariantEdge[] {
  return Object.freeze(graph.edges.map((edge) => {
    const from = at.get(edge.parent)!;
    const to = at.get(edge.child)!;
    return Object.freeze({
      parent: edge.parent,
      child: edge.child,
      kind: edge.kind,
      crossLane: edge.crossLane,
      d: `M ${from.x} ${from.y} L ${to.x} ${to.y}`,
      from: Object.freeze({ x: from.x, y: from.y }),
      to: Object.freeze({ x: to.x, y: to.y }),
    });
  }));
}

/**
 * The lane bands the spring AIMED at, not the ones the receipts ended up in.
 *
 * The difference matters. Bands drawn around wherever a lane's receipts landed
 * would overlap, arrive out of order, and quietly assert that the force layout
 * separated provenance when it did not. These bands are the model's own — even
 * strips in canonical lane order, carried through the same uniform fit as the
 * nodes — so a receipt that the weak spring failed to hold is visibly outside
 * its band, which is the truth about how weak the spring is. Purely visual
 * (§5): a band is a region of the page, not a claim about any receipt.
 */
function laneOrnaments(graph: CanonicalGraph, frame: Frame, run: SimResult, width: number): readonly VariantOrnament[] {
  const band = frame.height / Math.max(1, graph.lanes.length);
  const { scale, offsetY, minY } = run.fit;
  const toScreen = (y: number): number => offsetY + (y - minY) * scale;
  const counts = new Map<ProvenanceLane, number>();
  for (const receipt of graph.receipts) counts.set(receipt.lane, (counts.get(receipt.lane) ?? 0) + 1);

  const ornaments: VariantOrnament[] = [];
  graph.lanes.forEach((lane, index) => {
    const top = toScreen(frame.top + index * band);
    const bottom = toScreen(frame.top + (index + 1) * band);
    ornaments.push(Object.freeze({
      kind: "laneGuide" as const,
      x: 0,
      y: r1(top),
      width,
      height: r1(Math.max(1, bottom - top)),
      lane,
      label: lane,
      weight: r4((counts.get(lane) ?? 0) / Math.max(1, graph.receipts.length)),
    }));
    ornaments.push(Object.freeze({
      kind: "laneLabel" as const,
      x: r1(frame.left * 0.28),
      y: r1((top + bottom) / 2),
      label: lane,
      lane,
    }));
  });
  return Object.freeze(ornaments);
}

const D3_TITLE = "Force-directed equilibrium";

/** Both D3 runs, so the provenance constraint can be reported as a measured comparison rather than a claim. */
function forceRuns(input: VariantInput): Readonly<{ free: SimResult; anchored: SimResult; frame: Frame }> {
  const metrics = graphMetrics(input.graph);
  const frame = frameOf(input.width, input.height);
  return Object.freeze({
    free: simulate(input.graph, metrics, frame, 0),
    anchored: simulate(input.graph, metrics, frame, LANE_PULL),
    frame,
  });
}

export const buildVariantD3: VariantBuilder = (input: VariantInput): VariantLayout => {
  const { free, anchored, frame } = forceRuns(input);
  // The anchored run is what ships: it costs crossings and buys provenance
  // legibility, and both halves of that trade are in `diagnostics` so the
  // choice can be argued with rather than taken on trust.
  const chosen = anchored;
  const at = chosen.positions;
  const xs = [...at.values()].map((p) => p.x);
  const ys = [...at.values()].map((p) => p.y);

  return Object.freeze({
    id: "D3",
    title: D3_TITLE,
    axes: Object.freeze({
      x: "No units — horizontal force equilibrium (all-pairs repulsion against attraction along declared edges)",
      y: "No units — vertical force equilibrium, plus a weak spring toward the receipt's declared provenance lane",
    }),
    width: input.width,
    height: input.height,
    nodes: buildNodes(input.graph, at),
    edges: buildEdges(input.graph, at),
    ornaments: laneOrnaments(input.graph, frame, chosen, input.width),
    diagnostics: Object.freeze({
      method: "Fruchterman-Reingold, deterministic seed (declared lane band + causal depth, jittered by FNV-1a of evidenceId)",
      iterations: chosen.iterations,
      idealEdgeLength: r2(chosen.idealLength),
      idealLengthScale: IDEAL_LENGTH_SCALE,
      initialTemperature: r2(frame.width * INITIAL_TEMPERATURE_SCALE),
      coolingExponent: COOLING_EXPONENT,
      lanePullStrength: LANE_PULL,
      displacementFirstIteration: r2(chosen.firstDisplacement),
      displacementFinalIteration: r4(chosen.finalDisplacement),
      displacementLastTenthOfSchedule: r2(chosen.tailDisplacement),
      displacementMeanPerIterationLastTenth: r2(chosen.tailDisplacement / Math.max(1, Math.ceil(ITERATIONS * 0.1))),
      convergenceRatioFinalOverFirst: r4(chosen.finalDisplacement / Math.max(1e-9, chosen.firstDisplacement)),
      residualForceFinalIteration: r2(chosen.finalResidualForce),
      residualForcePerNode: r2(chosen.finalResidualForce / Math.max(1, input.graph.receipts.length)),
      minSeparationPx: r2(chosen.minSeparation),
      receiptsOutsideOwnLaneBand: chosen.outsideOwnBand,
      edgeCrossings: chosen.crossings,
      meanEdgeLength: r2(chosen.meanEdgeLength),
      edgeLengthOverIdeal: r4(chosen.meanEdgeLength / Math.max(1e-9, chosen.idealLength)),
      crossingsWithoutLanePull: free.crossings,
      crossingsWithLanePull: anchored.crossings,
      lanePullCrossingDelta: anchored.crossings - free.crossings,
      meanEdgeLengthWithoutLanePull: r2(free.meanEdgeLength),
      displacementFinalIterationWithoutLanePull: r4(free.finalDisplacement),
      receiptsOutsideOwnLaneBandWithoutLanePull: free.outsideOwnBand,
      lanePullVerdict: anchored.crossings <= free.crossings
        ? `It helped. The provenance spring moved receipts outside their declared lane band from ${free.outsideOwnBand} of ${input.graph.receipts.length} down to ${anchored.outsideOwnBand}, and cost nothing: ${anchored.crossings} crossings against the unconstrained run's ${free.crossings}.`
        : `Mixed. The provenance spring moved receipts outside their declared lane band from ${free.outsideOwnBand} of ${input.graph.receipts.length} down to ${anchored.outsideOwnBand}, and cost ${anchored.crossings - free.crossings} crossings (${free.crossings} to ${anchored.crossings}). Kept, with the cost stated rather than hidden.`,
      xBounds: Object.freeze([r2(Math.min(...xs)), r2(Math.max(...xs))]),
      yBounds: Object.freeze([r2(Math.min(...ys)), r2(Math.max(...ys))]),
      nodes: input.graph.receipts.length,
      edges: input.graph.edges.length,
      randomNumberGeneratorCalls: 0,
    }),
    caveats: Object.freeze([
      "Position here is the outcome of a physics simulation, not a measurement. Two receipts pushed together are not thereby related, and nothing may be inferred from proximity alone.",
      "Only the 79 declared edges attract. No force acts between two receipts because they cluster, because they sit near each other, or because their reading ordinals are consecutive.",
      "The reading ordinal (NR 01..NR 58) was not an input to any force, coordinate or tie-break. It is carried on each node as a display label only.",
      "The layout is deterministic — seeded from declared lane, causal depth and a hash of the evidence id, with no random number generator anywhere — but it is one equilibrium among many. A different cooling schedule would draw a different, equally truthful picture of the same unchanged facts.",
      `The spring toward each lane band is a legibility aid, not evidence. It holds most receipts but not all: ${chosen.outsideOwnBand} of ${input.graph.receipts.length} finished outside the band their declared lane aimed them at, pulled out by their own edges. A receipt's vertical position is therefore part provenance and part physics, and the picture alone will not tell you which.`,
      "The lane bands drawn behind the receipts are where the spring aimed, not territory any lane owns. A receipt sitting outside its band has not changed lane; it has been outvoted by its edges.",
      "Edge crossings are an artefact of drawing a non-planar graph on a flat page. Two lines that cross do not interact, and the point where they cross is not a receipt.",
      "Distance between two connected receipts reflects how the whole simulation settled, not how strong, how recent or how important the relation between them is. Edge length carries no meaning.",
    ]),
  });
};

type Field = Readonly<{
  cols: number;
  rows: number;
  cellW: number;
  cellH: number;
  vx: readonly number[];
  vy: readonly number[];
  /** |mean unit direction| in 0..1 — how far the nearby declared edges agree, not how much flows. */
  magnitude: readonly number[];
  /** Cells with at least one declared edge inside the cutoff. Everything else stays blank. */
  covered: readonly boolean[];
  emptyCells: number;
  sigma: number;
  cutoff: number;
  meanMagnitude: number;
  maxMagnitude: number;
  meanEdgesPerCoveredCell: number;
}>;

/** Distance from a point to a segment. Used so a long edge influences its whole length, not just its ends. */
function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq <= 1e-9) return Math.hypot(px - ax, py - ay);
  const t = Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / lengthSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * The field. Every cell holds the Gaussian-weighted mean of the UNIT direction
 * of the declared edges within the cutoff — parent to child, because that is
 * the direction the evidence declares.
 *
 * A cell with no declared edge in range stays blank. That is the honesty
 * choice: the alternative is to interpolate a direction into a region where
 * nothing was measured, which would put ink on the page that no receipt paid
 * for. The count of blank cells is reported.
 */
function buildField(graph: CanonicalGraph, at: ReadonlyMap<string, Vec>, width: number, height: number): Field {
  const cols = Math.max(8, Math.round(width / FIELD_CELL_TARGET_PX));
  const rows = Math.max(6, Math.round(height / FIELD_CELL_TARGET_PX));
  const cellW = width / cols;
  const cellH = height / rows;
  const sigma = FIELD_SIGMA_PX;
  const cutoff = FIELD_CUTOFF_SIGMAS * sigma;
  const twoSigmaSq = 2 * sigma * sigma;

  const segments = graph.edges
    .map((edge) => {
      const a = at.get(edge.parent);
      const b = at.get(edge.child);
      if (a === undefined || b === undefined) return null;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len <= 1e-6) return null;
      return { ax: a.x, ay: a.y, bx: b.x, by: b.y, ux: (b.x - a.x) / len, uy: (b.y - a.y) / len };
    })
    .filter((entry): entry is { ax: number; ay: number; bx: number; by: number; ux: number; uy: number } => entry !== null);

  const vx: number[] = new Array<number>(cols * rows).fill(0);
  const vy: number[] = new Array<number>(cols * rows).fill(0);
  const magnitude: number[] = new Array<number>(cols * rows).fill(0);
  const covered: boolean[] = new Array<boolean>(cols * rows).fill(false);
  let emptyCells = 0;
  let magnitudeSum = 0;
  let maxMagnitude = 0;
  let contributions = 0;

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const cx = (col + 0.5) * cellW;
      const cy = (row + 0.5) * cellH;
      let sx = 0;
      let sy = 0;
      let weight = 0;
      let near = 0;
      for (const seg of segments) {
        const dist = distanceToSegment(cx, cy, seg.ax, seg.ay, seg.bx, seg.by);
        if (dist > cutoff) continue;
        const w = Math.exp(-(dist * dist) / twoSigmaSq);
        sx += w * seg.ux;
        sy += w * seg.uy;
        weight += w;
        near += 1;
      }
      const index = row * cols + col;
      if (near === 0 || weight <= 0) {
        emptyCells += 1;
        continue;
      }
      const mx = sx / weight;
      const my = sy / weight;
      const mag = Math.hypot(mx, my);
      vx[index] = mx;
      vy[index] = my;
      magnitude[index] = mag;
      covered[index] = true;
      magnitudeSum += mag;
      maxMagnitude = Math.max(maxMagnitude, mag);
      contributions += near;
    }
  }

  const coveredCount = cols * rows - emptyCells;
  return Object.freeze({
    cols,
    rows,
    cellW,
    cellH,
    vx: Object.freeze(vx),
    vy: Object.freeze(vy),
    magnitude: Object.freeze(magnitude),
    covered: Object.freeze(covered),
    emptyCells,
    sigma,
    cutoff,
    meanMagnitude: magnitudeSum / Math.max(1, coveredCount),
    maxMagnitude,
    meanEdgesPerCoveredCell: contributions / Math.max(1, coveredCount),
  });
}

type Sample = Readonly<{ x: number; y: number; magnitude: number }>;

/** Bilinear sample of the field. Blank cells contribute a zero vector, so the field fades out where it was never measured rather than being extended. */
function sampleField(field: Field, x: number, y: number): Sample {
  const gx = x / field.cellW - 0.5;
  const gy = y / field.cellH - 0.5;
  const c0 = Math.floor(gx);
  const r0 = Math.floor(gy);
  const fx = gx - c0;
  const fy = gy - r0;
  let sx = 0;
  let sy = 0;
  let sm = 0;
  for (let dr = 0; dr <= 1; dr += 1) {
    for (let dc = 0; dc <= 1; dc += 1) {
      const col = c0 + dc;
      const row = r0 + dr;
      if (col < 0 || row < 0 || col >= field.cols || row >= field.rows) continue;
      const index = row * field.cols + col;
      if (!field.covered[index]) continue;
      const w = (dc === 0 ? 1 - fx : fx) * (dr === 0 ? 1 - fy : fy);
      sx += w * field.vx[index]!;
      sy += w * field.vy[index]!;
      sm += w * field.magnitude[index]!;
    }
  }
  return Object.freeze({ x: sx, y: sy, magnitude: sm });
}

/**
 * Evenly spaced streamlines, seeded in a fixed row-major sweep and separated by
 * an occupancy grid (Jobard-Lefebvre in its simplest form). Fixed seed order
 * and no random sampling means the same field always yields the same lines.
 */
function traceStreamlines(
  field: Field,
  width: number,
  height: number,
  receipts: readonly Vec[],
): Readonly<{ lines: readonly (readonly Sample[])[]; terminatedAtReceipt: number }> {
  const sepCols = Math.max(1, Math.ceil(width / STREAMLINE_SEPARATION_PX));
  const sepRows = Math.max(1, Math.ceil(height / STREAMLINE_SEPARATION_PX));
  const occupancy: number[] = new Array<number>(sepCols * sepRows).fill(-1);
  const step = Math.min(field.cellW, field.cellH) * 0.55;

  const occupiedBy = (x: number, y: number, line: number): boolean => {
    const col = Math.floor(x / STREAMLINE_SEPARATION_PX);
    const row = Math.floor(y / STREAMLINE_SEPARATION_PX);
    for (let dr = -1; dr <= 1; dr += 1) {
      for (let dc = -1; dc <= 1; dc += 1) {
        const c = col + dc;
        const r = row + dr;
        if (c < 0 || r < 0 || c >= sepCols || r >= sepRows) continue;
        const held = occupancy[r * sepCols + c]!;
        if (held !== -1 && held !== line) return true;
      }
    }
    return false;
  };
  const occupy = (x: number, y: number, line: number): void => {
    const col = Math.min(sepCols - 1, Math.max(0, Math.floor(x / STREAMLINE_SEPARATION_PX)));
    const row = Math.min(sepRows - 1, Math.max(0, Math.floor(y / STREAMLINE_SEPARATION_PX)));
    occupancy[row * sepCols + col] = line;
  };

  const keepOutSq = RECEIPT_KEEP_OUT_PX * RECEIPT_KEEP_OUT_PX;
  const nearReceipt = (x: number, y: number): boolean =>
    receipts.some((p) => (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y) < keepOutSq);

  let terminatedAtReceipt = 0;

  const walk = (seed: Sample, sign: number, line: number): Sample[] => {
    const points: Sample[] = [];
    let x = seed.x;
    let y = seed.y;
    for (let i = 0; i < STREAMLINE_MAX_STEPS; i += 1) {
      const here = sampleField(field, x, y);
      if (here.magnitude < STREAMLINE_MIN_MAGNITUDE) break;
      const len = Math.hypot(here.x, here.y);
      if (len < 1e-6) break;
      // Midpoint (RK2): the field turns sharply near a lane crossing and Euler
      // would cut the corner, drawing a line through a region it never sampled.
      const mx = x + (sign * here.x / len) * step * 0.5;
      const my = y + (sign * here.y / len) * step * 0.5;
      const mid = sampleField(field, mx, my);
      const midLen = Math.hypot(mid.x, mid.y);
      const dirX = midLen < 1e-6 ? (sign * here.x) / len : (sign * mid.x) / midLen;
      const dirY = midLen < 1e-6 ? (sign * here.y) / len : (sign * mid.y) / midLen;
      const nx = x + dirX * step;
      const ny = y + dirY * step;
      if (nx < 0 || ny < 0 || nx > width || ny > height) break;
      if (nearReceipt(nx, ny)) { terminatedAtReceipt += 1; break; }
      if (occupiedBy(nx, ny, line)) break;
      x = nx;
      y = ny;
      points.push(Object.freeze({ x, y, magnitude: sampleField(field, x, y).magnitude }));
      occupy(x, y, line);
    }
    return points;
  };

  const lines: (readonly Sample[])[] = [];
  for (let row = 0; row < field.rows && lines.length < STREAMLINE_LIMIT; row += 1) {
    for (let col = 0; col < field.cols && lines.length < STREAMLINE_LIMIT; col += 1) {
      const index = row * field.cols + col;
      if (!field.covered[index]) continue;
      if (field.magnitude[index]! < STREAMLINE_MIN_MAGNITUDE) continue;
      const sx = (col + 0.5) * field.cellW;
      const sy = (row + 0.5) * field.cellH;
      const line = lines.length;
      if (nearReceipt(sx, sy)) continue;
      if (occupiedBy(sx, sy, line)) continue;
      const seed = Object.freeze({ x: sx, y: sy, magnitude: field.magnitude[index]! });
      occupy(sx, sy, line);
      const forward = walk(seed, 1, line);
      const backward = walk(seed, -1, line);
      const path = [...[...backward].reverse(), seed, ...forward];
      if (path.length < STREAMLINE_MIN_POINTS) {
        // Release the reservation so a shorter line does not block a longer one.
        for (let i = 0; i < occupancy.length; i += 1) if (occupancy[i] === line) occupancy[i] = -1;
        continue;
      }
      lines.push(Object.freeze(path));
    }
  }
  return Object.freeze({ lines: Object.freeze(lines), terminatedAtReceipt });
}

export const buildVariantD4: VariantBuilder = (input: VariantInput): VariantLayout => {
  // BASE LAYOUT — D3's converged, lane-anchored positions, rebuilt here rather
  // than imported from another variant module, so D4 depends on nothing but the
  // canonical layer and cannot silently inherit another author's changes. The
  // field therefore describes the direction of causality inside the force
  // equilibrium; over a depth-swimlane base it would look calmer, because that
  // base has a global left-to-right axis this one does not.
  const { anchored, frame } = forceRuns(input);
  const at = anchored.positions;
  const field = buildField(input.graph, at, input.width, input.height);
  const { lines: streamlines, terminatedAtReceipt } = traceStreamlines(field, input.width, input.height, [...at.values()]);

  const ornaments: VariantOrnament[] = [];
  for (let row = 0; row < field.rows; row += 1) {
    for (let col = 0; col < field.cols; col += 1) {
      const index = row * field.cols + col;
      if (!field.covered[index]) continue;
      const weight = field.magnitude[index]!;
      if (weight < 0.04) continue;
      ornaments.push(Object.freeze({
        kind: "densityField" as const,
        x: r1(col * field.cellW),
        y: r1(row * field.cellH),
        width: r1(field.cellW),
        height: r1(field.cellH),
        weight: r4(weight),
      }));
    }
  }

  let streamlinePoints = 0;
  for (const line of streamlines) {
    streamlinePoints += line.length;
    const meanMagnitude = line.reduce((sum, point) => sum + point.magnitude, 0) / Math.max(1, line.length);
    ornaments.push(Object.freeze({
      kind: "streamline" as const,
      d: line.map((point, i) => `${i === 0 ? "M" : "L"} ${r1(point.x)} ${r1(point.y)}`).join(" "),
      weight: r4(meanMagnitude),
    }));
  }

  const cells = field.cols * field.rows;
  const xs = [...at.values()].map((p) => p.x);
  const ys = [...at.values()].map((p) => p.y);

  return Object.freeze({
    id: "D4",
    title: "Evidence flow field",
    axes: Object.freeze({
      x: "No units — the D3 force equilibrium, reused unchanged as the base layout",
      y: "No units — the D3 force equilibrium, with its weak pull toward the declared provenance lane",
    }),
    width: input.width,
    height: input.height,
    nodes: buildNodes(input.graph, at),
    edges: buildEdges(input.graph, at),
    ornaments: Object.freeze(ornaments),
    diagnostics: Object.freeze({
      baseLayout: "D3 converged force-directed positions (lane-anchored run), recomputed in this module rather than imported",
      gridColumns: field.cols,
      gridRows: field.rows,
      gridCells: cells,
      cellWidthPx: r2(field.cellW),
      cellHeightPx: r2(field.cellH),
      falloffKernel: "Gaussian on distance from cell centre to the edge segment",
      falloffSigmaPx: field.sigma,
      falloffRadiusPx: r2(field.cutoff),
      emptyCells: field.emptyCells,
      emptyCellFraction: r4(field.emptyCells / Math.max(1, cells)),
      measuredCells: cells - field.emptyCells,
      meanVectorMagnitude: r4(field.meanMagnitude),
      maxVectorMagnitude: r4(field.maxMagnitude),
      meanEdgesSampledPerMeasuredCell: r2(field.meanEdgesPerCoveredCell),
      streamlineCount: streamlines.length,
      streamlinePointsTotal: streamlinePoints,
      streamlineSeparationPx: STREAMLINE_SEPARATION_PX,
      streamlineStepPx: r2(Math.min(field.cellW, field.cellH) * 0.55),
      streamlineIntegrator: "RK2 midpoint, forward and backward from each seed",
      streamlineMinMagnitude: STREAMLINE_MIN_MAGNITUDE,
      receiptKeepOutPx: RECEIPT_KEEP_OUT_PX,
      streamlineWalksStoppedAtAReceipt: terminatedAtReceipt,
      densityFieldOrnaments: ornaments.length - streamlines.length,
      ornamentTotal: ornaments.length,
      nodes: input.graph.receipts.length,
      edges: input.graph.edges.length,
      forceIterations: anchored.iterations,
      forceEdgeCrossings: anchored.crossings,
      forceDisplacementFinalIteration: r4(anchored.finalDisplacement),
      xBounds: Object.freeze([r2(Math.min(...xs)), r2(Math.max(...xs))]),
      yBounds: Object.freeze([r2(Math.min(...ys)), r2(Math.max(...ys))]),
      frameInsetPx: Object.freeze([frame.left, frame.top]),
      randomNumberGeneratorCalls: 0,
    }),
    caveats: Object.freeze([
      "The Evidence Flow Field may visually evoke fluid dynamics, but it is not a Navier-Stokes simulation.",
      "The field is an ornament. It is not among the 79 edges, it carries no evidentiary weight, and no part of it may be read as a relation between two receipts.",
      `How to tell them apart without a legend: a canonical edge is a straight segment that begins exactly on its parent and ends exactly on its child. A streamline is a long curve that begins and ends nowhere in particular and carries no arrowhead. No streamline comes within ${RECEIPT_KEEP_OUT_PX}px of any receipt — a line that touches two receipts is therefore always an edge, never field, and that is enforced in the geometry rather than left to the ink.`,
      "A streamline sweeping past two receipts says nothing whatever about them. It reports the average direction of whichever declared edges happened to lie within the falloff radius, and those edges may belong to entirely unrelated parts of the graph.",
      `${field.emptyCells} of ${cells} grid cells (${(100 * field.emptyCells / Math.max(1, cells)).toFixed(1)}%) had no declared edge within the falloff radius. Those cells are left blank on purpose: the field is not extrapolated into regions nothing was measured in, and streamlines stop when they reach one.`,
      "Vector magnitude measures agreement, not throughput. 1.0 means every nearby declared edge points the same way; 0.0 means they cancel. It is not a rate, a volume, a speed, or a quantity of evidence.",
      "Direction is parent-to-child, aggregated over a neighbourhood. It is a summary of a region, never a statement about any individual pair of receipts in it.",
      "The base geometry is D3's, so every D3 caveat still applies here: proximity is not causality, and the positions are one force equilibrium among many.",
      "The reading ordinal (NR 01..NR 58) was not an input to the base layout, to the field, or to any streamline.",
    ]),
  });
};

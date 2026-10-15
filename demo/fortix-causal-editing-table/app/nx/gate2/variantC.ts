import type { CanonicalGraph, CanonicalReceipt } from "./canonicalGraph.ts";
import { graphMetrics } from "./graphMetrics.ts";
import { columnDeviations, columnMeans, covariance, project, standardize, symmetricEigen } from "./linalg.ts";
import type { VariantBuilder, VariantEdge, VariantLayout, VariantNode, VariantOrnament } from "./variantTypes.ts";

/**
 * D-006/NX GATE 2 — VARIANT C: STRUCTURAL PROJECTION (PCA).
 *
 * THE ONE SENTENCE THIS FILE EXISTS TO PROTECT:
 *
 *   SIMILARITY IS NOT CAUSALITY. Distance between two points in this projection
 *   means the two receipts have similar STRUCTURAL ATTRIBUTES. It says nothing
 *   about one causing the other.
 *
 * That rule is enforced structurally, not by good intentions. The projection
 * decides POSITION and nothing else; `edges` is built by walking
 * `graph.edges` — the declared relations — and looking each endpoint's position
 * up in a map. There is no code path in this module that can produce a line
 * from a distance, a neighbourhood, a cluster or a rank. Two receipts that land
 * on top of each other get no line; two receipts at opposite corners keep
 * theirs.
 *
 * WHAT THE POSITIONS ARE. A documented feature matrix of CANONICAL attributes
 * (see `structuralFeatureMatrix`), z-scored, then projected onto the first two
 * eigenvectors of its covariance. Nothing semantic is invented: every column is
 * either a one-hot indicator of a value the receipt itself declares, a metric
 * `graphMetrics` derives from the declared edges, or a normalised mission
 * position.
 *
 * THE ORDINAL (§3). It appears exactly once, as `mission.readingPosition`, a
 * normalised mission-position feature. It is never an input to an edge, and the
 * caveats say so in the variant's own words so a reader of the plot is told,
 * not left to trust the code.
 *
 * WHY THE PICTURE IS TANGLED. It is: this view sorts receipts by what they ARE,
 * so the causal spine gets folded across the plane and the 79 lines cross each
 * other many times. The crossing count is reported in `diagnostics` rather than
 * softened, because "PCA hides the causal structure" is the finding this variant
 * contributes to the comparison.
 */

/** How one column of the feature matrix was built — the audit trail for a score. */
export type FeatureEncoding = Readonly<{
  name: string;
  /** The canonical attribute or graph metric the column reads. */
  attribute: string;
  kind: "oneHot" | "graphMetric" | "missionPosition";
  /** For a one-hot column, the level it indicates. */
  level?: string;
  /** Anything a reader must know to interpret the column — imputation, scaling. */
  note?: string;
}>;

export type StructuralFeatureMatrix = Readonly<{
  /** One row per receipt, in `graph.receipts` order (the canonical reading order). */
  rows: readonly (readonly number[])[];
  featureNames: readonly string[];
  encoding: readonly FeatureEncoding[];
}>;

/**
 * The categorical attributes this variant is permitted to read, with the
 * accessor that reads each. `provenanceResolution` is in the mandate's
 * candidate list but is NOT carried on `CanonicalReceipt`, so it cannot be used
 * here; that omission is reported in diagnostics rather than worked around.
 *
 * `domain`, `source`, `eventType` and `eventId` are canonical too and are
 * deliberately left out: they are near-identifier attributes (18 and 12 levels
 * over 58 receipts) that would let a single receipt define its own axis.
 */
const CATEGORICAL_FEATURES: readonly Readonly<{ attribute: string; read: (receipt: CanonicalReceipt) => string }>[] = Object.freeze([
  { attribute: "lane", read: (receipt) => receipt.lane },
  { attribute: "actionFamily", read: (receipt) => receipt.actionFamily },
  { attribute: "episode", read: (receipt) => receipt.episode },
  { attribute: "standing", read: (receipt) => receipt.standing },
  { attribute: "assurance", read: (receipt) => receipt.assurance },
  { attribute: "evidenceLocality", read: (receipt) => receipt.evidenceLocality },
  { attribute: "family", read: (receipt) => receipt.family },
]);

const GRAPH_FEATURES = Object.freeze([
  "depth", "inDegree", "outDegree", "ancestorCount", "descendantCount", "distanceToFinal", "boundaryCrossings", "longestPathTo",
] as const);

/**
 * Levels of a categorical, in a deterministic order. Lanes follow the canonical
 * left-to-right order the graph declares; everything else is sorted, because
 * inventing an order for a value set would be inventing meaning. Only OBSERVED
 * levels get a column: a level nobody has would be an all-zero constant, and a
 * constant column cannot carry information.
 */
function levelsOf(values: readonly string[], canonicalOrder: readonly string[]): readonly string[] {
  const observed = new Set(values);
  const ranked = canonicalOrder.filter((value) => observed.has(value));
  const rest = [...observed].filter((value) => !ranked.includes(value)).sort();
  return Object.freeze([...ranked, ...rest]);
}

/**
 * THE FEATURE MATRIX, built from canonical attributes only and exported so the
 * technical note can print it. Three blocks, all declared:
 *
 *   `cat.*`     one-hot indicators of a value the receipt states about itself.
 *   `graph.*`   metrics `graphMetrics` derives from the declared edge set.
 *   `mission.*` where the receipt sits in the mission — reading position, time,
 *               and the engine's own admission order.
 *
 * Raw units are kept here on purpose. Scaling is a modelling decision made by
 * the builder, which reports how much its answer depends on that decision.
 */
export function structuralFeatureMatrix(graph: CanonicalGraph): StructuralFeatureMatrix {
  const metrics = graphMetrics(graph);
  const receipts = graph.receipts;

  const encoding: FeatureEncoding[] = [];
  const columns: ((receipt: CanonicalReceipt) => number)[] = [];

  for (const feature of CATEGORICAL_FEATURES) {
    const canonicalOrder = feature.attribute === "lane" ? graph.lanes : [];
    for (const level of levelsOf(receipts.map(feature.read), canonicalOrder)) {
      encoding.push({ name: `cat.${feature.attribute}=${level}`, attribute: feature.attribute, kind: "oneHot", level });
      columns.push((receipt) => (feature.read(receipt) === level ? 1 : 0));
    }
  }

  // `distanceToFinal` is null for a receipt no path reaches the Final Receipt
  // from. This mission has none, but the imputation is stated rather than
  // assumed: an unreachable receipt is one hop worse than the worst reachable
  // one, which is the honest ordinal reading of "further away than any of them".
  const finiteDistances = [...metrics.distanceToFinal.values()].filter((value): value is number => value !== null);
  const unreachableDistance = (finiteDistances.length === 0 ? 0 : Math.max(...finiteDistances)) + 1;

  for (const name of GRAPH_FEATURES) {
    if (name === "distanceToFinal") {
      encoding.push({
        name: "graph.distanceToFinal", attribute: "graphMetrics.distanceToFinal", kind: "graphMetric",
        note: `unreachable imputed as ${unreachableDistance} (worst reachable + 1)`,
      });
      columns.push((receipt) => metrics.distanceToFinal.get(receipt.evidenceId) ?? unreachableDistance);
      continue;
    }
    const table = metrics[name];
    encoding.push({ name: `graph.${name}`, attribute: `graphMetrics.${name}`, kind: "graphMetric" });
    columns.push((receipt) => table.get(receipt.evidenceId) ?? 0);
  }

  const ordinalSpan = Math.max(1, receipts.length - 1);
  const times = receipts.map((receipt) => receipt.timeMs);
  const timeMin = Math.min(...times);
  const timeSpan = Math.max(1, Math.max(...times) - timeMin);

  // §3: the ordinal enters HERE and only here, as a position along the mission.
  // It is a display handle, so it may describe where a receipt was read; it may
  // never explain why a receipt exists, and it reaches no edge in this module.
  encoding.push({
    name: "mission.readingPosition", attribute: "ordinal.index", kind: "missionPosition",
    note: "reading ordinal normalised to 0..1 — a mission-position feature, never a causal one",
  });
  columns.push((receipt) => (receipt.ordinal.index - 1) / ordinalSpan);

  encoding.push({
    name: "mission.timeMs", attribute: "timeMs", kind: "missionPosition",
    note: `normalised over the mission span ${timeMin}..${timeMin + timeSpan} ms`,
  });
  columns.push((receipt) => (receipt.timeMs - timeMin) / timeSpan);

  encoding.push({
    name: "mission.admissionIndex", attribute: "admissionIndex", kind: "missionPosition",
    note: "raw engine admission order, left unscaled so the sensitivity check has something to bite on",
  });
  columns.push((receipt) => receipt.admissionIndex);

  return Object.freeze({
    rows: Object.freeze(receipts.map((receipt) => Object.freeze(columns.map((read) => read(receipt))))),
    featureNames: Object.freeze(encoding.map((entry) => entry.name)),
    encoding: Object.freeze(encoding.map((entry) => Object.freeze(entry))),
  });
}

const rounded = (value: number, places = 6) => Number(value.toFixed(places));

/**
 * How far a lane hull's outline is pushed clear of the receipts it encloses, so
 * no ornament segment terminates on a bead centre (§8). Larger than the widest
 * bead the harness draws (6.2 px for a selected receipt), so the outline clears
 * the mark itself and not merely its centre.
 */
const HULL_PADDING_PX = 7;

/**
 * Spearman rank correlation. Used for one purpose: to REPORT, as a number, how
 * much of a projected axis is the reading ordinal (§3). Ties are impossible for
 * both series it is applied to — ordinals are distinct integers and projected
 * coordinates are continuous — so plain ranks are used rather than mid-ranks.
 */
function spearman(left: readonly number[], right: readonly number[]): number {
  const ranks = (values: readonly number[]) => {
    const out = new Array<number>(values.length).fill(0);
    values
      .map((value, index) => ({ value, index }))
      .sort((a, b) => a.value - b.value)
      .forEach((entry, rank) => { out[entry.index] = rank; });
    return out;
  };
  const a = ranks(left);
  const b = ranks(right);
  const mean = (a.length - 1) / 2;
  let covar = 0;
  let spreadA = 0;
  let spreadB = 0;
  for (let index = 0; index < a.length; index += 1) {
    covar += (a[index]! - mean) * (b[index]! - mean);
    spreadA += (a[index]! - mean) ** 2;
    spreadB += (b[index]! - mean) ** 2;
  }
  return spreadA === 0 || spreadB === 0 ? 0 : covar / Math.sqrt(spreadA * spreadB);
}

/** The features that move an axis most, largest absolute loading first. */
function topLoadings(vector: readonly number[], names: readonly string[], count: number): string {
  return vector
    .map((value, index) => ({ name: names[index] ?? `f${index}`, value }))
    .sort((left, right) => Math.abs(right.value) - Math.abs(left.value))
    .slice(0, count)
    .map((entry) => `${entry.name} ${entry.value >= 0 ? "+" : "−"}${Math.abs(entry.value).toFixed(3)}`)
    .join("; ");
}

type Point = Readonly<{ x: number; y: number }>;

/** Andrew's monotone chain. Returns [] for a degenerate set — no fake area. */
function convexHull(points: readonly Point[]): readonly Point[] {
  const sorted = [...points].sort((left, right) => left.x - right.x || left.y - right.y);
  const unique = sorted.filter((point, index) => index === 0 || point.x !== sorted[index - 1]!.x || point.y !== sorted[index - 1]!.y);
  if (unique.length < 3) return [];
  const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const chain = (input: readonly Point[]) => {
    const out: Point[] = [];
    for (const point of input) {
      while (out.length >= 2 && cross(out[out.length - 2]!, out[out.length - 1]!, point) <= 0) out.pop();
      out.push(point);
    }
    return out;
  };
  const lower = chain(unique);
  const upper = chain([...unique].reverse());
  const hull = [...lower.slice(0, -1), ...upper.slice(0, -1)];
  return hull.length >= 3 ? hull : [];
}

/** Do two open segments cross at an interior point? Touching does not count. */
function segmentsCross(a1: Point, a2: Point, b1: Point, b2: Point): boolean {
  const side = (p: Point, q: Point, r: Point) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  return side(a1, a2, b1) * side(a1, a2, b2) < 0 && side(b1, b2, a1) * side(b1, b2, a2) < 0;
}

export const buildVariantC: VariantBuilder = ({ graph, width, height }) => {
  const features = structuralFeatureMatrix(graph);

  // TWO KINDS OF COLUMN ARE REMOVED BEFORE THE DECOMPOSITION, and both are
  // named in diagnostics rather than quietly disappearing.
  //
  //   CONSTANT — carries no information, and standardised it is a row of zeros
  //   that adds a spurious zero eigenvalue to the spectrum.
  //
  //   EXACTLY DUPLICATED — a column identical to one already kept adds no
  //   information either, but it would count TWICE in the distance between two
  //   points, and distance is the only thing this variant claims. In this
  //   mission that is not hypothetical: three lanes and three families are the
  //   same 58-long indicator, and `graphMetrics` computes `depth` and
  //   `longestPathTo` by the same recurrence, so they are the same column.
  const rawMeans = columnMeans(features.rows);
  const rawDeviations = columnDeviations(features.rows, rawMeans);
  const constant = features.featureNames.filter((_, index) => rawDeviations[index] === 0);

  const keep: number[] = [];
  const duplicated: string[] = [];
  for (let index = 0; index < features.featureNames.length; index += 1) {
    if (rawDeviations[index] === 0) continue;
    const twin = keep.find((other) => features.rows.every((row) => row[other]! === row[index]!));
    if (twin === undefined) keep.push(index);
    else duplicated.push(`${features.featureNames[index]!} = ${features.featureNames[twin]!}`);
  }

  const names = keep.map((index) => features.featureNames[index]!);
  const kept = features.rows.map((row) => keep.map((index) => row[index]!));

  const { matrix, constantColumns } = standardize(kept);
  const eigen = symmetricEigen(covariance(matrix));
  const scores = project(matrix, eigen.vectors, 2);

  const totalVariance = eigen.values.reduce((sum, value) => sum + value, 0);
  const share = (index: number) => (totalVariance === 0 ? 0 : (eigen.values[index] ?? 0) / totalVariance);
  const varianceExplainedPC1 = share(0);
  const varianceExplainedPC2 = share(1);

  // SCALING SENSITIVITY. The same features, centred but NOT z-scored: whichever
  // column happens to have the largest raw units then dominates PC1. The gap
  // between the two answers is the size of the modelling decision.
  const keptMeans = columnMeans(kept);
  const centred = kept.map((row) => row.map((value, index) => value - keptMeans[index]!));
  const rawEigen = symmetricEigen(covariance(centred));
  const rawTotal = rawEigen.values.reduce((sum, value) => sum + value, 0);
  const varianceExplainedPC1Unstandardised = rawTotal === 0 ? 0 : (rawEigen.values[0] ?? 0) / rawTotal;
  const sensitivityToScaling = Math.abs(varianceExplainedPC1Unstandardised - varianceExplainedPC1);

  // One-hot groups sum to 1 within a group, so centring makes each group
  // linearly dependent by construction. The exactly-zero eigenvalues that
  // follow are a property of the encoding, not a numerical failure.
  const eigenTolerance = Math.max(1e-9, Math.abs(eigen.values[0] ?? 0) * 1e-9);
  const zeroEigenvalues = eigen.values.filter((value) => Math.abs(value) <= eigenTolerance).length;

  // ASPECT RATIO IS PRESERVED. One scale for both axes: stretching PC2 to fill
  // the viewport would make two receipts look further apart than the covariance
  // says they are, and the whole claim of this variant is about distance.
  const padding = 64;
  const pc1 = scores.map((score) => score[0] ?? 0);
  const pc2 = scores.map((score) => score[1] ?? 0);
  const bounds = (values: readonly number[]) => ({ min: Math.min(...values), max: Math.max(...values) });
  const xBounds = bounds(pc1);
  const yBounds = bounds(pc2);
  const spanX = Math.max(xBounds.max - xBounds.min, 1e-9);
  const spanY = Math.max(yBounds.max - yBounds.min, 1e-9);
  const scale = Math.min((width - 2 * padding) / spanX, (height - 2 * padding) / spanY);
  const midX = (xBounds.min + xBounds.max) / 2;
  const midY = (yBounds.min + yBounds.max) / 2;
  const toX = (score: number) => width / 2 + (score - midX) * scale;
  // PC2 increases upward, the convention every scatter plot reader already has.
  const toY = (score: number) => height / 2 - (score - midY) * scale;

  const nodes: readonly VariantNode[] = graph.receipts.map((receipt, index) => Object.freeze({
    evidenceId: receipt.evidenceId,
    x: toX(pc1[index] ?? 0),
    y: toY(pc2[index] ?? 0),
    lane: receipt.lane,
  }));

  const positionOf = new Map(nodes.map((node) => [node.evidenceId, node] as const));

  // EVERY LINE COMES FROM A DECLARED EDGE. The projection is consulted only for
  // where the two ends are, never for whether the line exists.
  const edges: readonly VariantEdge[] = graph.edges.map((edge) => {
    const from = positionOf.get(edge.parent)!;
    const to = positionOf.get(edge.child)!;
    return Object.freeze({
      parent: edge.parent,
      child: edge.child,
      kind: edge.kind,
      crossLane: edge.crossLane,
      d: `M ${from.x.toFixed(2)} ${from.y.toFixed(2)} L ${to.x.toFixed(2)} ${to.y.toFixed(2)}`,
      from: Object.freeze({ x: from.x, y: from.y }),
      to: Object.freeze({ x: to.x, y: to.y }),
    });
  });

  let crossings = 0;
  for (let i = 0; i < edges.length; i += 1) {
    const a = edges[i]!;
    for (let j = i + 1; j < edges.length; j += 1) {
      const b = edges[j]!;
      // Two edges meeting at a shared receipt are not a crossing; they are the
      // same receipt seen twice.
      if (a.parent === b.parent || a.parent === b.child || a.child === b.parent || a.child === b.child) continue;
      if (segmentsCross(a.from, a.to, b.from, b.to)) crossings += 1;
    }
  }

  let minimumSeparation = Number.POSITIVE_INFINITY;
  let coincidentPairs = 0;
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const distance = Math.hypot(nodes[i]!.x - nodes[j]!.x, nodes[i]!.y - nodes[j]!.y);
      minimumSeparation = Math.min(minimumSeparation, distance);
      if (distance < 0.5) coincidentPairs += 1;
    }
  }

  const ornaments: VariantOrnament[] = [];

  // Because the scale is uniform, the cloud fills only one axis of the
  // viewport. Reference marks follow the CLOUD, not the frame, so they do not
  // imply the plot extends into empty margin the data never reached.
  const plot = {
    left: Math.min(...nodes.map((node) => node.x)),
    right: Math.max(...nodes.map((node) => node.x)),
    top: Math.min(...nodes.map((node) => node.y)),
    bottom: Math.max(...nodes.map((node) => node.y)),
  };
  const margin = 24;

  // The origin of the standardised space: the average receipt. Non-evidentiary
  // — a reference mark, not a relation.
  const originX = toX(0);
  const originY = toY(0);
  if (originX >= plot.left && originX <= plot.right) {
    ornaments.push({ kind: "gridline", d: `M ${originX.toFixed(2)} ${(plot.top - margin).toFixed(2)} L ${originX.toFixed(2)} ${(plot.bottom + margin).toFixed(2)}`, weight: 0.35 });
  }
  if (originY >= plot.top && originY <= plot.bottom) {
    ornaments.push({ kind: "gridline", d: `M ${(plot.left - margin).toFixed(2)} ${originY.toFixed(2)} L ${(plot.right + margin).toFixed(2)} ${originY.toFixed(2)}`, weight: 0.35 });
  }

  // Lane hulls: a visual grouping of receipts that share a declared lane, so a
  // reader can see whether the projection separates provenance or blends it.
  // A hull is a shape drawn around points, never a boundary anything must obey.
  //
  // THE OUTLINE IS PUSHED OFF THE BEADS, and that is a semantic requirement, not
  // a nicety. A convex hull's vertices ARE receipt positions, so an unpadded
  // outline draws a segment whose two ends land exactly on two bead centres —
  // the precise shape of a relation, in a picture whose one rule is that only a
  // declared relation may look like one. Most of those segments join receipts
  // the evidence never related. Offsetting the outline outward keeps the
  // grouping the hull exists to show and removes the coincidence a glancing
  // reader could misread. It moves scenery only: node positions, edges and
  // every projection number are untouched by it.
  let closestHullVertexToReceipt = Number.POSITIVE_INFINITY;
  const inflate = (hull: readonly Point[]): readonly Point[] => {
    const cx = hull.reduce((sum, point) => sum + point.x, 0) / hull.length;
    const cy = hull.reduce((sum, point) => sum + point.y, 0) / hull.length;
    return hull.map((point) => {
      const reach = Math.hypot(point.x - cx, point.y - cy);
      if (reach === 0) return point;
      return {
        x: point.x + ((point.x - cx) / reach) * HULL_PADDING_PX,
        y: point.y + ((point.y - cy) / reach) * HULL_PADDING_PX,
      };
    });
  };

  for (const lane of graph.lanes) {
    const members = nodes.filter((node) => node.lane === lane);
    const hull = convexHull(members.map((node) => ({ x: node.x, y: node.y })));
    if (hull.length < 3) continue;
    const outline = inflate(hull);
    for (const vertex of outline) {
      for (const node of nodes) closestHullVertexToReceipt = Math.min(closestHullVertexToReceipt, Math.hypot(vertex.x - node.x, vertex.y - node.y));
    }
    ornaments.push({
      kind: "hull",
      lane,
      weight: members.length / Math.max(1, nodes.length),
      d: `${outline.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" ")} Z`,
    });
    ornaments.push({
      kind: "laneLabel",
      lane,
      label: lane,
      x: members.reduce((sum, node) => sum + node.x, 0) / members.length,
      y: members.reduce((sum, node) => sum + node.y, 0) / members.length,
    });
  }

  const readingOrdinals = graph.receipts.map((receipt) => receipt.ordinal.index);
  const ordinalCorrelationX = spearman(nodes.map((node) => node.x), readingOrdinals);
  const ordinalCorrelationY = spearman(nodes.map((node) => node.y), readingOrdinals);

  const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
  ornaments.push({
    kind: "axisLabel",
    x: (plot.left + plot.right) / 2,
    y: Math.min(height - 12, plot.bottom + padding / 2),
    label: `PC1 — ${percent(varianceExplainedPC1)} of standardised structural variance`,
  });
  ornaments.push({
    kind: "axisLabel",
    x: Math.max(12, plot.left - padding / 2),
    y: (plot.top + plot.bottom) / 2,
    label: `PC2 — ${percent(varianceExplainedPC2)}`,
  });

  const diagnostics: Record<string, number | string | readonly number[]> = {
    featureCount: names.length,
    featuresBuilt: features.featureNames.length,
    sampleCount: graph.receipts.length,
    eigenvalues: Object.freeze(eigen.values.map((value) => rounded(value))),
    varianceExplainedPC1: rounded(varianceExplainedPC1),
    varianceExplainedPC2: rounded(varianceExplainedPC2),
    cumulativeVariancePC1PC2: rounded(varianceExplainedPC1 + varianceExplainedPC2),
    constantColumnsDropped: constant.length,
    constantColumnsDroppedNames: constant.length === 0 ? "(none)" : constant.join("; "),
    constantColumnsRemainingAfterDrop: constantColumns.length,
    duplicateColumnsDropped: duplicated.length,
    duplicateColumnsDroppedNames: duplicated.length === 0 ? "(none)" : duplicated.join("; "),
    topLoadingsPC1: topLoadings(eigen.vectors[0] ?? [], names, 6),
    topLoadingsPC2: topLoadings(eigen.vectors[1] ?? [], names, 6),
    sensitivityToScaling: rounded(sensitivityToScaling),
    varianceExplainedPC1Unstandardised: rounded(varianceExplainedPC1Unstandardised),
    zeroEigenvalues,
    effectiveRank: names.length - zeroEigenvalues,
    edgeCount: edges.length,
    edgeCrossings: crossings,
    crossingsPerEdge: rounded(crossings / Math.max(1, edges.length), 3),
    laneHullsDrawn: ornaments.filter((ornament) => ornament.kind === "hull").length,
    hullPaddingPx: HULL_PADDING_PX,
    // §8 in a number: how close the nearest ornament vertex comes to a bead. It
    // must stay clear of the mark, or the outline starts looking like a thread.
    closestHullVertexToReceiptPx: Number.isFinite(closestHullVertexToReceipt) ? rounded(closestHullVertexToReceipt, 3) : -1,
    // §3 in a number. The ordinal is a legitimate mission-position FEATURE and
    // it reaches no edge — but a reader looks at an axis, not at a loading
    // table, so how much of that axis is the reading handle is stated outright.
    readingOrdinalRankCorrelationX: rounded(ordinalCorrelationX, 4),
    readingOrdinalRankCorrelationY: rounded(ordinalCorrelationY, 4),
    coincidentNodePairs: coincidentPairs,
    minimumNodeSeparationPx: rounded(minimumSeparation, 3),
    pixelsPerUnit: rounded(scale, 4),
    plotWidthPx: rounded(plot.right - plot.left, 2),
    plotHeightPx: rounded(plot.bottom - plot.top, 2),
    aspectRatioTreatment: "uniform scale on both axes — distances are not stretched",
    attributesUnavailable: "provenanceResolution (not carried on CanonicalReceipt)",
    attributesExcluded: "domain, source, eventType, eventId (near-identifier, 18/2/12/58 levels)",
    canonicalDigest: graph.digest,
  };

  const caveats: readonly string[] = Object.freeze([
    "SIMILARITY IS NOT CAUSALITY. Distance between two points in this projection means the two receipts have similar STRUCTURAL ATTRIBUTES. It says nothing about one causing the other.",
    `The ${edges.length} lines are the declared canonical edges and nothing else. Position never created a line, and two receipts sitting on the same spot are joined only if the evidence says so.`,
    "PC1 and PC2 have no business meaning. They are the two directions of largest variance in the feature set given; read topLoadingsPC1 and topLoadingsPC2 and decide for yourself what they describe.",
    `Two axes hold ${percent(varianceExplainedPC1 + varianceExplainedPC2)} of the standardised variance, so this is a shadow of a ${names.length}-dimensional space. Two points close on screen may be far apart in the features that were projected away.`,
    `${names.length} features over ${graph.receipts.length} receipts, and the one-hot groups are linearly dependent by construction — ${zeroEigenvalues} eigenvalues are zero, so the features really span ${names.length - zeroEigenvalues} dimensions. The axes are real; the percentages are optimistic for a sample this small.`,
    duplicated.length === 0
      ? "No two feature columns were identical."
      : `${duplicated.length} columns were dropped as exact duplicates of a column already kept (${duplicated.join("; ")}). Keeping them would have counted the same distinction twice in every distance. That lane and family coincide on three levels, and that depth and longestPathTo are the same recurrence, are facts about this mission and this metric set — read them as findings, not as tidying.`,
    `Scaling is a choice, not a fact: unstandardised, PC1 explains ${percent(varianceExplainedPC1Unstandardised)} instead of ${percent(varianceExplainedPC1)} (sensitivityToScaling ${rounded(sensitivityToScaling, 3)}). This plot z-scores, so a lane indicator counts as much as an ancestor count.`,
    `The reading ordinal enters only as mission.readingPosition, a normalised mission-position feature. It is a human handle, and it is never an input to any edge here. Be aware of the consequence, though: it lands among the largest PC1 loadings alongside timeMs, admissionIndex, depth and ancestorCount, so horizontal position ends up ranking ${rounded(Math.abs(ordinalCorrelationX), 3)} against reading order (vertical ${rounded(Math.abs(ordinalCorrelationY), 3)}). Left-to-right therefore LOOKS like the order you read the receipts in. It is not a causal axis, and no line in this picture was drawn because two receipts sit side by side.`,
    "Eigenvector sign is fixed by convention so the plot is reproducible. Left/right and up/down carry no meaning — a mirrored version of this picture would be equally correct.",
    `The cloud does not fill the frame: one scale serves both axes (${rounded(scale, 1)} px per unit), so the empty margin is honest. Stretching the plot to the full width would make PC1 differences look larger than the covariance says they are.`,
    `The ${crossings} line crossings are a property of this view, not a defect in the evidence. Ordering by what receipts ARE folds the causal spine across the plane; variant A's swimlanes untangle the same 79 edges.`,
    `Hulls and lane labels are ornaments: a shape drawn around receipts that share a lane. They assert no boundary, no membership rule and no relation. ${ornaments.filter((ornament) => ornament.kind === "hull").length} of the ${graph.lanes.length} lanes got one — a lane whose points are fewer than three, or collinear, has no area to draw and is left unhulled rather than given a fake one. Each outline is pushed ${HULL_PADDING_PX} px clear of the receipts it encloses so that no corner of it sits on a bead: a hull corner IS a receipt position, and an unpadded outline would draw a segment ending on two bead centres — the shape of a relation, mostly between receipts the evidence never related.`,
    "Standing and evidenceLocality were dropped as constant — every receipt in this sealed mission is CLOSURE and LOCAL. Their absence from the axes means they never varied, not that they do not matter.",
  ]);

  const layout: VariantLayout = Object.freeze({
    id: "C",
    title: "Structural projection (PCA)",
    axes: Object.freeze({
      x: `PC1 — ${percent(varianceExplainedPC1)} of standardised structural variance (a loading combination, not a business axis)`,
      y: `PC2 — ${percent(varianceExplainedPC2)}, increasing upward (a loading combination, not time)`,
    }),
    width,
    height,
    nodes: Object.freeze(nodes),
    edges: Object.freeze(edges),
    ornaments: Object.freeze(ornaments.map((ornament) => Object.freeze(ornament))),
    diagnostics: Object.freeze(diagnostics),
    caveats,
  });

  return layout;
};

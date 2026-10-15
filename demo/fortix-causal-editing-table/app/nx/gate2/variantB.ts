import type { CanonicalEdge, CanonicalReceipt } from "./canonicalGraph.ts";
import { graphMetrics, type GraphMetrics } from "./graphMetrics.ts";
import type { ProvenanceLane } from "../adapter/publicExperienceAdapter.ts";
import type {
  VariantBuilder,
  VariantEdge,
  VariantId,
  VariantInput,
  VariantLayout,
  VariantNode,
  VariantOrnament,
} from "./variantTypes.ts";

/**
 * D-006/NX GATE 2 — VARIANT B: HORIZONTAL CAUSAL SWIMLANES.
 *
 * The transpose of variant A. Mission progression runs LEFT TO RIGHT; each
 * provenance lane is a horizontal band, in canonical order top to bottom
 * (city, vehicle, mission, route, service, authority, bank). A receipt sits in
 * its own lane, always — the lane is the receipt's declared provenance, not a
 * layout choice — and the x axis is the only thing the two builders disagree
 * about:
 *
 *   B1  x = READING ORDER. The mandate's literal reading of B. Honest about
 *       what a viewer scrolled past, and structurally uninformative: it gives
 *       every receipt its own column, so two receipts that could have happened
 *       at once are drawn exactly as far apart as a cause and its effect.
 *
 *   B2  x = CAUSAL DEPTH (graphMetrics().depth — longest declared parent
 *       chain). Receipts at the same depth land in the SAME COLUMN, so genuine
 *       parallelism becomes visible. This is the one that answers "where is
 *       NR 31?": NR 30 and NR 31 are both depth 11 and both declare {NR 24,
 *       NR 27}, so B2 puts them in one column in two lanes — siblings, plainly,
 *       instead of the chain a single-file reading order implies.
 *
 * WHAT THIS FILE MAY NOT DO (§18). Every canonical receipt gets exactly one
 * node and every canonical edge gets exactly one thread carrying its declared
 * parent, child and kind. Nothing here draws a line because two beads are near
 * each other, share a column, or share a lane: adjacency in a swimlane is a
 * consequence of the layout, never a claim. The reading ordinal is a display
 * label everywhere and a COORDINATE in B1 only, which is what B1 is about; it
 * never creates or justifies a relation in either builder.
 *
 * A backward thread — child drawn left of parent — is never straightened away.
 * It is drawn as a raised return arc so it is identifiable at a glance, and
 * counted in diagnostics. (Both builders measure 0 on this graph: reading order
 * is a topological order, and a child's depth always exceeds its parent's. The
 * handling exists because a layout that silently "fixed" such a thread would be
 * lying about the evidence.)
 */

const PAD = Object.freeze({ top: 46, right: 46, bottom: 48, left: 118 });

/** The bead radius the harness draws. Separation rules are stated in these terms. */
const BEAD_RADIUS = 7;
const MIN_SEPARATION_X = 2.3 * BEAD_RADIUS;
const MIN_SEPARATION_Y = 2.3 * BEAD_RADIUS;

/** Sub-offset ladder inside a lane. Deterministic, symmetric, never random. */
const ROW_LADDER: readonly number[] = Object.freeze([0, 1, -1, 2, -2, 3, -3]);
const ROW_STEP_MIN = 11;
const ROW_STEP_MAX = 17;

/**
 * Gate 1 established that two threads leaving one bead with identical tangents
 * read as a single line. Every bead therefore opens a fan and each thread takes
 * its own slot: FAN_STEP_MAX radians apart, narrowing only if the bead has so
 * many threads that the total fan would exceed FAN_SPAN_MAX.
 */
const FAN_STEP_MAX = 0.22;
const FAN_SPAN_MAX = 1.05;

/** How far a thread leans toward its target at departure, before its fan slot. */
const LEAN = 0.45;
const LEAN_CAP = 0.85;

/**
 * A same-lane thread arches above the lane's spine, but only as high as it has
 * to: enough to clear the beads it passes over, and flat when it passes over
 * none. The arch is expressed as a TILT ON THE END TANGENTS rather than as a
 * displaced control point, because the tangent is what the fan reasons about:
 * bend the curve by moving a control point sideways and two threads can end up
 * leaving one bead along the same line again, which is the defect the fan
 * exists to prevent.
 */
const BEAD_CLEARANCE = 4;
const CLEARANCE_PER_EXTRA_BEAD = 2;
const MAX_BOW_ANGLE = 0.5;

/** A backward thread leaves straight up and drops in from above: an unmistakable return arc. */
const BACKWARD_LEAD_BASE = 40;
const BACKWARD_LEAD_RATE = 0.5;
const BACKWARD_LEAD_MAX = 200;

/** Cubic segments per thread when measuring length and testing crossings. */
const PATH_SAMPLES = 24;

/** An intersection this close to a shared bead is the bead, not a crossing. */
const SHARED_ENDPOINT_RADIUS = 3 * BEAD_RADIUS;

type Point = Readonly<{ x: number; y: number }>;

type Frame = Readonly<{
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  laneHeight: number;
  laneCentre: ReadonlyMap<ProvenanceLane, number>;
  /** How far a bead may stray from its lane centre and still read as inside its band. */
  laneInner: number;
}>;

type Seat = Readonly<{
  receipt: CanonicalReceipt;
  column: number;
  x: number;
  y: number;
  /** Signed distance from the lane centre line. 0 when the lane needed no spreading. */
  offset: number;
}>;

type Thread = Readonly<{
  edge: CanonicalEdge;
  from: Point;
  to: Point;
  d: string;
  samples: readonly Point[];
  length: number;
  backward: boolean;
}>;

/** What separates B1 from B2 — and nothing else does. */
type LaneSpec = Readonly<{
  id: VariantId;
  title: string;
  axes: Readonly<{ x: string; y: string }>;
  /** The only real difference between B1 and B2: what puts a receipt in a column. */
  columnOf: (receipt: CanonicalReceipt, metrics: GraphMetrics) => number;
  columnLabel: (column: number, occupant: CanonicalReceipt | undefined) => string;
  tickColumns: (maxColumn: number) => readonly number[];
  caveats: (measured: MeasuredShape) => readonly string[];
}>;

/** The numbers a caveat is allowed to speak about, measured rather than assumed. */
type MeasuredShape = Readonly<{
  maxColumnOccupancy: number;
  occupiedColumns: number;
  columnCount: number;
  longestSingleFileRun: number;
  laneOccupancy: readonly number[];
  columnPitch: number;
  backwardEdgeCount: number;
}>;

const round = (value: number) => Math.round(value * 100) / 100;
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/** Time, then the engine's admission order, then the identifier — the declared order, not the ordinal. */
const declaredOrder = (left: CanonicalReceipt, right: CanonicalReceipt) =>
  left.timeMs - right.timeMs
  || left.admissionIndex - right.admissionIndex
  || (left.evidenceId < right.evidenceId ? -1 : left.evidenceId > right.evidenceId ? 1 : 0);

function frameOf(width: number, height: number, lanes: readonly ProvenanceLane[]): Frame {
  const x0 = PAD.left;
  const x1 = Math.max(x0 + 1, width - PAD.right);
  const y0 = PAD.top;
  const y1 = Math.max(y0 + 1, height - PAD.bottom);
  const laneHeight = (y1 - y0) / Math.max(lanes.length, 1);
  return Object.freeze({
    x0,
    x1,
    y0,
    y1,
    laneHeight,
    laneCentre: new Map(lanes.map((lane, index) => [lane, y0 + (index + 0.5) * laneHeight] as const)),
    laneInner: laneHeight * 0.34,
  });
}

/**
 * Seat every receipt: x from its column, y from its lane centre plus the
 * smallest deterministic offset that keeps two beads readable as two.
 *
 * Pass 1 splits a column that several receipts of ONE lane share — B2's whole
 * point is that they stay in that column, so the spread is vertical and
 * symmetric about the lane's centre line. Pass 2 catches beads from
 * NEIGHBOURING columns that still touch, which happens when the canvas is
 * narrow; it walks left to right and steps a bead onto the next free row.
 * Neither pass moves a receipt out of its lane.
 */
function seatReceipts(
  receipts: readonly CanonicalReceipt[],
  lanes: readonly ProvenanceLane[],
  frame: Frame,
  columnOf: (receipt: CanonicalReceipt) => number,
  maxColumn: number,
): readonly Seat[] {
  const span = frame.x1 - frame.x0;
  const xOf = (column: number) => round(frame.x0 + (maxColumn <= 0 ? span / 2 : (column / maxColumn) * span));
  const bound = Math.max(0, frame.laneHeight * 0.44 - BEAD_RADIUS);
  const seats: Seat[] = [];

  for (const lane of lanes) {
    const centre = frame.laneCentre.get(lane) ?? (frame.y0 + frame.y1) / 2;
    const inLane = receipts
      .filter((receipt) => receipt.lane === lane)
      .sort((left, right) => columnOf(left) - columnOf(right) || declaredOrder(left, right));

    const cells = new Map<number, CanonicalReceipt[]>();
    for (const receipt of inLane) {
      const column = columnOf(receipt);
      cells.set(column, [...(cells.get(column) ?? []), receipt]);
    }
    const base = new Map<string, number>();
    for (const members of cells.values()) {
      const count = members.length;
      const step = count > 1
        ? clamp((2 * frame.laneInner) / (count - 1), ROW_STEP_MIN, ROW_STEP_MAX)
        : 0;
      members.forEach((receipt, index) => base.set(receipt.evidenceId, (index - (count - 1) / 2) * step));
    }

    const settled: Point[] = [];
    for (const receipt of inLane) {
      const x = xOf(columnOf(receipt));
      const start = base.get(receipt.evidenceId) ?? 0;
      let offset = start;
      for (const rung of ROW_LADDER) {
        offset = clamp(start + rung * ROW_STEP_MIN, -bound, bound);
        const clash = settled.some((seat) =>
          Math.abs(seat.x - x) < MIN_SEPARATION_X && Math.abs(seat.y - (centre + offset)) < MIN_SEPARATION_Y);
        if (!clash) break;
      }
      const y = round(centre + offset);
      settled.push({ x, y });
      seats.push(Object.freeze({ receipt, column: columnOf(receipt), x, y, offset: round(offset) }));
    }
  }
  return seats;
}

/** Pairs of beads in one lane that the ladder could not separate. Reported, not hidden. */
function unresolvedOverlaps(seats: readonly Seat[]): number {
  let count = 0;
  for (let i = 0; i < seats.length; i += 1) {
    for (let j = i + 1; j < seats.length; j += 1) {
      const a = seats[i]!;
      const b = seats[j]!;
      if (a.receipt.lane !== b.receipt.lane) continue;
      if (Math.abs(a.x - b.x) < MIN_SEPARATION_X && Math.abs(a.y - b.y) < MIN_SEPARATION_Y) count += 1;
    }
  }
  return count;
}

const bearing = (from: Point, to: Point) => Math.atan2(to.y - from.y, to.x - from.x);
const fanStep = (count: number) => (count > 1 ? Math.min(FAN_STEP_MAX, FAN_SPAN_MAX / (count - 1)) : 0);

/** The shape of one thread, from the two bead positions alone — before any fan. */
type Geometry = Readonly<{ lead: number; backward: boolean; bowAngle: number }>;

function geometryOf(from: Point, to: Point, crossLane: boolean, bowCap: number, beadsPassed: number): Geometry {
  const dx = to.x - from.x;
  const backward = dx <= 0;
  if (backward) {
    return {
      lead: clamp(BACKWARD_LEAD_BASE + BACKWARD_LEAD_RATE * Math.abs(dx), BACKWARD_LEAD_BASE, BACKWARD_LEAD_MAX),
      backward,
      bowAngle: 0,
    };
  }
  const lead = clamp(0.38 * Math.hypot(dx, to.y - from.y), 26, 150);
  const apex = crossLane || beadsPassed === 0
    ? 0
    : Math.max(0, Math.min(BEAD_RADIUS + BEAD_CLEARANCE + CLEARANCE_PER_EXTRA_BEAD * (beadsPassed - 1), bowCap));
  // A symmetric cubic reaches about three quarters of its control offset, so
  // this is the tangent tilt that lifts the arc's crown to `apex` pixels.
  return { lead, backward, bowAngle: Math.asin(clamp(apex / (0.75 * lead), 0, MAX_BOW_ANGLE)) };
}

/** One thread's claim on a bead: where it wants to point before the fan slots it. */
type Ray = Readonly<{ id: string; base: number }>;

/**
 * The tangent of every thread at one bead: where it wants to point, plus its
 * own slot in the bead's fan. Rays are slotted in ascending order of where they
 * want to point and slots ascend by a fixed step, so the tangents the harness
 * actually draws are at least one step apart — the fan is guaranteed by the
 * construction, not hoped for.
 *
 * Both fans speak in the DIRECTION OF TRAVEL along the thread — away from a
 * parent, into a child — so departure and arrival are the same kind of angle
 * and the lean clamp works in the half-plane where it means something.
 */
function fanAt(rays: readonly Ray[]): ReadonlyMap<string, number> {
  const ordered = [...rays].sort((left, right) => left.base - right.base || (left.id < right.id ? -1 : 1));
  const step = fanStep(ordered.length);
  return new Map(ordered.map((ray, index) => [ray.id, ray.base + (index - (ordered.length - 1) / 2) * step] as const));
}

/**
 * Where a thread wants to point at one of its ends: leaning toward the other
 * end, tilted up on departure and down on arrival by the same-lane arch. A
 * backward thread leaves straight up (-90°) and enters straight down (+90°), so
 * it can never be read as a forward one.
 */
function rayBase(theta: number, geometry: Geometry, end: "departure" | "arrival"): number {
  if (geometry.backward) return end === "departure" ? -Math.PI / 2 : Math.PI / 2;
  const tilt = end === "departure" ? -geometry.bowAngle : geometry.bowAngle;
  return clamp(LEAN * theta, -LEAN_CAP, LEAN_CAP) + tilt;
}

function cubicPoint(p0: Point, c1: Point, c2: Point, p1: Point, t: number): Point {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return { x: a * p0.x + b * c1.x + c * c2.x + d * p1.x, y: a * p0.y + b * c1.y + c * c2.y + d * p1.y };
}

/**
 * One thread, drawn entirely from its two end tangents: the curve leaves the
 * parent along `depart` and enters the child along `arrive`, so what the fan
 * decided is exactly what the harness renders. A same-lane thread's tangents
 * are tilted into a shallow upward arch, a cross-lane thread's into a smooth S
 * between the bands, and a backward thread's straight up and straight down into
 * a return arc above both ends.
 */
function threadOf(
  edge: CanonicalEdge,
  from: Point,
  to: Point,
  depart: number,
  arrive: number,
  geometry: Geometry,
): Thread {
  const { lead, backward } = geometry;
  const c1: Point = { x: from.x + lead * Math.cos(depart), y: from.y + lead * Math.sin(depart) };
  const c2: Point = { x: to.x - lead * Math.cos(arrive), y: to.y - lead * Math.sin(arrive) };

  const samples: Point[] = [];
  for (let i = 0; i <= PATH_SAMPLES; i += 1) samples.push(cubicPoint(from, c1, c2, to, i / PATH_SAMPLES));
  let length = 0;
  for (let i = 1; i < samples.length; i += 1) length += Math.hypot(samples[i]!.x - samples[i - 1]!.x, samples[i]!.y - samples[i - 1]!.y);

  return Object.freeze({
    edge,
    from,
    to,
    d: `M ${from.x} ${from.y} C ${round(c1.x)} ${round(c1.y)}, ${round(c2.x)} ${round(c2.y)}, ${to.x} ${to.y}`,
    samples: Object.freeze(samples),
    length,
    backward,
  });
}

/** Where two segments meet, or null. Proper intersection test, no estimate. */
function segmentCross(a1: Point, a2: Point, b1: Point, b2: Point): Point | null {
  const rx = a2.x - a1.x;
  const ry = a2.y - a1.y;
  const sx = b2.x - b1.x;
  const sy = b2.y - b1.y;
  const denom = rx * sy - ry * sx;
  if (Math.abs(denom) < 1e-12) return null;
  const qx = b1.x - a1.x;
  const qy = b1.y - a1.y;
  const t = (qx * sy - qy * sx) / denom;
  const u = (qx * ry - qy * rx) / denom;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: a1.x + t * rx, y: a1.y + t * ry };
}

type BoundingBox = Readonly<{ minX: number; maxX: number; minY: number; maxY: number }>;

function boxOf(points: readonly Point[]): BoundingBox {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }
  return { minX, maxX, minY, maxY };
}

const boxesOverlap = (a: BoundingBox, b: BoundingBox) =>
  a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;

/**
 * Crossings, counted rather than estimated: every thread is sampled into
 * PATH_SAMPLES straight segments and every pair of threads is tested segment by
 * segment. Two counts, because they mean different things:
 *
 *   disjoint  — threads with no bead in common that nevertheless cross. This is
 *               the headline legibility cost of the layout.
 *   adjacent  — threads that share a bead and cross somewhere ELSE. They meet
 *               at the bead by construction, so an intersection within
 *               SHARED_ENDPOINT_RADIUS of it is not counted.
 */
function countCrossings(threads: readonly Thread[]): Readonly<{ disjoint: number; adjacent: number }> {
  const boxes = threads.map((thread) => boxOf(thread.samples));
  let disjoint = 0;
  let adjacent = 0;

  for (let i = 0; i < threads.length; i += 1) {
    for (let j = i + 1; j < threads.length; j += 1) {
      const left = threads[i]!;
      const right = threads[j]!;
      if (!boxesOverlap(boxes[i]!, boxes[j]!)) continue;

      const shared: Point[] = [];
      if (left.edge.parent === right.edge.parent || left.edge.parent === right.edge.child) shared.push(left.from);
      if (left.edge.child === right.edge.parent || left.edge.child === right.edge.child) shared.push(left.to);

      let crossed = false;
      for (let a = 0; a < left.samples.length - 1 && !crossed; a += 1) {
        for (let b = 0; b < right.samples.length - 1; b += 1) {
          const hit = segmentCross(left.samples[a]!, left.samples[a + 1]!, right.samples[b]!, right.samples[b + 1]!);
          if (!hit) continue;
          if (shared.some((point) => Math.hypot(hit.x - point.x, hit.y - point.y) <= SHARED_ENDPOINT_RADIUS)) continue;
          crossed = true;
          break;
        }
      }
      if (!crossed) continue;
      if (shared.length > 0) adjacent += 1;
      else disjoint += 1;
    }
  }
  return Object.freeze({ disjoint, adjacent });
}

/** The narrowest angle between two threads leaving (or entering) one bead. Backs the fan claim. */
function narrowestFan(fans: readonly ReadonlyMap<string, number>[]): number {
  let narrowest = Infinity;
  for (const fan of fans) {
    const angles = [...fan.values()].sort((left, right) => left - right);
    for (let i = 1; i < angles.length; i += 1) narrowest = Math.min(narrowest, angles[i]! - angles[i - 1]!);
  }
  return Number.isFinite(narrowest) ? narrowest : 0;
}

function ornamentsOf(
  frame: Frame,
  lanes: readonly ProvenanceLane[],
  laneOccupancy: ReadonlyMap<ProvenanceLane, number>,
  height: number,
  ticks: readonly Readonly<{ x: number; label: string }>[],
  axes: Readonly<{ x: string; y: string }>,
): readonly VariantOrnament[] {
  const busiest = Math.max(1, ...[...laneOccupancy.values()]);
  const guides: VariantOrnament[] = lanes.map((lane, index) => Object.freeze({
    kind: "laneGuide" as const,
    x: round(frame.x0 - 20),
    y: round(frame.y0 + index * frame.laneHeight + 2),
    width: round(frame.x1 - frame.x0 + 40),
    height: round(frame.laneHeight - 4),
    lane,
    label: lane,
    weight: round((laneOccupancy.get(lane) ?? 0) / busiest),
  }));
  const labels: VariantOrnament[] = lanes.map((lane, index) => Object.freeze({
    kind: "laneLabel" as const,
    x: round(frame.x0 - 30),
    y: round(frame.y0 + (index + 0.5) * frame.laneHeight),
    lane,
    label: lane,
    weight: round((laneOccupancy.get(lane) ?? 0) / busiest),
  }));
  const gridlines: VariantOrnament[] = ticks.map((tick) => Object.freeze({
    kind: "gridline" as const,
    d: `M ${tick.x} ${round(frame.y0 - 6)} L ${tick.x} ${round(frame.y1 + 6)}`,
    x: tick.x,
    y: round(frame.y0 - 6),
    height: round(frame.y1 - frame.y0 + 12),
    weight: 0.3,
  }));
  const tickLabels: VariantOrnament[] = ticks.map((tick) => Object.freeze({
    kind: "axisLabel" as const,
    x: tick.x,
    y: round(frame.y0 - 16),
    label: tick.label,
    weight: 0.6,
  }));
  return Object.freeze([
    ...guides,
    ...gridlines,
    ...labels,
    ...tickLabels,
    Object.freeze({
      kind: "axisLabel" as const,
      x: round((frame.x0 + frame.x1) / 2),
      y: round(height - 16),
      label: axes.x,
      weight: 1,
    }),
    // The y axis names the column of lane labels, so it sits at their head
    // rather than rotated up the side: it reads correctly whether or not the
    // harness turns it, and it cannot collide with a lane name.
    Object.freeze({
      kind: "axisLabel" as const,
      x: round(frame.x0 - 30),
      y: round(frame.y0 - 32),
      // Short here on purpose: `axes.y` states the full meaning and the harness
      // displays it. This is the in-canvas heading, not a second statement of it.
      label: "provenance lane",
      weight: 1,
    }),
  ]);
}

const SHARED_CAVEATS: readonly string[] = Object.freeze([
  "Only the 79 drawn threads are relations. Two beads in one lane, one column or one neighbourhood are near each other because the layout put them there; nearness asserts nothing.",
  "Every lane is given the same band height whatever it carries, so a lane with two receipts wastes as much vertical room as the busiest lane uses. The swimlane trades density for a stable place to look.",
  "A same-lane thread arches upward only when beads of its own lane lie between its ends, and only high enough to clear them. The arch is a way past an obstacle, not a signal about the relation; a flat thread and an arched one say the same thing.",
  "A cross-lane thread is routed between two bands and may pass close to beads of the lanes it crosses. Passing near a bead is not touching it and asserts nothing about it.",
  "Lane order is the canonical provenance order, not a ranking. A lane drawn above another is not upstream of it.",
]);

function buildSwimlane(input: VariantInput, spec: LaneSpec): VariantLayout {
  const { graph, width, height } = input;
  const metrics = graphMetrics(graph);
  const lanes = graph.lanes;
  const frame = frameOf(width, height, lanes);

  const columnOf = (receipt: CanonicalReceipt) => spec.columnOf(receipt, metrics);
  const maxColumn = Math.max(0, ...graph.receipts.map(columnOf));
  const seats = seatReceipts(graph.receipts, lanes, frame, columnOf, maxColumn);
  const pointOf = new Map<string, Point>(seats.map((seat) => [seat.receipt.evidenceId, { x: seat.x, y: seat.y }] as const));
  const laneTop = new Map(lanes.map((lane, index) => [lane, frame.y0 + index * frame.laneHeight] as const));
  const laneOf = new Map(graph.receipts.map((receipt) => [receipt.evidenceId, receipt.lane] as const));

  // Each thread's shape is settled from the two bead positions first, because a
  // same-lane arch tilts the very tangents the fan then has to keep apart.
  type Pending = Readonly<{ edge: CanonicalEdge; from: Point; to: Point; geometry: Geometry; theta: number }>;
  const pending: Pending[] = graph.edges.map((edge) => {
    const from = pointOf.get(edge.parent);
    const to = pointOf.get(edge.child);
    // The canonical layer only emits an edge whose ends are both present, so a
    // missing seat would mean a receipt was dropped — refuse rather than draw
    // an incomplete graph.
    if (!from || !to) throw new Error(`variantB: canonical edge ${edge.parent}->${edge.child} has no seated endpoint`);
    // An arch may rise only to the top of the band it is drawn in, so no
    // same-lane thread ever wanders into a lane it does not belong to.
    const lane = laneOf.get(edge.parent);
    const top = (lane === undefined ? undefined : laneTop.get(lane)) ?? frame.y0;
    const bowCap = Math.min(Math.min(from.y, to.y) - top - BEAD_RADIUS - 2, frame.laneInner);
    // A same-lane thread arches only over what is in its way. Counting the beads
    // of its own lane that lie between its ends is what decides that; the beads
    // are not related to the thread, they are obstacles to it.
    const beadsPassed = edge.crossLane ? 0 : seats.filter((seat) =>
      seat.receipt.lane === lane && seat.x > from.x + 1 && seat.x < to.x - 1).length;
    return { edge, from, to, geometry: geometryOf(from, to, edge.crossLane, bowCap, beadsPassed), theta: bearing(from, to) };
  });

  const outgoing = new Map<string, Pending[]>();
  const incoming = new Map<string, Pending[]>();
  for (const thread of pending) {
    outgoing.set(thread.edge.parent, [...(outgoing.get(thread.edge.parent) ?? []), thread]);
    incoming.set(thread.edge.child, [...(incoming.get(thread.edge.child) ?? []), thread]);
  }
  const departureFans = new Map<string, ReadonlyMap<string, number>>();
  const arrivalFans = new Map<string, ReadonlyMap<string, number>>();
  for (const receipt of graph.receipts) {
    departureFans.set(receipt.evidenceId, fanAt((outgoing.get(receipt.evidenceId) ?? []).map((thread) => ({
      id: thread.edge.child,
      base: rayBase(thread.theta, thread.geometry, "departure"),
    }))));
    arrivalFans.set(receipt.evidenceId, fanAt((incoming.get(receipt.evidenceId) ?? []).map((thread) => ({
      id: thread.edge.parent,
      base: rayBase(thread.theta, thread.geometry, "arrival"),
    }))));
  }

  const threads: readonly Thread[] = pending.map((thread) => threadOf(
    thread.edge,
    thread.from,
    thread.to,
    departureFans.get(thread.edge.parent)?.get(thread.edge.child) ?? 0,
    arrivalFans.get(thread.edge.child)?.get(thread.edge.parent) ?? 0,
    thread.geometry,
  ));

  const nodes: readonly VariantNode[] = Object.freeze(
    [...seats]
      .sort((left, right) => left.receipt.ordinal.index - right.receipt.ordinal.index)
      .map((seat) => Object.freeze({
        evidenceId: seat.receipt.evidenceId,
        x: seat.x,
        y: seat.y,
        lane: seat.receipt.lane,
      })),
  );

  const edges: readonly VariantEdge[] = Object.freeze(threads.map((thread) => Object.freeze({
    parent: thread.edge.parent,
    child: thread.edge.child,
    kind: thread.edge.kind,
    crossLane: thread.edge.crossLane,
    d: thread.d,
    from: Object.freeze({ x: thread.from.x, y: thread.from.y }),
    to: Object.freeze({ x: thread.to.x, y: thread.to.y }),
  })));

  const occupancy = new Map<number, number>();
  const cellOccupancy = new Map<string, number>();
  const laneOccupancy = new Map<ProvenanceLane, number>();
  for (const seat of seats) {
    occupancy.set(seat.column, (occupancy.get(seat.column) ?? 0) + 1);
    const cell = `${seat.receipt.lane}@${seat.column}`;
    cellOccupancy.set(cell, (cellOccupancy.get(cell) ?? 0) + 1);
    laneOccupancy.set(seat.receipt.lane, (laneOccupancy.get(seat.receipt.lane) ?? 0) + 1);
  }

  let longestSingleFileRun = 0;
  let run = 0;
  for (let column = 0; column <= maxColumn; column += 1) {
    if (occupancy.get(column) === 1) {
      run += 1;
      longestSingleFileRun = Math.max(longestSingleFileRun, run);
    } else {
      run = 0;
    }
  }

  const crossings = countCrossings(threads);
  // How high the same-lane arches actually stand, so the "shallow arc" claim
  // rests on a measured range rather than on the constant that asked for it.
  const archApex = pending
    .filter((thread) => !thread.edge.crossLane && !thread.geometry.backward)
    .map((thread) => 0.75 * thread.geometry.lead * Math.sin(thread.geometry.bowAngle));
  const lengths = threads.map((thread) => thread.length);
  const spans = threads.map((thread) => Math.hypot(thread.to.x - thread.from.x, thread.to.y - thread.from.y));
  const backwardEdgeCount = threads.filter((thread) => thread.backward).length;
  const columnPitch = maxColumn > 0 ? (frame.x1 - frame.x0) / maxColumn : frame.x1 - frame.x0;

  const tickColumns = spec.tickColumns(maxColumn);
  const occupantOf = new Map<number, CanonicalReceipt>();
  for (const seat of [...seats].sort((left, right) => declaredOrder(left.receipt, right.receipt))) {
    if (!occupantOf.has(seat.column)) occupantOf.set(seat.column, seat.receipt);
  }
  const ticks = tickColumns.map((column) => ({
    x: round(frame.x0 + (maxColumn <= 0 ? 0 : (column / maxColumn) * (frame.x1 - frame.x0))),
    label: spec.columnLabel(column, occupantOf.get(column)),
  }));

  const measured: MeasuredShape = Object.freeze({
    maxColumnOccupancy: Math.max(0, ...[...occupancy.values()]),
    occupiedColumns: occupancy.size,
    columnCount: maxColumn + 1,
    longestSingleFileRun,
    laneOccupancy: Object.freeze(lanes.map((lane) => laneOccupancy.get(lane) ?? 0)),
    columnPitch: round(columnPitch),
    backwardEdgeCount,
  });

  const xs = nodes.map((node) => node.x);
  const ys = nodes.map((node) => node.y);

  return Object.freeze({
    id: spec.id,
    title: spec.title,
    axes: spec.axes,
    width,
    height,
    nodes,
    edges,
    ornaments: ornamentsOf(frame, lanes, laneOccupancy, height, ticks, spec.axes),
    diagnostics: Object.freeze({
      digest: graph.digest,
      nodeCount: nodes.length,
      edgeCount: edges.length,
      laneCount: lanes.length,
      laneOccupancy: measured.laneOccupancy,
      columnCount: measured.columnCount,
      occupiedColumns: measured.occupiedColumns,
      emptyColumns: measured.columnCount - measured.occupiedColumns,
      maxColumnOccupancy: measured.maxColumnOccupancy,
      maxLaneColumnOccupancy: Math.max(0, ...[...cellOccupancy.values()]),
      longestSingleFileRun,
      columnPitchPx: measured.columnPitch,
      laneHeightPx: round(frame.laneHeight),
      backwardEdgeCount,
      sameLaneEdgeCount: edges.filter((edge) => !edge.crossLane).length,
      crossLaneEdgeCount: edges.filter((edge) => edge.crossLane).length,
      edgeCrossingCount: crossings.disjoint,
      adjacentEdgeCrossingCount: crossings.adjacent,
      edgeCrossingCountAllPairs: crossings.disjoint + crossings.adjacent,
      crossingSampleSegmentsPerEdge: PATH_SAMPLES,
      sharedEndpointIgnoreRadiusPx: SHARED_ENDPOINT_RADIUS,
      meanEdgeLength: round(lengths.reduce((sum, value) => sum + value, 0) / Math.max(lengths.length, 1)),
      minEdgeLength: round(Math.min(...lengths)),
      maxEdgeLength: round(Math.max(...lengths)),
      meanEdgeSpan: round(spans.reduce((sum, value) => sum + value, 0) / Math.max(spans.length, 1)),
      offsetNodeCount: seats.filter((seat) => Math.abs(seat.offset) > 0.01).length,
      maxLaneOffsetPx: round(Math.max(0, ...seats.map((seat) => Math.abs(seat.offset)))),
      unresolvedOverlapPairs: unresolvedOverlaps(seats),
      sameLaneThreadsArched: archApex.filter((apex) => apex > 0.01).length,
      sameLaneArchApexPx: Object.freeze(archApex.length === 0
        ? [0, 0]
        : [round(Math.min(...archApex)), round(Math.max(...archApex))]),
      narrowestDepartureFanDegrees: round((narrowestFan([...departureFans.values()]) * 180) / Math.PI),
      narrowestArrivalFanDegrees: round((narrowestFan([...arrivalFans.values()]) * 180) / Math.PI),
      fanStepMaxDegrees: round((FAN_STEP_MAX * 180) / Math.PI),
      beadRadiusPx: BEAD_RADIUS,
      xMin: round(Math.min(...xs)),
      xMax: round(Math.max(...xs)),
      yMin: round(Math.min(...ys)),
      yMax: round(Math.max(...ys)),
    }),
    caveats: Object.freeze([...spec.caveats(measured), ...SHARED_CAVEATS]),
  });
}

/** B1 — x is the reading ordinal. The mandate's literal B, and the honest baseline. */
export const buildVariantB1: VariantBuilder = (input) => buildSwimlane(input, {
  id: "B1",
  title: "Horizontal swimlanes — reading order",
  axes: {
    x: "reading order (NR 01 → NR 58) — a human handle, not elapsed time",
    y: "provenance lane — one horizontal band each, canonical order top to bottom",
  },
  columnOf: (receipt) => receipt.ordinal.index - 1,
  columnLabel: (column, occupant) => occupant?.ordinal.label ?? `NR ${String(column + 1).padStart(2, "0")}`,
  tickColumns: (maxColumn) => Object.freeze([0, 9, 19, 29, 39, 49, maxColumn].filter((column, index, all) =>
    column >= 0 && column <= maxColumn && all.indexOf(column) === index)),
  caveats: (measured) => [
    `The ordinal is a reading handle, and here it is also the x coordinate — the one variant where that is the point. Equal spacing between columns says nothing about elapsed time or causal distance: ${measured.columnPitch}px separates every neighbouring pair alike.`,
    `Every column holds exactly one receipt (maximum occupancy ${measured.maxColumnOccupancy}), so parallelism is invisible: two receipts that could have happened at once are drawn as far apart as a cause and its effect. That is precisely the confusion B2 exists to expose.`,
    "Consecutive beads in one lane are consecutive in reading order and nothing else. A thread, not adjacency, is what says one caused the other.",
  ],
});

/** B2 — x is causal depth. Same column means same longest-parent-chain length. */
export const buildVariantB2: VariantBuilder = (input) => buildSwimlane(input, {
  id: "B2",
  title: "Horizontal swimlanes — causal depth",
  axes: {
    x: "causal depth (longest declared parent chain, 0 → 34)",
    y: "provenance lane — one horizontal band each, canonical order top to bottom",
  },
  columnOf: (receipt, metrics) => metrics.depth.get(receipt.evidenceId) ?? 0,
  columnLabel: (column) => String(column),
  tickColumns: (maxColumn) => Object.freeze([0, 5, 10, 15, 20, 25, 30, maxColumn].filter((column, index, all) =>
    column >= 0 && column <= maxColumn && all.indexOf(column) === index)),
  caveats: (measured) => [
    "A column is equal causal depth — the same number of declared steps from a root — not the same instant. Two receipts sharing a column may be minutes apart in evidence time; the axis measures structure, not the clock.",
    `Depth crowds at the start and thins to a queue: the busiest column holds ${measured.maxColumnOccupancy} receipts while ${measured.longestSingleFileRun} consecutive columns hold exactly one each, and across that stretch six of the seven lanes are empty. The swimlane pays full height for a single-file chain.`,
    "Receipts sharing a lane and a column are spread by a fixed deterministic sub-offset so no two beads occlude. That vertical nudge is spacing, never rank or sequence.",
    "Depth is derived from the declared edges only. A receipt drawn further right had a longer parent chain, which is not the same as mattering more.",
  ],
});

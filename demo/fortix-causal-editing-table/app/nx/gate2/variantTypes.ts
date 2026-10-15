import type { CanonicalEdge, CanonicalGraph } from "./canonicalGraph.ts";
import type { ProvenanceLane } from "../adapter/publicExperienceAdapter.ts";

/**
 * D-006/NX GATE 2 — THE SHAPE EVERY VARIANT RETURNS.
 *
 * A, B, C and D disagree about where a receipt belongs on screen. They must not
 * disagree about anything else, so they all return this one structure and the
 * comparison harness renders and measures them identically. A variant that
 * needed a different shape would be a variant that changed the facts.
 *
 * THE HARD RULE THIS TYPE ENCODES (§18):
 *
 *   `nodes`  — one per canonical receipt. Never fewer (no receipt may be
 *              dropped to improve a composition), never more (no synthetic
 *              point may be introduced).
 *   `edges`  — one per canonical edge, each carrying the canonical `parent`,
 *              `child` and `kind` it was built from. A variant cannot draw a
 *              line that has no canonical edge behind it, because there is
 *              nowhere in this type to put one.
 *
 * Decoration that is NOT a causal claim — a lane guide, a density wash, a flow
 * streamline — goes in `ornaments`, which the harness renders beneath the
 * evidence and which every test treats as non-evidentiary. Keeping it in a
 * separate field is the structural version of the mandate's rule that a
 * streamline must never be mistaken for a relation.
 */

export type VariantId = "A" | "B1" | "B2" | "C" | "D1" | "D2" | "D3" | "D4" | "D5";

export type VariantNode = Readonly<{
  evidenceId: string;
  x: number;
  y: number;
  /** Lane the receipt declares — carried so the harness can colour by provenance. */
  lane: ProvenanceLane;
}>;

export type VariantEdge = Readonly<{
  parent: string;
  child: string;
  kind: CanonicalEdge["kind"];
  crossLane: boolean;
  /** SVG path data. Must begin at the parent node and end at the child node. */
  d: string;
  from: Readonly<{ x: number; y: number }>;
  to: Readonly<{ x: number; y: number }>;
}>;

/**
 * A non-evidentiary graphic. `kind` says how the harness should render it and,
 * more importantly, tells a reader what it is NOT: nothing here asserts a
 * relation between two receipts.
 */
export type VariantOrnament = Readonly<{
  kind: "laneGuide" | "laneLabel" | "axisLabel" | "densityField" | "streamline" | "hull" | "gridline";
  d?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  label?: string;
  /** 0..1 — density, magnitude or confidence, for the harness to map to ink. */
  weight?: number;
  lane?: ProvenanceLane;
}>;

export type VariantLayout = Readonly<{
  id: VariantId;
  /** Short human name, e.g. "Horizontal causal swimlanes". */
  title: string;
  /** What the two axes actually mean. Displayed; a viewer must never guess. */
  axes: Readonly<{ x: string; y: string }>;
  width: number;
  height: number;
  nodes: readonly VariantNode[];
  edges: readonly VariantEdge[];
  ornaments: readonly VariantOrnament[];
  /**
   * Numbers the technical note must report: variance explained, eigenvalues,
   * kernel width, iteration count, and so on. Free-form because each method
   * has its own, but every one that a claim rests on must appear here.
   */
  diagnostics: Readonly<Record<string, number | string | readonly number[]>>;
  /**
   * Interpretation limits, in the variant's own words. For C and D this MUST
   * state that proximity is not causality (§6, §8, §9).
   */
  caveats: readonly string[];
}>;

export type VariantInput = Readonly<{
  graph: CanonicalGraph;
  width: number;
  height: number;
}>;

export type VariantBuilder = (input: VariantInput) => VariantLayout;

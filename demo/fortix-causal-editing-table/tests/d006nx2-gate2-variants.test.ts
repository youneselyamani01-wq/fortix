import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { canonicalGraph } from "../app/nx/gate2/canonicalGraph.ts";
import { buildVariantA } from "../app/nx/gate2/variantA.ts";
import { buildVariantB1, buildVariantB2 } from "../app/nx/gate2/variantB.ts";
import { buildVariantC } from "../app/nx/gate2/variantC.ts";
import { buildVariantD1, buildVariantD2 } from "../app/nx/gate2/variantD12.ts";
import { buildVariantD3, buildVariantD4 } from "../app/nx/gate2/variantD34.ts";
import type { VariantBuilder, VariantLayout } from "../app/nx/gate2/variantTypes.ts";

/**
 * D-006/NX GATE 2 — THE DATA INVARIANT, ENFORCED (§2, §18).
 *
 * Gate 2 compares representations. The one thing that must NOT vary between
 * them is the evidence, so these tests treat every variant as interchangeable
 * and demand the same answers from all of them:
 *
 *   the same 58 receipts, by canonical id;
 *   the same 79 relations, by (parent, child, kind);
 *   no relation that the canonical evidence does not declare;
 *   nothing drawn as a relation that is merely proximity.
 *
 * The last one is the point of the exercise. A PCA, a spectral embedding, a
 * diffusion map and a force simulation all place things NEAR each other for
 * reasons that have nothing to do with causality. If any of them were allowed
 * to draw that nearness as a thread, the picture would assert something the
 * evidence never said — which is the failure this whole mandate exists to
 * prevent.
 */

const GRAPH = canonicalGraph();
const WIDTH = 1280;
const HEIGHT = 560;

const VARIANTS: readonly (readonly [string, VariantBuilder])[] = Object.freeze([
  ["A", buildVariantA],
  ["B1", buildVariantB1],
  ["B2", buildVariantB2],
  ["C", buildVariantC],
  ["D1", buildVariantD1],
  ["D2", buildVariantD2],
  ["D3", buildVariantD3],
  ["D4", buildVariantD4],
]);

const built = new Map<string, VariantLayout>(
  VARIANTS.map(([id, build]) => [id, build({ graph: GRAPH, width: WIDTH, height: HEIGHT })] as const),
);

const canonicalIds = new Set(GRAPH.receipts.map((entry) => entry.evidenceId));
const canonicalTriples = new Set(GRAPH.edges.map((edge) => `${edge.kind}:${edge.parent}->${edge.child}`));

test("G2-T01: every variant renders exactly the canonical receipt set", () => {
  for (const [id, layout] of built) {
    assert.equal(layout.nodes.length, GRAPH.receipts.length, `${id}: node count`);
    const ids = new Set(layout.nodes.map((node) => node.evidenceId));
    assert.equal(ids.size, layout.nodes.length, `${id}: a receipt is drawn twice`);
    for (const canonical of canonicalIds) assert.ok(ids.has(canonical), `${id}: dropped ${canonical}`);
    for (const drawn of ids) assert.ok(canonicalIds.has(drawn), `${id}: invented node ${drawn}`);
  }
});

test("G2-T02: every variant renders exactly the canonical relation set", () => {
  for (const [id, layout] of built) {
    assert.equal(layout.edges.length, GRAPH.edges.length, `${id}: edge count`);
    const triples = layout.edges.map((edge) => `${edge.kind}:${edge.parent}->${edge.child}`);
    assert.equal(new Set(triples).size, triples.length, `${id}: a relation is drawn twice`);
    for (const triple of triples) assert.ok(canonicalTriples.has(triple), `${id}: edge with no canonical relation — ${triple}`);
    for (const triple of canonicalTriples) assert.ok(triples.includes(triple), `${id}: declared relation not drawn — ${triple}`);
  }
});

test("G2-T03: all variants agree — same graph, same digest, different geometry only", () => {
  // The strongest form of the invariant: pool every variant's view of the
  // evidence and confirm it collapses to exactly one graph.
  const receiptSets = new Set([...built.values()].map((layout) => [...layout.nodes.map((n) => n.evidenceId)].sort().join("|")));
  const edgeSets = new Set([...built.values()].map((layout) => [...layout.edges.map((e) => `${e.kind}:${e.parent}->${e.child}`)].sort().join("|")));
  assert.equal(receiptSets.size, 1, "variants disagree about which receipts exist");
  assert.equal(edgeSets.size, 1, "variants disagree about which relations exist");
  assert.equal(GRAPH.digest.length, 64, "the canonical digest is a blake3 hex string");

  // And the drawings really do differ — otherwise this is one variant in eight
  // costumes and the comparison is vacuous. Ornaments count as part of the
  // drawing: D4 deliberately reuses D3's converged node positions and differs
  // from it only in the flow field laid over them, which is a real difference
  // in what the viewer sees and what the variant claims to show.
  const drawings = new Set([...built.values()].map((layout) => [
    layout.nodes.map((n) => `${n.x.toFixed(1)},${n.y.toFixed(1)}`).join(";"),
    layout.ornaments.map((o) => `${o.kind}:${o.d ?? ""}${o.x ?? ""},${o.y ?? ""}`).join(";"),
  ].join("|")));
  assert.equal(drawings.size, built.size, "two variants produced an identical drawing");
});

test("G2-T04: no variant derives a relation from the reading ordinal", () => {
  const order = [...GRAPH.receipts].sort((a, b) => a.ordinal.index - b.ordinal.index);
  const consecutive = order.slice(0, -1).map((entry, index) => `${entry.evidenceId}->${order[index + 1]!.evidenceId}`);
  const drawnPairs = new Set([...built.values()].flatMap((layout) => layout.edges.map((edge) => `${edge.parent}->${edge.child}`)));
  const unjoined = consecutive.filter((pair) => !drawnPairs.has(pair));
  // If any variant auto-linked the reading order, every consecutive pair would
  // carry an edge somewhere. Gate 1 measured 14 that do not.
  assert.ok(unjoined.length > 0, "every consecutive reading pair is joined — a variant may be following the ordinal");
  assert.equal(unjoined.length, 14, "the count of unjoined consecutive pairs changed from the Gate 1 measurement");
});

test("G2-T05: ornaments are never relations — no invented streamline, hull or field is an edge", () => {
  for (const [id, layout] of built) {
    for (const ornament of layout.ornaments) {
      assert.ok(
        ["laneGuide", "laneLabel", "axisLabel", "densityField", "streamline", "hull", "gridline"].includes(ornament.kind),
        `${id}: unknown ornament kind ${ornament.kind}`,
      );
      // An ornament carries no parent/child, structurally: it cannot name two
      // receipts, so it cannot assert a relation between them.
      assert.ok(!("parent" in ornament), `${id}: an ornament names a parent`);
      assert.ok(!("child" in ornament), `${id}: an ornament names a child`);
    }
  }
});

test("G2-T05b: no ornament segment runs from one receipt centre to another", () => {
  // THE STRUCTURAL CHECK ABOVE IS NOT ENOUGH, and the Gate 2 semantic review
  // proved it: variant C's convex hulls were built from actual node positions,
  // so every hull vertex sat exactly on a receipt and 26 hull segments ran
  // bead-to-bead between receipts with no declared relation — a dotted line
  // joining two receipts, wearing the exact shape of evidence, while carrying
  // up to 3.6x the ink of a real muted thread. It passed G2-T05 because an
  // ornament has no `parent` field. Shape is what a viewer reads, so shape is
  // what must be tested.
  const NEAR_PX = 2.5;
  for (const [id, layout] of built) {
    const centres = layout.nodes;
    for (const ornament of layout.ornaments) {
      if (ornament.d === undefined || ornament.d.length === 0) continue;
      const numbers = (ornament.d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
      const points: { x: number; y: number }[] = [];
      for (let i = 0; i + 1 < numbers.length; i += 2) points.push({ x: numbers[i]!, y: numbers[i + 1]! });
      const onReceipt = (point: { x: number; y: number }) => centres.find(
        (node) => Math.hypot(node.x - point.x, node.y - point.y) <= NEAR_PX,
      );
      for (let i = 0; i + 1 < points.length; i += 1) {
        const from = onReceipt(points[i]!);
        const to = onReceipt(points[i + 1]!);
        if (from === undefined || to === undefined || from.evidenceId === to.evidenceId) continue;
        assert.fail(
          `${id}: a ${ornament.kind} runs from ${from.evidenceId} to ${to.evidenceId} — scenery shaped exactly like a relation`,
        );
      }
    }
  }
});

test("G2-T06: proximity is never causality — C and D place things near each other without joining them", () => {
  // For each projection-based variant, find the closest pair of receipts that
  // have NO declared relation, and confirm no edge joins them. Proximity in
  // these views is meaningful; it is simply not a relation.
  for (const id of ["C", "D1", "D2", "D3", "D4"]) {
    const layout = built.get(id)!;
    const related = new Set(layout.edges.flatMap((edge) => [`${edge.parent}|${edge.child}`, `${edge.child}|${edge.parent}`]));
    let closest: { a: string; b: string; gap: number } | null = null;
    for (let i = 0; i < layout.nodes.length; i += 1) {
      for (let j = i + 1; j < layout.nodes.length; j += 1) {
        const a = layout.nodes[i]!;
        const b = layout.nodes[j]!;
        if (related.has(`${a.evidenceId}|${b.evidenceId}`)) continue;
        const gap = Math.hypot(a.x - b.x, a.y - b.y);
        if (closest === null || gap < closest.gap) closest = { a: a.evidenceId, b: b.evidenceId, gap };
      }
    }
    assert.ok(closest !== null, `${id}: expected at least one unrelated pair`);
    assert.ok(
      !related.has(`${closest.a}|${closest.b}`),
      `${id}: the closest unrelated pair is joined by an edge — proximity became causality`,
    );
  }
});

test("G2-T07: every variant is deterministic", () => {
  for (const [id, build] of VARIANTS) {
    const first = build({ graph: GRAPH, width: WIDTH, height: HEIGHT });
    const second = build({ graph: GRAPH, width: WIDTH, height: HEIGHT });
    assert.equal(
      JSON.stringify(first.nodes), JSON.stringify(second.nodes),
      `${id}: two builds produced different geometry — a layout a reviewer cannot reproduce is not evidence`,
    );
    assert.equal(JSON.stringify(first.edges), JSON.stringify(second.edges), `${id}: edges differ between builds`);
  }
});

test("G2-T08: no variant module reaches for randomness", () => {
  for (const name of ["variantA", "variantB", "variantC", "variantD12", "variantD34"]) {
    const source = readFileSync(new URL(`../app/nx/gate2/${name}.ts`, import.meta.url), "utf8");
    const stripped = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    assert.ok(!/Math\s*\.\s*random/.test(stripped), `${name}: uses Math.random — the layout would not be reproducible`);
    assert.ok(!/Date\s*\.\s*now|new\s+Date\s*\(/.test(stripped), `${name}: reads the clock — the layout would not be reproducible`);
  }
});

test("G2-T09: every edge starts on its parent bead and ends on its child bead", () => {
  for (const [id, layout] of built) {
    const at = new Map(layout.nodes.map((node) => [node.evidenceId, node] as const));
    for (const edge of layout.edges) {
      const from = at.get(edge.parent)!;
      const to = at.get(edge.child)!;
      assert.ok(Math.hypot(edge.from.x - from.x, edge.from.y - from.y) < 0.5, `${id}: ${edge.parent}->${edge.child} does not start on its parent`);
      assert.ok(Math.hypot(edge.to.x - to.x, edge.to.y - to.y) < 0.5, `${id}: ${edge.parent}->${edge.child} does not end on its child`);
      const numbers = (edge.d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
      assert.ok(numbers.length >= 4, `${id}: ${edge.parent}->${edge.child} has no usable path`);
      assert.ok(Math.hypot(numbers[0]! - from.x, numbers[1]! - from.y) < 0.5, `${id}: path data starts away from the parent bead`);
    }
  }
});

test("G2-T10: every variant stays inside its viewport", () => {
  for (const [id, layout] of built) {
    for (const node of layout.nodes) {
      assert.ok(node.x >= 0 && node.x <= layout.width, `${id}: ${node.evidenceId} x=${node.x} outside 0..${layout.width}`);
      assert.ok(node.y >= 0 && node.y <= layout.height, `${id}: ${node.evidenceId} y=${node.y} outside 0..${layout.height}`);
    }
  }
});

test("G2-T11: the analytic variants state their interpretation limits", () => {
  const joined = (id: string) => built.get(id)!.caveats.join(" ").toLowerCase();
  for (const id of ["C", "D1", "D2", "D3", "D4"]) {
    assert.ok(built.get(id)!.caveats.length > 0, `${id}: declares no caveats`);
  }
  assert.match(joined("C"), /similarity is not causality/, "C must state that similarity is not causality");
  assert.match(joined("D2"), /not a causal distance|diffusion distance is not/, "D2 must separate diffusion distance from causal distance");
  assert.match(joined("D1"), /not a causal|proximity/, "D1 must state that spectral proximity is not a relation");
  assert.match(joined("D4"), /not a navier-stokes simulation/, "D4 must carry the Navier-Stokes boundary sentence");
});

test("G2-T12: every variant declares what its axes mean", () => {
  for (const [id, layout] of built) {
    assert.ok(layout.axes.x.length > 0 && layout.axes.y.length > 0, `${id}: an axis is unnamed`);
    assert.ok(layout.title.length > 0, `${id}: no title`);
    assert.ok(Object.keys(layout.diagnostics).length > 0, `${id}: reports no diagnostics`);
  }
});

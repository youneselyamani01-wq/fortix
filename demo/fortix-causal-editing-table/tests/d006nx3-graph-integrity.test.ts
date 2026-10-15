import assert from "node:assert/strict";
import test from "node:test";

import { causalLevels, relationsOf } from "../app/nx/evidence/proofGeometry.ts";
import { layoutProofB2 } from "../app/nx/evidence/proofGeometryB2.ts";
import { canonicalGraph } from "../app/nx/gate2/canonicalGraph.ts";

/**
 * D-006/NX3 — GRAPH INTEGRITY, the questions Gate 2 left open, held as
 * executable evidence (artifacts/d006-nx3/GRAPH_INTEGRITY_DISPOSITION.md):
 *
 *   1. connectivity — the canonical graph has exactly two components, and
 *      the second is the signalStop chapter, root NR 06, joined to nothing
 *      by any declared relation and to nothing by the drawing;
 *   2. edge integrity — 79 relations, each declared once, under one kind,
 *      no self-loop, no relation running backwards in time, and every
 *      parent that is absent is a support member the closure does not
 *      present, never a missing receipt;
 *   3. geometry follows `causal_parents`, never the reading number — the two
 *      orders agree only as far as a causal story must, and disagree where
 *      it matters.
 */

const graph = canonicalGraph();
const items = graph.receipts.map((r) => ({ evidenceId: r.evidenceId, branch: r.lane, causalParents: r.causalParents, observedInputs: r.observedInputs, standing: r.standing, timeMs: r.timeMs, admissionIndex: r.admissionIndex, episode: r.episode }));
const byId = new Map(graph.receipts.map((r) => [r.evidenceId, r] as const));

function components(edges: readonly Readonly<{ parent: string; child: string }>[]): readonly (readonly string[])[] {
  const parent = new Map(graph.receipts.map((r) => [r.evidenceId, r.evidenceId] as const));
  const find = (id: string): string => { const p = parent.get(id)!; if (p === id) return id; const root = find(p); parent.set(id, root); return root; };
  for (const edge of edges) if (parent.has(edge.parent) && parent.has(edge.child)) parent.set(find(edge.parent), find(edge.child));
  const groups = new Map<string, string[]>();
  for (const r of graph.receipts) groups.set(find(r.evidenceId), [...(groups.get(find(r.evidenceId)) ?? []), r.evidenceId]);
  return [...groups.values()].sort((a, b) => b.length - a.length);
}

test("GI-01: two components, 45 + 13 — the signalStop chapter is its own causal story, and nothing joins it", () => {
  const parts = components(graph.edges);
  assert.deepEqual(parts.map((part) => part.length), [45, 13]);
  const small = parts[1]!;
  assert.ok(small.every((id) => byId.get(id)!.episode === "signalStop"), "the thirteen are the signalStop chapter");
  assert.equal(graph.receipts.filter((r) => r.episode === "signalStop").length, 13, "…and all of it");
  const roots = small.filter((id) => byId.get(id)!.causalParents.length === 0 && byId.get(id)!.observedInputs.length === 0);
  assert.deepEqual(roots.map((id) => byId.get(id)!.ordinal.label), ["NR 06"]);
  assert.equal(parts[0]!.filter((id) => byId.get(id)!.causalParents.length === 0 && byId.get(id)!.observedInputs.length === 0).map((id) => byId.get(id)!.ordinal.label).join(), "NR 01");
  // No declared relation, of either kind, crosses the boundary.
  const inSmall = new Set(small);
  assert.equal(graph.edges.filter((edge) => inSmall.has(edge.parent) !== inSmall.has(edge.child)).length, 0);
  // The drawing adds none: the production layout's threads leave the same two components.
  const layout = layoutProofB2({ items, branches: graph.lanes, finalReceipt: true, widthPx: 1440, heightPx: 900 });
  assert.deepEqual(components(layout.threads).map((part) => part.length), [45, 13]);
  // Both components feed the Final Receipt; the two quarantined receipts, both in the large one, do not.
  assert.equal(small.filter((id) => graph.finalReceipt.causalInputEvidenceIds.includes(id)).length, 13);
  assert.equal(parts[0]!.filter((id) => graph.finalReceipt.causalInputEvidenceIds.includes(id)).length, 43);
  assert.equal(graph.finalReceipt.causalInputEvidenceIds.length, 56);
});

test("GI-02: 79 relations, each declared once under one kind; no self-loop; none runs backwards; the two absent parents are support members, not missing receipts", () => {
  const keys = graph.edges.map((edge) => `${edge.kind}:${edge.parent}->${edge.child}`);
  assert.equal(new Set(keys).size, 79);
  assert.equal(graph.edges.filter((edge) => edge.kind === "cause").length, 73);
  assert.equal(graph.edges.filter((edge) => edge.kind === "observed").length, 6);
  const pairs = new Map<string, Set<string>>();
  for (const edge of graph.edges) pairs.set(`${edge.parent}->${edge.child}`, new Set([...(pairs.get(`${edge.parent}->${edge.child}`) ?? []), edge.kind]));
  assert.equal([...pairs.values()].filter((kinds) => kinds.size > 1).length, 0, "no pair is both a cause and an observed input");
  for (const r of graph.receipts) {
    for (const list of [r.causalParents, r.observedInputs]) {
      assert.equal(new Set(list).size, list.length, `${r.ordinal.label} lists no parent twice`);
      assert.ok(!list.includes(r.evidenceId), `${r.ordinal.label} is not its own parent`);
    }
  }
  for (const edge of graph.edges) assert.ok(byId.get(edge.parent)!.timeMs <= byId.get(edge.child)!.timeMs, `${edge.parent} -> ${edge.child} does not run backwards`);
  // Parents named by a receipt but absent from the presented set: exactly the
  // two declared relations to ASSURANCE_SUPPORT members (EVIDENCE_SANITY_PHASE0:
  // 107 relations in the closure, 79 among presented receipts). They are not
  // drawn — a thread needs both ends — and never invented.
  const absent = graph.receipts.flatMap((r) => [...r.causalParents, ...r.observedInputs].filter((id) => !byId.has(id)).map((id) => `${r.ordinal.label}->${id}`));
  assert.equal(absent.length, 2, `absent parents: ${absent.join(", ")}`);
  assert.deepEqual(absent.map((entry) => entry.split("->")[0]), ["NR 41", "NR 53"]);
  const relations = relationsOf(items);
  assert.equal(relations.length, 79, "relationsOf draws the 79 present-ended relations and no other");
  assert.deepEqual([...relations.map((rel) => `${rel.kind}:${rel.parent}->${rel.child}`)].sort(), [...keys].sort());
});

test("GI-03: the geometry follows causal depth, and causal depth is not the reading number", () => {
  const depth = causalLevels(items);
  const rows = graph.receipts.map((r) => ({ nr: r.ordinal.index, depth: depth.get(r.evidenceId) ?? 0 }));
  // Correlated, as the reading of a causal story must be; not the same order.
  const disagreements = rows.flatMap((a) => rows.filter((b) => a.nr < b.nr && a.depth > b.depth));
  assert.ok(disagreements.length >= 30, `pairs where reading order and causal depth disagree: ${disagreements.length}`);
  const shared = new Map<number, number>();
  for (const row of rows) shared.set(row.depth, (shared.get(row.depth) ?? 0) + 1);
  assert.ok([...shared.values()].filter((count) => count > 1).length >= 15, "many depths are shared by several receipts — a column is a causal position, never a number");
  // The production geometry places by depth alone: same depth, same column; and never reads the ordinal.
  const layout = layoutProofB2({ items, branches: graph.lanes, finalReceipt: true, widthPx: 1440, heightPx: 900 });
  const at = new Map(layout.beads.map((bead) => [bead.evidenceId, bead] as const));
  for (const r of graph.receipts) assert.equal(at.get(r.evidenceId)!.row, depth.get(r.evidenceId), `${r.ordinal.label} stands at its causal depth`);
  const permuted = items.map((entry, index) => ({ ...entry, evidenceId: entry.evidenceId, ordinal: { index: items.length - index } }));
  const again = layoutProofB2({ items: permuted, branches: graph.lanes, finalReceipt: true, widthPx: 1440, heightPx: 900 });
  assert.deepEqual(again.beads.map((bead) => [bead.evidenceId, bead.x, bead.y]), layout.beads.map((bead) => [bead.evidenceId, bead.x, bead.y]), "an ordinal the geometry cannot see changes nothing");
});

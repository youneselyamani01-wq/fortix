import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  projectCausalEdges,
  projectProofLeaves,
  signedProofLeaves,
  type ProofLeaf,
} from "../app/proofProjection.ts";

/**
 * D-006G P3-C — the Proof Tree as a readable CAUSAL GRAPH.
 *
 * P2R made every LEAF answerable. This is the same question one layer down:
 * what does a LINE between two leaves mean, and who said so?
 *
 * THE DEFECT FOUND HERE. The historical D-005 leaves took their causal parents
 * from `data/d005-operational-cycle.json` — a presentation model, not evidence
 * — which declares them in a short-id vocabulary of its own
 * (`causal_parent_ids: ["passenger-request"]`). Those strings are not evidence
 * identities, so twenty of the thirty-six leaves had no drawable causality at
 * all; and had they resolved, the tree would have drawn lines that a design
 * file asserted. The signed objects declare the relation themselves, by
 * evidence identity, in `causal_links.predecessor_evidence_id`. That is now the
 * only source, and the count of drawable edges went from 26 to 47 as a result
 * — the graph got MORE complete by getting stricter about provenance.
 *
 * THE RULE. A line means one evidence object NAMES another as its parent.
 * Never that two things happened near each other; never that a design file
 * grouped them.
 */

const IDENTITY = /^fortix:evidence:blake3:[0-9a-f]{64}$/;
const projection = readFileSync(new URL("../app/proofProjection.ts", import.meta.url), "utf8");
const component = readFileSync(new URL("../app/ConvergenceExperience.tsx", import.meta.url), "utf8");

/**
 * Prose names the thing it forbids, so a ban on a string has to be checked
 * against CODE. Matching the whole file would let a comment fail the test that
 * the comment exists to explain.
 */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function leaves(): readonly ProofLeaf[] {
  return signedProofLeaves();
}

// --- provenance: who declared this line? --------------------------------

test("P3-C: every causal parent is an evidence identity, never a design-file id", () => {
  for (const leaf of leaves()) {
    for (const parent of leaf.causalParents) {
      assert.match(parent, IDENTITY, `${leaf.leafId} names a parent that is not an evidence identity`);
    }
  }
});

test("P3-C: the unsigned presentation model is not a source of causality", () => {
  // The short-id vocabulary lives only in the operational-cycle model. This
  // module must not read it — importing it would reopen the exact defect.
  assert.doesNotMatch(code(projection), /d005-operational-cycle\.json/,
    "the presentation model must not be a source of causal edges");
  // The two signed bundles are the sources, and are named as such.
  assert.match(code(projection), /d005-portable-evidence-bundle\.json/);
  assert.match(code(projection), /d005m-master-evidence-branch\.json/);
  assert.match(code(projection), /causal_links/);
});

test("P3-C: reading the signed declaration is what makes the graph complete", () => {
  // A regression here would not throw; it would quietly thin the graph out,
  // so the count is asserted rather than left to inspection.
  const edges = projectCausalEdges(leaves());
  assert.ok(edges.length >= 47, `expected the full signed graph, found ${edges.length} edges`);
  const withParents = leaves().filter((leaf) => leaf.causalParents.length > 0);
  assert.ok(withParents.length >= 32,
    `expected most leaves to declare a parent, found ${withParents.length}/${leaves().length}`);
});

// --- what a line may and may not mean -----------------------------------

test("P3-C: both ends of every drawn edge are leaves that exist", () => {
  const all = leaves();
  const ids = new Set(all.map((leaf) => leaf.leafId));
  for (const edge of projectCausalEdges(all)) {
    assert.ok(ids.has(edge.from), `edge from a leaf that is not drawn: ${edge.from}`);
    assert.ok(ids.has(edge.to), `edge to a leaf that is not drawn: ${edge.to}`);
  }
});

test("P3-C: a parent outside the drawn set produces no line to nowhere", () => {
  const all = leaves();
  const child = all.find((leaf) => leaf.causalParents.length > 0);
  assert.ok(child !== undefined);
  // Draw the child WITHOUT its parents. A line running off the canvas would
  // invite the viewer to imagine a node that is not there.
  const edges = projectCausalEdges([child]);
  assert.deepEqual(edges, []);
});

test("P3-C: adjacency in time does not create an edge", () => {
  const all = [...leaves()].sort((left, right) => left.timeMs - right.timeMs);
  const edges = projectCausalEdges(all);
  const drawn = new Set(edges.map((edge) => `${edge.from}->${edge.to}`));
  let adjacentPairs = 0;
  let adjacentWithoutEdge = 0;
  for (let index = 1; index < all.length; index += 1) {
    const previous = all[index - 1];
    const current = all[index];
    adjacentPairs += 1;
    if (!current.causalParents.includes(previous.evidenceId)) {
      adjacentWithoutEdge += 1;
      assert.ok(!drawn.has(`${previous.leafId}->${current.leafId}`),
        `${current.leafId} was linked to its neighbour without declaring it`);
    }
  }
  assert.ok(adjacentPairs > 0);
  assert.ok(adjacentWithoutEdge > 0, "the case must actually occur for this to prove anything");
});

test("P3-C: no edge runs backwards in time", () => {
  // A declared cause arriving after its effect would be an integrity finding
  // in the evidence, not a drawing problem. Assert it so it surfaces.
  const all = leaves();
  const byId = new Map(all.map((leaf) => [leaf.leafId, leaf]));
  for (const edge of projectCausalEdges(all)) {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    assert.ok(from !== undefined && to !== undefined);
    assert.ok(from.timeMs <= to.timeMs,
      `cause at ${from.timeMs}ms precedes nothing: effect is at ${to.timeMs}ms`);
  }
});

// --- the clock filters; it never draws ----------------------------------

test("P3-C: rewinding removes edges and never invents one", () => {
  const full = projectCausalEdges(projectProofLeaves([], 120_000));
  const early = projectCausalEdges(projectProofLeaves([], 20_000));
  assert.ok(full.length > early.length, "the graph must grow with the clock");
  const fullKeys = new Set(full.map((edge) => `${edge.from}->${edge.to}`));
  for (const edge of early) {
    assert.ok(fullKeys.has(`${edge.from}->${edge.to}`),
      "an edge visible early must be one the complete graph also declares");
  }
  // Seeking back to the start leaves nothing to draw, and breaks nothing.
  assert.deepEqual(projectCausalEdges(projectProofLeaves([], 0)), []);
});

test("P3-C: an edge appears only once both its ends have appeared", () => {
  const all = leaves();
  const byId = new Map(all.map((leaf) => [leaf.leafId, leaf]));
  const edge = projectCausalEdges(all).find((candidate) => {
    const from = byId.get(candidate.from);
    const to = byId.get(candidate.to);
    return from !== undefined && to !== undefined && from.timeMs < to.timeMs;
  });
  assert.ok(edge !== undefined, "a strictly-ordered edge must exist for this to prove anything");
  const parentTime = byId.get(edge.from)!.timeMs;
  const childTime = byId.get(edge.to)!.timeMs;
  // Between the two moments, the parent is drawn and the child is not, so the
  // edge cannot be drawn either.
  const between = Math.floor((parentTime + childTime) / 2);
  const mid = projectCausalEdges(projectProofLeaves([], between));
  assert.ok(!mid.some((candidate) => candidate.to === edge.to && candidate.from === edge.from));
});

// --- boundary crossings are the point -----------------------------------

test("P3-C: the graph carries real cross-domain edges", () => {
  const all = leaves();
  const byId = new Map(all.map((leaf) => [leaf.leafId, leaf]));
  const crossing = projectCausalEdges(all).filter((edge) =>
    byId.get(edge.from)!.branch !== byId.get(edge.to)!.branch);
  // One trust domain's evidence supporting another's is the fact the whole
  // demonstration exists to show; if these vanish, the graph has stopped
  // saying anything.
  assert.ok(crossing.length >= 20, `expected boundary crossings, found ${crossing.length}`);
  const pairs = new Set(crossing.map((edge) => `${byId.get(edge.from)!.branch}->${byId.get(edge.to)!.branch}`));
  assert.ok(pairs.size >= 5, `expected several distinct crossings, found ${[...pairs].join(", ")}`);
});

// --- what the component actually draws ----------------------------------

test("P3-C: the component draws the projection, not a hand-written list", () => {
  assert.match(component, /projectCausalEdges\(proofLeaves\)/);
  assert.match(component, /proofEdges\.map\(/);
  // The edge layer is decoration for assistive technology, and inert to
  // pointer input: it must never intercept a click meant for a leaf.
  assert.match(component, /className="proof-edges"/);
  const css = readFileSync(new URL("../app/convergence.css", import.meta.url), "utf8");
  const block = css.slice(css.indexOf(".proof-edges {"), css.indexOf(".proof-leaf {"));
  assert.match(block, /pointer-events:\s*none/);
  // A boundary crossing must be visually distinguishable from a step inside
  // one domain, or the graph draws the distinction and then hides it.
  assert.match(css, /\.proof-edge\.crosses-domain/);
});

test("P3-C: an edge is keyed by both its endpoints, so it cannot collide", () => {
  const all = leaves();
  const keys = projectCausalEdges(all).map((edge) => `${edge.from}->${edge.to}`);
  assert.equal(new Set(keys).size, keys.length, "duplicate edge keys would drop edges at render");
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { inspectReceivedPeb } from "../app/verify/inspectReceivedPeb.ts";
import { projectReceivedGraph, type ReceivedGraph } from "../app/verify/receivedGraph.ts";
import { graphModeDisplay, type GraphMode } from "../app/verify/graphDisplay.ts";
import { isReceivedEvidenceDossier } from "../app/verify/guidedInspection.ts";

const member = (id: string, parents: string[] = [], extra: Record<string, unknown> = {}) => ({
  evidenceId: id, receiptId: `NR-${id}`, eventId: `event.${id}`, timeMs: 0,
  source: "SIGNED_CANONICAL", presentation: "PRESENTED", producerDomain: "DOMAIN",
  causalParents: parents, observedInputs: [], ...extra,
});
function fixture(members: unknown[], finalReceipt?: unknown): ReceivedGraph {
  const raw = JSON.stringify({ profile: "fortix.demo.d006.peb.v1", bundleId: "modular-modes", identity: {}, manifest: { memberRefs: members }, ...(finalReceipt ? { finalReceipt } : {}) });
  return projectReceivedGraph(inspectReceivedPeb(raw), raw);
}
function branchingFixture() {
  return fixture([
    member("a"), member("b", ["a"], { timeMs: 1 }), member("c", ["a"], { timeMs: 2 }),
    member("d", ["b", "c"], { timeMs: 3, observedInputs: ["b"] }),
    member("sibling", ["b"], { timeMs: 4 }), member("observer", [], { observedInputs: ["d"], timeMs: 5 }),
    member("support", [], { presentation: "ASSURANCE_SUPPORT" }),
    member("final", ["a", "b", "c", "d", "sibling"], { source: "D006_FINAL_RECEIPT", receiptId: "final", timeMs: 6 }),
  ], { receiptId: "final", causalInputEvidenceIds: ["a", "b", "c", "d", "sibling"] });
}
const key = (graph: ReceivedGraph, id: string) => graph.nodes.find(node => node.evidenceId === id)!.key;
const isFinalEdge = (graph: ReceivedGraph, edge: ReceivedGraph["edges"][number]) =>
  edge.from === graph.finalKey || edge.to === graph.finalKey || edge.declarations.some(item => item.kind === "FINAL_RECEIPT_INPUT");
function assertExactSubset(graph: ReceivedGraph, result: ReturnType<typeof graphModeDisplay>) {
  assert.ok(result.nodes.every(node => graph.nodes.includes(node)));
  assert.ok(result.edges.every(edge => graph.edges.includes(edge)));
  assert.ok(result.edges.every(edge => result.nodeKeys.has(edge.from) && result.nodeKeys.has(edge.to)));
  assert.equal(result.nodeKeys.size, result.nodes.length);
  assert.equal(new Set(result.edges.map(edge => edge.key)).size, result.edges.length);
  assert.equal(result.hiddenNodes + result.nodes.length, graph.nodes.length);
  assert.equal(result.hiddenEdges + result.edges.length, graph.edges.length);
  assert.equal(result.counts.visible.declarations, result.edges.reduce((sum, edge) => sum + edge.declarations.length, 0));
}

test("modular modes preserve exact graph objects and full typed declarations", () => {
  const graph = branchingFixture(); const before = JSON.stringify(graph);
  for (const mode of ["simplified", "causal", "follow", "expert"] as const) {
    const result = graphModeDisplay(graph, { mode, selectedNodeKey: key(graph, "d") });
    assertExactSubset(graph, result);
    assert.deepEqual(result, graphModeDisplay(graph, { mode, selectedNodeKey: key(graph, "d") }));
  }
  const expert = graphModeDisplay(graph, { mode: "expert" });
  assert.deepEqual(expert.nodes, graph.nodes); assert.deepEqual(expert.edges, graph.edges);
  assert.equal(expert.hiddenNodes, 0); assert.equal(expert.hiddenEdges, 0);
  assert.equal(JSON.stringify(graph), before);
});

test("Final Receipt edges cannot be forced into non-expert modes by selection or expanded branches", () => {
  const graph = branchingFixture();
  const finalEdge = graph.edges.find(edge => isFinalEdge(graph, edge))!;
  for (const mode of ["simplified", "causal", "follow"] as const) {
    for (const selectedNodeKey of [key(graph, "a"), graph.finalKey!]) {
      const result = graphModeDisplay(graph, { mode, selectedNodeKey, selectedEdgeKey: finalEdge.key, expandedNodeKeys: graph.nodes.map(node => node.key) });
      assertExactSubset(graph, result);
      assert.ok(result.edges.every(edge => !isFinalEdge(graph, edge)));
      assert.ok(result.nodes.some(node => node.key === selectedNodeKey));
    }
  }
  for (const mode of ["simplified", "causal"] as const) {
    const result = graphModeDisplay(graph, { mode, selectedNodeKey: graph.finalKey, followToFinal: true });
    assert.ok(result.edges.every(edge => !isFinalEdge(graph, edge)), "toFinal is only effective in Follow");
  }
  const isolatedFinal = graphModeDisplay(graph, { mode: "causal", selectedNodeKey: graph.finalKey });
  assert.deepEqual(isolatedFinal.nodes.map(node => node.key), [graph.finalKey]);
  assert.equal(isolatedFinal.edges.length, 0);
});

test("Causal shows immediate received relations and only explicitly expands another branch", () => {
  const graph = branchingFixture(); const selected = key(graph, "d");
  const causal = graphModeDisplay(graph, { mode: "causal", selectedNodeKey: selected });
  assert.deepEqual(causal.edges, graph.edges.filter(edge => !isFinalEdge(graph, edge) && (edge.from === selected || edge.to === selected)));
  assert.ok(causal.edges.some(edge => !edge.causal), "observed relation stays present and typed, not promoted to causal");
  assert.ok(!causal.nodeKeys.has(key(graph, "a"))); assert.ok(!causal.nodeKeys.has(key(graph, "sibling")));
  const expanded = graphModeDisplay(graph, { mode: "causal", selectedNodeKey: selected, expandedNodeKeys: [key(graph, "b"), key(graph, "b"), "not-present"] });
  assert.ok(expanded.nodeKeys.has(key(graph, "a"))); assert.ok(expanded.nodeKeys.has(key(graph, "sibling")));
  assertExactSubset(graph, expanded);
});

test("Follow is one deterministic causal path, not every ancestor or consequence", () => {
  const graph = branchingFixture();
  const result = graphModeDisplay(graph, { mode: "follow", selectedNodeKey: key(graph, "d"), expandedNodeKeys: graph.nodes.map(node => node.key) });
  assert.deepEqual(result.path, ["a", "b", "d"].map(id => key(graph, id)));
  assert.equal(result.edges.length, result.path.length - 1);
  assert.ok(!result.nodeKeys.has(key(graph, "c"))); assert.ok(!result.nodeKeys.has(key(graph, "sibling"))); assert.ok(!result.nodeKeys.has(key(graph, "observer")));
  assert.ok(result.edges.every(edge => edge.causal));
  assert.equal(result.edges.at(-1)!.declarations.length, 2, "mixed causal/observed declarations on the retained edge stay exact");
});

test("Follow to Final Receipt exposes one real selected-to-final path without its fan-in", () => {
  const graph = branchingFixture();
  const result = graphModeDisplay(graph, { mode: "follow", selectedNodeKey: key(graph, "b"), followToFinal: true });
  assert.deepEqual(result.path, ["b", "d", "final"].map(id => key(graph, id)));
  assert.equal(result.edges.length, result.path.length - 1);
  assert.equal(result.edges.filter(edge => isFinalEdge(graph, edge)).length, 1);
  assert.ok(!result.nodeKeys.has(key(graph, "a"))); assert.ok(!result.nodeKeys.has(key(graph, "sibling")));
  assertExactSubset(graph, result);
  const noRoute = graphModeDisplay(graph, { mode: "follow", selectedNodeKey: key(graph, "observer"), followToFinal: true });
  assert.deepEqual(noRoute.path, []); assert.equal(noRoute.edges.length, 0);
  assert.deepEqual(noRoute.nodes.map(node => node.key), [key(graph, "observer")]);
});

test("missing selection, cycles and observed inputs never produce substitute causal paths", () => {
  const graph = fixture([member("a"), member("observed", [], { observedInputs: ["a"] }), member("x", ["y"]), member("y", ["x"]), member("dependent", ["x"])]);
  for (const id of ["x", "y", "dependent"]) {
    const result = graphModeDisplay(graph, { mode: "follow", selectedNodeKey: key(graph, id) });
    assert.deepEqual(result.path, []); assert.equal(result.edges.length, 0);
  }
  const observed = graphModeDisplay(graph, { mode: "follow", selectedNodeKey: key(graph, "observed") });
  assert.deepEqual(observed.path, [key(graph, "observed")]); assert.equal(observed.edges.length, 0);
  for (const selectedNodeKey of [undefined, "not-present"]) {
    const result = graphModeDisplay(graph, { mode: "follow", selectedNodeKey });
    assert.equal(result.nodes.length, 0); assert.equal(result.edges.length, 0);
  }
  const noFinal = graphModeDisplay(graph, { mode: "follow", selectedNodeKey: key(graph, "a"), followToFinal: true });
  assert.deepEqual(noFinal.path, []); assert.equal(noFinal.edges.length, 0);
});

test("Simplified keeps business landmarks without inventing links across hidden intermediate facts", () => {
  const graph = fixture([
    member("start", [], { timeMs: 0 }), member("middle", ["start"], { timeMs: 1 }), member("end", ["middle"], { timeMs: 2 }),
    member("network-lost", [], { timeMs: 3, producerDomain: "NETWORK" }), member("network-restored", [], { timeMs: 4, producerDomain: "NETWORK" }),
  ]);
  const result = graphModeDisplay(graph, { mode: "simplified" });
  assert.ok(result.nodeKeys.has(key(graph, "start"))); assert.ok(result.nodeKeys.has(key(graph, "end")));
  assert.ok(!result.nodeKeys.has(key(graph, "middle")));
  assert.equal(result.edges.length, 0, "no received start-to-end relation exists");
  assert.ok(result.edges.every((edge) => edge.causal), "chronology never fabricates an edge");
  assert.ok(result.nodeKeys.has(key(graph, "network-lost"))); assert.ok(result.nodeKeys.has(key(graph, "network-restored")));
  assertExactSubset(graph, result);
  const selected = graphModeDisplay(graph, { mode: "simplified", selectedNodeKey: key(graph, "middle") });
  assert.ok(selected.nodeKeys.has(key(graph, "middle")));
  assert.deepEqual(selected.edges.map((edge) => [edge.from, edge.to]), [
    [key(graph, "start"), key(graph, "middle")],
    [key(graph, "middle"), key(graph, "end")],
  ], "an explicit selection exposes only its received immediate context");
  assertExactSubset(graph, selected);
});

test("Simplified keeps family bookends and hides evidence dossiers even when a relation selects one", () => {
  const graph = fixture([
    member("request", [], { eventId: "d005.passenger-request", timeMs: 0 }),
    member("pickup", ["request"], { eventId: "d005.pickup-confirmed", timeMs: 1 }),
    member("dropoff", ["pickup"], { eventId: "d005.dropoff-confirmed", timeMs: 2 }),
    member("dossier", ["dropoff"], { eventId: "d005.receipt.passenger", timeMs: 3 }),
    member("invoice", ["dossier"], { eventId: "d005m.master-invoice-1850", timeMs: 4 }),
    member("payment", ["invoice"], { eventId: "d005m.master-payment-result", timeMs: 5 }),
  ]);
  const dossier = key(graph, "dossier");
  const dossierEdge = graph.edges.find(edge => edge.to === dossier)!;
  for (const options of [
    { mode: "simplified" as const },
    { mode: "simplified" as const, selectedNodeKey: dossier, selectedEdgeKey: dossierEdge.key },
  ]) {
    const compact = graphModeDisplay(graph, options);
    assert.deepEqual(compact.nodes.map(node => node.evidenceId), ["request", "dropoff", "invoice", "payment"]);
    assert.ok(compact.nodes.every(node => !isReceivedEvidenceDossier(node)));
    assert.deepEqual(compact.edges.map(edge => [edge.from, edge.to]), [[key(graph, "invoice"), key(graph, "payment")]]);
    assertExactSubset(graph, compact);
  }
  const expert = graphModeDisplay(graph, { mode: "expert" });
  assert.deepEqual(expert.nodes, graph.nodes);
  assert.deepEqual(expert.edges, graph.edges);
});

test("reference PEB inventories and counters stay exact in every modular graph mode", () => {
  const raw = readFileSync(new URL("../../../artifacts/d006-network-continuity-20261002/peb-after-network-cycle.json", import.meta.url), "utf8");
  const graph = projectReceivedGraph(inspectReceivedPeb(raw), raw); const before = JSON.stringify(graph);
  const selectedNodeKey = graph.nodes.find(node => node.member?.eventId === "d005m.master-human-approve")!.key;
  const total = { nodes: 71, edges: 165, declarations: 223, nano: 60, support: 10, final: 1, unresolved: 0 };
  const modes: GraphMode[] = ["simplified", "causal", "follow", "expert"];
  for (const mode of modes) {
    const result = graphModeDisplay(graph, { mode, selectedNodeKey });
    assertExactSubset(graph, result); assert.deepEqual(result.counts.total, total);
    if (mode === "expert") assert.deepEqual(result.counts.visible, total);
    else assert.equal(result.edges.filter(edge => isFinalEdge(graph, edge)).length, 0);
    if (mode === "simplified") {
      assert.ok(result.nodes.length <= 25, "the overview stays compact even with an explicit selection");
      assert.ok(result.edges.length <= 30, "the overview does not restore every landmark's causal ancestors");
      assert.ok(result.nodes.every(node => !isReceivedEvidenceDossier(node)), "evidence dossiers remain in deeper inspection");
      assert.ok(result.edges.every(edge => edge.causal), "the overview contains received causal edges only");
    }
    assert.equal(JSON.stringify(graph), before);
  }
});

test("graph node panel reads the fact through the shared inspector before graph actions and removes manifest ordinals", () => {
  const source = readFileSync(new URL("../app/verify/InspectionWorkspace.tsx", import.meta.url), "utf8");
  const nodePanel = source.slice(source.indexOf("{selectedEntry ? <FactInspector"), source.indexOf("{panelActions}") + 14);
  let cursor = -1;
  for (const marker of ["<FactInspector", 'context="graph"', "inspection-related-boundaries", "{panelActions}"]) {
    const index = nodePanel.indexOf(marker);
    assert.ok(index > cursor, `${marker} follows the preceding block`);
    cursor = index;
  }
  assert.doesNotMatch(source, /inspection-established-reading|inspection-unestablished-reading|Ce que les preuves établissent|Ce qui reste non établi/, "package-wide limits belong to the Verdict view");
  assert.doesNotMatch(nodePanel, /graph:forensic:|onOpenForensic/, "Forensic is reached from the evidence, not from the first panel level");
  assert.doesNotMatch(source, /\{peb\.transferDigest\}|data-received-graph-digest|receipt\.identity|selectedReceipt\?\.identity/);
  assert.match(source, /<title>\{`\$\{number\(node\)\}\\n\$\{label\(node\)\}`\}<\/title>/);
  assert.doesNotMatch(source, /<title>\{number\(node\)\}\\n\{label\(node\)\}/);
  assert.doesNotMatch(source, /`NR \$\{String\(node\.member\.index \+ 1\)\.padStart\(2, "0"\)\}`/);
});

test("route CSS contains wide timelines and offsets sticky readers below the header", () => {
  const routes = readFileSync(new URL("../app/verify/verifier-routes.css", import.meta.url), "utf8");
  const guided = readFileSync(new URL("../app/verify/guided-inspection.css", import.meta.url), "utf8");
  assert.match(routes, /\.verifier-route-main \{[^}]*min-width:\s*0;[^}]*max-width:\s*100%;/);
  assert.match(routes, /\.verifier-route-main \.evidence-timeline-scroll \{[^}]*contain:\s*inline-size;/);
  assert.match(routes, /evidence-timeline\[data-compact=true\] \{ top:\s*72px;/);
  assert.match(routes, /inspection-workspace\[data-expanded=true\] \.inspection-panel \{ top:\s*76px;/);
  assert.match(guided, /\.evidence-timeline-scroll \{[^}]*min-width:\s*0;[^}]*max-width:\s*100%;[^}]*overflow-x:\s*auto;[^}]*contain:\s*inline-size;/);
});

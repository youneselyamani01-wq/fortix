import assert from "node:assert/strict";
import test from "node:test";
import { inspectReceivedPeb } from "../app/verify/inspectReceivedPeb.ts";
import { projectReceivedGraph, receivedEvidencePath } from "../app/verify/receivedGraph.ts";
import { graphDisplay, graphPresetLayers, graphReadingEdges, receivedGraphFamilies } from "../app/verify/graphDisplay.ts";

const member = (id: string, parents: string[] = [], extra: Record<string, unknown> = {}) => ({ evidenceId: id, receiptId: id, source: "SIGNED_CANONICAL", presentation: "PRESENTED", causalParents: parents, observedInputs: [], ...extra });
function fixture(members: unknown[], finalReceipt?: unknown) {
  const text = JSON.stringify({ profile: "fortix.demo.d006.peb.v1", bundleId: "display", identity: {}, manifest: { memberRefs: members }, ...(finalReceipt ? { finalReceipt } : {}) });
  return projectReceivedGraph(inspectReceivedPeb(text), text);
}
test("display presets preserve exact graph objects and never create shortcut relations", () => {
  const graph = fixture([member("a"), member("b", ["a"]), member("c", ["a", "b"]), member("observed", [], { observedInputs: ["b"] }), member("support", [], { presentation: "ASSURANCE_SUPPORT" }), member("final", ["c"], { source: "D006_FINAL_RECEIPT" })], { receiptId: "final", causalInputEvidenceIds: ["c"] });
  const before = JSON.stringify(graph); const path = receivedEvidencePath(graph, graph.finalKey);
  const full = graphDisplay(graph, path, "full", graphPresetLayers("full"));
  assert.deepEqual(full.nodes, graph.nodes); assert.deepEqual(full.edges, graph.edges);
  const simplified = graphDisplay(graph, path, "simplified", graphPresetLayers("simplified"));
  assert.deepEqual(simplified.nodes.map(node => node.key), graph.nodes.filter(node => path.includes(node.key)).map(node => node.key));
  assert.equal(simplified.edges.length, path.length - 1);
  const simplifiedCross = graphDisplay(graph, path, "simplified", { ...graphPresetLayers("simplified"), secondaryRelations: true });
  assert.ok(simplifiedCross.edges.length > simplified.edges.length, "secondary toggle exposes exact cross relations between visible nodes in Simplified");
  assert.ok(simplifiedCross.edges.every(edge => graph.edges.includes(edge)));
  const causal = graphDisplay(graph, path, "causal", graphPresetLayers("causal"));
  assert.ok(causal.edges.every(edge => edge.causal && graph.edges.includes(edge)));
  assert.ok(causal.nodes.some(node => node.final), "the Final Receipt stays visible in the causal reading");
  assert.ok(!causal.nodes.some(node => node.member?.presentation === "ASSURANCE_SUPPORT"));
  assert.equal(JSON.stringify(graph), before);
});
test("display reading spine keeps cross, observed and cyclic relations available in full mode", () => {
  const graph = fixture([member("a"), member("b", ["a"]), member("c", ["a", "b"], { observedInputs: ["a"] }), member("x", ["y"]), member("y", ["x"])]);
  const primary = graphReadingEdges(graph);
  const cross = graph.edges.find(edge => edge.from === graph.nodes[0].key && edge.to === graph.nodes[2].key)!;
  assert.ok(!primary.has(cross.key));
  assert.ok(graph.edges.filter(edge => graph.cycleKeys.includes(edge.from)).every(edge => !primary.has(edge.key)));
  const full = graphDisplay(graph, [], "full", graphPresetLayers("full"));
  assert.equal(full.edges.length, graph.edges.length);
  const noRelations = graphDisplay(graph, [], "full", { ...graphPresetLayers("full"), causalRelations: false, secondaryRelations: false });
  assert.equal(noRelations.edges.length, 0); assert.equal(noRelations.nodes.length, graph.nodes.length);
  const noCausal = graphDisplay(graph, [], "full", { ...graphPresetLayers("full"), causalRelations: false });
  assert.ok(noCausal.edges.every(edge => !edge.causal), "a secondary causal relation is still a causal relation");
});
test("event families use received identities and preserve network, support, final and unknown distinctions", () => {
  const graph = fixture([member("passenger", [], { eventId: "d005.passenger-request" }), member("network", [], { producerDomain: "NETWORK", eventId: "received.network.transition" }), member("unknown", [], { eventId: "future.unmapped" }), member("support", [], { presentation: "ASSURANCE_SUPPORT" }), member("final", [], { source: "D006_FINAL_RECEIPT" })], { receiptId: "final", causalInputEvidenceIds: [] });
  const families = receivedGraphFamilies(graph, "fr");
  assert.equal(families.find(group => group.key === "network")?.counts.nano, 1);
  assert.equal(families.find(group => group.key === "support")?.counts.nano, 0);
  assert.equal(families.find(group => group.key === "final")?.counts.final, 1);
  assert.equal(families.find(group => group.key === "other")?.nodes[0].member?.eventId, "future.unmapped");
  assert.equal(new Set(families.flatMap(group => group.nodes.map(node => node.key))).size, graph.nodes.length);
});

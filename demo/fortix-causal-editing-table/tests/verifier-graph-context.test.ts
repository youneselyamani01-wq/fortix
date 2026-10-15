import assert from "node:assert/strict";
import test from "node:test";
import { inspectReceivedPeb } from "../app/verify/inspectReceivedPeb.ts";
import { groupInspectionBoundaries } from "../app/verify/inspectionPresentation.ts";
import { projectReceivedGraph } from "../app/verify/receivedGraph.ts";
import { resolveVerifierGraphContext } from "../app/verify/verifierGraphContext.ts";

function fixture() {
  const raw = JSON.stringify({
    profile: "fortix.demo.d006.peb.v1",
    manifest: { memberRefs: [
      { evidenceId: "navigation", producerDomain: "Navigation", causalParents: [] },
      { evidenceId: "garage", producerDomain: "Garage", causalParents: ["navigation"] },
      { evidenceId: "navigation-two", producerDomain: "Navigation", causalParents: [] },
      { evidenceId: "garage-two", producerDomain: "Garage", causalParents: ["navigation-two"] },
      { evidenceId: "payment", producerDomain: "Payment", causalParents: ["garage"] },
    ] },
  });
  const graph = projectReceivedGraph(inspectReceivedPeb(raw), raw);
  const boundary = groupInspectionBoundaries(graph).find(candidate => candidate.from === "Navigation" && candidate.to === "Garage");
  assert.ok(boundary);
  assert.equal(boundary.edgeKeys.length, 2);
  const relation = graph.edges.find(edge => edge.key === boundary.edgeKeys[0]);
  const unrelated = graph.edges.find(edge => !boundary.edgeKeys.includes(edge.key));
  assert.ok(relation);
  assert.ok(unrelated);
  return { graph, boundary, relation, unrelated };
}

test("absent graph context remains empty instead of selecting the first boundary or relation", () => {
  const { graph } = fixture();
  for (const input of [{}, { boundaryKey: null, relationKey: null }]) {
    assert.deepEqual(resolveVerifierGraphContext(graph, input), { status: "EMPTY", boundary: null, relation: null });
  }
});

test("exact relation and boundary keys resolve without inventing a selected pair", () => {
  const { graph, boundary, relation } = fixture();
  const pair = resolveVerifierGraphContext(graph, { boundaryKey: boundary.key, relationKey: relation.key });
  assert.equal(pair.status, "RESOLVED");
  assert.deepEqual(pair.boundary, boundary);
  assert.equal(pair.relation, relation, "retained relation is the exact received graph object");
  const group = resolveVerifierGraphContext(graph, { boundaryKey: boundary.key });
  assert.equal(group.status, "RESOLVED");
  assert.deepEqual(group.boundary?.edgeKeys, boundary.edgeKeys);
  assert.equal(group.relation, null, "opening a group does not select its first edge");
  const edge = resolveVerifierGraphContext(graph, { relationKey: relation.key });
  assert.equal(edge.relation, relation);
  assert.equal(edge.boundary, null, "an exact relation does not invent a chosen boundary kind");
});

test("unknown references stay unavailable even when their companion reference exists", () => {
  const { graph, boundary, relation } = fixture();
  assert.deepEqual(resolveVerifierGraphContext(graph, { boundaryKey: "missing", relationKey: relation.key }), {
    status: "MISSING_BOUNDARY", boundary: null, relation: null,
  });
  assert.deepEqual(resolveVerifierGraphContext(graph, { boundaryKey: boundary.key, relationKey: "missing" }), {
    status: "MISSING_RELATION", boundary: null, relation: null,
  });
  assert.equal(resolveVerifierGraphContext(graph, { relationKey: "" }).status, "MISSING_RELATION");
});

test("an existing relation from another boundary is contradictory and receives no substitute", () => {
  const { graph, boundary, unrelated } = fixture();
  assert.deepEqual(resolveVerifierGraphContext(graph, { boundaryKey: boundary.key, relationKey: unrelated.key }), {
    status: "CONTRADICTORY", boundary: null, relation: null,
  });
});

test("graph context validation preserves the received graph and the independent story cursor", () => {
  const { graph, boundary, relation } = fixture();
  const before = JSON.stringify(graph);
  const input = Object.freeze({ boundaryKey: boundary.key, relationKey: relation.key, eventId: "previous-story-event" });
  const resolved = resolveVerifierGraphContext(graph, input);
  assert.equal(resolved.status, "RESOLVED", "exploring a boundary does not require moving the story cursor to its endpoint");
  assert.equal(input.eventId, "previous-story-event");
  assert.equal(JSON.stringify(graph), before);
  assert.ok(Object.isFrozen(resolved));
});

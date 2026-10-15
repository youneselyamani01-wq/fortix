import assert from "node:assert/strict";
import test from "node:test";
import { MISSION_ID } from "../app/missionContinuity.ts";
import { projectMissionEvidence } from "../app/missionEvidence.ts";
import { createOfflineEvidenceSession, sealFinalReceiptRuntimeEvidence } from "../app/offlineEvidence.ts";
import { buildMissionEvidenceClosure, buildPortableMissionEvidenceBundle, createHandoffArtifact, finalReceiptRuntimeEvidencePrefix, issueFinalMissionReceipt } from "../app/portableMissionEvidence.ts";
import { projectPortableProofLeaves } from "../app/proofProjection.ts";
import { FINAL_RECEIPT_EMITTED_MS, HANDOFF_READY_MS, PEB_COMPLETE_MS } from "../app/storyTimeline.ts";
import { inspectReceivedPeb } from "../app/verify/inspectReceivedPeb.ts";
import { projectReceivedGraph, receivedEvidencePath, receivedFocus } from "../app/verify/receivedGraph.ts";
import { receivedPathOutline } from "../app/verify/receivedPathOutline.ts";
import { receivedEventLabel } from "../app/verify/receivedLabels.ts";

function fixture() {
  const runId = "fortix.demo.fsr2.run.received-graph";
  const journal = sealFinalReceiptRuntimeEvidence(projectMissionEvidence(createOfflineEvidenceSession(runId, null, MISSION_ID), FINAL_RECEIPT_EMITTED_MS), FINAL_RECEIPT_EMITTED_MS);
  const records = finalReceiptRuntimeEvidencePrefix(journal);
  const closure = buildMissionEvidenceClosure({ identity: { missionId: MISSION_ID, runId }, runtimeRecords: records, asOfMasterTimeMs: FINAL_RECEIPT_EMITTED_MS });
  const finalReceipt = issueFinalMissionReceipt(closure, FINAL_RECEIPT_EMITTED_MS);
  const displayedEvidenceIds = projectPortableProofLeaves(closure, PEB_COMPLETE_MS, finalReceipt).map(leaf => leaf.evidenceId);
  return createHandoffArtifact(buildPortableMissionEvidenceBundle({ closure, finalReceipt, runtimeRecords: records, displayedEvidenceIds, masterTimeMs: PEB_COMPLETE_MS }), HANDOFF_READY_MS);
}
const artifact = fixture();
const member = (evidenceId: string, causalParents: string[] = [], observedInputs: string[] = [], producerDomain = "A") => ({ evidenceId, causalParents, observedInputs, producerDomain, source: "SIGNED_CANONICAL" });
function project(members: unknown[], finalInputs: string[] = [], extra = {}) {
  const raw = JSON.stringify({ profile: "fortix.demo.d006.peb.v1", bundleId: "test", identity: {}, manifest: { memberRefs: members }, finalReceipt: { receiptId: "final", causalInputEvidenceIds: finalInputs }, ...extra });
  const peb = inspectReceivedPeb(raw);
  return { raw, peb, graph: projectReceivedGraph(peb, raw) };
}

test("received graph preserves every member and typed relation of the actual canonical PEB", () => {
  const peb = inspectReceivedPeb(artifact.pebText);
  const graph = projectReceivedGraph(peb, artifact.pebText);
  assert.equal(graph.nodes.length, peb.members.length);
  assert.equal(graph.nodes.filter(node => node.final).length, 1);
  assert.deepEqual(graph.nodes.map(node => node.evidenceId), peb.members.map(member => member.evidenceId));
  const declarations = [...graph.edges.flatMap(edge => edge.declarations), ...graph.unresolved];
  assert.deepEqual(declarations.map(relation => relation.path).sort(), peb.relations.map(relation => relation.path).sort());
  assert.equal(graph.cycleKeys.length, 0);
  const path = receivedEvidencePath(graph);
  assert.ok(path.length > 4);
  assert.equal(path.at(-1), graph.finalKey);
  for (let i = 1; i < path.length; i++) assert.ok(graph.edges.some(edge => edge.from === path[i - 1] && edge.to === path[i] && edge.causal));
  assert.ok(graph.edges.some(edge => edge.crossings.some(crossing => crossing.kind === "authority")));
  assert.equal("verdict" in graph, false);
});

test("a changed received relation changes the path; time and array proximity never add edges", () => {
  const a = project([member("a"), member("b", ["a"]), member("c")], ["b"]);
  assert.deepEqual(receivedEvidencePath(a.graph), ["member:0", "member:1", "finalReceipt"]);
  assert.equal(a.graph.edges.some(edge => edge.from === "member:2" || edge.to === "member:2"), false);
  const b = project([member("a"), { ...member("b", ["c"]), timeMs: -20 }, { ...member("c"), timeMs: 99999 }], ["b"]);
  assert.deepEqual(receivedEvidencePath(b.graph), ["member:2", "member:1", "finalReceipt"]);
  assert.notEqual(a.peb.transferDigest, b.peb.transferDigest);
});

test("observed inputs stay typed and never become causal path steps", () => {
  const { graph } = project([member("a"), member("b", [], ["a"])], ["b"]);
  assert.deepEqual(receivedEvidencePath(graph), ["member:1", "finalReceipt"]);
  assert.equal(graph.edges.find(edge => edge.from === "member:0")?.causal, false);
});

test("duplicate, unresolved and malformed declarations remain accounted for without phantom nodes", () => {
  const { graph, peb } = project([member("dup"), member("dup"), null, member("target", ["dup", "missing"])], ["target"]);
  assert.equal(graph.nodes.length, 5);
  assert.deepEqual(graph.unresolved.map(relation => relation.referenceStatus), ["AMBIGUOUS", "UNRESOLVED"]);
  assert.equal(graph.edges.flatMap(edge => edge.declarations).length + graph.unresolved.length, peb.relations.length);
  assert.ok(graph.nodes.some(node => node.member?.index === 2 && node.evidenceId === null));
});

test("causal cycles and their dependants have no fabricated path or depth", () => {
  const { graph } = project([member("a", ["b"]), member("b", ["a"]), member("c", ["b"]), member("isolated")], ["c"]);
  assert.deepEqual(graph.cycleKeys, ["member:0", "member:1"]);
  assert.equal(graph.nodes.find(node => node.key === "member:2")?.depth, null);
  assert.equal(graph.nodes.find(node => node.key === "member:3")?.depth, 0);
  assert.deepEqual(receivedEvidencePath(graph), []);
  assert.equal(graph.edges.length, 4);
});

test("boundary changes require explicit context at both ends of the same declared edge", () => {
  const source = (id: string, authority: string, trust: string) => ({ evidence_id: id, evidence_payload: { intent: { authority_context: authority } }, trust_boundary: { trust_boundary_id: trust } });
  const { graph } = project([member("a", [], [], "vehicle"), member("b", ["a"], [], "human"), member("c", ["b"], [], "human")], ["c"], {
    sourceBundle: { canonical_evidence_objects: [source("a", "taxi", "vehicle-boundary"), source("b", "manager", "human-boundary")] },
  });
  const crossing = graph.edges.find(edge => edge.key === "member:0>member:1")!;
  assert.deepEqual(crossing.crossings.map(crossing => crossing.kind), ["producer", "authority", "trustBoundary"]);
  assert.ok(crossing.crossings.every(crossing => crossing.from.path && crossing.to.path));
  assert.deepEqual(graph.edges.find(edge => edge.key === "member:1>member:2")?.crossings, []);
});

test("ambiguous source context is not borrowed and missing fields do not crash inspection", () => {
  const { graph } = project([member("a"), member("b", ["a"], [], "B")], ["b"], {
    sourceBundle: { canonical_evidence_objects: [{ evidence_id: "a" }, { evidence_id: "a" }, { evidence_id: "b" }] },
  });
  assert.ok(graph.contextIssues.some(issue => issue.includes("2 matching")));
  assert.deepEqual(graph.nodes[0].context, {});
  assert.deepEqual(graph.edges[0].crossings.map(crossing => crossing.kind), ["producer"]);
});

test("receipt focus retains parents, children and unrelated members with distinct strengths", () => {
  const { graph } = project([member("a"), member("b", ["a"]), member("c", ["b"]), member("other")], ["c"]);
  const focus = receivedFocus(graph, "member:1", []);
  assert.ok(focus.strong.has("member:1"));
  assert.ok(focus.context.has("member:0"));
  assert.ok(focus.context.has("member:2"));
  assert.equal(focus.context.has("member:3"), false);
  assert.equal(graph.nodes.length, 5);
});

test("unknown files do not display the taxi fixture and captions do not infer event identities", () => {
  for (const raw of ["not-json", "null", "{}", "[]"]) {
    const graph = projectReceivedGraph(inspectReceivedPeb(raw), raw);
    assert.deepEqual(graph.nodes, []); assert.deepEqual(graph.edges, []); assert.deepEqual(receivedEvidencePath(graph), []);
  }
  assert.equal(receivedEventLabel("unknown-event", "fr"), null);
  assert.equal(receivedEventLabel("d006g.bank-confirmation", "fr"), "Autorisation bancaire confirmée");
});

test("structural correction: an outline partitions the real primary path without adding or losing any causal edge", () => {
  const peb = inspectReceivedPeb(artifact.pebText); const graph = projectReceivedGraph(peb, artifact.pebText);
  const path = receivedEvidencePath(graph); const snapshot = JSON.stringify(graph);
  const outline = receivedPathOutline(graph, path);
  assert.equal(outline.milestones[0].key, path[0]);
  assert.equal(outline.milestones.at(-1)!.key, graph.finalKey);
  assert.ok(outline.milestones.length <= 6);
  assert.deepEqual(outline.segments.flatMap(segment => segment.edges.map(edge => edge.key)), path.slice(1).map((key, i) => `${path[i]}>${key}`));
  assert.equal(JSON.stringify(graph), snapshot);
});

test("structural correction: missing, cyclic and arbitrary paths never acquire shortcut edges", () => {
  const { graph } = project([member("a"), member("b", ["a"]), member("c", ["b"]), member("other")], ["c"]);
  const outline = receivedPathOutline(graph, receivedEvidencePath(graph));
  assert.ok(outline.segments.flatMap(segment => segment.edges).every(edge => edge.causal && graph.edges.includes(edge)));
  assert.throws(() => receivedPathOutline(graph, ["member:0", "member:3"]), /explicit causal edges/);
  assert.deepEqual(receivedPathOutline(graph, []), { milestones: [], segments: [] });
  const cycle = project([member("a", ["b"]), member("b", ["a"])], ["b"]).graph;
  assert.deepEqual(receivedPathOutline(cycle, receivedEvidencePath(cycle)), { milestones: [], segments: [] });
});

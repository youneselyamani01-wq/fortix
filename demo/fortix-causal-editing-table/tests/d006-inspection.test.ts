import assert from "node:assert/strict";
import test from "node:test";
import { MISSION_ID } from "../app/missionContinuity.ts";
import { projectMissionEvidence } from "../app/missionEvidence.ts";
import { createOfflineEvidenceSession, sealFinalReceiptRuntimeEvidence } from "../app/offlineEvidence.ts";
import { analyzeInsertedD006Peb, insertD006PebForAnalysis } from "../app/offlineVerification.ts";
import { buildMissionEvidenceClosure, buildPortableMissionEvidenceBundle, createHandoffArtifact, finalReceiptRuntimeEvidencePrefix, issueFinalMissionReceipt } from "../app/portableMissionEvidence.ts";
import { projectPortableProofLeaves } from "../app/proofProjection.ts";
import { FINAL_RECEIPT_EMITTED_MS, HANDOFF_READY_MS, PEB_COMPLETE_MS } from "../app/storyTimeline.ts";
import { inspectReceivedPeb } from "../app/verify/inspectReceivedPeb.ts";
import { projectReceivedGraph } from "../app/verify/receivedGraph.ts";
import { groupInspectionBoundaries, inspectionCoverage, inspectionEmphasis, readInspectionEvidence } from "../app/verify/inspectionPresentation.ts";

const member = (evidenceId: string, causalParents: string[] = [], observedInputs: string[] = [], producerDomain = "A", source = "SIGNED_CANONICAL") => ({ evidenceId, causalParents, observedInputs, producerDomain, source });
function project(members: unknown[], extra: Record<string, unknown> = {}) {
  const raw = JSON.stringify({ profile: "fortix.demo.d006.peb.v1", bundleId: "test", identity: {}, manifest: { memberRefs: members }, ...extra });
  const peb = inspectReceivedPeb(raw);
  return { raw, peb, graph: projectReceivedGraph(peb, raw) };
}
function fixture() {
  const runId = "fortix.demo.d006.run.inspection-closure";
  const journal = sealFinalReceiptRuntimeEvidence(projectMissionEvidence(createOfflineEvidenceSession(runId, null, MISSION_ID), FINAL_RECEIPT_EMITTED_MS), FINAL_RECEIPT_EMITTED_MS);
  const records = finalReceiptRuntimeEvidencePrefix(journal);
  const closure = buildMissionEvidenceClosure({ identity: { missionId: MISSION_ID, runId }, runtimeRecords: records, asOfMasterTimeMs: FINAL_RECEIPT_EMITTED_MS });
  const finalReceipt = issueFinalMissionReceipt(closure, FINAL_RECEIPT_EMITTED_MS);
  const displayedEvidenceIds = projectPortableProofLeaves(closure, PEB_COMPLETE_MS, finalReceipt).map(leaf => leaf.evidenceId);
  return createHandoffArtifact(buildPortableMissionEvidenceBundle({ closure, finalReceipt, runtimeRecords: records, displayedEvidenceIds, masterTimeMs: PEB_COMPLETE_MS }), HANDOFF_READY_MS);
}

test("inspection resolves the exact received object and returns immutable scalar declarations with paths", () => {
  const record = { evidence_id: "a", issuer: { issuer_id: "issuer-a" }, signature: "declared-signature", evidence_payload: { result: { label: "An actual received label", details: { status: "DECLARED", opaque: { imaginary: true } } } } };
  const { raw, graph } = project([member("a")], { sourceBundle: { canonical_evidence_objects: [record] } });
  const before = JSON.stringify(graph);
  const result = readInspectionEvidence(raw, graph.nodes[0]!);
  assert.equal(result.status, "FOUND"); assert.equal(result.sourcePath, "sourceBundle.canonical_evidence_objects[0]");
  assert.deepEqual(result.raw, record); assert.ok(Object.isFrozen(result.raw)); assert.ok(Object.isFrozen(result.fields));
  assert.deepEqual(result.fields.find(field => field.key === "label"), { key: "label", value: "An actual received label", path: "sourceBundle.canonical_evidence_objects[0].evidence_payload.result.label" });
  assert.equal(result.fields.find(field => field.key === "outcome")?.value, "DECLARED");
  assert.ok(result.fields.every(field => typeof field.value === "string" && !field.value.includes("imaginary")));
  assert.equal("verdict" in result, false); assert.equal(JSON.stringify(graph), before);
  assert.throws(() => { (result.raw as Record<string, unknown>).evidence_id = "changed"; }, TypeError);
});

test("missing, duplicate and unsupported received sources never borrow an object's context", () => {
  const { graph } = project([member("a")]); const node = graph.nodes[0]!;
  assert.equal(readInspectionEvidence("not JSON", node).status, "INVALID_JSON");
  for (const raw of ["{}", "null", "[]", JSON.stringify({ sourceBundle: { canonical_evidence_objects: [{ evidence_id: "b" }] } })]) {
    const result = readInspectionEvidence(raw, node); assert.equal(result.status, "MISSING"); assert.equal(result.raw, null); assert.deepEqual(result.fields, []);
  }
  const result = readInspectionEvidence(JSON.stringify({ sourceBundle: { canonical_evidence_objects: [{ evidence_id: "a" }, { evidence_id: "a" }] } }), node);
  assert.equal(result.status, "AMBIGUOUS"); assert.deepEqual(result.fields, []); assert.ok(result.issues.length);
});

test("runtime inspection separates selected/resolved models, execution/storage and absent devices", () => {
  const record = { receiptId: "route", executionLocality: "LOCAL", evidenceLocality: "RECONCILED", payload: { trust_domain: "ROUTING", execution_scope: "DEMO_PRESENTATION_RUNTIME", routing_provenance: {
    selected_source: "A", selected_model: "model-A", selected_provider: "provider-A", resolved_source: "B", resolved_model: "model-B", resolved_provider: "provider-B",
    candidate_set: [{ source_id: "A", model_id: "model-A", provider_id: "provider-A", execution_truth: "SIMULATED_REMOTE" }, { source_id: "B", model_id: "model-B", provider_id: "provider-B", execution_truth: "SIMULATED_LOCAL" }], fallback: { reason_code: "SOURCE_UNAVAILABLE" },
  } } };
  const { raw, graph } = project([member("route", [], [], "ROUTING", "RUNTIME_JOURNAL")], { runtimeRecords: [record] });
  const result = readInspectionEvidence(raw, graph.nodes[0]!); const field = (key: string) => result.fields.find(entry => entry.key === key);
  assert.equal(field("selectedModel")?.value, "model-A"); assert.equal(field("resolvedModel")?.value, "model-B");
  assert.equal(field("selectedProvider")?.value, "provider-A"); assert.equal(field("resolvedProvider")?.value, "provider-B");
  assert.equal(field("executionLocality")?.value, "LOCAL"); assert.equal(field("evidenceLocality")?.value, "RECONCILED");
  assert.equal(field("executionTruth")?.value, "SIMULATED_LOCAL"); assert.match(field("executionTruth")!.path, /candidate_set\[1\]/);
  assert.equal(field("runtime"), undefined); assert.equal(field("device"), undefined); assert.equal(field("signature"), undefined);
  const duplicated = JSON.parse(raw); duplicated.runtimeRecords[0].payload.routing_provenance.candidate_set.push(record.payload.routing_provenance.candidate_set[1]);
  const ambiguous = readInspectionEvidence(JSON.stringify(duplicated), graph.nodes[0]!);
  assert.ok(ambiguous.issues.some(issue => issue.includes("ambiguous resolved candidate"))); assert.equal(ambiguous.fields.some(entry => entry.key === "executionTruth"), false);
});

test("network restoration stays a transition whose new durable state is CONNECTED", () => {
  const { raw, graph } = project([member("network", [], [], "NETWORK", "RUNTIME_JOURNAL")], { runtimeRecords: [{ receiptId: "network", eventType: "NETWORK_LINK_RESTORED", payload: { previous_network_state: "LOST", new_network_state: "CONNECTED" } }] });
  const fields = readInspectionEvidence(raw, graph.nodes[0]!).fields;
  assert.equal(fields.find(field => field.key === "previousNetworkState")?.value, "LOST");
  assert.equal(fields.find(field => field.key === "newNetworkState")?.value, "CONNECTED");
  assert.equal(fields.some(field => field.value === "RESTORED"), false);
});

test("supporting trusted-time declarations bind by subject ID and never imply validation", () => {
  const source = [{ evidence_id: "a" }, { evidence_id: "time-a", evidence_payload: { trusted_time: { subject_evidence_id: "a", trusted_time: "2026-08-05T00:00:00Z", time_profile: "DEMO_ONLY" } } }];
  const { raw, graph } = project([member("a")], { sourceBundle: { canonical_evidence_objects: source } });
  const result = readInspectionEvidence(raw, graph.nodes[0]!);
  assert.equal(result.fields.find(field => field.key === "trustedTime")?.value, "2026-08-05T00:00:00Z");
  assert.equal("trustedTimeVerified" in result, false);
  const duplicate = JSON.parse(raw); duplicate.sourceBundle.canonical_evidence_objects.push(source[1]);
  const ambiguous = readInspectionEvidence(JSON.stringify(duplicate), graph.nodes[0]!);
  assert.equal(ambiguous.fields.some(field => field.key === "trustedTime"), false); assert.ok(ambiguous.issues.length);
});

test("boundary groups retain exactly the existing edge keys and distinguish reverse crossings", () => {
  const { graph } = project([member("a", [], [], "A"), member("b", ["a"], [], "B"), member("c", ["a"], [], "B"), member("d", ["b"], [], "A"), member("outside"), member("observer", [], ["d"], "C")]);
  const before = JSON.stringify(graph); const groups = groupInspectionBoundaries(graph);
  const forward = groups.find(group => group.from === "A" && group.to === "B")!;
  assert.deepEqual(forward.edgeKeys, ["member:0>member:1", "member:0>member:2"]);
  assert.ok(groups.some(group => group.from === "B" && group.to === "A"));
  assert.ok(Object.isFrozen(groups)); assert.ok(Object.isFrozen(forward.edgeKeys)); assert.equal(JSON.stringify(graph), before);
  const emphasis = inspectionEmphasis(graph, { boundaryKey: forward.key }, "isolate", []);
  assert.deepEqual([...emphasis.strongEdges], [...forward.edgeKeys]);
  assert.deepEqual([...emphasis.strong].sort(), ["member:0", "member:1", "member:2"]);
  assert.ok(emphasis.context.has("member:3")); assert.equal(emphasis.strong.has("member:4"), false);
  const follow = inspectionEmphasis(graph, { boundaryKey: forward.key }, "follow", []);
  assert.deepEqual([...follow.strong].sort(), ["member:0", "member:1", "member:2", "member:3"]);
  assert.deepEqual([...follow.strongEdges].sort(), ["member:0>member:1", "member:0>member:2", "member:1>member:3"]);
  assert.ok(follow.context.has("member:5")); assert.equal(follow.strongEdges.has("member:3>member:5"), false);
  assert.equal(follow.strong.has("member:4"), false);
});

test("Follow walks causal ancestors and consequences without promoting siblings or observed inputs", () => {
  const { graph } = project([member("a"), member("b", ["a"]), member("c", ["b"]), member("sibling", ["a"]), member("observation"), member("observer", [], ["b"]), member("outside")]);
  const extra = project([member("a"), member("b", ["a"], ["observation"]), member("c", ["b"]), member("sibling", ["a"]), member("observation"), member("observer", [], ["b"]), member("outside")]).graph;
  const before = JSON.stringify(extra); const follow = inspectionEmphasis(extra, { nodeKey: "member:1" }, "follow", []);
  assert.deepEqual([...follow.strong].sort(), ["member:0", "member:1", "member:2"]);
  assert.deepEqual([...follow.strongEdges].sort(), ["member:0>member:1", "member:1>member:2"]);
  assert.deepEqual([...follow.context].sort(), ["member:3", "member:4", "member:5"]);
  assert.equal(JSON.stringify(extra), before);
  const isolated = inspectionEmphasis(graph, { nodeKey: "member:1" }, "isolate", []);
  assert.deepEqual([...isolated.strong], ["member:1"]); assert.equal(isolated.strongEdges.size, 0);
  const invalidPath = inspectionEmphasis(graph, {}, "path", ["member:0", "member:2", "phantom"]);
  assert.equal(invalidPath.strongEdges.size, 0); assert.equal(invalidPath.strong.has("phantom"), false);
});

test("Follow is cycle-safe and all mode changes emphasis without dropping any graph object", () => {
  const { graph } = project([member("a", ["b"]), member("b", ["a"]), member("other")]);
  assert.equal(inspectionEmphasis(graph, { nodeKey: "member:0" }, "follow", []).strong.size, 2);
  const all = inspectionEmphasis(graph, {}, "all", []);
  assert.equal(all.strong.size, graph.nodes.length); assert.equal(all.strongEdges.size, graph.edges.length);
});

test("real verifier coverage binds exact received bytes and never calls runtime signatures verified", async () => {
  const artifact = fixture(); const peb = inspectReceivedPeb(artifact.pebText); const graph = projectReceivedGraph(peb, artifact.pebText);
  const snapshot = await analyzeInsertedD006Peb(insertD006PebForAnalysis({ pebText: artifact.pebText, expectedIdentity: artifact.identity, expectedTransferredContentDigest: artifact.transferredContentDigest }));
  const signed = graph.nodes.find(node => node.member?.source === "SIGNED_CANONICAL")!;
  const runtime = graph.nodes.find(node => node.member?.source === "RUNTIME_JOURNAL")!;
  const final = graph.nodes.find(node => node.final)!;
  assert.equal(inspectionCoverage(peb, null, signed).signature, "NOT_ESTABLISHED");
  const coverage = inspectionCoverage(peb, snapshot, signed);
  assert.equal(coverage.bound, true); assert.equal(coverage.signature, "BUNDLE_CHECK_PASSED");
  assert.deepEqual(coverage.completedChecks, snapshot.result.completedChecks); assert.equal("factEstablished" in coverage, false);
  assert.equal(inspectionCoverage(peb, snapshot, runtime).signature, "NO_INDIVIDUAL_SIGNATURE");
  assert.equal(inspectionCoverage(peb, snapshot, final).signature, "NO_INDIVIDUAL_SIGNATURE");
  const stale = inspectionCoverage(inspectReceivedPeb(artifact.pebText + " "), snapshot, signed);
  assert.equal(stale.bound, false); assert.deepEqual(stale.completedChecks, []); assert.equal(stale.finalReceiptInput, null); assert.equal(stale.signature, "NOT_ESTABLISHED");
  const finalEvidence = readInspectionEvidence(artifact.pebText, final);
  assert.equal(finalEvidence.sourcePath, "finalReceipt");
  assert.ok(finalEvidence.fields.some(field => field.path === "finalReceipt.financialClosure.settlementStatus" && field.value === "NOT_DEMONSTRATED"));
  assert.equal("verdict" in finalEvidence, false);
});

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { MISSION_ID } from "../app/missionContinuity.ts";
import { projectMissionEvidence } from "../app/missionEvidence.ts";
import { createOfflineEvidenceSession, sealFinalReceiptRuntimeEvidence } from "../app/offlineEvidence.ts";
import { buildMissionEvidenceClosure, buildPortableMissionEvidenceBundle, createHandoffArtifact, finalReceiptRuntimeEvidencePrefix, issueFinalMissionReceipt, transferredContentDigest } from "../app/portableMissionEvidence.ts";
import { projectPortableProofLeaves } from "../app/proofProjection.ts";
import { FINAL_RECEIPT_EMITTED_MS, HANDOFF_READY_MS, PEB_COMPLETE_MS } from "../app/storyTimeline.ts";
import { inspectReceivedPeb } from "../app/verify/inspectReceivedPeb.ts";

function fixture() {
  const runId = "fortix.demo.fsr2.run.received-inspection";
  let journal = projectMissionEvidence(createOfflineEvidenceSession(runId, null, MISSION_ID), FINAL_RECEIPT_EMITTED_MS);
  journal = sealFinalReceiptRuntimeEvidence(journal, FINAL_RECEIPT_EMITTED_MS);
  const records = finalReceiptRuntimeEvidencePrefix(journal);
  const closure = buildMissionEvidenceClosure({ identity: { missionId: MISSION_ID, runId }, runtimeRecords: records, asOfMasterTimeMs: FINAL_RECEIPT_EMITTED_MS });
  const finalReceipt = issueFinalMissionReceipt(closure, FINAL_RECEIPT_EMITTED_MS);
  const displayedEvidenceIds = projectPortableProofLeaves(closure, PEB_COMPLETE_MS, finalReceipt).map(leaf => leaf.evidenceId);
  return createHandoffArtifact(buildPortableMissionEvidenceBundle({ closure, finalReceipt, runtimeRecords: records, displayedEvidenceIds, masterTimeMs: PEB_COMPLETE_MS }), HANDOFF_READY_MS);
}
const artifact = fixture();

test("FS-R2 inspection projects the received canonical package, never a fixed demonstration graph", () => {
  const inspected = inspectReceivedPeb(artifact.pebText);
  assert.equal(inspected.parseStatus, "OBJECT");
  assert.equal(inspected.bundleId, artifact.peb.bundleId);
  assert.equal(inspected.transferDigest, artifact.transferredContentDigest);
  assert.equal(inspected.byteLength, new TextEncoder().encode(artifact.pebText).byteLength);
  assert.equal(inspected.manifestDigest, artifact.peb.manifest.bundleDigest);
  assert.deepEqual(inspected.identity, artifact.identity);
  assert.equal(inspected.finalReceiptId, artifact.finalReceipt.receiptId);
  assert.equal(inspected.finalReceipt?.evidenceSetDigest, artifact.finalReceipt.evidenceSetDigest);
  assert.equal(inspected.memberCount, artifact.peb.manifest.memberRefs.length);
  assert.deepEqual(inspected.members.map(member => member.evidenceId), artifact.peb.manifest.memberRefs.map(member => member.evidenceId));
  assert.equal(inspected.relations.length, artifact.peb.manifest.memberRefs.reduce((count, member) => count + member.causalParents.length + member.observedInputs.length, 0) + artifact.finalReceipt.causalInputEvidenceIds.length);
  assert.deepEqual(inspected.issues, []);
});

test("FS-R2 inspection uses the exact bytes: whitespace changes fingerprint without rewriting declared identity", () => {
  const first = inspectReceivedPeb(artifact.pebText);
  const formattedText = JSON.stringify(JSON.parse(artifact.pebText), null, 2);
  const second = inspectReceivedPeb(formattedText);
  assert.equal(second.bundleId, first.bundleId);
  assert.equal(second.manifestDigest, first.manifestDigest);
  assert.notEqual(second.transferDigest, first.transferDigest);
  assert.equal(second.transferDigest, transferredContentDigest(formattedText));
});

test("FS-R2 inspection preserves typed explicit relations and leaves disconnected members disconnected", () => {
  const received = JSON.parse(artifact.pebText);
  received.manifest.memberRefs = [
    { evidenceId: "a", timeMs: 100, causalParents: [], observedInputs: [] },
    { evidenceId: "b", timeMs: 101, causalParents: ["a"], observedInputs: ["outside"] },
    { evidenceId: "c", timeMs: 102, causalParents: [], observedInputs: [] },
  ];
  received.finalReceipt.causalInputEvidenceIds = ["b"];
  const before = JSON.stringify(received);
  const inspected = inspectReceivedPeb(before);
  assert.deepEqual(inspected.relations.map(({ kind, from, to, referenceStatus }) => ({ kind, from, to, referenceStatus })), [
    { kind: "CAUSAL_PARENT", from: "a", to: "b", referenceStatus: "PRESENT" },
    { kind: "OBSERVED_INPUT", from: "outside", to: "b", referenceStatus: "UNRESOLVED" },
    { kind: "FINAL_RECEIPT_INPUT", from: "b", to: artifact.finalReceipt.receiptId, referenceStatus: "PRESENT" },
  ]);
  assert.equal(inspected.relations.some(relation => relation.from === "c" || relation.to === "c"), false);
  assert.equal(JSON.stringify(received), before);
  assert.equal("verdict" in inspected, false);
});

test("FS-R2 inspection does not hide malformed entries, unresolved references or duplicate identities", () => {
  const received = JSON.parse(artifact.pebText);
  received.manifest.memberRefs = [
    null,
    { evidenceId: "duplicate", causalParents: [], observedInputs: [] },
    { evidenceId: "duplicate", causalParents: [], observedInputs: [] },
    { evidenceId: "target", causalParents: ["duplicate", "missing", 7], observedInputs: "invalid" },
  ];
  received.finalReceipt.causalInputEvidenceIds = [];
  const inspected = inspectReceivedPeb(JSON.stringify(received));
  assert.equal(inspected.memberCount, 4);
  assert.equal(inspected.members.length, 4);
  assert.equal(inspected.members[0]?.evidenceId, null);
  assert.deepEqual(inspected.relations.map(relation => relation.referenceStatus), ["AMBIGUOUS", "UNRESOLVED", "UNRESOLVED"]);
  assert.ok(inspected.issues.includes("manifest.memberRefs[0]"));
  assert.ok(inspected.issues.includes("duplicate evidenceId: duplicate"));
  assert.ok(inspected.issues.includes("manifest.memberRefs[3].causalParents[2]"));
  assert.ok(inspected.issues.includes("manifest.memberRefs[3].observedInputs"));
});

test("FS-R2 unreadable or unsupported packages remain inspectable without fabricated metadata", () => {
  for (const text of ["not-json", "null", "[]", "{}", "{\"profile\":\"unknown\",\"manifest\":{\"memberRefs\":false}}", "\uFEFF" + artifact.pebText]) {
    const inspected = inspectReceivedPeb(text);
    assert.equal(inspected.bundleId, null);
    assert.equal(inspected.finalReceiptId, null);
    assert.equal(inspected.memberCount, null);
    assert.equal(inspected.transferDigest, transferredContentDigest(text));
    assert.deepEqual(inspected.members, []);
    assert.deepEqual(inspected.relations, []);
    assert.ok(inspected.issues.length > 0);
  }
});

test("FS-R2 inspection is available before Analyze and renders unverified declarations plus exact raw text", () => {
  const component = readFileSync(new URL("../app/verify/ReceivedPebInspection.tsx", import.meta.url), "utf8");
  const projection = readFileSync(new URL("../app/verify/inspectReceivedPeb.ts", import.meta.url), "utf8");
  assert.doesNotMatch(component + projection, /canonicalGraph|analyzeInsertedD006Peb|insertD006PebForAnalysis|window\.fetch|fetch\(/);
  assert.match(component, /analyzed \? c\.after : c\.before/);
  assert.match(component, /<pre>\{text\}<\/pre>/);
  assert.match(component, /referenceStatus/);
  assert.match(component, /not verified claims/);
  assert.match(component, /pas des faits vérifiés/);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { MISSION_ID } from "../app/missionContinuity.ts";
import { projectMissionEvidence } from "../app/missionEvidence.ts";
import { derivePublicExperience } from "../app/nx/adapter/publicExperienceAdapter.ts";
import type { EngineSnapshot } from "../app/nx/adapter/engineSnapshot.ts";
import { createOfflineEvidenceSession, sealFinalReceiptRuntimeEvidence } from "../app/offlineEvidence.ts";
import { derivePassengerPresentation } from "../app/passengerPresentation.ts";
import { derivePhysicalState } from "../app/physicalState.ts";
import {
  buildMissionEvidenceClosure,
  buildPortableMissionEvidenceBundle,
  createHandoffArtifact,
  finalReceiptRuntimeEvidencePrefix,
  issueFinalMissionReceipt,
  routingProvenanceFromRuntimeRecords,
} from "../app/portableMissionEvidence.ts";
import { projectPortableProofLeaves } from "../app/proofProjection.ts";
import { projectReceiptBindings } from "../app/receiptProjection.ts";
import { nextTransferStage, resolveArtifactRelease } from "../app/reviewFlow.ts";
import { CANONICAL_ROUTING_PROVENANCE, deriveRoutingState } from "../app/routingProvenance.ts";
import { EXPERIENCE_DURATION_MS, FINAL_RECEIPT_EMITTED_MS, HANDOFF_READY_MS, PEB_COMPLETE_MS, evidenceGatedStoryTime } from "../app/storyTimeline.ts";
import { derivePresentationMotion } from "../app/vehiclePresentation.ts";
import { VISUAL_EVENTS } from "../app/visualEvents.ts";

/**
 * D-006/NX3 — PEB TRANSPORT: PICK ≠ OPEN ≠ DROP (mandate §11–§15, tests 6–12).
 *
 * The rule the whole verifier surface rests on:
 *
 *     Opening the verifier does NOT transfer the PEB.
 *
 * The transfer stage machine had both steps all along — GATHER then SEND —
 * and `resolveArtifactRelease` already knew what a carried artifact may do.
 * These tests hold the machine and the public model to that: FORMED is a hand,
 * not a verifier; only INSERT from FORMED reaches TRANSFERRED; and nothing
 * about analysis can begin before it.
 *
 * Every assertion runs on the engine's own objects — a real closure, Final
 * Receipt, bundle and handoff artifact — never on a hand-written state.
 */

const RUN_ID = "fortix.demo.d006nx3.run.transport";

function materialise(): EngineSnapshot {
  let journal = projectMissionEvidence(createOfflineEvidenceSession(RUN_ID, null, MISSION_ID), FINAL_RECEIPT_EMITTED_MS);
  journal = sealFinalReceiptRuntimeEvidence(projectMissionEvidence(journal, FINAL_RECEIPT_EMITTED_MS), FINAL_RECEIPT_EMITTED_MS);
  const records = finalReceiptRuntimeEvidencePrefix(journal);
  const closure = buildMissionEvidenceClosure({ identity: { missionId: MISSION_ID, runId: RUN_ID }, runtimeRecords: records, asOfMasterTimeMs: FINAL_RECEIPT_EMITTED_MS });
  const finalReceipt = issueFinalMissionReceipt(closure, FINAL_RECEIPT_EMITTED_MS);
  const displayed = projectPortableProofLeaves(closure, PEB_COMPLETE_MS, finalReceipt).map((leaf) => leaf.evidenceId);
  const portablePeb = buildPortableMissionEvidenceBundle({ closure, finalReceipt, runtimeRecords: records, displayedEvidenceIds: displayed, masterTimeMs: PEB_COMPLETE_MS });
  const handoffArtifact = createHandoffArtifact(portablePeb, HANDOFF_READY_MS);
  const provenance = routingProvenanceFromRuntimeRecords(records);
  const admissible = provenance !== null;
  const at = EXPERIENCE_DURATION_MS;
  const effective = evidenceGatedStoryTime(at, admissible);
  const routing = deriveRoutingState(admissible ? at : 0, provenance ?? CANONICAL_ROUTING_PROVENANCE);
  const authorized = admissible && routing.vehicleMayExecute;
  const physical = derivePhysicalState(at, authorized);
  return {
    masterTimeMs: at, effectiveStoryTimeMs: effective, playing: false, session: journal, closure, closureReason: null,
    receiptBindings: projectReceiptBindings(closure, VISUAL_EVENTS), finalReceipt, humanDecision: "APPROVED",
    networkState: "UNKNOWN", linkObservationCurrent: false, linkPhase: "UNKNOWN", sentinelReachable: false, transitionFlash: null,
    unsequencedObservation: null, reconciliation: null, baseTransfer: null, syncPhase: "IDLE", portablePeb, handoffArtifact,
    transferStage: "SOURCE", analysisRequested: false, verification: null, handoffNetworkState: null, verdictNetworkState: null,
    physical, motion: derivePresentationMotion(at, authorized), passenger: derivePassengerPresentation(effective, physical.passengerState), routing,
  };
}

const READY = materialise();
const at = (overrides: Partial<EngineSnapshot>) => derivePublicExperience({ ...READY, ...overrides });
const source = (relative: string) => readFileSync(new URL(`../app/nx/${relative}`, import.meta.url), "utf8");
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

test("NX3-T06: PICK is not DROP — a picked-up PEB is in a hand, and the verifier reports it as not received", () => {
  const picked = nextTransferStage("SOURCE", "GATHER");
  assert.equal(picked, "FORMED");
  assert.notEqual(picked, "TRANSFERRED");
  const model = at({ transferStage: picked });
  assert.equal(model.handoff.stage, "CARRIED", "the public model names the carried state, not the received one");
  assert.equal(model.portableEvidence.state, "IN_TRANSIT");
  assert.equal(model.verification.state, "NOT_APPLICABLE");
  assert.equal(model.handoff.receivedWhileLinkLost, null, "nothing was received, so no receipt-time link state exists");
});

test("NX3-T07: OPEN is not transfer — `?peb=picked` opens the verifier and performs exactly one GATHER, never a SEND", () => {
  const page = code(readFileSync(new URL("../app/nx/page.tsx", import.meta.url), "utf8"));
  assert.match(page, /verifier: one\("verifier"\) === "open" \|\| one\("peb"\) === "picked"/, "the picked link opens the verifier surface");
  assert.match(page, /const pebPicked = one\("peb"\) === "picked" && !handoffDone;/, "the picked link is a review act, subordinate to a declared handoff");
  const engine = code(source("adapter/useMissionEngine.ts"));
  assert.match(engine, /options\.pebPicked \? nextTransferStage\("SOURCE", "GATHER"\) : "SOURCE"/, "picked = one GATHER");
  assert.doesNotMatch(engine, /options\.pebPicked[^\n]*"SEND"/, "picked never SENDs");
  // And the public model of that exact stage is not HANDED_OVER.
  assert.notEqual(at({ transferStage: "FORMED" }).handoff.stage, "HANDED_OVER");
});

test("NX3-T07b: a review link that declares an act but names no moment renders at the end, where the act can apply", () => {
  // Four differently named state captures once came out byte-identical: the
  // links declared acts without ?t, so the page rendered at t = 0, before the
  // artifact existed, and none of the declared acts had anything to apply to.
  const page = code(readFileSync(new URL("../app/nx/page.tsx", import.meta.url), "utf8"));
  assert.match(page, /const declaresAct = one\("handoff"\) === "done" \|\| one\("analysis"\) === "requested" \|\| one\("peb"\) === "picked";/);
  assert.match(page, /return declaresAct \? EXPERIENCE_DURATION_MS : 0;/, "an act without a moment means the end of the experience");
  assert.match(page, /if \(Number\.isFinite\(value\) && value > 0\) return Math\.round\(value\);/, "an explicit ?t still wins");
});

test("NX3-T08: the verifier holds no PEB before DROP", () => {
  for (const stage of ["SOURCE", "FORMED"] as const) {
    const model = at({ transferStage: stage });
    assert.notEqual(model.handoff.stage, "HANDED_OVER", `${stage}: not handed over`);
    assert.notEqual(model.portableEvidence.state, "RECEIVED", `${stage}: not received`);
    assert.equal(model.verification.state, "NOT_APPLICABLE", `${stage}: nothing to verify`);
    assert.equal(model.verification.verdict, null, `${stage}: no verdict`);
  }
});

test("NX3-T09: an unsuccessful DROP transfers nothing and enables no analysis", () => {
  assert.equal(resolveArtifactRelease("SOURCE", "INSERT"), "SOURCE", "a drop without a pick is nothing");
  assert.equal(resolveArtifactRelease("FORMED", "MISS"), "SOURCE", "a miss puts the PEB back");
  assert.equal(resolveArtifactRelease("FORMED", "CANCEL"), "SOURCE", "a cancel puts the PEB back");
  // Even with an analysis request on record, nothing was transferred, so
  // nothing is analyzed: the request cannot outrun the transfer.
  const model = at({ transferStage: "SOURCE", analysisRequested: true });
  assert.notEqual(model.verification.state, "ANALYZING");
  assert.notEqual(model.verification.state, "VERDICT");
  assert.equal(model.verification.verdict, null);
});

test("NX3-T10: a successful DROP transfers, and only then is ANALYZE available", () => {
  assert.equal(resolveArtifactRelease("FORMED", "INSERT"), "TRANSFERRED");
  const dropped = at({ transferStage: "TRANSFERRED", handoffNetworkState: "CONNECTED" });
  assert.equal(dropped.handoff.stage, "HANDED_OVER");
  assert.equal(dropped.portableEvidence.state, "RECEIVED");
  assert.equal(dropped.verification.state, "AWAITING_HUMAN", "received, and waiting for a person to ask");
  assert.equal(dropped.verification.verdict, null, "no verdict before ANALYZE");
  assert.equal(dropped.handoff.transferredContentDigest, READY.handoffArtifact!.transferredContentDigest, "exactly the bytes dropped");
});

test("NX3-T11/T12: no verdict before ANALYZE, and no automatic ANALYZE anywhere in the engine", () => {
  const received = at({ transferStage: "TRANSFERRED" });
  assert.equal(received.verification.state, "AWAITING_HUMAN");
  assert.equal(received.verification.verdict, null);
  const requested = at({ transferStage: "TRANSFERRED", analysisRequested: true });
  assert.equal(requested.verification.state, "ANALYZING", "analysis begins on the explicit request");
  assert.equal(requested.verification.verdict, null, "and still yields no verdict by itself — the verifier's result does");

  const engine = code(source("adapter/useMissionEngine.ts"));
  const requests = engine.match(/setAnalysisRequested\(true\)/g) ?? [];
  assert.equal(requests.length, 1, "exactly one place requests analysis");
  assert.match(engine, /const analyze = useCallback\(\(\) => \{\s*if \(effectiveTransferStage !== "TRANSFERRED"\) return;\s*if \(!canVerifyLocally\(\)\) \{ setAnalysisRequested\(false\); return; \}\s*setAnalysisRequested\(true\);/, "…and it is the human's ANALYZE act, refused before a transfer or without browser crypto");
  // The nearest enclosing hook of that one request is the ANALYZE callback,
  // not an effect: nothing fires it because the artifact arrived, because the
  // link changed, or because time passed.
  const request = engine.indexOf("setAnalysisRequested(true)");
  const before = engine.slice(0, request);
  assert.ok(before.lastIndexOf("const analyze = useCallback(") > before.lastIndexOf("useEffect("), "the request lives in the ANALYZE act, not in an effect");
});

test("NX3: the engine exposes pick, drop and release as distinct acts; the surfaces never fuse them", () => {
  const engine = code(source("adapter/useMissionEngine.ts"));
  assert.match(engine, /const pick = useCallback\(\(\) => \{[^]*?nextTransferStage\(stage, "GATHER"\)/, "PICK is GATHER");
  assert.match(engine, /const drop = useCallback\(\(\) => \{[^]*?resolveArtifactRelease\(stage, "INSERT"\)/, "DROP is INSERT");
  assert.match(engine, /const release = useCallback\(\(\) => \{[^]*?resolveArtifactRelease\(stage, "CANCEL"\)/, "RELEASE is CANCEL");
  // The link state is captured at receipt — the drop — and not at the pick.
  assert.match(engine, /const drop = useCallback[^]*?setHandoffNetworkState/, "receipt-time link state is recorded at DROP");
  assert.doesNotMatch(engine, /const pick = useCallback\(\(\) => \{[^]*?setHandoffNetworkState[^]*?\}, \[handoffArtifact\]\);\s*const drop/, "…and not at PICK");
});

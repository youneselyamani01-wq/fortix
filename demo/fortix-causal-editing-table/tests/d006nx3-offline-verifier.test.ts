import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { MISSION_ID } from "../app/missionContinuity.ts";
import { projectMissionEvidence } from "../app/missionEvidence.ts";
import { derivePublicExperience } from "../app/nx/adapter/publicExperienceAdapter.ts";
import type { EngineSnapshot } from "../app/nx/adapter/engineSnapshot.ts";
import { CHECK_CATEGORY } from "../app/nx/verifier/choreography.ts";
import { createOfflineEvidenceSession, sealFinalReceiptRuntimeEvidence } from "../app/offlineEvidence.ts";
import { analyzeInsertedD006Peb, insertD006PebForAnalysis, type D006VerdictSnapshot } from "../app/offlineVerification.ts";
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
import { CANONICAL_ROUTING_PROVENANCE, deriveRoutingState } from "../app/routingProvenance.ts";
import { EXPERIENCE_DURATION_MS, FINAL_RECEIPT_EMITTED_MS, HANDOFF_READY_MS, PEB_COMPLETE_MS, evidenceGatedStoryTime } from "../app/storyTimeline.ts";
import { derivePresentationMotion } from "../app/vehiclePresentation.ts";
import { VISUAL_EVENTS } from "../app/visualEvents.ts";

/**
 * D-006/NX3 — OFFLINE VERIFICATION IS PRESERVED (mandate §21–§22; tests 16–19).
 *
 * The verifier carries its own pinned directory. It receives the PEB and
 * verifies it while the link is LOST, the surface says that this was so, a
 * reconnection is never required before a verdict and never changes one, and
 * the one network model the page already has — the sentinel's observed link
 * phase — is the only one the verifier reads. Every assertion on state runs
 * on the engine's own objects: a real closure, Final Receipt, bundle,
 * handoff artifact and the verifier's real result for those bytes.
 */

const RUN_ID = "fortix.demo.d006nx3.run.offline";

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
const artifact = READY.handoffArtifact!;
const at = (overrides: Partial<EngineSnapshot>) => derivePublicExperience({ ...READY, ...overrides });
const source = (relative: string) => readFileSync(new URL(`../app/${relative}`, import.meta.url), "utf8");
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/** The verifier's real result for the real bytes, produced with every network primitive tripwired. */
async function verifyWithTripwire(): Promise<Readonly<{ snapshot: D006VerdictSnapshot; attempted: readonly string[] }>> {
  const attempted: string[] = [];
  const original = { fetch: globalThis.fetch, XMLHttpRequest: (globalThis as Record<string, unknown>).XMLHttpRequest, WebSocket: (globalThis as Record<string, unknown>).WebSocket };
  const trip = (name: string) => (): never => { attempted.push(name); throw new Error(`${name} is not available to the verifier`); };
  Object.assign(globalThis, { fetch: trip("fetch"), XMLHttpRequest: trip("XMLHttpRequest"), WebSocket: trip("WebSocket") });
  try {
    const inserted = insertD006PebForAnalysis({
      pebText: artifact.pebText,
      expectedIdentity: artifact.identity,
      expectedTransferredContentDigest: artifact.transferredContentDigest,
    });
    return { snapshot: await analyzeInsertedD006Peb(inserted), attempted };
  } finally {
    Object.assign(globalThis, original);
  }
}

test("NX3-T16: the verifier verifies the real handoff bytes with no network at all", async () => {
  const { snapshot, attempted } = await verifyWithTripwire();
  assert.deepEqual(attempted, [], "no fetch, no XHR, no socket");
  assert.ok(["VALID", "INVALID", "INDETERMINATE", "REVOKED"].includes(snapshot.result.verdict), `a canonical word: ${snapshot.result.verdict}`);
  assert.equal(snapshot.transferredContentDigest, artifact.transferredContentDigest, "the result names the exact bytes it analyzed");
  assert.equal(snapshot.identity.runId, RUN_ID);
  assert.ok(snapshot.result.completedChecks.length >= 10, `the checks it completed: ${snapshot.result.completedChecks.length}`);
  for (const check of snapshot.result.completedChecks) assert.ok(check in CHECK_CATEGORY, `${check} is a check the surface knows how to file`);
  assert.ok(Object.isFrozen(snapshot.result), "the result is immutable as it came");
});

test("NX3-T17: a PEB received and verified while the link is LOST yields a verdict, and the surface says it was offline", async () => {
  const { snapshot } = await verifyWithTripwire();
  const offline = at({
    transferStage: "TRANSFERRED", analysisRequested: true, verification: snapshot.result,
    networkState: "LOST", linkPhase: "LOST", linkObservationCurrent: true, sentinelReachable: true,
    handoffNetworkState: "LOST", verdictNetworkState: "LOST",
  });
  assert.equal(offline.network.linkPhase, "LOST");
  assert.equal(offline.handoff.stage, "HANDED_OVER");
  assert.equal(offline.handoff.receivedWhileLinkLost, true, "received while the link was lost");
  assert.equal(offline.verification.state, "VERDICT");
  assert.equal(offline.verification.verdict, snapshot.result.verdict, "the verdict is the verifier's, link or no link");
  assert.equal(offline.verification.verifiedWhileLinkLost, true, "verified while the link was lost");
  assert.deepEqual([...offline.verification.completedChecks], [...snapshot.result.completedChecks]);
  // The surface carries both facts as attributes and as words.
  const surface = code(source("nx/verifier/VerifierSurface.tsx"));
  assert.match(surface, /data-received-offline=\{handoff\.receivedWhileLinkLost === null \? "" : String\(handoff\.receivedWhileLinkLost\)\}/);
  assert.match(surface, /data-verified-offline=\{verification\.verifiedWhileLinkLost === null \? "" : String\(verification\.verifiedWhileLinkLost\)\}/);
  assert.match(surface, /\{handoff\.receivedWhileLinkLost === true && <b>\{copy\.receivedOffline\}<\/b>\}/);
  assert.match(surface, /\{verification\.verifiedWhileLinkLost === true && <b>\{copy\.verdictOffline\}<\/b>\}/);
});

test("NX3-T18: no reconnection is required before a verdict, and a reconnection changes no verdict", async () => {
  const { snapshot } = await verifyWithTripwire();
  // Analysis proceeds with the link LOST: the request is honoured, not held.
  const analyzing = at({ transferStage: "TRANSFERRED", analysisRequested: true, verification: null, networkState: "LOST", linkPhase: "LOST" });
  assert.equal(analyzing.verification.state, "ANALYZING");
  // The engine's analysis reads the artifact and the request — never the link.
  const engine = code(source("nx/adapter/useMissionEngine.ts"));
  const start = engine.indexOf("if (!effectiveAnalysisRequested || handoffArtifact === null || verification !== null) return;");
  assert.ok(start > 0);
  const end = engine.indexOf("}, [analysisRequested, effectiveAnalysisRequested, handoffArtifact, verification]);", start);
  assert.ok(end > start, "the analysis effect has an explicit end before physical-link polling");
  const effect = engine.slice(engine.lastIndexOf("useEffect(", start), end);
  assert.doesNotMatch(effect, /linkPhase|networkState|sentinel|linkReport|navigator/, "the analysis effect has no network input");
  // The one read of the link machine inside the effect annotates WHERE the
  // verdict was produced (setVerdictNetworkState); it gates nothing.
  const machineReads = [...effect.matchAll(/machineRef\.current[^;\n]*/g)].map((match) => match[0]);
  assert.deepEqual(machineReads, ['machineRef.current?.state ?? "UNKNOWN")'], "the machine is read once, to record the verdict's link state");
  assert.match(effect, /setVerdictNetworkState\(machineRef\.current\?\.state \?\? "UNKNOWN"\);/);
  assert.match(engine, /const analyze = useCallback\(\(\) => \{\s*if \(effectiveTransferStage !== "TRANSFERRED"\) return;\s*if \(!canVerifyLocally\(\)\) \{ setAnalysisRequested\(false\); return; \}\s*setAnalysisRequested\(true\);\s*\}, \[effectiveTransferStage\]\);/, "ANALYZE requires receipt and local crypto capability, never a connected link");
  // After the link returns, the same result reads the same — and still says it was produced offline.
  const before = at({ transferStage: "TRANSFERRED", analysisRequested: true, verification: snapshot.result, networkState: "LOST", linkPhase: "LOST", handoffNetworkState: "LOST", verdictNetworkState: "LOST" });
  const after = at({ transferStage: "TRANSFERRED", analysisRequested: true, verification: snapshot.result, networkState: "CONNECTED", linkPhase: "CONNECTED", linkObservationCurrent: true, sentinelReachable: true, handoffNetworkState: "LOST", verdictNetworkState: "LOST" });
  assert.equal(after.verification.verdict, before.verification.verdict);
  assert.deepEqual([...after.verification.reasonCodes], [...before.verification.reasonCodes]);
  assert.deepEqual(after.verification.establishes, before.verification.establishes);
  assert.equal(after.verification.verifiedWhileLinkLost, true, "the record of where it was produced does not change with the link");
  assert.equal(after.network.linkPhase, "CONNECTED");
});

test("NX3-T19: one network model — the verifier's chip reads the page's observed link phase and nothing else", () => {
  const surface = code(source("nx/verifier/VerifierSurface.tsx"));
  const inspect = code(source("nx/verifier/InspectPanel.tsx"));
  const choreography = code(source("nx/verifier/choreography.ts"));
  const experience = code(source("nx/experience/NxExperience.tsx"));
  for (const [name, text] of [["surface", surface], ["inspect", inspect], ["choreography", choreography]] as const) {
    assert.doesNotMatch(text, /fetch\(|XMLHttpRequest|WebSocket|EventSource|navigator\.onLine|visibleLinkPhase|readLinkSentinel/, `${name}: no network call and no second link model`);
  }
  assert.match(surface, /className="nx-link-chip"\s*data-link=\{network\.linkPhase\}/, "the same chip as the page header");
  assert.match(surface, /const linkWord = network\.linkPhase === "CONNECTED" \? copy\.online : network\.linkPhase === "LOST" \? copy\.offline : copy\.unobserved;/);
  const dedicated = code(source("verify/VerifierWorkspace.tsx"));
  assert.doesNotMatch(dedicated, /fetch\(|XMLHttpRequest|WebSocket|EventSource|navigator\.onLine|readLinkSentinel/, "the independent tab adds no surrogate network model and needs no network for analysis");
  assert.match(dedicated, /analyzeInsertedD006Peb\(inserted\)/, "the independent tab uses the same offline verifier locally");
  assert.doesNotMatch(experience, /<VerifierSurface/, "the independent surface is not embedded in the Demo");
  assert.match(experience, /className="nx-link-chip"\s*data-link=\{model\.network\.linkPhase\}/, "…the one the header reads");
  // An unobserved link is never drawn as connected, in the verifier as on the page.
  const unobserved = at({ transferStage: "TRANSFERRED", linkPhase: "UNKNOWN", sentinelReachable: false });
  assert.equal(unobserved.network.linkPhase, "UNKNOWN");
  assert.equal(unobserved.verification.state, "AWAITING_HUMAN", "a received PEB awaits a person, whatever the link");
});

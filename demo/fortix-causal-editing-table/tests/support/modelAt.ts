import { MISSION_ID } from "../../app/missionContinuity.ts";
import { derivePublicExperience } from "../../app/nx/adapter/publicExperienceAdapter.ts";
import type { EngineSnapshot } from "../../app/nx/adapter/engineSnapshot.ts";
import { journalAt } from "../../app/nx/adapter/missionJournal.ts";
import { createOfflineEvidenceSession } from "../../app/offlineEvidence.ts";
import { derivePassengerPresentation } from "../../app/passengerPresentation.ts";
import { derivePhysicalState } from "../../app/physicalState.ts";
import {
  buildMissionEvidenceClosure,
  finalReceiptRuntimeEvidencePrefix,
  issueFinalMissionReceipt,
} from "../../app/portableMissionEvidence.ts";
import { projectReceiptBindings } from "../../app/receiptProjection.ts";
import { CANONICAL_ROUTING_PROVENANCE, deriveRoutingState } from "../../app/routingProvenance.ts";
import { FINAL_RECEIPT_EMITTED_MS } from "../../app/storyTimeline.ts";
import { derivePresentationMotion } from "../../app/vehiclePresentation.ts";
import { VISUAL_EVENTS } from "../../app/visualEvents.ts";

/**
 * The public model of the canonical mission at a master time — the one
 * fixture every NX geometry, reading-order and checkpoint suite starts from.
 *
 * It lived in `d006nx1-proof-geometry.test.ts` and was IMPORTED from there by
 * six other suites; a Node test file imported by another registers its own
 * tests in the importer's process, so every importer re-ran the geometry
 * suite's eight tests and every count (NX1 154, NX3 49) was inflated by
 * them. A helper that is not a test file is imported by all of them now, and
 * the counts are the tests that exist.
 */

export const RUN_ID = "fortix.demo.d006nx1.run.geometry";

/**
 * The public model at a master time, and — since C-R1 — optionally at a given
 * presentation cursor. With no cursor the adapter derives the one an
 * uninterrupted run would be at, which is what every test before C-R1 assumed.
 */
export function modelAt(masterTimeMs: number, presentationTimeMs?: number) {
  const session = journalAt(createOfflineEvidenceSession(RUN_ID, null, MISSION_ID), masterTimeMs);
  const records = session.finalReceiptRuntimeSeal === null ? session.records : finalReceiptRuntimeEvidencePrefix(session);
  const closure = buildMissionEvidenceClosure({ identity: { missionId: MISSION_ID, runId: RUN_ID }, runtimeRecords: records, asOfMasterTimeMs: FINAL_RECEIPT_EMITTED_MS });
  const finalReceipt = masterTimeMs >= FINAL_RECEIPT_EMITTED_MS && session.finalReceiptRuntimeSeal !== null ? issueFinalMissionReceipt(closure, FINAL_RECEIPT_EMITTED_MS) : null;
  const routing = deriveRoutingState(masterTimeMs, CANONICAL_ROUTING_PROVENANCE);
  const physical = derivePhysicalState(masterTimeMs, true);
  const snapshot: EngineSnapshot = {
    masterTimeMs, effectiveStoryTimeMs: masterTimeMs, playing: false, session, closure, closureReason: null,
    receiptBindings: projectReceiptBindings(closure, VISUAL_EVENTS), finalReceipt, humanDecision: "APPROVED",
    networkState: "UNKNOWN", linkObservationCurrent: false, linkPhase: "UNKNOWN", sentinelReachable: false, transitionFlash: null,
    unsequencedObservation: null, reconciliation: null, baseTransfer: null, syncPhase: "IDLE", portablePeb: null, handoffArtifact: null,
    transferStage: "SOURCE", analysisRequested: false, verification: null, handoffNetworkState: null, verdictNetworkState: null,
    physical, motion: derivePresentationMotion(masterTimeMs, true), passenger: derivePassengerPresentation(masterTimeMs, physical.passengerState), routing,
  };
  return { snapshot, model: derivePublicExperience(snapshot, presentationTimeMs) };
}

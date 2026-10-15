import { blake3 } from "@noble/hashes/blake3.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

import masterBranchFixture from "../data/d005m-master-evidence-branch.json" with { type: "json" };
import masterCycleReceiptFixture from "../data/d005m-master-operational-cycle-receipt.json" with { type: "json" };
import masterPaymentReceiptFixture from "../data/d005m-master-payment-receipt.json" with { type: "json" };
import masterBundleFixture from "../data/d005m-master-portable-evidence-bundle.json" with { type: "json" };
import masterReturnReceiptFixture from "../data/d005m-master-return-to-base-receipt.json" with { type: "json" };
import {
  D005_EVENTS,
  D005_MISSIONS,
  type CycleVerificationResult,
  type EventKind,
  type OperationalEvent,
  type OperationalMission,
} from "./operationalCycle.ts";
import {
  EXPERIENCE_DURATION_MS,
  FINAL_LEAF_GROWTH_DURATION_MS,
  FINAL_RECEIPT_EMITTED_MS,
  FINAL_RECEIPT_LANDED_MS,
  FINAL_RECEIPT_ROOT_ATTACHED_MS,
  FINAL_REQUIRED_LEAF_MATURE_MS,
  HANDOFF_READY_MS,
  HANDOFF_STABLE_PAUSE_MS,
  PEB_ASSEMBLY_DURATION_MS,
  PEB_COMPLETE_MS,
  RECEIPT_TRAVEL_DURATION_MS,
  REVIEW_WINDOW_DURATION_MS,
  clampExperienceTime,
  missionClockPositionAt,
  storyBeatTime,
} from "./storyTimeline.ts";
import { verifyCanonicalEvidenceSignatures } from "./canonicalSignature.ts";
import { assessSettlementScope } from "./settlementScope.ts";
import { assessPresentedTrustMaterial } from "./trustAnchors.ts";
import { canonicalString } from "./verification.ts";

export type MasterChapter =
  | "PASSENGER"
  | "GARAGE_JOURNEY"
  | "MAINTENANCE"
  | "GOVERNED_PAYMENT"
  | "RETURN"
  | "PROOF";

export type MasterScene =
  | "PASSENGER_REQUEST"
  | "PICKUP_ROUTE"
  | "PICKUP"
  | "PASSENGER_JOURNEY"
  | "DROPOFF"
  | "MISSION_TRANSITION"
  | "GARAGE_ROUTE"
  | "CONGESTION"
  | "REROUTE"
  | "GARAGE_ARRIVAL"
  | "DIAGNOSIS"
  | "MAINTENANCE"
  | "INVOICE"
  | "HUMAN_AUTHORITY"
  | "PAYMENT"
  | "MANAGER"
  | "RETURN"
  | "PARKED"
  | "RECEIPTS"
  | "CYCLE_RECEIPT";

export type MasterMomentId =
  | "passenger-request"
  | "taxi-en-route-to-passenger"
  | "taxi-aligned-pickup"
  | "passenger-pickup"
  | "passenger-journey"
  | "passenger-destination-approach"
  | "passenger-exit"
  | "passenger-dropoff"
  | "passenger-mission-complete"
  | "garage-mission-begins"
  | "normal-route-to-garage"
  | "garage-journey"
  | "congestion"
  | "eta-at-risk"
  | "provider-transition"
  | "reroute-authorized"
  | "physical-reroute"
  | "garage-approach"
  | "garage-arrival"
  | "maintenance-begins"
  | "diagnosis"
  | "maintenance-proposal"
  | "maintenance-authorized"
  | "work-in-progress"
  | "work-complete"
  | "invoice-1850"
  | "policy-exceeded"
  | "human-approval-required"
  | "human-approve"
  | "authority-delegated"
  | "payment-authorized"
  | "payment-execution"
  | "payment-result"
  | "manager-notified"
  | "return-to-base-intent"
  | "return-route-calculation"
  | "return-route-calculated"
  | "leaving-garage"
  | "return-journey"
  | "base-approach"
  | "parked-at-base"
  | "sub-mission-receipts"
  | "master-cycle-receipt";

export type MasterMoment = Readonly<{
  id: MasterMomentId;
  timeMs: number;
  chapter: MasterChapter;
  scene: MasterScene;
  systemKey: string;
  boundaryKey: string;
  evidenceEventId: string | null;
}>;

export type MasterEvidenceEvent = OperationalEvent & Readonly<{
  labelKey: string | null;
}>;

export type MasterPaymentStep =
  | "HIDDEN"
  | "INVOICE"
  | "LIMIT"
  | "ESCALATION"
  | "APPROVED"
  | "DELEGATED"
  | "AUTHORIZED"
  | "REQUEST"
  | "RESULT"
  | "RECEIPT";

export type MasterStoryState = Readonly<{
  /** The one playable experience coordinate, including proof post-roll. */
  masterTime: number;
  /** Canonical evidence coordinate; fixed at 120,000 during post-roll. */
  missionClockPosition: number;
  moment: MasterMoment;
  chapter: MasterChapter;
  scene: MasterScene;
  reachedMoments: readonly MasterMoment[];
  reachedEvidence: readonly MasterEvidenceEvent[];
  reachedReceiptCount: number;
  passengerAboard: boolean;
  cycleReceiptAvailable: boolean;
  finalRequiredLeafMature: boolean;
  finalReceiptEmitted: boolean;
  finalReceiptLanded: boolean;
  finalReceiptRootAttached: boolean;
  pebComplete: boolean;
  handoffReady: boolean;
  paymentStep: MasterPaymentStep;
  authorityState: "NOT_APPLICABLE" | "AUTONOMOUS_LIMIT" | "HUMAN_REQUIRED" | "HUMAN_APPROVED" | "DELEGATED" | "PAYMENT_AUTHORIZED";
}>;

type JsonObject = Record<string, unknown>;

export const D005M_MASTER_BRANCH = Object.freeze(masterBranchFixture);
export const D005M_MASTER_PAYMENT_RECEIPT = Object.freeze(masterPaymentReceiptFixture);
export const D005M_MASTER_RETURN_RECEIPT = Object.freeze(masterReturnReceiptFixture);
export const D005M_MASTER_CYCLE_RECEIPT = Object.freeze(masterCycleReceiptFixture);
export const D005M_MASTER_BUNDLE = Object.freeze(masterBundleFixture);
// The frozen artifact is canonical sorted JSON without presentation whitespace.
// Copy/download must preserve those exact bytes rather than reformatting evidence.
export const D005M_MASTER_CYCLE_RECEIPT_TEXT = canonicalString(masterCycleReceiptFixture);
export const D005M_MASTER_BUNDLE_TEXT = canonicalString(masterBundleFixture);

export const D005M_MASTER_CYCLE_RECEIPT_ID = String(masterCycleReceiptFixture.evidence_id);
export const D005M_MASTER_PAYMENT_RECEIPT_ID = String(masterPaymentReceiptFixture.evidence_id);
export const D005M_MASTER_RETURN_RECEIPT_ID = String(masterReturnReceiptFixture.evidence_id);
export const D005M_MASTER_BUNDLE_ID = String(masterBundleFixture.bundle_manifest.bundle_id);

export const MASTER_MISSIONS: readonly OperationalMission[] = Object.freeze(
  D005_MISSIONS.map((mission) => {
    if (mission.id === "payment") return { ...mission, receipt_evidence_id: D005M_MASTER_PAYMENT_RECEIPT_ID };
    if (mission.id === "return") return { ...mission, receipt_evidence_id: D005M_MASTER_RETURN_RECEIPT_ID };
    return mission;
  }),
);

export const MASTER_STORY_MOMENTS: readonly MasterMoment[] = Object.freeze([
  moment("passenger-request", "PASSENGER", "PASSENGER_REQUEST", "passengerService", "passengerToService", "d005.passenger-request"),
  moment("taxi-en-route-to-passenger", "PASSENGER", "PICKUP_ROUTE", "navigationA", "softwareToPhysical", "d005.pickup-route"),
  moment("taxi-aligned-pickup", "PASSENGER", "PICKUP", "passengerService", "physicalToService", null),
  moment("passenger-pickup", "PASSENGER", "PICKUP", "passengerService", "physicalToService", "d005.pickup-confirmed"),
  moment("passenger-journey", "PASSENGER", "PASSENGER_JOURNEY", "taxiAutonomy", "serviceToAgent", "d005.journey-executed"),
  moment("passenger-destination-approach", "PASSENGER", "PASSENGER_JOURNEY", "taxiAutonomy", "agentToPassenger", null),
  moment("passenger-exit", "PASSENGER", "DROPOFF", "passengerService", "agentToPassenger", null),
  moment("passenger-dropoff", "PASSENGER", "DROPOFF", "passengerService", "agentToPassenger", "d005.dropoff-confirmed"),
  moment("passenger-mission-complete", "PASSENGER", "DROPOFF", "causalCompiler", "missionClosure", null),
  moment("garage-mission-begins", "GARAGE_JOURNEY", "MISSION_TRANSITION", "fleetOperations", "customerToVehicleOps", "d005.maintenance-intent"),
  moment("normal-route-to-garage", "GARAGE_JOURNEY", "GARAGE_ROUTE", "navigationA", "agentToNavigationA", "d005.garage-route-a"),
  moment("garage-journey", "GARAGE_JOURNEY", "GARAGE_ROUTE", "taxiAutonomy", "softwareToPhysical", null),
  moment("congestion", "GARAGE_JOURNEY", "CONGESTION", "trafficProvider", "physicalToTraffic", "d005.congestion-significant"),
  moment("eta-at-risk", "GARAGE_JOURNEY", "CONGESTION", "taxiAutonomy", "trafficToAgent", "d005.eta-deteriorates"),
  moment("provider-transition", "GARAGE_JOURNEY", "REROUTE", "routingSelection", "providerAToB", null),
  moment("reroute-authorized", "GARAGE_JOURNEY", "REROUTE", "taxiAutonomy", "policyToAgent", "d005.reroute-authorized"),
  moment("physical-reroute", "GARAGE_JOURNEY", "REROUTE", "navigationB", "navigationBToPhysical", "d005.route-b-executed"),
  moment("garage-approach", "GARAGE_JOURNEY", "GARAGE_ROUTE", "navigationB", "vehicleToGarage", null),
  moment("garage-arrival", "GARAGE_JOURNEY", "GARAGE_ARRIVAL", "garage", "vehicleToGarage", "d005.garage-arrival"),
  moment("maintenance-begins", "MAINTENANCE", "DIAGNOSIS", "maintenanceSystem", "garageToMaintenance", null),
  moment("diagnosis", "MAINTENANCE", "DIAGNOSIS", "maintenanceSystem", "garageToMaintenance", "d005.diagnostic"),
  moment("maintenance-proposal", "MAINTENANCE", "DIAGNOSIS", "maintenanceSystem", "proposalToPolicy", "d005.maintenance-proposal"),
  moment("maintenance-authorized", "MAINTENANCE", "MAINTENANCE", "fleetOperations", "policyToGarage", "d005.maintenance-authorized"),
  moment("work-in-progress", "MAINTENANCE", "MAINTENANCE", "garage", "digitalToPhysicalWork", "d005.maintenance-executed"),
  moment("work-complete", "MAINTENANCE", "MAINTENANCE", "garage", "physicalWorkToEvidence", "d005.maintenance-completed"),
  moment("invoice-1850", "GOVERNED_PAYMENT", "INVOICE", "garage", "garageToPaymentPolicy", "d005m.master-invoice-1850"),
  moment("policy-exceeded", "GOVERNED_PAYMENT", "INVOICE", "paymentPolicy", "capabilityToAuthority", "d005m.master-payment-policy-exceeded"),
  moment("human-approval-required", "GOVERNED_PAYMENT", "HUMAN_AUTHORITY", "humanApprover", "autonomousToHuman", "d005m.master-human-approval-request"),
  moment("human-approve", "GOVERNED_PAYMENT", "HUMAN_AUTHORITY", "humanApprover", "humanToGovernance", "d005m.master-human-approve"),
  moment("authority-delegated", "GOVERNED_PAYMENT", "HUMAN_AUTHORITY", "authorityGovernance", "approvalToAuthority", "d005m.master-payment-authority-active"),
  moment("payment-authorized", "GOVERNED_PAYMENT", "PAYMENT", "paymentPolicy", "approvalToAuthority", "d005m.master-payment-authorized"),
  moment("payment-execution", "GOVERNED_PAYMENT", "PAYMENT", "paymentProvider", "taxiToPaymentProvider", "d005m.master-payment-instruction"),
  moment("payment-result", "GOVERNED_PAYMENT", "PAYMENT", "paymentProvider", "paymentProviderReturn", "d005m.master-payment-result"),
  moment("manager-notified", "GOVERNED_PAYMENT", "MANAGER", "managerWorkflow", "systemToManager", "d005m.master-manager-notified"),
  moment("return-to-base-intent", "RETURN", "RETURN", "fleetOperations", "managerToVehicleOps", "d005m.master-return-intent"),
  moment("return-route-calculation", "RETURN", "RETURN", "fleetOperations", "returnPolicyToRoute", null),
  moment("return-route-calculated", "RETURN", "RETURN", "fleetOperations", "returnPolicyToRoute", "d005m.master-return-authorized"),
  moment("leaving-garage", "RETURN", "RETURN", "taxiAutonomy", "garageToPhysical", "d005m.master-return-executed"),
  moment("return-journey", "RETURN", "RETURN", "taxiAutonomy", "physicalReturn", null),
  moment("base-approach", "RETURN", "RETURN", "taxiAutonomy", "physicalReturn", null),
  moment("parked-at-base", "RETURN", "PARKED", "fleetOperations", "vehicleToBase", "d005m.master-base-arrival"),
  moment("sub-mission-receipts", "PROOF", "RECEIPTS", "causalCompiler", "episodesToReceipts", "d005m.receipt.master-return-to-base"),
  moment("master-cycle-receipt", "PROOF", "CYCLE_RECEIPT", "causalCompiler", "receiptsToCycle", "d005m.receipt.master-operational-cycle"),
]);

export function masterMomentTime(id: MasterMomentId): number {
  return storyBeatTime(id);
}

const MASTER_EVENT_SPECS = [
  ["d005m.master-invoice-1850", storyBeatTime("invoice-1850"), "payment", "RESULT", "invoice1850"],
  ["d005m.master-payment-policy-exceeded", storyBeatTime("policy-exceeded"), "payment", "POLICY", "policyExceeded"],
  ["d005m.master-human-approval-request", storyBeatTime("human-approval-required"), "payment", "INTENT", "humanApprovalRequired"],
  ["d005m.master-human-approve", storyBeatTime("human-approve"), "payment", "POLICY", "humanApprove"],
  ["d005m.master-payment-authority-active", storyBeatTime("authority-delegated"), "payment", "POLICY", "authorityDelegated"],
  ["d005m.master-payment-authorized", storyBeatTime("payment-authorized"), "payment", "POLICY", "paymentAuthorized"],
  ["d005m.master-payment-instruction", storyBeatTime("payment-execution"), "payment", "EXECUTION", "paymentInstruction"],
  ["d005m.master-payment-result", storyBeatTime("payment-result"), "payment", "RESULT", "paymentResult"],
  ["d005m.receipt.master-payment", storyBeatTime("payment-sub-mission-receipt"), "payment", "RESULT", "paymentReceipt"],
  ["d005m.master-manager-notified", storyBeatTime("manager-notified"), "accountability", "RESULT", "managerNotified"],
  ["d005m.master-return-intent", storyBeatTime("return-to-base-intent"), "return", "INTENT", "returnIntent"],
  ["d005m.master-return-authorized", storyBeatTime("return-route-calculated"), "return", "POLICY", "returnAuthorized"],
  ["d005m.master-return-executed", storyBeatTime("leaving-garage"), "return", "EXECUTION", "returnExecuted"],
  ["d005m.master-base-arrival", storyBeatTime("parked-at-base"), "return", "RESULT", "baseArrival"],
  ["d005m.receipt.master-return-to-base", storyBeatTime("sub-mission-receipts"), "return", "RESULT", "returnReceipt"],
  ["d005m.receipt.master-operational-cycle", FINAL_RECEIPT_EMITTED_MS, "cycle", "RESULT", "cycleReceipt"],
] as const;

const newEvidenceByEvent = new Map(
  masterBranchFixture.master_branch.new_evidence_objects.map((value) => [value.significant_event.event_id, value]),
);

const historicalMasterEvents: readonly MasterEvidenceEvent[] = D005_EVENTS
  .filter((event) => event.time_ms < storyBeatTime("invoice-1850"))
  .map((event) => ({ ...event, event_id: `d005.${event.id}`, labelKey: null }));

const additiveMasterEvents: readonly MasterEvidenceEvent[] = MASTER_EVENT_SPECS.map(
  ([eventId, timeMs, mission, kind, labelKey]) => {
    const evidence = newEvidenceByEvent.get(eventId);
    if (evidence === undefined) throw new TypeError(`D-005M evidence missing: ${eventId}`);
    return {
      id: eventId.replace("d005m.", ""),
      event_id: eventId,
      time_ms: timeMs,
      mission,
      kind: kind as EventKind,
      label_en: "",
      label_fr: "",
      labelKey,
      system: systemForMasterEvent(eventId),
      authority_context: authorityForMasterEvent(eventId),
      causal_parent_ids: causalParents(evidence),
      evidence_id: evidence.evidence_id,
    };
  },
);

export const MASTER_EVIDENCE_EVENTS: readonly MasterEvidenceEvent[] = Object.freeze(
  [...historicalMasterEvents, ...additiveMasterEvents].sort(
    (left, right) => left.time_ms - right.time_ms || left.evidence_id.localeCompare(right.evidence_id),
  ),
);

type PacingSegment = Readonly<{ startMs: number; endMs: number; presentationDurationMs: number }>;

export const MASTER_PACING_SEGMENTS: readonly PacingSegment[] = Object.freeze([
  paceBeat("passenger-request", "mission-accepted", 3_000),
  paceBeat("mission-accepted", "signal-green", 1_800),
  paceBeat("signal-green", "intersection-cleared", 6_000),
  paceBeat("intersection-cleared", "passenger-pickup", 1_200),
  paceBeat("passenger-pickup", "passenger-journey", 1_000),
  paceBeat("passenger-journey", "passenger-dropoff", 3_500),
  paceBeat("passenger-dropoff", "garage-mission-begins", 1_200),
  paceBeat("garage-mission-begins", "normal-route-to-garage", 1_200),
  paceBeat("normal-route-to-garage", "congestion", 1_600),
  paceBeat("congestion", "eta-at-risk", 1_600),
  paceBeat("eta-at-risk", "routing-request", 400),
  paceBeat("routing-request", "routing-policy-evaluated", 600),
  paceBeat("routing-policy-evaluated", "routing-candidates-compared", 800),
  paceBeat("routing-candidates-compared", "routing-candidate-selected", 900),
  paceBeat("routing-candidate-selected", "provider-transition", 700),
  paceBeat("provider-transition", "reroute-authorized", 900),
  paceBeat("reroute-authorized", "resulting-route-calculated", 700),
  paceBeat("resulting-route-calculated", "physical-reroute", 700),
  paceBeat("physical-reroute", "garage-arrival", 2_500),
  paceBeat("garage-arrival", "maintenance-begins", 1_200),
  paceBeat("maintenance-begins", "maintenance-proposal", 900),
  paceBeat("maintenance-proposal", "maintenance-authorized", 700),
  paceBeat("maintenance-authorized", "work-in-progress", 700),
  paceBeat("work-in-progress", "work-complete", 1_600),
  paceBeat("work-complete", "invoice-1850", 1_000),
  paceBeat("invoice-1850", "policy-exceeded", 1_500),
  paceBeat("policy-exceeded", "human-approval-required", 500),
  paceBeat("human-approval-required", "human-approve", 1_200),
  paceBeat("human-approve", "authority-delegated", 500),
  paceBeat("authority-delegated", "payment-authorized", 500),
  paceBeat("payment-authorized", "payment-execution", 500),
  paceBeat("payment-execution", "payment-result", 1_200),
  paceBeat("payment-result", "payment-sub-mission-receipt", 800),
  paceBeat("payment-sub-mission-receipt", "manager-notified", 400),
  paceBeat("manager-notified", "return-to-base-intent", 500),
  paceBeat("return-to-base-intent", "return-route-calculated", 500),
  paceBeat("return-route-calculated", "leaving-garage", 600),
  paceBeat("leaving-garage", "parked-at-base", 3_000),
  paceBeat("parked-at-base", "sub-mission-receipts", 800),
  paceBeat("sub-mission-receipts", "master-cycle-receipt", 1_200),
  paceBeat("master-cycle-receipt", "final-receipt-landed", RECEIPT_TRAVEL_DURATION_MS),
  paceBeat("final-receipt-landed", "final-receipt-root-attached", FINAL_LEAF_GROWTH_DURATION_MS),
  paceBeat("final-receipt-root-attached", "peb-complete", PEB_ASSEMBLY_DURATION_MS),
  paceBeat("peb-complete", "handoff-ready", HANDOFF_STABLE_PAUSE_MS),
  paceBeat("handoff-ready", "experience-complete", REVIEW_WINDOW_DURATION_MS),
]);

export const MASTER_PRESENTATION_DURATION_MS = MASTER_PACING_SEGMENTS.reduce(
  (total, segment) => total + segment.presentationDurationMs,
  0,
);

const pacingOffsets = MASTER_PACING_SEGMENTS.map((segment, index) => ({
  ...segment,
  presentationStartMs: MASTER_PACING_SEGMENTS
    .slice(0, index)
    .reduce((total, value) => total + value.presentationDurationMs, 0),
}));

const PRESENTATION_EPSILON = 1e-9;

/** The presentation coordinate of a master time, unrounded. */
function exactPresentationTimeForMasterTime(value: number): number {
  const masterTime = clampExperienceTime(value);
  if (masterTime >= EXPERIENCE_DURATION_MS) return MASTER_PRESENTATION_DURATION_MS;
  const segment = pacingOffsets.find((candidate) => masterTime >= candidate.startMs && masterTime < candidate.endMs)
    ?? pacingOffsets[0];
  const progress = (masterTime - segment.startMs) / Math.max(1, segment.endMs - segment.startMs);
  return segment.presentationStartMs + progress * segment.presentationDurationMs;
}

export function presentationTimeForMasterTime(value: number): number {
  return Math.round(exactPresentationTimeForMasterTime(value));
}

export function masterTimeForPresentationTime(value: number): number {
  const presentationTime = Math.min(MASTER_PRESENTATION_DURATION_MS, Math.max(0, Math.round(value)));
  if (presentationTime >= MASTER_PRESENTATION_DURATION_MS) return EXPERIENCE_DURATION_MS;
  const segment = pacingOffsets.find((candidate) => (
    presentationTime >= candidate.presentationStartMs
      && presentationTime < candidate.presentationStartMs + candidate.presentationDurationMs
  )) ?? pacingOffsets[0];
  const progress = (presentationTime - segment.presentationStartMs) / Math.max(1, segment.presentationDurationMs);
  return clampExperienceTime(segment.startMs + progress * (segment.endMs - segment.startMs));
}

// Playback advances on the presentation clock but is stored on the canonical
// master clock, and both conversions quantise to whole milliseconds. Math.round
// quantises *upward*: three pacing segments run at master:presentation = 0.5
// (84_000-84_250, 85_000-85_250, 85_250-85_500), where a 1 ms frame is worth
// 0.5 ms of master and Math.round(m + 0.5) === m + 1 — every frame. Fractional
// frame deltas from the animation loop round up the same way, multiplied by
// the segment rate, so a 0.5 ms frame at master 98_000 (ratio 10) bought 10 ms.
// Anchored callers cancel this; per-frame re-anchoring compounds it.
// Advancing therefore reads an unrounded presentation anchor and truncates the
// canonical result: a frame may be under-counted, never invented.
function masterTimeAtOrBeforePresentationTime(value: number): number {
  const presentationTime = Math.min(
    MASTER_PRESENTATION_DURATION_MS,
    Math.max(0, Number.isFinite(value) ? value : 0),
  );
  if (presentationTime >= MASTER_PRESENTATION_DURATION_MS) return EXPERIENCE_DURATION_MS;
  const segment = pacingOffsets.find((candidate) => (
    presentationTime >= candidate.presentationStartMs
      && presentationTime < candidate.presentationStartMs + candidate.presentationDurationMs
  )) ?? pacingOffsets[0];
  const advanced = ((presentationTime - segment.presentationStartMs) * (segment.endMs - segment.startMs))
    / Math.max(1, segment.presentationDurationMs);
  return Math.min(
    EXPERIENCE_DURATION_MS,
    Math.max(0, segment.startMs + Math.floor(advanced + PRESENTATION_EPSILON)),
  );
}

export function advanceMasterTimeByPresentationElapsed(masterTime: number, elapsedMs: number): number {
  const start = clampExperienceTime(masterTime);
  const elapsed = Math.max(0, Number.isFinite(elapsedMs) ? elapsedMs : 0);
  if (elapsed === 0) return start;
  return Math.max(start, masterTimeAtOrBeforePresentationTime(exactPresentationTimeForMasterTime(start) + elapsed));
}

export function deriveMasterStoryState(value: number): MasterStoryState {
  const masterTime = clampExperienceTime(value);
  const missionClockPosition = missionClockPositionAt(masterTime);
  const reachedMoments = MASTER_STORY_MOMENTS.filter((candidate) => candidate.timeMs <= masterTime);
  const current = reachedMoments.at(-1) ?? MASTER_STORY_MOMENTS[0];
  const reachedEvidence = MASTER_EVIDENCE_EVENTS.filter((candidate) => candidate.time_ms <= missionClockPosition);
  const reachedReceiptCount = [
    storyBeatTime("passenger-mission-complete"),
    storyBeatTime("garage-sub-mission-receipt"),
    storyBeatTime("maintenance-sub-mission-receipt"),
    storyBeatTime("payment-sub-mission-receipt"),
    storyBeatTime("sub-mission-receipts"),
  ]
    .filter((receiptTime) => receiptTime <= masterTime).length;
  return {
    masterTime,
    missionClockPosition,
    moment: current,
    chapter: current.chapter,
    scene: current.scene,
    reachedMoments,
    reachedEvidence,
    reachedReceiptCount,
    passengerAboard: masterTime >= storyBeatTime("passenger-pickup") && masterTime < storyBeatTime("passenger-dropoff"),
    cycleReceiptAvailable: masterTime >= FINAL_RECEIPT_EMITTED_MS,
    finalRequiredLeafMature: masterTime >= FINAL_REQUIRED_LEAF_MATURE_MS,
    finalReceiptEmitted: masterTime >= FINAL_RECEIPT_EMITTED_MS,
    finalReceiptLanded: masterTime >= FINAL_RECEIPT_LANDED_MS,
    finalReceiptRootAttached: masterTime >= FINAL_RECEIPT_ROOT_ATTACHED_MS,
    pebComplete: masterTime >= PEB_COMPLETE_MS,
    handoffReady: masterTime >= HANDOFF_READY_MS,
    paymentStep: paymentStepAt(masterTime),
    authorityState: authorityStateAt(masterTime),
  };
}

export async function verifyD005MMasterBundle(
  portableBundle: unknown = D005M_MASTER_BUNDLE,
): Promise<CycleVerificationResult> {
  try {
    const bundle = object(deepClone(portableBundle));
    const manifest = object(bundle.bundle_manifest);
    const integrity = object(bundle.integrity_manifest);
    const verification = object(bundle.verification_manifest);
    const evidenceObjects = array(bundle.canonical_evidence_objects).map(object);
    const evidenceIndex = array(bundle.evidence_index).map(object);
    const claimedDigest = text(integrity.bundle_digest);
    const digestProbe = object(deepClone(bundle));
    object(digestProbe.integrity_manifest).bundle_digest = "";
    if (digestCanonical(digestProbe) !== claimedDigest) return invalid("BUNDLE_DIGEST_MISMATCH");
    if (evidenceIndex.length !== evidenceObjects.length || evidenceObjects.length !== 45) {
      return invalid("D005M_BUNDLE_INDEX_INVALID");
    }
    for (let ordinal = 0; ordinal < evidenceIndex.length; ordinal += 1) {
      const index = evidenceIndex[ordinal];
      const evidence = evidenceObjects[ordinal];
      if (index.ordinal !== ordinal || index.evidence_id !== evidence.evidence_id || index.object_digest !== digestCanonical(evidence)) {
        return invalid("D005M_BUNDLE_INDEX_INVALID");
      }
    }
    // --- authenticity BEFORE any structural reasoning --------------------
    //
    // Everything above recomputes digests, which proves only that the bundle
    // agrees with itself; an attacker editing a payload recomputes those
    // digests as a matter of course. A bundle with `amount_eur` changed to
    // 999999 and its hashes rebuilt used to return the identical verdict,
    // reason code and check list as the genuine article.
    //
    // This runs here, before the target binding and the required-evidence
    // checks, because a verifier must not draw structural conclusions from
    // data whose origin it has not established. Placed later, a forgery could
    // be caught incidentally by a structural check and reported as a
    // *structural* problem, which misstates what was actually wrong with it.
    //
    // Fails CLOSED: an invalid signature, an identity not derived from its own
    // content, or a missing signature all yield INVALID. No path through here
    // lets an unverifiable object count in the bundle's favour.
    // KEY AUTHORIZATION FIRST, and against state the bundle cannot reach.
    //
    // Signatures used to be checked against `trust_material.verification_keys`
    // — keys the bundle itself supplies. Codex attack G: re-sign every object
    // with an attacker keypair, present that public key under the genuine
    // key_id, and the result was indistinguishable from the real bundle,
    // `canonical_signatures_verified` included. The signatures were valid.
    // They were valid under the attacker's key, and nothing asked whose key
    // it was.
    //
    // Authorization now resolves against the pinned directory in
    // `trustAnchors.ts`, mirroring FortiVault's external key directory. A
    // presented key that CONTRADICTS the directory is a substitution, which is
    // a positive finding, not missing information — INVALID. A key the
    // directory has never heard of establishes nothing either way —
    // INDETERMINATE. A key whose lifecycle says it may no longer sign —
    // REVOKED.
    const trust = assessPresentedTrustMaterial(array(object(bundle.trust_material).verification_keys));
    if (trust.substituted) return invalid("D005M_VERIFICATION_KEY_SUBSTITUTED");
    if (trust.revoked) {
      return {
        verdict: "REVOKED",
        reasonCodes: ["D005M_VERIFICATION_KEY_REVOKED"],
        completedChecks: [],
        receiptId: D005M_MASTER_CYCLE_RECEIPT_ID,
        bundleId: null,
      };
    }
    if (trust.noneAuthorized) return indeterminate("D005M_VERIFICATION_KEY_NOT_AUTHORIZED");

    // Verified with the DIRECTORY's key material, never the bundle's copy, so
    // attacker-supplied bytes cannot be used even by accident.
    const signatures = await verifyCanonicalEvidenceSignatures(
      evidenceObjects,
      trust.authorizedKeys.map((entry) => ({
        key_id: entry.keyId,
        public_key_hex: entry.publicKeyHex,
      })),
    );
    if (signatures.unsignedCount > 0) return invalid("D005M_EVIDENCE_UNSIGNED");
    if (!signatures.allSignaturesValid) return invalid("D005M_CANONICAL_SIGNATURE_INVALID");
    if (!signatures.allIdentitiesDerived) return invalid("D005M_EVIDENCE_IDENTITY_NOT_DERIVED");

    const targetIds = array(verification.target_evidence_ids).map(text);
    if (targetIds.length !== 1 || targetIds[0] !== D005M_MASTER_CYCLE_RECEIPT_ID) {
      return invalid("D005M_MASTER_TARGET_INVALID");
    }
    const evidenceById = new Map(evidenceObjects.map((evidence) => [text(evidence.evidence_id), evidence]));
    const requiredIds = MASTER_EVIDENCE_EVENTS.map((event) => event.evidence_id);
    if (requiredIds.some((evidenceId) => !evidenceById.has(evidenceId))) {
      return indeterminate("D005M_MASTER_PATH_EVIDENCE_MISSING");
    }
    const historicalPaymentReceiptId = "fortix:evidence:blake3:da7c1574661acbf1ce19770e33efcda204fc3e7e0f28b4be5e35af77da36ba62";
    if (evidenceById.has(historicalPaymentReceiptId)) return invalid("D005M_HISTORICAL_PAYMENT_BRANCH_PRESENT");
    const cycle = evidenceById.get(D005M_MASTER_CYCLE_RECEIPT_ID);
    if (cycle === undefined) return indeterminate("D005M_MASTER_PATH_EVIDENCE_MISSING");
    const cycleResult = object(object(cycle.evidence_payload).result);
    const lowerReceipts = array(cycleResult.causal_input_receipt_ids).map(text);
    if (lowerReceipts.length !== 5 || !lowerReceipts.includes(D005M_MASTER_PAYMENT_RECEIPT_ID) || !lowerReceipts.includes(D005M_MASTER_RETURN_RECEIPT_ID)) {
      return invalid("D005M_CYCLE_RECEIPT_CLOSURE_INVALID");
    }
    const governanceIds = array(object(bundle.governance_material).governance_evidence_ids).map(text);
    const trustedTimeIds = array(object(bundle.trust_material).trusted_time_evidence_ids).map(text);
    if (governanceIds.length < 4 || trustedTimeIds.length < 2) {
      // Distinct from the code returned on the success path below. Both used
      // to be D005M_PRODUCTION_TRUST_TIME_INCOMPLETE, so a bundle that failed
      // this gate and a bundle that passed every gate were indistinguishable
      // to any consumer reading verdict + reason code.
      return indeterminate("D005M_GOVERNANCE_MATERIAL_INSUFFICIENT");
    }
    // The bundle scopes its own verification. `verification.ts:644` already
    // honours this for D-003; this verifier ignored it, which is how a
    // demonstration bundle carrying `provider_result: "SETTLED"` could be
    // reported as fully checked with the demonstration scope mentioned
    // nowhere. Read it from the evidence and report it, rather than
    // hardcoding a caveat in the interface: what scopes the claim should be
    // the evidence, not the screen.
    const declaredScope = cycleResult.verification_scope === undefined
      ? null
      : object(cycleResult.verification_scope).trust_scope;
    const scopeChecks = declaredScope === "DEMO_ONLY" ? ["bundle_declares_demo_only_scope"] : [];

    // Exactly the checks the code above performs, named for what they do.
    //
    // This list used to carry eight entries, four of which described work
    // that never happened: `action_authority_at_signed_time`,
    // `provider_round_trip`, `manager_accountability` and
    // `return_receipt_closure` were string literals, not results. The panel
    // renders each as a ticked line, so the verifier was reporting an
    // authority-at-signed-time resolution and a provider round-trip it had
    // not attempted. A verifier that overstates what it checked is worse
    // than one that checks less, because the overstatement is invisible.
    //
    // What is established: structural integrity (bundle and per-object
    // digests recomputed), the target binding, the master-path evidence, the
    // cycle receipt's closure over five lower receipts — AND, since P2R,
    // that every object carries a valid Ed25519 signature from a key the
    // bundle's own trust material declares, over a digest that commits to the
    // object's identity as well as its content.
    //
    // The verdict stays INDETERMINATE, and that is not a hedge. Signatures
    // being authentic does not make production trust anchors and trusted time
    // established, and this bundle declares itself DEMO_ONLY. What changed is
    // that a forged bundle is now INVALID rather than indistinguishable from
    // this one.
    // A settlement asserted by a party that cannot settle, with no
    // account-holding institution anywhere in the evidence, is reported and
    // barred from supporting a conclusion. Authenticity establishes who said
    // it, never whether it happened — and a verified signature is precisely
    // the kind of assertion a verifier is most tempted to promote.
    const settlement = assessSettlementScope(evidenceObjects);
    const settlementReasons = settlement.quarantined
      ? ["D005M_SETTLEMENT_UNSUPPORTED_BY_EVIDENCE"]
      : [];

    return {
      verdict: "INDETERMINATE",
      reasonCodes: ["D005M_PRODUCTION_TRUST_TIME_INCOMPLETE", ...settlementReasons],
      completedChecks: [
        "bundle_digest_recomputed",
        "object_digests_recomputed",
        "evidence_identities_derived",
        "verification_key_authorized_by_pinned_anchor",
        "canonical_signatures_verified",
        "target_binds_to_cycle_receipt",
        "master_path_evidence_present",
        "cycle_receipt_closure",
        "governance_material_present",
        ...scopeChecks,
      ],
      receiptId: D005M_MASTER_CYCLE_RECEIPT_ID,
      bundleId: text(manifest.bundle_id),
    };
  } catch {
    return invalid("D005M_BUNDLE_SCHEMA_INVALID");
  }
}

export function createTamperedD005MMasterBundle(): unknown {
  const clone = object(deepClone(D005M_MASTER_BUNDLE));
  const invoice = array(clone.canonical_evidence_objects)
    .map(object)
    .find((evidence) => object(evidence.significant_event).event_id === "d005m.master-invoice-1850");
  if (invoice === undefined) throw new TypeError("D-005M invoice missing");
  const result = object(object(invoice.evidence_payload).result);
  object(result.details).amount_eur = 1851;
  return clone;
}

function moment(
  id: MasterMomentId,
  chapter: MasterChapter,
  scene: MasterScene,
  systemKey: string,
  boundaryKey: string,
  evidenceEventId: string | null,
): MasterMoment {
  return { id, timeMs: storyBeatTime(id), chapter, scene, systemKey, boundaryKey, evidenceEventId };
}

function pace(startMs: number, endMs: number, presentationDurationMs: number): PacingSegment {
  return { startMs, endMs, presentationDurationMs };
}

function paceBeat(
  start: Parameters<typeof storyBeatTime>[0],
  end: Parameters<typeof storyBeatTime>[0],
  presentationDurationMs: number,
): PacingSegment {
  return pace(storyBeatTime(start), storyBeatTime(end), presentationDurationMs);
}

function paymentStepAt(time: number): MasterPaymentStep {
  if (time < storyBeatTime("invoice-1850") || time >= storyBeatTime("return-to-base-intent")) return "HIDDEN";
  if (time < storyBeatTime("policy-exceeded")) return "INVOICE";
  if (time < storyBeatTime("human-approval-required")) return "LIMIT";
  if (time < storyBeatTime("human-approve")) return "ESCALATION";
  if (time < storyBeatTime("authority-delegated")) return "APPROVED";
  if (time < storyBeatTime("payment-authorized")) return "DELEGATED";
  if (time < storyBeatTime("payment-execution")) return "AUTHORIZED";
  if (time < storyBeatTime("payment-result")) return "REQUEST";
  if (time < storyBeatTime("payment-sub-mission-receipt")) return "RESULT";
  return "RECEIPT";
}

function authorityStateAt(time: number): MasterStoryState["authorityState"] {
  if (time < storyBeatTime("policy-exceeded")) return "NOT_APPLICABLE";
  if (time < storyBeatTime("human-approval-required")) return "AUTONOMOUS_LIMIT";
  if (time < storyBeatTime("human-approve")) return "HUMAN_REQUIRED";
  if (time < storyBeatTime("authority-delegated")) return "HUMAN_APPROVED";
  if (time < storyBeatTime("payment-authorized")) return "DELEGATED";
  return "PAYMENT_AUTHORIZED";
}

function systemForMasterEvent(eventId: string): string {
  if (eventId.includes("invoice")) return "Garage";
  if (eventId.includes("human")) return "Human approver";
  if (eventId.includes("authority")) return "Authority governance";
  if (eventId.includes("payment-policy") || eventId.includes("payment-authorized")) return "Payment policy";
  if (eventId.includes("payment-instruction") || eventId.includes("payment-result")) return "Payment Provider";
  if (eventId.includes("manager")) return "Manager workflow";
  if (eventId.includes("return-executed")) return "Taxi autonomy";
  if (eventId.includes("return") || eventId.includes("base-arrival")) return "Fleet operations";
  return "FortiX causal compiler";
}

function authorityForMasterEvent(eventId: string): string | null {
  if (eventId.includes("payment-policy") || eventId.includes("human") || eventId.includes("authority") || eventId.includes("payment-authorized")) return "financial";
  if (eventId.includes("return")) return "return-to-base";
  return null;
}

function causalParents(value: JsonObject): readonly string[] {
  const payload = object(value.evidence_payload);
  const body = object(Object.values(payload)[0]);
  const direct = body.causal_parent_evidence_ids;
  if (Array.isArray(direct)) return direct.map(text);
  const receiptInputs = body.causal_input_evidence_ids ?? body.causal_input_receipt_ids;
  return Array.isArray(receiptInputs) ? receiptInputs.map(text) : [];
}

function invalid(reasonCode: string): CycleVerificationResult {
  return { verdict: "INVALID", reasonCodes: [reasonCode], completedChecks: [], receiptId: D005M_MASTER_CYCLE_RECEIPT_ID, bundleId: null };
}

function indeterminate(reasonCode: string): CycleVerificationResult {
  return { verdict: "INDETERMINATE", reasonCodes: [reasonCode], completedChecks: [], receiptId: D005M_MASTER_CYCLE_RECEIPT_ID, bundleId: D005M_MASTER_BUNDLE_ID };
}

function digestCanonical(value: unknown): string {
  return bytesToHex(blake3(utf8ToBytes(canonicalString(value))));
}

function deepClone(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

function object(value: unknown): JsonObject {
  if (value === null || Array.isArray(value) || typeof value !== "object") throw new TypeError("object required");
  return value as JsonObject;
}

function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new TypeError("array required");
  return value;
}

function text(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) throw new TypeError("text required");
  return value;
}

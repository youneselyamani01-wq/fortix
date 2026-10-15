/**
 * D-006 C1 single temporal authority.
 *
 * `experienceTimeMs` is the only coordinate that playback may advance. The
 * canonical mission clock is a pure projection that stops at 120 seconds while
 * the visible proof lifecycle completes. Post-roll points never author mission
 * evidence and therefore cannot rewrite signed event time.
 */

export const STORY_BEAT_TIME_MS = Object.freeze({
  "passenger-request": 0,
  "passenger-authority": 3_000,
  "mission-accepted": 5_000,
  "taxi-departs-base": 6_000,
  "taxi-en-route-to-passenger": 9_000,
  "signal-green": 9_000,
  "city-detection": 10_000,
  "signal-yellow": 10_500,
  "taxi-observes-yellow": 11_000,
  "taxi-decides-stop": 11_500,
  "taxi-brake-applied": 12_000,
  "signal-red": 12_500,
  "taxi-at-rest": 13_000,
  "city-phase-decision": 13_500,
  "signal-green-2": 14_000,
  "taxi-observes-green": 14_500,
  "taxi-decides-proceed": 15_000,
  "taxi-resumes": 15_500,
  "intersection-cleared": 16_500,
  "taxi-aligned-pickup": 17_000,
  "passenger-pickup": 18_000,
  "passenger-journey": 20_000,
  "passenger-cruise-end": 30_000,
  "passenger-destination-approach": 32_000,
  "passenger-exit": 33_000,
  "passenger-dropoff": 34_000,
  "passenger-mission-complete": 36_000,
  "garage-mission-begins": 38_000,
  "normal-route-to-garage": 42_000,
  "garage-journey": 44_000,
  congestion: 46_000,
  "taxi-observes-congestion": 46_500,
  "taxi-decides-hazard-stop": 47_250,
  "eta-at-risk": 48_000,
  "routing-request": 48_250,
  "routing-policy-evaluated": 48_750,
  "routing-candidates-compared": 49_500,
  "routing-candidate-selected": 50_500,
  "provider-transition": 51_000,
  "reroute-authorized": 52_000,
  "resulting-route-calculated": 53_000,
  "physical-reroute": 54_000,
  "routing-lane-change-complete": 55_500,
  "routing-merge-start": 60_000,
  "garage-approach": 61_000,
  "garage-arrival": 62_000,
  "garage-sub-mission-receipt": 64_000,
  "maintenance-begins": 66_000,
  diagnosis: 68_000,
  "maintenance-proposal": 70_000,
  "maintenance-authorized": 72_000,
  "work-in-progress": 74_000,
  "work-complete": 78_000,
  "maintenance-sub-mission-receipt": 80_000,
  "invoice-1850": 82_000,
  "policy-exceeded": 84_000,
  "human-approval-required": 84_250,
  "human-approve": 85_000,
  "authority-delegated": 85_250,
  "payment-authorized": 85_500,
  "payment-execution": 86_000,
  "payment-instruction-presented": 86_500,
  "bank-authorization": 87_000,
  "bank-confirmation": 87_500,
  "payment-result": 88_000,
  "payment-sub-mission-receipt": 90_000,
  "manager-notified": 92_000,
  "return-to-base-intent": 96_000,
  "return-route-calculation": 97_000,
  "return-route-calculated": 98_000,
  "leaving-garage": 104_000,
  "return-departure-acceleration-complete": 105_500,
  "return-journey": 108_000,
  "base-arrival-braking-begins": 109_500,
  "base-approach": 111_000,
  "parked-at-base": 112_000,
  "sub-mission-receipts": 114_000,
  "final-required-leaf-mature": 116_000,
  "master-cycle-receipt": 120_000,
  "final-receipt-landed": 121_200,
  "final-receipt-root-attached": 122_000,
  "peb-complete": 122_500,
  "handoff-ready": 124_000,
  "experience-complete": 126_000,
} as const);

export type StoryBeatId = keyof typeof STORY_BEAT_TIME_MS;

export const CANONICAL_MISSION_DURATION_MS = STORY_BEAT_TIME_MS["master-cycle-receipt"];
export const RETURN_RECEIPT_EMITTED_MS = STORY_BEAT_TIME_MS["sub-mission-receipts"];
export const RECEIPT_TRAVEL_DURATION_MS = 1_200;
export const FINAL_LEAF_GROWTH_DURATION_MS = 800;
export const FINAL_REQUIRED_LEAF_MATURE_MS =
  RETURN_RECEIPT_EMITTED_MS + RECEIPT_TRAVEL_DURATION_MS + FINAL_LEAF_GROWTH_DURATION_MS;
export const FINAL_RECEIPT_EMITTED_MS = CANONICAL_MISSION_DURATION_MS;
export const FINAL_RECEIPT_LANDED_MS = FINAL_RECEIPT_EMITTED_MS + RECEIPT_TRAVEL_DURATION_MS;
export const FINAL_RECEIPT_ROOT_ATTACHED_MS = FINAL_RECEIPT_LANDED_MS + FINAL_LEAF_GROWTH_DURATION_MS;
export const PEB_ASSEMBLY_DURATION_MS = 500;
export const PEB_COMPLETE_MS = FINAL_RECEIPT_ROOT_ATTACHED_MS + PEB_ASSEMBLY_DURATION_MS;
export const HANDOFF_STABLE_PAUSE_MS = 1_500;
export const HANDOFF_READY_MS = PEB_COMPLETE_MS + HANDOFF_STABLE_PAUSE_MS;
export const REVIEW_WINDOW_DURATION_MS = 2_000;
export const EXPERIENCE_DURATION_MS = HANDOFF_READY_MS + REVIEW_WINDOW_DURATION_MS;

/** Runtime mission evidence at or after this boundary cannot support the Final Receipt emitted here. */
export const REQUIRED_RUNTIME_EVIDENCE_CUTOFF_EXCLUSIVE_MS = FINAL_RECEIPT_EMITTED_MS;

function assertDerivedTimeline(): void {
  if (FINAL_REQUIRED_LEAF_MATURE_MS !== STORY_BEAT_TIME_MS["final-required-leaf-mature"]
    || FINAL_RECEIPT_LANDED_MS !== STORY_BEAT_TIME_MS["final-receipt-landed"]
    || FINAL_RECEIPT_ROOT_ATTACHED_MS !== STORY_BEAT_TIME_MS["final-receipt-root-attached"]
    || PEB_COMPLETE_MS !== STORY_BEAT_TIME_MS["peb-complete"]
    || HANDOFF_READY_MS !== STORY_BEAT_TIME_MS["handoff-ready"]
    || EXPERIENCE_DURATION_MS !== STORY_BEAT_TIME_MS["experience-complete"]) {
    throw new TypeError("D-006 C1 derived timeline does not match its named lifecycle beats");
  }
}

assertDerivedTimeline();

export function storyBeatTime(id: StoryBeatId): number {
  return STORY_BEAT_TIME_MS[id];
}

export function clampExperienceTime(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(EXPERIENCE_DURATION_MS, Math.max(0, Math.round(value)));
}

/**
 * Fail-closed clock for reality, narrative and scene projections.
 *
 * The canonical experience clock may continue for inspection and proof
 * maturation, but no authored consequence after the physical reroute may be
 * presented until the exact routing evidence needed to execute it is
 * admissible. Holding one millisecond before that boundary keeps every scene
 * projection on the last causally supported state.
 */
export function evidenceGatedStoryTime(
  experienceTimeMs: number,
  routingEvidenceAdmissible: boolean,
): number {
  const time = clampExperienceTime(experienceTimeMs);
  const routeExecutionBoundary = STORY_BEAT_TIME_MS["physical-reroute"];
  return !routingEvidenceAdmissible && time >= routeExecutionBoundary
    ? routeExecutionBoundary - 1
    : time;
}

export function missionClockPositionAt(experienceTimeMs: number): number {
  return Math.min(CANONICAL_MISSION_DURATION_MS, clampExperienceTime(experienceTimeMs));
}

export function formatExperienceTime(experienceTimeMs: number): string {
  const clamped = clampExperienceTime(experienceTimeMs);
  const minutes = Math.floor(clamped / 60_000);
  const seconds = Math.floor((clamped % 60_000) / 1_000);
  const milliseconds = clamped % 1_000;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(milliseconds).padStart(3, "0")}`;
}

export function isPostRollTime(experienceTimeMs: number): boolean {
  return clampExperienceTime(experienceTimeMs) > CANONICAL_MISSION_DURATION_MS;
}

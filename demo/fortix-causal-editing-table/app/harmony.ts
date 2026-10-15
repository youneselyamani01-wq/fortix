import { deriveMasterStoryState } from "./masterStory.ts";
import { derivePhysicalState, type InteractionAnchor } from "./physicalState.ts";
import type { HumanDecision } from "./reviewFlow.ts";

export type HarmonyFocus = "REALITY" | "SYSTEM" | "PROOF";

export type HarmonyState = Readonly<{
  masterTime: number;
  dimensions: Readonly<{
    spatial: Readonly<{ targetAnchor: InteractionAnchor; alignedAnchor: InteractionAnchor | null; position: number; speedKph: number }>;
    temporal: Readonly<{ momentId: string; canonicalTime: number }>;
    mission: Readonly<{ chapter: string; passengerMissionClosed: boolean; garageMissionActive: boolean }>;
    authority: Readonly<{ state: string; humanDecision: HumanDecision }>;
    proof: Readonly<{ evidenceCount: number; receiptCount: number; cycleReceiptAvailable: boolean }>;
    narrative: Readonly<{ focus: HarmonyFocus; dominantMomentId: string }>;
  }>;
  coherent: boolean;
  violations: readonly string[];
}>;

const SYSTEM_MOMENTS = new Set([
  "garage-mission-begins",
  "maintenance-begins",
  "normal-route-to-garage",
  "eta-at-risk",
  "provider-transition",
  "reroute-authorized",
  "diagnosis",
  "maintenance-proposal",
  "maintenance-authorized",
  "invoice-1850",
  "policy-exceeded",
  "human-approval-required",
  "human-approve",
  "authority-delegated",
  "payment-authorized",
  "payment-execution",
  "return-to-base-intent",
  "return-route-calculation",
  "return-route-calculated",
]);

const PROOF_MOMENTS = new Set([
  "passenger-mission-complete",
  "work-complete",
  "payment-result",
  "manager-notified",
  "sub-mission-receipts",
  "master-cycle-receipt",
]);

export function deriveHarmonyState(value: number, humanDecision: HumanDecision): HarmonyState {
  const story = deriveMasterStoryState(value);
  const physical = derivePhysicalState(value);
  const violations: string[] = [];

  if ((physical.vehicleState === "BOARDING" || physical.vehicleState === "DROPOFF") && physical.speedKph !== 0) {
    violations.push("INTERACTION_MOVED");
  }
  if (physical.vehicleState === "BOARDING" && physical.alignedAnchor !== "PASSENGER_PICKUP_ANCHOR") {
    violations.push("PICKUP_NOT_ALIGNED");
  }
  if (physical.vehicleState === "DROPOFF" && physical.alignedAnchor !== "PASSENGER_DROPOFF_ANCHOR") {
    violations.push("DROPOFF_NOT_ALIGNED");
  }
  if (physical.atGarage && physical.alignedAnchor !== "GARAGE_SERVICE_ANCHOR") {
    violations.push("GARAGE_NOT_ALIGNED");
  }
  if (physical.parked && physical.alignedAnchor !== "BASE_PARKING_ANCHOR") {
    violations.push("BASE_NOT_ALIGNED");
  }
  if (physical.garageMissionActive && physical.passengerState !== "NOT_ONBOARD") {
    violations.push("GARAGE_WITH_PASSENGER");
  }
  if (physical.speedKph > 0 && story.scene === "HUMAN_AUTHORITY") {
    violations.push("MOTION_WITHOUT_AUTHORITY");
  }
  if (story.cycleReceiptAvailable && !physical.cycleCanClose) {
    violations.push("CYCLE_BEFORE_PARKING");
  }

  return {
    masterTime: story.masterTime,
    dimensions: {
      spatial: {
        targetAnchor: physical.targetAnchor,
        alignedAnchor: physical.alignedAnchor,
        position: physical.visualPosition,
        speedKph: physical.speedKph,
      },
      temporal: { momentId: story.moment.id, canonicalTime: story.masterTime },
      mission: {
        chapter: story.chapter,
        passengerMissionClosed: physical.passengerMissionClosed,
        garageMissionActive: physical.garageMissionActive,
      },
      authority: { state: story.authorityState, humanDecision },
      proof: {
        evidenceCount: story.reachedEvidence.length,
        receiptCount: story.reachedReceiptCount,
        cycleReceiptAvailable: story.cycleReceiptAvailable,
      },
      narrative: { focus: narrativeFocusFor(story.moment.id), dominantMomentId: story.moment.id },
    },
    coherent: violations.length === 0,
    violations,
  };
}

export function narrativeFocusFor(momentId: string): HarmonyFocus {
  if (SYSTEM_MOMENTS.has(momentId)) return "SYSTEM";
  if (PROOF_MOMENTS.has(momentId)) return "PROOF";
  return "REALITY";
}

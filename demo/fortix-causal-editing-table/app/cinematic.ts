import {
  type OperationalEvent,
  type OperationalVariant,
} from "./operationalCycle.ts";
import { MASTER_EVIDENCE_EVENTS } from "./masterStory.ts";
import { derivePhysicalState } from "./physicalState.ts";
import { deriveRoutingState } from "./routingProvenance.ts";
import {
  FINAL_RECEIPT_EMITTED_MS,
  FINAL_RECEIPT_ROOT_ATTACHED_MS,
  FINAL_REQUIRED_LEAF_MATURE_MS,
  HANDOFF_READY_MS,
  PEB_COMPLETE_MS,
  clampExperienceTime,
  missionClockPositionAt,
  storyBeatTime,
} from "./storyTimeline.ts";

export type EmotionalBeat =
  | "NORMALITY"
  | "UNCERTAINTY"
  | "UNDERSTANDING"
  | "CONTROL"
  | "PROOF"
  | "CALM_CONFIDENCE";

export type VisualFocus = "REALITY" | "SYSTEM" | "PROOF" | "VERIFIER";
export type TrafficStoryStep = "QUIET" | "TRAFFIC" | "ETA" | "REQUEST" | "POLICY" | "CANDIDATES" | "SELECTED" | "RESOLVED" | "AUTHORITY" | "ROUTE_READY" | "REROUTED";
export type PaymentStoryStep = "HIDDEN" | "INVOICE" | "POLICY" | "HUMAN" | "EXECUTION" | "RECEIPT" | "STOPPED";

export type CinematicState = Readonly<{
  masterTime: number;
  beat: EmotionalBeat;
  focus: VisualFocus;
  visualVehicleProgress: number;
  trafficDensity: number;
  vehicleTempo: "CRUISE" | "SLOW" | "STOPPED" | "RESUMED" | "PARKED";
  route: "ORIGINAL" | "ALTERNATIVE";
  trafficStoryStep: TrafficStoryStep;
  paymentStoryStep: PaymentStoryStep;
  receiptBirth: Readonly<{ event: OperationalEvent; progress: number }> | null;
  finalSequence: "PENDING" | "PARKED" | "RECEIPTS" | "FINAL_LEAF" | "FINAL_RECEIPT" | "ROOT_ATTACHED" | "PEB_COMPLETE" | "HANDOFF_READY";
}>;

const RECEIPT_BIRTH_WINDOW_MS = 3_000;

export function deriveCinematicState(
  masterTime: number,
  variant: OperationalVariant = "NORMAL",
): CinematicState {
  const time = clampExperienceTime(masterTime);
  const missionClockPosition = missionClockPositionAt(time);
  const activeEvent = [...MASTER_EVIDENCE_EVENTS].reverse().find((event) => event.time_ms <= missionClockPosition) ?? null;
  const eventAge = activeEvent === null ? Number.POSITIVE_INFINITY : missionClockPosition - activeEvent.time_ms;
  const receiptBirth = activeEvent !== null && eventAge < RECEIPT_BIRTH_WINDOW_MS
    ? { event: activeEvent, progress: clamp01(eventAge / RECEIPT_BIRTH_WINDOW_MS) }
    : null;

  return {
    masterTime: time,
    beat: emotionalBeatAt(time),
    focus: visualFocusAt(time, receiptBirth !== null),
    visualVehicleProgress: derivePhysicalState(time).visualPosition,
    trafficDensity: trafficDensityAt(time),
    vehicleTempo: vehicleTempoAt(time),
    route: deriveRoutingState(time).vehicleMayExecute ? "ALTERNATIVE" : "ORIGINAL",
    trafficStoryStep: trafficStoryStepAt(time),
    paymentStoryStep: paymentStoryStepAt(time, variant),
    receiptBirth,
    finalSequence: finalSequenceAt(time),
  };
}

export function deterministicTrafficCarPosition(
  masterTime: number,
  lane: number,
  index: number,
  density: number,
): number {
  const speed = density > 0.7 ? 0.0018 : 0.0065;
  const offset = index * 19 + lane * 9;
  return ((masterTime * speed + offset) % 118) - 9;
}

function emotionalBeatAt(time: number): EmotionalBeat {
  if (time >= storyBeatTime("parked-at-base")) return "CALM_CONFIDENCE";
  if (time >= storyBeatTime("payment-result") && time < storyBeatTime("return-to-base-intent")) return "PROOF";
  if (time >= storyBeatTime("policy-exceeded") && time < storyBeatTime("payment-result")) return "CONTROL";
  if (time >= storyBeatTime("invoice-1850") && time < storyBeatTime("policy-exceeded")) return "UNDERSTANDING";
  if (time >= storyBeatTime("physical-reroute") && time < storyBeatTime("garage-sub-mission-receipt")) return "PROOF";
  if (time >= storyBeatTime("reroute-authorized") && time < storyBeatTime("physical-reroute")) return "CONTROL";
  if (time >= storyBeatTime("eta-at-risk") && time < storyBeatTime("reroute-authorized")) return "UNDERSTANDING";
  if (time >= storyBeatTime("garage-journey") && time < storyBeatTime("eta-at-risk")) return "UNCERTAINTY";
  return "NORMALITY";
}

function visualFocusAt(time: number, receiptIsBeingBorn: boolean): VisualFocus {
  if (time >= HANDOFF_READY_MS) return "VERIFIER";
  if (receiptIsBeingBorn && (time >= storyBeatTime("physical-reroute") || time >= storyBeatTime("payment-result"))) return "PROOF";
  if ((time >= storyBeatTime("eta-at-risk") && time < storyBeatTime("physical-reroute"))
    || (time >= storyBeatTime("invoice-1850") && time < storyBeatTime("payment-result"))) return "SYSTEM";
  if ((time >= storyBeatTime("physical-reroute") && time < storyBeatTime("garage-sub-mission-receipt"))
    || (time >= storyBeatTime("payment-result") && time < storyBeatTime("return-to-base-intent"))
    || time >= storyBeatTime("sub-mission-receipts")) return "PROOF";
  return "REALITY";
}

function trafficDensityAt(time: number): number {
  if (time < storyBeatTime("normal-route-to-garage") || time >= storyBeatTime("garage-sub-mission-receipt")) return 0.18;
  if (time < storyBeatTime("congestion")) return lerp(0.18, 1, (time - storyBeatTime("normal-route-to-garage")) / (storyBeatTime("congestion") - storyBeatTime("normal-route-to-garage")));
  if (time < storyBeatTime("physical-reroute")) return 1;
  if (time < storyBeatTime("routing-merge-start")) return lerp(1, 0.28, (time - storyBeatTime("physical-reroute")) / (storyBeatTime("routing-merge-start") - storyBeatTime("physical-reroute")));
  return 0.28;
}

function vehicleTempoAt(time: number): CinematicState["vehicleTempo"] {
  if (time >= storyBeatTime("parked-at-base")) return "PARKED";
  if (time >= storyBeatTime("congestion") && time < storyBeatTime("eta-at-risk")) return "SLOW";
  if (time >= storyBeatTime("routing-candidate-selected") && time < storyBeatTime("physical-reroute")) return "STOPPED";
  if (time >= storyBeatTime("physical-reroute") && time < storyBeatTime("garage-arrival")) return "RESUMED";
  return "CRUISE";
}

function trafficStoryStepAt(time: number): TrafficStoryStep {
  const phase = deriveRoutingState(time).phase;
  if (phase === "NOT_TRIGGERED" || time >= storyBeatTime("garage-sub-mission-receipt")) return "QUIET";
  if (phase === "CONDITION") return time < storyBeatTime("eta-at-risk") ? "TRAFFIC" : "ETA";
  if (phase === "REQUEST") return "REQUEST";
  if (phase === "POLICY") return "POLICY";
  if (phase === "CANDIDATES") return "CANDIDATES";
  if (phase === "SELECTED") return "SELECTED";
  if (phase === "RESOLVED") return "RESOLVED";
  if (phase === "DECIDED") return "AUTHORITY";
  if (phase === "ROUTE_READY") return "ROUTE_READY";
  return "REROUTED";
}

function paymentStoryStepAt(time: number, variant: OperationalVariant): PaymentStoryStep {
  if (time < storyBeatTime("invoice-1850") || time >= storyBeatTime("return-to-base-intent")) return "HIDDEN";
  if (time < storyBeatTime("policy-exceeded")) return "INVOICE";
  const highValue = variant === "MASTER_APPROVED" || variant === "HIGH_APPROVED" || variant === "HIGH_DENIED";
  if (time < storyBeatTime("payment-execution")) return highValue ? "HUMAN" : "POLICY";
  if (variant === "HIGH_DENIED") return "STOPPED";
  if (time < storyBeatTime("payment-result")) return "EXECUTION";
  return "RECEIPT";
}

function finalSequenceAt(time: number): CinematicState["finalSequence"] {
  if (time < storyBeatTime("parked-at-base")) return "PENDING";
  if (time < storyBeatTime("sub-mission-receipts")) return "PARKED";
  if (time < FINAL_REQUIRED_LEAF_MATURE_MS) return "RECEIPTS";
  if (time < FINAL_RECEIPT_EMITTED_MS) return "FINAL_LEAF";
  if (time < FINAL_RECEIPT_ROOT_ATTACHED_MS) return "FINAL_RECEIPT";
  if (time < PEB_COMPLETE_MS) return "ROOT_ATTACHED";
  if (time < HANDOFF_READY_MS) return "PEB_COMPLETE";
  return "HANDOFF_READY";
}

function lerp(start: number, end: number, progress: number): number {
  return start + (end - start) * clamp01(progress);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

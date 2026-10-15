import { clampOperationalTime, type TimelineScale } from "./operationalCycle.ts";
import { advanceMasterTimeByPresentationElapsed, masterMomentTime } from "./masterStory.ts";
import { EXPERIENCE_DURATION_MS, HANDOFF_READY_MS, clampExperienceTime } from "./storyTimeline.ts";

export const HUMAN_AUTHORITY_GATE_MS = masterMomentTime("human-approval-required");
export const HUMAN_APPROVAL_EVIDENCED_MS = masterMomentTime("human-approve");

export type ReviewMode = "INTERACTIVE" | "MASTER_RECORDING";
export type HumanDecision = "PENDING" | "APPROVED" | "DENIED";
export type TransferStage = "SOURCE" | "FORMED" | "TRANSFERRED";

export type PlaybackAdvance = Readonly<{
  masterTime: number;
  pausedForAuthority: boolean;
  complete: boolean;
}>;

export function effectiveHumanDecision(mode: ReviewMode, decision: HumanDecision): HumanDecision {
  return mode === "MASTER_RECORDING" ? "APPROVED" : decision;
}

export function constrainReviewTime(value: number, mode: ReviewMode, decision: HumanDecision): number {
  const requested = clampExperienceTime(value);
  const effectiveDecision = effectiveHumanDecision(mode, decision);
  if (effectiveDecision === "PENDING" || effectiveDecision === "DENIED") {
    return Math.min(requested, HUMAN_AUTHORITY_GATE_MS);
  }
  return requested;
}

export function advanceReviewPlayback(
  masterTime: number,
  elapsedMs: number,
  mode: ReviewMode,
  decision: HumanDecision,
): PlaybackAdvance {
  const proposed = advanceMasterTimeByPresentationElapsed(masterTime, elapsedMs);
  const constrained = constrainReviewTime(proposed, mode, decision);
  const pausedForAuthority = constrained === HUMAN_AUTHORITY_GATE_MS
    && proposed >= HUMAN_AUTHORITY_GATE_MS
    && effectiveHumanDecision(mode, decision) !== "APPROVED";
  return {
    masterTime: constrained,
    pausedForAuthority,
    complete: constrained >= EXPERIENCE_DURATION_MS,
  };
}

export function applyHumanDecision(decision: Exclude<HumanDecision, "PENDING">): Readonly<{ decision: HumanDecision; masterTime: number }> {
  // A human may wait for any wall-clock duration, but mission time remains at
  // the authority boundary. ALLOW releases playback from that exact point;
  // the frozen human-approval evidence still lands at 85_000ms through normal
  // canonical pacing rather than an instantaneous 750ms clock jump.
  return {
    decision,
    masterTime: HUMAN_AUTHORITY_GATE_MS,
  };
}

export function nextTransferStage(stage: TransferStage, action: "GATHER" | "SEND"): TransferStage {
  if (action === "GATHER" && stage === "SOURCE") return "FORMED";
  if (action === "SEND" && stage === "FORMED") return "TRANSFERRED";
  return stage;
}

export function resolveArtifactRelease(
  stage: TransferStage,
  outcome: "INSERT" | "MISS" | "CANCEL",
): TransferStage {
  if (stage !== "FORMED") return stage;
  return outcome === "INSERT" ? "TRANSFERRED" : "SOURCE";
}

export function viewerRole(
  masterTime: number,
  bundleStage: TransferStage,
  humanDecision: HumanDecision,
  handoffArtifactAvailable: boolean,
): number {
  if (bundleStage === "TRANSFERRED" && handoffArtifactAvailable) return 3;
  if (masterTime >= HANDOFF_READY_MS && handoffArtifactAvailable) return 2;
  if (humanDecision !== "PENDING") return 1;
  return 0;
}

export function formatStableTimelineTime(value: number, scale: TimelineScale, playing: boolean): string {
  const clamped = clampOperationalTime(value);
  const minutes = Math.floor(clamped / 60_000);
  const seconds = Math.floor((clamped % 60_000) / 1_000);
  const milliseconds = clamped % 1_000;
  const base = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  if (!playing || scale === "FORENSIC") return `${base}.${String(milliseconds).padStart(3, "0")}`;
  if (scale === "MISSION") return `${base}.${Math.floor(milliseconds / 100)}`;
  return base;
}

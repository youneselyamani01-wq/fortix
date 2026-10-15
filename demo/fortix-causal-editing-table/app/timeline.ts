export const TIMELINE_DURATION_MS = 6_000;
export const FRAME_DURATION_MS = 40;

export type TimelineBand = "reality" | "system" | "proof";

export type TimelineEvent = Readonly<{
  id: string;
  timeMs: number;
  markerLabel: string;
  reality: string;
  system: string;
  receipt: string;
  receiptKind: "observation" | "assessment" | "decision" | "execution";
  detailTrack: string;
  detail: string;
}>;

export type RealityScene = Readonly<{
  vehiclePosition: number;
  scooterPosition: number;
  scooterVisible: boolean;
  brakeIntensity: number;
  stopped: boolean;
  incident: boolean;
}>;

export type TimelineState = Readonly<{
  masterTime: number;
  timestamp: string;
  progress: number;
  reachedEvents: readonly TimelineEvent[];
  activeEvent: TimelineEvent | null;
  scene: RealityScene;
  bands: Readonly<{
    reality: string;
    system: string;
    proof: string;
  }>;
}>;

export const TIMELINE_EVENTS: readonly TimelineEvent[] = Object.freeze([
  {
    id: "vehicle-approach",
    timeMs: 0,
    markerLabel: "Approach",
    reality: "Vehicle approaching intersection",
    system: "Environment monitoring active",
    receipt: "Approach observed",
    receiptKind: "observation",
    detailTrack: "Scene continuity",
    detail: "Vehicle motion enters the shared causal window.",
  },
  {
    id: "scooter-enters",
    timeMs: 2_400,
    markerLabel: "Scooter enters",
    reality: "Scooter enters relevant environment",
    system: "New road user enters sensor range",
    receipt: "Environment updated",
    receiptKind: "observation",
    detailTrack: "Environment",
    detail: "A second road user becomes relevant to the scene.",
  },
  {
    id: "candidate-detected",
    timeMs: 3_180,
    markerLabel: "Candidate",
    reality: "Scooter continues across the approach path",
    system: "Candidate detected",
    receipt: "Candidate noted",
    receiptKind: "assessment",
    detailTrack: "Primary sensing",
    detail: "A candidate object is raised for corroboration.",
  },
  {
    id: "sensor-confirmation",
    timeMs: 3_240,
    markerLabel: "Confirmed",
    reality: "Road-user motion remains consistent",
    system: "Secondary sensor confirmation",
    receipt: "Detection confirmed",
    receiptKind: "assessment",
    detailTrack: "Sensor corroboration",
    detail: "A second observation supports the candidate.",
  },
  {
    id: "object-classified",
    timeMs: 3_310,
    markerLabel: "Classified",
    reality: "Scooter crossing becomes unambiguous",
    system: "Object classified",
    receipt: "Classification recorded",
    receiptKind: "assessment",
    detailTrack: "Interpretation",
    detail: "The candidate is treated as a vulnerable road user.",
  },
  {
    id: "trajectory-prediction",
    timeMs: 3_420,
    markerLabel: "Predicted",
    reality: "Paths begin to converge",
    system: "Trajectory prediction",
    receipt: "Trajectory assessed",
    receiptKind: "assessment",
    detailTrack: "Prediction",
    detail: "The projected paths are compared on one timeline.",
  },
  {
    id: "risk-rises",
    timeMs: 3_560,
    markerLabel: "Risk rises",
    reality: "Available stopping distance narrows",
    system: "Collision risk rises",
    receipt: "Risk increase recorded",
    receiptKind: "assessment",
    detailTrack: "Risk",
    detail: "The evolving scene raises the collision estimate.",
  },
  {
    id: "threshold-exceeded",
    timeMs: 3_710,
    markerLabel: "Threshold",
    reality: "Conflict path is imminent",
    system: "Risk threshold exceeded",
    receipt: "Threshold crossing recorded",
    receiptKind: "assessment",
    detailTrack: "Decision context",
    detail: "The configured response threshold is crossed.",
  },
  {
    id: "braking-decision",
    timeMs: 3_760,
    markerLabel: "Decision",
    reality: "Vehicle remains in motion",
    system: "Emergency braking decision",
    receipt: "Braking decision recorded",
    receiptKind: "decision",
    detailTrack: "Decision context",
    detail: "Emergency braking becomes the selected response.",
  },
  {
    id: "brake-command",
    timeMs: 3_810,
    markerLabel: "Command",
    reality: "Brake system begins response",
    system: "Brake command",
    receipt: "Brake command recorded",
    receiptKind: "execution",
    detailTrack: "Control path",
    detail: "The decision is translated into a brake command.",
  },
  {
    id: "actuator-acknowledgement",
    timeMs: 3_890,
    markerLabel: "Acknowledged",
    reality: "Braking hardware engages",
    system: "Actuator acknowledgement",
    receipt: "Actuator response recorded",
    receiptKind: "execution",
    detailTrack: "Control path",
    detail: "The actuator confirms that the command was accepted.",
  },
  {
    id: "deceleration-begins",
    timeMs: 4_120,
    markerLabel: "Deceleration",
    reality: "Deceleration begins",
    system: "Vehicle response observed",
    receipt: "Deceleration observed",
    receiptKind: "observation",
    detailTrack: "Vehicle response",
    detail: "Measured motion shows the vehicle slowing.",
  },
  {
    id: "collision-window",
    timeMs: 5_340,
    markerLabel: "Closest point",
    reality: "Collision / near-collision window",
    system: "Closest-point state captured",
    receipt: "Outcome window recorded",
    receiptKind: "observation",
    detailTrack: "Outcome",
    detail: "The placeholder scenario reaches its closest point.",
  },
  {
    id: "vehicle-stops",
    timeMs: 5_420,
    markerLabel: "Stopped",
    reality: "Vehicle stops",
    system: "Motion state: stopped",
    receipt: "Stop observed",
    receiptKind: "observation",
    detailTrack: "Outcome",
    detail: "The visible motion state resolves to stopped.",
  },
  {
    id: "incident-state",
    timeMs: 6_000,
    markerLabel: "Incident state",
    reality: "Incident state",
    system: "Scenario window complete",
    receipt: "Incident state recorded",
    receiptKind: "observation",
    detailTrack: "Incident state",
    detail: "The placeholder causal window is complete.",
  },
]);

export function clampMasterTime(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(TIMELINE_DURATION_MS, Math.max(0, Math.round(value)));
}

export function formatMasterTime(value: number): string {
  const clamped = clampMasterTime(value);
  const seconds = Math.floor(clamped / 1_000);
  const milliseconds = clamped % 1_000;
  return `${String(seconds).padStart(2, "0")}.${String(milliseconds).padStart(3, "0")}`;
}

export function frameStep(value: number, direction: -1 | 1): number {
  return clampMasterTime(value + direction * FRAME_DURATION_MS);
}

export function reachedEventsAt(
  masterTime: number,
  events: readonly TimelineEvent[] = TIMELINE_EVENTS,
): readonly TimelineEvent[] {
  const clamped = clampMasterTime(masterTime);
  return events.filter((event) => event.timeMs <= clamped);
}

export function deriveRealityScene(masterTime: number): RealityScene {
  const time = clampMasterTime(masterTime);
  const movingProgress = Math.min(time, 5_420) / 5_420;
  const brakingProgress = Math.min(1, Math.max(0, (time - 3_760) / 1_660));

  return {
    vehiclePosition: 8 + movingProgress * 64,
    scooterPosition: 80 - Math.max(0, time - 2_400) / 72,
    scooterVisible: time >= 2_400,
    brakeIntensity: brakingProgress,
    stopped: time >= 5_420,
    incident: time >= 6_000,
  };
}

export function deriveTimelineState(masterTime: number): TimelineState {
  const clamped = clampMasterTime(masterTime);
  const reachedEvents = reachedEventsAt(clamped);
  const activeEvent = reachedEvents.at(-1) ?? null;

  return {
    masterTime: clamped,
    timestamp: formatMasterTime(clamped),
    progress: clamped / TIMELINE_DURATION_MS,
    reachedEvents,
    activeEvent,
    scene: deriveRealityScene(clamped),
    bands: {
      reality: activeEvent?.reality ?? "Scene ready",
      system: activeEvent?.system ?? "System ready",
      proof: activeEvent?.receipt ?? "No evidence reached",
    },
  };
}

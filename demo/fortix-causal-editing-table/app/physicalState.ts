import {
  FINAL_REQUIRED_LEAF_MATURE_MS,
  HANDOFF_READY_MS,
  PEB_COMPLETE_MS,
  clampExperienceTime,
  evidenceGatedStoryTime,
  storyBeatTime,
  type StoryBeatId,
} from "./storyTimeline.ts";

export type VehiclePhysicalState =
  | "STOPPED"
  | "MOVING"
  | "ARRIVING"
  | "BOARDING"
  | "PASSENGER_ONBOARD"
  | "DROPOFF"
  | "GARAGE_STOPPED"
  | "MAINTENANCE"
  | "WAITING_FOR_AUTHORITY"
  | "PAYMENT_PENDING"
  | "READY_TO_DEPART"
  | "RETURNING_TO_BASE"
  | "PARKED";

export type PassengerPhysicalState = "WAITING" | "BOARDING" | "ONBOARD" | "DROPPING_OFF" | "NOT_ONBOARD";

export const INTERACTION_ANCHORS = Object.freeze({
  BASE_PARKING_ANCHOR: 0.04,
  SIGNAL_STOP_ANCHOR: 0.22,
  PASSENGER_PICKUP_ANCHOR: 0.32,
  PASSENGER_DROPOFF_ANCHOR: 0.46,
  GARAGE_SERVICE_ANCHOR: 0.80,
});

export const ANCHOR_ALIGNMENT_TOLERANCE = 0.001;

/** Existing translated interaction labels; signal motion is exposed separately. */
export type InteractionAnchor =
  | "BASE_PARKING_ANCHOR"
  | "PASSENGER_PICKUP_ANCHOR"
  | "PASSENGER_DROPOFF_ANCHOR"
  | "GARAGE_SERVICE_ANCHOR";

export type PhysicalState = Readonly<{
  masterTime: number;
  vehicleState: VehiclePhysicalState;
  passengerState: PassengerPhysicalState;
  speedKph: number;
  visualPosition: number;
  targetAnchor: InteractionAnchor;
  alignedAnchor: InteractionAnchor | null;
  passengerMissionClosed: boolean;
  departedBase: boolean;
  signalStopActive: boolean;
  intersectionCleared: boolean;
  garageMissionActive: boolean;
  atGarage: boolean;
  maintenanceInProgress: boolean;
  maintenanceCompleted: boolean;
  maintenanceActionProgress: number;
  bankAuthorizationRecorded: boolean;
  managerNotified: boolean;
  returnIntentActive: boolean;
  returnRouteCalculated: boolean;
  canDepartGarage: boolean;
  parked: boolean;
  cycleCanClose: boolean;
  finalRequiredLeafMature: boolean;
  pebComplete: boolean;
  handoffReady: boolean;
}>;

export function derivePhysicalState(value: number, routingExecutionAuthorized = true): PhysicalState {
  const masterTime = clampExperienceTime(value);
  const physicalTime = evidenceGatedStoryTime(masterTime, routingExecutionAuthorized);
  const passengerState = passengerStateAt(physicalTime);
  const vehicle = vehicleAt(physicalTime);
  const bankAuthorizationRecorded = physicalTime >= storyBeatTime("bank-confirmation");
  const returnIntentActive = physicalTime >= storyBeatTime("return-to-base-intent");
  const returnRouteCalculated = physicalTime >= storyBeatTime("return-route-calculated");
  const parked = physicalTime >= storyBeatTime("parked-at-base");
  const maintenanceStart = storyBeatTime("work-in-progress");
  const maintenanceEnd = storyBeatTime("work-complete");
  const targetAnchor = interactionAnchorAt(physicalTime);
  const alignedAnchor = Math.abs(vehicle.visualPosition - INTERACTION_ANCHORS[targetAnchor]) <= ANCHOR_ALIGNMENT_TOLERANCE
    ? targetAnchor
    : null;
  return {
    masterTime,
    vehicleState: vehicle.state,
    passengerState,
    speedKph: vehicle.speedKph,
    visualPosition: vehicle.visualPosition,
    targetAnchor,
    alignedAnchor,
    passengerMissionClosed: physicalTime >= storyBeatTime("passenger-mission-complete"),
    departedBase: physicalTime >= storyBeatTime("taxi-departs-base"),
    signalStopActive: physicalTime >= storyBeatTime("taxi-at-rest") && physicalTime < storyBeatTime("taxi-resumes"),
    intersectionCleared: physicalTime >= storyBeatTime("intersection-cleared"),
    garageMissionActive: physicalTime >= storyBeatTime("garage-mission-begins"),
    atGarage: physicalTime >= storyBeatTime("garage-arrival") && physicalTime < storyBeatTime("leaving-garage"),
    maintenanceInProgress: physicalTime >= maintenanceStart && physicalTime < maintenanceEnd,
    maintenanceCompleted: physicalTime >= maintenanceEnd,
    maintenanceActionProgress: clamp01((physicalTime - maintenanceStart) / (maintenanceEnd - maintenanceStart)),
    bankAuthorizationRecorded,
    managerNotified: physicalTime >= storyBeatTime("manager-notified"),
    returnIntentActive,
    returnRouteCalculated,
    canDepartGarage: bankAuthorizationRecorded && returnIntentActive && returnRouteCalculated,
    parked,
    cycleCanClose: parked && physicalTime >= storyBeatTime("master-cycle-receipt"),
    finalRequiredLeafMature: physicalTime >= FINAL_REQUIRED_LEAF_MATURE_MS,
    pebComplete: physicalTime >= PEB_COMPLETE_MS,
    handoffReady: physicalTime >= HANDOFF_READY_MS,
  };
}

function passengerStateAt(time: number): PassengerPhysicalState {
  if (time < storyBeatTime("taxi-aligned-pickup")) return "WAITING";
  if (time < storyBeatTime("passenger-pickup")) return "BOARDING";
  if (time < storyBeatTime("passenger-exit")) return "ONBOARD";
  if (time < storyBeatTime("passenger-dropoff")) return "DROPPING_OFF";
  return "NOT_ONBOARD";
}

function vehicleAt(time: number): Readonly<{ state: VehiclePhysicalState; speedKph: number; visualPosition: number }> {
  if (time < storyBeatTime("taxi-departs-base")) return fixed("STOPPED", 0, INTERACTION_ANCHORS.BASE_PARKING_ANCHOR);
  if (time < storyBeatTime("signal-green")) return moving("MOVING", 24, INTERACTION_ANCHORS.BASE_PARKING_ANCHOR, 0.12, progress(time, "taxi-departs-base", "signal-green"));
  if (time < storyBeatTime("taxi-decides-stop")) return moving("MOVING", 30, 0.12, 0.18, progress(time, "signal-green", "taxi-decides-stop"));
  if (time < storyBeatTime("taxi-brake-applied")) return moving("MOVING", 24, 0.18, 0.19, progress(time, "taxi-decides-stop", "taxi-brake-applied"));
  if (time < storyBeatTime("taxi-at-rest")) return moving("MOVING", lerp(24, 0, progress(time, "taxi-brake-applied", "taxi-at-rest")), 0.19, INTERACTION_ANCHORS.SIGNAL_STOP_ANCHOR, progress(time, "taxi-brake-applied", "taxi-at-rest"));
  if (time < storyBeatTime("taxi-resumes")) return fixed("STOPPED", 0, INTERACTION_ANCHORS.SIGNAL_STOP_ANCHOR);
  if (time < storyBeatTime("taxi-aligned-pickup")) return moving("ARRIVING", lerp(20, 0, progress(time, "taxi-resumes", "taxi-aligned-pickup")), INTERACTION_ANCHORS.SIGNAL_STOP_ANCHOR, INTERACTION_ANCHORS.PASSENGER_PICKUP_ANCHOR, progress(time, "taxi-resumes", "taxi-aligned-pickup"));
  if (time < storyBeatTime("passenger-pickup")) return fixed("BOARDING", 0, INTERACTION_ANCHORS.PASSENGER_PICKUP_ANCHOR);
  if (time < storyBeatTime("passenger-journey")) return fixed("PASSENGER_ONBOARD", 0, INTERACTION_ANCHORS.PASSENGER_PICKUP_ANCHOR);
  if (time < storyBeatTime("passenger-cruise-end")) return moving("MOVING", 38, INTERACTION_ANCHORS.PASSENGER_PICKUP_ANCHOR, 0.40, progress(time, "passenger-journey", "passenger-cruise-end"));
  if (time < storyBeatTime("passenger-exit")) return moving("ARRIVING", lerp(38, 0, progress(time, "passenger-cruise-end", "passenger-exit")), 0.40, INTERACTION_ANCHORS.PASSENGER_DROPOFF_ANCHOR, progress(time, "passenger-cruise-end", "passenger-exit"));
  if (time < storyBeatTime("passenger-dropoff")) return fixed("DROPOFF", 0, INTERACTION_ANCHORS.PASSENGER_DROPOFF_ANCHOR);
  if (time < storyBeatTime("normal-route-to-garage")) return fixed("STOPPED", 0, INTERACTION_ANCHORS.PASSENGER_DROPOFF_ANCHOR);
  if (time < storyBeatTime("congestion")) return moving("MOVING", 36, INTERACTION_ANCHORS.PASSENGER_DROPOFF_ANCHOR, 0.56, progress(time, "normal-route-to-garage", "congestion"));
  if (time < storyBeatTime("eta-at-risk")) return moving("MOVING", 12, 0.56, 0.57, progress(time, "congestion", "eta-at-risk"));
  if (time < storyBeatTime("routing-candidate-selected")) return moving("MOVING", lerp(12, 0, progress(time, "eta-at-risk", "routing-candidate-selected")), 0.57, 0.58, progress(time, "eta-at-risk", "routing-candidate-selected"));
  if (time < storyBeatTime("routing-lane-change-complete")) return fixed("STOPPED", 0, 0.58);
  if (time < storyBeatTime("routing-merge-start")) return moving("MOVING", 34, 0.58, 0.79, progress(time, "routing-lane-change-complete", "routing-merge-start"));
  if (time < storyBeatTime("garage-arrival")) return moving("ARRIVING", lerp(34, 0, progress(time, "routing-merge-start", "garage-arrival")), 0.79, INTERACTION_ANCHORS.GARAGE_SERVICE_ANCHOR, progress(time, "routing-merge-start", "garage-arrival"));
  if (time < storyBeatTime("work-in-progress")) return fixed("GARAGE_STOPPED", 0, INTERACTION_ANCHORS.GARAGE_SERVICE_ANCHOR);
  if (time < storyBeatTime("work-complete")) return fixed("MAINTENANCE", 0, INTERACTION_ANCHORS.GARAGE_SERVICE_ANCHOR);
  if (time < storyBeatTime("invoice-1850")) return fixed("GARAGE_STOPPED", 0, INTERACTION_ANCHORS.GARAGE_SERVICE_ANCHOR);
  if (time < storyBeatTime("human-approval-required")) return fixed("PAYMENT_PENDING", 0, INTERACTION_ANCHORS.GARAGE_SERVICE_ANCHOR);
  if (time < storyBeatTime("human-approve")) return fixed("WAITING_FOR_AUTHORITY", 0, INTERACTION_ANCHORS.GARAGE_SERVICE_ANCHOR);
  if (time < storyBeatTime("manager-notified")) return fixed("PAYMENT_PENDING", 0, INTERACTION_ANCHORS.GARAGE_SERVICE_ANCHOR);
  if (time < storyBeatTime("return-route-calculated")) return fixed("GARAGE_STOPPED", 0, INTERACTION_ANCHORS.GARAGE_SERVICE_ANCHOR);
  if (time < storyBeatTime("leaving-garage")) return fixed("READY_TO_DEPART", 0, INTERACTION_ANCHORS.GARAGE_SERVICE_ANCHOR);
  if (time < storyBeatTime("return-departure-acceleration-complete")) return moving("RETURNING_TO_BASE", lerp(0, 28, progress(time, "leaving-garage", "return-departure-acceleration-complete")), INTERACTION_ANCHORS.GARAGE_SERVICE_ANCHOR, 0.76, progress(time, "leaving-garage", "return-departure-acceleration-complete"));
  if (time < storyBeatTime("base-arrival-braking-begins")) return moving("RETURNING_TO_BASE", 36, 0.76, 0.30, progress(time, "return-departure-acceleration-complete", "base-arrival-braking-begins"));
  if (time < storyBeatTime("parked-at-base")) return moving("ARRIVING", lerp(36, 0, progress(time, "base-arrival-braking-begins", "parked-at-base")), 0.30, INTERACTION_ANCHORS.BASE_PARKING_ANCHOR, progress(time, "base-arrival-braking-begins", "parked-at-base"));
  return fixed("PARKED", 0, INTERACTION_ANCHORS.BASE_PARKING_ANCHOR);
}

function interactionAnchorAt(time: number): InteractionAnchor {
  if (time < storyBeatTime("taxi-departs-base")) return "BASE_PARKING_ANCHOR";
  if (time < storyBeatTime("taxi-resumes")) return "PASSENGER_PICKUP_ANCHOR";
  if (time < storyBeatTime("passenger-journey")) return "PASSENGER_PICKUP_ANCHOR";
  if (time < storyBeatTime("normal-route-to-garage")) return "PASSENGER_DROPOFF_ANCHOR";
  if (time < storyBeatTime("leaving-garage")) return "GARAGE_SERVICE_ANCHOR";
  return "BASE_PARKING_ANCHOR";
}

function fixed(state: VehiclePhysicalState, speedKph: number, visualPosition: number) {
  return { state, speedKph, visualPosition } as const;
}

function moving(state: VehiclePhysicalState, speedKph: number, start: number, end: number, progress: number) {
  return { state, speedKph: Math.max(0, Math.round(speedKph * 10) / 10), visualPosition: lerp(start, end, progress) } as const;
}

function progress(time: number, start: StoryBeatId, end: StoryBeatId): number {
  return (time - storyBeatTime(start)) / Math.max(1, storyBeatTime(end) - storyBeatTime(start));
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function lerp(start: number, end: number, progress: number): number {
  const clamped = clamp01(progress);
  return start + (end - start) * clamped;
}

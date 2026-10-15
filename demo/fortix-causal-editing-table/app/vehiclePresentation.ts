import { derivePhysicalState, INTERACTION_ANCHORS } from "./physicalState.ts";
import { EXPERIENCE_DURATION_MS, storyBeatTime } from "./storyTimeline.ts";
import {
  HAZARD_STOP_POSITION,
  NOMINAL_CANVAS_WIDTH_PX,
  SIGNAL_STOP_POSITION,
  STAGE_PROPS,
  STAGE_REALITY_HEIGHT_PX,
  VEHICLE_BODY_HEIGHT_PX,
  VEHICLE_WIDTH_PX,
  stageX,
} from "./stageGeometry.ts";
import { visualEventTime } from "./visualEvents.ts";

export type VehiclePresentationMotion = Readonly<{
  position: number;
  phase: string;
  label: string;
  brakeLights: boolean;
  pitchDeg: number;
  lanePx: number;
  facing: 1 | -1;
}>;

type PresentationBeat = Omit<VehiclePresentationMotion, "facing">;

export type Footprint = Readonly<{
  left: number;
  top: number;
  right: number;
  bottom: number;
}>;

export type ObstacleClearance = Readonly<{
  masterTime: number;
  taxi: Footprint;
  obstacle: Footprint;
  horizontalGapPx: number;
  verticalGapPx: number;
  separationPx: number;
  intersects: boolean;
}>;

export const AVOIDANCE_LANE_SHIFT_PX = -48;
export const AVOIDANCE_STOP_POSITION = HAZARD_STOP_POSITION;
export const AVOIDANCE_PASS_POSITION = 0.79;
export const AVOIDANCE_LANE_RETURN_PROGRESS = 0.72;
export const AVOIDANCE_START_MS = storyBeatTime("eta-at-risk");
export const AVOIDANCE_BRAKE_END_MS = storyBeatTime("routing-candidate-selected");
export const AVOIDANCE_LANE_CHANGE_MS = storyBeatTime("physical-reroute");
export const AVOIDANCE_PASS_START_MS = storyBeatTime("routing-lane-change-complete");
export const AVOIDANCE_MERGE_START_MS = storyBeatTime("routing-merge-start");
export const AVOIDANCE_END_MS = storyBeatTime("garage-arrival");

const TAXI_BOTTOM_PX = 84;
const TAXI_ROOF_RISE_PX = 16;
const TAXI_WHEEL_DROP_PX = 9;
const FACING_SAMPLE_MS = 250;
const FACING_EPSILON = 0.0005;

/**
 * Presentation-only vehicle motion, projected from canonical moments. The
 * obstacle correction retains the existing stop/change-lane/pass/merge beats,
 * but holds a measured 48 px lane displacement until the complete footprint
 * is longitudinally clear.
 */
export function derivePresentationMotion(
  masterTime: number,
  routingExecutionAuthorized = true,
): VehiclePresentationMotion {
  if (!routingExecutionAuthorized && masterTime >= AVOIDANCE_LANE_CHANGE_MS) {
    return {
      ...beat(AVOIDANCE_STOP_POSITION, "WAITING_FOR_ROUTE", "waiting for evidenced route execution", true, 0, 0),
      facing: 1,
    };
  }
  const canonical = derivePhysicalState(masterTime, routingExecutionAuthorized).visualPosition;
  const current = presentationBeatAt(masterTime)
    ?? beat(canonical, "CRUISE", "moving with the mission", false, 0, 0);
  const earlier = stagePositionAt(Math.max(0, masterTime - FACING_SAMPLE_MS));
  const later = stagePositionAt(Math.min(EXPERIENCE_DURATION_MS, masterTime + FACING_SAMPLE_MS));
  const drift = (current.position - earlier) + (later - current.position);
  return { ...current, facing: drift < -FACING_EPSILON ? -1 : 1 };
}

export function obstacleClearanceAt(
  masterTime: number,
  canvasWidthPx = NOMINAL_CANVAS_WIDTH_PX,
): ObstacleClearance {
  const motion = derivePresentationMotion(masterTime);
  const taxiCenter = stageX(motion.position) / 100 * canvasWidthPx;
  const obstacle = STAGE_PROPS.obstacle;
  const obstacleCenter = stageX(obstacle.position) / 100 * canvasWidthPx;
  const taxi: Footprint = {
    left: taxiCenter - VEHICLE_WIDTH_PX / 2,
    right: taxiCenter + VEHICLE_WIDTH_PX / 2,
    top: STAGE_REALITY_HEIGHT_PX - TAXI_BOTTOM_PX - VEHICLE_BODY_HEIGHT_PX - TAXI_ROOF_RISE_PX + motion.lanePx,
    bottom: STAGE_REALITY_HEIGHT_PX - TAXI_BOTTOM_PX + TAXI_WHEEL_DROP_PX + motion.lanePx,
  };
  const obstacleBounds: Footprint = {
    left: obstacleCenter - obstacle.halfWidthPx,
    right: obstacleCenter + obstacle.halfWidthPx,
    top: STAGE_REALITY_HEIGHT_PX - obstacle.bottomPx - obstacle.heightPx,
    bottom: STAGE_REALITY_HEIGHT_PX - obstacle.bottomPx,
  };
  const horizontalGapPx = axisGap(taxi.left, taxi.right, obstacleBounds.left, obstacleBounds.right);
  const verticalGapPx = axisGap(taxi.top, taxi.bottom, obstacleBounds.top, obstacleBounds.bottom);
  const intersects = horizontalGapPx === 0 && verticalGapPx === 0;
  return {
    masterTime,
    taxi,
    obstacle: obstacleBounds,
    horizontalGapPx,
    verticalGapPx,
    separationPx: intersects ? 0 : Math.hypot(horizontalGapPx, verticalGapPx),
    intersects,
  };
}

export function minimumObstacleClearance(
  canvasWidthPx = NOMINAL_CANVAS_WIDTH_PX,
  sampleStepMs = 1,
): ObstacleClearance {
  if (!Number.isFinite(canvasWidthPx) || canvasWidthPx <= 0) throw new RangeError("Canvas width must be positive");
  if (!Number.isInteger(sampleStepMs) || sampleStepMs <= 0) throw new RangeError("Sample step must be a positive integer");
  let minimum = obstacleClearanceAt(AVOIDANCE_START_MS, canvasWidthPx);
  for (let time = AVOIDANCE_START_MS + sampleStepMs; time <= AVOIDANCE_END_MS; time += sampleStepMs) {
    const clearance = obstacleClearanceAt(time, canvasWidthPx);
    if (clearance.separationPx < minimum.separationPx) minimum = clearance;
  }
  return minimum;
}

function presentationBeatAt(masterTime: number): PresentationBeat | null {
  // D-006G. The vehicle's motion is driven by the VEHICLE's own events.
  //
  // It used to be a pure function of the traffic light's event times:
  // braking began exactly at `signal-yellow`, the stop held until
  // `crossing`, and the restart was labelled "restarting after crossing
  // authorization". That encoded `trafficLightEventTime -> taxi position` —
  // the light was, literally, the vehicle's actuator, with no observation
  // term and no decision term anywhere between them.
  //
  // Now the chain runs world state -> observation -> decision -> action, and
  // only the last of those moves the car. The Master Clock still synchronises
  // the two domains on screen; it no longer couples them causally. Nothing in
  // this function may reference a `signal-*` event again.
  const brakeApplied = visualEventTime("taxi-brake-applied");
  const atRest = visualEventTime("taxi-at-rest");
  const resumes = visualEventTime("taxi-resumes");
  const pickupAlignment = storyBeatTime("taxi-aligned-pickup");
  const braking = visualEventTime("brake");
  const brakeEnd = AVOIDANCE_BRAKE_END_MS;
  const physicalReroute = AVOIDANCE_LANE_CHANGE_MS;
  const passStart = AVOIDANCE_PASS_START_MS;
  const garageArrival = AVOIDANCE_END_MS;
  if (masterTime >= brakeApplied && masterTime < atRest) {
    const entry = derivePhysicalState(brakeApplied).visualPosition;
    return beat(cubicHermite(entry, .05, SIGNAL_STOP_POSITION, 0, clamp01((masterTime - brakeApplied) / (atRest - brakeApplied))),
      "BRAKING_ON_OWN_DECISION", "braking on its own decision", true, -1.1, 0);
  }
  if (masterTime >= atRest && masterTime < resumes) {
    return beat(SIGNAL_STOP_POSITION, "STOPPED_AT_LINE", "stopped short of the line", true, 0, 0);
  }
  if (masterTime >= resumes && masterTime < pickupAlignment) {
    const exit = derivePhysicalState(pickupAlignment).visualPosition;
    return beat(cubicHermite(SIGNAL_STOP_POSITION, 0, exit, .1, clamp01((masterTime - resumes) / (pickupAlignment - resumes))),
      "RESUMING_ON_OWN_DECISION", "resuming on its own decision", false, .7, 0);
  }
  if (masterTime >= braking && masterTime < brakeEnd) {
    const entry = derivePhysicalState(braking).visualPosition;
    return beat(cubicHermite(entry, .01, AVOIDANCE_STOP_POSITION, 0, clamp01((masterTime - braking) / (brakeEnd - braking))),
      "EMERGENCY_BRAKING", "emergency braking short of the obstacle", true, -1.3, 0);
  }
  if (masterTime >= brakeEnd && masterTime < physicalReroute) {
    return beat(AVOIDANCE_STOP_POSITION, "WAITING_FOR_ROUTE", "emergency braking short of the obstacle", true, 0, 0);
  }
  if (masterTime >= physicalReroute && masterTime < passStart) {
    const laneProgress = smoothstep((masterTime - physicalReroute) / (passStart - physicalReroute));
    return beat(AVOIDANCE_STOP_POSITION, "REROUTING", "changing lane onto the authorized route", false, 0,
      AVOIDANCE_LANE_SHIFT_PX * laneProgress);
  }
  if (masterTime >= passStart && masterTime < AVOIDANCE_MERGE_START_MS) {
    const progress = clamp01((masterTime - passStart) / (AVOIDANCE_MERGE_START_MS - passStart));
    return beat(cubicHermite(AVOIDANCE_STOP_POSITION, 0, AVOIDANCE_PASS_POSITION, .04, progress),
      "RESTARTING_AFTER_REROUTE", "passing the obstacle on the authorized route", false, .7, AVOIDANCE_LANE_SHIFT_PX);
  }
  if (masterTime >= AVOIDANCE_MERGE_START_MS && masterTime < garageArrival) {
    const progress = clamp01((masterTime - AVOIDANCE_MERGE_START_MS) / (garageArrival - AVOIDANCE_MERGE_START_MS));
    const position = cubicHermite(AVOIDANCE_PASS_POSITION, .02, INTERACTION_ANCHORS.GARAGE_SERVICE_ANCHOR, 0, progress);
    const laneReturn = smoothstep(
      (progress - AVOIDANCE_LANE_RETURN_PROGRESS) / (1 - AVOIDANCE_LANE_RETURN_PROGRESS),
    );
    return beat(position, "MERGING", "merging back after clearing the obstacle", false, 0,
      AVOIDANCE_LANE_SHIFT_PX * (1 - laneReturn));
  }
  return null;
}

function stagePositionAt(masterTime: number): number {
  const canonical = derivePhysicalState(masterTime).visualPosition;
  return presentationBeatAt(masterTime)?.position ?? canonical;
}

function beat(
  position: number,
  phase: string,
  label: string,
  brakeLights: boolean,
  pitchDeg: number,
  lanePx: number,
): PresentationBeat {
  return { position, phase, label, brakeLights, pitchDeg, lanePx };
}

function cubicHermite(start: number, startTangent: number, end: number, endTangent: number, progress: number): number {
  const p2 = progress * progress;
  const p3 = p2 * progress;
  return (2 * p3 - 3 * p2 + 1) * start
    + (p3 - 2 * p2 + progress) * startTangent
    + (-2 * p3 + 3 * p2) * end
    + (p3 - p2) * endTangent;
}

function smoothstep(progress: number): number {
  const value = clamp01(progress);
  return value * value * (3 - 2 * value);
}

function axisGap(firstStart: number, firstEnd: number, secondStart: number, secondEnd: number): number {
  if (firstEnd < secondStart) return secondStart - firstEnd;
  if (secondEnd < firstStart) return firstStart - secondEnd;
  return 0;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

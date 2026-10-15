import { INTERACTION_ANCHORS, type PassengerPhysicalState } from "./physicalState.ts";
import { clampExperienceTime, storyBeatTime } from "./storyTimeline.ts";

/**
 * D-006 C3 — the passenger as an observable participant (§5).
 *
 * "PASSENGER PICKED UP" as a label was the finding: boarding must HAPPEN on
 * stage, not be asserted by copy. This module derives one deterministic
 * presentation from the same physical state machine that owns the taxi, so
 * the required public sequence is witnessed:
 *
 *   taxi arrives → passenger visible outside → passenger walks to the door →
 *   passenger is unambiguously aboard (occupied cabin) → taxi departs
 *   … destination → passenger steps out → visible on the curb →
 *   taxi departs WITHOUT the passenger, who is still standing there.
 *
 * The passenger is a simulated-world participant; its motion is legitimately
 * clock-scheduled (register row `passenger-boarding`, clockMayCause: true).
 * What C3 forbids is a FACT with no observable event — and the observable
 * event is exactly this motion, from which fact.passenger.* is derived via
 * the pickup/dropoff receipt bindings, never from the label.
 */

export type PassengerStagePhase =
  | "HIDDEN"
  | "WAITING"
  | "WALKING_TO_TAXI"
  | "ABOARD"
  | "STEPPING_OUT"
  | "AT_DESTINATION";

export type PassengerPresentation = Readonly<{
  phase: PassengerStagePhase;
  /** Standalone street figure is rendered. False while aboard or hidden. */
  visibleOutside: boolean;
  /** The taxi cabin renders an occupant. Exactly one of these may be true. */
  aboardVehicle: boolean;
  /** Stage position 0..1 of the street figure while visible. */
  position: number;
  /** 0..1 within a walking transition; 0 elsewhere. */
  walkProgress: number;
  /** Which way the figure faces: 1 → right, -1 → left. */
  facing: 1 | -1;
}>;

/** Curb spots sit beside the door so a walk has visible distance to cover. */
export const PASSENGER_WAIT_POSITION = INTERACTION_ANCHORS.PASSENGER_PICKUP_ANCHOR + 0.045;
export const PASSENGER_DESTINATION_POSITION = INTERACTION_ANCHORS.PASSENGER_DROPOFF_ANCHOR + 0.045;

/**
 * The passenger leaves the stage only after the taxi has VISIBLY departed
 * without them — departing at `normal-route-to-garage` — so the sequence
 * "exits, stands, is left behind" is complete before the figure retires.
 */
const PASSENGER_RETIRES_AT: () => number = () => storyBeatTime("garage-journey");

export function derivePassengerPresentation(
  storyTimeMs: number,
  physicalPassengerState: PassengerPhysicalState,
): PassengerPresentation {
  const time = clampExperienceTime(storyTimeMs);
  switch (physicalPassengerState) {
    case "WAITING":
      return presentation("WAITING", true, false, PASSENGER_WAIT_POSITION, 0, -1);
    case "BOARDING": {
      const progress = phaseProgress(time, "taxi-aligned-pickup", "passenger-pickup");
      return presentation(
        "WALKING_TO_TAXI",
        true,
        false,
        lerp(PASSENGER_WAIT_POSITION, INTERACTION_ANCHORS.PASSENGER_PICKUP_ANCHOR, progress),
        progress,
        -1,
      );
    }
    case "ONBOARD":
      return presentation("ABOARD", false, true, INTERACTION_ANCHORS.PASSENGER_PICKUP_ANCHOR, 0, 1);
    case "DROPPING_OFF": {
      const progress = phaseProgress(time, "passenger-exit", "passenger-dropoff");
      return presentation(
        "STEPPING_OUT",
        true,
        false,
        lerp(INTERACTION_ANCHORS.PASSENGER_DROPOFF_ANCHOR, PASSENGER_DESTINATION_POSITION, progress),
        progress,
        1,
      );
    }
    case "NOT_ONBOARD": {
      if (time < storyBeatTime("passenger-dropoff")) {
        // NOT_ONBOARD before the mission reaches the pickup arc never renders
        // a destination figure: the pre-mission street belongs to WAITING.
        return presentation("HIDDEN", false, false, PASSENGER_WAIT_POSITION, 0, -1);
      }
      if (time >= PASSENGER_RETIRES_AT()) {
        return presentation("HIDDEN", false, false, PASSENGER_DESTINATION_POSITION, 0, 1);
      }
      return presentation("AT_DESTINATION", true, false, PASSENGER_DESTINATION_POSITION, 0, 1);
    }
  }
}

function presentation(
  phase: PassengerStagePhase,
  visibleOutside: boolean,
  aboardVehicle: boolean,
  position: number,
  walkProgress: number,
  facing: 1 | -1,
): PassengerPresentation {
  return Object.freeze({ phase, visibleOutside, aboardVehicle, position, walkProgress, facing });
}

function phaseProgress(
  time: number,
  start: Parameters<typeof storyBeatTime>[0],
  end: Parameters<typeof storyBeatTime>[0],
): number {
  const from = storyBeatTime(start);
  const to = storyBeatTime(end);
  return clamp01((time - from) / Math.max(1, to - from));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function lerp(start: number, end: number, progress: number): number {
  return start + (end - start) * clamp01(progress);
}

import { derivePhysicalState } from "./physicalState.ts";
import { derivePresentationMotion } from "./vehiclePresentation.ts";

/**
 * D-006 NX0 — the simulated vehicle as a CAUSE.
 *
 * THE DEFECT. Vehicle action evidence (brake applied, at rest, resume) was
 * appended when the mission clock reached a timestamp. The record and the
 * moving car merely SHARED a number; nothing in the evidence path observed
 * the vehicle. A model that stopped braking would have kept "producing"
 * brake receipts on schedule, and the human review saw the consequence of
 * that grammar at the obstacle: visible braking with no evidence at all.
 *
 * THE RULE (mandate §5). A brake-action receipt may not exist because a
 * light is red, because a decision record exists, or because the clock
 * reached a moment. It must be caused by the simulated vehicle actually
 * entering the braking action. This module is the single place the evidence
 * layer looks at the vehicle, and it looks at the SAME motion model that
 * drives the car on stage — `derivePresentationMotion` is what positions
 * Taxi 07 and lights its brake lamps, so what it reports is, by construction,
 * what the spectator sees.
 *
 * The observation is a pure function of mission time, so a replay or a scrub
 * reconstructs the identical actuation and therefore the identical evidence
 * (§42). Tests substitute a `VehicleWorld` in which the vehicle never brakes
 * and prove that the red light and the stop decision, alone, mint nothing.
 */

export type VehicleActuation = Readonly<{
  masterTimeMs: number;
  /** The motion phase the simulated vehicle is executing at this instant. */
  motionPhase: string;
  brakeLights: boolean;
  speedKph: number;
  position: number;
}>;

/** The source of vehicle truth the evidence layer consults. Injectable. */
export type VehicleWorld = Readonly<{
  actuationAt(masterTimeMs: number, routingExecutionAuthorized: boolean): VehicleActuation;
}>;

export function observeVehicleActuation(
  masterTimeMs: number,
  routingExecutionAuthorized = true,
): VehicleActuation {
  const motion = derivePresentationMotion(masterTimeMs, routingExecutionAuthorized);
  const physical = derivePhysicalState(masterTimeMs, routingExecutionAuthorized);
  return Object.freeze({
    masterTimeMs,
    motionPhase: motion.phase,
    brakeLights: motion.brakeLights,
    speedKph: physical.speedKph,
    position: motion.position,
  });
}

export const SIMULATED_VEHICLE_WORLD: VehicleWorld = Object.freeze({
  actuationAt: observeVehicleActuation,
});

/**
 * What the vehicle must actually be doing at the record's moment for the
 * record to be admitted. Plain data, so the matrix can print it and a test
 * can falsify it.
 */
export type VehicleWorldPrecondition = Readonly<{
  motionPhase: string;
  brakeLights: boolean;
  speed: "MOVING" | "AT_REST" | "ANY";
}>;

export function vehicleWorldPreconditionHolds(
  precondition: VehicleWorldPrecondition,
  actuation: VehicleActuation,
): boolean {
  if (actuation.motionPhase !== precondition.motionPhase) return false;
  if (actuation.brakeLights !== precondition.brakeLights) return false;
  if (precondition.speed === "MOVING" && !(actuation.speedKph > 0)) return false;
  if (precondition.speed === "AT_REST" && actuation.speedKph !== 0) return false;
  return true;
}

/**
 * A world in which the vehicle keeps cruising with its brake lamps off at
 * every instant. Lights change, decisions are recorded, the clock advances —
 * and no action ever happens. Used to prove that none of those alone can
 * produce an action receipt.
 */
export const NEVER_ACTING_VEHICLE_WORLD: VehicleWorld = Object.freeze({
  actuationAt: (masterTimeMs: number): VehicleActuation => Object.freeze({
    masterTimeMs,
    motionPhase: "CRUISE",
    brakeLights: false,
    speedKph: 30,
    position: derivePhysicalState(masterTimeMs).visualPosition,
  }),
});

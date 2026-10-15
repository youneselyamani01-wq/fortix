"use client";

import type { CSSProperties } from "react";

import { OBSTACLE_POSITION, STAGE_PROPS } from "../../stageGeometry.ts";
import type { PublicEvidence, PublicWorld } from "../adapter/publicExperienceAdapter.ts";

/**
 * NX1 — the WORLD, the primary stage.
 *
 * One quiet drawing: a road, a base, a signal, a garage, a taxi, a passenger.
 * Everything positioned here derives from the engine's canonical positions
 * (physical state, motion model, passenger presentation, stage anchors);
 * nothing moves on a timer of its own. Colour appears only when something
 * happens — a lamp lights, brake lamps come on, an event pulses.
 */

export const STAGE_WIDTH = 1440;
export const STAGE_HEIGHT = 250;
/**
 * B R2 §12 — the drawing starts where the tallest prop starts (the signal
 * head, y = 58): the empty sky above it is not part of the stage any more,
 * so the world keeps its size on screen while giving the proof its room.
 */
export const STAGE_VIEW_TOP = 50;
const ROAD_Y = 200;
const LEFT = 60;
const SPAN = 1_320;

/**
 * C-R2-F05 — THE ROUTE IS THE PART WORTH THE WIDTH.
 *
 * The taxi's canonical position runs 0.04 → 0.80 over the whole mission: the
 * last fifth of the coordinate space holds only fixed props (the garage at
 * 0.944, and the city, authority, routing and bank stacked at 0.97), which the
 * vehicle never reaches. Drawn linearly, the part of the world where anything
 * moves was squeezed into the left two thirds.
 *
 * This is a single monotone reparametrisation of the horizontal axis: the
 * travelled interval takes 88% of the stage and the static tail takes the
 * rest. It is applied to the TAXI AND THE PROPS ALIKE, through this one
 * function, so every coincidence the engine states is preserved exactly — the
 * taxi still stops at the traffic light, still meets the passenger, still
 * arrives at the garage. Nothing about the canonical route changes; only how
 * much screen each part of it is given.
 */
const ROUTE_END = 0.8;
const ROUTE_SHARE = 0.88;

/** Canonical position (0..1) → stage x, shared with the evidence stream. */
export function stageXOf(position: number): number {
  const clamped = Math.max(0, Math.min(1, position));
  const eased = clamped <= ROUTE_END
    ? (clamped / ROUTE_END) * ROUTE_SHARE
    : ROUTE_SHARE + ((clamped - ROUTE_END) / (1 - ROUTE_END)) * (1 - ROUTE_SHARE);
  return LEFT + eased * SPAN;
}

export type WorldCopy = Readonly<{
  taxi: string;
  passenger: string;
  light: string;
  base: string;
  garage: string;
  queue: string;
}>;

export function WorldStage({ world, latest, copy, ariaLabel }: {
  world: PublicWorld;
  latest: PublicEvidence | null;
  copy: WorldCopy;
  ariaLabel: string;
}) {
  const taxiX = stageXOf(world.taxi.position);
  const lightX = stageXOf(STAGE_PROPS.trafficLight.position);
  const baseX = stageXOf(STAGE_PROPS.base.position);
  const garageX = stageXOf(STAGE_PROPS.garage.position);
  const perceiving = latest !== null && latest.phase !== "SETTLED" && latest.eventId.includes(".perception:");
  const pulseAtTaxi = latest !== null && latest.flight < 1 && latest.family === "vehicle";
  const pulseAtLight = latest !== null && latest.flight < 1 && latest.family === "infrastructure";
  return (
    <svg
      className="nx-stage"
      viewBox={`0 ${STAGE_VIEW_TOP} ${STAGE_WIDTH} ${STAGE_HEIGHT - STAGE_VIEW_TOP}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={ariaLabel}
      data-signal={world.signal}
      data-taxi-motion={world.taxi.motionPhase}
      data-brake-lights={world.taxi.brakeLights ? "on" : "off"}
      data-passenger-phase={world.passenger.phase}
    >
      {/* ground and road */}
      <line className="nx-road" x1={LEFT - 20} y1={ROAD_Y} x2={LEFT + SPAN + 20} y2={ROAD_Y} />
      <line className="nx-road-lane" x1={LEFT - 20} y1={ROAD_Y - 22} x2={LEFT + SPAN + 20} y2={ROAD_Y - 22} />

      {/* base */}
      {world.baseVisible && (
        <g className="nx-prop nx-base" transform={`translate(${baseX} ${ROAD_Y - 28})`} aria-label={copy.base}>
          <rect x={-30} y={-42} width={60} height={42} rx={6} />
          <text x={0} y={-52} textAnchor="middle">{copy.base}</text>
        </g>
      )}

      {/* garage */}
      {world.garageVisible && (
        <g className={`nx-prop nx-garage${world.maintenanceInProgress ? " is-working" : ""}`} transform={`translate(${garageX} ${ROAD_Y - 28})`} aria-label={copy.garage}>
          <rect x={-46} y={-56} width={92} height={56} rx={8} />
          <rect className="nx-garage-door" x={-22} y={-30} width={44} height={30} rx={3} />
          <line className="nx-garage-tool" x1={-12} y1={-10} x2={12} y2={-10} style={{ "--work": world.maintenanceProgress } as CSSProperties} />
          <text x={0} y={-66} textAnchor="middle">{copy.garage}</text>
        </g>
      )}

      {/* congestion queue */}
      {world.congestionVisible && (
        <g className="nx-queue" aria-label={copy.queue}>
          {[0, 0.032, 0.064].map((offset) => (
            <g key={offset} transform={`translate(${stageXOf(OBSTACLE_POSITION + offset)} ${ROAD_Y - 14})`}>
              <rect x={-16} y={-12} width={32} height={14} rx={4} />
              <circle cx={-9} cy={4} r={3} /><circle cx={9} cy={4} r={3} />
            </g>
          ))}
        </g>
      )}

      {/* traffic signal */}
      <g className={`nx-signal is-${world.signal.toLowerCase()}${pulseAtLight ? " is-pulsing" : ""}`} transform={`translate(${lightX} ${ROAD_Y - 24})`} aria-label={copy.light}>
        <line className="nx-signal-pole" x1={0} y1={0} x2={0} y2={-60} />
        <rect className="nx-signal-head" x={-11} y={-118} width={22} height={58} rx={11} />
        <circle className="nx-lamp nx-lamp-red" cx={0} cy={-104} r={6} />
        <circle className="nx-lamp nx-lamp-yellow" cx={0} cy={-89} r={6} />
        <circle className="nx-lamp nx-lamp-green" cx={0} cy={-74} r={6} />
        <circle className="nx-pulse" cx={0} cy={-89} r={16} />
      </g>

      {/* the taxi's line of sight while its perception is the latest evidence */}
      {perceiving && (
        <line className="nx-sightline" x1={taxiX + 30 * world.taxi.facing} y1={ROAD_Y - 36} x2={lightX} y2={ROAD_Y - 96} />
      )}

      {/* passenger */}
      {world.passenger.visibleOutside && (
        <g
          className={`nx-passenger is-${world.passenger.phase.toLowerCase().replace(/_/g, "-")}`}
          transform={`translate(${stageXOf(world.passenger.position)} ${ROAD_Y - 6}) scale(${world.passenger.facing} 1)`}
          aria-label={copy.passenger}
          style={{ "--walk": world.passenger.walkProgress } as CSSProperties}
        >
          <circle cx={0} cy={-34} r={6} />
          <path d="M -6 -26 L 6 -26 L 8 -6 L 4 -6 L 3 -18 L -3 -18 L -4 -6 L -8 -6 Z" />
        </g>
      )}

      {/* taxi */}
      <g
        className={`nx-taxi${world.taxi.brakeLights ? " is-braking" : ""}${world.taxi.cabinOccupied ? " has-passenger" : ""}${pulseAtTaxi ? " is-pulsing" : ""}`}
        transform={`translate(${taxiX} ${ROAD_Y - 4}) scale(${world.taxi.facing} 1)`}
        aria-label={copy.taxi}
        data-speed={world.taxi.speedKph}
      >
        <rect className="nx-taxi-body" x={-38} y={-24} width={76} height={22} rx={7} />
        <path className="nx-taxi-cabin" d="M -22 -24 L -14 -40 L 16 -40 L 26 -24 Z" />
        <rect className="nx-taxi-window" x={-12} y={-37} width={24} height={11} rx={3} />
        {world.taxi.cabinOccupied && <circle className="nx-taxi-occupant" cx={2} cy={-31} r={3.5} />}
        <circle className="nx-taxi-wheel" cx={-22} cy={-1} r={6} />
        <circle className="nx-taxi-wheel" cx={22} cy={-1} r={6} />
        <rect className="nx-taxi-headlamp" x={34} y={-19} width={4} height={6} rx={1} />
        <rect className="nx-taxi-brakelamp" x={-38} y={-19} width={4} height={6} rx={1} />
        <circle className="nx-pulse" cx={0} cy={-20} r={22} />
      </g>
      <text className="nx-taxi-label" x={taxiX} y={ROAD_Y + 26} textAnchor="middle">{copy.taxi}</text>
    </svg>
  );
}

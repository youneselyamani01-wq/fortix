import { INTERACTION_ANCHORS } from "./physicalState.ts";

/**
 * D-006A — single source of truth for stage geometry.
 *
 * Before D-006A the demonstration carried three unrelated coordinate systems:
 * the reality canvas (percent), the dual-timeline overlay (percent, with
 * hard-coded affine constants calibrated for one 1200px viewport) and the proof
 * canvas (percent). Cause and effect therefore never occupied the same place:
 * receipts did not leave their emitter, did not land on their branch, and props
 * were positioned by CSS values unrelated to the vehicle anchors they were
 * supposed to explain.
 *
 * Everything spatial now derives from this module. Props are positioned from
 * the same numbers the vehicle drives to, and the travelling receipt is
 * expressed in canvas-relative units so the browser — not JavaScript — resolves
 * the label-column offset at every breakpoint.
 */

/** Horizontal padding of the road inside the reality canvas, in percent. */
export const STAGE_X_PAD_PCT = 8;
/** Horizontal span of the road inside the reality canvas, in percent. */
export const STAGE_X_SPAN_PCT = 78;

/** Fixed canvas heights. CSS reads the same numbers through --stage-*-h. */
export const STAGE_REALITY_HEIGHT_PX = 300;
export const STAGE_RIBBON_HEIGHT_PX = 48;
export const STAGE_PROOF_HEIGHT_PX = 330;

/** Vehicle box, used to keep props clear of the bodywork. */
export const VEHICLE_WIDTH_PX = 86;
export const VEHICLE_BODY_HEIGHT_PX = 34;
export const VEHICLE_ROOF_HEIGHT_PX = 19;
/** Nominal canvas width used only to convert pixel widths into position units. */
export const NOMINAL_CANVAS_WIDTH_PX = 1_050;

/** Where the vehicle halts for the red signal (canonical position units). */
/**
 * Where the taxi comes to rest at the signalised intersection.
 *
 * This must equal the canonical position at the moment the presentation hold
 * BEGINS, or the vehicle has to travel backwards to reach it. D-006G P1 moved
 * that moment from 26_500 to `taxi-at-rest` at 28_000 — the stop is now the
 * end of the taxi's own braking action rather than the instant the light
 * turned red — and this constant was left behind at the old position. The
 * taxi was consequently 0.011 PAST its own stop line when braking began, so
 * the easing curve reversed it, the direction sampler read that reversal as a
 * change of heading, and `scaleX(-1)` mirrored the whole vehicle: the rear
 * lights appeared at the front for ~0.9 s of every intersection sequence.
 */
export const SIGNAL_STOP_POSITION = INTERACTION_ANCHORS.SIGNAL_STOP_ANCHOR;
/** How far beyond the stop line the signal head stands. */
export const TRAFFIC_LIGHT_LEAD = 0.092;
/** Where the vehicle comes to rest during the hazard beat. */
export const HAZARD_STOP_POSITION = 0.58;
/** Where the road obstacle sits — always ahead of the hazard stop. */
export const OBSTACLE_POSITION = 0.69;

/**
 * A building the vehicle parks *at* must stand beside it, not underneath it.
 * The offset is the vehicle's half-width plus the building's half-width plus a
 * small visible gap, so the taxi comes to rest at the door.
 */
export function besideVehicle(anchor: number, buildingHalfWidthPx: number): number {
  return anchor + VEHICLE_HALF_POSITION + pixelsToPosition(buildingHalfWidthPx) + 0.012;
}

/** Canonical position -> percent of the reality canvas width. */
export function stageX(position: number): number {
  return STAGE_X_PAD_PCT + clamp01(position) * STAGE_X_SPAN_PCT;
}

/** Pixel width -> canonical position units, for clearance arithmetic. */
export function pixelsToPosition(pixels: number): number {
  return (pixels / NOMINAL_CANVAS_WIDTH_PX) * 100 / STAGE_X_SPAN_PCT;
}

export const VEHICLE_HALF_POSITION = pixelsToPosition(VEHICLE_WIDTH_PX / 2);

export type StagePropId =
  | "customer"
  | "trafficLight"
  | "cityInfrastructure"
  | "crossTraffic"
  | "obstacle"
  | "garage"
  | "base"
  | "authority"
  | "routingProvider"
  | "networkSentinel"
  // D-006G: the bank is its own trust domain and must occupy its own place
  // on stage. Sharing the "authority" prop is what let four domains read as
  // one box labelled FLEET AUTHORITY.
  | "bank";

export type StageProp = Readonly<{
  id: StagePropId;
  /** Canonical position units (0..1) — the same axis the vehicle drives on. */
  position: number;
  /** CSS bottom inside the reality canvas, in pixels. */
  bottomPx: number;
  /** Height of the prop above its bottom edge, in pixels. */
  heightPx: number;
  /** Half-width of the prop, in pixels, used for clearance assertions. */
  halfWidthPx: number;
}>;

export const STAGE_PROPS: Readonly<Record<StagePropId, StageProp>> = Object.freeze({
  customer: prop("customer", INTERACTION_ANCHORS.PASSENGER_PICKUP_ANCHOR, 87, 26, 18),
  trafficLight: prop("trafficLight", SIGNAL_STOP_POSITION + TRAFFIC_LIGHT_LEAD, 114, 30, 19),
  cityInfrastructure: prop("cityInfrastructure", 0.97, 155, 32, 34),
  crossTraffic: prop("crossTraffic", SIGNAL_STOP_POSITION + 0.035, 148, 24, 18),
  obstacle: prop("obstacle", OBSTACLE_POSITION, 81, 24, 15),
  garage: prop("garage", besideVehicle(INTERACTION_ANCHORS.GARAGE_SERVICE_ANCHOR, 65), 115, 39, 65),
  base: prop("base", besideVehicle(INTERACTION_ANCHORS.BASE_PARKING_ANCHOR, 43), 115, 27, 43),
  authority: prop("authority", 0.97, 205, 20, 46),
  routingProvider: prop("routingProvider", 0.97, 124, 20, 48),
  networkSentinel: prop("networkSentinel", 0.97, 86, 20, 42),
  bank: prop("bank", 0.97, 252, 20, 40),
});

export type ReceiptEmissionSource = StagePropId | "vehicle" | "exactProducer";

/**
 * Canonical producer identity -> visible stage actor. Unknown producers have
 * no origin; callers must fail closed instead of silently attributing their
 * receipt to Taxi 07.
 */
const RECEIPT_EMISSION_SOURCE_BY_PRODUCER: Readonly<Record<string, ReceiptEmissionSource>> = Object.freeze({
  "Passenger service": "exactProducer",
  "Taxi autonomy": "vehicle",
  "Traffic Provider": "exactProducer",
  "Navigation Provider A": "routingProvider",
  "Navigation Provider B": "routingProvider",
  "Fleet operations": "exactProducer",
  Garage: "garage",
  "Maintenance system": "exactProducer",
  "Human approver": "exactProducer",
  "Authority governance": "exactProducer",
  "Payment policy": "exactProducer",
  "Payment Provider": "exactProducer",
  "Manager workflow": "exactProducer",
  "FortiX causal compiler": "exactProducer",
  SMART_CITY_INFRASTRUCTURE: "cityInfrastructure",
  AUTONOMOUS_VEHICLE: "vehicle",
  ROUTING_ORCHESTRATOR: "routingProvider",
  PAYMENT_PROVIDER: "exactProducer",
  FINANCIAL_INSTITUTION: "bank",
  NETWORK: "networkSentinel",
  "fortix.demo.manager-authority.d005m": "exactProducer",
  "fortix.demo.causal-compiler.d005m": "exactProducer",
});

const EXACT_PRODUCERS = Object.freeze(Object.entries(RECEIPT_EMISSION_SOURCE_BY_PRODUCER)
  .filter(([, source]) => source === "exactProducer")
  .map(([producer]) => producer)
  .sort());

export type ExactProducerStageSlot = Readonly<{
  position: number;
  bottomPx: number;
  heightPx: number;
}>;

/** Stable, producer-specific geometry; simultaneous actors never share an origin. */
export function exactProducerStageSlot(producerDomain: string): ExactProducerStageSlot | null {
  const index = EXACT_PRODUCERS.indexOf(producerDomain);
  if (index < 0) return null;
  return Object.freeze({
    position: 0.53 + (index % 4) * 0.14,
    bottomPx: 266 - Math.floor(index / 4) * 28,
    heightPx: 18,
  });
}

export function exactProducerEmissionPoint(producerDomain: string): Readonly<{ x: number; y: number }> | null {
  const slot = exactProducerStageSlot(producerDomain);
  return slot === null
    ? null
    : { x: stageX(slot.position), y: emissionY(slot.bottomPx, slot.heightPx) };
}

export function receiptEmissionSourceForProducer(producerDomain: string): ReceiptEmissionSource | null {
  return RECEIPT_EMISSION_SOURCE_BY_PRODUCER[producerDomain] ?? null;
}

/** Percent of the reality canvas height, measured from its top edge. */
export function emissionY(bottomPx: number, heightPx: number): number {
  return ((STAGE_REALITY_HEIGHT_PX - bottomPx - heightPx) / STAGE_REALITY_HEIGHT_PX) * 100;
}

export function propEmissionPoint(id: StagePropId): Readonly<{ x: number; y: number }> {
  const target = STAGE_PROPS[id];
  return { x: stageX(target.position), y: emissionY(target.bottomPx, target.heightPx) };
}

/** Emission point of the vehicle itself, from its live canonical position. */
export function vehicleEmissionPoint(position: number): Readonly<{ x: number; y: number }> {
  return {
    x: stageX(position),
    y: emissionY(84, VEHICLE_BODY_HEIGHT_PX + VEHICLE_ROOF_HEIGHT_PX),
  };
}

/** Left edge of a prop in canonical position units. */
export function propLeftEdge(id: StagePropId): number {
  return STAGE_PROPS[id].position - pixelsToPosition(STAGE_PROPS[id].halfWidthPx);
}

/** Front bumper of the vehicle when its centre sits at `position`. */
export function vehicleNose(position: number): number {
  return position + VEHICLE_HALF_POSITION;
}

function prop(
  id: StagePropId,
  position: number,
  bottomPx: number,
  heightPx: number,
  halfWidthPx: number,
): StageProp {
  return Object.freeze({ id, position, bottomPx, heightPx, halfWidthPx });
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

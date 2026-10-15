import assert from "node:assert/strict";
import test from "node:test";

import { derivePhysicalState, INTERACTION_ANCHORS } from "../app/physicalState.ts";
import { visualEventTime } from "../app/visualEvents.ts";
import {
  HAZARD_STOP_POSITION,
  OBSTACLE_POSITION,
  SIGNAL_STOP_POSITION,
  STAGE_PROOF_HEIGHT_PX,
  STAGE_PROPS,
  STAGE_REALITY_HEIGHT_PX,
  STAGE_X_PAD_PCT,
  STAGE_X_SPAN_PCT,
  besideVehicle,
  emissionY,
  exactProducerEmissionPoint,
  exactProducerStageSlot,
  propEmissionPoint,
  propLeftEdge,
  stageX,
  vehicleEmissionPoint,
  vehicleNose,
  type StagePropId,
} from "../app/stageGeometry.ts";

const PROP_IDS: readonly StagePropId[] = [
  "customer",
  "trafficLight",
  "cityInfrastructure",
  "crossTraffic",
  "obstacle",
  "garage",
  "base",
  "authority",
  "routingProvider",
  "networkSentinel",
  "bank",
];

test("D-006A: stageX is the only horizontal mapping and stays inside the canvas", () => {
  assert.equal(stageX(0), STAGE_X_PAD_PCT);
  assert.equal(stageX(1), STAGE_X_PAD_PCT + STAGE_X_SPAN_PCT);
  let previous = -Infinity;
  for (let position = 0; position <= 1.0001; position += 0.01) {
    const x = stageX(position);
    assert.ok(x >= previous, `stageX must not decrease at ${position}`);
    assert.ok(x >= 0 && x <= 100, `stageX(${position}) = ${x} escaped the canvas`);
    previous = x;
  }
});

test("D-006A: every prop stands on the anchor the vehicle actually drives to", () => {
  // A person stands exactly on the spot. A building stands beside it, by a
  // clearance derived from the same geometry — never by an independent number.
  assert.equal(STAGE_PROPS.customer.position, INTERACTION_ANCHORS.PASSENGER_PICKUP_ANCHOR);
  assert.equal(STAGE_PROPS.garage.position, besideVehicle(INTERACTION_ANCHORS.GARAGE_SERVICE_ANCHOR, 65));
  assert.equal(STAGE_PROPS.base.position, besideVehicle(INTERACTION_ANCHORS.BASE_PARKING_ANCHOR, 43));

  // The passenger is where the taxi stops to board, not 17 points away from it.
  assert.equal(derivePhysicalState(17_000).visualPosition, STAGE_PROPS.customer.position);
  // The garage is where the taxi is serviced — it stops at the door.
  assert.equal(derivePhysicalState(74_000).visualPosition, INTERACTION_ANCHORS.GARAGE_SERVICE_ANCHOR);
  // The base is where the taxi parks, not at the opposite end of the screen.
  assert.equal(derivePhysicalState(112_000).visualPosition, INTERACTION_ANCHORS.BASE_PARKING_ANCHOR);
});

test("D-006A: the vehicle stops short of the signal it is stopping for", () => {
  // The hold is a presentation beat, so the assertion is geometric: the stop
  // position must be reachable without a jump, and the signal head must stand
  // just beyond the bumper at that position.
  //
  // D-006G P1 moved the moment the hold begins. The stop is no longer keyed
  // to the instant the light turned red — the light does not stop the car —
  // but to `taxi-at-rest`, the end of the vehicle's own braking action. The
  // invariant is unchanged and is what actually matters: the hold must begin
  // exactly where the canonical vehicle already is. It was pinned to 26_500
  // while the hold had moved to 28_000, which left the taxi 0.011 PAST its
  // own stop line when braking began, so the easing curve reversed it and the
  // whole vehicle briefly mirrored.
  // Compared within a tolerance, not by float equality: the canonical path
  // computes this position by interpolation and yields 0.35600000000000004.
  // The old exact comparison held only because the previous constant happened
  // to land on an exactly representable value. A tenth of a thousandth of the
  // stage is ~0.14 px on a 1400 px canvas — far tighter than anything the
  // assertion is protecting against, which is a VISIBLE jump into the hold.
  const holdBegins = derivePhysicalState(visualEventTime("taxi-at-rest")).visualPosition;
  assert.ok(
    Math.abs(holdBegins - SIGNAL_STOP_POSITION) <= 1e-4,
    `the presentation hold must begin exactly where the canonical vehicle already is `
    + `(canonical ${holdBegins}, stop ${SIGNAL_STOP_POSITION})`,
  );
  const nose = vehicleNose(SIGNAL_STOP_POSITION);
  const lightEdge = propLeftEdge("trafficLight");
  assert.ok(
    lightEdge > nose,
    `the signal head (${lightEdge.toFixed(4)}) must stand ahead of the bumper (${nose.toFixed(4)})`,
  );
  // ...and close enough that the pair reads as one event.
  assert.ok(lightEdge - nose < 0.06, "the signal must not be a screen away from the stop line");
});

test("D-006A: the obstacle is ahead of the hazard stop, never behind it", () => {
  const nose = vehicleNose(HAZARD_STOP_POSITION);
  const obstacleEdge = propLeftEdge("obstacle");
  assert.ok(OBSTACLE_POSITION > HAZARD_STOP_POSITION, "the hazard must be in front of the vehicle");
  assert.ok(
    obstacleEdge > nose,
    `the obstacle (${obstacleEdge.toFixed(4)}) must not overlap the bumper (${nose.toFixed(4)})`,
  );
  assert.ok(obstacleEdge - nose < 0.05, "the obstacle must stay in frame with the braking vehicle");
});

test("D-006A: a building the vehicle parks at stands beside it, not on it", () => {
  for (const [id, anchor] of [
    ["garage", INTERACTION_ANCHORS.GARAGE_SERVICE_ANCHOR],
    ["base", INTERACTION_ANCHORS.BASE_PARKING_ANCHOR],
  ] as const) {
    const edge = propLeftEdge(id);
    const nose = vehicleNose(anchor);
    assert.ok(edge > nose, `the ${id} overlaps the parked vehicle (${edge.toFixed(4)} <= ${nose.toFixed(4)})`);
    assert.ok(edge - nose < 0.05, `the ${id} drifted out of frame with the parked vehicle`);
  }
});

test("D-006A: every prop stays inside the drawable road", () => {
  for (const id of PROP_IDS) {
    assert.ok(stageX(STAGE_PROPS[id].position) <= 100, `${id} is off the right edge`);
    assert.ok(STAGE_PROPS[id].position <= 1, `${id} would be clamped by stageX`);
  }
});

test("D-006A: every emission point sits inside the reality canvas", () => {
  for (const id of PROP_IDS) {
    const point = propEmissionPoint(id);
    assert.ok(point.x >= 0 && point.x <= 100, `${id} emits off the horizontal canvas`);
    assert.ok(point.y >= 0 && point.y <= 100, `${id} emits off the vertical canvas`);
  }
  const vehicle = vehicleEmissionPoint(0.5);
  assert.ok(vehicle.y > 0 && vehicle.y < 100);
  assert.equal(vehicle.x, stageX(0.5), "the vehicle emits from where the vehicle is");
});

test("D-006A: emission points differ per actor, so origin identifies the emitter", () => {
  const points = PROP_IDS.map((id) => `${propEmissionPoint(id).x.toFixed(2)}:${propEmissionPoint(id).y.toFixed(2)}`);
  assert.equal(new Set(points).size, points.length, "two actors must not share one emission point");
});

test("D-006 C1: simultaneous exact producers retain distinct actor and receipt origins", () => {
  const producers = ["Manager workflow", "Payment policy", "Payment Provider", "FortiX causal compiler"];
  const points = producers.map((producer) => {
    const slot = exactProducerStageSlot(producer);
    const point = exactProducerEmissionPoint(producer);
    assert.ok(slot && point, `${producer} must have stable exact-producer geometry`);
    return `${point.x.toFixed(3)}:${point.y.toFixed(3)}`;
  });
  assert.equal(new Set(points).size, producers.length,
    "overlapping receipt windows must not launch from another producer's label");
  assert.equal(exactProducerEmissionPoint("UNMAPPED PRODUCER"), null);
});

test("D-006A: emissionY is measured from the top of a fixed-height canvas", () => {
  assert.equal(emissionY(0, 0), 100);
  assert.equal(emissionY(STAGE_REALITY_HEIGHT_PX, 0), 0);
  assert.ok(STAGE_REALITY_HEIGHT_PX > 0 && STAGE_PROOF_HEIGHT_PX > 0);
});

test("D-006A: the vehicle never reverses on the outbound mission", () => {
  let previous = derivePhysicalState(0).visualPosition;
  for (let time = 250; time <= 104_000; time += 250) {
    const position = derivePhysicalState(time).visualPosition;
    assert.ok(
      position >= previous - 1e-9,
      `the taxi moved backwards at ${time}ms (${previous} -> ${position})`,
    );
    previous = position;
  }
});

test("D-006A: the return leg is a single uninterrupted run back to base", () => {
  let previous = derivePhysicalState(104_000).visualPosition;
  for (let time = 104_250; time <= 112_000; time += 250) {
    const position = derivePhysicalState(time).visualPosition;
    assert.ok(
      position <= previous + 1e-9,
      `the taxi drove away from base at ${time}ms (${previous} -> ${position})`,
    );
    previous = position;
  }
  assert.equal(derivePhysicalState(112_000).visualPosition, INTERACTION_ANCHORS.BASE_PARKING_ANCHOR);
});

test("D-006A: stage geometry is a pure projection with no wall clock or randomness", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("../app/stageGeometry.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /Date\.now|new Date|performance\.now|Math\.random|setTimeout|setInterval|requestAnimationFrame/);
});

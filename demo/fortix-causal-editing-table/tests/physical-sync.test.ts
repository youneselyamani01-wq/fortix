import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { deriveMasterStoryState } from "../app/masterStory.ts";
import { ANCHOR_ALIGNMENT_TOLERANCE, INTERACTION_ANCHORS, derivePhysicalState } from "../app/physicalState.ts";
import { storyBeatTime } from "../app/storyTimeline.ts";

test("acceptance is followed by visible base departure and a pre-pickup signal stop", () => {
  assert.equal(derivePhysicalState(5_000).departedBase, false);
  assert.equal(derivePhysicalState(5_000).visualPosition, INTERACTION_ANCHORS.BASE_PARKING_ANCHOR);
  assert.equal(derivePhysicalState(6_000).departedBase, true);
  assert.ok(derivePhysicalState(9_000).visualPosition > INTERACTION_ANCHORS.BASE_PARKING_ANCHOR);
  assert.equal(derivePhysicalState(13_000).signalStopActive, true);
  assert.equal(derivePhysicalState(13_000).visualPosition, INTERACTION_ANCHORS.SIGNAL_STOP_ANCHOR);
  assert.equal(derivePhysicalState(13_000).passengerState, "WAITING");
  assert.equal(derivePhysicalState(15_500).signalStopActive, false);
  assert.ok(derivePhysicalState(16_000).visualPosition > INTERACTION_ANCHORS.SIGNAL_STOP_ANCHOR);
});

test("pickup motion, boarding stop, and passenger occupancy are physically ordered", () => {
  assert.ok(derivePhysicalState(12_000).speedKph > 0);
  assert.equal(derivePhysicalState(16_999).vehicleState, "ARRIVING");
  assert.equal(derivePhysicalState(17_000).vehicleState, "BOARDING");
  assert.equal(derivePhysicalState(17_000).visualPosition, INTERACTION_ANCHORS.PASSENGER_PICKUP_ANCHOR);
  assert.equal(derivePhysicalState(17_000).alignedAnchor, "PASSENGER_PICKUP_ANCHOR");
  assert.equal(derivePhysicalState(17_500).speedKph, 0);
  assert.equal(derivePhysicalState(17_999).passengerState, "BOARDING");
  assert.equal(derivePhysicalState(18_000).passengerState, "ONBOARD");
  assert.equal(derivePhysicalState(19_999).speedKph, 0);
  assert.ok(derivePhysicalState(20_000).speedKph > 0);
});

test("drop-off completes before passenger closure and the new garage mission", () => {
  const arrival = derivePhysicalState(32_999);
  const dropoff = derivePhysicalState(33_500);
  const confirmed = derivePhysicalState(34_000);
  assert.ok(arrival.speedKph >= 0);
  assert.equal(dropoff.vehicleState, "DROPOFF");
  assert.equal(dropoff.visualPosition, INTERACTION_ANCHORS.PASSENGER_DROPOFF_ANCHOR);
  assert.equal(dropoff.alignedAnchor, "PASSENGER_DROPOFF_ANCHOR");
  assert.equal(dropoff.speedKph, 0);
  assert.equal(dropoff.passengerState, "DROPPING_OFF");
  assert.equal(confirmed.passengerState, "NOT_ONBOARD");
  assert.equal(derivePhysicalState(35_999).passengerMissionClosed, false);
  assert.equal(derivePhysicalState(36_000).passengerMissionClosed, true);
  assert.equal(derivePhysicalState(37_999).garageMissionActive, false);
  assert.equal(derivePhysicalState(38_000).garageMissionActive, true);
  assert.equal(deriveMasterStoryState(38_000).moment.id, "garage-mission-begins");
});

test("garage travel follows congestion and reroute choreography", () => {
  assert.equal(derivePhysicalState(44_000).speedKph, 36);
  assert.equal(derivePhysicalState(48_000).speedKph, 12);
  assert.equal(derivePhysicalState(50_500).speedKph, 0);
  assert.equal(derivePhysicalState(53_999).visualPosition, derivePhysicalState(50_500).visualPosition);
  assert.equal(derivePhysicalState(54_000).visualPosition, derivePhysicalState(50_500).visualPosition);
  assert.equal(derivePhysicalState(56_000).speedKph, 34);
  assert.ok(derivePhysicalState(61_000).speedKph < derivePhysicalState(60_000).speedKph);
  assert.equal(derivePhysicalState(62_000).speedKph, 0);
  assert.equal(derivePhysicalState(62_000).vehicleState, "GARAGE_STOPPED");
});

test("the taxi is immobile for every canonical garage service and payment boundary", () => {
  const stationaryTimes = [62_000, 66_000, 68_000, 70_000, 72_000, 74_000, 76_000, 78_000, 82_000, 84_000, 84_250, 85_000, 85_250, 85_500, 86_000, 88_000, 90_000, 92_000, 96_000, 98_000, 103_999];
  const positions = new Set<number>();
  for (const time of stationaryTimes) {
    const state = derivePhysicalState(time);
    assert.equal(state.speedKph, 0, `expected zero speed at ${time}`);
    positions.add(state.visualPosition);
  }
  assert.deepEqual([...positions], [INTERACTION_ANCHORS.GARAGE_SERVICE_ANCHOR]);
  assert.equal(derivePhysicalState(74_000).vehicleState, "MAINTENANCE");
  assert.equal(derivePhysicalState(74_000).maintenanceActionProgress, 0);
  assert.equal(derivePhysicalState(76_000).maintenanceActionProgress, 0.5);
  assert.equal(derivePhysicalState(77_999).maintenanceInProgress, true);
  assert.equal(derivePhysicalState(78_000).maintenanceCompleted, true);
  assert.equal(derivePhysicalState(78_000).maintenanceActionProgress, 1);
  assert.equal(derivePhysicalState(84_250).vehicleState, "WAITING_FOR_AUTHORITY");
});

test("garage departure requires recorded bank authorization, return intent, and calculated route", () => {
  assert.equal(derivePhysicalState(87_499).bankAuthorizationRecorded, false);
  assert.equal(derivePhysicalState(87_500).bankAuthorizationRecorded, true);
  assert.equal(derivePhysicalState(92_000).vehicleState, "GARAGE_STOPPED");
  assert.equal(derivePhysicalState(95_999).returnIntentActive, false);
  assert.equal(derivePhysicalState(96_000).returnIntentActive, true);
  assert.equal(derivePhysicalState(97_999).returnRouteCalculated, false);
  assert.equal(derivePhysicalState(98_000).canDepartGarage, true);
  assert.equal(deriveMasterStoryState(96_000).moment.id, "return-to-base-intent");
  assert.equal(deriveMasterStoryState(98_000).moment.id, "return-route-calculated");
  assert.equal(derivePhysicalState(103_999).speedKph, 0);
  assert.equal(derivePhysicalState(104_000).vehicleState, "RETURNING_TO_BASE");
  assert.equal(derivePhysicalState(104_000).speedKph, 0);
  assert.ok(derivePhysicalState(104_250).speedKph > 0);
});

test("D-006 C1: physical mission progression is gated by evidenced route execution", () => {
  const blocked = derivePhysicalState(120_000, false);
  const evidenced = derivePhysicalState(120_000, true);
  assert.equal(blocked.visualPosition, derivePhysicalState(storyBeatTime("physical-reroute") - 1).visualPosition);
  assert.equal(blocked.parked, false);
  assert.equal(blocked.finalRequiredLeafMature, false);
  assert.equal(evidenced.parked, true);
  assert.equal(evidenced.finalRequiredLeafMature, true);
});

test("parking precedes cycle closure", () => {
  assert.ok(derivePhysicalState(111_000).speedKph > 0);
  assert.equal(derivePhysicalState(112_000).vehicleState, "PARKED");
  assert.equal(derivePhysicalState(112_000).speedKph, 0);
  assert.equal(derivePhysicalState(112_000).visualPosition, INTERACTION_ANCHORS.BASE_PARKING_ANCHOR);
  assert.equal(derivePhysicalState(112_000).alignedAnchor, "BASE_PARKING_ANCHOR");
  assert.equal(derivePhysicalState(119_999).cycleCanClose, false);
  assert.equal(derivePhysicalState(120_000).cycleCanClose, true);
  assert.equal(deriveMasterStoryState(120_000).cycleReceiptAvailable, true);
});

test("each interaction reaches its exact deterministic spatial anchor", () => {
  const checks = [
    [17_000, "PASSENGER_PICKUP_ANCHOR"],
    [33_000, "PASSENGER_DROPOFF_ANCHOR"],
    [62_000, "GARAGE_SERVICE_ANCHOR"],
    [84_250, "GARAGE_SERVICE_ANCHOR"],
    [103_999, "GARAGE_SERVICE_ANCHOR"],
    [112_000, "BASE_PARKING_ANCHOR"],
  ] as const;
  for (const [time, anchor] of checks) {
    const state = derivePhysicalState(time);
    assert.ok(Math.abs(state.visualPosition - INTERACTION_ANCHORS[anchor]) <= ANCHOR_ALIGNMENT_TOLERANCE);
    assert.equal(state.alignedAnchor, anchor);
    assert.equal(state.speedKph, 0);
  }
});

test("cross-layer canonical moments never contradict physical state", () => {
  for (const time of [17_000, 18_000, 33_000, 34_000, 38_000, 62_000, 68_000, 74_000, 78_000, 82_000, 84_250, 85_000, 85_250, 86_000, 88_000, 92_000, 96_000, 98_000, 104_000, 112_000, 120_000]) {
    const story = deriveMasterStoryState(time);
    const physical = derivePhysicalState(time);
    if (["GARAGE_ARRIVAL", "DIAGNOSIS", "MAINTENANCE", "INVOICE", "HUMAN_AUTHORITY", "PAYMENT", "MANAGER"].includes(story.scene)) {
      assert.equal(physical.speedKph, 0, `garage scene moved at ${time}`);
    }
    assert.equal(story.passengerAboard, physical.passengerState === "ONBOARD" || physical.passengerState === "DROPPING_OFF");
  }
});

test("physical state has no wall clock, randomness, or independent animation source", () => {
  const source = readFileSync(new URL("../app/physicalState.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /Date\.now|new Date|performance\.now|Math\.random|setTimeout|setInterval|requestAnimationFrame/);
  assert.deepEqual(derivePhysicalState(74_500), derivePhysicalState(74_500));
  derivePhysicalState(120_000);
  assert.deepEqual(derivePhysicalState(74_500), derivePhysicalState(74_500));
});

test("SYSTEM exposes physical synchronization separately from historical evidence", () => {
  const component = readFileSync(new URL("../app/OperationalCycleTable.tsx", import.meta.url), "utf8");
  assert.match(component, /className="system-physical-sync"/);
  assert.match(component, /t\.d005g\.physicalSync/);
  assert.match(component, /physical\.speedKph\.toFixed\(1\)/);
});

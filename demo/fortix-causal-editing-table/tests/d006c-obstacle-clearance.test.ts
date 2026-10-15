import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { deriveMasterStoryState } from "../app/masterStory.ts";
import { derivePhysicalState } from "../app/physicalState.ts";
import { deriveRoutingState } from "../app/routingProvenance.ts";
import { evidenceGatedStoryTime, storyBeatTime } from "../app/storyTimeline.ts";
import {
  AVOIDANCE_END_MS,
  AVOIDANCE_LANE_CHANGE_MS,
  AVOIDANCE_LANE_SHIFT_PX,
  AVOIDANCE_MERGE_START_MS,
  AVOIDANCE_PASS_START_MS,
  AVOIDANCE_START_MS,
  derivePresentationMotion,
  minimumObstacleClearance,
  obstacleClearanceAt,
} from "../app/vehiclePresentation.ts";
import { VISUAL_EVENTS, visualEventTime } from "../app/visualEvents.ts";

const component = readFileSync(new URL("../app/ConvergenceExperience.tsx", import.meta.url), "utf8");

test("D-006C: obstacle correction preserves every authored causal timestamp", () => {
  assert.ok(visualEventTime("obstacle") < AVOIDANCE_START_MS, "congestion must be visible before braking");
  assert.equal(AVOIDANCE_START_MS, visualEventTime("brake"));
  assert.ok(visualEventTime("reroute") < AVOIDANCE_LANE_CHANGE_MS,
    "reroute authority must precede physical lane change");
  assert.equal(AVOIDANCE_LANE_CHANGE_MS, storyBeatTime("physical-reroute"));
  assert.equal(AVOIDANCE_PASS_START_MS, storyBeatTime("routing-lane-change-complete"));
  assert.equal(AVOIDANCE_MERGE_START_MS, storyBeatTime("routing-merge-start"));
  assert.equal(AVOIDANCE_END_MS, storyBeatTime("garage-arrival"));
});

test("D-006C: the complete rendered taxi footprint clears the obstacle", () => {
  const footprint = obstacleClearanceAt(AVOIDANCE_START_MS, 1_050);
  assert.equal(footprint.taxi.right - footprint.taxi.left, 86, "include the complete taxi width");
  assert.equal(footprint.taxi.bottom - footprint.taxi.top, 59, "include roof, body, and wheel drop");
  assert.equal(footprint.obstacle.right - footprint.obstacle.left, 30);
  assert.equal(footprint.obstacle.bottom - footprint.obstacle.top, 24);

  for (const width of [696, 728, 1_050, 1_278]) {
    const minimum = minimumObstacleClearance(width, 1);
    assert.equal(minimum.intersects, false, `footprints intersect at ${width}px / ${minimum.masterTime}ms`);
    assert.ok(minimum.separationPx > 0,
      `expected positive measured separation at ${width}px / ${minimum.masterTime}ms`);
  }
});

test("D-006C: the taxi completes stop, lane change, pass, and merge without reversing", () => {
  assert.equal(Math.abs(derivePresentationMotion(AVOIDANCE_LANE_CHANGE_MS).lanePx), 0);
  assert.equal(derivePresentationMotion(AVOIDANCE_PASS_START_MS).lanePx, AVOIDANCE_LANE_SHIFT_PX);
  assert.equal(derivePresentationMotion(AVOIDANCE_MERGE_START_MS).lanePx, AVOIDANCE_LANE_SHIFT_PX);
  assert.equal(derivePresentationMotion(AVOIDANCE_END_MS).lanePx, 0);

  let previous = derivePresentationMotion(AVOIDANCE_START_MS).position;
  for (let time = AVOIDANCE_START_MS + 1; time <= AVOIDANCE_END_MS; time += 1) {
    const current = derivePresentationMotion(time).position;
    assert.ok(current >= previous - 1e-10,
      `presentation reversed at ${time}ms (${previous} -> ${current})`);
    previous = current;
  }
});

test("D-006C: lane return begins only after longitudinal footprint clearance", () => {
  const reviewCanvasWidth = 696;
  let previousLane = derivePresentationMotion(AVOIDANCE_MERGE_START_MS).lanePx;
  for (let time = AVOIDANCE_MERGE_START_MS + 1; time <= AVOIDANCE_END_MS; time += 1) {
    const motion = derivePresentationMotion(time);
    if (motion.lanePx > previousLane + 1e-9) {
      assert.ok(obstacleClearanceAt(time, reviewCanvasWidth).horizontalGapPx > 0,
        `taxi began returning before its full length cleared at ${time}ms`);
      break;
    }
    previousLane = motion.lanePx;
  }
});

test("D-006 C1: congestion remains visible while the taxi visibly clears it", () => {
  assert.match(component, /storyTime < storyBeatTime\("routing-merge-start"\)/,
    "the obstacle cannot disappear at lane-change start before the physical pass is visible");
  assert.doesNotMatch(component, /congestionVisible[\s\S]{0,140}storyTime < storyBeatTime\("physical-reroute"\)/);
});

test("D-006 C1: routing authorization without its evidenced resulting route cannot move the taxi", () => {
  const denied = derivePresentationMotion(AVOIDANCE_LANE_CHANGE_MS + 2_000, false);
  const evidenced = derivePresentationMotion(AVOIDANCE_LANE_CHANGE_MS + 2_000, true);
  assert.equal(denied.phase, "WAITING_FOR_ROUTE");
  assert.equal(denied.position, derivePresentationMotion(AVOIDANCE_LANE_CHANGE_MS, false).position);
  assert.equal(denied.lanePx, 0);
  assert.notEqual(evidenced.phase, "WAITING_FOR_ROUTE");
  assert.ok(evidenced.lanePx < 0 || evidenced.position > denied.position);
});

test("D-006 C1: absent or invalid route evidence holds every story scene before execution", () => {
  const refusals: readonly Readonly<{
    label: string;
    masterTime: number;
    recordPresent: boolean;
    valid: boolean;
  }>[] = [
    { label: "absent evidence after the merge boundary", masterTime: 60_001, recordPresent: false, valid: true },
    { label: "invalid evidence at mission close", masterTime: 120_000, recordPresent: true, valid: false },
  ];

  for (const refusal of refusals) {
    const routingEvidenceAdmissible = refusal.recordPresent && refusal.valid;
    const routing = deriveRoutingState(routingEvidenceAdmissible ? refusal.masterTime : 0);
    const routingExecutionAuthorized = routingEvidenceAdmissible && routing.vehicleMayExecute;
    const storyTime = evidenceGatedStoryTime(refusal.masterTime, routingEvidenceAdmissible);
    const story = deriveMasterStoryState(storyTime);
    const currentEvent = VISUAL_EVENTS.filter((event) => event.timeMs <= storyTime).at(-1);
    const physical = derivePhysicalState(refusal.masterTime, routingExecutionAuthorized);
    const presentation = derivePresentationMotion(refusal.masterTime, routingExecutionAuthorized);

    assert.equal(storyTime, AVOIDANCE_LANE_CHANGE_MS - 1, refusal.label);
    assert.equal(routing.phase, "NOT_TRIGGERED", `${refusal.label}: unsupported routing details must stay hidden`);
    assert.equal(story.moment.id, "reroute-authorized", `${refusal.label}: story advanced beyond its supported moment`);
    assert.equal(currentEvent?.id, "reroute", `${refusal.label}: caption advanced beyond its supported event`);
    assert.equal(presentation.phase, "WAITING_FOR_ROUTE", refusal.label);
    assert.equal(physical.atGarage, false, `${refusal.label}: garage scene mounted without route evidence`);
    assert.equal(physical.returnIntentActive, false, `${refusal.label}: return scene mounted without route evidence`);
    assert.equal(physical.parked, false, `${refusal.label}: base completion mounted without route evidence`);
    assert.equal(storyTime >= storyBeatTime("congestion")
      && storyTime < storyBeatTime("routing-merge-start"), true,
    `${refusal.label}: the blocking obstacle must remain in the held scene`);
    assert.equal(storyTime < storyBeatTime("taxi-en-route-to-passenger")
      || storyTime >= storyBeatTime("return-journey"), false,
    `${refusal.label}: the return-to-base prop must not appear`);
  }

  assert.equal(evidenceGatedStoryTime(53_000, false), 53_000,
    "the clock must reach the route-evidence production point before it can be gated");
  assert.equal(evidenceGatedStoryTime(120_000, true), 120_000,
    "admissible route evidence must preserve canonical story time");
});

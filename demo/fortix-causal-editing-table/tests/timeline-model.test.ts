import assert from "node:assert/strict";
import test from "node:test";
import {
  FRAME_DURATION_MS,
  TIMELINE_DURATION_MS,
  TIMELINE_EVENTS,
  deriveTimelineState,
  formatMasterTime,
  frameStep,
} from "../app/timeline.ts";

test("placeholder events retain their exact declared timestamps", () => {
  assert.deepEqual(
    TIMELINE_EVENTS.map((event) => event.timeMs),
    [0, 2_400, 3_180, 3_240, 3_310, 3_420, 3_560, 3_710, 3_760, 3_810, 3_890, 4_120, 5_340, 5_420, 6_000],
  );
});

test("a nano-receipt appears at its event timestamp and not before", () => {
  const before = deriveTimelineState(3_179);
  const exact = deriveTimelineState(3_180);

  assert.equal(before.reachedEvents.some((event) => event.id === "candidate-detected"), false);
  assert.equal(exact.reachedEvents.some((event) => event.id === "candidate-detected"), true);
  assert.equal(exact.activeEvent?.id, "candidate-detected");
});

test("rewinding and returning to a time reconstructs the same state", () => {
  const firstPass = deriveTimelineState(3_810);
  const rewound = deriveTimelineState(0);
  const replayed = deriveTimelineState(3_810);

  assert.equal(rewound.timestamp, "00.000");
  assert.deepEqual(replayed, firstPass);
});

test("all three bands derive from one clamped master time", () => {
  const first = deriveTimelineState(4_120);
  const second = deriveTimelineState(4_120);

  assert.deepEqual(first, second);
  assert.equal(first.masterTime, 4_120);
  assert.equal(first.timestamp, "04.120");
  assert.equal(first.bands.reality, "Deceleration begins");
  assert.equal(first.bands.system, "Vehicle response observed");
  assert.equal(first.bands.proof, "Deceleration observed");
});

test("frame steps and endpoints are deterministic", () => {
  assert.equal(FRAME_DURATION_MS, 40);
  assert.equal(frameStep(0, -1), 0);
  assert.equal(frameStep(3_760, -1), 3_720);
  assert.equal(frameStep(3_760, 1), 3_800);
  assert.equal(frameStep(TIMELINE_DURATION_MS, 1), TIMELINE_DURATION_MS);
  assert.equal(formatMasterTime(Number.POSITIVE_INFINITY), "00.000");
});

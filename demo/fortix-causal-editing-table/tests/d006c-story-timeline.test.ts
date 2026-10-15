import assert from "node:assert/strict";
import test from "node:test";

import {
  CANONICAL_MISSION_DURATION_MS,
  EXPERIENCE_DURATION_MS,
  FINAL_LEAF_GROWTH_DURATION_MS,
  FINAL_RECEIPT_EMITTED_MS,
  FINAL_RECEIPT_LANDED_MS,
  FINAL_RECEIPT_ROOT_ATTACHED_MS,
  FINAL_REQUIRED_LEAF_MATURE_MS,
  HANDOFF_READY_MS,
  HANDOFF_STABLE_PAUSE_MS,
  PEB_ASSEMBLY_DURATION_MS,
  PEB_COMPLETE_MS,
  RECEIPT_TRAVEL_DURATION_MS,
  REQUIRED_RUNTIME_EVIDENCE_CUTOFF_EXCLUSIVE_MS,
  RETURN_RECEIPT_EMITTED_MS,
  REVIEW_WINDOW_DURATION_MS,
  STORY_BEAT_TIME_MS,
  clampExperienceTime,
  formatExperienceTime,
  missionClockPositionAt,
  storyBeatTime,
} from "../app/storyTimeline.ts";

test("D-006 C1 has one ordered experience clock and a clamped canonical mission clock", () => {
  const times = Object.values(STORY_BEAT_TIME_MS);
  for (let index = 1; index < times.length; index += 1) {
    assert.ok(times[index] >= times[index - 1], `story beat ${index} moved backwards`);
  }
  assert.equal(CANONICAL_MISSION_DURATION_MS, 120_000);
  assert.equal(EXPERIENCE_DURATION_MS, 126_000);
  assert.equal(formatExperienceTime(EXPERIENCE_DURATION_MS), "02:06.000");
  assert.equal(formatExperienceTime(EXPERIENCE_DURATION_MS + 1), "02:06.000");
  assert.equal(clampExperienceTime(999_999), EXPERIENCE_DURATION_MS);
  assert.equal(missionClockPositionAt(FINAL_RECEIPT_EMITTED_MS), 120_000);
  assert.equal(missionClockPositionAt(EXPERIENCE_DURATION_MS), 120_000);
});

test("acceptance, departure, Physical-AI signal chain, and pickup cannot collapse", () => {
  const ordered = [
    "mission-accepted",
    "taxi-departs-base",
    "signal-green",
    "city-detection",
    "signal-yellow",
    "taxi-observes-yellow",
    "taxi-decides-stop",
    "taxi-brake-applied",
    "signal-red",
    "taxi-at-rest",
    "city-phase-decision",
    "signal-green-2",
    "taxi-observes-green",
    "taxi-decides-proceed",
    "taxi-resumes",
    "intersection-cleared",
    "taxi-aligned-pickup",
    "passenger-pickup",
  ] as const;
  for (let index = 1; index < ordered.length; index += 1) {
    assert.ok(storyBeatTime(ordered[index]) > storyBeatTime(ordered[index - 1]),
      `${ordered[index - 1]} must precede ${ordered[index]}`);
  }
});

test("congestion precedes routing provenance and physical execution", () => {
  const ordered = [
    "congestion",
    "eta-at-risk",
    "routing-request",
    "routing-policy-evaluated",
    "routing-candidates-compared",
    "routing-candidate-selected",
    "provider-transition",
    "reroute-authorized",
    "resulting-route-calculated",
    "physical-reroute",
  ] as const;
  for (let index = 1; index < ordered.length; index += 1) {
    assert.ok(storyBeatTime(ordered[index]) > storyBeatTime(ordered[index - 1]));
  }
});

test("maintenance diagnosis, authority, visible work, and completion are distinct", () => {
  assert.ok(storyBeatTime("maintenance-begins") < storyBeatTime("diagnosis"));
  assert.ok(storyBeatTime("diagnosis") < storyBeatTime("maintenance-proposal"));
  assert.ok(storyBeatTime("maintenance-proposal") < storyBeatTime("maintenance-authorized"));
  assert.ok(storyBeatTime("maintenance-authorized") < storyBeatTime("work-in-progress"));
  assert.ok(storyBeatTime("work-in-progress") < storyBeatTime("work-complete"));
});

test("final proof timing is derived from named travel, growth, assembly, pause, and review durations", () => {
  assert.equal(FINAL_REQUIRED_LEAF_MATURE_MS, 116_000);
  assert.equal(FINAL_REQUIRED_LEAF_MATURE_MS,
    RETURN_RECEIPT_EMITTED_MS + RECEIPT_TRAVEL_DURATION_MS + FINAL_LEAF_GROWTH_DURATION_MS);
  assert.equal(FINAL_RECEIPT_EMITTED_MS, CANONICAL_MISSION_DURATION_MS);
  assert.equal(FINAL_RECEIPT_LANDED_MS, FINAL_RECEIPT_EMITTED_MS + RECEIPT_TRAVEL_DURATION_MS);
  assert.equal(FINAL_RECEIPT_ROOT_ATTACHED_MS, FINAL_RECEIPT_LANDED_MS + FINAL_LEAF_GROWTH_DURATION_MS);
  assert.equal(PEB_COMPLETE_MS, FINAL_RECEIPT_ROOT_ATTACHED_MS + PEB_ASSEMBLY_DURATION_MS);
  assert.equal(HANDOFF_READY_MS, PEB_COMPLETE_MS + HANDOFF_STABLE_PAUSE_MS);
  assert.equal(EXPERIENCE_DURATION_MS, HANDOFF_READY_MS + REVIEW_WINDOW_DURATION_MS);
  assert.equal(REQUIRED_RUNTIME_EVIDENCE_CUTOFF_EXCLUSIVE_MS, FINAL_RECEIPT_EMITTED_MS);
});

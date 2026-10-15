import assert from "node:assert/strict";
import test from "node:test";

import { STORY_BEAT_TIME_MS, storyBeatTime } from "../app/storyTimeline.ts";
import { VISUAL_EVENTS } from "../app/visualEvents.ts";

test("every visual event is a canonical mission event or an explicit consequence", () => {
  const canonicalIds = new Set(Object.keys(STORY_BEAT_TIME_MS));
  // NX0: 39 → 45. Six beats added so that every significant vehicle act has
  // a receipt flight of its own: departure, the hazard decision, the hazard
  // stop, the reroute execution, work-begins and the exceeded limit.
  assert.equal(VISUAL_EVENTS.length, 45);
  for (const event of VISUAL_EVENTS) {
    assert.ok(canonicalIds.has(event.sourceMomentId), `${event.id} has no canonical source`);
    assert.ok(
      event.relation === "CANONICAL_MISSION_EVENT" || event.relation === "VISUAL_CONSEQUENCE",
      `${event.id} has no declared relation`,
    );
    assert.equal(event.timeMs, storyBeatTime(event.sourceMomentId));
    assert.equal(event.offsetMs, 0);
  }
  assert.equal(VISUAL_EVENTS.find((event) => event.id === "obstacle")?.relation, "VISUAL_CONSEQUENCE");
  assert.equal(VISUAL_EVENTS.find((event) => event.id === "brake")?.relation, "VISUAL_CONSEQUENCE");
  assert.equal(VISUAL_EVENTS.find((event) => event.id === "route-start")?.relation, "CANONICAL_MISSION_EVENT");
});

test("visual events remain chronological after canonical projection", () => {
  for (let index = 1; index < VISUAL_EVENTS.length; index += 1) {
    assert.ok(VISUAL_EVENTS[index].timeMs >= VISUAL_EVENTS[index - 1].timeMs);
  }
});

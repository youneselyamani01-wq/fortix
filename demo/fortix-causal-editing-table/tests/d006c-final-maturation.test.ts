import assert from "node:assert/strict";
import test from "node:test";

import { deriveMasterStoryState } from "../app/masterStory.ts";
import { derivePhysicalState } from "../app/physicalState.ts";
import {
  CANONICAL_MISSION_DURATION_MS,
  EXPERIENCE_DURATION_MS,
  FINAL_RECEIPT_EMITTED_MS,
  FINAL_RECEIPT_LANDED_MS,
  FINAL_RECEIPT_ROOT_ATTACHED_MS,
  FINAL_REQUIRED_LEAF_MATURE_MS,
  HANDOFF_READY_MS,
  PEB_COMPLETE_MS,
} from "../app/storyTimeline.ts";

test("the required return leaf matures before the Final Receipt is emitted", () => {
  assert.equal(deriveMasterStoryState(FINAL_REQUIRED_LEAF_MATURE_MS - 1).finalRequiredLeafMature, false);
  assert.equal(deriveMasterStoryState(FINAL_REQUIRED_LEAF_MATURE_MS).finalRequiredLeafMature, true);
  assert.equal(deriveMasterStoryState(FINAL_RECEIPT_EMITTED_MS - 1).finalReceiptEmitted, false);
  assert.equal(deriveMasterStoryState(FINAL_RECEIPT_EMITTED_MS).finalReceiptEmitted, true);
  assert.ok(FINAL_REQUIRED_LEAF_MATURE_MS < FINAL_RECEIPT_EMITTED_MS);
});

test("landing, root attachment, PEB completion, and handoff are observable post-roll gates", () => {
  assert.equal(deriveMasterStoryState(FINAL_RECEIPT_LANDED_MS - 1).finalReceiptLanded, false);
  assert.equal(deriveMasterStoryState(FINAL_RECEIPT_LANDED_MS).finalReceiptLanded, true);
  assert.equal(deriveMasterStoryState(FINAL_RECEIPT_ROOT_ATTACHED_MS - 1).finalReceiptRootAttached, false);
  assert.equal(deriveMasterStoryState(FINAL_RECEIPT_ROOT_ATTACHED_MS).finalReceiptRootAttached, true);
  assert.equal(deriveMasterStoryState(PEB_COMPLETE_MS - 1).pebComplete, false);
  assert.equal(deriveMasterStoryState(PEB_COMPLETE_MS).pebComplete, true);
  assert.equal(deriveMasterStoryState(HANDOFF_READY_MS - 1).handoffReady, false);
  assert.equal(deriveMasterStoryState(HANDOFF_READY_MS).handoffReady, true);
});

test("post-roll advances experience state without inventing canonical mission time", () => {
  for (const time of [
    FINAL_RECEIPT_LANDED_MS,
    FINAL_RECEIPT_ROOT_ATTACHED_MS,
    PEB_COMPLETE_MS,
    HANDOFF_READY_MS,
    EXPERIENCE_DURATION_MS,
  ]) {
    const story = deriveMasterStoryState(time);
    assert.equal(story.masterTime, time);
    assert.equal(story.missionClockPosition, CANONICAL_MISSION_DURATION_MS);
    assert.equal(story.moment.id, "master-cycle-receipt");
  }
  assert.equal(deriveMasterStoryState(EXPERIENCE_DURATION_MS + 1).masterTime, EXPERIENCE_DURATION_MS);
  assert.equal(derivePhysicalState(PEB_COMPLETE_MS).pebComplete, true);
  assert.equal(derivePhysicalState(HANDOFF_READY_MS).handoffReady, true);
});

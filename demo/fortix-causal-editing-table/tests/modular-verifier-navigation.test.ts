import assert from "node:assert/strict";
import test from "node:test";
import {
  VERIFIER_NAVIGATION_MAX_DEPTH,
  VERIFIER_NAVIGATION_STATE_KEY,
  clearVerifierNavigationHistoryState,
  createVerifierNavigationHistoryState,
  deterministicVerifierParentPath,
  readVerifierNavigationHistoryEntry,
  retargetVerifierNavigationHistoryState,
} from "../app/verify/verifierNavigation.ts";
import { parseVerifierUrl } from "../app/verify/verifierRoutes.ts";

const DIGEST = "0123456789abcdef".repeat(4);
const OTHER_DIGEST = "fedcba9876543210".repeat(4);
const timeline = `/verify/${DIGEST}/timeline`;
const story = `/verify/${DIGEST}/path`;
const garage = `/verify/${DIGEST}/domains?domain=Garage`;
const boundary = `/verify/${DIGEST}/domains?event=garage.arrival&nr=nr.garage&domain=Garage&relation=edge.garage&boundary=boundary.garage&family=garage`;
const receipts = `/verify/${DIGEST}/nanoreceipts?event=garage.arrival&nr=nr.garage&domain=Garage&relation=edge.garage&boundary=boundary.garage&family=garage`;
const forensic = `/verify/${DIGEST}/forensic?event=garage.arrival&nr=nr.garage&domain=Garage&relation=edge.garage&boundary=boundary.garage&family=garage`;

test("domain exploration without an inspected event returns to its independent exact story origin", () => {
  const context = `/verify/${DIGEST}/domains?mission=received&storyEvent=dropoff&domain=Garage`;
  assert.equal(deterministicVerifierParentPath(route(context)), `/verify/${DIGEST}/path?mission=received&storyEvent=dropoff&event=dropoff`);
});

function route(path: string) {
  const parsed = parseVerifierUrl(path);
  assert.equal(parsed.ok, true);
  if (!parsed.ok || parsed.route.kind !== "view") throw new Error("expected view route");
  return parsed.route;
}

test("history provenance is canonical, bounded, entry-specific and preserves framework state", () => {
  const first = createVerifierNavigationHistoryState({ framework: { scroll: 20 } }, timeline, garage);
  assert.deepEqual(first.framework, { scroll: 20 });
  assert.deepEqual(readVerifierNavigationHistoryEntry(first, garage), {
    version: 1, entryPath: garage, parentPath: timeline, depth: 1,
  });
  assert.equal(readVerifierNavigationHistoryEntry(first, timeline), null, "state cannot be reused for another entry");

  const second = createVerifierNavigationHistoryState(first, garage, boundary);
  assert.equal(readVerifierNavigationHistoryEntry(second, boundary)?.depth, 2);
  let state: unknown = second;
  let parent = boundary;
  for (let index = 0; index < VERIFIER_NAVIGATION_MAX_DEPTH + 5; index += 1) {
    const entry = index % 2 === 0 ? receipts : forensic;
    state = createVerifierNavigationHistoryState(state, parent, entry);
    parent = entry;
  }
  assert.equal(readVerifierNavigationHistoryEntry(state, parent)?.depth, VERIFIER_NAVIGATION_MAX_DEPTH);
});

test("history provenance rejects stale, non-canonical, cross-PEB and open-schema values", () => {
  const valid = createVerifierNavigationHistoryState({}, timeline, garage);
  const payload = (valid as Record<string, unknown>)[VERIFIER_NAVIGATION_STATE_KEY] as Record<string, unknown>;
  assert.equal(readVerifierNavigationHistoryEntry({ [VERIFIER_NAVIGATION_STATE_KEY]: { ...payload, extra: true } }, garage), null);
  assert.equal(readVerifierNavigationHistoryEntry({ [VERIFIER_NAVIGATION_STATE_KEY]: { ...payload, parentPath: `${timeline}?mode=simplified` } }, garage), null);
  assert.equal(readVerifierNavigationHistoryEntry({ [VERIFIER_NAVIGATION_STATE_KEY]: { ...payload, parentPath: `/verify/${OTHER_DIGEST}/timeline` } }, garage), null);
  assert.throws(() => createVerifierNavigationHistoryState({}, timeline, timeline), /compatible canonical routes/);
});

test("replacement clearing removes only local provenance", () => {
  const state = createVerifierNavigationHistoryState({ framework: 7 }, timeline, garage);
  assert.deepEqual(clearVerifierNavigationHistoryState(state), { framework: 7 });
  assert.equal(clearVerifierNavigationHistoryState(null), null);
});

test("graph display settings keep the opening context as their parent", () => {
  const graph = `/verify/${DIGEST}/graph`;
  const causal = `${graph}?mode=causal`;
  const state = createVerifierNavigationHistoryState({ framework: 7 }, timeline, graph);
  const retargeted = retargetVerifierNavigationHistoryState(state, graph, causal);
  assert.deepEqual(readVerifierNavigationHistoryEntry(retargeted, causal), {
    version: 1, entryPath: causal, parentPath: timeline, depth: 1,
  });
  assert.equal((retargeted as Record<string, unknown>).framework, 7);
});

test("direct-link fallbacks reconstruct the Garage path without dropping its selected boundary", () => {
  assert.equal(deterministicVerifierParentPath(route(forensic)), receipts);
  assert.equal(deterministicVerifierParentPath(route(receipts)),
    `/verify/${DIGEST}/domains?event=garage.arrival&nr=nr.garage&domain=Garage&relation=edge.garage&boundary=boundary.garage&family=garage`);
  assert.equal(deterministicVerifierParentPath(route(boundary)), garage);
  assert.equal(deterministicVerifierParentPath(route(garage)), story);
  assert.equal(deterministicVerifierParentPath(route(timeline)), story);
  assert.equal(deterministicVerifierParentPath(route(story)), `/verify/${DIGEST}/verdict`);
});

test("direct event and timeline links return to the selected story step", () => {
  const context = "nr=nr.payment&domain=Payment&mode=follow&relation=edge.payment&family=payment&toFinal=1";
  const selectedStory = `${story}?event=payment.confirmed&${context}`;
  const event = `/verify/${DIGEST}/events/payment.confirmed?${context}`;
  assert.equal(deterministicVerifierParentPath(route(event)), selectedStory);
  assert.equal(deterministicVerifierParentPath(route(`${timeline}?event=payment.confirmed&${context}`)), selectedStory);
  assert.equal(deterministicVerifierParentPath(route(`/verify/${DIGEST}/nanoreceipts?event=payment.confirmed&${context}`)), event);
});

test("each context-free exploration view has a deterministic way back to the Path", () => {
  for (const view of ["timeline", "domains", "graph", "nanoreceipts", "forensic"] as const) {
    assert.equal(deterministicVerifierParentPath(route(`/verify/${DIGEST}/${view}`)), story, view);
  }
});

test("story-to-event-to-proof history returns to exact local parents", () => {
  const selectedStory = `${story}?event=garage.arrival&nr=nr.garage&domain=Garage`;
  const event = `/verify/${DIGEST}/events/garage.arrival?nr=nr.garage&domain=Garage`;
  const eventState = createVerifierNavigationHistoryState({ framework: { scroll: 28 } }, selectedStory, event);
  const proofState = createVerifierNavigationHistoryState(eventState, event, receipts);
  assert.equal(readVerifierNavigationHistoryEntry(proofState, receipts)?.parentPath, event);
  assert.equal(readVerifierNavigationHistoryEntry(eventState, event)?.parentPath, selectedStory);
  assert.deepEqual(eventState.framework, { scroll: 28 });
});

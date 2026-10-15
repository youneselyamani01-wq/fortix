import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { MASTER_STORY_MOMENTS } from "../app/masterStory.ts";
import {
  BOUNDARY_CROSSINGS,
  HUMAN_AUTHORITY_BOUNDARY_KEY,
  MISSION_ECOSYSTEMS,
  MISSION_ID,
  MISSION_RECEIPTS,
  MISSION_ROUTING_PROVENANCE,
  REFUSABLE_BOUNDARY_KEY,
  ROUTING_CHAIN,
  crossingsAt,
  currentEcosystem,
  missionEvidenceIds,
  nonMissionChainIds,
  receiptsClosedAt,
  returnCrossingPairs,
  routingResolvedAt,
  routingStateAt,
} from "../app/missionContinuity.ts";

/** D-006C — one mission, many ecosystems, one continuous proof. */

test("D-006C: one Mission ID survives the whole day", () => {
  const ids = missionEvidenceIds();
  assert.ok(ids.length >= 20, `expected the mission chain to carry the day, saw ${ids.length} objects`);
  assert.equal(new Set(ids).size, ids.length, "mission evidence ids must be unique");
  // Trust and governance material is deliberately on other chains.
  const others = nonMissionChainIds();
  assert.ok(others.length > 0, "trust material must not be folded into the mission chain");
  assert.ok(!others.includes(MISSION_ID));
});

test("D-006C: every meaningful receipt resolves to the same mission lineage", () => {
  assert.equal(MISSION_RECEIPTS.length, 5);
  const times = MISSION_RECEIPTS.map((receipt) => receipt.closesAtMs);
  assert.deepEqual([...times].sort((a, b) => a - b), times, "receipts must close in mission order");
  for (const receipt of MISSION_RECEIPTS) {
    assert.ok(receipt.closesAtMs > 0 && receipt.closesAtMs <= 120_000);
    assert.match(receipt.labelKey, /^[a-z][A-Za-z]+$/, "every receipt must carry a translation key");
  }
});

test("D-006C: the mission crosses several distinct ecosystems", () => {
  assert.ok(MISSION_ECOSYSTEMS.length >= 10, `only ${MISSION_ECOSYSTEMS.length} ecosystems on the path`);
  for (const family of ["taxiAutonomy", "navigationA", "navigationB", "garage", "humanApprover", "paymentProvider", "fleetOperations"]) {
    assert.ok(MISSION_ECOSYSTEMS.includes(family), `missing ecosystem: ${family}`);
  }
  assert.equal(currentEcosystem(0), MASTER_STORY_MOMENTS[0].systemKey);
  assert.equal(currentEcosystem(120_000), MASTER_STORY_MOMENTS.at(-1)?.systemKey);
});

test("D-006C: a boundary is a change of ecosystem, not merely a causal link", () => {
  // Every crossing must actually change system...
  for (const crossing of BOUNDARY_CROSSINGS) {
    assert.notEqual(crossing.fromSystem, crossing.toSystem, `${crossing.boundaryKey} crosses nothing`);
  }
  // ...and the model must contain causally-linked moments that cross nothing,
  // otherwise "boundary" would just be a synonym for "next event".
  let continuations = 0;
  for (let index = 1; index < MASTER_STORY_MOMENTS.length; index += 1) {
    if (MASTER_STORY_MOMENTS[index].systemKey === MASTER_STORY_MOMENTS[index - 1].systemKey) continuations += 1;
  }
  assert.ok(continuations > 0, "not every causal edge may be treated as a boundary");
  assert.ok(BOUNDARY_CROSSINGS.length < MASTER_STORY_MOMENTS.length - 1);
});

test("D-006C: a return crossing is distinct from its outbound crossing", () => {
  const pairs = returnCrossingPairs();
  assert.ok(pairs.length > 0, "the mission must demonstrate at least one A -> B -> A round trip");
  for (const { outbound, back } of pairs) {
    assert.equal(outbound.fromSystem, back.toSystem);
    assert.equal(outbound.toSystem, back.fromSystem);
    assert.ok(outbound.timeMs < back.timeMs, "a result cannot return before its request was sent");
    assert.notEqual(outbound.boundaryKey, back.boundaryKey, "intent and result must be distinct evidence");
    assert.equal(outbound.direction, "OUTBOUND");
    assert.equal(back.direction, "RETURN");
  }
});

test("D-006C: provider rerouting is read from the model, not staged in the UI", () => {
  const systems = MASTER_STORY_MOMENTS.map((moment) => moment.systemKey);
  const leftA = systems.lastIndexOf(ROUTING_CHAIN.fromProvider);
  const router = systems.indexOf(ROUTING_CHAIN.router);
  const resolvedB = systems.indexOf(ROUTING_CHAIN.toProvider);
  assert.ok(leftA >= 0 && router >= 0 && resolvedB >= 0, "the routing chain must exist in the model");
  assert.ok(router < resolvedB, "the router must resolve before Provider B carries the mission");
  assert.ok(routingResolvedAt() > 0);
  // Causal continuity: the reroute happens inside the mission, not beside it.
  const resolvedMoment = MASTER_STORY_MOMENTS[resolvedB];
  assert.ok(resolvedMoment.timeMs > MASTER_STORY_MOMENTS[router].timeMs);
  assert.equal(MISSION_ROUTING_PROVENANCE.resolved_provider,
    routingStateAt(routingResolvedAt()).resolved?.provider_id);
  assert.equal(routingStateAt(53_999).vehicleMayExecute, false);
  assert.equal(routingStateAt(54_000).vehicleMayExecute, true);
});

test("D-006C: DENY records a refused boundary state but creates no payment receipt", () => {
  const approved = crossingsAt(120_000, "APPROVED");
  const denied = crossingsAt(120_000, "DENIED");

  const approvedPayment = approved.find((crossing) => crossing.boundaryKey === REFUSABLE_BOUNDARY_KEY);
  const deniedPayment = denied.find((crossing) => crossing.boundaryKey === REFUSABLE_BOUNDARY_KEY);
  assert.ok(approvedPayment !== undefined && deniedPayment !== undefined,
    "the boundary must be reached under both choices — refusal is still an encounter");
  assert.equal(approvedPayment.state, "CROSSED");
  assert.equal(deniedPayment.state, "REFUSED");

  // The human authority boundary itself is encountered either way. The frozen
  // approved bundle has no invented denial receipt, so refusal is represented
  // only by this review-state projection.
  assert.ok(denied.some((crossing) => crossing.boundaryKey === HUMAN_AUTHORITY_BOUNDARY_KEY));
  assert.ok(approved.some((crossing) => crossing.boundaryKey === HUMAN_AUTHORITY_BOUNDARY_KEY));

  // DENY is terminal for what depended on it, and only for that.
  const closedOnDeny = receiptsClosedAt(120_000, "DENIED").map((receipt) => receipt.id);
  const closedOnApprove = receiptsClosedAt(120_000, "APPROVED").map((receipt) => receipt.id);
  assert.ok(closedOnApprove.includes("payment") && closedOnApprove.includes("return"));
  assert.ok(!closedOnDeny.includes("payment"), "a denied payment cannot produce a payment receipt");
  assert.ok(closedOnDeny.includes("ride"), "a denied payment must not erase the ride that already happened");
  assert.ok(closedOnDeny.includes("maintenance"), "work already performed remains evidenced");
});

test("D-006C: receipts accumulate deterministically with the mission clock", () => {
  assert.deepEqual(receiptsClosedAt(0).map((receipt) => receipt.id), []);
  assert.deepEqual(receiptsClosedAt(36_000).map((receipt) => receipt.id), ["ride"]);
  assert.deepEqual(receiptsClosedAt(80_000).map((receipt) => receipt.id), ["ride", "garage", "maintenance"]);
  assert.deepEqual(
    receiptsClosedAt(120_000).map((receipt) => receipt.id),
    ["ride", "garage", "maintenance", "payment", "return"],
  );
  // Rewinding must reproduce exactly, with no accumulated state.
  receiptsClosedAt(120_000);
  assert.deepEqual(receiptsClosedAt(36_000).map((receipt) => receipt.id), ["ride"]);
});

test("D-006C: crossings are monotonic in the mission clock and reproducible on rewind", () => {
  let previous = 0;
  for (const crossing of BOUNDARY_CROSSINGS) {
    assert.ok(crossing.timeMs >= previous, "crossings must follow the mission clock");
    previous = crossing.timeMs;
  }
  const late = crossingsAt(96_000);
  crossingsAt(120_000);
  assert.deepEqual(crossingsAt(96_000), late);
});

test("D-006C: mission continuity is a pure projection with no clock or randomness", () => {
  const source = readFileSync(new URL("../app/missionContinuity.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /Date\.now|new Date|performance\.now|Math\.random|setTimeout|setInterval|requestAnimationFrame/);
  // No parallel visual state machine: this module only reads the canonical model.
  assert.match(source, /from "\.\/masterStory\.ts"/);
  assert.doesNotMatch(source, /useState|useEffect/);
});

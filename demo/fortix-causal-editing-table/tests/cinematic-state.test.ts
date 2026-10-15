import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  deriveCinematicState,
  deterministicTrafficCarPosition,
} from "../app/cinematic.ts";
import {
  FINAL_RECEIPT_EMITTED_MS,
  FINAL_RECEIPT_ROOT_ATTACHED_MS,
  FINAL_REQUIRED_LEAF_MATURE_MS,
  HANDOFF_READY_MS,
  PEB_COMPLETE_MS,
} from "../app/storyTimeline.ts";

test("cinematic state is a pure projection of masterTime", () => {
  for (const time of [0, 18_000, 46_000, 48_000, 52_000, 54_000, 82_000, 84_000, 88_000, 112_000, 120_000]) {
    const direct = deriveCinematicState(time);
    deriveCinematicState(0);
    assert.deepEqual(deriveCinematicState(time), direct);
  }
});

test("traffic choreography reveals event before interpretation, authority, action, and proof", () => {
  assert.equal(deriveCinematicState(45_999).trafficStoryStep, "QUIET");
  assert.equal(deriveCinematicState(46_000).trafficStoryStep, "TRAFFIC");
  assert.equal(deriveCinematicState(48_000).trafficStoryStep, "ETA");
  assert.equal(deriveCinematicState(48_250).trafficStoryStep, "REQUEST");
  assert.equal(deriveCinematicState(48_750).trafficStoryStep, "POLICY");
  assert.equal(deriveCinematicState(49_500).trafficStoryStep, "CANDIDATES");
  assert.equal(deriveCinematicState(50_500).trafficStoryStep, "SELECTED");
  assert.equal(deriveCinematicState(51_000).trafficStoryStep, "RESOLVED");
  assert.equal(deriveCinematicState(52_000).trafficStoryStep, "AUTHORITY");
  assert.equal(deriveCinematicState(53_000).trafficStoryStep, "ROUTE_READY");
  assert.equal(deriveCinematicState(54_000).trafficStoryStep, "REROUTED");
  assert.equal(deriveCinematicState(54_000).route, "ALTERNATIVE");
  assert.equal(deriveCinematicState(56_000).focus, "PROOF");
});

test("congestion stops the taxi until the resulting route may execute", () => {
  const before = deriveCinematicState(46_000);
  const slow = deriveCinematicState(47_000);
  const stopped = deriveCinematicState(52_000);
  const resumed = deriveCinematicState(58_000);
  assert.equal(slow.vehicleTempo, "SLOW");
  assert.ok(slow.visualVehicleProgress - before.visualVehicleProgress < 0.1);
  assert.equal(stopped.vehicleTempo, "STOPPED");
  assert.equal(resumed.vehicleTempo, "RESUMED");
  assert.ok(resumed.visualVehicleProgress > stopped.visualVehicleProgress);
});

test("payment variants share capability while visual authority gates execution", () => {
  assert.equal(deriveCinematicState(84_000, "NORMAL").paymentStoryStep, "POLICY");
  assert.equal(deriveCinematicState(84_000, "HIGH_APPROVED").paymentStoryStep, "HUMAN");
  assert.equal(deriveCinematicState(86_000, "HIGH_DENIED").paymentStoryStep, "STOPPED");
  assert.equal(deriveCinematicState(88_000, "NORMAL").paymentStoryStep, "RECEIPT");
});

test("receipt birth and traffic vehicles reconstruct exactly on rewind", () => {
  const first = deriveCinematicState(54_750);
  const positions = Array.from({ length: 7 }, (_, index) => deterministicTrafficCarPosition(54_750, index % 2, index, first.trafficDensity));
  deriveCinematicState(1_000);
  const replayed = deriveCinematicState(54_750);
  assert.deepEqual(replayed, first);
  assert.deepEqual(Array.from({ length: 7 }, (_, index) => deterministicTrafficCarPosition(54_750, index % 2, index, replayed.trafficDensity)), positions);
  assert.equal(replayed.receiptBirth?.event.id, "route-b-executed");
});

test("cinematic model has no wall-clock, random, timer, or frame-history dependency", () => {
  const source = readFileSync(new URL("../app/cinematic.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /Date\.now|new Date|performance\.now|Math\.random|setTimeout|setInterval|requestAnimationFrame/);
});

test("final sequence exposes every post-roll proof gate", () => {
  assert.equal(deriveCinematicState(112_000).finalSequence, "PARKED");
  assert.equal(deriveCinematicState(114_000).finalSequence, "RECEIPTS");
  assert.equal(deriveCinematicState(FINAL_REQUIRED_LEAF_MATURE_MS).finalSequence, "FINAL_LEAF");
  assert.equal(deriveCinematicState(FINAL_RECEIPT_EMITTED_MS).finalSequence, "FINAL_RECEIPT");
  assert.equal(deriveCinematicState(FINAL_RECEIPT_ROOT_ATTACHED_MS).finalSequence, "ROOT_ATTACHED");
  assert.equal(deriveCinematicState(PEB_COMPLETE_MS).finalSequence, "PEB_COMPLETE");
  assert.equal(deriveCinematicState(HANDOFF_READY_MS).finalSequence, "HANDOFF_READY");
  assert.equal(deriveCinematicState(120_000).beat, "CALM_CONFIDENCE");
});

test("D-005E bilingual presentation keeps the canonical receipt-and-evidence line", () => {
  const english = readFileSync(new URL("../../../site/src/i18n/locales/en.ts", import.meta.url), "utf8");
  const french = readFileSync(new URL("../../../site/src/i18n/locales/fr.ts", import.meta.url), "utf8");
  const component = readFileSync(new URL("../app/OperationalCycleTable.tsx", import.meta.url), "utf8");
  assert.match(english, /receiptTravelsWithEvidence: "The receipt travels with the evidence needed to verify it\."/);
  assert.match(french, /receiptTravelsWithEvidence: "Le reçu voyage avec les preuves nécessaires à sa vérification\."/);
  assert.match(component, /t\.d005\.receiptTravelsWithEvidence/);
  assert.doesNotMatch(component, /The evidence travels with the receipt\./);
});

test("D-005E presentation disables history-dependent CSS animation", () => {
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /\.cinematic-shell \*[\s\S]*animation: none !important;/);
  assert.match(css, /\.cinematic-shell \*[\s\S]*transition: none !important;/);
});

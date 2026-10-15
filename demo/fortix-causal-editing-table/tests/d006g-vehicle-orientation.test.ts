import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { OPERATIONAL_CYCLE_DURATION_MS } from "../app/operationalCycle.ts";
import { derivePresentationMotion } from "../app/vehiclePresentation.ts";
import { visualEventTime } from "../app/visualEvents.ts";

/**
 * D-006G P2 — the taxi has a front and a back, and keeps them.
 *
 * Reported from the rendered demo: during the traffic-light sequence the rear
 * lights momentarily appeared at the FRONT of the vehicle.
 *
 * Cause, found by sampling the motion rather than by reading the stylesheet:
 * P1 moved the stop from "when the light turned red" to `taxi-at-rest`, the
 * end of the taxi's own braking action, but `SIGNAL_STOP_POSITION` was left at
 * the old moment's position. The taxi was therefore 0.011 PAST its own stop
 * line when braking began, the easing curve ran it backwards to settle, the
 * direction sampler read that as a change of heading, and `scaleX(-1)`
 * mirrored the entire vehicle for ~0.9 s.
 *
 * So the orientation defect was a timing defect. These tests hold both ends:
 * the vehicle never reverses where it is meant to be going forwards, and the
 * lamps are anchored in the vehicle's own frame rather than to the screen.
 */

const component = readFileSync(new URL("../app/ConvergenceExperience.tsx", import.meta.url), "utf8");
const stylesheet = readFileSync(new URL("../app/convergence.css", import.meta.url), "utf8");

const INTERSECTION_FROM = visualEventTime("signal-green") - 1_000;
const INTERSECTION_TO = visualEventTime("taxi-resumes") + 2_000;

function sample(fromMs: number, toMs: number, stepMs = 50) {
  const frames = [];
  for (let t = fromMs; t <= toMs; t += stepMs) frames.push({ t, motion: derivePresentationMotion(t) });
  return frames;
}

test("D-006G P2: the taxi never turns around at the intersection", () => {
  const frames = sample(INTERSECTION_FROM, INTERSECTION_TO);
  const flips = frames.filter((frame, index) =>
    index > 0 && frame.motion.facing !== frames[index - 1].motion.facing);
  assert.deepEqual(flips.map((f) => f.t), [],
    "a heading change here mirrors the whole vehicle and puts the rear lamps in front");
  for (const frame of frames) {
    assert.equal(frame.motion.facing, 1, `facing ${frame.motion.facing} at ${frame.t}`);
  }
});

test("D-006G P2: the taxi never reverses while approaching or holding its stop", () => {
  const frames = sample(INTERSECTION_FROM, INTERSECTION_TO);
  for (let index = 1; index < frames.length; index += 1) {
    const previous = frames[index - 1].motion.position;
    const current = frames[index].motion.position;
    assert.ok(current >= previous - 1e-9,
      `the vehicle moved backwards at ${frames[index].t}: ${previous} -> ${current}`);
  }
});

test("D-006G P2: braking begins short of the stop line, not past it", () => {
  // The root cause, asserted directly: if the taxi is already past where it
  // must stop, the only way to reach the stop is to reverse.
  const atBrake = derivePresentationMotion(visualEventTime("taxi-brake-applied")).position;
  const atRest = derivePresentationMotion(visualEventTime("taxi-at-rest")).position;
  assert.ok(atBrake < atRest,
    `braking starts at ${atBrake} but the stop is at ${atRest} — the vehicle would reverse`);
});

test("D-006G P2: a genuine turnaround still mirrors the vehicle", () => {
  // The return leg really does drive the other way, and there the whole body
  // must mirror — the rear stays the rear because the car turned, not because
  // the lamps moved. Removing this would be over-correcting the fix.
  const outbound = derivePresentationMotion(visualEventTime("garage"));
  const returning = derivePresentationMotion(110_000);
  assert.equal(outbound.facing, 1);
  assert.equal(returning.facing, -1);
  assert.ok(returning.position < outbound.position, "the return leg must genuinely travel back");
});

test("D-006G P2: facing is only ever 1 or -1, for every frame of the mission", () => {
  for (const { t, motion } of sample(0, OPERATIONAL_CYCLE_DURATION_MS, 100)) {
    assert.ok(motion.facing === 1 || motion.facing === -1, `facing ${motion.facing} at ${t}`);
  }
});

// --- the lamps themselves -------------------------------------------------

test("D-006G P2: the vehicle carries head lamps at the front and rear lamps at the back", () => {
  assert.match(component, /className="head-light head-light-upper"/);
  assert.match(component, /className="head-light head-light-lower"/);
  assert.match(component, /className="brake-light brake-light-upper"/);
  assert.match(component, /className="brake-light brake-light-lower"/);
});

test("D-006G P2: lamps are anchored in the vehicle's own frame, not to the screen", () => {
  const head = stylesheet.slice(
    stylesheet.indexOf(".autonomous-taxi .head-light {"),
    stylesheet.indexOf("}", stylesheet.indexOf(".autonomous-taxi .head-light {")),
  );
  const rear = stylesheet.slice(
    stylesheet.indexOf(".autonomous-taxi .brake-light {"),
    stylesheet.indexOf("}", stylesheet.indexOf(".autonomous-taxi .brake-light {")),
  );
  assert.ok(head.length > 0 && rear.length > 0, "both lamp rules must exist");

  // Front is anchored right, rear is anchored left, in the taxi's own box.
  assert.match(head, /right:\s*-?\d/);
  assert.doesNotMatch(head, /\bleft:/, "a head lamp anchored from the left is not a front lamp");
  assert.match(rear, /left:\s*-?\d/);
  assert.doesNotMatch(rear, /\bright:/, "a rear lamp anchored from the right is not a rear lamp");

  // Neither may be positioned from the screen-direction attribute, which is
  // exactly how a lamp would end up swapping sides.
  const facingRules = stylesheet.match(/\[data-facing="[^"]*"\][^{]*\{[^}]*\}/g) ?? [];
  for (const rule of facingRules) {
    assert.doesNotMatch(rule, /head-light|brake-light/,
      "lamp geometry must not depend on which way the screen says the car is pointing");
  }
});

test("D-006G P2: rear lamps are lit at rest and brighten under braking", () => {
  const base = stylesheet.slice(
    stylesheet.indexOf(".autonomous-taxi .brake-light {"),
    stylesheet.indexOf("}", stylesheet.indexOf(".autonomous-taxi .brake-light {")),
  );
  // A rear lamp is red before anyone brakes; grey read as an unlit bulb.
  assert.doesNotMatch(base, /background:\s*#7d7771/, "a grey rear lamp reads as switched off");
  assert.match(base, /background:\s*#a3301f/);

  const braking = stylesheet.slice(
    stylesheet.indexOf(".autonomous-taxi.has-brake-lights .brake-light {"),
    stylesheet.indexOf("}", stylesheet.indexOf(".autonomous-taxi.has-brake-lights .brake-light {")),
  );
  assert.match(braking, /opacity:\s*1/);
  assert.match(braking, /box-shadow/, "braking must be visibly brighter, not merely a colour swap");
});

test("D-006G P2: braking state follows the vehicle's own action, and ends with it", () => {
  // Presentation only, but it must still track the right thing: the lamps are
  // on while the vehicle is stopping and holding, and off once it has resumed.
  assert.equal(derivePresentationMotion(visualEventTime("taxi-observes-yellow")).brakeLights, false,
    "observing a signal is not braking");
  assert.equal(derivePresentationMotion(visualEventTime("taxi-brake-applied")).brakeLights, true);
  assert.equal(derivePresentationMotion(visualEventTime("taxi-at-rest")).brakeLights, true);
  assert.equal(derivePresentationMotion(visualEventTime("taxi-resumes")).brakeLights, false);
});

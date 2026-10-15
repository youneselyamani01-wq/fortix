import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { CATEGORY_CADENCE_MS, CATEGORY_ORDER, CHECK_CATEGORY, DRUM_ROLL_MS, categoriesOf, revealPlan } from "../app/nx/verifier/choreography.ts";

/**
 * D-006/NX3 — THE CHOREOGRAPHY'S MOTION (mandate §16–§18; tests 24–25).
 *
 * The "roulement de tambours" is pacing: a short, controlled hold between
 * the last group of completed checks and the verdict. It is bounded, it
 * delays only what is already true, and under reduced motion it is zero.
 */

const source = (relative: string) => readFileSync(new URL(`../app/${relative}`, import.meta.url), "utf8");
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/** The check set the verifier reports for the canonical mission (offlineVerification.ts + masterStory.ts). */
const REAL_CHECKS = Object.keys(CHECK_CATEGORY);

test("NX3-T24: the drum-roll is a bounded pause — never a literal, never long", () => {
  assert.ok(DRUM_ROLL_MS >= 600 && DRUM_ROLL_MS <= 1500, `the hold is felt and does not drag: ${DRUM_ROLL_MS} ms`);
  assert.ok(CATEGORY_CADENCE_MS >= 120 && CATEGORY_CADENCE_MS <= 400, `one group per beat: ${CATEGORY_CADENCE_MS} ms`);
  const plan = revealPlan(REAL_CHECKS, false);
  assert.equal(plan.groups.length, 5, "five of the six categories carry a completed check; `time` is empty by design");
  assert.deepEqual(plan.groups.map((group) => group.category), CATEGORY_ORDER.filter((category) => category !== "time"));
  assert.equal(plan.steps.length, plan.groups.length + 1, "one step per group, then the verdict");
  for (let i = 1; i < plan.steps.length; i += 1) assert.ok(plan.steps[i]! > plan.steps[i - 1]!, "steps strictly advance");
  assert.equal(plan.verdictAtMs, plan.groups.length * CATEGORY_CADENCE_MS + DRUM_ROLL_MS);
  assert.equal(plan.steps.at(-1), plan.verdictAtMs);
  assert.ok(plan.verdictAtMs <= 3000, `the whole reveal, groups and hold, stays under three seconds: ${plan.verdictAtMs} ms`);
  assert.ok(plan.verdictAtMs - plan.steps[plan.groups.length - 1]! === DRUM_ROLL_MS, "the hold is exactly the drum-roll");
});

test("NX3-T25: reduced motion delays nothing — and the verdict is in the document from the moment it exists", () => {
  const reduced = revealPlan(REAL_CHECKS, true);
  assert.deepEqual([...reduced.steps], []);
  assert.equal(reduced.verdictAtMs, 0);
  assert.equal(reduced.groups.length, 5, "the groups are still listed, all at once");
  assert.deepEqual([...revealPlan([], false).steps], [], "nothing to pace, nothing delayed");
  const surface = code(source("nx/verifier/VerifierSurface.tsx"));
  assert.match(surface, /useSyncExternalStore\(subscribeReducedMotion, readReducedMotion, readReducedMotionOnServer\)/, "the preference is read live and never set inside an effect");
  assert.match(surface, /"\(prefers-reduced-motion: reduce\)"/);
  assert.match(surface, /const reveal = resultKey === null \|\| plan\.steps\.length === 0 \? Number\.POSITIVE_INFINITY/, "an empty plan shows everything");
  // The verdict is present, attributed and only unpainted during the hold.
  assert.match(surface, /data-verdict=\{verdict \?\? ""\}/);
  assert.match(surface, /data-reveal=\{verdict === null \? "" : verdictRevealed \? "shown" : "holding"\}/);
  assert.match(surface, /\{verdict !== null && \(\s*<section className="nx-vs-verdict" data-verdict=\{verdict\} data-revealed=\{verdictRevealed \? "true" : "false"\}/);
  const css = source("nx/verifier/verifier.css");
  assert.match(css, /\.nx-vs-verdict\[data-revealed="false"\] \{ opacity: 0; transform: translateY\(6px\); animation: none; \}/, "the hold is opacity, not absence");
  assert.doesNotMatch(css, /\.nx-vs-verdict\[data-revealed="false"\][^}]*(display: none|visibility: hidden)/);
  const reducedBlock = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
  assert.match(reducedBlock, /\.nx-vs-verdict\[data-revealed="false"\] \{ opacity: 1; \}/, "under reduced motion the verdict is painted at once");
  assert.match(reducedBlock, /animation: none; transition: none;/);
});

test("NX3: the sequence shows performed checks in cadence and never a fake progress", () => {
  const surface = code(source("nx/verifier/VerifierSurface.tsx"));
  assert.match(surface, /data-revealed=\{index < reveal \? "true" : "false"\}/, "a group is lit once its step has passed");
  assert.match(surface, /<b>\{group\.checks\.length\}<\/b>/, "the count is the count");
  assert.doesNotMatch(surface, /setInterval|Math\.random|<progress/, "no simulated work");
  assert.match(surface, /aria-busy=\{verification\.state === "ANALYZING" \|\| undefined\}/, "while analyzing, the act is busy — that is all that is claimed");
  // The timers only reveal; they never change what exists.
  assert.match(surface, /window\.setTimeout\(\(\) => setRevealed\(\{ key: resultKey, steps: index \+ 1 \}\), at\)/);
  assert.match(surface, /for \(const timer of timers\) window\.clearTimeout\(timer\);/, "and are cleared when the result changes");
  assert.deepEqual(categoriesOf(REAL_CHECKS).flatMap((group) => group.checks).sort(), [...REAL_CHECKS].sort());
});

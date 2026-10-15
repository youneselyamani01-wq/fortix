import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  NR_APPEAR_ENDS,
  STEM_ENDS,
  causalPhaseViolations,
  leafCausalPhases,
} from "../app/proofGrowthPhases.ts";
import { RECEIPT_TRAVEL_DURATION_MS } from "../app/storyTimeline.ts";
import { en } from "../../../site/src/i18n/locales/en.ts";
import { fr } from "../../../site/src/i18n/locales/fr.ts";

/**
 * D-006 C3-R1 — the Proof Tree may not predict its own evidence.
 *
 * PUBLIC VISUAL INVARIANT: no branch before its evidence exists.
 * Order: event → nano-receipt appears → branch grows toward it → lock.
 */

const component = readFileSync(
  new URL("../app/ConvergenceExperience.tsx", import.meta.url), "utf8");
const stylesheet = readFileSync(
  new URL("../app/convergence.css", import.meta.url), "utf8");

// ---------------------------------------------------------------------------
// The phase model itself
// ---------------------------------------------------------------------------

test("R1: the causal phase invariant holds across the whole growth range", () => {
  for (let step = 0; step <= 1000; step += 1) {
    const growth = step / 1000;
    assert.deepEqual([...causalPhaseViolations(growth)], [], `growth ${growth}`);
  }
  // And outside the clamped range.
  assert.deepEqual([...causalPhaseViolations(-0.5)], []);
  assert.deepEqual([...causalPhaseViolations(1.5)], []);
});

test("R1: nano-receipt first, branch second, lock third — strictly", () => {
  // While the NR is materialising, no branch exists at all.
  const during = leafCausalPhases(NR_APPEAR_ENDS / 2);
  assert.ok(during.nrAppear > 0 && during.nrAppear < 1);
  assert.equal(during.stem, 0);
  assert.equal(during.lock, 0);

  // The instant the stem starts, the NR is already fully there.
  const stemStart = leafCausalPhases(NR_APPEAR_ENDS + 0.01);
  assert.equal(stemStart.nrAppear, 1);
  assert.ok(stemStart.stem > 0);
  assert.equal(stemStart.lock, 0);

  // The instant the lock starts, the branch is already fully attached.
  const lockStart = leafCausalPhases(STEM_ENDS + 0.01);
  assert.equal(lockStart.stem, 1);
  assert.ok(lockStart.lock > 0);
  assert.equal(lockStart.locked, false);

  const done = leafCausalPhases(1);
  assert.deepEqual([done.nrAppear, done.stem, done.lock, done.locked], [1, 1, 1, true]);
});

test("R1: zero growth renders nothing — no placeholder geometry", () => {
  const nothing = leafCausalPhases(0);
  assert.deepEqual([nothing.nrAppear, nothing.stem, nothing.lock], [0, 0, 0]);
});

// ---------------------------------------------------------------------------
// Consecutive receipts and scrub determinism
// ---------------------------------------------------------------------------

/** The same growth clock the component applies: land, then grow. */
const growthAt = (masterTime: number, eventTimeMs: number, durationMs: number) =>
  Math.max(0, Math.min(1, (masterTime - eventTimeMs - RECEIPT_TRAVEL_DURATION_MS) / durationMs));

test("R1: four consecutive receipts preserve causal order at every sampled instant", () => {
  const durationMs = 700;
  const events = [0, 2_000, 4_000, 6_000];
  for (let master = -500; master <= 9_000; master += 50) {
    const phases = events.map((eventTime) => leafCausalPhases(growthAt(master, eventTime, durationMs)));
    phases.forEach((phase, index) => {
      // No branch before its own evidence, ever.
      if (phase.stem > 0) assert.equal(phase.nrAppear, 1, `event ${index} at ${master}ms`);
      // Nothing of a later event may be ahead of an earlier one.
      if (index > 0) {
        const previous = phases[index - 1];
        assert.ok(previous.nrAppear >= phase.nrAppear, `NR order broke at ${master}ms`);
        assert.ok(previous.stem >= phase.stem, `branch order broke at ${master}ms`);
        assert.ok(previous.lock >= phase.lock, `lock order broke at ${master}ms`);
      }
      // Before the flight lands, this leaf contributes nothing.
      if (master < events[index] + RECEIPT_TRAVEL_DURATION_MS) {
        assert.equal(phase.nrAppear, 0, `event ${index} visible early at ${master}ms`);
      }
    });
  }
});

test("R1: scrub and rewind reconstruct the identical causal state", () => {
  const durationMs = 700;
  const forward = [0, 800, 1_500, 2_400, 3_600];
  const scrubbed = [3_600, 800, 2_400, 0, 1_500, 3_600];
  const stateAt = (master: number) => JSON.stringify(leafCausalPhases(growthAt(master, 0, durationMs)));
  const byTime = new Map(forward.map((master) => [master, stateAt(master)]));
  for (const master of scrubbed) {
    assert.equal(stateAt(master), byTime.get(master) ?? stateAt(master), `divergence at ${master}ms`);
  }
});

// ---------------------------------------------------------------------------
// The rendering contract
// ---------------------------------------------------------------------------

test("R1: in-flight and future leaves render nothing in the DOM", () => {
  assert.match(component, /if \(growth <= 0\) return null;/,
    "a leaf whose nano-receipt has not landed must not reach the DOM");
  assert.match(component, /if \(growth <= 0\) return \[\];/,
    "an edge to unlanded evidence must not reach the DOM");
  assert.match(component, /"--terminal-progress": phases\.nrAppear/,
    "the terminal must materialise on the NR-appear phase, not late");
  assert.match(component, /"--stem-progress": phases\.stem/,
    "the branch must grow on the stem phase, after the NR exists");
  assert.match(component, /phases\.locked \? " is-locked"/);
  assert.match(stylesheet, /\.proof-leaf\.is-locked i/);
});

// ---------------------------------------------------------------------------
// EN | FR public mode and the removal of dark
// ---------------------------------------------------------------------------

test("R1: the public language mode is EN | FR through the existing i18n architecture", () => {
  assert.match(component, /className="language-mode"/);
  assert.match(component, /aria-pressed=\{locale === "en"\}[\s\S]{0,80}setLocale\("en"\)/);
  assert.match(component, /aria-pressed=\{locale === "fr"\}[\s\S]{0,80}setLocale\("fr"\)/);
  assert.doesNotMatch(component, /toggleLocale/);
  assert.match(stylesheet, /\.language-mode button\[aria-pressed="true"\]/);
});

test("R1: dark mode is gone — no state, no toggle, no styling, no keys", () => {
  assert.doesNotMatch(component, /verifierTheme|setVerifierTheme|data-verifier-theme/);
  assert.doesNotMatch(stylesheet, /data-verifier-theme|verifier-theme-control/);
  assert.doesNotMatch(stylesheet, /"dark"/);
  const enVerifier = en.d006c2.verifier as Record<string, unknown>;
  const frVerifier = fr.d006c2.verifier as Record<string, unknown>;
  for (const key of ["light", "dark", "themeLabel"]) {
    assert.equal(key in enVerifier, false, `en verifier still carries ${key}`);
    assert.equal(key in frVerifier, false, `fr verifier still carries ${key}`);
  }
});

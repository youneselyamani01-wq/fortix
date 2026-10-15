import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { presentationTimeForMasterTime } from "../app/masterStory.ts";
import { receiptEmissionSourceForProducer } from "../app/stageGeometry.ts";
import { VISUAL_EVENTS } from "../app/visualEvents.ts";

/**
 * D-006A regression guard.
 *
 * The comprehension audit found the component and the stylesheet had drifted
 * apart: the component emitted --branch-top while the stylesheet still
 * positioned leaves from --leaf-y, so every proof branch collapsed onto one
 * line. The whole suite passed anyway, because no test asserted anything about
 * geometry or about the component/stylesheet contract. These tests close that
 * gap: they are deliberately about *rendering intent*, not about model logic.
 */

const component = readFileSync(new URL("../app/ConvergenceExperience.tsx", import.meta.url), "utf8");
const stylesheet = readFileSync(new URL("../app/convergence.css", import.meta.url), "utf8");
const globals = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

/** Class names the component actually puts on elements. */
function emittedClassNames(source: string): Set<string> {
  const tokens = new Set<string>();
  const collect = (chunk: string) => {
    for (const token of chunk.split(/\s+/)) {
      // Class names in this codebase are lower-kebab. Anything with an uppercase
      // letter is an actor name or a state enum that happens to sit inside the
      // same template literal, and a trailing dash is an interpolation splice
      // such as `event-tone-${tone}`.
      if (!/^[a-z][a-z0-9-]*$/.test(token)) continue;
      if (token.endsWith("-")) continue;
      tokens.add(token);
    }
  };
  for (const match of source.matchAll(/className="([^"]*)"/g)) collect(match[1]);
  for (const match of source.matchAll(/className=\{`([^`]*)`\}/g)) {
    const template = match[1];
    // Conditional fragments live inside ${...} as plain string literals.
    for (const literal of template.matchAll(/"([^"]*)"/g)) collect(literal[1]);
    collect(template.replace(/\$\{[^}]*\}/g, " "));
  }
  return tokens;
}

/** Custom properties the component sets through inline styles. */
function emittedCustomProperties(source: string): Set<string> {
  return new Set([...source.matchAll(/"(--[a-z0-9-]+)":/gi)].map((match) => match[1]));
}

/** Custom properties any stylesheet declares. */
function declaredCustomProperties(...sheets: readonly string[]): Set<string> {
  const declared = new Set<string>();
  for (const sheet of sheets) {
    for (const match of sheet.matchAll(/(^|[;{\s])(--[a-z0-9-]+)\s*:/gi)) declared.add(match[2]);
  }
  return declared;
}

/** Custom properties the stylesheet consumes with no fallback value. */
function requiredCustomProperties(sheet: string): Set<string> {
  const required = new Set<string>();
  for (const match of sheet.matchAll(/var\(\s*(--[a-z0-9-]+)\s*([,)])/gi)) {
    if (match[2] === ")") required.add(match[1]);
  }
  return required;
}

// Declared outside CSS: next/font publishes these on <body> from layout.tsx.
const EXTERNALLY_DECLARED = new Set(["--font-geist-sans", "--font-geist-mono"]);

test("D-006A: every custom property the stylesheet needs is declared by someone", () => {
  const declared = declaredCustomProperties(stylesheet, globals);
  const emitted = emittedCustomProperties(component);
  const orphans = [...requiredCustomProperties(stylesheet)].filter(
    (name) => !declared.has(name) && !emitted.has(name) && !EXTERNALLY_DECLARED.has(name),
  );
  assert.deepEqual(
    orphans,
    [],
    `the stylesheet reads custom properties nobody sets: ${orphans.join(", ")}`,
  );
});

test("D-006A: the pre-D-006A leaf geometry is gone from the stylesheet", () => {
  assert.doesNotMatch(stylesheet, /--leaf-y/, "--leaf-y collapsed every branch onto one line");
  assert.doesNotMatch(stylesheet, /--stem-height/, "--stem-height produced zero-height stems");
});

test("D-006A: the proof branch carries a real vertical extent and a growing stem", () => {
  assert.match(stylesheet, /top:\s*var\(--branch-top\)/);
  assert.match(stylesheet, /height:\s*var\(--branch-height\)/);
  assert.match(stylesheet, /transform:\s*scaleY\(var\(--stem-progress\)\)/);
  assert.match(stylesheet, /\.proof-leaf\[data-side="above"\]::before\s*\{\s*transform-origin:\s*bottom/);
  assert.match(stylesheet, /\.proof-leaf\[data-side="below"\]::before\s*\{\s*transform-origin:\s*top/);
  assert.match(component, /"--branch-top":/);
  assert.match(component, /"--branch-height":/);
  assert.match(component, /data-side=\{side\}/);
});

test("D-006A: every class the component emits has at least one rule", () => {
  const styled = new Set<string>();
  for (const match of (stylesheet + globals).matchAll(/\.([A-Za-z][\w-]*)/g)) styled.add(match[1]);
  const missing = [...emittedClassNames(component)].filter((token) => !styled.has(token));
  assert.deepEqual(missing, [], `unstyled classes reach the DOM: ${missing.join(", ")}`);
});

test("D-006A: no viewport-locked affine constants survive in the receipt path", () => {
  assert.doesNotMatch(component, /12\.5\s*\+\s*taxiLeft/, "receipt origin was calibrated for one viewport width");
  assert.doesNotMatch(component, /16\.875/, "receipt target was calibrated for one viewport width");
  assert.doesNotMatch(component, /73\.5/, "receipt target was calibrated for one viewport width");
  assert.doesNotMatch(component, /proofOverlayXForEvent/, "the second horizontal mapping must not come back");
  assert.match(stylesheet, /\.receipt-layer\s*\{[\s\S]*?left:\s*var\(--stage-label-w\)/);
});

test("D-006A: a receipt is aimed at its own branch, not at the branch family's row", () => {
  // D-006G: `treeYForEvent` derives the stagger from the event's position
  // within its own lane, so it no longer needs an index passed in. The
  // invariant is unchanged and still asserted — the receipt is aimed at the
  // leaf's own coordinates, not at its branch family's row.
  // P2R: the proof band is a projection of evidence objects, so a travelling
  // receipt now aims at the leaf of the evidence its event actually produced,
  // resolved through the master moment. The invariant is unchanged and in fact
  // stronger — the target is a real evidence identity, not a presentation row.
  assert.match(
    component,
    /target=\{\{\s*x:\s*proofLeafX\(binding\.timeMs\),\s*y:\s*receiptTargetY\(binding, proofRows\.rows\)\s*\}\}/,
    "the receipt target must be the leaf's own coordinates",
  );
  assert.match(component, /function receiptTargetY/);
  assert.match(component, /origin=\{receiptOrigin\(binding,\s*presentationMotion\.position\)\}/);
  assert.match(component, /rows\.get\(binding\.leafId\)/, "the target must resolve the bound evidence leaf id");
  assert.doesNotMatch(component, /return TREE_ROWS\[event\.branch\]/, "a missing target may not fall back to a family row");
  assert.match(component, /<div className="receipt-layer"/);
});

test("D-006A: every emitting actor resolves to a stage position", () => {
  for (const [domain, source] of [
    ["Passenger service", "exactProducer"],
    ["Taxi autonomy", "vehicle"],
    ["Traffic Provider", "exactProducer"],
    ["Navigation Provider A", "routingProvider"],
    ["Navigation Provider B", "routingProvider"],
    ["Garage", "garage"],
    ["Fleet operations", "exactProducer"],
    ["FINANCIAL_INSTITUTION", "bank"],
    ["ROUTING_ORCHESTRATOR", "routingProvider"],
    ["NETWORK", "networkSentinel"],
    ["FortiX causal compiler", "exactProducer"],
  ]) {
    assert.equal(receiptEmissionSourceForProducer(domain), source, `${domain} must resolve to ${source}`);
  }
  assert.equal(receiptEmissionSourceForProducer("UNMAPPED PRODUCER"), null,
    "an unknown producer cannot silently inherit Taxi 07 as its source");
  assert.match(component, /const source = receiptEmissionSource\(binding\)/,
    "flight origins and actor emission cues must share one canonical source resolver");
  assert.match(component, /source === "vehicle"\) return vehicleEmissionPoint\(vehiclePosition\)/,
    "mobile producer domains must resolve through the vehicle position");
  assert.match(component, /exactProducerEmissionPoint\(binding\.producerDomain\)/,
    "shared actor styling must still resolve a producer-specific flight coordinate");
  assert.doesNotMatch(component, /\?\? "vehicle"/,
    "an unmapped producer domain must never fall back to the vehicle");
  assert.match(component, /no visible receipt origin for canonical producer/,
    "unrepresented canonical producers must fail closed");
  assert.match(component, /data-producer-domain=\{actor\}/,
    "shared geometry must render the exact canonical producer identity, not a surrogate actor label");
  assert.match(component, /<span>\{actorLabels\[actor\] \?\? actor\}<\/span>/,
    "the visible receipt origin may localize its label but must fall back to the canonical producer");
});

test("D-006A: the presentation never goes quiet for long enough to lose the viewer", () => {
  const times = VISUAL_EVENTS.map((event) => event.timeMs);
  assert.ok(times.length >= 29, `expected the filled event table, saw ${times.length} events`);

  let worst = 0;
  let worstAfter = 0;
  for (let index = 1; index < times.length; index += 1) {
    const gap = presentationTimeForMasterTime(times[index]) - presentationTimeForMasterTime(times[index - 1]);
    if (gap > worst) {
      worst = gap;
      worstAfter = times[index - 1];
    }
  }
  assert.ok(
    worst <= 5_000,
    `${worst}ms of playback with no visible evidence after master ${worstAfter}ms`,
  );
});

test("D-006A: the third act runs without the viewer hunting for buttons", () => {
  assert.match(component, /REVELATION_STEP_MS/, "the revelation chain must advance on its own");
  assert.match(component, /scrollIntoView/, "maturity must bring the verifier into view");
  assert.match(component, /verdict-checks/, "the verdict must show the checks that passed");
  assert.match(stylesheet, /\.instrument-verdict\.verdict-indeterminate\s*\{[^}]*--fx-indeterminate/,
    "INDETERMINATE must not inherit the hazard colour");
});

test("D-006A: a denied approval explains itself instead of dead-ending", () => {
  assert.match(component, /className="authority-denied"/);
  assert.match(component, /\{d006c2\.completion\.noApproval\}/);
  assert.match(stylesheet, /\.authority-denied\s*\{/);
});

test("D-006A: the smart city acts before it emits", () => {
  assert.match(component, /function cityInfrastructureStepAt/);
  assert.match(component, /data-infra-step=\{infraStep\}/);
  assert.match(stylesheet, /\[data-infra-step="scanning"\]/);
  assert.match(stylesheet, /\[data-infra-step="deciding"\]/);
  // D-006G renamed the city's final step from "granting" to "publishing":
  // the infrastructure publishes its own phase and grants nothing to any
  // vehicle. Asserting every emitted step is styled, not just that some
  // string is present — the component emitting a value the stylesheet does
  // not know is exactly the drift this file exists to catch.
  assert.match(stylesheet, /\[data-infra-step="publishing"\]/);
  assert.doesNotMatch(stylesheet, /data-infra-step="granting"/,
    "the retired step must not linger as dead styling");
  const steps = component.slice(component.indexOf("function cityInfrastructureStepAt"));
  for (const step of ["scanning", "deciding", "publishing"]) {
    assert.ok(steps.includes(`"${step}"`), `${step} must be a real returned step`);
    assert.match(stylesheet, new RegExp(`\\[data-infra-step="${step}"\\]`));
  }
});

test("D-006A: the vehicle sprite faces the direction it travels", () => {
  assert.match(component, /"--taxi-facing":/);
  assert.match(stylesheet, /scaleX\(var\(--taxi-facing/);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { deriveHarmonyState, narrativeFocusFor } from "../app/harmony.ts";
import { INTERACTION_ANCHORS, derivePhysicalState } from "../app/physicalState.ts";

test("the harmony model exposes all six synchronized dimensions", () => {
  const state = deriveHarmonyState(74_000, "APPROVED");
  assert.deepEqual(Object.keys(state.dimensions), ["spatial", "temporal", "mission", "authority", "proof", "narrative"]);
  assert.equal(state.coherent, true);
  assert.deepEqual(state.violations, []);
});

test("pickup, drop-off, garage, and base use exact presentation anchors", () => {
  const anchors = [
    [17_000, "PASSENGER_PICKUP_ANCHOR"],
    [33_000, "PASSENGER_DROPOFF_ANCHOR"],
    [62_000, "GARAGE_SERVICE_ANCHOR"],
    [112_000, "BASE_PARKING_ANCHOR"],
  ] as const;
  for (const [time, anchor] of anchors) {
    const physical = derivePhysicalState(time);
    assert.equal(physical.visualPosition, INTERACTION_ANCHORS[anchor]);
    assert.equal(physical.alignedAnchor, anchor);
    assert.equal(physical.speedKph, 0);
  }
});

test("canonical master moments remain cross-layer coherent", () => {
  const times = [0, 9_000, 17_000, 18_000, 24_000, 33_000, 34_000, 36_000, 38_000, 46_000, 48_000, 51_000, 52_000, 54_000, 62_000, 68_000, 72_000, 74_000, 78_000, 82_000, 84_000, 84_250, 85_000, 85_250, 86_000, 88_000, 92_000, 96_000, 98_000, 104_000, 108_000, 112_000, 114_000, 120_000];
  for (const time of times) {
    const decision = time < 85_000 ? "PENDING" : "APPROVED";
    const harmony = deriveHarmonyState(time, decision);
    assert.equal(harmony.coherent, true, `${time}: ${harmony.violations.join(", ")}`);
  }
});

test("proof consolidation follows physical and mission completion", () => {
  assert.equal(deriveHarmonyState(35_999, "PENDING").dimensions.proof.receiptCount, 0);
  assert.equal(deriveHarmonyState(36_000, "PENDING").dimensions.proof.receiptCount, 1);
  assert.equal(deriveHarmonyState(77_999, "PENDING").dimensions.proof.receiptCount, 2);
  assert.equal(deriveHarmonyState(80_000, "PENDING").dimensions.proof.receiptCount, 3);
  assert.equal(deriveHarmonyState(89_999, "APPROVED").dimensions.proof.receiptCount, 3);
  assert.equal(deriveHarmonyState(90_000, "APPROVED").dimensions.proof.receiptCount, 4);
  assert.equal(deriveHarmonyState(113_999, "APPROVED").dimensions.proof.receiptCount, 4);
  assert.equal(deriveHarmonyState(114_000, "APPROVED").dimensions.proof.receiptCount, 5);
  assert.equal(deriveHarmonyState(119_999, "APPROVED").dimensions.proof.cycleReceiptAvailable, false);
  assert.equal(deriveHarmonyState(120_000, "APPROVED").dimensions.proof.cycleReceiptAvailable, true);
});

test("narrative focus presents one dominant idea without deleting depth", () => {
  assert.equal(narrativeFocusFor("passenger-pickup"), "REALITY");
  assert.equal(narrativeFocusFor("eta-at-risk"), "SYSTEM");
  assert.equal(narrativeFocusFor("payment-result"), "PROOF");
  const component = readFileSync(new URL("../app/OperationalCycleTable.tsx", import.meta.url), "utf8");
  assert.match(component, /data-dominant-focus/);
  assert.match(component, /scale === "OVERVIEW" && !evidenceExpanded/);
  assert.match(component, /evidenceExpanded &&/);
});

test("same masterTime and branch reconstruct identical harmony without clocks", () => {
  const source = readFileSync(new URL("../app/harmony.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /Date\.now|new Date|performance\.now|Math\.random|setTimeout|setInterval|requestAnimationFrame/);
  const direct = deriveHarmonyState(52_000, "APPROVED");
  deriveHarmonyState(120_000, "APPROVED");
  assert.deepEqual(deriveHarmonyState(52_000, "APPROVED"), direct);
});

test("D-005H natural traffic language stays bilingual and presentation-only", () => {
  const english = readFileSync(new URL("../../../site/src/i18n/locales/en.ts", import.meta.url), "utf8");
  const french = readFileSync(new URL("../../../site/src/i18n/locales/fr.ts", import.meta.url), "utf8");
  const component = readFileSync(new URL("../app/OperationalCycleTable.tsx", import.meta.url), "utf8");
  assert.match(english, /slowdown: "Unexpected slowdown"/);
  assert.match(english, /arrivalDelayed: "Garage arrival delayed"/);
  assert.match(english, /routeSearch: "Looking for another route"/);
  assert.match(english, /routeAuthorized: "New route authorized"/);
  assert.match(french, /slowdown: "Ralentissements imprévus"/);
  assert.match(french, /arrivalDelayed: "Arrivée au garage retardée"/);
  assert.match(french, /routeSearch: "Un autre itinéraire est recherché"/);
  assert.match(french, /routeAuthorized: "Nouvel itinéraire autorisé"/);
  assert.match(component, /realityNarrativeLabel\(masterTime, physicalLabel, t\.d005h\)/);
  assert.match(component, /return copy\.slowdown/);
  assert.match(component, /return copy\.routeAuthorized/);
  assert.doesNotMatch(component, /Traffic congestion|Congestion detected/);
});

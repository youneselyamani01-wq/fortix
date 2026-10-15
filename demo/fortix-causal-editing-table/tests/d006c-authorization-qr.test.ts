import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { VISUAL_EVENTS } from "../app/visualEvents.ts";

const component = readFileSync(new URL("../app/ConvergenceExperience.tsx", import.meta.url), "utf8");
const stylesheet = readFileSync(new URL("../app/convergence.css", import.meta.url), "utf8");

/**
 * C2 removes the simulated request mark. It was not an authorization channel
 * and made a local human decision look like a remote security ceremony. The
 * real boundary is the amount, autonomous limit, human act, and resulting
 * authority evidence.
 */

test("C2: the active authority boundary contains no simulated code or security theatre", () => {
  assert.doesNotMatch(
    component,
    /authorizationQr|authorization-qr|authorization-request|simulatedQrMatrix|AUTHORIZATION_QR_MODULE_PX/,
  );
  assert.doesNotMatch(stylesheet, /authorization-(?:qr|request)|\bqr\b/i);
  assert.doesNotMatch(component, /shield|padlock/i);
});

test("C2: the authority boundary presents the exact decision without a surrogate channel", () => {
  const gate = component.slice(component.indexOf('className="human-decision-instrument authority-workspace"'));
  const aside = gate.slice(0, gate.indexOf("</aside>"));

  assert.match(aside, /\{copy\.question\}/);
  assert.match(aside, /\{copy\.requestedAmount\}/);
  assert.match(aside, /\{copy\.limitAmount\}/);
  assert.match(aside, /\{copy\.localEvidence\}/);
  assert.match(aside, /\{copy\.noSettlement\}/);
  assert.match(aside, /onDecision\("APPROVED"\)/);
  assert.match(aside, /onDecision\("DENIED"\)/);
  assert.match(aside, /\{copy\.allow\}<\/button>/);
  assert.match(aside, /\{copy\.deny\}<\/button>/);
  assert.equal(aside.match(/<button\b/g)?.length, 2, "only the two human decisions belong in the boundary");
});

test("C2: approval remains the act that produces canonical authority evidence", () => {
  const human = VISUAL_EVENTS.filter((event) => event.receiptKind === "human");
  assert.ok(human.length > 0, "the authority receipt must exist in the canonical events");
  assert.ok(human.some((event) => event.receipt === "Authorization Receipt"));
  assert.match(component, /onDecision\("APPROVED"\)/);
});

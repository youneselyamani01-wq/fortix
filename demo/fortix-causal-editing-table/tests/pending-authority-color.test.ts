import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const stylesheet = readFileSync(new URL("../app/convergence.css", import.meta.url), "utf8");

test("pending authority has a dedicated warmer orange while hazard tangerine stays canonical", () => {
  assert.match(stylesheet, /--fx-tangerine:\s*#ff7a45/i);
  assert.match(stylesheet, /--fx-pending-authority:\s*#ff941f/i);
  assert.match(stylesheet, /--fx-pending-authority-ink:\s*#a94700/i);
  assert.notEqual("#ff941f", "#ff7a45");
});

test("pending authority text keeps AA contrast on the paper surface", () => {
  assert.ok(contrast("#a94700", "#fffdf8") >= 4.5);
  assert.ok(contrast("#ff941f", "#17181c") >= 4.5);
});

function contrast(first: string, second: string): number {
  const a = luminance(first);
  const b = luminance(second);
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
}

function luminance(hex: string): number {
  const channels = hex.slice(1).match(/../g)?.map((channel) => Number.parseInt(channel, 16) / 255) ?? [];
  const linear = channels.map((channel) => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4);
  return .2126 * linear[0] + .7152 * linear[1] + .0722 * linear[2];
}

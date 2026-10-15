import assert from "node:assert/strict";
import test from "node:test";

import {
  chooseProofLabelSides,
  intersectionArea,
  type LabelPlacementCandidate,
  type Rect,
} from "../app/proofLabelPlacement.ts";

const canvas: Rect = { left: 0, top: 0, right: 300, bottom: 120 };

function label(id: string, anchorX: number, top: number, width = 80): LabelPlacementCandidate {
  return {
    id,
    anchorBounds: { left: anchorX - 2, top, right: anchorX + 2, bottom: top + 8 },
    left: { left: anchorX - 3 - width, top, right: anchorX - 3, bottom: top + 20 },
    right: { left: anchorX + 3, top, right: anchorX + 3 + width, bottom: top + 20 },
  };
}

test("proof labels retain the causal rightward reading when geometry is clear", () => {
  const sides = chooseProofLabelSides({ canvasBounds: canvas, exclusionBounds: [], labels: [label("safe", 80, 20)] });
  assert.equal(sides.safe, "right");
});

test("flower exclusion and canvas bounds force a measured left placement", () => {
  const flower = { left: 220, top: 0, right: 300, bottom: 120 };
  const sides = chooseProofLabelSides({ canvasBounds: canvas, exclusionBounds: [flower], labels: [label("late", 200, 20)] });
  assert.equal(sides.late, "left");
});

test("the global choice avoids label collisions that a per-label threshold misses", () => {
  const labels = [label("first", 100, 30), label("second", 170, 30)];
  const sides = chooseProofLabelSides({ canvasBounds: canvas, exclusionBounds: [], labels });
  const placed = labels.map((candidate) => candidate[sides[candidate.id]]);
  assert.equal(intersectionArea(placed[0], placed[1]), 0);
});


export type Rect = Readonly<{
  left: number;
  top: number;
  right: number;
  bottom: number;
}>;

export type LabelSide = "left" | "right";

export type LabelPlacementCandidate = Readonly<{
  id: string;
  anchorBounds: Rect;
  left: Rect;
  right: Rect;
}>;

export type LabelPlacementProblem = Readonly<{
  canvasBounds: Rect;
  exclusionBounds: readonly Rect[];
  labels: readonly LabelPlacementCandidate[];
}>;

const OVERFLOW_WEIGHT = 1_000_000;
const EXCLUSION_WEIGHT = 100_000;
const LABEL_COLLISION_WEIGHT = 10_000;
const ANCHOR_COLLISION_WEIGHT = 100;

/**
 * Nine featured labels means only 512 left/right combinations. Evaluating the
 * complete set avoids order-dependent greedy choices and lets real geometry,
 * rather than a breakpoint or timeline percentage, govern the layout.
 */
export function chooseProofLabelSides(problem: LabelPlacementProblem): Readonly<Record<string, LabelSide>> {
  const { labels } = problem;
  if (labels.length > 20) throw new RangeError("Proof-label optimizer is bounded to 20 labels");

  let bestMask = 0;
  let bestScore = Number.POSITIVE_INFINITY;
  const combinations = 2 ** labels.length;

  for (let mask = 0; mask < combinations; mask += 1) {
    const rectangles = labels.map((label, index) => ((mask & (1 << index)) === 0 ? label.right : label.left));
    let score = 0;

    for (let index = 0; index < rectangles.length; index += 1) {
      const rectangle = rectangles[index];
      score += overflowArea(rectangle, problem.canvasBounds) * OVERFLOW_WEIGHT;
      for (const exclusion of problem.exclusionBounds) {
        score += intersectionArea(rectangle, exclusion) * EXCLUSION_WEIGHT;
      }
      for (let anchorIndex = 0; anchorIndex < labels.length; anchorIndex += 1) {
        if (anchorIndex === index) continue;
        score += intersectionArea(rectangle, labels[anchorIndex].anchorBounds) * ANCHOR_COLLISION_WEIGHT;
      }
      for (let otherIndex = 0; otherIndex < index; otherIndex += 1) {
        score += intersectionArea(rectangle, rectangles[otherIndex]) * LABEL_COLLISION_WEIGHT;
      }
      // Preserve the causal left-to-right reading when both sides are equally safe.
      if ((mask & (1 << index)) !== 0) score += 1;
    }

    if (score < bestScore) {
      bestScore = score;
      bestMask = mask;
    }
  }

  return Object.fromEntries(labels.map((label, index) => [
    label.id,
    (bestMask & (1 << index)) === 0 ? "right" : "left",
  ]));
}

export function intersectionArea(a: Rect, b: Rect): number {
  return Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left))
    * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
}

function overflowArea(rectangle: Rect, canvas: Rect): number {
  const width = Math.max(0, rectangle.right - rectangle.left);
  const height = Math.max(0, rectangle.bottom - rectangle.top);
  const insideWidth = Math.max(0, Math.min(rectangle.right, canvas.right) - Math.max(rectangle.left, canvas.left));
  const insideHeight = Math.max(0, Math.min(rectangle.bottom, canvas.bottom) - Math.max(rectangle.top, canvas.top));
  return width * height - insideWidth * insideHeight;
}

/** Geometry for the light examination field inside the dark verifier. */

export type InspectionFamily = "mission" | "vehicle" | "infrastructure" | "service" | "human" | "financial";

export type InspectionRect = Readonly<{
  left: number;
  top: number;
  width: number;
  height: number;
}>;

export type InspectionLabel = Readonly<{
  family: InspectionFamily;
  box: InspectionRect;
}>;

export type VerifierInspectionLayout = Readonly<{
  field: InspectionRect;
  flower: InspectionRect;
  receiptCenter: InspectionRect;
  labels: readonly InspectionLabel[];
}>;

export const VERIFIER_FIELD_WIDTH_PX = 608;
export const VERIFIER_FIELD_HEIGHT_PX = 236;
export const VERIFIER_FLOWER_SIZE_PX = 208;
export const VERIFIER_RECEIPT_SIZE_PX = 66;
export const VERIFIER_LABEL_WIDTH_PX = 92;
export const VERIFIER_LABEL_HEIGHT_PX = 20;
export const VERIFIER_FIELD_TOP_RADIUS_PX = 32;
export const VERIFIER_FIELD_BOTTOM_RADIUS_PX = 18;
export const INSERTION_TARGET_MARGIN_PX = 12;
export const VERIFIER_NARROW_BREAKPOINT_PX = 432;
export const VERIFIER_NARROW_MIN_HEIGHT_PX = 280;

/**
 * Six fixed inspection rails flank the unchanged 208px flower. At the
 * validated 660px workbench all three target viewports resolve to the same
 * 608x236 chamber interior, so the geometry is identical at 1600/1280/900.
 */
export function verifierInspectionLayout(
  width: number = VERIFIER_FIELD_WIDTH_PX,
  height: number = VERIFIER_FIELD_HEIGHT_PX,
): VerifierInspectionLayout {
  const narrow = width < VERIFIER_NARROW_BREAKPOINT_PX;
  if (width < VERIFIER_FLOWER_SIZE_PX
    || height < (narrow ? VERIFIER_NARROW_MIN_HEIGHT_PX : VERIFIER_FLOWER_SIZE_PX)) {
    throw new RangeError("Verifier inspection field cannot contain the Evidence Flower");
  }
  const flower = centeredRect(width, height, VERIFIER_FLOWER_SIZE_PX, VERIFIER_FLOWER_SIZE_PX);
  const receiptCenter = centeredRect(width, height, VERIFIER_RECEIPT_SIZE_PX, VERIFIER_RECEIPT_SIZE_PX);
  if (narrow) {
    const inset = 10;
    const gap = 4;
    const labelWidth = Math.min(
      VERIFIER_LABEL_WIDTH_PX,
      (width - inset * 2 - gap * 2) / 3,
    );
    const x = (column: number) => inset + column * (labelWidth + gap);
    const top = 10;
    const bottom = height - 10 - VERIFIER_LABEL_HEIGHT_PX;
    const box = (column: number, y: number): InspectionRect => ({
      left: x(column),
      top: y,
      width: labelWidth,
      height: VERIFIER_LABEL_HEIGHT_PX,
    });
    return {
      field: { left: 0, top: 0, width, height },
      flower,
      receiptCenter,
      labels: [
        { family: "financial", box: box(0, top) },
        { family: "human", box: box(1, top) },
        { family: "service", box: box(2, top) },
        { family: "mission", box: box(0, bottom) },
        { family: "vehicle", box: box(1, bottom) },
        { family: "infrastructure", box: box(2, bottom) },
      ],
    };
  }
  const left = 20;
  const right = width - 20 - VERIFIER_LABEL_WIDTH_PX;
  const top = 20;
  const middle = (height - VERIFIER_LABEL_HEIGHT_PX) / 2;
  const bottom = height - 20 - VERIFIER_LABEL_HEIGHT_PX;
  const box = (x: number, y: number): InspectionRect => ({
    left: x,
    top: y,
    width: VERIFIER_LABEL_WIDTH_PX,
    height: VERIFIER_LABEL_HEIGHT_PX,
  });
  return {
    field: { left: 0, top: 0, width, height },
    flower,
    receiptCenter,
    labels: [
      { family: "financial", box: box(left, top) },
      { family: "human", box: box(left, middle) },
      { family: "service", box: box(left, bottom) },
      { family: "mission", box: box(right, top) },
      { family: "vehicle", box: box(right, middle) },
      { family: "infrastructure", box: box(right, bottom) },
    ],
  };
}

export function rectanglesOverlap(left: InspectionRect, right: InspectionRect): boolean {
  return left.left < right.left + right.width
    && left.left + left.width > right.left
    && left.top < right.top + right.height
    && left.top + left.height > right.top;
}

export function containsRect(container: InspectionRect, subject: InspectionRect): boolean {
  return subject.left >= container.left
    && subject.top >= container.top
    && subject.left + subject.width <= container.left + container.width
    && subject.top + subject.height <= container.top + container.height;
}

/**
 * Rectangular containment is insufficient for the examination field: its
 * rounded chamber clips the corner rails. Check every subject corner against
 * the exact top and bottom radii used by the light-state CSS.
 */
export function containsRoundedRect(
  container: InspectionRect,
  subject: InspectionRect,
  topRadius: number = VERIFIER_FIELD_TOP_RADIUS_PX,
  bottomRadius: number = VERIFIER_FIELD_BOTTOM_RADIUS_PX,
): boolean {
  if (!containsRect(container, subject)) return false;
  const corners = [
    { x: subject.left, y: subject.top },
    { x: subject.left + subject.width, y: subject.top },
    { x: subject.left, y: subject.top + subject.height },
    { x: subject.left + subject.width, y: subject.top + subject.height },
  ];
  return corners.every((point) => pointWithinRoundedRect(container, point.x, point.y, topRadius, bottomRadius));
}

export function pointWithinInsertionTarget(
  clientX: number,
  clientY: number,
  target: Pick<DOMRect, "left" | "right" | "top" | "bottom">,
  margin: number = INSERTION_TARGET_MARGIN_PX,
): boolean {
  return clientX >= target.left - margin
    && clientX <= target.right + margin
    && clientY >= target.top - margin
    && clientY <= target.bottom + margin;
}

export function contrastRatio(foreground: string, background: string): number {
  const bright = relativeLuminance(foreground);
  const dark = relativeLuminance(background);
  return (Math.max(bright, dark) + 0.05) / (Math.min(bright, dark) + 0.05);
}

function centeredRect(width: number, height: number, boxWidth: number, boxHeight: number): InspectionRect {
  return {
    left: (width - boxWidth) / 2,
    top: (height - boxHeight) / 2,
    width: boxWidth,
    height: boxHeight,
  };
}

function pointWithinRoundedRect(
  container: InspectionRect,
  x: number,
  y: number,
  requestedTopRadius: number,
  requestedBottomRadius: number,
): boolean {
  const right = container.left + container.width;
  const bottom = container.top + container.height;
  if (x < container.left || x > right || y < container.top || y > bottom) return false;
  const maximumRadius = Math.min(container.width, container.height) / 2;
  const topRadius = Math.min(maximumRadius, Math.max(0, requestedTopRadius));
  const bottomRadius = Math.min(maximumRadius, Math.max(0, requestedBottomRadius));
  const insideCircle = (centerX: number, centerY: number, radius: number) => (
    (x - centerX) ** 2 + (y - centerY) ** 2 <= radius ** 2
  );
  if (x < container.left + topRadius && y < container.top + topRadius) {
    return insideCircle(container.left + topRadius, container.top + topRadius, topRadius);
  }
  if (x > right - topRadius && y < container.top + topRadius) {
    return insideCircle(right - topRadius, container.top + topRadius, topRadius);
  }
  if (x < container.left + bottomRadius && y > bottom - bottomRadius) {
    return insideCircle(container.left + bottomRadius, bottom - bottomRadius, bottomRadius);
  }
  if (x > right - bottomRadius && y > bottom - bottomRadius) {
    return insideCircle(right - bottomRadius, bottom - bottomRadius, bottomRadius);
  }
  return true;
}

function relativeLuminance(hex: string): number {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new TypeError(`Expected a six-digit hex color, received ${hex}`);
  const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const [red, green, blue] = channels.map((channel) => (
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  ));
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}

import { useEffect, useRef, useState, type RefObject } from "react";
import { clamp } from "../lib/math";

/** Read the existing narrative order at the actual text positions. Unequal
 * translated/wrapped beat heights must not move a stage to another paragraph. */
export function progressAtBeatCenters(centers: readonly number[], readingLine: number): number {
  if (centers.length < 2 || readingLine <= centers[0]!) return 0;
  const last = centers.length - 1;
  if (readingLine >= centers[last]!) return 1;
  for (let index = 1; index <= last; index += 1) {
    if (readingLine > centers[index]!) continue;
    const span = centers[index]! - centers[index - 1]!;
    return clamp((index - 1 + (span > 0 ? (readingLine - centers[index - 1]!) / span : 0)) / last, 0, 1);
  }
  return 0;
}

/** Native scroll only. The reading line is beside the desktop scene and below
 * the mobile scene. Dynamic browser chrome, wrapped text and lazy canvas
 * mounting can resize that space without a window scroll event. */
export function useScrollProgress(
  ref: RefObject<HTMLElement | null>,
  visualRef: RefObject<HTMLElement | null>,
): number {
  const [progress, setProgress] = useState(0);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    const node = ref.current;
    const visual = visualRef.current;
    if (!node || !visual) return undefined;
    const beats = [...node.querySelectorAll<HTMLElement>("[data-journey-beat]")];
    const viewport = window.visualViewport;

    const compute = () => {
      frame.current = null;
      if (document.hidden) return;
      const visualRect = visual.getBoundingClientRect();
      const viewportTop = viewport?.offsetTop ?? 0;
      const viewportBottom = viewportTop + (viewport?.height ?? window.innerHeight);
      const stacked = getComputedStyle(node).getPropertyValue("--journey-stacked").trim() === "1";
      const readingLine = stacked
        ? Math.min(viewportBottom, visualRect.bottom) + Math.max(0, viewportBottom - visualRect.bottom) / 2
        : Math.max(viewportTop, visualRect.top) + Math.min(visualRect.height, viewportBottom - Math.max(viewportTop, visualRect.top)) / 2;
      const centers = beats.map((beat) => { const rect = beat.getBoundingClientRect(); return rect.top + rect.height / 2; });
      setProgress(progressAtBeatCenters(centers, readingLine));
    };
    const requestCompute = () => {
      if (frame.current == null) frame.current = requestAnimationFrame(compute);
    };
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(requestCompute);
    resizeObserver?.observe(node);
    resizeObserver?.observe(visual);
    for (const beat of beats) resizeObserver?.observe(beat);
    compute();
    window.addEventListener("scroll", requestCompute, { passive: true });
    window.addEventListener("resize", requestCompute);
    viewport?.addEventListener("resize", requestCompute);
    viewport?.addEventListener("scroll", requestCompute, { passive: true });
    document.addEventListener("visibilitychange", requestCompute);

    return () => {
      window.removeEventListener("scroll", requestCompute);
      window.removeEventListener("resize", requestCompute);
      viewport?.removeEventListener("resize", requestCompute);
      viewport?.removeEventListener("scroll", requestCompute);
      document.removeEventListener("visibilitychange", requestCompute);
      resizeObserver?.disconnect();
      if (frame.current != null) { cancelAnimationFrame(frame.current); frame.current = null; }
    };
  }, [ref, visualRef]);
  return progress;
}

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { progressAtBeatCenters, useScrollProgress } from "../src/hooks/useScrollProgress";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("cinematic narrative scroll alignment", () => {
  it("reaches every existing stage at its paragraph center despite unequal translated text heights", () => {
    const centers = [150, 425, 810, 1_080, 1_600, 1_920, 2_250];
    centers.forEach((center, index) => expect(progressAtBeatCenters(centers, center)).toBeCloseTo(index / 6));
    expect(progressAtBeatCenters(centers, (centers[3]! + centers[4]!) / 2)).toBeCloseTo(3.5 / 6);
    expect(progressAtBeatCenters(centers, -100)).toBe(0);
    expect(progressAtBeatCenters(centers, 4_000)).toBe(1);
    expect(progressAtBeatCenters([], 300)).toBe(0);
  });

  it("can travel backward and stays aligned when the whole document shifts", () => {
    const centers = [100, 500, 900];
    expect(progressAtBeatCenters(centers, 900)).toBe(1);
    expect(progressAtBeatCenters(centers, 300)).toBe(.25);
    expect(progressAtBeatCenters(centers.map(center => center - 450), -150)).toBe(.25);
  });

  it("recomputes after mobile visual-viewport changes and canvas/text resize, without requiring scroll", () => {
    vi.useFakeTimers();
    vi.spyOn(window, "requestAnimationFrame").mockImplementation(callback => window.setTimeout(() => callback(0), 0));
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(id => window.clearTimeout(id));
    const viewport = new EventTarget() as EventTarget & { height: number; offsetTop: number };
    viewport.height = 844; viewport.offsetTop = 0;
    vi.stubGlobal("visualViewport", viewport);
    let resize: (() => void) | undefined;
    const disconnect = vi.fn();
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: () => void) { resize = callback; }
      observe() {}
      disconnect = disconnect;
    });
    const track = document.createElement("div"); track.style.setProperty("--journey-stacked", "1");
    const visual = document.createElement("div");
    let visualHeight = 376;
    vi.spyOn(visual, "getBoundingClientRect").mockImplementation(() => ({ top: 72, bottom: 72 + visualHeight, height: visualHeight }) as DOMRect);
    for (const center of [200, 600, 1_000]) {
      const beat = document.createElement("li"); beat.dataset.journeyBeat = "";
      vi.spyOn(beat, "getBoundingClientRect").mockImplementation(() => ({ top: center - 100, height: 200 }) as DOMRect);
      track.append(beat);
    }
    const trackRef = { current: track }; const visualRef = { current: visual };
    const { result, unmount } = renderHook(() => useScrollProgress(trackRef, visualRef));
    expect(result.current).toBeCloseTo(progressAtBeatCenters([200, 600, 1_000], 646));
    act(() => { viewport.height = 644; viewport.dispatchEvent(new Event("resize")); vi.runOnlyPendingTimers(); });
    expect(result.current).toBeCloseTo(progressAtBeatCenters([200, 600, 1_000], 546));
    act(() => { visualHeight = 300; resize?.(); vi.runOnlyPendingTimers(); });
    expect(result.current).toBeCloseTo(progressAtBeatCenters([200, 600, 1_000], 508));
    unmount(); expect(disconnect).toHaveBeenCalledOnce();
    act(() => { viewport.dispatchEvent(new Event("resize")); });
    expect(vi.getTimerCount()).toBe(0);
  });
});

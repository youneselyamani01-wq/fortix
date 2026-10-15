import { useState } from "react";

type Support = "supported" | "unsupported";

function probeWebgl(): boolean {
  if (typeof document === "undefined") {
    return false;
  }
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    return Boolean(gl);
  } catch {
    return false;
  }
}

/**
 * One-time WebGL feature probe. This app is client-rendered only (no SSR),
 * so the check can run synchronously in the initial state instead of an
 * effect — it reads a browser capability, not layout, so there is nothing
 * to defer until after paint, and doing it this way avoids an extra render
 * pass (and the flash of fallback content that render pass would cause on
 * WebGL-capable browsers).
 */
export function useWebglSupport(): Support {
  const [support] = useState<Support>(() => (probeWebgl() ? "supported" : "unsupported"));
  return support;
}

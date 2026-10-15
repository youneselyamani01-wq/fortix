/** Clamp a value between a minimum and maximum. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Linear interpolation between a and b by t (not clamped). */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Frame-rate independent exponential damping, matching the smoothing feel
 * used across the cinematic scene's camera and instanced-node motion.
 * `lambda` is the smoothing speed (higher = snappier); `dt` is seconds
 * elapsed since the previous frame.
 */
export function damp(current: number, target: number, lambda: number, dt: number): number {
  return lerp(current, target, 1 - Math.exp(-lambda * dt));
}

/** True once `current` is close enough to `target` that damping can stop. */
export function isSettled(current: number, target: number, epsilon = 0.0005): boolean {
  return Math.abs(current - target) < epsilon;
}

/** Maps t from [0,1] onto a smooth ease-in-out curve (no bounce). */
export function easeInOutCubic(t: number): number {
  const x = clamp(t, 0, 1);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

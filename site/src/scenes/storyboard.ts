import type { Verdict } from "../i18n/protocol";

export type Vec3 = readonly [number, number, number];

export interface StoryboardKeyframe {
  /** Human-readable state name, matches DESIGN-DIRECTION.md §5. */
  name: string;
  cameraPosition: Vec3;
  cameraLookAt: Vec3;
  /** 0 = evidence nodes collapsed at the core, 1 = fully orbiting in context. */
  nodesSpread: number;
  /** Opacity of the nine evidence nodes (identity, action, decision…). */
  nodesOpacity: number;
  /** Opacity of the large enclosing shell representing the originating system. */
  originShellOpacity: number;
  /** Opacity/scale of the sealed receipt slab. */
  slabOpacity: number;
  slabScale: number;
  /** Lateral travel distance of the slab away from the origin shell. */
  slabOffsetX: number;
  /** Opacity of the inspection ticks that ring the slab during verification. */
  ticksOpacity: number;
  /** Set only on the verdict keyframe; null everywhere else. */
  verdict: Verdict | null;
}

/**
 * Seven narrative states — see DESIGN-DIRECTION.md §5 for the storyboard
 * table this mirrors: Action, Context, Sealing, Separation, Verification,
 * Verdict, Resolution.
 */
export const STORYBOARD: StoryboardKeyframe[] = [
  {
    name: "action",
    cameraPosition: [0, 0, 4.4],
    cameraLookAt: [0, 0, 0],
    nodesSpread: 0,
    nodesOpacity: 0,
    originShellOpacity: 0,
    slabOpacity: 0,
    slabScale: 0.2,
    slabOffsetX: 0,
    ticksOpacity: 0,
    verdict: null,
  },
  {
    name: "context",
    cameraPosition: [0.4, 0.5, 7.4],
    cameraLookAt: [0, 0, 0],
    nodesSpread: 1,
    nodesOpacity: 1,
    originShellOpacity: 0.55,
    slabOpacity: 0,
    slabScale: 0.2,
    slabOffsetX: 0,
    ticksOpacity: 0,
    verdict: null,
  },
  {
    name: "sealing",
    cameraPosition: [0.9, 0.35, 5.6],
    cameraLookAt: [0, 0, 0],
    nodesSpread: 0.12,
    nodesOpacity: 0.5,
    originShellOpacity: 0.75,
    slabOpacity: 0.9,
    slabScale: 0.85,
    slabOffsetX: 0,
    ticksOpacity: 0,
    verdict: null,
  },
  {
    name: "separation",
    cameraPosition: [3.4, 0.55, 6.4],
    cameraLookAt: [1.6, 0, 0],
    nodesSpread: 0,
    nodesOpacity: 0,
    originShellOpacity: 0.12,
    slabOpacity: 1,
    slabScale: 1,
    slabOffsetX: 3.1,
    ticksOpacity: 0,
    verdict: null,
  },
  {
    name: "verification",
    cameraPosition: [4.6, 0.3, 5.4],
    cameraLookAt: [3.6, 0, 0],
    nodesSpread: 0,
    nodesOpacity: 0,
    originShellOpacity: 0,
    slabOpacity: 1,
    slabScale: 1,
    slabOffsetX: 3.6,
    ticksOpacity: 1,
    verdict: null,
  },
  {
    name: "verdict",
    cameraPosition: [4.2, 0.2, 4.8],
    cameraLookAt: [3.6, 0, 0],
    nodesSpread: 0,
    nodesOpacity: 0,
    originShellOpacity: 0,
    slabOpacity: 1,
    slabScale: 1.06,
    slabOffsetX: 3.6,
    ticksOpacity: 1,
    verdict: "VALID",
  },
  {
    name: "resolution",
    cameraPosition: [3.2, 0.9, 7.2],
    cameraLookAt: [3.6, 0, 0],
    nodesSpread: 0,
    nodesOpacity: 0,
    originShellOpacity: 0,
    slabOpacity: 1,
    slabScale: 1,
    slabOffsetX: 3.6,
    ticksOpacity: 0.4,
    verdict: "VALID",
  },
];

function lerpVec3(a: Vec3, b: Vec3, t: number): Vec3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export interface SampledStoryboard extends Omit<StoryboardKeyframe, "name" | "verdict"> {
  stateIndex: number;
  verdict: Verdict | null;
}

/** Samples a continuous 0..1 progress value across the seven keyframes. */
export function sampleStoryboard(progress: number): SampledStoryboard {
  const clamped = Math.min(1, Math.max(0, progress));
  const segments = STORYBOARD.length - 1;
  const scaled = clamped * segments;
  const index = Math.min(segments - 1, Math.floor(scaled));
  const from = STORYBOARD[index]!;
  const to = STORYBOARD[index + 1]!;
  const t = scaled - index;

  return {
    stateIndex: Math.round(scaled),
    cameraPosition: lerpVec3(from.cameraPosition, to.cameraPosition, t),
    cameraLookAt: lerpVec3(from.cameraLookAt, to.cameraLookAt, t),
    nodesSpread: from.nodesSpread + (to.nodesSpread - from.nodesSpread) * t,
    nodesOpacity: from.nodesOpacity + (to.nodesOpacity - from.nodesOpacity) * t,
    originShellOpacity: from.originShellOpacity + (to.originShellOpacity - from.originShellOpacity) * t,
    slabOpacity: from.slabOpacity + (to.slabOpacity - from.slabOpacity) * t,
    slabScale: from.slabScale + (to.slabScale - from.slabScale) * t,
    slabOffsetX: from.slabOffsetX + (to.slabOffsetX - from.slabOffsetX) * t,
    ticksOpacity: from.ticksOpacity + (to.ticksOpacity - from.ticksOpacity) * t,
    verdict: t < 0.5 ? from.verdict : to.verdict,
  };
}

/** Nine evidence-node labels, in the order they appear around the core. */
export const EVIDENCE_NODE_KEYS = [
  "identity",
  "action",
  "decision",
  "policy",
  "approval",
  "timestamp",
  "key",
  "runtime",
  "artifact",
] as const;

/** Even distribution on a sphere via the golden-angle spiral. */
export function orbitPosition(index: number, total: number, radius: number): Vec3 {
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const y = 1 - (index / (total - 1)) * 2;
  const radiusAtY = Math.sqrt(1 - y * y);
  const theta = goldenAngle * index;
  return [Math.cos(theta) * radiusAtY * radius, y * radius * 0.6, Math.sin(theta) * radiusAtY * radius];
}

/** Compact 3×3 grid formation inside the sealed slab's footprint. */
export function sealedPosition(index: number): Vec3 {
  const col = index % 3;
  const row = Math.floor(index / 3);
  return [(col - 1) * 0.32, (row - 1) * 0.28, 0];
}

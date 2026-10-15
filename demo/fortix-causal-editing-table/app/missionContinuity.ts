import { D005M_MASTER_BUNDLE, MASTER_STORY_MOMENTS, type MasterMoment } from "./masterStory.ts";
import {
  CANONICAL_ROUTING_PROVENANCE,
  deriveRoutingState,
  type DerivedRoutingState,
  type RoutingProvenance,
} from "./routingProvenance.ts";
import { clampExperienceTime, missionClockPositionAt, storyBeatTime } from "./storyTimeline.ts";
import type { HumanDecision } from "./reviewFlow.ts";

/**
 * D-006C — mission continuity across ecosystems.
 *
 * Nothing here invents evidence. Every concept D-006C asks to make visible —
 * the persistent Mission ID, the ecosystems the mission crosses, the boundary
 * between them, outbound versus return crossings, provider rerouting and the
 * intermediate Final Receipts — is already carried by the canonical model:
 * `causal_links.causal_chain_id` on every evidence object, and `systemKey` /
 * `boundaryKey` on every master story moment.
 *
 * This module is a pure projection over that model. It adds no state machine
 * of its own, so the presentation can never drift from the evidence (§18).
 */

/** The persistent identifier every mission evidence object is chained to. */
/**
 * The canonical causal chain id. This value is embedded in eight signed
 * evidence fixtures under data/ as `causal_links.causal_chain_id`, so it is
 * evidence-critical: changing it changes the canonical bundle text and
 * invalidates every payload digest and receipt in the set. It is therefore
 * NOT renamed, and it is no longer presented to the viewer as the D-006
 * mission's identity — see D006_MISSION_LABEL in ConvergenceExperience.
 */
export const MISSION_ID = "fortix.demo.d005.operational-cycle-001";

/** Chains that carry governance or trust material rather than mission events. */
const NON_MISSION_CHAINS = new Set([
  "fortix.demo.d005.trust",
  "fortix.demo.d005.trusted-time",
  "fortix.demo.d005m.trusted-time",
  "fortix.demo.d005.maintenance-authority-history",
]);

export type CrossingDirection = "OUTBOUND" | "RETURN";
export type CrossingState = "CROSSED" | "REFUSED";

export type BoundaryCrossing = Readonly<{
  boundaryKey: string;
  fromSystem: string;
  toSystem: string;
  timeMs: number;
  direction: CrossingDirection;
  state: CrossingState;
}>;

function buildCrossings(moments: readonly MasterMoment[]): BoundaryCrossing[] {
  const crossings: BoundaryCrossing[] = [];
  const seen = new Set<string>();
  for (let index = 1; index < moments.length; index += 1) {
    const from = moments[index - 1].systemKey;
    const to = moments[index].systemKey;
    if (from === to) continue; // causal continuation inside one ecosystem
    // A return crossing is one whose ordered pair reverses a pair already made.
    const direction: CrossingDirection = seen.has(`${to}>${from}`) ? "RETURN" : "OUTBOUND";
    seen.add(`${from}>${to}`);
    crossings.push(Object.freeze({
      boundaryKey: moments[index].boundaryKey,
      fromSystem: from,
      toSystem: to,
      timeMs: moments[index].timeMs,
      direction,
      state: "CROSSED" as CrossingState,
    }));
  }
  return crossings;
}

/**
 * A boundary is a change of ecosystem, not merely a causal link (§4). Moments
 * that stay inside one system are causally connected but cross nothing.
 */
export const BOUNDARY_CROSSINGS: readonly BoundaryCrossing[] = Object.freeze(
  buildCrossings(MASTER_STORY_MOMENTS),
);

/** Every ecosystem the mission touches, in first-contact order. */
export const MISSION_ECOSYSTEMS: readonly string[] = Object.freeze(
  [...new Set(MASTER_STORY_MOMENTS.map((moment) => moment.systemKey))],
);

/**
 * The payment boundary is the one the viewer can refuse. DENY still produces
 * evidence, but it must never mark the boundary as crossed (§6).
 */
export const REFUSABLE_BOUNDARY_KEY = "approvalToAuthority";
export const HUMAN_AUTHORITY_BOUNDARY_KEY = "autonomousToHuman";

export function crossingsAt(
  masterTime: number,
  decision: HumanDecision = "APPROVED",
): readonly BoundaryCrossing[] {
  const time = missionClockPositionAt(clampExperienceTime(masterTime));
  return BOUNDARY_CROSSINGS
    .filter((crossing) => crossing.timeMs <= time)
    .map((crossing) => (
      crossing.boundaryKey === REFUSABLE_BOUNDARY_KEY && decision === "DENIED"
        ? Object.freeze({ ...crossing, state: "REFUSED" as CrossingState })
        : crossing
    ));
}

export function currentCrossing(
  masterTime: number,
  decision: HumanDecision = "APPROVED",
): BoundaryCrossing | null {
  return crossingsAt(masterTime, decision).at(-1) ?? null;
}

export function currentEcosystem(masterTime: number): string {
  const time = missionClockPositionAt(clampExperienceTime(masterTime));
  const moment = [...MASTER_STORY_MOMENTS].reverse().find((candidate) => candidate.timeMs <= time);
  return moment?.systemKey ?? MASTER_STORY_MOMENTS[0].systemKey;
}

/** Outbound/return pairs: a request sent is not an execution confirmed (§5). */
export function returnCrossingPairs(): readonly Readonly<{ outbound: BoundaryCrossing; back: BoundaryCrossing }>[] {
  const pairs: { outbound: BoundaryCrossing; back: BoundaryCrossing }[] = [];
  for (const back of BOUNDARY_CROSSINGS.filter((crossing) => crossing.direction === "RETURN")) {
    const outbound = BOUNDARY_CROSSINGS.find(
      (candidate) => candidate.direction === "OUTBOUND"
        && candidate.fromSystem === back.toSystem
        && candidate.toSystem === back.fromSystem
        && candidate.timeMs < back.timeMs,
    );
    if (outbound !== undefined) pairs.push({ outbound, back });
  }
  return Object.freeze(pairs);
}

/**
 * Provider rerouting (§3C): Provider A is left, a routing selection resolves,
 * Provider B carries the mission on. Read from the model, not staged in the UI.
 */
export const ROUTING_CHAIN = Object.freeze({
  fromProvider: "navigationA",
  router: "routingSelection",
  toProvider: "navigationB",
});

/** Full canonical routing truth. The small system-key chain above is presentation compatibility only. */
export const MISSION_ROUTING_PROVENANCE: RoutingProvenance = CANONICAL_ROUTING_PROVENANCE;

export function routingStateAt(experienceTimeMs: number): DerivedRoutingState {
  return deriveRoutingState(experienceTimeMs, MISSION_ROUTING_PROVENANCE);
}

export function routingResolvedAt(): number {
  return storyBeatTime("provider-transition");
}

export type MissionReceiptId = "ride" | "garage" | "maintenance" | "payment" | "return";

export type MissionReceipt = Readonly<{
  id: MissionReceiptId;
  closesAtMs: number;
  labelKey: string;
}>;

/**
 * A mission contains several independently meaningful receipts (§9). These are
 * the canonical sub-mission closure times already used by the master story.
 */
export const MISSION_RECEIPTS: readonly MissionReceipt[] = Object.freeze([
  Object.freeze({ id: "ride" as const, closesAtMs: storyBeatTime("passenger-mission-complete"), labelKey: "rideReceipt" }),
  Object.freeze({ id: "garage" as const, closesAtMs: storyBeatTime("garage-sub-mission-receipt"), labelKey: "garageReceipt" }),
  Object.freeze({ id: "maintenance" as const, closesAtMs: storyBeatTime("maintenance-sub-mission-receipt"), labelKey: "maintenanceReceipt" }),
  Object.freeze({ id: "payment" as const, closesAtMs: storyBeatTime("payment-sub-mission-receipt"), labelKey: "paymentReceipt" }),
  Object.freeze({ id: "return" as const, closesAtMs: storyBeatTime("sub-mission-receipts"), labelKey: "returnReceipt" }),
]);

export function receiptsClosedAt(
  masterTime: number,
  decision: HumanDecision = "APPROVED",
): readonly MissionReceipt[] {
  const time = missionClockPositionAt(clampExperienceTime(masterTime));
  return MISSION_RECEIPTS.filter((receipt) => {
    if (receipt.closesAtMs > time) return false;
    // A denied payment never closes a payment receipt, and the return that
    // depends on the vehicle being released cannot close either.
    if (decision === "DENIED" && (receipt.id === "payment" || receipt.id === "return")) return false;
    return true;
  });
}

function chainIdOf(value: unknown): string | null {
  if (value === null || typeof value !== "object") return null;
  const links = (value as { causal_links?: unknown }).causal_links;
  if (links === null || typeof links !== "object") return null;
  const chain = (links as { causal_chain_id?: unknown }).causal_chain_id;
  return typeof chain === "string" ? chain : null;
}

function bundleObjects(): readonly unknown[] {
  const objects = (D005M_MASTER_BUNDLE as { canonical_evidence_objects?: unknown }).canonical_evidence_objects;
  if (!Array.isArray(objects)) throw new TypeError("D-006C expects a canonical evidence bundle");
  return objects;
}

/** Every mission evidence object shares one chain; trust material does not. */
export function missionEvidenceIds(): readonly string[] {
  return bundleObjects()
    .filter((value) => chainIdOf(value) === MISSION_ID)
    .map((value) => String((value as { evidence_id?: unknown }).evidence_id));
}

export function nonMissionChainIds(): readonly string[] {
  return [...new Set(
    bundleObjects().map(chainIdOf).filter((id): id is string => id !== null && id !== MISSION_ID),
  )];
}

export function isMissionChain(chainId: string): boolean {
  return chainId === MISSION_ID && !NON_MISSION_CHAINS.has(chainId);
}

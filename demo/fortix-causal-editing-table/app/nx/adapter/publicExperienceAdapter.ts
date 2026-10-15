import type { EthernetLinkState } from "../../ethernetLink.ts";
import { HUMAN_AUTHORITY_AMOUNTS } from "../../humanAuthorityEvidence.ts";
import { MISSION_ID } from "../../missionContinuity.ts";
import {
  isInMissionReconciliationReceipt,
  journalEvidenceLocality,
  offlineWindowStatus,
  type OfflineWindowStatus,
} from "../../offlineEvidence.ts";
import { type EvidenceMemberRef } from "../../portableMissionEvidence.ts";
import { leafCausalPhases } from "../../proofGrowthPhases.ts";
import { laneForProducer, runtimeProofLeaves } from "../../proofProjection.ts";
import {
  deriveMissionFacts,
  inspectFactsAgainstCoverage,
  type FactInspection,
  type PublicFact,
  type PublicFactSection,
} from "../../publicFacts.ts";
import { receiptFamilyForProducer } from "../../receiptProjection.ts";
import { HUMAN_AUTHORITY_GATE_MS } from "../../reviewFlow.ts";
import {
  CANONICAL_MISSION_DURATION_MS,
  EXPERIENCE_DURATION_MS,
  HANDOFF_READY_MS,
  storyBeatTime,
} from "../../storyTimeline.ts";
import { PINNED_TRUST_ANCHORS } from "../../trustAnchors.ts";
import { INDEPENDENT_VERIFICATION_PROFILE, type CanonicalVerdict } from "../../verification.ts";
import type { Branch, ReceiptKind } from "../../visualEvents.ts";
import { humanPresentationTime, naturalDepartureTime, CRITICAL_MOMENTS_MS } from "../experience/humanPacing.ts";
import {
  EVIDENCE_ATTACH_DURATION_MS,
  NX_RECEIPT_FLIGHT_MS,
  ownsAttention,
  presentationSlots,
  stageAt,
  type PresentationSlot,
  type PresentationStage,
} from "../experience/presentationQueue.ts";
import { ACTION_FAMILY_ORDER, actionFamilyOf, type ActionFamily } from "./actionFamily.ts";
import { EPISODE_ORDER, episodeOf, type EvidenceEpisode } from "./evidenceEpisode.ts";
import { readingOrder, readingOrdinals, type ReadingOrdinal } from "./readingOrder.ts";
import type { EngineSnapshot } from "./engineSnapshot.ts";

/**
 * D-006 NX1 — the PUBLIC EXPERIENCE ADAPTER.
 *
 *   EXISTING D-006 ENGINE ──canonical events/state/evidence──▶ ADAPTER ──▶ WORLD / EVIDENCE / VERIFY
 *
 * The adapter TRANSLATES. It may select, group, phrase (by id — copy lives in
 * the dictionaries), prioritise and format. It may NOT invent events,
 * evidence, claims or verdicts, advance state, simulate a network or grant
 * authority — and it cannot: it is a pure function of an EngineSnapshot with
 * no clock, no setter and no side effect, and every output is frozen. Tests
 * in d006nx1-adapter prove each of those refusals against the engine.
 *
 * Two clocks are honoured, deliberately:
 *   - the CURRENT FACT and the WORLD follow `effectiveStoryTimeMs`, the
 *     causally gated story time (the world may not run ahead of admissible
 *     evidence, and neither may what we say about it);
 *   - EVIDENCE follows `masterTimeMs`, exactly as the Proof Tree does, so the
 *     Final Receipt and the portable object can materialise in the post-roll.
 * Both are input; nothing here advances either.
 *
 * R3 — three evidence objects, three kinds:
 *   NANO-RECEIPTS ──causal compilation──▶ FINAL RECEIPT ──▶ PEB
 * A nano-receipt is a presented closure member. The Final Receipt is issued
 * over the closure and is not a nano-receipt; the PEB carries both. The
 * adapter never counts one kind as another.
 *
 * B — the journal outlives the seal. Physical records appended after the
 * Final Receipt boundary (a restoration, the offline completion capture, the
 * Reconciliation Receipt) are nano-receipts of the same run in the network
 * lane; they are outside the sealed set and the PEB, and say so. A
 * Reconciliation Receipt appended IN MISSION, before that boundary
 * (2026-10-08), is a closure member like the network records before it.
 *
 * B R2 — two more readings of the same evidence, both derived: the ACTION
 * FAMILY (what kind of thing a receipt attests, from canonical type
 * information — `actionFamily.ts`) and the ADMISSION INDEX (the engine's own
 * order of the closure members and journal records, the deterministic
 * tie-break of the reading order when two receipts share a moment).
 */

export type EvidenceFamily = ReceiptKind;
export type { ActionFamily } from "./actionFamily.ts";
export type { ReadingOrdinal } from "./readingOrder.ts";

/**
 * Provenance: one branch per nano-receipt provenance (the validated D-006G
 * lane model). Derived from the evidence's own producer through the engine's
 * lane tables — never assigned by the presentation, and never defaulted: a
 * producer the tables do not name is reported as UNRESOLVED.
 */
export type ProvenanceBranch = Branch;
export type ProvenanceLane = ProvenanceBranch | "unresolved";
export type ProvenanceResolution = "LANE_TABLE" | "UNRESOLVED";

/** Canonical lane order, left to right; the unresolved lane, when fed, comes last. */
export const PROVENANCE_ORDER: readonly ProvenanceLane[] = Object.freeze([
  "city", "vehicle", "mission", "route", "service", "authority", "bank", "network", "safety", "unresolved",
]);

/**
 * The significant episodes the public groups evidence by (LEVEL 2). The table
 * and its lookup live in `evidenceEpisode.ts` so the presentation queue and the
 * pacing model can read them without importing this module; they are re-exported
 * here because the episode is part of the public model's own vocabulary.
 */
export { EPISODE_ORDER, episodeOf } from "./evidenceEpisode.ts";
export type { EvidenceEpisode } from "./evidenceEpisode.ts";

/** The lifecycle of one evidence object as the public sees it. */
export type EvidencePhase = "IN_FLIGHT" | "MATERIALISING" | "ATTACHING" | "SETTLING" | "SETTLED";

/** The presentation lifecycle every evidence object shares (C3-R1 grammar). */
export type EvidenceGrowth = Readonly<{
  phase: EvidencePhase;
  /** 0..1 progress of the flight from the world to the evidence stream. */
  flight: number;
  /** 0..1 growth after landing; phases derive from it (NR before branch). */
  growth: number;
  nrAppear: number;
  attach: number;
  lock: number;
}>;

/**
 * Where a nano-receipt stands: a member of the sealed closure (retained or
 * quarantined by the C1 assurance profile), or a journal record appended
 * after the seal, which the closure never assessed.
 */
export type EvidenceStanding = "CLOSURE" | "JOURNAL";
export type EvidenceAssurance = EvidenceMemberRef["assurance"] | "UNASSESSED";

export type PublicEvidence = EvidenceGrowth & Readonly<{
  kind: "NANO_RECEIPT";
  evidenceId: string;
  eventId: string;
  /** The journal event type for runtime records; the source class otherwise. */
  eventType: string;
  /** The domain that authored it, as the evidence states it. */
  domain: string;
  family: EvidenceFamily;
  /** What kind of thing it attests, from canonical type information (B R2 §8). */
  actionFamily: ActionFamily;
  /** The engine's own order of admission (closure member order, then journal order). */
  admissionIndex: number;
  /**
   * Where this receipt stands in its PRESENTATION lifecycle (C-R1). Purely
   * visual: the slot says when a viewer was shown an already-admitted receipt,
   * never whether it exists, what it says, or what caused it.
   */
  presentation: PresentationStage;
  /** The presentation slot the queue gave it, carrying its canonical instant untouched. */
  slot: PresentationSlot;
  /** True while this is the one receipt the viewer is being asked to read. */
  owning: boolean;
  /**
   * The human handle — `NR 23` — from the reading order (Checkpoint C).
   * Presentational only: no evidence, digest, manifest or verification reads
   * it, and the sealed mission's numbers never change.
   */
  ordinal: ReadingOrdinal;
  /** Provenance lane, from the evidence's producer through the engine's lane tables. */
  branch: ProvenanceLane;
  provenanceResolution: ProvenanceResolution;
  episode: EvidenceEpisode;
  standing: EvidenceStanding;
  /** The presentation beat that flies this receipt, when one exists. */
  visualEventId: string | null;
  /** Public facts this object supports, for phrasing without invention. */
  factIds: readonly string[];
  source: EvidenceMemberRef["source"];
  timeMs: number;
  causalParents: readonly string[];
  observedInputs: readonly string[];
  digest: string;
  assurance: EvidenceAssurance;
  /** The record's own evidence locality, as the journal states it. */
  evidenceLocality: "LOCAL" | "RECONCILED";
}>;

/** The Final Receipt as a distinct object: compiled over the nano-receipts, never one of them. */
export type PublicFinalReceipt = EvidenceGrowth & Readonly<{
  kind: "FINAL_RECEIPT";
  receiptId: string;
  eventId: string;
  timeMs: number;
  digest: string;
  evidenceSetDigest: string;
  causalInputEvidenceIds: readonly string[];
  settlementStatus: string;
  unsupportedClaimCount: number;
  missionId: string;
  runId: string;
}>;

export type PublicWorld = Readonly<{
  taxi: Readonly<{
    position: number;
    facing: 1 | -1;
    brakeLights: boolean;
    motionPhase: string;
    speedKph: number;
    vehicleState: EngineSnapshot["physical"]["vehicleState"];
    cabinOccupied: boolean;
  }>;
  passenger: Readonly<{
    phase: EngineSnapshot["passenger"]["phase"];
    visibleOutside: boolean;
    position: number;
    walkProgress: number;
    facing: 1 | -1;
  }>;
  /** The last state the city PUBLISHED (evidence), or OFF before any. */
  signal: "OFF" | "GREEN" | "YELLOW" | "RED";
  signalChangedAtMs: number | null;
  /** Whether the taxi's perception of the current signal is on record. */
  signalPerceived: boolean;
  congestionVisible: boolean;
  garageVisible: boolean;
  baseVisible: boolean;
  atGarage: boolean;
  maintenanceInProgress: boolean;
  maintenanceProgress: number;
}>;

export type PublicCurrentFact = Readonly<{
  factId: string;
  section: PublicFactSection;
  occurredAtMs: number;
  evidenceIds: readonly string[];
  /** Occurred within the legibility window — the moment the fact is "new". */
  fresh: boolean;
}>;

export type PublicMissionPhase =
  | "READY"
  | "RUNNING"
  | "PAUSED"
  | "HOLDING_FOR_AUTHORITY"
  | "STOPPED_BY_DENIAL"
  | "POST_ROLL"
  | "COMPLETE";

export type PublicNetwork = Readonly<{
  /** The machine's admitted state: UNKNOWN, CONNECTED or LOST. Never RESTORED. */
  state: EngineSnapshot["networkState"];
  observationCurrent: boolean;
  /** What a spectator may be told about the cable right now. */
  linkPhase: EthernetLinkState;
  sentinelReachable: boolean;
  /** The LOST / RESTORED mark just after an admitted transition, briefly. */
  transitionFlash: "LOST" | "RESTORED" | null;
  unsequencedObservation: string | null;
  /** Evidence location, a fact about the journal — never about the cable. */
  evidenceLocality: "LOCAL" | "RECONCILED";
  offlineWindow: OfflineWindowStatus;
  /** Public stages of the actual operation; never more than the state shows. */
  reconciliationStage: "NONE" | "LOCAL_EVIDENCE" | "CONNECTION_RETURNED" | "COMPARING" | "RECONCILED" | "FAILED";
  reconciliationReasons: readonly string[];
  transferredCount: number | null;
  localCount: number | null;
  /** The Reconciliation Receipt's identity once one exists. */
  reconciliationReceiptId: string | null;
  /** The receipt's own statement that the offline verdict was unchanged, once it exists. */
  verdictUnchanged: boolean | null;
  /** Counts of the physical records the journal actually holds. */
  lostCount: number;
  restoredCount: number;
  reconciliationReceiptCount: number;
  /**
   * How the reconciliation band should hold itself: QUIET when nothing is
   * happening, LOST while the link is lost, ACTIVE around the actual
   * reconciliation, COMPLETE afterwards. RESTORED is a transition inside
   * ACTIVE, never a resting state.
   */
  bandTone: "QUIET" | "LOST" | "ACTIVE" | "COMPLETE" | "FAILED";
}>;

/** The PEB as a distinct object: carries the nano-receipts and the Final Receipt. */
export type PublicPortableEvidence = Readonly<{
  state: "NOT_READY" | "FORMING" | "READY" | "IN_TRANSIT" | "RECEIVED";
  finalReceiptId: string | null;
  bundleId: string | null;
  bundleDigest: string | null;
  transferredContentDigest: string | null;
  /** Presented objects the bundle carries (Final Receipt excluded). */
  nanoReceiptCount: number;
  /** Every member reference the manifest carries, support objects included. */
  memberCount: number;
  assuranceSupportCount: number;
  runtimeRecordCount: number;
  canonicalByteLength: number | null;
}>;

/**
 * The handoff: separate acts between the dossier and the verifier. CARRIED is
 * the artifact in a person's hand — picked up, presented to no one. The
 * verifier reports HANDED_OVER only once it has been dropped there.
 */
export type PublicHandoff = Readonly<{
  stage: "NOT_READY" | "READY" | "CARRIED" | "HANDED_OVER";
  readyAtMs: number;
  transferredContentDigest: string | null;
  /** The admitted network state when the verifier received the artifact. */
  receivedWhileLinkLost: boolean | null;
}>;

export type PublicVerification = Readonly<{
  state: "NOT_APPLICABLE" | "AWAITING_HUMAN" | "ANALYZING" | "VERDICT";
  /** Canonical verdict, only once the verifier produced one. Never synthesised. */
  verdict: CanonicalVerdict | null;
  completedChecks: readonly string[];
  reasonCodes: readonly string[];
  receiptId: string | null;
  bundleId: string | null;
  factInspections: readonly FactInspection[] | null;
  /** The admitted network state when the verdict arrived. */
  verifiedWhileLinkLost: boolean | null;
  /** The journal's immutable capture of this verdict before restoration exists. */
  capturedBeforeRestoration: boolean;
  /** The Reconciliation Receipt's own statement that this verdict was unchanged. */
  heldAfterReconciliation: boolean | null;
  /** The verifier's own identity — a pinned directory it carries, not the source's. */
  identity: Readonly<{
    profile: string;
    pinnedKeyId: string | null;
    trustAnchorId: string | null;
    scopeMissionId: string;
    scopeRunId: string | null;
  }>;
  /**
   * What the result establishes, read from the completed checks by id —
   * each line true only if the verifier reported that exact check.
   */
  establishes: Readonly<{
    transferredBytesExact: boolean;
    bundleIntegrity: boolean;
    missionRunIdentity: boolean;
    trustAuthorization: boolean;
    signatures: boolean;
    causalClosure: boolean;
    displayedCoverage: boolean;
    nonSettlement: boolean;
  }> | null;
}>;

/**
 * Where the PRESENTATION stands, as distinct from where the mission stands
 * (C-R1). Nothing here is evidence; it is the state of the queue that decides
 * which single receipt a viewer is being asked to read.
 */
export type PublicPresentation = Readonly<{
  /** The wall-clock coordinate of the human presentation clock. */
  timeMs: number;
  /**
   * The one receipt that owns the viewer's attention, or null in the gaps.
   * Never more than one: that is the invariant of the checkpoint.
   */
  owning: PublicEvidence | null;
  /** Receipts admitted by the engine and not yet released, in the order they will be. */
  queuedCount: number;
  /**
   * Receipts released and crossing from the world to the band — landed nowhere
   * yet. Together with the landed receipts and the queued ones this accounts
   * for every admitted receipt exactly once: the queue can lose nothing.
   */
  arrivingCount: number;
  /**
   * How far behind its own canonical instant the current arrival is being
   * shown. Always ≥ 0, always bounded: the pacing model reserves each moment
   * the room its receipts need, so a receipt is shown before the next moment's
   * evidence is due. Reported, so a reviewer can see the queue's cost.
   */
  deferralMs: number;
}>;

export type PublicExperienceModel = Readonly<{
  world: PublicWorld;
  currentFact: PublicCurrentFact | null;
  /** The full public fact record, in vocabulary order. */
  facts: readonly PublicFact[];
  latestEvidence: PublicEvidence | null;
  /** The presentation queue's state at this moment. Never evidence. */
  presentation: PublicPresentation;
  accumulatedEvidence: Readonly<{
    /** Nano-receipts landed so far. The Final Receipt is not among them. */
    count: number;
    /** Of those, members of the sealed closure (what the Final Receipt compiles). */
    sealedCount: number;
    /** Of those, journal records appended after the seal (outside the PEB). */
    journalCount: number;
    byFamily: Readonly<Record<EvidenceFamily, number>>;
    /** Action families the landed evidence actually contains, in canonical order. */
    actionFamilies: readonly ActionFamily[];
    byActionFamily: Readonly<Partial<Record<ActionFamily, number>>>;
    /** Provenance lanes fed so far, in canonical order. Never a future one. */
    branches: readonly ProvenanceLane[];
    byBranch: Readonly<Partial<Record<ProvenanceLane, number>>>;
    /** Landed evidence grouped by significant episode, in episode order. */
    episodes: readonly Readonly<{ episode: EvidenceEpisode; items: readonly PublicEvidence[] }>[];
    items: readonly PublicEvidence[];
    /** Nano-receipts whose producer no engine lane table names. */
    unresolvedProvenance: readonly string[];
  }>;
  finalReceipt: PublicFinalReceipt | null;
  authorityRequest: Readonly<{
    required: boolean;
    requestedEur: number;
    autonomousLimitEur: number;
    decision: EngineSnapshot["humanDecision"];
  }>;
  network: PublicNetwork;
  mission: Readonly<{
    phase: PublicMissionPhase;
    masterTimeMs: number;
    missionClockMs: number;
    durationMs: number;
    playing: boolean;
  }>;
  portableEvidence: PublicPortableEvidence;
  handoff: PublicHandoff;
  verification: PublicVerification;
  expertRefs: Readonly<{
    missionId: string;
    runId: string;
    closureDigest: string | null;
    closureReason: string | null;
    finalReceiptId: string | null;
    bundleId: string | null;
    transferredContentDigest: string | null;
  }>;
}>;

/** How long a fact stays "new" after it occurs, in mission time. */
export const FACT_LEGIBILITY_WINDOW_MS = 2_500;
/** Same attachment window as the Proof Tree (C3-R1); the queue owns the constant. */
export { EVIDENCE_ATTACH_DURATION_MS } from "../experience/presentationQueue.ts";

const FAMILIES: readonly EvidenceFamily[] = Object.freeze(["mission", "vehicle", "infrastructure", "service", "human", "financial"]);

/**
 * The public model at one moment of the run.
 *
 * TWO COORDINATES, and C-R1 makes the second explicit. `snapshot.masterTimeMs`
 * is the canonical one: it decides what has HAPPENED. `presentationTimeMs` is
 * the wall-clock coordinate of the human presentation clock, and it decides
 * only what has been SHOWN — the presentation queue serialises arrivals in it
 * so that two receipts recorded at one instant are read one at a time.
 *
 * It is optional because it is derivable: with no argument the presentation
 * coordinate of the master time is used, which is exactly where an
 * uninterrupted run would be. A caller that owns a real playback cursor
 * (`useMissionEngine`) passes it, because during a hold several presentation
 * moments share one master time and only the cursor knows which one.
 *
 * Passing it can never change WHAT is true — no digest, verdict, timestamp,
 * relation or ordinal is a function of it — only how far the viewer has been
 * walked through what is already true.
 */
export function derivePublicExperience(snapshot: EngineSnapshot, presentationTimeMs?: number): PublicExperienceModel {
  const now = snapshot.effectiveStoryTimeMs;
  const presentationNow = presentationTimeMs ?? humanPresentationTime(snapshot.masterTimeMs);
  const facts = deriveMissionFacts({
    effectiveStoryTimeMs: now,
    closure: snapshot.closure,
    receiptBindings: snapshot.receiptBindings,
    session: snapshot.session,
    finalReceipt: snapshot.finalReceipt,
    humanDecision: snapshot.humanDecision,
  });
  const phase = deriveMissionPhase(snapshot);
  // Before the mission is started nothing has happened yet: the request at
  // t = 0 is presented the moment the clock begins, not while the stage waits.
  const started = phase !== "READY";
  const currentFact = started ? deriveCurrentFact(facts, now) : null;
  const staged = started ? deriveEvidence(snapshot, facts, presentationNow) : { items: [], queuedCount: 0 };
  const evidence = staged.items;
  const finalReceipt = started ? deriveFinalReceipt(snapshot, presentationNow) : null;
  const latest = evidence.at(-1) ?? null;
  const landed = evidence.filter((entry) => entry.growth > 0);
  // At most one receipt is ever asking to be read. C-R1-T01 proves it over the
  // whole run; taking the last is a defence against a future rule that broke it.
  const owning = landed.filter((entry) => entry.owning).at(-1) ?? null;
  const byFamily = {} as Record<EvidenceFamily, number>;
  for (const family of FAMILIES) byFamily[family] = 0;
  for (const entry of landed) byFamily[entry.family] += 1;
  const byBranch: Partial<Record<ProvenanceLane, number>> = {};
  for (const entry of landed) byBranch[entry.branch] = (byBranch[entry.branch] ?? 0) + 1;
  const branches = PROVENANCE_ORDER.filter((branch) => (byBranch[branch] ?? 0) > 0);
  const byActionFamily: Partial<Record<ActionFamily, number>> = {};
  for (const entry of landed) byActionFamily[entry.actionFamily] = (byActionFamily[entry.actionFamily] ?? 0) + 1;
  const actionFamilies = ACTION_FAMILY_ORDER.filter((family) => (byActionFamily[family] ?? 0) > 0);
  const episodes = EPISODE_ORDER
    .map((episode) => ({ episode, items: landed.filter((entry) => entry.episode === episode) }))
    .filter((group) => group.items.length > 0);
  const unresolvedProvenance = landed.filter((entry) => entry.provenanceResolution === "UNRESOLVED").map((entry) => entry.evidenceId);
  const verification = deriveVerification(snapshot, facts);
  const network = deriveNetwork(snapshot);
  const portable = derivePortable(snapshot);
  const handoff = deriveHandoff(snapshot);

  return deepFreeze({
    world: deriveWorld(snapshot),
    currentFact,
    facts,
    latestEvidence: latest,
    presentation: {
      timeMs: presentationNow,
      owning,
      queuedCount: staged.queuedCount,
      arrivingCount: evidence.length - landed.length,
      deferralMs: owning?.slot.deferralMs ?? 0,
    },
    accumulatedEvidence: {
      count: landed.length,
      sealedCount: landed.filter((entry) => entry.standing === "CLOSURE").length,
      journalCount: landed.filter((entry) => entry.standing === "JOURNAL").length,
      byFamily,
      actionFamilies,
      byActionFamily,
      branches,
      byBranch,
      episodes,
      items: landed,
      unresolvedProvenance,
    },
    finalReceipt,
    authorityRequest: {
      required: snapshot.humanDecision === "PENDING" && now === HUMAN_AUTHORITY_GATE_MS,
      requestedEur: HUMAN_AUTHORITY_AMOUNTS.requestedEur,
      autonomousLimitEur: HUMAN_AUTHORITY_AMOUNTS.autonomousLimitEur,
      decision: snapshot.humanDecision,
    },
    network,
    mission: {
      phase,
      masterTimeMs: snapshot.masterTimeMs,
      missionClockMs: Math.min(CANONICAL_MISSION_DURATION_MS, snapshot.masterTimeMs),
      durationMs: EXPERIENCE_DURATION_MS,
      playing: snapshot.playing,
    },
    portableEvidence: portable,
    handoff,
    verification,
    expertRefs: {
      missionId: snapshot.session.missionId || MISSION_ID,
      runId: snapshot.session.runId,
      closureDigest: snapshot.closure?.evidenceSetDigest ?? null,
      closureReason: snapshot.closureReason,
      finalReceiptId: snapshot.finalReceipt?.receiptId ?? null,
      bundleId: snapshot.portablePeb?.bundleId ?? null,
      transferredContentDigest: snapshot.handoffArtifact?.transferredContentDigest ?? null,
    },
  });
}

/** The single fact the audience should be able to read right now. */
function deriveCurrentFact(facts: readonly PublicFact[], now: number): PublicCurrentFact | null {
  let chosen: PublicFact | null = null;
  for (const entry of facts) {
    if (entry.status !== "SUPPORTED" || entry.occurredAtMs === null || entry.occurredAtMs > now) continue;
    if (chosen === null || entry.occurredAtMs >= chosen.occurredAtMs!) chosen = entry;
  }
  if (chosen === null) return null;
  return {
    factId: chosen.factId,
    section: chosen.section,
    occurredAtMs: chosen.occurredAtMs!,
    evidenceIds: chosen.evidenceIds,
    fresh: now - chosen.occurredAtMs! < FACT_LEGIBILITY_WINDOW_MS,
  };
}

/**
 * The same flight → materialise → attach → lock lifecycle the Proof Tree
 * uses. A record observed once the experience has ended — a restoration or
 * a reconciliation with the clock at rest — has no clock left to carry it,
 * so it is presented settled; the bead's own arrival is a mount transition.
 *
 * C-R1 — THE LIFECYCLE IS CLOCKED IN PRESENTATION TIME, from the moment the
 * presentation queue released this receipt rather than from its canonical
 * instant. Two reasons, and both are corrections:
 *
 *   - the flight and the attachment are WALL-CLOCK animations. Under a
 *     variable pace, measuring a 1 200 ms flight in master time made the same
 *     animation take a different real duration in every part of the run;
 *   - two receipts recorded at ONE canonical instant have one elapsed master
 *     time forever, so nothing measured from it could ever tell them apart.
 *     That is precisely how they came to arrive in the same frame.
 *
 * The canonical instant is untouched and still displayed: only the moment the
 * viewer is shown the arrival is the queue's to decide.
 */
function growthAt(presentationNowMs: number, slot: PresentationSlot): EvidenceGrowth {
  if (slot.canonicalTimeMs >= EXPERIENCE_DURATION_MS) {
    return { phase: "SETTLED", flight: 1, growth: 1, nrAppear: 1, attach: 1, lock: 1 };
  }
  const elapsed = presentationNowMs - slot.releaseMs;
  const flight = clamp01(elapsed / NX_RECEIPT_FLIGHT_MS);
  const growth = clamp01((elapsed - NX_RECEIPT_FLIGHT_MS) / EVIDENCE_ATTACH_DURATION_MS);
  const phases = leafCausalPhases(growth);
  const phase: EvidencePhase = flight < 1
    ? "IN_FLIGHT"
    : phases.nrAppear < 1
      ? "MATERIALISING"
      : phases.stem < 1
        ? "ATTACHING"
        : phases.locked ? "SETTLED" : "SETTLING";
  return { phase, flight, growth, nrAppear: phases.nrAppear, attach: phases.stem, lock: phases.lock };
}

/**
 * Every nano-receipt whose moment the playhead has reached, in time order:
 * the presented members of the sealed closure, then the journal records the
 * engine appended after the seal (its own runtime leaves, network lane).
 * Nothing appears before its moment; nothing is drawn for an object that
 * does not exist; the Master Clock filters and creates nothing. The Final
 * Receipt is derived separately: it is not a nano-receipt.
 *
 * C-R1 — TWO GATES, IN THIS ORDER, and they are different kinds of thing.
 *
 *   1. ADMISSION, by the canonical clock. A receipt whose instant the master
 *      time has not reached does not exist yet for the public model. This gate
 *      is unchanged, and it is the only one with any authority.
 *   2. ARRIVAL, by the presentation queue. Of the receipts already admitted,
 *      the ones the queue has released are shown; a receipt still waiting its
 *      turn is counted as queued and drawn nowhere. This gate can only ever
 *      DELAY, never admit, reorder, alter or withhold permanently.
 *
 * The human ordinal is assigned between them — over the ADMITTED reading
 * order, exactly as at Checkpoint C — so the number a receipt is given does
 * not depend on the queue at all, and the ordinal derivation contract is the
 * one C wrote.
 */
function deriveEvidence(
  snapshot: EngineSnapshot,
  facts: readonly PublicFact[],
  presentationNowMs: number,
): Readonly<{ items: readonly PublicEvidence[]; queuedCount: number }> {
  const eventTypeByEventId = new Map(snapshot.session.records.map((record) => [record.eventId, record.eventType] as const));
  const localityByReceiptId = new Map(snapshot.session.records.map((record) => [record.receiptId, record.evidenceLocality] as const));
  const visualByEvidenceId = new Map(snapshot.receiptBindings.map((binding) => [binding.evidenceId, binding.visualEventId] as const));
  const factsByEvidenceId = new Map<string, string[]>();
  for (const entry of facts) {
    for (const id of entry.evidenceIds) factsByEvidenceId.set(id, [...(factsByEvidenceId.get(id) ?? []), entry.factId]);
  }
  const closureMembers = snapshot.closure?.members ?? [];
  const admissionIndexByEvidenceId = new Map(closureMembers.map((member, index) => [member.evidenceId, index] as const));
  const members: EvidenceMemberRef[] = closureMembers.filter((member) => member.presentation === "PRESENTED");
  const memberIds = new Set(members.map((member) => member.evidenceId));
  const closureIds = new Set(closureMembers.map((member) => member.evidenceId));

  // Everything a receipt is, before the queue has told us when it is shown:
  // the ordinal, the slot and the lifecycle are all added afterwards.
  type Unnumbered = Omit<PublicEvidence, "ordinal" | "presentation" | "slot" | "owning" | keyof EvidenceGrowth>;
  type Row = Readonly<{ timeMs: number; admissionIndex: number; evidenceId: string; build: () => Unnumbered }>;
  const rows: Row[] = [];
  for (const member of members) {
    if (member.timeMs > snapshot.masterTimeMs) continue;
    const admissionIndex = admissionIndexByEvidenceId.get(member.evidenceId) ?? 0;
    rows.push({
      timeMs: member.timeMs,
      admissionIndex,
      evidenceId: member.evidenceId,
      build: () => {
        const eventType = member.source === "RUNTIME_JOURNAL"
          ? eventTypeByEventId.get(member.eventId) ?? "RUNTIME_JOURNAL"
          : member.source;
        // Provenance from the engine's lane tables, by the producer the
        // evidence itself names. No table entry: no lane — reported, not invented.
        const lane = laneForProducer(member.producerDomain);
        return {
          kind: "NANO_RECEIPT" as const,
          evidenceId: member.evidenceId,
          eventId: member.eventId,
          eventType,
          domain: member.producerDomain,
          family: receiptFamilyForProducer(member.producerDomain) ?? "mission",
          actionFamily: actionFamilyOf({ source: member.source, eventId: member.eventId, eventType }),
          admissionIndex,
          branch: lane ?? "unresolved",
          provenanceResolution: lane === null ? "UNRESOLVED" as const : "LANE_TABLE" as const,
          episode: episodeOf(member.eventId, eventType),
          standing: "CLOSURE" as const,
          visualEventId: visualByEvidenceId.get(member.evidenceId) ?? null,
          factIds: Object.freeze(factsByEvidenceId.get(member.evidenceId) ?? []),
          source: member.source,
          timeMs: member.timeMs,
          causalParents: member.causalParents,
          observedInputs: member.observedInputs,
          digest: member.digest,
          assurance: member.assurance,
          evidenceLocality: localityByReceiptId.get(member.evidenceId) ?? "LOCAL",
        };
      },
    });
  }
  // Journal records the closure never assessed: appended after the seal by
  // the engine (a physical transition, the offline completion capture, a
  // post-completion Reconciliation Receipt). The engine's own runtime projection names their
  // lane, moment and declared relations.
  for (const leaf of runtimeProofLeaves(snapshot.session.records)) {
    if (memberIds.has(leaf.evidenceId) || closureIds.has(leaf.evidenceId)) continue;
    // Filtered by the same clock; once the experience has ended, a record the
    // engine appended after its last instant (its slot is past the end) is
    // shown, because no later instant will ever come.
    if (leaf.timeMs > snapshot.masterTimeMs && snapshot.masterTimeMs < EXPERIENCE_DURATION_MS) continue;
    const recordIndex = snapshot.session.records.findIndex((candidate) => candidate.receiptId === leaf.evidenceId);
    const record = recordIndex < 0 ? undefined : snapshot.session.records[recordIndex];
    if (record === undefined) continue;
    const lane = laneForProducer(leaf.domain);
    // Journal records follow every closure member in admission order.
    const admissionIndex = closureMembers.length + recordIndex;
    rows.push({
      timeMs: leaf.timeMs,
      admissionIndex,
      evidenceId: leaf.evidenceId,
      build: () => ({
        kind: "NANO_RECEIPT" as const,
        evidenceId: leaf.evidenceId,
        eventId: record.eventId,
        eventType: record.eventType,
        domain: leaf.domain,
        family: receiptFamilyForProducer(leaf.domain) ?? "mission",
        actionFamily: actionFamilyOf({ source: "RUNTIME_JOURNAL", eventId: record.eventId, eventType: record.eventType }),
        admissionIndex,
        branch: lane ?? "unresolved",
        provenanceResolution: lane === null ? "UNRESOLVED" as const : "LANE_TABLE" as const,
        episode: episodeOf(record.eventId, record.eventType),
        standing: "JOURNAL" as const,
        visualEventId: null,
        factIds: Object.freeze(factsByEvidenceId.get(leaf.evidenceId) ?? []),
        source: "RUNTIME_JOURNAL" as const,
        timeMs: leaf.timeMs,
        causalParents: leaf.causalParents,
        observedInputs: leaf.observedInputs,
        digest: leaf.digest,
        assurance: "UNASSESSED" as const,
        evidenceLocality: record.evidenceLocality,
      }),
    });
  }
  // The reading order — the same pure rule the proof band lays out with:
  // evidence time, the engine's admission order for a shared moment, then a
  // stable topological pass. The human ordinal is that order's position,
  // numbered inside the seal and after it separately (Checkpoint C).
  const read = readingOrder(rows.map((row) => row.build()));
  const ordinals = readingOrdinals(read);

  // THE PRESENTATION QUEUE (C-R1). One slot per admitted receipt, in the same
  // reading order, each landing no earlier than its own canonical moment and
  // no earlier than the previous receipt has finished being read.
  const slots = presentationSlots(
    read.map((entry) => ({
      evidenceId: entry.evidenceId,
      timeMs: entry.timeMs,
      eventId: entry.eventId,
      eventType: entry.eventType,
      source: entry.source,
      episode: entry.episode,
    })),
    naturalDepartureTime,
    CRITICAL_MOMENTS_MS,
  );

  const items: PublicEvidence[] = [];
  let queuedCount = 0;
  read.forEach((entry, index) => {
    const slot = slots[index]!;
    const presentation = stageAt(slot, presentationNowMs);
    // Admitted, but the receipt in front of it is still being read. It is not
    // drawn anywhere — a receipt half-shown is the burst this checkpoint
    // exists to remove — and it is counted, so the queue is never silent.
    if (presentation === "QUEUED") { queuedCount += 1; return; }
    items.push(Object.freeze({
      ...entry,
      ordinal: ordinals.get(entry.evidenceId)!,
      presentation,
      slot,
      owning: ownsAttention(slot, presentationNowMs),
      ...growthAt(presentationNowMs, slot),
    }));
  });
  return { items: Object.freeze(items), queuedCount };
}

/**
 * The Final Receipt is not a nano-receipt and is not staged among them: it is
 * compiled OVER the sealed set, at a canonical instant the pacing model treats
 * as critical and rests the playhead on. It is given its own slot so that its
 * arrival is clocked in the same presentation time as everything else — the
 * flight and the attachment are wall-clock animations either way.
 */
function deriveFinalReceipt(snapshot: EngineSnapshot, presentationNowMs: number): PublicFinalReceipt | null {
  const receipt = snapshot.finalReceipt;
  if (receipt === null || receipt.issuedAtMasterTimeMs > snapshot.masterTimeMs) return null;
  const [slot] = presentationSlots(
    [{
      evidenceId: receipt.receiptId,
      timeMs: receipt.issuedAtMasterTimeMs,
      eventId: receipt.eventId,
      eventType: "FINAL_MISSION_RECEIPT",
      source: "SIGNED_CANONICAL",
      episode: "final",
    }],
    naturalDepartureTime,
    CRITICAL_MOMENTS_MS,
  );
  return {
    kind: "FINAL_RECEIPT",
    receiptId: receipt.receiptId,
    eventId: receipt.eventId,
    timeMs: receipt.issuedAtMasterTimeMs,
    digest: receipt.receiptId.split(":").pop() ?? receipt.receiptId,
    evidenceSetDigest: receipt.evidenceSetDigest,
    causalInputEvidenceIds: receipt.causalInputEvidenceIds,
    settlementStatus: receipt.financialClosure.settlementStatus,
    unsupportedClaimCount: receipt.financialClosure.unsupportedClaimEvidenceIds.length,
    missionId: receipt.identity.missionId,
    runId: receipt.identity.runId,
    ...growthAt(presentationNowMs, slot!),
  };
}

function deriveWorld(snapshot: EngineSnapshot): PublicWorld {
  const now = snapshot.effectiveStoryTimeMs;
  const published = snapshot.session.records
    .filter((record) => record.eventType === "SIGNAL_STATE_PUBLISHED" && record.missionClockPosition <= now)
    .at(-1);
  const signal = published === undefined ? "OFF" : String(published.payload.published_state) as PublicWorld["signal"];
  const perceived = published !== undefined && snapshot.session.records.some((record) => (
    record.eventType === "VEHICLE_OBSERVATION"
    && record.payload.observed_input === published.receiptId
    && record.missionClockPosition <= now
  ));
  return {
    taxi: {
      position: snapshot.motion.position,
      facing: snapshot.motion.facing,
      brakeLights: snapshot.motion.brakeLights,
      motionPhase: snapshot.motion.phase,
      speedKph: snapshot.physical.speedKph,
      vehicleState: snapshot.physical.vehicleState,
      cabinOccupied: snapshot.passenger.aboardVehicle,
    },
    passenger: {
      phase: snapshot.passenger.phase,
      visibleOutside: snapshot.passenger.visibleOutside,
      position: snapshot.passenger.position,
      walkProgress: snapshot.passenger.walkProgress,
      facing: snapshot.passenger.facing,
    },
    signal,
    signalChangedAtMs: published?.missionClockPosition ?? null,
    signalPerceived: perceived,
    // The simulated world's own schedule (clockMayCause: true rows).
    congestionVisible: now >= storyBeatTime("congestion") && now < storyBeatTime("routing-merge-start"),
    garageVisible: now >= storyBeatTime("garage-approach") && now < storyBeatTime("leaving-garage"),
    baseVisible: now < storyBeatTime("taxi-en-route-to-passenger") || now >= storyBeatTime("return-journey"),
    atGarage: snapshot.physical.atGarage,
    maintenanceInProgress: snapshot.physical.maintenanceInProgress,
    maintenanceProgress: snapshot.physical.maintenanceActionProgress,
  };
}

function deriveMissionPhase(snapshot: EngineSnapshot): PublicMissionPhase {
  if (snapshot.humanDecision === "DENIED") return "STOPPED_BY_DENIAL";
  if (snapshot.humanDecision === "PENDING" && snapshot.effectiveStoryTimeMs === HUMAN_AUTHORITY_GATE_MS) return "HOLDING_FOR_AUTHORITY";
  if (snapshot.masterTimeMs >= EXPERIENCE_DURATION_MS) return "COMPLETE";
  if (snapshot.masterTimeMs > CANONICAL_MISSION_DURATION_MS) return "POST_ROLL";
  if (snapshot.masterTimeMs === 0 && !snapshot.playing) return "READY";
  return snapshot.playing ? "RUNNING" : "PAUSED";
}

function deriveNetwork(snapshot: EngineSnapshot): PublicNetwork {
  const window = offlineWindowStatus(snapshot.session);
  const receipt = snapshot.reconciliation?.receipt ?? null;
  const records = snapshot.session.records;
  // The latest receipt names the window; only a post-completion receipt can
  // state that a verdict held — an in-mission one is written before any exists.
  const journalReceipt = records.findLast((record) => record.eventType === "RECONCILIATION_RECEIPT") ?? null;
  const postCompletionReceipt = records.findLast((record) => record.eventType === "RECONCILIATION_RECEIPT"
    && !isInMissionReconciliationReceipt(record)) ?? null;
  const stage: PublicNetwork["reconciliationStage"] = snapshot.reconciliation?.status === "FAILED"
    ? "FAILED"
    : snapshot.reconciliation?.status === "COMPLETE" && receipt !== null
      ? "RECONCILED"
      : window === "AWAITING_RECONCILIATION"
        ? (snapshot.baseTransfer !== null ? "COMPARING" : "CONNECTION_RETURNED")
        : window === "OPEN"
          ? "LOCAL_EVIDENCE"
          : window === "RECONCILED" ? "RECONCILED" : "NONE";
  const bandTone: PublicNetwork["bandTone"] = stage === "FAILED"
    ? "FAILED"
    : stage === "RECONCILED"
      ? "COMPLETE"
      : stage === "LOCAL_EVIDENCE" || (stage === "NONE" && snapshot.networkState === "LOST")
        ? "LOST"
        : stage === "NONE" ? "QUIET" : "ACTIVE";
  const verdictField = (postCompletionReceipt?.payload as Readonly<Record<string, unknown>> | undefined)?.verdict_unchanged;
  return {
    state: snapshot.networkState,
    observationCurrent: snapshot.linkObservationCurrent,
    linkPhase: snapshot.linkPhase,
    sentinelReachable: snapshot.sentinelReachable,
    transitionFlash: snapshot.transitionFlash,
    unsequencedObservation: snapshot.unsequencedObservation,
    // The journal as a whole: in mission, evidence authored after the receipt is LOCAL again.
    evidenceLocality: journalEvidenceLocality(snapshot.session),
    offlineWindow: window,
    reconciliationStage: stage,
    reconciliationReasons: snapshot.reconciliation?.reasonCodes ?? [],
    transferredCount: receipt?.transferredObjectCount ?? snapshot.baseTransfer?.transferredCount ?? null,
    localCount: receipt?.localObjectCount ?? snapshot.baseTransfer?.localCount ?? null,
    reconciliationReceiptId: receipt?.receiptId ?? journalReceipt?.receiptId ?? null,
    verdictUnchanged: receipt?.verdictUnchanged ?? (typeof verdictField === "boolean" ? verdictField : null),
    lostCount: records.filter((record) => record.eventType === "NETWORK_LINK_LOST").length,
    restoredCount: records.filter((record) => record.eventType === "NETWORK_LINK_RESTORED").length,
    reconciliationReceiptCount: records.filter((record) => record.eventType === "RECONCILIATION_RECEIPT").length,
    bandTone,
  };
}

function derivePortable(snapshot: EngineSnapshot): PublicPortableEvidence {
  const state: PublicPortableEvidence["state"] = snapshot.transferStage === "TRANSFERRED"
    ? "RECEIVED"
    : snapshot.transferStage === "FORMED"
      ? "IN_TRANSIT"
      : snapshot.handoffArtifact !== null
        ? "READY"
        : snapshot.finalReceipt !== null ? "FORMING" : "NOT_READY";
  const peb = snapshot.portablePeb;
  const finalReceiptId = peb?.finalReceipt.receiptId ?? snapshot.finalReceipt?.receiptId ?? null;
  return {
    state,
    finalReceiptId,
    bundleId: peb?.bundleId ?? null,
    bundleDigest: peb?.manifest.bundleDigest ?? null,
    transferredContentDigest: snapshot.handoffArtifact?.transferredContentDigest ?? null,
    nanoReceiptCount: peb === null ? 0 : peb.manifest.presentationEvidenceIds.filter((id) => id !== finalReceiptId).length,
    memberCount: peb?.manifest.memberRefs.length ?? 0,
    assuranceSupportCount: peb?.manifest.assuranceSupportEvidenceIds.length ?? 0,
    runtimeRecordCount: peb?.runtimeRecords.length ?? 0,
    canonicalByteLength: snapshot.handoffArtifact?.pebText.length ?? null,
  };
}

function deriveHandoff(snapshot: EngineSnapshot): PublicHandoff {
  const stage: PublicHandoff["stage"] = snapshot.handoffArtifact === null
    ? "NOT_READY"
    : snapshot.transferStage === "TRANSFERRED"
      ? "HANDED_OVER"
      : snapshot.transferStage === "FORMED" ? "CARRIED" : "READY";
  return {
    stage,
    readyAtMs: HANDOFF_READY_MS,
    transferredContentDigest: snapshot.handoffArtifact?.transferredContentDigest ?? null,
    receivedWhileLinkLost: stage !== "HANDED_OVER" || snapshot.handoffNetworkState === null
      ? null
      : snapshot.handoffNetworkState === "LOST",
  };
}

function deriveVerification(snapshot: EngineSnapshot, facts: readonly PublicFact[]): PublicVerification {
  const anchor = PINNED_TRUST_ANCHORS[0] ?? null;
  const identity = {
    profile: INDEPENDENT_VERIFICATION_PROFILE,
    pinnedKeyId: anchor?.keyId ?? null,
    trustAnchorId: anchor?.trustAnchorId ?? null,
    scopeMissionId: snapshot.handoffArtifact?.identity.missionId ?? snapshot.session.missionId ?? MISSION_ID,
    scopeRunId: snapshot.handoffArtifact?.identity.runId ?? null,
  };
  const idle = {
    verdict: null, completedChecks: [], reasonCodes: [], receiptId: null, bundleId: null, factInspections: null,
    verifiedWhileLinkLost: null, capturedBeforeRestoration: false, heldAfterReconciliation: null, identity, establishes: null,
  };
  if (snapshot.transferStage !== "TRANSFERRED") return { state: "NOT_APPLICABLE", ...idle };
  if (snapshot.verification === null) return { state: snapshot.analysisRequested ? "ANALYZING" : "AWAITING_HUMAN", ...idle };
  const coverage = new Set<string>(snapshot.handoffArtifact?.peb.manifest.presentationEvidenceIds ?? []);
  const intact = snapshot.verification.verdict !== "INVALID" && snapshot.verification.verdict !== "REVOKED";
  const checks = new Set(snapshot.verification.completedChecks);
  const capture = snapshot.session.preRestorationCapture;
  const capturedBeforeRestoration = capture !== null
    && snapshot.handoffArtifact !== null
    && capture.pebRef === snapshot.handoffArtifact.peb.bundleId
    && capture.verdict === snapshot.verification.verdict;
  // Only a post-completion receipt states that a verdict held.
  const journalReceipt = snapshot.session.records.findLast((record) => record.eventType === "RECONCILIATION_RECEIPT"
    && !isInMissionReconciliationReceipt(record));
  const held = (journalReceipt?.payload as Readonly<Record<string, unknown>> | undefined)?.verdict_unchanged;
  return {
    state: "VERDICT",
    verdict: snapshot.verification.verdict,
    completedChecks: snapshot.verification.completedChecks,
    reasonCodes: snapshot.verification.reasonCodes,
    receiptId: snapshot.verification.receiptId,
    bundleId: snapshot.verification.bundleId,
    factInspections: snapshot.handoffArtifact === null ? null : inspectFactsAgainstCoverage(facts, coverage, intact),
    verifiedWhileLinkLost: snapshot.verdictNetworkState === null ? null : snapshot.verdictNetworkState === "LOST",
    capturedBeforeRestoration,
    heldAfterReconciliation: typeof held === "boolean" ? held : null,
    identity,
    establishes: {
      transferredBytesExact: checks.has("d006_transferred_digest_exact"),
      bundleIntegrity: checks.has("bundle_digest_recomputed") && checks.has("object_digests_recomputed"),
      missionRunIdentity: checks.has("d006_mission_run_identity"),
      trustAuthorization: checks.has("verification_key_authorized_by_pinned_anchor"),
      signatures: checks.has("canonical_signatures_verified"),
      causalClosure: checks.has("cycle_receipt_closure") && checks.has("d006_final_receipt_closure"),
      displayedCoverage: checks.has("d006_displayed_peb_coverage"),
      nonSettlement: checks.has("d006_financial_non_settlement"),
    },
  };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

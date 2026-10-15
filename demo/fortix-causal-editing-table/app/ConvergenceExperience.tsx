"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";

import {
  deriveMasterStoryState,
  MASTER_STORY_MOMENTS,
  masterMomentTime,
  type MasterMomentId,
} from "./masterStory";
import {
  formatOperationalTime,
  type CycleVerificationResult,
} from "./operationalCycle";
import {
  SENTINEL_UNREACHABLE,
  isFreshPhysicalLinkObservation,
  isLinkSentinelReport,
  visiblePhysicalLinkState,
  type LinkSentinelReport,
} from "./ethernetLink.ts";
import { derivePhysicalState } from "./physicalState";
import {
  STAGE_PROOF_HEIGHT_PX,
  STAGE_PROPS,
  STAGE_REALITY_HEIGHT_PX,
  STAGE_RIBBON_HEIGHT_PX,
  exactProducerEmissionPoint,
  exactProducerStageSlot,
  propEmissionPoint,
  receiptEmissionSourceForProducer,
  stageX,
  vehicleEmissionPoint,
  type ReceiptEmissionSource,
  type StagePropId,
} from "./stageGeometry";
import {
  HUMAN_AUTHORITY_GATE_MS,
  advanceReviewPlayback,
  applyHumanDecision,
  constrainReviewTime,
  resolveArtifactRelease,
  type HumanDecision,
  type TransferStage,
} from "./reviewFlow";
import {
  chooseProofLabelSides,
  type LabelPlacementCandidate,
  type LabelSide,
  type Rect,
} from "./proofLabelPlacement";
import {
  VISUAL_EVENTS,
  visualEventTime,
  type Branch,
  type EventTone,
  type ReceiptKind,
  type VisualEvent,
} from "./visualEvents";
import {
  requestSameOriginEvidenceAcknowledgement,
  shortEvidenceId,
} from "./evidenceContinuity";
import {
  PHYSICAL_SENTINEL_SOURCE,
  appendNetworkTransition as appendNetworkEvidenceTransition,
  networkTransitionAdmissibility,
  capturePreRestorationArtifacts,
  createOfflineEvidenceSession,
  evidenceState,
  offlineWindowStatus,
  reconcileOfflineEvidence,
  sealFinalReceiptRuntimeEvidence,
  type ArtifactState,
  type JsonValue,
  type OfflineEvidenceSession,
  type ReconciliationResult,
} from "./offlineEvidence.ts";
import {
  analyzeInsertedD006Peb,
  insertD006PebForAnalysis,
  type D006VerdictSnapshot,
} from "./offlineVerification.ts";
import {
  DEFAULT_SENTINEL_POLL_INTERVAL_MS,
  PhysicalNetworkTransitionMachine,
  type NetworkTransitionSnapshot,
  type NetworkTransitionState,
} from "./networkTransitions.ts";
import {
  ACTIVE_RUN_POINTER_KEY,
  RUN_ARCHIVE_KEY,
  archiveRun,
  isRunPersistencePairCoherent,
  isRunResumable,
  newMissionRunId,
  parseRunArchive,
  parseRunPointer,
  parseRunSession,
  recordsForRun,
  runNetworkKey,
  runSessionKey,
} from "./missionRun.ts";
import { projectMissionEvidence } from "./missionEvidence.ts";
import { appendHumanAuthorityDenial } from "./humanAuthorityEvidence.ts";
import { MISSION_ID } from "./missionContinuity.ts";
import { CANONICAL_ROUTING_PROVENANCE, deriveRoutingState } from "./routingProvenance.ts";
import { computeProofLayout, minimumLabelledSeparationMs } from "./proofLayout.ts";
import { leafCausalPhases } from "./proofGrowthPhases.ts";
import {
  projectCausalEdges,
  projectPortableProofLeaves,
  signedProofLeaves,
  type ProofLeaf,
} from "./proofProjection.ts";
import {
  buildMissionEvidenceClosure,
  buildPortableMissionEvidenceBundle,
  createHandoffArtifact,
  finalReceiptMember,
  finalReceiptRuntimeEvidencePrefix,
  issueFinalMissionReceipt,
  PortableMissionEvidenceError,
  routingProvenanceFromRuntimeRecords,
  type FinalMissionReceipt,
  type MissionEvidenceClosure,
} from "./portableMissionEvidence.ts";
import {
  finalReceiptBinding,
  projectReceiptBindings,
  type ReceiptBinding,
} from "./receiptProjection.ts";
import {
  EXPERIENCE_DURATION_MS,
  FINAL_LEAF_GROWTH_DURATION_MS,
  FINAL_REQUIRED_LEAF_MATURE_MS,
  FINAL_RECEIPT_EMITTED_MS,
  HANDOFF_READY_MS,
  PEB_COMPLETE_MS,
  RECEIPT_TRAVEL_DURATION_MS,
  RETURN_RECEIPT_EMITTED_MS,
  evidenceGatedStoryTime,
  formatExperienceTime,
  storyBeatTime,
} from "./storyTimeline.ts";
import { derivePresentationMotion } from "./vehiclePresentation";
import { derivePassengerPresentation } from "./passengerPresentation";
import {
  memoryBaseStore,
  performBaseCompareTransfer,
  storageBaseStore,
  type BaseCompareTransferOutcome,
  type BaseStore,
} from "./baseEvidence";
import {
  PUBLIC_FACT_SECTION_ORDER,
  deriveMissionFacts,
  factsBySection,
  inspectFactsAgainstCoverage,
  type FactInspection,
  type PublicFact,
} from "./publicFacts";
import { publicCausalScene } from "./publicExperience";
import { TransversalityReveal } from "./TransversalityReveal";
import { PINNED_TRUST_ANCHORS } from "./trustAnchors";
import { INDEPENDENT_VERIFICATION_PROFILE } from "./verification";
import {
  pointWithinInsertionTarget,
  verifierInspectionLayout,
  VERIFIER_FIELD_HEIGHT_PX,
  VERIFIER_FIELD_WIDTH_PX,
  VERIFIER_FIELD_BOTTOM_RADIUS_PX,
  VERIFIER_FIELD_TOP_RADIUS_PX,
} from "./verifierInspectionGeometry";
import { useI18n } from "./I18nProvider";
import type { Dictionary } from "../../../site/src/i18n/dictionary";
import "./convergence.css";

type TrafficSignalState = "OFF" | "GREEN" | "YELLOW" | "RED";
type InspectionStage = "IDLE" | "INSPECTING" | "OPEN" | "REVEALED" | "VERIFIED";
type ArtifactPose = Readonly<{ x: number; y: number; width: number; height: number }>;
type EvidenceAcknowledgementPhase = "IDLE" | "LOCAL" | "READY" | "ACKNOWLEDGING" | "ACKNOWLEDGED" | "FAILED";
type ReceiptFlight = Readonly<{
  visualEvent: VisualEvent | null;
  binding: ReceiptBinding;
  receiptKind: ReceiptKind;
  tone: EventTone;
}>;
const EMISSION_SOURCE = Object.freeze({
  customer: "customer",
  garage: "garage",
  base: "base",
  authority: "authority",
  bank: "bank",
} as const satisfies Readonly<Record<string, ReceiptEmissionSource>>);

const RECEIPT_TRAVEL_MS = RECEIPT_TRAVEL_DURATION_MS;
const BRANCH_GROWTH_MS = 700;
const FINAL_BRANCH_GROWTH_MS = FINAL_LEAF_GROWTH_DURATION_MS;
const REVELATION_STEP_MS = 1_000;
/** The link sentinel listens on loopback; see scripts/link-sentinel.mjs. */
const LINK_SENTINEL_URL = "http://127.0.0.1:4319/link";
const LINK_POLL_MS = DEFAULT_SENTINEL_POLL_INTERVAL_MS;
const LINK_SENTINEL_TIMEOUT_MS = LINK_POLL_MS * 3;
// Long enough for a normal serialized PowerShell refresh, short enough that a
// stuck sidecar cannot sustain a physical-link claim indefinitely.
const LINK_OBSERVATION_FRESHNESS_MS = LINK_SENTINEL_TIMEOUT_MS * 3 + LINK_POLL_MS;
const RECONCILIATION_PENDING_STATE = "pending";
/**
 * D-006E active mission isolation.
 *
 * Both storage keys used to be derived from the canonical chain id — one
 * constant, therefore ONE slot shared by every demonstration ever run in this
 * browser. A fresh launch restored whatever the last run had left there, so
 * the active Proof Tree opened already carrying NR-NET-LOST and a
 * reconciliation node from a previous session, with the cable never touched.
 *
 * Storage is now addressed per mission run (see missionRun.ts), which makes
 * the isolation structural rather than a filter over mixed data. The old keys
 * are deliberately NOT read and NOT removed: previous runs keep their
 * evidence exactly where they wrote it.
 */
const UNRESOLVED_RUN_ID = "fortix.d006e.run.unresolved";

/**
 * Distinguishes two runs started within the same second. This is a
 * presentation-scoped identifier, not a key or a nonce — nothing
 * cryptographic is derived from it.
 */
function missionRunEntropy(): string {
  const random = globalThis.crypto?.randomUUID?.();
  return random === undefined ? Math.random().toString(36).slice(2, 14) : random.replace(/-/g, "");
}
/**
 * F7: what the viewer reads as this mission's name. The physical review
 * found `fortix.demo.d005...` on screen inside the D-006 experience. That
 * string is the canonical causal chain id and cannot be renamed without
 * breaking the signed evidence set, so it stays where it belongs — bound to
 * the evidence, carried in a data attribute for inspection — and the visible
 * visible mission name is the D-006 demonstration's own. This is a label, not an
 * identifier, and nothing cryptographic is derived from it.
 */
const D006_MISSION_LABEL = "D-006 · TAXI 07";
const AUTHORITY_VISIBLE_FROM_MS = masterMomentTime("maintenance-proposal");
const AUTHORITY_VISIBLE_UNTIL_MS = masterMomentTime("leaving-garage") + 2_000;
/** The bank is on stage only while the financial boundary is being crossed. */
const BANK_VISIBLE_FROM_MS = masterMomentTime("payment-execution") - 1_000;
const BANK_VISIBLE_UNTIL_MS = masterMomentTime("manager-notified");
const ACCEPT_TIME_MS = visualEventTime("accept");
const MASTER_SCENE_ORDER = MASTER_STORY_MOMENTS.map((moment) => moment.id);


/**
 * D-006B-1: the Evidence Flower. Six segments of a radial mechanism, one per
 * evidence family that already exists in the receipt table. No family is
 * invented and none is left permanently empty: every segment is fed by real
 * events, so an unfilled segment always means "not yet", never "never".
 */
const EVIDENCE_FAMILIES = ["mission", "vehicle", "infrastructure", "service", "human", "financial"] as const;
type EvidenceFamily = (typeof EVIDENCE_FAMILIES)[number];
const BUD_BIRTH_AFTER_PROOF_UNITS = 7;

/**
 * One lane per trust domain, top to bottom. D-006G made these load-bearing:
 * a viewer is meant to perceive domain branches, and rows are now derived
 * from the branch rather than from a hand-authored per-event table, so a
 * domain reads as a horizontal band instead of scattered dots.
 */
const TREE_ROWS: Record<Branch, number> = {
  city: 9,
  vehicle: 23,
  safety: 35,
  mission: 50,
  route: 64,
  service: 76,
  authority: 87,
  bank: 94,
  network: 98,
};

export function ConvergenceExperience() {
  const { locale, t, setLocale } = useI18n();
  const d006d = t.d006d;
  const d006c2 = t.d006c2;
  const d006c3 = t.d006c3;
  const [masterTime, setMasterTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [humanDecision, setHumanDecision] = useState<HumanDecision>("PENDING");
  const [bundleStage, setBundleStage] = useState<TransferStage>("SOURCE");
  // Which nano-receipt the viewer is inspecting. Null during normal playback:
  // the default view stays calm and detail arrives only on intent.
  // Hover and pin are tracked apart on purpose: one scalar meant a pointer
  // leaving the ribbon cleared a panel the keyboard still owned, and made
  // pinning impossible with a mouse.
  const [hoveredEventId, setHoveredEventId] = useState<string | null>(null);
  const [pinnedEventId, setPinnedEventId] = useState<string | null>(null);
  const inspectedEventId = hoveredEventId ?? pinnedEventId;
  const [inspectionStage, setInspectionStage] = useState<InspectionStage>("IDLE");
  const [verificationPending, setVerificationPending] = useState(false);
  const [verificationResult, setVerificationResult] = useState<CycleVerificationResult | null>(null);
  const animationFrame = useRef<number | null>(null);
  const lastFrame = useRef<number | null>(null);
  const masterTimeRef = useRef(0);
  const verificationRun = useRef(0);
  const shellRef = useRef<HTMLElement>(null);
  const proofCanvasRef = useRef<HTMLDivElement>(null);
  const sourceArtifactAnchorRef = useRef<HTMLDivElement>(null);
  const verifierArtifactAnchorRef = useRef<HTMLButtonElement>(null);
  const verifierChamberRef = useRef<HTMLDivElement>(null);
  const analyzeButtonRef = useRef<HTMLButtonElement>(null);
  const verdictRef = useRef<HTMLDivElement>(null);
  const [labelSides, setLabelSides] = useState<Readonly<Record<string, LabelSide>>>({});
  const [verifierFieldSize, setVerifierFieldSize] = useState({
    width: VERIFIER_FIELD_WIDTH_PX,
    height: VERIFIER_FIELD_HEIGHT_PX,
  });
  const [artifactPose, setArtifactPose] = useState<ArtifactPose | null>(null);
  // F3: the viewer takes possession of the evidence and carries it. "HELD" is
  // the keyboard/remote path, "POINTER" is a finger or a mouse. Both end the
  // same way: the artifact is over the verifier's insertion target, or it is
  // not, and only the first completes the handoff.
  const [carryMode, setCarryMode] = useState<"IDLE" | "HELD" | "POINTER">("IDLE");
  const [overTarget, setOverTarget] = useState(false);
  // F1: the observed physical Ethernet link, not the browser's opinion of
  // the network. UNKNOWN until the sentinel answers - never assumed connected.
  const [linkReport, setLinkReport] = useState<LinkSentinelReport>(SENTINEL_UNREACHABLE);
  const [linkObservationCurrent, setLinkObservationCurrent] = useState(false);
  /**
   * Identity of the demonstration currently being enacted. The canonical
   * chain id names the signed artifacts and is the same for every run by
   * design, so it cannot separate one run from the next; this can.
   *
   * It resolves on mount, in the first effect below — before the sentinel
   * poll effect, which is declared after it and therefore mounts after it.
   * Until then it holds UNRESOLVED_RUN_ID, which is not a valid run id, and
   * no evidence may be authored against it.
   */
  const activeRunIdRef = useRef<string>(UNRESOLVED_RUN_ID);
  const [activeRunId, setActiveRunId] = useState<string>(UNRESOLVED_RUN_ID);
  const networkMachineRef = useRef(new PhysicalNetworkTransitionMachine({
    runId: UNRESOLVED_RUN_ID,
  }));
  const [networkState, setNetworkState] = useState<NetworkTransitionState>("UNKNOWN");
  const [transitionFlash, setTransitionFlash] = useState<"LOST" | "RESTORED" | null>(null);
  const [offlineSession, setOfflineSession] = useState<OfflineEvidenceSession>(() => (
    createOfflineEvidenceSession(UNRESOLVED_RUN_ID)
  ));
  /**
   * Last physical observation the evidence grammar could not admit, as
   * `<reason>:<eventId>`. This was a ref that nothing ever read, so a refused
   * observation left no trace anywhere — the D-006E delivery note claiming it
   * was "reported, not swallowed" was untrue as built. It is state now, and it
   * reaches the DOM, so a refusal is inspectable.
   */
  const [unsequencedObservation, setUnsequencedObservation] = useState<string | null>(null);
  const offlineSessionRef = useRef(offlineSession);
  const [offlineVerdict, setOfflineVerdict] = useState<D006VerdictSnapshot | null>(null);
  const [reconciliation, setReconciliation] = useState<ReconciliationResult | null>(null);
  // C3 §11: the outcome of the ACTUAL base compare/transfer that fed the
  // receipt — kept so the visualization can show performed work, not a label.
  const [baseTransfer, setBaseTransfer] = useState<BaseCompareTransferOutcome | null>(null);
  // One attempt per physical offline window. A new observed loss resets it.
  const reconciliationStartedRef = useRef(false);

  const [syncPhase, setSyncPhase] = useState<EvidenceAcknowledgementPhase>("IDLE");
  // F5: verification is a second, deliberate act. Insertion never starts it.
  const [analysisRequested, setAnalysisRequested] = useState(false);
  // The machine owns the admitted journal baseline. The public indicator owns
  // only a current sentinel observation; it must not publish that baseline as
  // CONNECTED while the sentinel is absent or a transition is still debouncing.
  const linkPhase = linkObservationCurrent
    ? visiblePhysicalLinkState(linkReport, networkState)
    : "UNKNOWN";
  const reconciliationWindow = offlineWindowStatus(offlineSession);
  const reconciliationWindowKey = reconciliationWindow === "AWAITING_RECONCILIATION"
    ? awaitingReconciliationWindowKey(offlineSession)
    : null;
  const currentEvidenceState = evidenceState(offlineSession);

  /**
   * Opens a NEW demonstration: a freshly named run, an empty causal view, a
   * new network machine, and its own storage. The outgoing run is ARCHIVED,
   * never deleted — its evidence stays exactly where it wrote it and remains
   * readable under its own key. Isolation here means "not this mission's",
   * never "gone".
   *
   * This is the explicit lifecycle boundary the demonstration previously had
   * nowhere: `restart()` reset the presentation but left the evidence session
   * and the network machine untouched, so a second run inherited the first
   * run's causal graph.
   */
  const beginMissionRun = useCallback((): string => {
    const outgoing = activeRunIdRef.current;
    const runId = newMissionRunId(Date.now(), missionRunEntropy());

    activeRunIdRef.current = runId;
    const session = createOfflineEvidenceSession(runId);
    offlineSessionRef.current = session;
    networkMachineRef.current = new PhysicalNetworkTransitionMachine({
      runId,
      initialState: session.networkState,
    });

    try {
      // The outgoing run is remembered by id only; its records are not
      // copied, moved or rewritten.
      const archive = archiveRun(
        parseRunArchive(window.localStorage.getItem(RUN_ARCHIVE_KEY)),
        outgoing,
      );
      window.localStorage.setItem(RUN_ARCHIVE_KEY, JSON.stringify(archive));
      // Persist the two run-owned bodies before publishing the pointer. A
      // reload between writes can therefore only ignore an unpublished run;
      // it can never resume a pointer whose journal and machine are absent.
      window.localStorage.setItem(runSessionKey(runId), JSON.stringify(session));
      window.localStorage.setItem(
        runNetworkKey(runId),
        JSON.stringify(networkMachineRef.current.snapshot()),
      );
      window.localStorage.setItem(ACTIVE_RUN_POINTER_KEY, JSON.stringify({
        version: 1,
        activeRunId: runId,
        startedAt: new Date().toISOString(),
      }));
    } catch {
      // Storage unavailable. The run is still correctly isolated in memory;
      // it simply will not survive a reload, which is the safe direction.
    }

    reconciliationStartedRef.current = false;

    // The refs above are updated synchronously because the sentinel poll
    // reads them and must never observe the outgoing run. The React state
    // below is deferred: this is also called from a mount effect, and
    // setting state synchronously inside an effect body cascades renders.
    queueMicrotask(() => {
      setActiveRunId(runId);
      setOfflineSession(session);
      // Nothing has been physically observed for this run yet, so the live
      // indicator remains UNKNOWN. Internally the transition machine shares
      // the journal's CONNECTED mission baseline; the first confirmed LOST
      // sample can therefore author the required transition atomically.
      setNetworkState("UNKNOWN");
      setLinkObservationCurrent(false);
      setSyncPhase("IDLE");
      setReconciliation(null);
      setBaseTransfer(null);
      setOfflineVerdict(null);
      setTransitionFlash(null);
      setUnsequencedObservation(null);
    });
    return runId;
  }, []);

  const inspectedEvent = useMemo(
    () => VISUAL_EVENTS.find((event) => event.id === inspectedEventId) ?? null,
    [inspectedEventId],
  );
  const runOwnedRuntimeRecords = useMemo(() => recordsForRun(offlineSession.records, activeRunId)
    .filter((record) => record.missionId === MISSION_ID), [activeRunId, offlineSession.records]);
  const activeRuntimeRecords = useMemo(() => {
    if (offlineSession.finalReceiptRuntimeSeal === null) return runOwnedRuntimeRecords;
    try {
      return finalReceiptRuntimeEvidencePrefix(offlineSession)
        .filter((record) => record.runId === activeRunId && record.missionId === MISSION_ID);
    } catch {
      // A malformed or moved boundary is never replaced with a best guess.
      return Object.freeze([] as OfflineEvidenceSession["records"][number][]);
    }
  }, [activeRunId, offlineSession, runOwnedRuntimeRecords]);
  const routingEvidenceState = useMemo(() => {
    try {
      const provenance = routingProvenanceFromRuntimeRecords(activeRuntimeRecords);
      return {
        provenance: provenance ?? CANONICAL_ROUTING_PROVENANCE,
        recordPresent: provenance !== null,
        valid: true,
      } as const;
    } catch {
      return {
        provenance: CANONICAL_ROUTING_PROVENANCE,
        recordPresent: false,
        valid: false,
      } as const;
    }
  }, [activeRuntimeRecords]);
  const routingEvidenceAdmissible = routingEvidenceState.recordPresent && routingEvidenceState.valid;
  const routingState = useMemo(
    () => deriveRoutingState(routingEvidenceAdmissible ? masterTime : 0, routingEvidenceState.provenance),
    [masterTime, routingEvidenceAdmissible, routingEvidenceState.provenance],
  );
  const routingExecutionAuthorized = routingEvidenceAdmissible
    && routingState.vehicleMayExecute;
  const effectiveStoryTime = evidenceGatedStoryTime(masterTime, routingEvidenceAdmissible);
  const story = useMemo(() => deriveMasterStoryState(effectiveStoryTime), [effectiveStoryTime]);
  const reachedEvents = useMemo(
    () => VISUAL_EVENTS.filter((event) => event.timeMs <= effectiveStoryTime),
    [effectiveStoryTime],
  );
  const physical = useMemo(
    () => derivePhysicalState(masterTime, routingExecutionAuthorized),
    [masterTime, routingExecutionAuthorized],
  );
  /**
   * C3 §5: the passenger is an observable participant of the simulated world,
   * derived from the same physical state machine as the taxi — never from a
   * CSS class that flips at a label's moment.
   */
  const passenger = useMemo(
    () => derivePassengerPresentation(effectiveStoryTime, physical.passengerState),
    [effectiveStoryTime, physical.passengerState],
  );
  const evidenceClosureState = useMemo<Readonly<{
    closure: MissionEvidenceClosure | null;
    reasonCode: string | null;
  }>>(() => {
    try {
      return {
        closure: buildMissionEvidenceClosure({
          identity: { missionId: MISSION_ID, runId: activeRunId },
          runtimeRecords: activeRuntimeRecords,
          asOfMasterTimeMs: FINAL_RECEIPT_EMITTED_MS,
        }),
        reasonCode: null,
      };
    } catch (error) {
      if (error instanceof PortableMissionEvidenceError) {
        return { closure: null, reasonCode: error.reasonCode };
      }
      throw error;
    }
  }, [activeRunId, activeRuntimeRecords]);
  const evidenceClosure = evidenceClosureState.closure;
  const finalMissionReceipt = useMemo(() => (
    masterTime < FINAL_RECEIPT_EMITTED_MS
      || offlineSession.finalReceiptRuntimeSeal === null
      || evidenceClosure === null
      ? null
      : tryIssueFinalReceipt(evidenceClosure)
  ), [evidenceClosure, masterTime, offlineSession.finalReceiptRuntimeSeal]);
  const proofLeaves = useMemo(
    () => evidenceClosure === null
      ? Object.freeze([] as ProofLeaf[])
      : projectPortableProofLeaves(evidenceClosure, masterTime, finalMissionReceipt),
    [evidenceClosure, finalMissionReceipt, masterTime],
  );
  const receiptBindings = useMemo(
    () => evidenceClosure === null ? Object.freeze([] as ReceiptBinding[]) : projectReceiptBindings(evidenceClosure, VISUAL_EVENTS),
    [evidenceClosure],
  );
  /**
   * C3 §16/§17: the public facts of this run, each resolved 1:1 to a canonical
   * event and to evidence in the actual closure or journal. A fact that the
   * clock has reached but whose evidence does not resolve stays unsupported.
   */
  const missionFacts = useMemo(() => deriveMissionFacts({
    effectiveStoryTimeMs: effectiveStoryTime,
    closure: evidenceClosure,
    receiptBindings,
    session: offlineSession,
    finalReceipt: finalMissionReceipt,
    humanDecision,
  }), [effectiveStoryTime, evidenceClosure, finalMissionReceipt, humanDecision, offlineSession, receiptBindings]);
  const receiptEvents = useMemo(() => {
    const eventById = new Map(VISUAL_EVENTS.map((event) => [event.id, event]));
    const projected: ReceiptFlight[] = receiptBindings.flatMap((binding) => {
      const event = eventById.get(binding.visualEventId);
      return event === undefined ? [] : [{
        visualEvent: event,
        binding,
        receiptKind: binding.receiptKind,
        tone: event.tone,
      }];
    });
    if (finalMissionReceipt !== null) {
      projected.push({
        visualEvent: null,
        binding: finalReceiptBinding(finalMissionReceipt),
        receiptKind: "mission",
        tone: "ultramarine",
      });
    }
    return Object.freeze(projected);
  }, [finalMissionReceipt, receiptBindings]);
  const inspectedBinding = inspectedEvent === null
    ? null
    : receiptEvents.find(({ visualEvent }) => visualEvent?.id === inspectedEvent.id)?.binding ?? null;
  const leafById = useMemo(() => new Map(proofLeaves.map((leaf) => [leaf.leafId, leaf])), [proofLeaves]);
  const causalEvents = useMemo(() => receiptEvents.map(({ visualEvent, binding, receiptKind, tone }) => ({
    visualEvent,
    binding,
    receiptKind,
    tone,
    receiptActive: leafById.has(binding.leafId)
      && masterTime >= binding.timeMs
      && masterTime <= binding.timeMs + RECEIPT_TRAVEL_MS,
    receiptProgress: clamp01((masterTime - binding.timeMs) / RECEIPT_TRAVEL_MS),
    branchProgress: leafById.has(binding.leafId)
      ? leafGrowthForLeaf(leafById.get(binding.leafId)!, masterTime)
      : 0,
  })), [leafById, masterTime, receiptEvents]);
  const activeEmissions = useMemo(() => causalEvents.filter((item) => item.receiptActive), [causalEvents]);
  const currentEvent = reachedEvents.at(-1) ?? VISUAL_EVENTS[0];
  const currentEventBinding = receiptEvents.find(({ visualEvent }) => visualEvent?.id === currentEvent.id)?.binding ?? null;
  const currentEventActor = currentEventBinding?.producerDomain ?? currentEvent.actor;
  const publicEventLabel = d006c2.eventLabels[currentEvent.id] ?? currentEvent.id;
  const publicActorLabel = d006c2.actorLabels[currentEventActor] ?? currentEventActor;
  const publicScene = publicCausalScene(currentEvent.id, linkPhase);
  const publicCausalSteps = d006c2.causal[publicScene.kind];
  const progress = masterTime / EXPERIENCE_DURATION_MS;
  const proofLeafStates = useMemo(() => proofLeaves.map((leaf) => ({
    leaf,
    growth: leafGrowthForLeaf(leaf, masterTime),
  })), [masterTime, proofLeaves]);
  const latestProofIndex = proofLeafStates.findLastIndex((item) => item.growth > 0);
  const latestProofItem = latestProofIndex >= 0 ? proofLeafStates[latestProofIndex] : null;
  const previousProofX = latestProofIndex > 0 ? proofLeafX(proofLeafStates[latestProofIndex - 1].leaf.timeMs) : 5;
  const proofProgress = latestProofItem === null
    ? 0
    : previousProofX + (proofLeafX(latestProofItem.leaf.timeMs) - previousProofX) * latestProofItem.growth;
  const proofUnits = proofLeafStates.reduce((total, item) => total + item.growth, 0);
  const matureProofCount = proofLeafStates.filter((item) => item.growth >= 1).length;
  const expectedFinalProofUnits = (evidenceClosure?.presentationEvidenceIds.length ?? 0) + 1;
  const budMaturity = clamp01((proofUnits - BUD_BIRTH_AFTER_PROOF_UNITS)
    / Math.max(1, expectedFinalProofUnits - BUD_BIRTH_AFTER_PROOF_UNITS));
  const signalState = trafficSignalAt(effectiveStoryTime);
  const waitingForAuthority = humanDecision === "PENDING" && effectiveStoryTime === HUMAN_AUTHORITY_GATE_MS;
  // Connectivity is not a precondition of the local Final Receipt or PEB.
  const portablePeb = useMemo(() => {
    if (masterTime < PEB_COMPLETE_MS || finalMissionReceipt === null || evidenceClosure === null) return null;
    const displayedEvidenceIds = projectPortableProofLeaves(
      evidenceClosure,
      PEB_COMPLETE_MS,
      finalMissionReceipt,
    ).map((leaf) => leaf.evidenceId);
    return buildPortableMissionEvidenceBundle({
      closure: evidenceClosure,
      finalReceipt: finalMissionReceipt,
      runtimeRecords: activeRuntimeRecords,
      displayedEvidenceIds,
      masterTimeMs: PEB_COMPLETE_MS,
    });
  }, [activeRuntimeRecords, evidenceClosure, finalMissionReceipt, masterTime]);
  const handoffArtifact = useMemo(() => (
    masterTime >= HANDOFF_READY_MS && portablePeb !== null
      ? createHandoffArtifact(portablePeb, HANDOFF_READY_MS)
      : null
  ), [masterTime, portablePeb]);
  /**
   * C3 §21: after analysis, each public fact is inspected against the EXACT
   * transferred coverage. A fact the mission recorded but this artifact does
   * not carry reads NOT_COVERED — the verifier never borrows the mission's
   * word for anything.
   */
  const factInspections = useMemo<readonly FactInspection[] | null>(() => {
    if (verificationResult === null || handoffArtifact === null) return null;
    const coverage = new Set<string>(handoffArtifact.peb.manifest.presentationEvidenceIds);
    const evidenceIntact = verificationResult.verdict !== "INVALID"
      && verificationResult.verdict !== "REVOKED";
    return inspectFactsAgainstCoverage(missionFacts, coverage, evidenceIntact);
  }, [handoffArtifact, missionFacts, verificationResult]);
  const evidenceTransferReady = story.handoffReady && handoffArtifact !== null;
  // Each family fills as its own receipts land, so the flower is fed by the
  // same branch growth that builds the tree — never by a separate clock.
  const familyFill = useMemo(() => {
    const familyByEvidenceId = new Map<string, EvidenceFamily>();
    for (const { receiptKind, binding } of receiptEvents) {
      familyByEvidenceId.set(binding.evidenceId, receiptKind);
    }
    if (finalMissionReceipt !== null) familyByEvidenceId.set(finalMissionReceipt.receiptId, "mission");
    const fill = {} as Record<EvidenceFamily, number>;
    for (const family of EVIDENCE_FAMILIES) {
      const owned = proofLeafStates.filter((item) => familyByEvidenceId.get(item.leaf.evidenceId) === family);
      const grown = owned.reduce((total, item) => total + item.growth, 0);
      fill[family] = owned.length === 0 ? 0 : grown / owned.length;
    }
    return fill;
  }, [finalMissionReceipt, proofLeafStates, receiptEvents]);

  const measureArtifactPose = useCallback((anchor: HTMLElement): ArtifactPose | null => {
    const shell = shellRef.current;
    if (shell === null) return null;
    const shellBounds = shell.getBoundingClientRect();
    const anchorBounds = anchor.getBoundingClientRect();
    return {
      x: anchorBounds.left - shellBounds.left,
      y: anchorBounds.top - shellBounds.top,
      width: anchorBounds.width,
      height: anchorBounds.height,
    };
  }, []);

  const measureProofLabelPlacement = useCallback(() => {
    const canvas = proofCanvasRef.current;
    const flower = sourceArtifactAnchorRef.current;
    if (canvas === null || flower === null) return;
    const labels: LabelPlacementCandidate[] = [];
    for (const leaf of canvas.querySelectorAll<HTMLElement>('.proof-leaf[data-featured="true"]')) {
      const label = leaf.querySelector<HTMLElement>("span");
      const anchor = leaf.querySelector<HTMLElement>("i");
      const id = leaf.dataset.eventId;
      if (label === null || anchor === null || id === undefined) continue;
      const labelBounds = label.getBoundingClientRect();
      const anchorBounds = rectFromDom(anchor.getBoundingClientRect());
      const gap = 3;
      labels.push({
        id,
        anchorBounds,
        right: {
          left: anchorBounds.right + gap,
          right: anchorBounds.right + gap + labelBounds.width,
          top: labelBounds.top,
          bottom: labelBounds.bottom,
        },
        left: {
          left: anchorBounds.left - gap - labelBounds.width,
          right: anchorBounds.left - gap,
          top: labelBounds.top,
          bottom: labelBounds.bottom,
        },
      });
    }
    const next = chooseProofLabelSides({
      canvasBounds: rectFromDom(canvas.getBoundingClientRect()),
      exclusionBounds: [rectFromDom(flower.getBoundingClientRect())],
      labels,
    });
    setLabelSides((current) => sameLabelSides(current, next) ? current : next);
  }, []);

  useLayoutEffect(() => {
    measureProofLabelPlacement();
    const canvas = proofCanvasRef.current;
    if (canvas === null) return;
    const observer = new ResizeObserver(measureProofLabelPlacement);
    observer.observe(canvas);
    void document.fonts.ready.then(measureProofLabelPlacement);
    return () => observer.disconnect();
  }, [measureProofLabelPlacement]);

  useLayoutEffect(() => {
    const chamber = verifierChamberRef.current;
    if (chamber === null) return;
    const measure = () => {
      const bounds = chamber.getBoundingClientRect();
      setVerifierFieldSize({
        width: Math.max(208, Math.round(bounds.width)),
        height: Math.max(208, Math.round(bounds.height)),
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(chamber);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (bundleStage === "FORMED") return;
    const anchor = bundleStage === "SOURCE" ? sourceArtifactAnchorRef.current : verifierArtifactAnchorRef.current;
    if (anchor !== null) setArtifactPose(measureArtifactPose(anchor));
  }, [bundleStage, measureArtifactPose]);

  useEffect(() => {
    const shell = shellRef.current;
    if (shell === null) return;
    const realign = () => {
      if (bundleStage === "FORMED") return;
      const anchor = bundleStage === "SOURCE" ? sourceArtifactAnchorRef.current : verifierArtifactAnchorRef.current;
      if (anchor !== null) setArtifactPose(measureArtifactPose(anchor));
      measureProofLabelPlacement();
    };
    const observer = new ResizeObserver(realign);
    observer.observe(shell);
    window.addEventListener("resize", realign);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", realign);
    };
  }, [bundleStage, measureArtifactPose, measureProofLabelPlacement]);

  useEffect(() => {
    masterTimeRef.current = masterTime;
  }, [masterTime]);

  /**
   * D-006E. On mount, decide — explicitly — whether this page load continues
   * an interrupted demonstration or opens a new one. It used to do neither:
   * it read one shared storage slot and restored whatever it found there as
   * the active mission, which is why a fresh launch could open already
   * showing a previous run's NR-NET-LOST and reconciliation node.
   *
   * The presence of records in storage is never on its own a reason to
   * present them as the active mission. A run is resumed only when all of
   * this holds: a well-formed pointer names it, its stored session and
   * machine snapshot both carry that same run id, every record in it was
   * authored by that run, and its offline window is still open. Anything
   * else — no pointer, a finished run, a mismatch, malformed JSON — opens a
   * new run instead. Nothing is ever deleted on either path.
   */
  useEffect(() => {
    try {
      const pointer = parseRunPointer(window.localStorage.getItem(ACTIVE_RUN_POINTER_KEY));
      if (pointer === null) { beginMissionRun(); return; }
      const runId = pointer.activeRunId;
      const networkSnapshotText = window.localStorage.getItem(runNetworkKey(runId));
      const evidenceSessionText = window.localStorage.getItem(runSessionKey(runId));
      if (networkSnapshotText === null || evidenceSessionText === null) { beginMissionRun(); return; }
      const networkSnapshot = JSON.parse(networkSnapshotText) as NetworkTransitionSnapshot;
      const restoredSession = parseRunSession(evidenceSessionText, runId, MISSION_ID);
      if (restoredSession === null) { beginMissionRun(); return; }
      // Every rendered piece of active evidence must have been authored by
      // the active run. Checked here, at the point of reconstruction, so a
      // mixed session is refused outright rather than filtered later.
      const belongsToRun = restoredSession.missionId === MISSION_ID
        && restoredSession.runId === runId
        && networkSnapshot.runId === runId
        // A persisted machine is a journal cache, never an independent
        // authority. Refuse a torn write or a pre-observation UNKNOWN cache.
        && isRunPersistencePairCoherent(restoredSession, networkSnapshot)
        && Array.isArray(restoredSession.records)
        && restoredSession.records.every((record) => (
          record.missionId === MISSION_ID && record.runId === runId
        ));
      if (!belongsToRun || !isRunResumable(restoredSession)) { beginMissionRun(); return; }

      activeRunIdRef.current = runId;
      networkMachineRef.current = new PhysicalNetworkTransitionMachine({
        runId,
        snapshot: networkSnapshot,
      });
      offlineSessionRef.current = restoredSession;

      queueMicrotask(() => {
        setActiveRunId(runId);
        setOfflineSession(restoredSession);
        // The machine's cached state is only ever a starting point for the
        // display. The sentinel decides what is true: the poll effect below
        // mounts immediately after this one and issues its first read at
        // once, so a cable that changed while the page was gone is corrected
        // within one poll rather than trusted from storage.
        setNetworkState(networkMachineRef.current.state);
        if (networkMachineRef.current.state === "LOST") setSyncPhase("LOCAL");
        // P3-B: the link is CONNECTED or LOST, nothing else. Whether evidence
        // is waiting to be reconciled is a fact about the JOURNAL, so it is
        // read from the journal — connectivity no longer implies it.
        else if (offlineWindowStatus(restoredSession) === "AWAITING_RECONCILIATION") setSyncPhase("READY");
        // No completed reconciliation phase is inferred from connectivity.
      });
    } catch {
      // Malformed storage can never mint evidence, and must never strand the
      // demonstration: it opens a new run, exactly as a first visit does.
      beginMissionRun();
    }
  }, [beginMissionRun]);

  /**
   * D-006G mission evidence: the smart-city intersection and the financial
   * boundary, authored as the clock reaches each moment.
   *
   * Independent of network state, deliberately. These are real-world events
   * — a signal published a state, a vehicle observed it, a bank authorised a
   * transfer — and whether an Ethernet cable happens to be connected has no
   * bearing on whether they occurred or are worth evidencing. Making the
   * network decide that would be exactly the inference the three-dimension
   * separation forbids.
   *
   * The projection itself is pure and idempotent (`projectMissionEvidence`),
   * so seeking and replaying cannot duplicate a record.
   */
  useEffect(() => {
    if (activeRunIdRef.current === UNRESOLVED_RUN_ID) return;
    setOfflineSession((current) => {
      const next = projectMissionEvidence(current, masterTime);
      if (next === current) return current;
      offlineSessionRef.current = next;
      return next;
    });
  }, [activeRunId, masterTime]);

  /**
   * Final Receipt issuance seals append POSITION, not observed mission time.
   * Rewinding after this point may author a real physical observation, but
   * that later journal append can never rewrite the already-issued receipt,
   * PEB, or transferred bytes.
   */
  useEffect(() => {
    if (masterTime < FINAL_RECEIPT_EMITTED_MS
      || activeRunIdRef.current === UNRESOLVED_RUN_ID) return;
    setOfflineSession((current) => {
      if (current.runId !== activeRunIdRef.current) return current;
      // The functional update runs after the projection update above, even
      // when a seek jumps directly across the emission instant.
      const completeAtEmission = projectMissionEvidence(current, FINAL_RECEIPT_EMITTED_MS);
      const sealed = sealFinalReceiptRuntimeEvidence(completeAtEmission, FINAL_RECEIPT_EMITTED_MS);
      if (sealed === current) return current;
      offlineSessionRef.current = sealed;
      return sealed;
    });
  }, [activeRunId, masterTime]);

  useEffect(() => {
    offlineSessionRef.current = offlineSession;
    // Persisted under the session's OWN run id, so no run can overwrite
    // another's evidence. An unresolved session belongs to no run and is
    // never written.
    if (offlineSession.runId === UNRESOLVED_RUN_ID) return;
    try {
      window.localStorage.setItem(runSessionKey(offlineSession.runId), JSON.stringify(offlineSession));
    } catch {
      // The in-memory journal remains authoritative for this run. A missing
      // body will fail the cross-validation above instead of resuming a torn
      // machine/session pair on reload.
    }
  }, [offlineSession]);

  // F1: poll the link sentinel, which reads the Windows adapter table. The
  // application's own API routes run in workerd, where every child_process
  // spawn method is an unimplemented stub, so a route cannot ask Windows
  // anything - see scripts/link-sentinel.mjs.
  //
  // Reaching the sentinel is NOT evidence of connectivity: it listens on
  // loopback and answers with the cable out. It reports one observed fact.
  useEffect(() => {
    let cancelled = false;
    let reading = false;
    let flashTimer: ReturnType<typeof setTimeout> | null = null;
    let activeRequestController: AbortController | null = null;
    const read = async () => {
      if (reading) return;
      reading = true;
      const controller = new AbortController();
      activeRequestController = controller;
      const requestTimeout = setTimeout(() => controller.abort(), LINK_SENTINEL_TIMEOUT_MS);
      let next: LinkSentinelReport = SENTINEL_UNREACHABLE;
      try {
        const response = await fetch(LINK_SENTINEL_URL, { cache: "no-store", signal: controller.signal });
        const value: unknown = await response.json();
        if (isLinkSentinelReport(value)) next = value;
      } catch {
        next = SENTINEL_UNREACHABLE;
      } finally {
        clearTimeout(requestTimeout);
        if (activeRequestController === controller) activeRequestController = null;
        reading = false;
      }
      if (cancelled) return;
      setLinkReport(next);
      // A structurally valid but old cached response is not a current physical
      // observation. Do not advance the transition machine from it.
      if (!isFreshPhysicalLinkObservation(next, Date.now(), LINK_OBSERVATION_FRESHNESS_MS)) {
        setLinkObservationCurrent(false);
        return;
      }
      // Reporting the sentinel's reading is always safe; authoring evidence
      // is not, until this page load has decided which run it is enacting.
      // The mount effect above resolves that synchronously and is declared
      // first, so it has already run — this refuses to guess if it somehow
      // has not, rather than minting a receipt into an unowned run.
      if (activeRunIdRef.current === UNRESOLVED_RUN_ID) return;
      const lastEvidenceClock = offlineSessionRef.current.records.at(-1)?.missionClockPosition;
      // The first physical event is anchored at the currently presented
      // mission position. Once evidence exists, every later physical event is
      // allocated from the immutable journal only; seek/rewind cannot lower it.
      // Stable polls do not consume or validate this prospective position.
      const prospectiveEvidenceClock = lastEvidenceClock === undefined
        ? Math.round(masterTimeRef.current)
        : lastEvidenceClock + 1;
      const previousMachineSnapshot = networkMachineRef.current.snapshot();
      let machineResult;
      try {
        machineResult = networkMachineRef.current.observe(next, {
          evidenceClockMs: prospectiveEvidenceClock,
          causalPredecessors: offlineSessionRef.current.records.at(-1)?.receiptId === undefined
            ? []
            : [offlineSessionRef.current.records.at(-1)!.receiptId],
        });
      } catch (error) {
        // Observation validation can fail after debounce state has advanced.
        // Restore the complete prior cache just as an append refusal does.
        networkMachineRef.current = new PhysicalNetworkTransitionMachine({
          runId: activeRunIdRef.current,
          snapshot: previousMachineSnapshot,
        });
        setNetworkState(previousMachineSnapshot.state);
        setLinkObservationCurrent(false);
        setUnsequencedObservation(
          `${error instanceof Error ? error.message : "NETWORK_OBSERVATION_FAILED"}:NO_EVENT`,
        );
        return;
      }
      if (machineResult.event !== null) {
        const event = machineResult.event;
        const lost = event.eventType === "NETWORK_LINK_LOST";
        const transition = {
          previousNetworkState: event.previousNetworkState,
          newNetworkState: event.newNetworkState,
        };
        // Decided HERE, against the journal the poll already holds, rather
        // than inside the state updater. Updaters must be pure — React may
        // run them more than once or discard the result — so a refusal
        // recorded in there could be recorded twice or lost. This also keeps
        // the journal's grammar in one place: see
        // networkTransitionAdmissibility, which is the same expression the
        // append itself enforces.
        const admissibility = networkTransitionAdmissibility(offlineSessionRef.current, transition);
        if (admissibility !== "ADMISSIBLE") {
          // A physical observation the grammar has no transition for must not
          // author evidence and must not take the demonstration down. It is
          // surfaced (see data-unsequenced-observation) rather than swallowed:
          // a refusal the operator cannot see is indistinguishable from the
          // event never having happened.
          setUnsequencedObservation(`${admissibility}:${event.eventId}`);
          networkMachineRef.current = new PhysicalNetworkTransitionMachine({
            runId: activeRunIdRef.current,
            snapshot: previousMachineSnapshot,
          });
          setNetworkState(previousMachineSnapshot.state);
          setLinkObservationCurrent(false);
        } else {
          try {
            const appended = appendNetworkEvidenceTransition(offlineSessionRef.current, {
              runId: event.runId,
              observationId: event.eventId,
              eventId: event.eventId,
              receiptId: event.receiptId,
              adapterIdentity: event.adapterIdentity.description,
              observationSource: PHYSICAL_SENTINEL_SOURCE,
              ...transition,
              missionClockPosition: event.missionClockPosition.milliseconds,
              // Where the record sits in the journal must strictly increase;
              // when it HAPPENED is the mission moment the sentinel saw it.
              // Conflating the two hid a real NR-NET-LOST behind a paused
              // clock, because its journal slot was one millisecond ahead.
              observedMasterTimeMs: Math.round(masterTimeRef.current),
            });
            offlineSessionRef.current = appended.session;
            setOfflineSession(appended.session);
            setNetworkState(machineResult.state);
            setLinkObservationCurrent(
              visiblePhysicalLinkState(next, machineResult.state) !== "UNKNOWN",
            );
            setUnsequencedObservation(null);

            // Commit journal first and the derived machine cache second. If
            // storage tears, mount-time cross-validation refuses the run; an
            // advanced machine can never be resumed without its receipt.
            try {
              window.localStorage.setItem(
                runSessionKey(activeRunIdRef.current),
                JSON.stringify(appended.session),
              );
              window.localStorage.setItem(
                runNetworkKey(activeRunIdRef.current),
                JSON.stringify(networkMachineRef.current.snapshot()),
              );
            } catch {
              // Continue from the complete in-memory pair. Reload fails
              // closed if only one persisted half made it to storage.
            }

            setTransitionFlash(lost ? "LOST" : "RESTORED");
            if (flashTimer !== null) clearTimeout(flashTimer);
            flashTimer = setTimeout(() => setTransitionFlash(null), 700);
            if (lost) {
              setSyncPhase("LOCAL");
              setReconciliation(null);
              setBaseTransfer(null);
              reconciliationStartedRef.current = false;
            } else {
              setSyncPhase("READY");
            }
          } catch (error) {
            // `observe` mutates its debounce and sequence cache. Roll it back
            // if the journal refuses the descriptor so the next sentinel poll
            // can retry the same physical truth instead of losing a receipt.
            networkMachineRef.current = new PhysicalNetworkTransitionMachine({
              runId: activeRunIdRef.current,
              snapshot: previousMachineSnapshot,
            });
            setNetworkState(previousMachineSnapshot.state);
            setLinkObservationCurrent(false);
            setUnsequencedObservation(
              `${error instanceof Error ? error.message : "NETWORK_TRANSITION_APPEND_FAILED"}:${event.eventId}`,
            );
          }
        }
      } else {
        // Candidate/debounce observations do not alter journal truth. Their
        // cache may be persisted only while its stable state still agrees
        // with the active session.
        if (machineResult.state !== "UNKNOWN"
          && machineResult.state !== offlineSessionRef.current.networkState) {
          networkMachineRef.current = new PhysicalNetworkTransitionMachine({
            runId: activeRunIdRef.current,
            snapshot: previousMachineSnapshot,
          });
          setNetworkState(previousMachineSnapshot.state);
          setLinkObservationCurrent(false);
          setUnsequencedObservation("NETWORK_MACHINE_JOURNAL_STATE_MISMATCH");
        } else {
          setNetworkState(machineResult.state);
          const agreesWithAdmittedState = visiblePhysicalLinkState(next, machineResult.state) !== "UNKNOWN";
          if (machineResult.reason === "STABLE") {
            setLinkObservationCurrent(agreesWithAdmittedState);
          } else if (machineResult.reason === "DUPLICATE_OBSERVATION") {
            // The UI polls as quickly as the sidecar refreshes its cached
            // report, so a duplicate is ordinary. Preserve only an already
            // admitted, matching, still-fresh physical observation. A
            // duplicate candidate for a different state remains UNKNOWN.
            setLinkObservationCurrent((current) => current && agreesWithAdmittedState);
          } else {
            setLinkObservationCurrent(false);
          }
          try {
            window.localStorage.setItem(
              runNetworkKey(activeRunIdRef.current),
              JSON.stringify(networkMachineRef.current.snapshot()),
            );
          } catch {
            // Ephemeral debounce state need not survive storage failure.
          }
        }
      }
    };
    void read();
    const timer = setInterval(() => { void read(); }, LINK_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
      activeRequestController?.abort();
      if (flashTimer !== null) clearTimeout(flashTimer);
    };
  }, []);

  const resetHandoff = useCallback(() => {
    verificationRun.current += 1;
    setAnalysisRequested(false);
    setCarryMode("IDLE");
    setOverTarget(false);
    setBundleStage("SOURCE");
    setInspectionStage("IDLE");
    setVerificationPending(false);
    setVerificationResult(null);
  }, []);

  useEffect(() => {
    if (bundleStage !== "FORMED" || carryMode !== "HELD") return;
    const frame = requestAnimationFrame(() => verifierArtifactAnchorRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [bundleStage, carryMode]);

  /**
   * "Start over" is a new demonstration, not a rewind of the old one. It used
   * to reset only the presentation — clock, decision, handoff — and leave the
   * evidence session and network machine exactly as they were, so the second
   * run inherited the first run's causal graph and opened with its
   * NR-NET-LOST already on the spine. The causal boundary is now explicit and
   * happens here.
   */
  const restart = useCallback(() => {
    setIsPlaying(false);
    setMasterTime(0);
    setHumanDecision("PENDING");
    setHoveredEventId(null);
    setPinnedEventId(null);
    resetHandoff();
    beginMissionRun();
  }, [beginMissionRun, resetHandoff]);

  /**
   * "Call a taxi" opens the demonstration. If the active run has not authored
   * anything yet it IS this demonstration and is kept — a first launch must
   * not throw away the run it just created. If it already carries evidence,
   * the viewer is starting a second demonstration, and that gets its own
   * mission: never a silent continuation of the last one.
   */
  const beginDemonstration = useCallback(() => {
    if (offlineSessionRef.current.records.length > 0) beginMissionRun();
    setIsPlaying(true);
  }, [beginMissionRun]);

  const seek = useCallback((value: number) => {
    const next = constrainReviewTime(value, "INTERACTIVE", humanDecision);
    setIsPlaying(false);
    if (next < HANDOFF_READY_MS) resetHandoff();
    setMasterTime(next);
  }, [humanDecision, resetHandoff]);

  useEffect(() => {
    if (!isPlaying) {
      lastFrame.current = null;
      return;
    }
    const anchorMasterTime = masterTimeRef.current;
    let elapsedFromAnchor = 0;
    const tick = (frameTime: number) => {
      const previous = lastFrame.current ?? frameTime;
      const elapsed = Math.max(0, frameTime - previous);
      lastFrame.current = frameTime;
      elapsedFromAnchor += elapsed;
      setMasterTime(() => {
        const advance = advanceReviewPlayback(anchorMasterTime, elapsedFromAnchor, "INTERACTIVE", humanDecision);
        if (advance.pausedForAuthority || advance.complete) setIsPlaying(false);
        return advance.masterTime;
      });
      animationFrame.current = requestAnimationFrame(tick);
    };
    animationFrame.current = requestAnimationFrame(tick);
    return () => {
      if (animationFrame.current !== null) cancelAnimationFrame(animationFrame.current);
    };
  }, [humanDecision, isPlaying]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Escape has to reach the handler even from a focused chip, which is
      // exactly where the viewer is when a reading is open.
      if (event.code === "Escape") {
        setHoveredEventId(null);
        setPinnedEventId(null);
        if (carryMode !== "IDLE" && bundleStage === "FORMED") {
          setCarryMode("IDLE");
          setOverTarget(false);
          setBundleStage((stage) => resolveArtifactRelease(stage, "CANCEL"));
        }
        return;
      }
      const target = event.target;
      if (target instanceof HTMLElement
        && target.closest("button, input, select, textarea, a, summary, [contenteditable='true'], [role='button']")) return;
      if (event.code === "Space") {
        event.preventDefault();
        if (!waitingForAuthority && humanDecision !== "DENIED") setIsPlaying((value) => !value);
      } else if (event.code === "Home") {
        restart();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [bundleStage, carryMode, humanDecision, restart, waitingForAuthority]);

  const decide = (decision: Exclude<HumanDecision, "PENDING">) => {
    if (!waitingForAuthority) return;
    const applied = applyHumanDecision(decision);
    setHumanDecision(applied.decision);
    setMasterTime(applied.masterTime);
    setIsPlaying(decision === "APPROVED");
    if (decision === "DENIED" && activeRunIdRef.current !== UNRESOLVED_RUN_ID) {
      // NX0 §50: DENY is a real outcome and leaves evidence. One runtime
      // record, caused by the signed approval request, states that a human
      // refused and that the mission stopped — so the public record can say
      // so without inventing it. Idempotent: a second press authors nothing.
      const lastClock = offlineSessionRef.current.records.at(-1)?.missionClockPosition ?? -1;
      const denied = appendHumanAuthorityDenial(offlineSessionRef.current, {
        missionClockPosition: Math.max(lastClock + 1, Math.round(applied.masterTime)),
        observedMasterTimeMs: Math.round(applied.masterTime),
      });
      offlineSessionRef.current = denied.session;
      setOfflineSession(denied.session);
    }
  };

  const runVerification = async () => {
    if (bundleStage !== "TRANSFERRED" || inspectionStage !== "REVEALED" || handoffArtifact === null) return;
    const run = ++verificationRun.current;
    setVerificationPending(true);
    const inserted = insertD006PebForAnalysis({
      pebText: handoffArtifact.pebText,
      expectedIdentity: handoffArtifact.identity,
      expectedTransferredContentDigest: handoffArtifact.transferredContentDigest,
    });
    const snapshot = await analyzeInsertedD006Peb(inserted);
    if (run !== verificationRun.current) return;
    setOfflineVerdict(snapshot);
    setVerificationResult(snapshot.result);
    setInspectionStage("VERIFIED");
    setVerificationPending(false);
  };

  // F5: insertion and verification are two separate acts.
  //
  // D-006A removed a six-click wizard and, in doing so, made the whole chain
  // start by itself the moment the artifact arrived. The physical review
  // rejected that: the verifier must acknowledge the artifact, hold at a
  // ready state, and wait. `analysisRequested` is the viewer's second act.
  // It is part of the guard, not merely a trigger, so no later state change
  // can restart the chain on its own.
  useEffect(() => {
    if (handoffArtifact === null || humanDecision === "DENIED" || bundleStage !== "TRANSFERRED") return;
    if (!analysisRequested) return;
    let cancelled = false;
    const advance = () => {
      if (cancelled) return;
      if (bundleStage !== "TRANSFERRED" || !analysisRequested) return;
      if (inspectionStage === "IDLE") setInspectionStage("INSPECTING");
      else if (inspectionStage === "INSPECTING") setInspectionStage("OPEN");
      else if (inspectionStage === "OPEN") setInspectionStage("REVEALED");
      else if (inspectionStage === "REVEALED" && verificationResult === null && !verificationPending) void runVerification();
    };
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const timer = setTimeout(advance, reducedMotion ? 0 : REVELATION_STEP_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysisRequested, bundleStage, handoffArtifact, humanDecision, inspectionStage, verificationPending, verificationResult]);

  useEffect(() => {
    if (bundleStage !== "TRANSFERRED" || analysisRequested) return;
    const frame = requestAnimationFrame(() => analyzeButtonRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [analysisRequested, bundleStage]);

  useEffect(() => {
    if (verificationResult === null) return;
    const frame = requestAnimationFrame(() => verdictRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [verificationResult]);

  useEffect(() => {
    if (offlineVerdict === null || networkState !== "LOST" || handoffArtifact === null) return;
    if (offlineVerdict.identity.missionId !== handoffArtifact.identity.missionId
      || offlineVerdict.identity.runId !== handoffArtifact.identity.runId
      || offlineVerdict.transferredContentDigest !== handoffArtifact.transferredContentDigest) return;
    setOfflineSession((current) => {
      if (current.networkState !== "LOST"
        || current.runId !== handoffArtifact.identity.runId
        || current.missionId !== handoffArtifact.identity.missionId
        || current.preRestorationCapture !== null) return current;
      const lastClock = current.records.at(-1)?.missionClockPosition ?? 0;
      const captured = capturePreRestorationArtifacts(current, {
        finalReceipt: {
          ref: handoffArtifact.finalReceipt.receiptId,
          value: handoffArtifact.finalReceipt as unknown as JsonValue,
        },
        portableEvidenceBundle: {
          ref: handoffArtifact.peb.bundleId,
          value: handoffArtifact.peb as unknown as JsonValue,
        },
        verdict: offlineVerdict.result.verdict,
        missionClockPosition: Math.max(lastClock + 1, Math.round(masterTimeRef.current)),
      });
      offlineSessionRef.current = captured.session;
      return captured.session;
    });
  }, [handoffArtifact, networkState, offlineVerdict]);

  useEffect(() => {
    // Reconciliation begins only when the link is physically connected and
    // the journal independently records a window awaiting reconciliation.
    if (linkPhase !== "CONNECTED"
      || reconciliationWindow !== "AWAITING_RECONCILIATION"
      || reconciliationWindowKey === null) return;
    if (reconciliationStartedRef.current) return;
    reconciliationStartedRef.current = true;
    let cancelled = false;
    let attemptFinished = false;
    const controller = new AbortController();
    const expectedRunId = offlineSession.runId;
    const expectedWindowKey = reconciliationWindowKey;
    const expectedHandoffArtifact = handoffArtifact;
    const expectedOfflineVerdict = offlineVerdict;
    const stillCurrent = () => !cancelled
      && activeRunIdRef.current === expectedRunId
      && offlineSessionRef.current.runId === expectedRunId
      && offlineSessionRef.current.networkState === "CONNECTED"
      && offlineWindowStatus(offlineSessionRef.current) === "AWAITING_RECONCILIATION"
      && awaitingReconciliationWindowKey(offlineSessionRef.current) === expectedWindowKey;
    const reconcile = async () => {
      setSyncPhase("ACKNOWLEDGING");
      const artifactIdentityMatches = expectedOfflineVerdict !== null
        && expectedHandoffArtifact !== null
        && expectedOfflineVerdict.identity.missionId === expectedHandoffArtifact.identity.missionId
        && expectedOfflineVerdict.identity.runId === expectedHandoffArtifact.identity.runId
        && expectedOfflineVerdict.transferredContentDigest === expectedHandoffArtifact.transferredContentDigest;
      const artifacts: ArtifactState | null = !artifactIdentityMatches ? null : {
        finalReceipt: {
          ref: expectedHandoffArtifact.finalReceipt.receiptId,
          value: expectedHandoffArtifact.finalReceipt as unknown as JsonValue,
        },
        portableEvidenceBundle: {
          ref: expectedHandoffArtifact.peb.bundleId,
          value: expectedHandoffArtifact.peb as unknown as JsonValue,
        },
        verdict: expectedOfflineVerdict.result.verdict,
      };
      if (expectedHandoffArtifact !== null
        && expectedHandoffArtifact.identity.missionId === MISSION_ID
        && expectedHandoffArtifact.identity.runId === expectedRunId) {
        try {
          await requestSameOriginEvidenceAcknowledgement({
            missionId: expectedHandoffArtifact.identity.missionId,
            runId: expectedHandoffArtifact.identity.runId,
            receiptId: expectedHandoffArtifact.finalReceipt.receiptId,
            receiptDigest: finalReceiptMember(expectedHandoffArtifact.finalReceipt).digest,
            bundleId: expectedHandoffArtifact.peb.bundleId,
            bundleDigest: expectedHandoffArtifact.peb.manifest.bundleDigest,
          }, globalThis.fetch, controller.signal);
          if (!stillCurrent()) return;
          setSyncPhase("ACKNOWLEDGED");
        } catch (error) {
          if (!stillCurrent() || (error instanceof DOMException && error.name === "AbortError")) return;
          setSyncPhase("FAILED");
        }
      }
      if (!stillCurrent()) return;
      // C3 §11: reconciliation is PERFORMED, not labelled. A second, distinct
      // base ledger is read, compared record-for-record against the journal up
      // to the restoration receipt, and the missing suffix is actually copied.
      // The frozen C1 validator then checks the before/after digests, prefix
      // order and exact transfer accounting — the operation earns COMPLETE or
      // it does not get it. The same-origin acknowledgement above remains an
      // identity acknowledgement and proves nothing about this transfer.
      const baseStore: BaseStore = (() => {
        try {
          return storageBaseStore(window.localStorage, MISSION_ID, expectedRunId);
        } catch {
          return memoryBaseStore(expectedRunId);
        }
      })();
      const performed = performBaseCompareTransfer(offlineSessionRef.current, baseStore);
      setBaseTransfer(performed);
      const result = reconcileOfflineEvidence({
        session: offlineSessionRef.current,
        operation: performed?.operation ?? null,
        capture: offlineSessionRef.current.preRestorationCapture,
        currentArtifacts: artifacts,
        receiptMissionClockPosition: Math.max(
          (offlineSessionRef.current.records.at(-1)?.missionClockPosition ?? -1) + 1,
          Math.round(masterTimeRef.current),
        ),
      });
      setReconciliation(result);
      if (result.status === "COMPLETE" && result.receipt !== null) {
        offlineSessionRef.current = result.session;
        setOfflineSession(result.session);
      }
      setSyncPhase(result.status === "COMPLETE" ? "ACKNOWLEDGED" : "FAILED");
      attemptFinished = true;
    };
    void reconcile();
    return () => {
      cancelled = true;
      controller.abort();
      // A transient loss of current sentinel truth cancels this attempt. It
      // must be eligible to retry when the same physical restoration becomes
      // current again; otherwise the window can be suppressed permanently.
      if (!attemptFinished) reconciliationStartedRef.current = false;
    };
    // Handoff/verdict values are snapshotted once per restoration window.
    // Later cinematic changes cannot restart or mutate an in-flight attempt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkPhase, offlineSession.runId, reconciliationWindow, reconciliationWindowKey]);

  /** Is a viewport point inside the verifier's insertion target? */
  const isOverInsertionTarget = useCallback((clientX: number, clientY: number) => {
    const target = verifierArtifactAnchorRef.current;
    if (target === null) return false;
    const box = target.getBoundingClientRect();
    // Match the visible dashed target and its outline offset. A larger hidden
    // success region makes an apparent miss count as an insertion.
    return pointWithinInsertionTarget(clientX, clientY, box);
  }, []);

  /** Put the artifact back where it came from. Nothing was handed over. */
  const returnArtifactToSource = useCallback((outcome: "MISS" | "CANCEL" = "MISS") => {
    const source = sourceArtifactAnchorRef.current;
    const pose = source === null ? null : measureArtifactPose(source);
    if (pose !== null) setArtifactPose(pose);
    setCarryMode("IDLE");
    setOverTarget(false);
    setBundleStage((stage) => resolveArtifactRelease(stage, outcome));
  }, [measureArtifactPose]);

  /** The viewer has put the artifact into the verifier. */
  const insertArtifact = useCallback(() => {
    if (bundleStage !== "FORMED" || carryMode === "IDLE") return;
    const target = verifierArtifactAnchorRef.current;
    const pose = target === null ? null : measureArtifactPose(target);
    if (pose !== null) setArtifactPose(pose);
    setCarryMode("IDLE");
    setOverTarget(false);
    setBundleStage((stage) => resolveArtifactRelease(stage, "INSERT"));
  }, [bundleStage, carryMode, measureArtifactPose]);

  /** Lift the artifact out of the Proof Tree. It is now in the viewer's hands. */
  const takeArtifact = useCallback((mode: "HELD" | "POINTER") => {
    if (bundleStage !== "SOURCE" || !evidenceTransferReady) return false;
    const source = sourceArtifactAnchorRef.current;
    const pose = source === null ? null : measureArtifactPose(source);
    if (pose === null) return false;
    setArtifactPose(pose);
    setBundleStage("FORMED");
    setCarryMode(mode);
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    document.getElementById("verification")?.scrollIntoView({
      behavior: reducedMotion ? "auto" : "smooth",
      block: "start",
    });
    return true;
  }, [bundleStage, evidenceTransferReady, measureArtifactPose]);

  const onArtifactPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!takeArtifact("POINTER")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }, [takeArtifact]);

  const onArtifactPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (carryMode !== "POINTER") return;
    const shellBounds = shellRef.current?.getBoundingClientRect();
    if (shellBounds === undefined) return;
    setArtifactPose((pose) => pose === null ? pose : {
      ...pose,
      x: event.clientX - shellBounds.left - pose.width / 2,
      y: event.clientY - shellBounds.top - pose.height / 2,
    });
    setOverTarget(isOverInsertionTarget(event.clientX, event.clientY));
  }, [carryMode, isOverInsertionTarget]);

  const onArtifactPointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (carryMode !== "POINTER") return;
    // Dropping anywhere but the target is a real miss: the evidence goes home
    // and no handoff is recorded.
    if (isOverInsertionTarget(event.clientX, event.clientY)) insertArtifact();
    else returnArtifactToSource();
  }, [carryMode, insertArtifact, isOverInsertionTarget, returnArtifactToSource]);

  const onArtifactPointerCancel = useCallback(() => {
    if (carryMode === "POINTER") returnArtifactToSource("CANCEL");
  }, [carryMode, returnArtifactToSource]);

  const sceneKind = sceneFor(story.moment.id);
  const networkStateLabel = linkPhase === "CONNECTED"
    ? d006d.connected
    : linkPhase === "LOST"
      ? d006d.lost
      : d006d.unknown;
  /**
   * The active Proof Tree's network evidence. Filtered by owning run as
   * well as by event type — defence in depth, not the fix itself: the
   * session reconstructed on mount already belongs to exactly one run, so
   * this should never have anything to remove. It is here so that a record
   * from another mission cannot be rendered even if one ever reached the
   * session, which is the property the physical review actually cares about.
   */
  /** Rows for exactly the leaves being drawn, so none falls back to a lane centre. */
  const proofRows = useMemo(() => layoutFor(proofLeaves, featuredLeafIds), [proofLeaves]);
  const verifierInspection = useMemo(
    () => verifierInspectionLayout(verifierFieldSize.width, verifierFieldSize.height),
    [verifierFieldSize.height, verifierFieldSize.width],
  );

  /**
   * The causal edges the EVIDENCE declares, between leaves that are both
   * drawn. A line to a node the viewer cannot see would invite them to infer
   * one, and temporal adjacency never produces an edge here — only a parent
   * the child's own evidence names.
   */
  const proofEdges = useMemo(() => {
    const positioned = new Map(proofLeaves.map((leaf) => [leaf.leafId, {
      x: proofLeafX(leaf.timeMs),
      y: proofRows.rows.get(leaf.leafId)?.y ?? TREE_ROWS[leaf.branch],
      branch: leaf.branch,
    }]));
    const growthByLeafId = new Map(proofLeafStates.map(({ leaf, growth }) => [leaf.leafId, growth]));
    return projectCausalEdges(proofLeaves).flatMap((edge) => {
      const from = positioned.get(edge.from);
      const to = positioned.get(edge.to);
      if (from === undefined || to === undefined) return [];
      const growth = Math.min(growthByLeafId.get(edge.from) ?? 0, growthByLeafId.get(edge.to) ?? 0);
      // C3-R1: an edge exists only between two leaves whose evidence is on
      // screen. A zero-growth connector, even fully transparent, is future
      // tree structure in the DOM — and the tree must not predict.
      if (growth <= 0) return [];
      return [{
        key: `${edge.relation}:${edge.from}->${edge.to}`,
        from, to,
        relation: edge.relation,
        growth,
        // An edge that leaves its lane is a boundary crossing: one domain's
        // evidence supporting another's. Worth seeing, and worth seeing as
        // different from a step within a single domain.
        crossesDomain: from.branch !== to.branch,
      }];
    });
  }, [proofLeaves, proofLeafStates, proofRows]);

  const structuralNetworkRecords = recordsForRun(offlineSession.records, activeRunId)
    .filter((record) => (
      record.eventType === "NETWORK_LINK_LOST"
      || record.eventType === "NETWORK_LINK_RESTORED"
      || record.eventType === "RECONCILIATION_RECEIPT"
    ));
  const presentationMotion = derivePresentationMotion(masterTime, routingExecutionAuthorized);
  const taxiLeft = stageX(presentationMotion.position);
  const emittingSources = new Set(activeEmissions
    .filter((item) => item.receiptProgress < .34)
    .map((item) => receiptEmissionSource(item.binding)));
  const emittingActors = new Set(activeEmissions
    .filter((item) => item.receiptProgress < .34)
    .map((item) => item.binding.producerDomain));
  const brakeLightsOn = presentationMotion.brakeLights;
  const networkTestDue = effectiveStoryTime >= storyBeatTime("garage-arrival")
    && effectiveStoryTime < storyBeatTime("work-complete")
    && networkState !== "LOST";

  return (
    <main
      ref={shellRef}
      className={`convergence-shell${masterTime > 0 ? " is-running" : ""}`}
      style={{
        "--stage-reality-h": `${STAGE_REALITY_HEIGHT_PX}px`,
        "--stage-ribbon-h": `${STAGE_RIBBON_HEIGHT_PX}px`,
        "--stage-proof-h": `${STAGE_PROOF_HEIGHT_PX}px`,
      } as CSSProperties}
      data-master-time={masterTime}
      data-effective-story-time={effectiveStoryTime}
      data-mission-id={MISSION_ID}
      data-mission-run={activeRunId}
      data-active-evidence-records={offlineSession.records.length}
      data-unsequenced-observation={unsequencedObservation ?? ""}
      data-link-phase={linkPhase}
      data-link-observation-current={linkObservationCurrent ? "true" : "false"}
      data-evidence-state={currentEvidenceState}
      data-offline-window={reconciliationWindow}
      data-sync-phase={syncPhase}
      data-network-receipts={structuralNetworkRecords.length}
      data-reconciliation-status={reconciliation?.status ?? "NOT_RUN"}
      data-final-receipt-id={finalMissionReceipt?.receiptId ?? ""}
      data-peb-id={portablePeb?.bundleId ?? ""}
      data-peb-digest={portablePeb?.manifest.bundleDigest ?? ""}
      data-transferred-content-digest={handoffArtifact?.transferredContentDigest ?? ""}
      data-displayed-evidence-ids={proofLeaves.map((leaf) => leaf.evidenceId).join(" ")}
      data-transferred-evidence-ids={portablePeb?.manifest.presentationEvidenceIds.join(" ") ?? ""}
      data-evidence-transfer-ready={evidenceTransferReady ? "true" : "false"}
      data-authority-gate={waitingForAuthority ? "true" : "false"}
      data-scene={sceneKind}
      data-bundle-stage={bundleStage}
      data-artifact-phase={bundleStage === "SOURCE" ? "AT_SOURCE" : bundleStage === "FORMED" ? "IN_TRANSIT" : "RECEIVED"}
      data-linked-actor={inspectedBinding?.producerDomain ?? ""}
      data-linked-branch={inspectedEvent?.branch ?? ""}
      data-linked-family={inspectedBinding?.receiptKind ?? ""}
      data-traffic-signal={signalState}
      data-routing-phase={routingState.phase}
      data-routing-request={routingState.routingRequest?.request_id ?? ""}
      data-routing-policy={routingState.routingPolicyRef ?? ""}
      data-routing-selected-source={routingState.selected?.source_id ?? ""}
      data-routing-selected-model={routingState.selected?.model_id ?? ""}
      data-routing-selected-provider={routingState.selected?.provider_id ?? ""}
      data-routing-selected-execution={routingState.selected?.execution_truth ?? ""}
      data-routing-resolved-source={routingState.resolved?.source_id ?? ""}
      data-routing-resolved-model={routingState.resolved?.model_id ?? ""}
      data-routing-resolved-provider={routingState.resolved?.provider_id ?? ""}
      data-routing-resolved-execution={routingState.resolved?.execution_truth ?? ""}
      data-routing-fallback-from={routingState.fallback?.from_candidate_id ?? ""}
      data-routing-fallback-to={routingState.fallback?.to_candidate_id ?? ""}
      data-routing-fallback-reason={routingState.fallback?.reason_code ?? ""}
      data-resulting-route={routingState.resultingRoute?.route_id ?? ""}
      data-resulting-route-source={routingState.resultingRoute?.route_source_ref ?? ""}
      data-bud-maturity={budMaturity.toFixed(3)}
      data-active-receipts={activeEmissions.length}
      data-proof-units={proofUnits.toFixed(3)}
      data-evidence-closure-state={evidenceClosure === null ? "REFUSED" : "VALID"}
      data-evidence-closure-reason={evidenceClosureState.reasonCode ?? ""}
      data-inspection-stage={inspectionStage}
      data-verification-state={verificationResult?.verdict ?? (verificationPending ? "VERIFYING" : "NOT_RUN")}
      data-passenger-phase={passenger.phase}
      data-cabin-occupied={passenger.aboardVehicle ? "true" : "false"}
      data-base-transferred-count={baseTransfer?.transferredCount ?? ""}
      data-base-local-count={baseTransfer?.localCount ?? ""}
      data-live-wait={networkTestDue ? "PHYSICAL_NETWORK" : "NONE"}
      data-supported-facts={missionFacts.filter((entry) => entry.status === "SUPPORTED").length}
    >
      <aside
        className="system-network-status"
        data-link-phase={linkPhase}
        data-sentinel={linkReport.sentinel}
        data-transition-flash={transitionFlash ?? "NONE"}
        aria-label={`${d006d.networkStatus}: ${networkStateLabel}.`}
        aria-live="polite"
      >
        <i className="network-link-glyph" aria-hidden="true"><span /><span /></i>
        <div>
          <strong>{networkStateLabel}</strong>
          <small>{d006d.externalReachabilityNotMeasured}</small>
        </div>
      </aside>
      {(linkPhase === "LOST" || transitionFlash === "LOST") && (
        <aside className="network-continuity-beat">
          <div><span>01</span><strong>{d006c2.network.lost}</strong></div>
          <i aria-hidden="true">→</i>
          <div><span>02</span><strong>{d006c2.network.missionContinues}</strong></div>
          <i aria-hidden="true">→</i>
          <div><span>03</span><strong>{d006c2.network.evidenceContinues}</strong></div>
        </aside>
      )}
      {transitionFlash === "RESTORED" && (
        <aside className="network-restored-event" aria-hidden="true">
          {d006c2.network.restoredEvent}
        </aside>
      )}
      <div className="artifact-transfer-layer">
        <div
          className={`artifact-transfer-object${artifactPose === null ? " is-unmeasured" : ""}${bundleStage === "SOURCE" && evidenceTransferReady ? " is-takeable" : ""}${carryMode !== "IDLE" ? " is-carried" : ""}${overTarget ? " is-over-target" : ""}`}
          onPointerDown={onArtifactPointerDown}
          onPointerMove={onArtifactPointerMove}
          onPointerUp={onArtifactPointerUp}
          onPointerCancel={onArtifactPointerCancel}
          data-transfer-stage={bundleStage}
          style={{
            "--artifact-x": `${artifactPose?.x ?? 0}px`,
            "--artifact-y": `${artifactPose?.y ?? 0}px`,
            "--artifact-w": `${artifactPose?.width ?? 128}px`,
            "--artifact-h": `${artifactPose?.height ?? 128}px`,
          } as CSSProperties}
        >
          <EvidenceFlower
            fills={familyFill}
            maturity={bundleStage === "SOURCE" ? budMaturity : 1}
            compact={bundleStage !== "SOURCE"}
            open={inspectionRank(inspectionStage) >= inspectionRank("OPEN")}
            attached={bundleStage === "SOURCE"}
            labels={d006c2.familyLabels}
            copy={d006c2.proof}
          />
          {bundleStage === "FORMED" && (
            <span className="artifact-transit-label">{d006c2.proof.sameArtifactTransit}</span>
          )}
        </div>
      </div>
      <p className="handoff-status" role="status" aria-live="polite">
        {bundleStage === "TRANSFERRED"
          ? d006c2.proof.handedOver
          : bundleStage === "FORMED"
            ? d006c2.proof.carryToVerifier
            : evidenceTransferReady
              ? d006c2.proof.portableReady
              : ""}
      </p>
      <header className="convergence-header">
        <a className="fortix-mark" href="#top" aria-label={`FortiX · ${d006c2.brandSubtitle}`}>
          <strong>FortiX</strong>
          <span>{d006c2.brandSubtitle}</span>
        </a>
        {/*
          C3-R1 §6: the public language mode, as plain as it can be — EN | FR.
          Live switch through the existing i18n architecture (the provider
          already persists the choice for the session); no reload, no second
          translation mechanism.
        */}
        <div className="language-mode" role="group" aria-label={`${d006c2.switchToEnglish} / ${d006c2.switchToFrench}`}>
          <button
            type="button"
            aria-pressed={locale === "en"}
            onClick={() => setLocale("en")}
            aria-label={d006c2.switchToEnglish}
          >EN</button>
          <i aria-hidden="true" />
          <button
            type="button"
            aria-pressed={locale === "fr"}
            onClick={() => setLocale("fr")}
            aria-label={d006c2.switchToFrench}
          >FR</button>
        </div>
        <ol className="journey-language" aria-label={d006c2.journeyLabel}>
          {d006c2.journey.map((label, index) => (
            <li key={label} className={index <= journeyStage(effectiveStoryTime, bundleStage, verificationResult) ? "is-active" : ""}>
              <span>{String(index + 1).padStart(2, "0")}</span>{label}
            </li>
          ))}
        </ol>
      </header>

      <section id="top" className="mission-intro" aria-labelledby="mission-title">
        <div>
          <p className="section-index">{d006c2.missionKicker}</p>
          <h1 id="mission-title">{d006c2.heroQuestion}<br />{d006c2.heroAnswer}</h1>
        </div>
        <p>{d006c2.heroIntro}</p>
      </section>

      <section className="master-instrument" aria-label={d006c2.missionClock}>
        <div className="transport">
          <button type="button" onClick={restart} aria-label={d006c2.startOver}>↤</button>
          <button
            type="button"
            className="play-control"
            disabled={waitingForAuthority || humanDecision === "DENIED"}
            onClick={() => {
              if (masterTime >= EXPERIENCE_DURATION_MS) restart();
              // "Call a taxi": the start of a demonstration, and the one
              // place a new mission may begin without the viewer asking to
              // start over. Pause/Continue mid-run never renames the mission.
              else if (!isPlaying && masterTime === 0) beginDemonstration();
              else setIsPlaying((value) => !value);
            }}
          >
            <span aria-hidden="true">{isPlaying ? "Ⅱ" : "▶"}</span>
            {isPlaying ? d006c2.pause : masterTime === 0 ? d006c2.callTaxi : d006c2.continueMission}
          </button>
        </div>
        <div className="clock-readout">
          <span>{d006c2.missionClock}</span>
          <strong data-testid="master-time">{formatExperienceTime(masterTime)}</strong>
        </div>
        <div className="clock-track">
          <input
            type="range"
            min="0"
            max={EXPERIENCE_DURATION_MS}
            step="1"
            value={masterTime}
            aria-label={d006c2.missionClock}
            onPointerDown={() => setIsPlaying(false)}
            onChange={(event) => seek(Number(event.target.value))}
            style={{ "--progress": `${progress * 100}%` } as CSSProperties}
          />
          <div aria-hidden="true"><span>00:00</span><span>02:06</span></div>
        </div>
      </section>

      <section className="dual-timeline" aria-label={d006c2.timelineAria}>
        <div className="shared-clock-cursor" style={{ left: `${Math.max(2, progress * 100)}%` }} aria-hidden="true"><i /></div>
        {networkTestDue && (
          /*
            C3 §8: waiting for a live event, stated as a policy rather than
            left ambiguous. The chosen clock policy is B — THE MISSION CLOCK
            CONTINUES while the system waits — because canonical doctrine keeps
            network state, execution and evidence independent: pausing the
            mission here would encode "the mission needs the cable to fail",
            which is exactly the dependence the three dimensions forbid. LOST
            appears only when the sentinel observes it; if the cable is never
            pulled, this scene truthfully never occurs.
          */
          <aside
            className="network-test-cue"
            role="note"
            data-live-wait="PHYSICAL_NETWORK"
            data-live-wait-clock="CONTINUES"
          >
            <span>{d006c2.network.testLabel}</span>
            <strong>{d006c2.network.testInstruction}</strong>
            <small>{d006c3.network.waitingLive}</small>
          </aside>
        )}
        {currentEvidenceState === "LOCAL" && reconciliationWindow !== "NONE" && (
          <aside className="local-evidence-continuity" aria-live="polite">
            <span>{d006d.evidenceContinuesLocal}</span>
            <strong>{D006_MISSION_LABEL} · {d006d.sameMission}</strong>
            {finalMissionReceipt !== null && (
              <small title={finalMissionReceipt.receiptId}>
                {d006d.finalReceiptLocal} · {shortEvidenceId(finalMissionReceipt.receiptId)}
              </small>
            )}
          </aside>
        )}
        {waitingForAuthority && <AuthorityWorkspace onDecision={decide} copy={d006c2.authority} />}

        <article className="timeline-band reality-timeline" data-band="reality">
          <TimelineLabel number="01" title={d006c2.bands.happened} subtitle={d006c2.bands.happenedSubtitle} />
          <div className="reality-canvas">
            <div className="city-grid" aria-hidden="true" />
            <div className="city-road" aria-hidden="true"><i /><i /></div>
            <CityActors
              storyTime={effectiveStoryTime}
              maintenanceActionProgress={physical.maintenanceActionProgress}
              signalState={signalState}
              emitting={emittingSources}
              emittingActors={emittingActors}
              linkedActor={inspectedBinding?.producerDomain ?? null}
              actorLabels={d006c2.actorLabels}
              signalLabels={d006c2.signalStates}
            />
            {/*
              C3 §5: boarding HAPPENS. The figure below is driven by the same
              physical state machine as the taxi — it waits at the curb, walks
              to the door while the taxi is aligned, disappears from the street
              exactly while the cabin shows an occupant, steps out at the
              destination, and is still standing there when the taxi departs
              without it. "PASSENGER PICKED UP" is a caption of this motion,
              never a substitute for it.
            */}
            {passenger.visibleOutside && (
              <div
                className={`passenger-actor is-${passenger.phase.toLowerCase().replace(/_/g, "-")}${effectiveStoryTime < ACCEPT_TIME_MS ? " is-requesting" : ""}${emittingSources.has(EMISSION_SOURCE.customer) ? " is-emitting" : ""}`}
                data-passenger-phase={passenger.phase}
                data-walk-progress={passenger.walkProgress.toFixed(3)}
                style={{
                  "--prop-x": `${stageX(passenger.position)}%`,
                  "--prop-bottom": "87px",
                  "--passenger-facing": passenger.facing,
                  "--walk-progress": passenger.walkProgress,
                } as CSSProperties}
                aria-label={`${d006c2.actorLabels.You} · ${d006c3.passenger.phases[passenger.phase]}`}
              >
                <i className="passenger-figure" aria-hidden="true" />
                <span>{d006c2.actorLabels.You}</span>
              </div>
            )}
            <div
              className={`autonomous-taxi is-${physical.vehicleState.toLowerCase()}${brakeLightsOn ? " has-brake-lights" : ""}${effectiveStoryTime >= 5_000 && effectiveStoryTime < 8_000 ? " is-acknowledging" : ""}${passenger.aboardVehicle ? " has-passenger" : ""}`}
              data-motion={presentationMotion.phase}
              data-cabin-occupied={passenger.aboardVehicle ? "true" : "false"}
              data-facing={presentationMotion.facing === -1 ? "left" : "right"}
              style={{
                left: `${taxiLeft}%`,
                "--taxi-pitch": `${presentationMotion.pitchDeg}deg`,
                "--taxi-facing": presentationMotion.facing,
                "--taxi-lane": `${presentationMotion.lanePx}px`,
              } as CSSProperties}
              aria-label={`${d006c2.actorLabels.Vehicle}: ${publicEventLabel}`}
            >
              {/*
                Lamps are anchored in the taxi's LOCAL frame: head lights on
                the front edge, rear lights on the back edge. The whole
                element carries scaleX(--taxi-facing), so when the vehicle
                genuinely turns around on the return leg the lamps turn with
                it and the rear stays the rear. Nothing here is positioned
                from screen direction, so no interpolation can swap them.
              */}
              <span>07</span><i /><i />
              {/*
                C3 §5: while the passenger is aboard, the cabin is visibly
                occupied. The occupant is the SAME participant the street
                figure represents — exactly one of the two renders at a time.
              */}
              {passenger.aboardVehicle && <b className="cabin-occupant" aria-hidden="true" />}
              <b className="head-light head-light-upper" /><b className="head-light head-light-lower" />
              <b className="brake-light brake-light-upper" /><b className="brake-light brake-light-lower" />
              {brakeLightsOn && <span className="brake-status">{d006c2.eventLabels.brake}</span>}
              {effectiveStoryTime >= 5_000 && effectiveStoryTime < 8_000 && (
                <span className="acknowledgement-status">{d006c2.eventLabels.accept}</span>
              )}
              {emittingSources.has("vehicle") ? <u className="actor-emission" aria-hidden="true" /> : null}
            </div>
            <div className={`reality-event event-tone-${currentEvent.tone}`}>
              <span data-actor-source={currentEventBinding === null ? "SCENE" : "CANONICAL_RECEIPT"}>{publicActorLabel}</span>
              <strong>{publicEventLabel}</strong>
            </div>
            <ol
              className="public-causal-layer"
              data-causal-kind={publicScene.kind}
              data-evidence-bound={currentEventBinding === null ? "false" : "true"}
              aria-label={d006c2.journeyLabel}
            >
              {publicCausalSteps.map((step, index) => (
                <li
                  key={`${publicScene.kind}-${index}`}
                  className={index === publicCausalSteps.length - 1 ? "is-current" : ""}
                  aria-current={index === publicCausalSteps.length - 1 ? "step" : undefined}
                >
                  <span>{String(index + 1).padStart(2, "0")}</span><strong>{step}</strong>
                </li>
              ))}
            </ol>
            {routingState.phase !== "NOT_TRIGGERED" && (
              <aside
                className="routing-provenance-cue"
                data-routing-phase={routingState.phase}
                data-selected-provider={routingState.selected?.provider_id ?? ""}
                data-resolved-provider={routingState.resolved?.provider_id ?? ""}
                data-execution-truth={routingState.resolved?.execution_truth ?? routingState.selected?.execution_truth ?? ""}
              >
                <span>{d006c2.routing.title}</span>
                <strong>{routingState.resultingRoute === null ? d006c2.routing.recalculating : d006c2.routing.ready}</strong>
                <small>{d006c2.routing.simulatedProvider}</small>
                <details>
                  <summary>{d006c2.routing.technicalDetails}</summary>
                  <code>{routingState.phase} · {routingState.selected?.provider_id ?? "—"} → {routingState.resolved?.provider_id ?? "—"} · {routingState.resultingRoute?.route_id ?? "—"}</code>
                </details>
              </aside>
            )}
            {evidenceTransferReady && (
              <aside className="base-completion-cue" aria-label={d006c2.completion.missionComplete}>
                <span>{d006c2.completion.missionComplete}</span>
                <strong>{d006c2.completion.portableEvidenceReady}</strong>
                <small>{d006c2.completion.readyToCarry}</small>
              </aside>
            )}
            {humanDecision === "DENIED" && (
              <aside className="authority-denied" aria-label={d006c2.completion.stopped}>
                <span>{d006c2.completion.stopped}</span>
                <strong>{d006c2.completion.noApproval}</strong>
                <button type="button" onClick={restart}>{d006c2.completion.restart}</button>
              </aside>
            )}
          </div>
          <div className="event-ribbon" aria-label={d006c2.eventRibbonAria}>
            {VISUAL_EVENTS.filter((event) => event.featured).map((event) => (
              <button
                key={event.id}
                type="button"
                data-event-id={event.id}
                className={`${event.timeMs <= effectiveStoryTime ? "is-reached" : ""}${event.id === currentEvent.id ? " is-current" : ""}${event.id === inspectedEventId ? " is-inspected" : ""}`}
                aria-describedby={event.id === inspectedEventId ? "receipt-inspection" : undefined}
                onClick={() => setPinnedEventId((current) => (current === event.id ? null : event.id))}
                onMouseEnter={() => setHoveredEventId(event.id)}
                onMouseLeave={() => setHoveredEventId(null)}
                onFocus={() => setPinnedEventId(event.id)}
                onBlur={() => setPinnedEventId(null)}
              >
                <i className={`event-tone-${event.tone}`} /><span>{d006c2.eventLabels[event.id] ?? event.id}</span>
              </button>
            ))}
          </div>
        </article>

        <div className="receipt-layer" aria-hidden={activeEmissions.length === 0}>
          {activeEmissions.map(({ binding, receiptKind, tone, receiptProgress }) => (
            <ReceiptTransfer
              key={binding.receiptId}
              binding={binding}
              tone={tone}
              progress={receiptProgress}
              origin={receiptOrigin(binding, presentationMotion.position)}
              target={{ x: proofLeafX(binding.timeMs), y: receiptTargetY(binding, proofRows.rows) }}
              kindLabel={d006c2.receiptKinds[receiptKind]}
              actorLabel={d006c2.actorLabels[binding.producerDomain] ?? binding.producerDomain}
              copy={d006c2.proof}
            />
          ))}
        </div>

        <article className="timeline-band proof-timeline" data-band="proof">
          <TimelineLabel number="02" title={d006c2.bands.evidence} subtitle={d006c2.bands.evidenceSubtitle} />
          <div ref={proofCanvasRef} className="proof-tree-canvas" aria-label={`${d006c2.proof.treeAria}: ${matureProofCount}`}>
            <div className="proof-root" aria-hidden="true"><i /><i /><i /></div>
            <div className="proof-spine" style={{ width: `${Math.max(0, proofProgress - 5)}%` }} aria-hidden="true" />
            {/*
              D-006G P2R. Every leaf below is a projection of a real evidence
              object — a signed canonical object or an append-only runtime
              record — and carries that object's own evidence id and digest in the
              DOM. Nothing here is authored for the screen: the presentation
              table that used to drive this band could produce a leaf with no
              evidence behind it, so a viewer counting leaves was counting
              design decisions. The Master Clock filters by timestamp and does
              nothing else; it cannot create a leaf, which is why rewinding
              removes future evidence for the same reason it never showed it.
            */}
            {/*
              D-006G P3-C. The causal edges, drawn from the same projection the
              leaves come from. A line here means one evidence object NAMES
              another as its parent; there is no edge for "these happened near
              each other", because a viewer reading adjacency as causation is
              exactly the misreading a causal graph exists to prevent. An edge
              whose parent is outside the drawn set is not drawn at all — a line
              running off to nothing invites the viewer to imagine a node.
            */}
            <svg
              className="proof-edges"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              aria-hidden="true"
              focusable="false"
            >
              {proofEdges.map((edge) => (
                <path
                  key={edge.key}
                  className={`proof-edge${edge.crossesDomain ? " crosses-domain" : ""}${edge.relation === "OBSERVED_INPUT" ? " observed-input" : ""}`}
                  data-crosses-domain={edge.crossesDomain ? "true" : "false"}
                  data-relation={edge.relation}
                  data-growth={edge.growth.toFixed(3)}
                  // A shallow S through the spine: the eye follows the
                  // curve without the line ever pretending to be a timeline.
                  d={`M ${edge.from.x} ${edge.from.y} C ${(edge.from.x + edge.to.x) / 2} ${edge.from.y}, ${(edge.from.x + edge.to.x) / 2} ${edge.to.y}, ${edge.to.x} ${edge.to.y}`}
                  style={{
                    clipPath: `inset(0 ${(1 - edge.growth) * 100}% 0 0)`,
                    opacity: edge.growth,
                  }}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </svg>
            {proofLeaves.map((leaf) => {
              const growth = leafGrowthForLeaf(leaf, masterTime);
              // C3-R1: NO BRANCH BEFORE ITS EVIDENCE EXISTS. A leaf whose
              // nano-receipt is still in flight renders NOTHING — not an
              // invisible box, nothing. The flying receipt is the only
              // visible object until it lands; the terminal then materialises
              // exactly where the flight ended, and only after that does the
              // branch grow toward it. The layout is still computed over the
              // full projected set (internal geometry is allowed to know the
              // future; the rendered tree is not).
              if (growth <= 0) return null;
              const phases = leafCausalPhases(growth);
              const x = proofLeafX(leaf.timeMs);
              const y = proofRows.rows.get(leaf.leafId)?.y ?? TREE_ROWS[leaf.branch];
              const side = y < 50 ? "above" : "below";
              const active = growth > 0 && growth < 1;
              return (
                <div
                  key={leaf.leafId}
                  data-branch={leaf.branch}
                  data-event-id={leaf.leafId}
                  data-evidence-id={leaf.evidenceId}
                  data-evidence-digest={leaf.digest}
                  data-evidence-source={leaf.source}
                  data-assurance={leaf.assurance}
                  data-domain={leaf.domain}
                  data-side={side}
                  data-label-side={labelSides[leaf.leafId] ?? "right"}
                  data-featured={featuredLeafIds.has(leaf.leafId) ? "true" : "false"}
                  title={leaf.evidenceId}
                  className={`proof-leaf event-tone-${leafTone(leaf)}${growth > 0 ? " is-grown" : ""}${active ? " is-active" : ""}${phases.locked ? " is-locked" : ""}${leaf.leafId === inspectedBinding?.leafId ? " is-linked" : ""}${leaf.assurance === "QUARANTINED" ? " is-quarantined" : ""}`}
                  style={{
                    "--leaf-x": `${x}%`,
                    "--branch-top": `${Math.min(y, 50)}%`,
                    // No minimum here. The leaf's dot is anchored to the far
                    // edge of this box, so clamping the height to keep a short
                    // stem visible MOVED THE LEAF: rows computed 17.4px apart
                    // rendered 8px apart near the spine, and captions that the
                    // layout had separated overlapped again. The stem keeps its
                    // minimum length in CSS, where it costs nothing.
                    "--branch-height": `${Math.abs(50 - y)}%`,
                    // C3-R1 causal order, sourced from leafCausalPhases: the
                    // container and terminal materialise FIRST (the landed
                    // nano-receipt), the stem grows toward it SECOND, and the
                    // lock settles THIRD. The old timing scaled the stem from
                    // the first instant and produced a branch reaching for a
                    // node that did not exist yet.
                    "--growth-progress": phases.nrAppear,
                    "--stem-progress": phases.stem,
                    "--terminal-progress": phases.nrAppear,
                    "--lock-progress": phases.lock,
                  } as CSSProperties}
                >
                  <i aria-hidden="true" />
                  {leaf.assurance === "QUARANTINED" && (
                    <strong className="proof-assurance-marker">{d006d.quarantined}</strong>
                  )}
                  <span>
                    <b>{d006c2.actorLabels[leaf.domain] ?? d006c2.proof.source}</b>
                    {d006c2.proof.evidence}
                  </span>
                </div>
              );
            })}
            {inspectedEvent !== null && inspectedBinding !== null && (
              <aside
                id="receipt-inspection"
                className={`receipt-inspection${proofLeafX(inspectedBinding.timeMs) < 50 ? " is-right" : ""}`}
                aria-label={d006c2.proof.receiptDetail}
              >
                <span className="receipt-inspection-kind">{d006c2.receiptKinds[inspectedBinding.receiptKind]}</span>
                <strong>{d006c2.eventLabels[inspectedEvent.id] ?? inspectedEvent.id}</strong>
                <dl>
                  <div><dt>{d006c2.proof.producedBy}</dt><dd>{d006c2.actorLabels[inspectedBinding.producerDomain] ?? inspectedBinding.producerDomain}</dd></div>
                  <div><dt>{d006c2.proof.recordedAt}</dt><dd>{formatOperationalTime(inspectedBinding.timeMs)}</dd></div>
                  <div><dt>{d006c2.proof.evidence}</dt><dd title={inspectedBinding.evidenceId}>{shortEvidenceId(inspectedBinding.evidenceId)}</dd></div>
                </dl>
              </aside>
            )}
            <div className="bud-branch" style={{ width: `${budMaturity * 11}%` }} aria-hidden="true" />
            <div ref={sourceArtifactAnchorRef} className="artifact-source-anchor" aria-hidden="true" />
            {evidenceTransferReady && bundleStage === "SOURCE" && (
              <button type="button" className="handover-control" onClick={() => takeArtifact("HELD")}>
                <span>{d006c2.proof.portableReady}</span>
                <strong>{d006c2.proof.take}</strong>
              </button>
            )}
            {evidenceTransferReady && bundleStage === "SOURCE" && linkPhase === "LOST" && (
              <p className="handover-local">{d006c2.proof.localFinalReceipt}</p>
            )}
            {bundleStage === "FORMED" && carryMode === "POINTER" && (
              <p className="handover-done">{d006c2.proof.carryToVerifier}</p>
            )}
            {bundleStage === "TRANSFERRED" && <p className="handover-done">{d006c2.proof.handedOver}</p>}
          </div>
        </article>
      </section>

      <section id="verification" className="evidence-handoff" aria-labelledby="handoff-title">
        <header>
          <div>
            <p className="section-index">{d006c2.verifier.step}</p>
            <h2 id="handoff-title">{d006c2.verifier.title}</h2>
            <p className="handoff-intro">{d006c2.verifier.subtitle}</p>
          </div>
        </header>

        <div className="handoff-workbench">
          {/*
            C3-R1: the verifier has ONE canonical presentation — light. The
            light/dark control and its runtime state were removed by human
            decision; there is no hidden dark variant behind a flag.
          */}
          <article
            className={`verifier-instrument${bundleStage === "FORMED" ? " is-awaiting-evidence" : ""}${bundleStage === "TRANSFERRED" ? " has-bud" : ""}${inspectionStage !== "IDLE" ? " is-revealing" : ""}`}
            aria-busy={verificationPending}
          >
            <div className="instrument-heading">
              <div><span>{d006c2.verifier.heading}</span><small>{d006c2.verifier.localDeterministic}</small></div>
              <i className={verificationPending ? "is-analyzing" : ""} />
            </div>
            <details className="verifier-identity">
              <summary>{d006c2.verifier.identitySummary}</summary>
              <div>
                <strong>{d006c2.verifier.identityTitle}</strong>
                <dl>
                  <div><dt>{d006c2.verifier.profile}</dt><dd><code>{INDEPENDENT_VERIFICATION_PROFILE}</code></dd></div>
                  <div><dt>{d006c2.verifier.key}</dt><dd><code>{verificationResult === null ? "—" : PINNED_TRUST_ANCHORS[0]?.keyId}</code></dd></div>
                  <div><dt>{d006c2.verifier.trustAnchor}</dt><dd><code>{verificationResult === null ? "—" : PINNED_TRUST_ANCHORS[0]?.trustAnchorId}</code></dd></div>
                  <div><dt>{d006c2.verifier.scope}</dt><dd><code>{handoffArtifact === null ? MISSION_ID : `${handoffArtifact.identity.missionId} · ${handoffArtifact.identity.runId}`}</code></dd></div>
                  <div><dt>{d006c2.verifier.transport}</dt><dd>{d006c2.verifier.noNetworkRequired}</dd></div>
                </dl>
              </div>
            </details>
            <div
              ref={verifierChamberRef}
              className="revelation-chamber"
              style={{
                "--inspection-top-radius": `${VERIFIER_FIELD_TOP_RADIUS_PX}px`,
                "--inspection-bottom-radius": `${VERIFIER_FIELD_BOTTOM_RADIUS_PX}px`,
              } as CSSProperties}
              aria-label={d006c2.verifier.chamberAria}
            >
              <i className="chamber-ring ring-one" /><i className="chamber-ring ring-two" />
              <button
                ref={verifierArtifactAnchorRef}
                type="button"
                className={`artifact-target-anchor insertion-control${carryMode !== "IDLE" ? " is-awaiting" : ""}${overTarget ? " is-armed" : ""}`}
                aria-label={d006c2.verifier.insert}
                disabled={bundleStage !== "FORMED" || carryMode !== "HELD"}
                onClick={insertArtifact}
              />
              {carryMode !== "IDLE" && bundleStage !== "TRANSFERRED" && (
                <p className="insertion-hint">{overTarget ? d006c2.verifier.releaseToInsert : d006c2.verifier.insertHere}</p>
              )}
              <div className={`revealed-structure${bundleStage === "TRANSFERRED" ? " is-visible" : ""}${analysisRequested ? " is-analyzing" : ""}`} aria-label={d006c2.verifier.structureAria}>
                {verifierInspection.labels.map(({ family, box }) => (
                  <i
                    key={family}
                    className={`inspection-family family-${family}`}
                    style={{
                      left: `${box.left}px`,
                      top: `${box.top}px`,
                      width: `${box.width}px`,
                      height: `${box.height}px`,
                    }}
                  ><span>{d006c2.familyLabels[family]}</span></i>
                ))}
              </div>
            </div>
            {bundleStage === "SOURCE" && <p className="instrument-idle">{d006c2.verifier.waiting}</p>}
            {bundleStage === "FORMED" && carryMode === "POINTER" && (
              <p className="instrument-idle">{d006c2.verifier.carryInstruction}</p>
            )}
            {bundleStage === "TRANSFERRED" && !analysisRequested && (
              <div className="instrument-ready">
                <p className="instrument-received">
                  <span>{d006c2.verifier.received}</span>
                  <strong>{d006c2.verifier.ready}</strong>
                </p>
                <button
                  ref={analyzeButtonRef}
                  type="button"
                  className="analyze-control"
                  onClick={() => setAnalysisRequested(true)}
                >
                  {d006c2.verifier.analyze}
                </button>
              </div>
            )}
            {verificationResult !== null && (
              <div
                ref={verdictRef}
                className={`instrument-verdict verdict-${verificationResult.verdict.toLowerCase()}`}
                data-testid="operational-verdict"
                tabIndex={-1}
              >
                <span>{d006c2.verifier.result}</span>
                {/*
                  One line per verdict, never a binary. This used to branch
                  only on INVALID, so INDETERMINATE — which is what this
                  demonstration's bundle actually returns, every run — was
                  headlined "Evidence holds.", and REVOKED would have been
                  too. A verdict the vocabulary does not contain was being
                  asserted in the largest type on the panel, with the
                  qualification four elements below it. That is precisely
                  probabilistic reading becoming cryptographic claim.
                */}
                <strong>{d006c2.verifier.verdicts[verificationResult.verdict].headline}</strong>
                <small>{verificationResult.completedChecks.length} · {d006c2.verifier.verdicts[verificationResult.verdict].scope}</small>
                {/*
                  C3 §21: the verifier evaluates FACTS; the cryptography
                  explains HOW. Each line is a public fact inspected against
                  the exact transferred coverage — a fact this artifact does
                  not carry reads NOT COVERED rather than borrowing the
                  mission's word, and settlement stays NOT DEMONSTRATED.
                */}
                {factInspections !== null && (
                  <ul className="verdict-facts" aria-label={d006c3.facts.inspectionAria}>
                    {factInspections.filter((inspection) => inspection.status !== "NOT_PRESENTED").map((inspection) => (
                      <li
                        key={inspection.factId}
                        data-fact-id={inspection.factId}
                        data-inspection-status={inspection.status}
                        data-evidence-ids={inspection.evidenceIds.join(" ")}
                      >
                        <span>{d006c3.facts.statements[inspection.factId] ?? inspection.factId}</span>
                        <b>{d006c3.inspectionStatus[inspection.status]}</b>
                      </li>
                    ))}
                  </ul>
                )}
                <details className="verdict-technical">
                  <summary>{d006c3.verifier.technicalDetails}</summary>
                  <ul className="verdict-checks" aria-label={d006c2.verifier.checksAria}>
                    {verificationResult.completedChecks.map((check) => (
                      <li key={check} data-check-id={check}><i aria-hidden="true" />{d006c2.verifier.checkLabels[check] ?? check}</li>
                    ))}
                  </ul>
                </details>
                {/*
                  What the verifier did NOT establish, stated as plainly as
                  what it did. A checks list on its own invites the reader to
                  assume everything else was fine too.

                  These two lines used to read "no signature was verified" and
                  "authenticity of the issuer is not established". Both are now
                  false: P2R implements the D-005M signature scheme and every
                  object is checked against the bundle's declared keys. Leaving
                  them would understate the verifier as badly as the original
                  overstated it. What genuinely remains unestablished is the
                  production trust base, and the settlement the payload asserts
                  without any financial institution in the evidence.
                */}
                {verificationResult.completedChecks.length > 0 && (
                  <ul className="verdict-not-established" aria-label={d006c2.verifier.limitsAria}>
                    <li><i aria-hidden="true" />{d006c2.verifier.productionTrustMissing}</li>
                    <li><i aria-hidden="true" />{d006c2.verifier.settlementNotShown}</li>
                  </ul>
                )}
                <p className="verdict-reading">{d006c2.verifier.verdicts[verificationResult.verdict].reading}</p>
                <small className="verdict-token">{d006c2.verifier.canonicalVerdict} · {verificationResult.verdict}</small>
              </div>
            )}
          </article>
          {/*
            C3 §16: the public factual mission record — what this portable
            evidence PRESENTS, in plain statements, each row carrying its
            evidence ids in the DOM. It appears once the artifact is opened,
            before any verdict, so FACT (presented) stays distinct from
            VERDICT (verified): the statuses here say "supported by evidence
            in this record", never "independently verified".
          */}
          {bundleStage === "TRANSFERRED" && inspectionRank(inspectionStage) >= inspectionRank("OPEN") && (
            <MissionFactRecord
              facts={missionFacts}
              copy={d006c3.facts}
              sectionLabels={d006c3.factSections}
              statusLabels={d006c3.factStatus}
            />
          )}
          {verificationResult !== null && (<TransversalityReveal copy={d006c2.transversality} />)}
          {(reconciliationWindow === "AWAITING_RECONCILIATION"
            || reconciliation !== null
            || syncPhase === "ACKNOWLEDGED") && (
            <aside
              className={`reconciliation-receipt reconciliation-${reconciliation?.status.toLowerCase() ?? RECONCILIATION_PENDING_STATE}`}
            >
              <span>{d006d.reconciliation}</span>
              <strong>
                {syncPhase === "ACKNOWLEDGING"
                  ? d006d.reconciliationPending
                  : reconciliation?.status === "COMPLETE"
                    ? d006d.reconciliationComplete
                    : reconciliation?.status === "FAILED"
                      ? d006d.reconciliationFailed
                      : d006d.reconciliationPending}
              </strong>
              <small>{d006d.sameOriginDemoScope}</small>
              {reconciliation?.status === "COMPLETE" && reconciliation.receipt !== null && (
                /*
                  C3 §12: the spectator sees the WORK — how many records the
                  run held locally, how many the base was missing, how many
                  actually moved — read from the verified receipt, never from
                  the raw attempt. The alignment strip below animates exactly
                  the transferred fraction.
                */
                <div
                  className="reconciliation-transfer"
                  data-transferred-count={reconciliation.receipt.transferredObjectCount}
                  data-local-count={reconciliation.receipt.localObjectCount}
                >
                  <dl>
                    <div><dt>{d006c3.reconciliation.localRecords}</dt><dd>{reconciliation.receipt.localObjectCount}</dd></div>
                    <div><dt>{d006c3.reconciliation.transferred}</dt><dd>{reconciliation.receipt.transferredObjectCount}</dd></div>
                    <div><dt>{d006c3.reconciliation.digests}</dt><dd>{d006c3.reconciliation.digestsMatch}</dd></div>
                  </dl>
                  <i
                    className="transfer-align"
                    aria-hidden="true"
                    style={{
                      "--transfer-fraction": reconciliation.receipt.localObjectCount === 0
                        ? 0
                        : reconciliation.receipt.transferredObjectCount / reconciliation.receipt.localObjectCount,
                    } as CSSProperties}
                  ><span /></i>
                </div>
              )}
              {reconciliation?.status === "COMPLETE" && (
                <>
                  {/*
                    P2R-2: these ticks are shown only where a comparison
                    actually happened. The receipt states which operation ran,
                    and the panel follows it rather than asserting over it.
                  */}
                  {reconciliation.receipt?.digestComparison === "MATCH" ? (
                    <>
                      <em className="reconciliation-scope">
                        {reconciliation.receipt.reconciliationResult}
                      </em>
                      <ul aria-label={d006d.reconciliationComplete}>
                        {Object.values(d006d.immutableChecks).map((label) => (
                          <li key={label}>{label}<b>{d006d.unchanged}</b></li>
                        ))}
                      </ul>
                    </>
                  ) : (
                    <em className="reconciliation-scope">
                      {reconciliation.receipt?.reconciliationResult ?? ""}
                    </em>
                  )}
                </>
              )}
              {reconciliation?.status === "FAILED" && (
                <>
                  <code>{reconciliation.reasonCodes.join(" · ")}</code>
                </>
              )}
            </aside>
          )}
        </div>
      </section>

      <footer className="convergence-footer"><strong>FortiX</strong><span>{d006c2.footer}</span></footer>
    </main>
  );
}

function AuthorityWorkspace({ onDecision, copy }: {
  onDecision: (decision: Exclude<HumanDecision, "PENDING">) => void;
  copy: Dictionary["d006c2"]["authority"];
}) {
  return (
    <aside
      className="human-decision-instrument authority-workspace"
      aria-label={copy.aria}
    >
      <header>
        <span>{copy.boundary}</span>
        <strong>{copy.required}</strong>
        <p>{copy.question}</p>
      </header>
      <dl className="authority-values">
        <div><dt>{copy.requested}</dt><dd>{copy.requestedAmount}</dd></div>
        <div><dt>{copy.autonomousLimit}</dt><dd>{copy.limitAmount}</dd></div>
      </dl>
      <div className="authority-actions">
        <p>{copy.localEvidence}</p>
        <small>{copy.noSettlement}</small>
        <div>
          <button type="button" onClick={() => onDecision("APPROVED")}>{copy.allow}</button>
          <button type="button" onClick={() => onDecision("DENIED")}>{copy.deny}</button>
        </div>
      </div>
    </aside>
  );
}

function MissionFactRecord({ facts, copy, sectionLabels, statusLabels }: {
  facts: readonly PublicFact[];
  copy: Dictionary["d006c3"]["facts"];
  sectionLabels: Dictionary["d006c3"]["factSections"];
  statusLabels: Dictionary["d006c3"]["factStatus"];
}) {
  const grouped = factsBySection(facts);
  return (
    <aside className="mission-fact-record" aria-label={copy.recordAria}>
      <header>
        <span>{copy.recordKicker}</span>
        <strong>{copy.recordTitle}</strong>
      </header>
      {PUBLIC_FACT_SECTION_ORDER.map((section) => {
        const rows = (grouped.get(section) ?? []).filter((entry) => entry.status !== "NOT_OCCURRED");
        if (rows.length === 0) return null;
        return (
          <section key={section} data-fact-section={section}>
            <h4>{sectionLabels[section]}</h4>
            <ul>
              {rows.map((entry) => (
                <li
                  key={entry.factId}
                  data-fact-id={entry.factId}
                  data-fact-status={entry.status}
                  data-evidence-ids={entry.evidenceIds.join(" ")}
                >
                  <span>{copy.statements[entry.factId] ?? entry.factId}</span>
                  <b>{statusLabels[entry.status]}</b>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </aside>
  );
}

function TimelineLabel({ number, title, subtitle }: { number: string; title: string; subtitle: string }) {
  return <header className="timeline-label"><span>{number}</span><div><strong>{title}</strong><small>{subtitle}</small></div></header>;
}

function EvidenceFlower({ fills, maturity, compact, open, attached, labels, copy }: {
  fills: Record<EvidenceFamily, number>;
  maturity: number;
  compact: boolean;
  open: boolean;
  attached: boolean;
  labels: Dictionary["d006c2"]["familyLabels"];
  copy: Dictionary["d006c2"]["proof"];
}) {
  const normalized = Math.max(0, Math.min(1, maturity));
  const fed = EVIDENCE_FAMILIES.filter((family) => fills[family] > 0).length;
  return (
    <div
      className={`evidence-flower${normalized > 0 ? " is-open-mechanism" : ""}${normalized >= 1 ? " is-complete" : ""}${compact ? " is-compact" : ""}${open ? " is-open" : ""}${attached ? " is-attached" : ""}`}
      style={{ "--flower-maturity": normalized } as CSSProperties}
      aria-label={`${copy.flowerAria}: ${fed}/${EVIDENCE_FAMILIES.length}`}
    >
      <i className="flower-ring" aria-hidden="true" />
      {EVIDENCE_FAMILIES.map((family, index) => (
        <div
          key={family}
          className={`flower-segment family-${family}`}
          style={{ "--segment-index": index, "--segment-fill": fills[family] } as CSSProperties}
        >
          <i aria-hidden="true" />
          <em>{labels[family]}</em>
        </div>
      ))}
      <div className="flower-core"><span>{copy.final}</span><strong>{copy.receipt}</strong></div>
    </div>
  );
}

function ReceiptTransfer({ binding, tone, progress, origin, target, kindLabel, actorLabel, copy }: {
  binding: ReceiptBinding;
  tone: EventTone;
  progress: number;
  origin: Readonly<{ x: number; y: number }>;
  target: Readonly<{ x: number; y: number }>;
  kindLabel: string;
  actorLabel: string;
  copy: Dictionary["d006c2"]["proof"];
}) {
  return (
    <div
      className={`travelling-receipt event-tone-${tone}${progress < .3 ? " is-leaving" : ""}`}
      data-actor={binding.producerDomain}
      data-target={binding.targetEvidenceId}
      data-target-event={binding.targetEventId}
      data-visual-event-id={binding.visualEventId}
      data-receipt-id={binding.receiptId}
      data-evidence-id={binding.evidenceId}
      style={{
        "--src-x": origin.x,
        "--src-y": origin.y,
        "--dst-x": target.x,
        "--dst-y": target.y,
        "--t": progress,
        "--receipt-scale": .78 + progress * .22,
      } as CSSProperties}
      aria-label={`${kindLabel} · ${actorLabel} · ${copy.evidence}`}
    >
      <i /><span>{kindLabel}</span><strong>{copy.nanoReceipt}</strong>
      <em className="receipt-source" aria-hidden="true">{binding.producerDomain}</em>
    </div>
  );
}

/**
 * D-006A: the smart signal is permanent street furniture rather than a prop
 * that fades in for ten seconds, and the city infrastructure now performs a
 * visible act — scan, decide, grant — before each of its receipts, so no
 * infrastructure receipt is emitted by something that never moved.
 */
const ROUTING_ACTORS = new Set([
  "Navigation Provider A",
  "Navigation Provider B",
  "ROUTING_ORCHESTRATOR",
]);

function CityActors({ storyTime, maintenanceActionProgress, signalState, emitting, emittingActors, linkedActor, actorLabels, signalLabels }: {
  storyTime: number;
  maintenanceActionProgress: number;
  signalState: TrafficSignalState;
  emitting: ReadonlySet<ReceiptEmissionSource>;
  emittingActors: ReadonlySet<string>;
  /** The actor the viewer is inspecting, if any. Kept on screen so the
      cross-highlight never points at something that is not mounted. */
  linkedActor: string | null;
  actorLabels: Dictionary["d006c2"]["actorLabels"];
  signalLabels: Dictionary["d006c2"]["signalStates"];
}) {
  const cityActive = storyTime >= storyBeatTime("signal-green")
    && storyTime < storyBeatTime("intersection-cleared");
  const infraStep = cityInfrastructureStepAt(storyTime);
  const garageVisible = storyTime >= storyBeatTime("garage-approach")
    && storyTime < storyBeatTime("leaving-garage");
  const baseVisible = storyTime < storyBeatTime("taxi-en-route-to-passenger")
    || storyTime >= storyBeatTime("return-journey");
  const congestionVisible = storyTime >= storyBeatTime("congestion")
    && storyTime < storyBeatTime("routing-merge-start");
  const maintenanceActive = storyTime >= storyBeatTime("work-in-progress")
    && storyTime < storyBeatTime("work-complete");
  const authorityWindow = storyTime >= AUTHORITY_VISIBLE_FROM_MS && storyTime < AUTHORITY_VISIBLE_UNTIL_MS;
  const bankWindow = storyTime >= BANK_VISIBLE_FROM_MS && storyTime < BANK_VISIBLE_UNTIL_MS;
  const routingActor = [...emittingActors].find((actor) => ROUTING_ACTORS.has(actor))
    ?? (ROUTING_ACTORS.has(linkedActor ?? "") ? linkedActor : null);
  const networkActor = emittingActors.has("NETWORK") || linkedActor === "NETWORK" ? "NETWORK" : null;
  const exactProducerActors = [...new Set([
    ...emittingActors,
    ...(linkedActor === null ? [] : [linkedActor]),
    ...(authorityWindow ? ["Fleet operations", "Payment policy", "Manager", "Payment provider"] : []),
  ])].filter((actor) => receiptEmissionSourceForProducer(actor) === "exactProducer");
  return (
    <>
      <div
        className={`smart-light${cityActive ? " is-active" : ""}${emitting.has("trafficLight") ? " is-emitting" : ""}`}
        data-signal={signalState}
        style={propStyle("trafficLight")}
        aria-label={`${actorLabels["Smart Traffic Light"]}: ${signalLabels[signalState]}`}
      >
        <span>{actorLabels["Smart Traffic Light"]}</span><i className="signal-red" /><i className="signal-yellow" /><i className="signal-green" /><strong>{signalLabels[signalState]}</strong>
      </div>
      <div
        className={`city-infrastructure${cityActive ? " is-active" : ""}${emitting.has("cityInfrastructure") ? " is-emitting" : ""}`}
        data-infra-step={infraStep}
        data-producer-domain="SMART_CITY_INFRASTRUCTURE"
        style={propStyle("cityInfrastructure")}
      >
        <i /><span>{actorLabels.SMART_CITY_INFRASTRUCTURE}</span><b className="infra-beam" aria-hidden="true" />
      </div>
      {congestionVisible && (
        <div className="road-obstacle congestion-queue" style={propStyle("obstacle")} aria-hidden="true"><i /><i /><i /></div>
      )}
      {garageVisible && (
        <div
          className={`garage-object${emitting.has(EMISSION_SOURCE.garage) ? " is-emitting" : ""}${maintenanceActive ? " is-working" : ""}`}
          style={{
            ...propStyle("garage"),
            "--maintenance-shift": `${-18 + 36 * clamp01(maintenanceActionProgress)}px`,
            "--maintenance-rotation": `${-18 + 36 * clamp01(maintenanceActionProgress)}deg`,
          } as CSSProperties}
          data-maintenance-action={maintenanceActive ? "IN_PROGRESS" : "IDLE"}
        ><i /><b className="maintenance-action" aria-hidden="true" /><span>{actorLabels.Garage}</span></div>
      )}
      {baseVisible && <div className={`base-object${emitting.has(EMISSION_SOURCE.base) ? " is-emitting" : ""}`} style={propStyle("base")}><i /><span>{actorLabels.Base}</span></div>}
      <div className="authority-actor-group" data-authority-actors="split">
        {exactProducerActors.map((actor) => (
          <div
            key={actor}
            className={`exact-producer-actor${emittingActors.has(actor) ? " is-emitting" : " is-summoned"}${actor === linkedActor ? " is-linked" : ""}`}
            style={exactProducerStyle(actor)}
            data-producer-domain={actor}
            aria-label={actorLabels[actor] ?? actor}
          >
            <i /><span>{actorLabels[actor] ?? actor}</span>
          </div>
        ))}
      </div>
      {/*
        D-006G: the bank is a separate institution and stands apart from the
        fleet's own authority. The two were one prop, so the audience could
        not see a boundary being crossed — there was only one box to cross
        into. Nothing here implies the bank belongs to the fleet or to FortiX.
      */}
      {(bankWindow || linkedActor === "FINANCIAL_INSTITUTION") && (
        <div
          className={`bank-actor${emitting.has(EMISSION_SOURCE.bank) ? " is-emitting" : ""}${bankWindow ? "" : " is-summoned"}`}
          style={propStyle("bank")}
          data-producer-domain="FINANCIAL_INSTITUTION"
          aria-label={actorLabels.FINANCIAL_INSTITUTION}
        >
          <i /><span>{actorLabels.FINANCIAL_INSTITUTION}</span>
        </div>
      )}
      {routingActor !== null && (
        <div
          className={`routing-provider-actor${emitting.has("routingProvider") ? " is-emitting" : " is-summoned"}`}
          style={propStyle("routingProvider")}
          data-producer-domain={routingActor}
          aria-label={actorLabels[routingActor] ?? routingActor}
        >
          <i /><span>{actorLabels[routingActor] ?? routingActor}</span>
        </div>
      )}
      {networkActor !== null && (
        <div
          className={`network-sentinel-actor${emitting.has("networkSentinel") ? " is-emitting" : " is-summoned"}`}
          style={propStyle("networkSentinel")}
          data-producer-domain={networkActor}
          aria-label={actorLabels[networkActor] ?? networkActor}
        >
          <i /><span>{actorLabels[networkActor] ?? networkActor}</span>
        </div>
      )}
    </>
  );
}

/**
 * The city's own working state. The final step was called "granting", keyed
 * on an event named `crossing` — the infrastructure granting passage to a
 * vehicle. There is no such protocol here and none is claimed: the city
 * decides its own phase and publishes it. Whoever is watching does what they
 * decide to do.
 */
function cityInfrastructureStepAt(masterTime: number): "idle" | "scanning" | "deciding" | "publishing" {
  const scan = visualEventTime("city-detection");
  const decide = visualEventTime("city-phase-decision");
  const publish = visualEventTime("signal-green-2");
  if (masterTime >= publish && masterTime < publish + 1_800) return "publishing";
  if (masterTime >= decide && masterTime < publish) return "deciding";
  if (masterTime >= scan && masterTime < decide) return "scanning";
  return "idle";
}

/**
 * The lamp is a function of the city's OWN published states and nothing else.
 * It used to return to green at `crossing`, tying the light's appearance to
 * the moment the vehicle was said to be authorised. That this function now
 * references no vehicle event is itself the claim being made.
 */
function trafficSignalAt(masterTime: number): TrafficSignalState {
  if (masterTime < visualEventTime("signal-green") || masterTime >= visualEventTime("dropoff")) return "OFF";
  if (masterTime < visualEventTime("signal-yellow")) return "GREEN";
  if (masterTime < visualEventTime("signal-red")) return "YELLOW";
  if (masterTime < visualEventTime("signal-green-2")) return "RED";
  return "GREEN";
}

/**
 * D-006A: a receipt leaves the actor that emitted it. The origin is keyed on
 * the actor rather than on the receipt kind, and resolves through the same
 * STAGE_PROPS record that positions the prop on the road, so "who created this
 * receipt?" is answered by where it comes from rather than by reading a label.
 */
function receiptOrigin(binding: ReceiptBinding, vehiclePosition: number): Readonly<{ x: number; y: number }> {
  const source = receiptEmissionSource(binding);
  if (source === "vehicle") return vehicleEmissionPoint(vehiclePosition);
  if (source === "exactProducer") {
    const point = exactProducerEmissionPoint(binding.producerDomain);
    if (point === null) throw new TypeError(`no exact receipt origin for canonical producer ${binding.producerDomain}`);
    return point;
  }
  return propEmissionPoint(source);
}

function receiptEmissionSource(binding: ReceiptBinding): ReceiptEmissionSource {
  const source = receiptEmissionSourceForProducer(binding.producerDomain);
  if (source === null) throw new TypeError(`no visible receipt origin for canonical producer ${binding.producerDomain}`);
  return source;
}

function propStyle(id: StagePropId): CSSProperties {
  const target = STAGE_PROPS[id];
  return {
    "--prop-x": `${stageX(target.position)}%`,
    "--prop-bottom": `${target.bottomPx}px`,
  } as CSSProperties;
}

/**
 * A leaf's row is its branch's lane, packed within that lane so a burst of
 * evidence separates vertically instead of overlapping.
 *
 * This replaced a hand-authored 29-entry table of magic numbers whose rows
 * bore no relation to the branch — the six city events sat on rows 8, 18, 30,
 * 42, 14 and 36, so no domain read as a branch at all — and then a fixed
 * stagger, which spaced neighbours evenly whether or not they needed it and
 * still collided under real burst density.
 *
 * The packing itself lives in `proofLayout.ts` so it can be tested directly:
 * it is a pure function of the event table, and layout that only exists
 * inside a render pass cannot be asserted against.
 */
/**
 * The full set of evidence-backed leaves, laid out once.
 *
 * Layout is computed over EVERY leaf the mission can ever produce, not over
 * the subset currently visible, so a leaf never moves as the clock advances.
 * The runtime journal contributes leaves too; those are folded in at render
 * time against this stable frame.
 */
const ALL_SIGNED_LEAVES = signedProofLeaves();

/**
 * Which leaves carry a persistent caption. Chosen from the evidence — one per
 * domain at its first appearance, plus the mission's closing receipt — rather
 * than from a hand-picked list, so adding evidence cannot silently leave a new
 * domain unlabelled.
 */
const featuredLeafIds = new Set<string>((() => {
  // One caption per domain, at that domain's first appearance — but captions
  // are ~150px wide and lanes are only ~20px apart, so two "first in lane"
  // leaves close in TIME overlap even though they are in different lanes.
  // Per-lane packing cannot see that, because it never compares across lanes.
  // So a domain's caption is skipped forward to its next leaf when the moment
  // is already spoken for. Measured: mission at 0s and route at 9s were the
  // one pair that still collided, at 24x6px.
  const captionGapMs = minimumLabelledSeparationMs(EXPERIENCE_DURATION_MS);
  const claimed: number[] = [];
  const picked: string[] = [];
  const laneSeen = new Set<string>();
  for (const leaf of [...ALL_SIGNED_LEAVES].sort((a, b) => a.timeMs - b.timeMs)) {
    if (laneSeen.has(leaf.branch)) continue;
    if (claimed.some((at) => Math.abs(leaf.timeMs - at) < captionGapMs)) continue;
    laneSeen.add(leaf.branch);
    claimed.push(leaf.timeMs);
    picked.push(leaf.leafId);
  }
  return picked;
})());

/**
 * Layout over the leaves that ACTUALLY exist.
 *
 * It was computed once over the signed leaves alone, which left the runtime
 * journal leaves with no row: they fell back to their lane's centre line and
 * piled up, 15-20 overlapping dots at every viewport width. The projection
 * decides what exists; the layout must be computed over the same set, or it is
 * placing a different tree from the one being drawn.
 *
 * Still deterministic — the same evidence always produces the same rows — so
 * seeking and replaying reconstruct an identical tree.
 */
function layoutFor(leaves: readonly ProofLeaf[], featured: ReadonlySet<string>) {
  return computeProofLayout(
    leaves.map((leaf) => ({
      id: leaf.leafId,
      timeMs: leaf.timeMs,
      branch: leaf.branch,
      featured: featured.has(leaf.leafId),
    })),
    EXPERIENCE_DURATION_MS,
  );
}

/**
 * Where a travelling nano-receipt should land: the leaf of the evidence object
 * its event actually produced. A visual event maps to evidence through the
 * master moment it projects from, so the flight ends at a real evidence id rather
 * than at a presentation row. Events with no evidence behind them aim at their
 * lane, which is honest — the receipt is a dramatisation of the moment, and it
 * cannot land on a leaf that does not exist.
 */
function receiptTargetY(binding: ReceiptBinding, rows: ReadonlyMap<string, { readonly y: number }>): number {
  const target = rows.get(binding.leafId);
  if (target === undefined) throw new TypeError(`Receipt target leaf is absent: ${binding.leafId}`);
  return target.y;
}

function exactProducerStyle(producerDomain: string): CSSProperties {
  const slot = exactProducerStageSlot(producerDomain);
  if (slot === null) throw new TypeError(`no exact actor geometry for canonical producer ${producerDomain}`);
  return {
    "--prop-x": `${stageX(slot.position)}%`,
    "--prop-bottom": `${slot.bottomPx}px`,
  } as CSSProperties;
}

function proofLeafX(timeMs: number): number {
  return 5 + (timeMs / EXPERIENCE_DURATION_MS) * 84;
}

/** Growth is a function of the clock and the evidence's own timestamp. */
function leafGrowthForLeaf(leaf: ProofLeaf, masterTime: number): number {
  const isFinalRequiredReturnLeaf = leaf.leafId === "signed:d005m.receipt.master-return-to-base";
  const duration = leaf.source === "D006_FINAL_RECEIPT"
    ? FINAL_BRANCH_GROWTH_MS
    : isFinalRequiredReturnLeaf
      ? FINAL_REQUIRED_LEAF_MATURE_MS - RETURN_RECEIPT_EMITTED_MS - RECEIPT_TRAVEL_MS
      : BRANCH_GROWTH_MS;
  return clamp01((masterTime - leaf.timeMs - RECEIPT_TRAVEL_MS) / duration);
}

/** Colour follows the lane, so hue means one thing: which domain wrote it. */
const BRANCH_TONE: Readonly<Record<Branch, EventTone>> = {
  mission: "ultramarine",
  city: "orchid",
  vehicle: "glacier",
  safety: "tangerine",
  route: "solar",
  service: "solar",
  authority: "ultramarine",
  bank: "cyan",
  network: "cyan",
};

function leafTone(leaf: ProofLeaf): EventTone {
  return BRANCH_TONE[leaf.branch];
}

function inspectionRank(stage: InspectionStage): number {
  return ["IDLE", "INSPECTING", "OPEN", "REVEALED", "VERIFIED"].indexOf(stage);
}

function rectFromDom(rectangle: DOMRect): Rect {
  return {
    left: rectangle.left,
    top: rectangle.top,
    right: rectangle.right,
    bottom: rectangle.bottom,
  };
}

function sameLabelSides(a: Readonly<Record<string, LabelSide>>, b: Readonly<Record<string, LabelSide>>): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/** Stable identity for the exact LOST -> CONNECTED window being acknowledged. */
function awaitingReconciliationWindowKey(session: OfflineEvidenceSession): string | null {
  if (offlineWindowStatus(session) !== "AWAITING_RECONCILIATION") return null;
  const lost = session.records.findLast((record) => record.eventType === "NETWORK_LINK_LOST");
  const restored = session.records.findLast((record) => record.eventType === "NETWORK_LINK_RESTORED");
  if (lost === undefined || restored === undefined) return null;
  return JSON.stringify([lost.receiptId, restored.receiptId]);
}

function tryIssueFinalReceipt(closure: MissionEvidenceClosure): FinalMissionReceipt | null {
  try {
    return issueFinalMissionReceipt(closure, FINAL_RECEIPT_EMITTED_MS);
  } catch (error) {
    if (error instanceof PortableMissionEvidenceError
      && error.reasonCode === "REQUIRED_RUNTIME_EVIDENCE_MISSING") return null;
    throw error;
  }
}

function sceneFor(momentId: MasterMomentId): "pickup" | "city" | "obstacle" | "braking" | "route" | "garage" | "authority" | "return" | "complete" {
  const index = MASTER_SCENE_ORDER.indexOf(momentId);
  if (index < MASTER_SCENE_ORDER.indexOf("passenger-journey")) return "pickup";
  if (index < MASTER_SCENE_ORDER.indexOf("congestion")) return "city";
  if (momentId === "congestion") return "obstacle";
  if (momentId === "eta-at-risk") return "braking";
  if (index < MASTER_SCENE_ORDER.indexOf("garage-arrival")) return "route";
  if (index < MASTER_SCENE_ORDER.indexOf("invoice-1850")) return "garage";
  if (index < MASTER_SCENE_ORDER.indexOf("return-to-base-intent")) return "authority";
  if (index < MASTER_SCENE_ORDER.indexOf("parked-at-base")) return "return";
  return "complete";
}

function journeyStage(masterTime: number, bundleStage: TransferStage, result: CycleVerificationResult | null): number {
  if (result !== null || bundleStage === "TRANSFERRED") return 2;
  if (masterTime > 0) return 1;
  return 0;
}

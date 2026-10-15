"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { canVerifyLocally } from "../../verify/verificationCapability.ts";
import { memoryBaseStore, storageBaseStore, type BaseCompareTransferOutcome, type BaseStore } from "../../baseEvidence.ts";
import { SENTINEL_UNREACHABLE, type LinkSentinelReport } from "../../ethernetLink.ts";
import { PHYSICAL_ADAPTER_TARGETS, bindPhysicalAdapterForRun, type PhysicalAdapterBinding, type PhysicalAdapterTarget } from "../../physicalAdapterBinding.ts";
import {
  physicalConnectivityResolution,
  physicalKindForMedium,
  representativePhysicalReport,
  type ConnectivityMedium,
  type ConnectivityObservation,
} from "../../networkConnectivity.ts";
import { requestSameOriginEvidenceAcknowledgement } from "../../evidenceContinuity.ts";
import { appendHumanAuthorityDenial } from "../../humanAuthorityEvidence.ts";
import { MISSION_ID } from "../../missionContinuity.ts";
import { newMissionRunId } from "../../missionRun.ts";
import { PhysicalNetworkTransitionMachine, type NetworkTransitionState } from "../../networkTransitions.ts";
import {
  createOfflineEvidenceSession,
  type OfflineEvidenceSession,
  type ReconciliationResult,
} from "../../offlineEvidence.ts";
import { analyzeInsertedD006Peb, insertD006PebForAnalysis, type D006VerdictSnapshot } from "../../offlineVerification.ts";
import { derivePassengerPresentation } from "../../passengerPresentation.ts";
import { derivePhysicalState } from "../../physicalState.ts";
import {
  LINK_POLL_MS,
  LINK_OBSERVATION_FRESHNESS_MS,
  LINK_SENTINEL_TIMEOUT_MS,
  TRANSITION_FLASH_MS,
  admitPhysicalObservation,
  createPhysicalLinkBaseline,
  observePhysicalLinkBaseline,
  artifactStateFor,
  awaitingReconciliationWindowKey,
  capturePreRestorationIfPossible,
  performReconciliation,
  readLinkSentinel,
  refusedReconciliationAttempt,
  visibleLinkPhase,
  type ReconciliationAttempt,
} from "../../physicalLinkRuntime.ts";
import {
  PortableMissionEvidenceError,
  buildMissionEvidenceClosure,
  buildPortableMissionEvidenceBundle,
  createHandoffArtifact,
  finalReceiptMember,
  finalReceiptRuntimeEvidencePrefix,
  issueFinalMissionReceipt,
  routingProvenanceFromRuntimeRecords,
  type HandoffArtifact,
  type MissionEvidenceClosure,
} from "../../portableMissionEvidence.ts";
import { projectPortableProofLeaves } from "../../proofProjection.ts";
import { projectReceiptBindings, type ReceiptBinding } from "../../receiptProjection.ts";
import {
  HUMAN_AUTHORITY_GATE_MS,
  applyHumanDecision,
  constrainReviewTime,
  nextTransferStage,
  resolveArtifactRelease,
  type HumanDecision,
  type TransferStage,
} from "../../reviewFlow.ts";
import { humanMasterTime, humanPresentationTime, humanPresentationTimeAtRest } from "../experience/humanPacing.ts";
import { CANONICAL_ROUTING_PROVENANCE, deriveRoutingState } from "../../routingProvenance.ts";
import {
  EXPERIENCE_DURATION_MS,
  FINAL_RECEIPT_EMITTED_MS,
  HANDOFF_READY_MS,
  PEB_COMPLETE_MS,
  evidenceGatedStoryTime,
} from "../../storyTimeline.ts";
import { derivePresentationMotion } from "../../vehiclePresentation.ts";
import { VISUAL_EVENTS } from "../../visualEvents.ts";
import type { EngineSnapshot } from "./engineSnapshot.ts";

/**
 * D-006 NX1 — runtime wiring (Checkpoint A, R3, B).
 *
 * WHAT THIS IS. The lines that connect the deterministic engine to a React
 * tree: a run identity, the master clock (play / pause / seek through the
 * engine's own review-flow rules), the append-only journal, the derived
 * closure / receipt / artifact memos, the two human acts of the handoff, and
 * — since Checkpoint B — the physical link sentinel, the pre-restoration
 * capture and the reconciliation. Every derivation and every append is an
 * engine call through the shared physical-link runtime; nothing here decides
 * what happened.
 *
 * THE JOURNAL. One append-only session per run. The deterministic mission
 * records are projected into it as the clock reaches each moment
 * (`projectMissionEvidence`, pure and idempotent, so a scrub reconstructs
 * exactly the journal a frame-by-frame playback produced); the physical
 * records (NR-NET-LOST / NR-NET-RESTORED), the human DENY, the offline
 * completion capture and the Reconciliation Receipt are appended by the
 * engine when the world or a person produces them. Final Receipt issuance
 * seals the append POSITION at emission: later physical appends stay outside
 * the sealed bytes forever, exactly as the legacy stage does. A Reconciliation
 * Receipt appended in mission, before emission, is inside them (2026-10-08).
 *
 * THE NETWORK. The only input that can move the network state is the aggregate
 * of the supported physical-link sentinel reports. Persistent states are
 * CONNECTED and LOST; RESTORED is an event the journal keeps. A route switch
 * while another route remains usable stays CONNECTED and authors no receipt.
 * No button, timeline or browser flag can mint a transition.
 *
 * WHAT THIS IS NOT. Not a second engine. Run persistence across reloads
 * remains the legacy stage's (a reload here starts a new run).
 */

export type MissionEngine = Readonly<{
  snapshot: EngineSnapshot;
  /**
   * The playback cursor on the HUMAN PRESENTATION CLOCK (C-R1). It is not
   * engine state and is deliberately not part of the snapshot: the snapshot is
   * what the mission IS, and this is only how far a viewer has been walked
   * through it. The presentation queue needs it because during a hold several
   * presentation moments share one master time, so master time alone cannot
   * say which one a viewer is at.
   */
  presentationTimeMs: number;
  /** A fresh CONNECTED baseline must be observed once before starting this run. */
  networkBaselineReady: boolean;
  activeConnectivityMedium: ConnectivityMedium | null;
  connectivityPaths: readonly ConnectivityObservation[];
  physicalAdapterBinding: PhysicalAdapterBinding | null;
  play: () => void;
  pause: () => void;
  seek: (masterTimeMs: number) => void;
  restart: () => void;
  decide: (decision: Exclude<HumanDecision, "PENDING">) => void;
  /**
   * PICK — take the portable artifact in hand: the engine's GATHER, SOURCE →
   * FORMED. The verifier has received nothing. Opening a verifier surface on
   * this act is presentation; the evidence has not moved.
   */
  pick: () => void;
  /**
   * DROP — present the carried artifact to the verifier: the engine's SEND,
   * FORMED → TRANSFERRED, through `resolveArtifactRelease(…, "INSERT")`. Only
   * a carried artifact can be dropped; a drop from SOURCE changes nothing.
   * This, and only this, is the transfer.
   */
  drop: () => void;
  /**
   * RELEASE — put a carried artifact back, presenting it to no one (MISS /
   * CANCEL). There is no fused pick-and-drop act: the review deep link
   * `?handoff=done` is applied as the initial stage, and a person picks, then
   * a person drops.
   */
  release: () => void;
  /** Ask the verifier to analyze what it received. A separate act, never automatic. */
  analyze: () => void;
}>;

export type MissionEngineOptions = Readonly<{
  /**
   * Review deep link: the reviewer's own authority decision, declared in the
   * link (`?decision=approved`) so a review can open past the boundary. The
   * same engine rule as a click; never a fact about the mission.
   */
  decision?: "APPROVED";
  /** Review deep link: the PEB picked up but not yet dropped (`?peb=picked`). */
  pebPicked?: boolean;
  /** Review deep link: the handoff act already performed (`?handoff=done`). */
  handoffDone?: boolean;
  /** Review deep link: the analysis act already requested (`?analysis=requested`). */
  analysisRequested?: boolean;
  /** Test seam: where target-specific reports come from. Default: the loopback sidecar. */
  readSentinel?: (signal: AbortSignal, target: PhysicalAdapterTarget) => Promise<LinkSentinelReport>;
}>;

function runEntropy(): string {
  const random = globalThis.crypto?.randomUUID?.();
  return random === undefined ? Math.random().toString(36).slice(2, 14) : random.replace(/-/g, "");
}

/**
 * Until the page has mounted the run has no identity: the server cannot mint
 * one the client would reproduce (a headless capture showed exactly that as a
 * hydration mismatch). The placeholder is not a valid run id, and the run is
 * named on the client in the first effect, as the legacy stage does.
 */
const UNRESOLVED_RUN_ID = "fortix.d006e.run.unresolved";

/**
 * `journalAt` now lives in `missionJournal.ts`. It is a pure projection, but
 * declaring it here made it a CLIENT REFERENCE — this module carries "use
 * client" — so a server component could not call it. It is re-exported so
 * every existing importer keeps working unchanged. The engine below calls it
 * too, so it is imported as well as re-exported: a bare `export ... from`
 * forwards a name without binding it in this module's own scope.
 */
export { journalAt } from "./missionJournal.ts";
import { journalAt } from "./missionJournal.ts";

export function useMissionEngine(initialMasterTimeMs = 0, options: MissionEngineOptions = {}): MissionEngine {
  const initialDecision: HumanDecision = options.decision ?? "PENDING";
  const initialTime = constrainReviewTime(initialMasterTimeMs, "INTERACTIVE", initialDecision);
  const [liveSession, setLiveSession] = useState<OfflineEvidenceSession>(() => journalAt(createOfflineEvidenceSession(UNRESOLVED_RUN_ID, null, MISSION_ID), initialTime));
  const [humanDecision, setHumanDecision] = useState<HumanDecision>(initialDecision);
  const [masterTime, setMasterTime] = useState(initialTime);
  // The human presentation cursor (C-R1). Derived from the master time at every
  // discontinuity — a seek, a restart, a decision — and advanced by wall-clock
  // time only while the run is playing, so it is deterministic on the server
  // and after any jump.
  const [presentationTime, setPresentationTime] = useState(() => humanPresentationTimeAtRest(initialTime));
  const [playing, setPlaying] = useState(false);
  const [transferStage, setTransferStage] = useState<TransferStage>(() => options.handoffDone
    ? nextTransferStage(nextTransferStage("SOURCE", "GATHER"), "SEND")
    : options.pebPicked ? nextTransferStage("SOURCE", "GATHER") : "SOURCE");
  const [analysisRequested, setAnalysisRequested] = useState(options.analysisRequested === true);
  const [verdictSnapshot, setVerdictSnapshot] = useState<D006VerdictSnapshot | null>(null);
  const [handoffNetworkState, setHandoffNetworkState] = useState<NetworkTransitionState | null>(null);
  const [verdictNetworkState, setVerdictNetworkState] = useState<NetworkTransitionState | null>(null);
  // The physical link, as the sentinel reports it and the machine admits it.
  const [linkReport, setLinkReport] = useState<LinkSentinelReport>(SENTINEL_UNREACHABLE);
  const [linkObservationCurrent, setLinkObservationCurrent] = useState(false);
  const [connectivity, setConnectivity] = useState(() => physicalConnectivityResolution(
    { ethernet: SENTINEL_UNREACHABLE, wifi: SENTINEL_UNREACHABLE },
    0,
    0,
  ));
  const [adapterBinding, setAdapterBinding] = useState<PhysicalAdapterBinding | null>(null);
  const [networkBaselineReady, setNetworkBaselineReady] = useState(false);
  const [baselinePhysicalLink, setBaselinePhysicalLink] = useState<NetworkTransitionState>("UNKNOWN");
  const [networkState, setNetworkState] = useState<NetworkTransitionState>("UNKNOWN");
  const [unsequencedObservation, setUnsequencedObservation] = useState<string | null>(null);
  const [transitionFlash, setTransitionFlash] = useState<"LOST" | "RESTORED" | null>(null);
  const [reconciliation, setReconciliation] = useState<ReconciliationResult | null>(null);
  const [baseTransfer, setBaseTransfer] = useState<BaseCompareTransferOutcome | null>(null);
  const [syncPhase, setSyncPhase] = useState<EngineSnapshot["syncPhase"]>("IDLE");

  const liveSessionRef = useRef(liveSession);
  const masterTimeRef = useRef(initialTime);
  const machineRef = useRef<PhysicalNetworkTransitionMachine | null>(null);
  const transferStageRef = useRef(transferStage);
  const handoffArtifactRef = useRef<HandoffArtifact | null>(null);
  const verdictRef = useRef<D006VerdictSnapshot | null>(null);
  const frame = useRef<number | null>(null);
  const analysisRun = useRef(0);
  const lifecycleGeneration = useRef(0);
  const previousActiveMedium = useRef<ConnectivityMedium | null>(null);
  const physicalBaseline = useRef(createPhysicalLinkBaseline(UNRESOLVED_RUN_ID, 0));
  const activeLinkRead = useRef<AbortController | null>(null);
  const transitionFlashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // One reconciliation attempt per physical offline window. A new loss resets it.
  const reconciliationStartedRef = useRef(false);
  const readSentinel = options.readSentinel;

  useEffect(() => { transferStageRef.current = transferStage; }, [transferStage]);
  // The journal and the clock have no ref-from-state sync (D-006, 2026-10-08).
  // Every writer — the clock, a seek, a restart, a decision, the DENY, the
  // capture, a physical transition, a reconciliation receipt — writes the ref
  // before the state. A sync effect from a render already behind it could put
  // an older journal back into the ref and let the next writer drop a record,
  // or an older time and date a receipt before the record it follows.
  useEffect(() => { verdictRef.current = verdictSnapshot; }, [verdictSnapshot]);

  // Name the run once, after mount. Deferred to a microtask so the hydration
  // pass renders exactly what the server rendered. The network machine for
  // the run starts at the journal's CONNECTED baseline (D-006 C1); the
  // sentinel decides what is true from its first sample.
  useEffect(() => {
    const named = newMissionRunId(Date.now(), runEntropy());
    queueMicrotask(() => {
      if (liveSessionRef.current.runId !== UNRESOLVED_RUN_ID) return;
      const session = journalAt(createOfflineEvidenceSession(named, null, MISSION_ID), masterTimeRef.current);
      liveSessionRef.current = session;
      physicalBaseline.current = createPhysicalLinkBaseline(named, Date.now());
      machineRef.current = new PhysicalNetworkTransitionMachine({ runId: named, initialState: session.networkState });
      setLiveSession((current) => current.runId === UNRESOLVED_RUN_ID ? session : current);
    });
  }, []);

  // The journal at this playhead (a no-op once the clock has persisted it).
  const session = useMemo(() => journalAt(liveSession, masterTime), [liveSession, masterTime]);

  // Playback on the HUMAN PRESENTATION CLOCK (Checkpoint C): wall-clock time
  // advances a presentation coordinate, and that coordinate is converted to
  // the canonical master time. The conversion only ever gives an interval
  // MORE presentation time than the engine's own pacing, and rests on the
  // canonical instants the mission turns on — so a viewer can read what
  // arrived, while every timestamp, causal time and admission order stays
  // exactly what the engine recorded. The engine's review-flow rules still
  // decide the rest: the clock holds at the human authority boundary and
  // stops at the end of the experience, and each step lets the journal reach
  // the new moment.
  useEffect(() => {
    if (!playing) return;
    const generation = lifecycleGeneration.current;
    const anchorPresentation = humanPresentationTime(masterTimeRef.current);
    let last: number | null = null;
    let elapsed = 0;
    const tick = (frameTime: number) => {
      if (generation !== lifecycleGeneration.current) return;
      const previous = last ?? frameTime;
      elapsed += Math.max(0, frameTime - previous);
      last = frameTime;
      const presentation = anchorPresentation + elapsed;
      const proposed = Math.round(humanMasterTime(presentation));
      const masterTime = constrainReviewTime(proposed, "INTERACTIVE", humanDecision);
      const pausedForAuthority = masterTime === HUMAN_AUTHORITY_GATE_MS
        && proposed >= HUMAN_AUTHORITY_GATE_MS
        && humanDecision !== "APPROVED";
      masterTimeRef.current = masterTime;
      setMasterTime(masterTime);
      // The presentation cursor advances with wall-clock time even where master
      // time does not — across a hold, and while a staged receipt is being read.
      // It is clamped to the master time the review rules actually allowed, so
      // a paused boundary stops the picture as well as the mission.
      setPresentationTime(masterTime === proposed ? presentation : humanPresentationTimeAtRest(masterTime));
      const reached = journalAt(liveSessionRef.current, masterTime);
      liveSessionRef.current = reached;
      setLiveSession(reached);
      if (pausedForAuthority || masterTime >= EXPERIENCE_DURATION_MS) {
        setPlaying(false);
        return;
      }
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [humanDecision, playing]);

  const play = useCallback(() => {
    if (!physicalBaseline.current.ready || masterTimeRef.current >= EXPERIENCE_DURATION_MS) return;
    setPlaying(true);
  }, []);
  const pause = useCallback(() => setPlaying(false), []);
  const seek = useCallback((value: number) => {
    if (!physicalBaseline.current.ready) return;
    const constrained = constrainReviewTime(value, "INTERACTIVE", humanDecision);
    setPlaying(false);
    masterTimeRef.current = constrained;
    setMasterTime(constrained);
    setPresentationTime(humanPresentationTime(constrained));
    const reached = journalAt(liveSessionRef.current, constrained);
    liveSessionRef.current = reached;
    setLiveSession(reached);
  }, [humanDecision]);
  const restart = useCallback(() => {
    previousActiveMedium.current = null;
    setAdapterBinding(null);
    const nextRunId = newMissionRunId(Date.now(), runEntropy());
    const fresh = createOfflineEvidenceSession(nextRunId, null, MISSION_ID);
    lifecycleGeneration.current += 1;
    activeLinkRead.current?.abort(); activeLinkRead.current = null;
    if (frame.current !== null) { cancelAnimationFrame(frame.current); frame.current = null; }
    if (transitionFlashTimer.current !== null) { clearTimeout(transitionFlashTimer.current); transitionFlashTimer.current = null; }
    physicalBaseline.current = createPhysicalLinkBaseline(nextRunId, Date.now());
    handoffArtifactRef.current = null;
    verdictRef.current = null;
    transferStageRef.current = "SOURCE";
    analysisRun.current += 1;
    reconciliationStartedRef.current = false;
    masterTimeRef.current = 0;
    liveSessionRef.current = fresh;
    machineRef.current = new PhysicalNetworkTransitionMachine({ runId: nextRunId, initialState: fresh.networkState });
    setPlaying(false);
    setMasterTime(0);
    setPresentationTime(0);
    setHumanDecision("PENDING");
    setTransferStage("SOURCE");
    setAnalysisRequested(false);
    setVerdictSnapshot(null);
    setHandoffNetworkState(null);
    setVerdictNetworkState(null);
    setNetworkState("UNKNOWN");
    setNetworkBaselineReady(false);
    setBaselinePhysicalLink("UNKNOWN");
    setLinkReport(SENTINEL_UNREACHABLE);
    setConnectivity(physicalConnectivityResolution(
      { ethernet: SENTINEL_UNREACHABLE, wifi: SENTINEL_UNREACHABLE },
      0,
      0,
    ));
    setTransitionFlash(null);
    setLinkObservationCurrent(false);
    setUnsequencedObservation(null);
    setReconciliation(null);
    setBaseTransfer(null);
    setSyncPhase("IDLE");
    setLiveSession(fresh);
  }, []);

  // --- derivations: every one an engine call ------------------------------
  const activeRecords = useMemo(() => {
    if (session.finalReceiptRuntimeSeal === null) return session.records;
    try {
      return finalReceiptRuntimeEvidencePrefix(session);
    } catch {
      return Object.freeze([] as OfflineEvidenceSession["records"][number][]);
    }
  }, [session]);
  const routingEvidence = useMemo(() => {
    try {
      const provenance = routingProvenanceFromRuntimeRecords(activeRecords);
      return { provenance: provenance ?? CANONICAL_ROUTING_PROVENANCE, admissible: provenance !== null };
    } catch {
      return { provenance: CANONICAL_ROUTING_PROVENANCE, admissible: false };
    }
  }, [activeRecords]);
  const routing = useMemo(
    () => deriveRoutingState(routingEvidence.admissible ? masterTime : 0, routingEvidence.provenance),
    [masterTime, routingEvidence],
  );
  const routingExecutionAuthorized = routingEvidence.admissible && routing.vehicleMayExecute;
  const effectiveStoryTime = evidenceGatedStoryTime(masterTime, routingEvidence.admissible);
  const waitingForAuthority = humanDecision === "PENDING" && effectiveStoryTime === HUMAN_AUTHORITY_GATE_MS;

  const decide = useCallback((decision: Exclude<HumanDecision, "PENDING">) => {
    if (!physicalBaseline.current.ready || !waitingForAuthority) return;
    const applied = applyHumanDecision(decision);
    setHumanDecision(applied.decision);
    masterTimeRef.current = applied.masterTime;
    setMasterTime(applied.masterTime);
    setPresentationTime(humanPresentationTimeAtRest(applied.masterTime));
    setPlaying(decision === "APPROVED");
    if (decision === "DENIED") {
      // NX0 §50: the denial is evidence — the same engine call as the legacy
      // stage, appended to the journal so it survives any scrub. Built on the
      // ref and written to it first, like every other append: a receipt the
      // reconciliation committed a moment earlier is in the journal it extends.
      // Idempotent by the engine: an existing denial record is returned as is.
      const reached = journalAt(liveSessionRef.current, applied.masterTime);
      const lastClock = reached.records.at(-1)?.missionClockPosition ?? -1;
      const denied = appendHumanAuthorityDenial(reached, {
        missionClockPosition: Math.max(lastClock + 1, Math.round(applied.masterTime)),
        observedMasterTimeMs: Math.round(applied.masterTime),
      }).session;
      liveSessionRef.current = denied;
      setLiveSession(denied);
    }
  }, [waitingForAuthority]);

  const physical = useMemo(() => derivePhysicalState(masterTime, routingExecutionAuthorized), [masterTime, routingExecutionAuthorized]);
  const motion = useMemo(() => derivePresentationMotion(masterTime, routingExecutionAuthorized), [masterTime, routingExecutionAuthorized]);
  const passenger = useMemo(() => derivePassengerPresentation(effectiveStoryTime, physical.passengerState), [effectiveStoryTime, physical.passengerState]);
  const closureState = useMemo<Readonly<{ closure: MissionEvidenceClosure | null; reason: string | null }>>(() => {
    try {
      return {
        closure: buildMissionEvidenceClosure({
          identity: { missionId: MISSION_ID, runId: session.runId },
          runtimeRecords: activeRecords,
          asOfMasterTimeMs: FINAL_RECEIPT_EMITTED_MS,
        }),
        reason: null,
      };
    } catch (error) {
      if (error instanceof PortableMissionEvidenceError) return { closure: null, reason: error.reasonCode };
      throw error;
    }
  }, [activeRecords, session.runId]);
  const closure = closureState.closure;
  const finalReceipt = useMemo(() => {
    if (masterTime < FINAL_RECEIPT_EMITTED_MS || session.finalReceiptRuntimeSeal === null || closure === null) return null;
    try {
      return issueFinalMissionReceipt(closure, FINAL_RECEIPT_EMITTED_MS);
    } catch (error) {
      if (error instanceof PortableMissionEvidenceError && error.reasonCode === "REQUIRED_RUNTIME_EVIDENCE_MISSING") return null;
      throw error;
    }
  }, [closure, masterTime, session.finalReceiptRuntimeSeal]);
  const receiptBindings = useMemo<readonly ReceiptBinding[]>(
    () => closure === null ? Object.freeze([]) : projectReceiptBindings(closure, VISUAL_EVENTS),
    [closure],
  );
  // The bundle and the artifact exist from their canonical moments and are
  // then the SAME objects while the clock runs on: keyed on the moment being
  // reached, never on the clock itself. Keyed on the clock, both were minted
  // anew on every frame of playback, and the analysis effect below — which
  // must restart when the bytes change — restarted on every frame too.
  const pebComplete = masterTime >= PEB_COMPLETE_MS;
  const handoffReady = masterTime >= HANDOFF_READY_MS;
  const portablePeb = useMemo(() => {
    if (!pebComplete || finalReceipt === null || closure === null) return null;
    const displayed = projectPortableProofLeaves(closure, PEB_COMPLETE_MS, finalReceipt).map((leaf) => leaf.evidenceId);
    return buildPortableMissionEvidenceBundle({
      closure,
      finalReceipt,
      runtimeRecords: activeRecords,
      displayedEvidenceIds: displayed,
      masterTimeMs: PEB_COMPLETE_MS,
    });
  }, [activeRecords, closure, finalReceipt, pebComplete]);
  const handoffArtifact = useMemo(
    () => handoffReady && portablePeb !== null ? createHandoffArtifact(portablePeb, HANDOFF_READY_MS) : null,
    [handoffReady, portablePeb],
  );
  useEffect(() => { handoffArtifactRef.current = handoffArtifact; }, [handoffArtifact]);

  // --- the handoff and the verifier: two acts, both engine calls ------------
  // At a playhead before the artifact exists nothing has been handed over;
  // the acts persist and apply again once the playhead reaches the artifact.
  const effectiveTransferStage: TransferStage = handoffArtifact === null ? "SOURCE" : transferStage;
  const effectiveAnalysisRequested = effectiveTransferStage === "TRANSFERRED" && analysisRequested;
  const verification = useMemo(() => {
    if (verdictSnapshot === null || handoffArtifact === null || effectiveTransferStage !== "TRANSFERRED") return null;
    // The verifier's result is reported only for the bytes it analyzed.
    if (verdictSnapshot.transferredContentDigest !== handoffArtifact.transferredContentDigest
      || verdictSnapshot.identity.runId !== handoffArtifact.identity.runId) return null;
    return verdictSnapshot.result;
  }, [effectiveTransferStage, handoffArtifact, verdictSnapshot]);

  // PICK ≠ DROP. The transfer stage machine already had both steps — GATHER
  // then SEND — and `resolveArtifactRelease` already knew what a carried
  // artifact may do: be inserted, miss, or be cancelled. The surfaces used to
  // fire both steps at once. Now a person performs each one, and the verifier
  // holds nothing until the second: FORMED means "in someone's hand", and
  // `deriveHandoff` reports HANDED_OVER for TRANSFERRED alone.
  const pick = useCallback(() => {
    if (handoffArtifact === null) return;
    setTransferStage((stage) => nextTransferStage(stage, "GATHER"));
  }, [handoffArtifact]);
  const drop = useCallback(() => {
    if (handoffArtifact === null) return;
    // INSERT from anything but FORMED returns the stage unchanged: a drop
    // without a pick transfers nothing — and records nothing. The link state
    // is captured at the moment of RECEIPT, which is the FORMED → TRANSFERRED
    // transition and only that: a no-op drop must not freeze a link state
    // for a later, real one.
    const stage = transferStageRef.current;
    const next = resolveArtifactRelease(stage, "INSERT");
    if (next === stage) return;
    transferStageRef.current = next;
    setTransferStage(next);
    setHandoffNetworkState((current) => current ?? (machineRef.current?.state ?? "UNKNOWN"));
  }, [handoffArtifact]);
  const release = useCallback(() => {
    setTransferStage((stage) => resolveArtifactRelease(stage, "CANCEL"));
  }, []);
  const analyze = useCallback(() => {
    if (effectiveTransferStage !== "TRANSFERRED") return;
    if (!canVerifyLocally()) { setAnalysisRequested(false); return; }
    setAnalysisRequested(true);
  }, [effectiveTransferStage]);

  // The analysis, once requested, runs the engine's verifier on the exact
  // bytes handed over — connected or not: the verifier carries its own pinned
  // directory and fetches nothing. The verdict cannot be derived by a render:
  // it is the verifier's asynchronous result, stored as it came. If the link
  // is LOST when it arrives, the engine captures the completed local
  // artifacts and the verdict for the later reconciliation to check.
  useEffect(() => {
    // Missing browser capability is an operational refusal, never a pending or invalid verdict.
    if (analysisRequested && !canVerifyLocally()) {
      const run = ++analysisRun.current;
      // Keep the server and first hydration render identical, then cancel the
      // unsupported request. The epoch also protects a reset in this window.
      queueMicrotask(() => { if (run === analysisRun.current) setAnalysisRequested(false); });
      return () => { analysisRun.current += 1; };
    }
    if (!effectiveAnalysisRequested || handoffArtifact === null || verification !== null) return;
    const run = ++analysisRun.current;
    const inserted = insertD006PebForAnalysis({
      pebText: handoffArtifact.pebText,
      expectedIdentity: handoffArtifact.identity,
      expectedTransferredContentDigest: handoffArtifact.transferredContentDigest,
    });
    void analyzeInsertedD006Peb(inserted).then((snapshot) => {
      if (run !== analysisRun.current) return;
      verdictRef.current = snapshot;
      setVerdictSnapshot(snapshot);
      setVerdictNetworkState(machineRef.current?.state ?? "UNKNOWN");
      // The capture is appended to the journal the way the sentinel path
      // appends its records: from the ref, and back into the ref at once —
      // so a link transition resolving in the same commit window cannot
      // overwrite the session with one that lacks the capture.
      const captured = capturePreRestorationIfPossible(liveSessionRef.current, handoffArtifact, snapshot, masterTimeRef.current);
      liveSessionRef.current = captured;
      setLiveSession(captured);
    });
    return () => { analysisRun.current += 1; };
  }, [analysisRequested, effectiveAnalysisRequested, handoffArtifact, verification]);

  // --- the physical link: the sentinel, the machine, the journal -------------
  // Poll the loopback sentinel that reads the Windows adapter table. Reaching
  // it is not evidence of connectivity: it answers with the cable out. Each
  // sample goes through the shared runtime, which asks the engine's machine
  // and appends the engine's record — or rolls back and reports a refusal.
  useEffect(() => {
    const runId = liveSession.runId;
    if (runId === UNRESOLVED_RUN_ID) return;
    const generation = lifecycleGeneration.current;
    const targets = [PHYSICAL_ADAPTER_TARGETS.ethernet, PHYSICAL_ADAPTER_TARGETS.wifi] as const;
    let cancelled = false;
    let reading = false;
    let activeController: AbortController | null = null;
    const read = async () => {
      if (reading) return;
      reading = true;
      const controller = new AbortController();
      activeController = controller; activeLinkRead.current = controller;
      const requestTimeout = setTimeout(() => controller.abort(), LINK_SENTINEL_TIMEOUT_MS);
      const readTarget = (target: PhysicalAdapterTarget) => (
        readSentinel === undefined
          ? readLinkSentinel(controller.signal, undefined, undefined, target)
          : readSentinel(controller.signal, target)
      ).catch(() => SENTINEL_UNREACHABLE);
      const [ethernet, wifi] = await Promise.all(targets.map(readTarget));
      clearTimeout(requestTimeout);
      if (activeController === controller) activeController = null;
      if (activeLinkRead.current === controller) activeLinkRead.current = null;
      reading = false;
      if (cancelled || generation !== lifecycleGeneration.current || liveSessionRef.current.runId !== runId) return;
      const nowEpochMs = Date.now();
      const resolution = physicalConnectivityResolution(
        { ethernet, wifi },
        nowEpochMs,
        LINK_OBSERVATION_FRESHNESS_MS,
        physicalBaseline.current.startedAtEpochMs,
      );
      const report = representativePhysicalReport(resolution, previousActiveMedium.current);
      const activeKind = physicalKindForMedium(resolution.activeMedium);
      const binding = activeKind === null
        ? null
        : bindPhysicalAdapterForRun(runId, report, PHYSICAL_ADAPTER_TARGETS[activeKind]);
      setConnectivity(resolution);
      setAdapterBinding(binding);
      if (resolution.state === "CONNECTED") previousActiveMedium.current = resolution.activeMedium;
      setLinkReport(report);
      const machine = machineRef.current;
      if (machine === null || liveSessionRef.current.runId === UNRESOLVED_RUN_ID) return;
      const masterTimeMs = masterTimeRef.current;
      if (!physicalBaseline.current.ready) {
        const observation = observePhysicalLinkBaseline(physicalBaseline.current, report, nowEpochMs);
        physicalBaseline.current = observation.baseline;
        setNetworkBaselineReady(observation.ready);
        setBaselinePhysicalLink(observation.physicalLink);
        setLinkObservationCurrent(observation.observationCurrent);
        if (!observation.ready) return;
        // The establishing CONNECTED sample enters the aligned machine as
        // STABLE (zero receipts), setting its timestamp floor for later reads.
      }
      const outcome = admitPhysicalObservation({
        session: journalAt(liveSessionRef.current, masterTimeMs),
        machine,
        report,
        nowEpochMs,
        masterTimeMs,
      });
      machineRef.current = outcome.machine;
      setNetworkState(outcome.networkState);
      setUnsequencedObservation(outcome.unsequencedObservation);
      if (outcome.linkObservationCurrent !== null) setLinkObservationCurrent(outcome.linkObservationCurrent);
      if (outcome.kind !== "TRANSITION") return;
      let next = outcome.session;
      if (outcome.transition === "LOST") {
        // A verdict already produced for this artifact is captured now, while
        // the link is LOST, so the later reconciliation can prove it unchanged.
        next = capturePreRestorationIfPossible(next, handoffArtifactRef.current, verdictRef.current, masterTimeMs);
        reconciliationStartedRef.current = false;
        setReconciliation(null);
        setBaseTransfer(null);
        setSyncPhase("LOCAL");
      } else {
        setSyncPhase("READY");
      }
      liveSessionRef.current = next;
      setLiveSession(next);
      setTransitionFlash(outcome.transition);
      if (transitionFlashTimer.current !== null) clearTimeout(transitionFlashTimer.current);
      transitionFlashTimer.current = setTimeout(() => {
        if (generation === lifecycleGeneration.current) setTransitionFlash(null);
        transitionFlashTimer.current = null;
      }, TRANSITION_FLASH_MS);
    };
    void read();
    const timer = setInterval(() => { void read(); }, LINK_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
      activeController?.abort();
      if (activeLinkRead.current === activeController) activeLinkRead.current = null;
      if (transitionFlashTimer.current !== null) { clearTimeout(transitionFlashTimer.current); transitionFlashTimer.current = null; }
    };
  }, [readSentinel, liveSession.runId]);

  const linkPhase = networkBaselineReady ? visibleLinkPhase(linkReport, networkState, linkObservationCurrent) : baselinePhysicalLink;
  const reconciliationWindowKey = awaitingReconciliationWindowKey(session);

  // Reconciliation begins only when the link is physically connected AND the
  // journal independently records a window awaiting reconciliation. It is
  // PERFORMED by the engine (base compare / transfer, C1 validation) and its
  // receipt is appended by the engine; the same-origin acknowledgement before
  // it is an identity acknowledgement, never proof of transfer.
  //
  // Since 2026-10-08 a restoration before the Final Receipt is reconciled IN
  // MISSION: the shared runtime takes that path from the journal itself. No
  // artifact exists yet, so nothing is acknowledged and the phase ends at
  // RECONCILED, never ACKNOWLEDGED.
  useEffect(() => {
    if (linkPhase !== "CONNECTED" || reconciliationWindowKey === null) return;
    if (reconciliationStartedRef.current) return;
    reconciliationStartedRef.current = true;
    let cancelled = false;
    let attemptFinished = false;
    let acknowledged = false;
    const controller = new AbortController();
    const expectedRunId = session.runId;
    const expectedKey = reconciliationWindowKey;
    const expectedArtifact = handoffArtifactRef.current;
    const expectedVerdict = verdictRef.current;
    const stillCurrent = () => !cancelled
      && liveSessionRef.current.runId === expectedRunId
      && liveSessionRef.current.networkState === "CONNECTED"
      && awaitingReconciliationWindowKey(liveSessionRef.current) === expectedKey;
    const reconcile = async () => {
      if (expectedArtifact !== null && expectedArtifact.identity.runId === expectedRunId) {
        setSyncPhase("ACKNOWLEDGING");
        try {
          await requestSameOriginEvidenceAcknowledgement({
            missionId: expectedArtifact.identity.missionId,
            runId: expectedArtifact.identity.runId,
            receiptId: expectedArtifact.finalReceipt.receiptId,
            receiptDigest: finalReceiptMember(expectedArtifact.finalReceipt).digest,
            bundleId: expectedArtifact.peb.bundleId,
            bundleDigest: expectedArtifact.peb.manifest.bundleDigest,
          }, globalThis.fetch, controller.signal);
          if (!stillCurrent()) return;
          acknowledged = true;
          setSyncPhase("ACKNOWLEDGED");
        } catch (error) {
          if (!stillCurrent() || (error instanceof DOMException && error.name === "AbortError")) return;
          setSyncPhase("FAILED");
        }
      } else {
        await Promise.resolve();
      }
      if (!stillCurrent()) return;
      const baseStore: BaseStore = (() => {
        try {
          return storageBaseStore(window.localStorage, MISSION_ID, expectedRunId);
        } catch {
          return memoryBaseStore(expectedRunId);
        }
      })();
      let attempt: ReconciliationAttempt;
      try {
        // Every mission record due by now is projected first, so the receipt,
        // which takes the next append slot, can never pass over one of them.
        const reached = journalAt(liveSessionRef.current, masterTimeRef.current);
        attempt = performReconciliation({
          session: reached,
          baseStore,
          artifacts: artifactStateFor(expectedArtifact, expectedVerdict),
          masterTimeMs: masterTimeRef.current,
        });
      } catch {
        attempt = refusedReconciliationAttempt(liveSessionRef.current, "DIGEST_COMPUTATION_FAILED");
      }
      setBaseTransfer(attempt.performed);
      setReconciliation(attempt.result);
      if (attempt.result.status === "COMPLETE" && attempt.result.receipt !== null) {
        liveSessionRef.current = attempt.result.session;
        setLiveSession(attempt.result.session);
      }
      setSyncPhase(attempt.result.status !== "COMPLETE" ? "FAILED" : acknowledged ? "ACKNOWLEDGED" : "RECONCILED");
      attemptFinished = true;
    };
    void reconcile();
    return () => {
      cancelled = true;
      controller.abort();
      // A transient loss of current sentinel truth cancels this attempt; it
      // must be eligible again when the same restoration becomes current.
      if (!attemptFinished) reconciliationStartedRef.current = false;
    };
  }, [linkPhase, reconciliationWindowKey, session.runId]);

  const snapshot = useMemo<EngineSnapshot>(() => ({
    masterTimeMs: masterTime,
    effectiveStoryTimeMs: effectiveStoryTime,
    playing,
    session,
    closure,
    closureReason: closureState.reason,
    receiptBindings,
    finalReceipt,
    humanDecision,
    networkState,
    linkObservationCurrent,
    linkPhase,
    sentinelReachable: linkReport.sentinel === "OK",
    transitionFlash,
    unsequencedObservation,
    reconciliation,
    baseTransfer,
    syncPhase,
    portablePeb,
    handoffArtifact,
    transferStage: effectiveTransferStage,
    analysisRequested: effectiveAnalysisRequested,
    verification,
    handoffNetworkState: effectiveTransferStage === "TRANSFERRED" ? handoffNetworkState : null,
    verdictNetworkState: verification === null ? null : verdictNetworkState,
    physical,
    motion,
    passenger,
    routing,
  }), [baseTransfer, closure, closureState.reason, effectiveAnalysisRequested, effectiveStoryTime, effectiveTransferStage, finalReceipt, handoffArtifact, handoffNetworkState, humanDecision, linkObservationCurrent, linkPhase, linkReport.sentinel, masterTime, motion, networkState, passenger, physical, playing, portablePeb, receiptBindings, reconciliation, routing, session, syncPhase, transitionFlash, unsequencedObservation, verdictNetworkState, verification]);

  return useMemo(
    () => ({ snapshot, presentationTimeMs: presentationTime, networkBaselineReady, activeConnectivityMedium: connectivity.activeMedium, connectivityPaths: connectivity.observations, physicalAdapterBinding: adapterBinding, play, pause, seek, restart, decide, pick, drop, release, analyze }),
    [adapterBinding, analyze, connectivity.activeMedium, connectivity.observations, decide, drop, networkBaselineReady, pause, pick, play, presentationTime, release, restart, seek, snapshot],
  );
}

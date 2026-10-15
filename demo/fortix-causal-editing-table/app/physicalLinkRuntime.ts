import { adapterMatchesPhysicalTarget, isPhysicalAdapterBinding, physicalAdapterReportUrl, reportMatchesPhysicalBinding, type PhysicalAdapterBinding, type PhysicalAdapterTarget } from "./physicalAdapterBinding.ts";
import { ETHERNET_ADAPTER_IDENTITY, ETHERNET_PHYSICAL_SENTINEL_SOURCE, WIFI_PHYSICAL_SENTINEL_SOURCE } from "./physicalAdapterPolicy.ts";
import {
  type BaseCompareTransferOutcome,
  type BaseStore,
  commitBaseTransfer,
  performBaseCompareTransfer,
  planBaseCompareTransfer,
} from "./baseEvidence.ts";
import {
  SENTINEL_UNREACHABLE,
  isFreshPhysicalLinkObservation,
  isLinkSentinelReport,
  visiblePhysicalLinkState,
  type EthernetLinkState,
  type LinkSentinelReport,
} from "./ethernetLink.ts";
import {
  DEFAULT_SENTINEL_POLL_INTERVAL_MS,
  DEFAULT_DEBOUNCE_OBSERVATIONS,
  PhysicalNetworkTransitionMachine,
  type NetworkTransitionState,
} from "./networkTransitions.ts";
import {
  appendNetworkTransition,
  capturePreRestorationArtifacts,
  isInMissionReconciliationReceipt,
  latestWindowReconciliationReceipt,
  networkTransitionAdmissibility,
  offlineWindowStatus,
  reconcileInMissionOfflineEvidence,
  reconcileOfflineEvidence,
  refusedReconciliation,
  type ArtifactState,
  type JsonValue,
  type NetworkNanoReceipt,
  type OfflineEvidenceSession,
  type ReconciliationReasonCode,
  type ReconciliationResult,
} from "./offlineEvidence.ts";
import type { D006VerdictSnapshot } from "./offlineVerification.ts";
import type { HandoffArtifact } from "./portableMissionEvidence.ts";

/**
 * D-006 NX1 Checkpoint B — the physical-link runtime, extracted from the
 * legacy stage's orchestration as pure functions over the engine.
 *
 * WHAT THIS IS. The decisions the legacy `ConvergenceExperience` takes
 * between a sentinel report and the journal — freshness, the prospective
 * evidence clock, the transition machine, admissibility, the append, the
 * rollback on refusal — and the decisions it takes between a physical
 * restoration and a Reconciliation Receipt — the base compare/transfer and
 * the C1 reconciliation. Nothing here is new semantics: every judgement is an
 * engine call (`PhysicalNetworkTransitionMachine.observe`,
 * `networkTransitionAdmissibility`, `appendNetworkTransition`,
 * `capturePreRestorationArtifacts`, `performBaseCompareTransfer`,
 * `reconcileOfflineEvidence`, and since 2026-10-08 the in-mission
 * `planBaseCompareTransfer` / `reconcileInMissionOfflineEvidence` /
 * `commitBaseTransfer`). A presentation that consumes this module
 * cannot mint a LOST, a receipt or a reconciliation of its own.
 *
 * WHAT THIS IS NOT. Not a timeline, not a browser-network surrogate: the only
 * input that can move the network state is a sentinel report about the
 * Intel I226-LM adapter, and the only outputs are the engine's own records.
 *
 * The legacy stage keeps its inline copy of these steps because the D-006D
 * source contracts pin that text; NX consumes this module. The equivalence
 * is asserted by test against the engine, not assumed — for the physical
 * transitions and the post-completion reconciliation. In-mission
 * reconciliation (2026-10-08) exists only here: the legacy stage `/`, kept as
 * the negative reference, still reconciles only after an offline verdict.
 */

export const LINK_SENTINEL_URL = "http://127.0.0.1:4319/link";
/** Browser transport only: the application relays the ZBook sentinel unchanged. */
export const APP_LINK_SENTINEL_URL = "/api/physical-link";
export const LINK_POLL_MS = DEFAULT_SENTINEL_POLL_INTERVAL_MS;
export const LINK_SENTINEL_TIMEOUT_MS = LINK_POLL_MS * 3;
/**
 * Long enough for a normal serialized PowerShell refresh, short enough that
 * a stuck sidecar cannot sustain a physical-link claim indefinitely.
 */
export const LINK_OBSERVATION_FRESHNESS_MS = LINK_SENTINEL_TIMEOUT_MS * 3 + LINK_POLL_MS;
/** How long the LOST / RESTORED transition mark stays visible. */
export const TRANSITION_FLASH_MS = 700;


/** UI/runtime readiness only. It does not amend the journal's CONNECTED baseline,
 * emit a transition, or authorize a new adapter. A run first seen LOST must wait
 * for a real, fresh CONNECTED baseline before canonical transition admission. */
export type PhysicalLinkBaseline = Readonly<{
  runId: string;
  startedAtEpochMs: number;
  ready: boolean;
  connectedObservations: number;
  candidateAdapterKey: string | null;
  lastObservationEpochMs: number | null;
  physicalLink: EthernetLinkState;
}>;

export type PhysicalLinkBaselineOutcome = Readonly<{
  baseline: PhysicalLinkBaseline;
  ready: boolean;
  physicalLink: EthernetLinkState;
  observationCurrent: boolean;
  /** True exactly once: establishing a baseline is never a RESTORED receipt. */
  established: boolean;
  reason: "NOT_FRESH" | "BEFORE_RUN" | "STALE_OBSERVATION" | "DUPLICATE_OBSERVATION" | "WAITING_CONNECTED" | "DEBOUNCING" | "ESTABLISHED" | "READY";
}>;

export function createPhysicalLinkBaseline(runId: string, startedAtEpochMs: number): PhysicalLinkBaseline {
  if (!runId.trim() || !Number.isFinite(startedAtEpochMs) || startedAtEpochMs < 0) throw new TypeError("a physical baseline requires a run identity and start time");
  return Object.freeze({ runId, startedAtEpochMs, ready: false, connectedObservations: 0, candidateAdapterKey: null, lastObservationEpochMs: null, physicalLink: "UNKNOWN" });
}

export function observePhysicalLinkBaseline(
  baseline: PhysicalLinkBaseline,
  report: LinkSentinelReport,
  nowEpochMs: number,
): PhysicalLinkBaselineOutcome {
  const result = (next: PhysicalLinkBaseline, physicalLink: EthernetLinkState, observationCurrent: boolean, established: boolean, reason: PhysicalLinkBaselineOutcome["reason"]): PhysicalLinkBaselineOutcome =>
    Object.freeze({ baseline: next, ready: next.ready, physicalLink, observationCurrent, established, reason });
  const unknown = (reason: PhysicalLinkBaselineOutcome["reason"]) => result(Object.freeze({ ...baseline, connectedObservations: 0, candidateAdapterKey: null, physicalLink: "UNKNOWN" }), "UNKNOWN", false, false, reason);
  if (!isFreshPhysicalLinkObservation(report, nowEpochMs, LINK_OBSERVATION_FRESHNESS_MS)) return unknown("NOT_FRESH");
  const observedEpochMs = Date.parse(report.observedAt);
  if (observedEpochMs < baseline.startedAtEpochMs) return unknown("BEFORE_RUN");
  if (baseline.lastObservationEpochMs !== null && observedEpochMs < baseline.lastObservationEpochMs) return unknown("STALE_OBSERVATION");
  const adapterKey = JSON.stringify([report.adapter!.name, report.adapter!.description, report.adapter!.ifIndex, report.adapter!.interfaceGuid ?? null]);
  if (observedEpochMs === baseline.lastObservationEpochMs) {
    const coherent = baseline.physicalLink === report.link && (baseline.candidateAdapterKey === null || baseline.candidateAdapterKey === adapterKey);
    return result(baseline, coherent ? baseline.physicalLink : "UNKNOWN", coherent, false, "DUPLICATE_OBSERVATION");
  }
  if (baseline.ready) return result(baseline, report.link, true, false, "READY");
  const connectedObservations = report.link === "CONNECTED"
    ? baseline.candidateAdapterKey === adapterKey ? baseline.connectedObservations + 1 : 1
    : 0;
  const ready = connectedObservations >= DEFAULT_DEBOUNCE_OBSERVATIONS;
  const next = Object.freeze({ ...baseline, ready, connectedObservations, candidateAdapterKey: report.link === "CONNECTED" ? adapterKey : null, lastObservationEpochMs: observedEpochMs, physicalLink: report.link });
  return result(next, report.link, true, ready, ready ? "ESTABLISHED" : report.link === "CONNECTED" ? "DEBOUNCING" : "WAITING_CONNECTED");
}

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * One sentinel read. Reaching the sentinel is NOT evidence of connectivity:
 * it listens on loopback and answers with the cable out. An unreachable or
 * malformed answer is `SENTINEL_UNREACHABLE`, never "connected".
 */
export async function readLinkSentinel(
  signal: AbortSignal,
  fetcher: Fetcher = globalThis.fetch,
  url: string = APP_LINK_SENTINEL_URL,
  target?: PhysicalAdapterTarget,
): Promise<LinkSentinelReport> {
  try {
    const response = await fetcher(target === undefined ? url : physicalAdapterReportUrl(url, target), { cache: "no-store", signal });
    if (!response.ok) return SENTINEL_UNREACHABLE;
    const value: unknown = await response.json();
    if (!isLinkSentinelReport(value)) return SENTINEL_UNREACHABLE;
    if (target !== undefined && value.sentinel === "OK" && (value.adapter === null || !adapterMatchesPhysicalTarget(value.adapter, target))) return SENTINEL_UNREACHABLE;
    return value;
  } catch {
    return SENTINEL_UNREACHABLE;
  }
}

export type PhysicalObservationOutcome =
  | Readonly<{
    kind: "NOT_FRESH";
    machine: PhysicalNetworkTransitionMachine;
    networkState: NetworkTransitionState;
    linkObservationCurrent: false;
    unsequencedObservation: null;
  }>
  | Readonly<{
    kind: "TRANSITION";
    machine: PhysicalNetworkTransitionMachine;
    networkState: NetworkTransitionState;
    session: OfflineEvidenceSession;
    nanoReceipt: NetworkNanoReceipt;
    transition: "LOST" | "RESTORED";
    linkObservationCurrent: boolean;
    unsequencedObservation: null;
  }>
  | Readonly<{
    kind: "STABLE";
    machine: PhysicalNetworkTransitionMachine;
    networkState: NetworkTransitionState;
    /** `null` keeps the caller's current value (a duplicate sample). */
    linkObservationCurrent: boolean | null;
    unsequencedObservation: null;
  }>
  | Readonly<{
    kind: "REFUSED";
    machine: PhysicalNetworkTransitionMachine;
    networkState: NetworkTransitionState;
    linkObservationCurrent: false;
    unsequencedObservation: string;
  }>;

/**
 * Accept one sentinel report against the current journal. This is the legacy
 * poll body, step for step:
 *
 *   1. a stale or structurally valid-but-old sample is not a physical
 *      observation and never advances the machine;
 *   2. the prospective evidence clock is the next append position — the
 *      presented mission position only for the very first record, the last
 *      record's position + 1 afterwards, so seek/rewind cannot lower it;
 *   3. the machine debounces; a confirmed transition is checked against the
 *      journal's two-valued grammar (`networkTransitionAdmissibility`) and
 *      appended by the engine (`appendNetworkTransition`);
 *   4. any refusal rolls the machine back to its pre-observation snapshot so
 *      the next poll can retry the same physical truth, and is reported.
 *
 * The machine passed in may be mutated (`observe`); the outcome always names
 * the machine to keep — the same instance, or a rolled-back replacement.
 */
export function admitPhysicalObservation(input: Readonly<{
  session: OfflineEvidenceSession;
  machine: PhysicalNetworkTransitionMachine;
  report: LinkSentinelReport;
  nowEpochMs: number;
  masterTimeMs: number;
  binding?: PhysicalAdapterBinding;
}>): PhysicalObservationOutcome {
  const { session, report } = input;
  let machine = input.machine;
  const binding = input.binding ?? machine.adapterBinding;
  if (binding !== null && (!isPhysicalAdapterBinding(binding, session.runId) || !reportMatchesPhysicalBinding(report, binding))) {
    return { kind: "NOT_FRESH", machine, networkState: machine.state, linkObservationCurrent: false, unsequencedObservation: null };
  }
  if (binding !== null && machine.adapterBinding === null) {
    machine = new PhysicalNetworkTransitionMachine({ runId: machine.runId, snapshot: machine.snapshot(), adapterBinding: binding });
  } else if (binding !== null && JSON.stringify(machine.adapterBinding) !== JSON.stringify(binding)) {
    return { kind: "REFUSED", machine, networkState: machine.state, linkObservationCurrent: false, unsequencedObservation: "PHYSICAL_ADAPTER_BINDING_CHANGED" };
  }
  if (!isFreshPhysicalLinkObservation(report, input.nowEpochMs, LINK_OBSERVATION_FRESHNESS_MS)) {
    return { kind: "NOT_FRESH", machine, networkState: machine.state, linkObservationCurrent: false, unsequencedObservation: null };
  }
  const lastEvidenceClock = session.records.at(-1)?.missionClockPosition;
  const prospectiveEvidenceClock = lastEvidenceClock === undefined
    ? Math.round(input.masterTimeMs)
    : lastEvidenceClock + 1;
  const previousMachineSnapshot = machine.snapshot();
  const rollback = (reason: string): PhysicalObservationOutcome => {
    machine = new PhysicalNetworkTransitionMachine({ runId: machine.runId, snapshot: previousMachineSnapshot, ...(binding === null ? {} : { adapterBinding: binding }) });
    return { kind: "REFUSED", machine, networkState: previousMachineSnapshot.state, linkObservationCurrent: false, unsequencedObservation: reason };
  };

  let machineResult;
  try {
    machineResult = machine.observe(report, {
      evidenceClockMs: prospectiveEvidenceClock,
      causalPredecessors: session.records.at(-1)?.receiptId === undefined ? [] : [session.records.at(-1)!.receiptId],
    });
  } catch (error) {
    return rollback(`${error instanceof Error ? error.message : "NETWORK_OBSERVATION_FAILED"}:NO_EVENT`);
  }

  if (machineResult.event === null) {
    // Candidate / debounce observations do not alter journal truth. Their
    // cache is kept only while its stable state still agrees with the journal.
    if (machineResult.state !== "UNKNOWN" && machineResult.state !== session.networkState) {
      return rollback("NETWORK_MACHINE_JOURNAL_STATE_MISMATCH");
    }
    const agreesWithAdmittedState = visiblePhysicalLinkState(report, machineResult.state) !== "UNKNOWN";
    const linkObservationCurrent = machineResult.reason === "STABLE"
      ? agreesWithAdmittedState
      : machineResult.reason === "DUPLICATE_OBSERVATION"
        ? (agreesWithAdmittedState ? null : false)
        : false;
    return { kind: "STABLE", machine, networkState: machineResult.state, linkObservationCurrent, unsequencedObservation: null };
  }

  const event = machineResult.event;
  const transition = { previousNetworkState: event.previousNetworkState, newNetworkState: event.newNetworkState };
  const admissibility = networkTransitionAdmissibility(session, transition);
  if (admissibility !== "ADMISSIBLE") return rollback(`${admissibility}:${event.eventId}`);
  try {
    const appended = appendNetworkTransition(session, {
      runId: event.runId,
      observationId: event.eventId,
      eventId: event.eventId,
      receiptId: event.receiptId,
      adapterIdentity: event.adapterIdentity.description,
      observationSource: event.adapterIdentity.description === ETHERNET_ADAPTER_IDENTITY ? ETHERNET_PHYSICAL_SENTINEL_SOURCE : WIFI_PHYSICAL_SENTINEL_SOURCE,
      ...transition,
      missionClockPosition: event.missionClockPosition.milliseconds,
      // Where the record sits in the journal must strictly increase; when it
      // HAPPENED is the mission moment the sentinel saw it.
      observedMasterTimeMs: Math.round(input.masterTimeMs),
    });
    return {
      kind: "TRANSITION",
      machine,
      networkState: machineResult.state,
      session: appended.session,
      nanoReceipt: appended.nanoReceipt,
      transition: event.eventType === "NETWORK_LINK_LOST" ? "LOST" : "RESTORED",
      linkObservationCurrent: visiblePhysicalLinkState(report, machineResult.state) !== "UNKNOWN",
      unsequencedObservation: null,
    };
  } catch (error) {
    return rollback(`${error instanceof Error ? error.message : "NETWORK_TRANSITION_APPEND_FAILED"}:${event.eventId}`);
  }
}

/** What a spectator may be told about the cable right now. */
export function visibleLinkPhase(
  report: LinkSentinelReport,
  admittedState: NetworkTransitionState,
  linkObservationCurrent: boolean,
): EthernetLinkState {
  return linkObservationCurrent ? visiblePhysicalLinkState(report, admittedState) : "UNKNOWN";
}

/** Stable identity for the exact LOST → CONNECTED window awaiting reconciliation. */
export function awaitingReconciliationWindowKey(session: OfflineEvidenceSession): string | null {
  if (offlineWindowStatus(session) !== "AWAITING_RECONCILIATION") return null;
  const lost = session.records.findLast((record) => record.eventType === "NETWORK_LINK_LOST");
  const restored = session.records.findLast((record) => record.eventType === "NETWORK_LINK_RESTORED");
  if (lost === undefined || restored === undefined) return null;
  return JSON.stringify([lost.receiptId, restored.receiptId]);
}

/**
 * The artifact state reconciliation must find unchanged: the Final Receipt,
 * the PEB and the verdict the verifier produced for exactly those bytes.
 * Null unless a verdict exists for this artifact — reconciliation then
 * reports ARTIFACT_STATE_INVALID rather than inventing a captured state.
 */
export function artifactStateFor(
  handoff: HandoffArtifact | null,
  verdict: D006VerdictSnapshot | null,
): ArtifactState | null {
  if (handoff === null || verdict === null) return null;
  if (verdict.identity.missionId !== handoff.identity.missionId
    || verdict.identity.runId !== handoff.identity.runId
    || verdict.transferredContentDigest !== handoff.transferredContentDigest) return null;
  return {
    finalReceipt: { ref: handoff.finalReceipt.receiptId, value: handoff.finalReceipt as unknown as JsonValue },
    portableEvidenceBundle: { ref: handoff.peb.bundleId, value: handoff.peb as unknown as JsonValue },
    verdict: verdict.result.verdict,
  };
}

/**
 * Records, while the link is LOST, that the mission completed locally with
 * these exact artifacts and this verdict — the immutable capture the later
 * reconciliation is checked against. A no-op when nothing is to capture or
 * the window has already captured.
 */
export function capturePreRestorationIfPossible(
  session: OfflineEvidenceSession,
  handoff: HandoffArtifact | null,
  verdict: D006VerdictSnapshot | null,
  masterTimeMs: number,
): OfflineEvidenceSession {
  const artifacts = artifactStateFor(handoff, verdict);
  if (artifacts === null || handoff === null) return session;
  if (session.networkState !== "LOST"
    || session.runId !== handoff.identity.runId
    || session.missionId !== handoff.identity.missionId
    || session.preRestorationCapture !== null) return session;
  const lastClock = session.records.at(-1)?.missionClockPosition ?? 0;
  return capturePreRestorationArtifacts(session, {
    ...artifacts,
    missionClockPosition: Math.max(lastClock + 1, Math.round(masterTimeMs)),
  }).session;
}

export type ReconciliationAttempt = Readonly<{
  performed: BaseCompareTransferOutcome | null;
  result: ReconciliationResult;
}>;

/**
 * Reconciliation, PERFORMED: a second, distinct base ledger is read, compared
 * record-for-record against the journal up to the restoration receipt, the
 * missing suffix is copied, and the frozen C1 validator checks digests, order
 * and transfer accounting — the operation earns COMPLETE or it does not.
 *
 * Two contracts (D-006, 2026-10-08), chosen from the journal alone:
 *
 *   - IN MISSION — no completion capture and no Final Receipt seal yet (or the
 *     window already holds its in-mission receipt): the evidence authored
 *     while LOST is reconciled now, with no verdict to wait for. The base is
 *     compared and the delta PLANNED; the engine validates it; only then is
 *     the base written and read back, and only a confirmed base lets the
 *     receipt exist. A refused or unconfirmed attempt appends nothing.
 *   - POST-COMPLETION — the window holds a completion capture, or the seal
 *     exists without one: the contract and its code path are unchanged. A
 *     restoration after the seal without a captured verdict still fails as
 *     ARTIFACT_STATE_INVALID; it never reaches back into a sealed PEB.
 *
 * Total: an exception is a FAILED attempt, never a throw.
 */
export function performReconciliation(input: Readonly<{
  session: OfflineEvidenceSession;
  baseStore: BaseStore;
  artifacts: ArtifactState | null;
  masterTimeMs: number;
}>): ReconciliationAttempt {
  try {
    const closing = latestWindowReconciliationReceipt(input.session);
    const inMission = closing !== null
      ? isInMissionReconciliationReceipt(closing)
      : input.session.preRestorationCapture === null && input.session.finalReceiptRuntimeSeal === null;
    return inMission ? reconcileInMission(input) : reconcileAfterCompletion(input);
  } catch {
    return refusedReconciliationAttempt(input.session, "DIGEST_COMPUTATION_FAILED");
  }
}

/** A FAILED attempt that appended nothing — the session as given, and no base operation reported. */
export function refusedReconciliationAttempt(
  session: OfflineEvidenceSession,
  reasonCode: ReconciliationReasonCode,
): ReconciliationAttempt {
  return { performed: null, result: refusedReconciliation(session, [reasonCode]) };
}

function reconcileAfterCompletion(input: Parameters<typeof performReconciliation>[0]): ReconciliationAttempt {
  const performed = performBaseCompareTransfer(input.session, input.baseStore);
  const result = reconcileOfflineEvidence({
    session: input.session,
    operation: performed?.operation ?? null,
    capture: input.session.preRestorationCapture,
    currentArtifacts: input.artifacts,
    receiptMissionClockPosition: Math.max(
      (input.session.records.at(-1)?.missionClockPosition ?? -1) + 1,
      Math.round(input.masterTimeMs),
    ),
  });
  return { performed, result };
}

function reconcileInMission(input: Parameters<typeof performReconciliation>[0]): ReconciliationAttempt {
  const { session } = input;
  const lostIndex = session.records.findLastIndex((record) => record.eventType === "NETWORK_LINK_LOST");
  const restoredIndex = session.records.findLastIndex((record) => record.eventType === "NETWORK_LINK_RESTORED");
  // Only a window the restoration has closed is ever compared with the base.
  const plan = lostIndex >= 0 && restoredIndex > lostIndex ? planBaseCompareTransfer(session, input.baseStore) : null;
  if (plan !== null && plan.kind === "UNREADABLE") return refusedReconciliationAttempt(session, "BASE_UNREADABLE");
  const performed = plan?.outcome ?? null;
  const result = reconcileInMissionOfflineEvidence({
    session,
    operation: performed?.operation ?? null,
    observedMasterTimeMs: input.masterTimeMs,
  });
  // FAILED, or the window's existing receipt answered again: nothing to write.
  if (result.status !== "COMPLETE" || result.session === session || performed === null) return { performed, result };
  // A new receipt exists only once the base holds exactly the after-snapshot.
  if (!commitBaseTransfer(input.baseStore, performed.operation.baseAfter)) {
    return {
      performed: Object.freeze({ ...performed, transferred: false, refusalReason: "BASE_WRITE_UNCONFIRMED" as const }),
      result: refusedReconciliation(session, ["BASE_WRITE_UNCONFIRMED"], result.missingObjectIds),
    };
  }
  return { performed: Object.freeze({ ...performed, transferred: true }), result };
}

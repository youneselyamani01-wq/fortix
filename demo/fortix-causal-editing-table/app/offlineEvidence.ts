import { isSupportedPhysicalAdapterIdentity, isSupportedPhysicalAdapterSource, type PhysicalSentinelSource } from "./physicalAdapterPolicy.ts";
import { blake3 } from "@noble/hashes/blake3.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

import { canonicalString, type CanonicalVerdict } from "./verification.ts";
import { MISSION_ID } from "./missionContinuity.ts";
import type { StableNetworkState } from "./networkTransitions.ts";
import { REQUIRED_RUNTIME_EVIDENCE_CUTOFF_EXCLUSIVE_MS } from "./storyTimeline.ts";

export const PHYSICAL_SENTINEL_SOURCE = "INTEL_I226_LM_PHYSICAL_SENTINEL";
export const TARGET_ADAPTER_IDENTITY = "Intel(R) Ethernet Controller I226-LM";

const BASE_RECORD_KEYS = Object.freeze([
  "missionId",
  "runId",
  "eventId",
  "eventType",
  "receiptId",
  "missionClockPosition",
  "causalPredecessors",
  "evidenceLocality",
  "executionLocality",
  "payload",
  "canonicalDigest",
]);
const NETWORK_RECORD_KEYS = Object.freeze([
  ...BASE_RECORD_KEYS,
  "nanoReceiptType",
  "adapterIdentity",
  "previousNetworkState",
  "newNetworkState",
  "observationSource",
  "observationId",
]);
const NETWORK_PAYLOAD_KEYS = Object.freeze([
  "adapter_identity",
  "previous_network_state",
  "new_network_state",
  "observation_source",
  "observation_id",
  "observed_master_time_ms",
]);
const COMPLETION_PAYLOAD_KEYS = Object.freeze([
  "final_receipt_ref",
  "final_receipt_digest",
  "peb_ref",
  "peb_digest",
  "local_verdict",
]);
const RECONCILIATION_RECORD_KEYS = Object.freeze([
  ...BASE_RECORD_KEYS,
  "operationId",
  "offlineWindowStartRef",
  "offlineWindowEndRef",
  "baseBeforeDigest",
  "baseAfterDigest",
  "transferredObjectIds",
  "localObjectCount",
  "baseMissingObjectCount",
  "transferredObjectCount",
  "digestComparison",
  "causalOrderPreserved",
  "finalReceiptRef",
  "finalReceiptUnchanged",
  "pebRef",
  "pebDigest",
  "pebUnchanged",
  "localVerdict",
  "verdictUnchanged",
  "reconciliationResult",
]);
const RECONCILIATION_PAYLOAD_KEYS = Object.freeze([
  "operation_id",
  "offline_window_start_ref",
  "offline_window_end_ref",
  "base_before_digest",
  "base_after_digest",
  "transferred_object_ids",
  "local_object_count",
  "base_missing_object_count",
  "transferred_object_count",
  "digest_comparison",
  "causal_order_preserved",
  "final_receipt_ref",
  "final_receipt_unchanged",
  "peb_ref",
  "peb_digest",
  "peb_unchanged",
  "local_verdict",
  "verdict_unchanged",
  "reconciliation_result",
]);
/**
 * The in-mission receipt (D-006, 2026-10-08) states what the journal prefix
 * closed by NR-NET-RESTORED establishes, and nothing about artifacts that do
 * not exist before the Final Receipt seal: no Final Receipt, PEB or verdict
 * reference, no "unchanged" claim. `offline_object_ids` names the LOCAL
 * objects authored inside the window; `observed_master_time_ms` is when the
 * reconciliation happened, as on the network records.
 */
export const IN_MISSION_RECONCILIATION_RESULT = "IN_MISSION_BASE_COMPARE_TRANSFER_COMPLETE" as const;
const IN_MISSION_RECONCILIATION_RECORD_KEYS = Object.freeze([
  ...BASE_RECORD_KEYS,
  "operationId",
  "offlineWindowStartRef",
  "offlineWindowEndRef",
  "baseBeforeDigest",
  "baseAfterDigest",
  "transferredObjectIds",
  "localObjectCount",
  "baseMissingObjectCount",
  "transferredObjectCount",
  "digestComparison",
  "causalOrderPreserved",
  "offlineObjectIds",
  "reconciliationResult",
]);
const IN_MISSION_RECONCILIATION_PAYLOAD_KEYS = Object.freeze([
  "operation_id",
  "offline_window_start_ref",
  "offline_window_end_ref",
  "base_before_digest",
  "base_after_digest",
  "transferred_object_ids",
  "local_object_count",
  "base_missing_object_count",
  "transferred_object_count",
  "digest_comparison",
  "causal_order_preserved",
  "offline_object_ids",
  "observed_master_time_ms",
  "reconciliation_result",
]);
const CAPTURE_KEYS = Object.freeze([
  "missionId",
  "runId",
  "finalReceiptRef",
  "finalReceiptDigest",
  "pebRef",
  "pebDigest",
  "verdict",
  "causalOrder",
  "causalOrderDigest",
  "capturedAtMissionClockPosition",
  "evidenceLocality",
]);
const SESSION_KEYS = Object.freeze([
  "version",
  "missionId",
  "runId",
  "initialCausalPredecessor",
  "networkState",
  "records",
  "preRestorationCapture",
  "finalReceiptRuntimeSeal",
]);
const FINAL_RECEIPT_RUNTIME_SEAL_KEYS = Object.freeze([
  "profile",
  "missionId",
  "runId",
  "sealedAtMasterTimeMs",
  "sealedRecordCount",
  "journalPrefixDigest",
  "terminalRecordDigest",
]);

export type EvidenceLocality = "LOCAL" | "RECONCILED";
export type ExecutionLocality = "LOCAL" | "REMOTE";
export type NetworkEvidenceEventType = "NETWORK_LINK_LOST" | "NETWORK_LINK_RESTORED";

/**
 * Routing provenance is orthogonal to both network state and evidence
 * locality. Nullable execution fields mean "not established"; this model
 * never turns an offline network observation into a claim of local execution.
 */
export type ModelRoutingEvidence = Readonly<{
  routingRequest: string;
  routingPolicyRef: string;
  candidateSet: readonly string[];
  selectedModel: string | null;
  resolvedModel: string | null;
  executionLocality: ExecutionLocality | null;
  executionRuntime: string | null;
  executionDevice: string | null;
  provider: string | null;
  fallbackReason: string | null;
}>;

export type ModelRoutingEvidenceInput = ModelRoutingEvidence;

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | Readonly<{ [key: string]: JsonValue }>;

export type OfflineCausalRecord = Readonly<{
  missionId: string;
  runId: string;
  eventId: string;
  eventType: string;
  receiptId: string;
  missionClockPosition: number;
  causalPredecessors: readonly string[];
  evidenceLocality: EvidenceLocality;
  executionLocality: ExecutionLocality;
  payload: Readonly<Record<string, JsonValue>>;
  canonicalDigest: string;
}>;

export type NetworkNanoReceipt = OfflineCausalRecord & Readonly<{
  eventType: NetworkEvidenceEventType;
  nanoReceiptType: "NR-NET-LOST" | "NR-NET-RESTORED";
  adapterIdentity: string;
  previousNetworkState: StableNetworkState;
  newNetworkState: StableNetworkState;
  observationSource: PhysicalSentinelSource;
  observationId: string;
}>;

export type ArtifactReference = Readonly<{
  ref: string;
  value: JsonValue;
}>;

export type ArtifactState = Readonly<{
  finalReceipt: ArtifactReference;
  portableEvidenceBundle: ArtifactReference;
  verdict: CanonicalVerdict;
}>;

export type PreRestorationCapture = Readonly<{
  missionId: string;
  runId: string;
  finalReceiptRef: string;
  finalReceiptDigest: string;
  pebRef: string;
  pebDigest: string;
  verdict: CanonicalVerdict;
  causalOrder: readonly string[];
  causalOrderDigest: string;
  capturedAtMissionClockPosition: number;
  evidenceLocality: "LOCAL";
}>;

/** Durable append boundary for the journal bytes supporting Final Receipt. */
export type FinalReceiptRuntimeSeal = Readonly<{
  profile: "fortix.demo.d006.final-receipt-runtime-seal.v1";
  missionId: string;
  runId: string;
  sealedAtMasterTimeMs: number;
  sealedRecordCount: number;
  journalPrefixDigest: string;
  terminalRecordDigest: string | null;
}>;

export type OfflineEvidenceSession = Readonly<{
  version: 2;
  missionId: string;
  runId: string;
  initialCausalPredecessor: string | null;
  networkState: StableNetworkState;
  records: readonly OfflineCausalRecord[];
  preRestorationCapture: PreRestorationCapture | null;
  finalReceiptRuntimeSeal: FinalReceiptRuntimeSeal | null;
}>;

export type NetworkTransitionInput = Readonly<{
  runId: string;
  observationId: string;
  eventId?: string;
  receiptId?: string;
  adapterIdentity: string;
  observationSource: PhysicalSentinelSource;
  previousNetworkState: StableNetworkState;
  newNetworkState: StableNetworkState;
  missionClockPosition: number;
  /**
   * The mission moment at which the sentinel actually observed this, as
   * distinct from `missionClockPosition`, which is the record's slot in the
   * append-only journal.
   *
   * They differ, and the difference was a real defect. The journal requires
   * strictly increasing positions, so a physical event observed while the
   * clock sits at 30_000 with evidence already at 30_000 is filed at 30_001 —
   * one millisecond in the FUTURE of the view. The Proof Tree filters by
   * time, so a cable pulled while the demonstration was paused authored real
   * evidence that was then invisible until the clock passed it.
   *
   * Append order is not mission time. This field records when it happened;
   * `missionClockPosition` records where it sits.
   */
  observedMasterTimeMs?: number;
}>;

export type NetworkTransitionResult = Readonly<{
  session: OfflineEvidenceSession;
  nanoReceipt: NetworkNanoReceipt;
  appended: boolean;
}>;

export type OfflineEvidenceInput = Readonly<{
  missionId: string;
  runId: string;
  eventId: string;
  eventType: string;
  receiptId: string;
  missionClockPosition: number;
  executionLocality: ExecutionLocality;
  payload: Readonly<Record<string, JsonValue>>;
}>;

export type OfflineEvidenceAppendResult = Readonly<{
  session: OfflineEvidenceSession;
  record: OfflineCausalRecord;
}>;

export type CaptureInput = ArtifactState & Readonly<{
  missionClockPosition: number;
}>;

export type CaptureResult = Readonly<{
  session: OfflineEvidenceSession;
  capture: PreRestorationCapture;
}>;

export type BaseEvidenceSnapshot = Readonly<{
  missionId: string;
  runId: string;
  records: readonly OfflineCausalRecord[];
}>;

export type ReconciliationReasonCode =
  | "MISSION_ID_MISMATCH"
  | "RUN_ID_MISMATCH"
  | "OFFLINE_WINDOW_INVALID"
  | "MISSING_RESTORATION_RECEIPT"
  | "LOCAL_DIGEST_MISMATCH"
  | "BASE_DIGEST_MISMATCH"
  | "RECORD_PROJECTION_MISMATCH"
  | "NETWORK_STATE_MISMATCH"
  | "DUPLICATE_OBJECT_ID"
  | "CAUSAL_ORDER_MISMATCH"
  | "BASE_UNEXPECTED_OBJECT"
  | "BASE_OBJECTS_MISSING"
  | "FINAL_RECEIPT_REF_MISMATCH"
  | "FINAL_RECEIPT_CHANGED"
  | "PEB_REF_MISMATCH"
  | "PEB_CHANGED"
  | "VERDICT_CHANGED"
  | "ARTIFACT_STATE_INVALID"
  | "RECONCILIATION_EVIDENCE_MISSING"
  | "TRANSFER_ACCOUNTING_MISMATCH"
  | "RECONCILIATION_OPERATION_CONFLICT"
  // In-mission reconciliation (2026-10-08).
  /** The Final Receipt boundary is sealed: in-mission reconciliation is over for this run. */
  | "IN_MISSION_WINDOW_SEALED"
  /** A completion capture exists: the window belongs to the post-verdict path. */
  | "IN_MISSION_CAPTURE_PRESENT"
  /** The reconciliation moment is not a finite mission time before the Final Receipt cutoff. */
  | "IN_MISSION_TIME_EXHAUSTED"
  /** A digest or canonical form could not be computed; nothing is established. */
  | "DIGEST_COMPUTATION_FAILED"
  /** The base ledger holds bytes that are not a readable base snapshot. */
  | "BASE_UNREADABLE"
  /** The base did not read back exactly the after-snapshot it was given. */
  | "BASE_WRITE_UNCONFIRMED";

export type ReconciliationReceipt = OfflineCausalRecord & Readonly<{
  eventType: "RECONCILIATION_RECEIPT";
  operationId: string;
  offlineWindowStartRef: string;
  offlineWindowEndRef: string;
  baseBeforeDigest: string;
  baseAfterDigest: string;
  transferredObjectIds: readonly string[];
  localObjectCount: number;
  baseMissingObjectCount: number;
  /** Exact cardinality of the verified base-before to base-after delta. */
  transferredObjectCount: number;
  /** MATCH is available only after both snapshots and every digest validate. */
  digestComparison: "MATCH";
  causalOrderPreserved: true;
  finalReceiptRef: string;
  finalReceiptUnchanged: true;
  pebRef: string;
  pebDigest: string;
  pebUnchanged: true;
  localVerdict: CanonicalVerdict;
  verdictUnchanged: true;
  reconciliationResult: string;
  /** Named only by the in-mission variant. */
  offlineObjectIds?: undefined;
}>;

/**
 * The receipt an IN-MISSION reconciliation appends: the network came back
 * before the Final Receipt existed, and the evidence authored while LOST is
 * reconciled then — without waiting for a verdict.
 *
 * The post-completion receipt above attests that restoration rewrote nothing
 * the mission had concluded: the Final Receipt, the PEB, the verdict. Those
 * live OUTSIDE the journal, so they had to be captured while LOST — which is
 * why reconciliation waited for the offline verdict. Evidence produced while
 * LOST lives INSIDE the journal, digest-committed and chained record by
 * record. The prefix that NR-NET-RESTORED closes is therefore its own offline
 * evidence checkpoint: anyone holding those records can recompute what the
 * base held before and after, what moved, and which objects were authored
 * offline. This receipt states exactly that, and can be sealed into the Final
 * Receipt and carried by the PEB.
 *
 * Same event type and the same window-derived identity as the other variant
 * (one window, one receipt, whichever closes it); `reconciliationResult`
 * discriminates.
 */
export type InMissionReconciliationReceipt = OfflineCausalRecord & Readonly<{
  eventType: "RECONCILIATION_RECEIPT";
  operationId: string;
  offlineWindowStartRef: string;
  offlineWindowEndRef: string;
  baseBeforeDigest: string;
  baseAfterDigest: string;
  transferredObjectIds: readonly string[];
  localObjectCount: number;
  baseMissingObjectCount: number;
  transferredObjectCount: number;
  digestComparison: "MATCH";
  causalOrderPreserved: true;
  /** The LOCAL objects authored strictly between the window's NR-NET-LOST and NR-NET-RESTORED. */
  offlineObjectIds: readonly string[];
  reconciliationResult: typeof IN_MISSION_RECONCILIATION_RESULT;
  // Before the seal there is no Final Receipt, PEB or verdict to find
  // unchanged. Declared absent, so reading either variant yields no claim.
  finalReceiptRef?: undefined;
  finalReceiptUnchanged?: undefined;
  pebRef?: undefined;
  pebDigest?: undefined;
  pebUnchanged?: undefined;
  localVerdict?: undefined;
  verdictUnchanged?: undefined;
}>;

export type ReconciliationOperationEvidence = Readonly<{
  kind: "BASE_COMPARE_TRANSFER";
  operationId: string;
  baseBefore: BaseEvidenceSnapshot;
  baseAfter: BaseEvidenceSnapshot;
  transferredReceiptIds: readonly string[];
}>;

export type ReconciliationInput = Readonly<{
  session: OfflineEvidenceSession;
  operation: ReconciliationOperationEvidence | null;
  capture: PreRestorationCapture | null;
  currentArtifacts: ArtifactState | null;
  receiptMissionClockPosition?: number;
}>;

export type InMissionReconciliationInput = Readonly<{
  session: OfflineEvidenceSession;
  operation: ReconciliationOperationEvidence | null;
  /**
   * When the reconciliation ran, on the mission clock. The receipt's journal
   * position is the next append slot, like every physical record; this is
   * when it happened, and it is never earlier than the restoration it closes.
   */
  observedMasterTimeMs: number;
}>;

export type ReconciliationResult = Readonly<{
  status: "COMPLETE" | "FAILED";
  receipt: ReconciliationReceipt | InMissionReconciliationReceipt | null;
  reasonCodes: readonly ReconciliationReasonCode[];
  session: OfflineEvidenceSession;
  reconciledBase: BaseEvidenceSnapshot | null;
  missingObjectIds: readonly string[];
  transferredObjectCount: number;
  finalReceiptUnchanged: boolean;
  pebUnchanged: boolean;
  verdictUnchanged: boolean;
  causalOrderPreserved: boolean;
}>;

export class OfflineEvidenceError extends TypeError {
  readonly reasonCode: string;

  constructor(reasonCode: string, message: string) {
    super(message);
    this.name = "OfflineEvidenceError";
    this.reasonCode = reasonCode;
  }
}

export function createOfflineEvidenceSession(
  runId: string,
  initialCausalPredecessor: string | null = null,
  missionId: string = MISSION_ID,
): OfflineEvidenceSession {
  requireNonEmpty(missionId, "MISSION_ID_REQUIRED");
  requireNonEmpty(runId, "RUN_ID_REQUIRED");
  if (initialCausalPredecessor !== null) requireNonEmpty(initialCausalPredecessor, "PREDECESSOR_REQUIRED");
  return freezeSession({
    version: 2,
    missionId,
    runId,
    initialCausalPredecessor,
    networkState: "CONNECTED",
    records: [],
    preRestorationCapture: null,
    finalReceiptRuntimeSeal: null,
  });
}

/**
 * Seals the exact append-only prefix present at Final Receipt emission.
 * Replaying this operation is idempotent; an existing seal can never move
 * forward and absorb evidence authored after issuance.
 */
export function sealFinalReceiptRuntimeEvidence(
  session: OfflineEvidenceSession,
  sealedAtMasterTimeMs: number,
): OfflineEvidenceSession {
  if (!Number.isFinite(sealedAtMasterTimeMs) || sealedAtMasterTimeMs < 0) {
    throw new OfflineEvidenceError(
      "FINAL_RECEIPT_SEAL_TIME_INVALID",
      "the Final Receipt seal time must be finite and non-negative",
    );
  }
  if (!isOfflineEvidenceSessionJournalValid(session)) {
    throw new OfflineEvidenceError(
      "FINAL_RECEIPT_SEAL_INVALID",
      "only a valid append-only journal may be sealed for Final Receipt",
    );
  }
  if (session.finalReceiptRuntimeSeal !== null) {
    if (!isFinalReceiptRuntimeSealValid(session)
      || session.finalReceiptRuntimeSeal.sealedAtMasterTimeMs !== sealedAtMasterTimeMs) {
      throw new OfflineEvidenceError(
        "FINAL_RECEIPT_SEAL_INVALID",
        "an existing Final Receipt evidence boundary cannot be rewritten",
      );
    }
    return session;
  }
  const seal: FinalReceiptRuntimeSeal = deepFreeze({
    profile: "fortix.demo.d006.final-receipt-runtime-seal.v1" as const,
    missionId: session.missionId,
    runId: session.runId,
    sealedAtMasterTimeMs,
    sealedRecordCount: session.records.length,
    journalPrefixDigest: digestCanonical(session.records),
    terminalRecordDigest: session.records.at(-1)?.canonicalDigest ?? null,
  });
  return freezeSession({ ...session, finalReceiptRuntimeSeal: seal });
}

/** Exact sealed bytes, or null when no valid issuance boundary exists. */
export function sealedFinalReceiptRuntimeRecords(
  session: OfflineEvidenceSession,
): readonly OfflineCausalRecord[] | null {
  if (!isFinalReceiptRuntimeSealValid(session)) return null;
  return deepFreeze(session.records.slice(0, session.finalReceiptRuntimeSeal!.sealedRecordCount));
}

export function createModelRoutingEvidence(
  input: ModelRoutingEvidenceInput,
): ModelRoutingEvidence {
  requireNonEmpty(input.routingRequest, "ROUTING_REQUEST_REQUIRED");
  requireNonEmpty(input.routingPolicyRef, "ROUTING_POLICY_REF_REQUIRED");
  if (input.candidateSet.length === 0 || new Set(input.candidateSet).size !== input.candidateSet.length) {
    throw new OfflineEvidenceError("ROUTING_CANDIDATE_SET_INVALID", "the routing candidate set must be non-empty and unique");
  }
  for (const candidate of input.candidateSet) requireNonEmpty(candidate, "ROUTING_CANDIDATE_INVALID");
  if (input.selectedModel !== null && !input.candidateSet.includes(input.selectedModel)) {
    throw new OfflineEvidenceError("SELECTED_MODEL_NOT_CANDIDATE", "the selected model must be present in the candidate set");
  }
  if (input.resolvedModel !== null && !input.candidateSet.includes(input.resolvedModel)) {
    throw new OfflineEvidenceError("RESOLVED_MODEL_NOT_CANDIDATE", "the resolved model must be present in the candidate set");
  }
  for (const value of [
    input.selectedModel,
    input.resolvedModel,
    input.executionRuntime,
    input.executionDevice,
    input.provider,
    input.fallbackReason,
  ]) {
    if (value !== null) requireNonEmpty(value, "MODEL_ROUTING_FIELD_INVALID");
  }
  return deepFreeze({ ...input, candidateSet: [...input.candidateSet] });
}

/**
 * Whether this physical transition may be written into this journal, and if
 * not, exactly why.
 *
 * Callers use this same predicate before appending, so the two-valued physical
 * grammar cannot drift from its enforcement.
 */
export function networkTransitionAdmissibility(
  session: OfflineEvidenceSession,
  input: Pick<NetworkTransitionInput, "previousNetworkState" | "newNetworkState">,
): "ADMISSIBLE" | "NETWORK_TRANSITION_INVALID" | "NETWORK_TRANSITION_OUT_OF_SEQUENCE" {
  const isLoss = input.previousNetworkState === "CONNECTED" && input.newNetworkState === "LOST";
  const isRestoration = input.previousNetworkState === "LOST" && input.newNetworkState === "CONNECTED";
  if (!isLoss && !isRestoration) return "NETWORK_TRANSITION_INVALID";
  const derivedState = journalNetworkState(session);
  if (derivedState === null
    || derivedState !== session.networkState
    || session.networkState !== input.previousNetworkState) {
    return "NETWORK_TRANSITION_OUT_OF_SEQUENCE";
  }
  return "ADMISSIBLE";
}

/**
 * Appends the significant event and its nano-receipt as one canonical causal
 * record. Replaying the same physical observation is a no-op; a different
 * observation that contradicts the current network state is rejected.
 */
export function appendNetworkTransition(
  session: OfflineEvidenceSession,
  input: NetworkTransitionInput,
): NetworkTransitionResult {
  const replay = session.records
    .filter(isNetworkNanoReceipt)
    .find((record) => record.observationId === input.observationId);
  if (replay !== undefined) {
    if (!isSpecializedRecordProjectionValid(replay)) {
      throw new OfflineEvidenceError(
        "RECORD_PROJECTION_MISMATCH",
        "network receipt fields must equal their canonically digested payload",
      );
    }
    if (!sameNetworkObservation(replay, input)) {
      throw new OfflineEvidenceError("OBSERVATION_ID_CONFLICT", "a physical observation id cannot describe two transitions");
    }
    return deepFreeze({ session, nanoReceipt: replay, appended: false });
  }

  requireNonEmpty(input.observationId, "OBSERVATION_ID_REQUIRED");
  if (input.observedMasterTimeMs !== undefined
    && (!Number.isFinite(input.observedMasterTimeMs) || input.observedMasterTimeMs < 0)) {
    throw new OfflineEvidenceError(
      "MISSION_CLOCK_INVALID",
      "physical observation time must be finite and non-negative",
    );
  }
  if (input.runId !== session.runId) {
    throw new OfflineEvidenceError("RUN_ID_MISMATCH", "network evidence cannot cross the active mission run");
  }
  if (!isSupportedPhysicalAdapterIdentity(input.adapterIdentity)) {
    throw new OfflineEvidenceError("ADAPTER_IDENTITY_MISMATCH", "network evidence requires an explicitly supported physical adapter identity");
  }
  if (!isSupportedPhysicalAdapterSource(input.adapterIdentity, input.observationSource)) {
    throw new OfflineEvidenceError("OBSERVATION_SOURCE_INVALID", "network transitions require the physical sentinel source");
  }
  const admissibility = networkTransitionAdmissibility(session, input);
  if (admissibility !== "ADMISSIBLE") {
    throw new OfflineEvidenceError(
      admissibility,
      admissibility === "NETWORK_TRANSITION_INVALID"
        ? "only CONNECTED → LOST and LOST → CONNECTED are evidence transitions"
        : "the observed previous state must match the append-only session state",
    );
  }
  const isLoss = input.previousNetworkState === "CONNECTED" && input.newNetworkState === "LOST";

  const eventType: NetworkEvidenceEventType = isLoss ? "NETWORK_LINK_LOST" : "NETWORK_LINK_RESTORED";
  const nanoReceiptType = isLoss ? "NR-NET-LOST" : "NR-NET-RESTORED";
  const identitySuffix = digestCanonical({ observation_id: input.observationId, event_type: eventType }).slice(0, 16);
  const receiptId = input.receiptId ?? `${nanoReceiptType}:${identitySuffix}`;
  const eventId = input.eventId ?? `d006d.${isLoss ? "network-link-lost" : "network-link-restored"}:${identitySuffix}`;
  const common = {
    missionId: session.missionId,
    runId: session.runId,
    eventId,
    eventType,
    receiptId,
    missionClockPosition: input.missionClockPosition,
    evidenceLocality: "LOCAL" as const,
    executionLocality: "LOCAL" as const,
    payload: {
      adapter_identity: input.adapterIdentity,
      previous_network_state: input.previousNetworkState,
      new_network_state: input.newNetworkState,
      observation_source: input.observationSource,
      observation_id: input.observationId,
      // When the sentinel saw it, which is what the view should display.
      observed_master_time_ms: input.observedMasterTimeMs ?? input.missionClockPosition,
    },
  };
  const appended = appendRecord(session, common);
  const nanoReceipt = deepFreeze({
    ...appended.record,
    eventType,
    nanoReceiptType,
    adapterIdentity: input.adapterIdentity,
    previousNetworkState: input.previousNetworkState,
    newNetworkState: input.newNetworkState,
    observationSource: input.observationSource,
    observationId: input.observationId,
  }) as NetworkNanoReceipt;
  const records = [...appended.session.records.slice(0, -1), nanoReceipt];
  const nextSession = freezeSession({
    ...appended.session,
    networkState: input.newNetworkState,
    records,
  });
  return deepFreeze({ session: nextSession, nanoReceipt, appended: true });
}

/**
 * Adds mission evidence at any point in the run, connected or not.
 *
 * `appendOfflineEvidence` below is the offline-continuity constructor: it
 * requires a LOST link because its whole purpose is to prove the journal
 * keeps growing while the cable is out. That guard is correct for what it
 * does and is untouched.
 *
 * But most of a mission happens with the cable in. Smart-city and financial
 * evidence occur mid-journey and at the garage, and refusing to record them
 * unless the network happens to be down would make the network state decide
 * whether a real-world event is worth evidencing — the exact inference the
 * three-dimension separation forbids. Evidence locality stays LOCAL either
 * way: a record is local until it is reconciled, which is a fact about
 * reconciliation, not about connectivity.
 *
 * Everything else is shared with the offline path through `appendRecord`:
 * exactly-once identities, a monotonic mission clock, canonical digests.
 */
export function appendMissionEvidence(
  session: OfflineEvidenceSession,
  input: OfflineEvidenceInput,
): OfflineEvidenceAppendResult {
  if (input.missionId !== session.missionId) {
    throw new OfflineEvidenceError("MISSION_ID_MISMATCH", "mission evidence cannot fork the mission identity");
  }
  if (input.runId !== session.runId) {
    throw new OfflineEvidenceError("RUN_ID_MISMATCH", "mission evidence cannot cross the active mission run");
  }
  if (isReservedEventType(input.eventType)) {
    throw new OfflineEvidenceError("RESERVED_EVENT_TYPE", "network and reconciliation records have dedicated constructors");
  }
  return deepFreeze(appendRecord(session, { ...input, evidenceLocality: "LOCAL" }));
}

/** Adds mission evidence only inside the locally evidenced offline window. */
export function appendOfflineEvidence(
  session: OfflineEvidenceSession,
  input: OfflineEvidenceInput,
): OfflineEvidenceAppendResult {
  if (session.networkState !== "LOST") {
    throw new OfflineEvidenceError("OFFLINE_WINDOW_NOT_ACTIVE", "offline continuation evidence requires LOST network state");
  }
  if (input.missionId !== session.missionId) {
    throw new OfflineEvidenceError("MISSION_ID_MISMATCH", "offline evidence cannot fork the mission identity");
  }
  if (input.runId !== session.runId) {
    throw new OfflineEvidenceError("RUN_ID_MISMATCH", "offline evidence cannot cross the active mission run");
  }
  if (isReservedEventType(input.eventType)) {
    throw new OfflineEvidenceError("RESERVED_EVENT_TYPE", "network and reconciliation records have dedicated constructors");
  }
  const appended = appendRecord(session, {
    ...input,
    evidenceLocality: "LOCAL",
  });
  return deepFreeze(appended);
}

/**
 * Captures immutable identities for the already-produced local artifacts and
 * records that capture before restoration can be accepted.
 */
export function capturePreRestorationArtifacts(
  session: OfflineEvidenceSession,
  input: CaptureInput,
): CaptureResult {
  if (session.networkState !== "LOST") {
    throw new OfflineEvidenceError("OFFLINE_WINDOW_NOT_ACTIVE", "artifacts must be captured while the physical link is LOST");
  }
  if (session.preRestorationCapture !== null) {
    throw new OfflineEvidenceError("ARTIFACTS_ALREADY_CAPTURED", "pre-restoration artifacts are append-only");
  }
  requireArtifactState(input);
  const finalReceiptDigest = digestCanonical(input.finalReceipt.value);
  const pebDigest = digestCanonical(input.portableEvidenceBundle.value);
  const appended = appendRecord(session, {
    missionId: session.missionId,
    runId: session.runId,
    eventId: "d006d.mission-completed-offline",
    eventType: "MISSION_COMPLETED_OFFLINE",
    receiptId: "NR-MISSION-COMPLETE-OFFLINE",
    missionClockPosition: input.missionClockPosition,
    evidenceLocality: "LOCAL",
    executionLocality: "LOCAL",
    payload: {
      final_receipt_ref: input.finalReceipt.ref,
      final_receipt_digest: finalReceiptDigest,
      peb_ref: input.portableEvidenceBundle.ref,
      peb_digest: pebDigest,
      local_verdict: input.verdict,
    },
  });
  const causalOrder = appended.session.records.map((record) => record.receiptId);
  const capture = deepFreeze({
    missionId: session.missionId,
    runId: session.runId,
    finalReceiptRef: input.finalReceipt.ref,
    finalReceiptDigest,
    pebRef: input.portableEvidenceBundle.ref,
    pebDigest,
    verdict: input.verdict,
    causalOrder,
    causalOrderDigest: digestCanonical(causalOrder),
    capturedAtMissionClockPosition: input.missionClockPosition,
    evidenceLocality: "LOCAL" as const,
  });
  return deepFreeze({
    capture,
    session: freezeSession({ ...appended.session, preRestorationCapture: capture }),
  });
}

/**
 * Reconciles only from explicit base-before/base-after operation evidence. It
 * never changes a local record or artifact. A receipt is emitted only after
 * the exact delta, digests, order, identity and captured artifacts all pass.
 *
 * One physical offline window (this run, this
 * NR-NET-LOST, this NR-NET-RESTORED) must produce exactly one Reconciliation
 * Receipt. The receipt's own identity used to be the fixed literal
 * "RR-OFFLINE-RECONCILIATION" / "d006d.reconciliation-complete" — the same
 * string on every call, for every mission, forever. Deriving it from the
 * cycle it closes means the SAME window is always the SAME receipt (so a
 * second call for it can be detected and answered from what already exists)
 * and a genuinely DIFFERENT window (a later flap, reconciled and
 * acknowledged, then lost and restored again) always gets its own new,
 * valid identity.
 */
function reconciliationEventIdFor(lostReceiptId: string, restoredReceiptId: string): string {
  return `d006d.reconciliation-complete:${lostReceiptId}->${restoredReceiptId}`;
}

function reconciliationReceiptIdFor(lostReceiptId: string, restoredReceiptId: string): string {
  return `RR-OFFLINE-RECONCILIATION:${lostReceiptId}->${restoredReceiptId}`;
}

function isReconciliationReceipt(record: OfflineCausalRecord): record is ReconciliationReceipt {
  return record.eventType === "RECONCILIATION_RECEIPT";
}

/**
 * Evidence-window state is derived from the latest lifecycle record, never
 * from connectivity. Restoration is the LOST -> CONNECTED event; it leaves
 * the evidence window awaiting reconciliation until a receipt is appended.
 */
export type OfflineWindowStatus = "NONE" | "OPEN" | "AWAITING_RECONCILIATION" | "RECONCILED";

export function offlineWindowStatus(session: OfflineEvidenceSession): OfflineWindowStatus {
  return assessJournal(session).status;
}

/** Evidence location-state is journal-derived and independent of the cable. */
export function evidenceState(session: OfflineEvidenceSession): EvidenceLocality {
  return offlineWindowStatus(session) === "RECONCILED" ? "RECONCILED" : "LOCAL";
}

export function reconcileOfflineEvidence(input: ReconciliationInput): ReconciliationResult {
  const session = input.session;
  const operation = validReconciliationOperation(input.operation) ? input.operation : null;
  const capture = input.capture ?? null;
  const currentArtifacts = input.currentArtifacts ?? null;
  const reasons = new Set<ReconciliationReasonCode>();

  if (capture !== null && capture.missionId !== session.missionId) {
    reasons.add("MISSION_ID_MISMATCH");
  }
  if (capture !== null && capture.runId !== session.runId) reasons.add("RUN_ID_MISMATCH");
  if (capture === null || currentArtifacts === null || session.preRestorationCapture === null) {
    reasons.add("ARTIFACT_STATE_INVALID");
  } else if (!safeCanonicalEqual(capture, session.preRestorationCapture)) {
    reasons.add("ARTIFACT_STATE_INVALID");
  }
  if (!isPreRestorationCaptureBoundToJournal(session)) reasons.add("ARTIFACT_STATE_INVALID");
  const localValidation = validateLocalRecords(session);
  for (const reason of localValidation) reasons.add(reason);
  if (operation === null || operation.kind !== "BASE_COMPARE_TRANSFER") {
    reasons.add("RECONCILIATION_EVIDENCE_MISSING");
  } else {
    if (operation.operationId.trim().length === 0) reasons.add("RECONCILIATION_EVIDENCE_MISSING");
    for (const base of [operation.baseBefore, operation.baseAfter]) {
      if (base.missionId !== session.missionId) reasons.add("MISSION_ID_MISMATCH");
      if (base.runId !== session.runId) reasons.add("RUN_ID_MISMATCH");
      for (const reason of validateBaseRecords(base)) reasons.add(reason);
    }
  }

  // The MOST RECENT cycle, not the first ever. A session can carry more than
  // one already-reconciled LOST->RESTORED window in its history (test 6's
  // "a different cycle gets its own receipt" requires exactly this); using
  // the first match here would validate window bounds, derive the receipt's
  // identity, and set offlineWindowStartRef/EndRef against a PRIOR, already-
  // closed cycle instead of the one actually being reconciled now. For the
  // ordinary single-cycle mission this is identical to findIndex.
  const lostIndex = session.records.findLastIndex((record) => record.eventType === "NETWORK_LINK_LOST");
  const restoredIndex = session.records.findLastIndex((record) => record.eventType === "NETWORK_LINK_RESTORED");

  // Idempotency, ahead of every other check. A second call for a cycle that
  // already produced its receipt must not re-validate, must not re-author,
  // and must not throw — it returns the existing result. This is the actual
  // fix for "event and receipt identities are exactly-once within a
  // mission": on real hardware the RJ45 reconnect can itself flap (brief
  // down/up while autonegotiation settles), which can re-arm a caller-side
  // "may I start reconciling" guard while the first attempt is still
  // in-flight; a same-origin fetch delay is enough of a window for a second
  // attempt to reach this function for the identical window. This check
  // holds regardless of how many times, from where, or how close together
  // it is called — it does not depend on React, on effect ordering, or on
  // any caller-side guard being correct.
  const targetRecords = restoredIndex >= 0 ? session.records.slice(0, restoredIndex + 1) : [];
  const localIds = targetRecords.map((record) => record.receiptId);
  const cycleReceiptId = lostIndex >= 0 && restoredIndex > lostIndex
    ? reconciliationReceiptIdFor(session.records[lostIndex]!.receiptId, session.records[restoredIndex]!.receiptId)
    : null;
  const existing = cycleReceiptId === null
    ? undefined
    : session.records.find(
      (record): record is ReconciliationReceipt => isReconciliationReceipt(record) && record.receiptId === cycleReceiptId,
    );
  // An in-mission receipt already closes this window. This entry never
  // re-describes it: its answer would carry artifact claims that receipt does
  // not make. Unreachable for a journal holding a completion capture.
  if (existing !== undefined && isInMissionReconciliationReceipt(existing)) {
    reasons.add("RECONCILIATION_OPERATION_CONFLICT");
  }

  if (lostIndex < 0 || restoredIndex <= lostIndex) reasons.add("OFFLINE_WINDOW_INVALID");
  if (session.networkState !== "CONNECTED" || restoredIndex < 0) reasons.add("MISSING_RESTORATION_RECEIPT");
  if (existing === undefined && offlineWindowStatus(session) !== "AWAITING_RECONCILIATION") {
    reasons.add("OFFLINE_WINDOW_INVALID");
  }

  if (capture !== null) {
    const capturedOrderIsPrefix = capture.causalOrder.length <= localIds.length
      && capture.causalOrder.every((id, index) => localIds[index] === id)
      && capture.causalOrderDigest === digestCanonical(capture.causalOrder);
    if (!capturedOrderIsPrefix) reasons.add("CAUSAL_ORDER_MISMATCH");
  }

  const localById = new Map(targetRecords.map((record) => [record.receiptId, record]));
  const baseBeforeIds = operation?.baseBefore.records.map((record) => record.receiptId) ?? [];
  const baseAfterIds = operation?.baseAfter.records.map((record) => record.receiptId) ?? [];
  const baseBeforeById = new Map(operation?.baseBefore.records.map((record) => [record.receiptId, record]) ?? []);
  const missingObjectIds = localIds.filter((id) => !baseBeforeById.has(id));
  const actualTransferredIds = baseAfterIds.filter((id) => !baseBeforeById.has(id));
  const baseBeforeDigest = operation === null ? "" : digestCanonical(freezeBase(operation.baseBefore));
  const baseAfterDigest = operation === null ? "" : digestCanonical(freezeBase(operation.baseAfter));

  if (operation !== null) {
    for (const baseRecord of [...operation.baseBefore.records, ...operation.baseAfter.records]) {
      const local = localById.get(baseRecord.receiptId);
      if (local === undefined) reasons.add("BASE_UNEXPECTED_OBJECT");
      else if (local.canonicalDigest !== baseRecord.canonicalDigest
        || !safeCanonicalEqual(local, baseRecord)) reasons.add("BASE_DIGEST_MISMATCH");
    }
    // A base may hold an exact causal prefix (including the empty prefix),
    // never an ordered subsequence that keeps a child but omits its parent.
    const expectedBeforeOrder = localIds.slice(0, baseBeforeIds.length);
    if (!sameStrings(baseBeforeIds, expectedBeforeOrder)) reasons.add("CAUSAL_ORDER_MISMATCH");
    if (!sameStrings(baseAfterIds, localIds)) {
      if (localIds.some((id) => !baseAfterIds.includes(id))) reasons.add("BASE_OBJECTS_MISSING");
      if (baseAfterIds.some((id) => !localById.has(id))) reasons.add("BASE_UNEXPECTED_OBJECT");
      reasons.add("CAUSAL_ORDER_MISMATCH");
    }
    if (new Set(operation.transferredReceiptIds).size !== operation.transferredReceiptIds.length
      || !sameStrings(operation.transferredReceiptIds, actualTransferredIds)
      || !sameStrings(actualTransferredIds, missingObjectIds)) {
      reasons.add("TRANSFER_ACCOUNTING_MISMATCH");
    }
  }

  let finalReceiptUnchanged = false;
  let pebUnchanged = false;
  let verdictUnchanged = false;
  try {
    if (capture === null || currentArtifacts === null) throw new TypeError("artifacts not captured");
    requireArtifactState(currentArtifacts);
    if (currentArtifacts.finalReceipt.ref !== capture.finalReceiptRef) reasons.add("FINAL_RECEIPT_REF_MISMATCH");
    if (currentArtifacts.portableEvidenceBundle.ref !== capture.pebRef) reasons.add("PEB_REF_MISMATCH");
    finalReceiptUnchanged = digestCanonical(currentArtifacts.finalReceipt.value) === capture.finalReceiptDigest;
    pebUnchanged = digestCanonical(currentArtifacts.portableEvidenceBundle.value) === capture.pebDigest;
    verdictUnchanged = currentArtifacts.verdict === capture.verdict;
    if (!finalReceiptUnchanged) reasons.add("FINAL_RECEIPT_CHANGED");
    if (!pebUnchanged) reasons.add("PEB_CHANGED");
    if (!verdictUnchanged) reasons.add("VERDICT_CHANGED");
  } catch {
    reasons.add("ARTIFACT_STATE_INVALID");
  }
  if (existing !== undefined && operation !== null && (
    existing.operationId !== operation.operationId
    || existing.baseBeforeDigest !== baseBeforeDigest
    || existing.baseAfterDigest !== baseAfterDigest
    || !sameStrings(existing.transferredObjectIds, operation.transferredReceiptIds)
  )) {
    reasons.add("RECONCILIATION_OPERATION_CONFLICT");
  }

  const causalOrderPreserved = !reasons.has("CAUSAL_ORDER_MISMATCH")
    && !reasons.has("LOCAL_DIGEST_MISMATCH")
    && !reasons.has("BASE_DIGEST_MISMATCH");
  const transferable = reasons.size === 0;
  if (!transferable) {
    return deepFreeze({
      status: "FAILED" as const,
      receipt: null,
      reasonCodes: [...reasons],
      session,
      reconciledBase: null,
      missingObjectIds,
      transferredObjectCount: 0,
      finalReceiptUnchanged,
      pebUnchanged,
      verdictUnchanged,
      causalOrderPreserved,
    });
  }

  // Transfer is counted from the validated before/after delta, never assumed.
  const verifiedOperation = operation!;
  if (existing !== undefined) {
    return deepFreeze({
      status: "COMPLETE" as const,
      receipt: existing,
      reasonCodes: [],
      session,
      reconciledBase: freezeBase(verifiedOperation.baseAfter),
      missingObjectIds,
      transferredObjectCount: existing.transferredObjectCount,
      finalReceiptUnchanged: existing.finalReceiptUnchanged,
      pebUnchanged: existing.pebUnchanged,
      verdictUnchanged: existing.verdictUnchanged,
      causalOrderPreserved: existing.causalOrderPreserved,
    });
  }

  const transferredObjectCount = actualTransferredIds.length;

  const verifiedCapture = capture!;
  const receiptClock = input.receiptMissionClockPosition ?? nextMissionClockPosition(session.records);
  const restored = session.records[restoredIndex]!;
  const lost = session.records[lostIndex]!;
  const receiptFields = {
    operationId: verifiedOperation.operationId,
    offlineWindowStartRef: lost.receiptId,
    offlineWindowEndRef: restored.receiptId,
    baseBeforeDigest,
    baseAfterDigest,
    transferredObjectIds: Object.freeze([...actualTransferredIds]),
    localObjectCount: targetRecords.length,
    baseMissingObjectCount: missingObjectIds.length,
    transferredObjectCount: transferredObjectCount,
    digestComparison: "MATCH" as const,
    causalOrderPreserved: true as const,
    finalReceiptRef: verifiedCapture.finalReceiptRef,
    finalReceiptUnchanged: true as const,
    pebRef: verifiedCapture.pebRef,
    pebDigest: verifiedCapture.pebDigest,
    pebUnchanged: true as const,
    localVerdict: verifiedCapture.verdict,
    verdictUnchanged: true as const,
    reconciliationResult: "BASE_COMPARE_TRANSFER_COMPLETE",
  };
  const appended = appendRecord(session, {
    missionId: session.missionId,
    runId: session.runId,
    eventId: reconciliationEventIdFor(lost.receiptId, restored.receiptId),
    eventType: "RECONCILIATION_RECEIPT",
    receiptId: reconciliationReceiptIdFor(lost.receiptId, restored.receiptId),
    missionClockPosition: receiptClock,
    evidenceLocality: "RECONCILED",
    executionLocality: "LOCAL",
    payload: {
      operation_id: receiptFields.operationId,
      offline_window_start_ref: receiptFields.offlineWindowStartRef,
      offline_window_end_ref: receiptFields.offlineWindowEndRef,
      base_before_digest: receiptFields.baseBeforeDigest,
      base_after_digest: receiptFields.baseAfterDigest,
      transferred_object_ids: receiptFields.transferredObjectIds,
      local_object_count: receiptFields.localObjectCount,
      base_missing_object_count: receiptFields.baseMissingObjectCount,
      transferred_object_count: receiptFields.transferredObjectCount,
      digest_comparison: receiptFields.digestComparison,
      causal_order_preserved: receiptFields.causalOrderPreserved,
      final_receipt_ref: receiptFields.finalReceiptRef,
      final_receipt_unchanged: receiptFields.finalReceiptUnchanged,
      peb_ref: receiptFields.pebRef,
      peb_digest: receiptFields.pebDigest,
      peb_unchanged: receiptFields.pebUnchanged,
      local_verdict: receiptFields.localVerdict,
      verdict_unchanged: receiptFields.verdictUnchanged,
      reconciliation_result: receiptFields.reconciliationResult,
    },
  });
  const receipt = deepFreeze({ ...appended.record, ...receiptFields }) as ReconciliationReceipt;
  const reconciledSession = freezeSession({
    ...appended.session,
    records: [...appended.session.records.slice(0, -1), receipt],
  });
  const reconciledBase = freezeBase(verifiedOperation.baseAfter);
  return deepFreeze({
    status: "COMPLETE" as const,
    receipt,
    reasonCodes: [],
    session: reconciledSession,
    reconciledBase,
    missingObjectIds,
    transferredObjectCount,
    finalReceiptUnchanged: true,
    pebUnchanged: true,
    verdictUnchanged: true,
    causalOrderPreserved: true,
  });
}

/**
 * In-mission reconciliation (D-006, 2026-10-08). The link came back BEFORE
 * the Final Receipt, so the evidence authored while LOST is reconciled now,
 * without waiting for a verdict.
 *
 * The discipline is `reconcileOfflineEvidence`'s — a receipt only after the
 * exact delta, digests, causal order and identities all pass — minus the
 * artifact capture, which cannot exist before the seal. Its checkpoint is the
 * journal prefix the restoration closes (`InMissionReconciliationReceipt`).
 *
 * RESTORED is a precondition, never the proof. A window whose base is not a
 * causal prefix, whose records fail their digests, whose base already claims
 * what was authored offline, or whose operation is incomplete stays LOCAL:
 * connectivity recovery is not evidence recovery.
 *
 * Idempotent: a window that already holds its in-mission receipt is answered
 * from it — before the seal check, so a later call still finds it — when the
 * presented operation is the one the receipt records.
 *
 * Total: any exception is a FAILED result, never a throw.
 */
export function reconcileInMissionOfflineEvidence(input: InMissionReconciliationInput): ReconciliationResult {
  try {
    return reconcileInMission(input);
  } catch {
    return refusedReconciliation(input.session, ["DIGEST_COMPUTATION_FAILED"]);
  }
}

function reconcileInMission(input: InMissionReconciliationInput): ReconciliationResult {
  const session = input.session;
  const records = session.records;
  const operation = validReconciliationOperation(input.operation) ? input.operation : null;
  const reasons = new Set<ReconciliationReasonCode>();

  // The journal the checkpoint is read from must be whole.
  const localValidation = validateLocalRecords(session);
  for (const reason of localValidation) reasons.add(reason);
  if (localValidation.length === 0 && !isOfflineEvidenceSessionJournalValid(session)) {
    reasons.add("OFFLINE_WINDOW_INVALID");
  }

  const lostIndex = records.findLastIndex((record) => record.eventType === "NETWORK_LINK_LOST");
  const restoredIndex = records.findLastIndex((record) => record.eventType === "NETWORK_LINK_RESTORED");
  const lost = lostIndex >= 0 && restoredIndex > lostIndex ? records[lostIndex]! : null;
  const restored = lost !== null ? records[restoredIndex]! : null;
  if (lost === null) reasons.add("OFFLINE_WINDOW_INVALID");
  if (session.networkState !== "CONNECTED" || restoredIndex < 0) reasons.add("MISSING_RESTORATION_RECEIPT");

  const targetRecords = restoredIndex >= 0 ? records.slice(0, restoredIndex + 1) : [];
  const localIds = targetRecords.map((record) => record.receiptId);
  const baseBeforeById = new Map(operation?.baseBefore.records.map((record) => [record.receiptId, record]) ?? []);
  const missingObjectIds = localIds.filter((id) => !baseBeforeById.has(id));
  const baseBeforeDigest = operation === null ? "" : digestCanonical(freezeBase(operation.baseBefore));
  const baseAfterDigest = operation === null ? "" : digestCanonical(freezeBase(operation.baseAfter));

  const cycleReceiptId = lost !== null && restored !== null
    ? reconciliationReceiptIdFor(lost.receiptId, restored.receiptId)
    : null;
  const existing = cycleReceiptId === null
    ? undefined
    : records.find((record) => record.eventType === "RECONCILIATION_RECEIPT" && record.receiptId === cycleReceiptId);
  if (existing !== undefined) {
    if (!isInMissionReconciliationReceipt(existing)) {
      // A post-completion receipt closes this window; this entry never re-describes it.
      reasons.add("RECONCILIATION_OPERATION_CONFLICT");
      return refusedReconciliation(session, [...reasons], missingObjectIds);
    }
    if (operation === null) reasons.add("RECONCILIATION_EVIDENCE_MISSING");
    else if (existing.operationId !== operation.operationId
      || existing.baseBeforeDigest !== baseBeforeDigest
      || existing.baseAfterDigest !== baseAfterDigest
      || !sameStrings(existing.transferredObjectIds, operation.transferredReceiptIds)) {
      reasons.add("RECONCILIATION_OPERATION_CONFLICT");
    }
    if (reasons.size > 0 || operation === null) return refusedReconciliation(session, [...reasons], missingObjectIds);
    return deepFreeze({
      status: "COMPLETE" as const,
      receipt: existing,
      reasonCodes: [],
      session,
      reconciledBase: freezeBase(operation.baseAfter),
      missingObjectIds,
      transferredObjectCount: existing.transferredObjectCount,
      finalReceiptUnchanged: false,
      pebUnchanged: false,
      verdictUnchanged: false,
      causalOrderPreserved: true,
    });
  }

  // In-mission preconditions: before the seal, without a completion capture,
  // at a mission moment the Final Receipt can still cover.
  if (session.finalReceiptRuntimeSeal !== null) reasons.add("IN_MISSION_WINDOW_SEALED");
  if (session.preRestorationCapture !== null
    || records.some((record) => record.eventType === "MISSION_COMPLETED_OFFLINE")) {
    reasons.add("IN_MISSION_CAPTURE_PRESENT");
  }
  if (offlineWindowStatus(session) !== "AWAITING_RECONCILIATION") reasons.add("OFFLINE_WINDOW_INVALID");
  const restoredObserved = restored?.payload.observed_master_time_ms;
  const lastRecord = records.at(-1);
  // Never before the restoration it closes, nor before the record it follows
  // in the journal: the closure orders its members by this time.
  const observedMasterTimeMs = isFiniteNonNegative(restoredObserved)
    && isFiniteNonNegative(input.observedMasterTimeMs)
    && lastRecord !== undefined
    ? Math.max(Math.round(input.observedMasterTimeMs), restoredObserved, runtimeTimeOf(lastRecord))
    : Number.NaN;
  if (restored !== null && !(observedMasterTimeMs < REQUIRED_RUNTIME_EVIDENCE_CUTOFF_EXCLUSIVE_MS)) {
    reasons.add("IN_MISSION_TIME_EXHAUSTED");
  }

  // The operation: the same evidence the post-completion entry demands.
  if (operation === null || operation.kind !== "BASE_COMPARE_TRANSFER") {
    reasons.add("RECONCILIATION_EVIDENCE_MISSING");
  } else {
    if (lost !== null && restored !== null
      && operation.operationId !== reconciliationOperationIdFor(lost.receiptId, restored.receiptId)) {
      reasons.add("OFFLINE_WINDOW_INVALID");
    }
    for (const base of [operation.baseBefore, operation.baseAfter]) {
      if (base.missionId !== session.missionId) reasons.add("MISSION_ID_MISMATCH");
      if (base.runId !== session.runId) reasons.add("RUN_ID_MISMATCH");
      for (const reason of validateBaseRecords(base)) reasons.add(reason);
    }
    const localById = new Map(targetRecords.map((record) => [record.receiptId, record]));
    const baseBeforeIds = operation.baseBefore.records.map((record) => record.receiptId);
    const baseAfterIds = operation.baseAfter.records.map((record) => record.receiptId);
    const actualTransferredIds = baseAfterIds.filter((id) => !baseBeforeById.has(id));
    for (const baseRecord of [...operation.baseBefore.records, ...operation.baseAfter.records]) {
      const local = localById.get(baseRecord.receiptId);
      if (local === undefined) reasons.add("BASE_UNEXPECTED_OBJECT");
      else if (local.canonicalDigest !== baseRecord.canonicalDigest
        || !safeCanonicalEqual(local, baseRecord)) reasons.add("BASE_DIGEST_MISMATCH");
    }
    if (!sameStrings(baseBeforeIds, localIds.slice(0, baseBeforeIds.length))) reasons.add("CAUSAL_ORDER_MISMATCH");
    if (!sameStrings(baseAfterIds, localIds)) {
      if (localIds.some((id) => !baseAfterIds.includes(id))) reasons.add("BASE_OBJECTS_MISSING");
      if (baseAfterIds.some((id) => !localById.has(id))) reasons.add("BASE_UNEXPECTED_OBJECT");
      reasons.add("CAUSAL_ORDER_MISMATCH");
    }
    if (new Set(operation.transferredReceiptIds).size !== operation.transferredReceiptIds.length
      || !sameStrings(operation.transferredReceiptIds, actualTransferredIds)
      || !sameStrings(actualTransferredIds, missingObjectIds)) {
      reasons.add("TRANSFER_ACCOUNTING_MISMATCH");
    }
    // Nothing authored from the loss onward could reach the base before the
    // link returned: a base that already holds it is not this window's base.
    if (lostIndex >= 0 && baseBeforeIds.length > lostIndex) reasons.add("TRANSFER_ACCOUNTING_MISMATCH");
  }

  if (reasons.size > 0 || operation === null || lost === null || restored === null) {
    return refusedReconciliation(session, [...reasons], missingObjectIds);
  }

  const transferredObjectIds = Object.freeze(
    operation.baseAfter.records.map((record) => record.receiptId).filter((id) => !baseBeforeById.has(id)),
  );
  const receiptFields = {
    operationId: operation.operationId,
    offlineWindowStartRef: lost.receiptId,
    offlineWindowEndRef: restored.receiptId,
    baseBeforeDigest,
    baseAfterDigest,
    transferredObjectIds,
    localObjectCount: targetRecords.length,
    baseMissingObjectCount: missingObjectIds.length,
    transferredObjectCount: transferredObjectIds.length,
    digestComparison: "MATCH" as const,
    causalOrderPreserved: true as const,
    offlineObjectIds: Object.freeze(records.slice(lostIndex + 1, restoredIndex).map((record) => record.receiptId)),
    reconciliationResult: IN_MISSION_RECONCILIATION_RESULT,
  };
  const appended = appendRecord(session, {
    missionId: session.missionId,
    runId: session.runId,
    eventId: reconciliationEventIdFor(lost.receiptId, restored.receiptId),
    eventType: "RECONCILIATION_RECEIPT",
    receiptId: reconciliationReceiptIdFor(lost.receiptId, restored.receiptId),
    // Where it sits: the next append slot, exactly like a physical record —
    // never a mission time, which could pass over evidence not yet projected.
    missionClockPosition: nextMissionClockPosition(records),
    evidenceLocality: "RECONCILED",
    executionLocality: "LOCAL",
    payload: {
      operation_id: receiptFields.operationId,
      offline_window_start_ref: receiptFields.offlineWindowStartRef,
      offline_window_end_ref: receiptFields.offlineWindowEndRef,
      base_before_digest: receiptFields.baseBeforeDigest,
      base_after_digest: receiptFields.baseAfterDigest,
      transferred_object_ids: receiptFields.transferredObjectIds,
      local_object_count: receiptFields.localObjectCount,
      base_missing_object_count: receiptFields.baseMissingObjectCount,
      transferred_object_count: receiptFields.transferredObjectCount,
      digest_comparison: receiptFields.digestComparison,
      causal_order_preserved: receiptFields.causalOrderPreserved,
      offline_object_ids: receiptFields.offlineObjectIds,
      // When it happened: what the views display and the closure times it by.
      observed_master_time_ms: observedMasterTimeMs,
      reconciliation_result: receiptFields.reconciliationResult,
    },
  });
  const receipt = deepFreeze({ ...appended.record, ...receiptFields }) as InMissionReconciliationReceipt;
  const reconciledSession = freezeSession({
    ...appended.session,
    records: [...appended.session.records.slice(0, -1), receipt],
  });
  // The receipt must satisfy the very predicate the closure and the Verifier apply.
  if (!isOfflineEvidenceSessionJournalValid(reconciledSession)
    || !inMissionReconciliationBound(
      reconciledSession.records,
      reconciledSession.records.length - 1,
      session.missionId,
      session.runId,
      session.initialCausalPredecessor,
    )) {
    return refusedReconciliation(session, ["OFFLINE_WINDOW_INVALID"], missingObjectIds);
  }
  return deepFreeze({
    status: "COMPLETE" as const,
    receipt,
    reasonCodes: [],
    session: reconciledSession,
    reconciledBase: freezeBase(operation.baseAfter),
    missingObjectIds,
    transferredObjectCount: transferredObjectIds.length,
    finalReceiptUnchanged: false,
    pebUnchanged: false,
    verdictUnchanged: false,
    causalOrderPreserved: true,
  });
}

/** A FAILED reconciliation that appended nothing: the session is returned as given. */
export function refusedReconciliation(
  session: OfflineEvidenceSession,
  reasonCodes: readonly ReconciliationReasonCode[],
  missingObjectIds: readonly string[] = [],
): ReconciliationResult {
  const reasons = new Set(reasonCodes);
  return deepFreeze({
    status: "FAILED" as const,
    receipt: null,
    reasonCodes: [...reasons],
    session,
    reconciledBase: null,
    missingObjectIds: [...missingObjectIds],
    transferredObjectCount: 0,
    finalReceiptUnchanged: false,
    pebUnchanged: false,
    verdictUnchanged: false,
    causalOrderPreserved: !reasons.has("CAUSAL_ORDER_MISMATCH")
      && !reasons.has("LOCAL_DIGEST_MISMATCH")
      && !reasons.has("BASE_DIGEST_MISMATCH")
      && !reasons.has("DIGEST_COMPUTATION_FAILED"),
  });
}

/** The operation identity of one window's base compare/transfer (`baseEvidence.ts`). */
export function reconciliationOperationIdFor(lostReceiptId: string, restoredReceiptId: string): string {
  return `BCT:${lostReceiptId}:${restoredReceiptId}`;
}

/**
 * Discriminates the in-mission variant by its declared result. Validity is
 * `isSpecializedRecordProjectionValid`; binding is `inMissionReconciliationBound`.
 */
export function isInMissionReconciliationReceipt(record: unknown): record is InMissionReconciliationReceipt {
  if (record === null || typeof record !== "object") return false;
  const candidate = record as Partial<OfflineCausalRecord>;
  return candidate.eventType === "RECONCILIATION_RECEIPT"
    && candidate.payload !== null
    && typeof candidate.payload === "object"
    && candidate.payload.reconciliation_result === IN_MISSION_RECONCILIATION_RESULT;
}

/** The receipt, of either variant, that closes the latest LOST → RESTORED window; else null. */
export function latestWindowReconciliationReceipt(session: OfflineEvidenceSession): OfflineCausalRecord | null {
  const lostIndex = session.records.findLastIndex((record) => record.eventType === "NETWORK_LINK_LOST");
  const restoredIndex = session.records.findLastIndex((record) => record.eventType === "NETWORK_LINK_RESTORED");
  if (lostIndex < 0 || restoredIndex <= lostIndex) return null;
  const receiptId = reconciliationReceiptIdFor(
    session.records[lostIndex]!.receiptId,
    session.records[restoredIndex]!.receiptId,
  );
  return session.records.find((record) => record.eventType === "RECONCILIATION_RECEIPT"
    && record.receiptId === receiptId) ?? null;
}

/**
 * Whether the in-mission receipt at `receiptIndex` is consistent with the
 * records it names — what reconciling that window from those records
 * declares. Anyone holding them (the journal, the C1 closure, a Verifier
 * reading a PEB) reaches the same answer from the records alone, never from
 * the network having returned.
 *
 * Self-contained and total: it re-validates the whole prefix the receipt
 * stands on (identity, canonical digest, projection, predecessor chain,
 * strictly increasing clock, unique identities) and returns false — never
 * throws — on anything malformed.
 *
 * What it establishes: the receipt is consistent with the records it names,
 * and every object authored offline was transferred. What it cannot: that the
 * base is an independent witness. The base is a SAME_ORIGIN_DEMO ledger and
 * the receipt is the runtime's own declaration, checked here against the
 * journal it names.
 */
export function inMissionReconciliationBound(
  records: readonly OfflineCausalRecord[],
  receiptIndex: number,
  missionId: string,
  runId: string,
  initialCausalPredecessor: string | null = null,
): boolean {
  if (!Array.isArray(records)
    || !Number.isInteger(receiptIndex)
    || receiptIndex < 0
    || receiptIndex >= records.length) return false;
  return inMissionReconciliationBindings(
    records.slice(0, receiptIndex + 1),
    missionId,
    runId,
    initialCausalPredecessor,
  ).get(receiptIndex) === true;
}

/**
 * The binding of EVERY in-mission receipt in `records` — the same predicate
 * as `inMissionReconciliationBound`, at linear cost. Checked one by one, each
 * receipt re-validates and re-hashes its whole prefix, and a PEB carrying many
 * receipts turns that into quadratic work for a verifier reading untrusted
 * bytes. Here the records are validated once, and every receipt's base
 * digests come from one streamed canonical prefix.
 *
 * Every in-mission receipt index maps to true or false; nothing else is
 * listed. Total: anything malformed, or any exception, is false.
 */
export function inMissionReconciliationBindings(
  records: readonly OfflineCausalRecord[],
  missionId: string,
  runId: string,
  initialCausalPredecessor: string | null = null,
): ReadonlyMap<number, boolean> {
  const bindings = new Map<number, boolean>();
  if (!Array.isArray(records)) return bindings;
  const unboundFrom = (start: number) => {
    for (let index = start; index < records.length; index += 1) {
      if (isInMissionReconciliationReceipt(records[index]) && !bindings.has(index)) bindings.set(index, false);
    }
  };
  try {
    // Pass 1 — every record once, in journal order; each in-mission receipt's
    // statements against the records before it.
    const pending: PendingBinding[] = [];
    const receiptIds = new Set<string>();
    const eventIds = new Set<string>();
    let previous = initialCausalPredecessor;
    let clock = -Infinity;
    let lostIndex = -1;
    let restoredIndex = -1;
    let captured = false;
    for (let index = 0; index < records.length; index += 1) {
      const record = records[index]!;
      if (record === null || typeof record !== "object"
        || record.missionId !== missionId
        || record.runId !== runId
        || !isNonEmptyText(record.receiptId)
        || !isNonEmptyText(record.eventId)
        || receiptIds.has(record.receiptId)
        || eventIds.has(record.eventId)
        || !Array.isArray(record.causalPredecessors)
        || !sameStrings(record.causalPredecessors, previous === null ? [] : [previous])
        || typeof record.missionClockPosition !== "number"
        || !Number.isFinite(record.missionClockPosition)
        || record.missionClockPosition <= clock
        || safeRecordDigest(record) !== record.canonicalDigest
        || !isSpecializedRecordProjectionValid(record)) {
        // Every receipt from here on stands on an invalid prefix.
        unboundFrom(index);
        break;
      }
      receiptIds.add(record.receiptId);
      eventIds.add(record.eventId);
      previous = record.receiptId;
      clock = record.missionClockPosition;
      if (isInMissionReconciliationReceipt(record)) {
        const statements = inMissionReceiptStatements(records, index, lostIndex, restoredIndex, captured);
        if (statements === null) bindings.set(index, false);
        else pending.push(statements);
      }
      if (record.eventType === "NETWORK_LINK_LOST") lostIndex = index;
      else if (record.eventType === "NETWORK_LINK_RESTORED") restoredIndex = index;
      else if (record.eventType === "MISSION_COMPLETED_OFFLINE") captured = true;
    }
    // Pass 2 — what the base held before and after, for every receipt at once.
    const boundaries = new Set<number>();
    for (const entry of pending) {
      boundaries.add(entry.beforeLength);
      boundaries.add(entry.targetLength);
    }
    const digests = baseSnapshotDigests(records, missionId, runId, boundaries);
    for (const entry of pending) {
      bindings.set(entry.index, digests.get(entry.beforeLength) === entry.baseBeforeDigest
        && digests.get(entry.targetLength) === entry.baseAfterDigest);
    }
  } catch {
    for (const index of bindings.keys()) bindings.set(index, false);
    unboundFrom(0);
  }
  return bindings;
}

type PendingBinding = Readonly<{
  index: number;
  beforeLength: number;
  targetLength: number;
  baseBeforeDigest: string;
  baseAfterDigest: string;
}>;

/**
 * Everything a receipt states except the two base digests, checked against
 * the records before it. `lostIndex` / `restoredIndex` are the latest loss and
 * restoration before the receipt; `captured` says whether a completion capture
 * precedes it. Null when any statement fails.
 */
function inMissionReceiptStatements(
  records: readonly OfflineCausalRecord[],
  receiptIndex: number,
  lostIndex: number,
  restoredIndex: number,
  captured: boolean,
): PendingBinding | null {
  const receipt = records[receiptIndex];
  if (!isInMissionReconciliationReceipt(receipt) || !isSpecializedRecordProjectionValid(receipt)) return null;
  // It closes the latest window, and no completion capture precedes it:
  // nothing about it waited for a verdict.
  if (lostIndex < 0 || restoredIndex <= lostIndex || captured) return null;
  const lost = records[lostIndex]!;
  const restored = records[restoredIndex]!;
  const targetLength = restoredIndex + 1;
  const count = receipt.transferredObjectCount;
  if (!isNonNegativeInteger(count) || count > targetLength) return null;
  const beforeLength = targetLength - count;
  const restoredObserved = restored.payload.observed_master_time_ms;
  const observed = receipt.payload.observed_master_time_ms;
  const holds = receipt.eventId === reconciliationEventIdFor(lost.receiptId, restored.receiptId)
    && receipt.receiptId === reconciliationReceiptIdFor(lost.receiptId, restored.receiptId)
    && receipt.offlineWindowStartRef === lost.receiptId
    && receipt.offlineWindowEndRef === restored.receiptId
    && receipt.operationId === reconciliationOperationIdFor(lost.receiptId, restored.receiptId)
    && receipt.localObjectCount === targetLength
    && receipt.baseMissingObjectCount === count
    && receipt.transferredObjectIds.length === count
    // The base held nothing from the loss onward: every offline object moved.
    && beforeLength <= lostIndex
    && isFiniteNonNegative(restoredObserved)
    && isFiniteNonNegative(observed)
    // Never before the restoration it closes, nor before the record it follows.
    && observed >= restoredObserved
    && observed >= runtimeTimeOf(records[receiptIndex - 1]!)
    && observed < REQUIRED_RUNTIME_EVIDENCE_CUTOFF_EXCLUSIVE_MS
    && receiptIdsMatch(receipt.transferredObjectIds, records, beforeLength, targetLength)
    && receiptIdsMatch(receipt.offlineObjectIds, records, lostIndex + 1, restoredIndex);
  return holds
    ? Object.freeze({ index: receiptIndex, beforeLength, targetLength, baseBeforeDigest: receipt.baseBeforeDigest, baseAfterDigest: receipt.baseAfterDigest })
    : null;
}

function receiptIdsMatch(ids: readonly string[], records: readonly OfflineCausalRecord[], from: number, to: number): boolean {
  if (ids.length !== to - from) return false;
  for (let offset = 0; offset < ids.length; offset += 1) {
    if (ids[offset] !== records[from + offset]!.receiptId) return false;
  }
  return true;
}

/**
 * digestCanonical({ missionId, runId, records: records.slice(0, length) }) for
 * every requested length, streamed once: the canonical form of that object is
 * `{"missionId":…,"records":[r0,r1,…],"runId":…}` (keys sorted), so one hasher
 * grows record by record and is cloned and closed at each length.
 */
function baseSnapshotDigests(
  records: readonly OfflineCausalRecord[],
  missionId: string,
  runId: string,
  lengths: ReadonlySet<number>,
): ReadonlyMap<number, string> {
  const digests = new Map<number, string>();
  let last = -1;
  for (const length of lengths) if (length > last) last = length;
  if (last < 0) return digests;
  const hasher = blake3.create();
  hasher.update(utf8ToBytes(`{"missionId":${canonicalString(missionId)},"records":[`));
  const tail = utf8ToBytes(`],"runId":${canonicalString(runId)}}`);
  const close = () => bytesToHex(hasher.clone().update(tail).digest());
  if (lengths.has(0)) digests.set(0, close());
  for (let index = 0; index < last; index += 1) {
    hasher.update(utf8ToBytes(`${index === 0 ? "" : ","}${canonicalString(records[index])}`));
    if (lengths.has(index + 1)) digests.set(index + 1, close());
  }
  return digests;
}

/** When a record happened on the mission clock: its observation time, else its journal slot (as C1 reads it). */
function runtimeTimeOf(record: OfflineCausalRecord): number {
  const observed = record.payload?.observed_master_time_ms;
  return typeof observed === "number" && Number.isFinite(observed) ? observed : record.missionClockPosition;
}

/**
 * Evidence locality of the journal AS A WHOLE, for a surface that says
 * whether the run's evidence is uploaded. `evidenceState` answers for the
 * latest offline window; in-mission, the mission goes on after its receipt
 * and authors new LOCAL evidence the base has never received. RECONCILED
 * here means the latest window is reconciled AND every record after the
 * prefix its receipt covers is itself a reconciliation receipt.
 */
export function journalEvidenceLocality(session: OfflineEvidenceSession): EvidenceLocality {
  if (offlineWindowStatus(session) !== "RECONCILED") return "LOCAL";
  const receiptIndex = session.records.findLastIndex((record) => record.eventType === "RECONCILIATION_RECEIPT");
  const covered = session.records[receiptIndex]?.payload.local_object_count;
  if (!isNonNegativeInteger(covered)) return "LOCAL";
  return session.records.every((record, index) => index < covered || record.eventType === "RECONCILIATION_RECEIPT")
    ? "RECONCILED"
    : "LOCAL";
}

export function canonicalRecordDigest(record: OfflineCausalRecord): string {
  return digestCanonical({
    missionId: record.missionId,
    runId: record.runId,
    eventId: record.eventId,
    eventType: record.eventType,
    receiptId: record.receiptId,
    missionClockPosition: record.missionClockPosition,
    causalPredecessors: record.causalPredecessors,
    evidenceLocality: record.evidenceLocality,
    executionLocality: record.executionLocality,
    payload: record.payload,
  });
}

/**
 * Subtype fields are redundant projections for consumers. The payload is the
 * canonically digested authority, so every projection must match it exactly
 * before persistence, replay, or reconciliation may trust it.
 */
export function isSpecializedRecordProjectionValid(record: OfflineCausalRecord): boolean {
  try {
    if (record.eventType === "NETWORK_LINK_LOST" || record.eventType === "NETWORK_LINK_RESTORED") {
      const receipt = record as Partial<NetworkNanoReceipt>;
      const expectedType = record.eventType === "NETWORK_LINK_LOST" ? "NR-NET-LOST" : "NR-NET-RESTORED";
      return hasExactKeys(record, NETWORK_RECORD_KEYS)
        && hasExactKeys(record.payload, NETWORK_PAYLOAD_KEYS)
        && receipt.nanoReceiptType === expectedType
        && receipt.adapterIdentity === record.payload.adapter_identity
        && receipt.previousNetworkState === record.payload.previous_network_state
        && receipt.newNetworkState === record.payload.new_network_state
        && receipt.observationSource === record.payload.observation_source
        && receipt.observationId === record.payload.observation_id
        && isNonEmptyText(receipt.observationId)
        && isFiniteNonNegative(record.payload.observed_master_time_ms);
    }
    if (record.eventType === "MISSION_COMPLETED_OFFLINE") {
      return hasExactKeys(record, BASE_RECORD_KEYS)
        && hasExactKeys(record.payload, COMPLETION_PAYLOAD_KEYS)
        && record.eventId === "d006d.mission-completed-offline"
        && record.receiptId === "NR-MISSION-COMPLETE-OFFLINE"
        && record.evidenceLocality === "LOCAL"
        && record.executionLocality === "LOCAL"
        && isNonEmptyText(record.payload.final_receipt_ref)
        && isCanonicalDigest(record.payload.final_receipt_digest)
        && isNonEmptyText(record.payload.peb_ref)
        && isCanonicalDigest(record.payload.peb_digest)
        && isCanonicalVerdict(record.payload.local_verdict);
    }
    if (record.eventType !== "RECONCILIATION_RECEIPT") {
      return hasExactKeys(record, BASE_RECORD_KEYS);
    }
    if (record.payload?.reconciliation_result === IN_MISSION_RECONCILIATION_RESULT) {
      const inMission = record as Partial<InMissionReconciliationReceipt>;
      return hasExactKeys(record, IN_MISSION_RECONCILIATION_RECORD_KEYS)
        && hasExactKeys(record.payload, IN_MISSION_RECONCILIATION_PAYLOAD_KEYS)
        && inMission.operationId === record.payload.operation_id
        && inMission.offlineWindowStartRef === record.payload.offline_window_start_ref
        && inMission.offlineWindowEndRef === record.payload.offline_window_end_ref
        && inMission.baseBeforeDigest === record.payload.base_before_digest
        && inMission.baseAfterDigest === record.payload.base_after_digest
        && safeCanonicalEqual(inMission.transferredObjectIds, record.payload.transferred_object_ids)
        && inMission.localObjectCount === record.payload.local_object_count
        && inMission.baseMissingObjectCount === record.payload.base_missing_object_count
        && inMission.transferredObjectCount === record.payload.transferred_object_count
        && inMission.digestComparison === record.payload.digest_comparison
        && inMission.causalOrderPreserved === record.payload.causal_order_preserved
        && safeCanonicalEqual(inMission.offlineObjectIds, record.payload.offline_object_ids)
        && inMission.reconciliationResult === record.payload.reconciliation_result
        && record.evidenceLocality === "RECONCILED"
        && record.executionLocality === "LOCAL"
        && isNonEmptyText(inMission.operationId)
        && isNonEmptyText(inMission.offlineWindowStartRef)
        && isNonEmptyText(inMission.offlineWindowEndRef)
        && isCanonicalDigest(inMission.baseBeforeDigest)
        && isCanonicalDigest(inMission.baseAfterDigest)
        && isUniqueTextList(inMission.transferredObjectIds)
        && isNonNegativeInteger(inMission.localObjectCount)
        && isNonNegativeInteger(inMission.baseMissingObjectCount)
        && isNonNegativeInteger(inMission.transferredObjectCount)
        && inMission.digestComparison === "MATCH"
        && inMission.causalOrderPreserved === true
        && isUniqueTextList(inMission.offlineObjectIds)
        && isFiniteNonNegative(record.payload.observed_master_time_ms);
    }
    const receipt = record as Partial<ReconciliationReceipt>;
    return hasExactKeys(record, RECONCILIATION_RECORD_KEYS)
      && hasExactKeys(record.payload, RECONCILIATION_PAYLOAD_KEYS)
      && receipt.operationId === record.payload.operation_id
      && receipt.offlineWindowStartRef === record.payload.offline_window_start_ref
      && receipt.offlineWindowEndRef === record.payload.offline_window_end_ref
      && receipt.baseBeforeDigest === record.payload.base_before_digest
      && receipt.baseAfterDigest === record.payload.base_after_digest
      && safeCanonicalEqual(receipt.transferredObjectIds, record.payload.transferred_object_ids)
      && receipt.localObjectCount === record.payload.local_object_count
      && receipt.baseMissingObjectCount === record.payload.base_missing_object_count
      && receipt.transferredObjectCount === record.payload.transferred_object_count
      && receipt.digestComparison === record.payload.digest_comparison
      && receipt.causalOrderPreserved === record.payload.causal_order_preserved
      && receipt.finalReceiptRef === record.payload.final_receipt_ref
      && receipt.finalReceiptUnchanged === record.payload.final_receipt_unchanged
      && receipt.pebRef === record.payload.peb_ref
      && receipt.pebDigest === record.payload.peb_digest
      && receipt.pebUnchanged === record.payload.peb_unchanged
      && receipt.localVerdict === record.payload.local_verdict
      && receipt.verdictUnchanged === record.payload.verdict_unchanged
      && receipt.reconciliationResult === record.payload.reconciliation_result
      && record.evidenceLocality === "RECONCILED"
      && record.executionLocality === "LOCAL"
      && isNonEmptyText(receipt.operationId)
      && isNonEmptyText(receipt.offlineWindowStartRef)
      && isNonEmptyText(receipt.offlineWindowEndRef)
      && isCanonicalDigest(receipt.baseBeforeDigest)
      && isCanonicalDigest(receipt.baseAfterDigest)
      && Array.isArray(receipt.transferredObjectIds)
      && receipt.transferredObjectIds.every(isNonEmptyText)
      && new Set(receipt.transferredObjectIds).size === receipt.transferredObjectIds.length
      && isNonNegativeInteger(receipt.localObjectCount)
      && isNonNegativeInteger(receipt.baseMissingObjectCount)
      && isNonNegativeInteger(receipt.transferredObjectCount)
      && receipt.digestComparison === "MATCH"
      && receipt.causalOrderPreserved === true
      && isNonEmptyText(receipt.finalReceiptRef)
      && receipt.finalReceiptUnchanged === true
      && isNonEmptyText(receipt.pebRef)
      && isCanonicalDigest(receipt.pebDigest)
      && receipt.pebUnchanged === true
      && isCanonicalVerdict(receipt.localVerdict)
      && receipt.verdictUnchanged === true
      && receipt.reconciliationResult === "BASE_COMPARE_TRANSFER_COMPLETE";
  } catch {
    return false;
  }
}

/** Derive the only persistable link state from the validated transition journal. */
export function journalNetworkState(session: OfflineEvidenceSession): StableNetworkState | null {
  let state: StableNetworkState = "CONNECTED";
  const observationIds = new Set<string>();
  for (const record of session.records) {
    if (record.eventType !== "NETWORK_LINK_LOST" && record.eventType !== "NETWORK_LINK_RESTORED") continue;
    if (!isSpecializedRecordProjectionValid(record)) return null;
    const receipt = record as NetworkNanoReceipt;
    if (!isSupportedPhysicalAdapterIdentity(receipt.adapterIdentity)
      || !isSupportedPhysicalAdapterSource(receipt.adapterIdentity, receipt.observationSource)
      || receipt.observationId.trim().length === 0
      || observationIds.has(receipt.observationId)
      || record.evidenceLocality !== "LOCAL"
      || record.executionLocality !== "LOCAL") return null;
    observationIds.add(receipt.observationId);
    const expectedPrevious = record.eventType === "NETWORK_LINK_LOST" ? "CONNECTED" : "LOST";
    const expectedNext = record.eventType === "NETWORK_LINK_LOST" ? "LOST" : "CONNECTED";
    if (state !== expectedPrevious
      || receipt.previousNetworkState !== expectedPrevious
      || receipt.newNetworkState !== expectedNext) return null;
    state = expectedNext;
  }
  return state;
}

/**
 * The capture sidecar is only an index over the immutable completion record.
 * It cannot introduce different artifact identities, digests, verdict, time,
 * locality, or causal order than the record committed to the journal.
 */
export function isPreRestorationCaptureBoundToJournal(session: OfflineEvidenceSession): boolean {
  const capture = session.preRestorationCapture;
  try {
    const matches = session.records
      .map((record, index) => ({ record, index }))
      .filter(({ record }) => record.eventType === "MISSION_COMPLETED_OFFLINE");
    if (capture === null) return matches.length === 0;
    if (matches.length !== 1
      || !hasExactKeys(capture, CAPTURE_KEYS)
      || !isNonEmptyText(capture.missionId)
      || !isNonEmptyText(capture.runId)
      || !isNonEmptyText(capture.finalReceiptRef)
      || !isCanonicalDigest(capture.finalReceiptDigest)
      || !isNonEmptyText(capture.pebRef)
      || !isCanonicalDigest(capture.pebDigest)
      || !isCanonicalVerdict(capture.verdict)
      || !Array.isArray(capture.causalOrder)
      || capture.causalOrder.some((receiptId) => !isNonEmptyText(receiptId))
      || !isCanonicalDigest(capture.causalOrderDigest)
      || !isFiniteNonNegative(capture.capturedAtMissionClockPosition)
      || capture.evidenceLocality !== "LOCAL") return false;
    const { record, index } = matches[0]!;
    const exactOrder = session.records.slice(0, index + 1).map((candidate) => candidate.receiptId);
    return capture.missionId === session.missionId
      && capture.runId === session.runId
      && isSpecializedRecordProjectionValid(record)
      && safeRecordDigest(record) === record.canonicalDigest
      && record.eventId === "d006d.mission-completed-offline"
      && record.receiptId === "NR-MISSION-COMPLETE-OFFLINE"
      && record.missionId === capture.missionId
      && record.runId === capture.runId
      && record.missionClockPosition === capture.capturedAtMissionClockPosition
      && record.evidenceLocality === "LOCAL"
      && record.executionLocality === "LOCAL"
      && capture.evidenceLocality === "LOCAL"
      && capture.finalReceiptRef === record.payload.final_receipt_ref
      && capture.finalReceiptDigest === record.payload.final_receipt_digest
      && capture.pebRef === record.payload.peb_ref
      && capture.pebDigest === record.payload.peb_digest
      && capture.verdict === record.payload.local_verdict
      && sameStrings(capture.causalOrder, exactOrder)
      && capture.causalOrderDigest === digestCanonical(exactOrder);
  } catch {
    return false;
  }
}

type OfflineLifecycleReplay = Readonly<{
  valid: boolean;
  status: OfflineWindowStatus;
}>;

const INVALID_LIFECYCLE_REPLAY: OfflineLifecycleReplay = Object.freeze({
  valid: false,
  status: "NONE",
});

/**
 * Replays only reserved lifecycle records, in journal order. Generic mission
 * evidence remains extensible, but it cannot create or close an offline
 * window. This is the persistence-time equivalent of the dedicated
 * constructors: re-digesting impossible lifecycle bytes does not make them
 * admissible.
 */
function replayOfflineLifecycle(session: OfflineEvidenceSession): OfflineLifecycleReplay {
  let linkState: StableNetworkState = "CONNECTED";
  let status: OfflineWindowStatus = "NONE";
  let latestLossIndex = -1;
  let latestRestorationIndex = -1;
  let captureIndex = -1;
  const closedPairs = new Set<string>();
  // Computed once, at the first in-mission receipt: every receipt's binding.
  let bindings: ReadonlyMap<number, boolean> | null = null;

  for (const [index, record] of session.records.entries()) {
    if (record.eventType === "NETWORK_LINK_LOST") {
      if (linkState !== "CONNECTED") return INVALID_LIFECYCLE_REPLAY;
      linkState = "LOST";
      latestLossIndex = index;
      latestRestorationIndex = -1;
      status = "OPEN";
      continue;
    }
    if (record.eventType === "NETWORK_LINK_RESTORED") {
      if (linkState !== "LOST" || latestLossIndex < 0) return INVALID_LIFECYCLE_REPLAY;
      linkState = "CONNECTED";
      latestRestorationIndex = index;
      status = "AWAITING_RECONCILIATION";
      continue;
    }
    if (record.eventType === "MISSION_COMPLETED_OFFLINE") {
      if (linkState !== "LOST" || latestLossIndex < 0 || captureIndex >= 0) {
        return INVALID_LIFECYCLE_REPLAY;
      }
      captureIndex = index;
      continue;
    }
    if (record.eventType !== "RECONCILIATION_RECEIPT") continue;

    if (isInMissionReconciliationReceipt(record)) {
      // In-mission: the window closes before any completion capture, inside
      // the Final Receipt seal, and only with a receipt its records bind.
      const seal = session.finalReceiptRuntimeSeal;
      if (linkState !== "CONNECTED"
        || status !== "AWAITING_RECONCILIATION"
        || latestLossIndex < 0
        || latestRestorationIndex <= latestLossIndex
        || captureIndex >= 0
        || (seal !== null && index >= seal.sealedRecordCount)) {
        return INVALID_LIFECYCLE_REPLAY;
      }
      const lost = session.records[latestLossIndex]!;
      const restored = session.records[latestRestorationIndex]!;
      const pair = `${lost.receiptId}->${restored.receiptId}`;
      if (bindings === null) {
        bindings = inMissionReconciliationBindings(session.records, session.missionId, session.runId, session.initialCausalPredecessor);
      }
      if (closedPairs.has(pair) || bindings.get(index) !== true) return INVALID_LIFECYCLE_REPLAY;
      closedPairs.add(pair);
      status = "RECONCILED";
      continue;
    }

    if (linkState !== "CONNECTED"
      || status !== "AWAITING_RECONCILIATION"
      || latestLossIndex < 0
      || latestRestorationIndex <= latestLossIndex
      || captureIndex < 0
      || captureIndex >= latestRestorationIndex) {
      return INVALID_LIFECYCLE_REPLAY;
    }
    const lost = session.records[latestLossIndex]!;
    const restored = session.records[latestRestorationIndex]!;
    const pair = `${lost.receiptId}->${restored.receiptId}`;
    if (closedPairs.has(pair)
      || !isReconciliationReceiptBoundToOperation(
        session,
        record as ReconciliationReceipt,
        lost,
        restored,
        latestRestorationIndex,
      )) {
      return INVALID_LIFECYCLE_REPLAY;
    }
    closedPairs.add(pair);
    status = "RECONCILED";
  }

  return Object.freeze({ valid: linkState === session.networkState, status });
}

function isReconciliationReceiptBoundToOperation(
  session: OfflineEvidenceSession,
  receipt: ReconciliationReceipt,
  lost: OfflineCausalRecord,
  restored: OfflineCausalRecord,
  restoredIndex: number,
): boolean {
  try {
    if (!isSpecializedRecordProjectionValid(receipt)) return false;
    const capture = session.preRestorationCapture;
    if (capture === null) return false;
    const targetRecords = session.records.slice(0, restoredIndex + 1);
    const targetIds = targetRecords.map((record) => record.receiptId);
    if (receipt.localObjectCount !== targetRecords.length
      || receipt.baseMissingObjectCount !== receipt.transferredObjectCount
      || receipt.transferredObjectCount !== receipt.transferredObjectIds.length
      || receipt.transferredObjectCount > targetRecords.length) return false;
    const beforeLength = targetRecords.length - receipt.transferredObjectCount;
    const expectedTransferredIds = targetIds.slice(beforeLength);
    const baseBefore = {
      missionId: session.missionId,
      runId: session.runId,
      records: targetRecords.slice(0, beforeLength),
    };
    const baseAfter = {
      missionId: session.missionId,
      runId: session.runId,
      records: targetRecords,
    };
    return receipt.eventId === reconciliationEventIdFor(lost.receiptId, restored.receiptId)
      && receipt.receiptId === reconciliationReceiptIdFor(lost.receiptId, restored.receiptId)
      && receipt.offlineWindowStartRef === lost.receiptId
      && receipt.offlineWindowEndRef === restored.receiptId
      && sameStrings(receipt.transferredObjectIds, expectedTransferredIds)
      && receipt.baseBeforeDigest === digestCanonical(baseBefore)
      && receipt.baseAfterDigest === digestCanonical(baseAfter)
      && receipt.finalReceiptRef === capture.finalReceiptRef
      && receipt.pebRef === capture.pebRef
      && receipt.pebDigest === capture.pebDigest
      && receipt.localVerdict === capture.verdict;
  } catch {
    return false;
  }
}

/** Complete fail-closed persistence predicate for one append-only run. */
export function isOfflineEvidenceSessionJournalValid(session: OfflineEvidenceSession): boolean {
  return assessJournal(session).valid;
}

type JournalAssessment = Readonly<{ valid: boolean; status: OfflineWindowStatus }>;

const INVALID_JOURNAL: JournalAssessment = Object.freeze({ valid: false, status: "NONE" });

/**
 * One assessment per immutable journal. The /nx surfaces ask for the window
 * status several times per animation frame, and since in-mission receipts
 * exist, each answer re-validates the journal and re-hashes the checkpoint
 * prefixes. A deep-frozen session can never change, so its assessment is kept
 * with it; any other object is assessed afresh every time.
 */
const JOURNAL_ASSESSMENTS = new WeakMap<object, JournalAssessment>();

function assessJournal(session: OfflineEvidenceSession): JournalAssessment {
  if (session === null || typeof session !== "object") return INVALID_JOURNAL;
  const cached = JOURNAL_ASSESSMENTS.get(session);
  if (cached !== undefined) return cached;
  const assessment = computeJournalAssessment(session);
  let immutable = false;
  try {
    immutable = isDeeplyFrozen(session);
  } catch {
    immutable = false;
  }
  if (immutable) JOURNAL_ASSESSMENTS.set(session, assessment);
  return assessment;
}

function computeJournalAssessment(session: OfflineEvidenceSession): JournalAssessment {
  try {
    if (!hasExactKeys(session, SESSION_KEYS)
      || session.version !== 2
      || session.missionId.trim().length === 0
      || session.runId.trim().length === 0
      || (session.initialCausalPredecessor !== null
        && session.initialCausalPredecessor.trim().length === 0)
      || (session.networkState !== "CONNECTED" && session.networkState !== "LOST")
      || !Array.isArray(session.records)) return INVALID_JOURNAL;
    for (const record of session.records) {
      if (record === null || typeof record !== "object"
        || record.eventId.trim().length === 0
        || record.eventType.trim().length === 0
        || record.receiptId.trim().length === 0
        || !Number.isFinite(record.missionClockPosition)
        || record.missionClockPosition < 0
        || !Array.isArray(record.causalPredecessors)
        || record.causalPredecessors.some((parent: unknown) => typeof parent !== "string" || parent.trim().length === 0)
        || (record.evidenceLocality !== "LOCAL" && record.evidenceLocality !== "RECONCILED")
        || (record.executionLocality !== "LOCAL" && record.executionLocality !== "REMOTE")
        || record.payload === null
        || Array.isArray(record.payload)
        || typeof record.payload !== "object") return INVALID_JOURNAL;
    }
    // The lifecycle is replayed once and shared by both checks that need it.
    const replay = replayOfflineLifecycle(session);
    const valid = isFinalReceiptRuntimeSealValid(session)
      && validateLocalRecords(session, replay).length === 0
      && isPreRestorationCaptureBoundToJournal(session)
      && replay.valid;
    return valid ? Object.freeze({ valid: true, status: replay.status }) : INVALID_JOURNAL;
  } catch {
    return INVALID_JOURNAL;
  }
}

function isDeeplyFrozen(value: unknown): boolean {
  if (value === null || typeof value !== "object") return true;
  if (!Object.isFrozen(value)) return false;
  return Object.values(value as Record<string, unknown>).every(isDeeplyFrozen);
}

function appendRecord(
  session: OfflineEvidenceSession,
  input: Omit<OfflineCausalRecord, "causalPredecessors" | "canonicalDigest">,
): OfflineEvidenceAppendResult {
  if (!isFinalReceiptRuntimeSealValid(session)) {
    throw new OfflineEvidenceError(
      "FINAL_RECEIPT_SEAL_INVALID",
      "new evidence cannot be appended through a mutated Final Receipt boundary",
    );
  }
  if (input.missionId !== session.missionId) {
    throw new OfflineEvidenceError("MISSION_ID_MISMATCH", "every causal record must retain the session Mission ID");
  }
  if (input.runId !== session.runId) {
    throw new OfflineEvidenceError("RUN_ID_MISMATCH", "every causal record must retain the session Run ID");
  }
  requireNonEmpty(input.eventId, "EVENT_ID_REQUIRED");
  requireNonEmpty(input.eventType, "EVENT_TYPE_REQUIRED");
  requireNonEmpty(input.receiptId, "RECEIPT_ID_REQUIRED");
  requireMissionClock(input.missionClockPosition, session.records);
  if (session.records.some((record) => record.eventId === input.eventId || record.receiptId === input.receiptId)) {
    throw new OfflineEvidenceError("DUPLICATE_CAUSAL_RECORD", "event and receipt identities are exactly-once within a mission");
  }
  const predecessor = session.records.at(-1)?.receiptId ?? session.initialCausalPredecessor;
  const unsigned = deepFreeze({
    ...input,
    payload: cloneJsonObject(input.payload),
    causalPredecessors: predecessor === null ? [] : [predecessor],
  });
  const record = deepFreeze({ ...unsigned, canonicalDigest: digestCanonical(unsigned) }) as OfflineCausalRecord;
  return deepFreeze({
    record,
    session: freezeSession({ ...session, records: [...session.records, record] }),
  });
}

function validateLocalRecords(
  session: OfflineEvidenceSession,
  replay: OfflineLifecycleReplay = replayOfflineLifecycle(session),
): ReconciliationReasonCode[] {
  const reasons: ReconciliationReasonCode[] = [];
  const ids = new Set<string>();
  const eventIds = new Set<string>();
  let previous = session.initialCausalPredecessor;
  let clock = -Infinity;
  for (const record of session.records) {
    if (record.missionId !== session.missionId) reasons.push("MISSION_ID_MISMATCH");
    if (record.runId !== session.runId) reasons.push("RUN_ID_MISMATCH");
    if (ids.has(record.receiptId) || eventIds.has(record.eventId)) reasons.push("DUPLICATE_OBJECT_ID");
    ids.add(record.receiptId);
    eventIds.add(record.eventId);
    const expected = previous === null ? [] : [previous];
    if (!sameStrings(record.causalPredecessors, expected) || record.missionClockPosition <= clock) {
      reasons.push("CAUSAL_ORDER_MISMATCH");
    }
    if (safeRecordDigest(record) !== record.canonicalDigest) reasons.push("LOCAL_DIGEST_MISMATCH");
    if (!isSpecializedRecordProjectionValid(record)) reasons.push("RECORD_PROJECTION_MISMATCH");
    previous = record.receiptId;
    clock = record.missionClockPosition;
  }
  const derivedNetworkState = journalNetworkState(session);
  if (derivedNetworkState === null || derivedNetworkState !== session.networkState) {
    reasons.push("NETWORK_STATE_MISMATCH");
  }
  if (!replay.valid) reasons.push("OFFLINE_WINDOW_INVALID");
  return reasons;
}

function validateBaseRecords(base: BaseEvidenceSnapshot): ReconciliationReasonCode[] {
  const reasons: ReconciliationReasonCode[] = [];
  const ids = new Set<string>();
  const eventIds = new Set<string>();
  let clock = -Infinity;
  for (const record of base.records) {
    if (record.missionId !== base.missionId) reasons.push("MISSION_ID_MISMATCH");
    if (record.runId !== base.runId) reasons.push("RUN_ID_MISMATCH");
    if (ids.has(record.receiptId) || eventIds.has(record.eventId)) reasons.push("DUPLICATE_OBJECT_ID");
    ids.add(record.receiptId);
    eventIds.add(record.eventId);
    if (record.missionClockPosition <= clock) reasons.push("CAUSAL_ORDER_MISMATCH");
    if (safeRecordDigest(record) !== record.canonicalDigest) reasons.push("BASE_DIGEST_MISMATCH");
    if (!isSpecializedRecordProjectionValid(record)) reasons.push("BASE_DIGEST_MISMATCH");
    clock = record.missionClockPosition;
  }
  return reasons;
}

function validReconciliationOperation(value: unknown): value is ReconciliationOperationEvidence {
  if (value === null || typeof value !== "object") return false;
  const operation = value as Partial<ReconciliationOperationEvidence>;
  if (operation.kind !== "BASE_COMPARE_TRANSFER"
    || typeof operation.operationId !== "string"
    || operation.operationId.trim().length === 0
    || !Array.isArray(operation.transferredReceiptIds)
    || !operation.transferredReceiptIds.every((id) => typeof id === "string" && id.trim().length > 0)) {
    return false;
  }
  return [operation.baseBefore, operation.baseAfter].every((candidate) => {
    if (candidate === null || typeof candidate !== "object") return false;
    const base = candidate as Partial<BaseEvidenceSnapshot>;
    return typeof base.missionId === "string"
      && typeof base.runId === "string"
      && Array.isArray(base.records)
      && base.records.every((record) => record !== null && typeof record === "object");
  });
}

function safeRecordDigest(record: OfflineCausalRecord): string | null {
  try {
    return canonicalRecordDigest(record);
  } catch {
    return null;
  }
}

function requireMissionClock(position: number, records: readonly OfflineCausalRecord[]): void {
  if (!Number.isFinite(position) || position < 0) {
    throw new OfflineEvidenceError("MISSION_CLOCK_INVALID", "mission clock positions must be finite non-negative numbers");
  }
  const previous = records.at(-1)?.missionClockPosition;
  if (previous !== undefined && position <= previous) {
    throw new OfflineEvidenceError("MISSION_CLOCK_NOT_MONOTONIC", "causal order cannot be inserted, renumbered or rewritten");
  }
}

function requireArtifactState(state: ArtifactState): void {
  requireNonEmpty(state.finalReceipt.ref, "FINAL_RECEIPT_REF_REQUIRED");
  requireNonEmpty(state.portableEvidenceBundle.ref, "PEB_REF_REQUIRED");
  if (!["VALID", "INVALID", "INDETERMINATE", "REVOKED"].includes(state.verdict)) {
    throw new OfflineEvidenceError("VERDICT_INVALID", "the local verifier verdict must use canonical FortiX semantics");
  }
  canonicalString(state.finalReceipt.value);
  canonicalString(state.portableEvidenceBundle.value);
}

function sameNetworkObservation(receipt: NetworkNanoReceipt, input: NetworkTransitionInput): boolean {
  return receipt.runId === input.runId
    && receipt.adapterIdentity === input.adapterIdentity
    && receipt.observationSource === input.observationSource
    && receipt.previousNetworkState === input.previousNetworkState
    && receipt.newNetworkState === input.newNetworkState
    && receipt.missionClockPosition === input.missionClockPosition;
}

function isNetworkNanoReceipt(record: OfflineCausalRecord): record is NetworkNanoReceipt {
  return record.eventType === "NETWORK_LINK_LOST" || record.eventType === "NETWORK_LINK_RESTORED";
}

function isReservedEventType(eventType: string): boolean {
  return eventType === "NETWORK_LINK_LOST"
    || eventType === "NETWORK_LINK_RESTORED"
    || eventType === "RECONCILIATION_RECEIPT"
    || eventType === "MISSION_COMPLETED_OFFLINE";
}

function isFinalReceiptRuntimeSealValid(session: OfflineEvidenceSession): boolean {
  const seal = session.finalReceiptRuntimeSeal;
  if (seal === null) return true;
  if (!hasExactKeys(seal, FINAL_RECEIPT_RUNTIME_SEAL_KEYS)
    || seal.profile !== "fortix.demo.d006.final-receipt-runtime-seal.v1"
    || seal.missionId !== session.missionId
    || seal.runId !== session.runId
    || !Number.isFinite(seal.sealedAtMasterTimeMs)
    || seal.sealedAtMasterTimeMs < 0
    || !Number.isInteger(seal.sealedRecordCount)
    || seal.sealedRecordCount < 0
    || seal.sealedRecordCount > session.records.length
    || !isCanonicalDigest(seal.journalPrefixDigest)) return false;
  const prefix = session.records.slice(0, seal.sealedRecordCount);
  const expectedTerminal = prefix.at(-1)?.canonicalDigest ?? null;
  return seal.terminalRecordDigest === expectedTerminal
    && seal.journalPrefixDigest === digestCanonical(prefix);
}

function nextMissionClockPosition(records: readonly OfflineCausalRecord[]): number {
  return (records.at(-1)?.missionClockPosition ?? -1) + 1;
}

function freezeSession(session: OfflineEvidenceSession): OfflineEvidenceSession {
  return deepFreeze({ ...session, records: [...session.records] });
}

function freezeBase(base: BaseEvidenceSnapshot): BaseEvidenceSnapshot {
  return deepFreeze({ ...base, records: [...base.records] });
}

function cloneJsonObject(value: Readonly<Record<string, JsonValue>>): Readonly<Record<string, JsonValue>> {
  return deepFreeze(JSON.parse(canonicalString(value)) as Record<string, JsonValue>);
}

function digestCanonical(value: unknown): string {
  return bytesToHex(blake3(utf8ToBytes(canonicalString(value))));
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function safeCanonicalEqual(left: unknown, right: unknown): boolean {
  try {
    return canonicalString(left) === canonicalString(right);
  } catch {
    return false;
  }
}

function hasExactKeys(value: unknown, expected: readonly string[]): boolean {
  if (value === null || Array.isArray(value) || typeof value !== "object") return false;
  const actual = Object.keys(value).sort();
  const canonicalExpected = [...expected].sort();
  return sameStrings(actual, canonicalExpected);
}

function isNonEmptyText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isCanonicalDigest(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function isCanonicalVerdict(value: unknown): value is CanonicalVerdict {
  return value === "VALID"
    || value === "INVALID"
    || value === "INDETERMINATE"
    || value === "REVOKED";
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isUniqueTextList(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every(isNonEmptyText) && new Set(value).size === value.length;
}

function requireNonEmpty(value: string, reasonCode: string): void {
  if (value.trim().length === 0) throw new OfflineEvidenceError(reasonCode, "canonical identities must not be empty");
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

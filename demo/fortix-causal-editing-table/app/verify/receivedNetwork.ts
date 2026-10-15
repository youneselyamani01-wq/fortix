import { inMissionReconciliationBindings, isInMissionReconciliationReceipt, type OfflineCausalRecord } from "../offlineEvidence.ts";
import type { CycleVerificationResult } from "../operationalCycle.ts";
import { transferredContentDigest } from "../portableMissionEvidence.ts";
import type { ReceivedEvidenceCatalog, ReceivedEvidenceCatalogEntry } from "./receivedEvidenceCatalog.ts";

/**
 * Network reading of a received PEB. Three dimensions stay separate and are
 * read only from declared fields:
 * - network state: NETWORK_LINK_LOST / NETWORK_LINK_RESTORED records and their
 *   previous/new states;
 * - execution locality: each runtime record's executionLocality;
 * - evidence locality: each runtime record's evidenceLocality.
 * Nothing here creates a causal relation. Facts inside an offline period are
 * temporal context only; RESTORED is never treated as a reconciliation.
 *
 * Reconciliation is read on its own (D-006, 2026-10-08). An in-mission
 * Reconciliation Receipt names one offline period. It is DECLARED when the
 * PEB's own records bind it exactly — the engine's predicate, recomputed here
 * from the received bytes — and ESTABLISHED only when the local analysis of
 * these exact bytes confirmed it too. Neither the network returning nor a
 * record declaring RECONCILED establishes it.
 */

export type NetworkTransitionKind = "LOST" | "RESTORED";
export type ExecutionLocalityValue = "LOCAL" | "REMOTE";
export type EvidenceLocalityValue = "LOCAL" | "RECONCILED";

/** The check the local analysis reports when every in-mission receipt of the PEB binds. */
export const IN_MISSION_RECONCILIATION_CHECK = "d006_in_mission_reconciliation_consistent";

export type ReceivedNetworkTransition = Readonly<{
  entry: ReceivedEvidenceCatalogEntry;
  kind: NetworkTransitionKind;
  timeMs: number | null;
  previousState: string | null;
  newState: string | null;
  adapter: string | null;
  observationSource: string | null;
  executionLocality: ExecutionLocalityValue | null;
  evidenceLocality: EvidenceLocalityValue | null;
}>;

/** What a bound receipt declares, for the technical disclosure. */
export type ReceivedReconciliationReceipt = Readonly<{
  receiptId: string;
  operationId: string | null;
  offlineObjectIds: readonly string[];
  transferredObjectIds: readonly string[];
  baseBeforeDigest: string | null;
  baseAfterDigest: string | null;
  digestComparison: string | null;
  observedMasterTimeMs: number | null;
}>;

export type ReconciliationStatus = Readonly<{
  /**
   * ESTABLISHED: a receipt bound to the PEB's own records, confirmed by the
   * analysis of these exact bytes. DECLARED: bound, not yet analysed.
   */
  status: "ESTABLISHED" | "DECLARED" | "NOT_ESTABLISHED";
  reason:
    | "RECEIPT_VERIFIED"
    | "NOT_ANALYZED"
    | "NO_RECONCILIATION_RECORD"
    | "NOT_NAMED_BY_RECEIPT"
    | "RECONCILIATION_UNBOUND"
    | "VERIFICATION_FAILED";
  records: readonly ReceivedEvidenceCatalogEntry[];
  /** The bound receipt naming this period; null otherwise, and on the global status. */
  receipt: ReceivedReconciliationReceipt | null;
}>;

export type LocalityCounts<T extends string> = Readonly<Record<T | "UNDECLARED", number>>;

export type OfflinePeriod = Readonly<{
  index: number;
  lost: ReceivedNetworkTransition;
  restored: ReceivedNetworkTransition | null;
  startMs: number | null;
  endMs: number | null;
  /** Exact only when the period is closed by a declared restoration. */
  durationMs: number | null;
  /** For an open period: from the loss to the last declared fact. */
  minimumDurationMs: number | null;
  /** Facts whose declared time falls inside the period: temporal context, not causal children. */
  entries: readonly ReceivedEvidenceCatalogEntry[];
  execution: LocalityCounts<ExecutionLocalityValue>;
  evidence: LocalityCounts<EvidenceLocalityValue>;
  reconciliation: ReconciliationStatus;
  /** Facts of the period the bound receipt names as authored offline; null without a bound receipt. */
  reconciledEntryCount: number | null;
}>;

export type LaneSegment = Readonly<{ value: string; fromMs: number; toMs: number }>;
export type LaneMarker = Readonly<{ kind: NetworkTransitionKind; timeMs: number; entry: ReceivedEvidenceCatalogEntry }>;

export type ReceivedNetworkModel = Readonly<{
  transitions: readonly ReceivedNetworkTransition[];
  periods: readonly OfflinePeriod[];
  /** State declared by the last transition, or null when no transition is declared. */
  finalState: string | null;
  missionStartMs: number | null;
  missionEndMs: number | null;
  lanes: Readonly<{
    network: readonly LaneSegment[];
    markers: readonly LaneMarker[];
    execution: readonly LaneSegment[];
    evidence: readonly LaneSegment[];
    executionCoverage: Readonly<{ declared: number; total: number }>;
    evidenceCoverage: Readonly<{ declared: number; total: number }>;
  }>;
  reconciliation: ReconciliationStatus;
  issues: readonly string[];
}>;

/** The local analysis the Verifier retained for these bytes, if any. */
export type ReceivedNetworkAnalysis = Readonly<{
  transferredContentDigest: string;
  result: CycleVerificationResult;
}>;

type Obj = Record<string, unknown>;
const object = (value: unknown): Obj | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Obj : null;
const text = (value: unknown): string | null => typeof value === "string" && value.trim() ? value : null;
const strings = (value: unknown): readonly string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

type RuntimeJournal = Readonly<{
  byId: ReadonlyMap<string, Obj | "AMBIGUOUS">;
  /** The received runtime records in their journal order. */
  list: readonly unknown[];
  indexById: ReadonlyMap<string, number>;
  missionId: string | null;
  runId: string | null;
}>;

function runtimeJournal(rawText: string | undefined): RuntimeJournal {
  const byId = new Map<string, Obj | "AMBIGUOUS">();
  const indexById = new Map<string, number>();
  const empty: RuntimeJournal = { byId, list: [], indexById, missionId: null, runId: null };
  if (!rawText) return empty;
  let root: Obj | null = null;
  try { root = object(JSON.parse(rawText)); } catch { return empty; }
  const list = root?.runtimeRecords;
  if (!Array.isArray(list)) return empty;
  list.forEach((candidate, index) => {
    const record = object(candidate); const id = text(record?.receiptId);
    if (!record || !id) return;
    byId.set(id, byId.has(id) ? "AMBIGUOUS" : record);
    if (!indexById.has(id)) indexById.set(id, index);
  });
  const identity = object(root?.identity);
  return { byId, list, indexById, missionId: text(identity?.missionId), runId: text(identity?.runId) };
}

/** Network kind from the received record's eventType; the declared eventId is a fallback only. */
export function receivedNetworkKind(eventType: unknown, eventId: string | null): NetworkTransitionKind | null {
  if (eventType === "NETWORK_LINK_LOST") return "LOST";
  if (eventType === "NETWORK_LINK_RESTORED") return "RESTORED";
  if (eventType !== undefined && eventType !== null) return null;
  if (!eventId) return null;
  const last = eventId.split(":").at(-1);
  if (eventId.startsWith("d006d.network-link-lost:") || last === "NETWORK_LINK_LOST") return "LOST";
  if (eventId.startsWith("d006d.network-link-restored:") || last === "NETWORK_LINK_RESTORED") return "RESTORED";
  return null;
}

const executionValue = (value: unknown): ExecutionLocalityValue | null => value === "LOCAL" || value === "REMOTE" ? value : null;
const evidenceValue = (value: unknown): EvidenceLocalityValue | null => value === "LOCAL" || value === "RECONCILED" ? value : null;
const isReconciliationRecord = (record: Obj | null): boolean => record?.eventType === "RECONCILIATION_RECEIPT";

function lane(points: readonly Readonly<{ timeMs: number; value: string }>[], endMs: number): readonly LaneSegment[] {
  const segments: { value: string; fromMs: number; toMs: number }[] = [];
  for (const point of points) {
    const last = segments.at(-1);
    if (last && last.value === point.value) continue;
    if (last) last.toMs = point.timeMs;
    segments.push({ value: point.value, fromMs: point.timeMs, toMs: endMs });
  }
  return Object.freeze(segments.map(segment => Object.freeze(segment)));
}

function count<T extends string>(values: readonly (T | null)[], keys: readonly T[]): LocalityCounts<T> {
  const counts = Object.fromEntries([...keys, "UNDECLARED"].map(key => [key, 0])) as Record<T | "UNDECLARED", number>;
  for (const value of values) counts[value ?? "UNDECLARED"] += 1;
  return Object.freeze(counts);
}

/**
 * Whether the retained analysis is of THESE bytes, and if so whether it
 * confirmed the in-mission reconciliation: null when there is no analysis of
 * these bytes, true when it confirmed, false when it did not.
 */
function analysisConfirmsReconciliation(analysis: ReceivedNetworkAnalysis | null | undefined, rawText: string | undefined): boolean | null {
  if (!analysis || !rawText) return null;
  let digest: string | null = null;
  try { digest = transferredContentDigest(rawText); } catch { digest = null; }
  if (digest === null || analysis.transferredContentDigest.toLowerCase() !== digest) return null;
  return analysis.result.verdict !== "INVALID" && analysis.result.verdict !== "REVOKED"
    && analysis.result.completedChecks.includes(IN_MISSION_RECONCILIATION_CHECK);
}

export function receivedNetworkModel(
  catalog: ReceivedEvidenceCatalog,
  rawText?: string,
  analysis?: ReceivedNetworkAnalysis | null,
): ReceivedNetworkModel {
  const journal = runtimeJournal(rawText);
  const issues: string[] = [];
  const recordFor = (entry: ReceivedEvidenceCatalogEntry): Obj | null => {
    if (entry.node.member?.source !== "RUNTIME_JOURNAL" || !entry.evidenceId) return null;
    const record = journal.byId.get(entry.evidenceId);
    if (record === "AMBIGUOUS") { issues.push(`${entry.evidenceId}: several runtime records`); return null; }
    return record ?? null;
  };
  const timed = catalog.entries
    .filter(entry => typeof entry.node.member?.timeMs === "number")
    .map(entry => ({ entry, timeMs: entry.node.member!.timeMs as number, record: recordFor(entry) }))
    .sort((left, right) => left.timeMs - right.timeMs || (left.entry.manifestPosition ?? 0) - (right.entry.manifestPosition ?? 0));
  const missionStartMs = timed.length ? timed[0]!.timeMs : null;
  const missionEndMs = timed.length ? timed.at(-1)!.timeMs : null;

  const byTime: ReceivedNetworkTransition[] = [];
  for (const { entry, timeMs, record } of timed) {
    const kind = receivedNetworkKind(record?.eventType, entry.eventId);
    if (!kind) continue;
    const payload = object(record?.payload);
    byTime.push(Object.freeze({
      entry, kind, timeMs,
      previousState: text(payload?.previous_network_state) ?? text(record?.previousNetworkState),
      newState: text(payload?.new_network_state) ?? text(record?.newNetworkState),
      adapter: text(payload?.adapter_identity) ?? text(record?.adapterIdentity),
      observationSource: text(payload?.observation_source) ?? text(record?.observationSource),
      executionLocality: executionValue(record?.executionLocality),
      evidenceLocality: evidenceValue(record?.evidenceLocality),
    }));
  }
  // Losses and returns pair in JOURNAL order when every transition has a
  // journal position: two flaps while the clock is paused share one declared
  // time, and time alone would pair them by identifier. Time stays the
  // display order of the lanes.
  const journalPosition = (transition: ReceivedNetworkTransition) => transition.entry.evidenceId ? journal.indexById.get(transition.entry.evidenceId) : undefined;
  const transitions = byTime.every(transition => journalPosition(transition) !== undefined)
    ? [...byTime].sort((left, right) => journalPosition(left)! - journalPosition(right)!)
    : byTime;

  // Reconciliation receipts, in journal order. A receipt is bound only when it
  // is the in-mission variant and the PEB's own records bind it — every
  // receipt's binding computed in one linear pass over the received journal.
  const entryByEvidenceId = new Map(catalog.entries.filter(entry => entry.evidenceId).map(entry => [entry.evidenceId!, entry]));
  const bindings = journal.missionId !== null && journal.runId !== null
    ? inMissionReconciliationBindings(journal.list as readonly OfflineCausalRecord[], journal.missionId, journal.runId)
    : new Map<number, boolean>();
  const receipts = journal.list.flatMap((candidate, index) => {
    const record = object(candidate);
    if (!isReconciliationRecord(record)) return [];
    const receiptId = text(record?.receiptId);
    const payload = object(record?.payload);
    const bound = receiptId !== null
      && journal.byId.get(receiptId) !== "AMBIGUOUS"
      && isInMissionReconciliationReceipt(record)
      && bindings.get(index) === true;
    const observed = payload?.observed_master_time_ms;
    return [Object.freeze({
      entry: receiptId === null ? null : entryByEvidenceId.get(receiptId) ?? null,
      startRef: text(payload?.offline_window_start_ref),
      endRef: text(payload?.offline_window_end_ref),
      bound,
      details: Object.freeze({
        receiptId: receiptId ?? "",
        operationId: text(payload?.operation_id),
        offlineObjectIds: Object.freeze([...strings(payload?.offline_object_ids)]),
        transferredObjectIds: Object.freeze([...strings(payload?.transferred_object_ids)]),
        baseBeforeDigest: text(payload?.base_before_digest),
        baseAfterDigest: text(payload?.base_after_digest),
        digestComparison: text(payload?.digest_comparison),
        observedMasterTimeMs: typeof observed === "number" && Number.isFinite(observed) ? observed : null,
      }),
    })];
  });
  const confirmed = analysisConfirmsReconciliation(analysis, rawText);
  const receiptEntries = receipts.flatMap(receipt => receipt.entry ? [receipt.entry] : []);

  const periodReconciliation = (lostId: string | null, restoredId: string | null): ReconciliationStatus => {
    const naming = restoredId === null ? [] : receipts.filter(receipt => receipt.startRef === lostId && receipt.endRef === restoredId);
    const records = Object.freeze(naming.flatMap(receipt => receipt.entry ? [receipt.entry] : []));
    const status = (value: ReconciliationStatus["status"], reason: ReconciliationStatus["reason"], receipt: ReceivedReconciliationReceipt | null = null): ReconciliationStatus =>
      Object.freeze({ status: value, reason, records, receipt });
    if (naming.length === 0) return status("NOT_ESTABLISHED", receipts.length ? "NOT_NAMED_BY_RECEIPT" : "NO_RECONCILIATION_RECORD");
    if (naming.length !== 1 || !naming[0]!.bound) return status("NOT_ESTABLISHED", "RECONCILIATION_UNBOUND");
    const receipt = naming[0]!.details;
    if (confirmed === true) return status("ESTABLISHED", "RECEIPT_VERIFIED", receipt);
    if (confirmed === false) return status("NOT_ESTABLISHED", "VERIFICATION_FAILED", receipt);
    return status("DECLARED", "NOT_ANALYZED", receipt);
  };

  const periods: OfflinePeriod[] = [];
  // No network transition is ever a fact of a period, its own or another one
  // that shares a declared time with it (two flaps while the clock is held).
  const transitionEntries = new Set(transitions.map(transition => transition.entry));
  transitions.forEach((transition, index) => {
    if (transition.kind !== "LOST") return;
    const restoredIndex = transitions.findIndex((candidate, position) => position > index && candidate.kind === "RESTORED");
    const nextLossIndex = transitions.findIndex((candidate, position) => position > index && candidate.kind === "LOST");
    const restored = restoredIndex < 0 ? null : transitions[restoredIndex]!;
    if (restored && nextLossIndex >= 0 && nextLossIndex < restoredIndex) issues.push(`${transition.entry.evidenceId}: second loss before restoration`);
    const startMs = transition.timeMs; const endMs = restored?.timeMs ?? null;
    // Reconciliation receipts are lifecycle records, not facts of the period.
    const inside = timed.filter(item => !transitionEntries.has(item.entry) && !isReconciliationRecord(item.record)
      && startMs !== null && item.timeMs >= startMs && (endMs === null || item.timeMs <= endMs));
    const reconciliation = periodReconciliation(transition.entry.evidenceId ?? null, restored?.entry.evidenceId ?? null);
    const offlineObjects = new Set(reconciliation.receipt?.offlineObjectIds ?? []);
    periods.push(Object.freeze({
      index: periods.length + 1, lost: transition, restored, startMs, endMs,
      durationMs: startMs !== null && endMs !== null ? endMs - startMs : null,
      minimumDurationMs: endMs === null && startMs !== null && missionEndMs !== null ? missionEndMs - startMs : null,
      entries: Object.freeze(inside.map(item => item.entry)),
      execution: count(inside.map(item => executionValue(item.record?.executionLocality)), ["LOCAL", "REMOTE"]),
      evidence: count(inside.map(item => evidenceValue(item.record?.evidenceLocality)), ["LOCAL", "RECONCILED"]),
      reconciliation,
      reconciledEntryCount: reconciliation.receipt ? inside.filter(item => item.entry.evidenceId !== null && offlineObjects.has(item.entry.evidenceId)).length : null,
    }));
  });
  for (const receipt of receipts) {
    if (!periods.some(period => period.reconciliation.records.includes(receipt.entry!))) {
      issues.push(`${receipt.details.receiptId || "reconciliation receipt"}: names no offline period of this PEB`);
    }
  }

  // The PEB reads reconciled only when EVERY offline period is, open ones included.
  const statuses = periods.map(period => period.reconciliation);
  const firstUnestablished = statuses.find(item => item.status === "NOT_ESTABLISHED");
  const reconciliation: ReconciliationStatus = Object.freeze({
    status: !statuses.length ? "NOT_ESTABLISHED" as const
      : statuses.every(item => item.status === "ESTABLISHED") ? "ESTABLISHED" as const
        : firstUnestablished ? "NOT_ESTABLISHED" as const : "DECLARED" as const,
    reason: !statuses.length ? (receipts.length ? "NOT_NAMED_BY_RECEIPT" as const : "NO_RECONCILIATION_RECORD" as const)
      : statuses.every(item => item.status === "ESTABLISHED") ? "RECEIPT_VERIFIED" as const
        : firstUnestablished?.reason ?? "NOT_ANALYZED" as const,
    records: Object.freeze(receiptEntries),
    receipt: null,
  });

  const end = missionEndMs ?? 0;
  const networkPoints = byTime.length && missionStartMs !== null
    ? [{ timeMs: missionStartMs, value: byTime[0]!.previousState ?? "UNDECLARED" },
      ...byTime.filter(item => item.timeMs !== null).map(item => ({ timeMs: item.timeMs!, value: item.newState ?? "UNDECLARED" }))]
    : [];
  // A reconciliation receipt's own RECONCILED is not a state of the facts around it.
  const laneItems = timed.filter(item => !isReconciliationRecord(item.record));
  const executionPoints = laneItems.flatMap(item => { const value = executionValue(item.record?.executionLocality); return value ? [{ timeMs: item.timeMs, value }] : []; });
  const evidencePoints = laneItems.flatMap(item => { const value = evidenceValue(item.record?.evidenceLocality); return value ? [{ timeMs: item.timeMs, value }] : []; });

  return Object.freeze({
    transitions: Object.freeze(transitions), periods: Object.freeze(periods),
    finalState: transitions.length ? transitions.at(-1)!.newState : null,
    missionStartMs, missionEndMs,
    lanes: Object.freeze({
      network: lane(networkPoints, end),
      markers: Object.freeze(byTime.filter(item => item.timeMs !== null).map(item => Object.freeze({ kind: item.kind, timeMs: item.timeMs!, entry: item.entry }))),
      execution: lane(executionPoints, end), evidence: lane(evidencePoints, end),
      executionCoverage: Object.freeze({ declared: executionPoints.length, total: laneItems.length }),
      evidenceCoverage: Object.freeze({ declared: evidencePoints.length, total: laneItems.length }),
    }),
    reconciliation, issues: Object.freeze(issues),
  });
}

/** "1 min 14,918 s" / "1 min 14.918 s" — exact milliseconds, no rounding. */
export function networkDuration(ms: number, locale: "en" | "fr"): string {
  const minutes = Math.floor(ms / 60_000);
  const seconds = (ms % 60_000) / 1_000;
  const secondsText = seconds.toFixed(3).replace(/\.?0+$/, "").replace(".", locale === "fr" ? "," : ".");
  return minutes ? `${minutes} min ${secondsText} s` : `${secondsText} s`;
}

export function networkTransitionOf(model: ReceivedNetworkModel, nodeKey: string | null | undefined): ReceivedNetworkTransition | null {
  return nodeKey ? model.transitions.find(item => item.entry.nodeKey === nodeKey) ?? null : null;
}

export function offlinePeriodOf(model: ReceivedNetworkModel, nodeKey: string | null | undefined): OfflinePeriod | null {
  if (!nodeKey) return null;
  // A transition belongs to the period it opens or closes, whatever its time:
  // identity first, so a restoration never reads another period's status.
  return model.periods.find(period => period.lost.entry.nodeKey === nodeKey || period.restored?.entry.nodeKey === nodeKey)
    ?? model.periods.find(period => period.entries.some(entry => entry.nodeKey === nodeKey)) ?? null;
}

/** The offline period a reconciliation receipt names, when the selected fact is one. */
export function reconciliationPeriodOf(model: ReceivedNetworkModel, nodeKey: string | null | undefined): OfflinePeriod | null {
  if (!nodeKey) return null;
  return model.periods.find(period => period.reconciliation.records.some(entry => entry.nodeKey === nodeKey)) ?? null;
}

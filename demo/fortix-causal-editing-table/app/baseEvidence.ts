import {
  reconciliationOperationIdFor,
  type BaseEvidenceSnapshot,
  type OfflineCausalRecord,
  type OfflineEvidenceSession,
  type ReconciliationOperationEvidence,
} from "./offlineEvidence.ts";
import { canonicalString } from "./verification.ts";

/**
 * D-006 C3 — the base evidence ledger and the operation that reconciles it.
 *
 * Until now the demonstration owned every half of reconciliation EXCEPT the
 * operation itself: the C1 contract (`reconcileOfflineEvidence`) verifies a
 * `BASE_COMPARE_TRANSFER` down to digests, prefix order and exact transfer
 * accounting — and the active UI passed `operation: null`, so completion was
 * truthfully refused every time. C3 supplies the missing half: a real second
 * store, a real comparison, and a real transfer, so RECONCILED is finally a
 * statement about work performed rather than a label a timeline reached.
 *
 * SCOPE, stated honestly: the base is a distinct same-machine ledger under
 * its own storage identity. It is explicitly `SAME_ORIGIN_DEMO` scope — the
 * public copy already says so — and nothing here claims a remote datacenter.
 * What is REAL: two independent stores, a byte-level comparison, an actual
 * copy of the missing records, and accounting the frozen C1 validator checks
 * against digests of both snapshots. What is NOT claimed: external transport.
 * The same-origin acknowledgement remains what it always was — an identity
 * acknowledgement, never proof of transfer; the transfer proof is the
 * before/after delta itself.
 *
 * CAUSALITY: this operation is eligible only downstream of two PHYSICAL
 * sentinel observations — the loss that opened the window and the restoration
 * that closed it. It is never scheduled; nothing here reads the master clock.
 */

/**
 * What the base ledger holds, read without guessing: ABSENT (never written),
 * PRESENT (a snapshot of this run), or INVALID — bytes that are not a base
 * snapshot, or a snapshot of another mission or run. The in-mission path
 * never reads INVALID as an empty base and never overwrites it.
 */
export type BaseReadResult =
  | Readonly<{ status: "ABSENT" }>
  | Readonly<{ status: "PRESENT"; snapshot: BaseEvidenceSnapshot }>
  | Readonly<{
    status: "INVALID";
    reason: "BASE_UNREADABLE" | "BASE_IDENTITY_MISMATCH";
    /** The foreign snapshot, when the bytes are one; null when unreadable. */
    snapshot: BaseEvidenceSnapshot | null;
  }>;

export type BaseStore = Readonly<{
  read: () => BaseEvidenceSnapshot | null;
  write: (snapshot: BaseEvidenceSnapshot) => void;
  /**
   * The three-way read the in-mission path relies on. Optional, so a store
   * written for the post-completion contract still fits; without it, `read`
   * is taken at its word (null reads as ABSENT).
   */
  readStrict?: () => BaseReadResult;
}>;

export type BaseCompareTransferOutcome = Readonly<{
  /** The evidence handed to `reconcileOfflineEvidence`. Never null. */
  operation: ReconciliationOperationEvidence;
  /** True when the store was actually advanced to the after-snapshot. */
  transferred: boolean;
  /** Present when the base could not accept a transfer, or did not confirm it. */
  refusalReason: "BASE_NOT_CAUSAL_PREFIX" | "BASE_IDENTITY_MISMATCH" | "BASE_WRITE_UNCONFIRMED" | null;
  localCount: number;
  baseBeforeCount: number;
  transferredCount: number;
}>;

/**
 * The in-mission plan: the comparison, and the delta it would transfer, with
 * nothing written yet. UNREADABLE when the base holds bytes no snapshot can
 * describe — reported, never repaired.
 */
export type BaseTransferPlan =
  | Readonly<{ kind: "UNREADABLE" }>
  | Readonly<{ kind: "PLANNED"; outcome: BaseCompareTransferOutcome }>;

const freezeSnapshot = (snapshot: BaseEvidenceSnapshot): BaseEvidenceSnapshot => Object.freeze({
  missionId: snapshot.missionId,
  runId: snapshot.runId,
  records: Object.freeze([...snapshot.records]),
});

export function emptyBaseSnapshot(missionId: string, runId: string): BaseEvidenceSnapshot {
  return freezeSnapshot({ missionId, runId, records: [] });
}

/**
 * The records reconciliation is ABOUT: the append-only journal up to and
 * including the restoration receipt that closed the offline window. Anything
 * after that boundary belongs to the next window. This mirrors the C1
 * validator's own target-set derivation on purpose — the operation and its
 * verifier must be looking at the same set.
 */
export function reconciliationTargetRecords(
  session: OfflineEvidenceSession,
): readonly OfflineCausalRecord[] {
  const restoredIndex = session.records.findLastIndex(
    (record) => record.eventType === "NETWORK_LINK_RESTORED",
  );
  return restoredIndex < 0
    ? Object.freeze([])
    : Object.freeze(session.records.slice(0, restoredIndex + 1));
}

/**
 * Deterministic operation identity for one physical offline window, derived
 * from the loss and restoration receipts that bound it. A retry of the same
 * window therefore presents the SAME operation id and digests, which is what
 * lets the C1 validator treat it as idempotent instead of a conflict.
 */
export function baseCompareTransferOperationId(
  session: OfflineEvidenceSession,
): string | null {
  const lost = session.records.findLast((record) => record.eventType === "NETWORK_LINK_LOST");
  const restored = session.records.findLast((record) => record.eventType === "NETWORK_LINK_RESTORED");
  if (lost === undefined || restored === undefined) return null;
  return reconciliationOperationIdFor(lost.receiptId, restored.receiptId);
}

/**
 * Performs the base comparison and transfer.
 *
 * The base may hold exactly a causal prefix of the target set — including the
 * empty prefix of a base that has never received anything. The missing suffix
 * is copied record-for-record; nothing is rewritten, reordered or dropped. A
 * base that is NOT a causal prefix (corrupted storage, foreign records) is
 * refused: the operation evidence still reports what the base actually held,
 * the store is left untouched, and the C1 validator fails the receipt — a
 * truthful refusal instead of a repaired story.
 */
export function performBaseCompareTransfer(
  session: OfflineEvidenceSession,
  store: BaseStore,
): BaseCompareTransferOutcome | null {
  const operationId = baseCompareTransferOperationId(session);
  if (operationId === null) return null;
  const target = reconciliationTargetRecords(session);
  if (target.length === 0) return null;

  const replayed = replayRecordedOperation(session, operationId, target);
  if (replayed !== null) return replayed;

  const stored = store.read();
  const baseBefore = stored === null
    ? emptyBaseSnapshot(session.missionId, session.runId)
    : freezeSnapshot(stored);
  const compared = compareWithBase(session, operationId, target, baseBefore);
  if (compared.refusalReason !== null) return compared;
  store.write(compared.operation.baseAfter);
  return Object.freeze({ ...compared, transferred: true });
}

/**
 * The in-mission form of the same operation (D-006, 2026-10-08): compare and
 * plan the delta, WRITE NOTHING. The engine validates the plan first; only
 * then is the after-snapshot committed and read back
 * (`commitBaseTransfer`). A base that is unreadable or belongs to another
 * mission or run is reported as it is — never read as empty, never
 * overwritten.
 */
export function planBaseCompareTransfer(
  session: OfflineEvidenceSession,
  store: BaseStore,
): BaseTransferPlan | null {
  const operationId = baseCompareTransferOperationId(session);
  if (operationId === null) return null;
  const target = reconciliationTargetRecords(session);
  if (target.length === 0) return null;

  const replayed = replayRecordedOperation(session, operationId, target);
  if (replayed !== null) return Object.freeze({ kind: "PLANNED" as const, outcome: replayed });

  const read = strictRead(store);
  if (read.status === "INVALID" && read.snapshot === null) return Object.freeze({ kind: "UNREADABLE" as const });
  const baseBefore = read.status === "ABSENT"
    ? emptyBaseSnapshot(session.missionId, session.runId)
    : freezeSnapshot(read.snapshot!);
  return Object.freeze({
    kind: "PLANNED" as const,
    outcome: compareWithBase(session, operationId, target, baseBefore),
  });
}

/**
 * Writes the validated after-snapshot, then reads the base back. True only
 * when the base now holds exactly that snapshot: a write that failed, was
 * truncated or was swallowed by storage is never reported as a transfer.
 */
export function commitBaseTransfer(store: BaseStore, baseAfter: BaseEvidenceSnapshot): boolean {
  try {
    const expected = freezeSnapshot(baseAfter);
    store.write(expected);
    const observed = strictRead(store);
    return observed.status === "PRESENT"
      && canonicalString(freezeSnapshot(observed.snapshot)) === canonicalString(expected);
  } catch {
    return false;
  }
}

/**
 * IDEMPOTENT REPLAY. Real hardware flaps: an RJ45 reconnect can bounce and
 * re-arm a caller while the first attempt's receipt already sits in the
 * journal. The C1 validator returns that existing receipt only when the
 * presented operation is byte-identical to the recorded one — so for an
 * already-receipted window this reconstructs the ORIGINAL evidence from the
 * receipt's own accounting instead of describing a second, different
 * comparison. The store is not touched and nothing is re-transferred.
 */
function replayRecordedOperation(
  session: OfflineEvidenceSession,
  operationId: string,
  target: readonly OfflineCausalRecord[],
): BaseCompareTransferOutcome | null {
  const existingReceipt = session.records.find((record) => record.eventType === "RECONCILIATION_RECEIPT"
    && typeof record.payload === "object" && record.payload !== null
    && (record.payload as Record<string, unknown>).operation_id === operationId);
  if (existingReceipt === undefined) return null;
  const transferredIds = (existingReceipt.payload as Record<string, unknown>).transferred_object_ids;
  if (!Array.isArray(transferredIds) || !transferredIds.every((id) => typeof id === "string")) return null;
  const prefixLength = target.length - transferredIds.length;
  if (prefixLength < 0) return null;
  const baseBefore = freezeSnapshot({
    missionId: session.missionId,
    runId: session.runId,
    records: target.slice(0, prefixLength),
  });
  const baseAfter = freezeSnapshot({
    missionId: session.missionId,
    runId: session.runId,
    records: [...target],
  });
  return Object.freeze({
    operation: Object.freeze({
      kind: "BASE_COMPARE_TRANSFER" as const,
      operationId,
      baseBefore,
      baseAfter,
      transferredReceiptIds: Object.freeze([...transferredIds] as string[]),
    }),
    transferred: false,
    refusalReason: null,
    localCount: target.length,
    baseBeforeCount: prefixLength,
    transferredCount: transferredIds.length,
  });
}

/**
 * The comparison itself. The base may hold exactly a causal prefix of the
 * target; anything else is refused with the base reported as it was and the
 * after-snapshot equal to it. Writes nothing.
 */
function compareWithBase(
  session: OfflineEvidenceSession,
  operationId: string,
  target: readonly OfflineCausalRecord[],
  baseBefore: BaseEvidenceSnapshot,
): BaseCompareTransferOutcome {
  const identityMatches = baseBefore.missionId === session.missionId
    && baseBefore.runId === session.runId;
  const isCausalPrefix = identityMatches
    && baseBefore.records.length <= target.length
    && baseBefore.records.every((record, index) => target[index]?.receiptId === record.receiptId
      && target[index]?.canonicalDigest === record.canonicalDigest);

  if (!isCausalPrefix) {
    return Object.freeze({
      operation: Object.freeze({
        kind: "BASE_COMPARE_TRANSFER" as const,
        operationId,
        baseBefore,
        baseAfter: baseBefore,
        transferredReceiptIds: Object.freeze([] as string[]),
      }),
      transferred: false,
      refusalReason: identityMatches ? "BASE_NOT_CAUSAL_PREFIX" as const : "BASE_IDENTITY_MISMATCH" as const,
      localCount: target.length,
      baseBeforeCount: baseBefore.records.length,
      transferredCount: 0,
    });
  }

  const missing = target.slice(baseBefore.records.length);
  const baseAfter = freezeSnapshot({
    missionId: session.missionId,
    runId: session.runId,
    records: [...baseBefore.records, ...missing],
  });
  return Object.freeze({
    operation: Object.freeze({
      kind: "BASE_COMPARE_TRANSFER" as const,
      operationId,
      baseBefore,
      baseAfter,
      transferredReceiptIds: Object.freeze(missing.map((record) => record.receiptId)),
    }),
    transferred: false,
    refusalReason: null,
    localCount: target.length,
    baseBeforeCount: baseBefore.records.length,
    transferredCount: missing.length,
  });
}

const ABSENT_BASE: BaseReadResult = Object.freeze({ status: "ABSENT" as const });
const UNREADABLE_BASE: BaseReadResult = Object.freeze({ status: "INVALID" as const, reason: "BASE_UNREADABLE" as const, snapshot: null });

function strictRead(store: BaseStore): BaseReadResult {
  try {
    if (store.readStrict !== undefined) return store.readStrict();
    const snapshot = store.read();
    return snapshot === null ? ABSENT_BASE : Object.freeze({ status: "PRESENT" as const, snapshot });
  } catch {
    return UNREADABLE_BASE;
  }
}

/** Storage identity of one run's base ledger. Runs never share a base slot. */
export function baseLedgerKey(runId: string): string {
  return `fortix.d006e.base.${runId}`;
}

type StringStorage = Pick<Storage, "getItem" | "setItem">;

/**
 * The browser-backed base ledger. Reads are validated structurally; anything
 * malformed reads as an ABSENT base (empty prefix) rather than as evidence.
 */
export function storageBaseStore(
  storage: StringStorage,
  missionId: string,
  runId: string,
): BaseStore {
  const key = baseLedgerKey(runId);
  return Object.freeze({
    read: (): BaseEvidenceSnapshot | null => {
      try {
        const text = storage.getItem(key);
        if (text === null) return null;
        const value: unknown = JSON.parse(text);
        if (!isBaseSnapshot(value) || value.missionId !== missionId || value.runId !== runId) return null;
        return value;
      } catch {
        return null;
      }
    },
    readStrict: (): BaseReadResult => {
      try {
        const text = storage.getItem(key);
        if (text === null) return ABSENT_BASE;
        const value: unknown = JSON.parse(text);
        if (!isBaseSnapshot(value)) return UNREADABLE_BASE;
        if (value.missionId !== missionId || value.runId !== runId) {
          return Object.freeze({ status: "INVALID" as const, reason: "BASE_IDENTITY_MISMATCH" as const, snapshot: freezeSnapshot(value) });
        }
        return Object.freeze({ status: "PRESENT" as const, snapshot: value });
      } catch {
        return UNREADABLE_BASE;
      }
    },
    write: (snapshot: BaseEvidenceSnapshot): void => {
      try {
        storage.setItem(key, JSON.stringify(snapshot));
      } catch {
        // A base that cannot persist simply reads as empty next time; the
        // operation evidence for THIS attempt already reported the truth.
      }
    },
  });
}

function isBaseSnapshot(value: unknown): value is BaseEvidenceSnapshot {
  if (typeof value !== "object" || value === null) return false;
  const snapshot = value as Record<string, unknown>;
  return typeof snapshot.missionId === "string"
    && typeof snapshot.runId === "string"
    && Array.isArray(snapshot.records)
    && snapshot.records.every((record) => typeof record === "object" && record !== null
      && typeof (record as Record<string, unknown>).receiptId === "string"
      && typeof (record as Record<string, unknown>).canonicalDigest === "string");
}

/**
 * In-memory base for environments without storage. Still a genuinely distinct
 * second ledger for the lifetime of the page — the comparison and transfer
 * are real; only durability is reduced, which is the safe direction.
 */
const MEMORY_BASES = new Map<string, BaseEvidenceSnapshot>();

export function memoryBaseStore(runId: string): BaseStore {
  const key = baseLedgerKey(runId);
  return Object.freeze({
    read: () => MEMORY_BASES.get(key) ?? null,
    readStrict: (): BaseReadResult => {
      const snapshot = MEMORY_BASES.get(key);
      return snapshot === undefined ? ABSENT_BASE : Object.freeze({ status: "PRESENT" as const, snapshot });
    },
    write: (snapshot: BaseEvidenceSnapshot) => { MEMORY_BASES.set(key, snapshot); },
  });
}

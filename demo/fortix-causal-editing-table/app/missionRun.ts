import {
  canonicalRecordDigest,
  isOfflineEvidenceSessionJournalValid,
  isSpecializedRecordProjectionValid,
  journalNetworkState,
  offlineWindowStatus,
  type OfflineCausalRecord,
  type OfflineEvidenceSession,
} from "./offlineEvidence.ts";
import type { NetworkTransitionSnapshot } from "./networkTransitions.ts";

/**
 * D-006E — active mission isolation.
 *
 * A physical review found a fresh launch already showing NR-NET-LOST and a
 * reconciliation node in the active Proof Tree, before any cable had been
 * touched in that demonstration. The cause is structural, not cosmetic:
 *
 *   - `MISSION_ID` is a single hard-coded constant, and it must stay one.
 *     It is the canonical D-005M causal chain id, embedded as
 *     `causal_links.causal_chain_id` in eight signed evidence fixtures;
 *     changing it changes the canonical bundle text and invalidates every
 *     payload digest in the set.
 *   - Both localStorage keys were derived from that constant, so every
 *     demonstration reused ONE storage slot, and the mount effect restored
 *     whatever it found there as the active session.
 *
 * So the canonical chain id cannot be the isolation boundary — it is
 * deliberately the same for every run of this demo. This module introduces
 * the boundary that can vary: a MISSION RUN identity, one per
 * demonstration. The canonical chain id continues to identify the signed
 * artifacts (Final Receipt, PEB); the run id identifies *this* enactment
 * and scopes its causal journal, its network machine, and its storage.
 *
 * Historical runs are never deleted. They are archived by id and their
 * storage is left exactly where it is; isolation here means "not shown as
 * belonging to the active mission", never "removed".
 */

/** Storage schema version, so a future change can migrate rather than guess. */
const SCHEMA = "d006e";

export type MissionRunPointer = Readonly<{
  version: 1;
  activeRunId: string;
  startedAt: string;
}>;

export type MissionRunArchive = Readonly<{
  version: 1;
  runIds: readonly string[];
}>;

/** Where the id of the currently active run is remembered. */
export const ACTIVE_RUN_POINTER_KEY = `fortix.${SCHEMA}.active-run`;

/** Where the ids of finished runs accumulate. Append-only; never pruned. */
export const RUN_ARCHIVE_KEY = `fortix.${SCHEMA}.run-archive`;

/** Per-run storage. Scoping by run id is what makes the isolation real. */
export function runSessionKey(runId: string): string {
  return `fortix.${SCHEMA}.evidence.${runId}`;
}

export function runNetworkKey(runId: string): string {
  return `fortix.${SCHEMA}.network.${runId}`;
}

/**
 * A new run identity. `entropy` is injected rather than read from a global
 * so this stays a pure function and a test can pin an exact value.
 */
export function newMissionRunId(startedAtEpochMs: number, entropy: string): string {
  const stamp = new Date(startedAtEpochMs).toISOString().replace(/[-:.]/g, "").slice(0, 15);
  const suffix = entropy.replace(/[^a-z0-9]/gi, "").slice(0, 12).toLowerCase();
  if (suffix.length === 0) throw new TypeError("mission run entropy must contain alphanumeric characters");
  return `fortix.demo.d006e.run.${stamp}-${suffix}`;
}

export function isMissionRunId(value: unknown): value is string {
  return typeof value === "string" && /^fortix\.demo\.d006e\.run\.\d{8}T\d{6}-[a-z0-9]{1,12}$/.test(value);
}

/**
 * Every record the active Proof Tree may render. The isolation boundary,
 * applied to data rather than to pixels: a record authored by another run
 * is simply not part of this mission's causal graph.
 */
export function recordsForRun<T extends { readonly runId: string }>(
  records: readonly T[],
  activeRunId: string,
): readonly T[] {
  return records.filter((record) => record.runId === activeRunId);
}

/**
 * May a persisted run legitimately continue as the active mission?
 *
 * Only a run with an OPEN offline window — one whose story is unfinished:
 * the cable is still out, or it is back in but reconciliation has not yet
 * closed the window. That is a demonstration genuinely interrupted mid-arc,
 * and a reload should put the presenter back where they were.
 *
 * Once the window is closed by its Reconciliation Receipt the arc is fully
 * told, and reloading starts a new demonstration rather than re-presenting a
 * finished mission's evidence as if it were live — which is the reported
 * defect. Nothing is discarded: the finished run keeps its own storage.
 *
 * Decided from the latest lifecycle record, so a second live outage cannot be
 * mistaken for the earlier reconciled window.
 */
export function isRunResumable(session: OfflineEvidenceSession): boolean {
  if (!isOfflineEvidenceSessionJournalValid(session)) return false;
  const status = offlineWindowStatus(session);
  return status === "OPEN" || status === "AWAITING_RECONCILIATION";
}

/**
 * A persisted transition machine is only a cache of facts already admitted
 * to the append-only journal. Both bodies are written separately, so reload
 * must reject either half of a torn write instead of choosing one as truth.
 */
export function isRunPersistencePairCoherent(
  session: OfflineEvidenceSession,
  snapshot: NetworkTransitionSnapshot,
): boolean {
  const networkRecords = session.records.filter((record) => (
    record.eventType === "NETWORK_LINK_LOST" || record.eventType === "NETWORK_LINK_RESTORED"
  ));
  const lastNetworkClock = networkRecords.at(-1)?.missionClockPosition ?? 0;
  const derivedNetworkState = journalNetworkState(session);
  return snapshot.version === 2
    && snapshot.runId === session.runId
    && derivedNetworkState !== null
    && session.networkState === derivedNetworkState
    && snapshot.state === derivedNetworkState
    && isOfflineEvidenceSessionJournalValid(session)
    && snapshot.transitionSequence === networkRecords.length
    && snapshot.causalOrder === networkRecords.length
    && snapshot.lastMissionClockMs === lastNetworkClock;
}

/**
 * Strict persistence boundary for an active run. Version-1 sessions and the
 * retired RESTORED state remain archived bytes; neither is hydrated into the
 * active runtime.
 */
export function parseRunSession(
  raw: string | null,
  expectedRunId: string,
  expectedMissionId: string,
): OfflineEvidenceSession | null {
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw) as Partial<OfflineEvidenceSession>;
    if (value.version !== 2
      || value.runId !== expectedRunId
      || value.missionId !== expectedMissionId
      || (value.networkState !== "CONNECTED" && value.networkState !== "LOST")
      || !Array.isArray(value.records)) return null;
    for (const candidate of value.records) {
      const record = candidate as OfflineCausalRecord;
      if (record === null || typeof record !== "object"
        || record.runId !== expectedRunId
        || record.missionId !== expectedMissionId
        || canonicalRecordDigest(record) !== record.canonicalDigest
        || !isSpecializedRecordProjectionValid(record)) return null;
    }
    if (typeof value.initialCausalPredecessor !== "string" && value.initialCausalPredecessor !== null) return null;
    const session = value as OfflineEvidenceSession;
    if (!isOfflineEvidenceSessionJournalValid(session)) return null;
    return deepFreeze(session);
  } catch {
    return null;
  }
}

export function parseRunPointer(raw: string | null): MissionRunPointer | null {
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw) as Partial<MissionRunPointer>;
    if (value.version !== 1 || !isMissionRunId(value.activeRunId)) return null;
    if (typeof value.startedAt !== "string") return null;
    return Object.freeze({ version: 1, activeRunId: value.activeRunId, startedAt: value.startedAt });
  } catch {
    return null;
  }
}

export function parseRunArchive(raw: string | null): MissionRunArchive {
  if (raw === null) return Object.freeze({ version: 1, runIds: Object.freeze([]) });
  try {
    const value = JSON.parse(raw) as Partial<MissionRunArchive>;
    if (value.version !== 1 || !Array.isArray(value.runIds)) {
      return Object.freeze({ version: 1, runIds: Object.freeze([]) });
    }
    return Object.freeze({ version: 1, runIds: Object.freeze(value.runIds.filter(isMissionRunId)) });
  } catch {
    return Object.freeze({ version: 1, runIds: Object.freeze([]) });
  }
}

/**
 * Adds a finished run to the archive. Append-only and idempotent: the run's
 * own storage is untouched, so its evidence remains readable forever.
 */
export function archiveRun(archive: MissionRunArchive, runId: string): MissionRunArchive {
  if (!isMissionRunId(runId) || archive.runIds.includes(runId)) return archive;
  return Object.freeze({ version: 1, runIds: Object.freeze([...archive.runIds, runId]) });
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

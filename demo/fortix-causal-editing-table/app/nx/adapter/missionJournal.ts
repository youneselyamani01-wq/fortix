import { projectMissionEvidence } from "../../missionEvidence.ts";
import { sealFinalReceiptRuntimeEvidence, type OfflineEvidenceSession } from "../../offlineEvidence.ts";
import { FINAL_RECEIPT_EMITTED_MS } from "../../storyTimeline.ts";

/**
 * The journal as the clock reaches `masterTimeMs`: deterministic records
 * projected up to that moment, and — once the Final Receipt is emitted — the
 * append boundary sealed at emission before anything later may follow it.
 * Idempotent: calling it on a journal that already holds everything returns
 * the same object.
 *
 * WHY THIS LIVES IN ITS OWN MODULE. The function is pure and has always been
 * usable anywhere, but it was declared inside `useMissionEngine.ts`, which
 * carries "use client". Under React Server Components that marks every export
 * of the module as a client reference, so a server component calling it failed
 * at runtime with "client reference export 'journalAt' is called on server".
 * The projection itself is not client work — it is deterministic evidence
 * derivation — so it belongs on this side of the boundary. `useMissionEngine`
 * re-exports it, and every existing importer is unaffected.
 */
export function journalAt(base: OfflineEvidenceSession, masterTimeMs: number): OfflineEvidenceSession {
  let session = base;
  if (masterTimeMs >= FINAL_RECEIPT_EMITTED_MS && session.finalReceiptRuntimeSeal === null) {
    session = sealFinalReceiptRuntimeEvidence(
      projectMissionEvidence(session, FINAL_RECEIPT_EMITTED_MS),
      FINAL_RECEIPT_EMITTED_MS,
    );
  }
  return projectMissionEvidence(session, masterTimeMs);
}

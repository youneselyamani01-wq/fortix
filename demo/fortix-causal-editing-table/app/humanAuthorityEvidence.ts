import { MASTER_EVIDENCE_EVENTS } from "./masterStory.ts";
import {
  appendMissionEvidence,
  type OfflineCausalRecord,
  type OfflineEvidenceSession,
} from "./offlineEvidence.ts";

/**
 * D-006 NX0 — the human DENY leaves evidence.
 *
 * THE GAP. ALLOW re-enacts the signed D-005M approval object, so an approved
 * run carries canonical evidence of the human decision. DENY had none: the
 * clock stopped, a caption said "no approval", and the journal recorded
 * nothing — a public record could never state "a human denied the payment"
 * without inventing it (mandate §50: "Evidence must record the denial").
 *
 * THE RECORD. One runtime record, authored by the HUMAN_APPROVER domain at
 * the authority boundary, caused by the signed approval REQUEST (the object
 * that asked the human), and stating the consequence. It is idempotent, it is
 * live (a person pressed DENY; nothing schedules it), and the closed Final
 * Receipt profile admits exactly this shape and nothing else — see
 * portableMissionEvidence.ts, which validates every field before the record
 * may become a presented member.
 */

export const HUMAN_AUTHORITY_DECISION_EVENT_TYPE = "HUMAN_AUTHORITY_DECISION" as const;
export const HUMAN_DENIAL_EVENT_ID = "d006nx0.human-decision:denied" as const;
export const HUMAN_DENIAL_RECEIPT_ID = "NR-HUMAN-DECISION:denied" as const;
export const HUMAN_APPROVER_DOMAIN = "HUMAN_APPROVER" as const;
export const HUMAN_APPROVAL_REQUEST_EVENT_ID = "d005m.master-human-approval-request" as const;
const REQUESTED_AMOUNT_EUR = 1850;
const AUTONOMOUS_LIMIT_EUR = 500;

/** The amounts at the human authority boundary, stated once for every stage. */
export const HUMAN_AUTHORITY_AMOUNTS = Object.freeze({
  requestedEur: REQUESTED_AMOUNT_EUR,
  autonomousLimitEur: AUTONOMOUS_LIMIT_EUR,
});

/** The signed object that asked the human. The denial names it as its cause. */
export function humanApprovalRequestEvidenceId(): string {
  const request = MASTER_EVIDENCE_EVENTS.find((event) => event.event_id === HUMAN_APPROVAL_REQUEST_EVENT_ID);
  if (request === undefined || typeof request.evidence_id !== "string" || request.evidence_id.length === 0) {
    throw new TypeError("the signed human approval request is absent from the master evidence");
  }
  return request.evidence_id;
}

export function humanDenialPayload(observedMasterTimeMs: number) {
  return Object.freeze({
    trust_domain: HUMAN_APPROVER_DOMAIN,
    decision: "DENIED",
    requested_amount_eur: REQUESTED_AMOUNT_EUR,
    autonomous_limit_eur: AUTONOMOUS_LIMIT_EUR,
    consequence: "MISSION_STOPPED",
    caused_by: humanApprovalRequestEvidenceId(),
    observed_input: null,
    observed_master_time_ms: observedMasterTimeMs,
    evidence_class: "DEMONSTRATION_RUNTIME",
    execution_scope: "DEMO_PRESENTATION_RUNTIME",
  });
}

export type HumanDenialInput = Readonly<{
  /** Journal slot: strictly after the last record. */
  missionClockPosition: number;
  /** The mission moment the human pressed DENY (the clamped boundary). */
  observedMasterTimeMs: number;
}>;

export type HumanDenialResult = Readonly<{
  session: OfflineEvidenceSession;
  record: OfflineCausalRecord;
  appended: boolean;
}>;

/** Writes the denial once. Pressing DENY twice cannot author two denials. */
export function appendHumanAuthorityDenial(
  session: OfflineEvidenceSession,
  input: HumanDenialInput,
): HumanDenialResult {
  const existing = session.records.find((record) => record.eventId === HUMAN_DENIAL_EVENT_ID);
  if (existing !== undefined) return Object.freeze({ session, record: existing, appended: false });
  if (!Number.isFinite(input.observedMasterTimeMs) || input.observedMasterTimeMs < 0) {
    throw new TypeError("the denial must carry the finite mission moment it was observed at");
  }
  const appended = appendMissionEvidence(session, {
    missionId: session.missionId,
    runId: session.runId,
    eventId: HUMAN_DENIAL_EVENT_ID,
    eventType: HUMAN_AUTHORITY_DECISION_EVENT_TYPE,
    receiptId: HUMAN_DENIAL_RECEIPT_ID,
    missionClockPosition: input.missionClockPosition,
    executionLocality: "LOCAL",
    payload: humanDenialPayload(input.observedMasterTimeMs),
  });
  return Object.freeze({ session: appended.session, record: appended.record, appended: true });
}

/**
 * The exact admissible shape. Used by the closure builder: any other record
 * of this event type is refused as RUNTIME_EVENT_NOT_ALLOWED, so a forged
 * "human decision" with a different cause, amount or consequence can never
 * become presented evidence.
 */
export function isHumanAuthorityDenialRecord(record: OfflineCausalRecord): boolean {
  const payload = record.payload as Readonly<Record<string, unknown>>;
  const observed = payload.observed_master_time_ms;
  return record.eventType === HUMAN_AUTHORITY_DECISION_EVENT_TYPE
    && record.eventId === HUMAN_DENIAL_EVENT_ID
    && record.receiptId === HUMAN_DENIAL_RECEIPT_ID
    && record.evidenceLocality === "LOCAL"
    && record.executionLocality === "LOCAL"
    && typeof observed === "number" && Number.isFinite(observed) && observed >= 0
    && JSON.stringify(sortKeys(payload)) === JSON.stringify(sortKeys(humanDenialPayload(observed)));
}

function sortKeys(value: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, value[key]]));
}

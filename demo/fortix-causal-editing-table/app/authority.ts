import authorityFixture from "../data/d004-authority-evidence.json" with { type: "json" };
import {
  SCENARIO_STATEMENTS,
  evidenceTimestampToMasterTime,
} from "./evidence.ts";
import { clampMasterTime } from "./timeline.ts";

export type AuthorityLifecycleStatus =
  | "ACTIVE"
  | "SUSPENDED"
  | "REVOKED"
  | "EXPIRED"
  | "UNKNOWN";

export type AuthorityCondition =
  | "NORMAL"
  | "MISSING"
  | "SUSPENDED"
  | "REVOKED"
  | "EXPIRED"
  | "UNKNOWN";

export type AuthorityResolution = Readonly<{
  actionAuthorized: boolean;
  authorityEvidenceId: string | null;
  authorityStatus: AuthorityLifecycleStatus | "MISSING" | "CONFLICT" | "NOT_REACHED";
  reasonCode:
    | "D004_AUTHORITY_ACTIVE"
    | "D004_AUTHORITY_NOT_REACHED"
    | "D004_AUTHORITY_EVIDENCE_MISSING"
    | "D004_AUTHORITY_SUSPENDED"
    | "D004_AUTHORITY_REVOKED"
    | "D004_AUTHORITY_EXPIRED"
    | "D004_AUTHORITY_UNKNOWN"
    | "D004_AUTHORITY_CONFLICT"
    | "D004_AUTHORITY_NOT_YET_EFFECTIVE";
  verdict: "VALID" | "INDETERMINATE" | "REVOKED";
}>;

export type AuthorityTrack =
  | "Perception"
  | "Prediction"
  | "Intent"
  | "Authority"
  | "Policy"
  | "Decision"
  | "Execution"
  | "Result";

export type AuthorityTrackItem = Readonly<{
  id: string;
  time: number;
  label: string;
  state?: string;
}>;

export type AuthorityEvidenceObject = Readonly<{
  evidence_id: string;
  evidence_type: string;
  significant_event: Readonly<{
    event_id: string;
    event_time: string;
  }>;
  evidence_payload: Readonly<Record<string, unknown>>;
}>;

export type AuthorityEvidenceEnvelope = Readonly<{
  action_time: string;
  authority_history: readonly AuthorityEvidenceObject[];
  bindings: Readonly<Record<string, string | readonly string[]>>;
  capability_state: Readonly<{
    access: "AVAILABLE";
    execution_capability: "AVAILABLE";
  }>;
  control_conditions: Readonly<
    Record<string, Readonly<{ authority_evidence: AuthorityEvidenceObject | null }>>
  >;
  governed_chain: readonly AuthorityEvidenceObject[];
  policy_artifact: Readonly<Record<string, unknown>>;
  profile: "fortix.demo.authority-to-action.v1";
  schema_version: "1.0";
}>;

type ParsedAuthorityRecord = Readonly<{
  authorityId: string;
  effectiveFromMs: number;
  effectiveUntilMs: number | null;
  evidenceId: string;
  policyDigest: string;
  policyId: string;
  policyVersion: string;
  status: AuthorityLifecycleStatus;
}>;

export const D004_ACTION_TIME_MS = 3_760;
export const D004_AUTHORITY_EVIDENCE = Object.freeze(
  authorityFixture as unknown as AuthorityEvidenceEnvelope,
);
export const D004_SYSTEM_TRACKS: readonly AuthorityTrack[] = Object.freeze([
  "Perception",
  "Prediction",
  "Intent",
  "Authority",
  "Policy",
  "Decision",
  "Execution",
  "Result",
]);

export function authorityEvidenceForCondition(
  condition: AuthorityCondition,
  envelope: AuthorityEvidenceEnvelope = D004_AUTHORITY_EVIDENCE,
): AuthorityEvidenceEnvelope {
  if (condition === "NORMAL") return envelope;
  const control = envelope.control_conditions[condition];
  if (control === undefined) throw new Error(`Unknown D-004 authority condition: ${condition}`);
  return {
    ...envelope,
    authority_history:
      control.authority_evidence === null ? [] : [control.authority_evidence],
    governed_chain:
      condition === "MISSING"
        ? envelope.governed_chain.filter(
            (evidence) => evidence.evidence_type !== "POLICY_AUTHORITY_STATUS",
          )
        : envelope.governed_chain,
  };
}

export function resolveAuthorityAtSignedTime(
  signedTimeMs: number,
  envelope: AuthorityEvidenceEnvelope = D004_AUTHORITY_EVIDENCE,
): AuthorityResolution {
  const records = envelope.authority_history.map(parseAuthorityRecord);
  if (records.length === 0) {
    return resolution("MISSING", "D004_AUTHORITY_EVIDENCE_MISSING", "INDETERMINATE", null);
  }

  const started = records.filter((record) => record.effectiveFromMs <= signedTimeMs);
  if (started.length === 0) {
    return resolution("UNKNOWN", "D004_AUTHORITY_NOT_YET_EFFECTIVE", "INDETERMINATE", null);
  }
  const latestEffectiveFrom = Math.max(...started.map((record) => record.effectiveFromMs));
  const latest = started
    .filter((record) => record.effectiveFromMs === latestEffectiveFrom)
    .sort((left, right) => left.evidenceId.localeCompare(right.evidenceId));
  const bindings = new Set(
    latest.map((record) => [
      record.authorityId,
      record.policyId,
      record.policyVersion,
      record.policyDigest,
      record.status,
      record.effectiveUntilMs,
    ].join("|")),
  );
  if (bindings.size !== 1) {
    return resolution("CONFLICT", "D004_AUTHORITY_CONFLICT", "INDETERMINATE", null);
  }

  const selected = latest[0];
  if (
    selected.status === "EXPIRED" ||
    (selected.effectiveUntilMs !== null && signedTimeMs >= selected.effectiveUntilMs)
  ) {
    return resolution("EXPIRED", "D004_AUTHORITY_EXPIRED", "INDETERMINATE", selected.evidenceId);
  }
  switch (selected.status) {
    case "ACTIVE":
      return resolution("ACTIVE", "D004_AUTHORITY_ACTIVE", "VALID", selected.evidenceId, true);
    case "SUSPENDED":
      return resolution("SUSPENDED", "D004_AUTHORITY_SUSPENDED", "REVOKED", selected.evidenceId);
    case "REVOKED":
      return resolution("REVOKED", "D004_AUTHORITY_REVOKED", "REVOKED", selected.evidenceId);
    case "UNKNOWN":
      return resolution("UNKNOWN", "D004_AUTHORITY_UNKNOWN", "INDETERMINATE", selected.evidenceId);
  }
}

export function deriveHistoricalActionAuthorityAt(
  masterTime: number,
  condition: AuthorityCondition = "NORMAL",
  envelope: AuthorityEvidenceEnvelope = D004_AUTHORITY_EVIDENCE,
): AuthorityResolution {
  const clamped = clampMasterTime(masterTime);
  if (clamped < D004_ACTION_TIME_MS) {
    return resolution("NOT_REACHED", "D004_AUTHORITY_NOT_REACHED", "INDETERMINATE", null);
  }
  return resolveAuthorityAtSignedTime(
    D004_ACTION_TIME_MS,
    authorityEvidenceForCondition(condition, envelope),
  );
}

export function authoritySystemTracksAt(
  masterTime: number,
  condition: AuthorityCondition = "NORMAL",
): Readonly<Record<AuthorityTrack, readonly AuthorityTrackItem[]>> {
  const clamped = clampMasterTime(masterTime);
  const fromScenario = (track: "Perception" | "Prediction" | "Policy" | "Decision" | "Execution") =>
    SCENARIO_STATEMENTS.filter(
      (statement) => statement.systemTrack === track && statement.timeMs <= clamped,
    ).map((statement) => ({
      id: statement.id,
      time: statement.timeMs,
      label: statement.label,
    }));
  const authority = deriveHistoricalActionAuthorityAt(clamped, condition);
  const lifecycleAtCurrentTime = clamped >= 6_000
    ? resolveAuthorityAtSignedTime(6_000, authorityEvidenceForCondition(condition))
    : null;

  return {
    Perception: fromScenario("Perception"),
    Prediction: fromScenario("Prediction"),
    Intent: clamped >= 0
      ? [{
          id: "d004-operational-intent",
          time: 0,
          label: "Complete right turn within safety envelope",
          state: "RECORDED",
        }]
      : [],
    Authority: clamped < D004_ACTION_TIME_MS
      ? []
      : [
          {
            id: "d004-action-authority",
            time: D004_ACTION_TIME_MS,
            label: `Action authority at signed time`,
            state: authority.authorityStatus,
          },
          ...(lifecycleAtCurrentTime === null
            ? []
            : [{
                id: "d004-later-authority-state",
                time: 6_000,
                label: "Later authority lifecycle event",
                state: lifecycleAtCurrentTime.authorityStatus,
              }]),
        ],
    Policy: [
      ...fromScenario("Policy"),
      ...(clamped >= D004_ACTION_TIME_MS
        ? [{
            id: "d004-policy-applied",
            time: D004_ACTION_TIME_MS,
            label: "Emergency braking policy applied",
            state: "APPLIED",
          }]
        : []),
    ],
    Decision: fromScenario("Decision"),
    Execution: fromScenario("Execution"),
    Result: clamped >= 5_340
      ? [{
          id: "d004-result",
          time: 5_340,
          label: "Authority-bound action result recorded",
          state: authority.actionAuthorized ? "AUTHORIZED" : "NOT ESTABLISHED",
        }]
      : [],
  };
}

export function authorityProofItemsAt(
  masterTime: number,
  condition: AuthorityCondition = "NORMAL",
): readonly AuthorityTrackItem[] {
  const clamped = clampMasterTime(masterTime);
  const selected = authorityEvidenceForCondition(condition);
  const chain = selected.governed_chain.filter((evidence) => {
    if (
      evidence.evidence_type === "POLICY_AUTHORITY_STATUS" &&
      selected.authority_history.length === 0
    ) return false;
    return evidenceTimestampToMasterTime(evidence.significant_event.event_time) <= clamped;
  });
  return chain.map((evidence) => ({
    id: evidence.evidence_id,
    time: evidenceTimestampToMasterTime(evidence.significant_event.event_time),
    label: authorityEvidenceLabel(evidence.significant_event.event_id),
    state: "SIGNED",
  }));
}

function parseAuthorityRecord(evidence: AuthorityEvidenceObject): ParsedAuthorityRecord {
  const payload = evidence.evidence_payload.policy_authority_status;
  if (payload === null || Array.isArray(payload) || typeof payload !== "object") {
    throw new Error("D-004 authority payload is invalid");
  }
  const record = payload as Record<string, unknown>;
  const status = requireAuthorityStatus(record.authority_status);
  return {
    authorityId: requireText(record.authority_id),
    effectiveFromMs: evidenceTimestampToMasterTime(requireText(record.effective_from)),
    effectiveUntilMs: record.effective_until === null
      ? null
      : evidenceTimestampToMasterTime(requireText(record.effective_until)),
    evidenceId: evidence.evidence_id,
    policyDigest: requireText(record.policy_digest),
    policyId: requireText(record.policy_id),
    policyVersion: requireText(record.policy_version),
    status,
  };
}

function resolution(
  authorityStatus: AuthorityResolution["authorityStatus"],
  reasonCode: AuthorityResolution["reasonCode"],
  verdict: AuthorityResolution["verdict"],
  authorityEvidenceId: string | null,
  actionAuthorized = false,
): AuthorityResolution {
  return { actionAuthorized, authorityEvidenceId, authorityStatus, reasonCode, verdict };
}

function requireText(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("D-004 authority field is invalid");
  }
  return value;
}

function requireAuthorityStatus(value: unknown): AuthorityLifecycleStatus {
  if (
    value !== "ACTIVE" &&
    value !== "SUSPENDED" &&
    value !== "REVOKED" &&
    value !== "EXPIRED" &&
    value !== "UNKNOWN"
  ) throw new Error("D-004 authority status is invalid");
  return value;
}

function authorityEvidenceLabel(eventId: string): string {
  const labels: Readonly<Record<string, string>> = {
    "d004.operational-intent": "Operational intent",
    "d004.emergency-braking-policy-application": "Policy application",
    "d004.applicable-authority-active": "Applicable authority",
    "d004.authority-bound-brake-execution": "Execution binding",
    "d004.authority-bound-action-result": "Governed result",
  };
  return labels[eventId] ?? "Authority evidence";
}

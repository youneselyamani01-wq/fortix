import canonicalEvidenceFixture from "../data/d002-canonical-evidence.json" with { type: "json" };
import { TIMELINE_EVENTS, clampMasterTime } from "./timeline.ts";

export type CanonicalEvidenceType =
  | "INTENT"
  | "POLICY_DECISION"
  | "EXECUTION"
  | "RESULT";

export type CanonicalEvidenceObject = Readonly<{
  evidence_id: string;
  evidence_version: "1.0";
  evidence_type: CanonicalEvidenceType;
  evidence_profile: "fortix.evidence.canonical.v1";
  identity_profile: "fortix.evidence-id.sorted-json-blake3.v1";
  schema_version: "1.0";
  subject: Readonly<{
    subject_id: string;
    subject_type: string;
  }>;
  issuer: Readonly<{
    issuer_id: string;
    issuer_type: string;
  }>;
  significant_event: Readonly<{
    event_id: string;
    event_type: CanonicalEvidenceType;
    event_time: string;
  }>;
  causal_links: Readonly<{
    causal_chain_id: string;
    predecessor_evidence_id: string | null;
  }>;
  evidence_payload: Readonly<Record<string, unknown>>;
  lifecycle: Readonly<{
    issued_at: string;
    effective_from: string;
    effective_until: string | null;
    compatibility_version: "1.0";
  }>;
}>;

export type SystemTrack =
  | "Perception"
  | "Prediction"
  | "Policy"
  | "Decision"
  | "Execution";

export type EvidenceAvailability =
  | "AVAILABLE_NOT_VERIFIED"
  | "INCOMPLETE_NOT_VERIFIED"
  | "NOT_RECORDED";

export type ScenarioStatement = Readonly<{
  id: string;
  timeMs: number;
  label: string;
  domain: "REALITY" | "SYSTEM";
  significance: "CONTEXT" | "SIGNIFICANT_EVENT";
  systemTrack: SystemTrack | null;
  evidenceEventIds: readonly string[];
}>;

export type NanoReceipt = Readonly<{
  evidence: CanonicalEvidenceObject;
  masterTimeMs: number;
  label: string;
  presentationKind: "observation" | "assessment" | "intent" | "decision" | "execution";
  statementId: string;
}>;

export type CausalBinding = Readonly<{
  bindingId: string;
  childEvidenceId: string;
  childEventId: string;
  childLabel: string;
  parentEvidenceId: string;
  parentEventId: string | null;
  parentLabel: string | null;
  parentAvailable: boolean;
}>;

export type StatementEvidenceState = Readonly<{
  statement: ScenarioStatement;
  availability: EvidenceAvailability;
  receiptIds: readonly string[];
  causalParentIds: readonly string[];
}>;

export type DerivedEvidenceState = Readonly<{
  masterTime: number;
  visibleReceipts: readonly NanoReceipt[];
  visibleSignificantEvents: readonly ScenarioStatement[];
  causalBindings: readonly CausalBinding[];
  statementStates: readonly StatementEvidenceState[];
}>;

const RECEIPT_PRESENTATION: Readonly<
  Record<
    string,
    Readonly<{
      label: string;
      presentationKind: NanoReceipt["presentationKind"];
      statementId: string;
    }>
  >
> = Object.freeze({
  "d002.candidate-detected": {
    label: "Candidate detection evidence",
    presentationKind: "observation",
    statementId: "candidate-detected",
  },
  "d002.secondary-sensor-confirmation": {
    label: "Secondary confirmation evidence",
    presentationKind: "observation",
    statementId: "secondary-confirmation",
  },
  "d002.object-classified": {
    label: "Classification evidence",
    presentationKind: "assessment",
    statementId: "object-classified",
  },
  "d002.trajectory-prediction": {
    label: "Trajectory evidence",
    presentationKind: "assessment",
    statementId: "trajectory-prediction",
  },
  "d002.collision-risk-rises": {
    label: "Risk assessment evidence",
    presentationKind: "assessment",
    statementId: "risk-rises",
  },
  "d002.risk-threshold-exceeded": {
    label: "Threshold response intent",
    presentationKind: "intent",
    statementId: "threshold-exceeded",
  },
  "d002.emergency-braking-decision": {
    label: "Braking policy decision",
    presentationKind: "decision",
    statementId: "braking-decision",
  },
  "d002.brake-command": {
    label: "Brake command execution",
    presentationKind: "execution",
    statementId: "brake-command",
  },
  "d002.actuator-acknowledgement": {
    label: "Actuator acknowledgement",
    presentationKind: "observation",
    statementId: "actuator-acknowledgement",
  },
  "d002.physical-deceleration-observed": {
    label: "Deceleration observation evidence",
    presentationKind: "observation",
    statementId: "deceleration-begins",
  },
  "d002.collision-window-kinematics": {
    label: "Closest-point kinematics evidence",
    presentationKind: "observation",
    statementId: "collision-window",
  },
  "d002.collision-window-risk-context": {
    label: "Closest-point risk-context evidence",
    presentationKind: "assessment",
    statementId: "collision-window",
  },
  "d002.incident-result": {
    label: "Incident result evidence",
    presentationKind: "observation",
    statementId: "incident-state",
  },
});

export const SCENARIO_STATEMENTS: readonly ScenarioStatement[] = Object.freeze([
  {
    id: "vehicle-approach",
    timeMs: 0,
    label: "Vehicle approaching intersection",
    domain: "REALITY",
    significance: "CONTEXT",
    systemTrack: null,
    evidenceEventIds: [],
  },
  {
    id: "scooter-enters",
    timeMs: 2_400,
    label: "Scooter enters relevant environment",
    domain: "REALITY",
    significance: "CONTEXT",
    systemTrack: null,
    evidenceEventIds: [],
  },
  {
    id: "physically-observable",
    timeMs: 2_860,
    label: "Scooter becomes physically observable",
    domain: "REALITY",
    significance: "CONTEXT",
    systemTrack: null,
    evidenceEventIds: [],
  },
  {
    id: "sensor-observable",
    timeMs: 3_000,
    label: "Scooter becomes sensor-observable",
    domain: "SYSTEM",
    significance: "CONTEXT",
    systemTrack: "Perception",
    evidenceEventIds: [],
  },
  {
    id: "candidate-detected",
    timeMs: 3_180,
    label: "Candidate detected",
    domain: "SYSTEM",
    significance: "SIGNIFICANT_EVENT",
    systemTrack: "Perception",
    evidenceEventIds: ["d002.candidate-detected"],
  },
  {
    id: "secondary-confirmation",
    timeMs: 3_240,
    label: "Secondary sensor confirmation",
    domain: "SYSTEM",
    significance: "SIGNIFICANT_EVENT",
    systemTrack: "Perception",
    evidenceEventIds: ["d002.secondary-sensor-confirmation"],
  },
  {
    id: "object-classified",
    timeMs: 3_310,
    label: "Object classified",
    domain: "SYSTEM",
    significance: "SIGNIFICANT_EVENT",
    systemTrack: "Perception",
    evidenceEventIds: ["d002.object-classified"],
  },
  {
    id: "trajectory-prediction",
    timeMs: 3_420,
    label: "Trajectory prediction",
    domain: "SYSTEM",
    significance: "SIGNIFICANT_EVENT",
    systemTrack: "Prediction",
    evidenceEventIds: ["d002.trajectory-prediction"],
  },
  {
    id: "risk-rises",
    timeMs: 3_560,
    label: "Collision risk rises",
    domain: "SYSTEM",
    significance: "SIGNIFICANT_EVENT",
    systemTrack: "Prediction",
    evidenceEventIds: ["d002.collision-risk-rises"],
  },
  {
    id: "threshold-exceeded",
    timeMs: 3_710,
    label: "Risk threshold exceeded",
    domain: "SYSTEM",
    significance: "SIGNIFICANT_EVENT",
    systemTrack: "Policy",
    evidenceEventIds: ["d002.risk-threshold-exceeded"],
  },
  {
    id: "braking-decision",
    timeMs: 3_760,
    label: "Emergency braking decision",
    domain: "SYSTEM",
    significance: "SIGNIFICANT_EVENT",
    systemTrack: "Decision",
    evidenceEventIds: ["d002.emergency-braking-decision"],
  },
  {
    id: "brake-command",
    timeMs: 3_810,
    label: "Brake command issued",
    domain: "SYSTEM",
    significance: "SIGNIFICANT_EVENT",
    systemTrack: "Execution",
    evidenceEventIds: ["d002.brake-command"],
  },
  {
    id: "actuator-acknowledgement",
    timeMs: 3_890,
    label: "Actuator acknowledged command",
    domain: "SYSTEM",
    significance: "SIGNIFICANT_EVENT",
    systemTrack: "Execution",
    evidenceEventIds: ["d002.actuator-acknowledgement"],
  },
  {
    id: "deceleration-begins",
    timeMs: 4_120,
    label: "Physical deceleration begins",
    domain: "REALITY",
    significance: "SIGNIFICANT_EVENT",
    systemTrack: null,
    evidenceEventIds: ["d002.physical-deceleration-observed"],
  },
  {
    id: "collision-window",
    timeMs: 5_340,
    label: "Collision / near-collision occurs",
    domain: "REALITY",
    significance: "SIGNIFICANT_EVENT",
    systemTrack: null,
    evidenceEventIds: [
      "d002.collision-window-kinematics",
      "d002.collision-window-risk-context",
    ],
  },
  {
    id: "vehicle-stops",
    timeMs: 5_420,
    label: "Vehicle stops",
    domain: "REALITY",
    significance: "CONTEXT",
    systemTrack: null,
    evidenceEventIds: [],
  },
  {
    id: "incident-state",
    timeMs: 6_000,
    label: "Incident state",
    domain: "REALITY",
    significance: "SIGNIFICANT_EVENT",
    systemTrack: null,
    evidenceEventIds: ["d002.incident-result"],
  },
]);

export const CANONICAL_EVIDENCE_OBJECTS: readonly CanonicalEvidenceObject[] =
  Object.freeze(
    canonicalEvidenceFixture as unknown as readonly CanonicalEvidenceObject[],
  );

export const SYSTEM_TRACKS: readonly SystemTrack[] = Object.freeze([
  "Perception",
  "Prediction",
  "Policy",
  "Decision",
  "Execution",
]);

export const D002_TIMELINE_MARKERS = Object.freeze(
  [
    ...TIMELINE_EVENTS.map(({ id, timeMs, markerLabel }) => ({ id, timeMs, markerLabel })),
    { id: "physically-observable", timeMs: 2_860, markerLabel: "Physically observable" },
    { id: "sensor-observable", timeMs: 3_000, markerLabel: "Sensor-observable" },
  ].sort(compareTimeThenId),
);

export function evidenceTimestampToMasterTime(timestamp: string): number {
  const match = /^2026-08-01T00:00:(\d{2})\.(\d{3})Z$/.exec(timestamp);
  if (match === null) {
    throw new Error(`D-002 evidence timestamp is outside the scenario epoch: ${timestamp}`);
  }
  return Number(match[1]) * 1_000 + Number(match[2]);
}

export function buildNanoReceipts(
  evidenceObjects: readonly CanonicalEvidenceObject[] = CANONICAL_EVIDENCE_OBJECTS,
): readonly NanoReceipt[] {
  const seenIds = new Set<string>();
  const receipts = evidenceObjects.map((evidence) => {
    if (seenIds.has(evidence.evidence_id)) {
      throw new Error(`Duplicate D-002 Evidence ID: ${evidence.evidence_id}`);
    }
    seenIds.add(evidence.evidence_id);

    const presentation = RECEIPT_PRESENTATION[evidence.significant_event.event_id];
    if (presentation === undefined) {
      throw new Error(
        `No D-002 presentation mapping for ${evidence.significant_event.event_id}`,
      );
    }
    return {
      evidence,
      masterTimeMs: evidenceTimestampToMasterTime(
        evidence.significant_event.event_time,
      ),
      ...presentation,
    };
  });

  return receipts.sort(compareReceipt);
}

export function deriveCausalBindings(
  evidenceObjects: readonly CanonicalEvidenceObject[] = CANONICAL_EVIDENCE_OBJECTS,
): readonly CausalBinding[] {
  const receipts = buildNanoReceipts(evidenceObjects);
  const byId = new Map(receipts.map((receipt) => [receipt.evidence.evidence_id, receipt]));

  return receipts
    .flatMap((receipt): CausalBinding[] => {
      const parentId = receipt.evidence.causal_links.predecessor_evidence_id;
      if (parentId === null) return [];
      const parent = byId.get(parentId) ?? null;
      return [
        {
          bindingId: `${receipt.evidence.evidence_id}<-${parentId}`,
          childEvidenceId: receipt.evidence.evidence_id,
          childEventId: receipt.evidence.significant_event.event_id,
          childLabel: receipt.label,
          parentEvidenceId: parentId,
          parentEventId: parent?.evidence.significant_event.event_id ?? null,
          parentLabel: parent?.label ?? null,
          parentAvailable: parent !== null,
        },
      ];
    })
    .sort((left, right) =>
      left.childEvidenceId.localeCompare(right.childEvidenceId) ||
      left.parentEvidenceId.localeCompare(right.parentEvidenceId),
    );
}

export function deriveEvidenceStateAt(
  masterTime: number,
  evidenceObjects: readonly CanonicalEvidenceObject[] = CANONICAL_EVIDENCE_OBJECTS,
): DerivedEvidenceState {
  const clamped = clampMasterTime(masterTime);
  const allReceipts = buildNanoReceipts(evidenceObjects);
  const visibleReceipts = allReceipts.filter(
    (receipt) => receipt.masterTimeMs <= clamped,
  );
  const visibleIds = new Set(
    visibleReceipts.map((receipt) => receipt.evidence.evidence_id),
  );
  const visibleEventIds = new Set(
    visibleReceipts.map((receipt) => receipt.evidence.significant_event.event_id),
  );
  const visibleCausalBindings = deriveCausalBindings(evidenceObjects).filter(
    (binding) => visibleIds.has(binding.childEvidenceId),
  );
  const reachedStatements = SCENARIO_STATEMENTS.filter(
    (statement) => statement.timeMs <= clamped,
  );

  const statementStates = reachedStatements.map((statement): StatementEvidenceState => {
    const receipts = visibleReceipts.filter(
      (receipt) => receipt.statementId === statement.id,
    );
    const parentIds = visibleCausalBindings
      .filter((binding) => receipts.some(
        (receipt) => receipt.evidence.evidence_id === binding.childEvidenceId,
      ))
      .map((binding) => binding.parentEvidenceId)
      .sort();

    const suppliedEventCount = statement.evidenceEventIds.filter((eventId) =>
      visibleEventIds.has(eventId),
    ).length;

    return {
      statement,
      availability:
        statement.evidenceEventIds.length > 0 &&
        suppliedEventCount === statement.evidenceEventIds.length
          ? "AVAILABLE_NOT_VERIFIED"
          : suppliedEventCount > 0
            ? "INCOMPLETE_NOT_VERIFIED"
          : "NOT_RECORDED",
      receiptIds: receipts.map((receipt) => receipt.evidence.evidence_id).sort(),
      causalParentIds: [...new Set(parentIds)],
    };
  });

  return {
    masterTime: clamped,
    visibleReceipts,
    visibleSignificantEvents: reachedStatements.filter(
      (statement) => statement.significance === "SIGNIFICANT_EVENT",
    ),
    causalBindings: visibleCausalBindings,
    statementStates,
  };
}

export function deriveDomainStateAt(
  masterTime: number,
  domain: ScenarioStatement["domain"],
): string {
  const clamped = clampMasterTime(masterTime);
  return (
    SCENARIO_STATEMENTS.filter(
      (statement) => statement.domain === domain && statement.timeMs <= clamped,
    ).at(-1)?.label ?? `${domain === "REALITY" ? "Scene" : "System"} ready`
  );
}

export function systemTrackStatementsAt(
  masterTime: number,
  track: SystemTrack,
): readonly ScenarioStatement[] {
  const clamped = clampMasterTime(masterTime);
  return SCENARIO_STATEMENTS.filter(
    (statement) =>
      statement.systemTrack === track && statement.timeMs <= clamped,
  );
}

export function shortEvidenceId(evidenceId: string): string {
  return `fortix:evidence:...${evidenceId.slice(-8)}`;
}

function compareReceipt(left: NanoReceipt, right: NanoReceipt): number {
  return (
    left.masterTimeMs - right.masterTimeMs ||
    left.evidence.evidence_id.localeCompare(right.evidence.evidence_id)
  );
}

function compareTimeThenId(
  left: Readonly<{ timeMs: number; id: string }>,
  right: Readonly<{ timeMs: number; id: string }>,
): number {
  return left.timeMs - right.timeMs || left.id.localeCompare(right.id);
}

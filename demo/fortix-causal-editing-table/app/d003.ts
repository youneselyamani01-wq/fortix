import finalReceiptFixture from "../data/d003-final-receipt.json" with { type: "json" };
import portableBundleFixture from "../data/d003-portable-evidence-bundle.json" with { type: "json" };
import {
  CANONICAL_EVIDENCE_OBJECTS,
  evidenceTimestampToMasterTime,
  type CanonicalEvidenceObject,
} from "./evidence.ts";
import { clampMasterTime } from "./timeline.ts";

export const FINAL_RECEIPT_ELIGIBILITY_MS = 5_340;
export const FINAL_RECEIPT_CLAIM = "Emergency braking was initiated before impact.";

export const D003_REQUIRED_EVENT_IDS = Object.freeze([
  "d002.candidate-detected",
  "d002.secondary-sensor-confirmation",
  "d002.object-classified",
  "d002.trajectory-prediction",
  "d002.collision-risk-rises",
  "d002.risk-threshold-exceeded",
  "d002.emergency-braking-decision",
  "d002.brake-command",
  "d002.actuator-acknowledgement",
  "d002.physical-deceleration-observed",
  "d002.collision-window-kinematics",
  "d002.collision-window-risk-context",
]);

export type FinalReceiptAvailability =
  | Readonly<{ available: false; reasonCode: "D003_BEFORE_COMPILATION_ELIGIBILITY" | "D003_REQUIRED_EVIDENCE_MISSING"; missingEventIds: readonly string[] }>
  | Readonly<{ available: true; reasonCode: "D003_FINAL_RECEIPT_AVAILABLE"; missingEventIds: readonly []; finalReceipt: typeof finalReceiptFixture; portableBundle: typeof portableBundleFixture }>;

export type BundleMaterialSummary = Readonly<{
  embedded: readonly Readonly<{ label: string; count: number }>[];
  referenced: readonly Readonly<{ label: string; count: number }>[];
  unavailable: readonly Readonly<{ label: string; count: number; note: string }>[];
}>;

export function deriveFinalReceiptAvailability(
  masterTime: number,
  evidenceObjects: readonly CanonicalEvidenceObject[] = CANONICAL_EVIDENCE_OBJECTS,
): FinalReceiptAvailability {
  const clamped = clampMasterTime(masterTime);
  if (clamped < FINAL_RECEIPT_ELIGIBILITY_MS) {
    return {
      available: false,
      reasonCode: "D003_BEFORE_COMPILATION_ELIGIBILITY",
      missingEventIds: [],
    };
  }

  const reachedEventIds = new Set(
    evidenceObjects
      .filter((evidence) => evidenceTimestampToMasterTime(
        evidence.significant_event.event_time,
      ) <= clamped)
      .map((evidence) => evidence.significant_event.event_id),
  );
  const missingEventIds = D003_REQUIRED_EVENT_IDS.filter(
    (eventId) => !reachedEventIds.has(eventId),
  );
  if (missingEventIds.length > 0) {
    return {
      available: false,
      reasonCode: "D003_REQUIRED_EVIDENCE_MISSING",
      missingEventIds,
    };
  }
  return {
    available: true,
    reasonCode: "D003_FINAL_RECEIPT_AVAILABLE",
    missingEventIds: [],
    finalReceipt: finalReceiptFixture,
    portableBundle: portableBundleFixture,
  };
}

export function summarizeBundleMaterials(
  portableBundle: typeof portableBundleFixture = portableBundleFixture,
): BundleMaterialSummary {
  const evidenceObjects = portableBundle.canonical_evidence_objects;
  const targetIds = new Set(portableBundle.verification_manifest.target_evidence_ids);
  const trustIds = new Set([
    ...portableBundle.trust_material.trust_anchor_evidence_ids,
    ...portableBundle.trust_material.trusted_time_evidence_ids,
  ]);
  const nanoReceiptCount = evidenceObjects.filter(
    (evidence) => !targetIds.has(evidence.evidence_id) && !trustIds.has(evidence.evidence_id),
  ).length;
  return {
    embedded: [
      { label: "Final Receipt", count: targetIds.size },
      { label: "Canonical evidence", count: nanoReceiptCount },
      { label: "Causal graph + manifest", count: 1 },
      { label: "Demo trust / time material", count: trustIds.size },
    ],
    referenced: [],
    unavailable: [
      {
        label: "Raw sensor streams",
        count: 0,
        note: "Not asserted by hash and not required by this demo verification profile.",
      },
    ],
  };
}

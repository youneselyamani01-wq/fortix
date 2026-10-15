import { blake3 } from "@noble/hashes/blake3.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

import cycleModelFixture from "../data/d005-operational-cycle.json" with { type: "json" };
import cycleReceiptFixture from "../data/d005-operational-cycle-receipt.json" with { type: "json" };
import cycleBundleFixture from "../data/d005-portable-evidence-bundle.json" with { type: "json" };
import { CANONICAL_MISSION_DURATION_MS } from "./storyTimeline.ts";
import { canonicalString, type CanonicalVerdict } from "./verification.ts";

/** Frozen signed-evidence duration. Experience post-roll is owned by storyTimeline.ts. */
export const OPERATIONAL_CYCLE_DURATION_MS = CANONICAL_MISSION_DURATION_MS;
export const OPERATIONAL_FRAME_MS = 250;

export type TimelineScale = "OVERVIEW" | "MISSION" | "FORENSIC";
export type OperationalVariant =
  | "NORMAL"
  | "MASTER_APPROVED"
  | "HIGH_APPROVED"
  | "HIGH_DENIED"
  | "MISSING_GARAGE_EVIDENCE"
  | "TAMPERED_INVOICE";
export type EventKind = "INTENT" | "POLICY" | "EXECUTION" | "RESULT";

export type OperationalEvent = Readonly<{
  id: string;
  event_id: string;
  time_ms: number;
  mission: string;
  kind: EventKind;
  label_en: string;
  label_fr: string;
  system: string;
  authority_context: string | null;
  causal_parent_ids: readonly string[];
  evidence_id: string;
}>;

export type OperationalMission = Readonly<{
  id: string;
  label_en: string;
  label_fr: string;
  start_ms: number;
  end_ms: number;
  receipt_evidence_id: string | null;
}>;

type CanonicalObject = Readonly<Record<string, unknown>>;

export type OperationalModel = Readonly<{
  schema_version: "1.0";
  profile: "fortix.demo.operational-cycle.v1";
  duration_ms: number;
  scenario_epoch: string;
  events: readonly OperationalEvent[];
  missions: readonly OperationalMission[];
  sub_mission_receipts: readonly CanonicalObject[];
  operational_cycle_receipt_id: string;
  authority_history: readonly CanonicalObject[];
  controlled_variants: Readonly<Record<string, unknown>>;
}>;

export type TimelineWindow = Readonly<{
  startMs: number;
  endMs: number;
  scale: TimelineScale;
  missionId: string | null;
}>;

export type PaymentPath = Readonly<{
  amountEur: 420 | 1850;
  capabilityAvailable: true;
  autonomousAuthority: boolean;
  humanApproval: "NOT_REQUIRED" | "APPROVED" | "DENIED";
  paymentExecuted: boolean;
  reasonCode:
    | "D005_AUTONOMOUS_PAYMENT_AUTHORIZED"
    | "D005M_ACTION_SCOPED_PAYMENT_AUTHORIZED"
    | "D005_HUMAN_APPROVAL_GRANTED"
    | "D005_MANAGER_APPROVAL_DENIED";
}>;

export type CycleVerificationResult = Readonly<{
  verdict: CanonicalVerdict;
  reasonCodes: readonly string[];
  completedChecks: readonly string[];
  receiptId: string | null;
  bundleId: string | null;
}>;

export type DerivedOperationalState = Readonly<{
  masterTime: number;
  timestamp: string;
  progress: number;
  activeMission: OperationalMission;
  activeEvent: OperationalEvent | null;
  reachedEvents: readonly OperationalEvent[];
  reachedReceipts: readonly OperationalMission[];
  cycleReceiptAvailable: boolean;
  reality: Readonly<{ location: string; occupancy: "EMPTY" | "PASSENGER"; vehicleProgress: number }>;
  system: Readonly<{ label: string; participant: string; authority: string }>;
  proof: Readonly<{ nanoReceiptCount: number; subMissionReceiptCount: number }>;
}>;

export const D005_MODEL = Object.freeze(cycleModelFixture as unknown as OperationalModel);
export const D005_CYCLE_RECEIPT = Object.freeze(cycleReceiptFixture);
export const D005_PORTABLE_BUNDLE = Object.freeze(cycleBundleFixture);
export const D005_EVENTS = Object.freeze(D005_MODEL.events);
export const D005_MISSIONS = Object.freeze(D005_MODEL.missions);

export function clampOperationalTime(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(OPERATIONAL_CYCLE_DURATION_MS, Math.max(0, Math.round(value)));
}

export function formatOperationalTime(value: number): string {
  const clamped = clampOperationalTime(value);
  const minutes = Math.floor(clamped / 60_000);
  const seconds = Math.floor((clamped % 60_000) / 1_000);
  const milliseconds = clamped % 1_000;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(milliseconds).padStart(3, "0")}`;
}

export function operationalFrameStep(value: number, direction: -1 | 1): number {
  return clampOperationalTime(value + direction * OPERATIONAL_FRAME_MS);
}

export function activeMissionAt(masterTime: number): OperationalMission {
  const time = clampOperationalTime(masterTime);
  return D005_MISSIONS.find((mission) => time >= mission.start_ms && time <= mission.end_ms)
    ?? [...D005_MISSIONS].reverse().find((mission) => mission.start_ms <= time)
    ?? D005_MISSIONS[0];
}

export function timelineWindowAt(masterTime: number, scale: TimelineScale): TimelineWindow {
  const time = clampOperationalTime(masterTime);
  if (scale === "OVERVIEW") {
    return { startMs: 0, endMs: OPERATIONAL_CYCLE_DURATION_MS, scale, missionId: null };
  }
  const mission = activeMissionAt(time);
  if (scale === "MISSION") {
    return { startMs: mission.start_ms, endMs: mission.end_ms, scale, missionId: mission.id };
  }
  const startMs = Math.max(mission.start_ms, time - 4_000);
  const endMs = Math.min(mission.end_ms, Math.max(time + 4_000, startMs + 1_000));
  return { startMs, endMs, scale, missionId: mission.id };
}

export function timelineEventsInWindow(window: TimelineWindow): readonly OperationalEvent[] {
  return D005_EVENTS.filter((event) => event.time_ms >= window.startMs && event.time_ms <= window.endMs);
}

export function deriveOperationalCycleState(masterTime: number): DerivedOperationalState {
  const time = clampOperationalTime(masterTime);
  const reachedEvents = D005_EVENTS.filter((event) => event.time_ms <= time);
  const activeEvent = reachedEvents.at(-1) ?? null;
  const mission = activeMissionAt(time);
  const missionSpan = Math.max(1, mission.end_ms - mission.start_ms);
  const vehicleProgress = Math.min(1, Math.max(0, (time - mission.start_ms) / missionSpan));
  const dropoffReached = reachedEvents.some((event) => event.id === "dropoff-confirmed");
  const pickupReached = reachedEvents.some((event) => event.id === "pickup-confirmed");
  const reachedReceipts = D005_MISSIONS.filter(
    (candidate) => candidate.receipt_evidence_id !== null && candidate.end_ms <= time,
  );
  return {
    masterTime: time,
    timestamp: formatOperationalTime(time),
    progress: time / OPERATIONAL_CYCLE_DURATION_MS,
    activeMission: mission,
    activeEvent,
    reachedEvents,
    reachedReceipts,
    cycleReceiptAvailable: time >= OPERATIONAL_CYCLE_DURATION_MS,
    reality: {
      location: realityLocation(activeEvent?.id ?? null, mission.id),
      occupancy: pickupReached && !dropoffReached ? "PASSENGER" : "EMPTY",
      vehicleProgress,
    },
    system: {
      label: activeEvent?.label_en ?? "Operational cycle ready",
      participant: activeEvent?.system ?? "Passenger service",
      authority: activeEvent?.authority_context ?? "No authority decision at this event",
    },
    proof: {
      nanoReceiptCount: reachedEvents.length,
      subMissionReceiptCount: reachedReceipts.length,
    },
  };
}

export function paymentPathFor(variant: OperationalVariant): PaymentPath {
  if (variant === "MASTER_APPROVED") {
    return {
      amountEur: 1850,
      capabilityAvailable: true,
      autonomousAuthority: false,
      humanApproval: "APPROVED",
      paymentExecuted: true,
      reasonCode: "D005M_ACTION_SCOPED_PAYMENT_AUTHORIZED",
    };
  }
  if (variant === "HIGH_APPROVED") {
    return {
      amountEur: 1850,
      capabilityAvailable: true,
      autonomousAuthority: false,
      humanApproval: "APPROVED",
      paymentExecuted: true,
      reasonCode: "D005_HUMAN_APPROVAL_GRANTED",
    };
  }
  if (variant === "HIGH_DENIED") {
    return {
      amountEur: 1850,
      capabilityAvailable: true,
      autonomousAuthority: false,
      humanApproval: "DENIED",
      paymentExecuted: false,
      reasonCode: "D005_MANAGER_APPROVAL_DENIED",
    };
  }
  return {
    amountEur: 420,
    capabilityAvailable: true,
    autonomousAuthority: true,
    humanApproval: "NOT_REQUIRED",
    paymentExecuted: true,
    reasonCode: "D005_AUTONOMOUS_PAYMENT_AUTHORIZED",
  };
}

export function resolveMaintenanceAuthorityAtSignedTime(signedTimeMs: number): Readonly<{
  status: "ACTIVE" | "REVOKED" | "UNKNOWN";
  reasonCode: "D005_AUTHORITY_ACTIVE_AT_SIGNED_TIME" | "D005_AUTHORITY_REVOKED_AT_SIGNED_TIME" | "D005_AUTHORITY_UNKNOWN";
}> {
  const records = D005_MODEL.authority_history
    .map((value) => authorityRecord(value))
    .filter((record) => record.effectiveFromMs <= signedTimeMs)
    .sort((left, right) => right.effectiveFromMs - left.effectiveFromMs || left.evidenceId.localeCompare(right.evidenceId));
  const selected = records[0];
  if (selected === undefined) return { status: "UNKNOWN", reasonCode: "D005_AUTHORITY_UNKNOWN" };
  return selected.status === "ACTIVE"
    ? { status: "ACTIVE", reasonCode: "D005_AUTHORITY_ACTIVE_AT_SIGNED_TIME" }
    : { status: "REVOKED", reasonCode: "D005_AUTHORITY_REVOKED_AT_SIGNED_TIME" };
}

export async function verifyOperationalCycle(
  variant: OperationalVariant = "NORMAL",
  portableBundle: unknown = D005_PORTABLE_BUNDLE,
): Promise<CycleVerificationResult> {
  if (variant === "MISSING_GARAGE_EVIDENCE") {
    return verificationResult("INDETERMINATE", ["D005_GARAGE_COMPLETION_EVIDENCE_MISSING"], ["receipt_integrity", "sub_receipt_binding"]);
  }
  const bundle = deepClone(portableBundle) as Record<string, unknown>;
  if (variant === "TAMPERED_INVOICE") tamperInvoiceAmount(bundle);
  try {
    const manifest = object(bundle.bundle_manifest);
    const integrity = object(bundle.integrity_manifest);
    const objects = array(bundle.canonical_evidence_objects).map(object);
    const verificationManifest = object(bundle.verification_manifest);
    const claimedDigest = text(integrity.bundle_digest);
    const digestProbe = deepClone(bundle) as Record<string, unknown>;
    object(digestProbe.integrity_manifest).bundle_digest = "";
    if (digestCanonical(digestProbe) !== claimedDigest) {
      return verificationResult("INVALID", ["BUNDLE_DIGEST_MISMATCH"], []);
    }
    const targetIds = array(verificationManifest.target_evidence_ids).map(text);
    if (targetIds.length !== 1 || targetIds[0] !== D005_MODEL.operational_cycle_receipt_id) {
      return verificationResult("INVALID", ["D005_OPERATIONAL_CYCLE_TARGET_INVALID"], ["bundle_integrity"]);
    }
    const evidenceById = new Map(objects.map((evidence) => [text(evidence.evidence_id), evidence]));
    const receipt = evidenceById.get(targetIds[0]);
    if (receipt === undefined) {
      return verificationResult("INDETERMINATE", ["D005_OPERATIONAL_CYCLE_RECEIPT_MISSING"], ["bundle_integrity"]);
    }
    const resultPayload = object(object(receipt.evidence_payload).result);
    const lowerIds = array(resultPayload.causal_input_receipt_ids).map(text);
    if (lowerIds.length !== 5 || lowerIds.some((id) => !evidenceById.has(id))) {
      return verificationResult("INDETERMINATE", ["D005_SUB_MISSION_RECEIPT_MISSING"], ["bundle_integrity", "cycle_receipt"]);
    }
    if (digestCanonical(lowerIds) !== text(resultPayload.lower_receipt_set_digest)) {
      return verificationResult("INVALID", ["D005_LOWER_RECEIPT_SET_DIGEST_MISMATCH"], ["bundle_integrity", "cycle_receipt"]);
    }
    const authority = resolveMaintenanceAuthorityAtSignedTime(78_000);
    if (authority.status !== "ACTIVE") {
      return verificationResult("REVOKED", [authority.reasonCode], ["bundle_integrity", "cycle_receipt", "sub_receipt_binding"]);
    }
    if (variant === "HIGH_DENIED") {
      const path = paymentPathFor(variant);
      if (path.paymentExecuted) {
        return verificationResult("INVALID", ["D005_DENY_NOT_TERMINAL"], ["bundle_integrity", "cycle_receipt", "authority_at_signed_time"]);
      }
    }
    return {
      verdict: "INDETERMINATE",
      reasonCodes: ["D005_PRODUCTION_TRUST_TIME_INCOMPLETE"],
      completedChecks: ["bundle_integrity", "cycle_receipt", "sub_receipt_binding", "explicit_causality", "authority_at_signed_time", "provider_continuity"],
      receiptId: targetIds[0],
      bundleId: text(manifest.bundle_id),
    };
  } catch {
    return verificationResult("INVALID", ["D005_BUNDLE_SCHEMA_INVALID"], []);
  }
}

export function createTamperedOperationalBundle(): unknown {
  const clone = deepClone(D005_PORTABLE_BUNDLE) as Record<string, unknown>;
  tamperInvoiceAmount(clone);
  return clone;
}

function verificationResult(
  verdict: CanonicalVerdict,
  reasonCodes: readonly string[],
  completedChecks: readonly string[],
): CycleVerificationResult {
  return { verdict, reasonCodes, completedChecks, receiptId: D005_MODEL.operational_cycle_receipt_id, bundleId: null };
}

function realityLocation(eventId: string | null, missionId: string): string {
  if (eventId === "base-arrival") return "Assigned base · parked";
  if (missionId === "maintenance") return "Independent garage";
  if (missionId === "payment" || missionId === "accountability") return "Garage release bay";
  if (missionId === "return") return "Return route";
  if (eventId === "pickup-confirmed" || eventId === "journey-executed") return "Passenger route";
  if (missionId === "traffic") return "Route to garage";
  return "Pickup zone";
}

function authorityRecord(value: CanonicalObject): Readonly<{ evidenceId: string; effectiveFromMs: number; status: "ACTIVE" | "REVOKED" }> {
  const payload = object(object(value.evidence_payload).policy_authority_status);
  const effective = Date.parse(text(payload.effective_from));
  const epoch = Date.parse(D005_MODEL.scenario_epoch);
  const status = text(payload.authority_status);
  if (status !== "ACTIVE" && status !== "REVOKED") throw new TypeError("unsupported D-005 authority status");
  return { evidenceId: text(value.evidence_id), effectiveFromMs: effective - epoch, status };
}

function tamperInvoiceAmount(bundle: Record<string, unknown>): void {
  const invoice = array(bundle.canonical_evidence_objects)
    .map(object)
    .find((evidence) => text(object(evidence.significant_event).event_id) === "d005.invoice-received");
  if (invoice === undefined) throw new TypeError("D-005 invoice evidence missing");
  const result = object(object(invoice.evidence_payload).result);
  object(result.details).amount_eur = 1850;
}

function digestCanonical(value: unknown): string {
  return bytesToHex(blake3(utf8ToBytes(canonicalString(value))));
}

function deepClone(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

function object(value: unknown): Record<string, unknown> {
  if (value === null || Array.isArray(value) || typeof value !== "object") throw new TypeError("object required");
  return value as Record<string, unknown>;
}

function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new TypeError("array required");
  return value;
}

function text(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) throw new TypeError("text required");
  return value;
}

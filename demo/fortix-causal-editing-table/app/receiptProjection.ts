import {
  MASTER_STORY_MOMENTS,
} from "./masterStory.ts";
import { MISSION_EVIDENCE_SPECS } from "./missionEvidence.ts";
import {
  PortableMissionEvidenceError,
  finalReceiptMember,
  type EvidenceMemberRef,
  type FinalMissionReceipt,
  type MissionEvidenceClosure,
} from "./portableMissionEvidence.ts";
import type { ReceiptKind, VisualEvent } from "./visualEvents.ts";

export type ReceiptBinding = Readonly<{
  visualEventId: string;
  significantEventId: string;
  receiptId: string;
  evidenceId: string;
  leafId: string;
  producerDomain: string;
  receiptKind: ReceiptKind;
  /** The exact evidence object and significant event the flight terminates at. */
  targetEvidenceId: string;
  targetEventId: string;
  timeMs: number;
}>;

/**
 * Resolves one presentation beat to the exact evidence object it attests.
 * Runtime records use their explicit `visualEventId`; signed records are
 * eligible only when the visual event is the canonical master moment itself.
 * A visual consequence may never borrow the source moment's signed object.
 */
export function receiptBindingForVisualEvent(
  closure: MissionEvidenceClosure,
  event: VisualEvent,
): ReceiptBinding | null {
  const runtimeSpec = MISSION_EVIDENCE_SPECS.find((spec) => spec.visualEventId === event.id);
  if (runtimeSpec !== undefined) {
    const member = closure.members.find((candidate) => (
      candidate.source === "RUNTIME_JOURNAL"
      && candidate.eventId === runtimeSpec.eventId
      && candidate.receiptId === runtimeSpec.receiptId
    ));
    return member === undefined ? null : binding(event.id, member);
  }

  if (event.signedEventId !== undefined) {
    // NX0: a beat may name the exact signed object it IS. Exactness is kept —
    // the presented member must carry that event id at this very time — so
    // this is not the borrowing the rule below refuses.
    const member = closure.members.find((candidate) => (
      candidate.source === "SIGNED_CANONICAL"
      && candidate.presentation === "PRESENTED"
      && candidate.eventId === event.signedEventId
      && candidate.timeMs === event.timeMs
    ));
    return member === undefined ? null : binding(event.id, member);
  }

  if (event.relation !== "CANONICAL_MISSION_EVENT") return null;
  const moment = MASTER_STORY_MOMENTS.find((candidate) => candidate.id === event.sourceMomentId);
  if (moment?.evidenceEventId === null || moment?.evidenceEventId === undefined) return null;
  const member = closure.members.find((candidate) => (
    candidate.source === "SIGNED_CANONICAL"
    && candidate.presentation === "PRESENTED"
    && candidate.eventId === moment.evidenceEventId
    && candidate.timeMs === event.timeMs
  ));
  return member === undefined ? null : binding(event.id, member);
}

export function projectReceiptBindings(
  closure: MissionEvidenceClosure,
  events: readonly VisualEvent[],
): readonly ReceiptBinding[] {
  return Object.freeze(events.flatMap((event) => {
    const projected = receiptBindingForVisualEvent(closure, event);
    return projected === null ? [] : [projected];
  }));
}

export function requireReceiptBinding(
  closure: MissionEvidenceClosure,
  event: VisualEvent,
): ReceiptBinding {
  const projected = receiptBindingForVisualEvent(closure, event);
  if (projected === null) {
    throw new PortableMissionEvidenceError(
      "RECEIPT_EVIDENCE_NOT_FOUND",
      `visual event ${event.id} has no exact evidence object and may not emit a nano-receipt`,
    );
  }
  return projected;
}

export function finalReceiptBinding(receipt: FinalMissionReceipt): ReceiptBinding {
  return binding("final-receipt", finalReceiptMember(receipt));
}

function binding(visualEventId: string, member: EvidenceMemberRef): ReceiptBinding {
  return Object.freeze({
    visualEventId,
    significantEventId: member.eventId,
    receiptId: member.receiptId,
    evidenceId: member.evidenceId,
    leafId: leafIdFor(member),
    producerDomain: member.producerDomain,
    receiptKind: receiptKindForMember(member),
    targetEvidenceId: member.evidenceId,
    targetEventId: member.eventId,
    timeMs: member.timeMs,
  });
}

const RECEIPT_KIND_BY_PRODUCER: Readonly<Record<string, ReceiptKind>> = Object.freeze({
  "Passenger service": "mission",
  "Taxi autonomy": "vehicle",
  "Traffic Provider": "infrastructure",
  "Navigation Provider A": "service",
  "Navigation Provider B": "service",
  "Fleet operations": "service",
  Garage: "service",
  "Maintenance system": "service",
  "Payment policy": "financial",
  "Human approver": "human",
  "Authority governance": "human",
  "Manager workflow": "human",
  "Payment Provider": "financial",
  "FortiX causal compiler": "mission",
  SMART_CITY_INFRASTRUCTURE: "infrastructure",
  AUTONOMOUS_VEHICLE: "vehicle",
  ROUTING_ORCHESTRATOR: "service",
  PAYMENT_PROVIDER: "financial",
  FINANCIAL_INSTITUTION: "financial",
  NETWORK: "infrastructure",
  HUMAN_APPROVER: "human",
  "fortix.demo.manager-authority.d005m": "human",
  "fortix.demo.causal-compiler.d005m": "mission",
});

/** The evidence family a canonical producer's objects belong to, or null. */
export function receiptFamilyForProducer(producerDomain: string): ReceiptKind | null {
  return RECEIPT_KIND_BY_PRODUCER[producerDomain] ?? null;
}

function receiptKindForMember(member: EvidenceMemberRef): ReceiptKind {
  if (member.source === "D006_FINAL_RECEIPT") return "mission";
  const kind = RECEIPT_KIND_BY_PRODUCER[member.producerDomain];
  if (kind === undefined) {
    throw new PortableMissionEvidenceError(
      "RECEIPT_PRODUCER_KIND_UNKNOWN",
      `canonical producer ${member.producerDomain} has no receipt family projection`,
    );
  }
  return kind;
}

function leafIdFor(member: EvidenceMemberRef): string {
  if (member.source === "SIGNED_CANONICAL") return `signed:${member.eventId}`;
  if (member.source === "D006_FINAL_RECEIPT") return `final:${member.eventId}`;
  return `runtime:${member.eventId}`;
}

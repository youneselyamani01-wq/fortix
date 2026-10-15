import { MASTER_EVIDENCE_EVENTS } from "../../masterStory.ts";
import type { EventKind } from "../../operationalCycle.ts";
import type { EvidenceMemberRef } from "../../portableMissionEvidence.ts";

/**
 * NX1 B R2 §8 — the ACTION / EVIDENCE FAMILY of a nano-receipt.
 *
 * A second visual variable, independent of provenance: what KIND of thing
 * the evidence attests — a perception, an intent, a decision, an
 * authorization, an action, a result, a network lifecycle record. It is
 * derived from canonical type information only:
 *
 *   - signed canonical objects carry the D-005 / D-005M event `kind`
 *     (INTENT · POLICY · EXECUTION · RESULT), read from the master evidence
 *     model by event id;
 *   - runtime journal records carry the journal `eventType`.
 *
 * No receipt is classified by hand, by name or by producer; a type the
 * tables do not name is reported as UNCLASSIFIED, never guessed. The mapping
 * is identical in every language: the dictionaries only phrase it.
 */

export type ActionFamily =
  | "perception"
  | "intent"
  | "decision"
  | "authorization"
  | "action"
  | "result"
  | "network"
  | "unclassified";

/** Canonical order: the way a story reads, then the lifecycle, then the fallback. */
export const ACTION_FAMILY_ORDER: readonly ActionFamily[] = Object.freeze([
  "perception", "intent", "decision", "authorization", "action", "result", "network", "unclassified",
]);

/** Runtime journal records, by the journal's own event type. */
const FAMILY_BY_RUNTIME_EVENT_TYPE: Readonly<Record<string, ActionFamily>> = Object.freeze({
  VEHICLE_OBSERVATION: "perception",
  CITY_SENSOR_DETECTION: "perception",
  AUTONOMOUS_DECISION: "decision",
  SIGNAL_PHASE_DECIDED: "decision",
  ROUTING_PROVENANCE_RECORDED: "decision",
  HUMAN_AUTHORITY_DECISION: "authorization",
  BANK_AUTHORIZATION_DECISION: "authorization",
  VEHICLE_ACTION: "action",
  SIGNAL_STATE_PUBLISHED: "action",
  PAYMENT_INSTRUCTION_PRESENTED: "action",
  VEHICLE_RESULT: "result",
  BANK_CONFIRMATION_RETURNED: "result",
  NETWORK_LINK_LOST: "network",
  NETWORK_LINK_RESTORED: "network",
  MISSION_COMPLETED_OFFLINE: "network",
  RECONCILIATION_RECEIPT: "network",
});

/** Signed canonical objects, by the canonical event kind of the operational model. */
const FAMILY_BY_CANONICAL_KIND: Readonly<Record<EventKind, ActionFamily>> = Object.freeze({
  INTENT: "intent",
  POLICY: "authorization",
  EXECUTION: "action",
  RESULT: "result",
});

const CANONICAL_KIND_BY_EVENT_ID: ReadonlyMap<string, EventKind> = new Map(
  MASTER_EVIDENCE_EVENTS.map((event) => [event.event_id, event.kind] as const),
);

/** The canonical event kind of a signed object, or null when the model does not name it. */
export function canonicalKindOf(eventId: string): EventKind | null {
  return CANONICAL_KIND_BY_EVENT_ID.get(eventId) ?? null;
}

export function actionFamilyOf(input: Readonly<{ source: EvidenceMemberRef["source"]; eventId: string; eventType: string }>): ActionFamily {
  if (input.source === "SIGNED_CANONICAL") {
    const kind = canonicalKindOf(input.eventId);
    return kind === null ? "unclassified" : FAMILY_BY_CANONICAL_KIND[kind];
  }
  if (input.source === "RUNTIME_JOURNAL") return FAMILY_BY_RUNTIME_EVENT_TYPE[input.eventType] ?? "unclassified";
  return "unclassified";
}

/** The families a set of evidence actually contains, in canonical order. */
export function familiesPresent(items: readonly Readonly<{ actionFamily: ActionFamily }>[]): readonly ActionFamily[] {
  const present = new Set(items.map((entry) => entry.actionFamily));
  return ACTION_FAMILY_ORDER.filter((family) => present.has(family));
}

import { causalEvent } from "./eventSources.ts";
import type { MissionEvidenceClosure } from "./portableMissionEvidence.ts";
import type { FinalMissionReceipt } from "./portableMissionEvidence.ts";
import type { ReceiptBinding } from "./receiptProjection.ts";
import type { OfflineCausalRecord, OfflineEvidenceSession } from "./offlineEvidence.ts";
import type { HumanDecision } from "./reviewFlow.ts";

/**
 * D-006 C3 — the public fact layer.
 *
 * FACT, CLAIM and VERDICT are three different things and stay separate here:
 *
 *   FACT     what the mission/world records as having happened. This module.
 *   CLAIM    what a receipt asserts on the strength of evidence. The PEB.
 *   VERDICT  what independent verification concludes. The verifier.
 *
 * NO FACT WITHOUT AN OBSERVABLE EVENT; NO CLAIM WITHOUT EVIDENCE. A public
 * fact therefore exists only as a projection over the causal register, the
 * receipt bindings of the ACTUAL evidence closure, and the append-only run
 * journal. There is no fact whose only backing is UI copy, and a fact whose
 * evidence cannot be resolved is refused SUPPORT rather than asserted —
 * tests in d006c3-public-facts enforce both directions.
 *
 * NX0 — EVIDENCE COMPLETENESS. The C3 vocabulary had two silent gaps that the
 * NX0 audit measured on a built journal: "mission accepted" could never be
 * supported (its signed object had no projection path), and because parents
 * gate children, boarding, exit, congestion and rerouting were never SUPPORTED
 * either — the public record was quietly omitting the passenger. Facts now
 * resolve through exact records (`RUNTIME_RECORD`), exact signed objects
 * (`SIGNED_EVENT`) and the offline window (`OFFLINE_CONTINUATION`), and every
 * fact is time-gated so a scrub backwards removes what had not yet occurred
 * and a scrub forwards restores it in the original order (mandate §42).
 */

export type PublicFactSection =
  | "mission"
  | "road"
  | "passenger"
  | "route"
  | "network"
  | "garage"
  | "payment"
  | "evidence";

export type PublicFactStatus =
  /** The event occurred and its evidence resolves. */
  | "SUPPORTED"
  /** The event has not occurred (yet) in this run. Not an error. */
  | "NOT_OCCURRED"
  /**
   * Deliberately never supported: the evidence set cannot demonstrate it.
   * Stated so its absence is a visible boundary rather than an omission.
   */
  | "NOT_DEMONSTRATED";

export type FactEvidenceRule =
  /** Resolved through the closure's receipt bindings for one visual event. */
  | Readonly<{ kind: "VISUAL_BINDING"; visualEventId: string }>
  /** Resolved from run-journal records of one event type. Live: no schedule. */
  | Readonly<{ kind: "RUNTIME_EVENT"; eventType: string }>
  /** Resolved from exactly one run-journal record, by its event id. */
  | Readonly<{ kind: "RUNTIME_RECORD"; eventId: string }>
  /** Resolved from exactly one PRESENTED signed object of the closure. */
  | Readonly<{ kind: "SIGNED_EVENT"; eventId: string }>
  /**
   * Resolved from the offline window: a LOST receipt followed by presented
   * evidence dated inside the window. Nothing between LOST and the next
   * event means nothing continued — and the fact says so.
   */
  | Readonly<{ kind: "OFFLINE_CONTINUATION" }>
  /** The issued D-006 Final Receipt itself. */
  | Readonly<{ kind: "FINAL_RECEIPT" }>
  /** Nothing in this evidence set may support it. Permanent boundary. */
  | Readonly<{ kind: "UNDEMONSTRABLE" }>;

export type PublicFactDefinition = Readonly<{
  factId: string;
  section: PublicFactSection;
  /** The causal register row whose occurrence this fact reports. */
  registerEventId: string | null;
  rule: FactEvidenceRule;
  /** Facts that must be SUPPORTED before this one may be. */
  causalParentFactIds: readonly string[];
}>;

export type PublicFact = Readonly<{
  factId: string;
  section: PublicFactSection;
  registerEventId: string | null;
  status: PublicFactStatus;
  evidenceIds: readonly string[];
  causalParentFactIds: readonly string[];
  /** Mission moment the supporting evidence is dated at; null until supported. */
  occurredAtMs: number | null;
}>;

const fact = (
  factId: string,
  section: PublicFactSection,
  registerEventId: string | null,
  rule: FactEvidenceRule,
  causalParentFactIds: readonly string[] = [],
): PublicFactDefinition => Object.freeze({
  factId,
  section,
  registerEventId,
  rule,
  causalParentFactIds: Object.freeze([...causalParentFactIds]),
});

/**
 * The complete public fact vocabulary, in mission-record order. Every entry
 * that names a register event is cross-checked against the register at module
 * load; a typo fails immediately rather than rendering an unbacked fact.
 */
export const PUBLIC_FACT_DEFINITIONS: readonly PublicFactDefinition[] = Object.freeze([
  fact("fact.mission.requested", "mission", "mission-request", { kind: "VISUAL_BINDING", visualEventId: "request" }),
  fact("fact.mission.accepted", "mission", "mission-accepted", { kind: "VISUAL_BINDING", visualEventId: "accept" }, ["fact.mission.requested"]),
  fact("fact.mission.departed", "mission", "base-departure", { kind: "RUNTIME_RECORD", eventId: "d006nx0.action:depart-base" }, ["fact.mission.accepted"]),
  fact("fact.road.signal", "road", "traffic-light-state", { kind: "RUNTIME_EVENT", eventType: "SIGNAL_STATE_PUBLISHED" }),
  fact("fact.road.observed", "road", "taxi-perception", { kind: "RUNTIME_RECORD", eventId: "d006g.perception:yellow" }, ["fact.road.signal"]),
  fact("fact.road.braked", "road", "taxi-braking", { kind: "RUNTIME_RECORD", eventId: "d006g.action:brake" }, ["fact.road.observed"]),
  fact("fact.road.stopped", "road", "vehicle-at-rest", { kind: "RUNTIME_RECORD", eventId: "d006g.result:at-rest" }, ["fact.road.braked"]),
  fact("fact.road.resumed", "road", "vehicle-resume", { kind: "RUNTIME_RECORD", eventId: "d006g.action:resume" }, ["fact.road.stopped"]),
  fact("fact.passenger.boarded", "passenger", "passenger-boarding", { kind: "VISUAL_BINDING", visualEventId: "pickup" }, ["fact.mission.departed"]),
  fact("fact.passenger.journey", "passenger", "passenger-journey", { kind: "SIGNED_EVENT", eventId: "d005.journey-executed" }, ["fact.passenger.boarded"]),
  fact("fact.passenger.exited", "passenger", "passenger-exit", { kind: "VISUAL_BINDING", visualEventId: "dropoff" }, ["fact.passenger.journey"]),
  fact("fact.route.congestion", "route", "hazard-perception", { kind: "VISUAL_BINDING", visualEventId: "obstacle" }),
  fact("fact.route.stopped", "route", "hazard-stop", { kind: "RUNTIME_RECORD", eventId: "d006nx0.result:hazard-stop" }, ["fact.route.congestion"]),
  fact("fact.route.rerouted", "route", "reroute-execution", { kind: "RUNTIME_RECORD", eventId: "d006nx0.action:reroute" }, ["fact.route.stopped"]),
  fact("fact.network.lost", "network", "network-loss", { kind: "RUNTIME_EVENT", eventType: "NETWORK_LINK_LOST" }),
  fact("fact.network.continuedOffline", "network", "offline-continuation", { kind: "OFFLINE_CONTINUATION" }, ["fact.network.lost"]),
  fact("fact.network.restored", "network", "network-restoration", { kind: "RUNTIME_EVENT", eventType: "NETWORK_LINK_RESTORED" }, ["fact.network.lost"]),
  fact("fact.network.reconciled", "network", "reconciliation", { kind: "RUNTIME_EVENT", eventType: "RECONCILIATION_RECEIPT" }, ["fact.network.restored"]),
  fact("fact.garage.authorized", "garage", "garage-authorization", { kind: "VISUAL_BINDING", visualEventId: "maintenance" }),
  fact("fact.garage.started", "garage", "maintenance-start", { kind: "VISUAL_BINDING", visualEventId: "work-begins" }, ["fact.garage.authorized"]),
  fact("fact.garage.completed", "garage", "maintenance-complete", { kind: "VISUAL_BINDING", visualEventId: "work" }, ["fact.garage.started"]),
  fact("fact.payment.invoiced", "payment", "invoice", { kind: "VISUAL_BINDING", visualEventId: "invoice" }, ["fact.garage.completed"]),
  fact("fact.payment.thresholdExceeded", "payment", "payment-threshold", { kind: "VISUAL_BINDING", visualEventId: "policy-exceeded" }, ["fact.payment.invoiced"]),
  fact("fact.payment.humanApproved", "payment", "human-payment-approval", { kind: "VISUAL_BINDING", visualEventId: "human" }, ["fact.payment.thresholdExceeded"]),
  fact("fact.payment.humanDenied", "payment", "human-payment-denial", { kind: "RUNTIME_RECORD", eventId: "d006nx0.human-decision:denied" }, ["fact.payment.thresholdExceeded"]),
  fact("fact.payment.authorized", "payment", "payment-authorization", { kind: "VISUAL_BINDING", visualEventId: "authorized" }, ["fact.payment.humanApproved"]),
  fact("fact.payment.submitted", "payment", "payment-submission", { kind: "RUNTIME_RECORD", eventId: "d006g.payment-instruction-presented" }, ["fact.payment.authorized"]),
  fact("fact.payment.bankAuthorized", "payment", "payment-result", { kind: "RUNTIME_RECORD", eventId: "d006g.bank-authorization" }, ["fact.payment.submitted"]),
  fact("fact.payment.settlement", "payment", null, { kind: "UNDEMONSTRABLE" }, ["fact.payment.bankAuthorized"]),
  fact("fact.mission.returned", "mission", "return-to-base", { kind: "VISUAL_BINDING", visualEventId: "return-executed" }, ["fact.payment.humanApproved"]),
  fact("fact.mission.completed", "mission", "mission-complete", { kind: "VISUAL_BINDING", visualEventId: "complete" }, ["fact.mission.returned"]),
  fact("fact.evidence.finalReceipt", "evidence", "final-receipt", { kind: "FINAL_RECEIPT" }, ["fact.mission.completed"]),
]);

for (const definition of PUBLIC_FACT_DEFINITIONS) {
  // Fails the module load on an unregistered event id — a fact may not point
  // at a causal event that does not exist.
  if (definition.registerEventId !== null) causalEvent(definition.registerEventId);
}

export function publicFactDefinition(factId: string): PublicFactDefinition {
  const definition = PUBLIC_FACT_DEFINITIONS.find((candidate) => candidate.factId === factId);
  if (definition === undefined) throw new TypeError(`Unknown public fact: ${factId}`);
  return definition;
}

export type PublicFactInput = Readonly<{
  /** Causally gated story time; never the raw playhead. */
  effectiveStoryTimeMs: number;
  closure: MissionEvidenceClosure | null;
  receiptBindings: readonly ReceiptBinding[];
  session: OfflineEvidenceSession;
  finalReceipt: FinalMissionReceipt | null;
  humanDecision: HumanDecision;
}>;

/** When a runtime record HAPPENED on the mission clock (see proofProjection). */
export function runtimeRecordTime(record: OfflineCausalRecord): number {
  const observed = record.payload.observed_master_time_ms;
  return typeof observed === "number" && Number.isFinite(observed)
    ? observed
    : record.missionClockPosition;
}

/**
 * Projects the current public facts. Pure and deterministic: the same inputs
 * always yield the same fact record, so seek/replay cannot mint or lose one.
 *
 * A fact is SUPPORTED only when its observable event has occurred AND its
 * evidence resolves in the actual closure/journal. Reaching a timestamp alone
 * supports nothing: visual-bound facts resolve through the closure's receipt
 * bindings, runtime facts require a real journal record, and live facts
 * (network, reconciliation) can therefore never be supported by the clock.
 * Conversely evidence alone does not support a fact the clock has not
 * reached: a scrub backwards hides it again, exactly as the Proof Tree does.
 */
export function deriveMissionFacts(input: PublicFactInput): readonly PublicFact[] {
  const bindingByVisualEvent = new Map(
    input.receiptBindings.map((binding) => [binding.visualEventId, binding]),
  );
  const supported = new Set<string>();
  const resolved = PUBLIC_FACT_DEFINITIONS.map((definition) => {
    const projection = resolveRule(definition, input, bindingByVisualEvent);
    const parentsSupported = definition.causalParentFactIds.every((id) => supported.has(id));
    const status: PublicFactStatus = projection.status === "SUPPORTED" && !parentsSupported
      ? "NOT_OCCURRED"
      : projection.status;
    if (status === "SUPPORTED") supported.add(definition.factId);
    return Object.freeze({
      factId: definition.factId,
      section: definition.section,
      registerEventId: definition.registerEventId,
      status,
      evidenceIds: status === "SUPPORTED" ? projection.evidenceIds : Object.freeze([]),
      causalParentFactIds: definition.causalParentFactIds,
      occurredAtMs: status === "SUPPORTED" ? projection.occurredAtMs : null,
    });
  });
  return Object.freeze(resolved);
}

type RuleProjection = Readonly<{
  status: PublicFactStatus;
  evidenceIds: readonly string[];
  occurredAtMs: number | null;
}>;

const NONE: readonly string[] = Object.freeze([]);
const notOccurred: RuleProjection = Object.freeze({ status: "NOT_OCCURRED", evidenceIds: NONE, occurredAtMs: null });

function supportedBy(evidenceIds: readonly string[], occurredAtMs: number): RuleProjection {
  return Object.freeze({ status: "SUPPORTED", evidenceIds: Object.freeze([...evidenceIds]), occurredAtMs });
}

function resolveRule(
  definition: PublicFactDefinition,
  input: PublicFactInput,
  bindingByVisualEvent: ReadonlyMap<string, ReceiptBinding>,
): RuleProjection {
  const now = input.effectiveStoryTimeMs;
  switch (definition.rule.kind) {
    case "VISUAL_BINDING": {
      const binding = bindingByVisualEvent.get(definition.rule.visualEventId);
      if (binding === undefined) return notOccurred;
      if (now < binding.timeMs) return notOccurred;
      // The human gate is causal: the binding time can only be reached after
      // an explicit ALLOW released the clamp, but the fact double-checks the
      // decision so a seek can never assert an approval nobody gave.
      if (definition.factId === "fact.payment.humanApproved" && input.humanDecision !== "APPROVED") {
        return notOccurred;
      }
      return supportedBy([binding.evidenceId], binding.timeMs);
    }
    case "RUNTIME_EVENT": {
      const eventType = definition.rule.eventType;
      const records = input.session.records
        .filter((record) => record.eventType === eventType && runtimeRecordTime(record) <= now);
      if (records.length === 0) return notOccurred;
      return supportedBy(records.map((record) => record.receiptId), runtimeRecordTime(records[0]!));
    }
    case "RUNTIME_RECORD": {
      const eventId = definition.rule.eventId;
      const record = input.session.records.find((candidate) => candidate.eventId === eventId);
      if (record === undefined || runtimeRecordTime(record) > now) return notOccurred;
      return supportedBy([record.receiptId], runtimeRecordTime(record));
    }
    case "SIGNED_EVENT": {
      const eventId = definition.rule.eventId;
      const member = input.closure?.members.find((candidate) => (
        candidate.source === "SIGNED_CANONICAL"
        && candidate.presentation === "PRESENTED"
        && candidate.eventId === eventId
      ));
      if (member === undefined || member.timeMs > now) return notOccurred;
      return supportedBy([member.evidenceId], member.timeMs);
    }
    case "OFFLINE_CONTINUATION": {
      const continuation = offlineContinuation(input);
      return continuation === null ? notOccurred : continuation;
    }
    case "FINAL_RECEIPT": {
      if (input.finalReceipt === null || input.closure === null) return notOccurred;
      if (now < input.finalReceipt.issuedAtMasterTimeMs) return notOccurred;
      return supportedBy([input.finalReceipt.receiptId], input.finalReceipt.issuedAtMasterTimeMs);
    }
    case "UNDEMONSTRABLE":
      return Object.freeze({ status: "NOT_DEMONSTRATED", evidenceIds: NONE, occurredAtMs: null });
  }
}

/**
 * "The mission continued while offline" is a claim about the window between
 * NR-NET-LOST and NR-NET-RESTORED (or now, while the cable is still out).
 * It is supported by the first presented evidence dated INSIDE that window —
 * a signed mission object the story reached, or a runtime record the journal
 * accepted — and by nothing else. A cable pulled and replaced with no event
 * in between continued nothing, and the fact stays NOT_OCCURRED.
 */
function offlineContinuation(input: PublicFactInput): RuleProjection | null {
  const now = input.effectiveStoryTimeMs;
  const lost = input.session.records
    .filter((record) => record.eventType === "NETWORK_LINK_LOST" && runtimeRecordTime(record) <= now)
    .at(-1);
  if (lost === undefined) return null;
  const lostAt = runtimeRecordTime(lost);
  const restored = input.session.records.find((record) => (
    record.eventType === "NETWORK_LINK_RESTORED"
    && record.missionClockPosition > lost.missionClockPosition
  ));
  const windowEnd = Math.min(now, restored === undefined ? now : runtimeRecordTime(restored));
  const inWindow = (timeMs: number) => timeMs > lostAt && timeMs <= windowEnd;
  const runtime = input.session.records.find((record) => (
    record.eventType !== "NETWORK_LINK_LOST"
    && record.eventType !== "NETWORK_LINK_RESTORED"
    // A reconciliation receipt is evidence lifecycle, never mission work: one
    // dated at the restoration continued nothing (D-006, 2026-10-08).
    && record.eventType !== "RECONCILIATION_RECEIPT"
    && record.missionClockPosition > lost.missionClockPosition
    && inWindow(runtimeRecordTime(record))
  ));
  const signed = input.closure?.members.find((member) => (
    member.presentation === "PRESENTED" && member.source === "SIGNED_CANONICAL" && inWindow(member.timeMs)
  ));
  const continued = runtime === undefined
    ? (signed === undefined ? null : { evidenceId: signed.evidenceId, at: signed.timeMs })
    : { evidenceId: runtime.receiptId, at: runtimeRecordTime(runtime) };
  if (continued === null) return null;
  return supportedBy([lost.receiptId, continued.evidenceId], continued.at);
}

/** The mission-record view: facts grouped in stable section order. */
export const PUBLIC_FACT_SECTION_ORDER: readonly PublicFactSection[] = Object.freeze([
  "mission", "road", "passenger", "route", "garage", "payment", "network", "evidence",
]);

export function factsBySection(
  facts: readonly PublicFact[],
): ReadonlyMap<PublicFactSection, readonly PublicFact[]> {
  const grouped = new Map<PublicFactSection, PublicFact[]>();
  for (const section of PUBLIC_FACT_SECTION_ORDER) grouped.set(section, []);
  for (const entry of facts) grouped.get(entry.section)!.push(entry);
  return grouped;
}

/**
 * D-006 C3 §21 — the verifier inspects FACTS, and cryptography explains HOW.
 *
 * The FACT/CLAIM/VERDICT separation, applied: a fact the mission recorded may
 * still be OUTSIDE what the portable artifact carries (authored after the
 * Final Receipt seal, for example). The inspection says so instead of
 * borrowing the mission's word for it — coverage is computed against the
 * exact transferred evidence set, and "VERIFIED" additionally requires the
 * analysis to have found the evidence intact.
 */
export type FactInspectionStatus =
  /** In the record, inside verified coverage, evidence intact. */
  | "VERIFIED"
  /** In the record, but its evidence is not inside this artifact. */
  | "NOT_COVERED"
  /** Stated boundary: nothing in the evidence set can demonstrate it. */
  | "NOT_DEMONSTRATED"
  /** Not part of this mission record at all. */
  | "NOT_PRESENTED"
  /** The analysis could not certify the evidence, so no fact is certified. */
  | "NOT_VERIFIED";

export type FactInspection = Readonly<{
  factId: string;
  section: PublicFactSection;
  status: FactInspectionStatus;
  evidenceIds: readonly string[];
}>;

export function inspectFactsAgainstCoverage(
  facts: readonly PublicFact[],
  coverageEvidenceIds: ReadonlySet<string>,
  evidenceIntact: boolean,
): readonly FactInspection[] {
  return Object.freeze(facts.map((entry) => {
    let status: FactInspectionStatus;
    if (entry.status === "NOT_DEMONSTRATED") status = "NOT_DEMONSTRATED";
    else if (entry.status === "NOT_OCCURRED") status = "NOT_PRESENTED";
    else if (!evidenceIntact) status = "NOT_VERIFIED";
    else if (entry.evidenceIds.every((id) => coverageEvidenceIds.has(id))) status = "VERIFIED";
    else status = "NOT_COVERED";
    return Object.freeze({
      factId: entry.factId,
      section: entry.section,
      status,
      evidenceIds: entry.evidenceIds,
    });
  }));
}

import {
  appendMissionEvidence,
  type JsonValue,
  type OfflineEvidenceSession,
} from "./offlineEvidence.ts";
import {
  CANONICAL_ROUTING_PROVENANCE,
  type RoutingProvenance,
} from "./routingProvenance.ts";
import { MASTER_EVIDENCE_EVENTS } from "./masterStory.ts";
import { storyBeatTime, type StoryBeatId } from "./storyTimeline.ts";
import {
  SIMULATED_VEHICLE_WORLD,
  vehicleWorldPreconditionHolds,
  type VehicleWorld,
  type VehicleWorldPrecondition,
} from "./vehicleActuation.ts";
import { visualEventTime } from "./visualEvents.ts";

/**
 * D-006G — runtime mission evidence for the trust boundaries the signed
 * D-005M fixture does not cover.
 *
 * WHY THIS IS A SEPARATE LAYER. The 45-object D-005M bundle is immutable
 * here: its generator (`app.evidence.builders`) is absent from this checkout,
 * so nothing can be added to or removed from it, and `masterStory.ts` asserts
 * the count. Every record authored here therefore lives in the append-only
 * RUNTIME journal and carries `evidence_class: "DEMONSTRATION_RUNTIME"`, so
 * it is never mistaken for signed canonical evidence. D-006 C1 carries these
 * records in the runtime section of the wrapper PEB; it does not splice them
 * into the immutable signed-object list.
 *
 * HOW CAUSALITY IS EXPRESSED. `OfflineCausalRecord.causalPredecessors` is
 * assigned by `appendRecord` from the previous record in the journal — it is
 * APPEND ORDER, not a causal claim. Two independent domains share this
 * journal, so a vehicle record can sit immediately after a city record
 * without the city having caused anything. Causation is therefore carried
 * explicitly in the payload:
 *
 *   caused_by       the record's own causal parent, ALWAYS in its own domain
 *   observed_input  an artifact from ANOTHER domain that this record observed
 *
 * That split is what makes "the light commanded the taxi" and "the taxi
 * observed the light and decided for itself" distinguishable from the
 * evidence alone. A vehicle record naming a city receipt in `caused_by` would
 * be a command; naming it in `observed_input` is an observation. The test
 * suite asserts no vehicle record ever does the former.
 *
 * NX0 — WORLD PRECONDITIONS. A vehicle ACTION or RESULT record additionally
 * carries a `worldPrecondition`: what the simulated vehicle must actually be
 * doing at the record's moment. `projectMissionEvidence` observes the vehicle
 * (see vehicleActuation.ts) and appends the record only if the precondition
 * holds. The clock still says WHEN; the vehicle says WHETHER. A red light, a
 * decision record and a reached timestamp can no longer mint a brake receipt
 * on their own — tests in d006nx0-evidence-completeness prove each of those
 * alone produces nothing.
 */

const SIGNAL_ID = "fortix.demo.city.signal.crossing-07";
const VEHICLE_ID = "fortix.demo.vehicle.taxi-07";
const PERCEPTION_SOURCE = "onboard-forward-camera";
const DECISION_POLICY = "fortix.demo.policy.signalised-intersection.v1";
const HAZARD_POLICY = "fortix.demo.policy.hazard-ahead.v1";
const VEHICLE_ADMISSION = "SIMULATED_VEHICLE_MOTION";

/** The trust domain that authored a record. Never merged, never inferred. */
export type TrustDomain =
  | "SMART_CITY_INFRASTRUCTURE"
  | "AUTONOMOUS_VEHICLE"
  | "ROUTING_ORCHESTRATOR"
  | "PAYMENT_PROVIDER"
  | "FINANCIAL_INSTITUTION";

export type MissionEvidenceSpec = Readonly<{
  eventId: string;
  eventType: string;
  receiptId: string;
  /** Master-clock position, taken from the visual event it accompanies. */
  visualEventId: string | null;
  /** Used when the evidence is proof-visible but has no receipt-flight event. */
  storyBeatId?: StoryBeatId;
  domain: TrustDomain;
  /** The record's causal parent, which must belong to the same domain. */
  causedByEventId: string | null;
  /** An artifact from another domain that this record merely observed. */
  observedEventId?: string;
  payload: Readonly<Record<string, JsonValue>>;
  /**
   * NX0: what the simulated vehicle must be doing at this moment for the
   * record to exist at all. Only vehicle actions and results carry one.
   */
  worldPrecondition?: VehicleWorldPrecondition;
}>;

function signalPublication(
  suffix: string,
  visualEventId: string,
  state: "GREEN" | "YELLOW" | "RED",
  causedByEventId: string | null,
): MissionEvidenceSpec {
  return {
    eventId: `d006g.signal-state-published:${suffix}`,
    eventType: "SIGNAL_STATE_PUBLISHED",
    receiptId: `NR-SIGNAL-STATE:${suffix}`,
    visualEventId,
    domain: "SMART_CITY_INFRASTRUCTURE",
    causedByEventId,
    payload: {
      signal_id: SIGNAL_ID,
      published_state: state,
      publisher: "SMART_CITY_INFRASTRUCTURE",
      // Stated so it cannot be read as a permission. A signal head publishes
      // a state to whoever is looking; it addresses no vehicle and grants
      // nothing to anyone.
      addressed_to: null,
      confers_permission: false,
    },
  };
}

function perception(
  suffix: string,
  visualEventId: string,
  observedState: "YELLOW" | "GREEN" | "CONGESTION_QUEUE_AHEAD",
  observedEventId: string,
  causedByEventId: string | null,
  latencyMs: number,
  eventPrefix = "d006g",
): MissionEvidenceSpec {
  return {
    eventId: `${eventPrefix}.perception:${suffix}`,
    eventType: "VEHICLE_OBSERVATION",
    receiptId: `NR-PERCEPTION:${suffix}`,
    visualEventId,
    domain: "AUTONOMOUS_VEHICLE",
    causedByEventId,
    observedEventId,
    payload: {
      vehicle_id: VEHICLE_ID,
      observed_state: observedState,
      observation_source: PERCEPTION_SOURCE,
      // A latency, and a state field that CAN disagree with what was
      // published. If an observation could only ever mirror the world, it
      // would not be a separate fact and the distinction would be unprovable.
      observation_latency_ms: latencyMs,
      observation_is_authoritative: false,
    },
  };
}

function decision(
  suffix: string,
  visualEventId: string,
  chosen: "STOP" | "PROCEED",
  inputs: readonly string[],
  causedByEventId: string,
): MissionEvidenceSpec {
  return {
    eventId: `d006g.decision:${suffix}`,
    eventType: "AUTONOMOUS_DECISION",
    receiptId: `NR-DECISION:${suffix}`,
    visualEventId,
    domain: "AUTONOMOUS_VEHICLE",
    causedByEventId,
    payload: {
      vehicle_id: VEHICLE_ID,
      decision: chosen,
      policy_ref: DECISION_POLICY,
      // Two admissible actions, so this is a choice rather than a relay. A
      // decision record listing one option and one input is an instruction
      // wearing a decision's name.
      admissible_actions: ["STOP", "PROCEED"],
      decision_inputs: [...inputs],
      instructed_by: null,
    },
  };
}

/**
 * A vehicle action or result. NX0: every one carries the motion phase that
 * admits it, both as a precondition the projection checks against the
 * simulated vehicle and as payload the evidence states about itself.
 */
function vehicleAct(
  suffix: string,
  visualEventId: string,
  eventType: "VEHICLE_ACTION" | "VEHICLE_RESULT",
  detail: Readonly<Record<string, JsonValue>>,
  causedByEventId: string,
  precondition: VehicleWorldPrecondition,
  options: Readonly<{ eventPrefix?: string; observedEventId?: string }> = {},
): MissionEvidenceSpec {
  const prefix = options.eventPrefix ?? "d006g";
  return {
    eventId: `${prefix}.${eventType === "VEHICLE_ACTION" ? "action" : "result"}:${suffix}`,
    eventType,
    receiptId: `NR-${eventType === "VEHICLE_ACTION" ? "ACTION" : "RESULT"}:${suffix}`,
    visualEventId,
    domain: "AUTONOMOUS_VEHICLE",
    causedByEventId,
    ...(options.observedEventId === undefined ? {} : { observedEventId: options.observedEventId }),
    payload: {
      vehicle_id: VEHICLE_ID,
      ...detail,
      motion_phase: precondition.motionPhase,
      admitted_by: VEHICLE_ADMISSION,
    },
    worldPrecondition: precondition,
  };
}

/**
 * NX0: the mission's first physical act. The taxi drives away from the base
 * on the strength of its own acceptance; the record exists only if the
 * simulated vehicle is actually cruising away at that moment.
 */
const DEPARTURE_SPECS: readonly MissionEvidenceSpec[] = [
  vehicleAct("depart-base", "taxi-departs-base", "VEHICLE_ACTION",
    { actuation: "DRIVE", brake_lights: "OFF", departed_from: "BASE" },
    "d005.mission-accepted",
    { motionPhase: "CRUISE", brakeLights: false, speed: "MOVING" },
    { eventPrefix: "d006nx0" }),
];

/**
 * The intersection, as two independent domains.
 *
 * Read the order: the vehicle's brake is applied BEFORE the signal publishes
 * red. The taxi responded to the yellow it observed itself, so red cannot be
 * the cause of the stop — the timeline alone refutes the command reading.
 */
const SMART_CITY_SPECS: readonly MissionEvidenceSpec[] = [
  signalPublication("green-1", "signal-green", "GREEN", null),
  {
    eventId: "d006g.city-detection",
    eventType: "CITY_SENSOR_DETECTION",
    receiptId: "NR-CITY-DETECTION:approach",
    visualEventId: "city-detection",
    domain: "SMART_CITY_INFRASTRUCTURE",
    causedByEventId: "d006g.signal-state-published:green-1",
    payload: {
      signal_id: SIGNAL_ID,
      sensor: "inductive-loop-and-radar",
      detected: "APPROACHING_VEHICLE",
      // The city detected *a* vehicle with its own sensors. It did not
      // receive a report, and it does not know which vehicle this is.
      detection_source: "CITY_OWNED_SENSOR",
      vehicle_identified: false,
      reported_by_vehicle: false,
    },
  },
  signalPublication("yellow", "signal-yellow", "YELLOW", "d006g.city-detection"),
  perception("yellow", "taxi-observes-yellow", "YELLOW", "d006g.signal-state-published:yellow", null, 120),
  decision("stop", "taxi-decides-stop", "STOP", ["d006g.perception:yellow"], "d006g.perception:yellow"),
  // The brake ACTION exists because the vehicle is braking on its own
  // decision at this moment — not because the decision was recorded.
  vehicleAct("brake", "taxi-brake-applied", "VEHICLE_ACTION",
    { actuation: "SERVICE_BRAKE", brake_lights: "ON" }, "d006g.decision:stop",
    { motionPhase: "BRAKING_ON_OWN_DECISION", brakeLights: true, speed: "MOVING" }),
  signalPublication("red", "signal-red", "RED", "d006g.signal-state-published:yellow"),
  // The physical RESULT: the vehicle is standing still before the line.
  vehicleAct("at-rest", "taxi-at-rest", "VEHICLE_RESULT",
    { motion_state: "AT_REST", stopped_short_of_line: true }, "d006g.action:brake",
    { motionPhase: "STOPPED_AT_LINE", brakeLights: true, speed: "AT_REST" }),
  {
    eventId: "d006g.city-phase-decision",
    eventType: "SIGNAL_PHASE_DECIDED",
    receiptId: "NR-CITY-PHASE:next",
    visualEventId: "city-phase-decision",
    domain: "SMART_CITY_INFRASTRUCTURE",
    causedByEventId: "d006g.signal-state-published:red",
    payload: {
      signal_id: SIGNAL_ID,
      // The subject of this decision is the signal's OWN phase. The city is
      // not deciding anything about any vehicle.
      decision_subject: "OWN_SIGNAL_PHASE",
      next_phase: "GREEN",
      policy_ref: "fortix.demo.city.phase-policy.v1",
    },
  },
  signalPublication("green-2", "signal-green-2", "GREEN", "d006g.city-phase-decision"),
  perception("green", "taxi-observes-green", "GREEN", "d006g.signal-state-published:green-2",
    "d006g.result:at-rest", 140),
  // The keystone. Two INDEPENDENT inputs — what it saw, and its own
  // clearance check — so this decision cannot be a relay of either one.
  decision("proceed", "taxi-decides-proceed", "PROCEED",
    ["d006g.perception:green", "d006g.result:at-rest"], "d006g.perception:green"),
  vehicleAct("resume", "taxi-resumes", "VEHICLE_ACTION",
    { actuation: "DRIVE", brake_lights: "OFF" }, "d006g.decision:proceed",
    { motionPhase: "RESUMING_ON_OWN_DECISION", brakeLights: false, speed: "MOVING" }),
];

/**
 * NX0 — the obstacle, as the same four-layer Physical-AI chain.
 *
 * THE DEFECT THIS CLOSES. At 48 s the taxi visibly performed an emergency
 * stop short of the congestion queue — brake lamps on, a featured "Brake
 * lights ON" ribbon entry — and no evidence object existed for it. The only
 * nearby object was the Traffic Provider's congestion report and the vehicle's
 * signed ETA assessment; the braking itself was a drawing. The layers below
 * answer, from evidence alone: what did the taxi observe (the queue, via the
 * Traffic Provider's object as an OBSERVED input), what did it decide (stop
 * short of the hazard, two admissible actions), what did it do (service
 * brake, while the vehicle is actually in EMERGENCY_BRAKING), and what
 * resulted (at rest short of the queue, while it actually waits for a route).
 */
const HAZARD_SPECS: readonly MissionEvidenceSpec[] = [
  perception("congestion", "obstacle", "CONGESTION_QUEUE_AHEAD",
    "d005.congestion-significant", null, 500, "d006nx0"),
  {
    eventId: "d006nx0.decision:hazard-stop",
    eventType: "AUTONOMOUS_DECISION",
    receiptId: "NR-DECISION:hazard-stop",
    visualEventId: "taxi-decides-hazard-stop",
    domain: "AUTONOMOUS_VEHICLE",
    causedByEventId: "d006nx0.perception:congestion",
    payload: {
      vehicle_id: VEHICLE_ID,
      decision: "STOP_SHORT_OF_HAZARD",
      policy_ref: HAZARD_POLICY,
      admissible_actions: ["STOP_SHORT_OF_HAZARD", "FOLLOW_QUEUE"],
      decision_inputs: ["d006nx0.perception:congestion"],
      instructed_by: null,
    },
  },
  vehicleAct("hazard-brake", "brake", "VEHICLE_ACTION",
    { actuation: "SERVICE_BRAKE", brake_lights: "ON", stop_reason: "HAZARD_AHEAD" },
    "d006nx0.decision:hazard-stop",
    { motionPhase: "EMERGENCY_BRAKING", brakeLights: true, speed: "MOVING" },
    { eventPrefix: "d006nx0" }),
  vehicleAct("hazard-stop", "taxi-hazard-stop", "VEHICLE_RESULT",
    { motion_state: "AT_REST", stopped_short_of_hazard: true },
    "d006nx0.action:hazard-brake",
    { motionPhase: "WAITING_FOR_ROUTE", brakeLights: true, speed: "AT_REST" },
    { eventPrefix: "d006nx0" }),
];

export const ROUTING_PROVENANCE_EVENT_ID = "d006.c1.routing-provenance" as const;

/**
 * One evidence object carries the complete routing decision: request, policy,
 * candidates, selected tuple, resolved tuple, fallback and resulting route.
 * It intentionally has no `visualEventId`; proof projection may display the
 * object, but receipt projection cannot invent a receipt flight for it.
 */
const ROUTING_PROVENANCE_SPEC: MissionEvidenceSpec = {
  eventId: ROUTING_PROVENANCE_EVENT_ID,
  eventType: "ROUTING_PROVENANCE_RECORDED",
  receiptId: "NR-ROUTING-PROVENANCE:garage-reroute",
  visualEventId: null,
  storyBeatId: "resulting-route-calculated",
  domain: "ROUTING_ORCHESTRATOR",
  causedByEventId: null,
  payload: {},
};

/**
 * NX0: the vehicle CONTINUES on the resolved route. Its cause is the vehicle's
 * own signed reroute authorization; the orchestrator's resolved route is an
 * OBSERVED input from another domain. The record exists only while the
 * simulated vehicle is actually changing lane onto that route — which the
 * motion model refuses until the routing evidence is admissible.
 */
const REROUTE_SPECS: readonly MissionEvidenceSpec[] = [
  vehicleAct("reroute", "taxi-reroutes", "VEHICLE_ACTION",
    { actuation: "DRIVE", brake_lights: "OFF", executes: "RESOLVED_ROUTE" },
    "d005.reroute-authorized",
    { motionPhase: "REROUTING", brakeLights: false, speed: "ANY" },
    { eventPrefix: "d006nx0", observedEventId: ROUTING_PROVENANCE_EVENT_ID }),
];

/**
 * The financial boundary, as three distinct domains.
 *
 * The signed fixture already carries the invoice, the policy evaluation, the
 * human approval and a provider result whose payload says `SETTLED`. It has
 * no bank in it at all — so the demonstration was asserting a settlement, an
 * act only an account-holding institution can perform, with no such
 * institution present.
 *
 * These records add the missing domain WITHOUT restating settlement. A bank
 * authorising a transfer and a transfer settling are different events, and
 * only the first is demonstrable here.
 */
const FINANCIAL_SPECS: readonly MissionEvidenceSpec[] = [
  {
    eventId: "d006g.payment-instruction-presented",
    eventType: "PAYMENT_INSTRUCTION_PRESENTED",
    receiptId: "NR-PAYMENT-INSTRUCTION:presented",
    visualEventId: "instruction-presented",
    domain: "PAYMENT_PROVIDER",
    causedByEventId: null,
    observedEventId: "d005m.master-payment-instruction",
    payload: {
      instruction_ref: "invoice-d005m-1850",
      amount_eur: 1850,
      // The processor moves an instruction. It does not hold the account and
      // it does not settle.
      presented_to: "FINANCIAL_INSTITUTION",
      processor_role: "INSTRUCTION_TRANSPORT",
      settles_funds: false,
    },
  },
  {
    eventId: "d006g.bank-authorization",
    eventType: "BANK_AUTHORIZATION_DECISION",
    receiptId: "NR-BANK-AUTHORIZATION:invoice-1850",
    visualEventId: "bank-authorization",
    domain: "FINANCIAL_INSTITUTION",
    causedByEventId: null,
    observedEventId: "d006g.payment-instruction-presented",
    payload: {
      institution_role: "ACCOUNT_HOLDING_INSTITUTION",
      instruction_ref: "invoice-d005m-1850",
      amount_eur: 1850,
      decision: "AUTHORIZED",
      // What this decision is NOT. A bank authorising a transfer is a
      // different act from a manager approving an expense, and neither is
      // settlement.
      authorizes: "TRANSFER_REQUEST",
      is_expense_approval: false,
      is_settlement: false,
    },
  },
  {
    eventId: "d006g.bank-confirmation",
    eventType: "BANK_CONFIRMATION_RETURNED",
    receiptId: "NR-BANK-CONFIRMATION:invoice-1850",
    visualEventId: "bank-confirmation",
    domain: "FINANCIAL_INSTITUTION",
    causedByEventId: "d006g.bank-authorization",
    payload: {
      instruction_ref: "invoice-d005m-1850",
      confirmation: "AUTHORIZATION_RECORDED",
      // The honest limit of this demonstration, stated inside the evidence
      // rather than in a caption beside it. No clearing or settlement system
      // participates here, so none is claimed.
      settlement_status: "NOT_DEMONSTRATED",
      settlement_system_participated: false,
    },
  },
];

export const MISSION_EVIDENCE_SPECS: readonly MissionEvidenceSpec[] = Object.freeze([
  ...DEPARTURE_SPECS,
  ...SMART_CITY_SPECS,
  ...HAZARD_SPECS,
  ROUTING_PROVENANCE_SPEC,
  ...REROUTE_SPECS,
  ...FINANCIAL_SPECS,
]);

/** Specs whose existence is decided by the simulated vehicle, not the clock. */
export function vehicleActuationSpecs(): readonly MissionEvidenceSpec[] {
  return MISSION_EVIDENCE_SPECS.filter((spec) => spec.worldPrecondition !== undefined);
}

/** Master-clock position of a spec, projected from its visual event. */
export function specTime(spec: MissionEvidenceSpec): number {
  if (spec.visualEventId !== null) return visualEventTime(spec.visualEventId);
  if (spec.storyBeatId !== undefined) return storyBeatTime(spec.storyBeatId);
  throw new TypeError(`Mission evidence has no canonical time source: ${spec.eventId}`);
}

const specByEventId = new Map(MISSION_EVIDENCE_SPECS.map((spec) => [spec.eventId, spec]));
const signedEvidenceByEventId = new Map(
  MASTER_EVIDENCE_EVENTS.map((event) => [event.event_id, event.evidence_id]),
);

function runtimeInputsPresent(session: OfflineEvidenceSession, spec: MissionEvidenceSpec): boolean {
  for (const eventId of [spec.causedByEventId, spec.observedEventId]) {
    if (eventId === null || eventId === undefined) continue;
    if (!specByEventId.has(eventId)) continue; // a signed object is always present
    if (!session.records.some((record) => record.eventId === eventId)) return false;
  }
  return true;
}

function evidenceReferenceForEvent(eventId: string | null | undefined): string | null {
  if (eventId === null || eventId === undefined) return null;
  const reference = specByEventId.get(eventId)?.receiptId ?? signedEvidenceByEventId.get(eventId);
  if (reference === undefined) {
    throw new TypeError(`Mission evidence input does not resolve to an evidence object: ${eventId}`);
  }
  return reference;
}

/**
 * Appends every mission-evidence record whose moment the clock has reached
 * and which the journal does not already hold.
 *
 * Pure and idempotent: replaying the same clock, or seeking backwards and
 * forwards again, appends nothing new because each record is matched by its
 * own event id. Nothing here consults the network, the DOM or the wall clock,
 * so it can be tested directly rather than through the interface — which is
 * what the previous projection, buried in a React effect, could not be.
 *
 * NX0: a record with a `worldPrecondition` is appended only if the simulated
 * vehicle is actually doing that thing at the record's own moment. The
 * observation is made at the record's moment rather than at the current
 * clock so a scrub across the braking window reconstructs the same journal a
 * frame-by-frame playback produced (§42); it is the vehicle model, not the
 * position of the playhead, that decides whether the action happened.
 */
export function projectMissionEvidence(
  session: OfflineEvidenceSession,
  masterTimeMs: number,
  routingProvenance: RoutingProvenance = CANONICAL_ROUTING_PROVENANCE,
  world: VehicleWorld = SIMULATED_VEHICLE_WORLD,
): OfflineEvidenceSession {
  let next = session;
  for (const spec of MISSION_EVIDENCE_SPECS) {
    const at = specTime(spec);
    if (at > masterTimeMs) continue;
    if (next.records.some((record) => record.eventId === spec.eventId)) continue;
    // The mission clock is strictly monotonic in the journal. A record whose
    // moment has already been passed by a later append is skipped rather than
    // forced, because moving it would misstate when it happened.
    const previousClock = next.records.at(-1)?.missionClockPosition ?? -1;
    if (at <= previousClock) continue;
    // NX0: no record without its cause. A record whose declared runtime cause
    // or observed runtime input was never authored — because the vehicle
    // never performed that act — is not authored either. A "green perceived
    // after coming to rest" cannot exist in a run where the taxi never
    // stopped; the closure would rightly refuse the dangling parent, and the
    // journal must not offer it one.
    if (!runtimeInputsPresent(next, spec)) continue;
    if (spec.worldPrecondition !== undefined) {
      // The vehicle may execute the reroute only once routing evidence is in
      // the journal; the motion model holds it at the hazard stop otherwise.
      const routingExecutionAuthorized = next.records.some(
        (record) => record.eventId === ROUTING_PROVENANCE_EVENT_ID,
      );
      const actuation = world.actuationAt(at, routingExecutionAuthorized);
      if (!vehicleWorldPreconditionHolds(spec.worldPrecondition, actuation)) continue;
    }
    next = appendMissionEvidence(next, {
      missionId: next.missionId,
      runId: next.runId,
      eventId: spec.eventId,
      eventType: spec.eventType,
      receiptId: spec.receiptId,
      missionClockPosition: at,
      executionLocality: "LOCAL",
      payload: {
        ...spec.payload,
        ...(spec.eventId === ROUTING_PROVENANCE_EVENT_ID
          ? { routing_provenance: routingProvenance as unknown as JsonValue }
          : {}),
        trust_domain: spec.domain,
        // Causation, explicitly, because causalPredecessors is append order.
        caused_by: evidenceReferenceForEvent(spec.causedByEventId),
        observed_input: evidenceReferenceForEvent(spec.observedEventId),
        // These records are demonstration runtime evidence. They remain
        // distinguishable from the nested signed D-005M source even when both
        // are carried by one D-006 wrapper PEB.
        evidence_class: "DEMONSTRATION_RUNTIME",
        execution_scope: "DEMO_PRESENTATION_RUNTIME",
      },
    }).session;
  }
  return next;
}

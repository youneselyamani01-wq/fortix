import { storyBeatTime, type StoryBeatId } from "./storyTimeline.ts";

/** `cyan` is the locked palette's system-exchange hue, used for the bank. */
export type EventTone = "ultramarine" | "orchid" | "tangerine" | "solar" | "glacier" | "green" | "cyan";
/**
 * One lane per trust domain. `vehicle` is the taxi's own autonomous system —
 * its perception, its decisions and its actions — kept separate from `city`
 * so the Proof Tree can show two independent domains interacting rather than
 * one chain of command. `bank` is a financial institution, distinct from the
 * `authority` lane that carries human approval and fleet spend policy.
 */
export type Branch = "mission" | "city" | "vehicle" | "safety" | "route" | "service" | "authority" | "bank" | "network";
export type ReceiptKind = "mission" | "infrastructure" | "vehicle" | "service" | "human" | "financial";
export type VisualTimingRelation = "CANONICAL_MISSION_EVENT" | "VISUAL_CONSEQUENCE";

export type VisualEvent = Readonly<{
  id: string;
  timeMs: number;
  mission: string;
  receipt: string;
  actor: string;
  branch: Branch;
  receiptKind: ReceiptKind;
  tone: EventTone;
  featured?: boolean;
  sourceMomentId: StoryBeatId;
  relation: VisualTimingRelation;
  offsetMs: number;
  /**
   * NX0: the exact signed object this beat IS, for a moment the master
   * story does not list (the acceptance at 5 s). Bound only when a presented
   * signed member carries this event id at this very time — a consequence
   * still cannot borrow a neighbouring moment's object.
   */
  signedEventId?: string;
}>;

type VisualEventDefinition = Omit<VisualEvent, "timeMs" | "relation" | "offsetMs" | "sourceMomentId"> & Readonly<{
  timing: Readonly<{
    sourceMomentId: StoryBeatId;
    relation: VisualTimingRelation;
    offsetMs?: number;
  }>;
}>;

function canonical(sourceMomentId: StoryBeatId): VisualEventDefinition["timing"] {
  return { sourceMomentId, relation: "CANONICAL_MISSION_EVENT" };
}

function consequence(sourceMomentId: StoryBeatId, offsetMs = 0): VisualEventDefinition["timing"] {
  return { sourceMomentId, relation: "VISUAL_CONSEQUENCE", offsetMs };
}

/**
 * Legacy definitions used relative offsets. C1 resolves every semantic event
 * to an authored story beat before it reaches a consumer; the old offsets are
 * never part of runtime timing.
 */
const VISUAL_EVENT_BEAT = Object.freeze({
  accept: "mission-accepted",
  "taxi-departs-base": "taxi-departs-base",
  "signal-green": "signal-green",
  "city-detection": "city-detection",
  "signal-yellow": "signal-yellow",
  "taxi-observes-yellow": "taxi-observes-yellow",
  "taxi-decides-stop": "taxi-decides-stop",
  "taxi-brake-applied": "taxi-brake-applied",
  "signal-red": "signal-red",
  "taxi-at-rest": "taxi-at-rest",
  "city-phase-decision": "city-phase-decision",
  "signal-green-2": "signal-green-2",
  "taxi-observes-green": "taxi-observes-green",
  "taxi-decides-proceed": "taxi-decides-proceed",
  "taxi-resumes": "taxi-resumes",
  obstacle: "taxi-observes-congestion",
  "taxi-decides-hazard-stop": "taxi-decides-hazard-stop",
  brake: "eta-at-risk",
  "taxi-hazard-stop": "routing-candidate-selected",
  "taxi-reroutes": "physical-reroute",
  "work-begins": "work-in-progress",
  "policy-exceeded": "policy-exceeded",
  "instruction-presented": "payment-instruction-presented",
  "bank-authorization": "bank-authorization",
  "bank-confirmation": "bank-confirmation",
  "payment-receipt": "payment-sub-mission-receipt",
} satisfies Readonly<Record<string, StoryBeatId>>);

function materialize(definition: VisualEventDefinition): VisualEvent {
  const { timing, ...presentation } = definition;
  const sourceMomentId = VISUAL_EVENT_BEAT[definition.id as keyof typeof VISUAL_EVENT_BEAT]
    ?? timing.sourceMomentId;
  return Object.freeze({
    ...presentation,
    sourceMomentId,
    relation: timing.relation,
    offsetMs: 0,
    timeMs: storyBeatTime(sourceMomentId),
  });
}

/**
 * Presentation metadata only. Timing is projected from the canonical master
 * story. A visual consequence may add an explicit offset, but no entry owns an
 * independent absolute clock.
 */
const VISUAL_EVENT_DEFINITIONS: readonly VisualEventDefinition[] = [
  { id: "request", timing: canonical("passenger-request"), mission: "You called Taxi 07", receipt: "Mission Request Receipt", actor: "You", branch: "mission", receiptKind: "mission", tone: "ultramarine", featured: true },
  // NX0: the acceptance at 5 s has its own signed object (d005.mission-accepted)
  // but no master-story moment, so C3 could never bind it and the public
  // fact "the taxi accepted" was never supported. Bound explicitly, exactly.
  { id: "accept", timing: consequence("passenger-request", 5_000), mission: "Vehicle acceptance", receipt: "Vehicle Authority Receipt", actor: "Vehicle", branch: "mission", receiptKind: "vehicle", tone: "ultramarine", featured: true, signedEventId: "d005.mission-accepted" },
  // NX0: the mission's first physical act, receipted only while the simulated
  // vehicle is actually driving away (see missionEvidence.ts).
  { id: "taxi-departs-base", timing: consequence("taxi-departs-base"), mission: "Taxi leaves the base", receipt: "Vehicle Action Receipt · Departure", actor: "Vehicle", branch: "vehicle", receiptKind: "vehicle", tone: "glacier" },
  { id: "pickup", timing: canonical("passenger-pickup"), mission: "Passenger onboard", receipt: "Pickup Vehicle Receipt", actor: "Vehicle", branch: "mission", receiptKind: "vehicle", tone: "glacier" },
  // D-006G. Two independent trust domains meet at this intersection, and the
  // evidence must be able to tell them apart.
  //
  // The city publishes signal states and decides its OWN phase. It never
  // names the vehicle as the subject of a permission. The retired `crossing`
  // event ("Crossing authorized · green", authored by the traffic light) did
  // exactly that — a light authorising a vehicle — and the vehicle's motion
  // was a pure function of its timestamp. Both are gone.
  //
  // The vehicle observes, decides and acts on its own clock. Note the order:
  // `taxi-brake-applied` (+3_000) lands BEFORE `signal-red` (+3_500). The
  // taxi is already braking when the light turns red, so red is provably not
  // the cause of the stop — it responded to the yellow it observed itself.
  { id: "signal-green", timing: canonical("passenger-journey"), mission: "Signal publishes green", receipt: "Signal State Receipt · Green", actor: "Smart Traffic Light", branch: "city", receiptKind: "infrastructure", tone: "green" },
  { id: "city-detection", timing: consequence("passenger-journey", 1_000), mission: "City sensor detects an approaching vehicle", receipt: "City Detection Receipt", actor: "City Infrastructure", branch: "city", receiptKind: "infrastructure", tone: "orchid" },
  { id: "signal-yellow", timing: consequence("passenger-journey", 1_500), mission: "Signal publishes yellow", receipt: "Signal State Receipt · Yellow", actor: "Smart Traffic Light", branch: "city", receiptKind: "infrastructure", tone: "solar" },
  { id: "taxi-observes-yellow", timing: consequence("passenger-journey", 2_000), mission: "Taxi observes a yellow signal", receipt: "Perception Receipt · Yellow", actor: "Taxi Perception", branch: "vehicle", receiptKind: "vehicle", tone: "glacier" },
  { id: "taxi-decides-stop", timing: consequence("passenger-journey", 2_500), mission: "Taxi decides to stop", receipt: "Autonomous Decision Receipt · Stop", actor: "Taxi Autonomy", branch: "vehicle", receiptKind: "vehicle", tone: "glacier", featured: true },
  { id: "taxi-brake-applied", timing: consequence("passenger-journey", 3_000), mission: "Brakes applied", receipt: "Vehicle Action Receipt · Brake", actor: "Brake Lights", branch: "vehicle", receiptKind: "vehicle", tone: "tangerine" },
  { id: "signal-red", timing: consequence("passenger-journey", 3_500), mission: "Signal publishes red", receipt: "Signal State Receipt · Red", actor: "Smart Traffic Light", branch: "city", receiptKind: "infrastructure", tone: "tangerine", featured: true },
  { id: "taxi-at-rest", timing: consequence("passenger-journey", 4_000), mission: "Taxi at rest before the line", receipt: "Vehicle Result Receipt · At rest", actor: "Vehicle", branch: "vehicle", receiptKind: "vehicle", tone: "glacier" },
  { id: "city-phase-decision", timing: consequence("passenger-journey", 4_500), mission: "City decides its next signal phase", receipt: "Signal Phase Decision Receipt", actor: "City Infrastructure", branch: "city", receiptKind: "infrastructure", tone: "orchid" },
  { id: "signal-green-2", timing: consequence("passenger-journey", 5_000), mission: "Signal publishes green", receipt: "Signal State Receipt · Green", actor: "Smart Traffic Light", branch: "city", receiptKind: "infrastructure", tone: "green" },
  { id: "taxi-observes-green", timing: consequence("passenger-journey", 5_500), mission: "Taxi observes a green signal", receipt: "Perception Receipt · Green", actor: "Taxi Perception", branch: "vehicle", receiptKind: "vehicle", tone: "glacier" },
  { id: "taxi-decides-proceed", timing: consequence("passenger-journey", 6_000), mission: "Taxi decides to proceed", receipt: "Autonomous Decision Receipt · Proceed", actor: "Taxi Autonomy", branch: "vehicle", receiptKind: "vehicle", tone: "glacier" },
  { id: "taxi-resumes", timing: consequence("passenger-journey", 6_500), mission: "Taxi resumes on its own decision", receipt: "Vehicle Action Receipt · Resume", actor: "Vehicle", branch: "vehicle", receiptKind: "vehicle", tone: "glacier" },
  { id: "dropoff", timing: canonical("passenger-dropoff"), mission: "Passenger drop-off confirmed", receipt: "Drop-off Vehicle Receipt", actor: "Vehicle", branch: "mission", receiptKind: "vehicle", tone: "glacier", featured: true },
  { id: "handover", timing: canonical("garage-mission-begins"), mission: "Maintenance becomes next mission", receipt: "Mission Handover Receipt", actor: "Fleet Operations", branch: "service", receiptKind: "service", tone: "solar" },
  { id: "route-start", timing: canonical("normal-route-to-garage"), mission: "Route to garage begins", receipt: "Route Start Receipt", actor: "Navigation + Vehicle", branch: "route", receiptKind: "vehicle", tone: "glacier" },
  // NX0 — the obstacle as the same four-layer Physical-AI chain as the
  // intersection. The "obstacle" and "brake" beats used to caption receipts
  // that did not exist: the taxi visibly braked short of the queue and no
  // evidence object was behind it. Each beat below binds the vehicle's OWN
  // runtime object (missionEvidence.ts HAZARD_SPECS), never the Traffic
  // Provider's congestion report or the signed ETA assessment.
  { id: "obstacle", timing: consequence("taxi-observes-congestion"), mission: "Taxi observes the queue ahead", receipt: "Perception Receipt · Congestion", actor: "Taxi Perception", branch: "vehicle", receiptKind: "vehicle", tone: "glacier" },
  { id: "taxi-decides-hazard-stop", timing: consequence("taxi-decides-hazard-stop"), mission: "Taxi decides to stop short of the queue", receipt: "Autonomous Decision Receipt · Hazard stop", actor: "Taxi Autonomy", branch: "vehicle", receiptKind: "vehicle", tone: "glacier" },
  { id: "brake", timing: consequence("eta-at-risk"), mission: "Emergency braking", receipt: "Vehicle Action Receipt · Emergency brake", actor: "Brake Lights", branch: "safety", receiptKind: "vehicle", tone: "tangerine", featured: true },
  { id: "taxi-hazard-stop", timing: consequence("routing-candidate-selected"), mission: "Taxi at rest short of the queue", receipt: "Vehicle Result Receipt · Hazard stop", actor: "Vehicle", branch: "vehicle", receiptKind: "vehicle", tone: "glacier" },
  { id: "reroute", timing: canonical("reroute-authorized"), mission: "Reroute authorized", receipt: "Reroute Authority Receipt", actor: "Navigation + Vehicle", branch: "route", receiptKind: "vehicle", tone: "glacier" },
  // NX0: the vehicle CONTINUES on the resolved route — its own action, admitted
  // only while the motion model is actually rerouting.
  { id: "taxi-reroutes", timing: consequence("physical-reroute"), mission: "Taxi takes the new route", receipt: "Vehicle Action Receipt · Reroute", actor: "Vehicle", branch: "vehicle", receiptKind: "vehicle", tone: "glacier" },
  { id: "garage", timing: canonical("garage-arrival"), mission: "Garage arrival", receipt: "Service Arrival Receipt", actor: "Garage", branch: "service", receiptKind: "service", tone: "solar" },
  { id: "maintenance", timing: canonical("maintenance-authorized"), mission: "Maintenance authorized", receipt: "Service Authority Receipt", actor: "Fleet Operations", branch: "service", receiptKind: "service", tone: "solar", featured: true },
  // NX0: work BEGINS is a signed event (d005.maintenance-executed) that had no
  // beat; the register wrongly said maintenance start produces no evidence.
  { id: "work-begins", timing: canonical("work-in-progress"), mission: "Maintenance work begins", receipt: "Service Execution Receipt", actor: "Garage", branch: "service", receiptKind: "service", tone: "solar" },
  { id: "work", timing: canonical("work-complete"), mission: "Maintenance complete", receipt: "Service Completion Receipt", actor: "Garage", branch: "service", receiptKind: "service", tone: "solar" },
  { id: "invoice", timing: canonical("invoice-1850"), mission: "Payment requested", receipt: "Financial Request Receipt", actor: "Payment System", branch: "authority", receiptKind: "financial", tone: "ultramarine" },
  // NX0: the limit being exceeded is its own signed object; the threshold fact
  // binds it rather than the invoice.
  { id: "policy-exceeded", timing: canonical("policy-exceeded"), mission: "Autonomous limit exceeded", receipt: "Payment Policy Receipt", actor: "Payment Policy", branch: "authority", receiptKind: "financial", tone: "ultramarine" },
  { id: "human", timing: canonical("human-approve"), mission: "Human approval granted", receipt: "Authorization Receipt", actor: "Manager", branch: "authority", receiptKind: "human", tone: "tangerine", featured: true },
  { id: "authorized", timing: canonical("payment-authorized"), mission: "Payment authorized", receipt: "Financial Authority Receipt", actor: "Payment Policy", branch: "authority", receiptKind: "financial", tone: "ultramarine" },
  // D-006G. The bank is its own trust domain, and it is not the payment
  // processor, not the garage, and not the human who approved the expense.
  // These sit between the signed instruction (86_000) and the signed provider
  // result (88_000) — they add the missing institution without restating
  // settlement, which nothing here can demonstrate.
  { id: "instruction-presented", timing: consequence("payment-execution", 500), mission: "Instruction presented to the bank", receipt: "Payment Instruction Receipt", actor: "Payment Provider", branch: "authority", receiptKind: "financial", tone: "ultramarine" },
  { id: "bank-authorization", timing: consequence("payment-execution", 1_000), mission: "Bank authorizes the transfer", receipt: "Bank Authorization Receipt", actor: "Bank", branch: "bank", receiptKind: "financial", tone: "cyan", featured: true },
  { id: "bank-confirmation", timing: consequence("payment-execution", 1_500), mission: "Bank confirmation returned", receipt: "Bank Confirmation Receipt", actor: "Bank", branch: "bank", receiptKind: "financial", tone: "cyan" },
  { id: "paid", timing: canonical("payment-result"), mission: "Simulated payment result recorded", receipt: "Local Payment Simulation Receipt", actor: "Payment System", branch: "authority", receiptKind: "financial", tone: "ultramarine" },
  { id: "payment-receipt", timing: consequence("payment-result", 2_000), mission: "Payment evidence closed locally", receipt: "Local Payment Sub-Mission Receipt", actor: "Payment System", branch: "authority", receiptKind: "financial", tone: "ultramarine" },
  { id: "manager", timing: canonical("manager-notified"), mission: "Manager notified", receipt: "Manager Accountability Receipt", actor: "Manager", branch: "authority", receiptKind: "human", tone: "tangerine" },
  { id: "return-intent", timing: canonical("return-to-base-intent"), mission: "Return to base intent", receipt: "Return Intent Receipt", actor: "Fleet Operations", branch: "route", receiptKind: "service", tone: "solar" },
  { id: "return-authorized", timing: canonical("return-route-calculated"), mission: "Return route authorized", receipt: "Return Authority Receipt", actor: "Fleet Operations", branch: "route", receiptKind: "service", tone: "solar", featured: true },
  { id: "return-executed", timing: canonical("leaving-garage"), mission: "Return executed", receipt: "Return Execution Receipt", actor: "Vehicle", branch: "route", receiptKind: "vehicle", tone: "glacier" },
  { id: "complete", timing: canonical("parked-at-base"), mission: "Mission complete", receipt: "Mission Completion Receipt", actor: "Vehicle", branch: "mission", receiptKind: "vehicle", tone: "glacier", featured: true },
  { id: "return-receipt", timing: canonical("sub-mission-receipts"), mission: "Return sub-mission closed", receipt: "Return Sub-Mission Receipt", actor: "Vehicle", branch: "mission", receiptKind: "mission", tone: "ultramarine" },
];

export const VISUAL_EVENTS: readonly VisualEvent[] = Object.freeze(
  VISUAL_EVENT_DEFINITIONS.map(materialize).sort((left, right) => left.timeMs - right.timeMs),
);

export function visualEventTime(id: string): number {
  const event = VISUAL_EVENTS.find((candidate) => candidate.id === id);
  if (event === undefined) throw new TypeError(`Unknown visual event: ${id}`);
  return event.timeMs;
}

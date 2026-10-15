import { STORY_BEAT_TIME_MS, type StoryBeatId } from "./storyTimeline.ts";

/**
 * D-006 C3 — the live causal event register.
 *
 * PUBLIC PRINCIPLE: facts → evidence → verify. A fact may be presented only
 * because an observable event caused it, and every material public event must
 * name its causal source explicitly. The register below is that declaration,
 * one row per significant public event, and it is load-bearing: tests read it,
 * the machine-readable artifact is generated from it, and the C3 timeline
 * audit classifies against it.
 *
 * THE DISTINCTION THIS FILE EXISTS TO KEEP:
 *
 *   TIME SAYS WHEN SOMETHING IS REPRESENTED.
 *   SOURCE SAYS WHY SOMETHING HAPPENED.
 *
 * The Master Clock remains the synchronization authority for the simulated
 * world — a deterministic city is allowed to schedule its own traffic light.
 * It is NOT allowed to fabricate a physical cable pull, a human decision, or
 * an independent verification. Those rows are marked `clockMayCause: false`,
 * and a test fails if any of them ever carries a scheduled trigger.
 *
 * NX0 extends the register to every significant observable action the
 * evidence-completeness audit names (see significantActions.ts, which maps
 * each of those actions to a row here and to an explicit evidence decision).
 * The vehicle's own acts — departure, braking, coming to rest, resuming, the
 * hazard stop and the reroute — are DERIVED_FROM_WORLD_STATE: the clock says
 * when they are represented, the simulated vehicle says whether they happen.
 */

export type EventSourceType =
  | "SIMULATED_WORLD_EVENT"
  | "USER_INTERACTION"
  | "PHYSICAL_SENTINEL_EVENT"
  | "SYSTEM_DERIVED_EVENT"
  | "EVIDENCE_DERIVED_EVENT";

export type EventTrigger =
  /** The deterministic simulated world reached an authored story beat. */
  | "SCHEDULED_STORY_BEAT"
  /** A person performed a real interaction (button, drag, key). */
  | "HUMAN_ACTION"
  /** The Intel I226-LM link sentinel reported a physical observation. */
  | "PHYSICAL_OBSERVATION"
  /** Derived from current simulated-world state, not from the clock. */
  | "DERIVED_FROM_WORLD_STATE"
  /** Derived from evidence already in the journal/closure. */
  | "DERIVED_FROM_EVIDENCE";

export type EvidenceExpectation =
  /** The event must produce (or be projected from) journal/signed evidence. */
  | "REQUIRED"
  /** Pure presentation; deliberately produces no evidence object. */
  | "NONE";

export type CausalEventRegistration = Readonly<{
  id: string;
  /** Who or what caused it. */
  sourceType: EventSourceType;
  /** The concrete source, e.g. a story beat, the sentinel, a control. */
  sourceId: string;
  trigger: EventTrigger;
  /** What a spectator can observe when it happens. */
  observation: string;
  actor: string;
  /** Register ids of the causal parents, in causal order. */
  causedBy: readonly string[];
  evidenceExpectation: EvidenceExpectation;
  /**
   * Where the evidence lives when REQUIRED: a visual-event id resolved
   * through receipt projection (`visual:`), an exact runtime journal record
   * (`runtime:<eventId>`) or event type (`runtime:<EVENT_TYPE>`), an exact
   * signed object (`signed:<eventId>`), an artifact, or a closure query.
   */
  evidenceRef: string | null;
  /** Public fact this event supports, if it carries one (see publicFacts.ts). */
  publicFactId: string | null;
  /** May the master clock legitimately be the CAUSE of this event? */
  clockMayCause: boolean;
  /** Story beat used for representation timing, when one exists. */
  representationBeat: StoryBeatId | null;
}>;

const row = (entry: CausalEventRegistration): CausalEventRegistration => Object.freeze({
  ...entry,
  causedBy: Object.freeze([...entry.causedBy]),
});

/**
 * Every significant public event of the D-006 experience. Ordered by causal
 * story position; live rows (sentinel/human) have no scheduled position.
 */
export const CAUSAL_EVENT_REGISTER: readonly CausalEventRegistration[] = Object.freeze([
  row({
    id: "mission-request",
    sourceType: "SIMULATED_WORLD_EVENT",
    sourceId: "story:passenger-request",
    trigger: "SCHEDULED_STORY_BEAT",
    observation: "Customer actor requests Taxi 07",
    actor: "You",
    causedBy: [],
    evidenceExpectation: "REQUIRED",
    evidenceRef: "visual:request",
    publicFactId: "fact.mission.requested",
    clockMayCause: true,
    representationBeat: "passenger-request",
  }),
  row({
    id: "mission-accepted",
    sourceType: "SYSTEM_DERIVED_EVENT",
    sourceId: "vehicle:acceptance",
    trigger: "DERIVED_FROM_WORLD_STATE",
    observation: "Taxi acknowledges the request",
    actor: "Vehicle",
    causedBy: ["mission-request"],
    evidenceExpectation: "REQUIRED",
    evidenceRef: "visual:accept",
    publicFactId: "fact.mission.accepted",
    clockMayCause: true,
    representationBeat: "mission-accepted",
  }),
  row({
    id: "base-departure",
    sourceType: "SIMULATED_WORLD_EVENT",
    sourceId: "vehicle:motion",
    trigger: "DERIVED_FROM_WORLD_STATE",
    observation: "Taxi visibly drives away from the base",
    actor: "Vehicle",
    causedBy: ["mission-accepted"],
    evidenceExpectation: "REQUIRED",
    evidenceRef: "runtime:d006nx0.action:depart-base",
    publicFactId: "fact.mission.departed",
    clockMayCause: true,
    representationBeat: "taxi-departs-base",
  }),
  row({
    id: "traffic-light-state",
    sourceType: "SIMULATED_WORLD_EVENT",
    sourceId: "city:signal",
    trigger: "SCHEDULED_STORY_BEAT",
    observation: "Signal lamp changes on the street",
    actor: "Smart Traffic Light",
    causedBy: [],
    evidenceExpectation: "REQUIRED",
    evidenceRef: "runtime:SIGNAL_STATE_PUBLISHED",
    publicFactId: "fact.road.signal",
    clockMayCause: true,
    representationBeat: "signal-yellow",
  }),
  row({
    id: "taxi-perception",
    sourceType: "SYSTEM_DERIVED_EVENT",
    sourceId: "vehicle:perception",
    trigger: "DERIVED_FROM_WORLD_STATE",
    observation: "Taxi marks the signal it observed",
    actor: "Taxi Perception",
    causedBy: ["traffic-light-state"],
    evidenceExpectation: "REQUIRED",
    evidenceRef: "runtime:d006g.perception:yellow",
    publicFactId: "fact.road.observed",
    clockMayCause: true,
    representationBeat: "taxi-observes-yellow",
  }),
  row({
    id: "taxi-decision",
    sourceType: "SYSTEM_DERIVED_EVENT",
    sourceId: "vehicle:autonomy",
    trigger: "DERIVED_FROM_WORLD_STATE",
    observation: "Taxi announces its own stop decision",
    actor: "Taxi Autonomy",
    causedBy: ["taxi-perception"],
    evidenceExpectation: "REQUIRED",
    evidenceRef: "runtime:d006g.decision:stop",
    publicFactId: null,
    clockMayCause: true,
    representationBeat: "taxi-decides-stop",
  }),
  row({
    id: "taxi-braking",
    sourceType: "SIMULATED_WORLD_EVENT",
    sourceId: "vehicle:brakes",
    trigger: "DERIVED_FROM_WORLD_STATE",
    observation: "Brake lights on; the taxi decelerates on its own decision",
    actor: "Vehicle",
    causedBy: ["taxi-decision"],
    evidenceExpectation: "REQUIRED",
    evidenceRef: "runtime:d006g.action:brake",
    publicFactId: "fact.road.braked",
    clockMayCause: true,
    representationBeat: "taxi-brake-applied",
  }),
  row({
    id: "vehicle-at-rest",
    sourceType: "SIMULATED_WORLD_EVENT",
    sourceId: "vehicle:motion",
    trigger: "DERIVED_FROM_WORLD_STATE",
    observation: "Taxi stands still before the stop line",
    actor: "Vehicle",
    causedBy: ["taxi-braking"],
    evidenceExpectation: "REQUIRED",
    evidenceRef: "runtime:d006g.result:at-rest",
    publicFactId: "fact.road.stopped",
    clockMayCause: true,
    representationBeat: "taxi-at-rest",
  }),
  row({
    id: "taxi-perception-green",
    sourceType: "SYSTEM_DERIVED_EVENT",
    sourceId: "vehicle:perception",
    trigger: "DERIVED_FROM_WORLD_STATE",
    observation: "Taxi marks the green it observed",
    actor: "Taxi Perception",
    causedBy: ["traffic-light-state", "vehicle-at-rest"],
    evidenceExpectation: "REQUIRED",
    evidenceRef: "runtime:d006g.perception:green",
    publicFactId: null,
    clockMayCause: true,
    representationBeat: "taxi-observes-green",
  }),
  row({
    id: "taxi-decision-proceed",
    sourceType: "SYSTEM_DERIVED_EVENT",
    sourceId: "vehicle:autonomy",
    trigger: "DERIVED_FROM_WORLD_STATE",
    observation: "Taxi announces its own decision to proceed",
    actor: "Taxi Autonomy",
    causedBy: ["taxi-perception-green"],
    evidenceExpectation: "REQUIRED",
    evidenceRef: "runtime:d006g.decision:proceed",
    publicFactId: null,
    clockMayCause: true,
    representationBeat: "taxi-decides-proceed",
  }),
  row({
    id: "vehicle-resume",
    sourceType: "SIMULATED_WORLD_EVENT",
    sourceId: "vehicle:motion",
    trigger: "DERIVED_FROM_WORLD_STATE",
    observation: "Taxi pulls away from the line on its own decision",
    actor: "Vehicle",
    causedBy: ["taxi-decision-proceed"],
    evidenceExpectation: "REQUIRED",
    evidenceRef: "runtime:d006g.action:resume",
    publicFactId: "fact.road.resumed",
    clockMayCause: true,
    representationBeat: "taxi-resumes",
  }),
  row({
    id: "passenger-boarding",
    sourceType: "SIMULATED_WORLD_EVENT",
    sourceId: "world:passenger",
    trigger: "SCHEDULED_STORY_BEAT",
    observation: "Passenger walks from the curb and enters the taxi; the cabin shows an occupant",
    actor: "Passenger",
    causedBy: ["base-departure"],
    evidenceExpectation: "REQUIRED",
    evidenceRef: "visual:pickup",
    publicFactId: "fact.passenger.boarded",
    clockMayCause: true,
    representationBeat: "passenger-pickup",
  }),
  row({
    id: "passenger-journey",
    sourceType: "SIMULATED_WORLD_EVENT",
    sourceId: "story:passenger-journey",
    trigger: "SCHEDULED_STORY_BEAT",
    observation: "Taxi drives away with the passenger aboard",
    actor: "Vehicle",
    causedBy: ["passenger-boarding"],
    evidenceExpectation: "REQUIRED",
    evidenceRef: "signed:d005.journey-executed",
    publicFactId: "fact.passenger.journey",
    clockMayCause: true,
    representationBeat: "passenger-journey",
  }),
  row({
    id: "passenger-exit",
    sourceType: "SIMULATED_WORLD_EVENT",
    sourceId: "world:passenger",
    trigger: "SCHEDULED_STORY_BEAT",
    observation: "Passenger steps out and stands at the destination; the cabin is empty; the taxi departs without them",
    actor: "Passenger",
    causedBy: ["passenger-journey"],
    evidenceExpectation: "REQUIRED",
    evidenceRef: "visual:dropoff",
    publicFactId: "fact.passenger.exited",
    clockMayCause: true,
    representationBeat: "passenger-dropoff",
  }),
  row({
    id: "traffic-congestion",
    sourceType: "SIMULATED_WORLD_EVENT",
    sourceId: "world:congestion",
    trigger: "SCHEDULED_STORY_BEAT",
    observation: "Queued vehicles appear ahead on the road",
    actor: "World",
    causedBy: [],
    evidenceExpectation: "REQUIRED",
    evidenceRef: "signed:d005.congestion-significant",
    publicFactId: null,
    clockMayCause: true,
    representationBeat: "congestion",
  }),
  row({
    id: "hazard-perception",
    sourceType: "SYSTEM_DERIVED_EVENT",
    sourceId: "vehicle:perception",
    trigger: "DERIVED_FROM_WORLD_STATE",
    observation: "Taxi marks the queue it observed ahead",
    actor: "Taxi Perception",
    causedBy: ["traffic-congestion"],
    evidenceExpectation: "REQUIRED",
    evidenceRef: "runtime:d006nx0.perception:congestion",
    publicFactId: "fact.route.congestion",
    clockMayCause: true,
    representationBeat: "taxi-observes-congestion",
  }),
  row({
    id: "hazard-decision",
    sourceType: "SYSTEM_DERIVED_EVENT",
    sourceId: "vehicle:autonomy",
    trigger: "DERIVED_FROM_WORLD_STATE",
    observation: "Taxi announces its decision to stop short of the queue",
    actor: "Taxi Autonomy",
    causedBy: ["hazard-perception"],
    evidenceExpectation: "REQUIRED",
    evidenceRef: "runtime:d006nx0.decision:hazard-stop",
    publicFactId: null,
    clockMayCause: true,
    representationBeat: "taxi-decides-hazard-stop",
  }),
  row({
    id: "hazard-braking",
    sourceType: "SIMULATED_WORLD_EVENT",
    sourceId: "vehicle:brakes",
    trigger: "DERIVED_FROM_WORLD_STATE",
    observation: "Brake lights on; the taxi decelerates short of the queue",
    actor: "Vehicle",
    causedBy: ["hazard-decision"],
    evidenceExpectation: "REQUIRED",
    evidenceRef: "runtime:d006nx0.action:hazard-brake",
    publicFactId: null,
    clockMayCause: true,
    representationBeat: "eta-at-risk",
  }),
  row({
    id: "hazard-stop",
    sourceType: "SIMULATED_WORLD_EVENT",
    sourceId: "vehicle:motion",
    trigger: "DERIVED_FROM_WORLD_STATE",
    observation: "Taxi stands still short of the queue and waits for a route",
    actor: "Vehicle",
    causedBy: ["hazard-braking"],
    evidenceExpectation: "REQUIRED",
    evidenceRef: "runtime:d006nx0.result:hazard-stop",
    publicFactId: "fact.route.stopped",
    clockMayCause: true,
    representationBeat: "routing-candidate-selected",
  }),
  row({
    id: "routing-request",
    sourceType: "SYSTEM_DERIVED_EVENT",
    sourceId: "routing:orchestrator",
    trigger: "DERIVED_FROM_WORLD_STATE",
    observation: "Routing panel opens with a live request",
    actor: "Routing",
    causedBy: ["traffic-congestion"],
    evidenceExpectation: "REQUIRED",
    evidenceRef: "runtime:ROUTING_PROVENANCE_RECORDED",
    publicFactId: null,
    clockMayCause: true,
    representationBeat: "routing-request",
  }),
  row({
    id: "routing-resolution",
    sourceType: "SYSTEM_DERIVED_EVENT",
    sourceId: "routing:orchestrator",
    trigger: "DERIVED_FROM_EVIDENCE",
    observation: "Resolved provider and resulting route shown; reroute executes only after",
    actor: "Routing",
    causedBy: ["routing-request"],
    evidenceExpectation: "REQUIRED",
    evidenceRef: "runtime:ROUTING_PROVENANCE_RECORDED",
    publicFactId: null,
    clockMayCause: true,
    representationBeat: "resulting-route-calculated",
  }),
  row({
    id: "reroute-execution",
    sourceType: "SIMULATED_WORLD_EVENT",
    sourceId: "vehicle:motion",
    trigger: "DERIVED_FROM_EVIDENCE",
    observation: "Taxi changes lane and passes the queue on the resolved route",
    actor: "Vehicle",
    causedBy: ["routing-resolution", "hazard-stop"],
    evidenceExpectation: "REQUIRED",
    evidenceRef: "runtime:d006nx0.action:reroute",
    publicFactId: "fact.route.rerouted",
    clockMayCause: true,
    representationBeat: "physical-reroute",
  }),
  row({
    id: "network-loss",
    sourceType: "PHYSICAL_SENTINEL_EVENT",
    sourceId: "sentinel:I226-LM",
    trigger: "PHYSICAL_OBSERVATION",
    observation: "Network status turns LOST only after the sentinel observes the cable out",
    actor: "Physical network",
    causedBy: [],
    evidenceExpectation: "REQUIRED",
    evidenceRef: "runtime:NETWORK_LINK_LOST",
    publicFactId: "fact.network.lost",
    clockMayCause: false,
    representationBeat: null,
  }),
  row({
    id: "offline-continuation",
    sourceType: "EVIDENCE_DERIVED_EVENT",
    sourceId: "journal:offline-window",
    trigger: "DERIVED_FROM_EVIDENCE",
    observation: "While the link is LOST the mission keeps moving and later evidence still lands in the tree",
    actor: "Evidence",
    causedBy: ["network-loss"],
    evidenceExpectation: "REQUIRED",
    evidenceRef: "closure:presented-evidence-inside-offline-window",
    publicFactId: "fact.network.continuedOffline",
    clockMayCause: false,
    representationBeat: null,
  }),
  row({
    id: "garage-authorization",
    sourceType: "SIMULATED_WORLD_EVENT",
    sourceId: "fleet:maintenance-authority",
    trigger: "SCHEDULED_STORY_BEAT",
    observation: "Fleet operations grants the maintenance proposal",
    actor: "Fleet Operations",
    causedBy: [],
    evidenceExpectation: "REQUIRED",
    evidenceRef: "visual:maintenance",
    publicFactId: "fact.garage.authorized",
    clockMayCause: true,
    representationBeat: "maintenance-authorized",
  }),
  row({
    id: "maintenance-start",
    sourceType: "SIMULATED_WORLD_EVENT",
    sourceId: "garage:work",
    trigger: "SCHEDULED_STORY_BEAT",
    observation: "Garage visibly begins work on the parked taxi",
    actor: "Garage",
    causedBy: ["garage-authorization"],
    evidenceExpectation: "REQUIRED",
    evidenceRef: "visual:work-begins",
    publicFactId: "fact.garage.started",
    clockMayCause: true,
    representationBeat: "work-in-progress",
  }),
  row({
    id: "maintenance-complete",
    sourceType: "SIMULATED_WORLD_EVENT",
    sourceId: "garage:work",
    trigger: "SCHEDULED_STORY_BEAT",
    observation: "Maintenance action ends after visible activity",
    actor: "Garage",
    causedBy: ["maintenance-start"],
    evidenceExpectation: "REQUIRED",
    evidenceRef: "visual:work",
    publicFactId: "fact.garage.completed",
    clockMayCause: true,
    representationBeat: "work-complete",
  }),
  row({
    id: "invoice",
    sourceType: "SIMULATED_WORLD_EVENT",
    sourceId: "garage:invoice",
    trigger: "SCHEDULED_STORY_BEAT",
    observation: "Garage presents the €1,850 invoice",
    actor: "Garage",
    causedBy: ["maintenance-complete"],
    evidenceExpectation: "REQUIRED",
    evidenceRef: "visual:invoice",
    publicFactId: "fact.payment.invoiced",
    clockMayCause: true,
    representationBeat: "invoice-1850",
  }),
  row({
    id: "payment-threshold",
    sourceType: "SYSTEM_DERIVED_EVENT",
    sourceId: "policy:spend-limit",
    trigger: "DERIVED_FROM_WORLD_STATE",
    observation: "€1,850 invoice exceeds the €500 autonomous limit; experience holds",
    actor: "Payment Policy",
    causedBy: ["invoice"],
    evidenceExpectation: "REQUIRED",
    evidenceRef: "visual:policy-exceeded",
    publicFactId: "fact.payment.thresholdExceeded",
    clockMayCause: true,
    representationBeat: "policy-exceeded",
  }),
  row({
    id: "human-payment-approval",
    sourceType: "USER_INTERACTION",
    sourceId: "viewer:allow-deny",
    trigger: "HUMAN_ACTION",
    observation: "Playback stays clamped at the boundary until ALLOW or DENY is pressed",
    actor: "Manager",
    causedBy: ["payment-threshold"],
    evidenceExpectation: "REQUIRED",
    evidenceRef: "visual:human",
    publicFactId: "fact.payment.humanApproved",
    clockMayCause: false,
    representationBeat: null,
  }),
  row({
    id: "human-payment-denial",
    sourceType: "USER_INTERACTION",
    sourceId: "viewer:allow-deny",
    trigger: "HUMAN_ACTION",
    observation: "DENY stops the mission at the boundary; the denial is written to the journal",
    actor: "Manager",
    causedBy: ["payment-threshold"],
    evidenceExpectation: "REQUIRED",
    evidenceRef: "runtime:d006nx0.human-decision:denied",
    publicFactId: "fact.payment.humanDenied",
    clockMayCause: false,
    representationBeat: null,
  }),
  row({
    id: "payment-authorization",
    sourceType: "SYSTEM_DERIVED_EVENT",
    sourceId: "policy:payment",
    trigger: "DERIVED_FROM_WORLD_STATE",
    observation: "Payment policy authorizes the instruction after the human approval",
    actor: "Payment Policy",
    causedBy: ["human-payment-approval"],
    evidenceExpectation: "REQUIRED",
    evidenceRef: "visual:authorized",
    publicFactId: "fact.payment.authorized",
    clockMayCause: true,
    representationBeat: "payment-authorized",
  }),
  row({
    id: "payment-submission",
    sourceType: "SYSTEM_DERIVED_EVENT",
    sourceId: "provider:payment",
    trigger: "DERIVED_FROM_WORLD_STATE",
    observation: "The payment provider presents the instruction to the bank",
    actor: "Payment Provider",
    causedBy: ["payment-authorization"],
    evidenceExpectation: "REQUIRED",
    evidenceRef: "runtime:d006g.payment-instruction-presented",
    publicFactId: "fact.payment.submitted",
    clockMayCause: true,
    representationBeat: "payment-instruction-presented",
  }),
  row({
    id: "payment-result",
    sourceType: "SYSTEM_DERIVED_EVENT",
    sourceId: "institution:bank",
    trigger: "DERIVED_FROM_WORLD_STATE",
    observation: "Bank authorization and confirmation appear; settlement is never shown",
    actor: "Bank",
    causedBy: ["payment-submission"],
    evidenceExpectation: "REQUIRED",
    evidenceRef: "runtime:d006g.bank-authorization",
    publicFactId: "fact.payment.bankAuthorized",
    clockMayCause: true,
    representationBeat: "bank-authorization",
  }),
  row({
    id: "network-restoration",
    sourceType: "PHYSICAL_SENTINEL_EVENT",
    sourceId: "sentinel:I226-LM",
    trigger: "PHYSICAL_OBSERVATION",
    observation: "Status returns to CONNECTED only after the sentinel observes the link",
    actor: "Physical network",
    causedBy: ["network-loss"],
    evidenceExpectation: "REQUIRED",
    evidenceRef: "runtime:NETWORK_LINK_RESTORED",
    publicFactId: "fact.network.restored",
    clockMayCause: false,
    representationBeat: null,
  }),
  row({
    id: "reconciliation",
    sourceType: "SYSTEM_DERIVED_EVENT",
    sourceId: "evidence:base-compare-transfer",
    trigger: "DERIVED_FROM_EVIDENCE",
    observation: "Local evidence is compared against the base and transferred; counts and digests shown",
    actor: "Evidence",
    causedBy: ["network-restoration", "network-loss"],
    evidenceExpectation: "REQUIRED",
    evidenceRef: "runtime:RECONCILIATION_RECEIPT",
    publicFactId: "fact.network.reconciled",
    clockMayCause: false,
    representationBeat: null,
  }),
  row({
    id: "return-to-base",
    sourceType: "SIMULATED_WORLD_EVENT",
    sourceId: "story:return",
    trigger: "SCHEDULED_STORY_BEAT",
    observation: "Taxi leaves the garage and parks at the base",
    actor: "Vehicle",
    causedBy: ["payment-result"],
    evidenceExpectation: "REQUIRED",
    evidenceRef: "visual:return-executed",
    publicFactId: "fact.mission.returned",
    clockMayCause: true,
    representationBeat: "leaving-garage",
  }),
  row({
    id: "mission-complete",
    sourceType: "SIMULATED_WORLD_EVENT",
    sourceId: "story:parked-at-base",
    trigger: "SCHEDULED_STORY_BEAT",
    observation: "Taxi parked; completion cue appears",
    actor: "Vehicle",
    causedBy: ["return-to-base"],
    evidenceExpectation: "REQUIRED",
    evidenceRef: "visual:complete",
    publicFactId: "fact.mission.completed",
    clockMayCause: true,
    representationBeat: "parked-at-base",
  }),
  row({
    id: "final-receipt",
    sourceType: "EVIDENCE_DERIVED_EVENT",
    sourceId: "closure:final-receipt",
    trigger: "DERIVED_FROM_EVIDENCE",
    observation: "Final Receipt lands on the tree only when the closure supports it",
    actor: "Evidence",
    causedBy: ["mission-complete"],
    evidenceExpectation: "REQUIRED",
    evidenceRef: "artifact:FINAL_RECEIPT",
    publicFactId: "fact.evidence.finalReceipt",
    clockMayCause: true,
    representationBeat: "master-cycle-receipt",
  }),
  row({
    id: "portable-handoff",
    sourceType: "USER_INTERACTION",
    sourceId: "viewer:carry-insert",
    trigger: "HUMAN_ACTION",
    observation: "Viewer takes the artifact and inserts it into the verifier",
    actor: "You",
    causedBy: ["final-receipt"],
    evidenceExpectation: "REQUIRED",
    evidenceRef: "artifact:PEB",
    publicFactId: null,
    clockMayCause: false,
    representationBeat: null,
  }),
  row({
    id: "verifier-analyze",
    sourceType: "USER_INTERACTION",
    sourceId: "viewer:analyze",
    trigger: "HUMAN_ACTION",
    observation: "Nothing analyzes until ANALYZE is pressed",
    actor: "You",
    causedBy: ["portable-handoff"],
    evidenceExpectation: "NONE",
    evidenceRef: null,
    publicFactId: null,
    clockMayCause: false,
    representationBeat: null,
  }),
  row({
    id: "verdict",
    sourceType: "EVIDENCE_DERIVED_EVENT",
    sourceId: "verifier:local",
    trigger: "DERIVED_FROM_EVIDENCE",
    observation: "Canonical verdict with the facts it does and does not support",
    actor: "Independent Verifier",
    causedBy: ["verifier-analyze"],
    evidenceExpectation: "NONE",
    evidenceRef: null,
    publicFactId: null,
    clockMayCause: false,
    representationBeat: null,
  }),
]);

export function causalEvent(id: string): CausalEventRegistration {
  const entry = CAUSAL_EVENT_REGISTER.find((candidate) => candidate.id === id);
  if (entry === undefined) throw new TypeError(`Unregistered causal event: ${id}`);
  return entry;
}

/** Rows the master clock must never cause. Read by tests and the audit. */
export function liveOnlyEvents(): readonly CausalEventRegistration[] {
  return CAUSAL_EVENT_REGISTER.filter((entry) => !entry.clockMayCause);
}

/**
 * The machine-readable form required by the C3 mandate (§23). Deterministic:
 * the same register always serializes to the same JSON text.
 */
export function serializeCausalEventRegister(): string {
  return `${JSON.stringify({
    register: "fortix.d006.c3.live-causal-event-register",
    version: 2,
    grammar: "FACTS -> EVIDENCE -> VERIFY",
    clockDoctrine: "Time says when something is represented; source says why it happened.",
    events: CAUSAL_EVENT_REGISTER,
  }, null, 2)}\n`;
}

const EVIDENCE_REF_GRAMMAR = /^(visual|runtime|signed|artifact|closure):[A-Za-z0-9_.:-]+$/;

/**
 * Register invariants, callable from tests:
 * live rows carry no scheduled trigger and no representation beat obligation;
 * every causal parent exists; scheduled rows point at real story beats; a
 * required evidence reference follows the reference grammar.
 */
export function causalRegisterViolations(): readonly string[] {
  const ids = new Set(CAUSAL_EVENT_REGISTER.map((entry) => entry.id));
  const violations: string[] = [];
  if (ids.size !== CAUSAL_EVENT_REGISTER.length) violations.push("duplicate register ids");
  for (const entry of CAUSAL_EVENT_REGISTER) {
    for (const parent of entry.causedBy) {
      if (!ids.has(parent)) violations.push(`${entry.id}: unknown causal parent ${parent}`);
    }
    if (!entry.clockMayCause && entry.trigger === "SCHEDULED_STORY_BEAT") {
      violations.push(`${entry.id}: live event carries a scheduled trigger`);
    }
    if (!entry.clockMayCause && entry.representationBeat !== null) {
      violations.push(`${entry.id}: live event pinned to a story beat`);
    }
    if (entry.sourceType === "PHYSICAL_SENTINEL_EVENT" && entry.trigger !== "PHYSICAL_OBSERVATION") {
      violations.push(`${entry.id}: sentinel event without physical observation trigger`);
    }
    if (entry.sourceType === "USER_INTERACTION" && entry.trigger !== "HUMAN_ACTION") {
      violations.push(`${entry.id}: user interaction without human trigger`);
    }
    if (entry.representationBeat !== null && !(entry.representationBeat in STORY_BEAT_TIME_MS)) {
      violations.push(`${entry.id}: unknown story beat ${entry.representationBeat}`);
    }
    if (entry.evidenceExpectation === "REQUIRED" && entry.evidenceRef === null) {
      violations.push(`${entry.id}: evidence required but no reference declared`);
    }
    if (entry.evidenceRef !== null && !EVIDENCE_REF_GRAMMAR.test(entry.evidenceRef)) {
      violations.push(`${entry.id}: evidence reference outside the grammar: ${entry.evidenceRef}`);
    }
  }
  return Object.freeze(violations);
}

import { CAUSAL_EVENT_REGISTER, causalEvent, type EventSourceType } from "./eventSources.ts";
import { HUMAN_DENIAL_EVENT_ID } from "./humanAuthorityEvidence.ts";
import { MISSION_EVIDENCE_SPECS } from "./missionEvidence.ts";
import type { OfflineCausalRecord } from "./offlineEvidence.ts";
import type { MissionEvidenceClosure } from "./portableMissionEvidence.ts";
import { PUBLIC_FACT_DEFINITIONS } from "./publicFacts.ts";
import { STORY_BEAT_TIME_MS, type StoryBeatId } from "./storyTimeline.ts";

/**
 * D-006 NX0 — the significant-action evidence matrix, as code.
 *
 * RULE (mandate §2): EVERY SIGNIFICANT OBSERVABLE ACTION MUST HAVE AN EXPLICIT
 * EVIDENCE DECISION — RECEIPT or JUSTIFIED_NO_RECEIPT. There is no UNKNOWN and
 * no UNDECIDED: the type does not admit them, and a row that says RECEIPT
 * must resolve to a real evidence object in a built closure, or the audit
 * fails. The markdown and JSON artifacts under artifacts/d006-nx0 are
 * GENERATED from this table so the document cannot drift from the engine.
 *
 * A JUSTIFIED_NO_RECEIPT is a decision, not an omission. Every one states why
 * the action is attested by a neighbouring object or is a state rather than
 * an act, and what would be wrong with minting a receipt for it — receipts
 * for animation frames are the failure mode this register exists to prevent.
 */

export type EvidenceDecision = "RECEIPT" | "JUSTIFIED_NO_RECEIPT";

export type CanonicalEventRef =
  /** One runtime journal record, by event id. */
  | Readonly<{ kind: "RUNTIME_RECORD"; eventId: string }>
  /** Runtime journal records of one type (the signal publishes four states). */
  | Readonly<{ kind: "RUNTIME_EVENT_TYPE"; eventType: string }>
  /** One signed D-005 / D-005M object, by significant event id. */
  | Readonly<{ kind: "SIGNED_EVENT"; eventId: string }>
  /** A live record only a physical observation or performed operation can author. */
  | Readonly<{ kind: "LIVE_RECORD"; eventType: "NETWORK_LINK_LOST" | "NETWORK_LINK_RESTORED" | "RECONCILIATION_RECEIPT" }>
  /** A mission artifact with its own identity and digest. */
  | Readonly<{ kind: "ARTIFACT"; artifact: "FINAL_RECEIPT" | "PEB" | "HANDOFF" }>
  /** A query over the closure/journal, stated so it can be evaluated. */
  | Readonly<{ kind: "CLOSURE_QUERY"; query: string }>
  /** A persisting state produced by another row's action. Never receipted. */
  | Readonly<{ kind: "STATE"; consequenceOf: string }>
  /** A human interaction that must not author mission evidence. */
  | Readonly<{ kind: "INTERACTION"; control: string }>
  /** The verifier's conclusion. Not evidence, by definition. */
  | Readonly<{ kind: "VERIFIER_OUTPUT" }>;

export type SignificantAction = Readonly<{
  id: string;
  /** Short public phrasing (EN), as the audience would say it. */
  publicEvent: string;
  /** What is observable in the world when it happens. */
  observableInWorld: string;
  canonicalEvent: CanonicalEventRef;
  /** The causal register row this action is, when it is public. */
  registerEventId: string | null;
  sourceType: EventSourceType;
  significant: true;
  evidenceDecision: EvidenceDecision;
  /** Receipt / object type when RECEIPT. */
  receiptType: string | null;
  /** The reason when JUSTIFIED_NO_RECEIPT. */
  justification: string | null;
  publicFactId: string | null;
  /** Matrix id of the causal parent action. */
  causalParent: string | null;
  /** Test files that exercise this row. */
  testCoverage: readonly string[];
  storyBeat: StoryBeatId | null;
}>;

type ReceiptRow = Readonly<{
  id: string;
  publicEvent: string;
  observableInWorld: string;
  canonicalEvent: Exclude<CanonicalEventRef, { kind: "STATE" | "INTERACTION" | "VERIFIER_OUTPUT" }>;
  registerEventId?: string | null;
  sourceType?: EventSourceType;
  receiptType: string;
  publicFactId?: string | null;
  causalParent: string | null;
  testCoverage: readonly string[];
  storyBeat?: StoryBeatId | null;
}>;

type NoReceiptRow = Readonly<{
  id: string;
  publicEvent: string;
  observableInWorld: string;
  canonicalEvent: Extract<CanonicalEventRef, { kind: "STATE" | "INTERACTION" | "VERIFIER_OUTPUT" }>;
  registerEventId?: string | null;
  sourceType: EventSourceType;
  justification: string;
  publicFactId?: string | null;
  causalParent: string | null;
  testCoverage: readonly string[];
  storyBeat?: StoryBeatId | null;
}>;

const T = Object.freeze({
  nx0: "d006nx0-evidence-completeness.test.ts",
  trust: "d006g-trust-boundaries.test.ts",
  receipts: "d006c1-receipt-projection.test.ts",
  portable: "d006c1-portable-evidence.test.ts",
  c3: "d006c3-live-causality.test.ts",
  network: "d006d-network-transitions.test.ts",
  networkEvidence: "d006g-p3-network-evidence.test.ts",
  offline: "d006d-offline-evidence.test.ts",
  continuity: "d006c-evidence-continuity.test.ts",
  reconciliation: "d006e-reconciliation-idempotency.test.ts",
  review: "review-flow.test.ts",
  participation: "d006b1-participation.test.ts",
  verification: "d006d-offline-verification.test.ts",
  routing: "d006c-routing-provenance.test.ts",
  financial: "d006c1-financial-closure.test.ts",
  master: "master-story.test.ts",
  physical: "physical-sync.test.ts",
  timeline: "d006c-story-timeline.test.ts",
});

function receipt(input: ReceiptRow): SignificantAction {
  const register = input.registerEventId ?? null;
  const sourceType = input.sourceType ?? (register === null ? undefined : causalEvent(register).sourceType);
  if (sourceType === undefined) throw new TypeError(`${input.id}: source type required when no register row is named`);
  return Object.freeze({
    id: input.id,
    publicEvent: input.publicEvent,
    observableInWorld: input.observableInWorld,
    canonicalEvent: Object.freeze({ ...input.canonicalEvent }),
    registerEventId: register,
    sourceType,
    significant: true,
    evidenceDecision: "RECEIPT",
    receiptType: input.receiptType,
    justification: null,
    publicFactId: input.publicFactId ?? (register === null ? null : causalEvent(register).publicFactId),
    causalParent: input.causalParent,
    testCoverage: Object.freeze([...input.testCoverage]),
    storyBeat: input.storyBeat ?? (register === null ? null : causalEvent(register).representationBeat),
  });
}

function noReceipt(input: NoReceiptRow): SignificantAction {
  return Object.freeze({
    id: input.id,
    publicEvent: input.publicEvent,
    observableInWorld: input.observableInWorld,
    canonicalEvent: Object.freeze({ ...input.canonicalEvent }),
    registerEventId: input.registerEventId ?? null,
    sourceType: input.sourceType,
    significant: true,
    evidenceDecision: "JUSTIFIED_NO_RECEIPT",
    receiptType: null,
    justification: input.justification,
    publicFactId: input.publicFactId ?? null,
    causalParent: input.causalParent,
    testCoverage: Object.freeze([...input.testCoverage]),
    storyBeat: input.storyBeat ?? null,
  });
}

const runtime = (eventId: string) => ({ kind: "RUNTIME_RECORD", eventId }) as const;
const signed = (eventId: string) => ({ kind: "SIGNED_EVENT", eventId }) as const;

/** Every significant observable action of the D-006 mission, in mission order. */
export const SIGNIFICANT_ACTION_REGISTER: readonly SignificantAction[] = Object.freeze([
  // --- mission start ------------------------------------------------------
  receipt({
    id: "mission-requested",
    publicEvent: "Taxi 07 was requested.",
    observableInWorld: "The customer figure calls the taxi; the request receipt leaves the customer",
    canonicalEvent: signed("d005.passenger-request"),
    registerEventId: "mission-request",
    receiptType: "SIGNED · Passenger service request (d005.passenger-request)",
    causalParent: null,
    testCoverage: [T.receipts, T.c3],
  }),
  receipt({
    id: "mission-accepted",
    publicEvent: "The taxi accepted the mission.",
    observableInWorld: "Taxi 07 acknowledges on stage (ACCEPTED status on the vehicle)",
    canonicalEvent: signed("d005.mission-accepted"),
    registerEventId: "mission-accepted",
    receiptType: "SIGNED · Taxi autonomy acceptance (d005.mission-accepted) — NX0: bound explicitly by its own signed event; C3 could never support this fact",
    causalParent: "mission-requested",
    testCoverage: [T.nx0, T.receipts],
  }),
  receipt({
    id: "taxi-leaves-base",
    publicEvent: "The taxi left the base.",
    observableInWorld: "The taxi drives away from the base parking anchor",
    canonicalEvent: runtime("d006nx0.action:depart-base"),
    registerEventId: "base-departure",
    receiptType: "VEHICLE_ACTION (NR-ACTION:depart-base) — admitted only while the simulated vehicle is cruising away",
    causalParent: "mission-accepted",
    testCoverage: [T.nx0],
  }),
  // --- the intersection: world → perception → decision → action → result ----
  receipt({
    id: "traffic-light-state",
    publicEvent: "The traffic light changed.",
    observableInWorld: "The signal head changes lamp: green, yellow, red, green",
    canonicalEvent: { kind: "RUNTIME_EVENT_TYPE", eventType: "SIGNAL_STATE_PUBLISHED" },
    registerEventId: "traffic-light-state",
    receiptType: "SIGNAL_STATE_PUBLISHED × 4 (NR-SIGNAL-STATE:green-1 / yellow / red / green-2)",
    causalParent: "taxi-leaves-base",
    testCoverage: [T.trust, T.c3],
  }),
  receipt({
    id: "city-detection",
    publicEvent: "The city sensed an approaching vehicle.",
    observableInWorld: "The city infrastructure scans; its beam sweeps the approach",
    canonicalEvent: runtime("d006g.city-detection"),
    sourceType: "SIMULATED_WORLD_EVENT",
    receiptType: "CITY_SENSOR_DETECTION (NR-CITY-DETECTION:approach)",
    causalParent: "traffic-light-state",
    testCoverage: [T.trust],
    storyBeat: "city-detection",
  }),
  receipt({
    id: "taxi-perception",
    publicEvent: "The taxi saw the yellow light.",
    observableInWorld: "The taxi's sensors mark the signal; a perception receipt leaves the taxi",
    canonicalEvent: runtime("d006g.perception:yellow"),
    registerEventId: "taxi-perception",
    receiptType: "VEHICLE_OBSERVATION (NR-PERCEPTION:yellow) — signal named as observed_input, never as cause",
    causalParent: "traffic-light-state",
    testCoverage: [T.trust, T.nx0],
  }),
  receipt({
    id: "brake-decision",
    publicEvent: "The taxi decided to stop.",
    observableInWorld: "The taxi announces its own stop decision before the light is red",
    canonicalEvent: runtime("d006g.decision:stop"),
    registerEventId: "taxi-decision",
    receiptType: "AUTONOMOUS_DECISION (NR-DECISION:stop) — two admissible actions, instructed_by null",
    causalParent: "taxi-perception",
    testCoverage: [T.trust, T.nx0],
  }),
  receipt({
    id: "brake-action",
    publicEvent: "The taxi braked.",
    observableInWorld: "Brake lamps on; the taxi decelerates toward the stop line",
    canonicalEvent: runtime("d006g.action:brake"),
    registerEventId: "taxi-braking",
    receiptType: "VEHICLE_ACTION (NR-ACTION:brake) — NX0: admitted only while the vehicle is in BRAKING_ON_OWN_DECISION with brake lights on",
    causalParent: "brake-decision",
    testCoverage: [T.nx0, T.trust],
  }),
  receipt({
    id: "vehicle-stopped",
    publicEvent: "The taxi stopped before the line.",
    observableInWorld: "The taxi stands still short of the stop line while the light is red",
    canonicalEvent: runtime("d006g.result:at-rest"),
    registerEventId: "vehicle-at-rest",
    receiptType: "VEHICLE_RESULT (NR-RESULT:at-rest) — NX0: admitted only while the vehicle is STOPPED_AT_LINE at speed 0",
    causalParent: "brake-action",
    testCoverage: [T.nx0, T.trust],
  }),
  receipt({
    id: "city-phase-decision",
    publicEvent: "The city chose its next signal phase.",
    observableInWorld: "The city infrastructure decides, then publishes green",
    canonicalEvent: runtime("d006g.city-phase-decision"),
    sourceType: "SIMULATED_WORLD_EVENT",
    receiptType: "SIGNAL_PHASE_DECIDED (NR-CITY-PHASE:next) — subject is the signal's own phase",
    causalParent: "traffic-light-state",
    testCoverage: [T.trust],
    storyBeat: "city-phase-decision",
  }),
  receipt({
    id: "taxi-perception-green",
    publicEvent: "The taxi saw the green light.",
    observableInWorld: "The taxi's sensors mark the green signal",
    canonicalEvent: runtime("d006g.perception:green"),
    registerEventId: "taxi-perception-green",
    receiptType: "VEHICLE_OBSERVATION (NR-PERCEPTION:green)",
    causalParent: "vehicle-stopped",
    testCoverage: [T.trust],
  }),
  receipt({
    id: "proceed-decision",
    publicEvent: "The taxi decided to continue.",
    observableInWorld: "The taxi announces its decision to proceed on two inputs: the green it saw and its own at-rest check",
    canonicalEvent: runtime("d006g.decision:proceed"),
    registerEventId: "taxi-decision-proceed",
    receiptType: "AUTONOMOUS_DECISION (NR-DECISION:proceed)",
    causalParent: "taxi-perception-green",
    testCoverage: [T.trust],
  }),
  receipt({
    id: "vehicle-resumed",
    publicEvent: "The taxi moved on.",
    observableInWorld: "The taxi pulls away from the line; brake lamps off",
    canonicalEvent: runtime("d006g.action:resume"),
    registerEventId: "vehicle-resume",
    receiptType: "VEHICLE_ACTION (NR-ACTION:resume) — NX0: admitted only while the vehicle is RESUMING_ON_OWN_DECISION",
    causalParent: "proceed-decision",
    testCoverage: [T.nx0, T.trust],
  }),
  // --- the passenger --------------------------------------------------------
  noReceipt({
    id: "taxi-arrives-pickup",
    publicEvent: "The taxi pulled up at the pickup.",
    observableInWorld: "The taxi decelerates and aligns with the passenger pickup anchor",
    canonicalEvent: { kind: "STATE", consequenceOf: "vehicle-resumed" },
    sourceType: "SIMULATED_WORLD_EVENT",
    justification: "Alignment at the pickup anchor is the physical precondition of boarding, and the boarding object (d005.pickup-confirmed, Passenger service) attests the encounter at that position. A vehicle arrival receipt would restate the same event from the vehicle's side without adding a distinct fact; the spectator sees the alignment and then the boarding it enables.",
    causalParent: "vehicle-resumed",
    testCoverage: [T.physical, T.c3],
    storyBeat: "taxi-aligned-pickup",
  }),
  receipt({
    id: "passenger-boards",
    publicEvent: "The passenger boarded.",
    observableInWorld: "The passenger walks from the curb to the door and disappears from the street; the cabin shows an occupant",
    canonicalEvent: signed("d005.pickup-confirmed"),
    registerEventId: "passenger-boarding",
    receiptType: "SIGNED · Passenger service pickup confirmation (d005.pickup-confirmed)",
    causalParent: "taxi-arrives-pickup",
    testCoverage: [T.c3, T.receipts],
  }),
  noReceipt({
    id: "passenger-aboard",
    publicEvent: "The passenger was aboard.",
    observableInWorld: "The cabin is visibly occupied while the street shows no passenger",
    canonicalEvent: { kind: "STATE", consequenceOf: "passenger-boards" },
    sourceType: "SIMULATED_WORLD_EVENT",
    justification: "Aboard is the persisting state produced by boarding, not an action. The cabin occupant on stage renders that state and the boarding receipt is its evidence; a receipt for each frame of being aboard would be a receipt for an animation.",
    causalParent: "passenger-boards",
    testCoverage: [T.c3],
    storyBeat: "passenger-pickup",
  }),
  receipt({
    id: "taxi-departs-with-passenger",
    publicEvent: "The taxi drove the passenger to the destination.",
    observableInWorld: "The taxi leaves the pickup with the cabin occupied and cruises to the destination",
    canonicalEvent: signed("d005.journey-executed"),
    registerEventId: "passenger-journey",
    receiptType: "SIGNED · Taxi autonomy journey execution (d005.journey-executed)",
    causalParent: "passenger-aboard",
    testCoverage: [T.nx0, T.master],
  }),
  noReceipt({
    id: "taxi-arrives-destination",
    publicEvent: "The taxi pulled up at the destination.",
    observableInWorld: "The taxi decelerates and aligns with the drop-off anchor",
    canonicalEvent: { kind: "STATE", consequenceOf: "taxi-departs-with-passenger" },
    sourceType: "SIMULATED_WORLD_EVENT",
    justification: "Symmetrical with the pickup: the drop-off confirmation (d005.dropoff-confirmed) attests the encounter at the destination anchor, and a separate arrival receipt would add no distinct fact.",
    causalParent: "taxi-departs-with-passenger",
    testCoverage: [T.physical, T.c3],
    storyBeat: "passenger-destination-approach",
  }),
  receipt({
    id: "passenger-exits",
    publicEvent: "The passenger got out.",
    observableInWorld: "The passenger steps out and stands at the destination; the cabin is empty",
    canonicalEvent: signed("d005.dropoff-confirmed"),
    registerEventId: "passenger-exit",
    receiptType: "SIGNED · Passenger service drop-off confirmation (d005.dropoff-confirmed)",
    causalParent: "taxi-arrives-destination",
    testCoverage: [T.c3, T.receipts],
  }),
  receipt({
    id: "garage-mission-handover",
    publicEvent: "Maintenance became the next mission.",
    observableInWorld: "Fleet operations hands the taxi its next mission while the passenger stands on the curb",
    canonicalEvent: signed("d005.maintenance-intent"),
    sourceType: "SIMULATED_WORLD_EVENT",
    receiptType: "SIGNED · Fleet operations maintenance intent (d005.maintenance-intent)",
    causalParent: "passenger-exits",
    testCoverage: [T.receipts, T.master],
    storyBeat: "garage-mission-begins",
  }),
  receipt({
    id: "taxi-departs-without-passenger",
    publicEvent: "The taxi headed for the garage without the passenger.",
    observableInWorld: "The taxi drives off toward the garage; the passenger stays standing at the destination",
    canonicalEvent: signed("d005.garage-route-a"),
    sourceType: "SIMULATED_WORLD_EVENT",
    receiptType: "SIGNED · Navigation Provider A route start (d005.garage-route-a) — the departure executes this route",
    causalParent: "garage-mission-handover",
    testCoverage: [T.c3, T.receipts],
    storyBeat: "normal-route-to-garage",
  }),
  // --- the obstacle: world → perception → decision → action → result ------
  receipt({
    id: "traffic-congestion",
    publicEvent: "Traffic built up ahead.",
    observableInWorld: "A queue of vehicles appears on the road ahead of the taxi",
    canonicalEvent: signed("d005.congestion-significant"),
    registerEventId: "traffic-congestion",
    receiptType: "SIGNED · Traffic Provider congestion report (d005.congestion-significant)",
    causalParent: "taxi-departs-without-passenger",
    testCoverage: [T.master, T.receipts],
  }),
  receipt({
    id: "hazard-perception",
    publicEvent: "The taxi saw the queue.",
    observableInWorld: "The taxi's sensors mark the queue ahead; a perception receipt leaves the taxi",
    canonicalEvent: runtime("d006nx0.perception:congestion"),
    registerEventId: "hazard-perception",
    receiptType: "VEHICLE_OBSERVATION (NR-PERCEPTION:congestion) — NX0: Traffic Provider object as observed_input",
    causalParent: "traffic-congestion",
    testCoverage: [T.nx0],
  }),
  receipt({
    id: "hazard-decision",
    publicEvent: "The taxi decided to stop short of the queue.",
    observableInWorld: "The taxi announces its decision: stop short of the hazard rather than follow the queue",
    canonicalEvent: runtime("d006nx0.decision:hazard-stop"),
    registerEventId: "hazard-decision",
    receiptType: "AUTONOMOUS_DECISION (NR-DECISION:hazard-stop) — NX0: two admissible actions",
    causalParent: "hazard-perception",
    testCoverage: [T.nx0],
  }),
  receipt({
    id: "hazard-brake-action",
    publicEvent: "The taxi braked hard.",
    observableInWorld: "Brake lamps on; the taxi decelerates short of the queue (the featured 'brake' beat)",
    canonicalEvent: runtime("d006nx0.action:hazard-brake"),
    registerEventId: "hazard-braking",
    receiptType: "VEHICLE_ACTION (NR-ACTION:hazard-brake) — NX0 CLOSES THE KNOWN GAP: admitted only while the vehicle is in EMERGENCY_BRAKING",
    causalParent: "hazard-decision",
    testCoverage: [T.nx0],
  }),
  receipt({
    id: "eta-at-risk",
    publicEvent: "The taxi judged its arrival at risk.",
    observableInWorld: "The routing cue opens: the arrival constraint is at risk",
    canonicalEvent: signed("d005.eta-deteriorates"),
    sourceType: "SYSTEM_DERIVED_EVENT",
    receiptType: "SIGNED · Taxi autonomy constraint assessment (d005.eta-deteriorates)",
    causalParent: "hazard-perception",
    testCoverage: [T.routing, T.master],
    storyBeat: "eta-at-risk",
  }),
  receipt({
    id: "hazard-stop",
    publicEvent: "The taxi stopped short of the queue.",
    observableInWorld: "The taxi stands still short of the queue and waits for a route",
    canonicalEvent: runtime("d006nx0.result:hazard-stop"),
    registerEventId: "hazard-stop",
    receiptType: "VEHICLE_RESULT (NR-RESULT:hazard-stop) — NX0: admitted only while the vehicle is WAITING_FOR_ROUTE at speed 0",
    causalParent: "hazard-brake-action",
    testCoverage: [T.nx0],
  }),
  // --- routing ---------------------------------------------------------------
  receipt({
    id: "routing-requested",
    publicEvent: "A new route was requested.",
    observableInWorld: "The routing cue shows a live request",
    canonicalEvent: runtime("d006.c1.routing-provenance"),
    registerEventId: "routing-request",
    receiptType: "ROUTING_PROVENANCE_RECORDED (NR-ROUTING-PROVENANCE:garage-reroute) · routing_request",
    causalParent: "eta-at-risk",
    testCoverage: [T.routing, T.portable],
  }),
  receipt({
    id: "provider-selection",
    publicEvent: "A route provider was chosen.",
    observableInWorld: "The routing cue names the selected provider/model/source",
    canonicalEvent: runtime("d006.c1.routing-provenance"),
    registerEventId: "routing-request",
    receiptType: "ROUTING_PROVENANCE_RECORDED · selected_source / selected_model / selected_provider",
    publicFactId: null,
    causalParent: "routing-requested",
    testCoverage: [T.routing, T.portable],
    storyBeat: "routing-candidate-selected",
  }),
  receipt({
    id: "provider-resolution",
    publicEvent: "The route was resolved.",
    observableInWorld: "The routing cue shows the resolved provider, the fallback if selected ≠ resolved, and the resulting route",
    canonicalEvent: runtime("d006.c1.routing-provenance"),
    registerEventId: "routing-resolution",
    receiptType: "ROUTING_PROVENANCE_RECORDED · resolved_* / fallback / resulting_route",
    causalParent: "provider-selection",
    testCoverage: [T.routing, T.portable],
  }),
  receipt({
    id: "reroute-authorized",
    publicEvent: "The reroute was authorized.",
    observableInWorld: "The 'reroute' beat: the taxi's own authority accepts the alternate route",
    canonicalEvent: signed("d005.reroute-authorized"),
    sourceType: "SYSTEM_DERIVED_EVENT",
    receiptType: "SIGNED · Taxi autonomy reroute authorization (d005.reroute-authorized)",
    causalParent: "provider-resolution",
    testCoverage: [T.receipts, T.master],
    storyBeat: "reroute-authorized",
  }),
  receipt({
    id: "route-changed",
    publicEvent: "Provider B supplied the new route.",
    observableInWorld: "The alternate route becomes the active route on the routing cue",
    canonicalEvent: signed("d005.route-b-executed"),
    sourceType: "SYSTEM_DERIVED_EVENT",
    receiptType: "SIGNED · Navigation Provider B alternate route (d005.route-b-executed)",
    causalParent: "reroute-authorized",
    testCoverage: [T.master, T.timeline],
    storyBeat: "physical-reroute",
  }),
  receipt({
    id: "reroute-execution",
    publicEvent: "The taxi took the new route.",
    observableInWorld: "The taxi changes lane, passes the queue and merges back",
    canonicalEvent: runtime("d006nx0.action:reroute"),
    registerEventId: "reroute-execution",
    receiptType: "VEHICLE_ACTION (NR-ACTION:reroute) — NX0: admitted only while the vehicle is REROUTING, which the motion model refuses without routing evidence",
    causalParent: "route-changed",
    testCoverage: [T.nx0],
  }),
  // --- the physical network -------------------------------------------------
  receipt({
    id: "ethernet-loss",
    publicEvent: "The connection was lost.",
    observableInWorld: "The RJ45 cable is pulled; the sentinel reports the I226-LM link down; status turns LOST",
    canonicalEvent: { kind: "LIVE_RECORD", eventType: "NETWORK_LINK_LOST" },
    registerEventId: "network-loss",
    receiptType: "NETWORK_LINK_LOST (NR-NET-LOST:<observation digest>) — authored only from a fresh physical sentinel observation",
    causalParent: null,
    testCoverage: [T.network, T.networkEvidence, T.c3],
  }),
  receipt({
    id: "offline-continuation",
    publicEvent: "The mission continued.",
    observableInWorld: "The taxi keeps moving and later evidence keeps landing while status reads LOST",
    canonicalEvent: { kind: "CLOSURE_QUERY", query: "first PRESENTED closure member or non-network journal record dated inside (LOST observed time, RESTORED observed time]" },
    registerEventId: "offline-continuation",
    receiptType: "JOURNAL / CLOSURE · presented evidence dated inside the offline window, cited beside NR-NET-LOST",
    causalParent: "ethernet-loss",
    testCoverage: [T.nx0],
  }),
  receipt({
    id: "local-evidence-continuation",
    publicEvent: "Evidence kept being created locally.",
    observableInWorld: "Status reads LOCAL evidence; new receipts still land in the tree",
    canonicalEvent: { kind: "CLOSURE_QUERY", query: "runtime records appended after NR-NET-LOST carry evidenceLocality LOCAL and executionLocality LOCAL; NR-NET-LOST itself is the first such record" },
    registerEventId: "offline-continuation",
    receiptType: "JOURNAL · evidenceLocality LOCAL on the loss receipt and every later append until reconciliation",
    publicFactId: null,
    causalParent: "ethernet-loss",
    testCoverage: [T.offline, T.continuity],
  }),
  // --- the garage ------------------------------------------------------------
  receipt({
    id: "garage-arrival",
    publicEvent: "The taxi reached the garage.",
    observableInWorld: "The taxi decelerates and stops at the garage service anchor",
    canonicalEvent: signed("d005.garage-arrival"),
    sourceType: "SIMULATED_WORLD_EVENT",
    receiptType: "SIGNED · Garage arrival within appointment constraint (d005.garage-arrival)",
    causalParent: "reroute-execution",
    testCoverage: [T.receipts, T.master],
    storyBeat: "garage-arrival",
  }),
  receipt({
    id: "garage-received",
    publicEvent: "The garage received the taxi.",
    observableInWorld: "The garage takes the matched vehicle in",
    canonicalEvent: signed("d005.garage-received"),
    sourceType: "SIMULATED_WORLD_EVENT",
    receiptType: "SIGNED · Garage receives matched vehicle (d005.garage-received)",
    causalParent: "garage-arrival",
    testCoverage: [T.master],
    storyBeat: "maintenance-begins",
  }),
  receipt({
    id: "diagnosis",
    publicEvent: "The garage ran a diagnostic.",
    observableInWorld: "The maintenance system reports its diagnostic",
    canonicalEvent: signed("d005.diagnostic"),
    sourceType: "SYSTEM_DERIVED_EVENT",
    receiptType: "SIGNED · Maintenance system diagnostic (d005.diagnostic)",
    causalParent: "garage-received",
    testCoverage: [T.master],
    storyBeat: "diagnosis",
  }),
  receipt({
    id: "maintenance-authority-requested",
    publicEvent: "The garage proposed the work.",
    observableInWorld: "The maintenance proposal is put to fleet authority",
    canonicalEvent: signed("d005.maintenance-proposal"),
    sourceType: "SYSTEM_DERIVED_EVENT",
    receiptType: "SIGNED · Maintenance proposal issued (d005.maintenance-proposal)",
    causalParent: "diagnosis",
    testCoverage: [T.master],
    storyBeat: "maintenance-proposal",
  }),
  receipt({
    id: "maintenance-authorization",
    publicEvent: "Maintenance was authorized.",
    observableInWorld: "Fleet operations grants the scope (fleet policy authority; the live human decision is the payment)",
    canonicalEvent: signed("d005.maintenance-authorized"),
    registerEventId: "garage-authorization",
    receiptType: "SIGNED · Fleet operations scope authorization (d005.maintenance-authorized)",
    causalParent: "maintenance-authority-requested",
    testCoverage: [T.receipts, T.c3],
  }),
  receipt({
    id: "maintenance-started",
    publicEvent: "Work began.",
    observableInWorld: "The garage's tool starts moving on the parked taxi",
    canonicalEvent: signed("d005.maintenance-executed"),
    registerEventId: "maintenance-start",
    receiptType: "SIGNED · Garage 'authorized work begins' (d005.maintenance-executed) — NX0: previously registered as producing no evidence although the signed object exists",
    causalParent: "maintenance-authorization",
    testCoverage: [T.nx0, T.master],
  }),
  noReceipt({
    id: "maintenance-performed",
    publicEvent: "Work was being done.",
    observableInWorld: "The garage's tool works on the taxi between the start and the completion",
    canonicalEvent: { kind: "STATE", consequenceOf: "maintenance-started" },
    sourceType: "SIMULATED_WORLD_EVENT",
    justification: "The work in progress is the physical activity between the 'work begins' object and the completion object; the garage's completion evidence attests that it was performed. Frames of the tool moving are not evidence and receipts for them would be receipts for animation.",
    causalParent: "maintenance-started",
    testCoverage: [T.physical, T.c3],
    storyBeat: "work-in-progress",
  }),
  receipt({
    id: "maintenance-completed",
    publicEvent: "Maintenance was completed.",
    observableInWorld: "The tool stops; the garage issues completion evidence",
    canonicalEvent: signed("d005.maintenance-completed"),
    registerEventId: "maintenance-complete",
    receiptType: "SIGNED · Garage completion evidence (d005.maintenance-completed)",
    causalParent: "maintenance-performed",
    testCoverage: [T.receipts, T.c3],
  }),
  // --- governed payment -------------------------------------------------------
  receipt({
    id: "invoice-created",
    publicEvent: "The garage invoiced €1,850.",
    observableInWorld: "The invoice appears at the garage",
    canonicalEvent: signed("d005m.master-invoice-1850"),
    registerEventId: "invoice",
    receiptType: "SIGNED · Garage invoice (d005m.master-invoice-1850)",
    causalParent: "maintenance-completed",
    testCoverage: [T.receipts, T.nx0],
  }),
  receipt({
    id: "threshold-exceeded",
    publicEvent: "The invoice exceeded the autonomous limit.",
    observableInWorld: "Payment policy shows €1,850 against the €500 limit",
    canonicalEvent: signed("d005m.master-payment-policy-exceeded"),
    registerEventId: "payment-threshold",
    receiptType: "SIGNED · Payment policy limit exceeded (d005m.master-payment-policy-exceeded) — NX0: the threshold fact now binds this object rather than the invoice",
    causalParent: "invoice-created",
    testCoverage: [T.nx0, T.master],
  }),
  receipt({
    id: "human-approval-required",
    publicEvent: "Human approval was required.",
    observableInWorld: "The stage reduces to the ALLOW / DENY choice; playback holds",
    canonicalEvent: signed("d005m.master-human-approval-request"),
    sourceType: "SYSTEM_DERIVED_EVENT",
    receiptType: "SIGNED · Manager workflow approval request (d005m.master-human-approval-request)",
    causalParent: "threshold-exceeded",
    testCoverage: [T.review, T.master],
    storyBeat: "human-approval-required",
  }),
  receipt({
    id: "human-allow",
    publicEvent: "A human approved the payment.",
    observableInWorld: "The viewer presses ALLOW; the clamp releases and the approval receipt is presented",
    canonicalEvent: signed("d005m.master-human-approve"),
    registerEventId: "human-payment-approval",
    receiptType: "SIGNED · Human approval (d005m.master-human-approve) — reached only after a real ALLOW; a seek cannot assert it",
    causalParent: "human-approval-required",
    testCoverage: [T.review, T.c3],
  }),
  receipt({
    id: "human-deny",
    publicEvent: "A human denied the payment. The mission stopped.",
    observableInWorld: "The viewer presses DENY; the mission stops at the boundary and a denial receipt is written",
    canonicalEvent: runtime(HUMAN_DENIAL_EVENT_ID),
    registerEventId: "human-payment-denial",
    receiptType: "HUMAN_AUTHORITY_DECISION (NR-HUMAN-DECISION:denied) — NX0 CLOSES THE GAP: caused by the signed approval request, admitted by the closure in exactly this shape",
    causalParent: "human-approval-required",
    testCoverage: [T.nx0],
  }),
  receipt({
    id: "authority-delegated",
    publicEvent: "The approval became active authority.",
    observableInWorld: "Authority governance activates the payment authority",
    canonicalEvent: signed("d005m.master-payment-authority-active"),
    sourceType: "SYSTEM_DERIVED_EVENT",
    receiptType: "SIGNED · Payment authority active (d005m.master-payment-authority-active)",
    causalParent: "human-allow",
    testCoverage: [T.receipts, T.master],
    storyBeat: "authority-delegated",
  }),
  receipt({
    id: "payment-authorized",
    publicEvent: "The payment was authorized.",
    observableInWorld: "Payment policy authorizes the instruction",
    canonicalEvent: signed("d005m.master-payment-authorized"),
    registerEventId: "payment-authorization",
    receiptType: "SIGNED · Payment policy authorization (d005m.master-payment-authorized)",
    causalParent: "authority-delegated",
    testCoverage: [T.nx0, T.financial],
  }),
  receipt({
    id: "payment-instruction",
    publicEvent: "The payment instruction was issued.",
    observableInWorld: "The payment provider receives the instruction",
    canonicalEvent: signed("d005m.master-payment-instruction"),
    sourceType: "SYSTEM_DERIVED_EVENT",
    receiptType: "SIGNED · Payment provider instruction (d005m.master-payment-instruction)",
    causalParent: "payment-authorized",
    testCoverage: [T.financial, T.master],
    storyBeat: "payment-execution",
  }),
  receipt({
    id: "payment-submitted",
    publicEvent: "The payment was submitted.",
    observableInWorld: "The instruction is presented to the bank",
    canonicalEvent: runtime("d006g.payment-instruction-presented"),
    registerEventId: "payment-submission",
    receiptType: "PAYMENT_INSTRUCTION_PRESENTED (NR-PAYMENT-INSTRUCTION:presented) — settles_funds false",
    causalParent: "payment-instruction",
    testCoverage: [T.trust, T.financial],
  }),
  receipt({
    id: "bank-authorization",
    publicEvent: "The bank authorized the transfer.",
    observableInWorld: "The bank actor authorizes; a bank receipt leaves the bank",
    canonicalEvent: runtime("d006g.bank-authorization"),
    registerEventId: "payment-result",
    receiptType: "BANK_AUTHORIZATION_DECISION (NR-BANK-AUTHORIZATION:invoice-1850) — is_settlement false",
    causalParent: "payment-submitted",
    testCoverage: [T.trust, T.financial],
  }),
  receipt({
    id: "bank-confirmation",
    publicEvent: "The bank confirmed the authorization.",
    observableInWorld: "The bank returns a confirmation",
    canonicalEvent: runtime("d006g.bank-confirmation"),
    sourceType: "SYSTEM_DERIVED_EVENT",
    receiptType: "BANK_CONFIRMATION_RETURNED (NR-BANK-CONFIRMATION:invoice-1850) — settlement_status NOT_DEMONSTRATED stated inside",
    causalParent: "bank-authorization",
    testCoverage: [T.trust, T.financial],
    storyBeat: "bank-confirmation",
  }),
  receipt({
    id: "payment-result",
    publicEvent: "A simulated payment result was recorded.",
    observableInWorld: "The payment system records the provider result",
    canonicalEvent: signed("d005m.master-payment-result"),
    sourceType: "SYSTEM_DERIVED_EVENT",
    receiptType: "SIGNED · Payment provider result (d005m.master-payment-result) — QUARANTINED by the wrapper: it asserts SETTLED with no institution",
    causalParent: "bank-confirmation",
    testCoverage: [T.financial, T.portable],
    storyBeat: "payment-result",
  }),
  receipt({
    id: "payment-sub-mission-receipt",
    publicEvent: "The payment evidence was closed locally.",
    observableInWorld: "The payment sub-mission receipt is compiled",
    canonicalEvent: signed("d005m.receipt.master-payment"),
    sourceType: "EVIDENCE_DERIVED_EVENT",
    receiptType: "SIGNED · Causal compiler payment receipt (d005m.receipt.master-payment) — QUARANTINED with the result it closes",
    causalParent: "payment-result",
    testCoverage: [T.financial, T.portable],
    storyBeat: "payment-sub-mission-receipt",
  }),
  noReceipt({
    id: "settlement-state",
    publicEvent: "Settlement was not demonstrated.",
    observableInWorld: "Nothing: no clearing or settlement system participates in the demonstration",
    canonicalEvent: { kind: "STATE", consequenceOf: "payment-result" },
    sourceType: "EVIDENCE_DERIVED_EVENT",
    justification: "No clearing or settlement system participates, so no settlement can be evidenced. The bank confirmation states settlement_status NOT_DEMONSTRATED inside the evidence and the public record carries the settlement fact as NOT DEMONSTRATED. A settlement receipt would be the exact overclaim the wrapper quarantines in the signed provider result.",
    publicFactId: "fact.payment.settlement",
    causalParent: "payment-result",
    testCoverage: [T.financial, T.c3],
    storyBeat: "payment-result",
  }),
  receipt({
    id: "manager-notified",
    publicEvent: "The manager was notified.",
    observableInWorld: "The manager workflow records the notification",
    canonicalEvent: signed("d005m.master-manager-notified"),
    sourceType: "SYSTEM_DERIVED_EVENT",
    receiptType: "SIGNED · Manager workflow notification (d005m.master-manager-notified)",
    causalParent: "payment-result",
    testCoverage: [T.receipts, T.master],
    storyBeat: "manager-notified",
  }),
  // --- return ------------------------------------------------------------------
  receipt({
    id: "return-intent",
    publicEvent: "Return to base was requested.",
    observableInWorld: "Fleet operations requests the return",
    canonicalEvent: signed("d005m.master-return-intent"),
    sourceType: "SIMULATED_WORLD_EVENT",
    receiptType: "SIGNED · Fleet operations return intent (d005m.master-return-intent)",
    causalParent: "manager-notified",
    testCoverage: [T.receipts, T.master],
    storyBeat: "return-to-base-intent",
  }),
  receipt({
    id: "return-authorized",
    publicEvent: "The return route was authorized.",
    observableInWorld: "The return route is calculated and authorized",
    canonicalEvent: signed("d005m.master-return-authorized"),
    sourceType: "SIMULATED_WORLD_EVENT",
    receiptType: "SIGNED · Fleet operations return authorization (d005m.master-return-authorized)",
    causalParent: "return-intent",
    testCoverage: [T.receipts, T.master],
    storyBeat: "return-route-calculated",
  }),
  receipt({
    id: "return-to-base",
    publicEvent: "The taxi returned to base.",
    observableInWorld: "The taxi leaves the garage, turns around and drives back to the base",
    canonicalEvent: signed("d005m.master-return-executed"),
    registerEventId: "return-to-base",
    receiptType: "SIGNED · Taxi autonomy return execution (d005m.master-return-executed)",
    causalParent: "return-authorized",
    testCoverage: [T.receipts, T.c3],
  }),
  receipt({
    id: "ethernet-restoration",
    publicEvent: "The connection returned.",
    observableInWorld: "The RJ45 cable is replaced; the sentinel reports the link up; status turns CONNECTED",
    canonicalEvent: { kind: "LIVE_RECORD", eventType: "NETWORK_LINK_RESTORED" },
    registerEventId: "network-restoration",
    receiptType: "NETWORK_LINK_RESTORED (NR-NET-RESTORED:<observation digest>) — exactly once per physical restoration",
    causalParent: "ethernet-loss",
    testCoverage: [T.network, T.networkEvidence, T.c3],
  }),
  noReceipt({
    id: "reconciliation-started",
    publicEvent: "Reconciliation began.",
    observableInWorld: "The sync phase turns ACKNOWLEDGING; the base ledger is read and compared",
    canonicalEvent: { kind: "STATE", consequenceOf: "ethernet-restoration" },
    sourceType: "SYSTEM_DERIVED_EVENT",
    justification: "The start of the base compare/transfer is observable, but a receipt issued at the start would assert work not yet performed. The operation's only evidence is its receipt, which binds base-before and base-after digests and the exact transferred ids; it is issued when the work is done or not at all.",
    causalParent: "ethernet-restoration",
    testCoverage: [T.reconciliation, T.c3],
  }),
  receipt({
    id: "reconciliation-performed",
    publicEvent: "Offline evidence was reconciled.",
    observableInWorld: "Local count, transferred count and matching digests appear; the alignment strip fills the transferred fraction",
    canonicalEvent: { kind: "LIVE_RECORD", eventType: "RECONCILIATION_RECEIPT" },
    registerEventId: "reconciliation",
    receiptType: "RECONCILIATION_RECEIPT (operation BASE_COMPARE_TRANSFER) — earned by the performed transfer, validated by the frozen C1 validator",
    causalParent: "reconciliation-started",
    testCoverage: [T.reconciliation, T.c3],
  }),
  receipt({
    id: "reconciliation-result",
    publicEvent: "The reconciliation result was recorded.",
    observableInWorld: "COMPLETE or FAILED with reason codes",
    canonicalEvent: { kind: "LIVE_RECORD", eventType: "RECONCILIATION_RECEIPT" },
    registerEventId: "reconciliation",
    receiptType: "RECONCILIATION_RECEIPT · reconciliationResult / digestComparison / transferredObjectCount (FAILED leaves no receipt and states its reasons)",
    publicFactId: null,
    causalParent: "reconciliation-performed",
    testCoverage: [T.reconciliation],
  }),
  receipt({
    id: "mission-complete",
    publicEvent: "The mission completed.",
    observableInWorld: "The taxi parks at the base; the completion cue appears",
    canonicalEvent: signed("d005m.master-base-arrival"),
    registerEventId: "mission-complete",
    receiptType: "SIGNED · Fleet operations base arrival (d005m.master-base-arrival)",
    causalParent: "return-to-base",
    testCoverage: [T.receipts, T.c3],
  }),
  receipt({
    id: "return-sub-mission-receipt",
    publicEvent: "The return mission was closed.",
    observableInWorld: "The return sub-mission receipt matures as the last required leaf",
    canonicalEvent: signed("d005m.receipt.master-return-to-base"),
    sourceType: "EVIDENCE_DERIVED_EVENT",
    receiptType: "SIGNED · Causal compiler return receipt (d005m.receipt.master-return-to-base)",
    causalParent: "mission-complete",
    testCoverage: [T.portable, T.master],
    storyBeat: "sub-mission-receipts",
  }),
  // --- closure, handoff, verification --------------------------------------------
  receipt({
    id: "final-receipt",
    publicEvent: "The mission produced its final record.",
    observableInWorld: "The Final Receipt flies to the root of the tree and attaches",
    canonicalEvent: { kind: "ARTIFACT", artifact: "FINAL_RECEIPT" },
    registerEventId: "final-receipt",
    receiptType: "D-006 Final Receipt (fortix:receipt:blake3:…) — issued only when the closure supports it",
    causalParent: "return-sub-mission-receipt",
    testCoverage: [T.portable, T.c3],
  }),
  receipt({
    id: "portable-evidence-complete",
    publicEvent: "The portable evidence was complete.",
    observableInWorld: "The evidence object closes and becomes takeable",
    canonicalEvent: { kind: "ARTIFACT", artifact: "PEB" },
    sourceType: "EVIDENCE_DERIVED_EVENT",
    receiptType: "D-006 wrapper PEB (fortix:peb:blake3:…) with bundle digest and presentation coverage",
    causalParent: "final-receipt",
    testCoverage: [T.portable],
    storyBeat: "peb-complete",
  }),
  receipt({
    id: "evidence-handoff",
    publicEvent: "The evidence left the taxi system.",
    observableInWorld: "The viewer carries the object into the verifier; it is received there",
    canonicalEvent: { kind: "ARTIFACT", artifact: "HANDOFF" },
    registerEventId: "portable-handoff",
    receiptType: "Handoff artifact · transferred content digest of the exact PEB text",
    causalParent: "portable-evidence-complete",
    testCoverage: [T.participation, T.verification],
  }),
  noReceipt({
    id: "analyze",
    publicEvent: "The check was started.",
    observableInWorld: "The viewer presses ANALYZE; nothing verifies before that",
    canonicalEvent: { kind: "INTERACTION", control: "ANALYZE" },
    registerEventId: "verifier-analyze",
    sourceType: "USER_INTERACTION",
    justification: "Verification is a second, deliberate human act and the verifier authors nothing into the mission evidence — its independence depends on that. The act is recorded as the verifier's own analysis state, never as a mission receipt.",
    causalParent: "evidence-handoff",
    testCoverage: [T.participation, T.verification],
  }),
  noReceipt({
    id: "verdict",
    publicEvent: "The verifier gave its verdict.",
    observableInWorld: "Facts are inspected, then VALID / INVALID / INDETERMINATE / REVOKED is shown",
    canonicalEvent: { kind: "VERIFIER_OUTPUT" },
    registerEventId: "verdict",
    sourceType: "EVIDENCE_DERIVED_EVENT",
    justification: "A verdict is a conclusion about evidence under a profile, not evidence; FACT, CLAIM and VERDICT stay separate. Recording the verdict as mission evidence would let the source system carry its own verification.",
    causalParent: "analyze",
    testCoverage: [T.verification, T.c3],
  }),
]);

/** The actions the NX0 mandate (§6) names, by matrix id. Tests assert presence. */
export const MANDATED_ACTION_IDS: readonly string[] = Object.freeze([
  "mission-requested", "mission-accepted", "taxi-leaves-base",
  "traffic-light-state", "taxi-perception", "brake-decision", "brake-action", "vehicle-stopped", "vehicle-resumed",
  "taxi-arrives-pickup", "passenger-boards", "passenger-aboard", "taxi-departs-with-passenger",
  "taxi-arrives-destination", "passenger-exits", "taxi-departs-without-passenger",
  "traffic-congestion", "routing-requested", "provider-selection", "provider-resolution", "route-changed",
  "ethernet-loss", "offline-continuation", "local-evidence-continuation",
  "garage-arrival", "maintenance-authority-requested", "maintenance-authorization", "maintenance-started",
  "maintenance-performed", "maintenance-completed",
  "invoice-created", "threshold-exceeded", "human-allow", "human-deny", "payment-submitted", "payment-result",
  "settlement-state",
  "return-to-base", "ethernet-restoration", "reconciliation-started", "reconciliation-performed",
  "reconciliation-result",
  "mission-complete", "final-receipt", "portable-evidence-complete", "evidence-handoff", "analyze", "verdict",
]);

export function significantAction(id: string): SignificantAction {
  const entry = SIGNIFICANT_ACTION_REGISTER.find((candidate) => candidate.id === id);
  if (entry === undefined) throw new TypeError(`Unregistered significant action: ${id}`);
  return entry;
}

export type EvidenceCompletenessContext = Readonly<{
  /** The closure of a complete deterministic run at Final Receipt emission. */
  closure: MissionEvidenceClosure;
  runtimeRecords: readonly OfflineCausalRecord[];
  testFileExists: (fileName: string) => boolean;
}>;

const LIVE_EVENT_TYPES = new Set(["NETWORK_LINK_LOST", "NETWORK_LINK_RESTORED", "RECONCILIATION_RECEIPT"]);
const MIN_JUSTIFICATION_LENGTH = 80;

/**
 * The NX0 gate, as a function. An empty result means: every significant
 * action has an explicit decision, every RECEIPT resolves to real evidence in
 * a built closure, every JUSTIFIED_NO_RECEIPT carries its reason, and nothing
 * the engine can evidence is left off the matrix.
 */
export function evidenceCompletenessViolations(context: EvidenceCompletenessContext): readonly string[] {
  const violations: string[] = [];
  const ids = new Set<string>();
  const registerIds = new Set(CAUSAL_EVENT_REGISTER.map((entry) => entry.id));
  const factIds = new Set(PUBLIC_FACT_DEFINITIONS.map((definition) => definition.factId));
  const specIds = new Set(MISSION_EVIDENCE_SPECS.map((spec) => spec.eventId));
  const presentedByEvent = new Map(
    context.closure.members.filter((member) => member.presentation === "PRESENTED").map((member) => [member.eventId, member]),
  );
  const referencedSpecs = new Set<string>();
  const referencedFacts = new Set<string>();
  const referencedRegister = new Set<string>();

  for (const action of SIGNIFICANT_ACTION_REGISTER) {
    if (ids.has(action.id)) violations.push(`${action.id}: duplicate id`);
    ids.add(action.id);
    if (action.causalParent === action.id) violations.push(`${action.id}: names itself as causal parent`);
    if (action.registerEventId !== null) {
      if (!registerIds.has(action.registerEventId)) violations.push(`${action.id}: unknown register row ${action.registerEventId}`);
      referencedRegister.add(action.registerEventId);
    }
    if (action.publicFactId !== null) {
      if (!factIds.has(action.publicFactId)) violations.push(`${action.id}: unknown public fact ${action.publicFactId}`);
      referencedFacts.add(action.publicFactId);
    }
    if (action.storyBeat !== null && !(action.storyBeat in STORY_BEAT_TIME_MS)) {
      violations.push(`${action.id}: unknown story beat ${action.storyBeat}`);
    }
    if (action.testCoverage.length === 0) violations.push(`${action.id}: no test coverage declared`);
    for (const file of action.testCoverage) {
      if (!context.testFileExists(file)) violations.push(`${action.id}: test file does not exist: ${file}`);
    }
    if (action.evidenceDecision === "RECEIPT") {
      if (action.receiptType === null || action.receiptType.trim().length === 0) violations.push(`${action.id}: RECEIPT without a receipt type`);
      if (action.justification !== null) violations.push(`${action.id}: RECEIPT carrying a no-receipt justification`);
      const ref = action.canonicalEvent;
      switch (ref.kind) {
        case "RUNTIME_RECORD": {
          if (ref.eventId === HUMAN_DENIAL_EVENT_ID) break; // live: only a real DENY authors it; covered by its own test
          if (!specIds.has(ref.eventId)) violations.push(`${action.id}: runtime record ${ref.eventId} has no mission evidence spec`);
          else referencedSpecs.add(ref.eventId);
          if (!presentedByEvent.has(ref.eventId)) violations.push(`${action.id}: runtime record ${ref.eventId} is not a presented member of the built closure`);
          break;
        }
        case "RUNTIME_EVENT_TYPE": {
          const matching = context.runtimeRecords.filter((record) => record.eventType === ref.eventType);
          if (matching.length === 0) violations.push(`${action.id}: no runtime record of type ${ref.eventType}`);
          for (const record of matching) referencedSpecs.add(record.eventId);
          break;
        }
        case "SIGNED_EVENT": {
          if (!presentedByEvent.has(ref.eventId)) violations.push(`${action.id}: signed event ${ref.eventId} is not a presented member of the built closure`);
          break;
        }
        case "LIVE_RECORD": {
          if (!LIVE_EVENT_TYPES.has(ref.eventType)) violations.push(`${action.id}: ${ref.eventType} is not a live record type`);
          break;
        }
        case "CLOSURE_QUERY": {
          if (ref.query.trim().length === 0) violations.push(`${action.id}: empty closure query`);
          break;
        }
        case "ARTIFACT":
          break;
        default:
          violations.push(`${action.id}: RECEIPT decision on a non-evidence canonical event`);
      }
    } else {
      if (action.receiptType !== null) violations.push(`${action.id}: JUSTIFIED_NO_RECEIPT naming a receipt type`);
      if (action.justification === null || action.justification.trim().length < MIN_JUSTIFICATION_LENGTH) {
        violations.push(`${action.id}: JUSTIFIED_NO_RECEIPT without a substantive justification`);
      }
      if (!["STATE", "INTERACTION", "VERIFIER_OUTPUT"].includes(action.canonicalEvent.kind)) {
        violations.push(`${action.id}: no-receipt decision on an evidence-bearing canonical event`);
      }
      const ref = action.canonicalEvent;
      if (ref.kind === "STATE" && !SIGNIFICANT_ACTION_REGISTER.some((candidate) => candidate.id === ref.consequenceOf)) {
        violations.push(`${action.id}: state consequence of unknown action`);
      }
    }
  }
  for (const action of SIGNIFICANT_ACTION_REGISTER) {
    if (action.causalParent !== null && !ids.has(action.causalParent)) {
      violations.push(`${action.id}: unknown causal parent ${action.causalParent}`);
    }
  }
  for (const spec of MISSION_EVIDENCE_SPECS) {
    if (!referencedSpecs.has(spec.eventId)) violations.push(`orphan evidence: spec ${spec.eventId} is claimed by no significant action`);
  }
  for (const factId of factIds) {
    if (!referencedFacts.has(factId)) violations.push(`orphan fact: ${factId} is carried by no significant action`);
  }
  for (const id of registerIds) {
    if (!referencedRegister.has(id)) violations.push(`orphan register row: ${id} maps to no significant action`);
  }
  for (const id of MANDATED_ACTION_IDS) {
    if (!ids.has(id)) violations.push(`mandated action missing from the matrix: ${id}`);
  }
  return Object.freeze(violations);
}

export type MatrixSummary = Readonly<{
  total: number;
  receipt: number;
  justifiedNoReceipt: number;
  unknown: 0;
  undecided: 0;
}>;

export function summarizeSignificantActions(): MatrixSummary {
  const receiptCount = SIGNIFICANT_ACTION_REGISTER.filter((action) => action.evidenceDecision === "RECEIPT").length;
  return Object.freeze({
    total: SIGNIFICANT_ACTION_REGISTER.length,
    receipt: receiptCount,
    justifiedNoReceipt: SIGNIFICANT_ACTION_REGISTER.length - receiptCount,
    unknown: 0,
    undecided: 0,
  });
}

/** Machine-readable matrix. Deterministic: same register, same bytes. */
export function serializeSignificantActionMatrix(): string {
  return `${JSON.stringify({
    matrix: "fortix.d006.nx0.significant-action-evidence-matrix",
    version: 1,
    rule: "EVERY SIGNIFICANT OBSERVABLE ACTION MUST HAVE AN EXPLICIT EVIDENCE DECISION: RECEIPT or JUSTIFIED_NO_RECEIPT",
    summary: summarizeSignificantActions(),
    actions: SIGNIFICANT_ACTION_REGISTER,
  }, null, 2)}\n`;
}

function describeCanonicalEvent(ref: CanonicalEventRef): string {
  switch (ref.kind) {
    case "RUNTIME_RECORD": return `runtime \`${ref.eventId}\``;
    case "RUNTIME_EVENT_TYPE": return `runtime type \`${ref.eventType}\``;
    case "SIGNED_EVENT": return `signed \`${ref.eventId}\``;
    case "LIVE_RECORD": return `live \`${ref.eventType}\``;
    case "ARTIFACT": return `artifact ${ref.artifact}`;
    case "CLOSURE_QUERY": return `closure query: ${ref.query}`;
    case "STATE": return `state (consequence of ${ref.consequenceOf})`;
    case "INTERACTION": return `interaction ${ref.control}`;
    case "VERIFIER_OUTPUT": return "verifier output";
  }
}

const cell = (value: string | null): string => (value ?? "—").replace(/\|/g, "\\|").replace(/\n/g, " ");

/** Human-readable matrix, one row per significant action. */
export function renderSignificantActionMatrixMarkdown(): string {
  const summary = summarizeSignificantActions();
  const lines: string[] = [
    "# D-006 NX0 — Significant Action Evidence Matrix",
    "",
    "Generated from `app/significantActions.ts`; do not edit by hand. Every row carries an explicit evidence decision.",
    "",
    `Rows: ${summary.total} · RECEIPT: ${summary.receipt} · JUSTIFIED_NO_RECEIPT: ${summary.justifiedNoReceipt} · UNKNOWN: ${summary.unknown} · UNDECIDED: ${summary.undecided}`,
    "",
    "| # | PUBLIC_EVENT | OBSERVABLE_IN_WORLD | CANONICAL_EVENT | SOURCE_TYPE | SIGNIFICANT | EVIDENCE_DECISION | RECEIPT_TYPE / JUSTIFICATION | PUBLIC_FACT | CAUSAL_PARENT | TEST_COVERAGE |",
    "|---|---|---|---|---|---|---|---|---|---|---|",
  ];
  SIGNIFICANT_ACTION_REGISTER.forEach((action, index) => {
    lines.push(`| ${index + 1} | **${cell(action.publicEvent)}** \`${action.id}\` | ${cell(action.observableInWorld)} | ${cell(describeCanonicalEvent(action.canonicalEvent))} | ${action.sourceType} | YES | ${action.evidenceDecision} | ${cell(action.receiptType ?? action.justification)} | ${cell(action.publicFactId)} | ${cell(action.causalParent)} | ${action.testCoverage.join(", ")} |`);
  });
  lines.push("");
  return `${lines.join("\n")}\n`;
}

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  MISSION_EVIDENCE_SPECS,
  projectMissionEvidence,
  specTime,
} from "../app/missionEvidence.ts";
import { createOfflineEvidenceSession, type OfflineCausalRecord } from "../app/offlineEvidence.ts";
import { VISUAL_EVENTS, visualEventTime } from "../app/visualEvents.ts";

/**
 * D-006G P1 — independent trust domains.
 *
 * The intersection used to produce no evidence at all, and the taxi's motion
 * was a pure function of the traffic light's event times: the light was
 * literally the vehicle's actuator. The pedagogical claim these tests defend
 * is one sentence — the light did not command the taxi; the taxi observed the
 * light and acted on its own decision — and it has to be provable from the
 * evidence, not from a caption.
 */

const MISSION = "fortix.demo.d006g.boundaries";
const FULL_MISSION_MS = 120_000;

function fullRun(): readonly OfflineCausalRecord[] {
  return projectMissionEvidence(createOfflineEvidenceSession(MISSION), FULL_MISSION_MS).records;
}

function byEvent(records: readonly OfflineCausalRecord[], eventId: string): OfflineCausalRecord {
  const found = records.find((record) => record.eventId === eventId);
  assert.ok(found !== undefined, `${eventId} was never authored`);
  return found;
}

function payloadOf(record: OfflineCausalRecord): Record<string, unknown> {
  return record.payload as unknown as Record<string, unknown>;
}

function domainOf(record: OfflineCausalRecord): unknown {
  return payloadOf(record).trust_domain;
}

// --- the intersection produces evidence at all ---------------------------

test("D-006G P1: the smart-city boundary produces real evidence objects", () => {
  const records = fullRun();
  const city = records.filter((r) => domainOf(r) === "SMART_CITY_INFRASTRUCTURE");
  assert.ok(city.length >= 6, `the city authored ${city.length} records`);

  // Signal identity, state and transition are each independently present.
  const published = city.filter((r) => r.eventType === "SIGNAL_STATE_PUBLISHED");
  assert.equal(published.length, 4, "green, yellow, red and green again");
  for (const record of published) {
    assert.equal(payloadOf(record).signal_id, "fortix.demo.city.signal.crossing-07");
    assert.ok(["GREEN", "YELLOW", "RED"].includes(String(payloadOf(record).published_state)));
  }
  assert.deepEqual(published.map((r) => payloadOf(r).published_state), ["GREEN", "YELLOW", "RED", "GREEN"]);
});

test("D-006G P1: observation, decision and action are three separate facts", () => {
  const records = fullRun();
  const observation = byEvent(records, "d006g.perception:yellow");
  const decision = byEvent(records, "d006g.decision:stop");
  const action = byEvent(records, "d006g.action:brake");
  const result = byEvent(records, "d006g.result:at-rest");

  assert.equal(observation.eventType, "VEHICLE_OBSERVATION");
  assert.equal(decision.eventType, "AUTONOMOUS_DECISION");
  assert.equal(action.eventType, "VEHICLE_ACTION");
  assert.equal(result.eventType, "VEHICLE_RESULT");

  // Strictly ordered in mission time — if they shared a moment they would be
  // one act relabelled four times.
  const clocks = [observation, decision, action, result].map((r) => r.missionClockPosition);
  for (let i = 1; i < clocks.length; i += 1) assert.ok(clocks[i] > clocks[i - 1]);
});

// --- the command reading must be refutable from the evidence -------------

test("D-006G P1: no vehicle record is caused by a city record", () => {
  const records = fullRun();
  const cityReceipts = new Set(
    records.filter((r) => domainOf(r) === "SMART_CITY_INFRASTRUCTURE").map((r) => r.receiptId),
  );
  const vehicle = records.filter((r) => domainOf(r) === "AUTONOMOUS_VEHICLE");
  assert.ok(vehicle.length >= 7);

  for (const record of vehicle) {
    const causedBy = payloadOf(record).caused_by;
    assert.ok(!cityReceipts.has(String(causedBy)),
      `${record.eventId} names a city receipt as its cause — that is a command`);
  }
});

test("D-006G P1: the taxi's perception cites the signal as observed, never as authority", () => {
  const records = fullRun();
  const observation = byEvent(records, "d006g.perception:yellow");
  const signal = byEvent(records, "d006g.signal-state-published:yellow");

  // The cross-domain artifact appears as an observed input...
  assert.equal(payloadOf(observation).observed_input, signal.receiptId);
  // ...and never as the cause.
  assert.notEqual(payloadOf(observation).caused_by, signal.receiptId);
  // The observation is the vehicle's own reading, not ground truth.
  assert.equal(payloadOf(observation).observation_is_authoritative, false);
  assert.ok(typeof payloadOf(observation).observation_latency_ms === "number");
});

test("D-006G P1: the signal confers no permission and addresses no vehicle", () => {
  const records = fullRun();
  for (const record of records.filter((r) => r.eventType === "SIGNAL_STATE_PUBLISHED")) {
    assert.equal(payloadOf(record).confers_permission, false);
    assert.equal(payloadOf(record).addressed_to, null);
  }
  // The city's own decision is about its own phase, not about a vehicle.
  const phase = byEvent(records, "d006g.city-phase-decision");
  assert.equal(payloadOf(phase).decision_subject, "OWN_SIGNAL_PHASE");
});

test("D-006G P1: the decision is a choice, not a relay", () => {
  const records = fullRun();
  for (const id of ["d006g.decision:stop", "d006g.decision:proceed"]) {
    const decision = byEvent(records, id);
    const admissible = payloadOf(decision).admissible_actions as readonly string[];
    assert.ok(admissible.length >= 2, "a decision with one option is an instruction");
    assert.equal(payloadOf(decision).instructed_by, null);
    assert.ok(typeof payloadOf(decision).policy_ref === "string");
  }
  // The keystone: proceeding rests on two independent inputs, so it cannot be
  // a relay of the signal alone.
  const proceed = byEvent(records, "d006g.decision:proceed");
  const inputs = payloadOf(proceed).decision_inputs as readonly string[];
  assert.ok(inputs.length >= 2, "PROCEED must not rest on the signal alone");
});

test("D-006G P1: the taxi is already braking before the signal turns red", () => {
  // The strongest available refutation of the command reading, and it needs
  // no payload inspection at all: the stop begins before the red exists.
  assert.ok(visualEventTime("taxi-brake-applied") < visualEventTime("signal-red"));
  assert.ok(visualEventTime("taxi-observes-yellow") > visualEventTime("signal-yellow"),
    "the taxi can only observe a state after it has been published");
  assert.ok(visualEventTime("taxi-decides-stop") > visualEventTime("taxi-observes-yellow"));
  assert.ok(visualEventTime("taxi-resumes") > visualEventTime("taxi-decides-proceed"));
});

test("D-006G P1: vehicle motion is no longer a function of traffic-light event time", () => {
  const presentation = readFileSync(new URL("../app/vehiclePresentation.ts", import.meta.url), "utf8");
  // Comments stripped: the invariant is what the code READS, not what the
  // file may say about the coupling it used to have. Recording why the old
  // shape was wrong belongs in the file, next to the code that replaced it.
  const beat = presentation
    .slice(presentation.indexOf("function presentationBeatAt"))
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
  // The motion beats may reference only the vehicle's own events.
  assert.doesNotMatch(beat, /visualEventTime\("signal-/,
    "the light's clock must not drive the car");
  assert.doesNotMatch(beat, /visualEventTime\("crossing"\)/,
    "the retired crossing authorization must not return");
  assert.match(beat, /visualEventTime\("taxi-brake-applied"\)/);
  assert.match(beat, /visualEventTime\("taxi-at-rest"\)/);
  assert.match(beat, /visualEventTime\("taxi-resumes"\)/);
});

test("D-006G P1: the signal lamp is driven only by city events", () => {
  const component = readFileSync(new URL("../app/ConvergenceExperience.tsx", import.meta.url), "utf8");
  const lamp = component.slice(
    component.indexOf("function trafficSignalAt"),
    component.indexOf("}", component.indexOf("return \"GREEN\";")),
  );
  assert.doesNotMatch(lamp, /taxi-/, "the lamp must not read a vehicle event");
  assert.match(lamp, /signal-green-2/);
});

// --- the financial boundary ----------------------------------------------

test("D-006G P1: the bank is a distinct trust domain", () => {
  const records = fullRun();
  const bank = records.filter((r) => domainOf(r) === "FINANCIAL_INSTITUTION");
  assert.ok(bank.length >= 2, "the bank must author its own evidence");

  const authorization = byEvent(records, "d006g.bank-authorization");
  assert.equal(payloadOf(authorization).institution_role, "ACCOUNT_HOLDING_INSTITUTION");
  // The bank is not the processor, and not the human who approved the expense.
  assert.equal(payloadOf(authorization).is_expense_approval, false);
  const presented = byEvent(records, "d006g.payment-instruction-presented");
  assert.equal(domainOf(presented), "PAYMENT_PROVIDER");
  assert.notEqual(domainOf(presented), domainOf(authorization));
  assert.equal(payloadOf(presented).settles_funds, false);
});

test("D-006G P1: no settlement is claimed anywhere in the added evidence", () => {
  const records = fullRun();
  for (const record of records) {
    const serialized = JSON.stringify(record.payload);
    assert.doesNotMatch(serialized, /"SETTLED"/,
      `${record.eventId} claims settlement`);
  }
  const confirmation = byEvent(records, "d006g.bank-confirmation");
  assert.equal(payloadOf(confirmation).confirmation, "AUTHORIZATION_RECORDED");
  assert.equal(payloadOf(confirmation).settlement_status, "NOT_DEMONSTRATED");
  assert.equal(payloadOf(confirmation).settlement_system_participated, false);
  assert.equal(payloadOf(byEvent(records, "d006g.bank-authorization")).is_settlement, false);
});

// --- distinguishable from the signed fixture, and replay-safe ------------

test("D-006G P1: every added record is marked as demonstration runtime evidence", () => {
  const records = fullRun();
  assert.equal(records.length, MISSION_EVIDENCE_SPECS.length);
  for (const record of records) {
    assert.equal(payloadOf(record).evidence_class, "DEMONSTRATION_RUNTIME",
      `${record.eventId} could be mistaken for signed canonical evidence`);
    assert.ok(typeof payloadOf(record).trust_domain === "string");
  }
});

test("D-006G P1: projection is idempotent under replay and seeking", () => {
  const clean = createOfflineEvidenceSession(MISSION);
  const once = projectMissionEvidence(clean, FULL_MISSION_MS);
  const twice = projectMissionEvidence(once, FULL_MISSION_MS);
  assert.equal(twice, once, "replaying the same clock must append nothing");

  // Seek forward in steps, then jump back and forward again.
  let stepped = clean;
  for (const at of [25_000, 27_000, 30_000, 90_000, FULL_MISSION_MS]) {
    stepped = projectMissionEvidence(stepped, at);
  }
  stepped = projectMissionEvidence(stepped, 10_000);
  stepped = projectMissionEvidence(stepped, FULL_MISSION_MS);
  assert.equal(stepped.records.length, once.records.length,
    "seeking must not duplicate or lose records");
  assert.deepEqual(
    stepped.records.map((r) => r.receiptId),
    once.records.map((r) => r.receiptId),
    "the same run must produce the same causal order however it was played",
  );
});

test("D-006G P1: nothing is authored before its moment", () => {
  const early = projectMissionEvidence(createOfflineEvidenceSession(MISSION), 24_500);
  for (const record of early.records) {
    assert.ok(record.missionClockPosition <= 24_500);
  }
  // The bank has not acted yet at the intersection.
  assert.equal(early.records.some((r) => domainOf(r) === "FINANCIAL_INSTITUTION"), false);
});

test("D-006G P1: every spec has one canonical time source, in order", () => {
  const ids = new Set(VISUAL_EVENTS.map((event) => event.id));
  let previous = -1;
  for (const spec of MISSION_EVIDENCE_SPECS) {
    if (spec.visualEventId !== null) {
      assert.ok(ids.has(spec.visualEventId), `${spec.eventId} has no visual anchor`);
    } else {
      assert.ok(spec.storyBeatId, `${spec.eventId} has no canonical story beat`);
    }
    const at = specTime(spec);
    assert.ok(at > previous, `${spec.eventId} is out of order at ${at}`);
    previous = at;
  }
});

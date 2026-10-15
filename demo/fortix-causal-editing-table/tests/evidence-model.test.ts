import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  CANONICAL_EVIDENCE_OBJECTS,
  SCENARIO_STATEMENTS,
  buildNanoReceipts,
  deriveCausalBindings,
  deriveDomainStateAt,
  deriveEvidenceStateAt,
  evidenceTimestampToMasterTime,
} from "../app/evidence.ts";

function receiptByEvent(eventId: string) {
  const receipt = buildNanoReceipts().find(
    (candidate) => candidate.evidence.significant_event.event_id === eventId,
  );
  assert.ok(receipt, `missing fixture receipt for ${eventId}`);
  return receipt;
}

test("D-002 preserves every canonical scenario timestamp", () => {
  assert.deepEqual(
    SCENARIO_STATEMENTS.map((statement) => statement.timeMs),
    [
      0, 2_400, 2_860, 3_000, 3_180, 3_240, 3_310, 3_420, 3_560,
      3_710, 3_760, 3_810, 3_890, 4_120, 5_340, 5_420, 6_000,
    ],
  );
});

test("a receipt appears exactly at its Evidence timestamp and not before", () => {
  const before = deriveEvidenceStateAt(3_179);
  const exact = deriveEvidenceStateAt(3_180);

  assert.equal(before.visibleReceipts.length, 0);
  assert.deepEqual(
    exact.visibleReceipts.map((receipt) => receipt.evidence.significant_event.event_id),
    ["d002.candidate-detected"],
  );
  assert.equal(
    evidenceTimestampToMasterTime(
      exact.visibleReceipts[0].evidence.significant_event.event_time,
    ),
    3_180,
  );
});

test("rewinding removes later receipts and replay reconstructs identical evidence", () => {
  const firstPass = deriveEvidenceStateAt(5_340);
  const rewound = deriveEvidenceStateAt(3_179);
  const replayed = deriveEvidenceStateAt(5_340);

  assert.equal(rewound.visibleReceipts.length, 0);
  assert.equal(
    rewound.visibleReceipts.some(
      (receipt) => receipt.evidence.significant_event.event_id.includes("collision-window"),
    ),
    false,
  );
  assert.deepEqual(replayed, firstPass);
});

test("causal parent order is canonical for a multi-object Evidence State", () => {
  const state = deriveEvidenceStateAt(5_340);
  const collision = state.statementStates.find(
    ({ statement }) => statement.id === "collision-window",
  );
  assert.ok(collision);
  assert.equal(collision.receiptIds.length, 2);
  assert.equal(collision.causalParentIds.length, 2);
  assert.deepEqual(
    collision.causalParentIds,
    [...collision.causalParentIds].sort(),
  );
});

test("Evidence input order cannot change receipts, bindings, or Evidence State", () => {
  const canonical = deriveEvidenceStateAt(6_000, CANONICAL_EVIDENCE_OBJECTS);
  const reversed = deriveEvidenceStateAt(
    6_000,
    [...CANONICAL_EVIDENCE_OBJECTS].reverse(),
  );

  assert.deepEqual(reversed, canonical);
});

test("chronological adjacency never creates a causal binding", () => {
  const detection = receiptByEvent("d002.candidate-detected").evidence;
  const trajectory = receiptByEvent("d002.trajectory-prediction").evidence;
  const bindings = deriveCausalBindings([detection, trajectory]);

  assert.equal(
    bindings.some(
      (binding) =>
        binding.parentEvidenceId === detection.evidence_id &&
        binding.childEvidenceId === trajectory.evidence_id,
    ),
    false,
  );
  assert.equal(bindings.length, 1);
  assert.equal(bindings[0].parentAvailable, false);
});

test("missing evidence remains visibly distinct from evidence available for verification", () => {
  const state = deriveEvidenceStateAt(5_340);
  const physicalObservability = state.statementStates.find(
    ({ statement }) => statement.id === "physically-observable",
  );
  const detection = state.statementStates.find(
    ({ statement }) => statement.id === "candidate-detected",
  );

  assert.equal(physicalObservability?.availability, "NOT_RECORDED");
  assert.equal(detection?.availability, "AVAILABLE_NOT_VERIFIED");
  assert.notEqual(physicalObservability?.availability, detection?.availability);
});

test("a partially supplied multi-object Evidence State stays neutral and incomplete", () => {
  const partialFixture = CANONICAL_EVIDENCE_OBJECTS.filter(
    (evidence) => evidence.significant_event.event_id !== "d002.collision-window-risk-context",
  );
  const collision = deriveEvidenceStateAt(5_340, partialFixture).statementStates.find(
    ({ statement }) => statement.id === "collision-window",
  );

  assert.equal(collision?.availability, "INCOMPLETE_NOT_VERIFIED");
  assert.equal(collision?.receiptIds.length, 1);
});

test("SYSTEM state cannot manufacture PROOF state", () => {
  assert.equal(deriveDomainStateAt(5_340, "SYSTEM"), "Actuator acknowledged command");
  assert.equal(deriveEvidenceStateAt(5_340, []).visibleReceipts.length, 0);
});

test("REALITY state cannot manufacture PROOF state", () => {
  assert.equal(deriveDomainStateAt(5_340, "REALITY"), "Collision / near-collision occurs");
  const state = deriveEvidenceStateAt(5_340, []);
  const collision = state.statementStates.find(
    ({ statement }) => statement.id === "collision-window",
  );
  assert.equal(collision?.availability, "NOT_RECORDED");
});

test("no local wall clock affects Evidence derivation", () => {
  const originalDateNow = Date.now;
  Date.now = () => {
    throw new Error("local wall clock must not be read");
  };
  try {
    assert.deepEqual(deriveEvidenceStateAt(4_120), deriveEvidenceStateAt(4_120));
  } finally {
    Date.now = originalDateNow;
  }

  const source = readFileSync(new URL("../app/evidence.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /Date\.now|new Date|performance\.now/);
});

test("canonical action flow keeps ALLOW before execution and never introduces DENY", () => {
  const eventTypes = [
    "d002.risk-threshold-exceeded",
    "d002.emergency-braking-decision",
    "d002.brake-command",
    "d002.actuator-acknowledgement",
  ].map((eventId) => receiptByEvent(eventId).evidence.evidence_type);

  assert.deepEqual(eventTypes, ["INTENT", "POLICY_DECISION", "EXECUTION", "RESULT"]);
  const fixtureText = JSON.stringify(CANONICAL_EVIDENCE_OBJECTS);
  assert.doesNotMatch(fixtureText, /"evaluation_result":"DENY"/);
});

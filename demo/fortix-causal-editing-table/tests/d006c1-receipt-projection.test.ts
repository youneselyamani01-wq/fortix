import assert from "node:assert/strict";
import test from "node:test";

import { MISSION_ID } from "../app/missionContinuity.ts";
import { projectMissionEvidence } from "../app/missionEvidence.ts";
import { createOfflineEvidenceSession } from "../app/offlineEvidence.ts";
import {
  buildMissionEvidenceClosure,
  issueFinalMissionReceipt,
} from "../app/portableMissionEvidence.ts";
import {
  finalReceiptBinding,
  projectReceiptBindings,
  receiptBindingForVisualEvent,
  requireReceiptBinding,
} from "../app/receiptProjection.ts";
import { FINAL_RECEIPT_EMITTED_MS } from "../app/storyTimeline.ts";
import { receiptEmissionSourceForProducer } from "../app/stageGeometry.ts";
import { VISUAL_EVENTS, type VisualEvent } from "../app/visualEvents.ts";

const RUN_ID = "fortix.demo.d006.run.c1-receipts-001";

function evidence() {
  const session = projectMissionEvidence(
    createOfflineEvidenceSession(RUN_ID, null, MISSION_ID),
    FINAL_RECEIPT_EMITTED_MS,
  );
  const closure = buildMissionEvidenceClosure({
    identity: { missionId: session.missionId, runId: session.runId },
    runtimeRecords: session.records,
    asOfMasterTimeMs: FINAL_RECEIPT_EMITTED_MS,
  });
  return {
    closure,
    receipt: issueFinalMissionReceipt(closure, FINAL_RECEIPT_EMITTED_MS),
  };
}

function visual(id: string) {
  const event = VISUAL_EVENTS.find((candidate) => candidate.id === id);
  assert.ok(event, `visual event missing: ${id}`);
  return event;
}

test("D-006 C1: runtime receipt flights resolve to their exact runtime object and leaf", () => {
  const { closure } = evidence();
  const binding = requireReceiptBinding(closure, visual("signal-green"));
  assert.equal(binding.significantEventId, "d006g.signal-state-published:green-1");
  assert.equal(binding.receiptId, "NR-SIGNAL-STATE:green-1");
  assert.equal(binding.evidenceId, "NR-SIGNAL-STATE:green-1");
  assert.equal(binding.leafId, "runtime:d006g.signal-state-published:green-1");
  assert.equal(binding.producerDomain, "SMART_CITY_INFRASTRUCTURE");
  assert.equal(binding.targetEvidenceId, "NR-SIGNAL-STATE:green-1");
  assert.equal(binding.targetEventId, "d006g.signal-state-published:green-1");
  assert.equal(binding.timeMs, visual("signal-green").timeMs);

  const bank = requireReceiptBinding(closure, visual("bank-authorization"));
  assert.equal(bank.evidenceId, "NR-BANK-AUTHORIZATION:invoice-1850");
  assert.equal(bank.producerDomain, "FINANCIAL_INSTITUTION");
  assert.equal(bank.leafId, "runtime:d006g.bank-authorization");
});

test("D-006 C1: signed receipt flights bind only the exact canonical source object", () => {
  const { closure } = evidence();
  const pickup = requireReceiptBinding(closure, visual("pickup"));
  assert.equal(pickup.significantEventId, "d005.pickup-confirmed");
  assert.match(pickup.evidenceId, /^fortix:evidence:blake3:/);
  assert.equal(pickup.leafId, "signed:d005.pickup-confirmed");
  assert.equal(pickup.timeMs, visual("pickup").timeMs);
  assert.equal(pickup.producerDomain, "Passenger service");
  assert.equal(pickup.receiptKind, "mission");
  assert.equal(receiptEmissionSourceForProducer(pickup.producerDomain), "exactProducer",
    "Passenger service cannot be relabelled as the viewer who receives the ride");

  const humanApproval = requireReceiptBinding(closure, visual("human"));
  assert.equal(humanApproval.significantEventId, "d005m.master-human-approve");
  assert.equal(humanApproval.producerDomain, "Manager workflow",
    "the producer must come from signed participant_system, not an event-name alias");

  const authority = closure.members.find((member) => member.eventId === "d005m.master-payment-authority-active");
  assert.ok(authority);
  assert.equal(authority.producerDomain, "fortix.demo.manager-authority.d005m",
    "signed evidence without participant_system must retain its issuer identity");

  // NX0 (justified change): these three beats now carry evidence of their
  // OWN, so the pinned null outcomes are gone. The property this block
  // defends is unchanged — a consequence may never BORROW a neighbouring
  // object — and is asserted twice: each beat binds its own object and NOT
  // the one it used to be refused for, and a consequence with nothing of its
  // own is still refused beside the very same signed congestion object.
  const accept = requireReceiptBinding(closure, visual("accept"));
  assert.equal(accept.significantEventId, "d005.mission-accepted", "acceptance binds its own signed object");
  assert.equal(accept.timeMs, visual("accept").timeMs);
  const obstacle = requireReceiptBinding(closure, visual("obstacle"));
  assert.equal(obstacle.significantEventId, "d006nx0.perception:congestion",
    "the obstacle beat binds the taxi's own perception, not the Traffic Provider congestion object");
  assert.notEqual(obstacle.significantEventId, "d005.congestion-significant");
  const brake = requireReceiptBinding(closure, visual("brake"));
  assert.equal(brake.significantEventId, "d006nx0.action:hazard-brake",
    "the brake beat binds the vehicle's own action, not the ETA deterioration object");
  assert.notEqual(brake.significantEventId, "d005.eta-deteriorates");
  assert.equal(receiptBindingForVisualEvent(closure, visual("payment-receipt")), null);
  const borrowing: VisualEvent = { ...visual("obstacle"), id: "synthetic-consequence", sourceMomentId: "congestion", timeMs: visual("route-start").timeMs + 4_000 };
  assert.equal(receiptBindingForVisualEvent(closure, borrowing), null,
    "a consequence with no object of its own cannot borrow the Traffic Provider congestion object");
  assert.throws(
    () => requireReceiptBinding(closure, borrowing),
    /has no exact evidence object/,
  );
});

test("D-006 C1: projected receipts are a one-to-one subset of closure evidence", () => {
  const { closure, receipt } = evidence();
  const bindings = projectReceiptBindings(closure, VISUAL_EVENTS);
  assert.equal(new Set(bindings.map((binding) => binding.visualEventId)).size, bindings.length);
  assert.equal(new Set(bindings.map((binding) => binding.evidenceId)).size, bindings.length);
  for (const binding of bindings) {
    const member = closure.members.find((candidate) => candidate.evidenceId === binding.evidenceId);
    assert.ok(member, `${binding.visualEventId} emitted without closure evidence`);
    assert.equal(binding.significantEventId, member.eventId);
    assert.equal(binding.timeMs, member.timeMs);
    assert.equal(binding.producerDomain, member.producerDomain);
    assert.notEqual(receiptEmissionSourceForProducer(binding.producerDomain), null,
      `${binding.producerDomain} must have an explicit visible emission source`);
  }

  const routeStart = requireReceiptBinding(closure, visual("route-start"));
  assert.equal(routeStart.producerDomain, "Navigation Provider A");
  assert.equal(routeStart.receiptKind, "service");
  assert.equal(receiptEmissionSourceForProducer(routeStart.producerDomain), "routingProvider",
    "a navigation-provider receipt cannot originate from Taxi 07");

  const final = finalReceiptBinding(receipt);
  assert.equal(final.visualEventId, "final-receipt");
  assert.equal(final.evidenceId, receipt.receiptId);
  assert.equal(final.targetEvidenceId, receipt.receiptId);
  assert.equal(final.targetEventId, "d006.final-mission-receipt");
  assert.equal(final.leafId, "final:d006.final-mission-receipt");
  assert.equal(final.timeMs, FINAL_RECEIPT_EMITTED_MS);
  assert.equal(receiptEmissionSourceForProducer(final.producerDomain), "exactProducer",
    "the causal compiler cannot be relabelled as the physical base");
});

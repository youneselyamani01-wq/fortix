import assert from "node:assert/strict";
import test from "node:test";

import { D005M_MASTER_BUNDLE } from "../app/masterStory.ts";
import { MISSION_ID } from "../app/missionContinuity.ts";
import { projectMissionEvidence } from "../app/missionEvidence.ts";
import { createOfflineEvidenceSession } from "../app/offlineEvidence.ts";
import {
  buildMissionEvidenceClosure,
  issueFinalMissionReceipt,
  PortableMissionEvidenceError,
} from "../app/portableMissionEvidence.ts";
import { projectCausalEdges, projectPortableProofLeaves } from "../app/proofProjection.ts";
import { assessSettlementScope, deriveFinancialClosure } from "../app/settlementScope.ts";
import { FINAL_RECEIPT_EMITTED_MS } from "../app/storyTimeline.ts";

const RUN_ID = "fortix.demo.d006.run.c1-finance-001";

function sourceObjects(): readonly unknown[] {
  return (D005M_MASTER_BUNDLE as { canonical_evidence_objects: readonly unknown[] })
    .canonical_evidence_objects;
}

test("D-006 C1: provider SETTLED remains quarantined despite bank authorization evidence", () => {
  const session = projectMissionEvidence(
    createOfflineEvidenceSession(RUN_ID, null, MISSION_ID),
    FINAL_RECEIPT_EMITTED_MS,
  );
  const scope = assessSettlementScope(sourceObjects());
  const closure = deriveFinancialClosure(sourceObjects(), session.records);

  assert.equal(scope.quarantined, true);
  assert.ok(scope.unsupportedAssertions.some(
    (assertion) => assertion.eventId === "d005m.master-payment-result",
  ));
  assert.equal(closure.authorizationStatus, "AUTHORIZED");
  assert.equal(closure.transactionSubmissionStatus, "PRESENTED");
  assert.equal(closure.settlementStatus, "NOT_DEMONSTRATED");
  assert.ok(closure.unsupportedClaimEvidenceIds.length > 0);
});

test("D-006 C1: merely adding a bank boundary cannot rehabilitate provider settlement", () => {
  const providerClaim = {
    evidence_id: "provider-settled",
    significant_event: { event_id: "provider-result" },
    issuer: { issuer_id: "payment-provider" },
    trust_boundary: { trust_boundary_id: "payment-provider-boundary" },
    evidence_payload: {
      result: { instruction_ref: "invoice-d005m-1850", amount_eur: 1850, status: "SETTLED" },
    },
  };
  const bankAuthorization = {
    evidence_id: "bank-authorized",
    significant_event: { event_id: "bank-authorization" },
    issuer: { issuer_id: "bank" },
    trust_boundary: { trust_boundary_id: "account-holding-financial-institution" },
    evidence_payload: {
      decision: { instruction_ref: "invoice-d005m-1850", amount_eur: 1850, status: "AUTHORIZED" },
    },
  };
  const scope = assessSettlementScope([providerClaim, bankAuthorization]);
  assert.equal(scope.financialInstitutionPresent, true);
  assert.equal(scope.quarantined, true);
  assert.deepEqual(scope.unsupportedAssertions.map((item) => item.evidenceId), ["provider-settled"]);
});

test("D-006 C1: Final Receipt states authorization and presentation without claiming settlement", () => {
  const session = projectMissionEvidence(
    createOfflineEvidenceSession(RUN_ID, null, MISSION_ID),
    FINAL_RECEIPT_EMITTED_MS,
  );
  const closure = buildMissionEvidenceClosure({
    identity: { missionId: session.missionId, runId: session.runId },
    runtimeRecords: session.records,
    asOfMasterTimeMs: FINAL_RECEIPT_EMITTED_MS,
  });
  const receipt = issueFinalMissionReceipt(closure, FINAL_RECEIPT_EMITTED_MS);

  assert.deepEqual(
    {
      authorization: receipt.financialClosure.authorizationStatus,
      submission: receipt.financialClosure.transactionSubmissionStatus,
      settlement: receipt.financialClosure.settlementStatus,
    },
    {
      authorization: "AUTHORIZED",
      submission: "PRESENTED",
      settlement: "NOT_DEMONSTRATED",
    },
  );
  assert.doesNotMatch(JSON.stringify(receipt.financialClosure), /"settlementStatus":"SETTLED"/);
  for (const unsupportedId of closure.financialClosure.unsupportedClaimEvidenceIds) {
    assert.ok(!receipt.causalInputEvidenceIds.includes(unsupportedId),
      "a quarantined settlement assertion cannot support the Final Receipt");
  }
});

test("D-006 C1: signed instruction, provider presentation and bank result form one typed evidence chain", () => {
  const session = projectMissionEvidence(
    createOfflineEvidenceSession(`${RUN_ID}-typed-chain`, null, MISSION_ID),
    FINAL_RECEIPT_EMITTED_MS,
  );
  const closure = buildMissionEvidenceClosure({
    identity: { missionId: session.missionId, runId: session.runId },
    runtimeRecords: session.records,
    asOfMasterTimeMs: FINAL_RECEIPT_EMITTED_MS,
  });
  const receipt = issueFinalMissionReceipt(closure, FINAL_RECEIPT_EMITTED_MS);
  const byEvent = new Map(closure.members.map((member) => [member.eventId, member]));
  const invoice = byEvent.get("d005m.master-invoice-1850")!;
  const authority = byEvent.get("d005m.master-payment-authorized")!;
  const instruction = byEvent.get("d005m.master-payment-instruction")!;
  const presented = byEvent.get("d006g.payment-instruction-presented")!;
  const bankAuthorization = byEvent.get("d006g.bank-authorization")!;
  const bankConfirmation = byEvent.get("d006g.bank-confirmation")!;
  for (const member of [invoice, authority, instruction, presented, bankAuthorization, bankConfirmation]) {
    assert.ok(member, "every financial-chain member must be in the portable closure");
  }

  const ancestry = (memberId: string): ReadonlySet<string> => {
    const byId = new Map(closure.members.map((member) => [member.evidenceId, member]));
    const found = new Set<string>();
    const pending = [...(byId.get(memberId)?.causalParents ?? [])];
    while (pending.length > 0) {
      const parent = pending.pop()!;
      if (found.has(parent)) continue;
      found.add(parent);
      pending.push(...(byId.get(parent)?.causalParents ?? []));
    }
    return found;
  };
  assert.ok(ancestry(instruction.evidenceId).has(invoice.evidenceId));
  assert.ok(ancestry(instruction.evidenceId).has(authority.evidenceId));
  assert.deepEqual(presented.observedInputs, [instruction.evidenceId]);
  assert.deepEqual(bankAuthorization.observedInputs, [presented.evidenceId]);
  assert.deepEqual(bankConfirmation.causalParents, [bankAuthorization.evidenceId]);
  assert.ok(receipt.causalInputEvidenceIds.includes(bankConfirmation.evidenceId));

  const leaves = projectPortableProofLeaves(closure, FINAL_RECEIPT_EMITTED_MS, receipt);
  const leafByEvidence = new Map(leaves.map((leaf) => [leaf.evidenceId, leaf.leafId]));
  const edges = projectCausalEdges(leaves);
  const hasEdge = (from: string, to: string, relation: "CAUSAL" | "OBSERVED_INPUT") => edges.some((edge) => (
    edge.from === leafByEvidence.get(from)
    && edge.to === leafByEvidence.get(to)
    && edge.relation === relation
  ));
  assert.equal(hasEdge(instruction.evidenceId, presented.evidenceId, "OBSERVED_INPUT"), true);
  assert.equal(hasEdge(presented.evidenceId, bankAuthorization.evidenceId, "OBSERVED_INPUT"), true);
  assert.equal(hasEdge(bankAuthorization.evidenceId, bankConfirmation.evidenceId, "CAUSAL"), true);
  assert.equal(hasEdge(bankConfirmation.evidenceId, receipt.receiptId, "CAUSAL"), true);
});

test("D-006 C1: quarantine propagates through compiled descendants and never supports closure", () => {
  const session = projectMissionEvidence(
    createOfflineEvidenceSession(`${RUN_ID}-quarantine-closure`, null, MISSION_ID),
    FINAL_RECEIPT_EMITTED_MS,
  );
  const closure = buildMissionEvidenceClosure({
    identity: { missionId: session.missionId, runId: session.runId },
    runtimeRecords: session.records,
    asOfMasterTimeMs: FINAL_RECEIPT_EMITTED_MS,
  });
  const providerResult = closure.members.find((member) => member.eventId === "d005m.master-payment-result")!;
  const compiledPaymentReceipt = closure.members.find((member) => member.eventId === "d005m.receipt.master-payment")!;
  const returnReceipt = closure.members.find((member) => member.eventId === "d005m.receipt.master-return-to-base")!;
  assert.equal(providerResult.assurance, "QUARANTINED");
  assert.equal(compiledPaymentReceipt.assurance, "QUARANTINED");
  assert.ok(compiledPaymentReceipt.causalParents.includes(providerResult.evidenceId));
  assert.ok(!closure.causalInputEvidenceIds.includes(providerResult.evidenceId));
  assert.ok(!closure.causalInputEvidenceIds.includes(compiledPaymentReceipt.evidenceId));
  assert.equal(returnReceipt.assurance, "ELIGIBLE",
    "a claim-scoped payment quarantine cannot contaminate independent return completion");
  assert.ok(closure.causalInputEvidenceIds.includes(returnReceipt.evidenceId));
  const proofLeaves = projectPortableProofLeaves(closure, FINAL_RECEIPT_EMITTED_MS);
  const assuranceByEvent = new Map(proofLeaves.map((leaf) => [leaf.label, leaf.assurance]));
  assert.equal(assuranceByEvent.get("d005m.master-payment-result"), "QUARANTINED");
  assert.equal(assuranceByEvent.get("d005m.receipt.master-payment"), "QUARANTINED");
  assert.equal(assuranceByEvent.get("d006g.bank-authorization"), "ELIGIBLE");
  assert.equal(assuranceByEvent.get("d006g.bank-confirmation"), "ELIGIBLE");
  const receipt = issueFinalMissionReceipt(closure, FINAL_RECEIPT_EMITTED_MS);
  assert.ok(!receipt.causalInputEvidenceIds.includes(providerResult.evidenceId));
  assert.ok(!receipt.causalInputEvidenceIds.includes(compiledPaymentReceipt.evidenceId));

  const ineligibleReturn = {
    ...closure,
    members: closure.members.map((member) => member.eventId === "d005m.receipt.master-return-to-base"
      ? { ...member, assurance: "QUARANTINED" as const }
      : member),
  };
  assert.throws(
    () => issueFinalMissionReceipt(ineligibleReturn, FINAL_RECEIPT_EMITTED_MS),
    (error: unknown) => error instanceof PortableMissionEvidenceError
      && error.reasonCode === "FINAL_REQUIRED_LEAF_INELIGIBLE",
  );
});

test("D-006 C1 adversarial: visual payment completion without bank result cannot close financial proof", () => {
  const visuallyComplete = projectMissionEvidence(
    createOfflineEvidenceSession(`${RUN_ID}-missing-result`, null, MISSION_ID),
    FINAL_RECEIPT_EMITTED_MS,
  );
  const withoutBankResult = visuallyComplete.records.filter(
    (record) => record.eventId !== "d006g.bank-confirmation",
  );
  const closure = buildMissionEvidenceClosure({
    identity: { missionId: visuallyComplete.missionId, runId: visuallyComplete.runId },
    runtimeRecords: withoutBankResult,
    asOfMasterTimeMs: FINAL_RECEIPT_EMITTED_MS,
  });

  assert.equal(closure.financialClosure.settlementStatus, "NOT_DEMONSTRATED");
  assert.ok(!closure.financialClosure.supportingEvidenceIds.includes("NR-BANK-CONFIRMATION:invoice-1850"));
  assert.throws(
    () => issueFinalMissionReceipt(closure, FINAL_RECEIPT_EMITTED_MS),
    (error: unknown) => error instanceof PortableMissionEvidenceError
      && error.reasonCode === "REQUIRED_RUNTIME_EVIDENCE_MISSING",
  );
});

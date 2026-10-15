import assert from "node:assert/strict";
import test from "node:test";

import { blake3 } from "@noble/hashes/blake3.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

import {
  D005M_MASTER_BUNDLE,
  D005M_MASTER_BUNDLE_TEXT,
  D005M_MASTER_CYCLE_RECEIPT_ID,
} from "../app/masterStory.ts";
import { MISSION_ID } from "../app/missionContinuity.ts";
import { projectMissionEvidence } from "../app/missionEvidence.ts";
import {
  PHYSICAL_SENTINEL_SOURCE,
  TARGET_ADAPTER_IDENTITY,
  appendMissionEvidence,
  appendNetworkTransition,
  canonicalRecordDigest,
  createOfflineEvidenceSession,
  isOfflineEvidenceSessionJournalValid,
  sealFinalReceiptRuntimeEvidence,
} from "../app/offlineEvidence.ts";
import type { OfflineCausalRecord } from "../app/offlineEvidence.ts";
import {
  analyzeInsertedD006Peb,
  insertD006PebForAnalysis,
  verifyD006PortableMissionEvidence,
} from "../app/offlineVerification.ts";
import {
  PortableMissionEvidenceError,
  buildMissionEvidenceClosure,
  buildPortableMissionEvidenceBundle,
  createHandoffArtifact,
  expectedDisplayedEvidenceIds,
  finalReceiptRuntimeEvidencePrefix,
  issueFinalMissionReceipt,
  routingProvenanceFromRuntimeRecords,
  transferredContentDigest,
  type PortableMissionEvidenceBundle,
} from "../app/portableMissionEvidence.ts";
import { projectPortableProofLeaves } from "../app/proofProjection.ts";
import {
  CANONICAL_ROUTING_PROVENANCE,
  createRoutingProvenance,
  createSelectedResolvedMismatchProvenance,
  type RoutingProvenance,
} from "../app/routingProvenance.ts";
import {
  FINAL_RECEIPT_EMITTED_MS,
  HANDOFF_READY_MS,
  PEB_COMPLETE_MS,
} from "../app/storyTimeline.ts";
import { canonicalString } from "../app/verification.ts";

const RUN_ID = "fortix.demo.d006.run.c1-portable-001";

function buildArtifacts(
  provenance = undefined as ReturnType<typeof createSelectedResolvedMismatchProvenance> | undefined,
) {
  let session = createOfflineEvidenceSession(RUN_ID, null, MISSION_ID);
  session = provenance === undefined
    ? projectMissionEvidence(session, FINAL_RECEIPT_EMITTED_MS)
    : projectMissionEvidence(session, FINAL_RECEIPT_EMITTED_MS, provenance);
  session = sealFinalReceiptRuntimeEvidence(session, FINAL_RECEIPT_EMITTED_MS);
  const runtimeRecords = finalReceiptRuntimeEvidencePrefix(session);
  const identity = { missionId: session.missionId, runId: session.runId };
  const closure = buildMissionEvidenceClosure({
    identity,
    runtimeRecords,
    asOfMasterTimeMs: FINAL_RECEIPT_EMITTED_MS,
  });
  const receipt = issueFinalMissionReceipt(closure, FINAL_RECEIPT_EMITTED_MS);
  const displayedEvidenceIds = expectedDisplayedEvidenceIds(closure, receipt);
  const peb = buildPortableMissionEvidenceBundle({
    closure,
    finalReceipt: receipt,
    runtimeRecords,
    displayedEvidenceIds,
    masterTimeMs: PEB_COMPLETE_MS,
  });
  const handoff = createHandoffArtifact(peb, HANDOFF_READY_MS);
  return { session, identity, closure, receipt, displayedEvidenceIds, peb, handoff };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function digestCanonical(value: unknown): string {
  return bytesToHex(blake3(utf8ToBytes(canonicalString(value))));
}

test("D-006 C1: one content-derived closure drives proof, Final Receipt, PEB and exact-byte handoff", async () => {
  const { closure, receipt, displayedEvidenceIds, peb, handoff, identity } = buildArtifacts();

  assert.equal(canonicalString(peb.sourceBundle), D005M_MASTER_BUNDLE_TEXT);
  assert.deepEqual(peb.identity, identity);
  assert.deepEqual(receipt.identity, identity);
  assert.match(receipt.receiptId, /^fortix:receipt:blake3:[0-9a-f]{64}$/);
  assert.equal(receipt.financialClosure.settlementStatus, "NOT_DEMONSTRATED");
  assert.ok(closure.assuranceSupportEvidenceIds.includes(D005M_MASTER_CYCLE_RECEIPT_ID));
  assert.ok(!closure.presentationEvidenceIds.includes(D005M_MASTER_CYCLE_RECEIPT_ID));
  assert.deepEqual(peb.manifest.presentationEvidenceIds, displayedEvidenceIds);

  const leaves = projectPortableProofLeaves(closure, FINAL_RECEIPT_EMITTED_MS, receipt);
  assert.deepEqual(
    new Set(leaves.map((leaf) => leaf.evidenceId)),
    new Set(displayedEvidenceIds),
    "the rendered terminal set and portable presentation set are identical",
  );
  assert.notEqual(peb.manifest.bundleDigest, handoff.transferredContentDigest);
  assert.equal(handoff.transferredContentDigest, transferredContentDigest(handoff.pebText));

  const inserted = insertD006PebForAnalysis({
    pebText: handoff.pebText,
    expectedIdentity: identity,
    expectedTransferredContentDigest: handoff.transferredContentDigest,
  });
  const analyzed = await analyzeInsertedD006Peb(inserted);
  assert.equal(analyzed.result.verdict, "INDETERMINATE");
  assert.equal(analyzed.result.receiptId, receipt.receiptId);
  assert.equal(analyzed.result.bundleId, peb.bundleId);
  assert.ok(analyzed.result.completedChecks.includes("d006_displayed_peb_coverage"));
});

test("D-006 C1: Final Receipt support survives a real post-emission rewound network append", () => {
  const { session, receipt } = buildArtifacts();
  const sealedPrefix = finalReceiptRuntimeEvidencePrefix(session);
  const lastClock = session.records.at(-1)?.missionClockPosition ?? -1;
  const afterLoss = appendNetworkTransition(session, {
    runId: session.runId,
    observationId: "probe-real-loss-after-final-rewind",
    adapterIdentity: TARGET_ADAPTER_IDENTITY,
    observationSource: PHYSICAL_SENTINEL_SOURCE,
    previousNetworkState: "CONNECTED",
    newNetworkState: "LOST",
    missionClockPosition: lastClock + 1,
    observedMasterTimeMs: 30_000,
  }).session;

  assert.equal(isOfflineEvidenceSessionJournalValid(afterLoss), true);
  assert.ok(afterLoss.records.length > sealedPrefix.length);
  assert.deepEqual(finalReceiptRuntimeEvidencePrefix(afterLoss), sealedPrefix,
    "a later append stays outside the sealed prefix even when observed on a rewound clock");
  const replayedSeal = sealFinalReceiptRuntimeEvidence(afterLoss, FINAL_RECEIPT_EMITTED_MS);
  assert.equal(replayedSeal, afterLoss, "re-sealing is idempotent and cannot move the boundary");
  const closureAfterLoss = buildMissionEvidenceClosure({
    identity: { missionId: afterLoss.missionId, runId: afterLoss.runId },
    runtimeRecords: finalReceiptRuntimeEvidencePrefix(afterLoss),
    asOfMasterTimeMs: FINAL_RECEIPT_EMITTED_MS,
  });
  assert.equal(
    issueFinalMissionReceipt(closureAfterLoss, FINAL_RECEIPT_EMITTED_MS).receiptId,
    receipt.receiptId,
    "post-emission physical evidence cannot rewrite the issued receipt identity",
  );
  assert.equal(Object.isFrozen(sealedPrefix), true);
});

test("D-006 C1: routing triggers resolve to exact signed causal parents", () => {
  const { closure } = buildArtifacts();
  const route = closure.members.find((member) => member.eventId === "d006.c1.routing-provenance");
  assert.ok(route);
  const triggerEvidenceIds = CANONICAL_ROUTING_PROVENANCE.routing_request.triggering_event_ids.map((eventId) => {
    const member = closure.members.find((candidate) => candidate.eventId === eventId);
    assert.ok(member, `signed routing trigger is missing: ${eventId}`);
    return member.evidenceId;
  });
  assert.deepEqual(route.causalParents, triggerEvidenceIds);
  assert.deepEqual(route.observedInputs, []);
});

test("D-006 C1 adversarial: fabricated triggers and unsupported EXTERNAL routing fail closed", async () => {
  const fabricatedTrigger = createRoutingProvenance({
    ...CANONICAL_ROUTING_PROVENANCE,
    routing_request: {
      ...CANONICAL_ROUTING_PROVENANCE.routing_request,
      triggering_event_ids: ["fabricated.traffic-condition"],
    },
  });
  const externalExecution = createRoutingProvenance({
    ...CANONICAL_ROUTING_PROVENANCE,
    candidate_set: CANONICAL_ROUTING_PROVENANCE.candidate_set.map((candidate) => ({
      ...candidate,
      execution_truth: "EXTERNAL" as const,
    })),
  });
  for (const provenance of [fabricatedTrigger, externalExecution]) {
    const session = projectMissionEvidence(
      createOfflineEvidenceSession(`${RUN_ID}-${provenance.routing_request.triggering_event_ids[0]}-${provenance.candidate_set[0]!.execution_truth}`, null, MISSION_ID),
      FINAL_RECEIPT_EMITTED_MS,
      provenance,
    );
    assert.throws(
      () => buildMissionEvidenceClosure({
        identity: { missionId: session.missionId, runId: session.runId },
        runtimeRecords: session.records,
        asOfMasterTimeMs: FINAL_RECEIPT_EMITTED_MS,
      }),
      (error: unknown) => error instanceof PortableMissionEvidenceError
        && error.reasonCode === "ROUTING_PROVENANCE_INVALID",
    );
  }

  const { peb, identity } = buildArtifacts();
  const forged = clone(peb);
  const routeIndex = forged.runtimeRecords.findIndex((record) => record.eventId === "d006.c1.routing-provenance");
  assert.ok(routeIndex >= 0);
  const original = forged.runtimeRecords[routeIndex]!;
  const unsigned = {
    ...original,
    payload: { ...original.payload, routing_provenance: fabricatedTrigger },
  };
  const forgedRecord = { ...unsigned, canonicalDigest: canonicalRecordDigest(unsigned) };
  const forgedRecords = [
    ...forged.runtimeRecords.slice(0, routeIndex),
    forgedRecord,
    ...forged.runtimeRecords.slice(routeIndex + 1),
  ];
  const forgedDraft = {
    ...forged,
    runtimeRecords: forgedRecords,
    manifest: { ...forged.manifest, bundleDigest: "" },
  };
  const forgedPeb = {
    ...forgedDraft,
    manifest: { ...forgedDraft.manifest, bundleDigest: digestCanonical(forgedDraft) },
  } as PortableMissionEvidenceBundle;
  const forgedText = canonicalString(forgedPeb);
  const verified = await verifyD006PortableMissionEvidence(forgedText, {
    expectedIdentity: identity,
    expectedTransferredContentDigest: transferredContentDigest(forgedText),
  });
  assert.equal(verified.verdict, "INVALID");
  assert.deepEqual(verified.reasonCodes, ["D006_ROUTING_PROVENANCE_INVALID"]);
});

test("D-006 C1: timing gates, missing evidence and display/PEB mismatch block maturation", () => {
  const { session, closure, receipt, displayedEvidenceIds } = buildArtifacts();

  assert.throws(
    () => buildPortableMissionEvidenceBundle({
      closure,
      finalReceipt: receipt,
      runtimeRecords: session.records,
      displayedEvidenceIds,
      masterTimeMs: PEB_COMPLETE_MS - 1,
    }),
    (error: unknown) => error instanceof PortableMissionEvidenceError
      && error.reasonCode === "PEB_PREMATURE",
  );

  const missingClosure = buildMissionEvidenceClosure({
    identity: closure.identity,
    runtimeRecords: session.records.slice(0, -1),
    asOfMasterTimeMs: FINAL_RECEIPT_EMITTED_MS,
  });
  assert.throws(
    () => issueFinalMissionReceipt(missingClosure, FINAL_RECEIPT_EMITTED_MS),
    (error: unknown) => error instanceof PortableMissionEvidenceError
      && error.reasonCode === "REQUIRED_RUNTIME_EVIDENCE_MISSING",
  );

  assert.throws(
    () => buildPortableMissionEvidenceBundle({
      closure,
      finalReceipt: receipt,
      runtimeRecords: session.records,
      displayedEvidenceIds: displayedEvidenceIds.slice(0, -1),
      masterTimeMs: PEB_COMPLETE_MS,
    }),
    (error: unknown) => error instanceof PortableMissionEvidenceError
      && error.reasonCode === "DISPLAYED_PEB_COVERAGE_MISMATCH",
  );
  const peb = buildPortableMissionEvidenceBundle({
    closure,
    finalReceipt: receipt,
    runtimeRecords: session.records,
    displayedEvidenceIds,
    masterTimeMs: PEB_COMPLETE_MS,
  });
  assert.throws(
    () => createHandoffArtifact(peb, HANDOFF_READY_MS - 1),
    (error: unknown) => error instanceof PortableMissionEvidenceError
      && error.reasonCode === "HANDOFF_PREMATURE",
  );
});

test("D-006 C1: stale, mutated and identity-mismatched transferred material is rejected", async () => {
  const { session, closure, receipt, displayedEvidenceIds, handoff, identity } = buildArtifacts();

  const relabelledMissionId = "fortix.demo.attacker.relabelled-mission";
  const relabelled = projectMissionEvidence(
    createOfflineEvidenceSession(`${RUN_ID}-relabelled`, null, relabelledMissionId),
    FINAL_RECEIPT_EMITTED_MS,
  );
  assert.throws(
    () => buildMissionEvidenceClosure({
      identity: { missionId: relabelledMissionId, runId: relabelled.runId },
      runtimeRecords: relabelled.records,
      asOfMasterTimeMs: FINAL_RECEIPT_EMITTED_MS,
    }),
    (error: unknown) => error instanceof PortableMissionEvidenceError
      && error.reasonCode === "MISSION_ID_MISMATCH",
    "the immutable source target's canonical chain cannot be relabelled by an outer wrapper",
  );

  const staleClosure = { ...clone(closure), evidenceSetDigest: "0".repeat(64) };
  assert.throws(
    () => buildPortableMissionEvidenceBundle({
      closure: staleClosure,
      finalReceipt: receipt,
      runtimeRecords: session.records,
      displayedEvidenceIds,
      masterTimeMs: PEB_COMPLETE_MS,
    }),
    (error: unknown) => error instanceof PortableMissionEvidenceError
      && error.reasonCode === "CLOSURE_STALE_OR_MUTATED",
  );

  const originalRecord = session.records.at(-1)!;
  const mutatedPayload = { ...originalRecord.payload, confirmation: "SETTLED" };
  const mutatedRecord = { ...originalRecord, payload: mutatedPayload };
  assert.throws(
    () => buildMissionEvidenceClosure({
      identity,
      runtimeRecords: [...session.records.slice(0, -1), mutatedRecord],
      asOfMasterTimeMs: FINAL_RECEIPT_EMITTED_MS,
    }),
    (error: unknown) => error instanceof PortableMissionEvidenceError
      && error.reasonCode === "RUNTIME_RECORD_DIGEST_MISMATCH",
  );

  const redigestedRecord = {
    ...mutatedRecord,
    canonicalDigest: canonicalRecordDigest(mutatedRecord),
  };
  assert.throws(
    () => buildMissionEvidenceClosure({
      identity,
      runtimeRecords: [...session.records.slice(0, -1), redigestedRecord],
      asOfMasterTimeMs: FINAL_RECEIPT_EMITTED_MS,
    }),
    (error: unknown) => error instanceof PortableMissionEvidenceError
      && error.reasonCode === "REQUIRED_RUNTIME_EVIDENCE_MUTATED",
  );

  const wrongTransfer = await verifyD006PortableMissionEvidence(handoff.pebText, {
    expectedIdentity: identity,
    expectedTransferredContentDigest: "f".repeat(64),
  });
  assert.deepEqual(wrongTransfer.reasonCodes, ["D006_PEB_TRANSFER_DIGEST_MISMATCH"]);

  const wrongIdentity = await verifyD006PortableMissionEvidence(handoff.pebText, {
    expectedIdentity: { ...identity, runId: `${identity.runId}-other` },
    expectedTransferredContentDigest: handoff.transferredContentDigest,
  });
  assert.deepEqual(wrongIdentity.reasonCodes, ["D006_MISSION_RUN_IDENTITY_MISMATCH"]);

  const attackerDraft = {
    ...handoff.peb,
    runtimeRecords: [...handoff.peb.runtimeRecords.slice(0, -1), mutatedRecord],
    manifest: { ...handoff.peb.manifest, bundleDigest: "" },
  };
  const rebound: PortableMissionEvidenceBundle = {
    ...attackerDraft,
    manifest: {
      ...attackerDraft.manifest,
      bundleDigest: digestCanonical(attackerDraft),
    },
  };
  const reboundText = canonicalString(rebound);
  const invalid = await verifyD006PortableMissionEvidence(reboundText, {
    expectedIdentity: identity,
    expectedTransferredContentDigest: transferredContentDigest(reboundText),
  });
  assert.deepEqual(invalid.reasonCodes, ["D006_RUNTIME_RECORD_DIGEST_MISMATCH"]);

  const missingMemberDraft = {
    ...handoff.peb,
    manifest: {
      ...handoff.peb.manifest,
      memberRefs: handoff.peb.manifest.memberRefs.slice(1),
      bundleDigest: "",
    },
  };
  const missingMemberPeb: PortableMissionEvidenceBundle = {
    ...missingMemberDraft,
    manifest: {
      ...missingMemberDraft.manifest,
      bundleDigest: digestCanonical(missingMemberDraft),
    },
  };
  const missingMemberText = canonicalString(missingMemberPeb);
  const missingMember = await verifyD006PortableMissionEvidence(missingMemberText, {
    expectedIdentity: identity,
    expectedTransferredContentDigest: transferredContentDigest(missingMemberText),
  });
  assert.deepEqual(missingMember.reasonCodes, ["D006_PEB_CLOSURE_MISMATCH"]);
});

test("D-006 C1: verifier rejects a specialized runtime record that contradicts its digested payload", async () => {
  let session = projectMissionEvidence(
    createOfflineEvidenceSession(RUN_ID, null, MISSION_ID),
    FINAL_RECEIPT_EMITTED_MS,
  );
  session = appendNetworkTransition(session, {
    runId: RUN_ID,
    observationId: "c1-portable-loss-observation",
    adapterIdentity: TARGET_ADAPTER_IDENTITY,
    observationSource: PHYSICAL_SENTINEL_SOURCE,
    previousNetworkState: "CONNECTED",
    newNetworkState: "LOST",
    missionClockPosition: 119_000,
  }).session;
  const identity = { missionId: session.missionId, runId: session.runId };
  const closure = buildMissionEvidenceClosure({
    identity,
    runtimeRecords: session.records,
    asOfMasterTimeMs: FINAL_RECEIPT_EMITTED_MS,
  });
  const receipt = issueFinalMissionReceipt(closure, FINAL_RECEIPT_EMITTED_MS);
  const peb = buildPortableMissionEvidenceBundle({
    closure,
    finalReceipt: receipt,
    runtimeRecords: session.records,
    displayedEvidenceIds: expectedDisplayedEvidenceIds(closure, receipt),
    masterTimeMs: PEB_COMPLETE_MS,
  });
  const networkIndex = peb.runtimeRecords.findIndex((record) => record.eventType === "NETWORK_LINK_LOST");
  assert.ok(networkIndex >= 0);
  const contradictoryRecord = {
    ...peb.runtimeRecords[networkIndex],
    adapterIdentity: "ATTACKER CONTRADICTION",
  } as OfflineCausalRecord;
  const contradictoryRecords = [
    ...peb.runtimeRecords.slice(0, networkIndex),
    contradictoryRecord,
    ...peb.runtimeRecords.slice(networkIndex + 1),
  ];

  assert.throws(
    () => buildMissionEvidenceClosure({
      identity,
      runtimeRecords: contradictoryRecords,
      asOfMasterTimeMs: FINAL_RECEIPT_EMITTED_MS,
    }),
    (error: unknown) => error instanceof PortableMissionEvidenceError
      && error.reasonCode === "RUNTIME_RECORD_PROJECTION_MISMATCH",
  );

  const attackerDraft = {
    ...peb,
    runtimeRecords: contradictoryRecords,
    manifest: { ...peb.manifest, bundleDigest: "" },
  };
  const rebound: PortableMissionEvidenceBundle = {
    ...attackerDraft,
    manifest: {
      ...attackerDraft.manifest,
      bundleDigest: digestCanonical(attackerDraft),
    },
  };
  const reboundText = canonicalString(rebound);
  const verified = await verifyD006PortableMissionEvidence(reboundText, {
    expectedIdentity: identity,
    expectedTransferredContentDigest: transferredContentDigest(reboundText),
  });
  assert.equal(verified.verdict, "INVALID");
  assert.deepEqual(verified.reasonCodes, ["D006_RUNTIME_RECORD_PROJECTION_MISMATCH"]);

  const originalNetwork = peb.runtimeRecords[networkIndex]!;
  const illegalUnsigned = {
    ...originalNetwork,
    previousNetworkState: "LOST" as const,
    newNetworkState: "LOST" as const,
    payload: {
      ...originalNetwork.payload,
      previous_network_state: "LOST",
      new_network_state: "LOST",
    },
  };
  const illegalNetwork = {
    ...illegalUnsigned,
    canonicalDigest: canonicalRecordDigest(illegalUnsigned),
  } as OfflineCausalRecord;
  const illegalRecords = [
    ...peb.runtimeRecords.slice(0, networkIndex),
    illegalNetwork,
    ...peb.runtimeRecords.slice(networkIndex + 1),
  ];
  assert.throws(
    () => buildMissionEvidenceClosure({
      identity,
      runtimeRecords: illegalRecords,
      asOfMasterTimeMs: FINAL_RECEIPT_EMITTED_MS,
    }),
    (error: unknown) => error instanceof PortableMissionEvidenceError
      && error.reasonCode === "RUNTIME_RESERVED_LIFECYCLE_INVALID",
  );
  const lifecycleDraft = {
    ...peb,
    runtimeRecords: illegalRecords,
    manifest: { ...peb.manifest, bundleDigest: "" },
  };
  const lifecyclePeb: PortableMissionEvidenceBundle = {
    ...lifecycleDraft,
    manifest: {
      ...lifecycleDraft.manifest,
      bundleDigest: digestCanonical(lifecycleDraft),
    },
  };
  const lifecycleText = canonicalString(lifecyclePeb);
  const lifecycleVerdict = await verifyD006PortableMissionEvidence(lifecycleText, {
    expectedIdentity: identity,
    expectedTransferredContentDigest: transferredContentDigest(lifecycleText),
  });
  assert.equal(lifecycleVerdict.verdict, "INVALID");
  assert.deepEqual(lifecycleVerdict.reasonCodes, ["D006_RUNTIME_RESERVED_LIFECYCLE_INVALID"]);
});

test("D-006 C1: verifier rejects a dangling first runtime predecessor", async () => {
  const { handoff, identity } = buildArtifacts();
  const first = handoff.peb.runtimeRecords[0];
  assert.ok(first);
  const danglingUnsigned = {
    ...first,
    causalPredecessors: ["MISSING-EXTERNAL-PARENT"],
  } as OfflineCausalRecord;
  const dangling = {
    ...danglingUnsigned,
    canonicalDigest: canonicalRecordDigest(danglingUnsigned),
  };
  const runtimeRecords = [dangling, ...handoff.peb.runtimeRecords.slice(1)];

  assert.throws(
    () => buildMissionEvidenceClosure({
      identity,
      runtimeRecords,
      asOfMasterTimeMs: FINAL_RECEIPT_EMITTED_MS,
    }),
    (error: unknown) => error instanceof PortableMissionEvidenceError
      && error.reasonCode === "RUNTIME_CAUSAL_ORDER_INVALID",
  );

  const attackerDraft = {
    ...handoff.peb,
    runtimeRecords,
    manifest: { ...handoff.peb.manifest, bundleDigest: "" },
  };
  const rebound: PortableMissionEvidenceBundle = {
    ...attackerDraft,
    manifest: {
      ...attackerDraft.manifest,
      bundleDigest: digestCanonical(attackerDraft),
    },
  };
  const reboundText = canonicalString(rebound);
  const verified = await verifyD006PortableMissionEvidence(reboundText, {
    expectedIdentity: identity,
    expectedTransferredContentDigest: transferredContentDigest(reboundText),
  });
  assert.equal(verified.verdict, "INVALID");
  assert.deepEqual(verified.reasonCodes, ["D006_RUNTIME_CAUSAL_ORDER_INVALID"]);
});

test("D-006 C1: closed runtime profile rejects contradictory financial and routing claims", async () => {
  const { session, handoff, identity } = buildArtifacts();
  const attacks = [
    {
      eventId: "audit.bank-settlement-claim",
      eventType: "BANK_SETTLEMENT_RESULT",
      receiptId: "NR-AUDIT-BANK-SETTLED",
      payload: {
        trust_domain: "FINANCIAL_INSTITUTION",
        settlement_status: "SETTLED",
        instruction_ref: "invoice-d005m-1850",
        amount_eur: 1850,
        caused_by: "NR-BANK-CONFIRMATION:invoice-1850",
      },
    },
    {
      eventId: "audit.routing-claim",
      eventType: "ROUTING_PROVENANCE_RECORDED",
      receiptId: "NR-AUDIT-ROUTE",
      payload: {
        trust_domain: "ROUTING_ORCHESTRATOR",
        routing_provenance: {
          selected_provider: "A",
          resolved_provider: "B",
          fallback: null,
        },
      },
    },
  ] as const;

  for (const [index, attack] of attacks.entries()) {
    const attacked = appendMissionEvidence(session, {
      missionId: identity.missionId,
      runId: identity.runId,
      eventId: attack.eventId,
      eventType: attack.eventType,
      receiptId: attack.receiptId,
      missionClockPosition: 89_000 + index,
      executionLocality: "LOCAL",
      payload: attack.payload,
    }).session;
    assert.throws(
      () => buildMissionEvidenceClosure({
        identity,
        runtimeRecords: attacked.records,
        asOfMasterTimeMs: FINAL_RECEIPT_EMITTED_MS,
      }),
      (error: unknown) => error instanceof PortableMissionEvidenceError
        && error.reasonCode === "RUNTIME_EVENT_NOT_ALLOWED",
    );

    const attackerDraft = {
      ...handoff.peb,
      runtimeRecords: attacked.records,
      manifest: { ...handoff.peb.manifest, bundleDigest: "" },
    };
    const rebound: PortableMissionEvidenceBundle = {
      ...attackerDraft,
      manifest: {
        ...attackerDraft.manifest,
        bundleDigest: digestCanonical(attackerDraft),
      },
    };
    const reboundText = canonicalString(rebound);
    const verified = await verifyD006PortableMissionEvidence(reboundText, {
      expectedIdentity: identity,
      expectedTransferredContentDigest: transferredContentDigest(reboundText),
    });
    assert.equal(verified.verdict, "INVALID");
    assert.deepEqual(verified.reasonCodes, ["D006_RUNTIME_EVENT_NOT_ALLOWED"]);
  }
});

test("D-006 C1: selected A and resolved B remain distinct, portable and valid only with bound fallback", async () => {
  const mismatch = createSelectedResolvedMismatchProvenance();
  const { handoff, identity, session, closure } = buildArtifacts(mismatch);
  const routeRecord = session.records.find((record) => record.eventId === "d006.c1.routing-provenance");
  assert.ok(routeRecord);
  const route = routeRecord.payload.routing_provenance as unknown as RoutingProvenance;
  const projectedRoute = routingProvenanceFromRuntimeRecords(session.records);
  assert.deepEqual(projectedRoute, mismatch,
    "restored presentation and transferred evidence must consume the same run-owned provenance");
  assert.notEqual(route.selected_provider, route.resolved_provider);
  const fallback = route.fallback;
  assert.ok(fallback);
  assert.equal(fallback.from_candidate_id, "sim-route-provider-a");
  assert.equal(fallback.to_candidate_id, "sim-route-provider-b");
  assert.equal(route.resulting_route.route_source_ref, route.resolved_source);
  const routingLeaf = projectPortableProofLeaves(closure, FINAL_RECEIPT_EMITTED_MS)
    .find((leaf) => leaf.evidenceId === routeRecord.receiptId);
  assert.equal(routingLeaf?.branch, "route");

  const verified = await verifyD006PortableMissionEvidence(handoff.pebText, {
    expectedIdentity: identity,
    expectedTransferredContentDigest: handoff.transferredContentDigest,
  });
  assert.equal(verified.verdict, "INDETERMINATE");

  const routeIndex = session.records.findIndex((record) => record.eventId === "d006.c1.routing-provenance");
  const originalRouteRecord = session.records[routeIndex];
  assert.ok(originalRouteRecord);
  const originalRoute = originalRouteRecord.payload.routing_provenance as unknown as RoutingProvenance;
  const corruptedUnsigned = {
    ...originalRouteRecord,
    payload: {
      ...originalRouteRecord.payload,
      routing_provenance: { ...originalRoute, fallback: null },
    },
  } as OfflineCausalRecord;
  const corruptedRoute = {
    ...corruptedUnsigned,
    canonicalDigest: canonicalRecordDigest(corruptedUnsigned),
  };
  const corrupted = [
    ...session.records.slice(0, routeIndex),
    corruptedRoute,
    ...session.records.slice(routeIndex + 1),
  ];
  assert.throws(
    () => buildMissionEvidenceClosure({
      identity,
      runtimeRecords: corrupted,
      asOfMasterTimeMs: FINAL_RECEIPT_EMITTED_MS,
      sourceBundle: D005M_MASTER_BUNDLE,
    }),
    (error: unknown) => error instanceof PortableMissionEvidenceError
      && error.reasonCode === "ROUTING_PROVENANCE_INVALID",
  );

  const relabelledUnsigned = {
    ...originalRouteRecord,
    eventType: "GENERIC_ROUTE_ASSERTION",
  } as OfflineCausalRecord;
  const relabelledRoute = {
    ...relabelledUnsigned,
    canonicalDigest: canonicalRecordDigest(relabelledUnsigned),
  };
  const relabelledRecords = [
    ...session.records.slice(0, routeIndex),
    relabelledRoute,
    ...session.records.slice(routeIndex + 1),
  ];
  assert.equal(isOfflineEvidenceSessionJournalValid({
    ...session,
    records: relabelledRecords,
    finalReceiptRuntimeSeal: null,
  }), true,
    "the generic journal layer need not understand the closed route profile");
  assert.throws(
    () => routingProvenanceFromRuntimeRecords(relabelledRecords),
    (error: unknown) => error instanceof PortableMissionEvidenceError
      && error.reasonCode === "REQUIRED_RUNTIME_EVIDENCE_MUTATED",
    "UI extraction must reject the same relabelled route record the PEB closure rejects",
  );
});

test("D-006 C1: independent D-006 analysis performs no network operation", async () => {
  const { handoff, identity } = buildArtifacts();
  const attempted: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: string | URL | Request): Promise<Response> => {
    attempted.push(String(input));
    throw new TypeError("network forbidden");
  };
  try {
    const result = await verifyD006PortableMissionEvidence(handoff.pebText, {
      expectedIdentity: identity,
      expectedTransferredContentDigest: handoff.transferredContentDigest,
    });
    assert.equal(result.verdict, "INDETERMINATE");
    assert.deepEqual(attempted, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

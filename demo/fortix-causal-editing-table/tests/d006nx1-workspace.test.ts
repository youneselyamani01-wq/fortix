import assert from "node:assert/strict";
import test from "node:test";

import { en } from "../../../site/src/i18n/locales/en.ts";
import { fr } from "../../../site/src/i18n/locales/fr.ts";
import { memoryBaseStore, performBaseCompareTransfer } from "../app/baseEvidence.ts";
import { MISSION_ID } from "../app/missionContinuity.ts";
import { projectMissionEvidence } from "../app/missionEvidence.ts";
import { derivePublicExperience, type PublicExperienceModel } from "../app/nx/adapter/publicExperienceAdapter.ts";
import type { EngineSnapshot } from "../app/nx/adapter/engineSnapshot.ts";
import { dossierLine, reconciliationLine, verifierLine } from "../app/nx/workspace/workspaceLines.ts";
import {
  PHYSICAL_SENTINEL_SOURCE,
  TARGET_ADAPTER_IDENTITY,
  appendNetworkTransition,
  createOfflineEvidenceSession,
  reconcileOfflineEvidence,
  sealFinalReceiptRuntimeEvidence,
  type OfflineEvidenceSession,
} from "../app/offlineEvidence.ts";
import { verifyD006PortableMissionEvidence } from "../app/offlineVerification.ts";
import { derivePassengerPresentation } from "../app/passengerPresentation.ts";
import { derivePhysicalState } from "../app/physicalState.ts";
import {
  buildMissionEvidenceClosure,
  buildPortableMissionEvidenceBundle,
  createHandoffArtifact,
  finalReceiptRuntimeEvidencePrefix,
  issueFinalMissionReceipt,
  routingProvenanceFromRuntimeRecords,
  type MissionEvidenceClosure,
} from "../app/portableMissionEvidence.ts";
import { laneForProducer, projectPortableProofLeaves } from "../app/proofProjection.ts";
import { projectReceiptBindings, receiptFamilyForProducer } from "../app/receiptProjection.ts";
import { CANONICAL_ROUTING_PROVENANCE, deriveRoutingState } from "../app/routingProvenance.ts";
import {
  EXPERIENCE_DURATION_MS,
  FINAL_RECEIPT_EMITTED_MS,
  HANDOFF_READY_MS,
  PEB_COMPLETE_MS,
  evidenceGatedStoryTime,
} from "../app/storyTimeline.ts";
import { PINNED_TRUST_ANCHORS } from "../app/trustAnchors.ts";
import { derivePresentationMotion } from "../app/vehiclePresentation.ts";
import { INDEPENDENT_VERIFICATION_PROFILE, canonicalString } from "../app/verification.ts";
import { VISUAL_EVENTS } from "../app/visualEvents.ts";

/**
 * D-006 NX1 — Checkpoint A R3 §16: the evidence workspace.
 *
 *   RECONCILIATION (top)   how locally held evidence reconciled
 *   VERIFIER (left)        what an independent verifier can establish
 *   DOSSIER (right)        what was constituted and what it contains
 *
 * Every value the panels show is derived here from real engine objects — a
 * real closure, a real Final Receipt, a real PEB, the real verifier's result
 * on the exact bytes handed over, real reconciliation outcomes — and the
 * derivation is compared with what the engine holds.
 */

const RUN_ID = "fortix.demo.d006nx1.run.workspace";

type Materialised = Readonly<{
  journal: OfflineEvidenceSession;
  closure: MissionEvidenceClosure;
  snapshot: EngineSnapshot;
}>;

/** The complete deterministic run, sealed, closed, receipted, bundled, ready to hand over. */
function materialise(): Materialised {
  let journal = projectMissionEvidence(createOfflineEvidenceSession(RUN_ID, null, MISSION_ID), FINAL_RECEIPT_EMITTED_MS);
  journal = sealFinalReceiptRuntimeEvidence(projectMissionEvidence(journal, FINAL_RECEIPT_EMITTED_MS), FINAL_RECEIPT_EMITTED_MS);
  const records = finalReceiptRuntimeEvidencePrefix(journal);
  const closure = buildMissionEvidenceClosure({ identity: { missionId: MISSION_ID, runId: RUN_ID }, runtimeRecords: records, asOfMasterTimeMs: FINAL_RECEIPT_EMITTED_MS });
  const finalReceipt = issueFinalMissionReceipt(closure, FINAL_RECEIPT_EMITTED_MS);
  const displayed = projectPortableProofLeaves(closure, PEB_COMPLETE_MS, finalReceipt).map((leaf) => leaf.evidenceId);
  const portablePeb = buildPortableMissionEvidenceBundle({ closure, finalReceipt, runtimeRecords: records, displayedEvidenceIds: displayed, masterTimeMs: PEB_COMPLETE_MS });
  const handoffArtifact = createHandoffArtifact(portablePeb, HANDOFF_READY_MS);
  const provenance = routingProvenanceFromRuntimeRecords(records);
  const admissible = provenance !== null;
  const at = EXPERIENCE_DURATION_MS;
  const effective = evidenceGatedStoryTime(at, admissible);
  const routing = deriveRoutingState(admissible ? at : 0, provenance ?? CANONICAL_ROUTING_PROVENANCE);
  const authorized = admissible && routing.vehicleMayExecute;
  const physical = derivePhysicalState(at, authorized);
  return {
    journal,
    closure,
    snapshot: {
      masterTimeMs: at,
      effectiveStoryTimeMs: effective,
      playing: false,
      session: journal,
      closure,
      closureReason: null,
      receiptBindings: projectReceiptBindings(closure, VISUAL_EVENTS),
      finalReceipt,
      humanDecision: "APPROVED",
      networkState: "UNKNOWN",
      linkObservationCurrent: false,
      linkPhase: "UNKNOWN",
      sentinelReachable: false,
      transitionFlash: null,
      unsequencedObservation: null,
      reconciliation: null,
      baseTransfer: null,
      syncPhase: "IDLE",
      portablePeb,
      handoffArtifact,
      transferStage: "SOURCE",
      analysisRequested: false,
      verification: null,
      handoffNetworkState: null,
      verdictNetworkState: null,
      physical,
      motion: derivePresentationMotion(at, authorized),
      passenger: derivePassengerPresentation(effective, physical.passengerState),
      routing,
    },
  };
}

const READY = materialise();
const withOverrides = (overrides: Partial<EngineSnapshot>): EngineSnapshot => ({ ...READY.snapshot, ...overrides });
const branchCount = (model: PublicExperienceModel) => Object.values(model.accumulatedEvidence.byBranch).reduce((sum, value) => sum + (value ?? 0), 0);

// ---------------------------------------------------------------------------
// §9 — FINAL RECEIPT ≠ NANO-RECEIPT
// ---------------------------------------------------------------------------

test("R3 §9: nano-receipts, the Final Receipt and the PEB are three distinct objects with distinct counts", () => {
  const model = derivePublicExperience(READY.snapshot);
  const presented = READY.closure.members.filter((member) => member.presentation === "PRESENTED");
  assert.equal(model.accumulatedEvidence.count, presented.length, "the nano-receipt count is the presented closure members");
  assert.equal(model.accumulatedEvidence.count, 58, "the checkpoint dataset: 58 nano-receipts");
  assert.ok(model.finalReceipt !== null, "one Final Receipt");
  assert.equal(model.finalReceipt.kind, "FINAL_RECEIPT");
  assert.equal(model.finalReceipt.receiptId, READY.snapshot.finalReceipt!.receiptId);
  assert.equal(model.accumulatedEvidence.items.some((entry) => entry.evidenceId === model.finalReceipt!.receiptId), false, "the Final Receipt is never a bead");
  assert.equal(model.accumulatedEvidence.items.some((entry) => entry.source === "D006_FINAL_RECEIPT"), false);
  assert.equal(branchCount(model), 58, "branch counts sum to the nano-receipts, not to 59");
  assert.equal(model.accumulatedEvidence.episodes.reduce((sum, group) => sum + group.items.length, 0), 58);
  assert.equal(model.finalReceipt.causalInputEvidenceIds.length, READY.snapshot.finalReceipt!.causalInputEvidenceIds.length);
  // The PEB carries both kinds and says so.
  assert.equal(model.portableEvidence.nanoReceiptCount, 58, "the PEB carries the 58 nano-receipts");
  assert.equal(model.portableEvidence.finalReceiptId, model.finalReceipt.receiptId, "and the one Final Receipt");
  assert.equal(model.portableEvidence.memberCount, READY.closure.members.length + 1, "every closure member plus the Final Receipt");
  assert.equal(model.portableEvidence.assuranceSupportCount, READY.closure.assuranceSupportEvidenceIds.length);
  assert.ok(model.portableEvidence.bundleId!.startsWith("fortix:peb:blake3:"));
  // The compact dossier line states exactly those three facts, in both languages.
  for (const dictionary of [en, fr]) {
    const copy = dictionary.nx.dossier;
    const line = dossierLine(model.accumulatedEvidence.count, model.finalReceipt, model.portableEvidence, copy);
    assert.ok(line.includes("58"), line);
    assert.ok(line.includes(`1 ${dictionary.nx.dossier.finalReceipt}`), line);
    assert.ok(line.endsWith(`${dictionary.nx.dossier.peb} · ${dictionary.nx.dossier.pebState.READY}`), line);
    assert.doesNotMatch(line, /59/, "never 59 nano-receipts");
    const before = dossierLine(12, null, { ...model.portableEvidence, bundleId: null }, copy);
    assert.ok(before.includes("12") && !before.includes(dictionary.nx.dossier.finalReceipt) && !before.includes(dictionary.nx.dossier.peb), before);
    assert.equal(dossierLine(0, null, { ...model.portableEvidence, bundleId: null }, copy), dictionary.nx.dossier.empty);
  }
});

test("R3 §9: before issuance there is no Final Receipt object and no PEB, and the beads are unchanged", () => {
  const journal = projectMissionEvidence(createOfflineEvidenceSession(RUN_ID, null, MISSION_ID), 60_000);
  const closure = buildMissionEvidenceClosure({ identity: { missionId: MISSION_ID, runId: RUN_ID }, runtimeRecords: journal.records, asOfMasterTimeMs: FINAL_RECEIPT_EMITTED_MS });
  const model = derivePublicExperience(withOverrides({ masterTimeMs: 60_000, effectiveStoryTimeMs: 60_000, session: journal, closure, finalReceipt: null, portablePeb: null, handoffArtifact: null, receiptBindings: projectReceiptBindings(closure, VISUAL_EVENTS) }));
  assert.equal(model.finalReceipt, null);
  assert.equal(model.portableEvidence.bundleId, null);
  assert.equal(model.portableEvidence.state, "NOT_READY");
  assert.equal(model.handoff.stage, "NOT_READY");
  assert.ok(model.accumulatedEvidence.count > 0 && model.accumulatedEvidence.count < 58);
});

// ---------------------------------------------------------------------------
// §10 — PAYMENT-AUTHORITY PROVENANCE
// ---------------------------------------------------------------------------

test("R3 §10: no producer is silently filed under mission; the payment-authority object sits in the authority lane by an explicit entry", () => {
  const model = derivePublicExperience(READY.snapshot);
  assert.deepEqual(model.accumulatedEvidence.unresolvedProvenance, [], "the checkpoint dataset has no unresolved provenance");
  const authority = model.accumulatedEvidence.items.find((entry) => entry.eventId === "d005m.master-payment-authority-active");
  assert.ok(authority !== undefined);
  assert.equal(authority.domain, "fortix.demo.manager-authority.d005m", "the producer is the signed issuer");
  assert.equal(authority.branch, "authority");
  assert.equal(authority.provenanceResolution, "LANE_TABLE");
  assert.equal(laneForProducer(authority.domain), "authority", "the engine's lane table names the issuer explicitly");
  assert.equal(receiptFamilyForProducer(authority.domain), "human", "consistent with the engine's receipt family for the same issuer");
  // Every other producer in the dataset also resolves through a table entry.
  for (const entry of model.accumulatedEvidence.items) {
    assert.notEqual(laneForProducer(entry.domain), null, `${entry.domain} has an explicit lane`);
    assert.equal(entry.branch, laneForProducer(entry.domain));
  }
  const compiled = model.accumulatedEvidence.items.find((entry) => entry.eventId === "d005m.receipt.master-return-to-base");
  assert.ok(compiled !== undefined);
  assert.equal(compiled.domain, "fortix.demo.causal-compiler.d005m");
  assert.equal(compiled.branch, "mission", "a compiled receipt is filed under its issuer, the compiler");
  // The engine's own portable projection agrees, so the two surfaces cannot disagree.
  const leaf = projectPortableProofLeaves(READY.closure, EXPERIENCE_DURATION_MS, READY.snapshot.finalReceipt).find((candidate) => candidate.evidenceId === authority.evidenceId);
  assert.equal(leaf?.branch, "authority");
});

test("R3 §10: a producer no table names is reported as UNRESOLVED, never defaulted", () => {
  const probeMember = { ...READY.closure.members.find((member) => member.presentation === "PRESENTED")!, evidenceId: "fortix:evidence:blake3:probe-unresolved", eventId: "probe.unresolved", producerDomain: "unknown.producer.example", timeMs: 5_000 };
  const closure = { ...READY.closure, members: [...READY.closure.members, probeMember] } as MissionEvidenceClosure;
  const model = derivePublicExperience(withOverrides({ closure }));
  const probe = model.accumulatedEvidence.items.find((entry) => entry.evidenceId === probeMember.evidenceId);
  assert.ok(probe !== undefined, "the object is still shown — evidence is never hidden");
  assert.equal(probe.branch, "unresolved");
  assert.equal(probe.provenanceResolution, "UNRESOLVED");
  assert.deepEqual(model.accumulatedEvidence.unresolvedProvenance, [probeMember.evidenceId]);
  assert.ok(model.accumulatedEvidence.branches.includes("unresolved"));
  assert.equal(model.accumulatedEvidence.branches.at(-1), "unresolved", "the unresolved lane comes last");
  assert.equal(laneForProducer("unknown.producer.example"), null);
  assert.equal(en.nx.provenance.unresolved.length > 0 && fr.nx.provenance.unresolved.length > 0, true);
  assert.notEqual(en.nx.provenance.unresolved, fr.nx.provenance.unresolved);
});

// ---------------------------------------------------------------------------
// §5 / §12 — INDEPENDENT VERIFIER
// ---------------------------------------------------------------------------

test("R3 §5: the verifier panel derives from the real verifier's result on the exact bytes handed over", async () => {
  const artifact = READY.snapshot.handoffArtifact!;
  const closureBefore = canonicalString(READY.closure);
  const pebBefore = canonicalString(READY.snapshot.portablePeb);
  const result = await verifyD006PortableMissionEvidence(artifact.pebText, {
    expectedIdentity: artifact.identity,
    expectedTransferredContentDigest: artifact.transferredContentDigest,
  });
  assert.equal(canonicalString(READY.closure), closureBefore, "the verifier does not mutate the closure");
  assert.equal(canonicalString(READY.snapshot.portablePeb), pebBefore, "the verifier does not mutate the PEB");
  const snapshot = withOverrides({ transferStage: "TRANSFERRED", analysisRequested: true, verification: result });
  const before = JSON.stringify(snapshot);
  const model = derivePublicExperience(snapshot);
  assert.equal(JSON.stringify(snapshot), before, "the adapter mutates nothing");
  assert.equal(model.verification.state, "VERDICT");
  assert.equal(model.verification.verdict, result.verdict, "the verdict is the verifier's, mirrored");
  assert.deepEqual(model.verification.reasonCodes, result.reasonCodes);
  assert.deepEqual(model.verification.completedChecks, result.completedChecks);
  assert.equal(model.verification.receiptId, result.receiptId);
  assert.equal(model.verification.bundleId, result.bundleId);
  assert.equal(model.verification.identity.profile, INDEPENDENT_VERIFICATION_PROFILE);
  assert.equal(model.verification.identity.pinnedKeyId, PINNED_TRUST_ANCHORS[0].keyId);
  assert.equal(model.verification.identity.trustAnchorId, PINNED_TRUST_ANCHORS[0].trustAnchorId);
  assert.equal(model.verification.identity.scopeRunId, RUN_ID);
  assert.equal(model.handoff.stage, "HANDED_OVER");
  assert.equal(model.handoff.transferredContentDigest, artifact.transferredContentDigest);
  // What the panel says is established is exactly what the verifier reported, by check id.
  const checks = new Set(result.completedChecks);
  assert.equal(model.verification.establishes!.transferredBytesExact, checks.has("d006_transferred_digest_exact"));
  assert.equal(model.verification.establishes!.trustAuthorization, checks.has("verification_key_authorized_by_pinned_anchor"));
  assert.equal(model.verification.establishes!.signatures, checks.has("canonical_signatures_verified"));
  assert.equal(model.verification.establishes!.causalClosure, checks.has("cycle_receipt_closure") && checks.has("d006_final_receipt_closure"));
  assert.ok(model.verification.factInspections !== null && model.verification.factInspections.length > 0, "facts are inspected against the transferred coverage");
  // The one-line state follows the verdict, in both languages, and is never a literal in the component.
  for (const dictionary of [en, fr]) {
    const copy = { ...dictionary.nx.verifier, verdicts: dictionary.d006c2.verifier.verdicts };
    assert.equal(verifierLine(model.handoff, model.verification, copy), dictionary.d006c2.verifier.verdicts[result.verdict].headline);
  }
});

test("R3 §5: the verdict is not hard-coded — every canonical verdict is mirrored and no verdict exists before the analysis", () => {
  const base = { reasonCodes: ["PROBE"], completedChecks: ["bundle_digest_recomputed"], receiptId: "probe", bundleId: null };
  for (const verdict of ["VALID", "INVALID", "INDETERMINATE", "REVOKED"] as const) {
    const model = derivePublicExperience(withOverrides({ transferStage: "TRANSFERRED", analysisRequested: true, verification: { verdict, ...base } }));
    assert.equal(model.verification.verdict, verdict);
    assert.deepEqual(model.verification.reasonCodes, ["PROBE"], "reason codes come from the result");
  }
  const notHandedOver = derivePublicExperience(READY.snapshot);
  assert.equal(notHandedOver.handoff.stage, "READY", "the artifact exists and waits for the handoff act");
  assert.equal(notHandedOver.verification.state, "NOT_APPLICABLE");
  assert.equal(notHandedOver.verification.verdict, null);
  const handedOver = derivePublicExperience(withOverrides({ transferStage: "TRANSFERRED" }));
  assert.equal(handedOver.handoff.stage, "HANDED_OVER");
  assert.equal(handedOver.verification.state, "AWAITING_HUMAN", "handoff and analysis are separate acts");
  const analyzing = derivePublicExperience(withOverrides({ transferStage: "TRANSFERRED", analysisRequested: true }));
  assert.equal(analyzing.verification.state, "ANALYZING");
  assert.equal(analyzing.verification.verdict, null);
  for (const dictionary of [en, fr]) {
    const copy = { ...dictionary.nx.verifier, verdicts: dictionary.d006c2.verifier.verdicts };
    assert.equal(verifierLine(notHandedOver.handoff, notHandedOver.verification, copy), dictionary.nx.verifier.awaiting);
    assert.equal(verifierLine(handedOver.handoff, handedOver.verification, copy), dictionary.nx.verifier.handedOver);
    assert.equal(verifierLine(analyzing.handoff, analyzing.verification, copy), dictionary.nx.verifier.analyzing);
  }
});

// ---------------------------------------------------------------------------
// §4 — RECONCILIATION BAND
// ---------------------------------------------------------------------------

function lostAndRestored(): OfflineEvidenceSession {
  const base = projectMissionEvidence(createOfflineEvidenceSession(RUN_ID, null, MISSION_ID), 40_000);
  const lost = appendNetworkTransition(base, {
    runId: RUN_ID,
    observationId: "nx1-r3-loss",
    adapterIdentity: TARGET_ADAPTER_IDENTITY,
    observationSource: PHYSICAL_SENTINEL_SOURCE,
    previousNetworkState: "CONNECTED",
    newNetworkState: "LOST",
    missionClockPosition: 40_000,
    observedMasterTimeMs: 40_000,
  }).session;
  return appendNetworkTransition(lost, {
    runId: RUN_ID,
    observationId: "nx1-r3-restore",
    adapterIdentity: TARGET_ADAPTER_IDENTITY,
    observationSource: PHYSICAL_SENTINEL_SOURCE,
    previousNetworkState: "LOST",
    newNetworkState: "CONNECTED",
    missionClockPosition: 40_500,
    observedMasterTimeMs: 40_500,
  }).session;
}

test("R3 §4: the reconciliation band follows the runtime's actual stage — quiet, active around the event, then complete", () => {
  const copies = [en.nx.reconciliation, fr.nx.reconciliation];
  // Checkpoint A at /nx: the network is unobserved, nothing reconciles.
  const quiet = derivePublicExperience(READY.snapshot);
  assert.equal(quiet.network.bandTone, "QUIET");
  assert.equal(quiet.network.reconciliationStage, "NONE");
  assert.equal(quiet.network.reconciliationReceiptId, null);
  // C-R2-F04: with nothing to reconcile the band is SILENT. It used to fill the
  // quiet with a sentence about the link and where evidence was kept; link
  // state is the signal glyph's now, and this band speaks only of evidence.
  for (const copy of copies) assert.equal(reconciliationLine(quiet.network, copy), null);
  // A real offline window, a real base compare, a real reconciliation.
  const journal = lostAndRestored();
  const journalOverrides = { masterTimeMs: 45_000, effectiveStoryTimeMs: 45_000, session: journal, closure: null, receiptBindings: [], finalReceipt: null, portablePeb: null, handoffArtifact: null } as const;
  const returned = derivePublicExperience(withOverrides({ ...journalOverrides, networkState: "CONNECTED" }));
  assert.equal(returned.network.reconciliationStage, "CONNECTION_RETURNED");
  assert.equal(returned.network.bandTone, "ACTIVE");
  for (const copy of copies) assert.equal(reconciliationLine(returned.network, copy), copy.returned);
  const performed = performBaseCompareTransfer(journal, memoryBaseStore(RUN_ID));
  assert.ok(performed !== null);
  const comparing = derivePublicExperience(withOverrides({ ...journalOverrides, networkState: "CONNECTED", baseTransfer: performed }));
  assert.equal(comparing.network.bandTone, "ACTIVE");
  for (const copy of copies) assert.equal(reconciliationLine(comparing.network, copy), copy.comparing);
  const result = reconcileOfflineEvidence({ session: journal, operation: performed.operation, capture: null, currentArtifacts: null, receiptMissionClockPosition: 45_000 });
  const done = derivePublicExperience(withOverrides({ ...journalOverrides, session: result.session, networkState: "CONNECTED", baseTransfer: performed, reconciliation: result }));
  if (result.status === "COMPLETE") {
    assert.equal(done.network.bandTone, "COMPLETE");
    assert.equal(done.network.reconciliationReceiptId, result.receipt!.receiptId);
    for (const copy of copies) assert.equal(reconciliationLine(done.network, copy), copy.reconciled.replace("{count}", String(result.receipt!.transferredObjectCount)));
  } else {
    assert.equal(done.network.bandTone, "FAILED");
    for (const copy of copies) assert.equal(reconciliationLine(done.network, copy), copy.failed);
  }
  // No result, no COMPLETE — the band cannot get ahead of the runtime.
  const noResult = derivePublicExperience(withOverrides({ ...journalOverrides, networkState: "CONNECTED", baseTransfer: performed, reconciliation: null }));
  assert.notEqual(noResult.network.bandTone, "COMPLETE");
  // A LOST link is local evidence, not an error: the band takes its calm LOST tone.
  const lost = derivePublicExperience(withOverrides({ networkState: "LOST" }));
  assert.equal(lost.network.bandTone, "LOST");
  for (const copy of copies) assert.equal(reconciliationLine(lost.network, copy), copy.local);
});

// ---------------------------------------------------------------------------
// Copy — native in both languages, distinct concepts
// ---------------------------------------------------------------------------

test("R3 §14: workspace copy is native, paired, and keeps the three concepts apart", () => {
  for (const [name, dictionary] of [["EN", en], ["FR", fr]] as const) {
    const nx = dictionary.nx;
    assert.notEqual(nx.reconciliation.title, nx.verifier.title, name);
    assert.notEqual(nx.verifier.title, nx.dossier.title, name);
    assert.doesNotMatch(nx.reconciliation.reconciled, /\{count\}|r[ée]concili/i, "the public upload sentence is human, not technical");
    assert.match(nx.dossier.nrMany, /\{count\}/);
    assert.doesNotMatch(JSON.stringify(nx), /quarantain|quarantin/i, `${name}: no quarantine wording anywhere`);
    for (const value of [nx.verifier.title, nx.dossier.title, nx.reconciliation.title, nx.verifier.handoff, nx.verifier.analyze]) {
      assert.ok(value.trim().length > 0 && value.length <= 32, `${name}: "${value}" is short public copy`);
    }
  }
  assert.equal(fr.nx.dossier.title, "Dossier de preuve");
  assert.equal(fr.nx.verifier.title, "Vérificateur indépendant");
  assert.equal(fr.nx.reconciliation.title, "Réseau", "the public band speaks of the network; reconciliation stays an engine term");
  assert.equal(fr.nx.reconciliation.local, "Preuves enregistrées localement");
  assert.equal(fr.nx.reconciliation.returned, "Retour du réseau");
  assert.equal(fr.nx.reconciliation.reconciled, "Preuves téléchargées");
  assert.equal(en.nx.reconciliation.local, "Evidence saved locally");
  assert.equal(en.nx.reconciliation.returned, "Network back");
  assert.equal(en.nx.reconciliation.reconciled, "Evidence uploaded");
  assert.equal(fr.nx.dossier.finalReceipt, "Reçu final");
  assert.equal(fr.nx.dossier.nanoReceipts, "Nano-reçus");
  assert.equal(fr.nx.verifier.result, "Résultat de la vérification");
  assert.equal(en.nx.dossier.title, "Evidence Dossier");
  assert.equal(en.nx.verifier.title, "Independent Verifier");
  assert.deepEqual(Object.keys(en.nx.verifier).sort(), Object.keys(fr.nx.verifier).sort());
  assert.deepEqual(Object.keys(en.nx.dossier).sort(), Object.keys(fr.nx.dossier).sort());
  assert.deepEqual(Object.keys(en.nx.reconciliation).sort(), Object.keys(fr.nx.reconciliation).sort());
});

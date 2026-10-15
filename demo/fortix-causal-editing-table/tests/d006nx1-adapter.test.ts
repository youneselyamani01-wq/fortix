import assert from "node:assert/strict";
import test from "node:test";

import { memoryBaseStore, performBaseCompareTransfer } from "../app/baseEvidence.ts";
import { MISSION_ID } from "../app/missionContinuity.ts";
import { projectMissionEvidence } from "../app/missionEvidence.ts";
import {
  EPISODE_ORDER,
  PROVENANCE_ORDER,
  derivePublicExperience,
  episodeOf,
  type PublicExperienceModel,
} from "../app/nx/adapter/publicExperienceAdapter.ts";
import type { EngineSnapshot } from "../app/nx/adapter/engineSnapshot.ts";
import {
  PHYSICAL_SENTINEL_SOURCE,
  TARGET_ADAPTER_IDENTITY,
  appendNetworkTransition,
  createOfflineEvidenceSession,
  reconcileOfflineEvidence,
  type OfflineEvidenceSession,
} from "../app/offlineEvidence.ts";
import { derivePassengerPresentation } from "../app/passengerPresentation.ts";
import { derivePhysicalState } from "../app/physicalState.ts";
import {
  PortableMissionEvidenceError,
  buildMissionEvidenceClosure,
  issueFinalMissionReceipt,
  routingProvenanceFromRuntimeRecords,
  type MissionEvidenceClosure,
} from "../app/portableMissionEvidence.ts";
import { projectPortableProofLeaves } from "../app/proofProjection.ts";
import { deriveMissionFacts } from "../app/publicFacts.ts";
import { projectReceiptBindings } from "../app/receiptProjection.ts";
import { HUMAN_AUTHORITY_GATE_MS } from "../app/reviewFlow.ts";
import { CANONICAL_ROUTING_PROVENANCE, deriveRoutingState } from "../app/routingProvenance.ts";
import {
  EXPERIENCE_DURATION_MS,
  FINAL_RECEIPT_EMITTED_MS,
  evidenceGatedStoryTime,
} from "../app/storyTimeline.ts";
import { derivePresentationMotion } from "../app/vehiclePresentation.ts";
import { VISUAL_EVENTS } from "../app/visualEvents.ts";

/**
 * D-006 NX1 §83 — the PUBLIC EXPERIENCE ADAPTER cannot invent, advance, grant
 * or verify anything. Every input below is produced by the engine; the adapter
 * is asked what the public may see, and its answer is compared with what the
 * engine actually holds.
 */

const RUN_ID = "fortix.demo.d006nx1.run.adapter";

function session(masterTimeMs: number, runId = RUN_ID): OfflineEvidenceSession {
  return projectMissionEvidence(createOfflineEvidenceSession(runId, null, MISSION_ID), masterTimeMs);
}

function snapshotFor(
  journal: OfflineEvidenceSession,
  masterTimeMs: number,
  overrides: Partial<EngineSnapshot> = {},
): EngineSnapshot {
  let closure: MissionEvidenceClosure | null = null;
  let closureReason: string | null = null;
  try {
    closure = buildMissionEvidenceClosure({
      identity: { missionId: journal.missionId, runId: journal.runId },
      runtimeRecords: journal.records,
      asOfMasterTimeMs: FINAL_RECEIPT_EMITTED_MS,
    });
  } catch (error) {
    closureReason = error instanceof PortableMissionEvidenceError ? error.reasonCode : String(error);
  }
  let provenance = null;
  try { provenance = routingProvenanceFromRuntimeRecords(journal.records); } catch { provenance = null; }
  const admissible = provenance !== null;
  const effective = evidenceGatedStoryTime(masterTimeMs, admissible);
  const routing = deriveRoutingState(admissible ? masterTimeMs : 0, provenance ?? CANONICAL_ROUTING_PROVENANCE);
  const authorized = admissible && routing.vehicleMayExecute;
  const physical = derivePhysicalState(masterTimeMs, authorized);
  let finalReceipt = null;
  if (closure !== null && masterTimeMs >= FINAL_RECEIPT_EMITTED_MS) {
    try { finalReceipt = issueFinalMissionReceipt(closure, FINAL_RECEIPT_EMITTED_MS); } catch { finalReceipt = null; }
  }
  return {
    masterTimeMs,
    effectiveStoryTimeMs: effective,
    playing: false,
    session: journal,
    closure,
    closureReason,
    receiptBindings: closure === null ? [] : projectReceiptBindings(closure, VISUAL_EVENTS),
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
    portablePeb: null,
    handoffArtifact: null,
    transferStage: "SOURCE",
    analysisRequested: false,
    verification: null,
    handoffNetworkState: null,
    verdictNetworkState: null,
    physical,
    motion: derivePresentationMotion(masterTimeMs, authorized),
    passenger: derivePassengerPresentation(effective, physical.passengerState),
    routing,
    ...overrides,
  };
}

const supportedIds = (model: PublicExperienceModel) => model.facts.filter((entry) => entry.status === "SUPPORTED").map((entry) => entry.factId);

function lostAndRestored(): OfflineEvidenceSession {
  const base = session(40_000);
  const lost = appendNetworkTransition(base, {
    runId: RUN_ID,
    observationId: "nx1-loss",
    adapterIdentity: TARGET_ADAPTER_IDENTITY,
    observationSource: PHYSICAL_SENTINEL_SOURCE,
    previousNetworkState: "CONNECTED",
    newNetworkState: "LOST",
    missionClockPosition: 40_000,
    observedMasterTimeMs: 40_000,
  }).session;
  return appendNetworkTransition(lost, {
    runId: RUN_ID,
    observationId: "nx1-restore",
    adapterIdentity: TARGET_ADAPTER_IDENTITY,
    observationSource: PHYSICAL_SENTINEL_SOURCE,
    previousNetworkState: "LOST",
    newNetworkState: "CONNECTED",
    missionClockPosition: 40_500,
    observedMasterTimeMs: 40_500,
  }).session;
}

// ---------------------------------------------------------------------------

test("NX1 adapter: it cannot invent public facts", () => {
  const journal = session(FINAL_RECEIPT_EMITTED_MS);
  const snapshot = snapshotFor(journal, 60_000);
  const model = derivePublicExperience(snapshot);
  const engine = deriveMissionFacts({
    effectiveStoryTimeMs: snapshot.effectiveStoryTimeMs,
    closure: snapshot.closure,
    receiptBindings: snapshot.receiptBindings,
    session: journal,
    finalReceipt: null,
    humanDecision: "APPROVED",
  }).filter((entry) => entry.status === "SUPPORTED").map((entry) => entry.factId);
  assert.deepEqual(supportedIds(model), engine, "the public record is exactly the engine's supported facts");
  assert.ok(model.currentFact !== null && engine.includes(model.currentFact.factId));
  assert.ok(model.currentFact.occurredAtMs <= snapshot.effectiveStoryTimeMs);
});

test("NX1 adapter: it cannot invent evidence", () => {
  const journal = session(FINAL_RECEIPT_EMITTED_MS);
  for (const at of [0, 12_500, 47_000, 90_000, FINAL_RECEIPT_EMITTED_MS + 1_500]) {
    const snapshot = snapshotFor(journal, at);
    const model = derivePublicExperience(snapshot);
    const known = new Set(snapshot.closure!.members.map((member) => member.evidenceId));
    if (snapshot.finalReceipt !== null) known.add(snapshot.finalReceipt.receiptId);
    for (const entry of model.accumulatedEvidence.items) {
      assert.ok(known.has(entry.evidenceId), `${entry.evidenceId} is not a closure member`);
      assert.ok(entry.timeMs <= at, "no evidence from the future");
    }
    if (model.latestEvidence !== null) assert.ok(known.has(model.latestEvidence.evidenceId));
  }
  const none = derivePublicExperience(snapshotFor(createOfflineEvidenceSession(RUN_ID, null, MISSION_ID), 60_000, { closure: null, closureReason: "PROBE", receiptBindings: [] }));
  assert.equal(none.latestEvidence, null);
  assert.equal(none.accumulatedEvidence.count, 0);
});

test("NX1 adapter: it cannot grant authority, and it mutates nothing", () => {
  const journal = session(HUMAN_AUTHORITY_GATE_MS);
  const snapshot = snapshotFor(journal, HUMAN_AUTHORITY_GATE_MS, { humanDecision: "PENDING" });
  const before = JSON.stringify(snapshot);
  const model = derivePublicExperience(snapshot);
  assert.equal(model.authorityRequest.required, true);
  assert.equal(model.authorityRequest.decision, "PENDING");
  assert.equal(model.authorityRequest.requestedEur, 1850);
  assert.equal(model.authorityRequest.autonomousLimitEur, 500);
  assert.equal(model.mission.phase, "HOLDING_FOR_AUTHORITY");
  assert.equal(model.facts.find((entry) => entry.factId === "fact.payment.humanApproved")?.status, "NOT_OCCURRED");
  assert.equal(JSON.stringify(snapshot), before, "the adapter never mutates its input");
  assert.ok(Object.isFrozen(model) && Object.isFrozen(model.authorityRequest) && Object.isFrozen(model.world.taxi));
  assert.equal(Object.values(model).some((value) => typeof value === "function"), false, "no setters leave the adapter");
  const approved = derivePublicExperience(snapshotFor(journal, HUMAN_AUTHORITY_GATE_MS, { humanDecision: "APPROVED" }));
  assert.equal(approved.authorityRequest.required, false);
});

test("NX1 adapter: it cannot mutate or infer network state", () => {
  const journal = lostAndRestored();
  for (const state of ["UNKNOWN", "CONNECTED", "LOST"] as const) {
    const model = derivePublicExperience(snapshotFor(journal, 45_000, { networkState: state }));
    assert.equal(model.network.state, state);
  }
  // A journal that holds a LOST record does not make the public state LOST:
  // only the physical machine's admitted state does.
  assert.equal(derivePublicExperience(snapshotFor(journal, 45_000, { networkState: "UNKNOWN" })).network.state, "UNKNOWN");
});

test("NX1 adapter: it cannot fabricate reconciliation", () => {
  const journal = lostAndRestored();
  const waiting = derivePublicExperience(snapshotFor(journal, 45_000, { networkState: "CONNECTED" }));
  assert.equal(waiting.network.offlineWindow, "AWAITING_RECONCILIATION");
  assert.equal(waiting.network.reconciliationStage, "CONNECTION_RETURNED");
  assert.equal(waiting.network.transferredCount, null);

  const performed = performBaseCompareTransfer(journal, memoryBaseStore(RUN_ID));
  assert.ok(performed !== null);
  const comparing = derivePublicExperience(snapshotFor(journal, 45_000, { networkState: "CONNECTED", baseTransfer: performed }));
  assert.equal(comparing.network.reconciliationStage, "COMPARING");

  const result = reconcileOfflineEvidence({
    session: journal,
    operation: performed.operation,
    capture: null,
    currentArtifacts: null,
    receiptMissionClockPosition: 45_000,
  });
  const done = derivePublicExperience(snapshotFor(result.session, 45_000, { networkState: "CONNECTED", baseTransfer: performed, reconciliation: result }));
  assert.equal(done.network.reconciliationStage, result.status === "COMPLETE" ? "RECONCILED" : "FAILED",
    "the public stage follows the performed operation's actual result");
  if (result.status === "COMPLETE") {
    assert.equal(done.network.transferredCount, result.receipt!.transferredObjectCount);
    assert.equal(done.facts.find((entry) => entry.factId === "fact.network.reconciled")?.status, "SUPPORTED");
  }
  const noResult = derivePublicExperience(snapshotFor(journal, 45_000, { networkState: "CONNECTED", baseTransfer: performed, reconciliation: null }));
  assert.notEqual(noResult.network.reconciliationStage, "RECONCILED", "no receipt, no RECONCILED");
});

test("NX1 adapter: it cannot produce a verdict", () => {
  const journal = session(FINAL_RECEIPT_EMITTED_MS);
  const idle = derivePublicExperience(snapshotFor(journal, EXPERIENCE_DURATION_MS, { transferStage: "TRANSFERRED", analysisRequested: true, verification: null }));
  assert.equal(idle.verification.state, "ANALYZING");
  assert.equal(idle.verification.verdict, null);
  for (const verdict of ["INDETERMINATE", "VALID", "INVALID", "REVOKED"] as const) {
    const verified = derivePublicExperience(snapshotFor(journal, EXPERIENCE_DURATION_MS, {
      transferStage: "TRANSFERRED",
      analysisRequested: true,
      verification: { verdict, reasonCodes: [], completedChecks: ["bundle_integrity"], receiptId: "probe", bundleId: null },
    }));
    assert.equal(verified.verification.state, "VERDICT");
    assert.equal(verified.verification.verdict, verdict, "the canonical verdict is mirrored, never promoted or demoted");
  }
  const notApplicable = derivePublicExperience(snapshotFor(journal, EXPERIENCE_DURATION_MS));
  assert.equal(notApplicable.verification.state, "NOT_APPLICABLE");
  assert.equal(notApplicable.verification.verdict, null);
});

test("NX1 adapter: an empty evidence journal yields no supported fact", () => {
  const empty = createOfflineEvidenceSession(RUN_ID, null, MISSION_ID);
  const model = derivePublicExperience(snapshotFor(empty, EXPERIENCE_DURATION_MS, { closure: null, closureReason: "PROBE", receiptBindings: [] }));
  assert.deepEqual(supportedIds(model), []);
  assert.equal(model.currentFact, null);
  assert.equal(model.accumulatedEvidence.count, 0);
  assert.equal(model.latestEvidence, null);
});

test("NX1 adapter: a playhead ahead of the evidence yields no premature public fact", () => {
  // The journal only reached 10 s; the playhead sits at 60 s.
  const behind = session(10_000);
  const model = derivePublicExperience(snapshotFor(behind, 60_000));
  for (const factId of ["fact.road.braked", "fact.road.stopped", "fact.route.congestion", "fact.route.rerouted"]) {
    assert.equal(model.facts.find((entry) => entry.factId === factId)?.status, "NOT_OCCURRED", factId);
  }
  assert.ok(model.currentFact === null || model.currentFact.occurredAtMs <= 10_000 || model.currentFact.evidenceIds.every((id) => id.startsWith("fortix:evidence:")));
  // A full journal but an early effective time supports only what had occurred.
  const early = derivePublicExperience(snapshotFor(session(FINAL_RECEIPT_EMITTED_MS), 5_000));
  assert.deepEqual(supportedIds(early), ["fact.mission.requested", "fact.mission.accepted"]);
});

test("NX1 adapter: rewinding removes future facts and evidence", () => {
  const journal = session(FINAL_RECEIPT_EMITTED_MS);
  const later = derivePublicExperience(snapshotFor(journal, 30_000));
  const earlier = derivePublicExperience(snapshotFor(journal, 12_000));
  assert.ok(supportedIds(later).includes("fact.passenger.boarded"));
  assert.equal(earlier.facts.find((entry) => entry.factId === "fact.passenger.boarded")?.status, "NOT_OCCURRED");
  assert.ok(earlier.accumulatedEvidence.count < later.accumulatedEvidence.count);
  // C-R1: at its own canonical instant the brake receipt has been ADMITTED —
  // the mission clock has reached it and the fact it supports is current — but
  // the receipt before it is still being read, so the presentation queue is
  // holding it back. It is counted as queued, never lost, and it is not drawn
  // half-arrived beside a receipt a viewer has not finished reading.
  assert.equal(earlier.presentation.queuedCount, 1, "the brake receipt is admitted and waiting its turn");
  assert.ok(
    !earlier.accumulatedEvidence.items.some((entry) => entry.evidenceId === "NR-ACTION:brake"),
    "and nothing half-arrived is drawn for it",
  );
  assert.equal(earlier.currentFact?.factId, "fact.road.braked");
  assert.equal(earlier.currentFact?.fresh, true);
  // A moment later it is the one receipt the viewer is being asked to read.
  const arrived = derivePublicExperience(snapshotFor(journal, 12_500));
  assert.equal(arrived.presentation.owning?.evidenceId, "NR-ACTION:brake");
  assert.equal(arrived.presentation.queuedCount, 1, "and the next one is already waiting behind it");
  // The queue only ever delays: the canonical instant it carries is untouched.
  assert.equal(arrived.presentation.owning?.timeMs, 12_000);
});

test("NX1 adapter: replay restores the exact causal order, and NR precedes attachment", () => {
  const journal = session(FINAL_RECEIPT_EMITTED_MS);
  const pass = () => {
    const trace: string[] = [];
    let previous: string[] = [];
    for (let at = 0; at <= EXPERIENCE_DURATION_MS; at += 1_000) {
      const model = derivePublicExperience(snapshotFor(journal, at));
      const supported = supportedIds(model);
      for (const id of previous) assert.ok(supported.includes(id), `${id} vanished at ${at} while playing forward`);
      previous = supported;
      trace.push(`${at}:${model.currentFact?.factId ?? "-"}:${model.latestEvidence?.evidenceId ?? "-"}:${model.accumulatedEvidence.count}`);
      let lastTime = -1;
      for (const entry of model.accumulatedEvidence.items) {
        assert.ok(entry.timeMs >= lastTime, "evidence is presented in mission order");
        lastTime = entry.timeMs;
        if (entry.attach > 0) assert.equal(entry.nrAppear, 1, "no attachment before the nano-receipt exists");
        if (entry.lock > 0) assert.equal(entry.attach, 1, "no lock before attachment");
      }
    }
    return trace;
  };
  assert.deepEqual(pass(), pass(), "two replays of the same journal produce the identical public trace");
});

test("NX1 adapter: the world follows canonical state — signal, perception, braking, passenger", () => {
  const journal = session(FINAL_RECEIPT_EMITTED_MS);
  const yellow = derivePublicExperience(snapshotFor(journal, 10_600));
  assert.equal(yellow.world.signal, "YELLOW");
  assert.equal(yellow.world.signalPerceived, false, "the taxi has not marked the yellow yet");
  const seen = derivePublicExperience(snapshotFor(journal, 11_000));
  assert.equal(seen.world.signalPerceived, true);
  const braking = derivePublicExperience(snapshotFor(journal, 12_100));
  assert.equal(braking.world.taxi.brakeLights, true);
  assert.equal(braking.world.taxi.motionPhase, "BRAKING_ON_OWN_DECISION");
  const aboard = derivePublicExperience(snapshotFor(journal, 20_000));
  assert.equal(aboard.world.taxi.cabinOccupied, true);
  assert.equal(aboard.world.passenger.visibleOutside, false);
  const off = derivePublicExperience(snapshotFor(journal, 0));
  assert.equal(off.world.signal, "OFF");
  assert.equal(off.mission.phase, "READY");
});

// ---------------------------------------------------------------------------
// R2 §15 — provenance beads: one branch per provenance, from canonical metadata
// ---------------------------------------------------------------------------

test("NX1 R2: every bead is a real admitted nano-receipt and every admitted nano-receipt is a bead", () => {
  const journal = session(FINAL_RECEIPT_EMITTED_MS);
  for (const at of [12_500, 30_000, 60_000, 90_000, EXPERIENCE_DURATION_MS]) {
    const snapshot = snapshotFor(journal, at);
    const model = derivePublicExperience(snapshot);
    const landedIds = model.accumulatedEvidence.items.map((entry) => entry.evidenceId);
    // R3: the Final Receipt is a distinct object, never a bead.
    const admitted = projectPortableProofLeaves(snapshot.closure!, at, snapshot.finalReceipt)
      .filter((leaf) => leaf.source !== "D006_FINAL_RECEIPT")
      .map((leaf) => leaf.evidenceId);
    // C-R1 — the two directions, which is what actually matters. A bead is
    // always a receipt the ENGINE has admitted (the queue can never invent
    // one), and every admitted receipt is either a bead or still in the queue
    // (the queue can never lose one). Landing is no longer a fixed offset from
    // the canonical instant: the queue decides it, in presentation time.
    for (const id of landedIds) assert.ok(admitted.includes(id), `at ${at}: ${id} is a real admitted nano-receipt`);
    assert.equal(
      landedIds.length + model.presentation.arrivingCount + model.presentation.queuedCount,
      admitted.length,
      `at ${at}: every admitted nano-receipt is landed, in flight or waiting — none is lost`,
    );
    // Once the run is over the queue has drained: the set is exactly the engine's.
    if (at === EXPERIENCE_DURATION_MS) {
      assert.equal(model.presentation.queuedCount, 0, "the queue drains by the end of the run");
      assert.deepEqual([...landedIds].sort(), [...admitted].sort(), "and then the beads are exactly the admitted nano-receipts");
    }
    assert.equal(new Set(landedIds).size, landedIds.length, "no duplicate bead");
    for (const entry of model.accumulatedEvidence.items) assert.equal(entry.kind, "NANO_RECEIPT");
    // Every bead reaches the disclosure surface: the episodes carry the same set.
    const disclosed = model.accumulatedEvidence.episodes.flatMap((group) => group.items.map((entry) => entry.evidenceId));
    assert.deepEqual([...disclosed].sort(), [...landedIds].sort(), "no receipt is lost to progressive disclosure");
  }
});

test("NX1 R2: provenance is deterministic and comes from the engine's lane tables", () => {
  const journal = session(FINAL_RECEIPT_EMITTED_MS);
  const snapshot = snapshotFor(journal, EXPERIENCE_DURATION_MS);
  const model = derivePublicExperience(snapshot);
  const leafBranch = new Map(projectPortableProofLeaves(snapshot.closure!, EXPERIENCE_DURATION_MS, snapshot.finalReceipt).map((leaf) => [leaf.evidenceId, leaf.branch]));
  const branchByDomain = new Map<string, string>();
  for (const entry of model.accumulatedEvidence.items) {
    assert.equal(entry.branch, leafBranch.get(entry.evidenceId), `${entry.evidenceId}: branch differs from the canonical lane`);
    assert.equal(entry.provenanceResolution, "LANE_TABLE", `${entry.evidenceId}: the lane comes from an explicit table entry`);
    const seen = branchByDomain.get(entry.domain);
    if (seen !== undefined) assert.equal(entry.branch, seen, `${entry.domain}: same provenance, same branch`);
    branchByDomain.set(entry.domain, entry.branch);
    assert.ok(PROVENANCE_ORDER.includes(entry.branch));
  }
  const again = derivePublicExperience(snapshotFor(journal, EXPERIENCE_DURATION_MS));
  assert.deepEqual(again.accumulatedEvidence.items.map((entry) => entry.branch), model.accumulatedEvidence.items.map((entry) => entry.branch), "deterministic");
  // Branch counts equal the underlying evidence counts, and branches are distinct.
  const total = Object.values(model.accumulatedEvidence.byBranch).reduce((sum, value) => sum + (value ?? 0), 0);
  assert.equal(total, model.accumulatedEvidence.count);
  assert.deepEqual(model.accumulatedEvidence.branches, PROVENANCE_ORDER.filter((branch) => (model.accumulatedEvidence.byBranch[branch] ?? 0) > 0));
  assert.ok(model.accumulatedEvidence.branches.length >= 6, `checkpoint dataset feeds several provenances: ${model.accumulatedEvidence.branches.join(",")}`);
  assert.ok(model.accumulatedEvidence.branches.includes("city") && model.accumulatedEvidence.branches.includes("vehicle"));
  // A branch never exists before evidence fed it.
  const early = derivePublicExperience(snapshotFor(journal, 3_000));
  assert.deepEqual(early.accumulatedEvidence.branches, ["mission"]);
});

test("NX1 R2: every presented object of the run belongs to a named episode", () => {
  const journal = session(FINAL_RECEIPT_EMITTED_MS);
  const model = derivePublicExperience(snapshotFor(journal, EXPERIENCE_DURATION_MS));
  for (const entry of model.accumulatedEvidence.items) {
    assert.notEqual(entry.episode, "other", `${entry.eventId} has no episode`);
    assert.ok(EPISODE_ORDER.includes(entry.episode));
  }
  const grouped = model.accumulatedEvidence.episodes.reduce((sum, group) => sum + group.items.length, 0);
  assert.equal(grouped, model.accumulatedEvidence.count);
  assert.deepEqual(model.accumulatedEvidence.episodes.map((group) => group.episode), EPISODE_ORDER.filter((episode) => model.accumulatedEvidence.episodes.some((group) => group.episode === episode)));
  const stop = model.accumulatedEvidence.episodes.find((group) => group.episode === "signalStop");
  assert.ok(stop !== undefined);
  for (const id of ["NR-PERCEPTION:yellow", "NR-DECISION:stop", "NR-ACTION:brake", "NR-RESULT:at-rest"]) {
    assert.ok(stop.items.some((entry) => entry.evidenceId === id), `${id} belongs to the stop at the light`);
  }
  assert.equal(episodeOf("d006d.network-link-lost:abc", "NETWORK_LINK_LOST"), "network");
  assert.equal(episodeOf("unknown.event", "SOMETHING"), "other");
});

test("NX1 R2: beads never invert causal order and connectors point at landed parents only", () => {
  const journal = session(FINAL_RECEIPT_EMITTED_MS);
  for (let at = 0; at <= EXPERIENCE_DURATION_MS; at += 2_000) {
    const model = derivePublicExperience(snapshotFor(journal, at));
    const rank = new Map(model.accumulatedEvidence.items.map((entry, index) => [entry.evidenceId, index]));
    for (const entry of model.accumulatedEvidence.items) {
      for (const parent of [...entry.causalParents, ...entry.observedInputs]) {
        const parentRank = rank.get(parent);
        if (parentRank === undefined) continue; // not landed (or outside the presented set): no connector
        assert.ok(parentRank < rank.get(entry.evidenceId)!, `${parent} must sit above ${entry.evidenceId}`);
      }
    }
  }
});

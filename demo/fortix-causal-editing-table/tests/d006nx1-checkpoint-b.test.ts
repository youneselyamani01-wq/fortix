import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { en } from "../../../site/src/i18n/locales/en.ts";
import { fr } from "../../../site/src/i18n/locales/fr.ts";
import { memoryBaseStore } from "../app/baseEvidence.ts";
import { SENTINEL_UNREACHABLE, buildReport, type AdapterRecord, type LinkSentinelReport } from "../app/ethernetLink.ts";
import { MISSION_ID } from "../app/missionContinuity.ts";
import { projectMissionEvidence } from "../app/missionEvidence.ts";
import { PhysicalNetworkTransitionMachine } from "../app/networkTransitions.ts";
import { derivePublicExperience } from "../app/nx/adapter/publicExperienceAdapter.ts";
import type { EngineSnapshot } from "../app/nx/adapter/engineSnapshot.ts";
import { journalAt } from "../app/nx/adapter/useMissionEngine.ts";
import { dossierLine, linkLine, networkReceiptLine, reconciliationLine } from "../app/nx/workspace/workspaceLines.ts";
import {
  PHYSICAL_SENTINEL_SOURCE,
  appendNetworkTransition,
  createOfflineEvidenceSession,
  isInMissionReconciliationReceipt,
  journalNetworkState,
  offlineWindowStatus,
  type OfflineEvidenceSession,
} from "../app/offlineEvidence.ts";
import { analyzeInsertedD006Peb, insertD006PebForAnalysis, verifyD006PortableMissionEvidence } from "../app/offlineVerification.ts";
import { derivePassengerPresentation } from "../app/passengerPresentation.ts";
import {
  admitPhysicalObservation,
  artifactStateFor,
  awaitingReconciliationWindowKey,
  capturePreRestorationIfPossible,
  performReconciliation,
  readLinkSentinel,
} from "../app/physicalLinkRuntime.ts";
import { derivePhysicalState } from "../app/physicalState.ts";
import {
  buildMissionEvidenceClosure,
  buildPortableMissionEvidenceBundle,
  createHandoffArtifact,
  finalReceiptRuntimeEvidencePrefix,
  issueFinalMissionReceipt,
  routingProvenanceFromRuntimeRecords,
  type HandoffArtifact,
  type MissionEvidenceClosure,
} from "../app/portableMissionEvidence.ts";
import { projectPortableProofLeaves } from "../app/proofProjection.ts";
import { projectReceiptBindings } from "../app/receiptProjection.ts";
import { nextTransferStage } from "../app/reviewFlow.ts";
import { CANONICAL_ROUTING_PROVENANCE, deriveRoutingState } from "../app/routingProvenance.ts";
import {
  EXPERIENCE_DURATION_MS,
  FINAL_RECEIPT_EMITTED_MS,
  HANDOFF_READY_MS,
  PEB_COMPLETE_MS,
  evidenceGatedStoryTime,
} from "../app/storyTimeline.ts";
import { derivePresentationMotion } from "../app/vehiclePresentation.ts";
import { canonicalString } from "../app/verification.ts";
import { VISUAL_EVENTS } from "../app/visualEvents.ts";

/**
 * D-006 NX1 — Checkpoint B §19–§22: offline evidence continuity, the
 * portable PEB handoff, offline verification, reconciliation.
 *
 * Every transition below is produced by the engine through the shared
 * physical-link runtime from synthetic SENTINEL REPORTS (the same fixtures
 * the D-006D suites use). No test calls a UI control; the UI has none that
 * could mint a transition. The measured facts these tests assert are the
 * facts the Checkpoint B report states.
 */

const RUN_ID = "fortix.demo.d006nx1.run.checkpoint-b";
const I226: AdapterRecord = Object.freeze({
  name: "Ethernet",
  description: "Intel(R) Ethernet Controller I226-LM",
  status: "Up",
  mediaConnectionState: "Connected",
  mediaType: "802.3",
  physicalMediaType: "802.3",
  virtual: false,
  ifIndex: 26,
});
const T0 = Date.UTC(2026, 8, 6, 9, 0, 0);
const at = (second: number) => new Date(T0 + second * 1_000).toISOString();

function report(link: "CONNECTED" | "LOST", second: number): LinkSentinelReport {
  return buildReport([{
    ...I226,
    status: link === "CONNECTED" ? "Up" : "Disconnected",
    mediaConnectionState: link === "CONNECTED" ? "Connected" : "Disconnected",
  }], at(second));
}

type Runtime = { session: OfflineEvidenceSession; machine: PhysicalNetworkTransitionMachine };

/** One sentinel sample through the shared runtime, exactly as the hook applies it. */
function observe(runtime: Runtime, link: "CONNECTED" | "LOST", second: number, masterTimeMs: number) {
  const outcome = admitPhysicalObservation({
    session: journalAt(runtime.session, masterTimeMs),
    machine: runtime.machine,
    report: report(link, second),
    nowEpochMs: T0 + second * 1_000 + 100,
    masterTimeMs,
  });
  runtime.machine = outcome.machine;
  if (outcome.kind === "TRANSITION") runtime.session = outcome.session;
  else runtime.session = journalAt(runtime.session, masterTimeMs);
  return outcome;
}

function freshRuntime(masterTimeMs = 0): Runtime {
  const session = journalAt(createOfflineEvidenceSession(RUN_ID, null, MISSION_ID), masterTimeMs);
  return { session, machine: new PhysicalNetworkTransitionMachine({ runId: RUN_ID, initialState: session.networkState }) };
}

type Artifacts = Readonly<{ closure: MissionEvidenceClosure; handoff: HandoffArtifact }>;

/** The engine's closure, Final Receipt, PEB and handoff artifact for a sealed journal. */
function artifactsOf(session: OfflineEvidenceSession): Artifacts {
  const records = finalReceiptRuntimeEvidencePrefix(session);
  const closure = buildMissionEvidenceClosure({ identity: { missionId: MISSION_ID, runId: session.runId }, runtimeRecords: records, asOfMasterTimeMs: FINAL_RECEIPT_EMITTED_MS });
  const finalReceipt = issueFinalMissionReceipt(closure, FINAL_RECEIPT_EMITTED_MS);
  const displayed = projectPortableProofLeaves(closure, PEB_COMPLETE_MS, finalReceipt).map((leaf) => leaf.evidenceId);
  const peb = buildPortableMissionEvidenceBundle({ closure, finalReceipt, runtimeRecords: records, displayedEvidenceIds: displayed, masterTimeMs: PEB_COMPLETE_MS });
  return { closure, handoff: createHandoffArtifact(peb, HANDOFF_READY_MS) };
}

function snapshotOf(session: OfflineEvidenceSession, masterTimeMs: number, overrides: Partial<EngineSnapshot> = {}): EngineSnapshot {
  let closure: MissionEvidenceClosure | null = null;
  let finalReceipt = null;
  let portablePeb = null;
  let handoffArtifact = null;
  try {
    const records = session.finalReceiptRuntimeSeal === null ? session.records : finalReceiptRuntimeEvidencePrefix(session);
    closure = buildMissionEvidenceClosure({ identity: { missionId: MISSION_ID, runId: session.runId }, runtimeRecords: records, asOfMasterTimeMs: FINAL_RECEIPT_EMITTED_MS });
    if (masterTimeMs >= FINAL_RECEIPT_EMITTED_MS && session.finalReceiptRuntimeSeal !== null) {
      const artifacts = artifactsOf(session);
      finalReceipt = artifacts.handoff.finalReceipt;
      portablePeb = masterTimeMs >= PEB_COMPLETE_MS ? artifacts.handoff.peb : null;
      handoffArtifact = masterTimeMs >= HANDOFF_READY_MS ? artifacts.handoff : null;
    }
  } catch { closure = null; }
  const provenance = (() => { try { return routingProvenanceFromRuntimeRecords(session.records); } catch { return null; } })();
  const admissible = provenance !== null;
  const effective = evidenceGatedStoryTime(masterTimeMs, admissible);
  const routing = deriveRoutingState(admissible ? masterTimeMs : 0, provenance ?? CANONICAL_ROUTING_PROVENANCE);
  const authorized = admissible && routing.vehicleMayExecute;
  const physical = derivePhysicalState(masterTimeMs, authorized);
  return {
    masterTimeMs,
    effectiveStoryTimeMs: effective,
    playing: false,
    session,
    closure,
    closureReason: null,
    receiptBindings: closure === null ? [] : projectReceiptBindings(closure, VISUAL_EVENTS),
    finalReceipt,
    humanDecision: "APPROVED",
    networkState: session.networkState,
    linkObservationCurrent: true,
    linkPhase: session.networkState,
    sentinelReachable: true,
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
    motion: derivePresentationMotion(masterTimeMs, authorized),
    passenger: derivePassengerPresentation(effective, physical.passengerState),
    routing,
    ...overrides,
  };
}

const NX_ROOT = new URL("../app/nx/", import.meta.url);
const source = (relative: string) => readFileSync(new URL(relative, NX_ROOT), "utf8");
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

// ---------------------------------------------------------------------------
// §19 — NETWORK
// ---------------------------------------------------------------------------

test("B §19: the journal starts CONNECTED, one loss authors exactly one NR-NET-LOST, repeats author nothing, restoration settles to CONNECTED", () => {
  const runtime = freshRuntime(40_000);
  assert.equal(runtime.session.networkState, "CONNECTED", "the journal's persistent baseline");
  assert.equal(runtime.machine.state, "CONNECTED", "the machine shares the journal baseline (D-006 C1)");
  const before = runtime.session.records.length;

  // Stable CONNECTED samples: no record, the observation becomes current.
  for (const second of [0, 1, 2]) {
    const outcome = observe(runtime, "CONNECTED", second, 40_000);
    assert.equal(outcome.kind, "STABLE", `sample ${second}`);
    assert.equal(outcome.networkState, "CONNECTED");
  }
  assert.equal(runtime.session.records.length, before, "stable polls append nothing");

  // The cable is pulled: the first LOST sample debounces, the second is the transition.
  const debouncing = observe(runtime, "LOST", 3, 41_000);
  assert.equal(debouncing.kind, "STABLE");
  assert.equal(debouncing.linkObservationCurrent, false, "a candidate is not yet a physical claim");
  assert.equal(runtime.session.records.some((record) => record.eventType === "NETWORK_LINK_LOST"), false, "no LOST until debounced");
  const lost = observe(runtime, "LOST", 4, 41_500);
  assert.equal(lost.kind, "TRANSITION");
  if (lost.kind !== "TRANSITION") return;
  assert.equal(lost.transition, "LOST");
  assert.equal(lost.nanoReceipt.nanoReceiptType, "NR-NET-LOST");
  assert.equal(lost.nanoReceipt.previousNetworkState, "CONNECTED");
  assert.equal(lost.nanoReceipt.newNetworkState, "LOST");
  assert.equal(lost.nanoReceipt.observationSource, PHYSICAL_SENTINEL_SOURCE);
  assert.equal(lost.nanoReceipt.evidenceLocality, "LOCAL");
  assert.equal(runtime.session.networkState, "LOST");
  assert.equal(journalNetworkState(runtime.session), "LOST", "the journal itself derives LOST");
  assert.equal(offlineWindowStatus(runtime.session), "OPEN");
  const lostCount = () => runtime.session.records.filter((record) => record.eventType === "NETWORK_LINK_LOST").length;
  assert.equal(lostCount(), 1);

  // The cable stays out: many more LOST samples, still exactly one receipt.
  for (let second = 5; second < 25; second += 1) {
    const outcome = observe(runtime, "LOST", second, 41_500 + second * 100);
    assert.notEqual(outcome.kind, "TRANSITION", `sample ${second}`);
    assert.equal(outcome.networkState, "LOST");
  }
  assert.equal(lostCount(), 1, "no repeated LOST receipt while the state remains LOST");

  // The cable comes back: debounce, then the restoration event; the state is CONNECTED, never RESTORED.
  assert.equal(observe(runtime, "CONNECTED", 25, 60_000).kind, "STABLE");
  const restored = observe(runtime, "CONNECTED", 26, 60_500);
  assert.equal(restored.kind, "TRANSITION");
  if (restored.kind !== "TRANSITION") return;
  assert.equal(restored.transition, "RESTORED");
  assert.equal(restored.nanoReceipt.nanoReceiptType, "NR-NET-RESTORED");
  assert.equal(restored.networkState, "CONNECTED", "RESTORED is an event, not a persistent state");
  assert.equal(runtime.machine.state, "CONNECTED");
  assert.equal(runtime.session.networkState, "CONNECTED");
  assert.equal(offlineWindowStatus(runtime.session), "AWAITING_RECONCILIATION", "the evidence window is a journal fact, not a cable fact");
  assert.equal(runtime.session.records.filter((record) => record.eventType === "NETWORK_LINK_RESTORED").length, 1);
  assert.notEqual(awaitingReconciliationWindowKey(runtime.session), null);
  // The persistent vocabulary has two values only.
  for (const record of runtime.session.records) {
    const payload = record.payload as Record<string, unknown>;
    for (const key of ["previous_network_state", "new_network_state"]) {
      if (key in payload) assert.ok(payload[key] === "CONNECTED" || payload[key] === "LOST", `${key} is two-valued`);
    }
  }
});

test("B §19: the shared runtime authors byte-identical records to the engine's machine and append, and refuses what the engine refuses", () => {
  // The same samples through the engine directly, exactly as the legacy poll does.
  const reference = freshRuntime(40_000);
  const runtime = freshRuntime(40_000);
  const samples: [("CONNECTED" | "LOST"), number, number][] = [["CONNECTED", 0, 40_000], ["CONNECTED", 1, 40_000], ["LOST", 2, 41_000], ["LOST", 3, 41_500], ["LOST", 4, 42_000], ["CONNECTED", 5, 60_000], ["CONNECTED", 6, 60_500]];
  for (const [link, second, masterTimeMs] of samples) {
    observe(runtime, link, second, masterTimeMs);
    const session = journalAt(reference.session, masterTimeMs);
    const lastClock = session.records.at(-1)?.missionClockPosition;
    const result = reference.machine.observe(report(link, second), {
      evidenceClockMs: lastClock === undefined ? masterTimeMs : lastClock + 1,
      causalPredecessors: session.records.at(-1)?.receiptId === undefined ? [] : [session.records.at(-1)!.receiptId],
    });
    reference.session = result.event === null ? session : appendNetworkTransition(session, {
      runId: result.event.runId,
      observationId: result.event.eventId,
      eventId: result.event.eventId,
      receiptId: result.event.receiptId,
      adapterIdentity: result.event.adapterIdentity.description,
      observationSource: PHYSICAL_SENTINEL_SOURCE,
      previousNetworkState: result.event.previousNetworkState,
      newNetworkState: result.event.newNetworkState,
      missionClockPosition: result.event.missionClockPosition.milliseconds,
      observedMasterTimeMs: masterTimeMs,
    }).session;
  }
  assert.deepEqual(runtime.session.records.map((record) => record.canonicalDigest), reference.session.records.map((record) => record.canonicalDigest), "identical journals, digest for digest");
  assert.equal(runtime.session.networkState, reference.session.networkState);

  // What the engine refuses, the runtime refuses: an unreachable sentinel, a stale sample, a duplicate sample.
  const idle = freshRuntime(40_000);
  const unreachable = admitPhysicalObservation({ session: idle.session, machine: idle.machine, report: SENTINEL_UNREACHABLE, nowEpochMs: T0, masterTimeMs: 40_000 });
  assert.equal(unreachable.kind, "NOT_FRESH", "an unreachable sentinel is not a physical observation");
  const stale = admitPhysicalObservation({ session: idle.session, machine: idle.machine, report: report("LOST", 0), nowEpochMs: T0 + 3_600_000, masterTimeMs: 40_000 });
  assert.equal(stale.kind, "NOT_FRESH", "an old cached sample is not a physical observation");
  observe(idle, "CONNECTED", 10, 40_000);
  const duplicate = admitPhysicalObservation({ session: idle.session, machine: idle.machine, report: report("CONNECTED", 10), nowEpochMs: T0 + 10_100, masterTimeMs: 40_000 });
  assert.equal(duplicate.kind, "STABLE");
  assert.equal(duplicate.linkObservationCurrent, null, "a duplicate keeps the caller's current value");
  assert.equal(idle.session.records.filter((record) => record.eventType.startsWith("NETWORK_")).length, 0);
});

test("B §19: scrub and replay never duplicate a transition; the journal is the same object when nothing is new", () => {
  const runtime = freshRuntime(40_000);
  observe(runtime, "CONNECTED", 0, 40_000);
  observe(runtime, "CONNECTED", 1, 40_000);
  observe(runtime, "LOST", 2, 41_000);
  observe(runtime, "LOST", 3, 41_500);
  const lostRecords = () => runtime.session.records.filter((record) => record.eventType === "NETWORK_LINK_LOST");
  const digestBefore = lostRecords()[0]!.canonicalDigest;
  for (const time of [10_000, 41_500, 90_000, 20_000, EXPERIENCE_DURATION_MS, 0, 41_500]) {
    runtime.session = journalAt(runtime.session, time);
    assert.equal(lostRecords().length, 1, `scrub to ${time}`);
    assert.equal(lostRecords()[0]!.canonicalDigest, digestBefore, "the record is not rewritten by a scrub");
  }
  const same = journalAt(runtime.session, EXPERIENCE_DURATION_MS);
  assert.equal(journalAt(same, EXPERIENCE_DURATION_MS), same, "idempotent: the same object when nothing is new");
  assert.equal(projectMissionEvidence(same, 5_000), same);
});

test("B §19: no UI control mints network evidence — the NX components never touch the engine's transition constructors", () => {
  for (const relative of ["experience/NxExperience.tsx", "workspace/ReconciliationBand.tsx", "verifier/VerifierSurface.tsx", "verifier/InspectPanel.tsx", "verifier/choreography.ts", "workspace/EvidenceDossier.tsx", "evidence/ProvenanceProof.tsx", "adapter/publicExperienceAdapter.ts"]) {
    const text = code(source(relative));
    assert.doesNotMatch(text, /appendNetworkTransition|PhysicalNetworkTransitionMachine|admitPhysicalObservation|reconcileOfflineEvidence|performReconciliation|navigator\.onLine|setNetworkState/, relative);
  }
  const runtime = code(source("adapter/useMissionEngine.ts"));
  assert.doesNotMatch(runtime, /networkState: "(LOST|CONNECTED)"/, "the snapshot's network state is never a literal");
  const band = code(source("workspace/ReconciliationBand.tsx"));
  assert.match(band, /data-network=\{network\.state\}/);
  assert.match(band, /data-link=\{network\.linkPhase\}/);
  assert.match(band, /data-evidence-locality=\{network\.evidenceLocality\}/, "evidence location is its own dimension");
  const root = code(source("experience/NxExperience.tsx"));
  // C-R2-F04: the chip is a signal glyph with no words. It still shows exactly
  // what the sentinel observed — and `data-link` still carries it — but the
  // observed state is drawn rather than written.
  assert.match(root, /className="nx-link-chip"[\s\S]{0,80}?data-link=\{model\.network\.linkPhase\}/, "the physical link is shown as observed");
  assert.match(root, /<i aria-hidden="true"><b \/><b \/><b \/><b \/><\/i>/, "as four signal bars");
  assert.doesNotMatch(root, /linkLine\(model\.network, nx\.link\)\}<\/span>/, "and never as a written status line");
  assert.match(root, /data-nx-checkpoint="B(-R\d+)?"/);
});

// ---------------------------------------------------------------------------
// §19 — OFFLINE CONTINUITY
// ---------------------------------------------------------------------------

test("B §19: during LOST the same mission continues — identity, clock, nano-receipts, branches, closure, Final Receipt and PEB", () => {
  const runtime = freshRuntime(40_000);
  observe(runtime, "CONNECTED", 0, 40_000);
  observe(runtime, "CONNECTED", 1, 40_000);
  const beforeLoss = runtime.session;
  observe(runtime, "LOST", 2, 41_000);
  observe(runtime, "LOST", 3, 41_500);
  assert.equal(runtime.session.networkState, "LOST");
  const atLoss = runtime.session;
  const countAtLoss = atLoss.records.length;

  // The clock keeps going with the cable out; every step is the engine's projection.
  let clock = -1;
  for (let time = 42_000; time <= EXPERIENCE_DURATION_MS; time += 2_000) {
    observe(runtime, "LOST", 4 + time / 1000, time);
    assert.equal(runtime.session.missionId, beforeLoss.missionId, "Mission ID unchanged");
    assert.equal(runtime.session.runId, beforeLoss.runId, "run unchanged");
    assert.equal(runtime.session.networkState, "LOST");
    for (const record of runtime.session.records) {
      assert.ok(record.missionClockPosition > clock, "clock monotonic");
      clock = record.missionClockPosition;
    }
    clock = -1;
  }
  const atEnd = runtime.session;
  // The journal holds the runtime records (the signed canonical objects join through the closure).
  assert.ok(atEnd.records.length > countAtLoss, `runtime records continue offline: ${countAtLoss} → ${atEnd.records.length}`);
  assert.deepEqual(atEnd.records.slice(0, countAtLoss).map((record) => record.canonicalDigest), atLoss.records.map((record) => record.canonicalDigest), "pre-loss evidence is unchanged");
  const beadsAtLoss = derivePublicExperience(snapshotOf(atLoss, 41_500)).accumulatedEvidence.count;
  const beadsAtEnd = derivePublicExperience(snapshotOf(atEnd, EXPERIENCE_DURATION_MS)).accumulatedEvidence.count;
  assert.ok(beadsAtEnd > beadsAtLoss + 20, `nano-receipts continue offline: ${beadsAtLoss} → ${beadsAtEnd}`);
  assert.ok(atEnd.finalReceiptRuntimeSeal !== null, "the Final Receipt boundary was sealed while LOST");
  assert.equal(atEnd.records.filter((record) => record.eventType === "NETWORK_LINK_LOST").length, 1);

  // The engine builds the closure, the Final Receipt and the PEB from the sealed offline journal.
  const artifacts = artifactsOf(atEnd);
  const presented = artifacts.closure.members.filter((member) => member.presentation === "PRESENTED");
  assert.equal(presented.length, 59, "58 deterministic nano-receipts + the physical NR-NET-LOST");
  assert.ok(presented.some((member) => member.eventId.startsWith("d006d.network-link-lost") || member.eventId.includes("NETWORK_LINK_LOST")), "the loss is a sealed nano-receipt");
  assert.equal(artifacts.handoff.identity.missionId, MISSION_ID);
  assert.equal(artifacts.handoff.identity.runId, RUN_ID);
  assert.match(artifacts.handoff.peb.bundleId, /^fortix:peb:blake3:[0-9a-f]{64}$/);

  // The public adapter shows the same grammar: the network lane fed, the proof still growing.
  const model = derivePublicExperience(snapshotOf(atEnd, EXPERIENCE_DURATION_MS));
  assert.equal(model.accumulatedEvidence.count, 59);
  assert.equal(model.accumulatedEvidence.sealedCount, 59);
  assert.equal(model.accumulatedEvidence.journalCount, 0, "nothing after the seal yet");
  assert.ok(model.accumulatedEvidence.branches.includes("network"), "the physical loss has its own provenance branch");
  assert.equal(model.accumulatedEvidence.byBranch.network, 1);
  const lostBead = model.accumulatedEvidence.items.find((entry) => entry.eventType === "NETWORK_LINK_LOST");
  assert.ok(lostBead !== undefined);
  assert.equal(lostBead.kind, "NANO_RECEIPT");
  assert.equal(lostBead.standing, "CLOSURE");
  assert.equal(lostBead.episode, "network");
  assert.equal(lostBead.evidenceLocality, "LOCAL");
  assert.equal(lostBead.provenanceResolution, "LANE_TABLE");
  assert.ok(model.finalReceipt !== null);
  assert.equal(model.portableEvidence.nanoReceiptCount, 59);
  assert.equal(model.network.state, "LOST");
  assert.equal(model.network.evidenceLocality, "LOCAL");
  assert.equal(model.network.bandTone, "LOST");
  assert.equal(model.network.lostCount, 1);
  for (const dictionary of [en, fr]) {
    assert.equal(reconciliationLine(model.network, dictionary.nx.reconciliation), dictionary.nx.reconciliation.local);
    assert.equal(linkLine(model.network, dictionary.nx.link), `${dictionary.nx.link.title} · ${dictionary.nx.link.lost}`);
  }
  // The world, the fact and the proof keep their grammar: identical public model shape connected or not.
  const connected = derivePublicExperience(snapshotOf(journalAt(beforeLoss, EXPERIENCE_DURATION_MS), EXPERIENCE_DURATION_MS));
  assert.deepEqual(Object.keys(model), Object.keys(connected));
  assert.equal(connected.accumulatedEvidence.count, 58);
});

// ---------------------------------------------------------------------------
// §20 — PEB HANDOFF
// ---------------------------------------------------------------------------

test("B §20: the portable PEB is the engine's bundle; a miss records nothing; a drop is the engine's DROP; bytes are preserved", () => {
  const runtime = freshRuntime(126_000);
  const artifacts = artifactsOf(runtime.session);
  const ready = derivePublicExperience(snapshotOf(runtime.session, EXPERIENCE_DURATION_MS));
  assert.equal(ready.handoff.stage, "READY", "the drag source exists only when the bundle exists");
  assert.equal(ready.portableEvidence.bundleId, artifacts.handoff.peb.bundleId, "the object IS the engine's bundle");
  assert.equal(ready.portableEvidence.bundleDigest, artifacts.handoff.peb.manifest.bundleDigest);
  assert.equal(ready.portableEvidence.transferredContentDigest, artifacts.handoff.transferredContentDigest);
  const early = derivePublicExperience(snapshotOf(journalAt(createOfflineEvidenceSession(RUN_ID, null, MISSION_ID), 60_000), 60_000));
  assert.equal(early.handoff.stage, "NOT_READY");
  assert.equal(early.portableEvidence.bundleId, null, "no drag source without a bundle");

  // The transfer stages are the engine's: a miss (no SEND) leaves SOURCE; GATHER then SEND is the handoff; twice is once.
  assert.equal(nextTransferStage("SOURCE", "SEND"), "SOURCE", "an invalid drop does nothing semantic");
  const handed = nextTransferStage(nextTransferStage("SOURCE", "GATHER"), "SEND");
  assert.equal(handed, "TRANSFERRED");
  assert.equal(nextTransferStage(nextTransferStage(handed, "GATHER"), "SEND"), "TRANSFERRED", "a duplicate handoff is idempotent");

  // The handoff never regenerates or mutates the artifact: the same bytes, the same digest.
  const again = createHandoffArtifact(artifacts.handoff.peb, HANDOFF_READY_MS);
  assert.equal(again.transferredContentDigest, artifacts.handoff.transferredContentDigest);
  assert.equal(again.pebText, artifacts.handoff.pebText);
  const received = derivePublicExperience(snapshotOf(runtime.session, EXPERIENCE_DURATION_MS, { transferStage: "TRANSFERRED", handoffNetworkState: "CONNECTED" }));
  assert.equal(received.handoff.stage, "HANDED_OVER");
  assert.equal(received.handoff.transferredContentDigest, artifacts.handoff.transferredContentDigest, "the verifier receives exactly the handed bytes");
  assert.equal(received.portableEvidence.state, "RECEIVED");
  assert.equal(received.handoff.receivedWhileLinkLost, false);
  for (const dictionary of [en, fr]) {
    const line = dossierLine(received.accumulatedEvidence.count, received.finalReceipt, received.portableEvidence, dictionary.nx.dossier);
    assert.ok(line.endsWith(`${dictionary.nx.dossier.peb} · ${dictionary.nx.dossier.pebState.RECEIVED}`), line);
  }

  // FS-R2: primary click PICK, explicit OPEN, then explicit DROP in the independent tab.
  const root = code(source("experience/NxExperience.tsx"));
  assert.match(root, /engine\.pick\(\);/, "PICK is a separate engine act");
  assert.match(root, /onClick=\{submitPeb\}/, "OPEN requires its own button gesture");
  assert.doesNotMatch(root, /onPointerDown|onPointerUp|isOverHandoff/, "no pointer drag triggers OPEN or DROP");
  assert.doesNotMatch(root, /engine\.handoff\(\)/, "the pointer path never fires pick and drop as one act");
  assert.doesNotMatch(root, /setTransferStage/, "no transfer implementation outside the engine");
  assert.match(root, /onReceived: \(expected\) => \{[\s\S]*sameDemoArtifact[\s\S]*current\.drop\(\)/, "only receipt for the same artifact calls DROP");
  assert.match(root, /className="nx-compact-handoff"/);
  assert.doesNotMatch(root, /<VerifierSurface/);
  const dossier = code(source("workspace/EvidenceDossier.tsx"));
  assert.match(dossier, /className=\{`nx-peb-chip/, "the PEB is a visible object in the dossier");
  assert.match(dossier, /onClick=\{\(\) => pebTakeable \? onHandover\(\) : onFocus\(\{ kind: "peb" \}\)\}/, "primary click picks only a READY artifact");
  assert.match(dossier, /portable\.bundleId !== null && \(/, "rendered only when the bundle exists");
  assert.match(dossier, /onClick=\{onHandover\}/, "keyboard users pick the PEB up with a button (NX3: the same engine PICK as the pointer)");
  // NX3: the drop target is the verifier surface's receiving zone, not a panel.
  const verifier = code(source("verifier/VerifierSurface.tsx"));
  assert.match(verifier, /ref=\{dropTargetRef\} className="nx-vs-dropzone"/, "the receiving surface is the drop target");
  assert.match(verifier, /drop === "over" \? copy\.dropArmed : copy\.dropHere/);
});

// ---------------------------------------------------------------------------
// §21 — OFFLINE VERIFIER
// ---------------------------------------------------------------------------

test("B §21: the verifier receives and analyzes the PEB while the link is LOST; the verdict is the engine's, deterministic, and captured before restoration", async () => {
  const runtime = freshRuntime(40_000);
  observe(runtime, "CONNECTED", 0, 40_000);
  observe(runtime, "CONNECTED", 1, 40_000);
  observe(runtime, "LOST", 2, 41_000);
  observe(runtime, "LOST", 3, 41_500);
  runtime.session = journalAt(runtime.session, EXPERIENCE_DURATION_MS);
  assert.equal(runtime.session.networkState, "LOST");
  const artifacts = artifactsOf(runtime.session);

  // The engine's D-006 verifier on the exact handed bytes, with the cable out.
  const inserted = insertD006PebForAnalysis({ pebText: artifacts.handoff.pebText, expectedIdentity: artifacts.handoff.identity, expectedTransferredContentDigest: artifacts.handoff.transferredContentDigest });
  const first = await analyzeInsertedD006Peb(inserted);
  const second = await analyzeInsertedD006Peb(inserted);
  assert.equal(first.transferredContentDigest, artifacts.handoff.transferredContentDigest);
  assert.deepEqual(first.result, second.result, "deterministic: the same bytes, the same verdict and reason codes");
  assert.ok(["VALID", "INVALID", "INDETERMINATE", "REVOKED"].includes(first.result.verdict));
  assert.ok(first.result.completedChecks.includes("verification_key_authorized_by_pinned_anchor"), "trust material is the verifier's pinned directory, available offline");
  assert.ok(first.result.completedChecks.includes("d006_transferred_digest_exact"));
  // The same result as the direct verifier call: the insertion contract adds nothing.
  const direct = await verifyD006PortableMissionEvidence(artifacts.handoff.pebText, { expectedIdentity: artifacts.handoff.identity, expectedTransferredContentDigest: artifacts.handoff.transferredContentDigest });
  assert.deepEqual(direct, first.result);

  // The capture: the engine records the completed local artifacts and this verdict while LOST.
  const captured = capturePreRestorationIfPossible(runtime.session, artifacts.handoff, first, EXPERIENCE_DURATION_MS);
  assert.notEqual(captured, runtime.session);
  assert.ok(captured.preRestorationCapture !== null);
  assert.equal(captured.preRestorationCapture.verdict, first.result.verdict);
  assert.equal(captured.preRestorationCapture.pebRef, artifacts.handoff.peb.bundleId);
  assert.equal(captured.preRestorationCapture.finalReceiptRef, artifacts.handoff.finalReceipt.receiptId);
  assert.equal(captured.records.at(-1)?.eventType, "MISSION_COMPLETED_OFFLINE");
  assert.equal(captured.records.at(-1)?.receiptId, "NR-MISSION-COMPLETE-OFFLINE");
  assert.equal(capturePreRestorationIfPossible(captured, artifacts.handoff, first, EXPERIENCE_DURATION_MS), captured, "captured once");
  assert.equal(capturePreRestorationIfPossible(runtime.session, artifacts.handoff, null, EXPERIENCE_DURATION_MS), runtime.session, "no verdict, no capture");
  assert.equal(artifactStateFor(artifacts.handoff, { ...first, transferredContentDigest: "0".repeat(64) }), null, "a verdict for other bytes is not this artifact's");

  // The public model: verified while the link was lost, captured before restoration, verdict mirrored.
  const model = derivePublicExperience(snapshotOf(captured, EXPERIENCE_DURATION_MS, {
    transferStage: "TRANSFERRED", analysisRequested: true, verification: first.result, handoffNetworkState: "LOST", verdictNetworkState: "LOST",
  }));
  assert.equal(model.verification.state, "VERDICT");
  assert.equal(model.verification.verdict, first.result.verdict);
  assert.deepEqual(model.verification.reasonCodes, first.result.reasonCodes);
  assert.equal(model.verification.verifiedWhileLinkLost, true);
  assert.equal(model.verification.capturedBeforeRestoration, true);
  assert.equal(model.handoff.receivedWhileLinkLost, true);
  assert.equal(model.network.state, "LOST");
  assert.equal(model.accumulatedEvidence.journalCount, 1, "the offline completion record is a journal nano-receipt after the seal");
  const completion = model.accumulatedEvidence.items.find((entry) => entry.eventType === "MISSION_COMPLETED_OFFLINE");
  assert.ok(completion !== undefined);
  assert.equal(completion.standing, "JOURNAL");
  assert.equal(completion.assurance, "UNASSESSED");
  assert.equal(completion.branch, "network");
  // The UI cannot choose the verdict: every verdict is mirrored as given, none is produced.
  for (const verdict of ["VALID", "INVALID", "INDETERMINATE", "REVOKED"] as const) {
    const mirrored = derivePublicExperience(snapshotOf(captured, EXPERIENCE_DURATION_MS, { transferStage: "TRANSFERRED", analysisRequested: true, verification: { ...first.result, verdict } }));
    assert.equal(mirrored.verification.verdict, verdict);
  }
});

// ---------------------------------------------------------------------------
// §22 — RECONCILIATION
// ---------------------------------------------------------------------------

test("B §22: after the offline verdict, restoration then reconciliation produce one canonical receipt; nothing prior is rewritten and the verdict holds", async () => {
  const runtime = freshRuntime(40_000);
  observe(runtime, "CONNECTED", 0, 40_000);
  observe(runtime, "CONNECTED", 1, 40_000);
  observe(runtime, "LOST", 2, 41_000);
  observe(runtime, "LOST", 3, 41_500);
  runtime.session = journalAt(runtime.session, EXPERIENCE_DURATION_MS);
  const artifacts = artifactsOf(runtime.session);
  const verdict = await analyzeInsertedD006Peb(insertD006PebForAnalysis({ pebText: artifacts.handoff.pebText, expectedIdentity: artifacts.handoff.identity, expectedTransferredContentDigest: artifacts.handoff.transferredContentDigest }));
  runtime.session = capturePreRestorationIfPossible(runtime.session, artifacts.handoff, verdict, EXPERIENCE_DURATION_MS);
  const beforeRestoration = runtime.session;
  const store = memoryBaseStore(RUN_ID);

  // Reconciliation cannot start while the link is LOST, whatever the UI says: no window, no operation.
  const premature = performReconciliation({ session: runtime.session, baseStore: store, artifacts: artifactStateFor(artifacts.handoff, verdict), masterTimeMs: EXPERIENCE_DURATION_MS });
  assert.equal(premature.performed, null, "no restoration receipt, no base compare");
  assert.equal(premature.result.status, "FAILED");
  assert.equal(premature.result.receipt, null);
  assert.equal(awaitingReconciliationWindowKey(runtime.session), null);

  // The cable comes back: the physical restoration is observed and admitted.
  observe(runtime, "CONNECTED", 200, EXPERIENCE_DURATION_MS);
  const restored = observe(runtime, "CONNECTED", 201, EXPERIENCE_DURATION_MS);
  assert.equal(restored.kind, "TRANSITION");
  assert.equal(runtime.session.networkState, "CONNECTED");
  assert.equal(offlineWindowStatus(runtime.session), "AWAITING_RECONCILIATION");
  const windowKey = awaitingReconciliationWindowKey(runtime.session);
  assert.notEqual(windowKey, null);

  // Reconciliation, performed by the engine.
  const attempt = performReconciliation({ session: runtime.session, baseStore: store, artifacts: artifactStateFor(artifacts.handoff, verdict), masterTimeMs: EXPERIENCE_DURATION_MS });
  assert.ok(attempt.performed !== null);
  assert.equal(attempt.performed.transferred, true, "the base ledger actually received the missing records");
  assert.equal(attempt.result.status, "COMPLETE", attempt.result.reasonCodes.join(","));
  const receipt = attempt.result.receipt!;
  assert.equal(receipt.eventType, "RECONCILIATION_RECEIPT");
  assert.match(receipt.receiptId, /^RR-OFFLINE-RECONCILIATION:/);
  assert.equal(receipt.evidenceLocality, "RECONCILED");
  assert.equal(receipt.verdictUnchanged, true, "the receipt itself states the offline verdict was unchanged");
  assert.equal(receipt.pebUnchanged, true);
  assert.equal(receipt.finalReceiptUnchanged, true);
  assert.equal(receipt.localVerdict, verdict.result.verdict);
  assert.equal(receipt.pebDigest, runtime.session.preRestorationCapture!.pebDigest);
  assert.equal(receipt.transferredObjectCount, attempt.performed.transferredCount);
  const reconciled = attempt.result.session;
  assert.equal(offlineWindowStatus(reconciled), "RECONCILED");
  assert.equal(reconciled.records.filter((record) => record.eventType === "RECONCILIATION_RECEIPT").length, 1);
  // Nothing prior is rewritten.
  assert.deepEqual(reconciled.records.slice(0, runtime.session.records.length).map((record) => record.canonicalDigest), runtime.session.records.map((record) => record.canonicalDigest));
  assert.deepEqual(reconciled.records.slice(0, beforeRestoration.records.length).map((record) => record.canonicalDigest), beforeRestoration.records.map((record) => record.canonicalDigest));
  assert.equal(canonicalString(artifactsOf(reconciled).handoff.peb), canonicalString(artifacts.handoff.peb), "the PEB is byte-identical after reconciliation");

  // A second attempt for the same window returns the same receipt and appends nothing (real cables flap).
  const again = performReconciliation({ session: reconciled, baseStore: store, artifacts: artifactStateFor(artifacts.handoff, verdict), masterTimeMs: EXPERIENCE_DURATION_MS });
  assert.equal(again.result.status, "COMPLETE");
  assert.equal(again.result.receipt?.receiptId, receipt.receiptId);
  assert.equal(again.result.session.records.length, reconciled.records.length, "no duplicate reconciliation receipt");

  // The verdict after reconciliation: the verifier, on the same bytes, says the same thing.
  const after = await verifyD006PortableMissionEvidence(artifacts.handoff.pebText, { expectedIdentity: artifacts.handoff.identity, expectedTransferredContentDigest: artifacts.handoff.transferredContentDigest });
  assert.deepEqual(after, verdict.result, "reconnection does not rewrite the prior verdict");

  // The public model absorbs the reconciliation evidence in the same grammar.
  const model = derivePublicExperience(snapshotOf(reconciled, EXPERIENCE_DURATION_MS, {
    transferStage: "TRANSFERRED", analysisRequested: true, verification: verdict.result, handoffNetworkState: "LOST", verdictNetworkState: "LOST",
    reconciliation: attempt.result, baseTransfer: attempt.performed, linkPhase: "CONNECTED", networkState: "CONNECTED",
  }));
  assert.equal(model.network.reconciliationStage, "RECONCILED");
  assert.equal(model.network.bandTone, "COMPLETE");
  assert.equal(model.network.evidenceLocality, "RECONCILED");
  assert.equal(model.network.reconciliationReceiptId, receipt.receiptId);
  assert.equal(model.network.verdictUnchanged, true);
  assert.deepEqual([model.network.lostCount, model.network.restoredCount, model.network.reconciliationReceiptCount], [1, 1, 1]);
  assert.equal(model.verification.heldAfterReconciliation, true);
  assert.equal(model.verification.verdict, verdict.result.verdict);
  assert.equal(model.accumulatedEvidence.sealedCount, 59);
  assert.equal(model.accumulatedEvidence.journalCount, 3, "restoration, offline completion, reconciliation: three journal nano-receipts after the seal");
  assert.equal(model.accumulatedEvidence.byBranch.network, 4, "the network lane holds the loss and the three later records");
  const receiptBead = model.accumulatedEvidence.items.find((entry) => entry.eventType === "RECONCILIATION_RECEIPT");
  assert.ok(receiptBead !== undefined, "the reconciliation is itself evidenced in the proof");
  assert.equal(receiptBead.branch, "network");
  assert.equal(receiptBead.standing, "JOURNAL");
  assert.equal(receiptBead.evidenceLocality, "RECONCILED");
  assert.equal(receiptBead.provenanceResolution, "LANE_TABLE");
  assert.equal(model.accumulatedEvidence.items.at(-1)?.evidenceId, receipt.receiptId, "the receipt is the newest bead");
  for (const dictionary of [en, fr]) {
    assert.equal(reconciliationLine(model.network, dictionary.nx.reconciliation), dictionary.nx.reconciliation.reconciled.replace("{count}", String(receipt.transferredObjectCount)));
  }
  // Pre-existing beads are the same objects, digest for digest.
  const before = derivePublicExperience(snapshotOf(beforeRestoration, EXPERIENCE_DURATION_MS));
  for (const entry of before.accumulatedEvidence.items) {
    const now = model.accumulatedEvidence.items.find((candidate) => candidate.evidenceId === entry.evidenceId);
    assert.ok(now !== undefined && now.digest === entry.digest, `${entry.evidenceId} unchanged by reconciliation`);
  }
});

// DOCTRINE CHANGE — D-006 in-mission offline reconciliation, 2026-10-08.
// This test used to be "a restoration before the offline verdict reconciles
// truthfully as FAILED — the artifact state was never captured": under the old
// contract a window could only be reconciled against a Final Receipt, PEB and
// verdict captured while LOST, so a mid-mission restoration always failed with
// ARTIFACT_STATE_INVALID. The canonical decision is now that evidence produced
// during an outage is reconciled as soon as connectivity returns in mission,
// against the journal prefix the restoration closes. The same physical order
// therefore earns COMPLETE through the same shared runtime. The old FAILED
// expectation is kept, unchanged, where the doctrine still produces it: a
// restoration after the Final Receipt seal with no captured verdict.
test("B §22: a restoration before the offline verdict reconciles IN MISSION — COMPLETE against the journal, claiming nothing about artifacts that do not exist yet", async () => {
  const runtime = freshRuntime(40_000);
  observe(runtime, "CONNECTED", 0, 40_000);
  observe(runtime, "CONNECTED", 1, 40_000);
  observe(runtime, "LOST", 2, 41_000);
  observe(runtime, "LOST", 3, 41_500);
  observe(runtime, "CONNECTED", 10, 60_000);
  observe(runtime, "CONNECTED", 11, 60_500);
  assert.equal(offlineWindowStatus(runtime.session), "AWAITING_RECONCILIATION");
  const attempt = performReconciliation({ session: runtime.session, baseStore: memoryBaseStore(`${RUN_ID}.early`), artifacts: null, masterTimeMs: 61_000 });
  assert.equal(attempt.result.status, "COMPLETE", attempt.result.reasonCodes.join(","));
  const receipt = attempt.result.receipt!;
  assert.ok(isInMissionReconciliationReceipt(receipt), "the in-mission receipt variant");
  assert.equal(receipt.evidenceLocality, "RECONCILED");
  assert.equal(receipt.verdictUnchanged, undefined, "no verdict exists yet: the receipt states nothing about one");
  assert.equal(receipt.pebRef, undefined);
  assert.equal(attempt.performed?.transferred, true, "the base actually received the window");
  assert.equal(offlineWindowStatus(attempt.result.session), "RECONCILED");
  assert.deepEqual(
    attempt.result.session.records.slice(0, runtime.session.records.length).map((record) => record.canonicalDigest),
    runtime.session.records.map((record) => record.canonicalDigest),
    "nothing prior is rewritten",
  );
  const model = derivePublicExperience(snapshotOf(journalAt(attempt.result.session, 61_000), 61_000, { reconciliation: attempt.result, baseTransfer: attempt.performed, linkPhase: "CONNECTED" }));
  assert.equal(model.network.reconciliationStage, "RECONCILED");
  assert.equal(model.network.bandTone, "COMPLETE");
  assert.equal(model.network.evidenceLocality, "RECONCILED");
  assert.equal(model.network.verdictUnchanged, null, "no verdict is claimed held");
  for (const dictionary of [en, fr]) {
    assert.equal(reconciliationLine(model.network, dictionary.nx.reconciliation), dictionary.nx.reconciliation.reconciled.replace("{count}", String(receipt.transferredObjectCount)));
  }

  // The old expectation, where it still holds: restored after the seal, no verdict captured.
  const late = freshRuntime(40_000);
  observe(late, "CONNECTED", 0, 40_000);
  observe(late, "CONNECTED", 1, 40_000);
  observe(late, "LOST", 2, 41_000);
  observe(late, "LOST", 3, 41_500);
  late.session = journalAt(late.session, EXPERIENCE_DURATION_MS);
  observe(late, "CONNECTED", 200, EXPERIENCE_DURATION_MS);
  observe(late, "CONNECTED", 201, EXPERIENCE_DURATION_MS);
  assert.notEqual(late.session.finalReceiptRuntimeSeal, null);
  assert.equal(offlineWindowStatus(late.session), "AWAITING_RECONCILIATION");
  const failed = performReconciliation({ session: late.session, baseStore: memoryBaseStore(`${RUN_ID}.late`), artifacts: null, masterTimeMs: EXPERIENCE_DURATION_MS });
  assert.equal(failed.result.status, "FAILED");
  assert.ok(failed.result.reasonCodes.includes("ARTIFACT_STATE_INVALID"));
  assert.equal(failed.result.receipt, null);
  assert.equal(failed.result.session, late.session, "a failed reconciliation appends nothing");
  const failedModel = derivePublicExperience(snapshotOf(late.session, EXPERIENCE_DURATION_MS, { reconciliation: failed.result, baseTransfer: failed.performed, linkPhase: "CONNECTED" }));
  assert.equal(failedModel.network.reconciliationStage, "FAILED");
  assert.equal(failedModel.network.bandTone, "FAILED");
  assert.ok(failedModel.network.reconciliationReasons.includes("ARTIFACT_STATE_INVALID"));
  assert.equal(failedModel.network.evidenceLocality, "LOCAL", "evidence stays local until the engine confirms");
  for (const dictionary of [en, fr]) assert.equal(reconciliationLine(failedModel.network, dictionary.nx.reconciliation), dictionary.nx.reconciliation.failed);
});

test("B: the sentinel reader never reads 'connected' from an unreachable or malformed sidecar", async () => {
  const controller = new AbortController();
  const unreachable = await readLinkSentinel(controller.signal, async () => { throw new TypeError("ECONNREFUSED"); });
  assert.deepEqual(unreachable, SENTINEL_UNREACHABLE);
  const malformed = await readLinkSentinel(controller.signal, async () => new Response(JSON.stringify({ link: "CONNECTED" }), { headers: { "content-type": "application/json" } }));
  assert.deepEqual(malformed, SENTINEL_UNREACHABLE);
  const genuine = report("CONNECTED", 0);
  const failedHttp = await readLinkSentinel(controller.signal, async () => new Response(JSON.stringify(genuine), { status: 503, headers: { "content-type": "application/json" } }));
  assert.deepEqual(failedHttp, SENTINEL_UNREACHABLE, "an HTTP failure cannot establish a link from its response body");
  const ok = await readLinkSentinel(controller.signal, async () => new Response(JSON.stringify(genuine), { headers: { "content-type": "application/json" } }));
  assert.deepEqual(ok, genuine);
});


test("Demo READY: physical network NanoReceipt counts stay visible independently of the mission presentation queue", () => {
  const runtime = freshRuntime(0);
  const empty = derivePublicExperience(snapshotOf(runtime.session, 0));
  assert.equal(empty.mission.phase, "READY");
  assert.equal(networkReceiptLine(empty.network, "en"), null);
  observe(runtime, "CONNECTED", 0, 0);
  observe(runtime, "CONNECTED", 1, 0);
  observe(runtime, "LOST", 2, 0);
  observe(runtime, "LOST", 3, 0);
  const lost = derivePublicExperience(snapshotOf(runtime.session, 0, { linkPhase: "LOST" }));
  assert.equal(lost.mission.phase, "READY");
  assert.equal(lost.accumulatedEvidence.count, 0, "READY does not invent presented mission receipts");
  assert.deepEqual(networkReceiptLine(lost.network, "fr"), {
    label: "NR réseau · perte 1 · reprise 0",
    detail: "RJ45 LOST · NR-NET-LOST ×1 · NR-NET-RESTORED ×0",
  });
  observe(runtime, "CONNECTED", 10, 0);
  observe(runtime, "CONNECTED", 11, 0);
  const restored = derivePublicExperience(snapshotOf(runtime.session, 0, { linkPhase: "CONNECTED" }));
  const before = canonicalString(runtime.session);
  for (const locale of ["en", "fr"] as const) {
    const line = networkReceiptLine(restored.network, locale);
    assert.match(line!.detail, /^RJ45 CONNECTED · NR-NET-LOST ×1 · NR-NET-RESTORED ×1$/);
    assert.equal(restored.accumulatedEvidence.count, 0, "network history never inflates the presentation count");
  }
  const unknown = networkReceiptLine({ ...restored.network, linkPhase: "UNKNOWN" }, "en");
  assert.match(unknown!.detail, /^RJ45 UNKNOWN/, "historical receipts cannot claim a current physical link");
  assert.equal(canonicalString(runtime.session), before, "formatting does not append or mutate records");
  const experience = source("experience/NxExperience.tsx");
  assert.match(experience, /networkReceipts !== null && <span className="nx-network-receipt-count"/);
  assert.match(experience, /title=\{networkReceipts\.detail\} aria-label=\{networkReceipts\.detail\}/);
});

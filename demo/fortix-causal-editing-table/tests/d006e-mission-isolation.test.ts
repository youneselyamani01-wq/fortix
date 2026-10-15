import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildReport, type AdapterRecord, type LinkSentinelReport } from "../app/ethernetLink.ts";
import { PhysicalNetworkTransitionMachine } from "../app/networkTransitions.ts";

import {
  ACTIVE_RUN_POINTER_KEY,
  RUN_ARCHIVE_KEY,
  archiveRun,
  isMissionRunId,
  isRunResumable,
  newMissionRunId,
  parseRunArchive,
  parseRunPointer,
  parseRunSession,
  recordsForRun,
  runNetworkKey,
  runSessionKey,
} from "../app/missionRun.ts";
import {
  PHYSICAL_SENTINEL_SOURCE,
  TARGET_ADAPTER_IDENTITY,
  appendNetworkTransition,
  appendOfflineEvidence,
  capturePreRestorationArtifacts,
  createOfflineEvidenceSession,
  offlineWindowStatus,
  reconcileOfflineEvidence,
  type ArtifactState,
  type JsonValue,
  type OfflineEvidenceSession,
} from "../app/offlineEvidence.ts";
import {
  D005M_MASTER_BUNDLE,
  D005M_MASTER_BUNDLE_ID,
  D005M_MASTER_CYCLE_RECEIPT,
  D005M_MASTER_CYCLE_RECEIPT_ID,
} from "../app/masterStory.ts";
import { MISSION_ID } from "../app/missionContinuity.ts";
import { en } from "../../../site/src/i18n/locales/en.ts";
import { fr } from "../../../site/src/i18n/locales/fr.ts";

/**
 * D-006E — active mission isolation.
 *
 * Reported: a fresh launch, with the real adapter CONNECTED, already showed
 * NR-NET-LOST and a reconciliation node in the active Proof Tree — evidence
 * from a previous demonstration, presented as if it belonged to this one.
 *
 * These tests hold the boundary: historical evidence persists, and is never
 * part of a new mission's causal graph.
 */

const ARTIFACTS: ArtifactState = Object.freeze({
  finalReceipt: Object.freeze({
    ref: D005M_MASTER_CYCLE_RECEIPT_ID,
    value: D005M_MASTER_CYCLE_RECEIPT as unknown as JsonValue,
  }),
  portableEvidenceBundle: Object.freeze({
    ref: D005M_MASTER_BUNDLE_ID,
    value: D005M_MASTER_BUNDLE as unknown as JsonValue,
  }),
  verdict: "INDETERMINATE",
});

const RUN_A = newMissionRunId(Date.parse("2026-08-24T10:00:00Z"), "aaaa1111bbbb");
const RUN_B = newMissionRunId(Date.parse("2026-08-24T11:00:00Z"), "cccc2222dddd");

/** The real I226-LM as the sentinel reports it, per d006d-network-transitions. */
const I226: AdapterRecord = Object.freeze({
  name: "Ethernet",
  description: "Intel(R) Ethernet Controller I226-LM",
  status: "Up",
  mediaConnectionState: "Connected",
  mediaType: "802.3",
  physicalMediaType: "802.3",
  virtual: false,
  ifIndex: 24,
});

function sentinelReport(link: "CONNECTED" | "LOST", second: number): LinkSentinelReport {
  return buildReport([{
    ...I226,
    status: link === "CONNECTED" ? "Up" : "Disconnected",
    mediaConnectionState: link === "CONNECTED" ? "Connected" : "Disconnected",
  }], new Date(Date.UTC(2026, 7, 24, 10, 0, 0) + second * 1_000).toISOString());
}

/** Drives one full offline cycle for a given run id, ending reconciled. */
function completedRun(runId: string): OfflineEvidenceSession {
  let session = createOfflineEvidenceSession(runId);
  session = appendNetworkTransition(session, {
    runId,
    observationId: `${runId}-loss`,
    adapterIdentity: TARGET_ADAPTER_IDENTITY,
    observationSource: PHYSICAL_SENTINEL_SOURCE,
    previousNetworkState: "CONNECTED",
    newNetworkState: "LOST",
    missionClockPosition: 30_000,
  }).session;
  session = appendOfflineEvidence(session, {
    missionId: MISSION_ID,
    runId,
    eventId: `${runId}.drop-off`,
    eventType: "CUSTOMER_DROP_OFF",
    receiptId: `NR-DROP-OFF:${runId}`,
    missionClockPosition: 36_000,
    executionLocality: "LOCAL",
    payload: { result: "COMPLETED" },
  }).session;
  const captured = capturePreRestorationArtifacts(session, { ...ARTIFACTS, missionClockPosition: 120_000 });
  session = appendNetworkTransition(captured.session, {
    runId,
    observationId: `${runId}-restored`,
    adapterIdentity: TARGET_ADAPTER_IDENTITY,
    observationSource: PHYSICAL_SENTINEL_SOURCE,
    previousNetworkState: "LOST",
    newNetworkState: "CONNECTED",
    missionClockPosition: 121_000,
  }).session;
  const reconciled = reconcileOfflineEvidence({
    session,
    operation: {
      kind: "BASE_COMPARE_TRANSFER",
      operationId: `${runId}.reconciliation-operation`,
      baseBefore: { missionId: MISSION_ID, runId, records: [] },
      baseAfter: { missionId: MISSION_ID, runId, records: session.records },
      transferredReceiptIds: session.records.map((record) => record.receiptId),
    },
    capture: captured.capture,
    currentArtifacts: ARTIFACTS,
  });
  assert.equal(reconciled.status, "COMPLETE", "fixture run did not reconcile");
  return reconciled.session;
}

// --- 1-3. Mission A completes and persists; mission B starts -------------

test("D-006E iso 1-3: mission A completes, persists, and mission B starts clean", () => {
  const a = completedRun(RUN_A);
  assert.ok(a.records.some((r) => r.eventType === "NETWORK_LINK_LOST"));
  assert.ok(a.records.some((r) => r.eventType === "RECONCILIATION_RECEIPT"));

  const b = createOfflineEvidenceSession(RUN_B);
  assert.equal(b.records.length, 0);
  assert.equal(b.missionId, a.missionId, "all enactments retain the canonical mission identity");
  assert.notEqual(b.runId, a.runId, "a new demonstration must receive a new run identity");
});

// --- 4. Mission B's tree contains no mission A network receipts -----------

test("D-006E iso 4: mission B's active view contains no mission A records", () => {
  const a = completedRun(RUN_A);
  const b = createOfflineEvidenceSession(RUN_B);
  // Even given every record both runs ever produced, the active view for B
  // is exactly B's own.
  const everything = [...a.records, ...b.records];
  assert.deepEqual(recordsForRun(everything, RUN_B), []);
  assert.equal(recordsForRun(everything, RUN_A).length, a.records.length);
});

// --- 5 + 13. Mission A's evidence survives, unchanged ---------------------

test("D-006E iso 5/13: mission A evidence remains persisted and immutable", () => {
  const a = completedRun(RUN_A);
  const before = a.records.map((r) => r.canonicalDigest).join("|");
  // Starting B touches nothing belonging to A.
  createOfflineEvidenceSession(RUN_B);
  const after = a.records.map((r) => r.canonicalDigest).join("|");
  assert.equal(after, before, "starting a new run must not alter historical evidence");
  assert.ok(Object.isFrozen(a.records), "historical records must stay frozen");
  // And their storage is addressed separately, so it is never overwritten.
  assert.notEqual(runSessionKey(RUN_A), runSessionKey(RUN_B));
  assert.notEqual(runNetworkKey(RUN_A), runNetworkKey(RUN_B));
});

// --- 6. Before any loss in B, no network receipts exist ------------------

test("D-006E iso 6: before a physical loss in mission B, NR-NET-LOST is absent", () => {
  const a = completedRun(RUN_A);
  const b = createOfflineEvidenceSession(RUN_B);
  const activeView = recordsForRun([...a.records, ...b.records], RUN_B);
  assert.equal(activeView.filter((r) => r.eventType === "NETWORK_LINK_LOST").length, 0);
  assert.equal(activeView.filter((r) => r.eventType === "NETWORK_LINK_RESTORED").length, 0);
  assert.equal(activeView.filter((r) => r.eventType === "RECONCILIATION_RECEIPT").length, 0);
});

// --- 7-9. B's own cycle produces exactly one of each ----------------------

test("D-006E iso 7-9: mission B's own cycle produces exactly one of each record", () => {
  const a = completedRun(RUN_A);
  const b = completedRun(RUN_B);
  const activeView = recordsForRun([...a.records, ...b.records], RUN_B);
  assert.equal(activeView.filter((r) => r.eventType === "NETWORK_LINK_LOST").length, 1);
  assert.equal(activeView.filter((r) => r.eventType === "NETWORK_LINK_RESTORED").length, 1);
  assert.equal(activeView.filter((r) => r.eventType === "RECONCILIATION_RECEIPT").length, 1);
  // And A's are still exactly one each, untouched by B's cycle.
  const historical = recordsForRun([...a.records, ...b.records], RUN_A);
  assert.equal(historical.filter((r) => r.eventType === "RECONCILIATION_RECEIPT").length, 1);
});

// --- 10-11. Resumability ------------------------------------------------

test("D-006E iso 10: an interrupted run is resumable and restores only its own records", () => {
  // Mid-story: the cable is out, the mission is still running, nothing reconciled.
  let b = createOfflineEvidenceSession(RUN_B);
  b = appendNetworkTransition(b, {
    runId: RUN_B,
    observationId: `${RUN_B}-loss`,
    adapterIdentity: TARGET_ADAPTER_IDENTITY,
    observationSource: PHYSICAL_SENTINEL_SOURCE,
    previousNetworkState: "CONNECTED",
    newNetworkState: "LOST",
    missionClockPosition: 30_000,
  }).session;
  assert.equal(isRunResumable(b), true, "a run mid-offline-window must survive a reload");
  assert.equal(recordsForRun(b.records, RUN_B).length, b.records.length);
});

test("D-006E iso 11: a completed run is NOT resumable, so a reload starts clean", () => {
  const a = completedRun(RUN_A);
  assert.equal(isRunResumable(a), false,
    "a fully reconciled demonstration must not re-present itself as the live mission");
  assert.equal(isRunResumable(createOfflineEvidenceSession(RUN_B)), false,
    "an empty run has nothing to resume");
});

test("D-006E iso 11b: a SECOND outage after a reconciled first one is still resumable", () => {
  // The cable came out, went back in, reconciled — and then came out again.
  // The run is live, offline right now, and a reload must not abandon it.
  // The latest-window status must describe this open second outage rather
  // than the earlier reconciled one.
  const twoOutages = appendNetworkTransition(completedRun(RUN_A), {
    runId: RUN_A,
    observationId: `${RUN_A}-loss-2`,
    adapterIdentity: TARGET_ADAPTER_IDENTITY,
    observationSource: PHYSICAL_SENTINEL_SOURCE,
    previousNetworkState: "CONNECTED",
    newNetworkState: "LOST",
    missionClockPosition: 200_000,
  }).session;

  assert.equal(offlineWindowStatus(twoOutages), "OPEN",
    "the earlier window is indeed still reconciled — that is the trap");
  assert.equal(isRunResumable(twoOutages), true,
    "an open second offline window must survive a reload");
});

// --- 12. Current physical state never comes from historical evidence -----

test("D-006E iso 12: CONNECTED is established by the sentinel, not by stored evidence", () => {
  // The reported symptom in one line: a completed run's evidence exists, the
  // cable is in, and the new demonstration must simply read CONNECTED.
  const a = completedRun(RUN_A);
  assert.ok(a.records.some((r) => r.eventType === "NETWORK_LINK_LOST"),
    "the historical run must genuinely carry a loss, or this proves nothing");

  const machine = new PhysicalNetworkTransitionMachine({ runId: RUN_B });
  assert.equal(machine.state, "UNKNOWN", "a new run starts with nothing observed");

  // Two observations of a connected cable — the debounce the real poll uses.
  const first = machine.observe(sentinelReport("CONNECTED", 0), { evidenceClockMs: 0 });
  const second = machine.observe(sentinelReport("CONNECTED", 1), { evidenceClockMs: 1_000 });

  assert.equal(machine.state, "CONNECTED");
  // Establishing the initial observed state is not a transition: no NR-NET-*
  // receipt is minted, so the new mission's tree stays empty.
  assert.equal(first.event, null);
  assert.equal(second.event, null);
  assert.equal(machine.runId, RUN_B, "the new machine is scoped to the new run");
});

test("D-006E iso 12b: a new run's machine cannot inherit a prior run's snapshot", () => {
  // The prior scheme keyed the persisted snapshot on the canonical chain id,
  // so every run rehydrated the last run's machine. Snapshots carry their own
  // mission id; a snapshot from another run is not this run's to restore.
  const priorRun = new PhysicalNetworkTransitionMachine({ runId: RUN_A });
  priorRun.observe(sentinelReport("LOST", 0), { evidenceClockMs: 0 });
  priorRun.observe(sentinelReport("LOST", 1), { evidenceClockMs: 1_000 });
  const snapshot = priorRun.snapshot();
  assert.equal(snapshot.runId, RUN_A);
  assert.notEqual(snapshot.runId, RUN_B,
    "a snapshot is addressable to its own run, so run B's key never finds it");
});

// --- 14. No two evidence nodes share one semantic label -------------------

test("D-006E iso 14: the reconciliation receipt and the reconciliation panel are named differently", () => {
  // The physical review saw two visually identical LOCAL ↔ BASE
  // RECONCILIATION entries. They were never the same thing: one is the
  // Reconciliation Receipt as a node in the causal graph, the other is the
  // heading of the panel reporting on the reconciliation process. Same
  // string, two concepts.
  for (const locale of [en, fr]) {
    assert.notEqual(locale.d006d.reconciliationReceipt, locale.d006d.reconciliation,
      "an evidence node and a process heading must not render the same label");
  }
  // The spine node is named like its siblings — by the receipt it is.
  assert.equal(en.d006d.reconciliationReceipt, fr.d006d.reconciliationReceipt,
    "a receipt identifier is not prose and is not translated, exactly like NR-NET-LOST");

  // P2R rebuilt the proof band as a projection of evidence objects, so the
  // hand-written spine label expression this used to inspect is gone: a
  // network record's leaf is now captioned from the evidence itself, like
  // every other leaf. The invariant the test protects is unchanged and is
  // asserted above on the dictionary — an evidence node and a process heading
  // must not render the same string — and below by confirming the panel
  // heading is the only place the process label is used.
  const component = readFileSync(new URL("../app/ConvergenceExperience.tsx", import.meta.url), "utf8");
  const processHeadingUses = [...component.matchAll(/d006d\.reconciliation\b/g)].length;
  assert.equal(processHeadingUses, 1,
    "the reconciliation process heading belongs to the status panel alone");
  const panel = component.slice(component.indexOf("className={`reconciliation-receipt"));
  assert.match(panel.slice(0, 400), /d006d\.reconciliation\b/,
    "and that one use must be the panel heading");
});

// --- archive / pointer plumbing ------------------------------------------

test("D-006E iso: archiving is append-only, idempotent and never deletes", () => {
  const empty = parseRunArchive(null);
  assert.deepEqual(empty.runIds, []);
  const one = archiveRun(empty, RUN_A);
  const twice = archiveRun(one, RUN_A);
  assert.deepEqual(one.runIds, [RUN_A]);
  assert.equal(twice, one, "archiving the same run twice must not grow the archive");
  const two = archiveRun(one, RUN_B);
  assert.deepEqual(two.runIds, [RUN_A, RUN_B]);
  // The archive records ids only — it never carries or replaces the evidence.
  assert.equal(JSON.stringify(two).includes("NETWORK_LINK_LOST"), false);
});

test("D-006E iso: run identities are well-formed, unique and validated", () => {
  assert.ok(isMissionRunId(RUN_A));
  assert.ok(isMissionRunId(RUN_B));
  assert.notEqual(RUN_A, RUN_B);
  assert.equal(isMissionRunId(MISSION_ID), false,
    "the canonical D-005M chain id is not a run id and must never be mistaken for one");
  assert.equal(isMissionRunId("nonsense"), false);
  assert.throws(() => newMissionRunId(Date.now(), "!!!!"), TypeError);
});

test("D-006E iso: a malformed or absent pointer never yields a phantom active run", () => {
  assert.equal(parseRunPointer(null), null);
  assert.equal(parseRunPointer("not json"), null);
  assert.equal(parseRunPointer(JSON.stringify({ version: 1, activeRunId: MISSION_ID, startedAt: "x" })), null,
    "the canonical chain id must not be accepted as an active run pointer");
  const good = parseRunPointer(JSON.stringify({ version: 1, activeRunId: RUN_A, startedAt: "2026-08-24T10:00:00Z" }));
  assert.equal(good?.activeRunId, RUN_A);
});

test("D-006E iso: storage keys are per-run and distinct from the retired shared slot", () => {
  // The old scheme keyed both slots on the canonical chain id, so every
  // demonstration overwrote the last. Those keys are deliberately no longer
  // read — the historical data stays in the browser untouched rather than
  // being cleared, which is isolation rather than deletion.
  assert.equal(runSessionKey(RUN_A).includes(RUN_A), true);
  assert.equal(runSessionKey(RUN_A).includes(MISSION_ID), false);
  assert.notEqual(ACTIVE_RUN_POINTER_KEY, RUN_ARCHIVE_KEY);
});

test("D-006 C1: active-session hydration accepts only v2 canonical mission/run identity", () => {
  const session = createOfflineEvidenceSession(RUN_A);
  const restored = parseRunSession(JSON.stringify(session), RUN_A, MISSION_ID);
  assert.deepEqual(restored, session);
  assert.ok(restored !== null && Object.isFrozen(restored));

  assert.equal(parseRunSession(JSON.stringify({ ...session, version: 1 }), RUN_A, MISSION_ID), null);
  assert.equal(parseRunSession(JSON.stringify({ ...session, networkState: "RESTORED" }), RUN_A, MISSION_ID), null);
  assert.equal(parseRunSession(JSON.stringify(session), RUN_B, MISSION_ID), null);
  assert.equal(parseRunSession(JSON.stringify(session), RUN_A, "forked-mission"), null);
});

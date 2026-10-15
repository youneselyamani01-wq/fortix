import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  PHYSICAL_SENTINEL_SOURCE,
  appendNetworkTransition,
  appendOfflineEvidence,
  capturePreRestorationArtifacts,
  createOfflineEvidenceSession,
  reconcileOfflineEvidence,
  type ArtifactState,
  type JsonValue,
} from "../app/offlineEvidence.ts";
import {
  analyzeInsertedPebOffline,
  compareAfterReconnection,
  insertPebForOfflineAnalysis,
} from "../app/offlineVerification.ts";
import {
  D005M_MASTER_BUNDLE,
  D005M_MASTER_BUNDLE_ID,
  D005M_MASTER_CYCLE_RECEIPT,
  D005M_MASTER_CYCLE_RECEIPT_ID,
} from "../app/masterStory.ts";
import { MISSION_ID } from "../app/missionContinuity.ts";
import { PhysicalNetworkTransitionMachine } from "../app/networkTransitions.ts";
import type { LinkSentinelReport } from "../app/ethernetLink.ts";
import { LOCAL_EVIDENCE_RECORD } from "../app/evidenceContinuity.ts";

const RUN_ID = "fortix.demo.d006d.run.integration";

const ADAPTER = Object.freeze({
  name: "Ethernet",
  description: "Intel(R) Ethernet Controller I226-LM",
  status: "Up",
  mediaConnectionState: "Connected",
  mediaType: "802.3",
  physicalMediaType: "802.3",
  virtual: false,
  ifIndex: 26,
});

function report(link: "CONNECTED" | "LOST", observedAt: string): LinkSentinelReport {
  return {
    sentinel: "OK",
    adapter: {
      ...ADAPTER,
      status: link === "CONNECTED" ? "Up" : "Disconnected",
      mediaConnectionState: link === "CONNECTED" ? "Connected" : "Disconnected",
    },
    link,
    observedAt,
    externalReachability: "NOT_MEASURED",
  };
}

function artifacts(verdict: "VALID" | "INVALID" | "INDETERMINATE" | "REVOKED"): ArtifactState {
  return {
    finalReceipt: {
      ref: D005M_MASTER_CYCLE_RECEIPT_ID,
      value: D005M_MASTER_CYCLE_RECEIPT as unknown as JsonValue,
    },
    portableEvidenceBundle: {
      ref: D005M_MASTER_BUNDLE_ID,
      value: D005M_MASTER_BUNDLE as unknown as JsonValue,
    },
    verdict,
  };
}

test("D-006D integration: physical loss to local verdict to reconciliation is one immutable chain", async () => {
  const machine = new PhysicalNetworkTransitionMachine({ runId: RUN_ID });
  machine.observe(report("CONNECTED", "2026-08-23T12:00:00.000Z"), { evidenceClockMs: 0 });
  machine.observe(report("CONNECTED", "2026-08-23T12:00:00.500Z"), { evidenceClockMs: 0 });
  assert.equal(machine.state, "CONNECTED");

  machine.observe(report("LOST", "2026-08-23T12:00:01.000Z"), { evidenceClockMs: 30_000 });
  const loss = machine.observe(report("LOST", "2026-08-23T12:00:01.500Z"), { evidenceClockMs: 30_000 });
  assert.equal(loss.event?.nanoReceiptType, "NR-NET-LOST");

  let session = createOfflineEvidenceSession(RUN_ID);
  session = appendNetworkTransition(session, {
    runId: RUN_ID,
    observationId: loss.event!.eventId,
    eventId: loss.event!.eventId,
    receiptId: loss.event!.receiptId,
    adapterIdentity: loss.event!.adapterIdentity.description,
    observationSource: PHYSICAL_SENTINEL_SOURCE,
    previousNetworkState: "CONNECTED",
    newNetworkState: "LOST",
    missionClockPosition: 30_000,
  }).session;
  session = appendOfflineEvidence(session, {
    missionId: MISSION_ID,
    runId: RUN_ID,
    eventId: "d006d.offline.customer-dropoff",
    eventType: "CUSTOMER_DROP_OFF",
    receiptId: "NR-OFFLINE-CUSTOMER-DROPOFF",
    missionClockPosition: 36_000,
    executionLocality: "LOCAL",
    payload: { outcome: "COMPLETED", evidence_locality: "LOCAL" },
  }).session;

  const inserted = insertPebForOfflineAnalysis({
    pebText: LOCAL_EVIDENCE_RECORD.bundleText,
    expectedMissionId: MISSION_ID,
    networkPhase: "LOST",
  });
  const localVerdict = await analyzeInsertedPebOffline(inserted);
  assert.equal(localVerdict.networkPhaseAtCapture, "LOST");
  const captured = capturePreRestorationArtifacts(session, {
    ...artifacts(localVerdict.result.verdict),
    missionClockPosition: 120_000,
  });
  session = captured.session;

  machine.observe(report("CONNECTED", "2026-08-23T12:00:02.000Z"), { evidenceClockMs: 120_000 });
  const restored = machine.observe(report("CONNECTED", "2026-08-23T12:00:02.500Z"), { evidenceClockMs: 120_000 });
  assert.equal(restored.event?.nanoReceiptType, "NR-NET-RESTORED");
  session = appendNetworkTransition(session, {
    runId: RUN_ID,
    observationId: restored.event!.eventId,
    eventId: restored.event!.eventId,
    receiptId: restored.event!.receiptId,
    adapterIdentity: restored.event!.adapterIdentity.description,
    observationSource: PHYSICAL_SENTINEL_SOURCE,
    previousNetworkState: "LOST",
    newNetworkState: "CONNECTED",
    missionClockPosition: 120_001,
  }).session;

  const reconciliation = reconcileOfflineEvidence({
    session,
    operation: {
      kind: "BASE_COMPARE_TRANSFER",
      operationId: "d006d.integration.reconciliation",
      baseBefore: { missionId: MISSION_ID, runId: RUN_ID, records: [] },
      baseAfter: { missionId: MISSION_ID, runId: RUN_ID, records: session.records },
      transferredReceiptIds: session.records.map((record) => record.receiptId),
    },
    capture: captured.capture,
    currentArtifacts: artifacts(localVerdict.result.verdict),
    receiptMissionClockPosition: 120_002,
  });
  assert.equal(reconciliation.status, "COMPLETE");
  assert.equal(reconciliation.receipt?.reconciliationResult,
    "BASE_COMPARE_TRANSFER_COMPLETE");
  assert.equal(reconciliation.receipt?.transferredObjectCount, session.records.length);
  assert.equal(reconciliation.receipt?.digestComparison, "MATCH");
  assert.deepEqual(reconciliation.session.records.slice(0, -1), session.records);

  const comparison = compareAfterReconnection(localVerdict, {
    pebText: LOCAL_EVIDENCE_RECORD.bundleText,
    expectedMissionId: MISSION_ID,
    sourceClaimedVerdict: "VALID",
  });
  assert.equal(comparison.missionIdUnchanged, true);
  assert.equal(comparison.finalReceiptDigestUnchanged, true);
  assert.equal(comparison.pebDigestUnchanged, true);
  assert.equal(comparison.causalOrderUnchanged, true);
  assert.equal(comparison.verdictUnchanged, true);
  assert.equal(comparison.sourceClaimedVerdictAccepted, false);

  assert.equal(machine.state, "CONNECTED",
    "restoration settles physical state without a reconciliation acknowledgement alias");
});

test("D-006D integration: the UI has no timeline or browser-network surrogate", async () => {
  const source = await readFile(new URL("../app/ConvergenceExperience.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /navigator\.onLine/);
  assert.doesNotMatch(source, /linkPhaseFrom/);
  assert.match(source, /PhysicalNetworkTransitionMachine/);
  assert.match(source, /appendNetworkEvidenceTransition/);
  assert.match(source, /insertD006PebForAnalysis/);
  assert.match(source, /analyzeInsertedD006Peb/);
  assert.doesNotMatch(source, /acknowledgeReconciliation/);
  assert.match(source, /data-network-receipts/);
});

test("D-006D physical-gate hotfix: sentinel polling uses append-only evidence time", async () => {
  const source = await readFile(new URL("../app/ConvergenceExperience.tsx", import.meta.url), "utf8");
  const pollingEffect = source.slice(
    source.indexOf("const read = async"),
    source.indexOf("const resetHandoff"),
  );
  assert.match(pollingEffect, /prospectiveEvidenceClock/);
  assert.match(pollingEffect, /evidenceClockMs: prospectiveEvidenceClock/);
  assert.doesNotMatch(pollingEffect, /missionClockMs: Math\.round\(masterTimeRef\.current\)/);
  assert.match(pollingEffect, /lastEvidenceClock === undefined[\s\S]*masterTimeRef\.current[\s\S]*lastEvidenceClock \+ 1/);
  assert.doesNotMatch(source, /evidenceCausalClockRef/);
  assert.match(source, /parseRunSession/,
    "active hydration must cross the strict v2 mission/run boundary");
  assert.doesNotMatch(source, /restoredEvidenceClock/,
    "retired snapshots must be rejected rather than upgraded in place");
});

test("D-006D integration: network grammar uses locked form, text, movement and colors", async () => {
  const css = await readFile(new URL("../app/convergence.css", import.meta.url), "utf8");
  const source = await readFile(new URL("../app/ConvergenceExperience.tsx", import.meta.url), "utf8");
  assert.match(css, /--fx-cyan:\s*#00bce2/i);
  assert.match(css, /--fx-orange:\s*#f74902/i);
  assert.match(css, /network-link-glyph/);
  assert.match(css, /network-loss-flash/);
  assert.match(css, /network-restored-pulse/);
  assert.match(source, /data-transition-flash/);
  assert.match(source, /networkStateLabel/);
});

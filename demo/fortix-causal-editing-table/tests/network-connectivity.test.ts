import assert from "node:assert/strict";
import test from "node:test";

import { buildBoundPhysicalReport, type AdapterRecord, type LinkSentinelReport } from "../app/ethernetLink.ts";
import {
  modeledConnectivityObservation,
  physicalConnectivityResolution,
  representativePhysicalReport,
  resolveConnectivity,
  type ConnectivityMedium,
  type ConnectivityObservation,
  type ConnectivityPathState,
} from "../app/networkConnectivity.ts";
import { PHYSICAL_ADAPTER_TARGETS, type PhysicalAdapterKind } from "../app/physicalAdapterBinding.ts";
import {
  ETHERNET_ADAPTER_IDENTITY,
  ETHERNET_PHYSICAL_SENTINEL_SOURCE,
  WIFI_ADAPTER_IDENTITY,
  WIFI_PHYSICAL_SENTINEL_SOURCE,
} from "../app/physicalAdapterPolicy.ts";
import { PhysicalNetworkTransitionMachine } from "../app/networkTransitions.ts";
import {
  appendNetworkTransition,
  appendOfflineEvidence,
  capturePreRestorationArtifacts,
  createOfflineEvidenceSession,
  evidenceState,
  offlineWindowStatus,
  reconcileOfflineEvidence,
  type ArtifactState,
  type JsonValue,
  type OfflineEvidenceSession,
} from "../app/offlineEvidence.ts";
import { admitPhysicalObservation } from "../app/physicalLinkRuntime.ts";
import {
  D005M_MASTER_BUNDLE,
  D005M_MASTER_BUNDLE_ID,
  D005M_MASTER_CYCLE_RECEIPT,
  D005M_MASTER_CYCLE_RECEIPT_ID,
} from "../app/masterStory.ts";
import { MISSION_ID } from "../app/missionContinuity.ts";

const start = Date.parse("2026-10-02T09:00:00.000Z");
const adapter = (kind: PhysicalAdapterKind, connected: boolean): AdapterRecord => {
  const target = PHYSICAL_ADAPTER_TARGETS[kind];
  return {
    name: kind === "ethernet" ? "Ethernet" : "WiFi",
    description: target.description,
    interfaceGuid: target.interfaceGuid,
    status: connected ? "Up" : "Disconnected",
    mediaConnectionState: connected ? "Connected" : "Disconnected",
    mediaType: kind === "ethernet" ? "802.3" : "Native 802.11",
    physicalMediaType: kind === "ethernet" ? "802.3" : "Native 802.11",
    virtual: false,
    ifIndex: kind === "ethernet" ? 23 : 12,
  };
};
const report = (kind: PhysicalAdapterKind, connected: boolean, offset: number): LinkSentinelReport =>
  buildBoundPhysicalReport([adapter(kind, connected)], new Date(start + offset).toISOString(), PHYSICAL_ADAPTER_TARGETS[kind]);
const reports = (ethernet: boolean, wifi: boolean, offset: number) => ({
  ethernet: report("ethernet", ethernet, offset),
  wifi: report("wifi", wifi, offset),
});
const resolvePhysical = (ethernet: boolean, wifi: boolean, offset: number) =>
  physicalConnectivityResolution(reports(ethernet, wifi, offset), start + offset, 10_000, start);

test("automatic RJ45 -> Wi-Fi -> RJ45 switching keeps global CONNECTED and emits no network NR", () => {
  const machine = new PhysicalNetworkTransitionMachine({ runId: "switch-run", initialState: "CONNECTED" });
  const initial = resolvePhysical(true, true, 0);
  assert.equal(initial.state, "CONNECTED");
  assert.equal(initial.activeMedium, "ethernet");
  assert.equal(machine.observe(representativePhysicalReport(initial, null), { evidenceClockMs: 0 }).reason, "STABLE");

  const toWifi = resolvePhysical(false, true, 500);
  assert.equal(toWifi.state, "CONNECTED");
  assert.equal(toWifi.activeMedium, "wifi");
  const wifiResult = machine.observe(representativePhysicalReport(toWifi, "ethernet"), { evidenceClockMs: 1 });
  assert.equal(wifiResult.reason, "STABLE");
  assert.equal(wifiResult.event, null);

  const toEthernet = resolvePhysical(true, true, 1_000);
  assert.equal(toEthernet.state, "CONNECTED");
  assert.equal(toEthernet.activeMedium, "ethernet");
  const ethernetResult = machine.observe(representativePhysicalReport(toEthernet, "wifi"), { evidenceClockMs: 2 });
  assert.equal(ethernetResult.reason, "STABLE");
  assert.equal(ethernetResult.event, null);
});

test("total physical loss emits NR-NET-LOST and a Wi-Fi return emits NR-NET-RESTORED", () => {
  let session = createOfflineEvidenceSession("aggregate-cycle");
  let machine = new PhysicalNetworkTransitionMachine({ runId: session.runId, initialState: "CONNECTED" });
  let previous: ConnectivityMedium | null = "ethernet";
  for (const offset of [500, 1_000]) {
    const resolution = resolvePhysical(false, false, offset);
    assert.equal(resolution.state, "LOST");
    const outcome = admitPhysicalObservation({ session, machine, report: representativePhysicalReport(resolution, previous), nowEpochMs: start + offset, masterTimeMs: offset });
    machine = outcome.machine;
    if (outcome.kind === "TRANSITION") session = outcome.session;
  }
  assert.equal(session.records.at(-1)?.eventType, "NETWORK_LINK_LOST");
  assert.equal(session.records.at(-1)?.payload.adapter_identity, ETHERNET_ADAPTER_IDENTITY);
  assert.equal(session.networkState, "LOST");

  for (const offset of [1_500, 2_000]) {
    const resolution = resolvePhysical(false, true, offset);
    previous = resolution.activeMedium;
    assert.equal(resolution.state, "CONNECTED");
    const outcome = admitPhysicalObservation({ session, machine, report: representativePhysicalReport(resolution, "ethernet"), nowEpochMs: start + offset, masterTimeMs: offset });
    machine = outcome.machine;
    if (outcome.kind === "TRANSITION") session = outcome.session;
  }
  assert.deepEqual(session.records.map((record) => record.eventType), ["NETWORK_LINK_LOST", "NETWORK_LINK_RESTORED"]);
  assert.equal(session.records.at(-1)?.payload.adapter_identity, WIFI_ADAPTER_IDENTITY);
  assert.equal(session.networkState, "CONNECTED");
});

function modeled(medium: ConnectivityMedium, state: ConnectivityPathState): ConnectivityObservation {
  if (medium === "cellular_5g" || medium === "satellite") return modeledConnectivityObservation(medium, state);
  return Object.freeze({ medium, state, validation: "PHYSICAL", report: null });
}

function resolveModeled(states: Readonly<Record<ConnectivityMedium, ConnectivityPathState>>) {
  return resolveConnectivity((Object.entries(states) as [ConnectivityMedium, ConnectivityPathState][])
    .map(([medium, state]) => modeled(medium, state)));
}

test("5G and satellite route changes are supported by logic without a physical-validation claim", () => {
  const unavailablePhysical = { ethernet: "UNAVAILABLE", wifi: "UNAVAILABLE" } as const;
  const scenarios = [
    [{ ...unavailablePhysical, cellular_5g: "CONNECTED", satellite: "UNAVAILABLE" }, "CONNECTED", "cellular_5g"],
    [{ ...unavailablePhysical, cellular_5g: "UNAVAILABLE", satellite: "CONNECTED" }, "CONNECTED", "satellite"],
    [{ ...unavailablePhysical, cellular_5g: "CONNECTED", satellite: "CONNECTED" }, "CONNECTED", "cellular_5g"],
    [{ ...unavailablePhysical, cellular_5g: "LOST", satellite: "LOST" }, "LOST", null],
    [{ ...unavailablePhysical, cellular_5g: "LOST", satellite: "CONNECTED" }, "CONNECTED", "satellite"],
    [{ ...unavailablePhysical, cellular_5g: "CONNECTED", satellite: "LOST" }, "CONNECTED", "cellular_5g"],
  ] as const;
  for (const [states, expectedState, expectedMedium] of scenarios) {
    const resolution = resolveModeled(states);
    assert.equal(resolution.state, expectedState);
    assert.equal(resolution.activeMedium, expectedMedium);
    for (const medium of ["cellular_5g", "satellite"] as const) {
      assert.equal(resolution.observations.find((entry) => entry.medium === medium)?.validation, "SIMULATED");
      assert.equal(resolution.observations.find((entry) => entry.medium === medium)?.report, null);
    }
  }
});

test("an unknown route prevents a false global LOST assertion", () => {
  const resolution = resolveModeled({ ethernet: "LOST", wifi: "UNKNOWN", cellular_5g: "UNAVAILABLE", satellite: "UNAVAILABLE" });
  assert.equal(resolution.state, "UNKNOWN");
  assert.equal(resolution.activeMedium, null);
});

const artifacts: ArtifactState = Object.freeze({
  finalReceipt: Object.freeze({ ref: D005M_MASTER_CYCLE_RECEIPT_ID, value: D005M_MASTER_CYCLE_RECEIPT as unknown as JsonValue }),
  portableEvidenceBundle: Object.freeze({ ref: D005M_MASTER_BUNDLE_ID, value: D005M_MASTER_BUNDLE as unknown as JsonValue }),
  verdict: "INDETERMINATE",
});

function operationFor(session: OfflineEvidenceSession) {
  const restorationIndex = session.records.findLastIndex((record) => record.eventType === "NETWORK_LINK_RESTORED");
  const targetRecords = session.records.slice(0, restorationIndex + 1);
  return Object.freeze({
    kind: "BASE_COMPARE_TRANSFER" as const,
    operationId: `network-connectivity:${targetRecords.at(-1)?.receiptId}`,
    baseBefore: { missionId: session.missionId, runId: session.runId, records: [] },
    baseAfter: { missionId: session.missionId, runId: session.runId, records: targetRecords },
    transferredReceiptIds: targetRecords.map((record) => record.receiptId),
  });
}

test("cross-interface restoration preserves LOCAL evidence then reconciles it exactly once", () => {
  let session = createOfflineEvidenceSession("cross-interface-reconciliation");
  session = appendNetworkTransition(session, {
    runId: session.runId,
    observationId: "ethernet-total-loss",
    adapterIdentity: ETHERNET_ADAPTER_IDENTITY,
    observationSource: ETHERNET_PHYSICAL_SENTINEL_SOURCE,
    previousNetworkState: "CONNECTED",
    newNetworkState: "LOST",
    missionClockPosition: 1,
  }).session;
  session = appendOfflineEvidence(session, {
    missionId: MISSION_ID,
    runId: session.runId,
    eventId: "network-connectivity.local-work",
    eventType: "LOCAL_WORK_CONTINUED",
    receiptId: "NR-LOCAL-WORK-CONTINUED",
    missionClockPosition: 2,
    executionLocality: "LOCAL",
    payload: { result: "COMPLETED" },
  }).session;
  const captured = capturePreRestorationArtifacts(session, { ...artifacts, missionClockPosition: 3 });
  session = appendNetworkTransition(captured.session, {
    runId: captured.session.runId,
    observationId: "wifi-global-restoration",
    adapterIdentity: WIFI_ADAPTER_IDENTITY,
    observationSource: WIFI_PHYSICAL_SENTINEL_SOURCE,
    previousNetworkState: "LOST",
    newNetworkState: "CONNECTED",
    missionClockPosition: 4,
  }).session;
  assert.equal(offlineWindowStatus(session), "AWAITING_RECONCILIATION");
  assert.equal(evidenceState(session), "LOCAL");

  const reconciled = reconcileOfflineEvidence({ session, operation: operationFor(session), capture: captured.capture, currentArtifacts: artifacts });
  assert.equal(reconciled.status, "COMPLETE");
  assert.equal(offlineWindowStatus(reconciled.session), "RECONCILED");
  assert.equal(evidenceState(reconciled.session), "RECONCILED");
  assert.equal(reconciled.session.records.filter((record) => record.eventType === "RECONCILIATION_RECEIPT").length, 1);
});

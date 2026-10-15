import { memoryBaseStore, type BaseStore } from "../../app/baseEvidence.ts";
import { buildBoundPhysicalReport, type AdapterRecord, type LinkSentinelReport } from "../../app/ethernetLink.ts";
import { MISSION_ID } from "../../app/missionContinuity.ts";
import { physicalConnectivityResolution, representativePhysicalReport, type ConnectivityMedium } from "../../app/networkConnectivity.ts";
import { PhysicalNetworkTransitionMachine } from "../../app/networkTransitions.ts";
import { journalAt } from "../../app/nx/adapter/missionJournal.ts";
import { createOfflineEvidenceSession, type OfflineEvidenceSession } from "../../app/offlineEvidence.ts";
import { PHYSICAL_ADAPTER_TARGETS, type PhysicalAdapterKind } from "../../app/physicalAdapterBinding.ts";
import {
  LINK_OBSERVATION_FRESHNESS_MS,
  admitPhysicalObservation,
  performReconciliation,
  type ReconciliationAttempt,
} from "../../app/physicalLinkRuntime.ts";
import {
  buildMissionEvidenceClosure,
  buildPortableMissionEvidenceBundle,
  createHandoffArtifact,
  finalReceiptRuntimeEvidencePrefix,
  issueFinalMissionReceipt,
  type HandoffArtifact,
  type MissionEvidenceClosure,
} from "../../app/portableMissionEvidence.ts";
import { projectPortableProofLeaves } from "../../app/proofProjection.ts";
import { FINAL_RECEIPT_EMITTED_MS, HANDOFF_READY_MS, PEB_COMPLETE_MS } from "../../app/storyTimeline.ts";

/**
 * D-006 in-mission reconciliation — one mission driven exactly as the /nx
 * hook drives it, with no UI and no shortcut:
 *
 *   - the clock projects the journal through `journalAt`;
 *   - the RJ45 and Wi-Fi sentinel reports go through the same aggregate
 *     (`physicalConnectivityResolution` → `representativePhysicalReport`) and
 *     the same `admitPhysicalObservation`, two samples per change (debounce);
 *   - reconciliation is `performReconciliation` on the journal projected to
 *     the moment it runs, and only a COMPLETE result with a receipt is kept.
 *
 * It is a helper, not a test file, so importing it registers no tests.
 */

const WALL_START = Date.parse("2026-10-08T09:00:00.000Z");

function adapter(kind: PhysicalAdapterKind, connected: boolean): AdapterRecord {
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
}

function report(kind: PhysicalAdapterKind, connected: boolean, wallMs: number): LinkSentinelReport {
  return buildBoundPhysicalReport([adapter(kind, connected)], new Date(wallMs).toISOString(), PHYSICAL_ADAPTER_TARGETS[kind]);
}

export type RouteChange = Readonly<{ transitions: readonly ("LOST" | "RESTORED")[]; state: string }>;

export class InMissionRun {
  readonly runId: string;
  session: OfflineEvidenceSession;
  machine: PhysicalNetworkTransitionMachine;
  masterTimeMs: number;
  private wallMs = WALL_START;
  private previousMedium: ConnectivityMedium | null = null;

  constructor(runId: string, masterTimeMs = 0) {
    this.runId = runId;
    this.masterTimeMs = masterTimeMs;
    this.session = journalAt(createOfflineEvidenceSession(runId, null, MISSION_ID), masterTimeMs);
    this.machine = new PhysicalNetworkTransitionMachine({ runId, initialState: this.session.networkState });
  }

  /** The clock reaches `masterTimeMs`: the journal projects what is due. */
  at(masterTimeMs: number): this {
    this.masterTimeMs = masterTimeMs;
    this.session = journalAt(this.session, masterTimeMs);
    return this;
  }

  /** Two consecutive sentinel samples of these routes at this mission moment. */
  routes(ethernet: boolean, wifi: boolean, masterTimeMs = this.masterTimeMs): RouteChange {
    this.masterTimeMs = masterTimeMs;
    const transitions: ("LOST" | "RESTORED")[] = [];
    let state = "UNKNOWN";
    for (let sample = 0; sample < 2; sample += 1) {
      this.wallMs += 500;
      const now = this.wallMs + 50;
      const resolution = physicalConnectivityResolution(
        { ethernet: report("ethernet", ethernet, this.wallMs), wifi: report("wifi", wifi, this.wallMs) },
        now,
        LINK_OBSERVATION_FRESHNESS_MS,
        WALL_START,
      );
      state = resolution.state;
      const outcome = admitPhysicalObservation({
        session: journalAt(this.session, masterTimeMs),
        machine: this.machine,
        report: representativePhysicalReport(resolution, this.previousMedium),
        nowEpochMs: now,
        masterTimeMs,
      });
      if (resolution.state === "CONNECTED") this.previousMedium = resolution.activeMedium;
      this.machine = outcome.machine;
      if (outcome.kind === "TRANSITION") {
        this.session = outcome.session;
        transitions.push(outcome.transition);
      } else {
        this.session = journalAt(this.session, masterTimeMs);
      }
    }
    return { transitions, state };
  }

  /** The hook's reconciliation step: project, perform, keep only a COMPLETE receipt. */
  reconcile(baseStore: BaseStore = memoryBaseStore(this.runId), masterTimeMs = this.masterTimeMs): ReconciliationAttempt {
    this.masterTimeMs = masterTimeMs;
    const attempt = performReconciliation({
      session: journalAt(this.session, masterTimeMs),
      baseStore,
      artifacts: null,
      masterTimeMs,
    });
    if (attempt.result.status === "COMPLETE" && attempt.result.receipt !== null) this.session = attempt.result.session;
    return attempt;
  }
}

export type MissionArtifacts = Readonly<{ closure: MissionEvidenceClosure; handoff: HandoffArtifact }>;

/** The engine's closure, Final Receipt, PEB and handoff artifact for a sealed journal. */
export function artifactsOf(session: OfflineEvidenceSession): MissionArtifacts {
  const records = finalReceiptRuntimeEvidencePrefix(session);
  const closure = buildMissionEvidenceClosure({ identity: { missionId: session.missionId, runId: session.runId }, runtimeRecords: records, asOfMasterTimeMs: FINAL_RECEIPT_EMITTED_MS });
  const finalReceipt = issueFinalMissionReceipt(closure, FINAL_RECEIPT_EMITTED_MS);
  const displayed = projectPortableProofLeaves(closure, PEB_COMPLETE_MS, finalReceipt).map((leaf) => leaf.evidenceId);
  const peb = buildPortableMissionEvidenceBundle({ closure, finalReceipt, runtimeRecords: records, displayedEvidenceIds: displayed, masterTimeMs: PEB_COMPLETE_MS });
  return { closure, handoff: createHandoffArtifact(peb, HANDOFF_READY_MS) };
}

import type { BaseCompareTransferOutcome } from "../../baseEvidence.ts";
import type { EthernetLinkState } from "../../ethernetLink.ts";
import type { NetworkTransitionState } from "../../networkTransitions.ts";
import type {
  OfflineEvidenceSession,
  ReconciliationResult,
} from "../../offlineEvidence.ts";
import type { CycleVerificationResult } from "../../operationalCycle.ts";
import type { PassengerPresentation } from "../../passengerPresentation.ts";
import type { PhysicalState } from "../../physicalState.ts";
import type {
  FinalMissionReceipt,
  HandoffArtifact,
  MissionEvidenceClosure,
  PortableMissionEvidenceBundle,
} from "../../portableMissionEvidence.ts";
import type { ReceiptBinding } from "../../receiptProjection.ts";
import type { HumanDecision, TransferStage } from "../../reviewFlow.ts";
import type { DerivedRoutingState } from "../../routingProvenance.ts";
import type { VehiclePresentationMotion } from "../../vehiclePresentation.ts";

/**
 * D-006 NX1 — the canonical engine state the public experience may read.
 *
 * This is the whole input of the PUBLIC EXPERIENCE ADAPTER. Every field is
 * produced by an existing engine module (journal, closure, physical state,
 * motion model, network machine, reconciliation, handoff, verifier); nothing
 * here is authored for the screen. The adapter derives a public model from
 * it and can do nothing else — it has no setters, no clock, no network, no
 * authority — so the frontend consumes the engine and cannot fork its truth.
 */
export type EngineSnapshot = Readonly<{
  /** The playhead, including post-roll. */
  masterTimeMs: number;
  /** Causally gated story time (never ahead of admissible evidence). */
  effectiveStoryTimeMs: number;
  playing: boolean;
  /** The append-only run journal. */
  session: OfflineEvidenceSession;
  /** The deterministic evidence closure, or null with the refusal reason. */
  closure: MissionEvidenceClosure | null;
  closureReason: string | null;
  receiptBindings: readonly ReceiptBinding[];
  finalReceipt: FinalMissionReceipt | null;
  humanDecision: HumanDecision;
  /** The physical network machine's admitted state. Never inferred. */
  networkState: NetworkTransitionState;
  linkObservationCurrent: boolean;
  /**
   * What a spectator may be told about the cable: the sentinel's fresh
   * observation when it agrees with the admitted state, else UNKNOWN.
   */
  linkPhase: EthernetLinkState;
  /** Whether the loopback sentinel answered at all (never a connectivity claim). */
  sentinelReachable: boolean;
  /** The transition mark just after an admitted LOST / RESTORED, briefly. */
  transitionFlash: "LOST" | "RESTORED" | null;
  /** A physical observation the journal's grammar refused, as `<reason>:<eventId>`. */
  unsequencedObservation: string | null;
  reconciliation: ReconciliationResult | null;
  baseTransfer: BaseCompareTransferOutcome | null;
  /**
   * The same-origin identity acknowledgement phase (never proof of transfer).
   * RECONCILED: the reconciliation completed without a successful
   * acknowledgement — always so in mission, where no Final Receipt or PEB
   * exists to acknowledge, and after completion when the acknowledgement
   * failed. ACKNOWLEDGED only when the acknowledgement itself succeeded.
   */
  syncPhase: "IDLE" | "LOCAL" | "READY" | "ACKNOWLEDGING" | "ACKNOWLEDGED" | "RECONCILED" | "FAILED";
  portablePeb: PortableMissionEvidenceBundle | null;
  handoffArtifact: HandoffArtifact | null;
  transferStage: TransferStage;
  analysisRequested: boolean;
  verification: CycleVerificationResult | null;
  /** The admitted network state at the moment the verifier received the artifact, when known. */
  handoffNetworkState: NetworkTransitionState | null;
  /** The admitted network state at the moment the verdict arrived, when known. */
  verdictNetworkState: NetworkTransitionState | null;
  physical: PhysicalState;
  motion: VehiclePresentationMotion;
  passenger: PassengerPresentation;
  routing: DerivedRoutingState;
}>;

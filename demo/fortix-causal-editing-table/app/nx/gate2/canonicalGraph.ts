import { blake3 } from "@noble/hashes/blake3.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

import { MISSION_ID } from "../../missionContinuity.ts";
import type { EngineSnapshot } from "../adapter/engineSnapshot.ts";
import type { ActionFamily } from "../adapter/actionFamily.ts";
import type { EvidenceEpisode } from "../adapter/evidenceEpisode.ts";
import type { ReadingOrdinal } from "../adapter/readingOrder.ts";
import { derivePublicExperience, type EvidenceAssurance, type EvidenceFamily, type EvidenceStanding, type ProvenanceLane } from "../adapter/publicExperienceAdapter.ts";
// Straight from the journal module, not through `useMissionEngine.ts`: that
// one is "use client", and this graph is built on the server.
import { journalAt } from "../adapter/missionJournal.ts";
import { createOfflineEvidenceSession } from "../../offlineEvidence.ts";
import { derivePassengerPresentation } from "../../passengerPresentation.ts";
import { derivePhysicalState } from "../../physicalState.ts";
import { buildMissionEvidenceClosure, finalReceiptRuntimeEvidencePrefix, issueFinalMissionReceipt } from "../../portableMissionEvidence.ts";
import { projectReceiptBindings } from "../../receiptProjection.ts";
import { CANONICAL_ROUTING_PROVENANCE, deriveRoutingState } from "../../routingProvenance.ts";
import { EXPERIENCE_DURATION_MS, FINAL_RECEIPT_EMITTED_MS } from "../../storyTimeline.ts";
import { derivePresentationMotion } from "../../vehiclePresentation.ts";
import { VISUAL_EVENTS } from "../../visualEvents.ts";

/**
 * D-006/NX GATE 2 — THE ONE CANONICAL LAYER (mandate §2, §17).
 *
 * Every representation variant (A, B, C, D) reads the graph from HERE and from
 * nowhere else. That is the mandate's structural guarantee: variants may lay
 * the same facts out differently, but they cannot disagree about what the facts
 * ARE, because there is only one place the facts come from.
 *
 *   RECEIPTS   the 58 sealed nano-receipts, with only canonical attributes
 *              carried forward — no presentation state, no pacing, no
 *              animation phase. A layout must not be able to read how a
 *              receipt was ANIMATED and mistake it for what the receipt SAYS.
 *
 *   EDGES      one per declared relation whose both ends are present, keyed by
 *              `parent->child` so a pair declared under both `causalParents`
 *              and `observedInputs` yields exactly one edge — the same rule
 *              Gate 1 audited and proved.
 *
 * THE ORDINAL IS CARRIED, NOT OBEYED. `ordinal` travels with each receipt
 * because a human needs a handle to speak with ("NR 33"), and §16 requires it
 * be displayed. It is not signed data and it is never an input to causality.
 * A variant that derives an edge from it violates §18 and is caught by test.
 *
 * THE DIGEST is the enforcement mechanism for §2's "absolute data invariant":
 * it is computed over the receipt identities and the edge set only. Every
 * variant test asserts the graph it consumed carries this digest, so a variant
 * that quietly drops a receipt to improve its composition changes the digest
 * and fails — it cannot pass by looking better.
 */

export type CanonicalReceipt = Readonly<{
  /** The real identity of the object. This — not the ordinal — is the receipt. */
  evidenceId: string;
  /** A human reading handle only (§3, §16). Never an input to any edge. */
  ordinal: ReadingOrdinal;
  lane: ProvenanceLane;
  domain: string;
  family: EvidenceFamily;
  actionFamily: ActionFamily;
  episode: EvidenceEpisode;
  standing: EvidenceStanding;
  assurance: EvidenceAssurance;
  evidenceLocality: "LOCAL" | "RECONCILED";
  source: string;
  eventId: string;
  eventType: string;
  timeMs: number;
  admissionIndex: number;
  causalParents: readonly string[];
  observedInputs: readonly string[];
}>;

export type CanonicalEdge = Readonly<{
  parent: string;
  child: string;
  kind: "cause" | "observed";
  crossLane: boolean;
}>;

export type CanonicalFinalReceipt = Readonly<{
  receiptId: string;
  timeMs: number;
  causalInputEvidenceIds: readonly string[];
}>;

export type CanonicalGraph = Readonly<{
  receipts: readonly CanonicalReceipt[];
  edges: readonly CanonicalEdge[];
  /** Lanes actually fed by this mission, in canonical left-to-right order. */
  lanes: readonly ProvenanceLane[];
  finalReceipt: CanonicalFinalReceipt;
  /** Stable hash over receipt identities and the edge set (§2 invariant). */
  digest: string;
}>;

const RUN_ID = "fortix.demo.d006nx2.gate2.canonical";

/**
 * Build the sealed mission once. The construction mirrors the Gate 1 audit
 * exactly, at the same instant, so the Gate 2 dataset IS the audited dataset.
 */
function buildCanonicalGraph(): CanonicalGraph {
  const session = journalAt(createOfflineEvidenceSession(RUN_ID, null, MISSION_ID), FINAL_RECEIPT_EMITTED_MS);
  const closure = buildMissionEvidenceClosure({
    identity: { missionId: MISSION_ID, runId: RUN_ID },
    runtimeRecords: finalReceiptRuntimeEvidencePrefix(session),
    asOfMasterTimeMs: FINAL_RECEIPT_EMITTED_MS,
  });
  const finalReceipt = issueFinalMissionReceipt(closure, FINAL_RECEIPT_EMITTED_MS);
  const t = EXPERIENCE_DURATION_MS;
  const physical = derivePhysicalState(t, true);
  const snapshot: EngineSnapshot = {
    masterTimeMs: t, effectiveStoryTimeMs: t, playing: false, session: journalAt(session, t), closure, closureReason: null,
    receiptBindings: projectReceiptBindings(closure, VISUAL_EVENTS), finalReceipt, humanDecision: "APPROVED",
    networkState: "UNKNOWN", linkObservationCurrent: false, linkPhase: "UNKNOWN", sentinelReachable: false, transitionFlash: null,
    unsequencedObservation: null, reconciliation: null, baseTransfer: null, syncPhase: "IDLE", portablePeb: null, handoffArtifact: null,
    transferStage: "SOURCE", analysisRequested: false, verification: null, handoffNetworkState: null, verdictNetworkState: null,
    physical, motion: derivePresentationMotion(t, true), passenger: derivePassengerPresentation(t, physical.passengerState),
    routing: deriveRoutingState(t, CANONICAL_ROUTING_PROVENANCE),
  };

  const model = derivePublicExperience(snapshot);
  const items = model.accumulatedEvidence.items;
  const present = new Set(items.map((entry) => entry.evidenceId));

  const receipts: CanonicalReceipt[] = items.map((entry) => Object.freeze({
    evidenceId: entry.evidenceId,
    ordinal: entry.ordinal,
    lane: entry.branch,
    domain: entry.domain,
    family: entry.family,
    actionFamily: entry.actionFamily,
    episode: entry.episode,
    standing: entry.standing,
    assurance: entry.assurance,
    evidenceLocality: entry.evidenceLocality,
    source: String(entry.source),
    eventId: entry.eventId,
    eventType: entry.eventType,
    timeMs: entry.timeMs,
    admissionIndex: entry.admissionIndex,
    causalParents: Object.freeze([...entry.causalParents]),
    observedInputs: Object.freeze([...entry.observedInputs]),
  }));

  // One edge per declared pair — the Gate 1 rule, restated here rather than
  // imported, so the Gate 2 dataset does not inherit a geometry module's view
  // of what a relation is.
  const laneOf = new Map(receipts.map((entry) => [entry.evidenceId, entry.lane] as const));
  const seen = new Set<string>();
  const edges: CanonicalEdge[] = [];
  for (const entry of receipts) {
    const declared: readonly (readonly [readonly string[], CanonicalEdge["kind"]])[] = [
      [entry.causalParents, "cause"],
      [entry.observedInputs, "observed"],
    ];
    for (const [ids, kind] of declared) {
      for (const parent of ids) {
        if (!present.has(parent) || parent === entry.evidenceId) continue;
        const key = `${parent}->${entry.evidenceId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push(Object.freeze({
          parent, child: entry.evidenceId, kind,
          crossLane: laneOf.get(parent) !== entry.lane,
        }));
      }
    }
  }

  const lanes = model.accumulatedEvidence.branches;

  // The digest covers WHAT the graph is (identities and relations), not how any
  // variant chooses to draw it. Sorted so it cannot depend on iteration order.
  const digest = bytesToHex(blake3(utf8ToBytes(JSON.stringify({
    receipts: [...receipts.map((entry) => entry.evidenceId)].sort(),
    edges: [...edges.map((edge) => `${edge.kind}:${edge.parent}->${edge.child}`)].sort(),
    finalReceipt: [...finalReceipt.causalInputEvidenceIds].sort(),
  }))));

  return Object.freeze({
    receipts: Object.freeze(receipts),
    edges: Object.freeze(edges),
    lanes: Object.freeze([...lanes]),
    finalReceipt: Object.freeze({
      receiptId: finalReceipt.receiptId,
      // The Final Receipt names this `issuedAtMasterTimeMs`, not `timeMs`. An
      // earlier draft read the wrong field: `node --experimental-strip-types`
      // erases types rather than checking them, so it silently yielded
      // `undefined` behind a `number`. Only `tsc` caught it.
      timeMs: finalReceipt.issuedAtMasterTimeMs,
      causalInputEvidenceIds: Object.freeze([...finalReceipt.causalInputEvidenceIds]),
    }),
    digest,
  });
}

let cached: CanonicalGraph | null = null;

/** The single canonical graph every Gate 2 variant reads. Built once. */
export function canonicalGraph(): CanonicalGraph {
  cached ??= buildCanonicalGraph();
  return cached;
}

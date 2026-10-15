import masterBranchFixture from "../data/d005m-master-evidence-branch.json" with { type: "json" };
import cycleBundleFixture from "../data/d005-portable-evidence-bundle.json" with { type: "json" };

import { MASTER_EVIDENCE_EVENTS } from "./masterStory.ts";
import type { OfflineCausalRecord } from "./offlineEvidence.ts";
import {
  finalReceiptMember,
  type EvidenceMemberRef,
  type FinalMissionReceipt,
  type MissionEvidenceClosure,
} from "./portableMissionEvidence.ts";
import type { Branch } from "./visualEvents.ts";

/**
 * D-006G P2R — the Proof Tree as a projection of real evidence.
 *
 * THE BLOCKER. The tree rendered `VISUAL_EVENTS`: a hand-authored presentation
 * table. Its leaves carried actor names, receipt captions and timings chosen
 * for the screen, and a leaf could exist with no evidence object behind it at
 * all. A viewer counting leaves was counting design decisions.
 *
 * THE INVARIANT. NO EVIDENCE OBJECT -> NO PROOF TREE LEAF. A leaf cannot be
 * constructed here without an evidence identity and the digest that identity
 * is derived from, and a causal edge cannot be drawn unless the evidence
 * itself declares it. The Master Clock may hide a leaf whose moment has not
 * arrived; it may never create one.
 *
 * TWO EVIDENCE SOURCES, both real, kept distinguishable:
 *
 *   SIGNED_BUNDLE    the 36 canonical D-005M events. `evidence_id` is
 *                    `blake3(canonical(object))`, so identity and digest are
 *                    the same value, and `causal_parent_ids` are declared by
 *                    the evidence.
 *   RUNTIME_JOURNAL  the append-only records this run authored. Identity is
 *                    `receiptId`, digest is `canonicalDigest`, and causation
 *                    is the payload's `caused_by` — never the append order,
 *                    which is sequence and not cause.
 *
 * The reality band above the tree is still a dramatisation, and is meant to
 * be: a drawing of a taxi is not evidence. This module governs the PROOF band,
 * where every mark must be answerable.
 */

export type ProofLeafSource = "SIGNED_BUNDLE" | "RUNTIME_JOURNAL" | "D006_FINAL_RECEIPT";
export type ProofLeafAssurance = "ELIGIBLE" | "QUARANTINED" | "UNASSESSED";

export type ProofLeaf = Readonly<{
  /** Stable per-leaf key. Always derived from the evidence identity. */
  leafId: string;
  /** The evidence object's own identity. Never synthesised. */
  evidenceId: string;
  /** The digest that identity rests on. Never synthesised. */
  digest: string;
  timeMs: number;
  branch: Branch;
  /** Human label, taken from the evidence's own system/event naming. */
  label: string;
  /** The domain that authored it, as the evidence states it. */
  domain: string;
  /** Evidence-declared causal parents, as evidence identities. */
  causalParents: readonly string[];
  /** Cross-domain artifacts this evidence observed, never causal commands. */
  observedInputs: readonly string[];
  /** Whether this exact evidence may support closure in the active profile. */
  assurance: ProofLeafAssurance;
  source: ProofLeafSource;
}>;

/**
 * Which lane a signed event belongs to, from the `system` the evidence itself
 * names. Presentation never chooses this.
 */
const SYSTEM_BRANCH: Readonly<Record<string, Branch>> = {
  "Passenger service": "mission",
  "FortiX causal compiler": "mission",
  "Taxi autonomy": "vehicle",
  "Traffic Provider": "city",
  "Navigation Provider A": "route",
  "Navigation Provider B": "route",
  "Fleet operations": "service",
  "Garage": "service",
  "Maintenance system": "service",
  "Payment policy": "authority",
  "Human approver": "authority",
  "Authority governance": "authority",
  "Manager workflow": "authority",
  "Payment Provider": "authority",
};

/** Which lane a runtime record belongs to, from its declared trust domain. */
const DOMAIN_BRANCH: Readonly<Record<string, Branch>> = {
  SMART_CITY_INFRASTRUCTURE: "city",
  AUTONOMOUS_VEHICLE: "vehicle",
  ROUTING_ORCHESTRATOR: "route",
  PAYMENT_PROVIDER: "authority",
  FINANCIAL_INSTITUTION: "bank",
  HUMAN_APPROVER: "authority",
};

/**
 * Which lane a signed object belongs to when its payload names no participant
 * system and the closure therefore records its signed ISSUER as the producer
 * (`canonicalProducerDomain`). Two issuers exist in the canonical D-005M
 * bundle: the manager-authority issuer of the payment-authority object, and
 * the causal compiler that issues compiled sub-mission receipts. The issuer
 * identity is signed evidence; the lane follows it, exactly as the receipt
 * family table already does for the same two identities.
 */
const ISSUER_BRANCH: Readonly<Record<string, Branch>> = {
  "fortix.demo.manager-authority.d005m": "authority",
  "fortix.demo.causal-compiler.d005m": "mission",
};

/**
 * The lane the engine's tables name for a producer, or null when no table
 * names it. Unlike `branchForMember` this never defaults: a consumer that
 * must not invent provenance (NX1) reads this and reports an unresolved lane.
 */
export function laneForProducer(producerDomain: string): Branch | null {
  if (producerDomain === "NETWORK") return "network";
  return SYSTEM_BRANCH[producerDomain]
    ?? DOMAIN_BRANCH[producerDomain]
    ?? ISSUER_BRANCH[producerDomain]
    ?? null;
}

/** Network and reconciliation records form their own lane. */
const NETWORK_EVENT_TYPES = new Set([
  "NETWORK_LINK_LOST",
  "NETWORK_LINK_RESTORED",
  "RECONCILIATION_RECEIPT",
  "MISSION_COMPLETED_OFFLINE",
]);

function readPayloadString(record: OfflineCausalRecord, key: string): string | null {
  const payload = record.payload as unknown as Record<string, unknown> | undefined;
  const value = payload?.[key];
  return typeof value === "string" ? value : null;
}

/**
 * When a record HAPPENED, as opposed to where it sits in the journal.
 *
 * The journal's `missionClockPosition` must strictly increase, so a physical
 * observation made while the clock is paused is filed one millisecond past it.
 * Filtering the view by that position hid real evidence the instant it was
 * created: pull the cable at 30_000 and NR-NET-LOST is filed at 30_001, which
 * the Proof Tree then treats as the future. Physical records therefore carry
 * the moment they were observed, and the view uses that.
 */
function observedTimeOf(record: OfflineCausalRecord): number {
  const payload = record.payload as unknown as Record<string, unknown> | undefined;
  const observed = payload?.observed_master_time_ms;
  return typeof observed === "number" && Number.isFinite(observed)
    ? observed
    : record.missionClockPosition;
}

/**
 * An evidence identity, in the only form this profile issues them.
 *
 * Anything that does not match is not an identity, and a reference that is not
 * an identity cannot be resolved to an evidence object — so it cannot support
 * a causal edge, whatever it is named.
 */
const EVIDENCE_IDENTITY = /^fortix:evidence:blake3:[0-9a-f]{64}$/;

/**
 * D-006G P3-C — causal parents read from the SIGNED OBJECTS.
 *
 * THE DEFECT. The historical D-005 leaves took their parents from
 * `data/d005-operational-cycle.json`, a presentation model, which declares them
 * in a short-id vocabulary of its own (`["passenger-request"]`). Those strings
 * are not evidence identities and resolve to nothing, so twenty leaves silently
 * had no drawable causality at all — and had they resolved, the tree would have
 * been drawing lines a design file asserted. That is the same defect P2R
 * removed from the leaves, surviving one layer down in the edges.
 *
 * The signed objects declare the relation themselves, in
 * `causal_links.predecessor_evidence_id`, by evidence identity. That is the
 * only source read here. The presentation model's field is deliberately not
 * consulted, and every reference is checked against the identity grammar before
 * it is believed.
 */
function signedCausalParents(): ReadonlyMap<string, readonly string[]> {
  const parents = new Map<string, readonly string[]>();
  const collect = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) collect(item);
      return;
    }
    if (node === null || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    const evidenceId = record.evidence_id;
    const links = record.causal_links;
    if (typeof evidenceId === "string" && links !== null && typeof links === "object") {
      const declared = links as Record<string, unknown>;
      const found = new Set<string>();
      const single = declared.predecessor_evidence_id;
      if (typeof single === "string") found.add(single);
      for (const key of ["predecessor_evidence_ids", "causal_parent_evidence_ids", "causal_input_evidence_ids"]) {
        const many = declared[key];
        if (!Array.isArray(many)) continue;
        for (const value of many) if (typeof value === "string") found.add(value);
      }
      const identities = [...found].filter((value) => EVIDENCE_IDENTITY.test(value));
      if (identities.length > 0) {
        parents.set(evidenceId, Object.freeze([...(parents.get(evidenceId) ?? []), ...identities]));
      }
    }
    for (const value of Object.values(record)) collect(value);
  };
  collect(cycleBundleFixture);
  collect(masterBranchFixture);
  return parents;
}

const SIGNED_CAUSAL_PARENTS = signedCausalParents();

/**
 * Leaves from the signed bundle. Every one carries the evidence identity the
 * bundle itself declares, and the causal parents the evidence declares.
 */
export function signedProofLeaves(): readonly ProofLeaf[] {
  const leaves: ProofLeaf[] = [];
  for (const event of MASTER_EVIDENCE_EVENTS) {
    const evidenceId = typeof event.evidence_id === "string" ? event.evidence_id : "";
    // The invariant, enforced rather than assumed: no identity, no leaf.
    if (evidenceId.length === 0) continue;
    const branch = SYSTEM_BRANCH[event.system];
    if (branch === undefined) continue;
    leaves.push(Object.freeze({
      leafId: `signed:${event.event_id}`,
      evidenceId,
      // For this profile the identity IS the digest of the object's content.
      digest: evidenceId.split(":").pop() ?? "",
      timeMs: event.time_ms,
      branch,
      label: event.label_en.length > 0 ? event.label_en : event.event_id,
      domain: event.system,
      causalParents: Object.freeze([...new Set([
        ...(SIGNED_CAUSAL_PARENTS.get(evidenceId) ?? []),
        // The D-005M payload route, which already speaks in identities.
        ...(event.causal_parent_ids ?? []).filter((parent) => EVIDENCE_IDENTITY.test(parent)),
      ])]),
      observedInputs: Object.freeze([]),
      // This compatibility projection does not build the C1 assurance
      // closure. It must not silently promote every signed claim to eligible.
      assurance: "UNASSESSED",
      source: "SIGNED_BUNDLE",
    }));
  }
  return Object.freeze(leaves);
}

/**
 * Leaves from the runtime journal. Causation comes from the payload's
 * `caused_by`, never from `causalPredecessors` — that field is assigned by
 * append order, and two independent trust domains share this journal, so
 * sequence there says nothing about cause.
 */
export function runtimeProofLeaves(
  records: readonly OfflineCausalRecord[],
): readonly ProofLeaf[] {
  const leaves: ProofLeaf[] = [];
  for (const record of records) {
    if (record.receiptId.length === 0 || record.canonicalDigest.length === 0) continue;
    const domain = readPayloadString(record, "trust_domain");
    const branch = NETWORK_EVENT_TYPES.has(record.eventType)
      ? "network"
      : domain === null ? null : DOMAIN_BRANCH[domain] ?? null;
    if (branch === null) continue;
    const causedBy = readPayloadString(record, "caused_by");
    const observedInput = readPayloadString(record, "observed_input");
    leaves.push(Object.freeze({
      leafId: `runtime:${record.eventId}`,
      evidenceId: record.receiptId,
      digest: record.canonicalDigest,
      timeMs: observedTimeOf(record),
      branch,
      label: record.eventType.replace(/_/g, " ").toLowerCase(),
      domain: domain ?? "NETWORK",
      causalParents: causedBy === null ? Object.freeze([]) : Object.freeze([causedBy]),
      observedInputs: observedInput === null ? Object.freeze([]) : Object.freeze([observedInput]),
      // Runtime records only acquire assurance after the portable closure has
      // validated their profile and propagated claim-scoped quarantine.
      assurance: "UNASSESSED",
      source: "RUNTIME_JOURNAL",
    }));
  }
  return Object.freeze(leaves);
}

/**
 * Every leaf the tree may draw at this point on the Master Clock.
 *
 * The clock FILTERS by timestamp and does nothing else. It cannot mint a leaf,
 * and rewinding removes future leaves for the same reason it never created
 * them: visibility is a function of evidence plus time, in that order.
 */
export function projectProofLeaves(
  records: readonly OfflineCausalRecord[],
  masterTimeMs: number,
): readonly ProofLeaf[] {
  const all = [...signedProofLeaves(), ...runtimeProofLeaves(records)];
  return Object.freeze(
    all
      .filter((leaf) => leaf.timeMs <= masterTimeMs)
      .sort((left, right) => left.timeMs - right.timeMs || left.leafId.localeCompare(right.leafId)),
  );
}

/**
 * C1 authoritative projection. The wrapper PEB and Proof Tree consume the
 * same MissionEvidenceClosure, so a displayed leaf cannot silently disappear
 * at handoff. The older record-array projection remains for the immutable
 * D-005 regression surface only.
 */
export function projectPortableProofLeaves(
  closure: MissionEvidenceClosure,
  masterTimeMs: number,
  finalReceipt: FinalMissionReceipt | null = null,
): readonly ProofLeaf[] {
  const members = [
    ...closure.members.filter((member) => member.presentation === "PRESENTED"),
    ...(finalReceipt === null ? [] : [finalReceiptMember(finalReceipt)]),
  ];
  return Object.freeze(
    members
      .filter((member) => member.timeMs <= masterTimeMs)
      .map(proofLeafFromMember)
      .sort((left, right) => left.timeMs - right.timeMs || left.leafId.localeCompare(right.leafId)),
  );
}

function proofLeafFromMember(member: EvidenceMemberRef): ProofLeaf {
  return Object.freeze({
    leafId: member.source === "SIGNED_CANONICAL"
      ? `signed:${member.eventId}`
      : member.source === "D006_FINAL_RECEIPT"
        ? `final:${member.eventId}`
        : `runtime:${member.eventId}`,
    evidenceId: member.evidenceId,
    digest: member.digest,
    timeMs: member.timeMs,
    branch: branchForMember(member),
    label: member.eventId,
    domain: member.producerDomain,
    causalParents: member.causalParents,
    observedInputs: member.observedInputs,
    assurance: member.assurance,
    source: member.source === "SIGNED_CANONICAL"
      ? "SIGNED_BUNDLE"
      : member.source === "D006_FINAL_RECEIPT"
        ? "D006_FINAL_RECEIPT"
        : "RUNTIME_JOURNAL",
  });
}

function branchForMember(member: EvidenceMemberRef): Branch {
  if (member.source === "D006_FINAL_RECEIPT") return "mission";
  return laneForProducer(member.producerDomain) ?? "mission";
}

/**
 * Causal edges the evidence declares, restricted to pairs where BOTH ends are
 * present as leaves.
 *
 * An edge to something not in the tree is not drawn: a line to nowhere invites
 * the viewer to infer a node that no evidence supports, which is the same
 * defect as a leaf with no evidence behind it.
 */
export function projectCausalEdges(
  leaves: readonly ProofLeaf[],
): readonly Readonly<{ from: string; to: string; relation: "CAUSAL" | "OBSERVED_INPUT" }>[] {
  const byEvidenceId = new Map(leaves.map((leaf) => [leaf.evidenceId, leaf]));
  const edges: { from: string; to: string; relation: "CAUSAL" | "OBSERVED_INPUT" }[] = [];
  for (const leaf of leaves) {
    for (const parent of leaf.causalParents) {
      const source = byEvidenceId.get(parent);
      if (source === undefined) continue;
      edges.push({ from: source.leafId, to: leaf.leafId, relation: "CAUSAL" });
    }
    for (const input of leaf.observedInputs) {
      const source = byEvidenceId.get(input);
      if (source === undefined) continue;
      edges.push({ from: source.leafId, to: leaf.leafId, relation: "OBSERVED_INPUT" });
    }
  }
  return Object.freeze(edges);
}

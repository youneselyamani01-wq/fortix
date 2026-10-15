import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { MASTER_EVIDENCE_EVENTS } from "../app/masterStory.ts";
import {
  PHYSICAL_SENTINEL_SOURCE,
  TARGET_ADAPTER_IDENTITY,
  appendNetworkTransition,
  createOfflineEvidenceSession,
} from "../app/offlineEvidence.ts";
import { projectMissionEvidence } from "../app/missionEvidence.ts";
import {
  projectCausalEdges,
  projectProofLeaves,
  runtimeProofLeaves,
  signedProofLeaves,
} from "../app/proofProjection.ts";

/**
 * D-006G P2R-3 — the Proof Tree is a projection of real evidence.
 *
 * The Codex blocker: the tree rendered a hand-authored presentation table, so
 * a leaf could exist with no evidence object behind it and a causal edge could
 * be drawn because two things happened near each other. A viewer counting
 * leaves was counting design decisions.
 *
 * The required invariant, asserted here from several directions:
 *
 *   NO EVIDENCE OBJECT -> NO PROOF TREE LEAF
 */

const MISSION = "fortix.demo.d006g.projection";
const component = readFileSync(new URL("../app/ConvergenceExperience.tsx", import.meta.url), "utf8");

function runtimeSession() {
  return projectMissionEvidence(createOfflineEvidenceSession(MISSION), 120_000);
}

// --- every leaf is backed by evidence ------------------------------------

test("P2R-3: every signed leaf carries a real evidence identity and digest", () => {
  const leaves = signedProofLeaves();
  assert.ok(leaves.length > 0);
  for (const leaf of leaves) {
    assert.match(leaf.evidenceId, /^fortix:evidence:blake3:[0-9a-f]{64}$/,
      `${leaf.leafId} has no real evidence identity`);
    assert.match(leaf.digest, /^[0-9a-f]{64}$/, `${leaf.leafId} has no digest`);
    assert.equal(leaf.source, "SIGNED_BUNDLE");
  }
});

test("P2R-3: every runtime leaf carries a real receipt identity and digest", () => {
  const leaves = runtimeProofLeaves(runtimeSession().records);
  assert.ok(leaves.length >= 16, `only ${leaves.length} runtime leaves`);
  for (const leaf of leaves) {
    assert.ok(leaf.evidenceId.length > 0, `${leaf.leafId} has no receipt id`);
    assert.match(leaf.digest, /^[0-9a-f]{16,}$/, `${leaf.leafId} has no canonical digest`);
    assert.equal(leaf.source, "RUNTIME_JOURNAL");
  }
});

test("P2R-3: leaf count never exceeds the evidence that exists", () => {
  const session = runtimeSession();
  const leaves = projectProofLeaves(session.records, 120_000);
  const evidenceCount = MASTER_EVIDENCE_EVENTS.length + session.records.length;
  assert.ok(leaves.length <= evidenceCount,
    `${leaves.length} leaves from ${evidenceCount} evidence objects — leaves are being invented`);
});

test("P2R-3: an empty journal produces no runtime leaves", () => {
  assert.deepEqual(runtimeProofLeaves([]), []);
  // And a record with no identity cannot become a leaf.
  assert.deepEqual(
    runtimeProofLeaves([{
      missionId: MISSION, eventId: "x", eventType: "SIGNAL_STATE_PUBLISHED",
      receiptId: "", missionClockPosition: 1, causalPredecessors: [],
      evidenceLocality: "LOCAL", executionLocality: "LOCAL",
      canonicalDigest: "abc", payload: { trust_domain: "SMART_CITY_INFRASTRUCTURE" },
    } as never]),
    [],
  );
});

// --- the clock filters, it does not create -------------------------------

test("P2R-3: the Master Clock only filters by timestamp", () => {
  const records = runtimeSession().records;
  const early = projectProofLeaves(records, 30_000);
  const late = projectProofLeaves(records, 120_000);

  assert.ok(early.length < late.length, "the tree must grow with the mission");
  // Everything visible early is still visible late, unchanged.
  for (const leaf of early) {
    const later = late.find((candidate) => candidate.leafId === leaf.leafId);
    assert.ok(later !== undefined, `${leaf.leafId} disappeared as time advanced`);
    assert.equal(later.evidenceId, leaf.evidenceId);
    assert.equal(later.timeMs, leaf.timeMs);
  }
  // And nothing is visible before its own moment.
  for (const leaf of early) assert.ok(leaf.timeMs <= 30_000);
});

test("P2R-3: rewinding removes future evidence and restores the same tree", () => {
  const records = runtimeSession().records;
  const forward = projectProofLeaves(records, 120_000);
  const rewound = projectProofLeaves(records, 20_000);
  const returned = projectProofLeaves(records, 120_000);

  assert.ok(rewound.length < forward.length, "future evidence must not survive a rewind");
  assert.deepEqual(
    returned.map((leaf) => leaf.leafId),
    forward.map((leaf) => leaf.leafId),
    "seeking forward must reconstruct the identical tree",
  );
});

// --- edges are declared by evidence, never inferred ----------------------

test("P2R-3: every causal edge is evidence-declared", () => {
  const leaves = projectProofLeaves(runtimeSession().records, 120_000);
  const edges = projectCausalEdges(leaves);
  assert.ok(edges.length > 0, "the tree must show causality at all");

  const byLeafId = new Map(leaves.map((leaf) => [leaf.leafId, leaf]));
  for (const edge of edges) {
    const child = byLeafId.get(edge.to);
    const parent = byLeafId.get(edge.from);
    assert.ok(child !== undefined && parent !== undefined, "an edge reaches a leaf that is not drawn");
    const declared = edge.relation === "CAUSAL"
      ? child.causalParents
      : child.observedInputs;
    assert.ok(declared.includes(parent.evidenceId),
      `${edge.from} -> ${edge.to} is not declared as ${edge.relation} by the child's own evidence`);
  }
});

test("P2R-3: temporal adjacency alone never creates an edge", () => {
  const leaves = projectProofLeaves(runtimeSession().records, 120_000);
  const edges = projectCausalEdges(leaves);
  const drawn = new Set(edges.map((edge) => `${edge.from}->${edge.to}`));

  // Consecutive leaves in time that declare no relationship must not be joined.
  const ordered = [...leaves].sort((left, right) => left.timeMs - right.timeMs);
  let checked = 0;
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    if ([...current.causalParents, ...current.observedInputs].includes(previous.evidenceId)) continue;
    checked += 1;
    assert.ok(!drawn.has(`${previous.leafId}->${current.leafId}`),
      `${previous.leafId} and ${current.leafId} are merely adjacent, not causally linked`);
  }
  assert.ok(checked > 0, "no adjacent-but-unrelated pair existed to test");
});

test("P2R-3: an edge to evidence outside the tree is not drawn", () => {
  // A line to nowhere invites the viewer to infer a node no evidence supports.
  const early = projectProofLeaves(runtimeSession().records, 30_000);
  const edges = projectCausalEdges(early);
  const ids = new Set(early.map((leaf) => leaf.leafId));
  for (const edge of edges) {
    assert.ok(ids.has(edge.from) && ids.has(edge.to));
  }
});

// --- the render is wired to the projection, not to the old table ---------

test("P2R-3: the proof band renders projected leaves, not presentation events", () => {
  assert.match(component, /proofLeaves\.map\(\(leaf\) =>/,
    "the proof band must iterate evidence leaves");
  assert.match(component, /projectPortableProofLeaves\(/);
  // Each rendered leaf must expose its evidence identity and digest.
  assert.match(component, /data-evidence-id=\{leaf\.evidenceId\}/);
  assert.match(component, /data-evidence-digest=\{leaf\.digest\}/);
  assert.match(component, /data-evidence-source=\{leaf\.source\}/);
  // And the retired presentation-driven blocks must not come back.
  assert.doesNotMatch(component, /causalEvents\.map\(\(\{ event, branchProgress \}\)/,
    "the hand-authored leaf loop must not return");
  assert.doesNotMatch(component, /structuralNetworkRecords\.map/,
    "network records are ordinary evidence leaves now");
});

test("P2R-3: signed and runtime evidence stay distinguishable in the DOM", () => {
  const leaves = projectProofLeaves(runtimeSession().records, 120_000);
  const sources = new Set(leaves.map((leaf) => leaf.source));
  assert.ok(sources.has("SIGNED_BUNDLE"));
  assert.ok(sources.has("RUNTIME_JOURNAL"));
  // Runtime evidence must never be presentable as part of the signed bundle.
  for (const leaf of leaves.filter((candidate) => candidate.source === "RUNTIME_JOURNAL")) {
    assert.ok(!leaf.evidenceId.startsWith("fortix:evidence:blake3:"),
      `${leaf.leafId} is runtime evidence wearing a canonical identity`);
  }
});

// --- P2R-5: independence and separation, from the evidence ---------------

test("P2R-5: smart-city and vehicle leaves are distinct domains with no cross-domain cause", () => {
  const leaves = runtimeProofLeaves(runtimeSession().records);
  const city = leaves.filter((leaf) => leaf.branch === "city");
  const vehicle = leaves.filter((leaf) => leaf.branch === "vehicle");
  assert.ok(city.length >= 6 && vehicle.length >= 7);

  const cityIds = new Set(city.map((leaf) => leaf.evidenceId));
  for (const leaf of vehicle) {
    for (const parent of leaf.causalParents) {
      assert.ok(!cityIds.has(parent),
        `${leaf.leafId} names a smart-city receipt as its CAUSE — that is a command`);
    }
  }
});

test("P2R-5: payment provider and financial institution are separate lanes", () => {
  const leaves = runtimeProofLeaves(runtimeSession().records);
  const bank = leaves.filter((leaf) => leaf.branch === "bank");
  assert.ok(bank.length >= 2, "the bank must have its own evidence-backed lane");
  for (const leaf of bank) assert.equal(leaf.domain, "FINANCIAL_INSTITUTION");

  const provider = leaves.filter((leaf) => leaf.domain === "PAYMENT_PROVIDER");
  assert.ok(provider.length >= 1);
  assert.notEqual(provider[0].branch, bank[0].branch,
    "a processor and an account-holding institution must not share a lane");
});

test("P2R-5: network transitions become evidence leaves in their own lane", () => {
  let session = createOfflineEvidenceSession(MISSION);
  session = appendNetworkTransition(session, {
    runId: session.runId,
    observationId: "probe-loss",
    adapterIdentity: TARGET_ADAPTER_IDENTITY,
    observationSource: PHYSICAL_SENTINEL_SOURCE,
    previousNetworkState: "CONNECTED",
    newNetworkState: "LOST",
    missionClockPosition: 5_000,
  }).session;

  const leaves = runtimeProofLeaves(session.records);
  const network = leaves.filter((leaf) => leaf.branch === "network");
  assert.equal(network.length, 1);
  assert.ok(network[0].evidenceId.startsWith("NR-NET-LOST"));
  assert.match(network[0].digest, /^[0-9a-f]{16,}$/);
});

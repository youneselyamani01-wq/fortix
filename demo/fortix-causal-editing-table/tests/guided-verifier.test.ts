import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  declaredMissionTime,
  edgeForBoundarySelection,
  isReceivedEvidenceDossier,
  noEvidenceSelection,
  receivedEventBindings,
  receivedTimelineNodes,
  selectedEventKey,
  selectionFromGraphContext,
  timelineNeighbours,
  type EvidenceSelection,
} from "../app/verify/guidedInspection.ts";
import { inspectReceivedPeb } from "../app/verify/inspectReceivedPeb.ts";
import { projectReceivedGraph } from "../app/verify/receivedGraph.ts";
import { receivedReceiptCounts } from "../app/verify/receivedReceiptLabels.ts";

type FixtureMember = Readonly<{
  evidenceId: string;
  receiptId: string;
  eventId?: string;
  timeMs?: number;
  producerDomain?: string;
  presentation?: "PRESENTED" | "ASSURANCE_SUPPORT";
  source?: "SIGNED_CANONICAL" | "RUNTIME_JOURNAL";
  causalParents?: readonly string[];
  observedInputs?: readonly string[];
}>;

function fixtureMember(evidenceId: string, overrides: Partial<FixtureMember> = {}): FixtureMember {
  return {
    evidenceId,
    receiptId: `NR-${evidenceId}`,
    eventId: `event.${evidenceId}`,
    producerDomain: "DOMAIN_A",
    presentation: "PRESENTED",
    source: "RUNTIME_JOURNAL",
    causalParents: [],
    observedInputs: [],
    ...overrides,
  };
}

function projectFixture(members: readonly FixtureMember[]) {
  const raw = JSON.stringify({
    profile: "fortix.demo.d006.peb.v1",
    bundleId: "guided-verifier-test",
    identity: { missionId: "mission", runId: "run" },
    manifest: { memberRefs: members },
  });
  const peb = inspectReceivedPeb(raw);
  return { raw, peb, graph: projectReceivedGraph(peb, raw) };
}

test("the Timeline uses declared time, manifest order only for ties, and never manufactures missing facts", () => {
  const { graph } = projectFixture([
    fixtureMember("late", { timeMs: 200 }),
    fixtureMember("undated", { eventId: undefined }),
    fixtureMember("tie-first", { timeMs: 100 }),
    fixtureMember("tie-second", { timeMs: 100 }),
    fixtureMember("support", { timeMs: 50, presentation: "ASSURANCE_SUPPORT" }),
  ]);
  const before = JSON.stringify(graph);
  const timeline = receivedTimelineNodes(graph);

  assert.deepEqual(timeline.map((node) => node.evidenceId), ["tie-first", "tie-second", "late", "undated"]);
  assert.deepEqual(timeline.slice(0, 2).map((node) => node.member?.index), [2, 3]);
  assert.deepEqual(timeline.slice(0, 2).map((node) => declaredMissionTime(node.member?.timeMs ?? null, "en")), [
    "T+00:00.100",
    "T+00:00.100",
  ]);
  assert.equal(declaredMissionTime(null, "en"), "Time not declared");
  assert.equal(declaredMissionTime(-1, "en"), "T−00:00.001");

  const bindings = receivedEventBindings(graph, "en");
  const undated = bindings.find((binding) => binding.node.evidenceId === "undated");
  assert.equal(undated?.eventId, null);
  assert.equal(undated?.declaredTimeMs, null);
  assert.equal(graph.edges.length, 0, "time and array proximity must not create causal edges");
  assert.equal(timeline.some((node) => node.evidenceId === "support"), false);
  assert.equal(JSON.stringify(graph), before, "the reading projection must not mutate received evidence");
});

test("one shared selection resolves events, relations, boundaries, and Timeline neighbours deterministically", () => {
  const { graph } = projectFixture([
    fixtureMember("parent", { timeMs: 10, producerDomain: "DOMAIN_A" }),
    fixtureMember("child", { timeMs: 20, producerDomain: "DOMAIN_B", causalParents: ["parent"] }),
    fixtureMember("after", { timeMs: 30, producerDomain: "DOMAIN_B" }),
  ]);
  const edge = graph.edges[0]!;
  const boundaryKey = JSON.stringify(["producer", "DOMAIN_A", "DOMAIN_B"]);
  const bindings = receivedEventBindings(graph, "en");

  const event = selectionFromGraphContext({ selectedNodeKey: "member:1" }, graph);
  assert.deepEqual(event, { kind: "event", nodeKey: "member:1" });
  assert.equal(selectedEventKey(event), "member:1");
  assert.deepEqual(
    {
      previous: timelineNeighbours(bindings, selectedEventKey(event)).previous?.nodeKey,
      current: timelineNeighbours(bindings, selectedEventKey(event)).current?.nodeKey,
      next: timelineNeighbours(bindings, selectedEventKey(event)).next?.nodeKey,
    },
    { previous: "member:0", current: "member:1", next: "member:2" },
  );

  const relation = selectionFromGraphContext({ selectedEdgeKey: edge.key }, graph);
  assert.deepEqual(relation, { kind: "relation", edgeKey: edge.key, focusNodeKey: "member:1" });
  assert.equal(selectedEventKey(relation), "member:1");

  const boundary = selectionFromGraphContext({ selectedBoundaryKey: boundaryKey, selectedEdgeKey: edge.key }, graph);
  assert.deepEqual(boundary, { kind: "boundary", boundaryKey, edgeKey: edge.key });
  assert.equal(selectedEventKey(boundary), null);
  assert.equal(edgeForBoundarySelection(graph, boundary)?.key, edge.key);
  assert.equal(edgeForBoundarySelection(graph, { kind: "boundary", boundaryKey: "unknown", edgeKey: edge.key }), null);

  const invalid = selectionFromGraphContext({ selectedNodeKey: "phantom" }, graph);
  assert.equal(invalid, noEvidenceSelection);
  assert.deepEqual(timelineNeighbours(bindings, selectedEventKey(invalid)), {
    index: -1,
    current: null,
    previous: null,
    next: null,
  });

  const explicitBoundary: EvidenceSelection = { kind: "boundary", boundaryKey, edgeKey: null };
  assert.equal(edgeForBoundarySelection(graph, explicitBoundary), null);
});

type D006Member = Readonly<{
  evidenceId: string;
  receiptId: string;
  eventId: string;
  timeMs: number;
  producerDomain: string;
  source: string;
  presentation: string;
  causalParents: readonly string[];
  observedInputs: readonly string[];
}>;

type D006RuntimeRecord = Readonly<{
  receiptId: string;
  eventType: string;
  missionClockPosition: number;
  executionLocality: string;
  evidenceLocality: string;
  payload: Readonly<{ previous_network_state?: string; new_network_state?: string }>;
}>;

test("the delivered D-006 PEB keeps its exact inventory, graph, network truth, and reconciliation boundary", () => {
  const artifactUrl = new URL(
    "../../../artifacts/d006-network-continuity-20261002/peb-after-network-cycle.json",
    import.meta.url,
  );
  const raw = readFileSync(artifactUrl, "utf8");
  const received = JSON.parse(raw) as Readonly<{
    manifest: Readonly<{ memberRefs: readonly D006Member[] }>;
    runtimeRecords: readonly D006RuntimeRecord[];
    reconciliation?: unknown;
  }>;
  const peb = inspectReceivedPeb(raw);
  const graph = projectReceivedGraph(peb, raw);
  const timeline = receivedTimelineNodes(graph);

  assert.equal(peb.parseStatus, "OBJECT");
  assert.equal(peb.knownProfile, true);
  assert.equal(peb.memberCount, 71);
  assert.equal(peb.members.length, 71);
  assert.equal(graph.nodes.length, 71);
  assert.equal(graph.edges.length, 165);
  assert.equal(graph.unresolved.length, 0);
  assert.equal(graph.cycleKeys.length, 0);
  assert.equal(graph.componentCount, 6);
  assert.equal(new Set(peb.members.map((member) => member.producerDomain).filter(Boolean)).size, 26);
  assert.deepEqual(receivedReceiptCounts(graph), { nano: 60, support: 10, final: 1, unresolved: 0 });

  assert.deepEqual(
    {
      signed: peb.members.filter((member) => member.source === "SIGNED_CANONICAL").length,
      runtime: peb.members.filter((member) => member.source === "RUNTIME_JOURNAL").length,
      final: peb.members.filter((member) => member.source === "D006_FINAL_RECEIPT").length,
      presented: peb.members.filter((member) => member.presentation === "PRESENTED").length,
      support: peb.members.filter((member) => member.presentation === "ASSURANCE_SUPPORT").length,
    },
    { signed: 45, runtime: 25, final: 1, presented: 61, support: 10 },
  );
  assert.deepEqual(
    {
      causalParents: peb.relations.filter((relation) => relation.kind === "CAUSAL_PARENT").length,
      observedInputs: peb.relations.filter((relation) => relation.kind === "OBSERVED_INPUT").length,
      finalReceiptInputs: peb.relations.filter((relation) => relation.kind === "FINAL_RECEIPT_INPUT").length,
    },
    { causalParents: 159, observedInputs: 6, finalReceiptInputs: 58 },
  );

  const expectedTimelineKeys = graph.nodes
    .filter((node) => node.final || (node.member?.presentation === "PRESENTED" && !isReceivedEvidenceDossier(node)))
    .map((node) => node.key)
    .sort();
  assert.equal(timeline.length, 59);
  assert.deepEqual(timeline.map((node) => node.key).sort(), expectedTimelineKeys, "Timeline retains received facts and leaves evidence compilations in the inventory");
  assert.ok(timeline.every((node) => node.member?.timeMs !== null), "all displayed D-006 times are declared by the PEB");
  const equalTimeGroups = new Map<number, typeof timeline[number][]>();
  for (const node of timeline) {
    const time = node.member!.timeMs!;
    equalTimeGroups.set(time, [...(equalTimeGroups.get(time) ?? []), node]);
  }
  assert.deepEqual(
    [...equalTimeGroups].filter(([, nodes]) => nodes.length > 1).map(([time]) => time),
    [9000, 48000, 54000],
  );
  for (const nodes of equalTimeGroups.values()) {
    if (nodes.length > 1) {
      assert.deepEqual(
        nodes.map((node) => node.member!.index),
        nodes.map((node) => node.member!.index).sort((left, right) => left - right),
        "equal declared times use manifest order only as a stable display tie-breaker",
      );
    }
  }

  const lost = graph.nodes.find((node) => node.member?.eventId?.startsWith("d006d.network-link-lost:"));
  const restored = graph.nodes.find((node) => node.member?.eventId?.startsWith("d006d.network-link-restored:"));
  assert.ok(lost?.member);
  assert.ok(restored?.member);
  assert.equal(lost.member.timeMs, 87_501);
  assert.equal(restored.member.timeMs, 87_502);
  assert.equal(timeline.indexOf(restored), timeline.indexOf(lost) + 1);
  assert.deepEqual(lost.member.index, 59);
  assert.deepEqual(restored.member.index, 60);

  const lostSource = received.runtimeRecords.find((record) => record.receiptId === lost.member!.receiptId);
  const restoredSource = received.runtimeRecords.find((record) => record.receiptId === restored.member!.receiptId);
  assert.deepEqual(
    {
      type: lostSource?.eventType,
      time: lostSource?.missionClockPosition,
      execution: lostSource?.executionLocality,
      evidence: lostSource?.evidenceLocality,
      before: lostSource?.payload.previous_network_state,
      after: lostSource?.payload.new_network_state,
    },
    { type: "NETWORK_LINK_LOST", time: 87_501, execution: "LOCAL", evidence: "LOCAL", before: "CONNECTED", after: "LOST" },
  );
  assert.deepEqual(
    {
      type: restoredSource?.eventType,
      time: restoredSource?.missionClockPosition,
      execution: restoredSource?.executionLocality,
      evidence: restoredSource?.evidenceLocality,
      before: restoredSource?.payload.previous_network_state,
      after: restoredSource?.payload.new_network_state,
    },
    { type: "NETWORK_LINK_RESTORED", time: 87_502, execution: "LOCAL", evidence: "LOCAL", before: "LOST", after: "CONNECTED" },
  );

  const lostManifestMember = received.manifest.memberRefs.find((member) => member.receiptId === lost.member!.receiptId);
  const restoredManifestMember = received.manifest.memberRefs.find((member) => member.receiptId === restored.member!.receiptId);
  assert.deepEqual(lostManifestMember?.causalParents, []);
  assert.deepEqual(lostManifestMember?.observedInputs, []);
  assert.deepEqual(restoredManifestMember?.causalParents, []);
  assert.deepEqual(restoredManifestMember?.observedInputs, []);
  assert.equal(
    graph.edges.some((edge) => edge.from === lost.key && edge.to === restored.key),
    false,
    "chronological adjacency must not be promoted to causality",
  );

  assert.equal("reconciliation" in received, false);
  assert.equal(raw.toLowerCase().includes("reconcil"), false);
  assert.equal(peb.members.some((member) => /reconcil/i.test(member.eventId ?? "")), false);
});

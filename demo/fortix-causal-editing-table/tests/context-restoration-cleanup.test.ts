import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { inspectReceivedPeb } from "../app/verify/inspectReceivedPeb.ts";
import { projectReceivedGraph } from "../app/verify/receivedGraph.ts";
import { createReceivedEvidenceCatalog } from "../app/verify/receivedEvidenceCatalog.ts";
import { storyKeyAfter, timelineReadingKey, verifierContextReturnPath, verifierStoryOriginForEntry } from "../app/verify/verifierNavigation.ts";
import type { EvidenceSelection } from "../app/verify/guidedInspection.ts";
import { buildVerifierPath, parseVerifierUrl, type VerifierViewRoute } from "../app/verify/verifierRoutes.ts";
import { DEFAULT_VERIFIER_UI, VerifierPresentationHistory, readVerifierPresentationEntry, readVerifierUISnapshot,
  type VerifierHistoryPort } from "../app/verify/verifierPresentation.ts";

const digest = "c".repeat(64);
const originPath = buildVerifierPath({ pebDigest: digest, view: "graph", missionId: "received.mission",
  storyEventId: "event.origin", eventId: "event.origin", nanoReceiptId: "NR.origin", domainId: "Taxi", graphMode: "expert" });
const deepPath = buildVerifierPath({ pebDigest: digest, view: "graph", missionId: "received.mission",
  storyEventId: "event.origin", eventId: "event.origin", nanoReceiptId: "NR.origin", domainId: "Taxi", graphMode: "expert",
  relationKey: "exact.edge", boundaryKey: "exact.boundary" });
class BrowserHistory implements VerifierHistoryPort {
  readonly entries: { state: unknown; path: string }[] = [{ state: { framework: "preserved" }, path: originPath }];
  cursor = 0;
  get state() { return this.entries[this.cursor].state; }
  get path() { return this.entries[this.cursor].path; }
  replaceState(state: unknown, _unused: string, path = this.path) { this.entries[this.cursor] = { state, path }; }
  pushState(state: unknown, _unused: string, path = this.path) { this.entries.splice(this.cursor + 1); this.entries.push({ state, path }); this.cursor++; }
  go(delta: number) { const cursor = this.cursor + delta; assert.ok(cursor >= 0 && cursor < this.entries.length); this.cursor = cursor; }
}
function setup() {
  const browser = new BrowserHistory(); let sequence = 0;
  const history = new VerifierPresentationHistory(browser, null, () => `local-${++sequence}`);
  history.initialize(browser.path); return { browser, history };
}
function route(path: string): VerifierViewRoute {
  const parsed = parseVerifierUrl(path);
  if (!parsed.ok || parsed.route.kind !== "view") throw new Error("Expected exact Verifier route");
  return parsed.route;
}

test("boundary X and Return share the original graph entry with every viewport and disclosure restored", () => {
  const { browser, history } = setup();
  const original = history.update({ scroll: { x: 0, y: 223 }, graphScale: 130, graphScroll: { x: 713, y: 117 },
    timelineScroll: { x: 921, y: 0 }, inspectorScroll: { x: 0, y: 37 }, graphEmphasis: "isolate",
    graphHighlightedFamily: "vehicle", expandedPanels: ["graph:context", "event:causality"] });
  const boundary = history.push(deepPath);
  history.update({ graphScale: 110, graphScroll: { x: 45, y: 70 }, inspectorScroll: { x: 0, y: 1600 }, expandedPanels: ["boundary:evidence"] });
  assert.deepEqual(boundary.contextBookmark, { entryId: original.entryId, path: originPath });
  assert.equal(history.contextReturnDelta(), -1);
  browser.go(history.contextReturnDelta()!);
  assert.deepEqual(history.restore(browser.path), original);
  assert.equal(route(history.current!.path).domainId, "Taxi");
  assert.equal(route(history.current!.path).eventId, "event.origin");
  browser.go(1); const restoredBoundary = history.restore(browser.path);
  assert.equal(restoredBoundary.uiSnapshot.inspectorScroll.y, 1600, "native Forward reopens the inspected boundary at its own scroll");
  assert.equal(history.contextReturnDelta(), -1, "either exit callback computes the same original entry");
  assert.equal((browser.state as Record<string, unknown>).framework, "preserved");
});

test("boundary → different NanoReceipt → Forensic preserves graph bookmark independently of proof target", () => {
  const { browser, history } = setup();
  const original = history.update({ graphScale: 120, graphScroll: { x: 802, y: 330 } });
  history.push(deepPath);
  for (const view of ["nanoreceipts", "forensic"] as const) history.push(buildVerifierPath({ pebDigest: digest, missionId: "received.mission", view,
    eventId: "proof.other", storyEventId: "event.origin", nanoReceiptId: "NR.other", domainId: "Garage" }));
  assert.deepEqual(history.current!.contextBookmark, { entryId: original.entryId, path: original.path });
  assert.equal(history.contextReturnDelta(), -3);
  browser.go(-3); assert.deepEqual(history.restore(browser.path), original);
  assert.equal(browser.entries.length, 4, "context return traverses the authoritative browser stack and retains Forward");
});

test("repeated graph URLs restore the exact entry, rather than the first matching graph", () => {
  const { browser, history } = setup();
  const first = history.update({ graphScale: 110 });
  history.push(buildVerifierPath({ pebDigest: digest, missionId: "received.mission", view: "forensic", storyEventId: "event.origin", eventId: "event.origin" }));
  const second = history.push(originPath); history.update({ graphScale: 150, graphScroll: { x: 129, y: 74 } });
  history.push(deepPath);
  assert.notEqual(first.entryId, second.entryId);
  assert.equal(history.current!.contextBookmark?.entryId, second.entryId);
  browser.go(history.contextReturnDelta()!); const restored = history.restore(browser.path);
  assert.equal(restored.entryId, second.entryId); assert.equal(restored.uiSnapshot.graphScale, 150);
});

test("new reading event clears obsolete context; a support target with no story retains explicit origin absence", () => {
  const { history } = setup(); history.push(deepPath);
  history.push(buildVerifierPath({ pebDigest: digest, missionId: "received.mission", view: "graph", eventId: "event.new", storyEventId: "event.new" }));
  assert.equal(history.current!.contextBookmark, null);
  const browser = new BrowserHistory();
  browser.entries[0].path = buildVerifierPath({ pebDigest: digest, missionId: "received.mission", view: "graph", eventId: "support.one", domainId: "Support" });
  const direct = new VerifierPresentationHistory(browser, null, () => "entry-support");
  const source = direct.initialize(browser.path);
  const target = direct.push(buildVerifierPath({ pebDigest: digest, missionId: "received.mission", view: "nanoreceipts", eventId: "support.two", domainId: "Support" }));
  assert.equal(target.contextBookmark?.entryId, source.entryId);
  assert.equal(route(target.contextBookmark!.path).storyEventId, null);
  assert.ok(readVerifierPresentationEntry(target));
});

test("context bookmark rejects another mission, origin, PEB, view, or deep entry", () => {
  const { history } = setup(); const entry = history.push(deepPath);
  for (const incompatible of [
    buildVerifierPath({ ...route(originPath), missionId: "other.mission" }),
    buildVerifierPath({ ...route(originPath), storyEventId: "other.origin" }),
    buildVerifierPath({ ...route(originPath), pebDigest: "d".repeat(64) }),
    buildVerifierPath({ ...route(originPath), view: "event" }), deepPath,
  ]) assert.equal(readVerifierPresentationEntry({ ...entry, contextBookmark: { entryId: "local-1", path: incompatible } }), null);
  assert.equal(readVerifierPresentationEntry({ ...entry, contextBookmark: { ...entry.contextBookmark!, verdict: "VALID" } }), null);
});

test("legacy snapshots normalize added viewport fields while closed schema rejects malformed scroll", () => {
  const { timelineScroll, inspectorScroll, ...legacy } = DEFAULT_VERIFIER_UI;
  assert.deepEqual(timelineScroll, { x: 0, y: 0 }); assert.deepEqual(inspectorScroll, { x: 0, y: 0 });
  assert.deepEqual(readVerifierUISnapshot(legacy), DEFAULT_VERIFIER_UI);
  assert.equal(readVerifierUISnapshot({ ...DEFAULT_VERIFIER_UI, timelineScroll: { x: -1, y: 0 } }), null);
  assert.equal(readVerifierUISnapshot({ ...DEFAULT_VERIFIER_UI, inspectorScroll: null }), null);
  assert.equal(readVerifierUISnapshot({ ...DEFAULT_VERIFIER_UI, inspectorScroll: { x: 0, y: Infinity } }), null);
});

const text = readFileSync(new URL("../../../artifacts/d006-network-continuity-20261002/peb-after-network-cycle.json", import.meta.url), "utf8");
const peb = inspectReceivedPeb(text); const graph = projectReceivedGraph(peb, text); const catalog = createReceivedEvidenceCatalog(graph, "fr", text);
const fact = catalog.entries.find(entry => entry.eventId === "d005.garage-arrival")!;
const dossier = catalog.entries.find(entry => entry.eventId === "d005m.receipt.master-payment")!;
test("direct boundary return reconstructs the exact received story event and domain without creating a first event", () => {
  const direct = route(buildVerifierPath({ pebDigest: peb.transferDigest, missionId: peb.identity.missionId, view: "graph", storyEventId: fact.eventId,
    eventId: dossier.eventId, nanoReceiptId: dossier.nanoReceiptId, domainId: "Mismatched-display-domain", relationKey: "any.exact.edge", boundaryKey: "any.exact.boundary", graphMode: "causal" }));
  const returned = route(verifierContextReturnPath(direct, catalog));
  assert.equal(returned.view, "graph"); assert.equal(returned.eventId, fact.eventId); assert.equal(returned.nanoReceiptId, fact.nanoReceiptId);
  assert.equal(returned.domainId, fact.domainId); assert.equal(returned.graphMode, "causal"); assert.equal(returned.boundaryKey, null); assert.equal(returned.relationKey, null);
  const noOrigin = route(buildVerifierPath({ pebDigest: peb.transferDigest, view: "graph", eventId: dossier.eventId, nanoReceiptId: dossier.nanoReceiptId, relationKey: "exact.relation" }));
  const absentReturn = route(verifierContextReturnPath(noOrigin, catalog));
  assert.equal(absentReturn.storyEventId, null); assert.equal(absentReturn.eventId, dossier.eventId);
});

test("narrative node selection moves the exact reading cursor while dossier selection keeps the current origin", () => {
  assert.equal(verifierStoryOriginForEntry(fact, "previous.origin"), fact.eventId);
  assert.equal(verifierStoryOriginForEntry(dossier, fact.eventId), fact.eventId);
  assert.equal(verifierStoryOriginForEntry(dossier, null), null);
  assert.equal(graph.nodes.length, 71); assert.equal(graph.edges.length, 165);
  assert.equal(graph.edges.reduce((sum, edge) => sum + edge.declarations.length, 0), 223);
});

test("inspecting a boundary or relation never advances the story: the timeline keeps member:29 until a fact is chosen", () => {
  const sequence: EvidenceSelection[] = [
    { kind: "event", nodeKey: "member:29" },
    { kind: "boundary", boundaryKey: "producer:Taxi>Fleet", edgeKey: "member:29>member:30" },
    { kind: "relation", edgeKey: "member:29>member:30", focusNodeKey: "member:30" },
    { kind: "boundary", boundaryKey: "producer:Taxi>Fleet", edgeKey: null },
  ];
  let story: string | null = null;
  for (const selection of sequence) {
    story = storyKeyAfter(story, selection);
    assert.equal(story, "member:29");
    assert.equal(timelineReadingKey(undefined, selection, story), "member:29");
  }
  // Returning to the fact, or choosing the next one, are the only moves.
  assert.equal(storyKeyAfter(story, { kind: "event", nodeKey: "member:29" }), "member:29");
  assert.equal(storyKeyAfter(story, { kind: "event", nodeKey: "member:30" }), "member:30");
  // A route-owned reading origin wins, including its explicit absence.
  assert.equal(timelineReadingKey("member:12", sequence[1], story), "member:12");
  assert.equal(timelineReadingKey(null, sequence[1], story), null);
  // Closing everything is not a story fact; a boundary reached without any fact keeps the prior fallback.
  assert.equal(timelineReadingKey(undefined, { kind: "none" }, story), null);
  assert.equal(timelineReadingKey(undefined, sequence[1], null), undefined);
});

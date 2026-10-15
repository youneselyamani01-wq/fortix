import assert from "node:assert/strict";
import test from "node:test";
import { buildVerifierPath, parseVerifierUrl } from "../app/verify/verifierRoutes.ts";
import {
  DEFAULT_VERIFIER_UI, VERIFIER_PRESENTATION_MAX_ENTRIES, VERIFIER_PRESENTATION_STATE_KEY,
  VerifierPresentationHistory, readVerifierUISnapshot, readVerifierPresentationEntry,
  verifierExpandedPanels, verifierStoryReturnPath,
  type VerifierHistoryPort, type VerifierPresentationStorage,
} from "../app/verify/verifierPresentation.ts";

const digest = "a".repeat(64);
const reader = buildVerifierPath({ pebDigest: digest, view: "path", missionId: "received.mission", eventId: "event.origin", storyEventId: "event.origin", domainId: "Passenger" });
function destination(view: "domains" | "graph" | "nanoreceipts" | "forensic", eventId: string | null = "event.other") {
  return buildVerifierPath({ pebDigest: digest, missionId: "received.mission", view, eventId,
    storyEventId: "event.origin", domainId: "Garage" });
}
class BrowserHistory implements VerifierHistoryPort {
  readonly entries: { state: unknown; url: string }[] = [{ state: { framework: { retained: true } }, url: reader }];
  cursor = 0;
  get state() { return this.entries[this.cursor].state; }
  get path() { return this.entries[this.cursor].url; }
  replaceState(state: unknown, _unused: string, url = this.path) { this.entries[this.cursor] = { state, url }; }
  pushState(state: unknown, _unused: string, url = this.path) { this.entries.splice(this.cursor + 1); this.entries.push({ state, url }); this.cursor += 1; }
  go(delta: number) { const next = this.cursor + delta; assert.ok(next >= 0 && next < this.entries.length); this.cursor = next; }
}
class TabStorage implements VerifierPresentationStorage {
  readonly data = new Map<string, string>();
  getItem(key: string) { return this.data.get(key) ?? null; }
  setItem(key: string, value: string) { this.data.set(key, value); }
}
function setup() {
  const browser = new BrowserHistory(); const storage = new TabStorage(); let counter = 0;
  const history = new VerifierPresentationHistory(browser, storage, () => `entry-${++counter}`);
  history.initialize(reader);
  return { browser, storage, history };
}

test("event → domain → NR → Forensic returns to exact reader entry and UI through the browser stack", () => {
  const { browser, history } = setup();
  const original = history.update({ scroll: { x: 0, y: 782 }, focusMode: true, expandedPanels: ["reader:context"], searchQuery: "passager déposé" });
  history.push(destination("domains", null)); history.update({ expandedPanels: ["domains:facts:Garage"], scroll: { x: 0, y: 450 } });
  const domain = history.current!;
  history.push(destination("nanoreceipts")); history.update({ nanoReceiptQuery: "paiement" });
  history.push(destination("forensic")); history.update({ expandedPanels: ["forensic:manifest"], scroll: { x: 0, y: 900 } });
  assert.equal(history.current?.storyBookmark?.entryId, original.entryId);
  assert.equal(history.current?.storyBookmark?.path, reader);
  assert.equal(history.storyReturnDelta(), -3);
  assert.equal(history.canBack, true); assert.equal(history.canForward, false);
  browser.go(history.storyReturnDelta()!);
  assert.deepEqual(history.restore(browser.path), original);
  assert.equal(history.canForward, true);
  browser.go(1); assert.deepEqual(history.restore(browser.path), domain, "Forward restores the exact domain disclosure and scroll");
  assert.deepEqual((browser.state as Record<string, unknown>).framework, { retained: true });
});

test("graph zoom, pan, panels and emphasis restore independently of URL evidence and graph mode", () => {
  const { browser, history } = setup();
  history.push(destination("graph"));
  const graph = history.update({ graphScale: 140, graphScroll: { x: 438, y: 291 }, graphEmphasis: "isolate", graphHighlightedFamily: "network", expandedPanels: ["graph:families", "graph:crossings"] });
  const changedMode = graph.path + "&mode=causal";
  // Build the canonical URL rather than relying on query insertion order.
  const parsed = parseVerifierUrl(changedMode);
  if (!parsed.ok || parsed.route.kind !== "view") throw new Error("expected graph");
  const retargeted = history.replace(parsed.route.canonicalPath);
  assert.equal(retargeted.entryId, graph.entryId);
  assert.deepEqual(retargeted.uiSnapshot, graph.uiSnapshot);
  assert.equal(browser.entries.length, 2, "zoom, pan, panels and graph setting replacement add no history entries");
  history.push(destination("forensic")); browser.go(-1);
  assert.deepEqual(history.restore(browser.path), retargeted);
  assert.equal(history.current?.path, parsed.route.canonicalPath, "the mode remains canonical URL state");
});

test("repeated URLs are distinct entries and a push after Back truncates the native Forward branch", () => {
  const { browser, history } = setup();
  const firstGraph = history.push(destination("graph")); history.update({ graphScale: 110 });
  history.push(destination("forensic")); const secondGraph = history.push(destination("graph"));
  assert.notEqual(firstGraph.entryId, secondGraph.entryId);
  browser.go(-2); history.restore(browser.path); assert.equal(history.canForward, true);
  history.push(destination("nanoreceipts"));
  assert.equal(history.canForward, false); assert.equal(browser.entries.length, 3);
  browser.go(-1); const restored = history.restore(browser.path);
  assert.equal(restored.entryId, firstGraph.entryId); assert.equal(restored.uiSnapshot.graphScale, 110);
});

test("a new domain opens its facts; a browser return restores the user's closed disclosure", () => {
  const { browser, history } = setup();
  history.push(destination("domains", null));
  assert.ok(history.current!.uiSnapshot.expandedPanels.includes("domains:facts:Garage"));
  const closed = history.update({ expandedPanels: [] });
  history.push(destination("forensic")); browser.go(-1);
  assert.deepEqual(history.restore(browser.path), closed);
  assert.deepEqual(history.current!.uiSnapshot.expandedPanels, []);
});

test("reload restores tab snapshots; new direct tabs reconstruct the reader URL without borrowed history", () => {
  const { browser, storage, history } = setup();
  history.push(destination("graph")); const saved = history.update({ graphScale: 130, graphScroll: { x: 22, y: 37 } });
  const reloaded = new VerifierPresentationHistory(browser, storage, () => "reload-entry");
  assert.deepEqual(reloaded.initialize(browser.path), saved);
  const direct = new BrowserHistory(); direct.entries[0] = { state: null, url: destination("forensic") };
  const fresh = new VerifierPresentationHistory(direct, storage, () => "direct-entry"); fresh.initialize(direct.path);
  assert.equal(fresh.storyReturnDelta(), null); assert.equal(fresh.canBack, false); assert.equal(fresh.canForward, false);
  const parsed = parseVerifierUrl(direct.path);
  if (!parsed.ok || parsed.route.kind !== "view") throw new Error("expected forensic");
  assert.equal(verifierStoryReturnPath(parsed.route), buildVerifierPath({ pebDigest: digest, missionId: "received.mission", view: "path", eventId: "event.origin", storyEventId: "event.origin" }));
});

test("closed bounded UI snapshots cannot carry data/verdicts or substitute a contradictory bookmark", () => {
  const { browser, history } = setup();
  const entry = history.push(destination("graph"));
  assert.equal(readVerifierUISnapshot({ ...DEFAULT_VERIFIER_UI, result: "VALID" }), null);
  assert.equal(readVerifierUISnapshot({ ...DEFAULT_VERIFIER_UI, graphScale: Infinity }), null);
  assert.equal(readVerifierUISnapshot({ ...DEFAULT_VERIFIER_UI, graphScroll: { x: -1, y: 0 } }), null);
  assert.equal(readVerifierUISnapshot({ ...DEFAULT_VERIFIER_UI, expandedPanels: ["same", "same"] }), null);
  assert.equal(readVerifierUISnapshot({ ...DEFAULT_VERIFIER_UI, graphHighlightedFamily: "x".repeat(1025) }), null);
  const { graphHighlightedFamily, ...legacyUI } = DEFAULT_VERIFIER_UI;
  assert.equal(graphHighlightedFamily, null);
  assert.deepEqual(readVerifierUISnapshot(legacyUI), DEFAULT_VERIFIER_UI, "an earlier presentation schema gains the default emphasis without an extra route");
  assert.equal(readVerifierPresentationEntry({ ...entry, storyBookmark: { ...entry.storyBookmark!, storyEventId: "event.other" } }), null);
  assert.equal(readVerifierPresentationEntry((browser.state as Record<string, unknown>)[VERIFIER_PRESENTATION_STATE_KEY], reader), null);
  assert.deepEqual(verifierExpandedPanels(["domain:Garage"], "forensic:raw", true), ["domain:Garage", "forensic:raw"]);
  assert.deepEqual(verifierExpandedPanels(["domain:Garage", "forensic:raw"], "forensic:raw", false), ["domain:Garage"]);
});

test("ledger bounds preserve adjacent navigation beyond the legacy parent depth limit", () => {
  const { browser, history } = setup();
  for (let index = 0; index < VERIFIER_PRESENTATION_MAX_ENTRIES + 16; index += 1) history.push(destination(index % 2 ? "graph" : "forensic"));
  assert.equal(history.canBack, true); const last = history.current!;
  browser.go(-1); history.restore(browser.path); assert.equal(history.current!.index, last.index - 1);
  assert.equal(history.canForward, true); assert.equal(history.canBack, true);
  assert.equal(history.storyReturnDelta(), null, "evicted source falls back to its exact reader URL");
});

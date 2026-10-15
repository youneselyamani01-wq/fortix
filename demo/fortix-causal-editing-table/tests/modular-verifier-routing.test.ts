import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  buildVerifierPath,
  parseVerifierUrl,
  readSharedVerifierSelection,
  verifierRouteTarget,
  verifierSelectionFromRoute,
  verifierMissionContextStatus,
  type SharedVerifierSelection,
  type VerifierView,
} from "../app/verify/verifierRoutes.ts";
import {
  VERIFIER_PEB_MAX_BYTES,
  VerifierPebStore,
  VerifierPebStoreError,
  type VerifierPebCacheEntry,
  type VerifierPebStoreBackend,
} from "../app/verify/verifierStore.ts";
import {
  VERIFIER_SELECTION_CHANNEL_PREFIX,
  VerifierSelectionSync,
  compareVerifierSelectionClock,
  readVerifierSelectionSyncMessage,
  verifierSelectionChannelName,
  type VerifierBroadcastChannel,
  type VerifierSelectionSyncMessage,
} from "../app/verify/verifierSync.ts";

const DIGEST = "0123456789abcdef".repeat(4);
const OTHER_DIGEST = "fedcba9876543210".repeat(4);

function selection(overrides: Partial<SharedVerifierSelection> = {}): SharedVerifierSelection {
  return {
    version: 2,
    pebDigest: DIGEST,
    missionId: "mission:d006",
    view: "graph",
    eventId: "event:garage/entry",
    storyEventId: "event:garage/entry",
    nanoReceiptId: "nr:28",
    evidenceId: "evidence:28",
    domainId: "FortiX causal compiler",
    relationKey: "edge:27>28",
    boundaryKey: "boundary:garage>vehicle",
    graphMode: "follow",
    family: "network",
    followToFinal: true,
    ...overrides,
  };
}

test("canonical routes preserve the frozen query order and never duplicate an event route segment", () => {
  const path = buildVerifierPath({
    pebDigest: DIGEST,
    view: "timeline",
    eventId: "event:garage/entry",
    nanoReceiptId: "nr:28",
    domainId: "FortiX causal compiler",
    graphMode: "follow",
    relationKey: "edge:27>28",
    boundaryKey: "boundary:garage>vehicle",
    family: "network",
    followToFinal: true,
  });
  assert.equal(path,
    `/verify/${DIGEST}/timeline?event=event%3Agarage%2Fentry&nr=nr%3A28&domain=FortiX+causal+compiler&mode=follow&relation=edge%3A27%3E28&boundary=boundary%3Agarage%3Evehicle&family=network&toFinal=1`);

  const parsed = parseVerifierUrl(path);
  assert.equal(parsed.ok, true);
  if (!parsed.ok || parsed.route.kind !== "view") return;
  assert.equal(parsed.route.canonicalPath, path);
  assert.equal(parsed.route.isCanonical, true);
  assert.equal(parsed.route.eventId, "event:garage/entry");
  assert.equal(parsed.route.followToFinal, true);

  const eventPath = buildVerifierPath({
    pebDigest: DIGEST,
    view: "event",
    eventId: "event:garage/entry",
    nanoReceiptId: "nr:28",
  });
  assert.equal(eventPath, `/verify/${DIGEST}/events/event%3Agarage%2Fentry?nr=nr%3A28`);
  assert.doesNotMatch(eventPath, /[?&]event=/);
});

test("route parsing defaults to simplified and reports a safe canonical replacement", () => {
  const input = `/verify/${DIGEST}/graph?domain=AUTONOMOUS_VEHICLE&event=event.1&mode=simplified`;
  const parsed = parseVerifierUrl(input);
  assert.equal(parsed.ok, true);
  if (!parsed.ok || parsed.route.kind !== "view") return;
  assert.equal(parsed.route.graphMode, "simplified");
  assert.equal(parsed.route.isCanonical, false);
  assert.equal(parsed.route.canonicalPath,
    `/verify/${DIGEST}/graph?event=event.1&domain=AUTONOMOUS_VEHICLE`);

  const resolved = verifierSelectionFromRoute(parsed.route, "mission:d006", "evidence.1");
  assert.deepEqual(verifierRouteTarget(resolved), {
    pebDigest: DIGEST,
    view: "graph",
    missionId: "mission:d006",
    storyEventId: "event.1",
    eventId: "event.1",
    nanoReceiptId: null,
    domainId: "AUTONOMOUS_VEHICLE",
    relationKey: null,
    boundaryKey: null,
    graphMode: "simplified",
    family: null,
    followToFinal: false,
  });
  assert.deepEqual(parseVerifierUrl("/verify"), {
    ok: true,
    route: { kind: "intake", canonicalPath: "/verify", isCanonical: true },
  });
});

test("each reading view has a deep link with the same PEB and selected context", () => {
  const selected = selection({ view: "path", followToFinal: false });
  const views: readonly VerifierView[] = ["verdict", "path", "timeline", "domains", "graph", "event", "nanoreceipts", "forensic"];
  for (const view of views) {
    const target = verifierRouteTarget(selected, view);
    const path = buildVerifierPath(target);
    const parsed = parseVerifierUrl(path);
    assert.equal(parsed.ok, true, view);
    if (!parsed.ok || parsed.route.kind !== "view") throw new Error("expected a reading view");
    assert.equal(parsed.route.isCanonical, true, view);
    assert.equal(parsed.route.pebDigest, selected.pebDigest, view);
    assert.equal(parsed.route.view, view);
    assert.equal(parsed.route.eventId, selected.eventId, view);
    assert.equal(parsed.route.nanoReceiptId, selected.nanoReceiptId, view);
    assert.equal(parsed.route.domainId, selected.domainId, view);
    assert.equal(parsed.route.boundaryKey, selected.boundaryKey, view);
    assert.equal(parsed.route.relationKey, selected.relationKey, view);
    const rehydrated = verifierSelectionFromRoute(parsed.route, selected.missionId, selected.evidenceId);
    assert.deepEqual(rehydrated, { ...selected, view });
  }
});

test("legacy Path links remain valid and a mission URL claim is checked against received identity", () => {
  const parsed = parseVerifierUrl(`/verify/${DIGEST}/path?event=dropoff&nr=nr.dropoff&domain=Passenger`);
  assert.equal(parsed.ok, true);
  if (!parsed.ok || parsed.route.kind !== "view") throw new Error("expected a path route");
  assert.equal(verifierSelectionFromRoute(parsed.route, "mission:from-peb").missionId, "mission:from-peb");
  assert.equal(verifierMissionContextStatus(parsed.route, "mission:from-peb"), "UNSPECIFIED");
  const claimed = parseVerifierUrl(`${parsed.route.canonicalPath}&mission=forged`);
  if (!claimed.ok || claimed.route.kind !== "view") throw new Error("expected a claimed route");
  assert.equal(verifierMissionContextStatus(claimed.route, "mission:from-peb"), "CONTRADICTORY");
  assert.equal(verifierMissionContextStatus(claimed.route, "forged"), "MATCHED");
  assert.equal(verifierSelectionFromRoute(claimed.route, "mission:from-peb").missionId, "mission:from-peb");
});

test("reader origin survives a different inspected event and v1 transport normalizes deterministically", () => {
  const selected = selection({ storyEventId: "event:dropoff", eventId: "event:payment", view: "forensic" });
  const parsed = parseVerifierUrl(buildVerifierPath(verifierRouteTarget(selected)));
  if (!parsed.ok || parsed.route.kind !== "view") throw new Error("expected a forensic route");
  assert.equal(parsed.route.storyEventId, "event:dropoff");
  assert.equal(parsed.route.eventId, "event:payment");
  assert.equal(parsed.route.missionId, "mission:d006");
  const { storyEventId: _origin, ...legacy } = selected;
  assert.equal(_origin, "event:dropoff");
  assert.deepEqual(readSharedVerifierSelection({ ...legacy, version: 1 }), { ...selected, storyEventId: selected.eventId });
  assert.equal(readSharedVerifierSelection({ ...selected, version: 1 }), null, "v1 remains a closed schema");
  assert.equal(parseVerifierUrl(`/verify/${DIGEST}/graph?storyEvent=a&storyEvent=b`).ok, false);
  assert.equal(parseVerifierUrl(`/verify/${DIGEST}/graph?mission=a&mission=b`).ok, false);
});

test("strict route parsing rejects ambiguity, unknown claims, invalid modes and non-canonical digest identity", () => {
  const invalid = [
    `/verify/${DIGEST.toUpperCase()}/graph`,
    `/verify/${DIGEST}/events`,
    `/verify/${DIGEST}/events/event.1?event=event.1`,
    `/verify/${DIGEST}/graph?event=a&event=b`,
    `/verify/${DIGEST}/graph?payload=secret`,
    `/verify/${DIGEST}/graph?mode=all`,
    `/verify/${DIGEST}/graph?toFinal=1`,
    `/verify/${DIGEST}/graph?mode=follow&toFinal=0`,
    `/verify/${DIGEST}/graph?event=${"x".repeat(1025)}`,
    `/verify/${DIGEST}/graph#selection=hidden`,
  ];
  for (const input of invalid) {
    assert.equal(parseVerifierUrl(input).ok, false, input);
  }
  assert.throws(
    () => buildVerifierPath({ pebDigest: DIGEST, view: "event", eventId: null }),
    /requires an event identifier/,
  );
  assert.throws(
    () => buildVerifierPath({ pebDigest: DIGEST, view: "graph", graphMode: "causal", followToFinal: true }),
    /only in follow mode/,
  );
});

test("shared selections have a closed schema and cannot smuggle transport or analysis state", () => {
  const valid = selection();
  assert.deepEqual(readSharedVerifierSelection(valid), valid);
  assert.equal(readSharedVerifierSelection({ ...valid, text: "PEB bytes" }), null);
  assert.equal(readSharedVerifierSelection({ ...valid, result: "VALID" }), null);
  assert.equal(readSharedVerifierSelection({ ...valid, graphMode: "causal", followToFinal: true }), null);
  assert.equal(readSharedVerifierSelection({ ...valid, eventId: "" }), null);
});

class MemoryBackend implements VerifierPebStoreBackend {
  readonly values = new Map<string, unknown>();
  readonly removed: string[] = [];
  closed = false;

  async read(digest: string): Promise<unknown> { return this.values.get(digest); }
  async write(entry: VerifierPebCacheEntry): Promise<void> { this.values.set(entry.digest, { ...entry }); }
  async remove(digest: string): Promise<void> { this.removed.push(digest); this.values.delete(digest); }
  async clear(): Promise<void> { this.values.clear(); }
  close(): void { this.closed = true; }
}

function testDigest(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

test("the local cache writes exact bytes only and rechecks byte size and digest on every read", async () => {
  const backend = new MemoryBackend();
  let digestCalls = 0;
  const store = new VerifierPebStore({
    backend,
    digestText: (text) => { digestCalls += 1; return testDigest(text); },
  });
  const text = "\uFEFF{\r\n  \"profile\": \"fortix.demo.d006.peb.v1\"\r\n}\r\n";
  const digest = testDigest(text);
  const entry = await store.put({ digest, text });
  assert.deepEqual(entry, { digest, text, byteLength: new TextEncoder().encode(text).byteLength });
  assert.deepEqual(Object.keys(backend.values.get(digest) as object).sort(), ["byteLength", "digest", "text"]);
  assert.deepEqual(await store.get(digest), entry);
  assert.equal(digestCalls, 2, "write and read each recompute the digest");

  backend.values.set(digest, { ...entry, text: `${text} ` });
  assert.equal(await store.get(digest), null);
  assert.deepEqual(backend.removed, [digest]);

  backend.values.set(digest, { ...entry, result: "VALID" });
  assert.equal(await store.get(digest), null, "unknown persisted fields are rejected");
  assert.deepEqual(backend.removed, [digest, digest]);
  store.close();
  assert.equal(backend.closed, true);
  await assert.rejects(() => store.get(digest), (error: unknown) => (
    error instanceof VerifierPebStoreError && error.code === "STORE_CLOSED"
  ));
});

test("the local cache rejects a wrong address and enforces its 20 MiB UTF-8 ceiling", async () => {
  const backend = new MemoryBackend();
  const store = new VerifierPebStore({ backend, digestText: testDigest });
  await assert.rejects(
    () => store.put({ digest: "0".repeat(64), text: "different bytes" }),
    (error: unknown) => error instanceof VerifierPebStoreError && error.code === "DIGEST_MISMATCH",
  );
  const oversized = "a".repeat(VERIFIER_PEB_MAX_BYTES + 1);
  await assert.rejects(
    () => store.put({ digest: testDigest(oversized), text: oversized }),
    (error: unknown) => error instanceof VerifierPebStoreError && error.code === "PEB_TOO_LARGE",
  );
  assert.equal(backend.values.size, 0);
});

class FakeChannel implements VerifierBroadcastChannel {
  readonly listeners = new Set<(event: MessageEvent<unknown>) => void>();
  readonly sent: unknown[] = [];
  readonly name: string;
  readonly network: FakeBroadcastNetwork;
  closed = false;
  constructor(name: string, network: FakeBroadcastNetwork) {
    this.name = name;
    this.network = network;
  }
  postMessage(message: unknown): void {
    this.sent.push(message);
    this.network.deliver(this.name, message);
  }
  addEventListener(_type: "message", listener: (event: MessageEvent<unknown>) => void): void {
    this.listeners.add(listener);
  }
  removeEventListener(_type: "message", listener: (event: MessageEvent<unknown>) => void): void {
    this.listeners.delete(listener);
  }
  close(): void { this.closed = true; this.network.channels.get(this.name)?.delete(this); }
  emit(message: unknown): void {
    for (const listener of this.listeners) listener({ data: message } as MessageEvent<unknown>);
  }
}

class FakeBroadcastNetwork {
  readonly channels = new Map<string, Set<FakeChannel>>();
  readonly openedNames: string[] = [];
  factory = (name: string): VerifierBroadcastChannel => {
    this.openedNames.push(name);
    const channel = new FakeChannel(name, this);
    const peers = this.channels.get(name) ?? new Set<FakeChannel>();
    peers.add(channel);
    this.channels.set(name, peers);
    return channel;
  };
  deliver(name: string, message: unknown): void {
    for (const channel of this.channels.get(name) ?? []) channel.emit(message);
  }
  first(name: string): FakeChannel { return [...(this.channels.get(name) ?? [])][0]!; }
}

test("selection sync is digest-scoped, Lamport ordered, receive-only and preserves each tab view", () => {
  const network = new FakeBroadcastNetwork();
  const graphReceived: SharedVerifierSelection[] = [];
  const domainsReceived: SharedVerifierSelection[] = [];
  let graphView: VerifierView = "graph";
  const graph = new VerifierSelectionSync({
    pebDigest: DIGEST,
    missionId: "mission:d006",
    sender: "tab-a",
    currentView: () => graphView,
    onRemoteSelection: (value) => graphReceived.push(value),
    channelFactory: network.factory,
  });
  const domains = new VerifierSelectionSync({
    pebDigest: DIGEST,
    missionId: "mission:d006",
    sender: "tab-b",
    currentView: () => "domains",
    onRemoteSelection: (value) => domainsReceived.push(value),
    channelFactory: network.factory,
  });
  const channelName = `${VERIFIER_SELECTION_CHANNEL_PREFIX}${DIGEST}`;
  assert.deepEqual(network.openedNames, [channelName, channelName]);
  assert.equal(verifierSelectionChannelName(DIGEST), channelName);

  const published = graph.publish(selection());
  assert.equal(published.counter, 1);
  assert.equal(graphReceived.length, 0, "the sender ignores its own message");
  assert.equal(domainsReceived.length, 1);
  assert.equal(domainsReceived[0].view, "domains");
  assert.equal(domainsReceived[0].eventId, "event:garage/entry");
  assert.equal(network.first(channelName).sent.length, 1, "receiving does not rebroadcast");

  graphView = "timeline";
  const reply = domains.publish(selection({ view: "domains", eventId: "event:network.lost", followToFinal: false }));
  assert.equal(reply.counter, 2, "a local action advances beyond the latest received clock");
  assert.equal(graphReceived.at(-1)?.view, "timeline");
  assert.equal(graphReceived.at(-1)?.eventId, "event:network.lost");
  graph.close();
  domains.close();
});

test("sync rejects stale, cross-PEB, cross-mission and open-schema messages deterministically", () => {
  const network = new FakeBroadcastNetwork();
  const received: SharedVerifierSelection[] = [];
  const endpoint = new VerifierSelectionSync({
    pebDigest: DIGEST,
    missionId: "mission:d006",
    sender: "tab-local",
    currentView: () => "forensic",
    onRemoteSelection: (value) => received.push(value),
    channelFactory: network.factory,
  });
  const name = verifierSelectionChannelName(DIGEST);
  const makeMessage = (sender: string, counter: number, overrides: Partial<VerifierSelectionSyncMessage> = {}) => ({
    version: 1,
    digest: DIGEST,
    sender,
    counter,
    selection: selection({ view: "timeline", followToFinal: false }),
    ...overrides,
  });

  network.deliver(name, makeMessage("tab-z", 5));
  network.deliver(name, makeMessage("tab-a", 5));
  network.deliver(name, makeMessage("tab-y", 4));
  assert.equal(received.length, 1, "lower sender tie and older counters lose");
  assert.equal(received[0].view, "forensic");

  network.deliver(name, makeMessage("tab-zz", 6, { digest: OTHER_DIGEST }));
  network.deliver(name, makeMessage("tab-zz", 6, {
    selection: selection({ missionId: "other-mission", followToFinal: false }),
  }));
  network.deliver(name, { ...makeMessage("tab-zz", 6), text: "forbidden bytes" });
  network.deliver(name, { ...makeMessage("tab-zz", 6), selection: { ...selection(), result: "VALID" } });
  assert.equal(received.length, 1);

  const next = endpoint.publish(selection({ view: "forensic", followToFinal: false }));
  assert.equal(next.counter, 6);
  assert.equal(readVerifierSelectionSyncMessage(next, DIGEST)?.selection.eventId, "event:garage/entry");
  assert.equal(readVerifierSelectionSyncMessage({ ...next, counter: 0 }, DIGEST), null);
  assert.equal(compareVerifierSelectionClock({ counter: 5, sender: "tab-a" }, { counter: 5, sender: "tab-z" }), -1);
  endpoint.close();
});

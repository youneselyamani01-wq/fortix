import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { transferredContentDigest } from "../app/portableMissionEvidence.ts";
import { analyzeInsertedD006Peb, insertD006PebForAnalysis } from "../app/offlineVerification.ts";
import { graphParcel, openGraphInspection, receiveGraphInspection, type GraphParcel } from "../app/verify/graphHandoff.ts";
import { inspectReceivedPeb } from "../app/verify/inspectReceivedPeb.ts";
import { projectReceivedGraph } from "../app/verify/receivedGraph.ts";

const CHANNEL = "fortix-verifier-graph-v1";
const text = '\uFEFF{\r\n "profile":"fortix.demo.d006.peb.v1", "label":"preuve reçue", "manifest":{"memberRefs":[]}\r\n}\r\n';
const parcel: GraphParcel = { text, name: "preuve.json", digest: transferredContentDigest(text), locale: "fr", snapshot: null, context: { selectedNodeKey: "node:3", selectedBoundaryKey: "boundary:2", selectedEdgeKey: "edge:4", preset: "full", level: 3, focusMode: "follow", highlightedFamily: "network", layers: { nanoReceipts: true, boundaries: true, causalRelations: true, secondaryRelations: true, supportEvidence: true, finalReceipt: true, contextZones: true } } };
class Surface {
  location: URL;
  listeners = new Set<(event: MessageEvent) => void>();
  opener: Window | null = null; closed = false; focused = false;
  crypto = globalThis.crypto;
  history = { state: null, replaceState: (_state: unknown, _title: string, path: string) => { this.location = new URL(path, this.location.href); } };
  openCalls: string[][] = []; opened: Surface | null = null;
  sent: { data: unknown; origin: string; ports: MessagePort[] }[] = [];
  onPost: ((data: unknown, origin: string, ports: MessagePort[]) => void) | null = null;
  constructor(url: string) { this.location = new URL(url); }
  open(url: string, target: string) { this.openCalls.push([url, target]); if (this.opened) { this.opened.location = new URL(url); this.opened.opener = this.window(); } return this.opened?.window() ?? null; }
  focus() { this.focused = true; }
  postMessage(data: unknown, origin: string, ports: MessagePort[] = []) { this.sent.push({ data, origin, ports }); this.onPost?.(data, origin, ports); }
  addEventListener(_name: string, handler: (event: MessageEvent) => void) { this.listeners.add(handler); }
  removeEventListener(_name: string, handler: (event: MessageEvent) => void) { this.listeners.delete(handler); }
  setTimeout(callback: () => void, delay: number) { return setTimeout(callback, delay); }
  clearTimeout(timer: ReturnType<typeof setTimeout>) { clearTimeout(timer); }
  window() { return this as unknown as Window; }
  emit(data: unknown, origin: string, source: Surface, ports: MessagePort[] = []) { for (const listener of this.listeners) listener({ data, origin, source: source.window(), ports } as unknown as MessageEvent); }
}
function pair(origin = "http://localhost:3000") {
  const verifier = new Surface(`${origin}/verify`); const graph = new Surface(`${origin}/verify/graph`); verifier.opened = graph;
  verifier.onPost = (data, origin, ports) => { assert.equal(origin, verifier.location.origin); queueMicrotask(() => verifier.emit(data, graph.location.origin, graph, ports)); };
  graph.onPost = (data, origin, ports) => { assert.equal(origin, graph.location.origin); queueMicrotask(() => graph.emit(data, verifier.location.origin, verifier, ports)); };
  return { verifier, graph };
}
async function settle(until: () => boolean) { for (let n = 0; n < 100 && !until(); n += 1) await new Promise<void>(resolve => setImmediate(resolve)); assert.ok(until(), "graph transfer reached expected state"); }

test("dedicated graph receives exact bytes, every display context field and a bound existing local result", async () => {
  const { verifier, graph } = pair(); const statuses: string[] = []; const received: GraphParcel[] = [];
  const snapshot = await analyzeInsertedD006Peb(insertD006PebForAnalysis({ pebText: text, expectedIdentity: { missionId: "m", runId: "r" }, expectedTransferredContentDigest: parcel.digest }));
  const input = { ...parcel, snapshot }; let back: (() => void) | undefined;
  const stop = openGraphInspection({ ...input, onStatus: status => statuses.push(status) }, verifier.window());
  const stopChild = receiveGraphInspection((value, returnToVerifier) => { received.push(value); back = returnToVerifier; }, () => assert.fail("valid graph handoff failed"), graph.window());
  try {
    await settle(() => statuses.includes("opened"));
    assert.deepEqual(received, [input]); assert.deepEqual(new TextEncoder().encode(received[0].text), new TextEncoder().encode(text));
    assert.equal(verifier.openCalls[0][1], "_blank"); assert.equal(new URL(verifier.openCalls[0][0]).pathname, "/verify/graph");
    assert.ok(!verifier.openCalls[0][0].includes(text)); assert.ok(!verifier.openCalls[0][0].includes(parcel.digest));
    assert.equal(graph.location.hash, ""); assert.equal(graph.opener, null);
    assert.equal(verifier.listeners.size, 0); assert.equal(graph.listeners.size, 0);
    back!(); assert.equal(verifier.focused, true);
    verifier.closed = true; stop();
    assert.equal(received[0].text, text, "closing source cannot discard the graph bytes");
    receiveGraphInspection(() => assert.fail("refresh must not reuse consumed input"), () => assert.fail("refresh is an empty surface"), graph.window())();
    assert.equal(graph.listeners.size, 0, "refresh cannot silently restore bytes or a previous verdict");
    const after = await analyzeInsertedD006Peb(insertD006PebForAnalysis({ pebText: received[0].text, expectedIdentity: snapshot.identity, expectedTransferredContentDigest: received[0].digest }));
    assert.deepEqual(after, snapshot, "transport changes neither explicit verification input nor deterministic result");
  } finally { stopChild(); stop(); }
});

test("graph handoff rejects wrong origin, wrong source and wrong nonce before sending any bytes", async () => {
  const { verifier, graph } = pair(); const received: GraphParcel[] = [];
  const stop = openGraphInspection({ ...parcel, onStatus: () => {} }, verifier.window());
  const nonce = new URLSearchParams(graph.location.hash.slice(1)).get("verifier-graph");
  const ready = { channel: CHANNEL, kind: "ready", nonce };
  verifier.emit(ready, "https://foreign.example", graph); verifier.emit(ready, graph.location.origin, new Surface(graph.location.href)); verifier.emit({ ...ready, nonce: "wrong" }, graph.location.origin, graph);
  assert.equal(graph.sent.length, 0);
  verifier.onPost = null;
  const stopChild = receiveGraphInspection(value => received.push(value), () => assert.fail("untrusted event should be ignored"), graph.window());
  const incoming = { channel: CHANNEL, kind: "package", nonce, parcel };
  graph.emit(incoming, "https://foreign.example", verifier); graph.emit(incoming, graph.location.origin, new Surface(verifier.location.href)); graph.emit({ ...incoming, nonce: "wrong" }, graph.location.origin, verifier);
  assert.equal(received.length, 0); assert.equal(graph.opener, verifier.window());
  stopChild(); stop();
});

test("graph transfer is one-shot and rejects corrupt exact bytes instead of drawing a replacement graph", async () => {
  const { verifier, graph } = pair(); let failed = false; let accepted = 0;
  const stop = openGraphInspection({ ...parcel, onStatus: () => {} }, verifier.window());
  verifier.onPost = null;
  const stopChild = receiveGraphInspection(() => { accepted += 1; }, () => { failed = true; }, graph.window());
  const nonce = new URLSearchParams(graph.location.hash.slice(1)).get("verifier-graph"); const ports = new MessageChannel();
  const incoming = { channel: CHANNEL, kind: "package", nonce, parcel: { ...parcel, text: text + " " } };
  try {
    graph.emit(incoming, graph.location.origin, verifier, [ports.port2]); assert.equal(failed, true); assert.equal(accepted, 0);
    graph.emit({ ...incoming, parcel }, graph.location.origin, verifier, [ports.port2]); assert.equal(accepted, 0); assert.equal(graph.opener, null);
  } finally { stopChild(); stop(); ports.port1.close(); ports.port2.close(); }
});

test("blocked tab and unsupported direct entry leave the Verifier state unchanged", () => {
  const host = new Surface("http://localhost:3000/verify"); const statuses: string[] = [];
  openGraphInspection({ ...parcel, onStatus: status => statuses.push(status) }, host.window())();
  assert.deepEqual(statuses, ["blocked"]); assert.equal(host.location.pathname, "/verify"); assert.equal(host.listeners.size, 0);
  receiveGraphInspection(() => assert.fail("direct entry has no package"), () => assert.fail("direct entry is an empty surface"), host.window())();
  assert.equal(host.listeners.size, 0);
});

test("reopening creates a new nonce and completed or abandoned handshakes cannot feed a new tab", () => {
  const { verifier, graph } = pair();
  const firstStop = openGraphInspection({ ...parcel, onStatus: () => {} }, verifier.window());
  const firstNonce = new URLSearchParams(graph.location.hash.slice(1)).get("verifier-graph");
  firstStop(); assert.equal(verifier.listeners.size, 0);
  const next = new Surface("http://localhost:3000/verify/graph"); verifier.opened = next;
  const secondStop = openGraphInspection({ ...parcel, onStatus: () => {} }, verifier.window());
  try {
    const secondNonce = new URLSearchParams(next.location.hash.slice(1)).get("verifier-graph");
    assert.notEqual(secondNonce, firstNonce);
    verifier.emit({ channel: CHANNEL, kind: "ready", nonce: firstNonce }, graph.location.origin, graph);
    verifier.emit({ channel: CHANNEL, kind: "ready", nonce: firstNonce }, next.location.origin, next);
    assert.equal(next.sent.length, 0); assert.equal(verifier.listeners.size, 1);
  } finally { secondStop(); }
  assert.equal(verifier.listeners.size, 0);
});

test("malformed snapshots cannot establish a verdict; unverified bytes remain inspectable", async () => {
  const snapshot = await analyzeInsertedD006Peb(insertD006PebForAnalysis({ pebText: text, expectedIdentity: { missionId: "m", runId: "r" }, expectedTransferredContentDigest: parcel.digest }));
  for (const candidate of [{ ...snapshot, transferredContentDigest: "0".repeat(64) }, { ...snapshot, state: "RECEIVED" }, { ...snapshot, result: { ...snapshot.result, completedChecks: [null] } }, { verdict: "VALID" }]) {
    const accepted = graphParcel({ ...parcel, snapshot: candidate }); assert.ok(accepted); assert.equal(accepted.snapshot, null); assert.equal(accepted.text, text);
  }
  const unverified = graphParcel(parcel)!; assert.equal(unverified.snapshot, null);
  assert.deepEqual(projectReceivedGraph(inspectReceivedPeb(unverified.text), unverified.text), projectReceivedGraph(inspectReceivedPeb(text), text));
});

test("oversize and non-text packages are rejected without parsing or accepting display context claims", () => {
  assert.equal(graphParcel({ ...parcel, text: "é".repeat(11 * 1024 * 1024) }), null);
  assert.equal(graphParcel({ ...parcel, text: {} }), null); assert.equal(graphParcel({ ...parcel, text: "" }), null);
  const safe = graphParcel({ ...parcel, context: { preset: "invented", selectedNodeKey: {}, focusMode: "verify", layers: { nanoReceipts: "true" } } })!;
  assert.deepEqual(safe.context, { preset: "causal" });
});

test("dedicated route has no analysis action, persistence or Demo result intake", () => {
  const client = readFileSync(new URL("../app/verify/graph/GraphInspectionClient.tsx", import.meta.url), "utf8");
  const transport = readFileSync(new URL("../app/verify/graphHandoff.ts", import.meta.url), "utf8");
  const inspection = readFileSync(new URL("../app/verify/ReceivedCausalInspection.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(client + transport, /analyzeInsertedD006Peb|insertD006PebForAnalysis|localStorage|sessionStorage|receiveDemoParcel/);
  assert.match(client, /view="graph" dedicated initialContext=\{parcel.context\}/);
  assert.match(client, /className="nx verifier-page verifier-flow verifier-graph-page"/);
  assert.match(inspection, /initialContext=\{graphNavigation.initialContext \?\? pathContext\}/);
  assert.match(inspection, /selectedNodeKey: selected\?\.key/);
  assert.match(inspection, /selectedBoundaryKey: selection\.kind === "boundary" \? selection\.boundaryKey : undefined/);
  assert.match(inspection, /selectedEdgeKey: selection\.kind === "relation" \? selection\.edgeKey : selection\.kind === "boundary" \? selection\.edgeKey : undefined/);
  assert.match(transport, /event.source !== source \|\| event.origin !== origin/);
});

test("LAN dedicated graph keeps its source origin, bytes and context without randomUUID", async () => {
  for (const origin of ["http://192.168.1.42:3000", "http://[2001:db8::42]:3000"]) {
    const { verifier, graph } = pair(origin); verifier.crypto = { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) } as Crypto;
    const statuses: string[] = []; const received: GraphParcel[] = [];
    const stop = openGraphInspection({ ...parcel, onStatus: status => statuses.push(status) }, verifier.window());
    assert.equal(new URL(verifier.openCalls[0][0]).origin, origin); assert.equal(new URL(verifier.openCalls[0][0]).pathname, "/verify/graph");
    const stopChild = receiveGraphInspection(value => received.push(value), () => assert.fail("valid LAN graph rejected"), graph.window());
    try { await settle(() => statuses.includes("opened")); assert.deepEqual(received, [parcel]); } finally { stopChild(); stop(); }
  }
});

test("dedicated graph fails without opening when no secure nonce source exists", () => {
  const { verifier } = pair(); verifier.crypto = {} as Crypto; const statuses: string[] = [];
  openGraphInspection({ ...parcel, onStatus: status => statuses.push(status) }, verifier.window())();
  assert.deepEqual(statuses, ["failed"]); assert.equal(verifier.openCalls.length, 0); assert.equal(verifier.listeners.size, 0);
});

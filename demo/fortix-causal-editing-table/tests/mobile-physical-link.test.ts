import assert from "node:assert/strict";
import test from "node:test";
import { GET } from "../app/api/physical-link/route.ts";
import { buildBoundPhysicalReport, SENTINEL_UNREACHABLE, type AdapterRecord } from "../app/ethernetLink.ts";
import { PHYSICAL_ADAPTER_TARGETS, physicalAdapterReportUrl, type PhysicalAdapterKind } from "../app/physicalAdapterBinding.ts";
import { APP_LINK_SENTINEL_URL, createPhysicalLinkBaseline, observePhysicalLinkBaseline, readLinkSentinel } from "../app/physicalLinkRuntime.ts";

const origin = "http://192.0.2.10:3000";
const observedAt = "2026-09-30T10:00:00.000Z";
const targetUrl = (kind: PhysicalAdapterKind) => physicalAdapterReportUrl(APP_LINK_SENTINEL_URL, PHYSICAL_ADAPTER_TARGETS[kind], origin);
function report(kind: PhysicalAdapterKind) {
  const target = PHYSICAL_ADAPTER_TARGETS[kind];
  const adapter: AdapterRecord = {
    name: kind === "wifi" ? "WiFi \u00c9quipe" : "Ethernet", description: target.description, interfaceGuid: target.interfaceGuid,
    ifIndex: kind === "wifi" ? 12 : 23, status: "Up", mediaConnectionState: "Connected", virtual: false,
    mediaType: kind === "wifi" ? "Native 802.11" : "802.3", physicalMediaType: kind === "wifi" ? "Native 802.11" : "802.3",
  };
  return buildBoundPhysicalReport([adapter], observedAt, target);
}

for (const kind of ["ethernet", "wifi"] as const) test(`relay preserves exact ${kind} bytes and only requests the fixed local sentinel`, async t => {
  const raw = `${JSON.stringify(report(kind), null, 2)}\r\n`;
  const calls: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(String(input));
    assert.equal(init?.cache, "no-store"); assert.equal(init?.redirect, "manual");
    assert.ok(init?.signal instanceof AbortSignal);
    return new Response(raw, { headers: { "content-type": "application/json" } });
  });
  const response = await GET(new Request(targetUrl(kind)));
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new TextEncoder().encode(raw));
  assert.deepEqual(calls, [physicalAdapterReportUrl("http://127.0.0.1:4319/link", PHYSICAL_ADAPTER_TARGETS[kind])]);
});

test("relative browser URL stays on the application's origin, with explicit URL bases supported", async () => {
  const target = PHYSICAL_ADAPTER_TARGETS.wifi;
  const relative = physicalAdapterReportUrl(APP_LINK_SENTINEL_URL, target);
  assert.ok(relative.startsWith("/api/physical-link?"));
  assert.equal(new URL(relative, origin).href, targetUrl("wifi"));
  assert.equal(new URL(physicalAdapterReportUrl(APP_LINK_SENTINEL_URL, target, "https://demo.example")).origin, "https://demo.example");
  const actual = await readLinkSentinel(new AbortController().signal, async (url, init) => {
    assert.equal(url, relative); assert.equal(init?.cache, "no-store"); return Response.json(report("wifi"));
  }, undefined, target);
  assert.deepEqual(actual, report("wifi"));
});

test("missing, duplicate, unknown and URL-override query parameters never reach the sentinel", async t => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; throw new Error("unexpected network call"); });
  const valid = new URL(targetUrl("wifi"));
  const invalid = ["", "?adapter=wifi", `?adapter=ethernet&guid=${PHYSICAL_ADAPTER_TARGETS.wifi.interfaceGuid}`, "?adapter=vpn&guid=unknown",
    `${valid.search}&adapter=ethernet`, `${valid.search}&guid=${PHYSICAL_ADAPTER_TARGETS.wifi.interfaceGuid}`,
    `${valid.search}&url=https://external.example/link`, `${valid.search}&host=192.0.2.8`];
  for (const query of invalid) {
    const response = await GET(new Request(`${origin}/api/physical-link${query}`));
    assert.equal(response.status, 400); assert.deepEqual(await response.json(), SENTINEL_UNREACHABLE);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  assert.equal(calls, 0);
});

test("upstream errors, malformed reports and wrong physical targets remain UNKNOWN", async t => {
  const responses = [new Response("failure", { status: 503 }), new Response("not JSON"), Response.json({ link: "CONNECTED" }), Response.json(report("ethernet"))];
  t.mock.method(globalThis, "fetch", async () => {
    const response = responses.shift(); if (!response) throw new Error("sentinel unavailable"); return response;
  });
  for (let attempt = 0; attempt < 5; attempt++) {
    const response = await GET(new Request(targetUrl("wifi")));
    assert.equal(response.status, 503); assert.deepEqual(await response.json(), SENTINEL_UNREACHABLE);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
});

test("a genuine unknown observation is passed through without claiming connected or changing its time", async t => {
  const unknown = buildBoundPhysicalReport([], observedAt, PHYSICAL_ADAPTER_TARGETS.wifi);
  const raw = `${JSON.stringify(unknown)}\n`;
  t.mock.method(globalThis, "fetch", async () => new Response(raw));
  const response = await GET(new Request(targetUrl("wifi")));
  assert.equal(response.status, 200); assert.equal(await response.text(), raw);
});

test("relay never makes a pre-run observation fresh by rewriting its timestamp", async t => {
  const original = report("ethernet");
  t.mock.method(globalThis, "fetch", async () => Response.json(original));
  const relayed = await readLinkSentinel(new AbortController().signal, async url => GET(new Request(new URL(url, origin))), undefined, PHYSICAL_ADAPTER_TARGETS.ethernet);
  assert.deepEqual(relayed, original);
  const start = Date.parse(observedAt) + 100;
  const result = observePhysicalLinkBaseline(createPhysicalLinkBaseline("phone-run", start), relayed, start + 100);
  assert.equal(result.ready, false); assert.equal(result.reason, "BEFORE_RUN");
});

test("request cancellation aborts the local read and produces UNKNOWN", async t => {
  let upstream: AbortSignal | null = null;
  t.mock.method(globalThis, "fetch", async (_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    upstream = init?.signal ?? null;
    upstream?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
  }));
  const controller = new AbortController();
  const pending = GET(new Request(targetUrl("wifi"), { signal: controller.signal }));
  controller.abort();
  const response = await pending;
  assert.equal((upstream as AbortSignal | null)?.aborted, true);
  assert.equal(response.status, 503); assert.deepEqual(await response.json(), SENTINEL_UNREACHABLE);
});

test("an already cancelled browser request does not start another sentinel read", async t => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; throw new Error("unexpected read"); });
  const controller = new AbortController(); controller.abort();
  const response = await GET(new Request(targetUrl("wifi"), { signal: controller.signal }));
  assert.equal(response.status, 503); assert.equal(calls, 0);
});

test("upstream redirects are not followed and remain UNKNOWN in the worker-compatible manual mode", async t => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (_input: RequestInfo | URL, init?: RequestInit) => {
    calls++; assert.equal(init?.redirect, "manual");
    return new Response(null, { status: 302, headers: { location: "https://external.example/link" } });
  });
  const response = await GET(new Request(targetUrl("ethernet")));
  assert.equal(response.status, 503); assert.deepEqual(await response.json(), SENTINEL_UNREACHABLE);
  assert.equal(calls, 1);
});

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { buildBoundPhysicalReport, buildReport, SENTINEL_UNREACHABLE, type AdapterRecord } from "../app/ethernetLink.ts";
import { PHYSICAL_ADAPTER_TARGETS, bindPhysicalAdapterForRun, reportMatchesPhysicalBinding } from "../app/physicalAdapterBinding.ts";
import { admitPhysicalObservation, readLinkSentinel } from "../app/physicalLinkRuntime.ts";
import { PhysicalNetworkTransitionMachine } from "../app/networkTransitions.ts";
import { createOfflineEvidenceSession } from "../app/offlineEvidence.ts";
import { ETHERNET_ADAPTER_IDENTITY, WIFI_ADAPTER_IDENTITY, WIFI_PHYSICAL_SENTINEL_SOURCE } from "../app/physicalAdapterPolicy.ts";
import { buildSentinelReport, localEnvValues, physicalSentinelTargets, requestedPhysicalTarget } from "../scripts/link-sentinel.mjs";
import { isCompatibleSentinelHealth, sentinelHealth } from "../scripts/link-sentinel-service.mjs";

const target = PHYSICAL_ADAPTER_TARGETS.wifi;
const start = Date.parse("2026-09-29T12:00:00Z");
const wifi: AdapterRecord = { name: "WiFi", description: WIFI_ADAPTER_IDENTITY, interfaceGuid: target.interfaceGuid, status: "Up", mediaConnectionState: "Connected", mediaType: "Native 802.11", physicalMediaType: "Native 802.11", virtual: false, ifIndex: 12 };
const ethernet: AdapterRecord = { name: "Ethernet", description: ETHERNET_ADAPTER_IDENTITY, interfaceGuid: PHYSICAL_ADAPTER_TARGETS.ethernet.interfaceGuid, status: "Up", mediaConnectionState: "Connected", mediaType: "802.3", physicalMediaType: "802.3", virtual: false, ifIndex: 23 };
const observed = (offset: number) => new Date(start + offset).toISOString();
const report = (link: "CONNECTED" | "LOST", offset: number, change: Partial<AdapterRecord> = {}) => buildBoundPhysicalReport([{ ...wifi, mediaConnectionState: link === "CONNECTED" ? "Connected" : "Disconnected", status: link === "CONNECTED" ? "Up" : "Disconnected", ...change }], observed(offset), target);

test("explicit primary Wi-Fi ignores live Ethernet, Hyper-V and lower-index BE200 clones", () => {
  const inventory = [ethernet, { ...ethernet, name: "vEthernet (always up)", virtual: true, interfaceGuid: "00000000-0000-0000-0000-000000000004" }, { ...wifi, ifIndex: 5, interfaceGuid: "00000000-0000-0000-0000-000000000005" }, { ...wifi, ifIndex: 11, interfaceGuid: "00000000-0000-0000-0000-000000000011" }, { ...wifi, mediaConnectionState: "Disconnected", status: "Disconnected" }];
  const actual = buildBoundPhysicalReport(inventory, observed(0), target);
  assert.equal(actual.adapter?.ifIndex, 12); assert.equal(actual.link, "LOST");
  assert.equal(buildBoundPhysicalReport(inventory, observed(0), PHYSICAL_ADAPTER_TARGETS.ethernet).link, "CONNECTED");
  assert.deepEqual(buildSentinelReport(inventory, "wifi", observed(0)), actual);
});

test("missing, duplicate, virtual, wrong GUID, wrong media and Not Present primary are UNKNOWN", () => {
  for (const rows of [[], [wifi, { ...wifi, ifIndex: 7 }], [{ ...wifi, interfaceGuid: "00000000-0000-0000-0000-000000000012" }], [{ ...wifi, virtual: true }], [{ ...wifi, physicalMediaType: "802.3" }], [{ ...wifi, status: "Not Present" }], [{ ...wifi, description: "Other USB WiFi" }]]) {
    assert.equal(buildBoundPhysicalReport(rows, observed(0), target).link, "UNKNOWN");
    assert.equal(buildSentinelReport(rows, "wifi", observed(0)).link, "UNKNOWN");
  }
});

test("wire requests are target-specific and an older Ethernet sentinel is incompatible", async () => {
  const path = `/link?adapter=wifi&guid=${target.interfaceGuid}`;
  assert.equal(requestedPhysicalTarget(path), "wifi");
  assert.equal(requestedPhysicalTarget("/link"), "ethernet");
  for (const bad of ["/link?adapter=wifi", `/link?adapter=ethernet&guid=${target.interfaceGuid}`, "/link?adapter=vpn&guid=none"]) assert.equal(requestedPhysicalTarget(bad), null);
  const good = sentinelHealth(123); assert.equal(isCompatibleSentinelHealth(good), true);
  assert.equal(isCompatibleSentinelHealth({ ...good, protocol: 1 }), false);
  let request = "";
  const captured = await readLinkSentinel(new AbortController().signal, async url => { request = url; return Response.json(report("CONNECTED", 0)); }, undefined, target);
  assert.ok(request.startsWith("/api/physical-link?"), "browser polls its application origin, not phone loopback");
  assert.equal(new URL(request, "http://192.0.2.10:3000").searchParams.get("guid"), target.interfaceGuid); assert.equal(captured.link, "CONNECTED");
  const wrong = await readLinkSentinel(new AbortController().signal, async () => Response.json(buildBoundPhysicalReport([ethernet], observed(0), PHYSICAL_ADAPTER_TARGETS.ethernet)), undefined, target);
  assert.deepEqual(wrong, SENTINEL_UNREACHABLE);
});

test("run binding fixes GUID/name/index even after a stable sample cleared the candidate", () => {
  const binding = bindPhysicalAdapterForRun("bound-run", report("CONNECTED", 0), target)!;
  const machine = new PhysicalNetworkTransitionMachine({ runId: "bound-run", initialState: "CONNECTED", adapterBinding: binding });
  assert.equal(machine.observe(report("CONNECTED", 0), { evidenceClockMs: 0 }).reason, "STABLE");
  assert.equal(machine.snapshot().candidate, null);
  assert.equal(reportMatchesPhysicalBinding(report("LOST", 500, { ifIndex: 13 }), binding), false);
  assert.equal(machine.observe(report("LOST", 500, { ifIndex: 13 }), { evidenceClockMs: 1 }).reason, "UNOBSERVED_LINK");
  assert.equal(machine.observe(buildBoundPhysicalReport([ethernet], observed(1_000), PHYSICAL_ADAPTER_TARGETS.ethernet), { evidenceClockMs: 1 }).reason, "UNOBSERVED_LINK");
  assert.equal(machine.snapshot().lastObservationEpochMs, start);
  const restored = new PhysicalNetworkTransitionMachine({ runId: "bound-run", snapshot: machine.snapshot(), adapterBinding: binding });
  assert.equal(restored.observe(report("LOST", 1_500, { name: "replaced" }), { evidenceClockMs: 1 }).reason, "UNOBSERVED_LINK");
  assert.throws(() => new PhysicalNetworkTransitionMachine({ runId: "other-run", initialState: "CONNECTED", adapterBinding: binding }), /binding\/run/);
});

test("other adapter samples cannot accumulate a bound Wi-Fi debounce", () => {
  const binding = bindPhysicalAdapterForRun("bound-run", report("CONNECTED", 0), target)!;
  const machine = new PhysicalNetworkTransitionMachine({ runId: "bound-run", initialState: "CONNECTED", adapterBinding: binding });
  assert.equal(machine.observe(report("LOST", 0), { evidenceClockMs: 0 }).reason, "DEBOUNCING");
  assert.equal(machine.observe(report("LOST", 500, { ifIndex: 13 }), { evidenceClockMs: 1 }).reason, "UNOBSERVED_LINK");
  assert.equal(machine.snapshot().candidate?.count, 1);
  assert.equal(machine.observe(report("LOST", 1_000), { evidenceClockMs: 1 }).event?.nanoReceiptType, "NR-NET-LOST");
});

test("runtime emits real BE200 LOST/RESTORED, while duplicate and stale reports are inert", () => {
  let session = createOfflineEvidenceSession("wifi-cycle");
  let machine = new PhysicalNetworkTransitionMachine({ runId: session.runId, initialState: "CONNECTED" });
  const binding = bindPhysicalAdapterForRun(session.runId, report("CONNECTED", 0), target)!;
  for (const [link, offset] of [["CONNECTED", 0], ["LOST", 500], ["LOST", 1_000], ["LOST", 1_000], ["LOST", 750], ["CONNECTED", 1_500], ["CONNECTED", 2_000]] as const) {
    const outcome = admitPhysicalObservation({ session, machine, report: report(link, offset), binding, nowEpochMs: start + Math.max(offset, 1_000), masterTimeMs: offset });
    machine = outcome.machine;
    if (outcome.kind === "TRANSITION") session = outcome.session;
  }
  assert.equal(session.records.length, 2); assert.equal(session.networkState, "CONNECTED");
  assert.deepEqual(session.records.map(r => r.eventType), ["NETWORK_LINK_LOST", "NETWORK_LINK_RESTORED"]);
  for (const receipt of session.records) { assert.equal(receipt.payload.adapter_identity, WIFI_ADAPTER_IDENTITY); assert.equal(receipt.payload.observation_source, WIFI_PHYSICAL_SENTINEL_SOURCE); }
  assert.equal(machine.adapterBinding?.interfaceGuid, target.interfaceGuid);
});

test("runtime refusal rolls back with the same bound identity", () => {
  const session = createOfflineEvidenceSession("rollback-run");
  const binding = bindPhysicalAdapterForRun(session.runId, report("CONNECTED", 0), target)!;
  const machine = new PhysicalNetworkTransitionMachine({ runId: session.runId, initialState: "LOST", adapterBinding: binding });
  const refused = admitPhysicalObservation({ session, machine, report: report("LOST", 0), nowEpochMs: start, masterTimeMs: 0, binding });
  assert.equal(refused.kind, "REFUSED"); assert.deepEqual(refused.machine.adapterBinding, binding);
  assert.equal(refused.machine.observe(report("CONNECTED", 500, { ifIndex: 13 }), { evidenceClockMs: 1 }).reason, "UNOBSERVED_LINK");
});

test("legacy normalized I226 identity stays byte-compatible while unbound callers accept supported Wi-Fi", () => {
  const machine = new PhysicalNetworkTransitionMachine({ runId: "legacy", initialState: "CONNECTED" });
  const oldReport = (offset: number) => buildReport([{ ...ethernet, description: `  ${ETHERNET_ADAPTER_IDENTITY.toLowerCase()}  `, mediaConnectionState: "Disconnected" }], observed(offset));
  machine.observe(oldReport(0), { evidenceClockMs: 0 });
  assert.equal(machine.observe(oldReport(500), { evidenceClockMs: 1 }).event?.adapterIdentity.description, ETHERNET_ADAPTER_IDENTITY);
  assert.equal(machine.observe(report("CONNECTED", 1_000), { evidenceClockMs: 2 }).reason, "DEBOUNCING");
  assert.equal(machine.observe(report("CONNECTED", 1_500), { evidenceClockMs: 2 }).event?.adapterIdentity.description, WIFI_ADAPTER_IDENTITY);
});

test("the committed adapter GUIDs are placeholders; the demonstration host supplies its own in its git-ignored .env.local", () => {
  const PLACEHOLDERS = ["00000000-D006-4000-8000-000000000001", "00000000-D006-4000-8000-000000000002"];
  for (const file of ["../app/physicalAdapterBinding.ts", "../scripts/link-sentinel.mjs"]) {
    const guids = readFileSync(new URL(file, import.meta.url), "utf8").match(/[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}/gi) ?? [];
    assert.deepEqual([...new Set(guids)].sort(), PLACEHOLDERS, `${file} commits the two placeholders and no other adapter GUID`);
  }
  // Unconfigured, the sentinel and the application agree on placeholders that match no real adapter.
  const unset = physicalSentinelTargets({});
  assert.deepEqual([unset.ethernet.interfaceGuid, unset.wifi.interfaceGuid], PLACEHOLDERS);
  if (process.env.NEXT_PUBLIC_FORTIX_ETHERNET_GUID === undefined && process.env.NEXT_PUBLIC_FORTIX_WIFI_GUID === undefined) {
    assert.deepEqual([PHYSICAL_ADAPTER_TARGETS.ethernet.interfaceGuid, PHYSICAL_ADAPTER_TARGETS.wifi.interfaceGuid], PLACEHOLDERS);
  }
  // The sentinel reads .env then .env.local (the local file wins), normalizes, and refuses a malformed value.
  const directory = mkdtempSync(join(tmpdir(), "fortix-local-env-"));
  try {
    writeFileSync(join(directory, ".env"), "NEXT_PUBLIC_FORTIX_ETHERNET_GUID=11111111-2222-4333-8444-555555555555\nNEXT_PUBLIC_FORTIX_WIFI_GUID=not-a-guid\n");
    writeFileSync(join(directory, ".env.local"), "NEXT_PUBLIC_FORTIX_ETHERNET_GUID={aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee}\n");
    const configured = physicalSentinelTargets(localEnvValues(pathToFileURL(`${directory}/`)));
    assert.equal(configured.ethernet.interfaceGuid, "AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE");
    assert.equal(configured.wifi.interfaceGuid, PLACEHOLDERS[1], "a malformed value keeps the placeholder");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
  // The application reads the same two variables (the bundler inlines them; Node reads process.env).
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT; // the probe is a plain process, not a test-runner child
  const probe = `const { PHYSICAL_ADAPTER_TARGETS: t } = await import(${JSON.stringify(new URL("../app/physicalAdapterBinding.ts", import.meta.url).href)}); console.log(JSON.stringify([t.ethernet.interfaceGuid, t.wifi.interfaceGuid]));`;
  const child = spawnSync(process.execPath, ["--input-type=module", "--eval", probe], {
    encoding: "utf8",
    env: { ...env, NEXT_PUBLIC_FORTIX_ETHERNET_GUID: "{aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee}", NEXT_PUBLIC_FORTIX_WIFI_GUID: "11111111-2222-4333-8444-555555555555" },
  });
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(JSON.parse(child.stdout), ["AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE", "11111111-2222-4333-8444-555555555555"]);
  // The local configuration never reaches the repository.
  assert.match(readFileSync(new URL("../.gitignore", import.meta.url), "utf8"), /^\.env\*\r?$/m);
});

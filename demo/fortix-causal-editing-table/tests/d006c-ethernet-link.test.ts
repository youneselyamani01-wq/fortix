import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { en } from "../../../site/src/i18n/locales/en.ts";
import { fr } from "../../../site/src/i18n/locales/fr.ts";

import {
  SENTINEL_UNREACHABLE,
  buildReport,
  isFreshPhysicalLinkObservation,
  isLinkSentinelReport,
  isPhysicalEthernet,
  isTargetPhysicalEthernet,
  linkStateOf,
  selectPhysicalEthernet,
  visiblePhysicalLinkState,
  type AdapterRecord,
} from "../app/ethernetLink.ts";

/**
 * D-006C corrective pass — F1.
 *
 * The physical review failed because the UI reported a live connection while
 * the RJ45 cable was out. `navigator.onLine` cannot see a cable: it answers
 * whether the browser has *any* network path.
 *
 * The fixture below is the real `Get-NetAdapter` inventory of the ZBook this
 * demonstration runs on, captured on 2026-08-22. It is the whole reason this
 * logic is not a one-liner: ten adapters, of which **four Hyper-V virtual
 * switches report Up/Connected at all times**. Any rule shaped like "is some
 * 802.3 adapter connected?" would answer "yes" with the cable on the table —
 * which is exactly the defect being corrected.
 */
const ZBOOK_ADAPTERS: readonly AdapterRecord[] = Object.freeze([
  { name: "WiFi 2", description: "Intel(R) Wi-Fi 7 BE200 320MHz", status: "Not Present", mediaConnectionState: "Unknown", mediaType: "Native 802.11", physicalMediaType: "Native 802.11", virtual: false, ifIndex: 31 },
  { name: "vEthernet (fortix-core)", description: "Hyper-V Virtual Ethernet Adapter #3", status: "Up", mediaConnectionState: "Connected", mediaType: "802.3", physicalMediaType: "Unspecified", virtual: true, ifIndex: 30 },
  { name: "Network Bridge", description: "Microsoft Network Adapter Multiplexor Driver", status: "Disconnected", mediaConnectionState: "Disconnected", mediaType: "802.3", physicalMediaType: "802.3", virtual: true, ifIndex: 27 },
  { name: "Ethernet", description: "Intel(R) Ethernet Controller I226-LM", status: "Up", mediaConnectionState: "Connected", mediaType: "802.3", physicalMediaType: "802.3", virtual: false, ifIndex: 24 },
  { name: "vEthernet (ext-wifi)", description: "Hyper-V Virtual Ethernet Adapter #5", status: "Disconnected", mediaConnectionState: "Disconnected", mediaType: "802.3", physicalMediaType: "Unspecified", virtual: true, ifIndex: 21 },
  { name: "WiFi 3", description: "Intel(R) Wi-Fi 7 BE200 320MHz", status: "Not Present", mediaConnectionState: "Unknown", mediaType: "Native 802.11", physicalMediaType: "Native 802.11", virtual: false, ifIndex: 20 },
  { name: "WiFi", description: "Intel(R) Wi-Fi 7 BE200 320MHz", status: "Disconnected", mediaConnectionState: "Disconnected", mediaType: "Native 802.11", physicalMediaType: "Native 802.11", virtual: false, ifIndex: 12 },
  { name: "vEthernet (Default Switch)", description: "Hyper-V Virtual Ethernet Adapter", status: "Up", mediaConnectionState: "Connected", mediaType: "802.3", physicalMediaType: "Unspecified", virtual: true, ifIndex: 33 },
  { name: "vEthernet (WSL (Hyper-V firewall))", description: "Hyper-V Virtual Ethernet Adapter #2", status: "Up", mediaConnectionState: "Connected", mediaType: "802.3", physicalMediaType: "Unspecified", virtual: true, ifIndex: 74 },
  { name: "vEthernet (mgmt)", description: "Hyper-V Virtual Ethernet Adapter #4", status: "Up", mediaConnectionState: "Connected", mediaType: "802.3", physicalMediaType: "Unspecified", virtual: true, ifIndex: 4 },
]);

/** The same machine with the RJ45 pulled: only the Intel port changes. */
const CABLE_REMOVED: readonly AdapterRecord[] = ZBOOK_ADAPTERS.map((adapter) => (
  adapter.name === "Ethernet"
    ? { ...adapter, status: "Disconnected", mediaConnectionState: "Disconnected" }
    : adapter
));

test("F1: exactly one adapter on this machine is the RJ45 port", () => {
  const physical = ZBOOK_ADAPTERS.filter(isPhysicalEthernet);
  assert.deepEqual(physical.map((a) => a.name), ["Ethernet"]);
  assert.equal(selectPhysicalEthernet(ZBOOK_ADAPTERS)?.ifIndex, 24);
});

test("F1: four Hyper-V switches report Connected and none of them may be chosen", () => {
  // The falsification that matters: these are live right now.
  const liveVirtual = ZBOOK_ADAPTERS.filter((a) => a.virtual && a.mediaConnectionState === "Connected");
  assert.equal(liveVirtual.length, 4, "fixture no longer reproduces the masking condition");
  for (const adapter of liveVirtual) {
    assert.equal(isPhysicalEthernet(adapter), false, `${adapter.name} was treated as the RJ45 port`);
  }
});

test("F1: pulling the cable reports LOST even though the virtual switches stay up", () => {
  assert.equal(buildReport(ZBOOK_ADAPTERS, "t0").link, "CONNECTED");
  const report = buildReport(CABLE_REMOVED, "t1");
  assert.equal(report.link, "LOST");
  assert.equal(report.adapter?.name, "Ethernet");
  // The masking adapters are untouched by the cable, which is the whole point.
  assert.equal(CABLE_REMOVED.filter((a) => a.virtual && a.mediaConnectionState === "Connected").length, 4);
});

test("F1: Wi-Fi can never stand in for the Ethernet port", () => {
  const wifiOnly = ZBOOK_ADAPTERS
    .filter((a) => a.mediaType === "Native 802.11")
    .map((a) => ({ ...a, status: "Up", mediaConnectionState: "Connected" }));
  assert.equal(selectPhysicalEthernet(wifiOnly), null);
  assert.equal(buildReport(wifiOnly, "t").link, "UNKNOWN");
});

test("F1: the Multiplexor bridge is excluded by its virtual flag alone", () => {
  // It is the one adapter whose physicalMediaType really is 802.3, so the
  // media-type filters do not catch it; `virtual` is what must.
  const bridge = ZBOOK_ADAPTERS.find((a) => a.name === "Network Bridge");
  assert.ok(bridge);
  assert.equal(bridge.physicalMediaType, "802.3");
  assert.equal(isPhysicalEthernet(bridge), false);
});

test("final convergence: a second connected physical port cannot mask the disconnected I226-LM", () => {
  const twoPorts: AdapterRecord[] = [
    { ...ZBOOK_ADAPTERS[3]!, status: "Disconnected", mediaConnectionState: "Disconnected" },
    { ...ZBOOK_ADAPTERS[3]!, name: "USB Ethernet", description: "Realtek USB GbE Family Controller", ifIndex: 9 },
  ];
  assert.equal(selectPhysicalEthernet(twoPorts)?.name, "Ethernet");
  assert.equal(buildReport(twoPorts, "t").link, "LOST");
  assert.equal(selectPhysicalEthernet([...twoPorts].reverse())?.name, "Ethernet");
  assert.equal(isTargetPhysicalEthernet(twoPorts[1]!), false);
});

test("final convergence: target absence and transient media state are UNKNOWN", () => {
  const otherPhysical = { ...ZBOOK_ADAPTERS[3]!, description: "Realtek USB GbE Family Controller" };
  assert.equal(buildReport([otherPhysical], "t").link, "UNKNOWN");
  const transient = { ...ZBOOK_ADAPTERS[3]!, status: "Unknown", mediaConnectionState: "Unknown" };
  assert.equal(linkStateOf(transient), "UNKNOWN");
  assert.equal(buildReport([transient], "t").link, "UNKNOWN");
});

test("F1: an unreachable sentinel is UNKNOWN, never CONNECTED", () => {
  // The failure mode being corrected is claiming more than was observed.
  assert.equal(SENTINEL_UNREACHABLE.link, "UNKNOWN");
  assert.equal(linkStateOf(null), "UNKNOWN");
  assert.equal(isLinkSentinelReport(buildReport(ZBOOK_ADAPTERS, "2026-09-02T10:00:00.000Z")), true);
  assert.equal(isLinkSentinelReport(buildReport(ZBOOK_ADAPTERS, "not-a-time")), false);
  assert.equal(isLinkSentinelReport({ sentinel: "OK", link: "CONNECTED", observedAt: "t" }), false);
});

test("final convergence: incoherent sentinel reports are rejected", () => {
  assert.equal(isLinkSentinelReport({ sentinel: "NO_ADAPTER", adapter: null, link: "CONNECTED", observedAt: "t", externalReachability: "NOT_MEASURED" }), false);
  assert.equal(isLinkSentinelReport({ sentinel: "QUERY_FAILED", adapter: null, link: "LOST", observedAt: "t", externalReachability: "NOT_MEASURED" }), false);
  assert.equal(isLinkSentinelReport({ sentinel: "OK", adapter: null, link: "CONNECTED", observedAt: "t", externalReachability: "NOT_MEASURED" }), false);
  const connected = buildReport(ZBOOK_ADAPTERS, "t");
  assert.equal(isLinkSentinelReport({ ...connected, link: "LOST" }), false);
});

test("F2: no report may ever claim external reachability", () => {
  for (const adapters of [ZBOOK_ADAPTERS, CABLE_REMOVED]) {
    assert.equal(buildReport(adapters, "t").externalReachability, "NOT_MEASURED");
  }
  assert.equal(SENTINEL_UNREACHABLE.externalReachability, "NOT_MEASURED");
});

test("F1: the sentinel exposes only physical link state", () => {
  assert.equal(buildReport(ZBOOK_ADAPTERS, "connected").link, "CONNECTED");
  assert.equal(buildReport(CABLE_REMOVED, "lost").link, "LOST");
  assert.equal(SENTINEL_UNREACHABLE.link, "UNKNOWN");
});

test("C2: an internal journal baseline can never masquerade as a visible physical observation", () => {
  const connected = buildReport(ZBOOK_ADAPTERS, "2026-09-02T10:00:00.000Z");
  const lost = buildReport(CABLE_REMOVED, "2026-09-02T10:00:01.000Z");
  assert.equal(visiblePhysicalLinkState(SENTINEL_UNREACHABLE, "CONNECTED"), "UNKNOWN");
  assert.equal(visiblePhysicalLinkState(connected, "CONNECTED"), "CONNECTED");
  assert.equal(visiblePhysicalLinkState(lost, "LOST"), "LOST");
  assert.equal(visiblePhysicalLinkState(lost, "CONNECTED"), "UNKNOWN");
  assert.equal(visiblePhysicalLinkState(connected, "LOST"), "UNKNOWN");
  assert.equal(visiblePhysicalLinkState({ ...connected, observedAt: "not-a-time" }, "CONNECTED"), "UNKNOWN");
});

test("C2: duplicate sidecar samples remain usable only inside a bounded freshness window", () => {
  const observedAt = "2026-09-02T10:00:00.000Z";
  const connected = buildReport(ZBOOK_ADAPTERS, observedAt);
  const observedEpochMs = Date.parse(observedAt);
  assert.equal(isFreshPhysicalLinkObservation(connected, observedEpochMs, 5_000), true);
  assert.equal(isFreshPhysicalLinkObservation(connected, observedEpochMs + 5_000, 5_000), true);
  assert.equal(isFreshPhysicalLinkObservation(connected, observedEpochMs + 5_001, 5_000), false);
  assert.equal(isFreshPhysicalLinkObservation(connected, observedEpochMs - 1, 5_000), false);
  assert.equal(isFreshPhysicalLinkObservation(SENTINEL_UNREACHABLE, observedEpochMs, 5_000), false);
});

test("F1: the sentinel sidecar and the tested model apply the same rule", () => {
  // The sidecar is plain .mjs run before any bundler exists, so it restates
  // the filter rather than importing it. If the two ever diverge, the demo
  // reports one thing and the tests prove another.
  const sentinel = readFileSync(new URL("../scripts/link-sentinel.mjs", import.meta.url), "utf8");
  assert.match(sentinel, /!a\.virtual/);
  assert.match(sentinel, /a\.mediaType === ETHERNET_MEDIA_TYPE/);
  assert.match(sentinel, /a\.physicalMediaType === ETHERNET_MEDIA_TYPE/);
  assert.match(sentinel, /\^vEthernet\[\\s\(\]/);
  assert.match(sentinel, /TARGET_ETHERNET_DESCRIPTION/);
  assert.match(sentinel, /isTargetPhysicalEthernet/);
  assert.match(sentinel, /externalReachability: "NOT_MEASURED"/);
  assert.doesNotMatch(sentinel, /setInterval\(/, "PowerShell polls must not overlap");
  // And it must never test the Internet and call it a link state.
  assert.doesNotMatch(sentinel, /Test-Connection|Test-NetConnection|ping/i);
});

/* --- F7: no stale D-005 identity in the D-006 experience ----------------- */

test("F7: the visible mission identity is D-006's own, not a D-005 chain id", () => {
  const component = readFileSync(new URL("../app/ConvergenceExperience.tsx", import.meta.url), "utf8");
  assert.match(component, /const d006c2 = t\.d006c2/);
  assert.match(component, /\{d006c2\.missionKicker\}/);
  for (const dictionary of [en, fr]) {
    assert.match(dictionary.d006c2.missionKicker, /D-006/);
    assert.match(dictionary.d006c2.missionKicker, /TAXI 07/);
  }
  assert.doesNotMatch(component, />\{LOCAL_EVIDENCE_RECORD\.missionId\}</);
  assert.match(component, /const D006_MISSION_LABEL = "D-006 · TAXI 07";/);
});

test("F7: no D-005 identifier appears in any string the viewer can read", () => {
  const component = readFileSync(new URL("../app/ConvergenceExperience.tsx", import.meta.url), "utf8");
  // Strip comments and JSX expressions, leaving literal copy and attributes.
  const visible = component
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");
  const offenders = [...visible.matchAll(/"[^"]*\bd005\b[^"]*"/gi)].map((m) => m[0]);
  assert.deepEqual(offenders, [], `D-005 identifiers reachable as viewer copy: ${offenders.join(", ")}`);
});

test("F7: the canonical chain id is deliberately unchanged and stays evidence-bound", () => {
  // Renaming it would change the canonical bundle text and invalidate every
  // payload digest in the signed set, so the corrective pass must NOT do it.
  const continuity = readFileSync(new URL("../app/missionContinuity.ts", import.meta.url), "utf8");
  assert.match(continuity, /export const MISSION_ID = "fortix\.demo\.d005\.operational-cycle-001";/);
  assert.match(continuity, /evidence-critical/);
});

/**
 * D-006C corrective pass — physical adapter link sentinel.
 *
 * WHY THIS IS A SEPARATE PROCESS.
 * The application's API routes run inside workerd (the Cloudflare vite
 * plugin owns the `rsc` environment). workerd exposes `node:child_process`
 * but every spawn method is an unimplemented stub — verified directly:
 *
 *   execSync   ERR_METHOD_NOT_IMPLEMENTED
 *   spawnSync  ERR_METHOD_NOT_IMPLEMENTED
 *   spawn      ERR_METHOD_NOT_IMPLEMENTED
 *   execFile   ERR_METHOD_NOT_IMPLEMENTED
 *
 * So a route cannot ask Windows anything. This sidecar is plain Node, reads
 * the adapter table through PowerShell, and serves it on loopback.
 *
 * WHAT IT DOES NOT CLAIM.
 * It reports one fact: whether the selected physical interface reports a link.
 * It does not test the Internet, and `externalReachability` is always
 * NOT_MEASURED. Reaching this sentinel is not evidence of connectivity —
 * loopback answers with the cable out, which is the entire point.
 *
 * Run:  node scripts/link-sentinel.mjs [--port 4319] [--poll-ms 500]
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { parseEnv } from "node:util";
import { sentinelHealth } from "./link-sentinel-service.mjs";

const RUN_AS_SERVICE = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
// The demonstration host's adapter GUIDs live in the demo's git-ignored local
// configuration, the .env.local its bundler reads too. Only the running service
// loads it; a module that imports this file (a test) keeps its own environment.
if (RUN_AS_SERVICE) loadLocalEnv();

/**
 * .env then .env.local of the demo (the local file wins), parsed, never evaluated.
 * @returns {Record<string, string>}
 */
export function localEnvValues(directory = new URL("../", import.meta.url)) {
  /** @type {Record<string, string>} */
  const values = {};
  for (const name of [".env", ".env.local"]) {
    let text;
    try { text = readFileSync(new URL(name, directory), "utf8"); } catch { continue; }
    Object.assign(values, parseEnv(text));
  }
  return values;
}

/** A value already in the environment wins over the local files. */
function loadLocalEnv() {
  for (const [key, value] of Object.entries(localEnvValues())) if (process.env[key] === undefined) process.env[key] = value;
}

const PORT = Number(
  process.argv.includes("--port")
    ? process.argv[process.argv.indexOf("--port") + 1]
    : process.env.FORTIX_LINK_SENTINEL_PORT ?? 4319,
);
const DEFAULT_POLL_MS = 500;
const pollArgument = process.argv.includes("--poll-ms")
  ? process.argv[process.argv.indexOf("--poll-ms") + 1]
  : process.env.FORTIX_LINK_SENTINEL_POLL_MS;
const requestedPollMs = Number(pollArgument ?? DEFAULT_POLL_MS);
// A floor protects the machine from accidental PowerShell spawn storms. The
// next poll is scheduled only after the preceding Get-NetAdapter query ends.
const POLL_MS = Number.isFinite(requestedPollMs) && requestedPollMs >= 100
  ? Math.floor(requestedPollMs)
  : DEFAULT_POLL_MS;

// Every field the selection logic needs, forced to strings so the JSON shape
// does not depend on how PowerShell renders enums.
const QUERY = `
$ErrorActionPreference = 'Stop'
Get-NetAdapter -IncludeHidden | ForEach-Object {
  [pscustomobject]@{
    name                 = [string]$_.Name
    description          = [string]$_.InterfaceDescription
    status               = [string]$_.Status
    mediaConnectionState = [string]$_.MediaConnectionState
    mediaType            = [string]$_.MediaType
    physicalMediaType    = [string]$_.PhysicalMediaType
    virtual              = [bool]$_.Virtual
    ifIndex              = [int]$_.ifIndex
    interfaceGuid        = [string]$_.InterfaceGuid
  }
} | ConvertTo-Json -Compress
`;  // Windows PowerShell 5.1 has no -AsArray; a single adapter arrives as an object.

function queryAdapters() {
  return new Promise((resolve) => {
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", QUERY],
      { windowsHide: true },
    );
    let out = "";
    let err = "";
    const timer = setTimeout(() => child.kill(), 5_000);
    child.stdout.on("data", (chunk) => { out += chunk; });
    child.stderr.on("data", (chunk) => { err += chunk; });
    child.on("error", () => { clearTimeout(timer); resolve({ error: "SPAWN_FAILED" }); });
    child.on("close", () => {
      clearTimeout(timer);
      try {
        resolve({ adapters: JSON.parse(out) });
      } catch {
        resolve({ error: err.trim().slice(0, 200) || "PARSE_FAILED" });
      }
    });
  });
}

// --- selection, mirroring app/ethernetLink.ts -------------------------------
// Duplicated rather than imported: this file is plain .mjs run by Node before
// any bundler exists. app/ethernetLink.ts is the tested source of truth and
// tests/d006c-ethernet-link.test.ts asserts the two agree.
const ETHERNET_MEDIA_TYPE = "802.3";
const TARGET_ETHERNET_DESCRIPTION = "Intel(R) Ethernet Controller I226-LM";

const isPhysicalEthernet = (a) =>
  !a.virtual
  && a.mediaType === ETHERNET_MEDIA_TYPE
  && a.physicalMediaType === ETHERNET_MEDIA_TYPE
  && !/^vEthernet[\s(]/i.test(a.name);

const isTargetPhysicalEthernet = (a) =>
  isPhysicalEthernet(a)
  && String(a.description).trim().toLowerCase() === TARGET_ETHERNET_DESCRIPTION.toLowerCase();

const linkStateOf = (a) => {
  if (a === null) return "UNKNOWN";
  const state = String(a.mediaConnectionState).trim().toLowerCase();
  if (state === "connected") return "CONNECTED";
  if (state === "disconnected") return "LOST";
  return "UNKNOWN";
};

/** A configured GUID, normalized like app/physicalAdapterBinding.ts; a missing or malformed one keeps the placeholder. */
function configuredGuid(value, placeholder) {
  const guid = typeof value === "string" ? value.trim().replace(/^\{(.*)\}$/, "$1").toUpperCase() : "";
  return /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/.test(guid) ? guid : placeholder;
}
/**
 * The same variables as the application; the committed fallbacks are placeholders that match no real adapter.
 * @param {Record<string, string | undefined>} [env]
 */
export function physicalSentinelTargets(env = process.env) {
  return Object.freeze({
    ethernet: Object.freeze({ description: TARGET_ETHERNET_DESCRIPTION, interfaceGuid: configuredGuid(env.NEXT_PUBLIC_FORTIX_ETHERNET_GUID, "00000000-D006-4000-8000-000000000001") }),
    wifi: Object.freeze({ description: "Intel(R) Wi-Fi 7 BE200 320MHz", interfaceGuid: configuredGuid(env.NEXT_PUBLIC_FORTIX_WIFI_GUID, "00000000-D006-4000-8000-000000000002") }),
  });
}
export const PHYSICAL_SENTINEL_TARGETS = physicalSentinelTargets();
const normalizedGuid = (value) => typeof value === "string" ? value.trim().replace(/^\{(.*)\}$/, "$1").toUpperCase() : null;

/** One exact GUID, independently of every other link state. */
export function buildSentinelReport(adapters, kind, observedAt) {
  const target = kind === "ethernet" || kind === "wifi" ? PHYSICAL_SENTINEL_TARGETS[kind] : undefined;
  const rows = target === undefined ? [] : adapters.filter((a) => a && normalizedGuid(a.interfaceGuid) === target.interfaceGuid);
  let adapter = rows.length === 1 ? rows[0] : null;
  if (adapter !== null) {
    const physical = kind === "ethernet" ? isTargetPhysicalEthernet(adapter)
      : !adapter.virtual && adapter.mediaType === "Native 802.11" && adapter.physicalMediaType === "Native 802.11"
        && !/^vEthernet[\s(]/i.test(adapter.name);
    if (!physical || adapter.description !== target.description || String(adapter.status).toLowerCase() === "not present") adapter = null;
  }
  return { sentinel: adapter === null ? "NO_ADAPTER" : "OK", adapter, link: linkStateOf(adapter), observedAt, externalReachability: "NOT_MEASURED" };
}

/** A target query never mutates the service's targets for another tab. */
export function requestedPhysicalTarget(requestUrl) {
  const url = new URL(requestUrl, "http://127.0.0.1");
  if (url.pathname !== "/link") return null;
  if (url.search === "") return "ethernet"; // existing RJ45-only callers
  const kind = url.searchParams.get("adapter");
  const target = kind === "ethernet" || kind === "wifi" ? PHYSICAL_SENTINEL_TARGETS[kind] : undefined;
  return target !== undefined && normalizedGuid(url.searchParams.get("guid")) === target.interfaceGuid ? kind : null;
}

const unavailable = (observedAt) => ({ sentinel: "QUERY_FAILED", adapter: null, link: "UNKNOWN", observedAt, externalReachability: "NOT_MEASURED" });
let reports = { ethernet: unavailable(new Date().toISOString()), wifi: unavailable(new Date().toISOString()) };
const previousLinks = {};
async function poll() {
  const result = await queryAdapters();
  const observedAt = new Date().toISOString();
  const adapters = result.error === undefined ? (Array.isArray(result.adapters) ? result.adapters : [result.adapters]) : null;
  reports = Object.fromEntries(Object.keys(PHYSICAL_SENTINEL_TARGETS).map(kind => [kind,
    adapters === null ? unavailable(observedAt) : buildSentinelReport(adapters, kind, observedAt),
  ]));
  for (const [kind, report] of Object.entries(reports)) {
    if (report.link === previousLinks[kind]) continue;
    console.log(`[link-sentinel] ${kind} ${report.link} · ${report.adapter?.name ?? "target unavailable"} · ${observedAt}`);
    previousLinks[kind] = report.link;
  }
}

export function startLinkSentinel() {
  return createServer((request, response) => {
    response.setHeader("access-control-allow-origin", "*");
    response.setHeader("cache-control", "no-store");
    if (request.method === "OPTIONS") { response.writeHead(204).end(); return; }
    if (request.url === "/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(sentinelHealth(process.pid)));
      return;
    }
    const kind = requestedPhysicalTarget(request.url);
    if (kind === null) { response.writeHead(400).end(); return; }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(reports[kind]));
  }).listen(PORT, "127.0.0.1", async () => {
    console.log(`[link-sentinel] listening on http://127.0.0.1:${PORT}/link (explicit Ethernet / Wi-Fi GUID binding)`);
    console.log(`[link-sentinel] serialized adapter poll every ${POLL_MS} ms after each completed query`);
    console.log("[link-sentinel] reports selected physical interface only; it does not measure the Internet.");
    const loop = async () => {
      await poll();
      setTimeout(() => { void loop(); }, POLL_MS);
    };
    await loop();
  });
}

if (RUN_AS_SERVICE) startLinkSentinel();

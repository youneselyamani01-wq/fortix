import { PHYSICAL_ADAPTER_TARGETS, adapterMatchesPhysicalTarget, normalizedInterfaceGuid, type PhysicalAdapterTarget } from "./physicalAdapterBinding.ts";

/**
 * D-006C corrective pass — physical Ethernet link truth.
 *
 * The demonstration's central physical action is a presenter pulling the RJ45
 * cable. The previous model asked `navigator.onLine`, which answers a
 * different question: it reports whether the *browser* believes it has any
 * network path at all. On this ZBook that stays true when the Ethernet cable
 * is removed, because Wi-Fi and six Hyper-V virtual adapters remain up. The
 * UI therefore kept reporting a connection while the cable lay on the table.
 *
 * Three states are kept deliberately separate here, and nothing infers one
 * from another:
 *
 *   A. PHYSICAL ETHERNET LINK — what the adapter reports. Observed.
 *   B. LOCAL APPLICATION      — still running. Independent of A.
 *   C. EXTERNAL REACHABILITY  — NOT measured in this phase. Never claimed.
 *
 * A same-origin request cannot distinguish A from B: localhost answers with
 * the cable out. So a same-origin acknowledgement is never evidence of C.
 */

/** One row of `Get-NetAdapter`, normalised to strings by the sentinel. */
export type AdapterRecord = Readonly<{
  name: string;
  description: string;
  status: string;
  mediaConnectionState: string;
  mediaType: string;
  physicalMediaType: string;
  virtual: boolean;
  ifIndex: number;
  /** Physical capture metadata; absent from legacy fixtures and canonical receipts. */
  interfaceGuid?: string;
}>;

export type EthernetLinkState = "CONNECTED" | "LOST" | "UNKNOWN";

/**
 * What the frontend is allowed to say. `UNKNOWN` is a real answer: if the
 * sentinel is not running we do not know the cable state, and saying
 * "connected" would be the same lie `navigator.onLine` told.
 */
export type LinkSentinelReport = Readonly<{
  sentinel: "OK" | "NO_ADAPTER" | "QUERY_FAILED";
  adapter: AdapterRecord | null;
  link: EthernetLinkState;
  observedAt: string;
  /** Always NOT_MEASURED in this phase. There is no external probe. */
  externalReachability: "NOT_MEASURED";
}>;

/** IEEE 802.3. Wi-Fi reports `Native 802.11` and is excluded by this alone. */
const ETHERNET_MEDIA_TYPE = "802.3";

/** The one RJ45 port used by the physical D-006 demonstration. */
export const TARGET_ETHERNET_DESCRIPTION = "Intel(R) Ethernet Controller I226-LM";

/**
 * Hyper-V's virtual switches also report mediaType 802.3, and on this machine
 * four of them are `Up`/`Connected` at all times — they would mask the cable
 * removal completely. They are excluded three ways, because any single signal
 * could change: the `Virtual` flag, a `physicalMediaType` that is not 802.3
 * (Hyper-V reports `Unspecified`), and a `vEthernet (...)` name.
 */
export function isPhysicalEthernet(adapter: AdapterRecord): boolean {
  if (adapter.virtual) return false;
  if (adapter.mediaType !== ETHERNET_MEDIA_TYPE) return false;
  if (adapter.physicalMediaType !== ETHERNET_MEDIA_TYPE) return false;
  if (/^vEthernet[\s(]/i.test(adapter.name)) return false;
  return true;
}

/**
 * A second USB/dock Ethernet port must never mask removal of the ZBook RJ45.
 * The demonstration is explicitly about this built-in controller, so broad
 * "some physical Ethernet is up" selection is not physically truthful.
 */
export function isTargetPhysicalEthernet(adapter: AdapterRecord): boolean {
  return isPhysicalEthernet(adapter)
    && adapter.description.trim().toLowerCase() === TARGET_ETHERNET_DESCRIPTION.toLowerCase();
}

/**
 * The adapter the RJ45 demonstration is about. Only the built-in I226-LM is a
 * candidate. If Windows exposes duplicate rows, the lowest interface index is
 * a stable tie-break; link state never influences identity selection.
 */
export function selectPhysicalEthernet(adapters: readonly AdapterRecord[]): AdapterRecord | null {
  const targets = adapters.filter(isTargetPhysicalEthernet);
  if (targets.length === 0) return null;
  return [...targets].sort((left, right) => left.ifIndex - right.ifIndex)[0] ?? null;
}

/** Cable state. `MediaConnectionState` is the field that tracks the RJ45. */
export function isLinkUp(adapter: AdapterRecord): boolean {
  return adapter.mediaConnectionState.toLowerCase() === "connected";
}

export function linkStateOf(adapter: AdapterRecord | null): EthernetLinkState {
  if (adapter === null) return "UNKNOWN";
  const state = adapter.mediaConnectionState.trim().toLowerCase();
  if (state === "connected") return "CONNECTED";
  if (state === "disconnected") return "LOST";
  return "UNKNOWN";
}

export function buildReport(
  adapters: readonly AdapterRecord[],
  observedAt: string,
): LinkSentinelReport {
  const adapter = selectPhysicalEthernet(adapters);
  return {
    sentinel: adapter === null ? "NO_ADAPTER" : "OK",
    adapter,
    link: linkStateOf(adapter),
    observedAt,
    externalReachability: "NOT_MEASURED",
  };
}

/** Guards the wire format; an unreachable sentinel must not read as connected. */
export function isLinkSentinelReport(value: unknown): value is LinkSentinelReport {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (record.sentinel !== "OK" && record.sentinel !== "NO_ADAPTER" && record.sentinel !== "QUERY_FAILED") return false;
  if (record.link !== "CONNECTED" && record.link !== "LOST" && record.link !== "UNKNOWN") return false;
  if (record.externalReachability !== "NOT_MEASURED") return false;
  if (typeof record.observedAt !== "string" || !Number.isFinite(Date.parse(record.observedAt))) return false;
  if (record.sentinel === "OK") {
    if (!isAdapterRecord(record.adapter) || (!isTargetPhysicalEthernet(record.adapter) && !adapterMatchesPhysicalTarget(record.adapter, PHYSICAL_ADAPTER_TARGETS.wifi))) return false;
    return record.link === linkStateOf(record.adapter);
  }
  return record.adapter === null && record.link === "UNKNOWN";
}

function isAdapterRecord(value: unknown): value is AdapterRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.name === "string"
    && typeof record.description === "string"
    && typeof record.status === "string"
    && typeof record.mediaConnectionState === "string"
    && typeof record.mediaType === "string"
    && typeof record.physicalMediaType === "string"
    && typeof record.virtual === "boolean"
    && typeof record.ifIndex === "number"
    && Number.isInteger(record.ifIndex)
    && record.ifIndex >= 0
    && (record.interfaceGuid === undefined || normalizedInterfaceGuid(record.interfaceGuid) !== null);
}

/** The report used when the sentinel cannot be reached at all. */
export const SENTINEL_UNREACHABLE: LinkSentinelReport = Object.freeze({
  sentinel: "QUERY_FAILED",
  adapter: null,
  link: "UNKNOWN",
  observedAt: "",
  externalReachability: "NOT_MEASURED",
});

/**
 * Current link truth shown to a spectator. The transition machine may carry a
 * journal-aligned CONNECTED baseline before the sentinel has answered, but a
 * baseline is not a physical observation. A newly different sample also stays
 * UNKNOWN until the debounced transition has been admitted to the journal.
 */
export function visiblePhysicalLinkState(
  report: LinkSentinelReport,
  admittedState: EthernetLinkState,
): EthernetLinkState {
  if (report.sentinel !== "OK" || report.adapter === null || report.link === "UNKNOWN") return "UNKNOWN";
  if (!Number.isFinite(Date.parse(report.observedAt))) return "UNKNOWN";
  return report.link === admittedState ? report.link : "UNKNOWN";
}

/**
 * A sidecar response can be structurally valid while still being an old
 * cached sample. Keep that distinction explicit: duplicate reads are normal
 * between the sidecar's serialized Windows queries, but they stop supporting
 * a live physical claim after this bounded age.
 */
export function isFreshPhysicalLinkObservation(
  report: LinkSentinelReport,
  nowEpochMs: number,
  maximumAgeMs: number,
): boolean {
  if (!Number.isFinite(nowEpochMs) || !Number.isFinite(maximumAgeMs) || maximumAgeMs < 0) return false;
  if (!isLinkSentinelReport(report) || report.sentinel !== "OK" || report.adapter === null) return false;
  if (report.link !== "CONNECTED" && report.link !== "LOST") return false;
  const observedEpochMs = Date.parse(report.observedAt);
  const ageMs = nowEpochMs - observedEpochMs;
  return ageMs >= 0 && ageMs <= maximumAgeMs;
}

/** Resolve only the explicitly configured physical GUID. No Up/index/route fallback. */
export function buildBoundPhysicalReport(
  adapters: readonly AdapterRecord[], observedAt: string, target: PhysicalAdapterTarget,
): LinkSentinelReport {
  const candidates = adapters.filter((adapter) => normalizedInterfaceGuid(adapter.interfaceGuid) === target.interfaceGuid);
  const adapter = candidates.length === 1 && adapterMatchesPhysicalTarget(candidates[0]!, target) ? candidates[0]! : null;
  return { sentinel: adapter === null ? "NO_ADAPTER" : "OK", adapter, link: linkStateOf(adapter), observedAt, externalReachability: "NOT_MEASURED" };
}

export function isPhysicalReportForTarget(report: LinkSentinelReport, target: PhysicalAdapterTarget): boolean {
  return isLinkSentinelReport(report) && (report.sentinel !== "OK"
    || (report.adapter !== null && adapterMatchesPhysicalTarget(report.adapter, target)));
}

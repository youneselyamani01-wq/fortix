import { SENTINEL_UNREACHABLE, isFreshPhysicalLinkObservation, isPhysicalReportForTarget, type LinkSentinelReport } from "./ethernetLink.ts";
import { PHYSICAL_ADAPTER_TARGETS, type PhysicalAdapterKind } from "./physicalAdapterBinding.ts";

/**
 * Connectivity media understood by D-006. Ethernet and Wi-Fi are backed by
 * the Windows physical-link sentinel in this mission. 5G and satellite are
 * modeled now so route selection can be tested without claiming a physical
 * capture that did not happen.
 */
export const CONNECTIVITY_MEDIA_PRIORITY = Object.freeze([
  "ethernet",
  "wifi",
  "cellular_5g",
  "satellite",
] as const);

export type ConnectivityMedium = typeof CONNECTIVITY_MEDIA_PRIORITY[number];
export type ConnectivityPathState = "CONNECTED" | "LOST" | "UNKNOWN" | "UNAVAILABLE";
export type GlobalConnectivityState = "CONNECTED" | "LOST" | "UNKNOWN";
export type ConnectivityValidation = "PHYSICAL" | "SIMULATED";

export type ConnectivityObservation = Readonly<{
  medium: ConnectivityMedium;
  state: ConnectivityPathState;
  validation: ConnectivityValidation;
  report: LinkSentinelReport | null;
}>;

export type ConnectivityResolution = Readonly<{
  state: GlobalConnectivityState;
  activeMedium: ConnectivityMedium | null;
  observations: readonly ConnectivityObservation[];
}>;

export const MODELED_ONLY_MEDIA = Object.freeze(["cellular_5g", "satellite"] as const);

export function modeledConnectivityObservation(
  medium: "cellular_5g" | "satellite",
  state: ConnectivityPathState = "UNAVAILABLE",
): ConnectivityObservation {
  return Object.freeze({ medium, state, validation: "SIMULATED", report: null });
}

export function physicalConnectivityObservation(
  medium: PhysicalAdapterKind,
  report: LinkSentinelReport,
  nowEpochMs: number,
  maximumAgeMs: number,
  minimumObservedAtEpochMs = 0,
): ConnectivityObservation {
  const target = PHYSICAL_ADAPTER_TARGETS[medium];
  const observedAtEpochMs = Date.parse(report.observedAt);
  const current = isPhysicalReportForTarget(report, target)
    && isFreshPhysicalLinkObservation(report, nowEpochMs, maximumAgeMs)
    && observedAtEpochMs >= minimumObservedAtEpochMs;
  return Object.freeze({
    medium,
    state: current ? report.link : "UNKNOWN",
    validation: "PHYSICAL",
    report: current ? report : SENTINEL_UNREACHABLE,
  });
}

/**
 * Resolve route availability separately from any individual interface. A
 * connected route keeps the global state CONNECTED. LOST is asserted only
 * when every modeled route is known to be unusable; an unknown route keeps
 * the aggregate fail-closed at UNKNOWN.
 */
export function resolveConnectivity(
  observations: readonly ConnectivityObservation[],
): ConnectivityResolution {
  const byMedium = new Map<ConnectivityMedium, ConnectivityObservation>();
  for (const observation of observations) {
    if (byMedium.has(observation.medium)) throw new TypeError(`duplicate connectivity observation: ${observation.medium}`);
    byMedium.set(observation.medium, observation);
  }
  for (const medium of CONNECTIVITY_MEDIA_PRIORITY) {
    if (!byMedium.has(medium)) throw new TypeError(`missing connectivity observation: ${medium}`);
  }
  const ordered = Object.freeze(CONNECTIVITY_MEDIA_PRIORITY.map((medium) => byMedium.get(medium)!));
  const active = ordered.find((observation) => observation.state === "CONNECTED") ?? null;
  const state: GlobalConnectivityState = active !== null
    ? "CONNECTED"
    : ordered.some((observation) => observation.state === "UNKNOWN")
      ? "UNKNOWN"
      : "LOST";
  return Object.freeze({ state, activeMedium: active?.medium ?? null, observations: ordered });
}

export function physicalConnectivityResolution(
  reports: Readonly<Record<PhysicalAdapterKind, LinkSentinelReport>>,
  nowEpochMs: number,
  maximumAgeMs: number,
  minimumObservedAtEpochMs = 0,
): ConnectivityResolution {
  return resolveConnectivity([
    physicalConnectivityObservation("ethernet", reports.ethernet, nowEpochMs, maximumAgeMs, minimumObservedAtEpochMs),
    physicalConnectivityObservation("wifi", reports.wifi, nowEpochMs, maximumAgeMs, minimumObservedAtEpochMs),
    modeledConnectivityObservation("cellular_5g"),
    modeledConnectivityObservation("satellite"),
  ]);
}

/**
 * Select the physical report that represents the aggregate state for the
 * existing transition machine. A route switch while CONNECTED supplies the
 * newly active report and therefore remains a stable CONNECTED observation.
 * During total loss the previously active physical route carries the LOST
 * transition when possible; otherwise priority order is deterministic.
 */
export function representativePhysicalReport(
  resolution: ConnectivityResolution,
  previousActiveMedium: ConnectivityMedium | null,
): LinkSentinelReport {
  const withReport = (medium: ConnectivityMedium | null, state: ConnectivityPathState) =>
    medium === null
      ? null
      : resolution.observations.find((observation) => observation.medium === medium
        && observation.validation === "PHYSICAL"
        && observation.state === state
        && observation.report !== null)?.report ?? null;

  if (resolution.state === "CONNECTED") {
    return withReport(resolution.activeMedium, "CONNECTED") ?? SENTINEL_UNREACHABLE;
  }
  if (resolution.state === "LOST") {
    const previous = withReport(previousActiveMedium, "LOST");
    if (previous !== null) return previous;
    return resolution.observations.find((observation) => observation.validation === "PHYSICAL"
      && observation.state === "LOST"
      && observation.report !== null)?.report ?? SENTINEL_UNREACHABLE;
  }
  return SENTINEL_UNREACHABLE;
}

export function physicalKindForMedium(medium: ConnectivityMedium | null): PhysicalAdapterKind | null {
  return medium === "ethernet" || medium === "wifi" ? medium : null;
}

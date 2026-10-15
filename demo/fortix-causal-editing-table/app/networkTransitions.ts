import { isPhysicalAdapterBinding, reportMatchesPhysicalBinding, type PhysicalAdapterBinding } from "./physicalAdapterBinding.ts";
import { ETHERNET_ADAPTER_IDENTITY, WIFI_ADAPTER_IDENTITY, isSupportedPhysicalAdapterIdentity } from "./physicalAdapterPolicy.ts";
import {
  isTargetPhysicalEthernet,
  isLinkSentinelReport,
  type LinkSentinelReport,
} from "./ethernetLink.ts";

/**
 * D-006D physical-network transition boundary.
 *
 * Only reports produced by one of the explicitly supported physical-link
 * sentinels may enter this state machine. Story time, component lifecycle and
 * localhost reachability are deliberately absent from this module's inputs.
 */

export const NETWORK_OBSERVATION_SOURCE = "LINK_SENTINEL:GET_NET_ADAPTER" as const;
export const DEFAULT_SENTINEL_POLL_INTERVAL_MS = 500;
export const DEFAULT_DEBOUNCE_OBSERVATIONS = 2;

/**
 * P3-B: persistent network state is two-valued. RESTORED was removed — a
 * physical link is connected or lost, and "restored" is an event that already
 * lives permanently in the journal as NR-NET-RESTORED.
 */
export type NetworkTransitionState = "UNKNOWN" | "CONNECTED" | "LOST";
export type StableNetworkState = "CONNECTED" | "LOST";
export type NetworkSignificantEventType = "NETWORK_LINK_LOST" | "NETWORK_LINK_RESTORED";
export type NetworkNanoReceiptType = "NR-NET-LOST" | "NR-NET-RESTORED";

export type NetworkAdapterIdentity = Readonly<{
  name: string;
  description: string;
  ifIndex: number;
}>;

export type NetworkTransitionEventDescriptor = Readonly<{
  runId: string;
  eventId: string;
  eventType: NetworkSignificantEventType;
  receiptId: string;
  nanoReceiptType: NetworkNanoReceiptType;
  adapterIdentity: NetworkAdapterIdentity;
  previousNetworkState: StableNetworkState;
  newNetworkState: StableNetworkState;
  observationSource: typeof NETWORK_OBSERVATION_SOURCE;
  physicalObservedAt: string;
  causalPredecessors: readonly string[];
  missionClockPosition: Readonly<{
    milliseconds: number;
    causalOrder: number;
  }>;
  evidenceLocality: "LOCAL";
}>;

export type NetworkObservationContext = Readonly<{
  /** Prospective append-only evidence position. It is not the cinematic playhead. */
  evidenceClockMs: number;
  causalPredecessors?: readonly string[];
}>;

export type NetworkTransitionIgnoreReason =
  | "NONE"
  | "UNOBSERVED_LINK"
  | "DUPLICATE_OBSERVATION"
  | "STALE_OBSERVATION"
  | "DEBOUNCING"
  | "STABLE";

export type NetworkTransitionResult = Readonly<{
  state: NetworkTransitionState;
  changed: boolean;
  event: NetworkTransitionEventDescriptor | null;
  reason: NetworkTransitionIgnoreReason;
}>;

type DebounceCandidate = Readonly<{
  link: StableNetworkState;
  count: number;
  adapterIdentity: NetworkAdapterIdentity;
  firstObservedAt: string;
  lastObservedAt: string;
}>;

export type NetworkTransitionSnapshot = Readonly<{
  version: 2;
  runId: string;
  state: StableNetworkState;
  candidate: DebounceCandidate | null;
  lastObservationEpochMs: number | null;
  lastMissionClockMs: number;
  causalOrder: number;
  transitionSequence: number;
}>;

export type NetworkTransitionMachineOptions = Readonly<{
  runId: string;
  debounceObservations?: number;
  /**
   * Optional journal-aligned baseline for a newly opened mission run.
   * The UI may remain UNKNOWN until the first sentinel sample, but the
   * evidence session itself starts CONNECTED and the machine must use that
   * same baseline before it can author CONNECTED -> LOST.
   */
  initialState?: StableNetworkState;
  snapshot?: NetworkTransitionSnapshot;
  /** Immutable runtime context, deliberately outside the canonical journal/snapshot. */
  adapterBinding?: PhysicalAdapterBinding;
}>;

export type NetworkTransitionLatency = Readonly<{
  sentinelPollIntervalMs: number;
  uiPollIntervalMs: number;
  debounceObservations: number;
  earliestSentinelToUiMs: number;
  worstCaseSentinelToUiMs: number;
  worstCasePhysicalToUiPollingMs: number;
}>;

/**
 * The polling-only latency envelope. Once the sentinel exposes a new state,
 * the UI confirms it in 0.5-1 second with the production defaults. From a
 * physical cable change the poll-only worst case is 1.5 seconds. Both figures
 * exclude PowerShell query duration, loopback transport and one browser render.
 */
export function theoreticalTransitionLatency(
  sentinelPollIntervalMs = DEFAULT_SENTINEL_POLL_INTERVAL_MS,
  uiPollIntervalMs = DEFAULT_SENTINEL_POLL_INTERVAL_MS,
  debounceObservations = DEFAULT_DEBOUNCE_OBSERVATIONS,
): NetworkTransitionLatency {
  assertPositiveInteger(sentinelPollIntervalMs, "sentinelPollIntervalMs");
  assertPositiveInteger(uiPollIntervalMs, "uiPollIntervalMs");
  assertPositiveInteger(debounceObservations, "debounceObservations");
  return Object.freeze({
    sentinelPollIntervalMs,
    uiPollIntervalMs,
    debounceObservations,
    earliestSentinelToUiMs: uiPollIntervalMs * (debounceObservations - 1),
    worstCaseSentinelToUiMs: uiPollIntervalMs * debounceObservations,
    worstCasePhysicalToUiPollingMs: sentinelPollIntervalMs + (uiPollIntervalMs * debounceObservations),
  });
}

export class PhysicalNetworkTransitionMachine {
  readonly runId: string;
  readonly debounceObservations: number;
  readonly adapterBinding: PhysicalAdapterBinding | null;

  #state: NetworkTransitionState = "UNKNOWN";
  #candidate: DebounceCandidate | null = null;
  #lastObservationEpochMs: number | null = null;
  /** Clock position of the last emitted network evidence, never of a stable poll. */
  #lastMissionClockMs = 0;
  #causalOrder = 0;
  #transitionSequence = 0;
  constructor(options: NetworkTransitionMachineOptions) {
    const runId = options.runId.trim();
    if (runId.length === 0) throw new TypeError("runId must not be empty");
    this.runId = runId;
    if (options.adapterBinding !== undefined && !isPhysicalAdapterBinding(options.adapterBinding, runId)) throw new TypeError("physical adapter binding/run mismatch");
    this.adapterBinding = options.adapterBinding === undefined ? null : Object.freeze({ ...options.adapterBinding });
    this.debounceObservations = options.debounceObservations ?? DEFAULT_DEBOUNCE_OBSERVATIONS;
    assertPositiveInteger(this.debounceObservations, "debounceObservations");

    if (options.snapshot !== undefined && options.initialState !== undefined) {
      throw new TypeError("initialState and snapshot are mutually exclusive");
    }
    if (options.snapshot !== undefined) this.#restore(options.snapshot);
    else if (options.initialState !== undefined) {
      if (options.initialState !== "CONNECTED" && options.initialState !== "LOST") {
        throw new TypeError("initialState must be CONNECTED or LOST");
      }
      this.#state = options.initialState;
    }
  }

  get state(): NetworkTransitionState {
    return this.#state;
  }

  /**
   * Accept one newly sampled sentinel report. Calling this repeatedly with the
   * same report (for example because a component rerendered) is idempotent.
   */
  observe(
    report: LinkSentinelReport,
    context: NetworkObservationContext,
  ): NetworkTransitionResult {
    if (!isLinkSentinelReport(report) || report.sentinel !== "OK" || report.adapter === null
      || (report.link !== "CONNECTED" && report.link !== "LOST")) {
      return this.#result(false, null, "UNOBSERVED_LINK");
    }

    // A supplied run binding remains authoritative for callers that require
    // one exact interface. Unbound callers consume the already validated
    // aggregate physical route and may therefore move between Ethernet and
    // Wi-Fi without changing the mission run.
    if (this.adapterBinding === null
      ? !isSupportedPhysicalAdapterIdentity(isTargetPhysicalEthernet(report.adapter) ? ETHERNET_ADAPTER_IDENTITY : report.adapter.description)
      : !reportMatchesPhysicalBinding(report, this.adapterBinding)) {
      return this.#result(false, null, "UNOBSERVED_LINK");
    }
    const observedEpochMs = Date.parse(report.observedAt);
    if (!Number.isFinite(observedEpochMs)) return this.#result(false, null, "UNOBSERVED_LINK");
    if (this.#lastObservationEpochMs !== null) {
      if (observedEpochMs === this.#lastObservationEpochMs) {
        return this.#result(false, null, "DUPLICATE_OBSERVATION");
      }
      if (observedEpochMs < this.#lastObservationEpochMs) {
        return this.#result(false, null, "STALE_OBSERVATION");
      }
    }

    this.#lastObservationEpochMs = observedEpochMs;

    const observedLink = report.link;
    const stablePhysicalLink = this.#physicalLink();
    if (observedLink === stablePhysicalLink) {
      this.#candidate = null;
      return this.#result(false, null, "STABLE");
    }

    const adapterIdentity = Object.freeze({
      name: report.adapter.name,
      description: isTargetPhysicalEthernet(report.adapter) ? ETHERNET_ADAPTER_IDENTITY : WIFI_ADAPTER_IDENTITY,
      ifIndex: report.adapter.ifIndex,
    });
    if (this.#candidate?.link === observedLink
      && this.#candidate.adapterIdentity.name === adapterIdentity.name
      && this.#candidate.adapterIdentity.description === adapterIdentity.description
      && this.#candidate.adapterIdentity.ifIndex === adapterIdentity.ifIndex) {
      this.#candidate = Object.freeze({
        ...this.#candidate,
        count: this.#candidate.count + 1,
        adapterIdentity,
        lastObservedAt: report.observedAt,
      });
    } else {
      this.#candidate = Object.freeze({
        link: observedLink,
        count: 1,
        adapterIdentity,
        firstObservedAt: report.observedAt,
        lastObservedAt: report.observedAt,
      });
    }

    if (this.#candidate.count < this.debounceObservations) {
      return this.#result(false, null, "DEBOUNCING");
    }

    const candidate = this.#candidate;
    this.#candidate = null;

    // Establishing the initial observed state is not a transition and must not
    // mint evidence whose predecessor was never observed.
    if (this.#state === "UNKNOWN") {
      this.#state = candidate.link;
      return this.#result(true, null, "STABLE");
    }

    const previousState = this.#state;
    // D-006G P3-B: persistent network state has exactly two values.
    //
    // RESTORED is an EVENT, not a state a cable can be in. A physical link is
    // connected or it is not. Treating restoration as a lasting state made the
    // indicator claim something the wire could not: "restored" is a fact about
    // the past, and the past belongs in evidence, not in a live indicator.
    //
    // The transition still AUTHORS `NETWORK_LINK_RESTORED` — the historical
    // fact survives permanently as NR-NET-RESTORED — while the machine settles
    // straight back to CONNECTED.
    const nextState: NetworkTransitionState = candidate.link === "LOST" ? "LOST" : "CONNECTED";
    if (previousState === nextState) return this.#result(false, null, "STABLE");

    const event = this.#eventDescriptor(previousState as StableNetworkState, candidate.link, candidate, context);
    this.#state = nextState;
    return this.#result(true, event, "NONE");
  }

  /** JSON-safe persistence boundary used to survive reloads without replay. */
  snapshot(): NetworkTransitionSnapshot {
    if (this.#state === "UNKNOWN") {
      throw new TypeError("UNKNOWN is an observation state and cannot be persisted");
    }
    return Object.freeze({
      version: 2,
      runId: this.runId,
      state: this.#state,
      candidate: this.#candidate === null
        ? null
        : Object.freeze({ ...this.#candidate, adapterIdentity: Object.freeze({ ...this.#candidate.adapterIdentity }) }),
      lastObservationEpochMs: this.#lastObservationEpochMs,
      lastMissionClockMs: this.#lastMissionClockMs,
      causalOrder: this.#causalOrder,
      transitionSequence: this.#transitionSequence,
    });
  }

  #physicalLink(): StableNetworkState | null {
    if (this.#state === "LOST") return "LOST";
    if (this.#state === "CONNECTED") return "CONNECTED";
    return null;
  }

  #eventDescriptor(
    previousState: StableNetworkState,
    nextState: StableNetworkState,
    candidate: DebounceCandidate,
    context: NetworkObservationContext,
  ): NetworkTransitionEventDescriptor {
    // Physical observation freshness and evidence time are orthogonal. Stable
    // polling never reaches this boundary; only a confirmed transition may
    // validate and advance the append-only evidence clock.
    assertMissionClock(context.evidenceClockMs);
    if (context.evidenceClockMs < this.#lastMissionClockMs) {
      throw new RangeError("evidenceClockMs must be monotonic");
    }
    this.#lastMissionClockMs = context.evidenceClockMs;
    this.#causalOrder += 1;
    this.#transitionSequence += 1;
    const lost = nextState === "LOST";
    const eventType: NetworkSignificantEventType = lost ? "NETWORK_LINK_LOST" : "NETWORK_LINK_RESTORED";
    const nanoReceiptType: NetworkNanoReceiptType = lost ? "NR-NET-LOST" : "NR-NET-RESTORED";
    const identity = `${this.runId}:network:${String(this.#transitionSequence).padStart(4, "0")}`;

    return Object.freeze({
      runId: this.runId,
      eventId: `${identity}:${eventType}`,
      eventType,
      receiptId: `${identity}:${nanoReceiptType}`,
      nanoReceiptType,
      adapterIdentity: candidate.adapterIdentity,
      previousNetworkState: previousState,
      newNetworkState: nextState,
      observationSource: NETWORK_OBSERVATION_SOURCE,
      physicalObservedAt: candidate.lastObservedAt,
      causalPredecessors: Object.freeze([...(context.causalPredecessors ?? [])]),
      missionClockPosition: Object.freeze({
        milliseconds: context.evidenceClockMs,
        causalOrder: this.#causalOrder,
      }),
      evidenceLocality: "LOCAL",
    });
  }

  #result(
    changed: boolean,
    event: NetworkTransitionEventDescriptor | null,
    reason: NetworkTransitionResult["reason"],
  ): NetworkTransitionResult {
    return Object.freeze({ state: this.#state, changed, event, reason });
  }

  #restore(snapshot: NetworkTransitionSnapshot): void {
    if (snapshot.version !== 2 || snapshot.runId !== this.runId) {
      throw new TypeError("network transition snapshot identity mismatch");
    }
    if (!isStableNetworkState(snapshot.state)
      || !isNullableFiniteNumber(snapshot.lastObservationEpochMs)
      || !isNonNegativeInteger(snapshot.lastMissionClockMs)
      || !isNonNegativeInteger(snapshot.causalOrder)
      || !isNonNegativeInteger(snapshot.transitionSequence)
      || !isDebounceCandidate(snapshot.candidate)) {
      throw new TypeError("invalid network transition snapshot");
    }
    this.#state = snapshot.state;
    this.#candidate = snapshot.candidate === null
      ? null
      : Object.freeze({ ...snapshot.candidate, adapterIdentity: Object.freeze({ ...snapshot.candidate.adapterIdentity }) });
    this.#lastObservationEpochMs = snapshot.lastObservationEpochMs;
    this.#lastMissionClockMs = snapshot.lastMissionClockMs;
    this.#causalOrder = snapshot.causalOrder;
    this.#transitionSequence = snapshot.transitionSequence;
  }
}

function isStableNetworkState(value: unknown): value is StableNetworkState {
  return value === "CONNECTED" || value === "LOST";
}

function isDebounceCandidate(value: unknown): value is DebounceCandidate | null {
  if (value === null) return true;
  if (typeof value !== "object") return false;
  const candidate = value as Partial<DebounceCandidate>;
  return (candidate.link === "CONNECTED" || candidate.link === "LOST")
    && isNonNegativeInteger(candidate.count)
    && candidate.count > 0
    && typeof candidate.firstObservedAt === "string"
    && Number.isFinite(Date.parse(candidate.firstObservedAt))
    && typeof candidate.lastObservedAt === "string"
    && Number.isFinite(Date.parse(candidate.lastObservedAt))
    && isAdapterIdentity(candidate.adapterIdentity);
}

function isAdapterIdentity(value: unknown): value is NetworkAdapterIdentity {
  if (value === null || typeof value !== "object") return false;
  const identity = value as Partial<NetworkAdapterIdentity>;
  return typeof identity.name === "string"
    && isSupportedPhysicalAdapterIdentity(identity.description)
    && isNonNegativeInteger(identity.ifIndex);
}

function isNullableFiniteNumber(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) throw new RangeError(`${name} must be a positive integer`);
}

function assertMissionClock(value: number): void {
  if (!isNonNegativeInteger(value)) throw new RangeError("missionClockMs must be a non-negative integer");
}

import { clampExperienceTime, storyBeatTime } from "./storyTimeline.ts";

export type RoutingExecutionTruth = "SIMULATED_LOCAL" | "SIMULATED_REMOTE" | "EXTERNAL";

export type RoutingCandidate = Readonly<{
  candidate_id: string;
  source_id: string;
  model_id: string;
  provider_id: string;
  execution_truth: RoutingExecutionTruth;
}>;

export type RoutingFallback = Readonly<{
  from_candidate_id: string;
  to_candidate_id: string;
  reason_code: string;
}>;

export type ResultingRoute = Readonly<{
  route_id: string;
  route_source_ref: string;
  causal_parent_ref: string;
}>;

/** Canonical, evidence-portable routing provenance. Selection and resolution are never aliases. */
export type RoutingProvenance = Readonly<{
  routing_request: Readonly<{
    request_id: string;
    triggering_event_ids: readonly string[];
  }>;
  routing_policy_ref: string;
  candidate_set: readonly RoutingCandidate[];
  selected_source: string;
  selected_model: string;
  selected_provider: string;
  resolved_source: string;
  resolved_model: string;
  resolved_provider: string;
  fallback: RoutingFallback | null;
  resulting_route: ResultingRoute;
}>;

export type RoutingProvenanceInput = RoutingProvenance;

export class RoutingProvenanceError extends TypeError {
  readonly reasonCode: string;

  constructor(reasonCode: string, message: string) {
    super(message);
    this.name = "RoutingProvenanceError";
    this.reasonCode = reasonCode;
  }
}

const PROVIDER_A: RoutingCandidate = {
  candidate_id: "sim-route-provider-a",
  source_id: "fortix.demo.routing.source.simulated-traffic-a",
  model_id: "fortix.demo.routing.model.route-a.v1",
  provider_id: "fortix.demo.navigation.provider-a",
  execution_truth: "SIMULATED_LOCAL",
};

const PROVIDER_B: RoutingCandidate = {
  candidate_id: "sim-route-provider-b",
  source_id: "fortix.demo.routing.source.simulated-traffic-b",
  model_id: "fortix.demo.routing.model.route-b.v1",
  provider_id: "fortix.demo.navigation.provider-b",
  execution_truth: "SIMULATED_LOCAL",
};

export function createRoutingProvenance(input: RoutingProvenanceInput): RoutingProvenance {
  requireText(input.routing_request.request_id, "ROUTING_REQUEST_REQUIRED");
  requireText(input.routing_policy_ref, "ROUTING_POLICY_REF_REQUIRED");
  if (input.routing_request.triggering_event_ids.length === 0) {
    throw new RoutingProvenanceError("ROUTING_TRIGGER_REQUIRED", "routing requires at least one triggering event id");
  }
  for (const id of input.routing_request.triggering_event_ids) requireText(id, "ROUTING_TRIGGER_INVALID");
  if (new Set(input.routing_request.triggering_event_ids).size !== input.routing_request.triggering_event_ids.length) {
    throw new RoutingProvenanceError("ROUTING_TRIGGER_DUPLICATE", "routing trigger event ids must be unique");
  }
  if (input.candidate_set.length === 0) {
    throw new RoutingProvenanceError("ROUTING_CANDIDATE_SET_INVALID", "routing candidate set must not be empty");
  }
  const candidateIds = new Set<string>();
  const candidateTuples = new Set<string>();
  for (const candidate of input.candidate_set) {
    for (const value of [candidate.candidate_id, candidate.source_id, candidate.model_id, candidate.provider_id]) {
      requireText(value, "ROUTING_CANDIDATE_INVALID");
    }
    if (candidateIds.has(candidate.candidate_id) || candidateTuples.has(candidateTuple(candidate))) {
      throw new RoutingProvenanceError("ROUTING_CANDIDATE_SET_INVALID", "routing candidates must be unique");
    }
    candidateIds.add(candidate.candidate_id);
    candidateTuples.add(candidateTuple(candidate));
  }

  const selected = findCandidate(
    input.candidate_set,
    input.selected_source,
    input.selected_model,
    input.selected_provider,
    "SELECTED_ROUTING_CANDIDATE_INVALID",
  );
  const resolved = findCandidate(
    input.candidate_set,
    input.resolved_source,
    input.resolved_model,
    input.resolved_provider,
    "RESOLVED_ROUTING_CANDIDATE_INVALID",
  );
  if (selected.candidate_id === resolved.candidate_id) {
    if (input.fallback !== null) {
      throw new RoutingProvenanceError("ROUTING_FALLBACK_UNEXPECTED", "fallback must be absent when selection resolves directly");
    }
  } else {
    const fallback = input.fallback;
    if (fallback === null) {
      throw new RoutingProvenanceError("ROUTING_FALLBACK_REQUIRED", "selected/resolved mismatch requires fallback evidence");
    }
    requireText(fallback.reason_code, "ROUTING_FALLBACK_REASON_REQUIRED");
    if (fallback.from_candidate_id !== selected.candidate_id || fallback.to_candidate_id !== resolved.candidate_id) {
      throw new RoutingProvenanceError("ROUTING_FALLBACK_BINDING_INVALID", "fallback must bind the selected and resolved candidates exactly");
    }
  }
  requireText(input.resulting_route.route_id, "RESULTING_ROUTE_REQUIRED");
  requireText(input.resulting_route.route_source_ref, "RESULTING_ROUTE_SOURCE_REQUIRED");
  requireText(input.resulting_route.causal_parent_ref, "RESULTING_ROUTE_CAUSAL_PARENT_REQUIRED");
  if (input.resulting_route.route_source_ref !== resolved.source_id
    || input.resulting_route.causal_parent_ref !== routingResolutionRef(resolved)) {
    throw new RoutingProvenanceError("RESULTING_ROUTE_BINDING_INVALID", "resulting route must bind to the resolved source and resolution");
  }
  return deepFreeze({
    ...input,
    routing_request: {
      ...input.routing_request,
      triggering_event_ids: [...input.routing_request.triggering_event_ids],
    },
    candidate_set: input.candidate_set.map((candidate) => ({ ...candidate })),
    fallback: input.fallback === null ? null : { ...input.fallback },
    resulting_route: { ...input.resulting_route },
  });
}

export const CANONICAL_ROUTING_PROVENANCE = createRoutingProvenance({
  routing_request: {
    request_id: "d006.c1.routing-request.garage-reroute",
    triggering_event_ids: ["d005.congestion-significant", "d005.eta-deteriorates"],
  },
  routing_policy_ref: "fortix.demo.policy.model-routing.v1",
  candidate_set: [PROVIDER_A, PROVIDER_B],
  selected_source: PROVIDER_B.source_id,
  selected_model: PROVIDER_B.model_id,
  selected_provider: PROVIDER_B.provider_id,
  resolved_source: PROVIDER_B.source_id,
  resolved_model: PROVIDER_B.model_id,
  resolved_provider: PROVIDER_B.provider_id,
  fallback: null,
  resulting_route: {
    route_id: "fortix.demo.route.garage-b",
    route_source_ref: PROVIDER_B.source_id,
    causal_parent_ref: routingResolutionRef(PROVIDER_B),
  },
});

/** Adversarial fixture: selection A falls back to resolution B without collapsing either tuple. */
export function createSelectedResolvedMismatchProvenance(): RoutingProvenance {
  return createRoutingProvenance({
    ...CANONICAL_ROUTING_PROVENANCE,
    selected_source: PROVIDER_A.source_id,
    selected_model: PROVIDER_A.model_id,
    selected_provider: PROVIDER_A.provider_id,
    fallback: {
      from_candidate_id: PROVIDER_A.candidate_id,
      to_candidate_id: PROVIDER_B.candidate_id,
      reason_code: "D006_SELECTED_PROVIDER_UNAVAILABLE",
    },
  });
}

export type RoutingStoryPhase =
  | "NOT_TRIGGERED"
  | "CONDITION"
  | "REQUEST"
  | "POLICY"
  | "CANDIDATES"
  | "SELECTED"
  | "RESOLVED"
  | "DECIDED"
  | "ROUTE_READY"
  | "EXECUTED";

export type DerivedRoutingState = Readonly<{
  experienceTimeMs: number;
  phase: RoutingStoryPhase;
  routingRequest: RoutingProvenance["routing_request"] | null;
  routingPolicyRef: string | null;
  candidateSet: readonly RoutingCandidate[];
  selected: RoutingCandidate | null;
  resolved: RoutingCandidate | null;
  fallback: RoutingFallback | null;
  resultingRoute: ResultingRoute | null;
  vehicleMayExecute: boolean;
}>;

export function deriveRoutingState(
  experienceTimeMs: number,
  provenance: RoutingProvenance = CANONICAL_ROUTING_PROVENANCE,
): DerivedRoutingState {
  const time = clampExperienceTime(experienceTimeMs);
  const selected = candidateForTuple(
    provenance.candidate_set,
    provenance.selected_source,
    provenance.selected_model,
    provenance.selected_provider,
  );
  const resolved = candidateForTuple(
    provenance.candidate_set,
    provenance.resolved_source,
    provenance.resolved_model,
    provenance.resolved_provider,
  );
  const requestReached = time >= storyBeatTime("routing-request");
  const policyReached = time >= storyBeatTime("routing-policy-evaluated");
  const candidatesReached = time >= storyBeatTime("routing-candidates-compared");
  const selectedReached = time >= storyBeatTime("routing-candidate-selected");
  const resolvedReached = time >= storyBeatTime("provider-transition");
  const routeReached = time >= storyBeatTime("resulting-route-calculated");
  const executionReached = time >= storyBeatTime("physical-reroute");
  return {
    experienceTimeMs: time,
    phase: routingPhaseAt(time),
    routingRequest: requestReached ? provenance.routing_request : null,
    routingPolicyRef: policyReached ? provenance.routing_policy_ref : null,
    candidateSet: candidatesReached ? provenance.candidate_set : [],
    selected: selectedReached ? selected : null,
    resolved: resolvedReached ? resolved : null,
    fallback: resolvedReached ? provenance.fallback : null,
    resultingRoute: routeReached ? provenance.resulting_route : null,
    vehicleMayExecute: executionReached,
  };
}

function routingPhaseAt(time: number): RoutingStoryPhase {
  if (time < storyBeatTime("congestion")) return "NOT_TRIGGERED";
  if (time < storyBeatTime("routing-request")) return "CONDITION";
  if (time < storyBeatTime("routing-policy-evaluated")) return "REQUEST";
  if (time < storyBeatTime("routing-candidates-compared")) return "POLICY";
  if (time < storyBeatTime("routing-candidate-selected")) return "CANDIDATES";
  if (time < storyBeatTime("provider-transition")) return "SELECTED";
  if (time < storyBeatTime("reroute-authorized")) return "RESOLVED";
  if (time < storyBeatTime("resulting-route-calculated")) return "DECIDED";
  if (time < storyBeatTime("physical-reroute")) return "ROUTE_READY";
  return "EXECUTED";
}

function findCandidate(
  candidates: readonly RoutingCandidate[],
  sourceId: string,
  modelId: string,
  providerId: string,
  reasonCode: string,
): RoutingCandidate {
  for (const value of [sourceId, modelId, providerId]) requireText(value, reasonCode);
  const candidate = candidateForTuple(candidates, sourceId, modelId, providerId);
  if (candidate === null) throw new RoutingProvenanceError(reasonCode, "routing tuple must identify one complete candidate");
  return candidate;
}

function candidateForTuple(
  candidates: readonly RoutingCandidate[],
  sourceId: string,
  modelId: string,
  providerId: string,
): RoutingCandidate | null {
  return candidates.find((candidate) => candidate.source_id === sourceId
    && candidate.model_id === modelId
    && candidate.provider_id === providerId) ?? null;
}

function candidateTuple(candidate: RoutingCandidate): string {
  return `${candidate.source_id}\u0000${candidate.model_id}\u0000${candidate.provider_id}`;
}

function routingResolutionRef(candidate: RoutingCandidate): string {
  return `routing-resolution:${candidate.candidate_id}`;
}

function requireText(value: string, reasonCode: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new RoutingProvenanceError(reasonCode, "non-empty routing text required");
  }
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

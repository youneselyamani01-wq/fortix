import assert from "node:assert/strict";
import test from "node:test";

import {
  CANONICAL_ROUTING_PROVENANCE,
  RoutingProvenanceError,
  createRoutingProvenance,
  createSelectedResolvedMismatchProvenance,
  deriveRoutingState,
} from "../app/routingProvenance.ts";

test("canonical routing preserves complete selected and resolved tuples with explicit simulation truth", () => {
  const route = CANONICAL_ROUTING_PROVENANCE;
  assert.deepEqual(route.routing_request.triggering_event_ids,
    ["d005.congestion-significant", "d005.eta-deteriorates"]);
  assert.ok(route.candidate_set.length >= 2);
  assert.ok(route.candidate_set.every((candidate) => candidate.execution_truth === "SIMULATED_LOCAL"));
  assert.ok(route.selected_source.length > 0 && route.selected_model.length > 0 && route.selected_provider.length > 0);
  assert.ok(route.resolved_source.length > 0 && route.resolved_model.length > 0 && route.resolved_provider.length > 0);
  assert.equal(route.fallback, null);
  assert.equal(route.resulting_route.route_source_ref, route.resolved_source);
  assert.match(route.resulting_route.causal_parent_ref, /^routing-resolution:/);
});

test("runtime routing reveals request, policy, candidates, selection, resolution, route, then execution", () => {
  assert.equal(deriveRoutingState(48_249).routingRequest, null);
  assert.equal(deriveRoutingState(48_250).phase, "REQUEST");
  assert.equal(deriveRoutingState(48_750).phase, "POLICY");
  assert.equal(deriveRoutingState(49_500).phase, "CANDIDATES");
  const selected = deriveRoutingState(50_500);
  assert.equal(selected.phase, "SELECTED");
  assert.ok(selected.selected);
  assert.equal(selected.resolved, null);
  const resolved = deriveRoutingState(51_000);
  assert.equal(resolved.phase, "RESOLVED");
  assert.ok(resolved.selected && resolved.resolved);
  assert.equal(deriveRoutingState(53_000).phase, "ROUTE_READY");
  assert.equal(deriveRoutingState(53_999).vehicleMayExecute, false);
  assert.equal(deriveRoutingState(54_000).phase, "EXECUTED");
  assert.equal(deriveRoutingState(54_000).vehicleMayExecute, true);
});

test("selected/resolved mismatch remains visible and requires exact fallback binding", () => {
  const mismatch = createSelectedResolvedMismatchProvenance();
  assert.notEqual(mismatch.selected_source, mismatch.resolved_source);
  assert.notEqual(mismatch.selected_model, mismatch.resolved_model);
  assert.notEqual(mismatch.selected_provider, mismatch.resolved_provider);
  assert.ok(mismatch.fallback);
  assert.equal(mismatch.resulting_route.route_source_ref, mismatch.resolved_source);

  assert.throws(() => createRoutingProvenance({
    ...mismatch,
    fallback: null,
  }), (error: unknown) => error instanceof RoutingProvenanceError
    && error.reasonCode === "ROUTING_FALLBACK_REQUIRED");
});

test("partial tuples and routes not bound to the resolved source fail closed", () => {
  const [providerA] = CANONICAL_ROUTING_PROVENANCE.candidate_set;
  assert.throws(() => createRoutingProvenance({
    ...CANONICAL_ROUTING_PROVENANCE,
    selected_source: providerA.source_id,
    selected_model: CANONICAL_ROUTING_PROVENANCE.selected_model,
    selected_provider: providerA.provider_id,
  }), (error: unknown) => error instanceof RoutingProvenanceError
    && error.reasonCode === "SELECTED_ROUTING_CANDIDATE_INVALID");

  assert.throws(() => createRoutingProvenance({
    ...CANONICAL_ROUTING_PROVENANCE,
    resulting_route: {
      ...CANONICAL_ROUTING_PROVENANCE.resulting_route,
      route_source_ref: providerA.source_id,
    },
  }), (error: unknown) => error instanceof RoutingProvenanceError
    && error.reasonCode === "RESULTING_ROUTE_BINDING_INVALID");
});

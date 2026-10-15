import { groupInspectionBoundaries, type InspectionBoundary } from "./inspectionPresentation.ts";
import type { ReceivedGraph, ReceivedGraphEdge } from "./receivedGraph.ts";

export type VerifierGraphContextInput = Readonly<{
  boundaryKey?: string | null;
  relationKey?: string | null;
}>;

export type VerifierGraphContextStatus =
  | "RESOLVED"
  | "EMPTY"
  | "MISSING_BOUNDARY"
  | "MISSING_RELATION"
  | "CONTRADICTORY";

export type VerifierGraphContextResolution = Readonly<{
  status: VerifierGraphContextStatus;
  boundary: InspectionBoundary | null;
  relation: ReceivedGraphEdge | null;
}>;

/** Resolve only the exact received context requested by a URL or peer tab.
 * An invalid reference never acquires a replacement edge or boundary. The
 * story cursor is independent: it need not be an endpoint of the exploration. */
export function resolveVerifierGraphContext(
  graph: ReceivedGraph,
  input: VerifierGraphContextInput,
): VerifierGraphContextResolution {
  const hasBoundary = input.boundaryKey !== undefined && input.boundaryKey !== null;
  const hasRelation = input.relationKey !== undefined && input.relationKey !== null;
  const unavailable = (status: VerifierGraphContextStatus): VerifierGraphContextResolution => Object.freeze({ status, boundary: null, relation: null });
  if (!hasBoundary && !hasRelation) return unavailable("EMPTY");

  const boundary = hasBoundary
    ? groupInspectionBoundaries(graph).find(candidate => candidate.key === input.boundaryKey) ?? null
    : null;
  if (hasBoundary && boundary === null) return unavailable("MISSING_BOUNDARY");
  const relation = hasRelation
    ? graph.edges.find(candidate => candidate.key === input.relationKey) ?? null
    : null;
  if (hasRelation && relation === null) return unavailable("MISSING_RELATION");
  if (boundary && relation && !boundary.edgeKeys.includes(relation.key)) return unavailable("CONTRADICTORY");

  return Object.freeze({ status: "RESOLVED", boundary, relation });
}

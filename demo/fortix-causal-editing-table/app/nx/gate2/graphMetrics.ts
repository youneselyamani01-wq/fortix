import type { CanonicalEdge, CanonicalGraph } from "./canonicalGraph.ts";

/**
 * D-006/NX GATE 2 — STRUCTURAL MEASUREMENTS OF THE CANONICAL GRAPH (§6).
 *
 * Everything here is DERIVED from the declared edges: depth, degree, ancestry,
 * distance to the Final Receipt, fan-out and convergence. Nothing is derived
 * from the reading ordinal, and nothing invents a relation.
 *
 * These are the "graph-derived dimensions" the PCA (variant C) and the flow
 * field (variant D) are permitted to use as features. They describe the SHAPE
 * of the evidence, which is a legitimate thing to measure. They never become
 * edges: a receipt that resembles another structurally is not caused by it.
 */

export type GraphMetrics = Readonly<{
  /** Roots at 0; every other receipt one deeper than its deepest present parent. */
  depth: ReadonlyMap<string, number>;
  inDegree: ReadonlyMap<string, number>;
  outDegree: ReadonlyMap<string, number>;
  ancestorCount: ReadonlyMap<string, number>;
  descendantCount: ReadonlyMap<string, number>;
  /** Shortest directed hop count to a Final Receipt input; null when unreachable. */
  distanceToFinal: ReadonlyMap<string, number | null>;
  /** How many of a receipt's out-edges leave its own lane. */
  boundaryCrossings: ReadonlyMap<string, number>;
  /** Longest directed path ending at the receipt — its position along the story's spine. */
  longestPathTo: ReadonlyMap<string, number>;
  parentsOf: ReadonlyMap<string, readonly string[]>;
  childrenOf: ReadonlyMap<string, readonly string[]>;
}>;

const adjacency = (edges: readonly CanonicalEdge[]) => {
  const children = new Map<string, string[]>();
  const parents = new Map<string, string[]>();
  for (const edge of edges) {
    children.set(edge.parent, [...(children.get(edge.parent) ?? []), edge.child]);
    parents.set(edge.child, [...(parents.get(edge.child) ?? []), edge.parent]);
  }
  return { children, parents };
};

/**
 * A topological order of the receipts. The canonical graph is acyclic (Gate 1
 * measured 0 backward edges in reading order, and every parent precedes its
 * child in evidence time), but the sort does not ASSUME that: anything left
 * over after Kahn's algorithm is appended in admission order, so a cycle would
 * degrade the measurement rather than hang it.
 */
function topological(ids: readonly string[], parents: ReadonlyMap<string, readonly string[]>, children: ReadonlyMap<string, readonly string[]>): readonly string[] {
  const remaining = new Map(ids.map((id) => [id, (parents.get(id) ?? []).length] as const));
  const ready = ids.filter((id) => (remaining.get(id) ?? 0) === 0);
  const order: string[] = [];
  while (ready.length > 0) {
    const id = ready.shift()!;
    order.push(id);
    for (const child of children.get(id) ?? []) {
      const left = (remaining.get(child) ?? 0) - 1;
      remaining.set(child, left);
      if (left === 0) ready.push(child);
    }
  }
  const placed = new Set(order);
  return [...order, ...ids.filter((id) => !placed.has(id))];
}

/** Transitive closure size in one direction, computed over a topological order. */
function reachableCounts(order: readonly string[], step: ReadonlyMap<string, readonly string[]>): ReadonlyMap<string, number> {
  const sets = new Map<string, Set<string>>();
  for (const id of order) {
    const own = new Set<string>();
    for (const next of step.get(id) ?? []) {
      own.add(next);
      for (const inherited of sets.get(next) ?? []) own.add(inherited);
    }
    sets.set(id, own);
  }
  return new Map([...sets].map(([id, set]) => [id, set.size] as const));
}

export function graphMetrics(graph: CanonicalGraph): GraphMetrics {
  const ids = graph.receipts.map((entry) => entry.evidenceId);
  const laneOf = new Map(graph.receipts.map((entry) => [entry.evidenceId, entry.lane] as const));
  const { children, parents } = adjacency(graph.edges);

  const forward = topological(ids, parents, children);
  const backward = [...forward].reverse();

  const depth = new Map<string, number>();
  const longestPathTo = new Map<string, number>();
  for (const id of forward) {
    const own = parents.get(id) ?? [];
    depth.set(id, own.length === 0 ? 0 : 1 + Math.max(...own.map((parent) => depth.get(parent) ?? 0)));
    longestPathTo.set(id, own.length === 0 ? 0 : 1 + Math.max(...own.map((parent) => longestPathTo.get(parent) ?? 0)));
  }

  // Distance to the Final Receipt: hops to any receipt the Final Receipt names
  // as a causal input. Measured backwards from those inputs over reversed
  // edges, so it is a real graph distance, not a guess from position.
  const finalInputs = new Set(graph.finalReceipt.causalInputEvidenceIds.filter((id) => laneOf.has(id)));
  const distanceToFinal = new Map<string, number | null>(ids.map((id) => [id, null] as const));
  const queue: string[] = [];
  for (const id of finalInputs) { distanceToFinal.set(id, 0); queue.push(id); }
  while (queue.length > 0) {
    const id = queue.shift()!;
    const here = distanceToFinal.get(id)!;
    for (const parent of parents.get(id) ?? []) {
      if (distanceToFinal.get(parent) === null) { distanceToFinal.set(parent, here + 1); queue.push(parent); }
    }
  }

  const boundaryCrossings = new Map<string, number>(ids.map((id) => [
    id, (children.get(id) ?? []).filter((child) => laneOf.get(child) !== laneOf.get(id)).length,
  ] as const));

  return Object.freeze({
    depth,
    inDegree: new Map(ids.map((id) => [id, (parents.get(id) ?? []).length] as const)),
    outDegree: new Map(ids.map((id) => [id, (children.get(id) ?? []).length] as const)),
    ancestorCount: reachableCounts(forward, parents),
    descendantCount: reachableCounts(backward, children),
    distanceToFinal,
    boundaryCrossings,
    longestPathTo,
    parentsOf: new Map(ids.map((id) => [id, Object.freeze([...(parents.get(id) ?? [])])] as const)),
    childrenOf: new Map(ids.map((id) => [id, Object.freeze([...(children.get(id) ?? [])])] as const)),
  });
}

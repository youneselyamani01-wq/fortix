import type { ReceivedGraph } from "./receivedGraph.ts";

/** Presentation landmarks only, chosen from an already resolved directed path.
 * Segments retain every intermediate member and original edge key. */
export function receivedPathOutline(graph: ReceivedGraph, path: readonly string[]) {
  if (!path.length) return { milestones: [], segments: [] };
  const byKey = new Map(graph.nodes.map(node => [node.key, node]));
  const important = path.flatMap((key, index) => {
    const event = byKey.get(key)?.member?.eventId;
    return event && /(?:garage-arrival|master-human-approve|master-payment-result|master-return-to-base)$/.test(event) ? [index] : [];
  });
  const candidates = important.length ? important : [Math.floor((path.length - 1) / 3), Math.floor((path.length - 1) * 2 / 3)];
  const indices = [...new Set([0, ...candidates.slice(0, 4), path.length - 1])].sort((a, b) => a - b);
  const milestones = indices.map(index => ({ key: path[index]!, index }));
  const segments = indices.slice(1).map((end, i) => {
    const start = indices[i]!; const members = path.slice(start, end + 1);
    const edges = members.slice(1).map((key, j) => graph.edges.find(edge => edge.causal && edge.from === members[j] && edge.to === key));
    if (edges.some(edge => !edge)) throw new Error("Path outline requires explicit causal edges");
    return { from: path[start]!, to: path[end]!, members, edges: edges.map(edge => edge!) };
  });
  return { milestones, segments };
}

import type { ReceivedGraph, ReceivedGraphEdge, ReceivedGraphNode } from "./receivedGraph.ts";
import { groupInspectionBoundaries } from "./inspectionPresentation.ts";
import { receivedReceiptLabel, type ReceivedReceiptLabel } from "./receivedReceiptLabels.ts";

export type EvidenceSelection =
  | Readonly<{ kind: "none" }>
  | Readonly<{ kind: "event"; nodeKey: string }>
  | Readonly<{ kind: "relation"; edgeKey: string; focusNodeKey: string }>
  | Readonly<{ kind: "boundary"; boundaryKey: string; edgeKey: string | null }>;

export type EvidenceEventBinding = Readonly<{
  node: ReceivedGraphNode;
  nodeKey: string;
  eventId: string | null;
  declaredTimeMs: number | null;
  manifestIndex: number | null;
  receipt: ReceivedReceiptLabel;
  producerDomain: string | null;
  causalParentKeys: readonly string[];
  causalChildKeys: readonly string[];
  observedInputKeys: readonly string[];
  boundaryKeys: readonly string[];
}>;

export const noEvidenceSelection: EvidenceSelection = Object.freeze({ kind: "none" });

const receivedDossierEvents = new Set([
  "d005.receipt.passenger",
  "d005.receipt.traffic",
  "d005.receipt.maintenance",
  "d005m.receipt.master-payment",
  "d005m.receipt.master-return-to-base",
  "d005m.receipt.master-operational-cycle",
]);

/** A received compilation is still evidence, but is not a business event.
 * Exact known event semantics are used; arbitrary receipt IDs or captions are
 * never guessed to be dossiers. The Final Receipt keeps its own reading step. */
export function isReceivedEvidenceDossier(node: ReceivedGraphNode): boolean {
  return !node.final && receivedDossierEvents.has(node.member?.eventId ?? "");
}

/** One stable reading order from received declarations only. The manifest index
 * breaks equal or absent times for display; it never becomes a timestamp or a
 * causal relation. */
export function receivedTimelineNodes(graph: ReceivedGraph): readonly ReceivedGraphNode[] {
  return [...graph.nodes]
    .filter((node) => node.final || (node.member?.presentation === "PRESENTED" && !isReceivedEvidenceDossier(node)))
    .sort((left, right) => {
      const leftTime = left.member?.timeMs ?? Number.POSITIVE_INFINITY;
      const rightTime = right.member?.timeMs ?? Number.POSITIVE_INFINITY;
      return leftTime - rightTime
        || (left.member?.index ?? Number.MAX_SAFE_INTEGER) - (right.member?.index ?? Number.MAX_SAFE_INTEGER)
        || left.fieldPath.localeCompare(right.fieldPath);
    });
}

export function receivedEventBindings(graph: ReceivedGraph, locale: "en" | "fr"): readonly EvidenceEventBinding[] {
  const boundaries = groupInspectionBoundaries(graph);
  return receivedTimelineNodes(graph).map((node) => {
    const incoming = graph.edges.filter((edge) => edge.to === node.key);
    const outgoing = graph.edges.filter((edge) => edge.from === node.key);
    return Object.freeze({
      node,
      nodeKey: node.key,
      eventId: node.member?.eventId ?? null,
      declaredTimeMs: node.member?.timeMs ?? null,
      manifestIndex: node.member?.index ?? null,
      receipt: receivedReceiptLabel(graph, node, locale),
      producerDomain: node.member?.producerDomain ?? null,
      causalParentKeys: Object.freeze(incoming.filter((edge) => edge.causal).map((edge) => edge.from)),
      causalChildKeys: Object.freeze(outgoing.filter((edge) => edge.causal).map((edge) => edge.to)),
      observedInputKeys: Object.freeze(incoming.filter((edge) => edge.declarations.some((item) => item.kind === "OBSERVED_INPUT")).map((edge) => edge.from)),
      boundaryKeys: Object.freeze(boundaries.filter((boundary) => boundary.edgeKeys.some((key) => incoming.concat(outgoing).some((edge) => edge.key === key))).map((boundary) => boundary.key)),
    });
  });
}

export function selectedEventKey(selection: EvidenceSelection): string | null {
  return selection.kind === "event" ? selection.nodeKey : selection.kind === "relation" ? selection.focusNodeKey : null;
}

export function timelineNeighbours(bindings: readonly EvidenceEventBinding[], nodeKey: string | null) {
  const index = nodeKey === null ? -1 : bindings.findIndex((entry) => entry.nodeKey === nodeKey);
  return {
    index,
    current: index >= 0 ? bindings[index] ?? null : null,
    previous: index > 0 ? bindings[index - 1] ?? null : null,
    next: index >= 0 && index + 1 < bindings.length ? bindings[index + 1] ?? null : null,
  } as const;
}

export function selectionFromGraphContext(context: {
  selectedNodeKey?: string | null;
  selectedEdgeKey?: string | null;
  selectedBoundaryKey?: string | null;
} | undefined, graph: ReceivedGraph): EvidenceSelection {
  if (context?.selectedBoundaryKey) return { kind: "boundary", boundaryKey: context.selectedBoundaryKey, edgeKey: context.selectedEdgeKey ?? null };
  if (context?.selectedEdgeKey) {
    const edge = graph.edges.find((candidate) => candidate.key === context.selectedEdgeKey);
    return edge ? { kind: "relation", edgeKey: edge.key, focusNodeKey: context.selectedNodeKey ?? edge.to } : noEvidenceSelection;
  }
  return context?.selectedNodeKey && graph.nodes.some((node) => node.key === context.selectedNodeKey)
    ? { kind: "event", nodeKey: context.selectedNodeKey }
    : noEvidenceSelection;
}

export function edgeForBoundarySelection(graph: ReceivedGraph, selection: EvidenceSelection): ReceivedGraphEdge | null {
  if (selection.kind !== "boundary" || !selection.edgeKey) return null;
  const boundary = groupInspectionBoundaries(graph).find((candidate) => candidate.key === selection.boundaryKey);
  return boundary?.edgeKeys.includes(selection.edgeKey) ? graph.edges.find((edge) => edge.key === selection.edgeKey) ?? null : null;
}

export function declaredMissionTime(timeMs: number | null, locale: "en" | "fr"): string {
  if (timeMs === null) return locale === "fr" ? "Temps non déclaré" : "Time not declared";
  const sign = timeMs < 0 ? "−" : "+";
  const absolute = Math.abs(timeMs);
  const minutes = Math.floor(absolute / 60_000);
  const seconds = Math.floor((absolute % 60_000) / 1_000);
  const milliseconds = absolute % 1_000;
  return `T${sign}${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}${milliseconds ? `.${String(milliseconds).padStart(3, "0")}` : ""}`;
}

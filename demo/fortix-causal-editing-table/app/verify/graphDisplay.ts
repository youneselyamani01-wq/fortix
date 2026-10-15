import type { ReceivedGraph, ReceivedGraphEdge, ReceivedGraphNode } from "./receivedGraph.ts";
import { receivedEvidencePath } from "./receivedGraph.ts";
import { receivedReceiptLabel, receivedReceiptCounts } from "./receivedReceiptLabels.ts";
import { isReceivedEvidenceDossier, receivedTimelineNodes } from "./guidedInspection.ts";

export type GraphPreset = "simplified" | "causal" | "full";
export type GraphLayers = { nanoReceipts: boolean; boundaries: boolean; causalRelations: boolean; secondaryRelations: boolean; supportEvidence: boolean; finalReceipt: boolean; contextZones: boolean };
export type ReceivedGraphContext = { selectedNodeKey?: string | null; selectedBoundaryKey?: string | null; selectedEdgeKey?: string | null; preset: GraphPreset; level?: 1 | 2 | 3; focusMode?: "none" | "isolate" | "follow"; layers?: GraphLayers; highlightedFamily?: string | null };

export function graphPresetLayers(preset: GraphPreset): GraphLayers {
  return { nanoReceipts: true, boundaries: true, causalRelations: true, secondaryRelations: preset === "full", supportEvidence: preset === "full", finalReceipt: true, contextZones: preset !== "simplified" };
}

/** Display families keyed to received event IDs/domains, never canonical types.
 * Unknown events stay explicit. This list cannot create an event or a receipt. */
const eventFamilies: Readonly<Record<string, readonly string[]>> = {
  passenger: ["d005.passenger-request", "d005.passenger-authority", "d005.mission-accepted", "d006nx0.action:depart-base", "d005.pickup-confirmed", "d005.journey-executed", "d005.dropoff-confirmed"],
  navigation: ["d005.pickup-route", "d005.garage-route-a", "d005.eta-deteriorates", "d005.reroute-authorized", "d006.c1.routing-provenance", "d005.route-b-executed", "d006nx0.action:reroute", "d005m.master-return-intent", "d005m.master-return-authorized", "d005m.master-return-executed", "d005m.master-base-arrival"],
  traffic: ["d006g.signal-state-published:green-1", "d006g.city-detection", "d006g.signal-state-published:yellow", "d006g.perception:yellow", "d006g.decision:stop", "d006g.action:brake", "d006g.signal-state-published:red", "d006g.result:at-rest", "d006g.city-phase-decision", "d006g.signal-state-published:green-2", "d006g.perception:green", "d006g.decision:proceed", "d006g.action:resume", "d005.congestion-significant", "d006nx0.perception:congestion", "d006nx0.decision:hazard-stop", "d006nx0.action:hazard-brake", "d006nx0.result:hazard-stop"],
  garage: ["d005.garage-arrival", "d005.garage-received"],
  maintenance: ["d005.maintenance-intent", "d005.diagnostic", "d005.maintenance-proposal", "d005.maintenance-authorized", "d005.maintenance-executed", "d005.maintenance-completed"],
  human: ["d005m.master-human-approval-request", "d005m.master-human-approve", "d005m.master-payment-authority-active", "d005m.master-manager-notified"],
  payment: ["d005m.master-invoice-1850", "d005m.master-payment-policy-exceeded", "d005m.master-payment-authorized", "d005m.master-payment-instruction", "d006g.payment-instruction-presented", "d006g.bank-authorization", "d006g.bank-confirmation", "d005m.master-payment-result"],
  compilation: ["d005m.receipt.master-payment", "d005m.receipt.master-return-to-base"],
};
const familyCopy: Readonly<Record<string, readonly [string, string]>> = {
  passenger: ["Passenger mission", "Mission passager"], navigation: ["Navigation", "Navigation"], traffic: ["Traffic", "Trafic"], garage: ["Garage", "Garage"], maintenance: ["Maintenance", "Maintenance"], human: ["Human authorization", "Autorisation humaine"], payment: ["Payment", "Paiement"], network: ["Network", "Réseau"], compilation: ["Causal compilation", "Compilation causale"], final: ["Final Receipt", "Reçu final"], support: ["Supporting evidence", "Preuves de support"], other: ["Other received events", "Autres événements reçus"],
};
export function receivedEventFamily(graph: ReceivedGraph, node: ReceivedGraphNode): string {
  const receipt = receivedReceiptLabel(graph, node, "en");
  if (receipt.kind === "FINAL_RECEIPT") return "final";
  if (receipt.kind === "SUPPORT") return "support";
  if (node.member?.producerDomain === "NETWORK") return "network";
  return Object.entries(eventFamilies).find(([, events]) => events.includes(node.member?.eventId ?? ""))?.[0] ?? "other";
}
export function receivedGraphFamilies(graph: ReceivedGraph, locale: "en" | "fr") {
  return Object.entries(familyCopy).flatMap(([key, titles]) => {
    const nodes = graph.nodes.filter(node => receivedEventFamily(graph, node) === key);
    return nodes.length ? [{ key, title: titles[locale === "fr" ? 1 : 0], nodes, counts: receivedReceiptCounts(graph, nodes.map(node => node.key)) }] : [];
  });
}

/** A reading spine, not a claim that other causal declarations are unimportant.
 * Each primary edge is the final edge of a real received root-to-node path.
 * Cyclic, observed, additional-parent and cross links remain exact secondary
 * declarations and return in Full inspection. No shortcut edge is generated. */
export function graphReadingEdges(graph: ReceivedGraph) {
  const primary = new Set<string>();
  for (const node of graph.nodes) {
    const path = receivedEvidencePath(graph, node.key);
    if (path.length < 2) continue;
    const edge = graph.edges.find(edge => edge.causal && edge.from === path.at(-2) && edge.to === node.key);
    if (edge) primary.add(edge.key);
  }
  return primary;
}
export function graphDisplay(graph: ReceivedGraph, path: readonly string[], preset: GraphPreset, layers: GraphLayers) {
  const primaryEdges = graphReadingEdges(graph);
  const pathKeys = new Set(path);
  const pathEdges = new Set(graph.edges.filter(edge => edge.causal && path.some((key, index) => index > 0 && key === edge.to && path[index - 1] === edge.from)).map(edge => edge.key));
  const nodes = graph.nodes.filter(node => {
    const kind = receivedReceiptLabel(graph, node, "en").kind;
    const layerVisible = kind === "NANO_RECEIPT" ? layers.nanoReceipts : kind === "SUPPORT" ? layers.supportEvidence : kind === "FINAL_RECEIPT" ? layers.finalReceipt : true;
    return layerVisible && (preset !== "simplified" || pathKeys.has(node.key) || kind === "UNRESOLVED" || kind === "SUPPORT" || kind === "FINAL_RECEIPT");
  });
  const nodeKeys = new Set(nodes.map(node => node.key));
  const edges = graph.edges.filter(edge => nodeKeys.has(edge.from) && nodeKeys.has(edge.to) && (edge.causal ? layers.causalRelations && ((preset === "simplified" ? pathEdges : primaryEdges).has(edge.key) || layers.secondaryRelations) : layers.secondaryRelations));
  return { nodes, nodeKeys, edges, primaryEdges, pathEdges, hiddenNodes: graph.nodes.length - nodes.length, hiddenEdges: graph.edges.length - edges.length };
}
export function graphRelationClass(edge: ReceivedGraphEdge, primary: ReadonlySet<string>, path: ReadonlySet<string>): "path" | "primary" | "secondary" {
  return path.has(edge.key) ? "path" : primary.has(edge.key) ? "primary" : "secondary";
}

/** The modular workspace has one visibility axis. Legacy presets above remain
 * available for callers that have not migrated; they do not govern this API. */
export type GraphMode = "simplified" | "causal" | "follow" | "expert";
export type GraphModeOptions = Readonly<{
  mode: GraphMode;
  selectedNodeKey?: string | null;
  selectedEdgeKey?: string | null;
  followToFinal?: boolean;
  /** Explicitly opened branches in Causal mode, never an implicit traversal. */
  expandedNodeKeys?: readonly string[];
  /** Hide network transitions that are temporal context only (see networkContextNodeKeys). Expert mode ignores it. */
  hideNetworkContext?: boolean;
}>;

/** Network NanoReceipts with no causal relation of their own — the LOST /
 * RESTORED transitions, and an in-mission reconciliation receipt, which is
 * evidence lifecycle and not causality: no causal edge links them to any fact
 * other than the Final Receipt (closure input). They are transversal context,
 * kept in Network, Timeline and NanoReceipts. The set is read from the
 * received edges; nothing is added, removed or reinterpreted. */
export function networkContextNodeKeys(graph: ReceivedGraph): ReadonlySet<string> {
  const finalKeys = new Set(graph.nodes.filter(node => node.final).map(node => node.key));
  if (graph.finalKey) finalKeys.add(graph.finalKey);
  return new Set(graph.nodes.filter(node => receivedEventFamily(graph, node) === "network" && !graph.edges.some(edge => edge.causal
    && (edge.from === node.key || edge.to === node.key) && !finalKeys.has(edge.from === node.key ? edge.to : edge.from))).map(node => node.key));
}

/** Family bookends are reading landmarks, not an inferred causal path.
 * Network transitions remain landmarks unless the caller hides context-only
 * ones (hideNetworkContext). Intermediate facts and evidence dossiers
 * stay available in deeper modes; chronology never supplies a graph edge. */
function simplifiedLandmarks(graph: ReceivedGraph): Set<string> {
  const sequence = receivedTimelineNodes(graph);
  const keys = new Set<string>();
  const first = new Map<string, string>();
  const last = new Map<string, string>();
  for (const node of sequence) {
    const family = receivedEventFamily(graph, node);
    if (family === "compilation" || isReceivedEvidenceDossier(node)) continue;
    if (!first.has(family)) first.set(family, node.key);
    last.set(family, node.key);
    if (family === "network" || node.final) keys.add(node.key);
  }
  for (const key of first.values()) keys.add(key);
  for (const key of last.values()) keys.add(key);
  return keys;
}

/** A longest directed path from an explicit selection to a target. It uses the
 * received acyclic order and original edges; cycles and their dependants retain
 * their diagnostic status instead of acquiring a fabricated route. */
function pathFromSelection(graph: ReceivedGraph, start: string, target: string): readonly string[] {
  const paths = new Map<string, string[]>([[start, [start]]]);
  const ordered = [...graph.nodes].filter(node => node.depth !== null)
    .sort((a, b) => a.depth! - b.depth! || a.fieldPath.localeCompare(b.fieldPath));
  if (!ordered.some(node => node.key === start) || !ordered.some(node => node.key === target)) return [];
  for (const node of ordered) {
    if (node.key === start) continue;
    const candidates = graph.edges.filter(edge => edge.causal && edge.to === node.key)
      .flatMap(edge => { const path = paths.get(edge.from); return path ? [path] : []; });
    candidates.sort((a, b) => b.length - a.length || a.join("/").localeCompare(b.join("/")));
    if (candidates[0]) paths.set(node.key, [...candidates[0], node.key]);
  }
  return paths.get(target) ?? [];
}

/** Exact, display-only subsets of the received graph. This function does not
 * mutate graph objects, invent shortcut edges, or compute a verification result.
 * Callers pass resolved internal keys; an invalid key never selects a substitute. */
export function graphModeDisplay(graph: ReceivedGraph, options: GraphModeOptions) {
  const byKey = new Map(graph.nodes.map(node => [node.key, node]));
  const finalKeys = new Set(graph.nodes.filter(node => node.final).map(node => node.key));
  if (graph.finalKey) finalKeys.add(graph.finalKey);
  const isFinalEdge = (edge: ReceivedGraphEdge) => finalKeys.has(edge.from) || finalKeys.has(edge.to)
    || edge.declarations.some(declaration => declaration.kind === "FINAL_RECEIPT_INPUT");
  const selected = options.selectedNodeKey ? byKey.get(options.selectedNodeKey) : undefined;
  const selectedEdge = options.selectedEdgeKey ? graph.edges.find(edge => edge.key === options.selectedEdgeKey) : undefined;
  const focus = selected ?? (!options.selectedNodeKey && selectedEdge ? byKey.get(selectedEdge.to) : undefined);
  const allowFinal = options.mode === "expert" || (options.mode === "follow" && options.followToFinal === true);
  let path: readonly string[] = [];
  const nodeKeys = new Set<string>();
  const edgeKeys = new Set<string>();
  const addEdge = (edge: ReceivedGraphEdge) => {
    if (!allowFinal && isFinalEdge(edge)) return;
    edgeKeys.add(edge.key); nodeKeys.add(edge.from); nodeKeys.add(edge.to);
  };

  if (options.mode === "expert") {
    for (const node of graph.nodes) nodeKeys.add(node.key);
    for (const edge of graph.edges) addEdge(edge);
  } else if (options.mode === "simplified") {
    for (const key of simplifiedLandmarks(graph)) nodeKeys.add(key);
    const isFact = (key: string) => {
      const node = byKey.get(key);
      return node !== undefined && !isReceivedEvidenceDossier(node);
    };
    if (focus && isFact(focus.key)) {
      nodeKeys.add(focus.key);
      // One local context only; expanding every landmark's ancestors would
      // recreate the exhaustive graph. Dossiers are not business landmarks.
      for (const edge of graph.edges) {
        if (edge.causal && !isFinalEdge(edge) && isFact(edge.from) && isFact(edge.to)
          && (edge.from === focus.key || edge.to === focus.key)) {
          nodeKeys.add(edge.from); nodeKeys.add(edge.to);
        }
      }
    }
    // Missing intermediate facts leave a reading gap. Never invent a shortcut
    // to make the overview appear continuously connected.
    for (const edge of graph.edges) {
      if (edge.causal && nodeKeys.has(edge.from) && nodeKeys.has(edge.to)) addEdge(edge);
    }
    if (selectedEdge && isFact(selectedEdge.from) && isFact(selectedEdge.to)) addEdge(selectedEdge);
  } else if (options.mode === "causal") {
    const seeds = new Set<string>();
    if (focus) seeds.add(focus.key);
    for (const key of options.expandedNodeKeys ?? []) if (byKey.has(key)) seeds.add(key);
    if (selectedEdge && !isFinalEdge(selectedEdge)) { seeds.add(selectedEdge.from); seeds.add(selectedEdge.to); }
    for (const key of seeds) nodeKeys.add(key);
    for (const edge of graph.edges) if (seeds.has(edge.from) || seeds.has(edge.to)) addEdge(edge);
  } else if (focus) {
    nodeKeys.add(focus.key);
    path = options.followToFinal
      ? graph.finalKey ? pathFromSelection(graph, focus.key, graph.finalKey) : []
      : finalKeys.has(focus.key) ? [focus.key] : receivedEvidencePath(graph, focus.key);
    const routeEdges = path.slice(1).map((key, index) => graph.edges.find(edge => edge.causal && edge.from === path[index] && edge.to === key));
    // Never turn a filtered relation into a gap in a purported causal path.
    if (routeEdges.some(edge => !edge || (!allowFinal && isFinalEdge(edge)))) path = [];
    else {
      for (const key of path) nodeKeys.add(key);
      for (const edge of routeEdges) if (edge) addEdge(edge);
    }
  }

  let hiddenNetworkContext = 0;
  if (options.hideNetworkContext && options.mode !== "expert") {
    // A representation filter only: an explicitly selected transition stays visible.
    for (const key of networkContextNodeKeys(graph)) if (key !== focus?.key && nodeKeys.delete(key)) hiddenNetworkContext++;
  }
  const nodes = graph.nodes.filter(node => nodeKeys.has(node.key));
  // This final gate cannot be bypassed by a selected final node/edge or an
  // expanded branch. Full declarations on retained edges remain untouched.
  const edges = graph.edges.filter(edge => edgeKeys.has(edge.key) && nodeKeys.has(edge.from) && nodeKeys.has(edge.to) && (allowFinal || !isFinalEdge(edge)));
  const pathEdges = new Set(edges.filter(edge => path.some((key, index) => index > 0 && key === edge.to && path[index - 1] === edge.from)).map(edge => edge.key));
  const visibleCounts = { nodes: nodes.length, edges: edges.length, declarations: edges.reduce((sum, edge) => sum + edge.declarations.length, 0), ...receivedReceiptCounts(graph, nodes.map(node => node.key)) };
  const totalCounts = { nodes: graph.nodes.length, edges: graph.edges.length, declarations: graph.edges.reduce((sum, edge) => sum + edge.declarations.length, 0), ...receivedReceiptCounts(graph) };
  return {
    nodes, nodeKeys, edges, primaryEdges: graphReadingEdges(graph), pathEdges, path,
    hiddenNodes: graph.nodes.length - nodes.length, hiddenEdges: graph.edges.length - edges.length, hiddenNetworkContext,
    counts: { visible: visibleCounts, total: totalCounts },
  };
}

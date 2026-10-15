"use client";

import { useEffect, useEffectEvent, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { FactInspector, type FactInspectorSupport } from "./FactInspector.tsx";
import { ReceivedRelationExplanation } from "./ReceivedRelationExplanation.tsx";
import { verifierExpandedPanels, type VerifierPresentationProps } from "./verifierPresentation.ts";
import { guidedStoryHumanCaption } from "./guidedStory.ts";
import type { D006VerdictSnapshot } from "../offlineVerification.ts";
import type { ReceivedPebProjection } from "./inspectReceivedPeb.ts";
import type { ReceivedGraph, ReceivedGraphEdge, ReceivedGraphNode } from "./receivedGraph.ts";
import { receivedEventLabel, receivedProducerLabel } from "./receivedLabels.ts";
import { ReceivedPathOverview } from "./ReceivedPathOverview";
import { groupInspectionBoundaries, inspectionCoverage, inspectionDirectCausalEmphasis, inspectionEmphasis } from "./inspectionPresentation.ts";
import "./inspection-workspace.css";
import "./relation-inspection.css";
import "./graph-workspace.css";
import { receivedReceiptLabel, receivedReceiptCounts } from "./receivedReceiptLabels.ts";

import { GuidedBoundaryInspector, GuidedBoundaryGroupInspector } from "./GuidedEventInspector";
import { catalogEntryByNodeKey, createReceivedEvidenceCatalog } from "./receivedEvidenceCatalog.ts";
import { graphDisplay, graphModeDisplay, graphPresetLayers, graphRelationClass, networkContextNodeKeys, receivedGraphFamilies, type GraphMode, type GraphPreset, type GraphLayers, type ReceivedGraphContext } from "./graphDisplay.ts";
import { receivedPathOutline } from "./receivedPathOutline.ts";
import { noEvidenceSelection, type EvidenceSelection } from "./guidedInspection.ts";

type Selection = { nodeKey?: string; edgeKey?: string; boundaryKey?: string };
type Mode = "path" | "isolate" | "follow" | "all";
type LegacyInspectionBookmark = Readonly<{
  selection: Selection; mode: Mode; family: string | null; scale: number; crossings: boolean;
  graphMode: GraphMode; followToFinal: boolean; layout: "story" | "full";
  graphScroll: { x: number; y: number }; inspectorScroll: { x: number; y: number }; pageScroll: { x: number; y: number };
  panels: readonly { key: string; open: boolean }[];
  uiState?: VerifierPresentationProps["uiState"];
}>;

export function InspectionWorkspace({ graph, peb, text, locale, path, snapshot, dedicated = false, initialContext, onOpenDedicatedGraph, onReturnToVerifier, returnLabel, onSelectNode, selection: sharedSelection, onSelectionChange, graphMode: controlledGraphMode, onGraphModeChange, followToFinal: controlledFollowToFinal, onFollowToFinalChange, onOpenEvidence, onOpenForensic, onBeginContextInspection, onReturnToEvent, factSupport, uiState, onUIStateChange, restoreToken, navigationIntent }: {
  graph: ReceivedGraph; peb: ReceivedPebProjection; text: string; locale: "en" | "fr";
  path: readonly string[]; snapshot?: D006VerdictSnapshot | null; dedicated?: boolean; initialContext?: ReceivedGraphContext; onOpenDedicatedGraph?: (context: ReceivedGraphContext) => void; onReturnToVerifier?: () => void; returnLabel?: string; onSelectNode?: (key: string | null) => void;
  selection?: EvidenceSelection; onSelectionChange?: (selection: EvidenceSelection) => void;
  graphMode?: GraphMode; onGraphModeChange?: (mode: GraphMode) => void;
  followToFinal?: boolean; onFollowToFinalChange?: (value: boolean) => void;
  onOpenEvidence?: (nodeKey: string | null) => void;
  onOpenForensic?: (nodeKey: string | null) => void;
  onBeginContextInspection?: () => void;
  onReturnToEvent?: () => void;
  readingNodeKey?: string | null;
  factSupport?: FactInspectorSupport;
} & VerifierPresentationProps) {
  const workspaceRef = useRef<HTMLElement>(null);
  const inspectorRef = useRef<HTMLElement>(null);
  const legacyBookmarkRef = useRef<LegacyInspectionBookmark | null>(null);
  const [legacyRestoration, setLegacyRestoration] = useState<LegacyInspectionBookmark | null>(null);
  const restoreLegacyScroll = useEffectEvent(() => {
    if (!legacyRestoration) return;
    const root = workspaceRef.current;
    for (const panel of root?.querySelectorAll<HTMLDetailsElement>("details[data-panel-key]") ?? []) {
      const saved = legacyRestoration.panels.find((entry) => entry.key === panel.dataset.panelKey);
      if (saved) panel.open = saved.open;
    }
    const region = root?.querySelector<HTMLElement>(".inspection-full-graph");
    region?.scrollTo({ left: legacyRestoration.graphScroll.x, top: legacyRestoration.graphScroll.y, behavior: "instant" });
    inspectorRef.current?.scrollTo({ left: legacyRestoration.inspectorScroll.x, top: legacyRestoration.inspectorScroll.y, behavior: "instant" });
    window.scrollTo({ left: legacyRestoration.pageScroll.x, top: legacyRestoration.pageScroll.y, behavior: "instant" });
  });
  useLayoutEffect(() => {
    if (!legacyRestoration) return;
    restoreLegacyScroll();
    const frame = requestAnimationFrame(() => restoreLegacyScroll());
    return () => cancelAnimationFrame(frame);
  }, [legacyRestoration]);
  const restoreInspectorScroll = useEffectEvent(() => {
    if (navigationIntent === "restore" && uiState) inspectorRef.current?.scrollTo({ left: uiState.inspectorScroll.x, top: uiState.inspectorScroll.y, behavior: "instant" });
  });
  useLayoutEffect(() => { restoreInspectorScroll(); }, [restoreToken]);
  const fr = locale === "fr";
  const c = fr ? {
    title: "Inspection", graph: "Graphe causal", story: "Chemin principal", full: "Graphe complet", verdict: "Verdict du paquet", pending: "Non analysé", declared: "Faits déclarés dans le PEB", established: "Contrôles établis par l’analyse", before: "Les faits ci-dessous sont des déclarations reçues. Aucun verdict avant analyse.", after: "Les contrôles portent sur ce paquet. Ils ne prouvent pas, à eux seuls, chaque assertion physique.", select: "Sélectionnez un fait ou une frontière pour comprendre les preuves associées.", isolate: "Isoler", follow: "Suivre", inspect: "Inspecter", crossings: "Voir les franchissements", reset: "Rétablir le contexte", fact: "Fait", boundary: "Frontière", evidence: "Preuve", authority: "Autorité", execution: "Exécution", outcome: "Effet / résultat", contribution: "Contribution au verdict", missing: "Non déclaré dans ce PEB", noCheck: "Non établi par un contrôle individuel", selected: "Contexte sélectionné", close: "Fermer le panneau", back: "Revenir au contexte", proof: "Preuve technique", raw: "Afficher l’objet source brut", fields: "Champs déclarés", source: "Objet source", issuer: "Émetteur / signataire", signature: "Statut de signature", signatureBundle: "Le contrôle global des signatures du sous-bundle est terminé. Aucun résultat individuel n’est fourni.", signatureNone: "Ce reçu D-006 ne porte pas de signature individuelle.", time: "Temps de confiance", timeNote: "La présence d’un temps déclaré ne prouve pas un temps de production vérifié.", parents: "Parents causaux", children: "Conséquences causales", links: "Liens déclarés", observed: "Entrée observée", causal: "Lien causal", none: "Aucun élément déclaré", details: "Détail du paquet", member: "Membre du manifeste reçu", finalInput: "Entrée déclarée du reçu final", notFinal: "Ce membre n’est pas une entrée directe déclarée du reçu final", noScore: "Le vérificateur ne fournit pas de contribution individuelle ni de score par fait.", quarantine: "Déclaration en quarantaine", branches: "Déplier les reçus et branches", zoom: "Échelle", checks: "Contrôles effectués", reasons: "Motifs du verdict", network: "Réseau / réconciliation", networkNote: "RESTORED désigne un événement de transition vers CONNECTED. La réconciliation postérieure au scellement n’est pas incluse dans ce PEB.", allBoundaries: "Frontières déclarées", producer: "Organisation / producteur", trustBoundary: "Confiance", crossingCount: "franchissements", edge: "Relation sélectionnée", inspectReceipt: "Ouvrir ce reçu", returned: "Résultat déclaré", direct: "Relations exactes du reçu", noPath: "Aucun chemin causal fiable n’est disponible. Le graphe complet conserve les déclarations.", rawMissing: "Objet source absent ou ambigu : aucune preuve substituée.", rawManifest: "Afficher l’entrée de manifeste", context: "Contexte", knownChecks: "Contrôles du paquet", signatureUnknown: "Aucun statut de signature établi pour cet objet", samePackage: "Analyse associée aux mêmes octets reçus", selectionHelp: "Choisissez un élément ; le graphe reste visible pendant l’inspection.", moreChecks: "Consulter les contrôles du paquet", unmeasured: "Les champs absents restent non déclarés.",
  } : {
    title: "Inspection", graph: "Causal Graph", story: "Primary path", full: "Full graph", verdict: "Package verdict", pending: "Not analyzed", declared: "Facts declared in the PEB", established: "Checks established by analysis", before: "The facts below are received declarations. No verdict before analysis.", after: "Checks apply to this package. They do not, by themselves, establish every physical claim.", select: "Select a fact or boundary to understand its supporting evidence.", isolate: "Isolate", follow: "Follow", inspect: "Inspect", crossings: "View crossings", reset: "Restore context", fact: "Fact", boundary: "Boundary", evidence: "Evidence", authority: "Authority", execution: "Execution", outcome: "Effect / outcome", contribution: "Verdict contribution", missing: "Not declared in this PEB", noCheck: "Not established by an individual check", selected: "Selected context", close: "Close panel", back: "Back to context", proof: "Technical evidence", raw: "Show raw source object", fields: "Declared fields", source: "Source object", issuer: "Issuer / signer", signature: "Signature status", signatureBundle: "The aggregate signature check of the sub-bundle completed. No individual result is supplied.", signatureNone: "This D-006 receipt has no individual signature.", time: "Trusted time", timeNote: "A declared time does not establish verified production time.", parents: "Causal parents", children: "Causal consequences", links: "Declared links", observed: "Observed input", causal: "Causal link", none: "None declared", details: "Package detail", member: "Received manifest member", finalInput: "Declared Final Receipt input", notFinal: "This member is not a declared direct Final Receipt input", noScore: "The verifier supplies no individual contribution or per-fact score.", quarantine: "Quarantined declaration", branches: "Expand receipts and branches", zoom: "Scale", checks: "Completed checks", reasons: "Verdict reasons", network: "Network / reconciliation", networkNote: "RESTORED is a transition event to CONNECTED. Reconciliation after sealing is not included in this PEB.", allBoundaries: "Declared boundaries", producer: "Organization / producer", trustBoundary: "Trust", crossingCount: "crossings", edge: "Selected relation", inspectReceipt: "Open this receipt", returned: "Declared result", direct: "Exact receipt relations", noPath: "No reliable causal path is available. The full graph retains the declarations.", rawMissing: "Source object missing or ambiguous: no substitute evidence.", rawManifest: "Show manifest entry", context: "Context", knownChecks: "Package checks", signatureUnknown: "No signature status established for this object", samePackage: "Analysis bound to these exact received bytes", selectionHelp: "Choose an item; the graph stays visible while inspecting it.", moreChecks: "See package checks", unmeasured: "Absent fields remain undeclared.",
  };
  const [fallbackSelection, setFallbackSelection] = useState<Selection>(() => ({ nodeKey: initialContext?.selectedNodeKey ?? undefined, edgeKey: initialContext?.selectedEdgeKey ?? undefined, boundaryKey: initialContext?.selectedBoundaryKey ?? undefined }));
  const [localMode, setLocalMode] = useState<Mode>(initialContext?.focusMode === "isolate" || initialContext?.focusMode === "follow" ? initialContext.focusMode : "path");
  const mode = uiState?.graphEmphasis ?? localMode;
  const setMode = (value: Mode) => { setLocalMode(value); onUIStateChange?.({ graphEmphasis: value }); };
  const [layout, setLayout] = useState<"story" | "full">("full");
  const [localCrossings, setLocalCrossings] = useState(false);
  const showCrossings = uiState ? uiState.expandedPanels.includes("graph:crossings") : localCrossings;
  const setShowCrossings = (value: boolean) => { setLocalCrossings(value); if (uiState) onUIStateChange?.({ expandedPanels: verifierExpandedPanels(uiState.expandedPanels, "graph:crossings", value) }); };
  const [localNetworkContext, setLocalNetworkContext] = useState(false);
  const showNetworkContext = uiState ? uiState.expandedPanels.includes("graph:network-context") : localNetworkContext;
  const setShowNetworkContext = (value: boolean) => { setLocalNetworkContext(value); if (uiState) onUIStateChange?.({ expandedPanels: verifierExpandedPanels(uiState.expandedPanels, "graph:network-context", value) }); };
  const [localScale, setLocalScale] = useState(100);
  const scale = uiState?.graphScale ?? localScale;
  const setScale = (value: number) => { setLocalScale(value); onUIStateChange?.({ graphScale: value }); };
  const details = (key: string, className: string, summary: ReactNode, children: ReactNode, attributes: Record<string, string | boolean> = {}) => <details key={key} className={className} data-panel-key={key} {...attributes} open={uiState ? uiState.expandedPanels.includes(key) : undefined} onToggle={(event) => {
    const open = event.currentTarget.open;
    if (uiState && open !== uiState.expandedPanels.includes(key)) onUIStateChange?.({ expandedPanels: verifierExpandedPanels(uiState.expandedPanels, key, open) });
  }}><summary>{summary}</summary>{children}</details>;
  const expanded = dedicated;
  const [localGraphMode, setLocalGraphMode] = useState<GraphMode>(initialContext?.preset === "full" ? "expert" : initialContext?.focusMode === "follow" ? "follow" : initialContext?.preset === "causal" ? "causal" : "simplified");
  const [localFollowToFinal, setLocalFollowToFinal] = useState(false);
  const graphMode = controlledGraphMode ?? localGraphMode;
  const followToFinal = controlledFollowToFinal ?? localFollowToFinal;
  const [localHighlightedFamily, setLocalHighlightedFamily] = useState<string | null>(initialContext?.highlightedFamily ?? null);
  const highlightedFamily = uiState ? uiState.graphHighlightedFamily : localHighlightedFamily;
  const setHighlightedFamily = (value: string | null) => { setLocalHighlightedFamily(value); onUIStateChange?.({ graphHighlightedFamily: value }); };
  const selection: Selection = sharedSelection ? sharedSelection.kind === "event" ? { nodeKey: sharedSelection.nodeKey } : sharedSelection.kind === "relation" ? { nodeKey: sharedSelection.focusNodeKey, edgeKey: sharedSelection.edgeKey } : sharedSelection.kind === "boundary" ? { boundaryKey: sharedSelection.boundaryKey, edgeKey: sharedSelection.edgeKey ?? undefined } : {} : fallbackSelection;
  const updateSelection = (next: Selection) => {
    setFallbackSelection(next);
    if (!onSelectionChange) return;
    if (next.boundaryKey) {
      const boundary = groupInspectionBoundaries(graph).find((item) => item.key === next.boundaryKey);
      const edgeKey = next.edgeKey && boundary?.edgeKeys.includes(next.edgeKey) ? next.edgeKey : boundary?.edgeKeys.length === 1 ? boundary.edgeKeys[0]! : null;
      onSelectionChange({ kind: "boundary", boundaryKey: next.boundaryKey, edgeKey });
    } else if (next.edgeKey) {
      const edge = graph.edges.find((item) => item.key === next.edgeKey);
      onSelectionChange(edge ? { kind: "relation", edgeKey: edge.key, focusNodeKey: next.nodeKey ?? edge.to } : noEvidenceSelection);
    } else if (next.nodeKey) onSelectionChange({ kind: "event", nodeKey: next.nodeKey });
    else onSelectionChange(noEvidenceSelection);
  };
  const families = useMemo(() => receivedGraphFamilies(graph, locale), [graph, locale]);
  const familyKeys = useMemo(() => new Set(families.find(family => family.key === highlightedFamily)?.nodes.map(node => node.key) ?? []), [families, highlightedFamily]);
  const display = useMemo(() => graphModeDisplay(graph, {
    mode: graphMode,
    selectedNodeKey: selection.nodeKey,
    selectedEdgeKey: selection.edgeKey,
    expandedNodeKeys: highlightedFamily ? [...familyKeys] : undefined,
    followToFinal,
    hideNetworkContext: !showNetworkContext,
  }), [graph, graphMode, selection.nodeKey, selection.edgeKey, familyKeys, highlightedFamily, followToFinal, showNetworkContext]);
  const networkContextCount = useMemo(() => networkContextNodeKeys(graph).size, [graph]);
  const displayPreset: GraphPreset = graphMode === "expert" ? "full" : graphMode === "simplified" ? "simplified" : "causal";
  const displayLayers = graphPresetLayers(displayPreset);
  const familyContext = new Set(graph.edges.flatMap(edge => familyKeys.has(edge.from) ? [edge.to] : familyKeys.has(edge.to) ? [edge.from] : []));
  const applyGraphMode = (next: GraphMode) => {
    if (controlledGraphMode === undefined) setLocalGraphMode(next);
    onGraphModeChange?.(next);
    setLayout("full");
    setMode(next === "expert" ? "all" : next === "follow" ? "follow" : next === "causal" ? "isolate" : "path");
  };
  const setFollowToFinal = (value: boolean) => {
    if (controlledFollowToFinal === undefined) setLocalFollowToFinal(value);
    onFollowToFinalChange?.(value);
  };
  const nodes = useMemo(() => new Map(graph.nodes.map(node => [node.key, node])), [graph]);
  const boundaries = useMemo(() => groupInspectionBoundaries(graph), [graph]);
  const selectedNode = nodes.get(selection.nodeKey ?? "");
  const selectedEdge = graph.edges.find(edge => edge.key === selection.edgeKey);
  const selectedBoundary = boundaries.find(boundary => boundary.key === selection.boundaryKey);
  const boundaryEdges = selectedBoundary ? graph.edges.filter((edge) => selectedBoundary.edgeKeys.includes(edge.key)) : [];
  const exactBoundaryEdge = selectedBoundary && selection.edgeKey && selectedBoundary.edgeKeys.includes(selection.edgeKey) ? graph.edges.find((edge) => edge.key === selection.edgeKey) : undefined;
  const selected = !!(selectedNode || selectedEdge || selectedBoundary);
  const emphasis = selectedNode && !selectedEdge && !selectedBoundary && mode === "isolate" ? inspectionDirectCausalEmphasis(graph, selectedNode.key) : inspectionEmphasis(graph, selection, mode, path);
  const coverage = inspectionCoverage(peb, snapshot ?? null, selectedNode);
  const result = coverage.bound ? snapshot?.result : undefined;
  const establishedChecks = [
    ["d006_transferred_digest_exact", fr ? "Empreinte du transfert concordante" : "Transfer fingerprint matched"],
    ["canonical_signatures_verified", fr ? "Signatures du sous-bundle contrôlées" : "Sub-bundle signatures checked"],
    ["d006_final_receipt_closure", fr ? "Clôture du reçu final contrôlée" : "Final Receipt closure checked"],
  ].filter(([key]) => result?.completedChecks.includes(key!));
  const incidentEdges = selectedNode ? graph.edges.filter((edge) => edge.from === selectedNode.key || edge.to === selectedNode.key) : [];
  const currentEdges = selectedBoundary ? exactBoundaryEdge ? [exactBoundaryEdge] : boundaryEdges : selectedEdge ? [selectedEdge] : graph.edges.filter(edge => edge.from === selectedNode?.key || edge.to === selectedNode?.key);
  const receipt = (node: ReceivedGraphNode) => receivedReceiptLabel(graph, node, locale);
  const number = (node: ReceivedGraphNode) => receipt(node).title;
  const localCatalog = useMemo(() => factSupport ? null : createReceivedEvidenceCatalog(graph, locale, text), [factSupport, graph, locale, text]);
  const factCatalog = factSupport?.catalog ?? localCatalog!;
  const selectedEntry = selectedNode ? catalogEntryByNodeKey(factCatalog, selectedNode.key) : null;
  const receiptCounts = receivedReceiptCounts(graph);
  const declarationCount = graph.edges.reduce((sum, edge) => sum + edge.declarations.length, 0);
  const evidenceUnitCount = graph.nodes.length;
  const finalReceiptCountLabel = fr
    ? `${receiptCounts.final} ${receiptCounts.final > 1 ? "Reçus finaux" : "Reçu final"}`
    : `${receiptCounts.final} ${receiptCounts.final === 1 ? "Final Receipt" : "Final Receipts"}`;
  const unitLabel = (count: number) => fr
    ? `${count} ${count > 1 ? "unités classées" : "unité classée"}`
    : `${count} ${count === 1 ? "classified item" : "classified items"}`;
  const boundaryRelationLabel = (count: number) => fr
    ? `${count} ${count > 1 ? "liens reçus portent" : "lien reçu porte"} ce changement`
    : `${count} ${count === 1 ? "received link carries" : "received links carry"} this change`;
  const graphContext = (): ReceivedGraphContext => {
    const contextLayers = { ...displayLayers };
    const relevant = selectedNode ? [selectedNode] : selectedBoundary ? graph.nodes.filter(node => currentEdges.some(edge => edge.from === node.key || edge.to === node.key)) : [];
    if (relevant.some(node => node.final)) contextLayers.finalReceipt = true;
    if (relevant.some(node => receipt(node).kind === "SUPPORT")) contextLayers.supportEvidence = true;
    if (selectedBoundary) contextLayers.secondaryRelations = true;
    return { selectedNodeKey: selection.nodeKey, selectedEdgeKey: selection.edgeKey, selectedBoundaryKey: selection.boundaryKey, preset: displayPreset, layers: contextLayers, level: 2, focusMode: graphMode === "follow" ? "follow" : graphMode === "causal" ? "isolate" : "none", highlightedFamily };
  };
  const openFullGraph = () => { if (dedicated) setLayout("full"); else onOpenDedicatedGraph?.(graphContext()); };
  const highlightFamily = (key: string) => {
    const family = families.find(item => item.key === key)!;
    const familyLayers = { ...graphPresetLayers("causal"), supportEvidence: family.counts.support > 0, finalReceipt: family.counts.final > 0 };
    if (!dedicated && onOpenDedicatedGraph) { onOpenDedicatedGraph({ ...graphContext(), preset: "causal", layers: familyLayers, highlightedFamily: key, focusMode: "none" }); return; }
    setHighlightedFamily(key); setLayout("full"); applyGraphMode("causal");
  };
  const label = (node: ReceivedGraphNode) => node.final ? (fr ? "Reçu final" : "Final Receipt") : receivedEventLabel(node.member?.eventId, locale) ?? guidedStoryHumanCaption(node.context.label?.value, fr ? "Événement déclaré" : "Declared event");
  const producer = (value: string) => receivedProducerLabel(value, locale);
  const boundaryKindLabel = (kind: typeof boundaries[number]["kind"]) => kind === "producer"
    ? c.producer
    : kind === "authority"
      ? c.authority
      : kind === "execution"
        ? c.execution
        : c.trustBoundary;
  const boundaryLabel = (item: typeof boundaries[number]) => {
    if (item.kind === "producer") return `${producer(item.from)} → ${producer(item.to)}`;
    const edge = graph.edges.find((candidate) => item.edgeKeys.includes(candidate.key));
    const before = edge ? nodes.get(edge.from) : null;
    const after = edge ? nodes.get(edge.to) : null;
    return before && after
      ? `${boundaryKindLabel(item.kind)} · ${label(before)} → ${label(after)}`
      : (fr ? `${boundaryKindLabel(item.kind)} déclaré modifié` : `Declared ${boundaryKindLabel(item.kind).toLocaleLowerCase(locale)} changed`);
  };
  const crossingLabel = (crossing: ReceivedGraphEdge["crossings"][number]) => crossing.kind === "producer"
    ? `${producer(crossing.from.value)} → ${producer(crossing.to.value)}`
    : (fr ? `${boundaryKindLabel(crossing.kind)} déclaré modifié` : `Declared ${boundaryKindLabel(crossing.kind).toLocaleLowerCase(locale)} changed`);
  const tone = (key: string) => highlightedFamily ? familyKeys.has(key) ? "strong" : familyContext.has(key) ? "context" : "dim" : mode === "all" ? "normal" : emphasis.strong.has(key) ? "strong" : emphasis.context.has(key) ? "context" : "dim";
  const edgeTone = (edge: ReceivedGraphEdge) => highlightedFamily ? familyKeys.has(edge.from) && familyKeys.has(edge.to) ? "strong" : familyKeys.has(edge.from) || familyKeys.has(edge.to) ? "context" : "dim" : mode === "all" ? "normal" : emphasis.strongEdges.has(edge.key) ? "strong" : emphasis.context.has(edge.from) || emphasis.context.has(edge.to) ? "context" : "dim";
  const chooseNode = (key: string) => { legacyBookmarkRef.current = null; setLegacyRestoration(null); setHighlightedFamily(null); updateSelection({ nodeKey: key }); onSelectNode?.(key); setMode("isolate"); setShowCrossings(false); };
  const beginContextInspection = () => {
    onBeginContextInspection?.();
    if (!onReturnToEvent && !selection.boundaryKey && !selection.edgeKey) {
      const root = workspaceRef.current;
      const region = root?.querySelector<HTMLElement>(".inspection-full-graph");
      legacyBookmarkRef.current = {
        selection: { ...selection }, mode, family: highlightedFamily, scale, crossings: showCrossings, graphMode, followToFinal, layout,
        graphScroll: { x: region?.scrollLeft ?? 0, y: region?.scrollTop ?? 0 },
        inspectorScroll: { x: inspectorRef.current?.scrollLeft ?? 0, y: inspectorRef.current?.scrollTop ?? 0 },
        pageScroll: { x: window.scrollX, y: window.scrollY },
        panels: [...root?.querySelectorAll<HTMLDetailsElement>("details[data-panel-key]") ?? []].map((panel) => ({ key: panel.dataset.panelKey!, open: panel.open })),
        uiState,
      };
    }
    setLegacyRestoration(null);
  };
  const chooseBoundary = (key: string, edgeKey?: string) => { beginContextInspection(); setHighlightedFamily(null); updateSelection({ boundaryKey: key, edgeKey }); setMode("isolate"); setShowCrossings(false); };
  const returnToEvent = () => {
    if (onReturnToEvent) { onReturnToEvent(); return; }
    const bookmark = legacyBookmarkRef.current;
    if (!bookmark) { updateSelection({}); return; }
    updateSelection(bookmark.selection.nodeKey && !nodes.has(bookmark.selection.nodeKey) ? {} : bookmark.selection);
    setLocalMode(bookmark.mode); setLocalHighlightedFamily(bookmark.family); setLocalScale(bookmark.scale); setLocalCrossings(bookmark.crossings);
    setLayout(bookmark.layout);
    if (controlledGraphMode === undefined) setLocalGraphMode(bookmark.graphMode); else onGraphModeChange?.(bookmark.graphMode);
    if (controlledFollowToFinal === undefined) setLocalFollowToFinal(bookmark.followToFinal); else onFollowToFinalChange?.(bookmark.followToFinal);
    if (bookmark.uiState) onUIStateChange?.(bookmark.uiState);
    setLegacyRestoration(bookmark);
  };
  const chooseCrossing = (edgeKey: string) => {
    const boundary = boundaries.find(item => item.edgeKeys.includes(edgeKey) && item.kind === "producer") ?? boundaries.find(item => item.edgeKeys.includes(edgeKey));
    if (boundary) chooseBoundary(boundary.key, edgeKey); else { beginContextInspection(); updateSelection({ edgeKey }); }
  };
  const toolbar = <div className="inspection-toolbar" aria-label={c.graph}>
      {!dedicated && <div><button type="button" aria-pressed={layout === "story"} onClick={() => setLayout("story")}>{c.story}</button><button type="button" data-open-graph-workspace aria-pressed={layout === "full"} onClick={openFullGraph}>{c.full}{!expanded && <span aria-hidden="true"> ↗</span>}</button></div>}
      {details("graph:package", "inspection-package-detail", fr ? "Paquet PEB" : "PEB package", <div><p>{fr ? `${receiptCounts.nano} NanoReceipts reçus · ${receiptCounts.support} preuves de support reçues · ${finalReceiptCountLabel} · ${graph.edges.length} liens résolus · ${declarationCount} déclarations reçues` : `${receiptCounts.nano} received NanoReceipts · ${receiptCounts.support} received support items · ${finalReceiptCountLabel} · ${graph.edges.length} resolved links · ${declarationCount} received declarations`}</p><p>{c.verdict} : {result?.verdict ?? c.pending}</p><p>{result ? c.samePackage : c.declared}</p><p>{fr ? "L’identité technique exacte du paquet reste disponible dans Forensic." : "The package’s exact technical identity remains available in Forensic."}</p><p>{result ? c.after : c.before}</p></div>)}
      {result && details("graph:checks", "inspection-check-summary", fr ? `${result.completedChecks.length} contrôles du paquet terminés` : `${result.completedChecks.length} completed package checks`, <div className="inspection-check-popover"><p>{c.established}</p>{establishedChecks.length > 0 && <ul className="inspection-established">{establishedChecks.map(([key, title]) => <li key={key}>{title}</li>)}</ul>}<p>{fr ? `${result.completedChecks.length} contrôles terminés au total. Les codes exacts restent dans Forensic.` : `${result.completedChecks.length} checks completed in total. Exact codes remain in Forensic.`}</p><p>{c.reasons}</p><p>{fr ? `${result.reasonCodes.length} motifs de verdict enregistrés. Les codes exacts restent dans Forensic.` : `${result.reasonCodes.length} verdict reasons recorded. Exact codes remain in Forensic.`}</p></div>)}
      <button type="button" onClick={() => { setMode(expanded ? "all" : "path"); updateSelection({}); onSelectNode?.(null); setShowCrossings(false); setHighlightedFamily(null); setScale(100); }}>{c.reset}</button>
      {layout === "full" && !dedicated && <label>{c.zoom}<input type="range" min="20" max="150" step="10" value={scale} onChange={event => setScale(Number(event.target.value))} /><output>{scale}%</output></label>}
    </div>;

  const panelActions = <section className="inspection-action-block">
    <h4>{fr ? "Dans le graphe" : "In the graph"}</h4>
    <div className="inspection-actions">
      <button type="button" aria-pressed={graphMode === "causal"} onClick={() => applyGraphMode("causal")}><strong>{c.isolate}</strong><small>{fr ? "Parents et enfants directs" : "Direct parents and children"}</small></button>
      <button type="button" aria-pressed={graphMode === "follow"} onClick={() => applyGraphMode("follow")}><strong>{c.follow}</strong><small>{fr ? "Un chemin causal exact" : "One exact causal path"}</small></button>
    </div>
  </section>;

  const workspace = <section ref={workspaceRef} className="inspection-workspace" data-expanded={expanded} data-graph-preset={displayPreset} data-graph-mode={graphMode} data-highlighted-family={highlightedFamily ?? undefined} data-inspection-level={selected ? 2 : 1} data-focus-mode={mode} data-layout={layout}>
    {!dedicated && <header className="inspection-summary">
      <div><h3>{expanded ? c.graph : fr ? "Le parcours de preuve" : "The evidence journey"}</h3><p>{expanded ? (fr ? `${receiptCounts.nano} NanoReceipts reçus · ${receiptCounts.support} preuves de support reçues · ${finalReceiptCountLabel} · ${graph.edges.length} liens source→cible résolus · ${declarationCount} déclarations de relation reçues` : `${receiptCounts.nano} received NanoReceipts · ${receiptCounts.support} received support items · ${finalReceiptCountLabel} received · ${graph.edges.length} resolved source-to-target links · ${declarationCount} received relation declarations`) : `${c.declared} · ${result ? c.after : c.before}`}</p></div>
      {expanded && <><div className="inspection-package-status" data-verdict={result?.verdict ?? "PENDING"}><span>{c.verdict}</span><strong>{result?.verdict ?? c.pending}</strong></div>{onReturnToVerifier && <button type="button" className="inspection-leave" data-close-graph-workspace onClick={onReturnToVerifier}>{fr ? `Retour à ${returnLabel ?? "la vue précédente"}` : `Back to ${returnLabel ?? "the previous view"}`} <span aria-hidden="true">↙</span></button>}</>}
    </header>}
    {dedicated ? details("graph:options", "inspection-options", fr ? "Paquet et contrôles" : "Package and checks", toolbar, { "data-graph-options": true }) : toolbar}
    {dedicated && <div className="inspection-display-controls" data-display-controls>
      <div className="inspection-presets" aria-label={fr ? "Mode d’affichage" : "Display mode"}>{(["simplified", "causal", "follow", "expert"] as const).map(key => <button type="button" key={key} data-graph-mode-control={key} aria-pressed={graphMode === key} onClick={() => applyGraphMode(key)}>{key === "simplified" ? fr ? "Simplifié" : "Simplified" : key === "causal" ? "Causal" : key === "follow" ? fr ? "Suivre" : "Follow" : fr ? "Expert" : "Expert"}</button>)}<label className="inspection-scale">{c.zoom}<input type="range" min="50" max="150" step="10" value={scale} onChange={event => setScale(Number(event.target.value))} /><output>{scale}%</output></label></div>
      {graphMode === "follow" && <button type="button" className="inspection-follow-final" aria-pressed={followToFinal} onClick={() => setFollowToFinal(!followToFinal)}>{followToFinal ? (fr ? "Arrêter avant le Reçu final" : "Stop before Final Receipt") : (fr ? "Suivre jusqu’au Reçu final" : "Follow to Final Receipt")}</button>}
      {graphMode !== "expert" && (showNetworkContext ? networkContextCount > 0 : display.hiddenNetworkContext > 0) && <button type="button" className="inspection-network-context" data-network-context-toggle aria-pressed={showNetworkContext} onClick={() => setShowNetworkContext(!showNetworkContext)}>{showNetworkContext ? (fr ? "Masquer le contexte réseau" : "Hide network context") : (fr ? `Afficher le contexte réseau (${display.hiddenNetworkContext})` : `Show network context (${display.hiddenNetworkContext})`)}</button>}
      {graphMode !== "expert" && display.hiddenNetworkContext > 0 && <p className="inspection-network-context-note" data-network-context-hidden={display.hiddenNetworkContext}>{fr ? `${display.hiddenNetworkContext} NanoReceipt${display.hiddenNetworkContext > 1 ? "s" : ""} réseau sans relation causale propre ${display.hiddenNetworkContext > 1 ? "sont masqués" : "est masqué"} du graphe. ${display.hiddenNetworkContext > 1 ? "Ils restent" : "Il reste"} dans Réseau, Timeline et NanoReceipts.` : `${display.hiddenNetworkContext} network NanoReceipt${display.hiddenNetworkContext > 1 ? "s" : ""} without a causal relation of their own ${display.hiddenNetworkContext > 1 ? "are" : "is"} hidden from the graph. ${display.hiddenNetworkContext > 1 ? "They remain" : "It remains"} in Network, Timeline and NanoReceipts.`}</p>}
      <p><span data-display-counts>{fr ? `${display.counts.visible.nodes} unités affichées sur ${display.counts.total.nodes} reçues · ${display.counts.visible.edges} liens affichés sur ${display.counts.total.edges} résolus · ${display.counts.visible.declarations} déclarations affichées sur ${display.counts.total.declarations} reçues` : `${display.counts.visible.nodes} items shown of ${display.counts.total.nodes} received · ${display.counts.visible.edges} links shown of ${display.counts.total.edges} resolved · ${display.counts.visible.declarations} declarations shown of ${display.counts.total.declarations} received`}</span></p>
    </div>}
    {details("graph:families", "inspection-families", fr ? `Voir les ${evidenceUnitCount} unités reçues par famille` : `View all ${evidenceUnitCount} received items by family`, <div className="inspection-family-grid">{families.map(family => details(`graph:family:${family.key}`, "inspection-family", <><strong>{fr ? `Famille · ${family.title}` : `Family · ${family.title}`}</strong><span>{fr ? `Voir ${unitLabel(family.nodes.length)}` : `View ${unitLabel(family.nodes.length)}`}</span></>, <><button type="button" data-highlight-family={family.key} aria-pressed={highlightedFamily === family.key} onClick={() => highlightFamily(family.key)}>{fr ? "Surligner dans le graphe" : "Highlight in graph"}</button><ul>{family.nodes.map(node => <li key={node.key}><button type="button" data-family-node={node.key} onClick={() => chooseNode(node.key)}><small>{number(node)}</small>{label(node)}</button></li>)}</ul></>, { "data-nr-family": family.key }))}</div>, { "data-nr-families": true })}
    <div className="inspection-desk" data-has-selection={selected} data-persistent-panel={expanded}>
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- A scrollable graph region needs keyboard focus for panning. */}
      <div className="inspection-canvas" role="region" aria-label={c.graph} tabIndex={0}>
        {layout === "story" ? <>
          {path.length ? <ReceivedPathOverview graph={graph} path={path} locale={locale} onReceipt={chooseNode} onCrossing={chooseCrossing} selectedKey={selectedNode?.key} emphasis={mode === "all" ? undefined : emphasis} /> : <p>{c.noPath}</p>}

        </> : <CanonicalGraph graph={graph} display={display} layers={displayLayers} preset={displayPreset} path={display.path.length ? display.path : path} selectedBoundaryEdges={new Set(exactBoundaryEdge ? [exactBoundaryEdge.key] : selectedBoundary?.edgeKeys ?? [])} locale={locale} scale={scale} tone={tone} edgeTone={edgeTone} selectedKey={selectedNode?.key} label={label} number={number} crossingLabel={crossingLabel} onNode={chooseNode} onEdge={key => { beginContextInspection(); setHighlightedFamily(null); const edge = graph.edges.find(item => item.key === key); updateSelection({ edgeKey: key, nodeKey: edge?.to }); setMode("isolate"); }} onCrossing={chooseCrossing} uiState={uiState} onUIStateChange={onUIStateChange} restoreToken={restoreToken} navigationIntent={legacyRestoration ? "restore" : navigationIntent} />}
        {graphMode === "follow" && selectedNode && display.path.length === 0 && <p role="status" className="inspection-canvas-note">{fr ? "Aucun chemin causal complet n’est résolu pour cette sélection. Les déclarations restent consultables en mode Expert." : "No complete causal path resolves for this selection. Declarations remain available in Expert mode."}</p>}
        {graphMode === "causal" && selectedNode && display.edges.length === 0 && <p role="status" className="inspection-canvas-note">{incidentEdges.length === 0 ? (fr ? "Aucun lien direct résolu pour cette sélection dans ce PEB." : "No resolved direct link for this selection in this PEB.") : (fr ? "Les liens directs reçus sont masqués dans ce mode. Consultez le mode Expert." : "The received direct links are hidden in this mode. Open Expert mode.")}</p>}
        {details("graph:boundaries", "inspection-boundary-index", <>{fr ? "Explorer les domaines traversés →" : "Explore the domains crossed →"}<small>{fr ? `${boundaries.length} groupes de passages et de contexte` : `${boundaries.length} crossing and context groups`}</small></>, <div>{boundaries.length ? boundaries.map(boundary => <button type="button" key={boundary.key} data-boundary-kind={boundary.kind} data-boundary-key={boundary.key} aria-pressed={boundary.key === selectedBoundary?.key} onClick={() => chooseBoundary(boundary.key)}><span aria-hidden="true">↗</span><small>{c[boundary.kind]}</small><strong>{boundaryLabel(boundary)}</strong><span>{boundaryRelationLabel(boundary.edgeKeys.length)}</span></button>) : <p>{fr ? "Aucun changement de contexte déclaré sur les liens résolus de ce PEB." : "No declared context change on the resolved links in this PEB."}</p>}</div>)}
        {(layout === "story" ? path.length > 0 : display.nodes.length > 0) && <p className="inspection-canvas-note" data-graph-legend>○ NanoReceipt · {fr ? "Preuve de support · Reçu final" : "Supporting evidence · Final Receipt"} · → {c.causal} · ⇢ {c.observed} · ║ {c.boundary}</p>}{graphMode === "simplified" && <p className="inspection-canvas-note">{fr ? "Les faits intermédiaires sont masqués. Chaque flèche correspond à une relation reçue entre deux faits visibles. Un intervalle sans flèche est un saut de lecture." : "Intermediate facts are hidden. Every arrow is a received relation between two visible facts. An interval without an arrow is a reading gap."}</p>}
      </div>
      {selected ? <aside ref={inspectorRef} className="inspection-panel" aria-label={c.selected} data-level="2" onScroll={(event) => { const panel = event.currentTarget; if (!uiState || panel.scrollLeft !== uiState.inspectorScroll.x || panel.scrollTop !== uiState.inspectorScroll.y) onUIStateChange?.({ inspectorScroll: { x: panel.scrollLeft, y: panel.scrollTop } }); }}>
        <div className="inspection-panel-top"><span>{fr ? "Résumé" : "Summary"}</span><button className="inspection-context-return" type="button" onClick={returnToEvent}>{fr ? "Retour à l’événement" : "Back to event"}</button><button type="button" data-context-close aria-label={c.close} onClick={returnToEvent}>×</button></div>
        {(selectedEdge || selectedBoundary || !selectedNode) && <h3>{selectedBoundary || selectedEdge?.crossings.length ? ((selectedBoundary?.kind === "producer" || selectedEdge?.crossings.some(crossing => crossing.kind === "producer")) ? (fr ? "Passage entre domaines" : "Crossing between domains") : (fr ? "Changement de contexte" : "Context change")) : selectedEdge ? (fr ? "Pourquoi ce lien ?" : "Why this link?") : selectedNode ? label(selectedNode) : c.edge}</h3>}
        {selectedBoundary && <button type="button" className="inspection-view-crossings" aria-expanded={showCrossings} onClick={() => { setShowCrossings(!showCrossings); setMode("isolate"); }}>{boundaryRelationLabel(boundaryEdges.length)}</button>}
        {selectedBoundary && showCrossings && <div className="inspection-crossing-list">{boundaryEdges.map((edge) => <button type="button" className="inspection-crossing-event" key={edge.key} data-edge-key={edge.key} aria-pressed={exactBoundaryEdge?.key === edge.key} onClick={() => chooseBoundary(selectedBoundary.key, edge.key)}><small>{edge.causal ? c.causal : c.observed}</small>{label(nodes.get(edge.from)!)} <span aria-hidden="true">{edge.causal ? "→" : "⇢"}</span> {label(nodes.get(edge.to)!)}</button>)}</div>}
        {selectedNode && !selectedEdge && !selectedBoundary ? <>
          {selectedEntry ? <FactInspector as="div" className="inspection-fact-inspector" heading="h3" entry={selectedEntry} catalog={factCatalog} network={factSupport?.network} linksForEntry={factSupport?.linksForEntry} onSelectEntry={factSupport?.onSelectEntry} locale={locale} text={text} context="graph" onSelectNode={chooseNode} onOpenEvidence={onOpenEvidence ? () => onOpenEvidence(selectedNode.key) : undefined} /> : <p className="inspection-unknown">{c.missing}</p>}
          {incidentEdges.some(edge => edge.crossings.length) && <div className="inspection-related-boundaries">{boundaries.filter(boundary => boundary.edgeKeys.some(key => incidentEdges.some(edge => edge.key === key))).map(boundary => <button key={boundary.key} type="button" data-boundary-kind={boundary.kind} onClick={() => chooseBoundary(boundary.key)}>{fr ? "Explorer le passage" : "Explore crossing"} · {boundaryLabel(boundary)}</button>)}</div>}
          {panelActions}
        </> : <>
          {exactBoundaryEdge || selectedEdge?.crossings.length ? <GuidedBoundaryInspector embedded graph={graph} text={text} edge={exactBoundaryEdge ?? selectedEdge!} locale={locale} onSelectNode={chooseNode} onOpenEvidence={onOpenEvidence} onOpenForensic={onOpenForensic} onClose={returnToEvent} uiState={uiState} onUIStateChange={onUIStateChange} relationExplanation={<ReceivedRelationExplanation graph={graph} text={text} edge={exactBoundaryEdge ?? selectedEdge!} locale={locale} onSelectNode={chooseNode} onOpenForensic={onOpenForensic} />} /> : selectedBoundary ? <GuidedBoundaryGroupInspector embedded graph={graph} text={text} boundary={selectedBoundary} locale={locale} onSelectNode={chooseNode} onOpenEvidence={onOpenEvidence} onOpenForensic={onOpenForensic} onSelectEdge={(edgeKey) => chooseBoundary(selectedBoundary.key, edgeKey)} onClose={returnToEvent} uiState={uiState} onUIStateChange={onUIStateChange} /> : selectedEdge ? <><p>{fr ? "Un lien reçu relie ces deux faits." : "A received link connects these two facts."}</p><div className="inspection-summary-neighbors">{[selectedEdge.from, selectedEdge.to].map((key, index) => { const node = nodes.get(key)!; return <section key={key}><h4>{index === 0 ? fr ? "Avant" : "Before" : fr ? "Après" : "After"}</h4><button className="inspection-neighbor" type="button" onClick={() => chooseNode(key)}>{label(node)}</button><p>{node.member?.producerDomain ? producer(node.member.producerDomain) : c.missing}</p></section>; })}</div>{details(`graph:causality:${selectedEdge.key}`, "inspection-depth", fr ? "Causalité" : "Causality", <ReceivedRelationExplanation graph={graph} text={text} edge={selectedEdge} locale={locale} onSelectNode={chooseNode} onOpenForensic={onOpenForensic} />)}{details(`graph:proofs:${selectedEdge.key}`, "inspection-depth", fr ? "Preuves" : "Proofs", <>{[selectedEdge.from, selectedEdge.to].map(key => <p key={key}>{number(nodes.get(key)!)}{onOpenEvidence && <button type="button" onClick={() => onOpenEvidence(key)}>{fr ? "Ouvrir le reçu" : "Open receipt"} →</button>}</p>)}</>)}{onOpenForensic && details(`graph:forensic:${selectedEdge.key}`, "inspection-depth", "Forensic", <button type="button" onClick={() => onOpenForensic(selectedEdge.to)}>{fr ? "Inspecter la source exacte" : "Inspect exact source"} →</button>)}</> : null}
        </>}
      </aside> : expanded ? <aside className="inspection-panel inspection-panel-empty" aria-label={c.selected}><div className="inspection-panel-top"><span>{c.context}</span></div><h3>{c.select}</h3><p>{c.selectionHelp}</p><p>{fr ? "Chaque nœud de preuve présente un NanoReceipt, une preuve de support ou le Reçu final. Les flèches portent les relations causales et les doubles barres signalent les frontières déclarées." : "Each evidence node presents a NanoReceipt, supporting evidence or the Final Receipt. Arrows carry causal relations and double bars mark declared boundaries."}</p>{graph.finalKey && <button type="button" onClick={() => chooseNode(graph.finalKey!)}>{fr ? "Inspecter le reçu final" : "Inspect the Final Receipt"}</button>}</aside> : null}
    </div>
  </section>;
  return workspace;
}

function CanonicalGraph({ graph, display, layers, preset, path, selectedBoundaryEdges, locale, scale, tone, edgeTone, selectedKey, label, number, crossingLabel, onNode, onEdge, onCrossing, uiState, onUIStateChange, restoreToken, navigationIntent }: {
  graph: ReceivedGraph; display: ReturnType<typeof graphDisplay>; layers: GraphLayers; preset: GraphPreset; path: readonly string[]; selectedBoundaryEdges: ReadonlySet<string>;
  locale: "en" | "fr"; scale: number; tone: (key: string) => string; edgeTone: (edge: ReceivedGraphEdge) => string;
  selectedKey?: string; label: (node: ReceivedGraphNode) => string; number: (node: ReceivedGraphNode) => string; crossingLabel: (crossing: ReceivedGraphEdge["crossings"][number]) => string;
  onNode: (key: string) => void; onEdge: (key: string) => void; onCrossing: (key: string) => void;
} & VerifierPresentationProps) {
  const uid = useId().replaceAll(":", "");
  const regionRef = useRef<HTMLDivElement>(null);
  const boundarySignature = [...selectedBoundaryEdges].sort().join("|");
  const restoreGraphScroll = useEffectEvent(() => {
    const region = regionRef.current;
    if (region && uiState && navigationIntent === "restore") region.scrollTo({ left: uiState.graphScroll.x, top: uiState.graphScroll.y, behavior: "instant" });
  });
  useLayoutEffect(() => {
    restoreGraphScroll();
  }, [restoreToken]);
  useEffect(() => {
    const region = regionRef.current;
    if (!region || navigationIntent === "restore" || (!selectedKey && !boundarySignature)) return;
    const candidates = region.querySelectorAll<SVGGraphicsElement>(selectedKey ? "[data-received-node-key]" : "[data-boundary-selected=true]");
    const selected = selectedKey ? [...candidates].find(element => element.getAttribute("data-received-node-key") === selectedKey) : candidates[0];
    if (!selected) return;
    const box = selected.getBoundingClientRect(); const frame = region.getBoundingClientRect();
    const horizontal = box.left < frame.left + 12 || box.right > frame.left + region.clientWidth - 12;
    const vertical = box.top < frame.top + 12 || box.bottom > frame.top + region.clientHeight - 12;
    if (horizontal || vertical) region.scrollTo({
      left: horizontal ? Math.max(0, region.scrollLeft + box.left - frame.left - (region.clientWidth - box.width) / 2) : region.scrollLeft,
      top: vertical ? Math.max(0, region.scrollTop + box.top - frame.top - (region.clientHeight - box.height) / 2) : region.scrollTop,
      behavior: "instant",
    });
  }, [selectedKey, boundarySignature, navigationIntent]);
  const positions = new Map<string, { x: number; y: number }>();
  const depths = display.nodes.flatMap(node => node.depth === null ? [] : [node.depth]);
  const visibleDepths = [...new Set(depths)].sort((a, b) => a - b);
  const visualDepth = (node: ReceivedGraphNode) => preset === "simplified" ? node.depth === null ? visibleDepths.length : visibleDepths.indexOf(node.depth) : node.depth ?? Math.max(0, ...depths) + 1;
  const visualDepths = display.nodes.map(visualDepth);
  const minDepth = Math.min(0, ...visualDepths); const maxDepth = Math.max(0, ...visualDepths);
  const milestones = new Set(receivedPathOutline(graph, path).milestones.map(node => node.key));
  const domainNodes = (domain: string) => display.nodes.filter(node => (node.member?.producerDomain ?? "—") === domain);
  const domains = [...new Set(display.nodes.map(node => node.member?.producerDomain ?? "—"))].sort((a, b) => {
    const depth = (domain: string) => Math.min(...domainNodes(domain).map(node => visualDepth(node)));
    return depth(a) - depth(b) || Number(!domainNodes(a).some(node => receivedReceiptLabel(graph, node, locale).kind === "NANO_RECEIPT")) - Number(!domainNodes(b).some(node => receivedReceiptLabel(graph, node, locale).kind === "NANO_RECEIPT"));
  });
  const lanes: { domain: string; y: number; height: number }[] = []; let nextY = 12;
  for (const domain of domains) {
    const counts = new Map<number, number>();
    for (const node of domainNodes(domain)) {
      const depth = visualDepth(node); const row = counts.get(depth) ?? 0; counts.set(depth, row + 1);
      positions.set(node.key, { x: 110 + (depth - minDepth) * 205, y: nextY + 76 + row * 96 });
    }
    const height = Math.max(132, Math.max(...counts.values()) * 96 + 42); lanes.push({ domain, y: nextY, height }); nextY += height;
  }
  const width = Math.max(600, 220 + (maxDepth - minDepth + 1) * 205); const height = Math.max(200, nextY + 24);
  const labelLines = (value: string) => {
    const words = value.split(/\s+/); const lines = [""];
    for (const word of words) {
      const last = lines.length - 1;
      if (lines[last] && `${lines[last]} ${word}`.length > 21) { if (lines.length === 2) { lines[1] = `${lines[1].slice(0, 20)}…`; break; } lines.push(word); }
      else lines[last] = `${lines[last]} ${word}`.trim();
    }
    return lines.map(line => line.length > 21 ? `${line.slice(0, 20)}…` : line);
  };
  const activate = (event: KeyboardEvent, action: () => void) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); action(); } };
  // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Keyboard users must be able to focus and pan this scroll region.
  return <div ref={regionRef} className="inspection-full-graph" role="region" tabIndex={0} aria-label={locale === "fr" ? "Graphe causal complet" : "Full causal graph"} data-visible-node-count={display.nodes.length} data-visible-edge-count={display.edges.length} data-graph-scale={scale} onScroll={(event) => {
    const region = event.currentTarget;
    if (!uiState || region.scrollLeft !== uiState.graphScroll.x || region.scrollTop !== uiState.graphScroll.y) onUIStateChange?.({ graphScroll: { x: region.scrollLeft, y: region.scrollTop } });
  }}>
    {display.nodes.length === 0 ? <p className="inspection-empty-layers" role="status">{graph.nodes.length === 0 ? (locale === "fr" ? "Aucune unité de preuve reçue dans ce PEB." : "No received evidence item in this PEB.") : !selectedKey && (preset === "causal") ? (locale === "fr" ? "Aucun fait sélectionné. Choisissez un événement dans les familles reçues ou passez en mode Simplifié." : "No fact selected. Choose an event in the received families or switch to Simplified mode.") : (locale === "fr" ? "Aucune preuve affichée dans ce mode. Le mode Expert conserve l’inventaire reçu complet." : "No evidence displayed in this mode. Expert mode retains the complete received inventory.")}</p> : <svg width={width * scale / 100} height={height * scale / 100} viewBox={`0 0 ${width} ${height}`}>
      <defs><marker id={`${uid}-arrow`} markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7" fill="currentColor" /></marker></defs>
      {lanes.map((lane, index) => <g className="received-domain-lane" key={lane.domain}>{layers.contextZones && <rect x="0" y={lane.y} width={width} height={lane.height} fill={index % 2 ? "#edf2f1" : "#fbfcfd"} />}<text x="12" y={lane.y + 20}><title>{receivedProducerLabel(lane.domain, locale)}</title>{receivedProducerLabel(lane.domain, locale).length > 36 ? `${receivedProducerLabel(lane.domain, locale).slice(0, 35)}…` : receivedProducerLabel(lane.domain, locale)}</text></g>)}
      {display.edges.map(edge => { const from = positions.get(edge.from)!; const to = positions.get(edge.to)!; const bend = Math.max(25, Math.abs(to.x - from.x) * .4); return <g key={edge.key} className="received-graph-edge" data-tone={edgeTone(edge)} data-relation-class={graphRelationClass(edge, display.primaryEdges, display.pathEdges)} data-causal={edge.causal} data-received-edge-key={edge.key}>
        <path role="button" tabIndex={0} aria-label={`${edge.causal ? "→" : "⇢"} ${label(graph.nodes.find(node => node.key === edge.from)!)} → ${label(graph.nodes.find(node => node.key === edge.to)!)}`} onClick={() => onEdge(edge.key)} onKeyDown={event => activate(event, () => onEdge(edge.key))} d={`M${from.x + 85},${from.y} C${from.x + 85 + bend},${from.y} ${to.x - 85 - bend},${to.y} ${to.x - 85},${to.y}`} markerEnd={`url(#${uid}-arrow)`} />
        {layers.boundaries && edge.crossings.length > 0 && <g className="received-graph-boundary" data-boundary-selected={selectedBoundaryEdges.has(edge.key)} role="button" tabIndex={0} aria-label={edge.crossings.map(crossingLabel).join("; ")} onClick={() => onCrossing(edge.key)} onKeyDown={event => activate(event, () => onCrossing(edge.key))} data-crossing-edge={edge.key} transform={`translate(${(from.x + to.x) / 2},${(from.y + to.y) / 2})`}><rect x="-13" y="-14" width="26" height="28" rx="5" /><text textAnchor="middle" y="5">║</text></g>}
      </g>; })}
      {display.nodes.map(node => { const pos = positions.get(node.key)!; const receipt = receivedReceiptLabel(graph, node, locale); const major = milestones.has(node.key); return <g key={node.key} transform={`translate(${pos.x},${pos.y})`} className="received-graph-node" data-tone={tone(node.key)} data-receipt-kind={receipt.kind} data-major-fact={major} data-simplified={preset === "simplified"} data-received-node-key={node.key} data-cycle={graph.cycleKeys.includes(node.key)} data-quarantined={node.member?.assurance === "QUARANTINED"} role="button" tabIndex={0} aria-label={`${number(node)}: ${label(node)}`} aria-pressed={selectedKey === node.key} onClick={() => onNode(node.key)} onKeyDown={event => activate(event, () => onNode(node.key))}>
        <title>{`${number(node)}\n${label(node)}`}</title><rect x="-85" y="-38" width="170" height="76" rx="8" /><circle cx="-72" cy="-23" r="4" /><text className="inspection-node-nr" x="-62" y="-19">{number(node).length > 20 ? `${number(node).slice(0, 19)}…` : number(node)}</text><text className="inspection-node-event" textAnchor="middle">{labelLines(label(node)).map((line, index) => <tspan x="0" y={6 + index * 17} key={index}>{line}</tspan>)}</text>
      </g>; })}
    </svg>}
  </div>;
}

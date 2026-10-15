"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { groupInspectionBoundaries } from "./inspectionPresentation.ts";
import type { GraphMode, ReceivedGraphContext } from "./graphDisplay.ts";
import type { GraphInspectionNavigation } from "./graphHandoff.ts";
import { InspectionWorkspace } from "./InspectionWorkspace";
import { verifierExpandedPanels, type VerifierPresentationProps } from "./verifierPresentation.ts";
import { storyKeyAfter, timelineReadingKey } from "./verifierNavigation.ts";
import type { D006VerdictSnapshot } from "../offlineVerification.ts";
import type { ReceivedPebProjection } from "./inspectReceivedPeb.ts";
import { projectReceivedGraph, receivedEvidencePath, receivedFocus } from "./receivedGraph.ts";
import "./receivedInspection.css";
import { ReceivedPathOverview } from "./ReceivedPathOverview";
import { ReceivedDomainsOverview } from "./ReceivedDomainsOverview";
import { EvidenceTimeline } from "./EvidenceTimeline";
import { GuidedBoundaryGroupInspector, GuidedBoundaryInspector } from "./GuidedEventInspector";
import { FactInspector, type FactInspectorSupport } from "./FactInspector.tsx";
import { catalogEntryByNodeKey, createReceivedEvidenceCatalog } from "./receivedEvidenceCatalog.ts";
import { ReceivedRelationExplanation } from "./ReceivedRelationExplanation.tsx";
import { edgeForBoundarySelection, noEvidenceSelection, selectedEventKey, selectionFromGraphContext, type EvidenceSelection } from "./guidedInspection.ts";
import "./guided-inspection.css";
import "./ux-cleanup-workspace.css";

const copy = {
  en: {
    understand: "Understand", verify: "Verify", expert: "Expert", expertTitle: "Specialist views", path: "Evidence Path", domains: "Domains", graph: "Causal Graph",
    structure: "Structure", flow: "Evidence Flow", receipts: "Receipts", trust: "Trust", missing: "Not declared", final: "Final Receipt",
    provenance: "Received PEB → declared facts → exact relations → this inspection",
    pathNote: "One continuous directed path to the selected receipt. Every arrow is declared in the received PEB. Other branches remain in the complete graph.",
    pathRule: "The longest resolved causal path is shown; ties use field order. Observed inputs are never used as causal steps. A displayed path is not a verification finding.",
    noPath: "No resolved acyclic path to this receipt can be displayed. Inspect the declared relations and diagnostics below.",
    to: "Path ends at", steps: "Steps", previous: "Previous steps", next: "Continue path", all: "Show full graph", focus: "Focus this path", zoom: "Graph scale",
    members: "manifest members", links: "directed links", declarations: "relation declarations", components: "components", cycles: "members in cycles", unresolved: "unresolved / ambiguous references",
    legendReceipt: "○ NanoReceipt · Supporting evidence · Final Receipt", legendCausal: "→ Causal relation", legendObserved: "⇢ Observed input", legendBoundary: "║ Declared boundary change",
    crossing: "BOUNDARY", producer: "Producer domain", authority: "Authority context", execution: "Execution locality", trustBoundary: "Trust boundary ID", issuer: "Issuer", trustChange: "Trust boundary changes", quarantined: "Quarantined declaration",
    boundaryNote: "Markers compare explicit declarations at both ends of this relation. An absent context does not establish a change of authority or execution.",
    selection: "Selected receipt", closeSelection: "Close receipt details", field: "Received field", digest: "Declared member digest", event: "Declared event", receiptId: "Declared receipt ID", evidenceId: "Declared evidence ID", label: "Label in the file",
    depth: "Causal depth", component: "Component", assurance: "Declared assurance", parents: "Causal parents", children: "Causal children", inspect: "Inspect receipt",
    CAUSAL_PARENT: "Causal parent", OBSERVED_INPUT: "Observed input", FINAL_RECEIPT_INPUT: "Final Receipt input",
    issue: "Inspection diagnostics", cycleNote: "Causal cycles prevent a reliable depth or path for the affected members and their dependants. These members and their relations remain in the full graph.",
    refNote: "Unresolved and ambiguous references are listed with their exact fields. They are not drawn as invented evidence nodes.",
    fullNote: "All manifest entries and resolved declared links are retained, including assurance support and quarantine declarations. Coincident links share an arrow; every typed declaration is retained in Evidence Flow.",
    scope: "Captions translate known event identifiers. Technical identities, received positions and exact source paths remain available only in Forensic.",
  },
  fr: {
    understand: "Comprendre", verify: "Vérifier", expert: "Expert", expertTitle: "Vues spécialisées", path: "Chemin de preuve", domains: "Domaines", graph: "Graphe causal",
    structure: "Structure", flow: "Flux de preuve", receipts: "Reçus", trust: "Confiance", missing: "Non déclaré", final: "Reçu final",
    provenance: "PEB reçu → faits déclarés → relations exactes → cette inspection",
    pathNote: "Un chemin orienté continu jusqu’au reçu choisi. Chaque flèche est déclarée dans le PEB reçu. Les autres branches restent dans le graphe complet.",
    pathRule: "Le plus long chemin causal résolu est présenté ; l’ordre des champs départage les égalités. Les entrées observées ne deviennent jamais des étapes causales. Ce chemin n’est pas un résultat de vérification.",
    noPath: "Aucun chemin acyclique résolu vers ce reçu ne peut être présenté. Consultez les relations déclarées et les diagnostics ci-dessous.",
    to: "Le chemin aboutit à", steps: "Étapes", previous: "Étapes précédentes", next: "Poursuivre le chemin", all: "Voir le graphe complet", focus: "Centrer sur ce chemin", zoom: "Échelle du graphe",
    members: "membres du manifeste", links: "liens orientés", declarations: "déclarations de relations", components: "composantes", cycles: "membres dans un cycle", unresolved: "références non résolues / ambiguës",
    legendReceipt: "○ NanoReceipt · Preuve de support · Reçu final", legendCausal: "→ Relation causale", legendObserved: "⇢ Entrée observée", legendBoundary: "║ Changement de frontière déclaré",
    crossing: "FRONTIÈRE", producer: "Domaine producteur", authority: "Contexte d’autorité", execution: "Localité d’exécution", trustBoundary: "Identifiant de frontière de confiance", issuer: "Émetteur", trustChange: "Changement de frontière de confiance", quarantined: "Déclaration en quarantaine",
    boundaryNote: "Les marqueurs comparent les déclarations explicites aux deux extrémités du lien. Un contexte absent n’établit pas un changement d’autorité ou d’exécution.",
    selection: "Reçu sélectionné", closeSelection: "Fermer la fiche du reçu", field: "Champ reçu", digest: "Empreinte déclarée du membre", event: "Événement déclaré", receiptId: "Identifiant déclaré du reçu", evidenceId: "Identifiant déclaré de la preuve", label: "Libellé dans le fichier",
    depth: "Profondeur causale", component: "Composante", assurance: "Assurance déclarée", parents: "Parents causaux", children: "Enfants causaux", inspect: "Inspecter le reçu",
    CAUSAL_PARENT: "Parent causal", OBSERVED_INPUT: "Entrée observée", FINAL_RECEIPT_INPUT: "Entrée du reçu final",
    issue: "Diagnostics d’inspection", cycleNote: "Les cycles causaux empêchent une profondeur ou un chemin fiable pour les membres concernés et leurs descendants. Ces membres et leurs relations restent dans le graphe complet.",
    refNote: "Les références non résolues et ambiguës figurent avec leur champ exact. Aucun nœud de preuve n’est inventé pour les représenter.",
    fullNote: "Tous les membres et liens déclarés résolus sont conservés, y compris les supports d’assurance et les déclarations de quarantaine. Les liens de mêmes extrémités partagent une flèche ; chaque déclaration typée reste dans Flux de preuve.",
    scope: "Les légendes traduisent les identifiants d’événements connus. Les identités techniques, positions reçues et chemins sources exacts restent réservés à Forensic.",
  },
} as const;
type ExpertView = "structure" | "flow" | "receipts" | "trust";type Level = "path" | "domains" | "graph" | "expert";

export function ReceivedCausalInspection({ peb, text, locale, expertViews, view, onNavigate, snapshot, selection: controlledSelection, onSelectionChange, onContextBack, selectedDomainId, onOpenDomain, graphMode, onGraphModeChange, followToFinal, onFollowToFinalChange, onOpenEvidence, onOpenForensic, returnLabel, factSupport, condensed = false, ...graphNavigation }: GraphInspectionNavigation & VerifierPresentationProps & {
  snapshot?: D006VerdictSnapshot | null; peb: ReceivedPebProjection; text: string; locale: "en" | "fr"; expertViews: Record<ExpertView, ReactNode>; view?: "path" | "domains" | "graph" | ExpertView; onNavigate?: (view: "path" | "domains" | "graph") => void;
  selection?: EvidenceSelection; onSelectionChange?: (selection: EvidenceSelection) => void; onContextBack?: () => void; selectedDomainId?: string | null; onOpenDomain?: (domainId: string) => void;
  graphMode?: GraphMode; onGraphModeChange?: (mode: GraphMode) => void; followToFinal?: boolean; onFollowToFinalChange?: (value: boolean) => void; onOpenEvidence?: (nodeKey: string | null) => void; onOpenForensic?: (nodeKey: string | null) => void; returnLabel?: string;
  onBeginContextInspection?: () => void; onReturnToEvent?: () => void; readingNodeKey?: string | null;
  /** Catalog, network model and canonical links of the route shell; computed locally when absent. */
  factSupport?: FactInspectorSupport;
  /** Inside the route shell: the Verdict view owns package-wide notes, so they are not repeated here. */
  condensed?: boolean;
}) {
  const c = copy[locale];
  const graph = useMemo(() => projectReceivedGraph(peb, text), [peb, text]);
  const localCatalog = useMemo(() => factSupport ? null : createReceivedEvidenceCatalog(graph, locale, text), [factSupport, graph, locale, text]);
  const catalog = factSupport?.catalog ?? localCatalog!;
  const factTitleRef = useRef<HTMLHeadingElement>(null);
  const [localLevel, setLocalLevel] = useState<Level>("path"); const [localExpert, setExpert] = useState<ExpertView>("structure");
  const level = view === "path" || view === "domains" || view === "graph" ? view : view ? "expert" : localLevel;
  const expert = view && view !== "path" && view !== "domains" && view !== "graph" ? view : localExpert;
  const setLevel = (next: Level) => { if (next !== "expert" && onNavigate) onNavigate(next); else setLocalLevel(next); };
  const [localSelection, setLocalSelection] = useState<EvidenceSelection>(() => selectionFromGraphContext(graphNavigation.initialContext, graph));
  const selection = controlledSelection ?? localSelection;
  const setSelection = (next: EvidenceSelection) => {
    if (controlledSelection === undefined) setLocalSelection(next);
    onSelectionChange?.(next);
  };
  const selectedKey = selectedEventKey(selection);
  const [storyKey, setStoryKey] = useState<string | null>(() => storyKeyAfter(null, selection));
  if (storyKeyAfter(storyKey, selection) !== storyKey) setStoryKey(storyKeyAfter(storyKey, selection));
  const readingKey = timelineReadingKey(graphNavigation.readingNodeKey, selection, storyKey);
  const targetKey = graph.finalKey ?? graph.nodes.at(-1)?.key ?? null;
  const path = useMemo(() => receivedEvidencePath(graph, targetKey), [graph, targetKey]);
  const nodeMap = new Map(graph.nodes.map(node => [node.key, node]));
  const selected = nodeMap.get(selectedKey ?? "") ?? null;
  const boundaryEdge = edgeForBoundarySelection(graph, selection);
  const selectedRelation = selection.kind === "relation" ? graph.edges.find((edge) => edge.key === selection.edgeKey) ?? null : null;
  const selectedBoundary = selection.kind === "boundary" ? groupInspectionBoundaries(graph).find((boundary) => boundary.key === selection.boundaryKey) ?? null : null;
  const pathContext: ReceivedGraphContext = {
    preset: selected ? "causal" : "simplified", level: 2, focusMode: selected ? "follow" : "none",
    selectedNodeKey: selected?.key,
    selectedEdgeKey: selection.kind === "relation" ? selection.edgeKey : selection.kind === "boundary" ? selection.edgeKey : undefined,
    selectedBoundaryKey: selection.kind === "boundary" ? selection.boundaryKey : undefined,
  };
  const focus = receivedFocus(graph, selected?.key ?? null, path);
  // Neighbours of the primary path are context, not unrelated noise. This
  // changes emphasis only; every member and declaration stays in the graph.
  for (const edge of graph.edges) {
    if (focus.strong.has(edge.from) && !focus.strong.has(edge.to)) focus.context.add(edge.to);
    if (focus.strong.has(edge.to) && !focus.strong.has(edge.from)) focus.context.add(edge.from);
  }
  const selectNode = (key: string) => setSelection({ kind: "event", nodeKey: key });
  const selectBoundary = (edgeKey: string) => {
    const edge = graph.edges.find(candidate => candidate.key === edgeKey);
    if (!edge) return;
    graphNavigation.onBeginContextInspection?.();
    const boundaryKey = groupInspectionBoundaries(graph).find((boundary) => boundary.edgeKeys.includes(edgeKey))?.key;
    setSelection(boundaryKey ? { kind: "boundary", boundaryKey, edgeKey } : { kind: "relation", edgeKey, focusNodeKey: selectedKey ?? graphNavigation.readingNodeKey ?? edge.to });
  };
  const closeInspector = () => { if (onContextBack) onContextBack(); else setSelection(noEvidenceSelection); };
  const selectedEntry = selected && selection.kind === "event" ? catalogEntryByNodeKey(catalog, selected.key) : null;
  useEffect(() => { factTitleRef.current?.focus({ preventScroll: true }); }, [selectedEntry?.nodeKey]);
  const inspector = boundaryEdge ? <GuidedBoundaryInspector text={text} graph={graph} edge={boundaryEdge} locale={locale} onSelectNode={selectNode} onOpenEvidence={onOpenEvidence} onClose={closeInspector} />
    : selectedBoundary ? <GuidedBoundaryGroupInspector text={text} onSelectNode={selectNode} onOpenEvidence={onOpenEvidence} graph={graph} boundary={selectedBoundary} locale={locale} onSelectEdge={(edgeKey) => setSelection({ kind: "boundary", boundaryKey: selectedBoundary.key, edgeKey })} onClose={closeInspector} />
      : selectedRelation ? <aside id="guided-evidence-inspector" className="guided-event-inspector" aria-label={locale === "fr" ? "Relation sélectionnée" : "Selected relation"}><header><h3>{locale === "fr" ? "Pourquoi ce lien ?" : "Why this link?"}</h3><button type="button" onClick={closeInspector}>{locale === "fr" ? "Fermer l’inspection" : "Close inspection"}</button></header><ReceivedRelationExplanation graph={graph} edge={selectedRelation} text={text} locale={locale} onSelectNode={selectNode} onOpenForensic={onOpenForensic} /></aside>
        : selectedEntry ? <FactInspector id="guided-evidence-inspector" className="guided-event-inspector" entry={selectedEntry} catalog={catalog} network={factSupport?.network} linksForEntry={factSupport?.linksForEntry} onSelectEntry={factSupport?.onSelectEntry} locale={locale} text={text} context={level === "domains" ? "domains" : "timeline"} titleRef={factTitleRef} onClose={closeInspector} onSelectNode={selectNode} onOpenGraph={() => setLevel("graph")} onOpenEvidence={() => { if (onOpenEvidence) onOpenEvidence(selectedEntry.nodeKey); else { setExpert("receipts"); setLevel("expert"); } }} /> : null;
  return <div className="received-inspection" data-received-graph-digest={peb.transferDigest}>
    {level !== "graph" && !condensed && <p className="received-provenance">{c.provenance}</p>}
    {!view && <nav className="received-levels" aria-label={c.path}>
      {(["path", "domains", "graph", "expert"] as const).map((item, index) => <button type="button" key={item} aria-pressed={level === item} onClick={() => setLevel(item)}><small>{[c.understand, locale === "fr" ? "Situer" : "Locate", c.verify, c.expert][index]}</small><strong>{item === "expert" ? c.expertTitle : c[item]}</strong></button>)}
    </nav>}
    {level !== "expert" && <EvidenceTimeline graph={graph} text={text} locale={locale} selection={selection} onSelectionChange={setSelection} compact={level !== "path"} networkScope={!condensed} controlsId={level === "graph" ? "inspection-panel" : "guided-evidence-inspector"} readingNodeKey={level === "graph" ? readingKey : undefined} uiState={graphNavigation.uiState} onUIStateChange={graphNavigation.onUIStateChange} restoreToken={graphNavigation.restoreToken} navigationIntent={graphNavigation.navigationIntent} />}
    {level === "path" && <div className="guided-reading-layout" data-has-selection={!!inspector}><ReceivedPathOverview graph={graph} path={path} locale={locale} selectedKey={selectedKey ?? undefined} emphasis={selected ? focus : undefined} onReceipt={selectNode} onCrossing={selectBoundary} onDomain={onOpenDomain} />{inspector}</div>}
    {level === "domains" && <div className="guided-reading-layout" data-has-selection={!!inspector}><ReceivedDomainsOverview graph={graph} text={text} locale={locale} selectedKey={selectedKey} selectedDomainId={selectedDomainId} onReceipt={selectNode} onCrossing={selectBoundary} onDomain={onOpenDomain} uiState={graphNavigation.uiState} onUIStateChange={graphNavigation.onUIStateChange} />{inspector}</div>}
    {level === "path" && path.length > 0 && <div className="received-legend" data-graph-legend><span>{c.legendReceipt}</span><span>{c.legendCausal}</span><span>{c.legendObserved}</span><span>{c.legendBoundary}</span></div>}
    {level === "graph" && <InspectionWorkspace graph={graph} peb={peb} text={text} locale={locale} path={path} snapshot={snapshot} {...graphNavigation} returnLabel={returnLabel} selection={selection} onSelectionChange={setSelection} initialContext={graphNavigation.initialContext ?? pathContext} graphMode={graphMode} onGraphModeChange={onGraphModeChange} followToFinal={followToFinal} onFollowToFinalChange={onFollowToFinalChange} onOpenEvidence={onOpenEvidence} onOpenForensic={onOpenForensic} factSupport={factSupport ?? { catalog }} />}
    {level === "expert" && <section data-inspection-level="3" aria-label={c.expert}>{!view && <nav className="received-expert-nav" aria-label={c.expert}>{(["structure", "flow", "receipts", "trust"] as const).map(view => <button key={view} type="button" aria-pressed={expert === view} onClick={() => setExpert(view)}>{c[view]}</button>)}</nav>}{expertViews[expert]}{view === "structure" && expertViews.flow}</section>}
    {(graph.cycleKeys.length > 0 || graph.unresolved.length > 0 || graph.contextIssues.length > 0) && <details className="received-diagnostics" open={graphNavigation.uiState ? graphNavigation.uiState.expandedPanels.includes("received:diagnostics") : undefined} onToggle={(event) => {
      const state = graphNavigation.uiState; const open = event.currentTarget.open;
      if (state && open !== state.expandedPanels.includes("received:diagnostics")) graphNavigation.onUIStateChange?.({ expandedPanels: verifierExpandedPanels(state.expandedPanels, "received:diagnostics", open) });
    }}><summary>{c.issue} · {graph.cycleKeys.length} {c.cycles} · {graph.unresolved.length} {c.unresolved}</summary>
      {graph.cycleKeys.length > 0 && <p>{c.cycleNote}</p>}
      {graph.unresolved.length > 0 && <p>{locale === "fr" ? "Certaines références reçues sont absentes ou ambiguës. Aucun nœud ni lien de remplacement n’est ajouté." : "Some received references are missing or ambiguous. No replacement node or link is added."}</p>}
      {graph.contextIssues.length > 0 && <p>{locale === "fr" ? `${graph.contextIssues.length} diagnostics concernent la résolution du contexte déclaré.` : `${graph.contextIssues.length} diagnostics concern resolution of the declared context.`}</p>}
      <p>{locale === "fr" ? "Les identifiants, chemins sources et déclarations complets sont disponibles dans Forensic." : "Complete identifiers, source paths, and declarations are available in Forensic."}</p>
      {onOpenForensic && <button type="button" onClick={() => onOpenForensic(selected?.key ?? null)}>{locale === "fr" ? "Inspecter les déclarations dans Forensic →" : "Inspect declarations in Forensic →"}</button>}
    </details>}
    {!condensed && <p className="received-note">{c.scope}</p>}
  </div>;
}

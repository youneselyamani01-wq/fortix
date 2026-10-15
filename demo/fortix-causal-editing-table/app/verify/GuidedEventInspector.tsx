"use client";

import { useEffect, useRef, useState, type ReactNode, type SyntheticEvent } from "react";
import { guidedStoryHumanCaption } from "./guidedStory.ts";
import type { ReceivedGraph, ReceivedGraphEdge, ReceivedGraphNode } from "./receivedGraph.ts";
import { readInspectionEvidence, type InspectionBoundary } from "./inspectionPresentation.ts";
import { receivedEventLabel, receivedProducerLabel } from "./receivedLabels.ts";
import { receivedReceiptLabel } from "./receivedReceiptLabels.ts";
import { verifierExpandedPanels, type VerifierPresentationProps } from "./verifierPresentation.ts";
import "./boundary-context.css";

const authorityLabels: Readonly<Record<string, readonly [string, string]>> = {
  "passenger-mission": ["Passenger mission authority", "Autorité de mission passager"],
  maintenance: ["Maintenance authority", "Autorité de maintenance"],
  navigation: ["Navigation authority", "Autorité de navigation"],
  "financial-escalation": ["Financial escalation authority", "Autorité d’escalade financière"],
  "human-approval": ["Human approval authority", "Autorité d’approbation humaine"],
  financial: ["Payment authority", "Autorité de paiement"],
  "return-to-base": ["Return-to-base authority", "Autorité de retour à la base"],
  "fortix.demo.authority.passenger-mission.d005": ["Passenger mission authority", "Autorité de mission passager"],
  "fortix.demo.authority.maintenance.d005": ["Maintenance authority", "Autorité de maintenance"],
  "fortix.demo.authority.navigation.d005": ["Navigation authority", "Autorité de navigation"],
  "fortix.demo.authority.financial-escalation.d005m": ["Financial escalation authority", "Autorité d’escalade financière"],
  "fortix.demo.authority.human-approval.d005m": ["Human approval authority", "Autorité d’approbation humaine"],
  "fortix.demo.authority.master-payment.invoice-1850.d005m": ["Payment authority", "Autorité de paiement"],
  "fortix.demo.authority.return-to-base.d005m": ["Return-to-base authority", "Autorité de retour à la base"],
};

export function declaredAuthorityLabel(node: ReceivedGraphNode, text: string | undefined, locale: "en" | "fr"): string {
  const evidence = text === undefined ? null : readInspectionEvidence(text, node);
  const declarations = evidence?.status === "FOUND"
    ? evidence.fields.filter((field) => field.key === "authorityContext" || field.key === "authorityId").map((field) => field.value)
    : [];
  if (!declarations.length && node.context.authority) declarations.push(node.context.authority.value);
  const labels = [...new Set(declarations.map((value) => authorityLabels[value]?.[locale === "fr" ? 1 : 0]
    ?? (locale === "fr" ? "Autorité déclarée · détail en Forensic" : "Declared authority · detail in Forensic")))];
  return labels.length ? labels.join(" · ") : (locale === "fr" ? "Autorité non déclarée" : "Authority not declared");
}

function boundaryEventLabel(node: ReceivedGraphNode, locale: "en" | "fr"): string {
  return node.final ? (locale === "fr" ? "Reçu final" : "Final Receipt")
    : receivedEventLabel(node.member?.eventId, locale) ?? guidedStoryHumanCaption(node.context.label?.value, locale === "fr" ? "Événement déclaré" : "Declared event");
}

function boundaryDomainLabel(node: ReceivedGraphNode, locale: "en" | "fr"): string {
  return node.member?.producerDomain ? boundaryProducerLabel(node.member.producerDomain, locale)
    : (locale === "fr" ? "Domaine non déclaré" : "Domain not declared");
}

function boundaryProducerLabel(value: string, locale: "en" | "fr"): string {
  return guidedStoryHumanCaption(receivedProducerLabel(value, locale), locale === "fr" ? "Domaine déclaré · détail en Forensic" : "Declared domain · detail in Forensic");
}

function BoundaryDomainTransition({ source, destination, change, locale }: { source: string; destination: string; change: "same" | "different" | "unknown"; locale: "en" | "fr" }) {
  const fr = locale === "fr";
  return <div className="boundary-domain-transition">
    <div><small>{fr ? "Domaine source" : "Source domain"}</small><strong>{source}</strong></div>
    <div className="boundary-domain-change"><span aria-hidden="true">↓</span><span>{change === "same" ? (fr ? "Même domaine déclaré" : "Same declared domain") : change === "different" ? (fr ? "Changement de domaine déclaré" : "Declared domain change") : (fr ? "Changement de domaine non établi" : "Domain change not established")}</span><span aria-hidden="true">↓</span></div>
    <div><small>{fr ? "Domaine destination" : "Destination domain"}</small><strong>{destination}</strong></div>
  </div>;
}

function BoundaryCrossingReading({ graph, edge, text, locale, onSelectNode, showDomains = false }: {
  graph: ReceivedGraph; edge: ReceivedGraphEdge; text?: string; locale: "en" | "fr";
  onSelectNode?: (key: string) => void; showDomains?: boolean;
}) {
  const fr = locale === "fr";
  const before = graph.nodes.find((node) => node.key === edge.from);
  const after = graph.nodes.find((node) => node.key === edge.to);
  if (!before || !after) return <p role="status">{fr ? "Les événements de ce passage ne sont pas résolus." : "The events for this crossing are unresolved."}</p>;
  const eventControl = (node: ReceivedGraphNode, heading: string) => {
    const content = <><small>{heading}</small><strong>{boundaryEventLabel(node, locale)}</strong>{showDomains && <span>{boundaryDomainLabel(node, locale)}</span>}</>;
    return onSelectNode
      ? <button type="button" onClick={() => onSelectNode(node.key)} aria-label={`${fr ? "Voir l’événement" : "View event"} : ${boundaryEventLabel(node, locale)}`}>{content}</button>
      : <div>{content}</div>;
  };
  return <article className="boundary-crossing-reading" data-boundary-edge-key={edge.key}>
    <div className="boundary-event-pair">{eventControl(before, fr ? "Avant" : "Before")}<span aria-hidden="true">→</span>{eventControl(after, fr ? "Après" : "After")}</div>
    <section className="boundary-authority"><h4>{fr ? "Autorité déclarée" : "Declared authority"}</h4><dl><div><dt>{fr ? "Avant" : "Before"}</dt><dd>{declaredAuthorityLabel(before, text, locale)}</dd></div><div><dt>{fr ? "Après" : "After"}</dt><dd>{declaredAuthorityLabel(after, text, locale)}</dd></div></dl></section>
  </article>;
}

function BoundaryAssociatedProofs({ graph, edge, locale, onSelectNode, onOpenEvidence, onOpenForensic }: {
  graph: ReceivedGraph; edge: ReceivedGraphEdge; locale: "en" | "fr";
  onSelectNode?: (key: string) => void; onOpenEvidence?: (key: string | null) => void;
  onOpenForensic?: (key: string | null) => void;
}) {
  const fr = locale === "fr";
  const before = graph.nodes.find((node) => node.key === edge.from);
  const after = graph.nodes.find((node) => node.key === edge.to);
  if (!before || !after) return <p role="status">{fr ? "Preuves associées non résolues." : "Associated evidence unresolved."}</p>;
  const proofControl = (node: ReceivedGraphNode, heading: string) => {
    const title = receivedReceiptLabel(graph, node, locale).title;
    const action = onOpenEvidence
      ? (fr ? "Voir les preuves" : "View evidence")
      : (fr ? "Voir l’événement et sa preuve" : "View the event and its evidence");
    return <div className="boundary-proof-endpoint">
      {onOpenEvidence || onSelectNode ? <button type="button" onClick={() => onOpenEvidence ? onOpenEvidence(node.key) : onSelectNode?.(node.key)}>{action} : {boundaryEventLabel(node, locale)}<small>{heading} · {title}</small></button> : <p><strong>{heading}</strong> · {title}</p>}
      {onOpenForensic && <button type="button" className="boundary-forensic-action" onClick={() => onOpenForensic(node.key)}>Forensic · {heading} →</button>}
    </div>;
  };
  return <section className="boundary-proof-actions" data-boundary-proof-edge-key={edge.key}>
    {proofControl(before, fr ? "Preuve avant" : "Before evidence")}{proofControl(after, fr ? "Preuve après" : "After evidence")}
  </section>;
}

type BoundaryDepthProps = Pick<VerifierPresentationProps, "uiState" | "onUIStateChange"> & Readonly<{
  embedded?: boolean;
  relationExplanation?: ReactNode;
  onOpenForensic?: (key: string | null) => void;
}>;

function BoundaryDepth({ graph, edges, locale, panelKey, relationExplanation, onSelectNode, onOpenEvidence, onOpenForensic, uiState, onUIStateChange }: {
  graph: ReceivedGraph; edges: readonly ReceivedGraphEdge[]; locale: "en" | "fr"; panelKey: string;
  onSelectNode?: (key: string) => void; onOpenEvidence?: (key: string | null) => void;
} & BoundaryDepthProps) {
  const fr = locale === "fr";
  const [localPanels, setLocalPanels] = useState<readonly string[]>([]);
  const panels = uiState?.expandedPanels ?? localPanels;
  const disclosure = (level: "causality" | "proofs") => {
    const key = `boundary:${panelKey}:${level}`;
    return { open: panels.includes(key), "data-panel-key": key, onToggle: (event: SyntheticEvent<HTMLDetailsElement>) => {
      const open = event.currentTarget.open;
      if (open === panels.includes(key)) return;
      const expandedPanels = verifierExpandedPanels(panels, key, open);
      if (onUIStateChange) onUIStateChange({ expandedPanels }); else setLocalPanels(expandedPanels);
    } };
  };
  const declarations = edges.flatMap((edge) => edge.declarations);
  const natureLabels = {
    CAUSAL_PARENT: fr ? "Parent causal déclaré" : "Declared causal parent",
    OBSERVED_INPUT: fr ? "Entrée observée déclarée" : "Declared observed input",
    FINAL_RECEIPT_INPUT: fr ? "Entrée du Reçu final déclarée" : "Declared Final Receipt input",
  } as const;
  const kinds = [...new Set(declarations.map((declaration) => declaration.kind))];
  return <div className="boundary-depth">
    <details className="boundary-causality" {...disclosure("causality")}><summary>{fr ? "Causalité" : "Causality"}</summary>
      <section className="boundary-established" data-boundary-declaration-count={declarations.length}><h4>{fr ? "Déclarations reçues pour ce passage" : "Declarations received for this crossing"}</h4>
        {kinds.length ? <ul>{kinds.map((kind) => <li key={kind} data-boundary-declaration-kind={kind}><strong>{natureLabels[kind]}</strong> · {declarations.filter((declaration) => declaration.kind === kind).length} {fr ? "déclaration(s) reçue(s)" : "received declaration(s)"}</li>)}</ul> : <p>{fr ? "Aucune déclaration source ne porte ce passage." : "No source declaration carries this crossing."}</p>}
        <p>{fr ? "Les domaines et contextes affichés proviennent des déclarations reçues aux deux extrémités. Une entrée observée ne devient pas un parent causal." : "Displayed domains and contexts come from received declarations at both endpoints. An observed input does not become a causal parent."}</p>
      </section>
      <section className="boundary-trigger"><h4>{fr ? "Limite de ce passage" : "Limit of this crossing"}</h4><p><strong>{fr ? "Événement déclencheur" : "Triggering event"}</strong> · {fr ? "Le lien relie les deux faits reçus ci-dessus. Il n’établit pas, à lui seul, l’événement qui a déclenché physiquement le passage, ni un transfert d’autorité effectif." : "The link connects the two received facts above. It does not, by itself, establish the event that physically triggered the crossing or an effective authority transfer."}</p></section>
      {relationExplanation}
    </details>
    <details className="boundary-proofs" {...disclosure("proofs")}><summary>{fr ? "Preuves" : "Evidence"}</summary>
      <h4>{fr ? "Preuves associées" : "Associated evidence"}</h4>
      {edges.map((edge) => <BoundaryAssociatedProofs key={edge.key} graph={graph} edge={edge} locale={locale} onSelectNode={onSelectNode} onOpenEvidence={onOpenEvidence} onOpenForensic={onOpenForensic} />)}
    </details>
  </div>;
}

export function GuidedBoundaryInspector({ graph, edge, text, locale, onSelectNode, onOpenEvidence, onClose, embedded = false, relationExplanation, onOpenForensic, uiState, onUIStateChange }: {
  graph: ReceivedGraph; edge: ReceivedGraphEdge; text?: string; locale: "en" | "fr";
  onSelectNode: (key: string) => void; onOpenEvidence?: (key: string | null) => void; onClose: () => void;
} & BoundaryDepthProps) {
  const fr = locale === "fr";
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (!embedded) titleRef.current?.focus({ preventScroll: true }); }, [edge.key, embedded]);
  const before = graph.nodes.find((node) => node.key === edge.from);
  const after = graph.nodes.find((node) => node.key === edge.to);
  const source = before ? boundaryDomainLabel(before, locale) : (fr ? "Domaine non résolu" : "Unresolved domain");
  const destination = after ? boundaryDomainLabel(after, locale) : (fr ? "Domaine non résolu" : "Unresolved domain");
  const sameDomain = !!before?.member?.producerDomain && before.member.producerDomain === after?.member?.producerDomain;
  const domainsDeclared = !!before?.member?.producerDomain && !!after?.member?.producerDomain;
  const content = <>
    {!embedded && <header><div><p className="journey-kicker">{fr ? "Frontière sélectionnée" : "Selected boundary"}</p><h3 ref={titleRef} tabIndex={-1}>{fr ? "Passage entre domaines" : "Domain crossing"}</h3></div><button type="button" onClick={onClose}>{fr ? "← Retour" : "← Back"}</button></header>}
    <BoundaryDomainTransition source={source} destination={destination} change={!domainsDeclared ? "unknown" : sameDomain ? "same" : "different"} locale={locale} />
    <p className="boundary-human-change">{!domainsDeclared ? (fr ? "Les domaines des deux faits ne sont pas tous déclarés ; aucun changement de domaine n’est déduit." : "Both facts do not have declared domains; no domain change is inferred.") : sameDomain ? edge.crossings.some((crossing) => crossing.kind !== "producer") ? (fr ? "Le domaine reste le même ; le lien porte un changement de contexte déclaré." : "The domain stays the same; the link carries a declared context change.") : (fr ? "Deux faits reliés sont déclarés dans le même domaine." : "Two connected facts are declared in the same domain.") : (fr ? "Deux faits reliés sont déclarés dans des domaines différents." : "Two connected facts are declared in different domains.")}</p>
    <BoundaryCrossingReading graph={graph} edge={edge} text={text} locale={locale} onSelectNode={onSelectNode} />
    <BoundaryDepth graph={graph} edges={[edge]} locale={locale} panelKey={edge.key} relationExplanation={relationExplanation} onSelectNode={onSelectNode} onOpenEvidence={onOpenEvidence} onOpenForensic={onOpenForensic} uiState={uiState} onUIStateChange={onUIStateChange} />
  </>;
  return embedded ? <section className="guided-boundary-summary" aria-label={fr ? "Changement de domaine sélectionné" : "Selected domain change"}>{content}</section>
    : <aside id="guided-evidence-inspector" className="guided-boundary-inspector" aria-label={fr ? "Changement de domaine sélectionné" : "Selected domain change"}>{content}</aside>;
}

export function GuidedBoundaryGroupInspector({ graph, boundary, text, locale, onSelectEdge, onSelectNode, onOpenEvidence, onClose, embedded = false, relationExplanation, onOpenForensic, uiState, onUIStateChange }: {
  graph: ReceivedGraph; boundary: InspectionBoundary; text?: string; locale: "en" | "fr";
  onSelectEdge: (edgeKey: string) => void; onSelectNode?: (key: string) => void;
  onOpenEvidence?: (key: string | null) => void; onClose: () => void;
} & BoundaryDepthProps) {
  const fr = locale === "fr";
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (!embedded) titleRef.current?.focus({ preventScroll: true }); }, [boundary.key, embedded]);
  const edges = graph.edges.filter((edge) => boundary.edgeKeys.includes(edge.key));
  const domainLabels = (side: "from" | "to") => [...new Set(edges.flatMap((edge) => {
    const node = graph.nodes.find((candidate) => candidate.key === edge[side]);
    return node ? [boundaryDomainLabel(node, locale)] : [];
  }))].join(" · ") || (fr ? "Domaine non résolu" : "Unresolved domain");
  const source = boundary.kind === "producer" ? boundaryProducerLabel(boundary.from, locale) : domainLabels("from");
  const destination = boundary.kind === "producer" ? boundaryProducerLabel(boundary.to, locale) : domainLabels("to");
  const contextKind = boundary.kind === "producer" ? (fr ? "Passages entre domaines" : "Domain crossings")
    : boundary.kind === "authority" ? (fr ? "Changement d’autorité déclaré" : "Declared authority change")
      : boundary.kind === "execution" ? (fr ? "Changement de lieu d’exécution déclaré" : "Declared execution location change")
        : (fr ? "Changement de contexte de confiance déclaré" : "Declared trust context change");
  const fromDomains = new Set(edges.map((edge) => graph.nodes.find((node) => node.key === edge.from)?.member?.producerDomain));
  const toDomains = new Set(edges.map((edge) => graph.nodes.find((node) => node.key === edge.to)?.member?.producerDomain));
  const sameDomain = edges.length > 0 && edges.every((edge) => {
    const before = graph.nodes.find((node) => node.key === edge.from)?.member?.producerDomain;
    const after = graph.nodes.find((node) => node.key === edge.to)?.member?.producerDomain;
    return !!before && before === after;
  });
  const domainsDeclared = edges.length > 0 && edges.every((edge) => !!graph.nodes.find((node) => node.key === edge.from)?.member?.producerDomain && !!graph.nodes.find((node) => node.key === edge.to)?.member?.producerDomain);
  const content = <>
    {!embedded && <header><div><h3 ref={titleRef} tabIndex={-1}>{contextKind}</h3></div><button type="button" onClick={onClose}>{fr ? "← Retour" : "← Back"}</button></header>}
    <BoundaryDomainTransition source={source} destination={destination} change={!domainsDeclared ? "unknown" : sameDomain ? "same" : "different"} locale={locale} />
    <p className="boundary-human-change">{boundary.kind === "producer" ? (fr ? "Les paires de faits ci-dessous portent ce passage entre domaines." : "The fact pairs below carry this domain crossing.") : contextKind + "."}</p>
    <p className="boundary-pair-count">{fr ? `${edges.length} liens reçus · chaque Avant et Après reste visible.` : `${edges.length} received links · every Before and After remains visible.`}</p>
    {edges.length > 0 ? <div className="boundary-crossing-list">{edges.map((edge) => <section key={edge.key}>
      <BoundaryCrossingReading graph={graph} edge={edge} text={text} locale={locale} onSelectNode={onSelectNode} showDomains={fromDomains.size > 1 || toDomains.size > 1} />
      <button type="button" className="boundary-crossing-detail" onClick={() => onSelectEdge(edge.key)}>{fr ? "Ouvrir ce passage" : "Open this crossing"} →</button>
    </section>)}</div> : <p role="status">{fr ? "Aucun lien reçu n’est résolu pour ce passage." : "No received link resolves for this crossing."}</p>}
    <BoundaryDepth graph={graph} edges={edges} locale={locale} panelKey={boundary.key} relationExplanation={relationExplanation} onSelectNode={onSelectNode} onOpenEvidence={onOpenEvidence} onOpenForensic={onOpenForensic} uiState={uiState} onUIStateChange={onUIStateChange} />
  </>;
  return embedded ? <section className="guided-boundary-summary" aria-label={fr ? "Groupe de frontières sélectionné" : "Selected boundary group"}>{content}</section>
    : <aside id="guided-evidence-inspector" className="guided-boundary-inspector" aria-label={fr ? "Groupe de frontières sélectionné" : "Selected boundary group"}>{content}</aside>;
}

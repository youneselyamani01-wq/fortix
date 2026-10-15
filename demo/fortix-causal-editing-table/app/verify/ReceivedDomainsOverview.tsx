"use client";

import { useState, type SyntheticEvent } from "react";
import type { ReceivedGraph, ReceivedGraphNode } from "./receivedGraph.ts";
import { groupInspectionBoundaries } from "./inspectionPresentation.ts";
import { receivedEventLabel, receivedProducerLabel } from "./receivedLabels.ts";
import { receivedReceiptLabel } from "./receivedReceiptLabels.ts";
import { receivedTimelineNodes } from "./guidedInspection.ts";
import { receivedFactProvenance, factProvenanceLabel } from "./receivedProvenance.ts";
import { verifierExpandedPanels, type VerifierPresentationProps } from "./verifierPresentation.ts";

export function ReceivedDomainsOverview({ graph, locale, selectedKey, selectedDomainId, onReceipt, onCrossing, onDomain, text, uiState, onUIStateChange }: {
  graph: ReceivedGraph; locale: "en" | "fr"; selectedKey?: string | null; selectedDomainId?: string | null;
  onReceipt: (key: string) => void; onCrossing: (edgeKey: string) => void; onDomain?: (domainId: string) => void;
  text?: string;
} & VerifierPresentationProps) {
  const fr = locale === "fr";
  const c = fr ? {
    kicker: "Domaines traversés", title: "Où les faits ont été produits", intro: "Chaque zone vient du domaine producteur d’un fait de l’histoire. Les dossiers et preuves de support sont disponibles en Forensic. Les passages ci-dessous relient des faits de l’histoire par des relations reçues.",
    domains: "domaines producteurs dans l’histoire", supportDomains: "domaines réservés aux preuves", changes: "passages domaine A → B distincts", view: "Voir les faits produits dans ce domaine", all: "Voir les passages entre domaines de l’histoire", evidence: "faits produits dans ce domaine", missing: "Non déclaré", fact: "Fait associé", final: "Reçu final", openDomain: "Ouvrir le domaine", relations: "liens reçus portent ces passages",
  } : {
    kicker: "Domains crossed", title: "Where the facts were produced", intro: "Every zone comes from the producer domain of a story event. Dossiers and supporting evidence remain available in Forensic. The crossings below connect story events through received relations.",
    domains: "producer domains in the story", supportDomains: "domains reserved for evidence", changes: "distinct domain A → B crossings", view: "View facts produced in this domain", all: "View crossings between story domains", evidence: "facts produced in this domain", missing: "Not declared", fact: "Associated fact", final: "Final Receipt", openDomain: "Open domain", relations: "received links carry these crossings",
  };
  const nodes = new Map(graph.nodes.map((node) => [node.key, node]));
  const timelineNodes = receivedTimelineNodes(graph);
  const timelineDomains = new Set(timelineNodes.flatMap((node) => node.member?.producerDomain ? [node.member.producerDomain] : []));
  const supportDomainCount = new Set(graph.nodes.flatMap((node) => node.member?.producerDomain ? [node.member.producerDomain] : []).filter((domain) => !timelineDomains.has(domain))).size;
  const missingDomainCount = timelineNodes.filter((node) => !node.member?.producerDomain).length;
  const label = (node: ReceivedGraphNode) => node.final ? c.final : receivedEventLabel(node.member?.eventId, locale) ?? node.context.label?.value ?? (fr ? "Événement déclaré" : "Declared event");
  const producer = (value: string) => receivedProducerLabel(value, locale);
  const domains = [...timelineDomains].map((domain) => ({
    domain,
    nodes: timelineNodes.filter((node) => node.member?.producerDomain === domain),
  })).sort((left, right) => Math.min(...left.nodes.map((node) => node.depth ?? Number.MAX_SAFE_INTEGER)) - Math.min(...right.nodes.map((node) => node.depth ?? Number.MAX_SAFE_INTEGER)) || left.domain.localeCompare(right.domain));
  const storyNodeKeys = new Set(timelineNodes.map((node) => node.key));
  const boundaries = groupInspectionBoundaries(graph).filter((boundary) => boundary.kind === "producer")
    .map((boundary) => ({ ...boundary, edgeKeys: boundary.edgeKeys.filter((key) => {
      const edge = graph.edges.find((candidate) => candidate.key === key);
      return !!edge && storyNodeKeys.has(edge.from) && storyNodeKeys.has(edge.to);
    }) }))
    .filter((boundary) => boundary.edgeKeys.length > 0);
  const boundaryLinkCount = boundaries.reduce((sum, boundary) => sum + boundary.edgeKeys.length, 0);
  const [localPanels, setLocalPanels] = useState<readonly string[]>(() => selectedDomainId ? [`domains:facts:${selectedDomainId}`] : []);
  const panels = uiState?.expandedPanels ?? localPanels;
  const setPanel = (key: string, open: boolean) => {
    if (panels.includes(key) === open) return;
    const expandedPanels = verifierExpandedPanels(panels, key, open);
    if (onUIStateChange) onUIStateChange({ expandedPanels }); else setLocalPanels(expandedPanels);
  };
  const panelProps = (key: string) => ({ open: panels.includes(key), "data-panel-key": key, onToggle: (event: SyntheticEvent<HTMLDetailsElement>) => setPanel(key, event.currentTarget.open) });
  return <section className="received-domains-overview" aria-label={c.kicker}>
    <header><div><p className="journey-kicker">{c.kicker}</p><h2>{c.title}</h2><p>{c.intro}</p></div><dl><div><dt>{c.domains}</dt><dd>{domains.length} {fr ? "domaines" : "domains"}</dd></div><div><dt>{c.supportDomains}</dt><dd>{supportDomainCount} {fr ? "domaines hors histoire" : "domains outside the story"}</dd></div><div><dt>{c.changes}</dt><dd>{boundaries.length} {fr ? "paires de domaines" : "domain pairs"}</dd></div></dl></header>
    <p>{fr ? "Une paire de domaines peut porter plusieurs liens reçus : ces deux compteurs mesurent des concepts différents. Les faits sans domaine déclaré ne créent pas de domaine fictif." : "One domain pair may carry several received links: these counters measure different concepts. Facts with no declared domain do not create an invented domain."}</p>
    {domains.length === 0 && <p role="status">{fr ? "Aucun domaine producteur n’est déclaré pour les faits de cette histoire. Les objets de preuve restent disponibles en Forensic." : "No producer domain is declared for this story’s facts. Evidence objects remain available in Forensic."}</p>}
    {missingDomainCount > 0 && <p role="status">{fr ? `${missingDomainCount} faits de l’histoire ne déclarent pas de domaine producteur.` : `${missingDomainCount} story facts have no declared producer domain.`}</p>}
    {selectedDomainId && !domains.some((entry) => entry.domain === selectedDomainId) && <p role="status">{fr ? "Le domaine demandé ne contient aucun fait dans cette histoire. Ses éventuels objets de preuve sont disponibles en Forensic." : "The requested domain has no fact in this story. Any associated evidence objects remain available in Forensic."}</p>}
    <div className="domain-card-grid">{domains.map((entry, index) => <article key={entry.domain} className="domain-card" data-domain-index={index % 4} data-selected={selectedDomainId === entry.domain}>
      <p className="domain-card-kind">{fr ? "Domaine producteur" : "Producer domain"}</p><h3>{producer(entry.domain)}</h3><p>{entry.nodes.length} {c.evidence}</p>
      {onDomain && <button type="button" className="domain-card-open" aria-current={selectedDomainId === entry.domain ? "location" : undefined} onClick={() => { setPanel(`domains:facts:${entry.domain}`, true); onDomain(entry.domain); }}>{c.openDomain} {producer(entry.domain)}</button>}
      <details {...panelProps(`domains:facts:${entry.domain}`)}><summary>{c.view} · {entry.nodes.length} {entry.nodes.length === 1 ? (fr ? "fait" : "fact") : (fr ? "faits" : "facts")}</summary><ul>{entry.nodes.map((node) => <li key={node.key}><button type="button" aria-controls="guided-evidence-inspector" aria-pressed={selectedKey === node.key} onClick={() => onReceipt(node.key)}><span>{label(node)}</span><small>{receivedReceiptLabel(graph, node, locale).title} · {factProvenanceLabel(receivedFactProvenance(node, text), locale)}</small><small>{fr ? "Voir cet événement et ses preuves" : "View this event and its evidence"}</small></button></li>)}</ul></details>
    </article>)}</div>
    <details className="domain-crossing-list" {...panelProps("domains:crossings")}><summary>{c.all} · {boundaries.length} {fr ? "paires de domaines distinctes" : "distinct domain pairs"} · {boundaryLinkCount} {c.relations}</summary>{boundaries.length === 0 && <p>{fr ? "Aucun lien reçu ne déclare de passage entre deux domaines de cette histoire." : "No received link declares a crossing between two domains in this story."}</p>}<ol>{boundaries.map((boundary) => boundary.edgeKeys.map((edgeKey) => {
      const edge = graph.edges.find((candidate) => candidate.key === edgeKey)!;
      const target = nodes.get(edge.to)!;
      return <li key={`${boundary.key}:${edgeKey}`}><button type="button" aria-controls="guided-evidence-inspector" onClick={() => onCrossing(edgeKey)}><span><b>{producer(boundary.from)}</b><i aria-hidden="true">→</i><b>{producer(boundary.to)}</b></span><small>{fr ? "Ouvrir ce passage et ses preuves" : "Open this crossing and its evidence"} · {c.fact} · {label(target)}</small></button></li>;
    }))}</ol></details>
  </section>;
}

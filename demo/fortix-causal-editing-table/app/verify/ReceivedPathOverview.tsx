"use client";

import type { ReceivedGraph, ReceivedGraphEdge, ReceivedGraphNode } from "./receivedGraph.ts";
import { receivedEventLabel, receivedProducerLabel } from "./receivedLabels.ts";
import { receivedReceiptCounts, receivedReceiptLabel } from "./receivedReceiptLabels.ts";
import { declaredMissionTime, receivedTimelineNodes } from "./guidedInspection.ts";
import "./evidence-journey.css";
import "./receipt-labels.css";

type JourneyPhaseKey = "passenger" | "garage" | "maintenance" | "payment" | "network" | "return";
const phaseCopy = {
  en: {
    passenger: ["Passenger mission", "Request, departure, traffic, pickup, journey and drop-off"],
    garage: ["Route to the partner garage", "Maintenance request, route changes and arrival"],
    maintenance: ["Maintenance", "Diagnosis, authorization and completed work"],
    payment: ["Authorization and payment", "Invoice, human authority and payment evidence"],
    network: ["Network continuity", "Loss and restoration events recorded during the mission"],
    return: ["Return and Final Receipt", "Return to base and mission closure"],
  },
  fr: {
    passenger: ["Mission passager", "Demande, départ, circulation, prise en charge, trajet et dépose"],
    garage: ["Vers le garage partenaire", "Demande de maintenance, changements d’itinéraire et arrivée"],
    maintenance: ["Maintenance", "Diagnostic, autorisation et travaux terminés"],
    payment: ["Autorisation et paiement", "Facture, autorité humaine et preuves de paiement"],
    network: ["Continuité réseau", "Événements de perte et de restauration enregistrés pendant la mission"],
    return: ["Retour et reçu final", "Retour à la base et clôture de la mission"],
  },
} as const;

export function receivedJourneyPhase(node: ReceivedGraphNode): JourneyPhaseKey {
  const event = node.member?.eventId ?? "";
  if (node.final || /master-return|receipt\.master-return|final-mission-receipt/.test(event)) return "return";
  if (/network-link-(?:lost|restored)/.test(event) || node.member?.producerDomain === "NETWORK") return "network";
  if (/invoice|payment|human-approv|bank-|manager-notified|receipt\.master-payment/.test(event)) return "payment";
  if (/diagnostic|maintenance-proposal|maintenance-authorized|maintenance-executed|maintenance-completed/.test(event)) return "maintenance";
  if (/maintenance-intent|garage-route|congestion|eta-deteriorates|reroute|route-b|garage-arrival|garage-received/.test(event)) return "garage";
  return "passenger";
}

/** Human mission order from received PRESENTED members only. timeMs and member index are display fields, never invented relations. */
export function receivedMissionSequence(graph: ReceivedGraph): readonly ReceivedGraphNode[] {
  return receivedTimelineNodes(graph);
}

export function receivedJourneyPhases(graph: ReceivedGraph, sequence = receivedMissionSequence(graph)) {
  const phases: { id: string; key: JourneyPhaseKey; entries: { key: string; index: number; node: ReceivedGraphNode }[] }[] = [];
  sequence.forEach((node, index) => {
    const key = receivedJourneyPhase(node);
    const current = phases.at(-1);
    if (current?.key === key) current.entries.push({ key: node.key, index, node });
    else phases.push({ id: `${key}:${index}`, key, entries: [{ key: node.key, index, node }] });
  });
  return phases;
}

function directEdge(graph: ReceivedGraph, sequence: readonly ReceivedGraphNode[], index: number): ReceivedGraphEdge | undefined {
  if (index === 0) return undefined;
  return graph.edges.find((edge) => edge.from === sequence[index - 1].key && edge.to === sequence[index].key);
}

export function ReceivedPathOverview({ graph, path, locale, onReceipt, onCrossing, onDomain, selectedKey, emphasis }: {
  selectedKey?: string; emphasis?: { strong: Set<string>; context: Set<string>; strongEdges?: Set<string>; pathEdges?: Set<string> };
  graph: ReceivedGraph; path: readonly string[]; locale: "en" | "fr"; onReceipt: (key: string) => void; onCrossing: (key: string) => void; onDomain?: (domainId: string) => void;
}) {
  const fr = locale === "fr";
  const c = fr ? {
    title: "Ce qui s’est passé pendant cette mission",
    intro: "Les faits présentés conservent l’ordre global du temps déclaré dans le PEB. La position reçue stabilise seulement les égalités ; une flèche n’apparaît que lorsqu’une relation directe est déclarée.",
    steps: "éléments de Timeline", events: "événements", links: "paires consécutives aussi reliées", domains: "domaines producteurs de la Timeline", viewDomains: "Voir les domaines producteurs de la Timeline", openDomain: "Ouvrir le domaine", segment: "Segment", domainChange: "Changement de domaine", evidence: "élément de Timeline dans ce segment", evidencePlural: "éléments de Timeline dans ce segment", final: "Reçu final", missing: "Non déclaré", quarantined: "Déclaration en quarantaine", causal: "Relation causale déclarée", observed: "Entrée observée déclarée", timeOrder: "Fait suivant dans la timeline · aucune relation directe déclarée", inspect: "Inspecter l’événement", timelinePosition: "Position Timeline", declaredTime: "Temps de mission déclaré", producerDomain: "Domaine producteur", note: "Les supports d’assurance, toutes les branches et toutes les déclarations restent accessibles dans le graphe causal et les vues forensic. Cette lecture n’ajoute aucun fait ni aucune relation.",
  } : {
    title: "What happened during this mission",
    intro: "Presented facts retain the PEB’s global declared-time order. Received position only stabilizes ties; an arrow appears only when a direct relation is declared.",
    steps: "Timeline items", events: "events", links: "consecutive pairs also linked", domains: "Timeline producer domains", viewDomains: "View Timeline producer domains", openDomain: "Open domain", segment: "Segment", domainChange: "Domain change", evidence: "Timeline item in this segment", evidencePlural: "Timeline items in this segment", final: "Final Receipt", missing: "Not declared", quarantined: "Quarantined declaration", causal: "Declared causal relation", observed: "Declared observed input", timeOrder: "Next fact in the timeline · no direct relation declared", inspect: "Inspect event", timelinePosition: "Timeline position", declaredTime: "Declared mission time", producerDomain: "Producer domain", note: "Assurance support, every branch and every declaration remain available in the causal graph and forensic views. This reading adds no fact or relation.",
  };
  const sequence = receivedMissionSequence(graph);
  const phases = receivedJourneyPhases(graph, sequence);
  const sequenceKeys = sequence.map((node) => node.key);
  const directEdges = sequence.slice(1).flatMap((_, index) => {
    const edge = directEdge(graph, sequence, index + 1);
    return edge ? [edge] : [];
  });
  const domains = [...new Set(sequence.map((node) => node.member?.producerDomain).filter((domain): domain is string => !!domain))];
  const label = (node: ReceivedGraphNode) => node.final ? c.final : receivedEventLabel(node.member?.eventId, locale) ?? node.context.label?.value ?? (fr ? "Événement déclaré" : "Declared event");
  const producer = (value: string) => receivedProducerLabel(value, locale);
  const counts = receivedReceiptCounts(graph, sequenceKeys);
  const eventCount = sequence.filter((node) => !node.final).length;
  const finalCount = sequence.filter((node) => node.final).length;
  return <section className="received-path-overview" aria-label={c.title} data-causal-path-length={path.length}>
    <header className="journey-heading">
      <div><p className="journey-kicker">{fr ? "Chemin de preuve" : "Evidence Path"}</p><h3>{c.title}</h3><p>{c.intro}</p></div>
      <dl><div><dt>{c.steps}</dt><dd>{sequence.length}<small>{eventCount} {c.events} + {finalCount} {c.final}</small></dd></div><div><dt>{c.links}</dt><dd>{directEdges.length}</dd></div><div><dt>{c.domains}</dt><dd>{domains.length}</dd></div></dl>
    </header>
    <details className="journey-domains"><summary>{c.viewDomains} · {domains.length} {fr ? "domaines" : "domains"}</summary><div>{domains.map((domain) => onDomain
      ? <button type="button" key={domain} onClick={() => onDomain(domain)}><small>{c.openDomain}</small><strong>{producer(domain)}</strong></button>
      : <span key={domain}>{producer(domain)}</span>)}</div></details>
    <div className="journey-phases">
      {phases.map((phase, phaseIndex) => <section className="journey-phase" key={phase.id} data-phase={phase.key}>
        <header><span>{c.segment} {phaseIndex + 1} {fr ? "sur" : "of"} {phases.length}</span><div><h4>{phaseCopy[locale][phase.key][0]}</h4><p>{phaseCopy[locale][phase.key][1]}</p></div><strong>{phase.entries.length} {phase.entries.length === 1 ? c.evidence : c.evidencePlural}</strong></header>
        <ol>{phase.entries.map(({ key, index, node }) => {
          const edge = directEdge(graph, sequence, index);
          const crossing = edge?.crossings.find((candidate) => candidate.kind === "producer");
          const receipt = receivedReceiptLabel(graph, node, locale);
          const tone = emphasis ? emphasis.strong.has(key) ? "strong" : emphasis.context.has(key) ? "context" : "dim" : undefined;
          return <li key={key}>
            {index > 0 && (edge ? <div className="journey-link" data-tone={(emphasis?.strongEdges ?? emphasis?.pathEdges)?.has(edge.key) ? "strong" : tone}><span aria-hidden="true">↓</span><small>{edge.causal ? c.causal : c.observed}</small>{crossing && <button type="button" aria-controls="guided-evidence-inspector" onClick={() => onCrossing(edge.key)}><b>{c.domainChange}</b>{producer(crossing.from.value)} → {producer(crossing.to.value)}</button>}</div> : <div className="journey-time-order"><small>{c.timeOrder}</small></div>)}
            <button type="button" className="journey-event" data-tone={tone} data-received-node-key={key} data-receipt-kind={receipt.kind} aria-controls="guided-evidence-inspector" aria-pressed={selectedKey === key} onClick={() => onReceipt(key)}>
              <span className="journey-order">{c.timelinePosition} {index + 1} {fr ? "sur" : "of"} {sequence.length}</span><span className="journey-event-copy"><small>{c.declaredTime} : {declaredMissionTime(node.member?.timeMs ?? null, locale)} · {c.producerDomain} : {producer(node.member?.producerDomain ?? c.missing)}</small><strong>{label(node)}</strong><span>{receipt.title}</span>{node.member?.assurance === "QUARANTINED" && <em>{c.quarantined}</em>}</span><span className="journey-open">{c.inspect}</span>
            </button>
          </li>;
        })}</ol>
      </section>)}
    </div>
    <p className="journey-note">{counts.nano} NanoReceipts · {counts.support} support · {counts.final} {fr ? "reçu final" : "Final Receipt"}. {c.note}</p>
  </section>;
}

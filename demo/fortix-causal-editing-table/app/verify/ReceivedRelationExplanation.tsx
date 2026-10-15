"use client";

import { FactProvenanceBadge } from "./FactProvenanceBadge.tsx";
import { receivedFactProvenance } from "./receivedProvenance.ts";
import type { ReceivedGraph, ReceivedGraphEdge, ReceivedGraphNode } from "./receivedGraph.ts";
import { receivedEventLabel, receivedProducerLabel } from "./receivedLabels.ts";
import { guidedStoryHumanCaption } from "./guidedStory.ts";

function factLabel(node: ReceivedGraphNode, locale: "en" | "fr") {
  const fallback = locale === "fr" ? "Un événement est déclaré" : "An event is declared";
  return node.final ? (locale === "fr" ? "Reçu final" : "Final Receipt") : receivedEventLabel(node.member?.eventId, locale) ?? guidedStoryHumanCaption(node.context.label?.value, fallback);
}

/** Every explanation corresponds to one existing typed declaration. A grouped
 * edge never erases a secondary declaration or adds a physical business cause. */
export function ReceivedRelationExplanation({ graph, edge, text, locale, onSelectNode, onOpenForensic }: {
  graph: ReceivedGraph;
  edge: ReceivedGraphEdge;
  text?: string;
  locale: "en" | "fr";
  onSelectNode?: (key: string) => void;
  onOpenForensic?: (key: string | null) => void;
}) {
  const fr = locale === "fr";
  const from = graph.nodes.find((node) => node.key === edge.from);
  const to = graph.nodes.find((node) => node.key === edge.to);
  if (!from || !to) return <section className="inspection-relation-explanation" data-relation-status="UNRESOLVED"><h4>{fr ? "Pourquoi ce lien ?" : "Why this link?"}</h4><p role="status">{fr ? "Les deux extrémités de cette relation ne sont pas résolues. Aucune cause n’est déduite." : "Both endpoints of this relation are unresolved. No cause is inferred."}</p></section>;
  const endpoint = (node: ReceivedGraphNode, title: string) => <div>
    <small>{title}</small>
    {onSelectNode ? <button type="button" onClick={() => onSelectNode(node.key)}>{factLabel(node, locale)}</button> : <strong>{factLabel(node, locale)}</strong>}
    <p>{node.member?.producerDomain ? receivedProducerLabel(node.member.producerDomain, locale) : (fr ? "Domaine non déclaré" : "Domain not declared")}</p>
    <FactProvenanceBadge provenance={receivedFactProvenance(node, text)} locale={locale} compact />
  </div>;
  return <section className="inspection-relation-explanation" data-relation-status="RESOLVED" data-explained-declaration-count={edge.declarations.length}>
    <h4>{fr ? "Pourquoi ce lien ?" : "Why this link?"}</h4>
    <div className="inspection-relation-endpoints">{endpoint(from, fr ? "Source du lien" : "Link source")}{endpoint(to, fr ? "Destination du lien" : "Link destination")}</div>
    <p>{fr ? "Cette flèche représente les déclarations reçues ci-dessous, dans le sens source → destination." : "This arrow represents the received declarations below, in the source → destination direction."}</p>
    {edge.declarations.length ? <ol>{edge.declarations.map((declaration, index) => {
      const kind = declaration.kind;
      const explanation = kind === "CAUSAL_PARENT"
        ? (fr ? `« ${factLabel(to, locale)} » référence « ${factLabel(from, locale)} » comme parent causal.` : `“${factLabel(to, locale)}” references “${factLabel(from, locale)}” as a causal parent.`)
        : kind === "OBSERVED_INPUT"
          ? (fr ? `« ${factLabel(to, locale)} » référence « ${factLabel(from, locale)} » comme entrée observée. Cette déclaration n’établit pas une observation physique ni une cause.` : `“${factLabel(to, locale)}” references “${factLabel(from, locale)}” as an observed input. This declaration establishes neither a physical observation nor a cause.`)
          : (fr ? `Le Reçu final référence « ${factLabel(from, locale)} » comme entrée de clôture.` : `The Final Receipt references “${factLabel(from, locale)}” as a closure input.`);
      const kindLabel = kind === "CAUSAL_PARENT" ? (fr ? "Parent causal déclaré" : "Declared causal parent") : kind === "OBSERVED_INPUT" ? (fr ? "Entrée observée déclarée" : "Declared observed input") : (fr ? "Entrée du Reçu final déclarée" : "Declared Final Receipt input");
      return <li key={`${declaration.path}-${index}`} data-declaration-kind={kind} data-declaration-path={declaration.path}><strong>{kindLabel}</strong><p>{explanation}</p></li>;
    })}</ol> : <p role="status">{fr ? "Aucune déclaration source ne porte ce lien." : "No source declaration carries this link."}</p>}
    <p>{fr ? "La relation déclare une dépendance dans le PEB. Elle ne prouve pas, à elle seule, pourquoi un effet physique ou métier s’est produit." : "The relation declares a dependency in the PEB. It does not, by itself, prove why a physical or business effect occurred."}</p>
    {onOpenForensic && <button type="button" onClick={() => onOpenForensic(to.key)}>{fr ? "Inspecter la source dans Forensic →" : "Inspect the source in Forensic →"}</button>}
  </section>;
}

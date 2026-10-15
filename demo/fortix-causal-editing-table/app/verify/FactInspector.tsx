"use client";

import type { MouseEvent, ReactNode, Ref } from "react";
import { FactProvenanceBadge } from "./FactProvenanceBadge.tsx";
import { NetworkFactSummary, networkRuntimeProvenanceNote, reconciliationText } from "./ReceivedNetworkView.tsx";
import { factLocalLimits, factNetworkPosition } from "./factInspection.ts";
import { declaredMissionTime } from "./guidedInspection.ts";
import { guidedStoryEventLabel } from "./guidedStory.ts";
import type { ReceivedNetworkModel } from "./receivedNetwork.ts";
import { catalogEntryByNodeKey, type ReceivedEvidenceCatalog, type ReceivedEvidenceCatalogEntry } from "./receivedEvidenceCatalog.ts";
import type { VerifierView } from "./verifierRoutes.ts";
import "./fact-inspector.css";

export type FactInspectorContext = "event" | "path" | "timeline" | "domains" | "graph" | "network";
type EntryLinks = Partial<Record<VerifierView, string>>;

/** Everything a business view needs to inspect any fact the same way. */
export type FactInspectorSupport = Readonly<{
  catalog: ReceivedEvidenceCatalog;
  network?: ReceivedNetworkModel | null;
  linksForEntry?: (entry: ReceivedEvidenceCatalogEntry) => EntryLinks;
  onSelectEntry?: (entry: ReceivedEvidenceCatalogEntry) => void;
}>;

export type FactInspectorProps = FactInspectorSupport & Readonly<{
  entry: ReceivedEvidenceCatalogEntry;
  locale: "en" | "fr";
  text?: string;
  /** The view hosting the inspector: it never offers itself as a destination. */
  context: FactInspectorContext;
  as?: "aside" | "section" | "div";
  id?: string;
  className?: string;
  heading?: "h1" | "h2" | "h3";
  titleId?: string;
  titleRef?: Ref<HTMLHeadingElement>;
  kicker?: string;
  onClose?: () => void;
  /** In-place selection of a neighbour (Timeline, Domains, Graph). */
  onSelectNode?: (nodeKey: string) => void;
  /** Otherwise neighbours open in this view through canonical links; plain text when absent. */
  neighbourView?: VerifierView;
  showNeighbours?: boolean;
  showRelations?: boolean;
  fullNetwork?: boolean;
  /** Fallbacks when no canonical link exists (the inspector outside the route shell). */
  onOpenEvidence?: () => void;
  onOpenGraph?: () => void;
  headerExtra?: ReactNode;
  children?: ReactNode;
}>;

const plainClick = (event: MouseEvent) => event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;

/**
 * One fact, read the same way from every business view: what happened, its
 * provenance, its position, the evidence behind it, then deeper levels on demand.
 * It reads the catalog only; it creates no relation and no conclusion.
 */
export function FactInspector({
  entry, catalog, network, linksForEntry, onSelectEntry, locale, text, context, as = "aside", id, className, heading = "h3",
  titleId, titleRef, kicker, onClose, onSelectNode, neighbourView, showNeighbours = true, showRelations = true, fullNetwork = false,
  onOpenEvidence, onOpenGraph, headerExtra, children,
}: FactInspectorProps) {
  const fr = locale === "fr";
  const Root = as;
  const Heading = heading;
  const links = linksForEntry?.(entry) ?? {};
  const position = factNetworkPosition(network, entry.nodeKey, entry.node.member?.timeMs ?? null);
  const index = entry.timelinePosition === null ? -1 : entry.timelinePosition - 1;
  const previous = index > 0 ? catalog.timelineEntries[index - 1] ?? null : null;
  const next = index >= 0 ? catalog.timelineEntries[index + 1] ?? null : null;
  const resolve = (keys: readonly string[]) => keys.map((key) => catalogEntryByNodeKey(catalog, key)).filter((value): value is ReceivedEvidenceCatalogEntry => value !== null);
  const parents = resolve(entry.causalParentNodeKeys);
  const consequences = resolve(entry.causalChildNodeKeys);
  const limits = factLocalLimits(entry, text, locale);
  const select = (target: ReceivedEvidenceCatalogEntry) => (event: MouseEvent) => { if (plainClick(event)) onSelectEntry?.(target); };
  const factControl = (target: ReceivedEvidenceCatalogEntry) => {
    const label = guidedStoryEventLabel(target, locale);
    if (onSelectNode) return <button type="button" className="fact-inspector-link" onClick={() => onSelectNode(target.nodeKey)}>{label}</button>;
    const href = neighbourView ? linksForEntry?.(target)[neighbourView] : undefined;
    return href ? <a className="fact-inspector-link" href={href} onClick={select(target)}>{label}</a> : <span>{label}</span>;
  };
  const factList = (targets: readonly ReceivedEvidenceCatalogEntry[], empty: string) => targets.length
    ? <ul>{targets.map((target) => <li key={target.nodeKey}>{factControl(target)}</li>)}</ul>
    : <span className="fact-inspector-none">{empty}</span>;
  const inPeriod = position.kind === "TRANSITION" || position.kind === "DURING" || position.kind === "RECONCILIATION";
  const transitionKey = position.kind === "TRANSITION" ? entry.nodeKey : null;
  const action = (href: string | undefined, label: string, fallback?: () => void, primary = false) => href
    ? <a className={primary ? "fact-inspector-primary" : undefined} href={href} onClick={select(entry)}>{label}</a>
    : fallback ? <button type="button" className={primary ? "fact-inspector-primary" : undefined} onClick={fallback}>{label}</button> : null;
  const inStory = entry.timelinePosition !== null;
  return <Root id={id} className={["fact-inspector", className].filter(Boolean).join(" ")} data-fact-inspector data-inspector-context={context} data-selected-node-key={entry.nodeKey} aria-label={fr ? "Fait sélectionné" : "Selected fact"}>
    <header className="fact-inspector-head">
      <div>
        <p className="fact-inspector-kicker">{kicker ?? (fr ? "Ce qui s’est passé" : "What happened")}</p>
        <Heading id={titleId} ref={titleRef} tabIndex={-1}>{guidedStoryEventLabel(entry, locale)}</Heading>
      </div>
      {headerExtra}
      {onClose && <button type="button" className="fact-inspector-close" onClick={onClose}>{fr ? "Fermer" : "Close"} <span aria-hidden="true">×</span></button>}
    </header>
    {transitionKey && network && <NetworkFactSummary model={network} nodeKey={transitionKey} locale={locale} compact={!fullNetwork} forensicHref={fullNetwork ? links.forensic : undefined} />}
    <FactProvenanceBadge provenance={entry.provenance} locale={locale} compact description={transitionKey && entry.provenance.category === "RUNTIME" ? networkRuntimeProvenanceNote(locale) : undefined} />
    <dl className="fact-inspector-facts">
      <div><dt>{fr ? "Quand" : "When"}</dt><dd>{declaredMissionTime(entry.node.member?.timeMs ?? null, locale)}{inStory && <small>{fr ? `Étape ${entry.timelinePosition} / ${entry.timelineLength} de la Timeline` : `Step ${entry.timelinePosition} / ${entry.timelineLength} in the Timeline`}</small>}</dd></div>
      <div><dt>{fr ? "Domaine" : "Domain"}</dt><dd>{entry.domainLabel ?? (fr ? "Non déclaré" : "Not declared")}</dd></div>
      {position.kind === "RECONCILIATION" && <div data-network-position="RECONCILIATION"><dt>{fr ? "Réseau" : "Network"}</dt><dd>{fr ? `Reçu de réconciliation de la période hors ligne n°${position.period.index}` : `Reconciliation receipt for offline period ${position.period.index}`}<small>{reconciliationText(position.period.reconciliation, locale).label}</small></dd></div>}
      {position.kind === "DURING" && <div data-network-position="DURING"><dt>{fr ? "Réseau" : "Network"}</dt><dd>{fr ? `Pendant la période hors ligne n°${position.period.index}` : `During offline period ${position.period.index}`}<small>{fr ? "Contexte temporel, pas un lien causal." : "Temporal context, not a causal link."}</small></dd></div>}
      {position.kind === "OUTSIDE" && <div data-network-position="OUTSIDE"><dt>{fr ? "Réseau" : "Network"}</dt><dd>{fr ? (position.connected ? "Connecté" : "Hors période hors ligne déclarée") : "Outside any declared offline period"}</dd></div>}
      {showNeighbours && inStory && <>
        <div><dt>{fr ? "Avant" : "Before"}</dt><dd>{previous ? factControl(previous) : <span className="fact-inspector-none">{fr ? "Début de la Timeline" : "Start of the Timeline"}</span>}</dd></div>
        <div><dt>{fr ? "Après" : "After"}</dt><dd>{next ? factControl(next) : <span className="fact-inspector-none">{fr ? "Fin de la Timeline" : "End of the Timeline"}</span>}</dd></div>
      </>}
      {showRelations && <>
        <div><dt>{fr ? "Causes déclarées" : "Declared causes"}</dt><dd>{factList(parents, fr ? "Aucune déclarée" : "None declared")}</dd></div>
        <div><dt>{fr ? "Conséquences déclarées" : "Declared consequences"}</dt><dd>{factList(consequences, fr ? "Aucune déclarée" : "None declared")}</dd></div>
      </>}
      <div><dt>{fr ? "Preuve" : "Evidence"}</dt><dd>{entry.receipt.title}{entry.receipt.kind === "NANO_RECEIPT" && entry.familyLabel ? ` · ${entry.familyLabel}` : ""}</dd></div>
    </dl>
    {limits.length > 0 && <div className="fact-inspector-limits" data-local-limits>
      <p className="fact-inspector-kicker">{fr ? "Limite pour ce fait" : "Limit for this fact"}</p>
      <ul>{limits.map((limit) => <li key={limit}>{limit}</li>)}</ul>
    </div>}
    <nav className="fact-inspector-actions" aria-label={fr ? "Explorer ce fait" : "Explore this fact"}>
      {/* In Path, "Continue the story" stays the single dominant action. */}
      {action(links.nanoreceipts, fr ? "Inspecter la preuve →" : "Inspect the evidence →", onOpenEvidence, context !== "path")}
      {context !== "graph" && action(links.graph, fr ? "Voir dans le graphe" : "View in the graph", onOpenGraph)}
      {context !== "timeline" && inStory && action(links.timeline, fr ? "Voir dans la Timeline" : "View in the Timeline")}
      {context !== "network" && inPeriod && action(links.network, fr ? "Voir dans la vue Réseau" : "View in the Network view")}
      {context !== "event" && inStory && action(links.event, fr ? "Lire l’événement" : "Read the event")}
      {context !== "event" && inStory && links.event && <a className="fact-inspector-new-tab" href={links.event} target="_blank" rel="noopener noreferrer">{fr ? "Ouvrir l’événement dans un nouvel onglet" : "Open the event in a new tab"} <span aria-hidden="true">↗</span></a>}
    </nav>
    {children}
  </Root>;
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FactInspector } from "./FactInspector.tsx";
import { FactProvenanceBadge } from "./FactProvenanceBadge.tsx";
import { FocusStoryReading } from "./FocusStoryReading.tsx";
import { StoryBackControl } from "./GuidedStoryView.tsx";
import type { ReceivedNetworkModel } from "./receivedNetwork.ts";
import type { D006VerdictSnapshot } from "../offlineVerification.ts";
import type { ReceivedPebProjection } from "./inspectReceivedPeb.ts";
import type { ReceivedGraph } from "./receivedGraph.ts";
import {
  catalogEntryByNodeKey,
  createReceivedEvidenceCatalog,
  resolveReceivedEvidenceSelection,
  type ReceivedEvidenceCatalogEntry,
  type ReceivedEvidenceSelectionInput,
} from "./receivedEvidenceCatalog.ts";
import type { VerifierView } from "./verifierRoutes.ts";

export type EventDetailViewProps = Readonly<{
  graph: ReceivedGraph;
  peb: ReceivedPebProjection;
  text: string;
  locale: "en" | "fr";
  selection: ReceivedEvidenceSelectionInput;
  snapshot?: D006VerdictSnapshot | null;
  links: Partial<Record<VerifierView, string>>;
  linksForEntry?: (entry: ReceivedEvidenceCatalogEntry) => Partial<Record<VerifierView, string>>;
  onSelectEntry?: (entry: ReceivedEvidenceCatalogEntry) => void;
  focusMode?: boolean;
  onFocusModeChange?: (value: boolean) => void;
  onBack?: () => void;
  network?: ReceivedNetworkModel;
}>;

function EntryControl({ entry, href, onSelect, label }: {
  entry: ReceivedEvidenceCatalogEntry;
  href?: string;
  onSelect?: (entry: ReceivedEvidenceCatalogEntry) => void;
  label: string;
}) {
  const content = <><small>{label}</small><strong>{entry.eventLabel}</strong></>;
  if (href) return <a href={href} onClick={(event) => { if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) onSelect?.(entry); }}>{content}</a>;
  if (onSelect) return <button type="button" onClick={() => onSelect(entry)}>{content}</button>;
  return <span>{content}</span>;
}

/** The reference inspection of one fact (level 2): addressable, but not a
 * principal tab. Business views open the same reading through FactInspector. */
export function EventDetailView({ graph, text, locale, selection, links, linksForEntry, onSelectEntry, focusMode: controlledFocus, onFocusModeChange, onBack, network }: EventDetailViewProps) {
  const fr = locale === "fr";
  const [localFocus, setLocalFocus] = useState(false);
  const focusMode = controlledFocus ?? localFocus;
  const changeFocus = () => { if (controlledFocus === undefined) setLocalFocus(!focusMode); onFocusModeChange?.(!focusMode); };
  const catalog = useMemo(() => createReceivedEvidenceCatalog(graph, locale, text), [graph, locale, text]);
  const resolution = useMemo(() => resolveReceivedEvidenceSelection(catalog, selection), [catalog, selection]);
  const entry = resolution.entry;
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { titleRef.current?.focus({ preventScroll: true }); }, [entry?.nodeKey, resolution.status]);

  if (resolution.status !== "RESOLVED" || !entry) return <section className="modular-view modular-event-view" data-resolution={resolution.status}>
    <div className="modular-empty-state" role="status">
      <p className="modular-kicker">{fr ? "Événement sélectionné" : "Selected event"}</p>
      <h1 ref={titleRef} tabIndex={-1}>{resolution.status === "EMPTY" ? (fr ? "Aucun événement sélectionné" : "No event selected") : (fr ? "Ce lien ne résout pas un événement unique" : "This link does not resolve one unique event")}</h1>
      <p>{resolution.status === "EMPTY"
        ? (fr ? "Sélectionnez un événement reçu dans la Timeline." : "Select a received event from the Timeline.")
        : resolution.status === "AMBIGUOUS"
          ? (fr ? "Plusieurs membres reçus portent cet identifiant. Aucune sélection automatique n’est faite." : "Several received members carry this identifier. Nothing is selected automatically.")
          : resolution.status === "CONTRADICTORY"
            ? (fr ? "Les paramètres du lien désignent des membres différents." : "The link parameters identify different members.")
            : (fr ? "Aucun événement reçu ne correspond à ce lien." : "No received event matches this link.")}</p>
      {links.timeline && <a className="modular-primary-link" href={links.timeline}>{fr ? "Revenir à la Timeline" : "Return to the Timeline"}</a>}
    </div>
  </section>;

  if (entry.timelinePosition === null) {
    const evidenceLinks = linksForEntry?.(entry) ?? links;
    return <section className="modular-view modular-event-view" data-resolution="OUTSIDE_STORY">
      <div className="modular-empty-state" role="status">
        <h1 ref={titleRef} tabIndex={-1}>{fr ? "Cette unité de preuve est hors de l’histoire" : "This evidence item is outside the story"}</h1>
        <p>{fr ? "Les dossiers de compilation et les preuves de support restent consultables dans les vues de preuves. Ils ne sont pas des étapes de l’Event Story." : "Compilation dossiers and supporting evidence remain available in evidence views. They are not Event Story steps."}</p>
        <FactProvenanceBadge provenance={entry.provenance} locale={locale} compact />
        <nav className="modular-context-actions" aria-label={fr ? "Consulter la preuve reçue" : "Read received evidence"}>
          {evidenceLinks.nanoreceipts && <a href={evidenceLinks.nanoreceipts}>{fr ? "Voir dans NanoReceipts" : "View in NanoReceipts"}</a>}
          {evidenceLinks.forensic && <a href={evidenceLinks.forensic}>{fr ? "Inspecter en Forensic" : "Inspect in Forensic"}</a>}
          {links.path && <a href={links.path}>{fr ? "Revenir au chemin" : "Return to the path"}</a>}
        </nav>
      </div>
    </section>;
  }

  const timelineIndex = entry.timelinePosition === null ? -1 : entry.timelinePosition - 1;
  const previous = timelineIndex > 0 ? catalog.timelineEntries[timelineIndex - 1] ?? null : null;
  const next = timelineIndex >= 0 ? catalog.timelineEntries[timelineIndex + 1] ?? null : null;
  const parentEntries = entry.causalParentNodeKeys.map((key) => catalogEntryByNodeKey(catalog, key)).filter((value): value is ReceivedEvidenceCatalogEntry => value !== null);
  const childEntries = entry.causalChildNodeKeys.map((key) => catalogEntryByNodeKey(catalog, key)).filter((value): value is ReceivedEvidenceCatalogEntry => value !== null);
  const observedEntries = entry.observedInputNodeKeys.map((key) => catalogEntryByNodeKey(catalog, key)).filter((value): value is ReceivedEvidenceCatalogEntry => value !== null);
  const eventLinks = linksForEntry?.(entry) ?? links;

  if (focusMode) return <article className="modular-view modular-event-view" data-resolution="RESOLVED" data-narrative-focus="true">
    <header className="narrative-focus-header"><p>{fr ? `Étape ${entry.timelinePosition} / ${entry.timelineLength}` : `Step ${entry.timelinePosition} / ${entry.timelineLength}`}</p><button className="narrative-focus-toggle" type="button" aria-pressed="true" onClick={changeFocus}>{fr ? "Mode Focus" : "Focus mode"}</button></header>
    <FocusStoryReading entry={entry} previous={previous} next={next} locale={locale} titleRef={titleRef} />
    <div className="narrative-focus-actions">
      {onBack && <StoryBackControl locale={locale} onBack={onBack} />}
      {next ? <EntryControl entry={next} href={linksForEntry?.(next).path ?? linksForEntry?.(next).event} onSelect={onSelectEntry} label={fr ? "Continuer l’histoire →" : "Continue the story →"} /> : <p role="status">{fr ? "Lecture terminée" : "Reading complete"}</p>}
      {eventLinks.graph && <a className="narrative-focus-causality" href={eventLinks.graph}>{fr ? "Voir plus de causalité →" : "See more causality →"}</a>}
      {eventLinks.path && <a href={eventLinks.path}>{fr ? "← Revenir au chemin" : "← Return to the path"}</a>}
    </div>
  </article>;

  const relationGroup = (title: string, empty: string, relationEntries: readonly ReceivedEvidenceCatalogEntry[], direction: "before" | "after" | "observed") => <section className="modular-relation-group" data-relation-direction={direction}>
    <div><h2>{title}</h2><span>{fr ? `${relationEntries.length} référence${relationEntries.length === 1 ? "" : "s"} directe${relationEntries.length === 1 ? "" : "s"} reçue${relationEntries.length === 1 ? "" : "s"}` : `${relationEntries.length} received direct reference${relationEntries.length === 1 ? "" : "s"}`}</span></div>
    {relationEntries.length ? <ul>{relationEntries.map((related) => {
      const relatedLinks = linksForEntry?.(related);
      return <li key={related.nodeKey}><EntryControl entry={related} href={related.timelinePosition === null ? relatedLinks?.nanoreceipts ?? relatedLinks?.forensic : relatedLinks?.event} onSelect={onSelectEntry} label={direction === "observed" ? (fr ? "Entrée observée déclarée" : "Declared observed input") : (fr ? "Relation causale déclarée" : "Declared causal relation")} /></li>;
    })}</ul> : <p>{empty}</p>}
  </section>;

  return <article className="modular-view modular-event-view" data-resolution="RESOLVED" data-family={entry.family ?? undefined}>
    <div className="modular-event-toolbar"><button className="narrative-focus-toggle" type="button" aria-pressed={false} onClick={changeFocus}>{fr ? "Mode Focus" : "Focus mode"}</button></div>
    <FactInspector as="section" className="modular-event-inspector" heading="h1" titleRef={titleRef} kicker={fr ? "Événement sélectionné" : "Selected event"}
      entry={entry} catalog={catalog} network={network} linksForEntry={linksForEntry ?? ((candidate) => candidate.nodeKey === entry.nodeKey ? eventLinks : {})} onSelectEntry={onSelectEntry}
      locale={locale} text={text} context="event" neighbourView="event" showRelations={false} fullNetwork />
    <div className="modular-event-relations">
      {relationGroup(fr ? "Causes déclarées" : "Declared causes", fr ? "Aucun parent causal déclaré." : "No declared causal parent.", parentEntries, "before")}
      {relationGroup(fr ? "Conséquences déclarées" : "Declared consequences", fr ? "Aucun enfant causal déclaré." : "No declared causal child.", childEntries, "after")}
      {relationGroup(fr ? "Entrées observées déclarées" : "Declared observed inputs", fr ? "Aucune entrée observée déclarée." : "No declared observed input.", observedEntries, "observed")}
    </div>
  </article>;
}

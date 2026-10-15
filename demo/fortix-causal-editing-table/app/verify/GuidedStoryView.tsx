"use client";

import { useEffect, useId, useRef, useState } from "react";
import { FactInspector } from "./FactInspector.tsx";
import { FocusStoryReading } from "./FocusStoryReading.tsx";
import type { ReceivedEvidenceCatalog, ReceivedEvidenceCatalogEntry } from "./receivedEvidenceCatalog.ts";
import { StoryEntryControl } from "./PersistentStoryTimeline.tsx";
import type { ReceivedNetworkModel } from "./receivedNetwork.ts";
import {
  guidedStoryDomainLabel,
  guidedStoryHumanCaption,
  guidedStoryPathLink,
  guidedStoryPosition,
  type GuidedStoryLinks,
} from "./guidedStory.ts";
import "./guided-story.css";

export type GuidedStoryViewProps = Readonly<{
  catalog: ReceivedEvidenceCatalog;
  locale: "en" | "fr";
  missionLabel?: string;
  selectedNodeKey?: string | null;
  selectionUnresolved?: boolean;
  recoveryPathHref?: string;
  links: GuidedStoryLinks;
  linksForEntry: (entry: ReceivedEvidenceCatalogEntry) => GuidedStoryLinks;
  onSelectEntry?: (entry: ReceivedEvidenceCatalogEntry) => void;
  focusMode?: boolean;
  onFocusModeChange?: (value: boolean) => void;
  /** Present only when a previous view exists; it reverses navigation, never reading progress. */
  onBack?: () => void;
  network?: ReceivedNetworkModel;
}>;

/** Secondary, reversible navigation next to the dominant forward action. */
export function StoryBackControl({ locale, onBack }: Readonly<{ locale: "en" | "fr"; onBack: () => void }>) {
  const fr = locale === "fr";
  return <button type="button" className="story-back" data-story-back onClick={onBack} title={fr ? "Revenir à la vue précédente" : "Go back to the previous view"}>
    <span aria-hidden="true">←</span> {fr ? "Retour" : "Back"}
  </button>;
}

/** One received fact at a time. Before/after are reading neighbours, never
 * invented causal links. Deeper questions keep explicit canonical destinations. */
export function GuidedStoryView({ catalog, locale, missionLabel, selectedNodeKey = null, selectionUnresolved = false, recoveryPathHref, links, linksForEntry, onSelectEntry, focusMode: controlledFocus, onFocusModeChange, onBack, network }: GuidedStoryViewProps) {
  const fr = locale === "fr";
  const [localFocus, setLocalFocus] = useState(false);
  const focusMode = controlledFocus ?? localFocus;
  const changeFocus = () => { if (controlledFocus === undefined) setLocalFocus(!focusMode); onFocusModeChange?.(!focusMode); };
  const titleId = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const position = guidedStoryPosition(catalog, selectedNodeKey, selectionUnresolved);
  const currentKey = position.current?.nodeKey;
  const status = position.status;
  useEffect(() => { titleRef.current?.focus({ preventScroll: true }); }, [currentKey, status]);
  const mission = guidedStoryHumanCaption(missionLabel, fr ? "Mission reçue" : "Received mission");

  if (!position.current) return <section className="guided-story-view guided-story-view--empty" aria-labelledby={titleId} data-story-status={position.status}>
    <p className="guided-story-kicker">{fr ? "Lecture des faits" : "Reading the facts"}</p>
    <h1 id={titleId} ref={titleRef} tabIndex={-1}>{position.status === "UNRESOLVED"
      ? (fr ? "Ce lien ne résout pas un événement unique" : "This link does not resolve one unique event")
      : position.status === "EMPTY"
      ? (fr ? "Aucun fait à lire dans ce PEB" : "No facts to read in this PEB")
      : position.status === "OUTSIDE_STORY"
        ? (fr ? "Cette preuve se consulte dans les vues détaillées" : "Read this evidence in the detailed views")
        : (fr ? "Cet événement n’est pas retrouvé" : "This event was not found")}</h1>
    <p>{fr ? "Les preuves reçues restent disponibles dans NanoReceipts et Forensic." : "Received evidence remains available in NanoReceipts and Forensic."}</p>
    <div className="guided-story-empty-actions">
      {selectionUnresolved ? recoveryPathHref && <a href={recoveryPathHref} className="guided-story-primary">{fr ? "← Revenir au chemin" : "← Return to the path"}</a> : position.first && <StoryEntryControl entry={position.first} href={guidedStoryPathLink(linksForEntry(position.first))} onSelectEntry={onSelectEntry} className="guided-story-primary">{fr ? "Revenir au début de l’histoire →" : "Return to the start of the story →"}</StoryEntryControl>}
      {links.nanoreceipts && <a href={links.nanoreceipts}>{fr ? "Voir les NanoReceipts reçus →" : "View received NanoReceipts →"}</a>}
      {links.forensic && <a href={links.forensic}>{fr ? "Ouvrir Forensic →" : "Open Forensic →"}</a>}
      {links.verdict && <a href={links.verdict}>{fr ? "← Retour au verdict" : "← Return to the verdict"}</a>}
    </div>
  </section>;

  const current = position.current;
  const eventLinks = linksForEntry(current);
  const next = position.next;
  const first = position.first;
  return <article className="guided-story-view" aria-labelledby={focusMode ? undefined : titleId} data-story-status="READY" data-story-completed={position.completed} data-narrative-focus={focusMode}>
    <header className="guided-story-context">
      <p className="guided-story-kicker">{fr ? "Lecture des faits · Chemin" : "Reading the facts · Path"}</p>
      <p><strong>{mission}</strong><span aria-hidden="true"> · </span>{guidedStoryDomainLabel(current, locale)}</p>
      <p className="guided-story-step" aria-live="polite">{fr ? `Étape ${position.index + 1} / ${position.entries.length}` : `Step ${position.index + 1} / ${position.entries.length}`}</p>
      <button className="narrative-focus-toggle" type="button" aria-pressed={focusMode} onClick={changeFocus}>{fr ? "Mode Focus" : "Focus mode"}</button>
    </header>

    {focusMode ? <FocusStoryReading entry={current} previous={position.previous} next={next} locale={locale} titleRef={titleRef} />
      : <FactInspector as="section" className="guided-story-fact" heading="h1" titleId={titleId} titleRef={titleRef} entry={current} catalog={catalog} network={network}
        linksForEntry={linksForEntry} onSelectEntry={onSelectEntry} locale={locale} context="path" fullNetwork />}

    <div className="guided-story-progress-action">
      {!next && <p className="guided-story-complete" role="status">{fr ? "Lecture terminée" : "Reading complete"}</p>}
      <div className="guided-story-actions-row">
        {onBack && <StoryBackControl locale={locale} onBack={onBack} />}
        {next ? <StoryEntryControl entry={next} href={guidedStoryPathLink(linksForEntry(next))} onSelectEntry={onSelectEntry} className="guided-story-primary">{fr ? "Continuer l’histoire →" : "Continue the story →"}</StoryEntryControl>
          : first && <StoryEntryControl entry={first} href={guidedStoryPathLink(linksForEntry(first))} onSelectEntry={onSelectEntry} className="guided-story-primary">{fr ? "Revenir au début de l’histoire →" : "Return to the start of the story →"}</StoryEntryControl>}
      </div>
      <p>{fr ? "Avant et après indiquent l’ordre de lecture ; ils n’ajoutent aucune causalité." : "Before and after describe reading order; they add no causal relation."}</p>
    </div>

    {focusMode && eventLinks.graph && <a className="narrative-focus-causality" href={eventLinks.graph}>{fr ? "Voir plus de causalité →" : "See more causality →"}</a>}
  </article>;
}

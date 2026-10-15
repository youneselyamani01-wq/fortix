"use client";

import { useId, type MouseEvent, type ReactNode } from "react";
import type { ReceivedEvidenceCatalog, ReceivedEvidenceCatalogEntry } from "./receivedEvidenceCatalog.ts";
import {
  guidedStoryDomainLabel,
  guidedStoryEventLabel,
  guidedStoryHumanCaption,
  guidedStoryPathLink,
  guidedStoryPosition,
  type GuidedStoryLinks,
} from "./guidedStory.ts";
import "./guided-story.css";

export type PersistentStoryTimelineProps = Readonly<{
  catalog: ReceivedEvidenceCatalog;
  locale: "en" | "fr";
  missionLabel?: string;
  selectedNodeKey?: string | null;
  selectionUnresolved?: boolean;
  originAbsent?: boolean;
  recoveryPathHref?: string;
  links?: GuidedStoryLinks;
  linksForEntry: (entry: ReceivedEvidenceCatalogEntry) => GuidedStoryLinks;
  onSelectEntry?: (entry: ReceivedEvidenceCatalogEntry) => void;
  returnEventHref?: string;
  onReturnEvent?: (event: MouseEvent<HTMLAnchorElement>) => void;
}>;

export function StoryEntryControl({ entry, href, onSelectEntry, className, children, current = false }: {
  entry: ReceivedEvidenceCatalogEntry;
  href?: string;
  onSelectEntry?: (entry: ReceivedEvidenceCatalogEntry) => void;
  className?: string;
  children: ReactNode;
  current?: boolean;
}) {
  const select = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) onSelectEntry?.(entry);
  };
  if (href) return <a className={className} href={href} onClick={select} aria-current={current ? "step" : undefined}>{children}</a>;
  if (onSelectEntry) return <button className={className} type="button" onClick={() => onSelectEntry(entry)} aria-current={current ? "step" : undefined}>{children}</button>;
  return <span className={className} aria-current={current ? "step" : undefined}>{children}</span>;
}

/** One persistent reading context; neighbouring facts belong to the timeline. */
export function PersistentStoryTimeline({ catalog, locale, missionLabel, selectedNodeKey = null, selectionUnresolved = false, originAbsent = false, recoveryPathHref, links, linksForEntry, returnEventHref, onReturnEvent }: PersistentStoryTimelineProps) {
  const fr = locale === "fr";
  const titleId = useId();
  const position = guidedStoryPosition(catalog, selectedNodeKey, selectionUnresolved || originAbsent);
  const mission = guidedStoryHumanCaption(missionLabel, fr ? "Mission reçue" : "Received mission")
    .replace(/^(?:Cycle opérationnel|Operational cycle)\s+/i, "")
    .replace(/\bmission\b/i, "Mission");
  const pathHref = recoveryPathHref ?? (selectionUnresolved ? undefined : position.first ? guidedStoryPathLink(linksForEntry(position.first)) : guidedStoryPathLink(links));

  if (!position.current) return <section className="persistent-story-timeline persistent-story-timeline--empty" aria-labelledby={titleId} data-story-status={originAbsent ? "ORIGIN_ABSENT" : position.status}>
    <h2 id={titleId}>{fr ? "Repère dans l’histoire" : "Your place in the story"}</h2>
    <p>{originAbsent ? (fr ? "Aucun événement d’origine de lecture n’est indiqué par ce lien. La preuve sélectionnée reste consultable ; aucun premier fait n’est choisi à sa place." : "This link provides no original reading event. The selected evidence remains inspectable; no first fact replaces the missing origin.") : position.status === "UNRESOLVED"
      ? (fr ? "Ce lien ne résout pas un événement unique." : "This link does not resolve one unique event.")
      : position.status === "EMPTY"
      ? (fr ? "Aucun fait lisible n’est déclaré dans ce PEB." : "This PEB declares no readable facts.")
      : position.status === "OUTSIDE_STORY"
        ? (fr ? "Cette preuve se trouve en dehors de la lecture des faits." : "This evidence sits outside the reading of facts.")
        : (fr ? "L’événement sélectionné n’est pas retrouvé dans ce PEB." : "The selected event is not found in this PEB.")}</p>
    {pathHref && <a href={pathHref}>{fr ? "← Revenir au chemin" : "← Return to the path"}</a>}
  </section>;

  const current = position.current;
  return <section className="persistent-story-timeline" aria-labelledby={titleId} data-story-status="READY">
    <header>
      <h2 id={titleId} className="verifier-reading-context"><span>{mission}</span><span>{fr ? `Étape ${position.index + 1} / ${position.entries.length}` : `Step ${position.index + 1} / ${position.entries.length}`}</span><span>{guidedStoryDomainLabel(current, locale)}</span><strong>{guidedStoryEventLabel(current, locale)}</strong></h2>
      {returnEventHref && <a className="verifier-story-return" href={returnEventHref} onClick={onReturnEvent}><span aria-hidden="true">← </span>{fr ? "Retour à l’événement" : "Return to the event"}</a>}
    </header>
  </section>;
}

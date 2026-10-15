"use client";

import type { RefObject } from "react";
import { FactProvenanceBadge } from "./FactProvenanceBadge.tsx";
import { guidedStoryDomainLabel, guidedStoryEventLabel } from "./guidedStory.ts";
import type { ReceivedEvidenceCatalogEntry } from "./receivedEvidenceCatalog.ts";
import "./guided-story.css";

/** Reading neighbours describe declared timeline order, never causal parents. */
export function FocusStoryReading({ entry, previous, next, locale, titleRef }: {
  entry: ReceivedEvidenceCatalogEntry;
  previous: ReceivedEvidenceCatalogEntry | null;
  next: ReceivedEvidenceCatalogEntry | null;
  locale: "en" | "fr";
  titleRef?: RefObject<HTMLHeadingElement | null>;
}) {
  const fr = locale === "fr";
  return <div className="narrative-focus-reading" data-focus-reading>
    <section className="narrative-focus-neighbour"><h2>{fr ? "Avant" : "Before"}</h2><p>{previous ? guidedStoryEventLabel(previous, locale) : (fr ? "Début de l’histoire reçue : aucun fait précédent." : "Start of the received story: no preceding fact.")}</p></section>
    <section className="narrative-focus-event">
      <p className="guided-story-kicker">{fr ? "Événement" : "Event"}</p>
      <h1 ref={titleRef} tabIndex={-1}>{guidedStoryEventLabel(entry, locale)}</h1>
      <p><strong>{fr ? "Domaine : " : "Domain: "}</strong>{guidedStoryDomainLabel(entry, locale)}</p>
      <FactProvenanceBadge provenance={entry.provenance} locale={locale} compact />
    </section>
    <section className="narrative-focus-neighbour"><h2>{fr ? "Après" : "After"}</h2><p>{next ? guidedStoryEventLabel(next, locale) : (fr ? "Dernier fait de l’histoire reçue : aucun fait suivant." : "Last fact of the received story: no following fact.")}</p></section>
    <p className="narrative-focus-order-note">{fr ? "Avant et après suivent l’ordre de lecture déclaré ; ils n’ajoutent aucune causalité." : "Before and after follow the declared reading order; they add no causal relation."}</p>
  </div>;
}

"use client";

import { useId, useMemo, useState } from "react";
import type { ReceivedEvidenceCatalog, ReceivedEvidenceCatalogEntry } from "./receivedEvidenceCatalog.ts";
import type { VerifierView } from "./verifierRoutes.ts";
import { searchVerifierFacts } from "./searchReceivedFacts.ts";
import { factProvenanceLabel } from "./receivedProvenance.ts";
import "./business-search.css";

export function VerifierBusinessSearch({ catalog, locale, query: externalQuery, onQueryChange, linksForEntry, domainHrefForId }: {
  catalog: ReceivedEvidenceCatalog;
  locale: "en" | "fr";
  query?: string;
  onQueryChange?: (value: string) => void;
  linksForEntry: (entry: ReceivedEvidenceCatalogEntry) => Partial<Record<VerifierView, string>>;
  domainHrefForId: (domainId: string) => string;
}) {
  const fr = locale === "fr";
  const [localQuery, setLocalQuery] = useState("");
  const query = externalQuery ?? localQuery;
  const id = useId();
  const results = useMemo(() => searchVerifierFacts(catalog, query), [catalog, query]);
  const labels = fr ? { event: "Événements et clôture de mission", domain: "Domaines", nanoreceipt: "NanoReceipts", forensic: "Références techniques · Forensic" } : { event: "Events and mission closure", domain: "Domains", nanoreceipt: "NanoReceipts", forensic: "Technical references · Forensic" };
  return <section className="verifier-business-search" aria-labelledby={id}>
    <label htmlFor={`${id}-input`} id={id}>{fr ? "Rechercher dans les faits" : "Search the facts"}</label>
    <div className="verifier-business-search__field"><input id={`${id}-input`} type="search" value={query} onChange={event => { if (onQueryChange) onQueryChange(event.currentTarget.value); else setLocalQuery(event.currentTarget.value); }} placeholder={fr ? "Réseau, paiement, garage, passager déposé…" : "Network, payment, garage, passenger dropped off…"} /><button type="button" disabled={!query} onClick={() => { if (onQueryChange) onQueryChange(""); else setLocalQuery(""); }}>{fr ? "Effacer" : "Clear"}</button></div>
    {query.trim() && <div className="verifier-business-search__results">
      <p role="status">{fr ? `${results.length} résultats dans le PEB reçu` : `${results.length} results in the received PEB`}</p>
      {results.length === 0 ? <p>{fr ? "Aucun fait ou domaine reçu ne correspond à cette recherche. Essayez un autre mot ; le PEB est chargé." : "No received fact or domain matches this search. Try another word; the PEB is loaded."}</p> : <>
        {(["event", "domain", "nanoreceipt", "forensic"] as const).map(kind => {
          const group = results.filter(result => result.kind === kind);
          if (!group.length) return null;
          return <section key={kind} data-search-result-kind={kind}><h2>{labels[kind]} · {group.length} {fr ? "résultats" : "results"}</h2><ul>{group.map(result => {
            const links = result.entry ? linksForEntry(result.entry) : null;
            const href = kind === "domain" ? domainHrefForId(result.domainId!) : links?.[kind === "event" ? "event" : kind === "nanoreceipt" ? "nanoreceipts" : "forensic"];
            const contents = <><strong>{result.label}</strong><span>{kind === "forensic" ? (fr ? "Ouvrir la référence exacte en Forensic" : "Open the exact reference in Forensic") : kind === "domain" ? (fr ? "Voir les faits de ce domaine" : "View this domain’s facts") : result.context}</span>{result.entry && kind !== "forensic" && <span>{factProvenanceLabel(result.entry.provenance, locale)}</span>}</>;
            return <li key={result.key}>{href ? <a href={href}>{contents}</a> : <p>{contents}<span>{fr ? "Destination non applicable à cette unité de preuve." : "Destination not applicable to this evidence item."}</span></p>}</li>;
          })}</ul></section>;
        })}
      </>}
    </div>}
  </section>;
}

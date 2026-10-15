"use client";

import { useMemo, useState } from "react";
import { declaredMissionTime } from "./guidedInspection.ts";
import { readInspectionEvidence } from "./inspectionPresentation.ts";
import { FactProvenanceBadge } from "./FactProvenanceBadge.tsx";
import { searchVerifierFacts } from "./searchReceivedFacts.ts";
import type { ReceivedGraph } from "./receivedGraph.ts";
import {
  createReceivedEvidenceCatalog,
  receivedEvidenceCausalNeighbours,
  receivedEvidenceFamilyKeys,
  resolveReceivedEvidenceSelection,
  type ReceivedEvidenceCatalogEntry,
  type ReceivedEvidenceFamilyKey,
  type ReceivedEvidenceSelectionInput,
} from "./receivedEvidenceCatalog.ts";
import type { VerifierView } from "./verifierRoutes.ts";
import { NetworkFactSummary, networkRuntimeProvenanceNote } from "./ReceivedNetworkView.tsx";
import { networkTransitionOf, type ReceivedNetworkModel } from "./receivedNetwork.ts";

export type NanoReceiptFilters = Readonly<{
  family: ReceivedEvidenceFamilyKey | null;
  domainId: string | null;
}>;

export type NanoReceiptsViewProps = Readonly<{
  graph: ReceivedGraph;
  locale: "en" | "fr";
  selection: ReceivedEvidenceSelectionInput;
  links: Partial<Record<VerifierView, string>>;
  linksForEntry?: (entry: ReceivedEvidenceCatalogEntry) => Partial<Record<VerifierView, string>>;
  onSelectEntry?: (entry: ReceivedEvidenceCatalogEntry) => void;
  onFilterChange?: (filters: NanoReceiptFilters) => void;
  text?: string;
  query?: string;
  onQueryChange?: (value: string) => void;
  network?: ReceivedNetworkModel;
}>;

function validFamily(value: string | null | undefined): ReceivedEvidenceFamilyKey | null {
  return value && receivedEvidenceFamilyKeys.includes(value as ReceivedEvidenceFamilyKey) ? value as ReceivedEvidenceFamilyKey : null;
}

export function receivedEvidenceTypeLabel(raw: unknown, locale: "en" | "fr"): string {
  const value = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
  const type = value?.eventType ?? value?.evidence_type;
  const labels: Readonly<Record<string, readonly [string, string]>> = {
    INTENT: ["Intent", "Intention"], OBSERVATION: ["Observation declaration", "Déclaration d’observation"],
    AUTHORITY: ["Authority", "Autorité"], AUTHORIZATION: ["Authorization", "Autorisation"],
    POLICY_DECISION: ["Policy decision", "Décision de politique"], POLICY_AUTHORITY_STATUS: ["Policy authority status", "État d’autorité de politique"],
    TRUSTED_TIME: ["Trusted time evidence", "Preuve de temps de confiance"], TRUST_ANCHOR_LIFECYCLE: ["Trust anchor lifecycle", "Cycle de vie d’ancre de confiance"],
    EXECUTION: ["Execution declaration", "Déclaration d’exécution"], RESULT: ["Result declaration", "Déclaration de résultat"],
    CAUSAL_RECEIPT: ["Evidence compilation", "Compilation de preuves"], CAUSAL_COMPILATION: ["Evidence compilation", "Compilation de preuves"],
    VEHICLE_ACTION: ["Vehicle action", "Action du véhicule"], VEHICLE_RESULT: ["Vehicle result", "Résultat du véhicule"],
    VEHICLE_OBSERVATION: ["Vehicle observation declaration", "Déclaration d’observation du véhicule"],
    AUTONOMOUS_DECISION: ["Autonomous decision", "Décision autonome"], SIGNAL_STATE_PUBLISHED: ["Published signal state", "État du signal publié"],
    SIGNAL_PHASE_DECIDED: ["Signal phase decision", "Décision de phase du signal"], CITY_SENSOR_DETECTION: ["City detection declaration", "Déclaration de détection urbaine"],
    ROUTING_PROVENANCE_RECORDED: ["Routing decision record", "Enregistrement de décision d’itinéraire"],
    PAYMENT_INSTRUCTION_PRESENTED: ["Payment instruction", "Instruction de paiement"], BANK_AUTHORIZATION_DECISION: ["Bank authorization decision", "Décision d’autorisation bancaire"],
    BANK_CONFIRMATION_RETURNED: ["Bank confirmation", "Confirmation bancaire"],
    NETWORK_LINK_LOST: ["Network loss transition", "Transition de perte réseau"], NETWORK_LINK_RESTORED: ["Network restoration transition", "Transition de retour réseau"],
    RECONCILIATION_RECEIPT: ["Reconciliation record", "Enregistrement de réconciliation"],
  };
  return typeof type === "string" && labels[type] ? labels[type][locale === "fr" ? 1 : 0] : locale === "fr" ? "Type non établi pour cette preuve" : "Type unestablished for this evidence";
}

export function NanoReceiptsView({ graph, locale, selection, linksForEntry, onSelectEntry, onFilterChange, text, query: externalQuery, onQueryChange, network }: NanoReceiptsViewProps) {
  const fr = locale === "fr";
  const catalog = useMemo(() => createReceivedEvidenceCatalog(graph, locale, text), [graph, locale, text]);
  const externalFamily = validFamily(selection.family);
  const externalDomain = selection.domainId ?? null;
  const [localFilters, setLocalFilters] = useState<Readonly<{ family: ReceivedEvidenceFamilyKey | null; domainId: string | null }>>(() => ({
    family: externalFamily,
    domainId: externalDomain,
  }));
  const family = onFilterChange ? externalFamily : localFilters.family;
  const domainId = onFilterChange ? externalDomain : localFilters.domainId;
  const [localQuery, setLocalQuery] = useState("");
  const query = externalQuery ?? localQuery;
  const setQuery = (value: string) => { if (onQueryChange) onQueryChange(value); else setLocalQuery(value); };
  const resolution = useMemo(() => resolveReceivedEvidenceSelection(catalog, selection), [catalog, selection]);
  const selectedKey = resolution.status === "RESOLVED" ? resolution.entry?.nodeKey ?? null : null;
  const normalizedQuery = query.trim().toLocaleLowerCase(locale);
  const matchingEventKeys = new Set(searchVerifierFacts(catalog, query).flatMap((result) => result.entry ? [result.entry.nodeKey] : []));
  const filtered = catalog.entries.filter((entry) => {
    if (family && entry.family !== family) return false;
    if (domainId && entry.domainId !== domainId) return false;
    if (!normalizedQuery) return true;
    return matchingEventKeys.has(entry.nodeKey) || [entry.eventLabel, entry.familyLabel, entry.domainLabel, entry.receipt.title]
      .filter((value): value is string => !!value)
      .some((value) => value.toLocaleLowerCase(locale).includes(normalizedQuery));
  });
  const selectedEntry = resolution.status === "RESOLVED" ? resolution.entry : null;
  const selectedOutsideFilter = selectedEntry !== null && !filtered.some(entry => entry.nodeKey === selectedEntry.nodeKey);
  const displayed = selectedEntry ? [selectedEntry, ...filtered.filter(entry => entry.nodeKey !== selectedEntry.nodeKey)] : filtered;
  const totals = {
    nano: catalog.entries.filter((entry) => entry.receipt.kind === "NANO_RECEIPT").length,
    support: catalog.entries.filter((entry) => entry.receipt.kind === "SUPPORT").length,
    final: catalog.entries.filter((entry) => entry.receipt.kind === "FINAL_RECEIPT").length,
    unresolved: catalog.entries.filter((entry) => entry.receipt.kind === "UNRESOLVED").length,
  };
  const presentFamilies = catalog.families.filter((item) => item.entries.length > 0);
  const familyCount = (entries: readonly ReceivedEvidenceCatalogEntry[]) => {
    const nano = entries.filter((entry) => entry.receipt.kind === "NANO_RECEIPT").length;
    const support = entries.filter((entry) => entry.receipt.kind === "SUPPORT").length;
    const final = entries.filter((entry) => entry.receipt.kind === "FINAL_RECEIPT").length;
    const unresolved = entries.filter((entry) => entry.receipt.kind === "UNRESOLVED").length;
    return [nano ? `${nano} NanoReceipts` : null, support ? `${support} ${fr ? "preuves de support" : "supporting evidence items"}` : null, final ? `${final} ${fr ? "reçus finaux" : "Final Receipts"}` : null, unresolved ? `${unresolved} ${fr ? "preuves non identifiées" : "unidentified evidence items"}` : null].filter(Boolean).join(" · ");
  };
  const unitCount = (count: number) => fr
    ? `${count} ${count !== 1 ? "unités" : "unité"}`
    : `${count} ${count === 1 ? "item" : "items"}`;
  const timelinePosition = (position: number, length: number) => fr
    ? `Position dans la Timeline ${position} sur ${length} éléments`
    : `Timeline position ${position} of ${length} items`;
  const updateFilters = (next: NanoReceiptFilters) => {
    if (onFilterChange) onFilterChange(next);
    else setLocalFilters(next);
  };

  return <article className="modular-view modular-receipts-view">
    <header className="modular-inventory-hero">
      <div><p className="modular-kicker">{fr ? "Inventaire des unités de preuve" : "Inventory of evidence units"}</p><h1>NanoReceipts</h1><p>{fr ? "Chaque unité de preuve reçue, une fois. L’ordre des faits se lit dans la Timeline, leur lecture dans l’inspecteur." : "Every received evidence unit, once. Read the order of facts in the Timeline and each fact in the inspector."}</p></div>
      <dl>
        <div><dt>{fr ? "NanoReceipts reçus" : "Received NanoReceipts"}</dt><dd>{totals.nano} NanoReceipts</dd></div>
        <div><dt>{fr ? "Preuves de support reçues" : "Received support evidence"}</dt><dd>{totals.support} {fr ? "preuves de support" : "supporting evidence items"}</dd></div>
        <div><dt>{fr ? "Reçus finaux" : "Final Receipts"}</dt><dd>{totals.final} {fr ? (totals.final === 1 ? "reçu final" : "reçus finaux") : (totals.final === 1 ? "Final Receipt" : "Final Receipts")}</dd></div>
        {totals.unresolved > 0 && <div><dt>{fr ? "Identités non résolues" : "Unresolved identities"}</dt><dd>{totals.unresolved} {fr ? "preuves non identifiées" : "unidentified evidence items"}</dd></div>}
      </dl>
    </header>

    <section className="modular-receipt-filters" aria-labelledby="receipt-filter-title">
      <div className="modular-filter-heading"><div><p className="modular-kicker">{fr ? `${presentFamilies.length} ${presentFamilies.length === 1 ? "catégorie présente" : "catégories présentes"} dans le PEB` : `${presentFamilies.length} ${presentFamilies.length === 1 ? "category" : "categories"} present in the PEB`}</p><h2 id="receipt-filter-title">{fr ? "Filtrer l’inventaire" : "Filter the inventory"}</h2></div><strong aria-live="polite">{fr ? `${filtered.length} unités de preuve correspondent au filtre sur ${catalog.entries.length} reçues` : `${filtered.length} evidence items match the filter of ${catalog.entries.length} received`}</strong></div>
      <p>{fr ? "Cet inventaire comprend les NanoReceipts de faits, les dossiers compilés, les supports et le reçu final. La Timeline présente uniquement l’histoire de mission." : "This inventory includes fact NanoReceipts, compiled dossiers, support and the Final Receipt. The Timeline presents only the mission story."}</p>
      <div className="modular-family-filter" role="group" aria-label={fr ? "Famille de preuve" : "Evidence family"}>
        <button type="button" aria-pressed={family === null} onClick={() => updateFilters({ family: null, domainId })}>{fr ? "Toutes les unités reçues" : "All received items"}<span>{unitCount(catalog.entries.length)}</span></button>
        {presentFamilies.map((item) => <button key={item.key} type="button" aria-pressed={family === item.key} onClick={() => updateFilters({ family: item.key, domainId })}>{item.label} — <span>{familyCount(item.entries)}</span></button>)}
      </div>
      <div className="modular-filter-fields">
        <label><span>{fr ? "Rechercher un événement" : "Search events"}</span><input type="search" value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder={fr ? "Nom, famille ou domaine" : "Name, family, or domain"} /></label>
        <label><span>{fr ? "Domaine producteur" : "Producer domain"}</span><select value={domainId ?? ""} onChange={(event) => updateFilters({ family, domainId: event.currentTarget.value || null })}><option value="">{fr ? "Tous les domaines producteurs" : "All producer domains"}</option>{catalog.domains.map((domain) => <option key={domain.id} value={domain.id}>{fr ? `Domaine producteur : ${domain.label} — ${unitCount(domain.entries.length)} reçues` : `Producer domain: ${domain.label} — ${unitCount(domain.entries.length)} received`}</option>)}</select></label>
        {(family || domainId || query) && <button className="modular-clear-filters" type="button" onClick={() => { setQuery(""); updateFilters({ family: null, domainId: null }); }}>{fr ? "Effacer les filtres" : "Clear filters"}</button>}
      </div>
    </section>

    {catalog.issues.length > 0 && <aside className="modular-catalog-warning" role="status"><strong>{fr ? "Anomalies dans l’inventaire" : "Inventory issues"}</strong><p>{fr ? `${catalog.issues.length} anomalies de classement ou d’identité ont été détectées. Ce nombre compte des anomalies, pas des NanoReceipts. Les identifiants exacts restent disponibles en Forensic.` : `${catalog.issues.length} classification or identity issues were detected. This counts issues, not NanoReceipts. Exact identifiers remain available in Forensic.`}</p></aside>}
    {totals.unresolved > 0 && <aside className="modular-catalog-warning" role="status"><strong>{fr ? "Identités de preuves non résolues" : "Unresolved evidence identities"}</strong><p>{fr ? `${totals.unresolved} ${totals.unresolved === 1 ? "preuve reçue a" : "preuves reçues ont"} une identité absente ou ambiguë. Les preuves concernées restent dans l’inventaire et ne sont pas comptées comme NanoReceipts identifiés.` : `${totals.unresolved} received evidence ${totals.unresolved === 1 ? "item has" : "items have"} a missing or ambiguous identity. The affected evidence remains in the inventory and is not counted as identified NanoReceipts.`}</p></aside>}
    {resolution.status !== "EMPTY" && resolution.status !== "RESOLVED" && <aside className="modular-catalog-warning" role="status"><strong>{fr ? "Sélection non résolue" : "Unresolved selection"}</strong><p>{fr ? "La sélection demandée est absente, ambiguë ou contradictoire. Aucune autre preuve n’est sélectionnée à sa place." : "The requested selection is missing, ambiguous or contradictory. No other evidence is selected in its place."}</p></aside>}

    {selectedOutsideFilter && <p role="status">{fr ? "La preuve sélectionnée reste affichée en premier pour conserver votre contexte. Elle ne correspond pas au filtre actuel et n’est pas comptée parmi ses résultats." : "The selected evidence remains first to preserve your context. It does not match the current filter and is not counted among its results."}</p>}
    {displayed.length > 0 && <p className="modular-receipt-order" data-receipt-order>
      <strong>{fr ? "NanoReceipts · ordre chronologique →" : "NanoReceipts · chronological order →"}</strong>
      <span>{fr ? "Du premier fait enregistré au dernier" : "From the first recorded fact to the last"}{selectedEntry ? (fr ? " · le NanoReceipt sélectionné est placé en tête" : " · the selected NanoReceipt is placed first") : ""}</span>
    </p>}
    {displayed.length > 0 ? <ol className="modular-receipt-list">
      {displayed.map((entry) => {
        const entryLinks = linksForEntry?.(entry) ?? {};
        const neighbours = receivedEvidenceCausalNeighbours(catalog, entry);
        const raw = text ? readInspectionEvidence(text, entry.node).raw : null;
        const neighbourPosition = (candidate: ReceivedEvidenceCatalogEntry) => candidate.timelinePosition
          ? timelinePosition(candidate.timelinePosition, candidate.timelineLength)
          : candidate.receipt.title;
        const isSelected = entry.nodeKey === selectedKey;
        const transition = network ? networkTransitionOf(network, entry.nodeKey) : null;
        return <li key={entry.nodeKey} data-selected={isSelected} data-family={entry.family ?? "unclassified"} aria-current={isSelected ? "true" : undefined}>
          <article>
            {isSelected && <p className="modular-receipt-selected-marker" data-selected-marker><span aria-hidden="true">●</span> {fr ? "Sélectionné" : "Selected"}</p>}
            <header><div><h2>{entry.eventLabel}</h2>
              <p className="modular-receipt-kind">{entry.receipt.title} · {entry.familyLabel ?? (fr ? "Famille non résolue" : "Unresolved family")}</p>
              <FactProvenanceBadge provenance={entry.provenance} locale={locale} compact description={transition && entry.provenance.category === "RUNTIME" ? networkRuntimeProvenanceNote(locale) : undefined} />
              <p className="modular-receipt-time"><time>{declaredMissionTime(entry.node.member?.timeMs ?? null, locale)}</time></p>
            </div><span>{entry.timelinePosition ? timelinePosition(entry.timelinePosition, entry.timelineLength) : (fr ? "Hors Timeline" : "Outside Timeline")}</span></header>
            {network && <NetworkFactSummary model={network} nodeKey={entry.nodeKey} locale={locale} compact />}
            <dl>
              <div><dt>{fr ? "Type" : "Type"}</dt><dd>{entry.provenance.category === "COMPILED" ? (fr ? "Compilation de preuves" : "Evidence compilation") : entry.receipt.kind === "FINAL_RECEIPT" ? (fr ? "Reçu final" : "Final Receipt") : receivedEvidenceTypeLabel(raw, locale)}</dd></div>
              <div><dt>{fr ? "Domaine producteur" : "Producer domain"}</dt><dd>{entry.domainLabel ?? (fr ? "Non déclaré" : "Not declared")}</dd></div>
              <div><dt>{fr ? "Position dans la famille" : "Position in family"}</dt><dd>{entry.familyPosition && entry.familyLength ? (fr ? `${entry.familyPosition} sur ${entry.familyLength} unités de preuve de cette famille` : `${entry.familyPosition} of ${entry.familyLength} evidence items in this family`) : (fr ? "Non applicable : famille non établie" : "Not applicable: family unestablished")}</dd></div>
            </dl>
            <section className="modular-receipt-neighbours" aria-label={fr ? "Voisinage causal immédiat" : "Immediate causal neighbourhood"}>
              {(["parents", "children"] as const).map((kind) => <div key={kind}><h3>{kind === "parents" ? (fr ? "Parents causaux directs" : "Direct causal parents") : (fr ? "Enfants causaux directs" : "Direct causal children")}</h3>{neighbours[kind].length ? <ul>{neighbours[kind].map((candidate) => {
                const neighbourLinks = linksForEntry?.(candidate);
                const href = neighbourLinks?.nanoreceipts ?? neighbourLinks?.forensic;
                return <li key={candidate.nodeKey}>{href ? <a href={href} onClick={() => onSelectEntry?.(candidate)}>{candidate.eventLabel}</a> : <strong>{candidate.eventLabel}</strong>}<span>{neighbourPosition(candidate)}</span></li>;
              })}</ul> : <p>{kind === "parents" ? (fr ? "Aucun parent causal direct déclaré pour cette preuve." : "No direct causal parent is declared for this evidence.") : (fr ? "Aucun enfant causal direct déclaré pour cette preuve." : "No direct causal child is declared for this evidence.")}</p>}</div>)}
            </section>
            <nav aria-label={fr ? `Explorer ${entry.eventLabel}` : `Explore ${entry.eventLabel}`}>
              {entry.timelinePosition !== null && entryLinks.event && <a href={entryLinks.event} onClick={() => onSelectEntry?.(entry)}>{fr ? "Lire l’événement" : "Read the event"}</a>}
              {entry.timelinePosition !== null && entryLinks.graph && <a href={entryLinks.graph} onClick={() => onSelectEntry?.(entry)}>{fr ? "Voir dans le graphe" : "View in graph"}</a>}
              {entryLinks.forensic && <a href={entryLinks.forensic} onClick={() => onSelectEntry?.(entry)}>{fr ? "Ouvrir les détails Forensic" : "Open Forensic details"}<span aria-hidden="true">→</span></a>}
            </nav>
          </article>
        </li>;
      })}
    </ol> : <div className="modular-empty-state" role="status"><h2>{fr ? "Aucune preuve dans ce filtre" : "No evidence in this filter"}</h2><p>{fr ? "Modifiez la famille, le domaine ou la recherche." : "Change the family, domain, or search."}</p></div>}
  </article>;
}

"use client";

import { useMemo, useState, type SyntheticEvent } from "react";
import type { D006VerdictSnapshot } from "../offlineVerification.ts";
import type { ReceivedPebProjection } from "./inspectReceivedPeb.ts";
import { inspectionCoverage, readInspectionEvidence } from "./inspectionPresentation.ts";
import type { ReceivedGraph } from "./receivedGraph.ts";
import {
  catalogEntryByNodeKey,
  createReceivedEvidenceCatalog,
  resolveReceivedEvidenceSelection,
  type ReceivedEvidenceCatalogEntry,
  type ReceivedEvidenceSelectionInput,
} from "./receivedEvidenceCatalog.ts";
import { VerifierViewActions, type VerifierView } from "./VerifierViewActions.tsx";
import { FactProvenanceBadge } from "./FactProvenanceBadge.tsx";
import { verifierExpandedPanels, type VerifierPresentationProps } from "./verifierPresentation.ts";

export type ForensicViewProps = Readonly<{
  graph: ReceivedGraph;
  peb: ReceivedPebProjection;
  text: string;
  locale: "en" | "fr";
  selection: ReceivedEvidenceSelectionInput;
  snapshot?: D006VerdictSnapshot | null;
  links: Partial<Record<VerifierView, string>>;
  linksForEntry?: (entry: ReceivedEvidenceCatalogEntry) => Partial<Record<VerifierView, string>>;
  onSelectEntry?: (entry: ReceivedEvidenceCatalogEntry) => void;
}> & VerifierPresentationProps;

function receivedRoot(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text);
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch { return null; }
}

function receivedMemberRef(text: string, entry: ReceivedEvidenceCatalogEntry): unknown | null {
  if (!entry.node.member) return null;
  const root = receivedRoot(text);
  const manifest = root?.manifest;
  const refs = manifest !== null && typeof manifest === "object" && !Array.isArray(manifest)
    ? (manifest as { memberRefs?: unknown }).memberRefs : null;
  return Array.isArray(refs) ? refs[entry.node.member.index] ?? null : null;
}

function TechnicalValue({ children }: { children: string | number | null | undefined }) {
  return <code>{children === null || children === undefined || children === "" ? "—" : children}</code>;
}

export function ForensicView({ graph, peb, text, locale, selection, snapshot, links, linksForEntry, onSelectEntry, uiState, onUIStateChange }: ForensicViewProps) {
  const fr = locale === "fr";
  const catalog = useMemo(() => createReceivedEvidenceCatalog(graph, locale, text), [graph, locale, text]);
  const resolution = useMemo(() => resolveReceivedEvidenceSelection(catalog, selection), [catalog, selection]);
  const selected = resolution.status === "RESOLVED" ? resolution.entry : null;
  const evidence = selected ? readInspectionEvidence(text, selected.node) : null;
  const coverage = selected ? inspectionCoverage(peb, snapshot, selected.node) : inspectionCoverage(peb, snapshot);
  const memberRef = selected ? receivedMemberRef(text, selected) : null;
  const touchingEdges = selected ? graph.edges.filter((edge) => edge.from === selected.nodeKey || edge.to === selected.nodeKey) : [];
  const touchingDeclarations = touchingEdges.reduce((sum, edge) => sum + edge.declarations.length, 0);
  const packageBound = snapshot?.transferredContentDigest === peb.transferDigest;
  const countedEvents = (count: number) => fr
    ? `${count} ${count !== 1 ? "objets de preuve" : "objet de preuve"}`
    : `${count} ${count === 1 ? "evidence object" : "evidence objects"}`;
  const [localPanels, setLocalPanels] = useState<readonly string[]>(["forensic:inventory"]);
  const panels = uiState?.expandedPanels ?? localPanels;
  const panelProps = (key: string) => ({ open: panels.includes(key), "data-panel-key": key, onToggle: (event: SyntheticEvent<HTMLDetailsElement>) => {
    const open = event.currentTarget.open;
    if (panels.includes(key) === open) return;
    const expandedPanels = verifierExpandedPanels(panels, key, open);
    if (onUIStateChange) onUIStateChange({ expandedPanels }); else setLocalPanels(expandedPanels);
  } });
  const signatureFields = (evidence?.fields ?? []).filter((field) => /signature|key|trust|issuer/i.test(field.key));

  return <article className="modular-view modular-forensic-view" data-resolution={resolution.status}>
    <VerifierViewActions locale={locale} currentView="forensic" links={links} />
    <header className="modular-forensic-hero">
      <div><p className="modular-kicker">Forensic</p><h1>{fr ? "Structure et identités techniques" : "Technical structure and identities"}</h1><p>{fr ? "Le seul espace de premier niveau qui expose Manifest, identifiants, empreintes, signatures, confiance et objets bruts." : "The only top-level space exposing the Manifest, identifiers, hashes, signatures, trust, and raw objects."}</p></div>
      <span data-bound={packageBound}>{packageBound ? (fr ? "Analyse liée à ces octets" : "Analysis bound to these bytes") : (fr ? "Preuves reçues · analyse non liée" : "Received evidence · analysis not bound")}</span>
    </header>

    <section className="modular-forensic-package" aria-labelledby="forensic-package-title">
      <div className="modular-section-heading"><div><p className="modular-kicker">PEB</p><h2 id="forensic-package-title">{fr ? "Paquet reçu" : "Received package"}</h2></div><strong>{peb.byteLength.toLocaleString(locale)} {fr ? "octets UTF-8 reçus" : "received UTF-8 bytes"}</strong></div>
      <dl className="modular-technical-grid">
        <div><dt>pebDigest</dt><dd><TechnicalValue>{peb.transferDigest}</TechnicalValue></dd></div>
        <div><dt>profile</dt><dd><TechnicalValue>{peb.profile}</TechnicalValue></dd></div>
        <div><dt>bundleId</dt><dd><TechnicalValue>{peb.bundleId}</TechnicalValue></dd></div>
        <div><dt>identity.missionId</dt><dd><TechnicalValue>{peb.identity.missionId}</TechnicalValue></dd></div>
        <div><dt>identity.runId</dt><dd><TechnicalValue>{peb.identity.runId}</TechnicalValue></dd></div>
        <div><dt>manifest.bundleDigest</dt><dd><TechnicalValue>{peb.manifestDigest}</TechnicalValue></dd></div>
        <div><dt>{fr ? "manifest.memberRefs.length · membres reçus" : "manifest.memberRefs.length · received members"}</dt><dd><TechnicalValue>{peb.memberCount}</TechnicalValue></dd></div>
        <div><dt>finalReceipt.receiptId</dt><dd><TechnicalValue>{peb.finalReceiptId}</TechnicalValue></dd></div>
      </dl>
      <details {...panelProps("forensic:package-bytes")}><summary>{fr ? "Afficher les octets UTF-8 reçus" : "Show received UTF-8 bytes"}</summary><pre>{text}</pre></details>
    </section>

    {resolution.status !== "EMPTY" && resolution.status !== "RESOLVED" && <aside className="modular-forensic-alert" role="status">
      <strong>{fr ? "Sélection non résolue" : "Unresolved selection"}</strong>
      <p>{resolution.status === "AMBIGUOUS" ? (fr ? "Plusieurs membres portent l’identifiant demandé." : "Several members carry the requested identifier.") : resolution.status === "CONTRADICTORY" ? (fr ? "Les identifiants demandés désignent des membres différents." : "The requested identifiers identify different members.") : (fr ? "Aucun membre ne correspond à la sélection." : "No member matches the selection.")}</p>
      {resolution.issues.length > 0 && <ul>{resolution.issues.map((issue) => <li key={issue}><code>{issue}</code></li>)}</ul>}
    </aside>}
    {resolution.status === "EMPTY" && <p role="status">{fr ? "Aucun objet n’est sélectionné. Ouvrez une preuve depuis l’événement ou choisissez un membre dans l’inventaire ci-dessous." : "No object is selected. Open evidence from an event or choose a member in the inventory below."}</p>}
    {resolution.status === "RESOLVED" && !selected && <p role="status">{fr ? "Ce filtre contient plusieurs objets de preuve. Choisissez un membre de l’inventaire pour afficher sa structure complète." : "This filter contains multiple evidence objects. Choose an inventory member to show its complete structure."}</p>}

    {selected && <section className="modular-forensic-object" aria-labelledby="forensic-object-title">
      <div className="modular-section-heading"><div><p className="modular-kicker">{selected.node.member ? (fr ? `M${String(selected.node.member.index + 1).padStart(2, "0")} · membre ${selected.node.member.index + 1} sur ${peb.memberCount ?? catalog.entries.length}` : `M${String(selected.node.member.index + 1).padStart(2, "0")} · member ${selected.node.member.index + 1} of ${peb.memberCount ?? catalog.entries.length}`) : (fr ? "Reçu final" : "Final Receipt")}</p><h2 id="forensic-object-title">{selected.eventLabel}</h2></div><span>{selected.receipt.kind}</span></div>
      <FactProvenanceBadge provenance={selected.provenance} locale={locale} />
      <dl className="modular-technical-grid">
        <div><dt>{selected.node.member ? "memberRef path" : "object path"}</dt><dd><TechnicalValue>{selected.node.fieldPath}</TechnicalValue></dd></div>
        <div><dt>evidenceId</dt><dd><TechnicalValue>{selected.evidenceId}</TechnicalValue></dd></div>
        <div><dt>receiptId</dt><dd><TechnicalValue>{selected.node.final ? selected.evidenceId : selected.node.member?.receiptId}</TechnicalValue></dd></div>
        <div><dt>eventId</dt><dd><TechnicalValue>{selected.eventId}</TechnicalValue></dd></div>
        <div><dt>digest</dt><dd><TechnicalValue>{selected.node.member?.digest}</TechnicalValue></dd></div>
        <div><dt>producerDomain</dt><dd><TechnicalValue>{selected.domainId}</TechnicalValue></dd></div>
        <div><dt>source</dt><dd><TechnicalValue>{selected.node.member?.source}</TechnicalValue></dd></div>
        <div><dt>presentation</dt><dd><TechnicalValue>{selected.node.member?.presentation}</TechnicalValue></dd></div>
        <div><dt>assurance</dt><dd><TechnicalValue>{selected.node.member?.assurance}</TechnicalValue></dd></div>
        <div><dt>{fr ? "timeMs · millisecondes de mission déclarées" : "timeMs · declared mission milliseconds"}</dt><dd><TechnicalValue>{selected.node.member?.timeMs === null || selected.node.member?.timeMs === undefined ? null : `${selected.node.member.timeMs} ms`}</TechnicalValue></dd></div>
        <div><dt>sourceResolution</dt><dd><TechnicalValue>{evidence?.status}</TechnicalValue></dd></div>
        <div><dt>sourcePath</dt><dd><TechnicalValue>{evidence?.sourcePath}</TechnicalValue></dd></div>
      </dl>

      <div className="modular-forensic-columns">
        <section><h3>{fr ? "Signature et confiance" : "Signature and trust"}</h3><dl>
          <div><dt>{fr ? "Couverture" : "Coverage"}</dt><dd><TechnicalValue>{coverage.signature}</TechnicalValue></dd></div>
          <div><dt>finalReceiptInput</dt><dd><TechnicalValue>{coverage.finalReceiptInput === null ? null : String(coverage.finalReceiptInput)}</TechnicalValue></dd></div>
          {signatureFields.map((field) => <div key={field.path}><dt>{field.key}</dt><dd><TechnicalValue>{field.value}</TechnicalValue><small>{field.path}</small></dd></div>)}
        </dl>{signatureFields.length === 0 && <p>{fr ? "Aucun champ de signature ou de confiance n’est disponible dans l’objet source résolu. Cette absence ne constitue pas un résultat de vérification." : "No signature or trust field is available in the resolved source object. This absence is not a verification result."}</p>}<p>{coverage.signature === "BUNDLE_CHECK_PASSED" ? (fr ? "Le contrôle global du sous-bundle a réussi ; aucun résultat individuel n’est déduit." : "The aggregate sub-bundle check passed; no individual result is inferred.") : (fr ? "Aucun résultat de signature individuel n’est établi par cette vue." : "This view establishes no individual signature result.")}</p></section>
        <section><h3>{fr ? "Positions et voisinage" : "Positions and neighbourhood"}</h3><dl>
          <div><dt>{fr ? "Position dans le Manifest" : "Position in Manifest"}</dt><dd><TechnicalValue>{selected.manifestPosition === null ? null : (fr ? `${selected.manifestPosition} sur ${peb.memberCount ?? catalog.entries.length} membres` : `${selected.manifestPosition} of ${peb.memberCount ?? catalog.entries.length} members`)}</TechnicalValue></dd></div>
          <div><dt>{fr ? "Position dans la Timeline" : "Position in Timeline"}</dt><dd><TechnicalValue>{selected.timelinePosition === null ? (fr ? "Non applicable : cet objet ne fait pas partie de l’histoire" : "Not applicable: this object is outside the story") : (fr ? `${selected.timelinePosition} sur ${selected.timelineLength} éléments` : `${selected.timelinePosition} of ${selected.timelineLength} items`)}</TechnicalValue></dd></div>
          <div><dt>{fr ? "Famille" : "Family"}</dt><dd><TechnicalValue>{selected.family}</TechnicalValue></dd></div>
          <div><dt>{fr ? "Parents causaux directs" : "Direct causal parents"}</dt><dd><TechnicalValue>{countedEvents(selected.causalParentNodeKeys.length)}</TechnicalValue></dd></div>
          <div><dt>{fr ? "Enfants causaux directs" : "Direct causal children"}</dt><dd><TechnicalValue>{countedEvents(selected.causalChildNodeKeys.length)}</TechnicalValue></dd></div>
          <div><dt>{fr ? "Entrées observées" : "Observed inputs"}</dt><dd><TechnicalValue>{countedEvents(selected.observedInputNodeKeys.length)}</TechnicalValue></dd></div>
        </dl></section>
      </div>

      {(evidence?.fields.length ?? 0) > 0 ? <details {...panelProps(`forensic:structured:${selected.nodeKey}`)}><summary>{fr ? `Payload · ${evidence!.fields.length} champs structurés` : `Payload · ${evidence!.fields.length} structured fields`}</summary><div className="modular-forensic-fields"><dl>{evidence!.fields.map((field) => <div key={field.path}><dt>{field.key}</dt><dd><TechnicalValue>{field.value}</TechnicalValue><small>{field.path}</small></dd></div>)}</dl></div></details> : <p>{fr ? "Aucun champ structuré n’est disponible pour cet objet source." : "No structured field is available for this source object."}</p>}
      {memberRef !== null ? <details {...panelProps(`forensic:member:${selected.nodeKey}`)}><summary>memberRef · {selected.node.fieldPath}</summary><pre>{JSON.stringify(memberRef, null, 2)}</pre></details> : <p>{fr ? "Aucune entrée memberRef n’est disponible pour cet objet." : "No memberRef entry is available for this object."}</p>}
      {evidence?.raw !== null && evidence?.raw !== undefined ? <details {...panelProps(`forensic:source:${selected.nodeKey}`)}><summary>{fr ? "Objet source brut" : "Raw source object"} · {evidence.sourcePath}</summary><pre>{JSON.stringify(evidence.raw, null, 2)}</pre></details> : <p role="status">{fr ? "L’objet source brut est absent ou ne peut pas être résolu sans ambiguïté dans les octets reçus." : "The raw source object is absent or cannot be resolved unambiguously in the received bytes."}</p>}

      <details {...panelProps(`forensic:relations:${selected.nodeKey}`)}><summary>{fr
        ? `${touchingEdges.length} ${touchingEdges.length !== 1 ? "liens reçus touchent" : "lien reçu touche"} cet objet · ${touchingDeclarations} ${touchingDeclarations !== 1 ? "déclarations" : "déclaration"}`
        : `${touchingEdges.length} received ${touchingEdges.length === 1 ? "link touches" : "links touch"} this object · ${touchingDeclarations} ${touchingDeclarations === 1 ? "declaration" : "declarations"}`}</summary>
        {touchingEdges.length === 0 && <p>{fr ? "Aucun lien reçu ne touche cet objet. Aucun voisin n’est ajouté par la présentation." : "No received link touches this object. The presentation adds no neighbour."}</p>}<ol className="modular-forensic-relations">{touchingEdges.map((edge) => {
          const before = catalogEntryByNodeKey(catalog, edge.from);
          const after = catalogEntryByNodeKey(catalog, edge.to);
          return <li key={edge.key}><p><TechnicalValue>{before?.evidenceId}</TechnicalValue><span aria-hidden="true"> → </span><TechnicalValue>{after?.evidenceId}</TechnicalValue></p><ul>{edge.declarations.map((declaration) => <li key={declaration.path}><TechnicalValue>{declaration.kind}</TechnicalValue><small>{declaration.path}</small></li>)}</ul></li>;
        })}</ol>
      </details>
    </section>}

    <section className="modular-forensic-inventory" aria-labelledby="forensic-inventory-title">
      <div className="modular-section-heading"><div><p className="modular-kicker">Manifest</p><h2 id="forensic-inventory-title">memberRefs</h2></div><strong>{fr ? `${catalog.entries.length} membres reçus` : `${catalog.entries.length} received members`}</strong></div>
      <details {...panelProps("forensic:inventory")}><summary>{fr ? "Afficher l’inventaire complet des membres reçus" : "Show the complete received member inventory"}</summary>
      {catalog.entries.length === 0 && <p role="status">{fr ? "Aucun membre ne peut être projeté depuis le Manifest reçu." : "No member can be projected from the received Manifest."}</p>}
      <div className="modular-forensic-table-scroll"><table><thead><tr><th>Mxx</th><th>eventId</th><th>receiptId</th><th>evidenceId</th><th>source</th><th>{fr ? "Action" : "Action"}</th></tr></thead><tbody>{catalog.entries.map((entry) => {
        // Inspect opens the human reading of this unit (event, else its NanoReceipt card), never this same table.
        const entryLinks = linksForEntry?.(entry);
        const inspectHref = entry.timelinePosition !== null ? entryLinks?.event ?? entryLinks?.nanoreceipts : entryLinks?.nanoreceipts;
        return <tr key={entry.nodeKey} data-selected={entry.nodeKey === selected?.nodeKey}><td><code>{entry.node.member ? `M${String(entry.node.member.index + 1).padStart(2, "0")}` : "FR"}</code></td><td><code>{entry.eventId ?? "—"}</code></td><td><code>{entry.node.member?.receiptId ?? "—"}</code></td><td><code>{entry.evidenceId ?? "—"}</code></td><td><code>{entry.node.member?.source ?? "—"}</code></td><td>{inspectHref ? <a href={inspectHref} data-forensic-inspect onClick={() => onSelectEntry?.(entry)}>{fr ? "Inspecter" : "Inspect"}</a> : <span data-forensic-inspect-unavailable>{fr ? "Indisponible : aucune vue de lecture ne résout cette unité (identité absente ou ambiguë)." : "Unavailable: no reading view resolves this unit (missing or ambiguous identity)."}</span>}</td></tr>;
      })}</tbody></table></div></details>
    </section>
  </article>;
}

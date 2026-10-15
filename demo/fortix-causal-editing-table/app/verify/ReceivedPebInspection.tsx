"use client";

import { useMemo } from "react";
import type { GraphInspectionNavigation } from "./graphHandoff.ts";
import type { D006VerdictSnapshot } from "../offlineVerification.ts";
import { inspectReceivedPeb } from "./inspectReceivedPeb.ts";
import { ReceivedCausalInspection } from "./ReceivedCausalInspection";
import type { EvidenceSelection } from "./guidedInspection.ts";
import type { GraphMode } from "./graphDisplay.ts";
import type { VerifierPresentationProps } from "./verifierPresentation.ts";
import type { FactInspectorSupport } from "./FactInspector.tsx";

const copy = {
  en: {
    title: "Inspect the received PEB", before: "These are declarations read from the received file, not verified claims. Analyze remains a separate action.",
    after: "This is the received package associated with the analysis on this page. Fields remain declarations; the verdict identifies what the checks establish.",
    unreadable: "This text cannot be read as a JSON object. Its exact fingerprint and received text remain inspectable.",
    unsupported: "The declared profile is not the supported D-006 PEB profile. Displaying fields does not establish schema validity or completeness.",
    missing: "Not available", fingerprint: "Received text fingerprint · BLAKE3", fingerprintNote: "Computed from the exact received UTF-8 text. This identifies bytes; it does not establish their origin or validity.",
    profile: "Declared profile", bundle: "Declared package ID", mission: "Declared Mission ID", run: "Declared Run ID", bytes: "Received UTF-8 bytes", manifest: "Declared manifest digest",
    receipt: "Final Receipt in the file", receiptId: "Declared Receipt ID", event: "Declared event ID", evidenceSet: "Declared evidence-set digest", time: "Declared mission time · ms",
    members: "Declared manifest members", memberNote: "Every manifest entry is listed, including unsupported entries. The list is not a completeness finding.",
    source: "Declared source", producer: "Declared producer domain", digest: "Declared member digest", presentation: "Declared presentation", assurance: "Declared assurance",
    relations: "Explicit relations in the received fields", relationNote: "Only the file’s causalParents, observedInputs and Final Receipt inputs appear here. Identifier presence does not prove causality, authenticity or closure. No edges are inferred from time or visual proximity.",
    kind: "Declared relation", from: "Referenced evidence", to: "Declaring evidence", presence: "Identifier lookup", path: "Field path", none: "No explicit relations are present in these fields.",
    CAUSAL_PARENT: "Causal parent", OBSERVED_INPUT: "Observed input", FINAL_RECEIPT_INPUT: "Final Receipt input",
    PRESENT: "Present once", UNRESOLVED: "Unresolved", AMBIGUOUS: "Ambiguous ID", unresolved: "unresolved or ambiguous references",
    issues: "Missing or unsupported structure", issueNote: "These locations need attention. This display check is not a verifier verdict; consult the exact file below.", raw: "Exact received text",
  },
  fr: {
    title: "Inspecter le PEB reçu", before: "Ces informations sont des déclarations lues dans le fichier reçu, pas des faits vérifiés. Analyser reste une action distincte.",
    after: "Ce paquet reçu est associé à l’analyse présentée sur cette page. Ses champs restent des déclarations ; le verdict indique ce que les contrôles établissent.",
    unreadable: "Ce texte ne peut pas être lu comme un objet JSON. Son empreinte exacte et le texte reçu restent consultables.",
    unsupported: "Le profil déclaré n’est pas le profil PEB D-006 pris en charge. Afficher des champs n’établit ni la validité du schéma ni son exhaustivité.",
    missing: "Non disponible", fingerprint: "Empreinte du texte reçu · BLAKE3", fingerprintNote: "Calculée sur le texte UTF-8 exact reçu. Elle identifie des octets ; elle n’établit ni leur origine ni leur validité.",
    profile: "Profil déclaré", bundle: "Identifiant déclaré du paquet", mission: "Mission ID déclaré", run: "Run ID déclaré", bytes: "Octets UTF-8 reçus", manifest: "Empreinte déclarée du manifeste",
    receipt: "Reçu final dans le fichier", receiptId: "Identifiant déclaré du reçu", event: "Identifiant déclaré de l’événement", evidenceSet: "Empreinte déclarée de l’ensemble de preuves", time: "Temps de mission déclaré · ms",
    members: "Membres déclarés du manifeste", memberNote: "Chaque entrée du manifeste figure ici, y compris les entrées non prises en charge. Cette liste n’établit pas l’exhaustivité.",
    source: "Source déclarée", producer: "Domaine producteur déclaré", digest: "Empreinte déclarée du membre", presentation: "Présentation déclarée", assurance: "Assurance déclarée",
    relations: "Relations explicites dans les champs reçus", relationNote: "Seuls causalParents, observedInputs et les entrées du reçu final du fichier figurent ici. La présence d’un identifiant ne prouve ni causalité, ni authenticité, ni clôture. Aucun lien n’est déduit du temps ou de la proximité visuelle.",
    kind: "Relation déclarée", from: "Preuve référencée", to: "Preuve déclarante", presence: "Recherche de l’identifiant", path: "Chemin du champ", none: "Aucune relation explicite n’est présente dans ces champs.",
    CAUSAL_PARENT: "Parent causal", OBSERVED_INPUT: "Entrée observée", FINAL_RECEIPT_INPUT: "Entrée du reçu final",
    PRESENT: "Présent une fois", UNRESOLVED: "Non résolu", AMBIGUOUS: "Identifiant ambigu", unresolved: "références non résolues ou ambiguës",
    issues: "Structure manquante ou non prise en charge", issueNote: "Ces emplacements demandent une attention. Ce contrôle d’affichage n’est pas un verdict du vérificateur ; consultez le fichier exact ci-dessous.", raw: "Texte exact reçu",
  },
} as const;

export function ReceivedPebInspection({ text, locale, analyzed: wasAnalyzed, snapshot, view, onNavigate, selection, onSelectionChange, onContextBack, selectedDomainId, onOpenDomain, graphMode, onGraphModeChange, followToFinal, onFollowToFinalChange, onOpenEvidence, onOpenForensic, returnLabel, factSupport, condensed = false, ...graphNavigation }: GraphInspectionNavigation & VerifierPresentationProps & { factSupport?: FactInspectorSupport; condensed?: boolean; text: string; locale: "en" | "fr"; analyzed: boolean; snapshot?: D006VerdictSnapshot | null; view?: "structure" | "path" | "domains" | "graph" | "receipts" | "trust"; onNavigate?: (view: "path" | "domains" | "graph") => void; selection?: EvidenceSelection; onSelectionChange?: (selection: EvidenceSelection) => void; onContextBack?: () => void; selectedDomainId?: string | null; onOpenDomain?: (domainId: string) => void; graphMode?: GraphMode; onGraphModeChange?: (mode: GraphMode) => void; followToFinal?: boolean; onFollowToFinalChange?: (value: boolean) => void; onOpenEvidence?: (nodeKey: string | null) => void; onOpenForensic?: (nodeKey: string | null) => void; returnLabel?: string; onBeginContextInspection?: () => void; onReturnToEvent?: () => void; readingNodeKey?: string | null }) {
  const peb = useMemo(() => inspectReceivedPeb(text), [text]);
  const associatedSnapshot = snapshot?.transferredContentDigest === peb.transferDigest ? snapshot : null;
  const analyzed = wasAnalyzed && associatedSnapshot !== null;
  const c = copy[locale];
  const field = (label: string, value: string | number | null) => <div key={label}><dt>{label}</dt><dd><code>{value === null || value === "" ? c.missing : value}</code></dd></div>;
  const unresolved = peb.relations.filter(relation => relation.referenceStatus !== "PRESENT").length;
  return <section className="verifier-package-inspect" data-received-digest={peb.transferDigest} aria-label={c.title}>
    {!view && <h3>{c.title}</h3>}{view !== "graph" && !condensed && <p>{analyzed ? c.after : c.before}</p>}
    {peb.parseStatus !== "OBJECT" ? <p role="status">{c.unreadable}</p> : !peb.knownProfile && <p role="status">{c.unsupported}</p>}
    <ReceivedCausalInspection key={peb.transferDigest} peb={peb} text={text} locale={locale} snapshot={associatedSnapshot} view={view} onNavigate={onNavigate} selection={selection} onSelectionChange={onSelectionChange} onContextBack={onContextBack} selectedDomainId={selectedDomainId} onOpenDomain={onOpenDomain} graphMode={graphMode} onGraphModeChange={onGraphModeChange} followToFinal={followToFinal} onFollowToFinalChange={onFollowToFinalChange} onOpenEvidence={onOpenEvidence} onOpenForensic={onOpenForensic} returnLabel={returnLabel} factSupport={factSupport} condensed={condensed} {...graphNavigation} expertViews={{
      structure: <>    <dl className="verifier-meta">
      {field(c.fingerprint, peb.transferDigest)}{field(c.bytes, peb.byteLength)}
      {field(c.profile, peb.profile)}{field(c.bundle, peb.bundleId)}
      {field(c.mission, peb.identity.missionId)}{field(c.run, peb.identity.runId)}{field(c.manifest, peb.manifestDigest)}
    </dl><p>{c.fingerprintNote}</p>
    {peb.issues.length > 0 && <details className="verifier-package-issues"><summary>{c.issues} · {peb.issues.length}</summary><p>{c.issueNote}</p><ul>{peb.issues.map((issue, index) => <li key={index}><code>{issue}</code></li>)}</ul></details>}
    <details className="verifier-raw"><summary>{c.raw}</summary><pre>{text}</pre></details></>,
      receipts: <>    <details className="verifier-receipt"><summary>{c.receipt} · <code>{peb.finalReceiptId ?? c.missing}</code></summary>
      {peb.finalReceipt ? <dl className="verifier-meta">
        {field(c.receiptId, peb.finalReceipt.receiptId)}{field(c.profile, peb.finalReceipt.profile)}{field(c.event, peb.finalReceipt.eventId)}
        {field(c.mission, peb.finalReceipt.missionId)}{field(c.run, peb.finalReceipt.runId)}
        {field(c.evidenceSet, peb.finalReceipt.evidenceSetDigest)}{field(c.time, peb.finalReceipt.issuedAtMasterTimeMs)}
      </dl> : <p>{c.missing}</p>}
    </details>
    <details className="verifier-members"><summary>{c.members} · {peb.memberCount ?? c.missing}</summary><p>{c.memberNote}</p>
      <ol>{peb.members.map(member => <li key={member.index}><details><summary><code>{member.evidenceId || c.missing}</code></summary>
        <dl className="verifier-meta">{field(c.receiptId, member.receiptId)}{field(c.event, member.eventId)}{field(c.digest, member.digest)}
          {field(c.producer, member.producerDomain)}{field(c.source, member.source)}{field(c.presentation, member.presentation)}
          {field(c.assurance, member.assurance)}{field(c.time, member.timeMs)}</dl>
      </details></li>)}</ol>
    </details>
</>,
      flow: <>    <details className="verifier-causal-table"><summary>{c.relations} · {peb.relations.length} · {unresolved} {c.unresolved}</summary>
      <p>{c.relationNote}</p>{peb.relations.length ? <div className="verifier-table-scroll"><table><thead><tr>
        <th scope="col">{c.kind}</th><th scope="col">{c.from}</th><th scope="col">{c.to}</th><th scope="col">{c.presence}</th><th scope="col">{c.path}</th>
      </tr></thead><tbody>{peb.relations.map(relation => <tr key={relation.path} data-reference-status={relation.referenceStatus}>
        <th scope="row">{c[relation.kind]}</th><td><code>{relation.from ?? c.missing}</code></td><td><code>{relation.to ?? c.missing}</code></td>
        <td>{c[relation.referenceStatus]}</td><td><code>{relation.path}</code></td>
      </tr>)}</tbody></table></div> : <p>{c.none}</p>}
    </details>
</>,
      trust: <><p>{locale === "fr" ? "Les producteurs, sources et niveaux d’assurance ci-dessous sont déclarés par le PEB. Leur présence ne constitue pas une validation de confiance." : "The producers, sources and assurance levels below are declared by the PEB. Their presence does not establish trust."}</p><div className="verifier-table-scroll"><table className="received-trust-table"><thead><tr><th>{c.event}</th><th>{c.producer}</th><th>{c.source}</th><th>{c.assurance}</th></tr></thead><tbody>{peb.members.map(member => <tr key={member.index}><td><code>{member.eventId ?? member.evidenceId ?? c.missing}</code></td><td>{member.producerDomain ?? c.missing}</td><td>{member.source ?? c.missing}</td><td>{member.assurance ?? c.missing}</td></tr>)}</tbody></table></div></>,
    }} />
  </section>;
}

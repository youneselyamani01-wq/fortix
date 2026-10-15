"use client";

import type { ReactNode } from "react";
import { declaredMissionTime } from "./guidedInspection.ts";
import { receivedProducerLabel } from "./receivedLabels.ts";
import type { ReceivedEvidenceCatalog, ReceivedEvidenceCatalogEntry } from "./receivedEvidenceCatalog.ts";
import {
  networkDuration, networkTransitionOf, offlinePeriodOf, reconciliationPeriodOf,
  type LaneSegment, type OfflinePeriod, type ReceivedNetworkModel, type ReceivedNetworkTransition, type ReceivedReconciliationReceipt, type ReconciliationStatus,
} from "./receivedNetwork.ts";
import type { VerifierView } from "./verifierRoutes.ts";
import "./network-view.css";

type Locale = "en" | "fr";
type EntryLinks = (entry: ReceivedEvidenceCatalogEntry) => Partial<Record<VerifierView, string>>;

const stateLabel = (value: string, locale: Locale) => value === "UNDECLARED" ? (locale === "fr" ? "NON DÉCLARÉ" : "NOT DECLARED") : value;

export function networkTransitionTitle(kind: ReceivedNetworkTransition["kind"], locale: Locale): string {
  return kind === "LOST" ? (locale === "fr" ? "Réseau perdu" : "Network lost") : (locale === "fr" ? "Réseau rétabli" : "Network restored");
}

export function networkTransitionSubtitle(kind: ReceivedNetworkTransition["kind"], locale: Locale): string {
  return kind === "LOST"
    ? (locale === "fr" ? "Aucune voie réseau disponible. La mission poursuit son exécution selon les capacités locales disponibles." : "No network route is available. The mission continues with the local capabilities available.")
    : (locale === "fr" ? "Une voie réseau est de nouveau disponible." : "A network route is available again.");
}

/** One offline period's reconciliation, in human words. RESTORED alone never reads as reconciled. */
export function reconciliationText(status: ReconciliationStatus, locale: Locale): Readonly<{ label: string; reason: string }> {
  const fr = locale === "fr";
  if (status.status === "ESTABLISHED") return {
    label: fr ? "Preuves réconciliées" : "Evidence reconciled",
    reason: fr
      ? "Un reçu de réconciliation nomme la coupure et les objets produits hors ligne ; l’analyse de ce PEB exact l’a lié à ses propres enregistrements. La base est un registre de démonstration du même poste, pas un témoin indépendant."
      : "A reconciliation receipt names the outage and the objects produced offline; the analysis of this exact PEB bound it to its own records. The base is a same-machine demonstration ledger, not an independent witness.",
  };
  if (status.status === "DECLARED") return {
    label: fr ? "Réconciliation déclarée, à vérifier" : "Reconciliation declared, to be verified",
    reason: fr
      ? "Un reçu de réconciliation cohérent avec les enregistrements du PEB nomme la coupure, mais aucune analyse de ce PEB exact ne l’a encore confirmé."
      : "A reconciliation receipt consistent with the PEB’s records names the outage, but no analysis of this exact PEB has confirmed it yet.",
  };
  const reasons: Readonly<Record<Exclude<ReconciliationStatus["reason"], "RECEIPT_VERIFIED" | "NOT_ANALYZED">, readonly [string, string]>> = {
    NO_RECONCILIATION_RECORD: ["No reconciliation record is present in this PEB. The network returning does not prove that local evidence was reconciled.", "Aucun enregistrement de réconciliation n’est présent dans ce PEB. Le retour du réseau ne prouve pas que les preuves locales ont été réconciliées."],
    NOT_NAMED_BY_RECEIPT: ["No reconciliation receipt in this PEB names this period: reconciliation of its local evidence is not established.", "Aucun reçu de réconciliation de ce PEB ne nomme cette période : la réconciliation de ses preuves locales n’est pas établie."],
    RECONCILIATION_UNBOUND: ["A reconciliation receipt names this period, but it does not match the records this PEB carries: it establishes nothing.", "Un reçu de réconciliation nomme cette période, mais il ne correspond pas aux enregistrements que ce PEB contient : il n’établit rien."],
    VERIFICATION_FAILED: ["The analysis of this exact PEB does not confirm the reconciliation receipt.", "L’analyse de ce PEB exact ne confirme pas le reçu de réconciliation."],
  };
  const reason = status.reason === "RECEIPT_VERIFIED" || status.reason === "NOT_ANALYZED" ? "NO_RECONCILIATION_RECORD" : status.reason;
  return {
    label: fr ? "Réconciliation non établie" : "Reconciliation not established",
    reason: reasons[reason][fr ? 1 : 0],
  };
}

/** The whole PEB: reconciled only when every offline period is. One period reads as that period. */
export function globalReconciliationText(model: ReceivedNetworkModel, locale: Locale): Readonly<{ label: string; reason: string }> {
  const fr = locale === "fr";
  const own = reconciliationText(model.reconciliation, locale);
  if (model.periods.length <= 1) return own;
  if (model.reconciliation.status === "ESTABLISHED") return { label: own.label, reason: fr
    ? "Chaque période hors ligne de ce PEB est nommée par un reçu de réconciliation que l’analyse de ce PEB exact a lié à ses propres enregistrements. La base est un registre de démonstration du même poste, pas un témoin indépendant."
    : "Every offline period of this PEB is named by a reconciliation receipt that the analysis of this exact PEB bound to its own records. The base is a same-machine demonstration ledger, not an independent witness." };
  if (model.reconciliation.status === "DECLARED") return { label: own.label, reason: fr
    ? "Chaque période hors ligne est nommée par un reçu cohérent avec les enregistrements du PEB, mais aucune analyse de ce PEB exact ne l’a encore confirmé."
    : "Every offline period is named by a receipt consistent with the PEB’s records, but no analysis of this exact PEB has confirmed it yet." };
  return { label: own.label, reason: fr
    ? "Au moins une période hors ligne de ce PEB n’est pas réconciliée : chaque période indique pourquoi."
    : "At least one offline period of this PEB is not reconciled: each period states why." };
}

/** What a bound receipt declares, for the technical disclosure only. */
function ReconciliationReceiptRows({ receipt, locale }: Readonly<{ receipt: ReceivedReconciliationReceipt; locale: Locale }>) {
  const fr = locale === "fr";
  return <>
    <div><dt>{fr ? "Reçu de réconciliation" : "Reconciliation receipt"}</dt><dd><code>{receipt.receiptId}</code></dd></div>
    {receipt.operationId && <div><dt>{fr ? "Opération" : "Operation"}</dt><dd><code>{receipt.operationId}</code></dd></div>}
    <div><dt>{fr ? "Objets produits hors ligne" : "Objects produced offline"}</dt><dd>{receipt.offlineObjectIds.length}</dd></div>
    <div><dt>{fr ? "Objets transférés vers la base" : "Objects transferred to the base"}</dt><dd>{receipt.transferredObjectIds.length}</dd></div>
    {receipt.baseBeforeDigest && <div><dt>{fr ? "Empreinte de la base avant" : "Base digest before"}</dt><dd><code>{receipt.baseBeforeDigest}</code></dd></div>}
    {receipt.baseAfterDigest && <div><dt>{fr ? "Empreinte de la base après" : "Base digest after"}</dt><dd><code>{receipt.baseAfterDigest}</code></dd></div>}
    {receipt.digestComparison && <div><dt>{fr ? "Comparaison des empreintes" : "Digest comparison"}</dt><dd>{receipt.digestComparison}</dd></div>}
  </>;
}

function periodDuration(period: OfflinePeriod, locale: Locale): string {
  const fr = locale === "fr";
  if (period.durationMs !== null) return networkDuration(period.durationMs, locale);
  return period.minimumDurationMs !== null
    ? (fr ? `Au moins ${networkDuration(period.minimumDurationMs, locale)}, jusqu’au dernier fait déclaré` : `At least ${networkDuration(period.minimumDurationMs, locale)}, up to the last declared fact`)
    : (fr ? "Non établie" : "Not established");
}

function Segments({ segments, markers, model, locale, selectedNodeKey, linksForEntry, onSelectEntry, targetView }: Readonly<{
  segments: readonly LaneSegment[]; markers?: ReceivedNetworkModel["lanes"]["markers"]; model: ReceivedNetworkModel; locale: Locale;
  selectedNodeKey?: string | null; linksForEntry?: EntryLinks; onSelectEntry?: (entry: ReceivedEvidenceCatalogEntry) => void; targetView?: VerifierView;
}>) {
  const span = Math.max(1, (model.missionEndMs ?? 0) - (model.missionStartMs ?? 0));
  const items: ReactNode[] = [];
  segments.forEach((segment, index) => {
    const marker = index > 0 ? markers?.find(item => item.timeMs === segment.fromMs) : undefined;
    if (marker) {
      const markerLinks = linksForEntry?.(marker.entry);
      const href = (targetView ? markerLinks?.[targetView] : undefined) ?? markerLinks?.event ?? markerLinks?.nanoreceipts;
      const label = <><span className="network-marker-dot" aria-hidden="true">●</span><strong>{marker.kind === "LOST" ? "LOST" : "RESTORED"}</strong><time>{declaredMissionTime(marker.timeMs, locale)}</time></>;
      items.push(href
        ? <a key={`m${index}`} className="network-marker" data-marker={marker.kind} aria-current={marker.entry.nodeKey === selectedNodeKey ? "true" : undefined} href={href} onClick={() => onSelectEntry?.(marker.entry)} title={networkTransitionTitle(marker.kind, locale)}>{label}</a>
        : <span key={`m${index}`} className="network-marker" data-marker={marker.kind} aria-current={marker.entry.nodeKey === selectedNodeKey ? "true" : undefined}>{label}</span>);
    }
    const share = (segment.toMs - segment.fromMs) / span;
    items.push(<span key={`s${index}`} className="network-segment" data-state={segment.value} style={{ flexGrow: Math.max(share * 100, 0.0001) }}>{stateLabel(segment.value, locale)}</span>);
  });
  return <div className="network-lane-track">{items}</div>;
}

/** Network lane (and optionally execution/evidence lanes), synchronised with the selected fact. */
export function NetworkLanes({ model, locale, selectedNodeKey = null, linksForEntry, onSelectEntry, all = false, networkHref, targetView }: Readonly<{
  model: ReceivedNetworkModel; locale: Locale; selectedNodeKey?: string | null; linksForEntry?: EntryLinks;
  onSelectEntry?: (entry: ReceivedEvidenceCatalogEntry) => void; all?: boolean; networkHref?: string;
  /** The view a lane marker selects its fact in; the event view when absent. */
  targetView?: VerifierView;
}>) {
  const fr = locale === "fr";
  if (!model.transitions.length) return null;
  const selectedTransition = networkTransitionOf(model, selectedNodeKey);
  const reconciledPeriod = reconciliationPeriodOf(model, selectedNodeKey);
  const selectedPeriod = offlinePeriodOf(model, selectedNodeKey) ?? reconciledPeriod;
  const coverage = (value: { declared: number; total: number }) => fr ? `déclaré par ${value.declared} enregistrements sur ${value.total} faits datés` : `declared by ${value.declared} records of ${value.total} dated facts`;
  const position = reconciledPeriod
    ? (fr ? `Le reçu de réconciliation sélectionné nomme la période hors ligne n°${reconciledPeriod.index}.` : `The selected reconciliation receipt names offline period ${reconciledPeriod.index}.`)
    : selectedNodeKey && !selectedTransition
    ? selectedPeriod
      ? (fr ? `Le fait sélectionné se situe pendant la période hors ligne n°${selectedPeriod.index} : contexte temporel, pas un lien causal.` : `The selected fact falls within offline period ${selectedPeriod.index}: temporal context, not a causal link.`)
      : (fr ? "Le fait sélectionné se situe hors de toute période hors ligne déclarée." : "The selected fact falls outside every declared offline period.")
    : selectedTransition
      ? (fr ? `${networkTransitionTitle(selectedTransition.kind, locale)} est sélectionné · période hors ligne n°${selectedPeriod?.index ?? "—"} mise en évidence.` : `${networkTransitionTitle(selectedTransition.kind, locale)} is selected · offline period ${selectedPeriod?.index ?? "—"} highlighted.`)
      : null;
  const props = { model, locale, selectedNodeKey, linksForEntry, onSelectEntry, targetView };
  return <section className="network-lanes" data-all={all} data-selected-period={selectedPeriod?.index ?? undefined} aria-label={fr ? "États réseau, exécution et preuves" : "Network, execution and evidence states"}>
    <div className="network-lane" data-lane="network">
      <h3>{fr ? "Réseau" : "Network"}</h3>
      <Segments segments={model.lanes.network} markers={model.lanes.markers} {...props} />
    </div>
    {all && <>
      <div className="network-lane" data-lane="execution"><h3>{fr ? "Exécution" : "Execution"}</h3>
        {model.lanes.execution.length ? <Segments segments={model.lanes.execution} {...props} /> : <p className="network-lane-empty">{fr ? "Lieu d’exécution non déclaré" : "Execution locality not declared"}</p>}
        <small>{coverage(model.lanes.executionCoverage)}</small></div>
      <div className="network-lane" data-lane="evidence"><h3>{fr ? "Évidence" : "Evidence"}</h3>
        {model.lanes.evidence.length ? <Segments segments={model.lanes.evidence} {...props} /> : <p className="network-lane-empty">{fr ? "État de la preuve non déclaré" : "Evidence state not declared"}</p>}
        <small>{coverage(model.lanes.evidenceCoverage)}</small></div>
      <p className="network-lanes-note">{fr ? "Trois dimensions distinctes : aucune ne se déduit des autres." : "Three separate dimensions: none is inferred from the others."}</p>
    </>}
    <footer>
      {position && <p className="network-position" aria-live="polite">{position}</p>}
      {/* With a period in focus, that period's reconciliation — never another's, never the whole PEB's. */}
      <p className="network-reconciliation" data-status={(selectedPeriod?.reconciliation ?? model.reconciliation).status}>{reconciliationText(selectedPeriod?.reconciliation ?? model.reconciliation, locale).label}</p>
      {networkHref && <a href={networkHref}>{fr ? "Ouvrir la vue Réseau →" : "Open the Network view →"}</a>}
    </footer>
  </section>;
}

/** The provenance explanation of a RUNTIME network transition, shown on demand. */
export function networkRuntimeProvenanceNote(locale: Locale): string {
  return locale === "fr"
    ? "Le runtime déclare avoir observé cette transition. Cette vue ne contient pas de corroboration externe indépendante."
    : "The runtime declares that it observed this transition. This view contains no independent external corroboration.";
}

/** What is specific to a network transition: its meaning, the state change, the
 * route and, for a return, the reconciliation status. Evidence, domain, time and
 * provenance belong to the host (inspector or card) so they are never repeated. */
export function NetworkFactSummary({ model, nodeKey, locale, networkHref, forensicHref, compact = false }: Readonly<{
  model: ReceivedNetworkModel; nodeKey: string | null | undefined; locale: Locale; networkHref?: string; forensicHref?: string; compact?: boolean;
}>) {
  const fr = locale === "fr";
  const transition = networkTransitionOf(model, nodeKey);
  if (!transition) return null;
  const period = offlinePeriodOf(model, nodeKey);
  const entry = transition.entry;
  const reconciliation = reconciliationText(period?.reconciliation ?? model.reconciliation, locale);
  return <section className="network-fact" data-network-kind={transition.kind} data-compact={compact}>
    <p className="network-fact-subtitle">{networkTransitionSubtitle(transition.kind, locale)}</p>
    <dl>
      <div><dt>Transition</dt><dd className="network-transition">{transition.previousState ?? (fr ? "non déclaré" : "not declared")} → {transition.newState ?? (fr ? "non déclaré" : "not declared")}</dd></div>
      {transition.adapter && <div><dt>{fr ? "Voie concernée" : "Route concerned"}</dt><dd>{transition.adapter}</dd></div>}
      {!compact && period && <div><dt>{fr ? "Période hors ligne" : "Offline period"}</dt><dd>{fr ? `n°${period.index}` : `#${period.index}`} · {period.restored ? periodDuration(period, locale) : (fr ? "non rétablie dans le PEB" : "not restored in the PEB")}</dd></div>}
      {transition.kind === "RESTORED" && <div><dt>{fr ? "Réconciliation" : "Reconciliation"}</dt><dd data-reconciliation={period?.reconciliation.status ?? model.reconciliation.status}>{reconciliation.label}{!compact && <small>{reconciliation.reason}</small>}</dd></div>}
    </dl>
    {!compact && <details className="network-fact-technical">
      <summary>{fr ? "Détails techniques" : "Technical details"}</summary>
      <dl>
        {transition.observationSource && <div><dt>{fr ? "Source d’observation" : "Observation source"}</dt><dd><code>{transition.observationSource}</code></dd></div>}
        <div><dt>{fr ? "Lieu d’exécution déclaré" : "Declared execution locality"}</dt><dd>{transition.executionLocality ?? (fr ? "Non déclaré" : "Not declared")}</dd></div>
        <div><dt>{fr ? "État de la preuve déclaré" : "Declared evidence state"}</dt><dd>{transition.evidenceLocality ?? (fr ? "Non déclaré" : "Not declared")}</dd></div>
        {entry.nanoReceiptId && <div><dt>NanoReceipt</dt><dd><code>{entry.nanoReceiptId}</code></dd></div>}
        {transition.kind === "RESTORED" && period?.reconciliation.receipt && <ReconciliationReceiptRows receipt={period.reconciliation.receipt} locale={locale} />}
      </dl>
      {forensicHref && <a href={forensicHref}>{fr ? "Ouvrir Forensic →" : "Open Forensic →"}</a>}
    </details>}
    {networkHref && <a className="network-fact-link" href={networkHref}>{fr ? "Voir la période dans la vue Réseau →" : "See the period in the Network view →"}</a>}
  </section>;
}

function causalNames(keys: readonly string[], catalog: ReceivedEvidenceCatalog, locale: Locale): string {
  const names = keys.map(key => catalog.entries.find(entry => entry.nodeKey === key)?.eventLabel).filter((name): name is string => !!name);
  return names.length ? names.join(" · ") : (locale === "fr" ? "aucun" : "none");
}

export function NetworkView({ model, catalog, locale, selectedNodeKey = null, linksForEntry, onSelectEntry, inspector }: Readonly<{
  model: ReceivedNetworkModel; catalog: ReceivedEvidenceCatalog; locale: Locale; selectedNodeKey?: string | null;
  linksForEntry: EntryLinks; onSelectEntry?: (entry: ReceivedEvidenceCatalogEntry) => void;
  /** The shared fact inspector for the fact selected in this view. */
  inspector?: ReactNode;
}>) {
  const fr = locale === "fr";
  const entryLink = (entry: ReceivedEvidenceCatalogEntry, label: string) => {
    const href = linksForEntry(entry).network ?? linksForEntry(entry).event ?? linksForEntry(entry).nanoreceipts;
    return href ? <a href={href} onClick={() => onSelectEntry?.(entry)}>{label}</a> : <strong>{label}</strong>;
  };
  if (!model.transitions.length) return <article className="network-view" data-network-status="NONE">
    <section className="network-current"><h2>{fr ? "Aucune transition réseau déclarée" : "No network transition declared"}</h2>
      <p>{fr ? "Ce PEB ne contient aucun NanoReceipt de perte ou de retour réseau. Le Vérificateur n’en déduit ni perte ni connexion continue." : "This PEB contains no network loss or restoration NanoReceipt. The Verifier infers neither a loss nor continuous connectivity."}</p></section>
  </article>;
  const selectedPeriod = offlinePeriodOf(model, selectedNodeKey);
  return <article className="network-view" data-network-status={model.finalState ?? "UNDECLARED"}>
    <section className="network-current">
      <div><p className="network-kicker">{fr ? "État réseau à la fin du PEB" : "Network state at the end of the PEB"}</p>
        <h2 data-state={model.finalState ?? "UNDECLARED"}>{stateLabel(model.finalState ?? "UNDECLARED", locale)}</h2>
        <p>{model.finalState === "LOST"
          ? (fr ? "Le dernier état déclaré est une perte : aucun retour réseau n’est déclaré avant la fin de la mission." : "The last declared state is a loss: no network return is declared before the end of the mission.")
          : (fr ? "Déclaré par la dernière transition reçue." : "Declared by the last received transition.")}</p></div>
      <p className="network-reconciliation" data-status={model.reconciliation.status}><strong>{globalReconciliationText(model, locale).label}</strong><span>{globalReconciliationText(model, locale).reason}</span></p>
    </section>

    <NetworkLanes model={model} locale={locale} selectedNodeKey={selectedNodeKey} linksForEntry={linksForEntry} onSelectEntry={onSelectEntry} all targetView="network" />
    {inspector}

    <section className="network-history" aria-labelledby="network-history-title">
      <h2 id="network-history-title">{fr ? "Historique" : "History"}</h2>
      <ol>
        <li data-step="state"><strong>{stateLabel(model.transitions[0]!.previousState ?? "UNDECLARED", locale)}</strong><span>{fr ? "État précédent déclaré par la première transition" : "Previous state declared by the first transition"}</span></li>
        {model.transitions.map(transition => {
          const period = model.periods.find(item => item.lost === transition);
          return [
            <li key={transition.entry.nodeKey} data-step={transition.kind} aria-current={transition.entry.nodeKey === selectedNodeKey ? "true" : undefined}>
              {entryLink(transition.entry, networkTransitionTitle(transition.kind, locale))}
              <span>{declaredMissionTime(transition.timeMs, locale)} · {transition.previousState ?? "?"} → {transition.newState ?? "?"}{transition.adapter ? ` · ${transition.adapter}` : ""}</span>
            </li>,
            period && <li key={`${transition.entry.nodeKey}:period`} data-step="period" data-selected={period === selectedPeriod}>
              <strong>{fr ? `Période hors ligne n°${period.index}` : `Offline period ${period.index}`}</strong><span>{periodDuration(period, locale)}</span>
            </li>,
          ];
        })}
        {model.finalState === "LOST" && <li data-step="open"><strong>{fr ? "Non rétabli dans le PEB" : "Not restored in the PEB"}</strong><span>{fr ? "Aucun retour réseau n’est déclaré. Aucun retour n’est supposé." : "No network return is declared. None is assumed."}</span></li>}
      </ol>
    </section>

    {model.periods.map(period => {
      const reconciliation = reconciliationText(period.reconciliation, locale);
      return <section key={period.index} className="network-period" data-selected={period === selectedPeriod} aria-labelledby={`network-period-${period.index}`}>
        <header><p className="network-kicker">{fr ? "Hors ligne" : "Offline"}</p><h2 id={`network-period-${period.index}`}>{fr ? `Période n°${period.index}` : `Period ${period.index}`} · {periodDuration(period, locale)}</h2></header>
        <dl>
          <div><dt>{fr ? "Début" : "Start"}</dt><dd>{declaredMissionTime(period.startMs, locale)}</dd></div>
          <div><dt>{fr ? "Retour réseau" : "Network return"}</dt><dd>{period.restored ? declaredMissionTime(period.endMs, locale) : (fr ? "Non rétabli avant la fin de la mission" : "Not restored before the end of the mission")}</dd></div>
          <div><dt>{fr ? "Voie perdue" : "Route lost"}</dt><dd>{period.lost.adapter ?? (fr ? "Non déclarée" : "Not declared")}</dd></div>
          {period.restored && <div><dt>{fr ? "Voie de retour" : "Return route"}</dt><dd>{period.restored.adapter ?? (fr ? "Non déclarée" : "Not declared")}</dd></div>}
          <div><dt>{fr ? "Producteur du signal" : "Signal producer"}</dt><dd>{period.lost.entry.domainId ? receivedProducerLabel(period.lost.entry.domainId, locale) : (fr ? "Non déclaré" : "Not declared")}</dd></div>
          <div><dt>{fr ? "Faits déclarés pendant la période" : "Facts declared during the period"}</dt><dd>{period.entries.length}</dd></div>
          <div><dt>{fr ? "Exécution" : "Execution"}</dt><dd>LOCAL {period.execution.LOCAL} · REMOTE {period.execution.REMOTE} · {fr ? "non déclaré" : "not declared"} {period.execution.UNDECLARED}</dd></div>
          <div><dt>{fr ? "Évidence LOCAL" : "LOCAL evidence"}</dt><dd>{period.evidence.LOCAL}</dd></div>
          <div><dt>{fr ? "Évidence RECONCILED" : "RECONCILED evidence"}</dt><dd>{period.evidence.RECONCILED}</dd></div>
          <div><dt>{fr ? "État de la preuve non déclaré" : "Evidence state not declared"}</dt><dd>{period.evidence.UNDECLARED}</dd></div>
          <div><dt>{fr ? "Réconciliation" : "Reconciliation"}</dt><dd data-reconciliation={period.reconciliation.status}><strong>{reconciliation.label}</strong><small>{reconciliation.reason}</small></dd></div>
          {period.reconciledEntryCount !== null && <div><dt>{fr ? "Faits nommés par le reçu de réconciliation" : "Facts named by the reconciliation receipt"}</dt><dd>{period.reconciledEntryCount} / {period.entries.length}<small>{fr ? "Les états de preuve ci-dessus restent ceux déclarés à la production du fait." : "The evidence states above remain those declared when each fact was produced."}</small></dd></div>}
        </dl>
        {period.reconciliation.receipt && <details className="network-fact-technical"><summary>{fr ? "Détails techniques de la réconciliation" : "Reconciliation technical details"}</summary>
          <dl><ReconciliationReceiptRows receipt={period.reconciliation.receipt} locale={locale} /></dl>
        </details>}
        <p className="network-period-note">{fr ? "Ces faits sont situés dans le temps de la coupure. Cela n’en fait pas des conséquences de la perte réseau : seules les relations causales déclarées le peuvent." : "These facts are located within the outage in time. That does not make them consequences of the network loss: only declared causal relations can."}</p>
        {period.entries.length > 0 && <details><summary>{fr ? `Voir les ${period.entries.length} faits de la période` : `See the ${period.entries.length} facts of the period`}</summary>
          <ul>{period.entries.map(entry => <li key={entry.nodeKey}>{entryLink(entry, entry.eventLabel)}<span>{declaredMissionTime(entry.node.member?.timeMs ?? null, locale)}</span></li>)}</ul>
        </details>}
      </section>;
    })}

    <section className="network-relations" aria-labelledby="network-relations-title">
      <h2 id="network-relations-title">{fr ? "Relations" : "Relations"}</h2>
      <dl>
        <div><dt>{fr ? "Transition d’état" : "State transition"}</dt><dd>{[model.transitions[0]!.previousState ?? "?", ...model.transitions.map(item => item.newState ?? "?")].join(" → ")}</dd></div>
        <div><dt>{fr ? "Relation temporelle" : "Temporal relation"}</dt><dd>{model.periods.map(period => fr ? `Période n°${period.index} : ${networkTransitionTitle("LOST", locale)}${period.restored ? ` puis ${networkTransitionTitle("RESTORED", locale).toLowerCase()}` : " sans retour"}` : `Period ${period.index}: ${networkTransitionTitle("LOST", locale)}${period.restored ? ` then ${networkTransitionTitle("RESTORED", locale).toLowerCase()}` : " without return"}`).join(" · ")}</dd></div>
        {model.transitions.map(transition => <div key={transition.entry.nodeKey}><dt>{fr ? `Relations causales · ${networkTransitionTitle(transition.kind, locale)}` : `Causal relations · ${networkTransitionTitle(transition.kind, locale)}`}</dt>
          <dd>{fr ? "Parents causaux directs" : "Direct causal parents"} : {causalNames(transition.entry.causalParentNodeKeys, catalog, locale)} · {fr ? "Enfants causaux directs" : "Direct causal children"} : {causalNames(transition.entry.causalChildNodeKeys, catalog, locale)}
            {(() => { const graph = linksForEntry(transition.entry).graph; return graph ? <a href={graph} onClick={() => onSelectEntry?.(transition.entry)}>{fr ? "Voir dans le graphe" : "View in graph"}</a> : null; })()}</dd></div>)}
      </dl>
      <p>{fr ? "Le Vérificateur ne crée aucun lien causal entre la perte et le retour, ni vers les faits de la période. Le graphe montre uniquement les relations déclarées." : "The Verifier creates no causal link between loss and return, nor to the facts of the period. The graph shows only declared relations."}</p>
    </section>
  </article>;
}

"use client";

/* eslint-disable @next/next/no-html-link-for-pages -- Vinext's next/link shim duplicates React in this runtime; canonical anchors are intercepted below. */

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { useI18n } from "../I18nProvider";
import { transferredContentDigest } from "../portableMissionEvidence.ts";
import { inspectReceivedPeb, type ReceivedPebProjection } from "./inspectReceivedPeb.ts";
import { projectReceivedGraph, type ReceivedGraph } from "./receivedGraph.ts";
import { receivedReceiptCounts } from "./receivedReceiptLabels.ts";
import { groupInspectionBoundaries } from "./inspectionPresentation.ts";
import { receivedProducerLabel } from "./receivedLabels.ts";
import { noEvidenceSelection, receivedTimelineNodes, type EvidenceSelection } from "./guidedInspection.ts";
import { ReceivedPebInspection } from "./ReceivedPebInspection";
import { EventDetailView } from "./EventDetailView";
import { NanoReceiptsView, type NanoReceiptFilters } from "./NanoReceiptsView";
import { ForensicView } from "./ForensicView";
import { GuidedStoryView } from "./GuidedStoryView";
import { PersistentStoryTimeline } from "./PersistentStoryTimeline";
import { NetworkLanes, NetworkView } from "./ReceivedNetworkView.tsx";
import { receivedNetworkModel, type ReceivedNetworkModel } from "./receivedNetwork.ts";
import { FactInspector, type FactInspectorSupport } from "./FactInspector.tsx";
import { VerifierBusinessSearch } from "./VerifierBusinessSearch";
import { resolveVerifierGraphContext } from "./verifierGraphContext.ts";
import {
  catalogEntryByNodeKey,
  createReceivedEvidenceCatalog,
  resolveReceivedEvidenceSelection,
  type ReceivedEvidenceCatalog,
  type ReceivedEvidenceCatalogEntry,
} from "./receivedEvidenceCatalog.ts";
import {
  VERIFIER_PRIMARY_VIEWS,
  VERIFIER_VIEWS,
  buildVerifierPath,
  parseVerifierUrl,
  verifierRouteTarget,
  verifierSelectionFromRoute,
  verifierMissionContextStatus,
  type SharedVerifierSelection,
  type VerifierRoute,
  type VerifierView,
  type VerifierViewRoute,
} from "./verifierRoutes.ts";
import {
  clearVerifierNavigationHistoryState,
  createVerifierNavigationHistoryState,
  deterministicVerifierParentPath,
  readVerifierNavigationHistoryEntry,
  retargetVerifierNavigationHistoryState,
  resolveVerifierStoryContext,
  verifierContextReturnPath,
  verifierStoryOriginForEntry,
} from "./verifierNavigation.ts";
import { VerifierPebStore, type VerifierPebCacheEntry } from "./verifierStore.ts";
import { VerifierSelectionSync } from "./verifierSync.ts";
import { DEFAULT_VERIFIER_UI, VerifierPresentationHistory, verifierStoryReturnPath, readVerifierPresentationEntry, VERIFIER_PRESENTATION_STATE_KEY, type VerifierPresentationEntry, type VerifierUISnapshot } from "./verifierPresentation.ts";
import { verifierSnapshotForDigest } from "./verifierSession.ts";
import type { D006VerdictSnapshot } from "../offlineVerification.ts";
import "../nx/nx.css";
import "./verifier.css";
import "./surfaces.css";
import "./visual-hierarchy.css";
import "./receivedInspection.css";
import "./guided-inspection.css";
import "./modular-views.css";
import "./verifier-routes.css";
import "./ux-cleanup.css";

type LoadedPeb = Readonly<{
  entry: VerifierPebCacheEntry;
  peb: ReceivedPebProjection;
  graph: ReceivedGraph;
}>;

type RouteState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error"; message: string }>
  | Readonly<{ status: "missing"; route: VerifierViewRoute; message?: string }>
  | Readonly<{ status: "ready"; route: VerifierViewRoute; loaded: LoadedPeb }>;

type PresentationState = Readonly<{ entry: VerifierPresentationEntry; intent: "new" | "restore"; canBack: boolean; canForward: boolean }>;
function presentationViewState(controller: VerifierPresentationHistory, entry: VerifierPresentationEntry, intent: "new" | "restore"): PresentationState {
  return { entry, intent, canBack: controller.canBack, canForward: controller.canForward };
}

const viewCopy: Readonly<Record<VerifierView, Readonly<{ fr: readonly [string, string]; en: readonly [string, string] }>>> = {
  verdict: { fr: ["Verdict / PEB", "Que permettent d’établir les preuves ?"], en: ["Verdict / PEB", "What does the evidence establish?"] },
  path: { fr: ["Lecture des faits", "Comment lire la chaîne de preuve ?"], en: ["Read the facts", "How to read the chain of evidence?"] },
  timeline: { fr: ["Timeline", "Quand les faits se sont-ils produits ?"], en: ["Timeline", "When did the facts occur?"] },
  domains: { fr: ["Domaines", "Quels domaines et frontières ont été traversés ?"], en: ["Domains", "Which domains and boundaries were crossed?"] },
  network: { fr: ["Réseau", "Dans quel état de connectivité la mission s’est-elle déroulée ?"], en: ["Network", "In what connectivity state did the mission run?"] },
  graph: { fr: ["Graphe causal", "Qu’est-ce qui a causé quoi ?"], en: ["Causal graph", "What caused what?"] },
  event: { fr: ["Événement sélectionné", "Qu’est-ce qui s’est passé ?"], en: ["Selected event", "What happened?"] },
  nanoreceipts: { fr: ["NanoReceipts", "Quelles unités de preuve ont été reçues ?"], en: ["NanoReceipts", "Which evidence units were received?"] },
  forensic: { fr: ["Forensic", "Quels sont les objets et détails techniques bruts ?"], en: ["Forensic", "What are the raw objects and technical details?"] },
};

const viewLabels: Readonly<Record<VerifierView, readonly [string, string]>> = {
  verdict: ["Verdict", "Verdict"], path: ["Path", "Chemin"], timeline: ["Timeline", "Timeline"], domains: ["Domains", "Domaines"], network: ["Network", "Réseau"],
  graph: ["Graph", "Graphe"], event: ["Event", "Événement"], nanoreceipts: ["NanoReceipts", "NanoReceipts"], forensic: ["Forensic", "Forensic"],
};

function routeFromLocation(): VerifierViewRoute | Error {
  const result = parseVerifierUrl(window.location.href);
  if (!result.ok) return result.error;
  if (result.route.kind !== "view") return new Error("The requested Verifier route is not a dedicated view.");
  // Vinext can restore a cached page component after POP while this shared
  // shell owns the current URL. The parsed URL, not a stale page prop, owns view.
  if (!result.route.isCanonical) window.history.replaceState(clearVerifierNavigationHistoryState(window.history.state), "", result.route.canonicalPath);
  return result.route;
}

function selectionInput(route: VerifierViewRoute) {
  return { eventId: route.eventId, nanoReceiptId: route.nanoReceiptId, domainId: route.domainId, family: route.family };
}

function missionDisplayLabel(missionId: string | null, locale: "en" | "fr"): string {
  if (!missionId) return locale === "fr" ? "Mission non déclarée" : "Mission not declared";
  const cycle = /^fortix\.demo\.d(\d+)\.operational-cycle-(\d+)$/i.exec(missionId);
  if (cycle) return locale === "fr" ? `Cycle opérationnel D-${cycle[1]} · mission ${cycle[2]}` : `Operational cycle D-${cycle[1]} · mission ${cycle[2]}`;
  return missionId;
}

function verdictCheckLabel(value: string, locale: "en" | "fr"): string {
  const fr = locale === "fr";
  const labels: Readonly<Record<string, readonly [string, string]>> = {
    d006_transferred_digest_exact: ["Exact transferred bytes checked", "Octets transférés exacts contrôlés"],
    d006_mission_run_identity: ["Mission and run identity checked", "Identité de mission et d’exécution contrôlée"],
    d006_runtime_record_digests: ["Runtime record fingerprints checked", "Empreintes des enregistrements d’exécution contrôlées"],
    d006_displayed_peb_coverage: ["Displayed evidence coverage checked", "Couverture des preuves affichées contrôlée"],
    d006_final_receipt_closure: ["Final Receipt closure checked", "Clôture du Reçu final contrôlée"],
    d006_financial_non_settlement: ["Absence of demonstrated settlement checked", "Absence de règlement démontré contrôlée"],
    d006_in_mission_reconciliation_consistent: ["In-mission reconciliation checked against the journal", "Réconciliation en mission contrôlée contre le journal"],
    canonical_signatures_verified: ["Canonical signatures checked", "Signatures canoniques contrôlées"],
  };
  return labels[value]?.[fr ? 1 : 0] ?? (fr ? "Contrôle technique achevé ; détail disponible en Forensic" : "Technical check completed; detail available in Forensic");
}

function verdictReasonLabel(value: string, locale: "en" | "fr"): string {
  const fr = locale === "fr";
  if (value.includes("PRODUCTION_TRUST_TIME")) return fr ? "Aucun horodatage de production vérifié n’est établi." : "No verified production timestamp is established.";
  if (value.includes("SETTLEMENT_UNSUPPORTED")) return fr ? "Les preuves reçues n’établissent pas le règlement financier." : "Received evidence does not establish financial settlement.";
  if (value.includes("SETTLEMENT_ASSERTION_QUARANTINED")) return fr ? "Une déclaration de règlement reste en quarantaine." : "A settlement assertion remains quarantined.";
  if (value.includes("CLOSURE_MISMATCH")) return fr ? "La clôture reconstruite ne concorde pas avec le paquet reçu." : "The rebuilt closure does not match the received package.";
  if (value.includes("SCHEMA_INVALID")) return fr ? "La structure reçue ne satisfait pas le schéma attendu." : "The received structure does not satisfy the expected schema.";
  return fr ? "Une limite technique est signalée ; son code exact reste disponible en Forensic." : "A technical limitation is reported; its exact code remains available in Forensic.";
}

function routeLocationLabel(
  route: VerifierRoute,
  locale: "en" | "fr",
  catalog: ReceivedEvidenceCatalog,
  graph: ReceivedGraph,
): string {
  const fr = locale === "fr";
  if (route.kind === "intake") return fr ? "Entrée du Vérificateur" : "Verifier intake";
  const resolution = resolveReceivedEvidenceSelection(catalog, selectionInput(route));
  const eventLabel = resolution.entry?.eventLabel ?? null;
  const boundary = route.boundaryKey
    ? groupInspectionBoundaries(graph).find((candidate) => candidate.key === route.boundaryKey) ?? null
    : null;
  const boundaryLabel = boundary
    ? boundary.kind === "producer"
      ? `${receivedProducerLabel(boundary.from, locale)} → ${receivedProducerLabel(boundary.to, locale)}`
      : boundary.kind === "authority"
        ? (fr ? "Frontière d’autorité sélectionnée" : "Selected authority boundary")
        : boundary.kind === "execution"
          ? (fr ? "Frontière d’exécution sélectionnée" : "Selected execution boundary")
          : (fr ? "Frontière de confiance sélectionnée" : "Selected trust boundary")
    : null;
  const domainLabel = route.domainId ? receivedProducerLabel(route.domainId, locale) : null;
  const displaysBoundary = route.view === "path" || route.view === "timeline" || route.view === "domains" || route.view === "graph";
  const detail = (displaysBoundary ? boundaryLabel : null) ?? eventLabel ?? domainLabel;
  const base: Readonly<Record<VerifierView, string>> = fr ? {
    verdict: "Verdict", path: "Chemin", timeline: "Timeline", domains: "Domaines", network: "Réseau", graph: "Graphe causal",
    event: "Événement", nanoreceipts: "NanoReceipt", forensic: "Forensic",
  } : {
    verdict: "Verdict", path: "Path", timeline: "Timeline", domains: "Domains", network: "Network", graph: "Causal graph",
    event: "Event", nanoreceipts: "NanoReceipt", forensic: "Forensic",
  };
  return detail ? `${base[route.view]} · ${detail}` : base[route.view];
}

function evidenceSelection(route: VerifierViewRoute, graph: ReceivedGraph, catalog: ReceivedEvidenceCatalog): EvidenceSelection {
  if (route.boundaryKey) {
    const boundary = groupInspectionBoundaries(graph).find((item) => item.key === route.boundaryKey);
    const edgeKey = route.relationKey && boundary?.edgeKeys.includes(route.relationKey) ? route.relationKey : boundary?.edgeKeys.length === 1 ? boundary.edgeKeys[0]! : null;
    if (boundary) return { kind: "boundary", boundaryKey: boundary.key, edgeKey };
  }
  if (route.relationKey) {
    const edge = graph.edges.find((item) => item.key === route.relationKey);
    if (edge) {
      const resolution = resolveReceivedEvidenceSelection(catalog, selectionInput(route));
      return { kind: "relation", edgeKey: edge.key, focusNodeKey: resolution.entry?.nodeKey ?? edge.to };
    }
  }
  const resolution = resolveReceivedEvidenceSelection(catalog, selectionInput(route));
  return resolution.status === "RESOLVED" && resolution.entry
    ? { kind: "event", nodeKey: resolution.entry.nodeKey }
    : noEvidenceSelection;
}

function sharedForEntry(entry: ReceivedEvidenceCatalogEntry, route: VerifierViewRoute, missionId: string | null, view = route.view, storyOrigin = route.storyEventId ?? route.eventId ?? entry.eventId): SharedVerifierSelection {
  return Object.freeze({
    version: 2 as const,
    pebDigest: route.pebDigest,
    missionId,
    view,
    eventId: entry.eventId,
    storyEventId: ["path", "event", "timeline"].includes(view) ? entry.eventId : storyOrigin,
    nanoReceiptId: entry.nanoReceiptId,
    evidenceId: entry.evidenceId,
    domainId: entry.domainId,
    relationKey: null,
    boundaryKey: null,
    graphMode: route.graphMode,
    family: entry.family,
    followToFinal: route.followToFinal,
  });
}

/** The global synthesis: what the received evidence establishes and what it does
 * not. Business views and inspectors do not repeat these package-wide limits. */
export function RouteVerdict({ locale, peb, graph, snapshot, links, catalog, network }: {
  locale: "en" | "fr"; peb: ReceivedPebProjection; graph: ReceivedGraph; snapshot: D006VerdictSnapshot | null; links: Partial<Record<VerifierView, string>>;
  catalog: ReceivedEvidenceCatalog; network: ReceivedNetworkModel;
}) {
  const fr = locale === "fr"; const result = snapshot?.transferredContentDigest === peb.transferDigest ? snapshot.result : null;
  const receipts = receivedReceiptCounts(graph);
  const declarationCount = graph.edges.reduce((sum, edge) => sum + edge.declarations.length, 0);
  const allDomains = new Set(graph.nodes.map((node) => node.member?.producerDomain).filter((value): value is string => !!value));
  const timelineDomains = new Set(receivedTimelineNodes(graph).map((node) => node.member?.producerDomain).filter((value): value is string => !!value));
  const supportOnlyDomains = [...allDomains].filter((domain) => !timelineDomains.has(domain)).length;
  const reading = result?.verdict === "VALID"
    ? (fr ? "Les contrôles locaux configurés ont validé ce PEB exact." : "The configured local checks validated this exact PEB.")
    : result ? (fr ? `L’analyse locale conclut ${result.verdict}.` : `The local analysis concludes ${result.verdict}.`)
      : (fr ? "Aucun résultat d’analyse n’est conservé dans cet onglet. Les preuves reçues restent consultables sans leur attribuer un verdict." : "No analysis result is retained in this tab. Received evidence remains inspectable without assigning it a verdict.");
  const facts = catalog.timelineEntries;
  const provenanceCount = (category: string) => facts.filter((entry) => entry.provenance.category === category).length;
  const runtime = provenanceCount("RUNTIME"); const simulated = provenanceCount("SIMULATED"); const unknown = provenanceCount("UNKNOWN");
  const restored = network.periods.some((period) => period.restored !== null);
  const established = [
    ...(result ? result.completedChecks.map((check) => verdictCheckLabel(check, locale)) : []),
    fr ? "Chaque unité de preuve et chaque lien affichés proviennent du PEB reçu ; le Vérificateur n’en ajoute aucun." : "Every evidence unit and link displayed comes from the received PEB; the Verifier adds none.",
    ...(network.transitions.length ? [fr
      ? `${network.transitions.length} transition${network.transitions.length > 1 ? "s" : ""} réseau ${network.transitions.length > 1 ? "sont déclarées" : "est déclarée"} ; état réseau à la fin du PEB : ${network.finalState ?? "non déclaré"}.`
      : `${network.transitions.length} network transition${network.transitions.length > 1 ? "s are" : " is"} declared; network state at the end of the PEB: ${network.finalState ?? "not declared"}.`] : []),
    // Read from the reconciliation receipts this exact analysis confirmed — never from RESTORED.
    ...(network.reconciliation.status === "ESTABLISHED" && network.periods.length ? [fr
      ? `Preuves réconciliées : ${network.periods.length > 1 ? `chacune des ${network.periods.length} périodes hors ligne est nommée` : "la période hors ligne est nommée"} par un reçu de réconciliation que l’analyse de ce PEB exact a lié à ses propres enregistrements.`
      : `Evidence reconciled: ${network.periods.length > 1 ? `each of the ${network.periods.length} offline periods is named` : "the offline period is named"} by a reconciliation receipt that the analysis of this exact PEB bound to its own records.`] : []),
  ];
  const limits = [
    fr ? "Les champs du PEB restent des déclarations reçues : leur présence ne prouve pas, à elle seule, que l’effet physique ou métier s’est produit." : "PEB fields remain received declarations: their presence does not, by itself, prove that the physical or business effect occurred.",
    fr ? "L’ordre de la Timeline et la proximité dans le temps n’ajoutent aucune causalité : seules les relations déclarées en établissent." : "Timeline order and proximity in time add no causality: only declared relations establish it.",
    ...(runtime ? [fr ? `${runtime} fait${runtime > 1 ? "s sont" : " est"} de provenance RUNTIME : le runtime les déclare ; le Vérificateur n’établit pas de corroboration externe indépendante.` : `${runtime} fact${runtime > 1 ? "s are" : " is"} of RUNTIME provenance: the runtime declares them; the Verifier establishes no independent external corroboration.`] : []),
    ...(simulated ? [fr ? `${simulated} fait${simulated > 1 ? "s sont simulés" : " est simulé"} (script d’audit ou démonstration) : ${simulated > 1 ? "ils n’établissent" : "il n’établit"} pas d’effet physique réel.` : `${simulated} fact${simulated > 1 ? "s are" : " is"} simulated (audit script or demonstration): ${simulated > 1 ? "they establish" : "it establishes"} no real physical effect.`] : []),
    ...(unknown ? [fr ? `${unknown} fait${unknown > 1 ? "s ont" : " a"} une provenance non établie.` : `${unknown} fact${unknown > 1 ? "s have" : " has"} an unestablished provenance.`] : []),
    ...(restored && network.reconciliation.status !== "ESTABLISHED" ? [fr ? "Le réseau est rétabli, mais la réconciliation des preuves produites hors ligne n’est pas établie dans ce PEB." : "The network is restored, but reconciliation of the evidence produced offline is not established in this PEB."] : []),
    ...(network.periods.some((period) => period.reconciliation.receipt !== null) ? [fr
      ? "La base de réconciliation est un registre de démonstration du même poste : un reçu de réconciliation est une déclaration du runtime, cohérente avec le journal qu’il nomme, pas l’attestation d’un témoin indépendant."
      : "The reconciliation base is a same-machine demonstration ledger: a reconciliation receipt is a runtime declaration, consistent with the journal it names, not the attestation of an independent witness."] : []),
    ...(network.finalState === "LOST" ? [fr ? "Le réseau n’est pas rétabli avant la fin de la mission." : "The network is not restored before the end of the mission."] : []),
    ...(result?.reasonCodes.map((reason) => verdictReasonLabel(reason, locale)) ?? []),
  ];
  return <article className="modular-view modular-verdict-view" data-verdict={result?.verdict ?? "PENDING"}>
    <header className="modular-event-hero"><div><p className="modular-kicker">PEB / VERDICT</p><h1>{result?.verdict ?? (fr ? "Non analysé" : "Not analyzed")}</h1><p>{reading}</p></div><dl><div><dt>{fr ? "NanoReceipts reçus" : "Received NanoReceipts"}</dt><dd>{receipts.nano}</dd></div><div><dt>{fr ? "Preuves de support reçues" : "Received support evidence"}</dt><dd>{receipts.support}</dd></div><div><dt>{fr ? "Reçu final reçu" : "Received Final Receipt"}</dt><dd>{receipts.final}</dd></div><div><dt>{fr ? "Liens source → cible résolus" : "Resolved source → target links"}</dt><dd>{graph.edges.length}<small>{declarationCount} {fr ? "déclarations reçues" : "received declarations"}</small></dd></div><div><dt>{fr ? "Domaines producteurs" : "Producer domains"}</dt><dd>{allDomains.size}<small>{timelineDomains.size} {fr ? "dans la Timeline" : "in Timeline"} + {supportOnlyDomains} {fr ? "réservés aux preuves" : "reserved for evidence"}</small></dd></div></dl></header>
    <div className="modular-event-reading"><section className="modular-reading-card modular-reading-card--lead"><p className="modular-kicker">{fr ? "Conclusion" : "Conclusion"}</p><h2>{reading}</h2><p>{fr ? "La consultation ne modifie ni les octets, ni les NanoReceipts, ni leurs relations." : "Inspection changes neither the bytes, nor the NanoReceipts, nor their relations."}</p></section><section className="modular-reading-card modular-reading-card--established" data-verdict-established><h2>{fr ? "Ce que les preuves permettent d’établir" : "What the evidence establishes"}</h2><ul>{established.map((item) => <li key={item}>{item}</li>)}</ul>{!result && <p>{fr ? "Revenez à l’entrée du Vérificateur pour lancer l’analyse locale par une action explicite." : "Return to the Verifier intake to run local analysis through an explicit action."}</p>}</section><section className="modular-reading-card modular-reading-card--limits" data-verdict-unestablished><h2>{fr ? "Ce qui reste non établi" : "What remains unestablished"}</h2><ul>{limits.map((item) => <li key={item}>{item}</li>)}</ul><p>{fr ? "Ces limites valent pour tout le PEB : les autres vues ne les répètent pas et signalent seulement celles propres à un fait." : "These limits apply to the whole PEB: other views do not repeat them and only flag the ones specific to a fact."}</p></section><section className="modular-reading-card modular-reading-card--proof"><p className="modular-kicker">{fr ? "Prochaine lecture" : "Next reading"}</p><h2>{fr ? "Lecture des faits" : "Read the facts"}</h2><p>{fr ? "Suivez les faits reçus avant d’ouvrir les dépendances ou le détail technique." : "Follow received facts before opening dependencies or technical detail."}</p>{links.path && <a className="modular-primary-link" href={links.path}>{fr ? "Lire les faits" : "Read the facts"} →</a>}</section></div>
    <div className="modular-verdict-identity"><p>{fr ? "L’identité technique exacte reste disponible dans la vue réservée aux données brutes." : "The exact technical identity remains available in the view reserved for raw data."}</p>{links.forensic && <a href={links.forensic}>{fr ? "Voir l’identité technique en Forensic" : "View technical identity in Forensic"} →</a>}</div>
  </article>;
}

export function VerifierRouteClient({ requestedView, onReturnToIntake }: {
  requestedView: VerifierView;
  onReturnToIntake?: () => void;
}) {
  const { locale, setLocale } = useI18n();
  const [state, setState] = useState<RouteState>({ status: "loading" });
  const [announcement, setAnnouncement] = useState("");
  const [liveSyncEnabled, setLiveSyncEnabled] = useState(false);
  const [presentation, setPresentation] = useState<PresentationState | null>(null);
  const presentationRef = useRef<VerifierPresentationHistory | null>(null);
  const restoringRef = useRef(false);
  const storeRef = useRef<VerifierPebStore | null>(null);
  const syncRef = useRef<VerifierSelectionSync | null>(null);
  const routeRef = useRef<VerifierViewRoute | null>(null);
  const loadedRef = useRef<LoadedPeb | null>(null);
  const loadGenerationRef = useRef(0);
  const syncContextRef = useRef<Readonly<{
    pebDigest: string;
    catalog: ReceivedEvidenceCatalog;
    graph: ReceivedGraph;
  }> | null>(null);

  const updateUIState = useCallback((patch: Partial<VerifierUISnapshot>) => {
    const controller = presentationRef.current;
    if (!controller?.current) return;
    try {
      const entry = controller.update(patch);
      setPresentation(current => presentationViewState(controller, entry, current?.intent ?? "new"));
    } catch { /* Invalid presentation data never changes semantic selection. */ }
  }, []);
  const capturePageScroll = useCallback(() => {
    if (!restoringRef.current) updateUIState({ scroll: { x: window.scrollX, y: window.scrollY } });
  }, [updateUIState]);

  const loadRoute = useCallback(async (route: VerifierViewRoute) => {
    const generation = ++loadGenerationRef.current;
    loadedRef.current = null;
    setState({ status: "loading" });
    try {
      const store = storeRef.current ?? new VerifierPebStore({ digestText: transferredContentDigest });
      storeRef.current = store;
      const entry = await store.get(route.pebDigest);
      if (generation !== loadGenerationRef.current) return;
      if (!entry) { setState({ status: "missing", route }); return; }
      const peb = inspectReceivedPeb(entry.text);
      if (peb.transferDigest !== route.pebDigest) { await store.remove(route.pebDigest); setState({ status: "missing", route, message: "Digest mismatch" }); return; }
      const graph = projectReceivedGraph(peb, entry.text);
      const loaded = { entry, peb, graph } as const;
      routeRef.current = route;
      loadedRef.current = loaded;
      setState({ status: "ready", route, loaded });
    } catch (error) {
      if (generation !== loadGenerationRef.current) return;
      setState({ status: "error", message: error instanceof Error ? error.message : "Verifier route failed" });
    }
  }, []);

  const activateRoute = useCallback((route: VerifierViewRoute) => {
    const loaded = loadedRef.current;
    if (loaded?.entry.digest === route.pebDigest) {
      routeRef.current = route;
      setState({ status: "ready", route, loaded });
      return;
    }
    void loadRoute(route);
  }, [loadRoute]);

  const pushViewRoute = useCallback((route: VerifierViewRoute) => {
    const parent = routeRef.current;
    if (parent?.canonicalPath === route.canonicalPath) {
      activateRoute(route);
      return;
    }
    capturePageScroll();
    let nextState = clearVerifierNavigationHistoryState(window.history.state);
    if (parent) {
      try {
        nextState = createVerifierNavigationHistoryState(window.history.state, parent.canonicalPath, route.canonicalPath);
      } catch { /* A canonical route still opens without local provenance. */ }
    }
    const controller = presentationRef.current;
    if (controller?.current) {
      const entry = controller.push(route.canonicalPath, nextState);
      restoringRef.current = false;
      setPresentation(presentationViewState(controller, entry, "new"));
    } else window.history.pushState(nextState, "", route.canonicalPath);
    activateRoute(route);
  }, [activateRoute, capturePageScroll]);

  useEffect(() => {
    const first = routeFromLocation();
    if (first instanceof Error) { queueMicrotask(() => setState({ status: "error", message: first.message })); return; }
    const existing = readVerifierPresentationEntry((window.history.state as Record<string, unknown> | null)?.[VERIFIER_PRESENTATION_STATE_KEY], first.canonicalPath);
    let storage: Storage | null = null;
    try { storage = window.sessionStorage; } catch { /* Memory/history-only restoration remains available. */ }
    const controller = presentationRef.current ?? new VerifierPresentationHistory(window.history, storage);
    presentationRef.current = controller;
    const entry = controller.initialize(first.canonicalPath);
    restoringRef.current = !!existing;
    queueMicrotask(() => setPresentation(presentationViewState(controller, entry, existing ? "restore" : "new")));
    const previousScrollRestoration = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
    queueMicrotask(() => activateRoute(first));
    const popstate = () => {
      capturePageScroll();
      const parsed = parseVerifierUrl(window.location.href);
      if (!parsed.ok) { setState({ status: "error", message: parsed.error.message }); return; }
      if (parsed.route.kind === "intake") {
        if (onReturnToIntake) onReturnToIntake();
        else window.location.reload();
        return;
      }
      if (!parsed.route.isCanonical) window.history.replaceState(clearVerifierNavigationHistoryState(window.history.state), "", parsed.route.canonicalPath);
      restoringRef.current = true;
      setPresentation(presentationViewState(controller, controller.restore(parsed.route.canonicalPath), "restore"));
      activateRoute(parsed.route);
    };
    window.addEventListener("popstate", popstate);
    return () => { window.removeEventListener("popstate", popstate); window.history.scrollRestoration = previousScrollRestoration; };
  }, [activateRoute, capturePageScroll, onReturnToIntake, requestedView]);

  useEffect(() => {
    let frame = 0;
    const capture = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; capturePageScroll(); }); };
    window.addEventListener("scroll", capture, { passive: true });
    window.addEventListener("pagehide", capturePageScroll);
    return () => { window.removeEventListener("scroll", capture); window.removeEventListener("pagehide", capturePageScroll); cancelAnimationFrame(frame); };
  }, [capturePageScroll]);

  useEffect(() => {
    const interceptRouteClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const source = event.target;
      if (!(source instanceof Element)) return;
      const anchor = source.closest<HTMLAnchorElement>("a[href]");
      if (!anchor || anchor.hasAttribute("download") || (anchor.target && anchor.target !== "_self")) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      const parsed = parseVerifierUrl(url);
      if (!parsed.ok) return;
      if (parsed.route.kind === "intake") {
        if (!onReturnToIntake) return;
        event.preventDefault();
        capturePageScroll();
        const parent = routeRef.current;
        let nextState = clearVerifierNavigationHistoryState(window.history.state);
        if (parent) {
          try {
            nextState = createVerifierNavigationHistoryState(window.history.state, parent.canonicalPath, parsed.route.canonicalPath);
          } catch { /* Intake remains reachable even if provenance cannot be formed. */ }
        }
        window.history.pushState(nextState, "", parsed.route.canonicalPath);
        onReturnToIntake();
        return;
      }
      event.preventDefault();
      pushViewRoute(parsed.route);
    };
    document.addEventListener("click", interceptRouteClick);
    return () => document.removeEventListener("click", interceptRouteClick);
  }, [capturePageScroll, onReturnToIntake, pushViewRoute]);

  useEffect(() => () => { syncRef.current?.close(); storeRef.current?.close(); }, []);

  const catalog = useMemo(() => state.status === "ready" ? createReceivedEvidenceCatalog(state.loaded.graph, locale, state.loaded.entry.text) : null, [state, locale]);
  // The retained analysis of these exact bytes, if any: a reconciliation reads
  // as established only once that analysis confirmed it.
  const analysis = state.status === "ready" ? verifierSnapshotForDigest(state.route.pebDigest) : null;
  const network = useMemo(() => state.status === "ready" && catalog ? receivedNetworkModel(catalog, state.loaded.entry.text, analysis) : null, [state, catalog, analysis]);
  const missionId = state.status === "ready" ? state.loaded.peb.identity.missionId : null;
  useEffect(() => {
    if (state.status !== "ready" || !catalog || state.route.storyEventId !== null
      || !["path", "event", "timeline", "graph"].includes(state.route.view)
      || verifierMissionContextStatus(state.route, state.loaded.peb.identity.missionId) === "CONTRADICTORY") return;
    const context = resolveVerifierGraphContext(state.loaded.graph, state.route);
    if (context.status !== "EMPTY" && context.status !== "RESOLVED") return;
    const selected = resolveReceivedEvidenceSelection(catalog, selectionInput(state.route));
    const entry = selected.status === "RESOLVED" ? selected.entry : selected.status === "EMPTY" && state.route.view !== "graph"
      ? catalog.entries.find(candidate => candidate.timelinePosition === 1) : null;
    if (!entry?.eventId || entry.timelinePosition === null) return;
    const path = buildVerifierPath(verifierRouteTarget({ ...sharedForEntry(entry, state.route, state.loaded.peb.identity.missionId),
      storyEventId: entry.eventId, relationKey: state.route.relationKey, boundaryKey: state.route.boundaryKey }));
    const parsed = parseVerifierUrl(path);
    if (!parsed.ok || parsed.route.kind !== "view") return;
    const controller = presentationRef.current;
    if (controller?.current) {
      const presentationEntry = controller.replace(path, clearVerifierNavigationHistoryState(window.history.state));
      setPresentation(current => presentationViewState(controller, presentationEntry, current?.intent ?? "new"));
    } else window.history.replaceState(clearVerifierNavigationHistoryState(window.history.state), "", path);
    activateRoute(parsed.route);
  }, [activateRoute, catalog, state]);
  useEffect(() => {
    if (state.status === "ready" && catalog) {
      syncContextRef.current = { pebDigest: state.route.pebDigest, catalog, graph: state.loaded.graph };
    } else {
      syncContextRef.current = null;
    }
  }, [catalog, state]);

  const applySelection = useCallback((selection: SharedVerifierSelection, history: "push" | "replace" | "retarget", publish: boolean) => {
    const route = routeRef.current;
    if (!route) return;
    let path: string;
    try { path = buildVerifierPath(verifierRouteTarget(selection, selection.view)); }
    catch { return; }
    const parsed = parseVerifierUrl(new URL(path, window.location.href));
    if (!parsed.ok || parsed.route.kind !== "view") return;
    if (history === "push") pushViewRoute(parsed.route);
    else {
      let nextState: unknown;
      try { nextState = retargetVerifierNavigationHistoryState(window.history.state, route.canonicalPath, parsed.route.canonicalPath); }
      catch { nextState = clearVerifierNavigationHistoryState(window.history.state); }
      const controller = presentationRef.current;
      if (controller?.current) {
        const entry = controller.replace(parsed.route.canonicalPath, nextState);
        setPresentation(presentationViewState(controller, entry, history === "replace" ? "restore" : "new"));
      } else window.history.replaceState(nextState, "", parsed.route.canonicalPath);
      activateRoute(parsed.route);
    }
    if (publish) {
      try { syncRef.current?.publish(selection); } catch { /* URL remains authoritative if live sync is unavailable. */ }
    }
  }, [activateRoute, pushViewRoute]);

  const syncDigest = state.status === "ready" ? state.route.pebDigest : null;
  const syncMissionId = state.status === "ready" ? state.loaded.peb.identity.missionId : null;
  useEffect(() => {
    if (!syncDigest || !liveSyncEnabled) return;
    let endpoint: VerifierSelectionSync | null = null;
    try {
      endpoint = new VerifierSelectionSync({
        pebDigest: syncDigest,
        missionId: syncMissionId,
        currentView: () => routeRef.current?.view ?? requestedView,
        onRemoteSelection: (selection) => {
          const context = syncContextRef.current;
          if (!context || context.pebDigest !== syncDigest) return;
          const resolved = resolveReceivedEvidenceSelection(context.catalog, selection);
          const graphContext = resolveVerifierGraphContext(context.graph, selection);
          const story = selection.storyEventId === null ? null : resolveReceivedEvidenceSelection(context.catalog, { eventId: selection.storyEventId });
          if ((resolved.status === "RESOLVED" || resolved.status === "EMPTY") && (graphContext.status === "RESOLVED" || graphContext.status === "EMPTY")
            && (!story || (story.status === "RESOLVED" && story.entry?.timelinePosition !== null))) applySelection(selection, "replace", false);
        },
      });
      syncRef.current = endpoint;
    } catch { syncRef.current = null; }
    return () => {
      endpoint?.close();
      if (syncRef.current === endpoint) syncRef.current = null;
    };
  }, [applySelection, liveSyncEnabled, requestedView, syncDigest, syncMissionId]);

  const activeView = state.status === "ready" ? state.route.view : null;
  const presentationEntryId = presentation?.entry.entryId;
  const navigationIntent = presentation?.intent ?? "new";
  const uiState = presentation?.entry.uiSnapshot ?? DEFAULT_VERIFIER_UI;
  const lastPresentedViewRef = useRef<VerifierView | null>(null);
  useEffect(() => {
    if (!activeView) return;
    const sameView = lastPresentedViewRef.current === activeView;
    lastPresentedViewRef.current = activeView;
    if (sameView && navigationIntent === "new") { restoringRef.current = false; return; }
    let restoreFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      if (navigationIntent === "restore") {
        restoreFrame = requestAnimationFrame(() => {
          const scroll = presentationRef.current?.current?.uiSnapshot.scroll ?? DEFAULT_VERIFIER_UI.scroll;
          window.scrollTo({ left: scroll.x, top: scroll.y, behavior: "instant" });
          restoringRef.current = false;
        });
        return;
      }
      document.getElementById("verifier-route-content")?.focus({ preventScroll: true });
      const story = activeView === "path" ? document.querySelector<HTMLElement>(".guided-story-view") : null;
      const timelineHeight = document.querySelector<HTMLElement>(".persistent-story-timeline")?.offsetHeight ?? 0;
      const headerHeight = window.innerWidth > 600 ? document.querySelector<HTMLElement>(".verifier-route-header")?.offsetHeight ?? 64 : 0;
      window.scrollTo({ top: story ? Math.max(0, story.getBoundingClientRect().top + window.scrollY - timelineHeight - headerHeight - 12) : 0, behavior: "instant" });
      restoringRef.current = false;
    });
    return () => { cancelAnimationFrame(firstFrame); cancelAnimationFrame(restoreFrame); };
  }, [activeView, navigationIntent, presentationEntryId]);

  if (state.status === "loading") return <main className="nx verifier-route-page"><section className="verifier-route-status" aria-live="polite"><p>FortiX · Verifier</p><h1>{locale === "fr" ? "Ouverture du PEB…" : "Opening PEB…"}</h1></section></main>;
  if (state.status === "error") return <main className="nx verifier-route-page"><section className="verifier-route-status" role="alert"><p>FortiX · Verifier</p><h1>{locale === "fr" ? "Lien non valide" : "Invalid link"}</h1><p>{state.message}</p><a href="/verify">{locale === "fr" ? "Ouvrir le Vérificateur" : "Open Verifier"}</a></section></main>;
  if (state.status === "missing") return <MissingPeb route={state.route} locale={locale} message={state.message} onLoaded={(entry) => {
    const peb = inspectReceivedPeb(entry.text); const graph = projectReceivedGraph(peb, entry.text); const loaded = { entry, peb, graph } as const; routeRef.current = state.route;
    loadedRef.current = loaded; setState({ status: "ready", route: state.route, loaded });
  }} store={() => storeRef.current ?? (storeRef.current = new VerifierPebStore({ digestText: transferredContentDigest }))} />;

  const { route, loaded } = state;
  const currentCatalog = catalog ?? createReceivedEvidenceCatalog(loaded.graph, locale, loaded.entry.text);
  const currentNetwork = network ?? receivedNetworkModel(currentCatalog, loaded.entry.text, verifierSnapshotForDigest(route.pebDigest));
  const resolution = resolveReceivedEvidenceSelection(currentCatalog, selectionInput(route));
  const storyResolution = resolveVerifierStoryContext(currentCatalog, route);
  const originEventId = storyResolution.eventId;
  const storyUnresolved = storyResolution.status !== "RESOLVED" && storyResolution.status !== "ABSENT";
  const storyAbsent = originEventId === null && ["domains", "graph", "nanoreceipts", "forensic"].includes(route.view);
  const missionContradictory = verifierMissionContextStatus(route, loaded.peb.identity.missionId) === "CONTRADICTORY";
  const graphContext = resolveVerifierGraphContext(loaded.graph, route);
  const graphContextUnresolved = graphContext.status !== "RESOLVED" && graphContext.status !== "EMPTY";
  const routeEvidenceSelection = graphContextUnresolved ? noEvidenceSelection : evidenceSelection(route, loaded.graph, currentCatalog);
  const baseSelection = { ...verifierSelectionFromRoute(route, missionId, resolution.entry?.evidenceId ?? null), storyEventId: originEventId };
  const storyRecoveryHref = resolution.status === "RESOLVED" && resolution.entry?.eventId && resolution.entry.timelinePosition !== null
    ? buildVerifierPath({ ...verifierRouteTarget(baseSelection), view: "path", storyEventId: resolution.entry.eventId, relationKey: null, boundaryKey: null })
    : buildVerifierPath({ pebDigest: route.pebDigest, missionId, view: "path" });
  const recoveryPathHref = resolution.status === "RESOLVED"
    ? buildVerifierPath({ ...verifierRouteTarget(baseSelection), view: "path", boundaryKey: null, relationKey: null })
    : buildVerifierPath({ pebDigest: route.pebDigest, view: "path" });

  const selectionForEntry = (entry: ReceivedEvidenceCatalogEntry, view: VerifierView = route.view) => sharedForEntry(entry, route, missionId, view, originEventId);
  const contextualSelectionForEntry = (entry: ReceivedEvidenceCatalogEntry, view: VerifierView = route.view) => {
    const selection = selectionForEntry(entry, view);
    return entry.nodeKey === resolution.entry?.nodeKey
      ? { ...selection, relationKey: route.relationKey, boundaryKey: route.boundaryKey }
      : selection;
  };
  const linksForSelection = (selection: SharedVerifierSelection) => Object.fromEntries(VERIFIER_VIEWS.flatMap((view) => {
    if (view === "event" && !selection.eventId) return [];
    const contextual = ["path", "event", "timeline"].includes(view)
      ? { ...selection, storyEventId: selection.eventId ?? selection.storyEventId } : selection;
    try { return [[view, buildVerifierPath(verifierRouteTarget(contextual, view))]]; } catch { return []; }
  })) as Partial<Record<VerifierView, string>>;
  const links = linksForSelection(baseSelection);
  const linksForEntry = (entry: ReceivedEvidenceCatalogEntry) => linksForSelection(contextualSelectionForEntry(entry));
  const timelineLinksForEntry = (entry: ReceivedEvidenceCatalogEntry) => {
    const entryLinks = linksForEntry(entry);
    if (route.view !== "graph") return entryLinks;
    const selection = { ...selectionForEntry(entry), storyEventId: verifierStoryOriginForEntry(entry, originEventId), relationKey: null, boundaryKey: null };
    return { ...entryLinks, path: buildVerifierPath(verifierRouteTarget(selection, "graph")) };
  };
  const currentHref = links[route.view] ?? route.canonicalPath;
  const domainHrefForId = (domainId: string) => buildVerifierPath({ ...verifierRouteTarget(baseSelection), view: "domains", domainId,
    eventId: null, nanoReceiptId: null, relationKey: null, boundaryKey: null, family: null });

  const selectEntry = (entry: ReceivedEvidenceCatalogEntry) => {
    const selection = route.view === "graph"
      ? { ...selectionForEntry(entry), storyEventId: verifierStoryOriginForEntry(entry, originEventId) }
      : contextualSelectionForEntry(entry);
    try { syncRef.current?.publish(selection); } catch { /* Navigation remains deterministic without live sync. */ }
  };
  const changeEvidenceSelection = (next: EvidenceSelection) => {
    let selection: SharedVerifierSelection;
    if (next.kind === "event") {
      const entry = catalogEntryByNodeKey(currentCatalog, next.nodeKey); if (!entry) return;
      selection = { ...selectionForEntry(entry), storyEventId: verifierStoryOriginForEntry(entry, originEventId) };
    } else if (next.kind === "relation") {
      if (!loaded.graph.edges.some(edge => edge.key === next.edgeKey)) return;
      capturePageScroll();
      selection = { ...baseSelection, boundaryKey: null, relationKey: next.edgeKey };
    } else if (next.kind === "boundary") {
      if (!groupInspectionBoundaries(loaded.graph).some(boundary => boundary.key === next.boundaryKey && (!next.edgeKey || boundary.edgeKeys.includes(next.edgeKey)))) return;
      capturePageScroll();
      selection = { ...baseSelection, boundaryKey: next.boundaryKey, relationKey: next.edgeKey };
    } else selection = { ...baseSelection, eventId: null, nanoReceiptId: null, evidenceId: null, domainId: null, relationKey: null, boundaryKey: null };
    applySelection(selection, "push", true);
    setAnnouncement(locale === "fr" ? "Sélection synchronisée." : "Selection synchronized.");
  };
  const changeMode = (graphMode: typeof route.graphMode) => applySelection({ ...baseSelection, graphMode, followToFinal: graphMode === "follow" ? route.followToFinal : false }, "retarget", true);
  const changeFollowToFinal = (followToFinal: boolean) => applySelection({ ...baseSelection, graphMode: "follow", followToFinal }, "retarget", true);
  const changeFilters = (filters: NanoReceiptFilters) => {
    const entry = resolution.status === "RESOLVED" ? resolution.entry : null;
    const compatible = !!entry
      && (!filters.family || entry.family === filters.family)
      && (!filters.domainId || entry.domainId === filters.domainId);
    applySelection({
      ...baseSelection,
      eventId: compatible ? baseSelection.eventId : null,
      nanoReceiptId: compatible ? baseSelection.nanoReceiptId : null,
      evidenceId: compatible ? baseSelection.evidenceId : null,
      relationKey: compatible ? baseSelection.relationKey : null,
      boundaryKey: compatible ? baseSelection.boundaryKey : null,
      family: filters.family,
      domainId: filters.domainId,
    }, "retarget", true);
  };
  const openView = (view: VerifierView, nodeKey: string | null = null) => {
    const entry = nodeKey ? catalogEntryByNodeKey(currentCatalog, nodeKey) : resolution.entry;
    const selection = entry && entry.nodeKey !== resolution.entry?.nodeKey
      ? selectionForEntry(entry, view)
      : { ...baseSelection, view };
    applySelection(selection, "push", true);
  };
  const openForensic = (nodeKey: string | null) => { capturePageScroll(); openView("forensic", nodeKey); };
  const openEvidence = (nodeKey: string | null) => { capturePageScroll(); openView("nanoreceipts", nodeKey); };
  const openDomain = (domainId: string) => applySelection({
    ...baseSelection,
    view: "domains",
    eventId: null,
    nanoReceiptId: null,
    evidenceId: null,
    domainId,
    relationKey: null,
    boundaryKey: null,
    family: null,
  }, "push", true);
  const navigateInspection = (view: "path" | "domains" | "graph") => openView(view === "path" ? "timeline" : view);
  const copy = viewCopy[route.view][locale];
  const provenance = readVerifierNavigationHistoryEntry(window.history.state, route.canonicalPath);
  const fallbackPath = deterministicVerifierParentPath(route);
  const returnPath = provenance?.parentPath ?? fallbackPath;
  const parsedParent = parseVerifierUrl(returnPath);
  const parentRoute = parsedParent.ok ? parsedParent.route : null;
  const parentLocationLabel = parentRoute
    ? routeLocationLabel(parentRoute, locale, currentCatalog, loaded.graph)
    : (locale === "fr" ? "Contexte précédent" : "Previous context");
  const navigateToParent = () => {
    const liveRoute = routeRef.current;
    if (!liveRoute) return;
    capturePageScroll();
    const liveProvenance = readVerifierNavigationHistoryEntry(window.history.state, liveRoute.canonicalPath);
    if (liveProvenance?.parentPath === returnPath) {
      window.history.back();
      return;
    }
    const parsed = parseVerifierUrl(returnPath);
    if (!parsed.ok) return;
    if (parsed.route.kind === "view" && presentationRef.current?.current) {
      let entry = presentationRef.current.replace(parsed.route.canonicalPath, clearVerifierNavigationHistoryState(window.history.state));
      if (parsed.route.view === "domains" && parsed.route.domainId) entry = presentationRef.current.update({ expandedPanels: [...new Set([...entry.uiSnapshot.expandedPanels, `domains:facts:${parsed.route.domainId}`])] });
      setPresentation(presentationViewState(presentationRef.current, entry, "new"));
    } else window.history.replaceState(clearVerifierNavigationHistoryState(window.history.state), "", parsed.route.canonicalPath);
    if (parsed.route.kind === "intake") {
      if (onReturnToIntake) onReturnToIntake();
      else window.location.reload();
      return;
    }
    activateRoute(parsed.route);
  };
  const returnToParent = (event: ReactMouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigateToParent();
  };
  const contextReturnHref = presentation?.entry.contextBookmark?.path
    ?? (route.view === "graph" ? verifierContextReturnPath({ ...route, missionId }, currentCatalog) : null);
  const storyReturnHref = contextReturnHref ?? (originEventId !== null && !storyUnresolved && !missionContradictory
    ? presentation?.entry.storyBookmark?.path ?? verifierStoryReturnPath({ ...route, missionId }) : null);
  const returnToEvent = () => {
    capturePageScroll();
    const controller = presentationRef.current;
    const delta = controller?.contextReturnDelta() ?? null;
    if (delta !== null && delta < 0) { restoringRef.current = true; window.history.go(delta); return; }
    if (contextReturnHref) {
      const parsed = parseVerifierUrl(contextReturnHref);
      if (!parsed.ok || parsed.route.kind !== "view") return;
      restoringRef.current = true;
      if (controller?.current) {
        const entry = controller.replace(parsed.route.canonicalPath, clearVerifierNavigationHistoryState(window.history.state));
        setPresentation(presentationViewState(controller, entry, "restore"));
      } else window.history.replaceState(clearVerifierNavigationHistoryState(window.history.state), "", parsed.route.canonicalPath);
      activateRoute(parsed.route);
      return;
    }
    navigateToParent();
  };
  const returnToStory = (event: ReactMouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !storyReturnHref) return;
    event.preventDefault();
    if (contextReturnHref) { returnToEvent(); return; }
    capturePageScroll();
    const delta = presentationRef.current?.storyReturnDelta();
    if (delta !== null && delta !== undefined && delta < 0) { restoringRef.current = true; window.history.go(delta); return; }
    const parsed = parseVerifierUrl(storyReturnHref);
    if (parsed.ok && parsed.route.kind === "view") pushViewRoute(parsed.route);
  };
  const navigateHistory = (direction: "back" | "forward") => {
    const controller = presentationRef.current;
    if (!(direction === "back" ? controller?.canBack : controller?.canForward)) return;
    capturePageScroll(); restoringRef.current = true;
    if (direction === "back") window.history.back(); else window.history.forward();
  };
  // The view actually visited before, restored from its presentation entry; absent on a direct entry.
  const backToPreviousView = presentation?.canBack ? () => navigateHistory("back") : undefined;
  const uiProps = { uiState, onUIStateChange: updateUIState, restoreToken: presentationEntryId, navigationIntent } as const;
  const factSupport: FactInspectorSupport = { catalog: currentCatalog, network: currentNetwork, linksForEntry, onSelectEntry: selectEntry };
  const routeInspection = { factSupport, condensed: true } as const;
  const contextProps = { onBeginContextInspection: capturePageScroll, onReturnToEvent: returnToEvent, readingNodeKey: storyResolution.entry?.nodeKey ?? null } as const;

  return <main className="nx verifier-route-page" data-view={route.view} data-active-tab={route.view} data-peb-digest={route.pebDigest}>
    <a className="verifier-skip" href="#verifier-route-content">{locale === "fr" ? "Aller au contenu" : "Skip to content"}</a>
    <header className="verifier-route-header"><a className="verifier-route-brand" href="/verify">FortiX · Verifier</a><div className="verifier-route-language" role="group" aria-label={locale === "fr" ? "Langue" : "Language"}><button type="button" lang="en" aria-pressed={locale === "en"} onClick={() => setLocale("en")}>EN</button><button type="button" lang="fr" aria-pressed={locale === "fr"} onClick={() => setLocale("fr")}>FR</button></div></header>
    <nav className="verifier-return-bar" aria-label={locale === "fr" ? "Contexte et retour" : "Context and return"} data-direct-entry={!provenance}>
      <a className="verifier-context-return" href={returnPath} onClick={returnToParent}><span aria-hidden="true">←</span>{locale === "fr" ? `Retour à ${parentLocationLabel}` : `Back to ${parentLocationLabel}`}</a>
      <div className="verifier-history-controls" role="group" aria-label={locale === "fr" ? "Historique des vues" : "View history"}>
        <button type="button" disabled={!presentation?.canBack} data-verifier-history="back" onClick={() => navigateHistory("back")}>{locale === "fr" ? "← Vue précédente" : "← Previous view"}</button>
        <button type="button" disabled={!presentation?.canForward} data-verifier-history="forward" onClick={() => navigateHistory("forward")}>{locale === "fr" ? "Vue suivante →" : "Next view →"}</button>
        <label className="verifier-live-sync"><input type="checkbox" checked={liveSyncEnabled} onChange={event => setLiveSyncEnabled(event.target.checked)} />{locale === "fr" ? "Synchroniser la sélection entre onglets" : "Sync selection across tabs"}</label>
      </div>
    </nav>
    <nav className="verifier-route-nav" aria-label={locale === "fr" ? "Changer de vue du Vérificateur" : "Change Verifier view"}>{VERIFIER_PRIMARY_VIEWS.map((view) => {
      const href = links[view]; if (!href) return null;
      return <a key={view} href={href} aria-current={route.view === view ? "page" : undefined}><strong>{viewLabels[view][locale === "fr" ? 1 : 0]}</strong></a>;
    })}</nav>
    {route.view !== "verdict" && <PersistentStoryTimeline catalog={currentCatalog} locale={locale} missionLabel={missionDisplayLabel(missionId, locale)} selectedNodeKey={storyResolution.entry?.nodeKey ?? null} selectionUnresolved={missionContradictory || storyUnresolved || storyAbsent} originAbsent={storyAbsent} recoveryPathHref={storyUnresolved || storyAbsent ? storyRecoveryHref : recoveryPathHref} links={links} linksForEntry={timelineLinksForEntry} onSelectEntry={selectEntry} returnEventHref={["domains", "graph", "nanoreceipts", "forensic"].includes(route.view) ? storyReturnHref ?? undefined : undefined} onReturnEvent={returnToStory} />}
    <VerifierBusinessSearch catalog={currentCatalog} locale={locale} query={uiState.searchQuery} onQueryChange={value => updateUIState({ searchQuery: value })} linksForEntry={linksForEntry} domainHrefForId={domainHrefForId} />
    <div id="verifier-route-content" className="verifier-route-main" tabIndex={-1}>
      <header className="verifier-route-intro"><div>{route.view !== "graph" && <p className="modular-kicker">FortiX · PEB</p>}<h1>{copy[0]}</h1>{route.view !== "graph" && <p>{copy[1]}</p>}</div><a className="verifier-new-tab" href={currentHref} target="_blank" rel="noopener noreferrer">{locale === "fr" ? "Ouvrir dans un nouvel onglet" : "Open in a new tab"} ↗</a></header>
      {missionContradictory ? <section className="modular-empty-state" role="alert" data-mission-context-status="CONTRADICTORY"><h2>{locale === "fr" ? "La mission du lien ne correspond pas au PEB" : "The link mission does not match the PEB"}</h2><p>{locale === "fr" ? "La mission reçue est l’identité de référence. Ce paramètre du lien ne modifie aucun résultat de vérification." : "The received mission owns identity. This URL parameter changes no verification result."}</p><a href={buildVerifierPath(verifierRouteTarget(baseSelection))}>{locale === "fr" ? "Ouvrir avec la mission reçue" : "Open with the received mission"} →</a></section> : storyUnresolved ? <section className="modular-empty-state" role="alert" data-story-context-status={storyResolution.status}>
        <h2>{locale === "fr" ? "L’événement d’origine ne peut pas être retrouvé exactement" : "The original event cannot be found exactly"}</h2>
        <p>{locale === "fr" ? "L’origine indiquée par ce lien est absente, ambiguë ou en dehors de l’histoire. Aucun autre événement ne la remplace." : "The origin in this link is missing, ambiguous, or outside the story. No other event replaces it."}</p>
        <a href={storyRecoveryHref}>{resolution.status === "RESOLVED" && resolution.entry?.timelinePosition !== null ? (locale === "fr" ? "Reprendre la lecture du fait inspecté" : "Resume reading the inspected fact") : (locale === "fr" ? "Ouvrir le Chemin sans sélection" : "Open Path without a selection")} →</a>
      </section> : graphContextUnresolved ? <section className="modular-empty-state" role="alert" data-graph-context-status={graphContext.status}>
        <h2>{graphContext.status === "MISSING_BOUNDARY" ? (locale === "fr" ? "Cette frontière n’est pas retrouvée" : "This boundary was not found") : graphContext.status === "MISSING_RELATION" ? (locale === "fr" ? "Cette relation n’est pas retrouvée" : "This relation was not found") : (locale === "fr" ? "La relation ne correspond pas à cette frontière" : "The relation does not belong to this boundary")}</h2>
        <p>{locale === "fr" ? "Le contexte demandé par ce lien ne peut pas être résolu dans le PEB reçu. Aucune autre frontière ou relation n’est sélectionnée à sa place." : "The context requested by this link cannot be resolved in the received PEB. No other boundary or relation is selected in its place."}</p>
        <a href={buildVerifierPath({ ...verifierRouteTarget(baseSelection), view: "graph", boundaryKey: null, relationKey: null })}>{locale === "fr" ? "Ouvrir le graphe sans cette frontière ou relation" : "Open the graph without this boundary or relation"} →</a>
        <a href={buildVerifierPath({ ...verifierRouteTarget(baseSelection), view: "path", boundaryKey: null, relationKey: null })}>{locale === "fr" ? "← Retour au chemin" : "← Back to path"}</a>
      </section> : <>
      {["path", "timeline", "event", "nanoreceipts"].includes(route.view) && <NetworkLanes model={currentNetwork} locale={locale} selectedNodeKey={resolution.entry?.nodeKey ?? storyResolution.entry?.nodeKey ?? null} linksForEntry={linksForEntry} onSelectEntry={selectEntry} networkHref={links.network} targetView={route.view} />}
      {route.view === "network" && <NetworkView model={currentNetwork} catalog={currentCatalog} locale={locale} selectedNodeKey={resolution.entry?.nodeKey ?? storyResolution.entry?.nodeKey ?? null} linksForEntry={linksForEntry} onSelectEntry={selectEntry}
        inspector={resolution.status === "RESOLVED" && resolution.entry ? <FactInspector as="section" entry={resolution.entry} {...factSupport} locale={locale} text={loaded.entry.text} context="network" neighbourView="network" /> : undefined} />}
      {route.view === "verdict" && <RouteVerdict locale={locale} peb={loaded.peb} graph={loaded.graph} snapshot={verifierSnapshotForDigest(route.pebDigest)} links={links} catalog={currentCatalog} network={currentNetwork} />}
      {route.view === "path" && <GuidedStoryView catalog={currentCatalog} locale={locale} missionLabel={missionDisplayLabel(missionId, locale)} selectedNodeKey={resolution.entry?.nodeKey ?? null} selectionUnresolved={!["EMPTY", "RESOLVED"].includes(resolution.status)} recoveryPathHref={recoveryPathHref} links={links} linksForEntry={linksForEntry} onSelectEntry={selectEntry} focusMode={uiState.focusMode} onFocusModeChange={value => updateUIState({ focusMode: value })} onBack={backToPreviousView} network={currentNetwork} />}
      {route.view === "timeline" && <ReceivedPebInspection {...routeInspection} text={loaded.entry.text} locale={locale} analyzed={!!verifierSnapshotForDigest(route.pebDigest)} snapshot={verifierSnapshotForDigest(route.pebDigest)} view="path" selection={routeEvidenceSelection} onSelectionChange={changeEvidenceSelection} onContextBack={navigateToParent} selectedDomainId={route.domainId} onOpenDomain={openDomain} onNavigate={navigateInspection} onOpenEvidence={openEvidence} onOpenForensic={openForensic} {...uiProps} />}
      {route.view === "domains" && <ReceivedPebInspection {...routeInspection} text={loaded.entry.text} locale={locale} analyzed={!!verifierSnapshotForDigest(route.pebDigest)} snapshot={verifierSnapshotForDigest(route.pebDigest)} view="domains" selection={routeEvidenceSelection} onSelectionChange={changeEvidenceSelection} onContextBack={navigateToParent} selectedDomainId={route.domainId} onOpenDomain={openDomain} onNavigate={navigateInspection} onOpenEvidence={openEvidence} onOpenForensic={openForensic} {...uiProps} />}
      {route.view === "graph" && <ReceivedPebInspection text={loaded.entry.text} {...routeInspection} locale={locale} analyzed={!!verifierSnapshotForDigest(route.pebDigest)} snapshot={verifierSnapshotForDigest(route.pebDigest)} view="graph" dedicated selection={routeEvidenceSelection} onSelectionChange={changeEvidenceSelection} graphMode={route.graphMode} onGraphModeChange={changeMode} followToFinal={route.followToFinal} onFollowToFinalChange={changeFollowToFinal} onOpenEvidence={openEvidence} onOpenForensic={openForensic} onReturnToVerifier={navigateToParent} returnLabel={parentLocationLabel} {...uiProps} {...contextProps} />}
      {route.view === "event" && <EventDetailView graph={loaded.graph} peb={loaded.peb} text={loaded.entry.text} locale={locale} selection={selectionInput(route)} snapshot={verifierSnapshotForDigest(route.pebDigest)} links={links} linksForEntry={linksForEntry} onSelectEntry={selectEntry} focusMode={uiState.focusMode} onFocusModeChange={value => updateUIState({ focusMode: value })} onBack={backToPreviousView} network={currentNetwork} />}
      {route.view === "nanoreceipts" && <NanoReceiptsView graph={loaded.graph} text={loaded.entry.text} locale={locale} selection={selectionInput(route)} links={links} linksForEntry={linksForEntry} onSelectEntry={selectEntry} onFilterChange={changeFilters} query={uiState.nanoReceiptQuery} onQueryChange={value => updateUIState({ nanoReceiptQuery: value })} network={currentNetwork} />}
      {route.view === "forensic" && <ForensicView graph={loaded.graph} peb={loaded.peb} text={loaded.entry.text} locale={locale} selection={selectionInput(route)} snapshot={verifierSnapshotForDigest(route.pebDigest)} links={links} linksForEntry={linksForEntry} onSelectEntry={selectEntry} {...uiProps} />}
      </>}
    </div>
    <p className="verifier-route-live" aria-live="polite">{announcement}</p>
  </main>;
}

function MissingPeb({ route, locale, message, onLoaded, store }: {
  route: VerifierViewRoute; locale: "en" | "fr"; message?: string; onLoaded: (entry: VerifierPebCacheEntry) => void; store: () => VerifierPebStore;
}) {
  const fr = locale === "fr"; const [error, setError] = useState(message ?? ""); const [busy, setBusy] = useState(false);
  const receive = async (file: File | undefined) => {
    if (!file || busy) return; setBusy(true); setError("");
    try {
      const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(await file.arrayBuffer());
      const digest = transferredContentDigest(text);
      if (digest !== route.pebDigest) throw new Error(fr ? "Ce fichier n’est pas le PEB demandé par ce lien." : "This file is not the PEB addressed by this link.");
      const entry = await store().put({ digest, text }); onLoaded(entry);
    } catch (failure) { setError(failure instanceof Error ? failure.message : (fr ? "Lecture impossible." : "Unable to read file.")); }
    finally { setBusy(false); }
  };
  return <main className="nx verifier-route-page"><section className="verifier-route-status" aria-live="polite"><p>FortiX · Verifier</p><h1>{fr ? "PEB absent de cet appareil" : "PEB not on this device"}</h1><p>{fr ? "Ce lien conserve la vue et la sélection, jamais les octets. Chargez le PEB exact pour continuer." : "This link preserves the view and selection, never the bytes. Load the exact PEB to continue."}</p><label className="verifier-new-tab">{busy ? (fr ? "Lecture…" : "Reading…") : (fr ? "Choisir le PEB exact" : "Choose exact PEB")}<input className="verifier-sr" type="file" accept=".json,.txt,application/json,text/plain" disabled={busy} onChange={(event) => { void receive(event.currentTarget.files?.[0]); event.currentTarget.value = ""; }} /></label>{error && <p role="alert">{error}</p>}<a href="/verify">{fr ? "Ouvrir l’entrée du Vérificateur" : "Open Verifier intake"}</a></section></main>;
}

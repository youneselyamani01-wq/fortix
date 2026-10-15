"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { useI18n } from "../I18nProvider";
import { insertD006PebForAnalysis, analyzeInsertedD006Peb, type D006VerdictSnapshot } from "../offlineVerification.ts";
import { transferredContentDigest } from "../portableMissionEvidence.ts";
import { surfaceCopy } from "../../../../site/src/i18n/surface";
import { FortixIcon } from "../../../../site/src/components/icons/FortixIcon";
import { receivePebFromSite } from "../../../../site/src/verification/pebHandoff";
import { receiveDemoParcel, type DemoParcel, type DemoParcelActions } from "./demoHandoff.ts";
import { openGraphInspection, type GraphHandoffStatus } from "./graphHandoff.ts";
import type { ReceivedGraphContext } from "./graphDisplay.ts";
import { verifierCopy } from "./verifierCopy.ts";
import { canVerifyLocally } from "./verificationCapability.ts";
import { inspectReceivedPeb } from "./inspectReceivedPeb.ts";
import { ReceivedPebInspection } from "./ReceivedPebInspection";
import { VerifierRouteClient } from "./VerifierRouteClient";
import { buildVerifierPath, parseVerifierUrl, type VerifierView } from "./verifierRoutes.ts";
import { createVerifierNavigationHistoryState } from "./verifierNavigation.ts";
import { VerifierPebStore } from "./verifierStore.ts";
import { rememberVerifierSnapshot } from "./verifierSession.ts";
import "../nx/nx.css";
import "./verifier.css";
import "./surfaces.css";
import "./visual-hierarchy.css";
import "./verifier-routes.css";

type VerifierTab = "overview" | "peb" | "path" | "domains" | "graph" | "forensic" | "receipts" | "trust";

/** Independent local analysis of received bytes. No peer verdict is accepted. */
export function VerifierWorkspace() {
  const { locale, setLocale, t } = useI18n();
  const c = surfaceCopy[locale];
  const v = verifierCopy[locale];
  const [file, setFile] = useState<{ name: string; text: string; size: number } | null>(null);
  const [held, setHeld] = useState<{ parcel: DemoParcel; actions: DemoParcelActions; size: number } | null>(null);
  const [mission, setMission] = useState("");
  const [run, setRun] = useState("");
  const [digest, setDigest] = useState("");
  const [embeddedView, setEmbeddedView] = useState<VerifierView | null>(null);
  const embeddedViewRef = useRef<VerifierView | null>(null);
  const [demoContext, setDemoContext] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [over, setOver] = useState(false);
  const [error, setError] = useState<"fileError" | "error" | "cryptoUnavailable" | null>(null);
  const [snapshot, setSnapshot] = useState<D006VerdictSnapshot | null>(null);
  const [activeTab, setActiveTab] = useState<VerifierTab>("peb");
  const [packageOpen, setPackageOpen] = useState(false);
  const [graphStatus, setGraphStatus] = useState<GraphHandoffStatus | null>(null);
  const graphTransfers = useRef(new Set<() => void>());
  useEffect(() => { const transfers = graphTransfers.current; return () => { for (const stop of transfers) stop(); }; }, []);
  const tabCopy = locale === "fr" ? { overview: "Vue d’ensemble", peb: "Verdict", path: "Timeline + Chemin", domains: "Domaines", graph: "Graphe causal", forensic: "Forensic", receipts: "Reçus", trust: "Confiance", empty: "Déposez un PEB pour ouvrir cette vue.", receive: "Recevoir un PEB", inspect: "Inspecter le PEB", received: "Paquet reçu", none: "Aucun paquet reçu", pending: "Non analysé", note: "Recevoir et inspecter un paquet ne lui attribue aucun verdict.", scope: "Lecture des preuves reçues", held: "PEB en main — dépôt requis" } : { overview: "Overview", peb: "Verdict", path: "Timeline + Path", domains: "Domains", graph: "Causal graph", forensic: "Forensic", receipts: "Receipts", trust: "Trust", empty: "Drop a PEB to open this view.", receive: "Receive a PEB", inspect: "Inspect PEB", received: "Package received", none: "No package received", pending: "Not analyzed", note: "Receiving and inspecting a package does not assign it a verdict.", scope: "Inspect received evidence", held: "PEB held — drop required" };
  const openTab = (tab: VerifierTab) => {
    setActiveTab(tab);
    requestAnimationFrame(() => {
      const menu = document.querySelector<HTMLDetailsElement>(".verifier-technical-menu");
      if (menu) menu.open = false;
      const surface = document.getElementById("verifier-surface");
      surface?.scrollIntoView({ block: "start" });
      surface?.focus({ preventScroll: true });
    });
  };
  const generation = useRef(0);
  const busyRef = useRef(false);
  const demoStop = useRef<(() => void) | null>(null);
  const reportAnalyze = useRef<(() => void) | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const verifierStore = useRef<VerifierPebStore | null>(null);
  const verifierStoreWrite = useRef<Promise<unknown> | null>(null);
  const received = useMemo(() => file ? inspectReceivedPeb(file.text) : null, [file]);
  useEffect(() => {
    if (!file || !received) return;
    try {
      const store = verifierStore.current ?? new VerifierPebStore({ digestText: transferredContentDigest });
      verifierStore.current = store;
      const write = store.put({ digest: received.transferDigest, text: file.text });
      verifierStoreWrite.current = write;
      void write.catch(() => {});
    } catch { /* IndexedDB is an enhancement; the current Verifier remains usable in memory. */ }
  }, [file, received]);
  useEffect(() => () => { verifierStore.current?.close(); verifierStore.current = null; }, []);
  useEffect(() => { embeddedViewRef.current = embeddedView; }, [embeddedView]);
  useEffect(() => {
    const onPopState = () => {
      const parsed = parseVerifierUrl(window.location.href);
      if (!parsed.ok) return;
      if (parsed.route.kind === "intake" && embeddedViewRef.current) {
        embeddedViewRef.current = null;
        setEmbeddedView(null);
      } else if (parsed.route.kind === "view" && !embeddedViewRef.current) {
        embeddedViewRef.current = parsed.route.view;
        setEmbeddedView(parsed.route.view);
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  const ready = !!file?.text && !!mission.trim() && !!run.trim() && /^[0-9a-f]{64}$/i.test(digest.trim()) && !busy && !reading;
  const resetResult = () => { setSnapshot(null); setError(null); };
  const receive = useCallback(async (files: FileList | readonly File[] | null): Promise<boolean> => {
    if (busyRef.current) return false;
    const current = ++generation.current;
    demoStop.current?.(); reportAnalyze.current = null;
    setHeld(null); setDemoContext(false); setMission(""); setRun(""); setDigest("");
    setSnapshot(null); setPackageOpen(false); setError(null); setFile(null); setReading(false);
    if (!files || files.length !== 1 || files[0].size > 20 * 1024 * 1024 || files[0].size === 0) { setError("fileError"); return false; }
    const selected = files[0]; setReading(true);
    try {
      const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(await selected.arrayBuffer());
      if (current !== generation.current) return false;
      setFile({ name: selected.name, size: selected.size, text });
      return true;
    } catch { if (current === generation.current) setError("error"); return false; }
    finally { if (current === generation.current) setReading(false); }
  }, []);
  useEffect(() => {
    const stopSite = receivePebFromSite(async (selected, sourceLocale) => {
      setLocale(sourceLocale);
      return receive([selected]);
    }, () => setError("error"));
    const stopDemo = receiveDemoParcel(async (parcel, actions) => {
      if (busyRef.current) return false;
      const size = new TextEncoder().encode(parcel.text).byteLength;
      if (size > 20 * 1024 * 1024 || transferredContentDigest(parcel.text) !== parcel.expected.transferredContentDigest) { setError("fileError"); return false; }
      generation.current += 1;
      setLocale(parcel.locale); setFile(null); setHeld({ parcel, actions, size }); setActiveTab("peb");
      // This separate transport context is supplied by the source handoff, never parsed from its PEB.
      setMission(parcel.expected.missionId); setRun(parcel.expected.runId); setDigest(parcel.expected.transferredContentDigest);
      setDemoContext(true); reportAnalyze.current = null;
      setSnapshot(null); setPackageOpen(false); setError(null); setReading(false);
      return true;
    }, () => setError("error"));
    demoStop.current = stopDemo;
    return () => { stopSite(); stopDemo(); generation.current += 1; reportAnalyze.current = null; };
  }, [receive, setLocale]);
  function dropHeld() {
    if (!held || busyRef.current || !held.actions.reportDrop()) return;
    generation.current += 1;
    setFile({ name: "FortiX PEB", text: held.parcel.text, size: held.size });
    reportAnalyze.current = held.actions.reportAnalyze;
    setHeld(null); setError(null);
  }
  async function analyze() {
    if (!ready || !file) return;
    const current = generation.current;
    resetResult();
    if (!canVerifyLocally()) { setError("cryptoUnavailable"); return; }
    busyRef.current = true; setBusy(true);
    try {
      const inserted = insertD006PebForAnalysis({ pebText: file.text, expectedIdentity: { missionId: mission.trim(), runId: run.trim() }, expectedTransferredContentDigest: digest.trim() });
      // Only this user gesture reports an Analyze intent. The optional port is not an input to the result.
      reportAnalyze.current?.();
      const localSnapshot = await analyzeInsertedD006Peb(inserted);
      if (current === generation.current) rememberVerifierSnapshot(localSnapshot);
      if (current === generation.current) setSnapshot(localSnapshot);
    } catch { if (current === generation.current) setError("error"); }
    finally { busyRef.current = false; if (current === generation.current) setBusy(false); }
  }
  const inspectionSnapshot = snapshot?.transferredContentDigest === received?.transferDigest ? snapshot : null;
  const openDedicatedGraph = (context: ReceivedGraphContext) => {
    if (!file || !received) return;
    let pending = true; const transfer: { stop?: () => void } = {};
    const onStatus = (status: GraphHandoffStatus) => {
      setGraphStatus(status);
      if (status !== "opening") { pending = false; if (transfer.stop) graphTransfers.current.delete(transfer.stop); }
    };
    transfer.stop = openGraphInspection({ text: file.text, name: file.name, digest: received.transferDigest, locale, context, snapshot: inspectionSnapshot, onStatus });
    if (pending) graphTransfers.current.add(transfer.stop);
  };
  const result = snapshot?.result;
  const expectationInputs = <fieldset disabled={busy}><legend className="verifier-sr">{c.expectations}</legend>
    <label>{c.mission}<input value={mission} readOnly={demoContext} onChange={(event) => { resetResult(); setMission(event.target.value); }} autoComplete="off" /></label>
    <label>{c.run}<input value={run} readOnly={demoContext} onChange={(event) => { resetResult(); setRun(event.target.value); }} autoComplete="off" /></label>
    <label>{c.digest}<input value={digest} readOnly={demoContext} onChange={(event) => { resetResult(); setDigest(event.target.value); }} autoComplete="off" spellCheck={false} /></label>
  </fieldset>;
  const readingKey = result?.verdict === "VALID" ? "valid" : result?.verdict === "INVALID" ? "invalid" : result?.verdict === "REVOKED" ? "revoked" : "indeterminate";
  const establishedChecks = result?.completedChecks.filter(check => ["d006_transferred_digest_exact", "canonical_signatures_verified", "d006_final_receipt_closure"].includes(check)) ?? [];
  const verdictLimits = result ? [
    result.reasonCodes.some(reason => reason.includes("PRODUCTION_TRUST_TIME")) ? (locale === "fr" ? "Aucun horodatage de production vérifié n’est établi dans ce contexte de démonstration." : "No verified production timestamp is established in this demonstration context.") : null,
    result.reasonCodes.some(reason => reason.includes("SETTLEMENT")) ? (locale === "fr" ? "Les preuves contrôlées n’établissent pas un règlement financier." : "The checked evidence does not establish financial settlement.") : null,
  ].filter((item): item is string => !!item) : [];
  const isInspection = activeTab === "graph" && !!file;
  const stage = held ? "held" : file ? result ? "analyzed" : "received" : "empty";
  const modularLinks: Partial<Record<VerifierView, string>> = received ? Object.fromEntries((["verdict", "path", "timeline", "domains", "graph", "nanoreceipts", "forensic"] as const).map(view => [view, buildVerifierPath({ pebDigest: received.transferDigest, view })])) : {};
  const openModularRoute = (event: ReactMouseEvent<HTMLAnchorElement>, view: VerifierView) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const path = modularLinks[view];
    if (!path) return;
    event.preventDefault();
    void (async () => {
      try { await verifierStoreWrite.current; } catch { /* The dedicated view will offer an exact-file reload if cache storage failed. */ }
      window.history.pushState(createVerifierNavigationHistoryState(window.history.state, "/verify", path), "", path);
      embeddedViewRef.current = view;
      setEmbeddedView(view);
    })();
  };
  const returnToIntake = useCallback(() => {
    embeddedViewRef.current = null;
    setEmbeddedView(null);
  }, []);
  const modularNavigation = file && received && <section className="verifier-modular-launches" aria-labelledby="verifier-modular-title"><header><p className="verifier-eyebrow">{locale === "fr" ? "Vues dédiées" : "Dedicated views"}</p><h2 id="verifier-modular-title">{locale === "fr" ? "Une question par page" : "One question per page"}</h2><p>{locale === "fr" ? "Commencez par la lecture des faits. Chaque vue conserve le PEB et votre contexte." : "Start by reading the facts. Every view keeps the PEB and your context."}</p></header><nav>{(["verdict", "path", "timeline", "domains", "graph", "nanoreceipts", "forensic"] as const).map((view) => <a key={view} href={modularLinks[view]} onClick={(event) => openModularRoute(event, view)}><strong>{({ verdict: tabCopy.peb, path: locale === "fr" ? "Chemin" : "Path", timeline: "Timeline", domains: tabCopy.domains, graph: tabCopy.graph, nanoreceipts: locale === "fr" ? "NanoReceipts" : "NanoReceipts", forensic: tabCopy.forensic })[view]}</strong><span>{locale === "fr" ? "Ouvrir la vue" : "Open view"} →</span></a>)}</nav></section>;
  if (embeddedView) return <VerifierRouteClient requestedView={embeddedView} onReturnToIntake={returnToIntake} />;
  const intake = <>
    <div className="verifier-grid" id="verification-intake" data-has-peb={!!file || !!held}>
      <section className="verifier-intake" aria-labelledby="receive-title">
        <h2 id="receive-title" className={!file && !held ? "verifier-sr" : undefined}>{file ? v.receivedTitle : v.receiveTitle}</h2>
        <div className="verifier-drop" data-over={over} data-received={!!file} data-awaiting-held={!!held} onDragOver={(event) => { event.preventDefault(); if (!busy) setOver(true); }} onDragLeave={() => setOver(false)} onDrop={(event) => { event.preventDefault(); setOver(false); void receive(event.dataTransfer.files); }}>
          {held ? <>
            <div className="verifier-held" data-held-digest={held.parcel.expected.transferredContentDigest}>
              <span className="verifier-drop-symbol" aria-hidden="true">PEB</span>
              <p className="verifier-packet-state">{v.held}</p><h3>{v.dropHeld}</h3><p>{v.heldNote}</p>
              <details className="verifier-identity-details"><summary>{v.identityDetails}</summary><dl className="verifier-held-identity"><div><dt>{v.identityMission}</dt><dd><code>{held.parcel.expected.missionId}</code></dd></div><div><dt>{v.identityRun}</dt><dd><code>{held.parcel.expected.runId}</code></dd></div><div><dt>{v.identityDigest}</dt><dd><code>{held.parcel.expected.transferredContentDigest}</code></dd></div></dl></details>
            </div>
            <button className="verifier-action" type="button" onClick={dropHeld}>{v.dropHeld}</button>
          </> : file && received ? <div className="verifier-artifact" data-received-digest={received.transferDigest}>
            <span className="verifier-drop-symbol" aria-hidden="true">PEB</span>
            <div className="verifier-artifact-heading"><p className="verifier-packet-state">{result ? v.analyzed : v.received}</p><h3>{file.name}</h3></div>
            <details className="verifier-identity-details"><summary>{v.identityDetails}</summary><dl className="verifier-held-identity"><div><dt>{v.identityMission}</dt><dd><code>{received.identity.missionId ?? "—"}</code></dd></div><div><dt>{v.identityRun}</dt><dd><code>{received.identity.runId ?? "—"}</code></dd></div><div><dt>{v.identityDigest}</dt><dd><code>{received.transferDigest}</code></dd></div></dl></details>
          </div> : <><span className="verifier-drop-symbol" aria-hidden="true">PEB</span><h3>{v.awaiting}</h3><p>{v.emptyNote}</p></>}
          {!held && <button className={file ? "verifier-select" : "verifier-action verifier-select"} type="button" disabled={busy} onClick={() => fileInput.current?.click()}>{file ? v.replaceFile : c.select}</button>}<input ref={fileInput} className="verifier-sr" tabIndex={-1} aria-label={c.select} id="evidence-file" type="file" accept=".json,.txt,application/json,text/plain" disabled={busy} onChange={(event) => { void receive(event.target.files); event.target.value = ""; }} />
          {!held && <span className="verifier-drop-label">{file ? c.drop : v.fileHint}</span>}
        </div>
        <p className="verifier-status" role="status">{held ? v.held : file ? `${c.received} ${file.name} · ${new Intl.NumberFormat(locale, { style: "unit", unit: "byte", unitDisplay: "long" }).format(file.size)}` : c.waiting}</p>
      </section>
      {(file || held) && <section className="verifier-expectations" aria-labelledby="expected-title"><h2 id="expected-title">{v.analysisTitle}</h2>
        {demoContext ? <details className="verifier-expected-details"><summary>{v.expectedDetails}</summary><p>{v.demoContextNote}</p>{expectationInputs}</details> : <><p>{c.expectationNote}</p>{expectationInputs}</>}
        {demoContext && <p className="verifier-local-continuity">{v.localContinuity}</p>}
        <div className="verifier-analysis"><button className="verifier-action" type="button" aria-busy={busy} disabled={!ready} onClick={() => void analyze()}><FortixIcon name="analyze" size={18} />{c.analyze}</button><span role="status" aria-live="polite">{busy ? c.analyzing : held ? v.dropFirst : ready && !result && !error ? c.ready : ""}</span></div>
      </section>}
      {error && <p className="verifier-error" role="alert" data-operational-error={error === "cryptoUnavailable" ? "crypto-unavailable" : undefined}>{error === "cryptoUnavailable" ? v.cryptoUnavailable : c[error]}</p>}
    </div>
    {file && <details className="verifier-package-details" onToggle={event => setPackageOpen(event.currentTarget.open)}><summary>{v.packageDetails}</summary>{packageOpen && <section id="received-peb-inspection"><ReceivedPebInspection text={file.text} locale={locale} analyzed={!!inspectionSnapshot} snapshot={inspectionSnapshot} view="structure" /></section>}</details>}
  </>;
  return <main className="nx verifier-page verifier-flow" data-active-tab={activeTab} data-stage={stage} data-workspace={isInspection ? "inspection" : "entry"} data-peb-state={held ? "HELD" : file ? result ? "ANALYZED" : "RECEIVED" : "AWAITING"}>
    <a className="verifier-skip" href="#verifier-surface">{t.nav.skipToContent}</a>
    <header className="verifier-top"><a className="verifier-brand" href="/nx">FortiX</a>
      {!isInspection && <a className="verifier-demo-link" href="/nx">{c.demo}</a>}<span>{isInspection ? v.inspectionWorkspace : c.title}</span>
      <div className="nx-language" role="group" aria-label={t.nav.languageLabel}>
        <button type="button" lang="en" aria-pressed={locale === "en"} onClick={() => setLocale("en")}>EN</button>
        <button type="button" lang="fr" aria-pressed={locale === "fr"} onClick={() => setLocale("fr")}>FR</button>
      </div>
    </header>
    <div className="verifier-content">
      {!file && <header className="verifier-entry-heading">
        <p className="verifier-eyebrow">{c.title}</p><h1>{held ? v.heldTitle : v.entryTitle}</h1><p className="verifier-lede">{v.entryNote}</p>
        <ol className="verifier-entry-steps" aria-label={v.journeyLabel}><li aria-current="step"><span>1</span>{c.receive}</li><li><span>2</span>{c.analyze}</li><li><span>3</span>{c.verdict}</li><li><span>4</span>{c.inspect}</li></ol>
      </header>}
      {file && <header className="verifier-workspace-context">
        <div className="verifier-context-heading">
          {isInspection ? <button className="verifier-context-back" type="button" onClick={() => openTab("peb")}>← {result ? v.backToResult : v.backToPeb}</button> : activeTab !== "peb" ? <button className="verifier-context-back" type="button" onClick={() => openTab("peb")}>← {result ? v.backToResult : v.backToPeb}</button> : <p className="verifier-eyebrow">{v.receivedTitle}</p>}
          <p className="verifier-context-file"><span aria-hidden="true">PEB</span><strong>{file.name}</strong></p>
        </div>
        <div className="verifier-context-actions"><span className="verifier-context-verdict" data-verdict={result?.verdict}>{result?.verdict ?? tabCopy.pending}</span></div>
      </header>}
      <section id="verifier-surface" role={file ? "tabpanel" : undefined} aria-labelledby={file ? `verifier-tab-${activeTab}` : undefined} aria-label={isInspection ? v.inspectionWorkspace : tabCopy[activeTab]} tabIndex={-1} data-surface={activeTab}>
        {activeTab !== "peb" && activeTab !== "graph" && <header className="verifier-surface-title"><p className="verifier-eyebrow">{tabCopy.scope}</p><h1>{tabCopy[activeTab]}</h1></header>}
        {result && (activeTab === "overview" || activeTab === "peb") && <section className="verifier-result verifier-primary-result" data-verdict={result.verdict} data-analyzed-digest={snapshot.transferredContentDigest} aria-labelledby="verdict-title" aria-live="polite">
          <p className="verifier-eyebrow">{v.resultTitle}</p><h1 id="verdict-title">{result.verdict}</h1><p className="verifier-result-reading">{c[readingKey]}</p>
          {establishedChecks.length > 0 && <div className="verifier-established"><h2>{v.establishedChecks}</h2><ul className="verifier-established-summary">{establishedChecks.map(check => <li key={check}>{t.d006c2.verifier.checkLabels[check] ?? (locale === "fr" ? "Contrôle technique terminé" : "Technical check completed")}</li>)}</ul></div>}
          {received?.knownProfile && <section className="verifier-demo-context"><h2>{v.demoContextTitle}</h2><p>{v.demoContextVerdict}</p></section>}
          {modularLinks.path ? <a className="verifier-action" href={modularLinks.path} onClick={(event) => openModularRoute(event, "path")}><FortixIcon name="inspect" size={18} />{locale === "fr" ? "Lire les faits" : "Read the facts"}<span aria-hidden="true">→</span></a> : <button className="verifier-action" type="button" onClick={() => openTab("path")}><FortixIcon name="inspect" size={18} />{locale === "fr" ? "Lire les faits" : "Read the facts"}<span aria-hidden="true">→</span></button>}
          {verdictLimits.length > 0 && <details className="verifier-verdict-limits"><summary>{v.verdictLimits} · {verdictLimits.length} {locale === "fr" ? "limites" : "limits"}</summary><ul>{verdictLimits.map(limit => <li key={limit}>{limit}</li>)}</ul><p className="verifier-scope">{c.limits}</p></details>}
          {modularLinks.forensic && <p className="verifier-scope"><a href={modularLinks.forensic} onClick={(event) => openModularRoute(event, "forensic")}>{locale === "fr" ? "Voir l’identité technique en Forensic" : "View technical identity in Forensic"} →</a></p>}
        </section>}
        {activeTab === "peb" && (result ? <details className="verifier-receipt-details"><summary>{v.receiptDetails}</summary>{intake}</details> : intake)}
        {activeTab === "overview" && <section className="verifier-overview">
          <div className="verifier-overview-grid"><article><p>{tabCopy.peb}</p><h3>{held ? tabCopy.held : file ? tabCopy.received : tabCopy.none}</h3><p>{file ? file.name : tabCopy.note}</p></article><article><p>{locale === "fr" ? "Membres reçus du PEB" : "Received PEB members"}</p><h3>{received ? `${received.memberCount} ${locale === "fr" ? "membres" : "members"}` : (locale === "fr" ? "Aucun PEB chargé" : "No PEB loaded")}</h3><p>{v.declared}</p></article><article data-verdict={result?.verdict}><p>{c.verdict}</p><h3>{result?.verdict ?? tabCopy.pending}</h3><p>{c.limits}</p></article></div>
          <button className="verifier-action" type="button" onClick={() => openTab("peb")}>{file ? tabCopy.inspect : tabCopy.receive}</button>
          {file && <div className="verifier-overview-actions"><button type="button" onClick={() => openTab("path")}>{tabCopy.path} →</button><button type="button" onClick={() => openTab("domains")}>{tabCopy.domains} →</button><button type="button" onClick={() => openTab("graph")}>{tabCopy.graph} →</button></div>}
        </section>}
        {activeTab !== "overview" && activeTab !== "peb" && (file ? <ReceivedPebInspection text={file.text} locale={locale} analyzed={!!inspectionSnapshot} snapshot={inspectionSnapshot} view={activeTab === "forensic" ? "structure" : activeTab} onNavigate={openTab} onOpenDedicatedGraph={openDedicatedGraph} /> : <div className="verifier-empty-surface"><p>{tabCopy.empty}</p><button className="verifier-action" type="button" onClick={() => openTab("peb")}>{tabCopy.receive}</button></div>)}
        {(graphStatus === "blocked" || graphStatus === "failed") && <p className="verifier-error" role="alert">{locale === "fr" ? "Le graphe n’a pas pu s’ouvrir. Autorisez l’onglet puis réessayez avec Ouvrir le graphe complet." : "The graph could not open. Allow the tab, then try Open full causal graph again."}</p>}
        {activeTab === "trust" && result && <section id="verification-record" className="verifier-record"><h2>{c.inspectTitle}</h2>
          <details className="verifier-checks"><summary>{c.checked} · {c.reasons}</summary><div className="verifier-record-grid"><div><h3>{c.checked}</h3>{result.completedChecks.length ? <ul>{result.completedChecks.map(check => <li key={check}><span>{t.d006c2.verifier.checkLabels[check] ?? (locale === "fr" ? "Contrôle technique terminé" : "Technical check completed")}</span></li>)}</ul> : <p>{c.noChecks}</p>}</div>
            <div><h3>{c.reasons}</h3>{result.reasonCodes.length ? <><p>{locale === "fr" ? `${result.reasonCodes.length} motifs techniques enregistrés. Les codes exacts restent dans Forensic.` : `${result.reasonCodes.length} technical reasons recorded. Exact codes remain in Forensic.`}</p>{verdictLimits.length > 0 && <ul>{verdictLimits.map(reason => <li key={reason}>{reason}</li>)}</ul>}</> : <p>{c.noReasons}</p>}</div></div></details>
        </section>}
      </section>
      {modularNavigation}
    </div>
  </main>;
}

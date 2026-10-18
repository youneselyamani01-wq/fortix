"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import { useI18n } from "../../I18nProvider";
import { formatExperienceTime, HANDOFF_READY_MS } from "../../storyTimeline.ts";
import {
  derivePublicExperience,
  type ActionFamily,
  type PublicExperienceModel,
} from "../adapter/publicExperienceAdapter.ts";
import { useMissionEngine } from "../adapter/useMissionEngine.ts";
import { type DossierState } from "../workspace/EvidenceDossier.tsx";
import { openDemoVerifier, sameDemoArtifact, type DemoHandoffStatus } from "../../verify/demoHandoff.ts";
import { verifierCopy as fsVerifierCopy } from "../../verify/verifierCopy.ts";
import { FortixIcon } from "../../../../../site/src/components/icons/FortixIcon";
import { PebGlyph } from "../workspace/PebGlyph.tsx";
import "./mission-surface.css";
import type { InspectSection } from "../verifier/inspectSections.ts";
import { missionReceiptSummary, type MissionReceiptSummary } from "../workspace/missionReceiptSummary.ts";
import { linkLine, networkReceiptLine } from "../workspace/workspaceLines.ts";
import { WorldStage } from "../world/WorldStage.tsx";
import "../nx.css";
import { surfaceCopy } from "../../../../../site/src/i18n/surface";

/** Mission observation and compact PEB transport only. Detailed evidence lives in /verify. */
/** Legacy review-link shape retained for compatibility; no drawer is mounted. */
export type WorkspaceState = Readonly<{
  verifier: boolean;
  /** The INSPECT section open in the verifier, or null. Meaningful only once a verdict exists. */
  inspect: InspectSection | null;
  dossier: DossierState;
}>;


export function NxExperience({ initialMasterTimeMs = 0, initialActs = {}, initialExperienceMode = "PUBLIC_SIMULATION" }: {
  initialMasterTimeMs?: number;
  /** Public playback is separately declared; physical local tests retain sentinel admission. */
  initialExperienceMode?: "PUBLIC_SIMULATION" | "PHYSICAL_SENTINEL";
  /** Legacy presentation hints are accepted but cannot reopen removed inspection surfaces. */
  initialWorkspace?: WorkspaceState;
  /** Review deep link only: human acts already performed (`?decision=approved&handoff=done&analysis=requested`). */
  initialActs?: Readonly<{ decision?: "APPROVED"; pebPicked?: boolean; handoffDone?: boolean; analysisRequested?: boolean }>;
  /** Review deep link only (`?select=<evidence id>`): a receipt selected on the proof, no panel opened. */
  initialSelection?: string | null;
} = {}) {
  const { locale, t, setLocale } = useI18n();
  const nx = t.nx;
  const engine = useMissionEngine(initialMasterTimeMs, { ...initialActs, experienceMode: initialExperienceMode });
  const isPublicSimulation = engine.experienceMode === "PUBLIC_SIMULATION";
  const missionPlayable = isPublicSimulation || engine.networkBaselineReady;
  // The mission (what is true) and the presentation cursor (how far a viewer
  // has been walked through it) are separate inputs, and only the first has any
  // authority. C-R1's queue reads the second to serialise arrivals.
  const model = useMemo(
    () => derivePublicExperience(engine.snapshot, engine.presentationTimeMs),
    [engine.presentationTimeMs, engine.snapshot],
  );
  // A handoff launch target, never an embedded verifier. Receipt is acknowledged by the separate tab.
  const [handoffStatus, setHandoffStatus] = useState<DemoHandoffStatus>("idle");
  const handoffStop = useRef<(() => void) | null>(null);
  const currentEngine = useRef(engine);
  useLayoutEffect(() => { currentEngine.current = engine; }, [engine]);
  const artifactRun = engine.snapshot.handoffArtifact?.identity.runId;
  const artifactDigest = engine.snapshot.handoffArtifact?.transferredContentDigest;
  useEffect(() => () => { handoffStop.current?.(); }, [artifactRun, artifactDigest]);
  const fs = fsVerifierCopy[locale];
  const statement = model.currentFact === null
    ? null
    : t.d006c3.facts.statements[model.currentFact.factId] ?? model.currentFact.factId;
  const factKicker = model.currentFact === null ? null : t.d006c3.factSections[model.currentFact.section];
  const phase = model.mission.phase;
  const primaryLabel = phase === "READY"
    ? nx.start
    : phase === "RUNNING"
      ? nx.pause
      : phase === "COMPLETE" || phase === "STOPPED_BY_DENIAL"
        ? nx.restart
        : nx.resume;
  const resetMission = () => {
    handoffStop.current?.(); handoffStop.current = null;
    setHandoffStatus("idle");
    engine.restart();
  };
  const onPrimary = () => {
    if (phase === "RUNNING") engine.pause();
    else if (phase === "COMPLETE" || phase === "STOPPED_BY_DENIAL") resetMission();
    else if (phase !== "HOLDING_FOR_AUTHORITY") engine.play();
  };

  const closeHandoff = useCallback(() => {
    if (model.handoff.stage === "CARRIED") { handoffStop.current?.(); engine.release(); }
    setHandoffStatus("idle");
  }, [engine, model.handoff.stage]);
  const pickUp = useCallback(() => { engine.pick(); setHandoffStatus("idle"); }, [engine]);
  const submitPeb = useCallback(() => {
    const source = currentEngine.current;
    const artifact = source.snapshot.handoffArtifact;
    if (artifact === null || !["FORMED", "TRANSFERRED"].includes(source.snapshot.transferStage)) return;
    handoffStop.current?.();
    handoffStop.current = openDemoVerifier({ artifact, locale, onStatus: setHandoffStatus,
      onReceived: (expected) => {
        const current = currentEngine.current;
        if (!sameDemoArtifact(current.snapshot.handoffArtifact, expected)) return false;
        if (current.snapshot.transferStage === "TRANSFERRED") return true;
        if (current.snapshot.transferStage !== "FORMED") return false;
        // Receipt, not opening or PICK, is the existing engine DROP act.
        current.drop();
        return true;
      },
      onAnalyze: (expected) => {
        const current = currentEngine.current;
        if (current.snapshot.transferStage !== "TRANSFERRED" || !sameDemoArtifact(current.snapshot.handoffArtifact, expected)) return;
        // An explicit Analyze gesture in the child asks this engine to verify its own bytes.
        // The independently computed child verdict is never imported into this journal.
        current.analyze();
      },
    });
  }, [locale]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { if (model.handoff.stage === "CARRIED") closeHandoff(); return; }
      const target = event.target;
      // Keys pressed inside the verifier act on the instrument, never on the
      // mission behind it: Space there is not the page's play/pause/restart.
      if (target instanceof HTMLElement && target.closest("button, input, select, textarea, a, summary, [role='button'], .nx-panel-body, [role='dialog']")) return;
      if (event.code === "Space") {
        event.preventDefault();
        onPrimary();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const availableReceipts = useMemo(() => missionReceiptSummary(model.accumulatedEvidence.items, engine.snapshot.session), [model.accumulatedEvidence.items, engine.snapshot.session]);
  const count = availableReceipts.count;
  const networkReceipts = networkReceiptLine(model.network, locale);
  const compactCopy = locale === "fr" ? { mission: "Mission", evidence: "Progression des preuves", ready: "PEB prêt", pending: "PEB en constitution", pick: "Prendre le PEB", details: "Inspection dans le vérificateur indépendant", sealed: "scellés", journal: "journal" } : { mission: "Mission", evidence: "Evidence progression", ready: "PEB ready", pending: "PEB forming", pick: "Pick PEB", details: "Inspect in the Independent Verifier", sealed: "sealed", journal: "journal" };
  const activeRouteLabel = engine.activeConnectivityMedium === "ethernet"
    ? "RJ45 · Intel I226-LM"
    : engine.activeConnectivityMedium === "wifi"
      ? "Wi-Fi · Intel BE200"
      : engine.activeConnectivityMedium === "cellular_5g"
        ? "5G"
        : engine.activeConnectivityMedium === "satellite"
          ? "Satellite"
          : locale === "fr" ? "Aucune voie active" : "No active route";

  return (
    <main
      className="nx nx-mission-surface"
      data-nx-checkpoint="B-R2"
      data-mission-phase={phase}
      data-master-time={model.mission.masterTimeMs}
      data-current-fact={model.currentFact?.factId ?? ""}
      data-current-fact-fresh={model.currentFact?.fresh ? "true" : "false"}
      data-latest-evidence={model.latestEvidence?.evidenceId ?? ""}
      data-latest-evidence-phase={model.latestEvidence?.phase ?? "NONE"}
      data-owning-receipt={model.presentation.owning?.evidenceId ?? ""}
      data-owning-ordinal={model.presentation.owning?.ordinal.label ?? ""}
      data-receipts-queued={String(model.presentation.queuedCount)}
      data-receipts-arriving={String(model.presentation.arrivingCount)}
      data-evidence-count={count}
      data-presented-evidence-count={availableReceipts.presentedCount}
      data-network-nr-count={availableReceipts.networkCount}
      data-network-baseline-ready={engine.networkBaselineReady}
      data-experience-mode={engine.experienceMode}
      data-active-connectivity={engine.activeConnectivityMedium ?? ""}
      data-connectivity-paths={engine.connectivityPaths.map((path) => `${path.medium}:${path.state}`).join(" ")}
      data-bound-adapter-guid={engine.physicalAdapterBinding?.interfaceGuid ?? ""}
      data-bound-adapter-index={engine.physicalAdapterBinding?.ifIndex ?? ""}
      data-history-retained={model.mission.masterTimeMs === 0 && engine.snapshot.session.records.length > 0}
      data-sealed-count={model.accumulatedEvidence.sealedCount}
      data-journal-count={model.accumulatedEvidence.journalCount}
      data-final-receipt={model.finalReceipt?.receiptId ?? ""}
      data-provenance-branches={model.accumulatedEvidence.branches.join(" ")}
      data-unresolved-provenance={model.accumulatedEvidence.unresolvedProvenance.length}
      data-network-state={model.network.state}
      data-link-phase={model.network.linkPhase}
      data-sentinel={model.network.sentinelReachable ? "reachable" : "unreachable"}
      data-transition-flash={model.network.transitionFlash ?? ""}
      data-unsequenced-observation={model.network.unsequencedObservation ?? ""}
      data-evidence-locality={model.network.evidenceLocality}
      data-network-receipts={`${model.network.lostCount} ${model.network.restoredCount} ${model.network.reconciliationReceiptCount}`}
      data-run-id={model.expertRefs.runId}
      data-mission-id={model.expertRefs.missionId}
      data-workspace="compact"
      data-selection=""
      data-handoff={model.handoff.stage}
      data-verification-state={model.verification.state}
      data-carry={model.handoff.stage === "CARRIED" ? "held" : "idle"}
      style={{ "--pulse": pulseFor(model.latestEvidence?.actionFamily ?? null) } as CSSProperties}
    >
      <header className="nx-top">
        <span className="nx-brand"><strong>FortiX</strong><span>{nx.kicker}</span></span>
        <a className="nx-surface-link" href="/verify" target="_blank" rel="noopener noreferrer">{surfaceCopy[locale].title}</a>
        <span className="nx-mission-label">{compactCopy.mission}</span>
        {/* C-R2-F04 — THE LINK, AS A SIGNAL AND NOTHING ELSE.
            Human review found the written network status verbose and
            semantically noisy: it mixed link state with where evidence is
            kept, which are different facts. The chip now carries no visible
            words at all — four bars, filled when the sentinel observes the
            link, struck through when it observes a loss, and hollow when it
            has observed nothing. The last case matters most: an unobserved
            link must never be drawn as a connected one.
            The accessible name still states the observed link state in words,
            because a glyph with no name is unusable to a screen reader; it is
            an accessible name, not a visible label. */}
        <span
          className="nx-link-chip"
          data-link={model.network.linkPhase}
          data-flash={model.network.transitionFlash ?? ""}
          data-sentinel={model.network.sentinelReachable ? "OK" : "ABSENT"}
          aria-label={[
            linkLine(model.network, nx.link),
            model.network.linkPhase === "LOST" ? nx.link.lostNote : null,
            model.network.sentinelReachable ? null : nx.link.sentinelAbsent,
          ].filter((part) => part !== null).join(" · ")}
          role="status"
        >
          <i aria-hidden="true"><b /><b /><b /><b /></i>
        </span>
        {networkReceipts !== null && <span className="nx-network-receipt-count" role="status" title={networkReceipts.detail} aria-label={networkReceipts.detail}>{networkReceipts.label}</span>}
        <div className="nx-language" role="group" aria-label={nx.languageAria}>
          <button type="button" lang="en" aria-pressed={locale === "en"} onClick={() => setLocale("en")} aria-label={t.d006c2.switchToEnglish}>EN</button>
          <i aria-hidden="true" />
          <button type="button" lang="fr" aria-pressed={locale === "fr"} onClick={() => setLocale("fr")} aria-label={t.d006c2.switchToFrench}>FR</button>
        </div>
      </header>

      {/* One name for the world: the drawing carries it, the section does not repeat it. */}
      <section className="nx-world">
        <WorldStage world={model.world} latest={model.latestEvidence} copy={nx.actors} ariaLabel={nx.worldAria} />
      </section>

      <section className={`nx-fact${model.currentFact?.fresh ? " is-fresh" : ""}`} aria-label={nx.factAria} aria-live="polite">
        <span className="nx-kicker">{factKicker ?? nx.kicker}</span>
        <h1 key={model.currentFact?.factId ?? "ready"}>{statement ?? (phase === "READY" ? nx.ready : "")}</h1>
      </section>

      <section className="nx-mission-evidence" aria-label={compactCopy.evidence} data-peb={model.portableEvidence.state}>
        <MissionNanoReceipts key={model.expertRefs.runId} model={model} available={availableReceipts} />
        <div className="nx-compact-peb" data-held-digest={artifactDigest}>
          {model.finalReceipt !== null && <details className="nx-final-summary">
            <summary>{nx.dossier.finalReceipt}</summary>
            <p>{locale === "fr" ? "Objet de clôture distinct des NanoReceipts." : "Closure object, separate from the NanoReceipts."}</p>
            <code>{model.finalReceipt.receiptId}</code>
          </details>}
          {model.handoff.stage === "READY" ? <button type="button" className="nx-peb-chip is-takeable" data-peb-state={model.portableEvidence.state} onClick={pickUp}><PebGlyph /><span>{compactCopy.ready}</span><b>{compactCopy.pick}</b></button> : model.handoff.stage === "CARRIED" ? <span className="nx-peb-held" role="status"><PebGlyph /><strong>{fs.held}</strong></span> : model.handoff.stage === "HANDED_OVER" ? <span className="nx-peb-delivered" role="status"><PebGlyph />{fs.received}</span> : <span className="nx-peb-pending">{compactCopy.pending}</span>}
          {["CARRIED", "HANDED_OVER"].includes(model.handoff.stage) && <div className="nx-compact-handoff" data-held-digest={artifactDigest}>
            <button type="button" className="nx-act" disabled={["opening", "held"].includes(handoffStatus)} onClick={submitPeb}><FortixIcon name="external" size={16} />{fs.handoffSubmit}</button>
            {model.handoff.stage === "CARRIED" && <button type="button" className="nx-act" onClick={closeHandoff}>{fs.handoffRelease}</button>}
            <span className="nx-compact-handoff-status" role="status">{handoffStatus === "opening" ? fs.handoffOpening : handoffStatus === "held" ? fs.handoffHeld : handoffStatus === "received" ? fs.handoffReceived : handoffStatus === "blocked" ? fs.handoffBlocked : handoffStatus === "failed" ? fs.handoffFailed : compactCopy.details}</span>
          </div>}
        </div>
      </section>

      <footer className="nx-controls" data-authority={model.authorityRequest.required ? "required" : "none"}>
        {model.authorityRequest.required ? (
          // The human authority boundary: the mission holds until a person
          // decides. Both acts are the engine's own (DENY leaves evidence).
          <div className="nx-authority" role="group" aria-label={t.d006c2.authority.aria}>
            <span className="nx-kicker">{t.d006c2.authority.required}</span>
            <p>{t.d006c2.authority.question}</p>
            <button type="button" className="nx-primary" disabled={!missionPlayable} onClick={() => engine.decide("APPROVED")}>{t.d006c2.authority.allow}</button>
            <button type="button" className="nx-secondary" disabled={!missionPlayable} onClick={() => engine.decide("DENIED")}>{t.d006c2.authority.deny}</button>
          </div>
        ) : (
          <button type="button" className="nx-primary" disabled={!missionPlayable && phase !== "COMPLETE" && phase !== "STOPPED_BY_DENIAL"} onClick={onPrimary}>
            {primaryLabel}
          </button>
        )}
        <button type="button" className="nx-secondary" data-reset-mission onClick={() => resetMission()}>{locale === "fr" ? "Réinitialiser la mission" : "Reset mission"}</button>
        <div className="nx-connectivity-route" data-connectivity-route={engine.activeConnectivityMedium ?? "none"} role="status">
          <span>{locale === "fr" ? "Voie réseau automatique" : "Automatic network route"}</span>
          <strong>{activeRouteLabel}</strong>
          <small>{isPublicSimulation
            ? (locale === "fr" ? "Simulation publique : aucune interface physique observée" : "Public simulation: no physical adapter observed")
            : (locale === "fr" ? "RJ45 et Wi-Fi observés uniquement par la sentinelle locale · 5G et satellite modélisés" : "RJ45 and Wi-Fi observed only by a local sentinel · 5G and satellite modeled")}</small>
        </div>
        {model.mission.masterTimeMs === 0 && engine.snapshot.session.records.length > 0 && <span className="nx-reset-status" role="status">{locale === "fr" ? "Lecture au début · historique de cette mission conservé." : "Reading from the beginning · this mission’s history is retained."}</span>}
        {isPublicSimulation && <div className="nx-reset-status" role="status" data-simulation-notice="true">{locale === "fr"
          ? "Mode public simulé : la mission peut être parcourue sans sentinelle. Réseau physique UNKNOWN ; aucune observation RJ45/Wi-Fi ni nouvelle preuve physique. Les événements de démonstration ne décrivent pas un véhicule réel."
          : "Public simulation mode: the mission can be explored without a sentinel. Physical network UNKNOWN; no RJ45/Wi-Fi observation or new physical proof. Demo events are not real vehicle activity."} <a href="/nx?mode=physical">{locale === "fr" ? "Essai physique local" : "Local physical test"}</a></div>}
        {!isPublicSimulation && !engine.networkBaselineReady && <span className="nx-reset-status" role="status">{locale === "fr" ? "En attente d’une voie réseau physique confirmée pour démarrer cette mission." : "Waiting for a confirmed physical network route before starting this mission."}</span>}
        <label className="nx-scrub">
          <span>{nx.missionTime}</span>
          {/* One arrow press moves a beat, not a millisecond, and the value is
              spoken as mission time rather than as a raw count. */}
          <input
            type="range"
            disabled={!missionPlayable}
            min={0}
            max={model.mission.durationMs}
            step={250}
            value={model.mission.masterTimeMs}
            aria-valuetext={formatExperienceTime(model.mission.masterTimeMs)}
            onChange={(event) => { const next = Number(event.target.value); if (next < HANDOFF_READY_MS) handoffStop.current?.(); engine.seek(next); }}
          />
          <output>{model.mission.masterTimeMs === 0 ? "00:00.000" : formatExperienceTime(model.mission.masterTimeMs)}</output>
        </label>
      </footer>

    </main>
  );
}

/** Identity inspection only: the adapter remains the sole source of admitted receipts. */
function MissionNanoReceipts({ model, available }: { model: PublicExperienceModel; available: MissionReceiptSummary }) {
  const { locale } = useI18n();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { items, count, presentedCount, networkCount } = available;
  const { sealedCount, journalCount } = model.accumulatedEvidence;
  // Resolve against this run and this instant, so seeking back never exposes a future receipt.
  const selected = items.find((entry) => entry.evidenceId === selectedId)
    ?? items.find(entry => entry.evidenceId === model.presentation.owning?.evidenceId) ?? items.at(-1);
  const copy = locale === "fr" ? {
    inspect: "Consulter un NanoReceipt", empty: "Les NanoReceipts apparaissent au fil de la mission.",
    choose: "NanoReceipt à consulter", id: "Identifiant du NanoReceipt", event: "Événement déclaré", producer: "Producteur déclaré",
    closure: "Dans le jeu de clôture", journal: "Après scellement · hors PEB", scope: "Périmètre",
    guidance: "Chaque NanoReceipt est un reçu de preuve. Le reçu final et le PEB sont des objets distincts.",
  } : {
    inspect: "Inspect a NanoReceipt", empty: "NanoReceipts appear as the mission proceeds.",
    choose: "NanoReceipt to inspect", id: "NanoReceipt identifier", event: "Declared event", producer: "Declared producer",
    closure: "In the closure set", journal: "After sealing · outside the PEB", scope: "Scope",
    guidance: "Each NanoReceipt is an evidence receipt. The final receipt and the PEB are separate objects.",
  };
  return <div className="nx-evidence-progress" data-nr-count={count}>
    {selected === undefined ? <p className="nx-nr-empty" role="status"><strong>0 NanoReceipts (NR) · {locale === "fr" ? "disponibles" : "available"}</strong><small>{copy.empty}</small></p> :
      <details className="nx-nr-summary">
        <summary title={`${copy.inspect} · ${selected.evidenceId}`}><strong><span role="status">{count}</span> NanoReceipts (NR) · {locale === "fr" ? "disponibles" : "available"}</strong><span>{copy.inspect}</span></summary>
        <div className="nx-nr-detail">
          <p>{copy.guidance}</p>
          <p data-nr-reading-scope>{locale === "fr" ? `${presentedCount} présentés · ${networkCount} au journal réseau ; liste sans doublon.` : `${presentedCount} shown · ${networkCount} in the network journal; deduplicated list.`}</p>
          <label>{copy.choose}<select value={selected.evidenceId} onChange={(event) => setSelectedId(event.target.value)}>
            {items.map((entry) => <option key={entry.evidenceId} value={entry.evidenceId}>{entry.evidenceId}</option>)}
          </select></label>
          <dl className="nx-nr-identity" data-selected-nr={selected.evidenceId}>
            <div><dt>{copy.id}</dt><dd><code>{selected.evidenceId}</code></dd></div>
            <div><dt>{copy.event}</dt><dd>{selected.eventId}</dd></div>
            <div><dt>{copy.producer}</dt><dd>{selected.domain}</dd></div>
            <div><dt>{copy.scope}</dt><dd>{selected.standing === "NETWORK" ? locale === "fr" ? "Journal réseau de cette mission" : "This mission’s network journal" : selected.standing === "JOURNAL" ? copy.journal : copy.closure}</dd></div>
          </dl>
          <p className="nx-nr-counts">{sealedCount} · {copy.closure}<br />{journalCount} · {copy.journal}</p>
        </div>
      </details>}
  </div>;
}

/**
 * One coherent pulse system: the ACTION FAMILY of the evidence that just
 * happened (B R2 §8) — the same colour token the bead carries on the proof,
 * derived from the family key so no second list of families exists.
 */
export function pulseFor(family: ActionFamily | null): string {
  return family === null ? "var(--nx-ink-2)" : `var(--nx-family-${family})`;
}

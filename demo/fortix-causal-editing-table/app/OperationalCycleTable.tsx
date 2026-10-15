"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useI18n } from "./I18nProvider";
import { deriveCinematicState, deterministicTrafficCarPosition } from "./cinematic";
import { deriveHarmonyState, type HarmonyFocus } from "./harmony";
import {
  OPERATIONAL_CYCLE_DURATION_MS,
  OPERATIONAL_FRAME_MS,
  formatOperationalTime,
  operationalFrameStep,
  type CycleVerificationResult,
  type TimelineScale,
} from "./operationalCycle";
import {
  D005M_MASTER_BUNDLE_TEXT,
  MASTER_EVIDENCE_EVENTS,
  MASTER_MISSIONS,
  MASTER_PRESENTATION_DURATION_MS,
  MASTER_STORY_MOMENTS,
  deriveMasterStoryState,
  presentationTimeForMasterTime,
  verifyD005MMasterBundle,
  type MasterEvidenceEvent,
  type MasterPaymentStep,
} from "./masterStory";
import {
  INTERACTION_ANCHORS,
  derivePhysicalState,
  type InteractionAnchor,
  type PassengerPhysicalState,
  type VehiclePhysicalState,
} from "./physicalState";
import {
  HUMAN_AUTHORITY_GATE_MS,
  advanceReviewPlayback,
  applyHumanDecision,
  constrainReviewTime,
  effectiveHumanDecision,
  formatStableTimelineTime,
  nextTransferStage,
  type HumanDecision,
  type ReviewMode,
  type TransferStage,
} from "./reviewFlow";

const SCALE_ORDER: readonly TimelineScale[] = ["OVERVIEW", "MISSION", "FORENSIC"];
const SYSTEM_TRACKS = ["Intent", "External condition", "Prediction / ETA", "Authority", "Policy", "Decision", "Execution", "Result"] as const;
const PROOF_TRACKS = ["Significant Events", "Nano-Receipts", "Authority Evidence", "Policy Evidence", "Causal Links", "Sub-Mission Receipt", "Operational Cycle Receipt"] as const;
const NARRATIVE_RECEIPT_VISIBILITY_MS = 1_800;
const OVERVIEW_MOMENT_IDS = new Set([
  "passenger-request",
  "passenger-mission-complete",
  "garage-mission-begins",
  "congestion",
  "reroute-authorized",
  "garage-arrival",
  "maintenance-authorized",
  "work-complete",
  "invoice-1850",
  "human-approval-required",
  "authority-delegated",
  "payment-result",
  "return-to-base-intent",
  "return-route-calculated",
  "leaving-garage",
  "parked-at-base",
  "master-cycle-receipt",
]);

type TimelineMarker = Readonly<{ id: string; timeMs: number; kind: "INTENT" | "POLICY" | "EXECUTION" | "RESULT"; label: string }>;

export function OperationalCycleTable() {
  const { locale, setLocale, t } = useI18n();
  const [masterTime, setMasterTime] = useState(0);
  const [scale, setScale] = useState<TimelineScale>("OVERVIEW");
  const [isPlaying, setIsPlaying] = useState(false);
  const [evidenceExpanded, setEvidenceExpanded] = useState(false);
  const [reviewMode, setReviewMode] = useState<ReviewMode>("INTERACTIVE");
  const [humanDecision, setHumanDecision] = useState<HumanDecision>("PENDING");
  const [bundleStage, setBundleStage] = useState<TransferStage>("SOURCE");
  const [copyStatus, setCopyStatus] = useState<"IDLE" | "COPIED" | "FAILED">("IDLE");
  const [verificationPending, setVerificationPending] = useState(false);
  const [verificationResult, setVerificationResult] = useState<CycleVerificationResult | null>(null);
  const animationFrame = useRef<number | null>(null);
  const lastFrame = useRef<number | null>(null);
  const masterTimeRef = useRef(0);
  const verificationRun = useRef(0);

  const story = useMemo(() => deriveMasterStoryState(masterTime), [masterTime]);
  const physical = useMemo(() => derivePhysicalState(masterTime), [masterTime]);
  const cinematic = useMemo(() => deriveCinematicState(masterTime, "MASTER_APPROVED"), [masterTime]);
  const effectiveDecision = effectiveHumanDecision(reviewMode, humanDecision);
  const harmony = useMemo(() => deriveHarmonyState(masterTime, effectiveDecision), [effectiveDecision, masterTime]);
  const waitingForAuthority = reviewMode === "INTERACTIVE" && humanDecision === "PENDING" && masterTime === HUMAN_AUTHORITY_GATE_MS;
  const currentEvidence = useMemo(
    () => story.moment.evidenceEventId === null
      ? null
      : MASTER_EVIDENCE_EVENTS.find((event) => event.event_id === story.moment.evidenceEventId) ?? null,
    [story.moment.evidenceEventId],
  );

  useEffect(() => {
    masterTimeRef.current = masterTime;
  }, [masterTime]);

  const resetVerification = useCallback(() => {
    verificationRun.current += 1;
    setBundleStage("SOURCE");
    setCopyStatus("IDLE");
    setVerificationPending(false);
    setVerificationResult(null);
  }, []);

  const seek = useCallback((value: number) => {
    const next = constrainReviewTime(value, reviewMode, humanDecision);
    setIsPlaying(false);
    if (next < OPERATIONAL_CYCLE_DURATION_MS) resetVerification();
    setMasterTime(next);
  }, [humanDecision, resetVerification, reviewMode]);

  const restart = useCallback(() => {
    setIsPlaying(false);
    setMasterTime(0);
    if (reviewMode === "INTERACTIVE") setHumanDecision("PENDING");
    resetVerification();
  }, [resetVerification, reviewMode]);

  useEffect(() => {
    if (!isPlaying) {
      lastFrame.current = null;
      return;
    }
    const anchorMasterTime = masterTimeRef.current;
    let elapsedFromAnchor = 0;
    const tick = (frameTime: number) => {
      const previous = lastFrame.current ?? frameTime;
      // Preserve all monotonic presentation elapsed time. Browsers may throttle
      // requestAnimationFrame while a recording tab is not foregrounded; dropping
      // everything above 100 ms made playback appear stuck near the authority gate.
      const elapsed = Math.max(0, frameTime - previous);
      lastFrame.current = frameTime;
      elapsedFromAnchor += elapsed;
      setMasterTime(() => {
        const advance = advanceReviewPlayback(anchorMasterTime, elapsedFromAnchor, reviewMode, humanDecision);
        if (advance.pausedForAuthority || advance.complete) setIsPlaying(false);
        return advance.masterTime;
      });
      animationFrame.current = requestAnimationFrame(tick);
    };
    animationFrame.current = requestAnimationFrame(tick);
    return () => {
      if (animationFrame.current !== null) cancelAnimationFrame(animationFrame.current);
    };
  }, [humanDecision, isPlaying, reviewMode]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLButtonElement) return;
      if (event.code === "Space") {
        event.preventDefault();
        if (!waitingForAuthority && humanDecision !== "DENIED") setIsPlaying((current) => !current);
      } else if (event.code === "ArrowLeft") {
        seek(operationalFrameStep(masterTime, -1));
      } else if (event.code === "ArrowRight") {
        seek(operationalFrameStep(masterTime, 1));
      } else if (event.code === "Home") {
        restart();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [humanDecision, masterTime, restart, seek, waitingForAuthority]);

  const selectReviewMode = (next: ReviewMode) => {
    setReviewMode(next);
    setHumanDecision(next === "MASTER_RECORDING" ? "APPROVED" : "PENDING");
    setMasterTime(0);
    setIsPlaying(false);
    resetVerification();
  };

  const decide = (decision: Exclude<HumanDecision, "PENDING">) => {
    if (reviewMode !== "INTERACTIVE" || masterTime !== HUMAN_AUTHORITY_GATE_MS) return;
    const applied = applyHumanDecision(decision);
    setHumanDecision(applied.decision);
    setMasterTime(applied.masterTime);
    setIsPlaying(decision === "APPROVED");
  };

  const runVerification = async () => {
    if (bundleStage !== "TRANSFERRED" || !story.cycleReceiptAvailable) return;
    const run = ++verificationRun.current;
    setVerificationPending(true);
    const result = await verifyD005MMasterBundle();
    if (verificationRun.current !== run) return;
    setVerificationResult(result);
    setVerificationPending(false);
  };

  const copyPeb = async () => {
    try {
      await navigator.clipboard.writeText(D005M_MASTER_BUNDLE_TEXT);
      setCopyStatus("COPIED");
    } catch {
      setCopyStatus("FAILED");
    }
  };

  const downloadPeb = () => {
    const url = URL.createObjectURL(new Blob([D005M_MASTER_BUNDLE_TEXT], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "fortix-d005m-master-portable-evidence-bundle.json";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const chapterLabel = t.d005f.chapters[chapterKey(story.chapter)];
  const momentLabel = t.d005f.moments[story.moment.id];
  const systemLabel = t.d005f.systems[story.moment.systemKey as keyof typeof t.d005f.systems];
  const boundaryLabel = t.d005f.boundaries[story.moment.boundaryKey];
  const authorityLabel = t.d005f.authorityStates[authorityKey(story.authorityState)];
  const showGarageContext = masterTime >= 62_000 && masterTime < 105_500;
  const locationLabel = showGarageContext ? t.d005f.externalGarage : realityLocationLabel(story.scene, t.d005f);
  const timelineWindow = timelineWindowFor(masterTime, scale, story.chapter);
  const timelineSpan = Math.max(1, timelineWindow.endMs - timelineWindow.startMs);
  const timelineMarkers = buildTimelineMarkers(
    scale,
    timelineWindow,
    locale,
    t.d005f.moments,
    t.d005f.evidenceLabels,
  );
  const presentationElapsed = presentationTimeForMasterTime(masterTime);
  const presentationProgress = presentationElapsed / MASTER_PRESENTATION_DURATION_MS;
  const stableMasterTime = formatStableTimelineTime(masterTime, scale, isPlaying);
  const physicalLabel = t.d005g.vehicleStates[vehicleStateKey(physical.vehicleState)];
  const passengerLabel = t.d005g.passengerStates[passengerStateKey(physical.passengerState)];
  const narrativeMode = scale === "OVERVIEW" && !evidenceExpanded;
  const realityNarrative = realityNarrativeLabel(masterTime, physicalLabel, t.d005h);
  const anchorLabel = t.d005h.anchors[anchorKey(physical.targetAnchor)];
  const anchorStyles = interactionAnchorStyles(physical.targetAnchor);

  return (
    <main
      className={`causal-shell operational-shell cinematic-shell transversal-shell harmony-shell ${narrativeMode ? "is-narrative-mode" : "is-depth-mode"}`}
      data-locale={locale}
      data-master-time={masterTime}
      data-story-moment={story.moment.id}
      data-story-chapter={story.chapter}
      data-story-scene={story.scene}
      data-review-mode={reviewMode}
      data-human-decision={effectiveDecision}
      data-vehicle-state={physical.vehicleState}
      data-vehicle-speed={physical.speedKph}
      data-passenger-state={physical.passengerState}
      data-timeline-scale={scale}
      data-traffic-story={cinematic.trafficStoryStep}
      data-payment-step={story.paymentStep}
      data-bundle-stage={bundleStage}
      data-dominant-focus={harmony.dimensions.narrative.focus}
      data-target-anchor={physical.targetAnchor}
      data-aligned-anchor={physical.alignedAnchor ?? "NONE"}
      data-harmony-coherent={harmony.coherent}
      data-verification-state={verificationResult?.verdict ?? (verificationPending ? "VERIFYING" : "NOT_RUN")}
    >
      <header className="mission-header operational-header">
        <div className="mission-title-group">
          <span className="mission-kicker">{t.d005f.kicker}</span>
          <h1>{t.d005f.title}</h1>
          <p>{t.d005f.subtitle}</p>
        </div>
        <div className="header-actions">
          <div className="review-mode-switch" role="group" aria-label={t.d005g.reviewModeLabel}>
            <button type="button" onClick={() => selectReviewMode("INTERACTIVE")} aria-pressed={reviewMode === "INTERACTIVE"}>{t.d005g.interactiveMode}</button>
            <button type="button" onClick={() => selectReviewMode("MASTER_RECORDING")} aria-pressed={reviewMode === "MASTER_RECORDING"}>{t.d005g.recordingMode}</button>
          </div>
          <div className="locale-switch" role="group" aria-label={t.nav.languageLabel}>
            <button type="button" onClick={() => setLocale("en")} aria-pressed={locale === "en"}>EN</button>
            <button type="button" onClick={() => setLocale("fr")} aria-pressed={locale === "fr"}>FR</button>
          </div>
          <div className="replay-status" aria-label="Replay status">
            <span className={isPlaying ? "status-dot is-live" : waitingForAuthority ? "status-dot is-governed-pause" : "status-dot"} />
            {waitingForAuthority ? t.d005g.waitingForAuthority : humanDecision === "DENIED" ? t.d005g.deniedTerminal : isPlaying ? t.d005.replaying : t.d005.replayReady}
          </div>
          <button className={evidenceExpanded ? "explore-button is-active" : "explore-button"} type="button" aria-expanded={evidenceExpanded} onClick={() => setEvidenceExpanded((value) => !value)}>
            <span>{evidenceExpanded ? t.d005.closeEvidence : t.d005.explore}</span>
            <span aria-hidden="true">{evidenceExpanded ? "−" : "+"}</span>
          </button>
        </div>
      </header>

      <section className="cycle-context transversal-context" aria-label="Operational cycle summary">
        <div className="cycle-message"><strong>{t.d005f.chapterLabel}</strong><span>{chapterLabel}</span></div>
        <div className="participant-chain" aria-label="Participating systems">
          {["Passenger", "Taxi", "Navigation A", "Navigation B", "Garage", "Human", "Payment", "Manager", "Verifier"].map((participant) => <span key={participant}>{participant}</span>)}
        </div>
        <div className="fortix-layer"><span>FORTIX</span><strong>{t.d005f.continuityPrinciple}</strong></div>
      </section>

      <section className="story-compass" aria-live="polite">
        <div><span>{t.d005f.chapterLabel}</span><strong>{chapterLabel}</strong></div>
        <div><span>{t.d005f.boundaryLabel}</span><strong>{boundaryLabel}</strong></div>
        <div className="story-pacing"><span>{t.d005h.naturalPacing}</span><strong>{formatPresentationTime(presentationElapsed)} / {formatPresentationTime(MASTER_PRESENTATION_DURATION_MS)}</strong></div>
        <i aria-hidden="true" style={{ width: `${presentationProgress * 100}%` }} />
      </section>

      <section className="master-console operational-console" aria-label="Master timeline controls">
        <div className="transport-controls">
          <button type="button" className="transport-button" onClick={restart} aria-label="Rewind to start">↤</button>
          <button type="button" className="transport-button frame-button" onClick={() => seek(operationalFrameStep(masterTime, -1))} aria-label={`Frame backward ${OPERATIONAL_FRAME_MS} milliseconds`}>‹</button>
          {isPlaying ? (
            <button type="button" className="play-button" onClick={() => setIsPlaying(false)} aria-label="Pause">Ⅱ Pause</button>
          ) : (
            <button type="button" className="play-button" disabled={waitingForAuthority || humanDecision === "DENIED"} onClick={() => { if (masterTime >= OPERATIONAL_CYCLE_DURATION_MS) restart(); else setIsPlaying(true); }} aria-label="Play">▶ Play</button>
          )}
          <button type="button" className="transport-button frame-button" onClick={() => seek(operationalFrameStep(masterTime, 1))} aria-label={`Frame forward ${OPERATIONAL_FRAME_MS} milliseconds`}>›</button>
        </div>
        <div className="master-time-readout" aria-live="polite">
          <span>{t.d005.masterTime}</span>
          <strong data-testid="master-time">{stableMasterTime}</strong>
          <small>/ 02:00</small>
        </div>
        <div className="scale-switch" role="group" aria-label="Timeline scale">
          {SCALE_ORDER.map((value) => (
            <button key={value} type="button" aria-pressed={scale === value} onClick={() => setScale(value)}>
              {value === "OVERVIEW" ? t.d005.scales.overview : value === "MISSION" ? t.d005.scales.mission : t.d005.scales.forensic}
            </button>
          ))}
        </div>
        <div className="timeline-control operational-timeline">
          <div className="timeline-window-label"><span>{scale}</span><strong title={chapterLabel}>{chapterLabel}</strong></div>
          <div className="marker-rail" aria-label="Event markers">
            {timelineMarkers.map((marker) => (
              <button
                key={marker.id}
                type="button"
                className={marker.timeMs <= masterTime ? `event-marker is-reached marker-${marker.kind.toLowerCase()}` : `event-marker marker-${marker.kind.toLowerCase()}`}
                style={{ left: `${((marker.timeMs - timelineWindow.startMs) / timelineSpan) * 100}%` }}
                aria-label={`Go to ${marker.label} at ${formatOperationalTime(marker.timeMs)}`}
                title={`${formatOperationalTime(marker.timeMs)} · ${marker.label}`}
                onClick={() => seek(marker.timeMs)}
              />
            ))}
          </div>
          <input className="master-slider" type="range" min={timelineWindow.startMs} max={timelineWindow.endMs} step="1" value={Math.min(timelineWindow.endMs, Math.max(timelineWindow.startMs, masterTime))} aria-label="Master timeline" onPointerDown={() => setIsPlaying(false)} onChange={(event) => seek(Number(event.target.value))} style={{ "--timeline-progress": `${((masterTime - timelineWindow.startMs) / timelineSpan) * 100}%` } as React.CSSProperties} />
          <div className="timeline-scale"><span>{formatStableTimelineTime(timelineWindow.startMs, scale, isPlaying)}</span><span>{formatStableTimelineTime(timelineWindow.endMs, scale, isPlaying)}</span></div>
        </div>
      </section>

      <section className="mission-ribbon" aria-label="Sub-missions">
        {MASTER_MISSIONS.map((mission) => {
          const reached = mission.start_ms <= masterTime;
          const active = masterTime >= mission.start_ms && masterTime < mission.end_ms;
          const completed = mission.end_ms <= masterTime;
          return (
            <button key={mission.id} type="button" className={`${reached ? "is-reached" : ""}${active ? " is-active" : ""}${completed ? " is-complete" : ""}`} onClick={() => seek(mission.start_ms)}>
              <span>{formatOperationalTime(mission.start_ms)}</span>
              <strong>{locale === "fr" ? mission.label_fr : mission.label_en}</strong>
              <small>{completed ? t.d005.available : active ? "ACTIVE" : t.d005.pending}</small>
            </button>
          );
        })}
      </section>

      <section className="evidence-continuity-thread" aria-label="FortiX evidence continuity">
        <span>FORTIX</span>
        <i style={{ width: `${(masterTime / OPERATIONAL_CYCLE_DURATION_MS) * 100}%` }} />
        <strong>{story.reachedEvidence.length} / {MASTER_EVIDENCE_EVENTS.length}</strong>
      </section>

      <section className="band-stack operational-bands convergence-preview" aria-label="Two synchronized timelines: mission reality and proof growth">
        <article className={`causal-band reality-band operational-reality is-focused ${focusClass("REALITY", harmony.dimensions.narrative.focus, narrativeMode)}`} data-band="reality">
          <BandLabel number="01" title="MISSION REALITY" subtitle="What happens" />
          <div className="band-stage taxi-scene" data-scene={story.scene} data-tempo={physical.vehicleState}>
            <div className="taxi-world" aria-label="Procedural autonomous taxi world" style={anchorStyles}>
              <span className="world-sun" /><span className="world-horizon" />
              <div className="world-skyline" aria-hidden="true">{Array.from({ length: 9 }, (_, index) => <span key={index} />)}</div>
              <span className="world-sidewalk world-sidewalk-far" /><span className="world-sidewalk world-sidewalk-near" />
              <div className="world-trees" aria-hidden="true">{Array.from({ length: 6 }, (_, index) => <span key={index} />)}</div>
              <span className="world-road" />
              <span className={`world-route route-original${cinematic.route === "ORIGINAL" ? " is-active" : ""}`}><b>{t.d005.routeOriginal}</b></span>
              <span className={`world-route route-alternative${cinematic.route === "ALTERNATIVE" ? " is-active" : ""}`}><b>{t.d005.routeAlternative}</b></span>
              {(story.scene === "CONGESTION" || story.scene === "REROUTE") && Array.from({ length: 7 }, (_, index) => {
                const lane = index % 2;
                return <span key={index} className={`traffic-car lane-${lane}`} style={{ left: `${deterministicTrafficCarPosition(masterTime, lane, index, cinematic.trafficDensity)}%`, opacity: 0.18 + cinematic.trafficDensity * 0.72 }} />;
              })}
              <span className={`interaction-anchor${physical.alignedAnchor === physical.targetAnchor ? " is-aligned" : ""}`} data-anchor={physical.targetAnchor}><b>{anchorLabel}</b></span>
              <div className="taxi-vehicle" style={{ left: `${visualLeftPercent(physical.visualPosition)}%` }} aria-label="Autonomous taxi"><span>TAXI</span><i /><i />{physical.passengerState === "ONBOARD" && <b className="passenger-in-taxi" aria-label={t.d005f.passengerAboard} />}</div>
              <RealityActors scene={story.scene} passengerState={physical.passengerState} vehicleState={physical.vehicleState} maintenanceCompleted={physical.maintenanceCompleted} showGarageContext={showGarageContext} copy={t.d005f} physicalCopy={t.d005g} />
              <div className="reality-story"><span>{realityNarrative}</span><strong>{locationLabel}</strong></div>
            </div>
            <div className="operational-current-state physical-current"><span>{passengerLabel}</span><strong>{physicalLabel} · {physical.speedKph.toFixed(1)} km/h</strong></div>
          </div>
        </article>

        <article className={`causal-band system-band operational-system is-focused ${focusClass("SYSTEM", harmony.dimensions.narrative.focus, narrativeMode)}`} data-band="system" aria-hidden="true">
          <BandLabel number="02" title={t.d005.bands.system} subtitle={t.d005.bands.systemSubtitle} />
          <div className="band-stage operational-system-stage">
            <div className="system-boundary-label"><span>{systemLabel}</span><small>{t.d005f.boundaryLabel}</small></div>
            <div className="operational-event-card">
              <time>{formatOperationalTime(story.moment.timeMs)}</time>
              <span>{currentEvidence === null ? t.d005f.operationalMoment : t.d005f.evidencedMoment}</span>
              <strong>{momentLabel}</strong>
            </div>
            <div className="operational-current-state authority-current"><span>{t.d005.activeAuthority}</span><strong>{authorityLabel}</strong></div>
            <div className="system-physical-sync"><span>{t.d005g.physicalSync}</span><strong>{physicalLabel} · {physical.speedKph.toFixed(1)} km/h</strong></div>
            <div className="boundary-roundtrip"><span>{boundaryLabel}</span><i aria-hidden="true" /></div>
          </div>
          {evidenceExpanded && (
            <div className="expanded-track operational-track-suite" aria-label="System evidence tracks">
              <h3>SYSTEM TRACKS</h3>
              <div className="operational-track-body">
                {SYSTEM_TRACKS.map((track) => <OperationalTrack key={track} title={track} events={eventsForTrack(story.reachedEvidence, track)} locale={locale} evidenceLabels={t.d005f.evidenceLabels} />)}
              </div>
            </div>
          )}
        </article>

        <article className={`causal-band proof-band operational-proof is-focused ${focusClass("PROOF", harmony.dimensions.narrative.focus, narrativeMode)}`} data-band="proof">
          <BandLabel number="02" title="PROOF GROWTH" subtitle="What can be verified" />
          <div className="band-stage operational-proof-stage">
            <div className="proof-counter"><strong>{story.reachedEvidence.length}</strong><span>{t.d005.evidenceObjects}</span></div>
            <div className="receipt-hierarchy" aria-label="Receipt hierarchy">
              <div className="nano-tier"><span>NANO-RECEIPTS</span><i style={{ width: `${(story.reachedEvidence.length / MASTER_EVIDENCE_EVENTS.length) * 100}%` }} /></div>
              <div className="subreceipt-tier">
                {["passenger", "traffic", "maintenance", "payment", "return"].map((mission, index) => <span key={mission} className={story.reachedReceiptCount > index ? "is-reached" : ""}>{mission}</span>)}
              </div>
              <div className={`cycle-receipt-node${story.cycleReceiptAvailable ? " is-reached" : ""}`}><span>{t.d005.cycleReceipt}</span><strong>{story.cycleReceiptAvailable ? t.d005.available : t.d005.pending}</strong></div>
            </div>
            {currentEvidence !== null && masterTime - currentEvidence.time_ms < NARRATIVE_RECEIPT_VISIBILITY_MS && (
              <div className="receipt-birth" style={{ "--birth-progress": Math.min(1, Math.max(0, (masterTime - currentEvidence.time_ms) / NARRATIVE_RECEIPT_VISIBILITY_MS)) } as React.CSSProperties}>
                <span>{t.d005.receiptBorn}</span>
                <strong>{displayEvidenceLabel(currentEvidence, locale, t.d005f.evidenceLabels)}</strong>
                <small>{t.d005.evidenceJoined}</small>
              </div>
            )}
          </div>
          {evidenceExpanded && (
            <div className="expanded-track operational-proof-tracks" aria-label="FortiX evidence tracks">
              <h3>PROOF TRACKS</h3>
              <div className="operational-track-body">
                {PROOF_TRACKS.map((track) => <ProofTrack key={track} title={track} state={story} />)}
              </div>
            </div>
          )}
        </article>
      </section>

      {masterTime >= 82_000 && masterTime < 96_000 && (
        <section className="payment-control-lab master-payment-boundary" aria-label={t.d005.paymentPolicy}>
          <header><span className="section-kicker">CAPABILITY ≠ AUTHORITY</span><h2>{humanDecision === "DENIED" ? t.d005g.deniedTerminal : story.paymentStep === "HIDDEN" ? "" : t.d005f.paymentSteps[paymentStepKey(story.paymentStep)]}</h2></header>
          <div className="master-payment-path" data-step={humanDecision === "DENIED" ? "DENIED" : story.paymentStep}>
            <PaymentNode label={t.d005f.invoiceAmount} reached={masterPaymentStepReached(story.paymentStep, "INVOICE")} />
            <PaymentNode label={t.d005f.autonomousLimit} reached={masterPaymentStepReached(story.paymentStep, "LIMIT")} state="boundary" />
            <PaymentNode label={humanDecision === "DENIED" ? t.d005g.deny : story.paymentStep === "ESCALATION" ? t.d005f.paymentSteps.escalation : t.d005f.approve} reached={masterPaymentStepReached(story.paymentStep, "ESCALATION")} state="human" />
            <PaymentNode label={t.d005f.delegatedAuthority} reached={humanDecision !== "DENIED" && masterPaymentStepReached(story.paymentStep, "DELEGATED")} state="authority" />
            <PaymentNode label={t.d005f.paymentAuthorized} reached={humanDecision !== "DENIED" && masterPaymentStepReached(story.paymentStep, "AUTHORIZED")} />
            <PaymentNode label={masterPaymentStepReached(story.paymentStep, "RESULT") ? t.d005f.paymentSettled : t.d005f.paymentSteps.request} reached={humanDecision !== "DENIED" && masterPaymentStepReached(story.paymentStep, "REQUEST")} state="result" />
          </div>
          {masterTime >= HUMAN_AUTHORITY_GATE_MS && masterTime < 85_500 && (
            <div className={`human-authority-gate is-${effectiveDecision.toLowerCase()}`} aria-label={t.d005g.humanGateLabel}>
              <div><span>{t.d005g.humanApprover}</span><strong>{effectiveDecision === "PENDING" ? t.d005g.humanApprovalRequired : effectiveDecision === "DENIED" ? t.d005g.deniedTerminal : t.d005g.approvalEvidenced}</strong></div>
              <dl><div><dt>{t.d005g.invoice}</dt><dd>€1,850</dd></div><div><dt>{t.d005g.autonomousLimit}</dt><dd>€500</dd></div></dl>
              {reviewMode === "INTERACTIVE" && humanDecision === "PENDING" && <div className="human-decision-actions"><button type="button" className="approve-action" onClick={() => decide("APPROVED")}>{t.d005g.approve}</button><button type="button" className="deny-action" onClick={() => decide("DENIED")}>{t.d005g.deny}</button></div>}
              {reviewMode === "MASTER_RECORDING" && <small>{t.d005g.canonicalApprovalMode}</small>}
              {reviewMode === "INTERACTIVE" && humanDecision === "PENDING" && <small>{t.d005g.waitingForAuthority}</small>}
              {reviewMode === "INTERACTIVE" && humanDecision === "APPROVED" && isPlaying && <small>{t.d005h.autoResuming}</small>}
              {humanDecision === "DENIED" && <small>{t.d005g.noPaymentAfterDeny}</small>}
            </div>
          )}
          <p>{humanDecision === "DENIED" ? t.d005g.noPaymentAfterDeny : `${t.d005f.capabilityPresent} · ${authorityLabel}`}</p>
        </section>
      )}

      <section className={`cycle-verification master-cycle-verification${story.cycleReceiptAvailable ? " is-available" : ""}${bundleStage === "FORMED" ? " is-forming" : ""}${bundleStage === "TRANSFERRED" ? " is-detached" : ""}`} aria-label="Vehicle Operational Cycle verification">
        <article className="cycle-source">
          <span className="flow-domain-label">{t.d005f.sourceSystem}</span>
          <div className="cycle-final-receipt"><span>{story.cycleReceiptAvailable ? t.d005.receiptReady : "FINAL RECEIPT"}</span><strong>{t.d005.cycleReceipt}</strong><small>5 immutable sub-mission receipts · {MASTER_EVIDENCE_EVENTS.length} significant evidence boundaries</small></div>
          {story.cycleReceiptAvailable && bundleStage === "SOURCE" && <button type="button" className="bundle-transfer-button" onClick={() => { setBundleStage(nextTransferStage(bundleStage, "GATHER")); setVerificationResult(null); }}>{t.d005f.prepareBundle}</button>}
          {bundleStage !== "SOURCE" && <><div className="bundle-material"><span>RECEIPTS</span><span>EVIDENCE</span><span>AUTHORITY</span><span>TRUST / TIME</span></div><div className="peb-transfer-actions"><button type="button" onClick={downloadPeb}>{t.d005g.downloadPeb}</button><button type="button" onClick={copyPeb}>{copyStatus === "COPIED" ? t.d005g.pebCopied : copyStatus === "FAILED" ? t.d005g.copyFailed : t.d005g.copyPeb}</button>{bundleStage === "FORMED" && <button type="button" className="bundle-transfer-button" onClick={() => setBundleStage(nextTransferStage(bundleStage, "SEND"))}>{t.d005f.detachBundle}</button>}</div><small className="qr-readiness">{t.d005g.qrUnavailable}</small></>}
          {!story.cycleReceiptAvailable && <span className="cycle-pending">{t.d005.pending} · {formatOperationalTime(OPERATIONAL_CYCLE_DURATION_MS)}</span>}
        </article>
        <div className="cycle-neutral-gap"><span>{bundleStage === "SOURCE" ? t.d005.evidenceBundled : t.d005f.bundleReady}</span><small>{t.d005.receiptTravelsWithEvidence}</small>{bundleStage === "TRANSFERRED" && <strong>→</strong>}</div>
        <article className="cycle-verifier">
          <span className="flow-domain-label">{t.d005.independentVerifier}</span>
          {bundleStage !== "TRANSFERRED"
            ? <div className="verifier-awaiting"><strong>{t.d005.waitingBundle}</strong><small>{t.d005f.noVerdictBeforeVerify}</small></div>
            : verificationResult === null
              ? <><div className="bundle-arrived"><span>PORTABLE EVIDENCE BUNDLE</span><strong>{t.d005f.evidenceSupport}</strong></div><button type="button" className="verify-receipt-button" disabled={verificationPending} onClick={runVerification} aria-label={t.d005.verifyCycle}>{verificationPending ? t.d005.verifying : t.d005.verify}</button></>
              : <div className={`verdict-card verdict-${verificationResult.verdict.toLowerCase()}`} data-testid="operational-verdict"><span>INDEPENDENT VERDICT</span><strong>{verificationResult.verdict}</strong><p>{verificationResult.verdict === "INDETERMINATE" ? t.d005.productionTrustIncomplete : verificationResult.verdict === "INVALID" ? "The altered bundle no longer matches its integrity commitment." : "The governed evidence resolved under the selected profile."}</p></div>}
        </article>
      </section>

      <footer className="prototype-footer"><span>Nano-Receipts → Sub-Mission Receipts → Master Vehicle Operational Cycle Receipt → Master PEB</span><span>{t.d005h.harmonyPrinciple}</span></footer>
    </main>
  );
}

function BandLabel({ number, title, subtitle }: { number: string; title: string; subtitle: string }) {
  return <header className="band-label"><span className="band-number">{number}</span><div><h2>{title}</h2><p>{subtitle}</p></div></header>;
}

function RealityActors({ scene, passengerState, vehicleState, maintenanceCompleted, showGarageContext, copy, physicalCopy }: { scene: ReturnType<typeof deriveMasterStoryState>["scene"]; passengerState: PassengerPhysicalState; vehicleState: VehiclePhysicalState; maintenanceCompleted: boolean; showGarageContext: boolean; copy: ReturnType<typeof useI18n>["t"]["d005f"]; physicalCopy: ReturnType<typeof useI18n>["t"]["d005g"] }) {
  if ((scene === "PASSENGER_REQUEST" || scene === "PICKUP_ROUTE") && passengerState === "WAITING") return <><div className="passenger-person is-waiting" aria-label={copy.passengerWaiting}><i /><span>{copy.pickupPoint}</span></div><div className="destination-marker">{copy.chosenDestination}</div></>;
  if (passengerState === "BOARDING") return <><div className="passenger-person is-boarding" aria-label={physicalCopy.passengerBoarding}><i /><span>{physicalCopy.passengerBoarding}</span></div><div className="destination-marker">{copy.chosenDestination}</div></>;
  if (scene === "PICKUP" || scene === "PASSENGER_JOURNEY") return <div className="destination-marker is-active">{copy.chosenDestination}</div>;
  if (passengerState === "DROPPING_OFF" || scene === "DROPOFF") return <><div className="passenger-person is-dropped" aria-label={copy.passengerDroppedOff}><i /><span>{passengerState === "DROPPING_OFF" ? physicalCopy.passengerExiting : copy.passengerDroppedOff}</span></div><div className="destination-marker is-active">{copy.chosenDestination}</div></>;
  if (showGarageContext) return <><div className="garage-building"><span>{copy.externalGarage}</span>{vehicleState === "MAINTENANCE" && <b>{copy.maintenanceInProgress}</b>}</div>{(vehicleState === "MAINTENANCE" || (maintenanceCompleted && scene === "MAINTENANCE")) && <div className={`maintenance-lift${maintenanceCompleted ? " is-complete" : ""}`}><i /><i /><strong>{maintenanceCompleted ? copy.workComplete : copy.maintenanceInProgress}</strong></div>}</>;
  if (scene === "RETURN") return <div className="base-marker">BASE</div>;
  if (["PARKED", "RECEIPTS", "CYCLE_RECEIPT"].includes(scene)) return <div className="base-marker is-parked">{copy.parked}</div>;
  return null;
}

function PaymentNode({ label, reached, state = "standard" }: { label: string; reached: boolean; state?: string }) {
  return <div className={`${reached ? "is-reached" : ""} payment-node-${state}`}><span>{state}</span><strong>{label}</strong></div>;
}

function OperationalTrack({ title, events, locale, evidenceLabels }: { title: string; events: readonly MasterEvidenceEvent[]; locale: "en" | "fr"; evidenceLabels: Record<string, string> }) {
  return <section className="track-row"><h4>{title}</h4><div className="track-row-items">{events.length === 0 ? <span className="track-empty">No state reached.</span> : events.slice(-4).map((event) => <div className="track-item" key={event.evidence_id}><time>{formatOperationalTime(event.time_ms)}</time><span>{displayEvidenceLabel(event, locale, evidenceLabels)}</span><strong>{event.system}</strong></div>)}</div></section>;
}

function ProofTrack({ title, state }: { title: string; state: ReturnType<typeof deriveMasterStoryState> }) {
  let detail = `${state.reachedEvidence.length} reached`;
  if (title === "Sub-Mission Receipt") detail = `${state.reachedReceiptCount} / 5 compiled`;
  if (title === "Operational Cycle Receipt") detail = state.cycleReceiptAvailable ? "Compiled · immutable inputs" : "Awaiting cycle closure";
  if (title === "Causal Links") detail = "Explicit parents only";
  if (title === "Authority Evidence") detail = "Distinct action-scoped authority";
  if (title === "Policy Evidence") detail = "Passenger · reroute · maintenance · payment · return";
  return <section className="proof-subtrack"><h4>{title}</h4><div className="proof-subtrack-items"><span className="proof-track-summary">{detail}</span></div></section>;
}

function eventsForTrack(events: readonly MasterEvidenceEvent[], track: typeof SYSTEM_TRACKS[number]): readonly MasterEvidenceEvent[] {
  if (track === "Intent") return events.filter((event) => event.kind === "INTENT");
  if (track === "Authority") return events.filter((event) => event.authority_context !== null && event.kind === "POLICY");
  if (track === "Policy" || track === "Decision") return events.filter((event) => event.kind === "POLICY");
  if (track === "Execution") return events.filter((event) => event.kind === "EXECUTION");
  if (track === "Prediction / ETA") return events.filter((event) => event.id === "eta-deteriorates");
  if (track === "External condition") return events.filter((event) => event.id === "congestion-significant");
  return events.filter((event) => event.kind === "RESULT");
}

function displayEvidenceLabel(event: MasterEvidenceEvent, locale: "en" | "fr", evidenceLabels: Record<string, string>): string {
  if (event.labelKey !== null) return evidenceLabels[event.labelKey] ?? event.labelKey;
  return locale === "fr" ? event.label_fr : event.label_en;
}

function buildTimelineMarkers(
  scale: TimelineScale,
  window: Readonly<{ startMs: number; endMs: number }>,
  locale: "en" | "fr",
  momentLabels: Record<string, string>,
  evidenceLabels: Record<string, string>,
): readonly TimelineMarker[] {
  if (scale === "FORENSIC") {
    return MASTER_EVIDENCE_EVENTS
      .filter((event) => event.time_ms >= window.startMs && event.time_ms <= window.endMs)
      .map((event) => ({ id: event.evidence_id, timeMs: event.time_ms, kind: event.kind, label: displayEvidenceLabel(event, locale, evidenceLabels) }));
  }
  return MASTER_STORY_MOMENTS
    .filter((moment) => moment.timeMs >= window.startMs && moment.timeMs <= window.endMs)
    .filter((moment) => scale !== "OVERVIEW" || OVERVIEW_MOMENT_IDS.has(moment.id))
    .map((moment) => ({ id: moment.id, timeMs: moment.timeMs, kind: markerKind(moment.evidenceEventId), label: momentLabels[moment.id] ?? moment.id }));
}

function markerKind(eventId: string | null): TimelineMarker["kind"] {
  if (eventId === null) return "RESULT";
  return MASTER_EVIDENCE_EVENTS.find((event) => event.event_id === eventId)?.kind ?? "RESULT";
}

function timelineWindowFor(masterTime: number, scale: TimelineScale, chapter: ReturnType<typeof deriveMasterStoryState>["chapter"]): Readonly<{ startMs: number; endMs: number }> {
  if (scale === "OVERVIEW") return { startMs: 0, endMs: OPERATIONAL_CYCLE_DURATION_MS };
  if (scale === "FORENSIC") return { startMs: Math.max(0, masterTime - 4_000), endMs: Math.min(OPERATIONAL_CYCLE_DURATION_MS, Math.max(masterTime + 4_000, masterTime + 1_000)) };
  const ranges = {
    PASSENGER: [0, 38_000],
    GARAGE_JOURNEY: [38_000, 66_000],
    MAINTENANCE: [66_000, 82_000],
    GOVERNED_PAYMENT: [82_000, 96_000],
    RETURN: [96_000, 114_000],
    PROOF: [114_000, 120_000],
  } as const;
  const [startMs, endMs] = ranges[chapter];
  return { startMs, endMs };
}

function markerPaymentOrder(step: MasterPaymentStep): number {
  return ["HIDDEN", "INVOICE", "LIMIT", "ESCALATION", "APPROVED", "DELEGATED", "AUTHORIZED", "REQUEST", "RESULT", "RECEIPT"].indexOf(step);
}

function masterPaymentStepReached(current: MasterPaymentStep, target: MasterPaymentStep): boolean {
  return markerPaymentOrder(current) >= markerPaymentOrder(target);
}

function paymentStepKey(step: Exclude<MasterPaymentStep, "HIDDEN">): keyof ReturnType<typeof useI18n>["t"]["d005f"]["paymentSteps"] {
  const mapping = { INVOICE: "invoice", LIMIT: "limit", ESCALATION: "escalation", APPROVED: "approved", DELEGATED: "delegated", AUTHORIZED: "authorized", REQUEST: "request", RESULT: "result", RECEIPT: "receipt" } as const;
  return mapping[step];
}

function chapterKey(chapter: ReturnType<typeof deriveMasterStoryState>["chapter"]): keyof ReturnType<typeof useI18n>["t"]["d005f"]["chapters"] {
  const mapping = { PASSENGER: "passenger", GARAGE_JOURNEY: "garageJourney", MAINTENANCE: "maintenance", GOVERNED_PAYMENT: "governedPayment", RETURN: "return", PROOF: "proof" } as const;
  return mapping[chapter];
}

function authorityKey(state: ReturnType<typeof deriveMasterStoryState>["authorityState"]): keyof ReturnType<typeof useI18n>["t"]["d005f"]["authorityStates"] {
  const mapping = { NOT_APPLICABLE: "notApplicable", AUTONOMOUS_LIMIT: "autonomousLimit", HUMAN_REQUIRED: "humanRequired", HUMAN_APPROVED: "humanApproved", DELEGATED: "delegated", PAYMENT_AUTHORIZED: "paymentAuthorized" } as const;
  return mapping[state];
}

function realityLocationLabel(scene: ReturnType<typeof deriveMasterStoryState>["scene"], copy: ReturnType<typeof useI18n>["t"]["d005f"]): string {
  if (["PASSENGER_REQUEST", "PICKUP_ROUTE", "PICKUP"].includes(scene)) return copy.pickupPoint;
  if (["PASSENGER_JOURNEY", "DROPOFF"].includes(scene)) return copy.chosenDestination;
  if (["GARAGE_ARRIVAL", "DIAGNOSIS", "MAINTENANCE", "INVOICE", "HUMAN_AUTHORITY", "PAYMENT", "MANAGER"].includes(scene)) return copy.externalGarage;
  if (["PARKED", "RECEIPTS", "CYCLE_RECEIPT"].includes(scene)) return copy.parked;
  return scene === "RETURN" ? copy.chapters.return : copy.chapters.garageJourney;
}

function vehicleStateKey(state: VehiclePhysicalState): keyof ReturnType<typeof useI18n>["t"]["d005g"]["vehicleStates"] {
  const mapping = {
    STOPPED: "stopped",
    MOVING: "moving",
    ARRIVING: "arriving",
    BOARDING: "boarding",
    PASSENGER_ONBOARD: "passengerOnboard",
    DROPOFF: "dropoff",
    GARAGE_STOPPED: "garageStopped",
    MAINTENANCE: "maintenance",
    WAITING_FOR_AUTHORITY: "waitingForAuthority",
    PAYMENT_PENDING: "paymentPending",
    READY_TO_DEPART: "readyToDepart",
    RETURNING_TO_BASE: "returningToBase",
    PARKED: "parked",
  } as const;
  return mapping[state];
}

function passengerStateKey(state: PassengerPhysicalState): keyof ReturnType<typeof useI18n>["t"]["d005g"]["passengerStates"] {
  const mapping = {
    WAITING: "waiting",
    BOARDING: "boarding",
    ONBOARD: "onboard",
    DROPPING_OFF: "droppingOff",
    NOT_ONBOARD: "notOnboard",
  } as const;
  return mapping[state];
}

function formatPresentationTime(value: number): string {
  const seconds = Math.floor(Math.max(0, value) / 1_000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function visualLeftPercent(position: number): number {
  return 10 + position * 72;
}

function interactionAnchorStyles(target: InteractionAnchor): React.CSSProperties {
  return {
    "--pickup-anchor-x": `${visualLeftPercent(INTERACTION_ANCHORS.PASSENGER_PICKUP_ANCHOR)}%`,
    "--dropoff-anchor-x": `${visualLeftPercent(INTERACTION_ANCHORS.PASSENGER_DROPOFF_ANCHOR)}%`,
    "--garage-anchor-x": `${visualLeftPercent(INTERACTION_ANCHORS.GARAGE_SERVICE_ANCHOR)}%`,
    "--base-anchor-x": `${visualLeftPercent(INTERACTION_ANCHORS.BASE_PARKING_ANCHOR)}%`,
    "--target-anchor-x": `${visualLeftPercent(INTERACTION_ANCHORS[target])}%`,
  } as React.CSSProperties;
}

function anchorKey(anchor: InteractionAnchor): keyof ReturnType<typeof useI18n>["t"]["d005h"]["anchors"] {
  const mapping = {
    PASSENGER_PICKUP_ANCHOR: "pickup",
    PASSENGER_DROPOFF_ANCHOR: "dropoff",
    GARAGE_SERVICE_ANCHOR: "garage",
    BASE_PARKING_ANCHOR: "base",
  } as const;
  return mapping[anchor];
}

function focusClass(band: HarmonyFocus, focus: HarmonyFocus, narrativeMode: boolean): string {
  if (!narrativeMode) return "is-depth-band";
  return band === focus ? "is-dominant-band" : "is-supporting-band";
}

function realityNarrativeLabel(
  masterTime: number,
  fallback: string,
  copy: ReturnType<typeof useI18n>["t"]["d005h"],
): string {
  if (masterTime >= 46_000 && masterTime < 48_000) return copy.slowdown;
  if (masterTime >= 48_000 && masterTime < 51_000) return copy.arrivalDelayed;
  if (masterTime >= 51_000 && masterTime < 52_000) return copy.routeSearch;
  if (masterTime >= 52_000 && masterTime < 54_000) return copy.routeAuthorized;
  if (masterTime >= 54_000 && masterTime < 62_000) return copy.routeChanged;
  if (masterTime >= 104_000 && masterTime < 105_500) return copy.departingNaturally;
  return fallback;
}

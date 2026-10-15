"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  D002_TIMELINE_MARKERS,
  SCENARIO_STATEMENTS,
  deriveDomainStateAt,
  deriveEvidenceStateAt,
  shortEvidenceId,
  type NanoReceipt,
  type StatementEvidenceState,
} from "./evidence";
import {
  D004_SYSTEM_TRACKS,
  authorityEvidenceForCondition,
  authorityProofItemsAt,
  authoritySystemTracksAt,
  deriveHistoricalActionAuthorityAt,
} from "./authority";
import {
  FINAL_RECEIPT_CLAIM,
  FINAL_RECEIPT_ELIGIBILITY_MS,
  deriveFinalReceiptAvailability,
  summarizeBundleMaterials,
  type BundleMaterialSummary,
} from "./d003";
import {
  FRAME_DURATION_MS,
  TIMELINE_DURATION_MS,
  clampMasterTime,
  deriveTimelineState,
  formatMasterTime,
  frameStep,
} from "./timeline";
import {
  createControlledTamper,
  verifyPortableEvidenceBundle,
  type IndependentVerificationResult,
} from "./verification";
import { useI18n } from "./I18nProvider";

const receiptKindLabels = {
  observation: "Observed",
  assessment: "Assessed",
  intent: "Intent",
  decision: "Decided",
  execution: "Executed",
} as const;

const criticalStatementIds = new Set([
  "physically-observable",
  "sensor-observable",
  "candidate-detected",
  "risk-rises",
  "braking-decision",
  "brake-command",
  "actuator-acknowledgement",
  "deceleration-begins",
  "collision-window",
]);

export function CausalEditingTable() {
  const { locale, setLocale, t } = useI18n();
  const [masterTime, setMasterTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [evidenceExpanded, setEvidenceExpanded] = useState(false);
  const [selectedEvidenceId, setSelectedEvidenceId] = useState<string | null>(null);
  const [bundleTransferred, setBundleTransferred] = useState(false);
  const [controlledTamper, setControlledTamper] = useState(false);
  const [authorityGapEnabled, setAuthorityGapEnabled] = useState(false);
  const [verificationPending, setVerificationPending] = useState(false);
  const [verificationResult, setVerificationResult] = useState<IndependentVerificationResult | null>(null);
  const animationFrame = useRef<number | null>(null);
  const lastFrameTime = useRef<number | null>(null);
  const verificationRun = useRef(0);
  const state = useMemo(() => deriveTimelineState(masterTime), [masterTime]);
  const evidenceState = useMemo(
    () => deriveEvidenceStateAt(masterTime),
    [masterTime],
  );
  const realityState = useMemo(
    () => deriveDomainStateAt(masterTime, "REALITY"),
    [masterTime],
  );
  const systemState = useMemo(
    () => deriveDomainStateAt(masterTime, "SYSTEM"),
    [masterTime],
  );
  const finalReceiptAvailability = useMemo(
    () => deriveFinalReceiptAvailability(masterTime),
    [masterTime],
  );
  const bundleMaterials = useMemo(() => summarizeBundleMaterials(), []);
  const authorityCondition = authorityGapEnabled ? "MISSING" : "NORMAL";
  const authorityResolution = useMemo(
    () => deriveHistoricalActionAuthorityAt(masterTime, authorityCondition),
    [authorityCondition, masterTime],
  );
  const authorityTracks = useMemo(
    () => authoritySystemTracksAt(masterTime, authorityCondition),
    [authorityCondition, masterTime],
  );
  const authorityProofItems = useMemo(
    () => authorityProofItemsAt(masterTime, authorityCondition),
    [authorityCondition, masterTime],
  );
  const resetVerificationJourney = useCallback(() => {
    verificationRun.current += 1;
    setBundleTransferred(false);
    setControlledTamper(false);
    setAuthorityGapEnabled(false);
    setVerificationPending(false);
    setVerificationResult(null);
  }, []);

  useEffect(() => {
    if (!isPlaying) {
      lastFrameTime.current = null;
      return;
    }

    const tick = (frameTime: number) => {
      const previousFrame = lastFrameTime.current ?? frameTime;
      const elapsed = Math.min(100, Math.max(0, frameTime - previousFrame));
      lastFrameTime.current = frameTime;

      setMasterTime((current) => {
        const next = clampMasterTime(current + elapsed);
        if (next >= TIMELINE_DURATION_MS) setIsPlaying(false);
        return next;
      });
      animationFrame.current = requestAnimationFrame(tick);
    };

    animationFrame.current = requestAnimationFrame(tick);
    return () => {
      if (animationFrame.current !== null) {
        cancelAnimationFrame(animationFrame.current);
      }
    };
  }, [isPlaying]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement) return;
      if (event.code === "Space") {
        event.preventDefault();
        setIsPlaying((playing) => !playing);
      } else if (event.code === "ArrowLeft") {
        setIsPlaying(false);
        const next = frameStep(masterTime, -1);
        if (next < FINAL_RECEIPT_ELIGIBILITY_MS) resetVerificationJourney();
        setMasterTime(next);
      } else if (event.code === "ArrowRight") {
        setIsPlaying(false);
        setMasterTime(frameStep(masterTime, 1));
      } else if (event.code === "Home") {
        setIsPlaying(false);
        resetVerificationJourney();
        setMasterTime(0);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [masterTime, resetVerificationJourney]);

  const play = () => {
    if (masterTime >= TIMELINE_DURATION_MS) {
      resetVerificationJourney();
      setMasterTime(0);
    }
    setIsPlaying(true);
  };

  const pause = () => setIsPlaying(false);

  const seek = (value: number) => {
    const next = clampMasterTime(value);
    setIsPlaying(false);
    if (next < FINAL_RECEIPT_ELIGIBILITY_MS) resetVerificationJourney();
    setMasterTime(next);
  };

  const transferBundle = () => {
    if (!finalReceiptAvailability.available) return;
    setBundleTransferred(true);
    setVerificationResult(null);
  };

  const verifyReceipt = async () => {
    if (!finalReceiptAvailability.available || !bundleTransferred) return;
    const run = ++verificationRun.current;
    setVerificationPending(true);
    const portableBundle = controlledTamper
      ? createControlledTamper(finalReceiptAvailability.portableBundle)
      : finalReceiptAvailability.portableBundle;
    const result = await verifyPortableEvidenceBundle({
      portableBundle,
      authorityEvidence: authorityEvidenceForCondition(authorityCondition),
      sourceClaimedVerdict: "VALID",
    });
    if (run !== verificationRun.current) return;
    setVerificationResult(result);
    setVerificationPending(false);
  };

  const recentReceipts = evidenceExpanded
    ? evidenceState.visibleReceipts
    : evidenceState.visibleReceipts.slice(-5);
  const selectedReceipt = evidenceState.visibleReceipts.find(
    (receipt) => receipt.evidence.evidence_id === selectedEvidenceId,
  ) ?? null;
  const visibleSystemStatements = SCENARIO_STATEMENTS.filter(
    (statement) =>
      statement.domain === "SYSTEM" &&
      statement.timeMs >= 3_000 &&
      statement.timeMs <= state.masterTime,
  );
  const criticalEvidenceStates = evidenceState.statementStates.filter(
    ({ statement }) => criticalStatementIds.has(statement.id),
  );

  return (
    <main className="causal-shell" data-locale={locale} data-master-time={state.masterTime}>
      <header className="mission-header">
        <div className="mission-title-group">
          <span className="mission-kicker">FortiX · D-003 independent verification</span>
          <h1>Causal Editing Table</h1>
          <p>One event. Three synchronized domains. Independent evidence.</p>
        </div>
        <div className="header-actions">
          <div className="locale-switch" role="group" aria-label={t.nav.languageLabel}>
            <button type="button" onClick={() => setLocale("en")} aria-pressed={locale === "en"}>
              EN
            </button>
            <button type="button" onClick={() => setLocale("fr")} aria-pressed={locale === "fr"}>
              FR
            </button>
          </div>
          <div className="replay-status" aria-label="Replay status">
            <span className={isPlaying ? "status-dot is-live" : "status-dot"} />
            {isPlaying ? "Replaying" : "Replay ready"}
          </div>
          <button
            className={evidenceExpanded ? "explore-button is-active" : "explore-button"}
            type="button"
            aria-expanded={evidenceExpanded}
            onClick={() => setEvidenceExpanded((expanded) => !expanded)}
          >
            <span>{evidenceExpanded ? "Close evidence" : "Explore evidence"}</span>
            <span aria-hidden="true">{evidenceExpanded ? "−" : "+"}</span>
          </button>
        </div>
      </header>

      <section className="master-console" aria-label="Master timeline controls">
        <div className="transport-controls">
          <button type="button" className="transport-button" onClick={() => seek(0)} aria-label="Rewind to start">
            <span aria-hidden="true">↤</span>
          </button>
          <button
            type="button"
            className="transport-button frame-button"
            onClick={() => seek(frameStep(masterTime, -1))}
            aria-label={`Frame backward ${FRAME_DURATION_MS} milliseconds`}
          >
            <span aria-hidden="true">‹</span>
          </button>
          {isPlaying ? (
            <button type="button" className="play-button" onClick={pause} aria-label="Pause">
              <span aria-hidden="true">Ⅱ</span>
              Pause
            </button>
          ) : (
            <button type="button" className="play-button" onClick={play} aria-label="Play">
              <span aria-hidden="true">▶</span>
              Play
            </button>
          )}
          <button
            type="button"
            className="transport-button frame-button"
            onClick={() => seek(frameStep(masterTime, 1))}
            aria-label={`Frame forward ${FRAME_DURATION_MS} milliseconds`}
          >
            <span aria-hidden="true">›</span>
          </button>
        </div>

        <div className="master-time-readout" aria-live="polite">
          <span>MASTER TIME</span>
          <strong data-testid="master-time">{state.timestamp}</strong>
          <small>/ {formatMasterTime(TIMELINE_DURATION_MS)}</small>
        </div>

        <div className="timeline-control">
          <div className="marker-rail" aria-label="Event markers">
            {D002_TIMELINE_MARKERS.map((event) => (
              <button
                key={event.id}
                type="button"
                className={event.timeMs <= state.masterTime ? "event-marker is-reached" : "event-marker"}
                style={{ left: `${(event.timeMs / TIMELINE_DURATION_MS) * 100}%` }}
                aria-label={`Go to ${event.markerLabel} at ${formatMasterTime(event.timeMs)}`}
                title={`${formatMasterTime(event.timeMs)} · ${event.markerLabel}`}
                onClick={() => seek(event.timeMs)}
              />
            ))}
          </div>
          <input
            className="master-slider"
            type="range"
            min="0"
            max={TIMELINE_DURATION_MS}
            step="1"
            value={state.masterTime}
            aria-label="Master timeline"
            onPointerDown={pause}
            onChange={(event) => seek(Number(event.target.value))}
            style={{ "--timeline-progress": `${state.progress * 100}%` } as React.CSSProperties}
          />
          <div className="timeline-scale" aria-hidden="true">
            <span>00.000</span>
            <span>02.000</span>
            <span>04.000</span>
            <span>06.000</span>
          </div>
        </div>
      </section>

      <section className="band-stack" aria-label="Synchronized causal bands">
        <article className="causal-band reality-band" data-band="reality">
          <BandLabel number="01" title="REALITY" subtitle="Physical events" />
          <div className="band-stage reality-stage">
            <div className="scene-sky" />
            <div className="scene-buildings" aria-hidden="true">
              <span /><span /><span />
            </div>
            <div className="intersection" aria-label="Placeholder intersection scene">
              <span className="lane-line lane-line-one" />
              <span className="lane-line lane-line-two" />
              <span className="crossing-lines" />
              <div
                className={state.scene.stopped ? "vehicle is-stopped" : "vehicle"}
                style={{ left: `${state.scene.vehiclePosition}%` }}
                aria-label="Placeholder vehicle"
              >
                <span className="vehicle-window" />
                <span className="vehicle-wheel wheel-front" />
                <span className="vehicle-wheel wheel-back" />
                <span className="brake-signal" style={{ opacity: state.scene.brakeIntensity }} />
              </div>
              {state.scene.scooterVisible && (
                <div
                  className="scooter"
                  style={{ top: `${state.scene.scooterPosition}%` }}
                  aria-label="Placeholder scooter"
                >
                  <span className="scooter-rider" />
                  <span className="scooter-wheel scooter-wheel-one" />
                  <span className="scooter-wheel scooter-wheel-two" />
                </div>
              )}
            </div>
            <div className="band-current-state">
              <span>PHYSICAL STATE</span>
              <strong>{realityState}</strong>
            </div>
          </div>
        </article>

        <article className="causal-band system-band" data-band="system">
          <BandLabel number="02" title="SYSTEM" subtitle="Perception and action" />
          <div className="band-stage system-stage">
            <div className="signal-thread" aria-hidden="true" />
            <div className="system-event-stream">
              {SCENARIO_STATEMENTS.filter((statement) => statement.domain === "SYSTEM").map((statement) => {
                const reached = statement.timeMs <= state.masterTime;
                const active = visibleSystemStatements.at(-1)?.id === statement.id;
                return (
                  <div
                    className={`system-node${reached ? " is-reached" : ""}${active ? " is-active" : ""}`}
                    key={statement.id}
                  >
                    <span className="node-time">{formatMasterTime(statement.timeMs)}</span>
                    <span className="node-dot" />
                    <span className="node-label">{statement.label}</span>
                  </div>
                );
              })}
            </div>
            <div className="band-current-state system-current-state">
              <span>SYSTEM STATE</span>
              <strong>{systemState}</strong>
            </div>
          </div>
          {evidenceExpanded && (
            <section className="expanded-track track-system track-suite" aria-label="System evidence tracks">
              <h3>SYSTEM TRACKS</h3>
              <div className="track-suite-body">
                {D004_SYSTEM_TRACKS.map((track) => (
                  <TrackRow
                    key={track}
                    title={track}
                    items={authorityTracks[track]}
                  />
                ))}
                {state.masterTime >= 3_760 && (
                  <div className="authority-state-summary" data-testid="authority-state">
                    <span>Authority: <strong>{authorityResolution.authorityStatus}</strong></span>
                    <span>Policy: <strong>APPLIED</strong></span>
                    <span>Action: <strong>{authorityResolution.actionAuthorized ? "AUTHORIZED" : "NOT ESTABLISHED"}</strong></span>
                  </div>
                )}
              </div>
            </section>
          )}
        </article>

        <article className="causal-band proof-band" data-band="proof">
          <BandLabel number="03" title="PROOF" subtitle="Recorded evidence" />
          <div className="band-stage proof-stage">
            <div className="receipt-count">
              <strong>{evidenceState.visibleReceipts.length}</strong>
              <span>Evidence objects reached</span>
            </div>
            <div className="receipt-stream" aria-live="polite" data-testid="receipt-stream">
              {recentReceipts.length === 0 ? (
                <div className="empty-receipt">Evidence appears only at its Significant Event time.</div>
              ) : (
                recentReceipts.map((receipt) => (
                  <ReceiptCard
                    key={receipt.evidence.evidence_id}
                    receipt={receipt}
                    selected={receipt.evidence.evidence_id === selectedEvidenceId}
                    onSelect={() => {
                      setEvidenceExpanded(true);
                      setSelectedEvidenceId(receipt.evidence.evidence_id);
                    }}
                  />
                ))
              )}
            </div>
          </div>
          {evidenceExpanded && (
            <section className="expanded-track track-proof proof-depth" aria-label="FortiX evidence tracks">
              <h3>PROOF TRACKS</h3>
              <div className="proof-depth-body">
                <EvidenceCoverageTrack states={criticalEvidenceStates} />
                <section className="proof-subtrack" aria-label="Nano-Receipts">
                  <h4>Nano-Receipts</h4>
                  <div className="proof-subtrack-items receipt-ledger">
                    {evidenceState.visibleReceipts.map((receipt) => (
                      <button
                        type="button"
                        className={receipt.evidence.evidence_id === selectedEvidenceId ? "ledger-item is-selected" : "ledger-item"}
                        key={receipt.evidence.evidence_id}
                        onClick={() => setSelectedEvidenceId(receipt.evidence.evidence_id)}
                      >
                        <time>{formatMasterTime(receipt.masterTimeMs)}</time>
                        <span>{receipt.label}</span>
                      </button>
                    ))}
                  </div>
                </section>
                <section className="proof-subtrack authority-proof-track" aria-label="Authority and Policy Evidence">
                  <h4>Authority / Policy Evidence</h4>
                  <div className="proof-subtrack-items authority-evidence-list">
                    {authorityProofItems.length === 0 ? (
                      <span className="track-empty">No authority evidence reached.</span>
                    ) : (
                      authorityProofItems.map((item) => (
                        <div className="authority-evidence-item" key={item.id}>
                          <time>{formatMasterTime(item.time)}</time>
                          <span>{item.label}</span>
                          <strong>{item.state}</strong>
                        </div>
                      ))
                    )}
                  </div>
                </section>
                <section className="proof-subtrack" aria-label="Causal Links">
                  <h4>Causal Links</h4>
                  <div className="proof-subtrack-items causal-link-list">
                    {evidenceState.causalBindings.length === 0 ? (
                      <span className="track-empty">No explicit causal link reached.</span>
                    ) : (
                      evidenceState.causalBindings.map((binding) => (
                        <div className="causal-link-item" key={binding.bindingId}>
                          <span>{binding.parentLabel ?? shortEvidenceId(binding.parentEvidenceId)}</span>
                          <span aria-hidden="true">→</span>
                          <strong>{binding.childLabel}</strong>
                        </div>
                      ))
                    )}
                  </div>
                </section>
                {selectedReceipt !== null && <ReceiptDetail receipt={selectedReceipt} />}
              </div>
            </section>
          )}
        </article>
      </section>

      <VerificationJourney
        available={finalReceiptAvailability.available}
        bundleTransferred={bundleTransferred}
        controlledTamper={controlledTamper}
        authorityGapEnabled={authorityGapEnabled}
        evidenceExpanded={evidenceExpanded}
        materials={bundleMaterials}
        pending={verificationPending}
        result={verificationResult}
        onTransfer={transferBundle}
        onVerify={verifyReceipt}
        onToggleTamper={() => {
          verificationRun.current += 1;
          setControlledTamper((enabled) => !enabled);
          setVerificationPending(false);
          setVerificationResult(null);
        }}
        onToggleAuthorityGap={() => {
          verificationRun.current += 1;
          setAuthorityGapEnabled((enabled) => !enabled);
          setVerificationPending(false);
          setVerificationResult(null);
        }}
      />

      <footer className="prototype-footer">
        <span>Final Receipt · Portable Evidence Bundle · independent recomputation</span>
        <span>Space: play/pause · ←/→: frame · Home: rewind</span>
      </footer>
    </main>
  );
}

function VerificationJourney({
  available,
  bundleTransferred,
  controlledTamper,
  authorityGapEnabled,
  evidenceExpanded,
  materials,
  pending,
  result,
  onTransfer,
  onVerify,
  onToggleTamper,
  onToggleAuthorityGap,
}: {
  available: boolean;
  bundleTransferred: boolean;
  controlledTamper: boolean;
  authorityGapEnabled: boolean;
  evidenceExpanded: boolean;
  materials: BundleMaterialSummary;
  pending: boolean;
  result: IndependentVerificationResult | null;
  onTransfer: () => void;
  onVerify: () => void;
  onToggleTamper: () => void;
  onToggleAuthorityGap: () => void;
}) {
  const { t } = useI18n();

  return (
    <section
      className={`verification-journey${available ? " is-available" : ""}`}
      aria-label="Final Receipt and independent verification"
      data-testid="verification-journey"
    >
      <header className="journey-heading">
        <div>
          <span className="section-kicker">Receipt to verdict</span>
          <h2>Independent verification</h2>
        </div>
        <p>{available ? t.d003.receiptTravelsWithEvidence : "Compilation waits for the required evidence."}</p>
      </header>

      {!available ? (
        <div className="compilation-pending" data-testid="final-receipt-unavailable">
          <span className="pending-line" />
          <strong>Final Receipt not available</strong>
          <small>Required evidence completes at 05.340.</small>
        </div>
      ) : (
        <div className={`verification-flow${bundleTransferred ? " is-transferred" : ""}`}>
          <article className="source-system-panel" aria-label="Source System">
            <span className="flow-domain-label">Source system</span>
            <div className={`bundle-formation${bundleTransferred ? " is-detached" : ""}`}>
              <span className="bundle-caption">Portable Evidence Bundle</span>
              <div className="final-receipt-card" data-testid="final-receipt">
                <span>Final Receipt</span>
                <strong>{FINAL_RECEIPT_CLAIM}</strong>
                <small>Compiled from explicit causal inputs · 05.340</small>
              </div>
              <div className="supporting-evidence" aria-label="Evidence needed to verify the Final Receipt">
                <span className="supporting-evidence-label">Evidence needed to verify</span>
                <div className="evidence-companions">
                  <span>Detection</span>
                  <span>Risk</span>
                  <span>Decision</span>
                  <span>Command</span>
                  <span>Response</span>
                  <span>Impact timing</span>
                </div>
              </div>
            </div>
            {!bundleTransferred ? (
              <button className="bundle-transfer-button" type="button" onClick={onTransfer}>
                Send portable evidence bundle
              </button>
            ) : (
              <span className="source-release-note">Bundle released from source</span>
            )}
            {evidenceExpanded && (
              <div className="bundle-inventory" aria-label="Bundle material inventory">
                <div>
                  <span>EMBEDDED</span>
                  <strong>{materials.embedded.reduce((total, item) => total + item.count, 0)} items</strong>
                </div>
                <div>
                  <span>DETACHED / REFERENCED</span>
                  <strong>{materials.referenced.length === 0 ? "None required" : `${materials.referenced.length} references`}</strong>
                </div>
                <div>
                  <span>UNAVAILABLE</span>
                  <strong>Raw streams not asserted</strong>
                </div>
              </div>
            )}
          </article>

          <div className="neutral-separation" aria-label="Separation from source">
            <span>Neutral separation</span>
            {bundleTransferred && (
              <div className="bundle-in-transit" aria-label="Portable Evidence Bundle crossing source boundary">
                <span>Portable</span>
                <strong>evidence</strong>
              </div>
            )}
          </div>

          <article className="independent-verifier-panel" aria-label="Independent Verifier">
            <span className="flow-domain-label">Independent verifier</span>
            {!bundleTransferred ? (
              <div className="verifier-awaiting">
                <strong>Waiting for portable evidence</strong>
                <small>No source-system state is readable here.</small>
              </div>
            ) : result === null ? (
              <div className="verifier-ready">
                <span>Bundle received · ready for independent verification</span>
                <button
                  className="verify-receipt-button"
                  type="button"
                  onClick={onVerify}
                  disabled={pending}
                >
                  {pending ? t.d003.verifying : t.d003.verifyReceiptIndependently}
                </button>
              </div>
            ) : (
              <div
                className={`verdict-card verdict-${result.verdict.toLowerCase()}`}
                data-testid="independent-verdict"
                aria-live="polite"
              >
                <span>INDEPENDENT VERDICT</span>
                <strong>{result.verdict}</strong>
                <p>
                  {result.reasonCodes.includes("D004_AUTHORITY_EVIDENCE_MISSING")
                    ? "Execution capability is present; authority for the action is not established."
                    : result.verdict === "INDETERMINATE"
                      ? "Receipt, evidence, and action authority verify under the demo profile; production trust/time remains incomplete."
                    : result.verdict === "INVALID"
                      ? "The portable evidence no longer matches the receipt or manifest."
                      : result.verdict === "REVOKED"
                        ? "The authority applicable to this action is no longer valid."
                        : "The claim is supported only within the displayed verification profile."}
                </p>
              </div>
            )}

            {evidenceExpanded && bundleTransferred && (
              <details className="verifier-depth">
                <summary>{result === null ? "Verification details" : "Why this verdict?"}</summary>
                <div className="verifier-depth-content">
                  {result === null ? (
                    <span>Run verification to see independently recomputed checks.</span>
                  ) : (
                    <div className="verification-layers">
                      {result.layers.map((layer) => (
                        <div className={`verification-layer layer-${layer.status.toLowerCase()}`} key={layer.id}>
                          <span>{layer.label}</span>
                          <strong>{layer.status}</strong>
                        </div>
                      ))}
                    </div>
                  )}
                  <button
                    className={`authority-gap-control${authorityGapEnabled ? " is-active" : ""}`}
                    type="button"
                    aria-pressed={authorityGapEnabled}
                    onClick={onToggleAuthorityGap}
                  >
                    {authorityGapEnabled
                      ? "Access without authority evidence enabled"
                      : "Test access without authority evidence"}
                  </button>
                  <button
                    className={`tamper-control${controlledTamper ? " is-active" : ""}`}
                    type="button"
                    aria-pressed={controlledTamper}
                    onClick={onToggleTamper}
                  >
                    {controlledTamper ? "Controlled timestamp alteration enabled" : "Test one controlled timestamp alteration"}
                  </button>
                </div>
              </details>
            )}
          </article>
        </div>
      )}
    </section>
  );
}

function BandLabel({ number, title, subtitle }: { number: string; title: string; subtitle: string }) {
  return (
    <header className="band-label">
      <span className="band-number">{number}</span>
      <div>
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
    </header>
  );
}

function ReceiptCard({
  receipt,
  selected,
  onSelect,
}: {
  receipt: NanoReceipt;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={`nano-receipt receipt-${receipt.presentationKind}${selected ? " is-selected" : ""}`}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <span className="receipt-topline">
        <span>{receiptKindLabels[receipt.presentationKind]}</span>
        <time>{formatMasterTime(receipt.masterTimeMs)}</time>
      </span>
      <strong>{receipt.label}</strong>
      <small>Available · unverified</small>
    </button>
  );
}

function TrackRow({
  title,
  items,
}: {
  title: string;
  items: readonly Readonly<{ id: string; time: number; label: string; state?: string }>[];
}) {
  return (
    <section className="track-row" aria-label={title}>
      <h4>{title}</h4>
      <div className="track-row-items">
        {items.length === 0 ? (
          <span className="track-empty">No state reached.</span>
        ) : (
          items.map((item) => (
            <div className="track-item" key={item.id}>
              <time>{formatMasterTime(item.time)}</time>
              <span>{item.label}</span>
              {item.state !== undefined && <strong>{item.state}</strong>}
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function EvidenceCoverageTrack({ states }: { states: readonly StatementEvidenceState[] }) {
  return (
    <section className="proof-subtrack" aria-label="Significant Events">
      <h4>Significant Events</h4>
      <div className="proof-subtrack-items evidence-coverage-list">
        {states.length === 0 ? (
          <span className="track-empty">No evidence-relevant statement reached.</span>
        ) : (
          states.map(({ statement, availability, receiptIds }) => (
            <div className="coverage-item" key={statement.id}>
              <time>{formatMasterTime(statement.timeMs)}</time>
              <span>{statement.label}</span>
              <small className={
                availability === "AVAILABLE_NOT_VERIFIED"
                  ? "has-evidence"
                  : availability === "INCOMPLETE_NOT_VERIFIED"
                    ? "incomplete-evidence"
                    : "no-evidence"
              }>
                {availability === "AVAILABLE_NOT_VERIFIED"
                  ? `${receiptIds.length} Evidence Object${receiptIds.length === 1 ? "" : "s"} · verification not run`
                  : availability === "INCOMPLETE_NOT_VERIFIED"
                    ? "Incomplete Evidence set · verification not run"
                    : "No FortiX evidence recorded"}
              </small>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function ReceiptDetail({ receipt }: { receipt: NanoReceipt }) {
  const parentId = receipt.evidence.causal_links.predecessor_evidence_id;
  return (
    <aside className="receipt-detail" aria-label="Selected nano-receipt">
      <div className="receipt-detail-heading">
        <span>SELECTED NANO-RECEIPT</span>
        <strong>{receipt.label}</strong>
      </div>
      <dl>
        <div>
          <dt>Receipt ID</dt>
          <dd>{receipt.evidence.evidence_id}</dd>
        </div>
        <div>
          <dt>Event</dt>
          <dd>{receipt.evidence.significant_event.event_id}</dd>
        </div>
        <div>
          <dt>Evidence timestamp</dt>
          <dd>{formatMasterTime(receipt.masterTimeMs)}</dd>
        </div>
        <div>
          <dt>Issuer / type</dt>
          <dd>{receipt.evidence.issuer.issuer_id} · {receipt.evidence.evidence_type}</dd>
        </div>
        <div>
          <dt>Causal parent(s)</dt>
          <dd>{parentId === null ? "No predecessor declared" : parentId}</dd>
        </div>
        <div>
          <dt>Availability</dt>
          <dd>Available · independent verification not run in D-002</dd>
        </div>
      </dl>
    </aside>
  );
}

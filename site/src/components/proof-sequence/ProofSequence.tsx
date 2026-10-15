import { useEffect, useRef, useState } from "react";
import { Check, RotateCcw, TriangleAlert, ArrowUpRight } from "lucide-react";
import { useI18n } from "../../i18n/context";
import { useReducedMotionPreference } from "../../hooks/useReducedMotionPreference";
import { SECTION_IDS } from "../../content/sections";
import { DEMO_URL } from "../../content/links";
import type { Verdict } from "../../i18n/protocol";
import "./proof-sequence.css";

type Phase = "idle" | "running" | "valid" | "altered" | "invalid";

const RUN_STEP_COUNT = 5; // "Action initiated" .. "Independent verification"

export function ProofSequence() {
  const { t } = useI18n();
  const reducedMotion = useReducedMotionPreference();
  const [phase, setPhase] = useState<Phase>("idle");
  const [visibleSteps, setVisibleSteps] = useState(0);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    // Intentionally reads `timers.current` at unmount time, not at effect
    // setup time: `run()`/`alterField()` push new timer ids on every click,
    // long after this effect has committed, and cleanup must clear
    // whichever ids are pending right now, not a stale snapshot.
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps
      timers.current.forEach((id) => window.clearTimeout(id));
    };
  }, []);

  const run = () => {
    setPhase("running");
    setVisibleSteps(0);

    if (reducedMotion) {
      setVisibleSteps(RUN_STEP_COUNT);
      setPhase("valid");
      return;
    }

    for (let i = 1; i <= RUN_STEP_COUNT; i += 1) {
      const id = window.setTimeout(() => {
        setVisibleSteps(i);
        if (i === RUN_STEP_COUNT) {
          setPhase("valid");
        }
      }, i * 320);
      timers.current.push(id);
    }
  };

  const alterField = () => {
    setPhase("altered");
    const id = window.setTimeout(() => setPhase("invalid"), reducedMotion ? 0 : 260);
    timers.current.push(id);
  };

  const reset = () => {
    setPhase("idle");
    setVisibleSteps(0);
  };

  const verdictKey: Verdict | "IDLE" = phase === "valid" ? "VALID" : phase === "invalid" ? "INVALID" : "IDLE";

  return (
    <section
      id={SECTION_IDS.proofSequence}
      className="section section--raised proof-sequence"
      aria-labelledby="proof-sequence-title"
    >
      <div className="container">
        <span className="section-kicker">{t.proofSequence.kicker}</span>
        <h2 id="proof-sequence-title" className="section-title">
          {t.proofSequence.title}
        </h2>
        <p className="section-lede">{t.proofSequence.body}</p>

        <div className="proof-sequence__panel">
          <div className="proof-sequence__steps">
            {t.proofSequence.steps.slice(0, RUN_STEP_COUNT).map((step, index) => (
              <div
                key={step}
                className={`proof-sequence__step${
                  index < visibleSteps || phase === "valid" || phase === "invalid" || phase === "altered"
                    ? " is-active"
                    : ""
                }`}
              >
                <span className="proof-sequence__step-index">{String(index + 1).padStart(2, "0")}</span>
                <span>{step}</span>
              </div>
            ))}
            <div className={`proof-sequence__step${phase === "altered" || phase === "invalid" ? " is-active is-warning" : ""}`}>
              <span className="proof-sequence__step-index">06</span>
              <span>{t.proofSequence.steps[5]}</span>
            </div>
            <div className={`proof-sequence__step${phase === "invalid" ? " is-active is-warning" : ""}`}>
              <span className="proof-sequence__step-index">07</span>
              <span>{t.proofSequence.steps[6]}</span>
            </div>
          </div>

          <div className="proof-sequence__result">
            <span
              className={`proof-sequence__verdict-chip${verdictKey !== "IDLE" ? ` is-${verdictKey.toLowerCase()}` : ""}`}
            >
              {verdictKey === "IDLE" ? (
                t.proofSequence.stateNotRun
              ) : (
                <span className="verdict-word" data-verdict={verdictKey}>
                  {verdictKey}
                </span>
              )}
            </span>

            <div className="proof-sequence__actions">
              <button type="button" className="button button--primary" onClick={run} disabled={phase === "running"}>
                {phase === "idle" ? t.proofSequence.runLabel : t.proofSequence.replayLabel}
              </button>
              <button
                type="button"
                className="button"
                onClick={alterField}
                disabled={phase !== "valid"}
              >
                <TriangleAlert size={15} aria-hidden="true" />
                {t.proofSequence.alterLabel}
              </button>
              <button
                type="button"
                className="nav__icon-button proof-sequence__reset"
                onClick={reset}
                aria-label={t.proofSequence.replayLabel}
                title={t.proofSequence.replayLabel}
              >
                <RotateCcw size={15} aria-hidden="true" />
              </button>
            </div>

            {phase === "valid" && (
              <p className="proof-sequence__hint">
                <Check size={14} aria-hidden="true" /> {t.proofSequence.verifyLabel}
              </p>
            )}
          </div>
        </div>

        <p className="proof-sequence__disclaimer">{t.proofSequence.disclaimer}</p>

        <a className="button button--ghost" href={DEMO_URL} target="_blank" rel="noopener noreferrer">
          {t.proofSequence.ctaDemo}
          <ArrowUpRight size={15} aria-hidden="true" />
        </a>
      </div>
    </section>
  );
}

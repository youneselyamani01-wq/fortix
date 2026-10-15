import { lazy, Suspense, useRef, useState } from "react";
import { useI18n } from "../../i18n/context";
import { useScrollProgress } from "../../hooks/useScrollProgress";
import { useWebglSupport } from "../../hooks/useWebglSupport";
import { useReducedMotionPreference } from "../../hooks/useReducedMotionPreference";
import { SceneFallback } from "./SceneFallback";
import { SECTION_IDS } from "../../content/sections";
import { evidenceObjectCopy } from "../evidence-artifact/evidenceObjectModel";
import { PebArtwork } from "../evidence-artifact/PebArtwork";
import type { Locale } from "../../i18n/dictionary";
import "./proof-journey.css";

const LazySceneCanvas = lazy(() =>
  import("./SceneCanvas").then((mod) => ({ default: mod.SceneCanvas })),
);

export function ProofJourney() {
  const { t, locale } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const visualRef = useRef<HTMLDivElement>(null);
  const progress = useScrollProgress(containerRef, visualRef);
  const webgl = useWebglSupport();
  const reducedMotion = useReducedMotionPreference();
  const stateLabels = t.journey.states.map((s) => s.title);

  const [failedLocale, setFailedLocale] = useState<Locale | null>(null);
  const canRender3d = webgl === "supported" && failedLocale !== locale;
  const fallbackNote = webgl === "supported" && failedLocale === locale
    ? t.journey.title : t.emptyStates.noWebgl;
  const [readyLocale, setReadyLocale] = useState<Locale | null>(null);
  const artworkReady = readyLocale === locale;
  const stage = Math.round(progress * (stateLabels.length - 1));
  const copy = evidenceObjectCopy(locale);
  // The canonical studio render appears once the evidence takes shape.
  // The early scene contains action/context only, never a second PEB shape.
  // Its perspective and lighting are baked in, so do not project it through
  // the moving WebGL camera or crop it to the former portrait canvas.
  const artworkOpacity = !artworkReady ? 0 : !canRender3d ? 1
    : reducedMotion ? Number(stage >= 2)
      : Math.min(1, Math.max(0, (progress - 1 / 6) * 6));

  return (
    <section
      id={SECTION_IDS.proofJourney}
      className="proof-journey section"
      aria-labelledby="proof-journey-title"
      data-journey-renderer={canRender3d ? "canvas" : artworkReady ? "artwork" : "fallback"}
      data-journey-progress={progress.toFixed(4)}
      data-journey-stage={stage}
      data-journey-artwork={artworkOpacity === 1 ? "visible" : artworkOpacity > 0 ? "entering" : "hidden"}
    >
      <div className="container-wide">
        <span className="section-kicker">{t.journey.kicker}</span>
        <h2 id="proof-journey-title" className="section-title">
          {t.journey.title}
        </h2>
      </div>

      <div ref={containerRef} className="proof-journey__track">
        <div ref={visualRef} className="proof-journey__visual">
          <div className="proof-journey__scene" style={{ opacity: 1 - artworkOpacity }} aria-hidden={artworkOpacity === 1}>
          {canRender3d ? (
            <Suspense fallback={<SceneFallback steps={stateLabels} note={fallbackNote} />}>
              <LazySceneCanvas
                className="proof-journey__canvas"
                progress={progress}
                reducedMotion={reducedMotion}
                fitNarrowViewport
              />
            </Suspense>
          ) : (
            <SceneFallback steps={stateLabels} note={fallbackNote} />
          )}
          </div>
          <figure className="proof-journey__artwork" style={{ opacity: artworkOpacity }} aria-hidden={artworkOpacity === 0}>
            <PebArtwork
              onLoad={() => { setFailedLocale(null); setReadyLocale(locale); }}
              onError={() => { setFailedLocale(locale); setReadyLocale(null); }}
            />
            <figcaption>{copy.illustration}</figcaption>
          </figure>
        </div>

        <ol className="proof-journey__beats">
          {t.journey.states.map((state, index) => (
            <li className="proof-journey__beat" data-journey-beat={index} key={index}>
              <span className="proof-journey__beat-index">{String(index + 1).padStart(2, "0")}</span>
              <h3 className="proof-journey__beat-title">{state.title}</h3>
              <p className="proof-journey__beat-body">{state.body}</p>
            </li>
          ))}
        </ol>
      </div>

      {reducedMotion && <p className="visually-hidden">{t.emptyStates.reducedMotion}</p>}
    </section>
  );
}

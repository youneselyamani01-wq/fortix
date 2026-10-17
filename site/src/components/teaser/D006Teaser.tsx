import { useEffect, useRef, useState } from "react";
import { useI18n } from "../../i18n/context";
import { useReducedMotionPreference } from "../../hooks/useReducedMotionPreference";
import { DEMO_URL } from "../../content/links";
import "./d006-teaser.css";

const DISMISSED_KEY = "fortix-d006-teaser-dismissed";

/**
 * Decorative, illustrated D-006 preview. Never starts an NX mission, creates a
 * NanoReceipt, reports telemetry or claims to verify evidence.
 */
export function D006Teaser() {
  const { t } = useI18n();
  const reducedMotion = useReducedMotionPreference();
  const root = useRef<HTMLElement>(null);
  const [dismissed, setDismissed] = useState(() => {
    try { return window.sessionStorage.getItem(DISMISSED_KEY) === "1"; }
    catch { return false; }
  });
  const [paused, setPaused] = useState(false);
  const [explicitPlay, setExplicitPlay] = useState(false);
  const [inView, setInView] = useState(true);
  const [pageVisible, setPageVisible] = useState(() => document.visibilityState !== "hidden");

  useEffect(() => {
    const sync = () => setPageVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);

  useEffect(() => {
    const node = root.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => {
      setInView(Boolean(entry?.isIntersecting));
    }, { threshold: 0.05 });
    observer.observe(node);
    return () => observer.disconnect();
  }, [dismissed]);

  if (dismissed) return null;

  const playing = !paused && (explicitPlay || !reducedMotion) && inView && pageVisible;
  const close = () => {
    try { window.sessionStorage.setItem(DISMISSED_KEY, "1"); } catch { /* storage may be unavailable */ }
    setDismissed(true);
  };
  const togglePlayback = () => {
    if (playing) setPaused(true);
    else { setExplicitPlay(true); setPaused(false); }
  };

  return (
    <aside
      ref={root}
      className="d006-teaser"
      aria-labelledby="d006-teaser-title"
      data-playing={playing ? "true" : "false"}
      data-simulated="true"
    >
      <div className="d006-teaser__top">
        <span className="d006-teaser__eyebrow">{t.teaser.kicker}</span>
        <button className="d006-teaser__close" type="button" onClick={close} aria-label={t.teaser.close}>
          <span aria-hidden="true">×</span>
        </button>
      </div>

      <svg
        className="d006-teaser__scene"
        viewBox="0 0 340 170"
        role="img"
        aria-label={t.teaser.sceneDescription}
        focusable="false"
      >
        <defs>
          <linearGradient id="d006-teaser-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#E7F5F9" />
            <stop offset="1" stopColor="#F8FAFE" />
          </linearGradient>
          <linearGradient id="d006-teaser-car" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#FF9B63" />
            <stop offset="1" stopColor="#DC634D" />
          </linearGradient>
        </defs>
        <rect width="340" height="170" fill="url(#d006-teaser-sky)" />
        <path d="M0 104 L43 104 L43 68 L69 68 L69 104 L100 104 L100 80 L133 80 L133 104 L163 104 L163 52 L188 52 L188 104 L340 104 L340 170 L0 170Z" fill="#D8EBF4" />
        <path d="M0 121H340" stroke="#AFCBDB" strokeWidth="1" />
        <rect x="0" y="122" width="340" height="48" fill="#EFF2F5" />
        <path d="M0 148 H340" stroke="#9BB0BE" strokeWidth="1" strokeDasharray="13 11" />
        <path d="M0 122 H340" stroke="#BCCDD7" strokeWidth="2" />
        <g aria-hidden="true">
          <path d="M268 119V65" stroke="#6D8999" strokeWidth="4" />
          <rect x="257" y="44" width="22" height="40" rx="8" fill="#31516A" />
          <circle className="d006-teaser__lamp-red" cx="268" cy="53" r="5" fill="#ED7756" />
          <circle cx="268" cy="64" r="5" fill="#C9D2D7" />
          <circle className="d006-teaser__lamp-green" cx="268" cy="75" r="5" fill="#7CD2B5" />
        </g>
        <g className="d006-teaser__taxi" aria-hidden="true">
          <ellipse cx="56" cy="142" rx="35" ry="4" fill="#A1B9C6" opacity=".36" />
          <path d="M20 125L31 111Q34 107 40 107H66Q72 107 76 112L86 125H92Q97 125 97 131V139H12V131Q12 125 20 125Z" fill="url(#d006-teaser-car)" />
          <path d="M40 112H64Q69 112 72 117L78 125H29L35 115Q37 112 40 112Z" fill="#D9F4FF" opacity=".94" />
          <path d="M54 113V125" stroke="#EF9C79" strokeWidth="2" />
          <path d="M17 131H23" stroke="#FFF6D6" strokeWidth="3" strokeLinecap="round" />
          <path d="M89 131H94" stroke="#F5BE9A" strokeWidth="3" strokeLinecap="round" />
          <circle cx="31" cy="140" r="8" fill="#365269" />
          <circle cx="31" cy="140" r="3.5" fill="#D4E8EC" />
          <circle cx="78" cy="140" r="8" fill="#365269" />
          <circle cx="78" cy="140" r="3.5" fill="#D4E8EC" />
          <rect x="47" y="102" width="18" height="5" rx="2" fill="#FFF9E4" />
        </g>
        <g className="d006-teaser__receipt" aria-hidden="true">
          <rect x="147" y="49" width="83" height="31" rx="8" fill="white" stroke="#9DB9CC" />
          <circle cx="163" cy="65" r="5" fill="#79B9AB" />
          <text x="176" y="69" fill="#2B4E68" fontSize="11" fontFamily="sans-serif" fontWeight="600">NR</text>
          <path d="M168 82 L157 97" stroke="#9DB9CC" strokeDasharray="3 3" />
        </g>
      </svg>

      <div className="d006-teaser__body">
        <h2 id="d006-teaser-title">{t.teaser.title}</h2>
        <p>{t.teaser.body}</p>
        <div className="d006-teaser__actions">
          <a href={DEMO_URL} target="_blank" rel="noopener noreferrer" className="d006-teaser__cta">
            {t.teaser.cta}<span aria-hidden="true"> ↗</span>
          </a>
          <button
            className="d006-teaser__play"
            type="button"
            onClick={togglePlayback}
            aria-label={playing ? t.teaser.pause : t.teaser.play}
            aria-pressed={playing}
          >
            <span aria-hidden="true">{playing ? "Ⅱ" : "▶"}</span>
          </button>
        </div>
      </div>
    </aside>
  );
}

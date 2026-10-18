import { EvidenceArtifact } from "../evidence-artifact/EvidenceArtifact";
import { FortixIcon } from "../icons/FortixIcon";
import { useI18n } from "../../i18n/context";
import { SECTION_IDS } from "../../content/sections";
import { DEMO_URL, VERIFIER_URL } from "../../content/links";
import "./hero.css";

export function Hero() {
  const { t, locale } = useI18n();

  return (
    <section id={SECTION_IDS.hero} className="hero" aria-labelledby="hero-title">
      <div className="container-wide hero__layout">
      <div className="hero__content">
        <span className="section-kicker">{t.hero.kicker}</span>
        <h1 id="hero-title" className="hero__title">
          {t.hero.title}
        </h1>
        <p className="hero__subtitle">{t.hero.subtitle}</p>

        <div className="hero__actions">
          <a className="button button--primary" href={DEMO_URL} target="_blank" rel="noopener noreferrer">
            {t.cta.viewDemo}
          </a>
          <a className="button button--ghost" href={VERIFIER_URL} target="_blank" rel="noopener noreferrer">
            {t.nav.verifier}
          </a>
          <a className="button button--ghost" href="#open-verification">
            {locale === "fr" ? "Examiner une preuve publique" : "Inspect public evidence"}
          </a>
        </div>

        <ol className="hero__flow" aria-label={t.hero.kicker}>
          {t.hero.flow.map((step, index) => (
            <li key={step.label}>
              <span>{step.label}</span>
              {index < t.hero.flow.length - 1 && <FortixIcon name="arrowRight" size={14} aria-hidden="true" />}
            </li>
          ))}
        </ol>




        <p className="hero__scroll-hint">{t.hero.scrollHint}</p>
      </div>
      <div className="hero__object"><EvidenceArtifact loading="eager" /></div>
      </div>
    </section>
  );
}

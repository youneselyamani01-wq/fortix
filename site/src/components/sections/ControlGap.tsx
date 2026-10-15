import { FortixIcon } from "../icons/FortixIcon";
import { useI18n } from "../../i18n/context";
import { SECTION_IDS } from "../../content/sections";
import "./control-gap.css";

export function ControlGap() {
  const { t } = useI18n();

  return (
    <section id={SECTION_IDS.controlGap} className="section control-gap" aria-labelledby="control-gap-title">
      <div className="container">
        <span className="section-kicker">{t.controlGap.kicker}</span>
        <h2 id="control-gap-title" className="section-title">
          {t.controlGap.title}
        </h2>

        <ol className="control-gap__progression">
          {t.controlGap.progression.map((step, index) => (
            <li key={step}>
              <span>{step}</span>
              {index < t.controlGap.progression.length - 1 && (
                <FortixIcon name="arrowRight" size={14} aria-hidden="true" />
              )}
            </li>
          ))}
        </ol>

        <p className="control-gap__question">{t.controlGap.question}</p>

        <div className="control-gap__grid">
          <ul className="control-gap__explainer">
            <li>{t.controlGap.explainer.platforms}</li>
            <li>{t.controlGap.explainer.policies}</li>
            <li>{t.controlGap.explainer.tools}</li>
            <li>{t.controlGap.explainer.logs}</li>
          </ul>
          <p className="control-gap__third-party">{t.controlGap.explainer.thirdParty}</p>
        </div>

        <p className="control-gap__logs-line">{t.controlGap.logsLine}</p>
      </div>
    </section>
  );
}

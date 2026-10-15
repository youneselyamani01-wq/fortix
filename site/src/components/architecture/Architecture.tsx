import { useI18n } from "../../i18n/context";
import { SECTION_IDS } from "../../content/sections";
import "./architecture.css";

export function Architecture() {
  const { t } = useI18n();

  return (
    <section
      id={SECTION_IDS.architecture}
      className="section architecture"
      aria-labelledby="architecture-title"
    >
      <div className="container architecture__layout">
        <div className="architecture__intro">
          <span className="section-kicker">{t.architecture.kicker}</span>
          <h2 id="architecture-title" className="section-title">
            {t.architecture.title}
          </h2>
          <p className="section-lede">{t.architecture.intro}</p>
        </div>

        <ol className="architecture__stack" aria-label={t.architecture.title}>
          {t.architecture.rows.map((row, index) => (
            <li key={index} className="architecture__stage" data-architecture-stage={index + 1}>
              <span className="architecture__index" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
              <div className={`architecture__row${index === t.architecture.rows.length - 1 ? " architecture__row--verdicts" : ""}`}>
                {row}
              </div>
            </li>
          ))}
        </ol>

        <p className="architecture__note">{t.architecture.note}</p>
      </div>
    </section>
  );
}

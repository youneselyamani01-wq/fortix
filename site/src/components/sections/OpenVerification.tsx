import { useI18n } from "../../i18n/context";
import { SECTION_IDS } from "../../content/sections";
import "./open-verification.css";

export function OpenVerification() {
  const { t } = useI18n();

  return (
    <section
      id={SECTION_IDS.openVerification}
      className="section open-verification"
      aria-labelledby="open-verification-title"
    >
      <div className="container">
        <span className="section-kicker">{t.openVerification.kicker}</span>
        <h2 id="open-verification-title" className="section-title">
          {t.openVerification.title}
        </h2>
        <p className="section-lede">{t.openVerification.body}</p>

        <ul className="open-verification__list">
          {t.openVerification.items.map((item) => (
            <li key={item.label}>
              <div className="open-verification__row">
                <span className="status-tag" data-status={item.status}>
                  {t.openVerification.distinguish[item.status]}
                </span>
                <strong>{item.label}</strong>
              </div>
              <p>{item.body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

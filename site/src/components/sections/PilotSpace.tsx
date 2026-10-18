import { useI18n } from "../../i18n/context";
import { SECTION_IDS } from "../../content/sections";
import "./pilot-space.css";

/**
 * Exploratory conversations only. A live application portal is not implied.
 * Publication gate: confirm the contact@fortix.cloud mailbox can receive replies.
 */
const PILOT_CONTACT = "contact@fortix.cloud";
const PILOT_SUBJECT = "FortiX — pilot proposal";

export function PilotSpace() {
  const { t } = useI18n();

  const contactHref = `mailto:${PILOT_CONTACT}?subject=${encodeURIComponent(PILOT_SUBJECT)}`;

  return (
    <section id={SECTION_IDS.pilot} className="section pilot-space" aria-labelledby="pilot-space-title">
      <div className="container pilot-space__layout">
        <div className="pilot-space__intro">
          <span className="section-kicker">{t.pilot.kicker}</span>
          <h2 id="pilot-space-title" className="section-title">{t.pilot.title}</h2>
          <p className="section-lede">{t.pilot.body}</p>
          <a className="button button--primary pilot-space__cta" href={contactHref}>{t.pilot.cta}</a>
          <p className="pilot-space__note">{t.pilot.note}</p>
        </div>
        <div className="pilot-space__detail">
          <h3>{t.pilot.examplesTitle}</h3>
          <ul>
            {t.pilot.examples.map((item) => <li key={item}>{item}</li>)}
          </ul>
          <p>{t.pilot.outro}</p>
        </div>
      </div>
    </section>
  );
}

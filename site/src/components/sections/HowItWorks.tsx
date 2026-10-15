import { useI18n } from "../../i18n/context";
import { VERDICTS } from "../../i18n/protocol";
import { SECTION_IDS } from "../../content/sections";
import "./how-it-works.css";

export function HowItWorks() {
  const { t } = useI18n();
  const objects = [t.howItWorks.receipt, t.howItWorks.bundle];

  return (
    <section
      id={SECTION_IDS.howItWorks}
      className="section section--raised how-it-works"
      aria-labelledby="how-it-works-title"
    >
      <div className="container">
        <span className="section-kicker">{t.howItWorks.kicker}</span>
        <h2 id="how-it-works-title" className="section-title">
          {t.howItWorks.title}
        </h2>
        <p className="section-lede">{t.howItWorks.intro}</p>

        <div className="how-it-works__objects">
          {objects.map((object) => (
            <article className="how-it-works__object" key={object.title}>
              <h3>{object.title}</h3>
              <p>{object.body}</p>
              <ul className="how-it-works__fields">
                {object.fields.map((field) => (
                  <li key={field}>
                    <code>{field}</code>
                  </li>
                ))}
              </ul>
            </article>
          ))}

          <article className="how-it-works__object how-it-works__object--verifier">
            <h3>{t.howItWorks.verifier.title}</h3>
            <p>{t.howItWorks.verifier.body}</p>
            <p className="how-it-works__verdicts-intro">{t.howItWorks.verifier.verdictsIntro}</p>
            <ul className="how-it-works__verdicts">
              {VERDICTS.map((verdict) => (
                <li key={verdict}>
                  <span className="verdict-word" data-verdict={verdict}>
                    {verdict}
                  </span>
                </li>
              ))}
            </ul>
          </article>
        </div>

        <div className="how-it-works__boundary">
          <h3>{t.howItWorks.boundary.title}</h3>
          <p>{t.howItWorks.boundary.body}</p>
        </div>
      </div>
    </section>
  );
}

import { useI18n } from "../../i18n/context";
import { SECTION_IDS } from "../../content/sections";
import "./use-cases.css";

const ACTION_CLASSES = ["agentic", "software", "human", "payments", "cyberPhysical", "external", "multiParty"] as const;

export function UseCases() {
  const { t } = useI18n();
  const copy = t.useCases;
  return (
    <section id={SECTION_IDS.useCases} className="section use-cases" aria-labelledby="use-cases-title">
      <div className="container">
        <div className="use-cases__header">
          <span className="section-kicker">{copy.kicker}</span>
          <h2 id="use-cases-title" className="section-title">{copy.title}</h2>
          <p className="section-lede use-cases__intro">{copy.intro}</p>
        </div>

        <ol className="use-cases__actions" aria-label={copy.title}>
          {ACTION_CLASSES.map((key, index) => {
            const action = copy.classes[key];
            return <li key={key} className="use-cases__action" data-action-class={key}>
              <span className="use-cases__number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
              <h3>{action.title}</h3>
              <p>{action.body}</p>
              <ul className="use-cases__examples">
                {action.points.map((point) => <li key={point}>{point}</li>)}
              </ul>
            </li>;
          })}
        </ol>

        <p className="use-cases__environments"><strong>{copy.examplesLabel}</strong><span>{copy.examples}</span></p>
      </div>
    </section>
  );
}

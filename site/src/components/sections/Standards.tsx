import { useI18n } from "../../i18n/context";
import { SECTION_IDS } from "../../content/sections";
import "./standards.css";

export function Standards() {
  const { t } = useI18n();
  const groups: { status: "delivered" | "documented" | "roadmap"; label: string; items: { name: string; body: string }[] }[] = [
    { status: "delivered", label: t.standards.legend.delivered, items: t.standards.delivered },
    { status: "documented", label: t.standards.legend.documented, items: t.standards.documented },
    { status: "roadmap", label: t.standards.legend.roadmap, items: t.standards.roadmap },
  ];

  return (
    <section
      id={SECTION_IDS.standards}
      className="section section--raised standards"
      aria-labelledby="standards-title"
    >
      <div className="container">
        <span className="section-kicker">{t.standards.kicker}</span>
        <h2 id="standards-title" className="section-title">
          {t.standards.title}
        </h2>
        <p className="section-lede">{t.standards.intro}</p>

        <div className="standards__groups">
          {groups.map((group) => (
            <div className="standards__group" key={group.status}>
              <span className="status-tag" data-status={group.status}>
                {group.label}
              </span>
              <ul>
                {group.items.map((item) => (
                  <li key={item.name}>
                    <strong>{item.name}</strong>
                    <span>{item.body}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

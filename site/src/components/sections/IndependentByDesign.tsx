import { BoundaryKey } from "../BoundaryKey";
import { EvidenceArtifact } from "../evidence-artifact/EvidenceArtifact";
import { FortixIcon } from "../icons/FortixIcon";
import { surfaceCopy } from "../../i18n/surface";
import { useI18n } from "../../i18n/context";
import { SECTION_IDS } from "../../content/sections";
import "./independent-by-design.css";

export function IndependentByDesign() {
  const { t, locale } = useI18n();
  const copy = t.independentByDesign;
  const [portable, offline, deterministic, thirdParty, provider] = copy.properties;

  return (
    <section id={SECTION_IDS.independentByDesign} className="section independent-by-design" aria-labelledby="independent-by-design-title">
      <div className="container">
        <span className="section-kicker">{copy.kicker}</span>
        <h2 id="independent-by-design-title" className="section-title">{copy.title}</h2>

        <div className="independent-by-design__bento">
          <article className="independent-by-design__tile independent-by-design__tile--primary">
            <FortixIcon name="inspect" size={32} />
            <h3>{t.hero.flow[2]!.label}</h3>
            <p>{copy.disappearNote}</p>
          </article>
          <article className="independent-by-design__tile independent-by-design__tile--portable">
            <h3>{portable!.title} <span>PEB</span></h3>
            <p>{portable!.body}</p>
            <EvidenceArtifact />
          </article>
          <article className="independent-by-design__tile independent-by-design__tile--offline">
            <FortixIcon name="boundary" size={24} />
            <h3>{offline!.title}</h3>
            <p>{offline!.body}</p>
          </article>
          <article className="independent-by-design__tile independent-by-design__tile--third-party">
            <FortixIcon name="external" size={24} />
            <h3>{thirdParty!.title}</h3>
            <p>{thirdParty!.body}</p>
          </article>
        </div>

        <ul className="independent-by-design__principles">
          {[deterministic!, provider!].map((property) => (
            <li key={property.title}><strong>{property.title}</strong><span>{property.body}</span></li>
          ))}
        </ul>

        <div className="independent-by-design__flow">
          {copy.flowLabels.map((label, index) => (
            <div className="independent-by-design__flow-step" key={label}>
              <span className="independent-by-design__flow-node">{label}</span>
              {index < copy.flowLabels.length - 1 && <FortixIcon name="arrowRight" size={20} />}
            </div>
          ))}
        </div>
        <p className="independent-by-design__transfer">{surfaceCopy[locale].transfer}</p>
        <BoundaryKey locale={locale} />
      </div>
    </section>
  );
}

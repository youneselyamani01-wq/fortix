import { useI18n } from "../../i18n/context";
import { SECTION_IDS } from "../../content/sections";
import "./verification-layers.css";

export function VerificationLayers() {
  const { t } = useI18n();

  return (
    <section
      id={SECTION_IDS.verificationLayers}
      className="section verification-layers"
      aria-labelledby="verification-layers-title"
    >
      <div className="container">
        <span className="section-kicker">{t.verificationLayers.kicker}</span>
        <h2 id="verification-layers-title" className="section-title">
          {t.verificationLayers.title}
        </h2>
        <p className="section-lede">{t.verificationLayers.intro}</p>

        <ul className="verification-layers__grid">
          {t.verificationLayers.layers.map((layer, index) => (
            <li key={layer.name}>
              <span className="verification-layers__index">{String(index + 1).padStart(2, "0")}</span>
              <h3>{layer.name}</h3>
              <p>{layer.body}</p>
            </li>
          ))}
        </ul>

        <p className="verification-layers__footnote">{t.verificationLayers.footnote}</p>
      </div>
    </section>
  );
}

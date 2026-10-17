import { useI18n } from "../../i18n/context";
import { SECTION_IDS } from "../../content/sections";
import "./open-verification.css";

export function OpenVerification() {
  const { t, locale } = useI18n();

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

        <div className="open-verification__public-proof">
          <p className="section-kicker">{locale === "fr" ? "DOSSIER PUBLIC DE RÉFÉRENCE" : "PUBLIC REFERENCE EVIDENCE"}</p>
          <h3>{locale === "fr" ? "Ne nous croyez pas. Vérifiez." : "Don't trust us. Verify."}</h3>
          <p>{locale === "fr"
            ? "Un PEB D-006 de démonstration est téléchargeable sans lancer la mission. Analysez-le dans le Vérificateur indépendant, puis testez une copie modifiée. Verdict attendu : INDETERMINATE, et non VALID en production."
            : "Download a D-006 demonstration PEB without running the mission. Analyze it in the Independent Verifier, then test an altered copy. Expected verdict: INDETERMINATE, not production VALID."}</p>
          <div className="open-verification__actions">
            <a className="button button--primary" href="/evidence/d006-reference-peb.json" download="d006-reference-peb.json">
              {locale === "fr" ? "Télécharger le PEB" : "Download the PEB"}
            </a>
            <a className="button button--ghost" href="/verify" target="_blank" rel="noopener noreferrer">
              {locale === "fr" ? "Ouvrir le Vérificateur" : "Open the Verifier"}
            </a>
            <a className="button button--ghost" href="https://github.com/youneselyamani01-wq/fortix/blob/main/docs/evidence/PUBLIC-VERIFICATION-WALKTHROUGH.md" target="_blank" rel="noopener noreferrer">
              {locale === "fr" ? "Guide et spécification" : "Guide and specification"}
            </a>
          </div>
          <p className="open-verification__limits">{locale === "fr"
            ? "Scénario simulé ; confiance de production et temps de confiance non établis. Aucune preuve de règlement bancaire ou d'événement physique réel."
            : "Simulated scenario; production trust and trusted time not established. No proof of bank settlement or real-world physical events."}</p>
        </div>
      </div>
    </section>
  );
}

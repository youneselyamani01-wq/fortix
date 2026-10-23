import { useI18n } from "../../i18n/context";
import { BRAND_SIGNATURE } from "../../i18n/protocol";
import { SECTION_IDS } from "../../content/sections";
import { DEMO_URL, DOCS_URL, VERIFIER_URL } from "../../content/links";
import { EvidenceArtifact } from "../evidence-artifact/EvidenceArtifact";
import "./final-statement.css";

export function FinalStatement() {
  const { t, locale } = useI18n();

  return (
    <section
      id={SECTION_IDS.finalStatement}
      className="final-statement"
      aria-labelledby="final-statement-title"
    >
      <div className="final-statement__visual" aria-hidden="true">
        <EvidenceArtifact />
      </div>

      <div className="container final-statement__content">
        <h2 id="final-statement-title" className="final-statement__lines">
          <span>{t.finalStatement.line1}</span>
          <span>{t.finalStatement.line2}</span>
          <span className="final-statement__line--emphasis">{t.finalStatement.line3}</span>
        </h2>

        <p className="final-statement__signature">{BRAND_SIGNATURE[locale]}</p>

        <div className="final-statement__actions">
          <a className="button button--primary" href={DEMO_URL} target="_blank" rel="noopener noreferrer">
            {t.finalStatement.ctaDemo}
          </a>
          {DOCS_URL ? (
            <a className="button button--ghost" href={DOCS_URL} target="_blank" rel="noopener noreferrer">
              {t.finalStatement.ctaDocs}
            </a>
          ) : (
            <span className="button button--ghost" aria-disabled="true" title={t.footer.githubUnavailable}>
              {t.finalStatement.ctaDocs}
            </span>
          )}
          <a className="button button--ghost" href={VERIFIER_URL} target="_blank" rel="noopener noreferrer">
            {t.finalStatement.ctaVerify}
          </a>
        </div>
      </div>
    </section>
  );
}

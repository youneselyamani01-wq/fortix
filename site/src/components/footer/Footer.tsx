import { useI18n } from "../../i18n/context";
import { BRAND_SIGNATURE } from "../../i18n/protocol";
import { SECTION_IDS } from "../../content/sections";
import { DEMO_URL, DOCS_URL, GITHUB_URL } from "../../content/links";
import "./footer.css";

function scrollToId(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export function Footer() {
  const { t, locale, setLocale } = useI18n();

  return (
    <footer className="footer">
      <div className="container footer__grid">
        <div className="footer__brand">
          <span className="footer__brand-name">{t.nav.brand}</span>
          <p>{t.footer.copyrightNote}</p>
        </div>

        <div className="footer__column">
          <h3>{t.footer.productHeading}</h3>
          <ul>
            <li>
              <a href={DEMO_URL} target="_blank" rel="noopener noreferrer">
                {t.footer.demoLink}
              </a>
            </li>
            <li>
              <button type="button" onClick={() => scrollToId(SECTION_IDS.verificationLayers)}>
                {t.footer.verifierLink}
              </button>
            </li>
            <li>
              {DOCS_URL ? (
                <a href={DOCS_URL} target="_blank" rel="noopener noreferrer">
                  {t.footer.docsLink}
                </a>
              ) : (
                <span className="footer__unavailable" title={t.footer.githubUnavailable}>
                  {t.footer.docsLink}
                </span>
              )}
            </li>
          </ul>
        </div>

        <div className="footer__column">
          <h3>GitHub</h3>
          <ul>
            <li>
              {GITHUB_URL ? (
                <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
                  {t.footer.githubLink}
                </a>
              ) : (
                <span className="footer__unavailable">{t.footer.githubUnavailable}</span>
              )}
            </li>
          </ul>
        </div>

        <div className="footer__column">
          <h3>{t.footer.languageHeading}</h3>
          <ul>
            <li>
              <button type="button" onClick={() => setLocale("en")} aria-pressed={locale === "en"}>
                EN
              </button>
            </li>
            <li>
              <button type="button" onClick={() => setLocale("fr")} aria-pressed={locale === "fr"}>
                FR
              </button>
            </li>
          </ul>
        </div>
      </div>

      <div className="container footer__legal">
        <p>{t.footer.disclaimer}</p>
        <p className="footer__signature">{BRAND_SIGNATURE[locale]}</p>
      </div>
    </footer>
  );
}

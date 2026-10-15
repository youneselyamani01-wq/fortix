import { useRef, useState } from "react";
import { FortixIcon } from "../icons/FortixIcon";
import { useI18n } from "../../i18n/context";
import { NAV_TARGETS } from "../../content/sections";
import { DEMO_URL, DOCS_URL, VERIFIER_URL } from "../../content/links";
import "./navigation.css";

function scrollToId(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export function Navigation() {
  const { t, locale, toggleLocale } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);

  const handleNavigate = (anchor: string) => {
    setMenuOpen(false);
    scrollToId(anchor);
  };

  return (
    <header className="nav" onKeyDown={(event) => {
      if (event.key === "Escape" && menuOpen) { setMenuOpen(false); menuButton.current?.focus(); }
    }}>
      <div className="nav__inner container-wide">
        <a
          className="nav__brand"
          href="#hero"
          onClick={(event) => {
            event.preventDefault();
            handleNavigate("hero");
          }}
        >
          {t.nav.brand}
        </a>

        <nav className="nav__links" aria-label={t.nav.brand}>
          <a className="nav__link nav__link--verifier" href={VERIFIER_URL} target="_blank" rel="noopener noreferrer">{t.nav.verifier}</a>
          {NAV_TARGETS.map(({ key, anchor }) => (
            <button
              key={key}
              type="button"
              className="nav__link"
              onClick={() => handleNavigate(anchor)}
            >
              {t.nav[key]}
            </button>
          ))}
          <a
            className="nav__link"
            href={DEMO_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t.nav.demo}
          </a>
          {DOCS_URL ? (
            <a className="nav__link" href={DOCS_URL} target="_blank" rel="noopener noreferrer">
              {t.nav.docs}
            </a>
          ) : (
            <span className="nav__link nav__link--disabled" title={t.footer.githubUnavailable}>
              {t.nav.docs}
            </span>
          )}
        </nav>

        <div className="nav__controls">
          <button
            type="button"
            className="nav__lang"
            onClick={toggleLocale}
            aria-label={t.nav.languageLabel}
          >
            <span className={locale === "en" ? "is-active" : ""}>EN</span>
            <span aria-hidden="true">/</span>
            <span className={locale === "fr" ? "is-active" : ""}>FR</span>
          </button>
          <button
            type="button"
            className="nav__icon-button nav__menu-toggle"
            ref={menuButton}
            aria-controls="site-mobile-navigation"
            onClick={() => setMenuOpen((open) => !open)}
            aria-label={menuOpen ? t.nav.closeMenu : t.nav.openMenu}
            aria-expanded={menuOpen}
          >
            {menuOpen ? <FortixIcon name="close" size={18} /> : <FortixIcon name="menu" size={18} />}
          </button>
        </div>
      </div>

      {menuOpen && (
        <nav className="nav__mobile" id="site-mobile-navigation" aria-label={t.nav.brand}>
          <a href={VERIFIER_URL} target="_blank" rel="noopener noreferrer">{t.nav.verifier}</a>
          {NAV_TARGETS.map(({ key, anchor }) => (
            <button key={key} type="button" onClick={() => handleNavigate(anchor)}>
              {t.nav[key]}
            </button>
          ))}
          <a href={DEMO_URL} target="_blank" rel="noopener noreferrer">
            {t.nav.demo}
          </a>
        </nav>
      )}
    </header>
  );
}

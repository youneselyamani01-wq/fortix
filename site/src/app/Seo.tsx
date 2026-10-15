import { useEffect } from "react";
import { useI18n } from "../i18n/context";

/**
 * Updates the document head when the language changes. This is a
 * client-rendered SPA with no server-side rendering/prerendering step, so
 * a crawler's very first fetch sees the English defaults baked into
 * `index.html`; this effect keeps the head accurate for users navigating
 * with JavaScript enabled (which is also what any modern crawler executes).
 * The canonical URL is derived from wherever the page is actually served,
 * never a hard-coded production domain.
 */
export function Seo() {
  const { t, locale } = useI18n();

  useEffect(() => {
    document.title = t.meta.title;

    const description = document.querySelector('meta[name="description"]');
    description?.setAttribute("content", t.meta.description);

    const ogTitle = document.querySelector('meta[property="og:title"]');
    ogTitle?.setAttribute("content", t.meta.title);

    const ogDescription = document.querySelector('meta[property="og:description"]');
    ogDescription?.setAttribute("content", t.meta.description);

    const ogLocale = document.querySelector('meta[property="og:locale"]');
    ogLocale?.setAttribute("content", t.meta.ogLocale);

    const twitterTitle = document.querySelector('meta[name="twitter:title"]');
    twitterTitle?.setAttribute("content", t.meta.title);

    const twitterDescription = document.querySelector('meta[name="twitter:description"]');
    twitterDescription?.setAttribute("content", t.meta.description);

    const canonicalOrigin = import.meta.env.VITE_CANONICAL_ORIGIN ?? window.location.origin;
    const canonical = document.getElementById("canonical-link");
    canonical?.setAttribute("href", `${canonicalOrigin}${window.location.pathname}`);

    const ogUrl = document.querySelector('meta[property="og:url"]') ?? (() => {
      const meta = document.createElement("meta");
      meta.setAttribute("property", "og:url");
      document.head.appendChild(meta);
      return meta;
    })();
    ogUrl.setAttribute("content", `${canonicalOrigin}${window.location.pathname}`);
  }, [t, locale]);

  return null;
}

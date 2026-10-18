import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { LanguageContext, type LanguageContextValue } from "./context";
import type { Dictionary, Locale } from "./dictionary";
import { en } from "./locales/en";
import { fr } from "./locales/fr";

const STORAGE_KEY = "fortix-site-language";
const DICTIONARIES: Record<Locale, Dictionary> = { en, fr };

function readInitialLocale(): Locale {
  if (typeof window === "undefined") return "en";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === "en" || stored === "fr") return stored;
  return (window.navigator?.language?.toLowerCase() ?? "").startsWith("fr") ? "fr" : "en";
}

/** Provider is isolated so React Fast Refresh sees a component-only module. */
export function LanguageProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(readInitialLocale);

  useEffect(() => {
    document.documentElement.lang = locale;
    window.localStorage.setItem(STORAGE_KEY, locale);
  }, [locale]);

  const setLocale = useCallback((next: Locale) => setLocaleState(next), []);
  const toggleLocale = useCallback(() => setLocaleState(current => current === "en" ? "fr" : "en"), []);
  const value = useMemo<LanguageContextValue>(
    () => ({ locale, t: DICTIONARIES[locale], setLocale, toggleLocale }),
    [locale, setLocale, toggleLocale],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Dictionary, Locale } from "./dictionary";
import { en } from "./locales/en";
import { fr } from "./locales/fr";

const STORAGE_KEY = "fortix-site-language";

const DICTIONARIES: Record<Locale, Dictionary> = { en, fr };

interface LanguageContextValue {
  locale: Locale;
  t: Dictionary;
  setLocale: (locale: Locale) => void;
  toggleLocale: () => void;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

function readInitialLocale(): Locale {
  if (typeof window === "undefined") {
    return "en";
  }
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === "en" || stored === "fr") {
    return stored;
  }
  const browserLocale = window.navigator?.language?.toLowerCase() ?? "";
  return browserLocale.startsWith("fr") ? "fr" : "en";
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(readInitialLocale);

  useEffect(() => {
    document.documentElement.lang = locale;
    window.localStorage.setItem(STORAGE_KEY, locale);
  }, [locale]);

  const setLocale = useCallback((next: Locale) => setLocaleState(next), []);
  const toggleLocale = useCallback(
    () => setLocaleState((current) => (current === "en" ? "fr" : "en")),
    [],
  );

  const value = useMemo<LanguageContextValue>(
    () => ({ locale, t: DICTIONARIES[locale], setLocale, toggleLocale }),
    [locale, setLocale, toggleLocale],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useI18n(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    throw new Error("useI18n must be used within a LanguageProvider");
  }
  return ctx;
}

"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import type { Dictionary, Locale } from "../../../site/src/i18n/dictionary";
import { en } from "../../../site/src/i18n/locales/en";
import { fr } from "../../../site/src/i18n/locales/fr";
import { DEFAULT_LOCALE, storedLocale } from "./locale.ts";

const STORAGE_KEY = "fortix-site-language";
const DICTIONARIES: Record<Locale, Dictionary> = { en, fr };

type I18nContextValue = Readonly<{
  locale: Locale;
  t: Dictionary;
  setLocale: (locale: Locale) => void;
  toggleLocale: () => void;
}>;

const I18nContext = createContext<I18nContextValue | null>(null);

/**
 * D-006 uses the canonical site dictionaries without importing its React tree.
 *
 * `initialLocale` is resolved on the server from `Accept-Language` and passed
 * down, so the first server render and the first client render agree. Nothing
 * here reads `window` during render: doing so is what produced the hydration
 * mismatch this replaced — the server had no `window`, returned English, and
 * a French browser then hydrated French over it.
 */
export function I18nProvider({
  children,
  initialLocale = DEFAULT_LOCALE,
}: {
  children: ReactNode;
  initialLocale?: Locale;
}) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);
  /** Until mount, the request header is the only preference we may act on. */
  const [choiceRestored, setChoiceRestored] = useState(false);

  // A previously stored choice is deliberate and outranks the header, but it
  // can only be read after mount. Applying it here makes it a state update
  // React expects, rather than a first-render disagreement it must repair.
  useEffect(() => {
    let stored: Locale | null = null;
    try {
      stored = storedLocale(window.localStorage.getItem(STORAGE_KEY));
    } catch {
      // Storage unavailable (private mode, blocked cookies). The header-derived
      // locale stands; language selection simply will not persist.
    }
    // Deferred rather than set synchronously in the effect body, matching the
    // pattern used elsewhere in this app: a synchronous write here cascades a
    // render. The microtask still resolves before paint, so a viewer with a
    // stored French preference does not see an English frame.
    queueMicrotask(() => {
      if (stored !== null) setLocaleState(stored);
      setChoiceRestored(true);
    });
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
    // Only persist once a stored choice has had its chance to load, so the
    // header-derived default never overwrites what the viewer chose earlier.
    if (!choiceRestored) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      // Non-fatal, as above.
    }
  }, [choiceRestored, locale]);

  const setLocale = useCallback((next: Locale) => setLocaleState(next), []);
  const toggleLocale = useCallback(() => {
    setLocaleState((current) => current === "en" ? "fr" : "en");
  }, []);
  const value = useMemo<I18nContextValue>(
    () => ({ locale, t: DICTIONARIES[locale], setLocale, toggleLocale }),
    [locale, setLocale, toggleLocale],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (context === null) throw new Error("useI18n must be used within I18nProvider");
  return context;
}

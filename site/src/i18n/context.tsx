import { createContext, useContext } from "react";
import type { Dictionary, Locale } from "./dictionary";

export interface LanguageContextValue {
  locale: Locale;
  t: Dictionary;
  setLocale: (locale: Locale) => void;
  toggleLocale: () => void;
}

export const LanguageContext = createContext<LanguageContextValue | null>(null);

export function useI18n(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useI18n must be used within a LanguageProvider");
  return ctx;
}

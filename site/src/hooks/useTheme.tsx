import { createContext, useContext, useEffect, type ReactNode } from "react";

// Scene palettes retain their independent dark/light contract.
export type Theme = "dark" | "light";

type ThemeContextValue = Readonly<{ theme: "light" }>;
const SITE_THEME: ThemeContextValue = { theme: "light" };
const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    document.documentElement.dataset.theme = "light";
    window.localStorage.setItem("fortix-site-theme", "light");
  }, []);

  return <ThemeContext.Provider value={SITE_THEME}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return ctx;
}

import { createContext, useContext } from "react";

// Scene palettes retain their independent dark/light contract.
export type Theme = "dark" | "light";
type ThemeContextValue = Readonly<{ theme: "light" }>;

export const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
  return ctx;
}

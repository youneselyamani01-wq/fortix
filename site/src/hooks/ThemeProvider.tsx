import { useEffect, type ReactNode } from "react";
import { ThemeContext } from "./useTheme";

export function ThemeProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    document.documentElement.dataset.theme = "light";
    window.localStorage.setItem("fortix-site-theme", "light");
  }, []);
  return <ThemeContext.Provider value={{ theme: "light" }}>{children}</ThemeContext.Provider>;
}

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "./styles/typography.css";

import "./styles/tokens.css";
import "./styles/global.css";
import "./styles/site-light.css";
import "./styles/editorial.css";

import { ThemeProvider } from "./hooks/ThemeProvider";
import { LanguageProvider } from "./i18n/LanguageProvider";
import { App } from "./app/App";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element #root was not found.");
}

createRoot(rootElement).render(
  <StrictMode>
    <ThemeProvider>
      <LanguageProvider>
        <App />
      </LanguageProvider>
    </ThemeProvider>
  </StrictMode>,
);

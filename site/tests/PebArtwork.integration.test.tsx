import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../src/app/App";
import { ThemeProvider } from "../src/hooks/ThemeProvider";
import { LanguageProvider } from "../src/i18n/LanguageProvider";
import { SECTION_IDS } from "../src/content/sections";

function renderApp() {
  return render(<ThemeProvider><LanguageProvider><App /></LanguageProvider></ThemeProvider>);
}

function illustrations() {
  const placements = [SECTION_IDS.hero, SECTION_IDS.independentByDesign, SECTION_IDS.proofJourney, SECTION_IDS.finalStatement].map((id) => {
    const section = document.getElementById(id)!;
    const images = section.querySelectorAll<HTMLImageElement>('[data-peb-artwork="canonical"]');
    expect(images).toHaveLength(1);
    return images[0]!;
  });
  // Query the whole site as well: a legacy image in any other section must fail.
  const allPebImages = Array.from(document.querySelectorAll<HTMLImageElement>('main img[src*="peb-"], main img[data-peb-artwork]'));
  expect(allPebImages).toEqual(placements);
  return allPebImages;
}

beforeEach(() => {
  window.localStorage.setItem("fortix-site-language", "en");
});

describe("shared PEB illustration across the homepage", () => {
  it("uses only the rounded canonical artwork across the hero, Bento, journey, and closing", () => {
    renderApp();
    const images = illustrations();

    for (const image of images) {
      expect(image).toHaveAttribute("src", "/images/peb-studio-en-v2.png");
      expect(image).toHaveAttribute("data-peb-artwork", "canonical");
      expect(image).toHaveAttribute("width", "1448");
      expect(image).toHaveAttribute("height", "1086");
      expect(image).toHaveAttribute("alt", "EVIDENCE CONTAINER : Final Receipt, Evidence records, Execution context.");
    }
    expect(images[0]).toHaveAttribute("loading", "eager");
    for (const image of images.slice(1)) expect(image).toHaveAttribute("loading", "lazy");
  });

  it("changes every placement together when the site's language changes", async () => {
    const user = userEvent.setup();
    renderApp();
    const englishImages = illustrations();

    await user.click(within(screen.getByRole("banner")).getByRole("button", { name: /language|langue/i }));

    illustrations().forEach((image, index) => {
      expect(image).not.toBe(englishImages[index]);
      expect(image).toHaveAttribute("src", "/images/peb-studio-fr-v2.png");
      expect(image).toHaveAttribute("alt", "CONTENEUR DE PREUVES : Reçu final, Éléments de preuve, Contexte d’exécution.");
    });
    expect(document.querySelector('img[src="/images/peb-studio-en-v2.png"]')).not.toBeInTheDocument();
  });
});

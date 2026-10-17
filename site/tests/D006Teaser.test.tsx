import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LanguageProvider } from "../src/i18n/context";
import { D006Teaser } from "../src/components/teaser/D006Teaser";
import { en } from "../src/i18n/locales/en";
import { fr } from "../src/i18n/locales/fr";
import { DEMO_URL } from "../src/content/links";

function showTeaser() {
  return render(<LanguageProvider><D006Teaser /></LanguageProvider>);
}

beforeEach(() => window.sessionStorage.clear());
afterEach(() => { vi.restoreAllMocks(); window.sessionStorage.clear(); });

describe("D-006 illustrative teaser", () => {
  it("shows a labeled simulated preview and a safe link to the actual mission", () => {
    showTeaser();
    expect(screen.getByRole("heading", { name: en.teaser.title })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: en.teaser.sceneDescription })).toBeInTheDocument();
    expect(screen.getByText(en.teaser.kicker)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: en.teaser.cta });
    expect(link).toHaveAttribute("href", DEMO_URL);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.queryByText(/Mission live|NanoReceipts: 07|production VALID/)).not.toBeInTheDocument();
  });

  it("pauses and resumes animation without launching a separate mission", async () => {
    const user = userEvent.setup();
    showTeaser();
    const teaser = screen.getByRole("complementary");
    expect(teaser).toHaveAttribute("data-playing", "true");
    await user.click(screen.getByRole("button", { name: en.teaser.pause }));
    expect(teaser).toHaveAttribute("data-playing", "false");
    await user.click(screen.getByRole("button", { name: en.teaser.play }));
    expect(teaser).toHaveAttribute("data-playing", "true");
  });

  it("honors reduced motion by default but permits deliberate playback", async () => {
    const standardMatchMedia = window.matchMedia;
    vi.spyOn(window, "matchMedia").mockImplementation(query => ({
      ...standardMatchMedia(query),
      matches: query === "(prefers-reduced-motion: reduce)",
    }) as MediaQueryList);
    const user = userEvent.setup();
    showTeaser();
    const teaser = screen.getByRole("complementary");
    expect(teaser).toHaveAttribute("data-playing", "false");
    await user.click(screen.getByRole("button", { name: en.teaser.play }));
    expect(teaser).toHaveAttribute("data-playing", "true");
  });

  it("remembers dismissal for this browser session", async () => {
    const user = userEvent.setup();
    const view = showTeaser();
    await user.click(screen.getByRole("button", { name: en.teaser.close }));
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    expect(window.sessionStorage.getItem("fortix-d006-teaser-dismissed")).toBe("1");
    view.unmount();
    showTeaser();
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  });

  it("provides French text when French is selected", () => {
    window.localStorage.setItem("fortix-site-language", "fr");
    showTeaser();
    expect(screen.getByRole("heading", { name: fr.teaser.title })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: fr.teaser.close })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: fr.teaser.cta })).toBeInTheDocument();
  });
});

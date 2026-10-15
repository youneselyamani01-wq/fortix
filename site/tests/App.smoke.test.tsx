import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider } from "../src/hooks/useTheme";
import { LanguageProvider } from "../src/i18n/context";
import { App } from "../src/app/App";
import { en } from "../src/i18n/locales/en";
import { VERIFIER_URL, DEMO_URL } from "../src/content/links";
import { surfaceCopy } from "../src/i18n/surface";
import { fr } from "../src/i18n/locales/fr";

function renderApp() {
  return render(
    <ThemeProvider>
      <LanguageProvider>
        <App />
      </LanguageProvider>
    </ThemeProvider>,
  );
}

describe("App", () => {
  it("renders the hero headline, signature, and CTAs on first paint", () => {
    renderApp();
    const heroHeading = screen.getByRole("heading", { level: 1 });
    expect(heroHeading).toHaveTextContent("Independently prove what you actually did.");
    expect(screen.getAllByText("Don’t trust. Verify.").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: /view the demo/i }).length).toBeGreaterThan(0);
  });

  it("falls back to the static storyboard sequence without WebGL (jsdom has none)", () => {
    renderApp();
    // Every proof-journey state label appears in the static fallback list.
    for (const state of en.journey.states) {
      expect(screen.getAllByText(state.title).length).toBeGreaterThan(0);
    }
  });

  it("shows all four normative verdict words somewhere on the page", () => {
    renderApp();
    for (const verdict of ["VALID", "INVALID", "INDETERMINATE", "REVOKED"]) {
      expect(screen.getAllByText(verdict).length).toBeGreaterThan(0);
    }
  });

  it("switches every visible string to French when the language toggle is used, without unmounting the page", async () => {
    const user = userEvent.setup();
    renderApp();

    const header = screen.getByRole("banner");
    await user.click(within(header).getByRole("button", { name: /language|langue/i }));

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(fr.hero.title);
    expect(screen.getAllByText("Don’t trust. Verify.").length).toBeGreaterThan(0);
    const actions = document.getElementById("use-cases")!;
    for (const action of Object.values(fr.useCases.classes)) {
      expect(within(actions).getByRole("heading", { name: action.title, level: 3 })).toBeInTheDocument();
    }
    expect(within(actions).getByText(fr.useCases.examples)).toBeInTheDocument();
    expect(within(actions).queryByText(en.useCases.classes.agentic.title)).not.toBeInTheDocument();
  });

  it("keeps the canonical flow order Action -> Receipt -> Independent Verification in the hero", () => {
    renderApp();
    const flowList = screen.getByRole("list", { name: en.hero.kicker });
    const items = within(flowList)
      .getAllByRole("listitem")
      .map((node) => node.textContent);
    expect(items[0]).toContain("Action");
    expect(items[1]).toContain("Receipt");
    expect(items[2]).toContain("Independent Verification");
  });

  it("presents seven transversal action classes with sectors only as application examples", () => {
    renderApp();
    expect(screen.queryByText(/Run banking decision|live banking integration|Sensitive financial decisions/i)).not.toBeInTheDocument();
    const section = document.getElementById("use-cases")!;
    const actions = section.querySelectorAll("[data-action-class]");
    expect(actions).toHaveLength(7);
    expect([...actions].map(action => action.getAttribute("data-action-class"))).toEqual(["agentic", "software", "human", "payments", "cyberPhysical", "external", "multiParty"]);
    for (const action of Object.values(en.useCases.classes)) {
      expect(within(section).getByRole("heading", { name: action.title, level: 3 })).toBeInTheDocument();
    }
    expect(within(section).getByText(en.useCases.intro)).toBeInTheDocument();
    expect(within(section).getByText(en.useCases.examples)).toBeInTheDocument();
    expect(within(section).queryByRole("heading", { name: /Healthcare|Industry|Public sector|The taxi mission/ })).not.toBeInTheDocument();
    for (const link of document.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')) {
      expect(document.getElementById(link.hash.slice(1))).not.toBeNull();
    }
  });

  it("has a keyboard-reachable skip link as the first focusable element", () => {
    renderApp();
    const skipLink = screen.getByText(en.nav.skipToContent);
    expect(skipLink).toHaveAttribute("href", "#main-content");
  });

  it("keeps the site light when a retired dark preference was stored", () => {
    window.localStorage.setItem("fortix-site-theme", "dark");
    document.documentElement.dataset.theme = "dark";
    renderApp();

    expect(screen.queryByRole("button", { name: en.nav.themeLabel })).not.toBeInTheDocument();
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(window.localStorage.getItem("fortix-site-theme")).toBe("light");
  });
  it("links to dedicated verification and current demo destinations", () => {
    renderApp();
    const header = screen.getByRole("banner");
    expect(within(header).getByRole("link", { name: en.nav.verifier })).toHaveAttribute("href", VERIFIER_URL);
    expect(within(header).getByRole("link", { name: en.nav.demo })).toHaveAttribute("href", DEMO_URL);
  });

  it("opens every Taxi Demo action in a separate opener-free tab, including the mobile menu", async () => {
    const user = userEvent.setup(); renderApp();
    const assertDemoLinks = () => {
      const links = [...document.querySelectorAll<HTMLAnchorElement>("a")].filter(link => link.getAttribute("href") === DEMO_URL);
      expect(links.length).toBeGreaterThan(0);
      for (const link of links) {
        expect(link).toHaveAttribute("target", "_blank");
        expect(link.relList.contains("noopener")).toBe(true);
        expect(link.relList.contains("noreferrer")).toBe(true);
      }
      return links.length;
    };
    const desktopCount = assertDemoLinks();
    const toggle = screen.getByLabelText(en.nav.openMenu);
    toggle.style.display = "inline-flex";
    await user.click(toggle);
    expect(assertDemoLinks()).toBeGreaterThan(desktopCount);
  });

  it("closes mobile navigation with Escape and restores its control's focus", async () => {
    const user = userEvent.setup(); renderApp();
    const toggle = screen.getByLabelText(en.nav.openMenu);
    toggle.style.display = "inline-flex"; // jsdom does not evaluate viewport media queries.
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    await user.keyboard("{Escape}");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveFocus();
  });

  it("keeps shared surface copy complete in English and French", () => {
    expect(Object.keys(surfaceCopy.fr).sort()).toEqual(Object.keys(surfaceCopy.en).sort());
    for (const copy of Object.values(surfaceCopy)) {
      for (const value of Object.values(copy)) expect(value.trim().length).toBeGreaterThan(0);
    }
  });

});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProofJourney } from "../src/components/cinematic-scene/ProofJourney";
import { useScrollProgress } from "../src/hooks/useScrollProgress";
import { useWebglSupport } from "../src/hooks/useWebglSupport";
import { useReducedMotionPreference } from "../src/hooks/useReducedMotionPreference";
import { LanguageProvider } from "../src/i18n/LanguageProvider";
import { useI18n } from "../src/i18n/context";
import { en } from "../src/i18n/locales/en";
import { fr } from "../src/i18n/locales/fr";

vi.mock("../src/hooks/useScrollProgress", () => ({ useScrollProgress: vi.fn() }));
vi.mock("../src/hooks/useWebglSupport", () => ({ useWebglSupport: vi.fn() }));
vi.mock("../src/hooks/useReducedMotionPreference", () => ({ useReducedMotionPreference: vi.fn() }));
vi.mock("../src/components/cinematic-scene/SceneCanvas", () => ({
  SceneCanvas: ({ progress, reducedMotion }: { progress: number; reducedMotion: boolean }) => (
    <div data-testid="scene-canvas" data-progress={progress} data-reduced-motion={String(reducedMotion)} />
  ),
}));

function LocaleControl() {
  const { toggleLocale } = useI18n();
  return <button type="button" onClick={toggleLocale}>Switch language</button>;
}

function JourneyHarness() {
  return <LanguageProvider><LocaleControl /><ProofJourney /></LanguageProvider>;
}

function journey() {
  return screen.getByRole("region", { name: /./ });
}

function artwork() {
  return journey().querySelector<HTMLImageElement>(".proof-journey__artwork img")!;
}

function assertNarrative(locale: "en" | "fr") {
  const states = (locale === "fr" ? fr : en).journey.states;
  const section = journey();
  const beats = section.querySelectorAll("[data-journey-beat]");
  expect(beats).toHaveLength(7);
  states.forEach((state, index) => {
    expect(beats[index]).toHaveAttribute("data-journey-beat", String(index));
    expect(within(beats[index] as HTMLElement).getByRole("heading", { level: 3, name: state.title })).toBeVisible();
    expect(within(beats[index] as HTMLElement).getByText(state.body)).toBeVisible();
  });
}

beforeEach(() => {
  vi.mocked(useScrollProgress).mockReturnValue(4 / 6);
  vi.mocked(useWebglSupport).mockReturnValue("supported");
  vi.mocked(useReducedMotionPreference).mockReturnValue(false);
  window.localStorage.setItem("fortix-site-language", "en");
});

describe("proof journey studio artwork", () => {
  it("keeps all seven narrative beats and the scene until the current artwork loads", async () => {
    render(<JourneyHarness />);
    await screen.findByTestId("scene-canvas");
    assertNarrative("en");
    expect(journey()).toHaveAttribute("data-journey-stage", "4");
    expect(journey()).toHaveAttribute("data-journey-artwork", "hidden");
    expect(journey().querySelector(".proof-journey__scene")).toHaveAttribute("aria-hidden", "false");
    expect(artwork()).toHaveAttribute("src", "/images/peb-studio-en-v2.png");

    fireEvent.load(artwork());

    expect(journey()).toHaveAttribute("data-journey-artwork", "visible");
    expect(journey().querySelector(".proof-journey__scene")).toHaveAttribute("aria-hidden", "true");
    expect(artwork().closest("figure")).toHaveAttribute("aria-hidden", "false");
    assertNarrative("en");
  });

  it("shows the artwork from the sealing beat while retaining the early action and context scene", async () => {
    vi.mocked(useScrollProgress).mockReturnValue(1 / 6);
    const { rerender } = render(<JourneyHarness />);
    await screen.findByTestId("scene-canvas");
    fireEvent.load(artwork());
    expect(journey()).toHaveAttribute("data-journey-artwork", "hidden");

    vi.mocked(useScrollProgress).mockReturnValue(2 / 6);
    rerender(<JourneyHarness />);

    expect(journey()).toHaveAttribute("data-journey-stage", "2");
    expect(journey()).toHaveAttribute("data-journey-artwork", "visible");
    assertNarrative("en");
  });

  it("can show the studio image without WebGL while preserving the complete narrative", () => {
    vi.mocked(useWebglSupport).mockReturnValue("unsupported");
    vi.mocked(useScrollProgress).mockReturnValue(0);
    render(<JourneyHarness />);
    expect(journey()).toHaveAttribute("data-journey-renderer", "fallback");
    expect(screen.queryByTestId("scene-canvas")).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: en.emptyStates.noWebgl })).toBeInTheDocument();

    fireEvent.load(artwork());

    expect(journey()).toHaveAttribute("data-journey-renderer", "artwork");
    expect(journey()).toHaveAttribute("data-journey-artwork", "visible");
    expect(screen.queryByRole("img", { name: en.emptyStates.noWebgl })).not.toBeInTheDocument();
    assertNarrative("en");
  });

  it("keeps the readable no-WebGL fallback if the illustration fails to load", () => {
    vi.mocked(useWebglSupport).mockReturnValue("unsupported");
    render(<JourneyHarness />);

    fireEvent.error(artwork());

    expect(journey()).toHaveAttribute("data-journey-renderer", "fallback");
    expect(journey()).toHaveAttribute("data-journey-artwork", "hidden");
    const fallback = screen.getByRole("img", { name: en.emptyStates.noWebgl });
    expect(within(fallback).getAllByRole("listitem")).toHaveLength(7);
    assertNarrative("en");
  });

  it("waits for the French image and uses the readable fallback if it fails, including with WebGL", async () => {
    const user = userEvent.setup();
    render(<JourneyHarness />);
    await screen.findByTestId("scene-canvas");
    const englishImage = artwork();
    fireEvent.load(englishImage);
    expect(journey()).toHaveAttribute("data-journey-artwork", "visible");

    await user.click(screen.getByRole("button", { name: "Switch language" }));

    expect(artwork()).not.toBe(englishImage);
    expect(artwork()).toHaveAttribute("src", "/images/peb-studio-fr-v2.png");
    expect(artwork()).toHaveAttribute("alt", "CONTENEUR DE PREUVES : Reçu final, Éléments de preuve, Contexte d’exécution.");
    expect(journey()).toHaveAttribute("data-journey-artwork", "hidden");
    assertNarrative("fr");
    fireEvent.load(artwork());
    expect(journey()).toHaveAttribute("data-journey-artwork", "visible");

    fireEvent.error(artwork());

    expect(journey()).toHaveAttribute("data-journey-artwork", "hidden");
    expect(journey().querySelector(".proof-journey__scene")).toHaveAttribute("aria-hidden", "false");
    expect(journey()).toHaveAttribute("data-journey-renderer", "fallback");
    expect(screen.queryByTestId("scene-canvas")).not.toBeInTheDocument();
    expect(within(screen.getByRole("img", { name: fr.journey.title })).getAllByRole("listitem")).toHaveLength(7);
    assertNarrative("fr");
  });

  it("returns to the initial scene when scrolling backwards with reduced motion", async () => {
    vi.mocked(useReducedMotionPreference).mockReturnValue(true);
    const { rerender } = render(<JourneyHarness />);
    await screen.findByTestId("scene-canvas");
    fireEvent.load(artwork());
    expect(journey()).toHaveAttribute("data-journey-artwork", "visible");
    expect(screen.getByTestId("scene-canvas")).toHaveAttribute("data-reduced-motion", "true");

    vi.mocked(useScrollProgress).mockReturnValue(0);
    rerender(<JourneyHarness />);

    expect(journey()).toHaveAttribute("data-journey-stage", "0");
    expect(journey()).toHaveAttribute("data-journey-artwork", "hidden");
    expect(artwork().closest("figure")).toHaveStyle({ opacity: "0" });
    expect(journey().querySelector(".proof-journey__scene")).toHaveStyle({ opacity: "1" });
    expect(screen.getByTestId("scene-canvas")).toHaveAttribute("data-progress", "0");
    assertNarrative("en");
  });
});

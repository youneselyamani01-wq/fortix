import * as THREE from "three";
import { describe, expect, it } from "vitest";

import journeyStyles from "../src/components/cinematic-scene/proof-journey.css?raw";
import { SCENE_PALETTE } from "../src/components/cinematic-scene/scenePalette";
import { SCENE_RENDERER_CONTRACT } from "../src/components/cinematic-scene/rendererContract";
import heroStyles from "../src/components/hero/hero.css?raw";
import proofSequenceStyles from "../src/components/proof-sequence/proof-sequence.css?raw";
import useCaseStyles from "../src/components/use-cases/use-cases.css?raw";
import { STORYBOARD } from "../src/scenes/storyboard";
import tokens from "../src/styles/tokens.css?raw";
import brandPalette from "../src/styles/brand-palette.css?raw";
import siteLightStyles from "../src/styles/site-light.css?raw";

type Rgb = readonly [number, number, number];

function channel(value: number): number {
  const normalized = value / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

function rgb(hex: string): Rgb {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

function luminanceRgb([red, green, blue]: Rgb): number {
  const redLinear = channel(red);
  const greenLinear = channel(green);
  const blueLinear = channel(blue);
  return 0.2126 * redLinear + 0.7152 * greenLinear + 0.0722 * blueLinear;
}

function luminance(hex: string): number {
  const [red, green, blue] = rgb(hex);
  const redLinear = channel(red);
  const greenLinear = channel(green);
  const blueLinear = channel(blue);
  return 0.2126 * redLinear + 0.7152 * greenLinear + 0.0722 * blueLinear;
}

function contrast(left: string, right: string): number {
  const [lighter, darker] = [luminance(left), luminance(right)].sort((a, b) => b - a);
  return (lighter! + 0.05) / (darker! + 0.05);
}

function composite(foreground: string, background: string | Rgb, alpha: number): Rgb {
  const foregroundRgb = rgb(foreground);
  const backgroundRgb = typeof background === "string" ? rgb(background) : background;
  return foregroundRgb.map((value, index) => value * alpha + backgroundRgb[index]! * (1 - alpha)) as unknown as Rgb;
}

function contrastRgb(left: Rgb, right: Rgb): number {
  const [lighter, darker] = [luminanceRgb(left), luminanceRgb(right)].sort((a, b) => b - a);
  return (lighter! + 0.05) / (darker! + 0.05);
}

function token(block: string, name: string): string {
  const value = block.match(new RegExp(`${name}:\\s*(#[0-9a-f]{6}|var\\(--brand-[a-z-]+\\))`, "i"))?.[1];
  if (value === undefined) throw new Error(`Missing ${name}`);
  if (value.startsWith("var(")) return token(brandPalette, value.slice(4, -1));
  return value;
}

const darkTokens = tokens.match(/^:root\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
const lightTokens = tokens.match(/:root\[data-theme="light"\]\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";

describe("theme-aware cinematic evidence", () => {
  it("keeps the structural shell visible in dark and light scenes", () => {
    expect(contrast(SCENE_PALETTE.dark.shell, "#07090d")).toBeGreaterThanOrEqual(3);
    expect(contrast(SCENE_PALETTE.light.shell, "#f6f4ef")).toBeGreaterThanOrEqual(3);
    expect(SCENE_PALETTE.dark.shell).not.toBe(SCENE_PALETTE.light.shell);

    const contextOpacity = STORYBOARD.find(({ name }) => name === "context")?.originShellOpacity;
    expect(contextOpacity).toBe(0.55);
    expect(contrastRgb(composite(SCENE_PALETTE.dark.shell, "#07090d", contextOpacity!), rgb("#07090d"))).toBeGreaterThanOrEqual(3);
    expect(contrastRgb(composite(SCENE_PALETTE.light.shell, "#f6f4ef", contextOpacity!), rgb("#f6f4ef"))).toBeGreaterThanOrEqual(3);
    const lightSpatialBackground = composite(token(lightTokens, "--experience-violet"), token(lightTokens, "--canvas-raised"), 0.09);
    expect(contrastRgb(
      composite(SCENE_PALETTE.light.shell, lightSpatialBackground, contextOpacity!),
      lightSpatialBackground,
    )).toBeGreaterThanOrEqual(3.4);
  });

  it("uses the canonical verdict palette and never the retired pistachio", () => {
    expect(SCENE_PALETTE.dark.verdict).toMatchObject({
      VALID: "#4fd39a",
      INVALID: "#ff7a8f",
      INDETERMINATE: "#f2bd62",
      REVOKED: "#f2bd62",
    });
    expect(SCENE_PALETTE.light.verdict).toMatchObject({
      VALID: "#1f7a52",
      INVALID: "#b0273f",
      INDETERMINATE: "#8a5a10",
      REVOKED: "#8a5a10",
    });
    expect(JSON.stringify(SCENE_PALETTE).toLowerCase()).not.toContain("#b8f238");
  });

  it("pins output color and keeps vivid unlit geometry outside tone mapping", () => {
    expect(SCENE_RENDERER_CONTRACT.outputColorSpace).toBe(THREE.SRGBColorSpace);
    expect(SCENE_RENDERER_CONTRACT.toneMapping).toBe(THREE.NoToneMapping);
    expect(SCENE_RENDERER_CONTRACT.toneMappingExposure).toBe(1);
    expect(SCENE_RENDERER_CONTRACT.structuralToneMapped).toBe(false);
  });

  it("keeps experience color separate from semantic verdict color", () => {
    const experienceColors = [
      SCENE_PALETTE.dark.shell,
      SCENE_PALETTE.dark.node,
      SCENE_PALETTE.dark.origin,
      SCENE_PALETTE.dark.accent,
      SCENE_PALETTE.dark.secondaryLight,
      SCENE_PALETTE.dark.slab,
      SCENE_PALETTE.light.shell,
      SCENE_PALETTE.light.node,
      SCENE_PALETTE.light.origin,
      SCENE_PALETTE.light.accent,
      SCENE_PALETTE.light.secondaryLight,
      SCENE_PALETTE.light.slab,
    ];
    const verdictColors = Object.values(SCENE_PALETTE.dark.verdict)
      .concat(Object.values(SCENE_PALETTE.light.verdict));
    for (const color of experienceColors) expect(verdictColors).not.toContain(color);
    expect(contrast(SCENE_PALETTE.dark.accent, "#07090d")).toBeGreaterThanOrEqual(3);
    expect(contrast(SCENE_PALETTE.dark.slab, "#07090d")).toBeGreaterThanOrEqual(3);
    expect(contrast(SCENE_PALETTE.light.accent, "#f6f4ef")).toBeGreaterThanOrEqual(3);
    expect(contrast(SCENE_PALETTE.light.slab, "#f6f4ef")).toBeGreaterThanOrEqual(3);
  });

  it("keeps editorial color separate from verdict semantics with readable hero text", () => {
    expect(tokens).toContain("Experience / spatial accents");
    expect(tokens).toMatch(/--experience-violet:\s*#[0-9a-f]{6}/i);
    expect(tokens).toMatch(/--experience-cyan:\s*#[0-9a-f]{6}/i);
    expect(tokens).toMatch(/--experience-coral-soft:\s*rgba\(/i);
    expect(token(lightTokens, "--surface")).not.toMatch(/^#fff(?:fff)?$/i);
    expect(heroStyles).not.toMatch(/--(?:valid|invalid|warning)[\w-]*\s*:/);
    const siteGround = token(siteLightStyles, "--site-bg-primary");
    expect(siteGround).toMatch(/^#[0-9a-f]{6}$/i);
    for (const color of ["--site-text-primary", "--site-text-secondary", "--site-accent"]) {
      expect(contrast(token(siteLightStyles, color), siteGround)).toBeGreaterThanOrEqual(4.5);
    }
    expect(siteLightStyles).toMatch(/\.fortix-site\s*\{/);
    expect(siteLightStyles).not.toMatch(/--(?:valid|invalid|warning)[\w-]*\s*:/);
    expect(heroStyles).not.toMatch(/background:\s*var\(--brand-(?:plum|blue)\)/);
    expect(journeyStyles).toMatch(/var\(--atmosphere-(?:aqua|mist|butter|lavender)(?:,|\))/);
    expect(useCaseStyles).toContain("var(--site-accent)");
    expect(useCaseStyles).toContain("var(--site-text-primary)");
    expect(useCaseStyles).not.toMatch(/var\(--(?:valid|invalid|warning)[\w-]*\)|--(?:valid|invalid|warning)[\w-]*\s*:/);
    expect(tokens).not.toMatch(/--valid:\s*var\(--experience-/);
    expect(tokens).not.toMatch(/--invalid:\s*var\(--experience-/);
    expect(tokens).not.toMatch(/--warning:\s*var\(--experience-/);
  });

  it("keeps text contrast and active sequence hierarchy independent from opacity", () => {
    for (const block of [darkTokens, lightTokens]) {
      const surface = token(block, "--surface");
      expect(contrast(token(block, "--ink-soft"), surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(token(block, "--muted"), surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(token(block, "--accent-ink"), token(block, "--accent"))).toBeGreaterThanOrEqual(4.5);
      for (const verdict of ["--valid", "--invalid", "--warning"]) {
        expect(contrast(token(block, verdict), surface)).toBeGreaterThanOrEqual(4.5);
      }
    }
    expect(proofSequenceStyles).not.toMatch(/\.proof-sequence__step\s*\{[^}]*opacity:\s*0\.5/);
    expect(proofSequenceStyles).toMatch(/\.proof-sequence__step\.is-active\s*\{[^}]*border-left-color:[^}]*font-weight:[^}]*translateX/);
  });
});

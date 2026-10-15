/// <reference types="node" />
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(process.cwd(), "..");
const textExtensions = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".html", ".css", ".scss", ".svg", ".json", ".webmanifest",
]);
const bannedName = /shield|security[-_]?shield|badge[-_]?shield/i;
const bannedReference = /\b(?:shield(?:check|alert|checkered|close|half|minus|off|plus|question|x)?|security[-_]shield|badge[-_]shield)\b/i;
// Geometry is checked as well as names: the former assets were simply named
// favicon.svg and og-image.svg, so a keyword-only test would have missed them.
const bannedPaths = [
  "M9 9h14v9.2a3.4 3.4 0 0 1-1 2.4l-5 5-5-5a3.4 3.4 0 0 1-1-2.4V9z",
  "M0 0h72v46.6a17.2 17.2 0 0 1-5 12.1L36 90 5 58.7A17.2 17.2 0 0 1 0 46.6V0z",
].map((path) => path.replace(/[\s,]/g, "").toLowerCase());

function isBannedIdentity(path: string, source: string): boolean {
  const geometry = source.replace(/[\s,]/g, "").toLowerCase();
  return bannedName.test(path) || bannedReference.test(source)
    || bannedPaths.some((signature) => geometry.includes(signature));
}

function filesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return filesUnder(path);
    return entry.isFile() ? [path] : [];
  });
}

describe("public identity asset guard", () => {
  it("rejects banned names and renamed copies of both former shield geometries", () => {
    expect(isBannedIdentity("public/shield-check.svg", "")).toBe(true);
    expect(isBannedIdentity("navigation.tsx", "import { ShieldCheck } from 'lucide-react';")).toBe(true);
    for (const path of bannedPaths) {
      expect(isBannedIdentity("public/innocent-name.svg", `<path d="${path}"/>`)).toBe(true);
    }
    expect(isBannedIdentity("brand.tsx", "<strong>FortiX</strong>")).toBe(false);
  });

  it("keeps banned identity out of active Site, Demo and Verifier source and assets", () => {
    // Explicit surface roots exclude historical evidence, tests, dependencies,
    // build output and the two protected pre-existing untracked directories.
    const surfaceFiles = [
      "site/src", "site/public",
      "demo/fortix-causal-editing-table/app", "demo/fortix-causal-editing-table/public",
    ].flatMap((path) => filesUnder(join(repoRoot, path)));
    surfaceFiles.push(join(repoRoot, "site/index.html"));
    const violations = surfaceFiles.filter((path) => {
      const source = textExtensions.has(extname(path).toLowerCase()) ? readFileSync(path, "utf8") : "";
      return isBannedIdentity(relative(repoRoot, path), source);
    });
    expect(violations.map((path) => relative(repoRoot, path))).toEqual([]);
  });

  it("removes former shield assets and disables the browser fallback without inventing a mark", () => {
    expect(existsSync(join(repoRoot, "site/public/favicon.svg"))).toBe(false);
    expect(existsSync(join(repoRoot, "site/public/social/og-image.svg"))).toBe(false);
    const html = readFileSync(join(repoRoot, "site/index.html"), "utf8");
    const document = new DOMParser().parseFromString(html, "text/html");
    expect(document.querySelector('link[rel="icon"]')?.getAttribute("href")).toBe("data:,");
    expect(document.querySelector('link[rel="apple-touch-icon"]')).toBeNull();
    expect(document.querySelector('meta[property="og:image"], meta[name="twitter:image"]')).toBeNull();
    expect(html).not.toContain("/favicon.svg");
    expect(html).not.toContain("/social/og-image.svg");
    const manifest = JSON.parse(readFileSync(join(repoRoot, "site/public/site.webmanifest"), "utf8"));
    expect(manifest.icons).toEqual([]);
  });
});

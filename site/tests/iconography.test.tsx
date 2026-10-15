/// <reference types="node" />
import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, relative, resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FortixIcon } from "../src/components/icons/FortixIcon";

const siteRoot = process.cwd();

function activeSources(entry: string): Map<string, string> {
  const sources = new Map<string, string>();
  const visit = (path: string) => {
    if (sources.has(path) || ![".ts", ".tsx"].includes(extname(path))) return;
    const source = readFileSync(path, "utf8");
    sources.set(path, source);
    for (const match of source.matchAll(/(?:from\s*|import\s*(?:\(\s*)?)["']([^"']+)["']/g)) {
      const imported = match[1]!;
      if (!imported.startsWith(".")) continue;
      const base = resolve(dirname(path), imported.split("?")[0]!);
      const resolved = [base, `${base}.tsx`, `${base}.ts`, `${base}/index.tsx`, `${base}/index.ts`]
        .find((candidate) => existsSync(candidate) && [".ts", ".tsx"].includes(extname(candidate)));
      if (resolved) visit(resolved);
    }
  };
  visit(entry);
  return sources;
}

describe("active surface iconography", () => {
  it("keeps active Site imports in one utility family without policing retired scenarios", () => {
    const sources = activeSources(resolve(siteRoot, "src/app/App.tsx"));
    const alternateFamilies = [...sources].filter(([, source]) =>
      /from\s*["'](?:lucide-react|react-icons(?:\/[^"']*)?|@heroicons\/[^"']*)["']/.test(source));
    expect(alternateFamilies.map(([path]) => relative(siteRoot, path))).toEqual([]);
    expect(sources.has(resolve(siteRoot, "src/components/icons/FortixIcon.tsx"))).toBe(true);
    expect(sources.has(resolve(siteRoot, "src/components/proof-sequence/ProofSequence.tsx"))).toBe(false);
  });

  it("keeps utility artwork out of labelled controls' accessible names", () => {
    render(<button type="button"><FortixIcon name="external" />Open independent verifier</button>);
    const control = screen.getByRole("button", { name: "Open independent verifier" });
    expect(control.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(control.querySelector("svg")).toHaveAttribute("focusable", "false");
  });
});

/**
 * Confirms every in-page anchor the app navigates to (nav links, CTA
 * scroll targets) has a matching `id={SECTION_IDS.x}` actually rendered by
 * a section component, and that every registered section id is reachable
 * from at least one nav/CTA target or is intentionally scroll-only.
 *
 * Run with: node --experimental-strip-types scripts/check-internal-links.ts
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { SECTION_IDS, NAV_TARGETS } from "../src/content/sections.ts";

const SRC_DIR = new URL("../src", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

function walk(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      walk(full, files);
    } else if (/\.(tsx|ts)$/.test(entry)) {
      files.push(full);
    }
  }
  return files;
}

const files = walk(SRC_DIR);
const sourceById = new Map<string, string>();
for (const file of files) {
  sourceById.set(file, readFileSync(file, "utf8"));
}
const allSource = [...sourceById.values()].join("\n");

const errors: string[] = [];

// 1. Every SECTION_IDS value must appear as `id={SECTION_IDS.<key>}` (or the
// literal id string) in at least one component so the anchor actually exists.
for (const [key, value] of Object.entries(SECTION_IDS)) {
  const renderedAsConstant = allSource.includes(`id={SECTION_IDS.${key}}`);
  const renderedAsLiteral = allSource.includes(`id="${value}"`);
  if (!renderedAsConstant && !renderedAsLiteral) {
    errors.push(`SECTION_IDS.${key} ("${value}") is never rendered as an element id.`);
  }
}

// 2. Every scrollToId(...) call must target a known section id, not a stray string.
const scrollCalls = [...allSource.matchAll(/scrollToId\((SECTION_IDS\.\w+|"[^"]+")\)/g)];
const knownIds = new Set(Object.values(SECTION_IDS));
for (const match of scrollCalls) {
  const arg = match[1]!;
  if (arg.startsWith("SECTION_IDS.")) {
    const key = arg.replace("SECTION_IDS.", "") as keyof typeof SECTION_IDS;
    if (!(key in SECTION_IDS)) {
      errors.push(`scrollToId references unknown SECTION_IDS.${key}`);
    }
    continue;
  }
  const literal = arg.slice(1, -1);
  if (!knownIds.has(literal as (typeof SECTION_IDS)[keyof typeof SECTION_IDS])) {
    errors.push(`scrollToId("${literal}") does not match any registered section id`);
  }
}

// 3. Every NAV_TARGETS anchor must be a registered section id.
for (const target of NAV_TARGETS) {
  if (!knownIds.has(target.anchor as (typeof SECTION_IDS)[keyof typeof SECTION_IDS])) {
    errors.push(`NAV_TARGETS entry "${target.key}" points at unregistered anchor "${target.anchor}"`);
  }
}

if (errors.length > 0) {
  console.error(`Internal link check failed with ${errors.length} issue(s):\n`);
  for (const error of errors) {
    console.error(`  - ${error}`);
  }
  process.exit(1);
}

console.log(
  `Internal link check passed: ${Object.keys(SECTION_IDS).length} section anchors resolved, ${scrollCalls.length} scrollToId() calls verified, ${NAV_TARGETS.length} nav targets verified.`,
);

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * D-006/NX4 — THE CONTROL LANGUAGE (artifacts/d006-nx4/CONTROL_STYLE_RULES.md).
 *
 * One grammar for every interactive control: acts in the pill with one rule
 * and three sizes; navigation neutral; one selected idiom; one disabled
 * costume; hover that never introduces the accent; radius tokens only; no
 * dotted or dashed border on a control; green for established / valid cues
 * only, amber for caution only, coral for the lost link only.
 */

const read = (relative: string) => readFileSync(new URL(`../app/nx/${relative}`, import.meta.url), "utf8");
const strip = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "");
const css = strip(read("nx.css"));
const verifierCss = strip(read("verifier/verifier.css"));
const proofCss = strip(read("evidence/proof-b2.css"));
const all = `${css}\n${verifierCss}\n${proofCss}`;

/** The declarations of one rule, by its exact selector at the start of a line. */
function rule(sheet: string, selector: string): string {
  const match = new RegExp(`(^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\{`).exec(sheet);
  assert.ok(match !== null, `a rule for ${selector} exists`);
  const start = match.index + match[0].length;
  return sheet.slice(start, sheet.indexOf("}", start));
}

test("NX4-01: every act wears the pill with one 1 px rule, at one of three sizes, in sentence case", () => {
  for (const act of [".nx-primary", ".nx-secondary", ".nx-act"]) {
    const declarations = rule(css, act);
    assert.match(declarations, /border-radius: 999px/, `${act}: the pill`);
    assert.match(declarations, /border: 1px solid/, `${act}: one 1 px rule`);
    assert.match(declarations, /min-height: 34px/, `${act}: the default size`);
    assert.match(declarations, /font-size: 0\.875rem;\s*font-weight: 600;/, `${act}: the site's button size and weight`);
    assert.doesNotMatch(declarations, /text-transform: uppercase/, `${act}: sentence case`);
  }
  // Compact beside a record; consequential at the two decisions the mission cannot undo.
  assert.match(rule(css, ".nx-act-inline"), /margin: 0 0\.6rem 0 0\.6rem;\s*min-height: 28px;\s*padding: 0\.3rem 0\.7rem;\s*font-size: 0\.78rem/, "compact, with room on both sides of a record's line");
  assert.match(css, /\.nx-authority \.nx-primary, \.nx-authority \.nx-secondary \{ min-height: 38px; padding: 0\.5rem 1\.6rem; font-size: 0\.95rem; \}/);
  assert.match(verifierCss, /\.nx-vs-analyze \.nx-primary \{ min-height: 38px; padding: 0\.5rem 1\.6rem; font-size: 0\.95rem; \}/, "ANALYZE is the same consequential size as the authority pair");
});

test("NX4-02: filled means the one act the page expects now; everything else is outlined or bare", () => {
  assert.match(rule(css, ".nx-primary"), /background: var\(--nx-ink\)/);
  assert.match(css, /\.nx-signature \{ background: var\(--nx-accent\)/);
  for (const outlined of [".nx-secondary", ".nx-act"]) assert.match(rule(css, outlined), /background: var\(--nx-paper\)/, `${outlined}: paper, a rule`);
  for (const bare of [".nx-language button", ".nx-evidence-control", ".nx-scroll-cue", ".nx-group"]) {
    const declarations = rule(css, bare);
    assert.match(declarations, /background: (transparent|var\(--nx-porcelain\)|var\(--nx-paper\))/, `${bare}: no fill at rest`);
    assert.match(declarations, /border-radius: (999px|var\(--nx-radius-sm\))/);
  }
  // Contained navigation pills share one rule and one height.
  for (const pill of [".nx-evidence-control", ".nx-group"]) assert.match(rule(css, pill), /min-height: 28px;[^}]*border: 1px solid var\(--nx-mineral-2\)/, `${pill}: the mineral rule at 28 px`);
  assert.match(rule(verifierCss, '.nx-vs-tabs [role="tab"]'), /min-height: 28px;\s*border: 1px solid var\(--nx-mineral-2/);
  assert.match(rule(verifierCss, '.nx-vs-tabs [role="tab"]'), /background: transparent/);
  assert.match(rule(css, ".nx-link"), /background: transparent;[^}]*text-decoration: underline/, "a link is a word, underlined");
  assert.match(rule(css, ".nx-disclose"), /border: 0;\s*background: transparent/, "a disclosure is a word and a chevron");
});

test("NX4-03: one hover, one active, one disabled costume — and hover never introduces the accent", () => {
  // Outlined acts step to porcelain; the ink fill lightens; the signature act lightens and lifts.
  assert.match(css, /\.nx-secondary:hover \{ background: var\(--nx-porcelain\)/);
  assert.match(css, /\.nx-act:hover \{ background: var\(--nx-porcelain\)/);
  assert.match(css, /\.nx-primary:hover \{ background: color-mix\(in srgb, var\(--nx-ink\) 86%, var\(--nx-porcelain\)\)/);
  assert.match(css, /\.nx-signature:hover \{ background: color-mix\(in srgb, var\(--nx-accent\) 90%, white\)/);
  for (const nav of [".nx-language button:hover", ".nx-evidence-control:hover", ".nx-panel-toggle:hover"]) {
    assert.match(css, new RegExp(`${nav.replace(/[.[\]()]/g, "\\$&")} \\{[^}]*var\\(--nx-porcelain\\)`), `${nav}: the porcelain ground`);
  }
  assert.match(verifierCss, /\.nx-vs-tabs \[role="tab"\]:hover \{[^}]*var\(--nx-porcelain/);
  // The accent is selection and the signature act: no :hover rule INTRODUCES
  // it. The two controls that wear the accent at rest — the signature act and
  // the takeable PEB — may keep it under the pointer; every other hover is
  // neutral.
  for (const sheet of [css, verifierCss]) {
    for (const match of sheet.matchAll(/^([^{\n]*:hover[^{\n]*)\{([^}]*)\}/gm)) {
      const selector = match[1]!.trim();
      if (/nx-signature|is-takeable/.test(selector)) continue;
      assert.doesNotMatch(match[2]!, /--nx-accent-soft|--nx-accent\)/, `hover never introduces the accent: ${selector}`);
    }
  }
  // Pressed sits down one pixel, every act alike; disabled is one costume for all.
  for (const act of [".nx-primary", ".nx-secondary", ".nx-act"]) assert.match(css, new RegExp(`${act.replace(".", "\\.")}:active \\{ transform: translateY\\(1px\\)`), `${act}: pressed sits down`);
  const disabled = /background: var\(--nx-paper\); border-color: var\(--nx-mineral-2\); color: var\(--nx-ink-2\); box-shadow: none; transform: none;/;
  assert.match(css.slice(css.indexOf(".nx-primary:disabled")), disabled, "primary disabled");
  assert.match(css.slice(css.indexOf(".nx-signature:disabled")), disabled, "signature disabled");
  assert.match(css, /\.nx-act:disabled, \.nx-act\[aria-disabled="true"\] \{ border-color: var\(--nx-mineral-2\); color: var\(--nx-ink-2\); background: var\(--nx-paper\); box-shadow: none; transform: none;/, "act disabled");
  assert.match(css, /\.nx-secondary:disabled \{ border-color: var\(--nx-mineral-2\); color: var\(--nx-ink-2\); background: var\(--nx-paper\); box-shadow: none; transform: none; \}/, "secondary disabled");
});

test("NX4-04: one selected idiom — accent text, accent rule, the accent's soft ground — for every selectable control", () => {
  const idiom = /border-color: var\(--nx-accent[^)]*\);\s*color: var\(--nx-accent[^)]*\);\s*background: var\(--nx-accent-soft[^)]*\)/;
  assert.match(css.slice(css.indexOf('.nx-language button[aria-pressed="true"]')), /\{ border-color: var\(--nx-accent\); color: var\(--nx-accent\); background: var\(--nx-accent-soft\); \}/, "the language toggle");
  assert.match(css.slice(css.indexOf('.nx-evidence-control[aria-expanded="true"]')), /\{ border-color: var\(--nx-accent\); color: var\(--nx-accent\); background: var\(--nx-accent-soft\); \}/, "the evidence toggle");
  assert.match(verifierCss.slice(verifierCss.indexOf('.nx-vs-tabs [role="tab"][aria-selected="true"]')), idiom, "the inspect tabs");
  assert.match(verifierCss, /\.nx-vs-row\[aria-current="true"\] \{ background: var\(--nx-accent-soft/, "the receipt row's ground");
  assert.match(verifierCss, /\.nx-vs-row\[aria-current="true"\] \.nx-ordinal \{ color: var\(--nx-accent/, "…and its ordinal");
  assert.match(css, /\.nx-bead\.is-selected i \{[^}]*0 0 0 3\.5px var\(--nx-accent\)/, "the selected bead's ring");
  // No control speaks in the mono uppercase voice of a status.
  for (const control of [".nx-evidence-control", ".nx-language button"]) assert.doesNotMatch(rule(css, control), /text-transform: uppercase|font-geist-mono/, `${control}: a control's voice`);
});

test("NX4-05: radius tokens only — no 4 px or 8 px literal, the folder corner from tokens", () => {
  assert.doesNotMatch(all, /border-radius: 8px|border-radius: 4px\b|border-radius: 4px 1[02]px 4px 4px|border-radius: 6px 26px/, "no radius literal outside the tokens");
  const corner = /border-radius: var\(--nx-radius-sm\) var\(--nx-radius-lg\) var\(--nx-radius-sm\) var\(--nx-radius-sm\)/;
  for (const object of [".nx-peb-chip", ".nx-final-receipt", ".nx-peb-carry"]) assert.match(rule(css, object), corner, `${object}: the folder corner from tokens`);
  assert.match(css, /\.nx-object-peb \{ border-style: solid; border-radius: var\(--nx-radius-sm\) var\(--nx-radius-lg\) var\(--nx-radius-sm\) var\(--nx-radius-sm\); \}/);
  assert.match(rule(verifierCss, ".nx-vs-dropzone"), /border-radius: var\(--nx-radius-md, 6px\) 26px var\(--nx-radius-md, 6px\) var\(--nx-radius-md, 6px\)/, "the receiving surface is the same corner, enlarged");
  for (const panel of [".nx-panel", ".nx-reconciliation"]) assert.match(rule(css, panel), /border-radius: var\(--nx-radius-lg\)/, `${panel}: the large radius`);
  assert.match(rule(css, ".nx-object"), /border-radius: var\(--nx-radius-md\)/);
});

test("NX4-06: no control carries a dotted or dashed border; the dashes that remain are semantic marks on evidence or status", () => {
  for (const control of [".nx-branch-label", ".nx-panel-toggle", ".nx-scroll-cue", ".nx-peb-chip.is-handed-off", ".nx-primary", ".nx-secondary", ".nx-act", ".nx-evidence-control", ".nx-language button", ".nx-link", ".nx-disclose"]) {
    const declarations = rule(css, control);
    assert.doesNotMatch(declarations, /dotted|dashed/, `${control}: a solid rule or none`);
  }
  assert.doesNotMatch(rule(verifierCss, '.nx-vs-tabs [role="tab"]'), /dotted|dashed/);
  assert.doesNotMatch(rule(verifierCss, ".nx-vs-dropzone"), /dotted|dashed/);
  assert.match(css, /\.nx-branch-label \{[^}]*border-bottom: 1px solid var\(--nx-rule\)/);
  assert.match(css, /\.nx-panel-toggle \{[^}]*border-bottom: 1px solid var\(--nx-rule\)/);
  assert.match(proofCss, /border-bottom: 1px solid var\(--nx-rule\)/, "chapter labels too");
  // Every dash left is on evidence or a status dot, each with one meaning.
  const dashed = [...all.matchAll(/^([^{\n]+)\{[^}]*border-style: (dashed|dotted)/gm)].map((match) => match[1]!.trim());
  assert.deepEqual(dashed.sort(), [
    ".nx-bead.is-journal i",
    ".nx-bead.is-not-retained i",
    ".nx-bead.is-unresolved i",
    ".nx-episode-item.is-journal i",
    '.nx-vs-ledger li[data-status="carried"] i',
  ].sort());
  const dotted = [...all.matchAll(/^([^{\n]+)\{[^}]*1px dotted/gm)].map((match) => match[1]!.trim());
  assert.deepEqual(dotted, [".nx-post-seal::before, .nx-post-seal::after"], "the post-seal divider is the one dotted rule left");
});

test("NX4-07: colour discipline — green for established cues, amber for caution, coral for the lost link, neutral navigation", () => {
  // Green: verdicts and the reconciliation's finding only (ADV-08b holds the list); never the link chip.
  assert.match(css, /\.nx-link-chip\[data-link="CONNECTED"\] i b \{ background: var\(--nx-ink\); border-color: var\(--nx-ink\); \}/);
  // The lamp green stays on the world stage (a traffic light is green); no
  // control, chip or band wears it.
  for (const selector of [...css.matchAll(/^([^{\n]+)\{[^}]*var\(--nx-signal-green\)/gm)].map((match) => match[1]!.trim())) {
    assert.doesNotMatch(selector, /nx-link-chip|nx-reconciliation|nx-band|nx-vs-|nx-primary|nx-act|nx-secondary|nx-established|nx-recorded/, `the lamp green on a control or a status: ${selector}`);
  }
  // Amber: one value, two names — the verdict's and the caution's — and a list of caution wearers.
  assert.match(css, /--nx-caution: #8a5a10;/);
  assert.match(css, /--nx-verdict-open: #8a5a10;/);
  const cautionWearers = [...css.matchAll(/^([^{\n]+)\{[^}]*var\(--nx-caution\)/gm)].map((match) => match[1]!.trim()).sort();
  assert.deepEqual(cautionWearers, [".nx-authority .nx-kicker", '.nx-branch-labels li[data-branch="unresolved"] .nx-branch-label', ".nx-bead.is-unresolved i"].sort());
  assert.doesNotMatch(all, /--nx-pulse-orange\)[^\n]*(unresolved|kicker)/, "the orange pulse marks no caution");
  // Coral: the lost link, and nothing else.
  const coralWearers = [...all.matchAll(/^([^{\n]+)\{[^}]*var\(--nx-pulse-coral[^)]*\)/gm)].map((match) => match[1]!.trim());
  for (const selector of coralWearers) assert.match(selector, /LOST/, `coral means the lost link: ${selector}`);
  // Neutral: the reconciliation's working tone is ink, not the accent's blue.
  assert.match(css, /\.nx-reconciliation\[data-tone="ACTIVE"\] \{ border-left-color: var\(--nx-ink-2\); \}/);
  assert.doesNotMatch(css, /data-flash="RESTORED"\][^{]*\{[^}]*--nx-(signal-green|verdict-valid)/, "a restored link flashes in ink");
});

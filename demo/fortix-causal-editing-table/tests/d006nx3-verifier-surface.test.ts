import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { en } from "../../../site/src/i18n/locales/en.ts";
import { fr } from "../../../site/src/i18n/locales/fr.ts";
import { CHECK_CATEGORY, categoriesOf } from "../app/nx/verifier/choreography.ts";
import { INSPECT_SECTIONS, inspectSectionFrom } from "../app/nx/verifier/inspectSections.ts";

/**
 * D-006/NX3 — THE INDEPENDENT VERIFIER SURFACE (mandate §13–§20, §23–§27;
 * tests 13–15 and 20–23).
 *
 * What a person sees in the verifier is read from the verifier's own result
 * and from nothing else: the four canonical words, the verdict before its
 * explanation, only the checks that were performed. The instrument is a
 * dedicated dialog over the mission, never the lower half of a workspace;
 * its receiving surface says DROP THE PEB HERE and, after the drop, PEB
 * RECEIVED; ANALYZE and INSPECT are the two signature acts; INSPECT opens the
 * six sections in their order, with the Gate 2 drawings and their limits.
 *
 * The assertions read the sources and the dictionaries, so a regression in
 * either fails here before it reaches a render.
 */

const source = (relative: string) => readFileSync(new URL(`../app/${relative}`, import.meta.url), "utf8");
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const surface = source("nx/verifier/VerifierSurface.tsx");
const surfaceCode = code(surface);
const inspect = code(source("nx/verifier/InspectPanel.tsx"));
const experience = code(source("nx/experience/NxExperience.tsx"));
const css = source("nx/nx.css");
const verification = code(source("verification.ts"));

const CANONICAL = ["VALID", "INVALID", "INDETERMINATE", "REVOKED"] as const;

test("NX3-T13: the verifier speaks only the four canonical words, and the surface never writes one of its own", () => {
  assert.match(verification, /export type CanonicalVerdict = "VALID" \| "INVALID" \| "INDETERMINATE" \| "REVOKED";/, "the canonical set is exactly four words");
  // The surface reads the word from the result and never spells one itself.
  assert.match(surfaceCode, /data-verdict=\{verdict \?\? ""\}/, "the root's verdict attribute is the verifier's word");
  assert.match(surfaceCode, /<code>\{verification\.verdict\}<\/code>/, "the printed word is the verifier's word");
  assert.doesNotMatch(surfaceCode, /"(VALID|INVALID|INDETERMINATE|REVOKED)"/, "no verdict literal exists in the surface");
  assert.doesNotMatch(inspect, /"(VALID|INVALID|INDETERMINATE|REVOKED)"/, "…nor in the inspection");
  // The dictionaries phrase each canonical word and nothing beyond the set.
  for (const [locale, copy] of [["en", en], ["fr", fr]] as const) {
    assert.deepEqual(Object.keys(copy.d006c2.verifier.verdicts).sort(), [...CANONICAL].sort(), `${locale}: headlines for exactly the canonical set`);
    for (const word of CANONICAL) {
      const entry = copy.d006c2.verifier.verdicts[word];
      assert.ok(entry.headline.length > 0 && entry.reading.length > 0, `${locale}: ${word} has a headline and a reading`);
      assert.doesNotMatch(entry.headline, /\b(VALID|INVALID|INDETERMINATE|REVOKED)\b/, `${locale}: the headline explains, it does not restate the word`);
    }
  }
});

test("NX3-T14: verdict first, explanation second — in the ledger and in the verdict record", () => {
  // The word, its headline and its reading; then the INSPECT act, with the
  // verdict where a person can reach it without scrolling past thirty lines
  // of explanation; then what was established, the facts and the limits.
  const record = surfaceCode.slice(surfaceCode.indexOf('className="nx-vs-verdict"'));
  const markers = ["nx-vs-verdict-word", "copy.verdicts[verdict].headline", "nx-vs-verdict-reading", "nx-vs-inspect-act", "nx-established", "nx-inspections", "nx-limits"];
  const names = ["word", "headline", "reading", "inspect", "established", "inspections", "limits"];
  const order = markers.map((marker) => record.indexOf(marker));
  for (let i = 1; i < order.length; i += 1) assert.ok(order[i]! > order[i - 1]!, `document order: ${names[i]} after ${names[i - 1]}`);
  // The ledger: PEB, analysis, verdict — the verdict line carries the word and nothing else.
  const ledger = surfaceCode.slice(surfaceCode.indexOf('className="nx-vs-ledger"'), surfaceCode.indexOf("</ol>", surfaceCode.indexOf('className="nx-vs-ledger"')));
  assert.deepEqual([...ledger.matchAll(/data-station="(\w+)"/g)].map((m) => m[1]), ["peb", "analysis", "verdict"]);
  assert.match(ledger, /\{copy\.verdict\} · <code>\{verification\.verdict\}<\/code>/);
});

test("NX3-T15: only checks the verifier actually completed are shown, grouped by a table whose every id is a real check", () => {
  // Every mapped id is spelled in the verifier's own sources.
  const verifierSources = ["offlineVerification.ts", "masterStory.ts"].map((file) => source(file)).join("\n");
  for (const id of Object.keys(CHECK_CATEGORY)) assert.ok(verifierSources.includes(`"${id}"`), `${id} is a check the verifier performs`);
  // The grouping never invents: its output is exactly its input, partitioned.
  const performed = ["bundle_digest_recomputed", "canonical_signatures_verified", "d006_final_receipt_closure"];
  const groups = categoriesOf(performed);
  assert.deepEqual(groups.flatMap((group) => group.checks).sort(), [...performed].sort());
  assert.deepEqual(groups.map((group) => group.category), ["integrity", "signatures", "causality"], "in reading order, empty categories absent");
  assert.deepEqual(categoriesOf([]), [], "nothing performed, nothing shown");
  // An id the table does not know is filed under evidence, never dropped and never renamed.
  assert.deepEqual(categoriesOf(["a_check_of_tomorrow"]), [{ category: "evidence", checks: ["a_check_of_tomorrow"] }]);
  // The surface and the inspection read that grouping from the result alone.
  assert.match(surfaceCode, /revealPlan\(completedChecks, reducedMotion\)/);
  assert.match(surfaceCode, /const completedChecks = verification\.completedChecks;/);
  assert.match(inspect, /categoriesOf\(verification\.completedChecks\)/);
  // The sequence exists only once a verdict exists; nothing is shown as "running".
  assert.match(surfaceCode, /\{verdict !== null && groups\.length > 0 && \(/);
  assert.doesNotMatch(surfaceCode, /<progress|percent|%/, "no progress meter of any kind");
});

test("NX3-T20 / FS-R2: the Independent Verifier is a separate tab, with no modal verifier rendered in the Demo", () => {
  const dedicated = readFileSync(new URL("../app/verify/VerifierWorkspace.tsx", import.meta.url), "utf8");
  const transport = readFileSync(new URL("../app/verify/demoHandoff.ts", import.meta.url), "utf8");
  assert.doesNotMatch(experience, /<VerifierSurface|<VerifierPanel/);
  assert.match(experience, /className="nx-compact-handoff"/);
  assert.match(transport, /host\.open\(destination\.href, "_blank"\)/);
  assert.match(dedicated, /<main className="nx verifier-page verifier-flow"/);
  assert.match(dedicated, /data-workspace=\{isInspection \? "inspection" : "entry"\}/, "the independent surface has distinct entry and investigation workspaces");
  assert.doesNotMatch(dedicated, /role="dialog"|aria-modal/);
  assert.match(dedicated, /analyzeInsertedD006Peb\(inserted\)/, "the child computes its own result locally");
  const routed = readFileSync(new URL("../app/verify/VerifierRouteClient.tsx", import.meta.url), "utf8");
  assert.match(dedicated, /className="verifier-modular-launches"/, "received evidence offers visible links into the dedicated views");
  assert.match(dedicated, /<a key=\{view\} href=\{modularLinks\[view\]\}/, "the entry uses native canonical links");
  assert.match(routed, /<nav className="verifier-route-nav"/, "the dedicated workspace keeps its view navigation visible");
  assert.match(routed, /href=\{href\} aria-current=\{route\.view === view \? "page" : undefined\}/, "native links name the current routed page");
  assert.match(css, /grid-template-areas:\s*"reconciliation"\s*"dossier";/);
  assert.doesNotMatch(css, /\.nx-verifier \{ grid-area/);
});

test("NX3-T21: the receiving surface says DROP THE PEB HERE, and after the drop, PEB RECEIVED — in both languages", () => {
  assert.equal(en.nx.verifier.dropHere, "Drop the PEB here");
  assert.equal(fr.nx.verifier.dropHere, "Déposer le PEB ici");
  assert.equal(en.nx.verifier.received, "PEB received");
  assert.equal(fr.nx.verifier.received, "PEB reçu");
  assert.equal(en.nx.verifier.dropArmed, "Release to deposit the PEB");
  assert.equal(fr.nx.verifier.dropArmed, "Relâchez pour déposer le PEB");
  assert.match(surfaceCode, /drop === "over" \? copy\.dropArmed : copy\.dropHere/, "the words are the dictionary's");
  assert.match(surfaceCode, /<span className="nx-kicker">\{copy\.received\}<\/span>/, "the record names the receipt");
  assert.match(surfaceCode, /stage === "HANDED_OVER" \? copy\.received : stage === "CARRIED" \? copy\.carried : copy\.notReceived/, "the ledger too");
  // The drop target is the engine's, and the Deposit act is enabled only with a PEB in hand.
  assert.match(surfaceCode, /<div ref=\{dropTargetRef\} className="nx-vs-dropzone" data-drop=\{drop\} data-stage=\{stage\}>/);
  assert.match(surfaceCode, /className="nx-primary nx-vs-deposit" disabled=\{stage !== "CARRIED"\} onClick=\{onDrop\}/);
  assert.match(surfaceCode, /\{stage === "CARRIED" && <button type="button" className="nx-link" onClick=\{onRelease\}>\{copy\.release\}<\/button>\}/);
});

test("NX3-T22: ANALYZE and INSPECT are the two signature acts — the only surfaces the brand colour fills", () => {
  assert.match(surfaceCode, /className="nx-primary nx-signature nx-vs-analyze-act" disabled=\{!analyzeEnabled\}/);
  assert.match(surfaceCode, /className="nx-act nx-signature nx-vs-inspect-act"/);
  assert.match(surfaceCode, /const analyzeEnabled = stage === "HANDED_OVER" && verification\.state === "AWAITING_HUMAN";/, "ANALYZE waits for a received PEB and a person");
  assert.match(css, /\.nx-signature \{ background: var\(--nx-accent\);/);
  assert.match(css, /--nx-accent: #3552c9;/, "the site's light accent");
  const signatures = [...["nx/verifier/VerifierSurface.tsx", "nx/verifier/InspectPanel.tsx", "nx/experience/NxExperience.tsx", "nx/workspace/EvidenceDossier.tsx", "nx/workspace/ReconciliationBand.tsx", "nx/evidence/ProvenanceProof.tsx"].map((file) => code(source(file))).join("\n").matchAll(/nx-signature/g)];
  assert.equal(signatures.length, 2, "exactly two signature acts on the whole experience");
  assert.match(en.nx.verifier.analyze, /^Analyze$/);
  assert.match(fr.nx.verifier.analyze, /^Analyser$/);
});

test("NX3-T23: INSPECT opens after the verdict only, in six sections: path · graph (B2) · structure (C) · flow (D3/D4) · receipts · trust", () => {
  assert.deepEqual([...INSPECT_SECTIONS], ["path", "graph", "structure", "flow", "receipts", "trust"]);
  assert.equal(inspectSectionFrom("graph"), "graph");
  assert.equal(inspectSectionFrom("d1"), null, "no section a link cannot name");
  assert.equal(inspectSectionFrom(undefined), null);
  assert.match(surfaceCode, /const inspectOpen = verdict !== null && inspect !== null;/);
  assert.match(surfaceCode, /\{inspectOpen && \(\s*<InspectPanel/);
  assert.ok(surfaceCode.indexOf("nx-vs-inspect-act") > surfaceCode.indexOf('className="nx-vs-verdict"'), "the INSPECT act is inside the verdict record");
  // The three drawings are the Gate 2 layouts, by the Gate 2 renderer.
  assert.match(inspect, /if \(section === "graph"\) return buildVariantB2\(input\);/);
  assert.match(inspect, /if \(section === "structure"\) return buildVariantC\(input\);/);
  assert.match(inspect, /if \(section === "flow"\) return buildVariantD4\(input\);/);
  assert.match(inspect, /<VariantCanvas layout=\{layout\} graph=\{graph\} zone=\{zone\} selected=\{selected\} showOrdinals labelOf=\{\(label\) => inspectionLabel\(label, locale\)\} ariaLabel=\{copy\.sections\[section\]\} \/>/);
  assert.doesNotMatch(inspect, /variantD12|buildVariantD1\b|buildVariantD2\b|buildVariantA\b|buildVariantB1\b/, "D1 and D2 are never causal views; A and B1 were not retained");
  // The limits stand above the drawings they limit.
  assert.match(inspect, /\{section === "structure" && <p className="nx-vs-caveat">\{copy\.similarityNotCausality\}<\/p>\}/);
  assert.match(inspect, /\{section === "flow" && <p className="nx-vs-caveat">\{copy\.flowNotAuthority\}<\/p>\}/);
  assert.equal(en.nx.verifier.similarityNotCausality, "Similarity is not causality.");
  assert.equal(fr.nx.verifier.similarityNotCausality, "La similarité n’est pas la causalité.");
  assert.deepEqual(Object.keys(en.nx.verifier.sections), [...INSPECT_SECTIONS]);
  assert.deepEqual(Object.keys(fr.nx.verifier.sections), [...INSPECT_SECTIONS]);
});

test("NX3: the reading number is a label beside the identifier, and no receipt is ever disclaimed", () => {
  assert.equal(en.nx.detail.ordinal, "Reading number");
  assert.equal(fr.nx.detail.ordinal, "Numéro de lecture");
  assert.equal(en.nx.detail.id, "Identifier");
  assert.equal(fr.nx.detail.id, "Identifiant");
  assert.match(inspect, /<b className="nx-ordinal">\{receipt\.ordinal\.label\}<\/b>\s*<code>\{receipt\.evidenceId\}<\/code>/, "label, then identifier");
  assert.match(inspect, /readingNumber: string;\s*identifier: string;/);
  for (const [locale, file] of [["en", "en.ts"], ["fr", "fr.ts"]] as const) {
    const text = readFileSync(new URL(`../../../site/src/i18n/locales/${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(text, /ne fait pas partie de la preuve/i, `${locale}: the disclaimer never returns`);
    assert.doesNotMatch(text, /not part of the proof/i, `${locale}: …in either language`);
  }
  // Ordering in the inspection is the canonical reading rule, never the label.
  assert.match(inspect, /\.sort\(compareForReading\)/);
  assert.doesNotMatch(inspect, /ordinal\.index/, "the label's number is never read as a coordinate");
});

// Include the display-label regression in the existing NX3/unit gate.
import './final-surface-labels.test.ts';

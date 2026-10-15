import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { en } from "../../../site/src/i18n/locales/en.ts";
import { fr } from "../../../site/src/i18n/locales/fr.ts";
import { CATEGORY_ORDER } from "../app/nx/verifier/choreography.ts";
import { INSPECT_SECTIONS } from "../app/nx/verifier/inspectSections.ts";

/**
 * D-006/NX3 — BILINGUAL PARITY OF THE VERIFIER (mandate §14, §20, §29).
 *
 * Every word the surface can show exists in both languages, the mandated
 * phrases are exact, the canonical verdict words are never translated, and
 * the disclaimer Gate 1 removed does not return in either tongue.
 */

type Tree = Readonly<Record<string, unknown>>;
const leaves = (tree: Tree, prefix = ""): string[] => Object.entries(tree).flatMap(([key, value]) => (
  typeof value === "object" && value !== null && !Array.isArray(value) ? leaves(value as Tree, `${prefix}${key}.`) : [`${prefix}${key}`]
));

test("NX3-I18N-01: the verifier's dictionary has the same shape in EN and FR, and every leaf is a non-empty string", () => {
  assert.deepEqual(leaves(en.nx.verifier as Tree).sort(), leaves(fr.nx.verifier as Tree).sort());
  for (const [locale, copy] of [["en", en], ["fr", fr]] as const) {
    const read = (path: string) => path.split(".").reduce<unknown>((node, key) => (node as Tree)[key], copy.nx.verifier);
    for (const leaf of leaves(copy.nx.verifier as Tree)) {
      const value = read(leaf);
      assert.equal(typeof value, "string", `${locale}: nx.verifier.${leaf} is a string`);
      assert.ok((value as string).trim().length > 0, `${locale}: nx.verifier.${leaf} is not empty`);
    }
  }
  assert.deepEqual(Object.keys(en.nx.verifier.sections), [...INSPECT_SECTIONS]);
  assert.deepEqual(Object.keys(fr.nx.verifier.sections), [...INSPECT_SECTIONS]);
  assert.deepEqual(Object.keys(en.nx.verifier.categories), [...CATEGORY_ORDER]);
  assert.deepEqual(Object.keys(fr.nx.verifier.categories), [...CATEGORY_ORDER]);
});

test("NX3-I18N-02: the mandated phrases are exact in both languages", () => {
  const expected: readonly (readonly [string, string, string])[] = [
    ["nx.verifier.instrument", "Independent Verifier", "Vérificateur indépendant"],
    ["nx.verifier.dropHere", "Drop the PEB here", "Déposer le PEB ici"],
    ["nx.verifier.received", "PEB received", "PEB reçu"],
    ["nx.verifier.notReceived", "PEB not received", "PEB non reçu"],
    ["nx.verifier.noAnalysis", "No analysis", "Aucune analyse"],
    ["nx.verifier.noVerdict", "No verdict", "Aucun verdict"],
    ["nx.verifier.analyze", "Analyze", "Analyser"],
    ["nx.verifier.inspectVerdict", "Inspect", "Inspecter"],
    ["nx.verifier.similarityNotCausality", "Similarity is not causality.", "La similarité n’est pas la causalité."],
    ["nx.dossier.pick", "Pick up the PEB", "Prendre le PEB"],
    ["nx.detail.ordinal", "Reading number", "Numéro de lecture"],
    ["nx.detail.id", "Identifier", "Identifiant"],
    ["nx.proof.causalDepth", "Causal depth", "Profondeur causale"],
  ];
  const read = (copy: typeof en, path: string) => path.split(".").reduce<unknown>((node, key) => (node as Tree)[key], copy);
  for (const [path, english, french] of expected) {
    assert.equal(read(en, path), english, `${path} (en)`);
    assert.equal(read(fr, path), french, `${path} (fr)`);
  }
});

test("NX3-I18N-03: the canonical verdict words are never translated, and the Gate 1 disclaimer never returns", () => {
  for (const [locale, file] of [["en", "en.ts"], ["fr", "fr.ts"]] as const) {
    const text = readFileSync(new URL(`../../../site/src/i18n/locales/${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(text, /ne fait pas partie de la preuve|not part of the proof/i, `${locale}: no disclaimer`);
    assert.doesNotMatch(text, /\bVALIDE\b|\bINVALIDE\b|\bINDÉTERMINÉ\b|\bRÉVOQUÉ\b/, `${locale}: no translated verdict word`);
  }
  for (const copy of [en, fr]) {
    assert.deepEqual(Object.keys(copy.d006c2.verifier.verdicts).sort(), ["INDETERMINATE", "INVALID", "REVOKED", "VALID"]);
  }
  // The FR surface keeps PEB as the object's name — an identifier, not a phrase to translate.
  assert.match(fr.nx.verifier.dropHere, /\bPEB\b/);
  assert.match(fr.nx.verifier.carried, /\bPEB\b/);
});

import assert from "node:assert/strict";
import test from "node:test";

import { en } from "../../../site/src/i18n/locales/en.ts";
import { fr } from "../../../site/src/i18n/locales/fr.ts";
import { MASTER_STORY_MOMENTS } from "../app/masterStory.ts";
import { MISSION_RECEIPTS } from "../app/missionContinuity.ts";
import { VISUAL_EVENTS } from "../app/visualEvents.ts";

/**
 * D-006C §26 — the demonstration must be fully operational in EN and FR.
 * No feature may exist in English only, and French must be product language
 * rather than a fallback echo of English.
 */

type Tree = Record<string, unknown>;

function leafPaths(value: unknown, prefix = ""): string[] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return [prefix];
  return Object.entries(value as Tree).flatMap(([key, child]) =>
    leafPaths(child, prefix === "" ? key : `${prefix}.${key}`),
  );
}

function at(tree: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>(
    (node, key) => (node === null || typeof node !== "object" ? undefined : (node as Tree)[key]),
    tree,
  );
}

test("D-006C: EN and FR expose exactly the same keys — no missing translations", () => {
  const enPaths = new Set(leafPaths(en));
  const frPaths = new Set(leafPaths(fr));
  const missingInFr = [...enPaths].filter((path) => !frPaths.has(path));
  const missingInEn = [...frPaths].filter((path) => !enPaths.has(path));
  assert.deepEqual(missingInFr, [], `keys present in EN but absent in FR: ${missingInFr.join(", ")}`);
  assert.deepEqual(missingInEn, [], `keys present in FR but absent in EN: ${missingInEn.join(", ")}`);
});

test("D-006C: every ecosystem the mission crosses is named in both languages", () => {
  const systems = [...new Set(MASTER_STORY_MOMENTS.map((moment) => moment.systemKey))];
  for (const system of systems) {
    for (const [name, dictionary] of [["EN", en], ["FR", fr]] as const) {
      const label = at(dictionary, `d005f.systems.${system}`);
      assert.equal(typeof label, "string", `${name} is missing an ecosystem label for ${system}`);
      assert.ok((label as string).length > 0, `${name} ecosystem label for ${system} is empty`);
    }
  }
});

test("D-006C: every boundary the mission crosses is named in both languages", () => {
  const boundaries = [...new Set(MASTER_STORY_MOMENTS.map((moment) => moment.boundaryKey))];
  for (const boundary of boundaries) {
    for (const [name, dictionary] of [["EN", en], ["FR", fr]] as const) {
      const label = at(dictionary, `d005f.boundaries.${boundary}`);
      assert.equal(typeof label, "string", `${name} is missing a boundary label for ${boundary}`);
      assert.ok((label as string).length > 0, `${name} boundary label for ${boundary} is empty`);
    }
  }
});

test("D-006C: French does not silently fall back to English prose", () => {
  // Boundary labels are full sentences, so an identical FR value is a fallback,
  // not a legitimate shared term the way "Mission" or a product name would be.
  const boundaries = [...new Set(MASTER_STORY_MOMENTS.map((moment) => moment.boundaryKey))];
  const echoed = boundaries.filter((boundary) => {
    const enLabel = at(en, `d005f.boundaries.${boundary}`);
    const frLabel = at(fr, `d005f.boundaries.${boundary}`);
    return typeof enLabel === "string" && enLabel === frLabel;
  });
  assert.deepEqual(echoed, [], `French boundary labels still echo English: ${echoed.join(", ")}`);
});

test("D-006C: every mission receipt has a translation key reserved in both languages", () => {
  for (const receipt of MISSION_RECEIPTS) {
    assert.match(receipt.labelKey, /^[a-z][A-Za-z]+$/);
  }
  // The receipt names themselves live in the d005f namespace alongside the rest
  // of the mission vocabulary, so both locales must carry that namespace.
  for (const [name, dictionary] of [["EN", en], ["FR", fr]] as const) {
    const namespace = at(dictionary, "d005f");
    assert.ok(namespace !== undefined && typeof namespace === "object", `${name} is missing the d005f namespace`);
  }
});

test("D-006C: neither locale ships an empty or placeholder string", () => {
  for (const [name, dictionary] of [["EN", en], ["FR", fr]] as const) {
    const offenders = leafPaths(dictionary).filter((path) => {
      const value = at(dictionary, path);
      if (typeof value !== "string") return false;
      return value.trim().length === 0 || /^TODO|^TBD|^\?\?\?/.test(value.trim());
    });
    assert.deepEqual(offenders, [], `${name} contains empty or placeholder strings: ${offenders.join(", ")}`);
  }
});

test("D-006 C2: every active public event and actor has EN and FR copy", () => {
  const eventIds = [...new Set(VISUAL_EVENTS.map((event) => event.id))];
  const actors = [...new Set(VISUAL_EVENTS.map((event) => event.actor))];

  for (const [name, dictionary] of [["EN", en], ["FR", fr]] as const) {
    for (const eventId of eventIds) {
      const label = dictionary.d006c2.eventLabels[eventId];
      assert.equal(typeof label, "string", `${name} is missing the active C2 event ${eventId}`);
      assert.ok(label.trim().length > 0, `${name} has empty C2 event copy for ${eventId}`);
    }
    for (const actor of actors) {
      const label = dictionary.d006c2.actorLabels[actor];
      assert.equal(typeof label, "string", `${name} is missing the active C2 actor ${actor}`);
      assert.ok(label.trim().length > 0, `${name} has empty C2 actor copy for ${actor}`);
    }
  }
});

test("D-006 C2: public causal grammar is equivalent and naturally localized", () => {
  assert.deepEqual(en.d006c2.journey, ["HAPPENED", "EVIDENCE", "VERIFY"]);
  assert.deepEqual(fr.d006c2.journey, ["FAITS", "PREUVES", "VÉRIFIER"]);
  assert.deepEqual(en.d006c2.causal.physicalAi, ["SEE", "UNDERSTAND", "DECIDE", "ACT"]);
  assert.deepEqual(fr.d006c2.causal.physicalAi, ["VOIR", "COMPRENDRE", "DÉCIDER", "AGIR"]);

  assert.deepEqual(en.d006c2.causal.network, [
    en.d006c2.network.lost,
    en.d006c2.network.missionContinues,
    en.d006c2.network.evidenceContinues,
  ]);
  assert.deepEqual(fr.d006c2.causal.network, [
    fr.d006c2.network.lost,
    fr.d006c2.network.missionContinues,
    fr.d006c2.network.evidenceContinues,
  ]);

  for (const dictionary of [en, fr]) {
    assert.match(dictionary.d006c2.network.testInstruction, /RJ45/);
    assert.match(dictionary.d006c2.network.testInstruction, /I226-LM/);
    assert.equal(dictionary.d006c2.causal.complete.length, 3);
    assert.equal(dictionary.d006c2.causal.authority.length, 3);
  }
});

test("D-006 C2: payment authority and non-settlement remain semantically exact in both locales", () => {
  assert.equal(en.d006c2.authority.requestedAmount, "€1,850");
  assert.equal(en.d006c2.authority.limitAmount, "€500");
  assert.match(en.d006c2.authority.question, /€500[\s\S]*€1,850/);
  assert.match(en.d006c2.authority.noSettlement, /does not claim a bank settlement/i);

  assert.equal(fr.d006c2.authority.requestedAmount, "1 850 €");
  assert.equal(fr.d006c2.authority.limitAmount, "500 €");
  assert.match(fr.d006c2.authority.question, /500 €[\s\S]*1 850 €/);
  assert.match(fr.d006c2.authority.noSettlement, /ne revendique aucun règlement bancaire/i);
});

test("D-006 C2: verifier actions, themes, verdicts and completed checks are localized", () => {
  assert.deepEqual(
    [en.d006c2.verifier.insert, en.d006c2.verifier.analyze],
    ["INSERT EVIDENCE", "ANALYZE"],
  );
  assert.deepEqual(
    [fr.d006c2.verifier.insert, fr.d006c2.verifier.analyze],
    // NX1-R (justified change): human review refused literal FR; the public
    // object is a "dossier de preuves" that one deposits, not evidence one
    // inserts. The property — localized and distinct from EN — is unchanged.
    ["DÉPOSER LE DOSSIER", "ANALYSER"],
  );
  // C3-R1: the verifier theme copy was removed with the dark mode itself —
  // light is the sole public presentation and carries no selector to name.
  assert.match(en.d006c2.verifier.noNetworkRequired, /originating system not required/i);
  assert.match(fr.d006c2.verifier.noNetworkRequired, /système d’origine n’est pas sollicité/i);

  const verdicts = ["VALID", "INVALID", "REVOKED", "INDETERMINATE"] as const;
  for (const verdict of verdicts) {
    for (const [name, dictionary] of [["EN", en], ["FR", fr]] as const) {
      const copy = dictionary.d006c2.verifier.verdicts[verdict];
      assert.ok(copy.headline.trim().length > 0, `${name} ${verdict} headline is empty`);
      assert.ok(copy.scope.trim().length > 0, `${name} ${verdict} scope is empty`);
      assert.ok(copy.reading.trim().length > 0, `${name} ${verdict} reading is empty`);
    }
  }

  const completedChecks = [
    "bundle_digest_recomputed",
    "object_digests_recomputed",
    "evidence_identities_derived",
    "verification_key_authorized_by_pinned_anchor",
    "canonical_signatures_verified",
    "target_binds_to_cycle_receipt",
    "master_path_evidence_present",
    "cycle_receipt_closure",
    "governance_material_present",
    "bundle_declares_demo_only_scope",
    "d006_transferred_digest_exact",
    "d006_mission_run_identity",
    "d006_runtime_record_digests",
    "d006_displayed_peb_coverage",
    "d006_final_receipt_closure",
    "d006_financial_non_settlement",
    // D-006, 2026-10-08: reported when the PEB carries an in-mission reconciliation.
    "d006_in_mission_reconciliation_consistent",
  ] as const;
  for (const check of completedChecks) {
    assert.ok(en.d006c2.verifier.checkLabels[check]?.trim(), `EN is missing ${check}`);
    assert.ok(fr.d006c2.verifier.checkLabels[check]?.trim(), `FR is missing ${check}`);
    assert.notEqual(
      en.d006c2.verifier.checkLabels[check],
      fr.d006c2.verifier.checkLabels[check],
      `${check} silently falls back to English`,
    );
  }
});

test("D-006 C2: critical public copy does not silently echo English in French", () => {
  const localizedPaths = [
    "d006c2.brandSubtitle",
    "d006c2.heroQuestion",
    "d006c2.heroAnswer",
    "d006c2.heroIntro",
    "d006c2.callTaxi",
    "d006c2.bands.happened",
    "d006c2.bands.evidence",
    "d006c2.network.testInstruction",
    "d006c2.authority.question",
    "d006c2.authority.noSettlement",
    "d006c2.proof.take",
    "d006c2.verifier.title",
    "d006c2.verifier.insert",
    "d006c2.verifier.analyze",
    "d006c2.verifier.identitySummary",
    "d006c2.verifier.noNetworkRequired",
    "d006c2.transversality.question",
    "d006c2.footer",
  ];
  const echoed = localizedPaths.filter((path) => at(en, path) === at(fr, path));
  assert.deepEqual(echoed, [], `critical C2 French copy still echoes English: ${echoed.join(", ")}`);
});

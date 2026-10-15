import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { en } from "../../../site/src/i18n/locales/en.ts";
import { fr } from "../../../site/src/i18n/locales/fr.ts";
import { ACTION_FAMILY_ORDER, actionFamilyOf, canonicalKindOf, familiesPresent, type ActionFamily } from "../app/nx/adapter/actionFamily.ts";
import { MASTER_EVIDENCE_EVENTS } from "../app/masterStory.ts";
import { EXPERIENCE_DURATION_MS } from "../app/storyTimeline.ts";
import { modelAt } from "./support/modelAt.ts";

/**
 * D-006 NX1 Checkpoint B R2 §25 — ACTION FAMILIES.
 * The colour of a bead is the kind of thing its receipt attests, derived from
 * canonical type information, identical in every language, never assigned by
 * hand, never changing what the receipt is.
 */

const NX_ROOT = new URL("../app/nx/", import.meta.url);
const read = (relative: string) => readFileSync(new URL(relative, NX_ROOT), "utf8");
const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const FULL = modelAt(EXPERIENCE_DURATION_MS);
const items = FULL.model.accumulatedEvidence.items;

const KIND_TO_FAMILY: Readonly<Record<string, ActionFamily>> = { INTENT: "intent", POLICY: "authorization", EXECUTION: "action", RESULT: "result" };
const RUNTIME_TO_FAMILY: Readonly<Record<string, ActionFamily>> = {
  VEHICLE_OBSERVATION: "perception", CITY_SENSOR_DETECTION: "perception",
  AUTONOMOUS_DECISION: "decision", SIGNAL_PHASE_DECIDED: "decision", ROUTING_PROVENANCE_RECORDED: "decision",
  HUMAN_AUTHORITY_DECISION: "authorization", BANK_AUTHORIZATION_DECISION: "authorization",
  VEHICLE_ACTION: "action", SIGNAL_STATE_PUBLISHED: "action", PAYMENT_INSTRUCTION_PRESENTED: "action",
  VEHICLE_RESULT: "result", BANK_CONFIRMATION_RETURNED: "result",
  NETWORK_LINK_LOST: "network", NETWORK_LINK_RESTORED: "network", MISSION_COMPLETED_OFFLINE: "network", RECONCILIATION_RECEIPT: "network",
};

test("B R2 §25: every rendered nano-receipt has exactly one deterministic family, derived from canonical evidence / event information", () => {
  for (const entry of items) {
    assert.ok(ACTION_FAMILY_ORDER.includes(entry.actionFamily), `${entry.evidenceId}: ${entry.actionFamily}`);
    assert.equal(entry.actionFamily, actionFamilyOf({ source: entry.source, eventId: entry.eventId, eventType: entry.eventType }), "a pure function of the canonical type information");
    if (entry.source === "SIGNED_CANONICAL") {
      const kind = canonicalKindOf(entry.eventId);
      assert.ok(kind !== null, `${entry.eventId}: the operational model names its kind`);
      assert.equal(kind, MASTER_EVIDENCE_EVENTS.find((event) => event.event_id === entry.eventId)!.kind, "the kind is the master evidence model's own");
      assert.equal(entry.actionFamily, KIND_TO_FAMILY[kind], `${entry.eventId}: ${kind} → ${entry.actionFamily}`);
    } else {
      assert.equal(entry.actionFamily, RUNTIME_TO_FAMILY[entry.eventType], `${entry.evidenceId}: ${entry.eventType} → ${entry.actionFamily}`);
    }
  }
  // Two identical types, two identical families; the perception → decision → action → result chain reads as four families.
  const family = (id: string) => items.find((entry) => entry.evidenceId === id)!.actionFamily;
  assert.deepEqual(["NR-PERCEPTION:yellow", "NR-DECISION:stop", "NR-ACTION:brake", "NR-RESULT:at-rest"].map(family), ["perception", "decision", "action", "result"]);
  assert.equal(family("NR-PERCEPTION:congestion"), family("NR-PERCEPTION:yellow"));
  assert.equal(items.find((entry) => entry.eventId === "d005.passenger-request")!.actionFamily, "intent");
  assert.equal(items.find((entry) => entry.eventId === "d005m.master-human-approve")!.actionFamily, "authorization");
  assert.equal(items.find((entry) => entry.eventId === "d006g.bank-authorization")!.actionFamily, "authorization");
  assert.equal(items.find((entry) => entry.eventId === "d005.journey-executed")!.actionFamily, "action");
  assert.equal(items.find((entry) => entry.eventId === "d005.garage-arrival")!.actionFamily, "result");
  // The run's legend: the families actually present, in canonical order, nothing unused.
  const present = familiesPresent(items);
  assert.deepEqual(present, FULL.model.accumulatedEvidence.actionFamilies);
  assert.deepEqual(present, ACTION_FAMILY_ORDER.filter((candidate) => items.some((entry) => entry.actionFamily === candidate)));
  assert.ok(present.length >= 5 && !present.includes("unclassified") && !present.includes("network"), `present: ${present.join(", ")}`);
  const counted = Object.values(FULL.model.accumulatedEvidence.byActionFamily).reduce((sum, value) => sum + (value ?? 0), 0);
  assert.equal(counted, items.length);
});

test("B R2 §25: no individual receipt has a hard-coded colour or family; an unknown type has an explicit neutral fallback", () => {
  const mapping = code(read("adapter/actionFamily.ts"));
  assert.doesNotMatch(mapping, /NR-[A-Z]|d005\.|d005m\.|d006g\.|d006nx0\.|fortix:evidence/, "no evidence or event identifier in the mapping: types only");
  assert.doesNotMatch(mapping, /producerDomain|laneForProducer|branch/, "the family never derives from provenance");
  assert.match(mapping, /MASTER_EVIDENCE_EVENTS\.map\(\(event\) => \[event\.event_id, event\.kind\]/, "signed objects: the canonical event kind");
  const css = read("nx.css");
  assert.doesNotMatch(css, /data-evidence-id=|data-event-id=/, "no per-receipt selector colours a bead");
  assert.equal((css.match(/^\.action-[a-z]+ \{ --family: var\(--nx-family-[a-z]+\); \}$/gm) ?? []).length, ACTION_FAMILY_ORDER.length, "one colour token per family, set by class");
  const proof = code(read("evidence/ProvenanceProof.tsx"));
  assert.match(proof, /className=\{`nx-bead action-\$\{entry\.actionFamily\}/, "the bead's family class comes from the model");
  assert.doesNotMatch(proof, /"perception"|"decision"|"authorization"|#[0-9a-f]{6}/i, "the component names no family and no colour");
  assert.equal(actionFamilyOf({ source: "RUNTIME_JOURNAL", eventId: "probe.unknown", eventType: "SOMETHING_NEW" }), "unclassified");
  assert.equal(actionFamilyOf({ source: "SIGNED_CANONICAL", eventId: "probe.unknown", eventType: "SIGNED_CANONICAL" }), "unclassified");
  assert.equal(actionFamilyOf({ source: "D006_FINAL_RECEIPT", eventId: "d006.final-mission-receipt", eventType: "D006_FINAL_RECEIPT" }), "unclassified", "the Final Receipt is not a bead and gets no family");
  assert.equal(canonicalKindOf("probe.unknown"), null);
  assert.equal(ACTION_FAMILY_ORDER.at(-1), "unclassified");
  assert.match(css, /--nx-family-unclassified: #b8b3a7/, "the fallback is the mineral neutral");
});

test("B R2 §25: the family mapping is identical EN / FR — only the words differ — and the labels are short public copy", () => {
  assert.deepEqual(Object.keys(en.nx.families).sort(), [...ACTION_FAMILY_ORDER].sort());
  assert.deepEqual(Object.keys(fr.nx.families).sort(), [...ACTION_FAMILY_ORDER].sort());
  for (const family of ACTION_FAMILY_ORDER) {
    assert.ok(en.nx.families[family].length > 0 && en.nx.families[family].length <= 16, en.nx.families[family]);
    assert.ok(fr.nx.families[family].length > 0 && fr.nx.families[family].length <= 16, fr.nx.families[family]);
  }
  assert.notEqual(en.nx.families.intent, fr.nx.families.intent);
  assert.notEqual(en.nx.families.decision, fr.nx.families.decision);
  assert.notEqual(en.nx.families.result, fr.nx.families.result);
  assert.notEqual(en.nx.proof.readingOrder, fr.nx.proof.readingOrder);
  assert.notEqual(en.nx.detail.family, fr.nx.detail.family);
  // Locale is not an input of the family: the model carries the family, the dictionaries phrase it.
  const adapter = code(read("adapter/publicExperienceAdapter.ts"));
  assert.doesNotMatch(adapter, /\blocale\b|"en"|"fr"|useI18n|dictionary/, "the adapter knows no language");
  assert.match(adapter, /actionFamily: actionFamilyOf\(\{ source: member\.source, eventId: member\.eventId, eventType \}\)/);
});

test("B R2 §25: colour changes no receipt — identity, time, parents, digest and standing are the closure's own; selected / highlight states keep the family", () => {
  const members = new Map(FULL.snapshot.closure!.members.map((member) => [member.evidenceId, member] as const));
  for (const entry of items) {
    const member = members.get(entry.evidenceId)!;
    assert.equal(entry.digest, member.digest);
    assert.equal(entry.timeMs, member.timeMs);
    assert.deepEqual([...entry.causalParents], [...member.causalParents]);
    assert.deepEqual([...entry.observedInputs], [...member.observedInputs]);
    assert.equal(entry.eventId, member.eventId);
    assert.equal(entry.standing, "CLOSURE");
  }
  const proof = code(read("evidence/ProvenanceProof.tsx"));
  // The family class is on the bead in every state; the selected and focused looks read the same custom property.
  assert.match(proof, /className=\{`nx-bead action-\$\{entry\.actionFamily\}\$\{isLatest \? " is-latest" : ""\}\$\{isSelected \? " is-selected" : ""\}\$\{focused \? " is-focus" : ""\}/);
  assert.match(proof, /data-family=\{entry\.actionFamily\}/);
  const css = read("nx.css");
  assert.match(css, /\.nx-bead\.is-selected i \{[^}]*var\(--family/, "a selected bead keeps its family colour");
  assert.match(css, /\.nx-bead\.is-focus i \{[^}]*var\(--family/, "a highlighted bead keeps its family colour");
  assert.match(css, /\.nx-bead\.is-latest i \{[^}]*var\(--family/, "the arriving bead pulses in its family colour");
  // Accessibility: colour is never the only carrier — the label names the family, and Level 3 prints it.
  assert.match(proof, /copy\.familyLabels\[entry\.actionFamily\]/, "the bead's accessible name carries the family");
  const dossier = code(read("workspace/EvidenceDossier.tsx"));
  assert.match(dossier, /copy\.detail\.family[\s\S]*?copy\.familyLabels\[selected\.actionFamily\][\s\S]*?<code>\{selected\.actionFamily\}<\/code>/, "technical inspection exposes the actual family label");
  // The legend derives from the families present; the component keeps no list of its own.
  assert.match(proof, /familiesPresent\(items\)/);
  assert.match(proof, /families\.map\(\(family\) => \([\s\S]*?className=\{`nx-legend-item action-\$\{family\}`\}/);
  const root = code(read("experience/NxExperience.tsx"));
  assert.match(root, /pulseFor\(model\.latestEvidence\?\.actionFamily \?\? null\)/, "one coherent pulse system: the family of what just happened");
  assert.match(root, /export function pulseFor\(family: ActionFamily \| null\): string \{\s*return family === null \? "var\(--nx-ink-2\)" : `var\(--nx-family-\$\{family\}\)`;/, "the pulse token derives from the family key: no second list of families, the same neutral fallback as the bead");
  for (const family of ACTION_FAMILY_ORDER) assert.match(css, new RegExp(`--nx-family-${family}: #[0-9a-f]{6};`), `${family}: the token the pulse resolves to exists`);
});

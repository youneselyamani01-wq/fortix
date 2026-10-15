import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { en } from "../../../site/src/i18n/locales/en.ts";
import { fr } from "../../../site/src/i18n/locales/fr.ts";
import { MASTER_PRESENTATION_DURATION_MS, presentationTimeForMasterTime } from "../app/masterStory.ts";
import { MISSION_ID } from "../app/missionContinuity.ts";
import type { PublicEvidence } from "../app/nx/adapter/publicExperienceAdapter.ts";
import { ordinalLabel, readingOrder, readingOrdinals } from "../app/nx/adapter/readingOrder.ts";
import {
  CLOSURE_HOLD_MS,
  CRITICAL_HOLD_MS,
  CRITICAL_MOMENTS_MS,
  HUMAN_PRESENTATION_DURATION_MS,
  MINIMUM_PRESENTATION_GAP_MS,
  PACING_SCHEDULE,
  humanMasterTime,
  humanPresentationTime,
} from "../app/nx/experience/humanPacing.ts";
import { createOfflineEvidenceSession } from "../app/offlineEvidence.ts";
import {
  buildMissionEvidenceClosure,
  buildPortableMissionEvidenceBundle,
  finalReceiptRuntimeEvidencePrefix,
  issueFinalMissionReceipt,
} from "../app/portableMissionEvidence.ts";
import { projectPortableProofLeaves } from "../app/proofProjection.ts";
import { EXPERIENCE_DURATION_MS, FINAL_RECEIPT_EMITTED_MS, PEB_COMPLETE_MS, RECEIPT_TRAVEL_DURATION_MS } from "../app/storyTimeline.ts";
import { canonicalString } from "../app/verification.ts";
import { journalAt } from "../app/nx/adapter/useMissionEngine.ts";
import { modelAt } from "./support/modelAt.ts";

/**
 * D-006 NX1 — CHECKPOINT C: human readability, interaction affordance and
 * presentation pacing. C-T01 … C-T10 of the mandate.
 *
 * Three invariants govern this checkpoint and each has its own test:
 *
 *   CANONICAL  the reading ordinal is presentational only and carries no
 *              cryptographic, evidentiary or trust authority;
 *   TEMPORAL   presentation pacing never changes the actual event timeline or
 *              any evidence timestamp;
 *   SEAL       post-seal activity never renumbers or mutates the sealed
 *              mission's evidence sequence.
 */

const NX_ROOT = new URL("../app/nx/", import.meta.url);
const read = (relative: string) => readFileSync(new URL(relative, NX_ROOT), "utf8");
const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const css = read("nx.css");

const FULL = modelAt(EXPERIENCE_DURATION_MS);
const items = FULL.model.accumulatedEvidence.items;

// ---------------------------------------------------------------------------
// C-T01 / C-T02 — THE READING ORDINAL
// ---------------------------------------------------------------------------

test("C-T01: every nano-receipt carries one ordinal, in the stable topological reading order, and it does not move for the whole run", () => {
  assert.equal(items.length, 58);
  // One ordinal each, 1…n inside the sealed sequence, in reading order.
  const sealed = items.filter((entry) => entry.standing === "CLOSURE");
  assert.equal(sealed.length, items.length, "the deterministic run is entirely sealed");
  const order = readingOrder(sealed).map((entry) => entry.evidenceId);
  sealed.forEach((entry) => {
    assert.equal(entry.ordinal.zone, "SEALED");
    assert.equal(entry.ordinal.index, order.indexOf(entry.evidenceId) + 1, entry.evidenceId);
    assert.equal(entry.ordinal.label, `NR ${String(entry.ordinal.index).padStart(2, "0")}`);
  });
  assert.deepEqual([...sealed].map((entry) => entry.ordinal.index).sort((left, right) => left - right), sealed.map((_, index) => index + 1));
  // The number a receipt is given the instant it appears is the number it keeps:
  // at every moment of the run, and after the seal.
  const finalOrdinal = new Map(items.map((entry) => [entry.evidenceId, entry.ordinal.label] as const));
  for (const at of [9_000, 12_500, 30_000, 48_000, 60_000, 87_500, 90_000, FINAL_RECEIPT_EMITTED_MS, EXPERIENCE_DURATION_MS]) {
    for (const entry of modelAt(at).model.accumulatedEvidence.items) {
      assert.equal(entry.ordinal.label, finalOrdinal.get(entry.evidenceId), `${entry.evidenceId} at ${at}`);
    }
  }
  // And it is stable across a scrub in either direction, because the reading
  // order at any moment is a prefix of the run's full order.
  for (const at of [60_000, 20_000, 90_000, 12_500, EXPERIENCE_DURATION_MS]) {
    const then = modelAt(at).model.accumulatedEvidence.items;
    assert.deepEqual(then.map((entry) => entry.ordinal.index), then.map((_, index) => index + 1), `at ${at} the ordinals are the reading positions`);
  }
  assert.equal(ordinalLabel("SEALED", 7, 58), "NR 07");
  assert.equal(ordinalLabel("SEALED", 58, 58), "NR 58");
  assert.equal(ordinalLabel("AFTER_SEAL", 1, 3), "+ 01");
});

test("C-T02: a declared child can never display a lower ordinal than a declared parent", () => {
  const byId = new Map(items.map((entry) => [entry.evidenceId, entry] as const));
  let checked = 0;
  for (const entry of items) {
    for (const parent of [...entry.causalParents, ...entry.observedInputs]) {
      const parentEntry = byId.get(parent);
      if (parentEntry === undefined) continue;
      checked += 1;
      assert.ok(parentEntry.ordinal.index < entry.ordinal.index, `${parentEntry.ordinal.label} (${parent}) must be read before ${entry.ordinal.label} (${entry.evidenceId})`);
    }
  }
  assert.ok(checked > 70, `every declared relation of the run is checked: ${checked}`);
  // The rule holds even when the data does not: a parent recorded with a LATER
  // evidence time is still numbered first.
  const base = items[0]!;
  const parent: PublicEvidence = { ...base, evidenceId: "PROBE-PARENT", timeMs: 100, admissionIndex: 0, causalParents: [], observedInputs: [] };
  const child: PublicEvidence = { ...base, evidenceId: "PROBE-CHILD", timeMs: 50, admissionIndex: 1, causalParents: ["PROBE-PARENT"], observedInputs: [] };
  const ordinals = readingOrdinals([parent, child]);
  assert.equal(ordinals.get("PROBE-PARENT")!.index, 1);
  assert.equal(ordinals.get("PROBE-CHILD")!.index, 2);
});

test("C-T03: records appended after the seal never renumber the sealed mission and never enter its sequence", () => {
  const sealedBefore = new Map(items.map((entry) => [entry.evidenceId, entry.ordinal] as const));
  const journalOf = (index: number): PublicEvidence => ({
    ...items[items.length - 1]!,
    evidenceId: `PROBE-AFTER-${index}`,
    eventId: `probe-after-${index}`,
    eventType: "RECONCILIATION_RECEIPT",
    branch: "network",
    standing: "JOURNAL",
    causalParents: [],
    observedInputs: [],
    timeMs: EXPERIENCE_DURATION_MS + index,
    admissionIndex: 900 + index,
    episode: "network",
    actionFamily: "network",
  });
  for (const count of [1, 2, 3, 5]) {
    const withJournal = [...items, ...Array.from({ length: count }, (_, index) => journalOf(index))];
    const ordinals = readingOrdinals(withJournal);
    // Every sealed receipt keeps its zone, index and label.
    for (const entry of items) {
      assert.deepEqual(ordinals.get(entry.evidenceId), sealedBefore.get(entry.evidenceId), `${entry.evidenceId} with ${count} post-seal record(s)`);
    }
    // The post-seal records number themselves, apart, and are marked apart.
    for (let index = 0; index < count; index += 1) {
      const ordinal = ordinals.get(`PROBE-AFTER-${index}`)!;
      assert.equal(ordinal.zone, "AFTER_SEAL");
      assert.equal(ordinal.index, index + 1);
      assert.ok(ordinal.label.startsWith("+ "), `${ordinal.label} is visibly outside the sealed sequence`);
      assert.doesNotMatch(ordinal.label, /^NR /);
    }
    // The sealed sequence is exactly 1…58, with no gap and nothing inserted.
    const sealedIndexes = items.map((entry) => ordinals.get(entry.evidenceId)!.index).sort((left, right) => left - right);
    assert.deepEqual(sealedIndexes, items.map((_, index) => index + 1));
  }
});

test("C-T04: the ordinal is presentational only — canonical evidence is byte-for-byte what it was without it", () => {
  // Build the engine's artefacts, derive the public model (which numbers every
  // receipt), then build them again: identical bytes and identical digests.
  // The same run the numbered model was derived from: a runtime record's digest
  // includes its run, so only one run can be compared with itself.
  const RUN = "fortix.demo.d006nx1.run.geometry";
  const session = journalAt(createOfflineEvidenceSession(RUN, null, MISSION_ID), EXPERIENCE_DURATION_MS);
  const records = finalReceiptRuntimeEvidencePrefix(session);
  const build = () => {
    const closure = buildMissionEvidenceClosure({ identity: { missionId: MISSION_ID, runId: RUN }, runtimeRecords: records, asOfMasterTimeMs: FINAL_RECEIPT_EMITTED_MS });
    const finalReceipt = issueFinalMissionReceipt(closure, FINAL_RECEIPT_EMITTED_MS);
    const displayed = projectPortableProofLeaves(closure, PEB_COMPLETE_MS, finalReceipt).map((leaf) => leaf.evidenceId);
    const peb = buildPortableMissionEvidenceBundle({ closure, finalReceipt, runtimeRecords: records, displayedEvidenceIds: displayed, masterTimeMs: PEB_COMPLETE_MS });
    return { closure, finalReceipt, peb };
  };
  const before = build();
  const beforeBytes = canonicalString(before.peb);
  const beforeDigest = createHash("sha256").update(beforeBytes).digest("hex");
  const numbered = FULL.model.accumulatedEvidence.items;
  assert.ok(numbered.every((entry) => entry.ordinal.label.length > 0), "the model numbered every receipt");
  const after = build();
  assert.equal(canonicalString(after.peb), beforeBytes, "the portable bundle is byte-identical");
  assert.equal(createHash("sha256").update(canonicalString(after.peb)).digest("hex"), beforeDigest);
  assert.equal(after.peb.manifest.bundleDigest, before.peb.manifest.bundleDigest);
  assert.equal(after.closure.evidenceSetDigest, before.closure.evidenceSetDigest);
  assert.equal(after.finalReceipt.receiptId, before.finalReceipt.receiptId);
  // No reading ordinal reaches any canonical artefact: not the labels this run
  // uses, not the module, not the zone.
  const labels = new Set(numbered.map((entry) => entry.ordinal.label));
  assert.equal(labels.size, numbered.length);
  for (const artefact of [canonicalString(after.peb), canonicalString(after.closure), canonicalString(after.finalReceipt)]) {
    for (const label of labels) assert.equal(artefact.includes(label), false, `"${label}" must not appear in canonical evidence`);
    assert.doesNotMatch(artefact, /readingOrdinal|AFTER_SEAL|"NR /, "no reading number is written into evidence");
  }
  // TWO ORDERINGS, NEVER CONFUSED. The canonical bundle already carries an
  // `"ordinal"` of its own — the signed D-005M evidence index, which IS part of
  // the evidence. The reading ordinal is a different thing that lives only in
  // the public model: the canonical one is numeric and untouched (the bytes
  // above prove it), the reading one is a label that appears nowhere here.
  const canonicalOrdinals = canonicalString(after.peb).match(/"ordinal":\d+/g) ?? [];
  assert.ok(canonicalOrdinals.length > 0, "the signed evidence index has its own ordinal");
  assert.deepEqual(canonicalOrdinals, canonicalString(before.peb).match(/"ordinal":\d+/g), "and this checkpoint leaves every one of them exactly as it was");
  assert.doesNotMatch(canonicalString(after.peb), /"ordinal":"/, "no canonical ordinal was turned into a label");
  // A receipt's canonical fields are the closure's own, ordinal or not.
  const members = new Map(after.closure.members.map((member) => [member.evidenceId, member] as const));
  for (const entry of numbered) {
    const member = members.get(entry.evidenceId)!;
    assert.equal(entry.digest, member.digest);
    assert.equal(entry.timeMs, member.timeMs);
    assert.equal(entry.eventId, member.eventId);
    assert.deepEqual([...entry.causalParents], [...member.causalParents]);
  }
  // The module that computes it reads evidence and writes nothing.
  const ordinalSource = code(readFileSync(new URL("adapter/readingOrder.ts", NX_ROOT), "utf8"));
  assert.doesNotMatch(ordinalSource, /import .*(portableMissionEvidence|verification|canonicalSignature|offlineEvidence)/, "the ordinal module touches no evidence module");
  assert.doesNotMatch(ordinalSource, /digest|sign|hash|blake3/i, "and computes nothing cryptographic");
  const verifier = code(read("verifier/VerifierSurface.tsx"));
  assert.doesNotMatch(verifier, /ordinal/, "verification never reads the reading number");
});

// ---------------------------------------------------------------------------
// C-T05 / C-T06 / C-T07 — THE INTERACTION GRAMMAR
// ---------------------------------------------------------------------------

test("C-T05: an act and a status can never share an interactive costume", () => {
  // Mono uppercase is the passive voice: no act on the page is written in it.
  const acts = [".nx-primary", ".nx-secondary", ".nx-act"];
  for (const act of acts) {
    const rule = css.slice(css.indexOf(`${act} {`), css.indexOf("}", css.indexOf(`${act} {`)));
    assert.doesNotMatch(rule, /text-transform: uppercase/, `${act} is written in the sentence-case voice of an act`);
    assert.match(rule, /border-radius: 999px/, `${act} wears the pill that means "an act you perform"`);
    assert.match(rule, /min-height: 34px/, `${act} shares one target size`);
  }
  // The passive statuses carry no container and no pointer.
  assert.match(css, /\.nx-link-chip \{[^}]*cursor: default/, "the link status is not clickable and does not pretend to be");
  assert.doesNotMatch(css.slice(css.indexOf(".nx-link-chip {"), css.indexOf(".nx-link-chip i")), /border-radius: 999px|background: var\(--nx-paper\)/, "a status never wears the costume of an act");
  assert.match(css, /\.nx-legend li \{ pointer-events: none; \}/, "the legend is a key, not a filter");
  // Every control answers the pointer and the keyboard.
  for (const control of [".nx-primary:hover", ".nx-secondary:hover", ".nx-act:hover", ".nx-evidence-control:hover", ".nx-bead:hover i", ".nx-panel-toggle:hover", ".nx-branch-label:hover", ".nx-scroll-cue:hover", ".nx-link:hover", ".nx-disclose:hover", ".nx-language button:hover"]) {
    assert.ok(css.includes(control), `${control} gives the pointer an answer`);
  }
  // NX3: the keyboard ring is the brand's interaction colour — the site's
  // accent — never a pulse's blue and never a verdict's green.
  assert.match(css, /\.nx :focus-visible \{ outline: 2px solid var\(--nx-accent\); outline-offset: 3px; \}/, "and the keyboard one");
  // The affordance of a panel is a shape, not a word borrowed from the passive voice.
  // NX3: the verifier is no longer a drawer; the dossier still is, and the
  // instrument's own controls carry their word as their accessible name.
  const dossier = code(read("workspace/EvidenceDossier.tsx"));
  assert.doesNotMatch(dossier, /className="nx-panel-hint"/, "no <em> stands in for a control");
  assert.match(dossier, /className="nx-panel-chevron" aria-hidden="true"/);
  assert.match(dossier, /aria-label=\{`\$\{state\.open \? copy\.close : copy\.inspect\}: \$\{copy\.title\}`\}/, "the word is the button's accessible name");
  const surface = code(read("verifier/VerifierSurface.tsx"));
  assert.doesNotMatch(surface, /className="nx-panel-hint"/, "no <em> stands in for a control on the instrument either");
  assert.match(surface, /className="nx-vs-close" aria-label=\{copy\.close\}/, "the close control's name is the word");
  assert.match(surface, /aria-labelledby="nx-vs-title"/, "the instrument is named by its own title");
  assert.doesNotMatch(css, /\.nx-panel-hint/, "and the class is gone from the stylesheet");
});

test("C-T06: a completed transfer is a recorded result and is never offered as an act", () => {
  // NX3: the transfer is the verifier surface's DROP. The Deposit act is
  // visible from the start and enabled only while the PEB is in a hand;
  // once received, the receiving surface is replaced by the record.
  const surface = code(read("verifier/VerifierSurface.tsx"));
  const band = code(read("workspace/ReconciliationBand.tsx"));
  assert.match(surface, /<button type="button" className="nx-primary nx-vs-deposit" disabled=\{stage !== "CARRIED"\} onClick=\{onDrop\}>/, "the act is visible before it can be performed, and enabled exactly when it can");
  const branches = surface.indexOf('stage !== "HANDED_OVER" ? (');
  const received = surface.slice(surface.indexOf('className="nx-vs-received nx-recorded"', branches), surface.indexOf('verification.state !== "VERDICT" && (', branches));
  assert.ok(branches > 0 && received.length > 0, "the received record follows the receiving surface in the same branch");
  assert.doesNotMatch(received, /onClick=\{onDrop\}/, "a completed drop offers no drop act");
  // NX3 §42: the record wears the recorded costume and NO verdict tone — a
  // received PEB is a fact about the transfer, not an assurance about the
  // evidence, and the VALID green is a verdict colour (ADV-08 holds this).
  assert.match(surface, /<div className="nx-vs-received nx-recorded">/, "it is marked as a recorded result, in no verdict tone");
  assert.doesNotMatch(surface, /nx-vs-received[^>]*data-tone/, "no tone before a verdict");
  // The transfer receipt in the network band likewise.
  assert.match(band, /<small className="nx-recorded" data-receipt-id=/, "the transfer receipt is a filed artefact");
  assert.match(band, /<em className="nx-recorded" data-tone="valid" data-verdict-held="true">/, "and so is a finding that survived reconciliation");
  // The recorded costume is not the act costume, and cannot be clicked.
  const recorded = css.slice(css.indexOf(".nx-recorded {"), css.indexOf(".nx-recorded::before"));
  assert.match(recorded, /border-left: 3px solid/, "a recorded result wears the left rule");
  assert.match(recorded, /cursor: default/);
  assert.doesNotMatch(recorded, /border-radius: 999px/, "never the pill of an act");
  assert.match(css, /\.nx-recorded::before \{\s*content: "✓";/, "and says, in one mark, that it happened");
});

test("C-T07: the selected receipt stays distinguishable inside its own lit chain", () => {
  // The selected rule is declared after the chain's, so it wins the cascade,
  // and it carries a mark no other bead of the chain has.
  assert.ok(css.indexOf(".nx-bead.is-selected i {") > css.indexOf(".nx-bead.is-focus i {"));
  const selected = css.slice(css.indexOf(".nx-bead.is-selected i {"), css.indexOf("}", css.indexOf(".nx-bead.is-selected i {")));
  const focused = css.slice(css.indexOf(".nx-bead.is-focus i {"), css.indexOf("}", css.indexOf(".nx-bead.is-focus i {")));
  assert.match(selected, /border-color: var\(--nx-ink\)/);
  // NX3: the ring is the brand's interaction colour — a selection is something
  // the viewer did — while the rim stays ink and the halos stay the family.
  assert.match(selected, /box-shadow: 0 0 0 2px var\(--nx-paper\), 0 0 0 3\.5px var\(--nx-accent\)/);
  assert.notEqual(selected.replace(/\s+/g, ""), focused.replace(/\s+/g, ""));
  // Selecting opens the record (C-R2), and says in words what was selected.
  const proof = code(read("evidence/ProvenanceProof.tsx"));
  const root = code(read("experience/NxExperience.tsx"));
  assert.doesNotMatch(root, /openDossier|<ProvenanceProof/, "FS-R2: receipt inspection has moved to the verifier");
  assert.match(proof, /className="nx-proof-selected" aria-live="polite"/, "the selection is written, not only drawn");
  assert.match(proof, /aria-label=\{`\$\{entry\.ordinal\.label\} · \$\{nameOf\(entry\)\}/, "a bead is named by what it is, and its number");
  // REVISED AT C-R2-F02: the press DOES perform the opening now, so the name
  // says so rather than stopping short of it.
  assert.match(proof, /\$\{copy\.branchLabels\[entry\.branch\]\} · \$\{copy\.openReceipt\}/, "and says what pressing it does");
});

// ---------------------------------------------------------------------------
// C-T08 — ORIENTATION UNDER THE LOCAL SCROLL
// ---------------------------------------------------------------------------

test("C-T08: the fallback scroll keeps the reading-order cues and the current receipt in view", () => {
  const proof = code(read("evidence/ProvenanceProof.tsx"));
  // Headers and legend live outside the scrolling field.
  assert.match(css, /\.nx-proof \{[^}]*grid-template-rows: var\(--label-h, 22px\) minmax\(0, 1fr\) var\(--legend-h, 22px\)/);
  assert.match(css, /\.nx-proof-field\[data-fit="scroll"\] \{ overflow-y: auto;/);
  // The field follows the story's now, and says where the rest lies.
  assert.match(proof, /const newest = latest !== null && byId\.has\(latest\.evidenceId\) \? latest : items\.at\(-1\) \?\? null;/);
  assert.match(proof, /data-scroll=\{layout\.fit === "scroll" \? scrollPlace : "none"\}/);
  // NX3 / B2: the cues point along the horizontal depth axis — start and end.
  assert.match(proof, /className="nx-scroll-cue is-start"[\s\S]*?aria-label=\{`\$\{copy\.toStart\} · \$\{copy\.episodeLabels\[firstChapter\.episode\]\}`\}/, "the cue's accessible name contains its visible words");
  assert.match(proof, /className="nx-scroll-cue is-end"[\s\S]*?aria-label=\{`\$\{copy\.toEnd\} · /);
  // The rail, its chapters and the ordinals travel with the rows.
  assert.match(proof, /className="nx-rail"/);
  assert.match(proof, /className="nx-chapters"/);
  assert.match(proof, /data-ordinal=\{entry\.ordinal\.label\}/);
});

// ---------------------------------------------------------------------------
// C-T09 — EN / FR
// ---------------------------------------------------------------------------

test("C-T09: the two languages say the same things, in their own words", () => {
  assert.deepEqual(Object.keys(en.nx).sort(), Object.keys(fr.nx).sort());
  assert.deepEqual(Object.keys(en.nx.proof).sort(), Object.keys(fr.nx.proof).sort());
  assert.deepEqual(Object.keys(en.nx.detail).sort(), Object.keys(fr.nx.detail).sort());
  // Everything Checkpoint C added exists in both, differs between them, and is short.
  for (const key of ["chain", "toStart", "toEnd"] as const) {
    assert.ok(en.nx.proof[key].length > 0 && fr.nx.proof[key].length > 0, key);
    assert.notEqual(en.nx.proof[key], fr.nx.proof[key], `${key} is translated, not copied`);
  }
  assert.match(en.nx.proof.chain, /\{ancestors\}.*\{descendants\}/);
  assert.match(fr.nx.proof.chain, /\{ancestors\}.*\{descendants\}/);
  for (const dictionary of [en, fr]) {
    assert.ok(dictionary.nx.detail.ordinal.length > 0 && dictionary.nx.detail.id.length > 0);
    assert.ok(dictionary.nx.languageAria.length > 0);
  }
  assert.notEqual(en.nx.detail.ordinal, fr.nx.detail.ordinal);
  assert.notEqual(en.nx.languageAria, fr.nx.languageAria);
  // REVISED AT G1. The record used to append "reading order only; not part of
  // the evidence" to the number. It was struck because it reads as though the
  // RECEIPT were outside the evidence — and the receipt is canonical. The two
  // labelled rows now carry the distinction on their own: a reading number and
  // an identifier, side by side, with no gloss on either.
  const record = code(read("workspace/EvidenceDossier.tsx"));
  assert.doesNotMatch(record, /ordinalNote/, "no gloss follows the reading number");
  assert.match(record, /<dt>\{copy\.detail\.ordinal\}<\/dt><dd>\{selected\.ordinal\.label\}<\/dd>/, "the reading number stands alone");
  assert.match(record, /<dt>\{copy\.detail\.id\}<\/dt><dd><code>\{selected\.evidenceId\}<\/code><\/dd>/, "and the canonical identifier is the row beneath it");
  for (const dictionary of [en, fr]) {
    assert.equal((dictionary.nx.detail as Record<string, unknown>).ordinalNote, undefined, "the phrase is gone from the dictionaries");
  }
  // The validated offline sequence is untouched (Checkpoint C §20).
  assert.equal(fr.nx.reconciliation.local, "Preuves enregistrées localement");
  assert.equal(fr.nx.reconciliation.returned, "Retour du réseau");
  assert.equal(fr.nx.reconciliation.reconciled, "Preuves téléchargées");
  assert.equal(en.nx.reconciliation.local, "Evidence saved locally");
  assert.equal(en.nx.reconciliation.returned, "Network back");
  assert.equal(en.nx.reconciliation.reconciled, "Evidence uploaded");
  // The ordinal itself is language-independent: one sequence, two dictionaries.
  const labels = items.map((entry) => entry.ordinal.label);
  assert.deepEqual([...new Set(labels)].length, labels.length);
  assert.ok(labels.every((label) => /^NR \d\d$/.test(label)), "the handle is a number, not a word to translate");
});

// ---------------------------------------------------------------------------
// C-T10 — PACING NEVER FALSIFIES THE TIMELINE
// ---------------------------------------------------------------------------

test("C-T10: pacing changes only how long a viewer spends, never what happened when", () => {
  // The schedule is monotone, covers the whole experience, and is never faster
  // than the engine's own pacing on any interval.
  assert.ok(PACING_SCHEDULE.length > 0);
  assert.equal(PACING_SCHEDULE[0]!.masterFromMs, 0);
  assert.equal(PACING_SCHEDULE[PACING_SCHEDULE.length - 1]!.masterToMs, EXPERIENCE_DURATION_MS);
  let master = 0;
  let presentation = 0;
  for (const segment of PACING_SCHEDULE) {
    assert.equal(segment.masterFromMs, master, "no gap in master time");
    assert.equal(segment.presentationFromMs, presentation, "no gap in presentation time");
    assert.ok(segment.masterToMs >= segment.masterFromMs, "master time never runs backwards");
    assert.ok(segment.presentationToMs > segment.presentationFromMs, "presentation time always advances");
    if (!segment.hold) {
      const engineGap = presentationTimeForMasterTime(segment.masterToMs) - presentationTimeForMasterTime(segment.masterFromMs);
      assert.ok(segment.presentationToMs - segment.presentationFromMs >= engineGap - 0.001, "never faster than the engine");
      assert.ok(segment.presentationToMs - segment.presentationFromMs >= MINIMUM_PRESENTATION_GAP_MS[segment.pacing] - 0.001, `${segment.pacing} floor honoured`);
    } else {
      assert.equal(segment.masterToMs, segment.masterFromMs, "a hold rests on one instant");
      // C-R2-F06: a hold is one arrival long where evidence arrives, and a
      // closure beat where none does — the ending was made of full holds with
      // nothing in them.
      assert.ok(
        [CRITICAL_HOLD_MS, CLOSURE_HOLD_MS].includes(segment.presentationToMs - segment.presentationFromMs),
        `a hold is either an arrival or a closure beat: ${segment.presentationToMs - segment.presentationFromMs} ms at ${segment.masterFromMs}`,
      );
      assert.ok(CRITICAL_MOMENTS_MS.includes(segment.masterFromMs), "and only on a canonical instant");
    }
    master = segment.masterToMs;
    presentation = segment.presentationToMs;
  }
  assert.equal(presentation, HUMAN_PRESENTATION_DURATION_MS);
  assert.ok(HUMAN_PRESENTATION_DURATION_MS > MASTER_PRESENTATION_DURATION_MS, "a viewer is given more time, never less");
  // Master time is monotone in presentation time and never leaves the experience.
  let previous = -1;
  for (let at = 0; at <= HUMAN_PRESENTATION_DURATION_MS + 2_000; at += 250) {
    const value = humanMasterTime(at);
    assert.ok(value >= previous, `monotone at ${at}`);
    assert.ok(value >= 0 && value <= EXPERIENCE_DURATION_MS, `inside the experience at ${at}`);
    previous = value;
  }
  assert.equal(humanMasterTime(0), 0);
  assert.equal(humanMasterTime(HUMAN_PRESENTATION_DURATION_MS), EXPERIENCE_DURATION_MS);
  assert.equal(humanPresentationTime(0), 0);
  assert.equal(humanPresentationTime(EXPERIENCE_DURATION_MS), HUMAN_PRESENTATION_DURATION_MS);
  // THE TEMPORAL INVARIANT: the evidence at a master time is exactly what it
  // was, whatever pace the viewer reached it at. Pacing has no say in it.
  for (const at of [12_500, 48_000, 84_250, FINAL_RECEIPT_EMITTED_MS, EXPERIENCE_DURATION_MS]) {
    const direct = modelAt(at).model.accumulatedEvidence.items;
    const paced = modelAt(Math.round(humanMasterTime(humanPresentationTime(at)))).model.accumulatedEvidence.items;
    assert.deepEqual(
      paced.map((entry) => [entry.evidenceId, entry.timeMs, entry.digest, entry.ordinal.label, entry.admissionIndex]),
      direct.map((entry) => [entry.evidenceId, entry.timeMs, entry.digest, entry.ordinal.label, entry.admissionIndex]),
      `at ${at}: the same evidence, the same times, the same order`,
    );
  }
  // The pacing module reads the engine's tables and writes nothing back.
  const pacing = code(readFileSync(new URL("experience/humanPacing.ts", NX_ROOT), "utf8"));
  assert.doesNotMatch(pacing, /Date\.now|performance\.now|setTimeout|setInterval|Math\.random/, "no clock of its own");
  assert.doesNotMatch(pacing, /appendNetworkTransition|appendMissionEvidence|reconcileOfflineEvidence|issueFinalMissionReceipt|buildMissionEvidenceClosure|buildPortableMissionEvidenceBundle|canonicalSignature|projectMissionEvidence/, "it authors nothing");
  assert.match(pacing, /import \{ presentationTimeForMasterTime \} from "\.\.\/\.\.\/masterStory\.ts"/, "the pace is measured against the engine's own");
  // C-R1 — the moments themselves moved to the presentation queue, which reads
  // the same engine tables and nothing else.
  const queue = code(readFileSync(new URL("experience/presentationQueue.ts", NX_ROOT), "utf8"));
  assert.match(queue, /import \{ MASTER_EVIDENCE_EVENTS \} from "\.\.\/\.\.\/masterStory\.ts"/, "the moments are the engine's own");
  assert.match(queue, /import \{ MISSION_EVIDENCE_SPECS, specTime \} from "\.\.\/\.\.\/missionEvidence\.ts"/);
  assert.doesNotMatch(queue, /Date\.now|performance\.now|setTimeout|setInterval|Math\.random/, "the queue has no clock of its own");
  assert.doesNotMatch(queue, /appendNetworkTransition|appendMissionEvidence|reconcileOfflineEvidence|issueFinalMissionReceipt|buildMissionEvidenceClosure|canonicalSignature/, "and authors nothing");
  const runtime = code(readFileSync(new URL("adapter/useMissionEngine.ts", NX_ROOT), "utf8"));
  assert.match(runtime, /const presentation = anchorPresentation \+ elapsed;/, "playback advances a presentation coordinate");
  assert.match(runtime, /humanMasterTime\(presentation\)/, "and converts it to master time");
  assert.match(runtime, /constrainReviewTime\(proposed, "INTERACTIVE", humanDecision\)/, "and the engine's review rules still decide the rest");
});

test("C-T03/§C: the paced run gives every arrival time to be read, and rests on the moments that matter", () => {
  // REVISED AT C-R1, and deliberately inverted. As written at Checkpoint C
  // this test ASSERTED the defect the human review then rejected: it required
  // exactly `sameMoment` gaps to fall below the ordinary floor, which is to say
  // it required receipts sharing a canonical instant to still arrive together.
  // C-R1's whole subject is that no two receipts may arrive together, whatever
  // instant they were recorded at, so the assertion now says the opposite. It
  // is kept here, rather than deleted, so the change of mind is on the record.
  const landing = (entry: PublicEvidence) => entry.slot.landingMs;
  const gaps = (at: (entry: PublicEvidence) => number) => items.slice(1).map((entry, index) => at(entry) - at(items[index]!));
  const before = gaps((entry) => presentationTimeForMasterTime(entry.timeMs + RECEIPT_TRAVEL_DURATION_MS));
  const after = gaps(landing);
  const median = (values: readonly number[]) => [...values].sort((left, right) => left - right)[Math.floor(values.length / 2)]!;
  assert.ok(median(after) > median(before), `the median arrival gap grows: ${median(before)} ms → ${median(after)} ms`);
  // NO arrival is below the floor — not even one sharing a canonical instant.
  const sameMoment = items.slice(1).filter((entry, index) => entry.timeMs === items[index]!.timeMs).length;
  assert.ok(sameMoment > 0, "the run really does record receipts at a shared instant");
  assert.equal(after.filter((gap) => gap < MINIMUM_PRESENTATION_GAP_MS.ORDINARY).length, 0, "every arrival gets at least the ordinary floor");
  assert.ok(before.filter((gap) => gap < MINIMUM_PRESENTATION_GAP_MS.ORDINARY).length > 20, "which was not true before");
  // The four canonical instants the mission turns on each get their respiration.
  assert.equal(PACING_SCHEDULE.filter((segment) => segment.hold).length, CRITICAL_MOMENTS_MS.length);
});

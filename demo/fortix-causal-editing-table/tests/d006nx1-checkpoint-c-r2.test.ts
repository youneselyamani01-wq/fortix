import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

import { en } from "../../../site/src/i18n/locales/en.ts";
import { fr } from "../../../site/src/i18n/locales/fr.ts";
import { ordinalCompact, ordinalDigits, ordinalLabel, readingOrdinals } from "../app/nx/adapter/readingOrder.ts";
import type { PublicEvidence } from "../app/nx/adapter/publicExperienceAdapter.ts";
import {
  CLOSURE_HOLD_MS,
  CRITICAL_HOLD_MS,
  CRITICAL_MOMENTS_MS,
  HUMAN_PRESENTATION_DURATION_MS,
  PACING_SCHEDULE,
  naturalDepartureTime,
} from "../app/nx/experience/humanPacing.ts";
import {
  NX_RECEIPT_FLIGHT_MS,
  minimumArrivalGapMs,
  ownsAttention,
  presentationSlots,
  stageAt,
} from "../app/nx/experience/presentationQueue.ts";
import { reconciliationLine } from "../app/nx/workspace/workspaceLines.ts";
import { EXPERIENCE_DURATION_MS, FINAL_RECEIPT_EMITTED_MS } from "../app/storyTimeline.ts";
import { modelAt } from "./support/modelAt.ts";

/**
 * D-006 NX1 — CHECKPOINT C-R2: GRAPH NAVIGATION, WORLD BREADTH & ENDING
 * CLEANUP.
 *
 * C-R1 removed the receipt bursts and was accepted as directionally right, but
 * human review found it hard to USE and ceremonious to WATCH: the beads were
 * unidentifiable, the record needed a second undiscoverable click, the
 * selected receipt was easy to lose, the network row said too much, the taxi
 * used a third of the world, the ending trailed, and the run took 140 s.
 *
 * These tests pin the seven remedies and — as at every checkpoint before — the
 * things the remedies were not allowed to touch.
 */

const NX_ROOT = new URL("../app/nx/", import.meta.url);
const read = (relative: string) => readFileSync(new URL(relative, NX_ROOT), "utf8");
const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const css = read("nx.css");

const FULL = modelAt(EXPERIENCE_DURATION_MS);
const items = FULL.model.accumulatedEvidence.items;
const slots = presentationSlots(
  items.map((entry) => ({
    evidenceId: entry.evidenceId,
    timeMs: entry.timeMs,
    eventId: entry.eventId,
    eventType: entry.eventType,
    source: entry.source,
    episode: entry.episode,
  })),
  naturalDepartureTime,
  CRITICAL_MOMENTS_MS,
);

// ---------------------------------------------------------------------------
// C-R2-T01 — THE BEAD SAYS ITS NUMBER
// ---------------------------------------------------------------------------

test("C-R2-T01: every bead displays the stable human ordinal, and it is the dossier's own number", () => {
  const proof = code(read("evidence/ProvenanceProof.tsx"));
  assert.match(proof, /<b className="nx-bead-ordinal" aria-hidden="true">\{entry\.ordinal\.compact\}<\/b>/, "the bead prints its compact ordinal");
  assert.match(css, /\.nx-bead-ordinal \{/, "and it is styled");
  assert.match(css, /font-variant-numeric: tabular-nums/, "in tabular numerals, so the column reads as a column");

  // ONE NUMBERING, TWO RENDERINGS. The compact form is derived from the same
  // index as the label; it is never a second sequence.
  for (const entry of items) {
    assert.equal(entry.ordinal.compact, ordinalCompact(entry.ordinal.zone, entry.ordinal.index, 58));
    assert.equal(entry.ordinal.label, ordinalLabel(entry.ordinal.zone, entry.ordinal.index, 58));
    assert.ok(entry.ordinal.label.endsWith(entry.ordinal.compact), `${entry.ordinal.label} contains ${entry.ordinal.compact}`);
    assert.equal(entry.ordinal.compact, ordinalDigits(entry.ordinal.index, 58), "a sealed bead shows the digits alone");
  }
  assert.equal(items[0]!.ordinal.compact, "01");
  assert.equal(items[0]!.ordinal.label, "NR 01");
  assert.equal(items.at(-1)!.ordinal.compact, "58");
  // Post-seal records stay visibly outside the sealed sequence in BOTH forms.
  assert.equal(ordinalCompact("AFTER_SEAL", 1, 3), "+01");
  assert.equal(ordinalLabel("AFTER_SEAL", 1, 3), "+ 01");

  // The ordinal is still presentational, still stable, and interaction does not
  // move it: selecting or opening a record changes no number.
  const seen = new Map<string, string>();
  for (const at of [9_000, 24_000, 48_000, 84_250, EXPERIENCE_DURATION_MS]) {
    for (const entry of modelAt(at).model.accumulatedEvidence.items) {
      const previous = seen.get(entry.evidenceId);
      if (previous !== undefined) assert.equal(entry.ordinal.compact, previous, `${entry.evidenceId} renumbered at ${at}`);
      seen.set(entry.evidenceId, entry.ordinal.compact);
    }
  }
  assert.equal(seen.size, 58);
});

// ---------------------------------------------------------------------------
// C-R2-T02 — ONE CLICK
// ---------------------------------------------------------------------------
// Former contract (C-R2-F02, commit "d006-nx1: open the record in one click, and
// make the link a signal", 2026-09-08): one press on a Demo proof bead did three
// things at once — select the receipt, light its causal chain, open its record —
// because a second press was undiscoverable. It lived in NxExperience
// (selectBead → openDossier) and ProvenanceProof.
// Architectural change: the FS-R2 structural correction (2026-09-25) removed the
// evidence drawer and the local inspector from the Demo; receipt inspection moved
// to the Independent Verifier, and commit "fix(network): restore automatic path
// continuity" (2026-10-02) removed selectBead and openDossier from NxExperience.
// ProvenanceProof is no longer mounted anywhere.
// Current contract, tested where it now lives: in the Verifier's causal graph one
// press on a received NanoReceipt selects it, lights its direct causal chain and
// opens its record in the shared fact inspector, with no second act. Two clauses
// described the Demo bead button itself and retired with it: the accessible name
// promising "open the evidence record" and aria-current instead of aria-pressed.
// See artifacts/d006-nx1/INTERACTION_AND_ORDINAL_CONTRACT_C_R2.md, amendment of 2026-10-09.

test("C-R2-T02: a single press selects, lights the chain and opens the record — no second act remains (Verifier graph since FS-R2)", () => {
  const workspace = code(read("../verify/InspectionWorkspace.tsx"));
  // One press on a node — pointer, Enter or Space — is one act on that node.
  assert.match(workspace, /className="received-graph-node"[^>]*role="button"[^>]*onClick=\{\(\) => onNode\(node\.key\)\} onKeyDown=\{event => activate\(event, \(\) => onNode\(node\.key\)\)\}/, "every received NanoReceipt is a button whose press is the one act");
  assert.match(workspace, /const activate = \(event: KeyboardEvent, action: \(\) => void\) => \{ if \(event\.key === "Enter" \|\| event\.key === " "\) \{ event\.preventDefault\(\); action\(\); \} \};/, "the keyboard press is the same act");
  assert.match(workspace, /onNode=\{chooseNode\}/, "the graph delegates the press to chooseNode");
  // chooseNode does all three things at once, whatever was selected before.
  const choose = workspace.match(/^\s*const chooseNode = \(key: string\) => \{(.*)\};$/m);
  assert.ok(choose, "chooseNode is a single act");
  assert.match(choose![1]!, /updateSelection\(\{ nodeKey: key \}\)/, "it selects the receipt");
  assert.match(choose![1]!, /setMode\("isolate"\)/, "it lights the receipt's own causal chain");
  assert.doesNotMatch(choose![1]!, /[!=]==|\bif\b|\?(?!\.)/, "no two-step: the press never depends on the current selection");
  assert.match(workspace, /mode === "isolate" \? inspectionDirectCausalEmphasis\(graph, selectedNode\.key\)/, "isolate lights the direct parents and consequences of the selected receipt");
  // The selection opens the record in the shared inspector, beside the graph.
  assert.match(workspace, /const selected = !!\(selectedNode \|\| selectedEdge \|\| selectedBoundary\);/);
  assert.match(workspace, /const selectedEntry = selectedNode \? catalogEntryByNodeKey\(factCatalog, selectedNode\.key\) : null;/);
  assert.match(workspace, /\{selected \? <aside ref=\{inspectorRef\} className="inspection-panel"/, "the press opens the inspection panel");
  assert.match(workspace, /\{selectedEntry \? <FactInspector /, "and the panel is the receipt's record");
  // The Demo keeps no second, divergent act: inspection moved, it was not duplicated.
  const demo = code(read("experience/NxExperience.tsx"));
  assert.doesNotMatch(demo, /selectBead|openDossier|<ProvenanceProof/, "the Demo no longer opens receipt records");
  // No double-click handler anywhere in the NX layer or the Verifier.
  const sources = (dir: URL): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(item => item.isDirectory()
    ? sources(new URL(`${item.name}/`, dir))
    : /\.(tsx?|css)$/.test(item.name) ? [readFileSync(new URL(item.name, dir), "utf8")] : []);
  for (const layer of ["./", "../verify/"]) {
    assert.doesNotMatch(sources(new URL(layer, NX_ROOT)).join("\n"), /onDoubleClick|dblclick/i, `nothing requires a double click (${layer})`);
  }
});

// ---------------------------------------------------------------------------
// C-R2-T03 — THE SELECTED RECEIPT IS OBVIOUS
// ---------------------------------------------------------------------------

test("C-R2-T03: the selected bead is emphasised beyond its chain, and keeps its family", () => {
  const selected = css.slice(css.indexOf(".nx-bead.is-selected i {"), css.indexOf("}", css.indexOf(".nx-bead.is-selected i {")));
  const focused = css.slice(css.indexOf(".nx-bead.is-focus i {"), css.indexOf("}", css.indexOf(".nx-bead.is-focus i {")));
  // Declared after the chain rule, so it wins at equal specificity (B R2/C).
  assert.ok(css.indexOf(".nx-bead.is-selected i {") > css.indexOf(".nx-bead.is-focus i {"));
  assert.notEqual(selected.replace(/\s+/g, ""), focused.replace(/\s+/g, ""));
  // C-R2-F03: a fourth, wider halo ring and a lift the chain does not have.
  assert.match(selected, /0 0 0 10px color-mix\(in srgb, var\(--family, var\(--nx-ink\)\) 12%, transparent\)/, "a wider halo");
  assert.match(selected, /transform: scale\(calc\(var\(--nr-appear, 1\) \* 1\.25\)\)/, "and a lift");
  assert.match(selected, /var\(--family/, "the family colour survives selection");
  // The selected receipt's own number is the strongest number on the band.
  assert.match(css, /\.nx-bead\.is-selected \.nx-bead-ordinal \{ color: var\(--nx-ink\); font-weight: 700; \}/);
  // Restraint: no neon.
  assert.doesNotMatch(selected, /filter:|blur\(|drop-shadow/, "no glow");

  // THE CASCADE BUG C-R2 FOUND AND FIXED. The status modifiers are declared
  // after the selected rule and write `border-color`, so at equal specificity
  // an unresolved, quarantined or post-seal bead lost the selected ink rim.
  const rescue = css.indexOf(".nx-bead.is-selected.is-not-retained i,");
  assert.ok(rescue > css.indexOf(".nx-bead.is-unresolved i {"), "the rim is restored after the modifiers, not before");
  assert.match(css.slice(rescue, css.indexOf("}", rescue)), /border-color: var\(--nx-ink\)/);
  // …and only the rim: each modifier keeps the dash or dot that carries meaning.
  assert.doesNotMatch(css.slice(rescue, css.indexOf("}", rescue)), /border-style/, "the modifier's own meaning is untouched");
});

// ---------------------------------------------------------------------------
// C-R2-T04 — THE NETWORK INDICATOR IS A SIGNAL, NOT A SENTENCE
// ---------------------------------------------------------------------------

test("C-R2-T04: the link is drawn as signal bars with no words, and never fabricates a connection", () => {
  const root = code(read("experience/NxExperience.tsx"));
  assert.match(root, /<i aria-hidden="true"><b \/><b \/><b \/><b \/><\/i>/, "four bars");
  assert.doesNotMatch(root, /<span>\{linkLine\(model\.network, nx\.link\)\}<\/span>/, "and no written status line");
  // NX3 took the VALID green off the bars (a verdict colour is worn by
  // verdicts only, ADV-08b); NX4 took the lamp green off too: a link that is
  // up is a fact, drawn in ink — green is for established / valid cues only.
  assert.match(css, /\.nx-link-chip\[data-link="CONNECTED"\] i b \{ background: var\(--nx-ink\)/, "observed and up: filled");
  assert.match(css, /\.nx-link-chip\[data-link="LOST"\] i::after/, "observed and down: struck through");
  // NOT OBSERVED IS NOT CONNECTED. The base bar style is hollow, and only an
  // observed CONNECTED fills it — an unobserved link can never look connected.
  const base = css.slice(css.indexOf(".nx-link-chip i b {"), css.indexOf("}", css.indexOf(".nx-link-chip i b {")));
  assert.match(base, /background: transparent/, "hollow until the sentinel says otherwise");

  // The two link-state sentences are gone from the band's copy, in both
  // languages, and the validated reconciliation sequence is untouched.
  for (const dictionary of [en, fr]) {
    const copy = dictionary.nx.reconciliation as Record<string, unknown>;
    assert.equal(copy.unobserved, undefined, "no 'network not observed · evidence kept on this machine'");
    assert.equal(copy.connected, undefined, "no 'network connected · evidence kept on this machine'");
    assert.doesNotMatch(JSON.stringify(dictionary.nx), /Ethernet/i, "the indicator names no transport");
  }
  assert.equal(fr.nx.reconciliation.local, "Preuves enregistrées localement");
  assert.equal(fr.nx.reconciliation.returned, "Retour du réseau");
  assert.equal(fr.nx.reconciliation.reconciled, "Preuves téléchargées");
  assert.equal(en.nx.reconciliation.local, "Evidence saved locally");
  assert.equal(en.nx.reconciliation.returned, "Network back");
  assert.equal(en.nx.reconciliation.reconciled, "Evidence uploaded");

  // The band is SILENT when there is no reconciliation to report, and speaks
  // the moment there is. Network state and evidence state stay apart.
  const quiet = { reconciliationStage: "NONE", state: "CONNECTED", linkPhase: "CONNECTED", transferredCount: null } as never;
  const lost = { reconciliationStage: "NONE", state: "LOST", linkPhase: "LOST", transferredCount: null } as never;
  const done = { reconciliationStage: "RECONCILED", state: "CONNECTED", linkPhase: "CONNECTED", transferredCount: 3 } as never;
  for (const dictionary of [en, fr]) {
    assert.equal(reconciliationLine(quiet, dictionary.nx.reconciliation), null, "nothing to reconcile, nothing said");
    assert.equal(reconciliationLine(lost, dictionary.nx.reconciliation), dictionary.nx.reconciliation.local, "an admitted loss is an evidence fact");
    assert.equal(reconciliationLine(done, dictionary.nx.reconciliation), dictionary.nx.reconciliation.reconciled);
  }
});

// ---------------------------------------------------------------------------
// C-R2-T05 — THE WORLD USES ITS WIDTH
// ---------------------------------------------------------------------------

test("C-R2-T05: the taxi traverses materially more of the world, and still meets every prop", () => {
  const world = code(read("world/WorldStage.tsx"));
  const num = (name: string) => Number(new RegExp(`export const ${name} = ([\\d_]+);`).exec(world)![1]!.replace(/_/g, ""));
  const width = num("STAGE_WIDTH");
  const height = num("STAGE_HEIGHT") - num("STAGE_VIEW_TOP");
  // The stage is height-capped and `height: auto`, so its ASPECT RATIO decides
  // how much width it is given. Flatter drawing, more width for the route.
  assert.ok(width / height > 7, `the drawing is flat enough to use the band's width (${width}x${height})`);
  assert.match(css, /\.nx-stage \{ width: 100%; height: auto; max-height: min\(15vh, 134px\)/);

  // ONE monotone easing, applied through stageXOf to the taxi AND the props,
  // so every coincidence the engine states survives it.
  assert.match(world, /const eased = clamped <= ROUTE_END/);
  assert.match(world, /return LEFT \+ eased \* SPAN;/);
  assert.equal((world.match(/function stageXOf/g) ?? []).length, 1, "one mapping, not one per thing drawn");
  assert.match(world, /const taxiX = stageXOf\(world\.taxi\.position\)/);
  assert.match(world, /const lightX = stageXOf\(STAGE_PROPS\.trafficLight\.position\)/);
  assert.match(world, /const garageX = stageXOf\(STAGE_PROPS\.garage\.position\)/);
  // Monotone: the easing may stretch the axis, never reorder it.
  const ROUTE_END = 0.8;
  const ROUTE_SHARE = 0.88;
  const eased = (p: number) => (p <= ROUTE_END ? (p / ROUTE_END) * ROUTE_SHARE : ROUTE_SHARE + ((p - ROUTE_END) / (1 - ROUTE_END)) * (1 - ROUTE_SHARE));
  let previous = -1;
  for (let p = 0; p <= 1.0001; p += 0.01) {
    const value = eased(Math.min(1, p));
    assert.ok(value >= previous, `the axis never runs backwards at ${p.toFixed(2)}`);
    previous = value;
  }
  assert.equal(eased(0), 0);
  assert.ok(Math.abs(eased(1) - 1) < 1e-9, "and it still covers the whole stage");
  // The travelled interval takes more of the stage than it did linearly.
  assert.ok(eased(0.8) - eased(0.04) > 0.8 - 0.04, "the route is given more room than a linear axis gave it");
  // The world is presentation only: it authors nothing and reads the engine.
  assert.doesNotMatch(world, /Date\.now|Math\.random|setTimeout|setInterval|fetch\(/, "the world has no clock and no network");
});

// ---------------------------------------------------------------------------
// C-R2-T06 — THE ENDING STOPS
// ---------------------------------------------------------------------------

test("C-R2-T06: a hold is as long as what arrives in it, and the run no longer trails", () => {
  const holds = PACING_SCHEDULE.filter((segment) => segment.hold);
  assert.equal(holds.length, CRITICAL_MOMENTS_MS.length, "every critical instant still holds");
  const lengths = holds.map((segment) => segment.presentationToMs - segment.presentationFromMs);
  assert.ok(lengths.includes(CLOSURE_HOLD_MS), "the instants where nothing arrives get a closure beat");
  assert.ok(lengths.includes(CRITICAL_HOLD_MS), "and the ones where evidence lands keep a full hold");
  assert.ok(CLOSURE_HOLD_MS < CRITICAL_HOLD_MS);
  // The Final Receipt's instant keeps its full hold: the capsule materialises
  // there even though no nano-receipt does.
  const finalHold = holds.find((segment) => segment.masterFromMs === FINAL_RECEIPT_EMITTED_MS);
  assert.ok(finalHold !== undefined);
  assert.equal(finalHold.presentationToMs - finalHold.presentationFromMs, CRITICAL_HOLD_MS, "the mission's compilation is not trimmed");

  // The terminal idle — presentation time after the last receipt is fully
  // presented — is materially shorter than the 16.2 s C-R1 ended with.
  const lastSlotEnd = Math.max(...slots.map((slot) => slot.slotEndMs));
  const terminalIdle = HUMAN_PRESENTATION_DURATION_MS - lastSlotEnd;
  assert.ok(terminalIdle < 13_000, `the ending was trimmed: ${Math.round(terminalIdle)} ms after the last receipt`);
  // What remains is not idle: the Final Receipt, the bundle and the hand-over
  // all become readable in it, each on a canonical instant.
  assert.ok(terminalIdle > 0, "the mission still closes rather than cutting off");
  assert.equal(PACING_SCHEDULE.at(-1)!.masterToMs, EXPERIENCE_DURATION_MS, "and the run still reaches the canonical end");
});

// ---------------------------------------------------------------------------
// C-R2-T07 — VARIANT B: SHORTER, AND STILL BURST-FREE
// ---------------------------------------------------------------------------

test("C-R2-T07: the next receipt may fly while this one is read, but never be read with it", () => {
  // THE RULE: the LANDING waits, the departure does not.
  for (let index = 1; index < slots.length; index += 1) {
    const previous = slots[index - 1]!;
    const current = slots[index]!;
    if (current.canonicalTimeMs >= EXPERIENCE_DURATION_MS) continue;
    assert.ok(current.landingMs >= previous.slotEndMs, `${current.evidenceId} lands before ${previous.evidenceId} is read`);
    assert.ok(current.releaseMs >= previous.landingMs, `${current.evidenceId} departs while ${previous.evidenceId} is still crossing`);
    assert.equal(current.landingMs - current.releaseMs, NX_RECEIPT_FLIGHT_MS, "every flight is one flight long");
  }
  // Sampled across the whole run: reading never overlaps reading, flight never
  // overlaps flight, and flight DOES overlap reading — that is the trade.
  let overlaps = 0;
  for (let now = 0; now <= HUMAN_PRESENTATION_DURATION_MS; now += 25) {
    const owners = slots.filter((slot) => ownsAttention(slot, now)).length;
    const flying = slots.filter((slot) => stageAt(slot, now) === "ARRIVING").length;
    assert.ok(owners <= 1, `two receipts are being read at ${now} ms`);
    assert.ok(flying <= 1, `two receipts are in flight at ${now} ms`);
    if (owners === 1 && flying === 1) overlaps += 1;
  }
  assert.ok(overlaps > 100, `a flight overlaps a reading often — that is the time C-R1 was spending (${overlaps} sampled moments)`);
  // No arrival is under the human floor, and the floor no longer pays for a flight.
  const gaps = slots.slice(1).map((slot, index) => slot.landingMs - slots[index]!.landingMs);
  assert.equal(gaps.filter((gap) => gap < minimumArrivalGapMs("ORDINARY")).length, 0, "no burst under the human floor");
  assert.ok(Math.min(...gaps) >= 1_300);
  // Materially shorter than C-R1's 140 s, and no receipt reads for less.
  assert.ok(HUMAN_PRESENTATION_DURATION_MS < 120_000, `the run is materially shorter: ${HUMAN_PRESENTATION_DURATION_MS} ms`);
  assert.ok(Math.min(...slots.filter((slot) => slot.ownershipMs > 0).map((slot) => slot.ownershipMs)) >= 1_100, "and every receipt keeps its reading hold");
});

// ---------------------------------------------------------------------------
// C-R2-T08 — WHAT C-R2 WAS NOT ALLOWED TO TOUCH
// ---------------------------------------------------------------------------

test("C-R2-T08: navigation, breadth and pacing changed nothing about the evidence", () => {
  // Canonical instants, digests, admission order and declared relations are
  // identical whatever presentation cursor reached them.
  for (const at of [12_000, 48_000, 54_000, EXPERIENCE_DURATION_MS]) {
    const early = modelAt(at, naturalDepartureTime(at)).model.accumulatedEvidence.items;
    const late = modelAt(at, HUMAN_PRESENTATION_DURATION_MS).model.accumulatedEvidence.items;
    const seen = new Map(late.map((entry) => [entry.evidenceId, entry] as const));
    for (const entry of early) {
      const other = seen.get(entry.evidenceId)!;
      assert.equal(entry.timeMs, other.timeMs, `${entry.evidenceId}: one recorded instant`);
      assert.equal(entry.digest, other.digest);
      assert.equal(entry.admissionIndex, other.admissionIndex);
      assert.deepEqual(entry.causalParents, other.causalParents);
      assert.equal(entry.ordinal.label, other.ordinal.label);
    }
  }
  // A declared child is still never numbered before its parent.
  const byId = new Map(items.map((entry) => [entry.evidenceId, entry] as const));
  let checked = 0;
  for (const entry of items) {
    for (const parent of [...entry.causalParents, ...entry.observedInputs]) {
      const parentEntry = byId.get(parent);
      if (parentEntry === undefined) continue;
      checked += 1;
      assert.ok(parentEntry.ordinal.index < entry.ordinal.index, `${parent} must be read before ${entry.evidenceId}`);
    }
  }
  assert.ok(checked > 70);
  // Post-seal records still number themselves apart, in both renderings.
  const journal: PublicEvidence = {
    ...items.at(-1)!,
    evidenceId: "PROBE-AFTER-1",
    standing: "JOURNAL",
    causalParents: [],
    observedInputs: [],
    timeMs: EXPERIENCE_DURATION_MS + 1,
    admissionIndex: 999,
  };
  const ordinals = readingOrdinals([...items, journal]);
  for (const entry of items) assert.deepEqual(ordinals.get(entry.evidenceId), entry.ordinal, `${entry.evidenceId} renumbered by a post-seal record`);
  assert.equal(ordinals.get("PROBE-AFTER-1")!.compact, "+01");
  // The queue still authors nothing and holds no clock.
  const queue = code(read("experience/presentationQueue.ts"));
  assert.doesNotMatch(queue, /Date\.now|performance\.now|setTimeout|setInterval|Math\.random|fetch\(/);
  assert.doesNotMatch(queue, /appendMissionEvidence|issueFinalMissionReceipt|buildMissionEvidenceClosure|canonicalSignature/);
  // And the pacing clock is still never faster than the engine's own.
  assert.match(read("experience/humanPacing.ts"), /Math\.max\(engineGap, MINIMUM_PRESENTATION_GAP_MS\[moment\.pacing\], reservedByPrevious\)/);
});

// ---------------------------------------------------------------------------
// C-R2-T09 — EN / FR
// ---------------------------------------------------------------------------

test("C-R2-T09: both languages carry the same interaction, pacing and ordinal semantics", () => {
  assert.deepEqual(Object.keys(en.nx).sort(), Object.keys(fr.nx).sort());
  assert.deepEqual(Object.keys(en.nx.reconciliation).sort(), Object.keys(fr.nx.reconciliation).sort());
  assert.deepEqual(Object.keys(en.nx.link).sort(), Object.keys(fr.nx.link).sort());
  // The one string a single click now promises exists in both, and differs.
  assert.ok(en.nx.openReceipt.length > 0 && fr.nx.openReceipt.length > 0);
  assert.notEqual(en.nx.openReceipt, fr.nx.openReceipt);
  // The link's accessible name is translated and names no transport.
  assert.notEqual(en.nx.link.title, fr.nx.link.title);
  assert.notEqual(en.nx.link.aria, fr.nx.link.aria);
  for (const dictionary of [en, fr]) {
    assert.doesNotMatch(dictionary.nx.link.title, /ethernet/i);
    assert.doesNotMatch(dictionary.nx.link.aria, /ethernet/i);
  }
  // The ordinal itself is language-independent: one sequence, two dictionaries.
  const labels = items.map((entry) => entry.ordinal.compact);
  assert.equal(new Set(labels).size, labels.length);
  assert.ok(labels.every((label) => /^\d\d$/.test(label)), "digits, not words to translate");
});

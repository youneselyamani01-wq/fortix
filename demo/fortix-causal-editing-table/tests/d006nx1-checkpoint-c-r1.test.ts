import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { MISSION_ID } from "../app/missionContinuity.ts";
import type { PublicEvidence } from "../app/nx/adapter/publicExperienceAdapter.ts";
import { derivePublicExperience } from "../app/nx/adapter/publicExperienceAdapter.ts";
import { readingOrder, readingOrdinals } from "../app/nx/adapter/readingOrder.ts";
import { readingRows } from "../app/nx/evidence/proofGeometry.ts";
import {
  CLOSURE_HOLD_MS,
  CRITICAL_MOMENTS_MS,
  HUMAN_PRESENTATION_DURATION_MS,
  PACING_SCHEDULE,
  humanPresentationTime,
  naturalDepartureTime,
} from "../app/nx/experience/humanPacing.ts";
import {
  HUMAN_ARRIVAL_FLOOR_MS,
  NX_RECEIPT_FLIGHT_MS,
  RECEIPT_OWNERSHIP_MS,
  minimumArrivalGapMs,
  ownsAttention,
  presentationSlots,
  sameInstantGroups,
  stageAt,
  type PacingClass,
} from "../app/nx/experience/presentationQueue.ts";
import { createOfflineEvidenceSession } from "../app/offlineEvidence.ts";
import {
  buildMissionEvidenceClosure,
  buildPortableMissionEvidenceBundle,
  finalReceiptRuntimeEvidencePrefix,
  issueFinalMissionReceipt,
} from "../app/portableMissionEvidence.ts";
import { projectPortableProofLeaves } from "../app/proofProjection.ts";
import { EXPERIENCE_DURATION_MS, FINAL_RECEIPT_EMITTED_MS, PEB_COMPLETE_MS } from "../app/storyTimeline.ts";
import { canonicalString } from "../app/verification.ts";
import { journalAt } from "../app/nx/adapter/useMissionEngine.ts";
import { modelAt } from "./support/modelAt.ts";

/**
 * D-006 NX1 — CHECKPOINT C-R1: SEQUENTIAL RECEIPT STAGING.
 * C-R1-T01 … C-R1-T12 of the mandate.
 *
 * ONE RECEIPT OWNS THE VIEWER'S ATTENTION AT A TIME.
 *
 * The human review of Checkpoint C found one blocking defect: nano-receipts
 * still appeared in bursts, worst where several share one canonical instant.
 * These tests pin the remedy and, just as importantly, the things the remedy
 * was not allowed to touch — the canonical timeline, the causal relations, the
 * reading order, the ordinal contract and the sealed bytes.
 *
 * THE CORE INVARIANT: PRESENTATION TIME ≠ EVENT TIME. The queue may move the
 * moment a receipt is SHOWN, only ever later than the moment it was RECORDED,
 * and may change nothing else whatsoever.
 */

const NX_ROOT = new URL("../app/nx/", import.meta.url);
const read = (relative: string) => readFileSync(new URL(relative, NX_ROOT), "utf8");
const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const FULL = modelAt(EXPERIENCE_DURATION_MS);
const items = FULL.model.accumulatedEvidence.items;

/** The whole run's queue, exactly as the adapter builds it. */
const slotsOf = (subset: readonly PublicEvidence[]) => presentationSlots(
  subset.map((entry) => ({
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
const slots = slotsOf(items);

/**
 * The run sampled finely enough that no stage can hide between two samples:
 * the step is well under the shortest one (the 200 ms ORDINARY respiration).
 */
const SAMPLE_MS = 25;
const samples = (() => {
  const out: number[] = [];
  for (let at = 0; at <= HUMAN_PRESENTATION_DURATION_MS; at += SAMPLE_MS) out.push(at);
  return out;
})();

// ---------------------------------------------------------------------------
// C-R1-T01 — ONE RECEIPT AT A TIME
// ---------------------------------------------------------------------------

test("C-R1-T01: at no moment of the run is more than one receipt arriving or being read", () => {
  // REVISED AT C-R2. The clause `owners + inFlight <= 1` encoded C-R1's rule
  // that a receipt may not even DEPART until the previous one is fully
  // presented. C-R2 supersedes that deliberately: a flight now overlaps the
  // previous receipt's reading, because a bead crossing the world is
  // peripheral motion and the bead on the band is the thing being read. What
  // may never overlap is READING, and that is asserted here unchanged.
  assert.equal(items.length, 58, "the whole sealed run is under test");
  let maxOwners = 0;
  let maxInFlight = 0;
  let flightOverReading = 0;
  for (const now of samples) {
    const owners = slots.filter((slot) => ownsAttention(slot, now));
    const inFlight = slots.filter((slot) => stageAt(slot, now) === "ARRIVING");
    maxOwners = Math.max(maxOwners, owners.length);
    maxInFlight = Math.max(maxInFlight, inFlight.length);
    if (owners.length === 1 && inFlight.length === 1) flightOverReading += 1;
    assert.ok(owners.length <= 1, `two receipts are being read at once at ${now} ms: ${owners.map((slot) => slot.evidenceId).join(", ")}`);
    assert.ok(inFlight.length <= 1, `two receipts are in flight at once at ${now} ms: ${inFlight.map((slot) => slot.evidenceId).join(", ")}`);
  }
  assert.equal(maxOwners, 1, "and exactly one does own the screen at some point");
  assert.equal(maxInFlight, 1, "and exactly one is in flight at some point");
  assert.ok(flightOverReading > 0, "C-R2: a flight does overlap a reading — that is the time C-R1 was spending");
  // The stages partition the lifecycle: at any moment a receipt is in exactly one.
  for (const slot of slots.slice(0, 12)) {
    for (const now of [slot.releaseMs - 1, slot.releaseMs, slot.landingMs - 1, slot.landingMs, slot.ownedUntilMs, slot.slotEndMs]) {
      const stage = stageAt(slot, now);
      assert.ok(
        ["QUEUED", "ARRIVING", "READING", "SETTLING", "STABILIZING", "RESTING", "PRESENTED"].includes(stage),
        `${slot.evidenceId} at ${now} is in a named stage`,
      );
    }
    assert.equal(stageAt(slot, slot.releaseMs - 1), "QUEUED");
    assert.equal(stageAt(slot, slot.releaseMs), "ARRIVING");
    assert.equal(stageAt(slot, slot.landingMs), "READING");
    assert.equal(stageAt(slot, slot.slotEndMs), "PRESENTED");
  }
});

// ---------------------------------------------------------------------------
// C-R1-T02 — SAME CANONICAL INSTANT, SEPARATE ARRIVALS
// ---------------------------------------------------------------------------

test("C-R1-T02: receipts recorded at one canonical instant are shown one at a time, and still say so", () => {
  const groups = sameInstantGroups();
  assert.equal(groups.length, 3, "the run really does record three pairs at a shared instant");
  const byId = new Map(items.map((entry, index) => [entry.evidenceId, slots[index]!] as const));
  let staged = 0;
  for (const group of groups) {
    const members = items.filter((entry) => entry.timeMs === group.timeMs);
    assert.equal(members.length, 2, `instant ${group.timeMs} carries two receipts`);
    const [first, second] = members.map((entry) => byId.get(entry.evidenceId)!);
    // SERIALISED in presentation time…
    assert.ok(
      second!.landingMs - first!.landingMs >= minimumArrivalGapMs(first!.pacing),
      `instant ${group.timeMs}: the second arrival waits a full floor after the first`,
    );
    // C-R2: it is the LANDING that waits, not the departure — the second may be
    // crossing the world while the first is still being read.
    assert.ok(second!.landingMs >= first!.slotEndMs, "and does not LAND until the first is done being read");
    assert.equal(second!.staging, "SAME_INSTANT", "and the queue records why it waited");
    // …and SIMULTANEOUS in canonical time, unchanged.
    assert.equal(first!.canonicalTimeMs, group.timeMs);
    assert.equal(second!.canonicalTimeMs, group.timeMs);
    assert.equal(members[0]!.timeMs, members[1]!.timeMs, "the two receipts still carry one instant between them");
    assert.equal(first!.deferralMs === 0 || second!.deferralMs > first!.deferralMs, true);
    staged += 1;
  }
  assert.equal(staged, 3, "every same-instant group was staged");
  // The proof's row rule is B R2's and staging did not touch it. Two receipts
  // of one moment share a row only when they are in different lanes and the
  // same episode — a row cannot stack two receipts of one lane, and a chapter
  // cannot straddle a row. Exactly one of this run's three pairs qualifies,
  // and the claim is pinned here so it is never overstated again.
  const rows = readingRows(items);
  const shared = groups.filter((group) => {
    const [left, right] = items.filter((entry) => entry.timeMs === group.timeMs);
    return rows.rowOf.get(left!.evidenceId) === rows.rowOf.get(right!.evidenceId);
  });
  assert.equal(shared.length, 1, "one pair is level on the band; the equal instants of the other two are carried by the receipts");
  for (const group of groups) {
    const [left, right] = items.filter((entry) => entry.timeMs === group.timeMs);
    const level = rows.rowOf.get(left!.evidenceId) === rows.rowOf.get(right!.evidenceId);
    assert.equal(
      level,
      left!.branch !== right!.branch && left!.episode === right!.episode,
      `instant ${group.timeMs}: the row rule decides levelness, not the queue`,
    );
  }
  // The one thing a viewer must not be told is that they happened in sequence:
  // neither of a pair declares the other, so no thread joins them.
  for (const group of groups) {
    const [left, right] = items.filter((entry) => entry.timeMs === group.timeMs);
    const declared = [...left!.causalParents, ...left!.observedInputs, ...right!.causalParents, ...right!.observedInputs];
    assert.ok(
      !declared.includes(left!.evidenceId) || !declared.includes(right!.evidenceId),
      `instant ${group.timeMs}: staging must not have created a relation between the pair`,
    );
  }
});

// ---------------------------------------------------------------------------
// C-R1-T03 — THE FLOORS
// ---------------------------------------------------------------------------

test("C-R1-T03: every arrival gets at least its class floor, and no burst survives", () => {
  const gaps = slots.slice(1).map((slot, index) => slot.landingMs - slots[index]!.landingMs);
  assert.equal(gaps.filter((gap) => gap < HUMAN_ARRIVAL_FLOOR_MS).length, 0, "no gap is under the human arrival floor");
  for (let index = 1; index < slots.length; index += 1) {
    const previous = slots[index - 1]!;
    const gap = slots[index]!.landingMs - previous.landingMs;
    assert.ok(gap >= minimumArrivalGapMs(previous.pacing), `${slots[index]!.evidenceId}: ${gap} ms after a ${previous.pacing} receipt`);
  }
  // Ownership is never below the attachment window: a receipt whose thread is
  // still drawing has not been shown.
  for (const slot of slots) {
    if (slot.canonicalTimeMs >= EXPERIENCE_DURATION_MS) continue;
    assert.ok(slot.ownershipMs >= RECEIPT_OWNERSHIP_MS.ORDINARY.reading, `${slot.evidenceId}: ${slot.ownershipMs} ms of ownership`);
    assert.ok(slot.ownershipMs >= RECEIPT_OWNERSHIP_MS[slot.pacing].reading);
    assert.equal(slot.landingMs - slot.releaseMs, NX_RECEIPT_FLIGHT_MS, "every flight is one flight long");
  }
  // The classes are ordered: a moment that asks more of a viewer gets more.
  const order: readonly PacingClass[] = ["ORDINARY", "IMPORTANT", "CHAPTER", "CRITICAL"];
  for (let index = 1; index < order.length; index += 1) {
    assert.ok(minimumArrivalGapMs(order[index]!) > minimumArrivalGapMs(order[index - 1]!), `${order[index]} outranks ${order[index - 1]}`);
  }
});

// ---------------------------------------------------------------------------
// C-R1-T04 — STAGING IS NOT CAUSATION
// ---------------------------------------------------------------------------

test("C-R1-T04: presentation order never implies causality, and declared causality is never re-ordered", () => {
  const byId = new Map(items.map((entry) => [entry.evidenceId, entry] as const));
  const landing = new Map(items.map((entry, index) => [entry.evidenceId, slots[index]!.landingMs] as const));
  // Consecutive arrivals with NO declared relation are common — 14 of the 57
  // pairs of this run. If arrival order implied causality the picture would be
  // making a false claim about each of them, so they are counted rather than
  // assumed, and every one is checked to carry no thread.
  const unrelated: (readonly [string, string])[] = [];
  for (let index = 1; index < items.length; index += 1) {
    const previous = items[index - 1]!;
    const current = items[index]!;
    const declared = [...current.causalParents, ...current.observedInputs];
    if (!declared.includes(previous.evidenceId)) unrelated.push([previous.evidenceId, current.evidenceId]);
  }
  assert.ok(unrelated.length >= 10, `${unrelated.length} consecutive arrivals declare no relation to the one before`);
  for (const [before, after] of unrelated) {
    const child = byId.get(after)!;
    assert.ok(
      ![...child.causalParents, ...child.observedInputs].includes(before),
      `${before} → ${after}: staged one after the other, and joined by nothing`,
    );
  }
  // The three same-instant pairs are the case the mandate names: shown in
  // sequence, and neither is a declared cause of the other.
  for (const group of sameInstantGroups()) {
    const [left, right] = items.filter((entry) => entry.timeMs === group.timeMs);
    assert.ok(!([...right!.causalParents, ...right!.observedInputs].includes(left!.evidenceId)),
      `instant ${group.timeMs}: the second receipt must not be shown as caused by the first`);
  }
  // Every DECLARED relation still runs forwards in presentation time, so the
  // staging never shows a consequence before its cause.
  let relations = 0;
  for (const entry of items) {
    for (const parentId of new Set([...entry.causalParents, ...entry.observedInputs])) {
      const parent = byId.get(parentId);
      if (parent === undefined) continue;
      relations += 1;
      assert.ok(
        landing.get(parentId)! <= landing.get(entry.evidenceId)!,
        `${parentId} is declared a cause of ${entry.evidenceId} and must not be shown after it`,
      );
      assert.ok(parent.timeMs <= entry.timeMs || landing.get(parentId)! <= landing.get(entry.evidenceId)!);
    }
  }
  assert.ok(relations > 70, `${relations} declared relations checked`);
  // And the queue itself declares nothing: it never writes a parent or an input.
  const queue = code(read("experience/presentationQueue.ts"));
  assert.doesNotMatch(queue, /causalParents|observedInputs/, "the queue cannot author a causal relation");
});

// ---------------------------------------------------------------------------
// C-R1-T05 — ZERO EVIDENTIARY AUTHORITY
// ---------------------------------------------------------------------------

test("C-R1-T05: the queue is presentational only — it authors, signs, admits and verifies nothing", () => {
  const queue = code(read("experience/presentationQueue.ts"));
  assert.doesNotMatch(queue, /Date\.now|performance\.now|setTimeout|setInterval|Math\.random|fetch\(|localStorage/, "no clock, no network, no storage");
  assert.doesNotMatch(
    queue,
    /appendMissionEvidence|appendNetworkTransition|appendOfflineEvidence|reconcileOfflineEvidence|issueFinalMissionReceipt|buildMissionEvidenceClosure|buildPortableMissionEvidenceBundle|canonicalSignature|verifyD006PortableMissionEvidence|applyHumanDecision/,
    "it cannot author evidence, seal, reconcile, sign or verify",
  );
  assert.doesNotMatch(queue, /digest|signature|missionId|runId/i, "no identity or integrity value passes through it");
  assert.doesNotMatch(queue, /from "react"/, "it is not a component");
  // Its only inputs are the engine's own tables and a caller's clock function.
  assert.match(queue, /import \{ MASTER_EVIDENCE_EVENTS \} from "\.\.\/\.\.\/masterStory\.ts"/);
  assert.match(queue, /import \{ MISSION_EVIDENCE_SPECS, specTime \} from "\.\.\/\.\.\/missionEvidence\.ts"/);
  // A slot carries the canonical instant verbatim — it never rewrites one.
  for (let index = 0; index < items.length; index += 1) {
    assert.equal(slots[index]!.canonicalTimeMs, items[index]!.timeMs, `${items[index]!.evidenceId}: the slot carries the recorded instant`);
  }
  // The queue never moves an arrival EARLIER than the moment it was recorded.
  for (const slot of slots) {
    assert.ok(slot.deferralMs >= 0, `${slot.evidenceId}: the queue only ever delays`);
    assert.ok(
      slot.releaseMs >= naturalDepartureTime(slot.canonicalTimeMs) - 0.001,
      `${slot.evidenceId}: released no earlier than its canonical instant`,
    );
  }
});

// ---------------------------------------------------------------------------
// C-R1-T06 — THE CANONICAL TIMELINE IS UNTOUCHED
// ---------------------------------------------------------------------------

test("C-R1-T06: staging changes no canonical instant, no admission order and no digest", () => {
  const RUN_ID = "fortix.demo.d006nx1.run.geometry";
  const session = journalAt(createOfflineEvidenceSession(RUN_ID, null, MISSION_ID), FINAL_RECEIPT_EMITTED_MS);
  const records = finalReceiptRuntimeEvidencePrefix(session);
  const build = () => buildMissionEvidenceClosure({
    identity: { missionId: MISSION_ID, runId: RUN_ID },
    runtimeRecords: records,
    asOfMasterTimeMs: FINAL_RECEIPT_EMITTED_MS,
  });
  const closure = build();
  const receipt = issueFinalMissionReceipt(closure, FINAL_RECEIPT_EMITTED_MS);
  const bundle = buildPortableMissionEvidenceBundle({
    closure,
    finalReceipt: receipt,
    runtimeRecords: records,
    // The engine's own displayed set, not the queue's: the transfer covers what
    // the mission recorded, never what a viewer had been shown so far.
    displayedEvidenceIds: projectPortableProofLeaves(closure, PEB_COMPLETE_MS, receipt).map((leaf) => leaf.evidenceId),
    masterTimeMs: PEB_COMPLETE_MS,
  });
  const digestOf = (value: unknown) => createHash("sha256").update(canonicalString(value)).digest("hex");
  // The sealed objects are what they were: the queue is not an input to any of them.
  assert.equal(digestOf(closure), digestOf(build()), "rebuilding the closure gives the same bytes");
  // The closure of the run actually under test carries every sealed receipt the
  // model shows, and no presentational field reached it.
  const sealed = FULL.snapshot.closure!;
  assert.equal(FULL.model.accumulatedEvidence.sealedCount, 58);
  assert.equal(sealed.members.filter((member) => member.presentation === "PRESENTED").length, 58);
  assert.ok(sealed.members.every((member) => !Object.keys(member).some((key) => /slot|landing|release|staging|ownership|presentationTime/i.test(key))));
  const canonical = canonicalString(bundle);
  for (const forbidden of ["releaseMs", "landingMs", "readingUntilMs", "ownedUntilMs", "slotEndMs", "SAME_INSTANT", "STABILIZING", "RESPIRATION", "presentationQueue"]) {
    assert.ok(!canonical.includes(forbidden), `the portable bundle must not carry "${forbidden}"`);
  }
  // Evidence times at a master time do not depend on the presentation cursor.
  for (const at of [12_500, 48_000, 54_000, 84_250, EXPERIENCE_DURATION_MS]) {
    const early = modelAt(at, humanPresentationTime(at)).model.accumulatedEvidence.items;
    const late = modelAt(at, HUMAN_PRESENTATION_DURATION_MS).model.accumulatedEvidence.items;
    const seen = new Map(late.map((entry) => [entry.evidenceId, entry] as const));
    for (const entry of early) {
      const other = seen.get(entry.evidenceId)!;
      assert.equal(entry.timeMs, other.timeMs, `${entry.evidenceId}: one recorded instant, whatever the viewer has reached`);
      assert.equal(entry.digest, other.digest);
      assert.equal(entry.admissionIndex, other.admissionIndex);
      assert.deepEqual(entry.causalParents, other.causalParents);
    }
  }
  // The engine's own presentation model is untouched: the queue never wrote to it.
  const engine = readFileSync(new URL("../app/masterStory.ts", import.meta.url), "utf8");
  assert.doesNotMatch(engine, /presentationQueue|presentationSlots|RECEIPT_OWNERSHIP_MS/, "the frozen engine module knows nothing of the queue");
});

// ---------------------------------------------------------------------------
// C-R1-T07 — THE ORDINAL CONTRACT IS THE ONE CHECKPOINT C WROTE
// ---------------------------------------------------------------------------

test("C-R1-T07: staging does not change the ordinal derivation contract", () => {
  // The ordinals of the run are exactly those of the reading order, computed
  // as at Checkpoint C over the ADMITTED set — never over the shown set, so
  // holding a receipt back cannot renumber anything.
  const independent = readingOrdinals(readingOrder(items));
  for (const entry of items) {
    assert.deepEqual(entry.ordinal, independent.get(entry.evidenceId), `${entry.evidenceId}: the ordinal is the reading order's`);
  }
  assert.deepEqual(items.map((entry) => entry.ordinal.label).slice(0, 3), ["NR 01", "NR 02", "NR 03"]);
  // Across the run, at many cursors and in both directions, no ordinal moves.
  const seen = new Map<string, string>();
  const cursors = [4_000, 9_000, 12_500, 30_000, 48_000, 54_000, 84_250, 100_000, EXPERIENCE_DURATION_MS];
  for (const at of [...cursors, ...[...cursors].reverse()]) {
    for (const entry of modelAt(at).model.accumulatedEvidence.items) {
      const previous = seen.get(entry.evidenceId);
      if (previous !== undefined) assert.equal(entry.ordinal.label, previous, `${entry.evidenceId}: the number moved at ${at} ms`);
      seen.set(entry.evidenceId, entry.ordinal.label);
    }
  }
  assert.equal(seen.size, 58);
  // The adapter numbers before it stages, and the source says so in that order.
  const adapter = read("adapter/publicExperienceAdapter.ts");
  assert.ok(
    adapter.indexOf("const ordinals = readingOrdinals(read)") < adapter.indexOf("const slots = presentationSlots("),
    "the ordinal is assigned over the admitted reading order, before any staging",
  );
});

// ---------------------------------------------------------------------------
// C-R1-T08 — THE READING ORDER IS UNTOUCHED
// ---------------------------------------------------------------------------

test("C-R1-T08: the shown receipts are always a prefix of the reading order", () => {
  const full = readingOrder(items).map((entry) => entry.evidenceId);
  for (const at of [6_000, 12_500, 24_000, 48_000, 54_000, 90_000, EXPERIENCE_DURATION_MS]) {
    const shown = modelAt(at).model.accumulatedEvidence.items.map((entry) => entry.evidenceId);
    assert.deepEqual(shown, full.slice(0, shown.length), `at ${at} ms the shown receipts are the first ${shown.length} of the reading order`);
  }
  // A slot depends only on the receipts before it, so staging a prefix gives
  // every receipt in it the slot it has in the whole run.
  for (const size of [1, 5, 17, 33, 58]) {
    const partial = slotsOf(items.slice(0, size));
    for (let index = 0; index < size; index += 1) {
      assert.equal(partial[index]!.landingMs, slots[index]!.landingMs, `${items[index]!.evidenceId}: its slot does not depend on what comes after it`);
      assert.equal(partial[index]!.staging, slots[index]!.staging);
    }
  }
});

// ---------------------------------------------------------------------------
// C-R1-T09 — NOTHING IS LOST
// ---------------------------------------------------------------------------

test("C-R1-T09: the queue delays and never withholds — it drains, and by the end everything is settled", () => {
  const admitted = items.length;
  for (const at of [6_000, 12_000, 30_000, 48_000, 84_250, 110_000, EXPERIENCE_DURATION_MS]) {
    const model = modelAt(at).model;
    const parts = model.accumulatedEvidence.count + model.presentation.arrivingCount + model.presentation.queuedCount;
    const engineAdmitted = modelAt(at, HUMAN_PRESENTATION_DURATION_MS).model.accumulatedEvidence.count;
    assert.equal(parts, engineAdmitted, `at ${at} ms every admitted receipt is landed, in flight or queued`);
    assert.ok(model.presentation.deferralMs >= 0);
  }
  const end = modelAt(EXPERIENCE_DURATION_MS).model;
  assert.equal(end.accumulatedEvidence.count, admitted, "the whole run is shown by the end");
  assert.equal(end.presentation.queuedCount, 0, "and nothing is left waiting");
  assert.equal(end.presentation.arrivingCount, 0);
  assert.ok(end.accumulatedEvidence.items.every((entry) => entry.phase === "SETTLED"), "every receipt has settled");
  // The last slot of the run closes before the presentation does: the schedule
  // reserves the queue the room it needs rather than letting it overrun.
  assert.ok(slots.at(-1)!.slotEndMs <= HUMAN_PRESENTATION_DURATION_MS, "the queue finishes inside the run");
  // Deferral stays bounded — the picture never falls a chapter behind the world.
  assert.ok(Math.max(...slots.map((slot) => slot.deferralMs)) < 4_000, "no receipt waits more than a few seconds for its turn");
});

// ---------------------------------------------------------------------------
// C-R1-T10 — NO ARRIVAL BEGINS BEFORE THE ONE BEFORE IT IS COMPLETE
// ---------------------------------------------------------------------------

test("C-R1-T10: no receipt begins its arrival before the previous has reached a completed presentation state", () => {
  // SUPERSEDED AT C-R2, and kept here so the change is on the record rather
  // than deleted. As written this test required the DEPARTURE to wait for the
  // previous receipt's whole presentation. That is what made the run 140 s:
  // each of 58 flights was dead time no other receipt could use. C-R2 requires
  // the LANDING to wait instead, which protects exactly the thing that matters
  // — no viewer is ever asked to read two receipts at once — and lets a bead
  // cross the world while the previous one is being read.
  for (let index = 1; index < slots.length; index += 1) {
    const previous = slots[index - 1]!;
    const current = slots[index]!;
    if (current.canonicalTimeMs >= EXPERIENCE_DURATION_MS) continue;
    assert.ok(
      current.landingMs >= previous.ownedUntilMs,
      `${current.evidenceId} lands before ${previous.evidenceId} has finished being read`,
    );
    assert.ok(
      current.landingMs >= previous.slotEndMs,
      `${current.evidenceId} lands before ${previous.evidenceId} has had its beat of silence`,
    );
    // And the departure is still never earlier than the previous LANDING, so
    // two receipts are never in flight together.
    assert.ok(
      current.releaseMs >= previous.landingMs,
      `${current.evidenceId} departs while ${previous.evidenceId} is still crossing`,
    );
    // The five stages run in order and none is skipped.
    assert.ok(previous.releaseMs < previous.landingMs, "A: the arrival takes time");
    assert.ok(previous.landingMs <= previous.readingUntilMs, "B: the reading hold follows the landing");
    assert.ok(previous.landingMs <= previous.settledAtMs, "C: the settlement follows the landing");
    assert.ok(previous.ownedUntilMs >= previous.readingUntilMs && previous.ownedUntilMs >= previous.settledAtMs, "D: ownership ends after both");
    assert.ok(previous.slotEndMs > previous.ownedUntilMs, "E: a respiration follows");
  }
});

// ---------------------------------------------------------------------------
// C-R1-T11 — INTERACTION IS NEVER BLOCKED BY STAGING
// ---------------------------------------------------------------------------

test("C-R1-T11: staging never gates interaction, and interaction never re-stages the run", () => {
  // The proof band offers no disabled state, no blocking overlay and no
  // pointer-events refusal keyed on an arrival: the queue paces the picture,
  // it does not take the controls away.
  const proof = code(read("evidence/ProvenanceProof.tsx"));
  assert.doesNotMatch(proof, /disabled=\{[^}]*(owning|presentation|slot|arriv)/i, "no control is disabled because a receipt is arriving");
  assert.doesNotMatch(proof, /preventDefault\(\)[^}]*owning/, "no interaction is swallowed during an arrival");
  // Selecting a receipt reads the model and cannot move a slot: the component
  // is given the staged model and holds no queue of its own.
  assert.doesNotMatch(proof, /presentationSlots|stageAt\(|RECEIPT_OWNERSHIP_MS/, "the band never re-stages what the adapter staged");
  // A seek is deterministic: the same cursor gives byte-identical staging, so
  // interacting and returning to a moment shows exactly what it showed before.
  const shape = (at: number, cursor: number) => modelAt(at, cursor).model.accumulatedEvidence.items
    .map((entry) => [entry.evidenceId, entry.ordinal.label, entry.presentation, Math.round(entry.slot.landingMs), entry.owning]);
  for (const at of [12_500, 48_000, 84_250]) {
    const cursor = humanPresentationTime(at);
    assert.deepEqual(shape(at, cursor), shape(at, cursor), "the same cursor stages the same way");
    // And a later cursor at the same master time only ever shows MORE.
    const later = modelAt(at, cursor + 5_000).model.accumulatedEvidence.count;
    assert.ok(later >= modelAt(at, cursor).model.accumulatedEvidence.count, `at ${at} ms waiting never removes a receipt`);
  }
  // The playback runtime clamps its cursor to the master time the review rules
  // allowed, so a paused authority boundary stops the picture as well.
  const runtime = code(read("adapter/useMissionEngine.ts"));
  assert.match(runtime, /setPresentationTime\(masterTime === proposed \? presentation : humanPresentationTimeAtRest\(masterTime\)\)/);
  assert.match(runtime, /setPresentationTime\(humanPresentationTime\(constrained\)\)/, "a seek re-derives the cursor from the master time");
});

// ---------------------------------------------------------------------------
// C-R1-T12 — THE SCHEDULE RESERVES WHAT THE QUEUE NEEDS
// ---------------------------------------------------------------------------

test("C-R1-T12: the pacing model gives every canonical moment the room its own receipts need", () => {
  // Every segment is at least as long as the reservation of the moment it left,
  // which is what keeps the queue from falling behind the world.
  assert.ok(PACING_SCHEDULE.length > 0);
  assert.ok(PACING_SCHEDULE.some((segment) => segment.arrivals > 1), "some moment really does carry more than one arrival");
  let master = 0;
  let presentation = 0;
  for (const segment of PACING_SCHEDULE) {
    assert.equal(segment.masterFromMs, master, "no gap in master time");
    assert.equal(segment.presentationFromMs, presentation, "no gap in presentation time");
    master = segment.masterToMs;
    presentation = segment.presentationToMs;
  }
  assert.equal(master, EXPERIENCE_DURATION_MS);
  assert.equal(presentation, HUMAN_PRESENTATION_DURATION_MS);
  // A moment carrying two receipts is followed by enough presentation time for
  // both, so the second lands before the next moment's evidence is due.
  const byId = new Map(items.map((entry, index) => [entry.evidenceId, slots[index]!] as const));
  for (const group of sameInstantGroups()) {
    const members = items.filter((entry) => entry.timeMs === group.timeMs).map((entry) => byId.get(entry.evidenceId)!);
    const next = items.find((entry) => entry.timeMs > group.timeMs);
    if (next === undefined) continue;
    assert.ok(
      members.at(-1)!.landingMs <= byId.get(next.evidenceId)!.landingMs,
      `instant ${group.timeMs}: its second receipt is shown before the next moment's`,
    );
  }
  // C-R2: the run is materially shorter than C-R1's 140 s and still unhurried.
  assert.ok(HUMAN_PRESENTATION_DURATION_MS < 140_000, "C-R2 shortened the run");
  assert.ok(HUMAN_PRESENTATION_DURATION_MS > 90_000, "without hurrying it");
  assert.equal(PACING_SCHEDULE.filter((segment) => segment.hold).length, CRITICAL_MOMENTS_MS.length);
  // C-R2-F06 — A HOLD IS AS LONG AS WHAT ARRIVES IN IT. Where evidence lands,
  // the hold is one arrival long, so it can arrive and be read while the world
  // is still. Where nothing lands, it is a closure beat: long enough to feel
  // the moment, and no longer. The ending used to be made of full holds with
  // nothing in them.
  const holds = PACING_SCHEDULE.filter((entry) => entry.hold);
  for (const segment of holds) {
    const length = segment.presentationToMs - segment.presentationFromMs;
    const carriesAnArrival = length >= minimumArrivalGapMs("CRITICAL") + NX_RECEIPT_FLIGHT_MS;
    assert.ok(
      carriesAnArrival || length === CLOSURE_HOLD_MS,
      `the hold at ${segment.masterFromMs} ms is either an arrival or a closure beat: ${length} ms`,
    );
  }
  assert.ok(holds.some((segment) => segment.presentationToMs - segment.presentationFromMs === CLOSURE_HOLD_MS), "the ending was trimmed");
  assert.ok(holds.some((segment) => segment.presentationToMs - segment.presentationFromMs > CLOSURE_HOLD_MS), "and the moments that carry evidence were not");
  // The adapter is the only place the two are joined, and it joins them read-only.
  const adapter = code(read("adapter/publicExperienceAdapter.ts"));
  assert.match(adapter, /presentationSlots\(/);
  assert.doesNotMatch(adapter, /PACING_SCHEDULE\s*\[/, "the adapter reads the clock through its functions, never the segments");
  assert.equal(typeof derivePublicExperience, "function");
});

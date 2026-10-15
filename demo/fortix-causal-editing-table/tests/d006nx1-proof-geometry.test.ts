import assert from "node:assert/strict";
import test from "node:test";

import type { PublicEvidence } from "../app/nx/adapter/publicExperienceAdapter.ts";
import {
  HIT_AREA_PX,
  MAX_BEAD_PX,
  MAX_PITCH_PX,
  MIN_BEAD_PX,
  MIN_EPISODE_GAP_PX,
  MIN_GUTTER_PX,
  MIN_PITCH_PX,
  READABILITY_FLOORS,
  causalLevels,
  focusSets,
  layoutProof,
  readingRows,
  relationsOf,
} from "../app/nx/evidence/proofGeometry.ts";
import { EXPERIENCE_DURATION_MS, FINAL_RECEIPT_EMITTED_MS } from "../app/storyTimeline.ts";
import { modelAt } from "./support/modelAt.ts";

/**
 * D-006 NX1 — Checkpoint B R1 §21–§23 kept, Checkpoint B R2 §26–§27 added:
 * complete visibility, causal accuracy, readability floors and the recorded
 * fallback. The geometry is a pure function of the adapter's model and the
 * band's size; every assertion is made against the real dataset. The model
 * fixture (`modelAt`) lives in tests/support so the suites that share it do
 * not re-run this file's tests by importing it.
 */

const FULL = modelAt(EXPERIENCE_DURATION_MS);
const items = FULL.model.accumulatedEvidence.items;
const branches = FULL.model.accumulatedEvidence.branches;
const layoutAt = (widthPx: number, heightPx: number, subset: readonly PublicEvidence[] = items) =>
  layoutProof({ items: subset, branches, finalReceipt: FULL.model.finalReceipt !== null, widthPx, heightPx });
/** Band sizes a review desk offers: the two target viewports, a narrow one, a tall one. */
const BANDS: readonly (readonly [number, number, string])[] = [[1280, 560, "1440 × 900"], [1180, 425, "1280 × 720"], [980, 330, "narrow"], [1280, 1400, "tall"]];

// ---------------------------------------------------------------------------
// §21 — COMPLETE VISIBILITY (B R1, kept)
// ---------------------------------------------------------------------------

test("B R1 §21: every admitted nano-receipt has exactly one bead, every bead is an admitted nano-receipt, nothing is omitted", () => {
  const presented = new Set(FULL.snapshot.closure!.members.filter((member) => member.presentation === "PRESENTED").map((member) => member.evidenceId));
  const layout = layoutAt(1280, 560);
  const beadIds = layout.beads.map((bead) => bead.evidenceId);
  assert.equal(beadIds.length, items.length, "one bead per nano-receipt");
  assert.equal(new Set(beadIds).size, beadIds.length, "no duplicate bead");
  assert.deepEqual([...beadIds].sort(), [...presented].sort(), "the beads are exactly the admitted nano-receipts");
  assert.ok(items.length > 50, `the dataset is complete: ${items.length}`);
  assert.ok(FULL.model.finalReceipt !== null);
  assert.equal(beadIds.includes(FULL.model.finalReceipt.receiptId), false, "the Final Receipt is not a bead");
  assert.equal(beadIds.some((id) => id.startsWith("fortix:peb:")), false, "the PEB is not a bead");
  assert.equal(FULL.model.accumulatedEvidence.count, presented.size, "the count is the nano-receipt count");
  for (const at of [12_500, 30_000, 60_000, 90_000, FINAL_RECEIPT_EMITTED_MS + 1_500]) {
    const then = modelAt(at);
    const laid = layoutProof({ items: then.model.accumulatedEvidence.items, branches: then.model.accumulatedEvidence.branches, finalReceipt: then.model.finalReceipt !== null, widthPx: 1280, heightPx: 560 });
    assert.equal(laid.beads.length, then.model.accumulatedEvidence.items.length, `at ${at}`);
    assert.ok(laid.beads.every((bead) => bead.y > 0 && bead.y <= laid.contentHeight), `at ${at} every bead is inside the drawn field`);
  }
});

test("B R1 §21: the geometry derives from the actual counts, never from a constant", () => {
  const half = items.slice(0, Math.floor(items.length / 2));
  const full = layoutAt(1280, 560);
  const smaller = layoutAt(1280, 560, half);
  assert.ok(smaller.rows < full.rows, "fewer nano-receipts, fewer rows");
  assert.ok(smaller.pitch >= full.pitch, "fewer rows, no tighter pitch");
  assert.equal(smaller.beads.length, half.length);
  const twoLanes = layoutProof({ items: items.filter((entry) => entry.branch === "vehicle" || entry.branch === "city"), branches: ["city", "vehicle"], finalReceipt: false, widthPx: 1200, heightPx: 400 });
  assert.equal(twoLanes.columns, 2);
  for (const bead of twoLanes.beads) {
    const column = bead.branch === "city" ? 0 : 1;
    assert.equal(bead.x, twoLanes.gutter + (column + 0.5) * twoLanes.laneWidth, "a bead sits at its lane's centre");
  }
});

// ---------------------------------------------------------------------------
// §26 — CAUSAL ACCURACY (B R1 §22 kept and extended)
// ---------------------------------------------------------------------------

test("B R2 §26: every thread is a declared parent relation, every declared present relation is a thread, lanes are respected, order alone draws nothing", () => {
  const relations = relationsOf(items);
  const layout = layoutAt(1280, 560);
  assert.equal(layout.threads.length, relations.length, "one thread per declared relation with both ends present");
  const byId = new Map(items.map((entry) => [entry.evidenceId, entry] as const));
  const declared = new Set<string>();
  for (const entry of items) for (const parent of [...entry.causalParents, ...entry.observedInputs]) if (byId.has(parent)) declared.add(`${parent}->${entry.evidenceId}`);
  for (const thread of layout.threads) {
    assert.ok(declared.has(`${thread.parent}->${thread.child}`), `${thread.key} is declared by the child`);
    const parent = byId.get(thread.parent)!;
    const child = byId.get(thread.child)!;
    assert.equal(thread.crossLane, parent.branch !== child.branch, "cross-lane threads cross lanes, same-lane threads stay in the lane");
    assert.ok(parent.timeMs <= child.timeMs, "a thread never runs backwards in time");
  }
  assert.equal(new Set(layout.threads.map((thread) => `${thread.parent}->${thread.child}`)).size, layout.threads.length, "no duplicate thread");
  assert.deepEqual([...declared].sort(), layout.threads.map((thread) => `${thread.parent}->${thread.child}`).sort(), "no declared presented relation is silently omitted, no decorative edge is added");
  assert.ok(layout.crossLaneThreads > 0 && layout.sameLaneThreads > 0, `both kinds exist: ${layout.crossLaneThreads} cross, ${layout.sameLaneThreads} same`);
  assert.equal(layout.crossLaneThreads + layout.sameLaneThreads, layout.threads.length);
  // Geometry: a parent is always above its child; same-lane threads are vertical, cross-lane threads reach the parent's column.
  const at = new Map(layout.beads.map((bead) => [bead.evidenceId, bead] as const));
  for (const thread of layout.threads) {
    const from = at.get(thread.parent)!;
    const to = at.get(thread.child)!;
    assert.ok(from.row < to.row, `${thread.key}: parent row ${from.row} above child row ${to.row}`);
    assert.ok(from.y < to.y);
    if (!thread.crossLane) { assert.equal(from.branch, to.branch); assert.equal(from.x, to.x); }
    assert.ok(thread.d.startsWith(`M ${from.x} ${from.y}`) && thread.d.endsWith(`${to.x} ${to.y}`), "the path runs from the parent's position to the child's");
  }
  // ORDER ≠ CAUSALITY: consecutive receipts of the reading order without a declared relation get no thread.
  const drawn = new Set(layout.threads.map((thread) => `${thread.parent}->${thread.child}`));
  const order = readingRows(items).order;
  let adjacentUnrelated = 0;
  for (let index = 1; index < order.length; index += 1) {
    const key = `${order[index - 1]}->${order[index]}`;
    if (declared.has(key)) continue;
    adjacentUnrelated += 1;
    assert.equal(drawn.has(key), false, `${key}: chronological proximity is not causality`);
  }
  assert.ok(adjacentUnrelated > 0, "the dataset has consecutive receipts that are not parent and child");
  // A cross-provenance relation connects the correct lanes: the city's yellow light, perceived by the vehicle.
  const crossing = layout.threads.find((thread) => thread.parent === "NR-SIGNAL-STATE:yellow" && thread.child === "NR-PERCEPTION:yellow")!;
  assert.ok(crossing !== undefined && crossing.crossLane && crossing.kind === "observed");
  assert.equal(at.get(crossing.parent)!.branch, "city");
  assert.equal(at.get(crossing.child)!.branch, "vehicle");
  assert.equal(at.get(crossing.parent)!.x, layout.gutter + (branches.indexOf("city") + 0.5) * layout.laneWidth);
  assert.equal(at.get(crossing.child)!.x, layout.gutter + (branches.indexOf("vehicle") + 0.5) * layout.laneWidth);
});

test("B R2 §26: the selected chain is the exact ancestry and the exact consequences; replay never duplicates a thread", () => {
  for (const at of [20_000, 60_000, 20_000, EXPERIENCE_DURATION_MS, 60_000]) {
    const then = modelAt(at);
    const laid = layoutProof({ items: then.model.accumulatedEvidence.items, branches: then.model.accumulatedEvidence.branches, finalReceipt: then.model.finalReceipt !== null, widthPx: 1280, heightPx: 560 });
    assert.equal(new Set(laid.threads.map((thread) => thread.key)).size, laid.threads.length, `at ${at}`);
    assert.equal(laid.threads.length, relationsOf(then.model.accumulatedEvidence.items).length, `at ${at}`);
  }
  const focus = focusSets(items, "NR-ACTION:brake");
  assert.ok(focus.ancestors.has("NR-DECISION:stop"), "the decision caused the brake");
  assert.ok(focus.ancestors.has("NR-PERCEPTION:yellow"), "the perception caused the decision");
  assert.ok(focus.ancestors.has("NR-SIGNAL-STATE:yellow"), "the city's light was the observed input of the perception");
  assert.ok(focus.descendants.has("NR-RESULT:at-rest"), "the stop followed from the brake");
  assert.equal(focus.ancestors.has("NR-ACTION:brake"), false);
  assert.equal(focus.descendants.has("NR-DECISION:stop"), false);
  // Exactness: the sets equal a transitive closure computed independently.
  const byId = new Map(items.map((entry) => [entry.evidenceId, entry] as const));
  const parentsOf = (id: string) => [...byId.get(id)!.causalParents, ...byId.get(id)!.observedInputs].filter((parent) => byId.has(parent));
  const expectedUp = new Set<string>();
  const walkUp = (id: string) => { for (const parent of parentsOf(id)) if (!expectedUp.has(parent)) { expectedUp.add(parent); walkUp(parent); } };
  walkUp("NR-ACTION:brake");
  assert.deepEqual([...focus.ancestors].sort(), [...expectedUp].sort(), "the ancestry is exact");
  const expectedDown = new Set<string>();
  const walkDown = (id: string) => { for (const entry of items) if (parentsOf(entry.evidenceId).includes(id) && !expectedDown.has(entry.evidenceId)) { expectedDown.add(entry.evidenceId); walkDown(entry.evidenceId); } };
  walkDown("NR-ACTION:brake");
  assert.deepEqual([...focus.descendants].sort(), [...expectedDown].sort(), "the consequences are exact");
  assert.deepEqual(focusSets(items, null), { ancestors: new Set(), descendants: new Set() });
});

// ---------------------------------------------------------------------------
// §27 — READABILITY FLOORS AND THE RECORDED FALLBACK
// ---------------------------------------------------------------------------

test("B R2 §27: the floors hold at every band; the geometry never shrinks below them to fit, it records the fallback instead", () => {
  assert.deepEqual(READABILITY_FLOORS, { beadPx: MIN_BEAD_PX, hitAreaPx: HIT_AREA_PX, pitchPx: MIN_PITCH_PX, gutterPx: MIN_GUTTER_PX, episodeGapPx: MIN_EPISODE_GAP_PX, laneLabelRem: 0.56, episodeLabelRem: 0.6, threadStrokePx: 0.8, threadOpacity: 0.2, finalReceiptPx: 28 });
  assert.ok(MIN_BEAD_PX >= 8 && MIN_PITCH_PX >= 12 && HIT_AREA_PX >= 20 && MIN_PITCH_PX >= MIN_BEAD_PX + 4, "the floors are readable: an 8 px bubble, 4 px of air between bubbles, a 20 px target");
  for (const [widthPx, heightPx, label] of BANDS) {
    const layout = layoutAt(widthPx, heightPx);
    assert.ok(layout.pitch >= MIN_PITCH_PX && layout.pitch <= MAX_PITCH_PX, `${label}: pitch ${layout.pitch}`);
    assert.ok(layout.bead >= MIN_BEAD_PX && layout.bead <= MAX_BEAD_PX, `${label}: bead ${layout.bead}`);
    assert.ok(layout.gutter >= MIN_GUTTER_PX, `${label}: gutter ${layout.gutter}`);
    assert.ok(layout.episodeGap >= MIN_EPISODE_GAP_PX, `${label}: episode gap ${layout.episodeGap}`);
    assert.equal(layout.beads.length, items.length, `${label}: every bead represented`);
    assert.ok(layout.finalY !== null && layout.finalY < layout.contentHeight, `${label}: the Final Receipt is inside the picture`);
    for (const bead of layout.beads) assert.ok(bead.y < layout.finalY!, `${label}: every sealed bead sits above the Final Receipt`);
    if (layout.contentHeight <= layout.fieldHeight) assert.equal(layout.fit, "fit", `${label}: fits`);
    else { assert.equal(layout.fit, "scroll", `${label}: the fallback is recorded, never silent`); assert.equal(layout.pitch, MIN_PITCH_PX, `${label}: under the fallback the pitch is exactly the floor`); }
  }
  // A tall band uses the room: the pitch grows toward its ceiling and the picture fits.
  const tall = layoutAt(1280, 1400);
  assert.equal(tall.fit, "fit");
  assert.ok(tall.pitch > MIN_PITCH_PX && tall.bead > MIN_BEAD_PX, `a tall band grows the pitch (${tall.pitch}) and the bead (${tall.bead})`);
  // The floors are what makes the fallback necessary on the two target bands: the pitch that would fit is below the floor.
  for (const [widthPx, heightPx, label, share] of [[...BANDS[0]!, 0.6], [...BANDS[1]!, 0.45]] as const) {
    const desk = layoutAt(widthPx, heightPx);
    const overhead = desk.contentHeight - desk.rows * desk.pitch;
    const pitchThatWouldFit = (desk.fieldHeight - overhead) / desk.rows;
    assert.ok(pitchThatWouldFit < MIN_PITCH_PX, `${label}: fitting would need a ${pitchThatWouldFit.toFixed(1)} px pitch, below the ${MIN_PITCH_PX} px floor`);
    assert.equal(desk.fit, "scroll", `${label}: the fallback, recorded`);
    assert.ok(desk.fieldHeight / desk.contentHeight >= share, `${label}: a large share of the story is in view at once (${desk.fieldHeight} of ${desk.contentHeight} px)`);
  }
});

test("B R2 §17/§18: the Final Receipt gathers only actual causal inputs — the last sealed bead of each lane, every one an input of the receipt", () => {
  const layout = layoutAt(1280, 560);
  const inputs = new Set(FULL.model.finalReceipt!.causalInputEvidenceIds);
  assert.equal(layout.anchors.length, branches.length, "one anchor per fed lane");
  const at = new Map(layout.beads.map((bead) => [bead.evidenceId, bead] as const));
  for (const anchor of layout.anchors) {
    assert.ok(inputs.has(anchor.evidenceId), `${anchor.evidenceId} is a causal input of the Final Receipt`);
    const lastInLane = layout.beads.filter((bead) => bead.branch === anchor.branch && bead.zone === "closure").sort((left, right) => right.rank - left.rank)[0]!;
    assert.equal(anchor.evidenceId, lastInLane.evidenceId, `${anchor.branch}: the anchor is the lane's last sealed bead`);
    assert.equal(anchor.y, at.get(anchor.evidenceId)!.y);
  }
  assert.ok(layout.compileY !== null && layout.finalY !== null && layout.compileY < layout.finalY, "the compilation rail sits between the last row and the capsule");
  assert.ok(layout.compileY > Math.max(...layout.beads.map((bead) => bead.y)), "the rail is below every sealed bead: the receipt is not another event in the chronology");
});

test("B R1 §17 / B R2 §19: records appended after the seal sit below the Final Receipt, in their own zone, and never rescale the sealed mission", () => {
  const postSeal = (index: number): PublicEvidence => ({
    ...items[items.length - 1]!, evidenceId: `PROBE-POST-SEAL-${index}`, eventId: `probe-${index}`, eventType: "RECONCILIATION_RECEIPT",
    branch: "network", standing: "JOURNAL", causalParents: [], observedInputs: [], timeMs: EXPERIENCE_DURATION_MS + index, episode: "network", actionFamily: "network", admissionIndex: 900 + index,
  });
  const layout = layoutProof({ items: [...items, postSeal(0)], branches: [...branches, "network"], finalReceipt: true, widthPx: 1280, heightPx: 560 });
  const placed = layout.beads.find((bead) => bead.evidenceId === "PROBE-POST-SEAL-0")!;
  assert.equal(placed.zone, "journal");
  assert.ok(layout.finalY !== null && placed.y > layout.finalY, "the post-seal record is below the Final Receipt");
  assert.ok(layout.postSealY !== null && placed.y > layout.postSealY, "and inside the post-seal zone");
  assert.equal(layout.journalRows, 1);
  for (const bead of layout.beads) if (bead.zone === "closure") assert.ok(bead.y < layout.finalY!);
  // The sealed field keeps exactly its geometry, at every band — including the
  // tall bands where the pitch is above its floor and could otherwise shrink.
  for (const [widthPx, heightPx, label] of [[1280, 560, "the review desk (pitch at the floor)"], [1280, 1330, "a tall band (pitch above the floor)"], [1280, 1000, "a tall band"]] as const) {
    const sealedOnly = layoutAt(widthPx, heightPx);
    for (const records of [1, 2, 3, 4]) {
      const withJournal = layoutProof({ items: [...items, ...Array.from({ length: records }, (_, index) => postSeal(index))], branches: [...branches, "network"], finalReceipt: true, widthPx, heightPx });
      assert.equal(withJournal.pitch, sealedOnly.pitch, `${label}: ${records} post-seal record(s) keep the sealed pitch`);
      assert.equal(withJournal.bead, sealedOnly.bead, `${label}: and the bead diameter`);
      assert.deepEqual(
        withJournal.beads.filter((bead) => bead.zone === "closure").map((bead) => [bead.evidenceId, bead.row, bead.y]),
        sealedOnly.beads.map((bead) => [bead.evidenceId, bead.row, bead.y]),
        `${label}: and every sealed bead's row and position`,
      );
      assert.equal(withJournal.finalY, sealedOnly.finalY, `${label}: and the Final Receipt's place`);
      assert.equal(withJournal.journalRows, records);
    }
  }
  // The structure measurement still reads the causal depth for the record.
  assert.ok(Math.max(...causalLevels(items).values()) >= 20);
});

test("B R2 §16/§26: a same-lane thread never runs through an unrelated receipt of its lane", () => {
  for (const [widthPx, heightPx, label] of BANDS) {
    const layout = layoutAt(widthPx, heightPx);
    const at = new Map(layout.beads.map((bead) => [bead.evidenceId, bead] as const));
    const byLane = new Map<string, typeof layout.beads>();
    for (const bead of layout.beads) byLane.set(bead.branch, [...(byLane.get(bead.branch) ?? []), bead]);
    let bowed = 0;
    for (const thread of layout.threads) {
      if (thread.crossLane) continue;
      const from = at.get(thread.parent)!;
      const to = at.get(thread.child)!;
      const between = (byLane.get(from.branch) ?? []).filter((other) => other.evidenceId !== from.evidenceId && other.evidenceId !== to.evidenceId && other.y > from.y && other.y < to.y);
      if (between.length === 0) {
        assert.ok(thread.d.startsWith("M ") && thread.d.includes(" L "), `${label}: ${thread.key} runs straight between neighbours`);
      } else {
        bowed += 1;
        assert.ok(thread.d.includes(" C "), `${label}: ${thread.key} spans ${between.length} other receipt(s) of its lane and must bow aside`);
        const control = Number(thread.d.split(" C ")[1]!.split(" ")[0]);
        assert.ok(Math.abs(control - from.x) >= layout.bead + 6, `${label}: ${thread.key} bows clear of the bubbles it passes`);
      }
    }
    assert.ok(bowed > 0, `${label}: the dataset has same-lane threads that span other receipts (${bowed})`);
  }
});

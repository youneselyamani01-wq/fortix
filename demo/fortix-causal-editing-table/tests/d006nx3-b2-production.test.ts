import assert from "node:assert/strict";
import test from "node:test";

import type { PublicEvidence } from "../app/nx/adapter/publicExperienceAdapter.ts";
import { HIT_AREA_PX, MIN_BEAD_PX, MIN_GUTTER_PX, MIN_PITCH_PX, layoutProof, relationsOf } from "../app/nx/evidence/proofGeometry.ts";
import {
  MAX_BEAD_B2_PX,
  MAX_PITCH_B2_PX,
  MIN_FAN_STEP_PX,
  READABILITY_FLOORS_B2,
  bandsOf,
  chapterRows,
  lanesOf,
  layoutProofB2,
} from "../app/nx/evidence/proofGeometryB2.ts";
import { canonicalGraph } from "../app/nx/gate2/canonicalGraph.ts";
import { EXPERIENCE_DURATION_MS, FINAL_RECEIPT_EMITTED_MS } from "../app/storyTimeline.ts";
import { modelAt } from "./support/modelAt.ts";

/**
 * D-006/NX3 — B2 IN PRODUCTION (mandate §6–§8, tests 1–5).
 *
 * The production proof band now lays the mission out by CAUSAL DEPTH along
 * the horizontal axis and by provenance band along the vertical one. These
 * tests hold the geometry to the same standard Gate 1 and Gate 2 set: every
 * placement derives from the declared relations of the evidence, the reading
 * ordinal is a label and never a coordinate, no relation is added or dropped,
 * and the readability floors hold at every band a review desk offers — with
 * the fallback recorded as a HORIZONTAL scroll, never silent.
 */

const FULL = modelAt(EXPERIENCE_DURATION_MS);
const items = FULL.model.accumulatedEvidence.items;
const branches = FULL.model.accumulatedEvidence.branches;
const byOrdinal = new Map(items.map((entry) => [entry.ordinal.index, entry] as const));
const layoutAt = (widthPx: number, heightPx: number, subset: readonly PublicEvidence[] = items) =>
  layoutProofB2({ items: subset, branches, finalReceipt: FULL.model.finalReceipt !== null, widthPx, heightPx });
/** The mandate's two bands, then the review desk's, a narrow one and a tall one. */
const BANDS: readonly (readonly [number, number, string])[] = [
  [1200, 520, "1200 × 520 (nominal)"],
  [1440, 900, "1440 × 900"],
  [1280, 560, "review desk"],
  [1180, 425, "1280 × 720"],
  [980, 600, "980 × 600"],
  [980, 330, "narrow"],
  [1280, 1400, "tall"],
];

/**
 * Points along a thread's path, evenly by arc length, so two routes can be
 * compared numerically. Reads absolute `M`, `L` and `C` commands — a same-lane
 * thread is one cubic, a cross-lane thread a lead, two rounded corners, a run
 * and a tail — independently of the geometry under test.
 */
function samplePath(d: string, count = 48): readonly (readonly [number, number])[] {
  type Segment = Readonly<{ kind: "L" | "C"; p: readonly number[] }>;
  const tokens = d.match(/[MLC]|-?\d+(?:\.\d+)?/g) ?? [];
  const segments: Segment[] = [];
  let cursor: readonly [number, number] = [0, 0];
  let index = 0;
  const take = (n: number) => { const out: number[] = []; for (let k = 0; k < n; k += 1) out.push(Number(tokens[index++])); return out; };
  while (index < tokens.length) {
    const command = tokens[index++]!;
    if (command === "M") { const [x, y] = take(2); cursor = [x!, y!]; }
    else if (command === "L") { const [x, y] = take(2); segments.push({ kind: "L", p: [...cursor, x!, y!] }); cursor = [x!, y!]; }
    else if (command === "C") { const [x1, y1, x2, y2, x, y] = take(6); segments.push({ kind: "C", p: [...cursor, x1!, y1!, x2!, y2!, x!, y!] }); cursor = [x!, y!]; }
    else throw new Error(`unsupported path token ${command} in ${d}`);
  }
  const at = (segment: Segment, t: number): readonly [number, number] => {
    const u = 1 - t;
    const [x0, y0] = segment.p;
    if (segment.kind === "L") return [x0! + (segment.p[2]! - x0!) * t, y0! + (segment.p[3]! - y0!) * t];
    const [, , x1, y1, x2, y2, x3, y3] = segment.p;
    return [
      u * u * u * x0! + 3 * u * u * t * x1! + 3 * u * t * t * x2! + t * t * t * x3!,
      u * u * u * y0! + 3 * u * u * t * y1! + 3 * u * t * t * y2! + t * t * t * y3!,
    ];
  };
  const lengths = segments.map((segment) => {
    let length = 0;
    let previous = at(segment, 0);
    for (let k = 1; k <= 16; k += 1) { const point = at(segment, k / 16); length += Math.hypot(point[0] - previous[0], point[1] - previous[1]); previous = point; }
    return length;
  });
  const total = lengths.reduce((sum, length) => sum + length, 0);
  const points: (readonly [number, number])[] = [];
  for (let i = 0; i <= count; i += 1) {
    let target = (i / count) * total;
    let which = 0;
    while (which < segments.length - 1 && target > lengths[which]!) { target -= lengths[which]!; which += 1; }
    const segment = segments[which]!;
    points.push(at(segment, lengths[which]! === 0 ? 0 : Math.min(1, target / lengths[which]!)));
  }
  return points;
}

// ---------------------------------------------------------------------------
// TEST 1 — RECEIPTS SHARING CAUSAL DEPTH SHARE A COLUMN
// ---------------------------------------------------------------------------

test("B2-T01: receipts sharing causal depth share a column — NR 30 and NR 31 same x in different bands, NR 32 one column right; depth is stable as receipts arrive", () => {
  for (const [widthPx, heightPx, label] of [[1200, 520, "1200 × 520"], [1440, 900, "1440 × 900"]] as const) {
    const layout = layoutAt(widthPx, heightPx);
    const at = new Map(layout.beads.map((bead) => [bead.evidenceId, bead] as const));
    const thirty = at.get(byOrdinal.get(30)!.evidenceId)!;
    const thirtyOne = at.get(byOrdinal.get(31)!.evidenceId)!;
    const thirtyTwo = at.get(byOrdinal.get(32)!.evidenceId)!;
    assert.equal(thirty.x, thirtyOne.x, `${label}: NR 30 and NR 31 share a column`);
    assert.equal(thirty.row, thirtyOne.row, `${label}: the same depth column`);
    assert.notEqual(thirty.branch, thirtyOne.branch, `${label}: in different lanes`);
    const bands = bandsOf(layout, lanesOf(items, branches));
    const bandOf = (bead: typeof thirty) => bands.bands.find((band) => band.branch === bead.branch)!;
    assert.notEqual(bandOf(thirty), bandOf(thirtyOne), `${label}: in different bands`);
    assert.ok(thirty.y >= bandOf(thirty).top && thirty.y <= bandOf(thirty).bottom, `${label}: NR 30 inside its band`);
    assert.ok(thirtyOne.y >= bandOf(thirtyOne).top && thirtyOne.y <= bandOf(thirtyOne).bottom, `${label}: NR 31 inside its band`);
    assert.equal(thirtyTwo.row, thirty.row + 1, `${label}: NR 32 is one depth deeper`);
    assert.equal(thirtyTwo.x, thirty.x + layout.pitch, `${label}: NR 32 sits one column pitch to the right`);
    // Generally: same depth ⇔ same x, everywhere in the sealed zone.
    for (const left of layout.beads) {
      for (const right of layout.beads) {
        if (left.zone !== right.zone) continue;
        assert.equal(left.row === right.row, left.x === right.x, `${label}: ${left.evidenceId} / ${right.evidenceId}: same depth means same column and nothing else does`);
      }
    }
    // Every parent stands strictly left of its child: a chain reads left to right.
    for (const thread of layout.threads) {
      assert.ok(at.get(thread.parent)!.x < at.get(thread.child)!.x, `${label}: ${thread.key} runs rightward`);
      assert.equal(at.get(thread.child)!.row > at.get(thread.parent)!.row, true);
    }
  }
  // Depth is computed from the items present and stays put as the story
  // grows: a parent always lands before its child, so a bead never changes
  // column once placed.
  const sealed = new Map(layoutAt(1200, 520).beads.map((bead) => [bead.evidenceId, bead.row] as const));
  for (const at of [12_500, 30_000, 60_000, 90_000, FINAL_RECEIPT_EMITTED_MS + 1_500]) {
    const then = modelAt(at);
    const laid = layoutProofB2({ items: then.model.accumulatedEvidence.items, branches: then.model.accumulatedEvidence.branches, finalReceipt: then.model.finalReceipt !== null, widthPx: 1200, heightPx: 520 });
    assert.equal(laid.beads.length, then.model.accumulatedEvidence.items.length, `at ${at}: every landed receipt is a bead`);
    for (const bead of laid.beads) assert.equal(bead.row, sealed.get(bead.evidenceId), `at ${at}: ${bead.evidenceId} keeps its depth column`);
  }
});

// ---------------------------------------------------------------------------
// TEST 2 — ORDINALS DO NOT AFFECT GEOMETRY
// ---------------------------------------------------------------------------

test("B2-T02: permuting the reading ordinals and the input order leaves every bead exactly where it was; the geometry never reads the ordinal", () => {
  const reference = layoutAt(1200, 520);
  const placeOf = new Map(reference.beads.map((bead) => [bead.evidenceId, [bead.x, bead.y, bead.row] as const] as const));
  // Every receipt takes another receipt's label and index; the input array is reversed.
  const permuted: PublicEvidence[] = items.map((entry, index) => ({ ...entry, ordinal: items[(index * 7 + 3) % items.length]!.ordinal })).reverse();
  assert.notDeepEqual(permuted.map((entry) => entry.ordinal.label), items.map((entry) => entry.ordinal.label));
  const laid = layoutProofB2({ items: permuted, branches, finalReceipt: true, widthPx: 1200, heightPx: 520 });
  assert.equal(laid.beads.length, reference.beads.length);
  for (const bead of laid.beads) assert.deepEqual([bead.x, bead.y, bead.row], placeOf.get(bead.evidenceId), `${bead.evidenceId} moved when its number changed`);
  assert.deepEqual([...laid.threads].map((thread) => thread.d).sort(), [...reference.threads].map((thread) => thread.d).sort(), "the same threads, path for path");
  assert.deepEqual(laid.chapters, reference.chapters);
  assert.deepEqual(laid.anchors, reference.anchors);
  // Checked on the code itself, with comments stripped: the depth geometry
  // never consults the reading number.
  const body = (fn: unknown) => String(fn).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  assert.doesNotMatch(body(layoutProofB2), /ordinal/i, "the geometry does not consult the reading number");
});

// ---------------------------------------------------------------------------
// TEST 3 — CANONICAL PARENTS DETERMINE EDGES
// ---------------------------------------------------------------------------

test("B2-T03: every thread is a declared parent relation among the items, every declared present relation is a thread, and a thread runs from its parent's bead to its child's", () => {
  const byId = new Map(items.map((entry) => [entry.evidenceId, entry] as const));
  const declared = new Set<string>();
  for (const entry of items) for (const parent of [...entry.causalParents, ...entry.observedInputs]) if (byId.has(parent) && parent !== entry.evidenceId) declared.add(`${parent}->${entry.evidenceId}`);
  for (const [widthPx, heightPx, label] of BANDS) {
    const layout = layoutAt(widthPx, heightPx);
    const at = new Map(layout.beads.map((bead) => [bead.evidenceId, bead] as const));
    for (const thread of layout.threads) {
      assert.ok(declared.has(`${thread.parent}->${thread.child}`), `${label}: ${thread.key} is declared by the child`);
      assert.equal(thread.crossLane, byId.get(thread.parent)!.branch !== byId.get(thread.child)!.branch);
      assert.ok(byId.get(thread.parent)!.timeMs <= byId.get(thread.child)!.timeMs, `${label}: ${thread.key} never runs backwards in time`);
      const numbers = (thread.d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
      const from = at.get(thread.parent)!;
      const to = at.get(thread.child)!;
      assert.ok(Math.abs(numbers[0]! - from.x) < 0.01 && Math.abs(numbers[1]! - from.y) < 0.01, `${label}: ${thread.key} starts on its parent`);
      assert.ok(Math.abs(numbers.at(-2)! - to.x) < 0.01 && Math.abs(numbers.at(-1)! - to.y) < 0.01, `${label}: ${thread.key} ends on its child`);
    }
    assert.deepEqual([...declared].sort(), layout.threads.map((thread) => `${thread.parent}->${thread.child}`).sort(), `${label}: exactly the declared relations, no more, no fewer`);
    assert.equal(new Set(layout.threads.map((thread) => thread.key)).size, layout.threads.length, `${label}: no duplicate thread`);
    assert.equal(layout.threads.length, relationsOf(items).length);
  }
  // The city's yellow light, perceived by the vehicle: the one cross-provenance relation a viewer is told about.
  const layout = layoutAt(1200, 520);
  const crossing = layout.threads.find((thread) => thread.parent === "NR-SIGNAL-STATE:yellow" && thread.child === "NR-PERCEPTION:yellow");
  assert.ok(crossing !== undefined && crossing.crossLane && crossing.kind === "observed");
});

// ---------------------------------------------------------------------------
// TEST 4 — NO SYNTHETIC CAUSAL EDGE
// ---------------------------------------------------------------------------

test("B2-T04: 14 of 57 consecutive reading pairs carry no thread — the Gate 1 number — and none is joined by the picture", () => {
  const layout = layoutAt(1200, 520);
  const drawn = new Set(layout.threads.map((thread) => `${thread.parent}->${thread.child}`));
  const byId = new Map(items.map((entry) => [entry.evidenceId, entry] as const));
  let unjoined = 0;
  for (let index = 1; index < items.length; index += 1) {
    const previous = items[index - 1]!;
    const current = items[index]!;
    assert.equal(current.ordinal.index, previous.ordinal.index + 1, "the items are in reading order");
    const key = `${previous.evidenceId}->${current.evidenceId}`;
    const declared = [...current.causalParents, ...current.observedInputs].includes(previous.evidenceId);
    assert.equal(drawn.has(key), declared, `${previous.ordinal.label} → ${current.ordinal.label}: drawn if and only if declared`);
    if (!declared) unjoined += 1;
  }
  assert.equal(items.length - 1, 57);
  assert.equal(unjoined, 14, "fourteen consecutive pairs are siblings rather than causes");
  // NR 30 → NR 31 and NR 31 → NR 32 are not declared and not drawn; NR 30 → NR 32 is both.
  const has = (parent: number, child: number) => drawn.has(`${byOrdinal.get(parent)!.evidenceId}->${byOrdinal.get(child)!.evidenceId}`);
  assert.ok(has(30, 32) && !has(30, 31) && !has(31, 32));
  assert.ok(!byOrdinal.get(31)!.causalParents.includes(byOrdinal.get(30)!.evidenceId));
  assert.ok(byId.size === items.length);
});

// ---------------------------------------------------------------------------
// TEST 5 — THE B2 SET IS THE CANONICAL GRAPH
// ---------------------------------------------------------------------------

test("B2-T05: at the sealed end the production geometry draws exactly the canonical graph — 58 beads, 79 threads, byte-equal sets", () => {
  const graph = canonicalGraph();
  const layout = layoutAt(1280, 560);
  assert.equal(layout.beads.length, 58);
  assert.equal(layout.threads.length, 79);
  const beadIds = JSON.stringify([...layout.beads.map((bead) => bead.evidenceId)].sort());
  const canonicalIds = JSON.stringify([...graph.receipts.map((receipt) => receipt.evidenceId)].sort());
  assert.equal(beadIds, canonicalIds, "the same receipts, by canonical identity");
  const triples = JSON.stringify([...layout.threads.map((thread) => `${thread.kind}:${thread.parent}->${thread.child}`)].sort());
  const canonicalTriples = JSON.stringify([...graph.edges.map((edge) => `${edge.kind}:${edge.parent}->${edge.child}`)].sort());
  assert.equal(triples, canonicalTriples, "the same relations, by (kind, parent, child)");
  // The same sets Gate 1's geometry draws: two pictures, one graph.
  const gate1 = layoutProof({ items, branches, finalReceipt: true, widthPx: 1280, heightPx: 560 });
  assert.equal(JSON.stringify([...gate1.threads.map((thread) => thread.key)].sort()), JSON.stringify([...layout.threads.map((thread) => thread.key)].sort()));
  // The quarantined receipts are beads (never hidden) and never anchors of the compilation.
  const quarantined = items.filter((entry) => entry.assurance === "QUARANTINED").map((entry) => entry.evidenceId);
  assert.equal(quarantined.length, 2);
  for (const id of quarantined) assert.ok(layout.beads.some((bead) => bead.evidenceId === id), `${id} is drawn`);
  const inputs = new Set(FULL.model.finalReceipt!.causalInputEvidenceIds);
  for (const anchor of layout.anchors) assert.ok(inputs.has(anchor.evidenceId), `${anchor.evidenceId} is a causal input of the Final Receipt`);
  assert.equal(layout.anchors.length, branches.length, "one anchor per fed lane");
  // The detached component stays detached: nothing joins NR 18 to NR 19.
  assert.ok(!layout.threads.some((thread) => thread.child === byOrdinal.get(19)!.evidenceId && thread.parent === byOrdinal.get(18)!.evidenceId));
});

// ---------------------------------------------------------------------------
// SUPPORTING INVARIANTS — the floors, the fallback, the fan, the bands
// ---------------------------------------------------------------------------

test("B2: the floors hold at every band; the geometry records a HORIZONTAL scroll rather than shrinking below them; anchors are each lane's deepest bead", () => {
  // Two receipts stacked in one lane-and-depth cell stand a third wider apart
  // than the column pitch: a thread arriving at the lower one must be seen to
  // pass the upper one, not to touch it.
  assert.deepEqual(READABILITY_FLOORS_B2, { beadPx: MIN_BEAD_PX, hitAreaPx: HIT_AREA_PX, pitchPx: MIN_PITCH_PX, gutterPx: MIN_GUTTER_PX, cellStepPx: MIN_PITCH_PX + 4, laneLabelRem: 0.56, chapterLabelRem: 0.56, threadStrokePx: 0.8, threadOpacity: 0.2, finalReceiptPx: 28 });
  for (const [widthPx, heightPx, label] of BANDS) {
    const layout = layoutAt(widthPx, heightPx);
    assert.ok(layout.pitch >= MIN_PITCH_PX && layout.pitch <= MAX_PITCH_B2_PX, `${label}: pitch ${layout.pitch}`);
    assert.ok(layout.bead >= MIN_BEAD_PX && layout.bead <= MAX_BEAD_B2_PX, `${label}: bead ${layout.bead}`);
    assert.ok(layout.gutter >= MIN_GUTTER_PX, `${label}: gutter ${layout.gutter}`);
    assert.equal(layout.beads.length, items.length, `${label}: every bead represented`);
    assert.equal(layout.columns, branches.length, `${label}: one band per fed lane`);
    assert.equal(layout.rows, 35, `${label}: 35 depth columns (0 → 34)`);
    assert.equal(layout.fieldHeight, widthPx, `${label}: the field's scroll-axis extent is its width`);
    assert.equal(layout.fit, layout.contentHeight <= layout.fieldHeight ? "fit" : "scroll", `${label}: the fallback is recorded, never silent`);
    if (layout.fit === "scroll") assert.equal(layout.pitch, MIN_PITCH_PX, `${label}: under the fallback the pitch is exactly the floor`);
    // The Final Receipt stands to the right of every sealed bead; the compile rail between.
    assert.ok(layout.compileY !== null && layout.finalY !== null && layout.compileY < layout.finalY);
    for (const bead of layout.beads) assert.ok(bead.x < layout.compileY!, `${label}: ${bead.evidenceId} left of the compilation rail`);
    assert.ok(layout.finalY! < layout.contentHeight, `${label}: the capsule is inside the picture`);
    // The depth axis runs under the bands, from the first column to the last.
    const bands = bandsOf(layout, lanesOf(items, branches));
    assert.ok(layout.rail !== null && layout.rail.x > bands.bottom && layout.rail.top < layout.rail.bottom);
    assert.equal(layout.rail!.top, Math.min(...layout.beads.map((bead) => bead.x)));
    assert.equal(layout.rail!.bottom, Math.max(...layout.beads.map((bead) => bead.x)));
    // Every bead lies inside its own band, and no two beads of a band overlap.
    const bandOf = new Map(bands.bands.map((band) => [band.branch, band] as const));
    for (const bead of layout.beads) {
      const band = bandOf.get(bead.branch)!;
      assert.ok(bead.y - layout.bead / 2 >= band.top && bead.y + layout.bead / 2 <= band.bottom, `${label}: ${bead.evidenceId} inside the ${bead.branch} band`);
    }
    for (const left of layout.beads) {
      for (const right of layout.beads) {
        if (left.evidenceId >= right.evidenceId) continue;
        const distance = Math.hypot(left.x - right.x, left.y - right.y);
        assert.ok(distance >= Math.max(layout.bead + 2, MIN_PITCH_PX) - 0.01, `${label}: ${left.evidenceId} and ${right.evidenceId} occlude (${distance.toFixed(1)} px)`);
      }
    }
    // The anchors: the deepest sealed bead of each lane, in lane order.
    for (const anchor of layout.anchors) {
      const deepest = layout.beads.filter((bead) => bead.branch === anchor.branch && bead.zone === "closure").sort((a, b) => b.row - a.row || b.rank - a.rank)[0]!;
      assert.equal(anchor.evidenceId, deepest.evidenceId, `${label}: ${anchor.branch} gathers from its deepest bead`);
      assert.equal(layout.beads.filter((bead) => bead.branch === anchor.branch && bead.x > anchor.x).length, 0, `${label}: nothing of the band lies right of the anchor`);
    }
    assert.deepEqual(layout.anchors.map((anchor) => anchor.branch), [...branches]);
    // Chapters are depth spans; overlapping spans take separate strip rows.
    const rows = chapterRows(layout.chapters);
    assert.equal(rows.count, 2, `${label}: two strip rows — the detached signalStop chapter runs beside the mission`);
    for (let i = 0; i < layout.chapters.length; i += 1) {
      for (let j = i + 1; j < layout.chapters.length; j += 1) {
        const a = layout.chapters[i]!;
        const b = layout.chapters[j]!;
        if (a.toRow >= b.fromRow && b.toRow >= a.fromRow) assert.notEqual(rows.rowOf[i], rows.rowOf[j], `${label}: ${a.episode} and ${b.episode} overlap in depth and share a row`);
      }
    }
    assert.equal(layout.episodeGap, 0);
  }
  // The mandate's numbers: the two target bands fit; a 980-wide band with the same story does too.
  assert.equal(layoutAt(1200, 520).fit, "fit");
  assert.equal(layoutAt(1440, 900).fit, "fit");
  assert.equal(layoutAt(980, 600).fit, "fit");
  // A band too narrow for 35 columns at the floor scrolls horizontally: the width, never the height, is what gives.
  const narrow = layoutAt(600, 520);
  assert.equal(narrow.fit, "scroll");
  assert.ok(narrow.contentHeight > narrow.fieldHeight);
  assert.equal(narrow.laneWidth, layoutAt(1200, 520).laneWidth, "the bands keep their height under the fallback");
  // Post-seal records sit right of the Final Receipt, in their own zone, and never rescale the sealed mission.
  const postSeal = (index: number): PublicEvidence => ({
    ...items[items.length - 1]!, evidenceId: `PROBE-POST-SEAL-${index}`, eventId: `probe-${index}`, eventType: "RECONCILIATION_RECEIPT",
    branch: "network", standing: "JOURNAL", causalParents: [], observedInputs: [], timeMs: EXPERIENCE_DURATION_MS + index, episode: "network", admissionIndex: 900 + index,
  });
  const sealedOnly = layoutAt(1280, 560);
  for (const records of [1, 2, 3]) {
    const withJournal = layoutProofB2({ items: [...items, ...Array.from({ length: records }, (_, index) => postSeal(index))], branches: [...branches, "network"], finalReceipt: true, widthPx: 1280, heightPx: 560 });
    assert.equal(withJournal.pitch, sealedOnly.pitch, `${records} post-seal record(s) keep the sealed pitch`);
    assert.deepEqual(withJournal.beads.filter((bead) => bead.zone === "closure").map((bead) => [bead.evidenceId, bead.row, bead.x]), sealedOnly.beads.map((bead) => [bead.evidenceId, bead.row, bead.x]));
    for (const bead of withJournal.beads.filter((bead) => bead.zone === "journal")) {
      assert.ok(withJournal.finalY !== null && bead.x > withJournal.finalY, `${bead.evidenceId} is right of the Final Receipt`);
      assert.ok(withJournal.postSealY !== null && bead.x > withJournal.postSealY, "and inside the post-seal zone");
    }
    assert.equal(withJournal.journalRows, 1, "records with no declared parent share one journal column");
    assert.equal(withJournal.columns, branches.length + 1, "the network lane gets its own band");
  }
});

test("B2: threads that share a bead leave it as a visible fan and never run together — Gate 1's doubled-line defect does not return with the transpose", () => {
  for (const [widthPx, heightPx, label] of BANDS) {
    const layout = layoutAt(widthPx, heightPx);
    const bodies = layout.threads.map((thread) => {
      const points = samplePath(thread.d);
      return { thread, body: points.slice(Math.floor(points.length * 0.2), Math.ceil(points.length * 0.8)) };
    });
    // A fan the geometry DECLARED it could not open: the shared bead's cell
    // had less room than the siblings needed to stand a hairline apart, so
    // they share the band line there. Only such a pair may run together, and
    // only if the room really was short — the collapse is checked, not
    // trusted. Every other pair counts in full, in both directions.
    const collapsedFans = layout.fans.filter((fan) => fan.count > 1 && fan.stepPx < MIN_FAN_STEP_PX);
    for (const fan of collapsedFans) assert.ok(fan.roomPx < (fan.count - 1) * MIN_FAN_STEP_PX, `${label}: the fan at ${fan.evidenceId} (${fan.side}, ${fan.count}) collapsed with ${fan.roomPx} px of room`);
    const declaredTogether = (a: (typeof bodies)[number], b: (typeof bodies)[number]) => collapsedFans.some((fan) => {
      const ids = new Set(fan.threads);
      return ids.has(`${a.thread.parent}->${a.thread.child}`) && ids.has(`${b.thread.parent}->${b.thread.child}`);
    });
    const closeFraction = (a: (typeof bodies)[number], b: (typeof bodies)[number]) => {
      let close = 0;
      for (const [ax, ay] of a.body) {
        let best = Infinity;
        for (const [bx, by] of b.body) best = Math.min(best, Math.hypot(ax - bx, ay - by));
        if (best <= 4) close += 1;
      }
      return close / Math.max(1, a.body.length);
    };
    for (let i = 0; i < bodies.length; i += 1) {
      for (let j = i + 1; j < bodies.length; j += 1) {
        const left = bodies[i]!;
        const right = bodies[j]!;
        if (declaredTogether(left, right)) continue;
        const fraction = Math.max(closeFraction(left, right), closeFraction(right, left));
        // Two threads run together when a LONG stretch of one lies within a
        // bead's width of the other — long in pixels, not only in share. Gate
        // 1's rule (half the body) applied to threads that were all tens of
        // pixels long. Here a one-column hop is about 16 px long between its
        // ends, and any thread that CROSSES it at a shallow angle stays within
        // 4 px for most of that — a crossing, not a doubled line. So the
        // half-body rule still holds for every thread long enough for it to
        // mean something, and a shared stretch must also be at least two bead
        // widths long to count.
        const bodyPx = left.body.reduce((sum, point, index) => (index === 0 ? 0 : sum + Math.hypot(point[0] - left.body[index - 1]![0], point[1] - left.body[index - 1]![1])), 0);
        const sharedPx = fraction * bodyPx;
        assert.ok(!(fraction >= 0.5 && sharedPx >= 24), `${label}: ${left.thread.key} and ${right.thread.key} run together for ${(fraction * 100).toFixed(0)}% of their body (${sharedPx.toFixed(0)} px)`);
      }
    }
    // A thread never passes through a bead it does not name: the honesty
    // measure Gate 2 scored B2 zero on, held at every production band.
    const beads = layout.beads;
    let touches = 0;
    for (const thread of layout.threads) {
      const points = samplePath(thread.d, 96);
      for (const bead of beads) {
        if (bead.evidenceId === thread.parent || bead.evidenceId === thread.child) continue;
        const nearest = Math.min(...points.map(([x, y]) => Math.hypot(x - bead.x, y - bead.y)));
        if (nearest < layout.bead / 2 + 1) touches += 1;
      }
    }
    assert.equal(touches, 0, `${label}: ${touches} thread(s) pass through a receipt they do not name`);
  }
});

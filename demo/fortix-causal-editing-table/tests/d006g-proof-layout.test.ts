import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { OPERATIONAL_CYCLE_DURATION_MS } from "../app/operationalCycle.ts";
import {
  LANE_ORDER,
  computeProofLayout,
  horizontalGapPx,
  leavesCollide,
  minimumLabelledSeparationMs,
  minimumSeparationMs,
  verticalGapPx,
} from "../app/proofLayout.ts";
import { signedProofLeaves } from "../app/proofProjection.ts";


/**
 * P2R: the Proof Tree is now laid out over EVIDENCE leaves, not presentation
 * events, so this suite measures what is actually rendered. `VISUAL_EVENTS`
 * still drives the reality band above the tree and is left alone.
 */
const LEAVES = signedProofLeaves();
/** Mirrors the component's rule: the first leaf of each lane, by time. */
const FEATURED = new Set<string>((() => {
  const seen = new Set<string>();
  const picked: string[] = [];
  for (const leaf of [...LEAVES].sort((a, b) => a.timeMs - b.timeMs)) {
    if (seen.has(leaf.branch)) continue;
    seen.add(leaf.branch);
    picked.push(leaf.leafId);
  }
  return picked;
})());
const PLACEABLE = LEAVES.map((leaf) => ({
  id: leaf.leafId,
  timeMs: leaf.timeMs,
  branch: leaf.branch,
  featured: FEATURED.has(leaf.leafId),
}));

/**
 * D-006G P2 — the Proof Tree must stay readable under burst density.
 *
 * `proofXForEvent` maps x linearly to mission time with no capacity model, so
 * a burst of evidence collides however few labels are drawn. Measured before
 * this work: six smart-city records across 49 px and seven vehicle records
 * across 41 px, against a 10 px leaf.
 *
 * x is time and may not be bent to make room, nothing may be hidden, dropped,
 * merged away or reordered. So the room comes from the vertical axis: lanes
 * are packed internally, and each lane is given height in proportion to how
 * crowded it actually is.
 */

const LAYOUT = computeProofLayout(PLACEABLE, OPERATIONAL_CYCLE_DURATION_MS);

function rowOf(leaf: { id: string }) {
  const row = LAYOUT.rows.get(leaf.id);
  assert.ok(row !== undefined, `${leaf.id} was not placed`);
  return row;
}

// --- the property the whole design exists for ----------------------------

test("D-006G P2: no two proof leaves overlap, anywhere in the mission", () => {
  const collisions: string[] = [];
  for (let i = 0; i < PLACEABLE.length; i += 1) {
    for (let j = i + 1; j < PLACEABLE.length; j += 1) {
      const a = PLACEABLE[i];
      const b = PLACEABLE[j];
      if (leavesCollide(
        { timeMs: a.timeMs, y: rowOf(a).y },
        { timeMs: b.timeMs, y: rowOf(b).y },
        OPERATIONAL_CYCLE_DURATION_MS,
      )) collisions.push(`${a.id} <-> ${b.id}`);
    }
  }
  assert.deepEqual(collisions, [], `overlapping leaves: ${collisions.join(", ")}`);
});

test("D-006G P2: no two captions overlap either", () => {
  // Leaves not touching is not enough: a caption is an order of magnitude
  // wider than its leaf, and two captioned events five seconds apart on the
  // same row overlapped even though their dots did not. The side-choosing
  // label solver cannot resolve that — it picks left or right, and both were
  // already on the same line.
  const featured = PLACEABLE.filter((event) => event.featured === true);
  assert.ok(featured.length >= 5, "the featured spine must still exist to be worth testing");

  const overlaps: string[] = [];
  for (let i = 0; i < featured.length; i += 1) {
    for (let j = i + 1; j < featured.length; j += 1) {
      const a = featured[i];
      const b = featured[j];
      const dx = horizontalGapPx(a.timeMs, b.timeMs, OPERATIONAL_CYCLE_DURATION_MS);
      const dy = verticalGapPx(rowOf(a).y, rowOf(b).y);
      // Same line and within a caption's width of each other.
      if (dx < 150 && dy < 12) overlaps.push(`${a.id} <-> ${b.id}`);
    }
  }
  assert.deepEqual(overlaps, [], `overlapping captions: ${overlaps.join(", ")}`);
});

test("D-006G P2: a caption reserves more room than a bare leaf", () => {
  const leaf = minimumSeparationMs(OPERATIONAL_CYCLE_DURATION_MS);
  const labelled = minimumLabelledSeparationMs(OPERATIONAL_CYCLE_DURATION_MS);
  assert.ok(labelled > leaf * 4,
    "captioned events must claim meaningfully more separation than bare dots");
});

test("D-006G P2: a sub-row is taller than a leaf, or the packing is decorative", () => {
  // The previous attempt allocated sub-rows correctly and still overlapped,
  // because fixed-height lanes left them 9 px apart against a 16 px leaf.
  assert.ok(LAYOUT.rowHeightPx >= 16,
    `sub-rows are ${LAYOUT.rowHeightPx.toFixed(1)}px tall; a leaf needs 16px`);
});

test("D-006G P2: every event is placed, and none is dropped to make room", () => {
  assert.equal(LAYOUT.rows.size, PLACEABLE.length);
  for (const event of PLACEABLE) {
    const row = rowOf(event);
    assert.equal(row.branch, event.branch);
    assert.ok(row.y >= 0 && row.y <= 100, `${event.id} placed off-canvas at ${row.y}`);
  }
});

// --- x is time, and stays time -------------------------------------------

test("D-006G P2: the layout never moves an event along the time axis", () => {
  // The only inputs to a leaf's x are its own timeMs and the mission
  // duration, so no layout decision can shift when an event appears to have
  // happened. Asserted structurally: the module computes y only.
  const source = readFileSync(new URL("../app/proofLayout.ts", import.meta.url), "utf8");
  const compute = source.slice(source.indexOf("export function computeProofLayout"));
  assert.doesNotMatch(compute, /timeMs\s*[+\-*/]=/, "an event's time must never be adjusted");
  for (const row of LAYOUT.rows.values()) {
    assert.ok(Number.isFinite(row.y));
  }
});

test("D-006G P2: crowding is measured, not assumed", () => {
  const separation = minimumSeparationMs(OPERATIONAL_CYCLE_DURATION_MS);
  assert.ok(separation > 0);
  // Two events closer together than the separation must land on different
  // sub-rows within their lane; two further apart may share one.
  for (const branch of LANE_ORDER) {
    const lane = PLACEABLE.filter((event) => event.branch === branch)
      .sort((left, right) => left.timeMs - right.timeMs);
    for (let index = 1; index < lane.length; index += 1) {
      const previous = lane[index - 1];
      const current = lane[index];
      if (current.timeMs - previous.timeMs < separation) {
        assert.notEqual(rowOf(current).subRow, rowOf(previous).subRow,
          `${previous.id} and ${current.id} are ${current.timeMs - previous.timeMs}ms apart and share a sub-row`);
      }
    }
  }
});

test("D-006G P2: space is spent where the evidence actually is", () => {
  // A sparse lane should be one clean line; the dense intersection lane
  // should have taken more. If every lane used the same number of sub-rows
  // the packing would not be adapting to anything.
  const used = new Map<string, number>();
  for (const branch of LANE_ORDER) {
    const lane = PLACEABLE.filter((event) => event.branch === branch);
    if (lane.length === 0) continue;
    used.set(branch, new Set(lane.map((event) => rowOf(event).subRow)).size);
  }
  // Measured against the EVIDENCE, not the old presentation table: the
  // authority lane carries the governed-payment burst — eight objects inside
  // ten seconds, the closest pair 1.8px apart — and claims six sub-rows,
  // while lanes whose evidence is spread out stay on a single line.
  assert.equal(used.get("mission"), 1, "a sparse lane must not be spread out for no reason");
  assert.equal(used.get("route"), 1);
  assert.ok((used.get("authority") ?? 0) >= 4, "the densest lane must claim the room it needs");
  assert.ok(new Set(used.values()).size > 1, "the layout is not adapting to density at all");
});

// --- lanes stay lanes ----------------------------------------------------

test("D-006G P2: lanes keep their order and never intrude on each other", () => {
  const bands: { branch: string; top: number; bottom: number }[] = [];
  for (const branch of LANE_ORDER) {
    const lane = PLACEABLE.filter((event) => event.branch === branch);
    if (lane.length === 0) continue;
    const ys = lane.map((event) => rowOf(event).y);
    bands.push({ branch, top: Math.min(...ys), bottom: Math.max(...ys) });
  }

  for (let index = 1; index < bands.length; index += 1) {
    const above = bands[index - 1];
    const below = bands[index];
    assert.ok(below.top > above.bottom,
      `${below.branch} (from ${below.top}) reaches into ${above.branch} (to ${above.bottom})`);
    // And the gap between domains must read as a gap.
    assert.ok(verticalGapPx(above.bottom, below.top) >= 4,
      `${above.branch} and ${below.branch} are not visibly separate lanes`);
  }
});

test("D-006G P2: every trust domain that has evidence gets its own lane", () => {
  const branches = new Set(PLACEABLE.map((event) => event.branch));
  for (const branch of branches) {
    assert.ok(LANE_ORDER.includes(branch), `${branch} has evidence but no lane`);
  }
  // The domains the SIGNED evidence actually distinguishes. `bank` and
  // `network` are runtime-only lanes — the signed bundle contains no
  // financial institution and no network transitions — so requiring them here
  // would be requiring evidence that does not exist, which is the defect this
  // whole phase exists to remove.
  for (const required of ["city", "vehicle", "authority", "route", "service", "mission"]) {
    assert.ok(branches.has(required as never), `${required} must be a visible domain`);
  }
});

// --- determinism, which replay and seeking depend on ---------------------

test("D-006G P2: the layout is deterministic and order-independent", () => {
  const again = computeProofLayout(PLACEABLE, OPERATIONAL_CYCLE_DURATION_MS);
  for (const event of PLACEABLE) {
    assert.equal(again.rows.get(event.id)?.y, rowOf(event).y);
  }
  // Feeding the events in a different order must not change where anything
  // lands, or seeking would rebuild a different tree from the same evidence.
  const shuffled = [...PLACEABLE].reverse();
  const fromShuffled = computeProofLayout(shuffled, OPERATIONAL_CYCLE_DURATION_MS);
  for (const event of PLACEABLE) {
    assert.equal(fromShuffled.rows.get(event.id)?.y, rowOf(event).y,
      `${event.id} moved when the input order changed`);
  }
});

test("D-006G P2: adding evidence to one domain does not move another domain's rows", () => {
  // The retired authored-row table shifted every later unauthored event when
  // one was inserted. Growth in one lane must stay in that lane... except for
  // the vertical space it legitimately claims, so this asserts the invariant
  // that matters: relative order and per-lane grouping survive.
  const extra = {
    ...PLACEABLE.filter((event) => event.branch === "city")[0],
    id: "probe-extra-city",
    timeMs: PLACEABLE.filter((event) => event.branch === "city")[0].timeMs + 10,
  };
  const grown = computeProofLayout([...PLACEABLE, extra], OPERATIONAL_CYCLE_DURATION_MS);
  const laneOf = (layout: typeof grown, branch: string) =>
    PLACEABLE.filter((event) => event.branch === branch)
      .map((event) => layout.rows.get(event.id)!.subRow);
  // Sub-row assignment inside untouched lanes is unchanged.
  for (const branch of ["service", "route", "authority", "bank"]) {
    assert.deepEqual(laneOf(grown, branch), laneOf(LAYOUT, branch),
      `${branch} sub-rows moved because an unrelated domain gained an event`);
  }
});

// --- the horizontal reality this is compensating for ---------------------

test("D-006G P2: the underlying burst really is too dense to leave on one line", () => {
  // Guards against the packing quietly becoming unnecessary — if this ever
  // fails, the density problem has gone away and the machinery can be
  // simplified rather than left in place unexplained.
  const ordered = [...PLACEABLE].sort((left, right) => left.timeMs - right.timeMs);
  const closest = Math.min(...ordered.slice(1).map((event, index) =>
    horizontalGapPx(ordered[index].timeMs, event.timeMs, OPERATIONAL_CYCLE_DURATION_MS)));
  assert.ok(closest < 16,
    `the closest pair is ${closest.toFixed(1)}px apart, which no longer needs packing`);
});

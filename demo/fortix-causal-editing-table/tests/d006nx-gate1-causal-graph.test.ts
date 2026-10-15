import assert from "node:assert/strict";
import test from "node:test";

import { layoutProof, relationsOf } from "../app/nx/evidence/proofGeometry.ts";
import type { PublicEvidence } from "../app/nx/adapter/publicExperienceAdapter.ts";
import { EXPERIENCE_DURATION_MS } from "../app/storyTimeline.ts";
import { modelAt } from "./support/modelAt.ts";

/**
 * D-006 NX — GATE 1: CAUSAL GRAPH INTEGRITY.
 *
 * The graph a viewer sees must BE the causal graph the evidence declares —
 * no edge added, none dropped, none invented from the human reading order.
 *
 * These are the regression tests for that. Several of them assert a NEGATIVE:
 * that a tempting shortcut has NOT been taken. Those are the ones that matter,
 * because the failure they guard against would look perfectly plausible on
 * screen — a graph whose threads politely follow the numbers.
 */

const FULL = modelAt(EXPERIENCE_DURATION_MS);
const items = FULL.model.accumulatedEvidence.items;
const branches = FULL.model.accumulatedEvidence.branches;
const closure = FULL.snapshot.closure!;

/** The relation set as the SEALED EVIDENCE declares it, read independently. */
const presentIds = new Set(items.map((entry) => entry.evidenceId));
type Declared = Readonly<{ parent: string; child: string; kind: "cause" | "observed" }>;
const declared: Declared[] = [];
for (const member of closure.members) {
  if (!presentIds.has(member.evidenceId)) continue;
  for (const parent of member.causalParents) {
    if (presentIds.has(parent) && parent !== member.evidenceId) declared.push({ parent, child: member.evidenceId, kind: "cause" });
  }
  for (const parent of member.observedInputs) {
    if (presentIds.has(parent) && parent !== member.evidenceId) declared.push({ parent, child: member.evidenceId, kind: "observed" });
  }
}
const declaredPairs = new Set(declared.map((relation) => `${relation.parent}->${relation.child}`));

const BANDS: readonly (readonly [number, number, string])[] = [
  [1280, 560, "1440 x 900"],
  [1180, 425, "1280 x 720"],
  [980, 330, "narrow"],
  [1280, 1400, "tall"],
];
const layoutAt = (widthPx: number, heightPx: number) => layoutProof({ items, branches, finalReceipt: true, widthPx, heightPx });

// ---------------------------------------------------------------------------
// G1-T01 — EVERY RENDERED EDGE HAS A CANONICAL JUSTIFICATION
// ---------------------------------------------------------------------------

test("G1-T01: every thread on the band is a relation the sealed evidence declares", () => {
  assert.equal(items.length, 58);
  assert.ok(declared.length > 70, `the run declares ${declared.length} relations`);
  for (const [widthPx, heightPx, label] of BANDS) {
    for (const thread of layoutAt(widthPx, heightPx).threads) {
      assert.ok(
        declaredPairs.has(`${thread.parent}->${thread.child}`),
        `${label}: ${thread.key} is drawn but the evidence declares no such relation`,
      );
      assert.ok(presentIds.has(thread.parent) && presentIds.has(thread.child), `${label}: ${thread.key} has an end that is not on the band`);
    }
  }
});

// ---------------------------------------------------------------------------
// G1-T02 — NOTHING DECLARED IS MISSING
// ---------------------------------------------------------------------------

test("G1-T02: every declared relation whose ends are both present is drawn", () => {
  for (const [widthPx, heightPx, label] of BANDS) {
    const rendered = new Set(layoutAt(widthPx, heightPx).threads.map((thread) => `${thread.parent}->${thread.child}`));
    for (const pair of declaredPairs) {
      assert.ok(rendered.has(pair), `${label}: the evidence declares ${pair} and nothing is drawn for it`);
    }
    assert.equal(rendered.size, declaredPairs.size, `${label}: the picture holds exactly the declared relations`);
  }
});

// ---------------------------------------------------------------------------
// G1-T03 — NO DUPLICATE EDGE
// ---------------------------------------------------------------------------

test("G1-T03: no pair is drawn twice, and a pair declared both ways yields one thread", () => {
  for (const [widthPx, heightPx, label] of BANDS) {
    const threads = layoutAt(widthPx, heightPx).threads;
    const exact = new Map<string, number>();
    const pairs = new Map<string, number>();
    for (const thread of threads) {
      const withKind = `${thread.parent}->${thread.child}:${thread.kind}`;
      exact.set(withKind, (exact.get(withKind) ?? 0) + 1);
      const pair = `${thread.parent}->${thread.child}`;
      pairs.set(pair, (pairs.get(pair) ?? 0) + 1);
    }
    for (const [key, count] of exact) assert.equal(count, 1, `${label}: ${key} is drawn ${count} times`);
    for (const [key, count] of pairs) assert.equal(count, 1, `${label}: ${key} carries ${count} threads`);
  }
  // A receipt that named the same parent under BOTH kinds must still produce
  // exactly one thread — an aggregation, not two lines on top of each other.
  const base = items[0]!;
  const parent: PublicEvidence = { ...base, evidenceId: "PROBE-P", causalParents: [], observedInputs: [] };
  const child: PublicEvidence = { ...base, evidenceId: "PROBE-C", causalParents: ["PROBE-P"], observedInputs: ["PROBE-P"] };
  const relations = relationsOf([parent, child]);
  assert.equal(relations.length, 1, "one pair, one relation, whichever way it was declared");
  assert.equal(relations[0]!.kind, "cause", "and the stronger of the two is what it is called");
});

// ---------------------------------------------------------------------------
// G1-T04 — THE ORDINAL HAS NO CAUSAL AUTHORITY
// ---------------------------------------------------------------------------

test("G1-T04: no edge is derived from the reading order", () => {
  const rendered = new Set(layoutAt(1280, 560).threads.map((thread) => `${thread.parent}->${thread.child}`));
  // If the renderer were auto-linking the reading order, EVERY consecutive
  // pair would carry a thread. Many do not, and that is the proof.
  const consecutive = items.slice(1).map((entry, index) => `${items[index]!.evidenceId}->${entry.evidenceId}`);
  const unjoined = consecutive.filter((pair) => !rendered.has(pair));
  assert.ok(unjoined.length > 5, `${unjoined.length} consecutive reading pairs carry no thread`);
  // And every consecutive pair that IS joined is joined because the evidence
  // says so, not because the numbers are adjacent.
  for (const pair of consecutive.filter((entry) => rendered.has(entry))) {
    assert.ok(declaredPairs.has(pair), `${pair} is drawn between consecutive numbers without a declared relation`);
  }
  // An edge may legitimately skip one or more reading numbers.
  const ordinalOf = new Map(items.map((entry) => [entry.evidenceId, entry.ordinal.index] as const));
  const skipping = [...rendered].filter((pair) => {
    const [parent, child] = pair.split("->") as [string, string];
    return ordinalOf.get(child)! - ordinalOf.get(parent)! > 1;
  });
  assert.ok(skipping.length > 10, `${skipping.length} threads skip at least one reading number, which is normal`);
  // The graph module never reads the ordinal at all — checked on the code
  // itself, with comments stripped (the comments talk ABOUT the ordinal
  // precisely to say that the geometry must not consult it).
  const body = (fn: unknown) => String(fn)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
  assert.doesNotMatch(body(layoutProof) + body(relationsOf), /ordinal/i, "the geometry does not consult the reading number");
});

// ---------------------------------------------------------------------------
// G1-T05 — SIBLINGS STAY UNLINKED
// ---------------------------------------------------------------------------

test("G1-T05: parallel receipts with no declared relation are joined by nothing", () => {
  // The zone the human review named: "I see 30 then 32 — where is 31?".
  // NR 31 is a sibling of NR 30, not a step between it and NR 32: both descend
  // from NR 24 and NR 27, and NR 30 -> NR 32 is the declared relation.
  const byOrdinal = new Map(items.map((entry) => [entry.ordinal.index, entry] as const));
  const thirty = byOrdinal.get(30)!;
  const thirtyOne = byOrdinal.get(31)!;
  const thirtyTwo = byOrdinal.get(32)!;
  const rendered = layoutAt(1280, 560).threads;
  const has = (parent: string, child: string) => rendered.some((thread) => thread.parent === parent && thread.child === child);
  assert.ok(has(thirty.evidenceId, thirtyTwo.evidenceId), "NR 30 -> NR 32 is declared and drawn");
  assert.ok(!has(thirty.evidenceId, thirtyOne.evidenceId), "NR 30 -> NR 31 is NOT declared and must not be drawn");
  assert.ok(!has(thirtyOne.evidenceId, thirtyTwo.evidenceId), "NR 31 -> NR 32 is NOT declared and must not be drawn");
  assert.ok(!thirtyOne.causalParents.includes(thirty.evidenceId), "and the evidence agrees: 31 does not descend from 30");
  assert.notEqual(thirtyOne.branch, thirtyTwo.branch === thirtyOne.branch ? "" : thirtyOne.branch, "");
  // Generally: consecutive receipts in DIFFERENT lanes with no declared
  // relation are never joined.
  let siblings = 0;
  for (let index = 1; index < items.length; index += 1) {
    const previous = items[index - 1]!;
    const current = items[index]!;
    if (declaredPairs.has(`${previous.evidenceId}->${current.evidenceId}`)) continue;
    siblings += 1;
    assert.ok(!has(previous.evidenceId, current.evidenceId), `${previous.ordinal.label} and ${current.ordinal.label} declare nothing and must stay unjoined`);
  }
  assert.ok(siblings > 5, `${siblings} consecutive pairs are siblings rather than causes`);
});

// ---------------------------------------------------------------------------
// G1-T06 — THREADS THAT SHARE AN END DO NOT SHARE A ROUTE
// ---------------------------------------------------------------------------

/** Points along a thread's path, so two routes can be compared numerically. */
function samplePath(d: string, count = 48): readonly (readonly [number, number])[] {
  const numbers = (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  const points: (readonly [number, number])[] = [];
  if (d.includes("C")) {
    const [x0, y0, x1, y1, x2, y2, x3, y3] = numbers as number[];
    for (let i = 0; i <= count; i += 1) {
      const s = i / count;
      const u = 1 - s;
      points.push([
        u * u * u * x0! + 3 * u * u * s * x1! + 3 * u * s * s * x2! + s * s * s * x3!,
        u * u * u * y0! + 3 * u * u * s * y1! + 3 * u * s * s * y2! + s * s * s * y3!,
      ]);
    }
  } else {
    const [x0, y0, x1, y1] = numbers as number[];
    for (let i = 0; i <= count; i += 1) {
      const s = i / count;
      points.push([x0! + (x1! - x0!) * s, y0! + (y1! - y0!) * s]);
    }
  }
  return points;
}

test("G1-T06: two different relations are never drawn as one doubled line", () => {
  // The human review reported "doubles fils". Nothing was duplicated in the
  // data — the audit found 0 duplicate edges — but twelve pairs of DIFFERENT
  // relations were drawn within a few pixels of each other over most of their
  // length, all of them fans leaving or arriving at one receipt.
  //
  // Threads that share a receipt MUST meet at it, so the comparison is over
  // the middle 60% of each path: the body, not the ends.
  for (const [widthPx, heightPx, label] of BANDS) {
    const threads = layoutAt(widthPx, heightPx).threads;
    const bodies = threads.map((thread) => {
      const points = samplePath(thread.d);
      return { thread, body: points.slice(Math.floor(points.length * 0.2), Math.ceil(points.length * 0.8)) };
    });
    for (let i = 0; i < bodies.length; i += 1) {
      for (let j = i + 1; j < bodies.length; j += 1) {
        const left = bodies[i]!;
        const right = bodies[j]!;
        let close = 0;
        for (const [ax, ay] of left.body) {
          let best = Infinity;
          for (const [bx, by] of right.body) best = Math.min(best, Math.hypot(ax - bx, ay - by));
          if (best <= 4) close += 1;
        }
        const fraction = close / Math.max(1, left.body.length);
        assert.ok(
          fraction < 0.5,
          `${label}: ${left.thread.key} and ${right.thread.key} run together for ${(fraction * 100).toFixed(0)}% of their body`,
        );
      }
    }
  }
});

// ---------------------------------------------------------------------------
// G1-T07 — SEPARATION CHANGED THE PICTURE, NEVER THE GRAPH
// ---------------------------------------------------------------------------

test("G1-T07: fanning threads apart moves no endpoint and alters no relation", () => {
  const layout = layoutAt(1280, 560);
  const at = new Map(layout.beads.map((bead) => [bead.evidenceId, bead] as const));
  for (const thread of layout.threads) {
    const numbers = (thread.d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
    const from = at.get(thread.parent)!;
    const to = at.get(thread.child)!;
    // A thread still begins exactly on its parent and ends exactly on its child.
    assert.ok(Math.abs(numbers[0]! - from.x) < 0.01 && Math.abs(numbers[1]! - from.y) < 0.01, `${thread.key} starts on its parent`);
    assert.ok(Math.abs(numbers.at(-2)! - to.x) < 0.01 && Math.abs(numbers.at(-1)! - to.y) < 0.01, `${thread.key} ends on its child`);
  }
  // The relation set is a pure function of the evidence and is unaffected by
  // the band it is drawn at.
  const relations = relationsOf(items).map((relation) => `${relation.kind}:${relation.parent}->${relation.child}`).sort();
  for (const [widthPx, heightPx, label] of BANDS) {
    const drawn = layoutAt(widthPx, heightPx).threads.map((thread) => thread.key).sort();
    assert.deepEqual(drawn, relations, `${label}: the same relations, whatever the geometry`);
  }
});

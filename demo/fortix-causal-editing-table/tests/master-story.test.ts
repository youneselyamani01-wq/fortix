import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  D005M_MASTER_BUNDLE_ID,
  D005M_MASTER_CYCLE_RECEIPT_ID,
  D005M_MASTER_PAYMENT_RECEIPT_ID,
  D005M_MASTER_RETURN_RECEIPT_ID,
  MASTER_EVIDENCE_EVENTS,
  MASTER_PACING_SEGMENTS,
  MASTER_PRESENTATION_DURATION_MS,
  MASTER_STORY_MOMENTS,
  advanceMasterTimeByPresentationElapsed,
  createTamperedD005MMasterBundle,
  deriveMasterStoryState,
  masterTimeForPresentationTime,
  presentationTimeForMasterTime,
  verifyD005MMasterBundle,
} from "../app/masterStory.ts";
import { EXPERIENCE_DURATION_MS } from "../app/storyTimeline.ts";

const DATA_URL = new URL("../data/", import.meta.url);

test("D-005F consumes the frozen additive D-005M master artifacts", () => {
  const expected = new Map([
    ["d005m-master-evidence-branch.json", "89F4F7864FCC4B23D31488E22F4A8CDB8ABFA591EBCF97E7FD77E9ACF80BDFC2"],
    ["d005m-master-payment-receipt.json", "02DCEA2B2992EE5A3FDBB991718B530B875D1C83DADC052443DE72585727F772"],
    ["d005m-master-return-to-base-receipt.json", "7C8E4B60876EAC40398A31A7E6E81023109F61C33F189A583F9616241E7E65CC"],
    ["d005m-master-operational-cycle-receipt.json", "C2DFC0416ECDE1A0B98FF3F95FDD137B211A7B566960D87A1CF68841CBEC2776"],
    ["d005m-master-portable-evidence-bundle.json", "0D1C30D1442670218966A21A2EBA74DF82B081BECF75F62269423343AEEBCF31"],
  ]);
  for (const [name, digest] of expected) {
    assert.equal(createHash("sha256").update(readFileSync(new URL(name, DATA_URL))).digest("hex").toUpperCase(), digest);
  }
});

test("master evidence replaces the historical 420 payment branch without changing earlier events", () => {
  const eventIds = MASTER_EVIDENCE_EVENTS.map((event) => event.event_id);
  assert.ok(eventIds.includes("d005.passenger-request"));
  assert.ok(eventIds.includes("d005.maintenance-completed"));
  assert.ok(eventIds.includes("d005m.master-invoice-1850"));
  assert.ok(eventIds.includes("d005m.master-human-approve"));
  assert.ok(eventIds.includes("d005m.master-payment-authority-active"));
  assert.ok(eventIds.includes("d005m.master-payment-result"));
  assert.ok(eventIds.includes("d005m.receipt.master-operational-cycle"));
  assert.equal(eventIds.includes("d005.invoice-received"), false);
  assert.equal(eventIds.includes("d005.payment-result"), false);
});

test("the locked operational story remains ordered and does not skip passenger drop-off", () => {
  assert.equal(MASTER_STORY_MOMENTS.length, 43);
  const ids = MASTER_STORY_MOMENTS.map((moment) => moment.id);
  assert.ok(ids.indexOf("passenger-pickup") < ids.indexOf("passenger-dropoff"));
  assert.ok(ids.indexOf("passenger-dropoff") < ids.indexOf("passenger-mission-complete"));
  assert.ok(ids.indexOf("passenger-mission-complete") < ids.indexOf("garage-mission-begins"));
  assert.ok(ids.indexOf("work-in-progress") < ids.indexOf("work-complete"));
  assert.ok(ids.indexOf("work-complete") < ids.indexOf("invoice-1850"));
  assert.ok(ids.indexOf("payment-result") < ids.indexOf("leaving-garage"));
  assert.ok(ids.indexOf("payment-result") < ids.indexOf("return-to-base-intent"));
  assert.ok(ids.indexOf("return-to-base-intent") < ids.indexOf("return-route-calculated"));
  assert.ok(ids.indexOf("return-route-calculated") < ids.indexOf("leaving-garage"));
  assert.ok(ids.indexOf("leaving-garage") < ids.indexOf("parked-at-base"));
});

test("passenger occupancy and mission transition reconstruct from masterTime only", () => {
  assert.equal(deriveMasterStoryState(17_999).passengerAboard, false);
  assert.equal(deriveMasterStoryState(18_000).passengerAboard, true);
  assert.equal(deriveMasterStoryState(33_999).passengerAboard, true);
  assert.equal(deriveMasterStoryState(34_000).passengerAboard, false);
  assert.equal(deriveMasterStoryState(36_000).moment.id, "passenger-mission-complete");
  assert.equal(deriveMasterStoryState(38_000).moment.id, "garage-mission-begins");
});

test("traffic, provider transition, reroute authority, and physical execution are separate moments", () => {
  assert.equal(deriveMasterStoryState(46_000).moment.id, "congestion");
  assert.equal(deriveMasterStoryState(48_000).moment.id, "eta-at-risk");
  assert.equal(deriveMasterStoryState(51_000).moment.id, "provider-transition");
  assert.equal(deriveMasterStoryState(52_000).moment.id, "reroute-authorized");
  assert.equal(deriveMasterStoryState(54_000).moment.id, "physical-reroute");
});

test("maintenance authorization, work, completion, and invoice remain distinct", () => {
  assert.equal(deriveMasterStoryState(72_000).moment.id, "maintenance-authorized");
  assert.equal(deriveMasterStoryState(74_000).moment.id, "work-in-progress");
  assert.equal(deriveMasterStoryState(78_000).moment.id, "work-complete");
  assert.equal(deriveMasterStoryState(82_000).moment.id, "invoice-1850");
});

test("human approval and action-scoped authority precede payment execution", () => {
  assert.equal(deriveMasterStoryState(84_000).paymentStep, "LIMIT");
  assert.equal(deriveMasterStoryState(84_250).paymentStep, "ESCALATION");
  assert.equal(deriveMasterStoryState(85_000).paymentStep, "APPROVED");
  assert.equal(deriveMasterStoryState(85_250).paymentStep, "DELEGATED");
  assert.equal(deriveMasterStoryState(85_500).paymentStep, "AUTHORIZED");
  assert.equal(deriveMasterStoryState(86_000).paymentStep, "REQUEST");
  assert.equal(deriveMasterStoryState(88_000).paymentStep, "RESULT");
});

test("provider request and result return are distinct signed evidence", () => {
  const request = MASTER_EVIDENCE_EVENTS.find((event) => event.event_id === "d005m.master-payment-instruction");
  const result = MASTER_EVIDENCE_EVENTS.find((event) => event.event_id === "d005m.master-payment-result");
  assert.ok(request);
  assert.ok(result);
  assert.equal(request.kind, "EXECUTION");
  assert.equal(result.kind, "RESULT");
  assert.notEqual(request.evidence_id, result.evidence_id);
  assert.ok(result.causal_parent_ids.includes(request.evidence_id));
});

test("master receipt hierarchy uses new payment, return, cycle, and PEB identities", () => {
  assert.equal(D005M_MASTER_PAYMENT_RECEIPT_ID, "fortix:evidence:blake3:6e4602ab7e4a36ebeff0a761587515a76912891f2f311dcd9f7edd091757490c");
  assert.equal(D005M_MASTER_RETURN_RECEIPT_ID, "fortix:evidence:blake3:c57716924e6cec81a8536ee31bf17bc4dea4147388fd4bcd7774cd29cb9a1780");
  assert.equal(D005M_MASTER_CYCLE_RECEIPT_ID, "fortix:evidence:blake3:8acc956ca64deb35b3e958f73fad715a82ee502bd6d32f6d5d999d8816e5db64");
  assert.equal(D005M_MASTER_BUNDLE_ID, "fortix:peb:blake3:b8df60dbbec545499e4d3ca9bea7001938d281585677d4c38d0cf57df8632d6d");
  assert.equal(deriveMasterStoryState(114_000).reachedReceiptCount, 5);
  assert.equal(deriveMasterStoryState(120_000).cycleReceiptAvailable, true);
});

test("nonlinear pacing includes the visible post-roll while preserving canonical timestamps", () => {
  assert.equal(MASTER_PRESENTATION_DURATION_MS, 56_100);
  assert.equal(MASTER_PACING_SEGMENTS[0].startMs, 0);
  assert.equal(MASTER_PACING_SEGMENTS.at(-1)?.endMs, EXPERIENCE_DURATION_MS);
  assert.equal(masterTimeForPresentationTime(0), 0);
  assert.equal(masterTimeForPresentationTime(MASTER_PRESENTATION_DURATION_MS), EXPERIENCE_DURATION_MS);
  assert.equal(advanceMasterTimeByPresentationElapsed(0, MASTER_PRESENTATION_DURATION_MS), EXPERIENCE_DURATION_MS);
  const segmentRates = new Set(MASTER_PACING_SEGMENTS.map((segment) => (segment.endMs - segment.startMs) / segment.presentationDurationMs));
  assert.ok(segmentRates.size > 8);
});

test("direct seek, rewind-return, and pacing inverse reconstruct exact story state", () => {
  for (const moment of MASTER_STORY_MOMENTS) {
    const direct = deriveMasterStoryState(moment.timeMs);
    deriveMasterStoryState(0);
    assert.deepEqual(deriveMasterStoryState(moment.timeMs), direct);
    const presentation = presentationTimeForMasterTime(moment.timeMs);
    assert.ok(Math.abs(masterTimeForPresentationTime(presentation) - moment.timeMs) <= 2);
  }
});

test("independent D-005M verification is detached and returns the honest trust result", async () => {
  const first = await verifyD005MMasterBundle();
  const second = await verifyD005MMasterBundle();
  assert.deepEqual(second, first);
  assert.equal(first.verdict, "INDETERMINATE");
  // P2R: the verifier now also reports that the bundle's SETTLED assertion is
  // unsupported — a payment provider claiming an act only an account-holding
  // institution can perform, with no such institution in the evidence. The
  // array therefore carries two truthful reasons rather than one. Asserting
  // membership rather than exact equality keeps this honest without pinning
  // the verifier to under-reporting what it found.
  assert.ok(first.reasonCodes.includes("D005M_PRODUCTION_TRUST_TIME_INCOMPLETE"));
  assert.ok(first.reasonCodes.includes("D005M_SETTLEMENT_UNSUPPORTED_BY_EVIDENCE"));
  assert.equal(first.receiptId, D005M_MASTER_CYCLE_RECEIPT_ID);
  assert.equal(first.bundleId, D005M_MASTER_BUNDLE_ID);
});

test("tampering the master invoice fails bundle integrity", async () => {
  const result = await verifyD005MMasterBundle(createTamperedD005MMasterBundle());
  assert.equal(result.verdict, "INVALID");
  assert.deepEqual(result.reasonCodes, ["BUNDLE_DIGEST_MISMATCH"]);
});

test("D-005F has one masterTime and no independent movie or wall clock", () => {
  const model = readFileSync(new URL("../app/masterStory.ts", import.meta.url), "utf8");
  const component = readFileSync(new URL("../app/OperationalCycleTable.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(model, /Date\.now|new Date|performance\.now|Math\.random|setTimeout|setInterval|requestAnimationFrame/);
  assert.match(component, /advanceReviewPlayback\(anchorMasterTime, elapsedFromAnchor, reviewMode, humanDecision\)/);
  assert.doesNotMatch(component, /elapsed\s*\*\s*8/);
  assert.equal((component.match(/useState\(0\)/g) ?? []).length, 1);
});

test("language selection cannot alter canonical D-005M artifact bytes", () => {
  const before = createHash("sha256").update(readFileSync(new URL("d005m-master-portable-evidence-bundle.json", DATA_URL))).digest("hex");
  const english = readFileSync(new URL("../../../site/src/i18n/locales/en.ts", import.meta.url), "utf8");
  const french = readFileSync(new URL("../../../site/src/i18n/locales/fr.ts", import.meta.url), "utf8");
  assert.match(english, /masterPath: "€1,850 master path"/);
  assert.match(french, /masterPath: "Parcours maître · 1 850 €"/);
  assert.equal(createHash("sha256").update(readFileSync(new URL("d005m-master-portable-evidence-bundle.json", DATA_URL))).digest("hex"), before);
});

test("the master path is the default presentation and transfer remains explicit", () => {
  const component = readFileSync(new URL("../app/OperationalCycleTable.tsx", import.meta.url), "utf8");
  assert.match(component, /deriveCinematicState\(masterTime, "MASTER_APPROVED"\)/);
  assert.match(component, /nextTransferStage\(bundleStage, "GATHER"\)/);
  assert.match(component, /nextTransferStage\(bundleStage, "SEND"\)/);
  assert.match(component, /onClick=\{runVerification\}/);
});

/* --- D-006C: playback must never manufacture canonical time --------------- */

test("no pacing segment lets per-frame stepping outrun anchored stepping", () => {
  // Failed before D-006C at 84_000, 85_000 and 85_250 — the three
  // master:presentation = 0.5 segments, where Math.round(m + 0.5) === m + 1
  // ratcheted the clock on every single frame.
  const outrunning = MASTER_PACING_SEGMENTS.filter((segment) => {
    let perFrame = segment.startMs;
    for (let frame = 0; frame < 200; frame += 1) {
      perFrame = advanceMasterTimeByPresentationElapsed(perFrame, 1);
    }
    return perFrame > advanceMasterTimeByPresentationElapsed(segment.startMs, 200);
  }).map((segment) => segment.startMs);
  assert.deepEqual(outrunning, [], `these segments manufacture canonical time: ${outrunning.join(", ")}`);
});

test("a frame worth less than one canonical millisecond cannot ratchet the clock", () => {
  const halfRate = MASTER_PACING_SEGMENTS
    .filter((segment) => (segment.endMs - segment.startMs) / segment.presentationDurationMs === 0.5)
    .map((segment) => segment.startMs);
  assert.deepEqual(halfRate, [84_000, 85_000, 85_250]);
  for (const start of halfRate) {
    assert.equal(advanceMasterTimeByPresentationElapsed(start, 1), start, `ratcheted at ${start}`);
    assert.equal(advanceMasterTimeByPresentationElapsed(start, 2), start + 1, `wrong rate at ${start}`);
  }
});

test("fractional frame deltas are not rounded up into whole presentation milliseconds", () => {
  // Master 98_000 sits in pace(98_000, 104_000, 600): one presentation ms is
  // worth ten master ms, so rounding a 0.5 ms frame up used to buy 10 ms —
  // twenty times too fast.
  const half = advanceMasterTimeByPresentationElapsed(98_000, 0.5);
  const whole = advanceMasterTimeByPresentationElapsed(98_000, 1);
  assert.equal(half, 98_005);
  assert.equal(whole, 98_010);
  assert.ok(
    advanceMasterTimeByPresentationElapsed(half, 0.5) <= whole,
    "two half-millisecond frames outran one whole-millisecond frame",
  );
  assert.equal(advanceMasterTimeByPresentationElapsed(98_000, 0.4), 98_004);
});

test("truncating playback still lands exactly on every canonical segment boundary", () => {
  // Guards the Math.floor against float noise dropping a boundary to endMs - 1.
  for (const segment of MASTER_PACING_SEGMENTS) {
    assert.equal(
      advanceMasterTimeByPresentationElapsed(segment.startMs, segment.presentationDurationMs),
      segment.endMs,
      `segment ${segment.startMs}-${segment.endMs} missed its own end`,
    );
    assert.equal(advanceMasterTimeByPresentationElapsed(segment.startMs, 0), segment.startMs);
  }
  assert.equal(advanceMasterTimeByPresentationElapsed(119_999, 100_000), EXPERIENCE_DURATION_MS);
});

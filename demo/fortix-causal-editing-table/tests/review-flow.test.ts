import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { D005M_MASTER_BUNDLE_TEXT, verifyD005MMasterBundle } from "../app/masterStory.ts";
import {
  HUMAN_APPROVAL_EVIDENCED_MS,
  HUMAN_AUTHORITY_GATE_MS,
  advanceReviewPlayback,
  applyHumanDecision,
  constrainReviewTime,
  effectiveHumanDecision,
  formatStableTimelineTime,
  nextTransferStage,
} from "../app/reviewFlow.ts";
import { EXPERIENCE_DURATION_MS } from "../app/storyTimeline.ts";

test("interactive playback pauses at a visible and recoverable authority gate", () => {
  let masterTime = 0;
  let paused = false;
  for (let step = 0; step < 2_000 && !paused; step += 1) {
    const result = advanceReviewPlayback(masterTime, 100, "INTERACTIVE", "PENDING");
    masterTime = result.masterTime;
    paused = result.pausedForAuthority;
  }
  assert.equal(paused, true);
  assert.equal(masterTime, HUMAN_AUTHORITY_GATE_MS);
  assert.equal(constrainReviewTime(120_000, "INTERACTIVE", "PENDING"), HUMAN_AUTHORITY_GATE_MS);
  assert.deepEqual(applyHumanDecision("APPROVED"), { decision: "APPROVED", masterTime: HUMAN_AUTHORITY_GATE_MS });
});

test("human wall wait adds no mission time and ALLOW resumes without a clock jump", () => {
  const waiting = advanceReviewPlayback(HUMAN_AUTHORITY_GATE_MS, 30_000, "INTERACTIVE", "PENDING");
  assert.equal(waiting.masterTime, HUMAN_AUTHORITY_GATE_MS);
  const allowed = applyHumanDecision("APPROVED");
  assert.equal(allowed.masterTime, HUMAN_AUTHORITY_GATE_MS);
  const resumed = advanceReviewPlayback(allowed.masterTime, 1, "INTERACTIVE", "APPROVED");
  assert.ok(resumed.masterTime >= HUMAN_AUTHORITY_GATE_MS);
  assert.ok(resumed.masterTime < HUMAN_APPROVAL_EVIDENCED_MS);
});

test("interactive approval resumes the deterministic canonical branch to completion", () => {
  let masterTime = applyHumanDecision("APPROVED").masterTime;
  let complete = false;
  for (let step = 0; step < 2_000 && !complete; step += 1) {
    const result = advanceReviewPlayback(masterTime, 100, "INTERACTIVE", "APPROVED");
    masterTime = result.masterTime;
    complete = result.complete;
  }
  assert.equal(complete, true);
  assert.equal(masterTime, EXPERIENCE_DURATION_MS);
});

test("APPROVE is idempotent and the UI auto-resumes without a second Play action", () => {
  const first = applyHumanDecision("APPROVED");
  const repeated = applyHumanDecision("APPROVED");
  assert.deepEqual(repeated, first);
  const source = readFileSync(new URL("../app/OperationalCycleTable.tsx", import.meta.url), "utf8");
  assert.match(source, /setIsPlaying\(decision === "APPROVED"\)/);
  assert.match(source, /humanDecision === "APPROVED" && isPlaying/);
});

test("DENY is terminal and cannot cross the payment boundary", () => {
  const denied = applyHumanDecision("DENIED");
  assert.deepEqual(denied, { decision: "DENIED", masterTime: HUMAN_AUTHORITY_GATE_MS });
  assert.equal(constrainReviewTime(120_000, "INTERACTIVE", "DENIED"), HUMAN_AUTHORITY_GATE_MS);
  const attempted = advanceReviewPlayback(denied.masterTime, 60_000, "INTERACTIVE", "DENIED");
  assert.equal(attempted.masterTime, HUMAN_AUTHORITY_GATE_MS);
  assert.equal(attempted.pausedForAuthority, true);
  assert.equal(attempted.complete, false);
});

test("master recording mode invokes the frozen approve path without a timing deadlock", () => {
  assert.equal(effectiveHumanDecision("MASTER_RECORDING", "PENDING"), "APPROVED");
  let masterTime = 0;
  let complete = false;
  let steps = 0;
  while (!complete && steps < 2_000) {
    const result = advanceReviewPlayback(masterTime, 100, "MASTER_RECORDING", "PENDING");
    masterTime = result.masterTime;
    complete = result.complete;
    assert.equal(result.pausedForAuthority, false);
    steps += 1;
  }
  assert.equal(complete, true);
  assert.equal(masterTime, EXPERIENCE_DURATION_MS);
  assert.ok(steps < 2_000);
});

test("Cycle Receipt to transferred PEB remains explicit and verifier action remains detached", async () => {
  let stage = nextTransferStage("SOURCE", "GATHER");
  assert.equal(stage, "FORMED");
  assert.equal(nextTransferStage("SOURCE", "SEND"), "SOURCE");
  stage = nextTransferStage(stage, "SEND");
  assert.equal(stage, "TRANSFERRED");
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
});

test("time presentation is stable while canonical masterTime stays millisecond precise", () => {
  assert.equal(formatStableTimelineTime(84_251, "OVERVIEW", true), "01:24");
  assert.equal(formatStableTimelineTime(84_251, "MISSION", true), "01:24.2");
  assert.equal(formatStableTimelineTime(84_251, "FORENSIC", true), "01:24.251");
  assert.equal(formatStableTimelineTime(84_251, "OVERVIEW", false), "01:24.251");
  assert.equal(formatStableTimelineTime(120_000, "OVERVIEW", false), "02:00.000");
});

test("download and copy payload is byte-identical to the frozen D-005M PEB", () => {
  const artifact = readFileSync(new URL("../data/d005m-master-portable-evidence-bundle.json", import.meta.url));
  const transfer = Buffer.from(D005M_MASTER_BUNDLE_TEXT, "utf8");
  assert.deepEqual(transfer, artifact);
  assert.equal(createHash("sha256").update(transfer).digest("hex").toUpperCase(), "0D1C30D1442670218966A21A2EBA74DF82B081BECF75F62269423343AEEBCF31");
});

test("governed review state has no wall clock, randomness, or hidden timer", () => {
  const source = readFileSync(new URL("../app/reviewFlow.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /Date\.now|new Date|performance\.now|Math\.random|setTimeout|setInterval|requestAnimationFrame/);
});

test("the UI does not discard throttled requestAnimationFrame elapsed time", () => {
  const source = readFileSync(new URL("../app/OperationalCycleTable.tsx", import.meta.url), "utf8");
  assert.match(source, /const elapsed = Math\.max\(0, frameTime - previous\)/);
  assert.match(source, /elapsedFromAnchor \+= elapsed/);
  assert.match(source, /advanceReviewPlayback\(anchorMasterTime, elapsedFromAnchor, reviewMode, humanDecision\)/);
  assert.doesNotMatch(source, /Math\.min\(100, Math\.max\(0, frameTime - previous\)\)/);
  const throttled = advanceReviewPlayback(85_000, 5_000, "MASTER_RECORDING", "PENDING");
  assert.ok(throttled.masterTime > 85_000);
  assert.equal(throttled.pausedForAuthority, false);
});

test("anchored playback preserves sub-millisecond canonical progress across tiny frames", () => {
  let independentlyRounded = 85_000;
  for (let frame = 0; frame < 1_000; frame += 1) {
    independentlyRounded = advanceReviewPlayback(independentlyRounded, 1, "MASTER_RECORDING", "PENDING").masterTime;
  }
  const anchored = advanceReviewPlayback(85_000, 1_000, "MASTER_RECORDING", "PENDING").masterTime;
  assert.equal(independentlyRounded, 85_000);
  assert.ok(anchored > 85_000);
});

test("D-005G interaction and transfer controls stay explicit in the UI source", () => {
  const source = readFileSync(new URL("../app/OperationalCycleTable.tsx", import.meta.url), "utf8");
  assert.match(source, /useState<ReviewMode>\("INTERACTIVE"\)/);
  assert.match(source, /onClick=\{\(\) => decide\("APPROVED"\)\}/);
  assert.match(source, /onClick=\{\(\) => decide\("DENIED"\)\}/);
  assert.match(source, /nextTransferStage\(bundleStage, "GATHER"\)/);
  assert.match(source, /nextTransferStage\(bundleStage, "SEND"\)/);
  assert.match(source, /onClick=\{runVerification\}/);
  assert.match(source, /navigator\.clipboard\.writeText\(D005M_MASTER_BUNDLE_TEXT\)/);
  assert.doesNotMatch(source, />Show QR</);
  assert.doesNotMatch(source, /127\.0\.0\.1/);
});

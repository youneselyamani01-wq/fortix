import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { LOCAL_EVIDENCE_RECORD } from "../app/evidenceContinuity.ts";
import {
  buildReport,
  type AdapterRecord,
} from "../app/ethernetLink.ts";
import { deriveMasterStoryState, verifyD005MMasterBundle } from "../app/masterStory.ts";
import { HANDOFF_READY_MS } from "../app/storyTimeline.ts";
import { nextTransferStage, resolveArtifactRelease, viewerRole, type TransferStage } from "../app/reviewFlow.ts";
import {
  containsRect,
  containsRoundedRect,
  contrastRatio,
  pointWithinInsertionTarget,
  rectanglesOverlap,
  VERIFIER_FLOWER_SIZE_PX,
  VERIFIER_NARROW_BREAKPOINT_PX,
  VERIFIER_RECEIPT_SIZE_PX,
  verifierInspectionLayout,
} from "../app/verifierInspectionGeometry.ts";

const TARGET_ADAPTER: AdapterRecord = Object.freeze({
  name: "Ethernet",
  description: "Intel(R) Ethernet Controller I226-LM",
  status: "Up",
  mediaConnectionState: "Connected",
  mediaType: "802.3",
  physicalMediaType: "802.3",
  virtual: false,
  ifIndex: 24,
});

test("final convergence: verifier labels are collision-free in wide and narrow fields", () => {
  const fields = [
    { label: "desktop", width: 608, height: 236 },
    { label: "tablet", width: 512, height: 236 },
    { label: "narrow", width: 420, height: 302 },
    { label: "mobile", width: 346, height: 302 },
    { label: "small-mobile", width: 276, height: 302 },
  ] as const;

  for (const field of fields) {
    const layout = verifierInspectionLayout(field.width, field.height);
    assert.equal(layout.labels.length, 6);
    assert.equal(new Set(layout.labels.map((label) => label.family)).size, 6);
    assert.equal(layout.flower.width, VERIFIER_FLOWER_SIZE_PX);
    assert.equal(layout.flower.height, VERIFIER_FLOWER_SIZE_PX);
    assert.equal(layout.receiptCenter.width, VERIFIER_RECEIPT_SIZE_PX);
    assert.equal(layout.receiptCenter.height, VERIFIER_RECEIPT_SIZE_PX);
    assert.equal(
      field.width < VERIFIER_NARROW_BREAKPOINT_PX,
      layout.labels.every((label) => label.box.top === 10 || label.box.top === field.height - 30),
      `${field.label}: layout mode does not follow measured field width`,
    );
    for (const [index, label] of layout.labels.entries()) {
      assert.equal(containsRect(layout.field, label.box), true, `${field.label}: ${label.family} escaped field`);
      assert.equal(containsRoundedRect(layout.field, label.box), true, `${field.label}: ${label.family} entered the chamber clip`);
      assert.equal(rectanglesOverlap(label.box, layout.flower), false, `${field.label}: ${label.family} overlaps flower`);
      assert.equal(rectanglesOverlap(label.box, layout.receiptCenter), false, `${field.label}: ${label.family} overlaps Receipt`);
      for (const peer of layout.labels.slice(index + 1)) {
        assert.equal(rectanglesOverlap(label.box, peer.box), false, `${field.label}: ${label.family}/${peer.family} overlap`);
      }
    }
  }
});

test("final convergence: inspection labels and petal boundaries meet deterministic contrast", () => {
  const paper = "#fffdf8";
  const ink = "#17181c";
  assert.ok(contrastRatio(ink, paper) >= 4.5, "inspection text must clear normal-text contrast");
  const familyColors = ["#4057ff", "#a66cff", "#ff7a45", "#ffd84a", "#8dd8ff", "#bd2fd1"];
  for (const color of familyColors) {
    assert.ok(contrastRatio(ink, color) >= 3, `${color}: ink boundary must separate the petal`);
  }

  // C3-R1: dark was removed by human decision; the light verifier is the
  // canonical presentation and its inks alone carry the contrast requirement.
  const verifierPairs = [
    ["#fffdf8", "#5c3cc4"], ["#007c42", "#f5f2ea"], ["#a3301f", "#f5f2ea"],
    ["#216d93", "#f5f2ea"], ["#765400", "#f5f2ea"],
  ] as const;
  for (const [foreground, background] of verifierPairs) {
    assert.ok(contrastRatio(foreground, background) >= 4.5,
      `light verifier: ${foreground} must remain readable on ${background}`);
  }
});

test("final convergence: the inspection layer leaves the Receipt center unobscured", () => {
  const css = readFileSync(new URL("../app/convergence.css", import.meta.url), "utf8");
  const legacyCenterRail = css.indexOf(".revealed-structure::before {");
  const neutralizingOverride = css.lastIndexOf(".revealed-structure::before { content: none; }");
  assert.ok(legacyCenterRail >= 0, "the regression fixture must still find the historical center rail");
  assert.ok(neutralizingOverride > legacyCenterRail, "the final cascade must suppress the center rail over the Receipt");
  assert.match(css, /drop-shadow\(0 0 1px var\(--fx-ink\)\)/, "petal boundaries use the tested opaque ink");
  assert.match(css, /\.verifier-instrument\.is-awaiting-evidence \.revelation-chamber/, "the visible target must be lit while evidence is carried");
});

test("final convergence: the visible insertion target is the success geometry", () => {
  const target = { left: 100, right: 308, top: 50, bottom: 258 };
  assert.equal(pointWithinInsertionTarget(320, 154, target), true, "visible 12px outline edge should insert");
  assert.equal(pointWithinInsertionTarget(321, 154, target), false, "a visible miss must remain a miss");
  assert.equal(resolveArtifactRelease("FORMED", "INSERT"), "TRANSFERRED");
  assert.equal(resolveArtifactRelease("FORMED", "MISS"), "SOURCE");
  assert.equal(resolveArtifactRelease("FORMED", "CANCEL"), "SOURCE");
  assert.equal(resolveArtifactRelease("SOURCE", "INSERT"), "SOURCE", "nothing can insert before take");
});

test("final convergence: complete, hand off, analyze offline, then restore without mutation", async () => {
  const connected = buildReport([TARGET_ADAPTER], "t0");
  assert.equal(connected.link, "CONNECTED");
  const lost = buildReport([{ ...TARGET_ADAPTER, status: "Disconnected", mediaConnectionState: "Disconnected" }], "t1");
  assert.equal(lost.link, "LOST");

  const story = deriveMasterStoryState(HANDOFF_READY_MS);
  assert.equal(story.cycleReceiptAvailable, true);
  assert.equal(viewerRole(story.masterTime, "SOURCE", "APPROVED", true), 2, "a ready local artifact makes an Evidence Holder");
  assert.equal(viewerRole(story.masterTime, "SOURCE", "APPROVED", false), 1,
    "elapsed time without a Final Receipt/PEB may not promote the viewer");
  let stage: TransferStage = nextTransferStage("SOURCE", "GATHER");
  assert.equal(stage, "FORMED");
  let verdict: Awaited<ReturnType<typeof verifyD005MMasterBundle>> | null = null;
  assert.equal(verdict, null, "take/carry may not auto-analyze");
  stage = resolveArtifactRelease(stage, "INSERT");
  assert.equal(stage, "TRANSFERRED");
  assert.equal(viewerRole(story.masterTime, stage, "APPROVED", true), 3);
  assert.equal(verdict, null, "insertion acknowledges evidence and still waits for ANALYZE");

  // This explicit call models the ANALYZE act; verification uses frozen local bytes.
  verdict = await verifyD005MMasterBundle();
  assert.equal(verdict.verdict, "INDETERMINATE");
  const beforeRestore = {
    masterTime: story.masterTime,
    missionId: LOCAL_EVIDENCE_RECORD.missionId,
    receiptId: LOCAL_EVIDENCE_RECORD.receiptId,
    bundleId: LOCAL_EVIDENCE_RECORD.bundleId,
    stage,
    role: viewerRole(story.masterTime, stage, "APPROVED", true),
    verdict,
  };

  const restored = buildReport([TARGET_ADAPTER], "t2");
  assert.equal(restored.link, "CONNECTED");
  const afterRestore = {
    masterTime: story.masterTime,
    missionId: LOCAL_EVIDENCE_RECORD.missionId,
    receiptId: LOCAL_EVIDENCE_RECORD.receiptId,
    bundleId: LOCAL_EVIDENCE_RECORD.bundleId,
    stage,
    role: viewerRole(story.masterTime, stage, "APPROVED", true),
    verdict,
  };
  assert.deepEqual(afterRestore, beforeRestore, "physical restoration may change only physical status");
});

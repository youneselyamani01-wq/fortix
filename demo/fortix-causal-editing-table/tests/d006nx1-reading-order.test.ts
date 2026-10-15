import assert from "node:assert/strict";
import test from "node:test";

import { buildReport, type AdapterRecord } from "../app/ethernetLink.ts";
import { MISSION_ID } from "../app/missionContinuity.ts";
import { PhysicalNetworkTransitionMachine } from "../app/networkTransitions.ts";
import { EPISODE_ORDER, derivePublicExperience, type PublicEvidence } from "../app/nx/adapter/publicExperienceAdapter.ts";
import type { EngineSnapshot } from "../app/nx/adapter/engineSnapshot.ts";
import { journalAt } from "../app/nx/adapter/useMissionEngine.ts";
import { chaptersOf, layoutProof, readingOrder, readingRows } from "../app/nx/evidence/proofGeometry.ts";
import { createOfflineEvidenceSession, type OfflineEvidenceSession } from "../app/offlineEvidence.ts";
import { derivePassengerPresentation } from "../app/passengerPresentation.ts";
import { admitPhysicalObservation } from "../app/physicalLinkRuntime.ts";
import { derivePhysicalState } from "../app/physicalState.ts";
import { buildMissionEvidenceClosure, finalReceiptRuntimeEvidencePrefix, issueFinalMissionReceipt } from "../app/portableMissionEvidence.ts";
import { projectReceiptBindings } from "../app/receiptProjection.ts";
import { CANONICAL_ROUTING_PROVENANCE, deriveRoutingState } from "../app/routingProvenance.ts";
import { EXPERIENCE_DURATION_MS, FINAL_RECEIPT_EMITTED_MS } from "../app/storyTimeline.ts";
import { derivePresentationMotion } from "../app/vehiclePresentation.ts";
import { VISUAL_EVENTS } from "../app/visualEvents.ts";
import { modelAt } from "./support/modelAt.ts";

/**
 * D-006 NX1 Checkpoint B R2 §24 — READING ORDER.
 * The vertical axis is the human reading order: deterministic, causal,
 * chronological, stable across rerenders, scrubs and viewports; provenance
 * moves a bead sideways only.
 */

const FULL = modelAt(EXPERIENCE_DURATION_MS);
const items = FULL.model.accumulatedEvidence.items;
const branches = FULL.model.accumulatedEvidence.branches;
const byId = new Map(items.map((entry) => [entry.evidenceId, entry] as const));
const byEvent = (eventId: string) => items.find((entry) => entry.eventId === eventId)!;
const laid = layoutProof({ items, branches, finalReceipt: true, widthPx: 1280, heightPx: 560 });
const rankOf = new Map(laid.beads.map((bead) => [bead.evidenceId, bead.rank] as const));
const rowOf = new Map(laid.beads.map((bead) => [bead.evidenceId, bead.row] as const));

test("B R2 §24: every nano-receipt receives one deterministic progression rank and row; no visual child precedes its rendered parent", () => {
  const ranks = laid.beads.map((bead) => bead.rank);
  assert.deepEqual([...ranks].sort((left, right) => left - right), items.map((_, index) => index), "ranks are exactly 0…n−1");
  assert.deepEqual(readingRows(items).order, readingOrder(items).map((entry) => entry.evidenceId));
  // Rows follow ranks (never decreasing), one row per receipt except a shared moment.
  const inRank = [...laid.beads].sort((left, right) => left.rank - right.rank);
  for (let index = 1; index < inRank.length; index += 1) assert.ok(inRank[index]!.row >= inRank[index - 1]!.row, "rows never go back up the page");
  assert.ok(laid.rows >= items.length - 3 && laid.rows <= items.length, `one row per receipt but for the shared moments: ${laid.rows} rows for ${items.length} receipts`);
  for (const entry of items) {
    for (const parent of [...entry.causalParents, ...entry.observedInputs]) {
      if (!byId.has(parent)) continue;
      assert.ok(rankOf.get(parent)! < rankOf.get(entry.evidenceId)!, `${parent} is read before ${entry.evidenceId}`);
      assert.ok(rowOf.get(parent)! < rowOf.get(entry.evidenceId)!, `${parent} sits above ${entry.evidenceId}`);
    }
  }
});

test("B R2 §24: actual evidence time is respected; the engine's admission order is the deterministic tie-break", () => {
  const order = readingOrder(items);
  for (let index = 1; index < order.length; index += 1) {
    const previous = order[index - 1]!;
    const current = order[index]!;
    assert.ok(previous.timeMs <= current.timeMs, `${previous.evidenceId} (${previous.timeMs}) before ${current.evidenceId} (${current.timeMs})`);
    if (previous.timeMs === current.timeMs) assert.ok(previous.admissionIndex < current.admissionIndex, `${previous.evidenceId} was admitted before ${current.evidenceId}`);
  }
  // The admission index is the closure's own member order — never a number the presentation invents.
  const members = FULL.snapshot.closure!.members;
  for (const entry of items) assert.equal(members[entry.admissionIndex]?.evidenceId, entry.evidenceId, `${entry.evidenceId}: admission index is its closure member index`);
  // The adapter's list is already in reading order: the proof and the dossier read the same story.
  assert.deepEqual(items.map((entry) => entry.evidenceId), order.map((entry) => entry.evidenceId));
  // A moment shared by two receipts exists in the dataset, so the tie-break is exercised.
  assert.ok(order.some((entry, index) => index > 0 && order[index - 1]!.timeMs === entry.timeMs), "the dataset has shared moments");
});

test("B R2 §24: the ordering is stable across rerenders and across scrub / replay — every earlier moment is a prefix of the full story", () => {
  const again = layoutProof({ items, branches, finalReceipt: true, widthPx: 1280, heightPx: 560 });
  assert.deepEqual(again.beads, laid.beads, "the same input, the same placement, bead for bead");
  const full = readingRows(items).order;
  for (const at of [12_500, 60_000, 20_000, 90_000, 30_000, EXPERIENCE_DURATION_MS, 60_000]) {
    const then = modelAt(at);
    const order = readingRows(then.model.accumulatedEvidence.items).order;
    assert.deepEqual(order, full.slice(0, order.length), `at ${at}: the reading order is a prefix of the full one`);
    const rows = readingRows(then.model.accumulatedEvidence.items);
    for (const id of order) assert.equal(rows.rowOf.get(id), rowOf.get(id), `at ${at}: ${id} keeps its row`);
  }
});

test("B R2 §24: changing the viewport does not reorder the narrative; provenance changes horizontal position only", () => {
  for (const [widthPx, heightPx] of [[1180, 425], [980, 330], [1280, 1400], [600, 300]] as const) {
    const other = layoutProof({ items, branches, finalReceipt: true, widthPx, heightPx });
    assert.deepEqual(other.beads.map((bead) => [bead.evidenceId, bead.rank, bead.row]), laid.beads.map((bead) => [bead.evidenceId, bead.rank, bead.row]), `${widthPx} × ${heightPx}`);
  }
  // Reversing the lane order moves every bead sideways and nothing else.
  const mirrored = layoutProof({ items, branches: [...branches].reverse(), finalReceipt: true, widthPx: 1280, heightPx: 560 });
  assert.deepEqual(mirrored.beads.map((bead) => [bead.evidenceId, bead.rank, bead.row, bead.y]), laid.beads.map((bead) => [bead.evidenceId, bead.rank, bead.row, bead.y]));
  for (const bead of mirrored.beads) {
    const column = [...branches].reverse().indexOf(bead.branch);
    assert.equal(bead.x, mirrored.gutter + (column + 0.5) * mirrored.laneWidth);
    if (column !== branches.indexOf(bead.branch)) assert.notEqual(bead.x, laid.beads.find((candidate) => candidate.evidenceId === bead.evidenceId)!.x);
  }
  // A lane's beads share one x; two lanes never share an x.
  const xByLane = new Map<string, Set<number>>();
  for (const bead of laid.beads) xByLane.set(bead.branch, new Set([...(xByLane.get(bead.branch) ?? []), bead.x]));
  for (const [lane, xs] of xByLane) assert.equal(xs.size, 1, `${lane}: one column`);
  assert.equal(new Set([...xByLane.values()].map((xs) => [...xs][0])).size, xByLane.size);
});

test("B R2 §24: independent parallel evidence is handled deterministically — a shared moment, different lanes, no relation: one row; the same lane or another episode: adjacent rows", () => {
  const routeB = byEvent("d005.route-b-executed");
  const reroute = byEvent("d006nx0.action:reroute");
  assert.equal(routeB.timeMs, reroute.timeMs, "the provider's route and the vehicle's reroute are one moment");
  assert.notEqual(routeB.branch, reroute.branch);
  assert.equal(routeB.episode, reroute.episode);
  assert.equal([...reroute.causalParents, ...reroute.observedInputs].includes(routeB.evidenceId), false, "neither is the other's parent");
  assert.equal(rowOf.get(routeB.evidenceId), rowOf.get(reroute.evidenceId), "parallel evidence shares a row");
  assert.ok(rankOf.get(routeB.evidenceId)! < rankOf.get(reroute.evidenceId)!, "and still has a deterministic reading rank");
  // One moment, two episodes: the chapter boundary wins — the light's first green opens the stop at the light on its own row.
  const route = byEvent("d005.pickup-route");
  const green = byEvent("d006g.signal-state-published:green-1");
  assert.equal(route.timeMs, green.timeMs);
  assert.notEqual(route.episode, green.episode);
  assert.equal(rowOf.get(green.evidenceId), rowOf.get(route.evidenceId)! + 1, "a new episode starts a new row");
  const eta = byEvent("d005.eta-deteriorates");
  const brake = byEvent("d006nx0.action:hazard-brake");
  assert.equal(eta.timeMs, brake.timeMs);
  assert.equal(eta.branch, brake.branch, "both in the vehicle lane");
  assert.equal(rowOf.get(brake.evidenceId), rowOf.get(eta.evidenceId)! + 1, "the same lane takes the next row, in admission order");
  // A shared moment never levels a parent with its child.
  for (const entry of items) {
    for (const parent of [...entry.causalParents, ...entry.observedInputs]) {
      if (byId.has(parent) && byId.get(parent)!.timeMs === entry.timeMs) assert.ok(rowOf.get(parent)! < rowOf.get(entry.evidenceId)!, `${parent} → ${entry.evidenceId}`);
    }
  }
});

// ---------------------------------------------------------------------------
// A run the engine actually produced with a physical network loss: the
// interleaved record and the post-seal zone the deterministic run cannot show.
// ---------------------------------------------------------------------------

const NETWORK_RUN_ID = "fortix.demo.d006nx1.run.reading-order-network";
const I226: AdapterRecord = Object.freeze({ name: "Ethernet", description: "Intel(R) Ethernet Controller I226-LM", status: "Up", mediaConnectionState: "Connected", mediaType: "802.3", physicalMediaType: "802.3", virtual: false, ifIndex: 26 });
const T0 = Date.UTC(2026, 8, 6, 9, 0, 0);
const report = (link: "CONNECTED" | "LOST", second: number) => buildReport([{ ...I226, status: link === "CONNECTED" ? "Up" : "Disconnected", mediaConnectionState: link === "CONNECTED" ? "Connected" : "Disconnected" }], new Date(T0 + second * 1_000).toISOString());

function networkRun() {
  let session: OfflineEvidenceSession = journalAt(createOfflineEvidenceSession(NETWORK_RUN_ID, null, MISSION_ID), 40_000);
  let machine = new PhysicalNetworkTransitionMachine({ runId: NETWORK_RUN_ID, initialState: session.networkState });
  const observe = (link: "CONNECTED" | "LOST", second: number, masterTimeMs: number) => {
    const outcome = admitPhysicalObservation({ session: journalAt(session, masterTimeMs), machine, report: report(link, second), nowEpochMs: T0 + second * 1_000 + 100, masterTimeMs });
    machine = outcome.machine;
    session = outcome.kind === "TRANSITION" ? outcome.session : journalAt(session, masterTimeMs);
  };
  // The cable is pulled inside the route to the garage, and comes back later.
  observe("CONNECTED", 0, 40_000);
  observe("CONNECTED", 1, 40_000);
  observe("LOST", 2, 41_000);
  observe("LOST", 3, 41_500);
  session = journalAt(session, EXPERIENCE_DURATION_MS);
  observe("CONNECTED", 200, EXPERIENCE_DURATION_MS);
  observe("CONNECTED", 201, EXPERIENCE_DURATION_MS);
  const records = session.finalReceiptRuntimeSeal === null ? session.records : finalReceiptRuntimeEvidencePrefix(session);
  const closure = buildMissionEvidenceClosure({ identity: { missionId: MISSION_ID, runId: NETWORK_RUN_ID }, runtimeRecords: records, asOfMasterTimeMs: FINAL_RECEIPT_EMITTED_MS });
  const finalReceipt = issueFinalMissionReceipt(closure, FINAL_RECEIPT_EMITTED_MS);
  const physical = derivePhysicalState(EXPERIENCE_DURATION_MS, true);
  const snapshot: EngineSnapshot = {
    masterTimeMs: EXPERIENCE_DURATION_MS, effectiveStoryTimeMs: EXPERIENCE_DURATION_MS, playing: false, session, closure, closureReason: null,
    receiptBindings: projectReceiptBindings(closure, VISUAL_EVENTS), finalReceipt, humanDecision: "APPROVED",
    networkState: session.networkState, linkObservationCurrent: true, linkPhase: "CONNECTED", sentinelReachable: true, transitionFlash: null,
    unsequencedObservation: null, reconciliation: null, baseTransfer: null, syncPhase: "IDLE", portablePeb: null, handoffArtifact: null,
    transferStage: "SOURCE", analysisRequested: false, verification: null, handoffNetworkState: null, verdictNetworkState: null,
    physical, motion: derivePresentationMotion(EXPERIENCE_DURATION_MS, true), passenger: derivePassengerPresentation(EXPERIENCE_DURATION_MS, physical.passengerState),
    routing: deriveRoutingState(EXPERIENCE_DURATION_MS, CANONICAL_ROUTING_PROVENANCE),
  };
  return derivePublicExperience(snapshot);
}

test("B R2 §4/§6/§19: a real run with a physical loss reads in order — the interleaved record opens its own chapter, the post-seal records sit below the seal in admission order", () => {
  const model = networkRun();
  const run = model.accumulatedEvidence.items;
  assert.ok(run.length > items.length, `the run carries the physical records too: ${run.length} vs ${items.length}`);
  assert.ok(model.accumulatedEvidence.journalCount >= 1, "at least one record was appended after the seal");
  const laid = layoutProof({ items: run, branches: model.accumulatedEvidence.branches, finalReceipt: true, widthPx: 1280, heightPx: 560 });
  const place = new Map(laid.beads.map((bead) => [bead.evidenceId, bead] as const));
  const present = new Map(run.map((entry) => [entry.evidenceId, entry] as const));
  // Every declared parent is read and drawn strictly above its child, in both zones.
  for (const entry of run) {
    for (const parent of [...entry.causalParents, ...entry.observedInputs]) {
      if (!present.has(parent)) continue;
      assert.ok(place.get(parent)!.rank < place.get(entry.evidenceId)!.rank, `${parent} is read before ${entry.evidenceId}`);
      assert.ok(place.get(parent)!.y < place.get(entry.evidenceId)!.y, `${parent} sits above ${entry.evidenceId}`);
    }
  }
  // The post-seal records are below the Final Receipt and the zone label, in admission order.
  const journal = laid.beads.filter((bead) => bead.zone === "journal");
  assert.equal(journal.length, model.accumulatedEvidence.journalCount);
  for (const bead of journal) {
    assert.ok(laid.finalY !== null && bead.y > laid.finalY, `${bead.evidenceId} is below the Final Receipt`);
    assert.ok(laid.postSealY !== null && bead.y > laid.postSealY, `${bead.evidenceId} is inside the post-seal zone`);
  }
  const journalOrder = journal.map((bead) => bead.evidenceId);
  assert.deepEqual(journalOrder, run.filter((entry) => entry.standing === "JOURNAL").map((entry) => entry.evidenceId), "the zone keeps the engine's admission order");
  // The physical loss is a sealed receipt of the network lane that opens its own chapter,
  // between two runs of the episode it interrupted: chapters stay contiguous and truthful.
  const lost = run.find((entry) => entry.eventType === "NETWORK_LINK_LOST")!;
  assert.equal(lost.standing, "CLOSURE");
  assert.equal(lost.branch, "network");
  assert.equal(lost.episode, "network");
  const episodes = laid.chapters.map((chapter) => chapter.episode);
  assert.ok(episodes.filter((episode) => episode === "network").length >= 1, `the run has a network chapter: ${episodes.join(" > ")}`);
  const networkIndex = episodes.indexOf("network");
  assert.ok(networkIndex > 0 && networkIndex < episodes.length - 1, "the interleaved chapter sits between two others, not at an end");
  assert.equal(episodes[networkIndex - 1], episodes[networkIndex + 1], "the episode it interrupted resumes after it — the same episode is allowed to return");
  for (let index = 1; index < laid.chapters.length; index += 1) assert.equal(laid.chapters[index]!.fromRow, laid.chapters[index - 1]!.toRow + 1, "no gap and no overlap");
  for (const entry of run) {
    const row = place.get(entry.evidenceId)!;
    if (row.zone !== "closure") continue;
    assert.equal(laid.chapters.find((chapter) => chapter.fromRow <= row.row && row.row <= chapter.toRow)!.episode, entry.episode, entry.evidenceId);
  }
  // Scrub stability on this one session: every earlier reading order is a prefix of the full one.
  const full = readingRows(run).order;
  for (const at of [50_000, 90_000, EXPERIENCE_DURATION_MS]) {
    const earlier = readingRows(run.filter((entry) => entry.timeMs <= at)).order;
    assert.deepEqual(earlier, full.slice(0, earlier.length), `at ${at}`);
  }
});

test("B R2 §4/§7: the geometry enforces its own invariants — a parent whose time is later is still read first, and a lane the caller did not declare gets its own column", () => {
  const bead = (evidenceId: string, branch: PublicEvidence["branch"], timeMs: number, admissionIndex: number, parents: readonly string[] = []): PublicEvidence => ({
    ...items[0]!, evidenceId, eventId: evidenceId, branch, timeMs, admissionIndex, causalParents: parents, observedInputs: [], episode: "missionStart", standing: "CLOSURE",
  });
  // A declared parent recorded with a LATER evidence time than its child: the
  // reading order puts it first anyway, and the thread runs downward.
  const parent = bead("PROBE-PARENT", "city", 100, 0);
  const child = bead("PROBE-CHILD", "vehicle", 50, 1, ["PROBE-PARENT"]);
  const inverted = layoutProof({ items: [parent, child], branches: ["city", "vehicle"], finalReceipt: false, widthPx: 1200, heightPx: 400 });
  const at = new Map(inverted.beads.map((placement) => [placement.evidenceId, placement] as const));
  assert.equal(readingOrder([parent, child]).map((entry) => entry.evidenceId)[0], "PROBE-PARENT", "a declared parent is never read after its child");
  assert.ok(at.get("PROBE-PARENT")!.rank < at.get("PROBE-CHILD")!.rank);
  assert.ok(at.get("PROBE-PARENT")!.y < at.get("PROBE-CHILD")!.y, "and never drawn below it");
  assert.equal(inverted.threads.length, 1);
  assert.ok(inverted.threads[0]!.d.startsWith(`M ${at.get("PROBE-PARENT")!.x} ${at.get("PROBE-PARENT")!.y}`), "the thread runs from the parent downward");
  // A lane missing from the declared branches is never filed under another one.
  const unresolved = layoutProof({ items: [bead("PROBE-A", "city", 0, 0), bead("PROBE-U", "unresolved", 1, 1), bead("PROBE-V", "vehicle", 2, 2)], branches: ["city", "vehicle"], finalReceipt: false, widthPx: 1200, heightPx: 400 });
  const columns = new Map(unresolved.beads.map((placement) => [placement.evidenceId, placement.x] as const));
  assert.equal(unresolved.columns, 3, "the undeclared lane takes its own column");
  assert.equal(new Set(columns.values()).size, 3, "no two lanes share an x");
  assert.notEqual(columns.get("PROBE-U"), columns.get("PROBE-A"));
});

test("B R2 §6: chapters are the episodes in reading order — contiguous, in canonical episode order for this run, starting at the first row", () => {
  const rows = readingRows(items);
  const chapters = chaptersOf(rows.episodeOfRow);
  assert.equal(chapters[0]!.fromRow, 0);
  for (let index = 1; index < chapters.length; index += 1) assert.equal(chapters[index]!.fromRow, chapters[index - 1]!.toRow + 1, "no gap and no overlap between chapters");
  assert.equal(chapters.at(-1)!.toRow, rows.rowCount - 1);
  const episodes = chapters.map((chapter) => chapter.episode);
  assert.deepEqual(episodes, EPISODE_ORDER.filter((episode) => episodes.includes(episode)), "this run's chapters follow the canonical episode order without returning to an earlier one");
  assert.ok(episodes.length >= 5, `several chapters: ${episodes.join(" > ")}`);
  assert.deepEqual(laid.chapters.map((chapter) => chapter.episode), episodes);
  // Every receipt's row lies inside its own episode's chapter.
  for (const entry of items) {
    const row = rowOf.get(entry.evidenceId)!;
    const chapter = laid.chapters.find((candidate) => candidate.fromRow <= row && row <= candidate.toRow)!;
    assert.equal(chapter.episode, entry.episode, entry.evidenceId);
  }
  // A chapter break is a small gap, not a card: less than one pitch, never less than the floor.
  for (let index = 1; index < laid.chapters.length; index += 1) {
    const previous = laid.chapters[index - 1]!;
    const chapter = laid.chapters[index]!;
    assert.equal(chapter.labelY - previous.bottom, laid.episodeGap);
    assert.ok(laid.episodeGap < laid.pitch);
  }
  // Interleaved evidence (a physical network record in the middle of a journey) opens its own short chapter, truthfully.
  const interleaved = chaptersOf(["missionStart", "signalStop", "signalStop", "network", "signalStop", "passenger"]);
  assert.deepEqual(interleaved.map((chapter) => [chapter.episode, chapter.fromRow, chapter.toRow]), [["missionStart", 0, 0], ["signalStop", 1, 2], ["network", 3, 3], ["signalStop", 4, 4], ["passenger", 5, 5]]);
});

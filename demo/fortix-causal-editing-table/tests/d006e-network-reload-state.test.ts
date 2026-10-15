import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  PHYSICAL_SENTINEL_SOURCE,
  TARGET_ADAPTER_IDENTITY,
  appendNetworkTransition,
  canonicalRecordDigest,
  createOfflineEvidenceSession,
} from "../app/offlineEvidence.ts";
import { MISSION_ID } from "../app/missionContinuity.ts";
import { PhysicalNetworkTransitionMachine } from "../app/networkTransitions.ts";
import { isRunPersistencePairCoherent, isRunResumable, parseRunSession } from "../app/missionRun.ts";

/**
 * D-006E — what a page reload may and may not restore.
 *
 * Two reports, one file. They are stages of the same question: which parts
 * of a previous page load are still true after a reload?
 *
 * FIRST (RESTORED persisting across reload). After completing a run, the
 * network indicator still read RESTORED although the physical I226-LM was
 * CONNECTED. Traced, not assumed: `PhysicalNetworkTransitionMachine` maps
 * both CONNECTED and RESTORED to a connected physical link
 * (`#physicalLink()`), so a live poll of a connected cable merely confirms
 * an already-RESTORED machine — only `acknowledgeReconciliation()` can leave
 * that state. A persisted snapshot stuck at RESTORED was therefore hydrated
 * as the displayed state with no independent check. The fix did not touch
 * the machine's transition rules; it changed what mount trusts.
 *
 * SECOND (active mission isolation). A fresh launch, cable connected,
 * already showed a PREVIOUS run's NR-NET-LOST and reconciliation node.
 * Root cause: both storage keys derived from the canonical chain id — one
 * constant, one slot, reused by every demonstration — and mount restored
 * whatever it found there.
 *
 * The second fix subsumes the first. Storage is now per mission run, and a
 * run is rehydrated only while its offline window is still OPEN. The
 * stale-RESTORED case (evidence reconciled, machine cached RESTORED) is no
 * longer repaired at mount because it can no longer be reached: such a run
 * is not resumable, is never rehydrated, and the new run that replaces it
 * starts from a machine that has observed nothing. What was a self-heal is
 * now a structural guarantee, which is the stronger form of the same
 * property.
 */

const component = readFileSync(new URL("../app/ConvergenceExperience.tsx", import.meta.url), "utf8");
const evidenceModel = readFileSync(new URL("../app/offlineEvidence.ts", import.meta.url), "utf8");
const missionRun = readFileSync(new URL("../app/missionRun.ts", import.meta.url), "utf8");

function mountRestoreEffectSource(): string {
  const start = component.indexOf("const pointer = parseRunPointer(window.localStorage.getItem(ACTIVE_RUN_POINTER_KEY));");
  const end = component.indexOf("}, [beginMissionRun]);", start);
  assert.ok(start >= 0 && end > start, "the mount-time restore effect was not found");
  return component.slice(start, end);
}

test("D-006 C1: persisted machine/session pairs reject every torn transition boundary", () => {
  const runId = "fortix.demo.d006e.run.20260901T120000-paircheck";
  const connected = createOfflineEvidenceSession(runId, null, MISSION_ID);
  const machine = new PhysicalNetworkTransitionMachine({
    runId,
    initialState: connected.networkState,
  });
  const connectedSnapshot = machine.snapshot();
  assert.equal(isRunPersistencePairCoherent(connected, connectedSnapshot), true,
    "the new run starts from one journal-aligned CONNECTED baseline");

  const lost = appendNetworkTransition(connected, {
    runId,
    observationId: "paircheck-loss-observation",
    adapterIdentity: TARGET_ADAPTER_IDENTITY,
    observationSource: PHYSICAL_SENTINEL_SOURCE,
    previousNetworkState: "CONNECTED",
    newNetworkState: "LOST",
    missionClockPosition: 1,
  }).session;
  const lostSnapshot = {
    ...connectedSnapshot,
    state: "LOST" as const,
    lastMissionClockMs: 1,
    causalOrder: 1,
    transitionSequence: 1,
  };
  assert.equal(isRunPersistencePairCoherent(lost, lostSnapshot), true);

  assert.equal(isRunPersistencePairCoherent(connected, lostSnapshot), false,
    "an advanced machine without its journal receipt is a torn write");
  assert.equal(isRunPersistencePairCoherent(lost, connectedSnapshot), false,
    "an advanced journal without its derived machine cache is a torn write");
  assert.equal(isRunPersistencePairCoherent(lost, { ...lostSnapshot, transitionSequence: 0 }), false);
  assert.equal(isRunPersistencePairCoherent(lost, { ...lostSnapshot, causalOrder: 0 }), false);
  assert.equal(isRunPersistencePairCoherent(lost, { ...lostSnapshot, lastMissionClockMs: 2 }), false);
  assert.equal(isRunPersistencePairCoherent(
    connected,
    { ...connectedSnapshot, state: "UNKNOWN" } as never,
  ), false);
  assert.equal(isRunPersistencePairCoherent(lost, { ...lostSnapshot, runId: `${runId}.other` }), false);

  const forgedConnectedSession = { ...lost, networkState: "CONNECTED" as const };
  const forgedConnectedSnapshot = { ...lostSnapshot, state: "CONNECTED" as const };
  assert.equal(isRunPersistencePairCoherent(forgedConnectedSession, forgedConnectedSnapshot), false,
    "matching sidecars cannot overrule the terminal NETWORK_LINK_LOST record");
  assert.equal(
    parseRunSession(JSON.stringify(forgedConnectedSession), runId, MISSION_ID),
    null,
    "session hydration derives persistent state from the journal transition chain",
  );

  const first = lost.records[0]!;
  const danglingUnsigned = { ...first, causalPredecessors: ["MISSING-EXTERNAL-PARENT"] };
  const danglingRecord = { ...danglingUnsigned, canonicalDigest: canonicalRecordDigest(danglingUnsigned) };
  const danglingSession = { ...lost, records: [danglingRecord] };
  assert.equal(parseRunSession(JSON.stringify(danglingSession), runId, MISSION_ID), null);
  assert.equal(isRunResumable(danglingSession), false);
  assert.equal(isRunPersistencePairCoherent(danglingSession, lostSnapshot), false,
    "a matching state sidecar cannot make a causally open journal resumable");
});

test("D-006E: the evidence-derived reconciliation check exists and is pure", () => {
  assert.match(evidenceModel, /export function offlineWindowStatus/);
  assert.match(evidenceModel, /export function evidenceState/);
  const fn = evidenceModel.slice(
    evidenceModel.indexOf("export function offlineWindowStatus"),
    evidenceModel.indexOf("\n}", evidenceModel.indexOf("export function evidenceState")) + 2,
  );
  // It must read records, not touch the network, the DOM or the clock.
  assert.doesNotMatch(fn, /fetch|localStorage|window\.|Date\.now|setTimeout/);
});

test("D-006E: resumability is decided from evidence, and is pure", () => {
  assert.match(missionRun, /export function isRunResumable/);
  const fn = missionRun.slice(
    missionRun.indexOf("export function isRunResumable"),
    missionRun.indexOf("\n}", missionRun.indexOf("export function isRunResumable")) + 2,
  );
  assert.doesNotMatch(fn, /fetch|localStorage|window\.|Date\.now|setTimeout/);
});

test("D-006 C1: resumability rejects sidecars that contradict their journal", () => {
  const runId = "fortix.demo.d006e.run.20260901T120000-resumable-binding";
  const lost = appendNetworkTransition(createOfflineEvidenceSession(runId), {
    runId,
    observationId: "obs-resumable-loss",
    adapterIdentity: TARGET_ADAPTER_IDENTITY,
    observationSource: PHYSICAL_SENTINEL_SOURCE,
    previousNetworkState: "CONNECTED",
    newNetworkState: "LOST",
    missionClockPosition: 10_000,
  }).session;
  assert.equal(isRunResumable(lost), true);
  assert.equal(isRunResumable({ ...lost, networkState: "CONNECTED" }), false,
    "an OPEN journal cannot be resumed with a contradictory persisted state");
});

test("D-006E: mount decides resume-or-new before any state is displayed", () => {
  const effect = mountRestoreEffectSource();
  const checkIndex = effect.indexOf("isRunResumable(restoredSession)");
  const displayIndex = effect.indexOf("setNetworkState(networkMachineRef.current.state)");
  assert.ok(checkIndex >= 0, "resumability must be decided in the mount effect");
  assert.ok(displayIndex > checkIndex, "nothing may be displayed before that decision");
});

test("D-006E: a run is rehydrated only when every stored record belongs to it", () => {
  const effect = mountRestoreEffectSource();
  // Storage holding records is never on its own a reason to present them.
  assert.match(effect, /restoredSession\.missionId === MISSION_ID/);
  assert.match(effect, /restoredSession\.runId === runId/);
  assert.match(effect, /networkSnapshot\.runId === runId/);
  assert.match(effect, /isRunPersistencePairCoherent\(restoredSession, networkSnapshot\)/,
    "mount must cross-validate both persisted halves before hydration");
  assert.match(effect, /record\.missionId === MISSION_ID && record\.runId === runId/);
});

test("D-006E: every path that is not a legitimate resume opens a new run", () => {
  const effect = mountRestoreEffectSource();
  // No pointer, no stored run, a mismatch, or a finished run: each starts a
  // clean mission rather than falling through to a mixed or empty view.
  const openings = effect.match(/beginMissionRun\(\); return;/g) ?? [];
  assert.ok(openings.length >= 3, `every refusal must open a new run, found ${openings.length}`);
  // Malformed JSON must not strand the demonstration either.
  const catchBlock = component.slice(component.indexOf("} catch {", component.indexOf(effect)));
  assert.match(catchBlock.slice(0, 400), /beginMissionRun\(\)/);
});

test("D-006E: a resumed run never claims a reconciliation that has not run", () => {
  const effect = mountRestoreEffectSource();
  // LOST and RESTORED are the only restorable phases, because they are the
  // only ones an OPEN offline window can be in. SYNCHRONIZED would announce
  // a completed reconciliation, and a resumable run has not had one.
  assert.match(effect, /setSyncPhase\("LOCAL"\)/);
  assert.match(effect, /setSyncPhase\("READY"\)/);
  assert.doesNotMatch(effect, /setSyncPhase\("SYNCHRONIZED"\)/);
  assert.doesNotMatch(effect, /setReconciliation\(/,
    "an open window has no reconciliation outcome to restore");
});

test("D-006E: a resumed run still knows its offline window is open", () => {
  // DOCTRINE CHANGE, D-006G P3-B. This asserted that the machine could be in
  // a persistent RESTORED state on resume. That state no longer exists: the
  // link is CONNECTED or LOST. What the resume path must still recover is
  // whether EVIDENCE is waiting to be reconciled, and that is now read from
  // the journal rather than inferred from connectivity — which is the point.
  const effect = mountRestoreEffectSource();
  assert.match(effect, /offlineWindowStatus\(restoredSession\) === "AWAITING_RECONCILIATION"/,
    "the open window must be read from the journal");
  assert.match(effect, /setSyncPhase\("READY"\)/);
  assert.doesNotMatch(effect, /networkMachineRef\.current\.state === "RESTORED"/,
    "connectivity must not carry evidence state any more");
});

test("D-006E: the mount path authors no evidence and reaches into no internals", () => {
  const effect = mountRestoreEffectSource();
  assert.doesNotMatch(effect, /appendOfflineEvidence|appendNetworkTransition|reconcileOfflineEvidence/,
    "mount reconstructs what exists; it never mints or re-derives evidence");
  assert.doesNotMatch(effect, /networkMachineRef\.current\.#|\(networkMachineRef\.current as any\)/);
});

test("D-006E: storage is addressed per run, and the retired shared slot is not read", () => {
  const effect = mountRestoreEffectSource();
  assert.match(effect, /runNetworkKey\(runId\)/);
  assert.match(effect, /runSessionKey\(runId\)/);
  // The old single-slot keys are gone from the component entirely. They are
  // deliberately not deleted from the browser: previous runs keep their
  // evidence where they wrote it.
  assert.doesNotMatch(component, /fortix\.d006d\.(network|evidence)\./);
  assert.doesNotMatch(component, /localStorage\.removeItem|localStorage\.clear/,
    "isolation is never implemented by deleting evidence");
});

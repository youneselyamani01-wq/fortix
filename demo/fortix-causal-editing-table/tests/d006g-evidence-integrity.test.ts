import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { en } from "../../../site/src/i18n/locales/en.ts";
import { fr } from "../../../site/src/i18n/locales/fr.ts";

import {
  PHYSICAL_SENTINEL_SOURCE,
  TARGET_ADAPTER_IDENTITY,
  appendNetworkTransition,
  appendOfflineEvidence,
  capturePreRestorationArtifacts,
  createOfflineEvidenceSession,
  offlineWindowStatus,
  networkTransitionAdmissibility,
  reconcileOfflineEvidence,
  type ArtifactState,
  type JsonValue,
  type OfflineEvidenceSession,
} from "../app/offlineEvidence.ts";
import {
  D005M_MASTER_BUNDLE,
  D005M_MASTER_BUNDLE_ID,
  D005M_MASTER_CYCLE_RECEIPT,
  D005M_MASTER_CYCLE_RECEIPT_ID,
  verifyD005MMasterBundle,
} from "../app/masterStory.ts";

/**
 * D-006G — P0 evidence integrity.
 *
 * Two defects found while auditing the proof layer before building on it.
 * Both were verified against the running demonstration, not inferred:
 *
 *  - a SECOND physical offline window authored no evidence at all, while the
 *    reconciliation panel announced the window complete using the FIRST
 *    window's receipt;
 *  - the verdict panel headlined "Evidence holds." for every verdict except
 *    INVALID — including INDETERMINATE, which is what this demonstration's
 *    bundle actually returns on every run, and REVOKED.
 */

const ARTIFACTS: ArtifactState = Object.freeze({
  finalReceipt: Object.freeze({
    ref: D005M_MASTER_CYCLE_RECEIPT_ID,
    value: D005M_MASTER_CYCLE_RECEIPT as unknown as JsonValue,
  }),
  portableEvidenceBundle: Object.freeze({
    ref: D005M_MASTER_BUNDLE_ID,
    value: D005M_MASTER_BUNDLE as unknown as JsonValue,
  }),
  verdict: "INDETERMINATE",
});

const MISSION = "fortix.demo.d006g.integrity";

/**
 * Drives one complete offline window: loss, local work, restoration,
 * reconciliation.
 *
 * The pre-restoration capture is taken ONCE per session and reused by any
 * later window — `capturePreRestorationArtifacts` refuses a second capture
 * ("pre-restoration artifacts are append-only"). That is coherent: the Final
 * Receipt and the PEB are produced once when the mission completes offline,
 * and a later cable pull does not produce new ones. What a later window gets
 * is its own transitions and its own Reconciliation Receipt.
 */
function runOneWindow(session: OfflineEvidenceSession, tag: string, clock: number): OfflineEvidenceSession {
  let next = appendNetworkTransition(session, {
    runId: session.runId,
    observationId: `${tag}-loss`,
    adapterIdentity: TARGET_ADAPTER_IDENTITY,
    observationSource: PHYSICAL_SENTINEL_SOURCE,
    previousNetworkState: "CONNECTED",
    newNetworkState: "LOST",
    missionClockPosition: clock,
  }).session;
  next = appendOfflineEvidence(next, {
    missionId: next.missionId,
    runId: next.runId,
    eventId: `${tag}.local-work`,
    eventType: "MISSION_EVENT_CONTINUED_OFFLINE",
    receiptId: `NR-OFFLINE:${tag}`,
    missionClockPosition: clock + 1_000,
    executionLocality: "LOCAL",
    payload: { tag },
  }).session;
  if (next.preRestorationCapture === null) {
    next = capturePreRestorationArtifacts(next, { ...ARTIFACTS, missionClockPosition: clock + 2_000 }).session;
  }
  const capture = next.preRestorationCapture;
  assert.notEqual(capture, null, "the mission's artifacts must be captured before restoration");
  next = appendNetworkTransition(next, {
    runId: next.runId,
    observationId: `${tag}-restored`,
    adapterIdentity: TARGET_ADAPTER_IDENTITY,
    observationSource: PHYSICAL_SENTINEL_SOURCE,
    previousNetworkState: "LOST",
    newNetworkState: "CONNECTED",
    missionClockPosition: clock + 3_000,
  }).session;
  const reconciled = reconcileOfflineEvidence({
    session: next,
    operation: {
      kind: "BASE_COMPARE_TRANSFER",
      operationId: `${tag}.reconciliation-operation`,
      baseBefore: { missionId: next.missionId, runId: next.runId, records: [] },
      baseAfter: { missionId: next.missionId, runId: next.runId, records: next.records },
      transferredReceiptIds: next.records.map((record) => record.receiptId),
    },
    capture,
    currentArtifacts: ARTIFACTS,
    receiptMissionClockPosition: clock + 4_000,
  });
  assert.equal(reconciled.status, "COMPLETE",
    `${tag} did not reconcile: ${JSON.stringify(reconciled.reasonCodes ?? [])}`);
  return reconciled.session;
}

// --- the reported defect --------------------------------------------------

test("D-006G B3: a second physical offline window authors its own evidence", () => {
  const first = runOneWindow(createOfflineEvidenceSession(MISSION), "w1", 10_000);
  assert.equal(first.records.filter((r) => r.eventType === "NETWORK_LINK_LOST").length, 1);
  assert.equal(first.records.filter((r) => r.eventType === "RECONCILIATION_RECEIPT").length, 1);
  assert.equal(first.networkState, "CONNECTED");

  const second = runOneWindow(first, "w2", 50_000);

  assert.equal(second.records.filter((r) => r.eventType === "NETWORK_LINK_LOST").length, 2,
    "the second cable pull must author its own NR-NET-LOST");
  assert.equal(second.records.filter((r) => r.eventType === "NETWORK_LINK_RESTORED").length, 2,
    "the second reconnection must author its own NR-NET-RESTORED");

  const receipts = second.records.filter((r) => r.eventType === "RECONCILIATION_RECEIPT");
  assert.equal(receipts.length, 2, "each window closes with exactly one receipt of its own");
  assert.notEqual(receipts[0].receiptId, receipts[1].receiptId,
    "the second window must not be closed by the first window's receipt");
});

test("D-006G B3: reopening the link moves the journal back to LOST", () => {
  const first = runOneWindow(createOfflineEvidenceSession(MISSION), "w1", 10_000);
  assert.equal(offlineWindowStatus(first), "RECONCILED");

  const reopened = appendNetworkTransition(first, {
    runId: first.runId,
    observationId: "w2-loss",
    adapterIdentity: TARGET_ADAPTER_IDENTITY,
    observationSource: PHYSICAL_SENTINEL_SOURCE,
    previousNetworkState: "CONNECTED",
    newNetworkState: "LOST",
    missionClockPosition: 50_000,
  }).session;

  // The journal itself is the reliable signal that a new window is open.
  assert.equal(reopened.networkState, "LOST");
  assert.equal(reopened.records.at(-1)?.eventType, "NETWORK_LINK_LOST");

  assert.equal(offlineWindowStatus(reopened), "OPEN");
});

// --- the rule may not drift from its enforcement --------------------------

test("D-006G B3: admissibility agrees with what the append actually enforces", () => {
  // The regression happened because a caller kept its own copy of this rule
  // and the copy was wrong. This proves predicate and enforcement are the
  // same expression, across every session state the journal can be in.
  const states: readonly OfflineEvidenceSession[] = [
    createOfflineEvidenceSession(MISSION),
    appendNetworkTransition(createOfflineEvidenceSession(MISSION), {
      runId: MISSION,
      observationId: "probe-loss",
      adapterIdentity: TARGET_ADAPTER_IDENTITY,
      observationSource: PHYSICAL_SENTINEL_SOURCE,
      previousNetworkState: "CONNECTED",
      newNetworkState: "LOST",
      missionClockPosition: 1_000,
    }).session,
    runOneWindow(createOfflineEvidenceSession(MISSION), "probe", 10_000),
  ];
  const transitions = [
    { previousNetworkState: "CONNECTED", newNetworkState: "LOST" },
    { previousNetworkState: "LOST", newNetworkState: "CONNECTED" },
    { previousNetworkState: "CONNECTED", newNetworkState: "CONNECTED" },
    { previousNetworkState: "LOST", newNetworkState: "LOST" },
  ] as const;

  let admissibleSeen = 0;
  let refusedSeen = 0;
  for (const [stateIndex, session] of states.entries()) {
    for (const [transitionIndex, transition] of transitions.entries()) {
      const predicted = networkTransitionAdmissibility(session, transition);
      let threw = false;
      try {
        appendNetworkTransition(session, {
          runId: session.runId,
          observationId: `probe-${stateIndex}-${transitionIndex}`,
          adapterIdentity: TARGET_ADAPTER_IDENTITY,
          observationSource: PHYSICAL_SENTINEL_SOURCE,
          ...transition,
          missionClockPosition: 90_000,
        });
      } catch {
        threw = true;
      }
      assert.equal(threw, predicted !== "ADMISSIBLE",
        `predicate said ${predicted} but append ${threw ? "threw" : "accepted"} `
        + `for state ${stateIndex} transition ${transitionIndex}`);
      if (predicted === "ADMISSIBLE") admissibleSeen += 1; else refusedSeen += 1;
    }
  }
  // Both outcomes must actually occur, or the agreement above is vacuous.
  assert.ok(admissibleSeen > 0 && refusedSeen > 0);
});

// --- the verdict headline -------------------------------------------------

test("D-006G B1: every verdict gets its own headline, and only VALID claims the evidence holds", () => {
  const component = readFileSync(new URL("../app/ConvergenceExperience.tsx", import.meta.url), "utf8");
  const panelStart = component.indexOf("instrument-verdict");
  const panel = component.slice(panelStart, component.indexOf("</section>", panelStart));
  assert.ok(panel.length > 0, "the verdict panel was not found");

  const canonicalVerdicts = ["VALID", "INVALID", "REVOKED", "INDETERMINATE"];
  for (const [locale, dictionary] of [["en", en], ["fr", fr]] as const) {
    const verdicts = dictionary.d006c2.verifier.verdicts;
    assert.deepEqual(Object.keys(verdicts).sort(), [...canonicalVerdicts].sort(),
      `${locale} must define exactly the canonical four-verdict vocabulary`);
    assert.equal(new Set(Object.values(verdicts).map(({ headline }) => headline)).size, 4,
      `${locale} must give every canonical verdict its own headline`);
    for (const verdict of canonicalVerdicts.filter((value) => value !== "VALID")) {
      assert.notEqual(verdicts[verdict as keyof typeof verdicts].headline, verdicts.VALID.headline,
        `${locale} ${verdict} must never inherit the VALID headline`);
    }
  }
  assert.equal(en.d006c2.verifier.verdicts.VALID.headline, "Evidence holds.");

  // Runtime selection is exhaustive through the typed dictionary. No binary
  // fallback may let INDETERMINATE or REVOKED fall through to VALID.
  assert.match(panel, /d006c2\.verifier\.verdicts\[verificationResult\.verdict\]\.headline/);
  assert.match(panel, /d006c2\.verifier\.verdicts\[verificationResult\.verdict\]\.scope/);
  assert.match(panel, /d006c2\.verifier\.verdicts\[verificationResult\.verdict\]\.reading/);
  assert.doesNotMatch(panel, /verdict === "INVALID" \? "Evidence fails\." : "Evidence holds\."/);
  assert.match(panel, /\{verificationResult\.verdict\}/,
    "the displayed canonical token must remain the verifier result itself");
  assert.ok(
    panel.indexOf("d006c2.verifier.verdicts[verificationResult.verdict].headline")
      < panel.indexOf("d006c2.verifier.canonicalVerdict"),
    "the natural-language verdict must precede the canonical token",
  );
});

// --- what the verifier claims to have checked ----------------------------

test("D-006G B2: the verifier reports only checks it actually performs", async () => {
  const result = await verifyD005MMasterBundle();
  const source = readFileSync(new URL("../app/masterStory.ts", import.meta.url), "utf8");
  const fn = source.slice(source.indexOf("export async function verifyD005MMasterBundle"));

  // Four entries used to be asserted without the work being done. None of
  // them may return unless the function grows the capability to back them.
  for (const fabricated of [
    "action_authority_at_signed_time",
    "provider_round_trip",
    "manager_accountability",
    "return_receipt_closure",
  ]) {
    assert.ok(!result.completedChecks.includes(fabricated),
      `${fabricated} is reported but never performed`);
  }

  // Every check that IS reported must correspond to work in the function.
  // Digest recomputation and closure are the substance of what it does.
  assert.ok(result.completedChecks.includes("bundle_digest_recomputed"));
  assert.ok(result.completedChecks.includes("object_digests_recomputed"));
  assert.match(fn, /digestCanonical\(digestProbe\) !== claimedDigest/);
  assert.match(fn, /index\.object_digest !== digestCanonical\(evidence\)/);

  // P2R INVERTED THIS ASSERTION, deliberately.
  //
  // It previously read "no reported check may imply signature verification",
  // which was correct when written: the verifier checked no signatures, so
  // claiming otherwise would have been an overstatement. The Codex audit then
  // showed the consequence — a forged payload with recomputed hashes was
  // accepted with the identical verdict, reason code and check list as the
  // genuine bundle, because digest consistency is not authenticity.
  //
  // The signature scheme was recoverable after all (see
  // `app/canonicalSignature.ts`), so the verifier now performs the check and
  // must report it. Under-reporting real verification is as dishonest as
  // over-reporting absent verification; the invariant is that the check list
  // matches the work, in whichever direction.
  assert.ok(result.completedChecks.includes("canonical_signatures_verified"),
    "signature verification is performed and must be reported");
  assert.ok(result.completedChecks.includes("evidence_identities_derived"));
  assert.match(fn, /verifyCanonicalEvidenceSignatures\(/);
  // And it must still fail closed on every branch of that check.
  assert.match(fn, /return invalid\("D005M_CANONICAL_SIGNATURE_INVALID"\)/);
  assert.match(fn, /return invalid\("D005M_EVIDENCE_UNSIGNED"\)/);
  assert.match(fn, /return invalid\("D005M_EVIDENCE_IDENTITY_NOT_DERIVED"\)/);
});

test("D-006G B4: the demonstration scope is read from the evidence, not asserted by the UI", async () => {
  const result = await verifyD005MMasterBundle();
  // The bundle scopes its own verification; the verifier must report that
  // rather than leaving the caveat to a React component that does not travel
  // with the artifact.
  assert.ok(result.completedChecks.includes("bundle_declares_demo_only_scope"),
    "the bundle's own DEMO_ONLY scope must be read and reported");

  // It must be genuinely derived: a bundle that does not declare the scope
  // must not get the check.
  const source = readFileSync(new URL("../app/masterStory.ts", import.meta.url), "utf8");
  assert.match(source, /declaredScope === "DEMO_ONLY" \? \["bundle_declares_demo_only_scope"\] : \[\]/);
});

test("D-006G M1: success and failure no longer share one reason code", () => {
  const source = readFileSync(new URL("../app/masterStory.ts", import.meta.url), "utf8");
  const fn = source.slice(source.indexOf("export async function verifyD005MMasterBundle"));
  // The governance/trusted-time failure gate and the fully-passing return
  // used to emit the identical reason code, so a consumer reading verdict +
  // reason code could not tell a refused bundle from an accepted one.
  assert.match(fn, /return indeterminate\("D005M_GOVERNANCE_MATERIAL_INSUFFICIENT"\)/);
  const successCodes = fn.slice(fn.indexOf("verdict: \"INDETERMINATE\","));
  // The passing return now also carries the settlement quarantine when it
  // applies, so the two paths remain distinguishable and the second reason is
  // genuinely derived rather than hard-coded alongside the first.
  assert.match(successCodes, /reasonCodes: \["D005M_PRODUCTION_TRUST_TIME_INCOMPLETE", \.\.\.settlementReasons\]/);
  assert.match(fn, /settlement\.quarantined\s*\n?\s*\?\s*\["D005M_SETTLEMENT_UNSUPPORTED_BY_EVIDENCE"\]/);
});

test("D-006G B1: a refused physical observation reaches the DOM", () => {
  const component = readFileSync(new URL("../app/ConvergenceExperience.tsx", import.meta.url), "utf8");
  // It was written to a ref that nothing read, so a refusal left no trace.
  assert.match(component, /data-unsequenced-observation=/);
  assert.match(component, /setUnsequencedObservation\(`\$\{admissibility\}:/);
  // And it must be decided outside the state updater, which may re-run.
  const pollEffect = component.slice(
    component.indexOf("const previousMachineSnapshot = networkMachineRef.current.snapshot();"),
    component.indexOf("void read();"),
  );
  const decideIndex = pollEffect.indexOf("networkTransitionAdmissibility(");
  const appendIndex = pollEffect.indexOf("appendNetworkEvidenceTransition(");
  assert.ok(decideIndex >= 0 && appendIndex > decideIndex,
    "admissibility must be decided before the journal append runs");
  assert.doesNotMatch(pollEffect, /setOfflineSession\(\(current\)/,
    "the physical transaction must not defer its append into a replayable React updater");
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component = readFileSync(new URL("../app/ConvergenceExperience.tsx", import.meta.url), "utf8");
const stylesheet = readFileSync(new URL("../app/convergence.css", import.meta.url), "utf8");

test("D-006 C1 UI transfers and verifies the exact closure it displays", () => {
  assert.match(component, /projectPortableProofLeaves\(evidenceClosure, masterTime, finalMissionReceipt\)/);
  assert.match(component, /buildPortableMissionEvidenceBundle\(\{[\s\S]*?closure: evidenceClosure,[\s\S]*?runtimeRecords: activeRuntimeRecords,[\s\S]*?displayedEvidenceIds/);
  assert.match(component, /createHandoffArtifact\(portablePeb, HANDOFF_READY_MS\)/);
  assert.match(component, /pebText: handoffArtifact\.pebText/);
  assert.match(component, /expectedIdentity: handoffArtifact\.identity/);
  assert.match(component, /expectedTransferredContentDigest: handoffArtifact\.transferredContentDigest/);
  assert.doesNotMatch(component, /LOCAL_EVIDENCE_RECORD|D005M_MASTER_BUNDLE|D005M_MASTER_CYCLE_RECEIPT/,
    "the active C1 experience may not hand off the frozen predecessor artifact");
  assert.match(component, /data-assurance=\{leaf\.assurance\}/,
    "every displayed leaf must expose the assurance transferred in the closure");
  assert.match(component, /leaf\.assurance === "QUARANTINED"[\s\S]*?proof-assurance-marker[\s\S]*?d006d\.quarantined/,
    "quarantined evidence must remain visibly ineligible in the proof tree");
  assert.match(stylesheet, /\.proof-leaf\.is-quarantined\s*\{/);
});

test("D-006 C1 UI emits only receipts with exact canonical actor and leaf bindings", () => {
  assert.match(component, /projectReceiptBindings\(evidenceClosure, VISUAL_EVENTS\)/);
  assert.match(component, /leafById\.has\(binding\.leafId\)/);
  assert.match(component, /rows\.get\(binding\.leafId\)/);
  assert.match(component, /data-actor=\{binding\.producerDomain\}/);
  assert.match(component, /data-target=\{binding\.targetEvidenceId\}/);
  assert.match(component, /data-target-event=\{binding\.targetEventId\}/);
  assert.match(component, /data-evidence-id=\{binding\.evidenceId\}/);
  assert.match(component, /map\(\(item\) => receiptEmissionSource\(item\.binding\)\)/,
    "the actor glow and flight origin must resolve through one canonical source");
  assert.doesNotMatch(component, /eventById\.get\("complete"\)/,
    "the D-006 Final Receipt may not borrow the 112000ms Vehicle completion event");
  assert.match(component, /visualEvent: null,[\s\S]*?binding: finalReceiptBinding\(finalMissionReceipt\)/);
  assert.doesNotMatch(component, /return TREE_ROWS\[event\.branch\]/,
    "a missing exact leaf may not be replaced by a visual-family target");
});

test("D-006 C1 UI keeps mission time, proof post-roll and handoff gates ordered", () => {
  assert.match(component, /max=\{EXPERIENCE_DURATION_MS\}/);
  assert.match(component, /data-testid="master-time">\{formatExperienceTime\(masterTime\)\}/,
    "the visible master clock must show the full 02:06 experience rather than clamp at mission time");
  assert.match(component, /masterTime < FINAL_RECEIPT_EMITTED_MS[\s\S]*?finalReceiptRuntimeSeal === null[\s\S]*?evidenceClosure === null/);
  assert.match(component, /masterTime < PEB_COMPLETE_MS \|\| finalMissionReceipt === null \|\| evidenceClosure === null/);
  assert.match(component, /masterTime >= HANDOFF_READY_MS && portablePeb !== null/);
  assert.match(component, /leaf\.leafId === "signed:d005m\.receipt\.master-return-to-base"/);
  assert.match(component,
    /FINAL_REQUIRED_LEAF_MATURE_MS - RETURN_RECEIPT_EMITTED_MS - RECEIPT_TRAVEL_MS/,
    "the required return leaf must mature exactly at 116000ms");
  // C3-R1 moved the expression to a named const so a zero-growth edge can be
  // culled from the DOM entirely; the property is identical — an edge matures
  // only with BOTH endpoint leaves.
  assert.match(component, /const growth = Math\.min\(growthByLeafId\.get\(edge\.from\)[\s\S]*?growthByLeafId\.get\(edge\.to\)/,
    "a causal edge may mature only with both endpoint leaves");
  assert.match(component, /if \(growth <= 0\) return \[\];/,
    "an edge whose evidence has not landed may not reach the DOM");
  assert.match(component, /clipPath: `inset\(0 \$\{\(1 - edge\.growth\) \* 100\}% 0 0\)`/,
    "the final edge must grow through the post-roll instead of appearing at receipt emission");
});

test("D-006 C1 UI fails closed when the receipt-supporting closure is unavailable", () => {
  assert.match(component, /finalReceiptRuntimeEvidencePrefix\(/);
  assert.match(component, /sealFinalReceiptRuntimeEvidence\(completeAtEmission, FINAL_RECEIPT_EMITTED_MS\)/,
    "Final Receipt support must be sealed by append position at emission");
  assert.match(component, /offlineSession\.finalReceiptRuntimeSeal === null/,
    "the UI may not issue Final Receipt from an unsealed journal");
  assert.match(component, /data-evidence-closure-state=\{evidenceClosure === null \? "REFUSED" : "VALID"\}/);
  assert.match(component, /const evidenceTransferReady = story\.handoffReady && handoffArtifact !== null/,
    "public handoff readiness must fail closed with the exact portable artifact");
});

test("D-006 C1 UI derives maintenance and emission poses only from the experience state", () => {
  assert.match(component, /maintenanceActionProgress=\{physical\.maintenanceActionProgress\}/);
  assert.match(component, /--maintenance-shift": `\$\{-18 \+ 36 \* clamp01\(maintenanceActionProgress\)\}px`/);
  assert.match(component, /--maintenance-rotation": `\$\{-18 \+ 36 \* clamp01\(maintenanceActionProgress\)\}deg`/);
  assert.match(stylesheet,
    /\.garage-object\.is-working \.maintenance-action\s*\{[\s\S]*?transform: translateX\(var\(--maintenance-shift\)\) rotate\(var\(--maintenance-rotation\)\);[\s\S]*?\}/);
  assert.doesNotMatch(stylesheet, /animation:\s*maintenance-action\b/,
    "maintenance may not free-run independently of the experience clock");
  assert.doesNotMatch(stylesheet, /@keyframes\s+maintenance-action\b/);
  assert.doesNotMatch(stylesheet, /animation:\s*d006a-emit\b/,
    "emission halos may not free-run independently of the experience clock");
  assert.doesNotMatch(stylesheet, /@keyframes\s+d006a-emit\b/);
});

test("D-006 C1 UI exposes complete routing provenance and a visible cue", () => {
  for (const attribute of [
    "data-routing-selected-source",
    "data-routing-selected-model",
    "data-routing-selected-provider",
    "data-routing-selected-execution",
    "data-routing-resolved-source",
    "data-routing-resolved-model",
    "data-routing-resolved-provider",
    "data-routing-resolved-execution",
    "data-routing-fallback-from",
    "data-routing-fallback-to",
    "data-routing-fallback-reason",
    "data-resulting-route",
    "data-resulting-route-source",
  ]) {
    assert.match(component, new RegExp(`${attribute}=\\{routingState\\.`), `${attribute} must be visible on the experience root`);
  }
  assert.match(component, /routingState\.phase !== "NOT_TRIGGERED" && \(/);
  assert.match(component, /className="routing-provenance-cue"/);
  assert.match(component, /data-selected-provider=\{routingState\.selected\?\.provider_id \?\? ""\}/);
  assert.match(component, /data-resolved-provider=\{routingState\.resolved\?\.provider_id \?\? ""\}/);
  assert.match(component,
    /data-execution-truth=\{routingState\.resolved\?\.execution_truth \?\? routingState\.selected\?\.execution_truth \?\? ""\}/,
    "simulation/execution truth must remain independently inspectable");
  assert.match(component, /routingState\.resultingRoute\?\.route_id \?\? "—"/,
    "the public cue must expose the exact resulting route without replacing it with execution truth");
  assert.match(stylesheet, /\.routing-provenance-cue\s*\{/);
  assert.match(component, /routingProvenanceFromRuntimeRecords\(activeRuntimeRecords\)/,
    "routing UI must project the run-owned evidence record, including restored A-to-B fallback truth");
  assert.match(component, /derivePresentationMotion\(masterTime, routingExecutionAuthorized\)/,
    "authorization without an evidenced resulting route cannot move the rendered vehicle");
  assert.match(component, /derivePhysicalState\(masterTime, routingExecutionAuthorized\)/,
    "the physical story state must use the same evidence gate as presentation motion");
});

test("D-006 C1 UI uses one fail-closed clock for every reality scene and caption", () => {
  assert.match(component,
    /const routingEvidenceAdmissible = routingEvidenceState\.recordPresent && routingEvidenceState\.valid;/);
  assert.match(component,
    /deriveRoutingState\(routingEvidenceAdmissible \? masterTime : 0, routingEvidenceState\.provenance\)/,
    "missing and invalid route evidence may not project canonical routing details");
  assert.match(component,
    /const effectiveStoryTime = evidenceGatedStoryTime\(masterTime, routingEvidenceAdmissible\);/);
  assert.match(component, /data-effective-story-time=\{effectiveStoryTime\}/);

  for (const projection of [
    /deriveMasterStoryState\(effectiveStoryTime\)/,
    /event\.timeMs <= effectiveStoryTime/,
    /trafficSignalAt\(effectiveStoryTime\)/,
    /storyTime=\{effectiveStoryTime\}/,
    /journeyStage\(effectiveStoryTime,/,
    /VISUAL_EVENTS\.filter\(\(event\) => event\.timeMs <= effectiveStoryTime\)/,
    /publicCausalScene\(currentEvent\.id, linkPhase\)/,
  ]) assert.match(component, projection);

  const actors = component.slice(
    component.indexOf("function CityActors("),
    component.indexOf("function cityInfrastructureStepAt("),
  );
  assert.ok(actors.length > 0, "CityActors source was not found");
  assert.doesNotMatch(actors, /\bmasterTime\b/,
    "obstacle, garage, authority and base actors may not bypass the evidence-gated clock");
  assert.match(actors, /congestionVisible = storyTime >= storyBeatTime\("congestion"\)[\s\S]*?storyTime < storyBeatTime\("routing-merge-start"\)/);
  assert.match(actors, /baseVisible = storyTime < storyBeatTime\("taxi-en-route-to-passenger"\)[\s\S]*?storyTime >= storyBeatTime\("return-journey"\)/);

  assert.match(component, /projectPortableProofLeaves\(evidenceClosure, masterTime, finalMissionReceipt\)/,
    "proof and QUARANTINED-leaf inspection must remain on canonical time");
  assert.match(component, /growth: leafGrowthForLeaf\(leaf, masterTime\)/,
    "quarantined leaf visibility must mature on canonical proof time, not held scene time");
});

test("D-006 C1 UI treats restoration, acknowledgement and reconciliation as distinct facts", () => {
  assert.match(component, /linkPhase !== "CONNECTED"[\s\S]*reconciliationWindow !== "AWAITING_RECONCILIATION"/,
    "reconciliation requires a currently observed physical connection, not the journal baseline");
  assert.match(component, /reconciliationWindowKey === null/,
    "an acknowledgement attempt must name one exact restored window");
  assert.match(component, /requestSameOriginEvidenceAcknowledgement\(\{/);
  // UPDATED, D-006 C3 §11. C1 wrote `operation: null` because the truthful
  // state THEN was "this demonstration has no base compare/transfer"; the
  // assertion existed so the acknowledgement could never be dressed up as one.
  // C3 implements the operation for real, so the guarded property is now
  // asserted directly: the evidence handed to the validator comes from the
  // PERFORMED base transfer and from nothing else — the acknowledgement
  // response still feeds no field of it.
  assert.match(component, /operation: performed\?\.operation \?\? null/,
    "reconciliation evidence comes from the performed base transfer, never from the acknowledgement");
  assert.match(component, /performBaseCompareTransfer\(offlineSessionRef\.current, baseStore\)/,
    "the base comparison/transfer must actually be performed against a real second ledger");
  assert.doesNotMatch(component, /offlineSession\.networkState\s*[!=]==?\s*"RESTORED"/);
  assert.doesNotMatch(component, /acknowledgeReconciliation|setSyncPhase\("SYNCHRONIZED"\)/);
});

test("D-006 C1 UI commits a network receipt before its derived machine snapshot and rolls back refusals", () => {
  const start = component.indexOf("const previousMachineSnapshot = networkMachineRef.current.snapshot();");
  const end = component.indexOf("void read();", start);
  assert.ok(start >= 0 && end > start, "the physical poll transaction was not found");
  const poll = component.slice(start, end);

  const observe = poll.indexOf("networkMachineRef.current.observe(next");
  const append = poll.indexOf("const appended = appendNetworkEvidenceTransition");
  const publishJournal = poll.indexOf("offlineSessionRef.current = appended.session", append);
  const persistJournal = poll.indexOf("runSessionKey(activeRunIdRef.current)", publishJournal);
  const persistMachine = poll.indexOf("runNetworkKey(activeRunIdRef.current)", persistJournal);
  assert.ok(observe >= 0 && append > observe);
  assert.ok(publishJournal > append && persistJournal > publishJournal && persistMachine > persistJournal,
    "journal admission/publication/persistence must precede the derived machine cache");
  assert.equal(poll.slice(observe, append).includes("runNetworkKey("), false,
    "an observed edge may not persist an advanced machine before journal admission");

  const refusal = poll.slice(
    poll.indexOf('if (admissibility !== "ADMISSIBLE")'),
    poll.indexOf("} else {", poll.indexOf('if (admissibility !== "ADMISSIBLE")')),
  );
  assert.match(refusal, /snapshot: previousMachineSnapshot/);
  assert.match(refusal, /setNetworkState\(previousMachineSnapshot\.state\)/);

  const observationFailure = poll.slice(
    poll.indexOf("} catch (error) {"),
    poll.indexOf("if (machineResult.event !== null)"),
  );
  assert.match(observationFailure, /snapshot: previousMachineSnapshot/,
    "a throw after debounce mutation must restore the complete prior cache");
  const appendFailure = poll.slice(poll.lastIndexOf("} catch (error) {"));
  assert.match(appendFailure, /snapshot: previousMachineSnapshot/,
    "journal rejection must roll the machine back so the physical edge can retry");
});

test("D-006 C1 UI aborts stale acknowledgement work and binds it to one run and offline window", () => {
  const start = component.indexOf("const controller = new AbortController();");
  const end = component.indexOf(
    "[linkPhase, offlineSession.runId, reconciliationWindow, reconciliationWindowKey]",
    start,
  );
  assert.ok(start >= 0 && end > start, "the acknowledgement effect was not found");
  const effect = component.slice(start, end);
  assert.match(effect, /expectedRunId = offlineSession\.runId/);
  assert.match(effect, /expectedWindowKey = reconciliationWindowKey/);
  assert.match(effect, /activeRunIdRef\.current === expectedRunId/);
  assert.match(effect, /awaitingReconciliationWindowKey\(offlineSessionRef\.current\) === expectedWindowKey/);
  assert.match(effect, /globalThis\.fetch, controller\.signal/);
  assert.match(effect, /controller\.abort\(\)/);

  const awaited = effect.indexOf("await requestSameOriginEvidenceAcknowledgement");
  const postAwaitGuard = effect.indexOf("if (!stillCurrent()) return;", awaited);
  const acknowledged = effect.indexOf('setSyncPhase("ACKNOWLEDGED")', awaited);
  assert.ok(awaited >= 0 && postAwaitGuard > awaited && acknowledged > postAwaitGuard,
    "a cancelled run/window must be refused before it can publish ACKNOWLEDGED");
});

test("D-006 C1 UI exposes journal-derived evidence locality independently of the link", () => {
  assert.match(component, /const currentEvidenceState = evidenceState\(offlineSession\);/);
  assert.match(component, /data-evidence-state=\{currentEvidenceState\}/);
  const derivation = component.slice(
    component.indexOf("const reconciliationWindow = offlineWindowStatus(offlineSession);"),
    component.indexOf("const beginMissionRun"),
  );
  assert.doesNotMatch(derivation, /currentEvidenceState\s*=.*(?:networkState|linkPhase)/,
    "evidence locality must not be inferred from cable state");
});

test("D-006 C1 UI never presents an unobserved machine baseline as physical link truth", () => {
  assert.match(component, /const linkPhase = linkObservationCurrent[\s\S]*visiblePhysicalLinkState\(linkReport, networkState\)[\s\S]*: "UNKNOWN";/);
  assert.match(component, /data-link-phase=\{linkPhase\}/);
  assert.match(component, /isFreshPhysicalLinkObservation\(next, Date\.now\(\), LINK_OBSERVATION_FRESHNESS_MS\)/,
    "a cached sidecar report must lose authority after a bounded freshness window");
  assert.match(component, /machineResult\.reason === "DUPLICATE_OBSERVATION"[\s\S]*current && agreesWithAdmittedState/,
    "a normal duplicate may preserve only a previously admitted matching observation");
  assert.match(component, /if \(!attemptFinished\) reconciliationStartedRef\.current = false;/,
    "a cancelled acknowledgement must be retryable when physical truth returns");
  assert.match(component, /const networkStateLabel = linkPhase === "CONNECTED"/);
  assert.match(component, /publicCausalScene\(currentEvent\.id, linkPhase\)/);
});

test("D-006 C1 UI captures only the verdict for the exact run and transferred bytes", () => {
  const start = component.indexOf("if (offlineVerdict === null || networkState !== \"LOST\"");
  const end = component.indexOf("// Reconciliation begins only", start);
  assert.ok(start >= 0 && end > start, "the pre-restoration capture effect was not found");
  const capture = component.slice(start, end);
  const identityGuard = capture.indexOf("offlineVerdict.identity.missionId !== handoffArtifact.identity.missionId");
  const runGuard = capture.indexOf("offlineVerdict.identity.runId !== handoffArtifact.identity.runId");
  const digestGuard = capture.indexOf("offlineVerdict.transferredContentDigest !== handoffArtifact.transferredContentDigest");
  const captureCall = capture.indexOf("capturePreRestorationArtifacts(current");
  assert.ok(identityGuard >= 0 && runGuard > identityGuard && digestGuard > runGuard && captureCall > digestGuard);
  assert.match(capture, /current\.runId !== handoffArtifact\.identity\.runId/);
  assert.match(capture, /current\.missionId !== handoffArtifact\.identity\.missionId/);
});

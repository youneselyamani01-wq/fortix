import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { MISSION_ID } from "../app/missionContinuity.ts";
import { projectMissionEvidence } from "../app/missionEvidence.ts";
import { derivePublicExperience } from "../app/nx/adapter/publicExperienceAdapter.ts";
import type { EngineSnapshot } from "../app/nx/adapter/engineSnapshot.ts";
import { layoutProofB2 } from "../app/nx/evidence/proofGeometryB2.ts";
import { canonicalGraph } from "../app/nx/gate2/canonicalGraph.ts";
import { createOfflineEvidenceSession, sealFinalReceiptRuntimeEvidence } from "../app/offlineEvidence.ts";
import { analyzeInsertedD006Peb, insertD006PebForAnalysis } from "../app/offlineVerification.ts";
import { derivePassengerPresentation } from "../app/passengerPresentation.ts";
import { derivePhysicalState } from "../app/physicalState.ts";
import {
  buildMissionEvidenceClosure,
  buildPortableMissionEvidenceBundle,
  createHandoffArtifact,
  finalReceiptRuntimeEvidencePrefix,
  issueFinalMissionReceipt,
  routingProvenanceFromRuntimeRecords,
} from "../app/portableMissionEvidence.ts";
import { projectPortableProofLeaves } from "../app/proofProjection.ts";
import { projectReceiptBindings } from "../app/receiptProjection.ts";
import { nextTransferStage } from "../app/reviewFlow.ts";
import { CANONICAL_ROUTING_PROVENANCE, deriveRoutingState } from "../app/routingProvenance.ts";
import { EXPERIENCE_DURATION_MS, FINAL_RECEIPT_EMITTED_MS, HANDOFF_READY_MS, PEB_COMPLETE_MS, evidenceGatedStoryTime } from "../app/storyTimeline.ts";
import { derivePresentationMotion } from "../app/vehiclePresentation.ts";
import { VISUAL_EVENTS } from "../app/visualEvents.ts";

/**
 * D-006/NX3 — ADVERSARIAL (mandate §42, the DO-NOT list, and §5).
 *
 * Each test tries one of the ways this build could have cheated and shows,
 * on the engine's own objects or in the sources, that it did not: no
 * transfer by opening, no analysis without the act, no network behind the
 * verifier, no stale verdict for other bytes, no verdict the surface made
 * up, no relation the graph did not declare, no forced connectivity, no
 * quarantined receipt consumed, no assurance colour before a verdict, and
 * no graphite instrument.
 */

const RUN_ID = "fortix.demo.d006nx3.run.adversarial";

function materialise(): EngineSnapshot {
  let journal = projectMissionEvidence(createOfflineEvidenceSession(RUN_ID, null, MISSION_ID), FINAL_RECEIPT_EMITTED_MS);
  journal = sealFinalReceiptRuntimeEvidence(projectMissionEvidence(journal, FINAL_RECEIPT_EMITTED_MS), FINAL_RECEIPT_EMITTED_MS);
  const records = finalReceiptRuntimeEvidencePrefix(journal);
  const closure = buildMissionEvidenceClosure({ identity: { missionId: MISSION_ID, runId: RUN_ID }, runtimeRecords: records, asOfMasterTimeMs: FINAL_RECEIPT_EMITTED_MS });
  const finalReceipt = issueFinalMissionReceipt(closure, FINAL_RECEIPT_EMITTED_MS);
  const displayed = projectPortableProofLeaves(closure, PEB_COMPLETE_MS, finalReceipt).map((leaf) => leaf.evidenceId);
  const portablePeb = buildPortableMissionEvidenceBundle({ closure, finalReceipt, runtimeRecords: records, displayedEvidenceIds: displayed, masterTimeMs: PEB_COMPLETE_MS });
  const handoffArtifact = createHandoffArtifact(portablePeb, HANDOFF_READY_MS);
  const provenance = routingProvenanceFromRuntimeRecords(records);
  const admissible = provenance !== null;
  const at = EXPERIENCE_DURATION_MS;
  const effective = evidenceGatedStoryTime(at, admissible);
  const routing = deriveRoutingState(admissible ? at : 0, provenance ?? CANONICAL_ROUTING_PROVENANCE);
  const authorized = admissible && routing.vehicleMayExecute;
  const physical = derivePhysicalState(at, authorized);
  return {
    masterTimeMs: at, effectiveStoryTimeMs: effective, playing: false, session: journal, closure, closureReason: null,
    receiptBindings: projectReceiptBindings(closure, VISUAL_EVENTS), finalReceipt, humanDecision: "APPROVED",
    networkState: "UNKNOWN", linkObservationCurrent: false, linkPhase: "UNKNOWN", sentinelReachable: false, transitionFlash: null,
    unsequencedObservation: null, reconciliation: null, baseTransfer: null, syncPhase: "IDLE", portablePeb, handoffArtifact,
    transferStage: "SOURCE", analysisRequested: false, verification: null, handoffNetworkState: null, verdictNetworkState: null,
    physical, motion: derivePresentationMotion(at, authorized), passenger: derivePassengerPresentation(effective, physical.passengerState), routing,
  };
}

const READY = materialise();
const at = (overrides: Partial<EngineSnapshot>) => derivePublicExperience({ ...READY, ...overrides });
const source = (relative: string) => readFileSync(new URL(`../app/${relative}`, import.meta.url), "utf8");
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const experience = code(source("nx/experience/NxExperience.tsx"));
const page = code(source("nx/page.tsx"));
const engine = code(source("nx/adapter/useMissionEngine.ts"));
const surface = code(source("nx/verifier/VerifierSurface.tsx"));
const verifierCss = source("nx/verifier/verifier.css");

test("ADV-01: opening the verifier — by act or by link — transfers nothing", () => {
  // The link: `?verifier=open` is a workspace flag and never an engine act.
  assert.match(page, /verifier: one\("verifier"\) === "open" \|\| one\("peb"\) === "picked" \|\| one\("inspect"\) !== undefined,/);
  const acts = page.slice(page.indexOf("function actsFrom"), page.indexOf("function selectionFrom"));
  assert.doesNotMatch(acts, /"verifier"|"inspect"/, "the acts parser does not read the workspace flags");
  assert.match(acts, /const handoffDone = one\("handoff"\) === "done" \|\| analysisRequested;/);
  // The act: OPEN sets workspace state; PICK is the only engine call beside it, and PICK is GATHER.
  assert.match(experience, /const submitPeb = useCallback/);
  assert.doesNotMatch(experience, /<VerifierSurface/);
  assert.match(experience, /const pickUp = useCallback\(\(\) => \{\s*engine\.pick\(\);\s*setHandoffStatus\("idle"\);\s*\}, \[engine\]\);/);
  assert.doesNotMatch(experience, /engine\.handoff\(/, "the surfaces never fire the fused act");
  assert.match(experience, /if \(model\.handoff\.stage === "CARRIED"\) \{ handoffStop\.current\?\.\(\); engine\.release\(\); \}/, "cancelled handoff releases the PEB and invalidates late acknowledgments");
  // On the engine's objects: picked is carried, not received.
  const picked = at({ transferStage: nextTransferStage("SOURCE", "GATHER") });
  assert.equal(picked.handoff.stage, "CARRIED");
  assert.equal(picked.portableEvidence.state, "IN_TRANSIT");
  assert.equal(picked.verification.state, "NOT_APPLICABLE");
});

test("ADV-02: nothing analyzes without the ANALYZE act — not a drop, not a link, not an effect", () => {
  const received = at({ transferStage: "TRANSFERRED", handoffNetworkState: "CONNECTED" });
  assert.equal(received.verification.state, "AWAITING_HUMAN");
  assert.equal(received.verification.verdict, null);
  assert.match(page, /const analysisRequested = one\("analysis"\) === "requested";/, "only the explicit link word requests analysis");
  assert.doesNotMatch(page, /analysisRequested = .*handoff/, "…a declared handoff does not imply it");
  assert.equal([...experience.matchAll(/current\.analyze\(\)/g)].length, 1, "one bounded Analyze request admission");
  assert.match(experience, /onAnalyze: \(expected\) => \{[^]*?current\.snapshot\.transferStage !== "TRANSFERRED" \|\| !sameDemoArtifact[^]*?current\.analyze\(\)/, "only the exact transferred artifact admits the separate tab’s explicit request");
  // Every effect on the surface, body by body: none of them calls the act.
  const effects = surface.split("useEffect(").slice(1).map((rest) => rest.slice(0, rest.indexOf("}, [")));
  assert.ok(effects.length >= 2, "the surface has its focus and reveal effects");
  for (const body of effects) assert.doesNotMatch(body, /onAnalyze|onDrop|onRelease|onInspect|onClose/, "no effect on the surface performs an act");
  assert.equal([...engine.matchAll(/setAnalysisRequested\(true\)/g)].length, 1, "one place in the engine requests analysis");
});

test("ADV-03: the verifier has no network behind it — the analysis runs with every network primitive removed", async () => {
  const globals = globalThis as Record<string, unknown>;
  const kept = { fetch: globals.fetch, XMLHttpRequest: globals.XMLHttpRequest, WebSocket: globals.WebSocket };
  delete globals.fetch;
  delete globals.XMLHttpRequest;
  delete globals.WebSocket;
  try {
    const artifact = READY.handoffArtifact!;
    const snapshot = await analyzeInsertedD006Peb(insertD006PebForAnalysis({ pebText: artifact.pebText, expectedIdentity: artifact.identity, expectedTransferredContentDigest: artifact.transferredContentDigest }));
    assert.ok(["VALID", "INVALID", "INDETERMINATE", "REVOKED"].includes(snapshot.result.verdict));
  } finally {
    Object.assign(globals, kept);
  }
});

test("ADV-04: a verdict for other bytes is never shown — the engine reports a result only for the digest and run it analyzed", () => {
  assert.match(engine, /if \(verdictSnapshot\.transferredContentDigest !== handoffArtifact\.transferredContentDigest\s*\|\| verdictSnapshot\.identity\.runId !== handoffArtifact\.identity\.runId\) return null;/);
  assert.match(engine, /if \(run !== analysisRun\.current\) return;/, "a late result of a superseded analysis is dropped");
  assert.match(engine, /verdictNetworkState: verification === null \? null : verdictNetworkState,/, "and its offline record with it");
  // The surface keys its reveal on the verdict AND the digest, so a new artifact starts afresh.
  assert.match(surface, /const resultKey = verdict === null \? null : `\$\{verdict\}:\$\{handoff\.transferredContentDigest \?\? ""\}`;/);
  // On the objects: a result whose digest is not the artifact's has no place in the model at all —
  // the engine drops it before the adapter, and the adapter reports the engine's field only.
  const restart = at({ transferStage: "TRANSFERRED", verification: null, analysisRequested: true });
  assert.equal(restart.verification.state, "ANALYZING");
  assert.equal(restart.verification.verdict, null);
});

test("ADV-05: what the surface shows and what the verifier established cannot diverge — every line is derived from the result", async () => {
  const artifact = READY.handoffArtifact!;
  const snapshot = await analyzeInsertedD006Peb(insertD006PebForAnalysis({ pebText: artifact.pebText, expectedIdentity: artifact.identity, expectedTransferredContentDigest: artifact.transferredContentDigest }));
  const model = at({ transferStage: "TRANSFERRED", analysisRequested: true, verification: snapshot.result, verdictNetworkState: "CONNECTED" });
  const checks = new Set(snapshot.result.completedChecks);
  assert.deepEqual(model.verification.establishes, {
    transferredBytesExact: checks.has("d006_transferred_digest_exact"),
    bundleIntegrity: checks.has("bundle_digest_recomputed") && checks.has("object_digests_recomputed"),
    missionRunIdentity: checks.has("d006_mission_run_identity"),
    trustAuthorization: checks.has("verification_key_authorized_by_pinned_anchor"),
    signatures: checks.has("canonical_signatures_verified"),
    causalClosure: checks.has("cycle_receipt_closure") && checks.has("d006_final_receipt_closure"),
    displayedCoverage: checks.has("d006_displayed_peb_coverage"),
    nonSettlement: checks.has("d006_financial_non_settlement"),
  }, "each established line is a completed check, by name");
  assert.equal(model.verification.verdict, snapshot.result.verdict);
  assert.deepEqual([...model.verification.reasonCodes], [...snapshot.result.reasonCodes]);
  // The surface prints the model and never a computation of its own.
  assert.match(surface, /\{copy\.verdicts\[verdict\]\.headline\}/);
  assert.match(surface, /data-established=\{verification\.establishes!\[key\] \? "true" : "false"\}/);
  assert.doesNotMatch(surface, /establishes\s*=\s*\{|verdict\s*=\s*"/, "nothing established or decided on the surface");
  assert.match(surface, /const verdict = verification\.state === "VERDICT" \? verification\.verdict : null;/);
});

test("ADV-06 / ADV-07: no invented relation and no forced connectivity — the production picture is the canonical graph, in two components", () => {
  const graph = canonicalGraph();
  const items = graph.receipts.map((r) => ({ evidenceId: r.evidenceId, branch: r.lane, causalParents: r.causalParents, observedInputs: r.observedInputs, standing: r.standing, timeMs: r.timeMs, admissionIndex: r.admissionIndex, episode: r.episode }));
  const layout = layoutProofB2({ items, branches: graph.lanes, finalReceipt: true, widthPx: 1440, heightPx: 900 });
  const declared = new Set(graph.edges.map((edge) => `${edge.parent}->${edge.child}`));
  assert.equal(layout.threads.length, graph.edges.length, "79 threads for 79 declared relations");
  for (const thread of layout.threads) assert.ok(declared.has(`${thread.parent}->${thread.child}`), `${thread.key} is declared`);
  // Union-find over the drawn threads: the signalStop chapter stays its own component.
  const parent = new Map(layout.beads.map((bead) => [bead.evidenceId, bead.evidenceId] as const));
  const find = (id: string): string => { const p = parent.get(id)!; if (p === id) return id; const root = find(p); parent.set(id, root); return root; };
  for (const thread of layout.threads) parent.set(find(thread.parent), find(thread.child));
  const sizes = new Map<string, number>();
  for (const bead of layout.beads) sizes.set(find(bead.evidenceId), (sizes.get(find(bead.evidenceId)) ?? 0) + 1);
  assert.deepEqual([...sizes.values()].sort((a, b) => b - a), [45, 13], "two components, 45 + 13 — INTENTIONALLY_DISCONNECTED, kept");
  const signalStop = graph.receipts.filter((r) => r.episode === "signalStop").map((r) => r.evidenceId);
  assert.equal(signalStop.length, 13);
  assert.equal(new Set(signalStop.map(find)).size, 1, "the thirteen are one component");
  const other = graph.receipts.filter((r) => r.episode !== "signalStop").map((r) => find(r.evidenceId));
  assert.ok(!other.includes(find(signalStop[0]!)), "…joined to nothing else");
  // The quarantined receipts are drawn, named, and never inputs of the Final Receipt.
  const quarantined = graph.receipts.filter((r) => r.assurance === "QUARANTINED").map((r) => r.evidenceId);
  assert.equal(quarantined.length, 2);
  assert.equal(graph.finalReceipt.causalInputEvidenceIds.length, 56);
  for (const id of quarantined) {
    assert.ok(layout.beads.some((bead) => bead.evidenceId === id), `${id} is drawn`);
    assert.ok(!graph.finalReceipt.causalInputEvidenceIds.includes(id), `${id} is not consumed`);
    assert.ok(!layout.anchors.some((anchor) => anchor.evidenceId === id), `${id} anchors no compilation`);
  }
});

test("ADV-08b: on the whole page a verdict colour is worn only by a verdict, or by the reconciliation's finding about one", () => {
  // Every use of a verdict token in nx.css, with the selector that wears it (comments stripped: a rule, not a mention).
  const css = readFileSync(new URL("../app/nx/nx.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const uses = [...css.matchAll(/^([^{\n]+)\{[^}]*var\(--nx-verdict-(?:valid|open|fail)\)/gm)].map((match) => match[1]!.trim());
  assert.ok(uses.length >= 4, `verdict colours are declared and worn: ${uses.length} rules`);
  const allowed = [
    /^\.nx-recorded\[data-tone="valid"\]/, // "verdict held after reconciliation" — the reconciliation band's finding about the verdict
    /^\.nx-band-facts em\[data-locality="RECONCILED"\]/, // the reconciliation completed: its receipt compared the verdict
    /^\.nx-reconciliation\[data-tone="(COMPLETE|FAILED)"\]/, // the band's finding, complete or failed
  ];
  for (const selector of uses) assert.ok(allowed.some((rule) => rule.test(selector)), `a verdict colour worn outside a verdict: ${selector}`);
  // …and never by the link chip, an established line, the unresolved lane or a flash.
  assert.match(css, /\.nx-link-chip\[data-link="CONNECTED"\] i b \{ background: var\(--nx-ink\)/, "a link that is up is a fact in ink, not a verdict (NX4: nor a lamp)");
  assert.match(css, /\.nx-established i \{[^}]*background: var\(--nx-ink\)/, "an established line is a fact in ink");
  assert.doesNotMatch(css, /unresolved[^\n]*--nx-verdict/, "an unresolved provenance is not a verdict state");
  assert.doesNotMatch(css, /RESTORED[^\n]*--nx-verdict/, "a restored link is not a verdict");
  // The embedded panel's rules left with the panel.
  assert.doesNotMatch(css, /\.nx-verifier\[|\.nx-verdict\b|\.nx-drop-zone|\.nx-verifier-received|\.nx-verdict-code|\.nx-verifier-relation/, "no rule for a class nothing renders");
});

test("ADV-08c: the verdict map is the site's — REVOKED weighs as INDETERMINATE does, INVALID alone fails", () => {
  assert.match(verifierCss, /\.nx-verifier-surface\[data-verdict="INDETERMINATE"\], \.nx-verifier-surface\[data-verdict="REVOKED"\] \{ --nx-vs-verdict: var\(--nx-verdict-open/);
  assert.match(verifierCss, /\.nx-verifier-surface\[data-verdict="INVALID"\] \{ --nx-vs-verdict: var\(--nx-verdict-fail/);
  const site = readFileSync(new URL("../../../site/src/components/cinematic-scene/scenePalette.ts", import.meta.url), "utf8");
  assert.match(site, /REVOKED: "#8a5a10"/, "the site's light verdict map: REVOKED is the warning colour");
  assert.match(readFileSync(new URL("../app/nx/nx.css", import.meta.url), "utf8"), /--nx-verdict-open: #8a5a10;/);
});

test("ADV-08: no assurance before the verdict — the receiving surface answers in the accent, never in a verdict colour", () => {
  const dropzone = verifierCss.slice(verifierCss.indexOf(".nx-vs-dropzone"), verifierCss.indexOf("/* RECEIVED"));
  assert.match(dropzone, /\[data-drop="armed"\] \{[^}]*--nx-accent/);
  assert.match(dropzone, /\[data-drop="over"\] \{[^}]*--nx-accent/);
  assert.doesNotMatch(dropzone, /--nx-verdict|--nx-signal-green|#1f7a52|#1f9d55/, "no green promise on an empty receiving surface");
  const received = verifierCss.slice(verifierCss.indexOf("/* RECEIVED"), verifierCss.indexOf("/* ANALYZE"));
  assert.doesNotMatch(received, /--nx-verdict|#1f7a52/, "the received record is a record, not a verdict");
  assert.doesNotMatch(surface, /data-tone="valid"/, "the received record wears no verdict tone");
  // Verdict colour appears only under a verdict attribute.
  const verdictUses = [...verifierCss.matchAll(/--nx-verdict-(valid|open|fail)/g)];
  assert.ok(verdictUses.length >= 3);
  const verdictBlock = verifierCss.slice(verifierCss.indexOf('.nx-verifier-surface[data-verdict="VALID"]'), verifierCss.indexOf(".nx-vs-verdict {"));
  assert.equal([...verdictBlock.matchAll(/--nx-verdict-(valid|open|fail)/g)].length, verdictUses.length, "every use of a verdict colour is keyed on data-verdict");
});

test("ADV-10: the artifact and the analysis are keyed on the moment being reached, never on the running clock", () => {
  // Keyed on the clock, the bundle and the artifact were minted anew on every
  // frame of playback and the analysis effect restarted with them: a person
  // who pressed ANALYZE during the last two seconds of playback saw
  // "Analyzing" while the verifier was restarted sixty times a second.
  assert.match(engine, /const pebComplete = masterTime >= PEB_COMPLETE_MS;/);
  assert.match(engine, /const handoffReady = masterTime >= HANDOFF_READY_MS;/);
  assert.match(engine, /\}, \[activeRecords, closure, finalReceipt, pebComplete\]\);/, "the bundle's memo reads the gate, not the clock");
  assert.match(engine, /\[handoffReady, portablePeb\],\s*\);/, "the artifact's memo reads the gate, not the clock");
  assert.doesNotMatch(engine, /\}, \[activeRecords, closure, finalReceipt, masterTime\]\);/);
  assert.doesNotMatch(engine, /\[masterTime, portablePeb\]/);
  // There is no fused pick-and-drop act left for anything to call.
  assert.doesNotMatch(engine, /const handoff = useCallback/, "no fused act");
  assert.doesNotMatch(engine, /handoff: \(\) => void;/);
});

test("ADV-11: keys pressed inside the verifier act on the instrument — Space there never plays, pauses or restarts the mission", () => {
  assert.match(experience, /target\.closest\("button, input, select, textarea, a, summary, \[role='button'\], \.nx-panel-body, \[role='dialog'\]"\)/, "the page's Space handler excludes the dialog");
  assert.match(surface, /role="dialog"/);
});

test("ADV-12: clicking the PEB keeps it in hand; OPEN and acknowledged DROP remain separate", () => {
  assert.match(experience, /engine\.pick\(\);\s*setHandoffStatus\("idle"\);/);
  assert.doesNotMatch(experience, /CLICK_SLOP_PX|setPointerCapture|isOverHandoff/);
  assert.match(experience, /onClick=\{submitPeb\}/);
  assert.match(experience, /onReceived: \(expected\) => \{[\s\S]*current\.drop\(\)/);
  assert.match(engine, /const stage = transferStageRef\.current;\s*const next = resolveArtifactRelease\(stage, "INSERT"\);\s*if \(next === stage\) return;/, "a no-op drop records nothing");
  assert.match(experience, /model\.handoff\.stage === "CARRIED" \? <span className="nx-peb-held"/);
});

test("ADV-09: the instrument is porcelain and paper, not graphite — and it does not glow", () => {
  const backgrounds = [...verifierCss.matchAll(/background:\s*([^;]+);/g)].map((m) => m[1]!.trim());
  assert.ok(backgrounds.length >= 8);
  for (const value of backgrounds) {
    assert.ok(/var\(--nx-(paper|porcelain|accent|ink|mineral|vs-verdict)|transparent|color-mix|currentColor/.test(value), `a token or a mix of tokens: ${value}`);
    assert.doesNotMatch(value, /^#(0|1|2)[0-9a-f]{5}\b/, `never a dark literal: ${value}`);
  }
  assert.doesNotMatch(verifierCss, /backdrop-filter|filter:\s*blur|text-shadow|particle|glow|neon|linear-gradient\(|radial-gradient\(/, "no glow, no particles, no gradients");
  const shadows = [...verifierCss.matchAll(/box-shadow:\s*([^;]+);/g)].map((m) => m[1]!);
  for (const value of shadows) assert.doesNotMatch(value, /\b(2[0-9]|[3-9][0-9])px [0-9]+px [0-9]+px (var\(--nx-accent|#3552c9|rgba\(53, 82, 201)/, `no coloured glow: ${value}`);
  // The scrim is ink at a third; the panel is paper.
  assert.match(verifierCss, /\.nx-vs-scrim \{[^}]*color-mix\(in srgb, var\(--nx-ink, #16171b\) 34%, transparent\)/);
  assert.match(verifierCss, /\.nx-verifier-surface \{[^}]*background: var\(--nx-paper, #fffdf9\);/);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { en } from "../../../site/src/i18n/locales/en.ts";
import { fr } from "../../../site/src/i18n/locales/fr.ts";
import { VISUAL_EVENTS } from "../app/visualEvents.ts";
import {
  exactProducerStageSlot,
  receiptEmissionSourceForProducer,
} from "../app/stageGeometry.ts";

/**
 * D-006B-1 regression guard.
 *
 * D-006B found that the demonstration told the viewer to be an audience before
 * any interaction design could matter. These tests hold the participatory
 * framing in place: they are about voice, ownership and restraint, not geometry.
 */

const component = readFileSync(new URL("../app/ConvergenceExperience.tsx", import.meta.url), "utf8");
const stylesheet = readFileSync(new URL("../app/convergence.css", import.meta.url), "utf8");

/** Copy the viewer actually reads, with code identifiers stripped out. */
function viewerCopy(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ")
    .replace(/className=\{?[`"][^`"]*[`"]\}?/g, " ")
    .replace(/aria-label=\{?[`"][^`"]*[`"]\}?/g, " ");
}

test("D-006B-1: the demonstration never instructs the viewer to spectate", () => {
  const copy = viewerCopy(component);
  for (const banned of [/\bWatch\b/, /\bObserve\b/, /\bAnticipate\b/]) {
    assert.doesNotMatch(copy, banned, `spectator framing returned: ${banned}`);
  }
});

test("D-006B-1: the public journey is HAPPENED to EVIDENCE to VERIFY without role narration", () => {
  assert.deepEqual(en.d006c2.journey, ["HAPPENED", "EVIDENCE", "VERIFY"]);
  assert.equal(fr.d006c2.journey.length, 3, "the French journey must preserve the same three semantic layers");
  assert.match(component, /\{d006c2\.journey\.map\(\(label, index\) => \(/);
  assert.match(component, /className="journey-language"/);
  assert.doesNotMatch(component, /JOURNEY_STAGES|VIEWER_ROLES|className="role-cue"/,
    "the public journey must not reintroduce internal stages or narrated viewer roles");
});

test("D-006B-1: the first click is the request", () => {
  assert.match(component, /masterTime === 0 \? d006c2\.callTaxi/);
  assert.doesNotMatch(component, /"Run mission"/);
  assert.match(component, /\{d006c2\.missionKicker\}/);
  for (const dictionary of [en, fr]) {
    assert.match(dictionary.d006c2.missionKicker, /D-006/);
    assert.match(dictionary.d006c2.missionKicker, /TAXI 07/);
  }
  assert.equal(VISUAL_EVENTS[0].actor, "You", "the opening receipt must be emitted by the viewer");
  assert.equal(receiptEmissionSourceForProducer("Passenger service"), "exactProducer");
  assert.ok(exactProducerStageSlot("Passenger service") !== null,
    "the canonical producer behind the viewer's request must retain its own stage position");
});

test("D-006B-1: the authority moment is staged, not a floating card", () => {
  assert.match(component, /data-authority-gate=\{waitingForAuthority \? "true" : "false"\}/);
  assert.match(component, /<AuthorityWorkspace onDecision=\{decide\} copy=\{d006c2\.authority\} \/>/);
  assert.match(component, /\{copy\.required\}/);
  assert.match(component, /\{copy\.question\}/);
  assert.match(component, /\{copy\.localEvidence\}/);
  assert.match(stylesheet, /\[data-authority-gate="true"\][\s\S]{0,400}opacity/,
    "the rest of the stage must recede while authority is asked");
  // No extra workflow: the gate still resolves in exactly two buttons.
  const gateStart = component.indexOf('className="human-decision-instrument authority-workspace"');
  const gate = component.slice(gateStart, component.indexOf("</aside>", gateStart));
  assert.equal((gate.match(/<button/g) ?? []).length, 2, "the authority moment must stay a two-button decision");
});

test("D-006B-1: the Evidence Flower is a mechanism, fed by real families", () => {
  const familyDeclaration = component.match(/const EVIDENCE_FAMILIES = \[([^\]]+)\]/)?.[1] ?? "";
  assert.equal(familyDeclaration, '"mission", "vehicle", "infrastructure", "service", "human", "financial"');
  assert.doesNotMatch(familyDeclaration, /IDENTITY|identity/, "no identity family may be invented");
  assert.match(component, /function EvidenceFlower/);
  assert.doesNotMatch(component, /function EvidenceBud/);
  // Fed by the same branch growth that builds the tree, never by a second clock.
  assert.match(component, /item\.growth/);
  assert.match(stylesheet, /\.flower-segment > i\s*\{[\s\S]*?clip-path/, "segments must be geometric wedges");
  assert.match(stylesheet, /transform:\s*scale\(var\(--segment-fill\)\)/, "a segment's radius is its family's fill");
  assert.doesNotMatch(stylesheet, /\.bud-petals|\.evidence-bud/, "the botanical bud must not survive alongside it");
});

test("D-006C corrective F3: the viewer takes the evidence and carries it", () => {
  // The physical review rejected click-to-teleport. Possession is now real:
  // take -> carry -> insert, and a drop that misses the target hands nothing
  // over.
  assert.match(component, /className="handover-control"/);
  assert.match(component, /\{d006c2\.proof\.take\}/);
  assert.match(component, /aria-label=\{d006c2\.verifier\.insert\}/);
  assert.match(component, /const takeArtifact = useCallback/);
  assert.match(component, /const insertArtifact = useCallback/);
  assert.match(component, /const returnArtifactToSource = useCallback/);
  // Missing the target must return the artifact, not complete the handoff.
  assert.match(component, /if \(isOverInsertionTarget\(event\.clientX, event\.clientY\)\) insertArtifact\(\);\s*\n\s*else returnArtifactToSource\(\);/);
  // Pointer events, not HTML5 drag: touch and pen work, and a presenter's
  // remote still has the keyboard path through the same two controls.
  assert.doesNotMatch(component, /onDragStart|draggable|onDrop/, "the transfer must not depend on drag and drop");
  assert.match(component, /onPointerDown=\{onArtifactPointerDown\}/);
  assert.match(component, /takeArtifact\("HELD"\)/, "a keyboard path must exist");
  assert.match(component, /onPointerCancel=\{onArtifactPointerCancel\}/);
  assert.doesNotMatch(component, /onTransitionEnd=/, "a transition may never complete the handoff");
  // One element is lifted, carried and inserted: no copy, no replacement.
  assert.equal((component.match(/artifact-transfer-object/g) ?? []).length, 1);
  // and the automated chain may not start before the viewer has acted.
  assert.match(component, /bundleStage !== "TRANSFERRED"\) return;/);
});

test("D-006B-1: the six-step wizard has not come back", () => {
  for (const banned of [/analysis-sequence/, /"Insert", "Inspect", "Open", "Reveal"/, /Begin inspection/, /Open Evidence Bud/, /Reveal internal proof/]) {
    assert.doesNotMatch(component, banned, `the wizard returned: ${banned}`);
  }
  // D-006C corrective F5. This assertion previously required ZERO mission-path
  // controls in the verification act, which let the chain start itself as soon
  // as the artifact arrived. Insertion and analysis stay two explicit acts;
  // the separate light/dark controls only change presentation.
  const actStart = component.indexOf('<section id="verification"');
  const act = component.slice(actStart, component.indexOf("</section>", actStart));
  assert.equal((act.match(/artifact-target-anchor insertion-control/g) ?? []).length, 1,
    "the verifier must expose exactly one visible insertion target");
  assert.equal((act.match(/className="analyze-control"/g) ?? []).length, 1,
    "the verifier must expose exactly one explicit analysis control");
  // C3-R1: the light/dark presentation buttons were removed with dark mode;
  // nothing presentational may have replaced them inside the verification act.
  assert.doesNotMatch(act, /setVerifierTheme|verifier-theme-control/);
  assert.match(act, /disabled=\{bundleStage !== "FORMED" \|\| carryMode !== "HELD"\}/);
  assert.match(act, /onClick=\{insertArtifact\}/,
    "keyboard insertion must remain available at the visible target");
  assert.match(act, /className="analyze-control"/, "that control must be the explicit analyze activation");
  assert.match(act, /onClick=\{\(\) => setAnalysisRequested\(true\)\}/);
  // The mandatory path is exactly three acts: request, decide, hand over.
  // D-006C corrective F3: the third act used to be `onClick={handOverProof}`,
  // one click that sent the evidence by itself. It is now take -> carry ->
  // insert: still one deliberate act, but one the viewer performs.
  for (const control of [/masterTime === 0 \? d006c2\.callTaxi/, /onDecision\("APPROVED"\)/, /onClick=\{\(\) => takeArtifact\("HELD"\)\}/]) {
    assert.match(component, control, `a mandatory act is missing: ${control}`);
  }
});

test("D-006B-1: the viewer leaves with a result, not a status code", () => {
  assert.equal(en.d006c2.verifier.verdicts.VALID.headline, "Evidence holds.");
  assert.equal(new Set(Object.values(en.d006c2.verifier.verdicts).map(({ headline }) => headline)).size, 4);
  assert.match(component, /d006c2\.verifier\.verdicts\[verificationResult\.verdict\]\.headline/);
  const verdict = component.slice(component.indexOf("instrument-verdict"), component.indexOf("</section>", component.indexOf("instrument-verdict")));
  assert.ok(
    verdict.indexOf("d006c2.verifier.verdicts[verificationResult.verdict].headline")
      < verdict.indexOf("d006c2.verifier.canonicalVerdict"),
    "the plain reading must precede the canonical token",
  );
  assert.match(component, /className="verdict-token"/);
  assert.match(stylesheet, /\.verdict-token\s*\{/);
});

test("D-006B-1: at most three progress systems survive", () => {
  const retired = [
    "lifecycle-rail",
    "analysis-sequence",
    "smart-city-boundary",
    "causal-chain",
    "proof branches complete",
    "anticipation-cue",
    "formation-station",
  ];
  const survivors = retired.filter((token) => component.includes(token));
  assert.deepEqual(survivors, [], `retired guidance systems still render: ${survivors.join(", ")}`);
  // What remains: the journey rail, the master clock, the event ribbon.
  assert.match(component, /className="journey-language"/);
  assert.match(component, /\{d006c2\.missionClock\}/);
  assert.match(component, /className="event-ribbon"/);
});

test("D-006B-1: retired vocabulary is gone from what the viewer reads", () => {
  const copy = viewerCopy(component);
  for (const term of [/Chamber of Revelation/i, /Evidence Bud/, /Living Proof Maturity/i, /Significant event/i, /Revelation chamber/i]) {
    assert.doesNotMatch(copy, term, `retired vocabulary survived: ${term}`);
  }
});

/* --- D-006C: the proof is explored ---------------------------------------
 *
 * D-006C keeps the D-006B-1 framing and adds one capability: a nano-receipt
 * can be inspected, and inspecting it must reconnect it to its cause. These
 * guard the wiring that makes that reversal work, and the restraint that
 * keeps normal playback calm.
 */

test("D-006C: a nano-receipt chip is inspectable by pointer, touch and keyboard", () => {
  // Hover and pin are separate intentions. Folding them into one scalar made a
  // pointer leaving the ribbon clear a reading the keyboard still owned, and
  // made pinning impossible with a mouse.
  assert.match(component, /const \[hoveredEventId, setHoveredEventId\]/);
  assert.match(component, /const \[pinnedEventId, setPinnedEventId\]/);
  assert.match(component, /const inspectedEventId = hoveredEventId \?\? pinnedEventId;/);
  // The chip must carry its identity into the DOM, or nothing can join to it.
  assert.match(component, /data-event-id=\{event\.id\}/);
  assert.match(component, /onMouseEnter=\{\(\) => setHoveredEventId\(event\.id\)\}/);
  assert.match(component, /onMouseLeave=\{\(\) => setHoveredEventId\(null\)\}/);
  assert.match(component, /onFocus=\{\(\) => setPinnedEventId\(event\.id\)\}/);
  assert.match(component, /onBlur=\{\(\) => setPinnedEventId\(null\)\}/);
  // Activating a chip pins its reading. It must NOT seek: seek() calls
  // resetHandoff(), so a click after verification destroyed the verdict the
  // viewer had just produced.
  assert.match(component, /onClick=\{\(\) => setPinnedEventId\(\(current\) => \(current === event\.id \? null : event\.id\)\)\}/);
  assert.doesNotMatch(component, /onClick=\{\(\) => \{ seek\(/);
});

test("D-006C: inspection reads as language, never as a cryptographic dump", () => {
  const panel = component.slice(component.indexOf('className={`receipt-inspection'));
  const body = panel.slice(0, panel.indexOf("</aside>"));
  assert.match(body, /\{d006c2\.proof\.producedBy\}/);
  assert.match(body, /\{d006c2\.proof\.recordedAt\}/);
  assert.match(body, /\{d006c2\.proof\.evidence\}/);
  assert.doesNotMatch(body, /digest|public key|payload|hash|blake3|ed25519/i);
  // The verification act must stay button-free; the panel lives well before it.
  assert.equal((body.match(/<button/g) ?? []).length, 0);
  assert.ok(
    component.indexOf('className={`receipt-inspection') < component.indexOf('<section id="verification"'),
    "the inspection panel must render before the verification act",
  );
});

test("D-006C: inspecting a receipt lights up its branch, its family and its actor", () => {
  assert.match(component, /data-linked-actor=\{inspectedBinding\?\.producerDomain \?\? ""\}/);
  assert.match(component, /data-linked-branch=\{inspectedEvent\?\.branch \?\? ""\}/);
  assert.match(component, /data-linked-family=\{inspectedBinding\?\.receiptKind \?\? ""\}/);
  // P2R made the proof band a projection of evidence objects, so the leaf
  // being inspected is keyed by its LEAF id — which is derived from the
  // evidence identity — rather than by a presentation event id. The invariant
  // is unchanged: inspecting a leaf marks that leaf, and only that leaf.
  assert.match(component, /leaf\.leafId === inspectedBinding\?\.leafId \? " is-linked" : ""/);
  assert.match(stylesheet, /\.proof-leaf\.is-linked/);
  assert.match(stylesheet, /\[data-linked-family="infrastructure"\]/);
});

test("D-006C: every featured chip's actor reaches something in Mission Reality", () => {
  // Highlights follow the canonical producer domain carried by the exact
  // receipt binding, never an independently-authored presentation label.
  for (const domain of [
    "Passenger service",
    "Traffic Provider",
    "Taxi autonomy",
    "Garage",
    "Fleet operations",
    "FINANCIAL_INSTITUTION",
  ]) {
    const source = receiptEmissionSourceForProducer(domain);
    assert.ok(source !== null, `${domain} must resolve to a reality actor`);
    if (source === "exactProducer") {
      assert.ok(exactProducerStageSlot(domain) !== null, `${domain} needs its own exact-producer slot`);
    }
  }
  assert.match(component, /data-producer-domain=\{actor\}/);
  assert.match(component, /actor === linkedActor \? " is-linked" : ""/);
  assert.match(component, /linkedActor=\{inspectedBinding\?\.producerDomain \?\? null\}/);
  assert.match(stylesheet, /\.exact-producer-actor\.is-linked/);
});

test("D-006C: an open reading can be dismissed and does not survive a restart", () => {
  // WCAG 2.1 SC 1.4.13 requires hover/focus content to be dismissible. The
  // Escape branch has to sit before the guard that ignores focused buttons,
  // because a focused chip is exactly where the viewer is.
  const handler = component.slice(component.indexOf("const onKeyDown"));
  const body = handler.slice(0, handler.indexOf("window.addEventListener"));
  const escapeIndex = body.indexOf('event.code === "Escape"');
  const interactiveGuardIndex = body.indexOf('target.closest("button, input');
  assert.ok(
    escapeIndex >= 0 && interactiveGuardIndex > escapeIndex,
    "Escape must be handled before focused interactive controls are ignored",
  );
  const restart = component.slice(component.indexOf("const restart = useCallback"));
  const restartBody = restart.slice(0, restart.indexOf("}, ["));
  assert.match(restartBody, /setHoveredEventId\(null\)/);
  assert.match(restartBody, /setPinnedEventId\(null\)/);
});

test("D-006C: the reading is addressable rather than announced on every hover", () => {
  // aria-live on a node mounted together with its content either says nothing
  // or interrupts once per chip as the pointer crosses the ribbon. A named
  // panel the chip points at is both quieter and actually reachable.
  assert.match(component, /id="receipt-inspection"/);
  assert.match(component, /aria-describedby=\{event\.id === inspectedEventId \? "receipt-inspection" : undefined\}/);
  assert.match(component, /aria-label=\{d006c2\.proof\.receiptDetail\}/);
  // Scoped to the named panel: other deliberate, always-mounted live regions
  // are outside it and keep their own announcement behavior.
  const aside = component.slice(component.indexOf('id="receipt-inspection"'));
  assert.doesNotMatch(aside.slice(0, aside.indexOf("</aside>")), /aria-live/);
});

test("D-006C: the evidence artifact is handed over, not duplicated", () => {
  assert.equal((component.match(/<EvidenceFlower/g) ?? []).length, 1, "one artifact node must serve source, transit and verifier");
  assert.match(component, /className="artifact-transfer-layer"/);
  assert.match(component, /setBundleStage\("FORMED"\)/, "the artifact needs a real in-flight state");
  assert.match(component, /sourceArtifactAnchorRef/);
  assert.match(component, /verifierArtifactAnchorRef/);
  assert.match(stylesheet, /\.artifact-transfer-object\[data-transfer-stage="FORMED"\]/);
  assert.doesNotMatch(stylesheet, /artifact-arrives|visibility:\s*hidden/);
});

test("D-006C: normal playback stays calm", () => {
  // Nothing is inspected until the viewer asks. Both inspection states start
  // null, and the panel is conditional on it.
  //
  // This used to count every `useState<string | null>(null)` in the file and
  // require exactly 2. That is a proxy for the invariant, not the invariant:
  // it passed only while the inspection states were the sole nullable strings,
  // so any unrelated nullable state broke it while a defaulted-to-non-null
  // inspection state would have slipped through. Name the two states instead.
  assert.match(component, /const \[hoveredEventId, setHoveredEventId\] = useState<string \| null>\(null\)/);
  assert.match(component, /const \[pinnedEventId, setPinnedEventId\] = useState<string \| null>\(null\)/);
  assert.match(component, /\{inspectedEvent !== null && inspectedBinding !== null && \(/);
});

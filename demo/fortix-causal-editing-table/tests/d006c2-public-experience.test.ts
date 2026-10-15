import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { en } from "../../../site/src/i18n/locales/en.ts";
import { fr } from "../../../site/src/i18n/locales/fr.ts";

const appRoot = new URL("../app/", import.meta.url);
const component = readFileSync(new URL("ConvergenceExperience.tsx", appRoot), "utf8");
const stylesheet = readFileSync(new URL("convergence.css", appRoot), "utf8");
const sceneCanvas = readFileSync(
  new URL("../../../site/src/components/cinematic-scene/SceneCanvas.tsx", import.meta.url),
  "utf8",
);
const evidenceRig = readFileSync(
  new URL("../../../site/src/components/cinematic-scene/EvidenceRig.tsx", import.meta.url),
  "utf8",
);
const rendererContract = readFileSync(
  new URL("../../../site/src/components/cinematic-scene/rendererContract.ts", import.meta.url),
  "utf8",
);

test("D-006-C2: the public story is HAPPENED → EVIDENCE → VERIFY in both locales", () => {
  assert.deepEqual(en.d006c2.journey, ["HAPPENED", "EVIDENCE", "VERIFY"]);
  assert.deepEqual(fr.d006c2.journey, ["FAITS", "PREUVES", "VÉRIFIER"]);
  assert.match(en.d006c2.heroQuestion, /What happened\?/);
  assert.match(fr.d006c2.heroQuestion, /Que s’est-il passé \?/);
  assert.notEqual(en.d006c2.heroAnswer, fr.d006c2.heroAnswer);
  assert.match(component, /t\.d006c2/);
  assert.doesNotMatch(component, /const JOURNEY_STAGES = \["Request", "Mission", "Evidence", "Verification", "Verdict"\]/);
  assert.doesNotMatch(component, /className="role-cue"/);
});

test("D-006-C2: a testable public causal layer explains physical AI before internals", async () => {
  const moduleUrl = new URL("publicExperience.ts", appRoot);
  assert.ok(existsSync(moduleUrl), "publicExperience.ts must project the public causal layer");
  const publicExperience = await import(moduleUrl.href);
  assert.deepEqual(publicExperience.publicCausalScene("taxi-decides-stop", "CONNECTED"), {
    kind: "physicalAi",
    steps: ["see", "understand", "decide", "act"],
  });
  assert.deepEqual(publicExperience.publicCausalScene("human", "CONNECTED"), {
    kind: "authority",
    steps: ["amount", "boundary", "decision"],
  });
  assert.deepEqual(publicExperience.publicCausalScene("complete", "LOST"), {
    kind: "network",
    steps: ["networkLost", "missionContinues", "evidenceContinues"],
  });
  assert.match(component, /className="public-causal-layer"/);
  assert.match(component, /d006c2\.actorLabels\[leaf\.domain\] \?\? d006c2\.proof\.source/);
  assert.doesNotMatch(component, /<span><b>\{leaf\.domain\}<\/b>\{leaf\.label\}<\/span>/,
    "active French proof captions may not leak English evidence labels");
});

test("D-006-C2: the physical network beat is sentinel-driven and unmistakable", () => {
  assert.match(component, /className="network-continuity-beat"/);
  assert.match(component, /linkPhase === "LOST" \|\| transitionFlash === "LOST"/);
  assert.match(component, /visiblePhysicalLinkState\(linkReport, networkState\)/,
    "an unobserved journal baseline must never read as a physical connection");
  assert.match(component, /className="network-test-cue"/);
  assert.doesNotMatch(component, /setNetworkState\("LOST"\)/,
    "the timeline or a public control may never synthesize physical loss");
  assert.match(component, /LINK_SENTINEL_TIMEOUT_MS/);
  assert.match(component, /signal: controller\.signal/,
    "a stalled sentinel request must expire to UNKNOWN instead of preserving stale CONNECTED");
  assert.match(component, /machineResult\.reason === "DUPLICATE_OBSERVATION"[\s\S]*current && agreesWithAdmittedState/,
    "a fresh cached sidecar sample must not make the physical indicator oscillate");
  assert.match(component, /if \(!attemptFinished\) reconciliationStartedRef\.current = false;/,
    "a cancelled reconciliation attempt must retry after current link truth returns");
  assert.doesNotMatch(component, /setTransitionFlash\("RESTORED"\)[\s\S]{0,120}setNetworkState\("RESTORED"\)/,
    "RESTORED is an event, never a stable network state");
});

test("D-006-C2: the authority choice is human-readable and has no decorative QR", () => {
  assert.doesNotMatch(component, /authorizationQr|authorization-qr|simulatedQrMatrix|AUTHORIZATION_QR_MODULE_PX/);
  assert.equal(en.d006c2.authority.requestedAmount, "€1,850");
  assert.equal(en.d006c2.authority.limitAmount, "€500");
  assert.equal(fr.d006c2.authority.requestedAmount, "1 850 €");
  assert.equal(fr.d006c2.authority.limitAmount, "500 €");
  assert.match(component, /copy\.requestedAmount/);
  assert.match(component, /copy\.limitAmount/);
  assert.match(component, /data-authority-actors="split"/);
  assert.doesNotMatch(component, />FLEET<br \/>AUTHORITY</);
});

test("D-006-C2/R1: verifier identity and trust are progressively disclosed; dark mode is gone", () => {
  assert.match(component, /<details className="verifier-identity"/);
  assert.match(component, /INDEPENDENT_VERIFICATION_PROFILE/);
  assert.match(component, /PINNED_TRUST_ANCHORS/);
  // C3-R1, human decision: light is the sole public presentation. No theme
  // state, no toggle, no dark styling, no hidden variant behind a flag.
  assert.doesNotMatch(component, /verifierTheme|setVerifierTheme|data-verifier-theme/);
  assert.doesNotMatch(stylesheet, /data-verifier-theme|verifier-theme-control/);
  assert.doesNotMatch(stylesheet, /"dark"/);
  assert.match(stylesheet, /\.verifier-instrument \{[\s\S]{0,80}--verifier-bg:\s*#fffdf8/i,
    "the light values are now the verifier's only values");
});

test("D-006-C2: transversality appears only after the verifier has produced a result", () => {
  assert.match(component, /verificationResult !== null && \(<TransversalityReveal/);
  assert.match(component, /from "\.\/TransversalityReveal"/);
  assert.doesNotMatch(component, /Honeycorn/i);
});

test("D-006-C2: the main-site 3D renderer and materials follow the active theme", () => {
  assert.match(sceneCanvas, /useTheme\(\)/);
  assert.match(sceneCanvas, /outputColorSpace\s*=\s*SCENE_RENDERER_CONTRACT\.outputColorSpace/);
  assert.match(sceneCanvas, /toneMapping\s*=\s*SCENE_RENDERER_CONTRACT\.toneMapping/);
  assert.match(rendererContract, /outputColorSpace:\s*THREE\.SRGBColorSpace/);
  assert.match(rendererContract, /toneMapping:\s*THREE\.NoToneMapping/);
  assert.match(sceneCanvas, /<EvidenceRig[\s\S]*?theme=\{theme\}/);
  assert.match(evidenceRig, /theme: Theme/);
  assert.match(evidenceRig, /toneMapped=\{SCENE_RENDERER_CONTRACT\.structuralToneMapped\}/);
  assert.doesNotMatch(evidenceRig, /originShellOpacity \* 0\.5/);
});

test("D-006-C2: responsive and accessible public controls survive compact screens", () => {
  assert.match(stylesheet, /@media \(max-width: 480px\)/);
  assert.match(stylesheet, /\.public-causal-layer/);
  assert.match(stylesheet, /\.network-continuity-beat/);
  // C3-R1: the 44px touch-target rule moves to the public language mode,
  // the only segmented control that remains.
  assert.match(stylesheet, /\.language-mode button[\s\S]{0,200}min-height:\s*30px/);
  assert.match(component, /aria-pressed=\{locale === "en"\}/);
  assert.match(component, /aria-pressed=\{locale === "fr"\}/);
  assert.match(stylesheet, /@media \(prefers-reduced-motion: reduce\)[\s\S]*network-continuity-beat/);
  assert.doesNotMatch(component, /clock-readout" aria-live/,
    "the continuously changing mission clock must not flood the live queue");
  assert.match(component, /ref=\{verdictRef\}[\s\S]{0,260}tabIndex=\{-1\}/,
    "the focused verdict is announced once without a duplicate live region");
});

test("D-006-C2 addendum: experience color is richer than, and independent from, verdict semantics", () => {
  assert.match(stylesheet, /Experience colors describe actors, space and temporary causal emphasis/);
  assert.match(stylesheet, /--fx-magenta:\s*#bd2fd1/i);
  assert.match(stylesheet, /\.family-financial > i, \.family-financial > em \{ --family-color: var\(--fx-magenta\); \}/);
  assert.match(stylesheet, /\.inspection-family\.family-financial \{ --inspection-family-color: var\(--fx-magenta\); \}/);
  assert.doesNotMatch(stylesheet, /family-financial[^\n]*var\(--fx-valid\)/,
    "financial evidence is a trust-domain family, not a VALID verdict");
  assert.match(component, /network:\s*"cyan"/,
    "network evidence uses a non-semantic experience tone");
  assert.doesNotMatch(component, /network:\s*"green"/,
    "network evidence cannot borrow the historic green status tone");
  assert.doesNotMatch(stylesheet, /--fx-green:/,
    "a green alias cannot silently reconnect experience styling to VALID");
  assert.match(stylesheet, /\.public-causal-layer li \{[\s\S]{0,260}grid-template-columns/,
    "causality must retain shape and position rather than depend on color");
  assert.match(stylesheet, /\.public-causal-layer li \+ li::before/,
    "the causal relationship retains an explicit connector");
  assert.match(component, /aria-current=\{index === publicCausalSteps\.length - 1 \? "step" : undefined\}/,
    "the current causal step is exposed without relying on color");
  assert.match(stylesheet, /\.public-causal-layer li\.is-current \{[\s\S]{0,220}border-width:\s*2px;[\s\S]{0,220}translateY\(-3px\)/,
    "the current causal step changes geometry as well as color");
  assert.doesNotMatch(stylesheet, /\.public-causal-layer li > span \{\s*display:\s*none;/,
    "causal numbering survives compact layouts");
  assert.doesNotMatch(stylesheet, /--verifier-field:\s*#ffffff/i,
    "light mode uses a deliberate warm field rather than sterile corporate white");
  // C3-R1 §11: acid lime was the DARK evidence-structure solution; with
  // D-006 dark mode removed its only consumer went with it, and retaining an
  // unused legacy token would be exactly the obsolete inheritance the mandate
  // forbids. The main site's own dual-theme lime is untouched.
  assert.doesNotMatch(stylesheet, /--fx-structure-acid/);
  // C3-R1: dark is gone; the semantic-ink rules survive on the light-only
  // verifier selector and still separate semantics from decoration.
  assert.match(stylesheet, /\.verifier-instrument \.verdict-checks li \{ color:\s*var\(--verifier-valid-ink\); \}/,
    "successful checks use the accessible semantic ink");
  assert.match(stylesheet, /\.verifier-instrument \.verdict-not-established li \{ color:\s*var\(--verifier-indeterminate-ink\); \}/,
    "not-established checks use the accessible semantic ink");

  assert.match(stylesheet, /\.verifier-instrument[\s\S]{0,160}\.instrument-verdict \{[\s\S]{0,180}border-left-color:\s*var\(--verdict-color\)/,
    "surface borders cannot mask verdict semantics");
  assert.match(stylesheet, /\.instrument-verdict\.verdict-revoked \{[\s\S]{0,240}border-left-style:\s*double/,
    "REVOKED has a non-color shape distinction");
  assert.doesNotMatch(stylesheet, /\.evidence-flower\.is-complete \.flower-core \{[^}]*(?:var\(--fx-valid\)|var\(--fx-green\)|#00b65f)/i,
    "a complete evidence object is not automatically a VALID verdict");
  assert.doesNotMatch(stylesheet, /\.base-completion-cue \{[^}]*(?:var\(--fx-valid\)|var\(--fx-green\)|#00b65f)/i,
    "journey completion is not a trust verdict");
  assert.doesNotMatch(stylesheet, /\.reconciliation-complete \{[^}]*(?:var\(--fx-valid\)|var\(--fx-green\)|#00b65f)/i,
    "reconciliation completion is not a trust verdict");
});

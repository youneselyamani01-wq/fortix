import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { en } from "../../../site/src/i18n/locales/en.ts";
import { fr } from "../../../site/src/i18n/locales/fr.ts";
import { READABILITY_FLOORS } from "../app/nx/evidence/proofGeometry.ts";
import { VERIFIER_VIEWS } from "../app/verify/verifierRoutes.ts";

/**
 * D-006 NX1 §84 / R2 §15 / R3 §16 — structural contracts of the blank-slate
 * frontend, at the source level. These are necessary and not sufficient:
 * human review on the ZBook decides visual acceptance (§72).
 */

const NX_ROOT = new URL("../app/nx/", import.meta.url);
const read = (relative: string) => readFileSync(new URL(relative, NX_ROOT), "utf8");
/** Comments stripped: the contracts are about what the code DOES, not what it explains. */
const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

function nxFiles(): readonly string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else out.push(full);
    }
  };
  walk(new URL(".", NX_ROOT).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
  return out;
}

test("FS-R2: the document hierarchy is mission, current fact, compact evidence and controls", () => {
  const root = read("experience/NxExperience.tsx");
  const world = root.indexOf('className="nx-world"');
  const fact = root.indexOf("className={`nx-fact");
  const evidence = root.indexOf('className="nx-mission-evidence"');
  const controls = root.indexOf('className="nx-controls"');
  assert.ok(world > 0 && fact > world && evidence > fact && controls > evidence);
  assert.doesNotMatch(root, /<EvidenceDossier|<ProvenanceProof|<InspectPanel|<BoundaryKey|className="nx-workspace"/, "the mission shows no absent graph or graph-reading legend");
  assert.equal((root.match(/<h1[\s>]/g) ?? []).length, 1);
  assert.match(root, /aria-live="polite"/);
});

// NX3 re-pin. R3 placed the verifier as a drawer LEFT of the dossier. The
// B2 + Hero Surface mandate makes it a dedicated instrument over the mission
// (§9: "must no longer visually read as another subsection of the mission UI").
// The invariant kept: three surfaces, three files, three questions, none
// rendering another's content — and the verifier still after the band and
// the dossier in the document.
test("FS-R2: mission, PEB intake and causal inspection are separate surfaces", () => {
  const root = code(read("experience/NxExperience.tsx"));
  assert.doesNotMatch(root, /<EvidenceDossier|<InspectPanel|<ProvenanceProof|<VerifierPanel|<VerifierSurface/);
  assert.match(root, /className="nx-compact-handoff"/);
  assert.match(root, /openDemoVerifier\(\{/);
  const bridge = readFileSync(new URL("../app/verify/demoHandoff.ts", import.meta.url), "utf8");
  assert.match(bridge, /host\.open\(destination\.href, "_blank"\)/);
  const verifier = readFileSync(new URL("../app/verify/VerifierWorkspace.tsx", import.meta.url), "utf8");
  const reader = readFileSync(new URL("../app/verify/VerifierRouteClient.tsx", import.meta.url), "utf8");
  assert.match(verifier, /<VerifierRouteClient requestedView=\{embeddedView\}/, "received evidence opens a dedicated URL-based reading surface");
  assert.match(reader, /route\.view === "graph" && <ReceivedPebInspection text=\{loaded\.entry\.text\}/, "the causal surface reconstructs the exact received PEB");
  assert.match(verifier, /analyzeInsertedD006Peb\(inserted\)/);
  assert.doesNotMatch(verifier + reader, /role="dialog"/);
});

test("FS-R2: principal verifier views are visible native links with current-page and browser return semantics", () => {
  const dedicated = readFileSync(new URL("../app/verify/VerifierWorkspace.tsx", import.meta.url), "utf8");
  const reader = readFileSync(new URL("../app/verify/VerifierRouteClient.tsx", import.meta.url), "utf8");
  assert.match(dedicated, /className="verifier-skip" href="#verifier-surface"/);
  assert.match(reader, /className="verifier-skip" href="#verifier-route-content"/);
  for (const view of ["path", "timeline", "domains", "graph", "nanoreceipts", "forensic"] as const) {
    assert.ok(VERIFIER_VIEWS.includes(view), `${view} has its own navigable destination`);
  }
  const navigation = reader.slice(reader.indexOf('<nav className="verifier-route-nav"'), reader.indexOf('</nav>', reader.indexOf('<nav className="verifier-route-nav"')));
  assert.match(navigation, /aria-label=/, "the principal navigation has an accessible name");
  assert.match(navigation, /VERIFIER_PRIMARY_VIEWS\.map/);
  assert.match(navigation, /<a[^>]*href=\{href\}[^>]*aria-current=\{route\.view === view \? "page" : undefined\}/, "native links announce the current page and support keyboard and modified-click navigation");
  assert.match(dedicated, /const modularNavigation = file && received &&/, "views become available on receipt without requiring Analyze");
  assert.match(reader, /window\.history\.back\(\)/);
  assert.match(reader, /window\.addEventListener\("popstate"/);
  assert.match(reader, /className="verifier-context-return" href=\{returnPath\}/, "each reading surface also supplies an explicit return destination");
  assert.doesNotMatch(dedicated + reader, /<details className="verifier-technical-menu"|role="tablist"|role="dialog"|onMouseEnter|onMouseOver/, "principal views remain visible and do not require a custom tab interaction");
});

test("NX1 R3: the dossier is the hierarchy Mission → episodes → branches → nano-receipts → Final Receipt → PEB; no permanent raw board", () => {
  const dossier = code(read("workspace/EvidenceDossier.tsx"));
  const tiers = ["mission", "episodes", "branches", "nano-receipts", "final-receipt", "peb"];
  let last = -1;
  for (const tier of tiers) {
    const index = dossier.indexOf(`data-tier="${tier}"`);
    assert.ok(index > last, `tier ${tier} follows the previous tier`);
    last = index;
  }
  // The overview names groups and counts; receipt rows exist only inside a focused group.
  const overview = dossier.slice(dossier.indexOf("{focus === null && ("), dossier.indexOf('{(focus?.kind === "episode"'));
  assert.doesNotMatch(overview, /nx-episode-item|data-evidence-id/, "no nano-receipt rows on the overview");
  assert.match(dossier, /focus\?\.kind === "episode" \|\| focus\?\.kind === "branch"/);
  assert.match(dossier, /className=\{`nx-episode-item[\s\S]*?onClick=\{\(\) => onFocus\(\{ kind: "receipt", evidenceId: entry\.evidenceId \}\)\}/, "an item opens its receipt");
  // The Final Receipt and the PEB are distinct objects with distinct records.
  assert.match(dossier, /className="nx-object nx-object-final"/);
  assert.match(dossier, /className="nx-object nx-object-peb"/);
  assert.match(dossier, /className="nx-receipt nx-final-record"/);
  assert.match(dossier, /className="nx-receipt nx-peb-record"/);
  assert.match(dossier, /<code>\{finalReceipt\.receiptId\}<\/code>/);
  assert.match(dossier, /<code>\{portable\.bundleId\}<\/code>/);
  assert.match(dossier, /<code>\{selected\.evidenceId\}<\/code>/, "LEVEL 3 exposes the identifier");
  assert.match(dossier, /\{selected\.digest\}/);
  assert.match(dossier, /selected\.causalParents\.map/);
  // The page never reintroduces a table of the stream.
  const root = code(read("experience/NxExperience.tsx"));
  assert.doesNotMatch(root, /<table|nx-tiles|EvidenceStream|EvidenceInspector|EvidenceDrawer/);
});

test("NX1 R2/R3: LEVEL 1 shows beads and one distinct Final Receipt capsule; no identifier or timestamp on the public proof", () => {
  const proof = code(read("evidence/ProvenanceProof.tsx"));
  assert.doesNotMatch(proof, /<table|formatExperienceTime|>\{entry\.evidenceId\}|\{entry\.evidenceId\}<|\{entry\.eventId\}|\{entry\.digest\}|\{finalReceipt\.receiptId\}<|\{finalReceipt\.digest\}/, "no identifier or timestamp is printed on the public proof");
  assert.match(proof, /<button[\s\S]*?className=\{`nx-bead/);
  assert.match(proof, /data-evidence-id=\{entry\.evidenceId\}/);
  // C-R2-F01: the bead carries its bubble AND its number. It used to be the
  // bubble alone; the number is the handle a viewer needs to find a receipt
  // again, and it is the same ordinal the dossier prints in full.
  assert.match(proof, /<i aria-hidden="true" \/>/);
  assert.match(proof, /<b className="nx-bead-ordinal" aria-hidden="true">\{entry\.ordinal\.compact\}<\/b>\s*<\/button>/, "the bead says its number, from the one ordinal");
  assert.match(proof, /className=\{`nx-final-receipt/, "the Final Receipt is drawn as its own capsule");
  assert.doesNotMatch(proof, /items\.push|finalReceiptMember/, "the Final Receipt is never pushed among the beads");
  assert.match(proof, /nx-edge-compile/, "the compilation rail joins the lanes to the receipt");
  // Bubbles on threads: light, translucent, fine; the hit area is the button, the bubble keeps its size.
  const css = read("nx.css");
  assert.match(css, /\.nx-bead i \{[\s\S]*?radial-gradient\(circle at 34% 30%, rgba\(255, 255, 255, 0\.95\)/, "a bead is a light translucent bubble");
  assert.match(css, /\.nx-bead \{[\s\S]*?width: max\(var\(--bead, 8px\), var\(--hit, 20px\)\)/, "an adequate hit area around a small bead");
  assert.match(css, /\.nx-edge \{ fill: none; stroke: var\(--nx-ink-2\); stroke-width: 0\.8;/, "threads are fine filaments");
  assert.match(css, /\.nx-edge\.is-focus \{/, "the selected causal chain has its own state");
  assert.match(css, /\.nx-edge\.is-dim \{/, "unrelated evidence steps back");
});

test("NX1 B-R2: the proof reads as a story — a reading rail with chapters, one row per moment, family colour, a legend, headers kept under the fallback scroll", () => {
  const proof = code(read("evidence/ProvenanceProof.tsx"));
  const geometry = code(read("evidence/proofGeometry.ts"));
  const css = read("nx.css");
  // Reading order: time, then the engine's admission order; a row per moment; a shared moment only for parallel, unrelated evidence in different lanes.
  const order = code(read("adapter/readingOrder.ts"));
  assert.match(order, /left\.timeMs - right\.timeMs\s*\|\| left\.admissionIndex - right\.admissionIndex/, "the reading order is evidence time, then admission order");
  assert.match(geometry, /import \{ presentParents, readingOrder \} from "\.\.\/adapter\/readingOrder\.ts"/, "one reading order, shared by the public model and the geometry");
  assert.match(geometry, /entry\.timeMs === rowMoment\s*&& entry\.episode === rowEpisode\s*&& !lanesInRow\.has\(entry\.branch\)\s*&& !own\.some\(\(id\) => rowOf\.get\(id\) === row\)/, "a row is shared only by parallel evidence of one moment and one episode");
  assert.match(geometry, /while \(pitch > MIN_PITCH_PX && sealedContentFor\(pitch\) > fieldHeight\) pitch -= 1;/, "the pitch uses the room down to the floor, never below it — and follows the sealed mission alone");
  assert.match(geometry, /fit: ProofLayout\["fit"\] = contentFor\(pitch\) <= fieldHeight \? "fit" : "scroll"/, "the fallback is recorded");
  // The rail, the chapters, the legend, the rank.
  assert.match(proof, /className="nx-rail"/, "a reading rail");
  assert.match(proof, /className="nx-rail-start"/);
  assert.match(proof, /className="nx-rail-tip"/, "one light direction mark at the rail's end");
  assert.match(proof, /className="nx-chapters"[\s\S]*?copy\.episodeLabels\[chapter\.episode\]/, "chapters named by the canonical episode labels");
  assert.match(proof, /data-rank=\{placement\.rank\}/, "every bead exposes its reading rank");
  assert.match(proof, /className="nx-legend"[\s\S]*?className="nx-legend-kicker"/, "a compact legend");
  // NX3 / B2: the axis is causal depth, and it is named as such — never the reading number.
  assert.match(proof, /copy\.causalDepth/, "the axis is named");
  // NX3 / B2: the depth axis carries column numbers; a receipt's reading rank is never drawn as a picture element.
  assert.doesNotMatch(proof, />\{placement\.rank\}</, "receipts are not numbered on the picture");
  assert.doesNotMatch(proof.replace(/<text className="nx-axis-number"[^>]*>\{column\}<\/text>/g, ""), /<text/, "the only text on the drawing is the depth axis");
  // Headers and legend stay outside the scrolling field; the field scrolls inside itself under the fallback only.
  assert.match(css, /\.nx-proof \{[^}]*grid-template-rows: var\(--label-h, 22px\) minmax\(0, 1fr\) var\(--legend-h, 22px\)/);
  assert.match(css, /\.nx-branch-label span \{ min-width: 0; overflow: hidden; text-overflow: ellipsis; \}\s*\.nx-branch-label b \{ flex: none;/, "a narrow lane shortens its name, never its count");
  // The lane-label ladder never goes below the declared floor.
  const labelSizes = [...css.matchAll(/\.nx-branch-label \{[^}]*?font-size: ([\d.]+)rem/g), ...css.matchAll(/data-lane-density="[a-z]+"\] \.nx-branch-label \{ font-size: ([\d.]+)rem/g)].map((match) => Number(match[1]));
  assert.ok(labelSizes.length >= 3 && labelSizes.every((size) => size >= READABILITY_FLOORS.laneLabelRem), `lane label sizes ${labelSizes.join(", ")} rem stay at or above the ${READABILITY_FLOORS.laneLabelRem} rem floor`);
  assert.match(css, /\.nx-edge-compile \{[^}]*stroke-dasharray: 1 3;/, "the compilation gathers with dotted lines, distinct from causal threads");
  assert.doesNotMatch(css, /\.nx-compile-rail[^{]*\{[^}]*stroke-dasharray: none/, "the rail and the stem are dotted like the drops, as the legend's key shows them");
  // The selected receipt itself is identifiable inside its own chain: its rule
  // comes after the chain's, so it wins the cascade.
  assert.ok(css.indexOf(".nx-bead.is-selected i {") > css.indexOf(".nx-bead.is-focus i {"), "the selected rule is declared after the focus rule");
  // NX3: the ring wears the accent — the brand's interaction colour — the rim stays ink.
  assert.match(css, /\.nx-bead\.is-selected i \{[^}]*border-color: var\(--nx-ink\);[^}]*box-shadow: 0 0 0 2px var\(--nx-paper\), 0 0 0 3\.5px var\(--nx-accent\)/, "an ink rim and an accent ring no other bead of the chain carries");
  assert.match(proof, /const fresh = child !== undefined && child\.lock < 1;/, "a new thread's emphasis is brief: while the receipt attaches");
  // Colour stays on receipts, the legend, the dossier rows and the pulse — never on an episode or lane marker.
  assert.doesNotMatch(css, /\.nx-chapters[^{]*\{[^}]*--nx-family/, "no family colour on a chapter label");
  assert.doesNotMatch(css, /\.nx-branch-label[^{]*\{[^}]*--nx-family/, "no family colour on a lane label");
  // The proof count stays secondary in every state (§21).
  assert.doesNotMatch(css, /\.nx-evidence-control\[aria-expanded="true"\] \{[^}]*background: var\(--nx-ink\)/, "the count chip never inverts to the darkest element");
  // Under the fallback scroll the picture says where the start and the end lie (§5, §14).
  // NX3 / B2: the field scrolls horizontally, so the cues point to the start and the end.
  assert.match(proof, /className="nx-scroll-cue is-start"[\s\S]*?copy\.episodeLabels\[firstChapter\.episode\]/, "a cue toward the start names the first chapter");
  assert.match(proof, /className="nx-scroll-cue is-end"[\s\S]*?finalReceipt !== null \? copy\.finalReceipt : copy\.newEvidence/, "a cue toward the end names the Final Receipt or the newest evidence");
  assert.match(proof, /data-scroll=\{layout\.fit === "scroll" \? scrollPlace : "none"\}/);
  // The legend names the kinds of line as well as the families, from what is on the picture.
  assert.match(proof, /className="nx-legend-threads"[\s\S]*?\{hasCause && [\s\S]*?copy\.threadCause\}[\s\S]*?\{hasObserved && [\s\S]*?copy\.threadObserved\}[\s\S]*?\{gathered\.length > 0 && [\s\S]*?copy\.threadCompiled\}/);
  // The field follows the newest LANDED receipt (a receipt still in flight is not on the picture yet).
  assert.match(proof, /const newest = latest !== null && byId\.has\(latest\.evidenceId\) \? latest : items\.at\(-1\) \?\? null;/);
  assert.match(css, /\.nx-proof-field\[data-fit="scroll"\] \{ overflow-y: auto;/);
  assert.match(css, /\.nx-proof-field \{ position: relative; overflow: hidden;/);
  // Thread hierarchy: historical fine and low, crossings a hair more present, new in ink, the selected chain in ink with a direction mark, the rest receding.
  assert.match(css, /\.nx-edge \{[^}]*stroke-opacity: 0\.2;/);
  assert.match(css, /\.nx-edge\.is-cross \{ stroke-opacity: 0\.3; \}/);
  assert.match(css, /\.nx-edge\.is-new \{ stroke: var\(--nx-ink\); stroke-opacity: 0\.9; stroke-width: 1\.2; \}/);
  assert.match(css, /\.nx-edge\.is-focus \{ stroke: var\(--nx-ink\); stroke-opacity: 1; stroke-width: 1\.5; marker-end: url\(#nx-thread-tip\); \}/);
  assert.match(css, /\.nx-edge\.is-dim \{ stroke-opacity: 0\.05; \}/);
  assert.match(css, /\.nx-branch-labels li\[data-dim="true"\] \{ opacity: 0\.5; \}/, "lanes outside the selected chain step back — never below legibility");
  assert.match(proof, /data-dim=\{focusing && !lanesInFocus\.has\(branch\) \? "true" : "false"\}/);
  // The Final Receipt gathers actual causal inputs only.
  assert.match(proof, /layout\.anchors\.filter\(\(anchor\) => inputs\.has\(anchor\.evidenceId\)\)/, "no fabricated compilation input");
  assert.match(proof, /new Set\(finalReceipt\?\.causalInputEvidenceIds \?\? \[\]\)/);
  // Bubble materiality: light, translucent, the family on the rim, no gradient fill of colour, no glow.
  assert.match(css, /\.nx-bead i \{[\s\S]*?border: 1\.2px solid color-mix\(in srgb, var\(--family, var\(--nx-ink-2\)\) 78%, var\(--nx-ink\)\)/);
  assert.doesNotMatch(css.slice(css.indexOf(".nx-bead i {"), css.indexOf("@keyframes nx-bead-in")), /linear-gradient|blur\(|filter:/, "no gradient fill, no glow");
  // The world is cropped to its drawing: no empty sky reserved above it.
  const world = code(read("world/WorldStage.tsx"));
  assert.match(world, /viewBox=\{`0 \$\{STAGE_VIEW_TOP\} \$\{STAGE_WIDTH\} \$\{STAGE_HEIGHT - STAGE_VIEW_TOP\}`\}/);
  // C-R2-F05 — the world is drawn wider and flatter. The stage is height-capped
  // and `height: auto`, so its aspect ratio decides how much WIDTH it gets: at
  // 5:1 under a 122 px cap it rendered about 580 px across and the taxi's route
  // was squeezed into two thirds of that. A 7.2:1 drawing under a slightly
  // taller cap renders about 917 px across, and the props grow rather than
  // shrink because the cap rose with it.
  assert.match(css, /\.nx-stage \{ width: 100%; height: auto; max-height: min\(15vh, 134px\)/);
  assert.match(css, /\.nx:not\(\[data-workspace="compact"\]\) \.nx-stage \{ max-height: min\(12\.5vh, 112px\); \}/);
  const stageWidth = Number(/export const STAGE_WIDTH = ([\d_]+);/.exec(world)![1]!.replace(/_/g, ""));
  const stageHeight = Number(/export const STAGE_HEIGHT = ([\d_]+);/.exec(world)![1]!.replace(/_/g, ""));
  const viewTop = Number(/export const STAGE_VIEW_TOP = ([\d_]+);/.exec(world)![1]!.replace(/_/g, ""));
  assert.ok(stageWidth / (stageHeight - viewTop) > 7, `the drawing is flat enough to use the band's width: ${stageWidth}x${stageHeight - viewTop}`);
  // The route takes the width, and the same easing moves the props, so every
  // coincidence the engine states (the taxi AT the light, AT the garage) holds.
  assert.match(world, /const eased = clamped <= ROUTE_END/, "one monotone easing of the horizontal axis");
  assert.match(world, /return LEFT \+ eased \* SPAN;/, "applied to the taxi and the props alike, through stageXOf");
  assert.match(css, /\.nx \{[\s\S]*?height: 100vh;[\s\S]*?grid-template-rows: auto auto auto minmax\(260px, 1fr\) auto auto;/, "one screen: the proof row takes the room the page has, the page itself never scrolls");
});

test("NX1 R2/B-R2: horizontal = provenance, vertical = reading order, thread = declared causality, colour = family, from canonical metadata only", () => {
  const proof = code(read("evidence/ProvenanceProof.tsx"));
  const geometry = code(read("evidence/proofGeometry.ts"));
  assert.match(proof, /grid-template-columns|--columns/, "branches span the width");
  // NX3 / B2: the production geometry is the causal-depth transpose; Gate 1's
  // reading-order geometry stays as the provenance view and the Gate 2 control.
  assert.match(proof, /layoutProofB2\(\{ items, branches, finalReceipt: finalReceipt !== null, widthPx: size\.width, heightPx: size\.height \}\)/, "the geometry derives from the dataset and the measured band");
  assert.match(proof, /new ResizeObserver\(/, "the band is measured, never assumed");
  const depthGeometry = code(read("evidence/proofGeometryB2.ts"));
  assert.match(depthGeometry, /causalLevels\(closure\)/, "the horizontal position is causal depth, from the declared relations");
  // (The module names a constant for where the ordinal LABEL sits beside a
  // bead; what it must never do is read a receipt's ordinal.)
  assert.doesNotMatch(depthGeometry, /\.ordinal\b|ordinal\.(index|label|compact)|readingOrdinals/, "…and never the reading number");
  assert.match(geometry, /export function readingRows\(/, "the vertical position of the provenance view is the reading order");
  assert.match(geometry, /const yOfRow = \(row: number\) => PAD_TOP_PX \+ \(chapterIndexOfRow\.get\(row\) \?\? 0\) \* episodeGap \+ row \* pitch \+ pitch \/ 2;/, "rows at a uniform pitch, a chapter gap between episodes");
  assert.match(geometry, /\[\[entry\.causalParents, "cause"\], \[entry\.observedInputs, "observed"\]\]/, "threads follow the evidence's own declared relations");
  assert.doesNotMatch(geometry, /chain|previousInBranch/, "no structural or decorative thread");
  assert.match(geometry, /MIN_PITCH_PX|MAX_PITCH_PX|MIN_BEAD_PX|MAX_BEAD_PX|MIN_GUTTER_PX/, "readability floors");
  assert.doesNotMatch(proof, /entry\.family\b|entry\.branch === "|--bead-tint/, "colour never encodes provenance on the proof");
  assert.doesNotMatch(geometry + proof, /(?<![\d.])(58|59|62)(?![\d.])/, "no hard-coded dataset count controls rendering");
  assert.doesNotMatch(proof, /producerDomain|DOMAIN_BRANCH|SYSTEM_BRANCH|ISSUER_BRANCH/, "the component assigns no provenance itself");
  const adapter = code(read("adapter/publicExperienceAdapter.ts"));
  assert.match(adapter, /const lane = laneForProducer\(member\.producerDomain\)/, "provenance comes from the engine's lane tables, by the producer the evidence names");
  assert.match(adapter, /branch: lane \?\? "unresolved"/, "no table entry: reported as unresolved, never defaulted to mission");
  assert.doesNotMatch(adapter, /\?\? "mission"[^\n]*branch|branch[^\n]*\?\? "mission"/, "no silent mission fallback for provenance");
  assert.match(adapter, /const branches = PROVENANCE_ORDER\.filter\(\(branch\) => \(byBranch\[branch\] \?\? 0\) > 0\)/, "a column exists only once evidence fed it");
});

test("FS-R2: receipt and boundary inspection are keyboard reachable in the verifier", () => {
  const root = code(read("experience/NxExperience.tsx"));
  assert.doesNotMatch(root, /openDossier|onBead|<InspectPanel/);
  const graph = ["ReceivedCausalInspection.tsx", "InspectionWorkspace.tsx", "GuidedEventInspector.tsx"].map(file => readFileSync(new URL(`../app/verify/${file}`, import.meta.url), "utf8")).join("\n");
  assert.match(graph, /role="button" tabIndex=\{0\}/);
  assert.match(graph, /event\.key === "Enter" \|\| event\.key === " "/);
  assert.match(graph, /className="guided-event-inspector"/);
  assert.match(graph, /className="guided-boundary-inspector"/);
  assert.match(graph, /<h3 ref=\{titleRef\} tabIndex=\{-1\}>/);
  assert.doesNotMatch(graph, /onMouseEnter|onMouseOver/);
});

test("NX1: the new boundary imports the engine, never the legacy stage", () => {
  for (const file of nxFiles()) {
    const source = code(readFileSync(file, "utf8"));
    assert.doesNotMatch(source, /ConvergenceExperience|convergence\.css|CausalEditingTable|OperationalCycleTable|TransversalityReveal/, file);
    assert.doesNotMatch(source, /proof-tree-canvas|data-verifier-theme|verifier-theme-control/, file);
  }
});

test("NX1: the adapter is pure — no clock, no network, no storage, no writes, no verdict of its own", () => {
  const adapter = read("adapter/publicExperienceAdapter.ts");
  assert.doesNotMatch(adapter, /Date\.now|performance\.now|fetch\(|localStorage|Math\.random|setTimeout|setInterval/);
  assert.doesNotMatch(adapter, /appendMissionEvidence|appendNetworkTransition|appendOfflineEvidence|reconcileOfflineEvidence|performBaseCompareTransfer|projectMissionEvidence|analyzeInsertedD006Peb|verifyD006PortableMissionEvidence|applyHumanDecision/,
    "the adapter cannot advance state, author evidence, reconcile or verify");
  assert.doesNotMatch(adapter, /from "react"/);
  // C-R1 — the presentation coordinate is a second INPUT, and optional: the
  // adapter still has no clock, and with no cursor given it derives one from
  // the master time. It is a number, so it can grant nothing.
  assert.match(adapter, /export function derivePublicExperience\(snapshot: EngineSnapshot, presentationTimeMs\?: number\)/);
  assert.match(adapter, /const presentationNow = presentationTimeMs \?\? humanPresentationTime\(snapshot\.masterTimeMs\)/);
  assert.match(adapter, /deepFreeze\(/);
  assert.match(adapter, /verdict: snapshot\.verification\.verdict/, "the verdict is mirrored from the engine's result");
  assert.doesNotMatch(code(adapter), /verdict: "(VALID|INVALID|INDETERMINATE|REVOKED)"/, "no verdict literal is ever produced");
  // NANO-RECEIPTS → FINAL RECEIPT → PEB, three kinds.
  assert.match(adapter, /kind: "NANO_RECEIPT" as const/);
  assert.match(adapter, /kind: "FINAL_RECEIPT"/);
  assert.doesNotMatch(code(adapter), /members\.push\(finalReceiptMember/, "the Final Receipt is never appended to the nano-receipt list");
});

test("NX1 B: the runtime consumes the shared physical-link runtime — no second sentinel, no surrogate, no verdict, no minted transition", () => {
  const runtime = read("adapter/useMissionEngine.ts");
  const runtimeCode = code(runtime);
  // The network moves only through the shared runtime, which asks the engine's machine and appends the engine's record.
  assert.match(runtime, /admitPhysicalObservation\(\{/);
  assert.match(runtime, /readLinkSentinel\(controller\.signal, undefined, undefined, target\)/, "reports come from the loopback sentinel for the explicitly selected interface");
  assert.match(runtime, /performReconciliation\(\{/);
  assert.match(runtime, /capturePreRestorationIfPossible\(/);
  assert.doesNotMatch(runtimeCode, /appendNetworkTransition|reconcileOfflineEvidence|performBaseCompareTransfer|capturePreRestorationArtifacts|networkTransitionAdmissibility/, "no engine transition is authored outside the shared runtime");
  assert.doesNotMatch(runtimeCode, /navigator\.onLine|setNetworkState\("(LOST|CONNECTED|RESTORED)"\)|"RESTORED"\s*[,)]/, "no browser-network surrogate, no UI-minted state, no persisted RESTORED");
  assert.match(runtime, /initialState: (session|fresh)\.networkState/, "the machine starts at the journal's own baseline");
  assert.match(runtime, /setNetworkState\(outcome\.networkState\)/, "the admitted state is the outcome's, never a literal");
  assert.match(runtime, /linkPhase !== "CONNECTED" \|\| reconciliationWindowKey === null\) return/, "reconciliation needs the physical link AND a journal window");
  // The journal projection moved to `missionJournal.ts` so a SERVER component
  // can call it — `useMissionEngine.ts` is "use client", which made every one
  // of its exports a client reference. The invariant is unchanged and asserted
  // in both halves: the projection is still the engine's own, and the runtime
  // still reaches it through that one function rather than rolling a surrogate.
  const journal = read("adapter/missionJournal.ts");
  assert.match(journal, /projectMissionEvidence\(session, masterTimeMs\)/, "the same engine projection as the legacy stage");
  assert.match(journal, /sealFinalReceiptRuntimeEvidence\(/, "the append boundary is sealed at emission");
  assert.match(runtime, /import \{ journalAt \} from "\.\/missionJournal\.ts"/, "the runtime consumes the shared projection");
  assert.doesNotMatch(code(runtime), /projectMissionEvidence\(/, "the runtime projects only through journalAt — no second projection");
  assert.doesNotMatch(runtimeCode, /useEffect\(\(\) => \{\s*set[A-Z]/, "no effect writes state a render could derive");
  assert.match(runtime, /appendHumanAuthorityDenial\(/, "DENY leaves evidence here too");
  // R3: the handoff moves through the engine's transfer stages; the analysis
  // is the engine's verifier on the exact bytes; the result is stored as it came.
  // NX3: the fused pick-and-drop callback is gone (ADV-10); the `?handoff=done`
  // deep link applies both stage steps as the initial state, through the same
  // engine rule, and a person otherwise picks, then drops.
  assert.match(runtime, /nextTransferStage\(nextTransferStage\("SOURCE", "GATHER"\), "SEND"\)/);
  assert.doesNotMatch(runtimeCode, /const handoff = useCallback/);
  assert.match(runtime, /insertD006PebForAnalysis\(\{\s*pebText: handoffArtifact\.pebText/);
  assert.match(runtime, /analyzeInsertedD006Peb\(inserted\)\.then/);
  assert.match(runtime, /verdictSnapshot\.transferredContentDigest !== handoffArtifact\.transferredContentDigest/, "a result is reported only for the bytes it names");
  assert.doesNotMatch(code(runtime), /verdict: "(VALID|INVALID|INDETERMINATE|REVOKED)"/, "the runtime computes no verdict");
  // A headless capture found a hydration mismatch: the run id was minted with
  // Date.now() during render. The server and the first client render must
  // agree, so the run is named after mount.
  assert.match(runtime, /useState<OfflineEvidenceSession>\(\(\) => journalAt\(createOfflineEvidenceSession\(UNRESOLVED_RUN_ID/);
  assert.doesNotMatch(code(runtime), /useState\([^)]*newMissionRunId|useState\([^)]*Date\.now/);
  assert.match(code(runtime), /queueMicrotask\(\(\) => \{[\s\S]*?setLiveSession\(\(current\) => current\.runId === UNRESOLVED_RUN_ID/, "the run is named after mount, off the hydration pass");
});

test("NX1: evidence materialises with the C3-R1 grammar and no future geometry", () => {
  const proof = code(read("evidence/ProvenanceProof.tsx"));
  assert.match(proof, /"--nr-appear": entry\.nrAppear/);
  assert.match(proof, /"--lock": entry\.lock/);
  assert.match(proof, /opacity: child === undefined \? 1 : Math\.max\(0\.001, child\.attach\)/, "a thread appears only as the child bead attaches");
  assert.match(proof, /opacity: finalReceipt\.attach/, "the compilation thread appears only as the receipt attaches");
  assert.doesNotMatch(proof, /<progress|toFixed\(0\)\}%|percent|complete\b/i, "no completion percentage");
  const adapter = read("adapter/publicExperienceAdapter.ts");
  assert.match(adapter, /leafCausalPhases\(growth\)/, "the same phase model as the Proof Tree");
  assert.match(adapter, /if \(member\.timeMs > snapshot\.masterTimeMs\) continue;/, "the clock filters evidence; it never creates it");
  assert.match(adapter, /if \(leaf\.timeMs > snapshot\.masterTimeMs && snapshot\.masterTimeMs < EXPERIENCE_DURATION_MS\) continue;/, "journal records after the seal are filtered by the same clock; only the end of the experience shows what came after its last instant");
  assert.match(adapter, /runtimeProofLeaves\(snapshot\.session\.records\)/, "post-seal records come from the engine's own runtime projection");
});

test("NX1: light only — no dark branch, no dark slab for the PEB, reduced motion honoured", () => {
  const css = read("nx.css");
  assert.doesNotMatch(css, /prefers-color-scheme\s*:\s*dark|\[data-theme|color-scheme:\s*dark|linear-gradient\([^)]*#[01]/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /--nx-porcelain: #f6f3ec/);
  assert.match(css, /\.nx \.nx-primary \{ color: var\(--nx-paper\); \}/, "the primary control is legible (black-on-black regression)");
  // The PEB object and record: paper and a rule, no gradient, no glow, no shield.
  const peb = css.slice(css.indexOf(".nx-object-peb"), css.indexOf(".nx-dossier-filter"));
  assert.doesNotMatch(peb, /gradient|shadow|glow|#0|#1|#2/, "no dark slab, no gloss, no glow on the PEB");
  assert.doesNotMatch(css, /shield/i);
  const root = read("experience/NxExperience.tsx");
  assert.match(root, /aria-pressed=\{locale === "en"\}[\s\S]*?>EN<\/button>/);
  assert.match(root, /aria-pressed=\{locale === "fr"\}[\s\S]*?>FR<\/button>/);
  assert.doesNotMatch(root, /dark/i);
});

test("NX1: public copy is short, natural and paired in both languages", () => {
  for (const [name, dictionary] of [["EN", en], ["FR", fr]] as const) {
    const nx = dictionary.nx;
    for (const value of [nx.start, nx.pause, nx.resume, nx.restart, nx.ready, nx.newEvidence, nx.evidenceControl, nx.dossier.title, nx.verifier.title, nx.reconciliation.title]) {
      assert.ok(value.trim().length > 0 && value.length <= 32, `${name}: "${value}" is not short public copy`);
    }
    assert.match(nx.evidenceMany, /\{count\}/);
    assert.match(nx.evidenceControl, /\{count\}/);
    assert.match(nx.dossier.episodeCountMany, /\{count\}/);
    // LEVEL 1 copy carries no protocol jargon; the inspection surfaces may name the objects.
    const level1 = { ...nx, detail: undefined, dossier: undefined, verifier: undefined, reconciliation: undefined, workspace: undefined };
    assert.doesNotMatch(JSON.stringify(level1), /PEB|nano-receipt|Proof Tree|trust domain|blake3|quarantin/i, `${name}: no protocol jargon in public copy`);
    assert.doesNotMatch(JSON.stringify(nx), /quarantain|quarantin/i, `${name}: no quarantine wording anywhere`);
  }
  assert.notEqual(en.nx.start, fr.nx.start);
  assert.notEqual(en.nx.episodes.signalStop, fr.nx.episodes.signalStop);
  assert.deepEqual(Object.keys(en.nx).sort(), Object.keys(fr.nx).sort());
  assert.deepEqual(Object.keys(en.nx.provenance).sort(), Object.keys(fr.nx.provenance).sort());
  assert.deepEqual(Object.keys(en.nx.episodes).sort(), Object.keys(fr.nx.episodes).sort());
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ModuleKind, ScriptTarget, JsxEmit, transpileModule } from "typescript";
import { inspectReceivedPeb } from "../app/verify/inspectReceivedPeb.ts";
import { groupInspectionBoundaries } from "../app/verify/inspectionPresentation.ts";
import { projectReceivedGraph } from "../app/verify/receivedGraph.ts";
import { DEFAULT_VERIFIER_UI } from "../app/verify/verifierPresentation.ts";

function loadView(file: string): Record<string, ComponentType<Record<string, unknown>>> {
  const url = new URL(`../app/verify/${file}`, import.meta.url);
  const filename = fileURLToPath(url);
  const compiled = transpileModule(readFileSync(url, "utf8"), {
    compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.CommonJS, jsx: JsxEmit.ReactJSX, esModuleInterop: true },
    fileName: filename,
  }).outputText;
  const viewModule = { exports: {} };
  const nativeRequire = createRequire(url);
  const requireDependency = (specifier: string) => specifier.endsWith(".css") ? {} : specifier.endsWith(".tsx") ? loadView(specifier) : nativeRequire(specifier);
  new Function("exports", "require", "module", "__filename", "__dirname", compiled)(viewModule.exports, requireDependency, viewModule, filename, dirname(filename));
  return viewModule.exports as Record<string, ComponentType<Record<string, unknown>>>;
}

const { GuidedBoundaryInspector, GuidedBoundaryGroupInspector } = loadView("GuidedEventInspector.tsx");
const noop = () => {};
const visibleText = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");

function fixture({ missingDomain = false, missingAuthority = false, technicalDomains = false } = {}) {
  const members = [
    { evidenceId: "before", receiptId: "nr.before", eventId: "d005.dropoff-confirmed", timeMs: 1, producerDomain: technicalDomains ? "fortix.internal.passenger.domain" : "Passenger service", causalParents: [] as string[], observedInputs: [] as string[] },
    { evidenceId: "after", receiptId: "nr.after", eventId: "d005.maintenance-intent", timeMs: 2, producerDomain: missingDomain ? null : technicalDomains ? "fortix.internal.fleet.domain" : "Fleet operations", causalParents: ["before"], observedInputs: ["before"] },
    { evidenceId: "before-two", receiptId: "nr.before-two", eventId: "d005.journey-executed", timeMs: 3, producerDomain: technicalDomains ? "fortix.internal.passenger.domain" : "Passenger service", causalParents: [] as string[], observedInputs: [] as string[] },
    { evidenceId: "after-two", receiptId: "nr.after-two", eventId: "d005.maintenance-authorized", timeMs: 4, producerDomain: technicalDomains ? "fortix.internal.fleet.domain" : "Fleet operations", causalParents: ["before-two"], observedInputs: [] as string[] },
  ];
  const text = JSON.stringify({
    profile: "fortix.demo.d006.peb.v1", bundleId: "boundary-cleanup-fixture",
    manifest: { memberRefs: members.map((member) => ({ ...member, presentation: "PRESENTED", source: "SIGNED_CANONICAL" })) },
    sourceBundle: { canonical_evidence_objects: members.map((member, index) => ({
      evidence_id: member.evidenceId,
      evidence_payload: { execution: { label: `Received fact ${index + 1}`, ...(missingAuthority ? {} : { authority_context: index % 2 ? "maintenance" : "passenger-mission" }) } },
    })) },
  });
  const peb = inspectReceivedPeb(text);
  const graph = projectReceivedGraph(peb, text);
  const edge = graph.edges.find((candidate) => candidate.from === "member:0" && candidate.to === "member:1");
  assert.ok(edge);
  const boundary = groupInspectionBoundaries(graph).find((candidate) => candidate.kind === "producer" && candidate.edgeKeys.includes(edge.key));
  return { graph, text, edge, boundary };
}

function single(options: ReturnType<typeof fixture>, props: Record<string, unknown> = {}) {
  return renderToStaticMarkup(createElement(GuidedBoundaryInspector, { ...options, locale: "fr", onSelectNode: noop, onOpenEvidence: noop, onOpenForensic: noop, onClose: noop, embedded: true, ...props }));
}

test("the embedded first level presents domains and every fact before qualification", () => {
  const html = single(fixture());
  const firstLevel = html.slice(0, html.indexOf("<details"));
  const reading = visibleText(firstLevel);
  assert.match(reading, /Domaine source.*Service passagers.*Changement de domaine déclaré.*Domaine destination.*Exploitation de la flotte/);
  assert.match(reading, /Avant.*Dépose du passager confirmée.*Après.*Mission de maintenance demandée/);
  assert.match(reading, /Autorité de mission passager.*Autorité de maintenance/);
  assert.doesNotMatch(firstLevel, /<aside|<header|← Retour|Fermer|<details/);
  assert.doesNotMatch(reading, /Le lien relie|Parent causal|manifest|member:|nr\.before|nr\.after/);
  assert.equal((reading.match(/Service passagers/g) ?? []).length, 1);
  assert.equal((reading.match(/Exploitation de la flotte/g) ?? []).length, 1);
  assert.match(html, /<details class="boundary-causality"[^>]*><summary>Causalité<\/summary>/);
  assert.match(html, /<details class="boundary-proofs"[^>]*><summary>Preuves<\/summary>/);
});

test("mixed relations keep the exact causal and observed declaration natures", () => {
  const { graph, edge, text } = fixture();
  assert.equal(edge.declarations.length, 2);
  const html = single({ graph, edge, text, boundary: undefined });
  assert.match(html, /data-boundary-declaration-count="2"/);
  assert.match(html, /data-boundary-declaration-kind="CAUSAL_PARENT"/);
  assert.match(html, /data-boundary-declaration-kind="OBSERVED_INPUT"/);
  assert.match(visibleText(html), /Une entrée observée ne devient pas un parent causal/);
  assert.match(visibleText(html), /Limite de ce passage.*n’établit pas.*physiquement.*transfert d’autorité effectif/);
  assert.doesNotMatch(visibleText(html), /Ce que les preuves établissent|Ce qui reste non établi/, "the Verdict owns the package-wide blocks");
});

test("a grouped boundary keeps all Before and After pairs above every disclosure", () => {
  const { graph, text, boundary } = fixture();
  assert.ok(boundary);
  assert.equal(boundary.edgeKeys.length, 2);
  const html = renderToStaticMarkup(createElement(GuidedBoundaryGroupInspector, { graph, text, boundary, locale: "fr", onSelectEdge: noop, onSelectNode: noop, onOpenEvidence: noop, onOpenForensic: noop, onClose: noop, embedded: true }));
  const firstLevel = html.slice(0, html.indexOf("<details"));
  assert.equal((firstLevel.match(/class="boundary-crossing-reading"/g) ?? []).length, 2);
  for (const edgeKey of boundary.edgeKeys) assert.ok(firstLevel.includes(`data-boundary-edge-key="${edgeKey.replace(/>/g, "&gt;")}"`));
  const reading = visibleText(firstLevel);
  for (const label of ["Dépose du passager confirmée", "Mission de maintenance demandée", "Trajet du passager effectué", "Maintenance autorisée"]) assert.ok(reading.includes(label));
  assert.equal((reading.match(/Service passagers/g) ?? []).length, 1);
  assert.equal((reading.match(/Exploitation de la flotte/g) ?? []).length, 1);
  assert.equal((html.match(/Voir les preuves/g) ?? []).length, 4);
  assert.equal((html.match(/class="boundary-forensic-action"/g) ?? []).length, 4);
});

test("received presentation keys restore the chosen disclosure without changing graph state", () => {
  const options = fixture();
  const uiState = { ...DEFAULT_VERIFIER_UI, graphScale: 130, graphScroll: { x: 240, y: 120 }, expandedPanels: [`boundary:${options.edge.key}:proofs`, "graph:boundaries"] };
  const before = JSON.stringify(uiState);
  const html = single(options, { uiState, onUIStateChange: noop });
  assert.match(html, /<details class="boundary-proofs" open=""/);
  assert.doesNotMatch(html, /<details class="boundary-causality" open=/);
  assert.equal(JSON.stringify(uiState), before);
});

test("the root relation explanation slot belongs below the human summary in Causality", () => {
  const html = single(fixture(), { relationExplanation: createElement("section", { "data-exact-relation-slot": true }, "Exact received relation") });
  const disclosure = html.indexOf("<details class=\"boundary-causality\"");
  const slot = html.indexOf("data-exact-relation-slot");
  assert.ok(slot > disclosure);
  assert.ok(slot < html.indexOf("</details>", disclosure));
  assert.ok(html.indexOf("Dépose du passager confirmée") < disclosure);
});

test("absent domains and authority stay explicit without inferring a change", () => {
  const html = single(fixture({ missingDomain: true, missingAuthority: true }));
  const reading = visibleText(html.slice(0, html.indexOf("<details")));
  assert.match(reading, /Domaine destination.*Domaine non déclaré/);
  assert.match(reading, /Changement de domaine non établi/);
  assert.match(reading, /aucun changement de domaine n’est déduit/);
  assert.match(reading, /Autorité non déclarée/);
  assert.doesNotMatch(reading, /Changement de domaine déclaré|Autorité de maintenance|Autorité de mission passager/);
});

test("technical domain identifiers stay out of the human level while identity stays received", () => {
  const options = fixture({ technicalDomains: true });
  const before = JSON.stringify(options.graph);
  const html = single(options);
  const reading = visibleText(html);
  assert.doesNotMatch(reading, /fortix\.internal\.|member:\d|manifest\.memberRefs|authority_context/);
  assert.match(reading, /Domaine déclaré · détail en Forensic/);
  assert.match(reading, /Changement de domaine déclaré/);
  assert.equal(JSON.stringify(options.graph), before);
});

test("standalone boundary views retain their own return control", () => {
  const html = single(fixture(), { embedded: false });
  assert.match(html, /<aside id="guided-evidence-inspector" class="guided-boundary-inspector"/);
  assert.equal((html.match(/← Retour/g) ?? []).length, 1);
  assert.match(html, /Passage entre domaines/);
});

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

// Render the real React surfaces. Node strips .ts but cannot load JSX, so only
// the two view modules are compiled in memory; received-data helpers stay real.
function loadView(file: string): Record<string, ComponentType<Record<string, unknown>>> {
  const url = new URL(`../app/verify/${file}`, import.meta.url);
  const filename = fileURLToPath(url);
  const compiled = transpileModule(readFileSync(url, "utf8"), {
    compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.CommonJS, jsx: JsxEmit.ReactJSX, esModuleInterop: true },
    fileName: filename,
  }).outputText;
  const viewModule = { exports: {} };
  const nativeRequire = createRequire(url);
  const requireViewDependency = (specifier: string) => specifier.endsWith(".css") ? {} : specifier.endsWith(".tsx") ? loadView(specifier) : nativeRequire(specifier);
  new Function("exports", "require", "module", "__filename", "__dirname", compiled)(viewModule.exports, requireViewDependency, viewModule, filename, dirname(filename));
  return viewModule.exports as Record<string, ComponentType<Record<string, unknown>>>;
}

const { GuidedBoundaryInspector, GuidedBoundaryGroupInspector } = loadView("GuidedEventInspector.tsx");
const { ReceivedDomainsOverview } = loadView("ReceivedDomainsOverview.tsx");
const noop = () => {};
const visibleText = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");

function fixture({ duplicateSource = false, missingAuthority = false, includeDossier = false } = {}) {
  const members = [
    { evidenceId: "before", receiptId: "nr.before", eventId: "d005.garage-route-calculated", timeMs: 1, producerDomain: "Navigation Provider B", causalParents: [] as string[] },
    { evidenceId: "after", receiptId: "nr.after", eventId: "d005.garage-arrival", timeMs: 2, producerDomain: "Garage", causalParents: ["before"] },
    { evidenceId: "before-two", receiptId: "nr.before-two", eventId: "d005.maintenance-requested", timeMs: 3, producerDomain: "Navigation Provider B", causalParents: [] as string[] },
    { evidenceId: "after-two", receiptId: "nr.after-two", eventId: "d005.garage-reception", timeMs: 4, producerDomain: "Garage", causalParents: ["before-two"] },
  ];
  if (includeDossier) {
    members.push({ evidenceId: "dossier", receiptId: "nr.dossier", eventId: "d005.receipt.maintenance", timeMs: 5, producerDomain: "Technical compiler", causalParents: ["after"] });
    members[3].causalParents.push("dossier");
  }
  const records = members.map((member, index) => ({
    evidence_id: member.evidenceId,
    evidence_payload: { execution: { label: `Received fact ${index + 1}`, ...(missingAuthority ? {} : { authority_context: index % 2 ? "maintenance" : "navigation" }) } },
  }));
  if (duplicateSource) records.push(records[0]);
  const text = JSON.stringify({
    profile: "fortix.demo.d006.peb.v1",
    bundleId: "boundary-guidance-fixture",
    manifest: { memberRefs: members.map((member) => ({ ...member, presentation: "PRESENTED", source: "SIGNED_CANONICAL", observedInputs: [] })) },
    sourceBundle: { canonical_evidence_objects: records },
  });
  const peb = inspectReceivedPeb(text);
  const graph = projectReceivedGraph(peb, text);
  const boundary = groupInspectionBoundaries(graph).find((candidate) => candidate.kind === "producer" && candidate.from === "Navigation Provider B" && candidate.to === "Garage");
  assert.ok(boundary);
  return { graph, text, boundary };
}

test("a boundary opens source, destination, Before, After, authority and proof together", () => {
  const { graph, text, boundary } = fixture();
  const edge = graph.edges.find((candidate) => candidate.key === boundary.edgeKeys[0]);
  assert.ok(edge);
  const html = renderToStaticMarkup(createElement(GuidedBoundaryInspector, { graph, text, edge, locale: "fr", onSelectNode: noop, onOpenEvidence: noop, onClose: noop }));
  const reading = visibleText(html);
  assert.match(reading, /Domaine source.*Navigation B.*Domaine destination.*Garage/);
  assert.match(reading, /Avant/);
  assert.match(reading, /Après/);
  assert.match(reading, /Autorité de navigation/);
  assert.match(reading, /Autorité de maintenance/);
  assert.match(reading, /Événement déclencheur.*n’établit pas/);
  assert.match(reading, /Preuve avant/);
  assert.match(reading, /Preuve après/);
  assert.equal((html.match(/Voir les preuves/g) ?? []).length, 2);
  assert.doesNotMatch(reading, /member:\d|authority_context|fortix\.demo\.authority/);
});

test("a multi-relation boundary shows every exact pair on its first render", () => {
  const { graph, text, boundary } = fixture();
  const html = renderToStaticMarkup(createElement(GuidedBoundaryGroupInspector, { graph, text, boundary, locale: "fr", onSelectEdge: noop, onSelectNode: noop, onOpenEvidence: noop, onClose: noop }));
  const reading = visibleText(html);
  assert.equal(boundary.edgeKeys.length, 2);
  assert.equal((html.match(/class="boundary-crossing-reading"/g) ?? []).length, 2);
  for (const edgeKey of boundary.edgeKeys) assert.ok(html.includes(`data-boundary-edge-key="${edgeKey.replace(/>/g, "&gt;")}"`));
  assert.match(reading, /Domaine source.*Navigation B.*Domaine destination.*Garage/);
  assert.match(reading, /2 liens reçus/);
  assert.equal((html.match(/Preuve avant/g) ?? []).length, 2);
  assert.equal((html.match(/Preuve après/g) ?? []).length, 2);
  assert.doesNotMatch(reading, /Choisissez un lien avant|Choisir un franchissement exact/);
});

test("missing and ambiguous authority objects never acquire a fallback authority", () => {
  for (const options of [{ missingAuthority: true }, { duplicateSource: true }]) {
    const { graph, text, boundary } = fixture(options);
    const edge = graph.edges.find((candidate) => candidate.key === boundary.edgeKeys[0]);
    assert.ok(edge);
    const html = renderToStaticMarkup(createElement(GuidedBoundaryInspector, { graph, text, edge, locale: "fr", onSelectNode: noop, onClose: noop }));
    assert.match(visibleText(html), /Autorité non déclarée/);
    if (options.duplicateSource) assert.doesNotMatch(visibleText(html), /Autorité de navigation/);
  }
});

test("ordinary Domains excludes dossier cards and relations to dossiers without altering the graph", () => {
  const { graph } = fixture({ includeDossier: true });
  const before = JSON.stringify(graph);
  const html = renderToStaticMarkup(createElement(ReceivedDomainsOverview, { graph, locale: "fr", onReceipt: noop, onCrossing: noop, onDomain: noop }));
  assert.equal((html.match(/class="domain-card"/g) ?? []).length, 2);
  assert.doesNotMatch(visibleText(html), /Technical compiler|Dossier de preuves de maintenance/);
  assert.match(visibleText(html), /Ouvrir ce passage et ses preuves/);
  assert.doesNotMatch(visibleText(html), /Inspecter ce passage|Inspecter l’événement/);
  assert.equal(JSON.stringify(graph), before);
});

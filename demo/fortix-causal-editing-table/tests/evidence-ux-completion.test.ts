import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ModuleKind, ScriptTarget, JsxEmit, transpileModule } from "typescript";
import { inspectReceivedPeb } from "../app/verify/inspectReceivedPeb.ts";
import { projectReceivedGraph } from "../app/verify/receivedGraph.ts";
import { createReceivedEvidenceCatalog } from "../app/verify/receivedEvidenceCatalog.ts";
import { DEFAULT_VERIFIER_UI } from "../app/verify/verifierPresentation.ts";

// Exercise actual view markup and received-data helpers. Compile JSX in memory;
// CSS is presentation-only, and all .ts evidence logic stays native and real.
const views = new Map<string, Record<string, ComponentType<Record<string, unknown>>>>();
function loadView(filename: string): Record<string, ComponentType<Record<string, unknown>>> {
  const path = resolve(filename);
  const cached = views.get(path);
  if (cached) return cached;
  const nativeRequire = createRequire(path);
  const viewModule = { exports: {} as Record<string, ComponentType<Record<string, unknown>>> };
  views.set(path, viewModule.exports);
  const code = transpileModule(readFileSync(path, "utf8"), { compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.CommonJS, jsx: JsxEmit.ReactJSX, esModuleInterop: true }, fileName: path }).outputText;
  const requireDependency = (specifier: string) => {
    if (specifier.endsWith(".css")) return {};
    const target = specifier.startsWith(".") ? resolve(dirname(path), specifier) : specifier;
    if (specifier.endsWith(".tsx")) return loadView(target);
    if (specifier.startsWith(".") && existsSync(`${target}.tsx`)) return loadView(`${target}.tsx`);
    if (specifier.startsWith(".") && existsSync(`${target}.ts`)) return nativeRequire(`${target}.ts`);
    return nativeRequire(specifier);
  };
  new Function("exports", "require", "module", "__filename", "__dirname", code)(viewModule.exports, requireDependency, viewModule, path, dirname(path));
  return viewModule.exports;
}
const component = (file: string, name: string) => loadView(fileURLToPath(new URL(`../app/verify/${file}`, import.meta.url)))[name];
const NanoReceiptsView = component("NanoReceiptsView.tsx", "NanoReceiptsView");
const ReceivedDomainsOverview = component("ReceivedDomainsOverview.tsx", "ReceivedDomainsOverview");
const EvidenceTimeline = component("EvidenceTimeline.tsx", "EvidenceTimeline");
const ForensicView = component("ForensicView.tsx", "ForensicView");
const reference = readFileSync(new URL("../../../artifacts/d006-network-continuity-20261002/peb-after-network-cycle.json", import.meta.url), "utf8");
const peb = inspectReceivedPeb(reference);
const graph = projectReceivedGraph(peb, reference);
const catalog = createReceivedEvidenceCatalog(graph, "fr", reference);
const garage = catalog.entries.find(entry => entry.eventId === "d005.garage-arrival")!;
const noop = () => {};
const linksForEntry = (entry: typeof garage) => ({ event: `/events/${entry.nodeKey}`, nanoreceipts: `/nanoreceipts/${entry.nodeKey}`, graph: `/graph/${entry.nodeKey}`, forensic: `/forensic/${entry.nodeKey}` });
const render = (view: ComponentType<Record<string, unknown>>, props: Record<string, unknown>) => renderToStaticMarkup(createElement(view, { graph, locale: "fr", text: reference, links: {}, selection: {}, ...props }));
const visible = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");

test("NR inventory labels evidence kinds, shows only present families and preserves all received objects", () => {
  const html = render(NanoReceiptsView, { linksForEntry });
  assert.match(visible(html), /60 NanoReceipts/);
  assert.match(visible(html), /10 preuves de support/);
  assert.match(visible(html), /1 reçu final/);
  assert.equal((html.match(/data-family=/g) ?? []).length, 71);
  assert.match(visible(html), /Réseau — 2 NanoReceipts/);
  const dossiers = catalog.entries.filter(entry => entry.family === "compilation");
  assert.equal(dossiers.length, 2);
  for (const entry of dossiers) {
    assert.ok(!html.includes(`href="/events/${entry.nodeKey}"`), "Compilation cannot offer an Event Story link");
    assert.ok(html.includes(`href="/forensic/${entry.nodeKey}"`));
  }
  assert.equal(graph.nodes.length, 71);
});

test("controlled human network search returns two scripted transitions with human types and provenance", () => {
  const html = render(NanoReceiptsView, { query: "réseau", onQueryChange: noop, linksForEntry });
  assert.equal((html.match(/data-family="network"/g) ?? []).length, 2);
  assert.match(html, /value="réseau"/);
  assert.match(visible(html), /Transition de perte réseau/);
  assert.match(visible(html), /Transition de retour réseau/);
  assert.equal((html.match(/data-provenance-basis="AUDITED_SCRIPT"/g) ?? []).length, 2);
  assert.ok(!/\bManifest\b|\bmemberRef\b|\breceiptId\b|\bM\d{2,}\b/.test(visible(html)));
});

test("direct causal neighbours are actual links; unavailable parents and unresolved filters are explicit", () => {
  const html = render(NanoReceiptsView, { query: "garage", linksForEntry });
  assert.match(html, /href="\/nanoreceipts\/[^"]+"/);
  assert.match(visible(html), /Parents causaux directs/);
  const unresolved = render(NanoReceiptsView, { selection: { eventId: "unknown-event" }, query: "never-existing-fact" });
  assert.match(visible(unresolved), /Aucune autre preuve n’est sélectionnée/);
  assert.match(visible(unresolved), /Aucune preuve dans ce filtre/);
});

test("NR list announces its chronological order and marks the selected receipt unmistakably", () => {
  const plain = render(NanoReceiptsView, { linksForEntry });
  assert.ok(plain.indexOf("data-receipt-order") < plain.indexOf('class="modular-receipt-list"'), "order hint sits above the list");
  assert.match(visible(plain), /NanoReceipts · ordre chronologique → Du premier fait enregistré au dernier/);
  assert.doesNotMatch(visible(plain), /placé en tête/);
  assert.doesNotMatch(plain, /data-selected-marker|aria-current/);
  const selected = render(NanoReceiptsView, { selection: { eventId: garage.eventId }, linksForEntry });
  assert.match(visible(selected), /le NanoReceipt sélectionné est placé en tête/);
  assert.equal(selected.match(/data-selected-marker/g)?.length, 1);
  assert.equal(selected.match(/aria-current="true"/g)?.length, 1);
  const item = selected.slice(selected.indexOf('aria-current="true"'), selected.indexOf('data-selected="false"'));
  assert.match(visible(item), new RegExp(`Sélectionné .*${garage.eventLabel}`));
  // Chronology itself is untouched: the remaining receipts keep catalog order.
  const order = [...selected.matchAll(/data-selected="false"[^>]*>[\s\S]*?<h2>([^<]+)<\/h2>/g)].map(match => match[1]);
  assert.deepEqual(order, catalog.entries.filter(entry => entry.nodeKey !== garage.nodeKey).map(entry => entry.eventLabel));
});

test("selected evidence stays first outside a restored query and empty families are not advertised", () => {
  const html = render(NanoReceiptsView, { selection: { eventId: garage.eventId }, query: "réseau", onQueryChange: noop });
  assert.match(visible(html), /2 unités de preuve correspondent au filtre/);
  assert.match(visible(html), /Elle ne correspond pas au filtre actuel/);
  const first = html.indexOf('data-selected="true"');
  assert.ok(first > 0 && first < html.indexOf('data-selected="false"'));
  const partial = render(NanoReceiptsView, { graph: { ...graph, nodes: [garage.node], edges: [] } });
  assert.match(visible(partial), /1 catégorie présente dans le PEB/);
  assert.ok(!partial.includes('aria-pressed="false">Réseau'));
  const altered = { ...graph, nodes: graph.nodes.map(node => node.key === garage.nodeKey ? { ...node, member: { ...node.member!, receiptId: null } } : node) };
  const unresolved = render(NanoReceiptsView, { graph: altered });
  assert.match(visible(unresolved), /1 preuve reçue a une identité absente ou ambiguë/);
});

test("timeline detects network event types from exact raw records and marks the audit scenario as scripted", () => {
  const html = render(EvidenceTimeline, { selection: { kind: "event", nodeKey: garage.nodeKey }, onSelectionChange: noop });
  assert.match(visible(html), /1 événement de perte et 1 événement de retour/);
  assert.match(visible(html), /scénario scripté/);
  assert.equal((html.match(/data-timeline-node-key=/g) ?? []).length, 59);
  assert.equal((html.match(/data-provenance=/g) ?? []).length, 59);
  const altered = JSON.parse(reference);
  altered.runtimeRecords[23].eventType = "CUSTOM_EVENT";
  altered.runtimeRecords[24].eventType = "CUSTOM_EVENT";
  const text = JSON.stringify(altered);
  const changedGraph = projectReceivedGraph(inspectReceivedPeb(text), text);
  const decoy = render(EvidenceTimeline, { graph: changedGraph, text, onSelectionChange: noop });
  assert.ok(!decoy.includes("evidence-network-scope"), "NR prefix and event label must not determine network provenance or type");
});

test("domain panels restore exact keys and empty domains/crossings never render a silent blank", () => {
  const key = "domains:facts:Garage";
  const html = render(ReceivedDomainsOverview, { uiState: { ...DEFAULT_VERIFIER_UI, expandedPanels: [key, "domains:crossings"] }, onReceipt: noop, onCrossing: noop });
  assert.match(html, /<details open="" data-panel-key="domains:facts:Garage"/);
  assert.match(visible(html), /paires de domaines/);
  const empty = render(ReceivedDomainsOverview, { graph: { ...graph, nodes: [], edges: [] }, onReceipt: noop, onCrossing: noop });
  assert.match(visible(empty), /Aucun domaine producteur/);
  assert.match(visible(empty), /Aucun lien reçu ne déclare de passage/);
});

test("Forensic disclosures restore their stable state and explain missing raw evidence", () => {
  const html = render(ForensicView, { peb, selection: { eventId: garage.eventId }, uiState: { ...DEFAULT_VERIFIER_UI, expandedPanels: ["forensic:package-bytes", `forensic:source:${garage.nodeKey}`] } });
  assert.match(html, /<details open="" data-panel-key="forensic:package-bytes"/);
  assert.ok(html.includes(`open="" data-panel-key="forensic:source:${garage.nodeKey}"`));
  assert.ok(!html.includes('open="" data-panel-key="forensic:inventory"'));
  const missing = render(ForensicView, { peb, selection: { eventId: garage.eventId }, text: "{}" });
  assert.match(visible(missing), /L’objet source brut est absent/);
  assert.match(visible(missing), /Aucun champ structuré/);
  assert.match(visible(missing), /Aucune entrée memberRef/);
});

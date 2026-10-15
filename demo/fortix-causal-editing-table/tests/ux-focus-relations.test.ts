import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { inspectReceivedPeb } from "../app/verify/inspectReceivedPeb.ts";
import { projectReceivedGraph } from "../app/verify/receivedGraph.ts";
import { createReceivedEvidenceCatalog } from "../app/verify/receivedEvidenceCatalog.ts";
import { inspectionDirectCausalEmphasis } from "../app/verify/inspectionPresentation.ts";
import { DEFAULT_VERIFIER_UI } from "../app/verify/verifierPresentation.ts";

const componentLoader = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && context.parentURL && !/\.[a-z]+$/i.test(specifier)) {
      for (const extension of [".tsx", ".ts"]) {
        const url = new URL(`${specifier}${extension}`, context.parentURL);
        if (existsSync(url)) return nextResolve(url.href, context);
      }
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith(".css")) return { format: "module", source: "export {};", shortCircuit: true };
    if (url.endsWith(".tsx")) return {
      format: "module", shortCircuit: true,
      source: ts.transpileModule(readFileSync(new URL(url), "utf8"), {
        compilerOptions: { module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
        fileName: new URL(url).pathname,
      }).outputText,
    };
    return nextLoad(url, context);
  },
});
const { GuidedStoryView } = await import("../app/verify/GuidedStoryView.tsx");
const { EventDetailView } = await import("../app/verify/EventDetailView.tsx");
const { InspectionWorkspace } = await import("../app/verify/InspectionWorkspace.tsx");
const { ReceivedRelationExplanation } = await import("../app/verify/ReceivedRelationExplanation.tsx");
const { ReceivedCausalInspection } = await import("../app/verify/ReceivedCausalInspection.tsx");
componentLoader.deregister();

function fixture() {
  const members = [
    { evidenceId: "a", receiptId: "nr.a", eventId: "d005.passenger-request", timeMs: 0, causalParents: [], observedInputs: [] },
    { evidenceId: "b", receiptId: "nr.b", eventId: "d005.mission-accepted", timeMs: 1, causalParents: ["a"], observedInputs: ["a"] },
    { evidenceId: "c", receiptId: "nr.c", eventId: "d005.dropoff-confirmed", timeMs: 2, causalParents: ["b"], observedInputs: [] },
    { evidenceId: "d", receiptId: "nr.d", eventId: "d005m.payment-notification-published", timeMs: 3, causalParents: ["c"], observedInputs: [] },
    { evidenceId: "observed", receiptId: "nr.observed", eventId: "d005.traffic-information-published", timeMs: 4, causalParents: [], observedInputs: [] },
    { evidenceId: "dossier", receiptId: "nr.dossier", eventId: "d005m.receipt.master-payment", timeMs: 5, causalParents: ["b"], observedInputs: [] },
    { evidenceId: "support", receiptId: "nr.support", eventId: "d005.demo-trusted-time", timeMs: 6, causalParents: [], observedInputs: [] },
  ];
  members[1].observedInputs.push("observed");
  const text = JSON.stringify({ profile: "fortix.demo.d006.peb.v1", bundleId: "focus-relations", manifest: {
    memberRefs: members.map((member) => ({ ...member, source: "RUNTIME_JOURNAL", producerDomain: "Taxi autonomy", presentation: member.evidenceId === "support" ? "ASSURANCE_SUPPORT" : "PRESENTED" })),
  }, runtimeRecords: members.map((member) => ({ receiptId: member.evidenceId, payload: {} })) });
  const peb = inspectReceivedPeb(text);
  const graph = projectReceivedGraph(peb, text);
  const catalog = createReceivedEvidenceCatalog(graph, "fr", text);
  return { text, peb, graph, catalog };
}
const noop = () => {};
const visible = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const linksForEntry = (entry: ReturnType<typeof fixture>["catalog"]["entries"][number]) => ({
  path: `/path?event=${entry.eventId}`, event: `/event?event=${entry.eventId}`,
  graph: `/graph?event=${entry.eventId}`, nanoreceipts: `/nanoreceipts?nr=${entry.nanoReceiptId}`, forensic: `/forensic?event=${entry.eventId}`,
});

test("Focus renders Before / Event / After with domain, provenance and exact progression", () => {
  const { catalog, peb, graph, text } = fixture();
  const entry = catalog.entries[1]!;
  for (const html of [
    renderToStaticMarkup(createElement(GuidedStoryView, { catalog, locale: "fr", selectedNodeKey: entry.nodeKey, focusMode: true, links: {}, linksForEntry })),
    renderToStaticMarkup(createElement(EventDetailView, { graph, peb, text, locale: "fr", selection: { eventId: entry.eventId }, focusMode: true, links: {}, linksForEntry })),
  ]) {
    assert.match(html, /data-narrative-focus="true"/);
    assert.match(html, /aria-pressed="true"[^>]*>Mode Focus/);
    assert.match(visible(html), /Avant.*Le passager demande un taxi.*Événement.*Le taxi accepte la mission.*Domaine : Conduite autonome.*PROVENANCE NON ÉTABLIE.*Après.*Dépose du passager confirmée/);
    assert.match(html, /href="\/path\?event=d005.dropoff-confirmed"/);
    assert.match(visible(html), /Continuer l’histoire →.*Voir plus de causalité →/);
    assert.doesNotMatch(visible(html), /Ce que les preuves établissent|sourceBundle|manifest|nr\.b|member:1/);
  }
  const end = renderToStaticMarkup(createElement(GuidedStoryView, { catalog, locale: "fr", selectedNodeKey: catalog.timelineEntries.at(-1)!.nodeKey, focusMode: true, links: {}, linksForEntry }));
  assert.match(visible(end), /aucun fait suivant.*Lecture terminée/);
  assert.doesNotMatch(end, /Continuer l’histoire/);
});

test("Back is a secondary button beside Continue, offered only when a previous view exists", () => {
  const { catalog, peb, graph, text } = fixture();
  const entry = catalog.entries[1]!;
  for (const focusMode of [false, true]) {
    const story = (onBack?: () => void) => renderToStaticMarkup(createElement(GuidedStoryView, { catalog, locale: "fr", selectedNodeKey: entry.nodeKey, focusMode, links: {}, linksForEntry, onBack }));
    assert.doesNotMatch(story(), /data-story-back/);
    const html = story(noop);
    assert.match(html, /<button type="button" class="story-back" data-story-back="true"[^>]*>.*Retour<\/button>/);
    assert.ok(html.indexOf("data-story-back") < html.indexOf("Continuer l’histoire →"), "Back precedes the forward action");
    assert.equal(html.match(/class="guided-story-primary"/g)?.length, 1, "Continue remains the single primary action");
  }
  const event = (onBack?: () => void) => renderToStaticMarkup(createElement(EventDetailView, { graph, peb, text, locale: "fr", selection: { eventId: entry.eventId }, focusMode: true, links: {}, linksForEntry, onBack }));
  assert.doesNotMatch(event(), /data-story-back/);
  assert.match(visible(event(noop)), /Retour Continuer l’histoire →/);
});

test("Event Story refuses compilation and support without false start/end cards", () => {
  const { catalog, peb, graph, text } = fixture();
  for (const entry of catalog.entries.filter((entry) => entry.evidenceId === "dossier" || entry.evidenceId === "support")) {
    const html = renderToStaticMarkup(createElement(EventDetailView, { graph, peb, text, locale: "fr", selection: { eventId: entry.eventId }, links: { path: "/path" }, linksForEntry, focusMode: true }));
    assert.match(html, /data-resolution="OUTSIDE_STORY"/);
    assert.match(visible(html), /hors de l’histoire.*Voir dans NanoReceipts.*Inspecter en Forensic/);
    assert.doesNotMatch(visible(html), /Début de l’histoire|Fin de l’histoire|Continuer l’histoire/);
    assert.equal(catalog.entries.length, 7);
  }
});

test("direct node emphasis never walks ancestors, descendants or observed-only input", () => {
  const { graph } = fixture();
  const node = graph.nodes.find((node) => node.evidenceId === "b")!;
  const emphasis = inspectionDirectCausalEmphasis(graph, node.key);
  assert.deepEqual([...emphasis.strong].sort(), graph.nodes.filter((node) => ["a", "b", "c", "dossier"].includes(node.evidenceId!)).map((node) => node.key).sort());
  assert.equal(emphasis.context.size, 0);
  assert.equal(emphasis.strongEdges.size, 3);
  assert.deepEqual([...inspectionDirectCausalEmphasis(graph, "absent").strong], []);
});

test("a mixed edge explains each exact declaration without turning observed input into physical cause", () => {
  const { graph, text } = fixture();
  const edge = graph.edges.find((edge) => edge.declarations.length === 2)!;
  const before = JSON.stringify(graph);
  const html = renderToStaticMarkup(createElement(ReceivedRelationExplanation, { graph, text, edge, locale: "fr", onOpenForensic: noop }));
  assert.match(html, /data-explained-declaration-count="2"/);
  assert.equal(html.match(/data-declaration-path=/g)?.length, 2);
  for (const declaration of edge.declarations) assert.ok(html.includes(`data-declaration-path="${declaration.path}"`));
  assert.match(visible(html), /Parent causal déclaré.*comme parent causal.*Entrée observée déclarée.*n’établit pas une observation physique ni une cause/);
  assert.doesNotMatch(visible(html), /manifest|causalParents|observedInputs|nr\.a|member:0/);
  assert.equal(JSON.stringify(graph), before);
});

test("selected edge takes priority over its target fact and leaves boundary inspection available", () => {
  const { graph, peb, text } = fixture();
  const edge = graph.edges.find((edge) => edge.declarations.length === 2)!;
  const html = renderToStaticMarkup(createElement(InspectionWorkspace, { graph, peb, text, locale: "fr", path: [], dedicated: true,
    selection: { kind: "relation", edgeKey: edge.key, focusNodeKey: edge.to }, onSelectionChange: noop,
    graphMode: "expert", onOpenForensic: noop,
    uiState: { ...DEFAULT_VERIFIER_UI, graphScale: 70, expandedPanels: ["graph:options", "graph:families", "graph:family:passenger"] },
    restoreToken: "restore-entry", navigationIntent: "restore",
  }));
  assert.match(html, /<h3>Pourquoi ce lien \?<\/h3>/);
  assert.match(html, /data-explained-declaration-count="2"/);
  assert.doesNotMatch(html, /class="inspection-human-fact"/);
  assert.match(html, /data-graph-scale="70"/);
  assert.match(html, /class="inspection-options"[^>]*open=""/);
  assert.match(html, /class="inspection-families"[^>]*open=""/);
});

test("empty event and empty causal graph have explicit actionable states", () => {
  const { graph, peb, text } = fixture();
  const noSelection = renderToStaticMarkup(createElement(EventDetailView, { graph, peb, text, locale: "fr", selection: {}, links: { timeline: "/timeline" } }));
  assert.match(visible(noSelection), /Aucun événement sélectionné.*Sélectionnez un événement reçu.*Revenir à la Timeline/);
  const html = renderToStaticMarkup(createElement(InspectionWorkspace, { graph, peb, text, locale: "fr", path: [], graphMode: "causal", dedicated: true }));
  assert.match(visible(html), /Aucun fait sélectionné.*Choisissez un événement/);
  assert.doesNotMatch(visible(html), /Activez NanoReceipts/);
});

test("relation inspection remains primary in Timeline and diagnostics reserve technical paths for Forensic", () => {
  const { peb, graph, text } = fixture();
  const edge = graph.edges.find((edge) => edge.declarations.length === 2)!;
  const html = renderToStaticMarkup(createElement(ReceivedCausalInspection, { peb, text, locale: "fr", expertViews: { structure: null, flow: null, receipts: null, trust: null }, view: "path",
    selection: { kind: "relation", edgeKey: edge.key, focusNodeKey: edge.to }, onOpenForensic: noop,
  }));
  assert.match(html, /data-explained-declaration-count="2"/);
  assert.match(visible(html), /Pourquoi ce lien/);
  assert.doesNotMatch(html, /data-selected-node-key=/);
  const raw = JSON.parse(text);
  raw.manifest.memberRefs[1].causalParents.push("missing-physical-proof");
  const unresolvedText = JSON.stringify(raw);
  const unresolved = renderToStaticMarkup(createElement(ReceivedCausalInspection, { peb: inspectReceivedPeb(unresolvedText), text: unresolvedText, locale: "fr", expertViews: { structure: null, flow: null, receipts: null, trust: null }, view: "graph", onOpenForensic: noop }));
  assert.match(visible(unresolved), /Certaines références reçues sont absentes ou ambiguës.*Inspecter les déclarations dans Forensic/);
  assert.doesNotMatch(visible(unresolved), /missing-physical-proof|manifest\.memberRefs|causalParents\[/);
});

test("Final Receipt input explanations retain each model declaration and never imply settlement", () => {
  const text = readFileSync(new URL("../../../artifacts/d006-network-continuity-20261002/peb-after-network-cycle.json", import.meta.url), "utf8");
  const graph = projectReceivedGraph(inspectReceivedPeb(text), text);
  const edge = graph.edges.find((edge) => edge.declarations.some((declaration) => declaration.kind === "FINAL_RECEIPT_INPUT"))!;
  assert.ok(edge);
  const html = renderToStaticMarkup(createElement(ReceivedRelationExplanation, { graph, edge, text, locale: "fr" }));
  assert.equal(html.match(/data-declaration-path=/g)?.length, edge.declarations.length);
  assert.match(visible(html), /Entrée du Reçu final déclarée.*comme entrée de clôture/);
  assert.doesNotMatch(visible(html), /règlement établi|settlement established|finalReceipt\.inputEvidenceIds/);
});

test("Domains receives the exact PEB text through its inspection parent for audited provenance", () => {
  const text = readFileSync(new URL("../../../artifacts/d006-network-continuity-20261002/peb-after-network-cycle.json", import.meta.url), "utf8");
  const html = renderToStaticMarkup(createElement(ReceivedCausalInspection, { peb: inspectReceivedPeb(text), text, locale: "fr", expertViews: { structure: null, flow: null, receipts: null, trust: null }, view: "domains" }));
  const domains = html.match(/<section class="received-domains-overview"[\s\S]*?<\/section>/)?.[0];
  assert.ok(domains, "the real parent renders its Domains child");
  assert.equal(domains.match(/SIMULÉ · Script d’audit/g)?.length, 2, "both exact audited transitions remain simulated in domain facts");
  assert.doesNotMatch(visible(domains), /PROVENANCE NON ÉTABLIE|OBSERVÉ/);
});

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { inspectReceivedPeb } from "../app/verify/inspectReceivedPeb.ts";
import { projectReceivedGraph } from "../app/verify/receivedGraph.ts";
import { createReceivedEvidenceCatalog, resolveReceivedEvidenceSelection } from "../app/verify/receivedEvidenceCatalog.ts";
import { resolveVerifierStoryContext } from "../app/verify/verifierNavigation.ts";
import { buildVerifierPath, parseVerifierUrl, verifierRouteTarget, verifierSelectionFromRoute, type VerifierView } from "../app/verify/verifierRoutes.ts";

const loader = registerHooks({ resolve(specifier, context, nextResolve) {
  if (context.parentURL && specifier.startsWith(".") && !/\.(?:ts|tsx|css)$/.test(specifier)) {
    for (const extension of [".ts", ".tsx"]) {
      const target = new URL(specifier + extension, context.parentURL);
      if (existsSync(target)) return nextResolve(target.href, context);
    }
  }
  return nextResolve(specifier, context);
}, load(url, context, nextLoad) {
  if (url.endsWith(".css")) return { format: "module", source: "export {};", shortCircuit: true };
  if (url.endsWith(".tsx")) return { format: "module", source: ts.transpileModule(readFileSync(new URL(url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 }, fileName: new URL(url).pathname,
  }).outputText, shortCircuit: true };
  return nextLoad(url, context);
} });
const { NanoReceiptsView } = await import("../app/verify/NanoReceiptsView.tsx");
const { ForensicView } = await import("../app/verify/ForensicView.tsx");
const { PersistentStoryTimeline } = await import("../app/verify/PersistentStoryTimeline.tsx");
loader.deregister();

const text = readFileSync(new URL("../../../artifacts/d006-network-continuity-20261002/peb-after-network-cycle.json", import.meta.url), "utf8");
const peb = inspectReceivedPeb(text); const graph = projectReceivedGraph(peb, text);
const catalog = createReceivedEvidenceCatalog(graph, "fr", text);
const dossier = catalog.entries.find(entry => entry.eventId === "d005m.receipt.master-payment")!;
const support = catalog.entries.find(entry => entry.eventId === "d005.demo-trust-anchor-activation")!;
const fact = catalog.entries.find(entry => entry.eventId === "d005.garage-arrival")!;
function route(view: VerifierView, eventId: string, nr: string | null, storyEventId: string | null = null) {
  const parsed = parseVerifierUrl(buildVerifierPath({ pebDigest: peb.transferDigest, view, eventId, nanoReceiptId: nr, storyEventId }));
  if (!parsed.ok || parsed.route.kind !== "view") throw new Error("expected exact view route");
  return parsed.route;
}

test("direct legacy depth views keep a compiled/support target while origin remains explicitly absent", () => {
  assert.ok(dossier.nanoReceiptId); assert.equal(dossier.timelinePosition, null); assert.equal(support.timelinePosition, null);
  for (const target of [dossier, support]) for (const view of ["domains", "graph", "nanoreceipts", "forensic"] as const) {
    const legacy = route(view, target.eventId!, target.nanoReceiptId);
    const origin = resolveVerifierStoryContext(catalog, legacy);
    assert.deepEqual(origin, { status: "ABSENT", eventId: null, entry: null, explicit: false });
    const selection = { ...verifierSelectionFromRoute(legacy, peb.identity.missionId, target.evidenceId), storyEventId: origin.eventId };
    assert.equal(resolveReceivedEvidenceSelection(catalog, selection).entry?.nodeKey, target.nodeKey);
    const link = buildVerifierPath(verifierRouteTarget(selection));
    assert.equal(new URL(link, "https://fortix.invalid").searchParams.has("storyEvent"), false, "new tab keeps absence instead of inventing a dossier story origin");
    if (view !== "nanoreceipts" && view !== "forensic") continue;
    const html = view === "nanoreceipts"
      ? renderToStaticMarkup(createElement(NanoReceiptsView, { graph, text, locale: "fr", selection, links: {} }))
      : renderToStaticMarkup(createElement(ForensicView, { graph, peb, text, locale: "fr", selection, links: {} }));
    assert.equal((html.match(/data-selected="true"/g) ?? []).length, 1, "the exact requested evidence remains selected");
    assert.ok(html.includes(target.eventLabel));
    if (view === "forensic") assert.match(html, /data-resolution="RESOLVED"/);
  }
});

test("absent narrative origin shows a notice without first-event fallback or a fictitious event return", () => {
  const html = renderToStaticMarkup(createElement(PersistentStoryTimeline, { catalog, locale: "fr", originAbsent: true,
    selectedNodeKey: null, linksForEntry: entry => ({ path: `/path?event=${entry.eventId}` }) }));
  assert.match(html, /data-story-status="ORIGIN_ABSENT"/);
  assert.match(html, /La preuve sélectionnée reste consultable/);
  assert.ok(!html.includes("persistent-story-timeline__current"));
  assert.ok(!html.includes("verifier-story-return"));
  assert.ok(!html.includes("Étape 1"));
});

test("Path/Event and every explicit invalid origin retain strict non-narrative/unknown guards", () => {
  for (const view of ["path", "event", "timeline"] as const) {
    assert.equal(resolveVerifierStoryContext(catalog, route(view, dossier.eventId!, dossier.nanoReceiptId)).status, "OUTSIDE_STORY");
  }
  for (const view of ["domains", "graph", "nanoreceipts", "forensic"] as const) {
    const outside = resolveVerifierStoryContext(catalog, route(view, dossier.eventId!, dossier.nanoReceiptId, dossier.eventId));
    assert.equal(outside.status, "OUTSIDE_STORY"); assert.equal(outside.explicit, true);
    const missing = resolveVerifierStoryContext(catalog, route(view, dossier.eventId!, dossier.nanoReceiptId, "unknown-origin"));
    assert.equal(missing.status, "NOT_FOUND"); assert.equal(missing.entry, null);
    const valid = resolveVerifierStoryContext(catalog, route(view, dossier.eventId!, dossier.nanoReceiptId, fact.eventId));
    assert.equal(valid.status, "RESOLVED"); assert.equal(valid.entry?.nodeKey, fact.nodeKey);
  }
  assert.equal(graph.nodes.length, 71); assert.equal(graph.edges.length, 165);
});

test("an explicitly ambiguous origin never resolves to the first received event", () => {
  const duplicateText = JSON.stringify({ profile: "fortix.demo.d006.peb.v1", manifest: { memberRefs: ["a", "b"].map(id => ({
    evidenceId: id, receiptId: `NR-${id}`, eventId: "same.origin", presentation: "PRESENTED", source: "RUNTIME_JOURNAL", producerDomain: "Taxi",
  })) } });
  const duplicateGraph = projectReceivedGraph(inspectReceivedPeb(duplicateText), duplicateText);
  const duplicateCatalog = createReceivedEvidenceCatalog(duplicateGraph, "fr", duplicateText);
  const origin = resolveVerifierStoryContext(duplicateCatalog, { view: "nanoreceipts", eventId: null, storyEventId: "same.origin" });
  assert.equal(origin.status, "AMBIGUOUS"); assert.equal(origin.entry, null); assert.equal(origin.eventId, "same.origin");
});

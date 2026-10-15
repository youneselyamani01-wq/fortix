import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { inspectReceivedPeb } from "../app/verify/inspectReceivedPeb.ts";
import { projectReceivedGraph } from "../app/verify/receivedGraph.ts";
import { isReceivedEvidenceDossier, receivedTimelineNodes } from "../app/verify/guidedInspection.ts";
import { createReceivedEvidenceCatalog } from "../app/verify/receivedEvidenceCatalog.ts";
import { receivedReceiptCounts } from "../app/verify/receivedReceiptLabels.ts";
import {
  guidedStoryDomainLabel,
  guidedStoryEntries,
  guidedStoryEventLabel,
  guidedStoryHumanCaption,
  guidedStoryPathLink,
  guidedStoryPosition,
} from "../app/verify/guidedStory.ts";

// Exercise the real client components with React SSR, using the project's
// TypeScript compiler only to load TSX. No test copy of the reader is involved.
const componentLoader = registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith(".css")) return { format: "module", source: "export {};", shortCircuit: true };
    if (url.endsWith(".tsx")) return {
      format: "module",
      source: ts.transpileModule(readFileSync(new URL(url), "utf8"), {
        compilerOptions: { module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
        fileName: new URL(url).pathname,
      }).outputText,
      shortCircuit: true,
    };
    return nextLoad(url, context);
  },
});
const { GuidedStoryView } = await import("../app/verify/GuidedStoryView.tsx");
const { PersistentStoryTimeline } = await import("../app/verify/PersistentStoryTimeline.tsx");
componentLoader.deregister();

const member = (id: string, eventId: string, timeMs?: number, extra: Record<string, unknown> = {}) => ({
  evidenceId: id, receiptId: "NR-" + id, eventId, timeMs,
  source: "RUNTIME_JOURNAL", presentation: "PRESENTED", producerDomain: "Taxi autonomy",
  causalParents: [], observedInputs: [], ...extra,
});
function fixture(members: readonly unknown[]) {
  const raw = JSON.stringify({ profile: "fortix.demo.d006.peb.v1", bundleId: "guided-story", manifest: { memberRefs: members } });
  const graph = projectReceivedGraph(inspectReceivedPeb(raw), raw);
  return { graph, catalog: createReceivedEvidenceCatalog(graph, "fr") };
}
const referenceRaw = () => readFileSync(new URL("../../../artifacts/d006-network-continuity-20261002/peb-after-network-cycle.json", import.meta.url), "utf8");

test("reading starts with the first declared fact and preserves time ties and absent times", () => {
  const { catalog, graph } = fixture([
    member("late", "d005.dropoff-confirmed", 200),
    member("undated", "d005.maintenance-intent"),
    member("first-tie", "d005.passenger-request", 100),
    member("second-tie", "d005.mission-accepted", 100),
    member("support", "d005.demo-trusted-time", 50, { presentation: "ASSURANCE_SUPPORT" }),
  ]);
  const before = JSON.stringify(graph);
  const start = guidedStoryPosition(catalog);
  assert.equal(start.status, "READY");
  assert.equal(start.index, 0);
  assert.equal(start.previous, null);
  assert.equal(start.current?.evidenceId, "first-tie");
  assert.equal(start.next?.evidenceId, "second-tie");
  assert.deepEqual(start.entries.map((entry) => entry.evidenceId), ["first-tie", "second-tie", "late", "undated"]);
  assert.deepEqual(start.entries.map((entry) => entry.node.member?.timeMs), [100, 100, 200, null]);
  assert.equal(start.completed, false);
  assert.equal(JSON.stringify(graph), before);
});

test("dossiers stay in the evidence inventory but never become guided facts", () => {
  const { catalog, graph } = fixture([
    member("passenger", "d005.passenger-request", 10),
    member("payment-dossier", "d005m.receipt.master-payment", 20),
    member("return-dossier", "d005m.receipt.master-return-to-base", 30),
    member("support", "d005.receipt.traffic", 40, { presentation: "ASSURANCE_SUPPORT" }),
    member("return", "d005m.master-base-arrival", 50),
  ]);
  const before = JSON.stringify(catalog);
  assert.equal(catalog.entries.length, 5);
  assert.equal(catalog.families.find((family) => family.key === "compilation")?.entries.length, 2);
  assert.deepEqual(receivedTimelineNodes(graph).map((node) => node.evidenceId), ["passenger", "return"]);
  assert.deepEqual(guidedStoryEntries(catalog).map((entry) => entry.evidenceId), ["passenger", "return"]);
  assert.equal(guidedStoryPosition(catalog, catalog.entries[1]!.nodeKey).status, "OUTSIDE_STORY");
  assert.equal(guidedStoryPosition(catalog, catalog.entries[3]!.nodeKey).current, null);
  assert.deepEqual(receivedReceiptCounts(graph), { nano: 4, support: 1, final: 0, unresolved: 0 });
  assert.equal(JSON.stringify(catalog), before);
});

test("an explicit missing or unresolved link cannot select the first event", () => {
  const { catalog } = fixture([member("first", "d005.passenger-request", 0)]);
  const missing = guidedStoryPosition(catalog, "not-received");
  assert.equal(missing.status, "NOT_FOUND");
  assert.equal(missing.current, null);
  assert.equal(missing.index, -1);
  assert.equal(missing.completed, false);
  const unresolved = guidedStoryPosition(catalog, null, true);
  assert.equal(unresolved.status, "UNRESOLVED");
  assert.equal(unresolved.current, null);
  assert.equal(unresolved.first, catalog.timelineEntries[0]);
  const empty = guidedStoryPosition(fixture([]).catalog);
  assert.equal(empty.status, "EMPTY");
  assert.equal(empty.current, null);
  assert.equal(empty.completed, false);
});

test("canonical path links preserve received context without redirecting progression into detail", () => {
  const path = "/verify/" + "a".repeat(64) + "/path?event=received%3Aevent&nr=NR-paid&domain=Payment+policy";
  assert.equal(guidedStoryPathLink({ path, timeline: "/timeline", event: "/detail" }), path);
  assert.equal(guidedStoryPathLink({ timeline: "/timeline?event=received&nr=NR-paid" }), "/timeline?event=received&nr=NR-paid");
  assert.equal(guidedStoryPathLink({ event: "/detail" }), undefined);
  assert.equal(guidedStoryPathLink(undefined), undefined);
});

test("human reading suppresses internal captions while preserving the received identifiers", () => {
  const { catalog } = fixture([member("private-id", "unknown.event.identity", 0, { producerDomain: "INTERNAL_DOMAIN" })]);
  const received = catalog.entries[0]!;
  assert.equal(guidedStoryEventLabel({ ...received, eventLabel: "manifest.memberRefs[6].receiptId" }, "fr"), "Un événement est déclaré");
  assert.equal(guidedStoryEventLabel({ ...received, eventLabel: received.eventId! }, "fr"), "Un événement est déclaré");
  assert.equal(guidedStoryEventLabel({ ...received, eventLabel: "Le taxi a rejoint le passager" }, "fr"), "Le taxi a rejoint le passager");
  assert.equal(guidedStoryDomainLabel(received, "fr"), "Domaine non précisé");
  assert.equal(guidedStoryHumanCaption("M07 · NR-secret", "Mission reçue"), "Mission reçue");
  assert.equal(received.eventId, "unknown.event.identity");
  assert.equal(received.evidenceId, "private-id");
  assert.equal(received.nanoReceiptId, "NR-private-id");
});

test("the complete received PEB has 59 readable steps and retains all 71 evidence units", () => {
  const raw = referenceRaw();
  const graph = projectReceivedGraph(inspectReceivedPeb(raw), raw);
  const catalog = createReceivedEvidenceCatalog(graph, "fr");
  const before = JSON.stringify(graph);
  const entries = guidedStoryEntries(catalog);
  assert.equal(entries.length, 59);
  assert.equal(catalog.entries.length, 71);
  assert.deepEqual(receivedReceiptCounts(graph), { nano: 60, support: 10, final: 1, unresolved: 0 });
  assert.ok(entries.every((entry) => catalog.entries.includes(entry) && entry.receipt.kind !== "SUPPORT" && !isReceivedEvidenceDossier(entry.node)));

  let position = guidedStoryPosition(catalog);
  const visited: string[] = [];
  while (position.current) {
    visited.push(position.current.nodeKey);
    assert.equal(position.index + 1, visited.length);
    if (!position.next) break;
    assert.equal(position.completed, false);
    const current = position.current;
    position = guidedStoryPosition(catalog, position.next.nodeKey);
    assert.equal(position.previous, current);
  }
  assert.deepEqual(visited, entries.map((entry) => entry.nodeKey));
  assert.equal(position.index, 58);
  assert.equal(position.next, null);
  assert.equal(position.completed, true);
  assert.equal(position.first, entries[0]);
  assert.equal(position.current?.node.final, true);
  assert.equal(guidedStoryEventLabel(position.current!, "fr"), "Le Reçu final est disponible");

  const lost = entries.find((entry) => entry.eventId?.startsWith("d006d.network-link-lost:"))!;
  const restored = entries.find((entry) => entry.eventId?.startsWith("d006d.network-link-restored:"))!;
  assert.equal(guidedStoryPosition(catalog, lost.nodeKey).next, restored);
  assert.equal(graph.edges.some((edge) => edge.from === lost.nodeKey && edge.to === restored.nodeKey), false);
  assert.equal(JSON.stringify(graph), before, "reading never removes evidence or fabricates causal edges");
});

test("rendered progression exposes one Continue action and finishes with a restart link", () => {
  const { catalog } = fixture([
    member("first", "d005.passenger-request", 0),
    member("second", "d005.mission-accepted", 1),
    member("last", "d005.dropoff-confirmed", 2),
  ]);
  const linksForEntry = (entry: typeof catalog.entries[number]) => ({
    path: "/path?event=" + encodeURIComponent(entry.eventId!),
    event: "/details?event=" + encodeURIComponent(entry.eventId!),
    graph: "/graph?event=" + encodeURIComponent(entry.eventId!),
    domains: "/domains?event=" + encodeURIComponent(entry.eventId!),
    nanoreceipts: "/nanoreceipts?event=" + encodeURIComponent(entry.eventId!),
    forensic: "/forensic?event=" + encodeURIComponent(entry.eventId!),
  });
  const render = (selectedNodeKey: string | null) => renderToStaticMarkup(createElement(GuidedStoryView, {
    catalog, locale: "fr", missionLabel: "Mission D-006", links: { path: "/path" }, linksForEntry, selectedNodeKey,
  }));
  const firstHtml = render(null);
  assert.match(firstHtml, /Étape 1 \/ 3/);
  assert.match(firstHtml, /Mission D-006/);
  assert.match(firstHtml, /Conduite autonome/);
  assert.match(firstHtml, /<h1[^>]+>Le passager demande un taxi<\/h1>/);
  assert.match(firstHtml, /href="\/path\?event=d005.mission-accepted"[^>]*>Continuer l’histoire →<\/a>/);
  assert.equal(firstHtml.match(/>Continuer l’histoire →</g)?.length, 1);
  assert.match(firstHtml, /href="\/nanoreceipts\?event=d005.passenger-request"[^>]*>Inspecter la preuve →<\/a>/);
  assert.match(firstHtml, /data-fact-inspector="true" data-inspector-context="path"/);
  assert.doesNotMatch(firstHtml, /href="\/forensic/, "Forensic is reached from the evidence, not from the first reading level");
  const finalHtml = render(catalog.entries[2]!.nodeKey);
  assert.match(finalHtml, /Étape 3 \/ 3/);
  assert.match(finalHtml, /Lecture terminée/);
  assert.doesNotMatch(finalHtml, /Continuer l’histoire/);
  assert.match(finalHtml, /href="\/path\?event=d005.passenger-request"[^>]*>Revenir au début de l’histoire →<\/a>/);
  const readingText = firstHtml.replace(/<[^>]+>/g, "");
  assert.doesNotMatch(readingText, /NR-first|member:0|d005\.passenger-request|manifest\.memberRefs|receiptId/);
});

test("rendered persistent timeline exposes one compact context and one exact event return", () => {
  const { catalog } = fixture([
    member("first", "d005.passenger-request", 0),
    member("second", "d005.mission-accepted", 1),
    member("last", "d005.dropoff-confirmed", 2),
  ]);
  const html = renderToStaticMarkup(createElement(PersistentStoryTimeline, {
    catalog, locale: "fr", missionLabel: "Mission D-006", selectedNodeKey: catalog.entries[1]!.nodeKey,
    linksForEntry: (entry) => ({ path: "/path?event=" + encodeURIComponent(entry.eventId!) + "&nr=" + encodeURIComponent(entry.nanoReceiptId!) }),
    returnEventHref: "/path?event=d005.mission-accepted&nr=NR-second",
  }));
  assert.match(html, /Étape 2 \/ 3/);
  assert.match(html, /class="verifier-reading-context"/);
  assert.match(html, /Le taxi accepte la mission/);
  assert.match(html, /Conduite autonome/);
  assert.equal(html.match(/Mission D-006/g)?.length, 1);
  assert.equal(html.match(/Étape 2 \/ 3/g)?.length, 1);
  assert.match(html, /class="verifier-story-return" href="\/path\?event=d005.mission-accepted&amp;nr=NR-second"/);
  assert.equal(html.match(/href="\/path\?event=/g)?.length, 1);
  assert.doesNotMatch(html, /Fait précédent|Événement courant · Chemin|Fait suivant|persistent-story-timeline__(?:previous|current|next)/);
  assert.doesNotMatch(html, /<button/);
});

test("rendered unresolved deep links offer a clean return without displaying the first fact", () => {
  const { catalog } = fixture([member("first", "d005.passenger-request", 0)]);
  const props = {
    catalog, locale: "fr" as const, selectedNodeKey: null, selectionUnresolved: true, recoveryPathHref: "/path",
    links: { path: "/path?event=missing" }, linksForEntry: () => ({ path: "/path?event=d005.passenger-request" }),
  };
  for (const html of [
    renderToStaticMarkup(createElement(GuidedStoryView, props)),
    renderToStaticMarkup(createElement(PersistentStoryTimeline, props)),
  ]) {
    assert.match(html, /Ce lien ne résout pas un événement unique/);
    assert.match(html, /href="\/path"/);
    assert.doesNotMatch(html, /Le passager demande un taxi|Étape 1|Continuer l’histoire|event=missing/);
  }
});

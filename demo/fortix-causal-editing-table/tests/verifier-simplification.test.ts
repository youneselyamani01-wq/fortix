import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { inspectReceivedPeb } from "../app/verify/inspectReceivedPeb.ts";
import { projectReceivedGraph } from "../app/verify/receivedGraph.ts";
import { createReceivedEvidenceCatalog, type ReceivedEvidenceCatalogEntry } from "../app/verify/receivedEvidenceCatalog.ts";
import { receivedNetworkModel } from "../app/verify/receivedNetwork.ts";
import { graphModeDisplay, networkContextNodeKeys } from "../app/verify/graphDisplay.ts";
import { factLocalLimits } from "../app/verify/factInspection.ts";
import { deterministicVerifierParentPath } from "../app/verify/verifierNavigation.ts";
import { VERIFIER_PRIMARY_VIEWS, VERIFIER_VIEWS, buildVerifierPath, parseVerifierUrl, type VerifierViewRoute } from "../app/verify/verifierRoutes.ts";
import { VerifierPresentationHistory, type VerifierHistoryPort } from "../app/verify/verifierPresentation.ts";
import type { D006VerdictSnapshot } from "../app/offlineVerification.ts";

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
const { FactInspector } = await import("../app/verify/FactInspector.tsx");
const { EventDetailView } = await import("../app/verify/EventDetailView.tsx");
const { GuidedStoryView } = await import("../app/verify/GuidedStoryView.tsx");
const { NanoReceiptsView } = await import("../app/verify/NanoReceiptsView.tsx");
const { NetworkView } = await import("../app/verify/ReceivedNetworkView.tsx");
const { ReceivedCausalInspection } = await import("../app/verify/ReceivedCausalInspection.tsx");
const { InspectionWorkspace } = await import("../app/verify/InspectionWorkspace.tsx");
const { VerifierViewActions } = await import("../app/verify/VerifierViewActions.tsx");
const { RouteVerdict } = await import("../app/verify/VerifierRouteClient.tsx");
componentLoader.deregister();

const artifact = (path: string) => readFileSync(new URL(`../../../artifacts/${path}`, import.meta.url), "utf8");
const source = (name: string) => readFileSync(new URL(`../app/verify/${name}`, import.meta.url), "utf8");
const visible = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const linksForEntry = (entry: { nodeKey: string }) => ({ event: `/event/${entry.nodeKey}`, nanoreceipts: `/nr/${entry.nodeKey}`, graph: `/graph/${entry.nodeKey}`,
  timeline: `/timeline/${entry.nodeKey}`, network: `/network/${entry.nodeKey}`, forensic: `/forensic/${entry.nodeKey}`, path: `/path/${entry.nodeKey}` });
const expertViews = { structure: null, flow: null, receipts: null, trust: null };

function load(text: string) {
  const peb = inspectReceivedPeb(text);
  const graph = projectReceivedGraph(peb, text);
  const catalog = createReceivedEvidenceCatalog(graph, "fr", text);
  return { text, peb, graph, catalog, model: receivedNetworkModel(catalog, text) };
}
const reference = load(artifact("d006-network-continuity-20261002/peb-after-network-cycle.json"));
const cut = load(artifact("verifier-ux-completion-20261004/real-cut-incomplete-peb.json"));

/** What a reader sees before opening anything: closed <details> keep only their summary. */
function visibleByDefault(html: string): string {
  let out = ""; let cursor = 0; const closed: number[] = []; let depth = 0;
  const tag = /<(\/?)(details|summary)\b([^>]*)>/g;
  let summaryDepth = -1;
  for (let match = tag.exec(html); match; match = tag.exec(html)) {
    const hidden = closed.length > 0 && summaryDepth < 0;
    if (!hidden) out += html.slice(cursor, match.index);
    cursor = match.index + match[0].length;
    const [, end, name, attributes] = match;
    if (name === "details") {
      if (end) { if (closed.at(-1) === depth) closed.pop(); depth--; }
      else { depth++; if (!/\bopen\b/.test(attributes!)) closed.push(depth); }
    } else if (!end && closed.at(-1) === depth) summaryDepth = depth;
    else if (end && summaryDepth === depth) summaryDepth = -1;
  }
  return visible(out + html.slice(cursor));
}
function inspectorOf(html: string) {
  const start = html.indexOf('data-fact-inspector="true"');
  assert.ok(start >= 0, "a shared fact inspector is rendered");
  const block = html.slice(start);
  return {
    context: /data-inspector-context="([^"]+)"/.exec(block)![1],
    title: /<h[123][^>]*>([^<]+)<\/h[123]>/.exec(block)![1],
    provenance: /class="fact-provenance"[^>]*><p><span>Provenance<\/span><strong>([^<]+)<\/strong>/.exec(block)![1],
  };
}
const entryByEvent = (catalog: typeof reference.catalog, pattern: RegExp) => catalog.entries.find(entry => pattern.test(entry.eventId ?? ""))!;
const lossOf = (fixture: typeof reference) => fixture.model.transitions[0]!.entry;
const views = (fixture: typeof reference, entry: ReceivedEvidenceCatalogEntry) => {
  const support = { catalog: fixture.catalog, network: fixture.model, linksForEntry };
  const event = { kind: "event", nodeKey: entry.nodeKey } as const;
  return {
    timeline: renderToStaticMarkup(createElement(ReceivedCausalInspection, { peb: fixture.peb, text: fixture.text, locale: "fr", expertViews, view: "path", selection: event, factSupport: support, condensed: true })),
    domains: renderToStaticMarkup(createElement(ReceivedCausalInspection, { peb: fixture.peb, text: fixture.text, locale: "fr", expertViews, view: "domains", selection: event, factSupport: support, condensed: true })),
    graph: renderToStaticMarkup(createElement(InspectionWorkspace, { graph: fixture.graph, peb: fixture.peb, text: fixture.text, locale: "fr", path: [], dedicated: true, graphMode: "causal", selection: event, factSupport: support })),
    network: renderToStaticMarkup(createElement(NetworkView, { model: fixture.model, catalog: fixture.catalog, locale: "fr", selectedNodeKey: entry.nodeKey, linksForEntry,
      inspector: createElement(FactInspector, { as: "section", entry, ...support, locale: "fr", text: fixture.text, context: "network", neighbourView: "network" }) })),
    event: renderToStaticMarkup(createElement(EventDetailView, { graph: fixture.graph, peb: fixture.peb, text: fixture.text, locale: "fr", selection: { eventId: entry.eventId }, links: {}, linksForEntry, network: fixture.model })),
  };
};

test("A: Événement is no longer a principal tab, while its route still exists", () => {
  assert.deepEqual([...VERIFIER_PRIMARY_VIEWS], ["verdict", "path", "timeline", "domains", "network", "graph", "nanoreceipts", "forensic"]);
  assert.ok(VERIFIER_VIEWS.includes("event"), "the event view stays a routable view");
  assert.ok(existsSync(new URL("../app/verify/[pebId]/events/[eventId]/page.tsx", import.meta.url)), "the event page still exists");
  const reader = source("VerifierRouteClient.tsx");
  const nav = reader.slice(reader.indexOf('<nav className="verifier-route-nav"'), reader.indexOf("</nav>", reader.indexOf('<nav className="verifier-route-nav"')));
  assert.match(nav, /VERIFIER_PRIMARY_VIEWS\.map/);
  assert.doesNotMatch(nav, /VERIFIER_VIEWS\.map/);
  assert.match(reader, /Object\.fromEntries\(VERIFIER_VIEWS\.flatMap/, "links (and so the event view) are still built for every view");
  const all = Object.fromEntries(VERIFIER_VIEWS.map(view => [view, `/${view}`]));
  const actions = renderToStaticMarkup(createElement(VerifierViewActions, { locale: "fr", currentView: "nanoreceipts", links: all }));
  assert.equal(actions.match(/data-verifier-view=/g)?.length, 8);
  assert.doesNotMatch(actions, /data-verifier-view="event"/);
  assert.doesNotMatch(source("EventDetailView.tsx") + source("NanoReceiptsView.tsx"), /<VerifierViewActions/, "no second navigation bar inside views");
});

test("B: a direct link to an event stays valid and resolves the same fact", () => {
  const loss = lossOf(reference);
  const path = buildVerifierPath({ pebDigest: reference.peb.transferDigest, missionId: reference.peb.identity.missionId, view: "event",
    eventId: loss.eventId, nanoReceiptId: loss.nanoReceiptId, domainId: loss.domainId, storyEventId: loss.eventId });
  assert.match(path, /\/events\//);
  const parsed = parseVerifierUrl(path);
  assert.ok(parsed.ok && parsed.route.kind === "view");
  const route = parsed.route as VerifierViewRoute;
  assert.equal(route.view, "event");
  assert.equal(route.eventId, loss.eventId);
  assert.equal(route.isCanonical, true);
  assert.match(deterministicVerifierParentPath(route), /\/path\?/, "its deterministic return is unchanged");
  const html = renderToStaticMarkup(createElement(EventDetailView, { graph: reference.graph, peb: reference.peb, text: reference.text, locale: "fr", selection: { eventId: route.eventId }, links: {}, linksForEntry, network: reference.model }));
  assert.match(html, /data-resolution="RESOLVED"/);
  assert.equal(inspectorOf(html).title, "Réseau perdu");
});

test("C: Timeline, Domains, Graph, Network and Event read one fact with the same title and provenance", () => {
  for (const [fixture, entry] of [[reference, lossOf(reference)], [cut, lossOf(cut)], [reference, entryByEvent(reference.catalog, /garage-arrival/)]] as const) {
    const rendered = views(fixture, entry);
    const readings = Object.fromEntries(Object.entries(rendered).map(([view, html]) => [view, inspectorOf(html)]));
    for (const [view, reading] of Object.entries(readings)) {
      assert.equal(reading.context, view, `${view} hosts the shared inspector in its own context`);
      assert.equal(reading.title, readings.event!.title, `${view}: same title as the event reading`);
      assert.equal(reading.provenance, readings.event!.provenance, `${view}: same provenance as the event reading`);
    }
  }
  assert.equal(inspectorOf(views(cut, lossOf(cut)).graph).provenance, "RUNTIME · Déclaré dans le PEB");
  assert.equal(inspectorOf(views(reference, lossOf(reference)).timeline).provenance, "SIMULÉ · Script d’audit");
});

test("D: a provenance reserve is never repeated on a page and never shown before it is asked for", () => {
  const loss = lossOf(cut);
  const pages = { ...views(cut, loss),
    path: renderToStaticMarkup(createElement(GuidedStoryView, { catalog: cut.catalog, locale: "fr", selectedNodeKey: loss.nodeKey, links: {}, linksForEntry, network: cut.model })),
    nanoreceipts: renderToStaticMarkup(createElement(NanoReceiptsView, { graph: cut.graph, text: cut.text, locale: "fr", selection: { eventId: loss.eventId }, links: {}, linksForEntry, network: cut.model })) };
  for (const [view, html] of Object.entries(pages)) {
    const all = visible(html);
    const shown = visibleByDefault(html);
    assert.ok((all.match(/Le runtime déclare avoir observé cette transition/g)?.length ?? 0) <= 1, `${view}: the transition reserve appears at most once`);
    assert.doesNotMatch(shown, /Le runtime déclare avoir observé|La source déclarée ne suffit pas|corroboration externe/, `${view}: no permanent provenance paragraph`);
    assert.doesNotMatch(all, /Ce n’est pas une confirmation externe indépendante/, `${view}: the former permanent sentence is gone`);
  }
  assert.equal(visible(pages.event).match(/RUNTIME · Déclaré dans le PEB/g)?.length, 1, "the event reading states its provenance once");
  assert.equal(visible(pages.nanoreceipts.slice(pages.nanoreceipts.indexOf('aria-current="true"'), pages.nanoreceipts.indexOf('data-selected="false"'))).match(/RUNTIME · Déclaré dans le PEB/g)?.length, 1, "one card states its provenance once");
});

test("E: the Verdict keeps the global synthesis of what is and is not established", () => {
  const html = (fixture: typeof reference, snapshot: D006VerdictSnapshot | null = null) => visible(renderToStaticMarkup(createElement(RouteVerdict, { locale: "fr", peb: fixture.peb, graph: fixture.graph, snapshot, links: {}, catalog: fixture.catalog, network: fixture.model })));
  const ref = html(reference);
  assert.match(ref, /Ce que les preuves permettent d’établir/);
  assert.match(ref, /Ce qui reste non établi/);
  assert.match(ref, /déclarations reçues : leur présence ne prouve pas, à elle seule, que l’effet physique ou métier s’est produit/);
  assert.match(ref, /n’ajoutent aucune causalité/);
  assert.match(ref, /\d+ faits? (?:sont simulés|est simulé)/);
  assert.match(ref, /la réconciliation des preuves produites hors ligne n’est pas établie/);
  const real = html(cut);
  assert.match(real, /de provenance RUNTIME : le runtime les déclare ; le Vérificateur n’établit pas de corroboration externe indépendante/);
  assert.match(real, /Le réseau n’est pas rétabli avant la fin de la mission/);
  assert.match(real, /état réseau à la fin du PEB : LOST/);
});

test("F: business views do not reproduce the Verdict blocks", () => {
  for (const [view, html] of Object.entries(views(reference, entryByEvent(reference.catalog, /garage-arrival/)))) {
    if (view === "event") continue;
    assert.doesNotMatch(visible(html), /Ce que les preuves (?:permettent d’)?établi|Ce qui reste non établi/, `${view} shows its own content first`);
  }
  const timeline = views(reference, lossOf(reference)).timeline;
  assert.doesNotMatch(timeline, /evidence-network-scope|class="received-note"|class="received-provenance"/, "the route shell drops package-wide notes");
  for (const file of ["EventDetailView.tsx", "GuidedStoryView.tsx", "FactInspector.tsx", "ReceivedCausalInspection.tsx", "InspectionWorkspace.tsx", "ReceivedNetworkView.tsx", "NanoReceiptsView.tsx"]) {
    assert.doesNotMatch(source(file), /Ce que les preuves établissent|Ce qui reste non établi/, `${file} leaves the global blocks to the Verdict`);
  }
});

test("G: a limit that changes how one fact reads stays visible or one click away", () => {
  const loss = lossOf(cut);
  const timeline = views(cut, loss).timeline;
  const inspector = timeline.slice(timeline.indexOf('data-fact-inspector="true"'));
  assert.match(inspector, /<summary>Comprendre cette provenance<\/summary><p>Le runtime déclare avoir observé cette transition\. Cette vue ne contient pas de corroboration externe indépendante\.<\/p>/);
  const payment = entryByEvent(reference.catalog, /payment-instruction-presented/);
  assert.match(factLocalLimits(payment, reference.text, "fr").join(" "), /n’établit pas, à elle seule, un règlement financier/);
  const paymentHtml = visibleByDefault(views(reference, payment).graph);
  assert.match(paymentHtml, /Limite pour ce fait Cette déclaration n’établit pas, à elle seule, un règlement financier ni une livraison\./);
  assert.deepEqual(factLocalLimits(entryByEvent(reference.catalog, /garage-arrival/), reference.text, "fr"), [], "no limit is invented for an ordinary fact");
  const restored = reference.model.transitions[1]!.entry;
  assert.match(visibleByDefault(views(reference, restored).network), /Réconciliation Réconciliation non établie/, "RESTORED never reads as RECONCILED");
});

class BrowserHistory implements VerifierHistoryPort {
  readonly entries: { state: unknown; path: string }[];
  cursor = 0;
  constructor(path: string) { this.entries = [{ state: null, path }]; }
  get state() { return this.entries[this.cursor]!.state; }
  get path() { return this.entries[this.cursor]!.path; }
  replaceState(state: unknown, _unused: string, path = this.path) { this.entries[this.cursor] = { state, path }; }
  pushState(state: unknown, _unused: string, path = this.path) { this.entries.splice(this.cursor + 1); this.entries.push({ state, path }); this.cursor++; }
  go(delta: number) { this.cursor += delta; }
}

test("H: inspector → evidence → Forensic → back restores the exact graph context", () => {
  const loss = lossOf(cut);
  const target = { pebDigest: cut.peb.transferDigest, missionId: cut.peb.identity.missionId, eventId: loss.eventId, nanoReceiptId: loss.nanoReceiptId, domainId: loss.domainId, storyEventId: loss.eventId };
  const graphPath = buildVerifierPath({ ...target, view: "graph", graphMode: "causal" });
  const evidencePath = buildVerifierPath({ ...target, view: "nanoreceipts" });
  const forensicPath = buildVerifierPath({ ...target, view: "forensic" });
  const browser = new BrowserHistory(graphPath); let sequence = 0;
  const history = new VerifierPresentationHistory(browser, null, () => `entry-${++sequence}`);
  history.initialize(graphPath);
  const original = history.update({ scroll: { x: 0, y: 412 }, graphScale: 70, graphScroll: { x: 640, y: 96 }, inspectorScroll: { x: 0, y: 180 }, expandedPanels: ["graph:network-context", "graph:options"] });
  // The inspector's first action is the evidence (level 3), and the evidence card opens Forensic (level 4).
  const graphHtml = views(cut, loss).graph;
  assert.match(graphHtml, new RegExp(`<a class="fact-inspector-primary" href="/nr/${loss.nodeKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*>Inspecter la preuve →`));
  assert.doesNotMatch(graphHtml.slice(graphHtml.indexOf('data-fact-inspector="true"')), /href="\/forensic/, "Forensic is not offered at the first inspection level");
  const card = renderToStaticMarkup(createElement(NanoReceiptsView, { graph: cut.graph, text: cut.text, locale: "fr", selection: { eventId: loss.eventId }, links: {}, linksForEntry, network: cut.model }));
  assert.match(card, new RegExp(`href="/forensic/[^"]+"[^>]*>Ouvrir les détails Forensic`));
  history.push(evidencePath); history.update({ scroll: { x: 0, y: 30 } });
  history.push(forensicPath); history.update({ scroll: { x: 0, y: 900 } });
  browser.go(-1); assert.equal(history.restore(browser.path).uiSnapshot.scroll.y, 30, "back returns to the evidence card at its scroll");
  browser.go(-1); const restored = history.restore(browser.path);
  assert.deepEqual(restored, original, "back again restores the graph entry: URL, selection, zoom, scroll and open panels");
  const route = parseVerifierUrl(restored.path);
  assert.ok(route.ok && route.route.kind === "view" && route.route.eventId === loss.eventId && route.route.view === "graph");
  const forensicRoute = parseVerifierUrl(forensicPath);
  assert.ok(forensicRoute.ok && forensicRoute.route.kind === "view");
  assert.notEqual(deterministicVerifierParentPath(forensicRoute.route as VerifierViewRoute), forensicPath, "Forensic never returns to itself");
});

test("I: context-only network NanoReceipts can be hidden from the graph without touching received edges", () => {
  const { graph } = reference;
  const before = JSON.stringify(graph);
  const contextKeys = networkContextNodeKeys(graph);
  assert.deepEqual([...contextKeys].sort(), reference.model.transitions.map(transition => transition.entry.nodeKey).sort());
  const hidden = graphModeDisplay(graph, { mode: "simplified", hideNetworkContext: true });
  const shown = graphModeDisplay(graph, { mode: "simplified" });
  for (const key of contextKeys) {
    assert.ok(!hidden.nodeKeys.has(key), "hidden by default representation");
    assert.ok(shown.nodeKeys.has(key), "still available when the filter is off");
  }
  assert.equal(hidden.hiddenNetworkContext, contextKeys.size);
  const selected = graphModeDisplay(graph, { mode: "causal", hideNetworkContext: true, selectedNodeKey: [...contextKeys][0] });
  assert.ok(selected.nodeKeys.has([...contextKeys][0]!), "an explicitly selected transition stays visible");
  const expert = graphModeDisplay(graph, { mode: "expert", hideNetworkContext: true });
  assert.equal(expert.nodes.length, graph.nodes.length, "Expert keeps the complete received inventory");
  assert.equal(expert.edges.length, 165);
  assert.equal(graph.edges.length, 165);
  assert.equal(JSON.stringify(graph), before, "no received edge or parent is modified");
  assert.equal(graph.edges.some(edge => contextKeys.has(edge.from) && contextKeys.has(edge.to)), false, "no LOST → RESTORED edge exists or is created");
  // A transition that really causes a fact is not context: it stays in the causal graph.
  const explained = JSON.parse(reference.text);
  const lossRef = explained.manifest.memberRefs.find((member: { evidenceId: string }) => member.evidenceId === lossOf(reference).evidenceId);
  const garageRef = explained.manifest.memberRefs.find((member: { eventId: string }) => member.eventId === "d005.garage-arrival");
  garageRef.causalParents = [...garageRef.causalParents, lossRef.evidenceId];
  const explainedText = JSON.stringify(explained);
  const explainedGraph = projectReceivedGraph(inspectReceivedPeb(explainedText), explainedText);
  const explainedKey = explainedGraph.nodes.find(node => node.evidenceId === lossRef.evidenceId)!.key;
  assert.equal(networkContextNodeKeys(explainedGraph).has(explainedKey), false, "a declared causal relation keeps the transition in the graph");
  assert.match(source("InspectionWorkspace.tsx"), /hideNetworkContext: !showNetworkContext/);
  assert.match(source("InspectionWorkspace.tsx"), /"graph:network-context"/, "the choice is part of the restorable view state");
});

test("J: invariants — verdict, PEB, parents, causality, identifiers and network rules are unchanged by reading", () => {
  for (const fixture of [reference, cut]) {
    const graphBefore = JSON.stringify(fixture.graph);
    const catalogBefore = JSON.stringify(fixture.catalog.entries.map(entry => [entry.nodeKey, entry.eventId, entry.nanoReceiptId, entry.evidenceId, entry.causalParentNodeKeys, entry.causalChildNodeKeys]));
    const modelBefore = JSON.stringify({ finalState: fixture.model.finalState, periods: fixture.model.periods.length, reconciliation: fixture.model.reconciliation.status, transitions: fixture.model.transitions.map(item => [item.kind, item.timeMs, item.previousState, item.newState]) });
    for (const entry of [lossOf(fixture), ...fixture.catalog.timelineEntries.slice(0, 3)]) views(fixture, entry);
    renderToStaticMarkup(createElement(RouteVerdict, { locale: "fr", peb: fixture.peb, graph: fixture.graph, snapshot: null, links: {}, catalog: fixture.catalog, network: fixture.model }));
    assert.equal(JSON.stringify(fixture.graph), graphBefore);
    assert.equal(JSON.stringify(fixture.catalog.entries.map(entry => [entry.nodeKey, entry.eventId, entry.nanoReceiptId, entry.evidenceId, entry.causalParentNodeKeys, entry.causalChildNodeKeys])), catalogBefore);
    assert.equal(JSON.stringify({ finalState: fixture.model.finalState, periods: fixture.model.periods.length, reconciliation: fixture.model.reconciliation.status, transitions: fixture.model.transitions.map(item => [item.kind, item.timeMs, item.previousState, item.newState]) }), modelBefore);
    for (const transition of fixture.model.transitions) assert.deepEqual(transition.entry.causalParentNodeKeys, [], "network NRs keep their declared (absent) parents");
  }
  assert.equal(reference.graph.edges.length, 165);
  assert.equal(reference.model.reconciliation.status, "NOT_ESTABLISHED");
  assert.equal(cut.model.finalState, "LOST");
  const verdict = (snapshot: D006VerdictSnapshot | null) => /<h1>([^<]+)<\/h1>/.exec(renderToStaticMarkup(createElement(RouteVerdict, { locale: "fr", peb: reference.peb, graph: reference.graph, snapshot, links: {}, catalog: reference.catalog, network: reference.model })))![1];
  assert.equal(verdict(null), "Non analysé", "no verdict without an analysis");
  assert.equal(verdict({ state: "ANALYZED", transferredContentDigest: reference.peb.transferDigest, identity: {}, result: { verdict: "VALID", completedChecks: [], reasonCodes: [] } } as unknown as D006VerdictSnapshot), "VALID", "the verdict comes only from the analysis bound to these bytes");
  assert.equal(verdict({ state: "ANALYZED", transferredContentDigest: "0".repeat(64), identity: {}, result: { verdict: "VALID", completedChecks: [], reasonCodes: [] } } as unknown as D006VerdictSnapshot), "Non analysé", "an analysis of other bytes is never borrowed");
});

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
import { receivedNetworkModel, networkDuration, offlinePeriodOf } from "../app/verify/receivedNetwork.ts";

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
const { NetworkLanes, NetworkFactSummary, NetworkView } = await import("../app/verify/ReceivedNetworkView.tsx");
const { EventDetailView } = await import("../app/verify/EventDetailView.tsx");
const { NanoReceiptsView } = await import("../app/verify/NanoReceiptsView.tsx");
const { ForensicView } = await import("../app/verify/ForensicView.tsx");
const { FactInspector } = await import("../app/verify/FactInspector.tsx");
componentLoader.deregister();

const artifact = (path: string) => readFileSync(new URL(`../../../artifacts/${path}`, import.meta.url), "utf8");
const visible = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const linksForEntry = (entry: { nodeKey: string }) => ({ event: `/event/${entry.nodeKey}`, nanoreceipts: `/nr/${entry.nodeKey}`, graph: `/graph/${entry.nodeKey}`, forensic: `/forensic/${entry.nodeKey}`, network: "/network" });

function load(text: string) {
  const peb = inspectReceivedPeb(text);
  const graph = projectReceivedGraph(peb, text);
  const catalog = createReceivedEvidenceCatalog(graph, "fr", text);
  return { text, peb, graph, catalog, model: receivedNetworkModel(catalog, text) };
}

type Member = { id: string; eventId: string; timeMs: number; eventType?: string; execution?: string; evidence?: string; parents?: string[]; payload?: Record<string, unknown> };
/** A received PEB shaped like the latest D-006 run: loss at T+00:09.332, return at T+01:24.250. */
function synthetic(members: Member[]) {
  const text = JSON.stringify({
    profile: "fortix.demo.d006.peb.v1", bundleId: "network-fixture",
    manifest: { memberRefs: members.map(member => ({ evidenceId: member.id, receiptId: member.id, eventId: member.eventId, timeMs: member.timeMs,
      producerDomain: member.eventType?.startsWith("NETWORK_") ? "NETWORK" : "Taxi autonomy", causalParents: member.parents ?? [], observedInputs: [],
      source: "RUNTIME_JOURNAL", presentation: "PRESENTED" })) },
    runtimeRecords: members.map(member => ({ receiptId: member.id, eventId: member.eventId, eventType: member.eventType ?? "VEHICLE_ACTION",
      ...(member.execution ? { executionLocality: member.execution } : {}), ...(member.evidence ? { evidenceLocality: member.evidence } : {}),
      payload: member.payload ?? {} })),
  });
  return load(text);
}
const lost = (timeMs: number, adapter = "Intel(R) Ethernet Controller I226-LM"): Member => ({ id: "NR-NET-LOST:a", eventId: "run:network:0001:NETWORK_LINK_LOST", timeMs, eventType: "NETWORK_LINK_LOST", execution: "LOCAL", evidence: "LOCAL",
  payload: { previous_network_state: "CONNECTED", new_network_state: "LOST", adapter_identity: adapter, observation_source: "INTEL_I226_LM_PHYSICAL_SENTINEL" } });
const restored = (timeMs: number): Member => ({ id: "NR-NET-RESTORED:b", eventId: "run:network:0002:NETWORK_LINK_RESTORED", timeMs, eventType: "NETWORK_LINK_RESTORED", execution: "LOCAL", evidence: "LOCAL",
  payload: { previous_network_state: "LOST", new_network_state: "CONNECTED", adapter_identity: "Intel(R) Wi-Fi 7 BE200 320MHz", observation_source: "INTEL_BE200_PHYSICAL_SENTINEL" } });
const fact = (id: string, timeMs: number, execution?: string, evidence?: string, parents?: string[]): Member => ({ id, eventId: `d005.${id}`, timeMs, execution, evidence, parents });

test("A: loss then return before the end of the mission yields NR-NET-LOST then NR-NET-RESTORED in time order", () => {
  const { model } = load(artifact("d006-network-continuity-20261002/peb-after-network-cycle.json"));
  assert.deepEqual(model.transitions.map(item => item.kind), ["LOST", "RESTORED"]);
  assert.ok(model.transitions[0]!.timeMs! < model.transitions[1]!.timeMs!);
  assert.deepEqual(model.transitions.map(item => [item.previousState, item.newState]), [["CONNECTED", "LOST"], ["LOST", "CONNECTED"]]);
  assert.deepEqual(model.transitions.map(item => item.entry.eventLabel), ["Réseau perdu", "Réseau rétabli"]);
  assert.equal(model.periods.length, 1);
  assert.equal(model.periods[0]!.durationMs, 1);
  assert.equal(model.finalState, "CONNECTED");
  const offline = synthetic([fact("start", 0, "LOCAL", "LOCAL"), lost(9332), fact("during", 30000, "LOCAL", "LOCAL"), restored(84250), fact("after", 90000, "LOCAL", "LOCAL")]);
  assert.equal(networkDuration(offline.model.periods[0]!.durationMs!, "fr"), "1 min 14,918 s");
  assert.equal(networkDuration(offline.model.periods[0]!.durationMs!, "en"), "1 min 14.918 s");
});

test("B: loss without return keeps the final state explicitly LOST and invents no RESTORED", () => {
  const { model, catalog } = load(artifact("verifier-ux-completion-20261004/real-cut-incomplete-peb.json"));
  assert.deepEqual(model.transitions.map(item => item.kind), ["LOST"]);
  assert.equal(model.transitions[0]!.entry.eventLabel, "Réseau perdu", "the run-scoped eventId no longer falls back to « Événement déclaré »");
  const period = model.periods[0]!;
  assert.equal(period.restored, null); assert.equal(period.endMs, null); assert.equal(period.durationMs, null);
  assert.equal(period.minimumDurationMs, model.missionEndMs! - period.startMs!);
  assert.equal(model.finalState, "LOST");
  const html = renderToStaticMarkup(createElement(NetworkView, { model, catalog, locale: "fr", linksForEntry }));
  assert.match(visible(html), /Non rétabli avant la fin de la mission/);
  assert.match(visible(html), /Non rétabli dans le PEB/);
  assert.doesNotMatch(html, /data-marker="RESTORED"|data-step="RESTORED"/);
});

test("C: without a declared global loss the Verifier claims neither LOST nor continuous connectivity", () => {
  // The runtime rule itself (Ethernet lost while Wi-Fi works => no global LOST, no NR) is held by
  // network-connectivity.test.ts; here the received PEB simply carries no network transition.
  const { model, catalog } = synthetic([fact("start", 0, "LOCAL", "LOCAL"), fact("switch", 5000, "LOCAL", "LOCAL")]);
  assert.equal(model.transitions.length, 0); assert.equal(model.periods.length, 0); assert.equal(model.finalState, null);
  assert.equal(renderToStaticMarkup(createElement(NetworkLanes, { model, locale: "fr" })), "");
  const html = visible(renderToStaticMarkup(createElement(NetworkView, { model, catalog, locale: "fr", linksForEntry })));
  assert.match(html, /Aucune transition réseau déclarée/);
  assert.doesNotMatch(html, /\bLOST\b|\bCONNECTED\b/);
});

test("D: evidence produced offline stays LOCAL and is never presented as RECONCILED", () => {
  const { model } = synthetic([fact("start", 0, "LOCAL", "LOCAL"), lost(9332), fact("during-a", 20000, "LOCAL", "LOCAL"), fact("during-b", 30000), restored(84250), fact("after", 90000, "LOCAL", "LOCAL")]);
  const period = model.periods[0]!;
  assert.deepEqual(period.entries.map(entry => entry.eventId), ["d005.during-a", "d005.during-b"], "facts are selected by declared time only");
  assert.deepEqual(period.evidence, { LOCAL: 1, RECONCILED: 0, UNDECLARED: 1 });
  assert.deepEqual(period.execution, { LOCAL: 1, REMOTE: 0, UNDECLARED: 1 });
  assert.deepEqual(model.lanes.evidence.map(segment => segment.value), ["LOCAL"]);
});

test("E: a network return without reconciliation is RESTORED with reconciliation NOT ESTABLISHED", () => {
  const { model } = synthetic([fact("start", 0, "LOCAL", "LOCAL"), lost(9332), fact("during", 30000, "LOCAL", "LOCAL"), restored(84250)]);
  assert.equal(model.finalState, "CONNECTED");
  assert.equal(model.periods[0]!.reconciliation.status, "NOT_ESTABLISHED");
  assert.equal(model.periods[0]!.reconciliation.reason, "NO_RECONCILIATION_RECORD");
  const restoredKey = model.transitions[1]!.entry.nodeKey;
  const summary = visible(renderToStaticMarkup(createElement(NetworkFactSummary, { model, nodeKey: restoredKey, locale: "fr" })));
  assert.match(summary, /Réseau|Une voie réseau est de nouveau disponible/);
  assert.match(summary, /Réconciliation non établie/);
  assert.match(summary, /ne prouve pas que les preuves locales ont été réconciliées/);
  // DOCTRINE CHANGE — D-006 in-mission offline reconciliation, 2026-10-08.
  // A reconciliation record plus evidence declared RECONCILED used to read as
  // ESTABLISHED. It no longer does: only a receipt that the PEB's own records
  // bind, confirmed by the analysis of these exact bytes, establishes it (held
  // by tests/d006-inmission-reconciliation.test.ts). A record that names no
  // period, or names one without binding to it, establishes nothing.
  const recordOnly = synthetic([lost(9332), restored(84250), { id: "NR-RECON:c", eventId: "d006d.reconciliation", timeMs: 85000, eventType: "RECONCILIATION_RECEIPT", execution: "LOCAL", evidence: "LOCAL" }]);
  assert.equal(recordOnly.model.reconciliation.status, "NOT_ESTABLISHED");
  assert.equal(recordOnly.model.reconciliation.reason, "NOT_NAMED_BY_RECEIPT");
  const reconciled = synthetic([lost(9332), restored(84250), { id: "NR-RECON:c", eventId: "d006d.reconciliation", timeMs: 85000, eventType: "RECONCILIATION_RECEIPT", execution: "LOCAL", evidence: "RECONCILED" }]);
  assert.equal(reconciled.model.reconciliation.status, "NOT_ESTABLISHED", "declared RECONCILED evidence is no longer enough");
  assert.equal(reconciled.model.reconciliation.reason, "NOT_NAMED_BY_RECEIPT");
  const naming = synthetic([lost(9332), restored(84250), { id: "NR-RECON:c", eventId: "d006d.reconciliation", timeMs: 85000, eventType: "RECONCILIATION_RECEIPT", execution: "LOCAL", evidence: "RECONCILED",
    payload: { offline_window_start_ref: "NR-NET-LOST:a", offline_window_end_ref: "NR-NET-RESTORED:b", reconciliation_result: "IN_MISSION_BASE_COMPARE_TRANSFER_COMPLETE" } }]);
  assert.equal(naming.model.periods[0]!.reconciliation.status, "NOT_ESTABLISHED");
  assert.equal(naming.model.periods[0]!.reconciliation.reason, "RECONCILIATION_UNBOUND", "a receipt the PEB's own records do not bind establishes nothing");
  const namingSummary = visible(renderToStaticMarkup(createElement(NetworkFactSummary, { model: naming.model, nodeKey: naming.model.transitions[1]!.entry.nodeKey, locale: "fr" })));
  assert.match(namingSummary, /Réconciliation non établie/);
  assert.match(namingSummary, /il n’établit rien/);
  assert.doesNotMatch(namingSummary, /Preuves réconciliées/);
});

test("F: network NanoReceipts are causal parents only where the PEB declares it; the network reading adds no edge", () => {
  const reference = load(artifact("d006-network-continuity-20261002/peb-after-network-cycle.json"));
  assert.equal(reference.graph.edges.length, 165);
  for (const transition of reference.model.transitions) {
    assert.deepEqual(transition.entry.causalParentNodeKeys, [], "no parent is declared in the manifest");
    assert.deepEqual(transition.entry.causalChildNodeKeys, [reference.graph.finalKey], "only the Final Receipt is a declared child");
  }
  const before = JSON.stringify(reference.graph.edges);
  receivedNetworkModel(reference.catalog, reference.text);
  assert.equal(JSON.stringify(reference.graph.edges), before);
  const offline = synthetic([fact("start", 0), lost(9332), fact("during", 30000), restored(84250)]);
  const lostKey = offline.model.transitions[0]!.entry.nodeKey;
  const duringKey = offline.catalog.entries.find(entry => entry.eventId === "d005.during")!.nodeKey;
  assert.ok(!offline.graph.edges.some(edge => edge.from === lostKey && edge.to === duringKey), "temporal context is not causal parenthood");
  assert.equal(offlinePeriodOf(offline.model, duringKey)?.index, 1);
  const explained = synthetic([fact("start", 0), lost(9332), fact("fallback", 9400, "LOCAL", "LOCAL", ["NR-NET-LOST:a"])]);
  assert.ok(explained.graph.edges.some(edge => edge.causal && edge.from === explained.model.transitions[0]!.entry.nodeKey), "a declared parent is kept");
});

test("G: each network NanoReceipt is understandable without opening Forensic", () => {
  const { graph, peb, text, catalog, model } = load(artifact("d006-network-continuity-20261002/peb-after-network-cycle.json"));
  const [loss, ret] = model.transitions;
  const lossHtml = renderToStaticMarkup(createElement(EventDetailView, { graph, peb, text, locale: "fr", selection: { eventId: loss!.entry.eventId }, links: {}, linksForEntry, network: model }));
  const lossText = visible(lossHtml);
  assert.match(lossText, /Réseau perdu Aucune voie réseau disponible\. La mission poursuit son exécution selon les capacités locales disponibles\./);
  assert.match(lossText, /Preuve NanoReceipt · Réseau/);
  assert.match(lossText, /Transition CONNECTED → LOST/);
  assert.match(lossText, /Domaine Sentinelle réseau/);
  assert.match(lossText, /Voie concernée Intel\(R\) Ethernet Controller I226-LM/);
  // This reference run injected its transitions by audit script: provenance is shown as such, never upgraded.
  assert.match(lossText, /Provenance SIMULÉ · Script d’audit/);
  assert.doesNotMatch(lossText, /Le runtime déclare avoir observé/);
  assert.equal(lossText.match(/SIMULÉ · Script d’audit/g)?.length, 1, "the provenance label is stated once");
  const cut = load(artifact("verifier-ux-completion-20261004/real-cut-incomplete-peb.json"));
  const cutLoss = cut.model.transitions[0]!.entry;
  const cutHtml = renderToStaticMarkup(createElement(EventDetailView, { graph: cut.graph, peb: cut.peb, text: cut.text, locale: "fr", selection: { eventId: cutLoss.eventId }, links: {}, linksForEntry, network: cut.model }));
  // RUNTIME stays explicit; why it is not independent corroboration is one click away, never a permanent paragraph.
  assert.match(visible(cutHtml), /Provenance RUNTIME · Déclaré dans le PEB Comprendre cette provenance Le runtime déclare avoir observé cette transition\. Cette vue ne contient pas de corroboration externe indépendante\./);
  assert.match(cutHtml, /<details><summary>Comprendre cette provenance<\/summary><p>Le runtime déclare avoir observé cette transition\./);
  assert.match(visible(cutHtml), /non rétablie dans le PEB/);
  assert.equal(visible(renderToStaticMarkup(createElement(NetworkFactSummary, { model: cut.model, nodeKey: cutLoss.nodeKey, locale: "fr" }))).includes("Provenance"), false, "the network block leaves provenance to its host");
  assert.ok(lossHtml.indexOf("network-fact") < lossHtml.indexOf("Détails techniques"), "technical details follow the human reading");
  assert.doesNotMatch(lossHtml, /<details class="network-fact-technical" open/);
  const retText = visible(renderToStaticMarkup(createElement(EventDetailView, { graph, peb, text, locale: "fr", selection: { eventId: ret!.entry.eventId }, links: {}, linksForEntry, network: model })));
  assert.match(retText, /Réseau rétabli Une voie réseau est de nouveau disponible\./);
  assert.match(retText, /Transition LOST → CONNECTED/);
  assert.match(retText, /Réconciliation non établie/);
  const cards = visible(renderToStaticMarkup(createElement(NanoReceiptsView, { graph, text, locale: "fr", selection: {}, links: {}, linksForEntry, network: model })));
  assert.match(cards, /Réseau perdu.*Aucune voie réseau disponible.*CONNECTED → LOST/);
  assert.equal(catalog.entries.filter(entry => entry.eventLabel === "Événement déclaré").length, 0);
});

test("H: Forensic Inspect opens the human reading of the unit, and states an unavailable reading explicitly", () => {
  const { graph, peb, text, catalog } = load(artifact("d006-network-continuity-20261002/peb-after-network-cycle.json"));
  const html = renderToStaticMarkup(createElement(ForensicView, { graph, peb, text, locale: "fr", selection: {}, links: {}, linksForEntry }));
  const hrefs = [...html.matchAll(/<a href="([^"]+)" data-forensic-inspect="true">Inspecter<\/a>/g)].map(match => match[1]);
  assert.equal(hrefs.length, catalog.entries.length);
  assert.ok(hrefs.every(href => !href!.startsWith("/forensic/")), "Inspect never points back to Forensic");
  const loss = catalog.entries.find(entry => entry.eventLabel === "Réseau perdu")!;
  assert.ok(hrefs.includes(`/event/${loss.nodeKey}`));
  const outside = catalog.entries.find(entry => entry.timelinePosition === null)!;
  assert.ok(hrefs.includes(`/nr/${outside.nodeKey}`));
  const none = renderToStaticMarkup(createElement(ForensicView, { graph, peb, text, locale: "fr", selection: {}, links: {}, linksForEntry: () => ({}) }));
  assert.match(visible(none), /Indisponible : aucune vue de lecture ne résout cette unité/);
});

test("I: the French inspector reads « Connecté » only where the declared transitions establish CONNECTED at the fact's time; the English is unchanged", () => {
  const networkRow = (html: string) => { const at = html.indexOf("data-network-position="); return at < 0 ? null : visible(html.slice(at, html.indexOf("</div>", at))); };
  const inspect = (fixture: ReturnType<typeof synthetic>, id: string, locale: "en" | "fr") => {
    const entry = fixture.catalog.entries.find(item => item.evidenceId === id)!;
    return renderToStaticMarkup(createElement(FactInspector, { entry, catalog: fixture.catalog, network: fixture.model, locale, context: "event", linksForEntry }));
  };
  // Declared CONNECTED: before the first loss (its previous state) and after the return (its new state).
  const declared = synthetic([fact("NR-ACTION:early", 5000), lost(9332), fact("NR-ACTION:offline", 20000), restored(84250), fact("NR-ACTION:late", 90000)]);
  for (const id of ["NR-ACTION:early", "NR-ACTION:late"]) {
    const fr = inspect(declared, id, "fr");
    assert.match(fr, /data-network-position="OUTSIDE"/, id);
    assert.match(networkRow(fr)!, /Réseau Connecté/, id);
    assert.doesNotMatch(fr, /Hors période hors ligne déclarée/, id);
    assert.match(networkRow(inspect(declared, id, "en"))!, /Network Outside any declared offline period/, `${id}: the English wording is unchanged`);
  }
  const offline = networkRow(inspect(declared, "NR-ACTION:offline", "fr"))!;
  assert.match(offline, /Pendant la période hors ligne n°1/);
  assert.doesNotMatch(offline, /Connecté/, "a fact inside the period is never connected");

  // Not established: the first transition does not declare the state before it.
  const undeclaredBefore = synthetic([fact("NR-ACTION:early", 5000), { ...lost(9332), payload: { new_network_state: "LOST", adapter_identity: "Intel(R) Ethernet Controller I226-LM", observation_source: "INTEL_I226_LM_PHYSICAL_SENTINEL" } }, restored(84250)]);
  assert.match(networkRow(inspect(undeclaredBefore, "NR-ACTION:early", "fr"))!, /Hors période hors ligne déclarée/);
  assert.doesNotMatch(inspect(undeclaredBefore, "NR-ACTION:early", "fr"), /Connecté/, "no declared CONNECTED, no « Connecté »");
  // Not established: the last transition before the fact does not declare CONNECTED.
  const undeclaredAfter = synthetic([lost(9332), { ...restored(84250), payload: { previous_network_state: "LOST", adapter_identity: "Intel(R) Wi-Fi 7 BE200 320MHz", observation_source: "INTEL_BE200_PHYSICAL_SENTINEL" } }, fact("NR-ACTION:late", 90000)]);
  assert.match(networkRow(inspect(undeclaredAfter, "NR-ACTION:late", "fr"))!, /Hors période hors ligne déclarée/);
  // Not established: a fact without a declared time is never placed in a network state.
  const undated = synthetic([lost(9332), restored(84250), { ...fact("NR-ACTION:undated", 0), timeMs: undefined as unknown as number }]);
  const undatedRow = networkRow(inspect(undated, "NR-ACTION:undated", "fr"));
  assert.ok(undatedRow === null || !/Connecté/.test(undatedRow), "an undated fact is never « Connecté »");
  // Not established: declared times run backwards (the loss is journaled first, the return carries an earlier time),
  // so no period holds the late fact, yet by time the last transition before it is the loss.
  const inverted = synthetic([lost(20000), restored(6000), fact("NR-ACTION:late", 90000)]);
  const invertedRow = inspect(inverted, "NR-ACTION:late", "fr");
  assert.match(invertedRow, /data-network-position="OUTSIDE"/);
  assert.match(networkRow(invertedRow)!, /Hors période hors ligne déclarée/);
  assert.doesNotMatch(invertedRow, /Connecté/, "an inconsistent declared order never reads « Connecté »");
  // Not established: an entry no period holds (an unnamed reconciliation receipt) declared at the very time of the loss.
  const sameTime = synthetic([lost(9332), { ...fact("NR-RECON:unnamed", 9332), eventType: "RECONCILIATION_RECEIPT" }, restored(84250)]);
  const sameTimeRow = inspect(sameTime, "NR-RECON:unnamed", "fr");
  assert.match(sameTimeRow, /data-network-position="OUTSIDE"/);
  assert.doesNotMatch(sameTimeRow, /Connecté/, "a fact at the instant of a transition is never « Connecté »");
  // No declared transition at all: the inspector claims no network state, connected or not.
  const silent = synthetic([fact("NR-ACTION:early", 5000), fact("NR-ACTION:late", 90000)]);
  assert.equal(networkRow(inspect(silent, "NR-ACTION:early", "fr")), null);
  assert.doesNotMatch(inspect(silent, "NR-ACTION:early", "fr"), /Connecté/);
});

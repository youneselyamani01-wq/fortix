import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (name: string) => readFileSync(new URL(`../app/verify/${name}`, import.meta.url), "utf8");

test("NanoReceipts names filtered totals, families, domains, and positions", () => {
  const view = source("NanoReceiptsView.tsx");
  assert.match(view, /\$\{filtered\.length\} unités de preuve correspondent au filtre sur \$\{catalog\.entries\.length\} reçues/);
  assert.match(view, /\$\{filtered\.length\} evidence items match the filter of \$\{catalog\.entries\.length\} received/);
  assert.match(view, /\{entry\.receipt\.title\} · \{entry\.familyLabel \?\? \(fr \? "Famille non résolue"/);
  assert.match(view, /Domaine producteur :/);
  assert.match(view, /Position dans la Timeline/);
  assert.match(view, /position} sur \$\{length} éléments/);
  assert.match(view, /Position dans la famille/);
  assert.doesNotMatch(view, /\{filtered\.length\}\s*\/\s*\{catalog\.entries\.length\}/);
  assert.doesNotMatch(view, /\{entry\.timelinePosition\}\s*\/\s*\{entry\.timelineLength\}/);
});

test("Event and Timeline qualify every position and neighbour count", () => {
  const event = source("EventDetailView.tsx");
  const inspector = source("FactInspector.tsx");
  const timeline = source("EvidenceTimeline.tsx");
  // The event view reads its position through the shared inspector.
  assert.match(event, /<FactInspector /);
  assert.match(inspector, /Étape \$\{entry\.timelinePosition\} \/ \$\{entry\.timelineLength\} de la Timeline/);
  assert.match(inspector, /Step \$\{entry\.timelinePosition\} \/ \$\{entry\.timelineLength\} in the Timeline/);
  assert.match(event, /\$\{relationEntries\.length\} référence.*directe.*reçue/);
  assert.match(event, /\$\{relationEntries\.length\} received direct reference/);
  assert.doesNotMatch(event, /relationEntries\.length.*"événements"/);
  assert.match(timeline, /éléments dans la Timeline/);
  assert.match(timeline, /Aucune sélection parmi/);
  assert.doesNotMatch(timeline, /`0 sur \$\{entries\.length\}`/);
});

test("Graph separates units, resolved links, and received declarations", () => {
  const graph = source("InspectionWorkspace.tsx");
  assert.match(graph, /declarationCount = graph\.edges\.reduce/);
  assert.match(graph, /liens source→cible résolus/);
  assert.match(graph, /déclarations de relation reçues/);
  assert.match(graph, /unités affichées sur/);
  assert.match(graph, /liens affichés sur/);
  assert.match(graph, /déclarations affichées sur/);
  assert.match(graph, /unités reçues par famille/);
  assert.match(graph, /Explorer les domaines traversés →/);
  assert.match(graph, /\$\{boundaries\.length\} groupes de passages et de contexte/);
  assert.match(graph, /liens reçus portent/);
  assert.match(graph, /edge\.crossings\.map\(crossingLabel\)/);
  assert.doesNotMatch(graph, /`NR \$\{String\(node\.member\.index/);
  assert.doesNotMatch(graph, /02 \/ \$\{c\.context\}/);
  assert.doesNotMatch(graph, /result\.completedChecks\.map\(check/);
  assert.doesNotMatch(graph, /`\$\{crossing\.kind\}: \$\{crossing\.from\.value\}/);
});

test("Forensic keeps technical identifiers while qualifying numeric fields", () => {
  const forensic = source("ForensicView.tsx");
  assert.match(forensic, /octets UTF-8 reçus/);
  assert.match(forensic, /manifest\.memberRefs\.length · membres reçus/);
  assert.match(forensic, /Position dans le Manifest/);
  assert.match(forensic, /Position dans la Timeline/);
  assert.match(forensic, /liens reçus touchent|lien reçu touche/);
  assert.match(forensic, /touchingDeclarations/);
  assert.match(forensic, /membres reçus/);
});

test("first-level labels do not reconstruct amounts or fall back to raw identifiers", () => {
  const labels = source("receivedLabels.ts");
  const catalog = source("receivedEvidenceCatalog.ts");
  const timeline = source("EvidenceTimeline.tsx");
  const path = source("ReceivedPathOverview.tsx");
  const domains = source("ReceivedDomainsOverview.tsx");
  const graph = source("InspectionWorkspace.tsx");
  const guided = source("GuidedEventInspector.tsx");
  const workspace = source("VerifierWorkspace.tsx");

  assert.match(labels, /master-invoice-1850.*issues an invoice.*émet une facture/);
  assert.doesNotMatch(labels, /master-invoice-1850.*(?:€1,850|1 850 €)/);
  assert.match(labels, /AUTONOMOUS_VEHICLE: \["Autonomous vehicle", "Véhicule autonome"\]/);
  assert.doesNotMatch(catalog, /node\.context\.label\?\.value \?\? eventId/);
  for (const view of [timeline, path, domains, graph, guided]) {
    assert.doesNotMatch(view, /node\.context\.label\?\.value \?\? node\.member\?\.eventId/);
  }
  assert.doesNotMatch(workspace, /<code>\{(?:check|reason)\}<\/code>/);
  assert.doesNotMatch(workspace, /String\(index \+ 1\)\.padStart/);
});

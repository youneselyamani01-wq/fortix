import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { inspectReceivedPeb } from "../app/verify/inspectReceivedPeb.ts";
import { projectReceivedGraph } from "../app/verify/receivedGraph.ts";
import { createReceivedEvidenceCatalog } from "../app/verify/receivedEvidenceCatalog.ts";
import { normalizeBusinessSearch, searchVerifierFacts } from "../app/verify/searchReceivedFacts.ts";

const text = readFileSync(new URL("../../../artifacts/d006-network-continuity-20261002/peb-after-network-cycle.json", import.meta.url), "utf8");
const graph = projectReceivedGraph(inspectReceivedPeb(text), text);
const catalog = createReceivedEvidenceCatalog(graph, "fr", text);

test("business network search puts facts before domains, NanoReceipts and technical references", () => {
  const result = searchVerifierFacts(catalog, "réseau");
  assert.equal(result[0]!.kind, "event");
  assert.ok(result.some(result => result.entry?.eventId?.startsWith("d006d.network-link-lost:") && result.kind === "event"));
  assert.ok(result.some(result => result.kind === "domain"));
  assert.ok(result.some(result => result.kind === "nanoreceipt"));
  const rank = { event: 0, domain: 1, nanoreceipt: 2, forensic: 3 };
  assert.ok(result.every((result, index, all) => !index || rank[all[index - 1]!.kind] <= rank[result.kind]));
});

test("human aliases find a dropped-off passenger without knowing an event ID", () => {
  const result = searchVerifierFacts(catalog, "passager déposé");
  assert.equal(result[0]!.entry?.eventId, "d005.dropoff-confirmed");
  assert.equal(result[0]!.kind, "event");
  assert.equal(searchVerifierFacts(catalog, "PASSAGER DEPOSE")[0]!.entry?.eventId, result[0]!.entry?.eventId);
});

test("support objects and compiled dossiers cannot appear among narrative search facts", () => {
  for (const query of ["paiement", "maintenance", "causale", "temps"]) {
    assert.ok(searchVerifierFacts(catalog, query).filter(result => result.kind === "event").every(result => result.entry?.timelinePosition !== null));
  }
  assert.equal(searchVerifierFacts(catalog, "paiement").filter(result => result.kind === "event").some(result => result.entry?.eventId === "d005m.receipt.master-payment"), false);
});

test("internal references are searchable through a named Forensic destination only", () => {
  const result = searchVerifierFacts(catalog, "M28");
  assert.equal(result.length, 1);
  assert.equal(result[0]!.kind, "forensic");
  assert.equal(result[0]!.entry?.manifestPosition, 28);
});

test("empty and unmatched searches do not invent a result or change evidence", () => {
  const before = JSON.stringify(graph);
  assert.deepEqual(searchVerifierFacts(catalog, ""), []);
  assert.deepEqual(searchVerifierFacts(catalog, "aucun-fait-inexistant"), []);
  assert.equal(normalizeBusinessSearch("  Réseau — Garage  "), "reseau garage");
  assert.equal(JSON.stringify(graph), before);
});

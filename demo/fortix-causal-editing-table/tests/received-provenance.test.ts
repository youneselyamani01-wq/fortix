import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { transferredContentDigest } from "../app/portableMissionEvidence.ts";
import { inspectReceivedPeb } from "../app/verify/inspectReceivedPeb.ts";
import { projectReceivedGraph } from "../app/verify/receivedGraph.ts";
import { createReceivedEvidenceCatalog } from "../app/verify/receivedEvidenceCatalog.ts";
import { AUDITED_NETWORK_PACKAGE_DIGEST, receivedFactProvenance, factProvenanceDescription, factProvenanceLabel } from "../app/verify/receivedProvenance.ts";

const reference = readFileSync(new URL("../../../artifacts/d006-network-continuity-20261002/peb-after-network-cycle.json", import.meta.url), "utf8");
function received(raw: string) {
  const peb = inspectReceivedPeb(raw);
  const graph = projectReceivedGraph(peb, raw);
  return { peb, graph, catalog: createReceivedEvidenceCatalog(graph, "fr", raw) };
}
function runtime(recordPatch: Record<string, unknown> = {}, duplicates = false) {
  const record = { receiptId: "NR-one", eventId: "event-one", eventType: "NETWORK_LINK_LOST", payload: { observation_source: "INTEL_I226_LM_PHYSICAL_SENTINEL" }, ...recordPatch };
  return JSON.stringify({ runtimeRecords: duplicates ? [record, record] : [record], manifest: { memberRefs: [{ evidenceId: "NR-one", receiptId: "NR-one", eventId: "event-one", source: "RUNTIME_JOURNAL", presentation: "PRESENTED", producerDomain: "NETWORK", causalParents: [], observedInputs: [] }] } });
}

test("audit transitions are simulated even when they declare a physical sentinel", () => {
  assert.equal(transferredContentDigest(reference), AUDITED_NETWORK_PACKAGE_DIGEST);
  const { catalog, graph } = received(reference);
  const before = JSON.stringify(graph);
  const network = catalog.entries.filter(entry => entry.domainId === "NETWORK");
  assert.equal(network.length, 2);
  for (const entry of network) {
    assert.equal(entry.provenance.category, "SIMULATED");
    assert.equal(entry.provenance.basis, "AUDITED_SCRIPT");
    assert.equal(entry.provenance.physicalObservationEstablished, false);
    assert.match(factProvenanceDescription(entry.provenance, "fr"), /injectée.*script d’audit/);
  }
  assert.equal(catalog.entries.length, 71);
  assert.equal(graph.edges.length, 165);
  assert.equal(graph.edges.reduce((sum, edge) => sum + edge.declarations.length, 0), 223);
  assert.equal(JSON.stringify(graph), before);
});

test("formatting a known package cannot disguise its scripted origin", () => {
  const formatted = JSON.stringify(JSON.parse(reference));
  assert.notEqual(transferredContentDigest(formatted), AUDITED_NETWORK_PACKAGE_DIGEST);
  const network = received(formatted).catalog.entries.filter(entry => entry.domainId === "NETWORK");
  assert.ok(network.every(entry => entry.provenance.source === "audit_script"));
});

test("changed package fields no longer qualify for the audited origin", () => {
  const parsed = JSON.parse(reference);
  parsed.runtimeRecords.find((record: { eventType: string }) => record.eventType === "NETWORK_LINK_LOST").payload.observation_source = "different-source";
  const entry = received(JSON.stringify(parsed)).catalog.entries.find(entry => entry.eventId === "d006d.network-link-lost:3e040bfb16c0f41b")!;
  assert.equal(entry.provenance.category, "RUNTIME");
  assert.equal(entry.provenance.basis, "DECLARED_SOURCE");
  assert.equal(entry.provenance.physicalObservationEstablished, false);
});

test("a physical source string is a runtime declaration, not proof of real observation", () => {
  const { catalog } = received(runtime());
  assert.equal(catalog.entries[0]!.provenance.category, "RUNTIME");
  assert.match(factProvenanceLabel(catalog.entries[0]!.provenance, "fr"), /Déclaré/);
  assert.match(factProvenanceDescription(catalog.entries[0]!.provenance, "fr"), /ne suffit pas/);
});

test("explicit simulation and replay markers take priority over a runtime storage source", () => {
  assert.equal(received(runtime({ payload: { evidence_class: "DEMONSTRATION_RUNTIME", observation_source: "physical-sentinel" } })).catalog.entries[0]!.provenance.category, "SIMULATED");
  assert.equal(received(runtime({ provenance: "REPLAY" })).catalog.entries[0]!.provenance.category, "REPLAY");
});

test("missing, ambiguous or contradictory source objects never receive a guessed provenance", () => {
  assert.equal(received(runtime({}, true)).catalog.entries[0]!.provenance.category, "UNKNOWN");
  assert.equal(received(runtime({ eventId: "another-event" })).catalog.entries[0]!.provenance.category, "UNKNOWN");
  const { graph } = received(runtime());
  assert.equal(receivedFactProvenance(graph.nodes[0]!).category, "UNKNOWN");
  assert.equal(receivedFactProvenance(graph.nodes[0]!, "not JSON").category, "UNKNOWN");
});

test("demo fixtures, simulation runtime and final assembly expose stable distinct origins", () => {
  const { catalog } = received(reference);
  assert.equal(catalog.entries.find(entry => entry.eventId === "d005.passenger-request")!.provenance.source, "demo_fixture");
  assert.equal(catalog.entries.find(entry => entry.eventId === "d006g.bank-confirmation")!.provenance.source, "demo_runtime");
  assert.equal(catalog.entries.find(entry => entry.node.final)!.provenance.category, "COMPILED");
  assert.ok(catalog.entries.every(entry => entry.provenance.category !== "UNKNOWN"));
});

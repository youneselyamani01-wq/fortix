import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import type { ReceivedMember, ReceivedPebProjection, ReceivedRelation } from "../app/verify/inspectReceivedPeb.ts";
import { projectReceivedGraph } from "../app/verify/receivedGraph.ts";
import {
  createReceivedEvidenceCatalog,
  receivedEvidenceCausalNeighbours,
  receivedEvidenceFamilyKeys,
  resolveReceivedEvidenceSelection,
} from "../app/verify/receivedEvidenceCatalog.ts";

type JsonObject = Record<string, unknown>;
const object = (value: unknown): JsonObject => value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
const string = (value: unknown): string | null => typeof value === "string" ? value : null;
const number = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : null;

/** Test adapter: it preserves the received arrays and references and performs no inference. */
function receivedProjection(raw: string): ReceivedPebProjection {
  const root = object(JSON.parse(raw));
  const identity = object(root.identity);
  const manifest = object(root.manifest);
  const finalReceipt = object(root.finalReceipt);
  const finalIdentity = object(finalReceipt.identity);
  const refs = Array.isArray(manifest.memberRefs) ? manifest.memberRefs : [];
  const members: ReceivedMember[] = refs.map((value, index) => {
    const member = object(value);
    return {
      index,
      evidenceId: string(member.evidenceId), receiptId: string(member.receiptId), eventId: string(member.eventId),
      digest: string(member.digest), producerDomain: string(member.producerDomain), source: string(member.source),
      presentation: string(member.presentation), assurance: string(member.assurance), timeMs: number(member.timeMs),
    };
  });
  const evidenceIds = new Set(members.flatMap((member) => member.evidenceId ? [member.evidenceId] : []));
  const relations: ReceivedRelation[] = [];
  refs.forEach((value, index) => {
    const member = object(value);
    const destination = string(member.evidenceId);
    for (const [field, kind] of [["causalParents", "CAUSAL_PARENT"], ["observedInputs", "OBSERVED_INPUT"]] as const) {
      const values = Array.isArray(member[field]) ? member[field] : [];
      values.forEach((item, relationIndex) => {
        const source = string(item);
        relations.push({
          kind,
          path: `manifest.memberRefs[${index}].${field}[${relationIndex}]`,
          from: source,
          to: destination,
          referenceStatus: source && destination && evidenceIds.has(source) && evidenceIds.has(destination) ? "PRESENT" : "UNRESOLVED",
        });
      });
    }
  });
  const finalReceiptId = string(finalReceipt.receiptId);
  const finalInputs = Array.isArray(finalReceipt.causalInputEvidenceIds) ? finalReceipt.causalInputEvidenceIds : [];
  finalInputs.forEach((item, index) => {
    const source = string(item);
    relations.push({ kind: "FINAL_RECEIPT_INPUT", path: `finalReceipt.causalInputEvidenceIds[${index}]`, from: source, to: finalReceiptId, referenceStatus: source && finalReceiptId && evidenceIds.has(source) ? "PRESENT" : "UNRESOLVED" });
  });
  return {
    parseStatus: "OBJECT",
    profile: string(root.profile), knownProfile: root.profile === "fortix.demo.d006.peb.v1", bundleId: string(root.bundleId),
    transferDigest: "0".repeat(64), byteLength: new TextEncoder().encode(raw).byteLength,
    memberCount: refs.length, finalReceiptId, manifestDigest: string(manifest.bundleDigest),
    identity: { missionId: string(identity.missionId), runId: string(identity.runId) },
    finalReceipt: finalReceiptId ? {
      profile: string(finalReceipt.profile), eventId: string(finalReceipt.eventId), receiptId: finalReceiptId,
      missionId: string(finalIdentity.missionId), runId: string(finalIdentity.runId),
      evidenceSetDigest: string(finalReceipt.evidenceSetDigest), issuedAtMasterTimeMs: number(finalReceipt.issuedAtMasterTimeMs),
    } : null,
    members, relations, issues: [],
  };
}

const artifactUrl = new URL(
  "../../../artifacts/d006-network-continuity-20261002/peb-after-network-cycle.json",
  import.meta.url,
);

test("the catalog derives the exact eleven-family D-006 inventory without manufacturing an item", () => {
  const raw = readFileSync(artifactUrl, "utf8");
  const graph = projectReceivedGraph(receivedProjection(raw), raw);
  const before = JSON.stringify(graph);
  const catalog = createReceivedEvidenceCatalog(graph, "en");

  assert.deepEqual(receivedEvidenceFamilyKeys, [
    "passenger", "navigation", "traffic", "garage", "maintenance", "human",
    "payment", "network", "compilation", "final", "support",
  ]);
  assert.equal(catalog.entries.length, 71);
  assert.equal(catalog.timelineEntries.length, 59);
  assert.deepEqual(Object.fromEntries(catalog.families.map((family) => [family.key, family.entries.length])), {
    passenger: 7,
    navigation: 11,
    traffic: 18,
    garage: 2,
    maintenance: 6,
    human: 4,
    payment: 8,
    network: 2,
    compilation: 2,
    final: 1,
    support: 10,
  });
  const garageDomain = catalog.domains.find((domain) => domain.id === "Garage");
  assert.equal(garageDomain?.entries.length, 5, "Garage producer domain must contain five received evidence items");
  assert.deepEqual(garageDomain?.entries.map((entry) => entry.eventId), [
    "d005.garage-arrival",
    "d005.garage-received",
    "d005.maintenance-executed",
    "d005.maintenance-completed",
    "d005m.master-invoice-1850",
  ]);
  assert.equal(catalog.families.find((family) => family.key === "garage")?.entries.length, 2, "Garage editorial family must contain two items");
  assert.equal(catalog.issues.length, 0);
  assert.equal(catalog.entries.filter((entry) => entry.nanoReceiptId !== null).length, 60);
  assert.equal(catalog.entries.filter((entry) => entry.receipt.kind === "SUPPORT").length, 10);
  assert.equal(catalog.entries.filter((entry) => entry.receipt.kind === "FINAL_RECEIPT").length, 1);
  assert.equal(JSON.stringify(graph), before, "catalog projection must not mutate the received graph");
});

test("every delivered NanoReceipt resolves to one event, one domain and the same received member", () => {
  const raw = readFileSync(artifactUrl, "utf8");
  const graph = projectReceivedGraph(receivedProjection(raw), raw);
  const catalog = createReceivedEvidenceCatalog(graph, "fr");
  const receipts = catalog.entries.filter((entry) => entry.nanoReceiptId !== null);

  for (const entry of receipts) {
    assert.ok(entry.eventId);
    assert.ok(entry.evidenceId);
    assert.ok(entry.domainId);
    assert.ok(entry.family);
    const resolution = resolveReceivedEvidenceSelection(catalog, {
      eventId: entry.eventId,
      nanoReceiptId: entry.nanoReceiptId,
      evidenceId: entry.evidenceId,
      domainId: entry.domainId,
      family: entry.family,
    });
    assert.equal(resolution.status, "RESOLVED");
    assert.equal(resolution.scope, "NODE");
    assert.equal(resolution.entry?.nodeKey, entry.nodeKey);
  }
  assert.deepEqual(
    catalog.timelineEntries.map((entry) => entry.timelinePosition),
    Array.from({ length: 59 }, (_, index) => index + 1),
  );
  for (const entry of catalog.entries) {
    for (const childKey of entry.causalChildNodeKeys) {
      assert.ok(catalog.entries.find((candidate) => candidate.nodeKey === childKey)?.causalParentNodeKeys.includes(entry.nodeKey));
    }
  }
});

test("strict resolution reports missing, ambiguous and contradictory selections without first-match fallback", () => {
  const raw = readFileSync(artifactUrl, "utf8");
  const graph = projectReceivedGraph(receivedProjection(raw), raw);
  const catalog = createReceivedEvidenceCatalog(graph, "en");
  const first = catalog.entries.find((entry) => entry.nanoReceiptId && entry.eventId && entry.domainId)!;
  const second = catalog.entries.find((entry) => entry.nanoReceiptId && entry.eventId && entry.nodeKey !== first.nodeKey)!;

  assert.deepEqual(resolveReceivedEvidenceSelection(catalog, {}).status, "EMPTY");
  assert.deepEqual(resolveReceivedEvidenceSelection(catalog, { eventId: "not.received" }).status, "NOT_FOUND");
  assert.deepEqual(resolveReceivedEvidenceSelection(catalog, { eventId: first.eventId, nanoReceiptId: second.nanoReceiptId }).status, "CONTRADICTORY");
  assert.deepEqual(resolveReceivedEvidenceSelection(catalog, { evidenceId: first.evidenceId, domainId: second.domainId }).status, first.domainId === second.domainId ? "RESOLVED" : "CONTRADICTORY");

  const duplicateCatalog = {
    ...catalog,
    entries: Object.freeze([...catalog.entries, Object.freeze({ ...first, nodeKey: "duplicate:test" })]),
  };
  const ambiguous = resolveReceivedEvidenceSelection(duplicateCatalog, { eventId: first.eventId });
  assert.equal(ambiguous.status, "AMBIGUOUS");
  assert.equal(ambiguous.entry, null);
  assert.equal(ambiguous.candidates.length, 0);
});

test("network adjacency remains temporal only when the PEB declares no edge", () => {
  const raw = readFileSync(artifactUrl, "utf8");
  const graph = projectReceivedGraph(receivedProjection(raw), raw);
  const catalog = createReceivedEvidenceCatalog(graph, "en");
  const network = catalog.families.find((family) => family.key === "network")!.entries;
  const lost = network.find((entry) => entry.eventId?.startsWith("d006d.network-link-lost:"))!;
  const restored = network.find((entry) => entry.eventId?.startsWith("d006d.network-link-restored:"))!;

  assert.equal(restored.timelinePosition, (lost.timelinePosition ?? 0) + 1);
  assert.equal(lost.causalChildNodeKeys.includes(restored.nodeKey), false);
  assert.equal(restored.causalParentNodeKeys.includes(lost.nodeKey), false);
});

test("direct-neighbour projection exposes received identities and never promotes timeline adjacency", () => {
  const raw = readFileSync(artifactUrl, "utf8");
  const graph = projectReceivedGraph(receivedProjection(raw), raw);
  const catalog = createReceivedEvidenceCatalog(graph, "en");
  const connected = catalog.entries.find((entry) => entry.causalParentNodeKeys.length > 0 && entry.causalChildNodeKeys.length > 0)!;
  const neighbours = receivedEvidenceCausalNeighbours(catalog, connected);

  assert.deepEqual(neighbours.parents.map((entry) => entry.nodeKey), connected.causalParentNodeKeys);
  assert.deepEqual(neighbours.children.map((entry) => entry.nodeKey), connected.causalChildNodeKeys);
  for (const entry of [...neighbours.parents, ...neighbours.children]) {
    assert.ok(entry.receipt.display, "every displayed direct neighbour has a deterministic evidence label");
    assert.ok(entry.eventLabel, "every displayed direct neighbour has a human event identity");
  }

  const network = catalog.families.find((family) => family.key === "network")!.entries;
  const lost = network.find((entry) => entry.eventId?.startsWith("d006d.network-link-lost:"))!;
  const restored = network.find((entry) => entry.eventId?.startsWith("d006d.network-link-restored:"))!;
  const lostNeighbours = receivedEvidenceCausalNeighbours(catalog, lost);
  assert.equal(lostNeighbours.children.some((entry) => entry.nodeKey === restored.nodeKey), false);
});

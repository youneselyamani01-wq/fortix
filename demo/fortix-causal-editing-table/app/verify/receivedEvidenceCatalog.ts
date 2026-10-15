import { receivedTimelineNodes } from "./guidedInspection.ts";
import { receivedEventLabel, receivedProducerLabel } from "./receivedLabels.ts";
import type { ReceivedGraph, ReceivedGraphNode } from "./receivedGraph.ts";
import { receivedReceiptLabel, type ReceivedReceiptLabel } from "./receivedReceiptLabels.ts";
import { receivedFactProvenance, type FactProvenance } from "./receivedProvenance.ts";

export const receivedEvidenceFamilyKeys = [
  "passenger",
  "navigation",
  "traffic",
  "garage",
  "maintenance",
  "human",
  "payment",
  "network",
  "compilation",
  "final",
  "support",
] as const;

export type ReceivedEvidenceFamilyKey = typeof receivedEvidenceFamilyKeys[number];

const familyEvents: Readonly<Record<Exclude<ReceivedEvidenceFamilyKey, "network" | "final" | "support">, readonly string[]>> = {
  passenger: [
    "d005.passenger-request", "d005.passenger-authority", "d005.mission-accepted",
    "d006nx0.action:depart-base", "d005.pickup-confirmed", "d005.journey-executed",
    "d005.dropoff-confirmed",
  ],
  navigation: [
    "d005.pickup-route", "d005.garage-route-a", "d005.eta-deteriorates",
    "d005.reroute-authorized", "d006.c1.routing-provenance", "d005.route-b-executed",
    "d006nx0.action:reroute", "d005m.master-return-intent", "d005m.master-return-authorized",
    "d005m.master-return-executed", "d005m.master-base-arrival",
  ],
  traffic: [
    "d006g.signal-state-published:green-1", "d006g.city-detection",
    "d006g.signal-state-published:yellow", "d006g.perception:yellow", "d006g.decision:stop",
    "d006g.action:brake", "d006g.signal-state-published:red", "d006g.result:at-rest",
    "d006g.city-phase-decision", "d006g.signal-state-published:green-2",
    "d006g.perception:green", "d006g.decision:proceed", "d006g.action:resume",
    "d005.congestion-significant", "d006nx0.perception:congestion",
    "d006nx0.decision:hazard-stop", "d006nx0.action:hazard-brake",
    "d006nx0.result:hazard-stop",
  ],
  garage: ["d005.garage-arrival", "d005.garage-received"],
  maintenance: [
    "d005.maintenance-intent", "d005.diagnostic", "d005.maintenance-proposal",
    "d005.maintenance-authorized", "d005.maintenance-executed", "d005.maintenance-completed",
  ],
  human: [
    "d005m.master-human-approval-request", "d005m.master-human-approve",
    "d005m.master-payment-authority-active", "d005m.master-manager-notified",
  ],
  payment: [
    "d005m.master-invoice-1850", "d005m.master-payment-policy-exceeded",
    "d005m.master-payment-authorized", "d005m.master-payment-instruction",
    "d006g.payment-instruction-presented", "d006g.bank-authorization",
    "d006g.bank-confirmation", "d005m.master-payment-result",
  ],
  compilation: ["d005m.receipt.master-payment", "d005m.receipt.master-return-to-base"],
};

const familyLabels: Readonly<Record<ReceivedEvidenceFamilyKey, readonly [string, string]>> = {
  passenger: ["Passenger mission", "Mission passager"],
  navigation: ["Navigation", "Navigation"],
  traffic: ["Traffic", "Trafic"],
  garage: ["Garage", "Garage"],
  maintenance: ["Maintenance", "Maintenance"],
  human: ["Human authorization", "Autorisation humaine"],
  payment: ["Payment", "Paiement"],
  network: ["Network", "Réseau"],
  compilation: ["Causal compilation", "Compilation causale"],
  final: ["Final Receipt", "Reçu final"],
  support: ["Supporting evidence", "Preuves de support"],
};

export function receivedEvidenceFamilyLabel(key: ReceivedEvidenceFamilyKey, locale: "en" | "fr"): string {
  return familyLabels[key][locale === "fr" ? 1 : 0];
}

function classifyFamily(graph: ReceivedGraph, node: ReceivedGraphNode): ReceivedEvidenceFamilyKey | null {
  const receipt = receivedReceiptLabel(graph, node, "en");
  if (receipt.kind === "FINAL_RECEIPT") return "final";
  if (receipt.kind === "SUPPORT") return "support";
  if (receipt.kind !== "NANO_RECEIPT") return null;
  if (node.member?.producerDomain === "NETWORK") return "network";
  const eventId = node.member?.eventId;
  if (!eventId) return null;
  for (const [family, events] of Object.entries(familyEvents) as [keyof typeof familyEvents, readonly string[]][]) {
    if (events.includes(eventId)) return family;
  }
  return null;
}

export type ReceivedEvidenceCatalogEntry = Readonly<{
  node: ReceivedGraphNode;
  nodeKey: string;
  eventId: string | null;
  eventLabel: string;
  evidenceId: string | null;
  nanoReceiptId: string | null;
  receipt: ReceivedReceiptLabel;
  domainId: string | null;
  domainLabel: string | null;
  family: ReceivedEvidenceFamilyKey | null;
  familyLabel: string | null;
  manifestPosition: number | null;
  timelinePosition: number | null;
  timelineLength: number;
  familyPosition: number | null;
  familyLength: number | null;
  domainPosition: number | null;
  domainLength: number | null;
  causalParentNodeKeys: readonly string[];
  causalChildNodeKeys: readonly string[];
  observedInputNodeKeys: readonly string[];
  provenance: FactProvenance;
}>;

export type ReceivedEvidenceFamily = Readonly<{
  key: ReceivedEvidenceFamilyKey;
  label: string;
  entries: readonly ReceivedEvidenceCatalogEntry[];
}>;

export type ReceivedEvidenceDomain = Readonly<{
  id: string;
  label: string;
  entries: readonly ReceivedEvidenceCatalogEntry[];
}>;

export type ReceivedEvidenceCatalog = Readonly<{
  entries: readonly ReceivedEvidenceCatalogEntry[];
  timelineEntries: readonly ReceivedEvidenceCatalogEntry[];
  families: readonly ReceivedEvidenceFamily[];
  domains: readonly ReceivedEvidenceDomain[];
  issues: readonly string[];
}>;

function uniqueNodeKeys(keys: readonly string[], order: ReadonlyMap<string, number>): readonly string[] {
  return [...new Set(keys)].sort((left, right) => (order.get(left) ?? Number.MAX_SAFE_INTEGER) - (order.get(right) ?? Number.MAX_SAFE_INTEGER) || left.localeCompare(right));
}

/**
 * The only view-model that binds an event, its NanoReceipt, its domain and its
 * graph neighbourhood. Every field comes from the received projection; absent
 * or duplicate identifiers remain explicit and are never repaired here.
 */
export function createReceivedEvidenceCatalog(graph: ReceivedGraph, locale: "en" | "fr", text?: string): ReceivedEvidenceCatalog {
  const timeline = receivedTimelineNodes(graph);
  const timelinePosition = new Map(timeline.map((node, index) => [node.key, index + 1]));
  const nodeOrder = new Map(graph.nodes.map((node, index) => [node.key, index]));
  const base = graph.nodes.map((node) => {
    const receipt = receivedReceiptLabel(graph, node, locale);
    const family = classifyFamily(graph, node);
    const eventId = node.member?.eventId ?? null;
    const domainId = node.member?.producerDomain ?? null;
    return {
      node,
      nodeKey: node.key,
      eventId,
      eventLabel: node.final
        ? (locale === "fr" ? "Reçu final" : "Final Receipt")
        : receivedEventLabel(eventId, locale) ?? node.context.label?.value ?? (locale === "fr" ? "Événement déclaré" : "Declared event"),
      evidenceId: node.evidenceId,
      nanoReceiptId: receipt.kind === "NANO_RECEIPT" ? receipt.identity : null,
      receipt,
      provenance: receivedFactProvenance(node, text),
      domainId,
      domainLabel: domainId ? receivedProducerLabel(domainId, locale) : null,
      family,
      familyLabel: family ? receivedEvidenceFamilyLabel(family, locale) : null,
      manifestPosition: node.member ? node.member.index + 1 : null,
      timelinePosition: timelinePosition.get(node.key) ?? null,
    };
  });
  const familyMembers = new Map<ReceivedEvidenceFamilyKey, typeof base>();
  for (const key of receivedEvidenceFamilyKeys) familyMembers.set(key, base.filter((entry) => entry.family === key));
  const domainIds = [...new Set(base.flatMap((entry) => entry.domainId ? [entry.domainId] : []))];
  const domainMembers = new Map(domainIds.map((id) => [id, base.filter((entry) => entry.domainId === id)]));

  const entries: ReceivedEvidenceCatalogEntry[] = base.map((entry) => {
    const incoming = graph.edges.filter((edge) => edge.to === entry.nodeKey);
    const outgoing = graph.edges.filter((edge) => edge.from === entry.nodeKey);
    const familyEntries = entry.family ? familyMembers.get(entry.family) ?? [] : [];
    const domainEntries = entry.domainId ? domainMembers.get(entry.domainId) ?? [] : [];
    return Object.freeze({
      ...entry,
      timelineLength: timeline.length,
      familyPosition: entry.family ? familyEntries.findIndex((candidate) => candidate.nodeKey === entry.nodeKey) + 1 : null,
      familyLength: entry.family ? familyEntries.length : null,
      domainPosition: entry.domainId ? domainEntries.findIndex((candidate) => candidate.nodeKey === entry.nodeKey) + 1 : null,
      domainLength: entry.domainId ? domainEntries.length : null,
      causalParentNodeKeys: uniqueNodeKeys(incoming.filter((edge) => edge.causal).map((edge) => edge.from), nodeOrder),
      causalChildNodeKeys: uniqueNodeKeys(outgoing.filter((edge) => edge.causal).map((edge) => edge.to), nodeOrder),
      observedInputNodeKeys: uniqueNodeKeys(incoming.filter((edge) => edge.declarations.some((declaration) => declaration.kind === "OBSERVED_INPUT")).map((edge) => edge.from), nodeOrder),
    });
  });
  const byKey = new Map(entries.map((entry) => [entry.nodeKey, entry]));
  const families = receivedEvidenceFamilyKeys.map((key) => Object.freeze({
    key,
    label: receivedEvidenceFamilyLabel(key, locale),
    entries: Object.freeze((familyMembers.get(key) ?? []).map((entry) => byKey.get(entry.nodeKey)!)),
  }));
  const domains = domainIds.map((id) => Object.freeze({
    id,
    label: receivedProducerLabel(id, locale),
    entries: Object.freeze((domainMembers.get(id) ?? []).map((entry) => byKey.get(entry.nodeKey)!)),
  }));
  const duplicateIssues: string[] = [];
  for (const [kind, value] of [
    ["eventId", (entry: ReceivedEvidenceCatalogEntry) => entry.eventId],
    ["nanoReceiptId", (entry: ReceivedEvidenceCatalogEntry) => entry.nanoReceiptId],
    ["evidenceId", (entry: ReceivedEvidenceCatalogEntry) => entry.evidenceId],
  ] as const) {
    const values = new Map<string, number>();
    for (const entry of entries) {
      const id = value(entry);
      if (id) values.set(id, (values.get(id) ?? 0) + 1);
    }
    for (const [id, count] of values) if (count > 1) duplicateIssues.push(`duplicate ${kind}: ${id}`);
  }
  const unclassified = entries.filter((entry) => entry.receipt.kind === "NANO_RECEIPT" && entry.family === null);
  const issues = [...duplicateIssues, ...unclassified.map((entry) => `unclassified NanoReceipt: ${entry.node.fieldPath}`)];
  return Object.freeze({
    entries: Object.freeze(entries),
    timelineEntries: Object.freeze(timeline.map((node) => byKey.get(node.key)!).filter(Boolean)),
    families: Object.freeze(families),
    domains: Object.freeze(domains),
    issues: Object.freeze(issues),
  });
}

export type ReceivedEvidenceSelectionInput = Readonly<{
  eventId?: string | null;
  nanoReceiptId?: string | null;
  evidenceId?: string | null;
  domainId?: string | null;
  family?: string | null;
}>;

export type ReceivedEvidenceResolution = Readonly<{
  status: "EMPTY" | "RESOLVED" | "NOT_FOUND" | "AMBIGUOUS" | "CONTRADICTORY";
  scope: "NONE" | "NODE" | "DOMAIN" | "FAMILY" | "FILTER";
  entry: ReceivedEvidenceCatalogEntry | null;
  candidates: readonly ReceivedEvidenceCatalogEntry[];
  issues: readonly string[];
}>;

type IdentifierKind = "eventId" | "nanoReceiptId" | "evidenceId";

function exactMatches(catalog: ReceivedEvidenceCatalog, kind: IdentifierKind, value: string): readonly ReceivedEvidenceCatalogEntry[] {
  return catalog.entries.filter((entry) => entry[kind] === value);
}

/** Resolve URL selection fields by exact equality. No first-match fallback exists. */
export function resolveReceivedEvidenceSelection(catalog: ReceivedEvidenceCatalog, selection: ReceivedEvidenceSelectionInput): ReceivedEvidenceResolution {
  const identifiers = (["eventId", "nanoReceiptId", "evidenceId"] as const)
    .flatMap((kind) => selection[kind] === null || selection[kind] === undefined ? [] : [{ kind, value: selection[kind] as string }]);
  const domainRequested = selection.domainId !== null && selection.domainId !== undefined;
  const familyRequested = selection.family !== null && selection.family !== undefined;
  if (identifiers.length === 0 && !domainRequested && !familyRequested) {
    return Object.freeze({ status: "EMPTY", scope: "NONE", entry: null, candidates: [], issues: [] });
  }

  const issues: string[] = [];
  const uniqueMatches: ReceivedEvidenceCatalogEntry[] = [];
  let missing = false;
  let ambiguous = false;
  for (const { kind, value } of identifiers) {
    const matches = exactMatches(catalog, kind, value);
    if (matches.length === 0) { missing = true; issues.push(`${kind}: not found`); }
    else if (matches.length > 1) { ambiguous = true; issues.push(`${kind}: ${matches.length} matches`); }
    else uniqueMatches.push(matches[0]!);
  }
  if (missing || ambiguous) return Object.freeze({
    status: ambiguous ? "AMBIGUOUS" : "NOT_FOUND",
    scope: "NODE",
    entry: null,
    candidates: Object.freeze(uniqueMatches),
    issues: Object.freeze(issues),
  });
  const uniqueNodeKeys = new Set(uniqueMatches.map((entry) => entry.nodeKey));
  if (uniqueNodeKeys.size > 1) return Object.freeze({
    status: "CONTRADICTORY", scope: "NODE", entry: null,
    candidates: Object.freeze(uniqueMatches), issues: Object.freeze(["identifiers resolve to different received members"]),
  });

  const node = uniqueMatches[0] ?? null;
  const domainEntries = domainRequested ? catalog.entries.filter((entry) => entry.domainId === selection.domainId) : catalog.entries;
  if (domainRequested && domainEntries.length === 0) return Object.freeze({
    status: "NOT_FOUND", scope: "DOMAIN", entry: null, candidates: [], issues: Object.freeze(["domainId: not found"]),
  });
  const familyKey = familyRequested && receivedEvidenceFamilyKeys.includes(selection.family as ReceivedEvidenceFamilyKey)
    ? selection.family as ReceivedEvidenceFamilyKey : null;
  if (familyRequested && familyKey === null) return Object.freeze({
    status: "NOT_FOUND", scope: "FAMILY", entry: null, candidates: [], issues: Object.freeze(["family: not found"]),
  });
  const familyEntries = familyKey ? catalog.entries.filter((entry) => entry.family === familyKey) : catalog.entries;
  const filtered = domainEntries.filter((entry) => familyEntries.some((candidate) => candidate.nodeKey === entry.nodeKey));
  if (node && ((domainRequested && node.domainId !== selection.domainId) || (familyKey && node.family !== familyKey))) return Object.freeze({
    status: "CONTRADICTORY", scope: "NODE", entry: null, candidates: Object.freeze([node]),
    issues: Object.freeze([domainRequested && node.domainId !== selection.domainId ? "domainId contradicts the resolved member" : "family contradicts the resolved member"]),
  });
  if (!node && filtered.length === 0) return Object.freeze({
    status: "CONTRADICTORY", scope: "FILTER", entry: null, candidates: [],
    issues: Object.freeze(["received domain and family have no member in common"]),
  });
  return Object.freeze({
    status: "RESOLVED",
    scope: node ? "NODE" : domainRequested && familyRequested ? "FILTER" : domainRequested ? "DOMAIN" : "FAMILY",
    entry: node,
    candidates: Object.freeze(node ? [node] : filtered),
    issues: [],
  });
}

export function catalogEntryByNodeKey(catalog: ReceivedEvidenceCatalog, nodeKey: string): ReceivedEvidenceCatalogEntry | null {
  return catalog.entries.find((entry) => entry.nodeKey === nodeKey) ?? null;
}

export type ReceivedEvidenceCausalNeighbours = Readonly<{
  parents: readonly ReceivedEvidenceCatalogEntry[];
  children: readonly ReceivedEvidenceCatalogEntry[];
}>;

/** Resolve only direct received causal declarations; timeline proximity is excluded. */
export function receivedEvidenceCausalNeighbours(
  catalog: ReceivedEvidenceCatalog,
  entry: ReceivedEvidenceCatalogEntry,
): ReceivedEvidenceCausalNeighbours {
  const resolve = (nodeKeys: readonly string[]) => Object.freeze(nodeKeys.flatMap((nodeKey) => {
    const candidate = catalogEntryByNodeKey(catalog, nodeKey);
    return candidate ? [candidate] : [];
  }));
  return Object.freeze({
    parents: resolve(entry.causalParentNodeKeys),
    children: resolve(entry.causalChildNodeKeys),
  });
}

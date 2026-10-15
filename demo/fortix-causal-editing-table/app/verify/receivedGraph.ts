import type { ReceivedMember, ReceivedPebProjection, ReceivedRelation } from "./inspectReceivedPeb.ts";

export type ReceivedDeclaration = Readonly<{ value: string; path: string }>;
export type ReceivedContext = Readonly<{
  label?: ReceivedDeclaration; authority?: ReceivedDeclaration; execution?: ReceivedDeclaration;
  trustBoundary?: ReceivedDeclaration; issuer?: ReceivedDeclaration;
}>;
export type ReceivedGraphNode = Readonly<{
  key: string; fieldPath: string; evidenceId: string | null; member: ReceivedMember | null;
  context: ReceivedContext; final: boolean; depth: number | null; component: number;
}>;
export type ReceivedCrossing = Readonly<{
  kind: "producer" | "authority" | "execution" | "trustBoundary";
  from: ReceivedDeclaration; to: ReceivedDeclaration;
}>;
export type ReceivedGraphEdge = Readonly<{
  key: string; from: string; to: string; declarations: readonly ReceivedRelation[];
  causal: boolean; crossings: readonly ReceivedCrossing[];
}>;
export type ReceivedGraph = Readonly<{
  nodes: readonly ReceivedGraphNode[]; edges: readonly ReceivedGraphEdge[];
  unresolved: readonly ReceivedRelation[]; cycleKeys: readonly string[];
  contextIssues: readonly string[]; finalKey: string | null; componentCount: number;
}>;

type Obj = Record<string, unknown>;
const object = (value: unknown): Obj | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Obj : null;
const textValue = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
function declared(root: Obj, keys: readonly string[], prefix: string): ReceivedDeclaration | undefined {
  let value: unknown = root;
  for (const key of keys) value = object(value)?.[key];
  return textValue(value) ? { value, path: `${prefix}.${keys.join(".")}` } : undefined;
}

/** Read optional context only from uniquely matched objects in the received text. */
function receivedContexts(raw: string, members: readonly ReceivedMember[]) {
  let root: Obj | null = null;
  try { root = object(JSON.parse(raw)); } catch { /* The text parser reports this separately. */ }
  const source = object(root?.sourceBundle)?.canonical_evidence_objects;
  const runtime = root?.runtimeRecords;
  const contexts = new Map<number, ReceivedContext>();
  const issues: string[] = [];
  for (const member of members) {
    const signed = member.source === "SIGNED_CANONICAL";
    const records = signed ? source : member.source === "RUNTIME_JOURNAL" ? runtime : null;
    if (!Array.isArray(records) || !textValue(member.evidenceId)) continue;
    const matches = records.flatMap((value, index) => {
      const record = object(value);
      return record && record[signed ? "evidence_id" : "receiptId"] === member.evidenceId ? [{ record, index }] : [];
    });
    if (matches.length > 1) issues.push(`manifest.memberRefs[${member.index}]: ${matches.length} matching ${signed ? "sourceBundle.canonical_evidence_objects" : "runtimeRecords"}`);
    if (matches.length !== 1) continue;
    const { record, index } = matches[0];
    const prefix = signed ? `sourceBundle.canonical_evidence_objects[${index}]` : `runtimeRecords[${index}]`;
    if (!signed) {
      contexts.set(member.index, { execution: declared(record, ["executionLocality"], prefix) });
      continue;
    }
    const payloads = [
      ["evidence_payload", "intent"], ["evidence_payload", "result"],
      ["evidence_payload", "execution"], ["evidence_payload", "policy_decision", "evaluation_evidence"],
    ];
    const unique = (field: string) => {
      const values = payloads.flatMap(keys => { const value = declared(record, [...keys, field], prefix); return value ? [value] : []; });
      if (values.length > 1) issues.push(`${prefix}: multiple ${field} declarations`);
      return values.length === 1 ? values[0] : undefined;
    };
    contexts.set(member.index, {
      label: unique("label"), authority: unique("authority_context"),
      trustBoundary: declared(record, ["trust_boundary", "trust_boundary_id"], prefix),
      issuer: declared(record, ["issuer", "issuer_id"], prefix),
    });
  }
  return { contexts, issues };
}

/** Display-only graph: no fixture, verification result, time ordering, or invented edge. */
export function projectReceivedGraph(peb: ReceivedPebProjection, raw: string): ReceivedGraph {
  const { contexts, issues } = receivedContexts(raw, peb.members);
  const byId = new Map<string, string[]>();
  const nodes: ReceivedGraphNode[] = peb.members.map(member => {
    const key = `member:${member.index}`;
    if (textValue(member.evidenceId)) byId.set(member.evidenceId, [...(byId.get(member.evidenceId) ?? []), key]);
    return { key, fieldPath: `manifest.memberRefs[${member.index}]`, evidenceId: member.evidenceId, member,
      context: contexts.get(member.index) ?? {}, final: false, depth: null, component: 0 };
  });
  const finalMatches = peb.finalReceiptId ? byId.get(peb.finalReceiptId) ?? [] : [];
  const matchingFinal = finalMatches.length === 1 ? nodes.find(node => node.key === finalMatches[0] && node.member?.source === "D006_FINAL_RECEIPT") : undefined;
  const finalKey = peb.finalReceipt === null ? null : matchingFinal?.key ?? "finalReceipt";
  if (matchingFinal) nodes[matchingFinal.member!.index] = { ...matchingFinal, final: true };
  else if (peb.finalReceipt !== null) nodes.push({ key: "finalReceipt", fieldPath: "finalReceipt", evidenceId: peb.finalReceiptId,
    member: null, context: {}, final: true, depth: null, component: 0 });
  const nodeByKey = new Map(nodes.map(node => [node.key, node]));
  const unresolved: ReceivedRelation[] = [];
  const grouped = new Map<string, { from: string; to: string; declarations: ReceivedRelation[] }>();
  for (const relation of peb.relations) {
    const fromKeys = relation.from === null ? [] : byId.get(relation.from) ?? [];
    const targetIndex = /^manifest\.memberRefs\[(\d+)\]/.exec(relation.path)?.[1];
    const to = relation.kind === "FINAL_RECEIPT_INPUT" ? finalKey : targetIndex === undefined ? null : `member:${targetIndex}`;
    if (relation.referenceStatus !== "PRESENT" || fromKeys.length !== 1 || !to || !nodeByKey.has(to)) { unresolved.push(relation); continue; }
    const from = fromKeys[0];
    const key = `${from}>${to}`;
    const group = grouped.get(key) ?? { from, to, declarations: [] };
    group.declarations.push(relation); grouped.set(key, group);
  }
  const edges: ReceivedGraphEdge[] = [...grouped.entries()].map(([key, group]) => {
    const from = nodeByKey.get(group.from)!; const to = nodeByKey.get(group.to)!;
    const crossings: ReceivedCrossing[] = [];
    const producer = (node: ReceivedGraphNode) => textValue(node.member?.producerDomain)
      ? { value: node.member.producerDomain, path: `${node.fieldPath}.producerDomain` } : undefined;
    for (const kind of ["producer", "authority", "execution", "trustBoundary"] as const) {
      const first = kind === "producer" ? producer(from) : from.context[kind];
      const second = kind === "producer" ? producer(to) : to.context[kind];
      if (first && second && first.value !== second.value) crossings.push({ kind, from: first, to: second });
    }
    return { key, ...group, causal: group.declarations.some(relation => relation.kind !== "OBSERVED_INPUT"), crossings };
  });
  const children = new Map(nodes.map(node => [node.key, [] as string[]]));
  const neighbors = new Map(nodes.map(node => [node.key, [] as string[]]));
  for (const edge of edges) {
    if (edge.causal) children.get(edge.from)!.push(edge.to);
    neighbors.get(edge.from)!.push(edge.to); neighbors.get(edge.to)!.push(edge.from);
  }
  // Iterative reachability identifies only nodes actually in a causal cycle.
  const cycleKeys = nodes.filter(node => {
    const pending = [...children.get(node.key)!]; const seen = new Set<string>();
    while (pending.length) { const key = pending.pop()!; if (key === node.key) return true;
      if (!seen.has(key)) { seen.add(key); pending.push(...children.get(key)!); } }
    return false;
  }).map(node => node.key);
  const cyclic = new Set(cycleKeys);
  const indegree = new Map(nodes.map(node => [node.key, 0]));
  for (const edge of edges) if (edge.causal) indegree.set(edge.to, indegree.get(edge.to)! + 1);
  const depths = new Map<string, number>();
  const pending = nodes.filter(node => indegree.get(node.key) === 0).map(node => node.key);
  for (const key of pending) depths.set(key, 0);
  for (let i = 0; i < pending.length; i++) {
    const key = pending[i];
    for (const child of children.get(key)!) {
      if (cyclic.has(child)) continue;
      depths.set(child, Math.max(depths.get(child) ?? 0, depths.get(key)! + 1));
      indegree.set(child, indegree.get(child)! - 1);
      if (indegree.get(child) === 0) pending.push(child);
    }
  }
  // A depth is unavailable for cycles and their dependent nodes.
  const ordered = new Set(pending);
  const components = new Map<string, number>(); let componentCount = 0;
  for (const node of nodes) if (!components.has(node.key)) {
    const stack = [node.key]; componentCount += 1; components.set(node.key, componentCount);
    while (stack.length) for (const adjacent of neighbors.get(stack.pop()!)!) if (!components.has(adjacent)) {
      components.set(adjacent, componentCount); stack.push(adjacent);
    }
  }
  return { nodes: nodes.map(node => ({ ...node, depth: ordered.has(node.key) ? depths.get(node.key) ?? null : null, component: components.get(node.key)! })),
    edges, unresolved, cycleKeys, contextIssues: issues, finalKey, componentCount };
}

/** A longest root-to-target directed path; observed inputs never become causal steps. */
export function receivedEvidencePath(graph: ReceivedGraph, targetKey = graph.finalKey): readonly string[] {
  if (!targetKey) return [];
  const paths = new Map<string, string[]>();
  const incoming = new Map(graph.nodes.map(node => [node.key, [] as ReceivedGraphEdge[]]));
  for (const edge of graph.edges) if (edge.causal) incoming.get(edge.to)!.push(edge);
  for (const node of [...graph.nodes].filter(node => node.depth !== null).sort((a, b) => a.depth! - b.depth! || a.fieldPath.localeCompare(b.fieldPath))) {
    const parents = incoming.get(node.key)!;
    if (parents.length === 0) paths.set(node.key, [node.key]);
    else {
      const candidates = parents.flatMap(edge => { const path = paths.get(edge.from); return path ? [path] : []; });
      candidates.sort((a, b) => b.length - a.length || a.join("/").localeCompare(b.join("/")));
      if (candidates.length) paths.set(node.key, [...candidates[0], node.key]);
    }
  }
  return paths.get(targetKey) ?? [];
}

export function receivedFocus(graph: ReceivedGraph, selected: string | null, path: readonly string[]) {
  const strong = new Set(path); if (selected) strong.add(selected);
  const context = new Set<string>();
  for (const edge of graph.edges) if (edge.from === selected || edge.to === selected) { context.add(edge.from); context.add(edge.to); }
  const pathEdges = new Set(path.slice(1).map((key, index) => `${path[index]}>${key}`));
  return { strong, context, pathEdges };
}

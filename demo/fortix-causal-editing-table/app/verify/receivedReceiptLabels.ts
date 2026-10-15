import type { ReceivedGraph, ReceivedGraphNode } from "./receivedGraph.ts";

export type ReceivedReceiptLabel = Readonly<{
  kind: "NANO_RECEIPT" | "FINAL_RECEIPT" | "SUPPORT" | "UNRESOLVED";
  display: string; title: string; technical: string; identity: string | null; identityPath: string;
  status: "DECLARED" | "MISSING" | "AMBIGUOUS";
}>;
const present = (value: string | null | undefined): value is string => typeof value === "string" && value.trim().length > 0;
const token = (id: string) => /^fortix:(?:evidence|receipt):blake3:([0-9a-f]+)$/i.exec(id)?.[1] ?? id;

/** Reading labels only. They never replace canonical IDs or manufacture receipts.
 * A NanoReceipt label is attached to an identified, presented signed/runtime member.
 * Support material, the Final Receipt, missing IDs and ambiguous IDs stay distinct. */
export function receivedReceiptLabel(graph: ReceivedGraph, node: ReceivedGraphNode, locale: "en" | "fr"): ReceivedReceiptLabel {
  const fr = locale === "fr";
  const technical = node.member ? `M${String(node.member.index + 1).padStart(2, "0")}` : "FR";
  const identity = node.final ? node.evidenceId : node.member?.receiptId ?? null;
  const identityPath = node.final ? "finalReceipt.receiptId" : `${node.fieldPath}.receiptId`;
  const duplicates = present(identity) ? graph.nodes.filter(candidate => candidate.key !== node.key && (candidate.final ? candidate.evidenceId : candidate.member?.receiptId) === identity).length : 0;
  const evidenceDuplicates = present(node.evidenceId) ? graph.nodes.filter(candidate => candidate.key !== node.key && candidate.evidenceId === node.evidenceId).length : 0;
  const status = !present(identity) || !present(node.evidenceId) ? "MISSING" : duplicates > 0 || evidenceDuplicates > 0 ? "AMBIGUOUS" : "DECLARED";
  if (status !== "DECLARED") return {
    kind: "UNRESOLVED", display: status === "AMBIGUOUS" ? (fr ? "ID ambigu" : "Ambiguous ID") : "ID ?",
    title: status === "AMBIGUOUS" ? (fr ? "Identité ambiguë" : "Ambiguous identity") : (fr ? "Reçu non identifié" : "Unidentified receipt"),
    technical, identity, identityPath, status,
  };
  if (node.final) return { kind: "FINAL_RECEIPT", display: "FR", title: fr ? "Reçu final" : "Final Receipt", technical, identity, identityPath, status };
  const nano = node.member?.presentation === "PRESENTED" && (node.member.source === "SIGNED_CANONICAL" || node.member.source === "RUNTIME_JOURNAL");
  if (!nano) return { kind: "SUPPORT", display: "Support", title: fr ? "Preuve de support" : "Supporting evidence", technical, identity, identityPath, status };
  const base = token(identity!);
  const otherTokens = graph.nodes.filter(candidate => candidate.key !== node.key && present(candidate.member?.receiptId)).map(candidate => token(candidate.member!.receiptId!));
  let length = Math.min(base.length, 8);
  while (length < base.length && otherTokens.some(other => other.startsWith(base.slice(0, length)))) length++;
  const compact = /^NR[-:]/.test(identity!) && identity!.length <= 25 ? identity! : `NR · ${base.slice(0, length)}`;
  return { kind: "NANO_RECEIPT", display: compact, title: "NanoReceipt", technical, identity, identityPath, status };
}

/** Count evidence identities, never causal relations. Segment endpoints are
 * deliberately included; shared endpoints are deduplicated within each count. */
export function receivedReceiptCounts(graph: ReceivedGraph, keys: readonly string[] = graph.nodes.map(node => node.key)) {
  const selected = new Set(keys);
  const labels = graph.nodes.filter(node => selected.has(node.key)).map(node => receivedReceiptLabel(graph, node, "en"));
  return {
    nano: new Set(labels.filter(label => label.kind === "NANO_RECEIPT").map(label => label.identity)).size,
    support: labels.filter(label => label.kind === "SUPPORT").length,
    final: new Set(labels.filter(label => label.kind === "FINAL_RECEIPT").map(label => label.identity)).size,
    unresolved: labels.filter(label => label.kind === "UNRESOLVED").length,
  };
}

export function receivedReceiptCountLabel(counts: ReturnType<typeof receivedReceiptCounts>, locale: "en" | "fr") {
  const fr = locale === "fr";
  return [
    `${counts.nano} NR`,
    counts.support ? `${counts.support} ${fr ? "support" : "support item"}${counts.support > 1 ? "s" : ""}` : null,
    counts.final ? `${counts.final} ${fr ? (counts.final > 1 ? "reçus finaux" : "reçu final") : (counts.final > 1 ? "Final Receipts" : "Final Receipt")}` : null,
    counts.unresolved ? `${counts.unresolved} ${fr ? "non résolu" : "unresolved"}${fr && counts.unresolved > 1 ? "s" : ""}` : null,
  ].filter(Boolean).join(" · ");
}

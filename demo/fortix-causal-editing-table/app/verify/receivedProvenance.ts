import { transferredContentDigest } from "../portableMissionEvidence.ts";
import { isReceivedEvidenceDossier } from "./guidedInspection.ts";
import type { ReceivedGraphNode } from "./receivedGraph.ts";

export type FactProvenance = Readonly<{
  category: "SIMULATED" | "RUNTIME" | "REPLAY" | "COMPILED" | "UNKNOWN";
  basis: "AUDITED_SCRIPT" | "EXPLICIT_MODEL" | "DECLARED_SOURCE" | "UNRESOLVED";
  sourcePaths: readonly string[];
  physicalObservationEstablished: false;
  source: "audit_script" | "demo_fixture" | "demo_runtime" | "runtime_journal" | "declared_replay" | "causal_compilation" | null;
}>;

type Obj = Record<string, unknown>;
const object = (value: unknown): Obj | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Obj : null;
const make = (category: FactProvenance["category"], basis: FactProvenance["basis"], source: FactProvenance["source"], sourcePaths: readonly string[]): FactProvenance => Object.freeze({ category, basis, source, sourcePaths: Object.freeze([...sourcePaths]), physicalObservationEstablished: false });
const unknown = () => make("UNKNOWN", "UNRESOLVED", null, []);

// Audit source: scripts/d006rb1/generate-network-continuity-audit.ts. Its two
// transitions are injected, despite their physical-sentinel source strings.
// Match the complete received document; a run ID, title or source string alone
// cannot establish this origin. Normalization only ignores JSON whitespace/key
// ordering, never a field, array order, value or receipt.
export const AUDITED_NETWORK_PACKAGE_DIGEST = "cb2786db914459e56f64c0a70f7993d8f44db5a6403c1a77c6015ed3ddb0e1a1";
const AUDITED_NORMALIZED_PACKAGE_DIGEST = "4b2361399ff5fb8800ae2929768d7511c04790f5e4cdb79c75905c45af648568";
const auditedNetworkEvents = new Set(["d006d.network-link-lost:3e040bfb16c0f41b", "d006d.network-link-restored:8d5cd8ab7ea7ba44"]);
const demoIssuers = new Set(["DEMO_PARTICIPANT", "DEMO_GOVERNANCE_AUTHORITY", "DEMO_HUMAN_AUTHORITY", "DEMO_TIME_SOURCE", "DEMO_TRUST_AUTHORITY"]);
const normalized = (value: unknown): unknown => Array.isArray(value) ? value.map(normalized) : object(value) ? Object.fromEntries(Object.keys(value as Obj).sort().map(key => [key, normalized((value as Obj)[key])])) : value;

type ReceivedObject = { record: Obj; path: string };
type SourceContext = { audited: boolean; sources: ReadonlyMap<string, readonly ReceivedObject[]> };
let previousText: string | undefined;
let previousContext: SourceContext | null = null;
function sourceContext(text: string): SourceContext | null {
  if (text === previousText) return previousContext;
  previousText = text;
  previousContext = null;
  let root: Obj | null;
  try { root = object(JSON.parse(text)); } catch { return null; }
  if (!root) return null;
  const sources = new Map<string, ReceivedObject[]>();
  const add = (source: string, values: unknown, identity: string, prefix: string) => {
    if (!Array.isArray(values)) return;
    values.forEach((value, index) => {
      const record = object(value);
      if (!record || typeof record[identity] !== "string") return;
      const key = `${source}:${record[identity]}`;
      sources.set(key, [...(sources.get(key) ?? []), { record, path: `${prefix}[${index}]` }]);
    });
  };
  add("SIGNED_CANONICAL", object(root.sourceBundle)?.canonical_evidence_objects, "evidence_id", "sourceBundle.canonical_evidence_objects");
  add("RUNTIME_JOURNAL", root.runtimeRecords, "receiptId", "runtimeRecords");
  const final = object(root.finalReceipt);
  if (final && typeof final.receiptId === "string") sources.set(`D006_FINAL_RECEIPT:${final.receiptId}`, [{ record: final, path: "finalReceipt" }]);
  const audited = transferredContentDigest(text) === AUDITED_NETWORK_PACKAGE_DIGEST
    || transferredContentDigest(JSON.stringify(normalized(root))) === AUDITED_NORMALIZED_PACKAGE_DIGEST;
  previousContext = { audited, sources };
  return previousContext;
}

/** Presentation taxonomy, never a signature/physical-effect verification. */
export function receivedFactProvenance(node: ReceivedGraphNode, text?: string): FactProvenance {
  if (node.final || node.member?.source === "D006_FINAL_RECEIPT" || isReceivedEvidenceDossier(node)) {
    return make("COMPILED", "EXPLICIT_MODEL", "causal_compilation", [node.final ? "finalReceipt" : `${node.fieldPath}.eventId`]);
  }
  if (text === undefined || !node.evidenceId || !node.member) return unknown();
  const context = sourceContext(text);
  const matches = context?.sources.get(`${node.member.source}:${node.evidenceId}`) ?? [];
  if (matches.length !== 1) return unknown();
  const { record, path } = matches[0]!;
  const signed = node.member.source === "SIGNED_CANONICAL";
  const eventId = signed ? object(record.significant_event)?.event_id : record.eventId;
  if (typeof eventId !== "string" || eventId !== node.member.eventId) return unknown();
  if (context!.audited && auditedNetworkEvents.has(eventId)) {
    return make("SIMULATED", "AUDITED_SCRIPT", "audit_script", ["$", `${path}.eventId`]);
  }
  const payload = object(record.payload);
  // Only explicit, documented model markers qualify; titles, NR names and
  // observation-source strings never turn a simulation into a physical fact.
  if (record.provenance === "REPLAY" || payload?.evidence_class === "REPLAY") {
    return make("REPLAY", "EXPLICIT_MODEL", "declared_replay", [record.provenance === "REPLAY" ? `${path}.provenance` : `${path}.payload.evidence_class`]);
  }
  if (payload?.evidence_class === "DEMONSTRATION_RUNTIME" || payload?.execution_scope === "DEMO_PRESENTATION_RUNTIME") {
    return make("SIMULATED", "EXPLICIT_MODEL", "demo_runtime", [
      ...(payload.evidence_class === "DEMONSTRATION_RUNTIME" ? [`${path}.payload.evidence_class`] : []),
      ...(payload.execution_scope === "DEMO_PRESENTATION_RUNTIME" ? [`${path}.payload.execution_scope`] : []),
    ]);
  }
  const issuer = object(record.issuer);
  if (signed && (issuer?.issuer_type === "DEMO_CAUSAL_COMPILER" || issuer?.issuer_type === "CAUSAL_COMPILER")) return make("COMPILED", "EXPLICIT_MODEL", "causal_compilation", [`${path}.issuer.issuer_type`]);
  if (signed && (context!.audited || demoIssuers.has(String(issuer?.issuer_type)))) {
    return make("SIMULATED", context!.audited ? "AUDITED_SCRIPT" : "EXPLICIT_MODEL", "demo_fixture", [context!.audited ? "$" : `${path}.issuer.issuer_type`]);
  }
  if (node.member.source === "RUNTIME_JOURNAL") return make("RUNTIME", "DECLARED_SOURCE", "runtime_journal", [
    `${node.fieldPath}.source`, `${path}.eventType`,
    ...(typeof payload?.observation_source === "string" ? [`${path}.payload.observation_source`] : []),
  ]);
  return unknown();
}

export function factProvenanceLabel(provenance: FactProvenance, locale: "en" | "fr"): string {
  const fr = locale === "fr";
  switch (provenance.category) {
    case "SIMULATED": return provenance.source === "audit_script" ? (fr ? "SIMULÉ · Script d’audit" : "SIMULATED · Audit script") : provenance.source === "demo_fixture" ? (fr ? "SIMULÉ · Données de démonstration" : "SIMULATED · Demo data") : (fr ? "SIMULÉ · Scénario de démonstration" : "SIMULATED · Demo scenario");
    case "RUNTIME": return fr ? "RUNTIME · Déclaré dans le PEB" : "RUNTIME · Declared in the PEB";
    case "REPLAY": return fr ? "REPLAY · Relecture déclarée" : "REPLAY · Declared replay";
    case "COMPILED": return fr ? "COMPILÉ · Assemblage de preuves" : "COMPILED · Evidence assembly";
    case "UNKNOWN": return fr ? "PROVENANCE NON ÉTABLIE" : "PROVENANCE NOT ESTABLISHED";
  }
}

export function factProvenanceDescription(provenance: FactProvenance, locale: "en" | "fr"): string {
  const fr = locale === "fr";
  switch (provenance.category) {
    case "SIMULATED": return provenance.source === "audit_script" ? (fr ? "Cette transition a été injectée par le script d’audit identifié. Elle ne provient pas d’une coupure physique observée." : "This transition was injected by the identified audit script. It did not come from an observed physical disconnection.") : (fr ? "Le modèle reçu identifie des données de démonstration. Ce fait n’établit pas un effet physique réel." : "The received model identifies demonstration data. This fact does not establish a real physical effect.");
    case "RUNTIME": return fr ? "Un enregistrement d’exécution est reçu. La source déclarée ne suffit pas à établir une observation physique réelle ; les observations brutes corrélées ne sont pas établies dans cette vue." : "An execution record was received. Its declared source alone does not establish a real physical observation; correlated raw observations are not established in this view.";
    case "REPLAY": return fr ? "Le modèle reçu marque explicitement une relecture. Elle ne constitue pas une nouvelle observation physique." : "The received model explicitly marks a replay. It is not a new physical observation.";
    case "COMPILED": return fr ? "Cet objet rassemble des preuves reçues. Il ne représente pas une nouvelle action physique." : "This object assembles received evidence. It is not a new physical action.";
    case "UNKNOWN": return fr ? "Les champs reçus ne permettent pas de distinguer une observation réelle, une simulation ou une relecture. Aucune provenance n’est déduite du titre." : "Received fields do not distinguish a real observation, simulation or replay. No provenance is inferred from the title.";
  }
}

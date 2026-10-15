import type { D006VerdictSnapshot } from "../offlineVerification.ts";
import type { ReceivedPebProjection } from "./inspectReceivedPeb.ts";
import type { ReceivedGraph, ReceivedGraphNode, ReceivedCrossing } from "./receivedGraph.ts";
import { receivedEventLabel } from "./receivedLabels.ts";
import { guidedStoryHumanCaption } from "./guidedStory.ts";

export type InspectionField = Readonly<{ key: string; value: string; path: string }>;
export type InspectionEvidence = Readonly<{
  status: "FOUND" | "MISSING" | "AMBIGUOUS" | "INVALID_JSON";
  sourcePath: string | null; raw: unknown | null;
  fields: readonly InspectionField[]; issues: readonly string[];
}>;
type Obj = Record<string, unknown>;
const object = (value: unknown): Obj | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Obj : null;
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

/** Declarations only. No verifier is called and no fixture supplies missing fields. */
export function readInspectionEvidence(rawText: string, node: ReceivedGraphNode): InspectionEvidence {
  const unavailable = (status: InspectionEvidence["status"], issue: string): InspectionEvidence => freeze({ status, sourcePath: null, raw: null, fields: [], issues: [issue] });
  let root: Obj | null;
  try { root = object(JSON.parse(rawText)); } catch { return unavailable("INVALID_JSON", "$"); }
  if (!root || !text(node.evidenceId)) return unavailable("MISSING", node.fieldPath);
  const signed = node.member?.source === "SIGNED_CANONICAL";
  const runtime = node.member?.source === "RUNTIME_JOURNAL";
  const final = node.final || node.member?.source === "D006_FINAL_RECEIPT";
  const source = object(root.sourceBundle)?.canonical_evidence_objects;
  const records = final ? [root.finalReceipt] : signed ? source : runtime ? root.runtimeRecords : null;
  if (!Array.isArray(records)) return unavailable("MISSING", node.fieldPath);
  const matches = records.flatMap((candidate, index) => {
    const record = object(candidate);
    return record && record[signed && !final ? "evidence_id" : "receiptId"] === node.evidenceId ? [{ record, index }] : [];
  });
  if (matches.length !== 1) return unavailable(matches.length ? "AMBIGUOUS" : "MISSING", `${node.fieldPath}: ${matches.length} matching received objects`);
  const { record, index } = matches[0]!;
  const sourcePath = final ? "finalReceipt" : signed ? `sourceBundle.canonical_evidence_objects[${index}]` : `runtimeRecords[${index}]`;
  const fields: InspectionField[] = []; const issues: string[] = [];
  const add = (key: string, value: unknown, path: string) => {
    if (text(value) || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) fields.push({ key, value: String(value), path });
  };
  const at = (keys: readonly string[]) => keys.reduce<unknown>((value, key) => object(value)?.[key], record);
  const field = (key: string, keys: readonly string[]) => add(key, at(keys), `${sourcePath}.${keys.join(".")}`);
  const outcomes = ["decision", "outcome", "result", "status", "human_decision", "provider_result", "confirmation", "settlement_status", "consequence", "actuation", "motion_state", "published_state", "observed_state", "notification", "authorizes", "is_settlement", "settles_funds"];
  const outcomeFields = (payload: Obj | null, path: string) => {
    if (payload) for (const name of outcomes) add("outcome", payload[name], `${path}.${name}`);
  };
  if (signed && !final) {
    field("issuer", ["issuer", "issuer_id"]); field("signature", ["signature"]);
    field("signatureAlgorithm", ["cryptographic_profile", "signature_algorithm"]); field("keyId", ["cryptographic_profile", "key_id"]);
    field("trustAnchor", ["cryptographic_profile", "trust_anchor_id"]); field("payloadDigest", ["evidence_integrity", "payload_digest"]);
    field("eventTime", ["significant_event", "event_time"]); field("issuedAt", ["lifecycle", "issued_at"]);
    field("trustBoundary", ["trust_boundary", "trust_boundary_id"]);
    const payloadPaths = [["evidence_payload", "intent"], ["evidence_payload", "result"], ["evidence_payload", "execution"], ["evidence_payload", "policy_decision", "evaluation_evidence"]];
    for (const path of payloadPaths) {
      field("label", [...path, "label"]); field("authorityContext", [...path, "authority_context"]);
      field("applicableAuthorityEvidenceId", [...path, "details", "applicable_authority_evidence_id"]);
      field("amount", [...path, "details", "amount_eur"]); field("currency", [...path, "details", "currency"]);
      field("authorityLimit", [...path, "details", "threshold_eur"]);
      outcomeFields(object(at(path)), `${sourcePath}.${path.join(".")}`);
      outcomeFields(object(at([...path, "details"])), `${sourcePath}.${path.join(".")}.details`);
    }
    for (const [key, name] of [["authorityId", "policy_authority_id"], ["policyId", "policy_id"], ["policyVersion", "policy_version"], ["policyDecision", "evaluation_result"]]) field(key!, ["evidence_payload", "policy_decision", name!]);
    for (const [key, name] of [["authorityId", "authority_id"], ["authorityStatus", "authority_status"], ["effectiveFrom", "effective_from"], ["effectiveUntil", "effective_until"]]) field(key!, ["evidence_payload", "policy_authority_status", name!]);
    for (const [key, name] of [["trustedTime", "trusted_time"], ["timeSource", "time_source_id"], ["timeProfile", "time_profile"], ["timeSubject", "subject_evidence_id"]]) field(key!, ["evidence_payload", "trusted_time", name!]);
  }
  if (runtime && !final) {
    for (const name of ["executionLocality", "evidenceLocality"]) field(name, [name]);
    for (const [key, name] of [["trustDomain", "trust_domain"], ["executionScope", "execution_scope"], ["runtime", "execution_runtime"], ["device", "execution_device"], ["previousNetworkState", "previous_network_state"], ["newNetworkState", "new_network_state"], ["observationSource", "observation_source"], ["observedMasterTime", "observed_master_time_ms"], ["reconciliationResult", "reconciliation_result"], ["settlementSystemParticipated", "settlement_system_participated"]]) field(key!, ["payload", name!]);
    field("missionClockPosition", ["missionClockPosition"]); field("canonicalDigest", ["canonicalDigest"]);
    outcomeFields(object(record.payload), `${sourcePath}.payload`);
    const route = ["payload", "routing_provenance"];
    for (const [key, name] of [["selectedModel", "selected_model"], ["resolvedModel", "resolved_model"], ["selectedProvider", "selected_provider"], ["resolvedProvider", "resolved_provider"], ["selectedSource", "selected_source"], ["resolvedSource", "resolved_source"], ["routingPolicy", "routing_policy_ref"]]) field(key!, [...route, name!]);
    field("fallbackReason", [...route, "fallback", "reason_code"]); field("resultingRoute", [...route, "resulting_route", "route_id"]);
    const provenance = object(at(route)); const candidates = provenance?.candidate_set;
    if (provenance && Array.isArray(candidates)) {
      const resolved = candidates.flatMap((value, candidateIndex) => {
        const candidate = object(value);
        return candidate && ["source", "model", "provider"].every(name => text(provenance[`resolved_${name}`]) && candidate[`${name}_id`] === provenance[`resolved_${name}`]) ? [{ candidate, candidateIndex }] : [];
      });
      if (resolved.length === 1) add("executionTruth", resolved[0]!.candidate.execution_truth, `${sourcePath}.payload.routing_provenance.candidate_set[${resolved[0]!.candidateIndex}].execution_truth`);
      else if (resolved.length > 1) issues.push(`${sourcePath}.payload.routing_provenance: ambiguous resolved candidate`);
    }
  }
  if (final) {
    field("issuedAtMasterTime", ["issuedAtMasterTimeMs"]); field("evidenceSetDigest", ["evidenceSetDigest"]);
    for (const name of ["authorizationStatus", "transactionSubmissionStatus", "settlementStatus"]) field("outcome", ["financialClosure", name]);
  }
  // A supporting time receipt is displayed as a declaration, never trusted by its presence.
  if (Array.isArray(source) && !fields.some(entry => entry.key === "trustedTime")) {
    const times = source.flatMap((candidate, sourceIndex) => {
      const time = object(object(object(candidate)?.evidence_payload)?.trusted_time);
      return time?.subject_evidence_id === node.evidenceId ? [{ time, sourceIndex }] : [];
    });
    if (times.length === 1) for (const [key, name] of [["trustedTime", "trusted_time"], ["timeSource", "time_source_id"], ["timeProfile", "time_profile"]]) add(key!, times[0]!.time[name!], `sourceBundle.canonical_evidence_objects[${times[0]!.sourceIndex}].evidence_payload.trusted_time.${name}`);
    else if (times.length > 1) issues.push(`${sourcePath}: multiple supporting time declarations`);
  }
  return freeze({ status: "FOUND", sourcePath, raw: record, fields, issues });
}

export type InspectionBoundary = Readonly<{ key: string; kind: ReceivedCrossing["kind"]; from: string; to: string; edgeKeys: readonly string[] }>;
/** Group existing crossings only; grouping introduces no node or relation. */
export function groupInspectionBoundaries(graph: ReceivedGraph): readonly InspectionBoundary[] {
  const groups = new Map<string, { kind: ReceivedCrossing["kind"]; from: string; to: string; edgeKeys: Set<string> }>();
  for (const edge of graph.edges) for (const crossing of edge.crossings) {
    const key = JSON.stringify([crossing.kind, crossing.from.value, crossing.to.value]);
    const group = groups.get(key) ?? { kind: crossing.kind, from: crossing.from.value, to: crossing.to.value, edgeKeys: new Set<string>() };
    group.edgeKeys.add(edge.key); groups.set(key, group);
  }
  return freeze([...groups].map(([key, group]) => ({ key, ...group, edgeKeys: [...group.edgeKeys] })));
}

export type InspectionSelection = Readonly<{ nodeKey?: string; edgeKey?: string; boundaryKey?: string }>;
export type InspectionMode = "isolate" | "follow" | "path" | "all";
/** A selected fact and its declared direct causal neighbours only. This does
 * not walk ancestors or descendants and does not promote observed-only input. */
export function inspectionDirectCausalEmphasis(graph: ReceivedGraph, nodeKey: string) {
  const strong = new Set<string>(); const context = new Set<string>(); const strongEdges = new Set<string>();
  if (!graph.nodes.some((node) => node.key === nodeKey)) return { strong, context, strongEdges };
  strong.add(nodeKey);
  for (const edge of graph.edges) if (edge.causal && (edge.from === nodeKey || edge.to === nodeKey)) {
    strong.add(edge.from); strong.add(edge.to); strongEdges.add(edge.key);
  }
  return { strong, context, strongEdges };
}
export function inspectionEmphasis(graph: ReceivedGraph, selection: InspectionSelection, mode: InspectionMode, path: readonly string[]) {
  const present = new Set(graph.nodes.map(node => node.key));
  const strong = new Set<string>(); const context = new Set<string>(); const strongEdges = new Set<string>();
  const emphasize = (key: string) => { const edge = graph.edges.find(candidate => candidate.key === key); if (edge) { strongEdges.add(key); strong.add(edge.from); strong.add(edge.to); } };
  if (mode === "all") { for (const node of graph.nodes) strong.add(node.key); for (const edge of graph.edges) strongEdges.add(edge.key); }
  else if (selection.boundaryKey) {
    const boundaryEdges = groupInspectionBoundaries(graph).find(group => group.key === selection.boundaryKey)?.edgeKeys ?? [];
    if (selection.edgeKey && boundaryEdges.includes(selection.edgeKey)) emphasize(selection.edgeKey);
    else for (const key of boundaryEdges) emphasize(key);
  } else {
    if (mode === "path") {
      for (const key of path) if (present.has(key)) strong.add(key);
      for (let i = 1; i < path.length; i++) for (const edge of graph.edges) if (edge.causal && edge.from === path[i - 1] && edge.to === path[i]) strongEdges.add(edge.key);
    }
    if (selection.nodeKey && present.has(selection.nodeKey)) strong.add(selection.nodeKey);
    if (selection.edgeKey) emphasize(selection.edgeKey);
  }
  if (mode === "follow") {
    const seeds = [...strong];
    for (const direction of ["parents", "children"] as const) {
      const visited = new Set(seeds); const queue = [...seeds];
      for (let i = 0; i < queue.length; i++) for (const edge of graph.edges) {
        if (!edge.causal || (direction === "parents" ? edge.to : edge.from) !== queue[i]) continue;
        const adjacent = direction === "parents" ? edge.from : edge.to;
        strong.add(adjacent); strongEdges.add(edge.key);
        if (!visited.has(adjacent)) { visited.add(adjacent); queue.push(adjacent); }
      }
    }
  }
  for (const edge of graph.edges) if (strong.has(edge.from) || strong.has(edge.to)) {
    if (!strong.has(edge.from)) context.add(edge.from);
    if (!strong.has(edge.to)) context.add(edge.to);
  }
  return { strong, context, strongEdges };
}

/** Aggregate coverage only. A passing signature check does not establish a payload's effect. */
export function inspectionCoverage(peb: ReceivedPebProjection, snapshot: D006VerdictSnapshot | null | undefined, node?: ReceivedGraphNode) {
  const bound = snapshot?.transferredContentDigest === peb.transferDigest;
  const completedChecks = bound ? [...snapshot!.result.completedChecks] : [];
  const closureChecked = completedChecks.includes("d006_final_receipt_closure");
  const signature: "BUNDLE_CHECK_PASSED" | "NO_INDIVIDUAL_SIGNATURE" | "NOT_ESTABLISHED" = !node || !bound || !closureChecked
    ? "NOT_ESTABLISHED" : node.member?.source === "SIGNED_CANONICAL"
      ? completedChecks.includes("canonical_signatures_verified") ? "BUNDLE_CHECK_PASSED" : "NOT_ESTABLISHED"
      : node.member?.source === "RUNTIME_JOURNAL" || node.final ? "NO_INDIVIDUAL_SIGNATURE" : "NOT_ESTABLISHED";
  const finalReceiptInput = !node?.evidenceId || !closureChecked ? null : peb.relations.some(relation => relation.kind === "FINAL_RECEIPT_INPUT" && relation.from === node.evidenceId && relation.referenceStatus === "PRESENT");
  return freeze({ bound, completedChecks, signature, finalReceiptInput });
}

export type InspectionNarrative = Readonly<{
  happened: string;
  established: readonly string[];
  notEstablished: readonly string[];
}>;

/** Deterministic human reading derived only from the received member, its
 * structured source object and checks bound to the same transferred bytes. */
export function inspectionNarrative(
  peb: ReceivedPebProjection,
  snapshot: D006VerdictSnapshot | null | undefined,
  graph: ReceivedGraph,
  node: ReceivedGraphNode,
  rawText: string,
  locale: "en" | "fr",
): InspectionNarrative {
  const fr = locale === "fr";
  const coverage = inspectionCoverage(peb, snapshot, node);
  const evidence = readInspectionEvidence(rawText, node);
  const uniqueIdentity = evidence.status === "FOUND" && !!node.evidenceId && graph.nodes.filter((candidate) => candidate.evidenceId === node.evidenceId).length === 1;
  const field = (key: string) => evidence.fields.find((entry) => entry.key === key)?.value;
  const happened = node.final
    ? (fr ? "Le reçu final rassemble les entrées déclarées de cette mission." : "The Final Receipt gathers the declared inputs for this mission.")
    : receivedEventLabel(node.member?.eventId, locale)
      ?? guidedStoryHumanCaption(node.context.label?.value, fr ? "Événement déclaré dans le PEB." : "Event declared in the PEB.");
  const established: string[] = [];
  if (coverage.bound && coverage.completedChecks.includes("d006_transferred_digest_exact")) {
    established.push(fr ? "L’analyse porte sur les mêmes octets que ce PEB reçu." : "The analysis is bound to the same bytes as this received PEB.");
  }
  if (node.final && coverage.completedChecks.includes("d006_final_receipt_closure")) {
    established.push(fr ? "La clôture du reçu final a été contrôlée." : "Final Receipt closure was checked.");
  } else {
    established.push(uniqueIdentity
      ? (fr ? "Cette déclaration est présente une fois dans le manifeste reçu et son objet source est résolu sans ambiguïté." : "This declaration appears once in the received manifest and its source object resolves unambiguously.")
      : evidence.status === "AMBIGUOUS"
        ? (fr ? "Cette déclaration est présente dans le manifeste reçu ; plusieurs objets sources correspondent à sa référence." : "This declaration is present in the received manifest; several source objects match its reference.")
        : (fr ? "Cette déclaration est présente dans le manifeste reçu ; aucun objet source unique n’est résolu." : "This declaration is present in the received manifest; no unique source object resolves."));
  }
  if (coverage.signature === "BUNDLE_CHECK_PASSED") {
    established.push(fr
      ? "Le contrôle global des signatures du sous-bundle a réussi pour ce paquet."
      : "The aggregate sub-bundle signature check passed for this package.");
  }
  const previous = field("previousNetworkState");
  const next = field("newNetworkState");
  if (previous && next) {
    established.push(fr
      ? `Le PEB enregistre une transition ${previous} → ${next} pendant cette mission.`
      : `The PEB records a ${previous} → ${next} transition during this mission.`);
  }
  const notEstablished: string[] = [];
  if (!node.final) {
    notEstablished.push(fr
      ? "Ces contrôles n’établissent pas, à eux seuls, que l’effet physique ou métier déclaré s’est produit."
      : "These checks do not, by themselves, establish that the declared physical or business effect occurred.");
  }
  if (coverage.signature === "BUNDLE_CHECK_PASSED") {
    notEstablished.push(fr
      ? "Le Vérificateur ne fournit pas de résultat de signature individuel pour ce NanoReceipt."
      : "The Verifier supplies no individual signature result for this NanoReceipt.");
  }
  if (/payment|bank|invoice|settlement/.test(node.member?.eventId ?? "")) {
    notEstablished.push(fr
      ? "Cette déclaration n’établit pas, à elle seule, un règlement financier ni une livraison."
      : "This declaration does not, by itself, establish financial settlement or delivery.");
  }
  if (notEstablished.length === 0) {
    notEstablished.push(fr
      ? "Aucune conclusion supplémentaire n’est ajoutée au verdict du paquet."
      : "No conclusion beyond the package verdict is added.");
  }
  return freeze({ happened, established, notEstablished });
}

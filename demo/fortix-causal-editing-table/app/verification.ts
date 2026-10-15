import { blake3 } from "@noble/hashes/blake3.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";

import finalReceiptFixture from "../data/d003-final-receipt.json" with { type: "json" };
import portableBundleFixture from "../data/d003-portable-evidence-bundle.json" with { type: "json" };
import {
  D004_ACTION_TIME_MS,
  resolveAuthorityAtSignedTime,
  type AuthorityEvidenceEnvelope,
} from "./authority.ts";

export type CanonicalVerdict = "VALID" | "INVALID" | "INDETERMINATE" | "REVOKED";
export type VerificationLayerStatus = "VERIFIED" | "INCOMPLETE" | "FAILED";

export type VerificationLayer = Readonly<{
  id:
    | "receipt_integrity"
    | "signature_authenticity"
    | "evidence_binding"
    | "causal_consistency"
    | "policy_binding"
    | "authority_lifecycle"
    | "authority_applicability"
    | "execution_binding"
    | "trust_time";
  label: string;
  status: VerificationLayerStatus;
}>;

export type IndependentVerificationResult = Readonly<{
  verdict: CanonicalVerdict;
  reasonCodes: readonly string[];
  layers: readonly VerificationLayer[];
  receiptId: string | null;
  bundleId: string | null;
  verificationProfile: "fortix.demo.independent-verification.v1";
}>;

export type PortableVerificationInput = Readonly<{
  portableBundle: unknown;
  authorityEvidence?: unknown;
  sourceClaimedVerdict?: CanonicalVerdict;
}>;

export const D003_FINAL_RECEIPT = Object.freeze(finalReceiptFixture);
export const D003_PORTABLE_BUNDLE = Object.freeze(portableBundleFixture);

const BUNDLE_ID_PREFIX = "fortix:peb:blake3:";
const EVIDENCE_ID_PREFIX = "fortix:evidence:blake3:";
const EXPECTED_BUNDLE_PROFILE = "fortix.peb.core.v1";
const EXPECTED_BUILDER_PROFILE = "fortix.peb.builder.v1";
const EXPECTED_CRYPTOGRAPHIC_PROFILE = "fortix.peb.blake3-ed25519.v1";
const EXPECTED_VERIFIER_PROFILE = "fortix.peb.verifier.v1";
const EXPECTED_COMPATIBILITY_PROFILE = "fortix.peb.compatibility.strict.v1";
const EXPECTED_ORDERING = "EXPLICIT_EVIDENCE_INDEX_V1";
const FINAL_RECEIPT_EVENT_ID = "d003.final-receipt.emergency-braking-before-impact";
export const INDEPENDENT_VERIFICATION_PROFILE = "fortix.demo.independent-verification.v1";

const LAYER_LABELS = {
  receipt_integrity: "Receipt integrity",
  signature_authenticity: "Signature / authenticity",
  evidence_binding: "Evidence binding",
  causal_consistency: "Causal consistency",
  policy_binding: "Policy binding",
  authority_lifecycle: "Authority lifecycle",
  authority_applicability: "Authority at signed action time",
  execution_binding: "Execution within authority",
  trust_time: "Trust / time status",
} as const;

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };

class VerificationFailure extends Error {
  readonly verdict: CanonicalVerdict;
  readonly reasonCode: string;
  readonly completedLayers: readonly VerificationLayer[];

  constructor(
    verdict: CanonicalVerdict,
    reasonCode: string,
    completedLayers: readonly VerificationLayer[],
  ) {
    super(reasonCode);
    this.verdict = verdict;
    this.reasonCode = reasonCode;
    this.completedLayers = completedLayers;
  }
}

export async function verifyPortableEvidenceBundle(
  input: PortableVerificationInput,
): Promise<IndependentVerificationResult> {
  // sourceClaimedVerdict is deliberately never read. The source cannot supply
  // or influence an independently recomputed verdict.
  const completed: VerificationLayer[] = [];
  let receiptId: string | null = null;
  let bundleId: string | null = null;
  try {
    const bundle = requireObject(deepCloneJson(input.portableBundle), "BUNDLE_SCHEMA_INVALID");
    requireExactKeys(bundle, [
      "bundle_manifest",
      "evidence_index",
      "canonical_evidence_objects",
      "causal_graph",
      "governance_material",
      "trust_material",
      "verification_manifest",
      "integrity_manifest",
    ], "BUNDLE_SCHEMA_INVALID");

    const manifest = requireObject(bundle.bundle_manifest, "BUNDLE_MANIFEST_INVALID");
    const verificationManifest = requireObject(
      bundle.verification_manifest,
      "VERIFICATION_MANIFEST_INVALID",
    );
    const integrityManifest = requireObject(bundle.integrity_manifest, "BUNDLE_DIGEST_INVALID");
    bundleId = requireString(manifest.bundle_id, "BUNDLE_ID_INVALID");

    requireEqual(manifest.bundle_version, "1.0", "BUNDLE_MANIFEST_INVALID");
    requireEqual(manifest.bundle_profile, EXPECTED_BUNDLE_PROFILE, "BUNDLE_PROFILE_UNSUPPORTED", "INDETERMINATE");
    requireEqual(manifest.builder_profile, EXPECTED_BUILDER_PROFILE, "BUNDLE_MANIFEST_INVALID");
    requireEqual(manifest.cryptographic_profile, EXPECTED_CRYPTOGRAPHIC_PROFILE, "BUNDLE_MANIFEST_INVALID");
    requireEqual(verificationManifest.required_verification_profile, EXPECTED_VERIFIER_PROFILE, "VERIFICATION_PROFILE_UNSUPPORTED", "INDETERMINATE");
    requireEqual(verificationManifest.supported_foundation_version, "1.0", "FOUNDATION_VERSION_UNSUPPORTED", "INDETERMINATE");
    requireEqual(verificationManifest.compatibility_profile, EXPECTED_COMPATIBILITY_PROFILE, "COMPATIBILITY_PROFILE_UNSUPPORTED", "INDETERMINATE");
    requireEqual(integrityManifest.deterministic_ordering, EXPECTED_ORDERING, "BUNDLE_ORDERING_INVALID");

    const objects = requireArray(bundle.canonical_evidence_objects, "BUNDLE_SCHEMA_INVALID")
      .map((value) => requireObject(value, "CANONICAL_SCHEMA_INVALID"));
    const index = requireArray(bundle.evidence_index, "EVIDENCE_INDEX_MISMATCH")
      .map((value) => requireObject(value, "EVIDENCE_INDEX_MISMATCH"));
    for (const field of ["object_count", "payload_count", "evidence_count"] as const) {
      requireEqual(integrityManifest[field], objects.length, "BUNDLE_COUNT_MISMATCH");
    }
    const claimedBundleDigest = requireHexDigest(
      integrityManifest.bundle_digest,
      "BUNDLE_DIGEST_INVALID",
    );
    const digestProbe = deepCloneJson(bundle) as JsonObject;
    (digestProbe.integrity_manifest as JsonObject).bundle_digest = "";
    requireEqual(
      claimedBundleDigest,
      digestCanonical(digestProbe),
      "BUNDLE_DIGEST_MISMATCH",
    );

    const identityManifest: JsonObject = {
      bundle_version: requireJsonValue(manifest.bundle_version),
      bundle_profile: requireJsonValue(manifest.bundle_profile),
      creation_time: requireJsonValue(manifest.creation_time),
      builder_profile: requireJsonValue(manifest.builder_profile),
      cryptographic_profile: requireJsonValue(manifest.cryptographic_profile),
    };
    requireEqual(
      bundleId,
      BUNDLE_ID_PREFIX + digestCanonical({
        bundle_manifest: identityManifest,
        ordered_evidence_objects: objects,
      }),
      "BUNDLE_ID_MISMATCH",
    );

    if (index.length !== objects.length || objects.length === 0) {
      fail("INVALID", "EVIDENCE_INDEX_MISMATCH", completed);
    }
    const evidenceById = new Map<string, JsonObject>();
    index.forEach((entry, ordinal) => {
      const evidence = objects[ordinal];
      const evidenceId = requireString(evidence.evidence_id, "CANONICAL_IDENTITY_INVALID");
      requireEqual(entry.ordinal, ordinal, "EVIDENCE_ORDINAL_INVALID");
      requireEqual(entry.evidence_id, evidenceId, "EVIDENCE_INDEX_MISMATCH");
      requireEqual(entry.evidence_type, evidence.evidence_type, "EVIDENCE_INDEX_MISMATCH");
      requireEqual(entry.object_digest, digestCanonical(evidence), "EVIDENCE_OBJECT_DIGEST_MISMATCH");
      if (evidenceById.has(evidenceId)) fail("INVALID", "DUPLICATE_EVIDENCE_ID", completed);
      evidenceById.set(evidenceId, evidence);
    });

    const targets = requireArray(
      verificationManifest.target_evidence_ids,
      "TARGET_EVIDENCE_INVALID",
    ).map((value) => requireString(value, "TARGET_EVIDENCE_INVALID"));
    if (targets.length !== 1 || !evidenceById.has(targets[0])) {
      fail("INDETERMINATE", "TARGET_EVIDENCE_MISSING", completed);
    }
    receiptId = targets[0];
    const finalReceipt = evidenceById.get(receiptId)!;
    const finalEvent = requireObject(finalReceipt.significant_event, "CANONICAL_SCHEMA_INVALID");
    requireEqual(finalEvent.event_id, FINAL_RECEIPT_EVENT_ID, "FINAL_RECEIPT_TARGET_INVALID");

    completed.push(verifiedLayer("receipt_integrity"));

    const trust = requireObject(bundle.trust_material, "TRUST_MATERIAL_MISSING");
    const verificationKeys = requireArray(
      trust.verification_keys,
      "VERIFICATION_KEY_MISSING",
    ).map((value) => requireObject(value, "VERIFICATION_KEY_INVALID"));
    if (verificationKeys.length === 0) {
      fail("INDETERMINATE", "VERIFICATION_KEY_MISSING", completed);
    }
    const keysById = new Map(
      verificationKeys.map((key) => [
        requireString(key.key_id, "VERIFICATION_KEY_INVALID"),
        key,
      ]),
    );

    for (const evidence of objects) {
      await verifyCanonicalEvidence(evidence, keysById, completed);
    }
    completed.push(verifiedLayer("signature_authenticity"));

    verifyEvidenceIndexAndTargetBinding(finalReceipt, evidenceById, completed);
    completed.push(verifiedLayer("evidence_binding"));

    verifyCausalGraph(bundle, objects, evidenceById, completed);
    completed.push(verifiedLayer("causal_consistency"));

    if (input.authorityEvidence !== undefined) {
      await verifyAuthorityToActionEvidence(
        input.authorityEvidence,
        evidenceById,
        keysById,
        completed,
      );
    }

    const trustLayer = verifyTrustAndTime(bundle, finalReceipt, evidenceById, completed);
    completed.push(trustLayer);
    if (trustLayer.status === "INCOMPLETE") {
      return result(
        "INDETERMINATE",
        ["D003_PRODUCTION_TRUST_TIME_INCOMPLETE"],
        completed,
        receiptId,
        bundleId,
      );
    }

    return result("VALID", ["NONE"], completed, receiptId, bundleId);
  } catch (error) {
    if (error instanceof VerificationFailure) {
      const failedLayers = [...error.completedLayers];
      const nextLayer = firstUnfinishedLayer(
        failedLayers,
        input.authorityEvidence !== undefined,
      );
      if (nextLayer !== null) failedLayers.push(failedLayer(nextLayer));
      return result(
        error.verdict,
        [error.reasonCode],
        failedLayers,
        receiptId,
        bundleId,
      );
    }
    return result(
      "INVALID",
      ["BUNDLE_SCHEMA_INVALID"],
      [failedLayer("receipt_integrity")],
      receiptId,
      bundleId,
    );
  }
}

export function createControlledTamper(portableBundle: unknown): unknown {
  const clone = deepCloneJson(portableBundle);
  const bundle = requireObject(clone, "BUNDLE_SCHEMA_INVALID");
  const objects = requireArray(bundle.canonical_evidence_objects, "BUNDLE_SCHEMA_INVALID");
  const target = objects
    .map((value) => requireObject(value, "CANONICAL_SCHEMA_INVALID"))
    .find((evidence) => {
      const event = requireObject(evidence.significant_event, "CANONICAL_SCHEMA_INVALID");
      return event.event_id === "d002.emergency-braking-decision";
    });
  if (target === undefined) throw new Error("D-003 tamper target is missing");
  const event = requireObject(target.significant_event, "CANONICAL_SCHEMA_INVALID");
  event.event_time = "2026-08-01T00:00:03.761Z";
  return clone;
}

async function verifyCanonicalEvidence(
  evidence: JsonObject,
  keysById: ReadonlyMap<string, JsonObject>,
  completed: readonly VerificationLayer[],
): Promise<void> {
  const payload = requireObject(evidence.evidence_payload, "CANONICAL_SCHEMA_INVALID");
  const integrity = requireObject(evidence.evidence_integrity, "CANONICAL_SCHEMA_INVALID");
  requireEqual(integrity.payload_digest, digestCanonical(payload), "PAYLOAD_DIGEST_MISMATCH");

  const claimedId = requireString(evidence.evidence_id, "CANONICAL_IDENTITY_INVALID");
  const identityObject = deepCloneJson(evidence) as JsonObject;
  delete identityObject.evidence_id;
  delete identityObject.signature;
  requireEqual(
    claimedId,
    EVIDENCE_ID_PREFIX + digestCanonical(identityObject),
    "CANONICAL_IDENTITY_MISMATCH",
  );

  const cryptoProfile = requireObject(
    evidence.cryptographic_profile,
    "CRYPTOGRAPHIC_PROFILE_UNSUPPORTED",
  );
  requireEqual(
    cryptoProfile.cryptographic_profile_id,
    "fortix.crypto.ed25519-blake3.v1",
    "CRYPTOGRAPHIC_PROFILE_UNSUPPORTED",
    "INDETERMINATE",
  );
  requireEqual(cryptoProfile.signature_algorithm, "Ed25519", "CRYPTOGRAPHIC_PROFILE_UNSUPPORTED", "INDETERMINATE");
  const keyId = requireString(cryptoProfile.key_id, "VERIFICATION_KEY_MISSING");
  const key = keysById.get(keyId);
  if (key === undefined) fail("INDETERMINATE", "VERIFICATION_KEY_MISSING", completed);
  requireEqual(key.trust_anchor_id, cryptoProfile.trust_anchor_id, "TRUST_ANCHOR_BINDING_MISMATCH");

  const signature = requireHexSignature(evidence.signature, "CANONICAL_SIGNATURE_INVALID");
  const signatureObject = deepCloneJson(evidence) as JsonObject;
  delete signatureObject.signature;
  const signatureDigest = digestCanonical(signatureObject);
  const valid = await verifyEd25519(
    requireHexDigest(key.public_key_hex, "VERIFICATION_KEY_INVALID"),
    signature,
    signatureDigest,
  );
  if (!valid) fail("INVALID", "CANONICAL_SIGNATURE_INVALID", completed);
}

function verifyEvidenceIndexAndTargetBinding(
  receipt: JsonObject,
  evidenceById: ReadonlyMap<string, JsonObject>,
  completed: readonly VerificationLayer[],
): void {
  const payload = requireObject(receipt.evidence_payload, "FINAL_RECEIPT_PAYLOAD_INVALID");
  const resultPayload = requireObject(payload.result, "FINAL_RECEIPT_PAYLOAD_INVALID");
  const scope = requireObject(resultPayload.evidence_scope, "FINAL_RECEIPT_PAYLOAD_INVALID");
  const scopeIds = requireArray(scope.evidence_ids, "FINAL_RECEIPT_SCOPE_INVALID")
    .map((value) => requireString(value, "FINAL_RECEIPT_SCOPE_INVALID"));
  if (scopeIds.length === 0 || scopeIds.some((evidenceId) => !evidenceById.has(evidenceId))) {
    fail("INDETERMINATE", "D003_REQUIRED_EVIDENCE_MISSING", completed);
  }
  requireEqual(
    scope.evidence_set_digest,
    digestCanonical(scopeIds),
    "FINAL_RECEIPT_SCOPE_DIGEST_MISMATCH",
  );
  const assessment = requireObject(resultPayload.assessment, "FINAL_RECEIPT_PAYLOAD_INVALID");
  const decisionTime = requireNumber(assessment.decision_time_ms, "FINAL_RECEIPT_PAYLOAD_INVALID");
  const commandTime = requireNumber(assessment.command_time_ms, "FINAL_RECEIPT_PAYLOAD_INVALID");
  const impactTime = requireNumber(assessment.impact_window_time_ms, "FINAL_RECEIPT_PAYLOAD_INVALID");
  if (!(decisionTime < commandTime && commandTime < impactTime)) {
    fail("INVALID", "D003_CLAIM_TEMPORAL_RELATION_INVALID", completed);
  }
}

function verifyCausalGraph(
  bundle: JsonObject,
  objects: readonly JsonObject[],
  evidenceById: ReadonlyMap<string, JsonObject>,
  completed: readonly VerificationLayer[],
): void {
  const graph = requireObject(bundle.causal_graph, "CAUSAL_GRAPH_MISMATCH");
  const nodes = requireArray(graph.nodes, "CAUSAL_GRAPH_MISMATCH")
    .map((value) => requireString(value, "CAUSAL_GRAPH_MISMATCH"));
  const expectedNodes = objects.map((evidence) => requireString(evidence.evidence_id, "CANONICAL_IDENTITY_INVALID"));
  requireEqual(canonicalString(nodes), canonicalString(expectedNodes), "CAUSAL_GRAPH_MISMATCH");

  const expectedEdges: JsonObject[] = [];
  const predecessors = new Map<string, string | null>();
  const chains = new Map<string, string>();
  for (const evidence of objects) {
    const evidenceId = requireString(evidence.evidence_id, "CANONICAL_IDENTITY_INVALID");
    const causal = requireObject(evidence.causal_links, "CAUSAL_LINK_INVALID");
    const predecessor = causal.predecessor_evidence_id === null
      ? null
      : requireString(causal.predecessor_evidence_id, "CAUSAL_LINK_INVALID");
    predecessors.set(evidenceId, predecessor);
    chains.set(evidenceId, requireString(causal.causal_chain_id, "CAUSAL_LINK_INVALID"));
    if (predecessor !== null) {
      if (!evidenceById.has(predecessor)) {
        fail("INDETERMINATE", "PREDECESSOR_EVIDENCE_MISSING", completed);
      }
      expectedEdges.push({
        predecessor_evidence_id: predecessor,
        successor_evidence_id: evidenceId,
      });
    }
  }
  requireEqual(canonicalString(graph.edges), canonicalString(expectedEdges), "CAUSAL_GRAPH_MISMATCH");
  for (const [evidenceId, predecessor] of predecessors) {
    if (predecessor !== null && chains.get(evidenceId) !== chains.get(predecessor)) {
      fail("INVALID", "CAUSAL_CHAIN_MISMATCH", completed);
    }
    const seen = new Set<string>();
    let current: string | null = evidenceId;
    while (current !== null) {
      if (seen.has(current)) fail("INVALID", "CAUSAL_CYCLE_DETECTED", completed);
      seen.add(current);
      current = predecessors.get(current) ?? null;
    }
  }
}

async function verifyAuthorityToActionEvidence(
  input: unknown,
  d003EvidenceById: ReadonlyMap<string, JsonObject>,
  keysById: ReadonlyMap<string, JsonObject>,
  completed: VerificationLayer[],
): Promise<void> {
  const envelope = requireObject(
    deepCloneJson(input),
    "D004_AUTHORITY_EVIDENCE_INVALID",
  );
  requireExactKeys(envelope, [
    "action_time",
    "authority_history",
    "bindings",
    "capability_state",
    "control_conditions",
    "governed_chain",
    "policy_artifact",
    "profile",
    "schema_version",
  ], "D004_AUTHORITY_EVIDENCE_INVALID");
  requireEqual(
    envelope.profile,
    "fortix.demo.authority-to-action.v1",
    "D004_AUTHORITY_PROFILE_UNSUPPORTED",
    "INDETERMINATE",
  );
  requireEqual(envelope.schema_version, "1.0", "D004_AUTHORITY_EVIDENCE_INVALID");
  requireEqual(
    envelope.action_time,
    "2026-08-01T00:00:03.760Z",
    "D004_AUTHORITY_TIME_BINDING_INVALID",
  );

  const chain = requireArray(envelope.governed_chain, "D004_AUTHORITY_EVIDENCE_INVALID")
    .map((value) => requireObject(value, "D004_AUTHORITY_EVIDENCE_INVALID"));
  const history = requireArray(envelope.authority_history, "D004_AUTHORITY_EVIDENCE_INVALID")
    .map((value) => requireObject(value, "D004_AUTHORITY_EVIDENCE_INVALID"));
  const signedEvidence = new Map<string, JsonObject>();
  for (const evidence of [...chain, ...history]) {
    const evidenceId = requireString(evidence.evidence_id, "CANONICAL_IDENTITY_INVALID");
    signedEvidence.set(evidenceId, evidence);
  }
  for (const evidence of signedEvidence.values()) {
    await verifyCanonicalEvidence(evidence, keysById, completed);
  }

  const byEvent = new Map(
    chain.map((evidence) => {
      const event = requireObject(evidence.significant_event, "D004_AUTHORITY_EVIDENCE_INVALID");
      return [requireString(event.event_id, "D004_AUTHORITY_EVIDENCE_INVALID"), evidence] as const;
    }),
  );
  const bindings = requireObject(envelope.bindings, "D004_AUTHORITY_BINDING_INVALID");
  const policyArtifact = requireObject(envelope.policy_artifact, "D004_POLICY_BINDING_MISMATCH");
  const intent = byEvent.get("d004.operational-intent");
  const policy = byEvent.get("d004.emergency-braking-policy-application");
  if (intent === undefined || policy === undefined) {
    fail("INDETERMINATE", "D004_POLICY_EVIDENCE_MISSING", completed);
  }
  const policyId = requireString(policy.evidence_id, "D004_POLICY_BINDING_MISMATCH");
  const intentId = requireString(intent.evidence_id, "D004_POLICY_BINDING_MISMATCH");
  const policyCausal = requireObject(policy.causal_links, "D004_POLICY_BINDING_MISMATCH");
  requireEqual(
    policyCausal.predecessor_evidence_id,
    intentId,
    "D004_POLICY_BINDING_MISMATCH",
  );
  requireEqual(
    bindings.operational_intent_evidence_id,
    intentId,
    "D004_POLICY_BINDING_MISMATCH",
  );
  requireEqual(
    bindings.policy_application_evidence_id,
    policyId,
    "D004_POLICY_BINDING_MISMATCH",
  );

  const policyDecision = requireObject(
    requireObject(policy.evidence_payload, "D004_POLICY_BINDING_MISMATCH").policy_decision,
    "D004_POLICY_BINDING_MISMATCH",
  );
  for (const field of ["policy_id", "policy_version", "policy_profile", "policy_authority_id"] as const) {
    requireEqual(policyDecision[field], policyArtifact[field], "D004_POLICY_BINDING_MISMATCH");
  }
  requireEqual(
    policyDecision.policy_digest,
    digestCanonical(policyArtifact),
    "D004_POLICY_DIGEST_MISMATCH",
  );
  requireEqual(policyDecision.evaluation_result, "ALLOW", "D004_POLICY_DECISION_NOT_ALLOW", "INDETERMINATE");
  const evaluationEvidence = requireObject(
    policyDecision.evaluation_evidence,
    "D004_POLICY_BINDING_MISMATCH",
  );
  for (const [bindingField, evidenceField] of [
    ["threshold_intent_evidence_id", "trigger_evidence_id"],
    ["braking_decision_evidence_id", "action_decision_evidence_id"],
  ] as const) {
    const evidenceId = requireString(bindings[bindingField], "D004_POLICY_BINDING_MISMATCH");
    requireEqual(evaluationEvidence[evidenceField], evidenceId, "D004_POLICY_BINDING_MISMATCH");
    if (!d003EvidenceById.has(evidenceId)) {
      fail("INDETERMINATE", "D004_REFERENCED_EVIDENCE_MISSING", completed);
    }
  }
  completed.push(verifiedLayer("policy_binding"));

  if (history.length === 0) {
    fail("INDETERMINATE", "D004_AUTHORITY_EVIDENCE_MISSING", completed);
  }
  const lifecycleTypes = new Set(
    history.map((evidence) => requireString(evidence.evidence_type, "D004_AUTHORITY_EVIDENCE_INVALID")),
  );
  if (lifecycleTypes.size !== 1 || !lifecycleTypes.has("POLICY_AUTHORITY_STATUS")) {
    fail("INVALID", "D004_AUTHORITY_EVIDENCE_INVALID", completed);
  }
  completed.push(verifiedLayer("authority_lifecycle"));

  let authorityResolution: ReturnType<typeof resolveAuthorityAtSignedTime>;
  try {
    authorityResolution = resolveAuthorityAtSignedTime(
      D004_ACTION_TIME_MS,
      envelope as unknown as AuthorityEvidenceEnvelope,
    );
  } catch {
    fail("INVALID", "D004_AUTHORITY_EVIDENCE_INVALID", completed);
  }
  if (!authorityResolution.actionAuthorized) {
    fail(authorityResolution.verdict, authorityResolution.reasonCode, completed);
  }
  const authorityId = authorityResolution.authorityEvidenceId;
  if (authorityId === null) {
    fail("INDETERMINATE", "D004_AUTHORITY_EVIDENCE_MISSING", completed);
  }
  requireEqual(
    bindings.authority_evidence_id,
    authorityId,
    "D004_AUTHORITY_BINDING_MISMATCH",
  );
  completed.push(verifiedLayer("authority_applicability"));

  const execution = byEvent.get("d004.authority-bound-brake-execution");
  const governedResult = byEvent.get("d004.authority-bound-action-result");
  if (execution === undefined || governedResult === undefined) {
    fail("INDETERMINATE", "D004_EXECUTION_EVIDENCE_MISSING", completed);
  }
  const executionId = requireString(execution.evidence_id, "D004_EXECUTION_BINDING_MISMATCH");
  requireEqual(
    requireObject(execution.causal_links, "D004_EXECUTION_BINDING_MISMATCH").predecessor_evidence_id,
    authorityId,
    "D004_EXECUTION_BINDING_MISMATCH",
  );
  const executionPayload = requireObject(
    requireObject(execution.evidence_payload, "D004_EXECUTION_BINDING_MISMATCH").execution,
    "D004_EXECUTION_BINDING_MISMATCH",
  );
  requireEqual(executionPayload.applicable_authority_evidence_id, authorityId, "D004_EXECUTION_BINDING_MISMATCH");
  requireEqual(bindings.execution_binding_evidence_id, executionId, "D004_EXECUTION_BINDING_MISMATCH");
  const commandId = requireString(bindings.brake_command_evidence_id, "D004_EXECUTION_BINDING_MISMATCH");
  requireEqual(executionPayload.observed_execution_evidence_id, commandId, "D004_EXECUTION_BINDING_MISMATCH");
  if (!d003EvidenceById.has(commandId)) {
    fail("INDETERMINATE", "D004_REFERENCED_EVIDENCE_MISSING", completed);
  }

  requireEqual(
    requireObject(governedResult.causal_links, "D004_EXECUTION_BINDING_MISMATCH").predecessor_evidence_id,
    executionId,
    "D004_EXECUTION_BINDING_MISMATCH",
  );
  const resultPayload = requireObject(
    requireObject(governedResult.evidence_payload, "D004_EXECUTION_BINDING_MISMATCH").result,
    "D004_EXECUTION_BINDING_MISMATCH",
  );
  requireEqual(resultPayload.execution_binding_evidence_id, executionId, "D004_EXECUTION_BINDING_MISMATCH");
  const acknowledgementId = requireString(
    bindings.actuator_acknowledgement_evidence_id,
    "D004_EXECUTION_BINDING_MISMATCH",
  );
  requireEqual(
    resultPayload.actuator_acknowledgement_evidence_id,
    acknowledgementId,
    "D004_EXECUTION_BINDING_MISMATCH",
  );
  if (!d003EvidenceById.has(acknowledgementId)) {
    fail("INDETERMINATE", "D004_REFERENCED_EVIDENCE_MISSING", completed);
  }
  const physicalResultIds = requireArray(
    bindings.physical_result_evidence_ids,
    "D004_EXECUTION_BINDING_MISMATCH",
  ).map((value) => requireString(value, "D004_EXECUTION_BINDING_MISMATCH"));
  requireEqual(
    canonicalString(resultPayload.observed_result_evidence_ids),
    canonicalString(physicalResultIds),
    "D004_EXECUTION_BINDING_MISMATCH",
  );
  if (physicalResultIds.some((evidenceId) => !d003EvidenceById.has(evidenceId))) {
    fail("INDETERMINATE", "D004_REFERENCED_EVIDENCE_MISSING", completed);
  }
  completed.push(verifiedLayer("execution_binding"));
}

function verifyTrustAndTime(
  bundle: JsonObject,
  finalReceipt: JsonObject,
  evidenceById: ReadonlyMap<string, JsonObject>,
  completed: readonly VerificationLayer[],
): VerificationLayer {
  const trust = requireObject(bundle.trust_material, "TRUST_MATERIAL_MISSING");
  const anchorIds = requireArray(trust.trust_anchor_evidence_ids, "TRUST_MATERIAL_MISSING")
    .map((value) => requireString(value, "TRUST_MATERIAL_MISSING"));
  const timeIds = requireArray(trust.trusted_time_evidence_ids, "TRUST_MATERIAL_MISSING")
    .map((value) => requireString(value, "TRUST_MATERIAL_MISSING"));
  if (anchorIds.length === 0 || timeIds.length === 0) {
    fail("INDETERMINATE", "TRUST_MATERIAL_MISSING", completed);
  }
  const finalReceiptId = requireString(finalReceipt.evidence_id, "FINAL_RECEIPT_TARGET_INVALID");
  const trustedTime = timeIds
    .map((evidenceId) => evidenceById.get(evidenceId))
    .find((evidence) => {
      if (evidence === undefined) return false;
      const payload = requireObject(evidence.evidence_payload, "TRUST_MATERIAL_TYPE_INVALID");
      const time = requireObject(payload.trusted_time, "TRUST_MATERIAL_TYPE_INVALID");
      return time.subject_evidence_id === finalReceiptId;
    });
  if (trustedTime === undefined) fail("INDETERMINATE", "TRUSTED_TIME_EVIDENCE_MISSING", completed);
  const timePayload = requireObject(
    requireObject(trustedTime.evidence_payload, "TRUST_MATERIAL_TYPE_INVALID").trusted_time,
    "TRUST_MATERIAL_TYPE_INVALID",
  );
  requireEqual(timePayload.request_binding, digestCanonical(finalReceipt), "TRUSTED_TIME_BINDING_MISMATCH");

  const receiptPayload = requireObject(
    requireObject(finalReceipt.evidence_payload, "FINAL_RECEIPT_PAYLOAD_INVALID").result,
    "FINAL_RECEIPT_PAYLOAD_INVALID",
  );
  const scope = requireObject(receiptPayload.verification_scope, "FINAL_RECEIPT_PAYLOAD_INVALID");
  requireEqual(scope.profile, INDEPENDENT_VERIFICATION_PROFILE, "VERIFICATION_PROFILE_UNSUPPORTED", "INDETERMINATE");
  if (scope.trust_scope === "DEMO_ONLY" || scope.production_trust_time_complete !== true) {
    return incompleteLayer("trust_time");
  }
  return verifiedLayer("trust_time");
}

async function verifyEd25519(
  publicKeyHex: string,
  signatureHex: string,
  signedDigestHex: string,
): Promise<boolean> {
  try {
    const key = await globalThis.crypto.subtle.importKey(
      "raw",
      toArrayBuffer(hexToBytes(publicKeyHex)),
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    return await globalThis.crypto.subtle.verify(
      { name: "Ed25519" },
      key,
      toArrayBuffer(hexToBytes(signatureHex)),
      toArrayBuffer(utf8ToBytes(signedDigestHex)),
    );
  } catch {
    return false;
  }
}

function digestCanonical(value: unknown): string {
  return bytesToHex(blake3(utf8ToBytes(canonicalString(value))));
}

export function canonicalString(value: unknown): string {
  return JSON.stringify(sortJson(requireJsonValue(value)));
}

function sortJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortJson(value[key])]),
    );
  }
  return value;
}

function deepCloneJson(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(requireJsonValue(value))) as JsonValue;
}

function requireJsonValue(value: unknown): JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) return value;
  if (Array.isArray(value)) return value.map(requireJsonValue);
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, requireJsonValue(item)]),
    );
  }
  throw new TypeError("value is not canonical JSON");
}

function requireObject(value: unknown, reasonCode: string): JsonObject {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new VerificationFailure("INVALID", reasonCode, []);
  }
  return value as JsonObject;
}

function requireArray(value: unknown, reasonCode: string): JsonValue[] {
  if (!Array.isArray(value)) throw new VerificationFailure("INVALID", reasonCode, []);
  return value;
}

function requireString(value: unknown, reasonCode: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new VerificationFailure("INVALID", reasonCode, []);
  }
  return value;
}

function requireNumber(value: unknown, reasonCode: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new VerificationFailure("INVALID", reasonCode, []);
  }
  return value;
}

function requireHexDigest(value: unknown, reasonCode: string): string {
  const text = requireString(value, reasonCode);
  if (!/^[0-9a-f]{64}$/.test(text)) throw new VerificationFailure("INVALID", reasonCode, []);
  return text;
}

function requireHexSignature(value: unknown, reasonCode: string): string {
  const text = requireString(value, reasonCode);
  if (!/^[0-9a-f]{128}$/.test(text)) throw new VerificationFailure("INVALID", reasonCode, []);
  return text;
}

function requireExactKeys(
  value: JsonObject,
  keys: readonly string[],
  reasonCode: string,
): void {
  if (canonicalString(Object.keys(value).sort()) !== canonicalString([...keys].sort())) {
    throw new VerificationFailure("INVALID", reasonCode, []);
  }
}

function requireEqual(
  actual: unknown,
  expected: unknown,
  reasonCode: string,
  verdict: CanonicalVerdict = "INVALID",
): void {
  if (actual !== expected) throw new VerificationFailure(verdict, reasonCode, []);
}

function fail(
  verdict: CanonicalVerdict,
  reasonCode: string,
  completed: readonly VerificationLayer[],
): never {
  throw new VerificationFailure(verdict, reasonCode, completed);
}

function verifiedLayer(id: VerificationLayer["id"]): VerificationLayer {
  return { id, label: LAYER_LABELS[id], status: "VERIFIED" };
}

function incompleteLayer(id: VerificationLayer["id"]): VerificationLayer {
  return { id, label: LAYER_LABELS[id], status: "INCOMPLETE" };
}

function failedLayer(id: VerificationLayer["id"]): VerificationLayer {
  return { id, label: LAYER_LABELS[id], status: "FAILED" };
}

function firstUnfinishedLayer(
  completed: readonly VerificationLayer[],
  authorityRequired = false,
): VerificationLayer["id"] | null {
  const ids: readonly VerificationLayer["id"][] = [
    "receipt_integrity",
    "signature_authenticity",
    "evidence_binding",
    "causal_consistency",
    ...(authorityRequired
      ? ([
          "policy_binding",
          "authority_lifecycle",
          "authority_applicability",
          "execution_binding",
        ] as const)
      : []),
    "trust_time",
  ];
  return ids.find((id) => !completed.some((layer) => layer.id === id)) ?? null;
}

function result(
  verdict: CanonicalVerdict,
  reasonCodes: readonly string[],
  layers: readonly VerificationLayer[],
  receiptId: string | null,
  bundleId: string | null,
): IndependentVerificationResult {
  return {
    verdict,
    reasonCodes,
    layers,
    receiptId,
    bundleId,
    verificationProfile: INDEPENDENT_VERIFICATION_PROFILE,
  };
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer;
}

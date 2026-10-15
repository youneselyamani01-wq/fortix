import { blake3 } from "@noble/hashes/blake3.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

import { verifyD005MMasterBundle } from "./masterStory.ts";
import { isInMissionReconciliationReceipt } from "./offlineEvidence.ts";
import type { CycleVerificationResult } from "./operationalCycle.ts";
import {
  PortableMissionEvidenceError,
  buildMissionEvidenceClosure,
  buildPortableMissionEvidenceBundle,
  issueFinalMissionReceipt,
  transferredContentDigest,
  verifyBundleIntegrityManifest,
  type MissionIdentity,
  type PortableMissionEvidenceBundle,
} from "./portableMissionEvidence.ts";
import {
  FINAL_RECEIPT_EMITTED_MS,
  PEB_COMPLETE_MS,
} from "./storyTimeline.ts";
import { canonicalString, type CanonicalVerdict } from "./verification.ts";

export type OfflineVerificationNetworkPhase = "LOST" | "CONNECTED";

export type InsertedOfflinePeb = Readonly<{
  state: "AWAITING_ANALYZE";
  networkPhase: "LOST";
  expectedMissionId: string;
  pebText: string;
}>;

export type OfflineVerdictSnapshot = Readonly<{
  state: "CAPTURED_BEFORE_RESTORATION";
  analyzedManually: true;
  networkPhaseAtCapture: "LOST";
  missionId: string | null;
  pebDigest: string | null;
  finalReceiptDigest: string | null;
  causalOrderDigest: string | null;
  result: CycleVerificationResult;
}>;

export type ReconnectionComparison = Readonly<{
  captured: OfflineVerdictSnapshot;
  missionIdUnchanged: boolean;
  pebDigestUnchanged: boolean;
  finalReceiptDigestUnchanged: boolean;
  causalOrderUnchanged: boolean;
  verdictUnchanged: true;
  sourceClaimedVerdictAccepted: false;
}>;

export type OfflineNetworkAudit = Readonly<{
  snapshot: OfflineVerdictSnapshot;
  attemptedNetworkCalls: readonly string[];
  localOnly: boolean;
}>;

export type InsertedD006Peb = Readonly<{
  state: "AWAITING_ANALYZE";
  pebText: string;
  expectedIdentity: MissionIdentity;
  expectedTransferredContentDigest: string;
}>;

export type D006VerdictSnapshot = Readonly<{
  state: "ANALYZED";
  identity: MissionIdentity;
  transferredContentDigest: string;
  result: CycleVerificationResult;
}>;

type JsonObject = Record<string, unknown>;

/**
 * C1 insertion contract. Connectivity is deliberately absent: an independent
 * verifier analyzes the same bytes while CONNECTED or LOST. The exact digest
 * is supplied by the handoff artifact, not recomputed from a frozen singleton.
 */
export function insertD006PebForAnalysis(input: Readonly<{
  pebText: string;
  expectedIdentity: MissionIdentity;
  expectedTransferredContentDigest: string;
}>): InsertedD006Peb {
  if (input.pebText.length === 0
    || input.expectedIdentity.missionId.length === 0
    || input.expectedIdentity.runId.length === 0
    || !/^[0-9a-f]{64}$/i.test(input.expectedTransferredContentDigest)) {
    throw new TypeError("PEB text, Mission/Run identity and exact transferred digest are required");
  }
  return deepFreeze({
    state: "AWAITING_ANALYZE" as const,
    pebText: input.pebText,
    expectedIdentity: { ...input.expectedIdentity },
    expectedTransferredContentDigest: input.expectedTransferredContentDigest.toLowerCase(),
  });
}

export async function analyzeInsertedD006Peb(
  inserted: InsertedD006Peb,
): Promise<D006VerdictSnapshot> {
  const result = await verifyD006PortableMissionEvidence(inserted.pebText, {
    expectedIdentity: inserted.expectedIdentity,
    expectedTransferredContentDigest: inserted.expectedTransferredContentDigest,
  });
  return deepFreeze({
    state: "ANALYZED" as const,
    identity: inserted.expectedIdentity,
    transferredContentDigest: inserted.expectedTransferredContentDigest,
    result,
  });
}

export async function verifyD006PortableMissionEvidence(
  pebText: string,
  expectation: Readonly<{
    expectedIdentity: MissionIdentity;
    expectedTransferredContentDigest: string;
  }>,
): Promise<CycleVerificationResult> {
  const actualTransferredDigest = transferredContentDigest(pebText);
  if (actualTransferredDigest !== expectation.expectedTransferredContentDigest.toLowerCase()) {
    return invalidResult("D006_PEB_TRANSFER_DIGEST_MISMATCH");
  }

  let candidate: PortableMissionEvidenceBundle;
  try {
    candidate = requireD006Peb(JSON.parse(pebText));
    // A PEB is canonical JSON. A number JSON cannot round-trip (1e400 parses
    // as Infinity) has no digest: the bytes are refused here, never thrown on.
    canonicalString(candidate);
  } catch {
    return invalidResult("D006_PEB_TEXT_INVALID");
  }
  if (candidate.identity.missionId !== expectation.expectedIdentity.missionId
    || candidate.identity.runId !== expectation.expectedIdentity.runId) {
    return invalidResult("D006_MISSION_RUN_IDENTITY_MISMATCH", candidate.finalReceipt?.receiptId ?? null);
  }
  if (!verifyBundleIntegrityManifest(candidate)) {
    return invalidResult("D006_PEB_BUNDLE_DIGEST_MISMATCH", candidate.finalReceipt.receiptId);
  }

  const nested = await verifyD005MMasterBundle(candidate.sourceBundle);
  if (nested.verdict === "INVALID" || nested.verdict === "REVOKED") {
    return {
      ...nested,
      receiptId: candidate.finalReceipt.receiptId,
      bundleId: candidate.bundleId,
    };
  }

  try {
    const closure = buildMissionEvidenceClosure({
      identity: candidate.identity,
      sourceBundle: candidate.sourceBundle,
      runtimeRecords: candidate.runtimeRecords,
      asOfMasterTimeMs: FINAL_RECEIPT_EMITTED_MS,
    });
    const receipt = issueFinalMissionReceipt(closure, FINAL_RECEIPT_EMITTED_MS);
    const rebuilt = buildPortableMissionEvidenceBundle({
      closure,
      finalReceipt: receipt,
      sourceBundle: candidate.sourceBundle,
      runtimeRecords: candidate.runtimeRecords,
      displayedEvidenceIds: candidate.manifest.presentationEvidenceIds,
      masterTimeMs: PEB_COMPLETE_MS,
    });
    if (canonicalString(rebuilt) !== canonicalString(candidate)) {
      return invalidResult("D006_PEB_CLOSURE_MISMATCH", candidate.finalReceipt.receiptId);
    }
    if (receipt.financialClosure.settlementStatus !== "NOT_DEMONSTRATED") {
      return invalidResult("D006_FINANCIAL_SETTLEMENT_UNSUPPORTED", receipt.receiptId);
    }
    return {
      verdict: nested.verdict,
      reasonCodes: [...new Set([
        ...nested.reasonCodes,
        ...(receipt.financialClosure.unsupportedClaimEvidenceIds.length > 0
          ? ["D006_SETTLEMENT_ASSERTION_QUARANTINED"]
          : []),
      ])],
      completedChecks: [...new Set([
        ...nested.completedChecks,
        "d006_transferred_digest_exact",
        "d006_mission_run_identity",
        "d006_runtime_record_digests",
        "d006_displayed_peb_coverage",
        "d006_final_receipt_closure",
        "d006_financial_non_settlement",
        // D-006, 2026-10-08: every in-mission reconciliation receipt the PEB
        // carries was admitted by the closure above — bound to the journal
        // prefix it names. Consistency with the PEB's own records, not an
        // independent witness of the base.
        ...(candidate.runtimeRecords.some(isInMissionReconciliationReceipt)
          ? ["d006_in_mission_reconciliation_consistent"]
          : []),
      ])],
      receiptId: receipt.receiptId,
      bundleId: rebuilt.bundleId,
    };
  } catch (error) {
    const reasonCode = error instanceof PortableMissionEvidenceError
      ? `D006_${error.reasonCode}`
      : "D006_PEB_SCHEMA_INVALID";
    return invalidResult(reasonCode, candidate.finalReceipt.receiptId);
  }
}

/**
 * Inserts detached PEB text into the verifier's memory. Parsing and
 * verification deliberately do not happen here: ANALYZE is a separate,
 * explicit action represented by analyzeInsertedPebOffline().
 */
export function insertPebForOfflineAnalysis(input: Readonly<{
  pebText: string;
  expectedMissionId: string;
  networkPhase: OfflineVerificationNetworkPhase;
}>): InsertedOfflinePeb {
  if (input.networkPhase !== "LOST") {
    throw new TypeError("Offline PEB insertion requires the stable LOST network phase");
  }
  if (input.pebText.length === 0 || input.expectedMissionId.length === 0) {
    throw new TypeError("PEB text and expected Mission ID are required");
  }
  return Object.freeze({
    state: "AWAITING_ANALYZE",
    networkPhase: "LOST",
    expectedMissionId: input.expectedMissionId,
    pebText: input.pebText,
  });
}

/**
 * Runs the existing canonical D-005M verifier against JSON already held in
 * memory. No transport, remote schema, remote key or remote asset is accepted
 * by this API. The resulting identity snapshot is recursively frozen while
 * the network is still LOST.
 */
export async function analyzeInsertedPebOffline(
  inserted: InsertedOfflinePeb,
): Promise<OfflineVerdictSnapshot> {
  let portableBundle: unknown;
  try {
    portableBundle = JSON.parse(inserted.pebText);
  } catch {
    return freezeSnapshot({
      state: "CAPTURED_BEFORE_RESTORATION",
      analyzedManually: true,
      networkPhaseAtCapture: "LOST",
      missionId: null,
      pebDigest: null,
      finalReceiptDigest: null,
      causalOrderDigest: null,
      result: invalidResult("D006D_PEB_TEXT_INVALID"),
    });
  }

  const identity = derivePortableIdentity(portableBundle);
  let result = await verifyD005MMasterBundle(portableBundle);
  if (result.verdict !== "INVALID" && identity.missionId !== inserted.expectedMissionId) {
    result = invalidResult("D006D_MISSION_ID_MISMATCH", result.receiptId);
  }

  return freezeSnapshot({
    state: "CAPTURED_BEFORE_RESTORATION",
    analyzedManually: true,
    networkPhaseAtCapture: "LOST",
    ...identity,
    result,
  });
}

/**
 * Compares post-reconnection bytes with the pre-restoration capture. It never
 * re-verifies into, mutates or replaces the captured verdict. A verdict
 * supplied by a synchronization peer is intentionally ignored.
 */
export function compareAfterReconnection(
  captured: OfflineVerdictSnapshot,
  input: Readonly<{
    pebText: string;
    expectedMissionId: string;
    sourceClaimedVerdict?: CanonicalVerdict;
  }>,
): ReconnectionComparison {
  let identity: ReturnType<typeof derivePortableIdentity>;
  try {
    identity = derivePortableIdentity(JSON.parse(input.pebText));
  } catch {
    identity = emptyIdentity();
  }

  return deepFreeze({
    captured,
    missionIdUnchanged:
      input.expectedMissionId === captured.missionId && identity.missionId === captured.missionId,
    pebDigestUnchanged: identity.pebDigest === captured.pebDigest,
    finalReceiptDigestUnchanged: identity.finalReceiptDigest === captured.finalReceiptDigest,
    causalOrderUnchanged: identity.causalOrderDigest === captured.causalOrderDigest,
    verdictUnchanged: true,
    sourceClaimedVerdictAccepted: false,
  });
}

/**
 * Runtime audit helper for tests and physical-demo preflight. It turns fetch
 * into a recording tripwire while the manual analysis runs. The canonical
 * offline path should therefore finish with zero attempted calls.
 */
export async function auditOfflineAnalysisNetworkIsolation(
  inserted: InsertedOfflinePeb,
): Promise<OfflineNetworkAudit> {
  const attemptedNetworkCalls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: string | URL | Request): Promise<Response> => {
    attemptedNetworkCalls.push(String(input));
    throw new TypeError("Network access is forbidden during offline verification");
  };
  try {
    const snapshot = await analyzeInsertedPebOffline(inserted);
    return deepFreeze({
      snapshot,
      attemptedNetworkCalls,
      localOnly: attemptedNetworkCalls.length === 0,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function requireD006Peb(value: unknown): PortableMissionEvidenceBundle {
  const bundle = object(value);
  if (bundle.profile !== "fortix.demo.d006.peb.v1") throw new TypeError("D-006 PEB profile required");
  if (typeof bundle.bundleId !== "string" || bundle.bundleId.length === 0) throw new TypeError("bundle id required");
  const identity = object(bundle.identity);
  if (typeof identity.missionId !== "string" || typeof identity.runId !== "string") {
    throw new TypeError("Mission/Run identity required");
  }
  object(bundle.sourceBundle);
  if (!Array.isArray(bundle.runtimeRecords)) throw new TypeError("runtime records required");
  const finalReceipt = object(bundle.finalReceipt);
  if (finalReceipt.profile !== "fortix.demo.d006.final-receipt.v1"
    || typeof finalReceipt.receiptId !== "string") {
    throw new TypeError("D-006 Final Receipt required");
  }
  const manifest = object(bundle.manifest);
  if (!Array.isArray(manifest.memberRefs)
    || !Array.isArray(manifest.presentationEvidenceIds)
    || !Array.isArray(manifest.assuranceSupportEvidenceIds)
    || typeof manifest.bundleDigest !== "string") {
    throw new TypeError("D-006 PEB manifest invalid");
  }
  return bundle as unknown as PortableMissionEvidenceBundle;
}

function derivePortableIdentity(portableBundle: unknown): Readonly<{
  missionId: string | null;
  pebDigest: string | null;
  finalReceiptDigest: string | null;
  causalOrderDigest: string | null;
}> {
  try {
    const bundle = object(portableBundle);
    object(bundle.integrity_manifest);
    const digestProbe = clone(bundle);
    object(digestProbe.integrity_manifest).bundle_digest = "";
    const pebDigest = digestCanonical(digestProbe);
    const verification = object(bundle.verification_manifest);
    const targets = array(verification.target_evidence_ids);
    const targetId = targets.length === 1 && typeof targets[0] === "string" ? targets[0] : null;
    const objects = array(bundle.canonical_evidence_objects).map(object);
    const receipt = targetId === null
      ? null
      : objects.find((candidate) => candidate.evidence_id === targetId) ?? null;
    const causalGraph = object(bundle.causal_graph);
    const missionId = receipt === null
      ? null
      : optionalText(object(receipt.causal_links).causal_chain_id);
    return {
      missionId,
      pebDigest,
      finalReceiptDigest: receipt === null ? null : digestCanonical(receipt),
      causalOrderDigest: digestCanonical({
        nodes: causalGraph.nodes,
        edges: causalGraph.edges,
      }),
    };
  } catch {
    return emptyIdentity();
  }
}

function emptyIdentity(): Readonly<{
  missionId: null;
  pebDigest: null;
  finalReceiptDigest: null;
  causalOrderDigest: null;
}> {
  return {
    missionId: null,
    pebDigest: null,
    finalReceiptDigest: null,
    causalOrderDigest: null,
  };
}

function invalidResult(
  reasonCode: string,
  receiptId: string | null = null,
): CycleVerificationResult {
  return {
    verdict: "INVALID",
    reasonCodes: [reasonCode],
    completedChecks: [],
    receiptId,
    bundleId: null,
  };
}

function freezeSnapshot(snapshot: OfflineVerdictSnapshot): OfflineVerdictSnapshot {
  return deepFreeze(snapshot);
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function digestCanonical(value: unknown): string {
  return bytesToHex(blake3(utf8ToBytes(canonicalString(value))));
}

function clone(value: unknown): JsonObject {
  return object(JSON.parse(JSON.stringify(value)));
}

function object(value: unknown): JsonObject {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new TypeError("object required");
  }
  return value as JsonObject;
}

function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new TypeError("array required");
  return value;
}

function optionalText(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

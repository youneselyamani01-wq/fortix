import { blake3 } from "@noble/hashes/blake3.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

import {
  D005M_MASTER_BUNDLE,
  D005M_MASTER_BUNDLE_TEXT,
  D005M_MASTER_CYCLE_RECEIPT_ID,
  MASTER_EVIDENCE_EVENTS,
} from "./masterStory.ts";
import {
  MISSION_EVIDENCE_SPECS,
  ROUTING_PROVENANCE_EVENT_ID,
  specTime,
  type MissionEvidenceSpec,
} from "./missionEvidence.ts";
import { MISSION_ID } from "./missionContinuity.ts";
import {
  canonicalRecordDigest,
  inMissionReconciliationBindings,
  isInMissionReconciliationReceipt,
  isSpecializedRecordProjectionValid,
  journalNetworkState,
  sealedFinalReceiptRuntimeRecords,
  type OfflineCausalRecord,
  type OfflineEvidenceSession,
} from "./offlineEvidence.ts";
import {
  deriveFinancialClosure,
  type FinancialClosure,
} from "./settlementScope.ts";
import {
  CANONICAL_ROUTING_PROVENANCE,
  createRoutingProvenance,
  type RoutingCandidate,
  type RoutingFallback,
  type RoutingProvenance,
  type ResultingRoute,
} from "./routingProvenance.ts";
import {
  FINAL_RECEIPT_EMITTED_MS,
  FINAL_REQUIRED_LEAF_MATURE_MS,
  HANDOFF_READY_MS,
  PEB_COMPLETE_MS,
  REQUIRED_RUNTIME_EVIDENCE_CUTOFF_EXCLUSIVE_MS,
} from "./storyTimeline.ts";
import { canonicalString } from "./verification.ts";
import {
  HUMAN_AUTHORITY_DECISION_EVENT_TYPE,
  isHumanAuthorityDenialRecord,
} from "./humanAuthorityEvidence.ts";

/**
 * Stable identity of one enactment of the canonical mission. This is
 * deliberately structural rather than inferred from a journal record: the
 * session, receipt, PEB and verifier all bind the same independent contract.
 */
export type MissionIdentity = Readonly<{
  missionId: string;
  runId: string;
}>;

/**
 * Returns the exact append-only journal prefix sealed at Final Receipt
 * emission. Mission observation time is deliberately irrelevant: a physical
 * event observed after issuance while the viewer is rewound is still a later
 * append, and therefore stays outside these bytes forever.
 */
export function finalReceiptRuntimeEvidencePrefix(
  session: OfflineEvidenceSession,
): readonly OfflineCausalRecord[] {
  const seal = session.finalReceiptRuntimeSeal;
  const records = sealedFinalReceiptRuntimeRecords(session);
  if (seal === null || records === null
    || seal.sealedAtMasterTimeMs !== FINAL_RECEIPT_EMITTED_MS) {
    throw new PortableMissionEvidenceError(
      "FINAL_RECEIPT_RUNTIME_EVIDENCE_UNSEALED",
      "Final Receipt support requires the exact durable journal boundary sealed at emission",
    );
  }
  return freeze([...records]);
}

export type EvidenceMemberSource =
  | "SIGNED_CANONICAL"
  | "RUNTIME_JOURNAL"
  | "D006_FINAL_RECEIPT";

export type EvidenceMemberRef = Readonly<{
  evidenceId: string;
  digest: string;
  eventId: string;
  receiptId: string;
  producerDomain: string;
  causalParents: readonly string[];
  /** Cross-domain evidence inputs observed by this member, never commands. */
  observedInputs: readonly string[];
  timeMs: number;
  source: EvidenceMemberSource;
  presentation: "PRESENTED" | "ASSURANCE_SUPPORT";
  assurance: "ELIGIBLE" | "QUARANTINED";
}>;

export type MissionEvidenceClosure = Readonly<{
  profile: "fortix.demo.d006.mission-evidence-closure.v1";
  identity: MissionIdentity;
  asOfMasterTimeMs: number;
  members: readonly EvidenceMemberRef[];
  presentationEvidenceIds: readonly string[];
  assuranceSupportEvidenceIds: readonly string[];
  causalInputEvidenceIds: readonly string[];
  evidenceSetDigest: string;
  financialClosure: FinancialClosure;
}>;

export type FinalMissionReceipt = Readonly<{
  profile: "fortix.demo.d006.final-receipt.v1";
  identity: MissionIdentity;
  eventId: "d006.final-mission-receipt";
  receiptId: string;
  issuedAtMasterTimeMs: typeof FINAL_RECEIPT_EMITTED_MS;
  causalInputEvidenceIds: readonly string[];
  evidenceSetDigest: string;
  financialClosure: FinancialClosure;
}>;

export type PortableMissionEvidenceBundle = Readonly<{
  profile: "fortix.demo.d006.peb.v1";
  bundleId: string;
  identity: MissionIdentity;
  sourceBundle: unknown;
  runtimeRecords: readonly OfflineCausalRecord[];
  finalReceipt: FinalMissionReceipt;
  manifest: Readonly<{
    memberRefs: readonly EvidenceMemberRef[];
    presentationEvidenceIds: readonly string[];
    assuranceSupportEvidenceIds: readonly string[];
    bundleDigest: string;
  }>;
}>;

export type HandoffArtifact = Readonly<{
  identity: MissionIdentity;
  finalReceipt: FinalMissionReceipt;
  peb: PortableMissionEvidenceBundle;
  pebText: string;
  transferredContentDigest: string;
  handoffReadyAtMasterTimeMs: typeof HANDOFF_READY_MS;
}>;

type JsonObject = Record<string, unknown>;

const PROFILE = "fortix.demo.d006.mission-evidence-closure.v1" as const;
const FINAL_RECEIPT_PROFILE = "fortix.demo.d006.final-receipt.v1" as const;
const PEB_PROFILE = "fortix.demo.d006.peb.v1" as const;
const FINAL_EVENT_ID = "d006.final-mission-receipt" as const;
const RUNTIME_PRESENTATION_DOMAINS = new Set([
  "SMART_CITY_INFRASTRUCTURE",
  "AUTONOMOUS_VEHICLE",
  "ROUTING_ORCHESTRATOR",
  "PAYMENT_PROVIDER",
  "FINANCIAL_INSTITUTION",
  // NX0 §50: the live human DENY is presented evidence in the authority lane.
  "HUMAN_APPROVER",
]);
const RUNTIME_PRESENTATION_EVENT_TYPES = new Set([
  "NETWORK_LINK_LOST",
  "NETWORK_LINK_RESTORED",
  "RECONCILIATION_RECEIPT",
  "MISSION_COMPLETED_OFFLINE",
]);

export class PortableMissionEvidenceError extends TypeError {
  readonly reasonCode: string;

  constructor(reasonCode: string, message: string) {
    super(message);
    this.name = "PortableMissionEvidenceError";
    this.reasonCode = reasonCode;
  }
}

export function buildMissionEvidenceClosure(input: Readonly<{
  identity: MissionIdentity;
  runtimeRecords: readonly OfflineCausalRecord[];
  asOfMasterTimeMs: number;
  sourceBundle?: unknown;
}>): MissionEvidenceClosure {
  requireIdentity(input.identity);
  requireFiniteTime(input.asOfMasterTimeMs, "CLOSURE_TIME_INVALID");
  const sourceBundle = input.sourceBundle ?? D005M_MASTER_BUNDLE;
  if (canonicalString(sourceBundle) !== D005M_MASTER_BUNDLE_TEXT) {
    throw new PortableMissionEvidenceError(
      "SOURCE_BUNDLE_NOT_IMMUTABLE",
      "the D-006 wrapper must carry the exact immutable signed D-005M source bundle",
    );
  }

  const sourceObjects = canonicalEvidenceObjects(sourceBundle);
  requireSourceMissionIdentity(input.identity, sourceBundle, sourceObjects);
  const settlement = deriveFinancialClosure(sourceObjects, input.runtimeRecords);
  const quarantined = new Set(settlement.unsupportedClaimEvidenceIds);
  const masterByEvidenceId = new Map(MASTER_EVIDENCE_EVENTS.map((event) => [event.evidence_id, event]));
  const masterEvidenceByEventId = signedEvidenceByEventId();
  const evidenceReferenceByEventId = canonicalEvidenceReferenceByEventId();
  const members: EvidenceMemberRef[] = sourceObjects.map((candidate) => {
    const object = asObject(candidate, "SOURCE_EVIDENCE_OBJECT_INVALID");
    const evidenceId = requireText(object.evidence_id, "SOURCE_EVIDENCE_ID_INVALID");
    const master = masterByEvidenceId.get(evidenceId);
    const eventId = readNestedText(object, "significant_event", "event_id") ?? `support:${evidenceId}`;
    const presented = master !== undefined && evidenceId !== D005M_MASTER_CYCLE_RECEIPT_ID;
    return freeze({
      evidenceId,
      digest: digestCanonical(object),
      eventId,
      receiptId: evidenceId,
      producerDomain: canonicalProducerDomain(object),
      causalParents: canonicalCausalParents(object),
      observedInputs: [],
      timeMs: master?.time_ms ?? 0,
      source: "SIGNED_CANONICAL" as const,
      presentation: presented ? "PRESENTED" as const : "ASSURANCE_SUPPORT" as const,
      assurance: quarantined.has(evidenceId) ? "QUARANTINED" as const : "ELIGIBLE" as const,
    });
  });

  const seenEvents = new Set<string>();
  const seenReceipts = new Set<string>();
  const reconciledWindows = new Set<string>();
  // Every in-mission receipt's binding, computed once (linear) at the first one met.
  let reconciliationBindings: ReadonlyMap<number, boolean> | null = null;
  for (const [index, record] of input.runtimeRecords.entries()) {
    if (record.missionId !== input.identity.missionId || record.runId !== input.identity.runId) {
      throw new PortableMissionEvidenceError(
        "RUNTIME_IDENTITY_MISMATCH",
        "every runtime record must retain both the canonical Mission ID and active Run ID",
      );
    }
    if (record.canonicalDigest !== canonicalRecordDigest(record)) {
      throw new PortableMissionEvidenceError(
        "RUNTIME_RECORD_DIGEST_MISMATCH",
        `runtime record ${record.receiptId} no longer matches its canonical digest`,
      );
    }
    if (!isSpecializedRecordProjectionValid(record)) {
      throw new PortableMissionEvidenceError(
        "RUNTIME_RECORD_PROJECTION_MISMATCH",
        `runtime record ${record.receiptId} contradicts its canonical payload projection`,
      );
    }
    // The completion capture and the post-completion reconciliation occur
    // after this Final Receipt and can never support it. An IN-MISSION
    // reconciliation (D-006, 2026-10-08) happened before it, inside the
    // sealed journal: it is admitted only when the records before it bind it
    // exactly, and only once per offline window.
    const inMissionReconciliation = isInMissionReconciliationReceipt(record);
    if (record.eventType === "MISSION_COMPLETED_OFFLINE"
      || (record.eventType === "RECONCILIATION_RECEIPT" && !inMissionReconciliation)) {
      throw new PortableMissionEvidenceError(
        "RUNTIME_RESERVED_LIFECYCLE_INVALID",
        "completion capture and reconciliation occur after this Final Receipt and cannot support it",
      );
    }
    if (inMissionReconciliation) {
      const window = `${record.offlineWindowStartRef}->${record.offlineWindowEndRef}`;
      if (reconciliationBindings === null) {
        reconciliationBindings = inMissionReconciliationBindings(input.runtimeRecords, input.identity.missionId, input.identity.runId);
      }
      if (reconciledWindows.has(window) || reconciliationBindings.get(index) !== true) {
        throw new PortableMissionEvidenceError(
          "RUNTIME_RECONCILIATION_UNBOUND",
          `reconciliation receipt ${record.receiptId} is not what the journal prefix it names establishes`,
        );
      }
      reconciledWindows.add(window);
    }
    if (seenEvents.has(record.eventId) || seenReceipts.has(record.receiptId)) {
      throw new PortableMissionEvidenceError(
        "RUNTIME_RECORD_DUPLICATE",
        "runtime event and receipt identities must be unique inside one run",
      );
    }
    seenEvents.add(record.eventId);
    seenReceipts.add(record.receiptId);
    const prior = input.runtimeRecords[index - 1];
    if ((prior === undefined && record.causalPredecessors.length !== 0)
      || (prior !== undefined
        && (record.missionClockPosition <= prior.missionClockPosition
          || canonicalString(record.causalPredecessors) !== canonicalString([prior.receiptId])))) {
      throw new PortableMissionEvidenceError(
        "RUNTIME_CAUSAL_ORDER_INVALID",
        "runtime records must preserve strict journal order and the exact prior receipt predecessor",
      );
    }
    const requiredSpec = MISSION_EVIDENCE_SPECS.find((spec) => spec.eventId === record.eventId);
    const networkTransition = record.eventType === "NETWORK_LINK_LOST"
      || record.eventType === "NETWORK_LINK_RESTORED";
    if (requiredSpec !== undefined) {
      validateRequiredRuntimeRecord(record, requiredSpec, evidenceReferenceByEventId);
    }
    else if (record.eventType === HUMAN_AUTHORITY_DECISION_EVENT_TYPE) {
      // NX0 §50: the live human DENY is admitted in exactly one shape — caused
      // by the signed approval request, stating amount, limit and consequence.
      // Anything else wearing this event type stays outside the profile.
      if (!isHumanAuthorityDenialRecord(record)) {
        throw new PortableMissionEvidenceError(
          "RUNTIME_EVENT_NOT_ALLOWED",
          `runtime event ${record.eventId} is not the canonical human denial record`,
        );
      }
    }
    else if (!networkTransition && !inMissionReconciliation) {
      throw new PortableMissionEvidenceError(
        "RUNTIME_EVENT_NOT_ALLOWED",
        `runtime event ${record.eventId} is outside the closed D-006 Final Receipt profile`,
      );
    }
    const timeMs = runtimeEvidenceTime(record);
    if (timeMs > input.asOfMasterTimeMs) {
      throw new PortableMissionEvidenceError(
        "RUNTIME_EVIDENCE_AFTER_CLOSURE",
        "a closure cannot cite runtime evidence from after its as-of time",
      );
    }
    if (timeMs >= REQUIRED_RUNTIME_EVIDENCE_CUTOFF_EXCLUSIVE_MS) {
      throw new PortableMissionEvidenceError(
        "POST_FINAL_RUNTIME_EVIDENCE",
        "mission evidence authored at or after Final Receipt emission cannot support that receipt",
      );
    }
    const domain = readPayloadText(record, "trust_domain");
    const presented = RUNTIME_PRESENTATION_EVENT_TYPES.has(record.eventType)
      || (domain !== null && RUNTIME_PRESENTATION_DOMAINS.has(domain));
    members.push(freeze({
      evidenceId: record.receiptId,
      digest: record.canonicalDigest,
      eventId: record.eventId,
      receiptId: record.receiptId,
      producerDomain: domain ?? (RUNTIME_PRESENTATION_EVENT_TYPES.has(record.eventType) ? "NETWORK" : "RUNTIME"),
      causalParents: record.eventId === ROUTING_PROVENANCE_EVENT_ID
        ? routingTriggerEvidenceIds(record, masterEvidenceByEventId)
        : runtimeCausalParents(record),
      observedInputs: runtimeObservedInputs(record),
      timeMs,
      source: "RUNTIME_JOURNAL" as const,
      presentation: presented ? "PRESENTED" as const : "ASSURANCE_SUPPORT" as const,
      assurance: "ELIGIBLE" as const,
    }));
  }

  const networkJournalProbe: OfflineEvidenceSession = {
    version: 2,
    missionId: input.identity.missionId,
    runId: input.identity.runId,
    initialCausalPredecessor: null,
    networkState: "CONNECTED",
    records: input.runtimeRecords,
    preRestorationCapture: null,
    finalReceiptRuntimeSeal: null,
  };
  if (journalNetworkState(networkJournalProbe) === null) {
    throw new PortableMissionEvidenceError(
      "RUNTIME_RESERVED_LIFECYCLE_INVALID",
      "network evidence must preserve the canonical CONNECTED/LOST transition lifecycle",
    );
  }

  members.sort((left, right) => (
    left.timeMs - right.timeMs
    || sourceOrder(left.source) - sourceOrder(right.source)
    || left.evidenceId.localeCompare(right.evidenceId)
  ));
  const assuranceClosedMembers = propagateQuarantinedAssurance(members, quarantined);
  members.splice(0, members.length, ...assuranceClosedMembers);
  requireUniqueMemberIds(members);
  const includedEvidenceIds = new Set(members.map((member) => member.evidenceId));
  const unresolvedParent = members.find((member) => (
    [...member.causalParents, ...member.observedInputs]
      .some((parent) => !includedEvidenceIds.has(parent))
  ));
  if (unresolvedParent !== undefined) {
    throw new PortableMissionEvidenceError(
      "CAUSAL_CLOSURE_INCOMPLETE",
      `evidence ${unresolvedParent.evidenceId} names a causal parent absent from the portable closure`,
    );
  }

  const presentationEvidenceIds = members
    .filter((member) => member.presentation === "PRESENTED")
    .map((member) => member.evidenceId);
  const assuranceSupportEvidenceIds = members
    .filter((member) => member.presentation === "ASSURANCE_SUPPORT")
    .map((member) => member.evidenceId);
  const causalInputEvidenceIds = members
    .filter((member) => member.presentation === "PRESENTED" && member.assurance === "ELIGIBLE")
    .map((member) => member.evidenceId);
  const evidenceSetDigest = digestCanonical(members.map(memberDigestProjection));

  return freeze({
    profile: PROFILE,
    identity: freeze({ ...input.identity }),
    asOfMasterTimeMs: input.asOfMasterTimeMs,
    members: [...members],
    presentationEvidenceIds,
    assuranceSupportEvidenceIds,
    causalInputEvidenceIds,
    evidenceSetDigest,
    financialClosure: settlement,
  });
}

export function issueFinalMissionReceipt(
  closure: MissionEvidenceClosure,
  issuedAtMasterTimeMs: number,
): FinalMissionReceipt {
  if (issuedAtMasterTimeMs !== FINAL_RECEIPT_EMITTED_MS) {
    throw new PortableMissionEvidenceError(
      "FINAL_RECEIPT_TIME_INVALID",
      `the D-006 Final Receipt must emit at ${FINAL_RECEIPT_EMITTED_MS}`,
    );
  }
  if (closure.asOfMasterTimeMs < FINAL_REQUIRED_LEAF_MATURE_MS
    || closure.asOfMasterTimeMs !== FINAL_RECEIPT_EMITTED_MS) {
    throw new PortableMissionEvidenceError(
      "FINAL_RECEIPT_PREMATURE",
      "the Final Receipt cannot issue before leaf maturation and the exact emission boundary",
    );
  }
  requireRuntimeEvidenceComplete(closure);
  if (closure.financialClosure.authorizationStatus !== "AUTHORIZED"
    || closure.financialClosure.transactionSubmissionStatus !== "PRESENTED"
    || closure.financialClosure.settlementStatus !== "NOT_DEMONSTRATED") {
    throw new PortableMissionEvidenceError(
      "FINANCIAL_CLOSURE_INCOMPLETE",
      "the Final Receipt must preserve authorization, submission and non-settlement as distinct facts",
    );
  }

  const body = freeze({
    profile: FINAL_RECEIPT_PROFILE,
    identity: closure.identity,
    eventId: FINAL_EVENT_ID,
    issuedAtMasterTimeMs: FINAL_RECEIPT_EMITTED_MS,
    causalInputEvidenceIds: [...closure.causalInputEvidenceIds],
    evidenceSetDigest: closure.evidenceSetDigest,
    financialClosure: closure.financialClosure,
  });
  return freeze({
    ...body,
    receiptId: `fortix:receipt:blake3:${digestCanonical(body)}`,
  });
}

export function finalReceiptMember(receipt: FinalMissionReceipt): EvidenceMemberRef {
  return freeze({
    evidenceId: receipt.receiptId,
    digest: digestCanonical(receipt),
    eventId: receipt.eventId,
    receiptId: receipt.receiptId,
    producerDomain: "FortiX causal compiler",
    causalParents: [...receipt.causalInputEvidenceIds],
    observedInputs: [],
    timeMs: receipt.issuedAtMasterTimeMs,
    source: "D006_FINAL_RECEIPT",
    presentation: "PRESENTED",
    assurance: "ELIGIBLE",
  });
}

export function expectedDisplayedEvidenceIds(
  closure: MissionEvidenceClosure,
  receipt: FinalMissionReceipt,
): readonly string[] {
  return freeze([...closure.presentationEvidenceIds, receipt.receiptId]);
}

export function assertDisplayedCoverage(
  displayedEvidenceIds: readonly string[],
  expectedEvidenceIds: readonly string[],
): void {
  const displayed = uniqueEvidenceSet(displayedEvidenceIds, "DISPLAYED_EVIDENCE_DUPLICATE");
  const expected = uniqueEvidenceSet(expectedEvidenceIds, "EXPECTED_EVIDENCE_DUPLICATE");
  if (displayed.size !== expected.size || [...expected].some((id) => !displayed.has(id))) {
    throw new PortableMissionEvidenceError(
      "DISPLAYED_PEB_COVERAGE_MISMATCH",
      "the displayed Proof Tree and transferred PEB must name the exact same presentation evidence set",
    );
  }
}

export function buildPortableMissionEvidenceBundle(input: Readonly<{
  closure: MissionEvidenceClosure;
  finalReceipt: FinalMissionReceipt;
  runtimeRecords: readonly OfflineCausalRecord[];
  displayedEvidenceIds: readonly string[];
  masterTimeMs: number;
  sourceBundle?: unknown;
}>): PortableMissionEvidenceBundle {
  if (input.masterTimeMs < PEB_COMPLETE_MS) {
    throw new PortableMissionEvidenceError(
      "PEB_PREMATURE",
      `the PEB cannot be complete before ${PEB_COMPLETE_MS}`,
    );
  }
  const sourceBundle = input.sourceBundle ?? D005M_MASTER_BUNDLE;
  const rebuiltClosure = buildMissionEvidenceClosure({
    identity: input.closure.identity,
    runtimeRecords: input.runtimeRecords,
    asOfMasterTimeMs: input.closure.asOfMasterTimeMs,
    sourceBundle,
  });
  if (canonicalString(rebuiltClosure) !== canonicalString(input.closure)) {
    throw new PortableMissionEvidenceError(
      "CLOSURE_STALE_OR_MUTATED",
      "the supplied closure is not the current deterministic closure of its members",
    );
  }
  const expectedReceipt = issueFinalMissionReceipt(rebuiltClosure, FINAL_RECEIPT_EMITTED_MS);
  if (canonicalString(expectedReceipt) !== canonicalString(input.finalReceipt)) {
    throw new PortableMissionEvidenceError(
      "FINAL_RECEIPT_STALE_OR_MUTATED",
      "the Final Receipt does not bind the current evidence closure",
    );
  }

  const presentationEvidenceIds = expectedDisplayedEvidenceIds(rebuiltClosure, expectedReceipt);
  assertDisplayedCoverage(input.displayedEvidenceIds, presentationEvidenceIds);
  const memberRefs = [...rebuiltClosure.members, finalReceiptMember(expectedReceipt)];
  const manifestBase = {
    memberRefs,
    presentationEvidenceIds,
    assuranceSupportEvidenceIds: rebuiltClosure.assuranceSupportEvidenceIds,
    bundleDigest: "",
  };
  const identity = rebuiltClosure.identity;
  const draft = {
    profile: PEB_PROFILE,
    bundleId: "",
    identity,
    sourceBundle,
    runtimeRecords: [...input.runtimeRecords],
    finalReceipt: expectedReceipt,
    manifest: manifestBase,
  };
  const bundleId = `fortix:peb:blake3:${digestCanonical(draft)}`;
  const withId = { ...draft, bundleId };
  const bundleDigest = digestCanonical(withId);
  return freeze({
    ...withId,
    manifest: { ...manifestBase, bundleDigest },
  });
}

export function createHandoffArtifact(
  peb: PortableMissionEvidenceBundle,
  masterTimeMs: number,
): HandoffArtifact {
  if (masterTimeMs < HANDOFF_READY_MS) {
    throw new PortableMissionEvidenceError(
      "HANDOFF_PREMATURE",
      `evidence handling is disabled until the stable pause ends at ${HANDOFF_READY_MS}`,
    );
  }
  const pebText = canonicalString(peb);
  return freeze({
    identity: peb.identity,
    finalReceipt: peb.finalReceipt,
    peb,
    pebText,
    transferredContentDigest: digestText(pebText),
    handoffReadyAtMasterTimeMs: HANDOFF_READY_MS,
  });
}

export function verifyBundleIntegrityManifest(peb: PortableMissionEvidenceBundle): boolean {
  const probe = {
    ...peb,
    manifest: { ...peb.manifest, bundleDigest: "" },
  };
  return digestCanonical(probe) === peb.manifest.bundleDigest;
}

export function transferredContentDigest(pebText: string): string {
  return digestText(pebText);
}

function validateRequiredRuntimeRecord(
  record: OfflineCausalRecord,
  spec: MissionEvidenceSpec,
  evidenceReferenceByEventId: ReadonlyMap<string, string>,
): void {
  const referenceFor = (eventId: string | null | undefined): string | null => {
    if (eventId === null || eventId === undefined) return null;
    const reference = evidenceReferenceByEventId.get(eventId);
    if (reference === undefined) {
      throw new PortableMissionEvidenceError(
        "RUNTIME_EVIDENCE_INPUT_UNRESOLVED",
        `runtime evidence input ${eventId} does not resolve to an included evidence object`,
      );
    }
    return reference;
  };
  const expectedPayload: JsonObject = {
    ...spec.payload,
    ...(spec.eventId === ROUTING_PROVENANCE_EVENT_ID
      ? { routing_provenance: canonicalRoutingPayload(record.payload.routing_provenance) }
      : {}),
    trust_domain: spec.domain,
    caused_by: referenceFor(spec.causedByEventId),
    observed_input: referenceFor(spec.observedEventId),
    evidence_class: "DEMONSTRATION_RUNTIME",
    execution_scope: "DEMO_PRESENTATION_RUNTIME",
  };
  if (record.eventType !== spec.eventType
    || record.receiptId !== spec.receiptId
    || record.missionClockPosition !== specTime(spec)
    || record.evidenceLocality !== "LOCAL"
    || record.executionLocality !== "LOCAL"
    || canonicalString(record.payload) !== canonicalString(expectedPayload)) {
    throw new PortableMissionEvidenceError(
      "REQUIRED_RUNTIME_EVIDENCE_MUTATED",
      `runtime evidence ${spec.eventId} does not match its canonical event, time, locality and payload contract`,
    );
  }
}

/**
 * Runtime TypeScript types disappear at the handoff boundary. Re-project the
 * exact routing schema from parsed values, validate its invariants, and then
 * compare that projection with the transferred payload. This accepts the
 * truthful selected-A/resolved-B fallback case while rejecting a tuple swap
 * that omits or misbinds its fallback.
 */
function canonicalRoutingPayload(value: unknown): RoutingProvenance {
  try {
    const route = asObject(value, "ROUTING_PROVENANCE_INVALID");
    const request = asObject(route.routing_request, "ROUTING_PROVENANCE_INVALID");
    const triggering = requireTextArray(
      request.triggering_event_ids,
      "ROUTING_PROVENANCE_INVALID",
    );
    if (!Array.isArray(route.candidate_set)) {
      throw new TypeError("routing candidate set required");
    }
    const candidateSet: RoutingCandidate[] = route.candidate_set.map((candidate) => {
      const object = asObject(candidate, "ROUTING_PROVENANCE_INVALID");
      const executionTruth = requireText(object.execution_truth, "ROUTING_PROVENANCE_INVALID");
      if (!["SIMULATED_LOCAL", "SIMULATED_REMOTE", "EXTERNAL"].includes(executionTruth)) {
        throw new TypeError("routing execution truth invalid");
      }
      return {
        candidate_id: requireText(object.candidate_id, "ROUTING_PROVENANCE_INVALID"),
        source_id: requireText(object.source_id, "ROUTING_PROVENANCE_INVALID"),
        model_id: requireText(object.model_id, "ROUTING_PROVENANCE_INVALID"),
        provider_id: requireText(object.provider_id, "ROUTING_PROVENANCE_INVALID"),
        execution_truth: executionTruth as RoutingCandidate["execution_truth"],
      };
    });
    const fallback = route.fallback === null
      ? null
      : routingFallback(route.fallback);
    const resulting = asObject(route.resulting_route, "ROUTING_PROVENANCE_INVALID");
    const resultingRoute: ResultingRoute = {
      route_id: requireText(resulting.route_id, "ROUTING_PROVENANCE_INVALID"),
      route_source_ref: requireText(resulting.route_source_ref, "ROUTING_PROVENANCE_INVALID"),
      causal_parent_ref: requireText(resulting.causal_parent_ref, "ROUTING_PROVENANCE_INVALID"),
    };
    const projection: RoutingProvenance = {
      routing_request: {
        request_id: requireText(request.request_id, "ROUTING_PROVENANCE_INVALID"),
        triggering_event_ids: triggering,
      },
      routing_policy_ref: requireText(route.routing_policy_ref, "ROUTING_PROVENANCE_INVALID"),
      candidate_set: candidateSet,
      selected_source: requireText(route.selected_source, "ROUTING_PROVENANCE_INVALID"),
      selected_model: requireText(route.selected_model, "ROUTING_PROVENANCE_INVALID"),
      selected_provider: requireText(route.selected_provider, "ROUTING_PROVENANCE_INVALID"),
      resolved_source: requireText(route.resolved_source, "ROUTING_PROVENANCE_INVALID"),
      resolved_model: requireText(route.resolved_model, "ROUTING_PROVENANCE_INVALID"),
      resolved_provider: requireText(route.resolved_provider, "ROUTING_PROVENANCE_INVALID"),
      fallback,
      resulting_route: resultingRoute,
    };
    const validated = createRoutingProvenance(projection);
    if (canonicalString(value) !== canonicalString(validated)) {
      throw new TypeError("routing provenance has non-canonical fields");
    }
    if (validated.routing_request.request_id !== CANONICAL_ROUTING_PROVENANCE.routing_request.request_id
      || canonicalString(validated.routing_request.triggering_event_ids)
        !== canonicalString(CANONICAL_ROUTING_PROVENANCE.routing_request.triggering_event_ids)
      || validated.routing_policy_ref !== CANONICAL_ROUTING_PROVENANCE.routing_policy_ref
      || canonicalString(validated.candidate_set) !== canonicalString(CANONICAL_ROUTING_PROVENANCE.candidate_set)
      || canonicalString(validated.resulting_route) !== canonicalString(CANONICAL_ROUTING_PROVENANCE.resulting_route)
      || validated.candidate_set.some((candidate) => candidate.execution_truth !== "SIMULATED_LOCAL")
      || (validated.fallback !== null
        && validated.fallback.reason_code !== "D006_SELECTED_PROVIDER_UNAVAILABLE")) {
      throw new TypeError(
        "the closed D-006 route profile requires its exact signed triggers, local simulation candidates, policy and resulting route",
      );
    }
    return validated;
  } catch (error) {
    if (error instanceof PortableMissionEvidenceError) throw error;
    throw new PortableMissionEvidenceError(
      "ROUTING_PROVENANCE_INVALID",
      error instanceof Error ? error.message : "routing provenance is invalid",
    );
  }
}

/** The presentation reads the same closed provenance object the PEB carries. */
export function routingProvenanceFromRuntimeRecords(
  records: readonly OfflineCausalRecord[],
): RoutingProvenance | null {
  const matches = records.filter((record) => record.eventId === ROUTING_PROVENANCE_EVENT_ID);
  if (matches.length === 0) return null;
  if (matches.length !== 1) {
    throw new PortableMissionEvidenceError(
      "ROUTING_PROVENANCE_DUPLICATE",
      "one mission run may carry exactly one routing provenance record",
    );
  }
  const record = matches[0]!;
  const spec = MISSION_EVIDENCE_SPECS.find((candidate) => candidate.eventId === ROUTING_PROVENANCE_EVENT_ID);
  if (spec === undefined
    || record.canonicalDigest !== canonicalRecordDigest(record)
    || !isSpecializedRecordProjectionValid(record)) {
    throw new PortableMissionEvidenceError(
      "ROUTING_RECORD_INVALID",
      "the routing cue requires the exact canonical runtime record envelope and digest",
    );
  }
  validateRequiredRuntimeRecord(record, spec, canonicalEvidenceReferenceByEventId());
  return canonicalRoutingPayload(record.payload.routing_provenance);
}

function routingFallback(value: unknown): RoutingFallback {
  const fallback = asObject(value, "ROUTING_PROVENANCE_INVALID");
  return {
    from_candidate_id: requireText(fallback.from_candidate_id, "ROUTING_PROVENANCE_INVALID"),
    to_candidate_id: requireText(fallback.to_candidate_id, "ROUTING_PROVENANCE_INVALID"),
    reason_code: requireText(fallback.reason_code, "ROUTING_PROVENANCE_INVALID"),
  };
}

function requireTextArray(value: unknown, reasonCode: string): readonly string[] {
  if (!Array.isArray(value)) {
    throw new PortableMissionEvidenceError(reasonCode, "string array required");
  }
  return value.map((candidate) => requireText(candidate, reasonCode));
}

function requireRuntimeEvidenceComplete(closure: MissionEvidenceClosure): void {
  const membersByEvent = new Map(closure.members.map((member) => [member.eventId, member]));
  const missing = MISSION_EVIDENCE_SPECS
    .filter((spec) => specTime(spec) < REQUIRED_RUNTIME_EVIDENCE_CUTOFF_EXCLUSIVE_MS)
    .filter((spec) => {
      const member = membersByEvent.get(spec.eventId);
      return member === undefined
        || member.receiptId !== spec.receiptId
        || member.timeMs !== specTime(spec);
    })
    .map((spec) => spec.eventId);
  if (missing.length > 0) {
    throw new PortableMissionEvidenceError(
      "REQUIRED_RUNTIME_EVIDENCE_MISSING",
      `required runtime evidence is missing: ${missing.join(", ")}`,
    );
  }
  const returnReceipt = closure.members.find(
    (member) => member.eventId === "d005m.receipt.master-return-to-base",
  );
  const expectedReturnTime = MASTER_EVIDENCE_EVENTS.find(
    (event) => event.event_id === "d005m.receipt.master-return-to-base",
  )?.time_ms;
  if (returnReceipt === undefined
    || expectedReturnTime === undefined
    || returnReceipt.timeMs !== expectedReturnTime
    || returnReceipt.assurance !== "ELIGIBLE") {
    throw new PortableMissionEvidenceError(
      "FINAL_REQUIRED_LEAF_INELIGIBLE",
      "the matured return-to-base receipt must be present and assurance-eligible before Final Receipt emission",
    );
  }
}

function canonicalEvidenceObjects(sourceBundle: unknown): readonly unknown[] {
  const bundle = asObject(sourceBundle, "SOURCE_BUNDLE_INVALID");
  if (!Array.isArray(bundle.canonical_evidence_objects)) {
    throw new PortableMissionEvidenceError(
      "SOURCE_BUNDLE_OBJECTS_INVALID",
      "the immutable source bundle must expose canonical_evidence_objects",
    );
  }
  return bundle.canonical_evidence_objects;
}

function runtimeEvidenceTime(record: OfflineCausalRecord): number {
  const observed = record.payload.observed_master_time_ms;
  return typeof observed === "number" && Number.isFinite(observed)
    ? observed
    : record.missionClockPosition;
}

function readPayloadText(record: OfflineCausalRecord, key: string): string | null {
  const value = record.payload[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function signedEvidenceByEventId(): Map<string, string> {
  return new Map(MASTER_EVIDENCE_EVENTS.map((event) => [event.event_id, event.evidence_id]));
}

function canonicalEvidenceReferenceByEventId(): Map<string, string> {
  const references = signedEvidenceByEventId();
  for (const spec of MISSION_EVIDENCE_SPECS) references.set(spec.eventId, spec.receiptId);
  return references;
}

/**
 * A signed receipt's producer is evidence, not presentation metadata. Prefer
 * the canonical participant named inside the signed payload; evidence classes
 * without a participant (for example authority lifecycle and compiled
 * receipts) use their signed issuer identity. Conflicting participants fail
 * closed instead of being guessed from an event name.
 */
function canonicalProducerDomain(object: JsonObject): string {
  const participants = nestedTextValues(object.evidence_payload, "participant_system");
  if (participants.length > 1) {
    throw new PortableMissionEvidenceError(
      "SOURCE_PRODUCER_AMBIGUOUS",
      "a signed evidence object cannot name conflicting participant systems",
    );
  }
  const participant = participants[0];
  if (participant !== undefined) return participant;
  const issuer = readNestedText(object, "issuer", "issuer_id");
  if (issuer !== null) return issuer;
  throw new PortableMissionEvidenceError(
    "SOURCE_PRODUCER_MISSING",
    "a signed evidence object must identify its participant or issuer",
  );
}

function nestedTextValues(node: unknown, key: string): readonly string[] {
  const found = new Set<string>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const child of value) visit(child);
      return;
    }
    if (value === null || typeof value !== "object") return;
    for (const [candidateKey, child] of Object.entries(value as JsonObject)) {
      if (candidateKey === key && typeof child === "string" && child.trim().length > 0) {
        found.add(child);
      }
      visit(child);
    }
  };
  visit(node);
  return freeze([...found]);
}

function runtimeCausalParents(record: OfflineCausalRecord): readonly string[] {
  const direct = record.payload.caused_by;
  const many = record.payload.causal_input_evidence_ids ?? record.payload.causal_input_receipt_ids;
  const parents = [
    ...(typeof direct === "string" && direct.length > 0 ? [direct] : []),
    ...(Array.isArray(many) ? many.filter((value): value is string => typeof value === "string" && value.length > 0) : []),
  ];
  return freeze([...new Set(parents)]);
}

function runtimeObservedInputs(record: OfflineCausalRecord): readonly string[] {
  const direct = record.payload.observed_input;
  const many = record.payload.observed_input_evidence_ids ?? record.payload.observed_input_receipt_ids;
  const inputs = [
    ...(typeof direct === "string" && direct.length > 0 ? [direct] : []),
    ...(Array.isArray(many) ? many.filter((value): value is string => typeof value === "string" && value.length > 0) : []),
  ];
  return freeze([...new Set(inputs)]);
}

function routingTriggerEvidenceIds(
  record: OfflineCausalRecord,
  signedEvidenceByEventId: ReadonlyMap<string, string>,
): readonly string[] {
  const route = canonicalRoutingPayload(record.payload.routing_provenance);
  return freeze(route.routing_request.triggering_event_ids.map((eventId) => {
    const evidenceId = signedEvidenceByEventId.get(eventId);
    if (evidenceId === undefined) {
      throw new PortableMissionEvidenceError(
        "ROUTING_TRIGGER_EVIDENCE_MISSING",
        `routing trigger ${eventId} does not resolve to signed evidence in the immutable source bundle`,
      );
    }
    return evidenceId;
  }));
}

function canonicalCausalParents(object: JsonObject): readonly string[] {
  const found = new Set<string>();
  const collect = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const value of node) collect(value);
      return;
    }
    if (node === null || typeof node !== "object") return;
    for (const [key, value] of Object.entries(node as JsonObject)) {
      if (["predecessor_evidence_id", "caused_by"].includes(key)
        && typeof value === "string" && value.length > 0) {
        found.add(value);
      }
      if ([
        "predecessor_evidence_ids",
        "causal_parent_evidence_ids",
        "causal_input_evidence_ids",
        "causal_input_receipt_ids",
      ].includes(key) && Array.isArray(value)) {
        for (const candidate of value) {
          if (typeof candidate === "string" && candidate.length > 0) found.add(candidate);
        }
      }
      collect(value);
    }
  };
  collect(object);
  return freeze([...found]);
}

function memberDigestProjection(member: EvidenceMemberRef): unknown {
  return {
    evidenceId: member.evidenceId,
    digest: member.digest,
    eventId: member.eventId,
    receiptId: member.receiptId,
    producerDomain: member.producerDomain,
    causalParents: member.causalParents,
    observedInputs: member.observedInputs,
    timeMs: member.timeMs,
    source: member.source,
    presentation: member.presentation,
    assurance: member.assurance,
  };
}

/** Unsupported claims cannot regain eligibility through a receipt that compiles them. */
function propagateQuarantinedAssurance(
  members: readonly EvidenceMemberRef[],
  directlyQuarantined: ReadonlySet<string>,
): readonly EvidenceMemberRef[] {
  const quarantined = new Set(directlyQuarantined);
  let changed = true;
  while (changed) {
    changed = false;
    for (const member of members) {
      if (quarantined.has(member.evidenceId)) continue;
      const compilesEvidence = member.source === "SIGNED_CANONICAL"
        && member.eventId.startsWith("d005m.receipt.");
      if (compilesEvidence && member.causalParents.some((parent) => quarantined.has(parent))) {
        quarantined.add(member.evidenceId);
        changed = true;
      }
    }
  }
  return members.map((member) => freeze({
    ...member,
    assurance: quarantined.has(member.evidenceId) ? "QUARANTINED" as const : "ELIGIBLE" as const,
  }));
}

function sourceOrder(source: EvidenceMemberSource): number {
  if (source === "SIGNED_CANONICAL") return 0;
  if (source === "RUNTIME_JOURNAL") return 1;
  return 2;
}

function requireUniqueMemberIds(members: readonly EvidenceMemberRef[]): void {
  const evidenceIds = new Set<string>();
  for (const member of members) {
    if (evidenceIds.has(member.evidenceId)) {
      throw new PortableMissionEvidenceError(
        "EVIDENCE_MEMBER_DUPLICATE",
        `evidence identity appears more than once: ${member.evidenceId}`,
      );
    }
    evidenceIds.add(member.evidenceId);
  }
}

function uniqueEvidenceSet(values: readonly string[], reasonCode: string): ReadonlySet<string> {
  const set = new Set<string>();
  for (const value of values) {
    requireText(value, "EVIDENCE_ID_REQUIRED");
    if (set.has(value)) {
      throw new PortableMissionEvidenceError(reasonCode, `duplicate evidence identity: ${value}`);
    }
    set.add(value);
  }
  return set;
}

function requireIdentity(identity: MissionIdentity): void {
  requireText(identity.missionId, "MISSION_ID_REQUIRED");
  requireText(identity.runId, "RUN_ID_REQUIRED");
  if (identity.missionId === identity.runId) {
    throw new PortableMissionEvidenceError(
      "MISSION_RUN_IDENTITY_COLLAPSED",
      "canonical Mission ID and enactment Run ID must remain distinct",
    );
  }
}

function requireSourceMissionIdentity(
  identity: MissionIdentity,
  sourceBundle: unknown,
  sourceObjects: readonly unknown[],
): void {
  const bundle = asObject(sourceBundle, "SOURCE_BUNDLE_INVALID");
  const manifest = asObject(bundle.verification_manifest, "SOURCE_VERIFICATION_MANIFEST_INVALID");
  if (!Array.isArray(manifest.target_evidence_ids) || manifest.target_evidence_ids.length !== 1) {
    throw new PortableMissionEvidenceError(
      "SOURCE_MISSION_TARGET_INVALID",
      "the immutable source bundle must identify exactly one verification target",
    );
  }
  const targetId = requireText(manifest.target_evidence_ids[0], "SOURCE_MISSION_TARGET_INVALID");
  const target = sourceObjects
    .map((candidate) => asObject(candidate, "SOURCE_EVIDENCE_OBJECT_INVALID"))
    .find((candidate) => candidate.evidence_id === targetId);
  if (target === undefined) {
    throw new PortableMissionEvidenceError(
      "SOURCE_MISSION_TARGET_INVALID",
      "the source verification target must resolve to an embedded signed evidence object",
    );
  }
  const sourceMissionId = readNestedText(target, "causal_links", "causal_chain_id");
  if (sourceMissionId === null
    || sourceMissionId !== MISSION_ID
    || identity.missionId !== sourceMissionId) {
    throw new PortableMissionEvidenceError(
      "MISSION_ID_MISMATCH",
      "the D-006 wrapper Mission ID must equal the immutable source target's canonical causal chain",
    );
  }
}

function requireFiniteTime(value: number, reasonCode: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new PortableMissionEvidenceError(reasonCode, "master time must be finite and non-negative");
  }
}

function asObject(value: unknown, reasonCode: string): JsonObject {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new PortableMissionEvidenceError(reasonCode, "object required");
  }
  return value as JsonObject;
}

function readNestedText(source: JsonObject, objectKey: string, textKey: string): string | null {
  const nested = source[objectKey];
  if (nested === null || Array.isArray(nested) || typeof nested !== "object") return null;
  const value = (nested as JsonObject)[textKey];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function requireText(value: unknown, reasonCode: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new PortableMissionEvidenceError(reasonCode, "non-empty text required");
  }
  return value;
}

function digestCanonical(value: unknown): string {
  return digestText(canonicalString(value));
}

function digestText(value: string): string {
  return bytesToHex(blake3(utf8ToBytes(value)));
}

function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

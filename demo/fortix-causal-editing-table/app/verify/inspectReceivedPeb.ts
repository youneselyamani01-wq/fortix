import { transferredContentDigest } from "../portableMissionEvidence.ts";

/** A display projection of received bytes. Parsing and identifier presence are not verification. */
export type ReceivedMember = Readonly<{
  index: number; evidenceId: string | null; receiptId: string | null; eventId: string | null;
  digest: string | null; producerDomain: string | null; source: string | null;
  presentation: string | null; assurance: string | null; timeMs: number | null;
}>;
export type ReceivedRelation = Readonly<{
  kind: "CAUSAL_PARENT" | "OBSERVED_INPUT" | "FINAL_RECEIPT_INPUT";
  path: string; from: string | null; to: string | null;
  referenceStatus: "PRESENT" | "UNRESOLVED" | "AMBIGUOUS";
}>;
export type ReceivedPebProjection = Readonly<{
  parseStatus: "OBJECT" | "INVALID_JSON" | "NOT_OBJECT";
  profile: string | null; knownProfile: boolean; bundleId: string | null;
  transferDigest: string; byteLength: number; memberCount: number | null;
  finalReceiptId: string | null; manifestDigest: string | null;
  identity: Readonly<{ missionId: string | null; runId: string | null }>;
  finalReceipt: Readonly<{
    profile: string | null; eventId: string | null; receiptId: string | null;
    missionId: string | null; runId: string | null; evidenceSetDigest: string | null;
    issuedAtMasterTimeMs: number | null;
  }> | null;
  members: readonly ReceivedMember[]; relations: readonly ReceivedRelation[];
  /** Paths with missing/unsupported structure; raw received text remains available. */
  issues: readonly string[];
}>;

type JsonObject = Record<string, unknown>;
const object = (value: unknown): JsonObject | null => typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonObject : null;
const string = (value: unknown): string | null => typeof value === "string" ? value : null;
const number = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : null;
const usableId = (value: string | null): value is string => value !== null && value.trim().length > 0;

export function inspectReceivedPeb(text: string): ReceivedPebProjection {
  const empty = {
    profile: null, knownProfile: false, bundleId: null,
    // This fingerprints the exact received UTF-8 text, not a reserialized JSON object.
    transferDigest: transferredContentDigest(text), byteLength: new TextEncoder().encode(text).byteLength,
    memberCount: null, finalReceiptId: null, manifestDigest: null,
    identity: { missionId: null, runId: null }, finalReceipt: null,
    members: [], relations: [], issues: [],
  };
  let parsed: unknown;
  try { parsed = JSON.parse(text); }
  catch { return { ...empty, parseStatus: "INVALID_JSON", issues: ["$"] }; }
  const root = object(parsed);
  if (root === null) return { ...empty, parseStatus: "NOT_OBJECT", issues: ["$"] };
  const issues: string[] = [];
  const requiredString = (value: unknown, path: string): string | null => {
    const result = string(value);
    if (!usableId(result)) issues.push(path);
    return result;
  };
  const identity = object(root.identity);
  const manifest = object(root.manifest);
  const receipt = object(root.finalReceipt);
  if (identity === null) issues.push("identity");
  if (manifest === null) issues.push("manifest");
  if (receipt === null) issues.push("finalReceipt");
  const receiptIdentity = object(receipt?.identity);
  const declaredMembers = Array.isArray(manifest?.memberRefs) ? manifest.memberRefs : null;
  if (declaredMembers === null) issues.push("manifest.memberRefs");
  const members: ReceivedMember[] = (declaredMembers ?? []).map((value, index) => {
    const member = object(value);
    const path = `manifest.memberRefs[${index}]`;
    if (member === null) issues.push(path);
    return {
      index, evidenceId: requiredString(member?.evidenceId, `${path}.evidenceId`),
      receiptId: string(member?.receiptId), eventId: string(member?.eventId),
      digest: string(member?.digest), producerDomain: string(member?.producerDomain),
      source: string(member?.source), presentation: string(member?.presentation),
      assurance: string(member?.assurance), timeMs: number(member?.timeMs),
    };
  });
  const occurrences = new Map<string, number>();
  for (const member of members) if (usableId(member.evidenceId)) occurrences.set(member.evidenceId, (occurrences.get(member.evidenceId) ?? 0) + 1);
  for (const [id, count] of occurrences) if (count > 1) issues.push(`duplicate evidenceId: ${id}`);
  const finalReceiptId = string(receipt?.receiptId);
  const relations: ReceivedRelation[] = [];
  const appendReferences = (values: unknown, path: string, kind: ReceivedRelation["kind"], destination: string | null, final = false) => {
    if (!Array.isArray(values)) { issues.push(path); return; }
    values.forEach((value, index) => {
      const from = string(value);
      if (!usableId(from)) issues.push(`${path}[${index}]`);
      const sourceCount = usableId(from) ? occurrences.get(from) ?? 0 : 0;
      const destinationCount = usableId(destination) ? (final ? 1 : occurrences.get(destination) ?? 0) : 0;
      relations.push({
        kind, path: `${path}[${index}]`, from, to: destination,
        referenceStatus: sourceCount === 0 || destinationCount === 0 ? "UNRESOLVED" : sourceCount > 1 || destinationCount > 1 ? "AMBIGUOUS" : "PRESENT",
      });
    });
  };
  (declaredMembers ?? []).forEach((value, index) => {
    const member = object(value);
    if (member === null) return;
    const path = `manifest.memberRefs[${index}]`;
    appendReferences(member.causalParents, `${path}.causalParents`, "CAUSAL_PARENT", string(member.evidenceId));
    appendReferences(member.observedInputs, `${path}.observedInputs`, "OBSERVED_INPUT", string(member.evidenceId));
  });
  if (receipt !== null) appendReferences(receipt.causalInputEvidenceIds, "finalReceipt.causalInputEvidenceIds", "FINAL_RECEIPT_INPUT", finalReceiptId, true);
  return {
    ...empty, parseStatus: "OBJECT", profile: requiredString(root.profile, "profile"),
    knownProfile: root.profile === "fortix.demo.d006.peb.v1",
    bundleId: requiredString(root.bundleId, "bundleId"),
    identity: { missionId: string(identity?.missionId), runId: string(identity?.runId) },
    manifestDigest: string(manifest?.bundleDigest), memberCount: declaredMembers?.length ?? null,
    finalReceiptId,
    finalReceipt: receipt === null ? null : {
      profile: string(receipt.profile), eventId: string(receipt.eventId), receiptId: finalReceiptId,
      missionId: string(receiptIdentity?.missionId), runId: string(receiptIdentity?.runId),
      evidenceSetDigest: string(receipt.evidenceSetDigest), issuedAtMasterTimeMs: number(receipt.issuedAtMasterTimeMs),
    },
    members, relations, issues,
  };
}

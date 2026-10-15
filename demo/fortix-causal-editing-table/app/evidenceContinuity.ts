import {
  D005M_MASTER_BUNDLE_ID,
  D005M_MASTER_BUNDLE_TEXT,
  D005M_MASTER_CYCLE_RECEIPT,
  D005M_MASTER_CYCLE_RECEIPT_ID,
  D005M_MASTER_CYCLE_RECEIPT_TEXT,
} from "./masterStory.ts";
import { MISSION_ID } from "./missionContinuity.ts";

export type LocalEvidenceRecord = Readonly<{
  missionId: string;
  receiptId: string;
  payloadDigest: string;
  bundleId: string;
  receipt: typeof D005M_MASTER_CYCLE_RECEIPT;
  receiptText: string;
  bundleText: string;
}>;

export type EvidenceAcknowledgementMaterial = Readonly<{
  missionId: string;
  runId: string;
  receiptId: string;
  receiptDigest: string;
  bundleId: string;
  bundleDigest: string;
}>;

export type SameOriginEvidenceAcknowledgement = Readonly<{
  status: "ACKNOWLEDGED";
  scope: "SAME_ORIGIN_DEMO";
  missionId: string;
  runId: string;
  receiptId: string;
  receiptDigest: string;
  bundleId: string;
  bundleDigest: string;
}>;

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const payloadDigest = String(
  (D005M_MASTER_CYCLE_RECEIPT as { evidence_integrity: { payload_digest: unknown } })
    .evidence_integrity.payload_digest,
);

/**
 * The object shown locally, acknowledged after reconnect, and handed to the
 * verifier is one module-level record. Connectivity changes transport
 * availability only; they never rebuild or replace evidence.
 */
export const LOCAL_EVIDENCE_RECORD: LocalEvidenceRecord = Object.freeze({
  missionId: MISSION_ID,
  receiptId: D005M_MASTER_CYCLE_RECEIPT_ID,
  payloadDigest,
  bundleId: D005M_MASTER_BUNDLE_ID,
  receipt: D005M_MASTER_CYCLE_RECEIPT,
  receiptText: D005M_MASTER_CYCLE_RECEIPT_TEXT,
  bundleText: D005M_MASTER_BUNDLE_TEXT,
});

export function evidenceAcknowledgementRequest(
  material: EvidenceAcknowledgementMaterial,
): EvidenceAcknowledgementMaterial {
  if (!isEvidenceAcknowledgementMaterial(material)) {
    throw new TypeError("Evidence acknowledgement material is incomplete");
  }
  return Object.freeze({
    missionId: material.missionId,
    runId: material.runId,
    receiptId: material.receiptId,
    receiptDigest: material.receiptDigest,
    bundleId: material.bundleId,
    bundleDigest: material.bundleDigest,
  });
}

export function isEvidenceAcknowledgementMaterial(value: unknown): value is EvidenceAcknowledgementMaterial {
  if (value === null || typeof value !== "object") return false;
  const request = value as Partial<EvidenceAcknowledgementMaterial>;
  return isNonEmpty(request.missionId)
    && isNonEmpty(request.runId)
    && isNonEmpty(request.receiptId)
    && isDigest(request.receiptDigest)
    && isNonEmpty(request.bundleId)
    && isDigest(request.bundleDigest);
}

export async function requestSameOriginEvidenceAcknowledgement(
  material: EvidenceAcknowledgementMaterial,
  fetcher: Fetcher = globalThis.fetch,
  signal?: AbortSignal,
): Promise<SameOriginEvidenceAcknowledgement> {
  const request = evidenceAcknowledgementRequest(material);
  const response = await fetcher("/api/evidence-sync", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw new TypeError(`Evidence identity was not acknowledged (${response.status})`);
  const acknowledgement = await response.json() as Partial<SameOriginEvidenceAcknowledgement>;
  if (acknowledgement.status !== "ACKNOWLEDGED"
    || acknowledgement.scope !== "SAME_ORIGIN_DEMO"
    || acknowledgement.missionId !== request.missionId
    || acknowledgement.runId !== request.runId
    || acknowledgement.receiptId !== request.receiptId
    || acknowledgement.receiptDigest !== request.receiptDigest
    || acknowledgement.bundleId !== request.bundleId
    || acknowledgement.bundleDigest !== request.bundleDigest) {
    throw new TypeError("Evidence acknowledgement changed identity");
  }
  return Object.freeze(acknowledgement as SameOriginEvidenceAcknowledgement);
}

/**
 * D-006C corrective pass — F1/F2.
 *
 * The previous copy said "BROWSER REPORTS ONLINE", which is what
 * `navigator.onLine` answers and not what the demonstration is about. The
 * presenter pulls a cable; the interface must speak about that cable.
 *
 * Three things are reported separately and none is inferred from another:
 *   - the physical Ethernet link, observed by the sentinel;
 *   - the local evidence, which continues regardless;
 *   - a same-origin acknowledgement, which is explicitly labelled as local and
 *     is never presented as proof that external connectivity returned.
 */
export function shortEvidenceId(evidenceId: string): string {
  const suffix = evidenceId.split(":").at(-1) ?? evidenceId;
  return suffix.length <= 12 ? suffix : `${suffix.slice(0, 6)}…${suffix.slice(-6)}`;
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isDigest(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/i.test(value);
}

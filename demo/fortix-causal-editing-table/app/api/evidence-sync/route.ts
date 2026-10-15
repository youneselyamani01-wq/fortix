import {
  isEvidenceAcknowledgementMaterial,
  type SameOriginEvidenceAcknowledgement,
} from "../../evidenceContinuity.ts";

export async function POST(request: Request): Promise<Response> {
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    return Response.json({ status: "REJECTED", reason: "INVALID_JSON" }, { status: 400 });
  }
  if (!isEvidenceAcknowledgementMaterial(value)) {
    return Response.json({ status: "REJECTED", reason: "EVIDENCE_IDENTITY_MISMATCH" }, { status: 409 });
  }
  const acknowledgement: SameOriginEvidenceAcknowledgement = {
    status: "ACKNOWLEDGED",
    scope: "SAME_ORIGIN_DEMO",
    missionId: value.missionId,
    runId: value.runId,
    receiptId: value.receiptId,
    receiptDigest: value.receiptDigest,
    bundleId: value.bundleId,
    bundleDigest: value.bundleDigest,
  };
  return Response.json(acknowledgement, {
    status: 200,
    headers: { "cache-control": "no-store" },
  });
}

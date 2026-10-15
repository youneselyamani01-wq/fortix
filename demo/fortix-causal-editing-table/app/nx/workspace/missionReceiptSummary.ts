import type { OfflineEvidenceSession } from "../../offlineEvidence.ts";
import { runtimeProofLeaves } from "../../proofProjection.ts";
import type { PublicEvidence } from "../adapter/publicExperienceAdapter.ts";

export type AvailableMissionReceipt = Readonly<{
  evidenceId: string; eventId: string; domain: string;
  standing: "CLOSURE" | "JOURNAL" | "NETWORK";
}>;
export type MissionReceiptSummary = Readonly<{
  items: readonly AvailableMissionReceipt[];
  count: number; presentedCount: number; networkCount: number;
}>;

/** Reading inventory only: presentation arrivals plus actual network journal
 * receipts. Rewinding the presentation cannot erase an admitted network fact. */
export function missionReceiptSummary(presented: readonly Pick<PublicEvidence, "evidenceId" | "eventId" | "domain" | "standing">[], session: OfflineEvidenceSession): MissionReceiptSummary {
  const items = new Map<string, AvailableMissionReceipt>(presented.map(item => [item.evidenceId, {
    evidenceId: item.evidenceId, eventId: item.eventId, domain: item.domain, standing: item.standing,
  }]));
  const records = session.records.filter(record => record.missionId === session.missionId && record.runId === session.runId);
  const byId = new Map(records.map(record => [record.receiptId, record]));
  const network = runtimeProofLeaves(records).filter(leaf => leaf.domain === "NETWORK");
  for (const leaf of network) {
    const record = byId.get(leaf.evidenceId);
    if (record && !items.has(leaf.evidenceId)) items.set(leaf.evidenceId, { evidenceId: leaf.evidenceId, eventId: record.eventId, domain: leaf.domain, standing: "NETWORK" });
  }
  return Object.freeze({ items: Object.freeze([...items.values()].map(item => Object.freeze(item))), count: items.size, presentedCount: presented.length, networkCount: new Set(network.map(leaf => leaf.evidenceId)).size });
}

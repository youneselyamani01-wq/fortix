/**
 * D-006 NX1 — the EVIDENCE EPISODE table.
 *
 * The significant episodes the public groups evidence by (LEVEL 2), lifted out
 * of the public experience adapter at Checkpoint C-R1 so that the presentation
 * queue and the pacing model can classify a receipt without importing the
 * adapter that consumes them. Pure data and one pure function: a mapping over
 * canonical event ids, explicit so a test can prove every presented object of a
 * run lands in a named episode. Nothing here reads a clock or authors evidence.
 */

/**
 * The significant episodes the public groups evidence by (LEVEL 2). A pure
 * grouping over canonical event ids; membership is explicit so a test can
 * prove every presented object of a run lands in a named episode.
 */
export type EvidenceEpisode =
  | "missionStart" | "signalStop" | "passenger" | "garageRoute" | "maintenance"
  | "payment" | "return" | "final" | "network" | "other";

export const EPISODE_ORDER: readonly EvidenceEpisode[] = Object.freeze([
  "missionStart", "signalStop", "passenger", "garageRoute", "maintenance", "payment", "return", "network", "final", "other",
]);

const EPISODE_BY_EVENT_ID: Readonly<Record<string, EvidenceEpisode>> = Object.freeze({
  "d005.passenger-request": "missionStart",
  "d005.passenger-authority": "missionStart",
  "d005.mission-accepted": "missionStart",
  "d005.pickup-route": "missionStart",
  "d006nx0.action:depart-base": "missionStart",
  "d006g.signal-state-published:green-1": "signalStop",
  "d006g.city-detection": "signalStop",
  "d006g.signal-state-published:yellow": "signalStop",
  "d006g.perception:yellow": "signalStop",
  "d006g.decision:stop": "signalStop",
  "d006g.action:brake": "signalStop",
  "d006g.signal-state-published:red": "signalStop",
  "d006g.result:at-rest": "signalStop",
  "d006g.city-phase-decision": "signalStop",
  "d006g.signal-state-published:green-2": "signalStop",
  "d006g.perception:green": "signalStop",
  "d006g.decision:proceed": "signalStop",
  "d006g.action:resume": "signalStop",
  "d005.pickup-confirmed": "passenger",
  "d005.journey-executed": "passenger",
  "d005.dropoff-confirmed": "passenger",
  "d005.maintenance-intent": "garageRoute",
  "d005.garage-route-a": "garageRoute",
  "d005.congestion-significant": "garageRoute",
  "d006nx0.perception:congestion": "garageRoute",
  "d006nx0.decision:hazard-stop": "garageRoute",
  "d006nx0.action:hazard-brake": "garageRoute",
  "d006nx0.result:hazard-stop": "garageRoute",
  "d005.eta-deteriorates": "garageRoute",
  "d005.reroute-authorized": "garageRoute",
  "d006.c1.routing-provenance": "garageRoute",
  "d005.route-b-executed": "garageRoute",
  "d006nx0.action:reroute": "garageRoute",
  "d005.garage-arrival": "maintenance",
  "d005.garage-received": "maintenance",
  "d005.diagnostic": "maintenance",
  "d005.maintenance-proposal": "maintenance",
  "d005.maintenance-authorized": "maintenance",
  "d005.maintenance-executed": "maintenance",
  "d005.maintenance-completed": "maintenance",
  "d005m.master-invoice-1850": "payment",
  "d005m.master-payment-policy-exceeded": "payment",
  "d005m.master-human-approval-request": "payment",
  "d005m.master-human-approve": "payment",
  "d006nx0.human-decision:denied": "payment",
  "d005m.master-payment-authority-active": "payment",
  "d005m.master-payment-authorized": "payment",
  "d005m.master-payment-instruction": "payment",
  "d006g.payment-instruction-presented": "payment",
  "d006g.bank-authorization": "payment",
  "d006g.bank-confirmation": "payment",
  "d005m.master-payment-result": "payment",
  "d005m.receipt.master-payment": "payment",
  "d005m.master-manager-notified": "payment",
  "d005m.master-return-intent": "return",
  "d005m.master-return-authorized": "return",
  "d005m.master-return-executed": "return",
  "d005m.master-base-arrival": "return",
  "d005m.receipt.master-return-to-base": "return",
  "d005m.receipt.master-operational-cycle": "final",
  "d006.final-mission-receipt": "final",
});

const NETWORK_EVENT_TYPES = new Set(["NETWORK_LINK_LOST", "NETWORK_LINK_RESTORED", "RECONCILIATION_RECEIPT", "MISSION_COMPLETED_OFFLINE"]);

export function episodeOf(eventId: string, eventType: string): EvidenceEpisode {
  if (NETWORK_EVENT_TYPES.has(eventType)) return "network";
  return EPISODE_BY_EVENT_ID[eventId] ?? "other";
}

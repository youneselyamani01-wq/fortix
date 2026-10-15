export type PublicNetworkState = "UNKNOWN" | "CONNECTED" | "LOST";
export type PublicCausalKind =
  | "request"
  | "physicalAi"
  | "route"
  | "maintenance"
  | "authority"
  | "payment"
  | "return"
  | "network"
  | "complete";

export type PublicCausalScene = Readonly<{
  kind: PublicCausalKind;
  steps: readonly string[];
}>;

const PHYSICAL_AI_EVENTS = new Set([
  "signal-green",
  "city-detection",
  "signal-yellow",
  "taxi-observes-yellow",
  "taxi-decides-stop",
  "taxi-brake-applied",
  "signal-red",
  "taxi-at-rest",
  "city-phase-decision",
  "signal-green-2",
  "taxi-observes-green",
  "taxi-decides-proceed",
  "taxi-resumes",
]);
const ROUTE_EVENTS = new Set(["route-start", "obstacle", "brake", "reroute", "garage"]);
const MAINTENANCE_EVENTS = new Set(["handover", "maintenance", "work", "invoice"]);
const AUTHORITY_EVENTS = new Set(["human", "authorized"]);
const PAYMENT_EVENTS = new Set([
  "instruction-presented",
  "bank-authorization",
  "bank-confirmation",
  "paid",
  "payment-receipt",
  "manager",
]);
const RETURN_EVENTS = new Set(["return-intent", "return-authorized", "return-executed"]);
const COMPLETE_EVENTS = new Set(["complete", "return-receipt"]);

/**
 * Projects a compact public explanation from the existing presentation event.
 * It owns no clock and no evidence state. Physical network loss may override
 * the explanation only after the sentinel-backed state machine reports LOST.
 */
export function publicCausalScene(
  eventId: string,
  networkState: PublicNetworkState,
): PublicCausalScene {
  if (networkState === "LOST") {
    return { kind: "network", steps: ["networkLost", "missionContinues", "evidenceContinues"] };
  }
  if (PHYSICAL_AI_EVENTS.has(eventId)) {
    return { kind: "physicalAi", steps: ["see", "understand", "decide", "act"] };
  }
  if (ROUTE_EVENTS.has(eventId)) return { kind: "route", steps: ["traffic", "reconsider", "newRoute"] };
  if (MAINTENANCE_EVENTS.has(eventId)) return { kind: "maintenance", steps: ["fault", "authorize", "record"] };
  if (AUTHORITY_EVENTS.has(eventId)) return { kind: "authority", steps: ["amount", "boundary", "decision"] };
  if (PAYMENT_EVENTS.has(eventId)) return { kind: "payment", steps: ["instruction", "response", "noSettlement"] };
  if (RETURN_EVENTS.has(eventId)) return { kind: "return", steps: ["request", "authorize", "return"] };
  if (COMPLETE_EVENTS.has(eventId)) return { kind: "complete", steps: ["complete", "seal", "portable"] };
  return { kind: "request", steps: ["request", "accept", "evidence"] };
}

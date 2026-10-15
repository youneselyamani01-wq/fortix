import { readInspectionEvidence } from "./inspectionPresentation.ts";
import { networkTransitionOf, offlinePeriodOf, reconciliationPeriodOf, type OfflinePeriod, type ReceivedNetworkModel, type ReceivedNetworkTransition } from "./receivedNetwork.ts";
import type { ReceivedEvidenceCatalogEntry } from "./receivedEvidenceCatalog.ts";

export type FactNetworkPosition =
  | Readonly<{ kind: "NONE" }>
  | Readonly<{ kind: "TRANSITION"; transition: ReceivedNetworkTransition; period: OfflinePeriod | null }>
  | Readonly<{ kind: "RECONCILIATION"; period: OfflinePeriod }>
  | Readonly<{ kind: "DURING"; period: OfflinePeriod }>
  | Readonly<{ kind: "OUTSIDE"; connected: boolean }>;

/** Where a fact sits in the declared network history. Time only: a fact during
 * an offline period is temporal context, never a consequence of the loss. A
 * reconciliation receipt is placed by the period it names, not by its time. */
export function factNetworkPosition(model: ReceivedNetworkModel | null | undefined, nodeKey: string, timeMs?: number | null): FactNetworkPosition {
  if (!model || model.transitions.length === 0) return { kind: "NONE" };
  const transition = networkTransitionOf(model, nodeKey);
  const period = offlinePeriodOf(model, nodeKey);
  if (transition) return { kind: "TRANSITION", transition, period };
  const named = reconciliationPeriodOf(model, nodeKey);
  if (named) return { kind: "RECONCILIATION", period: named };
  return period ? { kind: "DURING", period } : { kind: "OUTSIDE", connected: declaredConnectedAt(model, timeMs) };
}

/**
 * CONNECTED at the fact's own declared time, read only from the declared
 * transitions: the new state of the last transition before the fact or, before
 * any transition, the previous state the first one declares. Never inferred
 * from the mere absence of an offline period: a fact without a declared time,
 * an undated transition, a transition at the very same time or declared times
 * that run backwards in the transitions' order leave it unestablished.
 */
function declaredConnectedAt(model: ReceivedNetworkModel, timeMs: number | null | undefined): boolean {
  if (typeof timeMs !== "number") return false;
  const times = model.transitions.map(transition => transition.timeMs);
  if (times.some((time, index) => time === null || time === timeMs || (index > 0 && time < (times[index - 1] as number)))) return false;
  const before = model.transitions.filter(transition => (transition.timeMs as number) < timeMs);
  const state = before.length ? before.at(-1)!.newState : model.transitions[0]!.previousState;
  return state === "CONNECTED";
}

/**
 * Limits shown next to one selected fact, only when they change how that fact
 * reads. Package-wide limits (declarations are not physical proof, timeline
 * order is not causality, RUNTIME is not independent corroboration) belong to
 * the Verdict view and to the provenance disclosure, not to every inspector.
 */
export function factLocalLimits(entry: ReceivedEvidenceCatalogEntry, text: string | undefined, locale: "en" | "fr"): readonly string[] {
  const fr = locale === "fr";
  const limits: string[] = [];
  if (text !== undefined && !entry.node.final) {
    const evidence = readInspectionEvidence(text, entry.node);
    if (evidence.status === "AMBIGUOUS") limits.push(fr ? "Plusieurs objets sources correspondent à cette référence ; aucune liaison unique n’est établie." : "Several source objects match this reference; no unique binding is established.");
    else if (evidence.status !== "FOUND") limits.push(fr ? "Aucun objet source unique n’est résolu pour cette référence dans ce PEB." : "No unique source object resolves for this reference in this PEB.");
  }
  if (entry.node.member?.assurance === "QUARANTINED") limits.push(fr ? "Déclaration en quarantaine : elle reste affichée telle que reçue, sans être retenue comme établie." : "Quarantined declaration: it stays displayed as received, without being retained as established.");
  if (/payment|bank|invoice|settlement/i.test(entry.eventId ?? "")) limits.push(fr ? "Cette déclaration n’établit pas, à elle seule, un règlement financier ni une livraison." : "This declaration does not, by itself, establish financial settlement or delivery.");
  return Object.freeze(limits);
}

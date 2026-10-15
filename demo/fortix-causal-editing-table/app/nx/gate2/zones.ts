import type { CanonicalGraph, CanonicalReceipt } from "./canonicalGraph.ts";

/**
 * D-006/NX GATE 2 — THE THREE MANDATED COMPARISON ZONES (§11).
 *
 * Every variant must be judged on the SAME three situations, or the comparison
 * is four different arguments rather than one experiment. Each zone carries the
 * question it exists to answer, so a capture can be read without the mandate
 * open beside it.
 *
 * Membership is DERIVED from canonical attributes — a reading-number range, an
 * episode, a relation to the Final Receipt — never hand-listed. A hand-listed
 * zone would quietly become a fourth dataset.
 */

export type ZoneId = "zone1-parallelism" | "zone2-boundaries" | "zone3-convergence";

export type ComparisonZone = Readonly<{
  id: ZoneId;
  title: string;
  titleFr: string;
  /** The question this zone exists to answer, in the mandate's own terms. */
  question: string;
  questionFr: string;
  /** Receipts the zone focuses on. Others are drawn, but muted. */
  focus: (receipt: CanonicalReceipt, graph: CanonicalGraph) => boolean;
  /** True when the Final Receipt itself is part of what is being read. */
  highlightFinal: boolean;
}>;

export const COMPARISON_ZONES: readonly ComparisonZone[] = Object.freeze([
  Object.freeze({
    id: "zone1-parallelism" as const,
    title: "NR 24–33 — parallel branches",
    titleFr: "NR 24–33 — branches parallèles",
    question: "Can a viewer see immediately why NR 30 may cause NR 32 while NR 31, visually between them, is causally parallel?",
    questionFr: "Voit-on immédiatement pourquoi NR 30 peut causer NR 32 alors que NR 31 est visuellement intermédiaire mais causalement parallèle ?",
    focus: (receipt: CanonicalReceipt) => receipt.ordinal.index >= 24 && receipt.ordinal.index <= 33,
    highlightFinal: false,
  }),
  Object.freeze({
    id: "zone2-boundaries" as const,
    // Service (garage/fleet) → human authority → bank, and back. Four trust
    // domains and the authorization/execution distinction in one chain.
    title: "Garage · authority · payment — trust boundaries",
    titleFr: "Garage · autorité · paiement — frontières de confiance",
    question: "Which representation best shows that crossing a boundary produces a new evidence relation, without turning an authorization into proof of execution?",
    questionFr: "Quelle représentation montre le mieux qu'un passage de frontière produit une nouvelle relation de preuve sans transformer l'autorisation en preuve d'exécution ?",
    focus: (receipt: CanonicalReceipt) => receipt.episode === "maintenance" || receipt.episode === "payment",
    highlightFinal: false,
  }),
  Object.freeze({
    id: "zone3-convergence" as const,
    title: "Final Receipt — convergence",
    titleFr: "Reçu final — convergence",
    question: "Which representation makes the final convergence comprehensible without turning the graph into an artificial timeline?",
    questionFr: "Quelle représentation rend la convergence finale compréhensible sans transformer le graphe en timeline artificielle ?",
    // Convergence is a property of the whole picture, so nothing is muted here.
    focus: () => true,
    highlightFinal: true,
  }),
]);

export const zoneById = (id: ZoneId): ComparisonZone => COMPARISON_ZONES.find((zone) => zone.id === id)!;

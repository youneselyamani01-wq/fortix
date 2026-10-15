import { isReceivedEvidenceDossier } from "./guidedInspection.ts";
import { receivedEventLabel } from "./receivedLabels.ts";
import type { ReceivedEvidenceCatalog, ReceivedEvidenceCatalogEntry } from "./receivedEvidenceCatalog.ts";
import type { VerifierView } from "./verifierRoutes.ts";

export type GuidedStoryLinks = Partial<Readonly<Record<VerifierView | "path", string>>>;
export type GuidedStoryPosition = Readonly<{
  status: "READY" | "EMPTY" | "OUTSIDE_STORY" | "NOT_FOUND" | "UNRESOLVED";
  entries: readonly ReceivedEvidenceCatalogEntry[];
  index: number;
  current: ReceivedEvidenceCatalogEntry | null;
  previous: ReceivedEvidenceCatalogEntry | null;
  next: ReceivedEvidenceCatalogEntry | null;
  first: ReceivedEvidenceCatalogEntry | null;
  completed: boolean;
}>;

/** Keep catalog references and its declared-time order. Visibility never edits
 * the received graph, evidence inventory, timestamps or causal declarations. */
export function guidedStoryEntries(catalog: ReceivedEvidenceCatalog): readonly ReceivedEvidenceCatalogEntry[] {
  return Object.freeze(catalog.timelineEntries.filter((entry) => entry.receipt.kind !== "SUPPORT" && !isReceivedEvidenceDossier(entry.node)));
}

/** Only an absent selection starts the story. An explicit missing/support
 * selection has an explicit state, so a deep link cannot silently change facts. */
export function guidedStoryPosition(catalog: ReceivedEvidenceCatalog, selectedNodeKey: string | null = null, selectionUnresolved = false): GuidedStoryPosition {
  const entries = guidedStoryEntries(catalog);
  const index = selectionUnresolved ? -1 : selectedNodeKey === null ? (entries.length ? 0 : -1) : entries.findIndex((entry) => entry.nodeKey === selectedNodeKey);
  const current = index >= 0 ? entries[index] ?? null : null;
  const status = selectionUnresolved ? "UNRESOLVED" : selectedNodeKey !== null && index < 0
    ? catalog.entries.some((entry) => entry.nodeKey === selectedNodeKey) ? "OUTSIDE_STORY" : "NOT_FOUND"
    : current ? "READY" : "EMPTY";
  return Object.freeze({
    status,
    entries,
    index,
    current,
    previous: index > 0 ? entries[index - 1] ?? null : null,
    next: index >= 0 ? entries[index + 1] ?? null : null,
    first: entries[0] ?? null,
    completed: current !== null && index === entries.length - 1,
  });
}

/** Supplied canonical URLs carry the selection. The reader never reconstructs
 * a URL and never uses an event-detail URL to advance the guided story. */
export function guidedStoryPathLink(links: GuidedStoryLinks | undefined): string | undefined {
  return links?.path ?? links?.timeline;
}

const technicalCaption = /(?:\b(?:manifest|memberRef|receiptId|evidenceId|payload|trust[_ -]?anchor)\b|\bM\d{2,}\b|\bNR[-_:][\w.-]+|\b[0-9a-f]{32,}\b|\b(?:[a-z][\w-]*\.){2,}[\w.-]+|\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b|\b(?:member|finalReceipt):\d+)/i;

export function guidedStoryHumanCaption(value: string | null | undefined, fallback: string): string {
  return value?.trim() && !technicalCaption.test(value) ? value : fallback;
}

export function guidedStoryEventLabel(entry: ReceivedEvidenceCatalogEntry, locale: "en" | "fr"): string {
  if (entry.node.final) return locale === "fr" ? "Le Reçu final est disponible" : "The Final Receipt is available";
  const known = receivedEventLabel(entry.eventId, locale);
  if (known) return known;
  const fallback = locale === "fr" ? "Un événement est déclaré" : "An event is declared";
  if ([entry.eventId, entry.evidenceId, entry.nanoReceiptId, entry.nodeKey, entry.node.fieldPath].includes(entry.eventLabel)) return fallback;
  return guidedStoryHumanCaption(entry.eventLabel, fallback);
}

export function guidedStoryDomainLabel(entry: ReceivedEvidenceCatalogEntry, locale: "en" | "fr"): string {
  return guidedStoryHumanCaption(entry.domainLabel, locale === "fr" ? "Domaine non précisé" : "Domain not specified");
}

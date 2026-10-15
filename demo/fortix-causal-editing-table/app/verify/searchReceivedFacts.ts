import type { ReceivedEvidenceCatalog, ReceivedEvidenceCatalogEntry } from "./receivedEvidenceCatalog.ts";

export type VerifierBusinessSearchResult = Readonly<{
  key: string;
  kind: "event" | "domain" | "nanoreceipt" | "forensic";
  label: string;
  context: string;
  entry: ReceivedEvidenceCatalogEntry | null;
  domainId: string | null;
  score: number;
}>;

const aliases: Readonly<Record<string, string>> = {
  "d005.dropoff-confirmed": "passager déposé dépose passager passenger dropped off dropoff",
  "d005.pickup-confirmed": "passager embarqué embarquement passenger pickup boarding",
  "d005.garage-arrival": "arrivée garage taxi garage arrival",
  "d005.maintenance-completed": "maintenance terminée réparation achevée completed repair",
  "d005m.master-payment-result": "résultat paiement paiement enregistré payment result",
  "d005m.master-human-approve": "paiement approuvé autorisation humaine human approval payment approved",
};

export function normalizeBusinessSearch(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function matchScore(query: string, title: string, context: string): number | null {
  const titleText = normalizeBusinessSearch(title);
  const all = `${titleText} ${normalizeBusinessSearch(context)}`;
  const words = query.split(/\s+/);
  if (!words.every(word => all.includes(word))) return null;
  return titleText === query ? 0 : titleText.includes(query) ? 1 : words.every(word => titleText.includes(word)) ? 2 : 3;
}

/** Business vocabulary maps labels, never evidence identity or causality. */
export function searchVerifierFacts(catalog: ReceivedEvidenceCatalog, query: string): readonly VerifierBusinessSearchResult[] {
  const normalizedQuery = normalizeBusinessSearch(query);
  if (!normalizedQuery) return [];
  const results: VerifierBusinessSearchResult[] = [];
  const humanScore = (entry: ReceivedEvidenceCatalogEntry) => matchScore(normalizedQuery, entry.eventLabel, [entry.domainLabel, entry.familyLabel, entry.eventId ? aliases[entry.eventId] : null].filter(Boolean).join(" "));
  for (const entry of catalog.timelineEntries) {
    const score = humanScore(entry);
    if (score !== null) results.push({ key: `event:${entry.nodeKey}`, kind: "event", label: entry.eventLabel, context: entry.domainLabel ?? "", entry, domainId: entry.domainId, score });
  }
  for (const domain of catalog.domains) {
    const score = matchScore(normalizedQuery, domain.label, domain.id);
    if (score !== null) results.push({ key: `domain:${domain.id}`, kind: "domain", label: domain.label, context: "", entry: null, domainId: domain.id, score });
  }
  for (const entry of catalog.entries) {
    if (entry.receipt.kind === "NANO_RECEIPT") {
      const score = humanScore(entry);
      if (score !== null) results.push({ key: `nanoreceipt:${entry.nodeKey}`, kind: "nanoreceipt", label: entry.eventLabel, context: entry.receipt.title, entry, domainId: entry.domainId, score });
    }
    const technical = [entry.evidenceId, entry.nanoReceiptId, entry.eventId, entry.manifestPosition !== null ? `M${String(entry.manifestPosition).padStart(2, "0")}` : null].filter(Boolean).join(" ");
    const score = matchScore(normalizedQuery, technical, "");
    if (score !== null) results.push({ key: `forensic:${entry.nodeKey}`, kind: "forensic", label: entry.eventLabel, context: "", entry, domainId: entry.domainId, score });
  }
  const rank = { event: 0, domain: 1, nanoreceipt: 2, forensic: 3 };
  return Object.freeze(results.sort((a, b) => rank[a.kind] - rank[b.kind] || a.score - b.score || (a.entry?.timelinePosition ?? Number.MAX_SAFE_INTEGER) - (b.entry?.timelinePosition ?? Number.MAX_SAFE_INTEGER) || a.key.localeCompare(b.key)));
}

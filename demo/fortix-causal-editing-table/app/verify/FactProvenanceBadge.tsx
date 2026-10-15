import { factProvenanceDescription, factProvenanceLabel, type FactProvenance } from "./receivedProvenance.ts";
import "./provenance.css";

/** Compact by default where a fact is read: the label stays visible, the reason
 * is one click away ("Comprendre cette provenance"), never a permanent paragraph. */
export function FactProvenanceBadge({ provenance, locale, compact = false, description: override }: { provenance: FactProvenance; locale: "en" | "fr"; compact?: boolean; description?: string }) {
  const description = override ?? factProvenanceDescription(provenance, locale);
  return <div className="fact-provenance" data-provenance={provenance.category} data-provenance-basis={provenance.basis}>
    <p><span>{locale === "fr" ? "Provenance" : "Provenance"}</span><strong>{factProvenanceLabel(provenance, locale)}</strong></p>
    {compact ? <details><summary>{locale === "fr" ? "Comprendre cette provenance" : "Understand this provenance"}</summary><p>{description}</p></details> : <p>{description}</p>}
  </div>;
}

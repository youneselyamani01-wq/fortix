/** Presentation captions only. Receipt IDs, layout coordinates and edges are never translated. */
const french: Readonly<Record<string, string>> = {
  city: "Ville", vehicle: "Véhicule", mission: "Mission", route: "Itinéraire",
  service: "Garage", authority: "Autorité", bank: "Banque", network: "Réseau",
  safety: "Sécurité", unresolved: "Non résolu", "provenance lane": "Contexte de provenance",
};
export function inspectionLabel(label: string | undefined, locale: "en" | "fr"): string | undefined {
  if (locale === "en" || label === undefined) return label;
  return french[label] ?? label
    .replace("causal depth (longest declared parent chain,", "profondeur causale (plus longue chaîne de parents déclarés,")
    .replace("of standardised structural variance", "de la variance structurelle standardisée");
}

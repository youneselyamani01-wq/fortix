/** Editorial geometry only. These paths make no evidence or validity claim. */
export const evidenceObjectGeometry = {
  frame: "M78 42H474L518 86V332L478 372H78L42 336V78Z",
  inset: "M87 64H464L496 96V321L469 349H88L64 325V88Z",
  rear: "M86 58H485L534 100V348L490 389H90L53 350V89Z",
  inner: "M95 133H464V306H95Z",
} as const;
export const evidenceObjectColors = {
  frame: "#22172f", inset: "#30354a", rear: "#b8a697", ink: "#f8f3ed",
  muted: "#d4c4b8", rail: "#f58345", register: "#191b2a", rule: "#82796f",
  row: "#30354a", rowRule: "#777e98", technicalRail: "#9fb5ff", edge: "#b8a697", highlight: "#e7d3c3",
} as const;
export function evidenceObjectCopy(locale: "en" | "fr") {
  return locale === "fr" ? {
    title: "CONTENEUR DE PREUVES", receipt: "Reçu final", records: "Éléments de preuve", context: "Contexte d’exécution",
    members: "MEMBRES", identity: "IDENTITÉ DU PAQUET", illustration: "Représentation du PEB — aucun verdict impliqué",
    unknown: "Non disponible", awaiting: "En attente de PEB", inspectable: "Contenu à inspecter",
  } : {
    title: "EVIDENCE CONTAINER", receipt: "Final Receipt", records: "Evidence records", context: "Execution context",
    members: "MEMBERS", identity: "PACKAGE IDENTITY", illustration: "PEB representation — no verdict implied",
    unknown: "Not available", awaiting: "Awaiting PEB", inspectable: "Contents available to inspect",
  };
}

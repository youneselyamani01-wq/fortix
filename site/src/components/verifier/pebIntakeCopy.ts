const en = {
  kicker: "Bring your evidence", title: "A package. A separate verification surface.",
  description: "Submit your Portable Evidence Bundle (PEB). The Independent Verifier opens in a new tab; you decide when to analyze it.",
  drop: "Drop one PEB here", select: "Select a PEB", note: "One UTF-8 JSON / text file, up to 20 MB. Receiving is not verification.",
  empty: "No package submitted.", opening: "Opening the Independent Verifier…", received: "Package received in the other tab. Continue there with Analyze, then Verdict and Inspect.",
  blocked: "The new tab was blocked. Allow it, then open the verifier with the selected package.",
  failed: "The package was not received. Open the verifier again or select a different UTF-8 package.",
  invalid: "Select one non-empty file, up to 20 MB.", retry: "Open the verifier with this PEB", destination: "Open the Independent Verifier without a package",
};
const fr: { [K in keyof typeof en]: string } = {
  kicker: "Apportez vos preuves", title: "Un paquet. Un espace de vérification distinct.",
  description: "Soumettez votre Portable Evidence Bundle (PEB). Le Vérificateur indépendant s’ouvre dans un nouvel onglet ; vous décidez quand l’analyser.",
  drop: "Déposez un PEB ici", select: "Sélectionner un PEB", note: "Un fichier JSON / texte UTF-8 de 20 Mo maximum. Recevoir n’est pas vérifier.",
  empty: "Aucun paquet soumis.", opening: "Ouverture du Vérificateur indépendant…", received: "Paquet reçu dans l’autre onglet. Poursuivez avec Analyser, puis Verdict et Inspecter.",
  blocked: "Le nouvel onglet a été bloqué. Autorisez son ouverture, puis ouvrez le vérificateur avec le paquet sélectionné.",
  failed: "Le paquet n’a pas été reçu. Ouvrez de nouveau le vérificateur ou sélectionnez un autre paquet UTF-8.",
  invalid: "Sélectionnez un seul fichier non vide de 20 Mo maximum.", retry: "Ouvrir le vérificateur avec ce PEB", destination: "Ouvrir le Vérificateur indépendant sans paquet",
};
export const pebIntakeCopy = { en, fr };

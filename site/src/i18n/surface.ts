/** Surface-only copy shared by Site, Demo and Independent Verifier. */
const en = {
  grammar: "Reading the evidence", boundary: "Zone: trust / execution context", edge: "Thread: declared causal relation", bead: "Bead: receipt evidence",
  grammarNote: "A boundary tells us where context changes. A causal link tells us why events relate. A receipt tells us what evidence exists. Adjacent in time does not mean causally related.",
  transfer: "Evidence transfer across contexts — this schematic does not assert causal edges.",
  title: "Independent Verifier", site: "Understand FortiX", demo: "Observe the demo", subtitle: "Start with what can be proven. Then inspect how the evidence supports it.",
  scope: "D-006 evidence profile · local analysis · pinned demonstration trust context. FortiX does not orchestrate.",
  receive: "Receive", analyze: "Analyze", verdict: "Verdict", inspect: "Inspect",
  drop: "Drop one evidence package here", select: "Select a file", waiting: "No package received. No analysis performed. No verdict.", received: "Package received.",
  expectations: "Expected handoff", expectationNote: "Enter the mission, run and exact transferred-content digest supplied through your trusted handoff. Copying these values from the submitted package does not independently establish its identity or provenance.",
  mission: "Expected mission ID", run: "Expected run ID", digest: "Expected transfer digest (64 hexadecimal characters)",
  ready: "Ready to analyze", analyzing: "Analyzing the received evidence…", inspectTitle: "Evidence and verification record", checked: "Completed checks", reasons: "Reasons / evidence gaps", noReasons: "No reason code returned.",
  noChecks: "No check completed.", bytes: "Received package", raw: "Inspect submitted text", limits: "This result is bounded by the D-006 profile and its pinned demonstration trust context. It does not certify production trust, physical effects, settlement or service delivery beyond the evidence checked.",
  graphNote: "No causal graph is inferred from an uploaded file. The Demo offers graph inspection for its canonical taxi evidence.",
  error: "The file could not be read or analysis could not complete. No verdict was issued. Check the input and try again.",
  fileError: "Select one UTF-8 text / JSON package, up to 20 MB.",
  valid: "The required checks passed within this verification context.", invalid: "The evidence failed a required check. Inspect the returned reason codes.", indeterminate: "The available evidence does not establish the required claim. This is a bounded result, not a system failure.", revoked: "The verification context returned REVOKED. Inspect the revocation reason codes.",
  width: "The causal workspace needs at least 960 px. Scroll horizontally to inspect the full graph; its geometry is preserved.",
};
type SurfaceCopy = { [K in keyof typeof en]: string };
const fr: SurfaceCopy = {
  grammar: "Lire les preuves", boundary: "Zone : contexte de confiance / d’exécution", edge: "Fil : relation causale déclarée", bead: "Perle : preuve portée par un reçu",
  grammarNote: "Une frontière indique où le contexte change. Un lien causal indique pourquoi les événements sont liés. Un reçu indique quelle preuve existe. La proximité temporelle n’implique pas une relation causale.",
  transfer: "Transfert de preuves entre contextes — ce schéma n’affirme aucun lien causal.",
  title: "Vérificateur indépendant", site: "Comprendre FortiX", demo: "Observer la démonstration", subtitle: "Commencez par ce qui peut être prouvé. Examinez ensuite comment les éléments de preuve l’établissent.",
  scope: "Profil de preuve D-006 · analyse locale · contexte de confiance de démonstration épinglé. FortiX n’orchestre pas.",
  receive: "Recevoir", analyze: "Analyser", verdict: "Verdict", inspect: "Inspecter",
  drop: "Déposez un paquet de preuves ici", select: "Sélectionner un fichier", waiting: "Aucun paquet reçu. Aucune analyse effectuée. Aucun verdict.", received: "Paquet reçu.",
  expectations: "Transfert attendu", expectationNote: "Saisissez la mission, l’exécution et l’empreinte exacte du contenu transmis fournies par votre canal de transfert de confiance. Copier ces valeurs depuis le paquet soumis n’établit pas indépendamment son identité ni sa provenance.",
  mission: "Identifiant de mission attendu", run: "Identifiant d’exécution attendu", digest: "Empreinte de transfert attendue (64 caractères hexadécimaux)",
  ready: "Prêt à analyser", analyzing: "Analyse des preuves reçues…", inspectTitle: "Preuves et dossier de vérification", checked: "Contrôles effectués", reasons: "Motifs / lacunes de preuve", noReasons: "Aucun code de motif retourné.",
  noChecks: "Aucun contrôle effectué.", bytes: "Paquet reçu", raw: "Inspecter le texte soumis", limits: "Ce résultat est délimité par le profil D-006 et son contexte de confiance de démonstration épinglé. Il ne certifie ni la confiance en production, ni les effets physiques, ni le règlement, ni la livraison d’un service au-delà des preuves contrôlées.",
  graphNote: "Aucun graphe causal n’est déduit d’un fichier soumis. La démonstration permet d’inspecter le graphe de ses preuves canoniques du taxi.",
  error: "La lecture du fichier ou l’analyse n’a pas abouti. Aucun verdict n’a été émis. Vérifiez les données et réessayez.",
  fileError: "Sélectionnez un seul paquet texte / JSON UTF-8 de 20 Mo maximum.",
  valid: "Les contrôles requis ont réussi dans ce contexte de vérification.", invalid: "La preuve a échoué à un contrôle requis. Inspectez les codes de motif retournés.", indeterminate: "Les preuves disponibles n’établissent pas l’affirmation requise. Ce résultat délimité n’est pas une panne du système.", revoked: "Le contexte de vérification a retourné REVOKED. Inspectez les codes de motif de révocation.",
  width: "L’espace causal nécessite au moins 960 px. Faites défiler horizontalement pour inspecter le graphe complet ; sa géométrie est préservée.",
};
export const surfaceCopy = { en, fr };

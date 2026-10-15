# ADR Grammar

Status: REFERENCE — ADR v1 foundation; current architecture: [evidence](../evidence/README.md).

**Statut :** Normatif  
**Objet :** Vocabulaire et distinctions canoniques d'ADR

---

## 1. Doctrine centrale

**FR :**  
ADR (Audit Decision Record) est un format de preuve cryptographique des décisions.  
Dans les systèmes d'intelligence artificielle, ADR agit comme un reçu de décision IA (AI Decision Receipt), permettant de rendre vérifiables les décisions automatisées produites par des modèles ou des agents.

**EN :**  
ADR (Audit Decision Record) is a cryptographic proof format for decisions.  
In AI systems, ADR functions as an AI Decision Receipt, making automated decisions produced by models or agents verifiable.

---

## 2. Définitions fondamentales

**Reçu (Receipt)** — Artefact signé attestant l'état exact d'une décision à un instant donné. Sa validité est vérifiable par toute partie sans accès au système d'origine.

**Rapport (Report)** — Document narratif décrivant ou expliquant un événement, un résultat ou une situation. Non signé, non vérifiable cryptographiquement.

**Journal (Log)** — Enregistrement séquentiel d'événements produit par un système. En l'absence de contrôles cryptographiques ou d'intégrité complémentaires, il ne constitue pas une preuve.  

**Preuve (Proof)** — Artefact dont l'authenticité et l'intégrité peuvent être établies indépendamment, par calcul, sans faire confiance à l'émetteur.

**Vérification (Verification)** — Opération déterministe qui établit si un reçu est authentique et intact. Prend un reçu et une clé publique ; retourne vrai ou faux. Ne dépend d'aucun système tiers.

**Attestation (Attestation)** — Déclaration émise par une entité affirmant qu'une assertion est vraie. Sa valeur dépend de la confiance accordée à l'émetteur, non d'une vérification cryptographique indépendante .

---

## 3. Distinctions canoniques

**Reçu vs Rapport**  
Le rapport explique. Le reçu atteste.  
Un rapport peut être réécrit. Un reçu ne peut être modifié sans invalider sa signature.

**Reçu vs Journal**  
Le journal enregistre. Le reçu engage.  
Un journal documente ce qui s'est passé selon le système. Un reçu prouve ce qui a été décidé, indépendamment du système.

**Preuve vs Vérification**  
La preuve est l'artefact. La vérification est l'opération qui l'établit.  
Une preuve sans vérification est une affirmation. Une vérification sans preuve est impossible.

**Attestation vs Vérification**  
L'attestation repose sur la confiance en l'émetteur. La vérification repose sur le calcul.  
ADR relève de la vérification, non de l'attestation.

---

## 4. Règles de langage

1. **Reçu avant rapport.** Un ADR est un reçu, pas un rapport. Ne pas substituer l'un à l'autre.
2. **Preuve ≠ explication.** ADR prouve l'intégrité et l'authenticité d'une décision. Il n'explique pas pourquoi cette décision était correcte.
3. **Journal ≠ preuve.** Un fichier de log n'est pas un ADR. Ne pas employer "log" ou "trace" comme équivalent de preuve cryptographique.
4. **Ne pas sur-attribuer.** ADR ne fournit pas de gouvernance, d'identité, de politique, ni de supervision. Tout énoncé dépassant ces limites est inexact.
5. **Vérification = calcul.** La vérification ADR ne nécessite aucune connexion réseau, aucune confiance dans l'émetteur, aucun service tiers.

---

## 5. Positionnement

ADR est une **primitive de preuve**. Il constitue la couche cryptographique sur laquelle des systèmes de confiance peuvent s'appuyer.

ADR ne remplace pas :

- la gouvernance et les politiques décisionnelles
- la supervision opérationnelle et le contrôle des modèles
- les systèmes d'identité et d'authentification
- la documentation réglementaire et les référentiels de conformité

---

## 6. Formulations verrouillées

> Le rapport explique. Le reçu atteste.

> Sans reçu, une décision reste une affirmation.

> La vérification ne dépend pas du système qui a produit la décision.

> ADR ne prouve pas que la décision était juste. Il prouve qu'elle n'a pas été altérée.

> Une preuve cryptographique ne se délègue pas à la confiance.

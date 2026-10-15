# FortiX Policy Engine v1

Status: REFERENCE — ADR v1 foundation; current architecture: [evidence](../evidence/README.md).

## Status Precision
FortiX Policy Engine v1 directly emits only `allow`, `block`, or `require_review`. `override` is reserved for a later human-approved exception path and is not emitted directly by `evaluate()`.

Le FortiX Policy Engine v1 émet directement uniquement `allow`, `block` ou `require_review`. `override` est réservé à un chemin ultérieur d'exception approuvée par un humain et n'est pas émis directement par `evaluate()`.

## Purpose
FortiX Policy Engine v1 is the deterministic governance layer that transforms explicit action signals into an explainable policy decision. The complete status model includes `allow`, `block`, `require_review`, and `override`, but only `allow`, `block`, and `require_review` are produced directly by the engine in v1.

Le FortiX Policy Engine v1 est la couche de gouvernance déterministe qui transforme des signaux d'action explicites en une décision de policy explicable. Le modèle complet de statuts comprend `allow`, `block`, `require_review` et `override`, mais seuls `allow`, `block` et `require_review` sont produits directement par le moteur en v1.

It does not replace KYC, KYB, AML, sanctions, or ADR verification systems. It consumes their signals and produces an explainable decision.

Il ne remplace pas les systèmes KYC, KYB, AML, sanctions ou de vérification ADR. Il consomme leurs signaux et produit une décision explicable.

## ADR Boundary
FortiX v1 is outside ADR Core.

FortiX v1 est en dehors de l'ADR Core.

- It does not modify canonicalization.
- It does not modify hashing.
- It does not modify signatures.
- It does not modify receipt verification behavior.
- It does not introduce hidden or probabilistic scoring.

- Il ne modifie pas la canonicalization.
- Il ne modifie pas le hashing.
- Il ne modifie pas les signatures.
- Il ne modifie pas le comportement de vérification des reçus.
- Il n'introduit pas de scoring caché ou probabiliste.

## Canonical Decision Shape
Every policy decision returned by FortiX v1 includes the canonical fields below.

Chaque décision de policy renvoyée par FortiX v1 inclut les champs canoniques ci-dessous.

```json
{
  "status": "allow|block|require_review|override",
  "reason_code": "STRING_CODE",
  "reason_text": "Human-readable explanation",
  "policy_id": "fortix-policy-v1",
  "policy_version": "1.0.0",
  "requires_human": true,
  "overrideable": false,
  "risk_level": "low|medium|high|critical",
  "triggered_rules": ["rule_id"],
  "human_review": null
}
```

For backward compatibility with the current gateway contract, the runtime response also includes legacy aliases:

Pour la compatibilité ascendante avec le contrat actuel du gateway, la réponse d'exécution inclut également des alias hérités :

- `decision` -> D1 gateway alias: `ALLOW|DENY|REVIEW` (uppercase protocol identifiers; see `docs/strategy/fortix_runtime_patterns.md` §2.1 / §2.2).
- `reason` -> legacy machine-readable reason token used by current gateway status mapping
- `override` is **reserved** D2 application-layer state (`PolicyStatus = "override"`) for a future human-approved exception path. It is **not** a D1 gateway decision and is never emitted to the gateway response. The current engine does not produce it (see `tests/policy/test_policy_engine_v1.py::test_evaluate_never_emits_override`). Promoting `override` to a D1 gateway decision would require widening the Tier-0 `docs/spec/ADR-SPEC-v1.md` gateway taxonomy — out of scope for v1.

The canonical fields remain `status`, `reason_code`, and `reason_text`.

Les champs canoniques restent `status`, `reason_code` et `reason_text`.

## Human Review Object
Human review is explicit and separate from machine evaluation.

La revue humaine est explicite et distincte de l'évaluation machine.

```json
{
  "review_id": "rev-123",
  "review_role": "compliance_officer",
  "reviewer_id": "user-42",
  "outcome": "approved|rejected",
  "justification": "Manual disposition rationale",
  "timestamp": "2026-04-23T10:00:00Z"
}
```

`evaluate()` never creates an implicit human review object and never emits `override` directly.

`evaluate()` ne crée jamais d'objet de revue humaine implicite et n'émet jamais `override` directement.

## Decision Semantics
- `allow`: automatic approval
- `block`: automatic denial
- `require_review`: stop automatic execution and require a separate human review record
- `override`: reserved for a later human-approved exception path only

- `allow`: approbation automatique
- `block`: refus automatique
- `require_review`: arrêt de l'exécution automatique et exigence d'un enregistrement de revue humaine distinct
- `override`: réservé uniquement à un chemin ultérieur d'exception approuvée par un humain

## Inputs
FortiX v1 reads explicit signals from `ActionRequest.metadata` and `ActionRequest.payload`.

FortiX v1 lit des signaux explicites depuis `ActionRequest.metadata` et `ActionRequest.payload`.

Supported v1 signals:

Signaux v1 pris en charge :

- `metadata.actor_authorized: bool`
- `metadata.auth_valid: bool`
- `metadata.policy_forbidden: bool`
- `metadata.sanctions_hit: bool`
- `metadata.risk_level` or legacy `metadata.risk`
- `metadata.aml_score: number`
- `metadata.kyb_status: "complete" | "incomplete"`
- `metadata.ubo_missing: bool`
- `metadata.context_anomaly: bool`
- `metadata.dual_control_required: bool`
- `metadata.identity_verified: bool`
- `metadata.review_approved: bool`
- `payload.amount` or `metadata.amount`

Explicit thresholds in v1:

Seuils explicites en v1 :

- AML review threshold: `80`
- Amount review threshold: `100000`

## Evaluation Order
The engine uses first-match-wins evaluation in this order:

Le moteur utilise une évaluation de type first-match-wins dans cet ordre :

1. Forbidden actor / invalid auth
   - unauthorized actor -> `BLOCK_UNAUTHORIZED_ACTOR`
   - invalid auth -> `BLOCK_INVALID_AUTH`
   - explicit forbidden rule -> `BLOCK_POLICY_FORBIDDEN`
   - legacy compatibility rule: external transfer without `review_approved=true` -> `BLOCK_POLICY_FORBIDDEN`
2. Sanctions hard block
   - sanctions hit -> `BLOCK_SANCTIONS_HIT`
3. Critical risk hard block
   - `risk_level == critical` -> `BLOCK_CRITICAL_RISK`
4. Review-required conditions
   - AML score high -> `REVIEW_AML_SCORE_HIGH`
   - KYB incomplete -> `REVIEW_KYB_INCOMPLETE`
   - UBO missing -> `REVIEW_UBO_MISSING`
   - amount above threshold -> `REVIEW_AMOUNT_ABOVE_THRESHOLD`
   - context anomaly or legacy `risk == high` -> `REVIEW_CONTEXT_ANOMALY`
   - dual control required -> `REVIEW_DUAL_CONTROL_REQUIRED`
5. Allow
   - low-risk verified -> `ALLOW_LOW_RISK_VERIFIED`
   - otherwise -> `ALLOW_BASELINE_OK`

1. Acteur interdit / authentification invalide
   - acteur non autorisé -> `BLOCK_UNAUTHORIZED_ACTOR`
   - authentification invalide -> `BLOCK_INVALID_AUTH`
   - règle explicite d'interdiction -> `BLOCK_POLICY_FORBIDDEN`
   - règle de compatibilité héritée : transfert externe sans `review_approved=true` -> `BLOCK_POLICY_FORBIDDEN`
2. Blocage sanctions
   - sanctions hit -> `BLOCK_SANCTIONS_HIT`
3. Blocage risque critique
   - `risk_level == critical` -> `BLOCK_CRITICAL_RISK`
4. Conditions nécessitant une revue
   - score AML élevé -> `REVIEW_AML_SCORE_HIGH`
   - KYB incomplet -> `REVIEW_KYB_INCOMPLETE`
   - UBO manquant -> `REVIEW_UBO_MISSING`
   - montant au-dessus du seuil -> `REVIEW_AMOUNT_ABOVE_THRESHOLD`
   - anomalie de contexte ou `risk == high` hérité -> `REVIEW_CONTEXT_ANOMALY`
   - dual control requis -> `REVIEW_DUAL_CONTROL_REQUIRED`
5. Allow
   - faible risque vérifié -> `ALLOW_LOW_RISK_VERIFIED`
   - sinon -> `ALLOW_BASELINE_OK`

## Initial Reason Code Catalog
The v1 catalog includes:

Le catalogue v1 comprend :

- `ALLOW_BASELINE_OK`
- `ALLOW_LOW_RISK_VERIFIED`
- `BLOCK_SANCTIONS_HIT`
- `BLOCK_UNAUTHORIZED_ACTOR`
- `BLOCK_POLICY_FORBIDDEN`
- `BLOCK_INVALID_AUTH`
- `BLOCK_CRITICAL_RISK`
- `REVIEW_AML_SCORE_HIGH`
- `REVIEW_KYB_INCOMPLETE`
- `REVIEW_UBO_MISSING`
- `REVIEW_AMOUNT_ABOVE_THRESHOLD`
- `REVIEW_CONTEXT_ANOMALY`
- `REVIEW_DUAL_CONTROL_REQUIRED`
- `OVERRIDE_COMPLIANCE_APPROVED`
- `OVERRIDE_SUPERVISOR_APPROVED`
- `OVERRIDE_EXCEPTION_GRANTED`

Override codes are reserved for the future human-review completion path. They are intentionally not emitted by `evaluate()`.

Les codes d'override sont réservés au futur chemin de finalisation de revue humaine. Ils ne sont volontairement pas émis par `evaluate()`.

## Gateway Integration
FortiX v1 is wired into the existing `ActionGateway` policy step with minimal change.

FortiX v1 est intégré à l'étape de policy existante de `ActionGateway` avec une modification minimale.

- Current gateway order is preserved.
- ADR receipt generation remains untouched.
- Gateway idempotency and replay protection remain separate gateway concerns.
- The gateway now returns the richer FortiX policy object under `response["policy"]`.

- L'ordre actuel du gateway est préservé.
- La génération du reçu ADR reste inchangée.
- L'idempotence et la protection contre le replay du gateway restent des préoccupations distinctes au niveau du gateway.
- Le gateway renvoie désormais l'objet de policy FortiX enrichi sous `response["policy"]`.

This means FortiX policy evaluation is integrated, but broader pipeline re-ordering to move policy before receipt generation is deferred in v1 to avoid invasive architectural change.

Cela signifie que l'évaluation de policy FortiX est intégrée, mais qu'une réorganisation plus large du pipeline pour déplacer la policy avant la génération du reçu est différée en v1 afin d'éviter un changement architectural invasif.

## Limits of v1
- no ML scoring
- no probabilistic ranking
- no external provider orchestration
- no automatic override production
- no attempt to redesign the gateway or ADR stack
- no persistent review workflow implementation beyond the explicit review schema

- pas de scoring ML
- pas de classement probabiliste
- pas d'orchestration de fournisseurs externes
- pas de production automatique de `override`
- pas de tentative de refonte du gateway ou de la pile ADR
- pas d'implémentation persistante de workflow de revue au-delà du schéma explicite de revue humaine

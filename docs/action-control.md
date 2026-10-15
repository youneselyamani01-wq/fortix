# FortiX Action Control v1

## Module boundary: `app/control/` vs `app/action_control/`

FortiX has two adjacent runtime modules with similar names. They serve different decision domains. **Do not merge them; do not rename them in this PR.**

| Module | Domain | Vocabulary | Role |
|---|---|---|---|
| `app/control/` | D1 — Gateway / Runtime | `ALLOW` / `REVIEW` / `DENY` (uppercase) | Stateless control-rule evaluator. Produces a D1 verdict that the gateway accepts directly. Does not call governance extensions. |
| `app/action_control/` | D2 — Governance / Pre-gateway | `allow` / `require_review` / `block` (lowercase) | Pre-gateway intent-evaluation surface. Consumes upstream policy/gateway decisions and re-emits in D2 governance vocabulary for downstream governance assessment. Contains the canonical D1→D2 mapper at `_decision_from_policy`. |

Code in either module must not emit the other's vocabulary inline. Cross-domain emission goes through the canonical mappers in `app/models/policy_decision.py` (`_STATUS_TO_DECISION` / `_DECISION_TO_STATUS`) or `app/action_control/service.py:_decision_from_policy`. See `docs/strategy/fortix_runtime_patterns.md` §2 for the full decision-code domain definitions and the payload namespacing rule.

---

## Overview

FortiX Action Control is the control layer for sensitive actions. It provides a concise orchestration surface for submitting an action intent, applying policy, routing through the authoritative gateway, receiving an ADR receipt, and verifying that receipt independently.

EN:
Control before execution.
Receipt at execution.
Independent verification after execution.

FR:
Contrôle avant exécution.
Reçu à l’exécution.
Vérification indépendante après exécution.

## Architecture

Intent -> Orchestrator -> Policy -> Gateway -> ADR -> Verify

- Orchestrator: routes and aggregates.
- Policy: decides allow, require_review, or block.
- Gateway: authoritative execution and ADR issuance.
- ADR: cryptographic receipt.
- Verify: independent validation.

## Endpoint

`POST /action-control/intent`

Example request:

```json
{
  "action": "payment.submit",
  "actor": "claude_worker",
  "amount": 250000,
  "currency": "EUR",
  "destination": "AE",
  "timestamp": "2026-04-24T10:30:00Z",
  "action_id": "demo-123"
}
```

Example response:

```json
{
  "product": "FortiX Action Control",
  "control_version": "action-control-v1",
  "flow": "Intent -> Policy -> Gateway -> ADR -> Verify",
  "decision": "require_review",
  "reason": "Amount 250000 exceeds the review threshold 100000.",
  "gateway_status": "pending_review",
  "decision_trace": {
    "policy_id": "fortix-policy-v1",
    "rules_triggered": ["amount_above_threshold"],
    "risk_score": 0.5
  },
  "receipt": {
    "version": "1.0",
    "payload": {
      "action_id": "demo-123",
      "actor_id": "claude_worker",
      "action": "payment.submit"
    },
    "hash": "b3...",
    "signature": "7a...",
    "algorithm": {
      "hash": "BLAKE3",
      "signature": "Ed25519"
    },
    "key_id": "<configured-key-id>"
  },
  "verify": {
    "verdict": "VALID",
    "reason_code": "valid",
    "explanation": "The cryptographic signature is authentic and the payload is unaltered since the receipt was issued."
  }
}
```

## Design Principles

- Orchestrator is not authoritative.
- Gateway is the only execution authority.
- ADR Core is immutable.
- Verification is independent and offline-capable.

## v1 Limitations

- ADR signing requires `FORTIX_ADR_SIGNING_PRIVATE_KEY_HEX` and `FORTIX_ADR_SIGNING_KEY_ID`.
- Missing or malformed signing configuration fails closed; no embedded demo key is used.
- In-memory idempotency.
- Limited policy surface for demo rules.
- Runtime environment injection is not production key management.

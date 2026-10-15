# ADR Gateway

## Purpose

The ADR Gateway is the policy and execution boundary around ADR Core.  
ADR Core remains responsible for deterministic canonicalization, BLAKE3 hashing, and Ed25519 signature verification.  
Gateway logic is responsible for action intake, policy decisions, idempotency, and execution outcomes.

## Decision Model

Gateway decisions are:

- `ALLOW`
- `REVIEW`
- `DENY`

Decision semantics:

- `ALLOW`: action is permitted to execute
- `REVIEW`: action is not executed and is queued/pending review
- `DENY`: action is blocked

## Execution Model

Gateway responses include both `status` and `executed`.

Normative mapping:

- `decision=ALLOW` -> `status=executed`, `executed=true`
- `decision=REVIEW` -> `status=pending_review`, `executed=false`
- `decision=DENY` + `reason=replay_detected` -> `status=blocked_by_replay_protection`, `executed=false`
- `decision=DENY` + `reason=duplicate_action_id` -> `status=blocked_by_idempotency_guard`, `executed=false`
- `decision=DENY` (default) -> `status=blocked_by_policy`, `executed=false`

## Reason Codes

Current reason codes used by the gateway policy stack include:

- `ok`
- `high_risk_requires_review`
- `external_transfer_requires_review_approved`
- `timestamp_missing_or_blank`
- `replay_detected`
- `duplicate_action_id`

## Invariants

The gateway enforces the following invariants:

- ADR is always generated before policy evaluation.
- ADR is generated for all outcomes, including `REVIEW` and `DENY`.
- `executed` is `true` only if `decision == ALLOW`.
- Replay protection and idempotency are gateway/state concerns, not ADR Core verification concerns.
- ADR Core cryptographic behavior is unchanged by gateway policies.

## Idempotency Model

Idempotency is keyed by `action_id`.

For each `action_id`, the gateway stores one canonical business fingerprint built from:

- `actor_id`
- `action`
- `target`
- `payload`
- `metadata`

The fingerprint explicitly excludes `timestamp`.

Behavior:

1. If `action_id` does not exist: store fingerprint and proceed normally.
2. If `action_id` exists and fingerprint matches: `DENY` with `reason=replay_detected`.
3. If `action_id` exists and fingerprint differs: `DENY` with `reason=duplicate_action_id`.

## Decision Logging

Gateway processing is append-only logged with at least:

- `ts`
- `action_id`
- `mode`
- `adr_hash`
- `policy_decision`
- `policy_reason`
- `status`
- `executed`

---

## Timestamp Policy

Timestamp validation is a **Gateway policy**, not an ADR Core requirement.

ADR Core (`adr_verify.py`) treats payload content as opaque. It does not inspect
timestamp fields, validate formats, or reject future dates. A receipt with a
payload timestamp of `"2099-01-01T00:00:00Z"` passes ADR Core verification.

The default Gateway timestamp policy (enforced by `GatewayVerifier` and
`PolicyEngine.check_timestamp_policy`) applies to payload fields named
`timestamp`, `issued_at`, and `decided_at`:

| Rule | Policy |
| --- | --- |
| Field must be valid ISO 8601 datetime | DENY if malformed |
| UTC offset must be in range `[-12:00, +14:00]` | DENY if out of range |
| Timestamp must not be in the future | DENY if `ts > now_utc` |
| `issued_at` must be ≤ `decided_at` | DENY if order violated |

All other payload fields are ignored by the timestamp policy.

---

## GatewayVerifier

`app/gateway/gateway_verify.GatewayVerifier` is the **Gateway-layer reference
implementation** for receipt verification.

It is **not** a replacement for or extension of ADR Core. ADR Core (`adr_verify.py`)
is always called as an inner step; its behavior is unchanged.

`GatewayVerifier` wraps ADR Core with three Gateway-scope policies evaluated in order:

| Step | Policy | Concern |
| --- | --- | --- |
| 1 | Key registry | Resolves `key_id` → `public_key_hex`. Unknown `key_id` is rejected. |
| 2 | ADR Core | Stateless cryptographic verification (unchanged). |
| 3 | Replay detection | Stateful — rejects receipt hashes seen before (per-instance). |
| 4 | Timestamp policy | Validates `timestamp`, `issued_at`, `decided_at` in payload (if enabled). |

A receipt is recorded as seen (step 3) only after all checks pass.

```python
from app.gateway.gateway_verify import GatewayVerifier

verifier = GatewayVerifier(
    key_registry={"my-key-id": "public_key_hex_here"},
    timestamp_policy=True,  # default
)

result = verifier.verify(receipt_dict)  # True or False
```

**Core vs Gateway boundary:**

| Concern | ADR Core | Gateway |
| --- | --- | --- |
| Payload canonicalization | ✅ normative | — |
| BLAKE3 hash | ✅ normative | — |
| Ed25519 signature | ✅ normative | — |
| Key registry lookup | — | ✅ `GatewayVerifier` |
| Replay detection | — | ✅ `GatewayVerifier`, `InMemoryReplayStateStore` |
| Timestamp format / future / ordering | — | ✅ `GatewayVerifier`, `PolicyEngine` |
| Idempotency guard (`action_id`) | — | ✅ `ActionGateway` |
| ALLOW / REVIEW / DENY decisions | — | ✅ `ActionGateway`, `PolicyEngine` |

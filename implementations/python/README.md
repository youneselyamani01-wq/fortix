# FortiX Python Integration Kit (v1)

Thin Python client for the current FortiX v1 API.

This SDK is intentionally small. It wraps the real current integration surfaces so
an integrator can submit governed actions and verify receipts without re-reading
the FastAPI contracts by hand.

## What it wraps

- `POST /action/submit` — authoritative governed action submission path
- `POST /verify/receipt` — primary receipt verification surface

## What it does not wrap by default

- `POST /adr/verify` — legacy boolean verification endpoint
- `POST /control/evaluate` and `POST /control/explain` — advisory-only surfaces, not the runtime authority

## Install

From the repo root:

```bash
pip install -e implementations/python
```

## Quick start

```python
from datetime import UTC, datetime

from fortix_sdk import ActionRequest, FortiXClient

action = ActionRequest(
    action_id="txn-sdk-001",
    actor_id="agent-finops-01",
    action="approve_transfer",
    target="internal",
    timestamp=datetime.now(UTC).isoformat().replace("+00:00", "Z"),
    payload={
        "amount": 12000,
        "currency": "EUR",
        "recipient": "counterparty-B",
        "reference": "INV-2026-0010",
    },
    metadata={
        "risk": "low",
        "threshold_check": "pass",
    },
)

with FortiXClient("http://127.0.0.1:8000") as client:
    submit_result = client.submit_action(action)
    verify_result = client.verify_receipt(
        submit_result.adr_receipt,
        public_key_hex="<public-key-hex>",
    )

print(submit_result.policy.decision, submit_result.status)
print(verify_result.status, verify_result.code)
```

## Current v1 boundaries

- Verification requires a caller-supplied `public_key_hex`.
- `key_id` is not resolved to a public key by this SDK or by `POST /verify/receipt`.
- No key registry, trust-anchor, or revocation workflow is implied in v1.
- `executed=True` reflects the current gateway outcome only. It does not imply an external connector or settlement guarantee.
- The SDK is transport-only. It does not run a second policy engine locally.

## Examples

- [submit_action.py](examples/submit_action.py)
- [verify_receipt.py](examples/verify_receipt.py)

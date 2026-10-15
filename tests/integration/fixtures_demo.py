"""
Frozen scenario constants for end-to-end integration tests.

action_ids use the 'txn-e2e-' prefix to stay entirely separate from the
visual demo IDs (txn-demo-001/002/003) and avoid polluting the gateway's
idempotency state during live demonstrations.

FROZEN_ALLOW_RECEIPT / FROZEN_PUBLIC_KEY_HEX are taken verbatim from
docs/demo/remotion-props-reference.json (scenario: allow, key: demo-key-001).
"""

TIMESTAMP = "2026-03-25T09:15:00Z"

# ── Submit bodies ────────────────────────────────────────────────────────────

ALLOW_SUBMIT = {
    "action_id": "txn-e2e-allow-001",
    "actor_id": "agent-finops-01",
    "action": "approve_transfer",
    "target": "internal",
    "timestamp": TIMESTAMP,
    "payload": {
        "amount": 12000,
        "currency": "EUR",
        "recipient": "counterparty-B",
        "reference": "INV-2026-0010",
    },
    "metadata": {"risk": "low", "sanctions_flag": False, "threshold_check": "pass"},
}

REVIEW_SUBMIT = {
    "action_id": "txn-e2e-review-002",
    "actor_id": "agent-finops-02",
    "action": "approve_transfer",
    "target": "internal",
    "timestamp": TIMESTAMP,
    "payload": {
        "amount": 95000,
        "currency": "EUR",
        "recipient": "counterparty-A",
        "reference": "INV-2026-0047",
    },
    "metadata": {"risk": "high", "sanctions_flag": False, "threshold_check": "pass"},
}

DENY_SUBMIT = {
    "action_id": "txn-e2e-deny-ext-003",
    "actor_id": "agent-finops-03",
    "action": "transfer",
    "target": "external",
    "timestamp": TIMESTAMP,
    "payload": {
        "amount": 5000,
        "currency": "EUR",
        "recipient": "counterparty-X",
        "reference": "INV-2026-0099",
    },
    "metadata": {"risk": "low", "sanctions_flag": False, "threshold_check": "pass"},
}

# Replay test: low-risk internal transfer — first submit → ALLOW, repeat → replay_detected.
REPLAY_SUBMIT = {
    "action_id": "txn-e2e-replay-004",
    "actor_id": "agent-finops-01",
    "action": "approve_transfer",
    "target": "internal",
    "timestamp": TIMESTAMP,
    "payload": {
        "amount": 12000,
        "currency": "EUR",
        "recipient": "counterparty-B",
        "reference": "INV-2026-0010",
    },
    "metadata": {"risk": "low", "sanctions_flag": False, "threshold_check": "pass"},
}

VERIFY_SUBMIT = {
    "action_id": "txn-e2e-verify-005",
    "actor_id": "agent-finops-01",
    "action": "approve_transfer",
    "target": "internal",
    "timestamp": TIMESTAMP,
    "payload": {
        "amount": 12000,
        "currency": "EUR",
        "recipient": "counterparty-B",
        "reference": "INV-2026-0010",
    },
    "metadata": {"risk": "low", "sanctions_flag": False, "threshold_check": "pass"},
}

# ── Frozen receipt (remotion-props-reference.json → scenario: allow) ─────────

FROZEN_PUBLIC_KEY_HEX = (
    "d04ab232742bb4ab3a1368bd4615e4e6d0224ab71a016baf8520a332c9778737"
)

FROZEN_ALLOW_RECEIPT = {
    "version": "1.0",
    "payload": {
        "action_id": "txn-demo-001",
        "actor_id": "agent-finops-01",
        "action": "approve_transfer",
        "target": "internal",
        "timestamp": TIMESTAMP,
        "payload": {
            "amount": 12000,
            "currency": "EUR",
            "recipient": "counterparty-B",
            "reference": "INV-2026-0010",
        },
        "metadata": {
            "risk": "low",
            "sanctions_flag": False,
            "threshold_check": "pass",
        },
    },
    "hash": "6791f7a9ab96fda06c3e16e90c9fba1dc3372aa9713b8c4ea75b80d02a8628c4",
    "signature": (
        "fa1636bb5be7f86b461cabc152527480f297368ca57a52576206ccabd16878a5"
        "2caaf6c48203dfced3dcb2695a5bf435af3ab856dd943ba444d50af05b532f09"
    ),
    "algorithm": {"hash": "BLAKE3", "signature": "Ed25519"},
    "key_id": "demo-key-001",
}

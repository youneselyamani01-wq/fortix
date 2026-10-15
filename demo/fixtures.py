"""
FortiX Demo  - Fixed Scenario Fixtures
========================================
All demo data is frozen so the flow is fully reproducible without a live server.

Three scenarios cover the three terminal control/gateway outcomes:

  ALLOW    - standard low-risk internal transfer.  Policy passes; receipt issued;
             action executed.

  REVIEW   - high-value elevated-risk transfer.  Policy escalates; receipt issued;
             action queued for human approval.

  DENY     - external transfer without explicit approval.  Policy blocks; receipt
             still issued (proves what was attempted); action not executed.

Key notes:
  - DEMO_PRIVATE_KEY_HEX / DEMO_KEY_ID match the server default
    (ADR_DEMO_PRIVATE_KEY_HEX / ADR_DEMO_KEY_ID env defaults).
  - DEMO_PUBLIC_KEY_HEX is derived from the private key at import time.
  - DEMO_TIMESTAMP is fixed so hashes are reproducible across runs.
  - action_ids use the 'txn-demo-' prefix, kept separate from 'txn-e2e-' test IDs.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from nacl.signing import SigningKey

# ---------------------------------------------------------------------------
# Demo key pair  - deterministic, matches server default
# ---------------------------------------------------------------------------

DEMO_PRIVATE_KEY_HEX: str = "11" * 32
DEMO_KEY_ID: str = "demo-key-001"
DEMO_PUBLIC_KEY_HEX: str = (
    SigningKey(bytes.fromhex(DEMO_PRIVATE_KEY_HEX)).verify_key.encode().hex()
)

# Fixed timestamp so every run produces identical hashes and signatures.
DEMO_TIMESTAMP: str = "2026-03-25T09:15:00Z"


# ---------------------------------------------------------------------------
# Scenario definition
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class DemoScenario:
    id: str
    title: str
    subtitle: str
    action: dict                    # ActionRequest-compatible dict
    expected_control_verdict: str   # "ALLOW" | "REVIEW" | "DENY"
    expected_gateway_status: str    # GatewayStatus.value
    proves: list[str]               # non-technical bullet points


# ---------------------------------------------------------------------------
# The three reference scenarios
# ---------------------------------------------------------------------------

SCENARIOS: list[DemoScenario] = [
    DemoScenario(
        id="allow",
        title="Scenario 1  - Standard Internal Transfer",
        subtitle="Low-risk internal approval -> ALLOW",
        action={
            "action_id": "txn-demo-001",
            "actor_id": "agent-finops-01",
            "action": "approve_transfer",
            "target": "internal",
            "timestamp": DEMO_TIMESTAMP,
            "payload": {
                "amount": 12_000,
                "currency": "EUR",
                "recipient": "counterparty-B",
                "reference": "INV-2026-0010",
            },
            "metadata": {
                "risk": "low",
            },
        },
        expected_control_verdict="ALLOW",
        expected_gateway_status="executed",
        proves=[
            "Policy evaluated the request and approved it without human intervention.",
            "A tamper-evident cryptographic receipt was issued BEFORE the action executed.",
            "An independent verifier  - with no gateway state or private key  - "
            "confirmed the receipt is authentic and the payload is unaltered.",
            "The full decision chain is recorded in a structured, serialisable audit trail.",
        ],
    ),

    DemoScenario(
        id="review",
        title="Scenario 2  - High-Value Transfer, Elevated Risk",
        subtitle="High-risk action -> REVIEW (escalated for human approval)",
        action={
            "action_id": "txn-demo-002",
            "actor_id": "agent-finops-02",
            "action": "approve_transfer",
            "target": "internal",
            "timestamp": DEMO_TIMESTAMP,
            "payload": {
                "amount": 95_000,
                "currency": "EUR",
                "recipient": "counterparty-A",
                "reference": "INV-2026-0047",
            },
            "metadata": {
                "risk": "high",
            },
        },
        expected_control_verdict="REVIEW",
        expected_gateway_status="pending_review",
        proves=[
            "Elevated-risk actions are not auto-approved  - the system halts and escalates.",
            "A receipt is issued even for escalated actions, "
            "creating a cryptographic record of what was requested.",
            "An independent verifier confirms the receipt is authentic, "
            "giving the human reviewer a trusted source of truth.",
            "The escalation itself is fully audited with its idempotency outcome recorded.",
        ],
    ),

    DemoScenario(
        id="deny",
        title="Scenario 3  - External Transfer, Policy Block",
        subtitle="Unapproved external transfer -> DENY",
        action={
            "action_id": "txn-demo-003",
            "actor_id": "agent-finops-03",
            "action": "transfer",
            "target": "external",
            "timestamp": DEMO_TIMESTAMP,
            "payload": {
                "amount": 5_000,
                "currency": "EUR",
                "recipient": "counterparty-X",
                "reference": "INV-2026-0099",
            },
            "metadata": {
                "risk": "low",
            },
        },
        expected_control_verdict="DENY",
        expected_gateway_status="blocked_by_policy",
        proves=[
            "Policy blocked an unapproved external transfer before it could execute.",
            "A receipt was still issued  - providing cryptographic evidence "
            "of what was attempted and when.",
            "An independent verifier confirms the receipt is authentic, "
            "so the denial cannot be repudiated.",
            "The blocked attempt is recorded in the audit trail with full context.",
        ],
    ),
]

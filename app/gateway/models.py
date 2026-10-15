"""
FortiX Gateway — Typed Models
================================
Defines the stable vocabulary for gateway status, idempotency outcomes,
and the structured audit entry.

GatewayStatus.value strings are the canonical status tokens returned in
action responses; they must never be changed without a versioned migration.
"""
from __future__ import annotations

import uuid
from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Status — all reachable terminal states for an action
# ---------------------------------------------------------------------------

class GatewayStatus(str, Enum):
    """
    Explicit, exhaustive set of gateway terminal states.

    The .value of each member is the exact string returned in the HTTP response
    `status` field and written to the audit log.  Do not rename values.
    """

    EXECUTED = "executed"
    PENDING_REVIEW = "pending_review"
    BLOCKED_BY_REPLAY = "blocked_by_replay_protection"
    BLOCKED_BY_IDEMPOTENCY = "blocked_by_idempotency_guard"
    BLOCKED_BY_POLICY = "blocked_by_policy"


# ---------------------------------------------------------------------------
# Idempotency outcome — tracks the gateway guard result independently of
# the policy engine's own replay check
# ---------------------------------------------------------------------------

class IdempotencyOutcome(str, Enum):
    """
    Result of the gateway-level idempotency guard.

    FIRST_SEEN  — action_id has not been seen before; guard passes.
    REPLAY      — same action_id with the same business fingerprint seen again.
    DUPLICATE   — same action_id with a different business fingerprint
                  (conflicting mutation attempt).
    """

    FIRST_SEEN = "first_seen"
    REPLAY = "replay"
    DUPLICATE = "duplicate"


# ---------------------------------------------------------------------------
# Audit entry — one record per gateway processing cycle
# ---------------------------------------------------------------------------

class GatewayAuditEntry(BaseModel):
    """
    Fully typed, serialisable record of a single gateway processing cycle.

    Written to the gateway audit log after every call (including failures).
    Deserialise with GatewayAuditEntry.model_validate(json.loads(line)).
    """

    entry_id: str = Field(
        default_factory=lambda: str(uuid.uuid4()),
        description="Unique ID for this audit entry",
    )
    ts: str = Field(..., description="ISO 8601 UTC timestamp of processing")
    action_id: str
    actor_id: str
    mode: Literal["submit", "review", "fail_closed"]
    adr_hash: str
    policy_decision: str
    policy_reason: str
    status: GatewayStatus
    executed: bool
    idempotency_outcome: IdempotencyOutcome

    def to_audit_dict(self) -> dict:
        """Return a JSON-safe dict for JSONL persistence."""
        return self.model_dump(mode="json")

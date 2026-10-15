"""
FortiX Gateway — Status Mapping
==================================
Single source of truth for mapping (policy_decision, policy_reason) pairs to
GatewayStatus values.

compute_gateway_status() is a pure function — same inputs always yield the
same GatewayStatus.  The mapping is exhaustive: any input not matched by an
explicit rule falls through to BLOCKED_BY_POLICY (fail-closed default).
"""
from __future__ import annotations

from app.gateway.models import GatewayStatus


# Explicit (decision, reason) → status mappings.
# Evaluated in order; first match wins.
_STATUS_MAP: list[tuple[str, str | None, GatewayStatus]] = [
    ("ALLOW",  None,                         GatewayStatus.EXECUTED),
    ("REVIEW", None,                         GatewayStatus.PENDING_REVIEW),
    ("DENY",   "replay_detected",            GatewayStatus.BLOCKED_BY_REPLAY),
    ("DENY",   "duplicate_action_id",        GatewayStatus.BLOCKED_BY_IDEMPOTENCY),
]
_DEFAULT_DENY_STATUS = GatewayStatus.BLOCKED_BY_POLICY


def compute_gateway_status(decision: str, reason: str) -> GatewayStatus:
    """
    Map a (policy_decision, policy_reason) pair to a GatewayStatus.

    - ``reason=None`` in the table acts as a wildcard that matches any reason.
    - Any DENY not matched by an explicit reason falls back to BLOCKED_BY_POLICY.
    - Unknown decision values also fall back to BLOCKED_BY_POLICY (fail-closed).
    """
    for map_decision, map_reason, status in _STATUS_MAP:
        if decision == map_decision:
            if map_reason is None or reason == map_reason:
                return status
    return _DEFAULT_DENY_STATUS

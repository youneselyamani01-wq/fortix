"""
FortiX Control Layer — Data Models
===================================
Standardised types for control verdicts and decision traces.

DecisionTrace is the auditable record of a single evaluation cycle.
It is fully JSON-serialisable via .model_dump(mode="json").
"""
from __future__ import annotations

from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, Field


class VerdictCode(str, Enum):
    """
    Explicit, machine-readable reason codes.

    Every verdict carries exactly one code so callers can branch on semantics
    without parsing free-text strings.

    Note: replay detection is a gateway/runtime concern enforced by
    ActionGateway._idempotency_guard_result().  It is not an advisory
    control-layer concept and has no code here.
    """

    OK = "ok"
    TIMESTAMP_MISSING = "timestamp_missing"
    TIMESTAMP_INVALID = "timestamp_invalid"
    EXTERNAL_TRANSFER_BLOCKED = "external_transfer_blocked"
    HIGH_RISK_ESCALATION = "high_risk_escalation"
    INTERNAL_ERROR = "internal_error"


class ControlVerdict(BaseModel):
    """Standardised, flat verdict returned by the control service."""

    verdict: Literal["ALLOW", "DENY", "REVIEW"]
    code: VerdictCode
    message: str


class RuleTrace(BaseModel):
    """Record of a single rule evaluation within a decision cycle."""

    rule: str
    matched: bool
    verdict: Literal["ALLOW", "DENY", "REVIEW"] | None = None
    code: VerdictCode | None = None


class DecisionTrace(BaseModel):
    """
    Full, serialisable audit record for one control evaluation.

    Designed to be persisted as-is; call .model_dump(mode="json") for
    JSON-safe output (enums serialised as their string values).
    """

    trace_id: str = Field(..., description="UUID for this evaluation instance")
    action_id: str
    actor_id: str
    evaluated_at: str = Field(..., description="ISO 8601 UTC timestamp")
    policy_version: str
    verdict: ControlVerdict
    rules_evaluated: list[RuleTrace]

    def to_audit_dict(self) -> dict[str, Any]:
        """Return a JSON-serialisable dict suitable for JSONL audit logs."""
        return self.model_dump(mode="json")

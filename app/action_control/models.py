from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.gateway.gateway_verify import _parse_iso8601


ProductName = Literal["FortiX Action Control"]
ControlVersion = Literal["action-control-v1"]
FlowName = Literal["Intent -> Policy -> Gateway -> ADR -> Verify"]
ActionControlDecision = Literal["allow", "require_review", "block"]
ActionControlGatewayStatus = Literal[
    "executed",
    "pending_review",
    "blocked_by_policy",
    "blocked_by_replay_protection",
    "blocked_by_idempotency_guard",
]
VerifyVerdict = Literal["VALID", "INVALID", "UNVERIFIABLE"]


class ActionControlIntent(BaseModel):
    """
    Input boundary for FortiX Action Control.

    `payload` and `metadata` are passed through to the existing ActionGateway
    after the demo-friendly top-level fields are copied into `payload`.
    """

    model_config = ConfigDict(extra="allow")

    action: str = Field(..., min_length=1)
    actor: str = Field(..., min_length=1)
    timestamp: str = Field(..., min_length=1)
    action_id: str = Field(..., min_length=1)
    amount: int | float | None = None
    currency: str | None = None
    destination: str | None = None
    target: str | None = None
    payload: dict[str, Any] = Field(default_factory=dict)
    metadata: dict[str, Any] = Field(default_factory=dict)

    @field_validator("timestamp")
    @classmethod
    def timestamp_must_be_iso8601(cls, value: str) -> str:
        if _parse_iso8601(value.strip()) is None:
            raise ValueError("timestamp must be a valid ISO 8601 datetime")
        return value


class ActionControlDecisionTrace(BaseModel):
    policy_id: str
    rules_triggered: list[str]
    risk_score: float


class ActionControlVerifySummary(BaseModel):
    verdict: VerifyVerdict
    reason_code: str
    explanation: str


class ActionControlResponse(BaseModel):
    product: ProductName
    control_version: ControlVersion
    flow: FlowName
    decision: ActionControlDecision
    reason: str
    gateway_status: ActionControlGatewayStatus
    decision_trace: ActionControlDecisionTrace
    receipt: dict[str, Any]
    verify: ActionControlVerifySummary

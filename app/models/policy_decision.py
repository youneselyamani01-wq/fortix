from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.models.human_review import HumanReview


PolicyStatus = Literal["allow", "block", "require_review", "override"]
RiskLevel = Literal["low", "medium", "high", "critical"]

_STATUS_TO_DECISION = {
    "allow": "ALLOW",
    "block": "DENY",
    "require_review": "REVIEW",
    # "override" is reserved D2 application-layer state (see
    # the retained runtime policy §2 and docs/spec/POLICY-ENGINE-V1.md).
    # It is not a D1 gateway decision and must not be emitted to the gateway.
    # Accessing the .decision property on a PolicyDecision with status="override"
    # raises KeyError by design.
}
_DECISION_TO_STATUS = {value: key for key, value in _STATUS_TO_DECISION.items()}


class PolicyDecision(BaseModel):
    """
    Explicit FortiX policy outcome.

    `decision` and `reason` are compatibility aliases for the gateway's
    existing response and audit handling. The canonical v1 fields are
    `status`, `reason_code`, and the rest of the schema below.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    status: PolicyStatus
    reason_code: str = Field(..., min_length=1)
    reason_text: str = Field(..., min_length=1)
    policy_id: str = Field(..., min_length=1)
    policy_version: str = Field(..., min_length=1)
    requires_human: bool
    overrideable: bool
    risk_level: RiskLevel
    triggered_rules: tuple[str, ...] = Field(default_factory=tuple)
    human_review: HumanReview | None = None
    legacy_reason: str = Field(default="", exclude=True)

    @property
    def decision(self) -> str:
        return _STATUS_TO_DECISION[self.status]

    @property
    def reason(self) -> str:
        return self.legacy_reason or self.reason_code

    def to_response_dict(self) -> dict[str, object]:
        data = self.model_dump(mode="json")
        data["decision"] = self.decision
        data["reason"] = self.reason
        return data

    @classmethod
    def from_legacy(
        cls,
        *,
        decision: Literal["ALLOW", "DENY", "REVIEW"],
        reason: str,
        reason_text: str,
        policy_id: str,
        policy_version: str,
        requires_human: bool,
        overrideable: bool,
        risk_level: RiskLevel,
        triggered_rules: tuple[str, ...] = (),
        human_review: HumanReview | None = None,
        reason_code: str | None = None,
    ) -> "PolicyDecision":
        return cls(
            status=_DECISION_TO_STATUS[decision],
            reason_code=reason_code or reason,
            reason_text=reason_text,
            policy_id=policy_id,
            policy_version=policy_version,
            requires_human=requires_human,
            overrideable=overrideable,
            risk_level=risk_level,
            triggered_rules=triggered_rules,
            human_review=human_review,
            legacy_reason=reason,
        )

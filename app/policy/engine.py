from __future__ import annotations

from dataclasses import dataclass
from typing import Literal
from typing import Protocol

from app.models.policy_decision import PolicyDecision, RiskLevel
from app.models.action_request import ActionRequest
from app.models.adr_receipt import ADRReceipt


POLICY_ID = "fortix-policy-v1"
POLICY_VERSION = "1.0.0"
AMOUNT_REVIEW_THRESHOLD = 100_000
AML_REVIEW_THRESHOLD = 90


@dataclass(frozen=True)
class PolicyResult:
    decision: Literal["ALLOW", "DENY", "REVIEW"]
    reason: str


class ReplayStateStore(Protocol):
    """
    Placeholder interface for stateful replay checks.
    Replay protection is outside ADR Core and belongs to gateway/policy state.
    """

    def seen(self, action_id: str, receipt_hash: str) -> bool:
        ...

    def remember(self, action_id: str, receipt_hash: str) -> None:
        ...


class NoopReplayStateStore:
    """
    Default replay store: accepts all requests.
    """

    def seen(self, action_id: str, receipt_hash: str) -> bool:
        _ = (action_id, receipt_hash)
        return False

    def remember(self, action_id: str, receipt_hash: str) -> None:
        _ = (action_id, receipt_hash)


class InMemoryReplayStateStore:
    """
    Optional in-memory placeholder for demo-only replay checks.
    """

    def __init__(self) -> None:
        self._seen_pairs: set[tuple[str, str]] = set()

    def seen(self, action_id: str, receipt_hash: str) -> bool:
        return (action_id, receipt_hash) in self._seen_pairs

    def remember(self, action_id: str, receipt_hash: str) -> None:
        self._seen_pairs.add((action_id, receipt_hash))


class PolicyEngine:
    def __init__(self, replay_store: ReplayStateStore | None = None) -> None:
        self._replay_store = replay_store or NoopReplayStateStore()

    def check_timestamp_policy(self, action: ActionRequest) -> PolicyDecision | None:
        # Timestamp semantic policy hook (outside ADR Core cryptographic checks).
        timestamp = (action.timestamp or "").strip()
        if timestamp == "":
            return _decision(
                decision="DENY",
                legacy_reason="timestamp_missing_or_blank",
                reason_code="TIMESTAMP_MISSING_OR_BLANK",
                reason_text="Action timestamp is missing or blank.",
                risk_level="medium",
                triggered_rules=("timestamp_present",),
            )
        return None

    def check_external_transfer_rule(self, action: ActionRequest) -> PolicyDecision | None:
        review_approved = action.metadata.get("review_approved") is True
        if action.action == "transfer" and action.target == "external" and not review_approved:
            return _decision(
                decision="DENY",
                legacy_reason="external_transfer_requires_review_approved",
                reason_code="BLOCK_EXTERNAL_TRANSFER_UNAPPROVED",
                reason_text="External transfer requires prior review approval.",
                risk_level="high",
                triggered_rules=("external_transfer",),
            )
        return None

    def check_high_risk_rule(self, action: ActionRequest) -> PolicyDecision | None:
        if action.metadata.get("risk") == "high":
            return _decision(
                decision="REVIEW",
                legacy_reason="high_risk_requires_review",
                reason_code="REVIEW_HIGH_RISK",
                reason_text="High risk action requires human review.",
                requires_human=True,
                risk_level="high",
                triggered_rules=("high_risk",),
            )
        return None

    def check_replay_policy(self, action: ActionRequest, receipt: ADRReceipt) -> PolicyDecision | None:
        if self._replay_store.seen(action.action_id, receipt.hash):
            return _decision(
                decision="DENY",
                legacy_reason="replay_detected",
                reason_code="BLOCK_REPLAY_DETECTED",
                reason_text="Replay detected for action and receipt.",
                risk_level="medium",
                triggered_rules=("replay_detected",),
            )
        return None

    def check_unauthorized_actor_rule(self, action: ActionRequest) -> PolicyDecision | None:
        if action.metadata.get("actor_authorized") is False:
            return _decision(
                decision="DENY",
                legacy_reason="actor_unauthorized",
                reason_code="BLOCK_UNAUTHORIZED_ACTOR",
                reason_text="Actor is not authorized for this action.",
                risk_level="high",
                triggered_rules=("unauthorized_actor",),
            )
        return None

    def check_sanctions_rule(self, action: ActionRequest) -> PolicyDecision | None:
        if action.metadata.get("sanctions_hit") is True:
            return _decision(
                decision="DENY",
                legacy_reason="sanctions_hit",
                reason_code="BLOCK_SANCTIONS_HIT",
                reason_text="Sanctions screening produced a hard block.",
                risk_level="critical",
                triggered_rules=("sanctions_hard_block",),
            )
        return None

    def check_critical_risk_rule(self, action: ActionRequest) -> PolicyDecision | None:
        if action.metadata.get("risk_level") == "critical":
            return _decision(
                decision="DENY",
                legacy_reason="critical_risk",
                reason_code="BLOCK_CRITICAL_RISK",
                reason_text="Critical risk actions are blocked.",
                risk_level="critical",
                triggered_rules=("critical_risk",),
            )
        return None

    def check_aml_score_rule(self, action: ActionRequest) -> PolicyDecision | None:
        aml_score = _number(action.metadata.get("aml_score"))
        if aml_score is not None and aml_score >= AML_REVIEW_THRESHOLD:
            return _decision(
                decision="REVIEW",
                legacy_reason="aml_score_high",
                reason_code="REVIEW_AML_SCORE_HIGH",
                reason_text="AML score requires human review.",
                requires_human=True,
                risk_level="high",
                triggered_rules=("aml_score_high",),
            )
        return None

    def check_amount_threshold_rule(self, action: ActionRequest) -> PolicyDecision | None:
        amount = _number(action.payload.get("amount"))
        if amount is not None and amount > AMOUNT_REVIEW_THRESHOLD:
            return _decision(
                decision="REVIEW",
                legacy_reason="amount_threshold_exceeded",
                reason_code="REVIEW_AMOUNT_ABOVE_THRESHOLD",
                reason_text="Payment amount is above the review threshold.",
                requires_human=True,
                risk_level="medium",
                triggered_rules=("amount_above_threshold",),
            )
        return None

    def evaluate(self, action: ActionRequest, receipt: ADRReceipt) -> PolicyDecision:
        timestamp_result = self.check_timestamp_policy(action)
        if timestamp_result is not None:
            return timestamp_result

        unauthorized_actor_result = self.check_unauthorized_actor_rule(action)
        if unauthorized_actor_result is not None:
            return unauthorized_actor_result

        sanctions_result = self.check_sanctions_rule(action)
        if sanctions_result is not None:
            return sanctions_result

        critical_risk_result = self.check_critical_risk_rule(action)
        if critical_risk_result is not None:
            return critical_risk_result

        external_transfer_result = self.check_external_transfer_rule(action)
        if external_transfer_result is not None:
            return external_transfer_result

        replay_result = self.check_replay_policy(action, receipt)
        if replay_result is not None:
            return replay_result

        high_risk_result = self.check_high_risk_rule(action)
        if high_risk_result is not None:
            return high_risk_result

        aml_score_result = self.check_aml_score_rule(action)
        if aml_score_result is not None:
            return aml_score_result

        amount_threshold_result = self.check_amount_threshold_rule(action)
        if amount_threshold_result is not None:
            return amount_threshold_result

        return _decision(
            decision="ALLOW",
            legacy_reason="ok",
            reason_code="ALLOW_LOW_RISK_VERIFIED",
            reason_text="Low risk verified action is allowed.",
            risk_level=_risk_level(action),
        )

    def record_seen(self, action: ActionRequest, receipt: ADRReceipt) -> None:
        self._replay_store.remember(action.action_id, receipt.hash)


def _decision(
    *,
    decision: Literal["ALLOW", "DENY", "REVIEW"],
    legacy_reason: str,
    reason_code: str,
    reason_text: str,
    risk_level: RiskLevel,
    triggered_rules: tuple[str, ...] = (),
    requires_human: bool = False,
) -> PolicyDecision:
    return PolicyDecision.from_legacy(
        decision=decision,
        reason=legacy_reason,
        reason_code=reason_code,
        reason_text=reason_text,
        policy_id=POLICY_ID,
        policy_version=POLICY_VERSION,
        requires_human=requires_human,
        overrideable=False,
        risk_level=risk_level,
        triggered_rules=triggered_rules,
    )


def _number(value: object) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    return None


def _risk_level(action: ActionRequest) -> RiskLevel:
    raw = action.metadata.get("risk_level") or action.metadata.get("risk") or "low"
    if raw in {"low", "medium", "high", "critical"}:
        return raw
    return "low"

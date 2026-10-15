from __future__ import annotations

from typing import Any

from app.action_control.models import (
    ActionControlDecision,
    ActionControlDecisionTrace,
    ActionControlGatewayStatus,
    ActionControlIntent,
    ActionControlResponse,
    ActionControlVerifySummary,
)
from app.gateway.action_gateway import ActionGateway, build_default_gateway
from app.models.action_request import ActionRequest
from app.verify.presenter import present
from app.verify.service import VerifyService


PRODUCT_NAME = "FortiX Action Control"
CONTROL_VERSION = "action-control-v1"
FLOW_NAME = "Intent -> Policy -> Gateway -> ADR -> Verify"

_RISK_SCORE_BY_LEVEL = {
    "low": 0.0,
    "medium": 0.5,
    "high": 0.8,
    "critical": 1.0,
}


class ActionControlService:
    """Thin orchestration over ActionGateway and VerifyService."""

    def __init__(
        self,
        *,
        gateway: ActionGateway | None = None,
        verify_service: VerifyService | None = None,
        public_key_hex: str | None = None,
    ) -> None:
        self._gateway = gateway or build_default_gateway()
        self._verify_service = verify_service or VerifyService()
        self._public_key_hex = public_key_hex

    def submit_intent(self, intent: ActionControlIntent) -> ActionControlResponse:
        action = _to_action_request(intent)
        gateway_response = self._gateway.submit_action(action)
        policy = _dict_value(gateway_response.get("policy"))
        receipt = _dict_value(gateway_response.get("adr_receipt"))

        public_key_hex = (
            self._gateway.signing_public_key_hex()
            if self._public_key_hex is None
            else self._public_key_hex
        )
        verification = self._verify_service.verify(
            receipt=receipt,
            public_key_hex=public_key_hex,
        )
        verification_view = present(verification)

        return ActionControlResponse(
            product=PRODUCT_NAME,
            control_version=CONTROL_VERSION,
            flow=FLOW_NAME,
            decision=_decision_from_policy(policy),
            reason=_reason_from_policy(policy),
            gateway_status=_gateway_status(gateway_response),
            decision_trace=_decision_trace(policy),
            receipt=receipt,
            verify=ActionControlVerifySummary(
                verdict=verification.status,
                reason_code=verification.code.value,
                explanation=verification_view.institutional.explanation,
            ),
        )



def _to_action_request(intent: ActionControlIntent) -> ActionRequest:
    payload = dict(intent.payload)
    _copy_if_present(payload, "amount", intent.amount)
    _copy_if_present(payload, "currency", intent.currency)
    _copy_if_present(payload, "destination", intent.destination)

    metadata = dict(intent.metadata)
    extra = intent.model_extra or {}
    for key, value in extra.items():
        if key not in payload:
            payload[key] = value

    return ActionRequest(
        action_id=intent.action_id,
        actor_id=intent.actor,
        action=intent.action,
        target=intent.target or intent.destination or intent.action,
        timestamp=intent.timestamp,
        payload=payload,
        metadata=metadata,
    )


def _copy_if_present(target: dict[str, Any], key: str, value: Any) -> None:
    if value is not None and key not in target:
        target[key] = value


def _dict_value(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _decision_from_policy(policy: dict[str, Any]) -> ActionControlDecision:
    status = policy.get("status")
    if status in {"allow", "require_review", "block"}:
        return status

    decision = policy.get("decision")
    if decision == "ALLOW":
        return "allow"
    if decision == "REVIEW":
        return "require_review"
    return "block"


def _reason_from_policy(policy: dict[str, Any]) -> str:
    reason = policy.get("reason_text") or policy.get("reason") or policy.get("reason_code")
    return str(reason or "No policy reason was returned.")


def _gateway_status(
    gateway_response: dict[str, Any],
) -> ActionControlGatewayStatus:
    status = gateway_response.get("status")
    if status in {
        "executed",
        "pending_review",
        "blocked_by_policy",
        "blocked_by_replay_protection",
        "blocked_by_idempotency_guard",
    }:
        return status
    return "blocked_by_policy"


def _decision_trace(policy: dict[str, Any]) -> ActionControlDecisionTrace:
    triggered = policy.get("triggered_rules")
    if not isinstance(triggered, list):
        triggered = list(triggered) if isinstance(triggered, tuple) else []

    return ActionControlDecisionTrace(
        policy_id=str(policy.get("policy_id") or ""),
        rules_triggered=[str(rule) for rule in triggered],
        risk_score=_risk_score(policy.get("risk_level")),
    )


def _risk_score(risk_level: Any) -> float:
    if isinstance(risk_level, str):
        return _RISK_SCORE_BY_LEVEL.get(risk_level.strip().lower(), 0.0)
    return 0.0

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from app.core.canonicalizer import canonicalize
from app.core.hasher import hash_bytes
from app.core.signer import sign_hash
from app.core.signing_config import (
    SigningConfiguration,
    SigningConfigurationError,
    load_signing_configuration,
)
from app.core.utils import utc_now_iso
from app.gateway.audit import write_audit_entry
from app.gateway.models import GatewayAuditEntry, GatewayStatus, IdempotencyOutcome
from app.gateway.status import compute_gateway_status
from app.models.action_request import ActionRequest
from app.models.adr_receipt import ADRAlgorithm, ADRReceipt
from app.policy.engine import InMemoryReplayStateStore, PolicyEngine, PolicyResult



def compute_status(decision: str, reason: str, executed: bool) -> str:
    _ = executed
    return compute_gateway_status(decision, reason).value


def _derive_idempotency_outcome(policy_result: Any | None) -> IdempotencyOutcome:
    if policy_result is None:
        return IdempotencyOutcome.FIRST_SEEN

    reason = getattr(policy_result, "reason", "")
    if reason == "replay_detected":
        return IdempotencyOutcome.REPLAY
    if reason == "duplicate_action_id":
        return IdempotencyOutcome.DUPLICATE
    return IdempotencyOutcome.FIRST_SEEN


class ActionGateway:
    def __init__(
        self,
        private_key_hex: str | None,
        key_id: str | None,
        policy_engine: PolicyEngine | None = None,
        *,
        signing_configuration_loader: Callable[[], SigningConfiguration] | None = None,
    ) -> None:
        if signing_configuration_loader is None:
            if private_key_hex is None or key_id is None:
                raise ValueError("Explicit signing material is incomplete")
            signing_configuration: SigningConfiguration | None = SigningConfiguration(
                private_key_hex=private_key_hex,
                key_id=key_id,
            )
        elif private_key_hex is not None or key_id is not None:
            raise ValueError(
                "Explicit signing material and a loader are mutually exclusive"
            )
        else:
            signing_configuration = None

        self._signing_configuration = signing_configuration
        self._signing_configuration_loader = signing_configuration_loader
        self._policy_engine = policy_engine or PolicyEngine()
        self._idempotency_fingerprints: dict[str, str] = {}

    def _resolve_signing_configuration(self) -> SigningConfiguration:
        configuration = self._signing_configuration
        if configuration is not None:
            return configuration

        loader = self._signing_configuration_loader
        if loader is None:
            raise SigningConfigurationError("gateway_unconfigured")
        configuration = loader()
        self._signing_configuration = configuration
        return configuration

    def signing_public_key_hex(self) -> str:
        return self._resolve_signing_configuration().public_key_hex

    def submit_action(self, action: ActionRequest) -> dict[str, Any]:
        return self._process(action, mode="submit")

    def review_action(self, action: ActionRequest) -> dict[str, Any]:
        return self._process(action, mode="review")

    def _process(self, action: ActionRequest, mode: str) -> dict[str, Any]:
        # ADR is generated before execution by design.
        receipt = self._generate_adr_receipt(action)
        idempotency_result = self._idempotency_guard_result(action)
        idempotency_outcome = _derive_idempotency_outcome(idempotency_result)
        policy_result = idempotency_result
        if policy_result is None:
            policy_result = self._policy_engine.evaluate(action, receipt)

        response: dict[str, Any] = {
            "mode": mode,
            "gateway": "action_gateway",
            "policy": _policy_response(policy_result),
            "adr_receipt": receipt.model_dump(),
        }

        try:
            if policy_result.decision == "DENY":
                execution_result = {
                    "executed": False,
                }
            elif policy_result.decision == "REVIEW":
                execution_result = self._queue_for_review(action)
                self._policy_engine.record_seen(action, receipt)
            else:
                execution_result = self._execute_action(action)
                self._policy_engine.record_seen(action, receipt)

            status = compute_status(
                decision=policy_result.decision,
                reason=policy_result.reason,
                executed=bool(execution_result["executed"]),
            )
            response["status"] = status
            response.update(execution_result)
            self._append_decision_log(
                action_id=action.action_id,
                actor_id=action.actor_id,
                mode=mode,
                receipt_hash=receipt.hash,
                policy_result=policy_result,
                status=response["status"],
                executed=bool(response["executed"]),
                idempotency_outcome=idempotency_outcome,
            )
            return response
        except Exception:
            self._append_decision_log(
                action_id=action.action_id,
                actor_id=action.actor_id,
                mode="fail_closed",
                receipt_hash=receipt.hash,
                policy_result=PolicyResult(decision="DENY", reason="fail_closed_exception"),
                status=GatewayStatus.BLOCKED_BY_POLICY.value,
                executed=False,
                idempotency_outcome=idempotency_outcome,
            )
            raise

    def _idempotency_guard_result(self, action: ActionRequest) -> PolicyResult | None:
        fingerprint = self._business_fingerprint(action)
        existing = self._idempotency_fingerprints.get(action.action_id)
        if existing is None:
            self._idempotency_fingerprints[action.action_id] = fingerprint
            return None
        if existing == fingerprint:
            return PolicyResult(decision="DENY", reason="replay_detected")
        return PolicyResult(decision="DENY", reason="duplicate_action_id")

    def _business_fingerprint(self, action: ActionRequest) -> str:
        business_payload = {
            "actor_id": action.actor_id,
            "action": action.action,
            "target": action.target,
            "payload": action.payload,
            "metadata": action.metadata,
        }
        return hash_bytes(canonicalize(business_payload))

    def _execute_action(self, action: ActionRequest) -> dict[str, Any]:
        return {
            "executed": True,
            "execution": {
                "action_id": action.action_id,
                "result": "completed",
            },
        }

    def _queue_for_review(self, action: ActionRequest) -> dict[str, Any]:
        return {
            "executed": False,
            "execution": {
                "action_id": action.action_id,
                "result": "pending_manual_review",
            },
        }

    def _append_decision_log(
        self,
        action_id: str,
        actor_id: str,
        mode: str,
        receipt_hash: str,
        policy_result: PolicyResult,
        status: str,
        executed: bool,
        idempotency_outcome: IdempotencyOutcome,
    ) -> None:
        write_audit_entry(
            GatewayAuditEntry(
                ts=utc_now_iso(),
                action_id=action_id,
                actor_id=actor_id,
                mode=mode,
                adr_hash=receipt_hash,
                policy_decision=policy_result.decision,
                policy_reason=policy_result.reason,
                status=GatewayStatus(status),
                executed=executed,
                idempotency_outcome=idempotency_outcome,
            )
        )

    def _generate_adr_receipt(self, action: ActionRequest) -> ADRReceipt:
        payload = {
            "action_id": action.action_id,
            "actor_id": action.actor_id,
            "action": action.action,
            "target": action.target,
            "timestamp": action.timestamp,
            "payload": action.payload,
            "metadata": action.metadata,
        }

        canonical = canonicalize(payload)
        receipt_hash = hash_bytes(canonical)
        configuration = self._resolve_signing_configuration()
        signature = sign_hash(receipt_hash, configuration.private_key_hex)

        return ADRReceipt(
            version="1.0",
            payload=payload,
            hash=receipt_hash,
            signature=signature,
            algorithm=ADRAlgorithm(hash="BLAKE3", signature="Ed25519"),
            key_id=configuration.key_id,
        )


def build_default_gateway() -> ActionGateway:
    policy_engine = PolicyEngine(replay_store=InMemoryReplayStateStore())
    return ActionGateway(
        private_key_hex=None,
        key_id=None,
        policy_engine=policy_engine,
        signing_configuration_loader=load_signing_configuration,
    )


def _policy_response(policy_result: Any) -> dict[str, Any]:
    if hasattr(policy_result, "to_response_dict"):
        return policy_result.to_response_dict()
    return {
        "decision": policy_result.decision,
        "reason": policy_result.reason,
    }

from app.gateway.action_gateway import ActionGateway
from app.models.action_request import ActionRequest
from app.policy.engine import PolicyEngine


def _build_gateway() -> ActionGateway:
    return ActionGateway(
        private_key_hex="11" * 32,
        key_id="test-key-001",
        policy_engine=PolicyEngine(),
    )


def test_identical_second_request_is_replay_detected() -> None:
    gateway = _build_gateway()
    request = ActionRequest(
        action_id="idem-001",
        actor_id="actor-001",
        action="view",
        target="internal",
        timestamp="2026-03-20T10:00:00Z",
        payload={"resource": "wallet"},
        metadata={"risk": "low"},
    )

    first = gateway.submit_action(request)
    second = gateway.submit_action(request)

    assert first["policy"]["decision"] == "ALLOW"
    assert second["policy"]["decision"] == "DENY"
    assert second["policy"]["reason"] == "replay_detected"
    assert second["status"] == "blocked_by_replay_protection"
    assert second["executed"] is False
    assert "adr_receipt" in second
    assert second["adr_receipt"]["hash"] == first["adr_receipt"]["hash"]


def test_same_action_id_with_changed_payload_is_duplicate_action_id() -> None:
    gateway = _build_gateway()
    first_request = ActionRequest(
        action_id="idem-002",
        actor_id="actor-001",
        action="view",
        target="internal",
        timestamp="2026-03-20T10:01:00Z",
        payload={"amount": 100},
        metadata={"risk": "low"},
    )
    second_request = ActionRequest(
        action_id="idem-002",
        actor_id="actor-001",
        action="view",
        target="internal",
        timestamp="2026-03-20T10:02:00Z",
        payload={"amount": 200},
        metadata={"risk": "low"},
    )

    first = gateway.submit_action(first_request)
    second = gateway.submit_action(second_request)

    assert first["policy"]["decision"] == "ALLOW"
    assert second["policy"]["decision"] == "DENY"
    assert second["policy"]["reason"] == "duplicate_action_id"
    assert second["status"] == "blocked_by_idempotency_guard"
    assert second["executed"] is False
    assert "adr_receipt" in second
    assert second["adr_receipt"]["hash"] != first["adr_receipt"]["hash"]

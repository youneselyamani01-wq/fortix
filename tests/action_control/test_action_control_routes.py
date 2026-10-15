from __future__ import annotations

from uuid import uuid4


def _intent(**overrides) -> dict:
    base = {
        "action": "payment.submit",
        "actor": "claude_worker",
        "amount": 50000,
        "currency": "EUR",
        "destination": "AE",
        "timestamp": "2024-01-15T10:00:00+00:00",
        "action_id": f"actctl-{uuid4()}",
    }
    base.update(overrides)
    return base


def _assert_common_response(data: dict) -> None:
    assert data["product"] == "FortiX Action Control"
    assert data["control_version"] == "action-control-v1"
    assert data["flow"] == "Intent -> Policy -> Gateway -> ADR -> Verify"
    assert "decision_trace" in data
    assert data["decision_trace"]["policy_id"] != ""
    assert isinstance(data["decision_trace"]["rules_triggered"], list)
    assert isinstance(data["decision_trace"]["risk_score"], float)
    assert data["receipt"]["version"] == "1.0"
    assert data["verify"]["verdict"] == "VALID"
    assert data["verify"]["reason_code"] == "valid"
    assert data["verify"]["explanation"] != ""


def test_payment_below_threshold_allows_and_executes(client) -> None:
    resp = client.post("/action-control/intent", json=_intent(amount=50000))
    assert resp.status_code == 200
    data = resp.json()

    _assert_common_response(data)
    assert data["decision"] == "allow"
    assert data["gateway_status"] == "executed"
    assert data["receipt"]["payload"]["payload"]["amount"] == 50000


def test_payment_high_amount_requires_review_and_receipt_verifies(client) -> None:
    resp = client.post("/action-control/intent", json=_intent(amount=250000))
    assert resp.status_code == 200
    data = resp.json()

    _assert_common_response(data)
    assert data["decision"] == "require_review"
    assert data["gateway_status"] == "pending_review"
    assert "amount_above_threshold" in data["decision_trace"]["rules_triggered"]


def test_policy_blocked_action_returns_blocked_by_policy(client) -> None:
    resp = client.post(
        "/action-control/intent",
        json=_intent(metadata={"sanctions_hit": True}),
    )
    assert resp.status_code == 200
    data = resp.json()

    _assert_common_response(data)
    assert data["decision"] == "block"
    assert data["gateway_status"] == "blocked_by_policy"
    assert "sanctions_hard_block" in data["decision_trace"]["rules_triggered"]


def test_malformed_timestamp_fails_closed_at_request_boundary(client) -> None:
    resp = client.post(
        "/action-control/intent",
        json=_intent(timestamp="04/24/2026 10:30:00"),
    )
    assert resp.status_code == 422


def test_missing_timestamp_fails_closed_at_request_boundary(client) -> None:
    body = _intent()
    del body["timestamp"]
    resp = client.post("/action-control/intent", json=body)
    assert resp.status_code == 422


def test_action_id_idempotency_behavior_is_preserved(client) -> None:
    body = _intent(action_id=f"actctl-idem-{uuid4()}")

    first = client.post("/action-control/intent", json=body)
    second = client.post("/action-control/intent", json=body)

    assert first.status_code == 200
    assert second.status_code == 200
    first_data = first.json()
    second_data = second.json()

    assert first_data["decision"] == "allow"
    assert first_data["gateway_status"] == "executed"
    assert second_data["decision"] == "block"
    assert second_data["gateway_status"] == "blocked_by_replay_protection"
    assert second_data["receipt"]["hash"] == first_data["receipt"]["hash"]
    assert second_data["verify"]["verdict"] == "VALID"

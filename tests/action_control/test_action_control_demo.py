from __future__ import annotations


def test_action_control_demo_returns_response_shape(client) -> None:
    resp = client.post("/action-control/demo")
    assert resp.status_code == 200

    data = resp.json()
    assert data["control_version"] == "action-control-v1"
    assert data["decision"] in {"allow", "require_review", "block"}
    assert "receipt" in data
    assert data["verify"]["verdict"] in {"VALID", "INVALID", "UNVERIFIABLE"}


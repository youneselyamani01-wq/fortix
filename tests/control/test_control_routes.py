"""
Tests for /control/evaluate and /control/explain endpoints.

Coverage:
  - 200 on valid request with correct schema
  - ALLOW verdict on a clean request
  - DENY verdict on external-transfer-without-approval
  - REVIEW verdict on high-risk action
  - /explain returns all rule traces
  - Response is fully JSON-serialisable (enum values, not enum names)
  - 422 on missing required field (FastAPI validation)
  - Existing ADR routes are unaffected (no regression)
"""
from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.control.models import VerdictCode


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def _action_body(**overrides) -> dict:
    base = {
        "action_id": str(uuid.uuid4()),
        "actor_id": "actor-test",
        "action": "read",
        "target": "internal",
        "timestamp": "2024-01-15T10:00:00+00:00",
        "payload": {},
        "metadata": {},
    }
    base.update(overrides)
    return base


# ---------------------------------------------------------------------------
# /control/evaluate
# ---------------------------------------------------------------------------

class TestControlEvaluate:
    def test_clean_request_returns_200(self, client):
        resp = client.post("/control/evaluate", json=_action_body())
        assert resp.status_code == 200

    def test_clean_request_allows(self, client):
        resp = client.post("/control/evaluate", json=_action_body())
        body = resp.json()
        assert body["verdict"]["verdict"] == "ALLOW"
        assert body["verdict"]["code"] == VerdictCode.OK.value

    def test_external_transfer_denied(self, client):
        body = _action_body(action="transfer", target="external", metadata={})
        resp = client.post("/control/evaluate", json=body)
        assert resp.status_code == 200
        data = resp.json()
        assert data["verdict"]["verdict"] == "DENY"
        assert data["verdict"]["code"] == VerdictCode.EXTERNAL_TRANSFER_BLOCKED.value

    def test_external_transfer_approved_allows(self, client):
        body = _action_body(
            action="transfer",
            target="external",
            metadata={"review_approved": True},
        )
        resp = client.post("/control/evaluate", json=body)
        assert resp.status_code == 200
        data = resp.json()
        assert data["verdict"]["verdict"] == "ALLOW"

    def test_high_risk_escalates(self, client):
        body = _action_body(metadata={"risk": "high"})
        resp = client.post("/control/evaluate", json=body)
        assert resp.status_code == 200
        data = resp.json()
        assert data["verdict"]["verdict"] == "REVIEW"
        assert data["verdict"]["code"] == VerdictCode.HIGH_RISK_ESCALATION.value

    def test_response_has_trace(self, client):
        resp = client.post("/control/evaluate", json=_action_body())
        data = resp.json()
        trace = data["trace"]
        assert "trace_id" in trace
        assert "action_id" in trace
        assert "actor_id" in trace
        assert "evaluated_at" in trace
        assert "policy_version" in trace
        assert "rules_evaluated" in trace

    def test_trace_action_id_matches_request(self, client):
        body = _action_body()
        resp = client.post("/control/evaluate", json=body)
        data = resp.json()
        assert data["trace"]["action_id"] == body["action_id"]

    def test_verdict_message_present(self, client):
        resp = client.post("/control/evaluate", json=_action_body())
        data = resp.json()
        assert data["verdict"]["message"] != ""

    def test_missing_required_field_returns_422(self, client):
        """actor_id is required — omitting it must yield 422 Unprocessable Entity."""
        body = _action_body()
        del body["actor_id"]
        resp = client.post("/control/evaluate", json=body)
        assert resp.status_code == 422

    def test_missing_action_id_returns_422(self, client):
        body = _action_body()
        del body["action_id"]
        resp = client.post("/control/evaluate", json=body)
        assert resp.status_code == 422


# ---------------------------------------------------------------------------
# /control/explain
# ---------------------------------------------------------------------------

class TestControlExplain:
    def test_explain_returns_200(self, client):
        resp = client.post("/control/explain", json=_action_body())
        assert resp.status_code == 200

    def test_explain_clean_request_allows(self, client):
        resp = client.post("/control/explain", json=_action_body())
        data = resp.json()
        assert data["verdict"]["verdict"] == "ALLOW"

    def test_explain_returns_all_rule_traces(self, client):
        from app.control.policy import CONTROL_RULES
        resp = client.post("/control/explain", json=_action_body())
        data = resp.json()
        assert len(data["trace"]["rules_evaluated"]) == len(CONTROL_RULES)

    def test_explain_deny_still_has_all_rules(self, client):
        from app.control.policy import CONTROL_RULES
        # Use whitespace-only timestamp: passes schema (min_length=1) but fails policy
        body = _action_body(timestamp="   ")
        resp = client.post("/control/explain", json=body)
        data = resp.json()
        assert data["verdict"]["verdict"] == "DENY"
        assert len(data["trace"]["rules_evaluated"]) == len(CONTROL_RULES)

    def test_explain_same_verdict_as_evaluate(self, client):
        body = _action_body(metadata={"risk": "high"})
        eval_resp = client.post("/control/evaluate", json=body)
        expl_resp = client.post("/control/explain", json=body)
        eval_data = eval_resp.json()
        expl_data = expl_resp.json()
        assert eval_data["verdict"]["verdict"] == expl_data["verdict"]["verdict"]
        assert eval_data["verdict"]["code"] == expl_data["verdict"]["code"]

    def test_explain_unmatched_rules_not_matched(self, client):
        """When first rule matches, remaining rules must be unmatched in explain mode."""
        body = _action_body(timestamp="   ")
        resp = client.post("/control/explain", json=body)
        data = resp.json()
        rules = data["trace"]["rules_evaluated"]
        assert rules[0]["matched"] is True
        for r in rules[1:]:
            assert r["matched"] is False


# ---------------------------------------------------------------------------
# Regression: existing ADR routes still work
# ---------------------------------------------------------------------------

class TestADRRegression:
    def test_adr_verify_route_exists(self, client):
        """POST /adr/verify must still respond (not 404)."""
        payload = {
            "receipt": {
                "version": "1.0",
                "payload": {"foo": "bar"},
                "hash": "a" * 64,
                "signature": "b" * 128,
                "algorithm": {"hash": "BLAKE3", "signature": "Ed25519"},
                "key_id": "demo-key-001",
            },
            "public_key_hex": "c" * 64,
        }
        resp = client.post("/adr/verify", json=payload)
        # Route exists; we expect 200 (valid=false) or 422, not 404
        assert resp.status_code in (200, 422)

    def test_action_submit_route_exists(self, client):
        """POST /action/submit must still respond."""
        body = _action_body()
        resp = client.post("/action/submit", json=body)
        assert resp.status_code in (200, 422, 500)

    def test_control_routes_do_not_collide_with_action_routes(self, client):
        """Control prefix (/control/*) must not shadow existing /action/* routes."""
        # Both routes should each return their own responses
        action_resp = client.post("/action/submit", json=_action_body())
        control_resp = client.post("/control/evaluate", json=_action_body())
        assert action_resp.status_code != 404
        assert control_resp.status_code == 200

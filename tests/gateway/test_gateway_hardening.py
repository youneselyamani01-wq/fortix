"""
Integration tests for the hardened ActionGateway.

Coverage:
  - Response shape is unchanged (no regression)
  - status field value matches GatewayStatus enum values
  - Structured audit entry is written for every processing cycle
  - Audit entry actor_id is captured (new field)
  - Audit entry idempotency_outcome is correct on each path
  - Idempotency: replay → BLOCKED_BY_REPLAY, duplicate → BLOCKED_BY_IDEMPOTENCY
  - High-risk → PENDING_REVIEW, status in response = "pending_review"
  - External transfer → BLOCKED_BY_POLICY, executed=False
  - Fail-closed: exception during processing writes audit, re-raises
  - Audit entry is serialisable after each gateway call
"""
from __future__ import annotations

import json
import pytest

from app.gateway.action_gateway import ActionGateway, _derive_idempotency_outcome
from app.gateway.audit import read_audit_entries_for_action
from app.gateway.models import GatewayStatus, IdempotencyOutcome
from app.models.action_request import ActionRequest
from app.policy.engine import PolicyEngine


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def _patch_audit_path(tmp_path, monkeypatch):
    import app.gateway.audit as audit_module
    monkeypatch.setattr(audit_module, "AUDIT_LOG_PATH", tmp_path / "gateway_audit.log")


def _build_gateway() -> ActionGateway:
    return ActionGateway(
        private_key_hex="22" * 32,
        key_id="hardening-test-key",
        policy_engine=PolicyEngine(),
    )


def _action(**overrides) -> ActionRequest:
    base = {
        "action_id": "harden-001",
        "actor_id": "actor-harden",
        "action": "read",
        "target": "internal",
        "timestamp": "2024-06-01T09:00:00+00:00",
        "payload": {},
        "metadata": {},
    }
    base.update(overrides)
    return ActionRequest(**base)


# ---------------------------------------------------------------------------
# Response shape (no regression)
# ---------------------------------------------------------------------------

class TestResponseShape:
    def test_allow_response_has_required_keys(self):
        gw = _build_gateway()
        resp = gw.submit_action(_action())
        for key in ("mode", "gateway", "policy", "adr_receipt", "status", "executed"):
            assert key in resp

    def test_allow_status_string_value(self):
        gw = _build_gateway()
        resp = gw.submit_action(_action())
        assert resp["status"] == GatewayStatus.EXECUTED.value
        assert resp["status"] == "executed"

    def test_review_status_string_value(self):
        gw = _build_gateway()
        resp = gw.submit_action(_action(metadata={"risk": "high"}))
        assert resp["status"] == GatewayStatus.PENDING_REVIEW.value

    def test_deny_external_transfer_status(self):
        gw = _build_gateway()
        resp = gw.submit_action(_action(action="transfer", target="external"))
        assert resp["status"] == GatewayStatus.BLOCKED_BY_POLICY.value

    def test_replay_status_string_value(self):
        gw = _build_gateway()
        gw.submit_action(_action())
        resp = gw.submit_action(_action())
        assert resp["status"] == GatewayStatus.BLOCKED_BY_REPLAY.value

    def test_duplicate_status_string_value(self):
        gw = _build_gateway()
        gw.submit_action(_action(action_id="idem-dup"))
        resp = gw.submit_action(_action(action_id="idem-dup", payload={"x": 1}))
        assert resp["status"] == GatewayStatus.BLOCKED_BY_IDEMPOTENCY.value

    def test_adr_receipt_present_on_deny(self):
        gw = _build_gateway()
        resp = gw.submit_action(_action(action="transfer", target="external"))
        assert "adr_receipt" in resp
        assert resp["adr_receipt"]["version"] == "1.0"

    def test_policy_decision_and_reason_present(self):
        gw = _build_gateway()
        resp = gw.submit_action(_action())
        assert resp["policy"]["decision"] == "ALLOW"
        assert resp["policy"]["reason"] == "ok"


# ---------------------------------------------------------------------------
# Audit entry written on every cycle
# ---------------------------------------------------------------------------

class TestAuditEntryWritten:
    def test_audit_entry_written_for_allow(self):
        gw = _build_gateway()
        gw.submit_action(_action(action_id="audit-allow"))
        entries = read_audit_entries_for_action("audit-allow")
        assert len(entries) == 1

    def test_audit_entry_written_for_deny(self):
        gw = _build_gateway()
        gw.submit_action(_action(action_id="audit-deny", action="transfer", target="external"))
        entries = read_audit_entries_for_action("audit-deny")
        assert len(entries) == 1
        assert entries[0].status == GatewayStatus.BLOCKED_BY_POLICY

    def test_audit_entry_written_for_review(self):
        gw = _build_gateway()
        gw.submit_action(_action(action_id="audit-review", metadata={"risk": "high"}))
        entries = read_audit_entries_for_action("audit-review")
        assert len(entries) == 1
        assert entries[0].status == GatewayStatus.PENDING_REVIEW

    def test_audit_entry_actor_id_captured(self):
        gw = _build_gateway()
        gw.submit_action(_action(action_id="audit-actor", actor_id="actor-xyz"))
        entries = read_audit_entries_for_action("audit-actor")
        assert entries[0].actor_id == "actor-xyz"

    def test_audit_entry_executed_true_on_allow(self):
        gw = _build_gateway()
        gw.submit_action(_action(action_id="audit-exec"))
        entries = read_audit_entries_for_action("audit-exec")
        assert entries[0].executed is True

    def test_audit_entry_executed_false_on_deny(self):
        gw = _build_gateway()
        gw.submit_action(_action(action_id="audit-noexec", action="transfer", target="external"))
        entries = read_audit_entries_for_action("audit-noexec")
        assert entries[0].executed is False

    def test_audit_entry_adr_hash_matches_response(self):
        gw = _build_gateway()
        resp = gw.submit_action(_action(action_id="audit-hash"))
        entries = read_audit_entries_for_action("audit-hash")
        assert entries[0].adr_hash == resp["adr_receipt"]["hash"]

    def test_audit_entry_is_json_serialisable(self):
        gw = _build_gateway()
        gw.submit_action(_action(action_id="audit-serial"))
        entries = read_audit_entries_for_action("audit-serial")
        json.dumps(entries[0].to_audit_dict())  # must not raise


# ---------------------------------------------------------------------------
# Idempotency outcome in audit
# ---------------------------------------------------------------------------

class TestIdempotencyOutcomeInAudit:
    def test_first_call_idempotency_outcome_first_seen(self):
        gw = _build_gateway()
        gw.submit_action(_action(action_id="idem-fs"))
        entries = read_audit_entries_for_action("idem-fs")
        assert entries[0].idempotency_outcome == IdempotencyOutcome.FIRST_SEEN

    def test_replay_idempotency_outcome_is_replay(self):
        gw = _build_gateway()
        gw.submit_action(_action(action_id="idem-rp"))
        gw.submit_action(_action(action_id="idem-rp"))
        entries = read_audit_entries_for_action("idem-rp")
        assert entries[1].idempotency_outcome == IdempotencyOutcome.REPLAY

    def test_duplicate_idempotency_outcome_is_duplicate(self):
        gw = _build_gateway()
        gw.submit_action(_action(action_id="idem-dp"))
        gw.submit_action(_action(action_id="idem-dp", payload={"mutated": True}))
        entries = read_audit_entries_for_action("idem-dp")
        assert entries[1].idempotency_outcome == IdempotencyOutcome.DUPLICATE

    def test_replay_audit_status_matches_response_status(self):
        gw = _build_gateway()
        gw.submit_action(_action(action_id="idem-match"))
        resp = gw.submit_action(_action(action_id="idem-match"))
        entries = read_audit_entries_for_action("idem-match")
        assert entries[1].status.value == resp["status"]


# ---------------------------------------------------------------------------
# Fail-closed behavior
# ---------------------------------------------------------------------------

class TestFailClosed:
    def test_exception_in_execute_writes_fail_closed_audit(self, monkeypatch):
        """Patch _execute_action to raise; audit entry must still be written."""
        gw = _build_gateway()

        def boom(action):
            raise RuntimeError("simulated execution failure")

        monkeypatch.setattr(gw, "_execute_action", boom)

        with pytest.raises(RuntimeError, match="simulated execution failure"):
            gw.submit_action(_action(action_id="fail-close-1"))

        entries = read_audit_entries_for_action("fail-close-1")
        assert len(entries) == 1
        assert entries[0].mode == "fail_closed"
        assert entries[0].executed is False
        assert entries[0].status == GatewayStatus.BLOCKED_BY_POLICY

    def test_fail_closed_audit_entry_is_serialisable(self, monkeypatch):
        gw = _build_gateway()
        monkeypatch.setattr(gw, "_execute_action", lambda a: (_ for _ in ()).throw(RuntimeError()))

        with pytest.raises(RuntimeError):
            gw.submit_action(_action(action_id="fail-close-2"))

        entries = read_audit_entries_for_action("fail-close-2")
        json.dumps(entries[0].to_audit_dict())  # must not raise

    def test_exception_does_not_silently_execute(self, monkeypatch):
        """The response must not be returned when _execute_action raises."""
        gw = _build_gateway()
        monkeypatch.setattr(gw, "_execute_action", lambda a: (_ for _ in ()).throw(RuntimeError()))

        with pytest.raises(RuntimeError):
            gw.submit_action(_action(action_id="fail-close-3"))

        # If we reach here, no response was returned — correct fail-closed behavior.
        entries = read_audit_entries_for_action("fail-close-3")
        assert entries[0].executed is False


# ---------------------------------------------------------------------------
# Review mode (no regression)
# ---------------------------------------------------------------------------

class TestReviewMode:
    def test_review_action_status(self):
        gw = _build_gateway()
        resp = gw.review_action(_action(action_id="rev-mode-1"))
        assert resp["mode"] == "review"
        assert resp["status"] in [s.value for s in GatewayStatus]

    def test_review_mode_audit_entry(self):
        gw = _build_gateway()
        gw.review_action(_action(action_id="rev-audit-1"))
        entries = read_audit_entries_for_action("rev-audit-1")
        assert len(entries) == 1
        assert entries[0].mode == "review"

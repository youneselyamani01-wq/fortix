"""
Tests for gateway models, status mapping, and idempotency outcome derivation.

Coverage:
  - GatewayStatus values match canonical status strings
  - compute_gateway_status maps all decision/reason pairs correctly
  - Unmapped inputs fall back to BLOCKED_BY_POLICY (fail-closed)
  - IdempotencyOutcome derivation from PolicyResult
  - GatewayAuditEntry construction and JSON serialisation
  - GatewayAuditEntry.to_audit_dict() is round-trippable
"""
from __future__ import annotations

import json

import pytest

from app.gateway.models import GatewayAuditEntry, GatewayStatus, IdempotencyOutcome
from app.gateway.status import compute_gateway_status
from app.gateway.action_gateway import _derive_idempotency_outcome
from app.models.policy_decision import PolicyDecision


# ---------------------------------------------------------------------------
# GatewayStatus — canonical string values
# ---------------------------------------------------------------------------

class TestGatewayStatusValues:
    """Status values must stay stable — they appear in HTTP responses and audit logs."""

    def test_executed_value(self):
        assert GatewayStatus.EXECUTED.value == "executed"

    def test_pending_review_value(self):
        assert GatewayStatus.PENDING_REVIEW.value == "pending_review"

    def test_blocked_by_replay_value(self):
        assert GatewayStatus.BLOCKED_BY_REPLAY.value == "blocked_by_replay_protection"

    def test_blocked_by_idempotency_value(self):
        assert GatewayStatus.BLOCKED_BY_IDEMPOTENCY.value == "blocked_by_idempotency_guard"

    def test_blocked_by_policy_value(self):
        assert GatewayStatus.BLOCKED_BY_POLICY.value == "blocked_by_policy"

    def test_all_five_statuses_exist(self):
        assert len(GatewayStatus) == 5


# ---------------------------------------------------------------------------
# compute_gateway_status — mapping correctness
# ---------------------------------------------------------------------------

class TestComputeGatewayStatus:
    def test_allow_any_reason_is_executed(self):
        assert compute_gateway_status("ALLOW", "ok") == GatewayStatus.EXECUTED

    def test_allow_with_blank_reason_is_executed(self):
        assert compute_gateway_status("ALLOW", "") == GatewayStatus.EXECUTED

    def test_review_any_reason_is_pending_review(self):
        assert compute_gateway_status("REVIEW", "high_risk_requires_review") == GatewayStatus.PENDING_REVIEW

    def test_deny_replay_is_blocked_by_replay(self):
        assert compute_gateway_status("DENY", "replay_detected") == GatewayStatus.BLOCKED_BY_REPLAY

    def test_deny_duplicate_is_blocked_by_idempotency(self):
        assert compute_gateway_status("DENY", "duplicate_action_id") == GatewayStatus.BLOCKED_BY_IDEMPOTENCY

    def test_deny_external_transfer_is_blocked_by_policy(self):
        assert (
            compute_gateway_status("DENY", "external_transfer_requires_review_approved")
            == GatewayStatus.BLOCKED_BY_POLICY
        )

    def test_deny_timestamp_missing_is_blocked_by_policy(self):
        assert compute_gateway_status("DENY", "timestamp_missing_or_blank") == GatewayStatus.BLOCKED_BY_POLICY

    def test_unknown_decision_is_blocked_by_policy(self):
        """Unknown decision must fall back to BLOCKED_BY_POLICY — fail-closed."""
        assert compute_gateway_status("UNKNOWN", "reason") == GatewayStatus.BLOCKED_BY_POLICY

    def test_deny_unknown_reason_is_blocked_by_policy(self):
        assert compute_gateway_status("DENY", "some_new_unknown_reason") == GatewayStatus.BLOCKED_BY_POLICY

    def test_empty_inputs_fail_closed(self):
        assert compute_gateway_status("", "") == GatewayStatus.BLOCKED_BY_POLICY

    def test_status_is_gateway_status_enum(self):
        result = compute_gateway_status("ALLOW", "ok")
        assert isinstance(result, GatewayStatus)


# ---------------------------------------------------------------------------
# IdempotencyOutcome derivation
# ---------------------------------------------------------------------------

class TestDeriveIdempotencyOutcome:
    def test_none_result_is_first_seen(self):
        assert _derive_idempotency_outcome(None) == IdempotencyOutcome.FIRST_SEEN

    def test_replay_detected_reason_is_replay(self):
        result = PolicyDecision.from_legacy(
            decision="DENY",
            reason="replay_detected",
            reason_text="Replay detected.",
            policy_id="gateway-idempotency-v1",
            policy_version="1.0.0",
            requires_human=False,
            overrideable=False,
            risk_level="low",
        )
        assert _derive_idempotency_outcome(result) == IdempotencyOutcome.REPLAY

    def test_duplicate_action_id_reason_is_duplicate(self):
        result = PolicyDecision.from_legacy(
            decision="DENY",
            reason="duplicate_action_id",
            reason_text="Duplicate action ID.",
            policy_id="gateway-idempotency-v1",
            policy_version="1.0.0",
            requires_human=False,
            overrideable=False,
            risk_level="medium",
        )
        assert _derive_idempotency_outcome(result) == IdempotencyOutcome.DUPLICATE

    def test_other_deny_reason_falls_back_to_first_seen(self):
        # Edge-case guard: unrecognised reason should not crash.
        result = PolicyDecision.from_legacy(
            decision="DENY",
            reason="some_other_reason",
            reason_text="Some other reason.",
            policy_id="fortix-policy-v1",
            policy_version="1.0.0",
            requires_human=False,
            overrideable=False,
            risk_level="low",
        )
        assert _derive_idempotency_outcome(result) == IdempotencyOutcome.FIRST_SEEN


# ---------------------------------------------------------------------------
# GatewayAuditEntry — construction and serialisation
# ---------------------------------------------------------------------------

class TestGatewayAuditEntry:
    def _make_entry(self, **overrides) -> GatewayAuditEntry:
        base = {
            "ts": "2024-01-15T10:00:00+00:00",
            "action_id": "act-001",
            "actor_id": "actor-001",
            "mode": "submit",
            "adr_hash": "a" * 64,
            "policy_decision": "ALLOW",
            "policy_reason": "ok",
            "status": GatewayStatus.EXECUTED,
            "executed": True,
            "idempotency_outcome": IdempotencyOutcome.FIRST_SEEN,
        }
        base.update(overrides)
        return GatewayAuditEntry(**base)

    def test_entry_has_entry_id(self):
        entry = self._make_entry()
        assert entry.entry_id != ""

    def test_two_entries_have_different_entry_ids(self):
        e1 = self._make_entry()
        e2 = self._make_entry()
        assert e1.entry_id != e2.entry_id

    def test_entry_id_is_uuid_format(self):
        import re
        entry = self._make_entry()
        assert re.match(
            r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}",
            entry.entry_id,
        )

    def test_to_audit_dict_is_json_serialisable(self):
        entry = self._make_entry()
        data = entry.to_audit_dict()
        serialised = json.dumps(data)
        parsed = json.loads(serialised)
        assert parsed["action_id"] == "act-001"
        assert parsed["status"] == "executed"
        assert parsed["idempotency_outcome"] == "first_seen"

    def test_enums_serialised_as_string_values(self):
        entry = self._make_entry(
            status=GatewayStatus.BLOCKED_BY_REPLAY,
            idempotency_outcome=IdempotencyOutcome.REPLAY,
        )
        data = entry.to_audit_dict()
        assert data["status"] == "blocked_by_replay_protection"
        assert data["idempotency_outcome"] == "replay"

    def test_round_trip_via_model_validate(self):
        entry = self._make_entry()
        data = entry.to_audit_dict()
        restored = GatewayAuditEntry.model_validate(data)
        assert restored.action_id == entry.action_id
        assert restored.status == entry.status
        assert restored.idempotency_outcome == entry.idempotency_outcome

    def test_actor_id_present(self):
        entry = self._make_entry(actor_id="actor-xyz")
        assert entry.actor_id == "actor-xyz"

    def test_fail_closed_mode_accepted(self):
        entry = self._make_entry(mode="fail_closed")
        assert entry.mode == "fail_closed"

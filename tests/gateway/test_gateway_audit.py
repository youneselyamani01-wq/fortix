"""
Tests for the gateway audit writer.

Coverage:
  - write_audit_entry writes parseable JSONL
  - Multiple entries are written as separate lines
  - read_audit_entries_for_action filters by action_id
  - read_all_audit_entries returns all entries
  - Malformed lines are skipped gracefully
  - Empty log returns empty list
  - Entry content matches what was written (round-trip)
All tests use a tmp_path fixture to avoid touching the live audit log.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.gateway.audit import read_all_audit_entries, read_audit_entries_for_action, write_audit_entry
from app.gateway.models import GatewayAuditEntry, GatewayStatus, IdempotencyOutcome


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_entry(action_id: str = "act-001", actor_id: str = "actor-001", **overrides) -> GatewayAuditEntry:
    base = {
        "ts": "2024-01-15T10:00:00+00:00",
        "action_id": action_id,
        "actor_id": actor_id,
        "mode": "submit",
        "adr_hash": "b" * 64,
        "policy_decision": "ALLOW",
        "policy_reason": "ok",
        "status": GatewayStatus.EXECUTED,
        "executed": True,
        "idempotency_outcome": IdempotencyOutcome.FIRST_SEEN,
    }
    base.update(overrides)
    return GatewayAuditEntry(**base)


@pytest.fixture(autouse=True)
def _patch_audit_path(tmp_path, monkeypatch):
    """Redirect all audit writes to a temp file for isolation."""
    import app.gateway.audit as audit_module
    log_path = tmp_path / "gateway_audit.log"
    monkeypatch.setattr(audit_module, "AUDIT_LOG_PATH", log_path)
    return log_path


# ---------------------------------------------------------------------------
# write_audit_entry
# ---------------------------------------------------------------------------

class TestWriteAuditEntry:
    def test_creates_file_on_first_write(self, tmp_path):
        import app.gateway.audit as audit_module
        log_path = audit_module.AUDIT_LOG_PATH
        entry = _make_entry()
        write_audit_entry(entry)
        assert log_path.exists()

    def test_written_line_is_valid_json(self, tmp_path):
        import app.gateway.audit as audit_module
        log_path = audit_module.AUDIT_LOG_PATH
        entry = _make_entry()
        write_audit_entry(entry)
        lines = log_path.read_text(encoding="utf-8").splitlines()
        assert len(lines) == 1
        parsed = json.loads(lines[0])
        assert parsed["action_id"] == "act-001"

    def test_two_writes_produce_two_lines(self, tmp_path):
        import app.gateway.audit as audit_module
        log_path = audit_module.AUDIT_LOG_PATH
        write_audit_entry(_make_entry("act-001"))
        write_audit_entry(_make_entry("act-002"))
        lines = [l for l in log_path.read_text(encoding="utf-8").splitlines() if l.strip()]
        assert len(lines) == 2

    def test_enum_values_serialised_as_strings(self, tmp_path):
        import app.gateway.audit as audit_module
        log_path = audit_module.AUDIT_LOG_PATH
        entry = _make_entry(
            status=GatewayStatus.BLOCKED_BY_REPLAY,
            idempotency_outcome=IdempotencyOutcome.REPLAY,
        )
        write_audit_entry(entry)
        parsed = json.loads(log_path.read_text(encoding="utf-8").strip())
        assert parsed["status"] == "blocked_by_replay_protection"
        assert parsed["idempotency_outcome"] == "replay"

    def test_actor_id_is_persisted(self, tmp_path):
        import app.gateway.audit as audit_module
        log_path = audit_module.AUDIT_LOG_PATH
        entry = _make_entry(actor_id="actor-xyz")
        write_audit_entry(entry)
        parsed = json.loads(log_path.read_text(encoding="utf-8").strip())
        assert parsed["actor_id"] == "actor-xyz"


# ---------------------------------------------------------------------------
# read_audit_entries_for_action
# ---------------------------------------------------------------------------

class TestReadAuditEntriesForAction:
    def test_empty_log_returns_empty_list(self):
        result = read_audit_entries_for_action("act-999")
        assert result == []

    def test_reads_matching_entry(self, tmp_path):
        import app.gateway.audit as audit_module
        write_audit_entry(_make_entry("act-A"))
        result = read_audit_entries_for_action("act-A")
        assert len(result) == 1
        assert result[0].action_id == "act-A"

    def test_filters_by_action_id(self, tmp_path):
        import app.gateway.audit as audit_module
        write_audit_entry(_make_entry("act-X"))
        write_audit_entry(_make_entry("act-Y"))
        result = read_audit_entries_for_action("act-X")
        assert all(e.action_id == "act-X" for e in result)
        assert len(result) == 1

    def test_returns_multiple_entries_for_same_action(self, tmp_path):
        import app.gateway.audit as audit_module
        write_audit_entry(_make_entry("act-M"))
        write_audit_entry(_make_entry("act-M"))
        result = read_audit_entries_for_action("act-M")
        assert len(result) == 2

    def test_returns_gateway_audit_entry_instances(self, tmp_path):
        import app.gateway.audit as audit_module
        write_audit_entry(_make_entry("act-T"))
        result = read_audit_entries_for_action("act-T")
        assert all(isinstance(e, GatewayAuditEntry) for e in result)

    def test_restored_status_is_enum(self, tmp_path):
        import app.gateway.audit as audit_module
        write_audit_entry(_make_entry("act-E", status=GatewayStatus.PENDING_REVIEW))
        result = read_audit_entries_for_action("act-E")
        assert result[0].status == GatewayStatus.PENDING_REVIEW

    def test_malformed_line_is_skipped(self, tmp_path):
        import app.gateway.audit as audit_module
        log_path = audit_module.AUDIT_LOG_PATH
        # Prepend a garbage line
        log_path.write_text("NOT JSON\n", encoding="utf-8")
        write_audit_entry(_make_entry("act-F"))
        result = read_audit_entries_for_action("act-F")
        assert len(result) == 1  # garbage line skipped, valid entry returned


# ---------------------------------------------------------------------------
# read_all_audit_entries
# ---------------------------------------------------------------------------

class TestReadAllAuditEntries:
    def test_empty_log_returns_empty_list(self, tmp_path):
        result = read_all_audit_entries(tmp_path / "nonexistent.log")
        assert result == []

    def test_reads_all_entries(self, tmp_path):
        import app.gateway.audit as audit_module
        write_audit_entry(_make_entry("act-1"))
        write_audit_entry(_make_entry("act-2"))
        write_audit_entry(_make_entry("act-3"))
        result = read_all_audit_entries()
        assert len(result) == 3

    def test_explicit_path_parameter(self, tmp_path):
        custom_log = tmp_path / "custom.log"
        entry = _make_entry("act-custom")
        line = json.dumps(entry.to_audit_dict()) + "\n"
        custom_log.write_text(line, encoding="utf-8")
        result = read_all_audit_entries(custom_log)
        assert len(result) == 1
        assert result[0].action_id == "act-custom"

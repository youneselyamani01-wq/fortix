"""
FortiX Gateway — Structured Audit Writer
==========================================
Writes and reads GatewayAuditEntry records as append-only JSONL.

One entry is written per gateway processing cycle — including fail-closed
entries written when an unexpected exception interrupts processing.

File: data/gateway_audit.log (JSONL, UTF-8, one entry per line)

Read-back is provided for tooling and tests; it is not on the hot path.
Malformed lines are skipped silently to preserve forward compatibility.
"""
from __future__ import annotations

import json
from pathlib import Path

from app.core.config import DATA_DIR
from app.gateway.models import GatewayAuditEntry


AUDIT_LOG_PATH: Path = DATA_DIR / "gateway_audit.log"


def write_audit_entry(entry: GatewayAuditEntry) -> None:
    """
    Append one structured audit entry to the gateway audit log.

    Thread-safety: file is opened in append mode; on CPython with GIL this is
    safe for concurrent single-line writes.  For multi-process deployments a
    dedicated log aggregator should be used instead.
    """
    line = json.dumps(entry.to_audit_dict(), ensure_ascii=False)
    with AUDIT_LOG_PATH.open("a", encoding="utf-8") as fh:
        fh.write(line + "\n")


def read_audit_entries_for_action(action_id: str) -> list[GatewayAuditEntry]:
    """
    Return all audit entries recorded for ``action_id``, in order.

    Skips lines that cannot be parsed or do not match; never raises.
    Suitable for tooling and tests; not optimised for large log files.
    """
    if not AUDIT_LOG_PATH.exists():
        return []
    entries: list[GatewayAuditEntry] = []
    with AUDIT_LOG_PATH.open("r", encoding="utf-8") as fh:
        for raw_line in fh:
            line = raw_line.strip()
            if not line:
                continue
            try:
                data = json.loads(line)
                if data.get("action_id") == action_id:
                    entries.append(GatewayAuditEntry.model_validate(data))
            except Exception:
                pass  # forward-compatible: skip unrecognised entries
    return entries


def read_all_audit_entries(log_path: Path | None = None) -> list[GatewayAuditEntry]:
    """
    Return all parseable audit entries in the log, in order.

    ``log_path`` defaults to AUDIT_LOG_PATH; pass an explicit path in tests
    to avoid touching the live log.
    """
    path = log_path or AUDIT_LOG_PATH
    if not path.exists():
        return []
    entries: list[GatewayAuditEntry] = []
    with path.open("r", encoding="utf-8") as fh:
        for raw_line in fh:
            line = raw_line.strip()
            if not line:
                continue
            try:
                entries.append(GatewayAuditEntry.model_validate(json.loads(line)))
            except Exception:
                pass
    return entries

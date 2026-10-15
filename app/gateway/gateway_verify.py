"""
GatewayVerifier — Gateway-layer receipt verification reference implementation.

This module is NOT part of ADR Core and does NOT modify ADR Core behavior.
ADR Core (adr_verify.py) remains the normative, stateless, cryptographic verifier.

GatewayVerifier wraps ADR Core with three Gateway-scope policies:

  1. Key registry  — resolves key_id -> public_key_hex.
                     Unknown key_id is rejected before Core verification runs.

  2. Replay detection — stateful set of seen receipt hashes.
                        A receipt hash seen before is rejected (stateful, per-instance).
                        A receipt is recorded as seen only after all checks pass.

  3. Timestamp policy — validates known timestamp fields in the payload
                        (timestamp, issued_at, decided_at).
                        This is a Gateway default policy, not an ADR Core requirement.
                        ADR Core treats payload content as opaque.

These three checks are Gateway concerns defined in ADR-SPEC-v1 Section 11 and
docs/adr-gateway.md. They do not alter or extend the ADR protocol itself.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Optional

from app.core.adr_verify import verify_adr


# Payload fields inspected by the default timestamp policy.
# Only fields with these names are validated; all other payload fields are ignored.
_TIMESTAMP_FIELDS = ("timestamp", "issued_at", "decided_at")

# Matches ISO 8601 datetime with Z or numeric UTC offset.
# Seconds are required; fractional seconds are optional.
_ISO8601_RE = re.compile(
    r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$"
)

# Maximum UTC offset accepted (±): IANA range is -12:00..+14:00.
_MAX_OFFSET_HOURS = 14.0
_MIN_OFFSET_HOURS = -12.0


def _parse_iso8601(value: str) -> Optional[datetime]:
    """
    Parse an ISO 8601 datetime string. Returns None if the string is not valid
    ISO 8601, has an out-of-range UTC offset, or cannot be parsed.
    """
    if not _ISO8601_RE.match(value):
        return None
    try:
        normalized = value[:-1] + "+00:00" if value.endswith("Z") else value
        dt = datetime.fromisoformat(normalized)
        offset = dt.utcoffset()
        if offset is not None:
            offset_hours = offset.total_seconds() / 3600
            if not (_MIN_OFFSET_HOURS <= offset_hours <= _MAX_OFFSET_HOURS):
                return None
        return dt
    except ValueError:
        return None


def _validate_payload_timestamps(payload: dict) -> bool:
    """
    Apply Gateway timestamp policy to payload fields named in _TIMESTAMP_FIELDS.

    Rules (Gateway-scope, not ADR Core):
    - Each present field must be a valid ISO 8601 datetime string.
    - UTC offset must be in range [-12:00, +14:00].
    - No timestamp may be in the future (relative to UTC now).
    - issued_at must be <= decided_at if both are present.

    Fields not in _TIMESTAMP_FIELDS are not inspected.
    Returns True if all checks pass, False on any violation.
    """
    now = datetime.now(tz=timezone.utc)
    parsed: dict[str, datetime] = {}

    for field in _TIMESTAMP_FIELDS:
        value = payload.get(field)
        if value is None:
            continue
        if not isinstance(value, str):
            return False
        dt = _parse_iso8601(value)
        if dt is None:
            return False
        if dt > now:
            return False
        parsed[field] = dt

    if "issued_at" in parsed and "decided_at" in parsed:
        if parsed["issued_at"] > parsed["decided_at"]:
            return False

    return True


class GatewayVerifier:
    """
    Stateful Gateway-layer verifier.

    This is a reference implementation of the Gateway verification boundary
    described in ADR-SPEC-v1 Section 11 and docs/adr-gateway.md.

    It is NOT a replacement for, nor an extension of, ADR Core (adr_verify.py).
    ADR Core is always called as an inner step; its behavior is unchanged.

    Parameters
    ----------
    key_registry:
        Mapping of key_id -> public_key_hex. Receipts whose key_id is not
        present in this registry are rejected before Core verification runs.
    timestamp_policy:
        If True (default), apply Gateway timestamp policy to payload fields
        named 'timestamp', 'issued_at', and 'decided_at'. Set to False to
        disable timestamp validation (e.g., for payloads with no timestamps).
    """

    def __init__(
        self,
        key_registry: dict[str, str],
        *,
        timestamp_policy: bool = True,
    ) -> None:
        self._key_registry = key_registry
        self._timestamp_policy = timestamp_policy
        self._seen_hashes: set[str] = set()

    def verify(self, receipt: dict) -> bool:
        """
        Verify a receipt through the Gateway policy stack.

        Step 1 — Key registry: resolve key_id to public_key_hex.
        Step 2 — ADR Core: stateless cryptographic verification.
        Step 3 — Replay detection: reject receipt hashes seen before.
        Step 4 — Timestamp policy: validate payload timestamp fields (if enabled).

        A receipt is recorded as seen (step 3) only after all checks pass.
        Returns True if and only if all four steps pass.
        """
        # Step 1: key registry lookup
        key_id = receipt.get("key_id", "")
        public_key_hex = self._key_registry.get(key_id)
        if public_key_hex is None:
            return False

        # Step 2: ADR Core — stateless, cryptographic (unchanged)
        if not verify_adr(receipt, public_key_hex):
            return False

        # Step 3: replay detection (stateful, per-instance)
        receipt_hash = receipt.get("hash", "")
        if receipt_hash in self._seen_hashes:
            return False

        # Step 4: timestamp policy (Gateway default, not ADR Core requirement)
        if self._timestamp_policy:
            payload = receipt.get("payload", {})
            if not _validate_payload_timestamps(payload):
                return False

        # Record as seen only after all checks pass.
        self._seen_hashes.add(receipt_hash)
        return True

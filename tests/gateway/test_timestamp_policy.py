"""
Gateway-scope timestamp policy tests.

These tests use GatewayVerifier — the Gateway-layer reference implementation.
They do NOT test ADR Core behavior.

ADR Core (adr_verify.py) treats payload content as opaque. It does not inspect
timestamp fields, validate formats, or reject future dates. Timestamp validation
is a Gateway policy applied after Core verification passes.

The default GatewayVerifier timestamp policy validates payload fields named
'timestamp', 'issued_at', and 'decided_at':
  - Must be valid ISO 8601 datetime strings.
  - UTC offset must be in range [-12:00, +14:00].
  - Must not be in the future.
  - issued_at must be <= decided_at if both are present.

This is a Gateway default policy, not an ADR protocol requirement.
"""
from nacl.signing import SigningKey

from app.core.canonicalizer import canonicalize
from app.core.hasher import hash_bytes
from app.gateway.gateway_verify import GatewayVerifier


_SIGNING_KEY = SigningKey(bytes.fromhex("99" * 32))
_PUBLIC_KEY_HEX = _SIGNING_KEY.verify_key.encode().hex()


def _build_signed_receipt(payload: dict) -> dict:
    hash_hex = hash_bytes(canonicalize(payload))
    signature_hex = _SIGNING_KEY.sign(hash_hex.encode("utf-8")).signature.hex()
    return {
        "version": "1.0",
        "payload": payload,
        "hash": hash_hex,
        "signature": signature_hex,
        "algorithm": {
            "hash": "BLAKE3",
            "signature": "Ed25519",
        },
        "key_id": "redteam-key-008",
    }


def _make_verifier() -> GatewayVerifier:
    return GatewayVerifier(
        key_registry={"redteam-key-008": _PUBLIC_KEY_HEX},
        timestamp_policy=True,
    )


def test_future_timestamp_fails() -> None:
    """Gateway rejects a payload with a future timestamp."""
    payload = {
        "action": "approve",
        "timestamp": "2099-01-01T00:00:00Z",
    }
    receipt = _build_signed_receipt(payload)
    assert _make_verifier().verify(receipt) is False


def test_inconsistent_timestamp_order_fails() -> None:
    """Gateway rejects a payload where issued_at is later than decided_at."""
    payload = {
        "action": "approve",
        "issued_at": "2026-03-20T10:00:00Z",
        "decided_at": "2026-03-19T10:00:00Z",
    }
    receipt = _build_signed_receipt(payload)
    assert _make_verifier().verify(receipt) is False


def test_non_iso_timestamp_format_fails() -> None:
    """Gateway rejects a timestamp not in ISO 8601 format."""
    payload = {
        "action": "approve",
        "timestamp": "03/19/2026 10:15:00",
    }
    receipt = _build_signed_receipt(payload)
    assert _make_verifier().verify(receipt) is False


def test_invalid_timezone_offset_fails() -> None:
    """Gateway rejects a timestamp with an out-of-range UTC offset (+25:00)."""
    payload = {
        "action": "approve",
        "timestamp": "2026-03-19T10:15:00+25:00",
    }
    receipt = _build_signed_receipt(payload)
    assert _make_verifier().verify(receipt) is False

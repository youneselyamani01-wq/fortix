"""
Gateway-scope replay and key_id binding tests.

These tests use GatewayVerifier — the Gateway-layer reference implementation.
They do NOT test ADR Core behavior. ADR Core (adr_verify.py) is stateless
and does not enforce key registries or replay state.

Covered Gateway policies:
  - Key registry: key_id must resolve to the correct public key.
    A modified or unknown key_id is rejected by the Gateway before Core runs.
  - Replay detection: a receipt hash seen before is rejected (stateful, per-instance).
    ADR Core itself accepts the same receipt every time; this is Gateway state.
"""
import copy

from nacl.signing import SigningKey

from app.core.canonicalizer import canonicalize
from app.core.hasher import hash_bytes
from app.gateway.gateway_verify import GatewayVerifier


_SIGNING_KEY = SigningKey(bytes.fromhex("44" * 32))
_PUBLIC_KEY_HEX = _SIGNING_KEY.verify_key.encode().hex()


def _build_signed_receipt(payload: dict, key_id: str = "redteam-key-003") -> dict:
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
        "key_id": key_id,
    }


def test_replay_signature_with_modified_key_id_fails() -> None:
    """
    A receipt with a modified key_id is rejected by the Gateway key registry.

    The Core verifier does not bind key_id to the signature — key_id is
    informational at the Core level. The Gateway resolves key_id to a public
    key via its registry; an unknown or attacker-controlled key_id has no
    registered public key and is rejected at step 1 (before Core runs).
    """
    payload = {
        "action": "approve",
        "timestamp": "2026-03-19T10:05:00Z",
        "request_id": "req-replay",
    }

    receipt = _build_signed_receipt(payload, key_id="trusted-key")
    receipt["key_id"] = "attacker-key-alias"

    verifier = GatewayVerifier(key_registry={"trusted-key": _PUBLIC_KEY_HEX})
    assert verifier.verify(receipt) is False


def test_replay_exact_receipt_second_verification_fails() -> None:
    """
    A receipt presented a second time is rejected by Gateway replay detection.

    ADR Core is stateless and returns True for the same receipt on every call.
    The GatewayVerifier tracks seen receipt hashes per-instance; the second
    call with the same receipt hash is rejected at step 3 (replay detection).
    """
    payload = {
        "action": "approve",
        "timestamp": "2026-03-19T10:07:00Z",
        "request_id": "req-repeat",
    }

    receipt = _build_signed_receipt(payload)

    verifier = GatewayVerifier(key_registry={"redteam-key-003": _PUBLIC_KEY_HEX})
    assert verifier.verify(receipt) is True
    assert verifier.verify(receipt) is False

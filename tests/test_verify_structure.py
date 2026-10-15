from nacl.signing import SigningKey
import binascii

from app.core.adr_verify import verify_adr
from app.core.canonicalizer import canonicalize
from app.core.hasher import hash_bytes


def build_receipt(payload: dict):
    canonical = canonicalize(payload)
    hash_hex = hash_bytes(canonical)

    signing_key = SigningKey.generate()
    verify_key = signing_key.verify_key
    signature = signing_key.sign(hash_hex.encode("utf-8")).signature

    receipt = {
        "version": "1.0",
        "payload": payload,
        "hash": hash_hex,
        "signature": binascii.hexlify(signature).decode(),
        "algorithm": {
            "hash": "BLAKE3",
            "signature": "Ed25519"
        },
        "key_id": "test-key-001"
    }

    public_key = binascii.hexlify(verify_key.encode()).decode()
    return receipt, public_key


def test_missing_required_field_fails():
    payload = {
        "action": "test",
        "actor": "fortix-core",
        "timestamp": "2026-03-11T15:00:00Z"
    }

    receipt, public_key = build_receipt(payload)
    del receipt["key_id"]

    assert verify_adr(receipt, public_key) is False


def test_wrong_hash_algorithm_fails():
    payload = {
        "action": "test",
        "actor": "fortix-core",
        "timestamp": "2026-03-11T15:00:00Z"
    }

    receipt, public_key = build_receipt(payload)
    receipt["algorithm"]["hash"] = "SHA256"

    assert verify_adr(receipt, public_key) is False


def test_wrong_signature_algorithm_fails():
    payload = {
        "action": "test",
        "actor": "fortix-core",
        "timestamp": "2026-03-11T15:00:00Z"
    }

    receipt, public_key = build_receipt(payload)
    receipt["algorithm"]["signature"] = "RSA"

    assert verify_adr(receipt, public_key) is False


def test_wrong_version_fails():
    payload = {
        "action": "test",
        "actor": "fortix-core",
        "timestamp": "2026-03-11T15:00:00Z"
    }

    receipt, public_key = build_receipt(payload)
    receipt["version"] = "2.0"

    assert verify_adr(receipt, public_key) is False


def test_malformed_algorithm_field_fails():
    payload = {
        "action": "test",
        "actor": "fortix-core",
        "timestamp": "2026-03-11T15:00:00Z"
    }

    receipt, public_key = build_receipt(payload)
    receipt["algorithm"] = "BLAKE3/Ed25519"

    assert verify_adr(receipt, public_key) is False
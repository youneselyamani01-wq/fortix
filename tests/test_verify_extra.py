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


def test_same_payload_different_key_order_same_hash():
    payload_a = {
        "action": "test",
        "actor": "fortix-core",
        "timestamp": "2026-03-11T15:00:00Z"
    }

    payload_b = {
        "timestamp": "2026-03-11T15:00:00Z",
        "actor": "fortix-core",
        "action": "test"
    }

    hash_a = hash_bytes(canonicalize(payload_a))
    hash_b = hash_bytes(canonicalize(payload_b))

    assert hash_a == hash_b


def test_modified_payload_fails_verification():
    payload = {
        "action": "test",
        "actor": "fortix-core",
        "timestamp": "2026-03-11T15:00:00Z"
    }

    receipt, public_key = build_receipt(payload)

    receipt["payload"]["action"] = "tampered"

    assert verify_adr(receipt, public_key) is False


def test_wrong_public_key_fails_verification():
    payload = {
        "action": "test",
        "actor": "fortix-core",
        "timestamp": "2026-03-11T15:00:00Z"
    }

    receipt, _ = build_receipt(payload)

    wrong_signing_key = SigningKey.generate()
    wrong_public_key = binascii.hexlify(wrong_signing_key.verify_key.encode()).decode()

    assert verify_adr(receipt, wrong_public_key) is False
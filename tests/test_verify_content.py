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


def test_non_ascii_payload_verifies():
    payload = {
        "action": "décision",
        "actor": "fortix-cœur",
        "timestamp": "2026-03-11T15:00:00Z",
        "comment": "paiement validé à Zürich"
    }

    receipt, public_key = build_receipt(payload)

    assert verify_adr(receipt, public_key) is True


def test_nested_payload_verifies():
    payload = {
        "action": "test",
        "actor": "fortix-core",
        "timestamp": "2026-03-11T15:00:00Z",
        "context": {
            "env": "sandbox",
            "risk": {
                "level": "medium",
                "score": 42
            }
        }
    }

    receipt, public_key = build_receipt(payload)

    assert verify_adr(receipt, public_key) is True


def test_receipt_not_dict_fails():
    receipt = "not-a-dict"
    public_key = "deadbeef"

    assert verify_adr(receipt, public_key) is False


def test_incomplete_algorithm_field_fails():
    payload = {
        "action": "test",
        "actor": "fortix-core",
        "timestamp": "2026-03-11T15:00:00Z"
    }

    receipt, public_key = build_receipt(payload)
    receipt["algorithm"] = {
        "hash": "BLAKE3"
    }

    assert verify_adr(receipt, public_key) is False


def test_modified_hash_fails_verification():
    payload = {
        "action": "test",
        "actor": "fortix-core",
        "timestamp": "2026-03-11T15:00:00Z"
    }

    receipt, public_key = build_receipt(payload)
    receipt["hash"] = "0" * len(receipt["hash"])

    assert verify_adr(receipt, public_key) is False
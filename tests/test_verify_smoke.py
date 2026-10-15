from nacl.signing import SigningKey
import binascii

from app.core.adr_verify import verify_adr
from app.core.canonicalizer import canonicalize
from app.core.hasher import hash_bytes


def test_vector_001():
    payload = {
        "action": "test",
        "actor": "fortix-core",
        "timestamp": "2026-03-11T15:00:00Z"
    }

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
        "key_id": "smoke-test-key",
    }

    public_key = binascii.hexlify(verify_key.encode()).decode()

    assert verify_adr(receipt, public_key) is True
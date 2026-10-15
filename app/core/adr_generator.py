from app.core.canonicalizer import canonicalize
from app.core.hasher import hash_bytes
from app.core.signer import sign_hash


ADR_VERSION = "1.0"


def generate_receipt(payload, private_key, key_id: str):
    if not isinstance(key_id, str) or key_id == "":
        raise ValueError("key_id must be a non-empty string")

    canonical = canonicalize(payload)
    receipt_hash = hash_bytes(canonical)
    signature = sign_hash(receipt_hash, private_key)

    return {
        "version":   ADR_VERSION,
        "payload":   payload,
        "hash":      receipt_hash,
        "signature": signature,
        "algorithm": {
            "hash":      "BLAKE3",
            "signature": "Ed25519",
        },
        "key_id": key_id,
    }

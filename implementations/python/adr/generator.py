"""
ADR receipt generator.

Produces a fully-formed receipt dict with all 6 required top-level fields:
    version, payload, hash, signature, algorithm, key_id
"""
from .canonicalizer import canonicalize
from .hasher        import hash_canonical
from .signer        import sign_receipt

ADR_VERSION = "1.0"


def generate_receipt(payload: dict, private_key_hex: str, key_id: str) -> dict:
    """Generate an ADR receipt for *payload*.

    Args:
        payload:         The action payload dict to commit.
        private_key_hex: Ed25519 private key as lowercase hex (32 bytes / 64 chars).
        key_id:          Opaque identifier for the signing key (non-empty string).

    Returns:
        A receipt dict ready for serialisation and transmission.

    Raises:
        TypeError:  if *payload* is not a dict or *key_id* is not a str.
        ValueError: if *key_id* is empty, or payload contains NaN/Infinity.
    """
    if not isinstance(key_id, str) or key_id == "":
        raise ValueError("key_id must be a non-empty string")

    canonical    = canonicalize(payload)
    receipt_hash = hash_canonical(canonical)
    signature    = sign_receipt(receipt_hash, private_key_hex)

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

"""
adr — FortiX Audit Decision Record protocol, standalone Python module.

Public surface:
    canonicalize(payload)            -> bytes
    hash_canonical(data)             -> str   (BLAKE3 hex)
    sign_receipt(hash_hex, sk_hex)   -> str   (Ed25519 signature hex)
    generate_receipt(payload, sk_hex, key_id) -> dict
    verify_receipt(receipt, pk_hex)  -> bool
"""
from .canonicalizer import canonicalize
from .hasher       import hash_canonical
from .signer       import sign_receipt
from .generator    import generate_receipt
from .verifier     import verify_receipt

__all__ = [
    "canonicalize",
    "hash_canonical",
    "sign_receipt",
    "generate_receipt",
    "verify_receipt",
]

VERSION = "1.0"

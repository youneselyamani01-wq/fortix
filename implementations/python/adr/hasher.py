"""
ADR hashing layer — BLAKE3 over canonical bytes.
"""
from blake3 import blake3


def hash_canonical(data: bytes) -> str:
    """Return the lowercase hex BLAKE3 digest of *data*."""
    return blake3(data).hexdigest()

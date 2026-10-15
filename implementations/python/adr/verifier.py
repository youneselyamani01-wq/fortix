"""
ADR receipt verifier — 9-step, fail-closed.

Step 1:  receipt is a dict
Step 2:  exact set of 6 top-level fields (no extras, no missing)
Step 3:  algorithm is a dict with exactly {hash, signature}
Step 4:  version == "1.0"
Step 5:  algorithm.hash == "BLAKE3"
Step 6:  algorithm.signature == "Ed25519"
Step 7:  payload is a dict; key_id is a non-empty string
Step 8:  recompute hash over canonical(payload) → must match receipt["hash"]
Step 9:  verify Ed25519 signature of UTF-8(hash_hex) with public key
"""
import binascii

from nacl.signing    import VerifyKey
from nacl.exceptions import BadSignatureError

from .canonicalizer import canonicalize
from .hasher        import hash_canonical


_REQUIRED_TOP_LEVEL = {"version", "payload", "hash", "signature", "algorithm", "key_id"}
_REQUIRED_ALGORITHM = {"hash", "signature"}


def verify_receipt(receipt: dict, public_key_hex: str) -> bool:
    """Return True iff *receipt* is a valid ADR receipt for *public_key_hex*.

    Never raises — all errors produce False (fail-closed).
    """
    try:
        # Step 1
        if not isinstance(receipt, dict):
            return False

        # Step 2
        if set(receipt.keys()) != _REQUIRED_TOP_LEVEL:
            return False

        algorithm = receipt["algorithm"]

        # Step 3
        if not isinstance(algorithm, dict):
            return False
        if set(algorithm.keys()) != _REQUIRED_ALGORITHM:
            return False

        # Step 4
        if receipt["version"] != "1.0":
            return False

        # Step 5
        if algorithm["hash"] != "BLAKE3":
            return False

        # Step 6
        if algorithm["signature"] != "Ed25519":
            return False

        payload       = receipt["payload"]
        key_id        = receipt["key_id"]
        expected_hash = receipt["hash"]
        signature_hex = receipt["signature"]

        # Step 7
        if not isinstance(payload, dict):
            return False
        if not isinstance(key_id, str) or key_id == "":
            return False

        # Step 8
        canonical     = canonicalize(payload)
        computed_hash = hash_canonical(canonical)
        if computed_hash != expected_hash:
            return False

        # Step 9
        verify_key = VerifyKey(binascii.unhexlify(public_key_hex))
        signature  = binascii.unhexlify(signature_hex)
        verify_key.verify(expected_hash.encode("utf-8"), signature)

        return True

    except (BadSignatureError, ValueError, TypeError, KeyError, binascii.Error):
        return False

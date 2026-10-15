from app.core.hasher import hash_bytes
from app.core.canonicalizer import canonicalize
from nacl.signing import VerifyKey
from nacl.exceptions import BadSignatureError
import binascii


ALLOWED_TOP_LEVEL_FIELDS = {
    "version",
    "payload",
    "hash",
    "signature",
    "algorithm",
    "key_id",
}

ALLOWED_ALGORITHM_FIELDS = {
    "hash",
    "signature",
}


def verify_adr(receipt: dict, public_key_hex: str) -> bool:
    try:
        if not isinstance(receipt, dict):
            return False

        if set(receipt.keys()) != ALLOWED_TOP_LEVEL_FIELDS:
            return False

        algorithm = receipt["algorithm"]
        if not isinstance(algorithm, dict):
            return False

        if set(algorithm.keys()) != ALLOWED_ALGORITHM_FIELDS:
            return False

        if receipt["version"] != "1.0":
            return False

        if algorithm["hash"] != "BLAKE3":
            return False

        if algorithm["signature"] != "Ed25519":
            return False

        payload = receipt["payload"]
        key_id = receipt["key_id"]
        expected_hash = receipt["hash"]
        signature_hex = receipt["signature"]

        if not isinstance(payload, dict):
            return False

        if not isinstance(key_id, str):
            return False

        if key_id == "":
            return False

        canonical = canonicalize(payload)
        computed_hash = hash_bytes(canonical)

        if computed_hash != expected_hash:
            return False

        verify_key = VerifyKey(binascii.unhexlify(public_key_hex))
        signature = binascii.unhexlify(signature_hex)

        verify_key.verify(expected_hash.encode("utf-8"), signature)
        return True

    except (BadSignatureError, ValueError, TypeError, KeyError, binascii.Error):
        return False

from app.core.hasher import hash_bytes
from app.core.canonicalizer import canonicalize
from nacl.signing import VerifyKey
from nacl.exceptions import BadSignatureError
import binascii


def verify_adr(receipt: dict, public_key_hex: str) -> bool:
    try:
        payload = receipt["payload"]
        expected_hash = receipt["hash"]
        signature_hex = receipt["signature"]

        # 1. canonicalize
        canonical = canonicalize(payload)

        # 2. compute hash
        computed_hash = hash_bytes(canonical)

        if computed_hash != expected_hash:
            return False

        # 3. verify signature
        verify_key = VerifyKey(binascii.unhexlify(public_key_hex))
        signature = binascii.unhexlify(signature_hex)

        verify_key.verify(
            expected_hash.encode("utf-8"),
            signature
        )

        return True

    except BadSignatureError:
        return False
    except Exception:
        return False

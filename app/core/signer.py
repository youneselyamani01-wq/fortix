from nacl.signing import SigningKey
from nacl.encoding import HexEncoder


def sign_hash(hash_hex: str, private_key_hex: str) -> str:
    signing_key = SigningKey(private_key_hex, encoder=HexEncoder)
    signed = signing_key.sign(hash_hex.encode("utf-8"))
    return signed.signature.hex()

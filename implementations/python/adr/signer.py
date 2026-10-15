"""
ADR signing layer — Ed25519 over UTF-8(hex_hash).

Signing input is the UTF-8 encoding of the lowercase hex hash string,
NOT the raw hash bytes.
"""
from nacl.signing  import SigningKey
from nacl.encoding import HexEncoder


def sign_receipt(hash_hex: str, private_key_hex: str) -> str:
    """Sign *hash_hex* with *private_key_hex* (both lowercase hex strings).

    Returns the 64-byte Ed25519 signature as a lowercase hex string.
    """
    signing_key = SigningKey(private_key_hex, encoder=HexEncoder)
    signed = signing_key.sign(hash_hex.encode("utf-8"))
    return signed.signature.hex()


def public_key_hex(private_key_hex: str) -> str:
    """Derive the Ed25519 public key hex from a private key hex."""
    return SigningKey(private_key_hex, encoder=HexEncoder).verify_key.encode().hex()

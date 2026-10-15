from __future__ import annotations

import os
import re
from collections.abc import Mapping
from dataclasses import dataclass, field

SIGNING_PRIVATE_KEY_HEX_ENV = "FORTIX_ADR_SIGNING_PRIVATE_KEY_HEX"
SIGNING_KEY_ID_ENV = "FORTIX_ADR_SIGNING_KEY_ID"
_PRIVATE_KEY_HEX_RE = re.compile(r"[0-9a-fA-F]{64}")
_KEY_ID_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}")


class SigningConfigurationError(RuntimeError):
    def __init__(self, reason_code: str) -> None:
        self.reason_code = reason_code
        super().__init__("ADR signing configuration is unavailable")


@dataclass(frozen=True)
class SigningConfiguration:
    private_key_hex: str = field(repr=False)
    key_id: str

    @property
    def public_key_hex(self) -> str:
        from nacl.signing import SigningKey

        return SigningKey(bytes.fromhex(self.private_key_hex)).verify_key.encode().hex()


def load_signing_configuration(
    environ: Mapping[str, str] | None = None,
) -> SigningConfiguration:
    source = os.environ if environ is None else environ

    raw_private_key = source.get(SIGNING_PRIVATE_KEY_HEX_ENV)
    if not isinstance(raw_private_key, str) or not raw_private_key.strip():
        raise SigningConfigurationError("private_key_missing")
    private_key_hex = raw_private_key.strip()
    if _PRIVATE_KEY_HEX_RE.fullmatch(private_key_hex) is None:
        raise SigningConfigurationError("private_key_malformed")

    private_key_bytes = bytes.fromhex(private_key_hex)
    if len(private_key_bytes) != 32 or len(set(private_key_bytes)) == 1:
        raise SigningConfigurationError("private_key_rejected")

    raw_key_id = source.get(SIGNING_KEY_ID_ENV)
    if not isinstance(raw_key_id, str) or not raw_key_id.strip():
        raise SigningConfigurationError("key_id_missing")
    key_id = raw_key_id.strip()
    if _KEY_ID_RE.fullmatch(key_id) is None:
        raise SigningConfigurationError("key_id_malformed")

    return SigningConfiguration(private_key_hex=private_key_hex, key_id=key_id)

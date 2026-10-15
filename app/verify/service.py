"""
FortiX Verify Layer — Verification Service
=============================================
VerifyService is the single entry point for receipt verification.

Protocol:
  1. Safely extract receipt metadata (key_id, algorithm, payload size).
  2. Call verify_adr() — the ADR Core stateless verifier — as the authoritative
     pass/fail gate.  Its behaviour is unchanged.
  3. If verify_adr() returns True  → VALID.
     If verify_adr() returns False → run _diagnose() to attribute the failure
     to a specific reason code.
  4. Wrap everything in a try/except → UNVERIFIABLE on any unhandled exception.

_diagnose() is only called on the failure path and never affects the verdict
produced by verify_adr().  It exists solely to derive a human-interpretable
reason code from the same logical checks.

v1 scope:
  VALID confirms receipt integrity and signature authenticity against the
  caller-supplied public key.  The following are intentionally outside v1:
  - Key trust / authority: no key registry or trust anchor is consulted.
  - Key revocation: no revocation check is performed.
  - Policy correctness: the governance decision in the payload is not evaluated.
  These concerns are deployment-level and addressed outside ADR Core.
"""
from __future__ import annotations

import binascii
import logging
from typing import Any

from nacl.exceptions import BadSignatureError
from nacl.signing import VerifyKey

from app.core.adr_verify import (
    ALLOWED_ALGORITHM_FIELDS,
    ALLOWED_TOP_LEVEL_FIELDS,
    verify_adr,
)
from app.core.canonicalizer import canonicalize
from app.core.hasher import hash_bytes
from app.verify.models import VerificationResult, VerifyReasonCode

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Failure-mode attribution
# ---------------------------------------------------------------------------

def _diagnose(
    receipt: Any, public_key_hex: str
) -> tuple[VerifyReasonCode, bool | None, bool | None]:
    """
    Run staged checks in the same order as ADR Core and return the first
    failing stage as a (code, hash_match, signature_valid) triple.

    hash_match and signature_valid are None when the check was not reached.

    This function is only called after verify_adr() returned False; it never
    changes the pass/fail verdict.
    """
    # --- Structure ---
    if not isinstance(receipt, dict):
        return VerifyReasonCode.MALFORMED_RECEIPT, None, None

    if set(receipt.keys()) != ALLOWED_TOP_LEVEL_FIELDS:
        return VerifyReasonCode.SCHEMA_VIOLATION, None, None

    algorithm = receipt.get("algorithm")
    if not isinstance(algorithm, dict):
        return VerifyReasonCode.SCHEMA_VIOLATION, None, None

    if set(algorithm.keys()) != ALLOWED_ALGORITHM_FIELDS:
        return VerifyReasonCode.SCHEMA_VIOLATION, None, None

    if receipt.get("version") != "1.0":
        return VerifyReasonCode.UNSUPPORTED_VERSION, None, None

    if algorithm.get("hash") != "BLAKE3":
        return VerifyReasonCode.UNSUPPORTED_ALGORITHM, None, None

    if algorithm.get("signature") != "Ed25519":
        return VerifyReasonCode.UNSUPPORTED_ALGORITHM, None, None

    payload = receipt.get("payload")
    key_id = receipt.get("key_id")
    expected_hash = receipt.get("hash")
    signature_hex = receipt.get("signature")

    if not isinstance(payload, dict):
        return VerifyReasonCode.SCHEMA_VIOLATION, None, None

    if not isinstance(key_id, str) or key_id == "":
        return VerifyReasonCode.SCHEMA_VIOLATION, None, None

    # --- Hash ---
    try:
        canonical = canonicalize(payload)
        computed_hash = hash_bytes(canonical)
    except Exception:
        return VerifyReasonCode.INTERNAL_ERROR, None, None

    hash_match = computed_hash == expected_hash
    if not hash_match:
        return VerifyReasonCode.HASH_MISMATCH, False, None

    # --- Key decode ---
    try:
        verify_key = VerifyKey(binascii.unhexlify(public_key_hex))
    except (binascii.Error, ValueError, TypeError):
        # Caller-supplied key is undecodable — we cannot determine validity.
        return VerifyReasonCode.KEY_DECODE_ERROR, True, None

    # --- Signature ---
    try:
        sig_bytes = binascii.unhexlify(signature_hex)
    except (binascii.Error, TypeError, ValueError):
        return VerifyReasonCode.SIGNATURE_INVALID, True, False

    try:
        verify_key.verify(expected_hash.encode("utf-8"), sig_bytes)  # type: ignore[arg-type]
        # If we reach here, verify_adr() should have returned True.
        # Guard: treat as internal error to avoid contradicting the authoritative verdict.
        return VerifyReasonCode.INTERNAL_ERROR, True, True
    except BadSignatureError:
        return VerifyReasonCode.SIGNATURE_INVALID, True, False
    except Exception:
        return VerifyReasonCode.INTERNAL_ERROR, True, None


# ---------------------------------------------------------------------------
# Status mapping
# ---------------------------------------------------------------------------

_UNVERIFIABLE_CODES = frozenset(
    {VerifyReasonCode.KEY_DECODE_ERROR, VerifyReasonCode.INTERNAL_ERROR}
)


def _status_for(code: VerifyReasonCode) -> str:
    if code == VerifyReasonCode.VALID:
        return "VALID"
    if code in _UNVERIFIABLE_CODES:
        return "UNVERIFIABLE"
    return "INVALID"


# ---------------------------------------------------------------------------
# Safe metadata extraction
# ---------------------------------------------------------------------------

def _extract_metadata(receipt: Any) -> dict:
    """
    Pull displayable fields from the receipt without any verification logic.
    Returns empty/None values safely for malformed inputs.
    """
    if not isinstance(receipt, dict):
        return {
            "key_id": None,
            "algorithm_hash": None,
            "algorithm_signature": None,
            "payload_field_count": None,
        }
    algorithm = receipt.get("algorithm")
    payload = receipt.get("payload")
    return {
        "key_id": receipt.get("key_id") if isinstance(receipt.get("key_id"), str) else None,
        "algorithm_hash": algorithm.get("hash") if isinstance(algorithm, dict) else None,
        "algorithm_signature": algorithm.get("signature") if isinstance(algorithm, dict) else None,
        "payload_field_count": len(payload) if isinstance(payload, dict) else None,
    }


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------

class VerifyService:
    """
    Stateless receipt verification service.

    verify() is the only public method.  It never raises — fails closed on any
    unhandled exception, returning UNVERIFIABLE/INTERNAL_ERROR.
    """

    def verify(self, receipt: Any, public_key_hex: str) -> VerificationResult:
        """
        Verify receipt against public_key_hex.

        Returns a VerificationResult with status VALID, INVALID, or
        UNVERIFIABLE and an explicit reason code.  Never raises.
        """
        try:
            return self._verify_inner(receipt, public_key_hex)
        except Exception:
            logger.exception("VerifyService failed closed during receipt verification")
            return self._fail_closed(receipt)

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    def _verify_inner(self, receipt: Any, public_key_hex: str) -> VerificationResult:
        meta = _extract_metadata(receipt)

        # ADR Core is the authoritative gate.
        passed = verify_adr(receipt, public_key_hex)

        if passed:
            return VerificationResult(
                status="VALID",
                code=VerifyReasonCode.VALID,
                hash_match=True,
                signature_valid=True,
                **meta,
            )

        # Diagnose the failure.
        code, hash_match, signature_valid = _diagnose(receipt, public_key_hex)
        status = _status_for(code)

        return VerificationResult(
            status=status,  # type: ignore[arg-type]
            code=code,
            hash_match=hash_match,
            signature_valid=signature_valid,
            **meta,
        )

    def _fail_closed(self, receipt: Any) -> VerificationResult:
        meta = {}
        try:
            meta = _extract_metadata(receipt)
        except Exception:
            pass
        return VerificationResult(
            status="UNVERIFIABLE",
            code=VerifyReasonCode.INTERNAL_ERROR,
            hash_match=None,
            signature_valid=None,
            **meta,
        )

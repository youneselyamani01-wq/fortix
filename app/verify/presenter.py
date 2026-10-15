"""
FortiX Verify Layer — Presenter
=================================
Converts a VerificationResult into a VerificationResponse containing two views:

  institutional — plain-language verdict for compliance/legal consumers.
  expert        — full technical detail for engineers and auditors.

Both views are always populated.  Presentation logic is pure (no side effects).
"""
from __future__ import annotations

from app.verify.models import (
    ExpertView,
    InstitutionalView,
    VerificationResponse,
    VerificationResult,
    VerifyReasonCode,
)


# ---------------------------------------------------------------------------
# Institutional message tables
# ---------------------------------------------------------------------------

_INSTITUTIONAL_VERDICTS: dict[str, str] = {
    "VALID": "Receipt verified.",
    "INVALID": "Receipt failed verification.",
    "UNVERIFIABLE": "Verification could not be completed.",
}

_INSTITUTIONAL_EXPLANATIONS: dict[VerifyReasonCode, str] = {
    VerifyReasonCode.VALID: (
        "The cryptographic signature is authentic and the payload is unaltered "
        "since the receipt was issued. Verification confirms receipt integrity "
        "and that the signature matches the supplied public key. It does not "
        "confirm the authority or revocation status of that key, nor the "
        "correctness of the governance decision encoded in the payload."
    ),
    VerifyReasonCode.MALFORMED_RECEIPT: (
        "The submitted receipt is not a valid structure. "
        "It may have been corrupted or incorrectly formatted."
    ),
    VerifyReasonCode.SCHEMA_VIOLATION: (
        "The receipt does not conform to the required format. "
        "Required fields are missing, mistyped, or unexpected fields are present."
    ),
    VerifyReasonCode.UNSUPPORTED_VERSION: (
        "The receipt declares a protocol version that is not supported by "
        "this verifier. Ensure the receipt was produced by a compatible system."
    ),
    VerifyReasonCode.UNSUPPORTED_ALGORITHM: (
        "The receipt uses a cryptographic algorithm that is not recognised. "
        "Only BLAKE3 hashing with Ed25519 signatures is accepted."
    ),
    VerifyReasonCode.HASH_MISMATCH: (
        "The document content does not match the recorded hash. "
        "The payload may have been altered after the receipt was issued."
    ),
    VerifyReasonCode.SIGNATURE_INVALID: (
        "The cryptographic signature did not verify. "
        "The receipt may have been tampered with, or the wrong public key was provided."
    ),
    VerifyReasonCode.KEY_DECODE_ERROR: (
        "The provided public key could not be decoded. "
        "Verify that the public key is a valid 64-character hex string."
    ),
    VerifyReasonCode.INTERNAL_ERROR: (
        "An internal error prevented verification from completing. "
        "The receipt has not been confirmed as valid or invalid."
    ),
}


# ---------------------------------------------------------------------------
# Presenter
# ---------------------------------------------------------------------------

def present(result: VerificationResult) -> VerificationResponse:
    """Convert a VerificationResult into a VerificationResponse."""
    return VerificationResponse(
        status=result.status,
        code=result.code,
        institutional=_make_institutional(result),
        expert=_make_expert(result),
    )


def _make_institutional(result: VerificationResult) -> InstitutionalView:
    verdict = _INSTITUTIONAL_VERDICTS.get(result.status, result.status)
    explanation = _INSTITUTIONAL_EXPLANATIONS.get(
        result.code,
        f"Verification result: {result.code.value}.",
    )
    return InstitutionalView(verdict=verdict, explanation=explanation)


def _make_expert(result: VerificationResult) -> ExpertView:
    return ExpertView(
        status=result.status,
        code=result.code.value,
        key_id=result.key_id,
        algorithm_hash=result.algorithm_hash,
        algorithm_signature=result.algorithm_signature,
        payload_field_count=result.payload_field_count,
        hash_verified=result.hash_match,
        signature_verified=result.signature_valid,
    )

"""
FortiX Verify Layer — Data Models
====================================
Standardised types for verification results and their two presentation views.

VerificationResult is the internal service contract.
VerificationResponse is the serialised API output (both views combined).
"""
from __future__ import annotations

from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, Field


class VerifyReasonCode(str, Enum):
    """
    Explicit reason codes for every verification outcome.

    VALID           — all nine ADR Core checks passed.
    MALFORMED_RECEIPT — receipt is not a dict.
    SCHEMA_VIOLATION — wrong field set, wrong types, empty key_id.
    UNSUPPORTED_VERSION — version field is not "1.0".
    UNSUPPORTED_ALGORITHM — hash or signature algorithm not recognised.
    HASH_MISMATCH   — payload hash recomputed but does not match the stored value.
    SIGNATURE_INVALID — hash is correct but the Ed25519 signature does not verify.
    KEY_DECODE_ERROR — public key could not be hex-decoded (caller input error).
    INTERNAL_ERROR  — unexpected exception during evaluation (fail-closed).
    """

    VALID = "valid"
    MALFORMED_RECEIPT = "malformed_receipt"
    SCHEMA_VIOLATION = "schema_violation"
    UNSUPPORTED_VERSION = "unsupported_version"
    UNSUPPORTED_ALGORITHM = "unsupported_algorithm"
    HASH_MISMATCH = "hash_mismatch"
    SIGNATURE_INVALID = "signature_invalid"
    KEY_DECODE_ERROR = "key_decode_error"
    INTERNAL_ERROR = "internal_error"


# ---------------------------------------------------------------------------
# Internal service contract
# ---------------------------------------------------------------------------

class VerificationResult(BaseModel):
    """
    Internal output of VerifyService.verify().

    Carries the verdict, reason code, and all technical metadata captured
    during the evaluation run.  hash_match and signature_valid are None when
    the corresponding check could not be reached.
    """

    status: Literal["VALID", "INVALID", "UNVERIFIABLE"]
    code: VerifyReasonCode
    # Metadata — safely extracted from the receipt before crypto runs
    key_id: str | None = None
    algorithm_hash: str | None = None
    algorithm_signature: str | None = None
    payload_field_count: int | None = None
    # Check results — None means the check was not reached
    hash_match: bool | None = None
    signature_valid: bool | None = None


# ---------------------------------------------------------------------------
# Request boundary
# ---------------------------------------------------------------------------

class VerifyReceiptRequest(BaseModel):
    """
    Request model for POST /verify/receipt.

    The receipt is accepted as raw JSON so the verification service can
    classify malformed and schema-invalid receipts instead of the route layer
    rejecting or normalising them early.
    """

    receipt: Any
    public_key_hex: str = Field(..., min_length=1)


# ---------------------------------------------------------------------------
# Presentation views
# ---------------------------------------------------------------------------

class InstitutionalView(BaseModel):
    """
    Plain-language summary for compliance, legal, or non-technical consumers.
    No cryptographic detail; outcome and human-readable explanation only.
    """

    verdict: str = Field(..., description="One-line outcome statement")
    explanation: str = Field(..., description="Plain-language explanation")


class ExpertView(BaseModel):
    """
    Full technical detail for engineers and auditors.
    Exposes every intermediate check result and algorithm parameter.
    """

    status: str
    code: str
    key_id: str | None
    algorithm_hash: str | None
    algorithm_signature: str | None
    payload_field_count: int | None
    hash_verified: bool | None = Field(
        ..., description="True = computed hash matched stored hash"
    )
    signature_verified: bool | None = Field(
        ..., description="True = Ed25519 signature verified against hash"
    )


# ---------------------------------------------------------------------------
# Combined API response
# ---------------------------------------------------------------------------

class VerificationResponse(BaseModel):
    """
    Returned by POST /verify/receipt.

    Both views are always present so callers can consume whichever fits their
    context without choosing an endpoint variant.
    """

    status: Literal["VALID", "INVALID", "UNVERIFIABLE"]
    code: VerifyReasonCode
    institutional: InstitutionalView
    expert: ExpertView

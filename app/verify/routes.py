"""
FortiX Verify Layer — API Routes
====================================
POST /verify/receipt   — primary verification endpoint

This is the authoritative verification surface.  It returns a full
VerificationResponse with:
  - status: VALID | INVALID | UNVERIFIABLE
  - code: explicit VerifyReasonCode for every outcome
  - institutional: plain-language verdict for compliance/legal consumers
  - expert: full technical detail for engineers and auditors

Request schema is compatible with POST /adr/verify so existing clients
can migrate by changing only the endpoint URL.

POST /adr/verify is retained as a legacy thin endpoint that returns
{"valid": bool} only.  It remains available for backward compatibility
with existing tooling and frozen reference data.  New code should use
this endpoint instead.
"""
from __future__ import annotations

from fastapi import APIRouter

from app.verify.models import VerificationResponse, VerifyReceiptRequest
from app.verify.presenter import present
from app.verify.service import VerifyService


router = APIRouter(prefix="/verify", tags=["verify"])
_service = VerifyService()


@router.post("/receipt", response_model=VerificationResponse)
def verify_receipt(request: VerifyReceiptRequest) -> VerificationResponse:
    """
    Verify an ADR receipt against a public key.

    Returns a standardised verdict (VALID / INVALID / UNVERIFIABLE) with an
    explicit reason code and two presentation views:

    - **institutional**: plain-language outcome for compliance / legal teams.
    - **expert**: full technical detail for engineers and auditors.

    VALID means: the payload hash is intact and the Ed25519 signature verifies
    against the supplied public key.  It does not confirm the authority or
    revocation status of that key, nor the correctness of any governance
    decision recorded in the payload.  Key trust is a deployment concern
    outside the scope of ADR v1.

    Fails closed — any internal error yields UNVERIFIABLE, never an exception.
    """
    result = _service.verify(
        receipt=request.receipt,
        public_key_hex=request.public_key_hex,
    )
    return present(result)

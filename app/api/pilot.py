from __future__ import annotations

from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel

from app.core.adr_generator import generate_receipt
from app.core.signing_config import SigningConfiguration, load_signing_configuration
from app.verify.service import VerifyService


router = APIRouter(prefix="/pilot", tags=["pilot"])
_verify = VerifyService()


_ACTION = {
    "action": "payment.submit",
    "amount": 180000,
    "currency": "EUR",
    "origin": "FR",
    "destination": "AE",
    "risk_flags": ["cross_border", "high_amount"],
    "policy_id": "bank-policy-v1",
}

_REASON_CODES = [
    "high_amount",
    "cross_border",
    "regulatory_exposure",
    "human_approval_required",
]


def _public_key_hex() -> str:
    return load_signing_configuration().public_key_hex


def _pilot_payload() -> dict[str, Any]:
    return {
        "pilot": "fortix-decision-receipt-pilot-v2",
        "object_type": "bank_payment_decision",
        "action": dict(_ACTION),
        "control": {
            "status": "pending_review",
            "decision": "REQUIRE_REVIEW",
            "policy_id": "bank-policy-v1",
            "reason_codes": list(_REASON_CODES),
            "human_layer": "pending_bank_review",
            "action_executed": False,
        },
        "receipt_purpose": "governance_decision_attestation",
    }


def _generate_pilot_receipt(
    configuration: SigningConfiguration | None = None,
) -> dict[str, Any]:
    if configuration is None:
        configuration = load_signing_configuration()
    return generate_receipt(
        payload=_pilot_payload(),
        private_key=configuration.private_key_hex,
        key_id=configuration.key_id,
    )


@router.post("/payment/submit")
def pilot_payment_submit() -> dict[str, Any]:
    configuration = load_signing_configuration()
    receipt = _generate_pilot_receipt(configuration)
    public_key_hex = configuration.public_key_hex
    verification = _verify.verify(
        receipt=receipt,
        public_key_hex=public_key_hex,
    )

    return {
        "status": "pending_review",
        "decision": "REQUIRE_REVIEW",
        "reason_codes": list(_REASON_CODES),
        "action_executed": False,
        "governance_payload": _pilot_payload(),
        "adr_receipt": receipt,
        "verification": {
            "status": verification.status,
            "code": verification.code.value,
            "offline_compatible": True,
        },
        "public_key_hex": public_key_hex,
    }


class PilotVerifyRequest(BaseModel):
    receipt: dict[str, Any] | None = None
    public_key_hex: str | None = None


@router.post("/payment/verify")
def pilot_payment_verify(request: PilotVerifyRequest) -> dict[str, Any]:
    configuration: SigningConfiguration | None = None
    if request.receipt is None:
        configuration = load_signing_configuration()
        receipt = _generate_pilot_receipt(configuration)
    else:
        receipt = request.receipt

    if request.public_key_hex is None:
        if configuration is None:
            configuration = load_signing_configuration()
        public_key_hex = configuration.public_key_hex
    else:
        public_key_hex = request.public_key_hex

    result = _verify.verify(receipt=receipt, public_key_hex=public_key_hex)

    return {
        "status": result.status,
        "code": result.code.value,
        "checks": {
            "hash_verified": result.hash_match is True,
            "signature_verified": result.signature_valid is True,
            "receipt_portable": True,
            "offline_compatible": True,
        },
        "message": "This decision is independently verifiable.",
    }

"""
fortix_sdk — thin Python client for the FortiX v1 HTTP API.

This package intentionally wraps only the current primary integration surfaces:

  - POST /action/submit
  - POST /verify/receipt

It does not re-implement policy evaluation or ADR verification logic locally.
"""
from .client import FortiXClient
from .models import (
    ADRAlgorithm,
    ADRReceipt,
    ActionExecution,
    ActionRequest,
    GatewayPolicyResult,
    SubmitActionResponse,
    VerificationExpertView,
    VerificationInstitutionalView,
    VerificationResponse,
)

__all__ = [
    "ADRAlgorithm",
    "ADRReceipt",
    "ActionExecution",
    "ActionRequest",
    "FortiXClient",
    "GatewayPolicyResult",
    "SubmitActionResponse",
    "VerificationExpertView",
    "VerificationInstitutionalView",
    "VerificationResponse",
]

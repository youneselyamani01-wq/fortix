from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class ADRAlgorithm(BaseModel):
    hash: str
    signature: str


class ADRReceipt(BaseModel):
    version: str
    payload: dict[str, Any]
    hash: str
    signature: str
    algorithm: ADRAlgorithm
    key_id: str


class ActionRequest(BaseModel):
    action_id: str = Field(..., min_length=1)
    actor_id: str = Field(..., min_length=1)
    action: str = Field(..., min_length=1)
    target: str = Field(..., min_length=1)
    timestamp: str = Field(..., min_length=1)
    payload: dict[str, Any] = Field(default_factory=dict)
    metadata: dict[str, Any] = Field(default_factory=dict)


class GatewayPolicyResult(BaseModel):
    decision: Literal["ALLOW", "DENY", "REVIEW"]
    reason: str


class ActionExecution(BaseModel):
    action_id: str
    result: str


class SubmitActionResponse(BaseModel):
    mode: str
    gateway: str
    policy: GatewayPolicyResult
    status: Literal[
        "executed",
        "pending_review",
        "blocked_by_replay_protection",
        "blocked_by_idempotency_guard",
        "blocked_by_policy",
    ]
    executed: bool
    adr_receipt: ADRReceipt
    execution: ActionExecution | None = None


class VerificationInstitutionalView(BaseModel):
    verdict: str
    explanation: str


class VerificationExpertView(BaseModel):
    status: str
    code: str
    key_id: str | None
    algorithm_hash: str | None
    algorithm_signature: str | None
    payload_field_count: int | None
    hash_verified: bool | None
    signature_verified: bool | None


class VerificationResponse(BaseModel):
    status: Literal["VALID", "INVALID", "UNVERIFIABLE"]
    code: str
    institutional: VerificationInstitutionalView
    expert: VerificationExpertView


class VerifyReceiptRequest(BaseModel):
    receipt: ADRReceipt
    public_key_hex: str = Field(..., min_length=1)

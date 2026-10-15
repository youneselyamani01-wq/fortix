from typing import Any

from pydantic import BaseModel


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


class ADRVerifyRequest(BaseModel):
    receipt: ADRReceipt
    public_key_hex: str

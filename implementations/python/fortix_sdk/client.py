from __future__ import annotations

from typing import Any, Mapping

import httpx

from .models import (
    ADRReceipt,
    ActionRequest,
    SubmitActionResponse,
    VerificationResponse,
    VerifyReceiptRequest,
)


class FortiXClient:
    """
    Thin transport wrapper around the FortiX v1 HTTP API.

    This client defaults to the current primary surfaces:

      - POST /action/submit
      - POST /verify/receipt
    """

    def __init__(
        self,
        base_url: str,
        *,
        timeout: float = 10.0,
        http_client: httpx.Client | None = None,
    ) -> None:
        self._owns_client = http_client is None
        self._client = http_client or httpx.Client(
            base_url=base_url.rstrip("/"),
            timeout=timeout,
        )

    def close(self) -> None:
        if self._owns_client:
            self._client.close()

    def __enter__(self) -> FortiXClient:
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        self.close()

    def submit_action(
        self,
        action: ActionRequest | Mapping[str, Any],
    ) -> SubmitActionResponse:
        """
        Submit a governed action through the authoritative runtime path.
        """
        request = _to_action_request(action)
        response = self._client.post(
            "/action/submit",
            json=request.model_dump(mode="json"),
        )
        response.raise_for_status()
        return SubmitActionResponse.model_validate(response.json())

    def verify_receipt(
        self,
        receipt: ADRReceipt | Mapping[str, Any],
        public_key_hex: str,
    ) -> VerificationResponse:
        """
        Verify a receipt through the primary v1 verification endpoint.
        """
        request = VerifyReceiptRequest(
            receipt=_to_receipt(receipt),
            public_key_hex=public_key_hex,
        )
        response = self._client.post(
            "/verify/receipt",
            json=request.model_dump(mode="json"),
        )
        response.raise_for_status()
        return VerificationResponse.model_validate(response.json())


def _to_action_request(action: ActionRequest | Mapping[str, Any]) -> ActionRequest:
    if isinstance(action, ActionRequest):
        return action
    return ActionRequest.model_validate(dict(action))


def _to_receipt(receipt: ADRReceipt | Mapping[str, Any]) -> ADRReceipt:
    if isinstance(receipt, ADRReceipt):
        return receipt
    return ADRReceipt.model_validate(dict(receipt))

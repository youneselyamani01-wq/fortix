from __future__ import annotations

import json

import httpx

from fortix_sdk import ActionRequest, FortiXClient


def test_submit_action_uses_authoritative_runtime_path():
    seen: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["method"] = request.method
        seen["path"] = request.url.path
        seen["json"] = json.loads(request.content.decode("utf-8"))
        return httpx.Response(
            200,
            json={
                "mode": "submit",
                "gateway": "action_gateway",
                "policy": {"decision": "ALLOW", "reason": "ok"},
                "status": "executed",
                "executed": True,
                "execution": {
                    "action_id": "txn-sdk-001",
                    "result": "completed",
                },
                "adr_receipt": {
                    "version": "1.0",
                    "payload": {"action_id": "txn-sdk-001"},
                    "hash": "a" * 64,
                    "signature": "b" * 128,
                    "algorithm": {
                        "hash": "BLAKE3",
                        "signature": "Ed25519",
                    },
                    "key_id": "demo-key-001",
                },
            },
        )

    with httpx.Client(
        base_url="https://fortix.test",
        transport=httpx.MockTransport(handler),
    ) as http_client:
        sdk = FortiXClient("https://unused.test", http_client=http_client)
        result = sdk.submit_action(
            ActionRequest(
                action_id="txn-sdk-001",
                actor_id="agent-finops-01",
                action="approve_transfer",
                target="internal",
                timestamp="2026-04-11T09:00:00Z",
                payload={"amount": 12000},
                metadata={"risk": "low"},
            )
        )

    assert seen["method"] == "POST"
    assert seen["path"] == "/action/submit"
    assert seen["json"] == {
        "action_id": "txn-sdk-001",
        "actor_id": "agent-finops-01",
        "action": "approve_transfer",
        "target": "internal",
        "timestamp": "2026-04-11T09:00:00Z",
        "payload": {"amount": 12000},
        "metadata": {"risk": "low"},
    }
    assert result.policy.decision == "ALLOW"
    assert result.status == "executed"
    assert result.executed is True


def test_verify_receipt_uses_primary_verification_surface():
    seen: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["method"] = request.method
        seen["path"] = request.url.path
        seen["json"] = json.loads(request.content.decode("utf-8"))
        return httpx.Response(
            200,
            json={
                "status": "VALID",
                "code": "valid",
                "institutional": {
                    "verdict": "Receipt verified.",
                    "explanation": "The receipt is intact and the signature verifies.",
                },
                "expert": {
                    "status": "VALID",
                    "code": "valid",
                    "key_id": "demo-key-001",
                    "algorithm_hash": "BLAKE3",
                    "algorithm_signature": "Ed25519",
                    "payload_field_count": 1,
                    "hash_verified": True,
                    "signature_verified": True,
                },
            },
        )

    receipt = {
        "version": "1.0",
        "payload": {"action_id": "txn-sdk-001"},
        "hash": "a" * 64,
        "signature": "b" * 128,
        "algorithm": {
            "hash": "BLAKE3",
            "signature": "Ed25519",
        },
        "key_id": "demo-key-001",
    }

    with httpx.Client(
        base_url="https://fortix.test",
        transport=httpx.MockTransport(handler),
    ) as http_client:
        sdk = FortiXClient("https://unused.test", http_client=http_client)
        result = sdk.verify_receipt(receipt, public_key_hex="c" * 64)

    assert seen["method"] == "POST"
    assert seen["path"] == "/verify/receipt"
    assert seen["json"] == {
        "receipt": receipt,
        "public_key_hex": "c" * 64,
    }
    assert result.status == "VALID"
    assert result.code == "valid"
    assert result.expert.hash_verified is True
    assert result.expert.signature_verified is True

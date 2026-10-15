"""
Tests for POST /verify/receipt — endpoint level.

Coverage:
  - 200 on valid receipt with correct schema
  - VALID verdict on genuinely signed receipt (end-to-end)
  - INVALID/HASH_MISMATCH when payload tampered
  - INVALID/SIGNATURE_INVALID when wrong key supplied
  - INVALID/SCHEMA_VIOLATION when required field missing from receipt
  - UNVERIFIABLE/KEY_DECODE_ERROR when public key is bad hex
  - Response schema: status, code, institutional (verdict + explanation), expert (all fields)
  - institutional.verdict and explanation are non-empty strings
  - expert fields are present and typed correctly
  - 422 on missing public_key_hex (FastAPI validation)
  - /adr/verify route regression: still returns {valid: bool}
  - /verify/receipt and /adr/verify do not collide
"""
from __future__ import annotations

import copy
import os

import pytest
from fastapi.testclient import TestClient
from nacl.signing import SigningKey

from app.core.adr_generator import generate_receipt
from app.main import app
from app.verify.models import VerifyReasonCode


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="module")
def key_pair():
    sk = SigningKey.generate()
    return sk.encode().hex(), sk.verify_key.encode().hex()


@pytest.fixture(scope="module")
def signed_receipt(key_pair):
    private_key_hex, _ = key_pair
    payload = {
        "action": "wire_transfer",
        "amount": 500,
        "currency": "EUR",
        "timestamp": "2024-06-01T09:00:00+00:00",
    }
    return generate_receipt(payload, private_key_hex, "verify-test-key")


def _body(receipt: dict, public_key_hex: str) -> dict:
    return {"receipt": receipt, "public_key_hex": public_key_hex}


# ---------------------------------------------------------------------------
# VALID path
# ---------------------------------------------------------------------------

class TestVerifyReceiptValid:
    def test_valid_returns_200(self, client, signed_receipt, key_pair):
        _, pub = key_pair
        resp = client.post("/verify/receipt", json=_body(signed_receipt, pub))
        assert resp.status_code == 200

    def test_valid_status(self, client, signed_receipt, key_pair):
        _, pub = key_pair
        data = client.post("/verify/receipt", json=_body(signed_receipt, pub)).json()
        assert data["status"] == "VALID"
        assert data["code"] == VerifyReasonCode.VALID.value

    def test_valid_institutional_verdict(self, client, signed_receipt, key_pair):
        _, pub = key_pair
        data = client.post("/verify/receipt", json=_body(signed_receipt, pub)).json()
        inst = data["institutional"]
        assert "verified" in inst["verdict"].lower()
        assert len(inst["explanation"]) > 20

    def test_valid_expert_fields(self, client, signed_receipt, key_pair):
        _, pub = key_pair
        data = client.post("/verify/receipt", json=_body(signed_receipt, pub)).json()
        exp = data["expert"]
        assert exp["status"] == "VALID"
        assert exp["code"] == "valid"
        assert exp["key_id"] == "verify-test-key"
        assert exp["algorithm_hash"] == "BLAKE3"
        assert exp["algorithm_signature"] == "Ed25519"
        assert exp["hash_verified"] is True
        assert exp["signature_verified"] is True
        assert exp["payload_field_count"] == 4


# ---------------------------------------------------------------------------
# INVALID paths
# ---------------------------------------------------------------------------

class TestVerifyReceiptInvalid:
    def test_hash_mismatch(self, client, signed_receipt, key_pair):
        _, pub = key_pair
        tampered = copy.deepcopy(signed_receipt)
        tampered["payload"]["amount"] = 1
        data = client.post("/verify/receipt", json=_body(tampered, pub)).json()
        assert data["status"] == "INVALID"
        assert data["code"] == VerifyReasonCode.HASH_MISMATCH.value

    def test_hash_mismatch_expert_flags(self, client, signed_receipt, key_pair):
        _, pub = key_pair
        tampered = copy.deepcopy(signed_receipt)
        tampered["payload"]["currency"] = "USD"
        data = client.post("/verify/receipt", json=_body(tampered, pub)).json()
        assert data["expert"]["hash_verified"] is False
        assert data["expert"]["signature_verified"] is None

    def test_wrong_public_key(self, client, signed_receipt):
        other_pub = SigningKey.generate().verify_key.encode().hex()
        data = client.post("/verify/receipt", json=_body(signed_receipt, other_pub)).json()
        assert data["status"] == "INVALID"
        assert data["code"] == VerifyReasonCode.SIGNATURE_INVALID.value

    def test_wrong_public_key_hash_match_true(self, client, signed_receipt):
        other_pub = SigningKey.generate().verify_key.encode().hex()
        data = client.post("/verify/receipt", json=_body(signed_receipt, other_pub)).json()
        assert data["expert"]["hash_verified"] is True
        assert data["expert"]["signature_verified"] is False

    def test_empty_key_id_is_schema_violation(self, client, signed_receipt, key_pair):
        # Empty key_id passes ADRReceipt schema (str, no min_length) but fails
        # the service-level check — key_id == "" is rejected as SCHEMA_VIOLATION.
        _, pub = key_pair
        bad = copy.deepcopy(signed_receipt)
        bad["key_id"] = ""
        data = client.post("/verify/receipt", json=_body(bad, pub)).json()
        assert data["status"] == "INVALID"
        assert data["code"] == VerifyReasonCode.SCHEMA_VIOLATION.value

    def test_missing_receipt_required_field_is_schema_violation(self, client, signed_receipt, key_pair):
        # Missing receipt fields now flow through the verification service so the
        # MCP boundary can return a structured schema_violation outcome.
        _, pub = key_pair
        bad = copy.deepcopy(signed_receipt)
        del bad["key_id"]
        data = client.post("/verify/receipt", json=_body(bad, pub)).json()
        assert data["status"] == "INVALID"
        assert data["code"] == VerifyReasonCode.SCHEMA_VIOLATION.value

    def test_invalid_institutional_explanation_non_empty(self, client, signed_receipt, key_pair):
        _, pub = key_pair
        tampered = copy.deepcopy(signed_receipt)
        tampered["payload"]["amount"] = 9999
        data = client.post("/verify/receipt", json=_body(tampered, pub)).json()
        assert len(data["institutional"]["explanation"]) > 10

    def test_invalid_version(self, client, signed_receipt, key_pair):
        _, pub = key_pair
        bad = copy.deepcopy(signed_receipt)
        bad["version"] = "99.0"
        data = client.post("/verify/receipt", json=_body(bad, pub)).json()
        assert data["status"] == "INVALID"
        assert data["code"] == VerifyReasonCode.UNSUPPORTED_VERSION.value


# ---------------------------------------------------------------------------
# UNVERIFIABLE paths
# ---------------------------------------------------------------------------

class TestVerifyReceiptUnverifiable:
    def test_bad_hex_public_key(self, client, signed_receipt):
        data = client.post(
            "/verify/receipt",
            json=_body(signed_receipt, "not-hex-at-all"),
        ).json()
        assert data["status"] == "UNVERIFIABLE"
        assert data["code"] == VerifyReasonCode.KEY_DECODE_ERROR.value

    def test_unverifiable_institutional_explanation_non_empty(self, client, signed_receipt):
        data = client.post(
            "/verify/receipt",
            json=_body(signed_receipt, "zz"),
        ).json()
        assert len(data["institutional"]["explanation"]) > 10


# ---------------------------------------------------------------------------
# Validation (FastAPI schema checks)
# ---------------------------------------------------------------------------

class TestVerifyReceiptValidation:
    def test_missing_public_key_hex_returns_422(self, client, signed_receipt):
        resp = client.post("/verify/receipt", json={"receipt": signed_receipt})
        assert resp.status_code == 422

    def test_blank_public_key_hex_returns_422(self, client, signed_receipt):
        resp = client.post(
            "/verify/receipt",
            json={"receipt": signed_receipt, "public_key_hex": ""},
        )
        assert resp.status_code == 422

    def test_missing_receipt_returns_422(self, client, key_pair):
        _, pub = key_pair
        resp = client.post("/verify/receipt", json={"public_key_hex": pub})
        assert resp.status_code == 422


# ---------------------------------------------------------------------------
# Response schema completeness
# ---------------------------------------------------------------------------

class TestResponseSchema:
    def test_all_top_level_keys_present(self, client, signed_receipt, key_pair):
        _, pub = key_pair
        data = client.post("/verify/receipt", json=_body(signed_receipt, pub)).json()
        for key in ("status", "code", "institutional", "expert"):
            assert key in data, f"missing key: {key}"

    def test_institutional_has_verdict_and_explanation(self, client, signed_receipt, key_pair):
        _, pub = key_pair
        data = client.post("/verify/receipt", json=_body(signed_receipt, pub)).json()
        assert "verdict" in data["institutional"]
        assert "explanation" in data["institutional"]

    def test_expert_has_all_fields(self, client, signed_receipt, key_pair):
        _, pub = key_pair
        data = client.post("/verify/receipt", json=_body(signed_receipt, pub)).json()
        exp = data["expert"]
        for field in (
            "status", "code", "key_id", "algorithm_hash",
            "algorithm_signature", "payload_field_count",
            "hash_verified", "signature_verified",
        ):
            assert field in exp, f"expert missing field: {field}"


# ---------------------------------------------------------------------------
# Regression: existing /adr/verify route is unchanged
# ---------------------------------------------------------------------------

class TestADRVerifyRegression:
    def test_adr_verify_still_returns_valid_true(self, client, signed_receipt, key_pair):
        _, pub = key_pair
        resp = client.post("/adr/verify", json=_body(signed_receipt, pub))
        assert resp.status_code == 200
        assert resp.json() == {"valid": True}

    def test_adr_verify_still_returns_valid_false(self, client, signed_receipt):
        other_pub = SigningKey.generate().verify_key.encode().hex()
        resp = client.post("/adr/verify", json=_body(signed_receipt, other_pub))
        assert resp.status_code == 200
        assert resp.json() == {"valid": False}

    def test_verify_receipt_does_not_collide_with_adr_verify(
        self, client, signed_receipt, key_pair
    ):
        _, pub = key_pair
        adr_resp = client.post("/adr/verify", json=_body(signed_receipt, pub))
        new_resp = client.post("/verify/receipt", json=_body(signed_receipt, pub))
        # Both routes exist and respond distinctly
        assert adr_resp.status_code == 200
        assert new_resp.status_code == 200
        assert "valid" in adr_resp.json()
        assert "institutional" in new_resp.json()

    def test_e2e_submit_then_verify_receipt(self, client):
        """
        Submit action → extract receipt → verify via /verify/receipt.
        Confirms the new endpoint works with live gateway-generated receipts.
        """
        from tests.integration.fixtures_demo import ALLOW_SUBMIT

        submit_resp = client.post("/action/submit", json=ALLOW_SUBMIT)
        assert submit_resp.status_code == 200
        receipt = submit_resp.json()["adr_receipt"]

        config = client.get("/demo/config").json()
        pub = config["public_key_hex"]

        verify_resp = client.post("/verify/receipt", json=_body(receipt, pub))
        assert verify_resp.status_code == 200
        data = verify_resp.json()
        assert data["status"] == "VALID"
        assert data["code"] == "valid"
        assert data["expert"]["hash_verified"] is True
        assert data["expert"]["signature_verified"] is True

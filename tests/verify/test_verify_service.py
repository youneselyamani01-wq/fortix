"""
Tests for VerifyService — unit level.

Coverage:
  - VALID path: correctly signed receipt
  - INVALID/HASH_MISMATCH: payload tampered after signing
  - INVALID/SIGNATURE_INVALID: wrong key used to verify
  - INVALID/SCHEMA_VIOLATION: missing fields, wrong types, empty key_id
  - INVALID/UNSUPPORTED_VERSION: wrong version string
  - INVALID/UNSUPPORTED_ALGORITHM: unknown algorithm fields
  - INVALID/MALFORMED_RECEIPT: non-dict input
  - UNVERIFIABLE/KEY_DECODE_ERROR: public key is not valid hex
  - UNVERIFIABLE/INTERNAL_ERROR: exception in verify_adr (fail-closed)
  - Metadata capture: key_id, algorithm fields, payload_field_count
  - hash_match / signature_valid flags on each path
  - Result is JSON-serialisable
"""
from __future__ import annotations

import binascii
import copy
import json

import pytest
from nacl.signing import SigningKey

from app.core.adr_generator import generate_receipt
from app.verify.models import VerifyReasonCode
from app.verify.service import VerifyService


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def key_pair():
    sk = SigningKey.generate()
    return sk.encode().hex(), sk.verify_key.encode().hex()


@pytest.fixture(scope="module")
def valid_receipt(key_pair):
    private_key_hex, _ = key_pair
    payload = {
        "action": "payment",
        "amount": 100,
        "currency": "EUR",
        "timestamp": "2024-01-15T10:00:00+00:00",
    }
    return generate_receipt(payload, private_key_hex, "test-key-001")


@pytest.fixture(scope="module")
def svc():
    return VerifyService()


# ---------------------------------------------------------------------------
# VALID path
# ---------------------------------------------------------------------------

class TestValidPath:
    def test_valid_receipt_returns_valid(self, svc, valid_receipt, key_pair):
        _, public_key_hex = key_pair
        result = svc.verify(valid_receipt, public_key_hex)
        assert result.status == "VALID"
        assert result.code == VerifyReasonCode.VALID

    def test_valid_result_hash_match_true(self, svc, valid_receipt, key_pair):
        _, public_key_hex = key_pair
        result = svc.verify(valid_receipt, public_key_hex)
        assert result.hash_match is True

    def test_valid_result_signature_valid_true(self, svc, valid_receipt, key_pair):
        _, public_key_hex = key_pair
        result = svc.verify(valid_receipt, public_key_hex)
        assert result.signature_valid is True

    def test_valid_result_captures_key_id(self, svc, valid_receipt, key_pair):
        _, public_key_hex = key_pair
        result = svc.verify(valid_receipt, public_key_hex)
        assert result.key_id == "test-key-001"

    def test_valid_result_captures_algorithm(self, svc, valid_receipt, key_pair):
        _, public_key_hex = key_pair
        result = svc.verify(valid_receipt, public_key_hex)
        assert result.algorithm_hash == "BLAKE3"
        assert result.algorithm_signature == "Ed25519"

    def test_valid_result_captures_payload_field_count(self, svc, valid_receipt, key_pair):
        _, public_key_hex = key_pair
        result = svc.verify(valid_receipt, public_key_hex)
        assert result.payload_field_count == 4  # action, amount, currency, timestamp

    def test_valid_result_is_json_serialisable(self, svc, valid_receipt, key_pair):
        _, public_key_hex = key_pair
        result = svc.verify(valid_receipt, public_key_hex)
        data = json.loads(result.model_dump_json())
        assert data["status"] == "VALID"
        assert data["code"] == "valid"


# ---------------------------------------------------------------------------
# INVALID — hash mismatch
# ---------------------------------------------------------------------------

class TestHashMismatch:
    def test_tampered_payload_is_invalid(self, svc, valid_receipt, key_pair):
        _, public_key_hex = key_pair
        tampered = copy.deepcopy(valid_receipt)
        tampered["payload"]["amount"] = 9999  # change content without re-signing
        result = svc.verify(tampered, public_key_hex)
        assert result.status == "INVALID"
        assert result.code == VerifyReasonCode.HASH_MISMATCH

    def test_hash_mismatch_hash_match_false(self, svc, valid_receipt, key_pair):
        _, public_key_hex = key_pair
        tampered = copy.deepcopy(valid_receipt)
        tampered["payload"]["currency"] = "USD"
        result = svc.verify(tampered, public_key_hex)
        assert result.hash_match is False
        assert result.signature_valid is None  # not reached


# ---------------------------------------------------------------------------
# INVALID — signature invalid
# ---------------------------------------------------------------------------

class TestSignatureInvalid:
    def test_wrong_public_key_is_invalid(self, svc, valid_receipt):
        # Generate a different key pair — signature won't match
        other_sk = SigningKey.generate()
        other_public_key_hex = other_sk.verify_key.encode().hex()
        result = svc.verify(valid_receipt, other_public_key_hex)
        assert result.status == "INVALID"
        assert result.code == VerifyReasonCode.SIGNATURE_INVALID

    def test_wrong_public_key_hash_match_true(self, svc, valid_receipt):
        # The hash matches (payload is untampered) but sig doesn't
        other_sk = SigningKey.generate()
        other_pub = other_sk.verify_key.encode().hex()
        result = svc.verify(valid_receipt, other_pub)
        assert result.hash_match is True
        assert result.signature_valid is False

    def test_corrupted_signature_is_invalid(self, svc, valid_receipt, key_pair):
        _, public_key_hex = key_pair
        corrupted = copy.deepcopy(valid_receipt)
        # Flip first two hex chars
        corrupted["signature"] = "ff" + corrupted["signature"][2:]
        result = svc.verify(corrupted, public_key_hex)
        assert result.status == "INVALID"
        assert result.code == VerifyReasonCode.SIGNATURE_INVALID

    def test_bad_signature_hex_is_invalid(self, svc, valid_receipt, key_pair):
        _, public_key_hex = key_pair
        corrupted = copy.deepcopy(valid_receipt)
        corrupted["signature"] = "not-valid-hex!!"
        result = svc.verify(corrupted, public_key_hex)
        assert result.status == "INVALID"
        assert result.code == VerifyReasonCode.SIGNATURE_INVALID


# ---------------------------------------------------------------------------
# INVALID — schema violations
# ---------------------------------------------------------------------------

class TestSchemaViolation:
    def test_extra_top_level_field(self, svc, valid_receipt, key_pair):
        _, public_key_hex = key_pair
        bad = copy.deepcopy(valid_receipt)
        bad["injected"] = "evil"
        result = svc.verify(bad, public_key_hex)
        assert result.status == "INVALID"
        assert result.code == VerifyReasonCode.SCHEMA_VIOLATION

    def test_missing_top_level_field(self, svc, valid_receipt, key_pair):
        _, public_key_hex = key_pair
        bad = copy.deepcopy(valid_receipt)
        del bad["key_id"]
        result = svc.verify(bad, public_key_hex)
        assert result.status == "INVALID"
        assert result.code == VerifyReasonCode.SCHEMA_VIOLATION

    def test_payload_not_dict(self, svc, valid_receipt, key_pair):
        _, public_key_hex = key_pair
        bad = copy.deepcopy(valid_receipt)
        bad["payload"] = "not a dict"
        result = svc.verify(bad, public_key_hex)
        assert result.status == "INVALID"
        assert result.code == VerifyReasonCode.SCHEMA_VIOLATION

    def test_empty_key_id(self, svc, valid_receipt, key_pair):
        _, public_key_hex = key_pair
        bad = copy.deepcopy(valid_receipt)
        bad["key_id"] = ""
        result = svc.verify(bad, public_key_hex)
        assert result.status == "INVALID"
        assert result.code == VerifyReasonCode.SCHEMA_VIOLATION

    def test_algorithm_not_dict(self, svc, valid_receipt, key_pair):
        _, public_key_hex = key_pair
        bad = copy.deepcopy(valid_receipt)
        bad["algorithm"] = "BLAKE3/Ed25519"
        result = svc.verify(bad, public_key_hex)
        assert result.status == "INVALID"
        assert result.code == VerifyReasonCode.SCHEMA_VIOLATION


# ---------------------------------------------------------------------------
# INVALID — version / algorithm
# ---------------------------------------------------------------------------

class TestVersionAndAlgorithm:
    def test_wrong_version(self, svc, valid_receipt, key_pair):
        _, public_key_hex = key_pair
        bad = copy.deepcopy(valid_receipt)
        bad["version"] = "2.0"
        result = svc.verify(bad, public_key_hex)
        assert result.status == "INVALID"
        assert result.code == VerifyReasonCode.UNSUPPORTED_VERSION

    def test_wrong_hash_algorithm(self, svc, valid_receipt, key_pair):
        _, public_key_hex = key_pair
        bad = copy.deepcopy(valid_receipt)
        bad["algorithm"] = {"hash": "SHA256", "signature": "Ed25519"}
        result = svc.verify(bad, public_key_hex)
        assert result.status == "INVALID"
        assert result.code == VerifyReasonCode.UNSUPPORTED_ALGORITHM

    def test_wrong_signature_algorithm(self, svc, valid_receipt, key_pair):
        _, public_key_hex = key_pair
        bad = copy.deepcopy(valid_receipt)
        bad["algorithm"] = {"hash": "BLAKE3", "signature": "RSA"}
        result = svc.verify(bad, public_key_hex)
        assert result.status == "INVALID"
        assert result.code == VerifyReasonCode.UNSUPPORTED_ALGORITHM


# ---------------------------------------------------------------------------
# INVALID — malformed receipt
# ---------------------------------------------------------------------------

class TestMalformedReceipt:
    def test_receipt_as_string(self, svc, key_pair):
        _, public_key_hex = key_pair
        result = svc.verify("not a dict", public_key_hex)
        assert result.status == "INVALID"
        assert result.code == VerifyReasonCode.MALFORMED_RECEIPT

    def test_receipt_as_none(self, svc, key_pair):
        _, public_key_hex = key_pair
        result = svc.verify(None, public_key_hex)
        assert result.status == "INVALID"
        assert result.code == VerifyReasonCode.MALFORMED_RECEIPT

    def test_receipt_as_list(self, svc, key_pair):
        _, public_key_hex = key_pair
        result = svc.verify([], public_key_hex)
        assert result.status == "INVALID"
        assert result.code == VerifyReasonCode.MALFORMED_RECEIPT


# ---------------------------------------------------------------------------
# UNVERIFIABLE — key decode error
# ---------------------------------------------------------------------------

class TestKeyDecodeError:
    def test_non_hex_public_key(self, svc, valid_receipt):
        result = svc.verify(valid_receipt, "not-hex-at-all!")
        assert result.status == "UNVERIFIABLE"
        assert result.code == VerifyReasonCode.KEY_DECODE_ERROR

    def test_short_public_key(self, svc, valid_receipt):
        result = svc.verify(valid_receipt, "deadbeef")
        # Too short for Ed25519; nacl raises on VerifyKey construction
        assert result.status == "UNVERIFIABLE"
        assert result.code == VerifyReasonCode.KEY_DECODE_ERROR

    def test_key_decode_error_hash_match_true(self, svc, valid_receipt):
        # Payload is untouched so hash should match before key decode fails
        result = svc.verify(valid_receipt, "not-hex!")
        assert result.hash_match is True
        assert result.signature_valid is None


# ---------------------------------------------------------------------------
# UNVERIFIABLE — fail-closed (internal exception)
# ---------------------------------------------------------------------------

class TestFailClosed:
    def test_exception_in_verify_adr_produces_unverifiable(
        self, svc, valid_receipt, key_pair, monkeypatch
    ):
        """Patch verify_adr to raise unexpectedly — service must fail closed."""
        from app.verify import service as svc_module

        def boom(receipt, public_key_hex):
            raise RuntimeError("simulated internal failure")

        monkeypatch.setattr(svc_module, "verify_adr", boom)
        _, public_key_hex = key_pair
        result = svc.verify(valid_receipt, public_key_hex)
        assert result.status == "UNVERIFIABLE"
        assert result.code == VerifyReasonCode.INTERNAL_ERROR

    def test_fail_closed_result_is_json_serialisable(
        self, svc, valid_receipt, key_pair, monkeypatch
    ):
        from app.verify import service as svc_module

        monkeypatch.setattr(svc_module, "verify_adr", lambda *a: (_ for _ in ()).throw(RuntimeError()))
        _, public_key_hex = key_pair
        result = svc.verify(valid_receipt, public_key_hex)
        json.dumps(result.model_dump(mode="json"))  # must not raise

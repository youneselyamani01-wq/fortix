"""
Tests for non-finite number rejection in the ADR v1 canonicalizer.

NaN and Infinity are not representable in standard JSON, so they cannot be
stored in normative vector files. These cases are tested programmatically.

Per ADR-SPEC-v1 Section 5:
  "non-finite numeric values (NaN, Infinity, -Infinity) MUST be rejected"
"""
import pytest

from app.core.canonicalizer import canonicalize


def test_nan_in_payload_rejected():
    with pytest.raises(ValueError):
        canonicalize({"value": float("nan")})


def test_positive_infinity_in_payload_rejected():
    with pytest.raises(ValueError):
        canonicalize({"value": float("inf")})


def test_negative_infinity_in_payload_rejected():
    with pytest.raises(ValueError):
        canonicalize({"value": float("-inf")})


def test_nan_in_nested_payload_rejected():
    with pytest.raises(ValueError):
        canonicalize({"outer": {"inner": float("nan")}})


def test_nan_in_list_rejected():
    with pytest.raises(ValueError):
        canonicalize({"values": [1, float("nan"), 3]})


def test_finite_numbers_accepted():
    result = canonicalize({"amount": 1.5, "count": 42, "ratio": 0.1})
    assert result is not None
    assert b"1.5" in result
    assert b"42" in result

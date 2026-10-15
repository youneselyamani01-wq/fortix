"""
Standalone tests for implementations/python/adr.

Test key (seed 0xfe * 32):
  private : fefefefefefefefefefefefefefefefefefefefefefefefefefefefefefefefe  (64 hex chars)
  public  : ca987f7a6cd863424641d4500dc7deba9782533ee071c5f00bc300bc85452437

Wrong key (seed 0xfd * 32):
  public  : e63cc9f1bfea63e045538d59abdabe2c1aee0557daf2894bf3115d177d16506c
"""
import json
import copy
import pytest

import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))

from adr import canonicalize, hash_canonical, sign_receipt, generate_receipt, verify_receipt

# ---------------------------------------------------------------------------
# Test keys
# ---------------------------------------------------------------------------
SK = "fe" * 32
PK = "ca987f7a6cd863424641d4500dc7deba9782533ee071c5f00bc300bc85452437"
WRONG_PK = "e63cc9f1bfea63e045538d59abdabe2c1aee0557daf2894bf3115d177d16506c"
KEY_ID = "test-key-1"

PAYLOAD = {
    "action_id": "test-001",
    "actor":     "alice",
    "amount":    100,
    "currency":  "USD",
}


# ---------------------------------------------------------------------------
# canonicalize
# ---------------------------------------------------------------------------
class TestCanonicalize:
    def test_sort_keys(self):
        out = canonicalize({"b": 2, "a": 1})
        assert out == b'{"a":1,"b":2}'

    def test_no_spaces(self):
        out = canonicalize({"k": "v"})
        assert b" " not in out

    def test_utf8_passthrough(self):
        out = canonicalize({"msg": "héllo"})
        assert "héllo".encode("utf-8") in out

    def test_nested(self):
        out = canonicalize({"z": {"b": 2, "a": 1}, "a": 0})
        assert out == b'{"a":0,"z":{"a":1,"b":2}}'

    def test_rejects_non_dict(self):
        with pytest.raises(TypeError):
            canonicalize([1, 2, 3])

    def test_rejects_nan(self):
        import math
        with pytest.raises((ValueError, TypeError)):
            canonicalize({"x": math.nan})


# ---------------------------------------------------------------------------
# hash_canonical
# ---------------------------------------------------------------------------
class TestHashCanonical:
    def test_known_vector(self):
        # Canonical of PAYLOAD must produce a stable hash
        data = canonicalize(PAYLOAD)
        h = hash_canonical(data)
        assert len(h) == 64
        assert all(c in "0123456789abcdef" for c in h)

    def test_deterministic(self):
        data = canonicalize(PAYLOAD)
        assert hash_canonical(data) == hash_canonical(data)

    def test_different_payloads(self):
        h1 = hash_canonical(canonicalize({"a": 1}))
        h2 = hash_canonical(canonicalize({"a": 2}))
        assert h1 != h2


# ---------------------------------------------------------------------------
# generate_receipt + verify_receipt round-trip
# ---------------------------------------------------------------------------
class TestRoundTrip:
    def test_basic_allow(self):
        r = generate_receipt(PAYLOAD, SK, KEY_ID)
        assert verify_receipt(r, PK)

    def test_receipt_has_all_fields(self):
        r = generate_receipt(PAYLOAD, SK, KEY_ID)
        assert set(r.keys()) == {"version", "payload", "hash", "signature", "algorithm", "key_id"}
        assert set(r["algorithm"].keys()) == {"hash", "signature"}
        assert r["version"]              == "1.0"
        assert r["algorithm"]["hash"]    == "BLAKE3"
        assert r["algorithm"]["signature"] == "Ed25519"
        assert r["key_id"]               == KEY_ID

    def test_wrong_public_key(self):
        r = generate_receipt(PAYLOAD, SK, KEY_ID)
        assert not verify_receipt(r, WRONG_PK)

    def test_tampered_hash(self):
        r = generate_receipt(PAYLOAD, SK, KEY_ID)
        r2 = copy.deepcopy(r)
        r2["hash"] = "00" * 32
        assert not verify_receipt(r2, PK)

    def test_tampered_payload_field(self):
        r = generate_receipt(PAYLOAD, SK, KEY_ID)
        r2 = copy.deepcopy(r)
        r2["payload"]["amount"] = 999
        assert not verify_receipt(r2, PK)

    def test_extra_top_level_field(self):
        r = generate_receipt(PAYLOAD, SK, KEY_ID)
        r["extra"] = "evil"
        assert not verify_receipt(r, PK)

    def test_missing_version(self):
        r = generate_receipt(PAYLOAD, SK, KEY_ID)
        del r["version"]
        assert not verify_receipt(r, PK)

    def test_wrong_version(self):
        r = generate_receipt(PAYLOAD, SK, KEY_ID)
        r2 = copy.deepcopy(r)
        r2["version"] = "2.0"
        assert not verify_receipt(r2, PK)

    def test_extra_algorithm_field(self):
        r = generate_receipt(PAYLOAD, SK, KEY_ID)
        r2 = copy.deepcopy(r)
        r2["algorithm"]["extra"] = "evil"
        assert not verify_receipt(r2, PK)

    def test_empty_key_id_rejected_by_generator(self):
        with pytest.raises(ValueError):
            generate_receipt(PAYLOAD, SK, "")

    def test_empty_key_id_rejected_by_verifier(self):
        r = generate_receipt(PAYLOAD, SK, KEY_ID)
        r2 = copy.deepcopy(r)
        r2["key_id"] = ""
        assert not verify_receipt(r2, PK)

    def test_verify_never_raises_on_garbage(self):
        for bad in [None, "", 42, [], {}, {"version": "1.0"}]:
            result = verify_receipt(bad, PK)
            assert result is False

    def test_serialisation_roundtrip(self):
        """Receipt survives JSON serialise → deserialise."""
        r  = generate_receipt(PAYLOAD, SK, KEY_ID)
        r2 = json.loads(json.dumps(r))
        assert verify_receipt(r2, PK)


# ---------------------------------------------------------------------------
# Cross-check against existing app/core test vectors (if available)
# ---------------------------------------------------------------------------
class TestVectorFiles:
    """Load test vectors from test-vectors/valid/ and verify them."""
    import pathlib as _pl

    VECTOR_DIR = _pl.Path(__file__).parent.parent.parent.parent / "test-vectors" / "valid"

    def _load_vectors(self):
        vectors = []
        if not self.VECTOR_DIR.exists():
            return vectors
        for p in sorted(self.VECTOR_DIR.glob("*.json")):
            data = json.loads(p.read_text(encoding="utf-8"))
            vectors.append((p.name, data))
        return vectors

    def test_all_valid_vectors_pass(self):
        vectors = self._load_vectors()
        if not vectors:
            pytest.skip("no test vectors found")
        for name, v in vectors:
            receipt = v["receipt"]
            pk      = v.get("public_key_hex") or v["public_key"]
            assert verify_receipt(receipt, pk), f"vector {name} failed"

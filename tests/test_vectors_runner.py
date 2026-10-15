"""
Normative ADR test vector runner.

Loads frozen vectors from tests/vectors_normative/ and verifies each one
against the Core verifier. Vectors are self-contained: they include the
complete receipt and the public key to use for verification.

See tests/vectors_normative/TEST_KEYS.md for key documentation.
"""
import json
from pathlib import Path

from app.core.adr_verify import verify_adr


VECTORS_DIR = Path("tests/vectors_normative")


def _load_frozen_vectors():
    return sorted(VECTORS_DIR.glob("vector_*.json"))


def test_normative_vectors():
    vector_files = _load_frozen_vectors()
    assert vector_files, "No normative vector files found in tests/vectors_normative"

    for path in vector_files:
        with open(path, encoding="utf-8") as f:
            vector = json.load(f)

        receipt = vector["receipt"]
        public_key = vector["public_key"]
        expected = vector["expected_verification_result"]

        result = verify_adr(receipt, public_key)

        assert result is expected, (
            f"{path.name}: expected {expected}, got {result}"
        )

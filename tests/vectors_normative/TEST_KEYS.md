# Normative Test Vector Keys

These keys are used exclusively for normative test vectors.
**TEST ONLY / PUBLIC / NON SECRET. They are not production keys. Never use them to sign real receipts.**

## Test key (match_receipt vectors)

| Field | Value |
|-------|-------|
| Seed | `0xfe` × 32 bytes |
| Public key (hex) | `ca987f7a6cd863424641d4500dc7deba9782533ee071c5f00bc300bc85452437` |
| Algorithm | Ed25519 |

Used in: all vectors where `expected_verification_result: true`, and invalid vectors
that are invalid for reasons other than a wrong key (tampered payload, missing fields, etc.).

## Wrong key (wrong_key vectors)

| Field | Value |
|-------|-------|
| Seed | `0xfd` × 32 bytes |
| Public key (hex) | `e63cc9f1bfea63e045538d59abdabe2c1aee0557daf2894bf3115d177d16506c` |
| Algorithm | Ed25519 |

Used in: vectors where the verification must fail because the public key does not
match the signing key (`vector_004`, `vector_012`).

## Frozen fixtures

These public fixtures are retained byte-for-byte from the foundational vectors.
Run `python -m pytest -q tests/test_vectors_runner.py` to check them.

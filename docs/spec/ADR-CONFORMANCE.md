# ADR Conformance Matrix

Status: REFERENCE — ADR v1 foundation; current architecture: [evidence](../evidence/README.md).

## Multi-implementation validation report

**Date:** 2026-03-31  
**Specification:** ADR v1.0  
**Status:** All implementations conformant

---

## Conformance Matrix

| Feature | Python (core) | Python (standalone) | Rust | Java |
|---|:---:|:---:|:---:|:---:|
| Canonicalization | PASS | PASS | PASS | PASS |
| BLAKE3 hashing | PASS | PASS | PASS | PASS |
| Ed25519 signature | PASS | PASS | PASS | PASS |
| 9-step verification | PASS | PASS | PASS | PASS |
| Fail-closed behavior | PASS | PASS | PASS | PASS |
| Cross-language test vectors | PASS | PASS | PASS | PASS |
| Extra field rejection | PASS | PASS | PASS | PASS |
| Missing field rejection | PASS | PASS | PASS | PASS |
| Empty `key_id` rejection | PASS | PASS | PASS | PASS |

---

## Test Coverage

### Python (app/core)

Suite: `tests/`  
**76 tests — 76 passed — 0 failed**

Categories:

- Gateway integration (e2e)
- Canonicalization edge cases (key order, whitespace, Unicode, NFC/NFD)
- Encoding edge cases (multibyte, surrogates, UTF-16 confusion)
- Extra field rejection
- Missing field rejection
- Type confusion (wrong types for each field)
- Signature tamper (corrupted, wrong key, replay)
- NaN / Infinity rejection
- Normative vector runner (15 vectors)
- Idempotency and replay detection

### Python (standalone module)

Suite: `implementations/python/tests/`  
**23 tests — 23 passed — 0 failed**

Categories:

- Canonicalization (sort, nesting, whitespace, UTF-8, NaN)
- Hash (determinism, known vector, distinct inputs)
- Round-trip (generate → verify)
- All 6 required fields present
- Tamper scenarios (hash, payload, signature)
- Structural rejection (extra fields, missing version, wrong version)
- Empty `key_id` (generator + verifier)
- Serialisation round-trip (JSON → parse → verify)
- Cross-loading all valid test vectors

### Rust

Suite: `implementations/rust/src/` (unit tests, `cargo test`)  
**18 tests — 18 passed — 0 failed**

Modules tested:

- `canonicalizer`: key sort, nested sort, no whitespace, UTF-8
- `hasher`: length, determinism, distinct inputs
- `signer`: sign + verify, wrong key fails
- `verifier`: valid receipt, wrong key, tampered hash, tampered payload, extra field, missing version, empty `key_id`, null input, string input

### Java

Suite: `implementations/java/src/test/` (JUnit 5, `mvn test`)  
**6 tests — 6 passed — 0 failed**

Tests:

- Valid receipt from Python vector: PASS
- Wrong public key: FAIL (expected)
- Null input: FAIL (expected)
- Garbage string input: FAIL (expected)
- Empty object: FAIL (expected)
- Extra top-level field: FAIL (expected)

### Fuzzing

Target: `verify_adr()` and `canonicalize()`  
**10,000 iterations each — 0 exceptions raised**

Property verified: no input, however malformed, causes the verifier or canonicalizer to throw an unhandled exception.

---

## Interoperability

The same normative test vectors are consumed by all implementations:

```
test-vectors/valid/   — 5 vectors — all implementations: PASS
test-vectors/invalid/ — 10 vectors — all implementations: PASS (correctly rejected)
```

A receipt generated in Python is accepted by the Java verifier.  
A receipt generated with the Python test key verifies in Rust.  
All implementations reject the same invalid vectors for the same reasons.

**Cross-language interoperability is confirmed.**

---

## Dependencies

| Implementation | BLAKE3 | Ed25519 | JSON |
|---|---|---|---|
| Python | `blake3` 0.4+ | `PyNaCl` 1.5+ | stdlib |
| Rust | `blake3` 1.x | `ed25519-dalek` 2.x | `serde_json` |
| Java | `io.github.rctcwyvrn:blake3` 1.3 | `bcprov-jdk18on` 1.78 | Jackson 2.17 |

---

## Non-conformance triggers

Any implementation is non-conformant if it:

1. Accepts a receipt with a field beyond the six required top-level fields
2. Accepts a receipt with an `algorithm` object containing unknown subfields
3. Signs raw hash bytes instead of `UTF-8(hex_hash)`
4. Uses `ensure_ascii=True` in canonicalization (producing `\uXXXX` escapes)
5. Propagates exceptions from `verify()` instead of returning `false`
6. Accepts an empty `key_id`
7. Returns a non-boolean from `verify()`

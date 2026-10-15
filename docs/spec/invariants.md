# ADR v1 — Normative Invariants

Status: REFERENCE — ADR v1 foundation; current architecture: [evidence](../evidence/README.md).

This document lists all normative invariants of the ADR v1 protocol, with rationale, test coverage, and lock status.

Reference: [ADR-SPEC-v1.md](ADR-SPEC-v1.md) Section 9.

---

## Invariant Table

| # | Invariant | Rationale | Test coverage | Status |
|---|-----------|-----------|---------------|--------|
| I-1 | **Determinism** — same payload yields identical canonical bytes and hash across compliant implementations | Portability and interop require that two independent verifiers reach the same conclusion given the same receipt | `vector_002` (key reordering), `vector_010` (non-ASCII), `vector_011` (nested), `vector_015` (numeric), Go/Python interop run | **Locked** |
| I-2 | **Integrity** — any payload modification changes the recomputed hash and invalidates verification | A receipt must be unforgeable: tampered content must be detectable | `vector_003` (tampered payload), `vector_014` (zeroed hash) | **Locked** |
| I-3 | **Authenticity** — verification succeeds only with the correct key corresponding to the signing key | Cryptographic binding between receipt and issuer identity | `vector_004` (wrong public key) | **Locked** |
| I-4 | **Portability** — verification must be possible independently of the original execution environment | Receipts must be verifiable years later, by auditors, in any environment | Architecture constraint; covered by offline verification test | **Locked** |
| I-5 | **Algorithm Explicitness** — hash and signature algorithms must be declared in the receipt | Verifier must not assume algorithms; explicit declaration enables future agility | `vector_006` (wrong hash alg), `vector_007` (wrong sig alg), `vector_009` (malformed alg), `vector_013` (incomplete alg) | **Locked** |
| I-6 | **Encoding Stability** — canonicalization output, hash encoding, and signing input encoding are unambiguous | Any ambiguity in encoding creates divergence between implementations | `vector_002`, `vector_010`, `vector_015`, interop report | **Locked** |
| I-7 | **Implementation Agnosticism** — ADR validity must not depend on a specific language, vendor, or SDK | Protocol must be implementable in any language | Go + Python dual implementation; interop report | **Locked** |
| I-8 | **Offline Verifiability** — a verifier must be able to validate a receipt offline given receipt + key | Verification must not require network access, proprietary APIs, or runtime access | Architecture constraint; verified by test suite design (no network calls in verifier) | **Locked** |

---

## Extra Fields Policy (Decision A — 2026-03-24)

The verifier MUST reject any receipt containing:

- unknown top-level fields (any key outside `version`, `payload`, `hash`, `signature`, `algorithm`, `key_id`)
- unknown subfields in `algorithm` (any key outside `hash`, `signature`)

**Rationale:** Fail-closed behavior prevents field injection attacks. Extensibility in future versions is handled by explicit versioning, not silent tolerance.

**Test coverage:** `tests/redteam/test_extra_fields.py` (3 tests)

**Status:** **Locked** (normative, v1)

---

## Signing Input Definition

The signing input for ADR v1 is:

> the UTF-8 encoded hexadecimal string contained in the `hash` field

This means: `sign(hash_hex_string.encode("utf-8"))`, not `sign(raw_hash_bytes)`.

**Rationale:** Signing the hex string (not raw bytes) ensures that the exact stored value is what was signed, making the receipt structure self-describing and the signing input derivable from the stored fields alone.

**Status:** **Locked** (normative, v1). Noted as an unusual but intentional design.

---

## Deferred / Not in v1

- Timestamp format validation — not mandated in Core verifier (Gateway concern)
- Replay detection — not in Core verifier (Gateway concern, Section 11)
- Multiple algorithm support (RSA, SHA-256, etc.) — deferred to v2
- Receipt chaining / sequence numbers — deferred
- Key revocation and rotation — deferred

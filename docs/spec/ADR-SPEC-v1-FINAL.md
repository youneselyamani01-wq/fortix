# ADR — Audit Decision Record

Status: REFERENCE — ADR v1 foundation; current architecture: [evidence](../evidence/README.md).

## Specification v1.0 — Final

**Status:** Normative  
**Version:** 1.0  
**Date:** 2026-03-31

---

## 1. Purpose

An ADR (Audit Decision Record) is a cryptographic receipt that makes a decision verifiable.

It answers three questions with mathematical certainty:

1. What exactly was the decision payload at the time of signing?
2. Has it been modified since?
3. Was it signed by the declared key?

These questions can be answered by any party, at any time, with no dependency on the original system.

An ADR is a **proof primitive**, not an application product. It does not mandate a transport protocol, a storage backend, a ledger, or a user interface.

---

## 2. Data Model

### 2.1 Receipt structure

A valid ADR receipt is a JSON object containing **exactly** the following six fields:

```json
{
  "version":   "1.0",
  "payload":   { ... },
  "hash":      "<64-char lowercase hex>",
  "signature": "<128-char lowercase hex>",
  "algorithm": {
    "hash":      "BLAKE3",
    "signature": "Ed25519"
  },
  "key_id": "<non-empty string>"
}
```

### 2.2 Field definitions

| Field | Type | Description |
|---|---|---|
| `version` | string | ADR specification version. MUST be `"1.0"`. |
| `payload` | object | The decision content being committed. MUST be a JSON object. |
| `hash` | string | BLAKE3 digest of the canonical payload, lowercase hex, 64 characters. |
| `signature` | string | Ed25519 signature over UTF-8(`hash`), lowercase hex, 128 characters. |
| `algorithm` | object | Algorithm identifiers. MUST contain exactly `hash` and `signature`. |
| `key_id` | string | Non-empty identifier for the verification key. |

### 2.3 Fail-closed rule

A verifier MUST reject any receipt that:

- is missing any of the six required fields
- contains any field beyond the six required fields
- has an `algorithm` object with missing or extra subfields
- has a `version` value other than `"1.0"`
- has a non-object `payload`
- has an empty `key_id`

**Unknown fields are not ignored. They cause rejection.**

This is a deliberate design choice: strict structural validation prevents silent downgrade attacks and ensures receipts remain unambiguous across implementations.

---

## 3. Canonicalization

Canonicalization produces a deterministic byte sequence from the payload. Two implementations processing the same semantic payload MUST produce identical canonical bytes.

### 3.1 Rules

1. Serialise `payload` as JSON
2. Sort all object keys lexicographically, recursively
3. No whitespace (no spaces, no newlines, no indentation)
4. Encode as UTF-8
5. Non-ASCII characters MUST be embedded as literal UTF-8 bytes (no `\uXXXX` escaping)
6. `NaN`, `Infinity`, and `-Infinity` are forbidden and MUST cause a hard failure

### 3.2 Reference implementation

```python
json.dumps(
    payload,
    sort_keys=True,
    separators=(",", ":"),
    ensure_ascii=False,
    allow_nan=False,
).encode("utf-8")
```

### 3.3 Scope

Canonicalization applies exclusively to the `payload` field. The other receipt fields are not canonicalized.

### 3.4 Large integer handling

JSON numbers are IEEE 754 double-precision floats. Integers larger than 2⁵³ may be silently truncated by JavaScript and Go parsers. Any payload field that could exceed 2⁵³ MUST be serialised as a JSON string.

---

## 4. Hashing

### 4.1 Algorithm

`BLAKE3`, 256-bit output (32 bytes).

### 4.2 Process

1. Input: canonical bytes from Section 3
2. Compute BLAKE3 digest
3. Encode as lowercase hexadecimal (64 characters)
4. Store in `receipt.hash`

### 4.3 Constraint

The `hash` field MUST contain the digest of the canonical payload bytes, and nothing else.

---

## 5. Signature

### 5.1 Algorithm

`Ed25519`.

### 5.2 Signing input

The signing input is the **UTF-8 encoding of the hex hash string** — not the raw 32-byte digest, not the canonical payload bytes.

```
signing_input = receipt["hash"].encode("utf-8")
```

This design ensures the signed artifact is a human-readable, printable string with a stable, unambiguous encoding.

### 5.3 Process

1. Canonicalize the payload (Section 3)
2. Hash the canonical bytes (Section 4) → `hash_hex`
3. Encode `hash_hex` as UTF-8 bytes → `signing_input`
4. Sign `signing_input` with Ed25519 private key
5. Encode the 64-byte signature as lowercase hexadecimal (128 characters)
6. Store in `receipt.signature`

### 5.4 Prohibitions

- MUST NOT sign the raw payload directly
- MUST NOT sign the canonical payload bytes directly
- MUST NOT sign raw hash bytes

---

## 6. Verification

### 6.1 Overview

Verification takes two inputs:

- `receipt` — the JSON object
- `public_key_hex` — the Ed25519 verification key as lowercase hex (64 characters)

It returns one output: `true` (valid) or `false` (invalid). It never throws.

### 6.2 Nine-step procedure

| Step | Check | Failure → |
|---|---|---|
| 1 | `receipt` is a JSON object | false |
| 2 | Exactly 6 top-level fields, no more, no less | false |
| 3 | `algorithm` is an object with exactly `{hash, signature}` | false |
| 4 | `version == "1.0"` | false |
| 5 | `algorithm.hash == "BLAKE3"` | false |
| 6 | `algorithm.signature == "Ed25519"` | false |
| 7 | `payload` is an object; `key_id` is non-empty string | false |
| 8 | `BLAKE3(canonicalize(payload)) == receipt.hash` | false |
| 9 | `Ed25519.verify(UTF-8(receipt.hash), receipt.signature, public_key)` | false |

All nine steps must pass. Any step failure immediately returns `false`.

### 6.3 Fail-closed

Verification MUST be fail-closed: any exception, malformed input, encoding error, or unexpected state returns `false`. The verifier MUST NOT propagate exceptions to the caller.

### 6.4 Independence

Verification requires no network access, no database, no proprietary SDK, no connection to the original system. The receipt and the public key are sufficient.

---

## 7. Protocol Invariants

| # | Invariant | Meaning |
|---|---|---|
| 1 | **Determinism** | Identical payloads always produce identical canonical bytes and identical hashes across all compliant implementations. |
| 2 | **Integrity** | Any modification of `payload` causes hash recomputation to diverge, invalidating verification. |
| 3 | **Authenticity** | Only the holder of the corresponding private key can produce a receipt that verifies against a given public key. |
| 4 | **Portability** | Verification is possible on any platform, in any language, with no dependency on the originating system. |
| 5 | **Offline verifiability** | A receipt and a public key are the complete inputs required for verification. No external call is required. |
| 6 | **Structural explicitness** | Algorithm identifiers are embedded in the receipt. No implicit assumptions about algorithms are permitted. |
| 7 | **Fail-closed** | Ambiguous, malformed, or partially-valid receipts are rejected. There is no partial validity. |

---

## 8. Explicit Non-Goals

ADR v1 deliberately does not define or require:

- a distributed ledger or blockchain
- a global timestamp authority or time oracle
- a mandatory storage backend
- a network transport protocol
- a key infrastructure or PKI
- a user identity system
- a UI or dashboard

These concerns are application-layer responsibilities. ADR provides the cryptographic primitive; the deployment context provides the operational framework.

---

## 9. Reference Test Vector

The following receipt was generated with the published test keys and MUST verify as `true` against the stated public key in any compliant implementation.

**Private key seed (test only):** `0xfe` × 32  
**Public key:** `ca987f7a6cd863424641d4500dc7deba9782533ee071c5f00bc300bc85452437`

```json
{
  "version": "1.0",
  "payload": {
    "action": "test",
    "actor": "fortix-core",
    "timestamp": "2026-03-11T15:00:00Z"
  },
  "hash": "96f51329dc2dced9f57d33db08d081c1aca51032f59380a28ea8547a7a363823",
  "signature": "4008d628a4182e41a6aa1e52705e41080a0319e32a153870b5c1773c5d4f6b75473894c5510e1343661fbe2ba99ccfc888fe4caa27470b1594fe23b1b0c4d308",
  "algorithm": {
    "hash": "BLAKE3",
    "signature": "Ed25519"
  },
  "key_id": "test-key-001"
}
```

Any implementation that returns `false` for this receipt is non-conformant.

---

## 10. Versioning

This document describes ADR v1.0. The `version` field in a receipt identifies the specification version against which it was produced. A verifier MAY reject receipts with an unknown version.

Future versions will be issued as separate specification documents. ADR v1.0 receipts will remain valid under any future verifier that retains v1.0 support.

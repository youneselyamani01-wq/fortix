# ADR Spec v1

Status: REFERENCE — ADR v1 foundation; current architecture: [evidence](../evidence/README.md).

## 1. Objective

ADR (AI Decision Receipt) defines a portable, verifiable, implementation-agnostic receipt format for recording, proving, and validating an AI-related decision or action.

The protocol is designed to make a decision independently verifiable without requiring permanent access to the original execution environment, internal infrastructure, or proprietary application stack.

## 2. Scope

This specification defines:

- the logical structure of an ADR receipt
- canonicalization requirements for deterministic processing
- hashing requirements for integrity protection
- signature requirements for authenticity
- verification requirements for independent validation
- protocol invariants required for portability and long-term verifiability

This specification does not define:

- a mandatory ledger design
- a mandatory blockchain dependency
- a mandatory user interface
- a mandatory transport layer
- a mandatory storage backend

## 3. Core Components

ADR v1 is based on five core components:

- **Canonicalizer**: transforms receipt input into a deterministic canonical representation
- **Hasher**: computes the integrity digest of the canonicalized payload
- **Signer**: applies a cryptographic signature to the defined ADR signing input
- **ADR Generator**: assembles the final receipt structure
- **Verifier**: validates format, canonicalization, hash consistency, and signature authenticity

These components define the minimal functional architecture of ADR v1.

## 4. Receipt Structure

An ADR receipt MUST contain enough information to allow an independent verifier to validate:

- what was signed
- how it was canonicalized
- which hash algorithm was used
- which signature algorithm was used
- which key identifier was used
- whether the receipt is structurally valid

A minimal ADR receipt structure MUST include the following fields:

- `version`
- `payload`
- `hash`
- `signature`
- `algorithm`
- `key_id`

A minimal ADR receipt example is:

```json
{
  "version": "1.0",
  "payload": {},
  "hash": "<hex-encoded digest>",
  "signature": "<hex-encoded signature>",
  "algorithm": {
    "hash": "BLAKE3",
    "signature": "Ed25519"
  },
  "key_id": "<key identifier>"
}
```

Field requirements:

- `version` MUST identify the ADR specification version
- `payload` MUST contain the decision-relevant structured content
- `hash` MUST be the digest of the canonicalized payload
- `signature` MUST be computed according to Section 7
- `algorithm.hash` MUST identify the hash function used
- `algorithm.signature` MUST identify the signature scheme used
- `key_id` MUST identify the verification key or key reference used for signature validation

## 5. Canonicalization

ADR v1 canonicalization MUST produce a deterministic byte representation of the payload.

For JSON payloads, canonicalization MUST follow these rules:

- UTF-8 encoding MUST be used
- object keys MUST be sorted lexicographically
- no insignificant whitespace MUST be included
- non-ASCII characters MUST be preserved as UTF-8 and MUST NOT be forced to ASCII escapes
- non-finite numeric values (`NaN`, `Infinity`, `-Infinity`) MUST be rejected

A compliant JSON canonicalization is equivalent to:

```python
json.dumps(
    payload,
    sort_keys=True,
    separators=(",", ":"),
    ensure_ascii=False,
    allow_nan=False
).encode("utf-8")
```

If two compliant implementations process semantically identical payloads, they MUST produce identical canonical byte sequences.

ADR v1 canonicalization applies only to the `payload` field.

## 6. Hashing

ADR v1 integrity protection MUST be based on hashing the canonicalized payload bytes.

Requirements:

- the input to hashing MUST be the canonicalized payload bytes
- the output digest MUST be encoded as lowercase hexadecimal
- the hash algorithm identifier MUST be included in the receipt

ADR v1 reference hash algorithm is:

- `BLAKE3`

Hashing process:

1. canonicalize the payload
2. hash the canonical byte sequence
3. encode the digest as lowercase hexadecimal
4. store the digest in the `hash` field

The `hash` field MUST represent exactly the digest of the canonicalized payload, and nothing else.

## 7. Signature

ADR v1 authenticity MUST be established by signing the defined ADR signing input.

For ADR v1 minimal profile, the signing input MUST be:

- the UTF-8 encoded hexadecimal string contained in the `hash` field

ADR v1 reference signature algorithm is:

- `Ed25519`

Requirements:

- the signature MUST be computed over the ADR signing input defined above
- the signature MUST be encoded as lowercase hexadecimal
- the signature algorithm identifier MUST be included in the receipt
- the receipt MUST include a `key_id`
- the corresponding verification key MUST be resolvable through `key_id` or provided separately to the verifier

Signing process:

1. canonicalize the payload
2. hash the canonicalized payload
3. encode the digest as lowercase hexadecimal
4. encode that hexadecimal digest as UTF-8 bytes
5. sign those UTF-8 bytes
6. encode the signature as lowercase hexadecimal
7. store the result in the `signature` field

ADR v1 MUST NOT sign the raw payload directly.  
ADR v1 MUST NOT sign the raw canonical byte sequence directly.

## 8. Verification

A compliant ADR verifier MUST perform the following steps in order:

1. validate receipt structure
2. validate mandatory fields
3. validate declared algorithms
4. canonicalize the `payload` according to Section 5
5. recompute the payload hash according to Section 6
6. compare the recomputed hash with the stored `hash` field
7. reconstruct the ADR signing input according to Section 7
8. verify the signature using the declared signature algorithm and the supplied verification key
9. return valid only if all checks succeed

Verification MUST fail if:

- a mandatory field is missing
- canonicalization fails
- hashing fails
- the recomputed hash differs from the stored `hash`
- signature verification fails
- algorithm identifiers are unsupported
- encoding is invalid
- receipt structure is malformed

Verification MUST NOT depend on proprietary infrastructure, network access, or the original runtime environment.

## 9. Invariants

ADR v1 defines the following protocol invariants:

1. **Determinism**  
   The same payload MUST yield the same canonical byte sequence and the same hash across compliant implementations.

2. **Integrity**  
   Any modification of the payload MUST change the recomputed hash and invalidate verification unless the receipt is regenerated and re-signed.

3. **Authenticity**  
   A receipt MUST verify successfully only with the correct verification key corresponding to the signing key.

4. **Portability**  
   Verification MUST be possible independently of the original execution environment.

5. **Algorithm Explicitness**  
   Hash and signature algorithms MUST be explicitly declared in the receipt.

6. **Encoding Stability**  
   Canonicalization output, hash encoding, and signature input encoding MUST be unambiguous and reproducible.

7. **Implementation Agnosticism**  
   ADR validity MUST NOT depend on a specific programming language, vendor, SDK, or infrastructure stack.

8. **Offline Verifiability**  
   A verifier MUST be able to validate a receipt offline if the receipt and the verification key are available.

## 10. Test Vectors

ADR v1 compliance SHOULD be demonstrated using normative test vectors.

At minimum, test vectors SHOULD cover:

### Canonicalization

1. same payload with different JSON key order
2. payload containing non-ASCII UTF-8 characters
3. payload containing nested objects
4. payload containing invalid non-finite numeric values

### Hashing

5. canonical payload produces expected BLAKE3 digest
2. minimal payload hash
3. complex payload hash

### Signature

8. valid signature over expected hash
2. invalid signature with wrong key
3. tampered signature encoding

### Verification

11. full receipt validates successfully
2. modified payload fails verification
3. wrong public key fails verification
4. malformed receipt fails structural validation

Normative vector files SHOULD include:

- payload
- expected canonical form or canonical bytes reference
- expected hash
- expected signature
- public key or key reference
- expected verification result

## 11. Gateway Behavior (Normative)

This section defines normative behavior for ADR-aware gateways that orchestrate policy and execution around ADR Core.

### 11.1 Separation of Concerns

- ADR Core cryptographic behavior MUST remain unchanged:
  - canonicalization of payload
  - BLAKE3 hash over canonical payload bytes
  - Ed25519 verification over UTF-8 encoded `hash` hex
- Gateway replay/idempotency checks MUST be implemented outside ADR Core verifier logic.

### 11.2 Decision and Execution Outcomes

Gateways MUST produce one decision per request:

- `ALLOW`
- `REVIEW`
- `DENY`

Execution invariant:

- `executed` MUST be `true` only if `decision == ALLOW`.
- `executed` MUST be `false` for `REVIEW` and `DENY`.

Status mapping:

- `ALLOW` -> `executed`
- `REVIEW` -> `pending_review`
- `DENY` + `replay_detected` -> `blocked_by_replay_protection`
- `DENY` + `duplicate_action_id` -> `blocked_by_idempotency_guard`
- `DENY` default -> `blocked_by_policy`

### 11.3 ADR Generation Ordering

Gateways MUST generate ADR before policy evaluation and before execution.

ADR receipts MUST be present in responses for all outcomes (`ALLOW`, `REVIEW`, `DENY`).

### 11.4 Idempotency Rules

Gateways MUST enforce an idempotency guard keyed by `action_id`.

For each `action_id`, a gateway MUST store one canonical business fingerprint derived from:

- `actor_id`
- `action`
- `target`
- `payload`
- `metadata`

The business fingerprint MUST exclude `timestamp`.

Normative behavior:

1. If `action_id` is not present, the gateway MUST store the fingerprint and continue.
2. If `action_id` exists and fingerprint matches, the gateway MUST return:
   - decision: `DENY`
   - reason: `replay_detected`
3. If `action_id` exists and fingerprint differs, the gateway MUST return:
   - decision: `DENY`
   - reason: `duplicate_action_id`

### 11.5 Replay vs Duplicate Distinction

`replay_detected` and `duplicate_action_id` are not interchangeable:

- `replay_detected` means same `action_id` and same business intent.
- `duplicate_action_id` means same `action_id` but different business intent.

Gateways MUST preserve this distinction in both `reason` and `status`.

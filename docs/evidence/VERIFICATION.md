# Independent verification

Status: CURRENT.

The Independent Verifier is a separate verification space. It receives a PEB, recomputes
everything from the received bytes, and returns one verdict. It relies neither on the
producing systems nor on any verdict a source claims.

Part of the [evidence architecture](README.md):
Action → NanoReceipts → causal compilation → Final Receipt → PEB →
**Independent Verifier → VALID / INVALID / INDETERMINATE / REVOKED**.

## Verdicts

The verdict type is `CanonicalVerdict` in
[`app/verification.ts`](../../demo/fortix-causal-editing-table/app/verification.ts).

| Verdict | Meaning | When it occurs in this repository |
| --- | --- | --- |
| `VALID` | Every check passed, including production trust anchors and trusted time. | Reachable in the core PEB verifier (`verifyPortableEvidenceBundle`) once its trust-and-time layer completes. No bundle shipped here reaches it, and the D-006 Verifier has no path to it today. |
| `INVALID` | A positive finding: the evidence was altered, forged, re-bound or substituted, or it contradicts its profile. | For example, a payload changed with recomputed hashes, a key that contradicts the trust-anchor directory, wrong transfer bytes, or a PEB that recompilation does not reproduce. |
| `INDETERMINATE` | Nothing contradicts the evidence, but something that `VALID` requires is not established. | A genuine D-006 PEB (`D005M_PRODUCTION_TRUST_TIME_INCOMPLETE`). In the core and D-005M verifiers used on their own, also a key the directory has never seen, or missing required evidence. |
| `REVOKED` | The key or authority behind the evidence had been revoked. | When the trust-anchor directory marks the signing key revoked (`D005M_VERIFICATION_KEY_REVOKED`), and in the D-004 authority and D-005 operational-cycle models. The shipped directory holds only an active key. |

`INDETERMINATE` is not a weaker `VALID`. It names what could not be established.

## What the D-006 Verifier checks

`verifyD006PortableMissionEvidence` in
[`app/offlineVerification.ts`](../../demo/fortix-causal-editing-table/app/offlineVerification.ts)
runs these checks in order:

1. **Transfer digest.** The BLAKE3 digest of the received text must equal the expected
   transfer digest (`D006_PEB_TRANSFER_DIGEST_MISMATCH`).
2. **Profile.** The text must be canonical JSON with the D-006 PEB profile
   (`D006_PEB_TEXT_INVALID`).
3. **Identity.** The Mission ID and Run ID must be the expected ones
   (`D006_MISSION_RUN_IDENTITY_MISMATCH`).
4. **Bundle digest.** The manifest digest must match the bundle
   (`D006_PEB_BUNDLE_DIGEST_MISMATCH`).
5. **Signed source evidence.** `verifyD005MMasterBundle`
   ([`app/masterStory.ts`](../../demo/fortix-causal-editing-table/app/masterStory.ts))
   does the following, in order:
   - recomputes every digest;
   - authorizes the presented keys against the pinned trust-anchor directory
     ([`app/trustAnchors.ts`](../../demo/fortix-causal-editing-table/app/trustAnchors.ts));
   - verifies every Ed25519 signature with the directory's key material, never the
     bundle's;
   - checks the target binding and the closure of the cycle receipt.

   An `INVALID` or `REVOKED` result here is final.
6. **Recompilation.** The Verifier rebuilds the closure, re-issues the Final Receipt and
   rebuilds the PEB, and the result must equal the received PEB exactly
   (`D006_PEB_CLOSURE_MISMATCH`, or the compiler's own reason code). Recompilation also
   requires the signed source bundle to be exactly the expected one. A source bundle that
   differs in any way, for example one re-signed under a key the directory has never
   seen, therefore ends here as `INVALID` if step 5 has not already ended the check.
7. **Financial scope.** Settlement must still be stated as `NOT_DEMONSTRATED`.

Steps 1 to 4, 6 and 7 return `INVALID` on failure. A PEB that passes every step takes the
verdict of step 5; for a genuine D-006 PEB that is `INDETERMINATE`. The result lists its
reason codes and the checks it actually completed.

## Separation from the source

- **Expectations come from outside the PEB.** The expected Mission ID, Run ID and
  transfer digest arrive as a separate field of the demo handoff, or the person enters
  them for a file. They are never read from the PEB itself.
- **No verdict without an explicit analysis.** Dropping a PEB, opening a link or
  reconnecting never starts one.
- **No network.** The analysis runs with every network primitive removed, and a
  reconnection after the verdict changes nothing.
- **No borrowed verdict.** A verdict claimed by the source or by a synchronization peer is
  never read.
- **One verdict per byte sequence.** The Verifier shows a result only for the digest and
  run it analyzed.

## Where to see it

The Verifier runs at `/verify` in the D-006 demonstration
([`app/verify/`](../../demo/fortix-causal-editing-table/app/verify/)). For an analyzed
PEB it offers a verdict view and reading views for the path, domains, causal graph,
NanoReceipts, network, timeline, forensic detail and each event
([`app/verify/[pebId]/`](../../demo/fortix-causal-editing-table/app/verify/%5BpebId%5D/)).
These views display the analysis; they do not compute verdicts.

## What verification does not establish

- A verdict covers integrity, provenance under authorized keys, causal closure and trust
  status. It does not establish that a decision was correct, or that a physical event
  happened as recorded.
- An authorization verified as authentic remains an authorization. It is not evidence of
  delivery, application or effect.
- The D-006 runtime NanoReceipts are not authenticated one by one. They are bound by
  their digests, by the journal chain and by the expected transfer digest, not by
  individual signatures. The verdict is only as strong as the source of that expected
  digest.

## Other verifiers in this repository

Each layer keeps its own result vocabulary:

- **ADR v1 verifiers** (foundational layer) return valid or invalid for one receipt:
  Python [`app/core/adr_verify.py`](../../app/core/adr_verify.py).
- **The Python verify service** returns `VALID`, `INVALID` or `UNVERIFIABLE`
  ([`app/verify/models.py`](../../app/verify/models.py)).

The four-verdict set above is the one used by the D-006 Independent Verifier and the
earlier D-003 to D-005 verifiers.

## Tests

- [`tests/d006nx3-offline-verifier.test.ts`](../../demo/fortix-causal-editing-table/tests/d006nx3-offline-verifier.test.ts):
  verification of the real handoff bytes with no network. A reconnection changes no
  verdict.
- [`tests/d006nx3-adversarial.test.ts`](../../demo/fortix-causal-editing-table/tests/d006nx3-adversarial.test.ts):
  - opening the Verifier transfers nothing;
  - nothing is analyzed without the explicit act;
  - a verdict for other bytes is never shown.
- [`tests/d006g-p2r-adversarial.test.ts`](../../demo/fortix-causal-editing-table/tests/d006g-p2r-adversarial.test.ts):
  the genuine bundle stays `INDETERMINATE`, and a forged payload with recomputed hashes
  is rejected.
- [`tests/d006g-p3-trust-authorization.test.ts`](../../demo/fortix-causal-editing-table/tests/d006g-p3-trust-authorization.test.ts):
  - an attacker key with valid signatures is rejected;
  - an unknown key establishes nothing;
  - a revoked key yields `REVOKED`.
- [`tests/d006c1-portable-evidence.test.ts`](../../demo/fortix-causal-editing-table/tests/d006c1-portable-evidence.test.ts):
  rebound and forged PEBs are `INVALID`, and the genuine PEB is `INDETERMINATE`.
- [`tests/d003-verification.test.ts`](../../demo/fortix-causal-editing-table/tests/d003-verification.test.ts),
  [`tests/operational-cycle.test.ts`](../../demo/fortix-causal-editing-table/tests/operational-cycle.test.ts)
  and [`tests/authority-model.test.ts`](../../demo/fortix-causal-editing-table/tests/authority-model.test.ts):
  the earlier core, operational-cycle and authority verifiers.

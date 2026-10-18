# Public claims and evidence

Status: CURRENT. A test result is established only by the launch-readiness report.

| Public claim | Implementation | Executable evidence |
| --- | --- | --- |
| Declared causal evidence is compiled into a content-addressed Final Receipt and PEB | `demo/fortix-causal-editing-table/app/portableMissionEvidence.ts` | `d006c1-portable-evidence.test.ts`, `d006g-p3-causal-edges.test.ts` |
| Verification recomputes from received bytes, separately from the producer | `app/offlineVerification.ts` within D-006 | `d006nx3-offline-verifier.test.ts`, `d006nx3-adversarial.test.ts` |
| A genuine D-006 PEB is INDETERMINATE; forged evidence is rejected; revoked authorization remains distinct | `app/masterStory.ts`, `app/trustAnchors.ts` within D-006 | `d006g-p2r-adversarial.test.ts`, `d006g-p3-trust-authorization.test.ts` |
| Authorization does not establish settlement | D-006 causal compiler | `d006c1-financial-closure.test.ts` |
| Runtime network evidence is scoped to observations and mission identity; replay and reconciliation are checked | D-006 `app/offlineEvidence.ts` and mission model | `test:network-continuity` |
| Site intake requires a matching origin, window and nonce and preserves exact bytes | `site/src/verification/pebHandoff.ts` | `site/tests/peb-handoff.test.ts`, `PebIntake.test.tsx` |
| The Python ADR foundation uses frozen normative vectors and fails closed without signing configuration | `app/core/`, `app/gateway/` | `tests/test_vectors_runner.py`, `tests/test_adr_signing_fail_closed.py` |

**Public-reference boundary (2026-10-18):** an independently checked BLAKE3-256 exact-file transfer digest and expected Mission/Run identities are available in the [D-006 reference note](evidence/D006-PUBLIC-REFERENCE.md) and [a separately published GitHub issue](https://github.com/youneselyamani01-wq/fortix/issues/2). This out-of-file reference does not constitute an independent signature or trusted timestamp. Runtime journal entries are not individually signed. Network physical-sentinel fields in the reference PEB are unverified source declarations. The D-006 verifier has scenario-specific expected event payloads; it is not a generic agent-workflow verifier. See the reference note before using this PEB for any claim.

D-006 vehicle, city and routing are simulated. Physical network evidence requires
local configuration. Production trust anchors, trusted time and settlement are not
demonstrated. The included historical PEB inputs are inspection fixtures, not a
claim of a current production verdict. No broader conformance or interoperability
claim is made by this launch candidate.

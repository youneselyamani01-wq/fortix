# Public technical release — reproducible evidence index

Snapshot: 19 October 2026. Scope: the public repository and the D-006 demonstration.
This index does not define a new protocol or change any evidence, signature or verdict.

## Start with the implemented profiles

| Resource | Existing specification and implementation |
| --- | --- |
| Evidence architecture | [Architecture](https://github.com/youneselyamani01-wq/fortix/blob/5a75b58cf9732fb1ee1ffee6931ec5a8c1172a16/docs/evidence/README.md) |
| NanoReceipts | [Signed canonical objects and unsigned runtime records](https://github.com/youneselyamani01-wq/fortix/blob/5a75b58cf9732fb1ee1ffee6931ec5a8c1172a16/docs/evidence/NANORECEIPTS.md) |
| Final Receipt | [Content-addressed receipt and causal compilation](https://github.com/youneselyamani01-wq/fortix/blob/5a75b58cf9732fb1ee1ffee6931ec5a8c1172a16/docs/evidence/FINAL-RECEIPT.md) |
| Portable Evidence Bundle | [PEB profiles, members and digest scopes](https://github.com/youneselyamani01-wq/fortix/blob/5a75b58cf9732fb1ee1ffee6931ec5a8c1172a16/docs/evidence/PEB.md) |
| Verification and verdicts | [Checks, trust assumptions and layer-specific results](https://github.com/youneselyamani01-wq/fortix/blob/32b5e72d2df12e522209eaad3f45a334ca10c358/docs/evidence/VERIFICATION.md) |
| Historical ADR v1 | [Frozen foundational specification](https://github.com/youneselyamani01-wq/fortix/blob/5a75b58cf9732fb1ee1ffee6931ec5a8c1172a16/docs/spec/ADR-SPEC-v1-FINAL.md) |

The evidence architecture and ADR v1 are different layers. ADR v1 verifies a single receipt; the current D-006 profile compiles a mission's evidence into a Final Receipt and PEB. The existing TypeScript types, builders and tests implement the demonstration profiles. These documents do not claim a generic, independently certified interoperability standard.

## Exact reference bytes and external expectations

The [original reference artifact on main](https://github.com/youneselyamani01-wq/fortix/blob/5a75b58cf9732fb1ee1ffee6931ec5a8c1172a16/artifacts/d006-network-continuity-20261002/peb-after-network-cycle.json) is available now. Its identical [website-download copy](https://github.com/youneselyamani01-wq/fortix/blob/32b5e72d2df12e522209eaad3f45a334ca10c358/site/public/evidence/d006-reference-peb.json) and [bilingual walkthrough](https://github.com/youneselyamani01-wq/fortix/blob/32b5e72d2df12e522209eaad3f45a334ca10c358/docs/evidence/PUBLIC-VERIFICATION-WALKTHROUGH.md) are pinned to the reviewed PR #1 snapshot. **PR #1 is separate and was not merged by this documentation change.** A repository file's availability does not by itself establish what a deployed website currently serves.

Obtain expectations from [the separate published digest record](https://github.com/youneselyamani01-wq/fortix/issues/2) before analyzing the candidate:

| Expectation | Value |
| --- | --- |
| Transfer BLAKE3-256 | `cb2786db914459e56f64c0a70f7993d8f44db5a6403c1a77c6015ed3ddb0e1a1` |
| Exact file length | 264966 UTF-8 bytes |
| Line endings | LF, including the final LF |
| Mission ID | `fortix.demo.d005.operational-cycle-001` |
| Run ID | `fortix.d006.audit.after` |
| Final Receipt | `fortix:receipt:blake3:6a782cf26723f2b0fdc174573ca812d5352209307612360d1ed3e1fc8c4b1ed4` |

Minification, reformatting, CRLF conversion or removing the final LF changes the transfer bytes and must fail comparison to the original expected digest. Computing an expected digest from the candidate itself does not establish origin. The separate issue is controlled by the same publisher and is mutable; it is not a third-party attestation, immutable trust anchor or trusted timestamp.

`bundleId`, `manifest.bundleDigest` and the exact-file transfer digest cover different inputs. Their construction and the unsigned-runtime limits are explained in the [reference scope](https://github.com/youneselyamani01-wq/fortix/blob/32b5e72d2df12e522209eaad3f45a334ca10c358/docs/evidence/D006-PUBLIC-REFERENCE.md).

## Reproduce the bounded checks

1. Save the original raw JSON unchanged; record the external expectations above.
2. Use the independent verifier in a separate context. Supply the file and the external expected digest and identity, then explicitly request analysis.
3. Inspect the calculated verdict and its reason codes. The authentic D-006 demonstration is expected to return `INDETERMINATE`.
4. Alter a copy and retain the original expectations. A transfer-byte mismatch is `INVALID`. That one check alone does not demonstrate signature verification or causal recompilation.
5. For local code-level reproduction, use the exact Node version and installation instructions in the [demo README](https://github.com/youneselyamani01-wq/fortix/blob/32b5e72d2df12e522209eaad3f45a334ca10c358/demo/fortix-causal-editing-table/README.md). From that demo directory, run:

```sh
npm ci --ignore-scripts
node --experimental-strip-types --test tests/d006-public-reference.test.ts
npm run test:d006nx3
```

The first test belongs to the pinned PR snapshot, not the current main snapshot. Check out that revision before running it. It checks BLAKE3 known-answer vectors, equality to the original fixture, expected identities and verdict, plus altered, minified and CRLF copies. The broader suite covers other boundaries; a passing fixture test is not generic protocol conformance.

| Additional question | Existing test at the pinned PR revision |
| --- | --- |
| Rehashed payload forgery | [Adversarial proof tests](https://github.com/youneselyamani01-wq/fortix/blob/32b5e72d2df12e522209eaad3f45a334ca10c358/demo/fortix-causal-editing-table/tests/d006g-p2r-adversarial.test.ts) |
| Attacker, unknown and revoked keys | [Trust authorization tests](https://github.com/youneselyamani01-wq/fortix/blob/32b5e72d2df12e522209eaad3f45a334ca10c358/demo/fortix-causal-editing-table/tests/d006g-p3-trust-authorization.test.ts) |
| Offline analysis and reconnect behavior | [Offline verifier tests](https://github.com/youneselyamani01-wq/fortix/blob/32b5e72d2df12e522209eaad3f45a334ca10c358/demo/fortix-causal-editing-table/tests/d006nx3-offline-verifier.test.ts) |
| Portable evidence binding and closure | [PEB tests](https://github.com/youneselyamani01-wq/fortix/blob/32b5e72d2df12e522209eaad3f45a334ca10c358/demo/fortix-causal-editing-table/tests/d006c1-portable-evidence.test.ts) |
| Public simulation versus physical admission | [Public simulation tests](https://github.com/youneselyamani01-wq/fortix/blob/32b5e72d2df12e522209eaad3f45a334ca10c358/demo/fortix-causal-editing-table/tests/d006-public-simulation.test.ts) |

## Interpret results without promoting claims

- `VALID`: all requirements of the relevant verification profile, including production trust and trusted time, are established. No shipped D-006 bundle reaches this state.
- `INVALID`: a positive integrity, identity, binding or profile contradiction was detected.
- `INDETERMINATE`: the evidence does not establish everything required for validity. This is the genuine D-006 demonstration's expected result, not production validity.
- `REVOKED`: the profile's authorized trust material establishes revocation. The shipped directory contains an active demo key; revocation cases are exercised by tests.

Unknown identities and missing material are handled differently at different verification layers; consult the [exact profile rules](https://github.com/youneselyamani01-wq/fortix/blob/32b5e72d2df12e522209eaad3f45a334ca10c358/docs/evidence/VERIFICATION.md). The Python verify service has its own three-result vocabulary and must not be relabeled as the D-006 four-verdict profile.

The signed source evidence, unsigned runtime journal, simulated world and physical observations have different assurance levels. D-006 fixes expected scenario events and payloads. A self-consistent rebuilt unsigned journal with new digests can remain `INDETERMINATE`; it will not match the separately pinned original transfer digest. Inclusion labels do not authenticate an event source. Local-sentinel-labeled entries in the reference are declarations within that journal, while the public web simulation has no physical observation without a configured local sentinel.

Authorization does not prove execution; execution does not prove effect. Bank settlement remains `NOT_DEMONSTRATED`. Neither the scenario nor a cryptographic signature certifies business correctness or regulatory compliance.

## Français — point d'entrée

Les spécifications existent déjà : NanoReceipts, compilation causale, Final Receipt, PEB et vérification. Ce document les relie à des révisions fixes sans modifier le cœur D-006. Télécharger les octets bruts, relever l'empreinte et l'identité dans le registre séparé, puis analyser explicitement. Les retours CRLF changent l'empreinte. Le verdict attendu est `INDETERMINATE` ; les événements runtime ne sont pas signés individuellement, le scénario est spécifique et le règlement bancaire n'est pas démontré.

This index is documentation only. Review and deployment are separate decisions. Repository use remains subject to [LICENSE](https://github.com/youneselyamani01-wq/fortix/blob/5a75b58cf9732fb1ee1ffee6931ec5a8c1172a16/LICENSE).

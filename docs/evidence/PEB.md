# Portable Evidence Bundle (PEB)

Status: CURRENT.

The PEB is the transport unit of FortiX evidence. It is one self-contained file that
carries a Final Receipt together with every piece of evidence that receipt rests on, so
that a party with no access to the producing systems can verify it.

Part of the [evidence architecture](README.md):
Action → NanoReceipts → causal compilation → Final Receipt → **PEB** → Independent Verifier.

## What a PEB carries

The D-006 PEB (profile `fortix.demo.d006.peb.v1`) is built by
`buildPortableMissionEvidenceBundle` in
[`app/portableMissionEvidence.ts`](../../demo/fortix-causal-editing-table/app/portableMissionEvidence.ts).

| Field | Content |
| --- | --- |
| `profile` | `fortix.demo.d006.peb.v1` |
| `bundleId` | `fortix:peb:blake3:` followed by the digest of the bundle |
| `identity` | the Mission ID and Run ID |
| `sourceBundle` | the signed D-005M source bundle, byte for byte (profile `fortix.peb.core.v1`) |
| `runtimeRecords` | the runtime journal, exactly as sealed when the Final Receipt was emitted |
| `finalReceipt` | the [Final Receipt](FINAL-RECEIPT.md) |
| `manifest.memberRefs` | one entry per member: identifiers, digest, producer domain, causal parents, observed inputs, time, source (`SIGNED_CANONICAL`, `RUNTIME_JOURNAL` or `D006_FINAL_RECEIPT`), presentation and assurance |
| `manifest.presentationEvidenceIds`, `manifest.assuranceSupportEvidenceIds` | which members are presented and which only support assurance |
| `manifest.bundleDigest` | the BLAKE3 digest of the whole bundle, computed with this field empty |

The builder refuses to produce a PEB in these cases:

- the mission has not reached the point where the PEB is complete (`PEB_PREMATURE`);
- the closure or the Final Receipt it is given differs from what recompilation produces
  (`CLOSURE_STALE_OR_MUTATED`, `FINAL_RECEIPT_STALE_OR_MUTATED`);
- the evidence shown on screen is not exactly the PEB's presentation set
  (`DISPLAYED_PEB_COVERAGE_MISMATCH`).

## Why it is portable

- **Self-contained.** It is canonical JSON. The signed source evidence, the runtime
  records, the Final Receipt and the manifest all travel inside the file.
- **No network needed.** The Verifier analyzes a PEB with every network primitive
  removed, and a reconnection changes no verdict.
- **No keys taken from the bundle.** Signatures are checked against the Verifier's
  pinned trust-anchor directory, never against keys that the bundle supplies.
- **Content-addressed.** The bundle, the Final Receipt and every evidence object are
  named by digests of their content, so any change to their content changes their
  identifiers.

## How it reaches the Verifier

1. **Handoff.** `createHandoffArtifact` serializes the PEB to canonical text and computes
   its transfer digest: the BLAKE3 digest of the exact UTF-8 bytes.
2. **From the demo.** When the person hands the PEB over in the mission experience
   (`/nx`), `openDemoVerifier`
   ([`app/verify/demoHandoff.ts`](../../demo/fortix-causal-editing-table/app/verify/demoHandoff.ts))
   opens the Verifier (`/verify`) in a separate browsing context. It posts the exact text
   together with an expectation that is not read from the PEB: the Mission ID, Run ID and
   transfer digest. The channel checks a nonce and the origin. It accepts receipt and an
   Analyze request, and it never accepts a verdict.
3. **From the public site.**
   [`PebIntake`](../../site/src/components/verifier/PebIntake.tsx) lets a person drop or
   select a PEB file (JSON or text, up to 20 MB) and hands it to the Verifier
   ([`site/src/verification/pebHandoff.ts`](../../site/src/verification/pebHandoff.ts)).
   Receiving a file neither analyzes it nor establishes where it came from. For a file,
   the person enters the expected Mission ID, Run ID and transfer digest in the Verifier.
4. **In the Verifier.** The received bytes are held, and nothing is analyzed until the
   person asks for it. Before and after analysis, the received PEB can be inspected
   ([`ReceivedPebInspection.tsx`](../../demo/fortix-causal-editing-table/app/verify/ReceivedPebInspection.tsx),
   [`inspectReceivedPeb.ts`](../../demo/fortix-causal-editing-table/app/verify/inspectReceivedPeb.ts)).
   Fields are shown as declarations, and the exact text is fingerprinted. Relations come
   only from the declared causal parents, observed inputs and Final Receipt inputs.

## What a PEB allows a verifier to check

| Check | Failure |
| --- | --- |
| the received bytes are the bytes that were handed over (transfer digest) | `INVALID` |
| the mission and run are the expected ones | `INVALID` |
| the bundle digest matches the bundle | `INVALID` |
| the signed source evidence is authentic, under keys the Verifier's trust-anchor directory authorizes | `INVALID` (forged, re-signed or substituted), `REVOKED` (the directory marks the signing key revoked) |
| recompiling the closure, the Final Receipt and the PEB reproduces the received PEB exactly, from the expected source bundle | `INVALID` |
| settlement is still stated as not demonstrated | `INVALID` |

The full sequence and the verdicts are in [VERIFICATION.md](VERIFICATION.md).

## What a PEB does not prove automatically

- **Holding a PEB is not verifying it.** Receiving, opening or inspecting a PEB produces
  no verdict. Only an explicit analysis does.
- **Declared fields are declarations.** A producer domain, a source or an assurance level
  read from the file is not established until the analysis has checked it.
- **The PEB does not prove where it came from.** The Verifier checks it against an
  expected identity and transfer digest that come from a source other than the PEB
  itself, and the verdict is only as strong as that source.
- **A consistent PEB is not a true world.** It establishes integrity, the provenance of
  the signed evidence under authorized keys, and causal closure. It does not prove that
  the physical events happened as recorded, that a decision was correct, or that money
  moved.
- **The D-006 PEB is demonstration evidence.** Production trust anchors and trusted time
  are not established for it, so a genuine D-006 PEB verifies as `INDETERMINATE`, never
  `VALID`.

## Data in this repository

| PEB | Profile | File |
| --- | --- | --- |
| D-003 | `fortix.peb.core.v1` | [`data/d003-portable-evidence-bundle.json`](../../demo/fortix-causal-editing-table/data/d003-portable-evidence-bundle.json) |
| D-005 | `fortix.peb.core.v1` | [`data/d005-portable-evidence-bundle.json`](../../demo/fortix-causal-editing-table/data/d005-portable-evidence-bundle.json) |
| D-005M (signed source of D-006) | `fortix.peb.core.v1` | [`data/d005m-master-portable-evidence-bundle.json`](../../demo/fortix-causal-editing-table/data/d005m-master-portable-evidence-bundle.json) |
| D-006, reference used by the verifier tests (one network loss and one restoration) | `fortix.demo.d006.peb.v1` | [`artifacts/d006-network-continuity-20261002/peb-after-network-cycle.json`](../../artifacts/d006-network-continuity-20261002/peb-after-network-cycle.json) |
| D-006, a network loss with no restoration | `fortix.demo.d006.peb.v1` | [`artifacts/verifier-ux-completion-20261004/real-cut-incomplete-peb.json`](../../artifacts/verifier-ux-completion-20261004/real-cut-incomplete-peb.json) |

A D-006 PEB is produced at runtime by each mission run, so none is stored under `data/`.
The two D-006 files above are inputs for the Verifier's reading views and tests; no test
asserts their verdict under the current code. They are pretty-printed, and the Verifier
fingerprints the exact bytes it receives, so the expected transfer digest for a stored
file is the BLAKE3 digest of that file.

## Distinct content digests and public reference

For D-006 the builder first hashes the canonical draft PEB with the `bundleId` and `manifest.bundleDigest` fields blank: this yields `bundleId`. It then hashes the canonical bundle with the computed `bundleId` and blank `manifest.bundleDigest` to obtain the **manifest digest**. The **transfer digest** is different: BLAKE3-256 of the **exact UTF-8 text handed to the verifier**, including spaces and newline bytes. These values are not interchangeable.

The [D-006 public reference](D006-PUBLIC-REFERENCE.md), also recorded [outside the JSON in GitHub issue #2](https://github.com/youneselyamani01-wq/fortix/issues/2), supplies the expected transfer digest `cb2786db914459e56f64c0a70f7993d8f44db5a6403c1a77c6015ed3ddb0e1a1`, Mission ID, Run ID and Final Receipt ID. Preserve LF line endings; changing to CRLF changes the transfer digest.

The two local-sentinel-labeled network events in this reference are runtime journal observations, **not individually signed claims**. A structural rebuild can yield a new internally consistent but different journal; only a separate pinned expected digest protects the *identity of this published file* against such substitution. Neither runtime integrity nor the presence of a `PHYSICAL_SENTINEL` label alone establishes physical event truth. The verifier also uses fixed D-006 scenario expectations: it is not yet a generic workflow verifier.

## Tests

- [`tests/d006c1-portable-evidence.test.ts`](../../demo/fortix-causal-editing-table/tests/d006c1-portable-evidence.test.ts):
  building, exact-byte handoff, and rejection of rebound or forged bundles.
- [`tests/d006nx3-peb-transport.test.ts`](../../demo/fortix-causal-editing-table/tests/d006nx3-peb-transport.test.ts):
  picking up is not dropping off, opening is not transferring, and there is no verdict
  before an explicit analysis.
- [`tests/d006nx3-offline-verifier.test.ts`](../../demo/fortix-causal-editing-table/tests/d006nx3-offline-verifier.test.ts):
  verification of the real handoff bytes with no network.
- [`tests/fsr2-peb-inspection.test.ts`](../../demo/fortix-causal-editing-table/tests/fsr2-peb-inspection.test.ts)
  and [`tests/fsr2-received-graph.test.ts`](../../demo/fortix-causal-editing-table/tests/fsr2-received-graph.test.ts):
  inspection reads the exact received bytes, keeps malformed and unresolved entries
  visible, and never adds edges from time or position.
- [`site/tests/peb-handoff.test.ts`](../../site/tests/peb-handoff.test.ts) and
  [`site/tests/PebIntake.test.tsx`](../../site/tests/PebIntake.test.tsx): the site opens
  a separate Verifier, sends the exact file only after an origin, window and nonce match,
  and passes it on unchanged without an analysis request.

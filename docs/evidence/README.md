# FortiX evidence architecture

Status: CURRENT.

FortiX is an independent verification infrastructure for digital systems and AI agents.

FortiX does not orchestrate. The systems that act (a vehicle, a city controller, a
payment provider, a bank, a human approver) stay in charge of what they do. FortiX
turns the evidence they produce into a portable package that a separate party can
verify without access to those systems.

This folder describes that architecture as the repository implements it today, in the
D-006 autonomous-taxi demonstration. Every page links to the code and tests behind it.

## Canonical flow

```text
Action → NanoReceipts → causal compilation → Final Receipt → Portable Evidence Bundle (PEB)
       → Independent Verifier → VALID / INVALID / INDETERMINATE / REVOKED
```

| Stage | What happens | Page |
| --- | --- | --- |
| Evidence production | Each participating system records what it observed, decided or did, when it happens. | [NANORECEIPTS.md](NANORECEIPTS.md) |
| NanoReceipts | One canonical record per significant event, with its digest, its producer domain and its declared causal parents. | [NANORECEIPTS.md](NANORECEIPTS.md) |
| Causal compilation | A deterministic step checks every record, requires a closed causal set and fixes the digest of that set. | [FINAL-RECEIPT.md](FINAL-RECEIPT.md) |
| Final Receipt | One content-addressed receipt binds the compiled evidence set and states what it does and does not establish. | [FINAL-RECEIPT.md](FINAL-RECEIPT.md) |
| Transport: the PEB | The Final Receipt travels with every piece of evidence it rests on, as one portable bundle. | [PEB.md](PEB.md) |
| Independent verification | A separate Verifier recomputes everything from the received bytes and returns one of four verdicts. | [VERIFICATION.md](VERIFICATION.md) |

Production, compilation, transport and verification are separate stages with separate
code. External evidence (for example the bank's authorization) is carried as evidence
of its own domain, and it is never rewritten into a FortiX claim.

## Principles

- **Evidence at one layer must never be promoted into proof of another layer.**
- **Authorization evidence is evidence of authorization. It is not evidence of delivery,
  application, or effect.** In D-006 the payment provider presents the instruction and
  the bank authorizes it. The Final Receipt records both, and it records settlement as
  `NOT_DEMONSTRATED`.
- **The verdict is recomputed, never received.** The Verifier ignores any verdict a
  source might claim and derives its own from the bytes it was given.
- **Trust boundaries are explicit.** Every record names the domain that produced it.
  Crossing a boundary is not causality, and neither is closeness in time: the Verifier
  draws only the relations that the evidence declares.
- **Not orchestration, not observability, not logging.** FortiX does not run the
  systems it verifies, does not monitor them, and does not replace their logs.

## What FortiX verifies, and what it does not

FortiX verifies the integrity, provenance, causal closure, authorization bindings and
trust status of evidence. It does not establish that the underlying business or AI
decision was correct, and it does not turn an authorization into proof that something
was delivered, applied or settled.

## Code map (D-006)

Paths are relative to [`demo/fortix-causal-editing-table/`](../../demo/fortix-causal-editing-table/)
unless they start with `site/`.

| Concern | Code | Tests |
| --- | --- | --- |
| NanoReceipts, signed and runtime | [`app/canonicalSignature.ts`](../../demo/fortix-causal-editing-table/app/canonicalSignature.ts), [`app/missionEvidence.ts`](../../demo/fortix-causal-editing-table/app/missionEvidence.ts), [`app/offlineEvidence.ts`](../../demo/fortix-causal-editing-table/app/offlineEvidence.ts) | [`tests/d006nx0-evidence-completeness.test.ts`](../../demo/fortix-causal-editing-table/tests/d006nx0-evidence-completeness.test.ts), [`tests/d006d-offline-evidence.test.ts`](../../demo/fortix-causal-editing-table/tests/d006d-offline-evidence.test.ts), [`tests/d006d-network-transitions.test.ts`](../../demo/fortix-causal-editing-table/tests/d006d-network-transitions.test.ts) |
| Causal compilation, Final Receipt, PEB | [`app/portableMissionEvidence.ts`](../../demo/fortix-causal-editing-table/app/portableMissionEvidence.ts) | [`tests/d006c1-portable-evidence.test.ts`](../../demo/fortix-causal-editing-table/tests/d006c1-portable-evidence.test.ts), [`tests/d006c1-financial-closure.test.ts`](../../demo/fortix-causal-editing-table/tests/d006c1-financial-closure.test.ts) |
| Handoff to the Verifier | [`app/verify/demoHandoff.ts`](../../demo/fortix-causal-editing-table/app/verify/demoHandoff.ts), [`site/src/verification/pebHandoff.ts`](../../site/src/verification/pebHandoff.ts) | [`tests/d006nx3-peb-transport.test.ts`](../../demo/fortix-causal-editing-table/tests/d006nx3-peb-transport.test.ts), [`site/tests/peb-handoff.test.ts`](../../site/tests/peb-handoff.test.ts) |
| Independent verification | [`app/offlineVerification.ts`](../../demo/fortix-causal-editing-table/app/offlineVerification.ts), [`app/masterStory.ts`](../../demo/fortix-causal-editing-table/app/masterStory.ts), [`app/trustAnchors.ts`](../../demo/fortix-causal-editing-table/app/trustAnchors.ts), [`app/verification.ts`](../../demo/fortix-causal-editing-table/app/verification.ts) | [`tests/d006nx3-offline-verifier.test.ts`](../../demo/fortix-causal-editing-table/tests/d006nx3-offline-verifier.test.ts), [`tests/d006g-p2r-adversarial.test.ts`](../../demo/fortix-causal-editing-table/tests/d006g-p2r-adversarial.test.ts), [`tests/d006g-p3-trust-authorization.test.ts`](../../demo/fortix-causal-editing-table/tests/d006g-p3-trust-authorization.test.ts) |
| Received-PEB inspection | [`app/verify/inspectReceivedPeb.ts`](../../demo/fortix-causal-editing-table/app/verify/inspectReceivedPeb.ts), [`app/verify/ReceivedPebInspection.tsx`](../../demo/fortix-causal-editing-table/app/verify/ReceivedPebInspection.tsx), [`app/verify/receivedGraph.ts`](../../demo/fortix-causal-editing-table/app/verify/receivedGraph.ts) | [`tests/fsr2-peb-inspection.test.ts`](../../demo/fortix-causal-editing-table/tests/fsr2-peb-inspection.test.ts), [`tests/fsr2-received-graph.test.ts`](../../demo/fortix-causal-editing-table/tests/fsr2-received-graph.test.ts) |

## Scope of the demonstration

D-006 is a demonstration. Its runtime records are classed `DEMONSTRATION_RUNTIME`, and
the signed source bundle declares a `DEMO_ONLY` trust scope. Production trust anchors
and trusted time are not established, and the D-006 Verifier has no path to `VALID`
today. A genuine D-006 PEB verifies as `INDETERMINATE`, and any change to the bytes that
were handed over verifies as `INVALID` (see [VERIFICATION.md](VERIFICATION.md)).

## Relation to ADR v1

ADR v1 (Audit Decision Record) is FortiX's historical, foundational receipt protocol and
its earlier layer: one signed receipt for one decision (BLAKE3 and Ed25519, verified
offline). It remains final
and locked; see [`docs/spec/`](../spec/README.md). It is not the whole of the current
architecture, which compiles many records from many domains into one Final Receipt and
carries them in a PEB.

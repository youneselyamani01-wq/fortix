# Causal compilation and the Final Receipt

Status: CURRENT.

The Final Receipt is the one receipt that closes a mission. It is issued by the FortiX
causal compiler from a deterministic compilation of the mission's NanoReceipts, and it
states what that evidence establishes and what it does not.

Part of the [evidence architecture](README.md):
Action → NanoReceipts → **causal compilation → Final Receipt** → PEB → Independent Verifier.

## Causal compilation

`buildMissionEvidenceClosure` in
[`app/portableMissionEvidence.ts`](../../demo/fortix-causal-editing-table/app/portableMissionEvidence.ts)
compiles the evidence set. It refuses to compile, with an explicit reason code, when:

| Condition | Reason code |
| --- | --- |
| the signed source bundle is not byte-identical to the immutable one | `SOURCE_BUNDLE_NOT_IMMUTABLE` |
| a runtime record does not carry the mission's Mission ID and Run ID | `RUNTIME_IDENTITY_MISMATCH` |
| a runtime record no longer matches its canonical digest | `RUNTIME_RECORD_DIGEST_MISMATCH` |
| journal order is broken, or a record does not name the exact previous receipt | `RUNTIME_CAUSAL_ORDER_INVALID` |
| an event is outside the closed D-006 profile | `RUNTIME_EVENT_NOT_ALLOWED` |
| evidence was authored at or after the Final Receipt boundary | `POST_FINAL_RUNTIME_EVIDENCE` |
| an in-mission reconciliation is not bound to the journal prefix it names | `RUNTIME_RECONCILIATION_UNBOUND` |
| a causal parent or observed input is absent from the closure | `CAUSAL_CLOSURE_INCOMPLETE` |

When compilation succeeds, it does three more things:

- it quarantines claims that the evidence cannot support (for example a settlement
  asserted by a party that cannot settle), and any compiled receipt that rests on a
  quarantined claim is quarantined too;
- it separates presented evidence from assurance support;
- it fixes the `evidenceSetDigest`, a BLAKE3 digest over every member.

Compilation is deterministic: the same evidence always gives the same closure. The
Verifier relies on this to recompute it.

## The Final Receipt

`issueFinalMissionReceipt` issues the receipt only at the exact emission boundary, and
only when all required runtime evidence is present. Its fields:

| Field | Content |
| --- | --- |
| `profile` | `fortix.demo.d006.final-receipt.v1` |
| `identity` | the Mission ID and Run ID |
| `eventId` | `d006.final-mission-receipt` |
| `issuedAtMasterTimeMs` | the fixed emission boundary |
| `causalInputEvidenceIds` | the presented, non-quarantined evidence it rests on |
| `evidenceSetDigest` | the digest fixed by causal compilation |
| `financialClosure` | authorization, submission and settlement, stated as three distinct facts |
| `receiptId` | `fortix:receipt:blake3:` followed by the BLAKE3 digest of the canonical body |

The financial closure must read authorization `AUTHORIZED`, transaction submission
`PRESENTED` and settlement `NOT_DEMONSTRATED`; otherwise the receipt is refused
(`FINANCIAL_CLOSURE_INCOMPLETE`). The bank's authorization is evidence of authorization.
It is not evidence that money moved.

The D-006 Final Receipt is content-addressed, not separately signed. Two things make it
checkable. The Verifier recompiles it from the evidence in the PEB and requires an exact
match. The signed source evidence among its inputs is checked against authorized keys
(see [VERIFICATION.md](VERIFICATION.md)).

## What the Final Receipt does not prove

- It does not prove settlement, delivery or effect. It states that settlement is not
  demonstrated.
- It does not prove that a decision was right, only what was decided and on what
  evidence.
- It covers nothing after its emission boundary. A completion capture or a reconciliation
  made after issuance can never support it.
- An identifier listed in `causalInputEvidenceIds` is not proof on its own; the Verifier
  checks every listed member.

## Earlier receipts in the same codebase

- D-003 compiles one signed Final Receipt
  ([`data/d003-final-receipt.json`](../../demo/fortix-causal-editing-table/data/d003-final-receipt.json)).
- D-005 compiles five sub-mission receipts into one Vehicle Operational Cycle Receipt
  ([`data/d005-operational-cycle-receipt.json`](../../demo/fortix-causal-editing-table/data/d005-operational-cycle-receipt.json)).
- D-005M extends that cycle with the payment and return-to-base receipts
  ([`data/d005m-master-operational-cycle-receipt.json`](../../demo/fortix-causal-editing-table/data/d005m-master-operational-cycle-receipt.json)).
  Its bundle,
  [`data/d005m-master-portable-evidence-bundle.json`](../../demo/fortix-causal-editing-table/data/d005m-master-portable-evidence-bundle.json),
  is the signed source evidence that D-006 wraps.

## Tests

- [`tests/d006c1-portable-evidence.test.ts`](../../demo/fortix-causal-editing-table/tests/d006c1-portable-evidence.test.ts):
  one content-derived closure drives the proof view, the Final Receipt, the PEB and the
  exact-byte handoff. Final Receipt support survives a later network append.
- [`tests/d006c1-financial-closure.test.ts`](../../demo/fortix-causal-editing-table/tests/d006c1-financial-closure.test.ts):
  a provider's `SETTLED` stays quarantined despite bank authorization, and the Final
  Receipt states authorization and presentation without claiming settlement.
- [`tests/d003-verification.test.ts`](../../demo/fortix-causal-editing-table/tests/d003-verification.test.ts):
  a Final Receipt cannot exist before its evidence is eligible, and input order cannot
  change the receipt or the bundle.

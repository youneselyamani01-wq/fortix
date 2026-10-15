# NanoReceipts

Status: CURRENT.

A NanoReceipt is the smallest unit of FortiX evidence: one canonical record of one
significant event, produced by the domain where the event happened. FortiX does not
produce the event. It records the evidence of it, and later verifies that evidence.

Part of the [evidence architecture](README.md):
**Action → NanoReceipts** → causal compilation → Final Receipt → PEB → Independent Verifier.

## The two kinds in D-006

**Signed canonical evidence.** These are the 45 objects of the signed D-005M source
bundle
([`data/d005m-master-portable-evidence-bundle.json`](../../demo/fortix-causal-editing-table/data/d005m-master-portable-evidence-bundle.json)).
Each object has:

- an identifier derived from its content (`fortix:evidence:blake3:…`);
- an issuer and a `significant_event` (`event_id`, `event_type`, `event_time`);
- `causal_links` that name its predecessor;
- a payload and a lifecycle;
- an Ed25519 signature, checked by
  [`app/canonicalSignature.ts`](../../demo/fortix-causal-editing-table/app/canonicalSignature.ts).

**Runtime NanoReceipts.** These are written to the mission journal while D-006 runs. They
are specified in
[`app/missionEvidence.ts`](../../demo/fortix-causal-editing-table/app/missionEvidence.ts)
and recorded as `OfflineCausalRecord` in
[`app/offlineEvidence.ts`](../../demo/fortix-causal-editing-table/app/offlineEvidence.ts).
Each record carries:

- `missionId` and `runId`;
- `eventId`, `eventType` and `receiptId`;
- `missionClockPosition` and `causalPredecessors`;
- `evidenceLocality` and `executionLocality`;
- a payload and its `canonicalDigest`.

The journal is append-only. Each record names the exact previous receipt as its
predecessor, and positions strictly increase. One physical network transition, observed
by the link sentinel, writes exactly one network NanoReceipt.

In the Verifier, the NanoReceipt label goes only to an identified, presented signed or
runtime member. Support material and the Final Receipt are never NanoReceipts
([`app/verify/receivedReceiptLabels.ts`](../../demo/fortix-causal-editing-table/app/verify/receivedReceiptLabels.ts)).

## Runtime NanoReceipts by producer domain

| Producer domain | Receipt identifiers | Events |
| --- | --- | --- |
| `SMART_CITY_INFRASTRUCTURE` | `NR-CITY-DETECTION`, `NR-CITY-PHASE`, `NR-SIGNAL-STATE` | sensor detection, signal phase decided, signal state published |
| `AUTONOMOUS_VEHICLE` | `NR-PERCEPTION`, `NR-DECISION`, `NR-ACTION`, `NR-RESULT` | observation, autonomous decision (for example the hazard stop), vehicle action and its result |
| `ROUTING_ORCHESTRATOR` | `NR-ROUTING-PROVENANCE` | which routing candidate was chosen and why; the candidates are simulated and labelled `SIMULATED_LOCAL` |
| `PAYMENT_PROVIDER` | `NR-PAYMENT-INSTRUCTION` | the provider presents the signed payment instruction |
| `FINANCIAL_INSTITUTION` | `NR-BANK-AUTHORIZATION`, `NR-BANK-CONFIRMATION` | the bank authorizes the presented instruction, then returns its confirmation |
| `HUMAN_APPROVER` | `NR-HUMAN-DECISION` | a live denial, when the person denies the approval request |
| `NETWORK` | `NR-NET-LOST`, `NR-NET-RESTORED`, `RR-OFFLINE-RECONCILIATION` | link lost, link restored, in-mission reconciliation |

The signed source evidence carries the rest of the mission:

- the passenger request and authority;
- the congestion reroute;
- the diagnostic and garage maintenance, with its maintenance authority;
- the €1,850 invoice above the €500 autonomous limit;
- the human approval request and approval;
- the payment authority;
- the return to base.

## What a NanoReceipt does not prove

- It proves that a record with this content exists and, for signed evidence, which
  authorized key signed it. It does not prove that the event happened in the physical
  world as described.
- A declared causal parent is a declaration. The compiler and the Verifier check that it
  resolves inside the closure; order in time and visual proximity never create a link.
- A D-006 runtime NanoReceipt is bound by its digest and by the journal chain. It is not
  signed on its own. Its integrity in transit comes from the PEB digests and from the
  expected transfer digest, which the Verifier never reads from the PEB itself (see
  [VERIFICATION.md](VERIFICATION.md)).

## Tests

- [`tests/d006nx0-evidence-completeness.test.ts`](../../demo/fortix-causal-editing-table/tests/d006nx0-evidence-completeness.test.ts):
  every significant observable action carries an explicit evidence decision. A receipt
  follows the actual action; a red light alone produces no brake receipt.
- [`tests/d006d-offline-evidence.test.ts`](../../demo/fortix-causal-editing-table/tests/d006d-offline-evidence.test.ts),
  [`tests/d006d-network-transitions.test.ts`](../../demo/fortix-causal-editing-table/tests/d006d-network-transitions.test.ts)
  and [`tests/d006g-p3-network-evidence.test.ts`](../../demo/fortix-causal-editing-table/tests/d006g-p3-network-evidence.test.ts):
  - one network NanoReceipt per physical transition, with no phantom receipts;
  - exactly-once replay;
  - only the target sentinel may author network evidence.
- [`tests/received-receipt-labels.test.ts`](../../demo/fortix-causal-editing-table/tests/received-receipt-labels.test.ts):
  support material and the Final Receipt never become NanoReceipts, and missing or
  duplicated identities receive no fabricated identifier.
- [`tests/d006g-p3-causal-edges.test.ts`](../../demo/fortix-causal-editing-table/tests/d006g-p3-causal-edges.test.ts):
  every causal parent is an evidence identity read from the signed declaration, never
  from the presentation model.

The earlier D-002 prototype modelled NanoReceipts in
[`app/evidence.ts`](../../demo/fortix-causal-editing-table/app/evidence.ts), tested by
[`tests/evidence-model.test.ts`](../../demo/fortix-causal-editing-table/tests/evidence-model.test.ts).

# FortiX Causal Editing Table · D-001 through D-006

This application hosts D-006, the autonomous-taxi mission that is the current canonical
FortiX demonstration, together with the earlier stages D-001 to D-005 it is built on.

## D-006: from NanoReceipts to independent verification

One mission crosses the city infrastructure, vehicle, routing, payment provider, bank,
human approver and network domains, and every significant event becomes a NanoReceipt.
At the end of the mission:

- causal compilation issues one Final Receipt;
- the Portable Evidence Bundle (PEB) carries it with all its evidence;
- the person hands the PEB to an Independent Verifier that runs in a separate browser
  context.

| Route | What it is |
| --- | --- |
| `/nx` | The mission: the world, the evidence as it is produced, the Final Receipt and the PEB handoff |
| `/verify` | The Independent Verifier: it receives a PEB, analyzes it on request, and shows the verdict and reading views |
| `/` | The earlier convergence experience, kept as a reference for comparison |

| Concern | Code |
| --- | --- |
| NanoReceipts and the runtime journal | [`app/missionEvidence.ts`](app/missionEvidence.ts), [`app/offlineEvidence.ts`](app/offlineEvidence.ts) |
| Causal compilation, Final Receipt, PEB, handoff | [`app/portableMissionEvidence.ts`](app/portableMissionEvidence.ts) |
| Independent Verifier | [`app/offlineVerification.ts`](app/offlineVerification.ts), [`app/verify/`](app/verify/) |
| Mission experience | [`app/nx/`](app/nx/) |

The architecture is documented in [`docs/evidence/`](../../docs/evidence/README.md).

Accuracy boundary:

- the vehicle, the city and the routing are simulated;
- physical network loss is observed only when the host sentinel and adapter are configured locally (see below); otherwise physical status remains `UNKNOWN`;
- production trust anchors and trusted time are not part of the demonstration, so a
  genuine PEB verifies as `INDETERMINATE`, and any change to the bytes that were handed
  over as `INVALID`;
- settlement is recorded as not demonstrated.

## Earlier stages: D-001 to D-005

D-001 is an isolated functional prototype for a deterministic causal replay table.

The initial experience has exactly three synchronized primary bands:

1. Reality
2. System
3. Proof

Every visible event state is derived from one `masterTime` value in `app/timeline.ts`. Playback uses a single animation driver only to advance that value; no band owns an independent clock. Rewind, frame stepping, marker selection, and scrubbing all set the same authoritative value.

The D-002 layer replaces the placeholder PROOF presentation with deterministic
Canonical Evidence Object fixtures created by the frozen FortiX Core builders.
REALITY and SYSTEM never manufacture PROOF; the UI shows missing Evidence
separately from Evidence that is available but not independently verified.

D-003 deterministically compiles one signed Final Receipt at `05.340`, packages
the receipt and its material closure in a real `fortix.peb.core.v1` Portable
Evidence Bundle, and sends only that portable input to an independent browser
verifier. Verification is explicit, recomputed, and honestly returns
`INDETERMINATE` because the included trust/time material is demo-only.

The scenario remains placeholder data. It does not integrate Unreal, production
trust/time, a production signing identity, or FortiX Intelligence.

D-005 adds an autonomous-taxi operational cycle as an additive evidence layer.
One 120-second relative `masterTime` drives the Overview, Mission, and Forensic
views across REALITY, SYSTEM, and PROOF. Twenty-nine significant events compile
into five immutable sub-mission receipts, then into one Vehicle Operational
Cycle Receipt and its own Portable Evidence Bundle. The existing D-002, D-003,
and D-004 fixtures are not rewritten.

## Local commands

Use Node 22.23.2 and install with `npm ci --ignore-scripts` first.

```bash
npm run dev
npm run test:d002
npm run test:d003
npm run test:d005
npm run test:unit
npm run test:d006nx3
npm run test:network-continuity
npm test
```

## Physical link on the demonstration host

Status: CURRENT for D-006; earlier stages are REFERENCE.

The physical-link demonstration binds two exact adapters by their Windows
interface GUIDs. The repository commits placeholders that match no real
adapter. The demonstration host keeps its own GUIDs in `.env.local`, which
`.gitignore` excludes:

```dotenv
NEXT_PUBLIC_FORTIX_ETHERNET_GUID=<InterfaceGuid of the Intel(R) Ethernet Controller I226-LM>
NEXT_PUBLIC_FORTIX_WIFI_GUID=<InterfaceGuid of the Intel(R) Wi-Fi 7 BE200 320MHz>
```

`Get-NetAdapter -Physical | Select-Object Name, InterfaceDescription, InterfaceGuid`
lists them.

After creating or changing the file:
- stop any link sentinel left running from an earlier session, because `npm run dev` reuses it;
- restart `npm run dev`.

The bundler inlines the two values into the locally served pages when it
starts, and `scripts/link-sentinel.mjs` reads the same file when it starts.
Without the file, no adapter matches and the link stays `UNKNOWN`.

# FortiX

Status: CURRENT.

## English Version

**Official website:** https://fortix.cloud

FortiX packages evidence of a digital action so another party can verify it from the received bytes, without access to the producing systems.

**FortiX does not orchestrate. FortiX verifies.**

```text
Action → NanoReceipts → causal compilation → Final Receipt → PEB
       → Independent Verifier → VALID / INVALID / INDETERMINATE / REVOKED
```

Each NanoReceipt records one significant event and its declared causal parents. The causal compiler checks the evidence closure and issues a content-addressed Final Receipt. A Portable Evidence Bundle (PEB) carries that receipt and its evidence. The Independent Verifier checks the received bytes, signatures under its own pinned anchors, expected identity, transfer digest and recomputed closure. A source's verdict is never accepted as the verifier's verdict.

**Authorization evidence is evidence of authorization. It is not evidence of delivery, application, or effect.**

### Canonical demonstration: D-006

The autonomous-taxi mission includes a passenger ride, congestion rerouting, maintenance, human approval above an autonomous spending limit, payment authorization and return to base. It produces runtime evidence and hands a PEB to a separate verification context.

The vehicle, city and routing are **simulated**. Physical network observations are available only when a compatible local Windows adapter and sentinel are configured. Without that configuration the physical link remains `UNKNOWN`; no real observation is claimed. Machine configuration stays in ignored local files. Production trust anchors and trusted time are not established. Settlement is `NOT_DEMONSTRATED`. A genuine D-006 PEB is `INDETERMINATE`; D-006 makes no production `VALID` claim. Evidence integrity does not establish that a physical event happened or a business decision was correct.

Use Node **22.23.2** (the version in `.nvmrc`) and the committed npm lockfiles:

```sh
cd demo/fortix-causal-editing-table
npm ci --ignore-scripts
npm run dev
# mission: http://localhost:3000/nx
# verifier: http://localhost:3000/verify
```

Run `npm run validate` there for runtime, type, lint, unit, convergence, build and rendered checks. Additional public checks: `npm run test:d006nx1`, `npm run test:d006nx2`, `npm run test:d006nx3`, and `npm run test:network-continuity`.

### Public D-006 reference: inspect and compare

For an independent evaluation, retrieve the [public PEB reference and its limits](docs/evidence/D006-PUBLIC-REFERENCE.md). The expected values are also [published separately from the PEB](https://github.com/youneselyamani01-wq/fortix/issues/2): transfer BLAKE3 `cb2786db914459e56f64c0a70f7993d8f44db5a6403c1a77c6015ed3ddb0e1a1` (264966 exact UTF-8 bytes with LF), Mission ID `fortix.demo.d005.operational-cycle-001`, Run ID `fortix.d006.audit.after`. A comparison against a digest recomputed only from the candidate PEB is not external authentication.

The **reference network observations** were written during a distinct local sentinel test; the **public web mission** normally has physical link `UNKNOWN` unless a local sentinel is configured. The runtime journal is not individually signed, so its internal digest coherence does not independently attest physical observations. D-006 tests known scenario steps and payloads; it is not a general verifier of arbitrary agents. Genuine D-006 verification remains `INDETERMINATE`.

### Python foundational layer

ADR v1 is the foundational single-receipt protocol, separate from the D-006 multi-domain PEB profile. The retained Python runtime, SDK and 15 frozen normative vectors support reproducible ADR signing and verification checks. D-006's four verdicts do not replace the result vocabularies of earlier layers.

```sh
python -m venv .venv
# Activate: .venv/Scripts/activate on Windows, source .venv/bin/activate on POSIX
python -m pip install --index-url https://pypi.org/simple --upgrade pip==26.2
pip install -r requirements.txt
python -m pytest -q
```

Production signing still requires `FORTIX_ADR_SIGNING_PRIVATE_KEY_HEX` and `FORTIX_ADR_SIGNING_KEY_ID`; without them the API fails closed with HTTP 503. `tests/conftest.py` supplies a deterministic **TEST ONLY / PUBLIC / NON SECRET** fixture key and the fail-closed tests remove it again. Never use demonstration or test keys for production.

### Site

```sh
cd site
npm ci --ignore-scripts
npm run typecheck
npm run lint
npm test
npm run check:i18n
npm run check:links
npm run build
```

Local installation and testing commands describe technical reproduction. They do not grant a general license. This repository is **PROPRIETARY / ALL RIGHTS RESERVED**; any use requiring permission must be authorized in writing. Third-party assets retain their own notices.

### Read and verify

- [Current evidence architecture](docs/evidence/README.md): NanoReceipts, Final Receipt, PEB and Independent Verifier, with code and tests.
- [D-006 setup and physical-link boundaries](demo/fortix-causal-editing-table/README.md).
- [ADR foundation](docs/spec/README.md), marked REFERENCE.
- [Public claims and evidence](docs/PUBLIC-CLAIMS.md).
- [License](LICENSE) and [security reporting](SECURITY.md).

## Version Française

**Site officiel :** https://fortix.cloud

FortiX rassemble les preuves d’une action numérique pour qu’un tiers les vérifie depuis les octets reçus, sans accès aux systèmes producteurs. **FortiX n’orchestre pas. FortiX vérifie.**

Action → NanoReceipts → compilation causale → Final Receipt → PEB → Independent Verifier → `VALID` / `INVALID` / `INDETERMINATE` / `REVOKED`.

Chaque NanoReceipt décrit un événement et ses parents causaux déclarés. La compilation contrôle la clôture des preuves et émet le Final Receipt. Le PEB transporte ce reçu et ses preuves. Le vérificateur recalcule depuis les octets reçus, avec ses propres ancres et des attentes d’identité et de transfert indépendantes du PEB.

Une preuve d’autorisation est une preuve d’autorisation. Ce n’est pas une preuve de livraison, d’application ou d’effet.

D-006 reste la démonstration canonique. Le véhicule, la ville et le routage sont simulés. Le réseau physique n’est observé que si une sentinelle Windows compatible est configurée localement ; sinon son état reste `UNKNOWN`. La configuration machine est exclue du dépôt. Les ancres de production et le temps de confiance ne sont pas établis ; le règlement reste `NOT_DEMONSTRATED`. Un PEB D-006 authentique donne `INDETERMINATE`, sans promesse de `VALID` en production. L’intégrité d’une preuve ne démontre ni la réalité physique de l’événement ni la justesse de la décision.

Pour reproduire les contrôles, utiliser Node 22.23.2 et les lockfiles, puis les commandes D-006, Python et Site indiquées dans la version anglaise ci-dessus. Le socle ADR v1 est distinct du profil PEB D-006. La signature de production échoue fermée sans vraie configuration ; les clés de tests déterministes sont **TEST ONLY / PUBLIC / NON SECRET**.

Le code est **PROPRIETARY / ALL RIGHTS RESERVED**. Les commandes de reproduction ne constituent pas une autorisation générale de réutilisation. Voir [LICENSE](LICENSE), [SECURITY.md](SECURITY.md) et la [documentation actuelle](docs/evidence/README.md).

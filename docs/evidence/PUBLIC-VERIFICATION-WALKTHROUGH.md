# Public verification walkthrough — D-006

Status: DOCUMENTED DEMONSTRATION; the steps below are instructions, not a test report.

## English

**Don't trust. Verify.** A public evaluator should not have to execute the whole autonomous-taxi mission to obtain inspection input.

1. Download the [D-006 reference PEB](../../site/public/evidence/d006-reference-peb.json), or use the deployed `/evidence/d006-reference-peb.json` URL once published.
2. Open [the independent verifier](https://fortix.cloud/verify) in a separate browser context. Select the downloaded PEB and choose **Analyze**.
3. Inspect the actual verdict, reasons, signed source evidence, NanoReceipts, causal graph and Final Receipt.
4. Save a copy locally and change one byte. Analyze the changed file separately; retain the original as a baseline.
5. For independent reproduction outside FortiX's hosted service, follow [code and test map](README.md) and the [D-006 local commands](../../demo/fortix-causal-editing-table/README.md).

### What the outcome means

A genuine D-006 demo PEB is expected to produce `INDETERMINATE`, **not** production `VALID`: production trust anchors and trusted time are not established. This is a bounded result, not successful attestation of real-world events. Alteration can result in `INVALID` when a relevant integrity or binding check fails; the verifier determines the result rather than trusting an asserted outcome. Do not promise a fixed verdict without running the check against the exact input and independent verifier context. The vehicle, city and routing are simulated. Bank authorization does not establish settlement. Network assertions depend on their stated observation source.

### Mandatory independent expectations and trust limits

Before loading the file, obtain this reference **from a separately published page**, not from the candidate JSON: [D-006 digest registry](https://github.com/youneselyamani01-wq/fortix/issues/2) (or the [reference scope document](D006-PUBLIC-REFERENCE.md)). Exact-byte BLAKE3-256: `cb2786db914459e56f64c0a70f7993d8f44db5a6403c1a77c6015ed3ddb0e1a1`; Mission ID `fortix.demo.d005.operational-cycle-001`; Run ID `fortix.d006.audit.after`; Final Receipt `fortix:receipt:blake3:6a782cf26723f2b0fdc174573ca812d5352209307612360d1ed3e1fc8c4b1ed4`. File is 264966 UTF-8 bytes with LF line endings and final newline; Windows CRLF conversion breaks the expected transfer digest.

The reference's local-sentinel network entries are unsigned runtime source claims, unlike the web demo's default network `UNKNOWN`. The verifier has fixed expected D-006 scenario event/payload checks. A changed unsigned journal rebuilt with new internal digests can remain self-consistent but **will not** match the separately pinned original file digest. Neither presentation eligibility nor `INDETERMINATE` authenticates the source of a physical observation.

## Français

**Don't trust. Verify.** Il n'est pas nécessaire de lancer toute la mission du taxi autonome pour obtenir un dossier de preuves à inspecter.

1. Télécharger le [PEB D-006 de référence](../../site/public/evidence/d006-reference-peb.json) ou, après publication du site, ouvrir `/evidence/d006-reference-peb.json`.
2. Ouvrir le [Vérificateur indépendant](https://fortix.cloud/verify), déposer ce fichier et choisir **Analyser**.
3. Examiner le verdict réellement calculé, ses motifs, les NanoReceipts, le graphe causal et le Final Receipt.
4. Conserver l'original. Modifier un octet dans une copie et analyser séparément cette copie.
5. Pour reproduire la vérification hors du service hébergé, suivre la [documentation du code et des tests](README.md) ainsi que les [commandes locales D-006](../../demo/fortix-causal-editing-table/README.md).

### Portée de la preuve

Le résultat attendu d'un PEB D-006 authentique est `INDETERMINATE`, et non `VALID` en production : les ancres de confiance de production et le temps de confiance ne sont pas établis. Ce verdict ne prouve ni des événements physiques réels ni la justesse d'une décision métier. Une altération peut donner `INVALID` lorsqu'un contrôle pertinent échoue ; le résultat doit être recalculé et non annoncé comme acquis. Le véhicule, la ville et le routage sont simulés. L'autorisation bancaire n'est pas une preuve de règlement. Les observations réseau doivent être interprétées selon leur provenance.

The repository remains proprietary; read [LICENSE](../../LICENSE).

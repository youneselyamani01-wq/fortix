# D-006 public PEB — verification reference and limits

Status: PUBLIC REFERENCE / DEMONSTRATION; production attestations **not established**.

This document is published **outside** the JSON bundle. The public, separately dated reference record is [GitHub issue #2](https://github.com/youneselyamani01-wq/fortix/issues/2). A record controlled by the same publisher is useful for comparison, but is **not** a third-party signature, independent trust anchor or trusted timestamp.

## Identifiers expected by the Verifier

| Field | Pinned reference |
| --- | --- |
| File | [`d006-reference-peb.json`](../../site/public/evidence/d006-reference-peb.json) |
| Exact-file BLAKE3-256 (transfer digest) | `cb2786db914459e56f64c0a70f7993d8f44db5a6403c1a77c6015ed3ddb0e1a1` |
| File size | `264966` bytes |
| Character encoding | UTF-8; LF line endings; ends with LF |
| Mission ID | `fortix.demo.d005.operational-cycle-001` |
| Run ID | `fortix.d006.audit.after` |
| Final Receipt ID | `fortix:receipt:blake3:6a782cf26723f2b0fdc174573ca812d5352209307612360d1ed3e1fc8c4b1ed4` |
| Declared `bundleId` | `fortix:peb:blake3:f66387092cddaaac5209a96992940841058400f7e36b537e9a2508a39ac5dd03` |
| Declared `manifest.bundleDigest` | `a3cc1eaff57fb322da7b0502ff73ae6ecaa79d822a14509bdf787dc8259ac7e1` |

The exact-file BLAKE3 was independently recomputed from the GitHub text with a separate implementation checked against known-answer vectors. It agrees with the outside reviewer value, but this document does not claim to certify a separately signed run.

### Use the independent expectations

1. Download **raw bytes**, unchanged, from the linked PEB or through the website's file-download button once deployed. Save as `.json`. Do **not** copy-and-paste, prettify, minify, or convert newlines (Windows CRLF differs from LF).
2. Obtain the expected transfer digest, Mission ID and Run ID from [the distinct published issue](https://github.com/youneselyamani01-wq/fortix/issues/2) **before** analyzing the file. Do not derive expectations from the candidate file itself.
3. In [the FortiX Verifier](https://fortix.cloud/verify), provide the file, enter those expectations where requested, then explicitly select **Analyze**.
4. Inspect the **actual** verdict and reason codes. `INDETERMINATE` is the expected genuine D-006 demonstration result; **not** a production `VALID` claim.
5. To test integrity, edit a **copy** and reanalyze it against the **original pinned transfer digest**. Do not compute a new expected digest from the altered file to prove origin: a changed payload and its freshly computed hash trivially match each other.

The file's `bundleId` hashes a draft canonical PEB with `bundleId=""` and `manifest.bundleDigest=""`. Then `manifest.bundleDigest` hashes the canonical PEB with the `bundleId` filled and `manifest.bundleDigest=""`. Finally the **transfer digest** hashes the exact UTF-8 file text as delivered, including whitespace and line endings. These are distinct values with distinct roles.

## What is and is not authenticated

- The `sourceBundle` includes individually signed canonical evidence. The D-006 `runtimeRecords` are **not individually signed**: their content hash, journal chain, Final Receipt and transfer-digest binding can detect alteration **against an independently obtained expected digest**, but are not independent producer attestations.
- An actor able to rebuild unsigned runtime records and regenerate internal digests can produce a **different** structurally consistent candidate with a different Final Receipt and transfer digest. A comparable `INDETERMINATE` verdict by itself does **not** mean two candidates are the same reference or equally authenticated. A verifier must be supplied the original expected digest and identity from outside the PEB to reject such substitution.
- This D-006 verifier checks a **known canonical scenario profile**: some event IDs, event ordering, decisions and runtime payloads are constrained by fixed expected D-006 specifications. Passing this profile proves consistency with that particular scripted demonstration plus supported cryptographic checks; it is **not generic conformance for arbitrary agents, decisions or actions**.
- The **web demo** reports physical network status `UNKNOWN` without a configured local sentinel. The **reference PEB** originates from a separately captured local D-006 test with network entries labeled `*_PHYSICAL_SENTINEL` and adapter model names (Intel I226-LM and Wi-Fi 7 BE200). The labels are claims of observation source inside an unsigned runtime journal; **they do not amount to independent signed proof of physical link transitions**.
- A `PRESENTED` / `ELIGIBLE` field concerns evidence inclusion and presentation, not cryptographic attestation of a physical source.
- Production trust anchors and trusted time are missing. Bank authorization does not prove bank settlement; `NOT_DEMONSTRATED` remains the truthful state.

### Boundary: what remains to engineer

A stronger generic profile requires a **source-attested runtime record/journal** with authenticated issuer identity and a documented signing and trust lifecycle, plus independently authenticated publication of the expected bundle digest or trusted handoff. It also needs a generic, versioned evidence schema and verifier behavior that do not hard-code the D-006 taxi script. These are **future engineering gates**, not capabilities implied by the current public fixture.

## Français — lecture rapide

**Référence extérieure au PEB :** [registre public GitHub #2](https://github.com/youneselyamani01-wq/fortix/issues/2).

- **BLAKE3 du transfert (octets exacts)** : `cb2786db914459e56f64c0a70f7993d8f44db5a6403c1a77c6015ed3ddb0e1a1` ; **264 966 octets**, UTF-8 et retours de ligne LF. Ne pas convertir en CRLF.
- **Mission ID** : `fortix.demo.d005.operational-cycle-001`. **Run ID** : `fortix.d006.audit.after`.
- **Final Receipt** : `fortix:receipt:blake3:6a782cf26723f2b0fdc174573ca812d5352209307612360d1ed3e1fc8c4b1ed4`.
- **Comparer au registre avant de vérifier** : calculer l'empreinte du fichier candidat ne suffit pas à établir son identité. Utiliser la valeur publiée séparément, puis cliquer sur **Analyser**. Le résultat attendu est `INDETERMINATE`, sans revendication de `VALID` de production.
- **Journal runtime non signé individuellement** : son intégrité peut être contrôlée avec une référence externe, mais cela ne prouve pas indépendamment l'origine physique des événements. Les événements réseau du PEB proviennent d'un essai local avec sentinelle déclarée, contrairement à la démo web (`UNKNOWN` sans sentinelle). Leur authenticité physique n'est pas établie.
- **Profil spécifique D-006** : certains événements sont comparés à des données et règles du scénario taxi connues du code. Ceci n'est pas un vérificateur universel.
- **Trois empreintes différentes** : `bundleId` (brouillon canonique sans identifiant), `manifest.bundleDigest` (PEB canonique avec identifiant mais champ digest vide) et **empreinte de transfert** (fichier UTF-8 exact). Ne pas les substituer.

This document does not change the verifier implementation or convert unsigned evidence into signed evidence.

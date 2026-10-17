# FortiX public verification reference

Status: DEMONSTRATION / REVIEW CANDIDATE — not a production trust assertion.

## Reference input

- File: [d006-reference-peb.json](d006-reference-peb.json)
- Profile: `fortix.demo.d006.peb.v1`
- Mission ID: `fortix.demo.d005.operational-cycle-001`
- Run ID: `fortix.d006.audit.after`
- Declared bundle ID: `fortix:peb:blake3:f66387092cddaaac5209a96992940841058400f7e36b537e9a2508a39ac5dd03`
- 71 manifest member references, 25 runtime records.
- Origin: existing published fixture `artifacts/d006-network-continuity-20261002/peb-after-network-cycle.json`, copied byte-for-byte into the site static assets.

**Do not substitute the manifest digest for the transfer digest.** The verifier must compute the transfer digest from the exact received bytes.

## Reproduce

1. Download the JSON file from the website (or this directory).
2. Open the [independent verifier](https://fortix.cloud/verify) and provide the downloaded file.
3. Trigger **Analyze**; record the actual verdict, reason codes and completed checks.
4. As a separate experiment, alter a byte in a copied PEB and compare the resulting verdict. Do not modify the baseline file.

A D-006 demo input does **not** establish production trusted time, production trust anchors, real vehicle/city activity, physical bank settlement or the business correctness of a decision. A genuine D-006 demonstration PEB is expected to be **INDETERMINATE** when analyzed with the appropriate verifier context. The output is not claimed here as a freshly executed test.

The source already lives in the public repository, but publication through the site still requires a final security/content gate. Check the current public documentation at [evidence architecture](../../../docs/evidence/README.md) and [verification](../../../docs/evidence/VERIFICATION.md).

License: repository is proprietary; visibility is not permission to reuse.

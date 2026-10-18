import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { blake3 } from "@noble/hashes/blake3.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { verifyD006PortableMissionEvidence } from "../app/offlineVerification.ts";
import { transferredContentDigest } from "../app/portableMissionEvidence.ts";

/** Launch gate for one exact PUBLIC demo fixture; never use internal self-digests as expectations. */
const ORIGINAL_DIGEST = "cb2786db914459e56f64c0a70f7993d8f44db5a6403c1a77c6015ed3ddb0e1a1";
const EXPECTED_IDENTITY = {
  missionId: "fortix.demo.d005.operational-cycle-001",
  runId: "fortix.d006.audit.after",
} as const;
const EXPECTED_FINAL_RECEIPT = "fortix:receipt:blake3:6a782cf26723f2b0fdc174573ca812d5352209307612360d1ed3e1fc8c4b1ed4";
const PUBLIC_PEB = new URL("../../../site/public/evidence/d006-reference-peb.json", import.meta.url);
const ORIGINAL_FIXTURE = new URL("../../../artifacts/d006-network-continuity-20261002/peb-after-network-cycle.json", import.meta.url);

test("published BLAKE3 exact bytes agree with separately pinned reference", () => {
  assert.equal(bytesToHex(blake3(utf8ToBytes(""))), "af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262");
  assert.equal(bytesToHex(blake3(utf8ToBytes("abc"))), "6437b3ac38465133ffb63b75273a8db548c558465d79db03fd359c6cd5bd9d85");
  const raw = readFileSync(PUBLIC_PEB);
  const source = readFileSync(ORIGINAL_FIXTURE);
  assert.equal(raw.byteLength, 264966);
  assert.deepEqual(raw, source, "The published site asset must stay exact-byte identical to the original fixture");
  assert.equal(raw.at(-1), 10, "A final LF byte is part of the pinned value");
  assert.equal(raw.includes(Buffer.from("\r\n")), false, "CRLF rewriting must not enter the release artifact");
  assert.equal(bytesToHex(blake3(raw)), ORIGINAL_DIGEST);
  assert.equal(transferredContentDigest(raw.toString("utf8")), ORIGINAL_DIGEST);
  const parsed = JSON.parse(raw.toString("utf8")) as {
    identity: { missionId: string; runId: string };
    finalReceipt: { receiptId: string };
  };
  assert.deepEqual(parsed.identity, EXPECTED_IDENTITY);
  assert.equal(parsed.finalReceipt.receiptId, EXPECTED_FINAL_RECEIPT);
});

test("published input verifies only against independently pinned identity and digest", async () => {
  const raw = readFileSync(PUBLIC_PEB, "utf8");
  const verified = await verifyD006PortableMissionEvidence(raw, {
    expectedIdentity: EXPECTED_IDENTITY,
    expectedTransferredContentDigest: ORIGINAL_DIGEST,
  });
  assert.equal(verified.verdict, "INDETERMINATE", "D-006 does not establish production trusted time");
});

test("reformatted or changed copies fail against the ORIGINAL externally pinned digest", async () => {
  const raw = readFileSync(PUBLIC_PEB, "utf8");
  const inputs = [
    raw.replace(/\n/g, "\r\n"), // exact-byte transfer changes
    JSON.stringify(JSON.parse(raw)), // whitespace/minification changes
    raw.replace('"runId": "fortix.d006.audit.after"', '"runId": "fortix.d006.audit.after.replaced"'),
  ];
  for (const altered of inputs) {
    assert.notEqual(altered, raw);
    const verdict = await verifyD006PortableMissionEvidence(altered, {
      expectedIdentity: EXPECTED_IDENTITY,
      expectedTransferredContentDigest: ORIGINAL_DIGEST,
    });
    assert.equal(verdict.verdict, "INVALID");
    assert.ok(verdict.reasonCodes.includes("D006_PEB_TRANSFER_DIGEST_MISMATCH"));
  }
});

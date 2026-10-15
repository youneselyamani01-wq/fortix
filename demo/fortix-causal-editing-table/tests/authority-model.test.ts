import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  D004_ACTION_TIME_MS,
  D004_AUTHORITY_EVIDENCE,
  authorityEvidenceForCondition,
  authorityProofItemsAt,
  deriveHistoricalActionAuthorityAt,
  resolveAuthorityAtSignedTime,
} from "../app/authority.ts";
import {
  D003_PORTABLE_BUNDLE,
  canonicalString,
  verifyPortableEvidenceBundle,
} from "../app/verification.ts";

test("authority state is resolved from signed evidence rather than UI state", () => {
  const resolution = deriveHistoricalActionAuthorityAt(D004_ACTION_TIME_MS);

  assert.equal(resolution.authorityStatus, "ACTIVE");
  assert.equal(resolution.actionAuthorized, true);
  assert.equal(resolution.reasonCode, "D004_AUTHORITY_ACTIVE");
  assert.ok(resolution.authorityEvidenceId?.startsWith("fortix:evidence:blake3:"));
});

test("historical authority resolution is deterministic and later revocation does not rewrite it", () => {
  const atAction = resolveAuthorityAtSignedTime(
    D004_ACTION_TIME_MS,
    D004_AUTHORITY_EVIDENCE,
  );
  const laterLifecycle = resolveAuthorityAtSignedTime(
    6_000,
    D004_AUTHORITY_EVIDENCE,
  );
  const historicalAtLaterMasterTime = deriveHistoricalActionAuthorityAt(6_000);

  assert.equal(atAction.authorityStatus, "ACTIVE");
  assert.equal(laterLifecycle.authorityStatus, "REVOKED");
  assert.equal(laterLifecycle.reasonCode, "D004_AUTHORITY_REVOKED");
  assert.deepEqual(historicalAtLaterMasterTime, atAction);
});

test("suspended, revoked, expired, unknown, and missing authority remain distinct", () => {
  const expected = {
    MISSING: ["MISSING", "D004_AUTHORITY_EVIDENCE_MISSING", "INDETERMINATE"],
    SUSPENDED: ["SUSPENDED", "D004_AUTHORITY_SUSPENDED", "REVOKED"],
    REVOKED: ["REVOKED", "D004_AUTHORITY_REVOKED", "REVOKED"],
    EXPIRED: ["EXPIRED", "D004_AUTHORITY_EXPIRED", "INDETERMINATE"],
    UNKNOWN: ["UNKNOWN", "D004_AUTHORITY_UNKNOWN", "INDETERMINATE"],
  } as const;

  for (const [condition, values] of Object.entries(expected)) {
    const resolution = resolveAuthorityAtSignedTime(
      D004_ACTION_TIME_MS,
      authorityEvidenceForCondition(condition as keyof typeof expected),
    );
    assert.deepEqual(
      [resolution.authorityStatus, resolution.reasonCode, resolution.verdict],
      values,
    );
    assert.equal(resolution.actionAuthorized, false);
  }
});

test("authority resolution is independent of evidence input ordering", () => {
  const reversed = {
    ...D004_AUTHORITY_EVIDENCE,
    authority_history: [...D004_AUTHORITY_EVIDENCE.authority_history].reverse(),
  };

  assert.deepEqual(
    resolveAuthorityAtSignedTime(D004_ACTION_TIME_MS, reversed),
    resolveAuthorityAtSignedTime(D004_ACTION_TIME_MS),
  );
});

test("contradictory authority records at the same effective time fail closed", () => {
  const revoked = authorityEvidenceForCondition("REVOKED").authority_history[0];
  const conflicting = {
    ...D004_AUTHORITY_EVIDENCE,
    authority_history: [D004_AUTHORITY_EVIDENCE.authority_history[0], revoked],
  };
  const resolution = resolveAuthorityAtSignedTime(D004_ACTION_TIME_MS, conflicting);

  assert.equal(resolution.actionAuthorized, false);
  assert.equal(resolution.authorityStatus, "CONFLICT");
  assert.equal(resolution.reasonCode, "D004_AUTHORITY_CONFLICT");
  assert.equal(resolution.verdict, "INDETERMINATE");
});

test("rewind removes authority state and replay reconstructs the same signed-time state", () => {
  const first = deriveHistoricalActionAuthorityAt(D004_ACTION_TIME_MS);
  const rewound = deriveHistoricalActionAuthorityAt(D004_ACTION_TIME_MS - 1);
  const replayed = deriveHistoricalActionAuthorityAt(D004_ACTION_TIME_MS);

  assert.equal(rewound.authorityStatus, "NOT_REACHED");
  assert.deepEqual(replayed, first);
  assert.equal(authorityProofItemsAt(D004_ACTION_TIME_MS - 1).some(
    (item) => item.label === "Applicable authority",
  ), false);
  assert.equal(authorityProofItemsAt(D004_ACTION_TIME_MS).some(
    (item) => item.label === "Applicable authority",
  ), true);
});

test("policy and execution bindings are explicit and independently verified", async () => {
  const result = await verifyPortableEvidenceBundle({
    portableBundle: D003_PORTABLE_BUNDLE,
    authorityEvidence: D004_AUTHORITY_EVIDENCE,
  });

  assert.equal(result.verdict, "INDETERMINATE");
  assert.deepEqual(result.reasonCodes, ["D003_PRODUCTION_TRUST_TIME_INCOMPLETE"]);
  assert.deepEqual(
    result.layers.slice(4, 8).map(({ id, status }) => [id, status]),
    [
      ["policy_binding", "VERIFIED"],
      ["authority_lifecycle", "VERIFIED"],
      ["authority_applicability", "VERIFIED"],
      ["execution_binding", "VERIFIED"],
    ],
  );
});

test("access and execution capability cannot manufacture authorization", async () => {
  const missingAuthority = authorityEvidenceForCondition("MISSING");
  assert.equal(missingAuthority.capability_state.access, "AVAILABLE");
  assert.equal(missingAuthority.capability_state.execution_capability, "AVAILABLE");
  assert.equal(
    missingAuthority.governed_chain.some(
      (evidence) => evidence.evidence_type === "EXECUTION",
    ),
    true,
  );

  const result = await verifyPortableEvidenceBundle({
    portableBundle: D003_PORTABLE_BUNDLE,
    authorityEvidence: missingAuthority,
    sourceClaimedVerdict: "VALID",
  });
  assert.equal(result.verdict, "INDETERMINATE");
  assert.deepEqual(result.reasonCodes, ["D004_AUTHORITY_EVIDENCE_MISSING"]);
  assert.equal(
    result.layers.some(
      (layer) => layer.id === "authority_lifecycle" && layer.status === "FAILED",
    ),
    true,
  );
});

test("independent authority verification ignores mutable UI and session state", async () => {
  const detachedBundle = canonicalString(D003_PORTABLE_BUNDLE);
  const detachedAuthority = canonicalString(D004_AUTHORITY_EVIDENCE);
  const mutableUi = { masterTime: 0, access: "DENIED", authority: "fabricated" };
  const first = await verifyPortableEvidenceBundle({
    portableBundle: JSON.parse(detachedBundle),
    authorityEvidence: JSON.parse(detachedAuthority),
  });
  mutableUi.masterTime = 6_000;
  mutableUi.access = "AVAILABLE";
  mutableUi.authority = "ACTIVE";
  const second = await verifyPortableEvidenceBundle({
    portableBundle: JSON.parse(detachedBundle),
    authorityEvidence: JSON.parse(detachedAuthority),
  });

  assert.deepEqual(second, first);
});

test("D-004 authority derivation has no wall-clock dependency", () => {
  const source = readFileSync(new URL("../app/authority.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /Date\.now|new Date|performance\.now|setTimeout|setInterval/);
});

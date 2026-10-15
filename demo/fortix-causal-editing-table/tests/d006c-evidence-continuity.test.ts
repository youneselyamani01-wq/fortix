import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { POST } from "../app/api/evidence-sync/route.ts";
import {
  LOCAL_EVIDENCE_RECORD,
  evidenceAcknowledgementRequest,
  isEvidenceAcknowledgementMaterial,
  requestSameOriginEvidenceAcknowledgement,
  type EvidenceAcknowledgementMaterial,
} from "../app/evidenceContinuity.ts";
import {
  D005M_MASTER_BUNDLE_ID,
  D005M_MASTER_CYCLE_RECEIPT,
  D005M_MASTER_CYCLE_RECEIPT_ID,
  deriveMasterStoryState,
} from "../app/masterStory.ts";
import { MISSION_ID } from "../app/missionContinuity.ts";
import { VISUAL_EVENTS } from "../app/visualEvents.ts";

const MATERIAL: EvidenceAcknowledgementMaterial = Object.freeze({
  missionId: MISSION_ID,
  runId: "fortix.demo.d006c.run.evidence-continuity",
  receiptId: D005M_MASTER_CYCLE_RECEIPT_ID,
  receiptDigest: "a".repeat(64),
  bundleId: D005M_MASTER_BUNDLE_ID,
  bundleDigest: "b".repeat(64),
});

test("D-006C: the locally completed Final Receipt keeps canonical identity", () => {
  const completed = deriveMasterStoryState(120_000);
  assert.equal(completed.cycleReceiptAvailable, true);
  assert.equal(LOCAL_EVIDENCE_RECORD.missionId, MISSION_ID);
  assert.equal(LOCAL_EVIDENCE_RECORD.receiptId, D005M_MASTER_CYCLE_RECEIPT_ID);
  assert.equal(LOCAL_EVIDENCE_RECORD.bundleId, D005M_MASTER_BUNDLE_ID);
  assert.strictEqual(LOCAL_EVIDENCE_RECORD.receipt, D005M_MASTER_CYCLE_RECEIPT);
  assert.ok(Object.isFrozen(LOCAL_EVIDENCE_RECORD));
});

test("D-006C: acknowledgement posts caller-supplied identity without replacing evidence", async () => {
  let capturedInput: string | URL | Request | undefined;
  let capturedInit: RequestInit | undefined;
  const fetcher = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    capturedInput = input;
    capturedInit = init;
    return Response.json({ status: "ACKNOWLEDGED", scope: "SAME_ORIGIN_DEMO", ...MATERIAL });
  };

  const acknowledgement = await requestSameOriginEvidenceAcknowledgement(MATERIAL, fetcher);
  assert.deepEqual(acknowledgement, { status: "ACKNOWLEDGED", scope: "SAME_ORIGIN_DEMO", ...MATERIAL });
  assert.equal(capturedInput, "/api/evidence-sync");
  assert.equal(capturedInit?.method, "POST");
  assert.equal(capturedInit?.cache, "no-store");
  assert.deepEqual(JSON.parse(String(capturedInit?.body)), MATERIAL);
});

test("D-006C: identity-changing acknowledgement is rejected", async () => {
  const alteredAcknowledgement = async (): Promise<Response> => Response.json({
    status: "ACKNOWLEDGED",
    scope: "SAME_ORIGIN_DEMO",
    ...MATERIAL,
    runId: `${MATERIAL.runId}.altered`,
  });
  await assert.rejects(
    requestSameOriginEvidenceAcknowledgement(MATERIAL, alteredAcknowledgement),
    /changed identity/,
  );
});

test("D-006 C1: acknowledgement forwards cancellation to an in-flight request", async () => {
  const controller = new AbortController();
  let receivedSignal: AbortSignal | null = null;
  const pending = requestSameOriginEvidenceAcknowledgement(
    MATERIAL,
    async (_input, init): Promise<Response> => {
      receivedSignal = init?.signal ?? null;
      return await new Promise<Response>((_resolve, reject) => {
        receivedSignal?.addEventListener("abort", () => reject(receivedSignal?.reason), { once: true });
      });
    },
    controller.signal,
  );
  controller.abort(new DOMException("stale reconciliation window", "AbortError"));
  await assert.rejects(pending, (error: unknown) => (
    error instanceof DOMException && error.name === "AbortError"
  ));
  assert.equal(receivedSignal, controller.signal);
});

test("D-006C: the same-origin boundary accepts dynamic, well-formed evidence identity", async () => {
  const requestMaterial = evidenceAcknowledgementRequest(MATERIAL);
  const accepted = await POST(new Request("http://localhost/api/evidence-sync", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(requestMaterial),
  }));
  assert.equal(accepted.status, 200);
  assert.equal(accepted.headers.get("cache-control"), "no-store");
  assert.deepEqual(await accepted.json(), {
    status: "ACKNOWLEDGED",
    scope: "SAME_ORIGIN_DEMO",
    ...MATERIAL,
  });

  const anotherRun = { ...MATERIAL, runId: `${MATERIAL.runId}.next`, receiptId: "RR-DYNAMIC" };
  const dynamic = await POST(new Request("http://localhost/api/evidence-sync", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(anotherRun),
  }));
  assert.equal(dynamic.status, 200, "the route must not be hard-coded to one artifact");

  const injected = await POST(new Request("http://localhost/api/evidence-sync", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...MATERIAL,
      status: "EXTERNALLY_VERIFIED",
      scope: "INTERNET",
      externallyVerified: true,
    }),
  }));
  const injectedBody = await injected.json() as Record<string, unknown>;
  assert.equal(injectedBody.status, "ACKNOWLEDGED");
  assert.equal(injectedBody.scope, "SAME_ORIGIN_DEMO");
  assert.equal(Object.hasOwn(injectedBody, "externallyVerified"), false);
});

test("D-006C: malformed acknowledgement material fails closed", async () => {
  assert.equal(isEvidenceAcknowledgementMaterial({ ...MATERIAL, bundleDigest: "altered" }), false);
  const rejected = await POST(new Request("http://localhost/api/evidence-sync", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...MATERIAL, bundleDigest: "altered" }),
  }));
  assert.equal(rejected.status, 409);
});

test("D-006C: connectivity is a physical signal, never a master-time event", () => {
  const component = readFileSync(new URL("../app/ConvergenceExperience.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(component, /navigator\.onLine/);
  assert.ok(!VISUAL_EVENTS.some((event) => /network|offline|reconnect|sync/i.test(event.id)),
    "network state must not be fabricated as a canonical timeline event");
});

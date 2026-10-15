import assert from "node:assert/strict";
import test from "node:test";
import { buildReport } from "../app/ethernetLink.ts";
import { createOfflineEvidenceSession, type OfflineEvidenceSession } from "../app/offlineEvidence.ts";
import { PhysicalNetworkTransitionMachine } from "../app/networkTransitions.ts";
import { admitPhysicalObservation } from "../app/physicalLinkRuntime.ts";
import { journalAt } from "../app/nx/adapter/missionJournal.ts";
import { missionReceiptSummary } from "../app/nx/workspace/missionReceiptSummary.ts";
import { canonicalString } from "../app/verification.ts";

function loss() {
  let session = createOfflineEvidenceSession("fortix.demo.reset.count.run-a");
  let machine = new PhysicalNetworkTransitionMachine({ runId: session.runId, initialState: session.networkState });
  const now = Date.UTC(2026, 8, 29, 10);
  for (const [index, link] of ["CONNECTED", "LOST", "LOST"].entries()) {
    const time = now + index * 500;
    const report = buildReport([{ name: "Ethernet", description: "Intel(R) Ethernet Controller I226-LM", status: link === "CONNECTED" ? "Up" : "Disconnected", mediaConnectionState: link === "CONNECTED" ? "Connected" : "Disconnected", mediaType: "802.3", physicalMediaType: "802.3", virtual: false, ifIndex: 23 }], new Date(time).toISOString());
    const outcome = admitPhysicalObservation({ session, machine, report, nowEpochMs: time, masterTimeMs: 0 });
    machine = outcome.machine;
    if (outcome.kind === "TRANSITION") session = outcome.session;
  }
  return session;
}

test("a real READY network loss is available and inspectable despite an empty presentation queue", () => {
  const session = loss(); const before = canonicalString(session);
  const summary = missionReceiptSummary([], session);
  assert.equal(summary.count, 1); assert.equal(summary.presentedCount, 0); assert.equal(summary.networkCount, 1);
  assert.deepEqual(summary.items, [{ evidenceId: session.records[0].receiptId, eventId: session.records[0].eventId, domain: "NETWORK", standing: "NETWORK" }]);
  assert.equal(canonicalString(session), before, "reading the inventory cannot mint or alter a receipt");
});

test("presented network receipts and journal receipts are deduplicated by exact identity", () => {
  const session = loss(); const record = session.records[0];
  const presented = [{ evidenceId: record.receiptId, eventId: record.eventId, domain: "NETWORK", standing: "CLOSURE" as const }, { evidenceId: "canonical-evidence", eventId: "canonical-event", domain: "NAVIGATION", standing: "CLOSURE" as const }];
  const summary = missionReceiptSummary(presented, session);
  assert.equal(summary.count, 2); assert.equal(summary.networkCount, 1); assert.equal(summary.presentedCount, 2);
  assert.equal(summary.items.filter(item => item.evidenceId === record.receiptId).length, 1);
  assert.equal(summary.items[0].standing, "CLOSURE", "the existing presented scope is retained");
});

test("seek to zero keeps the same admitted network history; a new run starts with zero inventory", () => {
  const session = loss(); const before = canonicalString(session);
  const rewound = journalAt(session, 0); const summary = missionReceiptSummary([], rewound);
  assert.equal(rewound, session); assert.equal(summary.count, 1);
  const fresh = createOfflineEvidenceSession("fortix.demo.reset.count.run-b");
  assert.deepEqual(missionReceiptSummary([], fresh), { items: [], count: 0, presentedCount: 0, networkCount: 0 });
  assert.equal(canonicalString(session), before, "creating the next run cannot rewrite the previous one");
  const mixed = { ...fresh, records: session.records } as OfflineEvidenceSession;
  assert.equal(missionReceiptSummary([], mixed).count, 0, "a foreign run cannot be exposed as this run's network evidence");
});

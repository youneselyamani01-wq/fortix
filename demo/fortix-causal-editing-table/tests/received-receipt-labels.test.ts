import assert from "node:assert/strict";
import test from "node:test";
import { inspectReceivedPeb } from "../app/verify/inspectReceivedPeb.ts";
import { projectReceivedGraph } from "../app/verify/receivedGraph.ts";
import { receivedReceiptLabel, receivedReceiptCounts, receivedReceiptCountLabel } from "../app/verify/receivedReceiptLabels.ts";

const member = (id: string, extra: Record<string, unknown> = {}) => ({ evidenceId: id, receiptId: id, source: "SIGNED_CANONICAL", presentation: "PRESENTED", causalParents: [], observedInputs: [], ...extra });
function graph(members: unknown[], finalReceipt?: unknown) {
  const text = JSON.stringify({ profile: "fortix.demo.d006.peb.v1", bundleId: "labels", identity: {}, manifest: { memberRefs: members }, ...(finalReceipt ? { finalReceipt } : {}) });
  return projectReceivedGraph(inspectReceivedPeb(text), text);
}
test("NR reading handles bind to unchanged received IDs and field paths, independent of manifest ordering", () => {
  const id = `fortix:evidence:blake3:${"a".repeat(64)}`;
  const first = graph([member(id), member("NR-ACTION:brake", { source: "RUNTIME_JOURNAL" })]);
  const before = JSON.stringify(first); const label = receivedReceiptLabel(first, first.nodes[0], "fr");
  assert.equal(label.display, "NR · aaaaaaaa"); assert.equal(label.identity, id); assert.equal(label.identityPath, "manifest.memberRefs[0].receiptId");
  assert.equal(label.technical, "M01"); assert.equal(label.kind, "NANO_RECEIPT"); assert.equal(JSON.stringify(first), before);
  assert.equal(receivedReceiptLabel(first, first.nodes[1], "en").display, "NR-ACTION:brake");
  const reordered = graph([member("NR-ACTION:brake"), member(id)]);
  assert.equal(receivedReceiptLabel(reordered, reordered.nodes[1], "fr").display, label.display);
});
test("support material and Final Receipt never become NanoReceipts or causal edges", () => {
  const projected = graph([member("support", { presentation: "ASSURANCE_SUPPORT" }), member("final", { source: "D006_FINAL_RECEIPT" })], { receiptId: "final", causalInputEvidenceIds: ["support"] });
  const support = receivedReceiptLabel(projected, projected.nodes[0], "fr");
  assert.equal(support.kind, "SUPPORT"); assert.equal(support.display, "Support"); assert.equal(support.technical, "M01");
  assert.equal(receivedReceiptLabel(projected, projected.nodes[1], "fr").kind, "FINAL_RECEIPT");
  assert.equal(projected.edges.length, 1); assert.equal(projected.nodes.length, 2);
});
test("missing or duplicated identities do not receive fabricated NR identities", () => {
  for (const members of [[member("a", { receiptId: null })], [member("same"), member("same")], [member("a", { receiptId: "duplicate" }), member("b", { receiptId: "duplicate" })]]) {
    const projected = graph(members); const label = receivedReceiptLabel(projected, projected.nodes[0], "en");
    assert.equal(label.kind, "UNRESOLVED"); assert.doesNotMatch(label.display, /^NR|^M\d/); assert.notEqual(label.status, "DECLARED");
  }
});
test("short NR handles expand on prefix collisions instead of conflating distinct receipts", () => {
  const projected = graph([member("fortix:evidence:blake3:aaaaaaaa1"), member("fortix:evidence:blake3:aaaaaaaa2")]);
  const labels = projected.nodes.map(node => receivedReceiptLabel(projected, node, "en"));
  assert.notEqual(labels[0].display, labels[1].display); assert.equal(labels[0].identity, projected.nodes[0].evidenceId);
});

test("evidence counts deduplicate selected identities and keep links, support, final and unresolved distinct", () => {
  const projected = graph([member("a"), member("b", { causalParents: ["a"] }), member("support", { presentation: "ASSURANCE_SUPPORT" }), member("missing", { receiptId: null }), member("final", { source: "D006_FINAL_RECEIPT" })], { receiptId: "final", causalInputEvidenceIds: ["b", "support"] });
  const counts = receivedReceiptCounts(projected);
  assert.deepEqual(counts, { nano: 2, support: 1, final: 1, unresolved: 1 });
  assert.equal(receivedReceiptCountLabel(counts, "fr"), "2 NR · 1 support · 1 reçu final · 1 non résolu");
  assert.equal(receivedReceiptCountLabel(counts, "en"), "2 NR · 1 support item · 1 Final Receipt · 1 unresolved");
  const keys = [projected.nodes[0].key, projected.nodes[1].key, projected.nodes[0].key];
  assert.deepEqual(receivedReceiptCounts(projected, keys), { nano: 2, support: 0, final: 0, unresolved: 0 });
  assert.equal(projected.edges.length, 3, "receipt counts must not replace or mutate relation counts");
});

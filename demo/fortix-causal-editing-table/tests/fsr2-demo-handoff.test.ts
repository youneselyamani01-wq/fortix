import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { openDemoVerifier, receiveDemoParcel, sameDemoArtifact, type DemoExpectation, type DemoParcel, type DemoParcelActions } from "../app/verify/demoHandoff.ts";
import { journalAt } from "../app/nx/adapter/missionJournal.ts";
import { createOfflineEvidenceSession } from "../app/offlineEvidence.ts";
import { MISSION_ID } from "../app/missionContinuity.ts";
import { buildMissionEvidenceClosure, buildPortableMissionEvidenceBundle, createHandoffArtifact, finalReceiptRuntimeEvidencePrefix, issueFinalMissionReceipt, transferredContentDigest, type HandoffArtifact } from "../app/portableMissionEvidence.ts";
import { projectPortableProofLeaves } from "../app/proofProjection.ts";
import { FINAL_RECEIPT_EMITTED_MS, HANDOFF_READY_MS, PEB_COMPLETE_MS } from "../app/storyTimeline.ts";
import { analyzeInsertedD006Peb, insertD006PebForAnalysis } from "../app/offlineVerification.ts";

const identity = { missionId: MISSION_ID, runId: "fortix.demo.fsr2.independent-handoff" };
const journal = journalAt(createOfflineEvidenceSession(identity.runId, null, identity.missionId), FINAL_RECEIPT_EMITTED_MS);
const runtimeRecords = finalReceiptRuntimeEvidencePrefix(journal);
const closure = buildMissionEvidenceClosure({ identity, runtimeRecords, asOfMasterTimeMs: FINAL_RECEIPT_EMITTED_MS });
const finalReceipt = issueFinalMissionReceipt(closure, FINAL_RECEIPT_EMITTED_MS);
const displayedEvidenceIds = projectPortableProofLeaves(closure, PEB_COMPLETE_MS, finalReceipt).map((leaf) => leaf.evidenceId);
const peb = buildPortableMissionEvidenceBundle({ closure, finalReceipt, runtimeRecords, displayedEvidenceIds, masterTimeMs: PEB_COMPLETE_MS });
const artifact = createHandoffArtifact(peb, HANDOFF_READY_MS);
const CHANNEL = "fortix-demo-peb-v1";

class Surface {
  location: URL;
  listeners = new Set<(event: MessageEvent) => void>();
  opener: Window | null = null;
  crypto = globalThis.crypto;
  history = { state: null, replaceState: (_state: unknown, _title: string, path: string) => { this.location = new URL(path, this.location.href); } };
  openCalls: string[][] = [];
  opened: Surface | null = null;
  sent: { data: unknown; origin: string; ports: MessagePort[] }[] = [];
  onPost: ((data: unknown, origin: string, ports: MessagePort[]) => void) | null = null;
  constructor(url: string) { this.location = new URL(url); }
  open(url: string, target: string) { this.openCalls.push([url, target]); if (this.opened) { this.opened.location = new URL(url); this.opened.opener = this.window(); } return this.opened?.window() ?? null; }
  postMessage(data: unknown, origin: string, ports: MessagePort[] = []) { this.sent.push({ data, origin, ports }); this.onPost?.(data, origin, ports); }
  addEventListener(_name: string, handler: (event: MessageEvent) => void) { this.listeners.add(handler); }
  removeEventListener(_name: string, handler: (event: MessageEvent) => void) { this.listeners.delete(handler); }
  setTimeout(callback: () => void, delay: number) { return setTimeout(callback, delay); }
  clearTimeout(timer: ReturnType<typeof setTimeout>) { clearTimeout(timer); }
  window() { return this as unknown as Window; }
  emit(data: unknown, origin: string, source: Surface, ports: MessagePort[] = []) { for (const listener of this.listeners) listener({ data, origin, source: source.window(), ports } as unknown as MessageEvent); }
}
function pair(origin = "http://127.0.0.1:3000") {
  const demo = new Surface(`${origin}/nx`);
  const verifier = new Surface(`${origin}/verify`);
  demo.opened = verifier;
  demo.onPost = (data, origin, ports) => { assert.equal(origin, demo.location.origin); queueMicrotask(() => demo.emit(data, verifier.location.origin, verifier, ports)); };
  verifier.onPost = (data, origin, ports) => { assert.equal(origin, verifier.location.origin); queueMicrotask(() => verifier.emit(data, demo.location.origin, demo, ports)); };
  return { demo, verifier };
}
async function settle(until: () => boolean) { for (let n = 0; n < 100 && !until(); n += 1) await new Promise<void>((resolve) => setImmediate(resolve)); assert.ok(until(), "message channel reached expected state"); }
const packet = (surface: Surface) => surface.sent.find((item) => (item.data as { kind: string }).kind === "package")!;

test("FS-R2: OPEN preserves a held exact artifact; only DROP receives it and only ANALYZE requests verification", async () => {
  const { demo, verifier } = pair(); const statuses: string[] = []; const received: DemoExpectation[] = []; const analyzed: DemoExpectation[] = [];
  let parcel: DemoParcel | null = null; let actions: DemoParcelActions | null = null;
  const stop = openDemoVerifier({ artifact, locale: "fr", onStatus: (value) => statuses.push(value), onReceived: (value) => { received.push(value); return true; }, onAnalyze: (value) => analyzed.push(value) }, demo.window());
  assert.equal(demo.openCalls.length, 1); assert.equal(demo.openCalls[0][1], "_blank");
  assert.equal(demo.location.pathname, "/nx"); assert.ok(!demo.openCalls[0][0].includes(artifact.pebText));
  const stopChild = receiveDemoParcel(async (value, act) => { parcel = value; actions = act; return transferredContentDigest(value.text) === value.expected.transferredContentDigest; }, () => assert.fail("valid parcel rejected"), verifier.window());
  try {
    await settle(() => statuses.includes("held"));
    assert.equal(received.length, 0, "OPEN and transport-held do not record a DROP");
    actions!.reportAnalyze(); await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(analyzed.length, 0, "analysis cannot be reported before DROP");
    assert.equal(actions!.reportDrop(), true); assert.equal(actions!.reportDrop(), false, "DROP is once only");
    await settle(() => statuses.includes("received"));
    assert.equal(parcel!.text, artifact.pebText); assert.deepEqual(parcel!.expected, { ...artifact.identity, transferredContentDigest: artifact.transferredContentDigest });
    assert.equal(parcel!.locale, "fr"); assert.equal(received.length, 1); assert.equal(analyzed.length, 0);
    assert.equal(verifier.opener, null); assert.equal(verifier.location.hash, "");
    actions!.reportAnalyze(); actions!.reportAnalyze(); await settle(() => analyzed.length === 1); assert.equal(analyzed.length, 1);
  } finally { stopChild(); stop(); }
});

test("FS-R2: wrong origin/window/nonce cannot transmit; peer verdicts and wrong-run/replayed analysis are ignored", async () => {
  const { demo, verifier } = pair(); let count = 0; let received = false; let held = false; let actions: DemoParcelActions | null = null;
  const stop = openDemoVerifier({ artifact, locale: "en", onStatus: status => { held = status === "held"; }, onReceived: () => { received = true; return true; }, onAnalyze: () => { count += 1; } }, demo.window());
  const nonce = new URLSearchParams(verifier.location.hash.slice(1)).get("demo-peb");
  const ready = { channel: CHANNEL, kind: "ready", nonce };
  demo.emit(ready, "https://foreign.example", verifier); demo.emit(ready, verifier.location.origin, new Surface(verifier.location.href)); demo.emit({ ...ready, nonce: "wrong" }, verifier.location.origin, verifier);
  assert.equal(verifier.sent.length, 0);
  const stopChild = receiveDemoParcel(async (_value, act) => { actions = act; return true; }, () => assert.fail("valid handoff rejected"), verifier.window());
  try {
    await settle(() => held); actions!.reportDrop(); await settle(() => received);
    const sent = packet(verifier); const context = { ...artifact.identity, transferredContentDigest: artifact.transferredContentDigest };
    sent.ports[0].postMessage({ channel: CHANNEL, kind: "verdict", nonce, verdict: "VALID", expected: context });
    sent.ports[0].postMessage({ channel: CHANNEL, kind: "analyze", nonce, expected: { ...context, runId: "other" } });
    await new Promise<void>((resolve) => setImmediate(resolve)); assert.equal(count, 0);
    sent.ports[0].postMessage({ channel: CHANNEL, kind: "analyze", nonce, expected: context });
    await settle(() => count === 1);
    sent.ports[0].postMessage({ channel: CHANNEL, kind: "analyze", nonce, expected: context });
    await new Promise<void>((resolve) => setImmediate(resolve)); assert.equal(count, 1);
  } finally { stopChild(); stop(); }
});

test("FS-R2: blocked/abandoned/stale handoffs cannot record receipt or analyze a replacement run", async () => {
  const blocked = new Surface("http://127.0.0.1:3000/nx"); const statuses: string[] = [];
  const stopBlocked = openDemoVerifier({ artifact, locale: "en", onStatus: (value) => statuses.push(value), onReceived: () => assert.fail("blocked receipt"), onAnalyze: () => assert.fail("blocked analysis") }, blocked.window());
  assert.deepEqual(statuses, ["blocked"]); stopBlocked();
  const { demo, verifier } = pair(); let current: HandoffArtifact | null = artifact;
  const stop = openDemoVerifier({ artifact, locale: "en", onStatus: (value) => statuses.push(value), onReceived: (expected) => sameDemoArtifact(current, expected), onAnalyze: () => assert.fail("stale analysis") }, demo.window());
  current = null;
  let actions: DemoParcelActions | null = null;
  const stopChild = receiveDemoParcel(async (_value, act) => { actions = act; return true; }, () => {}, verifier.window());
  try { await settle(() => statuses.includes("held")); actions!.reportDrop(); await settle(() => statuses.includes("failed")); } finally { stopChild(); stop(); }
  assert.equal(sameDemoArtifact({ ...artifact, identity: { ...identity, runId: "replacement" } }, { ...identity, transferredContentDigest: artifact.transferredContentDigest }), false);
  assert.equal(sameDemoArtifact({ ...artifact, transferredContentDigest: "0".repeat(64) }, { ...identity, transferredContentDigest: artifact.transferredContentDigest }), false);
});

test("FS-R2: a pending held PEB can be dropped and analyzed locally after the Demo closes", async () => {
  const { demo, verifier } = pair(); let parcel: DemoParcel | null = null; let actions: DemoParcelActions | null = null; let held = false;
  const stop = openDemoVerifier({ artifact, locale: "en", onStatus: status => { held = status === "held"; }, onReceived: () => assert.fail("closed Demo cannot receive a DROP"), onAnalyze: () => assert.fail("closed Demo") }, demo.window());
  const stopChild = receiveDemoParcel(async (value, act) => { parcel = value; actions = act; return true; }, () => assert.fail("input failed"), verifier.window());
  try {
    await settle(() => held); stop();
    assert.equal(actions!.reportDrop(), true, "the local DROP survives source tab closure"); actions!.reportAnalyze();
    const input = parcel!;
    const actual = await analyzeInsertedD006Peb(insertD006PebForAnalysis({ pebText: input.text, expectedIdentity: { missionId: input.expected.missionId, runId: input.expected.runId }, expectedTransferredContentDigest: input.expected.transferredContentDigest }));
    const direct = await analyzeInsertedD006Peb(insertD006PebForAnalysis({ pebText: artifact.pebText, expectedIdentity: artifact.identity, expectedTransferredContentDigest: artifact.transferredContentDigest }));
    assert.deepEqual(actual, direct); assert.equal(actual.transferredContentDigest, artifact.transferredContentDigest);
  } finally { stopChild(); stop(); }
});

test("FS-R2: NX acts preserve separate PICK, acknowledged DROP, and bound manual Analyze without importing a peer verdict", () => {
  const source = readFileSync(new URL("../app/nx/experience/NxExperience.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /<VerifierSurface/);
  assert.match(source, /engine\.pick\(\);\s*setHandoffStatus\("idle"\);/);
  const submit = source.slice(source.indexOf("const submitPeb"), source.indexOf("useEffect(() => {", source.indexOf("const submitPeb")));
  assert.match(submit, /sameDemoArtifact\(current\.snapshot\.handoffArtifact, expected\)/);
  assert.match(submit, /current\.snapshot\.transferStage !== "FORMED"\) return false;[\s\S]*current\.drop\(\)/);
  assert.match(submit, /current\.snapshot\.transferStage !== "TRANSFERRED" \|\| !sameDemoArtifact[\s\S]*current\.analyze\(\)/);
  assert.doesNotMatch(submit, /setVerdict|setSnapshot|setAnalysisRequested/);
});

test("FS-R2: lifecycle guards reject stale handoffs while graph inspection belongs to the verifier", () => {
  const source = readFileSync(new URL("../app/nx/experience/NxExperience.tsx", import.meta.url), "utf8");
  assert.match(source, /useLayoutEffect\(\(\) => \{ currentEngine\.current = engine; \}, \[engine\]\)/);
  const reset = source.slice(source.indexOf("const resetMission ="), source.indexOf("const onPrimary ="));
  assert.match(reset, /handoffStop\.current\?\.\(\); handoffStop\.current = null/);
  assert.match(reset, /setHandoffStatus\("idle"\)/);
  assert.match(reset, /engine\.restart\(\)/);
  assert.doesNotMatch(reset, /adapterKind/);
  assert.match(source, /phase === "STOPPED_BY_DENIAL"\) resetMission\(\)/);
  assert.match(source, /data-reset-mission onClick=\{\(\) => resetMission\(\)\}/);
  assert.match(source, /if \(next < HANDOFF_READY_MS\) handoffStop\.current\?\.\(\); engine\.seek\(next\)/);
  assert.doesNotMatch(source, /<InspectPanel|nx-demo-inspection|<ProvenanceProof/);
  const verifier = readFileSync(new URL("../app/verify/VerifierWorkspace.tsx", import.meta.url), "utf8");
  const navigation = verifier.slice(verifier.indexOf("const modularNavigation"), verifier.indexOf("const intake"));
  for (const view of ["path", "timeline", "domains", "graph", "nanoreceipts", "forensic"]) {
    assert.ok(navigation.includes('"' + view + '"'), view + " remains an explicit verifier destination");
  }
  assert.match(navigation, /<nav>/);
  assert.match(navigation, /<a key=\{view\} href=\{modularLinks\[view\]\}/, "inspection destinations are native canonical links in the verifier");

});

test("FS-R2 addendum: the UI retains a held artifact, then explicitly deposits before making analysis available", () => {
  const source = readFileSync(new URL("../app/verify/VerifierWorkspace.tsx", import.meta.url), "utf8");
  const intake = source.slice(source.indexOf("const stopDemo ="), source.indexOf("function dropHeld()"));
  assert.match(intake, /setFile\(null\); setHeld\(\{ parcel, actions, size \}\)/);
  assert.doesNotMatch(intake, /reportDrop\(|setFile\(\{/);
  const drop = source.slice(source.indexOf("function dropHeld()"), source.indexOf("async function analyze()"));
  assert.match(drop, /held\.actions\.reportDrop\(\)/);
  assert.match(drop, /setFile\(\{ name: "FortiX PEB", text: held\.parcel\.text, size: held\.size \}\)/);
  assert.doesNotMatch(drop, /analyzeInsertedD006Peb|insertD006PebForAnalysis|reportAnalyze\.current\?\.\(/);
  assert.match(source, /onClick=\{dropHeld\}/);
  assert.match(source, /const ready = !!file\?\.text/);
  assert.match(source, /data-held-digest=\{held\.parcel\.expected\.transferredContentDigest\}/);
});

test("LAN Demo handoff retains host, exact bytes and explicit DROP without randomUUID", async () => {
  for (const origin of ["http://192.168.1.42:3000", "http://[2001:db8::42]:3000"]) {
    const { demo, verifier } = pair(origin); demo.crypto = { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) } as Crypto;
    const statuses: string[] = []; let received: DemoParcel | null = null; let actions: DemoParcelActions | null = null;
    const stop = openDemoVerifier({ artifact, locale: "fr", onStatus: status => statuses.push(status), onReceived: () => true, onAnalyze: () => assert.fail("transport must not analyze") }, demo.window());
    assert.equal(new URL(demo.openCalls[0][0]).origin, origin); assert.equal(new URL(demo.openCalls[0][0]).pathname, "/verify");
    const stopChild = receiveDemoParcel(async (parcel, act) => { received = parcel; actions = act; return true; }, () => assert.fail("valid LAN handoff rejected"), verifier.window());
    try {
      await settle(() => statuses.includes("held")); assert.equal(statuses.includes("received"), false);
      assert.equal(received!.text, artifact.pebText); assert.equal(received!.expected.transferredContentDigest, artifact.transferredContentDigest);
      actions!.reportDrop(); await settle(() => statuses.includes("received"));
    } finally { stopChild(); stop(); }
  }
});

test("Demo handoff reports failure instead of throwing or opening with a weak nonce", () => {
  const { demo } = pair(); demo.crypto = {} as Crypto; const statuses: string[] = [];
  openDemoVerifier({ artifact, locale: "en", onStatus: status => statuses.push(status), onReceived: () => assert.fail(), onAnalyze: () => assert.fail() }, demo.window())();
  assert.deepEqual(statuses, ["failed"]); assert.equal(demo.openCalls.length, 0); assert.equal(demo.listeners.size, 0);
});

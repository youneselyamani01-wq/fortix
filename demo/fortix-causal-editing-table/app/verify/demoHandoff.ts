import { browserNonce } from "../../../../site/src/verification/browserNonce.ts";
import type { HandoffArtifact } from "../portableMissionEvidence.ts";

/** A transport context supplied separately by the Demo; never recovered from PEB claims. */
export type DemoExpectation = Readonly<{ missionId: string; runId: string; transferredContentDigest: string }>;
export type DemoParcel = Readonly<{ text: string; expected: DemoExpectation; locale: "en" | "fr" }>;
export type DemoHandoffStatus = "idle" | "opening" | "held" | "received" | "blocked" | "failed";
/** Optional reporting only: local DROP and analysis survive closing the source tab. */
export type DemoParcelActions = Readonly<{ reportDrop: () => boolean; reportAnalyze: () => void }>;
const CHANNEL = "fortix-demo-peb-v1";
const MAX_TEXT = 20 * 1024 * 1024;
const NONCE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
export function demoExpectation(value: unknown): DemoExpectation | null {
  const v = record(value);
  return v && typeof v.missionId === "string" && v.missionId.length > 0
    && typeof v.runId === "string" && v.runId.length > 0
    && typeof v.transferredContentDigest === "string" && /^[0-9a-f]{64}$/.test(v.transferredContentDigest)
    ? { missionId: v.missionId, runId: v.runId, transferredContentDigest: v.transferredContentDigest } : null;
}
export function sameDemoArtifact(artifact: HandoffArtifact | null, expected: DemoExpectation): boolean {
  return artifact !== null && artifact.identity.missionId === expected.missionId
    && artifact.identity.runId === expected.runId && artifact.transferredContentDigest === expected.transferredContentDigest;
}
function messageIs(value: unknown, kind: string, nonce: string): boolean {
  const v = record(value);
  return v?.channel === CHANNEL && v.kind === kind && v.nonce === nonce;
}

/** Opens only on the person's handoff gesture. The port accepts receipt and Analyze intent, never a peer verdict. */
export function openDemoVerifier(input: Readonly<{
  artifact: HandoffArtifact; locale: "en" | "fr";
  onReceived: (expected: DemoExpectation) => boolean;
  onAnalyze: (expected: DemoExpectation) => void;
  onStatus: (status: DemoHandoffStatus) => void;
}>, host: Window = window): () => void {
  const expected: DemoExpectation = { ...input.artifact.identity, transferredContentDigest: input.artifact.transferredContentDigest };
  let nonce: string;
  try { nonce = browserNonce(host.crypto); }
  catch { input.onStatus("failed"); return () => {}; }

  const destination = new URL("/verify", host.location.href);
  destination.hash = new URLSearchParams({ "demo-peb": nonce, source: host.location.origin, lang: input.locale }).toString();
  const channel = new MessageChannel();
  let child: Window | null = null;
  let sent = false;
  let received = false;
  let analyzed = false;
  let disposed = false;
  let timer = 0;
  const stopHandshake = () => { host.removeEventListener("message", ready); host.clearTimeout(timer); };
  const cleanup = () => { disposed = true; stopHandshake(); channel.port1.close(); channel.port2.close(); };
  const fail = (status: "failed" | "blocked") => { if (!disposed) { cleanup(); input.onStatus(status); } };
  const ready = (event: MessageEvent) => {
    if (disposed || sent || !child || event.source !== child || event.origin !== destination.origin || !messageIs(event.data, "ready", nonce)) return;
    sent = true;
    host.removeEventListener("message", ready);
    child.postMessage({ channel: CHANNEL, kind: "package", nonce, text: input.artifact.pebText, expected }, destination.origin, [channel.port2]);
  };
  channel.port1.onmessage = (event) => {
    if (disposed || !sent) return;
    if (!received && messageIs(event.data, "held", nonce)) {
      const echoed = demoExpectation(record(event.data)?.expected);
      if (!echoed || !sameDemoArtifact(input.artifact, echoed)) { fail("failed"); return; }
      stopHandshake(); input.onStatus("held");
    } else if (!received && messageIs(event.data, "received", nonce)) {
      const echoed = demoExpectation(record(event.data)?.expected);
      if (!echoed || !sameDemoArtifact(input.artifact, echoed) || !input.onReceived(expected)) { fail("failed"); return; }
      received = true; stopHandshake(); input.onStatus("received");
    } else if (received && !analyzed && messageIs(event.data, "analyze", nonce)) {
      const echoed = demoExpectation(record(event.data)?.expected);
      if (!echoed || !sameDemoArtifact(input.artifact, echoed)) return;
      analyzed = true;
      // This asks the unchanged Demo engine to verify its own same bytes for its own journal.
      // No verdict/result from this channel is ever consumed.
      input.onAnalyze(expected);
    } else if (!received && messageIs(event.data, "rejected", nonce)) fail("failed");
  };
  channel.port1.start();
  host.addEventListener("message", ready);
  try { child = host.open(destination.href, "_blank"); }
  catch { fail("blocked"); return cleanup; }
  if (!child) { fail("blocked"); return cleanup; }
  input.onStatus("opening");
  timer = host.setTimeout(() => fail("failed"), 30_000);
  return cleanup;
}

/** Child verification is local and remains available when this optional reporting port closes. */
export function receiveDemoParcel(onParcel: (parcel: DemoParcel, actions: DemoParcelActions) => Promise<boolean>, onError: () => void, host: Window = window): () => void {
  const params = new URLSearchParams(host.location.hash.slice(1));
  const nonce = params.get("demo-peb") ?? "";
  const origin = params.get("source") ?? "";
  const source: Window | null = host.opener;
  try { if (!source || !NONCE.test(nonce) || new URL(origin).origin !== origin || !/^https?:/.test(origin)) return () => {}; }
  catch { return () => {}; }
  const locale = params.get("lang") === "fr" ? "fr" : "en";
  let consumed = false;
  let disposed = false;
  let port: MessagePort | null = null;
  let timer = 0;
  const stop = () => { host.removeEventListener("message", receive); host.clearTimeout(timer); };
  const cleanup = () => { disposed = true; consumed = true; stop(); port?.close(); };
  const detach = () => { host.history.replaceState(host.history.state, "", host.location.pathname + host.location.search); host.opener = null; };
  const receive = (event: MessageEvent) => {
    if (consumed || disposed || event.source !== source || event.origin !== origin || !messageIs(event.data, "package", nonce)) return;
    consumed = true; stop(); detach();
    port = event.ports[0] ?? null;
    const data = record(event.data)!;
    const expected = demoExpectation(data.expected);
    if (!port || !expected || typeof data.text !== "string" || data.text.length === 0 || data.text.length > MAX_TEXT) { port?.close(); onError(); return; }
    const receivedPort = port;
    let accepted = false;
    let dropped = false;
    let analyzed = false;
    const report = (kind: "held" | "received" | "analyze" | "rejected") => {
      try { receivedPort.postMessage({ channel: CHANNEL, kind, nonce, expected }); }
      catch { /* The local held artifact and verification do not depend on the Demo tab. */ }
    };
    const actions: DemoParcelActions = {
      reportDrop: () => {
        if (disposed || !accepted || dropped) return false;
        dropped = true; report("received"); return true;
      },
      reportAnalyze: () => {
        if (disposed || !dropped || analyzed) return;
        analyzed = true; report("analyze");
      },
    };
    void onParcel({ text: data.text, expected, locale }, actions).then((held) => {
      if (disposed) return;
      accepted = held;
      // Transport readiness is not the person's DROP and must never acknowledge receipt.
      report(held ? "held" : "rejected");
      if (!held) receivedPort.close();
    }).catch(() => { if (!disposed) { report("rejected"); onError(); } });
  };
  host.addEventListener("message", receive);
  timer = host.setTimeout(() => { cleanup(); detach(); onError(); }, 30_000);
  source.postMessage({ channel: CHANNEL, kind: "ready", nonce }, origin);
  return cleanup;
}

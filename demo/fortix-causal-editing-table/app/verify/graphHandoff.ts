import { browserNonce } from "../../../../site/src/verification/browserNonce.ts";
import type { D006VerdictSnapshot } from "../offlineVerification.ts";
import { transferredContentDigest } from "../portableMissionEvidence.ts";
import type { GraphLayers, ReceivedGraphContext } from "./graphDisplay.ts";

/** A second view of this Verifier's exact received bytes and existing local result. */
export type GraphParcel = Readonly<{
  text: string; name: string; digest: string; locale: "en" | "fr";
  context: ReceivedGraphContext; snapshot: D006VerdictSnapshot | null;
}>;
export type GraphHandoffStatus = "opening" | "opened" | "blocked" | "failed";
export type GraphInspectionNavigation = {
  dedicated?: boolean; initialContext?: ReceivedGraphContext;
  onOpenDedicatedGraph?: (context: ReceivedGraphContext) => void;
  onReturnToVerifier?: () => void;
};
const CHANNEL = "fortix-verifier-graph-v1";
const MAX_BYTES = 20 * 1024 * 1024;
const NONCE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const layerKeys: readonly (keyof GraphLayers)[] = ["nanoReceipts", "boundaries", "causalRelations", "secondaryRelations", "supportEvidence", "finalReceipt", "contextZones"];
function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function messageIs(value: unknown, kind: string, nonce: string): boolean {
  const data = record(value);
  return data?.channel === CHANNEL && data.kind === kind && data.nonce === nonce;
}
function readContext(value: unknown): ReceivedGraphContext {
  const data = record(value);
  const context: ReceivedGraphContext = { preset: data?.preset === "simplified" || data?.preset === "full" ? data.preset : "causal" };
  for (const key of ["selectedNodeKey", "selectedBoundaryKey", "selectedEdgeKey", "highlightedFamily"] as const) {
    if (typeof data?.[key] === "string" && data[key].length <= 1024) context[key] = data[key];
  }
  if (data?.level === 1 || data?.level === 2 || data?.level === 3) context.level = data.level;
  if (data?.focusMode === "none" || data?.focusMode === "isolate" || data?.focusMode === "follow") context.focusMode = data.focusMode;
  const layers = record(data?.layers);
  if (layers && layerKeys.every(key => typeof layers[key] === "boolean")) context.layers = Object.fromEntries(layerKeys.map(key => [key, layers[key]])) as GraphLayers;
  return context;
}
/** No result is produced here. Only an existing, same-byte local snapshot can be displayed. */
function readSnapshot(value: unknown, digest: string): D006VerdictSnapshot | null {
  const data = record(value); const identity = record(data?.identity); const result = record(data?.result);
  if (data?.state !== "ANALYZED" || data.transferredContentDigest !== digest || !identity || !result
    || typeof identity.missionId !== "string" || !identity.missionId || typeof identity.runId !== "string" || !identity.runId
    || !["VALID", "INVALID", "INDETERMINATE", "REVOKED"].includes(String(result.verdict))
    || !Array.isArray(result.completedChecks) || !result.completedChecks.every(check => typeof check === "string")
    || !Array.isArray(result.reasonCodes) || !result.reasonCodes.every(reason => typeof reason === "string")
    || !(result.receiptId === null || typeof result.receiptId === "string")
    || !(result.bundleId === null || typeof result.bundleId === "string")) return null;
  return { state: "ANALYZED", transferredContentDigest: digest, identity: { missionId: identity.missionId, runId: identity.runId }, result: {
    verdict: result.verdict as D006VerdictSnapshot["result"]["verdict"], completedChecks: [...result.completedChecks], reasonCodes: [...result.reasonCodes], receiptId: result.receiptId, bundleId: result.bundleId,
  } };
}
export function graphParcel(value: unknown): GraphParcel | null {
  const data = record(value);
  if (!data || typeof data.text !== "string" || !data.text || data.text.length > MAX_BYTES
    || new TextEncoder().encode(data.text).byteLength > MAX_BYTES || typeof data.digest !== "string"
    || transferredContentDigest(data.text) !== data.digest || typeof data.name !== "string" || data.name.length > 1024) return null;
  return { text: data.text, digest: data.digest, name: data.name, locale: data.locale === "fr" ? "fr" : "en", context: readContext(data.context), snapshot: readSnapshot(data.snapshot, data.digest) };
}

/** Gesture-only, same-origin, one-shot MessageChannel handoff; no bytes in URLs or storage. */
export function openGraphInspection(input: GraphParcel & { onStatus: (status: GraphHandoffStatus) => void }, host: Window = window): () => void {
  const parcel = graphParcel(input);
  if (!parcel) { input.onStatus("failed"); return () => {}; }
  let nonce: string;
  try { nonce = browserNonce(host.crypto); }
  catch { input.onStatus("failed"); return () => {}; }
  const destination = new URL("/verify/graph", host.location.href);
  destination.hash = new URLSearchParams({ "verifier-graph": nonce }).toString();
  const channel = new MessageChannel(); let child: Window | null = null; let sent = false; let disposed = false; let timer = 0;
  const cleanup = () => { disposed = true; host.removeEventListener("message", ready); host.clearTimeout(timer); channel.port1.close(); channel.port2.close(); };
  const fail = (status: "failed" | "blocked") => { if (!disposed) { cleanup(); input.onStatus(status); } };
  const ready = (event: MessageEvent) => {
    if (disposed || sent || !child || event.source !== child || event.origin !== destination.origin || !messageIs(event.data, "ready", nonce)) return;
    sent = true; host.removeEventListener("message", ready);
    try { child.postMessage({ channel: CHANNEL, kind: "package", nonce, parcel }, destination.origin, [channel.port2]); }
    catch { fail("failed"); }
  };
  channel.port1.onmessage = event => {
    if (disposed || !sent) return;
    if (messageIs(event.data, "received", nonce) && record(event.data)?.digest === parcel.digest) { cleanup(); input.onStatus("opened"); }
    else if (messageIs(event.data, "rejected", nonce)) fail("failed");
  };
  channel.port1.start(); host.addEventListener("message", ready);
  try { child = host.open(destination.href, "_blank"); } catch { fail("blocked"); return cleanup; }
  if (!child) { fail("blocked"); return cleanup; }
  input.onStatus("opening"); timer = host.setTimeout(() => fail("failed"), 30_000);
  return cleanup;
}

/** The graph remains locally inspectable after its source Verifier closes. */
export function receiveGraphInspection(onParcel: (parcel: GraphParcel, returnToVerifier: () => void) => void, onError: () => void, host: Window = window): () => void {
  const nonce = new URLSearchParams(host.location.hash.slice(1)).get("verifier-graph") ?? "";
  const source: Window | null = host.opener; const origin = host.location.origin;
  if (!source || !NONCE.test(nonce) || !/^https?:/.test(origin)) return () => {};
  let consumed = false; let timer = 0;
  const cleanup = () => { consumed = true; host.removeEventListener("message", receive); host.clearTimeout(timer); };
  const detach = () => { host.history.replaceState(host.history.state, "", host.location.pathname + host.location.search); host.opener = null; };
  const receive = (event: MessageEvent) => {
    if (consumed || event.source !== source || event.origin !== origin || !messageIs(event.data, "package", nonce)) return;
    const port = event.ports[0]; const parcel = graphParcel(record(event.data)?.parcel);
    cleanup(); detach();
    if (!port || !parcel) { port?.postMessage({ channel: CHANNEL, kind: "rejected", nonce }); port?.close(); onError(); return; }
    const returnToVerifier = () => {
      try { if (!source.closed) { source.focus(); return; } } catch { /* Source closure cannot discard the received graph. */ }
      host.location.assign("/verify");
    };
    onParcel(parcel, returnToVerifier);
    port.postMessage({ channel: CHANNEL, kind: "received", nonce, digest: parcel.digest }); port.close();
  };
  host.addEventListener("message", receive);
  timer = host.setTimeout(() => { cleanup(); detach(); onError(); }, 30_000);
  source.postMessage({ channel: CHANNEL, kind: "ready", nonce }, origin);
  return cleanup;
}

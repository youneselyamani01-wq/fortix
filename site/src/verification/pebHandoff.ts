import { browserNonce } from "./browserNonce";

/** Browser-only transport. Receiving a File never analyzes it or establishes provenance. */
export const PEB_HANDOFF_CHANNEL = "fortix-peb-intake-v1";
export const MAX_PEB_BYTES = 20 * 1024 * 1024;
export type IntakeLocale = "en" | "fr";
export type HandoffStatus = "opening" | "received" | "blocked" | "failed";
const TIMEOUT_MS = 30_000;
const NONCE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function acceptablePebFile(file: unknown): file is File {
  return file instanceof File && file.size > 0 && file.size <= MAX_PEB_BYTES;
}

function httpUrl(value: string, base?: string): URL {
  const url = new URL(value, base);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new TypeError("HTTP(S) destination required");
  return url;
}

export function intakeRequest(hash: string): { nonce: string; origin: string; locale: IntakeLocale } | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const nonce = params.get("peb-intake") ?? "";
  const origin = params.get("source") ?? "";
  try {
    if (!NONCE.test(nonce) || httpUrl(origin).origin !== origin) return null;
    return { nonce, origin, locale: params.get("lang") === "fr" ? "fr" : "en" };
  } catch { return null; }
}

function messageIs(data: unknown, type: string, nonce: string): data is Record<string, unknown> {
  if (typeof data !== "object" || data === null) return false;
  const message = data as Record<string, unknown>;
  return message.channel === PEB_HANDOFF_CHANNEL && message.type === type && message.nonce === nonce;
}

/** Called synchronously from a user's drop/selection/retry, so opening is not delayed by file reading. */
export function openPebVerifier(file: File, destination: string, locale: IntakeLocale, onStatus: (status: HandoffStatus) => void, host: Window = window): () => void {
  if (!acceptablePebFile(file)) { onStatus("failed"); return () => {}; }
  let nonce: string;
  let url: URL;
  try {
    nonce = browserNonce(host.crypto);
    url = httpUrl(destination, host.location.href);
    url.hash = new URLSearchParams({ "peb-intake": nonce, source: host.location.origin, lang: locale }).toString();
  } catch { onStatus("failed"); return () => {}; }
  let child: Window | null = null;
  let sent = false;
  let finished = false;
  let timer = 0;
  const cleanup = () => { finished = true; host.removeEventListener("message", receive); host.clearTimeout(timer); };
  const finish = (status: HandoffStatus) => { if (!finished) { cleanup(); onStatus(status); } };
  const receive = (event: MessageEvent) => {
    if (finished || event.origin !== url.origin || event.source !== child) return;
    if (!sent && messageIs(event.data, "ready", nonce)) {
      sent = true;
      try { child?.postMessage({ channel: PEB_HANDOFF_CHANNEL, type: "package", nonce, file }, url.origin); }
      catch { finish("failed"); }
    } else if (sent && messageIs(event.data, "received", nonce)) finish("received");
    else if (sent && messageIs(event.data, "rejected", nonce)) finish("failed");
  };
  host.addEventListener("message", receive);
  try {
    // The temporary opener exists only for this origin/source/nonce-scoped handshake.
    // Ordinary navigation uses noopener. The receiver severs this reference before reading the File.
    child = host.open(url.href, "_blank");
  } catch { finish("blocked"); return cleanup; }
  if (!child) { finish("blocked"); return cleanup; }
  onStatus("opening");
  timer = host.setTimeout(() => finish("failed"), TIMEOUT_MS);
  return cleanup;
}

/** One-use receiver. No URL/file-derived identity, analysis request, verdict or persistent storage. */
export function receivePebFromSite(onFile: (file: File, locale: IntakeLocale) => Promise<boolean>, onError: () => void, host: Window = window): () => void {
  const request = intakeRequest(host.location.hash);
  const source: Window | null = host.opener;
  if (!request || !source) return () => {};
  let consumed = false;
  let disposed = false;
  let timer = 0;
  const stopListening = () => { host.removeEventListener("message", receive); host.clearTimeout(timer); };
  const cleanup = () => { disposed = true; consumed = true; stopListening(); };
  const detach = () => {
    host.history.replaceState(host.history.state, "", host.location.pathname + host.location.search);
    host.opener = null;
  };
  const receive = (event: MessageEvent) => {
    if (consumed || event.origin !== request.origin || event.source !== source || !messageIs(event.data, "package", request.nonce)) return;
    consumed = true; stopListening(); detach();
    const file: unknown = event.data.file;
    if (!acceptablePebFile(file)) {
      source.postMessage({ channel: PEB_HANDOFF_CHANNEL, type: "rejected", nonce: request.nonce }, request.origin);
      onError(); return;
    }
    void onFile(file, request.locale).then((accepted) => {
      if (disposed) return;
      source.postMessage({ channel: PEB_HANDOFF_CHANNEL, type: accepted ? "received" : "rejected", nonce: request.nonce }, request.origin);
    }).catch(() => {
      if (disposed) return;
      source.postMessage({ channel: PEB_HANDOFF_CHANNEL, type: "rejected", nonce: request.nonce }, request.origin);
      onError();
    });
  };
  host.addEventListener("message", receive);
  timer = host.setTimeout(() => { cleanup(); detach(); onError(); }, TIMEOUT_MS);
  source.postMessage({ channel: PEB_HANDOFF_CHANNEL, type: "ready", nonce: request.nonce }, request.origin);
  return cleanup;
}

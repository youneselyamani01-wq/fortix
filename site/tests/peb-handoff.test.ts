import type { NonceCrypto } from "../src/verification/browserNonce";
import { afterEach, describe, expect, it, vi } from "vitest";
import { acceptablePebFile, intakeRequest, MAX_PEB_BYTES, openPebVerifier, PEB_HANDOFF_CHANNEL, receivePebFromSite } from "../src/verification/pebHandoff";

const nonce = "c8f688ec-629b-4b32-94ad-4bead7bdb645";
const message = (type: string, fields = {}) => ({ channel: PEB_HANDOFF_CHANNEL, nonce, type, ...fields });
class Surface {
  location: URL;
  listeners = new Set<(event: MessageEvent) => void>();
  opener: Window | null = null;
  crypto: NonceCrypto = { randomUUID: () => nonce };
  history = { state: null, replaceState: (_state: unknown, _title: string, path: string) => { this.location = new URL(path, this.location.href); } };
  open = vi.fn<(url: string, target: string) => Window | null>(() => null);
  postMessage = vi.fn<(data: unknown, targetOrigin: string) => void>();
  constructor(url: string) { this.location = new URL(url); }
  addEventListener(_type: string, handler: (event: MessageEvent) => void) { this.listeners.add(handler); }
  removeEventListener(_type: string, handler: (event: MessageEvent) => void) { this.listeners.delete(handler); }
  setTimeout(handler: () => void, delay: number) { return window.setTimeout(handler, delay); }
  clearTimeout(timer: number) { window.clearTimeout(timer); }
  asWindow() { return this as unknown as Window; }
  emit(data: unknown, origin: string, source: Surface | null) { for (const listener of this.listeners) listener({ data, origin, source: source?.asWindow() ?? null } as MessageEvent); }
}
const freshFile = () => new File(['{"evidence":"é"}\r\n'], "evidence.json", { type: "application/json" });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

function pair() {
  const site = new Surface("https://site.example/");
  const verifier = new Surface("https://verify.example/verify");
  site.open.mockImplementation((url) => { verifier.location = new URL(url); verifier.opener = site.asWindow(); return verifier.asWindow(); });
  return { site, verifier };
}

describe("separate-tab PEB handoff", () => {
  it("opens immediately, sends the exact File only after matching origin/window/nonce, and acknowledges once", () => {
    const { site, verifier } = pair(); const file = freshFile(); const status = vi.fn();
    const cleanup = openPebVerifier(file, verifier.location.href, "fr", status, site.asWindow());
    expect(site.open).toHaveBeenCalledWith(expect.stringContaining("/verify#peb-intake="), "_blank");
    const url = site.open.mock.calls[0]![0];
    expect(url).not.toContain(file.name); expect(url).not.toContain("evidence");
    expect(intakeRequest(new URL(url).hash)).toEqual({ nonce, origin: site.location.origin, locale: "fr" });
    verifier.postMessage.mockClear();
    site.emit(message("ready"), "https://attacker.example", verifier);
    site.emit(message("ready"), verifier.location.origin, new Surface(verifier.location.href));
    site.emit(message("ready", { nonce: "wrong" }), verifier.location.origin, verifier);
    site.emit(message("received"), verifier.location.origin, verifier);
    expect(verifier.postMessage).not.toHaveBeenCalled(); expect(status.mock.calls).toEqual([["opening"]]);
    site.emit(message("ready"), verifier.location.origin, verifier);
    expect(verifier.postMessage).toHaveBeenCalledExactlyOnceWith(message("package", { file }), verifier.location.origin);
    site.emit(message("ready"), verifier.location.origin, verifier);
    expect(verifier.postMessage).toHaveBeenCalledTimes(1);
    site.emit(message("received"), verifier.location.origin, verifier);
    site.emit(message("received"), verifier.location.origin, verifier);
    expect(status.mock.calls).toEqual([["opening"], ["received"]]); expect(site.listeners.size).toBe(0); cleanup();
  });

  it("reports popup blocking and timeout without claiming a package was received", () => {
    vi.useFakeTimers();
    const { site, verifier } = pair(); const status = vi.fn();
    site.open.mockReturnValueOnce(null);
    openPebVerifier(freshFile(), verifier.location.href, "en", status, site.asWindow());
    expect(status.mock.calls).toEqual([["blocked"]]); expect(site.listeners.size).toBe(0);
    status.mockClear();
    openPebVerifier(freshFile(), verifier.location.href, "en", status, site.asWindow());
    vi.advanceTimersByTime(30_000);
    expect(status.mock.calls).toEqual([["opening"], ["failed"]]); expect(site.listeners.size).toBe(0);
  });

  it("rejects non-HTTP destinations and empty/oversized/non-File inputs before opening", () => {
    const { site } = pair(); const status = vi.fn();
    expect(acceptablePebFile({ size: 1 })).toBe(false);
    expect(acceptablePebFile(new File([], "empty.json"))).toBe(false);
    const huge = freshFile(); Object.defineProperty(huge, "size", { value: MAX_PEB_BYTES + 1 });
    openPebVerifier(huge, "https://verify.example/verify", "en", status, site.asWindow());
    openPebVerifier(freshFile(), "javascript:alert(1)", "en", status, site.asWindow());
    expect(site.open).not.toHaveBeenCalled();
    for (const hash of ["", "#peb-intake=wrong&source=https://site.example", `#peb-intake=${nonce}&source=null`, `#peb-intake=${nonce}&source=https://site.example/path`, `#peb-intake=${nonce}&source=file://`]) expect(intakeRequest(hash)).toBeNull();
  });

  it("receives one File only from its expected opener and passes it unchanged without an analysis request", async () => {
    const { site, verifier } = pair(); const file = freshFile();
    const cleanup = openPebVerifier(file, verifier.location.href, "fr", vi.fn(), site.asWindow());
    const receive = vi.fn(async () => true); const error = vi.fn();
    const stop = receivePebFromSite(receive, error, verifier.asWindow());
    expect(site.postMessage).toHaveBeenCalledExactlyOnceWith(message("ready"), site.location.origin);
    verifier.emit(message("package", { file }), "https://attacker.example", site);
    verifier.emit(message("package", { file }), site.location.origin, new Surface(site.location.href));
    verifier.emit(message("package", { file, nonce: "wrong" }), site.location.origin, site);
    expect(receive).not.toHaveBeenCalled();
    verifier.emit(message("package", { file }), site.location.origin, site);
    verifier.emit(message("package", { file }), site.location.origin, site);
    await Promise.resolve();
    expect(receive).toHaveBeenCalledExactlyOnceWith(file, "fr");
    expect(site.postMessage).toHaveBeenLastCalledWith(message("received"), site.location.origin);
    expect(verifier.opener).toBeNull(); expect(verifier.location.hash).toBe(""); expect(verifier.listeners.size).toBe(0); expect(error).not.toHaveBeenCalled();
    cleanup(); stop();
  });

  it("rejects malformed and unreadable payloads without receipt acknowledgment", async () => {
    for (const payload of [{ fake: "File" }, freshFile()]) {
      const { site, verifier } = pair();
      const cleanup = openPebVerifier(freshFile(), verifier.location.href, "en", vi.fn(), site.asWindow());
      const receive = vi.fn(async () => false); const error = vi.fn();
      const stop = receivePebFromSite(receive, error, verifier.asWindow());
      verifier.emit(message("package", { file: payload }), site.location.origin, site);
      await Promise.resolve();
      expect(site.postMessage).toHaveBeenLastCalledWith(message("rejected"), site.location.origin);
      expect(site.postMessage.mock.calls.some(([data]) => (data as { type: string }).type === "received")).toBe(false);
      expect(verifier.opener).toBeNull(); cleanup(); stop();
    }
  });

  it("does not acknowledge a pending File read after receiver cleanup", async () => {
    const { site, verifier } = pair(); const file = freshFile();
    const cleanup = openPebVerifier(file, verifier.location.href, "en", vi.fn(), site.asWindow());
    let finishRead!: (accepted: boolean) => void;
    const receive = vi.fn(() => new Promise<boolean>((resolve) => { finishRead = resolve; }));
    const error = vi.fn();
    const stop = receivePebFromSite(receive, error, verifier.asWindow());
    verifier.emit(message("package", { file }), site.location.origin, site);
    expect(receive).toHaveBeenCalledOnce();
    stop(); finishRead(true); await Promise.resolve();
    expect(site.postMessage.mock.calls.map(([data]) => (data as { type: string }).type)).toEqual(["ready"]);
    expect(error).not.toHaveBeenCalled(); cleanup();
  });

  it("cleans up an abandoned receiver and never accepts a late delivery", () => {
    vi.useFakeTimers(); const { site, verifier } = pair();
    const cleanup = openPebVerifier(freshFile(), verifier.location.href, "en", vi.fn(), site.asWindow());
    const receive = vi.fn(async () => true); const error = vi.fn();
    receivePebFromSite(receive, error, verifier.asWindow());
    vi.advanceTimersByTime(30_000);
    verifier.emit(message("package", { file: freshFile() }), site.location.origin, site);
    expect(receive).not.toHaveBeenCalled(); expect(error).toHaveBeenCalledOnce(); expect(verifier.opener).toBeNull(); cleanup();
  });
});

it("hands off the exact File across LAN ports without secure-context randomUUID", async () => {
  for (const host of ["192.168.1.42", "[2001:db8::42]"]) {
    const site = new Surface(`http://${host}:5174/`); const verifier = new Surface(`http://${host}:3000/verify`);
    site.crypto = { getRandomValues: crypto.getRandomValues.bind(crypto) } as Crypto;
    site.open.mockImplementation(url => { verifier.location = new URL(url); verifier.opener = site.asWindow(); return verifier.asWindow(); });
    const file = freshFile(); const status = vi.fn();
    const stop = openPebVerifier(file, verifier.location.href, "fr", status, site.asWindow());
    const request = intakeRequest(verifier.location.hash)!;
    expect(request.origin).toBe(site.location.origin); expect(verifier.location.origin).toBe(`http://${host}:3000`);
    const packet = (type: string, fields = {}) => ({ channel: PEB_HANDOFF_CHANNEL, nonce: request.nonce, type, ...fields });
    const receive = vi.fn(async () => true); const error = vi.fn();
    const stopChild = receivePebFromSite(receive, error, verifier.asWindow());
    site.emit(packet("ready"), verifier.location.origin, verifier);
    expect(verifier.postMessage).toHaveBeenLastCalledWith(packet("package", { file }), verifier.location.origin);
    verifier.emit(packet("package", { file }), site.location.origin, site); await Promise.resolve();
    expect(receive).toHaveBeenCalledExactlyOnceWith(file, "fr");
    site.emit(packet("received"), verifier.location.origin, verifier);
    expect(status.mock.calls).toEqual([["opening"], ["received"]]); expect(error).not.toHaveBeenCalled();
    expect(verifier.opener).toBeNull(); stopChild(); stop();
  }
});

it("reports failed without opening or listening if secure nonce generation is unavailable", () => {
  const { site, verifier } = pair(); const status = vi.fn(); site.crypto = {} as Crypto;
  expect(() => openPebVerifier(freshFile(), verifier.location.href, "en", status, site.asWindow())()).not.toThrow();
  expect(status.mock.calls).toEqual([["failed"]]); expect(site.open).not.toHaveBeenCalled(); expect(site.listeners.size).toBe(0);
});
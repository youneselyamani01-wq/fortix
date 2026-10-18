import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadReferencePeb, REFERENCE_PEB_URL, REFERENCE_PEB_FILENAME } from "../src/verification/downloadReferencePeb";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function stubTransfer(raw: string, options: { ok?: boolean; status?: number; size?: number } = {}) {
  const blob = { size: options.size ?? raw.length, text: async () => raw } as Blob;
  const mockFetch = vi.fn(async () => ({
    ok: options.ok ?? true,
    status: options.status ?? 200,
    blob: async () => blob,
  }));
  vi.stubGlobal("fetch", mockFetch);
  const createURL = vi.fn(() => "blob:https://fortix.cloud/example");
  const revokeURL = vi.fn();
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createURL });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeURL });
  const clicks: Array<{ href: string; download: string }> = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    clicks.push({ href: this.href, download: this.download });
  });
  return { mockFetch, clicks, revokeURL };
}

describe("public PEB download", () => {
  it("downloads same-origin original bytes as JSON file without opening a raw tab", async () => {
    const raw = '{\n  "profile": "fortix.demo.d006.peb.v1", "identity": { "runId": "test" }\n}\n';
    const { mockFetch, clicks, revokeURL } = stubTransfer(raw);
    vi.useFakeTimers();
    await downloadReferencePeb();
    expect(mockFetch).toHaveBeenCalledWith(REFERENCE_PEB_URL, {
      credentials: "same-origin", cache: "no-cache",
    });
    expect(clicks).toHaveLength(1);
    expect(clicks[0]?.download).toBe(REFERENCE_PEB_FILENAME);
    expect(clicks[0]?.href).toContain("blob:");
    expect(document.querySelector("a[download]")).toBeNull();
    vi.advanceTimersByTime(60_000);
    expect(revokeURL).toHaveBeenCalledOnce();
  });

  it("refuses HTML fallback pages even when the server returns 200", async () => {
    const { clicks } = stubTransfer("<html>Not a PEB</html>");
    await expect(downloadReferencePeb()).rejects.toThrow("not a JSON PEB");
    expect(clicks).toHaveLength(0);
  });

  it("refuses another JSON profile instead of downloading the wrong file", async () => {
    const { clicks } = stubTransfer('{"profile":"other"}');
    await expect(downloadReferencePeb()).rejects.toThrow("not the expected D-006 PEB");
    expect(clicks).toHaveLength(0);
  });

  it("reports a missing reference file instead of saving a broken download", async () => {
    const { clicks } = stubTransfer("missing", { ok: false, status: 404 });
    await expect(downloadReferencePeb()).rejects.toThrow("HTTP 404");
    expect(clicks).toHaveLength(0);
  });

  it("rejects empty or over-limit responses", async () => {
    const { clicks } = stubTransfer("{}", { size: 0 });
    await expect(downloadReferencePeb()).rejects.toThrow("size is invalid");
    expect(clicks).toHaveLength(0);
  });
});

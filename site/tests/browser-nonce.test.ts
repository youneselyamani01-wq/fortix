import { describe, expect, it, vi } from "vitest";
import { browserNonce, type NonceCrypto } from "../src/verification/browserNonce";

const nativeNonce = "c8f688ec-629b-4b32-94ad-4bead7bdb645";
const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
describe("browser handoff nonce", () => {
  it("keeps native randomUUID and its Crypto receiver when available", () => {
    const provider: NonceCrypto = { randomUUID() { expect(this).toBe(provider); return nativeNonce; }, getRandomValues: vi.fn() };
    expect(browserNonce(provider)).toBe(nativeNonce);
    expect(provider.getRandomValues).not.toHaveBeenCalled();
  });
  it("uses all 16 random bytes and only fixes UUID version and variant on HTTP LAN", () => {
    const getRandomValues = vi.fn((array: Uint8Array) => { array.set(Array.from({ length: 16 }, (_, index) => index)); return array; });
    const nonce = browserNonce({ getRandomValues: getRandomValues as Crypto["getRandomValues"] });
    expect(getRandomValues).toHaveBeenCalledOnce();
    expect(nonce).toBe("00010203-0405-4607-8809-0a0b0c0d0e0f");
    expect(nonce).toMatch(uuidV4);
  });
  it("gets a fresh unpredictable nonce on each fallback call", () => {
    const provider = { getRandomValues: crypto.getRandomValues.bind(crypto) };
    const first = browserNonce(provider); const second = browserNonce(provider);
    expect(first).toMatch(uuidV4); expect(second).toMatch(uuidV4); expect(second).not.toBe(first);
  });
  it("fails closed without a functioning cryptographic random source", () => {
    expect(() => browserNonce(undefined)).toThrow();
    expect(() => browserNonce({})).toThrow();
    expect(() => browserNonce({ getRandomValues() { throw new Error("unavailable"); } })).toThrow("unavailable");
  });
});

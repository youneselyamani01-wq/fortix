/** Transport nonce only: no evidence, signature, verifier or run-identity semantics. */
export type NonceCrypto = Partial<Pick<Crypto, "randomUUID" | "getRandomValues">>;

/** UUID v4 with 122 random bits, including HTTP LAN browsers without randomUUID. */
export function browserNonce(crypto: NonceCrypto | undefined): string {
  if (typeof crypto?.randomUUID === "function") return crypto.randomUUID();
  if (typeof crypto?.getRandomValues !== "function") throw new TypeError("Secure random source unavailable");
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

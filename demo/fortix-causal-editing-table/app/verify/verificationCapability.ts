/** UI orchestration preflight only; this neither checks evidence nor produces a verdict. */
export type VerificationCrypto = { subtle?: Partial<Pick<SubtleCrypto, "importKey" | "verify">> };

/** HTTP LAN contexts omit SubtleCrypto. Do not call the verifier without its browser APIs. */
export function canVerifyLocally(crypto: VerificationCrypto | null | undefined = globalThis.crypto): boolean {
  return typeof crypto?.subtle?.importKey === "function" && typeof crypto?.subtle?.verify === "function";
}

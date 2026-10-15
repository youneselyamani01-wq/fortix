import type { D006VerdictSnapshot } from "../offlineVerification.ts";

const snapshots = new Map<string, D006VerdictSnapshot>();

/** Ephemeral same-document result cache. Exact PEB bytes remain the binding key. */
export function rememberVerifierSnapshot(snapshot: D006VerdictSnapshot): void {
  snapshots.set(snapshot.transferredContentDigest, snapshot);
}

export function verifierSnapshotForDigest(digest: string): D006VerdictSnapshot | null {
  const snapshot = snapshots.get(digest) ?? null;
  return snapshot?.transferredContentDigest === digest ? snapshot : null;
}

export function forgetVerifierSnapshot(digest: string): void {
  snapshots.delete(digest);
}

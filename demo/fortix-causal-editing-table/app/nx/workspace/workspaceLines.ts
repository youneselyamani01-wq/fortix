import type { CanonicalVerdict } from "../../verification.ts";
import type {
  PublicFinalReceipt,
  PublicHandoff,
  PublicNetwork,
  PublicPortableEvidence,
  PublicVerification,
} from "../adapter/publicExperienceAdapter.ts";

/**
 * NX1 R3/B — the one-line states of the workspace surfaces, as pure
 * functions of the adapter's model and the dictionaries. Kept apart from the
 * components so a test can run them under node without a JSX transform, and
 * so the compact lines are provably state-driven: no literal, no guess.
 */

export type ReconciliationLineCopy = Readonly<{
  local: string;
  returned: string;
  comparing: string;
  reconciled: string;
  failed: string;
}>;

/**
 * The reconciliation band's sentence, chosen by the runtime's actual stage.
 * While the journal holds an open offline window — or the machine admits
 * LOST — the sentence is the offline one; the cable alone never says
 * "reconciled".
 *
 * C-R2-F04 — IT SPEAKS ONLY WHEN THERE IS RECONCILIATION TO REPORT, and is
 * SILENT otherwise. It used to fill the quiet with a sentence about the link
 * and where evidence was kept ("Réseau établi · preuves conservées sur cette
 * machine"), which human review found verbose and semantically noisy — it
 * mixed two facts the whole design keeps apart. Link state is now the signal
 * chip's, and only its; evidence location remains this band's, stated as its
 * own fact beside this sentence rather than folded into it.
 */
export function reconciliationLine(network: PublicNetwork, copy: ReconciliationLineCopy): string | null {
  switch (network.reconciliationStage) {
    case "LOCAL_EVIDENCE": return copy.local;
    case "CONNECTION_RETURNED": return copy.returned;
    case "COMPARING": return copy.comparing;
    case "RECONCILED": return copy.reconciled.replace("{count}", String(network.transferredCount ?? 0));
    case "FAILED": return copy.failed;
    default:
      // An admitted loss is an evidence fact — the mission is recording
      // locally — and it is said even before a reconciliation stage exists.
      if (network.state === "LOST") return copy.local;
      return null;
  }
}

export type LinkLineCopy = Readonly<{
  title: string;
  connected: string;
  lost: string;
  unobserved: string;
}>;

/** The physical link chip: the sentinel's fresh observation, else "not observed". */
export function linkLine(network: PublicNetwork, copy: LinkLineCopy): string {
  const state = network.linkPhase === "CONNECTED"
    ? copy.connected
    : network.linkPhase === "LOST" ? copy.lost : copy.unobserved;
  return `${copy.title} · ${state}`;
}

export type VerifierLineCopy = Readonly<{
  awaiting: string;
  /** The artifact is in a person's hand; the verifier has it not. */
  carried: string;
  handedOver: string;
  analyzing: string;
  verdicts: Readonly<Record<CanonicalVerdict, Readonly<{ headline: string }>>>;
}>;

/** The verifier's one-line state, from the actual handoff and the actual result. */
export function verifierLine(handoff: PublicHandoff, verification: PublicVerification, copy: VerifierLineCopy): string {
  if (verification.state === "VERDICT" && verification.verdict !== null) return copy.verdicts[verification.verdict].headline;
  if (verification.state === "ANALYZING") return copy.analyzing;
  if (handoff.stage === "HANDED_OVER") return copy.handedOver;
  // Picked up is not received: the line says so rather than "awaiting", which
  // would let a viewer believe the pick had done the transfer.
  if (handoff.stage === "CARRIED") return copy.carried;
  return copy.awaiting;
}

export type DossierLineCopy = Readonly<{
  empty: string;
  nrOne: string;
  nrMany: string;
  finalReceipt: string;
  peb: string;
  pebState: Readonly<Record<PublicPortableEvidence["state"], string>>;
}>;

/**
 * The dossier's compact line: only counts that are actually true for this
 * runtime, and the PEB with its actual state once it exists.
 */
export function dossierLine(count: number, finalReceipt: PublicFinalReceipt | null, portable: PublicPortableEvidence, copy: DossierLineCopy): string {
  const parts: string[] = [];
  if (count === 1) parts.push(copy.nrOne);
  else if (count > 1) parts.push(copy.nrMany.replace("{count}", String(count)));
  if (finalReceipt !== null) parts.push(`1 ${copy.finalReceipt}`);
  if (portable.bundleId !== null) parts.push(`${copy.peb} · ${copy.pebState[portable.state]}`);
  return parts.length === 0 ? copy.empty : parts.join(" · ");
}


/** Historical physical-transition receipts; separate from the mission presentation queue. */
export function networkReceiptLine(network: Pick<PublicNetwork, "lostCount" | "restoredCount" | "linkPhase">, locale: "en" | "fr"): Readonly<{ label: string; detail: string }> | null {
  if (network.lostCount === 0 && network.restoredCount === 0) return null;
  return {
    label: locale === "fr"
      ? `NR réseau · perte ${network.lostCount} · reprise ${network.restoredCount}`
      : `Network NRs · loss ${network.lostCount} · restore ${network.restoredCount}`,
    detail: `RJ45 ${network.linkPhase} · NR-NET-LOST ×${network.lostCount} · NR-NET-RESTORED ×${network.restoredCount}`,
  };
}

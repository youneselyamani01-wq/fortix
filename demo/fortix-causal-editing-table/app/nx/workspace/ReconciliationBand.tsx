"use client";

import type { PublicNetwork } from "../adapter/publicExperienceAdapter.ts";
import { reconciliationLine } from "./workspaceLines.ts";

/**
 * NX1 R3/B — RECONCILIATION, the compact band above the two inspection panels.
 *
 * Answers one question: how did locally held evidence reconcile after the
 * connection returned? It is state-driven and quiet by default. While the
 * link is LOST it holds a calm system-state line — the mission continues,
 * evidence continues locally — becomes meaningful around the actual
 * reconciliation (ACTIVE), then returns to a compact completed state.
 * RESTORED is a transition inside that window, never a resting third
 * network state; evidence location is shown as its own fact, never as a
 * network alias, and nothing here implies activity the runtime does not
 * report.
 */

export type ReconciliationCopy = Readonly<{
  title: string;
  aria: string;
  local: string;
  returned: string;
  comparing: string;
  reconciled: string;
  failed: string;
  receipt: string;
  evidenceLocal: string;
  evidenceReconciled: string;
  verdictHeld: string;
  reasons: string;
  restoredEvent: string;
}>;

export function ReconciliationBand({ network, copy }: { network: PublicNetwork; copy: ReconciliationCopy }) {
  return (
    <section
      className="nx-reconciliation"
      aria-label={copy.aria}
      data-tone={network.bandTone}
      data-stage={network.reconciliationStage}
      data-network={network.state}
      data-link={network.linkPhase}
      data-evidence-locality={network.evidenceLocality}
      data-flash={network.transitionFlash ?? ""}
      data-network-receipts={`${network.lostCount} ${network.restoredCount} ${network.reconciliationReceiptCount}`}
    >
      <span className="nx-kicker">{copy.title}</span>
      {/* Silent unless there is reconciliation to report (C-R2-F04). The live
          region stays mounted so a screen reader is told when the sentence
          arrives; it simply has nothing to say for most of a run. */}
      <p aria-live="polite">
        {network.transitionFlash === "RESTORED" ? copy.restoredEvent : reconciliationLine(network, copy) ?? ""}
      </p>
      <span className="nx-band-facts">
        <em data-locality={network.evidenceLocality}>
          {network.evidenceLocality === "RECONCILED" ? copy.evidenceReconciled : copy.evidenceLocal}
        </em>
        {/* A finding and an artefact, not live states: both wear the recorded mark. */}
        {network.verdictUnchanged === true && <em className="nx-recorded" data-tone="valid" data-verdict-held="true">{copy.verdictHeld}</em>}
        {network.reconciliationStage === "RECONCILED" && network.transferredCount !== null && (
          <small className="nx-recorded" data-receipt-id={network.reconciliationReceiptId ?? ""}>{copy.receipt}</small>
        )}
      </span>
      {network.reconciliationStage === "FAILED" && network.reconciliationReasons.length > 0 && (
        <ul className="nx-band-reasons">
          <li className="nx-kicker">{copy.reasons}</li>
          {network.reconciliationReasons.map((reason) => <li key={reason}><code>{reason}</code></li>)}
        </ul>
      )}
    </section>
  );
}

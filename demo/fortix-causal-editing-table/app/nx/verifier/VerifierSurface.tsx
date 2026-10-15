"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from "react";

import type { FactInspection } from "../../publicFacts.ts";
import type { CanonicalVerdict } from "../../verification.ts";
import type { PublicHandoff, PublicNetwork, PublicPortableEvidence, PublicVerification } from "../adapter/publicExperienceAdapter.ts";
import { linkLine, verifierLine, type LinkLineCopy } from "../workspace/workspaceLines.ts";
import { revealPlan } from "./choreography.ts";
import { InspectPanel, type InspectCopy } from "./InspectPanel.tsx";
import type { InspectSection } from "./inspectSections.ts";
import "./verifier.css";

/**
 * D-006/NX3 — THE INDEPENDENT VERIFIER AS A DEDICATED SURFACE.
 *
 * WHAT THIS IS. A distinct instrument that opens OVER the mission — its own
 * header, its own chrome, the mission dimmed behind it — and answers one
 * question: what can an independent verifier establish? It receives the PEB
 * through a separate act, analyzes it on a second act a person performs, and
 * shows the verifier's own result. It creates no evidence and says so.
 *
 * WHY A SAME-DOCUMENT SURFACE AND NOT `window.open()`. The engine state lives
 * in this React tree: the transfer stage, the analysis request and the
 * verifier's result are the engine's, held by `useMissionEngine`, and a second
 * window would have to reinvent or mirror them. Every state must also be
 * reachable by a review deep link (`?peb=picked`, `?handoff=done`,
 * `?analysis=requested`, `?inspect=<section>`) and reproduced by a headless
 * capture, deterministically — a dialog in the same document is the only
 * surface that satisfies both. It is a modal dialog in the ARIA sense: it
 * traps focus, closes on Escape, and returns focus to whatever opened it.
 *
 * THE CHOREOGRAPHY, each step a visible state (`data-phase`):
 *
 *   PICK      the dossier's act; opens this surface. Opening transfers
 *             NOTHING — `handoff.stage` stays CARRIED and the empty state
 *             says so in three lines: not received · no analysis · no verdict.
 *   DROP      a release over the receiving surface, or the Deposit act; the
 *             engine's INSERT. Only then does the verifier hold the PEB.
 *   ANALYZE   an explicit act, enabled only once HANDED_OVER. Never automatic.
 *   VERDICT   the verifier's own word — VALID, INVALID, INDETERMINATE or
 *             REVOKED, read from the result and never written here.
 *   INSPECT   after the verdict only: the supporting material, read-only.
 *
 * Connectivity is not an input. The verifier carries its own pinned
 * directory, so it receives and verifies while the link is LOST, and the
 * surface states when that was the case. A reconnection changes no verdict.
 */

export type VerifierSurfaceCopy = Readonly<{
  instrument: string;
  aria: string;
  question: string;
  relation: string;
  close: string;
  awaiting: string;
  /** Picked up, presented to no one: the verifier holds nothing yet. */
  carried: string;
  handedOver: string;
  analyzing: string;
  notReady: string;
  dropHere: string;
  dropArmed: string;
  deposit: string;
  release: string;
  analyze: string;
  inspectVerdict: string;
  notReceived: string;
  noAnalysis: string;
  noVerdict: string;
  received: string;
  missionId: string;
  objects: string;
  bundleStatus: string;
  digest: string;
  pebState: Readonly<Record<PublicPortableEvidence["state"], string>>;
  link: LinkLineCopy & Readonly<{ lostNote: string; sentinelAbsent: string }>;
  offline: string;
  online: string;
  unobserved: string;
  result: string;
  verdict: string;
  checks: string;
  established: string;
  notEstablished: string;
  facts: string;
  receivedOffline: string;
  verdictOffline: string;
  verdictHeld: string;
  establishes: Readonly<Record<keyof NonNullable<PublicVerification["establishes"]>, string>>;
  verdicts: Readonly<Record<CanonicalVerdict, Readonly<{ headline: string; scope: string; reading: string }>>>;
  productionTrustMissing: string;
  settlementNotShown: string;
  statements: Readonly<Record<string, string>>;
  inspectionStatus: Readonly<Record<FactInspection["status"], string>>;
  inspect: InspectCopy;
}>;

const ESTABLISHES_ORDER: readonly (keyof NonNullable<PublicVerification["establishes"]>)[] = [
  "transferredBytesExact", "bundleIntegrity", "missionRunIdentity", "trustAuthorization", "signatures", "causalClosure", "displayedCoverage", "nonSettlement",
];

/** What Tab may land on inside the dialog: the trap cycles through these. */
const FOCUSABLE = "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

/** A long digest, shortened for the receipt line; the full value stays in the title and the trust record. */
function abbreviated(digest: string): string {
  return digest.length <= 20 ? digest : `${digest.slice(0, 20)}…`;
}

/**
 * The person's motion preference, read as an external store: false on the
 * server and until the browser answers, live afterwards — so the reveal plan
 * is derived from it in render, and nothing is set inside an effect.
 */
const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";
const subscribeReducedMotion = (onChange: () => void) => {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
};
const readReducedMotion = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(REDUCED_MOTION).matches;
const readReducedMotionOnServer = () => false;

export function VerifierSurface({ open, handoff, verification, portable, network, missionId, pointerOver, dropTargetRef, inspect, copy, onClose, onDrop, onRelease, onAnalyze, onInspect }: {
  open: boolean;
  handoff: PublicHandoff;
  verification: PublicVerification;
  portable: PublicPortableEvidence;
  network: PublicNetwork;
  missionId: string;
  /** True while the pointer, carrying the PEB, is above the receiving surface. */
  pointerOver: boolean;
  /** The receiving surface: the one element a pointer release transfers on. */
  dropTargetRef: RefObject<HTMLDivElement | null>;
  /** The INSPECT section that is open, or null. Shown only once a verdict exists. */
  inspect: InspectSection | null;
  copy: VerifierSurfaceCopy;
  onClose: () => void;
  onDrop: () => void;
  onRelease: () => void;
  onAnalyze: () => void;
  onInspect: (section: InspectSection | null) => void;
}) {
  const root = useRef<HTMLElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);
  const wasOpen = useRef(false);

  // Focus follows the person: into the instrument when it opens, back to the
  // control that opened it when it closes — never dropped at the top of the
  // document. The opener is whatever held focus at the moment of opening.
  useEffect(() => {
    if (open && !wasOpen.current) {
      opener.current = document.activeElement;
      body.current?.focus({ preventScroll: true });
    } else if (!open && wasOpen.current) {
      const target = opener.current;
      opener.current = null;
      if (target instanceof HTMLElement && target.isConnected) target.focus({ preventScroll: true });
    }
    wasOpen.current = open;
  }, [open]);

  const stage = handoff.stage;
  const verdict = verification.state === "VERDICT" ? verification.verdict : null;

  // THE DRUM-ROLL (§17). The verifier's result arrives whole. The surface
  // reveals the groups of completed checks in cadence, holds, then shows the
  // verdict — pacing, not drums. It only delays what is already true: the
  // verdict and every check exist in `verification` from the moment they
  // arrive, `data-verdict` on the root says so at once, and under reduced
  // motion nothing is delayed at all. `revealed` counts the steps the timers
  // have released for one result; the last step is the verdict. A result
  // with nothing to pace, or none at all, is shown whole.
  const resultKey = verdict === null ? null : `${verdict}:${handoff.transferredContentDigest ?? ""}`;
  const completedChecks = verification.completedChecks;
  const reducedMotion = useSyncExternalStore(subscribeReducedMotion, readReducedMotion, readReducedMotionOnServer);
  const plan = useMemo(() => revealPlan(completedChecks, reducedMotion), [completedChecks, reducedMotion]);
  const [revealed, setRevealed] = useState<Readonly<{ key: string | null; steps: number }>>({ key: null, steps: 0 });
  useEffect(() => {
    if (resultKey === null || plan.steps.length === 0) return;
    const timers = plan.steps.map((at, index) => window.setTimeout(() => setRevealed({ key: resultKey, steps: index + 1 }), at));
    return () => { for (const timer of timers) window.clearTimeout(timer); };
  }, [resultKey, plan]);
  const reveal = resultKey === null || plan.steps.length === 0 ? Number.POSITIVE_INFINITY : revealed.key === resultKey ? revealed.steps : 0;
  const groups = plan.groups;
  const verdictRevealed = verdict !== null && reveal >= groups.length + 1;
  const phase = verdict !== null
    ? "verdict"
    : verification.state === "ANALYZING"
      ? "analyzing"
      : stage === "HANDED_OVER" ? "received" : stage === "CARRIED" ? "carried" : "empty";
  // The receiving surface is armed by the ENGINE's carried state — a PEB in
  // hand, whether the hand is a pointer or a keyboard — and "over" only by
  // the pointer actually above it.
  const drop: "idle" | "armed" | "over" = pointerOver ? "over" : stage === "CARRIED" ? "armed" : "idle";
  const analyzeEnabled = stage === "HANDED_OVER" && verification.state === "AWAITING_HUMAN";
  const inspectOpen = verdict !== null && inspect !== null;
  // The inspection stands beneath the verdict, inside the body that scrolls;
  // opening it, or turning to another section, brings it into view — at once,
  // never as a scroll animation, so a review capture and a person see the
  // same thing. Reading only; it performs no act.
  useEffect(() => {
    if (!inspectOpen) return;
    const panel = body.current?.querySelector<HTMLElement>("#nx-vs-inspect");
    panel?.scrollIntoView({ block: "start", behavior: "auto" });
  }, [inspectOpen, inspect]);
  const line = verifierLine(handoff, verification, copy);
  const linkWord = network.linkPhase === "CONNECTED" ? copy.online : network.linkPhase === "LOST" ? copy.offline : copy.unobserved;
  const objectCount = portable.nanoReceiptCount + (portable.finalReceiptId === null ? 0 : 1);
  const inspections = verification.factInspections?.filter((inspection) => inspection.status !== "NOT_PRESENTED") ?? [];

  // Escape leaves the inspection first, then the instrument. Tab never leaves
  // the instrument while it is open: the dialog is modal, so focus cycles.
  const onKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      if (inspectOpen) onInspect(null);
      else onClose();
      return;
    }
    if (event.key !== "Tab" || root.current === null) return;
    const nodes = [...root.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((node) => node.closest("[hidden]") === null);
    if (nodes.length === 0) { event.preventDefault(); return; }
    const first = nodes[0]!;
    const last = nodes[nodes.length - 1]!;
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === body.current)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
  };

  return (
    <>
      {open && <div className="nx-vs-scrim" aria-hidden="true" onClick={onClose} />}
      {/* The modal dialog pattern handles Escape and the Tab cycle on its root
          (WAI-ARIA APG, modal dialog): every act inside is a button, and the
          root itself is never a target of the keys it observes. */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- the dialog root observes Escape and Tab for its focus trap; it is not the interactive element */}
      <section
        ref={root}
        className="nx-verifier-surface"
        role="dialog"
        aria-modal="true"
        aria-labelledby="nx-vs-title"
        aria-describedby="nx-vs-relation"
        hidden={!open}
        data-surface={open ? "open" : "closed"}
        data-phase={phase}
        data-handoff={stage}
        data-verification-state={verification.state}
        data-verdict={verdict ?? ""}
        data-drop={drop}
        data-reveal={verdict === null ? "" : verdictRevealed ? "shown" : "holding"}
        data-inspect={inspectOpen ? inspect : ""}
        data-received-offline={handoff.receivedWhileLinkLost === null ? "" : String(handoff.receivedWhileLinkLost)}
        data-verified-offline={verification.verifiedWhileLinkLost === null ? "" : String(verification.verifiedWhileLinkLost)}
        data-verdict-held={verification.heldAfterReconciliation === null ? "" : String(verification.heldAfterReconciliation)}
        onKeyDown={onKeyDown}
      >
        <header className="nx-vs-head">
          <p className="nx-vs-brand" id="nx-vs-title"><strong>FortiX</strong><i aria-hidden="true" /><span>{copy.instrument}</span></p>
          <p className="nx-vs-relation" id="nx-vs-relation">{copy.relation}</p>
          {/* The same signal glyph as the page header — four bars, drawn from
              the same observed link phase — with the word beside it. One
              network model: the chip reads `network.linkPhase` and nothing else. */}
          <p className="nx-vs-link">
            <span
              className="nx-link-chip"
              data-link={network.linkPhase}
              data-flash={network.transitionFlash ?? ""}
              data-sentinel={network.sentinelReachable ? "OK" : "ABSENT"}
              aria-label={[
                linkLine(network, copy.link),
                network.linkPhase === "LOST" ? copy.link.lostNote : null,
                network.sentinelReachable ? null : copy.link.sentinelAbsent,
              ].filter((part) => part !== null).join(" · ")}
              role="status"
            >
              <i aria-hidden="true"><b /><b /><b /><b /></i>
            </span>
            <em data-link={network.linkPhase}>{linkWord}</em>
          </p>
          <button type="button" className="nx-vs-close" aria-label={copy.close} onClick={onClose}><i aria-hidden="true" /></button>
        </header>

        <div id="nx-vs-body" ref={body} className="nx-vs-body" tabIndex={-1}>
          <p className="nx-panel-status" aria-live="polite">{line}</p>

          <div className="nx-vs-intake">
            {stage !== "HANDED_OVER" ? (
              // THE RECEIVING SURFACE. Reserved from the start, armed while the
              // PEB is in hand, and answering the pointer above it. A release
              // here and the Deposit act are the same engine DROP.
              <div ref={dropTargetRef} className="nx-vs-dropzone" data-drop={drop} data-stage={stage}>
                <i className="nx-vs-dropzone-mark" aria-hidden="true"><b /></i>
                <p className="nx-vs-dropzone-word">{stage === "NOT_READY" ? copy.notReady : drop === "over" ? copy.dropArmed : copy.dropHere}</p>
                <div className="nx-vs-dropzone-acts">
                  <button type="button" className="nx-primary nx-vs-deposit" disabled={stage !== "CARRIED"} onClick={onDrop}>{copy.deposit}</button>
                  {stage === "CARRIED" && <button type="button" className="nx-link" onClick={onRelease}>{copy.release}</button>}
                </div>
              </div>
            ) : (
              // RECEIVED: a recorded result, never an act. What was received,
              // named by the mission, counted, and identified by the digest of
              // the exact bytes — and no verdict, so no verdict tone: the
              // record wears the page's plain recorded costume.
              <div className="nx-vs-received nx-recorded">
                <span className="nx-kicker">{copy.received}</span>
                <dl>
                  <div><dt>{copy.missionId}</dt><dd><code>{missionId}</code></dd></div>
                  <div><dt>{copy.objects}</dt><dd>{objectCount}</dd></div>
                  <div><dt>{copy.bundleStatus}</dt><dd>{copy.pebState[portable.state]}</dd></div>
                  <div><dt>{copy.digest}</dt><dd><code title={handoff.transferredContentDigest ?? undefined}>{handoff.transferredContentDigest === null ? "—" : abbreviated(handoff.transferredContentDigest)}</code></dd></div>
                </dl>
                {handoff.receivedWhileLinkLost === true && <b>{copy.receivedOffline}</b>}
              </div>
            )}

            {/* ANALYZE. Visible from the start so the person sees it coming;
                enabled only once the verifier holds the PEB; replaced by the
                record once a verdict exists. Nothing else calls it. */}
            {verification.state !== "VERDICT" && (
              <div className="nx-vs-analyze">
                {/* THE SIGNATURE ACT (§23–§26): the accent fills a surface here and
                    at INSPECT only — the act that turns evidence into a verdict. */}
                <button type="button" className="nx-primary nx-signature nx-vs-analyze-act" disabled={!analyzeEnabled} aria-busy={verification.state === "ANALYZING" || undefined} onClick={onAnalyze}>{copy.analyze}</button>
                {verification.state === "ANALYZING" && <p className="nx-panel-note" data-analyzing="true">{copy.analyzing}</p>}
              </div>
            )}

            {verdict !== null && groups.length > 0 && (
              // THE SEQUENCE: the checks the verifier completed, by category,
              // revealed in cadence once the result is in — under the record
              // of what was received, where the analysis was asked for, so
              // the intake column reads received → checked and the verdict
              // stands alone on the right. Nothing here can appear that the
              // verifier did not perform.
              <ol className="nx-vs-sequence" aria-label={copy.checks} data-reveal={verdictRevealed ? "shown" : "holding"}>
                {groups.map((group, index) => (
                  <li key={group.category} data-category={group.category} data-revealed={index < reveal ? "true" : "false"}>
                    <i aria-hidden="true" />
                    <span>{copy.inspect.categories[group.category]}</span>
                    <b>{group.checks.length}</b>
                  </li>
                ))}
              </ol>
            )}
          </div>

          <div className="nx-vs-reading">
            {/* THE LEDGER: three facts, each keyed on the engine's own state.
                Before any transfer it reads not received · no analysis · no
                verdict, and no line can turn on without its act. */}
            <ol className="nx-vs-ledger" aria-label={copy.question}>
              <li data-station="peb" data-status={stage === "HANDED_OVER" ? "done" : stage === "CARRIED" ? "carried" : "none"}>
                <i aria-hidden="true" />
                <span>{stage === "HANDED_OVER" ? copy.received : stage === "CARRIED" ? copy.carried : copy.notReceived}</span>
              </li>
              <li data-station="analysis" data-status={verification.state === "VERDICT" ? "done" : verification.state === "ANALYZING" ? "active" : "none"}>
                <i aria-hidden="true" />
                <span>{verification.state === "VERDICT" ? `${copy.checks} · ${verification.completedChecks.length}` : verification.state === "ANALYZING" ? copy.analyzing : copy.noAnalysis}</span>
              </li>
              {/* The ledger's verdict line keeps the hold too: the word is in
                  the document from the moment it exists and is painted with
                  the record, not before it — the same rule as the verdict. */}
              <li data-station="verdict" data-status={verdict === null ? "none" : "done"} data-revealed={verdict === null ? "" : verdictRevealed ? "true" : "false"}>
                <i aria-hidden="true" />
                <span>{verdict === null ? copy.noVerdict : <>{copy.verdict} · <code>{verification.verdict}</code></>}</span>
              </li>
            </ol>

            {verdict !== null && (
              // THE VERDICT. The canonical word as the verifier gave it, its
              // headline and reading from the dictionary, what it establishes,
              // the facts of where it was produced, and its limits. Present in
              // the document from the moment it exists; painted after the hold.
              <section className="nx-vs-verdict" data-verdict={verdict} data-revealed={verdictRevealed ? "true" : "false"} aria-label={copy.result}>
                <span className="nx-kicker">{copy.result}</span>
                <p className="nx-vs-verdict-word"><code>{verification.verdict}</code></p>
                <h3>{copy.verdicts[verdict].headline}</h3>
                <p className="nx-vs-verdict-reading">{copy.verdicts[verdict].reading}</p>
                {(verification.verifiedWhileLinkLost === true || verification.heldAfterReconciliation === true) && (
                  <p className="nx-vs-verdict-facts">
                    {verification.verifiedWhileLinkLost === true && <b>{copy.verdictOffline}</b>}
                    {verification.heldAfterReconciliation === true && <b>{copy.verdictHeld}</b>}
                  </p>
                )}
                {/* INSPECT stands with the verdict, before the explanation: a
                    person reaches it without scrolling past thirty lines of
                    what was established. It opens the supporting material
                    beneath and never changes the verdict. */}
                <button type="button" className="nx-act nx-signature nx-vs-inspect-act" aria-expanded={inspectOpen} aria-controls="nx-vs-inspect" onClick={() => onInspect(inspectOpen ? null : "path")}>
                  {copy.inspectVerdict}
                </button>
                {verification.establishes !== null && (
                  <ul className="nx-established" aria-label={copy.established}>
                    {ESTABLISHES_ORDER.map((key) => (
                      <li key={key} data-established={verification.establishes![key] ? "true" : "false"}>
                        <i aria-hidden="true" />
                        <span>{copy.establishes[key]}</span>
                        <b>{verification.establishes![key] ? copy.established : copy.notEstablished}</b>
                      </li>
                    ))}
                  </ul>
                )}
                {inspections.length > 0 && (
                  <ul className="nx-inspections" aria-label={copy.facts}>
                    {inspections.map((inspection) => (
                      <li key={inspection.factId} data-fact-id={inspection.factId} data-inspection-status={inspection.status}>
                        <span>{copy.statements[inspection.factId] ?? inspection.factId}</span>
                        <b>{copy.inspectionStatus[inspection.status]}</b>
                      </li>
                    ))}
                  </ul>
                )}
                <ul className="nx-limits">
                  {verification.reasonCodes.some((code) => code.includes("PRODUCTION_TRUST_TIME")) && <li>{copy.productionTrustMissing}</li>}
                  {verification.reasonCodes.some((code) => code.includes("SETTLEMENT")) && <li>{copy.settlementNotShown}</li>}
                </ul>
              </section>
            )}
          </div>

          {inspectOpen && (
            <InspectPanel
              section={inspect}
              verification={verification}
              transferredContentDigest={handoff.transferredContentDigest}
              copy={copy.inspect}
              onSection={onInspect}
            />
          )}
        </div>
      </section>
    </>
  );
}

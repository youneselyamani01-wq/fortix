"use client";

import { useEffect, useRef } from "react";

import { formatExperienceTime } from "../../storyTimeline.ts";
import type {
  ActionFamily,
  EvidenceEpisode,
  ProvenanceLane,
  PublicEvidence,
  PublicFinalReceipt,
  PublicHandoff,
  PublicPortableEvidence,
} from "../adapter/publicExperienceAdapter.ts";
import { PebGlyph } from "./PebGlyph.tsx";
import { EvidenceObject } from "../../../../../site/src/components/evidence-artifact/EvidenceObject";
import { useI18n } from "../../I18nProvider";
import { dossierLine } from "./workspaceLines.ts";

/**
 * NX1 R3/B — EVIDENCE DOSSIER, the right panel.
 *
 * Answers one question: what evidence was constituted, and what does it
 * contain? Not the verification conclusion — that is the verifier's.
 *
 * States: COMPACT (a count line) → OPEN (the hierarchy) → DEEP (one focus).
 *
 *   Mission
 *     Significant episodes
 *       Provenance branches
 *         Nano-Receipts
 *           Final Receipt
 *             PEB
 *
 * B — the PEB is a portable object: once the engine has assembled it, the
 * bundle sits in the dossier's head as a thing the person can take with the
 * pointer and carry to the verifier, or hand over with the button — both the
 * same engine operation. Handing it over does not remove the dossier; the
 * PEB's state says it was handed off.
 */

export type DossierFocus =
  | Readonly<{ kind: "episode"; episode: EvidenceEpisode }>
  | Readonly<{ kind: "branch"; branch: ProvenanceLane }>
  | Readonly<{ kind: "receipt"; evidenceId: string }>
  | Readonly<{ kind: "final" }>
  | Readonly<{ kind: "peb" }>;

export type DossierState = Readonly<{ open: boolean; focus: DossierFocus | null }>;

export type DossierCopy = Readonly<{
  title: string;
  aria: string;
  question: string;
  empty: string;
  nrOne: string;
  nrMany: string;
  finalReceipt: string;
  finalPending: string;
  peb: string;
  pebLong: string;
  pebPending: string;
  mission: string;
  episodes: string;
  branches: string;
  nanoReceipts: string;
  compiledInto: string;
  carriedIn: string;
  allBranches: string;
  episodeCountOne: string;
  episodeCountMany: string;
  inputs: string;
  issuedAt: string;
  settlement: string;
  notDemonstrated: string;
  members: string;
  supporting: string;
  runtime: string;
  bytes: string;
  pebState: Readonly<Record<PublicPortableEvidence["state"], string>>;
  take: string;
  dragHint: string;
  held: string;
  /** The accessible PICK: the same engine act as taking the chip with the pointer. */
  pick: string;
  sealedCount: string;
  afterSealCount: string;
  inspect: string;
  close: string;
  back: string;
  branchLabels: Readonly<Record<ProvenanceLane, string>>;
  episodeLabels: Readonly<Record<EvidenceEpisode, string>>;
  familyLabels: Readonly<Record<ActionFamily, string>>;
  actorLabels: Readonly<Record<string, string>>;
  detail: Readonly<{
    title: string;
    id: string;
    event: string;
    type: string;
    family: string;
    ordinal: string;
    time: string;
    provenance: string;
    trustDomain: string;
    source: string;
    parents: string;
    observed: string;
    digest: string;
    assurance: string;
    retained: string;
    notRetained: string;
    journal: string;
    context: string;
    closure: string;
    run: string;
    mission: string;
    none: string;
    sources: Readonly<Record<PublicEvidence["source"], string>>;
  }>;
}>;

export function EvidenceDossier({ state, items, sealedCount, journalCount, episodes, branches, finalReceipt, portable, handoff, carried, context, copy, nameOf, onToggle, onFocus, onHandover }: {
  state: DossierState;
  items: readonly PublicEvidence[];
  sealedCount: number;
  journalCount: number;
  episodes: readonly Readonly<{ episode: EvidenceEpisode; items: readonly PublicEvidence[] }>[];
  branches: readonly ProvenanceLane[];
  finalReceipt: PublicFinalReceipt | null;
  portable: PublicPortableEvidence;
  handoff: PublicHandoff;
  /** True after the explicit PICK and until DROP or release. */
  carried: boolean;
  context: Readonly<{ missionId: string; runId: string; closureDigest: string | null }>;
  copy: DossierCopy;
  nameOf: (entry: PublicEvidence) => string;
  onToggle: () => void;
  onFocus: (focus: DossierFocus | null) => void;
  onHandover: () => void;
}) {
  const { locale } = useI18n();
  const body = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  const focus = state.focus;
  // Focus follows the person: into the panel when it opens, back to the control
  // that opened it when it closes — never dropped at the top of the document.
  useEffect(() => {
    if (state.open) body.current?.focus({ preventScroll: true });
    else if (wasOpen.current) toggle.current?.focus({ preventScroll: true });
    wasOpen.current = state.open;
  }, [state.open, focus]);
  // Escape goes up one level: a receipt back to its group, a group back to
  // the hierarchy, the hierarchy closed.
  useEffect(() => {
    const node = body.current;
    if (node === null || !state.open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      if (focus === null) onToggle();
      else if (focus.kind === "receipt") {
        const entry = items.find((candidate) => candidate.evidenceId === focus.evidenceId);
        onFocus(entry === undefined ? null : { kind: "episode", episode: entry.episode });
      } else onFocus(null);
    };
    node.addEventListener("keydown", onKey);
    return () => node.removeEventListener("keydown", onKey);
  }, [focus, items, onFocus, onToggle, state.open]);

  const byId = new Map(items.map((entry) => [entry.evidenceId, entry] as const));
  const count = items.length;
  const line = dossierLine(count, finalReceipt, portable, copy);
  const view = focus === null ? "overview" : focus.kind;
  const selected = focus?.kind === "receipt" ? byId.get(focus.evidenceId) ?? null : null;
  const group = focus?.kind === "episode"
    ? episodes.find((candidate) => candidate.episode === focus.episode)?.items ?? []
    : focus?.kind === "branch"
      ? items.filter((entry) => entry.branch === focus.branch)
      : [];
  const groupTitle = focus?.kind === "episode" ? copy.episodeLabels[focus.episode] : focus?.kind === "branch" ? copy.branchLabels[focus.branch] : "";
  const countLine = (size: number) => size === 1 ? copy.episodeCountOne : copy.episodeCountMany.replace("{count}", String(size));
  const pebTakeable = handoff.stage === "READY";
  const standingOf = (entry: PublicEvidence) => entry.standing === "JOURNAL"
    ? copy.detail.journal
    : entry.assurance === "QUARANTINED" ? copy.detail.notRetained : copy.detail.retained;

  return (
    <section
      className="nx-panel nx-dossier"
      aria-label={copy.aria}
      data-state={state.open ? (focus === null ? "open" : "deep") : "compact"}
      data-view={state.open ? view : "closed"}
      data-focus={focus === null ? "" : focus.kind === "receipt" ? focus.evidenceId : focus.kind === "episode" ? focus.episode : focus.kind === "branch" ? focus.branch : focus.kind}
      data-nano-receipt-count={count}
      data-sealed-count={sealedCount}
      data-journal-count={journalCount}
      data-final-receipt={finalReceipt === null ? "none" : "issued"}
      data-peb={portable.bundleId === null ? "none" : portable.state}
    >
      <header className="nx-panel-head nx-dossier-head">
        {/* The affordance is a shape, and the word is the button's own name (C-F01). */}
        <button ref={toggle} type="button" className="nx-panel-toggle" aria-expanded={state.open} aria-controls="nx-dossier-body" aria-label={`${state.open ? copy.close : copy.inspect}: ${copy.title}`} onClick={onToggle}>
          <span className="nx-kicker">{copy.title}</span>
          <strong className="nx-panel-line">{line}</strong>
          <i className="nx-panel-chevron" aria-hidden="true" />
        </button>
        {portable.bundleId !== null && (
          <button
            type="button"
            className={`nx-peb-chip${pebTakeable ? " is-takeable" : ""}${carried ? " is-carried" : ""}${portable.state === "RECEIVED" ? " is-handed-off" : ""}`}
            data-bundle-id={portable.bundleId}
            data-peb-state={portable.state}
            aria-label={`${copy.pebLong} · ${carried ? copy.held : copy.pebState[portable.state]} · ${pebTakeable ? copy.pick : copy.inspect}`}
            aria-describedby={pebTakeable ? "nx-peb-hint" : undefined}
            title={pebTakeable ? copy.dragHint : copy.pebLong}
            onClick={() => pebTakeable ? onHandover() : onFocus({ kind: "peb" })}
          >
            <PebGlyph />
            {!carried && <span>{copy.peb}</span>}
            <b>{carried ? copy.held : copy.pebState[portable.state]}</b>
          </button>
        )}
        {pebTakeable && <span id="nx-peb-hint" className="nx-panel-status">{copy.dragHint}</span>}
      </header>
      <div id="nx-dossier-body" ref={body} className="nx-panel-body" hidden={!state.open} tabIndex={-1}>
        {focus !== null && (
          <button type="button" className="nx-link nx-dossier-back" onClick={() => onFocus(focus.kind === "receipt" && selected !== null ? { kind: "episode", episode: selected.episode } : null)}>
            ← {copy.back}
          </button>
        )}

        {focus === null && (
          <>
            <p className="nx-panel-question">{copy.question}</p>
            <ol className="nx-hierarchy">
              <li className="nx-tier" data-tier="mission">
                <span className="nx-kicker">{copy.mission}</span>
                <code>{context.missionId}</code>
              </li>
              <li className="nx-tier" data-tier="episodes">
                <span className="nx-kicker">{copy.episodes}</span>
                <ul className="nx-groups">
                  {episodes.map((entry) => (
                    <li key={entry.episode}>
                      <button type="button" className="nx-group" data-episode={entry.episode} onClick={() => onFocus({ kind: "episode", episode: entry.episode })}>
                        <span>{copy.episodeLabels[entry.episode]}</span>
                        <b>{entry.items.length}</b>
                      </button>
                    </li>
                  ))}
                </ul>
              </li>
              <li className="nx-tier" data-tier="branches">
                <span className="nx-kicker">{copy.branches}</span>
                <ul className="nx-groups">
                  {branches.map((branch) => (
                    <li key={branch}>
                      <button type="button" className="nx-group" data-branch={branch} onClick={() => onFocus({ kind: "branch", branch })}>
                        <span>{copy.branchLabels[branch]}</span>
                        <b>{items.filter((entry) => entry.branch === branch).length}</b>
                      </button>
                    </li>
                  ))}
                </ul>
              </li>
              <li className="nx-tier" data-tier="nano-receipts">
                <span className="nx-kicker">{copy.nanoReceipts}</span>
                <strong>{count === 1 ? copy.nrOne : copy.nrMany.replace("{count}", String(count))}</strong>
                {finalReceipt !== null && (
                  <small>
                    {copy.sealedCount.replace("{count}", String(sealedCount))}
                    {journalCount > 0 ? ` · ${copy.afterSealCount.replace("{count}", String(journalCount))}` : ""}
                    {` · ${copy.compiledInto}`}
                  </small>
                )}
              </li>
              <li className="nx-tier" data-tier="final-receipt">
                <span className="nx-kicker">{copy.finalReceipt}</span>
                {finalReceipt === null ? (
                  <small>{copy.finalPending}</small>
                ) : (
                  <button type="button" className="nx-object nx-object-final" data-receipt-id={finalReceipt.receiptId} onClick={() => onFocus({ kind: "final" })}>
                    <i aria-hidden="true" />
                    <span>{copy.finalReceipt}</span>
                    <code>{finalReceipt.digest.slice(0, 12)}</code>
                  </button>
                )}
                {portable.bundleId !== null && <small>{copy.carriedIn}</small>}
              </li>
              <li className="nx-tier" data-tier="peb">
                <span className="nx-kicker">{copy.peb}</span>
                {portable.bundleId === null ? (
                  <small>{copy.pebPending}</small>
                ) : (
                  <span className="nx-object-row">
                    <button type="button" className="nx-object nx-object-peb" data-bundle-id={portable.bundleId} data-peb-state={portable.state} onClick={() => onFocus({ kind: "peb" })}>
                      <PebGlyph />
                      <span>{copy.pebLong}</span>
                      <b>{carried ? copy.held : copy.pebState[portable.state]}</b>
                    </button>
                    {pebTakeable && (
                      // PICK, for the keyboard: the same engine act as taking
                      // the chip with the pointer, and the same opening. It
                      // transfers nothing — the DROP is the verifier's act.
                      <button type="button" className="nx-act nx-act-inline" onClick={onHandover}>{copy.pick}</button>
                    )}
                  </span>
                )}
              </li>
            </ol>
          </>
        )}

        {(focus?.kind === "episode" || focus?.kind === "branch") && (
          <section className="nx-episode" data-episode={focus.kind === "episode" ? focus.episode : ""} data-branch={focus.kind === "branch" ? focus.branch : ""}>
            <h3>{groupTitle}</h3>
            {focus.kind === "branch" && (
              <p className="nx-dossier-filter"><button type="button" className="nx-link" onClick={() => onFocus(null)}>{copy.allBranches}</button></p>
            )}
            <ol>
              {group.map((entry) => (
                <li key={entry.evidenceId}>
                  <button type="button" className={`nx-episode-item action-${entry.actionFamily}${entry.standing === "JOURNAL" ? " is-journal" : ""}`} data-evidence-id={entry.evidenceId} data-family={entry.actionFamily} data-ordinal={entry.ordinal.label} data-standing={entry.standing} onClick={() => onFocus({ kind: "receipt", evidenceId: entry.evidenceId })}>
                    <i aria-hidden="true" />
                    <span>{nameOf(entry)}</span>
                    <small><b className="nx-ordinal">{entry.ordinal.label}</b> · {copy.actorLabels[entry.domain] ?? copy.branchLabels[entry.branch]} · {copy.familyLabels[entry.actionFamily]}</small>
                  </button>
                </li>
              ))}
            </ol>
            <p className="nx-episode-count">{countLine(group.length)}</p>
          </section>
        )}

        {selected !== null && (
          <div className="nx-receipt" data-evidence-id={selected.evidenceId} data-ordinal={selected.ordinal.label} data-standing={selected.standing}>
            <span className="nx-kicker">{copy.detail.title}</span>
            <h3><b className="nx-ordinal">{selected.ordinal.label}</b> {nameOf(selected)}</h3>
            <dl>
              {/* G1 — TWO ROWS, NO GLOSS. The reading number and the canonical
                  identifier sit next to each other and the hierarchy says what
                  each one is; nothing is appended to explain it away.
                  The note that used to follow the number — "reading order only;
                  not part of the evidence" — was struck at G1 because it read
                  as though the RECEIPT were outside the evidence. It is not:
                  the receipt is canonical. Only the number is a reading aid. */}
              <div><dt>{copy.detail.ordinal}</dt><dd>{selected.ordinal.label}</dd></div>
              <div><dt>{copy.detail.id}</dt><dd><code>{selected.evidenceId}</code></dd></div>
              <div><dt>{copy.detail.event}</dt><dd><code>{selected.eventId}</code></dd></div>
              <div><dt>{copy.detail.type}</dt><dd><code>{selected.eventType}</code></dd></div>
              <div className={`nx-family-line action-${selected.actionFamily}`} data-family={selected.actionFamily}><dt>{copy.detail.family}</dt><dd><i aria-hidden="true" />{copy.familyLabels[selected.actionFamily]} · <code>{selected.actionFamily}</code></dd></div>
              <div><dt>{copy.detail.time}</dt><dd>{formatExperienceTime(selected.timeMs)}</dd></div>
              <div><dt>{copy.detail.provenance}</dt><dd>{copy.branchLabels[selected.branch]} · {copy.actorLabels[selected.domain] ?? selected.domain}</dd></div>
              <div><dt>{copy.detail.trustDomain}</dt><dd><code>{selected.domain}</code></dd></div>
              <div><dt>{copy.detail.source}</dt><dd>{copy.detail.sources[selected.source]}</dd></div>
              <div><dt>{copy.detail.assurance}</dt><dd>{standingOf(selected)} · <code>{selected.evidenceLocality}</code></dd></div>
              <div>
                <dt>{copy.detail.parents}</dt>
                <dd>{selected.causalParents.length === 0 ? copy.detail.none : (
                  <ul>{selected.causalParents.map((id) => (
                    <li key={id}>{byId.has(id) ? <button type="button" className="nx-link" onClick={() => onFocus({ kind: "receipt", evidenceId: id })}>{nameOf(byId.get(id)!)}</button> : <code>{id}</code>}</li>
                  ))}</ul>
                )}</dd>
              </div>
              <div>
                <dt>{copy.detail.observed}</dt>
                <dd>{selected.observedInputs.length === 0 ? copy.detail.none : (
                  <ul>{selected.observedInputs.map((id) => (
                    <li key={id}>{byId.has(id) ? <button type="button" className="nx-link" onClick={() => onFocus({ kind: "receipt", evidenceId: id })}>{nameOf(byId.get(id)!)}</button> : <code>{id}</code>}</li>
                  ))}</ul>
                )}</dd>
              </div>
              <div><dt>{copy.detail.digest}</dt><dd><code>{selected.digest}</code></dd></div>
            </dl>
            <h4>{copy.detail.context}</h4>
            <dl>
              <div><dt>{copy.detail.mission}</dt><dd><code>{context.missionId}</code></dd></div>
              <div><dt>{copy.detail.run}</dt><dd><code>{context.runId}</code></dd></div>
              <div><dt>{copy.detail.closure}</dt><dd><code>{context.closureDigest ?? "—"}</code></dd></div>
            </dl>
          </div>
        )}

        {focus?.kind === "final" && finalReceipt !== null && (
          <div className="nx-receipt nx-final-record" data-receipt-id={finalReceipt.receiptId}>
            <span className="nx-kicker">{copy.finalReceipt}</span>
            <h3>{copy.finalReceipt}</h3>
            <dl>
              <div><dt>{copy.detail.id}</dt><dd><code>{finalReceipt.receiptId}</code></dd></div>
              <div><dt>{copy.detail.event}</dt><dd><code>{finalReceipt.eventId}</code></dd></div>
              <div><dt>{copy.issuedAt}</dt><dd>{formatExperienceTime(finalReceipt.timeMs)}</dd></div>
              <div><dt>{copy.inputs}</dt><dd>{finalReceipt.causalInputEvidenceIds.length} · {copy.nanoReceipts}</dd></div>
              <div><dt>{copy.detail.closure}</dt><dd><code>{finalReceipt.evidenceSetDigest}</code></dd></div>
              <div><dt>{copy.settlement}</dt><dd>{finalReceipt.settlementStatus === "NOT_DEMONSTRATED" ? copy.notDemonstrated : <code>{finalReceipt.settlementStatus}</code>}</dd></div>
              <div><dt>{copy.detail.mission}</dt><dd><code>{finalReceipt.missionId}</code></dd></div>
              <div><dt>{copy.detail.run}</dt><dd><code>{finalReceipt.runId}</code></dd></div>
            </dl>
          </div>
        )}

        {focus?.kind === "peb" && portable.bundleId !== null && (
          <div className="nx-receipt nx-peb-record" data-bundle-id={portable.bundleId} data-peb-state={portable.state}>
            <span className="nx-kicker">{copy.peb}</span>
            <div className="nx-peb-artifact">
              <EvidenceObject locale={locale} data={{ bundleId: portable.bundleId, digest: portable.bundleDigest, finalReceiptId: portable.finalReceiptId, memberCount: portable.memberCount, nanoReceiptCount: portable.nanoReceiptCount, byteLength: portable.canonicalByteLength }} />
              <div className="nx-peb-artifact__cover">
                <span className="nx-kicker">FortiX · PEB</span>
                <h3>{copy.pebLong}</h3>
                <code>{portable.bundleId}</code>
                <div className="nx-peb-artifact__contents">
                  <span><b>{portable.nanoReceiptCount}</b>{copy.nanoReceipts}</span>
                  <span><b>{portable.memberCount}</b>{copy.members}</span>
                  {portable.canonicalByteLength !== null && <span><b>{portable.canonicalByteLength}</b>{copy.bytes}</span>}
                </div>
              </div>
            </div>
            <p className="nx-peb-state">
              <b>{carried ? copy.held : copy.pebState[portable.state]}</b>
              {/* PICK takes the PEB in hand. OPEN and DROP remain distinct acts. */}
              {pebTakeable && <button type="button" className="nx-act nx-act-inline" onClick={onHandover}>{copy.pick}</button>}
              {pebTakeable && <small>{copy.dragHint}</small>}
            </p>
            <dl>
              <div><dt>{copy.detail.id}</dt><dd><code>{portable.bundleId}</code></dd></div>
              <div><dt>{copy.detail.digest}</dt><dd><code>{portable.bundleDigest ?? "—"}</code></dd></div>
              <div><dt>{copy.nanoReceipts}</dt><dd>{portable.nanoReceiptCount}</dd></div>
              <div><dt>{copy.finalReceipt}</dt><dd><code>{portable.finalReceiptId ?? "—"}</code></dd></div>
              <div><dt>{copy.members}</dt><dd>{portable.memberCount}</dd></div>
              <div><dt>{copy.supporting}</dt><dd>{portable.assuranceSupportCount}</dd></div>
              <div><dt>{copy.runtime}</dt><dd>{portable.runtimeRecordCount}</dd></div>
              {portable.canonicalByteLength !== null && <div><dt>{copy.bytes}</dt><dd>{portable.canonicalByteLength}</dd></div>}
              {handoff.transferredContentDigest !== null && <div><dt>{copy.detail.digest} · {copy.pebState[portable.state]}</dt><dd><code>{handoff.transferredContentDigest}</code></dd></div>}
            </dl>
          </div>
        )}
      </div>
    </section>
  );
}

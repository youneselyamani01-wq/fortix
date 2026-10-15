"use client";

import { useCallback, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import type { ActionFamily, EvidenceEpisode, ProvenanceLane, PublicEvidence, PublicFinalReceipt } from "../adapter/publicExperienceAdapter.ts";
import { familiesPresent } from "../adapter/actionFamily.ts";
import { HIT_AREA_PX, LABEL_PX, LEGEND_PX, focusSets } from "./proofGeometry.ts";
import { CHAPTER_ROW_PX, CHAPTER_STRIP_PAD_PX, ORDINAL_BESIDE_MIN_PITCH_PX, bandsOf, chapterRows, fieldTallOf, lanesOf, layoutProofB2 } from "./proofGeometryB2.ts";
import "./proof-b2.css";

/**
 * NX1 R2 … B R2, NX3 — LEVEL 1: the visible history of one mission, as one picture.
 *
 *   HORIZONTAL = CAUSAL DEPTH  one column per depth — the length of the
 *                              longest declared parent chain. Receipts that
 *                              share a column share a causal position: the
 *                              picture of parallelism, not an explanation of
 *                              it (Gate 2, B2). The reading number is printed
 *                              beside every bead as a handle; nothing is
 *                              placed by it.
 *   VERTICAL   = PROVENANCE    one horizontal band per lane the evidence
 *                              itself names; the lane names stand at the
 *                              left and stay while the field scrolls.
 *   THREAD     = CAUSALITY     one filament per declared parent relation
 *                              present in the proof; order alone draws none.
 *   COLOUR     = FAMILY        the kind of thing each receipt attests, on the
 *                              bubble's rim; a compact legend names the
 *                              families this run actually contains, and the
 *                              three kinds of line on the picture.
 *
 * Every admitted nano-receipt is a bead, always. The geometry follows the
 * dataset and the measured band (`proofGeometryB2.ts`) above readability
 * floors; when the whole story does not fit at those floors, the field scrolls
 * inside itself — HORIZONTALLY, lane names and every receipt kept — follows
 * the story's "now" (the selected receipt, a post-seal record, the Final
 * Receipt, the newest receipt), and shows a small cue toward the start or the
 * end that lies out of view. Threads have three states: historical (fine,
 * low contrast), newly attached (ink, briefly), and the selected causal chain
 * (ancestry and consequences in ink with a light direction mark, everything
 * else stepping back).
 *
 * The FINAL RECEIPT is not a bead: one capsule to the RIGHT of the sealed
 * field, gathered by a compilation rail from the deepest sealed receipt of
 * each lane — each of them an actual causal input of the receipt. Records the
 * engine appended after the seal sit in their own zone further right, never
 * inside.
 *
 * Gate 1's geometry (`proofGeometry.ts`, X = lane, Y = reading order) is kept
 * untouched as the provenance view and as the Gate 2 control; this component
 * draws the production geometry.
 */

export type ProofCopy = Readonly<{
  branchLabels: Readonly<Record<ProvenanceLane, string>>;
  actorLabels: Readonly<Record<string, string>>;
  episodeLabels: Readonly<Record<EvidenceEpisode, string>>;
  familyLabels: Readonly<Record<ActionFamily, string>>;
  readingOrder: string;
  /** The horizontal axis, named: causal depth, never the reading number. */
  causalDepth: string;
  families: string;
  legendAria: string;
  chain: string;
  threads: string;
  threadCause: string;
  threadObserved: string;
  threadCompiled: string;
  toStart: string;
  toEnd: string;
  newEvidence: string;
  openBranch: string;
  openReceipt: string;
  finalReceipt: string;
  openFinal: string;
  postSeal: string;
}>;

/** The band's nominal size before the client has measured it (SSR parity). */
export const NOMINAL_WIDTH_PX = 1200;
export const NOMINAL_HEIGHT_PX = 520;

type ScrollPlace = "start" | "middle" | "end";

/** Depth-axis ticks: every fifth column, and the last. */
const AXIS_TICK_EVERY = 5;

export function ProvenanceProof({ items, latest, branches, finalReceipt, selected, copy, onBead, onBranch, onFinal, nameOf }: {
  items: readonly PublicEvidence[];
  latest: PublicEvidence | null;
  branches: readonly ProvenanceLane[];
  finalReceipt: PublicFinalReceipt | null;
  selected: string | null;
  copy: ProofCopy;
  onBead: (evidenceId: string) => void;
  onBranch: (branch: ProvenanceLane) => void;
  onFinal: () => void;
  nameOf: (entry: PublicEvidence) => string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: NOMINAL_WIDTH_PX, height: NOMINAL_HEIGHT_PX });
  const [scrollPlace, setScrollPlace] = useState<ScrollPlace>("start");
  // The band is measured, never assumed: the geometry follows the space the
  // page actually gives it, at any viewport. Height from the band, width
  // from inside the field (so a fallback scrollbar takes no band's room).
  useLayoutEffect(() => {
    const node = container.current;
    const inner = field.current;
    if (node === null || inner === null || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const width = inner.clientWidth;
      const height = node.clientHeight;
      if (width < 1 || height < 1) return;
      setSize((current) => (Math.abs(current.width - width) < 1 && Math.abs(current.height - height) < 1)
        ? current
        : { width, height });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    observer.observe(inner);
    measure();
    return () => observer.disconnect();
  }, []);

  const layout = useMemo(
    () => layoutProofB2({ items, branches, finalReceipt: finalReceipt !== null, widthPx: size.width, heightPx: size.height }),
    [items, branches, finalReceipt, size.width, size.height],
  );
  const lanes = useMemo(() => lanesOf(items, branches), [items, branches]);
  const bands = useMemo(() => bandsOf(layout, lanes), [layout, lanes]);
  const strip = useMemo(() => chapterRows(layout.chapters), [layout.chapters]);
  const byId = useMemo(() => new Map(items.map((entry) => [entry.evidenceId, entry] as const)), [items]);
  const focus = useMemo(() => focusSets(items, selected), [items, selected]);
  const families = useMemo(() => familiesPresent(items), [items]);
  const inFocus = (id: string) => id === selected || focus.ancestors.has(id) || focus.descendants.has(id);
  const focusing = selected !== null && byId.has(selected);
  const selectedEntry = selected === null ? null : byId.get(selected) ?? null;
  const lanesInFocus = new Set<ProvenanceLane>();
  if (focusing) for (const entry of items) if (inFocus(entry.evidenceId)) lanesInFocus.add(entry.branch);

  // The scroll axis is horizontal: `contentHeight` is the content's WIDTH and
  // `fieldHeight` the field's, by the transposed contract.
  const contentWidth = layout.contentHeight;
  const fieldTall = fieldTallOf(size.height);

  // Where the field stands in the story, for the start / end cues.
  const placeScroll = useCallback(() => {
    const node = field.current;
    if (node === null) return;
    const place: ScrollPlace = node.scrollLeft <= 2
      ? "start"
      : node.scrollLeft + node.clientWidth >= node.scrollWidth - 2 ? "end" : "middle";
    setScrollPlace((current) => (current === place ? current : place));
  }, []);

  // Under the scroll fallback the field follows the story's "now": the
  // selected receipt, else a record appended after the seal, else the Final
  // Receipt, else the newest landed receipt. A scroll position, never state —
  // and only when one of those changes, so a person's own scrolling is
  // respected between two sentinel polls.
  const layoutRef = useRef(layout);
  useLayoutEffect(() => { layoutRef.current = layout; }, [layout]);
  const newest = latest !== null && byId.has(latest.evidenceId) ? latest : items.at(-1) ?? null;
  // THE ARRIVAL (C-F05, revised at C-R1): the receipt that OWNS the viewer's
  // attention — the one that has landed and whose reading hold is not over.
  // The presentation queue guarantees there is at most one, so the caption can
  // never be a claim about which of several simultaneous arrivals matters.
  const arrival = useMemo(() => items.filter((entry) => entry.owning).at(-1) ?? null, [items]);
  const newestId = newest?.evidenceId ?? null;
  const newestStanding = newest?.standing ?? null;
  const finalId = finalReceipt?.receiptId ?? null;
  useLayoutEffect(() => {
    const node = field.current;
    const current = layoutRef.current;
    if (node === null) return;
    if (current.fit !== "scroll") { node.scrollLeft = 0; placeScroll(); return; }
    const at = new Map(current.beads.map((placement) => [placement.evidenceId, placement.x] as const));
    const targetX = selected !== null && at.has(selected)
      ? at.get(selected)!
      : newestId !== null && newestStanding === "JOURNAL" && at.has(newestId)
        ? at.get(newestId)!
        : finalId !== null && current.finalY !== null
          ? current.finalY
          : newestId !== null && at.has(newestId) ? at.get(newestId)! : null;
    if (targetX === null) { placeScroll(); return; }
    const margin = current.pitch * 2.5;
    const view = node.clientWidth;
    if (targetX - margin < node.scrollLeft) node.scrollLeft = Math.max(0, targetX - margin);
    else if (targetX + margin > node.scrollLeft + view) node.scrollLeft = Math.max(0, targetX + margin - view);
    placeScroll();
  }, [layout.fit, layout.contentHeight, selected, newestId, newestStanding, finalId, placeScroll]);

  const scrollTo = (place: "start" | "end") => {
    const node = field.current;
    if (node === null) return;
    node.scrollLeft = place === "start" ? 0 : node.scrollWidth;
    placeScroll();
  };

  const inputs = useMemo(() => new Set(finalReceipt?.causalInputEvidenceIds ?? []), [finalReceipt]);
  // The compilation gathers only actual causal inputs of the Final Receipt.
  const gathered = finalReceipt === null ? [] : layout.anchors.filter((anchor) => inputs.has(anchor.evidenceId));
  const hasCause = layout.threads.some((thread) => thread.kind === "cause");
  const hasObserved = layout.threads.some((thread) => thread.kind === "observed");
  const firstChapter = layout.chapters[0] ?? null;
  const ordinalPlace = layout.pitch >= ORDINAL_BESIDE_MIN_PITCH_PX ? "beside" : "below";
  const axisTicks = layout.rows === 0 ? [] : Array.from({ length: layout.rows }, (_, column) => column)
    .filter((column) => column % AXIS_TICK_EVERY === 0 || column === layout.rows - 1);
  const xOfColumn = (column: number) => layout.rail === null || layout.rows < 2
    ? (layout.rail?.top ?? 0)
    : layout.rail.top + (layout.rail.bottom - layout.rail.top) * (column / (layout.rows - 1));
  const geometry = {
    axis: "depth",
    beads: layout.beads.length,
    threads: layout.threads.length,
    crossLane: layout.crossLaneThreads,
    sameLane: layout.sameLaneThreads,
    bands: layout.columns,
    gutter: layout.gutter,
    bandPx: Math.round(layout.laneWidth),
    pitch: layout.pitch,
    bead: layout.bead,
    hit: HIT_AREA_PX,
    columns: layout.rows,
    journalColumns: layout.journalRows,
    chapters: layout.chapters.length,
    chapterRows: strip.count,
    families: families.length,
    width: Math.round(size.width),
    height: Math.round(size.height),
    fieldWidth: layout.fieldHeight,
    contentWidth,
    fit: layout.fit,
  };

  return (
    <div
      ref={container}
      className="nx-proof"
      data-axis="depth"
      style={{
        "--columns": layout.columns,
        "--gutter": `${layout.gutter}px`,
        "--label-h": `${LABEL_PX}px`,
        "--legend-h": `${LEGEND_PX}px`,
        "--bead": `${layout.bead}px`,
        "--hit": `${HIT_AREA_PX}px`,
        "--pitch": `${layout.pitch}px`,
        "--band": `${layout.laneWidth}px`,
        "--strip": `${bands.top}px`,
        "--chapter-row": `${CHAPTER_ROW_PX}px`,
        "--chapter-pad": `${CHAPTER_STRIP_PAD_PX}px`,
      } as CSSProperties}
      data-branch-count={branches.length}
      data-lane-density={layout.laneWidth < 44 ? "tight" : layout.laneWidth < 64 ? "dense" : "open"}
      data-bead-count={layout.beads.length}
      data-thread-count={layout.threads.length}
      data-row-count={layout.rows}
      data-family-count={families.length}
      data-final-receipt={finalReceipt === null ? "none" : finalReceipt.phase}
      data-fit={layout.fit}
      data-scroll={layout.fit === "scroll" ? scrollPlace : "none"}
      data-focus={focusing ? "true" : "false"}
      data-ordinal-place={ordinalPlace}
      data-geometry={JSON.stringify(geometry)}
    >
      <div className="nx-proof-head">
        {/* The axis, named: what "to the right" means on this picture. */}
        <span className="nx-reading-head" aria-hidden="true">{layout.rows > 0 ? copy.causalDepth : ""}</span>
        <span className="nx-axis-head" aria-hidden="true">{layout.rows > 1 ? `0 → ${layout.rows - 1}` : ""}</span>
      </div>
      <div ref={field} className="nx-proof-field" data-fit={layout.fit} onScroll={placeScroll}>
        <div className="nx-proof-scroll" style={{ width: `${contentWidth}px` }}>
          <svg
            className="nx-proof-edges"
            viewBox={`0 0 ${contentWidth} ${Math.max(1, fieldTall)}`}
            width={contentWidth}
            height={Math.max(1, fieldTall)}
            preserveAspectRatio="none"
            aria-hidden="true"
            focusable="false"
            style={{ width: `${contentWidth}px`, height: `${Math.max(1, fieldTall)}px` }}
          >
            <defs>
              <marker id="nx-thread-tip" viewBox="0 0 6 6" refX={6 + layout.bead / 2 + 1} refY="3" markerWidth="6" markerHeight="6" markerUnits="userSpaceOnUse" orient="auto">
                <path d="M 0 0.5 L 5.5 3 L 0 5.5 Z" />
              </marker>
            </defs>
            {/* The provenance bands: scenery, tinted by lane at 5 %, never a relation. */}
            <g className="nx-bands">
              {bands.bands.map((band) => (
                <rect key={band.branch} className="nx-band" data-branch={band.branch} x={layout.gutter} y={band.top} width={Math.max(0, contentWidth - layout.gutter)} height={layout.laneWidth} />
              ))}
            </g>
            {/* The depth axis: structure, not chronology — a dotted line under
                the bands, a start mark, a tick and a number every fifth column,
                a tip pointing deeper. */}
            {layout.rail !== null && (
              <g className="nx-rail">
                <path className="nx-rail-line" d={`M ${layout.rail.top} ${layout.rail.x} H ${layout.rail.bottom}`} vectorEffect="non-scaling-stroke" />
                <circle className="nx-rail-start" cx={layout.rail.top} cy={layout.rail.x} r="2.4" />
                {axisTicks.map((column) => (
                  <g key={column} className="nx-axis-tick">
                    <path className="nx-rail-tick" d={`M ${xOfColumn(column)} ${layout.rail!.x - 3} V ${layout.rail!.x + 3}`} vectorEffect="non-scaling-stroke" />
                    <text className="nx-axis-number" x={xOfColumn(column)} y={layout.rail!.x + 11} textAnchor="middle">{column}</text>
                  </g>
                ))}
                <path className="nx-rail-tip" d={`M ${layout.rail.bottom - 4} ${layout.rail.x - 3} L ${layout.rail.bottom} ${layout.rail.x} L ${layout.rail.bottom - 4} ${layout.rail.x + 3}`} vectorEffect="non-scaling-stroke" />
              </g>
            )}
            {layout.threads.map((thread) => {
              const child = byId.get(thread.child);
              // Brief emphasis: while the child is still attaching. Once locked, history.
              const fresh = child !== undefined && child.lock < 1;
              const focused = focusing && inFocus(thread.parent) && inFocus(thread.child);
              const state = focused ? "focus" : fresh ? "new" : "historical";
              return (
                <path
                  key={thread.key}
                  className={`nx-edge nx-edge-${thread.kind} ${thread.crossLane ? "is-cross" : "is-same"} is-${state}${focusing && !focused ? " is-dim" : ""}`}
                  d={thread.d}
                  style={{ opacity: child === undefined ? 1 : Math.max(0.001, child.attach) }}
                  data-parent={thread.parent}
                  data-child={thread.child}
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}
            {/* The compilation: a dotted gathering line from each lane's deepest
                sealed receipt RIGHT to one vertical rail, a stem to the capsule. */}
            {finalReceipt !== null && layout.compileY !== null && layout.finalY !== null && gathered.length > 0 && (
              <g className="nx-compile" style={{ opacity: finalReceipt.attach }}>
                {gathered.map((anchor) => (
                  <path key={anchor.evidenceId} className="nx-edge nx-edge-compile" d={`M ${anchor.x} ${anchor.y} H ${layout.compileY}`} data-input={anchor.evidenceId} vectorEffect="non-scaling-stroke" />
                ))}
                <path className="nx-edge nx-edge-compile nx-compile-rail" d={`M ${layout.compileY} ${Math.min(...gathered.map((anchor) => anchor.y))} V ${Math.max(...gathered.map((anchor) => anchor.y))}`} vectorEffect="non-scaling-stroke" />
                <path className="nx-edge nx-edge-compile nx-compile-stem" d={`M ${layout.compileY} ${bands.centre} H ${layout.finalY - 4}`} vectorEffect="non-scaling-stroke" />
              </g>
            )}
            {layout.postSealY !== null && (
              <path className="nx-post-seal-rule" d={`M ${layout.postSealY} ${bands.top} V ${bands.bottom}`} vectorEffect="non-scaling-stroke" />
            )}
          </svg>
          {/* The lane names: a column at the left that stays while the field
              scrolls. Each is a control that opens its evidence. */}
          <ol className="nx-branch-labels">
            {lanes.map((branch, index) => (
              <li key={branch} data-branch={branch} data-dim={focusing && !lanesInFocus.has(branch) ? "true" : "false"} style={{ "--y": `${bands.bands[index]!.centre}px` } as CSSProperties}>
                <button type="button" className="nx-branch-label" onClick={() => onBranch(branch)} aria-label={`${copy.openBranch}: ${copy.branchLabels[branch]}`}>
                  <span>{copy.branchLabels[branch]}</span>
                  <b>{items.filter((entry) => entry.branch === branch).length}</b>
                </button>
              </li>
            ))}
          </ol>
          {/* The chapters as depth-range spans in a strip above the bands. Spans
              overlap — the detached signalStop episode runs beside missionStart —
              so overlapping spans take separate rows and the overlap stays visible. */}
          <ol className="nx-chapters" aria-hidden="true">
            {layout.chapters.map((chapter, index) => (
              <li
                key={chapter.episode + String(chapter.fromRow)}
                data-episode={chapter.episode}
                style={{ "--x": `${chapter.top}px`, "--w": `${Math.max(0, chapter.bottom - chapter.top)}px`, "--row": strip.rowOf[index] ?? 0 } as CSSProperties}
              >
                <span>{copy.episodeLabels[chapter.episode]}</span>
              </li>
            ))}
          </ol>
          <ol className="nx-beads" aria-label={copy.openReceipt}>
            {layout.beads.map((placement) => {
              const entry = byId.get(placement.evidenceId);
              if (entry === undefined) return null;
              const isLatest = latest !== null && latest.evidenceId === entry.evidenceId;
              const isArrival = arrival !== null && arrival.evidenceId === entry.evidenceId;
              const isSelected = entry.evidenceId === selected;
              const focused = focusing && inFocus(entry.evidenceId);
              return (
                <li key={entry.evidenceId} data-branch={entry.branch} data-rank={placement.rank} data-row={placement.row}>
                  <button
                    type="button"
                    className={`nx-bead action-${entry.actionFamily}${isLatest ? " is-latest" : ""}${isSelected ? " is-selected" : ""}${focused ? " is-focus" : ""}${focusing && !focused ? " is-dim" : ""}${entry.assurance === "QUARANTINED" ? " is-not-retained" : ""}${entry.provenanceResolution === "UNRESOLVED" ? " is-unresolved" : ""}${entry.standing === "JOURNAL" ? " is-journal" : ""}`}
                    data-evidence-id={entry.evidenceId}
                    data-rank={placement.rank}
                    data-row={placement.row}
                    data-family={entry.actionFamily}
                    data-phase={entry.phase}
                    data-standing={entry.standing}
                    style={{
                      "--x": `${placement.x}px`,
                      "--y": `${placement.y}px`,
                      "--nr-appear": entry.nrAppear,
                      "--lock": entry.lock,
                    } as CSSProperties}
                    data-ordinal={entry.ordinal.label}
                    // Named by what it IS, then by what pressing it DOES. At
                    // B R2 the name deliberately stopped short of promising an
                    // opening, because the first press did not perform one;
                    // C-R2 made a single press open the record, so the name
                    // says so. `aria-current` marks which receipt is the one
                    // being shown — a selected item in a set, not a toggle.
                    aria-label={`${entry.ordinal.label} · ${nameOf(entry)} · ${copy.familyLabels[entry.actionFamily]} · ${copy.branchLabels[entry.branch]} · ${copy.openReceipt}`}
                    aria-current={isSelected ? "true" : undefined}
                    onClick={() => onBead(entry.evidenceId)}
                  >
                    <i aria-hidden="true" />
                    {/* C-R2-F01: the bead says its number. The same handle the
                        dossier prints as `NR 24`, with the room a bead has —
                        one sequence, two renderings, never a second numbering.
                        The accessible name already carries the full form, so
                        the numeral itself is decoration to a screen reader. */}
                    <b className="nx-bead-ordinal" aria-hidden="true">{entry.ordinal.compact}</b>
                  </button>
                  {/* THE ARRIVAL (Checkpoint C, C-F05): while a receipt is the
                      newest one on the band, it says its number and what it
                      attests, beside its own bubble. Transient, restrained,
                      interrupting nothing; it settles into the field as the
                      next one lands. */}
                  {isArrival && !focusing && finalReceipt === null && (
                    <span className={`nx-bead-caption${placement.x > Math.min(size.width, contentWidth) * 0.72 ? " is-left" : ""}`} data-ordinal={entry.ordinal.label} style={{ "--x": `${placement.x}px`, "--y": `${placement.y}px`, "--nr-appear": Math.max(entry.nrAppear, 0.85) } as CSSProperties} aria-hidden="true">
                      <em><b className="nx-caption-ordinal">{entry.ordinal.label}</b>{copy.actorLabels[entry.domain] ?? copy.branchLabels[entry.branch]}</em>
                      {nameOf(entry)}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
          {finalReceipt !== null && layout.finalY !== null && (
            <div className="nx-compilation" style={{ "--x": `${layout.finalY}px`, "--y": `${bands.centre}px`, "--nr-appear": finalReceipt.nrAppear, "--lock": finalReceipt.lock } as CSSProperties}>
              <button
                type="button"
                className={`nx-final-receipt${finalReceipt.phase !== "SETTLED" ? " is-arriving" : ""}${focusing ? " is-dim" : ""}`}
                data-receipt-id={finalReceipt.receiptId}
                data-phase={finalReceipt.phase}
                data-inputs={gathered.length}
                aria-label={copy.openFinal}
                onClick={onFinal}
              >
                <i aria-hidden="true" />
                <span>{copy.finalReceipt}</span>
              </button>
            </div>
          )}
          {layout.postSealY !== null && (
            <div className="nx-post-seal" style={{ "--x": `${layout.postSealY}px`, "--y": `${bands.top}px` } as CSSProperties} aria-hidden="true">
              <span>{copy.postSeal}</span>
            </div>
          )}
        </div>
      </div>
      {/* Under the fallback scroll: where the start and the end of the story lie,
          out of view. The accessible name contains the visible words. */}
      {layout.fit === "scroll" && scrollPlace !== "start" && firstChapter !== null && (
        <button type="button" className="nx-scroll-cue is-start" onClick={() => scrollTo("start")} aria-label={`${copy.toStart} · ${copy.episodeLabels[firstChapter.episode]}`}>
          <i aria-hidden="true" />
          <span>{copy.episodeLabels[firstChapter.episode]}</span>
        </button>
      )}
      {layout.fit === "scroll" && scrollPlace !== "end" && (
        <button type="button" className="nx-scroll-cue is-end" onClick={() => scrollTo("end")} aria-label={`${copy.toEnd} · ${finalReceipt !== null ? copy.finalReceipt : copy.newEvidence}`}>
          <span>{finalReceipt !== null ? copy.finalReceipt : copy.newEvidence}</span>
          <i aria-hidden="true" />
        </button>
      )}
      {/* Selecting is the first act, and it says so in words: the band keeps one
          live line naming the selected receipt and the size of its chain. */}
      <p className="nx-proof-selected" aria-live="polite">
        {focusing && selectedEntry !== null
          ? `${selectedEntry.ordinal.label} · ${nameOf(selectedEntry)} · ${copy.familyLabels[selectedEntry.actionFamily]} · ${copy.branchLabels[selectedEntry.branch]} · ${copy.chain.replace("{ancestors}", String(focus.ancestors.size)).replace("{descendants}", String(focus.descendants.size))}`
          : ""}
      </p>
      <ol className="nx-legend" aria-label={copy.legendAria} data-family-count={families.length}>
        {families.length > 0 && <li className="nx-legend-kicker">{copy.families}</li>}
        {families.map((family) => (
          <li key={family} className={`nx-legend-item action-${family}`} data-family={family}>
            <i aria-hidden="true" />
            <span>{copy.familyLabels[family]}</span>
          </li>
        ))}
        {(hasCause || hasObserved || gathered.length > 0) && (
          <li className="nx-legend-threads" data-kinds={`${hasCause ? "cause " : ""}${hasObserved ? "observed " : ""}${gathered.length > 0 ? "compiled" : ""}`.trim()}>
            <span className="nx-legend-kicker">{copy.threads}</span>
            {hasCause && <span className="nx-legend-thread" data-kind="cause"><svg viewBox="0 0 18 4" aria-hidden="true"><path d="M 1 2 H 17" /></svg>{copy.threadCause}</span>}
            {hasObserved && <span className="nx-legend-thread" data-kind="observed"><svg viewBox="0 0 18 4" aria-hidden="true"><path className="is-observed" d="M 1 2 H 17" /></svg>{copy.threadObserved}</span>}
            {gathered.length > 0 && <span className="nx-legend-thread" data-kind="compiled"><svg viewBox="0 0 18 4" aria-hidden="true"><path className="is-compiled" d="M 1 2 H 17" /></svg>{copy.threadCompiled}</span>}
          </li>
        )}
      </ol>
    </div>
  );
}

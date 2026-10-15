import { presentationTimeForMasterTime } from "../../masterStory.ts";
import {
  EXPERIENCE_DURATION_MS,
  FINAL_RECEIPT_EMITTED_MS,
  HANDOFF_READY_MS,
  PEB_COMPLETE_MS,
} from "../../storyTimeline.ts";
import { HUMAN_AUTHORITY_GATE_MS } from "../../reviewFlow.ts";
import type { EvidenceEpisode } from "../adapter/evidenceEpisode.ts";
import { NX_RECEIPT_FLIGHT_MS, canonicalMoments, minimumArrivalGapMs, type PacingClass } from "./presentationQueue.ts";

/**
 * D-006 NX1 Checkpoint C — the HUMAN PACING MODEL, revised at C-R1 and C-R2.
 *
 * PRESENTATION TIME IS NOT EVENT TIME. The engine already separates the two:
 * `masterTimeMs` is the canonical coordinate every piece of evidence is
 * stamped in, and `presentationTimeForMasterTime` maps it to the wall-clock
 * time a viewer spends. This module gives the public experience its own
 * presentation clock, built ON TOP of the engine's and never below it:
 *
 *   - it only ever ADDS time. Every interval is at least as long as the
 *     engine already gives it, so nothing is made faster and the order of
 *     events cannot change;
 *   - it changes no timestamp, no causal time, no evidence, no admission
 *     order, and no mission clock semantics. Master time is what it always
 *     was; only the rate at which a human walks through it differs;
 *   - it is a pure function with no clock of its own, so a test can read the
 *     whole schedule.
 *
 * FOUR CLASSES, one rule. Every moment at which evidence lands is classified
 * from canonical information alone, and the interval that ARRIVES at that
 * moment is stretched to at least the class minimum:
 *
 *   ORDINARY   a receipt lands — long enough to notice a bubble and its
 *              number appear.
 *   IMPORTANT  the moment carries a decision or an authorization — long
 *              enough to read the short label as well.
 *   CHAPTER    the moment opens a new significant episode — the story
 *              breathes before a new part begins.
 *   CRITICAL   the human authority boundary, the Final Receipt, the portable
 *              bundle, the hand-over. These also HOLD: the playhead rests for
 *              a moment on the canonical instant, so the viewer can take in
 *              what has just been established. Mission time does not advance
 *              during a hold; nothing is recorded, nothing is skipped. The
 *              receipt of that instant flies in during the hold, so the world
 *              is still while the evidence of it arrives.
 *
 * C-R1 — WHAT CHANGED, AND WHY. Pacing moments is not enough. A canonical
 * instant may carry more than one nano-receipt, and three instants of this
 * run carry two each; at those instants the C model gave the moment one class
 * floor and both receipts arrived inside it, in the same frame. So the
 * schedule now RESERVES, on the interval that LEAVES a moment, the whole
 * presentation time that moment's receipts need to be shown one at a time
 * (`canonicalMoments().reservedMs`). The presentation queue does the
 * serialising; this model guarantees it the room, so a staged receipt is
 * always shown before the next instant's evidence is due and the picture
 * never falls behind the world.
 *
 * C-R2 — THE SAME MODEL, LESS TIME. The queue now serialises landings rather
 * than departures, so a receipt's flight overlaps the previous one's reading
 * instead of following it. Every floor here therefore shrank by one flight,
 * and with it the whole schedule: the run went from 140 s to about 112 s
 * without any receipt getting less reading time than it had.
 */

export type { PacingClass } from "./presentationQueue.ts";

/**
 * The least presentation time a viewer gets between two moments, by class —
 * the same floors the presentation queue gives one receipt, so a moment can
 * never be given less room than the receipt that lands on it needs.
 */
export const MINIMUM_PRESENTATION_GAP_MS: Readonly<Record<PacingClass, number>> = Object.freeze({
  ORDINARY: minimumArrivalGapMs("ORDINARY"),
  IMPORTANT: minimumArrivalGapMs("IMPORTANT"),
  CHAPTER: minimumArrivalGapMs("CHAPTER"),
  CRITICAL: minimumArrivalGapMs("CRITICAL"),
});

/**
 * How long the playhead rests ON a critical instant, after reaching it.
 *
 * It is exactly one critical receipt's whole presentation — its flight, its
 * reading hold and its respiration — so that the evidence of the instant the
 * mission turns on can arrive, be read and settle while the world is still.
 * C-R2 dropped the flight from `minimumArrivalGapMs`, because a flight now
 * overlaps the previous receipt's reading; the hold adds it back explicitly,
 * since at a hold there is no previous reading for it to overlap.
 *
 * It matters at the human authority boundary in particular, where the clock
 * STOPS: a hold shorter than the arrival would leave the boundary's own
 * receipt frozen in mid-flight for as long as the reviewer took to decide.
 */
export const CRITICAL_HOLD_MS = NX_RECEIPT_FLIGHT_MS + minimumArrivalGapMs("CRITICAL");

/**
 * The beat a critical instant gets when NOTHING arrives in it (C-R2-F06).
 *
 * The portable bundle completing and the hand-over becoming possible are real
 * moments and a viewer should feel them land, but no evidence arrives at
 * either: there is nothing to read, so a full arrival-length hold is time
 * spent on ceremony. Human review found the ending made of it. This is long
 * enough to register a change of state and no longer.
 */
export const CLOSURE_HOLD_MS = 1_200;

/** The canonical instants the mission itself turns on. */
export const CRITICAL_MOMENTS_MS: readonly number[] = Object.freeze([
  HUMAN_AUTHORITY_GATE_MS,
  FINAL_RECEIPT_EMITTED_MS,
  PEB_COMPLETE_MS,
  HANDOFF_READY_MS,
]);

type Moment = Readonly<{
  masterMs: number;
  pacing: PacingClass;
  episode: EvidenceEpisode | null;
  /** The presentation time this moment's own receipts need, one at a time. */
  reservedMs: number;
}>;

/** The schedule: one segment per interval, plus a zero-width hold at each critical instant. */
export type PacingSegment = Readonly<{
  masterFromMs: number;
  masterToMs: number;
  presentationFromMs: number;
  presentationToMs: number;
  /** A hold rests on one instant: master time does not advance across it. */
  hold: boolean;
  pacing: PacingClass;
  /** How many nano-receipts the moment this segment arrives at carries. */
  arrivals: number;
}>;

function buildSchedule(): readonly PacingSegment[] {
  const byMoment = new Map<number, Moment>();
  const rank: Record<PacingClass, number> = { ORDINARY: 0, IMPORTANT: 1, CHAPTER: 2, CRITICAL: 3 };
  const consider = (masterMs: number, pacing: PacingClass, episode: EvidenceEpisode | null, reservedMs: number) => {
    const previous = byMoment.get(masterMs);
    byMoment.set(masterMs, {
      masterMs,
      pacing: previous === undefined || rank[pacing] > rank[previous.pacing] ? pacing : previous.pacing,
      episode: previous?.episode ?? episode,
      reservedMs: Math.max(previous?.reservedMs ?? 0, reservedMs),
    });
  };
  // A moment is keyed on the CANONICAL INSTANT the evidence was recorded at.
  // Its class is the strongest among the receipts recorded there, and its
  // reservation is what all of them together cost to show one at a time.
  //
  // Checkpoint C keyed it on the instant the bead landed, one flight later,
  // because the flight was measured in master time; the queue now owns the
  // flight and measures it in presentation time, so the schedule is free to
  // be about master time alone.
  const arrivalsAt = new Map<number, number>();
  for (const moment of canonicalMoments()) {
    consider(moment.masterMs, moment.pacing, moment.episode === "other" ? null : moment.episode, moment.reservedMs);
    arrivalsAt.set(moment.masterMs, (arrivalsAt.get(moment.masterMs) ?? 0) + moment.count);
  }
  for (const masterMs of CRITICAL_MOMENTS_MS) consider(masterMs, "CRITICAL", null, minimumArrivalGapMs("CRITICAL"));

  // A moment that opens a new episode is a chapter transition.
  const moments = [...byMoment.values()].sort((left, right) => left.masterMs - right.masterMs);
  let episode: EvidenceEpisode | null = null;
  const classified = moments.map((moment) => {
    const opensChapter = moment.episode !== null && moment.episode !== episode && episode !== null;
    if (moment.episode !== null) episode = moment.episode;
    return opensChapter && moment.pacing !== "CRITICAL" ? { ...moment, pacing: "CHAPTER" as PacingClass } : moment;
  });

  const segments: PacingSegment[] = [];
  let masterCursor = 0;
  let presentationCursor = 0;
  // What the moment we are leaving still owes its own receipts.
  let reservedByPrevious = 0;
  const critical = new Set(CRITICAL_MOMENTS_MS);
  const tail: Moment = { masterMs: EXPERIENCE_DURATION_MS, pacing: "ORDINARY", episode: null, reservedMs: 0 };
  for (const moment of [...classified, tail]) {
    if (moment.masterMs <= masterCursor) continue;
    const target = Math.min(moment.masterMs, EXPERIENCE_DURATION_MS);
    const engineGap = presentationTimeForMasterTime(target) - presentationTimeForMasterTime(masterCursor);
    // Never faster than the engine; never below the arriving moment's class
    // floor; and never shorter than the time the moment we are LEAVING needs
    // to show its own receipts one at a time.
    const duration = Math.max(engineGap, MINIMUM_PRESENTATION_GAP_MS[moment.pacing], reservedByPrevious);
    segments.push({
      masterFromMs: masterCursor,
      masterToMs: target,
      presentationFromMs: presentationCursor,
      presentationToMs: presentationCursor + duration,
      hold: false,
      pacing: moment.pacing,
      arrivals: arrivalsAt.get(target) ?? 0,
    });
    masterCursor = target;
    presentationCursor += duration;
    reservedByPrevious = moment.reservedMs;
    if (critical.has(target)) {
      // C-R2-F06 — A HOLD IS AS LONG AS WHAT ARRIVES IN IT. A hold exists so
      // the evidence of the instant the mission turns on can arrive, be read
      // and settle while the world is still; it is one arrival long. Where
      // NOTHING arrives, that length is ceremony, and the human review found
      // the ending full of it. Those instants keep a hold — they are real
      // moments and a viewer should feel them land — but only a closure beat.
      //
      // The Final Receipt's instant counts as an arrival even though no
      // nano-receipt lands there: the receipt capsule itself materialises, and
      // it is the moment the whole mission compiles to.
      const holdMs = (arrivalsAt.get(target) ?? 0) > 0 || target === FINAL_RECEIPT_EMITTED_MS
        ? CRITICAL_HOLD_MS
        : CLOSURE_HOLD_MS;
      segments.push({
        masterFromMs: target,
        masterToMs: target,
        presentationFromMs: presentationCursor,
        presentationToMs: presentationCursor + holdMs,
        hold: true,
        pacing: "CRITICAL",
        arrivals: 0,
      });
      presentationCursor += holdMs;
      // A hold is presentation time the moment's receipts can be shown in.
      reservedByPrevious = Math.max(0, reservedByPrevious - holdMs);
    }
    if (masterCursor >= EXPERIENCE_DURATION_MS) break;
  }
  return Object.freeze(segments);
}

export const PACING_SCHEDULE: readonly PacingSegment[] = buildSchedule();

/** The wall-clock length of the paced experience. */
export const HUMAN_PRESENTATION_DURATION_MS = PACING_SCHEDULE.length === 0
  ? 0
  : PACING_SCHEDULE[PACING_SCHEDULE.length - 1]!.presentationToMs;

/** The presentation coordinate of a master time; at a hold, the instant it begins. */
export function humanPresentationTime(masterTimeMs: number): number {
  const master = Math.min(EXPERIENCE_DURATION_MS, Math.max(0, masterTimeMs));
  let last = 0;
  for (const segment of PACING_SCHEDULE) {
    if (segment.hold) {
      if (master === segment.masterFromMs) return segment.presentationFromMs;
      last = segment.presentationToMs;
      continue;
    }
    if (master >= segment.masterToMs) { last = segment.presentationToMs; continue; }
    if (master <= segment.masterFromMs) return segment.presentationFromMs;
    const span = Math.max(1, segment.masterToMs - segment.masterFromMs);
    return segment.presentationFromMs + ((master - segment.masterFromMs) / span) * (segment.presentationToMs - segment.presentationFromMs);
  }
  return last;
}

/** The master time a viewer has reached after this much presentation time. */
export function humanMasterTime(presentationTimeMs: number): number {
  const presentation = Math.max(0, presentationTimeMs);
  if (presentation >= HUMAN_PRESENTATION_DURATION_MS) return EXPERIENCE_DURATION_MS;
  for (const segment of PACING_SCHEDULE) {
    if (presentation >= segment.presentationToMs) continue;
    if (segment.hold) return segment.masterFromMs;
    const span = Math.max(1, segment.presentationToMs - segment.presentationFromMs);
    const progress = (presentation - segment.presentationFromMs) / span;
    return segment.masterFromMs + progress * (segment.masterToMs - segment.masterFromMs);
  }
  return EXPERIENCE_DURATION_MS;
}

/**
 * The LAST presentation coordinate that maps to this master time — the far
 * side of any hold resting on it. Where `humanPresentationTime` answers "when
 * does a viewer reach this instant", this answers "when has a viewer finished
 * with it", which is what a STOPPED clock needs: at the human authority
 * boundary the mission does not advance until a person decides, and the
 * evidence of the boundary must still be allowed to arrive and be read.
 */
export function humanPresentationTimeAtRest(masterTimeMs: number): number {
  const master = Math.min(EXPERIENCE_DURATION_MS, Math.max(0, masterTimeMs));
  const hold = PACING_SCHEDULE.find((segment) => segment.hold && segment.masterFromMs === master);
  return hold?.presentationToMs ?? humanPresentationTime(master);
}

/** True while the playhead is resting on a canonical instant. */
export function isHolding(presentationTimeMs: number): boolean {
  return PACING_SCHEDULE.some((segment) => segment.hold && presentationTimeMs >= segment.presentationFromMs && presentationTimeMs < segment.presentationToMs);
}

/**
 * The presentation coordinate at which a receipt recorded at this canonical
 * instant may DEPART: the instant itself, read on the human clock. The
 * presentation queue takes this as its floor — it may hold a receipt back, and
 * may never release one earlier — so no receipt is ever shown before the
 * moment the engine recorded it.
 */
export function naturalDepartureTime(canonicalTimeMs: number): number {
  return humanPresentationTime(canonicalTimeMs);
}

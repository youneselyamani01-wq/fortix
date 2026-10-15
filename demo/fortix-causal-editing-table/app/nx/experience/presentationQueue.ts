import { MASTER_EVIDENCE_EVENTS } from "../../masterStory.ts";
import { MISSION_EVIDENCE_SPECS, specTime } from "../../missionEvidence.ts";
import type { EvidenceMemberRef } from "../../portableMissionEvidence.ts";
import { EXPERIENCE_DURATION_MS } from "../../storyTimeline.ts";
import { actionFamilyOf } from "../adapter/actionFamily.ts";
import { episodeOf, type EvidenceEpisode } from "../adapter/evidenceEpisode.ts";

/**
 * How long a receipt's causal thread takes to reach its parents and lock —
 * the Proof Tree's own attachment window (C3-R1). It lives here because the
 * queue must know it to say when a receipt has finished settling, and the
 * public experience adapter re-exports it.
 */
export const EVIDENCE_ATTACH_DURATION_MS = 700;

/**
 * D-006 NX1 Checkpoint C-R1 — the PRESENTATION QUEUE.
 *
 * ONE RECEIPT OWNS THE VIEWER'S ATTENTION AT A TIME.
 *
 * Checkpoint C gave the run a human presentation clock, but that clock paces
 * MOMENTS, and a moment can carry more than one nano-receipt. Three canonical
 * instants of this run carry two receipts each, and at those instants both
 * receipts arrived in the same frame: technically correct, humanly unreadable.
 * This module is the queue that stands between CANONICAL ADMISSION and VISUAL
 * ARRIVAL, and it exists to serialise arrivals — nothing else.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT THIS QUEUE IS NOT. It has ZERO EVIDENTIARY AUTHORITY. It is not an
 * evidence queue, a persistence queue, an execution queue, a verification
 * queue, or a causal ordering authority. It cannot admit, withhold, reorder,
 * create or destroy evidence, and no digest, signature, manifest, verdict or
 * canonical timestamp is a function of anything computed here. Every receipt
 * that the engine has admitted still exists, still carries the instant the
 * engine stamped on it, and is still read in exactly the order the reading
 * rule gives it. The queue decides ONE thing: the wall-clock moment at which
 * an already-admitted receipt becomes VISIBLE, and it may only ever move that
 * moment LATER than the canonical instant, never earlier.
 *
 * PRESENTATION TIME ≠ EVENT TIME. Two receipts recorded at the same canonical
 * instant are shown one after the other, and each still displays the instant
 * it was recorded at. The picture is serial; the record is simultaneous, and
 * the record is what the receipt carries.
 *
 * The proof's own row rule (B R2) is untouched by this and is NOT a general
 * answer to the difference: two receipts of one moment share a row only when
 * they are in different lanes and the same episode, because a row may not put
 * two receipts of one lane on top of each other and a chapter may not straddle
 * a row. Of this run's three same-instant pairs exactly one qualifies. The
 * other two sit on consecutive rows, and their equal recorded instants say so
 * where it counts — in the receipts.
 *
 * PRESENTATION ORDER IS NOT CAUSAL ORDER. That `NR 32` is shown before
 * `NR 33` says nothing about whether one caused the other. Causality is drawn
 * only from declared relations, and two receipts staged back to back with no
 * declared relation between them are joined by no thread. `staging` on a slot
 * records why a receipt waited, so a test can prove the difference and a
 * reader can be told it.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE FIVE STAGES. Every nano-receipt passes through the same lifecycle, in
 * presentation time:
 *
 *   A  ARRIVAL         the receipt leaves the world and lands on the band.
 *                      `releaseMs` → `landingMs`, one flight long.
 *   B  READING HOLD    the bead, its number and its caption are readable and
 *                      NOTHING ELSE LANDS. This is the stage the checkpoint
 *                      exists for; its length is the class floor.
 *   C  SETTLEMENT      the causal thread reaches its parents and locks.
 *   D  STABILIZATION   the receipt takes its permanent place and stops being
 *                      the focus; the caption is released.
 *   E  RESPIRATION     a beat between one receipt's reading and the next
 *                      receipt's landing, so two never abut.
 *
 * Stages B and C run together — a viewer reads the bead while its thread
 * draws — and OWNERSHIP ends when both are done.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * C-R2 — WHAT SERIALISES, AND WHAT NO LONGER DOES.
 *
 * C-R1 chained the whole lifecycle: a receipt could not even DEPART until the
 * previous one had been read, settled and had its silence. That removed every
 * burst, and it cost 140 seconds — the flight of each receipt was dead time no
 * other receipt could use, 58 times over. Human review found the result
 * correct but ceremonious.
 *
 * The rule is now LAND → the next may land after this one's reading is done:
 *
 *     landing = max(its own moment + one flight, the previous slot's end)
 *     release = landing − one flight
 *
 * The serialised quantity is the LANDING, not the departure. A receipt is
 * therefore in flight WHILE the previous one is being read — deliberately,
 * because the two are different demands: a bead crossing the world is
 * peripheral motion, and the receipt on the band is the thing being read.
 * What must never overlap is READING, and it cannot: a landing may not happen
 * before the previous receipt's ownership and respiration are over.
 *
 * So, at every moment of the run:
 *   - at most ONE receipt owns the viewer's reading attention  (unchanged);
 *   - at most ONE arrival caption is showing                   (unchanged);
 *   - at most ONE receipt is in flight                         (still true, and
 *     measured — the flight is shorter than the gap it sits in);
 *   - a flight MAY overlap the previous receipt's reading       (new).
 */

/** The pacing class of a receipt: how much of the viewer's attention it is owed. */
export type PacingClass = "ORDINARY" | "IMPORTANT" | "CHAPTER" | "CRITICAL";

/** Where a receipt stands in its presentation lifecycle. */
export type PresentationStage = "QUEUED" | "ARRIVING" | "READING" | "SETTLING" | "STABILIZING" | "RESTING" | "PRESENTED";

/**
 * Why a receipt's visual arrival is later than its canonical instant.
 *
 *   IMMEDIATE      it arrived at its own moment; the queue added nothing.
 *   SAME_INSTANT   another receipt shares its canonical instant and was read
 *                  first, so this one waited for the viewer's attention.
 *   QUEUED         the receipt before it was still being read.
 *
 * SAME_INSTANT is the whole point of the checkpoint and is reported apart from
 * ordinary queueing so the measurement can name every group it staged.
 */
export type StagingReason = "IMMEDIATE" | "SAME_INSTANT" | "QUEUED";

/**
 * THE FLIGHT, in presentation milliseconds — how long a receipt takes to cross
 * from the world to the proof band.
 *
 * The engine's own `RECEIPT_TRAVEL_DURATION_MS` is 1 200 ms and stays what it
 * is; this is the NX experience's, and it is shorter for a measured reason.
 * Under strict serialisation the flight is dead time no other receipt may use:
 * at 1 200 ms the run would spend 58 × 1.2 s — over a minute — on travel
 * alone, and every second of it is a second a viewer cannot read in. At 500 ms
 * the departure is still plainly motion from the world to the record (longer
 * than the bead's own 420 ms arrival transition), and the 40 seconds it frees
 * go to the reading holds, where a viewer can actually use them.
 */
export const NX_RECEIPT_FLIGHT_MS = 500;

/**
 * THE HUMAN FLOORS, in presentation milliseconds.
 *
 * `reading` is stage B: how long a receipt is the only new thing on screen.
 * `respiration` is stage E: the empty beat after its presentation is complete
 * and before the next receipt departs.
 *
 * Determined against the run rather than chosen, and TUNED AGAINST THE ACTUAL
 * CAPTIONS. Two hard floors come from the page itself: a bead's arrival
 * transition is 420 ms and its causal thread takes 700 ms to attach, so under
 * ~700 ms a receipt is still visibly moving when the next one starts and
 * cannot be said to have been shown at all.
 *
 * But being shown is not being read. The arrival caption is a sentence — «Le
 * taxi décide de s'arrêter avant la file» is seven words — and seven words of
 * unfamiliar interface text take a reader appreciably longer than 700 ms. A
 * first pass held an ordinary receipt for exactly the 700 ms floor and the
 * caption came and went before it could be finished; the hold is 1 100 ms
 * because that is what its own caption needs, not because 700 was wrong about
 * the animation. Above it the classes buy what each moment asks a viewer to
 * do: a decision or an authorization has a label to weigh as well, a chapter
 * opens a new part of the story, and a critical moment is one the mission
 * turns on.
 *
 * What a viewer actually gets is longer still, because the NEXT receipt does
 * not depart until this one is done: an ordinary receipt is the only settled
 * new thing on screen for its hold, its respiration and the following flight —
 * about 1.8 s — and a critical one for about 2.9 s.
 *
 * These are FLOORS, not targets. Where the mission's own pace gives a receipt
 * more room, it keeps it — the queue only ever adds.
 */
export const RECEIPT_OWNERSHIP_MS: Readonly<Record<PacingClass, Readonly<{ reading: number; respiration: number }>>> = Object.freeze({
  ORDINARY: Object.freeze({ reading: 1_100, respiration: 200 }),
  IMPORTANT: Object.freeze({ reading: 1_400, respiration: 250 }),
  CHAPTER: Object.freeze({ reading: 1_600, respiration: 400 }),
  CRITICAL: Object.freeze({ reading: 2_000, respiration: 400 }),
});

/**
 * The least presentation time between two visual arrivals, by the class of the
 * FIRST: how long it owns the viewer's reading, plus its respiration.
 *
 * C-R2 dropped the flight from this sum. The next receipt's flight now happens
 * DURING this one's reading rather than after it, so it costs the run nothing;
 * what a viewer is guaranteed between two landings is exactly the time the
 * first one is theirs to read, and a beat.
 */
export function minimumArrivalGapMs(pacing: PacingClass): number {
  const { reading, respiration } = RECEIPT_OWNERSHIP_MS[pacing];
  return Math.max(reading, EVIDENCE_ATTACH_DURATION_MS) + respiration;
}

/**
 * The shortest gap the queue will ever leave between two arrivals — the
 * ORDINARY floor, and the number the measurement checks every gap against.
 */
export const HUMAN_ARRIVAL_FLOOR_MS = minimumArrivalGapMs("ORDINARY");

/** The least a receipt must state for the queue to stage it. */
export type QueueableEvidence = Readonly<{
  evidenceId: string;
  /** The canonical instant the engine stamped. Read, never written. */
  timeMs: number;
  eventId: string;
  eventType: string;
  /** The evidence's own source class, as the closure states it. */
  source: EvidenceMemberRef["source"];
  episode: EvidenceEpisode;
}>;

/** One receipt's presentation slot. Every field is a presentation coordinate. */
export type PresentationSlot = Readonly<{
  evidenceId: string;
  /** The canonical instant, carried through untouched so a reader can compare. */
  canonicalTimeMs: number;
  pacing: PacingClass;
  staging: StagingReason;
  /** Stage A begins: the receipt leaves the world. */
  releaseMs: number;
  /** Stage A ends, B begins: the bead appears. The moment that is serialised. */
  landingMs: number;
  /** Stage B ends: the reading hold is over. */
  readingUntilMs: number;
  /** Stage C ends: the causal thread has locked. */
  settledAtMs: number;
  /** Stages B and C are both done: the receipt no longer owns the viewer. */
  ownedUntilMs: number;
  /** Stage E ends: the next receipt may begin arriving. */
  slotEndMs: number;
  /** How long this receipt is the only new thing on screen. */
  ownershipMs: number;
  /** How much later than its own moment the queue showed it. */
  deferralMs: number;
}>;

/**
 * The pacing class of one receipt, from canonical information alone: the
 * action family the engine's own type information gives it, and whether its
 * moment opens a new episode. No receipt is named here and no class is
 * assigned by hand.
 */
export function pacingClassOf(
  entry: QueueableEvidence,
  context: Readonly<{ opensChapter: boolean; critical: boolean }>,
): PacingClass {
  if (context.critical) return "CRITICAL";
  if (context.opensChapter) return "CHAPTER";
  const family = actionFamilyOf({ source: entry.source, eventId: entry.eventId, eventType: entry.eventType });
  return family === "decision" || family === "authorization" ? "IMPORTANT" : "ORDINARY";
}

/**
 * THE QUEUE. Walks the receipts in reading order and gives each one a slot.
 *
 *   landing = max(its own moment + one flight, the previous receipt's slot end)
 *   release = landing − one flight
 *
 * The first term is the floor that keeps the queue honest: a receipt never
 * lands sooner than one flight after the instant it was recorded at, so it can
 * never be shown early. The second is the serialisation: a receipt does not
 * LAND until the one before it has been read, has settled, and has had its
 * beat. Everything else follows.
 *
 * C-R2 serialises the LANDING rather than the departure. C-R1 serialised both,
 * which removed every burst and cost 140 seconds — each receipt's flight was
 * dead time no other receipt could use. A flight may now overlap the previous
 * receipt's reading, because the two are different demands on a viewer: a bead
 * crossing the world is peripheral motion; the bead on the band is the thing
 * being read. Reading itself never overlaps, and the measurement counts that
 * over the whole run rather than trusting the claim.
 *
 * `naturalDepartureMs` maps a canonical instant to the presentation coordinate
 * of that instant — the caller passes the human presentation clock, so the
 * queue itself holds no clock and can be read whole by a test.
 *
 * The walk is a forward fold: a receipt's slot depends only on the receipts
 * before it in the reading order. Because the reading order at any moment of a
 * run is a PREFIX of that run's full order, staging a prefix gives every
 * receipt in it exactly the slot it has in the whole — so a slot, like an
 * ordinal, never moves once given.
 */
export function presentationSlots(
  items: readonly QueueableEvidence[],
  naturalDepartureMs: (canonicalTimeMs: number) => number,
  criticalInstantsMs: readonly number[] = [],
): readonly PresentationSlot[] {
  const critical = new Set(criticalInstantsMs);
  const slots: PresentationSlot[] = [];
  let previousEnd = Number.NEGATIVE_INFINITY;
  let previousInstant: number | null = null;
  let episode: EvidenceEpisode | null = null;

  for (const entry of items) {
    const opensChapter = entry.episode !== "other" && episode !== null && entry.episode !== episode;
    if (entry.episode !== "other") episode = entry.episode;
    const pacing = pacingClassOf(entry, { opensChapter, critical: critical.has(entry.timeMs) });

    // A record the engine appends AFTER the experience has ended — a physical
    // restoration, the offline completion capture, a Reconciliation Receipt —
    // has no presentation clock left to be staged in. Staging it would mean
    // withholding it forever, so the queue does not take it: it is presented
    // as it stands, exactly as the lifecycle already treats it, and it neither
    // waits for nor delays anything in the run.
    if (entry.timeMs >= EXPERIENCE_DURATION_MS) {
      const after = naturalDepartureMs(entry.timeMs);
      slots.push(Object.freeze({
        evidenceId: entry.evidenceId,
        canonicalTimeMs: entry.timeMs,
        pacing,
        staging: "IMMEDIATE" as StagingReason,
        releaseMs: after,
        landingMs: after,
        readingUntilMs: after,
        settledAtMs: after,
        ownedUntilMs: after,
        slotEndMs: after,
        ownershipMs: 0,
        deferralMs: 0,
      }));
      continue;
    }

    const natural = naturalDepartureMs(entry.timeMs);
    // C-R2 — THE LANDING IS WHAT WAITS. A receipt lands no earlier than one
    // flight after its own canonical instant, and no earlier than the previous
    // receipt has finished being read and had its beat. Its departure is then
    // one flight before that, which may fall inside the previous receipt's
    // reading: a bead crossing the world is peripheral motion, not a second
    // thing to read. Every flight is still exactly one flight long, and none
    // begins before its own canonical instant — the first term guarantees it.
    const landingMs = Math.max(natural + NX_RECEIPT_FLIGHT_MS, previousEnd);
    const releaseMs = landingMs - NX_RECEIPT_FLIGHT_MS;
    const deferralMs = Math.max(0, releaseMs - natural);
    const staging: StagingReason = deferralMs === 0
      ? "IMMEDIATE"
      : previousInstant === entry.timeMs ? "SAME_INSTANT" : "QUEUED";

    const { reading, respiration } = RECEIPT_OWNERSHIP_MS[pacing];
    const readingUntilMs = landingMs + reading;
    const settledAtMs = landingMs + EVIDENCE_ATTACH_DURATION_MS;
    const ownedUntilMs = Math.max(readingUntilMs, settledAtMs);
    const slotEndMs = ownedUntilMs + respiration;

    slots.push(Object.freeze({
      evidenceId: entry.evidenceId,
      canonicalTimeMs: entry.timeMs,
      pacing,
      staging,
      releaseMs,
      landingMs,
      readingUntilMs,
      settledAtMs,
      ownedUntilMs,
      slotEndMs,
      ownershipMs: ownedUntilMs - landingMs,
      deferralMs,
    }));
    previousEnd = slotEndMs;
    previousInstant = entry.timeMs;
  }
  return Object.freeze(slots);
}

/** Where a receipt stands at this presentation moment. */
export function stageAt(slot: PresentationSlot, presentationTimeMs: number): PresentationStage {
  if (presentationTimeMs < slot.releaseMs) return "QUEUED";
  if (presentationTimeMs < slot.landingMs) return "ARRIVING";
  if (presentationTimeMs < Math.min(slot.readingUntilMs, slot.settledAtMs)) return "READING";
  if (presentationTimeMs < slot.settledAtMs) return "SETTLING";
  if (presentationTimeMs < slot.readingUntilMs) return "STABILIZING";
  if (presentationTimeMs < slot.slotEndMs) return "RESTING";
  return "PRESENTED";
}

/**
 * True while this receipt owns the viewer's attention: it has landed and its
 * reading hold and settlement are not both over. At most one receipt of a run
 * can be true here at any presentation moment — that is the invariant the
 * whole checkpoint is built to hold, and C-R1-T01 proves it over the run.
 */
export function ownsAttention(slot: PresentationSlot, presentationTimeMs: number): boolean {
  return presentationTimeMs >= slot.landingMs && presentationTimeMs < slot.ownedUntilMs;
}

/**
 * Every canonical instant of the deterministic run at which more than one
 * nano-receipt is recorded, from the engine's own tables. These are the groups
 * the queue must serialise, and the measurement names each one.
 */
export function sameInstantGroups(): readonly Readonly<{ timeMs: number; eventIds: readonly string[] }>[] {
  const byInstant = new Map<number, string[]>();
  for (const spec of MISSION_EVIDENCE_SPECS) {
    const time = specTime(spec);
    byInstant.set(time, [...(byInstant.get(time) ?? []), spec.eventId]);
  }
  for (const event of MASTER_EVIDENCE_EVENTS) {
    byInstant.set(event.time_ms, [...(byInstant.get(event.time_ms) ?? []), event.event_id]);
  }
  return Object.freeze(
    [...byInstant.entries()]
      .filter(([, ids]) => ids.length > 1)
      .sort((left, right) => left[0] - right[0])
      .map(([timeMs, eventIds]) => Object.freeze({ timeMs, eventIds: Object.freeze([...eventIds]) })),
  );
}

/**
 * The canonical moments of the deterministic run, each with the receipts
 * recorded at it and the presentation time its arrivals need. The pacing model
 * reads this to reserve room: an instant that carries two receipts must be
 * given the presentation time to show both, one at a time, before the next
 * instant's evidence is due. Nothing here reads or writes a clock.
 */
export function canonicalMoments(): readonly Readonly<{
  masterMs: number;
  count: number;
  reservedMs: number;
  /** The strongest class among the receipts recorded at this instant. */
  pacing: PacingClass;
  episode: EvidenceEpisode;
}>[] {
  const byInstant = new Map<number, QueueableEvidence[]>();
  const add = (entry: QueueableEvidence) => byInstant.set(entry.timeMs, [...(byInstant.get(entry.timeMs) ?? []), entry]);
  for (const spec of MISSION_EVIDENCE_SPECS) {
    add({
      evidenceId: spec.eventId,
      timeMs: specTime(spec),
      eventId: spec.eventId,
      eventType: spec.eventType,
      source: "RUNTIME_JOURNAL",
      episode: episodeOf(spec.eventId, spec.eventType),
    });
  }
  for (const event of MASTER_EVIDENCE_EVENTS) {
    add({
      evidenceId: event.event_id,
      timeMs: event.time_ms,
      eventId: event.event_id,
      eventType: "SIGNED_CANONICAL",
      source: "SIGNED_CANONICAL",
      episode: episodeOf(event.event_id, "SIGNED_CANONICAL"),
    });
  }
  return Object.freeze(
    [...byInstant.entries()]
      .sort((left, right) => left[0] - right[0])
      .map(([masterMs, entries]) => {
        const classes = entries.map((entry) => pacingClassOf(entry, { opensChapter: false, critical: false }));
        // What the instant costs a viewer: every receipt at it must own the
        // screen for its own class's floor, one after another.
        const reservedMs = classes.reduce((total, pacing) => total + minimumArrivalGapMs(pacing), 0);
        const rank: Record<PacingClass, number> = { ORDINARY: 0, IMPORTANT: 1, CHAPTER: 2, CRITICAL: 3 };
        return Object.freeze({
          masterMs,
          count: entries.length,
          reservedMs,
          pacing: classes.reduce((strongest, pacing) => (rank[pacing] > rank[strongest] ? pacing : strongest), "ORDINARY" as PacingClass),
          episode: entries.find((entry) => entry.episode !== "other")?.episode ?? "other",
        });
      }),
  );
}

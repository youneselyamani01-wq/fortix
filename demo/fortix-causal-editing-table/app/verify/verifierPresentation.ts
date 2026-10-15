import { buildVerifierPath, parseVerifierUrl, type VerifierViewRoute } from "./verifierRoutes.ts";

export type VerifierScroll = Readonly<{ x: number; y: number }>;
export type VerifierUISnapshot = Readonly<{
  scroll: VerifierScroll;
  graphScale: number;
  graphScroll: VerifierScroll;
  timelineScroll: VerifierScroll;
  inspectorScroll: VerifierScroll;
  expandedPanels: readonly string[];
  searchQuery: string;
  nanoReceiptQuery: string;
  focusMode: boolean;
  graphEmphasis: "path" | "isolate" | "follow" | "all";
  graphHighlightedFamily: string | null;
}>;
export type VerifierPresentationProps = Readonly<{
  uiState?: VerifierUISnapshot;
  onUIStateChange?: (patch: Partial<VerifierUISnapshot>) => void;
  restoreToken?: string;
  navigationIntent?: "new" | "restore";
}>;
export type VerifierStoryBookmark = Readonly<{ entryId: string; path: string; storyEventId: string }>;
export type VerifierContextBookmark = Readonly<{ entryId: string; path: string }>;
export type VerifierPresentationEntry = Readonly<{
  version: 1;
  entryId: string;
  index: number;
  path: string;
  storyBookmark: VerifierStoryBookmark | null;
  contextBookmark: VerifierContextBookmark | null;
  uiSnapshot: VerifierUISnapshot;
}>;
export const VERIFIER_PRESENTATION_STATE_KEY = "fortixVerifierPresentation";
export const VERIFIER_PRESENTATION_STORAGE_KEY = "fortix-verifier-presentation-v1";
export const VERIFIER_PRESENTATION_MAX_ENTRIES = 128;
export const DEFAULT_VERIFIER_UI: VerifierUISnapshot = Object.freeze({
  scroll: Object.freeze({ x: 0, y: 0 }), graphScale: 100,
  graphScroll: Object.freeze({ x: 0, y: 0 }), expandedPanels: Object.freeze([]),
  timelineScroll: Object.freeze({ x: 0, y: 0 }), inspectorScroll: Object.freeze({ x: 0, y: 0 }),
  searchQuery: "", nanoReceiptQuery: "", focusMode: false, graphEmphasis: "path", graphHighlightedFamily: null,
});

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
function point(value: unknown): VerifierScroll | null {
  const data = record(value);
  return data && exactKeys(data, ["x", "y"]) && [data.x, data.y].every(n => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 10_000_000)
    ? Object.freeze({ x: data.x as number, y: data.y as number }) : null;
}
function boundedString(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length <= max && ![...value].some(character => character.charCodeAt(0) <= 31 || character.charCodeAt(0) === 127);
}
function identifier(value: unknown): value is string {
  return boundedString(value, 1024) && value.length > 0 && value.trim() === value;
}
export function readVerifierUISnapshot(value: unknown): VerifierUISnapshot | null {
  const data = record(value);
  if (!data) return null;
  const keys = Object.keys(DEFAULT_VERIFIER_UI);
  const optionalKeys = ["graphHighlightedFamily", "timelineScroll", "inspectorScroll"];
  if (!Object.keys(data).every(key => keys.includes(key)) || !keys.filter(key => !optionalKeys.includes(key)).every(key => Object.hasOwn(data, key))) return null;
  const graphHighlightedFamily = Object.hasOwn(data, "graphHighlightedFamily") ? data.graphHighlightedFamily : null;
  const scroll = point(data.scroll); const graphScroll = point(data.graphScroll);
  const timelineScroll = point(Object.hasOwn(data, "timelineScroll") ? data.timelineScroll : DEFAULT_VERIFIER_UI.timelineScroll);
  const inspectorScroll = point(Object.hasOwn(data, "inspectorScroll") ? data.inspectorScroll : DEFAULT_VERIFIER_UI.inspectorScroll);
  if (!scroll || !graphScroll || !timelineScroll || !inspectorScroll || typeof data.graphScale !== "number" || !Number.isFinite(data.graphScale) || data.graphScale < 20 || data.graphScale > 150
    || !Array.isArray(data.expandedPanels) || data.expandedPanels.length > 128 || !data.expandedPanels.every(key => identifier(key))
    || new Set(data.expandedPanels).size !== data.expandedPanels.length
    || !boundedString(data.searchQuery, 2048) || !boundedString(data.nanoReceiptQuery, 2048)
    || typeof data.focusMode !== "boolean" || !["path", "isolate", "follow", "all"].includes(data.graphEmphasis as string)
    || !(graphHighlightedFamily === null || identifier(graphHighlightedFamily))) return null;
  return Object.freeze({ scroll, graphScale: data.graphScale, graphScroll, timelineScroll, inspectorScroll,
    expandedPanels: Object.freeze([...data.expandedPanels] as string[]), searchQuery: data.searchQuery,
    nanoReceiptQuery: data.nanoReceiptQuery, focusMode: data.focusMode, graphEmphasis: data.graphEmphasis as VerifierUISnapshot["graphEmphasis"],
    graphHighlightedFamily: graphHighlightedFamily as string | null });
}
export function patchVerifierUISnapshot(current: VerifierUISnapshot, patch: Partial<VerifierUISnapshot>): VerifierUISnapshot {
  const next = readVerifierUISnapshot({ ...current, ...patch });
  if (!next) throw new TypeError("Invalid Verifier presentation snapshot");
  return next;
}
export function verifierExpandedPanels(current: readonly string[], key: string, open: boolean): readonly string[] {
  return open ? [...new Set([...current, key])] : current.filter(candidate => candidate !== key);
}
function initialViewUI(route: VerifierViewRoute, previous = DEFAULT_VERIFIER_UI): VerifierUISnapshot {
  return route.view === "domains" && route.domainId
    ? patchVerifierUISnapshot(previous, { expandedPanels: verifierExpandedPanels(previous.expandedPanels, `domains:facts:${route.domainId}`, true) })
    : previous;
}
function viewRoute(path: unknown): VerifierViewRoute | null {
  if (!boundedString(path, 16_384)) return null;
  const parsed = parseVerifierUrl(path);
  return parsed.ok && parsed.route.kind === "view" && parsed.route.canonicalPath === path ? parsed.route : null;
}
export function verifierStoryReturnPath(route: VerifierViewRoute): string | null {
  const storyEventId = route.storyEventId ?? route.eventId;
  return storyEventId ? buildVerifierPath({ pebDigest: route.pebDigest, missionId: route.missionId, storyEventId,
    view: "path", eventId: storyEventId }) : null;
}
export function readVerifierPresentationEntry(value: unknown, path?: string): VerifierPresentationEntry | null {
  const data = record(value);
  if (!data || !(exactKeys(data, ["version", "entryId", "index", "path", "storyBookmark", "contextBookmark", "uiSnapshot"])
    || exactKeys(data, ["version", "entryId", "index", "path", "storyBookmark", "uiSnapshot"]))
    || data.version !== 1 || !identifier(data.entryId) || typeof data.index !== "number" || !Number.isSafeInteger(data.index) || data.index < 0) return null;
  const route = viewRoute(data.path); const uiSnapshot = readVerifierUISnapshot(data.uiSnapshot);
  if (!route || !uiSnapshot || (path !== undefined && path !== route.canonicalPath)) return null;
  let storyBookmark: VerifierStoryBookmark | null = null;
  if (data.storyBookmark !== null) {
    const bookmark = record(data.storyBookmark); const reader = viewRoute(bookmark?.path);
    if (!bookmark || !exactKeys(bookmark, ["entryId", "path", "storyEventId"]) || !identifier(bookmark.entryId)
      || !identifier(bookmark.storyEventId) || !reader || reader.pebDigest !== route.pebDigest
      || !["path", "event", "timeline"].includes(reader.view) || reader.eventId !== bookmark.storyEventId
      || (reader.storyEventId !== null && reader.storyEventId !== bookmark.storyEventId)
      || (route.storyEventId ?? route.eventId) !== bookmark.storyEventId) return null;
    storyBookmark = Object.freeze({ entryId: bookmark.entryId, path: reader.canonicalPath, storyEventId: bookmark.storyEventId });
  }
  let contextBookmark: VerifierContextBookmark | null = null;
  if (data.contextBookmark !== undefined && data.contextBookmark !== null) {
    const bookmark = record(data.contextBookmark); const origin = viewRoute(bookmark?.path);
    if (!bookmark || !exactKeys(bookmark, ["entryId", "path"]) || !identifier(bookmark.entryId) || !origin
      || origin.pebDigest !== route.pebDigest || origin.missionId !== route.missionId
      || origin.view !== "graph" || origin.boundaryKey || origin.relationKey
      || origin.storyEventId !== route.storyEventId) return null;
    contextBookmark = Object.freeze({ entryId: bookmark.entryId, path: origin.canonicalPath });
  }
  return Object.freeze({ version: 1, entryId: data.entryId, index: data.index, path: route.canonicalPath, storyBookmark, contextBookmark, uiSnapshot });
}

export interface VerifierHistoryPort {
  readonly state: unknown;
  replaceState(state: unknown, unused: string, url?: string): void;
  pushState(state: unknown, unused: string, url?: string): void;
}
export interface VerifierPresentationStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }

/** The ledger records browser entries and their UI only. It never owns a route stack
 * and never stores received bytes, evidence payloads, or verification results. */
export class VerifierPresentationHistory {
  readonly #history: VerifierHistoryPort;
  readonly #storage: VerifierPresentationStorage | null;
  readonly #makeId: () => string;
  #entries: VerifierPresentationEntry[] = [];
  #current: VerifierPresentationEntry | null = null;
  constructor(history: VerifierHistoryPort, storage: VerifierPresentationStorage | null = null, makeId: () => string = () => globalThis.crypto.randomUUID()) {
    this.#history = history; this.#storage = storage; this.#makeId = makeId;
    try {
      const stored: unknown = JSON.parse(storage?.getItem(VERIFIER_PRESENTATION_STORAGE_KEY) ?? "null");
      if (Array.isArray(stored) && stored.length <= VERIFIER_PRESENTATION_MAX_ENTRIES) {
        const entries = stored.map(value => readVerifierPresentationEntry(value));
        if (entries.every((entry): entry is VerifierPresentationEntry => entry !== null)
          && new Set(entries.map(entry => entry.entryId)).size === entries.length
          && new Set(entries.map(entry => entry.index)).size === entries.length) this.#entries = entries.sort((a, b) => a.index - b.index);
      }
    } catch { /* Browser state still restores if storage is unavailable. */ }
  }
  get current(): VerifierPresentationEntry | null { return this.#current; }
  get canBack(): boolean { return this.#entries.some(entry => entry.index === (this.#current?.index ?? 0) - 1); }
  get canForward(): boolean { return this.#entries.some(entry => entry.index === (this.#current?.index ?? -2) + 1); }
  initialize(path: string): VerifierPresentationEntry {
    return this.restore(path);
  }
  restore(path: string): VerifierPresentationEntry {
    const fromState = readVerifierPresentationEntry(record(this.#history.state)?.[VERIFIER_PRESENTATION_STATE_KEY], path);
    if (fromState) {
      const saved = this.#entries.find(entry => entry.entryId === fromState.entryId && entry.path === path);
      this.#current = saved ?? fromState;
    } else {
      const route = viewRoute(path);
      if (!route) throw new TypeError("Presentation history requires a canonical Verifier view");
      this.#entries = [];
      this.#current = Object.freeze({ version: 1, entryId: this.#makeId(), index: 0, path, storyBookmark: null, contextBookmark: null, uiSnapshot: initialViewUI(route) });
    }
    this.#remember(); this.#write("replace", this.#history.state);
    return this.#current;
  }
  update(patch: Partial<VerifierUISnapshot>): VerifierPresentationEntry {
    if (!this.#current) throw new TypeError("Presentation history is not initialized");
    this.#current = Object.freeze({ ...this.#current, uiSnapshot: patchVerifierUISnapshot(this.#current.uiSnapshot, patch) });
    this.#remember();
    const live = readVerifierPresentationEntry(record(this.#history.state)?.[VERIFIER_PRESENTATION_STATE_KEY]);
    if (live?.entryId === this.#current.entryId) this.#write("replace", this.#history.state);
    return this.#current;
  }
  push(path: string, historyState: unknown = this.#history.state): VerifierPresentationEntry {
    const target = viewRoute(path); const current = this.#current;
    if (!target || !current) throw new TypeError("Presentation history is not initialized for a canonical view");
    const source = viewRoute(current.path)!;
    const origin = target.storyEventId ?? target.eventId;
    const reading = ["path", "event", "timeline"];
    let bookmark = current.storyBookmark;
    if (!origin || target.pebDigest !== source.pebDigest || bookmark?.storyEventId !== origin) bookmark = null;
    if (reading.includes(target.view)) bookmark = null;
    else if (!bookmark && origin && reading.includes(source.view) && (source.storyEventId ?? source.eventId) === origin && source.eventId === origin) {
      bookmark = Object.freeze({ entryId: current.entryId, path: current.path, storyEventId: origin });
    }
    let contextBookmark = current.contextBookmark;
    if (target.pebDigest !== source.pebDigest || target.missionId !== source.missionId
      || source.storyEventId !== target.storyEventId) contextBookmark = null;
    const contextualDepth = ["nanoreceipts", "forensic"].includes(target.view) || !!target.boundaryKey || !!target.relationKey;
    if (!contextualDepth) contextBookmark = null;
    else if (!contextBookmark && source.view === "graph" && !source.boundaryKey && !source.relationKey) {
      contextBookmark = Object.freeze({ entryId: current.entryId, path: current.path });
    }
    this.#entries = this.#entries.filter(entry => entry.index <= current.index);
    this.#current = Object.freeze({ version: 1, entryId: this.#makeId(), index: current.index + 1, path,
      storyBookmark: bookmark, contextBookmark, uiSnapshot: initialViewUI(target, patchVerifierUISnapshot(current.uiSnapshot, { scroll: source.view === target.view ? current.uiSnapshot.scroll : { x: 0, y: 0 } })) });
    this.#remember(); this.#write("push", historyState);
    return this.#current;
  }
  replace(path: string, historyState: unknown = this.#history.state): VerifierPresentationEntry {
    if (!this.#current || !viewRoute(path)) throw new TypeError("Presentation history requires a canonical view");
    const target = viewRoute(path)!;
    const bookmark = this.#current.storyBookmark;
    const contextBookmark = this.#current.contextBookmark;
    const contextRoute = contextBookmark ? viewRoute(contextBookmark.path) : null;
    this.#current = Object.freeze({ ...this.#current, path,
      storyBookmark: bookmark?.storyEventId === (target.storyEventId ?? target.eventId) ? bookmark : null,
      contextBookmark: contextRoute?.pebDigest === target.pebDigest && contextRoute.missionId === target.missionId
        && contextRoute.storyEventId === target.storyEventId
        && (["nanoreceipts", "forensic"].includes(target.view) || !!target.boundaryKey || !!target.relationKey) ? contextBookmark : null });
    this.#remember(); this.#write("replace", historyState);
    return this.#current;
  }
  storyReturnDelta(): number | null {
    const current = this.#current; const bookmark = current?.storyBookmark;
    const source = bookmark ? this.#entries.find(entry => entry.entryId === bookmark.entryId && entry.path === bookmark.path) : null;
    return current && source ? source.index - current.index : null;
  }
  contextReturnDelta(): number | null {
    const current = this.#current; const bookmark = current?.contextBookmark;
    const source = bookmark ? this.#entries.find(entry => entry.entryId === bookmark.entryId && entry.path === bookmark.path) : null;
    return current && source ? source.index - current.index : null;
  }
  #remember(): void {
    if (!this.#current) return;
    this.#entries = [...this.#entries.filter(entry => entry.entryId !== this.#current!.entryId), this.#current].sort((a, b) => a.index - b.index);
    // Keep a contiguous window around the active entry, including its forward branch.
    const position = this.#entries.findIndex(entry => entry.entryId === this.#current!.entryId);
    const start = Math.max(0, Math.min(position - Math.floor(VERIFIER_PRESENTATION_MAX_ENTRIES / 2), this.#entries.length - VERIFIER_PRESENTATION_MAX_ENTRIES));
    this.#entries = this.#entries.slice(start, start + VERIFIER_PRESENTATION_MAX_ENTRIES);
    try { this.#storage?.setItem(VERIFIER_PRESENTATION_STORAGE_KEY, JSON.stringify(this.#entries)); } catch { /* Memory and history state remain usable. */ }
  }
  #write(kind: "push" | "replace", base: unknown): void {
    const next = { ...(record(base) ?? {}), [VERIFIER_PRESENTATION_STATE_KEY]: this.#current };
    if (kind === "push") this.#history.pushState(next, "", this.#current!.path);
    else this.#history.replaceState(next, "", this.#current!.path);
  }
}

import {
  buildVerifierPath,
  parseVerifierUrl,
  type VerifierRoute,
  type VerifierRouteTarget,
  type VerifierView,
  type VerifierViewRoute,
} from "./verifierRoutes.ts";
import { resolveReceivedEvidenceSelection, type ReceivedEvidenceCatalog, type ReceivedEvidenceCatalogEntry, type ReceivedEvidenceResolution } from "./receivedEvidenceCatalog.ts";
import type { EvidenceSelection } from "./guidedInspection.ts";

export type VerifierStoryContext = Readonly<{
  status: ReceivedEvidenceResolution["status"] | "ABSENT" | "OUTSIDE_STORY";
  eventId: string | null;
  entry: ReceivedEvidenceCatalogEntry | null;
  explicit: boolean;
}>;

/** A proof target is not automatically a reading origin. Legacy depth-view
 * links may identify a received dossier/support item without any story cursor.
 * Explicit origins always resolve strictly, in every view. */
export function resolveVerifierStoryContext(catalog: ReceivedEvidenceCatalog, route: Pick<VerifierViewRoute, "view" | "eventId" | "storyEventId">): VerifierStoryContext {
  const explicit = route.storyEventId !== null;
  const eventId = route.storyEventId ?? route.eventId;
  const absent = (): VerifierStoryContext => Object.freeze({ status: "ABSENT", eventId: null, entry: null, explicit });
  if (eventId === null) return absent();
  const resolution = resolveReceivedEvidenceSelection(catalog, { eventId });
  if (resolution.status !== "RESOLVED") return Object.freeze({ status: resolution.status, eventId, entry: null, explicit });
  if (resolution.entry?.timelinePosition === null) {
    if (!explicit && ["domains", "graph", "nanoreceipts", "forensic"].includes(route.view)) return absent();
    return Object.freeze({ status: "OUTSIDE_STORY", eventId, entry: resolution.entry, explicit });
  }
  return Object.freeze({ status: "RESOLVED", eventId, entry: resolution.entry, explicit });
}

/** A direct contextual return clears only depth. A received reading origin owns
 * the event and domain; a support selection with no origin remains explicit. */
export function verifierContextReturnPath(route: VerifierViewRoute, catalog: ReceivedEvidenceCatalog): string {
  const origin = resolveVerifierStoryContext(catalog, route);
  const entry = origin.status === "RESOLVED" ? origin.entry : null;
  return buildVerifierPath({ ...routeTarget(route, "graph"),
    eventId: entry ? entry.eventId : route.eventId,
    nanoReceiptId: entry ? entry.nanoReceiptId : route.nanoReceiptId,
    domainId: entry ? entry.domainId : route.domainId,
    storyEventId: origin.eventId,
    relationKey: null, boundaryKey: null,
    family: entry ? entry.family : route.family });
}

/** Event identity is selected exactly. Only a narrative event can move the
 * reading cursor; inspecting a support item cannot manufacture a story fact. */
export function verifierStoryOriginForEntry(entry: ReceivedEvidenceCatalogEntry, currentOrigin: string | null): string | null {
  return entry.timelinePosition !== null && entry.eventId !== null ? entry.eventId : currentOrigin;
}

/** Inside one inspection, only choosing a fact advances the story. A boundary
 * or relation is an excursion: the timeline keeps the fact the reader came from. */
export function storyKeyAfter(previous: string | null, selection: EvidenceSelection): string | null {
  return selection.kind === "event" ? selection.nodeKey : previous;
}

/** A reading origin supplied by the route wins; otherwise the locally kept story fact does. */
export function timelineReadingKey(provided: string | null | undefined, selection: EvidenceSelection, storyKey: string | null): string | null | undefined {
  if (provided !== undefined) return provided;
  if (selection.kind === "none") return null;
  return storyKey ?? undefined;
}

export const VERIFIER_NAVIGATION_STATE_KEY = "fortixVerifierNavigation" as const;
export const VERIFIER_NAVIGATION_STATE_VERSION = 1 as const;
export const VERIFIER_NAVIGATION_MAX_DEPTH = 32;
export const VERIFIER_NAVIGATION_MAX_PATH_LENGTH = 16_384;

export type VerifierNavigationHistoryEntry = Readonly<{
  version: typeof VERIFIER_NAVIGATION_STATE_VERSION;
  entryPath: string;
  parentPath: string;
  depth: number;
}>;

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function exactKeys(value: UnknownRecord, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && keys.every((key) => expected.includes(key));
}

function canonicalRoute(path: unknown): VerifierRoute | null {
  if (typeof path !== "string" || path.length === 0 || path.length > VERIFIER_NAVIGATION_MAX_PATH_LENGTH) return null;
  const parsed = parseVerifierUrl(path);
  if (!parsed.ok || parsed.route.canonicalPath !== path) return null;
  return parsed.route;
}

function routesCanFormParent(parent: VerifierRoute, entry: VerifierRoute): boolean {
  if (parent.canonicalPath === entry.canonicalPath) return false;
  if (parent.kind === "view" && entry.kind === "view") return parent.pebDigest === entry.pebDigest;
  return parent.kind !== entry.kind;
}

/** Read only provenance created for this exact canonical history entry. */
export function readVerifierNavigationHistoryEntry(
  historyState: unknown,
  currentPath: string,
): VerifierNavigationHistoryEntry | null {
  const state = record(historyState);
  const candidate = record(state?.[VERIFIER_NAVIGATION_STATE_KEY]);
  if (!candidate || !exactKeys(candidate, ["version", "entryPath", "parentPath", "depth"])) return null;
  if (candidate.version !== VERIFIER_NAVIGATION_STATE_VERSION
    || typeof candidate.depth !== "number"
    || !Number.isSafeInteger(candidate.depth)
    || candidate.depth < 1
    || candidate.depth > VERIFIER_NAVIGATION_MAX_DEPTH) return null;
  const current = canonicalRoute(currentPath);
  const entry = canonicalRoute(candidate.entryPath);
  const parent = canonicalRoute(candidate.parentPath);
  if (!current || !entry || !parent || entry.canonicalPath !== current.canonicalPath
    || !routesCanFormParent(parent, entry)) return null;
  return Object.freeze({
    version: VERIFIER_NAVIGATION_STATE_VERSION,
    entryPath: entry.canonicalPath,
    parentPath: parent.canonicalPath,
    depth: candidate.depth,
  });
}

/** Preserve framework-owned history fields while installing bounded local provenance. */
export function createVerifierNavigationHistoryState(
  historyState: unknown,
  parentPath: string,
  entryPath: string,
): UnknownRecord {
  const parent = canonicalRoute(parentPath);
  const entry = canonicalRoute(entryPath);
  if (!parent || !entry || !routesCanFormParent(parent, entry)) {
    throw new TypeError("Verifier navigation provenance requires two compatible canonical routes");
  }
  const parentEntry = readVerifierNavigationHistoryEntry(historyState, parent.canonicalPath);
  const depth = Math.min((parentEntry?.depth ?? 0) + 1, VERIFIER_NAVIGATION_MAX_DEPTH);
  return {
    ...(record(historyState) ?? {}),
    [VERIFIER_NAVIGATION_STATE_KEY]: Object.freeze({
      version: VERIFIER_NAVIGATION_STATE_VERSION,
      entryPath: entry.canonicalPath,
      parentPath: parent.canonicalPath,
      depth,
    }),
  };
}

/** Canonical and remote replacements must not inherit a parent for another URL. */
export function clearVerifierNavigationHistoryState(historyState: unknown): unknown {
  const state = record(historyState);
  if (!state || !Object.prototype.hasOwnProperty.call(state, VERIFIER_NAVIGATION_STATE_KEY)) return historyState;
  const next = { ...state };
  delete next[VERIFIER_NAVIGATION_STATE_KEY];
  return next;
}

/** Retarget an in-view setting change while keeping the same user-visible parent. */
export function retargetVerifierNavigationHistoryState(
  historyState: unknown,
  currentPath: string,
  nextPath: string,
): unknown {
  const provenance = readVerifierNavigationHistoryEntry(historyState, currentPath);
  const current = canonicalRoute(currentPath);
  const next = canonicalRoute(nextPath);
  const parent = provenance ? canonicalRoute(provenance.parentPath) : null;
  if (!provenance || !current || !next || !parent) return clearVerifierNavigationHistoryState(historyState);
  if (current.kind !== "view" || next.kind !== "view"
    || current.pebDigest !== next.pebDigest
    || current.view !== next.view
    || !routesCanFormParent(parent, next)) {
    throw new TypeError("Verifier navigation retargeting requires the same PEB view");
  }
  return {
    ...(record(historyState) ?? {}),
    [VERIFIER_NAVIGATION_STATE_KEY]: Object.freeze({
      ...provenance,
      entryPath: next.canonicalPath,
    }),
  };
}

function routeTarget(
  route: VerifierViewRoute,
  view: VerifierView,
  overrides: Partial<VerifierRouteTarget> = {},
): VerifierRouteTarget {
  return {
    pebDigest: route.pebDigest,
    view,
    missionId: route.missionId,
    storyEventId: route.storyEventId,
    eventId: route.eventId,
    nanoReceiptId: route.nanoReceiptId,
    domainId: route.domainId,
    graphMode: route.graphMode,
    relationKey: route.relationKey,
    boundaryKey: route.boundaryKey,
    family: route.family,
    followToFinal: route.followToFinal,
    ...overrides,
  };
}

/** A truthful parent for direct links and new tabs that have no local history provenance. */
export function deterministicVerifierParentPath(route: VerifierViewRoute): string {
  const path = (view: VerifierView, overrides: Partial<VerifierRouteTarget> = {}) => (
    buildVerifierPath(routeTarget(route, view, overrides))
  );
  const clearNode = { eventId: null, nanoReceiptId: null, relationKey: null, boundaryKey: null, family: null } as const;
  const clearAll = { ...clearNode, domainId: null } as const;
  const originalStory = () => path("path", { ...clearAll, eventId: route.storyEventId });

  switch (route.view) {
    case "forensic":
      if (route.nanoReceiptId || route.eventId) return path("nanoreceipts");
      if (route.boundaryKey || route.domainId) return path("domains");
      return originalStory();
    case "nanoreceipts":
      if (route.boundaryKey) return path("domains");
      if (route.eventId) return path("event");
      if (route.domainId) return path("domains");
      return originalStory();
    case "graph":
      if (route.boundaryKey) return path("domains");
      if (route.eventId) return path("event");
      if (route.domainId) return path("domains");
      return originalStory();
    case "event":
      return path("path");
    case "domains":
      if (route.boundaryKey || route.relationKey || route.eventId || route.nanoReceiptId || route.family) {
        return path("domains", { ...clearNode, domainId: route.domainId });
      }
      return originalStory();
    case "timeline":
    case "network":
      return path("path");
    case "path":
      if (route.boundaryKey || route.relationKey) return path("path", { relationKey: null, boundaryKey: null });
      if (route.eventId || route.nanoReceiptId || route.domainId || route.family || route.storyEventId) return path("path", { ...clearAll, storyEventId: null });
      return path("verdict", { ...clearAll, storyEventId: null });
    case "verdict":
      return "/verify";
  }
}

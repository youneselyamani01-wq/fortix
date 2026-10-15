export const VERIFIER_INTAKE_PATH = "/verify" as const;
export const VERIFIER_ROUTE_VALUE_MAX_LENGTH = 1024;

export const VERIFIER_VIEWS = [
  "verdict",
  "path",
  "timeline",
  "domains",
  "network",
  "graph",
  "event",
  "nanoreceipts",
  "forensic",
] as const;

export type VerifierView = (typeof VERIFIER_VIEWS)[number];

/** One tab per question. The event view stays addressable (deep links, new
 * tabs, exact return) but is an inspection level, not a principal destination. */
export const VERIFIER_PRIMARY_VIEWS = VERIFIER_VIEWS.filter((view): view is Exclude<VerifierView, "event"> => view !== "event");

export const GRAPH_MODES = ["simplified", "causal", "follow", "expert"] as const;
export type GraphMode = (typeof GRAPH_MODES)[number];

export type SharedVerifierSelection = Readonly<{
  version: 2;
  pebDigest: string;
  missionId: string | null;
  view: VerifierView;
  eventId: string | null;
  storyEventId: string | null;
  nanoReceiptId: string | null;
  evidenceId: string | null;
  domainId: string | null;
  relationKey: string | null;
  boundaryKey: string | null;
  graphMode: GraphMode;
  family: string | null;
  followToFinal: boolean;
}>;

export type VerifierRouteTarget = Readonly<{
  pebDigest: string;
  view: VerifierView;
  missionId?: string | null;
  storyEventId?: string | null;
  eventId?: string | null;
  nanoReceiptId?: string | null;
  domainId?: string | null;
  relationKey?: string | null;
  boundaryKey?: string | null;
  graphMode?: GraphMode;
  family?: string | null;
  followToFinal?: boolean;
}>;

export type VerifierViewRoute = Readonly<{
  kind: "view";
  pebDigest: string;
  view: VerifierView;
  missionId: string | null;
  storyEventId: string | null;
  eventId: string | null;
  nanoReceiptId: string | null;
  domainId: string | null;
  relationKey: string | null;
  boundaryKey: string | null;
  graphMode: GraphMode;
  family: string | null;
  followToFinal: boolean;
  canonicalPath: string;
  isCanonical: boolean;
}>;

export type VerifierIntakeRoute = Readonly<{
  kind: "intake";
  canonicalPath: typeof VERIFIER_INTAKE_PATH;
  isCanonical: boolean;
}>;

export type VerifierRoute = VerifierIntakeRoute | VerifierViewRoute;

export type VerifierRouteErrorCode =
  | "INVALID_URL"
  | "UNSUPPORTED_ROUTE"
  | "INVALID_PEB_DIGEST"
  | "MISSING_EVENT_ID"
  | "DUPLICATE_EVENT_ID"
  | "UNKNOWN_QUERY_PARAMETER"
  | "DUPLICATE_QUERY_PARAMETER"
  | "INVALID_QUERY_VALUE"
  | "INVALID_GRAPH_MODE"
  | "INVALID_FOLLOW_TO_FINAL";

export class VerifierRouteError extends TypeError {
  readonly code: VerifierRouteErrorCode;

  constructor(code: VerifierRouteErrorCode, message: string) {
    super(message);
    this.name = "VerifierRouteError";
    this.code = code;
  }
}

export type VerifierRouteParseResult =
  | Readonly<{ ok: true; route: VerifierRoute }>
  | Readonly<{ ok: false; error: VerifierRouteError }>;

const QUERY_KEYS = [
  "mission",
  "storyEvent",
  "event",
  "nr",
  "domain",
  "mode",
  "relation",
  "boundary",
  "family",
  "toFinal",
] as const;
type QueryKey = (typeof QUERY_KEYS)[number];
const QUERY_KEY_SET = new Set<string>(QUERY_KEYS);
const VIEW_SET = new Set<string>(VERIFIER_VIEWS);
const GRAPH_MODE_SET = new Set<string>(GRAPH_MODES);
const DIGEST = /^[0-9a-f]{64}$/;
const SELECTION_KEYS = new Set([
  "version",
  "pebDigest",
  "missionId",
  "view",
  "eventId",
  "storyEventId",
  "nanoReceiptId",
  "evidenceId",
  "domainId",
  "relationKey",
  "boundaryKey",
  "graphMode",
  "family",
  "followToFinal",
]);

export function isVerifierPebDigest(value: unknown): value is string {
  return typeof value === "string" && DIGEST.test(value);
}

export function isVerifierView(value: unknown): value is VerifierView {
  return typeof value === "string" && VIEW_SET.has(value);
}

export function isGraphMode(value: unknown): value is GraphMode {
  return typeof value === "string" && GRAPH_MODE_SET.has(value);
}

/** A URL identifies presentation context; the received PEB owns mission identity. */
export function verifierMissionContextStatus(route: Pick<VerifierViewRoute, "missionId">, receivedMissionId: string | null): "UNSPECIFIED" | "MATCHED" | "CONTRADICTORY" {
  return route.missionId === null ? "UNSPECIFIED" : route.missionId === receivedMissionId ? "MATCHED" : "CONTRADICTORY";
}

/**
 * Parses semantic route state strictly. Non-canonical but unambiguous URLs are
 * accepted with `isCanonical: false` so callers can replace them with the
 * returned `canonicalPath`; duplicate, contradictory, or unknown claims fail.
 */
export function parseVerifierUrl(
  input: string | URL,
  base = "https://fortix.invalid",
): VerifierRouteParseResult {
  let url: URL;
  try {
    url = input instanceof URL ? new URL(input.href) : new URL(input, base);
  }
  catch {
    return failure("INVALID_URL", "Verifier URL is not parseable");
  }
  if (url.hash !== "") {
    return failure("INVALID_URL", "Verifier routes do not carry selection in a fragment");
  }
  if (url.pathname === VERIFIER_INTAKE_PATH) {
    if (url.search !== "") {
      return failure("UNSUPPORTED_ROUTE", "Verifier intake does not accept view parameters");
    }
    return { ok: true, route: { kind: "intake", canonicalPath: VERIFIER_INTAKE_PATH, isCanonical: true } };
  }

  const segments = rawPathSegments(url.pathname);
  if (segments === null || segments[0] !== "verify" || segments.length < 3) {
    return failure("UNSUPPORTED_ROUTE", "Verifier view route is not recognized");
  }
  const pebDigest = segments[1];
  if (!isVerifierPebDigest(pebDigest)) {
    return failure("INVALID_PEB_DIGEST", "PEB digest must be 64 lower-case hexadecimal characters");
  }

  let view: VerifierView;
  let pathEventId: string | null = null;
  if (segments[2] === "events") {
    if (segments.length !== 4) {
      return failure("MISSING_EVENT_ID", "An event route requires exactly one event identifier");
    }
    const decoded = decodePathValue(segments[3]);
    if (decoded === null) {
      return failure("INVALID_QUERY_VALUE", "Event identifier is invalid");
    }
    pathEventId = decoded;
    view = "event";
  }
  else {
    if (segments.length !== 3 || !isVerifierView(segments[2]) || segments[2] === "event") {
      return failure("UNSUPPORTED_ROUTE", "Verifier view route is not recognized");
    }
    view = segments[2];
  }

  for (const key of url.searchParams.keys()) {
    if (!QUERY_KEY_SET.has(key)) {
      return failure("UNKNOWN_QUERY_PARAMETER", `Unknown Verifier query parameter: ${key}`);
    }
  }
  for (const key of QUERY_KEYS) {
    if (url.searchParams.getAll(key).length > 1) {
      return failure("DUPLICATE_QUERY_PARAMETER", `Duplicate Verifier query parameter: ${key}`);
    }
  }
  if (pathEventId !== null && url.searchParams.has("event")) {
    return failure("DUPLICATE_EVENT_ID", "Event route cannot duplicate its event identifier in the query");
  }

  const missionId = queryIdentifier(url.searchParams, "mission");
  const storyEventId = queryIdentifier(url.searchParams, "storyEvent");
  const eventId = pathEventId ?? queryIdentifier(url.searchParams, "event");
  const nanoReceiptId = queryIdentifier(url.searchParams, "nr");
  const domainId = queryIdentifier(url.searchParams, "domain");
  const relationKey = queryIdentifier(url.searchParams, "relation");
  const boundaryKey = queryIdentifier(url.searchParams, "boundary");
  const family = queryIdentifier(url.searchParams, "family");
  if ([missionId, storyEventId, eventId, nanoReceiptId, domainId, relationKey, boundaryKey, family].includes(INVALID)) {
    return failure("INVALID_QUERY_VALUE", "Verifier identifiers must be non-empty and at most 1024 characters");
  }

  const rawMode = url.searchParams.get("mode");
  if (rawMode !== null && !isGraphMode(rawMode)) {
    return failure("INVALID_GRAPH_MODE", "Graph mode is not recognized");
  }
  const graphMode: GraphMode = rawMode ?? "simplified";
  const rawToFinal = url.searchParams.get("toFinal");
  if (rawToFinal !== null && rawToFinal !== "1") {
    return failure("INVALID_FOLLOW_TO_FINAL", "toFinal accepts only the value 1");
  }
  const followToFinal = rawToFinal === "1";
  if (followToFinal && graphMode !== "follow") {
    return failure("INVALID_FOLLOW_TO_FINAL", "toFinal is valid only in follow mode");
  }

  const target: VerifierRouteTarget = {
    pebDigest,
    view,
    missionId: missionId as string | null,
    storyEventId: storyEventId as string | null,
    eventId: eventId as string | null,
    nanoReceiptId: nanoReceiptId as string | null,
    domainId: domainId as string | null,
    relationKey: relationKey as string | null,
    boundaryKey: boundaryKey as string | null,
    graphMode,
    family: family as string | null,
    followToFinal,
  };
  let canonicalPath: string;
  try {
    canonicalPath = buildVerifierPath(target);
  }
  catch (error) {
    return {
      ok: false,
      error: error instanceof VerifierRouteError
        ? error
        : new VerifierRouteError("INVALID_URL", "Verifier route could not be normalized"),
    };
  }
  const currentPath = url.pathname + url.search;
  return {
    ok: true,
    route: {
      kind: "view",
      ...target,
      missionId: target.missionId ?? null,
      storyEventId: target.storyEventId ?? null,
      eventId: target.eventId ?? null,
      nanoReceiptId: target.nanoReceiptId ?? null,
      domainId: target.domainId ?? null,
      relationKey: target.relationKey ?? null,
      boundaryKey: target.boundaryKey ?? null,
      graphMode,
      family: target.family ?? null,
      followToFinal,
      canonicalPath,
      isCanonical: currentPath === canonicalPath,
    },
  };
}

export function buildVerifierPath(target: VerifierRouteTarget): string {
  if (!isVerifierPebDigest(target.pebDigest)) {
    throw new VerifierRouteError("INVALID_PEB_DIGEST", "PEB digest must be 64 lower-case hexadecimal characters");
  }
  if (!isVerifierView(target.view)) {
    throw new VerifierRouteError("UNSUPPORTED_ROUTE", "Verifier view is not recognized");
  }
  const missionId = optionalIdentifier(target.missionId, "mission");
  const storyEventId = optionalIdentifier(target.storyEventId, "storyEvent");
  const eventId = optionalIdentifier(target.eventId, "event");
  const nanoReceiptId = optionalIdentifier(target.nanoReceiptId, "nr");
  const domainId = optionalIdentifier(target.domainId, "domain");
  const relationKey = optionalIdentifier(target.relationKey, "relation");
  const boundaryKey = optionalIdentifier(target.boundaryKey, "boundary");
  const family = optionalIdentifier(target.family, "family");
  const graphMode = target.graphMode ?? "simplified";
  if (!isGraphMode(graphMode)) {
    throw new VerifierRouteError("INVALID_GRAPH_MODE", "Graph mode is not recognized");
  }
  const followToFinal = target.followToFinal ?? false;
  if (typeof followToFinal !== "boolean" || (followToFinal && graphMode !== "follow")) {
    throw new VerifierRouteError("INVALID_FOLLOW_TO_FINAL", "toFinal is valid only in follow mode");
  }

  let pathname = `${VERIFIER_INTAKE_PATH}/${target.pebDigest}`;
  if (target.view === "event") {
    if (eventId === null) {
      throw new VerifierRouteError("MISSING_EVENT_ID", "An event route requires an event identifier");
    }
    pathname += `/events/${encodeURIComponent(eventId)}`;
  }
  else {
    pathname += `/${target.view}`;
  }

  const query = new URLSearchParams();
  if (missionId !== null) query.set("mission", missionId);
  if (storyEventId !== null) query.set("storyEvent", storyEventId);
  if (target.view !== "event" && eventId !== null) query.set("event", eventId);
  if (nanoReceiptId !== null) query.set("nr", nanoReceiptId);
  if (domainId !== null) query.set("domain", domainId);
  if (graphMode !== "simplified") query.set("mode", graphMode);
  if (relationKey !== null) query.set("relation", relationKey);
  if (boundaryKey !== null) query.set("boundary", boundaryKey);
  if (family !== null) query.set("family", family);
  if (followToFinal) query.set("toFinal", "1");
  const search = query.toString();
  return search === "" ? pathname : `${pathname}?${search}`;
}

export function buildVerifierUrl(target: VerifierRouteTarget, base: string | URL): URL {
  return new URL(buildVerifierPath(target), base);
}

export function verifierRouteTarget(
  selection: SharedVerifierSelection,
  view: VerifierView = selection.view,
): VerifierRouteTarget {
  const valid = readSharedVerifierSelection(selection);
  if (valid === null) {
    throw new VerifierRouteError("INVALID_QUERY_VALUE", "Shared Verifier selection is invalid");
  }
  return {
    pebDigest: valid.pebDigest,
    view,
    missionId: valid.missionId,
    storyEventId: valid.storyEventId,
    eventId: valid.eventId,
    nanoReceiptId: valid.nanoReceiptId,
    domainId: valid.domainId,
    relationKey: valid.relationKey,
    boundaryKey: valid.boundaryKey,
    graphMode: valid.graphMode,
    family: valid.family,
    followToFinal: valid.followToFinal,
  };
}

export function verifierSelectionFromRoute(
  route: VerifierViewRoute,
  missionId: string | null,
  evidenceId: string | null = null,
): SharedVerifierSelection {
  const selection = readSharedVerifierSelection({
    version: 2,
    pebDigest: route.pebDigest,
    missionId,
    view: route.view,
    eventId: route.eventId,
    storyEventId: route.storyEventId ?? route.eventId,
    nanoReceiptId: route.nanoReceiptId,
    evidenceId,
    domainId: route.domainId,
    relationKey: route.relationKey,
    boundaryKey: route.boundaryKey,
    graphMode: route.graphMode,
    family: route.family,
    followToFinal: route.followToFinal,
  });
  if (selection === null) {
    throw new VerifierRouteError("INVALID_QUERY_VALUE", "Resolved Verifier selection is invalid");
  }
  return selection;
}

/** Runtime validator used at transport boundaries; it also strips prototypes. */
export function readSharedVerifierSelection(value: unknown): SharedVerifierSelection | null {
  const data = record(value);
  const legacyKeys = new Set([...SELECTION_KEYS].filter(key => key !== "storyEventId"));
  if (data === null || !hasExactKeys(data, data.version === 1 ? legacyKeys : SELECTION_KEYS)
    || (data.version !== 1 && data.version !== 2) || !isVerifierPebDigest(data.pebDigest)
    || !isVerifierView(data.view) || !isGraphMode(data.graphMode)
    || typeof data.followToFinal !== "boolean"
    || (data.followToFinal && data.graphMode !== "follow")) {
    return null;
  }
  const missionId = nullableIdentifier(data.missionId);
  const eventId = nullableIdentifier(data.eventId);
  const storyEventId = nullableIdentifier(data.version === 1 ? data.eventId : data.storyEventId);
  const nanoReceiptId = nullableIdentifier(data.nanoReceiptId);
  const evidenceId = nullableIdentifier(data.evidenceId);
  const domainId = nullableIdentifier(data.domainId);
  const relationKey = nullableIdentifier(data.relationKey);
  const boundaryKey = nullableIdentifier(data.boundaryKey);
  const family = nullableIdentifier(data.family);
  if ([missionId, storyEventId, eventId, nanoReceiptId, evidenceId, domainId, relationKey, boundaryKey, family].includes(INVALID)) {
    return null;
  }
  return Object.freeze({
    version: 2,
    pebDigest: data.pebDigest,
    missionId: missionId as string | null,
    view: data.view,
    eventId: eventId as string | null,
    storyEventId: storyEventId as string | null,
    nanoReceiptId: nanoReceiptId as string | null,
    evidenceId: evidenceId as string | null,
    domainId: domainId as string | null,
    relationKey: relationKey as string | null,
    boundaryKey: boundaryKey as string | null,
    graphMode: data.graphMode,
    family: family as string | null,
    followToFinal: data.followToFinal,
  });
}

function failure(code: VerifierRouteErrorCode, message: string): VerifierRouteParseResult {
  return { ok: false, error: new VerifierRouteError(code, message) };
}

const INVALID = Symbol("invalid-verifier-identifier");

function optionalIdentifier(value: unknown, key: QueryKey): string | null {
  if (value === undefined || value === null) return null;
  const valid = identifier(value);
  if (valid === null) {
    throw new VerifierRouteError("INVALID_QUERY_VALUE", `${key} must be non-empty and at most 1024 characters`);
  }
  return valid;
}

function nullableIdentifier(value: unknown): string | null | typeof INVALID {
  if (value === null) return null;
  return identifier(value) ?? INVALID;
}

function queryIdentifier(params: URLSearchParams, key: QueryKey): string | null | typeof INVALID {
  const value = params.get(key);
  if (value === null) return null;
  return identifier(value) ?? INVALID;
}

function identifier(value: unknown): string | null {
  return typeof value === "string"
    && value.length > 0
    && value.length <= VERIFIER_ROUTE_VALUE_MAX_LENGTH
    && value.trim() === value
    && !hasControlCharacters(value)
    ? value
    : null;
}

function hasControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

function decodePathValue(value: string): string | null {
  try {
    return identifier(decodeURIComponent(value));
  }
  catch {
    return null;
  }
}

function rawPathSegments(pathname: string): readonly string[] | null {
  if (!pathname.startsWith("/") || pathname.endsWith("/")) return null;
  const segments = pathname.slice(1).split("/");
  return segments.some((segment) => segment.length === 0) ? null : segments;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function hasExactKeys(data: Record<string, unknown>, expected: ReadonlySet<string>): boolean {
  const keys = Object.keys(data);
  return keys.length === expected.size && keys.every((key) => expected.has(key));
}

import {
  isVerifierPebDigest,
  isVerifierView,
  readSharedVerifierSelection,
  type SharedVerifierSelection,
  type VerifierView,
} from "./verifierRoutes.ts";

export const VERIFIER_SELECTION_CHANNEL_PREFIX = "fortix-verifier-selection-v1:";
export const VERIFIER_SELECTION_SYNC_VERSION = 1 as const;
export const VERIFIER_SELECTION_MAX_COUNTER = Number.MAX_SAFE_INTEGER - 1;

export type VerifierSelectionSyncMessage = Readonly<{
  version: typeof VERIFIER_SELECTION_SYNC_VERSION;
  digest: string;
  sender: string;
  counter: number;
  selection: SharedVerifierSelection;
}>;

export interface VerifierBroadcastChannel {
  postMessage(message: unknown): void;
  addEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
  close(): void;
}

export type VerifierBroadcastChannelFactory = (name: string) => VerifierBroadcastChannel;

export type VerifierSelectionSyncOptions = Readonly<{
  pebDigest: string;
  missionId: string | null;
  currentView: () => VerifierView;
  onRemoteSelection: (
    selection: SharedVerifierSelection,
    message: VerifierSelectionSyncMessage,
  ) => void;
  sender?: string;
  channelFactory?: VerifierBroadcastChannelFactory;
  initialCounter?: number;
}>;

export type VerifierSelectionSyncErrorCode =
  | "BROADCAST_UNAVAILABLE"
  | "INVALID_CONFIGURATION"
  | "INVALID_SELECTION"
  | "COUNTER_EXHAUSTED"
  | "SYNC_CLOSED";

export class VerifierSelectionSyncError extends Error {
  readonly code: VerifierSelectionSyncErrorCode;

  constructor(code: VerifierSelectionSyncErrorCode, message: string) {
    super(message);
    this.name = "VerifierSelectionSyncError";
    this.code = code;
  }
}

const MESSAGE_KEYS = new Set(["version", "digest", "sender", "counter", "selection"]);

/** The digest is part of the channel name and is still revalidated in every message. */
export function verifierSelectionChannelName(pebDigest: string): string {
  if (!isVerifierPebDigest(pebDigest)) {
    throw new VerifierSelectionSyncError("INVALID_CONFIGURATION", "Selection channel requires a valid PEB digest");
  }
  return `${VERIFIER_SELECTION_CHANNEL_PREFIX}${pebDigest}`;
}

/** The v1 envelope remains compatible; its closed selection reader normalizes
 * legacy selections and all publishers emit the v2 semantic selection. UI
 * snapshots and the local browser ledger never cross this transport. */
export function readVerifierSelectionSyncMessage(
  value: unknown,
  expectedDigest?: string,
): VerifierSelectionSyncMessage | null {
  const data = record(value);
  if (data === null || !hasExactKeys(data, MESSAGE_KEYS)
    || data.version !== VERIFIER_SELECTION_SYNC_VERSION
    || !isVerifierPebDigest(data.digest)
    || (expectedDigest !== undefined && data.digest !== expectedDigest)
    || !validSender(data.sender)
    || !validCounter(data.counter)) {
    return null;
  }
  const selection = readSharedVerifierSelection(data.selection);
  if (selection === null || selection.pebDigest !== data.digest) return null;
  return Object.freeze({
    version: VERIFIER_SELECTION_SYNC_VERSION,
    digest: data.digest,
    sender: data.sender,
    counter: data.counter,
    selection,
  });
}

export function compareVerifierSelectionClock(
  left: Readonly<{ counter: number; sender: string }>,
  right: Readonly<{ counter: number; sender: string }>,
): number {
  if (left.counter !== right.counter) return left.counter < right.counter ? -1 : 1;
  if (left.sender === right.sender) return 0;
  return left.sender < right.sender ? -1 : 1;
}

/**
 * One Lamport-clocked sync endpoint. Receiving never publishes, and the local
 * route keeps its own view while adopting the remote selection parameters.
 */
export class VerifierSelectionSync {
  readonly #pebDigest: string;
  readonly #missionId: string | null;
  readonly #sender: string;
  readonly #currentView: () => VerifierView;
  readonly #onRemoteSelection: VerifierSelectionSyncOptions["onRemoteSelection"];
  readonly #channel: VerifierBroadcastChannel;
  #counter: number;
  #lastClock: Readonly<{ counter: number; sender: string }>;
  #closed = false;

  constructor(options: VerifierSelectionSyncOptions) {
    if (!isVerifierPebDigest(options.pebDigest)
      || !(options.missionId === null || validIdentifier(options.missionId))
      || typeof options.currentView !== "function"
      || typeof options.onRemoteSelection !== "function") {
      throw new VerifierSelectionSyncError("INVALID_CONFIGURATION", "Selection sync configuration is invalid");
    }
    const sender = options.sender ?? randomSender();
    const initialCounter = options.initialCounter ?? 0;
    if (!validSender(sender) || !Number.isSafeInteger(initialCounter)
      || initialCounter < 0 || initialCounter > VERIFIER_SELECTION_MAX_COUNTER) {
      throw new VerifierSelectionSyncError("INVALID_CONFIGURATION", "Selection sync sender or counter is invalid");
    }
    const factory = options.channelFactory ?? defaultChannelFactory;
    let channel: VerifierBroadcastChannel;
    try {
      channel = factory(verifierSelectionChannelName(options.pebDigest));
    }
    catch (error) {
      throw new VerifierSelectionSyncError(
        "BROADCAST_UNAVAILABLE",
        error instanceof Error ? `BroadcastChannel is unavailable: ${error.message}` : "BroadcastChannel is unavailable",
      );
    }
    this.#pebDigest = options.pebDigest;
    this.#missionId = options.missionId;
    this.#sender = sender;
    this.#counter = initialCounter;
    this.#lastClock = Object.freeze({ counter: initialCounter, sender: "" });
    this.#currentView = options.currentView;
    this.#onRemoteSelection = options.onRemoteSelection;
    this.#channel = channel;
    channel.addEventListener("message", this.#receive);
  }

  get sender(): string {
    return this.#sender;
  }

  get counter(): number {
    return this.#counter;
  }

  publish(selectionValue: SharedVerifierSelection): VerifierSelectionSyncMessage {
    if (this.#closed) {
      throw new VerifierSelectionSyncError("SYNC_CLOSED", "Selection sync is closed");
    }
    const selection = readSharedVerifierSelection(selectionValue);
    if (selection === null || selection.pebDigest !== this.#pebDigest
      || selection.missionId !== this.#missionId) {
      throw new VerifierSelectionSyncError("INVALID_SELECTION", "Selection does not belong to this exact PEB and mission");
    }
    const nextCounter = Math.max(this.#counter, this.#lastClock.counter) + 1;
    if (nextCounter > VERIFIER_SELECTION_MAX_COUNTER) {
      throw new VerifierSelectionSyncError("COUNTER_EXHAUSTED", "Selection sync counter is exhausted");
    }
    const message = Object.freeze({
      version: VERIFIER_SELECTION_SYNC_VERSION,
      digest: this.#pebDigest,
      sender: this.#sender,
      counter: nextCounter,
      selection,
    });
    this.#channel.postMessage(message);
    this.#counter = nextCounter;
    this.#lastClock = Object.freeze({ counter: nextCounter, sender: this.#sender });
    return message;
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#channel.removeEventListener("message", this.#receive);
    this.#channel.close();
  }

  readonly #receive = (event: MessageEvent<unknown>): void => {
    if (this.#closed) return;
    const message = readVerifierSelectionSyncMessage(event.data, this.#pebDigest);
    if (message === null || message.sender === this.#sender
      || message.selection.missionId !== this.#missionId
      || compareVerifierSelectionClock(message, this.#lastClock) <= 0) {
      return;
    }
    const view = this.#currentView();
    if (!isVerifierView(view)) return;
    this.#counter = Math.max(this.#counter, message.counter);
    this.#lastClock = Object.freeze({ counter: message.counter, sender: message.sender });
    const localSelection = Object.freeze({ ...message.selection, view });
    // The callback updates history with replaceState. It is intentionally not
    // connected to publish(), which prevents receive/rebroadcast loops.
    this.#onRemoteSelection(localSelection, message);
  };
}

function defaultChannelFactory(name: string): VerifierBroadcastChannel {
  const Constructor = globalThis.BroadcastChannel;
  if (typeof Constructor !== "function") {
    throw new VerifierSelectionSyncError("BROADCAST_UNAVAILABLE", "BroadcastChannel is unavailable");
  }
  return new Constructor(name) as unknown as VerifierBroadcastChannel;
}

function randomSender(): string {
  const cryptoValue = globalThis.crypto;
  if (cryptoValue === undefined || typeof cryptoValue.getRandomValues !== "function") {
    throw new VerifierSelectionSyncError("BROADCAST_UNAVAILABLE", "A secure sender identifier cannot be generated");
  }
  const bytes = new Uint8Array(16);
  cryptoValue.getRandomValues(bytes);
  return `tab-${[...bytes].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function validSender(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 128
    && value.trim() === value
    && !hasControlCharacters(value);
}

function validIdentifier(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 1024
    && value.trim() === value
    && !hasControlCharacters(value);
}

function hasControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

function validCounter(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value)
    && value > 0 && value <= VERIFIER_SELECTION_MAX_COUNTER;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function hasExactKeys(value: Record<string, unknown>, expected: ReadonlySet<string>): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.size && keys.every((key) => expected.has(key));
}

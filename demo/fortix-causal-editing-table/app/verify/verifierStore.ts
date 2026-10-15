import { isVerifierPebDigest } from "./verifierRoutes.ts";

export const VERIFIER_PEB_MAX_BYTES = 20 * 1024 * 1024;
export const VERIFIER_PEB_DATABASE = "fortix-verifier-peb-v1";
export const VERIFIER_PEB_OBJECT_STORE = "pebs";

export type VerifierPebCacheEntry = Readonly<{
  digest: string;
  text: string;
  byteLength: number;
}>;

export type VerifierPebDigest = (text: string) => string;

/** Small boundary that lets tests exercise every integrity rule without a DOM. */
export interface VerifierPebStoreBackend {
  read(digest: string): Promise<unknown>;
  write(entry: VerifierPebCacheEntry): Promise<void>;
  remove(digest: string): Promise<void>;
  clear(): Promise<void>;
  close(): void;
}

export type VerifierPebStoreOptions = Readonly<{
  digestText: VerifierPebDigest;
  backend?: VerifierPebStoreBackend;
  indexedDB?: IDBFactory;
  databaseName?: string;
}>;

export type VerifierPebStoreErrorCode =
  | "INDEXEDDB_UNAVAILABLE"
  | "INDEXEDDB_FAILED"
  | "INVALID_DIGEST"
  | "INVALID_TEXT"
  | "PEB_TOO_LARGE"
  | "DIGEST_MISMATCH"
  | "STORE_CLOSED";

export class VerifierPebStoreError extends Error {
  readonly code: VerifierPebStoreErrorCode;

  constructor(code: VerifierPebStoreErrorCode, message: string) {
    super(message);
    this.name = "VerifierPebStoreError";
    this.code = code;
  }
}

/**
 * Exact PEB bytes cache. Its only persisted value is `{ digest, text,
 * byteLength }`; analysis state deliberately has no place in this schema.
 */
export class VerifierPebStore {
  readonly #digestText: VerifierPebDigest;
  readonly #backend: VerifierPebStoreBackend;
  #closed = false;

  constructor(options: VerifierPebStoreOptions) {
    if (typeof options.digestText !== "function") {
      throw new TypeError("VerifierPebStore requires the canonical PEB digest function");
    }
    this.#digestText = options.digestText;
    this.#backend = options.backend ?? new IndexedDbVerifierPebBackend(
      options.indexedDB ?? globalThis.indexedDB,
      options.databaseName ?? VERIFIER_PEB_DATABASE,
    );
  }

  async put(input: Readonly<{ digest: string; text: string }>): Promise<VerifierPebCacheEntry> {
    this.#assertOpen();
    const entry = this.#verifiedEntry(input.digest, input.text);
    await this.#backend.write(entry);
    return entry;
  }

  async get(digest: string): Promise<VerifierPebCacheEntry | null> {
    this.#assertOpen();
    requireDigest(digest);
    const stored = await this.#backend.read(digest);
    if (stored === undefined || stored === null) return null;
    const data = record(stored);
    if (data === null || !hasOnlyCacheKeys(data)
      || data.digest !== digest || typeof data.text !== "string"
      || typeof data.byteLength !== "number" || !Number.isSafeInteger(data.byteLength)) {
      await this.#backend.remove(digest);
      return null;
    }
    let entry: VerifierPebCacheEntry;
    try {
      entry = this.#verifiedEntry(data.digest, data.text);
    }
    catch {
      await this.#backend.remove(digest);
      return null;
    }
    if (entry.byteLength !== data.byteLength) {
      await this.#backend.remove(digest);
      return null;
    }
    return entry;
  }

  async remove(digest: string): Promise<void> {
    this.#assertOpen();
    requireDigest(digest);
    await this.#backend.remove(digest);
  }

  async clear(): Promise<void> {
    this.#assertOpen();
    await this.#backend.clear();
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#backend.close();
  }

  #verifiedEntry(digest: string, text: string): VerifierPebCacheEntry {
    requireDigest(digest);
    if (typeof text !== "string" || text.length === 0) {
      throw new VerifierPebStoreError("INVALID_TEXT", "PEB cache accepts non-empty text only");
    }
    // Every UTF-8 code point consumes at least one byte, so this cheap guard
    // avoids encoding an already impossible value.
    if (text.length > VERIFIER_PEB_MAX_BYTES) {
      throw new VerifierPebStoreError("PEB_TOO_LARGE", "PEB exceeds the 20 MiB local-cache limit");
    }
    const byteLength = new TextEncoder().encode(text).byteLength;
    if (byteLength > VERIFIER_PEB_MAX_BYTES) {
      throw new VerifierPebStoreError("PEB_TOO_LARGE", "PEB exceeds the 20 MiB local-cache limit");
    }
    let computed: string;
    try {
      computed = this.#digestText(text);
    }
    catch (error) {
      throw new VerifierPebStoreError(
        "DIGEST_MISMATCH",
        error instanceof Error ? `PEB digest could not be recomputed: ${error.message}` : "PEB digest could not be recomputed",
      );
    }
    if (!isVerifierPebDigest(computed) || computed !== digest) {
      throw new VerifierPebStoreError("DIGEST_MISMATCH", "Cached PEB bytes do not match their address digest");
    }
    return Object.freeze({ digest, text, byteLength });
  }

  #assertOpen(): void {
    if (this.#closed) {
      throw new VerifierPebStoreError("STORE_CLOSED", "PEB cache is closed");
    }
  }
}

export class IndexedDbVerifierPebBackend implements VerifierPebStoreBackend {
  readonly #factory: IDBFactory;
  readonly #databaseName: string;
  #database: Promise<IDBDatabase> | null = null;
  #closed = false;

  constructor(factory: IDBFactory | undefined, databaseName = VERIFIER_PEB_DATABASE) {
    if (factory === undefined) {
      throw new VerifierPebStoreError("INDEXEDDB_UNAVAILABLE", "IndexedDB is unavailable in this environment");
    }
    this.#factory = factory;
    this.#databaseName = databaseName;
  }

  async read(digest: string): Promise<unknown> {
    return this.#transaction("readonly", (store) => store.get(digest));
  }

  async write(entry: VerifierPebCacheEntry): Promise<void> {
    await this.#transaction("readwrite", (store) => store.put(entry));
  }

  async remove(digest: string): Promise<void> {
    await this.#transaction("readwrite", (store) => store.delete(digest));
  }

  async clear(): Promise<void> {
    await this.#transaction("readwrite", (store) => store.clear());
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    const pending = this.#database;
    this.#database = null;
    if (pending !== null) void pending.then((database) => database.close()).catch(() => {});
  }

  async #transaction<T>(
    mode: IDBTransactionMode,
    operation: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    if (this.#closed) {
      throw new VerifierPebStoreError("STORE_CLOSED", "PEB cache is closed");
    }
    const database = await this.#open();
    let transaction: IDBTransaction;
    let request: IDBRequest<T>;
    try {
      transaction = database.transaction(VERIFIER_PEB_OBJECT_STORE, mode);
      request = operation(transaction.objectStore(VERIFIER_PEB_OBJECT_STORE));
    }
    catch (error) {
      throw indexedDbError(error);
    }
    const completed = transactionCompletion(transaction);
    const [result] = await Promise.all([requestResult(request), completed]);
    return result;
  }

  #open(): Promise<IDBDatabase> {
    if (this.#database !== null) return this.#database;
    this.#database = new Promise<IDBDatabase>((resolve, reject) => {
      let request: IDBOpenDBRequest;
      try {
        request = this.#factory.open(this.#databaseName, 1);
      }
      catch (error) {
        reject(indexedDbError(error));
        return;
      }
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(VERIFIER_PEB_OBJECT_STORE)) {
          database.createObjectStore(VERIFIER_PEB_OBJECT_STORE, { keyPath: "digest" });
        }
      };
      request.onsuccess = () => {
        const database = request.result;
        database.onversionchange = () => {
          database.close();
          this.#database = null;
        };
        if (this.#closed) {
          database.close();
          reject(new VerifierPebStoreError("STORE_CLOSED", "PEB cache is closed"));
          return;
        }
        resolve(database);
      };
      request.onerror = () => reject(indexedDbError(request.error));
      request.onblocked = () => reject(new VerifierPebStoreError(
        "INDEXEDDB_FAILED",
        "IndexedDB upgrade is blocked by another Verifier tab",
      ));
    });
    // A transient open failure must not poison later attempts.
    void this.#database.catch(() => { this.#database = null; });
    return this.#database;
  }
}

function requireDigest(digest: unknown): asserts digest is string {
  if (!isVerifierPebDigest(digest)) {
    throw new VerifierPebStoreError("INVALID_DIGEST", "PEB digest must be 64 lower-case hexadecimal characters");
  }
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(indexedDbError(request.error));
  });
}

function transactionCompletion(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(indexedDbError(transaction.error));
    transaction.onabort = () => reject(indexedDbError(transaction.error));
  });
}

function indexedDbError(error: unknown): VerifierPebStoreError {
  const suffix = error instanceof Error && error.message ? `: ${error.message}` : "";
  return new VerifierPebStoreError("INDEXEDDB_FAILED", `IndexedDB operation failed${suffix}`);
}

function hasOnlyCacheKeys(value: Record<string, unknown>): boolean {
  const keys = Object.keys(value);
  return keys.length === 3
    && keys.includes("digest")
    && keys.includes("text")
    && keys.includes("byteLength");
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

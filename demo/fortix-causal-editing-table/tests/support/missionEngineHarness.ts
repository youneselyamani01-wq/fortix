import { buildBoundPhysicalReport, type AdapterRecord, type LinkSentinelReport } from "../../app/ethernetLink.ts";
import { PHYSICAL_ADAPTER_TARGETS, type PhysicalAdapterKind, type PhysicalAdapterTarget } from "../../app/physicalAdapterBinding.ts";

/**
 * Drives the real /nx hook (`useMissionEngine`) under React 19, in Node, with
 * no browser and no cable:
 *
 *   - a minimal window and container (the probe renders nothing, so React DOM
 *     never touches a node);
 *   - a fast fake `requestAnimationFrame`, so playback runs in seconds;
 *   - the hook's `readSentinel` seam, fed by switchable RJ45 / Wi-Fi links
 *     instead of the loopback sidecar — the same report shape and the same
 *     aggregate the physical path uses.
 *
 * Everything the hook does after a report is its own code: admission,
 * projection, reconciliation, the seal, the Final Receipt, the PEB. A helper,
 * not a test file (`tests/support`), so importing it registers no tests.
 */

const memoryStorage = new Map<string, string>();
const localStorageShim = {
  getItem: (key: string) => memoryStorage.get(key) ?? null,
  setItem: (key: string, value: string) => { memoryStorage.set(key, String(value)); },
  removeItem: (key: string) => { memoryStorage.delete(key); },
  clear: () => memoryStorage.clear(),
  key: (index: number) => [...memoryStorage.keys()][index] ?? null,
  get length() { return memoryStorage.size; },
};
const noop = () => {};
const documentShim: Record<string, unknown> = { nodeType: 9, nodeName: "#document", addEventListener: noop, removeEventListener: noop, activeElement: null };
const container: Record<string, unknown> = {
  nodeType: 1, nodeName: "DIV", tagName: "DIV", ownerDocument: documentShim,
  addEventListener: noop, removeEventListener: noop, childNodes: [], firstChild: null,
  removeChild: noop, appendChild: noop, insertBefore: noop, textContent: "",
};
documentShim.documentElement = container;
documentShim.body = container;
class FakeIFrame {}
const windowShim: Record<string, unknown> = { event: undefined, localStorage: localStorageShim, HTMLIFrameElement: FakeIFrame, document: documentShim };
documentShim.defaultView = windowShim;
(globalThis as Record<string, unknown>).window = windowShim;

/** Each frame advances the frame clock by `step` ms, `delay` ms of wall time apart. */
export const frames = { now: 0, step: 64, delay: 4 };
(globalThis as Record<string, unknown>).requestAnimationFrame = (callback: (time: number) => void) =>
  setTimeout(() => callback((frames.now += frames.step)), frames.delay) as unknown as number;
(globalThis as Record<string, unknown>).cancelAnimationFrame = (id: number) => clearTimeout(id);

const React = (await import("react")).default;
const { createRoot } = await import("react-dom/client");
const { useMissionEngine } = await import("../../app/nx/adapter/useMissionEngine.ts");
type MissionEngineOptions = import("../../app/nx/adapter/useMissionEngine.ts").MissionEngineOptions;
type MissionEngine = ReturnType<typeof useMissionEngine>;

/** The physical routes the fake sentinel reports. Flip them like a cable. */
export const links: Record<PhysicalAdapterKind, boolean> = { ethernet: true, wifi: false };

function adapter(kind: PhysicalAdapterKind, connected: boolean): AdapterRecord {
  const target = PHYSICAL_ADAPTER_TARGETS[kind];
  return {
    name: kind === "ethernet" ? "Ethernet" : "WiFi",
    description: target.description,
    interfaceGuid: target.interfaceGuid,
    status: connected ? "Up" : "Disconnected",
    mediaConnectionState: connected ? "Connected" : "Disconnected",
    mediaType: kind === "ethernet" ? "802.3" : "Native 802.11",
    physicalMediaType: kind === "ethernet" ? "802.3" : "Native 802.11",
    virtual: false,
    ifIndex: kind === "ethernet" ? 23 : 12,
  };
}

const lastObserved: Record<PhysicalAdapterKind, number> = { ethernet: 0, wifi: 0 };
async function readSentinel(_signal: AbortSignal, target: PhysicalAdapterTarget): Promise<LinkSentinelReport> {
  // Strictly increasing observation times per adapter, as the real sidecar's.
  while (Date.now() <= lastObserved[target.kind]) await sleep(1);
  lastObserved[target.kind] = Date.now();
  return buildBoundPhysicalReport([adapter(target.kind, links[target.kind])], new Date(lastObserved[target.kind]).toISOString(), target);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function until(predicate: () => boolean, label: string, timeoutMs = 30_000): Promise<void> {
  const started = Date.now();
  for (;;) {
    let met = false;
    try { met = predicate(); } catch { met = false; }
    if (met) return;
    if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for ${label}`);
    await sleep(5);
  }
}

export type MountedEngine = Readonly<{ engine: () => MissionEngine; unmount: () => void }>;

/** Mounts the hook in StrictMode, the way the /nx page runs it in development. */
export function mountEngine(initialMasterTimeMs = 0, options: MissionEngineOptions = {}): MountedEngine {
  let current: MissionEngine | null = null;
  function Probe() {
    current = useMissionEngine(initialMasterTimeMs, { readSentinel, ...options });
    return null;
  }
  const root = createRoot(container as unknown as Element);
  root.render(React.createElement(React.StrictMode, null, React.createElement(Probe)));
  return Object.freeze({
    engine: () => {
      if (current === null) throw new Error("the engine has not rendered yet");
      return current;
    },
    unmount: () => root.unmount(),
  });
}

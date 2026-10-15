/** Local Windows launcher. The physical sidecar is independent of vinext/workerd. */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { SENTINEL_ORIGIN, SENTINEL_PORT, isCompatibleSentinelHealth } from "./link-sentinel-service.mjs";

const demoRoot = fileURLToPath(new URL("../", import.meta.url));

export async function probeSentinel(fetcher = globalThis.fetch) {
  let response;
  try {
    response = await fetcher(`${SENTINEL_ORIGIN}/health`, { cache: "no-store", signal: AbortSignal.timeout(1_500) });
  } catch (error) {
    if (error?.cause?.code === "ECONNREFUSED" || error?.code === "ECONNREFUSED") return null;
    throw new Error(`Cannot inspect the local link sentinel: ${error.message}`, { cause: error });
  }
  const value = response.ok ? await response.json().catch(() => null) : null;
  if (!isCompatibleSentinelHealth(value)) {
    throw new Error(`Port ${SENTINEL_PORT} is occupied by an incompatible service. No process was stopped. Stop that service explicitly or use the current scripts/link-sentinel.mjs.`);
  }
  return value;
}

/** Stop only the child this launcher created; a reused sentinel has no owned handle. */
export function stopOwnedSentinel(child) {
  if (child && child.exitCode === null && child.signalCode === null) child.kill();
}

export async function ensureLocalSentinel({
  platform = process.platform,
  probe = probeSentinel,
  start = () => spawn(process.execPath, [join(demoRoot, "scripts/link-sentinel.mjs"), "--port", String(SENTINEL_PORT)], { cwd: demoRoot, stdio: "inherit", windowsHide: true }),
  wait = delay,
  attempts = 40,
  log = console.log,
} = {}) {
  if (platform !== "win32") {
    log("[demo] Physical RJ45 observation is unavailable on this platform. Link remains UNKNOWN without the Windows sentinel; no Internet or Wi-Fi substitute is used.");
    return { child: null, reused: false, available: false };
  }
  const existing = await probe();
  if (existing) {
    log(`[demo] Reusing physical-link sentinel PID ${existing.pid}; its health marker is not a CONNECTED observation.`);
    return { child: null, reused: true, available: true };
  }
  const child = start();
  let spawnError;
  child.on("error", error => { spawnError = error; });
  try {
    for (let attempt = 0; attempt < attempts; attempt++) {
      await wait(150);
      if (spawnError) throw spawnError;
      if (child.exitCode !== null || child.signalCode !== null) throw new Error("Physical-link sentinel exited before readiness.");
      const health = await probe();
      if (health) {
        if (health.pid !== child.pid) throw new Error("A different process acquired the sentinel port during startup.");
        log(`[demo] Physical-link sentinel PID ${health.pid} is ready. The adapter observation may still be UNKNOWN.`);
        return { child, reused: false, available: true };
      }
    }
    throw new Error("Physical-link sentinel did not become ready.");
  } catch (error) {
    stopOwnedSentinel(child);
    throw error;
  }
}

export function resolveVinextCli() {
  return join(dirname(fileURLToPath(import.meta.resolve("vinext"))), "cli.js");
}

/** Vite's familiar --host alias is not parsed by vinext; preserve its explicit value. */
export function normalizeDemoCliArgs(args) {
  return args.map(argument => argument === "--host" ? "--hostname"
    : argument.startsWith("--host=") ? `--hostname=${argument.slice(7)}` : argument);
}

async function run() {
  const [command, ...args] = process.argv.slice(2);
  if (command !== "dev" && command !== "start") throw new Error("Usage: node scripts/run-local-demo.mjs dev|start [vinext options]");
  const vinextCli = resolveVinextCli();
  const sentinel = await ensureLocalSentinel();
  let app;
  try {
    app = spawn(process.execPath, [vinextCli, command, ...normalizeDemoCliArgs(args)], { cwd: demoRoot, stdio: "inherit", windowsHide: true });
    const forwardSignal = () => { app.kill(); stopOwnedSentinel(sentinel.child); };
    process.once("SIGINT", forwardSignal);
    process.once("SIGTERM", forwardSignal);
    const code = await new Promise((resolve, reject) => {
      app.once("error", reject);
      app.once("exit", (exitCode, signal) => resolve(exitCode ?? (signal ? 1 : 0)));
    });
    process.removeListener("SIGINT", forwardSignal);
    process.removeListener("SIGTERM", forwardSignal);
    process.exitCode = code;
  } finally {
    stopOwnedSentinel(sentinel.child);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch(error => { console.error(`[demo] ${error.message}`); process.exitCode = 1; });
}

import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import test from "node:test";
import { ensureLocalSentinel, probeSentinel, resolveVinextCli, stopOwnedSentinel } from "../scripts/run-local-demo.mjs";
import { isCompatibleSentinelHealth, sentinelHealth } from "../scripts/link-sentinel-service.mjs";

const silent = () => {};
const tick = async () => {};
function childProcess(pid = 43190) {
  const child = new EventEmitter();
  Object.assign(child, { pid, exitCode: null, signalCode: null, kills: 0, kill() { this.kills++; return true; } });
  return child;
}

test("the sentinel health marker identifies the pinned physical service, never link truth", () => {
  const health = sentinelHealth(123);
  assert.equal(isCompatibleSentinelHealth(health), true);
  assert.equal("link" in health, false);
  for (const replacement of [{ service: "some-server" }, { protocol: 999 }, { target: "Wi-Fi" }, { pid: 0 }]) {
    assert.equal(isCompatibleSentinelHealth({ ...health, ...replacement }), false);
  }
});

test("probe accepts only the compatible marker and treats connection refusal as absent", async () => {
  const health = sentinelHealth(123);
  assert.deepEqual(await probeSentinel(async () => Response.json(health)), health);
  assert.equal(await probeSentinel(async () => { throw new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } }); }), null);
  for (const response of [Response.json({ link: "CONNECTED" }), Response.json(health, { status: 503 }), new Response("not-json")]) {
    await assert.rejects(probeSentinel(async () => response), /incompatible service/);
  }
  await assert.rejects(probeSentinel(async () => { throw new DOMException("timed out", "TimeoutError"); }), /Cannot inspect/);
});

test("non-Windows serving remains available with explicit UNKNOWN and no substitute observation", async () => {
  const messages = [];
  const result = await ensureLocalSentinel({ platform: "linux", probe: async () => { throw new Error("must not probe"); }, start: () => { throw new Error("must not spawn"); }, log: value => messages.push(value) });
  assert.deepEqual(result, { child: null, reused: false, available: false });
  assert.match(messages.join(" "), /UNKNOWN/);
});

test("a compatible running sentinel is reused and never owned or stopped", async () => {
  const result = await ensureLocalSentinel({ platform: "win32", probe: async () => sentinelHealth(123), start: () => { throw new Error("must not spawn duplicate"); }, log: silent });
  assert.equal(result.reused, true);
  assert.equal(result.child, null);
  stopOwnedSentinel(result.child);
});

test("an incompatible existing listener fails explicitly without starting or stopping processes", async () => {
  await assert.rejects(ensureLocalSentinel({ platform: "win32", probe: () => probeSentinel(async () => Response.json({ link: "CONNECTED" })), start: () => { throw new Error("must not spawn"); }, log: silent }), /No process was stopped/);
});

test("a missing watcher starts once and readiness must belong to that child", async () => {
  const child = childProcess();
  let calls = 0;
  let starts = 0;
  const result = await ensureLocalSentinel({ platform: "win32", probe: async () => ++calls < 3 ? null : sentinelHealth(child.pid), start: () => { starts++; return child; }, wait: tick, log: silent });
  assert.equal(starts, 1);
  assert.equal(result.child, child);
  assert.equal(child.kills, 0);
  stopOwnedSentinel(result.child);
  assert.equal(child.kills, 1);
});

test("startup failure cleans only the owned watcher, including a conflicting process race", async () => {
  for (const kind of ["timeout", "other-process", "exited", "spawn-error"]) {
    const child = childProcess();
    let calls = 0;
    const probe = async () => ++calls === 1 || kind !== "other-process" ? null : sentinelHealth(999);
    const wait = async () => {
      if (kind === "exited") child.exitCode = 1;
      if (kind === "spawn-error") child.emit("error", new Error("SPAWN_FAILED"));
    };
    await assert.rejects(ensureLocalSentinel({ platform: "win32", probe, start: () => child, wait, attempts: 2, log: silent }));
    assert.equal(child.kills, kind === "exited" ? 0 : 1, kind);
  }
});


test("the launcher resolves the installed ESM-only vinext executable", () => {
  const cli = resolveVinextCli();
  assert.equal(existsSync(cli), true);
  assert.match(cli, /[/\\]vinext[/\\]dist[/\\]cli\.js$/);
});

test("LAN launcher translates the Vite host alias to vinext's supported hostname argument", async () => {
  const { normalizeDemoCliArgs } = await import("../scripts/run-local-demo.mjs");
  assert.deepEqual(normalizeDemoCliArgs(["--host", "0.0.0.0", "--port", "3000"]), ["--hostname", "0.0.0.0", "--port", "3000"]);
  assert.deepEqual(normalizeDemoCliArgs(["--host=0.0.0.0"]), ["--hostname=0.0.0.0"]);
  assert.deepEqual(normalizeDemoCliArgs(["--hostname", "localhost"]), ["--hostname", "localhost"]);
  assert.deepEqual(normalizeDemoCliArgs([]), []);
});

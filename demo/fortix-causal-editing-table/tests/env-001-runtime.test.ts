import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

/**
 * ENV-001 — the environment definition is a contract, not documentation.
 *
 * These tests assert the declarations agree with each other and with what the
 * toolchain actually requires, so the runtime cannot drift back into the state
 * where the repository declared one Node and its own test command needed
 * another.
 */

const repoUrl = (path: string) => new URL(`../../../${path}`, import.meta.url);
const projectUrl = (path: string) => new URL(`../${path}`, import.meta.url);

const pkg = JSON.parse(readFileSync(projectUrl("package.json"), "utf8")) as {
  engines?: { node?: string };
  packageManager?: string;
  scripts: Record<string, string>;
};

test("ENV-001: one canonical Node version is declared, and declared once per mechanism", () => {
  const nvmrc = readFileSync(repoUrl(".nvmrc"), "utf8").trim();
  const nodeVersion = readFileSync(repoUrl(".node-version"), "utf8").trim();
  assert.equal(nvmrc, nodeVersion, ".nvmrc and .node-version must not disagree");
  assert.match(nvmrc, /^\d+\.\d+\.\d+$/, "the canonical version must be exact, not a range");
  assert.match(nvmrc, /^22\./, "the canonical line is Node 22 LTS");
});

test("ENV-001: engines admits exactly the versions the toolchain can actually run", () => {
  const range = pkg.engines?.node;
  assert.equal(typeof range, "string", "package.json must declare engines.node");
  // Floor: bare .ts test files are only stripped without a flag from 22.18.
  assert.match(range as string, />=22\.18/, "the floor must be the TypeScript-stripping floor");
  // Ceiling: vinext/wrangler behaviour beyond the 22 line is unverified here.
  assert.match(range as string, /<23/, "the supported line must be bounded");
  const pinned = readFileSync(repoUrl(".nvmrc"), "utf8").trim();
  const [, minor] = pinned.split(".").map(Number);
  assert.ok(minor >= 18, `the pinned version ${pinned} must satisfy the declared floor`);
});

test("ENV-001: the package manager is declared and matches the authoritative lockfile", () => {
  assert.equal(typeof pkg.packageManager, "string", "package.json must declare packageManager");
  assert.match(pkg.packageManager as string, /^npm@\d+\.\d+\.\d+$/);
  assert.ok(existsSync(projectUrl("package-lock.json")), "package-lock.json is authoritative");
  const lock = JSON.parse(readFileSync(projectUrl("package-lock.json"), "utf8")) as { lockfileVersion?: number };
  assert.ok((lock.lockfileVersion ?? 0) >= 3, "lockfileVersion 3+ implies npm 7 or newer");
});

test("ENV-001: no script depends on a flag the canonical Node rejects", () => {
  // `--test-isolation` does not exist on any Node 22.x. The repository's own
  // `npm test` could not run on the Node the repository declared.
  for (const [name, command] of Object.entries(pkg.scripts)) {
    assert.doesNotMatch(command, /--test-isolation/, `script "${name}" uses a flag Node 22 rejects`);
  }
});

test("ENV-001: one command runs every gate, and none of them are faked", () => {
  const validate = pkg.scripts.validate;
  assert.equal(typeof validate, "string", "a canonical validate command must exist");
  for (const gate of ["env:check", "typecheck", "lint", "test:unit", "build", "test:rendered"]) {
    assert.ok(validate.includes(gate), `validate must run the ${gate} gate`);
    if (gate !== "build") assert.ok(gate in pkg.scripts, `${gate} must be a real script`);
  }
  assert.ok(existsSync(projectUrl("scripts/env/check-runtime.mjs")), "the runtime gate must exist");
});

test("ENV-001: the running interpreter satisfies the repository's own declaration", () => {
  const [major, minor] = process.versions.node.split(".").map(Number);
  assert.ok(major === 22 && minor >= 18,
    `this suite is running on Node ${process.versions.node}, outside the canonical >=22.18 <23 line`);
});

test("ENV-001: node_modules belongs to the operating system executing it", () => {
  // The failure that cost this project the most: a Windows-generated tree
  // executed on Linux. The gate script is the enforcement; this asserts it runs
  // and reports a platform verdict rather than passing silently.
  const result = (() => {
    try {
      return {
        ok: true,
        out: execFileSync(process.execPath, ["scripts/env/check-runtime.mjs"], {
          cwd: new URL("../", import.meta.url),
          encoding: "utf8",
        }),
      };
    } catch (error) {
      const err = error as { stdout?: string; stderr?: string };
      return { ok: false, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
    }
  })();

  assert.match(result.out, /ENV-001/, "the gate must always report under its mission label");
  if (!result.ok) {
    assert.match(
      result.out,
      /another operating system|node_modules is absent|Dependency graph/,
      `the gate failed for an unexpected reason:\n${result.out}`,
    );
  }
});

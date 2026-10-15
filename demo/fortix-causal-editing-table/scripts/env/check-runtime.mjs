#!/usr/bin/env node
// ENV-001 — canonical runtime gate.
//
// One repository + one environment definition must give one build, one test
// result and one runtime, whichever engineer or agent is driving the terminal.
// This script fails fast and loudly when that is not the case.
//
// It is deliberately dependency-free and cross-platform: it must be able to
// run *before* `npm ci`, on the wrong Node, on the wrong OS.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT = resolve(HERE, "..", "..");
const REPO = resolve(PROJECT, "..", "..");

const problems = [];
const notes = [];

function fail(message) { problems.push(message); }
function note(message) { notes.push(message); }

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

// ---------------------------------------------------------------- 1. Node
const declaredFile = [join(REPO, ".nvmrc"), join(REPO, ".node-version")].find(existsSync);
if (declaredFile === undefined) {
  fail("No .nvmrc or .node-version at the repository root — the canonical Node version is undeclared.");
} else {
  const declared = readFileSync(declaredFile, "utf8").trim().replace(/^v/, "");
  const running = process.version.replace(/^v/, "");
  if (running !== declared) {
    const [dMajor, dMinor] = declared.split(".").map(Number);
    const [rMajor, rMinor] = running.split(".").map(Number);
    if (rMajor !== dMajor) {
      fail(`Node ${running} is running but the repository pins ${declared}. Run: nvm install && nvm use`);
    } else if (rMinor < dMinor) {
      fail(`Node ${running} is older than the pinned ${declared}. Run: nvm install && nvm use`);
    } else {
      note(`Node ${running} differs from the pinned ${declared} (same major, newer minor).`);
    }
  }
}

// Bare `.ts` test files are stripped without a flag only from Node 22.18.
const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 18)) {
  fail(`Node ${process.versions.node} cannot run this repository's TypeScript test files without a flag (needs >= 22.18).`);
}
if (major >= 23) {
  note(`Node ${process.versions.node} is beyond the supported 22.x line; vinext/wrangler behaviour here is unverified.`);
}

// ------------------------------------------------------------- 2. package manager
const pkg = readJson(join(PROJECT, "package.json"));
if (typeof pkg.packageManager !== "string") {
  fail("package.json has no `packageManager` field — the package manager is undeclared.");
} else {
  const [name, wanted] = pkg.packageManager.split("@");
  if (name !== "npm") {
    fail(`package.json declares ${name}, but package-lock.json means npm is authoritative.`);
  } else {
    try {
      const running = execFileSync("npm", ["--version"], { encoding: "utf8", shell: process.platform === "win32" }).trim();
      if (running.split(".")[0] !== wanted.split(".")[0]) {
        fail(`npm ${running} is running but the repository pins npm ${wanted}.`);
      }
    } catch {
      fail("npm is not on PATH.");
    }
  }
}
if (!existsSync(join(PROJECT, "package-lock.json"))) {
  fail("package-lock.json is missing — deterministic installation is not possible.");
}

// ------------------------------------------- 3. cross-platform contamination
// The single failure that has cost this project the most: a node_modules tree
// generated on one operating system being executed on another.
const PLATFORM_SCOPES = [
  { dir: "@esbuild", label: "esbuild" },
  { dir: "@rollup", label: "rollup" },
  { dir: "@img", label: "sharp" },
  { dir: "@cloudflare", label: "workerd" },
  { dir: "@next", label: "next-swc" },
  { dir: "@tailwindcss", label: "tailwind oxide" },
];

const HOST_TOKENS = {
  linux: ["linux"],
  darwin: ["darwin"],
  win32: ["win32", "windows"],
};
const FOREIGN_TOKENS = ["linux", "darwin", "win32", "windows", "android", "freebsd", "netbsd", "sunos"];
const hostTokens = HOST_TOKENS[process.platform] ?? [process.platform];

const modules = join(PROJECT, "node_modules");
const foreign = [];
const native = [];
if (existsSync(modules)) {
  for (const { dir } of PLATFORM_SCOPES) {
    const scope = join(modules, dir);
    if (!existsSync(scope)) continue;
    for (const entry of readdirSync(scope)) {
      const lower = entry.toLowerCase();
      const token = FOREIGN_TOKENS.find((candidate) => lower.includes(candidate));
      if (token === undefined) continue;
      if (hostTokens.some((host) => lower.includes(host))) native.push(`${dir}/${entry}`);
      else foreign.push(`${dir}/${entry}`);
    }
  }
  if (foreign.length > 0) {
    fail(
      `node_modules was generated on another operating system. Foreign binaries present: ${foreign.join(", ")}.\n` +
      `        This tree cannot be executed on ${process.platform}. Remove it and reinstall:\n` +
      "          rm -rf node_modules && npm ci",
    );
  }
  if (native.length === 0 && foreign.length === 0) {
    note("No platform-specific binaries detected yet — run `npm ci` if the build has not been installed.");
  }
} else {
  fail("node_modules is absent. Run: npm ci");
}

// ------------------------------------------------------- 4. dependency integrity
if (existsSync(modules) && foreign.length === 0) {
  try {
    execFileSync("npm", ["ls", "--all", "--json"], {
      cwd: PROJECT,
      stdio: ["ignore", "ignore", "ignore"],
      shell: process.platform === "win32",
    });
  } catch {
    fail("Dependency graph is not intact (`npm ls --all` failed). Run: npm ci");
  }
}

// ------------------------------------------------------------------ report
const label = "ENV-001";
if (notes.length > 0) {
  for (const message of notes) console.log(`${label}  note: ${message}`);
}
if (problems.length > 0) {
  console.error(`\n${label}: RUNTIME NOT CANONICAL\n`);
  for (const message of problems) console.error(`  ✗ ${message}`);
  console.error("");
  process.exit(1);
}
console.log(
  `${label}: runtime canonical — node ${process.version} · ${process.platform}/${process.arch} · ` +
  `${pkg.packageManager ?? "npm"} · dependency graph intact`,
);

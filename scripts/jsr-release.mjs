#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { syncManifests } from "./jsr-manifests.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const { values } = parseArgs({ options: { "dry-run": { type: "boolean" } } });
const dryRun = values["dry-run"];

await syncManifests({ check: true });

if (!dryRun) {
  const status = spawnSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: root, encoding: "utf8" });
  if (status.status !== 0) throw new Error(status.stderr || "Failed to check release worktree");
  if (status.stdout.trim()) throw new Error("JSR publishing requires a clean worktree; commit changes first");
}

// Augmented models and casts require slow types; do not bypass normal type checking.
const args = ["publish", "--allow-slow-types", "--sloppy-imports"];
if (dryRun) args.push("--dry-run", "--allow-dirty");
const result = spawnSync("deno", args, { cwd: root, stdio: "inherit" });
if (result.error) throw new Error(`Deno is required for JSR publishing: ${result.error.message}`);
process.exitCode = result.status ?? 1;

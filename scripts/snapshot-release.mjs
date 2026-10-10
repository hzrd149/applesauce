#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const { values } = parseArgs({
  options: {
    tag: { type: "string", default: "next" },
    "dry-run": { type: "boolean" },
    "skip-version": { type: "boolean" },
    "verify-only": { type: "boolean" },
  },
});
const tag = values.tag;
const dryRun = values["dry-run"];
const isolated = process.env.APPLESAUCE_SNAPSHOT_WORKTREE === "1";

if (!/^[a-z][a-z0-9-]*$/.test(tag) || tag === "latest") throw new Error("Invalid snapshot tag");

function run(command, args, cwd = root, env = {}) {
  if (dryRun) {
    console.log([command, ...args].join(" "));
    return;
  }
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) throw new Error(`${command} exited with status ${result.status ?? 1}`);
}

function git(args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || "Git command failed");
  return result.stdout.trim();
}

function publishPackages() {
  const config = JSON.parse(readFileSync(join(root, ".changeset/config.json"), "utf8"));
  const group = config.linked?.find((packages) => packages.some((name) => name.startsWith("applesauce-")));
  if (!group?.length) throw new Error("No linked applesauce package group found in .changeset/config.json");

  run("pnpm", [
    ...group.flatMap((name) => ["--filter", name]),
    "--recursive",
    "publish",
    "--tag",
    tag,
    "--access",
    "public",
    "--no-git-checks",
  ]);
}

function release() {
  if (!values["skip-version"]) run("node", ["scripts/snapshot-version.mjs", tag]);
  run("pnpm", ["prerelease-snapshot"]);
  if (!values["verify-only"]) publishPackages();
}

function releaseFromWorktree() {
  if (git(["branch", "--show-current"]) !== "next") {
    throw new Error("Snapshot releases must start from the next branch");
  }
  if (git(["status", "--porcelain", "--untracked-files=all"])) {
    throw new Error("Snapshot releases require a clean next checkout");
  }
  if (dryRun) {
    release();
    return;
  }

  const tempRoot = mkdtempSync(join(tmpdir(), "applesauce-next-release-"));
  const worktree = join(tempRoot, "checkout");
  let created = false;
  let completed = false;

  try {
    run("git", ["worktree", "add", "--detach", worktree, "HEAD"]);
    created = true;
    run("pnpm", ["install", "--frozen-lockfile"], worktree);
    run(process.execPath, [join(worktree, "scripts/snapshot-release.mjs"), ...process.argv.slice(2)], worktree, {
      APPLESAUCE_SNAPSHOT_WORKTREE: "1",
    });
    completed = true;
  } finally {
    if (created && !completed) {
      console.log(`Release checkout retained at ${worktree}`);
    } else {
      if (created) run("git", ["worktree", "remove", "--force", worktree]);
      rmSync(tempRoot, { recursive: true, force: true });
    }
  }
}

if (isolated) release();
else releaseFromWorktree();

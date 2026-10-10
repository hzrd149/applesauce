#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { artifactIntegrity, publishRelease, readRelease, registry, writeRelease } from "./snapshot-publish.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const configPath = join(root, ".changeset", "config.json");
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const skipVersion = args.includes("--skip-version");
const verifyOnly = args.includes("--verify-only");
const isolated = process.env.APPLESAUCE_SNAPSHOT_WORKTREE === "1";

function getArgValue(name) {
  const equalsArg = args.find((arg) => arg.startsWith(`${name}=`));
  if (equalsArg) return equalsArg.slice(name.length + 1);

  const index = args.indexOf(name);
  if (index !== -1) return args[index + 1];
}

const tag = getArgValue("--tag") ?? "next";
const resume = getArgValue("--resume");

if (args.some((arg) => arg === "--resume" || arg.startsWith("--resume=")) && (!resume || resume.startsWith("--")))
  throw new Error("--resume requires a release manifest path");
if (!/^[a-z][a-z0-9-]*$/.test(tag) || tag === "latest") throw new Error("Invalid snapshot tag");
if (args.some((arg) => arg === "--otp" || arg.startsWith("--otp="))) {
  throw new Error("OTP forwarding has been removed. Use pnpm login and let pnpm handle publishing authentication.");
}
if (args.includes("--prepare-only")) throw new Error("Use pnpm release-next to prepare and publish in one run");
if (resume && (dryRun || verifyOnly || skipVersion || getArgValue("--tag"))) {
  throw new Error("--resume uses the saved artifacts and tag; do not combine it with preparation flags");
}

function run(command, commandArgs, env = {}, cwd = root) {
  if (dryRun) {
    console.log([command, ...commandArgs].join(" "));
    return;
  }

  const result = spawnSync(command, commandArgs, {
    cwd,
    env: { ...process.env, ...env },
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) throw new Error(`${command} exited with status ${result.status ?? 1}`);
}

function runCapture(command, commandArgs, cwd = root) {
  return spawnSync(command, commandArgs, {
    cwd,
    encoding: "utf8",
    env: process.env,
    shell: process.platform === "win32",
  });
}

function getSnapshotPackages() {
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  const group = config.linked?.find((packages) => packages.some((name) => name.startsWith("applesauce-")));
  if (!group?.length) throw new Error("No linked applesauce package group found in .changeset/config.json");

  return group.map((name) => {
    const dir = join(root, "packages", name.replace("applesauce-", ""));
    const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    return { dir, manifest, name };
  });
}

function registryJson(commandArgs, allowMissing = false) {
  const result = runCapture("pnpm", [...commandArgs, "--json", "--registry", registry]);
  if (result.status === 0) return JSON.parse(result.stdout);
  let code;
  try {
    code = JSON.parse(result.stdout).error?.code;
  } catch {
    // Non-JSON process failures are errors, never evidence of a missing version.
  }
  if (allowMissing && ["ERR_PNPM_PACKAGE_NOT_FOUND", "ERR_PNPM_FETCH_404", "E404"].includes(code)) return undefined;
  throw new Error(`Unable to read npm registry state:\n${result.stderr || result.stdout}`);
}

async function publishManifest(path) {
  const release = readRelease(path);
  const expected = getSnapshotPackages()
    .filter((pkg) => !pkg.manifest.private)
    .map((pkg) => pkg.name)
    .sort();
  const actual = release.packages.map((pkg) => pkg.name).sort();
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    throw new Error("Release manifest does not contain the complete linked snapshot package group");
  }
  console.log(`Release artifacts: ${path}`);
  console.log(`To retry without rebuilding: pnpm release-snapshot --resume ${JSON.stringify(path)}`);
  run("pnpm", ["whoami", "--registry", registry]);
  await publishRelease(path, {
    view: (pkg) => registryJson(["view", `${pkg.name}@${pkg.version}`, "name", "version", "dist"], true),
    tags: (name) => registryJson(["view", name, "dist-tags"]),
    publish: (tarball, uploadTag) =>
      run("pnpm", [
        "publish",
        tarball,
        "--tag",
        uploadTag,
        "--access",
        "public",
        "--registry",
        registry,
        "--no-git-checks",
        "--publish-wait-timeout",
        "600000",
      ]),
    promote: (pkg, targetTag) =>
      run("pnpm", ["dist-tag", "add", `${pkg.name}@${pkg.version}`, targetTag, "--registry", registry]),
  });
}

function prepareManifest() {
  const destination = process.env.APPLESAUCE_SNAPSHOT_ARTIFACTS;
  if (!destination) throw new Error("Missing snapshot artifact directory");
  const packages = [];
  for (const { dir, manifest, name } of getSnapshotPackages()) {
    if (manifest.private) continue;
    const tarball = `${name}-${manifest.version}.tgz`;
    run("pnpm", ["pack", "--out", join(destination, tarball)], {}, dir);
    packages.push({
      name,
      version: manifest.version,
      tarball,
      integrity: dryRun ? "(dry run)" : artifactIntegrity(join(destination, tarball)),
    });
  }
  const path = join(destination, "release.json");
  if (!packages.length) throw new Error("No public snapshot packages found");
  const release = {
    schema: 1,
    registry,
    tag,
    uploadTag: `${tag}-pending-${packages[0].version.replaceAll(".", "-")}`,
    packages,
  };
  if (!dryRun) {
    writeRelease(path, release);
    readRelease(path);
  }
  console.log(`Prepared release: ${path}`);
  return path;
}

function requireCleanNextCheckout() {
  const branch = runCapture("git", ["branch", "--show-current"]);
  if (branch.status !== 0) throw new Error(branch.stderr || "Unable to read the current Git branch");
  if (branch.stdout.trim() !== "next") throw new Error("Snapshot releases must start from the next branch");

  const status = runCapture("git", ["status", "--porcelain", "--untracked-files=all"]);
  if (status.status !== 0) throw new Error(status.stderr || "Unable to inspect the Git worktree");
  if (status.stdout.trim()) throw new Error("Snapshot releases require a clean next checkout");
}

async function publishFromDisposableWorktree() {
  requireCleanNextCheckout();

  if (dryRun) {
    const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), ...args], {
      cwd: root,
      env: { ...process.env, APPLESAUCE_SNAPSHOT_WORKTREE: "1", APPLESAUCE_SNAPSHOT_ARTIFACTS: "<release-artifacts>" },
      stdio: "inherit",
    });
    if (result.status !== 0) throw new Error(`Snapshot dry run exited with status ${result.status ?? 1}`);
    return;
  }

  const tempBase = existsSync("/tmp/opencode") ? "/tmp/opencode" : tmpdir();
  const tempRoot = mkdtempSync(join(tempBase, "applesauce-next-release-"));
  const worktree = join(tempRoot, "checkout");
  const artifacts = join(tempRoot, "artifacts");
  mkdirSync(artifacts);
  let created = false;

  try {
    run("git", ["worktree", "add", "--detach", worktree, "HEAD"]);
    created = true;
    run("pnpm", ["install", "--frozen-lockfile"], {}, worktree);

    const result = spawnSync(process.execPath, [join(worktree, "scripts", "snapshot-release.mjs"), ...args], {
      cwd: worktree,
      env: { ...process.env, APPLESAUCE_SNAPSHOT_WORKTREE: "1", APPLESAUCE_SNAPSHOT_ARTIFACTS: artifacts },
      stdio: "inherit",
    });
    if (result.status !== 0) throw new Error(`Snapshot release exited with status ${result.status ?? 1}`);
  } finally {
    if (created) {
      const cleanup = runCapture("git", ["worktree", "remove", "--force", worktree]);
      if (cleanup.status !== 0) {
        throw new Error(`Unable to remove temporary release worktree ${worktree}:\n${cleanup.stderr}`);
      }
    }
    if (existsSync(join(artifacts, "release.json"))) {
      console.log(`Saved release artifacts: ${join(artifacts, "release.json")}`);
    } else {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  }
}

if (resume) {
  await publishManifest(resolve(root, resume));
} else if (!isolated) {
  await publishFromDisposableWorktree();
} else {
  if (!skipVersion) run("node", ["scripts/snapshot-version.mjs", tag]);

  run("pnpm", ["prerelease-snapshot"]);
  if (!verifyOnly) {
    const path = prepareManifest();
    if (!dryRun) await publishManifest(path);
  }
}

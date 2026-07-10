#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const configPath = join(root, ".changeset", "config.json");
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const skipInstall = args.includes("--skip-install");
const snapshotTag = args.find((arg) => !arg.startsWith("--")) ?? "next";

const originalConfig = readFileSync(configPath, "utf8");
const config = JSON.parse(originalConfig);
const snapshotGroup = config.linked?.find((group) => group.some((name) => name.startsWith("applesauce-")));

if (!snapshotGroup?.length) throw new Error("No linked applesauce package group found in .changeset/config.json");

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function validateSnapshotVersions() {
  const versions = new Map();

  for (const name of snapshotGroup) {
    const manifest = JSON.parse(
      readFileSync(join(root, "packages", name.replace("applesauce-", ""), "package.json"), "utf8"),
    );
    versions.set(name, manifest.version);
  }

  const uniqueVersions = new Set(versions.values());
  if (uniqueVersions.size !== 1) {
    const lines = [...versions].map(([name, version]) => `${name}: ${version}`).join("\n");
    throw new Error(`Snapshot packages do not share one version:\n${lines}`);
  }
}

try {
  config.fixed = [...(config.fixed ?? []), snapshotGroup];
  config.linked = (config.linked ?? []).filter((group) => group !== snapshotGroup);

  const temporaryConfig = `${JSON.stringify(config, null, 2)}\n`;

  if (dryRun) {
    console.log(temporaryConfig);
    process.exit(0);
  }

  writeFileSync(configPath, temporaryConfig);
  run("pnpm", ["changeset", "version", "--snapshot", snapshotTag]);
} finally {
  if (!dryRun) writeFileSync(configPath, originalConfig);
}

validateSnapshotVersions();

if (!skipInstall) run("pnpm", ["install", "--no-frozen-lockfile"]);

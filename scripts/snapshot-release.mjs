#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const configPath = join(root, ".changeset", "config.json");
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const skipVersion = args.includes("--skip-version");

function getArgValue(name) {
  const equalsArg = args.find((arg) => arg.startsWith(`${name}=`));
  if (equalsArg) return equalsArg.slice(name.length + 1);

  const index = args.indexOf(name);
  if (index !== -1) return args[index + 1];
}

const tag = getArgValue("--tag") ?? "next";

function run(command, commandArgs, env = {}) {
  if (dryRun) {
    console.log([command, ...commandArgs].join(" "));
    return;
  }

  const result = spawnSync(command, commandArgs, {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function runCapture(command, commandArgs) {
  return spawnSync(command, commandArgs, {
    cwd: root,
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

function isPublished(name, version) {
  if (dryRun) return false;

  const result = runCapture("pnpm", ["view", `${name}@${version}`, "version"]);
  if (result.status === 0 && result.stdout.trim() === version) return true;
  if (result.stderr.includes("ERR_PNPM_PACKAGE_NOT_FOUND")) return false;
  if (result.stderr.includes("E404") || result.stderr.includes("404")) return false;
  if (result.stdout.includes("ERR_PNPM_PACKAGE_NOT_FOUND")) return false;
  if (result.stdout.includes("E404") || result.stdout.includes("404")) return false;

  const error = result.stderr || result.stdout;
  throw new Error(`Unable to check whether ${name}@${version} is published:\n${error}`);
}

function publishPackages(otp) {
  const otpEnv = otp ? { npm_config_otp: otp, NPM_CONFIG_OTP: otp } : {};

  for (const { dir, manifest, name } of getSnapshotPackages()) {
    if (manifest.private) continue;

    if (isPublished(name, manifest.version)) {
      console.log(`${name}@${manifest.version} is already published, skipping`);
      continue;
    }

    const publishArgs = ["publish", dir, "--tag", tag, "--access", "public", "--no-git-checks"];
    if (otp) publishArgs.push("--otp", otp);

    run("pnpm", publishArgs, otpEnv);
  }
}

async function getOtp() {
  const otp = getArgValue("--otp") ?? process.env.NPM_CONFIG_OTP ?? process.env.NPM_OTP;
  if (otp) return otp.trim();

  if (process.env.NODE_AUTH_TOKEN) return undefined;

  if (!input.isTTY || !output.isTTY) {
    throw new Error("NPM OTP is required. Pass --otp <code>, NPM_OTP, or NPM_CONFIG_OTP.");
  }

  const readline = createInterface({ input, output });
  try {
    return (await readline.question("Enter npm OTP: ")).trim();
  } finally {
    readline.close();
  }
}

const otp = await getOtp();
if (otp === "") throw new Error("NPM OTP cannot be empty");

if (!skipVersion) run("node", ["scripts/snapshot-version.mjs", tag]);

publishPackages(otp);
run("git", ["reset", "--hard", "HEAD"]);
run("git", ["clean", "-fd"]);

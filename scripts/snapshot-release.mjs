#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
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

function run(command, commandArgs) {
  if (dryRun) {
    console.log([command, ...commandArgs].join(" "));
    return;
  }

  const result = spawnSync(command, commandArgs, { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
  if (result.status !== 0) process.exit(result.status ?? 1);
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

const publishArgs = ["changeset", "publish", "--tag", tag, "--no-git-tag"];
if (otp) publishArgs.push("--otp", otp);

run("pnpm", publishArgs);
run("git", ["reset", "--hard", "HEAD"]);
run("git", ["clean", "-fd"]);

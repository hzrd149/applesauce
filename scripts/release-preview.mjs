import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

const configPath = new URL("../.changeset/config.json", import.meta.url);
const originalConfig = readFileSync(configPath, "utf8");
const status = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" });

if (status.trim()) throw new Error("Release previews require a clean worktree");

try {
  const config = JSON.parse(originalConfig);
  config.commit = false;
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

  execFileSync("pnpm", ["exec", "changeset", "version"], { stdio: "inherit" });
  execFileSync("pnpm", ["install", "--no-frozen-lockfile"], { stdio: "inherit" });
} finally {
  writeFileSync(configPath, originalConfig);
}

console.log("\nRelease preview generated without commits or tags.");
execFileSync("git", ["status", "--short"], { stdio: "inherit" });
execFileSync("git", ["diff", "--stat"], { stdio: "inherit" });

const prompt = createInterface({ input: stdin, output: stdout });
const answer = await prompt.question("\nClear all preview changes and restore the clean worktree? [y/N] ");
prompt.close();

if (!/^y(es)?$/i.test(answer.trim())) {
  console.log("Preview changes kept. Clear them before running pnpm release-commit.");
  process.exit(0);
}

execFileSync("git", ["reset", "--hard", "HEAD"], { stdio: "inherit" });
execFileSync("git", ["clean", "-fd"], { stdio: "inherit" });
console.log("Release preview cleared; the worktree is back to HEAD.");

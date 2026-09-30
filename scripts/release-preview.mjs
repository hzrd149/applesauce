import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

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
console.log("Inspect the worktree, then discard every preview change before running pnpm version-packages.");

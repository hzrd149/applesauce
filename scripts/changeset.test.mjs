import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { runChangeset } from "./changeset.mjs";
import { releasePackages } from "./release-packages.mjs";

const fixtures = [];

function fixture(type, versions = {}) {
  const root = mkdtempSync(join(tmpdir(), "applesauce-version-test-"));
  fixtures.push(root);
  mkdirSync(join(root, ".changeset"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "fixture", private: true }));
  writeFileSync(join(root, "pnpm-workspace.yaml"), 'packages:\n  - "packages/*"\n');
  writeFileSync(
    join(root, ".changeset/config.json"),
    JSON.stringify({ linked: [], fixed: [], commit: false, changelog: false, access: "public", baseBranch: "master" }),
  );
  writeFileSync(join(root, ".changeset/change.md"), `---\n"applesauce-react": ${type}\n---\n\nUpdate React\n`);

  for (const name of releasePackages) {
    const directory = join(root, "packages", name.replace("applesauce-", ""));
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, "package.json"), JSON.stringify({ name, version: versions[name] ?? "7.3.4" }));
  }
  execFileSync("git", ["init", "-b", "master"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "Fixture"], {
    cwd: root,
    stdio: "ignore",
  });
  return root;
}

function version(root, name) {
  return JSON.parse(readFileSync(join(root, "packages", name.replace("applesauce-", ""), "package.json"))).version;
}

afterEach(() => {
  for (const root of fixtures.splice(0)) rmSync(root, { recursive: true, force: true });
});

test.each([
  ["patch", "7.1.1"],
  ["minor", "7.2.0"],
])("keeps %s releases independent", async (type, expected) => {
  const root = fixture(type, { "applesauce-react": "7.1.0" });
  expect(await runChangeset(["version"], root)).toBe(0);
  expect(version(root, "applesauce-react")).toBe(expected);
  expect(version(root, "applesauce-core")).toBe("7.3.4");
});

test("status and version agree on a coordinated major release", async () => {
  const root = fixture("major", { "applesauce-react": "7.1.0" });
  const changesetPath = join(root, ".changeset/change.md");
  const original = '---\n"applesauce-react": major\n"applesauce-core": patch\n---\n\nUpdate React\n';
  writeFileSync(changesetPath, original);
  const coreManifestPath = join(root, "packages/core/package.json");
  const coreManifest = JSON.parse(readFileSync(coreManifestPath));
  coreManifest.dependencies = { "applesauce-react": "^7.1.0" };
  writeFileSync(coreManifestPath, JSON.stringify(coreManifest));
  const output = join(root, "status.json");
  expect(await runChangeset(["status", "--output", output], root)).toBe(0);
  const { releases } = JSON.parse(readFileSync(output));
  expect(releases).toHaveLength(releasePackages.length);
  expect(releases.every(({ newVersion }) => newVersion === "8.0.0")).toBe(true);
  expect(readdirSync(join(root, ".changeset"))).toEqual(["change.md", "config.json"]);
  expect(readFileSync(changesetPath, "utf8")).toBe(original);

  expect(await runChangeset(["version"], root)).toBe(0);
  for (const name of releasePackages) expect(version(root, name)).toBe("8.0.0");
  expect(JSON.parse(readFileSync(coreManifestPath)).dependencies["applesauce-react"]).toBe("^8.0.0");
  expect(readdirSync(join(root, ".changeset"))).toEqual(["config.json"]);
});

test("rejects mismatched major versions before modifying packages", async () => {
  const root = fixture("major", { "applesauce-core": "6.9.0" });
  await expect(runChangeset(["version"], root)).rejects.toThrow("same major version");
  expect(version(root, "applesauce-react")).toBe("7.3.4");
  expect(readdirSync(join(root, ".changeset"))).toEqual(["change.md", "config.json"]);
});

test("restores the original changeset when the CLI fails", async () => {
  const root = fixture("major");
  const changesetPath = join(root, ".changeset/change.md");
  const original = readFileSync(changesetPath, "utf8");
  expect(await runChangeset(["version", "--invalid-option"], root)).not.toBe(0);
  expect(readFileSync(changesetPath, "utf8")).toBe(original);
  expect(readdirSync(join(root, ".changeset"))).toEqual(["change.md", "config.json"]);
});

test("supports Changesets automatic release commits", async () => {
  const root = fixture("major");
  execFileSync("git", ["config", "user.name", "Test"], { cwd: root });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
  const configPath = join(root, ".changeset/config.json");
  const config = JSON.parse(readFileSync(configPath));
  config.commit = true;
  writeFileSync(configPath, JSON.stringify(config));
  execFileSync("git", ["commit", "-am", "Enable release commits"], { cwd: root, stdio: "ignore" });

  expect(await runChangeset(["version"], root)).toBe(0);
  expect(execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" })).toBe("");
  const committedManifest = execFileSync("git", ["show", "HEAD:packages/react/package.json"], {
    cwd: root,
    encoding: "utf8",
  });
  expect(JSON.parse(committedManifest).version).toBe("8.0.0");
});

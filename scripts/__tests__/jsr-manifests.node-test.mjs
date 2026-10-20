import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { createExports, createManifest, getPackages, syncManifests } from "../jsr-manifests.mjs";

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const packages = getPackages(root);

test("all 13 public packages have synchronized v7 JSR manifests", async () => {
  assert.equal(packages.length, 13);
  assert.equal(await syncManifests({ check: true }), 13);
  for (const pkg of packages) {
    const manifest = createManifest(pkg, packages);
    assert.equal(manifest.version, pkg.manifest.version);
    assert.match(manifest.version, /^7\./);
    assert.match(manifest.name, /^@applesauce\//);
    for (const [key, path] of Object.entries(manifest.exports)) {
      assert.match(key, /^\.(\/[a-zA-Z0-9_./-]+)?$/);
      assert.match(path, /^\.\/src\/.+\.tsx?$/);
      assert.doesNotMatch(path, /__tests__|__snapshots__|\.test\./);
      readFileSync(join(pkg.path, path));
    }
  }
});

test("internal imports, subpaths, and self imports use JSR instead of npm builds", () => {
  for (const pkg of packages) {
    const manifest = createManifest(pkg, packages);
    assert.match(manifest.imports[pkg.manifest.name], /^jsr:@applesauce\//);
    for (const [name, target] of Object.entries(manifest.imports)) {
      if (name.startsWith("applesauce-")) assert.match(target, /^jsr:@applesauce\/[^@]+@/);
    }
    for (const dependency of packages) {
      const target = manifest.imports[dependency.manifest.name];
      if (!target) continue;
      for (const key of Object.keys(createExports(dependency))) {
        const suffix = key === "." ? "" : key.slice(1);
        assert.equal(manifest.imports[`${dependency.manifest.name}${suffix}`], `${target}${suffix}`);
      }
    }
  }
});

test("JSR-specific exports preserve valid React and SQLite entrypoints", () => {
  const find = (name) =>
    createManifest(
      packages.find((pkg) => pkg.manifest.name === name),
      packages,
    );
  assert.equal(find("applesauce-react").exports["./hooks/use-dollar"], "./src/hooks/use-$.ts");
  assert.equal(find("applesauce-react").exports["./providers/store-provider"], "./src/providers/store-provider.tsx");
  assert.equal(find("applesauce-sqlite").exports["./deno"], "./src/native/index.ts");
  assert.equal(find("applesauce-sqlite").exports["./bun"], "./src/bun/index.ts");
  assert.equal(find("applesauce-wallet-connect").exports["./types"], undefined);
  assert.equal(find("applesauce-content").imports.unist, "npm:@types/unist@^3.0.3");
});

test("sync follows package versions and detects drift without modifying files", async () => {
  const directory = mkdtempSync(join(tmpdir(), "applesauce-jsr-test-"));
  try {
    const path = join(directory, "packages", "fixture");
    mkdirSync(join(path, "src"), { recursive: true });
    writeFileSync(join(path, "src/index.ts"), "export const value = 1;\n");
    const pkg = {
      name: "applesauce-fixture",
      version: "7.1.0",
      license: "MIT",
      exports: { ".": { import: "./dist/index.js" } },
    };
    writeFileSync(join(path, "package.json"), JSON.stringify(pkg));
    await syncManifests({ directory });
    assert.equal(JSON.parse(readFileSync(join(path, "deno.json"))).version, "7.1.0");
    const original = readFileSync(join(path, "deno.json"), "utf8");
    pkg.version = "7.2.0";
    writeFileSync(join(path, "package.json"), JSON.stringify(pkg));
    await assert.rejects(() => syncManifests({ directory, check: true }), /out of date/);
    assert.equal(readFileSync(join(path, "deno.json"), "utf8"), original);
    await syncManifests({ directory });
    assert.equal(JSON.parse(readFileSync(join(path, "deno.json"))).version, "7.2.0");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

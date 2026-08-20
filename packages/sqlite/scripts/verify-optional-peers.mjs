import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const expectedPeers = {
  "@libsql/client": "^0.15.15",
  "@tursodatabase/database": "^0.2.2",
  "@tursodatabase/database-wasm": "^0.2.2",
  "better-sqlite3": "^12.8.0",
};
const expectedMeta = Object.fromEntries(Object.keys(expectedPeers).map((name) => [name, { optional: true }]));
const scratch = mkdtempSync(join(tmpdir(), "applesauce-sqlite-peers-"));

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function assertOptionalPeers(manifest, label) {
  assert.deepEqual(manifest.peerDependencies, expectedPeers, `${label} peer ranges changed`);
  assert.deepEqual(manifest.peerDependenciesMeta, expectedMeta, `${label} optional peer metadata changed`);
}

try {
  const sourceManifest = readJson(join(packageDir, "package.json"));
  assertOptionalPeers(sourceManifest, "source manifest");

  const packOutput = execFileSync("npm", ["pack", "--json", "--pack-destination", scratch], {
    cwd: packageDir,
    encoding: "utf8",
  });
  const [{ filename }] = JSON.parse(packOutput);
  const tarball = join(scratch, filename);
  const unpacked = join(scratch, "unpacked");
  mkdirSync(unpacked);
  execFileSync("tar", ["-xzf", tarball, "-C", unpacked]);
  assertOptionalPeers(readJson(join(unpacked, "package", "package.json")), "packed manifest");

  const consumer = join(scratch, "consumer");
  mkdirSync(consumer);
  writeFileSync(join(consumer, "package.json"), '{"name":"sqlite-peer-smoke","private":true,"type":"module"}\n');
  execFileSync("npm", ["install", "--no-package-lock", tarball, "better-sqlite3@^12.8.0"], {
    cwd: consumer,
    stdio: "inherit",
  });

  for (const peer of Object.keys(expectedPeers).filter((name) => name !== "better-sqlite3")) {
    assert.throws(() => readFileSync(join(consumer, "node_modules", peer, "package.json")), undefined, `${peer} was installed`);
  }
  execFileSync("node", ["--input-type=module", "--eval", 'await import("applesauce-sqlite/better-sqlite3")'], {
    cwd: consumer,
    stdio: "inherit",
  });
  console.log("Optional peer metadata and one-backend consumer import verified.");
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, basename } from "node:path";

const registry = "https://registry.npmjs.org/";

export function artifactIntegrity(path) {
  return `sha512-${createHash("sha512").update(readFileSync(path)).digest("base64")}`;
}

export function readRelease(path) {
  const release = JSON.parse(readFileSync(path, "utf8"));
  if (
    release?.schema !== 1 ||
    release.registry !== registry ||
    typeof release.tag !== "string" ||
    !/^[a-z][a-z0-9-]*$/.test(release.tag) ||
    release.tag === "latest" ||
    typeof release.uploadTag !== "string" ||
    !/^[a-z][a-z0-9-]*$/.test(release.uploadTag) ||
    release.uploadTag === release.tag ||
    release.uploadTag === "latest" ||
    !Array.isArray(release.packages) ||
    !release.packages.length
  ) {
    throw new Error("Invalid snapshot release manifest");
  }

  const names = new Set();
  for (const pkg of release.packages) {
    if (
      !/^applesauce-[a-z-]+$/.test(pkg.name) ||
      names.has(pkg.name) ||
      !/^\d+\.\d+\.\d+-[a-zA-Z0-9.-]+$/.test(pkg.version) ||
      typeof pkg.tarball !== "string" ||
      basename(pkg.tarball) !== pkg.tarball ||
      !pkg.tarball.endsWith(".tgz") ||
      !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(pkg.integrity)
    ) {
      throw new Error("Invalid snapshot package in release manifest");
    }
    names.add(pkg.name);
    if (artifactIntegrity(join(dirname(path), pkg.tarball)) !== pkg.integrity) {
      throw new Error(`Release artifact changed: ${pkg.tarball}`);
    }
  }
  if (new Set(release.packages.map((pkg) => pkg.version)).size !== 1) {
    throw new Error("Snapshot packages must share one version");
  }
  return release;
}

export function writeRelease(path, release) {
  writeFileSync(path, `${JSON.stringify(release, null, 2)}\n`);
}

export async function publishRelease(path, client) {
  const release = readRelease(path);
  const matches = (pkg, remote) => {
    if (!remote) return false;
    if (remote.name !== pkg.name || remote.version !== pkg.version || remote.dist?.integrity !== pkg.integrity) {
      throw new Error(`Published artifact does not match ${pkg.name}@${pkg.version}; refusing to promote`);
    }
    return true;
  };

  // Check the whole release before performing any writes, including on retries.
  const pending = [];
  for (const pkg of release.packages) {
    if (!matches(pkg, await client.view(pkg))) pending.push(pkg);
    else console.log(`${pkg.name}@${pkg.version} is already published and verified`);
  }

  for (const pkg of pending) {
    await client.publish(join(dirname(path), pkg.tarball), release.uploadTag, release.registry);
  }

  // Do not expose a partially uploaded dependency graph through the public tag.
  for (const pkg of release.packages) {
    if (!matches(pkg, await client.view(pkg))) {
      throw new Error(`${pkg.name}@${pkg.version} is not visible in the registry; resume to verify again`);
    }
  }

  for (const pkg of release.packages) {
    const tags = await client.tags(pkg.name);
    if (tags[release.tag] !== pkg.version) {
      await client.promote(pkg, release.tag, release.registry);
    }
  }

  for (const pkg of release.packages) {
    if ((await client.tags(pkg.name))[release.tag] !== pkg.version) {
      throw new Error(`${pkg.name}@${release.tag} does not point to ${pkg.version}; resume to finish promotion`);
    }
  }

  console.log(`Verified ${release.packages.length} packages under ${release.tag}`);
}

export { registry };

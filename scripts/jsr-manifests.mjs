import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { format, resolveConfig } from "prettier";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "__tests__" || entry.name === "__snapshots__") return [];
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /(?<!\.test)\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts") ? [path] : [];
  });
}

export function getPackages(directory = root) {
  return readdirSync(join(directory, "packages"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const path = join(directory, "packages", entry.name);
      return { path, manifest: JSON.parse(readFileSync(join(path, "package.json"), "utf8")) };
    })
    .filter(({ manifest }) => !manifest.private);
}

export function createExports({ path, manifest }) {
  if (!manifest.name.startsWith("applesauce-")) throw new Error(`Unexpected package: ${manifest.name}`);
  const exports = {};
  const files = sourceFiles(join(path, "src")).map((file) => `./${relative(path, file).replaceAll("\\", "/")}`);
  for (const [key, conditions] of Object.entries(manifest.exports)) {
    // This legacy npm export has no implementation in v7.
    if (manifest.name === "applesauce-wallet-connect" && key === "./types") continue;
    const target = conditions.import.replace("./dist/", "./src/").replace(/\.js$/, ".ts");
    if (key.includes("*")) {
      const [prefix, suffix] = target.split("*");
      for (const file of files) {
        const normalized = file.replace(/\.tsx$/, ".ts");
        if (normalized.startsWith(prefix) && normalized.endsWith(suffix)) {
          let entry = key.replace("*", normalized.slice(prefix.length, -suffix.length || undefined));
          // JSR forbids '$' in export names, but not in source file names.
          if (manifest.name === "applesauce-react" && entry === "./hooks/use-$") entry = "./hooks/use-dollar";
          exports[entry] = file;
        }
      }
    } else {
      const file = files.find((file) => file === target || file === target.replace(/\.ts$/, ".tsx"));
      if (!file) throw new Error(`${manifest.name}: missing source for ${key} (${target})`);
      exports[key] = file;
    }
  }

  return exports;
}

export function createManifest(pkg, packages) {
  const { manifest } = pkg;
  const exports = createExports(pkg);
  const dependencies = {
    [manifest.name]: `^${manifest.version}`,
    ...manifest.peerDependencies,
    ...manifest.optionalDependencies,
    ...manifest.dependencies,
  };
  const imports = {};
  for (const [name, range] of Object.entries(dependencies)) {
    // Deno's npm specifiers do not accept npm's union range syntax.
    const version = name === "react" && range === "^18.0.0 || ^19.0.0" ? "^19.0.0" : range;
    const internal = packages.some(({ manifest }) => manifest.name === name);
    const target = internal
      ? `jsr:@applesauce/${name.slice("applesauce-".length)}@${version}`
      : `npm:${name}@${version}`;
    const alias = name.startsWith("@types/") ? name.slice("@types/".length).replace("__", "/") : name;
    imports[alias] = target;
    imports[`${alias}/`] = `${target}/`;
    if (internal) {
      const dependency = packages.find(({ manifest }) => manifest.name === name);
      for (const key of Object.keys(createExports(dependency))) {
        if (key !== ".") imports[`${name}${key.slice(1)}`] = `${target}${key.slice(1)}`;
      }
    }
  }
  return {
    name: `@applesauce/${manifest.name.slice("applesauce-".length)}`,
    version: manifest.version,
    license: manifest.license,
    exports,
    ...(Object.keys(imports).length ? { imports } : {}),
    publish: {
      include: ["src", "README.md", "LICENSE", "package.json", "deno.json"],
      exclude: ["src/**/__tests__/**", "src/**/__snapshots__/**", "src/**/*.test.*"],
    },
  };
}

export async function syncManifests({ check = false, directory = root } = {}) {
  const packages = getPackages(directory);
  for (const pkg of packages) {
    const path = join(pkg.path, "deno.json");
    const expected = await format(JSON.stringify(createManifest(pkg, packages)), {
      ...(await resolveConfig(path)),
      filepath: path,
    });
    if (check) {
      if (!existsSync(path) || readFileSync(path, "utf8") !== expected) {
        throw new Error(`${relative(directory, path)} is out of date; run pnpm jsr:sync`);
      }
    } else writeFileSync(path, expected);
  }
  return packages.length;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--check")) throw new Error("Usage: node scripts/jsr-manifests.mjs [--check]");
  const check = args.includes("--check");
  console.log(`${check ? "Checked" : "Updated"} ${await syncManifests({ check })} JSR manifests`);
}

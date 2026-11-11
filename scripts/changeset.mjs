import readChangesets from "@changesets/read";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { releasePackages } from "./release-packages.mjs";

export async function runChangeset(args, root = fileURLToPath(new URL("../", import.meta.url))) {
  let expandedChangesetPath;
  let originalChangeset;

  try {
    if (["version", "status"].includes(args[0]) && !args.includes("--snapshot")) {
      const changesets = await readChangesets(root);
      const majorPackages = new Set(
        changesets.flatMap(({ releases }) => releases.filter(({ type }) => type === "major").map(({ name }) => name)),
      );

      if (releasePackages.some((name) => majorPackages.has(name))) {
        const majorVersions = releasePackages.map((name) => {
          const manifest = JSON.parse(
            readFileSync(join(root, "packages", name.replace("applesauce-", ""), "package.json"), "utf8"),
          );
          return manifest.version.split(".")[0];
        });

        if (new Set(majorVersions).size !== 1) {
          throw new Error("Coordinated major releases require all release packages to start on the same major version");
        }

        const missingPackages = releasePackages.filter((name) => !majorPackages.has(name));
        if (missingPackages.length) {
          const majorChangeset = changesets.find(({ releases }) =>
            releases.some(({ name, type }) => type === "major" && releasePackages.includes(name)),
          );
          expandedChangesetPath = join(root, ".changeset", `${majorChangeset.id}.md`);
          originalChangeset = readFileSync(expandedChangesetPath, "utf8");
          const releases = new Map(majorChangeset.releases.map(({ name, type }) => [name, type]));
          for (const name of missingPackages) releases.set(name, "major");

          const frontmatter = [...releases].map(([name, type]) => `"${name}": ${type}`).join("\n");
          const expandedChangeset = originalChangeset.replace(
            /^\s*---\r?\n[\s\S]*?\r?\n---/,
            `---\n${frontmatter}\n---`,
          );
          writeFileSync(expandedChangesetPath, expandedChangeset);
        }
      }
    }

    const cliPath = fileURLToPath(import.meta.resolve("@changesets/cli/bin.js"));
    const result = spawnSync(process.execPath, [cliPath, ...args], {
      cwd: root,
      stdio: "inherit",
    });
    if (result.error) throw result.error;
    return result.status ?? 1;
  } finally {
    // Versioning consumes the changeset; status and failed commands leave it to restore.
    if (expandedChangesetPath && existsSync(expandedChangesetPath)) {
      writeFileSync(expandedChangesetPath, originalChangeset);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runChangeset(process.argv.slice(2));
}

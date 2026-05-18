import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { copyDir, emptyDir, parseFrontmatter, sha256Hex, walkFiles } from "./helpers.mjs";
import { packTarGz } from "./pack-tar.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(appRoot, "..", "..");

const skillSourceDir = path.join(__dirname, "skill");
const distDir = path.join(appRoot, "dist");
const wellKnownDir = path.join(distDir, ".well-known", "agent-skills");
const docsPublicWellKnown = path.join(repoRoot, "apps", "docs", "public", ".well-known");

const SKILL_NAME = "applesauce";
const skillOutputDir = path.join(distDir, SKILL_NAME);
const ARCHIVE_FILENAME = `${SKILL_NAME}.tar.gz`;
const DISCOVERY_SCHEMA = "https://schemas.agentskills.io/discovery/0.2.0/schema.json";

async function main() {
  console.log("[agent-skills] Building skill bundle...");

  await emptyDir(distDir);
  await fs.mkdir(wellKnownDir, { recursive: true });
  await fs.mkdir(skillOutputDir, { recursive: true });

  const description = await stageSkill();
  await stagePackages();
  const examples = await stageExamples();

  console.log(`[agent-skills] Built ${examples.length} example asset(s)`);

  const archiveBytes = await packTarGz(skillOutputDir);
  const archivePath = path.join(wellKnownDir, ARCHIVE_FILENAME);
  await fs.writeFile(archivePath, archiveBytes);
  const digest = `sha256:${sha256Hex(archiveBytes)}`;

  const index = {
    $schema: DISCOVERY_SCHEMA,
    skills: [
      {
        name: SKILL_NAME,
        type: "archive",
        description,
        url: ARCHIVE_FILENAME,
        digest,
      },
    ],
  };
  await fs.writeFile(path.join(wellKnownDir, "index.json"), `${JSON.stringify(index, null, 2)}\n`, "utf8");

  await mirrorToDocsPublic();

  const archiveBytesKb = (archiveBytes.length / 1024).toFixed(1);
  console.log(`[agent-skills] Skill directory at ${path.relative(appRoot, skillOutputDir)}`);
  console.log(`[agent-skills] Done. ${ARCHIVE_FILENAME} (${archiveBytesKb} KiB) digest=${digest.slice(0, 19)}...`);
  console.log(`[agent-skills] Mirrored to ${path.relative(repoRoot, docsPublicWellKnown)}`);
}

async function stageSkill() {
  const skillMdPath = path.join(skillSourceDir, "SKILL.md");
  const raw = await fs.readFile(skillMdPath, "utf8");
  const { data } = parseFrontmatter(raw);
  if (!data.name || !data.description) {
    throw new Error("SKILL.md is missing required frontmatter fields (name, description)");
  }
  if (data.name !== SKILL_NAME) {
    throw new Error(`SKILL.md frontmatter name "${data.name}" does not match expected "${SKILL_NAME}"`);
  }
  await fs.writeFile(path.join(skillOutputDir, "SKILL.md"), raw, "utf8");

  const referencesSrc = path.join(skillSourceDir, "references");
  if (await exists(referencesSrc)) {
    for await (const file of walkFiles(referencesSrc)) {
      const rel = path.relative(referencesSrc, file);
      const dest = path.join(skillOutputDir, "references", rel);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.copyFile(file, dest);
    }
  }

  return data.description;
}

async function stagePackages() {
  const packagesRoot = path.join(repoRoot, "packages");
  const outputDir = path.join(skillOutputDir, "references", "packages");
  await fs.mkdir(outputDir, { recursive: true });

  const entries = await fs.readdir(packagesRoot, { withFileTypes: true });
  let count = 0;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const readmePath = path.join(packagesRoot, entry.name, "README.md");
    if (!(await exists(readmePath))) continue;
    const dest = path.join(outputDir, `${entry.name}.md`);
    await fs.copyFile(readmePath, dest);
    count++;
  }
  console.log(`[agent-skills] Built ${count} package reference(s)`);
}

async function stageExamples() {
  const examplesRoot = path.join(repoRoot, "apps", "examples", "src", "examples");
  const assetsDir = path.join(skillOutputDir, "assets", "examples");
  const referencesDir = path.join(skillOutputDir, "references");
  await fs.mkdir(assetsDir, { recursive: true });
  await fs.mkdir(referencesDir, { recursive: true });

  const examples = [];
  for await (const sourcePath of walkFiles(examplesRoot)) {
    if (!sourcePath.endsWith(".ts") && !sourcePath.endsWith(".tsx")) continue;

    const relativePath = normalizeRelativePath(path.relative(examplesRoot, sourcePath));
    const extension = sourcePath.endsWith(".tsx") ? "tsx" : "ts";
    const id = relativePath.replace(/\.(tsx|ts)$/i, "");

    const raw = await fs.readFile(sourcePath, "utf8");
    const { metadata } = parseExampleMetadata(raw);
    const assetPath = normalizeRelativePath(path.join("assets", "examples", `${id}.${extension}`));

    const destPath = path.join(assetsDir, `${id}.${extension}`);
    await fs.mkdir(path.dirname(destPath), { recursive: true });
    await fs.copyFile(sourcePath, destPath);

    examples.push({
      id,
      assetPath,
      description: metadata?.description ?? id,
    });
  }

  examples.sort((a, b) => a.assetPath.localeCompare(b.assetPath));

  await fs.writeFile(path.join(referencesDir, "examples.md"), renderExamplesIndex(examples), "utf8");
  return examples;
}

function parseExampleMetadata(source) {
  const jsdocRegex = /^\/\*\*\s*\n([\s\S]*?)\*\//;
  const match = source.match(jsdocRegex);
  if (!match) return { metadata: null, code: source.trim() };

  const jsdocContent = match[1];
  const code = source.replace(jsdocRegex, "").trimStart();
  const metadata = {};
  const descriptionLines = [];

  for (const rawLine of jsdocContent.split("\n")) {
    const line = rawLine.trim().replace(/^\*\s?/, "");
    if (!line) continue;
    if (line.startsWith("@")) {
      continue;
    } else {
      descriptionLines.push(line);
    }
  }

  if (descriptionLines.length > 0) {
    metadata.description = descriptionLines.join(" ").trim();
  }

  return { metadata, code: code.trim() };
}

function renderExamplesIndex(examples) {
  const lines = [
    "# Examples",
    "",
    "Example source files included with this skill. Read the matching file from `assets/examples/` when you need a complete implementation.",
    "",
  ];

  for (const example of examples) {
    lines.push(`- \`${example.assetPath}\` — ${example.description}`);
  }

  lines.push("");
  return lines.join("\n");
}

function normalizeRelativePath(value) {
  return value.split(path.sep).join("/");
}

async function mirrorToDocsPublic() {
  await fs.rm(docsPublicWellKnown, { recursive: true, force: true });
  await copyDir(path.join(distDir, ".well-known"), docsPublicWellKnown);
}

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

main().catch((error) => {
  console.error("[agent-skills] Build failed", error);
  process.exitCode = 1;
});

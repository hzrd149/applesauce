import { promises as fs } from "node:fs";
import path from "node:path";
import { walkFiles, normalizeSlashes, formatTitleFromPath } from "./helpers.mjs";

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

    if (line.startsWith("@tags")) {
      metadata.tags = line
        .replace("@tags", "")
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean);
    } else if (line.startsWith("@related")) {
      metadata.related = line
        .replace("@related", "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    } else if (line.startsWith("@")) {
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

function buildExampleMarkdown({ title, metadata, code, language }) {
  const lines = [`# ${title}`, ""];

  if (metadata?.description) lines.push(`- Description: ${metadata.description}`);
  if (metadata?.tags?.length) lines.push(`- Tags: ${metadata.tags.join(", ")}`);
  if (metadata?.related?.length) lines.push(`- Related: ${metadata.related.join(", ")}`);

  lines.push("", "```" + language, code.trimEnd(), "```", "");
  return lines.join("\n");
}

/**
 * Collect all example files from apps/examples/src/examples/,
 * convert them to markdown in dist/examples/,
 * and return an array of { id, relativePath, title, description, tags } entries.
 */
export async function buildExamples(repoRoot, distDir) {
  const examplesSourceDir = path.join(repoRoot, "apps", "examples", "src", "examples");
  const distExamplesDir = path.join(distDir, "examples");
  const examples = [];

  await fs.mkdir(distExamplesDir, { recursive: true });

  for await (const filePath of walkFiles(examplesSourceDir)) {
    if (!filePath.endsWith(".ts") && !filePath.endsWith(".tsx")) continue;

    const relativePath = path.relative(examplesSourceDir, filePath);
    const id = relativePath.replace(/\.(tsx|ts)$/i, "");
    const destination = path.join(distExamplesDir, `${id}.md`);
    const raw = await fs.readFile(filePath, "utf8");
    const { metadata, code } = parseExampleMetadata(raw);

    const title = metadata?.description ?? formatTitleFromPath(id);
    const markdown = buildExampleMarkdown({
      title,
      metadata,
      code,
      language: filePath.endsWith(".ts") ? "ts" : "tsx",
    });

    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, markdown, "utf8");

    examples.push({
      id,
      relativePath: normalizeSlashes(path.join("examples", `${id}.md`)),
      title,
      description: metadata?.description ?? null,
      tags: metadata?.tags ?? [],
    });
  }

  examples.sort((a, b) => a.id.localeCompare(b.id));
  console.log(`[llms] Converted ${examples.length} examples`);
  return examples;
}

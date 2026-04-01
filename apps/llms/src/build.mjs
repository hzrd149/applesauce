import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(appRoot, "..", "..");

const docsSourceDir = path.join(repoRoot, "apps", "docs");
const examplesSourceDir = path.join(repoRoot, "apps", "examples", "src", "examples");
const distDir = path.join(appRoot, "dist");
const distDocsDir = path.join(distDir, "docs");
const distExamplesDir = path.join(distDir, "examples");
const templatePath = path.join(__dirname, "template.md");

const DEFAULT_TEMPLATE = `# Applesauce LLMS Pack
_Generated {{generatedAt}}_

## Docs
{{docsIndex}}

## Examples
{{examplesIndex}}

> Regenerate with: \`pnpm --filter applesauce-llms build\``;

const IGNORED_FOLDERS = new Set(["node_modules", ".vitepress", ".git"]);

async function main() {
  console.log("[llms] Generating bundle...");
  await emptyDir(distDir);

  const [docs, examples] = await Promise.all([collectDocs(), collectExamples()]);
  const template = await loadTemplate();
  const llmsMarkdown = buildLlmsMarkdown(docs, examples, template);

  await Promise.all([
    fs.writeFile(path.join(distDir, "llms.txt"), llmsMarkdown, "utf8"),
    fs.writeFile(path.join(distDir, "llms.md"), llmsMarkdown, "utf8"),
  ]);

  console.log(
    `[llms] Done. Exported ${docs.length} docs and ${examples.length} examples to ${path.relative(repoRoot, distDir)}`,
  );
}

async function emptyDir(target) {
  await fs.rm(target, { recursive: true, force: true });
  await fs.mkdir(target, { recursive: true });
}

async function* walkFiles(baseDir) {
  const entries = await fs.readdir(baseDir, { withFileTypes: true });
  for (const entry of entries) {
    if (IGNORED_FOLDERS.has(entry.name)) {
      continue;
    }

    const fullPath = path.join(baseDir, entry.name);
    if (entry.isDirectory()) {
      yield* walkFiles(fullPath);
    } else if (entry.isFile()) {
      yield fullPath;
    }
  }
}

async function collectDocs() {
  const docs = [];
  await fs.mkdir(distDocsDir, { recursive: true });

  for await (const filePath of walkFiles(docsSourceDir)) {
    if (!filePath.endsWith(".md")) {
      continue;
    }

    const relativePath = path.relative(docsSourceDir, filePath);
    const destination = path.join(distDocsDir, relativePath);
    const raw = await fs.readFile(filePath, "utf8");
    const title = extractHeading(raw, formatTitleFromPath(relativePath));

    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, raw, "utf8");

    docs.push({
      relativePath: normalizeSlashes(path.join("docs", relativePath)),
      title,
    });
  }

  docs.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  console.log(`[llms] Copied ${docs.length} docs`);
  return docs;
}

async function collectExamples() {
  const examples = [];
  await fs.mkdir(distExamplesDir, { recursive: true });

  for await (const filePath of walkFiles(examplesSourceDir)) {
    if (!filePath.endsWith(".ts") && !filePath.endsWith(".tsx")) {
      continue;
    }

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

function parseExampleMetadata(source) {
  const jsdocRegex = /^\/\*\*\s*\n([\s\S]*?)\*\//;
  const match = source.match(jsdocRegex);
  if (!match) {
    return { metadata: null, code: source.trim() };
  }

  const jsdocContent = match[1];
  const code = source.replace(jsdocRegex, "").trimStart();
  const metadata = {};
  const descriptionLines = [];

  for (const rawLine of jsdocContent.split("\n")) {
    const line = rawLine.trim().replace(/^\*\s?/, "");
    if (!line) {
      continue;
    }

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

  if (metadata?.description) {
    lines.push(`- Description: ${metadata.description}`);
  }

  if (metadata?.tags?.length) {
    lines.push(`- Tags: ${metadata.tags.join(", ")}`);
  }

  if (metadata?.related?.length) {
    lines.push(`- Related: ${metadata.related.join(", ")}`);
  }

  lines.push("", "```" + language, code.trimEnd(), "```", "");
  return lines.join("\n");
}

function extractHeading(content, fallback) {
  let body = content;
  if (body.startsWith("---")) {
    const closing = body.indexOf("\n---", 3);
    if (closing !== -1) {
      body = body.slice(closing + 4);
    }
  }

  for (const line of body.split(/\r?\n/)) {
    const match = line.match(/^#{1,6}\s+(.+)/);
    if (match) {
      return match[1].trim();
    }
  }
  return fallback;
}

function formatTitleFromPath(relativePath) {
  return normalizeSlashes(relativePath)
    .replace(/\.md$/i, "")
    .split("/")
    .map((segment) => segment.replace(/[-_]/g, " "))
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" / ");
}

function normalizeSlashes(value) {
  return value.split(path.sep).join("/");
}

function buildLlmsMarkdown(docs, examples, template) {
  const generatedAt = new Date().toISOString();

  const docIndexLines = buildDocsNestedList(docs);
  const exampleIndexLines = examples.map((example) => {
    const description = example.description ? ` — ${example.description}` : "";
    return `- [${formatTitleFromPath(example.id)}](${example.relativePath})${description}`;
  });

  const replacements = {
    generatedAt,
    docsIndex: docIndexLines.length ? docIndexLines.join("\n") : "_No docs available._",
    examplesIndex: exampleIndexLines.length ? exampleIndexLines.join("\n") : "_No examples available._",
  };

  return renderTemplate(template, replacements);
}

function buildDocsNestedList(docs) {
  const root = createDocNode();

  for (const doc of docs) {
    const withoutExtension = doc.relativePath.replace(/\.md$/i, "");
    const segments = withoutExtension.split("/");
    const directories = segments.slice(0, -1);

    let current = root;
    for (const directory of directories) {
      if (!current.directories.has(directory)) {
        current.directories.set(directory, createDocNode(directory));
      }
      current = current.directories.get(directory);
    }

    current.docs.push(doc);
  }

  return renderDocTree(root, 0);
}

function createDocNode(name = null) {
  return {
    name,
    directories: new Map(),
    docs: [],
  };
}

function renderDocTree(node, depth) {
  const lines = [];
  const indent = "  ".repeat(depth);

  if (node.name) {
    lines.push(`${indent}- \`${node.name}\``);
  }

  const childDepth = node.name ? depth + 1 : depth;

  const sortedDirectories = Array.from(node.directories.values()).sort((a, b) =>
    (a.name ?? "").localeCompare(b.name ?? ""),
  );
  for (const directory of sortedDirectories) {
    lines.push(...renderDocTree(directory, childDepth));
  }

  const sortedDocs = [...node.docs].sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  for (const doc of sortedDocs) {
    lines.push(`${"  ".repeat(childDepth)}- [${doc.title}](${doc.relativePath})`);
  }

  return lines;
}

async function loadTemplate() {
  try {
    const raw = await fs.readFile(templatePath, "utf8");
    if (raw.trim().length === 0) {
      return DEFAULT_TEMPLATE;
    }
    return raw;
  } catch (error) {
    if (error && error.code !== "ENOENT") {
      console.warn("[llms] Failed to read template.md, falling back to default", error);
    }
    return DEFAULT_TEMPLATE;
  }
}

function renderTemplate(template, replacements) {
  let output = template;
  for (const [key, value] of Object.entries(replacements)) {
    const token = `{{${key}}}`;
    output = output.split(token).join(value);
  }
  return output;
}

main().catch((error) => {
  console.error("[llms] Build failed", error);
  process.exitCode = 1;
});

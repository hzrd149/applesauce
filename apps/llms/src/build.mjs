import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { emptyDir, formatTitleFromPath } from "./helpers.mjs";
import { buildDocs } from "./build-docs.mjs";
import { buildExamples } from "./build-examples.mjs";
import { buildExports } from "./build-exports.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(appRoot, "..", "..");
const distDir = path.join(appRoot, "dist");
const templatePath = path.join(__dirname, "template.md");

const DEFAULT_TEMPLATE = `# Applesauce LLMS Pack
_Generated {{generatedAt}}_

## Docs
{{docsIndex}}

## Examples
{{examplesIndex}}

## Exported API Reference
{{exportsIndex}}

> Regenerate with: \`pnpm --filter applesauce-llms build\``;

async function main() {
  console.log("[llms] Generating bundle...");
  await emptyDir(distDir);

  const [docs, examples, exportPackages] = await Promise.all([
    buildDocs(repoRoot, distDir),
    buildExamples(repoRoot, distDir),
    buildExports(repoRoot, distDir),
  ]);

  const template = await loadTemplate();
  const llmsMarkdown = renderLlms(docs, examples, exportPackages, template);

  await Promise.all([
    fs.writeFile(path.join(distDir, "llms.txt"), llmsMarkdown, "utf8"),
    fs.writeFile(path.join(distDir, "llms.md"), llmsMarkdown, "utf8"),
  ]);

  console.log(
    `[llms] Done. Exported ${docs.length} docs and ${examples.length} examples to ${path.relative(repoRoot, distDir)}`,
  );
}

function renderLlms(docs, examples, exportPackages, template) {
  const docsIndex = buildDocsNestedList(docs);
  const exampleLines = examples.map((ex) => {
    const desc = ex.description ? ` — ${ex.description}` : "";
    return `- [${formatTitleFromPath(ex.id)}](${ex.relativePath})${desc}`;
  });

  const exportsLines = exportPackages.map((pkg) => {
    const subpaths = pkg.subpaths.map((s) => `\`${s}\``).join(", ");
    return `- [${pkg.npmName}](${pkg.relativePath}) (${pkg.symbolCount} exports) — ${subpaths}`;
  });

  return renderTemplate(template, {
    generatedAt: new Date().toISOString(),
    docsIndex: docsIndex.length ? docsIndex.join("\n") : "_No docs available._",
    examplesIndex: exampleLines.length ? exampleLines.join("\n") : "_No examples available._",
    exportsIndex: exportsLines.length ? exportsLines.join("\n") : "_No exports available._",
  });
}

// --- Docs nested list rendering ---

function buildDocsNestedList(docs) {
  const root = { name: null, directories: new Map(), docs: [] };

  for (const doc of docs) {
    const segments = doc.relativePath.replace(/\.md$/i, "").split("/");
    const dirs = segments.slice(0, -1);
    let current = root;
    for (const dir of dirs) {
      if (!current.directories.has(dir)) {
        current.directories.set(dir, { name: dir, directories: new Map(), docs: [] });
      }
      current = current.directories.get(dir);
    }
    current.docs.push(doc);
  }

  return renderDocTree(root, 0);
}

function renderDocTree(node, depth) {
  const lines = [];
  const indent = "  ".repeat(depth);

  if (node.name) lines.push(`${indent}- \`${node.name}\``);

  const childDepth = node.name ? depth + 1 : depth;

  const sortedDirs = [...node.directories.values()].sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
  for (const dir of sortedDirs) lines.push(...renderDocTree(dir, childDepth));

  const sortedDocs = [...node.docs].sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  for (const doc of sortedDocs) lines.push(`${"  ".repeat(childDepth)}- [${doc.title}](${doc.relativePath})`);

  return lines;
}

// --- Template loading ---

async function loadTemplate() {
  try {
    const raw = await fs.readFile(templatePath, "utf8");
    if (raw.trim().length === 0) return DEFAULT_TEMPLATE;
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
    output = output.split(`{{${key}}}`).join(value);
  }
  return output;
}

main().catch((error) => {
  console.error("[llms] Build failed", error);
  process.exitCode = 1;
});

import { promises as fs } from "node:fs";
import path from "node:path";
import { walkFiles, normalizeSlashes, formatTitleFromPath } from "./helpers.mjs";

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
    if (match) return match[1].trim();
  }
  return fallback;
}

/**
 * Collect all markdown docs from apps/docs/, copy them to dist/docs/,
 * and return an array of { relativePath, title } entries.
 */
export async function buildDocs(repoRoot, distDir) {
  const docsSourceDir = path.join(repoRoot, "apps", "docs");
  const distDocsDir = path.join(distDir, "docs");
  const docs = [];

  await fs.mkdir(distDocsDir, { recursive: true });

  for await (const filePath of walkFiles(docsSourceDir)) {
    if (!filePath.endsWith(".md")) continue;

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

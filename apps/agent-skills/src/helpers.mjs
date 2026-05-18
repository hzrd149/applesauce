import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

const IGNORED_FOLDERS = new Set(["node_modules", ".vitepress", ".git", "dist"]);

export async function emptyDir(target) {
  await fs.rm(target, { recursive: true, force: true });
  await fs.mkdir(target, { recursive: true });
}

export async function copyDir(source, destination) {
  await fs.mkdir(destination, { recursive: true });
  const entries = await fs.readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    if (IGNORED_FOLDERS.has(entry.name)) continue;
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) await copyDir(from, to);
    else if (entry.isFile()) await fs.copyFile(from, to);
  }
}

export async function* walkFiles(baseDir) {
  const entries = await fs.readdir(baseDir, { withFileTypes: true });
  for (const entry of entries) {
    if (IGNORED_FOLDERS.has(entry.name)) continue;
    const fullPath = path.join(baseDir, entry.name);
    if (entry.isDirectory()) yield* walkFiles(fullPath);
    else if (entry.isFile()) yield fullPath;
  }
}

export function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function parseFrontmatter(source) {
  if (!source.startsWith("---")) return { data: {}, body: source };
  const end = source.indexOf("\n---", 3);
  if (end === -1) return { data: {}, body: source };

  const raw = source.slice(3, end).trim();
  const body = source.slice(end + 4).replace(/^\r?\n/, "");
  const data = {};

  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!match) continue;
    const [, key, value] = match;
    data[key] = value.replace(/^['"]|['"]$/g, "").trim();
  }

  return { data, body };
}

import { promises as fs } from "node:fs";
import path from "node:path";

const IGNORED_FOLDERS = new Set(["node_modules", ".vitepress", ".git"]);

export async function emptyDir(target) {
  await fs.rm(target, { recursive: true, force: true });
  await fs.mkdir(target, { recursive: true });
}

export async function* walkFiles(baseDir) {
  const entries = await fs.readdir(baseDir, { withFileTypes: true });
  for (const entry of entries) {
    if (IGNORED_FOLDERS.has(entry.name)) continue;

    const fullPath = path.join(baseDir, entry.name);
    if (entry.isDirectory()) {
      yield* walkFiles(fullPath);
    } else if (entry.isFile()) {
      yield fullPath;
    }
  }
}

export function normalizeSlashes(value) {
  return value.split(path.sep).join("/");
}

export function formatTitleFromPath(relativePath) {
  return normalizeSlashes(relativePath)
    .replace(/\.md$/i, "")
    .split("/")
    .map((segment) => segment.replace(/[-_]/g, " "))
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" / ");
}

import { isNameValueTag, processTags } from "applesauce-core/helpers/tags";
import { ensureProtocol } from "applesauce-core/helpers/url";

/** Parses a server string or URL to a root URL */
export function normalizeBlossomServer(s: string | URL): URL {
  return new URL("/", typeof s === "string" ? ensureProtocol(s, "https:") : s);
}

export const BLOSSOM_SERVER_LIST_KIND = 10063;

/** Check if two servers are the same */
export function areBlossomServersEqual(a: string | URL, b: string | URL): boolean {
  return normalizeBlossomServer(a).href === normalizeBlossomServer(b).href;
}

/** Checks if a string is a sha256 hash */
export function isSha256(str: string): boolean {
  return !!str.match(/^[0-9a-f]{64}$/);
}

/** Returns an ordered array of servers found in a server list event (10063) */
export function getBlossomServersFromList(event: { tags: string[][] } | string[][]): URL[] {
  const tags = Array.isArray(event) ? event : event.tags;

  return processTags(tags, (tag) => {
    if (isNameValueTag(tag, "server") && URL.canParse(tag[1])) return new URL("/", tag[1]);
    else return undefined;
  });
}

export interface ParsedBlossomURI {
  /** 64 character lowercase hex sha256 hash of the blob */
  sha256: string;
  /** File extension without the leading dot (e.g. "pdf", "png", "bin") */
  ext: string;
  /** Optional exact blob size in bytes */
  size?: number;
  /** Server hints from repeated `xs` query parameters */
  servers: string[];
  /** Author hex pubkeys from repeated `as` query parameters */
  authors: string[];
}

/**
 * Parses a BUD-10 `blossom:` URI into its components.
 *
 * @returns The parsed URI, or `null` if the string is not a valid blossom URI.
 * @see https://github.com/hzrd149/blossom/blob/master/buds/10.md
 */
export function parseBlossomURI(uri: string | URL): ParsedBlossomURI | null {
  let url: URL;
  try {
    url = typeof uri === "string" ? new URL(uri) : uri;
  } catch {
    return null;
  }

  if (url.protocol !== "blossom:") return null;

  const dotIndex = url.pathname.indexOf(".");
  if (dotIndex === -1) return null;

  const sha256 = url.pathname.slice(0, dotIndex);
  const ext = url.pathname.slice(dotIndex + 1);

  if (!isSha256(sha256)) return null;
  if (ext.length === 0) return null;

  const servers = url.searchParams.getAll("xs");
  const authors = url.searchParams.getAll("as");

  let size: number | undefined;
  const sz = url.searchParams.get("sz");
  if (sz !== null) {
    const parsed = Number(sz);
    if (Number.isInteger(parsed) && parsed > 0) size = parsed;
  }

  return { sha256, ext, size, servers, authors };
}

/**
 * Encodes a parsed blossom URI back into a string.
 * Defaults `ext` to "bin" if empty, per BUD-10.
 */
export function encodeBlossomURI(data: ParsedBlossomURI): string {
  const ext = data.ext || "bin";
  const url = new URL(`blossom:${data.sha256}.${ext}`);
  for (const server of data.servers) url.searchParams.append("xs", server);
  for (const author of data.authors) url.searchParams.append("as", author);
  if (data.size !== undefined) url.searchParams.set("sz", String(data.size));
  return url.toString();
}

/** A method that merges multiple arrays of blossom servers into a single array of unique servers */
export function mergeBlossomServers<T extends URL | string | (string | URL)>(
  ...servers: (T | null | undefined | (T | null | undefined)[])[]
): T[] {
  let merged: T[] = [];
  const seen = new Set<string>();

  for (const arg of servers) {
    let arr = Array.isArray(arg) ? arg : [arg];
    for (const s of arr) {
      if (s === null || s === undefined) continue;

      const root = normalizeBlossomServer(s);
      const href = root.href;
      if (seen.has(href)) continue;
      seen.add(href);

      merged.push((typeof s === "string" ? href : root) as T);
    }
  }

  return merged;
}

/** Alias for {@link mergeBlossomServers} */
export const blossomServers = mergeBlossomServers;

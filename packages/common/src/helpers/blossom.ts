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

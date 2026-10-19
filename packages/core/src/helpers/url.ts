import { LRU } from "./lru.js";

/** Returns a URL object, preserving existing instances */
export const convertToUrl = (url: string | URL) => (url instanceof URL ? url : new URL(url));
/**
 * Returns the last path segment or the filename query parameter
 * @throws if a string input is not a valid absolute URL
 */
export function getURLFilename(url: string | URL): string | undefined {
  if (typeof url !== "string")
    return url.pathname.split("/").pop()?.toLocaleLowerCase() || url.searchParams.get("filename")?.toLocaleLowerCase();
  const cached = getURLCache(url);
  if (cached.filename !== undefined) return cached.filename ?? undefined;
  const simple = getSimpleURL(url, cached);
  let filename: string | undefined;
  if (simple) {
    filename = simple.pathname.slice(simple.pathname.lastIndexOf("/") + 1).toLocaleLowerCase();
    if (!filename) {
      const query = simple.href.indexOf("?");
      const hash = simple.href.indexOf("#");
      filename =
        query === -1 || (hash !== -1 && query > hash)
          ? undefined
          : new URLSearchParams(simple.href.slice(query + 1, hash === -1 ? undefined : hash))
              .get("filename")
              ?.toLocaleLowerCase();
    }
  } else filename = getURLFilename(new URL(url));
  cached.filename = filename ?? null;
  return filename;
}

/**
 * Returns the serialized pathname of an absolute URL
 * @throws if a string input is not a valid absolute URL
 */
export function getURLPathname(url: string | URL): string {
  if (typeof url !== "string") return url.pathname;
  const cached = getURLCache(url);
  return (cached.pathname ??= getSimpleURL(url, cached)?.pathname ?? new URL(url).pathname);
}

/**
 * Returns the canonical hostname of an absolute URL
 * @throws if a string input is not a valid absolute URL
 */
export function getURLHostname(url: string | URL): string {
  if (typeof url !== "string") return url.hostname;
  const cached = getURLCache(url);
  return (cached.hostname ??= getSimpleURL(url, cached)?.hostname ?? new URL(url).hostname);
}

function hasMediaExtension(url: string | URL, extensions: string[]): boolean {
  try {
    const filename = getURLFilename(url);
    return !!filename && extensions.some((ext) => filename.endsWith(ext));
  } catch {
    return false;
  }
}

export const IMAGE_EXT = [".svg", ".gif", ".png", ".jpg", ".jpeg", ".webp", ".avif"];
export const VIDEO_EXT = [".mp4", ".mkv", ".webm", ".mov"];
export const STREAM_EXT = [".m3u8"];
export const AUDIO_EXT = [".mp3", ".wav", ".ogg", ".aac", ".m4a"];

/** Checks if a URL has an image filename */
export function isImageURL(url: string | URL) {
  return hasMediaExtension(url, IMAGE_EXT);
}

/** Checks if a URL has a video filename */
export function isVideoURL(url: string | URL) {
  return hasMediaExtension(url, VIDEO_EXT);
}

/** Checks if a URL has a stream filename */
export function isStreamURL(url: string | URL) {
  return hasMediaExtension(url, STREAM_EXT);
}

/** Checks if a URL has an audio filename */
export function isAudioURL(url: string | URL) {
  return hasMediaExtension(url, AUDIO_EXT);
}

/** Tests if two URLs are the same */
export function isSameURL(a: string | URL, b: string | URL) {
  try {
    a = normalizeURL(a);
    b = normalizeURL(b);

    return a === b;
  } catch (error) {
    return false;
  }
}

/** Adds a protocol to a URL string if its missing one */
export function ensureProtocol(url: string, protocol = "https:"): string {
  // Check if the URL already has a protocol
  if (/^[a-zA-Z][a-zA-Z0-9+.-]+:/.test(url)) return url;
  return protocol + "//" + url;
}

/** Converts a domain or HTTP URL to a WebSocket URL */
export function ensureWebSocketURL<T extends string | URL>(url: T): T {
  if (typeof url === "string") {
    const cached = getURLCache(url);
    if (cached.websocket !== undefined) return cached.websocket as T;
    const simple = getSimpleURL(ensureProtocol(url, "wss:"));
    if (simple) {
      const protocol = simple.protocol === "http:" || simple.protocol === "ws:" ? "ws:" : "wss:";
      cached.websocket =
        protocol === simple.protocol ? simple.href : protocol + simple.href.slice(simple.protocol.length);
      return cached.websocket as T;
    }
  }
  const p = typeof url === "string" ? new URL(ensureProtocol(url, "wss:")) : new URL(url);
  if (p.protocol === "http:") p.protocol = "ws:";
  else if (p.protocol === "https:") p.protocol = "wss:";
  else if (p.protocol !== "ws:") p.protocol = "wss:";

  if (typeof url === "string") {
    const result = p.toString();
    getURLCache(url).websocket = result;
    return result as T;
  }
  return p as T;
}

/** Converts a domain or WS URL to a HTTP URL */
export function ensureHttpURL<T extends string | URL>(url: T): T {
  if (typeof url === "string") {
    const cached = getURLCache(url);
    if (cached.http !== undefined) return cached.http as T;
    const simple = getSimpleURL(ensureProtocol(url, "http:"));
    if (simple) {
      const protocol = simple.protocol === "http:" || simple.protocol === "ws:" ? "http:" : "https:";
      cached.http = protocol === simple.protocol ? simple.href : protocol + simple.href.slice(simple.protocol.length);
      return cached.http as T;
    }
  }
  const p = typeof url === "string" ? new URL(ensureProtocol(url, "http:")) : new URL(url);
  if (p.protocol === "ws:") p.protocol = "http:";
  else if (p.protocol === "wss:") p.protocol = "https:";
  else if (p.protocol !== "http:") p.protocol = "https:";

  if (typeof url === "string") {
    const result = p.toString();
    getURLCache(url).http = result;
    return result as T;
  }
  return p as T;
}

// Only handle ASCII HTTP/WebSocket URLs whose serialization is unambiguous here.
const SIMPLE_URL =
  /^(wss?|https?):\/\/([a-z0-9_-]+(?:\.[a-z0-9_-]+)*\.?)(?::([0-9]{1,5}))?(\/[a-z0-9_~.!$&()*+,;=:@%\/-]*)?(\?[a-z0-9_~.!$&()*+,;=:@%/?-]*)?(#[a-z0-9_~.!$&()*+,;=:@%/?#-]*)?$/i;
const COMPLEX_HOST = /(?:^|\.)xn--|(?:^|\.)(?:[0-9]+|0x[0-9a-f]*)\.?$/i;
const DOT_SEGMENT = /(?:^|\/)(?:\.|%2e){1,2}(?:\/|$)/i;

type SimpleURL = {
  href: string;
  protocol: string;
  hostname: string;
  pathname: string;
};

type CachedURL = {
  simple?: SimpleURL | null;
  serialized?: string;
  normalized?: string;
  websocket?: string;
  http?: string;
  filename?: string | null;
  pathname?: string;
  hostname?: string;
};

// One bounded cache shares parsing and completed conversions across all string helpers.
const urlCache = new LRU<CachedURL>(1024);

function getURLCache(input: string): CachedURL {
  const cached = urlCache.get(input);
  if (cached) return cached;
  const result: CachedURL = {};
  // Bound retained key size as well as entry count; oversized URLs are not cached.
  if (input.length <= 4096) urlCache.set(input, result);
  return result;
}

function getSimpleURL(input: string, cached = getURLCache(input)): SimpleURL | undefined {
  if (cached.simple !== undefined) return cached.simple ?? undefined;
  // Remember fast-path misses too, while leaving validation to the native parser.
  cached.simple = null;
  const match = SIMPLE_URL.exec(input);
  if (!match || match[0].length !== input.length) return;

  let [, protocol, hostname, port, pathname = "/", search = "", hash = ""] = match;
  // IDNA and IPv4 parsing (including numeric final labels) belong to the native parser.
  if (COMPLEX_HOST.test(hostname) || DOT_SEGMENT.test(pathname) || (port && +port > 65535)) return;

  protocol = protocol.toLowerCase() + ":";
  hostname = hostname.toLowerCase();
  port = port ? String(+port) : "";
  if (port === (protocol === "ws:" || protocol === "http:" ? "80" : "443")) port = "";
  const href = `${protocol}//${hostname}${port ? ":" + port : ""}${pathname}${search}${hash}`;
  const result: SimpleURL = { href, protocol, hostname, pathname };
  cached.simple = result;
  cached.serialized = href;
  return result;
}

/**
 * Serializes an absolute URL without collapsing repeated pathname slashes
 * @throws if the input is not a valid absolute URL
 */
export function serializeURL(url: string | URL): string {
  if (typeof url !== "string") return url.href;
  const cached = getURLCache(url);
  return (cached.serialized ??= getSimpleURL(url, cached)?.href ?? new URL(url).href);
}

/**
 * Normalizes a URL by removing default ports and collapsing repeated pathname slashes
 * @throws if the input is not a valid absolute URL
 */
export function normalizeURL<T extends string | URL>(url: T): T {
  if (typeof url === "string") {
    const cached = getURLCache(url);
    if (cached.normalized !== undefined) return cached.normalized as T;
    const simple = getSimpleURL(url, cached);
    if (simple) {
      if (!simple.pathname.includes("//")) cached.normalized = simple.href;
      else {
        const start = simple.href.indexOf("/", simple.protocol.length + 2);
        cached.normalized =
          simple.href.slice(0, start) +
          simple.pathname.replace(/\/{2,}/g, "/") +
          simple.href.slice(start + simple.pathname.length);
      }
      return cached.normalized as T;
    }
  }

  // Parsing already removes default ports; avoid reparsing unchanged paths through the setter.
  const p = new URL(url);
  const pathname = p.pathname;
  // Setting an empty path can add a slash to non-special URLs such as custom://.
  if (pathname === "" || pathname.includes("//")) p.pathname = pathname.replace(/\/{2,}/g, "/");

  if (typeof url === "string") {
    const result = p.toString();
    getURLCache(url).normalized = result;
    return result as T;
  }
  return p as T;
}

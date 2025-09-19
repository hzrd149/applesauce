export const convertToUrl = (url: string | URL) => (url instanceof URL ? url : new URL(url));
export const getURLFilename = (url: URL) =>
  url.pathname.split("/").pop()?.toLocaleLowerCase() || url.searchParams.get("filename")?.toLocaleLowerCase();

export const IMAGE_EXT = [".svg", ".gif", ".png", ".jpg", ".jpeg", ".webp", ".avif"];
export const VIDEO_EXT = [".mp4", ".mkv", ".webm", ".mov"];
export const STREAM_EXT = [".m3u8"];
export const AUDIO_EXT = [".mp3", ".wav", ".ogg", ".aac", ".m4a"];

/** Checks if a url is a image URL */
export function isImageURL(url: string | URL) {
  url = convertToUrl(url);
  const filename = getURLFilename(url);
  return !!filename && IMAGE_EXT.some((ext) => filename.endsWith(ext));
}

/** Checks if a url is a video URL */
export function isVideoURL(url: string | URL) {
  url = convertToUrl(url);
  const filename = getURLFilename(url);
  return !!filename && VIDEO_EXT.some((ext) => filename.endsWith(ext));
}

/** Checks if a url is a stream URL */
export function isStreamURL(url: string | URL) {
  url = convertToUrl(url);
  const filename = getURLFilename(url);
  return !!filename && STREAM_EXT.some((ext) => filename.endsWith(ext));
}

/** Checks if a url is a audio URL */
export function isAudioURL(url: string | URL) {
  url = convertToUrl(url);
  const filename = getURLFilename(url);
  return !!filename && AUDIO_EXT.some((ext) => filename.endsWith(ext));
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
  const p = typeof url === "string" ? new URL(ensureProtocol(url, "wss:")) : new URL(url);
  if (p.protocol === "http:") p.protocol = "ws:";
  else if (p.protocol === "https:") p.protocol = "wss:";
  else p.protocol = "wss:";

  // return a string if a string was passed in
  // @ts-expect-error
  return typeof url === "string" ? p.toString() : p;
}

/** Converts a domain or WS URL to a HTTP URL */
export function ensureHttpURL<T extends string | URL>(url: T): T {
  const p = typeof url === "string" ? new URL(ensureProtocol(url, "http:")) : new URL(url);
  if (p.protocol === "ws:") p.protocol = "http:";
  else if (p.protocol === "wss:") p.protocol = "https:";
  else p.protocol = "https:";

  // return a string if a string was passed in
  // @ts-expect-error
  return typeof url === "string" ? p.toString() : p;
}

/**
 * Normalizes a string into a relay URL
 * Does not remove the trailing slash
 */
export function normalizeURL<T extends string | URL>(url: T): T {
  let p = new URL(url);
  // Remove any double slashes
  p.pathname = p.pathname.replace(/\/+/g, "/");
  // Remove the port if its not needed
  if (
    (p.port === "80" && (p.protocol === "ws:" || p.protocol === "http:")) ||
    (p.port === "443" && (p.protocol === "wss:" || p.protocol === "https:"))
  )
    p.port = "";

  // Return a string if a string was passed in
  // @ts-expect-error
  return typeof url === "string" ? p.toString() : p;
}

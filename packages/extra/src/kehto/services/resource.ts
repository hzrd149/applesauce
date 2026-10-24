import type { EventStore } from "applesauce-core";
import type { Observable } from "rxjs";
import { sha256 } from "@noble/hashes/sha2.js";
import { ResourceServiceError, type ResourceServiceOptions } from "@kehto/services";
import { castUser } from "applesauce-common/casts";
import { mergeBlossomServers, normalizeBlossomServer } from "applesauce-common/helpers";
import { bytesToHex, decodePointer, kinds } from "applesauce-core/helpers";
import { firstValueFrom } from "rxjs";
import { configured$, settle } from "../helpers.js";

/** Options for {@link createResourceOptions} */
export interface KehtoResourceOptions {
  /** The shared event store with host loaders configured */
  eventStore: EventStore;
  /** The active public key used for server or relay discovery */
  pubkey?: string | Observable<string | undefined>;
  /** The wait for missing data in milliseconds (default 4000) */
  timeout?: number;

  /** Protocol handlers keyed by scheme without a colon, overriding built-in handlers when provided */
  protocols?: Record<string, NonNullable<ResourceServiceOptions["fetch"]>>;
  /** Blossom servers tried after the hints and the user's servers */
  fallbackServers?: string[] | Observable<string[]>;
  /** The largest resource napplets may load, in bytes (default 10MB) */
  maxBytes?: number;
  /** The fetch implementation, defaults to the global fetch */
  fetch?: typeof fetch;
}

// Browsers can't see resolved IPs, so this only blocks literal private hosts
const PRIVATE_HOST = /^(localhost|0\.|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[|.*\.local$)/;

/** Parses server hints that may omit the scheme */
function parseServerHints(hints: readonly string[]) {
  return hints.flatMap((server) => {
    const candidate = /^https?:\/\//i.test(server) ? server : `https://${server}`;
    try {
      return [normalizeBlossomServer(candidate).href];
    } catch {
      return [];
    }
  });
}

/**
 * Creates NAP-RESOURCE options that resolve `blossom:`, `nostr:`, `https:` and `data:` URLs for napplets.
 * Blossom blobs are hash-verified, and `nostr:` references resolve through the event store and its loaders
 */
export function createResourceOptions(options: KehtoResourceOptions): ResourceServiceOptions {
  const { eventStore } = options;
  const maxBytes = options.maxBytes ?? 10 * 1024 * 1024;
  const fetcher = options.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init));

  async function readBytes(response: Response): Promise<Uint8Array> {
    if (Number(response.headers.get("content-length")) > maxBytes)
      throw new ResourceServiceError("too-large", "resource exceeds byte limit");

    const reader = response.body?.getReader();
    if (!reader) return new Uint8Array();

    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const result = await reader.read();
        if (result.done) break;

        length += result.value.byteLength;
        if (length > maxBytes) throw new ResourceServiceError("too-large", `${length} bytes`);
        chunks.push(result.value);
      }
    } finally {
      await reader.cancel();
    }

    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  }

  /** Fetches a blob from the first server that returns bytes matching the hash */
  async function fetchBlossom(url: URL, servers: readonly string[], signal: AbortSignal) {
    const hash = /^([0-9a-f]{64})(?:\.[^/]+)?$/i.exec(url.pathname)?.[1]?.toLowerCase();
    if (!hash) throw new ResourceServiceError("invalid-request", "invalid Blossom hash");

    async function* serverCandidates() {
      yield* mergeBlossomServers(parseServerHints(url.searchParams.getAll("xs")), parseServerHints(servers));

      const pubkey = await firstValueFrom(configured$(options.pubkey, undefined));
      const user = pubkey ? castUser(pubkey, eventStore) : undefined;
      if (user) yield* await settle(user.blossomServers$, [] as URL[], options.timeout ?? 4000);

      yield* mergeBlossomServers<string | URL>(await firstValueFrom(configured$(options.fallbackServers, [])));
    }

    const attemptedServers = new Set<string>();
    for await (const candidate of serverCandidates()) {
      const server = String(candidate);
      if (attemptedServers.has(server)) continue;
      attemptedServers.add(server);

      try {
        const response = await fetcher(new URL(hash, server), {
          signal,
          credentials: "omit",
          referrerPolicy: "no-referrer",
        });
        if (!response.ok) continue;

        const bytes = await readBytes(response);
        if (bytesToHex(sha256(bytes)) !== hash) continue;
        return { bytes, type: response.headers.get("content-type") ?? "" };
      } catch (err) {
        if (signal.aborted || (err instanceof ResourceServiceError && err.code === "too-large")) throw err;
      }
    }
    throw new ResourceServiceError("not-found", "no Blossom server returned the blob");
  }

  /** Resolves a NIP-19 reference one hop through the store and returns the event JSON */
  async function fetchNostr(url: URL) {
    let decoded: ReturnType<typeof decodePointer>;
    try {
      decoded = decodePointer(url.pathname);
    } catch {
      throw new ResourceServiceError("invalid-request", "invalid nostr: reference");
    }
    const pointer =
      decoded.type === "nevent" || decoded.type === "naddr" || decoded.type === "note"
        ? decoded.data
        : {
            kind: kinds.Metadata,
            pubkey: decoded.type === "nprofile" ? decoded.data.pubkey : String(decoded.data),
          };
    const event = await settle(eventStore.event(pointer), undefined, options.timeout ?? 4000);
    if (!event) throw new ResourceServiceError("not-found", "event not found");
    return { bytes: new TextEncoder().encode(JSON.stringify(event)), type: "application/json" };
  }

  async function fetchHttp(url: URL, signal: AbortSignal) {
    if (PRIVATE_HOST.test(url.hostname)) throw new ResourceServiceError("blocked-by-policy", "private host");
    const response = await fetcher(url, { signal, credentials: "omit", referrerPolicy: "no-referrer" });
    if (!response.ok) throw new ResourceServiceError("not-found", `${response.status}`);
    return { bytes: await readBytes(response), type: response.headers.get("content-type") ?? "" };
  }

  const protocols = options.protocols ?? {};
  const schemes = Array.from(new Set(["https", "data", "blossom", "nostr", ...Object.keys(protocols)]));

  return {
    resourceInfo: {
      schemes: schemes.map((scheme) => ({ scheme, enabled: true })),
      maxBytes,
    },
    fetch: async (input, request) => {
      const { signal, servers = [] } = request;
      // Accept kehto's legacy blossom:sha256: resource URLs
      const url = new URL(input.replace(/^blossom:sha256:/i, "blossom:"));
      let result: { bytes: Uint8Array; type: string };
      const scheme = url.protocol.slice(0, -1);
      const protocolHandler = Object.hasOwn(protocols, scheme) ? protocols[scheme] : undefined;

      if (protocolHandler) {
        const response = await protocolHandler(input, request);
        result = { bytes: await readBytes(response), type: response.headers.get("content-type") ?? "" };
      } else {
        switch (url.protocol) {
          case "blossom:":
            result = await fetchBlossom(url, servers, signal);
            break;
          case "nostr:":
            result = await fetchNostr(url);
            break;
          case "data:": {
            const response = await fetcher(url, { signal });
            const bytes = await readBytes(response);
            result = { bytes, type: response.headers.get("content-type") ?? "" };
            break;
          }
          case "https:":
            result = await fetchHttp(url, signal);
            break;
          default:
            throw new ResourceServiceError("unsupported-scheme", url.protocol);
        }
      }

      if (result.bytes.byteLength > maxBytes) {
        throw new ResourceServiceError("too-large", `${result.bytes.byteLength} bytes`);
      }

      return new Response(new Blob([result.bytes as Uint8Array<ArrayBuffer>]), {
        headers: { "content-type": result.type || "application/octet-stream" },
      });
    },
  };
}

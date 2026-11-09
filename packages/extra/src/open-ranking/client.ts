import { NostrWebTokenFactory } from "applesauce-common/factories";
import { createNostrWebTokenAuthorizationHeader } from "applesauce-common/helpers";
import { LRU } from "applesauce-core/helpers";
import { type ISigner } from "applesauce-signers";

import {
  DEFAULT_OPEN_RANKING_PROVIDER,
  OpenRankingCapabilities,
  OpenRankingOptions,
  OpenRankingRequestOptions,
  OpenRankingSearchResult,
  OpenRankingStats,
} from "./types.js";

/** A signed authorization header and the time (in seconds) its token expires */
type CachedAuthorization = { expiration: number; header: Promise<string> };

/** The response body of the `/search/pubkeys` endpoint */
type SearchResponse = { results: { pubkey: string; rank: number }[] };

/** Returns only the request options that are set, so unset keys are left out of the request body */
function requestParams({ algorithm, pov }: OpenRankingRequestOptions): OpenRankingRequestOptions {
  const params: OpenRankingRequestOptions = {};
  if (algorithm) params.algorithm = algorithm;
  if (pov) params.pov = pov;
  return params;
}

/**
 * A client for an Open Ranking (ORE) provider — a plain HTTP/JSON interface to a nostr web of trust.
 * Authenticates point-of-view requests with Nostr Web Tokens (kind 27519) when a signer is provided.
 * @see https://github.com/Open-Ranking/protocol
 */
export class OpenRanking {
  /** The base URL of the provider (without a trailing slash) */
  readonly provider: string;

  protected signer?: ISigner;
  protected tokenExpiration: number;

  // Re-issue the token slightly before it expires so it never lapses mid-request
  protected tokenSkew = 10;

  // Cache the capability document for the lifetime of the client
  protected capabilities?: Promise<OpenRankingCapabilities>;

  // Cache search results for 5 minutes
  protected searchCache = new LRU<OpenRankingSearchResult[]>(1000, 5 * 60 * 1000);

  // Cache the issued authorization header (and its in-flight signature) so a single token is reused across requests
  protected authorizationCache?: CachedAuthorization;

  constructor(provider: string = DEFAULT_OPEN_RANKING_PROVIDER, opts?: OpenRankingOptions) {
    this.provider = provider.replace(/\/+$/, "");
    this.signer = opts?.signer;
    this.tokenExpiration = opts?.tokenExpiration ?? 5 * 60;
  }

  /** Sets or clears the signer used to issue Nostr Web Tokens */
  setSigner(signer?: ISigner) {
    this.signer = signer;

    // A new signer issues different tokens, so drop the cached authorization
    this.authorizationCache = undefined;
  }

  /** Fetches the provider's capability document @see ORE-01 */
  discover(): Promise<OpenRankingCapabilities> {
    if (!this.capabilities) {
      this.capabilities = this.fetchCapabilities();
    }

    return this.capabilities;
  }

  /** Requests the capability document from the provider's well-known URL */
  protected async fetchCapabilities(): Promise<OpenRankingCapabilities> {
    const res = await fetch(`${this.provider}/.well-known/open-ranking.json`);
    if (!res.ok) throw new Error(`Failed to load Open Ranking capabilities (${res.status})`);

    return res.json();
  }

  /** Returns a cached Nostr Web Token authorization header, or an empty object when no signer is set */
  protected async authorization(): Promise<Record<string, string>> {
    if (!this.signer) return {};

    const now = Math.floor(Date.now() / 1000);

    // Issue a new token only when there isn't a valid one cached (or still in flight)
    if (!this.authorizationCache || this.authorizationCache.expiration - now <= this.tokenSkew) {
      const expiration = now + this.tokenExpiration;

      // Kick off signing — `.sign()` returns the promise synchronously; the actual signer prompt happens later
      const header = NostrWebTokenFactory.create({
        audiences: [this.provider],
        issuedAt: now,
        expiration,
      })
        .message("Open Ranking request")
        .sign(this.signer)
        .then(createNostrWebTokenAuthorizationHeader);

      // The cached pending promise IS the lock: caching it here serializes every concurrent caller onto a
      // single signature. This block MUST stay synchronous up to this assignment — do not add an `await`
      // before it, or parallel requests would each start their own signer prompt before the cache is set.
      const cache: CachedAuthorization = { expiration, header };
      this.authorizationCache = cache;

      // Don't keep a rejected signature cached (e.g. the user declined) — let the next request retry
      header.catch(() => {
        if (this.authorizationCache === cache) this.authorizationCache = undefined;
      });
    }

    // Concurrent callers all await this same pending promise, so the signer is only ever prompted once
    return { Authorization: await this.authorizationCache.header };
  }

  /** Makes a POST request to the provider, signing a Nostr Web Token when a signer is available */
  protected async post<T>(path: string, body: unknown): Promise<T> {
    const headers = { "Content-Type": "application/json", ...(await this.authorization()) };

    const res = await fetch(`${this.provider}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    // Errors are signalled by HTTP status with a human-readable X-Reason header
    if (!res.ok) throw new Error(res.headers.get("X-Reason") || `Open Ranking request failed (${res.status})`);

    return res.json();
  }

  /** Searches for profiles matching a free-text query, ranked by the provider's web of trust @see ORE-05 */
  async userSearch(
    query: string,
    limit: number = 10,
    options: OpenRankingRequestOptions = {},
  ): Promise<OpenRankingSearchResult[]> {
    const { algorithm, pov } = options;

    // Check cache
    const key = [this.provider, query, limit, algorithm ?? "", pov ?? ""].join(":");
    const cached = this.searchCache.get(key);
    if (cached) return cached;

    const { results } = await this.post<SearchResponse>("/search/pubkeys", {
      query,
      limit,
      ...requestParams(options),
    });

    // Sort by rank descending and keep only the ranked profile pointer fields
    const sorted = results.sort((a, b) => b.rank - a.rank);
    const pointers = sorted.map(({ pubkey, rank }) => ({ pubkey, rank }));

    this.searchCache.set(key, pointers);

    return pointers;
  }

  /** Gets the provider's web-of-trust stats for a single pubkey @see ORE-02 */
  stats(pubkey: string, options: OpenRankingRequestOptions = {}): Promise<OpenRankingStats> {
    return this.post<OpenRankingStats>("/stats/pubkey", { pubkey, ...requestParams(options) });
  }
}

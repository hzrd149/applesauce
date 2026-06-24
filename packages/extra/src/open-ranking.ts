import { LRU } from "applesauce-core/helpers";
import { ProfilePointer } from "applesauce-core/helpers/pointers";
import { createNostrWebTokenAuthorizationHeader } from "applesauce-common/helpers";
import { NostrWebTokenFactory } from "applesauce-common/factories";
import { type ISigner } from "applesauce-signers";

/** A public Open Ranking provider that exposes its web of trust over HTTP/JSON */
export const DEFAULT_OPEN_RANKING_PROVIDER = "https://staging.brainstorm.world";

/** A single algorithm offered by an Open Ranking endpoint */
export type OpenRankingAlgorithm = {
  id: string;
  name: string;
  /** Whether this algorithm requires a point-of-view pubkey in the request */
  pov: boolean;
  description: string;
};

/** The capability document returned from `/.well-known/open-ranking.json`, keyed by endpoint path @see ORE-01 */
export type OpenRankingCapabilities = Record<string, OpenRankingAlgorithm[]>;

/** A profile returned from a search, with its web-of-trust rank */
export type OpenRankingSearchResult = ProfilePointer & { rank: number };

/** Web-of-trust stats for a single pubkey @see ORE-02 */
export type OpenRankingStats = {
  pubkey: string;
  rank: number;
  hops?: number;
  followers?: number;
  muters?: number;
  reporters?: number;
  follows?: number;
  mutes?: number;
  reporting?: number;
  pagerank?: number;
};

export type OpenRankingRequestOptions = {
  /** The algorithm id to use, defaults to the endpoint's first (default) algorithm */
  algorithm?: string;
  /** The point-of-view pubkey for personalized algorithms */
  pov?: string;
};

export type OpenRankingOptions = {
  /** Signer used to issue Nostr Web Tokens for authenticated (point-of-view) requests */
  signer?: ISigner;
  /** How long (in seconds) issued Nostr Web Tokens remain valid, defaults to 300 */
  tokenExpiration?: number;
};

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

  constructor(provider: string = DEFAULT_OPEN_RANKING_PROVIDER, opts?: OpenRankingOptions) {
    this.provider = provider.replace(/\/+$/, "");
    this.signer = opts?.signer;
    this.tokenExpiration = opts?.tokenExpiration ?? 5 * 60;
  }

  // Cache the capability document for the lifetime of the client
  protected capabilities?: Promise<OpenRankingCapabilities>;

  // Cache search results for 5 minutes
  protected searchCache = new LRU<OpenRankingSearchResult[]>(1000, 5 * 60 * 1000);

  /** Sets or clears the signer used to issue Nostr Web Tokens */
  setSigner(signer?: ISigner) {
    this.signer = signer;
  }

  /** Fetches the provider's capability document @see ORE-01 */
  discover(): Promise<OpenRankingCapabilities> {
    if (!this.capabilities)
      this.capabilities = fetch(`${this.provider}/.well-known/open-ranking.json`).then((res) => {
        if (!res.ok) throw new Error(`Failed to load Open Ranking capabilities (${res.status})`);
        return res.json();
      });
    return this.capabilities;
  }

  /** Creates a Nostr Web Token authorization header for the provider, or an empty object when no signer is set */
  protected async authorization(): Promise<Record<string, string>> {
    if (!this.signer) return {};

    const now = Math.floor(Date.now() / 1000);
    const token = await NostrWebTokenFactory.create({
      audiences: [this.provider],
      issuedAt: now,
      expiration: now + this.tokenExpiration,
    })
      .message("Open Ranking request")
      .sign(this.signer);

    return { Authorization: createNostrWebTokenAuthorizationHeader(token) };
  }

  /** Makes a POST request to the provider, signing a Nostr Web Token when a signer is available */
  protected async post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.provider}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await this.authorization()) },
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

    const { results } = await this.post<{ results: { pubkey: string; rank: number }[] }>("/search/pubkeys", {
      query,
      limit,
      ...(algorithm ? { algorithm } : {}),
      ...(pov ? { pov } : {}),
    });

    // Sort by rank descending and convert to ranked profile pointers
    const pointers = results.sort((a, b) => b.rank - a.rank).map(({ pubkey, rank }) => ({ pubkey, rank }));

    // Cache the results
    this.searchCache.set(key, pointers);

    return pointers;
  }

  /** Gets the provider's web-of-trust stats for a single pubkey @see ORE-02 */
  stats(pubkey: string, options: OpenRankingRequestOptions = {}): Promise<OpenRankingStats> {
    const { algorithm, pov } = options;
    return this.post<OpenRankingStats>("/stats/pubkey", {
      pubkey,
      ...(algorithm ? { algorithm } : {}),
      ...(pov ? { pov } : {}),
    });
  }
}

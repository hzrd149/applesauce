import { ProfilePointer } from "applesauce-core/helpers/pointers";
import { type ISigner } from "applesauce-signers";

/** A public Open Ranking provider that exposes its web of trust over HTTP/JSON */
export const DEFAULT_OPEN_RANKING_PROVIDER = "https://staging.brainstorm.world";

/** A single algorithm offered by an Open Ranking endpoint */
export type OpenRankingAlgorithm = {
  /** The algorithm id sent in requests */
  id: string;
  /** A human-readable name for the algorithm */
  name: string;
  /** Whether this algorithm requires a point-of-view pubkey in the request */
  pov: boolean;
  /** A human-readable description of how the algorithm ranks pubkeys */
  description: string;
};

/** The capability document returned from `/.well-known/open-ranking.json`, keyed by endpoint path @see ORE-01 */
export type OpenRankingCapabilities = Record<string, OpenRankingAlgorithm[]>;

/** A profile returned from a search, with its web-of-trust rank */
export type OpenRankingSearchResult = ProfilePointer & { rank: number };

/** Web-of-trust stats for a single pubkey @see ORE-02 */
export type OpenRankingStats = {
  /** The pubkey the stats describe */
  pubkey: string;
  /** The pubkey's web-of-trust rank */
  rank: number;
  /** The follow distance from the point-of-view pubkey */
  hops?: number;
  /** The number of pubkeys following this pubkey */
  followers?: number;
  /** The number of pubkeys muting this pubkey */
  muters?: number;
  /** The number of pubkeys reporting this pubkey */
  reporters?: number;
  /** The number of pubkeys this pubkey follows */
  follows?: number;
  /** The number of pubkeys this pubkey mutes */
  mutes?: number;
  /** The number of pubkeys this pubkey reports */
  reporting?: number;
  /** The pubkey's PageRank score */
  pagerank?: number;
};

/** Options for a single Open Ranking request */
export type OpenRankingRequestOptions = {
  /** The algorithm id to use, defaults to the endpoint's first (default) algorithm */
  algorithm?: string;
  /** The point-of-view pubkey for personalized algorithms */
  pov?: string;
};

/** Options for the OpenRanking client */
export type OpenRankingOptions = {
  /** Signer used to issue Nostr Web Tokens for authenticated (point-of-view) requests */
  signer?: ISigner;
  /** How long (in seconds) issued Nostr Web Tokens remain valid, defaults to 300 */
  tokenExpiration?: number;
};

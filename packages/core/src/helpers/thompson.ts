import { sampleBeta } from "./beta.js";

export interface RelayPrior {
  alpha: number;
  beta: number;
}

export interface ThompsonScoreOptions {
  /** Per-relay Beta distribution priors from delivery history */
  priors?: Map<string, RelayPrior>;
  /** Per-relay EWMA latency in ms */
  latencies?: Map<string, number>;
  /** Random number generator returning [0, 1) */
  rng: () => number;
  /** Weight score by popularity (1 + log(popularity)). Default: false */
  usePopularity?: boolean;
}

/**
 * Creates a Thompson sampling score function for relay selection.
 *
 * Returns a scoring function compatible with `selectOptimalRelays` and
 * `selectRelaysPerAuthor`. Each call draws a fresh Beta sample, so scores
 * are stochastic — suited for per-author selection rather than greedy
 * set-cover (which re-evaluates all relays every iteration).
 *
 * Cold start (no priors): `sampleBeta(1, 1)` = uniform, equivalent to random.
 * Warm start: relays with good delivery history get higher Beta parameters.
 */
export function createThompsonScore(
  opts: ThompsonScoreOptions,
): (relay: string, coverage: number, popularity: number) => number {
  const { priors, latencies, rng, usePopularity = false } = opts;

  return (relay: string, _coverage: number, popularity: number): number => {
    const prior = priors?.get(relay);
    const sample = prior ? sampleBeta(prior.alpha, prior.beta, rng) : sampleBeta(1, 1, rng);

    const latMs = latencies?.get(relay);
    const discount = latMs !== undefined ? 1 / (1 + latMs / 1000) : 1.0;

    const popWeight = usePopularity && popularity > 0 ? 1 + Math.log(popularity) : 1.0;

    return popWeight * sample * discount;
  };
}

/**
 * Creates a pre-sampled Thompson score function for use with greedy set-cover
 * ({@link selectOptimalRelays}).
 *
 * Greedy set-cover re-evaluates all relays every iteration. A fresh Thompson
 * sample per call makes scores unstable across iterations. This function
 * solves that by drawing one Beta sample per relay up front, then returning
 * a deterministic score function that reuses those fixed samples.
 *
 * Each **call to createFixedThompsonScore** explores a different relay
 * configuration (Thompson exploration). Within a single run, scores are
 * stable so the greedy loop behaves correctly.
 *
 * Browser constraint: Chrome caps WebSocket connections at ~30 per domain
 * (6 per host, ~30 total). Use `selectOptimalRelays({ maxConnections: 25 })`
 * with this scorer to stay within the browser budget while still exploring.
 *
 * @example
 * ```typescript
 * const score = createFixedThompsonScore(allRelayUrls, {
 *   priors, latencies, rng, usePopularity: true,
 * });
 * const result = selectOptimalRelays(users, { maxConnections: 25, score });
 * ```
 */
export function createFixedThompsonScore(
  relays: Iterable<string>,
  opts: ThompsonScoreOptions,
): (relay: string, coverage: number, popularity: number) => number {
  const { priors, latencies, rng, usePopularity = false } = opts;

  // Pre-sample once per relay
  const sampledScores = new Map<string, number>();
  for (const relay of relays) {
    const prior = priors?.get(relay);
    const sample = prior ? sampleBeta(prior.alpha, prior.beta, rng) : sampleBeta(1, 1, rng);

    const latMs = latencies?.get(relay);
    const discount = latMs !== undefined ? 1 / (1 + latMs / 1000) : 1.0;

    sampledScores.set(relay, sample * discount);
  }

  return (relay: string, _coverage: number, popularity: number): number => {
    const base = sampledScores.get(relay) ?? rng();
    const popWeight = usePopularity && popularity > 0 ? 1 + Math.log(popularity) : 1.0;
    return popWeight * base;
  };
}

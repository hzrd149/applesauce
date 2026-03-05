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

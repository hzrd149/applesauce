import { describe, expect, it } from "vitest";
import { createThompsonScore, createFixedThompsonScore } from "../thompson.js";

// Seeded PRNG (mulberry32)
function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("createThompsonScore", () => {
  it("should return a scoring function", () => {
    const score = createThompsonScore({ rng: Math.random });
    expect(typeof score).toBe("function");
  });

  it("cold start (no priors) should produce values in [0, 1]", () => {
    const rng = mulberry32(42);
    const score = createThompsonScore({ rng });

    for (let i = 0; i < 100; i++) {
      const val = score("wss://relay/", 0.5, 10);
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThanOrEqual(1);
    }
  });

  it("should use priors when provided", () => {
    const rng = mulberry32(123);
    const priors = new Map([
      // High alpha, low beta → samples close to 1
      ["wss://good/", { alpha: 50, beta: 2 }],
      // Low alpha, high beta → samples close to 0
      ["wss://bad/", { alpha: 2, beta: 50 }],
    ]);

    const score = createThompsonScore({ priors, rng });

    let goodSum = 0;
    let badSum = 0;
    const n = 1000;
    for (let i = 0; i < n; i++) {
      goodSum += score("wss://good/", 0.5, 10);
      badSum += score("wss://bad/", 0.5, 10);
    }

    // Good relay should score much higher on average
    expect(goodSum / n).toBeGreaterThan(badSum / n * 3);
  });

  it("should apply latency discount", () => {
    const rng = mulberry32(456);
    const latencies = new Map([
      ["wss://fast/", 100], // 100ms → discount = 1/(1+0.1) ≈ 0.91
      ["wss://slow/", 5000], // 5000ms → discount = 1/(1+5) ≈ 0.17
    ]);

    const score = createThompsonScore({ latencies, rng });

    let fastSum = 0;
    let slowSum = 0;
    const n = 1000;
    for (let i = 0; i < n; i++) {
      fastSum += score("wss://fast/", 0.5, 10);
      slowSum += score("wss://slow/", 0.5, 10);
    }

    // Fast relay should score higher on average due to latency discount
    expect(fastSum / n).toBeGreaterThan(slowSum / n);
  });

  it("should weight by popularity when usePopularity=true", () => {
    const rng = mulberry32(789);
    const score = createThompsonScore({ rng, usePopularity: true });

    let popularSum = 0;
    let unpopularSum = 0;
    const n = 1000;
    for (let i = 0; i < n; i++) {
      popularSum += score("wss://relay/", 0.5, 100);
      unpopularSum += score("wss://relay/", 0.5, 1);
    }

    // Popular relay should score higher (1 + log(100) vs 1 + log(1) = 1)
    expect(popularSum / n).toBeGreaterThan(unpopularSum / n);
  });

  it("should NOT weight by popularity when usePopularity=false", () => {
    // Use a fixed rng that alternates to ensure fair comparison
    let callCount = 0;
    const values = [0.5]; // Fixed value so both calls get the same Beta sample
    const fixedRng = () => values[0];

    const score = createThompsonScore({ rng: fixedRng, usePopularity: false });

    const popular = score("wss://relay/", 0.5, 100);
    const unpopular = score("wss://relay/", 0.5, 1);

    // Without popularity weighting, same relay with same rng should give same score
    expect(popular).toBe(unpopular);
  });

  it("unknown relay without priors should use uniform prior", () => {
    const rng = mulberry32(999);
    const priors = new Map([["wss://known/", { alpha: 10, beta: 2 }]]);

    const score = createThompsonScore({ priors, rng });

    // Unknown relay should still produce a valid score (uniform prior)
    const val = score("wss://unknown/", 0.5, 5);
    expect(val).toBeGreaterThanOrEqual(0);
    expect(val).toBeLessThanOrEqual(1);
  });
});

describe("createFixedThompsonScore", () => {
  it("should return deterministic scores for the same relay across calls", () => {
    const rng = mulberry32(42);
    const relays = ["wss://r1/", "wss://r2/", "wss://r3/"];
    const score = createFixedThompsonScore(relays, { rng });

    const first = score("wss://r1/", 0.5, 10);
    const second = score("wss://r1/", 0.5, 10);
    expect(first).toBe(second);
  });

  it("should produce different scores across different relays", () => {
    const rng = mulberry32(42);
    const relays = ["wss://r1/", "wss://r2/"];
    const score = createFixedThompsonScore(relays, { rng });

    const s1 = score("wss://r1/", 0.5, 10);
    const s2 = score("wss://r2/", 0.5, 10);
    // Very unlikely to be equal with different random draws
    expect(s1).not.toBe(s2);
  });

  it("should produce different configurations across separate instantiations", () => {
    const relays = ["wss://r1/", "wss://r2/", "wss://r3/"];

    const score1 = createFixedThompsonScore(relays, { rng: mulberry32(1) });
    const score2 = createFixedThompsonScore(relays, { rng: mulberry32(2) });

    // Different seeds → different pre-sampled scores → different relay orderings
    const s1 = score1("wss://r1/", 0.5, 10);
    const s2 = score2("wss://r1/", 0.5, 10);
    expect(s1).not.toBe(s2);
  });

  it("should apply latency discount in pre-sampling", () => {
    const relays = ["wss://fast/", "wss://slow/"];
    const latencies = new Map([
      ["wss://fast/", 100],
      ["wss://slow/", 5000],
    ]);

    // Use a fixed rng so Beta samples are identical → difference is purely latency
    const score = createFixedThompsonScore(relays, {
      rng: () => 0.5,
      latencies,
    });

    expect(score("wss://fast/", 0, 0)).toBeGreaterThan(score("wss://slow/", 0, 0));
  });

  it("should apply popularity weight when usePopularity=true", () => {
    const relays = ["wss://r1/"];
    const score = createFixedThompsonScore(relays, {
      rng: mulberry32(42),
      usePopularity: true,
    });

    const popular = score("wss://r1/", 0, 100);
    const unpopular = score("wss://r1/", 0, 1);
    expect(popular).toBeGreaterThan(unpopular);
  });

  it("should lazily sample and cache unknown relays for determinism", () => {
    const relays = ["wss://known/"];
    const score = createFixedThompsonScore(relays, { rng: mulberry32(42) });

    // Unknown relay: first call samples and caches, second call returns same value
    const first = score("wss://unknown/", 0.5, 0);
    const second = score("wss://unknown/", 0.5, 0);
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThanOrEqual(1);
    expect(first).toBe(second);
  });
});

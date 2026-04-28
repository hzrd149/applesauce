import { describe, expect, it } from "vitest";
import { sampleBeta } from "../beta.js";

// Seeded PRNG (mulberry32) for deterministic tests
function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("sampleBeta", () => {
  it("should return values in [0, 1]", () => {
    const rng = mulberry32(42);
    for (let i = 0; i < 1000; i++) {
      const val = sampleBeta(2, 5, rng);
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThanOrEqual(1);
    }
  });

  it("should produce uniform distribution for alpha=1, beta=1", () => {
    const rng = mulberry32(123);
    const samples: number[] = [];
    for (let i = 0; i < 10000; i++) {
      samples.push(sampleBeta(1, 1, rng));
    }
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    // Uniform mean should be ~0.5
    expect(mean).toBeGreaterThan(0.45);
    expect(mean).toBeLessThan(0.55);
  });

  it("should produce right-skewed distribution for alpha=2, beta=5", () => {
    const rng = mulberry32(456);
    const samples: number[] = [];
    for (let i = 0; i < 10000; i++) {
      samples.push(sampleBeta(2, 5, rng));
    }
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    // Theoretical mean = alpha/(alpha+beta) = 2/7 ≈ 0.286
    expect(mean).toBeGreaterThan(0.23);
    expect(mean).toBeLessThan(0.34);
  });

  it("should produce left-skewed distribution for alpha=5, beta=2", () => {
    const rng = mulberry32(789);
    const samples: number[] = [];
    for (let i = 0; i < 10000; i++) {
      samples.push(sampleBeta(5, 2, rng));
    }
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    // Theoretical mean = 5/7 ≈ 0.714
    expect(mean).toBeGreaterThan(0.66);
    expect(mean).toBeLessThan(0.77);
  });

  it("should work with sub-1 parameters (Jöhnk path)", () => {
    const rng = mulberry32(321);
    const samples: number[] = [];
    for (let i = 0; i < 10000; i++) {
      samples.push(sampleBeta(0.5, 0.5, rng));
    }
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    // Theoretical mean = 0.5/(0.5+0.5) = 0.5
    expect(mean).toBeGreaterThan(0.4);
    expect(mean).toBeLessThan(0.6);
  });

  it("should throw for invalid parameters", () => {
    const rng = () => 0.5;
    expect(() => sampleBeta(0, 1, rng)).toThrow(RangeError);
    expect(() => sampleBeta(1, 0, rng)).toThrow(RangeError);
    expect(() => sampleBeta(-1, 1, rng)).toThrow(RangeError);
    expect(() => sampleBeta(NaN, 1, rng)).toThrow(RangeError);
    expect(() => sampleBeta(1, Infinity, rng)).toThrow(RangeError);
  });
});

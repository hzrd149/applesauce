/** Clamp rng() to avoid 0 (which breaks Math.log / Math.pow). */
const EPS = Number.MIN_VALUE;
function rngPos(rng: () => number): number {
  return Math.max(rng(), EPS);
}

/**
 * Sample from a Beta(alpha, beta) distribution using the Jöhnk algorithm.
 * Returns a value in [0, 1].
 */
export function sampleBeta(alpha: number, beta: number, rng: () => number): number {
  if (!Number.isFinite(alpha) || !Number.isFinite(beta) || alpha <= 0 || beta <= 0) {
    throw new RangeError(`sampleBeta requires alpha > 0 and beta > 0, got alpha=${alpha}, beta=${beta}`);
  }

  // For alpha=1, beta=1 (uniform prior), just return rng()
  if (alpha === 1 && beta === 1) return rng();

  // Jöhnk's algorithm for general alpha, beta
  if (alpha < 1 && beta < 1) {
    while (true) {
      const u = rngPos(rng);
      const v = rngPos(rng);
      const x = Math.pow(u, 1 / alpha);
      const y = Math.pow(v, 1 / beta);
      if (x + y <= 1) {
        if (x + y > 0) return x / (x + y);
        // Handle underflow by taking logs
        const logX = Math.log(u) / alpha;
        const logY = Math.log(v) / beta;
        const logM = logX > logY ? logX : logY;
        return Math.exp(logX - logM) / (Math.exp(logX - logM) + Math.exp(logY - logM));
      }
    }
  }

  // For larger alpha/beta, use gamma sampling approach
  const x = sampleGamma(alpha, rng);
  const y = sampleGamma(beta, rng);
  return x / (x + y);
}

/**
 * Sample from a Gamma(shape, 1) distribution using Marsaglia and Tsang's method.
 */
function sampleGamma(shape: number, rng: () => number): number {
  if (!Number.isFinite(shape) || shape <= 0) {
    throw new RangeError(`sampleGamma requires shape > 0, got shape=${shape}`);
  }

  if (shape < 1) {
    // Boost: Gamma(shape) = Gamma(shape+1) * U^(1/shape)
    return sampleGamma(shape + 1, rng) * Math.pow(rngPos(rng), 1 / shape);
  }

  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);

  while (true) {
    let x: number;
    let v: number;
    do {
      // Box-Muller for normal sample
      x = Math.sqrt(-2 * Math.log(rngPos(rng))) * Math.cos(2 * Math.PI * rng());
      v = 1 + c * x;
    } while (v <= 0);

    v = v * v * v;
    const u = rng();
    if (u < 1 - 0.0331 * (x * x) * (x * x)) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

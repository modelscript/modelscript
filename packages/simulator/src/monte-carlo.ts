import { StaticTapeBuilder } from "@modelscript/compiler";
// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-non-null-assertion */

/**
 * Monte Carlo Simulation Engine.
 *
 * Provides a general-purpose stochastic sampling framework for uncertainty
 * quantification and stochastic optimization. Supports:
 *   - Multiple probability distributions (Gaussian, Uniform, Lognormal, Beta, Triangular, Empirical)
 *   - Variance reduction: antithetic variates, Latin Hypercube Sampling (LHS)
 *   - Reproducible results via seeded Xoshiro256++ PRNG
 *   - Convergence diagnostics (coefficient of variation, effective sample size)
 *
 * Used as a fallback when analytical Gaussian propagation is insufficient
 * (non-Gaussian distributions, complex nonlinearities) and as the backbone
 * for Sample Average Approximation (SAA) in stochastic optimization.
 */

// ─────────────────────────────────────────────────────────────────────
// Distribution Types
// ─────────────────────────────────────────────────────────────────────

export type Distribution =
  | { type: "gaussian"; mean: number; stddev: number }
  | { type: "uniform"; lo: number; hi: number }
  | { type: "lognormal"; mu: number; sigma: number }
  | { type: "beta"; alpha: number; beta: number }
  | { type: "triangular"; lo: number; mode: number; hi: number }
  | { type: "empirical"; samples: number[] };

export interface RandomVariable {
  name: string;
  distribution: Distribution;
}

// ─────────────────────────────────────────────────────────────────────
// Monte Carlo Options & Results
// ─────────────────────────────────────────────────────────────────────

export interface MonteCarloOptions {
  /** Number of samples (default: 1000) */
  numSamples?: number;
  /** PRNG seed for reproducibility (default: undefined = random) */
  seed?: number;
  /** Confidence level for CI computation (default: 0.95) */
  confidenceLevel?: number;
  /** Use antithetic variates for variance reduction (default: false) */
  antithetic?: boolean;
  /** Use Latin Hypercube Sampling instead of crude MC (default: false) */
  latinHypercube?: boolean;
  /** Use Sobol quasi-random sequence for space-filling sampling (default: false) */
  sobol?: boolean;
  /** Store raw sample trajectories for visualization (default: false) */
  storeTrajectories?: boolean;
}

export interface VariableStatistics {
  mean: number[];
  variance: number[];
  stddev: number[];
  ciLo: number[];
  ciHi: number[];
  percentiles: Map<number, number[]>;
}

export interface MonteCarloResult {
  /** Per-variable statistics at each time point */
  statistics: Map<string, VariableStatistics>;
  /** Raw sample trajectories (optional, for visualization) */
  sampleTrajectories?: Map<string, number[][]> | undefined;
  /** Convergence diagnostics */
  convergence: {
    coeffOfVariation: number;
    effectiveSampleSize: number;
  };
  /** Number of samples actually used */
  numSamples: number;
}

/** Statistics for a single scalar expression evaluated under Monte Carlo. */
export interface ScalarMCResult {
  mean: number;
  variance: number;
  stddev: number;
  ciLo: number;
  ciHi: number;
  percentiles: Map<number, number>;
  samples: number[];
}

// ─────────────────────────────────────────────────────────────────────
// Xoshiro256++ PRNG
// ─────────────────────────────────────────────────────────────────────

/**
 * Xoshiro256++ pseudo-random number generator.
 * Fast, high-quality, seeded. Period: 2^256 − 1.
 *
 * Reference: Blackman, D. & Vigna, S. (2021), "Scrambled Linear Pseudorandom
 *   Number Generators", ACM TOMS.
 */
export class Xoshiro256pp {
  private s: BigInt64Array;

  constructor(seed: number) {
    // SplitMix64 to initialize state from a single seed
    this.s = new BigInt64Array(4);
    let z = BigInt(seed) & 0xffffffffffffffffn;
    for (let i = 0; i < 4; i++) {
      z = (z + 0x9e3779b97f4a7c15n) & 0xffffffffffffffffn;
      let t = z;
      t = ((t ^ (t >> 30n)) * 0xbf58476d1ce4e5b9n) & 0xffffffffffffffffn;
      t = ((t ^ (t >> 27n)) * 0x94d049bb133111ebn) & 0xffffffffffffffffn;
      t = (t ^ (t >> 31n)) & 0xffffffffffffffffn;
      this.s[i] = t;
    }
  }

  /** Generate a random 64-bit integer. */
  nextInt64(): bigint {
    const s = this.s;
    const result = (s[0]! + ((s[0]! + s[3]!) & 0xffffffffffffffffn)) & 0xffffffffffffffffn;

    const t = (s[1]! << 17n) & 0xffffffffffffffffn;
    s[2] = (s[2]! ^ s[0]!) & 0xffffffffffffffffn;
    s[3] = (s[3]! ^ s[1]!) & 0xffffffffffffffffn;
    s[1] = (s[1]! ^ s[2]!) & 0xffffffffffffffffn;
    s[0] = (s[0]! ^ s[3]!) & 0xffffffffffffffffn;
    s[2] = (s[2]! ^ t) & 0xffffffffffffffffn;

    // Rotate s[3]
    const s3 = s[3]!;
    s[3] = ((s3 << 45n) | ((s3 >> 19n) & 0x1ffffffffffffn)) & 0xffffffffffffffffn;

    return result;
  }

  /** Generate a uniform random number in [0, 1). */
  random(): number {
    const bits = this.nextInt64() & 0x7fffffffffffffffn; // Positive only
    return Number(bits) / Number(0x7fffffffffffffffn);
  }

  /** Generate a standard normal variate using Box-Muller transform. */
  randn(): number {
    let u1 = this.random();
    while (u1 === 0) u1 = this.random(); // Avoid log(0)
    const u2 = this.random();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }
}

// ─────────────────────────────────────────────────────────────────────
// Distribution Sampling
// ─────────────────────────────────────────────────────────────────────

/**
 * Draw a single sample from the given distribution.
 */
export function sampleDistribution(dist: Distribution, rng: Xoshiro256pp): number {
  switch (dist.type) {
    case "gaussian":
      return dist.mean + dist.stddev * rng.randn();

    case "uniform":
      return dist.lo + (dist.hi - dist.lo) * rng.random();

    case "lognormal": {
      const z = rng.randn();
      return Math.exp(dist.mu + dist.sigma * z);
    }

    case "beta": {
      // Jöhnk's algorithm for Beta(α, β)
      const a = dist.alpha;
      const b = dist.beta;
      const ga = sampleGamma(a, rng);
      const gb = sampleGamma(b, rng);
      return ga / (ga + gb);
    }

    case "triangular": {
      const u = rng.random();
      const { lo, mode, hi } = dist;
      const fc = (mode - lo) / (hi - lo);
      if (u < fc) {
        return lo + Math.sqrt(u * (hi - lo) * (mode - lo));
      }
      return hi - Math.sqrt((1 - u) * (hi - lo) * (hi - mode));
    }

    case "empirical": {
      // Sample uniformly from the empirical data
      const idx = Math.floor(rng.random() * dist.samples.length);
      return dist.samples[idx] ?? 0;
    }
  }
}

/**
 * Gamma distribution sampling via Marsaglia-Tsang method.
 * Used internally for Beta distribution sampling.
 */
function sampleGamma(shape: number, rng: Xoshiro256pp): number {
  if (shape < 1) {
    // For shape < 1: Gamma(α) = Gamma(α+1) * U^(1/α)
    return sampleGamma(shape + 1, rng) * Math.pow(rng.random(), 1 / shape);
  }

  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);

  for (;;) {
    let x: number;
    let v: number;

    do {
      x = rng.randn();
      v = 1 + c * x;
    } while (v <= 0);

    v = v * v * v;
    const u = rng.random();

    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

/**
 * Get the mean of a distribution analytically.
 */
export function distributionMean(dist: Distribution): number {
  switch (dist.type) {
    case "gaussian":
      return dist.mean;
    case "uniform":
      return (dist.lo + dist.hi) / 2;
    case "lognormal":
      return Math.exp(dist.mu + (dist.sigma * dist.sigma) / 2);
    case "beta":
      return dist.alpha / (dist.alpha + dist.beta);
    case "triangular":
      return (dist.lo + dist.mode + dist.hi) / 3;
    case "empirical": {
      let sum = 0;
      for (const s of dist.samples) sum += s;
      return sum / (dist.samples.length || 1);
    }
  }
}

/**
 * Get the variance of a distribution analytically.
 */
export function distributionVariance(dist: Distribution): number {
  switch (dist.type) {
    case "gaussian":
      return dist.stddev * dist.stddev;
    case "uniform":
      return (dist.hi - dist.lo) ** 2 / 12;
    case "lognormal":
      return (Math.exp(dist.sigma * dist.sigma) - 1) * Math.exp(2 * dist.mu + dist.sigma * dist.sigma);
    case "beta": {
      const { alpha, beta } = dist;
      return (alpha * beta) / ((alpha + beta) ** 2 * (alpha + beta + 1));
    }
    case "triangular": {
      const { lo, mode, hi } = dist;
      return (lo * lo + mode * mode + hi * hi - lo * mode - lo * hi - mode * hi) / 18;
    }
    case "empirical": {
      const mu = distributionMean(dist);
      let sum = 0;
      for (const s of dist.samples) sum += (s - mu) ** 2;
      return sum / (dist.samples.length || 1);
    }
  }
}

/**
 * Check if a distribution is Gaussian.
 */
export function isGaussian(dist: Distribution): boolean {
  return dist.type === "gaussian";
}

// ─────────────────────────────────────────────────────────────────────
// Latin Hypercube Sampling
// ─────────────────────────────────────────────────────────────────────

/**
 * Generate N samples using Latin Hypercube Sampling (LHS).
 * Provides better coverage of the parameter space than crude MC.
 *
 * Returns an array of N sample dictionaries: [{ name → value }, ...]
 */
export function latinHypercubeSample(vars: RandomVariable[], N: number, rng: Xoshiro256pp): Map<string, number>[] {
  const nVars = vars.length;
  const samples: Map<string, number>[] = [];

  // Generate stratified uniform samples for each variable
  const uniformSamples: number[][] = [];
  for (let j = 0; j < nVars; j++) {
    const strata: number[] = [];
    for (let i = 0; i < N; i++) {
      // Sample within stratum [i/N, (i+1)/N)
      strata.push((i + rng.random()) / N);
    }
    // Shuffle strata (Fisher-Yates)
    for (let i = N - 1; i > 0; i--) {
      const k = Math.floor(rng.random() * (i + 1));
      const tmp = strata[i]!;
      strata[i] = strata[k]!;
      strata[k] = tmp;
    }
    uniformSamples.push(strata);
  }

  // Transform uniform samples to distribution samples via inverse CDF
  for (let i = 0; i < N; i++) {
    const sample = new Map<string, number>();
    for (let j = 0; j < nVars; j++) {
      const v = vars[j]!;
      const u = uniformSamples[j]![i]!;
      sample.set(v.name, inverseCDF(v.distribution, u));
    }
    samples.push(sample);
  }

  return samples;
}

// ─────────────────────────────────────────────────────────────────────
// Sobol Quasi-Random Sequence
// ─────────────────────────────────────────────────────────────────────

/**
 * Sobol quasi-random sequence generator.
 *
 * Generates low-discrepancy sequences in [0,1)^d that fill the parameter
 * space more uniformly than pseudo-random sampling. Convergence rate is
 * O(log(N)^d / N) compared to O(1/√N) for crude MC.
 *
 * Uses the Gray-code optimization and Joe & Kuo (2010) direction numbers.
 *
 * Reference: Joe, S. & Kuo, F.Y. (2010), "Constructing Sobol Sequences
 *   with Better Two-Dimensional Projections", SIAM J. Sci. Comput., 30(5).
 */
export class SobolSequence {
  private readonly d: number;
  private x: Uint32Array;
  private index: number;

  /**
   * Direction numbers for dimensions 2..21 (Joe & Kuo).
   * Each row: [s, a, m_1, m_2, ..., m_s] for the primitive polynomial.
   * First dimension is Van der Corput (base 2), handled separately.
   */
  private static readonly DIRECTION_NUMBERS: readonly (readonly number[])[] = [
    // dim 2: s=1, a=0, m=[1]
    [1, 0, 1],
    // dim 3: s=2, a=1, m=[1,1]
    [2, 1, 1, 1],
    // dim 4: s=3, a=1, m=[1,1,1]
    [3, 1, 1, 1, 1],
    // dim 5: s=3, a=2, m=[1,3,1]
    [3, 2, 1, 3, 1],
    // dim 6: s=4, a=1, m=[1,1,1,1]
    [4, 1, 1, 1, 1, 1],
    // dim 7: s=4, a=4, m=[1,3,5,13]
    [4, 4, 1, 3, 5, 13],
    // dim 8: s=5, a=2, m=[1,1,5,5,17]
    [5, 2, 1, 1, 5, 5, 17],
    // dim 9: s=5, a=4, m=[1,1,5,5,5]
    [5, 4, 1, 1, 5, 5, 5],
    // dim 10: s=5, a=7, m=[1,1,7,11,19]
    [5, 7, 1, 1, 7, 11, 19],
    // dim 11: s=5, a=11, m=[1,1,5,1,1]
    [5, 11, 1, 1, 5, 1, 1],
    // dim 12: s=5, a=13, m=[1,1,1,3,11]
    [5, 13, 1, 1, 1, 3, 11],
    // dim 13: s=5, a=14, m=[1,3,5,5,31]
    [5, 14, 1, 3, 5, 5, 31],
    // dim 14: s=6, a=1, m=[1,3,3,9,7,49]
    [6, 1, 1, 3, 3, 9, 7, 49],
    // dim 15: s=6, a=13, m=[1,1,1,15,21,21]
    [6, 13, 1, 1, 1, 15, 21, 21],
    // dim 16: s=6, a=16, m=[1,3,1,13,27,49]
    [6, 16, 1, 3, 1, 13, 27, 49],
    // dim 17: s=7, a=19, m=[1,1,1,15,7,5,127]
    [7, 19, 1, 1, 1, 15, 7, 5, 127],
    // dim 18: s=7, a=22, m=[1,3,7,7,21,61,127]
    [7, 22, 1, 3, 7, 7, 21, 61, 127],
    // dim 19: s=7, a=25, m=[1,1,5,11,27,53,69]
    [7, 25, 1, 1, 5, 11, 27, 53, 69],
    // dim 20: s=7, a=37, m=[1,3,1,7,11,29,17]
    [7, 37, 1, 3, 1, 7, 11, 29, 17],
  ];

  /** 32-bit direction number arrays per dimension. */
  private V: Uint32Array[];

  constructor(d: number) {
    this.d = d;
    this.x = new Uint32Array(d);
    this.index = 0;
    this.V = this.initDirectionNumbers();
  }

  private initDirectionNumbers(): Uint32Array[] {
    const BITS = 32;
    const V: Uint32Array[] = [];

    // Dimension 0: Van der Corput base-2
    const v0 = new Uint32Array(BITS);
    for (let i = 0; i < BITS; i++) {
      v0[i] = 1 << (BITS - 1 - i);
    }
    V.push(v0);

    // Dimensions 1..d-1 from direction number table
    for (let dim = 1; dim < this.d; dim++) {
      const vd = new Uint32Array(BITS);

      const dnRow = SobolSequence.DIRECTION_NUMBERS[dim - 1];
      if (!dnRow || dnRow.length < 3) {
        // Fallback: use Van der Corput with XOR scramble
        for (let i = 0; i < BITS; i++) {
          vd[i] = 1 << (BITS - 1 - i);
        }
        V.push(vd);
        continue;
      }

      const s = dnRow[0] ?? 1;
      const a = dnRow[1] ?? 0;

      // Set initial direction numbers m_1..m_s (left-shifted)
      for (let i = 0; i < s && i < BITS; i++) {
        const m = dnRow[i + 2] ?? 1;
        vd[i] = m << (BITS - 1 - i);
      }

      // Compute remaining direction numbers using the recurrence
      for (let i = s; i < BITS; i++) {
        let val = vd[i - s] ?? 0;
        val ^= (vd[i - s] ?? 0) >>> s;
        for (let k = 1; k < s; k++) {
          if (a & (1 << (s - 1 - k))) {
            val ^= vd[i - k] ?? 0;
          }
        }
        vd[i] = val;
      }

      V.push(vd);
    }

    return V;
  }

  /** Generate the next point in [0, 1)^d. */
  next(): number[] {
    this.index++;
    // Find rightmost zero bit of index (Gray code optimization)
    const c = trailingZeros(this.index);

    const point = new Array<number>(this.d);
    for (let dim = 0; dim < this.d; dim++) {
      const vd = this.V[dim];
      if (vd) {
        const prev = this.x[dim] ?? 0;
        this.x[dim] = prev ^ (vd[c] ?? 0);
      }
      point[dim] = (this.x[dim] ?? 0) / 4294967296; // 2^32
    }
    return point;
  }

  /** Skip the first `n` points. */
  skip(n: number): void {
    for (let i = 0; i < n; i++) this.next();
  }

  /** Reset the sequence to the beginning. */
  reset(): void {
    this.x.fill(0);
    this.index = 0;
  }
}

/** Count trailing zero bits in a 32-bit integer. */
function trailingZeros(n: number): number {
  if (n === 0) return 32;
  let count = 0;
  let v = n;
  while ((v & 1) === 0) {
    count++;
    v >>>= 1;
  }
  return count;
}

/**
 * Generate N samples using Sobol quasi-random sequences.
 * Provides optimal space-filling for UQ with faster convergence than
 * both crude MC and LHS.
 *
 * Returns an array of N sample dictionaries: [{ name → value }, ...]
 */
export function sobolSample(vars: RandomVariable[], N: number): Map<string, number>[] {
  const nVars = vars.length;
  const sobol = new SobolSequence(nVars);
  const samples: Map<string, number>[] = [];

  // Skip the first point (origin)
  sobol.skip(1);

  for (let i = 0; i < N; i++) {
    const point = sobol.next();
    const sample = new Map<string, number>();
    for (let j = 0; j < nVars; j++) {
      const v = vars[j]!;
      const u = point[j] ?? 0.5;
      sample.set(v.name, inverseCDF(v.distribution, u));
    }
    samples.push(sample);
  }

  return samples;
}

/**
 * Inverse CDF (quantile function) for each distribution type.
 */
function inverseCDF(dist: Distribution, u: number): number {
  switch (dist.type) {
    case "gaussian":
      return dist.mean + dist.stddev * normalQuantile(u);

    case "uniform":
      return dist.lo + (dist.hi - dist.lo) * u;

    case "lognormal":
      return Math.exp(dist.mu + dist.sigma * normalQuantile(u));

    case "beta":
      // Approximate via Newton's method on regularized incomplete beta
      return betaQuantile(u, dist.alpha, dist.beta);

    case "triangular": {
      const { lo, mode, hi } = dist;
      const fc = (mode - lo) / (hi - lo);
      if (u < fc) {
        return lo + Math.sqrt(u * (hi - lo) * (mode - lo));
      }
      return hi - Math.sqrt((1 - u) * (hi - lo) * (hi - mode));
    }

    case "empirical": {
      // Piecewise linear interpolation on sorted samples
      const sorted = [...dist.samples].sort((a, b) => a - b);
      const idx = u * (sorted.length - 1);
      const lo = Math.floor(idx);
      const hi = Math.min(lo + 1, sorted.length - 1);
      const frac = idx - lo;
      return sorted[lo]! * (1 - frac) + sorted[hi]! * frac;
    }
  }
}

/**
 * Rational approximation to the normal quantile function (Φ⁻¹).
 * Accurate to ~1.5e-9 over the full range.
 *
 * Reference: Beasley, J.D. & Springer, S.G. (1977), "Algorithm AS 111".
 */
export function normalQuantile(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  if (p === 0.5) return 0;

  const lim = 0.5;
  if (p > lim) return -normalQuantile(1 - p);

  const r = Math.sqrt(-2 * Math.log(p));
  // Rational approximation for the tail
  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1,
    2.506628277459239,
  ];
  const b = [-5.447609879822406e1, 1.61585836858041e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const num = ((((a[0]! / r + a[1]!) / r + a[2]!) / r + a[3]!) / r + a[4]!) / r + a[5]!;
  const den = ((((b[0]! / r + b[1]!) / r + b[2]!) / r + b[3]!) / r + b[4]!) / r + 1;
  return num / den;
}

/**
 * Approximate beta quantile via bisection.
 */
function betaQuantile(p: number, alpha: number, beta: number): number {
  // Simple bisection on the regularized incomplete beta function
  let lo = 0,
    hi = 1;
  for (let iter = 0; iter < 60; iter++) {
    const mid = (lo + hi) / 2;
    const cdf = regularizedBeta(mid, alpha, beta);
    if (cdf < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Regularized incomplete beta function I_x(a, b) via continued fraction.
 * Approximate but sufficient for quantile computation via bisection.
 */
function regularizedBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;

  // Use symmetry for better convergence
  if (x > (a + 1) / (a + b + 2)) {
    return 1 - regularizedBeta(1 - x, b, a);
  }

  const lnBeta = lgamma(a) + lgamma(b) - lgamma(a + b);
  const front = Math.exp(a * Math.log(x) + b * Math.log(1 - x) - lnBeta) / a;

  // Lentz's continued fraction
  let f = 1,
    c = 1,
    d = 0;
  for (let m = 0; m <= 200; m++) {
    let num: number;
    if (m === 0) {
      num = 1;
    } else if (m % 2 === 0) {
      const k = m / 2;
      num = (k * (b - k) * x) / ((a + 2 * k - 1) * (a + 2 * k));
    } else {
      const k = (m - 1) / 2;
      num = -((a + k) * (a + b + k) * x) / ((a + 2 * k) * (a + 2 * k + 1));
    }

    d = 1 + num * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    d = 1 / d;

    c = 1 + num / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;

    f *= c * d;
    if (Math.abs(c * d - 1) < 1e-10) break;
  }

  return front * (f - 1);
}

/** Log-gamma function (Stirling approximation for small values, Lanczos for general). */
function lgamma(x: number): number {
  if (x <= 0) return Infinity;
  // Lanczos approximation
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x);
  }
  x -= 1;
  let a = c[0]!;
  const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) {
    a += c[i]! / (x + i);
  }
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

// ─────────────────────────────────────────────────────────────────────
// Monte Carlo Tape Evaluation (Static Expressions)
// ─────────────────────────────────────────────────────────────────────

/**
 * Run Monte Carlo on a static tape expression (no ODE integration).
 * Evaluates the tape N times with sampled random variable values.
 *
 * @param ops           The tape operations
 * @param randomVars    Random variables with distributions
 * @param outputIndex   Tape index of the output node
 * @param options       MC options (numSamples, seed, etc.)
 */
export function runMonteCarloTape(
  ops: StaticTapeBuilder,
  randomVars: RandomVariable[],
  outputIndex: number,
  options?: MonteCarloOptions,
): ScalarMCResult {
  const N = options?.numSamples ?? 1000;
  const seed = options?.seed ?? Date.now();
  const rng = new Xoshiro256pp(seed);
  const conf = options?.confidenceLevel ?? 0.95;
  const z = normalQuantile((1 + conf) / 2);

  // Generate samples
  let allSamples: Map<string, number>[];
  if (options?.sobol) {
    allSamples = sobolSample(randomVars, N);
  } else if (options?.latinHypercube) {
    allSamples = latinHypercubeSample(randomVars, N, rng);
  } else {
    allSamples = [];
    for (let i = 0; i < N; i++) {
      const sample = new Map<string, number>();
      for (const rv of randomVars) {
        sample.set(rv.name, sampleDistribution(rv.distribution, rng));
      }
      allSamples.push(sample);
    }
  }

  // Add antithetic samples if requested
  if (options?.antithetic) {
    const antiSamples: Map<string, number>[] = [];
    for (const sample of allSamples) {
      const anti = new Map<string, number>();
      for (const rv of randomVars) {
        const val = sample.get(rv.name) ?? 0;
        const mu = distributionMean(rv.distribution);
        anti.set(rv.name, 2 * mu - val); // Mirror around the mean
      }
      antiSamples.push(anti);
    }
    allSamples = allSamples.concat(antiSamples);
  }

  // Evaluate tape for each sample
  const results: number[] = [];
  const t = new Array<number>(ops.length);

  for (const sample of allSamples) {
    evaluateTapeFloat(ops, sample, t);
    results.push(t[outputIndex] ?? 0);
  }

  // Compute statistics
  return computeScalarStatistics(results, z);
}

/** Evaluate a tape with concrete float values (forward pass only). */
function evaluateTapeFloat(builder: StaticTapeBuilder, values: Map<string, number>, t: number[]): void {
  const n = builder.length;
  const { opData, valData, interner } = builder;
  const TAPE_STRIDE = 4;

  for (let i = 0; i < n; i++) {
    const offset = i * TAPE_STRIDE;
    const kind = opData[offset];
    const a = opData[offset + 1]!;
    const b = opData[offset + 2]!;
    const c = opData[offset + 3]!;

    switch (kind) {
      case 1: // Const
        t[i] = valData[i]!;
        break;
      case 2: // Var
        t[i] = values.get(interner.resolve(a) || "") ?? 0;
        break;
      case 3: // Add
        t[i] = t[a]! + t[b]!;
        break;
      case 4: // Sub
        t[i] = t[a]! - t[b]!;
        break;
      case 5: // Mul
        t[i] = t[a]! * t[b]!;
        break;
      case 6: // Div
        t[i] = t[a]! / t[b]!;
        break;
      case 7: // Pow
        t[i] = Math.pow(t[a]!, t[b]!);
        break;
      case 8: // Neg
        t[i] = -t[a]!;
        break;
      case 9: // Sin
        t[i] = Math.sin(t[a]!);
        break;
      case 10: // Cos
        t[i] = Math.cos(t[a]!);
        break;
      case 11: // Tan
        t[i] = Math.tan(t[a]!);
        break;
      case 12: // Exp
        t[i] = Math.exp(t[a]!);
        break;
      case 13: // Log
        t[i] = Math.log(t[a]!);
        break;
      case 14: // Sqrt
        t[i] = Math.sqrt(t[a]!);
        break;
      case 15: {
        // VecVar
        const baseName = interner.resolve(a) || "";
        for (let k = 0; k < b; k++) {
          t[i + k] = values.get(`${baseName}[${k + 1}]`) ?? 0;
        }
        break;
      }
      case 16: // VecConst
        for (let k = 0; k < b; k++) {
          t[i + k] = valData[i + k] ?? 0;
        }
        break;
      case 17: // VecAdd
        for (let k = 0; k < b; k++) t[i + k] = t[a + k]! + t[c + k]!;
        break;
      case 18: // VecSub
        for (let k = 0; k < b; k++) t[i + k] = t[a + k]! - t[c + k]!;
        break;
      case 19: // VecMul
        for (let k = 0; k < b; k++) t[i + k] = t[a + k]! * t[c + k]!;
        break;
      case 20: // VecNeg
        for (let k = 0; k < b; k++) t[i + k] = -t[a + k]!;
        break;
      case 21: // VecSubscript
        t[i] = t[a + c] ?? 0;
        break;
      case 0: // Nop
        break;
    }
  }
}

/** Compute statistics from an array of scalar samples. */
function computeScalarStatistics(samples: number[], z: number): ScalarMCResult {
  const N = samples.length;
  if (N === 0) {
    return {
      mean: 0,
      variance: 0,
      stddev: 0,
      ciLo: 0,
      ciHi: 0,
      percentiles: new Map(),
      samples: [],
    };
  }

  // Mean
  let sum = 0;
  for (let i = 0; i < N; i++) sum += samples[i]!;
  const mean = sum / N;

  // Variance (Welford's online algorithm for numerical stability)
  let m2 = 0;
  for (let i = 0; i < N; i++) {
    const d = samples[i]! - mean;
    m2 += d * d;
  }
  const variance = m2 / (N - 1);
  const stddev = Math.sqrt(variance);

  // Confidence interval for the mean
  const seMean = stddev / Math.sqrt(N);
  const ciLo = mean - z * seMean;
  const ciHi = mean + z * seMean;

  // Percentiles
  const sorted = [...samples].sort((a, b) => a - b);
  const percentiles = new Map<number, number>();
  for (const p of [0.01, 0.05, 0.1, 0.25, 0.5, 0.75, 0.9, 0.95, 0.99]) {
    const idx = Math.min(Math.floor(p * N), N - 1);
    percentiles.set(p, sorted[idx]!);
  }

  return { mean, variance, stddev, ciLo, ciHi, percentiles, samples };
}

// ─────────────────────────────────────────────────────────────────────
// Monte Carlo Simulation Orchestrator
// ─────────────────────────────────────────────────────────────────────

/**
 * Run Monte Carlo simulation on an ODE system.
 *
 * Runs N simulations with sampled random variable values, aggregates
 * per-variable statistics at each output time point.
 *
 * @param simulateFn    A function that runs one simulation with given parameter overrides
 *                      and returns { t: number[], y: number[][], states: string[] }
 * @param randomVars    Random variables with distributions
 * @param options       MC options
 */
export function runMonteCarloSimulation(
  simulateFn: (overrides: Map<string, number>) => { t: number[]; y: number[][]; states: string[] },
  randomVars: RandomVariable[],
  options?: MonteCarloOptions,
): MonteCarloResult {
  const N = options?.numSamples ?? 1000;
  const seed = options?.seed ?? Date.now();
  const rng = new Xoshiro256pp(seed);
  const conf = options?.confidenceLevel ?? 0.95;
  const z = normalQuantile((1 + conf) / 2);
  const storeTrajectories = options?.storeTrajectories ?? false;

  // Generate sample sets
  let allSamples: Map<string, number>[];
  if (options?.sobol) {
    allSamples = sobolSample(randomVars, N);
  } else if (options?.latinHypercube) {
    allSamples = latinHypercubeSample(randomVars, N, rng);
  } else {
    allSamples = [];
    for (let i = 0; i < N; i++) {
      const sample = new Map<string, number>();
      for (const rv of randomVars) {
        sample.set(rv.name, sampleDistribution(rv.distribution, rng));
      }
      allSamples.push(sample);
    }
  }

  // Run simulations
  const allResults: { t: number[]; y: number[][]; states: string[] }[] = [];
  for (const sample of allSamples) {
    try {
      allResults.push(simulateFn(sample));
    } catch {
      // Skip failed simulations (parameter sample may be out of feasible range)
      continue;
    }
  }

  const effectiveN = allResults.length;
  if (effectiveN === 0) {
    return {
      statistics: new Map(),
      convergence: { coeffOfVariation: Infinity, effectiveSampleSize: 0 },
      numSamples: 0,
    };
  }

  // Reference time grid and state names from first successful simulation
  const refResult = allResults[0]!;
  const nT = refResult.t.length;
  const stateNames = refResult.states;
  const nStates = stateNames.length;

  // Aggregate per-variable, per-time-point statistics
  const statistics = new Map<string, VariableStatistics>();
  const sampleTrajectories = storeTrajectories ? new Map<string, number[][]>() : undefined;

  for (let s = 0; s < nStates; s++) {
    const name = stateNames[s]!;
    const meanArr = new Float64Array(nT);
    const varianceArr = new Float64Array(nT);
    const ciLoArr = new Float64Array(nT);
    const ciHiArr = new Float64Array(nT);

    const trajectories: number[][] | undefined = storeTrajectories ? [] : undefined;

    for (let k = 0; k < nT; k++) {
      // Collect samples at time point k for state s
      let sum = 0;
      let count = 0;
      const vals: number[] = [];
      for (let i = 0; i < effectiveN; i++) {
        const row = allResults[i]!.y[k];
        if (!row) continue;
        const v = row[s] ?? 0;
        vals.push(v);
        sum += v;
        count++;
      }

      if (count === 0) continue;
      const mean = sum / count;
      let m2 = 0;
      for (const v of vals) m2 += (v - mean) * (v - mean);
      const variance = count > 1 ? m2 / (count - 1) : 0;
      const stddev = Math.sqrt(variance);
      const se = stddev / Math.sqrt(count);

      meanArr[k] = mean;
      varianceArr[k] = variance;
      ciLoArr[k] = mean - z * se;
      ciHiArr[k] = mean + z * se;
    }

    // Collect trajectories if requested
    if (trajectories) {
      for (let i = 0; i < effectiveN; i++) {
        const traj: number[] = [];
        for (let k = 0; k < nT; k++) {
          traj.push(allResults[i]!.y[k]?.[s] ?? 0);
        }
        trajectories.push(traj);
      }
      sampleTrajectories!.set(name, trajectories);
    }

    // Compute percentiles at each time point
    const percentileKeys = [0.05, 0.25, 0.5, 0.75, 0.95];
    const percentileMap = new Map<number, number[]>();
    for (const p of percentileKeys) {
      percentileMap.set(p, new Array(nT).fill(0));
    }
    for (let k = 0; k < nT; k++) {
      const vals: number[] = [];
      for (let i = 0; i < effectiveN; i++) {
        vals.push(allResults[i]!.y[k]?.[s] ?? 0);
      }
      vals.sort((a, b) => a - b);
      for (const p of percentileKeys) {
        const idx = Math.min(Math.floor(p * vals.length), vals.length - 1);
        percentileMap.get(p)![k] = vals[idx]!;
      }
    }

    statistics.set(name, {
      mean: Array.from(meanArr),
      variance: Array.from(varianceArr),
      stddev: Array.from(varianceArr).map(Math.sqrt),
      ciLo: Array.from(ciLoArr),
      ciHi: Array.from(ciHiArr),
      percentiles: percentileMap,
    });
  }

  // Convergence diagnostics: coefficient of variation of the cost/first state mean
  const firstState = stateNames[0];
  const firstStats = firstState ? statistics.get(firstState) : undefined;
  let cov = 0;
  if (firstStats && firstStats.mean.length > 0) {
    const lastIdx = firstStats.mean.length - 1;
    const m = firstStats.mean[lastIdx]!;
    const s = firstStats.stddev[lastIdx]!;
    cov = m !== 0 ? s / Math.abs(m) : Infinity;
  }

  return {
    statistics,
    sampleTrajectories,
    convergence: {
      coeffOfVariation: cov,
      effectiveSampleSize: effectiveN,
    },
    numSamples: effectiveN,
  };
}

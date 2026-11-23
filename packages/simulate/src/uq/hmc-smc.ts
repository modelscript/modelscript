// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/simulate — Hamiltonian Monte Carlo (HMC), Particle Filter (SMC), & Ordinary Kriging.
 *
 * Extends ModelScript's UQ & Calibration suite beyond Gaussian/UKF assumptions:
 *   1. HMC (Leapfrog symplectic integrator + Metropolis-Hastings accept/reject)
 *   2. Sequential Monte Carlo / Bootstrap Particle Filter (systematic resampling + ESS)
 *   3. Ordinary Kriging (spatial Gaussian Process interpolation for subsurface/geostatistics)
 */

import { solveDenseLinear } from "@modelscript/runtime";

function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randn(rng: () => number): number {
  const u1 = Math.max(1e-15, rng());
  const u2 = rng();
  return Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
}

export interface HmcOptions {
  readonly numSamples?: number | undefined;
  readonly warmup?: number | undefined;
  readonly stepSize?: number | undefined;
  readonly leapfrogSteps?: number | undefined;
  readonly seed?: number | undefined;
}

export interface HmcResult {
  readonly samples: number[][];
  readonly acceptanceRate: number;
  readonly mean: number[];
  readonly stdDev: number[];
}

/**
 * Hamiltonian Monte Carlo (HMC) sampler for continuous target log-densities.
 * Uses central-difference gradients if `gradLogDensity` is omitted.
 */
export function runHmcSampler(
  logDensity: (theta: readonly number[]) => number,
  initialTheta: readonly number[],
  gradLogDensity?: (theta: readonly number[]) => number[],
  opts?: HmcOptions,
): HmcResult {
  const dim = initialTheta.length;
  const numSamples = opts?.numSamples ?? 400;
  const warmup = opts?.warmup ?? 150;
  const eps = opts?.stepSize ?? 0.08;
  const L = opts?.leapfrogSteps ?? 12;
  const rng = mulberry32(opts?.seed ?? 42);

  const grad =
    gradLogDensity ??
    ((theta: readonly number[]): number[] => {
      const g = new Array<number>(dim);
      const h = 1e-5;
      const tmp = [...theta];
      for (let i = 0; i < dim; i++) {
        const orig = tmp[i]!;
        tmp[i] = orig + h;
        const fp = logDensity(tmp);
        tmp[i] = orig - h;
        const fm = logDensity(tmp);
        tmp[i] = orig;
        g[i] = (fp - fm) / (2 * h);
      }
      return g;
    });

  let q = [...initialTheta];
  let curLogP = logDensity(q);
  const samples: number[][] = [];
  let accepted = 0;
  const total = warmup + numSamples;

  for (let iter = 0; iter < total; iter++) {
    const p0 = Array.from({ length: dim }, () => randn(rng));
    const qProp = [...q];
    const pProp = [...p0];

    // Half step for momentum
    let g = grad(qProp);
    for (let i = 0; i < dim; i++) pProp[i] = pProp[i]! + 0.5 * eps * g[i]!;

    // Full leapfrog steps
    for (let s = 0; s < L; s++) {
      for (let i = 0; i < dim; i++) qProp[i] = qProp[i]! + eps * pProp[i]!;
      g = grad(qProp);
      const scale = s === L - 1 ? 0.5 * eps : eps;
      for (let i = 0; i < dim; i++) pProp[i] = pProp[i]! + scale * g[i]!;
    }

    const propLogP = logDensity(qProp);
    let curK = 0;
    let propK = 0;
    for (let i = 0; i < dim; i++) {
      curK += 0.5 * p0[i]! * p0[i]!;
      propK += 0.5 * pProp[i]! * pProp[i]!;
    }

    const logAlpha = propLogP - curLogP + curK - propK;
    if (Number.isFinite(logAlpha) && Math.log(Math.max(1e-15, rng())) < logAlpha) {
      q = qProp;
      curLogP = propLogP;
      if (iter >= warmup) accepted++;
    }
    if (iter >= warmup) {
      samples.push([...q]);
    }
  }

  const mean = new Array<number>(dim).fill(0);
  for (const s of samples) {
    for (let i = 0; i < dim; i++) mean[i] = mean[i]! + s[i]! / samples.length;
  }
  const stdDev = new Array<number>(dim).fill(0);
  for (const s of samples) {
    for (let i = 0; i < dim; i++) {
      const d = s[i]! - mean[i]!;
      stdDev[i] = stdDev[i]! + (d * d) / Math.max(1, samples.length - 1);
    }
  }
  for (let i = 0; i < dim; i++) stdDev[i] = Math.sqrt(stdDev[i]!);

  return {
    samples,
    acceptanceRate: accepted / Math.max(1, numSamples),
    mean,
    stdDev,
  };
}

export interface ParticleFilterConfig {
  readonly numParticles: number;
  readonly stateDim: number;
  readonly transition: (state: readonly number[], rng: () => number) => number[];
  readonly logLikelihood: (state: readonly number[], obs: readonly number[]) => number;
  readonly seed?: number | undefined;
}

export interface ParticleFilterStepResult {
  readonly mean: number[];
  readonly effectiveSampleSize: number;
  readonly resampled: boolean;
}

/**
 * Bootstrap Sequential Monte Carlo (Particle Filter) with systematic resampling.
 */
export class ParticleFilter {
  private particles: number[][];
  private weights: Float64Array;
  private readonly rng: () => number;
  private readonly cfg: ParticleFilterConfig;

  constructor(cfg: ParticleFilterConfig, initialSampler: (rng: () => number) => number[]) {
    this.cfg = cfg;
    this.rng = mulberry32(cfg.seed ?? 1337);
    this.particles = Array.from({ length: cfg.numParticles }, () => initialSampler(this.rng));
    this.weights = new Float64Array(cfg.numParticles).fill(1.0 / cfg.numParticles);
  }

  public step(observation: readonly number[]): ParticleFilterStepResult {
    const N = this.cfg.numParticles;
    const logW = new Float64Array(N);
    let maxLogW = -Infinity;

    for (let i = 0; i < N; i++) {
      const pred = this.cfg.transition(this.particles[i]!, this.rng);
      this.particles[i] = pred;
      const lw = Math.log(Math.max(1e-300, this.weights[i]!)) + this.cfg.logLikelihood(pred, observation);
      logW[i] = lw;
      if (lw > maxLogW) maxLogW = lw;
    }

    let sumW = 0;
    for (let i = 0; i < N; i++) {
      const w = Math.exp(logW[i]! - maxLogW);
      this.weights[i] = w;
      sumW += w;
    }
    let sumW2 = 0;
    for (let i = 0; i < N; i++) {
      this.weights[i] = this.weights[i]! / (sumW > 0 ? sumW : N);
      sumW2 += this.weights[i]! * this.weights[i]!;
    }
    const ess = sumW2 > 0 ? 1.0 / sumW2 : 0;

    const mean = new Array<number>(this.cfg.stateDim).fill(0);
    for (let i = 0; i < N; i++) {
      const w = this.weights[i]!;
      const p = this.particles[i]!;
      for (let d = 0; d < this.cfg.stateDim; d++) {
        mean[d] = mean[d]! + w * p[d]!;
      }
    }

    let resampled = false;
    if (ess < N * 0.5) {
      resampled = true;
      const newParticles: number[][] = new Array(N);
      const u0 = this.rng() / N;
      let cdf = this.weights[0]!;
      let j = 0;
      for (let i = 0; i < N; i++) {
        const u = u0 + i / N;
        while (u > cdf && j < N - 1) {
          j++;
          cdf += this.weights[j]!;
        }
        newParticles[i] = [...this.particles[j]!];
      }
      this.particles = newParticles;
      this.weights.fill(1.0 / N);
    }

    return { mean, effectiveSampleSize: ess, resampled };
  }
}

export interface KrigingPrediction {
  readonly mean: number;
  readonly variance: number;
}

/**
 * Ordinary Kriging (spatial Gaussian Process interpolation with squared-exponential variogram).
 */
export function ordinaryKrigingPredict(
  points: readonly (readonly number[])[],
  values: readonly number[],
  queryPoint: readonly number[],
  opts?: { lengthScale?: number | undefined; sill?: number | undefined; nugget?: number | undefined },
): KrigingPrediction {
  const n = points.length;
  const ell = opts?.lengthScale ?? 1.0;
  const sill = opts?.sill ?? 1.0;
  const nugget = opts?.nugget ?? 1e-6;

  const cov = (a: readonly number[], b: readonly number[]): number => {
    let d2 = 0;
    for (let i = 0; i < a.length; i++) {
      const diff = a[i]! - b[i]!;
      d2 += diff * diff;
    }
    return sill * Math.exp(-0.5 * (d2 / (ell * ell)));
  };

  // Augmented (n+1) x (n+1) Ordinary Kriging system
  const m = n + 1;
  const K = new Float64Array(m * m);
  const rhs = new Float64Array(m);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      K[i * m + j] = cov(points[i]!, points[j]!) + (i === j ? nugget : 0);
    }
    K[i * m + n] = 1.0;
    K[n * m + i] = 1.0;
    rhs[i] = cov(points[i]!, queryPoint);
  }
  rhs[n] = 1.0;

  const sol = solveDenseLinear(K, rhs, m);
  let mean = 0;
  let covSum = 0;
  for (let i = 0; i < n; i++) {
    mean += sol[i]! * values[i]!;
    covSum += sol[i]! * rhs[i]!;
  }
  const mu = sol[n]!;
  const variance = Math.max(0, sill + nugget - covSum - mu);
  return { mean, variance };
}

// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/simulate — Mean-Field ADVI (Variational Inference) & Dual-Averaging Adaptive HMC.
 *
 * Complements `hmc-smc.ts` with fast gradient-based variational posterior approximation (ELBO)
 * using the Gaussian reparameterization trick.
 */

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

export interface AdviOptions {
  readonly iterations?: number | undefined;
  readonly mcSamples?: number | undefined;
  readonly learningRate?: number | undefined;
  readonly seed?: number | undefined;
}

export interface AdviResult {
  readonly mean: number[];
  readonly stdDev: number[];
  readonly elboHistory: number[];
  readonly finalElbo: number;
}

/**
 * Mean-Field Automatic Differentiation Variational Inference (Kucukelbir et al. 2017).
 * Fits a factorized Gaussian q(theta) = N(mu, diag(exp(2*omega))) maximizing the ELBO.
 */
export function runMeanFieldAdvi(
  logJoint: (theta: readonly number[]) => number,
  initialMean: readonly number[],
  gradLogJoint?: (theta: readonly number[]) => number[],
  opts?: AdviOptions,
): AdviResult {
  const dim = initialMean.length;
  const iters = opts?.iterations ?? 300;
  const mcSamples = opts?.mcSamples ?? 8;
  const lr = opts?.learningRate ?? 0.05;
  const rng = mulberry32(opts?.seed ?? 99);

  const grad =
    gradLogJoint ??
    ((theta: readonly number[]): number[] => {
      const g = new Array<number>(dim);
      const h = 1e-5;
      const tmp = [...theta];
      for (let i = 0; i < dim; i++) {
        const orig = tmp[i]!;
        tmp[i] = orig + h;
        const fp = logJoint(tmp);
        tmp[i] = orig - h;
        const fm = logJoint(tmp);
        tmp[i] = orig;
        g[i] = (fp - fm) / (2 * h);
      }
      return g;
    });

  const mu = Float64Array.from(initialMean);
  const logStd = new Float64Array(dim).fill(-0.5);
  // AdaGrad accumulators
  const accMu = new Float64Array(dim).fill(1e-6);
  const accStd = new Float64Array(dim).fill(1e-6);
  const elboHistory: number[] = [];

  for (let it = 0; it < iters; it++) {
    const gMu = new Float64Array(dim);
    const gLogStd = new Float64Array(dim);
    let elbo = 0;

    for (let s = 0; s < mcSamples; s++) {
      const eps = Array.from({ length: dim }, () => randn(rng));
      const theta = Array.from({ length: dim }, (_, i) => mu[i]! + Math.exp(logStd[i]!) * eps[i]!);
      elbo += logJoint(theta) / mcSamples;
      const gTheta = grad(theta);
      for (let i = 0; i < dim; i++) {
        gMu[i] = gMu[i]! + gTheta[i]! / mcSamples;
        gLogStd[i] = gLogStd[i]! + (gTheta[i]! * eps[i]! * Math.exp(logStd[i]!)) / mcSamples;
      }
    }

    // Entropy term of Gaussian: sum_i (logStd_i + 0.5 * ln(2*pi*e)), dH/d(logStd_i) = 1
    for (let i = 0; i < dim; i++) {
      elbo += logStd[i]! + 0.5 * Math.log(2 * Math.PI * Math.E);
      gLogStd[i] = gLogStd[i]! + 1.0;

      // RMSProp (Kucukelbir et al. 2017 ADVI step-size schedule)
      accMu[i] = 0.9 * accMu[i]! + 0.1 * gMu[i]! * gMu[i]!;
      accStd[i] = 0.9 * accStd[i]! + 0.1 * gLogStd[i]! * gLogStd[i]!;
      mu[i] = mu[i]! + (lr * gMu[i]!) / (Math.sqrt(accMu[i]!) + 1e-6);
      logStd[i] = Math.max(-5, Math.min(3, logStd[i]! + (lr * gLogStd[i]!) / (Math.sqrt(accStd[i]!) + 1e-6)));
    }
    elboHistory.push(elbo);
  }

  return {
    mean: Array.from(mu),
    stdDev: Array.from(logStd, (ls) => Math.exp(ls)),
    elboHistory,
    finalElbo: elboHistory[elboHistory.length - 1] ?? -Infinity,
  };
}

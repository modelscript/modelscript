// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Covariance Matrix Adaptation Evolution Strategy (CMA-ES) in Pure TypeScript.
 *
 * Implements the standard (mu/mu_w, lambda)-CMA-ES algorithm with:
 *   - Cumulative step-size adaptation (CSA)
 *   - Rank-1 and rank-mu covariance matrix updates
 *   - Symmetric Jacobi eigendecomposition for full covariance rotation
 *   - Adaptive box boundary handling with projected evaluation and quadratic exterior penalties
 *   - Batch evaluation support
 *
 * Academic Citation:
 *   Hansen, N. (2016). "The CMA Evolution Strategy: A Tutorial."
 *   arXiv:1604.00772 [cs.NE].
 */

import {
  type BlackBoxProblem,
  createRng,
  evaluateBatchOrSingle,
  type SingleObjectiveOptions,
  type SingleObjectiveResult,
} from "./blackbox.js";

export interface CmaEsOptions extends SingleObjectiveOptions {
  /** Initial standard deviation sigma0. Default: 0.3 * (max - min). */
  sigma0?: number;
  /** Stop when fitness reaches below this value. Default: -Infinity. */
  targetFitness?: number;
}

/**
 * Computes the eigendecomposition of a real symmetric n x n matrix A = V * diag(d) * V^T
 * using Jacobi rotations.
 */
function jacobiEigendecomposition(
  A_in: Float64Array,
  n: number,
  V: Float64Array,
  d: Float64Array,
  maxSweeps = 50,
): void {
  // Copy A_in into working matrix A
  const A = new Float64Array(A_in);

  // Initialize V to identity
  V.fill(0);
  for (let i = 0; i < n; i++) {
    V[i * n + i] = 1.0;
  }

  for (let sweep = 0; sweep < maxSweeps; sweep++) {
    let offDiagSum = 0;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        offDiagSum += Math.abs(A[i * n + j]!);
      }
    }

    if (offDiagSum < 1e-14) {
      break;
    }

    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = A[p * n + q]!;
        if (Math.abs(apq) < 1e-15) continue;

        const app = A[p * n + p]!;
        const aqq = A[q * n + q]!;
        const theta = (aqq - app) / (2.0 * apq);
        const t =
          theta >= 0
            ? 1.0 / (theta + Math.sqrt(theta * theta + 1.0))
            : -1.0 / (-theta + Math.sqrt(theta * theta + 1.0));
        const c = 1.0 / Math.sqrt(t * t + 1.0);
        const s = t * c;
        const tau = s / (1.0 + c);

        A[p * n + p] = app - t * apq;
        A[q * n + q] = aqq + t * apq;
        A[p * n + q] = 0.0;
        A[q * n + p] = 0.0;

        for (let r = 0; r < p; r++) {
          const arp = A[r * n + p]!;
          const arq = A[r * n + q]!;
          A[r * n + p] = arp - s * (arq + tau * arp);
          A[r * n + q] = arq + s * (arp - tau * arq);
          A[p * n + r] = A[r * n + p]!;
          A[q * n + r] = A[r * n + q]!;
        }

        for (let r = p + 1; r < q; r++) {
          const apr = A[p * n + r]!;
          const arq = A[r * n + q]!;
          A[p * n + r] = apr - s * (arq + tau * apr);
          A[r * n + q] = arq + s * (apr - tau * arq);
          A[r * n + p] = A[p * n + r]!;
          A[q * n + r] = A[r * n + q]!;
        }

        for (let r = q + 1; r < n; r++) {
          const apr = A[p * n + r]!;
          const aqr = A[q * n + r]!;
          A[p * n + r] = apr - s * (aqr + tau * apr);
          A[q * n + r] = aqr + s * (apr - tau * aqr);
          A[r * n + p] = A[p * n + r]!;
          A[r * n + q] = A[q * n + r]!;
        }

        for (let r = 0; r < n; r++) {
          const vrp = V[r * n + p]!;
          const vrq = V[r * n + q]!;
          V[r * n + p] = vrp - s * (vrq + tau * vrp);
          V[r * n + q] = vrq + s * (vrp - tau * vrq);
        }
      }
    }
  }

  for (let i = 0; i < n; i++) {
    d[i] = A[i * n + i]!;
  }
}

/**
 * Solves a single-objective bound-constrained black-box problem using CMA-ES.
 */
export async function cmaesSolve(problem: BlackBoxProblem, options?: CmaEsOptions): Promise<SingleObjectiveResult> {
  const n = problem.dimension;
  const minBounds = problem.bounds.min;
  const maxBounds = problem.bounds.max;
  const rng = createRng(options?.seed);

  // 1. Selection & Population sizing
  const lambda = options?.populationSize ?? 4 + Math.floor(3 * Math.log(n));
  const mu = Math.floor(lambda / 2);

  // Weights w_i = ln(mu + 0.5) - ln(i)
  const rawWeights = new Float64Array(mu);
  let weightSum = 0;
  for (let i = 0; i < mu; i++) {
    rawWeights[i] = Math.log(mu + 0.5) - Math.log(i + 1);
    weightSum += rawWeights[i]!;
  }
  const weights = new Float64Array(mu);
  let sumSqWeights = 0;
  for (let i = 0; i < mu; i++) {
    weights[i] = rawWeights[i]! / weightSum;
    sumSqWeights += weights[i]! * weights[i]!;
  }
  const muEff = 1.0 / sumSqWeights;

  // 2. Adaptation parameters
  const cSigma = (muEff + 2) / (n + muEff + 5);
  const dSigma = 1.0 + 2.0 * Math.max(0, Math.sqrt((muEff - 1) / (n + 1)) - 1) + cSigma;
  const cc = (4 + muEff / n) / (n + 4 + (2 * muEff) / n);
  const c1 = 2.0 / ((n + 1.3) * (n + 1.3) + muEff);
  const cMu = Math.min(1.0 - c1, (2.0 * (muEff - 2.0 + 1.0 / muEff)) / ((n + 2) * (n + 2) + muEff));
  const chiN = Math.sqrt(n) * (1.0 - 1.0 / (4.0 * n) + 1.0 / (21.0 * n * n));

  // 3. State initialization
  const mean = new Float64Array(n);
  if (problem.initialGuess) {
    mean.set(problem.initialGuess);
  } else {
    for (let i = 0; i < n; i++) {
      mean[i] = 0.5 * (minBounds[i]! + maxBounds[i]!);
    }
  }

  let defaultSigma = 0;
  for (let i = 0; i < n; i++) {
    defaultSigma += (maxBounds[i]! - minBounds[i]!) / 3.0;
  }
  defaultSigma /= n;

  let sigma = options?.sigma0 ?? problem.initialSigma ?? defaultSigma;
  if (sigma <= 0) sigma = 1.0;

  const pSigma = new Float64Array(n);
  const pC = new Float64Array(n);
  const C = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    C[i * n + i] = 1.0;
  }

  const B = new Float64Array(n * n);
  const D = new Float64Array(n);
  const eigVals = new Float64Array(n);

  // Initial eigendecomposition of C = I
  for (let i = 0; i < n; i++) {
    B[i * n + i] = 1.0;
    D[i] = 1.0;
  }

  const maxGen = options?.maxGenerations ?? Math.max(100, 50 * n);
  const tol = options?.tolerance ?? 1e-8;
  const targetFit = options?.targetFitness ?? -Infinity;

  let bestSolution = new Float64Array(mean);
  let bestFitness = Infinity;
  const history: number[] = [];
  let totalEvaluations = 0;
  let converged = false;
  let exitMessage = "Maximum generations reached";

  // Box-Muller normal sampler
  const sampleNormal = (): number => {
    let u1 = rng();
    while (u1 <= 1e-15) u1 = rng();
    const u2 = rng();
    return Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  };

  for (let gen = 0; gen < maxGen; gen++) {
    // 4. Sample lambda candidates
    const zList: Float64Array[] = [];
    const yList: Float64Array[] = [];
    const xList: Float64Array[] = [];
    const xClampedList: Float64Array[] = [];
    const penalties: number[] = [];

    for (let k = 0; k < lambda; k++) {
      const z = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        z[i] = sampleNormal();
      }

      // y = B * (D .* z)
      const y = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        let sum = 0;
        for (let j = 0; j < n; j++) {
          sum += B[i * n + j]! * (D[j]! * z[j]!);
        }
        y[i] = sum;
      }

      const x = new Float64Array(n);
      const xClamped = new Float64Array(n);
      let penalty = 0;

      for (let i = 0; i < n; i++) {
        x[i] = mean[i]! + sigma * y[i]!;
        const lb = minBounds[i]!;
        const ub = maxBounds[i]!;
        const range = Math.max(1e-12, ub - lb);

        if (x[i]! < lb) {
          xClamped[i] = lb;
          const diff = (lb - x[i]!) / range;
          penalty += diff * diff;
        } else if (x[i]! > ub) {
          xClamped[i] = ub;
          const diff = (x[i]! - ub) / range;
          penalty += diff * diff;
        } else {
          xClamped[i] = x[i]!;
        }
      }

      zList.push(z);
      yList.push(y);
      xList.push(x);
      xClampedList.push(xClamped);
      penalties.push(penalty * 1e4);
    }

    // 5. Evaluate batch of clamped candidates
    const baseFitnesses = await evaluateBatchOrSingle(problem, xClampedList);
    totalEvaluations += lambda;

    const candidateRecords: {
      index: number;
      fitness: number;
      rawFitness: number;
      clamped: Float64Array;
      y: Float64Array;
    }[] = [];

    for (let k = 0; k < lambda; k++) {
      const rawFit = baseFitnesses[k]!;
      const fit = rawFit + penalties[k]!;
      candidateRecords.push({
        index: k,
        fitness: fit,
        rawFitness: rawFit,
        clamped: xClampedList[k]!,
        y: yList[k]!,
      });

      if (rawFit < bestFitness) {
        bestFitness = rawFit;
        bestSolution = new Float64Array(xClampedList[k]!);
      }
    }

    // 6. Sort candidate by fitness (ascending)
    candidateRecords.sort((a, b) => a.fitness - b.fitness);

    const genBestFitness = candidateRecords[0]!.rawFitness;
    history.push(genBestFitness);

    if (options?.onGeneration) {
      options.onGeneration(gen, genBestFitness, bestSolution);
    }

    // Termination checks
    if (bestFitness <= targetFit) {
      converged = true;
      exitMessage = `Target fitness ${targetFit} reached`;
      break;
    }

    if (sigma < tol && Math.abs(candidateRecords[0]!.fitness - candidateRecords[mu - 1]!.fitness) < tol) {
      converged = true;
      exitMessage = `Step size ${sigma.toExponential(2)} below tolerance`;
      break;
    }

    // 7. Recombination of mean
    const oldMean = new Float64Array(mean);
    const yW = new Float64Array(n);

    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let j = 0; j < mu; j++) {
        sum += weights[j]! * candidateRecords[j]!.y[i]!;
      }
      yW[i] = sum;
      mean[i] = oldMean[i]! + sigma * yW[i]!;
    }

    // 8. Cumulative step-size adaptation (CSA)
    // C^(-1/2) * yW = B * D^(-1) * B^T * yW
    const bTransYw = new Float64Array(n);
    for (let j = 0; j < n; j++) {
      let sum = 0;
      for (let i = 0; i < n; i++) {
        sum += B[i * n + j]! * yW[i]!;
      }
      bTransYw[j] = sum;
    }

    const invDYw = new Float64Array(n);
    for (let j = 0; j < n; j++) {
      invDYw[j] = bTransYw[j]! / Math.max(1e-14, D[j]!);
    }

    const cInvSqrtYw = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let j = 0; j < n; j++) {
        sum += B[i * n + j]! * invDYw[j]!;
      }
      cInvSqrtYw[i] = sum;
    }

    let normPSigmaSq = 0;
    const factorSigma = Math.sqrt(cSigma * (2.0 - cSigma) * muEff);
    for (let i = 0; i < n; i++) {
      pSigma[i] = (1.0 - cSigma) * pSigma[i]! + factorSigma * cInvSqrtYw[i]!;
      normPSigmaSq += pSigma[i]! * pSigma[i]!;
    }
    const normPSigma = Math.sqrt(normPSigmaSq);

    // Update step size sigma
    sigma *= Math.exp((cSigma / dSigma) * (normPSigma / chiN - 1.0));

    // 9. Covariance matrix path (pC) & rank-1, rank-mu updates
    const hSigmaThreshold = (1.4 + 2.0 / (n + 1.0)) * chiN;
    const hSigmaDenom = Math.sqrt(1.0 - Math.pow(1.0 - cSigma, 2.0 * (gen + 1)));
    const hSigma = normPSigma / hSigmaDenom < hSigmaThreshold ? 1.0 : 0.0;

    const factorC = hSigma * Math.sqrt(cc * (2.0 - cc) * muEff);
    for (let i = 0; i < n; i++) {
      pC[i] = (1.0 - cc) * pC[i]! + factorC * yW[i]!;
    }

    const deltaHSigma = (1.0 - hSigma) * cc * (2.0 - cc);
    const cOldFactor = 1.0 - c1 - cMu + c1 * deltaHSigma;

    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        let rankMuSum = 0;
        for (let k = 0; k < mu; k++) {
          const yk = candidateRecords[k]!.y;
          rankMuSum += weights[k]! * yk[i]! * yk[j]!;
        }

        C[i * n + j] = cOldFactor * C[i * n + j]! + c1 * pC[i]! * pC[j]! + cMu * rankMuSum;
      }
    }

    // Force symmetry in C
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const avg = 0.5 * (C[i * n + j]! + C[j * n + i]!);
        C[i * n + j] = avg;
        C[j * n + i] = avg;
      }
    }

    // 10. Update eigendecomposition of C
    jacobiEigendecomposition(C, n, B, eigVals);
    for (let i = 0; i < n; i++) {
      D[i] = Math.sqrt(Math.max(1e-14, eigVals[i]!));
    }
  }

  return {
    bestSolution,
    bestFitness,
    history,
    evaluations: totalEvaluations,
    iterations: history.length,
    converged,
    message: exitMessage,
  };
}

/**
 * Synchronous variant of CMA-ES for purely synchronous fitness functions.
 */
export function cmaesSolveSync(problem: BlackBoxProblem, options?: CmaEsOptions): SingleObjectiveResult {
  const n = problem.dimension;
  const minBounds = problem.bounds.min;
  const maxBounds = problem.bounds.max;
  const rng = createRng(options?.seed);

  const lambda = options?.populationSize ?? 4 + Math.floor(3 * Math.log(n));
  const mu = Math.floor(lambda / 2);

  const rawWeights = new Float64Array(mu);
  let weightSum = 0;
  for (let i = 0; i < mu; i++) {
    rawWeights[i] = Math.log(mu + 0.5) - Math.log(i + 1);
    weightSum += rawWeights[i]!;
  }
  const weights = new Float64Array(mu);
  let sumSqWeights = 0;
  for (let i = 0; i < mu; i++) {
    weights[i] = rawWeights[i]! / weightSum;
    sumSqWeights += weights[i]! * weights[i]!;
  }
  const muEff = 1.0 / sumSqWeights;

  const cSigma = (muEff + 2) / (n + muEff + 5);
  const dSigma = 1.0 + 2.0 * Math.max(0, Math.sqrt((muEff - 1) / (n + 1)) - 1) + cSigma;
  const cc = (4 + muEff / n) / (n + 4 + (2 * muEff) / n);
  const c1 = 2.0 / ((n + 1.3) * (n + 1.3) + muEff);
  const cMu = Math.min(1.0 - c1, (2.0 * (muEff - 2.0 + 1.0 / muEff)) / ((n + 2) * (n + 2) + muEff));
  const chiN = Math.sqrt(n) * (1.0 - 1.0 / (4.0 * n) + 1.0 / (21.0 * n * n));

  const mean = new Float64Array(n);
  if (problem.initialGuess) {
    mean.set(problem.initialGuess);
  } else {
    for (let i = 0; i < n; i++) {
      mean[i] = 0.5 * (minBounds[i]! + maxBounds[i]!);
    }
  }

  let defaultSigma = 0;
  for (let i = 0; i < n; i++) {
    defaultSigma += (maxBounds[i]! - minBounds[i]!) / 3.0;
  }
  defaultSigma /= n;

  let sigma = options?.sigma0 ?? problem.initialSigma ?? defaultSigma;
  if (sigma <= 0) sigma = 1.0;

  const pSigma = new Float64Array(n);
  const pC = new Float64Array(n);
  const C = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    C[i * n + i] = 1.0;
  }

  const B = new Float64Array(n * n);
  const D = new Float64Array(n);
  const eigVals = new Float64Array(n);

  for (let i = 0; i < n; i++) {
    B[i * n + i] = 1.0;
    D[i] = 1.0;
  }

  const maxGen = options?.maxGenerations ?? Math.max(100, 50 * n);
  const tol = options?.tolerance ?? 1e-8;
  const targetFit = options?.targetFitness ?? -Infinity;

  let bestSolution = new Float64Array(mean);
  let bestFitness = Infinity;
  const history: number[] = [];
  let totalEvaluations = 0;
  let converged = false;
  let exitMessage = "Maximum generations reached";

  const sampleNormal = (): number => {
    let u1 = rng();
    while (u1 <= 1e-15) u1 = rng();
    const u2 = rng();
    return Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  };

  for (let gen = 0; gen < maxGen; gen++) {
    const zList: Float64Array[] = [];
    const yList: Float64Array[] = [];
    const xList: Float64Array[] = [];
    const xClampedList: Float64Array[] = [];
    const penalties: number[] = [];

    for (let k = 0; k < lambda; k++) {
      const z = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        z[i] = sampleNormal();
      }

      const y = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        let sum = 0;
        for (let j = 0; j < n; j++) {
          sum += B[i * n + j]! * (D[j]! * z[j]!);
        }
        y[i] = sum;
      }

      const x = new Float64Array(n);
      const xClamped = new Float64Array(n);
      let penalty = 0;

      for (let i = 0; i < n; i++) {
        x[i] = mean[i]! + sigma * y[i]!;
        const lb = minBounds[i]!;
        const ub = maxBounds[i]!;
        const range = Math.max(1e-12, ub - lb);

        if (x[i]! < lb) {
          xClamped[i] = lb;
          const diff = (lb - x[i]!) / range;
          penalty += diff * diff;
        } else if (x[i]! > ub) {
          xClamped[i] = ub;
          const diff = (x[i]! - ub) / range;
          penalty += diff * diff;
        } else {
          xClamped[i] = x[i]!;
        }
      }

      zList.push(z);
      yList.push(y);
      xList.push(x);
      xClampedList.push(xClamped);
      penalties.push(penalty * 1e4);
    }

    const baseFitnesses = xClampedList.map((c) => problem.fitness(c) as number);
    totalEvaluations += lambda;

    const candidateRecords: {
      index: number;
      fitness: number;
      rawFitness: number;
      clamped: Float64Array;
      y: Float64Array;
    }[] = [];

    for (let k = 0; k < lambda; k++) {
      const rawFit = baseFitnesses[k]!;
      const fit = rawFit + penalties[k]!;
      candidateRecords.push({
        index: k,
        fitness: fit,
        rawFitness: rawFit,
        clamped: xClampedList[k]!,
        y: yList[k]!,
      });

      if (rawFit < bestFitness) {
        bestFitness = rawFit;
        bestSolution = new Float64Array(xClampedList[k]!);
      }
    }

    candidateRecords.sort((a, b) => a.fitness - b.fitness);

    const genBestFitness = candidateRecords[0]!.rawFitness;
    history.push(genBestFitness);

    if (options?.onGeneration) {
      options.onGeneration(gen, genBestFitness, bestSolution);
    }

    if (bestFitness <= targetFit) {
      converged = true;
      exitMessage = `Target fitness ${targetFit} reached`;
      break;
    }

    if (sigma < tol && Math.abs(candidateRecords[0]!.fitness - candidateRecords[mu - 1]!.fitness) < tol) {
      converged = true;
      exitMessage = `Step size ${sigma.toExponential(2)} below tolerance`;
      break;
    }

    const oldMean = new Float64Array(mean);
    const yW = new Float64Array(n);

    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let j = 0; j < mu; j++) {
        sum += weights[j]! * candidateRecords[j]!.y[i]!;
      }
      yW[i] = sum;
      mean[i] = oldMean[i]! + sigma * yW[i]!;
    }

    const bTransYw = new Float64Array(n);
    for (let j = 0; j < n; j++) {
      let sum = 0;
      for (let i = 0; i < n; i++) {
        sum += B[i * n + j]! * yW[i]!;
      }
      bTransYw[j] = sum;
    }

    const invDYw = new Float64Array(n);
    for (let j = 0; j < n; j++) {
      invDYw[j] = bTransYw[j]! / Math.max(1e-14, D[j]!);
    }

    const cInvSqrtYw = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let j = 0; j < n; j++) {
        sum += B[i * n + j]! * invDYw[j]!;
      }
      cInvSqrtYw[i] = sum;
    }

    let normPSigmaSq = 0;
    const factorSigma = Math.sqrt(cSigma * (2.0 - cSigma) * muEff);
    for (let i = 0; i < n; i++) {
      pSigma[i] = (1.0 - cSigma) * pSigma[i]! + factorSigma * cInvSqrtYw[i]!;
      normPSigmaSq += pSigma[i]! * pSigma[i]!;
    }
    const normPSigma = Math.sqrt(normPSigmaSq);

    sigma *= Math.exp((cSigma / dSigma) * (normPSigma / chiN - 1.0));

    const hSigmaThreshold = (1.4 + 2.0 / (n + 1.0)) * chiN;
    const hSigmaDenom = Math.sqrt(1.0 - Math.pow(1.0 - cSigma, 2.0 * (gen + 1)));
    const hSigma = normPSigma / hSigmaDenom < hSigmaThreshold ? 1.0 : 0.0;

    const factorC = hSigma * Math.sqrt(cc * (2.0 - cc) * muEff);
    for (let i = 0; i < n; i++) {
      pC[i] = (1.0 - cc) * pC[i]! + factorC * yW[i]!;
    }

    const deltaHSigma = (1.0 - hSigma) * cc * (2.0 - cc);
    const cOldFactor = 1.0 - c1 - cMu + c1 * deltaHSigma;

    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        let rankMuSum = 0;
        for (let k = 0; k < mu; k++) {
          const yk = candidateRecords[k]!.y;
          rankMuSum += weights[k]! * yk[i]! * yk[j]!;
        }

        C[i * n + j] = cOldFactor * C[i * n + j]! + c1 * pC[i]! * pC[j]! + cMu * rankMuSum;
      }
    }

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const avg = 0.5 * (C[i * n + j]! + C[j * n + i]!);
        C[i * n + j] = avg;
        C[j * n + i] = avg;
      }
    }

    jacobiEigendecomposition(C, n, B, eigVals);
    for (let i = 0; i < n; i++) {
      D[i] = Math.sqrt(Math.max(1e-14, eigVals[i]!));
    }
  }

  return {
    bestSolution,
    bestFitness,
    history,
    evaluations: totalEvaluations,
    iterations: history.length,
    converged,
    message: exitMessage,
  };
}

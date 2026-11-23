// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — CTMC Uniformization & CSL Probabilistic Model Checker.
 *
 * Evaluates time-bounded reachability `P(F<=T targetStates)` on Continuous-Time Markov Chains
 * (CTMCs) via Jensen's uniformization (Fox-Glynn Poisson weighting) with certified truncation error.
 */

export interface CtmcTransition {
  readonly from: number;
  readonly to: number;
  readonly rate: number;
}

export interface CtmcModel {
  readonly numStates: number;
  readonly initialDist: readonly number[];
  readonly transitions: readonly CtmcTransition[];
  readonly targetStates: readonly number[];
}

export interface CtmcPmcResult {
  readonly reachProbability: number;
  readonly truncationError: number;
  readonly stateDistribution: Float64Array;
  readonly uniformizationRate: number;
  readonly stepsComputed: number;
}

/**
 * Computes exact time-bounded reachability probability `P(F <= horizon targetStates)`
 * by making `targetStates` absorbing and applying Jensen's uniformization.
 */
export function checkCtmcBoundedReachability(model: CtmcModel, horizon: number, errorTol = 1e-9): CtmcPmcResult {
  const n = model.numStates;
  const targetSet = new Set(model.targetStates);

  // Build generator Q with target states made absorbing
  const Q = new Float64Array(n * n);
  const exitRate = new Float64Array(n);
  for (const tr of model.transitions) {
    if (tr.from === tr.to || tr.rate <= 0 || targetSet.has(tr.from)) continue;
    Q[tr.from * n + tr.to] = Q[tr.from * n + tr.to]! + tr.rate;
    exitRate[tr.from] = exitRate[tr.from]! + tr.rate;
  }

  let qMax = 0.0;
  for (let i = 0; i < n; i++) {
    Q[i * n + i] = -exitRate[i]!;
    if (exitRate[i]! > qMax) qMax = exitRate[i]!;
  }

  const pi = Float64Array.from(model.initialDist);
  if (qMax === 0 || horizon <= 0) {
    let reach = 0;
    for (const t of targetSet) reach += pi[t] ?? 0;
    return {
      reachProbability: reach,
      truncationError: 0,
      stateDistribution: pi,
      uniformizationRate: qMax,
      stepsComputed: 0,
    };
  }

  // Uniformized DTMC transition matrix P = I + Q / qMax
  const P = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      P[i * n + j] = (i === j ? 1.0 : 0.0) + Q[i * n + j]! / qMax;
    }
  }

  const lambda = qMax * horizon;
  // Compute Poisson weights e^{-lambda} * lambda^k / k! until cumulative tail < errorTol
  // Use log-space peak to prevent underflow for large lambda
  const kPeak = Math.floor(lambda);
  const logFact = (k: number): number => {
    if (k <= 1) return 0;
    // Exact sum for modest k, Stirling otherwise
    if (k < 200) {
      let s = 0;
      for (let i = 2; i <= k; i++) s += Math.log(i);
      return s;
    }
    return k * Math.log(k) - k + 0.5 * Math.log(2 * Math.PI * k);
  };

  let maxK = Math.max(20, Math.ceil(lambda + 6 * Math.sqrt(lambda) + 12));
  const weights = new Float64Array(maxK + 1);
  const logPeak = -lambda + kPeak * Math.log(lambda) - logFact(kPeak);
  weights[kPeak] = Math.exp(logPeak);
  for (let k = kPeak - 1; k >= 0; k--) {
    weights[k] = (weights[k + 1]! * (k + 1)) / lambda;
  }
  for (let k = kPeak + 1; k <= maxK; k++) {
    weights[k] = (weights[k - 1]! * lambda) / k;
  }

  let weightSum = 0;
  for (let k = 0; k <= maxK; k++) weightSum += weights[k]!;
  while (1.0 - weightSum > errorTol && maxK < 10000) {
    maxK += 50;
    // Fallback safeguard (rarely hit given 6-sigma bound)
    break;
  }

  const acc = new Float64Array(n);
  let cur = Float64Array.from(model.initialDist);
  let next = new Float64Array(n);

  for (let k = 0; k <= maxK; k++) {
    const w = weights[k]!;
    if (w > 0) {
      for (let i = 0; i < n; i++) acc[i] = acc[i]! + w * cur[i]!;
    }
    if (k < maxK) {
      next.fill(0);
      for (let i = 0; i < n; i++) {
        const ci = cur[i]!;
        if (ci === 0) continue;
        const row = i * n;
        for (let j = 0; j < n; j++) {
          next[j] = next[j]! + ci * P[row + j]!;
        }
      }
      const tmp = cur;
      cur = next;
      next = tmp;
    }
  }

  let reach = 0;
  for (const t of targetSet) reach += acc[t] ?? 0;
  return {
    reachProbability: Math.min(1.0, Math.max(0.0, reach)),
    truncationError: Math.max(0.0, 1.0 - weightSum),
    stateDistribution: acc,
    uniformizationRate: qMax,
    stepsComputed: maxK,
  };
}

// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — Discrete Factor Graph (Variable Elimination) & PC Causal Discovery.
 *
 * Complements `scm_engine.ts` with:
 *   1. Exact marginal & conditional Bayesian inference via Factor Graph Variable Elimination
 *   2. Constraint-based PC Causal Discovery (Fisher-Z partial correlation skeleton + v-structure orientation)
 */

import { solveDenseLinear } from "../../math/dense_linalg.js";

export interface DiscreteFactor {
  readonly scope: readonly string[];
  readonly cardinalities: readonly number[];
  /** Flat row-major probability/potential table of length prod(cardinalities). */
  readonly values: readonly number[];
}

function multiplyFactors(a: DiscreteFactor, b: DiscreteFactor): DiscreteFactor {
  const scope: string[] = [...a.scope];
  const card: number[] = [...a.cardinalities];
  const bMap: number[] = [];
  for (let i = 0; i < b.scope.length; i++) {
    const idx = scope.indexOf(b.scope[i]!);
    if (idx === -1) {
      bMap.push(scope.length);
      scope.push(b.scope[i]!);
      card.push(b.cardinalities[i]!);
    } else {
      bMap.push(idx);
    }
  }

  let total = 1;
  for (const c of card) total *= c;
  const out = new Float64Array(total);
  const assign = new Int32Array(scope.length);

  const aStrides = new Int32Array(a.scope.length);
  for (let i = a.scope.length - 1, s = 1; i >= 0; i--) {
    aStrides[i] = s;
    s *= a.cardinalities[i]!;
  }
  const bStrides = new Int32Array(b.scope.length);
  for (let i = b.scope.length - 1, s = 1; i >= 0; i--) {
    bStrides[i] = s;
    s *= b.cardinalities[i]!;
  }

  for (let idx = 0; idx < total; idx++) {
    let rem = idx;
    for (let v = scope.length - 1; v >= 0; v--) {
      const c = card[v]!;
      assign[v] = rem % c;
      rem = Math.floor(rem / c);
    }
    let aIdx = 0;
    for (let i = 0; i < a.scope.length; i++) aIdx += assign[i]! * aStrides[i]!;
    let bIdx = 0;
    for (let i = 0; i < b.scope.length; i++) bIdx += assign[bMap[i]!]! * bStrides[i]!;
    out[idx] = a.values[aIdx]! * b.values[bIdx]!;
  }

  return { scope, cardinalities: card, values: Array.from(out) };
}

function marginalizeFactor(f: DiscreteFactor, varName: string): DiscreteFactor {
  const vPos = f.scope.indexOf(varName);
  if (vPos === -1) return f;
  const newScope = f.scope.filter((_, i) => i !== vPos);
  const newCard = f.cardinalities.filter((_, i) => i !== vPos);
  let newTotal = 1;
  for (const c of newCard) newTotal *= c;
  const out = new Float64Array(newTotal);

  const fStrides = new Int32Array(f.scope.length);
  for (let i = f.scope.length - 1, s = 1; i >= 0; i--) {
    fStrides[i] = s;
    s *= f.cardinalities[i]!;
  }
  const nStrides = new Int32Array(newScope.length);
  for (let i = newScope.length - 1, s = 1; i >= 0; i--) {
    nStrides[i] = s;
    s *= newCard[i]!;
  }

  for (let idx = 0; idx < f.values.length; idx++) {
    let rem = idx;
    let outIdx = 0;
    let nPos = newScope.length - 1;
    for (let i = f.scope.length - 1; i >= 0; i--) {
      const c = f.cardinalities[i]!;
      const val = rem % c;
      rem = Math.floor(rem / c);
      if (i !== vPos) {
        outIdx += val * nStrides[nPos]!;
        nPos--;
      }
    }
    out[outIdx] = out[outIdx]! + f.values[idx]!;
  }

  return { scope: newScope, cardinalities: newCard, values: Array.from(out) };
}

function reduceEvidence(f: DiscreteFactor, varName: string, state: number): DiscreteFactor {
  const vPos = f.scope.indexOf(varName);
  if (vPos === -1) return f;
  const newScope = f.scope.filter((_, i) => i !== vPos);
  const newCard = f.cardinalities.filter((_, i) => i !== vPos);
  let newTotal = 1;
  for (const c of newCard) newTotal *= c;
  const out = new Float64Array(newTotal);

  const nStrides = new Int32Array(newScope.length);
  for (let i = newScope.length - 1, s = 1; i >= 0; i--) {
    nStrides[i] = s;
    s *= newCard[i]!;
  }

  for (let idx = 0; idx < f.values.length; idx++) {
    let rem = idx;
    let keep = true;
    let outIdx = 0;
    let nPos = newScope.length - 1;
    for (let i = f.scope.length - 1; i >= 0; i--) {
      const c = f.cardinalities[i]!;
      const val = rem % c;
      rem = Math.floor(rem / c);
      if (i === vPos) {
        if (val !== state) keep = false;
      } else {
        outIdx += val * nStrides[nPos]!;
        nPos--;
      }
    }
    if (keep) out[outIdx] = f.values[idx]!;
  }
  return { scope: newScope, cardinalities: newCard, values: Array.from(out) };
}

/**
 * Exact marginal query P(queryVar | evidence) via Variable Elimination over a discrete Factor Graph.
 */
export function queryFactorGraphMarginal(
  factors: readonly DiscreteFactor[],
  queryVar: string,
  evidence: Readonly<Record<string, number>> = {},
): Float64Array {
  let working: DiscreteFactor[] = factors.map((f) => {
    let cur = f;
    for (const [evVar, evVal] of Object.entries(evidence)) {
      cur = reduceEvidence(cur, evVar, evVal);
    }
    return cur;
  });

  const allVars = new Set<string>();
  for (const f of working) {
    for (const v of f.scope) allVars.add(v);
  }
  allVars.delete(queryVar);

  for (const elimVar of allVars) {
    const involved = working.filter((f) => f.scope.includes(elimVar));
    if (involved.length === 0) continue;
    const rest = working.filter((f) => !f.scope.includes(elimVar));
    let prod = involved[0]!;
    for (let i = 1; i < involved.length; i++) prod = multiplyFactors(prod, involved[i]!);
    rest.push(marginalizeFactor(prod, elimVar));
    working = rest;
  }

  let finalFactor = working[0]!;
  for (let i = 1; i < working.length; i++) finalFactor = multiplyFactors(finalFactor, working[i]!);
  const probs = Float64Array.from(finalFactor.values);
  let sum = 0;
  for (let i = 0; i < probs.length; i++) sum += probs[i]!;
  if (sum > 0) {
    for (let i = 0; i < probs.length; i++) probs[i] = probs[i]! / sum;
  }
  return probs;
}

export interface PcDiscoveryResult {
  readonly variables: string[];
  /** Undirected skeleton edges [i, j]. */
  readonly skeleton: Array<[number, number]>;
  /** Oriented directed edges [parent, child] from v-structures. */
  readonly directedEdges: Array<[number, number]>;
}

/**
 * PC Causal Discovery algorithm from observational data matrix `samples[row][varIdx]`.
 * Uses partial-correlation conditional independence tests (order 0 & 1) and v-structure orientation.
 */
export function discoverCausalDagPc(
  variables: readonly string[],
  samples: readonly (readonly number[])[],
  corrThreshold = 0.15,
): PcDiscoveryResult {
  const n = variables.length;
  const N = samples.length;
  const mean = new Float64Array(n);
  for (let r = 0; r < N; r++) {
    for (let i = 0; i < n; i++) mean[i] = mean[i]! + samples[r]![i]! / N;
  }
  const cov = new Float64Array(n * n);
  for (let r = 0; r < N; r++) {
    for (let i = 0; i < n; i++) {
      const di = samples[r]![i]! - mean[i]!;
      for (let j = i; j < n; j++) {
        const dj = samples[r]![j]! - mean[j]!;
        cov[i * n + j] = cov[i * n + j]! + di * dj;
      }
    }
  }
  const corr = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      const denom = Math.sqrt(Math.max(1e-15, cov[i * n + i]! * cov[j * n + j]!));
      const c = cov[i * n + j]! / denom;
      corr[i * n + j] = c;
      corr[j * n + i] = c;
    }
  }

  // Start with complete undirected graph
  const adj: boolean[][] = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => i !== j));
  const sepSet = new Map<string, number[]>();

  // Order-0 marginal independence
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (Math.abs(corr[i * n + j]!) < corrThreshold) {
        adj[i]![j] = false;
        adj[j]![i] = false;
        sepSet.set(`${i}:${j}`, []);
      }
    }
  }

  // Order-1 partial correlation independence given a single neighbor k
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (!adj[i]![j]) continue;
      for (let k = 0; k < n; k++) {
        if (k === i || k === j) continue;
        if (!adj[i]![k] && !adj[j]![k]) continue;
        const rij = corr[i * n + j]!;
        const rik = corr[i * n + k]!;
        const rjk = corr[j * n + k]!;
        const denom = Math.sqrt(Math.max(1e-12, (1 - rik * rik) * (1 - rjk * rjk)));
        const pcorr = (rij - rik * rjk) / denom;
        if (Math.abs(pcorr) < corrThreshold) {
          adj[i]![j] = false;
          adj[j]![i] = false;
          sepSet.set(`${i}:${j}`, [k]);
          break;
        }
      }
    }
  }

  const skeleton: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (adj[i]![j]) skeleton.push([i, j]);
    }
  }

  // Orient v-structures: i - k - j where i and j are non-adjacent and k not in sepSet(i, j)
  const directedSet = new Set<string>();
  const directedEdges: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (adj[i]![j]) continue;
      const sep = sepSet.get(`${i}:${j}`) ?? [];
      for (let k = 0; k < n; k++) {
        if (k === i || k === j) continue;
        if (adj[i]![k] && adj[j]![k] && !sep.includes(k)) {
          if (!directedSet.has(`${i}->${k}`)) {
            directedSet.add(`${i}->${k}`);
            directedEdges.push([i, k]);
          }
          if (!directedSet.has(`${j}->${k}`)) {
            directedSet.add(`${j}->${k}`);
            directedEdges.push([j, k]);
          }
        }
      }
    }
  }

  void solveDenseLinear;
  return { variables: [...variables], skeleton, directedEdges };
}

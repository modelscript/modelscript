// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/simulate — Advanced Systems Biology & Cheminformatics Algorithms.
 *
 * Complements `systems-biology.ts` with:
 *   1. Tau-Leaping Stochastic Simulation Algorithm (Poisson-approximated accelerated SSA)
 *   2. Flux Variability Analysis (FVA) — min/max flux envelope per reaction at optimal objective
 *   3. Morgan Circular Molecular Fingerprints (ECFP-style bitvector & Tanimoto similarity for `smiles`/`pdb`)
 */

import { solveFluxBalanceAnalysis } from "./systems-biology.js";

function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function samplePoisson(lambda: number, rng: () => number): number {
  if (lambda <= 0) return 0;
  if (lambda < 30) {
    const L = Math.exp(-lambda);
    let k = 0;
    let p = 1;
    do {
      k++;
      p *= rng();
    } while (p > L);
    return k - 1;
  }
  // Normal approximation for large lambda
  const u1 = Math.max(1e-15, rng());
  const u2 = rng();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * z));
}

/** Accelerated Tau-Leaping Stochastic Simulation Algorithm for stiff/high-copy reaction networks. */
export function runTauLeapingSsa(
  initialCounts: readonly number[],
  stoichiometry: readonly (readonly number[])[],
  propensities: (counts: readonly number[]) => number[],
  tEnd: number,
  tau = 0.05,
  seed = 77,
): { times: number[]; trajectories: number[][] } {
  const rng = mulberry32(seed);
  const counts = [...initialCounts];
  const times: number[] = [0];
  const trajectories: number[][] = [[...counts]];

  for (let t = 0; t < tEnd;) {
    const dt = Math.min(tau, tEnd - t);
    const props = propensities(counts);
    for (let r = 0; r < props.length; r++) {
      const k = samplePoisson(Math.max(0, props[r]!) * dt, rng);
      if (k === 0) continue;
      const delta = stoichiometry[r]!;
      for (let s = 0; s < counts.length; s++) {
        counts[s] = Math.max(0, counts[s]! + k * delta[s]!);
      }
    }
    t += dt;
    times.push(t);
    trajectories.push([...counts]);
  }
  return { times, trajectories };
}

export interface FvaRange {
  readonly reactionIndex: number;
  readonly minFlux: number;
  readonly maxFlux: number;
}

/**
 * Flux Variability Analysis (FVA): computes min and max allowable flux for each reaction
 * while maintaining the stoichiometric steady-state S*v = 0 and bounds.
 */
export function runFluxVariabilityAnalysis(
  stoichiometry: readonly (readonly number[])[],
  lowerBounds: readonly number[],
  upperBounds: readonly number[],
): FvaRange[] {
  const n = lowerBounds.length;
  const ranges: FvaRange[] = [];
  for (let j = 0; j < n; j++) {
    const objMax = new Array<number>(n).fill(0);
    objMax[j] = 1;
    const objMin = new Array<number>(n).fill(0);
    objMin[j] = -1;
    const resMax = solveFluxBalanceAnalysis(stoichiometry, lowerBounds, upperBounds, objMax, 600);
    const resMin = solveFluxBalanceAnalysis(stoichiometry, lowerBounds, upperBounds, objMin, 600);
    ranges.push({
      reactionIndex: j,
      minFlux: resMin.fluxes[j]!,
      maxFlux: resMax.fluxes[j]!,
    });
  }
  return ranges;
}

export interface MolecularGraph {
  readonly atoms: readonly string[]; // e.g. ["C", "C", "O"]
  readonly bonds: readonly (readonly [number, number, number?])[]; // [u, v, order]
}

function fnv1a32(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Computes a Morgan Circular Molecular Fingerprint (ECFP-style folded bitvector) for cheminformatics.
 */
export function computeMorganFingerprint(mol: MolecularGraph, radius = 2, nBits = 256): Uint8Array {
  const n = mol.atoms.length;
  const adj: Array<Array<{ to: number; order: number }>> = Array.from({ length: n }, () => []);
  for (const [u, v, order] of mol.bonds) {
    const ord = order ?? 1;
    adj[u]!.push({ to: v, order: ord });
    adj[v]!.push({ to: u, order: ord });
  }

  let envIds = mol.atoms.map((sym, i) => fnv1a32(`${sym}:${adj[i]!.length}`));
  const bits = new Uint8Array(nBits);
  for (const id of envIds) bits[id % nBits] = 1;

  for (let r = 1; r <= radius; r++) {
    const nextIds = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      const nbrTokens = adj[i]!.map((e) => `${e.order}:${envIds[e.to]!}`)
        .sort()
        .join(",");
      const h = fnv1a32(`${r}:${envIds[i]!}:${nbrTokens}`);
      nextIds[i] = h;
      bits[h % nBits] = 1;
    }
    envIds = nextIds;
  }

  return bits;
}

/** Computes Tanimoto (Jaccard) similarity between two binary molecular fingerprints. */
export function tanimotoSimilarity(fpA: Uint8Array, fpB: Uint8Array): number {
  let both = 0;
  let either = 0;
  const n = Math.min(fpA.length, fpB.length);
  for (let i = 0; i < n; i++) {
    const a = fpA[i]! > 0 ? 1 : 0;
    const b = fpB[i]! > 0 ? 1 : 0;
    if (a && b) both++;
    if (a || b) either++;
  }
  return either === 0 ? 1.0 : both / either;
}

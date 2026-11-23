// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Gebhart absorption factor (B_ij), SINDA radiation conductor (RADK),
 * and steady-state radiative equilibrium temperature solver.
 */

import { computeSurfaceArea } from "../cad/index.js";
import { DEEP_SPACE_TEMP_K, STEFAN_BOLTZMANN, type TrasysSurface } from "../types.js";
import type { ViewFactorResult } from "./view-factors.js";

export interface GebhartResult {
  surfaceIds: string[];
  /** Gebhart absorption matrix B[i][j] (fraction of energy emitted by i absorbed by j). */
  B: number[][];
  /** Fraction of energy emitted by i lost to deep space: B_{i->space} = 1 - sum_j B_ij. */
  Bspace: number[];
  /** Radiation conductors RADK[i][j] = sigma * A_i * eps_i * B_ij (W/K^4). */
  radk: number[][];
  /** Space radiation conductors RADK_space[i] = sigma * A_i * eps_i * B_{i->space} (W/K^4). */
  radkSpace: number[];
}

/**
 * Solves dense linear system A * X = RHS via Gaussian elimination with partial pivoting.
 */
function solveLinearSystem(A: number[][], rhs: number[][]): number[][] {
  const n = A.length;
  const m = rhs[0]?.length ?? 0;
  const M = A.map((row) => [...row]);
  const B = rhs.map((row) => [...row]);

  for (let col = 0; col < n; col++) {
    let pivotRow = col;
    let maxVal = Math.abs(M[col]![col] ?? 0);
    for (let r = col + 1; r < n; r++) {
      const v = Math.abs(M[r]![col] ?? 0);
      if (v > maxVal) {
        maxVal = v;
        pivotRow = r;
      }
    }
    if (pivotRow !== col) {
      const tmpM = M[col]!;
      M[col] = M[pivotRow]!;
      M[pivotRow] = tmpM;
      const tmpB = B[col]!;
      B[col] = B[pivotRow]!;
      B[pivotRow] = tmpB;
    }

    const pivot = M[col]![col] ?? 0;
    if (Math.abs(pivot) < 1e-15) continue;

    for (let j = col; j < n; j++) M[col]![j] = (M[col]![j] ?? 0) / pivot;
    for (let j = 0; j < m; j++) B[col]![j] = (B[col]![j] ?? 0) / pivot;

    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = M[r]![col] ?? 0;
      if (Math.abs(factor) < 1e-15) continue;
      for (let j = col; j < n; j++) M[r]![j] = (M[r]![j] ?? 0) - factor * (M[col]![j] ?? 0);
      for (let j = 0; j < m; j++) B[r]![j] = (B[r]![j] ?? 0) - factor * (B[col]![j] ?? 0);
    }
  }
  return B;
}

/**
 * Computes Gebhart absorption factors B_ij and radiation conductors RADK_ij
 * by solving: (I - F * diag(1 - eps)) * B = F * diag(eps).
 */
export function computeGebhartExchange(
  surfaces: TrasysSurface[],
  vf: ViewFactorResult,
  sigma: number = STEFAN_BOLTZMANN,
): GebhartResult {
  const active = surfaces.filter((s) => s.active !== "NONE");
  const n = active.length;
  const surfaceIds = active.map((s) => s.id);

  if (n === 0) {
    return { surfaceIds: [], B: [], Bspace: [], radk: [], radkSpace: [] };
  }

  const eps = active.map((s) => Math.max(0, Math.min(1, s.prop.epsilon)));
  const areas = active.map((s) => computeSurfaceArea(s));

  // Build A = I - F * diag(1 - eps), RHS = F * diag(eps)
  const A: number[][] = Array.from({ length: n }, () => Array<number>(n).fill(0));
  const RHS: number[][] = Array.from({ length: n }, () => Array<number>(n).fill(0));

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const fij = vf.matrix[i]?.[j] ?? 0;
      const ej = eps[j] ?? 0;
      A[i]![j] = (i === j ? 1 : 0) - fij * (1 - ej);
      RHS[i]![j] = fij * ej;
    }
  }

  const B = solveLinearSystem(A, RHS);
  const Bspace: number[] = [];
  const radk: number[][] = Array.from({ length: n }, () => Array<number>(n).fill(0));
  const radkSpace: number[] = [];

  for (let i = 0; i < n; i++) {
    let sumB = 0;
    const factor = sigma * (areas[i] ?? 0) * (eps[i] ?? 0);
    for (let j = 0; j < n; j++) {
      const bij = Math.max(0, B[i]![j] ?? 0);
      B[i]![j] = bij;
      sumB += bij;
      radk[i]![j] = factor * bij;
    }
    const bs = Math.max(0, 1 - sumB);
    Bspace.push(bs);
    radkSpace.push(factor * bs);
  }

  return { surfaceIds, B, Bspace, radk, radkSpace };
}

/**
 * Solves steady-state radiative equilibrium temperatures T_i (K) for a coupled TRASYS network:
 *   sum_j RADK_ij * (T_i^4 - T_j^4) + RADK_space_i * (T_i^4 - T_space^4) = Q_i
 * Since this is linear in u_i = T_i^4, it is solved exactly in one linear solve.
 */
export function solveEquilibriumTemperatures(
  gebhart: GebhartResult,
  heatLoadsW: Record<string, number>,
  spaceTempK: number = DEEP_SPACE_TEMP_K,
): Record<string, number> {
  const n = gebhart.surfaceIds.length;
  if (n === 0) return {};

  const uSpace = Math.pow(spaceTempK, 4);
  const A: number[][] = Array.from({ length: n }, () => Array<number>(n).fill(0));
  const rhs: number[][] = Array.from({ length: n }, () => [0]);

  for (let i = 0; i < n; i++) {
    const id = gebhart.surfaceIds[i]!;
    let diag = gebhart.radkSpace[i] ?? 0;
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const gij = gebhart.radk[i]?.[j] ?? 0;
      diag += gij;
      A[i]![j] = -gij;
    }
    A[i]![i] = Math.max(diag, 1e-18);
    rhs[i]![0] = (heatLoadsW[id] ?? 0) + (gebhart.radkSpace[i] ?? 0) * uSpace;
  }

  const sol = solveLinearSystem(A, rhs);
  const temps: Record<string, number> = {};
  for (let i = 0; i < n; i++) {
    const id = gebhart.surfaceIds[i]!;
    const u = Math.max(0, sol[i]?.[0] ?? 0);
    temps[id] = Math.pow(u, 0.25);
  }
  return temps;
}

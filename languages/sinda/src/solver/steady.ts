// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Steady-State Thermal Network Solver (`STDSTL`) using damped Newton-Raphson
 * with exact analytical Jacobian for linear conduction/convection and nonlinear
 * Stefan-Boltzmann radiation (σ * G_ij * (T_j^4 - T_i^4)).
 */

import type { SindaModel } from "../types.js";
import { solveLinearSystem } from "./linear.js";

export interface SindaSteadyOptions {
  /** Maximum Newton-Raphson iterations (default: 100). */
  maxIterations?: number;
  /** Residual and step convergence tolerance (default: 1e-9). */
  tolerance?: number;
}

export interface SindaSteadyResult {
  converged: boolean;
  iterations: number;
  maxResidual: number;
  /** Converged node temperatures keyed by canonical node ID. */
  temperatures: Map<number, number>;
  /** Net heat flow Q_{i->j} (W) across each conductor keyed by conductor ID. */
  conductorHeatFlows: Map<number, number>;
}

/**
 * Solves steady-state thermal equilibrium (`STDSTL`):
 *   Q_i + sum_lin G_k (T_j - T_i) + sum_rad sigma * G_r (T_j^4 - T_i^4) = 0
 * for all non-boundary nodes.
 */
export function solveSindaSteadyState(model: SindaModel, options?: SindaSteadyOptions): SindaSteadyResult {
  const maxIter = options?.maxIterations ?? (model.constants["NLOOP"] ? Math.round(model.constants["NLOOP"]) : 100);
  const tol = options?.tolerance ?? model.constants["DRLXCA"] ?? 1e-9;
  const sigma = model.options.sigma;
  const abszro = model.options.abszro;

  const freeIds: number[] = [];
  const freeIndex = new Map<number, number>();
  const temps = new Map<number, number>();

  for (const node of model.nodes.values()) {
    temps.set(node.id, node.initialTemp);
    if (node.kind !== "boundary") {
      freeIndex.set(node.id, freeIds.length);
      freeIds.push(node.id);
    }
  }

  const n = freeIds.length;
  const heatLoads = new Float64Array(n);
  for (const src of model.sources) {
    const idx = freeIndex.get(src.nodeId);
    if (idx !== undefined) {
      heatLoads[idx] = heatLoads[idx]! + src.heatLoad;
    }
  }

  const validConductors = [...model.conductors.values()].filter(
    (c) => c.nodeI !== c.nodeJ && model.nodes.has(c.nodeI) && model.nodes.has(c.nodeJ),
  );
  const hasRadiation = validConductors.some((c) => c.kind === "radiation");

  let converged = n === 0;
  let iterations = 0;
  let maxResidual = 0;

  const residual = new Float64Array(n);
  const negResidual = new Float64Array(n);
  const jac: Float64Array[] = Array.from({ length: n }, () => new Float64Array(n));

  for (let iter = 0; iter < maxIter && !converged; iter++) {
    iterations = iter + 1;
    residual.set(heatLoads);
    for (let i = 0; i < n; i++) {
      jac[i]!.fill(0);
    }

    for (const c of validConductors) {
      const ti = temps.get(c.nodeI)!;
      const tj = temps.get(c.nodeJ)!;
      const idxI = freeIndex.get(c.nodeI);
      const idxJ = freeIndex.get(c.nodeJ);

      if (c.kind === "linear") {
        const g = c.conductance;
        const qij = g * (tj - ti); // heat entering node I from node J
        if (idxI !== undefined) {
          residual[idxI] = residual[idxI]! + qij;
          jac[idxI]![idxI] = jac[idxI]![idxI]! - g;
          if (idxJ !== undefined) {
            jac[idxI]![idxJ] = jac[idxI]![idxJ]! + g;
          }
        }
        if (idxJ !== undefined) {
          residual[idxJ] = residual[idxJ]! - qij;
          jac[idxJ]![idxJ] = jac[idxJ]![idxJ]! - g;
          if (idxI !== undefined) {
            jac[idxJ]![idxI] = jac[idxJ]![idxI]! + g;
          }
        }
      } else {
        const tiAbs = ti - abszro;
        const tjAbs = tj - abszro;
        const ti2 = tiAbs * tiAbs;
        const tj2 = tjAbs * tjAbs;
        const ti3 = ti2 * tiAbs;
        const tj3 = tj2 * tjAbs;
        const radCoeff = sigma * c.conductance;
        const qij = radCoeff * (tj2 * tj2 - ti2 * ti2);
        const dQ_dTi = -4.0 * radCoeff * ti3;
        const dQ_dTj = 4.0 * radCoeff * tj3;

        if (idxI !== undefined) {
          residual[idxI] = residual[idxI]! + qij;
          jac[idxI]![idxI] = jac[idxI]![idxI]! + dQ_dTi;
          if (idxJ !== undefined) {
            jac[idxI]![idxJ] = jac[idxI]![idxJ]! + dQ_dTj;
          }
        }
        if (idxJ !== undefined) {
          residual[idxJ] = residual[idxJ]! - qij;
          jac[idxJ]![idxJ] = jac[idxJ]![idxJ]! - dQ_dTj;
          if (idxI !== undefined) {
            jac[idxJ]![idxI] = jac[idxJ]![idxI]! - dQ_dTi;
          }
        }
      }
    }

    maxResidual = 0;
    for (let i = 0; i < n; i++) {
      const rAbs = Math.abs(residual[i]!);
      if (rAbs > maxResidual) maxResidual = rAbs;
      negResidual[i] = -residual[i]!;
    }

    if (maxResidual <= tol) {
      converged = true;
      break;
    }

    const delta = solveLinearSystem(jac, negResidual);
    if (!delta) {
      break;
    }

    // Damping to keep absolute temperatures strictly positive in radiation networks
    let alpha = 1.0;
    if (hasRadiation) {
      for (let i = 0; i < n; i++) {
        const tCurAbs = temps.get(freeIds[i]!)! - abszro;
        const dT = delta[i]!;
        if (tCurAbs + alpha * dT <= 1.0) {
          alpha = Math.min(alpha, Math.max(0.1, (0.5 * tCurAbs) / Math.abs(dT)));
        }
      }
    }

    let maxStep = 0;
    for (let i = 0; i < n; i++) {
      const step = alpha * delta[i]!;
      const cur = temps.get(freeIds[i]!)!;
      temps.set(freeIds[i]!, cur + step);
      if (Math.abs(step) > maxStep) maxStep = Math.abs(step);
    }

    if (maxStep <= tol && maxResidual <= Math.max(tol * 1e3, 1e-6)) {
      // Re-evaluate final residual next iteration or accept
      continue;
    }
  }

  // Compute conductor heat flows Q_{i -> j} (positive from nodeI to nodeJ)
  const conductorHeatFlows = new Map<number, number>();
  for (const c of validConductors) {
    const ti = temps.get(c.nodeI)!;
    const tj = temps.get(c.nodeJ)!;
    if (c.kind === "linear") {
      conductorHeatFlows.set(c.id, c.conductance * (ti - tj));
    } else {
      const tiAbs = ti - abszro;
      const tjAbs = tj - abszro;
      const ti4 = tiAbs * tiAbs * tiAbs * tiAbs;
      const tj4 = tjAbs * tjAbs * tjAbs * tjAbs;
      conductorHeatFlows.set(c.id, sigma * c.conductance * (ti4 - tj4));
    }
  }

  return {
    converged,
    iterations,
    maxResidual,
    temperatures: temps,
    conductorHeatFlows,
  };
}

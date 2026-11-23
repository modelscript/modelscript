// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Transient Thermal Network Integrator (`CRANKN`, `FWDBCK`, `RK4`) for NASA SINDA.
 *
 * - `CRANKN` / `FWDBCK`: Implicit Crank-Nicolson ($\theta = 0.5$) with per-step
 *   Newton-Raphson nonlinear solver supporting both diffusion ($C > 0$) and
 *   algebraic arithmetic ($C = 0$) nodes as well as Stefan-Boltzmann radiation.
 * - `RK4`: Classical 4th-order Runge-Kutta explicit integrator for diffusion networks.
 */

import type { SindaModel } from "../types.js";
import { solveLinearSystem } from "./linear.js";

export type SindaTransientMethod = "CRANKN" | "FWDBCK" | "RK4";

export interface SindaTransientOptions {
  /** Integration method (default: inferred from HEADER EXECUTION or "CRANKN"). */
  method?: SindaTransientMethod;
  /** Start time in seconds (default: model.constants.TIMEO ?? 0). */
  tStart?: number;
  /** End time in seconds (default: model.constants.TIMEND ?? 10). */
  tEnd?: number;
  /** Time step in seconds (default: model.constants.DTIMEI ?? (tEnd - tStart) / 100). */
  dt?: number;
  /** Newton-Raphson tolerance for implicit steps (default: 1e-9). */
  tolerance?: number;
  /** Maximum Newton iterations per implicit step (default: 40). */
  maxNewtonIterations?: number;
}

export interface SindaTransientResult {
  method: SindaTransientMethod;
  times: number[];
  /** Time-series temperature history keyed by canonical node ID. */
  temperatures: Map<number, number[]>;
  /** Final temperatures at t = tEnd keyed by canonical node ID. */
  finalTemperatures: Map<number, number>;
  steps: number;
}

/**
 * Computes net heat flow rate $F_i(T) = Q_i + \sum G(T_j - T_i) + \sum \sigma G(T_j^4 - T_i^4)$
 * and its analytical Jacobian $J_{ij} = \partial F_i / \partial T_j$ for all free nodes.
 */
function evalThermalNetHeatAndJacobian(
  model: SindaModel,
  freeIds: number[],
  freeIndex: Map<number, number>,
  heatLoads: Float64Array,
  temps: Map<number, number>,
  netHeat: Float64Array,
  jac?: Float64Array[],
): void {
  const n = freeIds.length;
  const sigma = model.options.sigma;
  const abszro = model.options.abszro;

  netHeat.set(heatLoads);
  if (jac) {
    for (let i = 0; i < n; i++) jac[i]!.fill(0);
  }

  for (const c of model.conductors.values()) {
    if (c.nodeI === c.nodeJ || !model.nodes.has(c.nodeI) || !model.nodes.has(c.nodeJ)) continue;
    const ti = temps.get(c.nodeI)!;
    const tj = temps.get(c.nodeJ)!;
    const idxI = freeIndex.get(c.nodeI);
    const idxJ = freeIndex.get(c.nodeJ);

    if (c.kind === "linear") {
      const g = c.conductance;
      const qij = g * (tj - ti);
      if (idxI !== undefined) {
        netHeat[idxI] = netHeat[idxI]! + qij;
        if (jac) {
          jac[idxI]![idxI] = jac[idxI]![idxI]! - g;
          if (idxJ !== undefined) jac[idxI]![idxJ] = jac[idxI]![idxJ]! + g;
        }
      }
      if (idxJ !== undefined) {
        netHeat[idxJ] = netHeat[idxJ]! - qij;
        if (jac) {
          jac[idxJ]![idxJ] = jac[idxJ]![idxJ]! - g;
          if (idxI !== undefined) jac[idxJ]![idxI] = jac[idxJ]![idxI]! + g;
        }
      }
    } else {
      const tiAbs = ti - abszro;
      const tjAbs = tj - abszro;
      const ti2 = tiAbs * tiAbs;
      const tj2 = tjAbs * tjAbs;
      const radCoeff = sigma * c.conductance;
      const qij = radCoeff * (tj2 * tj2 - ti2 * ti2);
      const dQ_dTi = -4.0 * radCoeff * ti2 * tiAbs;
      const dQ_dTj = 4.0 * radCoeff * tj2 * tjAbs;

      if (idxI !== undefined) {
        netHeat[idxI] = netHeat[idxI]! + qij;
        if (jac) {
          jac[idxI]![idxI] = jac[idxI]![idxI]! + dQ_dTi;
          if (idxJ !== undefined) jac[idxI]![idxJ] = jac[idxI]![idxJ]! + dQ_dTj;
        }
      }
      if (idxJ !== undefined) {
        netHeat[idxJ] = netHeat[idxJ]! - qij;
        if (jac) {
          jac[idxJ]![idxJ] = jac[idxJ]![idxJ]! - dQ_dTj;
          if (idxI !== undefined) jac[idxJ]![idxI] = jac[idxJ]![idxI]! - dQ_dTi;
        }
      }
    }
  }
}

/**
 * Integrates a SINDA thermal network in time using `CRANKN`, `FWDBCK`, or `RK4`.
 */
export function solveSindaTransient(model: SindaModel, options?: SindaTransientOptions): SindaTransientResult {
  const inferredMethod: SindaTransientMethod = model.execution.some((e) => e.routine === "FWDBCK")
    ? "FWDBCK"
    : "CRANKN";
  const method: SindaTransientMethod = options?.method ?? inferredMethod;

  const tStart = options?.tStart ?? model.constants["TIMEO"] ?? 0.0;
  const tEnd = options?.tEnd ?? model.constants["TIMEND"] ?? 10.0;
  const rawDt = options?.dt ?? model.constants["DTIMEI"] ?? (tEnd - tStart) / 100;
  const dtBase = rawDt > 0 ? rawDt : 0.1;
  const tol = options?.tolerance ?? 1e-9;
  const maxNewton = options?.maxNewtonIterations ?? 40;

  const freeIds: number[] = [];
  const freeIndex = new Map<number, number>();
  const caps: number[] = [];
  const temps = new Map<number, number>();
  const history = new Map<number, number[]>();

  for (const node of model.nodes.values()) {
    temps.set(node.id, node.initialTemp);
    history.set(node.id, [node.initialTemp]);
    if (node.kind !== "boundary") {
      freeIndex.set(node.id, freeIds.length);
      freeIds.push(node.id);
      caps.push(node.kind === "diffusion" ? node.capacitance : 0.0);
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

  const times: number[] = [tStart];
  let t = tStart;
  let steps = 0;

  const fCur = new Float64Array(n);
  const fNext = new Float64Array(n);
  const res = new Float64Array(n);
  const negRes = new Float64Array(n);
  const jacF: Float64Array[] = Array.from({ length: n }, () => new Float64Array(n));
  const jacSys: Float64Array[] = Array.from({ length: n }, () => new Float64Array(n));

  while (t < tEnd - 1e-12) {
    const dt = Math.min(dtBase, tEnd - t);
    steps++;

    if (n > 0) {
      if (method === "RK4") {
        // Classical 4th-order Runge-Kutta for diffusion nodes
        const t0Vec = new Float64Array(n);
        for (let i = 0; i < n; i++) t0Vec[i] = temps.get(freeIds[i]!)!;

        const k1 = new Float64Array(n);
        const k2 = new Float64Array(n);
        const k3 = new Float64Array(n);
        const k4 = new Float64Array(n);

        evalThermalNetHeatAndJacobian(model, freeIds, freeIndex, heatLoads, temps, fCur);
        for (let i = 0; i < n; i++) k1[i] = caps[i]! > 0 ? fCur[i]! / caps[i]! : 0;

        for (let i = 0; i < n; i++) temps.set(freeIds[i]!, t0Vec[i]! + 0.5 * dt * k1[i]!);
        evalThermalNetHeatAndJacobian(model, freeIds, freeIndex, heatLoads, temps, fCur);
        for (let i = 0; i < n; i++) k2[i] = caps[i]! > 0 ? fCur[i]! / caps[i]! : 0;

        for (let i = 0; i < n; i++) temps.set(freeIds[i]!, t0Vec[i]! + 0.5 * dt * k2[i]!);
        evalThermalNetHeatAndJacobian(model, freeIds, freeIndex, heatLoads, temps, fCur);
        for (let i = 0; i < n; i++) k3[i] = caps[i]! > 0 ? fCur[i]! / caps[i]! : 0;

        for (let i = 0; i < n; i++) temps.set(freeIds[i]!, t0Vec[i]! + dt * k3[i]!);
        evalThermalNetHeatAndJacobian(model, freeIds, freeIndex, heatLoads, temps, fCur);
        for (let i = 0; i < n; i++) k4[i] = caps[i]! > 0 ? fCur[i]! / caps[i]! : 0;

        for (let i = 0; i < n; i++) {
          const nextT = t0Vec[i]! + (dt / 6.0) * (k1[i]! + 2.0 * k2[i]! + 2.0 * k3[i]! + k4[i]!);
          temps.set(freeIds[i]!, nextT);
        }
      } else {
        // Implicit Crank-Nicolson (theta = 0.5) for CRANKN / FWDBCK
        const theta = 0.5;
        const tOld = new Float64Array(n);
        for (let i = 0; i < n; i++) tOld[i] = temps.get(freeIds[i]!)!;

        evalThermalNetHeatAndJacobian(model, freeIds, freeIndex, heatLoads, temps, fCur);

        // Newton-Raphson solve for T^{n+1}:
        //   Diffusion (C_i > 0): C_i * (T^{n+1}_i - T^n_i) / dt - (1 - theta) * F_i(T^n) - theta * F_i(T^{n+1}) = 0
        //   Arithmetic (C_i == 0): -F_i(T^{n+1}) = 0
        for (let iter = 0; iter < maxNewton; iter++) {
          evalThermalNetHeatAndJacobian(model, freeIds, freeIndex, heatLoads, temps, fNext, jacF);
          let maxR = 0;

          for (let i = 0; i < n; i++) {
            const c = caps[i]!;
            if (c > 0) {
              const tNew = temps.get(freeIds[i]!)!;
              res[i] = (c / dt) * (tNew - tOld[i]!) - (1.0 - theta) * fCur[i]! - theta * fNext[i]!;
              for (let j = 0; j < n; j++) {
                jacSys[i]![j] = (i === j ? c / dt : 0.0) - theta * jacF[i]![j]!;
              }
            } else {
              res[i] = -fNext[i]!;
              for (let j = 0; j < n; j++) {
                jacSys[i]![j] = -jacF[i]![j]!;
              }
            }
            const rAbs = Math.abs(res[i]!);
            if (rAbs > maxR) maxR = rAbs;
            negRes[i] = -res[i]!;
          }

          if (maxR <= tol) break;
          const delta = solveLinearSystem(jacSys, negRes);
          if (!delta) break;

          let maxStep = 0;
          for (let i = 0; i < n; i++) {
            const step = delta[i]!;
            temps.set(freeIds[i]!, temps.get(freeIds[i]!)! + step);
            if (Math.abs(step) > maxStep) maxStep = Math.abs(step);
          }
          if (maxStep <= tol) break;
        }
      }
    }

    t += dt;
    times.push(t);
    for (const node of model.nodes.values()) {
      history.get(node.id)!.push(temps.get(node.id)!);
    }
  }

  return {
    method,
    times,
    temperatures: history,
    finalTemperatures: new Map(temps),
    steps,
  };
}

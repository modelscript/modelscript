// SPDX-License-Identifier: AGPL-3.0-or-later

import type { IeeeCdfNetwork } from "../types.js";
import { buildYBus, type YBusMatrix } from "./ybus.js";

export interface PowerFlowOptions {
  /** Convergence tolerance on infinity-norm of power mismatches in pu (default: 1e-10). */
  tolerance?: number;
  /** Maximum Newton-Raphson iterations per Q-limit outer pass (default: 50). */
  maxIterations?: number;
  /** Whether to enforce PV bus Qmin/Qmax reactive limits (default: true). */
  enforceQLimits?: boolean;
  /** Maximum PV-to-PQ Q-limit enforcement passes (default: 10). */
  maxQLimitPasses?: number;
  /** Use flat start (V=1.0 for PQ, theta=0.0) instead of file's initial voltages (default: true). */
  flatStart?: boolean;
}

export interface BusFlowResult {
  busNumber: number;
  name: string;
  originalType: number;
  solvedType: number;
  vmPu: number;
  vaDeg: number;
  pGenMw: number;
  qGenMvar: number;
  pLoadMw: number;
  qLoadMvar: number;
  qLimitHit?: "Qmax" | "Qmin" | undefined;
}

export interface BranchFlowResult {
  fromBus: number;
  toBus: number;
  circuit: string;
  pFromMw: number;
  qFromMvar: number;
  pToMw: number;
  qToMvar: number;
  pLossMw: number;
  qLossMvar: number;
}

export interface PowerFlowResult {
  converged: boolean;
  iterations: number;
  maxMismatchPu: number;
  mvaBase: number;
  buses: BusFlowResult[];
  branches: BranchFlowResult[];
  totalGenMw: number;
  totalGenMvar: number;
  totalLoadMw: number;
  totalLoadMvar: number;
  totalLossMw: number;
  totalLossMvar: number;
  ybus: YBusMatrix;
}

/**
 * Dense Gaussian elimination with partial pivoting solving `A x = b`.
 */
function solveLinearSystem(a: Float64Array, b: Float64Array, n: number): Float64Array {
  const mat = new Float64Array(a);
  const rhs = new Float64Array(b);

  for (let col = 0; col < n; col++) {
    let pivotRow = col;
    let pivotAbs = Math.abs(mat[col * n + col]!);
    for (let r = col + 1; r < n; r++) {
      const v = Math.abs(mat[r * n + col]!);
      if (v > pivotAbs) {
        pivotAbs = v;
        pivotRow = r;
      }
    }
    if (pivotAbs < 1e-15) {
      throw new Error(`Singular Jacobian matrix at pivot column ${col}`);
    }
    if (pivotRow !== col) {
      for (let c = col; c < n; c++) {
        const tmp = mat[col * n + c]!;
        mat[col * n + c] = mat[pivotRow * n + c]!;
        mat[pivotRow * n + c] = tmp;
      }
      const tmpR = rhs[col]!;
      rhs[col] = rhs[pivotRow]!;
      rhs[pivotRow] = tmpR;
    }

    const pivot = mat[col * n + col]!;
    for (let r = col + 1; r < n; r++) {
      const factor = mat[r * n + col]! / pivot;
      if (Math.abs(factor) < 1e-18) continue;
      mat[r * n + col] = 0;
      for (let c = col + 1; c < n; c++) {
        mat[r * n + c] = mat[r * n + c]! - factor * mat[col * n + c]!;
      }
      rhs[r] = rhs[r]! - factor * rhs[col]!;
    }
  }

  const x = new Float64Array(n);
  for (let r = n - 1; r >= 0; r--) {
    let sum = rhs[r]!;
    for (let c = r + 1; c < n; c++) {
      sum -= mat[r * n + c]! * x[c]!;
    }
    x[r] = sum / mat[r * n + r]!;
  }
  return x;
}

/**
 * Solves polar AC power flow via Newton-Raphson with analytical Jacobian and optional PV Q-limit enforcement.
 */
export function solvePowerFlow(network: IeeeCdfNetwork, options: PowerFlowOptions = {}): PowerFlowResult {
  const tol = options.tolerance ?? 1e-10;
  const maxIter = options.maxIterations ?? 50;
  const enforceQLimits = options.enforceQLimits ?? true;
  const maxQPasses = options.maxQLimitPasses ?? 10;
  const flatStart = options.flatStart ?? true;

  const mvaBase = network.title.mvaBase > 0 ? network.title.mvaBase : 100.0;
  const ybus = buildYBus(network);
  const n = ybus.size;

  const vm = new Float64Array(n);
  const va = new Float64Array(n);
  const activeType = new Int8Array(n);
  const pSpec = new Float64Array(n);
  const qSpec = new Float64Array(n);
  const qLimitHit: Array<"Qmax" | "Qmin" | undefined> = new Array(n).fill(undefined);

  for (let i = 0; i < n; i++) {
    const bus = network.buses[i]!;
    activeType[i] = bus.type;
    if (bus.type === 3) {
      vm[i] = bus.desiredVoltsPu > 0 ? bus.desiredVoltsPu : bus.finalVoltagePu > 0 ? bus.finalVoltagePu : 1.0;
      va[i] = (bus.finalAngleDeg * Math.PI) / 180.0;
    } else if (bus.type === 2) {
      vm[i] = bus.desiredVoltsPu > 0 ? bus.desiredVoltsPu : bus.finalVoltagePu > 0 ? bus.finalVoltagePu : 1.0;
      va[i] = flatStart ? 0.0 : (bus.finalAngleDeg * Math.PI) / 180.0;
    } else {
      vm[i] = flatStart ? 1.0 : bus.finalVoltagePu > 0 ? bus.finalVoltagePu : 1.0;
      va[i] = flatStart ? 0.0 : (bus.finalAngleDeg * Math.PI) / 180.0;
    }
    pSpec[i] = (bus.genMw - bus.loadMw) / mvaBase;
    qSpec[i] = (bus.genMvar - bus.loadMvar) / mvaBase;
  }

  const pCalc = new Float64Array(n);
  const qCalc = new Float64Array(n);

  const evalInjections = (): void => {
    for (let i = 0; i < n; i++) {
      let pSum = 0.0;
      let qSum = 0.0;
      const vi = vm[i]!;
      const ti = va[i]!;
      const row = ybus.rows[i]!;
      for (let m = 0; m < row.length; m++) {
        const entry = row[m]!;
        const k = entry.col;
        const vk = vm[k]!;
        const dTheta = ti - va[k]!;
        const c = Math.cos(dTheta);
        const s = Math.sin(dTheta);
        pSum += vk * (entry.g * c + entry.b * s);
        qSum += vk * (entry.g * s - entry.b * c);
      }
      pCalc[i] = vi * pSum;
      qCalc[i] = vi * qSum;
    }
  };

  let totalIterations = 0;
  let converged = false;
  let maxMismatchPu = Number.POSITIVE_INFINITY;

  for (let pass = 0; pass < (enforceQLimits ? maxQPasses : 1); pass++) {
    const nonSlack: number[] = [];
    const pqBuses: number[] = [];
    for (let i = 0; i < n; i++) {
      if (activeType[i] !== 3) nonSlack.push(i);
      if (activeType[i] === 0 || activeType[i] === 1) pqBuses.push(i);
    }

    const nP = nonSlack.length;
    const nQ = pqBuses.length;
    const dim = nP + nQ;

    converged = false;
    for (let iter = 0; iter < maxIter; iter++) {
      evalInjections();

      let maxMis = 0.0;
      const rhs = new Float64Array(dim);
      for (let a = 0; a < nP; a++) {
        const i = nonSlack[a]!;
        const dp = pSpec[i]! - pCalc[i]!;
        rhs[a] = dp;
        const absDp = Math.abs(dp);
        if (absDp > maxMis) maxMis = absDp;
      }
      for (let a = 0; a < nQ; a++) {
        const i = pqBuses[a]!;
        const dq = qSpec[i]! - qCalc[i]!;
        rhs[nP + a] = dq;
        const absDq = Math.abs(dq);
        if (absDq > maxMis) maxMis = absDq;
      }

      maxMismatchPu = maxMis;
      if (maxMis < tol) {
        converged = true;
        break;
      }

      if (dim === 0) {
        converged = true;
        break;
      }

      const jac = new Float64Array(dim * dim);

      // J11 = dP / dTheta (nP x nP)
      for (let a = 0; a < nP; a++) {
        const i = nonSlack[a]!;
        const vi = vm[i]!;
        for (let bIdx = 0; bIdx < nP; bIdx++) {
          const k = nonSlack[bIdx]!;
          if (i === k) {
            jac[a * dim + bIdx] = -qCalc[i]! - ybus.b[i * n + i]! * vi * vi;
          } else {
            const gik = ybus.g[i * n + k]!;
            const bik = ybus.b[i * n + k]!;
            if (gik !== 0 || bik !== 0) {
              const dTheta = va[i]! - va[k]!;
              jac[a * dim + bIdx] = vi * vm[k]! * (gik * Math.sin(dTheta) - bik * Math.cos(dTheta));
            }
          }
        }
      }

      // J12 = dP / dV (nP x nQ)
      for (let a = 0; a < nP; a++) {
        const i = nonSlack[a]!;
        const vi = vm[i]!;
        for (let bIdx = 0; bIdx < nQ; bIdx++) {
          const k = pqBuses[bIdx]!;
          if (i === k) {
            jac[a * dim + (nP + bIdx)] = pCalc[i]! / vi + ybus.g[i * n + i]! * vi;
          } else {
            const gik = ybus.g[i * n + k]!;
            const bik = ybus.b[i * n + k]!;
            if (gik !== 0 || bik !== 0) {
              const dTheta = va[i]! - va[k]!;
              jac[a * dim + (nP + bIdx)] = vi * (gik * Math.cos(dTheta) + bik * Math.sin(dTheta));
            }
          }
        }
      }

      // J21 = dQ / dTheta (nQ x nP)
      for (let a = 0; a < nQ; a++) {
        const i = pqBuses[a]!;
        const vi = vm[i]!;
        for (let bIdx = 0; bIdx < nP; bIdx++) {
          const k = nonSlack[bIdx]!;
          if (i === k) {
            jac[(nP + a) * dim + bIdx] = pCalc[i]! - ybus.g[i * n + i]! * vi * vi;
          } else {
            const gik = ybus.g[i * n + k]!;
            const bik = ybus.b[i * n + k]!;
            if (gik !== 0 || bik !== 0) {
              const dTheta = va[i]! - va[k]!;
              jac[(nP + a) * dim + bIdx] = -vi * vm[k]! * (gik * Math.cos(dTheta) + bik * Math.sin(dTheta));
            }
          }
        }
      }

      // J22 = dQ / dV (nQ x nQ)
      for (let a = 0; a < nQ; a++) {
        const i = pqBuses[a]!;
        const vi = vm[i]!;
        for (let bIdx = 0; bIdx < nQ; bIdx++) {
          const k = pqBuses[bIdx]!;
          if (i === k) {
            jac[(nP + a) * dim + (nP + bIdx)] = qCalc[i]! / vi - ybus.b[i * n + i]! * vi;
          } else {
            const gik = ybus.g[i * n + k]!;
            const bik = ybus.b[i * n + k]!;
            if (gik !== 0 || bik !== 0) {
              const dTheta = va[i]! - va[k]!;
              jac[(nP + a) * dim + (nP + bIdx)] = vi * (gik * Math.sin(dTheta) - bik * Math.cos(dTheta));
            }
          }
        }
      }

      const dx = solveLinearSystem(jac, rhs, dim);
      for (let a = 0; a < nP; a++) {
        const i = nonSlack[a]!;
        va[i] = va[i]! + dx[a]!;
      }
      for (let a = 0; a < nQ; a++) {
        const i = pqBuses[a]!;
        vm[i] = Math.max(0.1, vm[i]! + dx[nP + a]!);
      }
      totalIterations++;
    }

    if (!converged || !enforceQLimits) break;

    // Check PV Q-limits
    evalInjections();
    let convertedAny = false;
    for (let i = 0; i < n; i++) {
      if (activeType[i] !== 2) continue;
      const bus = network.buses[i]!;
      const qMax = bus.maxMvarOrVolt;
      const qMin = bus.minMvarOrVolt;
      // Only enforce if valid limit window is specified (qMax > qMin)
      if (qMax <= qMin) continue;
      const qGenMvar = qCalc[i]! * mvaBase + bus.loadMvar;
      if (qGenMvar > qMax + 1e-6) {
        activeType[i] = 0;
        qSpec[i] = (qMax - bus.loadMvar) / mvaBase;
        qLimitHit[i] = "Qmax";
        convertedAny = true;
      } else if (qGenMvar < qMin - 1e-6) {
        activeType[i] = 0;
        qSpec[i] = (qMin - bus.loadMvar) / mvaBase;
        qLimitHit[i] = "Qmin";
        convertedAny = true;
      }
    }

    if (!convertedAny) break;
  }

  evalInjections();

  // Assemble bus results
  const busResults: BusFlowResult[] = [];
  let totalGenMw = 0;
  let totalGenMvar = 0;
  let totalLoadMw = 0;
  let totalLoadMvar = 0;

  for (let i = 0; i < n; i++) {
    const bus = network.buses[i]!;
    const pGenMw = bus.type === 3 ? pCalc[i]! * mvaBase + bus.loadMw : bus.genMw;
    const qGenMvar =
      bus.type === 3 || activeType[i] === 2
        ? qCalc[i]! * mvaBase + bus.loadMvar
        : qLimitHit[i] === "Qmax"
          ? bus.maxMvarOrVolt
          : qLimitHit[i] === "Qmin"
            ? bus.minMvarOrVolt
            : bus.genMvar;

    totalGenMw += pGenMw;
    totalGenMvar += qGenMvar;
    totalLoadMw += bus.loadMw;
    totalLoadMvar += bus.loadMvar;

    busResults.push({
      busNumber: bus.busNumber,
      name: bus.name,
      originalType: bus.type,
      solvedType: activeType[i]!,
      vmPu: vm[i]!,
      vaDeg: (va[i]! * 180.0) / Math.PI,
      pGenMw,
      qGenMvar,
      pLoadMw: bus.loadMw,
      qLoadMvar: bus.loadMvar,
      qLimitHit: qLimitHit[i],
    });
  }

  // Assemble branch flows and losses
  const branchResults: BranchFlowResult[] = [];
  let totalLossMw = 0;
  let totalLossMvar = 0;

  for (const br of network.branches) {
    const f = ybus.busIndexByNumber.get(br.fromBus);
    const t = ybus.busIndexByNumber.get(br.toBus);
    if (f === undefined || t === undefined || f === t) continue;

    const denom = br.r * br.r + br.x * br.x;
    if (denom < 1e-18) continue;

    const gs = br.r / denom;
    const bs = -br.x / denom;
    const bcHalf = 0.5 * br.b;
    const a = br.tapRatio > 0 ? br.tapRatio : 1.0;
    const a2 = a * a;
    const phi = (br.phaseShiftDeg * Math.PI) / 180.0;
    const cosPhi = Math.cos(phi);
    const sinPhi = Math.sin(phi);

    // Branch 2x2 admittance submatrix
    const yffG = gs / a2;
    const yffB = (bs + bcHalf) / a2;
    const yttG = gs;
    const yttB = bs + bcHalf;
    const yftG = -(gs * cosPhi - bs * sinPhi) / a;
    const yftB = -(gs * sinPhi + bs * cosPhi) / a;
    const ytfG = -(gs * cosPhi + bs * sinPhi) / a;
    const ytfB = -(-gs * sinPhi + bs * cosPhi) / a;

    const vfRe = vm[f]! * Math.cos(va[f]!);
    const vfIm = vm[f]! * Math.sin(va[f]!);
    const vtRe = vm[t]! * Math.cos(va[t]!);
    const vtIm = vm[t]! * Math.sin(va[t]!);

    // I_f = Y_ff * V_f + Y_ft * V_t
    const ifRe = yffG * vfRe - yffB * vfIm + (yftG * vtRe - yftB * vtIm);
    const ifIm = yffG * vfIm + yffB * vfRe + (yftG * vtIm + yftB * vtRe);
    // S_f = V_f * conj(I_f)
    const pFromMw = (vfRe * ifRe + vfIm * ifIm) * mvaBase;
    const qFromMvar = (vfIm * ifRe - vfRe * ifIm) * mvaBase;

    // I_t = Y_tf * V_f + Y_tt * V_t
    const itRe = ytfG * vfRe - ytfB * vfIm + (yttG * vtRe - yttB * vtIm);
    const itIm = ytfG * vfIm + ytfB * vfRe + (yttG * vtIm + yttB * vtRe);
    // S_t = V_t * conj(I_t)
    const pToMw = (vtRe * itRe + vtIm * itIm) * mvaBase;
    const qToMvar = (vtIm * itRe - vtRe * itIm) * mvaBase;

    const pLossMw = pFromMw + pToMw;
    const qLossMvar = qFromMvar + qToMvar;
    totalLossMw += pLossMw;
    totalLossMvar += qLossMvar;

    branchResults.push({
      fromBus: br.fromBus,
      toBus: br.toBus,
      circuit: br.circuit,
      pFromMw,
      qFromMvar,
      pToMw,
      qToMvar,
      pLossMw,
      qLossMvar,
    });
  }

  return {
    converged,
    iterations: totalIterations,
    maxMismatchPu,
    mvaBase,
    buses: busResults,
    branches: branchResults,
    totalGenMw,
    totalGenMvar,
    totalLoadMw,
    totalLoadMvar,
    totalLossMw,
    totalLossMvar,
    ybus,
  };
}

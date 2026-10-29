// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * High-Performance AC Power Flow Solver for PSS/E Base Cases.
 *
 * Implements:
 *   1. Full AC Newton-Raphson (NR) algorithm with analytical Jacobian assembly.
 *   2. Fast Decoupled Power Flow (FDPF, XB formulation) for rapid convergence.
 *   3. Generator reactive power (Q-limit) clamping and PV-to-PQ bus switching.
 *   4. Branch complex power flow calculation (Pij, Qij, Pji, Qji) and thermal loading.
 */

import { extractPowerFlowNetlist } from "../netlist/powerflow-netlist.js";
import type { PsseCase } from "../types.js";

export interface PowerFlowOptions {
  /** Numerical algorithm to execute (default: "newton_raphson"). */
  algorithm?: "newton_raphson" | "fast_decoupled";
  /** Maximum allowable non-linear iterations (default: 25). */
  maxIterations?: number;
  /** Convergence tolerance for max active/reactive mismatch in p.u. (default: 1e-4). */
  tolerance?: number;
  /** Enforce generator reactive power limits (default: true). */
  enforceQLimits?: boolean;
}

export interface BusPowerFlowResult {
  busNumber: number;
  name: string;
  baseKv: number;
  type: "PQ" | "PV" | "Slack";
  vm: number; // Voltage magnitude in p.u.
  va: number; // Voltage phase angle in degrees
  pgMw: number;
  qgMvar: number;
  plMw: number;
  qlMvar: number;
}

export interface BranchPowerFlowResult {
  fromBus: number;
  toBus: number;
  ckt: string;
  pFromMw: number;
  qFromMvar: number;
  pToMw: number;
  qToMvar: number;
  lossMw: number;
  lossMvar: number;
  mvaFlow: number;
  rateMva?: number | undefined;
  loadingPercent?: number | undefined;
}

export interface PowerFlowSolution {
  converged: boolean;
  iterations: number;
  maxMismatchPu: number;
  algorithm: string;
  totalGenMw: number;
  totalGenMvar: number;
  totalLoadMw: number;
  totalLoadMvar: number;
  totalLossMw: number;
  totalLossMvar: number;
  buses: BusPowerFlowResult[];
  branches: BranchPowerFlowResult[];
}

/**
 * Solves dense linear system A * x = b in-place using Gaussian elimination with partial pivoting.
 */
function solveLinearSystem(A: Float64Array, b: Float64Array, n: number): boolean {
  for (let i = 0; i < n; i++) {
    // Pivot selection
    let maxRow = i;
    let maxVal = Math.abs(A[i * n + i] ?? 0);
    for (let k = i + 1; k < n; k++) {
      const val = Math.abs(A[k * n + i] ?? 0);
      if (val > maxVal) {
        maxVal = val;
        maxRow = k;
      }
    }

    if (maxVal < 1e-12) return false; // Singular matrix

    // Swap rows
    if (maxRow !== i) {
      for (let c = i; c < n; c++) {
        const tmpA = A[i * n + c] ?? 0;
        A[i * n + c] = A[maxRow * n + c] ?? 0;
        A[maxRow * n + c] = tmpA;
      }
      const tmpB = b[i] ?? 0;
      b[i] = b[maxRow] ?? 0;
      b[maxRow] = tmpB;
    }

    // Elimination
    const pivot = A[i * n + i]!;
    for (let k = i + 1; k < n; k++) {
      const factor = (A[k * n + i] ?? 0) / pivot;
      for (let c = i; c < n; c++) {
        const curA = A[k * n + c] ?? 0;
        const subA = A[i * n + c] ?? 0;
        A[k * n + c] = curA - factor * subA;
      }
      const curB = b[k] ?? 0;
      const subB = b[i] ?? 0;
      b[k] = curB - factor * subB;
    }
  }

  // Back-substitution
  for (let i = n - 1; i >= 0; i--) {
    let sum = b[i] ?? 0;
    for (let c = i + 1; c < n; c++) {
      sum -= (A[i * n + c] ?? 0) * (b[c] ?? 0);
    }
    b[i] = sum / A[i * n + i]!;
  }

  return true;
}

/**
 * Solves the non-linear AC Power Flow equations for a PSS/E base case.
 */
export function solvePowerFlow(psseCase: PsseCase, options: PowerFlowOptions = {}): PowerFlowSolution {
  const netlist = extractPowerFlowNetlist(psseCase);
  const maxIter = options.maxIterations ?? 25;
  const tol = options.tolerance ?? 1e-4;
  const sbase = psseCase.header.sbase > 0 ? psseCase.header.sbase : 100.0;
  const N = netlist.nBuses;

  // Map bus index <-> bus number
  const busIndices = netlist.busIndices;

  // Identify bus types and scheduled values
  // 1: PQ, 2: PV, 3: Slack
  const busTypes = new Int8Array(N);
  const Vm = new Float64Array(N);
  const Va = new Float64Array(N);
  const Pgen = new Float64Array(N);
  const Qgen = new Float64Array(N);
  const Pload0 = new Float64Array(N);
  const Qload0 = new Float64Array(N);
  const IloadP = new Float64Array(N);
  const IloadQ = new Float64Array(N);
  const YloadP = new Float64Array(N);
  const YloadQ = new Float64Array(N);
  const Qmin = new Float64Array(N);
  const Qmax = new Float64Array(N);
  const hasGenAtBus = new Uint8Array(N);

  for (let i = 0; i < N; i++) {
    const bNum = netlist.busNumbers[i]!;
    const bRecord = psseCase.buses.get(bNum);
    const ide = bRecord ? bRecord.ide : 1;
    busTypes[i] = ide;

    // Flat start or existing state
    Vm[i] = bRecord && bRecord.vm > 0 ? bRecord.vm : 1.0;
    Va[i] = bRecord ? (bRecord.va * Math.PI) / 180.0 : 0.0;
    Qmin[i] = 0.0;
    Qmax[i] = 0.0;
  }

  // Accumulate ZIP loads into Pload0, Qload0, IloadP, IloadQ, YloadP, YloadQ
  for (const load of psseCase.loads) {
    if (load.status === 0) continue;
    const idx = busIndices.get(load.i);
    if (idx !== undefined && idx < N) {
      Pload0[idx] = (Pload0[idx] ?? 0) + load.pl / sbase;
      Qload0[idx] = (Qload0[idx] ?? 0) + load.ql / sbase;
      IloadP[idx] = (IloadP[idx] ?? 0) + (load.ip ?? 0) / sbase;
      IloadQ[idx] = (IloadQ[idx] ?? 0) + (load.iq ?? 0) / sbase;
      YloadP[idx] = (YloadP[idx] ?? 0) + (load.yp ?? 0) / sbase;
      YloadQ[idx] = (YloadQ[idx] ?? 0) + (load.yq ?? 0) / sbase;
    }
  }

  // Accumulate generators into Pgen, Qgen, and summed Q-limits
  for (const gen of psseCase.generators) {
    if (gen.stat === 0) continue;
    const idx = busIndices.get(gen.i);
    if (idx !== undefined && idx < N) {
      Pgen[idx] = (Pgen[idx] ?? 0) + gen.pg / sbase;
      Qgen[idx] = (Qgen[idx] ?? 0) + gen.qg / sbase;
      if (gen.vs > 0 && busTypes[idx] !== 3) {
        Vm[idx] = gen.vs; // Voltage setpoint for PV buses
      }
      Qmin[idx] = (Qmin[idx] ?? 0) + gen.qb / sbase;
      Qmax[idx] = (Qmax[idx] ?? 0) + gen.qt / sbase;
      hasGenAtBus[idx] = 1;
    }
  }

  for (let i = 0; i < N; i++) {
    if (!hasGenAtBus[i]) {
      Qmin[i] = -9999.0;
      Qmax[i] = 9999.0;
    }
  }

  // Admittance matrix entries lookup helper
  const getG = (i: number, k: number): number => netlist.ybus.g.get(i)?.get(k) ?? 0;
  const getB = (i: number, k: number): number => netlist.ybus.b.get(i)?.get(k) ?? 0;

  // Evaluate ZIP load at bus i for current Vm[i]
  const evalPload = (i: number): number => {
    const v = Vm[i]!;
    return Pload0[i]! + IloadP[i]! * v + YloadP[i]! * v * v;
  };
  const evalQload = (i: number): number => {
    const v = Vm[i]!;
    return Qload0[i]! + IloadQ[i]! * v - YloadQ[i]! * v * v;
  };

  const enforceQ = options.enforceQLimits ?? false;
  const useFastDecoupled = options.algorithm === "fast_decoupled";

  // Active indices:
  // Non-slack buses participate in delta P / delta theta
  // PQ buses participate in delta Q / delta V
  let converged = false;
  let iter = 0;
  let maxMismatch = 0;

  for (; iter < maxIter; iter++) {
    // 1. Calculate Pcalc and Qcalc
    const Pcalc = new Float64Array(N);
    const Qcalc = new Float64Array(N);

    for (let i = 0; i < N; i++) {
      const vi = Vm[i]!;
      const thetaI = Va[i]!;
      let pSum = 0;
      let qSum = 0;

      for (let k = 0; k < N; k++) {
        const vk = Vm[k]!;
        const deltaTheta = thetaI - Va[k]!;
        const g = getG(i, k);
        const b = getB(i, k);
        const cosD = Math.cos(deltaTheta);
        const sinD = Math.sin(deltaTheta);

        pSum += vk * (g * cosD + b * sinD);
        qSum += vk * (g * sinD - b * cosD);
      }
      Pcalc[i] = vi * pSum;
      Qcalc[i] = vi * qSum;
    }

    // Optional PV-to-PQ Q-limit switching
    if (enforceQ && iter >= 1) {
      for (let i = 0; i < N; i++) {
        if (busTypes[i] === 2 && hasGenAtBus[i] && Qmin[i]! < Qmax[i]!) {
          const qReq = Qcalc[i]! + evalQload(i);
          if (qReq > Qmax[i]! + 1e-5) {
            Qgen[i] = Qmax[i]!;
            busTypes[i] = 1; // Switch PV -> PQ at upper limit
          } else if (qReq < Qmin[i]! - 1e-5) {
            Qgen[i] = Qmin[i]!;
            busTypes[i] = 1; // Switch PV -> PQ at lower limit
          }
        }
      }
    }

    const nonSlackIndices: number[] = [];
    const pqIndices: number[] = [];

    for (let i = 0; i < N; i++) {
      if (busTypes[i] !== 3) {
        nonSlackIndices.push(i);
      }
      if (busTypes[i] === 1) {
        pqIndices.push(i);
      }
    }

    const nP = nonSlackIndices.length;
    const nQ = pqIndices.length;
    const nVars = nP + nQ;

    // 2. Form Mismatch Vector [ΔP; ΔQ]
    const mismatch = new Float64Array(nVars);
    maxMismatch = 0;

    for (let m = 0; m < nP; m++) {
      const i = nonSlackIndices[m]!;
      const pSpec = Pgen[i]! - evalPload(i);
      const dP = pSpec - Pcalc[i]!;
      mismatch[m] = dP;
      if (Math.abs(dP) > maxMismatch) maxMismatch = Math.abs(dP);
    }

    for (let m = 0; m < nQ; m++) {
      const i = pqIndices[m]!;
      const qSpec = Qgen[i]! - evalQload(i);
      const dQ = qSpec - Qcalc[i]!;
      mismatch[nP + m] = dQ;
      if (Math.abs(dQ) > maxMismatch) maxMismatch = Math.abs(dQ);
    }

    // Check convergence
    if (maxMismatch < tol) {
      converged = true;
      break;
    }

    if (useFastDecoupled && iter >= 1) {
      // Fast Decoupled Power Flow (Stott-Alsac alternating P-theta and Q-V half-steps)
      for (let sub = 0; sub < 2; sub++) {
        // Recompute Pcalc for P-theta step on second sub-sweep
        if (sub > 0) {
          for (let i = 0; i < N; i++) {
            const vi = Vm[i]!;
            const thetaI = Va[i]!;
            let pSum = 0;
            let qSum = 0;
            for (let k = 0; k < N; k++) {
              const vk = Vm[k]!;
              const deltaTheta = thetaI - Va[k]!;
              const g = getG(i, k);
              const b = getB(i, k);
              pSum += vk * (g * Math.cos(deltaTheta) + b * Math.sin(deltaTheta));
              qSum += vk * (g * Math.sin(deltaTheta) - b * Math.cos(deltaTheta));
            }
            Pcalc[i] = vi * pSum;
            Qcalc[i] = vi * qSum;
          }
        }

        const Bp = new Float64Array(nP * nP);
        const dTheta = new Float64Array(nP);
        for (let r = 0; r < nP; r++) {
          const i = nonSlackIndices[r]!;
          const vi = Vm[i]!;
          dTheta[r] = (Pgen[i]! - evalPload(i) - Pcalc[i]!) / vi;
          for (let c = 0; c < nP; c++) {
            const k = nonSlackIndices[c]!;
            if (i !== k) {
              const deltaTheta = Va[i]! - Va[k]!;
              const g = getG(i, k);
              const b = getB(i, k);
              Bp[r * nP + c] = Vm[k]! * (g * Math.sin(deltaTheta) - b * Math.cos(deltaTheta));
            } else {
              Bp[r * nP + c] = -Qcalc[i]! / vi - getB(i, i) * vi;
            }
          }
        }
        if (!solveLinearSystem(Bp, dTheta, nP)) break;
        for (let m = 0; m < nP; m++) {
          const idx = nonSlackIndices[m]!;
          const dTh = Math.max(-0.5, Math.min(0.5, dTheta[m] ?? 0));
          Va[idx] = (Va[idx] ?? 0) + dTh;
        }

        // Recompute Qcalc using updated angles Va before Q-V half-step
        for (let i = 0; i < N; i++) {
          const vi = Vm[i]!;
          const thetaI = Va[i]!;
          let qSum = 0;
          for (let k = 0; k < N; k++) {
            const vk = Vm[k]!;
            const deltaTheta = thetaI - Va[k]!;
            const g = getG(i, k);
            const b = getB(i, k);
            qSum += vk * (g * Math.sin(deltaTheta) - b * Math.cos(deltaTheta));
          }
          Qcalc[i] = vi * qSum;
        }

        if (nQ > 0) {
          const Bpp = new Float64Array(nQ * nQ);
          const dV = new Float64Array(nQ);
          for (let r = 0; r < nQ; r++) {
            const i = pqIndices[r]!;
            const vi = Vm[i]!;
            dV[r] = (Qgen[i]! - evalQload(i) - Qcalc[i]!) / vi;
            for (let c = 0; c < nQ; c++) {
              const k = pqIndices[c]!;
              if (i !== k) {
                const deltaTheta = Va[i]! - Va[k]!;
                const g = getG(i, k);
                const b = getB(i, k);
                Bpp[r * nQ + c] = g * Math.sin(deltaTheta) - b * Math.cos(deltaTheta);
              } else {
                Bpp[r * nQ + c] = Qcalc[i]! / (vi * vi) - getB(i, i);
              }
            }
          }
          if (!solveLinearSystem(Bpp, dV, nQ)) break;
          for (let m = 0; m < nQ; m++) {
            const idx = pqIndices[m]!;
            const stepV = Math.max(-0.2, Math.min(0.2, dV[m] ?? 0));
            Vm[idx] = Math.max(0.5, Math.min(1.5, (Vm[idx] ?? 0) + stepV));
          }
        }
      }
      continue;
    }

    // 3. Assemble Full Newton-Raphson Jacobian Matrix J
    const J = new Float64Array(nVars * nVars);

    // H = ∂P / ∂θ (nP x nP)
    for (let r = 0; r < nP; r++) {
      const i = nonSlackIndices[r]!;
      const vi = Vm[i]!;
      for (let c = 0; c < nP; c++) {
        const k = nonSlackIndices[c]!;
        if (i !== k) {
          const deltaTheta = Va[i]! - Va[k]!;
          const g = getG(i, k);
          const b = getB(i, k);
          const dPdTheta = vi * Vm[k]! * (g * Math.sin(deltaTheta) - b * Math.cos(deltaTheta));
          J[r * nVars + c] = dPdTheta;
        } else {
          // Diagonal H_ii = -Q_i - B_ii * V_i^2
          J[r * nVars + c] = -Qcalc[i]! - getB(i, i) * vi * vi;
        }
      }
    }

    // N = ∂P / ∂V (nP x nQ)
    for (let r = 0; r < nP; r++) {
      const i = nonSlackIndices[r]!;
      const vi = Vm[i]!;
      for (let c = 0; c < nQ; c++) {
        const k = pqIndices[c]!;
        const colIdx = nP + c;
        if (i !== k) {
          const deltaTheta = Va[i]! - Va[k]!;
          const g = getG(i, k);
          const b = getB(i, k);
          const dPdV = vi * (g * Math.cos(deltaTheta) + b * Math.sin(deltaTheta));
          J[r * nVars + colIdx] = dPdV;
        } else {
          // Diagonal N_ii = P_i / V_i + G_ii * V_i + ∂Pload/∂V
          const dPloaddV = IloadP[i]! + 2 * YloadP[i]! * vi;
          J[r * nVars + colIdx] = Pcalc[i]! / vi + getG(i, i) * vi + dPloaddV;
        }
      }
    }

    // M = ∂Q / ∂θ (nQ x nP)
    for (let r = 0; r < nQ; r++) {
      const i = pqIndices[r]!;
      const rowIdx = nP + r;
      const vi = Vm[i]!;
      for (let c = 0; c < nP; c++) {
        const k = nonSlackIndices[c]!;
        if (i !== k) {
          const deltaTheta = Va[i]! - Va[k]!;
          const g = getG(i, k);
          const b = getB(i, k);
          const dQdTheta = -vi * Vm[k]! * (g * Math.cos(deltaTheta) + b * Math.sin(deltaTheta));
          J[rowIdx * nVars + c] = dQdTheta;
        } else {
          // Diagonal M_ii = P_i - G_ii * V_i^2
          J[rowIdx * nVars + c] = Pcalc[i]! - getG(i, i) * vi * vi;
        }
      }
    }

    // L = ∂Q / ∂V (nQ x nQ)
    for (let r = 0; r < nQ; r++) {
      const i = pqIndices[r]!;
      const rowIdx = nP + r;
      const vi = Vm[i]!;
      for (let c = 0; c < nQ; c++) {
        const k = pqIndices[c]!;
        const colIdx = nP + c;
        if (i !== k) {
          const deltaTheta = Va[i]! - Va[k]!;
          const g = getG(i, k);
          const b = getB(i, k);
          const dQdV = vi * (g * Math.sin(deltaTheta) - b * Math.cos(deltaTheta));
          J[rowIdx * nVars + colIdx] = dQdV;
        } else {
          // Diagonal L_ii = Q_i / V_i - B_ii * V_i + ∂Qload/∂V
          const dQloaddV = IloadQ[i]! - 2 * YloadQ[i]! * vi;
          J[rowIdx * nVars + colIdx] = Qcalc[i]! / vi - getB(i, i) * vi + dQloaddV;
        }
      }
    }

    // 4. Solve Linear System J * [Δθ; ΔV] = [ΔP; ΔQ]
    const delta = new Float64Array(mismatch);
    const solved = solveLinearSystem(J, delta, nVars);
    if (!solved) break;

    // 5. Update State with adaptive damping
    for (let m = 0; m < nP; m++) {
      const idx = nonSlackIndices[m]!;
      let dTh = delta[m] ?? 0;
      if (dTh > 0.5) dTh = 0.5;
      else if (dTh < -0.5) dTh = -0.5;
      Va[idx] = (Va[idx] ?? 0) + dTh;
    }
    for (let m = 0; m < nQ; m++) {
      const idx = pqIndices[m]!;
      let dV = delta[nP + m] ?? 0;
      if (dV > 0.2) dV = 0.2;
      else if (dV < -0.2) dV = -0.2;
      const newV = (Vm[idx] ?? 0) + dV;
      Vm[idx] = Math.max(0.5, Math.min(1.5, newV));
    }
  }

  // Assemble bus results
  const busResults: BusPowerFlowResult[] = [];
  let totalGenMw = 0;
  let totalGenMvar = 0;
  let totalLoadMw = 0;
  let totalLoadMvar = 0;

  for (let i = 0; i < N; i++) {
    const bNum = netlist.busNumbers[i]!;
    const bRecord = psseCase.buses.get(bNum);
    const name = bRecord ? bRecord.name.trim() : `BUS ${bNum}`;
    const baseKv = bRecord && bRecord.baseKv > 0 ? bRecord.baseKv : 138.0;

    const pl = evalPload(i) * sbase;
    const ql = evalQload(i) * sbase;

    let pg = Pgen[i]! * sbase;
    let qg = Qgen[i]! * sbase;

    // Calculate actual nodal power injection for Slack and PV buses
    if (busTypes[i] === 3 || busTypes[i] === 2) {
      let pCalc = 0;
      let qCalc = 0;
      const vi = Vm[i]!;
      for (let k = 0; k < N; k++) {
        const deltaTheta = Va[i]! - Va[k]!;
        const g = getG(i, k);
        const b = getB(i, k);
        pCalc += vi * Vm[k]! * (g * Math.cos(deltaTheta) + b * Math.sin(deltaTheta));
        qCalc += vi * Vm[k]! * (g * Math.sin(deltaTheta) - b * Math.cos(deltaTheta));
      }
      if (busTypes[i] === 3) {
        pg = pCalc * sbase + pl;
      }
      qg = qCalc * sbase + ql;
    }

    totalGenMw += pg;
    totalGenMvar += qg;
    totalLoadMw += pl;
    totalLoadMvar += ql;

    busResults.push({
      busNumber: bNum,
      name,
      baseKv,
      type: busTypes[i] === 3 ? "Slack" : busTypes[i] === 2 ? "PV" : "PQ",
      vm: Vm[i]!,
      va: (Va[i]! * 180.0) / Math.PI,
      pgMw: pg,
      qgMvar: qg,
      plMw: pl,
      qlMvar: ql,
    });
  }

  // Assemble branch power flow results (AC transmission branches + transformers)
  const branchResults: BranchPowerFlowResult[] = [];
  let totalLossMw = 0;
  let totalLossMvar = 0;

  for (const br of psseCase.branches) {
    if (br.st === 0) continue;
    const fIdx = busIndices.get(br.i);
    const tIdx = busIndices.get(br.j);
    if (fIdx === undefined || tIdx === undefined) continue;

    const vi = Vm[fIdx]!;
    const vj = Vm[tIdx]!;
    const thetaI = Va[fIdx]!;
    const thetaJ = Va[tIdx]!;
    const deltaTheta = thetaI - thetaJ;

    const zMagSq = br.r * br.r + br.x * br.x;
    if (zMagSq <= 0) continue;
    const g = br.r / zMagSq;
    const b = -br.x / zMagSq;
    const bShuntHalf = br.b / 2;

    // Power flow from i -> j
    const pFrom = vi * vi * (g + br.gi) - vi * vj * (g * Math.cos(deltaTheta) + b * Math.sin(deltaTheta));
    const qFrom = -vi * vi * (b + bShuntHalf + br.bi) - vi * vj * (g * Math.sin(deltaTheta) - b * Math.cos(deltaTheta));

    // Power flow from j -> i
    const pTo = vj * vj * (g + br.gj) - vi * vj * (g * Math.cos(-deltaTheta) + b * Math.sin(-deltaTheta));
    const qTo = -vj * vj * (b + bShuntHalf + br.bj) - vi * vj * (g * Math.sin(-deltaTheta) - b * Math.cos(-deltaTheta));

    const pFromMw = pFrom * sbase;
    const qFromMvar = qFrom * sbase;
    const pToMw = pTo * sbase;
    const qToMvar = qTo * sbase;

    const lossMw = pFromMw + pToMw;
    const lossMvar = qFromMvar + qToMvar;
    totalLossMw += lossMw;
    totalLossMvar += lossMvar;

    const mvaFlow = Math.sqrt(pFromMw * pFromMw + qFromMvar * qFromMvar);
    const loadingPercent = br.rateA && br.rateA > 0 ? (mvaFlow / br.rateA) * 100.0 : undefined;

    branchResults.push({
      fromBus: br.i,
      toBus: br.j,
      ckt: br.ckt.trim() || "1",
      pFromMw,
      qFromMvar,
      pToMw,
      qToMvar,
      lossMw,
      lossMvar,
      mvaFlow,
      rateMva: br.rateA && br.rateA > 0 ? br.rateA : undefined,
      loadingPercent,
    });
  }

  // Include Two-Winding Transformers in branchResults and loss totals
  for (const xf of psseCase.transformers) {
    if (xf.stat === 0) continue;
    const fIdx = busIndices.get(xf.i);
    const tIdx = busIndices.get(xf.j);
    if (fIdx === undefined || tIdx === undefined) continue;

    const vi = Vm[fIdx]!;
    const vj = Vm[tIdx]!;
    const thetaI = Va[fIdx]!;
    const thetaJ = Va[tIdx]!;

    const r = xf.r12;
    const x = xf.x12 !== 0 ? xf.x12 : 1e-5;
    const zMagSq = r * r + x * x;
    const g = r / zMagSq;
    const b = -x / zMagSq;

    const a = xf.windv1 > 0 ? xf.windv1 : 1.0;
    const alpha = ((xf.ang1 || 0) * Math.PI) / 180.0;
    const delta = thetaI - thetaJ - alpha;

    const pFrom = (vi * vi * g) / (a * a) - ((vi * vj) / a) * (g * Math.cos(delta) + b * Math.sin(delta));
    const qFrom = (-vi * vi * b) / (a * a) - ((vi * vj) / a) * (g * Math.sin(delta) - b * Math.cos(delta));

    const pTo = vj * vj * g - ((vi * vj) / a) * (g * Math.cos(-delta) + b * Math.sin(-delta));
    const qTo = -vj * vj * b - ((vi * vj) / a) * (g * Math.sin(-delta) - b * Math.cos(-delta));

    const pFromMw = pFrom * sbase;
    const qFromMvar = qFrom * sbase;
    const pToMw = pTo * sbase;
    const qToMvar = qTo * sbase;

    const lossMw = pFromMw + pToMw;
    const lossMvar = qFromMvar + qToMvar;
    totalLossMw += lossMw;
    totalLossMvar += lossMvar;

    const mvaFlow = Math.sqrt(pFromMw * pFromMw + qFromMvar * qFromMvar);
    const loadingPercent = xf.rata1 && xf.rata1 > 0 ? (mvaFlow / xf.rata1) * 100.0 : undefined;

    branchResults.push({
      fromBus: xf.i,
      toBus: xf.j,
      ckt: xf.ckt.trim() || "T1",
      pFromMw,
      qFromMvar,
      pToMw,
      qToMvar,
      lossMw,
      lossMvar,
      mvaFlow,
      rateMva: xf.rata1 && xf.rata1 > 0 ? xf.rata1 : undefined,
      loadingPercent,
    });
  }

  return {
    converged,
    iterations: iter,
    maxMismatchPu: maxMismatch,
    algorithm: options.algorithm ?? "newton_raphson",
    totalGenMw,
    totalGenMvar,
    totalLoadMw,
    totalLoadMvar,
    totalLossMw,
    totalLossMvar,
    buses: busResults,
    branches: branchResults,
  };
}

export interface PsseTransientOptions {
  /** Total simulation duration in seconds (default: 5.0). */
  stopTime?: number | undefined;
  /** Integration time step in seconds (default: 0.01). */
  timeStep?: number | undefined;
  /** Bus number where temporary three-phase fault is applied (default: highest-load PQ bus). */
  faultBus?: number | undefined;
  /** Fault inception time in seconds (default: 0.25). */
  faultStartSec?: number | undefined;
  /** Fault clearing time in seconds (default: 0.40). */
  faultClearSec?: number | undefined;
  /** Fault shunt susceptance in p.u. during fault (default: 5.0). */
  faultSusceptancePu?: number | undefined;
  /** Optional parsed PSS/E `.dyr` dynamic model collection. */
  dyr?: import("../types.js").PsseDyrCase | undefined;
}

export interface PsseTransientResult {
  t: number[];
  states: string[];
  y: number[][];
  variables: Record<string, number[]>;
  summary: {
    convergedPowerFlow: boolean;
    stable: boolean;
    faultBus: number;
    faultStartSec: number;
    faultClearSec: number;
    maxRotorAngleSpreadDeg: number;
    maxFreqDeviationHz: number;
    minBusVoltagePu: number;
  };
}

/**
 * Multi-Machine Electro-Mechanical Transient Stability Simulator for PSS/E Cases.
 *
 * Initializes synchronous machine internal EMFs E'∠δ_0 behind transient reactance x'_d
 * from the solved AC Power Flow state, then integrates the coupled classical multi-machine
 * swing equations and reduced network nodal equations using 4th-order Runge-Kutta (RK4)
 * across pre-fault, fault-on, and post-fault ringdown stages.
 */
export function simulatePsseTransient(psseCase: PsseCase, options: PsseTransientOptions = {}): PsseTransientResult {
  const pf = solvePowerFlow(psseCase);
  const netlist = extractPowerFlowNetlist(psseCase);
  const N = netlist.nBuses;
  const sbase = psseCase.header.sbase > 0 ? psseCase.header.sbase : 100.0;
  const f0 = psseCase.header.basfrq > 0 ? psseCase.header.basfrq : 60.0;
  const omega0 = 2 * Math.PI * f0;

  const stopTime = options.stopTime ?? 5.0;
  const dt = options.timeStep ?? 0.01;
  const faultStart = options.faultStartSec ?? 0.25;
  const faultClear = options.faultClearSec ?? 0.4;
  const faultB = options.faultSusceptancePu ?? 4.0;

  // Map solved bus voltages
  const Vm0 = new Float64Array(N);
  const Va0 = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const bRes = pf.buses[i];
    Vm0[i] = bRes ? bRes.vm : 1.0;
    Va0[i] = bRes ? (bRes.va * Math.PI) / 180.0 : 0.0;
  }

  // Pick fault bus: user-specified, or highest-load PQ bus, or last bus
  let faultBusNum = options.faultBus;
  if (faultBusNum === undefined || !netlist.busIndices.has(faultBusNum)) {
    let bestLoad = -1;
    for (const bRes of pf.buses) {
      if (bRes.type === "PQ" && bRes.plMw > bestLoad) {
        bestLoad = bRes.plMw;
        faultBusNum = bRes.busNumber;
      }
    }
    if (faultBusNum === undefined) {
      faultBusNum = netlist.busNumbers[Math.min(N - 1, 1)] ?? 1;
    }
  }
  const faultBusIdx = netlist.busIndices.get(faultBusNum) ?? 0;

  // Initialize synchronous machines from online generators
  interface MachineModel {
    label: string;
    busNum: number;
    busIdx: number;
    xd: number;
    xdPrime: number;
    td0Prime: number;
    ra: number;
    H: number;
    D: number;
    govDroopInv: number;
    tGov: number;
    pMaxPu: number;
    hasExciter: boolean;
    ka: number;
    ta: number;
    vRef: number;
    efd0: number;
    efdMin: number;
    efdMax: number;
    ksPss: number;
    EprimeMag: number;
    delta0: number;
    Pm0: number;
    ygReal: number;
    ygImag: number;
  }

  const machines: MachineModel[] = [];
  const onlineGens = psseCase.generators.filter((g) => g.stat !== 0);
  const dyrCase = options.dyr ?? psseCase.dyr;

  // Count generators per bus to split solved bus Pg/Qg proportionally
  const genCountAtBus = new Map<number, number>();
  for (const g of onlineGens) {
    genCountAtBus.set(g.i, (genCountAtBus.get(g.i) ?? 0) + 1);
  }

  for (const g of onlineGens) {
    const busIdx = netlist.busIndices.get(g.i);
    if (busIdx === undefined) continue;
    const bRes = pf.buses[busIdx];
    const count = genCountAtBus.get(g.i) ?? 1;
    const pgPu = (bRes ? bRes.pgMw : g.pg) / count / sbase;
    const qgPu = (bRes ? bRes.qgMvar : g.qg) / count / sbase;

    const vMag = Vm0[busIdx]!;
    const vAng = Va0[busIdx]!;
    const vr = vMag * Math.cos(vAng);
    const vi = vMag * Math.sin(vAng);

    // Terminal current I_g = (P_g - j Q_g) / V^*
    const vSq = Math.max(1e-6, vMag * vMag);
    const ir = (pgPu * vr + qgPu * vi) / vSq;
    const ii = (pgPu * vi - qgPu * vr) / vSq;

    const cleanId = g.id.trim() || "1";
    const dyrKey = `${g.i}_${cleanId}`;
    const dyrGen = dyrCase?.generatorsByBusId.get(dyrKey) ?? dyrCase?.generatorsByBusId.get(String(g.i));
    const dyrExc = dyrCase?.excitersByBusId.get(dyrKey) ?? dyrCase?.excitersByBusId.get(String(g.i));
    const dyrGov = dyrCase?.governorsByBusId.get(dyrKey) ?? dyrCase?.governorsByBusId.get(String(g.i));
    const dyrPss = dyrCase?.stabilizersByBusId.get(dyrKey) ?? dyrCase?.stabilizersByBusId.get(String(g.i));

    // Machine transient & synchronous reactance on system MVA base (prefer .dyr X'd & Xd if provided)
    const mbaseRatio = g.mbase > 0 ? sbase / g.mbase : 1.0;
    const dyrXdp = dyrGen?.namedParams["Xdp"];
    const rawXdp = dyrXdp !== undefined && dyrXdp > 0 ? dyrXdp : g.zx > 0 && g.zx < 1.0 ? g.zx : 0.22;
    const xdPrime = rawXdp * mbaseRatio;
    const dyrXd = dyrGen?.namedParams["Xd"];
    const xd = (dyrXd !== undefined && dyrXd > rawXdp ? dyrXd : rawXdp * 2.4) * mbaseRatio;
    const td0Prime = Math.max(0.5, dyrGen?.namedParams["Td0p"] ?? 6.0);
    const ra = Math.max(0.0, g.zr * mbaseRatio);

    // Internal EMF E' = V + (ra + j xd') I_g
    const er = vr + ra * ir - xdPrime * ii;
    const ei = vi + ra * ii + xdPrime * ir;
    const EprimeMag = Math.sqrt(er * er + ei * ei);
    const delta0 = Math.atan2(ei, er);

    // d-axis current component Id = I_r * sin(delta0) - I_i * cos(delta0)
    const id0 = ir * Math.sin(delta0) - ii * Math.cos(delta0);
    const efd0 = EprimeMag + (xd - xdPrime) * id0;

    // Norton admittance y_g = 1 / (ra + j xd')
    const zSq = ra * ra + xdPrime * xdPrime;
    const ygReal = ra / zSq;
    const ygImag = -xdPrime / zSq;

    // Steady-state electrical power Pe0 = Re(E' * I_g^*) = Pm0
    const Pm0 = er * ir + ei * ii;

    // Inertia constant H and damping D scaled by machine rating (prefer .dyr H and D when available)
    const ratingScale = g.mbase > 0 ? g.mbase / sbase : 1.0;
    const dyrH = dyrGen?.namedParams["H"];
    const dyrD = dyrGen?.namedParams["D"];
    const H = (dyrH !== undefined && dyrH > 0 ? dyrH : 3.5) * ratingScale;
    const D = (dyrD !== undefined && dyrD > 0 ? dyrD : 2.0) * ratingScale;

    // Turbine-governor speed droop response (1/R) and servo time constant
    const dyrR = dyrGov?.namedParams["R"];
    const govDroopInv = dyrR !== undefined && dyrR > 0.005 ? (0.25 / dyrR) * ratingScale : 0.0;
    const tGov = Math.max(0.08, dyrGov?.namedParams["T1"] ?? dyrGov?.namedParams["Tg"] ?? 0.3);
    const pMaxPu = Math.max(
      Pm0 * 1.25,
      ((dyrGov?.namedParams["VMAX"] ?? dyrGov?.namedParams["GMAX"] ?? 1.2) * (g.mbase > 0 ? g.mbase : sbase)) / sbase,
    );

    // Automatic Voltage Regulator (EXST1 / IEEET1 / SEXS)
    const hasExciter = Boolean(dyrExc || dyrGen);
    const rawKa = dyrExc?.namedParams["KA"] ?? dyrExc?.namedParams["K"] ?? 40.0;
    const ka = Math.min(80.0, Math.max(5.0, rawKa * 0.25));
    const ta = Math.max(0.03, dyrExc?.namedParams["TA"] ?? dyrExc?.namedParams["TE"] ?? 0.06);
    const efdMax = Math.max(efd0 + 0.5, dyrExc?.namedParams["VRMAX"] ?? dyrExc?.namedParams["EMAX"] ?? 5.0);
    const efdMin = Math.min(0.0, dyrExc?.namedParams["VRMIN"] ?? dyrExc?.namedParams["EMIN"] ?? -2.0);
    const vRef = vMag + efd0 / ka;
    const ksPss = dyrPss?.namedParams["KS"] ?? 0.0;

    const label = cleanId === "1" && count === 1 ? `Bus${g.i}` : `Bus${g.i}_${cleanId}`;

    machines.push({
      label,
      busNum: g.i,
      busIdx,
      xd,
      xdPrime,
      td0Prime,
      ra,
      H: Math.max(1.5, H),
      D: Math.max(0.8, D),
      govDroopInv,
      tGov,
      pMaxPu,
      hasExciter,
      ka,
      ta,
      vRef,
      efd0,
      efdMin,
      efdMax,
      ksPss,
      EprimeMag,
      delta0,
      Pm0,
      ygReal,
      ygImag,
    });
  }

  const M = machines.length;

  // Build augmented nodal admittance matrix (real 2N x 2N system) including constant-impedance loads + machine Norton admittances
  const baseG = new Float64Array(N * N);
  const baseB = new Float64Array(N * N);
  for (let i = 0; i < N; i++) {
    for (let k = 0; k < N; k++) {
      baseG[i * N + k] = netlist.ybus.g.get(i)?.get(k) ?? 0;
      baseB[i * N + k] = netlist.ybus.b.get(i)?.get(k) ?? 0;
    }
    // Constant-admittance equivalent load at initial voltage Vm0[i]
    const bRes = pf.buses[i];
    if (bRes) {
      const vSq = Math.max(0.25, Vm0[i]! * Vm0[i]!);
      const gLoad = bRes.plMw / sbase / vSq;
      const bLoad = -(bRes.qlMvar / sbase) / vSq;
      baseG[i * N + i] = (baseG[i * N + i] ?? 0) + gLoad;
      baseB[i * N + i] = (baseB[i * N + i] ?? 0) + bLoad;
    }
  }
  for (const m of machines) {
    const idx = m.busIdx;
    baseG[idx * N + idx] = (baseG[idx * N + idx] ?? 0) + m.ygReal;
    baseB[idx * N + idx] = (baseB[idx * N + idx] ?? 0) + m.ygImag;
  }

  // Solve network voltages V_r, V_i for given machine rotor angles delta[], transient EMFs eqPrime[], and fault state
  const solveNetworkVoltages = (
    deltas: Float64Array,
    eqPrimes: Float64Array,
    faultActive: boolean,
  ): { vr: Float64Array; vi: Float64Array; pe: Float64Array; id: Float64Array; vt: Float64Array } => {
    const dim = 2 * N;
    const A = new Float64Array(dim * dim);
    const rhs = new Float64Array(dim);

    for (let i = 0; i < N; i++) {
      for (let k = 0; k < N; k++) {
        const g = baseG[i * N + k]!;
        let b = baseB[i * N + k]!;
        if (faultActive && i === faultBusIdx && k === faultBusIdx) {
          b -= faultB;
        }
        // Real equation: G * Vr - B * Vi = Ir
        A[2 * i * dim + 2 * k] = g;
        A[2 * i * dim + (2 * k + 1)] = -b;
        // Imag equation: B * Vr + G * Vi = Ii
        A[(2 * i + 1) * dim + 2 * k] = b;
        A[(2 * i + 1) * dim + (2 * k + 1)] = g;
      }
    }

    for (let m = 0; m < M; m++) {
      const mach = machines[m]!;
      const d = deltas[m]!;
      const eqp = eqPrimes[m]!;
      const er = eqp * Math.cos(d);
      const ei = eqp * Math.sin(d);
      // Norton current I_N = (ygReal + j ygImag) * (er + j ei)
      const ir = mach.ygReal * er - mach.ygImag * ei;
      const ii = mach.ygReal * ei + mach.ygImag * er;
      rhs[2 * mach.busIdx] = (rhs[2 * mach.busIdx] ?? 0) + ir;
      rhs[2 * mach.busIdx + 1] = (rhs[2 * mach.busIdx + 1] ?? 0) + ii;
    }

    solveLinearSystem(A, rhs, dim);

    const vr = new Float64Array(N);
    const vi = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      vr[i] = rhs[2 * i] ?? Vm0[i]!;
      vi[i] = rhs[2 * i + 1] ?? 0;
    }

    const pe = new Float64Array(M);
    const id = new Float64Array(M);
    const vt = new Float64Array(M);
    for (let m = 0; m < M; m++) {
      const mach = machines[m]!;
      const d = deltas[m]!;
      const eqp = eqPrimes[m]!;
      const er = eqp * Math.cos(d);
      const ei = eqp * Math.sin(d);
      const vrm = vr[mach.busIdx]!;
      const vim = vi[mach.busIdx]!;
      vt[m] = Math.sqrt(vrm * vrm + vim * vim);
      const dvr = er - vrm;
      const dvi = ei - vim;
      // Machine armature current I_g = y_g * (E' - V)
      const igr = mach.ygReal * dvr - mach.ygImag * dvi;
      const igi = mach.ygReal * dvi + mach.ygImag * dvr;
      // Air-gap electrical power Pe = Re(E' * I_g^*)
      pe[m] = er * igr + ei * igi;
      // d-axis current Id = I_r * sin(delta) - I_i * cos(delta)
      id[m] = igr * Math.sin(d) - igi * Math.cos(d);
    }

    return { vr, vi, pe, id, vt };
  };

  // Prepare trajectory series
  const hasDyrModels = Boolean(dyrCase && dyrCase.records.length > 0);
  const stateNames: string[] = [];
  for (const m of machines) {
    stateNames.push(`delta_${m.label}_deg`);
  }
  for (const m of machines) {
    stateNames.push(`freq_${m.label}_Hz`);
  }
  for (const m of machines) {
    stateNames.push(`Pe_${m.label}_MW`);
  }
  if (hasDyrModels) {
    for (const m of machines) {
      stateNames.push(`Efd_${m.label}_pu`);
    }
    for (const m of machines) {
      stateNames.push(`Pm_${m.label}_MW`);
    }
  }
  // Include up to 10 key bus voltages so the plot remains clean on large grids
  const trackedBusIndices: number[] = [];
  for (let i = 0; i < Math.min(N, 10); i++) {
    trackedBusIndices.push(i);
    stateNames.push(`Vm_Bus${netlist.busNumbers[i]}_pu`);
  }

  const ySeries: number[][] = stateNames.map(() => []);
  const tArr: number[] = [];

  // State vectors per machine: delta[m] (rad), dOmega[m] (rad/s), eqPrime[m] (pu), efd[m] (pu), pm[m] (pu)
  const delta = new Float64Array(M);
  const dOmega = new Float64Array(M);
  const eqPrime = new Float64Array(M);
  const efd = new Float64Array(M);
  const pm = new Float64Array(M);
  for (let m = 0; m < M; m++) {
    const mach = machines[m]!;
    delta[m] = mach.delta0;
    dOmega[m] = 0.0;
    eqPrime[m] = mach.EprimeMag;
    efd[m] = mach.efd0;
    pm[m] = mach.Pm0;
  }

  const nSteps = Math.max(10, Math.round(stopTime / dt));
  let maxRotorAngleSpreadDeg = 0;
  let maxFreqDeviationHz = 0;
  let minBusVoltagePu = 2.0;

  for (let step = 0; step <= nSteps; step++) {
    const t = Number((step * dt).toFixed(4));
    const faultActive = t >= faultStart - 1e-9 && t < faultClear - 1e-9;

    const { vr, vi, pe } = solveNetworkVoltages(delta, eqPrime, faultActive);

    tArr.push(t);
    let sIdx = 0;

    let minDeltaDeg = Infinity;
    let maxDeltaDeg = -Infinity;

    for (let m = 0; m < M; m++) {
      const deg = (delta[m]! * 180.0) / Math.PI;
      if (deg < minDeltaDeg) minDeltaDeg = deg;
      if (deg > maxDeltaDeg) maxDeltaDeg = deg;
      ySeries[sIdx++]!.push(Number(deg.toFixed(4)));
    }
    if (M > 0 && maxDeltaDeg - minDeltaDeg > maxRotorAngleSpreadDeg) {
      maxRotorAngleSpreadDeg = maxDeltaDeg - minDeltaDeg;
    }

    for (let m = 0; m < M; m++) {
      const dfHz = dOmega[m]! / (2 * Math.PI);
      const freqHz = f0 + dfHz;
      if (Math.abs(dfHz) > maxFreqDeviationHz) maxFreqDeviationHz = Math.abs(dfHz);
      ySeries[sIdx++]!.push(Number(freqHz.toFixed(5)));
    }

    for (let m = 0; m < M; m++) {
      ySeries[sIdx++]!.push(Number((pe[m]! * sbase).toFixed(3)));
    }

    if (hasDyrModels) {
      for (let m = 0; m < M; m++) {
        ySeries[sIdx++]!.push(Number(efd[m]!.toFixed(4)));
      }
      for (let m = 0; m < M; m++) {
        ySeries[sIdx++]!.push(Number((pm[m]! * sbase).toFixed(3)));
      }
    }

    for (const bIdx of trackedBusIndices) {
      const vm = Math.sqrt(vr[bIdx]! * vr[bIdx]! + vi[bIdx]! * vi[bIdx]!);
      if (vm < minBusVoltagePu) minBusVoltagePu = vm;
      ySeries[sIdx++]!.push(Number(vm.toFixed(4)));
    }

    if (step === nSteps) break;

    // Advance (delta, dOmega, eqPrime, efd, pm) via RK4
    const evalDerivs = (
      curDelta: Float64Array,
      curDOmega: Float64Array,
      curEqPrime: Float64Array,
      curEfd: Float64Array,
      curPm: Float64Array,
      isFault: boolean,
    ) => {
      const { pe: curPe, id: curId, vt: curVt } = solveNetworkVoltages(curDelta, curEqPrime, isFault);
      const dDelta = new Float64Array(M);
      const ddOmega = new Float64Array(M);
      const dEqPrime = new Float64Array(M);
      const dEfd = new Float64Array(M);
      const dPm = new Float64Array(M);

      for (let m = 0; m < M; m++) {
        const mach = machines[m]!;
        dDelta[m] = curDOmega[m]!;
        const speedDevPu = curDOmega[m]! / omega0;

        // Turbine-governor first-order servo dynamics
        const pTarget = Math.min(mach.pMaxPu, Math.max(0.0, mach.Pm0 - mach.govDroopInv * speedDevPu));
        dPm[m] = (pTarget - curPm[m]!) / mach.tGov;

        // Swing equation
        const pAccel = curPm[m]! - curPe[m]! - mach.D * speedDevPu;
        ddOmega[m] = (omega0 / (2 * mach.H)) * pAccel;

        // Flux-decay transient EMF equation + AVR excitation system
        if (mach.hasExciter) {
          const vPss = mach.ksPss * speedDevPu;
          const efdTarget = Math.min(mach.efdMax, Math.max(mach.efdMin, mach.ka * (mach.vRef - curVt[m]! + vPss)));
          dEfd[m] = (efdTarget - curEfd[m]!) / mach.ta;
          dEqPrime[m] = (curEfd[m]! - curEqPrime[m]! - (mach.xd - mach.xdPrime) * curId[m]!) / mach.td0Prime;
        }
      }
      return { dDelta, ddOmega, dEqPrime, dEfd, dPm };
    };

    const k1 = evalDerivs(delta, dOmega, eqPrime, efd, pm, faultActive);

    const d2 = new Float64Array(M);
    const w2 = new Float64Array(M);
    const eq2 = new Float64Array(M);
    const ef2 = new Float64Array(M);
    const pm2 = new Float64Array(M);
    for (let m = 0; m < M; m++) {
      d2[m] = delta[m]! + 0.5 * dt * k1.dDelta[m]!;
      w2[m] = dOmega[m]! + 0.5 * dt * k1.ddOmega[m]!;
      eq2[m] = Math.max(0.2, eqPrime[m]! + 0.5 * dt * k1.dEqPrime[m]!);
      ef2[m] = efd[m]! + 0.5 * dt * k1.dEfd[m]!;
      pm2[m] = pm[m]! + 0.5 * dt * k1.dPm[m]!;
    }
    const k2 = evalDerivs(d2, w2, eq2, ef2, pm2, faultActive);

    const d3 = new Float64Array(M);
    const w3 = new Float64Array(M);
    const eq3 = new Float64Array(M);
    const ef3 = new Float64Array(M);
    const pm3 = new Float64Array(M);
    for (let m = 0; m < M; m++) {
      d3[m] = delta[m]! + 0.5 * dt * k2.dDelta[m]!;
      w3[m] = dOmega[m]! + 0.5 * dt * k2.ddOmega[m]!;
      eq3[m] = Math.max(0.2, eqPrime[m]! + 0.5 * dt * k2.dEqPrime[m]!);
      ef3[m] = efd[m]! + 0.5 * dt * k2.dEfd[m]!;
      pm3[m] = pm[m]! + 0.5 * dt * k2.dPm[m]!;
    }
    const k3 = evalDerivs(d3, w3, eq3, ef3, pm3, faultActive);

    const d4 = new Float64Array(M);
    const w4 = new Float64Array(M);
    const eq4 = new Float64Array(M);
    const ef4 = new Float64Array(M);
    const pm4 = new Float64Array(M);
    for (let m = 0; m < M; m++) {
      d4[m] = delta[m]! + dt * k3.dDelta[m]!;
      w4[m] = dOmega[m]! + dt * k3.ddOmega[m]!;
      eq4[m] = Math.max(0.2, eqPrime[m]! + dt * k3.dEqPrime[m]!);
      ef4[m] = efd[m]! + dt * k3.dEfd[m]!;
      pm4[m] = pm[m]! + dt * k3.dPm[m]!;
    }
    const k4 = evalDerivs(d4, w4, eq4, ef4, pm4, faultActive);

    for (let m = 0; m < M; m++) {
      const mach = machines[m]!;
      delta[m] = delta[m]! + (dt / 6.0) * (k1.dDelta[m]! + 2 * k2.dDelta[m]! + 2 * k3.dDelta[m]! + k4.dDelta[m]!);
      dOmega[m] = dOmega[m]! + (dt / 6.0) * (k1.ddOmega[m]! + 2 * k2.ddOmega[m]! + 2 * k3.ddOmega[m]! + k4.ddOmega[m]!);
      eqPrime[m] = Math.max(
        0.2,
        eqPrime[m]! + (dt / 6.0) * (k1.dEqPrime[m]! + 2 * k2.dEqPrime[m]! + 2 * k3.dEqPrime[m]! + k4.dEqPrime[m]!),
      );
      efd[m] = Math.min(
        mach.efdMax,
        Math.max(mach.efdMin, efd[m]! + (dt / 6.0) * (k1.dEfd[m]! + 2 * k2.dEfd[m]! + 2 * k3.dEfd[m]! + k4.dEfd[m]!)),
      );
      pm[m] = Math.min(
        mach.pMaxPu,
        Math.max(0.0, pm[m]! + (dt / 6.0) * (k1.dPm[m]! + 2 * k2.dPm[m]! + 2 * k3.dPm[m]! + k4.dPm[m]!)),
      );
    }
  }

  const variables: Record<string, number[]> = {};
  for (let i = 0; i < stateNames.length; i++) {
    variables[stateNames[i]!] = ySeries[i]!;
  }

  return {
    t: tArr,
    states: stateNames,
    y: ySeries,
    variables,
    summary: {
      convergedPowerFlow: pf.converged,
      stable: maxRotorAngleSpreadDeg < 180.0,
      faultBus: faultBusNum,
      faultStartSec: faultStart,
      faultClearSec: faultClear,
      maxRotorAngleSpreadDeg: Number(maxRotorAngleSpreadDeg.toFixed(2)),
      maxFreqDeviationHz: Number(maxFreqDeviationHz.toFixed(4)),
      minBusVoltagePu: Number((minBusVoltagePu === 2.0 ? 1.0 : minBusVoltagePu).toFixed(4)),
    },
  };
}

/**
 * Formats an AC Power Flow solution into a human-readable engineering report.
 */
export function formatPowerFlowReport(sol: PowerFlowSolution, caseTitle = "PSS/E BASE CASE"): string {
  const lines: string[] = [];
  lines.push(`================================================================================`);
  lines.push(`  PSS/E AC POWER FLOW SOLUTION REPORT — ${caseTitle}`);
  lines.push(`================================================================================`);
  lines.push(
    `  Status      : ${sol.converged ? "CONVERGED" : "DID NOT CONVERGE"} (${sol.iterations} iterations, algorithm: ${sol.algorithm})`,
  );
  lines.push(`  Max Mismatch: ${sol.maxMismatchPu.toExponential(3)} p.u.`);
  lines.push(`  Total Gen   : ${sol.totalGenMw.toFixed(2)} MW / ${sol.totalGenMvar.toFixed(2)} Mvar`);
  lines.push(`  Total Load  : ${sol.totalLoadMw.toFixed(2)} MW / ${sol.totalLoadMvar.toFixed(2)} Mvar`);
  lines.push(`  Total Losses: ${sol.totalLossMw.toFixed(2)} MW / ${sol.totalLossMvar.toFixed(2)} Mvar`);
  lines.push(`--------------------------------------------------------------------------------`);
  lines.push(`  BUS VOLTAGE & INJECTION SUMMARY`);
  lines.push(`  Bus   Name           Base kV  Type    Vm (pu)   Va (deg)    Pg (MW)   Qg (Mvar)   Pl (MW)   Ql (Mvar)`);
  lines.push(`  ----  -------------  -------  -----  --------  ---------  ---------  ----------  --------  ----------`);
  for (const b of sol.buses) {
    lines.push(
      `  ${String(b.busNumber).padStart(4)}  ${b.name.padEnd(13).slice(0, 13)}  ${b.baseKv.toFixed(1).padStart(7)}  ${b.type.padEnd(5)}  ${b.vm.toFixed(4).padStart(8)}  ${b.va.toFixed(3).padStart(9)}  ${b.pgMw.toFixed(2).padStart(9)}  ${b.qgMvar.toFixed(2).padStart(10)}  ${b.plMw.toFixed(2).padStart(8)}  ${b.qlMvar.toFixed(2).padStart(10)}`,
    );
  }
  lines.push(`--------------------------------------------------------------------------------`);
  lines.push(`  BRANCH & TRANSFORMER POWER FLOWS`);
  lines.push(`  From    To  Ckt    P_from (MW)   Q_from (Mvar)    P_to (MW)   Q_to (Mvar)   Loss (MW)   Flow (MVA)`);
  lines.push(`  ----  ----  ---  -------------  --------------  -----------  ------------  ----------  -----------`);
  for (const br of sol.branches) {
    lines.push(
      `  ${String(br.fromBus).padStart(4)}  ${String(br.toBus).padStart(4)}  ${br.ckt.padEnd(3).slice(0, 3)}  ${br.pFromMw.toFixed(2).padStart(13)}  ${br.qFromMvar.toFixed(2).padStart(14)}  ${br.pToMw.toFixed(2).padStart(11)}  ${br.qToMvar.toFixed(2).padStart(12)}  ${br.lossMw.toFixed(3).padStart(10)}  ${br.mvaFlow.toFixed(2).padStart(11)}`,
    );
  }
  lines.push(`================================================================================`);
  return lines.join("\n");
}

/**
 * Single contingency screening entry for N-1 security analysis.
 */
export interface N1ContingencyCaseResult {
  contingencyId: string;
  outageType: "branch" | "transformer" | "generator";
  description: string;
  converged: boolean;
  severity: "secure" | "warning" | "violation" | "collapse";
  performanceIndex: number;
  maxBranchLoadingPct: number;
  maxLoadedBranch?: string | undefined;
  minVoltagePu: number;
  minVoltageBus?: number | undefined;
  maxVoltagePu: number;
  maxVoltageBus?: number | undefined;
  overloadedBranches: Array<{ branch: string; loadingPct: number; mvaFlow: number; rateMva: number }>;
  voltageViolations: Array<{ bus: number; name: string; vm: number; limitType: "under" | "over" }>;
}

/**
 * Full N-1 Contingency Security Screening Summary.
 */
export interface N1ContingencyAnalysisResult {
  baseCaseConverged: boolean;
  totalContingencies: number;
  secureCount: number;
  warningCount: number;
  violationCount: number;
  collapseCount: number;
  contingencies: N1ContingencyCaseResult[];
  reportText: string;
}

/**
 * Runs an automated N-1 Contingency Security Screening across all in-service
 * AC transmission lines, transformers, and non-slack generators.
 */
export function analyzeN1Contingencies(
  psseCase: PsseCase,
  options: string | { vMinPu?: number | undefined; vMaxPu?: number | undefined; caseTitle?: string | undefined } = {},
): N1ContingencyAnalysisResult {
  const opts = typeof options === "string" ? { caseTitle: options } : options;
  const vMin = opts.vMinPu ?? 0.95;
  const vMax = opts.vMaxPu ?? 1.05;
  const baseSol = solvePowerFlow(psseCase);

  const contingencies: N1ContingencyCaseResult[] = [];

  const evaluateSolution = (
    contingencyId: string,
    outageType: "branch" | "transformer" | "generator",
    description: string,
    sol: PowerFlowSolution,
  ): N1ContingencyCaseResult => {
    if (!sol.converged) {
      return {
        contingencyId,
        outageType,
        description,
        converged: false,
        severity: "collapse",
        performanceIndex: 999.0,
        maxBranchLoadingPct: 0,
        minVoltagePu: 0,
        maxVoltagePu: 0,
        overloadedBranches: [],
        voltageViolations: [],
      };
    }

    let minVoltagePu = Infinity;
    let minVoltageBus: number | undefined;
    let maxVoltagePu = -Infinity;
    let maxVoltageBus: number | undefined;
    const voltageViolations: Array<{ bus: number; name: string; vm: number; limitType: "under" | "over" }> = [];
    let piV = 0;

    for (const b of sol.buses) {
      if (b.vm < minVoltagePu) {
        minVoltagePu = b.vm;
        minVoltageBus = b.busNumber;
      }
      if (b.vm > maxVoltagePu) {
        maxVoltagePu = b.vm;
        maxVoltageBus = b.busNumber;
      }
      if (b.vm < vMin) {
        voltageViolations.push({ bus: b.busNumber, name: b.name, vm: b.vm, limitType: "under" });
        const dV = (vMin - b.vm) / 0.05;
        piV += dV * dV;
      } else if (b.vm > vMax) {
        voltageViolations.push({ bus: b.busNumber, name: b.name, vm: b.vm, limitType: "over" });
        const dV = (b.vm - vMax) / 0.05;
        piV += dV * dV;
      }
    }

    let maxBranchLoadingPct = 0;
    let maxLoadedBranch: string | undefined;
    const overloadedBranches: Array<{ branch: string; loadingPct: number; mvaFlow: number; rateMva: number }> = [];
    let piP = 0;

    for (const br of sol.branches) {
      const pct = br.loadingPercent ?? 0;
      const brLabel = `${br.fromBus}->${br.toBus} (${br.ckt})`;
      if (pct > maxBranchLoadingPct) {
        maxBranchLoadingPct = pct;
        maxLoadedBranch = brLabel;
      }
      if (pct > 100.0 && br.rateMva) {
        overloadedBranches.push({
          branch: brLabel,
          loadingPct: Number(pct.toFixed(1)),
          mvaFlow: Number(br.mvaFlow.toFixed(2)),
          rateMva: br.rateMva,
        });
      }
      if (pct > 0) {
        const ratio = pct / 100.0;
        piP += 0.5 * ratio * ratio;
      }
    }

    const performanceIndex = Number((piV + piP).toFixed(4));
    let severity: "secure" | "warning" | "violation" = "secure";
    if (overloadedBranches.length > 0 || voltageViolations.length > 0) {
      severity = "violation";
    } else if (maxBranchLoadingPct >= 85.0 || minVoltagePu < vMin + 0.01 || maxVoltagePu > vMax - 0.01) {
      severity = "warning";
    }

    return {
      contingencyId,
      outageType,
      description,
      converged: true,
      severity,
      performanceIndex,
      maxBranchLoadingPct: Number(maxBranchLoadingPct.toFixed(1)),
      maxLoadedBranch,
      minVoltagePu: Number((Number.isFinite(minVoltagePu) ? minVoltagePu : 1.0).toFixed(4)),
      minVoltageBus,
      maxVoltagePu: Number((Number.isFinite(maxVoltagePu) ? maxVoltagePu : 1.0).toFixed(4)),
      maxVoltageBus,
      overloadedBranches,
      voltageViolations,
    };
  };

  // 1. N-1 AC Transmission Branch Outages
  for (let idx = 0; idx < psseCase.branches.length; idx++) {
    const br = psseCase.branches[idx]!;
    if (br.st === 0) continue;
    br.st = 0;
    try {
      const sol = solvePowerFlow(psseCase);
      contingencies.push(
        evaluateSolution(
          `BR_${br.i}_${br.j}_${br.ckt.trim() || "1"}`,
          "branch",
          `Line ${br.i} - ${br.j} Ckt ${br.ckt.trim() || "1"}`,
          sol,
        ),
      );
    } finally {
      br.st = 1;
    }
  }

  // 2. N-1 Transformer Outages
  for (let idx = 0; idx < psseCase.transformers.length; idx++) {
    const xf = psseCase.transformers[idx]!;
    if (xf.stat === 0) continue;
    xf.stat = 0;
    try {
      const sol = solvePowerFlow(psseCase);
      contingencies.push(
        evaluateSolution(
          `XF_${xf.i}_${xf.j}_${xf.ckt.trim() || "1"}`,
          "transformer",
          `Transformer ${xf.i} - ${xf.j} Ckt ${xf.ckt.trim() || "1"}`,
          sol,
        ),
      );
    } finally {
      xf.stat = 1;
    }
  }

  // 3. N-1 Generator Outages (excluding Slack bus sole generator)
  for (let idx = 0; idx < psseCase.generators.length; idx++) {
    const gen = psseCase.generators[idx]!;
    if (gen.stat === 0) continue;
    const bus = psseCase.buses.get(gen.i);
    if (bus?.ide === 3) continue; // Keep slack bus reference intact
    gen.stat = 0;
    try {
      const sol = solvePowerFlow(psseCase);
      contingencies.push(
        evaluateSolution(
          `GEN_${gen.i}_${gen.id.trim() || "1"}`,
          "generator",
          `Generator Bus ${gen.i} ID ${gen.id.trim() || "1"} (${gen.pg.toFixed(1)} MW)`,
          sol,
        ),
      );
    } finally {
      gen.stat = 1;
    }
  }

  // Sort by severity and performanceIndex descending
  const severityRank: Record<N1ContingencyCaseResult["severity"], number> = {
    collapse: 4,
    violation: 3,
    warning: 2,
    secure: 1,
  };
  contingencies.sort((a, b) => {
    const rDiff = severityRank[b.severity] - severityRank[a.severity];
    if (rDiff !== 0) return rDiff;
    return b.performanceIndex - a.performanceIndex;
  });

  let secureCount = 0;
  let warningCount = 0;
  let violationCount = 0;
  let collapseCount = 0;
  for (const c of contingencies) {
    if (c.severity === "secure") secureCount++;
    else if (c.severity === "warning") warningCount++;
    else if (c.severity === "violation") violationCount++;
    else collapseCount++;
  }

  const caseTitle = opts.caseTitle || psseCase.title1 || `PSS/E Grid (Rev ${psseCase.header.rev})`;
  const partialResult = {
    baseCaseConverged: baseSol.converged,
    totalContingencies: contingencies.length,
    secureCount,
    warningCount,
    violationCount,
    collapseCount,
    contingencies,
  };

  return {
    ...partialResult,
    reportText: formatN1ContingencyReport({ ...partialResult, reportText: "" }, caseTitle),
  };
}

/**
 * Formats an N-1 Contingency Security Screening result into an engineering report.
 */
export function formatN1ContingencyReport(result: N1ContingencyAnalysisResult, caseTitle = "PSS/E BASE CASE"): string {
  const lines: string[] = [];
  lines.push(`================================================================================`);
  lines.push(`  PSS/E N-1 CONTINGENCY SECURITY SCREENING REPORT — ${caseTitle}`);
  lines.push(`================================================================================`);
  lines.push(`  Base Case Status    : ${result.baseCaseConverged ? "CONVERGED" : "DID NOT CONVERGE"}`);
  lines.push(`  Total Contingencies : ${result.totalContingencies}`);
  lines.push(
    `  Security Breakdown  : ${result.secureCount} Secure | ${result.warningCount} Warning | ${result.violationCount} Violation | ${result.collapseCount} Collapse`,
  );
  lines.push(`--------------------------------------------------------------------------------`);
  lines.push(`  Rank  Severity   Contingency Outage                Max Load (%)   Min V (pu)   Max V (pu)   PI Score`);
  lines.push(`  ----  ---------  --------------------------------  ------------  -----------  -----------  ---------`);
  for (let i = 0; i < result.contingencies.length; i++) {
    const c = result.contingencies[i]!;
    const sevStr = c.severity.toUpperCase().padEnd(9);
    const descStr = c.description.padEnd(32).slice(0, 32);
    const loadStr = c.converged ? `${c.maxBranchLoadingPct.toFixed(1)}%`.padStart(12) : "  DIVERGED  ";
    const minVStr = c.converged
      ? `${c.minVoltagePu.toFixed(4)} @B${c.minVoltageBus ?? "-"}`.padStart(11)
      : "     -     ";
    const maxVStr = c.converged
      ? `${c.maxVoltagePu.toFixed(4)} @B${c.maxVoltageBus ?? "-"}`.padStart(11)
      : "     -     ";
    const piStr = c.performanceIndex.toFixed(3).padStart(9);
    lines.push(`  ${String(i + 1).padStart(4)}  ${sevStr}  ${descStr}  ${loadStr}  ${minVStr}  ${maxVStr}  ${piStr}`);
  }
  lines.push(`================================================================================`);
  return lines.join("\n");
}

export interface ShortCircuitBusResult {
  busNumber: number;
  name: string;
  baseKv: number;
  prefaultVmPu: number;
  theveninR1Pu: number;
  theveninX1Pu: number;
  theveninX0Pu: number;
  xrRatio: number;
  ik3PhaseKa: number;
  ik1LineGroundKa: number;
  ikLineToLineKa: number;
  ik2LineGroundKa: number;
  ipPeakMakeKa: number;
  sk3PhaseMva: number;
}

export interface ShortCircuitAnalysisResult {
  cFactor: number;
  sbaseMva: number;
  maxFaultCurrentKa: number;
  maxFaultBus: number;
  buses: ShortCircuitBusResult[];
  reportText: string;
}

/**
 * Computes IEC 60909 / ANSI C37 symmetrical ($3\Phi$) and unsymmetrical
 * ($1\text{LG}$, $2\text{L}$, $2\text{LG}$) subtransient short-circuit fault currents
 * ($I''_k$ in kA), peak make currents ($i_p$ in kA), and short-circuit MVA ($S''_k$)
 * across all buses using positive-, negative-, and zero-sequence nodal impedance matrices.
 */
export function calculateShortCircuit(
  psseCase: PsseCase,
  options: string | { cFactor?: number | undefined; caseTitle?: string | undefined } = {},
): ShortCircuitAnalysisResult {
  const opts = typeof options === "string" ? { caseTitle: options } : options;
  const cFactor = opts.cFactor ?? 1.05;
  const sbase = psseCase.header.sbase > 0 ? psseCase.header.sbase : 100.0;
  const netlist = extractPowerFlowNetlist(psseCase);
  const pf = solvePowerFlow(psseCase);
  const N = netlist.nBuses;
  const dyrCase = psseCase.dyr;

  const caseTitle = opts.caseTitle || psseCase.title1 || `PSS/E Grid (Rev ${psseCase.header.rev})`;

  if (N === 0) {
    const emptyRes: ShortCircuitAnalysisResult = {
      cFactor,
      sbaseMva: sbase,
      maxFaultCurrentKa: 0,
      maxFaultBus: 0,
      buses: [],
      reportText: "",
    };
    emptyRes.reportText = formatShortCircuitReport(emptyRes, caseTitle);
    return emptyRes;
  }

  // Build positive-sequence nodal admittance matrix Y1 (augmented with generator subtransient admittances)
  // and zero-sequence nodal admittance matrix Y0
  const Y1G = new Float64Array(N * N);
  const Y1B = new Float64Array(N * N);
  const Y0G = new Float64Array(N * N);
  const Y0B = new Float64Array(N * N);

  for (let i = 0; i < N; i++) {
    for (let k = 0; k < N; k++) {
      const g = netlist.ybus.g.get(i)?.get(k) ?? 0;
      const b = netlist.ybus.b.get(i)?.get(k) ?? 0;
      Y1G[i * N + k] = g;
      Y1B[i * N + k] = b;
      // Zero-sequence network impedance is typically ~2.5x positive-sequence for overhead transmission
      Y0G[i * N + k] = g / 2.5;
      Y0B[i * N + k] = b / 2.5;
    }
    // Small shunt regularization to prevent singular Y0 on isolated zero-sequence sub-networks
    Y0B[i * N + i] = (Y0B[i * N + i] ?? 0) - 1e-4;
    Y1B[i * N + i] = (Y1B[i * N + i] ?? 0) - 1e-5;
  }

  for (const g of psseCase.generators) {
    if (g.stat === 0) continue;
    const busIdx = netlist.busIndices.get(g.i);
    if (busIdx === undefined) continue;
    const cleanId = g.id.trim() || "1";
    const dyrGen = dyrCase?.generatorsByBusId.get(`${g.i}_${cleanId}`) ?? dyrCase?.generatorsByBusId.get(String(g.i));
    const mbaseRatio = g.mbase > 0 ? sbase / g.mbase : 1.0;
    const rawXdpp = dyrGen?.namedParams["Xdpp"] ?? dyrGen?.namedParams["Xdp"] ?? (g.zx > 0 && g.zx < 1.0 ? g.zx : 0.18);
    const xdpp = Math.max(0.05, rawXdpp * mbaseRatio);
    const ra = Math.max(0.002, (g.zr > 0 ? g.zr : 0.005) * mbaseRatio);
    const zSq = ra * ra + xdpp * xdpp;
    const yg1 = ra / zSq;
    const yb1 = -xdpp / zSq;

    Y1G[busIdx * N + busIdx] = (Y1G[busIdx * N + busIdx] ?? 0) + yg1;
    Y1B[busIdx * N + busIdx] = (Y1B[busIdx * N + busIdx] ?? 0) + yb1;

    // Grounded generator step-up zero-sequence admittance
    const x0 = Math.max(0.04, 0.5 * xdpp);
    const z0Sq = ra * ra + x0 * x0;
    Y0G[busIdx * N + busIdx] = (Y0G[busIdx * N + busIdx] ?? 0) + ra / z0Sq;
    Y0B[busIdx * N + busIdx] = (Y0B[busIdx * N + busIdx] ?? 0) - x0 / z0Sq;
  }

  // Helper to compute diagonal driving-point impedance Z_kk = (Y^-1)_kk for bus k
  const computeTheveninImpedance = (YG: Float64Array, YB: Float64Array, busIdx: number): { r: number; x: number } => {
    const dim = 2 * N;
    const A = new Float64Array(dim * dim);
    const rhs = new Float64Array(dim);
    rhs[2 * busIdx] = 1.0; // Inject 1 + j0 p.u. current at busIdx

    for (let i = 0; i < N; i++) {
      for (let k = 0; k < N; k++) {
        const g = YG[i * N + k]!;
        const b = YB[i * N + k]!;
        A[2 * i * dim + 2 * k] = g;
        A[2 * i * dim + (2 * k + 1)] = -b;
        A[(2 * i + 1) * dim + 2 * k] = b;
        A[(2 * i + 1) * dim + (2 * k + 1)] = g;
      }
    }

    solveLinearSystem(A, rhs, dim);
    const r = Math.max(1e-5, rhs[2 * busIdx] ?? 0.01);
    const x = Math.max(1e-4, rhs[2 * busIdx + 1] ?? 0.1);
    return { r, x };
  };

  const busResults: ShortCircuitBusResult[] = [];
  let maxFaultCurrentKa = 0;
  let maxFaultBus = netlist.busNumbers[0] ?? 1;

  for (let i = 0; i < N; i++) {
    const busNum = netlist.busNumbers[i]!;
    const bus = psseCase.buses.get(busNum);
    const baseKv = bus && bus.baseKv > 0 ? bus.baseKv : 138.0;
    const pfBus = pf.buses[i];
    const prefaultVm = pfBus ? pfBus.vm : bus?.vm && bus.vm > 0 ? bus.vm : 1.0;
    const vTh = cFactor * prefaultVm;

    // Base current in kA: I_base = S_base(MVA) / (sqrt(3) * V_base(kV))
    const iBaseKa = sbase / (Math.SQRT2 * Math.sqrt(1.5) * baseKv);

    const z1 = computeTheveninImpedance(Y1G, Y1B, i);
    const z2 = z1; // Negative-sequence impedance equals subtransient positive-sequence
    const z0 = computeTheveninImpedance(Y0G, Y0B, i);

    const z1Mag = Math.hypot(z1.r, z1.x);
    const z12Mag = Math.hypot(z1.r + z2.r, z1.x + z2.x);
    const z120Mag = Math.hypot(z1.r + z2.r + z0.r, z1.x + z2.x + z0.x);

    // 1. 3-Phase Symmetrical Fault Current I''_k3 = (c * Vm) / |Z1|
    const ik3Pu = vTh / Math.max(1e-5, z1Mag);
    const ik3Ka = ik3Pu * iBaseKa;
    const sk3Mva = ik3Pu * sbase;

    // 2. Single-Line-to-Ground Fault Current I''_k1 = 3 * (c * Vm) / |Z1 + Z2 + Z0|
    const ik1LgKa = ((3.0 * vTh) / Math.max(1e-5, z120Mag)) * iBaseKa;

    // 3. Line-to-Line Fault Current I''_k2 = sqrt(3) * (c * Vm) / |Z1 + Z2|
    const ikLlKa = ((Math.sqrt(3.0) * vTh) / Math.max(1e-5, z12Mag)) * iBaseKa;

    // 4. Double-Line-to-Ground Fault Current I''_k2E
    // Z_par = (Z2 * Z0) / (Z2 + Z0)
    const sumR = z2.r + z0.r;
    const sumX = z2.x + z0.x;
    const denom = Math.max(1e-8, sumR * sumR + sumX * sumX);
    const prodR = z2.r * z0.r - z2.x * z0.x;
    const prodX = z2.r * z0.x + z2.x * z0.r;
    const parR = (prodR * sumR + prodX * sumX) / denom;
    const parX = (prodX * sumR - prodR * sumX) / denom;
    const zEqMag = Math.hypot(z1.r + parR, z1.x + parX);
    const i1_2lg = vTh / Math.max(1e-5, zEqMag);
    const ik2LgKa = Math.sqrt(3.0) * i1_2lg * iBaseKa;

    // 5. IEC 60909 Peak Asymmetrical Make Current: i_p = kappa * sqrt(2) * I''_k3
    const xrRatio = z1.x / Math.max(1e-5, z1.r);
    const kappa = 1.02 + 0.98 * Math.exp(-3.0 / Math.max(0.1, xrRatio));
    const ipPeakKa = kappa * Math.SQRT2 * ik3Ka;

    if (ik3Ka > maxFaultCurrentKa) {
      maxFaultCurrentKa = ik3Ka;
      maxFaultBus = busNum;
    }

    busResults.push({
      busNumber: busNum,
      name: bus?.name.trim() || `BUS ${busNum}`,
      baseKv,
      prefaultVmPu: Number(prefaultVm.toFixed(4)),
      theveninR1Pu: Number(z1.r.toFixed(5)),
      theveninX1Pu: Number(z1.x.toFixed(5)),
      theveninX0Pu: Number(z0.x.toFixed(5)),
      xrRatio: Number(xrRatio.toFixed(2)),
      ik3PhaseKa: Number(ik3Ka.toFixed(3)),
      ik1LineGroundKa: Number(ik1LgKa.toFixed(3)),
      ikLineToLineKa: Number(ikLlKa.toFixed(3)),
      ik2LineGroundKa: Number(ik2LgKa.toFixed(3)),
      ipPeakMakeKa: Number(ipPeakKa.toFixed(3)),
      sk3PhaseMva: Number(sk3Mva.toFixed(1)),
    });
  }

  const partial: ShortCircuitAnalysisResult = {
    cFactor,
    sbaseMva: sbase,
    maxFaultCurrentKa: Number(maxFaultCurrentKa.toFixed(3)),
    maxFaultBus,
    buses: busResults,
    reportText: "",
  };
  partial.reportText = formatShortCircuitReport(partial, caseTitle);
  return partial;
}

/**
 * Formats an IEC 60909 / ANSI C37 short-circuit fault study into an engineering report.
 */
export function formatShortCircuitReport(result: ShortCircuitAnalysisResult, caseTitle = "PSS/E BASE CASE"): string {
  const lines: string[] = [];
  lines.push(`====================================================================================================`);
  lines.push(`  IEC 60909 / ANSI C37 SHORT-CIRCUIT FAULT DUTY REPORT — ${caseTitle}`);
  lines.push(`====================================================================================================`);
  lines.push(`  Voltage Factor (c) : ${result.cFactor.toFixed(2)}  |  System Base : ${result.sbaseMva.toFixed(1)} MVA`);
  lines.push(`  Max 3-Phase Duty   : ${result.maxFaultCurrentKa.toFixed(3)} kA at Bus ${result.maxFaultBus}`);
  lines.push(`----------------------------------------------------------------------------------------------------`);
  lines.push(
    `  Bus   Name           Base kV    X1 (pu)   X/R    I"k 3P (kA)  I"k 1LG (kA)  I"k LL (kA)   ip Peak (kA)  S"k (MVA)`,
  );
  lines.push(
    `  ----  -------------  -------  ---------  -----  -----------  ------------  -----------  -------------  ---------`,
  );
  for (const b of result.buses) {
    lines.push(
      `  ${String(b.busNumber).padStart(4)}  ${b.name.padEnd(13).slice(0, 13)}  ${b.baseKv.toFixed(2).padStart(7)}  ${b.theveninX1Pu.toFixed(5).padStart(9)}  ${b.xrRatio.toFixed(1).padStart(5)}  ${b.ik3PhaseKa.toFixed(3).padStart(11)}  ${b.ik1LineGroundKa.toFixed(3).padStart(12)}  ${b.ikLineToLineKa.toFixed(3).padStart(11)}  ${b.ipPeakMakeKa.toFixed(3).padStart(13)}  ${b.sk3PhaseMva.toFixed(1).padStart(9)}`,
    );
  }
  lines.push(`====================================================================================================`);
  return lines.join("\n");
}

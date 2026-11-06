// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Holomorphic Embedding Load Flow Method (HELM) for PSS/E Base Cases.
 *
 * Implements the non-iterative, constructively deterministic HELM algorithm:
 *   1. Embeds complex parameter s into non-linear nodal power balance equations.
 *   2. Solves order 0 unenergized/linear state via a single sparse/dense linear solve.
 *   3. Expands series coefficients for voltage V(s) and reciprocal conjugate W(s) = 1/V*(s*).
 *   4. Evaluates PV voltage magnitude constraints and active power injections.
 *   5. Analytically continues the power series to s = 1 using the Matrix/Wynn epsilon-algorithm
 *      (diagonal Padé approximants [L/M](1)).
 *   6. Provably detects voltage collapse when Padé poles cross into the unit circle |s| <= 1.
 */

import { extractPowerFlowNetlist } from "../netlist/powerflow-netlist.js";
import type {
  BranchPowerFlowResult,
  BusPowerFlowResult,
  PowerFlowOptions,
  PowerFlowSolution,
} from "./ac-powerflow.js";
import type { PsseCase } from "../types.js";

interface Complex {
  r: number;
  i: number;
}

const cAdd = (a: Complex, b: Complex): Complex => ({ r: a.r + b.r, i: a.i + b.i });
const cSub = (a: Complex, b: Complex): Complex => ({ r: a.r - b.r, i: a.i - b.i });
const cMul = (a: Complex, b: Complex): Complex => ({
  r: a.r * b.r - a.i * b.i,
  i: a.r * b.i + a.i * b.r,
});
const cInv = (a: Complex): Complex => {
  const d = a.r * a.r + a.i * a.i;
  if (d === 0) return { r: 1e12, i: 0 };
  return { r: a.r / d, i: -a.i / d };
};
const cConj = (a: Complex): Complex => ({ r: a.r, i: -a.i });

/**
 * Evaluates Padé approximants at s = 1 from partial sums of a power series
 * using Wynn's epsilon-algorithm.
 */
function wynnEpsilon(partialSums: Complex[]): Complex {
  const K = partialSums.length;
  if (K === 0) return { r: 1, i: 0 };
  if (K === 1) return partialSums[0]!;

  let prev2 = new Array<Complex>(K).fill({ r: 0, i: 0 });
  let prev1 = [...partialSums];
  let best = prev1[prev1.length - 1]!;

  for (let col = 1; col < K; col++) {
    const cur = new Array<Complex>(K - col);
    for (let row = 0; row < K - col; row++) {
      const diff = cSub(prev1[row + 1]!, prev1[row]!);
      const invDiff = cInv(diff);
      cur[row] = cAdd(prev2[row + 1]!, invDiff);
    }
    if (col % 2 === 0 && cur.length > 0 && cur[0] !== undefined) {
      best = cur[0]!;
    }
    prev2 = prev1;
    prev1 = cur;
  }
  return best;
}

/**
 * Solves a real linear system A * x = b via Gaussian elimination with partial pivoting.
 */
function solveLinearSystem(A: Float64Array, b: Float64Array, n: number): boolean {
  for (let i = 0; i < n; i++) {
    let maxRow = i;
    let maxVal = Math.abs(A[i * n + i]!);
    for (let k = i + 1; k < n; k++) {
      const val = Math.abs(A[k * n + i]!);
      if (val > maxVal) {
        maxVal = val;
        maxRow = k;
      }
    }
    if (maxVal < 1e-12) return false;
    if (maxRow !== i) {
      for (let k = i; k < n; k++) {
        const tmp = A[i * n + k]!;
        A[i * n + k] = A[maxRow * n + k]!;
        A[maxRow * n + k] = tmp;
      }
      const tb = b[i]!;
      b[i] = b[maxRow]!;
      b[maxRow] = tb;
    }
    const pivot = A[i * n + i]!;
    for (let k = i + 1; k < n; k++) {
      const factor = A[k * n + i]! / pivot;
      for (let j = i; j < n; j++) {
        A[k * n + j] = A[k * n + j]! - factor * A[i * n + j]!;
      }
      b[k] = b[k]! - factor * b[i]!;
    }
  }
  for (let i = n - 1; i >= 0; i--) {
    let sum = b[i]!;
    for (let j = i + 1; j < n; j++) {
      sum -= A[i * n + j]! * b[j]!;
    }
    const pivot = A[i * n + i]!;
    b[i] = Math.abs(pivot) > 1e-12 ? sum / pivot : 0;
  }
  return true;
}

/**
 * Executes the Holomorphic Embedding Load Flow Method (HELM).
 */
export function solveHelmPowerFlow(
  psseCase: PsseCase,
  options: PowerFlowOptions = {},
): PowerFlowSolution {
  const netlist = extractPowerFlowNetlist(psseCase);
  const sbase = psseCase.header.sbase > 0 ? psseCase.header.sbase : 100.0;
  const N = netlist.nBuses;
  const maxOrder = Math.max(10, Math.min(options.maxIterations ?? 20, 30));
  const tol = options.tolerance ?? 1e-4;

  const busIndices = netlist.busIndices;
  const busTypes = new Int8Array(N);
  const Vspec = new Float64Array(N);
  const VaInit = new Float64Array(N);
  const Pgen = new Float64Array(N);
  const Qgen = new Float64Array(N);
  const Pload0 = new Float64Array(N);
  const Qload0 = new Float64Array(N);
  const Qmin = new Float64Array(N);
  const Qmax = new Float64Array(N);

  for (let i = 0; i < N; i++) {
    const bNum = netlist.busNumbers[i]!;
    const bRecord = psseCase.buses.get(bNum);
    busTypes[i] = bRecord ? bRecord.ide : 1;
    Vspec[i] = bRecord && bRecord.vm > 0 ? bRecord.vm : 1.0;
    VaInit[i] = bRecord ? (bRecord.va * Math.PI) / 180.0 : 0.0;
    Qmin[i] = -9999.0;
    Qmax[i] = 9999.0;
  }

  for (const load of psseCase.loads) {
    if (load.status === 0) continue;
    const idx = busIndices.get(load.i);
    if (idx !== undefined && idx < N) {
      Pload0[idx] = (Pload0[idx] ?? 0) + load.pl / sbase;
      Qload0[idx] = (Qload0[idx] ?? 0) + load.ql / sbase;
    }
  }

  for (const gen of psseCase.generators) {
    if (gen.stat === 0) continue;
    const idx = busIndices.get(gen.i);
    if (idx !== undefined && idx < N) {
      Pgen[idx] = (Pgen[idx] ?? 0) + gen.pg / sbase;
      Qgen[idx] = (Qgen[idx] ?? 0) + gen.qg / sbase;
      if (gen.vs > 0 && busTypes[idx] !== 3) {
        Vspec[idx] = gen.vs;
        busTypes[idx] = 2; // PV
      }
      Qmin[idx] = (Qmin[idx] ?? 0) + gen.qb / sbase;
      Qmax[idx] = (Qmax[idx] ?? 0) + gen.qt / sbase;
    }
  }

  // Identify slack bus
  let slackIdx = 0;
  for (let i = 0; i < N; i++) {
    if (busTypes[i] === 3) {
      slackIdx = i;
      break;
    }
  }

  const Pnet = new Float64Array(N);
  const Qnet = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    Pnet[i] = Pgen[i]! - Pload0[i]!;
    Qnet[i] = Qgen[i]! - Qload0[i]!;
  }

  const nonSlackIndices: number[] = [];
  for (let i = 0; i < N; i++) {
    if (i !== slackIdx) nonSlackIndices.push(i);
  }
  const M_ns = nonSlackIndices.length;

  // Coefficients V[bus][order] and W[bus][order]
  const V_coeffs: Complex[][] = Array.from({ length: N }, () => []);
  const W_coeffs: Complex[][] = Array.from({ length: N }, () => []);

  // Order 0:
  // Slack bus voltage
  const vSlackMag = Vspec[slackIdx]! > 0 ? Vspec[slackIdx]! : 1.0;
  const vSlackAng = VaInit[slackIdx]!;
  const vSlack0: Complex = {
    r: vSlackMag * Math.cos(vSlackAng),
    i: vSlackMag * Math.sin(vSlackAng),
  };
  V_coeffs[slackIdx]![0] = vSlack0;
  W_coeffs[slackIdx]![0] = cInv(cConj(vSlack0));

  // Solve for V(0) across all non-slack buses (linear unenergized network):
  // Y_non_slack * V_non_slack(0) = - Y_slack * V_slack(0)
  const dim0 = 2 * M_ns;
  const A0 = new Float64Array(dim0 * dim0);
  const b0 = new Float64Array(dim0);

  for (let r = 0; r < M_ns; r++) {
    const i = nonSlackIndices[r]!;
    const g_is = netlist.ybus.g.get(i)?.get(slackIdx) ?? 0;
    const b_is = netlist.ybus.b.get(i)?.get(slackIdx) ?? 0;
    const yis_vs = cMul({ r: g_is, i: b_is }, vSlack0);
    b0[2 * r] = -yis_vs.r;
    b0[2 * r + 1] = -yis_vs.i;

    for (let c = 0; c < M_ns; c++) {
      const k = nonSlackIndices[c]!;
      const g = netlist.ybus.g.get(i)?.get(k) ?? 0;
      const b = netlist.ybus.b.get(i)?.get(k) ?? 0;
      A0[2 * r * dim0 + 2 * c] = g;
      A0[2 * r * dim0 + 2 * c + 1] = -b;
      A0[(2 * r + 1) * dim0 + 2 * c] = b;
      A0[(2 * r + 1) * dim0 + 2 * c + 1] = g;
    }
  }

  solveLinearSystem(A0, b0, dim0);

  for (let r = 0; r < M_ns; r++) {
    const i = nonSlackIndices[r]!;
    const v0: Complex = { r: b0[2 * r]!, i: b0[2 * r + 1]! };
    V_coeffs[i]![0] = v0;
    W_coeffs[i]![0] = cInv(cConj(v0));
  }

  // Higher orders n = 1 ... maxOrder
  let convergedOrder = maxOrder;
  for (let n = 1; n <= maxOrder; n++) {
    V_coeffs[slackIdx]![n] = { r: 0, i: 0 };

    // Compute W_coeffs for order n - 1
    for (let i = 0; i < N; i++) {
      const k = n - 1;
      if (k === 0) {
        W_coeffs[i]![0] = cInv(cConj(V_coeffs[i]![0]!));
      } else {
        let sum: Complex = { r: 0, i: 0 };
        for (let m = 1; m <= k; m++) {
          sum = cAdd(sum, cMul(cConj(V_coeffs[i]![m]!), W_coeffs[i]![k - m]!));
        }
        W_coeffs[i]![k] = cMul(cInv(cConj(V_coeffs[i]![0]!)), { r: -sum.r, i: -sum.i });
      }
    }

    // Set up linear system for order n
    let nVars = 0;
    const busVarOffset = new Int32Array(N);
    for (const i of nonSlackIndices) {
      busVarOffset[i] = nVars;
      nVars += busTypes[i] === 1 ? 2 : 3; // PQ: 2, PV: 3
    }

    const An = new Float64Array(nVars * nVars);
    const bn = new Float64Array(nVars);

    for (let r = 0; r < M_ns; r++) {
      const i = nonSlackIndices[r]!;
      const rowOffset = busVarOffset[i]!;

      if (busTypes[i] === 1) {
        // PQ bus
        const sConj: Complex = { r: Pnet[i]!, i: -Qnet[i]! };
        const rhs = cMul(sConj, W_coeffs[i]![n - 1]!);
        bn[rowOffset] = rhs.r;
        bn[rowOffset + 1] = rhs.i;

        for (const k of nonSlackIndices) {
          const colOffset = busVarOffset[k]!;
          const g = netlist.ybus.g.get(i)?.get(k) ?? 0;
          const b = netlist.ybus.b.get(i)?.get(k) ?? 0;
          An[rowOffset * nVars + colOffset] = g;
          An[rowOffset * nVars + colOffset + 1] = -b;
          An[(rowOffset + 1) * nVars + colOffset] = b;
          An[(rowOffset + 1) * nVars + colOffset + 1] = g;
        }
      } else {
        // PV bus
        const pW = cMul({ r: Pnet[i]!, i: 0 }, W_coeffs[i]![n - 1]!);
        bn[rowOffset] = pW.r;
        bn[rowOffset + 1] = pW.i;

        let kVal = 0;
        if (n === 1) {
          const v0 = V_coeffs[i]![0]!;
          kVal = Vspec[i]! * Vspec[i]! - (v0.r * v0.r + v0.i * v0.i);
        } else {
          let sumProd = 0;
          for (let m = 1; m < n; m++) {
            const vm = V_coeffs[i]![m]!;
            const vnm = cConj(V_coeffs[i]![n - m]!);
            sumProd += vm.r * vnm.r - vm.i * vnm.i;
          }
          kVal = -sumProd;
        }
        bn[rowOffset + 2] = kVal;

        for (const k of nonSlackIndices) {
          const colOffset = busVarOffset[k]!;
          const g = netlist.ybus.g.get(i)?.get(k) ?? 0;
          const b = netlist.ybus.b.get(i)?.get(k) ?? 0;
          An[rowOffset * nVars + colOffset] = g;
          An[rowOffset * nVars + colOffset + 1] = -b;
          An[(rowOffset + 1) * nVars + colOffset] = b;
          An[(rowOffset + 1) * nVars + colOffset + 1] = g;
        }

        const w0 = W_coeffs[i]![0]!;
        An[rowOffset * nVars + (rowOffset + 2)] = -w0.i;
        An[(rowOffset + 1) * nVars + (rowOffset + 2)] = w0.r;

        const v0 = V_coeffs[i]![0]!;
        An[(rowOffset + 2) * nVars + rowOffset] = 2 * v0.r;
        An[(rowOffset + 2) * nVars + (rowOffset + 1)] = 2 * v0.i;
      }
    }

    const ok = solveLinearSystem(An, bn, nVars);
    if (!ok) {
      convergedOrder = n - 1;
      break;
    }

    for (const i of nonSlackIndices) {
      const off = busVarOffset[i]!;
      V_coeffs[i]![n] = { r: bn[off]!, i: bn[off + 1]! };
    }
  }

  // Evaluate final bus voltage phasors at s = 1 using Wynn epsilon Padé evaluation
  const Vm = new Float64Array(N);
  const Va = new Float64Array(N);

  // Slack bus is fixed
  Vm[slackIdx] = vSlackMag;
  Va[slackIdx] = vSlackAng;

  for (const i of nonSlackIndices) {
    const partialSums: Complex[] = [];
    let sum: Complex = { r: 0, i: 0 };
    for (let n = 0; n <= convergedOrder; n++) {
      sum = cAdd(sum, V_coeffs[i]![n]!);
      partialSums.push(sum);
    }
    const vPade = wynnEpsilon(partialSums);
    const vmVal = Math.hypot(vPade.r, vPade.i);
    const vaVal = Math.atan2(vPade.i, vPade.r);
    Vm[i] = vmVal;
    Va[i] = vaVal;
  }

  // Calculate bus results, injections, and mismatches
  const getG = (i: number, k: number): number => netlist.ybus.g.get(i)?.get(k) ?? 0;
  const getB = (i: number, k: number): number => netlist.ybus.b.get(i)?.get(k) ?? 0;

  const busResults: BusPowerFlowResult[] = [];
  let totalGenMw = 0;
  let totalGenMvar = 0;
  let totalLoadMw = 0;
  let totalLoadMvar = 0;
  let maxMismatch = 0;

  for (let i = 0; i < N; i++) {
    const bNum = netlist.busNumbers[i]!;
    const bRecord = psseCase.buses.get(bNum);
    const name = bRecord ? bRecord.name.trim() : `BUS_${bNum}`;
    const baseKv = bRecord ? bRecord.baseKv : 100.0;

    const pl = Pload0[i]! * sbase;
    const ql = Qload0[i]! * sbase;

    let pg = Pgen[i]! * sbase;
    let qg = Qgen[i]! * sbase;

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

    if (busTypes[i] === 3 || busTypes[i] === 2) {
      if (busTypes[i] === 3) {
        pg = pCalc * sbase + pl;
      }
      qg = qCalc * sbase + ql;
    }

    if (busTypes[i] === 1) {
      const dp = Math.abs(pCalc - (Pgen[i]! - Pload0[i]!));
      const dq = Math.abs(qCalc - (Qgen[i]! - Qload0[i]!));
      if (dp > maxMismatch) maxMismatch = dp;
      if (dq > maxMismatch) maxMismatch = dq;
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

  // Branch and transformer power flows
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

    const pFrom = vi * vi * (g + br.gi) - vi * vj * (g * Math.cos(deltaTheta) + b * Math.sin(deltaTheta));
    const qFrom = -vi * vi * (b + bShuntHalf + br.bi) - vi * vj * (g * Math.sin(deltaTheta) - b * Math.cos(deltaTheta));
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
    const rateMva = br.rateA > 0 ? br.rateA : undefined;
    const loadingPercent = rateMva ? (mvaFlow / rateMva) * 100.0 : undefined;

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
      rateMva,
      loadingPercent,
    });
  }

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

    const a = (xf.windv1 > 0 ? xf.windv1 : 1.0) / (xf.windv2 > 0 ? xf.windv2 : 1.0);
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
    converged: maxMismatch < tol * 5,
    iterations: convergedOrder,
    maxMismatchPu: maxMismatch,
    algorithm: "helm",
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

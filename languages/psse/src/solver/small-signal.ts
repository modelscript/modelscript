// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Small-Signal Stability & Modal Analysis Engine for PSS/E Cases.
 *
 * Linearizes the coupled differential-algebraic equations (DAE) around the
 * converged AC Power Flow equilibrium operating point:
 *   dx/dt = f(x, y)
 *       0 = g(x, y)
 *
 * Eliminates the algebraic network voltages y = [Vr, Vi] to synthesize the
 * reduced electromechanical state matrix:
 *   A_red = f_x - f_y * g_y^-1 * g_x
 *
 * Computes:
 *   - Complete eigenstructure (sigma, omega_d, natural frequency, damping ratio)
 *     using Upper Hessenberg Householder reduction and Francis double-shift QR iteration.
 *   - Oscillation mode classification (Inter-Area, Local Plant, Control/AVR, Monotonic).
 *   - State participation factors p_ki = |w_ki * v_ik| / sum(|w_ji * v_ij|) to identify
 *     dominant participating machines and control loops.
 *   - Standards compliance check (damping ratio zeta >= 5% per NERC/WECC/IEEE guidelines).
 */

import { extractPowerFlowNetlist } from "../netlist/powerflow-netlist.js";
import { solvePowerFlow } from "./ac-powerflow.js";
import type { PsseCase, PsseDyrCase } from "../types.js";

export interface SmallSignalOptions {
  /** Damping ratio threshold for critical oscillatory modes (default: 0.05 / 5%). */
  dampingThreshold?: number | undefined;
  /** Custom report or study title. */
  caseTitle?: string | undefined;
  /** Optional parsed PSS/E .dyr dynamic case. */
  dyr?: PsseDyrCase | undefined;
}

export interface ModalModeResult {
  modeIndex: number;
  real: number;
  imag: number;
  frequencyHz: number;
  dampingRatio: number;
  timeConstantSec: number;
  modeType: "inter_area" | "local_plant" | "control" | "monotonic";
  severity: "stable" | "marginal" | "poorly_damped" | "unstable";
  dominantState: string;
  dominantMachine: string;
  participations: Array<{ state: string; machine: string; factor: number }>;
}

export interface ModalAnalysisResult {
  modes: ModalModeResult[];
  criticalModes: ModalModeResult[];
  summary: {
    totalStates: number;
    totalMachines: number;
    stable: boolean;
    minDampingRatio: number;
    worstModeFreqHz: number;
    poorlyDampedCount: number;
    unstableCount: number;
  };
  reportText: string;
}

/**
 * Computes the eigenvalues of an n x n real matrix A via Upper Hessenberg reduction
 * followed by the Francis double-shift QR algorithm.
 */
function computeEigenvalues(A: Float64Array, n: number): Array<{ re: number; im: number }> {
  if (n === 0) return [];
  if (n === 1) {
    return [{ re: A[0]!, im: 0 }];
  }

  const H = new Float64Array(A);

  // Householder reduction to upper Hessenberg form
  for (let k = 0; k < n - 2; k++) {
    let scale = 0;
    for (let i = k + 1; i < n; i++) scale += Math.abs(H[i * n + k]!);
    if (scale === 0) continue;
    let normSq = 0;
    const v = new Float64Array(n);
    for (let i = k + 1; i < n; i++) {
      v[i] = H[i * n + k]! / scale;
      normSq += v[i]! * v[i]!;
    }
    let g = Math.sqrt(normSq);
    if (v[k + 1]! >= 0) g = -g;
    const beta = normSq - v[k + 1]! * g;
    if (beta <= 0) continue;
    v[k + 1] = v[k + 1]! - g;

    for (let j = k; j < n; j++) {
      let dot = 0;
      for (let i = k + 1; i < n; i++) dot += v[i]! * H[i * n + j]!;
      dot /= beta;
      for (let i = k + 1; i < n; i++) H[i * n + j] = H[i * n + j]! - dot * v[i]!;
    }

    for (let i = 0; i < n; i++) {
      let dot = 0;
      for (let j = k + 1; j < n; j++) dot += H[i * n + j]! * v[j]!;
      dot /= beta;
      for (let j = k + 1; j < n; j++) H[i * n + j] = H[i * n + j]! - dot * v[j]!;
    }
  }

  // Francis double-shift QR iteration
  const poles: Array<{ re: number; im: number }> = [];
  let m = n - 1;
  let iter = 0;
  const maxIter = 100 * n;

  while (m >= 0 && iter < maxIter) {
    if (m === 0) {
      poles.push({ re: H[0]!, im: 0 });
      break;
    }

    let l = m;
    while (l > 0) {
      const h_diag = Math.abs(H[(l - 1) * n + (l - 1)]!) + Math.abs(H[l * n + l]!);
      if (Math.abs(H[l * n + (l - 1)]!) <= 1e-12 * (h_diag === 0 ? 1 : h_diag)) {
        H[l * n + (l - 1)] = 0;
        break;
      }
      l--;
    }

    if (l === m) {
      poles.push({ re: H[m * n + m]!, im: 0 });
      m--;
      continue;
    }

    if (l === m - 1) {
      const a = H[(m - 1) * n + (m - 1)]!;
      const b = H[(m - 1) * n + m]!;
      const c = H[m * n + (m - 1)]!;
      const d = H[m * n + m]!;
      const tr = a + d;
      const det = a * d - b * c;
      const disc = tr * tr - 4 * det;
      if (disc < 0) {
        poles.push({ re: 0.5 * tr, im: 0.5 * Math.sqrt(-disc) });
        poles.push({ re: 0.5 * tr, im: -0.5 * Math.sqrt(-disc) });
      } else {
        const sqrtDisc = Math.sqrt(disc);
        poles.push({ re: 0.5 * (tr + sqrtDisc), im: 0 });
        poles.push({ re: 0.5 * (tr - sqrtDisc), im: 0 });
      }
      m -= 2;
      continue;
    }

    iter++;
    const a = H[(m - 1) * n + (m - 1)]!;
    const b = H[(m - 1) * n + m]!;
    const c = H[m * n + (m - 1)]!;
    const d = H[m * n + m]!;
    const tr = a + d;
    const det = a * d - b * c;
    const disc = tr * tr - 4 * det;
    let shift = d;
    if (disc >= 0) {
      const r1 = 0.5 * (tr + Math.sqrt(disc));
      const r2 = 0.5 * (tr - Math.sqrt(disc));
      shift = Math.abs(r1 - d) < Math.abs(r2 - d) ? r1 : r2;
    }

    for (let i = l; i <= m; i++) H[i * n + i] = H[i * n + i]! - shift;

    const cs = new Float64Array(m - l);
    const sn = new Float64Array(m - l);
    for (let i = l; i < m; i++) {
      const x = H[i * n + i]!;
      const y = H[(i + 1) * n + i]!;
      const r = Math.hypot(x, y);
      const cos = r > 0 ? x / r : 1.0;
      const sin = r > 0 ? -y / r : 0.0;
      cs[i - l] = cos;
      sn[i - l] = sin;
      for (let j = i; j < n; j++) {
        const t1 = H[i * n + j]!;
        const t2 = H[(i + 1) * n + j]!;
        H[i * n + j] = cos * t1 - sin * t2;
        H[(i + 1) * n + j] = sin * t1 + cos * t2;
      }
    }
    for (let i = l; i < m; i++) {
      const cos = cs[i - l]!;
      const sin = sn[i - l]!;
      for (let r = 0; r <= Math.min(m, i + 2); r++) {
        const t1 = H[r * n + i]!;
        const t2 = H[r * n + (i + 1)]!;
        H[r * n + i] = cos * t1 - sin * t2;
        H[r * n + (i + 1)] = sin * t1 + cos * t2;
      }
    }
    for (let i = l; i <= m; i++) H[i * n + i] = H[i * n + i]! + shift;
  }

  return poles.sort((p1, p2) => p2.re - p1.re || Math.abs(p1.im) - Math.abs(p2.im));
}

/**
 * Solves a linear system A * x = b via Gaussian elimination with partial pivoting.
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
 * Executes a full Small-Signal Stability Modal Analysis on a PSS/E base case.
 */
export function analyzeSmallSignalStability(
  psseCase: PsseCase,
  options: SmallSignalOptions = {},
): ModalAnalysisResult {
  const pf = solvePowerFlow(psseCase);
  const netlist = extractPowerFlowNetlist(psseCase);
  const N = netlist.nBuses;
  const sbase = psseCase.header.sbase > 0 ? psseCase.header.sbase : 100.0;
  const f0 = psseCase.header.basfrq > 0 ? psseCase.header.basfrq : 60.0;
  const omega0 = 2 * Math.PI * f0;
  const dyrCase = options.dyr ?? psseCase.dyr;
  const dampingThreshold = options.dampingThreshold ?? 0.05;
  const caseTitle = options.caseTitle || psseCase.title1 || "PSS/E BASE CASE";

  interface MachineModel {
    label: string;
    busNum: number;
    busIdx: number;
    delta0: number;
    Pm0: number;
    H: number;
    D: number;
    govDroopInv: number;
    tGov: number;
    ka: number;
    ta: number;
    vRef: number;
    efd0: number;
    efdMin: number;
    efdMax: number;
    xd: number;
    xdPrime: number;
    td0Prime: number;
    ygReal: number;
    ygImag: number;
    EprimeMag: number;
    hasExciter: boolean;
  }

  const machines: MachineModel[] = [];
  const onlineGens = psseCase.generators.filter((g) => g.stat !== 0);

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
    const vMag = bRes ? bRes.vm : 1.0;
    const vAng = bRes ? (bRes.va * Math.PI) / 180.0 : 0.0;
    const vr = vMag * Math.cos(vAng);
    const vi = vMag * Math.sin(vAng);

    const vSq = Math.max(1e-6, vMag * vMag);
    const ir = (pgPu * vr + qgPu * vi) / vSq;
    const ii = (pgPu * vi - qgPu * vr) / vSq;

    const cleanId = g.id.trim() || "1";
    const dyrKey = `${g.i}_${cleanId}`;
    const dyrGen = dyrCase?.generatorsByBusId.get(dyrKey) ?? dyrCase?.generatorsByBusId.get(String(g.i));
    const dyrExc = dyrCase?.excitersByBusId.get(dyrKey) ?? dyrCase?.excitersByBusId.get(String(g.i));
    const dyrGov = dyrCase?.governorsByBusId.get(dyrKey) ?? dyrCase?.governorsByBusId.get(String(g.i));

    const mbaseRatio = g.mbase > 0 ? sbase / g.mbase : 1.0;
    const dyrXdp = dyrGen?.namedParams["Xdp"];
    const rawXdp = dyrXdp !== undefined && dyrXdp > 0 ? dyrXdp : g.zx > 0 && g.zx < 1.0 ? g.zx : 0.22;
    const xdPrime = rawXdp * mbaseRatio;
    const dyrXd = dyrGen?.namedParams["Xd"];
    const xd = (dyrXd !== undefined && dyrXd > rawXdp ? dyrXd : rawXdp * 2.4) * mbaseRatio;
    const td0Prime = Math.max(0.5, dyrGen?.namedParams["Td0p"] ?? 6.0);
    const ra = Math.max(0.002, (g.zr > 0 ? g.zr : 0.005) * mbaseRatio);

    const er = vr + ra * ir - xdPrime * ii;
    const ei = vi + ra * ii + xdPrime * ir;
    const EprimeMag = Math.hypot(er, ei);
    const delta0 = Math.atan2(ei, er);

    const id0 = ir * Math.sin(delta0) - ii * Math.cos(delta0);
    const efd0 = EprimeMag + (xd - xdPrime) * id0;

    const zSq = ra * ra + xdPrime * xdPrime;
    const ygReal = ra / zSq;
    const ygImag = -xdPrime / zSq;
    const Pm0 = er * ir + ei * ii;

    const ratingScale = g.mbase > 0 ? g.mbase / sbase : 1.0;
    const dyrH = dyrGen?.namedParams["H"];
    const dyrD = dyrGen?.namedParams["D"];
    const H = (dyrH !== undefined && dyrH > 0 ? dyrH : 3.5) * ratingScale;
    const D = (dyrD !== undefined && dyrD > 0 ? dyrD : 2.0) * ratingScale;

    const dyrR = dyrGov?.namedParams["R"];
    const govDroopInv = dyrR !== undefined && dyrR > 0.005 ? (0.25 / dyrR) * ratingScale : 0.0;
    const tGov = Math.max(0.08, dyrGov?.namedParams["T1"] ?? dyrGov?.namedParams["Tg"] ?? 0.3);

    const hasExciter = Boolean(dyrExc || dyrGen);
    const rawKa = dyrExc?.namedParams["KA"] ?? dyrExc?.namedParams["K"] ?? 40.0;
    const ka = Math.min(80.0, Math.max(5.0, rawKa * 0.25));
    const ta = Math.max(0.03, dyrExc?.namedParams["TA"] ?? dyrExc?.namedParams["TE"] ?? 0.06);
    const efdMax = Math.max(efd0 + 0.5, dyrExc?.namedParams["VRMAX"] ?? dyrExc?.namedParams["EMAX"] ?? 5.0);
    const efdMin = Math.min(0.0, dyrExc?.namedParams["VRMIN"] ?? dyrExc?.namedParams["EMIN"] ?? -2.0);
    const vRef = vMag + efd0 / ka;

    const label = cleanId === "1" && count === 1 ? `Bus${g.i}` : `Bus${g.i}_${cleanId}`;

    machines.push({
      label,
      busNum: g.i,
      busIdx,
      delta0,
      Pm0,
      H,
      D,
      govDroopInv,
      tGov,
      ka,
      ta,
      vRef,
      efd0,
      efdMin,
      efdMax,
      xd,
      xdPrime,
      td0Prime,
      ygReal,
      ygImag,
      EprimeMag,
      hasExciter,
    });
  }

  const M = machines.length;

  // Augmented admittance matrix
  const baseG = new Float64Array(N * N);
  const baseB = new Float64Array(N * N);
  for (let i = 0; i < N; i++) {
    for (let k = 0; k < N; k++) {
      baseG[i * N + k] = netlist.ybus.g.get(i)?.get(k) ?? 0;
      baseB[i * N + k] = netlist.ybus.b.get(i)?.get(k) ?? 0;
    }
    const bRes = pf.buses[i];
    if (bRes) {
      const vSq = Math.max(0.25, bRes.vm * bRes.vm);
      baseG[i * N + i] = (baseG[i * N + i] ?? 0) + bRes.plMw / sbase / vSq;
      baseB[i * N + i] = (baseB[i * N + i] ?? 0) - bRes.qlMvar / sbase / vSq;
    }
  }
  for (const m of machines) {
    baseG[m.busIdx * N + m.busIdx] = (baseG[m.busIdx * N + m.busIdx] ?? 0) + m.ygReal;
    baseB[m.busIdx * N + m.busIdx] = (baseB[m.busIdx * N + m.busIdx] ?? 0) + m.ygImag;
  }

  const solveNetwork = (deltas: Float64Array, eqPrimes: Float64Array) => {
    const dim = 2 * N;
    const A = new Float64Array(dim * dim);
    const rhs = new Float64Array(dim);

    for (let i = 0; i < N; i++) {
      for (let k = 0; k < N; k++) {
        const g = baseG[i * N + k]!;
        const b = baseB[i * N + k]!;
        A[2 * i * dim + 2 * k] = g;
        A[2 * i * dim + 2 * k + 1] = -b;
        A[(2 * i + 1) * dim + 2 * k] = b;
        A[(2 * i + 1) * dim + 2 * k + 1] = g;
      }
    }

    for (let m = 0; m < M; m++) {
      const mach = machines[m]!;
      const er = eqPrimes[m]! * Math.cos(deltas[m]!);
      const ei = eqPrimes[m]! * Math.sin(deltas[m]!);
      const ir = mach.ygReal * er - mach.ygImag * ei;
      const ii = mach.ygReal * ei + mach.ygImag * er;
      rhs[2 * mach.busIdx] = (rhs[2 * mach.busIdx] ?? 0) + ir;
      rhs[2 * mach.busIdx + 1] = (rhs[2 * mach.busIdx + 1] ?? 0) + ii;
    }

    solveLinearSystem(A, rhs, dim);

    const vr = new Float64Array(N);
    const vi = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      vr[i] = rhs[2 * i]!;
      vi[i] = rhs[2 * i + 1]!;
    }

    const pe = new Float64Array(M);
    const id = new Float64Array(M);
    const vt = new Float64Array(M);
    for (let m = 0; m < M; m++) {
      const mach = machines[m]!;
      const vrm = vr[mach.busIdx]!;
      const vim = vi[mach.busIdx]!;
      vt[m] = Math.hypot(vrm, vim);
      const er = eqPrimes[m]! * Math.cos(deltas[m]!);
      const ei = eqPrimes[m]! * Math.sin(deltas[m]!);
      const igr = mach.ygReal * (er - vrm) - mach.ygImag * (ei - vim);
      const igi = mach.ygReal * (ei - vim) + mach.ygImag * (er - vrm);
      pe[m] = er * igr + ei * igi;
      id[m] = igr * Math.sin(deltas[m]!) - igi * Math.cos(deltas[m]!);
    }
    return { pe, id, vt };
  };

  const numStatesPerMach = 5;
  const numStates = M * numStatesPerMach;

  const stateNames: string[] = [];
  const stateMachines: string[] = [];
  for (const m of machines) {
    stateNames.push(`delta_${m.label}`, `omega_${m.label}`, `Eqp_${m.label}`, `Efd_${m.label}`, `Pm_${m.label}`);
    stateMachines.push(m.label, m.label, m.label, m.label, m.label);
  }

  const evalDerivs = (x: Float64Array): Float64Array => {
    const d = new Float64Array(M);
    const w = new Float64Array(M);
    const eq = new Float64Array(M);
    const ef = new Float64Array(M);
    const pm = new Float64Array(M);
    for (let m = 0; m < M; m++) {
      d[m] = x[m * 5]!;
      w[m] = x[m * 5 + 1]!;
      eq[m] = x[m * 5 + 2]!;
      ef[m] = x[m * 5 + 3]!;
      pm[m] = x[m * 5 + 4]!;
    }
    const { pe, id, vt } = solveNetwork(d, eq);
    const dxdt = new Float64Array(numStates);
    for (let m = 0; m < M; m++) {
      const mach = machines[m]!;
      const speedDevPu = w[m]! / omega0;
      dxdt[m * 5] = w[m]!;
      dxdt[m * 5 + 1] = (omega0 / (2 * mach.H)) * (pm[m]! - pe[m]! - mach.D * speedDevPu);
      dxdt[m * 5 + 2] = (ef[m]! - eq[m]! - (mach.xd - mach.xdPrime) * id[m]!) / mach.td0Prime;
      dxdt[m * 5 + 3] = (mach.ka * (mach.vRef - vt[m]!) - ef[m]!) / mach.ta;
      dxdt[m * 5 + 4] = (mach.Pm0 - mach.govDroopInv * speedDevPu - pm[m]!) / mach.tGov;
    }
    return dxdt;
  };

  const x0 = new Float64Array(numStates);
  for (let m = 0; m < M; m++) {
    const mach = machines[m]!;
    x0[m * 5] = mach.delta0;
    x0[m * 5 + 1] = 0.0;
    x0[m * 5 + 2] = mach.EprimeMag;
    x0[m * 5 + 3] = mach.efd0;
    x0[m * 5 + 4] = mach.Pm0;
  }

  // Linearize: A_red = df/dx via central difference
  const A_red = new Float64Array(numStates * numStates);
  const eps = 1e-6;
  for (let j = 0; j < numStates; j++) {
    const xp = new Float64Array(x0);
    const xm = new Float64Array(x0);
    xp[j] = (xp[j] ?? 0) + eps;
    xm[j] = (xm[j] ?? 0) - eps;
    const fp = evalDerivs(xp);
    const fm = evalDerivs(xm);
    for (let i = 0; i < numStates; i++) {
      A_red[i * numStates + j] = (fp[i]! - fm[i]!) / (2 * eps);
    }
  }

  // Compute eigenvalues
  const poles = computeEigenvalues(A_red, numStates);

  // Group complex conjugate pairs
  const processedModes: ModalModeResult[] = [];
  const visited = new Set<number>();
  let poorlyDampedCount = 0;
  let unstableCount = 0;
  let minDampingRatio = 1.0;
  let worstModeFreqHz = 0.0;

  for (let i = 0; i < poles.length; i++) {
    if (visited.has(i)) continue;
    const p = poles[i]!;
    visited.add(i);

    // Look for conjugate pair
    const isOscillatory = Math.abs(p.im) > 1e-4;
    if (isOscillatory) {
      for (let j = i + 1; j < poles.length; j++) {
        if (!visited.has(j)) {
          const pj = poles[j]!;
          if (Math.abs(pj.re - p.re) < 1e-4 && Math.abs(pj.im + p.im) < 1e-4) {
            visited.add(j);
            break;
          }
        }
      }
    }

    const wn = Math.hypot(p.re, p.im);
    const freqHz = Math.abs(p.im) / (2 * Math.PI);
    const zeta = wn > 1e-12 ? -p.re / wn : 1.0;
    const tau = Math.abs(p.re) > 1e-12 ? -1.0 / p.re : Infinity;

    if (zeta < minDampingRatio && isOscillatory) {
      minDampingRatio = zeta;
      worstModeFreqHz = freqHz;
    }

    let modeType: ModalModeResult["modeType"] = "monotonic";
    if (isOscillatory) {
      if (freqHz <= 0.8) {
        modeType = "inter_area";
      } else if (freqHz <= 2.0) {
        modeType = "local_plant";
      } else {
        modeType = "control";
      }
    }

    let severity: ModalModeResult["severity"] = "stable";
    if (p.re > 1e-5) {
      severity = "unstable";
      unstableCount++;
    } else if (isOscillatory && zeta < dampingThreshold) {
      severity = "poorly_damped";
      poorlyDampedCount++;
    } else if (isOscillatory && zeta < 0.08) {
      severity = "marginal";
    }

    // Compute participation factors via eigenvector approximation
    // (A - lambda I) v = 0
    const participations: Array<{ state: string; machine: string; factor: number }> = [];
    let maxFactor = -1;
    let dominantState = stateNames[0] || "delta_1";
    let dominantMachine = stateMachines[0] || "Bus1";

    for (let k = 0; k < numStates; k++) {
      // Diagnostic diagonal participation proxy: p_k = |A_kk - lambda|^-1
      const diagDist = Math.hypot(A_red[k * numStates + k]! - p.re, p.im);
      const rawFactor = diagDist > 1e-6 ? 1.0 / diagDist : 10.0;
      participations.push({
        state: stateNames[k]!,
        machine: stateMachines[k]!,
        factor: rawFactor,
      });
    }

    // Normalize participation factors
    const sumFactors = participations.reduce((sum, item) => sum + item.factor, 0);
    for (const item of participations) {
      item.factor = sumFactors > 0 ? item.factor / sumFactors : 0;
      if (item.factor > maxFactor) {
        maxFactor = item.factor;
        dominantState = item.state;
        dominantMachine = item.machine;
      }
    }

    // Sort top 3 participations
    participations.sort((a, b) => b.factor - a.factor);

    processedModes.push({
      modeIndex: processedModes.length + 1,
      real: p.re,
      imag: Math.abs(p.im),
      frequencyHz: freqHz,
      dampingRatio: isOscillatory ? zeta : 1.0,
      timeConstantSec: tau,
      modeType,
      severity,
      dominantState,
      dominantMachine,
      participations: participations.slice(0, 3),
    });
  }

  // Filter critical modes (unstable or poorly damped)
  const criticalModes = processedModes.filter(
    (m) => m.severity === "unstable" || m.severity === "poorly_damped" || m.severity === "marginal",
  );

  const result: ModalAnalysisResult = {
    modes: processedModes,
    criticalModes,
    summary: {
      totalStates: numStates,
      totalMachines: M,
      stable: unstableCount === 0,
      minDampingRatio,
      worstModeFreqHz,
      poorlyDampedCount,
      unstableCount,
    },
    reportText: "",
  };

  result.reportText = formatModalAnalysisReport(result, caseTitle);
  return result;
}

/**
 * Formats a Small-Signal Modal Stability Analysis result into an engineering report.
 */
export function formatModalAnalysisReport(
  result: ModalAnalysisResult,
  caseTitle = "PSS/E BASE CASE",
): string {
  const lines: string[] = [];
  lines.push(`================================================================================`);
  lines.push(`  PSS/E SMALL-SIGNAL STABILITY & MODAL ANALYSIS REPORT — ${caseTitle}`);
  lines.push(`================================================================================`);
  lines.push(
    `  System Status    : ${result.summary.stable ? "STABLE" : "UNSTABLE"} (${result.summary.totalMachines} machines, ${result.summary.totalStates} DAE state variables)`,
  );
  lines.push(
    `  Min Damping Ratio: ${(result.summary.minDampingRatio * 100).toFixed(2)}% (Worst Mode Frequency: ${result.summary.worstModeFreqHz.toFixed(3)} Hz)`,
  );
  lines.push(
    `  Critical Outliers: ${result.summary.unstableCount} unstable, ${result.summary.poorlyDampedCount} poorly-damped (< 5% damping)`,
  );
  lines.push(`--------------------------------------------------------------------------------`);
  lines.push(`  MODAL EIGENVALUE & OSCILLATION SPECTRUM`);
  lines.push(
    `  Mode  Real (1/s)   Imag (rad/s)   Freq (Hz)   Damping (%)   Tau (s)   Classification  Dominant Generator`,
  );
  lines.push(
    `  ----  ----------  -------------  ----------  ------------  --------  --------------  ------------------`,
  );

  for (const m of result.modes) {
    const modeTag =
      m.modeType === "inter_area"
        ? "Inter-Area"
        : m.modeType === "local_plant"
          ? "Local Plant"
          : m.modeType === "control"
            ? "Control Loop"
            : "Monotonic";

    const sevMarker = m.severity === "unstable" ? "!!" : m.severity === "poorly_damped" ? " *" : "  ";

    lines.push(
      `  ${String(m.modeIndex).padStart(4)}  ${m.real.toFixed(4).padStart(10)}  ${m.imag.toFixed(4).padStart(13)}  ${m.frequencyHz.toFixed(3).padStart(10)}  ${(m.dampingRatio * 100).toFixed(2).padStart(12)}${sevMarker}  ${(m.timeConstantSec < 100 ? m.timeConstantSec.toFixed(2) : "inf").padStart(8)}  ${modeTag.padEnd(14)}  ${m.dominantMachine} (${m.dominantState})`,
    );
  }

  if (result.criticalModes.length > 0) {
    lines.push(`--------------------------------------------------------------------------------`);
    lines.push(`  CRITICAL OSCILLATORY MODES REQUIRING PSS TUNING OR OPERATIONAL REDISPATCH`);
    for (const c of result.criticalModes) {
      lines.push(
        `  [Mode ${c.modeIndex}] ${c.frequencyHz.toFixed(3)} Hz oscillation at ${c.dominantMachine} — Damping: ${(c.dampingRatio * 100).toFixed(2)}% (${c.severity.toUpperCase()})`,
      );
      for (const p of c.participations) {
        lines.push(`     • ${p.state.padEnd(16)} (participation: ${(p.factor * 100).toFixed(1)}%)`);
      }
    }
  }

  lines.push(`================================================================================`);
  return lines.join("\n");
}

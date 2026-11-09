// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/pscad — SSR & SSCI Subsynchronous Frequency Scanning Engine
 *
 * Scans positive-sequence driving-point impedance Z(f) = R(f) + j*X(f) across a continuous
 * frequency spectrum (0.1 Hz to 200 Hz). Detects series resonance crossover points (X(f_res) = 0),
 * undamped negative resistance modes (R(f_res) < 0), and computes growth rates for
 * Subsynchronous Resonance (SSR) and Subsynchronous Control Interaction (SSCI) per IEEE Std 2800 / CIGRE TB 671.
 */

import type { EmtNetlist } from "../types.js";

export interface FrequencyScanOptions {
  /** Target bus ID at which small-signal driving-point impedance is measured. */
  busId: string;
  /** Start frequency in Hz (default: 1.0). */
  fMinHz?: number | undefined;
  /** Stop frequency in Hz (default: 150.0). */
  fMaxHz?: number | undefined;
  /** Frequency increment step in Hz (default: 1.0). */
  fStepHz?: number | undefined;
  /** Nominal grid frequency in Hz (default: 60.0). */
  nominalFrequencyHz?: number | undefined;
  /** Model inverter current controller Subsynchronous Control Interaction (SSCI) negative damping (default: true). */
  modelIbrControlInteraction?: boolean | undefined;
}

export interface ResonancePoint {
  frequencyHz: number;
  resistanceAtResonanceOhm: number;
  reactanceSlopeOhmPerHz: number;
  isUnstable: boolean;
  growthRatePerSec?: number | undefined;
}

export interface FrequencyScanResult {
  busId: string;
  frequenciesHz: number[];
  rOhm: number[];
  xOhm: number[];
  zMagOhm: number[];
  phaseDeg: number[];
  resonancePoints: ResonancePoint[];
  hasSsciRisk: boolean;
  minResistanceOhm: number;
  wallClockTimeMs: number;
}

/**
 * Executes a driving-point impedance frequency scan across the network.
 */
export function runFrequencyScan(netlist: EmtNetlist, options: FrequencyScanOptions): FrequencyScanResult {
  const t0 = performance.now();
  const fMin = options.fMinHz ?? 1.0;
  const fMax = options.fMaxHz ?? 150.0;
  const fStep = options.fStepHz ?? 1.0;
  const f0 = options.nominalFrequencyHz ?? netlist.nominalFrequencyHz ?? 60.0;
  const modelIbr = options.modelIbrControlInteraction ?? true;

  // Build bus index mapping
  const busList: string[] = [];
  const busIdxMap = new Map<string, number>();

  if (netlist.buses instanceof Map) {
    for (const [id] of netlist.buses) {
      busList.push(id);
      busIdxMap.set(id, busList.length - 1);
    }
  } else if (Array.isArray(netlist.buses)) {
    for (const b of netlist.buses as any[]) {
      const id = b.id ?? b;
      busList.push(id);
      busIdxMap.set(id, busList.length - 1);
    }
  }

  // Fallback: discover buses from branches/sources if buses array was empty
  if (busList.length === 0) {
    const discovered = new Set<string>();
    for (const br of (netlist.branches ?? []) as any[]) {
      if (br.fromBus && br.fromBus !== "0" && br.fromBus !== "GND") discovered.add(br.fromBus);
      if (br.toBus && br.toBus !== "0" && br.toBus !== "GND") discovered.add(br.toBus);
    }
    for (const s of netlist.sources ?? []) {
      if (s.bus && s.bus !== "0" && s.bus !== "GND") discovered.add(s.bus);
    }
    for (const b of discovered) {
      busList.push(b);
      busIdxMap.set(b, busList.length - 1);
    }
  }

  const n = busList.length;
  const targetIdx = busIdxMap.get(options.busId) ?? 0;

  const frequenciesHz: number[] = [];
  const rOhm: number[] = [];
  const xOhm: number[] = [];
  const zMagOhm: number[] = [];
  const phaseDeg: number[] = [];

  const numFreqs = Math.max(1, Math.floor((fMax - fMin) / fStep) + 1);

  for (let idx = 0; idx < numFreqs; idx++) {
    const f = fMin + idx * fStep;
    const omega = 2.0 * Math.PI * f;

    // Assemble complex nodal admittance matrix Y(omega) = G + jB
    const G = new Float64Array(n * n);
    const B = new Float64Array(n * n);

    const stampBranch = (i1: number, i2: number, gVal: number, bVal: number) => {
      if (i1 >= 0) {
        G[i1 * n + i1] = G[i1 * n + i1]! + gVal;
        B[i1 * n + i1] = B[i1 * n + i1]! + bVal;
      }
      if (i2 >= 0) {
        G[i2 * n + i2] = G[i2 * n + i2]! + gVal;
        B[i2 * n + i2] = B[i2 * n + i2]! + bVal;
      }
      if (i1 >= 0 && i2 >= 0) {
        G[i1 * n + i2] = G[i1 * n + i2]! - gVal;
        B[i1 * n + i2] = B[i1 * n + i2]! - bVal;
        G[i2 * n + i1] = G[i2 * n + i1]! - gVal;
        B[i2 * n + i1] = B[i2 * n + i1]! - bVal;
      }
    };

    // 1. Grid sources (Thevenin series resistance & inductance)
    for (const s of netlist.sources ?? []) {
      const bIdx = busIdxMap.get(s.bus);
      if (bIdx !== undefined) {
        const rSrc = s.rSourceOhm && s.rSourceOhm > 0 ? s.rSourceOhm : 0.5;
        const lSrc = (s.lSourceH && s.lSourceH > 0 ? s.lSourceH : (s as any).lSourceHenry) ?? 0.01;
        const zRe = rSrc;
        const zIm = omega * lSrc;
        const zMag2 = zRe * zRe + zIm * zIm;
        stampBranch(bIdx, -1, zRe / zMag2, -zIm / zMag2);
      }
    }

    // 2. Transmission lines and series R-L-C branches
    for (const br of (netlist.branches ?? []) as any[]) {
      if (br.kind === "switch" && br.status === "open") continue;
      const i1 = busIdxMap.get(br.fromBus ?? br.from ?? "") ?? -1;
      const i2 = busIdxMap.get(br.toBus ?? br.to ?? "") ?? -1;

      const r = br.rOhm ?? br.resistanceOhm ?? 0.1;
      const l = br.lHenry ?? br.inductanceH ?? 0.02;
      const c = br.cFarad ?? br.capacitanceF ?? 0.0;

      let zRe = r;
      let zIm = omega * l;
      if (c > 0) {
        zIm -= 1.0 / (omega * c); // Series capacitive compensation
      }

      const zMag2 = zRe * zRe + zIm * zIm;
      if (zMag2 > 1e-12) {
        stampBranch(i1, i2, zRe / zMag2, -zIm / zMag2);
      }

      // Shunt line charging capacitance
      const cShunt = br.shuntC ?? 0.0;
      if (cShunt > 0) {
        if (i1 >= 0) B[i1 * n + i1] = B[i1 * n + i1]! + 0.5 * omega * cShunt;
        if (i2 >= 0) B[i2 * n + i2] = B[i2 * n + i2]! + 0.5 * omega * cShunt;
      }
    }

    // 3. Transformers
    for (const tr of (netlist.transformers ?? []) as any[]) {
      const i1 = busIdxMap.get(tr.fromBus) ?? -1;
      const i2 = busIdxMap.get(tr.toBus) ?? -1;
      const r = tr.windingLossFraction ? tr.windingLossFraction * 10.0 : 0.05;
      const l = tr.leakageLHenry ? tr.leakageLHenry : (tr.leakageReactancePu ?? 0.1) * (100.0 / (2 * Math.PI * f0));
      const zRe = r;
      const zIm = omega * l;
      const zMag2 = zRe * zRe + zIm * zIm;
      if (zMag2 > 1e-12) {
        stampBranch(i1, i2, zRe / zMag2, -zIm / zMag2);
      }
    }

    // 5. Solve passive grid driving-point impedance Z_grid = V_target / I_inj = (Y^-1)_{target, target}
    const n2 = 2 * n;
    const M = new Float64Array(n2 * n2);
    const rhs = new Float64Array(n2);
    rhs[targetIdx] = 1.0; // 1 Amp active current injection

    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        M[r * n2 + c] = G[r * n + c]!;
        M[r * n2 + (c + n)] = -B[r * n + c]!;
        M[(r + n) * n2 + c] = B[r * n + c]!;
        M[(r + n) * n2 + (c + n)] = G[r * n + c]!;
      }
    }

    // Gaussian elimination with partial pivoting for dense 2N x 2N
    const sol = solveDenseLinearSystem(M, rhs, n2);
    let zGridRe = sol ? sol[targetIdx]! : 0.0;
    let zGridIm = sol ? sol[targetIdx + n]! : 0.0;

    // Add IBR controller interaction series impedance: Z_loop(f) = Z_grid(f) + Z_ibr(f)
    let zRe = zGridRe;
    let zIm = zGridIm;

    if (modelIbr && (netlist.fmuInstances ?? []).some((fmu: any) => busIdxMap.get(fmu.busId) === targetIdx)) {
      if (f < f0) {
        const deltaF = (f0 - f) / f0;
        const rIbr = -2.5 * deltaF * Math.exp(-Math.pow((f - 30.0) / 20.0, 2)) - 0.2;
        const xIbr = omega * 0.002;
        zRe += rIbr;
        zIm += xIbr;
      } else {
        zRe += 1.5;
        zIm += omega * 0.002;
      }
    }

    const zMag = Math.hypot(zRe, zIm);
    const zPhase = (Math.atan2(zIm, zRe) * 180.0) / Math.PI;

    frequenciesHz.push(Number(f.toFixed(1)));
    rOhm.push(Number(zRe.toFixed(3)));
    xOhm.push(Number(zIm.toFixed(3)));
    zMagOhm.push(Number(zMag.toFixed(3)));
    phaseDeg.push(Number(zPhase.toFixed(2)));
  }

  // 6. Detect series resonance crossover points (X(f) = 0 with dX/df > 0)
  const resonancePoints: ResonancePoint[] = [];
  let hasSsciRisk = false;
  let minResistance = Infinity;

  for (let i = 0; i < rOhm.length; i++) {
    if (rOhm[i]! < minResistance) minResistance = rOhm[i]!;
  }

  for (let i = 0; i < frequenciesHz.length - 1; i++) {
    const x1 = xOhm[i]!;
    const x2 = xOhm[i + 1]!;
    const f1 = frequenciesHz[i]!;
    const f2 = frequenciesHz[i + 1]!;

    // Zero-crossing check: X1 <= 0 and X2 > 0 (series resonance point)
    if (x1 <= 0.0 && x2 > 0.0) {
      const alpha = -x1 / (x2 - x1);
      const fRes = f1 + alpha * (f2 - f1);
      const rRes = rOhm[i]! + alpha * (rOhm[i + 1]! - rOhm[i]!);
      const slope = (x2 - x1) / (f2 - f1);

      const isUnstable = rRes < 0.0;
      if (isUnstable) {
        hasSsciRisk = true;
      }

      // Approximate undamped growth rate sigma = -R / (2 * L_eq) where L_eq = (dX/df) / (4*pi)
      const lEq = Math.max(0.001, slope / (4.0 * Math.PI));
      const growthRate = isUnstable ? -rRes / (2.0 * lEq) : undefined;

      resonancePoints.push({
        frequencyHz: Number(fRes.toFixed(2)),
        resistanceAtResonanceOhm: Number(rRes.toFixed(3)),
        reactanceSlopeOhmPerHz: Number(slope.toFixed(2)),
        isUnstable,
        growthRatePerSec: growthRate ? Number(growthRate.toFixed(2)) : undefined,
      });
    }
  }

  const wallClockTimeMs = performance.now() - t0;

  return {
    busId: options.busId,
    frequenciesHz,
    rOhm,
    xOhm,
    zMagOhm,
    phaseDeg,
    resonancePoints,
    hasSsciRisk,
    minResistanceOhm: Number(minResistance.toFixed(3)),
    wallClockTimeMs: Number(wallClockTimeMs.toFixed(1)),
  };
}

/**
 * Solves dense linear system A * x = b via LU decomposition with partial pivoting.
 */
function solveDenseLinearSystem(A: Float64Array, b: Float64Array, n: number): Float64Array | null {
  const M = new Float64Array(A);
  const x = new Float64Array(b);
  const piv = new Int32Array(n);
  for (let i = 0; i < n; i++) piv[i] = i;

  for (let k = 0; k < n; k++) {
    // Find pivot
    let maxVal = Math.abs(M[k * n + k]!);
    let maxRow = k;
    for (let r = k + 1; r < n; r++) {
      const val = Math.abs(M[r * n + k]!);
      if (val > maxVal) {
        maxVal = val;
        maxRow = r;
      }
    }

    if (maxVal < 1e-14) {
      // Regularize slightly on diagonal to prevent zero-frequency singularity
      M[k * n + k] = 1e-6;
    }

    if (maxRow !== k) {
      // Swap rows
      for (let c = 0; c < n; c++) {
        const tmp = M[k * n + c]!;
        M[k * n + c] = M[maxRow * n + c]!;
        M[maxRow * n + c] = tmp;
      }
      const tmpB = x[k]!;
      x[k] = x[maxRow]!;
      x[maxRow] = tmpB;
      const tmpP = piv[k]!;
      piv[k] = piv[maxRow]!;
      piv[maxRow] = tmpP;
    }

    const diag = M[k * n + k]!;
    for (let r = k + 1; r < n; r++) {
      const factor = M[r * n + k]! / diag;
      M[r * n + k] = factor;
      for (let c = k + 1; c < n; c++) {
        M[r * n + c] = M[r * n + c]! - factor * M[k * n + c]!;
      }
      x[r] = x[r]! - factor * x[k]!;
    }
  }

  // Back substitution
  for (let i = n - 1; i >= 0; i--) {
    let sum = x[i]!;
    for (let j = i + 1; j < n; j++) {
      sum -= M[i * n + j]! * x[j]!;
    }
    const diag = M[i * n + i]!;
    x[i] = Math.abs(diag) > 1e-14 ? sum / diag : 0.0;
  }

  return x;
}

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
  /** Scan formulation: coupled sequence hyperbolic Y_1/Y_0 (default) or legacy single-phase positive sequence. */
  mode?: "three_phase_coupled" | "single_phase" | undefined;
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
  z0Ohm?: Array<{ r: number; x: number }> | undefined;
  resonancePoints: ResonancePoint[];
  hasSsciRisk: boolean;
  minResistanceOhm: number;
  wallClockTimeMs: number;
}

/**
 * Executes a driving-point impedance frequency scan across the network.
 */
export function runFrequencyScan(
  netlistInput: EmtNetlist | import("./emt-solver.js").EmtNetlistInput,
  options: FrequencyScanOptions,
): FrequencyScanResult {
  const netlist = netlistInput as EmtNetlist;
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
    for (const b of netlist.buses as Array<string | { id?: string }>) {
      const id = typeof b === "string" ? b : (b.id ?? String(b));
      busList.push(id);
      busIdxMap.set(id, busList.length - 1);
    }
  }

  // Fallback: discover buses from branches/sources if buses array was empty
  if (busList.length === 0) {
    const discovered = new Set<string>();
    for (const br of netlist.branches ?? []) {
      const brBus = br as unknown as { fromBus?: string; toBus?: string };
      if (brBus.fromBus && brBus.fromBus !== "0" && brBus.fromBus !== "GND") discovered.add(brBus.fromBus);
      if (brBus.toBus && brBus.toBus !== "0" && brBus.toBus !== "GND") discovered.add(brBus.toBus);
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
  const z0Ohm: Array<{ r: number; x: number }> = [];
  const useCoupledSeq = options.mode !== "single_phase";

  const numFreqs = Math.max(1, Math.floor((fMax - fMin) / fStep) + 1);

  for (let idx = 0; idx < numFreqs; idx++) {
    const f = fMin + idx * fStep;
    const omega = 2.0 * Math.PI * f;

    // Assemble positive-sequence G+jB and zero-sequence G0+jB0 nodal admittance matrices
    const G = new Float64Array(n * n);
    const B = new Float64Array(n * n);
    const G0 = useCoupledSeq ? new Float64Array(n * n) : null;
    const B0 = useCoupledSeq ? new Float64Array(n * n) : null;

    const stampMatrix = (
      MatG: Float64Array,
      MatB: Float64Array,
      i1: number,
      i2: number,
      gVal: number,
      bVal: number,
    ) => {
      if (i1 >= 0) {
        MatG[i1 * n + i1] = MatG[i1 * n + i1]! + gVal;
        MatB[i1 * n + i1] = MatB[i1 * n + i1]! + bVal;
      }
      if (i2 >= 0) {
        MatG[i2 * n + i2] = MatG[i2 * n + i2]! + gVal;
        MatB[i2 * n + i2] = MatB[i2 * n + i2]! + bVal;
      }
      if (i1 >= 0 && i2 >= 0) {
        MatG[i1 * n + i2] = MatG[i1 * n + i2]! - gVal;
        MatB[i1 * n + i2] = MatB[i1 * n + i2]! - bVal;
        MatG[i2 * n + i1] = MatG[i2 * n + i1]! - gVal;
        MatB[i2 * n + i1] = MatB[i2 * n + i1]! - bVal;
      }
    };

    const stampBranch = (i1: number, i2: number, gVal: number, bVal: number) => {
      stampMatrix(G, B, i1, i2, gVal, bVal);
      if (G0 && B0) stampMatrix(G0, B0, i1, i2, gVal, bVal);
    };

    // 1. Grid sources (Thevenin series resistance & inductance)
    for (const s of netlist.sources ?? []) {
      const bIdx = busIdxMap.get(s.bus);
      if (bIdx !== undefined) {
        const rSrc = s.rSourceOhm && s.rSourceOhm > 0 ? s.rSourceOhm : 0.5;
        const sExt = s as unknown as { lSourceHenry?: number };
        const lSrc = (s.lSourceH && s.lSourceH > 0 ? s.lSourceH : sExt.lSourceHenry) ?? 0.01;
        const zRe = rSrc;
        const zIm = omega * lSrc;
        const zMag2 = zRe * zRe + zIm * zIm;
        stampBranch(bIdx, -1, zRe / zMag2, -zIm / zMag2);
      }
    }

    // 2. Series/shunt R-L-C branches
    for (const br of netlist.branches ?? []) {
      const brExt = br as unknown as {
        kind?: string;
        status?: string;
        fromBus?: string;
        from?: string;
        toBus?: string;
        to?: string;
        rOhm?: number;
        resistanceOhm?: number;
        lHenry?: number;
        inductanceH?: number;
        cFarad?: number;
        capacitanceF?: number;
        shuntC?: number;
      };
      if (brExt.kind === "switch" && brExt.status === "open") continue;
      const i1 = busIdxMap.get(brExt.fromBus ?? brExt.from ?? "") ?? -1;
      const i2 = busIdxMap.get(brExt.toBus ?? brExt.to ?? "") ?? -1;

      const r = brExt.rOhm ?? brExt.resistanceOhm ?? 0.1;
      const l = brExt.lHenry ?? brExt.inductanceH ?? 0.02;
      const c = brExt.cFarad ?? brExt.capacitanceF ?? 0.0;

      const zRe = r;
      let zIm = omega * l;
      if (c > 0) {
        zIm -= 1.0 / (omega * c); // Series capacitive compensation
      }

      const zMag2 = zRe * zRe + zIm * zIm;
      if (zMag2 > 1e-12) {
        stampBranch(i1, i2, zRe / zMag2, -zIm / zMag2);
      }

      const cShunt = brExt.shuntC ?? 0.0;
      if (cShunt > 0) {
        if (i1 >= 0) B[i1 * n + i1] = B[i1 * n + i1]! + 0.5 * omega * cShunt;
        if (i2 >= 0) B[i2 * n + i2] = B[i2 * n + i2]! + 0.5 * omega * cShunt;
        if (B0) {
          if (i1 >= 0) B0[i1 * n + i1] = B0[i1 * n + i1]! + 0.5 * omega * cShunt;
          if (i2 >= 0) B0[i2 * n + i2] = B0[i2 * n + i2]! + 0.5 * omega * cShunt;
        }
      }
    }

    // 3. Transformers (sequence-aware: Yg-D grounds primary Z0 and isolates secondary Z0)
    for (const tr of netlist.transformers ?? []) {
      const trExt = tr as unknown as {
        fromBus: string;
        toBus: string;
        primaryKv?: number;
        secondaryKv?: number;
        windingLossFraction?: number;
        leakageLHenry?: number;
        leakageReactancePu?: number;
        windingConnection?: "Yg-Yg" | "Yg-D" | "D-Yg" | "D-D";
      };
      const i1 = busIdxMap.get(trExt.fromBus) ?? -1;
      const i2 = busIdxMap.get(trExt.toBus) ?? -1;
      const r = trExt.windingLossFraction ? trExt.windingLossFraction * 10.0 : 0.05;
      const l = trExt.leakageLHenry
        ? trExt.leakageLHenry
        : (trExt.leakageReactancePu ?? 0.1) * (100.0 / (2 * Math.PI * f0));
      const zRe = r;
      const zIm = omega * l;
      const zMag2 = zRe * zRe + zIm * zIm;
      if (zMag2 > 1e-12) {
        const gY = zRe / zMag2;
        const bY = -zIm / zMag2;
        stampMatrix(G, B, i1, i2, gY, bY);
        if (G0 && B0) {
          const conn = trExt.windingConnection ?? "Yg-Yg";
          if (conn === "Yg-Yg") {
            stampMatrix(G0, B0, i1, i2, gY, bY);
          } else if (conn === "Yg-D" && i1 >= 0) {
            stampMatrix(G0, B0, i1, -1, gY, bY);
          } else if (conn === "D-Yg" && i2 >= 0) {
            stampMatrix(G0, B0, -1, i2, gY, bY);
          }
        }
      }
    }

    // 4. Transmission lines (exact distributed-parameter hyperbolic long-line Y_1 and Y_0)
    for (const ln of netlist.transmissionLines ?? []) {
      const i1 = busIdxMap.get(ln.fromBus) ?? -1;
      const i2 = busIdxMap.get(ln.toBus) ?? -1;
      const len = Math.max(0.1, ln.lengthKm || 100);
      const r1Km = ln.rPerKm || 0.05;
      const l1Km = ln.lPerKm || 1e-3;
      const c1Km = ln.cPerKm || 1e-8;
      const pi1 = computeHyperbolicLinePi(r1Km, l1Km, c1Km, len, omega);
      stampMatrix(G, B, i1, i2, pi1.gSer, pi1.bSer);
      if (i1 >= 0) {
        G[i1 * n + i1] = G[i1 * n + i1]! + pi1.gShHalf;
        B[i1 * n + i1] = B[i1 * n + i1]! + pi1.bShHalf;
      }
      if (i2 >= 0) {
        G[i2 * n + i2] = G[i2 * n + i2]! + pi1.gShHalf;
        B[i2 * n + i2] = B[i2 * n + i2]! + pi1.bShHalf;
      }

      if (G0 && B0) {
        const r0Km = ln.r0PerKm ?? 3.2 * r1Km;
        const l0Km = ln.l0PerKm ?? 3.0 * l1Km;
        const c0Km = ln.c0PerKm ?? 0.65 * c1Km;
        const pi0 = computeHyperbolicLinePi(r0Km, l0Km, c0Km, len, omega);
        stampMatrix(G0, B0, i1, i2, pi0.gSer, pi0.bSer);
        if (i1 >= 0) {
          G0[i1 * n + i1] = G0[i1 * n + i1]! + pi0.gShHalf;
          B0[i1 * n + i1] = B0[i1 * n + i1]! + pi0.bShHalf;
        }
        if (i2 >= 0) {
          G0[i2 * n + i2] = G0[i2 * n + i2]! + pi0.gShHalf;
          B0[i2 * n + i2] = B0[i2 * n + i2]! + pi0.bShHalf;
        }
      }
    }

    // 4b. Synchronous machine subtransient admittances
    for (const sm of netlist.synchronousMachines ?? []) {
      const bIdx = busIdxMap.get(sm.bus);
      if (bIdx === undefined) continue;
      const zBase = (sm.ratedKvLL * sm.ratedKvLL) / Math.max(1.0, sm.ratedMva);
      const lSub = ((sm.xdSub ?? sm.xdPrime ?? 0.2) * zBase) / (2 * Math.PI * f0);
      const rA = 0.01 * zBase;
      const zRe = rA;
      const zIm = omega * lSub;
      const zMag2 = zRe * zRe + zIm * zIm;
      if (zMag2 > 1e-12) {
        G[bIdx * n + bIdx] = G[bIdx * n + bIdx]! + zRe / zMag2;
        B[bIdx * n + bIdx] = B[bIdx * n + bIdx]! - zIm / zMag2;
        if (G0 && B0) {
          G0[bIdx * n + bIdx] = G0[bIdx * n + bIdx]! + zRe / zMag2;
          B0[bIdx * n + bIdx] = B0[bIdx * n + bIdx]! - zIm / zMag2;
        }
      }
    }

    // 5. Solve coupled sequence nodal driving-point impedance Z_grid = (Y^-1)_{target, target}
    const solveZTarget = (MatG: Float64Array, MatB: Float64Array): [number, number] => {
      const n2 = 2 * n;
      const M = new Float64Array(n2 * n2);
      const rhs = new Float64Array(n2);
      rhs[targetIdx] = 1.0;
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
          M[r * n2 + c] = MatG[r * n + c]!;
          M[r * n2 + (c + n)] = -MatB[r * n + c]!;
          M[(r + n) * n2 + c] = MatB[r * n + c]!;
          M[(r + n) * n2 + (c + n)] = MatG[r * n + c]!;
        }
      }
      const sol = solveDenseLinearSystem(M, rhs, n2);
      return sol ? [sol[targetIdx]!, sol[targetIdx + n]!] : [0.0, 0.0];
    };

    const [zGridRe, zGridIm] = solveZTarget(G, B);
    if (G0 && B0) {
      // Ensure zero-sequence has small grounding bleed if fully delta-isolated
      for (let i = 0; i < n; i++) G0[i * n + i] = G0[i * n + i]! + 1e-6;
      const [z0Re, z0Im] = solveZTarget(G0, B0);
      z0Ohm.push({ r: Number(z0Re.toFixed(3)), x: Number(z0Im.toFixed(3)) });
    }

    // Add linearized IBR PLL + inner-current-control dq/sequence impedance Z_ibr(omega)
    let zRe = zGridRe;
    let zIm = zGridIm;

    const matchingFmu = (netlist.fmuInstances ?? []).find(
      (fmu) => busIdxMap.get(fmu.busConnection || (fmu as unknown as { busId?: string }).busId || "") === targetIdx,
    );
    const matchingConv = (netlist.converterBridges ?? []).find((c) => busIdxMap.get(c.acBus) === targetIdx);
    if (modelIbr && (matchingFmu || matchingConv)) {
      const mva = matchingFmu?.ratedMva ?? matchingConv?.ratedMva ?? 100.0;
      const kv = matchingFmu?.ratedKv ?? matchingConv?.ratedKvLL ?? 230.0;
      const zBase = (kv * kv) / Math.max(1.0, mva);
      const omega0 = 2.0 * Math.PI * f0;
      const lChoke = (0.012 * zBase) / omega0;
      // Linearized current-loop PI + PLL phase-tracking negative conductance region below f0:
      // Below synchronous frequency, PLL tracking lag + feed-forward yields negative damping resistance
      const wSlip = omega - omega0;
      const tauPll = 0.015;
      const kPll = 0.05 * zBase;
      const denomPll = 1.0 + (wSlip * tauPll) ** 2;
      const rCtrl = wSlip < 0 ? (-kPll * Math.abs(wSlip) * tauPll) / denomPll : 0.006 * zBase;
      zRe += 0.002 * zBase + rCtrl;
      zIm += omega * lChoke;
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
    ...(useCoupledSeq ? { z0Ohm } : {}),
    resonancePoints,
    hasSsciRisk,
    minResistanceOhm: Number(minResistance.toFixed(3)),
    wallClockTimeMs: Number(wallClockTimeMs.toFixed(1)),
  };
}

/**
 * Exact distributed-parameter hyperbolic pi-equivalent for a uniform transmission line:
 * Y_ser = 1 / (Z_c * sinh(gamma * l)), Y_sh/2 = tanh(gamma * l / 2) / Z_c.
 */
function computeHyperbolicLinePi(
  rKm: number,
  lKm: number,
  cKm: number,
  lenKm: number,
  omega: number,
): { gSer: number; bSer: number; gShHalf: number; bShHalf: number } {
  const zRe = Math.max(1e-9, rKm);
  const zIm = omega * Math.max(1e-12, lKm);
  const yIm = omega * Math.max(1e-14, cKm);

  // gamma * l = sqrt((zRe + j*zIm) * (0 + j*yIm)) * lenKm
  const zyRe = -zIm * yIm;
  const zyIm = zRe * yIm;
  const zyMag = Math.hypot(zyRe, zyIm);
  const zyAng = Math.atan2(zyIm, zyRe);
  const gammaMag = Math.sqrt(zyMag);
  const gr = gammaMag * Math.cos(0.5 * zyAng) * lenKm;
  const gi = gammaMag * Math.sin(0.5 * zyAng) * lenKm;

  // Zc = sqrt((zRe + j*zIm) / (j*yIm)) = sqrt(l/c - j*r/(omega*c))
  const qRe = zIm / yIm;
  const qIm = -zRe / yIm;
  const qMag = Math.hypot(qRe, qIm);
  const qAng = Math.atan2(qIm, qRe);
  const zcRe = Math.sqrt(qMag) * Math.cos(0.5 * qAng);
  const zcIm = Math.sqrt(qMag) * Math.sin(0.5 * qAng);

  // sinh(gr + j*gi) = sinh(gr)cos(gi) + j*cosh(gr)sin(gi)
  const grClamp = Math.min(20.0, gr);
  const shRe = Math.sinh(grClamp) * Math.cos(gi);
  const shIm = Math.cosh(grClamp) * Math.sin(gi);
  const denSerRe = zcRe * shRe - zcIm * shIm;
  const denSerIm = zcRe * shIm + zcIm * shRe;
  const denSer2 = Math.max(1e-12, denSerRe * denSerRe + denSerIm * denSerIm);
  const gSer = denSerRe / denSer2;
  const bSer = -denSerIm / denSer2;

  // tanh((gr + j*gi)/2) = (sinh(gr) + j*sin(gi)) / (cosh(gr) + cos(gi))
  const thDen = Math.max(1e-12, Math.cosh(grClamp) + Math.cos(gi));
  const thRe = Math.sinh(grClamp) / thDen;
  const thIm = Math.sin(gi) / thDen;
  const zc2 = Math.max(1e-12, zcRe * zcRe + zcIm * zcIm);
  // th / zc = (thRe + j*thIm) * (zcRe - j*zcIm) / zc2
  const gShHalf = (thRe * zcRe + thIm * zcIm) / zc2;
  const bShHalf = (thIm * zcRe - thRe * zcIm) / zc2;

  return { gSer, bSer, gShHalf, bShHalf };
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

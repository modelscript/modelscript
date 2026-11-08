// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Automated EMT-TS Dynamic Hybrid Co-Simulation Coordinator.
 *
 * Unifies positive-sequence electro-mechanical Transient Stability (TS) simulation
 * (millisecond macro-steps Delta t_TS = 1-5 ms) with 3-phase phase-domain
 * Electromagnetic Transient (EMT) companion simulation (microsecond sub-steps
 * Delta t_EMT = 10-50 us) via in-arena WebAssembly sliding-window fundamental DFT
 * and dynamic driving-point Norton equivalent tracking.
 */

import { WasmEmtBridge, type WasmEmtHybridBoundarySequencePhasors } from "./wasm-emt-bridge.js";

export interface TsBusSpec {
  busNumber: number;
  name?: string | undefined;
  baseKv: number;
  vMagPu?: number | undefined;
  vAngleDeg?: number | undefined;
  pLoadMw?: number | undefined;
  qLoadMvar?: number | undefined;
}

export interface TsBranchSpec {
  fromBus: number;
  toBus: number;
  rPu: number;
  xPu: number;
  bTotalPu?: number | undefined;
}

export interface TsGeneratorSpec {
  id: string;
  busNumber: number;
  sBaseMva?: number | undefined;
  pGenMw: number;
  qGenMvar?: number | undefined;
  hInertiaSec: number;
  dampingPu: number;
  xdPrimePu: number;
  raPu?: number | undefined;
}

export interface HybridBoundaryPortConfig {
  id: string;
  tsBusNumber: number;
  emtNodeA: number;
  emtNodeB: number;
  emtNodeC: number;
  baseKvLL: number;
  /** Optional explicit per-phase Norton conductance override in Siemens. */
  gTheveninOverrideSiemens?: number | undefined;
}

export interface HybridEmtTsOptions {
  dtEmtSec: number; // e.g. 20e-6 s (20 us)
  dtTsSec: number; // e.g. 1e-3 s (1 ms)
  durationSec: number;
  nominalFrequencyHz?: number | undefined; // default: 60 Hz
  sBaseMva?: number | undefined; // default: 100 MVA
  handshakingMode?: "norton_current" | "adaptive_pq_norton" | undefined;
  /** Positive-sequence voltage sag/swell threshold (pu) that triggers fault-mode Norton freeze (default: 0.15 pu). */
  faultVoltageThresholdPu?: number | undefined;
}

export interface HybridMacroStepRecord {
  timeSec: number;
  boundaryId: string;
  v1TsPu: number;
  v1AngleTsDeg: number;
  v1EmtPu: number;
  v2EmtPu: number;
  v0EmtPu: number;
  p1BoundaryMw: number;
  q1BoundaryMvar: number;
  faultModeActive: boolean;
  rotorAnglesDeg: Record<string, number>;
  rotorSpeedsPu: Record<string, number>;
}

export interface HybridEmtTsResult {
  macroHistory: HybridMacroStepRecord[];
  totalMacroSteps: number;
  totalEmtSubSteps: number;
  faultModeStepCount: number;
  wallClockTimeMs: number;
}

interface InternalGeneratorState {
  spec: TsGeneratorSpec;
  busIdx: number;
  deltaRad: number;
  omegaPu: number;
  ePrimeMagPu: number;
  pmPu: number;
  yGenG: number;
  yGenB: number;
}

interface InternalBoundaryState {
  config: HybridBoundaryPortConfig;
  tsBusIdx: number;
  wasmBndIdx: number;
  vBasePeakLnVolts: number;
  iBasePeakAmp: number;
  gThevSiemens: number;
  gEqPu: number;
  bEqPu: number;
  v1PreFaultPu: number;
  faultModeActive: boolean;
  lastPhasors: WasmEmtHybridBoundarySequencePhasors;
}

/**
 * Solves a dense complex linear system `A * x = b` of dimension `N` using Gaussian elimination
 * with partial pivoting. `aRe` and `aIm` are `N x N` row-major arrays.
 */
function solveComplexLinearSystem(
  n: number,
  aRe: Float64Array,
  aIm: Float64Array,
  bRe: Float64Array,
  bIm: Float64Array,
): { xRe: Float64Array; xIm: Float64Array } {
  const mRe = new Float64Array(aRe);
  const mIm = new Float64Array(aIm);
  const rhsRe = new Float64Array(bRe);
  const rhsIm = new Float64Array(bIm);

  for (let k = 0; k < n; k++) {
    // Partial pivoting
    let pivRow = k;
    let maxMag = Math.hypot(mRe[k * n + k]!, mIm[k * n + k]!);
    for (let i = k + 1; i < n; i++) {
      const mag = Math.hypot(mRe[i * n + k]!, mIm[i * n + k]!);
      if (mag > maxMag) {
        maxMag = mag;
        pivRow = i;
      }
    }
    if (pivRow !== k) {
      for (let j = k; j < n; j++) {
        const tmpR = mRe[k * n + j]!;
        const tmpI = mIm[k * n + j]!;
        mRe[k * n + j] = mRe[pivRow * n + j]!;
        mIm[k * n + j] = mIm[pivRow * n + j]!;
        mRe[pivRow * n + j] = tmpR;
        mIm[pivRow * n + j] = tmpI;
      }
      const tr = rhsRe[k]!;
      const ti = rhsIm[k]!;
      rhsRe[k] = rhsRe[pivRow]!;
      rhsIm[k] = rhsIm[pivRow]!;
      rhsRe[pivRow] = tr;
      rhsIm[pivRow] = ti;
    }

    const pR = mRe[k * n + k]!;
    const pI = mIm[k * n + k]!;
    const denom = Math.max(1e-18, pR * pR + pI * pI);

    for (let i = k + 1; i < n; i++) {
      const cR = mRe[i * n + k]!;
      const cI = mIm[i * n + k]!;
      if (cR === 0 && cI === 0) continue;
      // factor = c / p
      const fR = (cR * pR + cI * pI) / denom;
      const fI = (cI * pR - cR * pI) / denom;
      mRe[i * n + k] = 0;
      mIm[i * n + k] = 0;
      for (let j = k + 1; j < n; j++) {
        const kjR = mRe[k * n + j]!;
        const kjI = mIm[k * n + j]!;
        mRe[i * n + j] = mRe[i * n + j]! - (fR * kjR - fI * kjI);
        mIm[i * n + j] = mIm[i * n + j]! - (fR * kjI + fI * kjR);
      }
      const rkR = rhsRe[k]!;
      const rkI = rhsIm[k]!;
      rhsRe[i] = rhsRe[i]! - (fR * rkR - fI * rkI);
      rhsIm[i] = rhsIm[i]! - (fR * rkI + fI * rkR);
    }
  }

  const xRe = new Float64Array(n);
  const xIm = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let sumR = rhsRe[i]!;
    let sumI = rhsIm[i]!;
    for (let j = i + 1; j < n; j++) {
      const aijR = mRe[i * n + j]!;
      const aijI = mIm[i * n + j]!;
      sumR -= aijR * xRe[j]! - aijI * xIm[j]!;
      sumI -= aijR * xIm[j]! + aijI * xRe[j]!;
    }
    const dR = mRe[i * n + i]!;
    const dI = mIm[i * n + i]!;
    const denom = Math.max(1e-18, dR * dR + dI * dI);
    xRe[i] = (sumR * dR + sumI * dI) / denom;
    xIm[i] = (sumI * dR - sumR * dI) / denom;
  }

  return { xRe, xIm };
}

export interface ResolvedHybridEmtTsOptions {
  dtEmtSec: number;
  dtTsSec: number;
  durationSec: number;
  nominalFrequencyHz: number;
  sBaseMva: number;
  handshakingMode: "norton_current" | "adaptive_pq_norton";
  faultVoltageThresholdPu: number;
}

/**
 * Coordinates dynamic EMT-TS hybrid simulation between a positive-sequence TS transmission
 * network and a 3-phase WebAssembly EMT companion solver.
 */
export class HybridEmtTsCoordinator {
  public readonly options: ResolvedHybridEmtTsOptions;
  public readonly subStepsPerMacro: number;
  private readonly buses: TsBusSpec[];
  private readonly busNumToIdx = new Map<number, number>();
  private readonly yBusRe: Float64Array;
  private readonly yBusIm: Float64Array;
  private readonly vBusRe: Float64Array;
  private readonly vBusIm: Float64Array;
  private readonly generators: InternalGeneratorState[] = [];
  private readonly boundaries: InternalBoundaryState[] = [];
  private readonly emtBridge: WasmEmtBridge;

  constructor(
    tsNetwork: {
      buses: TsBusSpec[];
      branches: TsBranchSpec[];
      generators: TsGeneratorSpec[];
      boundaries: HybridBoundaryPortConfig[];
    },
    emtBridge: WasmEmtBridge,
    options: HybridEmtTsOptions,
  ) {
    this.options = {
      dtEmtSec: options.dtEmtSec,
      dtTsSec: options.dtTsSec,
      durationSec: options.durationSec,
      nominalFrequencyHz: options.nominalFrequencyHz ?? 60.0,
      sBaseMva: options.sBaseMva ?? 100.0,
      handshakingMode: options.handshakingMode ?? "adaptive_pq_norton",
      faultVoltageThresholdPu: options.faultVoltageThresholdPu ?? 0.15,
    };
    this.subStepsPerMacro = Math.max(1, Math.round(this.options.dtTsSec / this.options.dtEmtSec));
    this.buses = tsNetwork.buses;
    this.emtBridge = emtBridge;

    const nBuses = this.buses.length;
    this.yBusRe = new Float64Array(nBuses * nBuses);
    this.yBusIm = new Float64Array(nBuses * nBuses);
    this.vBusRe = new Float64Array(nBuses);
    this.vBusIm = new Float64Array(nBuses);

    for (let i = 0; i < nBuses; i++) {
      const b = this.buses[i]!;
      this.busNumToIdx.set(b.busNumber, i);
      const vm = b.vMagPu ?? 1.0;
      const vaRad = ((b.vAngleDeg ?? 0.0) * Math.PI) / 180.0;
      this.vBusRe[i] = vm * Math.cos(vaRad);
      this.vBusIm[i] = vm * Math.sin(vaRad);

      // Stamp constant-impedance equivalent load at nominal voltage
      const pLoadPu = (b.pLoadMw ?? 0.0) / this.options.sBaseMva;
      const qLoadPu = (b.qLoadMvar ?? 0.0) / this.options.sBaseMva;
      const v2 = Math.max(0.25, vm * vm);
      this.yBusRe[i * nBuses + i] = (this.yBusRe[i * nBuses + i] ?? 0) + pLoadPu / v2;
      this.yBusIm[i * nBuses + i] = (this.yBusIm[i * nBuses + i] ?? 0) - qLoadPu / v2;
    }

    // Stamp transmission branches into Y_bus
    for (const br of tsNetwork.branches) {
      const i = this.busNumToIdx.get(br.fromBus);
      const j = this.busNumToIdx.get(br.toBus);
      if (i === undefined || j === undefined) continue;
      const r = br.rPu;
      const x = br.xPu;
      const denom = Math.max(1e-12, r * r + x * x);
      const g = r / denom;
      const b = -x / denom;
      const bShuntHalf = 0.5 * (br.bTotalPu ?? 0.0);

      this.yBusRe[i * nBuses + i] = (this.yBusRe[i * nBuses + i] ?? 0) + g;
      this.yBusIm[i * nBuses + i] = (this.yBusIm[i * nBuses + i] ?? 0) + b + bShuntHalf;
      this.yBusRe[j * nBuses + j] = (this.yBusRe[j * nBuses + j] ?? 0) + g;
      this.yBusIm[j * nBuses + j] = (this.yBusIm[j * nBuses + j] ?? 0) + b + bShuntHalf;

      this.yBusRe[i * nBuses + j] = (this.yBusRe[i * nBuses + j] ?? 0) - g;
      this.yBusIm[i * nBuses + j] = (this.yBusIm[i * nBuses + j] ?? 0) - b;
      this.yBusRe[j * nBuses + i] = (this.yBusRe[j * nBuses + i] ?? 0) - g;
      this.yBusIm[j * nBuses + i] = (this.yBusIm[j * nBuses + i] ?? 0) - b;
    }

    // Initialize synchronous generators and stamp transient admittances into Y_bus
    for (const gen of tsNetwork.generators) {
      const busIdx = this.busNumToIdx.get(gen.busNumber);
      if (busIdx === undefined) continue;
      const mBaseRatio = (gen.sBaseMva ?? this.options.sBaseMva) / this.options.sBaseMva;
      const ra = (gen.raPu ?? 0.002) / mBaseRatio;
      const xdp = Math.max(0.02, gen.xdPrimePu / mBaseRatio);
      const z2 = ra * ra + xdp * xdp;
      const yG = ra / z2;
      const yB = -xdp / z2;

      this.yBusRe[busIdx * nBuses + busIdx] = (this.yBusRe[busIdx * nBuses + busIdx] ?? 0) + yG;
      this.yBusIm[busIdx * nBuses + busIdx] = (this.yBusIm[busIdx * nBuses + busIdx] ?? 0) + yB;

      const vr = this.vBusRe[busIdx]!;
      const vi = this.vBusIm[busIdx]!;
      const vMag = Math.max(0.5, Math.hypot(vr, vi));
      const pPu = gen.pGenMw / this.options.sBaseMva;
      const qPu = (gen.qGenMvar ?? 0.0) / this.options.sBaseMva;
      // I_gen = (P - jQ) / conj(V)
      const iGenRe = (pPu * vr + qPu * vi) / (vMag * vMag);
      const iGenIm = (pPu * vi - qPu * vr) / (vMag * vMag);
      // E' = V + (ra + j*xd') * I_gen
      const eRe = vr + ra * iGenRe - xdp * iGenIm;
      const eIm = vi + ra * iGenIm + xdp * iGenRe;
      const ePrimeMagPu = Math.hypot(eRe, eIm);
      const deltaRad = Math.atan2(eIm, eRe);

      this.generators.push({
        spec: gen,
        busIdx,
        deltaRad,
        omegaPu: 1.0,
        ePrimeMagPu,
        pmPu: pPu,
        yGenG: yG,
        yGenB: yB,
      });
    }

    // Register hybrid boundaries and compute driving-point Norton admittances via column probing
    for (const bndCfg of tsNetwork.boundaries) {
      const tsBusIdx = this.busNumToIdx.get(bndCfg.tsBusNumber);
      if (tsBusIdx === undefined) {
        throw new Error(`Hybrid boundary TS bus ${bndCfg.tsBusNumber} not found in TS network`);
      }

      // Column probing on Y_bus: solve Y_bus * z_col = e_{tsBusIdx} to obtain Z_{th} = z_col[tsBusIdx]
      const eRe = new Float64Array(nBuses);
      const eIm = new Float64Array(nBuses);
      eRe[tsBusIdx] = 1.0;
      const { xRe: zColRe, xIm: zColIm } = solveComplexLinearSystem(nBuses, this.yBusRe, this.yBusIm, eRe, eIm);
      const zThRe = zColRe[tsBusIdx]!;
      const zThIm = zColIm[tsBusIdx]!;
      const zMag2 = Math.max(1e-9, zThRe * zThRe + zThIm * zThIm);
      const gEqPu = zThRe / zMag2;
      const bEqPu = -zThIm / zMag2;
      const yEqMagPu = Math.hypot(gEqPu, bEqPu);

      // Convert per-unit driving-point admittance to physical Siemens on the boundary base kV
      const zBaseOhm = (bndCfg.baseKvLL * bndCfg.baseKvLL) / this.options.sBaseMva;
      const gThevSiemens = bndCfg.gTheveninOverrideSiemens ?? Math.max(0.05, yEqMagPu / Math.max(1e-3, zBaseOhm));

      const vBasePeakLnVolts = (bndCfg.baseKvLL * 1000.0 * Math.SQRT2) / Math.sqrt(3.0);
      const iBasePeakAmp = (this.options.sBaseMva * 1e6 * Math.SQRT2) / (Math.sqrt(3.0) * bndCfg.baseKvLL * 1000.0);

      const wasmBndIdx = this.emtBridge.registerHybridBoundary(
        bndCfg.emtNodeA,
        bndCfg.emtNodeB,
        bndCfg.emtNodeC,
        gThevSiemens,
        this.options.nominalFrequencyHz,
      );

      const v1PreFaultPu = Math.hypot(this.vBusRe[tsBusIdx]!, this.vBusIm[tsBusIdx]!);

      this.boundaries.push({
        config: bndCfg,
        tsBusIdx,
        wasmBndIdx,
        vBasePeakLnVolts,
        iBasePeakAmp,
        gThevSiemens,
        gEqPu,
        bEqPu,
        v1PreFaultPu,
        faultModeActive: false,
        lastPhasors: {
          v1Re: v1PreFaultPu * vBasePeakLnVolts,
          v1Im: 0,
          v1PeakVolts: v1PreFaultPu * vBasePeakLnVolts,
          v1AngleRad: 0,
          v2Re: 0,
          v2Im: 0,
          v2PeakVolts: 0,
          v0Re: 0,
          v0Im: 0,
          v0PeakVolts: 0,
          i1Re: 0,
          i1Im: 0,
          i1PeakAmp: 0,
          i1AngleRad: 0,
          p1Mw: 0,
          q1Mvar: 0,
        },
      });
    }
  }

  /**
   * Executes the coupled EMT-TS hybrid simulation across the configured duration.
   */
  public run(): HybridEmtTsResult {
    const tStart = performance.now();
    const nBuses = this.buses.length;
    const totalMacroSteps = Math.max(1, Math.round(this.options.durationSec / this.options.dtTsSec));
    const omega0 = 2.0 * Math.PI * this.options.nominalFrequencyHz;
    const dtTs = this.options.dtTsSec;

    // Seed initial boundary Norton currents before building/factorizing EMT matrix
    for (const bnd of this.boundaries) {
      const vr = this.vBusRe[bnd.tsBusIdx]!;
      const vi = this.vBusIm[bnd.tsBusIdx]!;
      const vMagPu = Math.hypot(vr, vi);
      const vAngRad = Math.atan2(vi, vr);
      const iNortonPeakAmp = vMagPu * bnd.vBasePeakLnVolts * bnd.gThevSiemens;
      this.emtBridge.updateBoundaryNorton(
        bnd.wasmBndIdx,
        iNortonPeakAmp,
        vAngRad,
        iNortonPeakAmp,
        vAngRad - (2.0 * Math.PI) / 3.0,
        iNortonPeakAmp,
        vAngRad + (2.0 * Math.PI) / 3.0,
        1,
      );
    }

    this.emtBridge.buildAndFactorize();

    const macroHistory: HybridMacroStepRecord[] = [];
    let faultModeStepCount = 0;

    for (let step = 0; step < totalMacroSteps; step++) {
      const currentTimeSec = step * dtTs;

      // 1. Assemble TS positive-sequence nodal current injections I_bus
      const iBusRe = new Float64Array(nBuses);
      const iBusIm = new Float64Array(nBuses);

      for (const gen of this.generators) {
        const eRe = gen.ePrimeMagPu * Math.cos(gen.deltaRad);
        const eIm = gen.ePrimeMagPu * Math.sin(gen.deltaRad);
        // I_norton_gen = (yGenG + j*yGenB) * (eRe + j*eIm)
        const injRe = gen.yGenG * eRe - gen.yGenB * eIm;
        const injIm = gen.yGenG * eIm + gen.yGenB * eRe;
        iBusRe[gen.busIdx] = (iBusRe[gen.busIdx] ?? 0) + injRe;
        iBusIm[gen.busIdx] = (iBusIm[gen.busIdx] ?? 0) + injIm;
      }

      // Couple EMT boundary sequence extraction back into TS nodal equations
      for (const bnd of this.boundaries) {
        if (step > 0) {
          const ph = bnd.lastPhasors;
          const v1EmtPu = ph.v1PeakVolts / bnd.vBasePeakLnVolts;
          const vSagPu = Math.abs(bnd.v1PreFaultPu - v1EmtPu);

          bnd.faultModeActive =
            this.options.handshakingMode === "norton_current" || vSagPu >= this.options.faultVoltageThresholdPu;

          if (bnd.faultModeActive) {
            faultModeStepCount++;
            // Direct positive-sequence current phasor withdrawal from TS bus into EMT zone
            const i1PuRe = ph.i1Re / bnd.iBasePeakAmp;
            const i1PuIm = ph.i1Im / bnd.iBasePeakAmp;
            iBusRe[bnd.tsBusIdx] = (iBusRe[bnd.tsBusIdx] ?? 0) - 0.15 * i1PuRe;
            iBusIm[bnd.tsBusIdx] = (iBusIm[bnd.tsBusIdx] ?? 0) - 0.15 * i1PuIm;
          } else {
            // Steady-state relaxed PQ injection coupling
            const vr = this.vBusRe[bnd.tsBusIdx]!;
            const vi = this.vBusIm[bnd.tsBusIdx]!;
            const v2 = Math.max(0.25, vr * vr + vi * vi);
            const pPu = ph.p1Mw / this.options.sBaseMva;
            const qPu = ph.q1Mvar / this.options.sBaseMva;
            iBusRe[bnd.tsBusIdx] = (iBusRe[bnd.tsBusIdx] ?? 0) - 0.1 * ((pPu * vr + qPu * vi) / v2);
            iBusIm[bnd.tsBusIdx] = (iBusIm[bnd.tsBusIdx] ?? 0) - 0.1 * ((pPu * vi - qPu * vr) / v2);
          }
        }
      }

      // 2. Solve positive-sequence TS network Y_bus * V_bus = I_bus
      const { xRe, xIm } = solveComplexLinearSystem(nBuses, this.yBusRe, this.yBusIm, iBusRe, iBusIm);
      for (let i = 0; i < nBuses; i++) {
        this.vBusRe[i] = xRe[i]!;
        this.vBusIm[i] = xIm[i]!;
      }

      // 3. Advance TS synchronous machine swing equations (trapezoidal step)
      const rotorAnglesDeg: Record<string, number> = {};
      const rotorSpeedsPu: Record<string, number> = {};
      for (const gen of this.generators) {
        const vr = this.vBusRe[gen.busIdx]!;
        const vi = this.vBusIm[gen.busIdx]!;
        const eRe = gen.ePrimeMagPu * Math.cos(gen.deltaRad);
        const eIm = gen.ePrimeMagPu * Math.sin(gen.deltaRad);
        const dRe = eRe - vr;
        const dIm = eIm - vi;
        const iGenRe = gen.yGenG * dRe - gen.yGenB * dIm;
        const iGenIm = gen.yGenG * dIm + gen.yGenB * dRe;
        const pePu = vr * iGenRe + vi * iGenIm;

        const dOmega =
          (gen.pmPu - pePu - gen.spec.dampingPu * (gen.omegaPu - 1.0)) / (2.0 * Math.max(0.5, gen.spec.hInertiaSec));
        const omegaNext = gen.omegaPu + dOmega * dtTs;
        gen.deltaRad += 0.5 * (gen.omegaPu + omegaNext - 2.0) * omega0 * dtTs;
        gen.omegaPu = omegaNext;

        rotorAnglesDeg[gen.spec.id] = (gen.deltaRad * 180.0) / Math.PI;
        rotorSpeedsPu[gen.spec.id] = gen.omegaPu;
      }

      // 4. Update 3-phase EMT boundary Norton equivalents and execute M fast sub-steps in WASM
      for (const bnd of this.boundaries) {
        const vr = this.vBusRe[bnd.tsBusIdx]!;
        const vi = this.vBusIm[bnd.tsBusIdx]!;
        const ph = bnd.lastPhasors;

        // Exact Norton boundary equivalent: I_N = G_Thev * V_TS + I_1_EMT
        const iNortonRe = bnd.gThevSiemens * (vr * bnd.vBasePeakLnVolts) + ph.i1Re;
        const iNortonIm = bnd.gThevSiemens * (vi * bnd.vBasePeakLnVolts) + ph.i1Im;
        const iNortonPeakAmp = Math.hypot(iNortonRe, iNortonIm);
        const iNortonAngRad = Math.atan2(iNortonIm, iNortonRe);

        this.emtBridge.updateBoundaryNorton(
          bnd.wasmBndIdx,
          iNortonPeakAmp,
          iNortonAngRad,
          iNortonPeakAmp,
          iNortonAngRad - (2.0 * Math.PI) / 3.0,
          iNortonPeakAmp,
          iNortonAngRad + (2.0 * Math.PI) / 3.0,
          this.subStepsPerMacro,
        );
      }

      this.emtBridge.runSteps(this.subStepsPerMacro);

      // 5. Read in-WASM sliding-window Fortescue sequence phasors and record snapshot
      for (const bnd of this.boundaries) {
        const ph = this.emtBridge.getBoundarySequencePhasors(bnd.wasmBndIdx);
        bnd.lastPhasors = ph;
        const vr = this.vBusRe[bnd.tsBusIdx]!;
        const vi = this.vBusIm[bnd.tsBusIdx]!;

        macroHistory.push({
          timeSec: currentTimeSec + dtTs,
          boundaryId: bnd.config.id,
          v1TsPu: Math.hypot(vr, vi),
          v1AngleTsDeg: (Math.atan2(vi, vr) * 180.0) / Math.PI,
          v1EmtPu: ph.v1PeakVolts / bnd.vBasePeakLnVolts,
          v2EmtPu: ph.v2PeakVolts / bnd.vBasePeakLnVolts,
          v0EmtPu: ph.v0PeakVolts / bnd.vBasePeakLnVolts,
          p1BoundaryMw: ph.p1Mw,
          q1BoundaryMvar: ph.q1Mvar,
          faultModeActive: bnd.faultModeActive,
          rotorAnglesDeg: { ...rotorAnglesDeg },
          rotorSpeedsPu: { ...rotorSpeedsPu },
        });
      }
    }

    return {
      macroHistory,
      totalMacroSteps,
      totalEmtSubSteps: totalMacroSteps * this.subStepsPerMacro,
      faultModeStepCount,
      wallClockTimeMs: performance.now() - tStart,
    };
  }
}

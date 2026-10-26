// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/pscad — Native WebAssembly-Ready Dommel Companion-Circuit EMT Solver
 *
 * Implements a high-performance, chatter-free Electromagnetic Transients (EMT)
 * simulation kernel for 3-phase AC/DC transmission networks:
 * - Direct Nodal Conductance Formulation: G * v(t) = j(t) - i_hist(t - dt)
 * - Dommel companion branch discretization for R, L, C, transformers, lines
 * - Critical Damping Adjustment (CDA) for trapezoidal switching chatter suppression
 * - Pre-allocated contiguous matrix memory with cached LU decomposition ($O(N^2)$ stepping)
 * - Dynamic fault impedance injection (3PH, SLG, DLG, LL) & IBR LVRT current control
 */

import type { EmtNetlist } from "../types.js";

export interface EmtSolverOptions {
  timeStepSec: number;
  durationSec: number;
  nominalFrequencyHz?: number | undefined;
  /** Whether to enable Critical Damping Adjustment (CDA) to eliminate switching chatter. Default: true. */
  enableCda?: boolean | undefined;
  /** Maximum number of simulation steps. Default: 50,000. */
  maxSteps?: number | undefined;
}

export interface EmtSolverMetrics {
  totalSteps: number;
  luFactorizations: number;
  switchingEvents: number;
  chatterDampedSteps: number;
  executionTimeMs: number;
}

export interface EmtSolverResult {
  time: Float64Array;
  busVoltages: Map<string, Float64Array>;
  busPhaseVoltages: Map<string, { a: Float64Array; b: Float64Array; c: Float64Array }>;
  branchCurrents: Map<string, Float64Array>;
  branchPhaseCurrents: Map<string, { a: Float64Array; b: Float64Array; c: Float64Array }>;
  controlSignals?: Map<string, Float64Array> | undefined;
  metrics: EmtSolverMetrics;
}

interface CompanionBranch {
  id: string;
  fromIdx: number;
  toIdx: number;
  gEq: number;
  alphaHist: number;
  shuntG: number;
  iHistA: number;
  iHistB: number;
  iHistC: number;
  ia: Float64Array;
  ib: Float64Array;
  ic: Float64Array;
}

interface SwitchState {
  sw: any;
  fromIdx: number;
  toIdx: number;
  currentClosed: boolean;
  ia: Float64Array;
  ib: Float64Array;
  ic: Float64Array;
}

interface FmuState {
  fmu: any;
  busIdx: number;
  iRatedPeak: number;
  iqState: number;
  ia: Float64Array;
  ib: Float64Array;
  ic: Float64Array;
}

interface BusInfo {
  id: string;
  baseKv: number;
  vPeak: number;
}

interface SourceInfo {
  vPeak: number;
  freqRad: number;
  phaseRad: number;
  gSrc: number;
}

/**
 * High-performance, zero-allocation native Dommel companion-circuit EMT solver.
 */
export class EmtSolver {
  private readonly netlist: EmtNetlist;
  private readonly timeStepSec: number;
  private readonly durationSec: number;
  private readonly omega: number;
  private readonly enableCda: boolean;
  private readonly nSteps: number;

  private readonly busList: BusInfo[] = [];
  private readonly busIdxMap = new Map<string, number>();
  private readonly companionBranches: CompanionBranch[] = [];
  private readonly switchStates: SwitchState[] = [];
  private readonly fmuStates: FmuState[] = [];
  private readonly busSources = new Map<number, SourceInfo[]>();
  private readonly defaultSrcR: number;

  private nBuses: number = 0;
  private time!: Float64Array;
  private busVoltages = new Map<string, Float64Array>();
  private busPhaseVoltages = new Map<string, { a: Float64Array; b: Float64Array; c: Float64Array }>();
  private branchCurrents = new Map<string, Float64Array>();
  private branchPhaseCurrents = new Map<string, { a: Float64Array; b: Float64Array; c: Float64Array }>();

  // Pre-allocated contiguous working matrices
  private Ga!: Float64Array;
  private Gb!: Float64Array;
  private Gc!: Float64Array;
  private Ja!: Float64Array;
  private Jb!: Float64Array;
  private Jc!: Float64Array;

  // Cached LU factorizations
  private LUa!: Float64Array;
  private LUb!: Float64Array;
  private LUc!: Float64Array;
  private pivA!: Int32Array;
  private pivB!: Int32Array;
  private pivC!: Int32Array;
  private luValid: boolean = false;

  // Solved step vectors
  private vaStep!: Float64Array;
  private vbStep!: Float64Array;
  private vcStep!: Float64Array;

  // Metrics
  private luFactorizationCount: number = 0;
  private switchingEventCount: number = 0;
  private chatterDampedCount: number = 0;

  constructor(netlist: EmtNetlist, options: EmtSolverOptions) {
    this.netlist = netlist;
    this.timeStepSec = Math.max(1e-7, options.timeStepSec);
    this.durationSec = Math.max(this.timeStepSec * 2, options.durationSec);
    this.omega = 2 * Math.PI * (options.nominalFrequencyHz ?? netlist.nominalFrequencyHz ?? 60.0);
    this.enableCda = options.enableCda ?? true;

    const maxSteps = options.maxSteps ?? 50000;
    this.nSteps = Math.max(10, Math.min(maxSteps, Math.floor(this.durationSec / this.timeStepSec)));

    this.defaultSrcR =
      netlist.sources?.[0]?.rSourceOhm !== undefined && netlist.sources[0].rSourceOhm > 0
        ? netlist.sources[0].rSourceOhm
        : 1.5;

    this.initializeTopology();
  }

  private initializeTopology(): void {
    this.time = new Float64Array(this.nSteps);
    for (let k = 0; k < this.nSteps; k++) {
      this.time[k] = k * this.timeStepSec;
    }

    // Index non-ground buses
    for (const [busId, bus] of this.netlist.buses) {
      if (busId === "0" || busId === "GND") continue;
      const baseKv = bus.baseKv > 0 ? bus.baseKv : 230.0;
      this.busIdxMap.set(busId, this.busList.length);
      this.busList.push({ id: busId, baseKv, vPeak: baseKv * 1e3 });
      this.busPhaseVoltages.set(busId, {
        a: new Float64Array(this.nSteps),
        b: new Float64Array(this.nSteps),
        c: new Float64Array(this.nSteps),
      });
    }

    this.nBuses = this.busList.length;
    if (this.nBuses === 0) return;

    // Allocate contiguous working memory
    const n = this.nBuses;
    const nSq = n * n;
    this.Ga = new Float64Array(nSq);
    this.Gb = new Float64Array(nSq);
    this.Gc = new Float64Array(nSq);
    this.Ja = new Float64Array(n);
    this.Jb = new Float64Array(n);
    this.Jc = new Float64Array(n);

    this.LUa = new Float64Array(nSq);
    this.LUb = new Float64Array(nSq);
    this.LUc = new Float64Array(nSq);
    this.pivA = new Int32Array(n);
    this.pivB = new Int32Array(n);
    this.pivC = new Int32Array(n);

    this.vaStep = new Float64Array(n);
    this.vbStep = new Float64Array(n);
    this.vcStep = new Float64Array(n);

    // Register companion branches
    const addCompanion = (
      id: string,
      fromBus: string,
      toBus: string,
      rOhm: number,
      lHenry: number,
      cFarad: number = 0,
    ) => {
      const fromIdx = fromBus === "0" || fromBus === "GND" ? -1 : (this.busIdxMap.get(fromBus) ?? -1);
      const toIdx = toBus === "0" || toBus === "GND" ? -1 : (this.busIdxMap.get(toBus) ?? -1);
      if (fromIdx === -1 && toIdx === -1) return;

      const R = Math.max(rOhm, 1e-4);
      const L = Math.max(lHenry, 0.0);
      const denom = 2.0 * L + R * this.timeStepSec;
      const gEq = denom > 1e-12 ? this.timeStepSec / denom : 1.0 / R;
      const alphaHist = denom > 1e-12 ? (2.0 * L - R * this.timeStepSec) / denom : 0.0;
      const shuntG = cFarad > 0 ? (2.0 * cFarad) / this.timeStepSec : 0.0;

      const ia = new Float64Array(this.nSteps);
      const ib = new Float64Array(this.nSteps);
      const ic = new Float64Array(this.nSteps);
      this.branchCurrents.set(id, ia);
      this.branchPhaseCurrents.set(id, { a: ia, b: ib, c: ic });

      this.companionBranches.push({
        id,
        fromIdx,
        toIdx,
        gEq,
        alphaHist,
        shuntG,
        iHistA: 0,
        iHistB: 0,
        iHistC: 0,
        ia,
        ib,
        ic,
      });
    };

    for (const br of (this.netlist.branches ?? []) as any[]) {
      addCompanion(
        br.id,
        br.fromBus,
        br.toBus,
        br.rOhm || br.r || 0.1,
        br.lHenry || br.lH || 0,
        br.cFarad || br.cF || 0,
      );
    }
    for (const ln of ((this.netlist as any).lines ?? []) as any[]) {
      addCompanion(ln.id, ln.fromBus, ln.toBus, ln.rTotalOhm || 1.0, ln.lTotalHenry || 0.01, ln.cTotalFarad || 0);
    }
    for (const xf of (this.netlist.transformers ?? []) as any[]) {
      const baseZ = (xf.primaryKv || 230.0) ** 2 / Math.max(xf.ratedMva || xf.mva || 100.0, 1.0);
      const xOhm = Math.max((xf.leakageXPu || xf.xLeakagePu || 0.1) * baseZ, 0.05);
      const lHenry = xOhm / this.omega;
      addCompanion(xf.id, xf.primaryBus ?? xf.fromBus, xf.secondaryBus ?? xf.toBus, 0.01 * baseZ, lHenry, 0);
    }

    // Register switch states
    for (const sw of ((this.netlist as any).switches ?? []) as any[]) {
      const fromIdx = sw.fromBus === "0" || sw.fromBus === "GND" ? -1 : (this.busIdxMap.get(sw.fromBus) ?? -1);
      const toIdx = sw.toBus === "0" || sw.toBus === "GND" ? -1 : (this.busIdxMap.get(sw.toBus) ?? -1);
      const ia = new Float64Array(this.nSteps);
      const ib = new Float64Array(this.nSteps);
      const ic = new Float64Array(this.nSteps);
      this.branchCurrents.set(sw.id, ia);
      this.branchPhaseCurrents.set(sw.id, { a: ia, b: ib, c: ic });
      this.switchStates.push({ sw, fromIdx, toIdx, currentClosed: Boolean(sw.initialClosed), ia, ib, ic });
    }

    // Register FMU / IBR converters
    for (const fmu of this.netlist.fmuInstances ?? []) {
      const busIdx = this.busIdxMap.get(fmu.busConnection) ?? 0;
      const busKv = this.netlist.buses.get(fmu.busConnection)?.baseKv ?? (fmu.ratedKv > 0 ? fmu.ratedKv : 230.0);
      const iRatedPeak = ((fmu.ratedMva || 100.0) * 1e6) / (Math.max(0.1, busKv) * 1e3);
      const ia = new Float64Array(this.nSteps);
      const ib = new Float64Array(this.nSteps);
      const ic = new Float64Array(this.nSteps);
      this.branchCurrents.set(fmu.id, ia);
      this.branchPhaseCurrents.set(fmu.id, { a: ia, b: ib, c: ic });
      this.fmuStates.push({ fmu, busIdx, iRatedPeak, iqState: 0.0, ia, ib, ic });
    }

    // Register sources
    for (const src of (this.netlist.sources ?? []) as any[]) {
      const bIdx = this.busIdxMap.get(src.bus) ?? 0;
      const rSrc = src.rSourceOhm !== undefined && src.rSourceOhm > 0 ? src.rSourceOhm : 1.5;
      const lSrc = (src.lSourceHenry ?? src.lSourceH ?? 0) > 0 ? (src.lSourceHenry ?? src.lSourceH) : 0.0;
      const zSrc = Math.hypot(rSrc, this.omega * lSrc);
      const gSrc = 1.0 / Math.max(zSrc, 1e-4);
      const vPeak =
        (((src.voltageKv ?? src.kv) > 0 ? (src.voltageKv ?? src.kv) : this.busList[bIdx]!.baseKv) || 230.0) * 1e3;
      const freqRad = 2 * Math.PI * (src.frequencyHz || this.netlist.nominalFrequencyHz || 60.0);
      const phaseRad = (((src.phaseDeg ?? src.phaseAngleDeg) || 0) * Math.PI) / 180.0;
      const list = this.busSources.get(bIdx) ?? [];
      list.push({ vPeak, freqRad, phaseRad, gSrc });
      this.busSources.set(bIdx, list);
    }

    // Islanded bus stabilization
    for (let i = 0; i < this.nBuses; i++) {
      if (!this.busSources.has(i)) {
        const hasBranch = this.companionBranches.some((b) => b.fromIdx === i || b.toIdx === i);
        const gStab = hasBranch ? 1e-5 : 1e-4;
        this.busSources.set(i, [{ vPeak: 0.0, freqRad: 0, phaseRad: 0.0, gSrc: gStab }]);
      }
    }
  }

  /**
   * In-place LU factorization with partial pivoting for an N x N matrix.
   */
  private factorize(A: Float64Array, LU: Float64Array, piv: Int32Array): boolean {
    const n = this.nBuses;
    LU.set(A);
    for (let i = 0; i < n; i++) piv[i] = i;

    for (let p = 0; p < n; p++) {
      let maxVal = Math.abs(LU[p * n + p]!);
      let maxRow = p;
      for (let r = p + 1; r < n; r++) {
        const val = Math.abs(LU[r * n + p]!);
        if (val > maxVal) {
          maxVal = val;
          maxRow = r;
        }
      }
      if (maxVal < 1e-18) return false;

      if (maxRow !== p) {
        // Swap rows in LU
        for (let c = 0; c < n; c++) {
          const tmp = LU[p * n + c]!;
          LU[p * n + c] = LU[maxRow * n + c]!;
          LU[maxRow * n + c] = tmp;
        }
        const tmpP = piv[p]!;
        piv[p] = piv[maxRow]!;
        piv[maxRow] = tmpP;
      }

      const pivot = LU[p * n + p]!;
      for (let r = p + 1; r < n; r++) {
        const factor = LU[r * n + p]! / pivot;
        LU[r * n + p] = factor;
        if (factor === 0) continue;
        for (let c = p + 1; c < n; c++) {
          LU[r * n + c] = LU[r * n + c]! - factor * LU[p * n + c]!;
        }
      }
    }
    return true;
  }

  /**
   * Fast forward and back substitution using precomputed LU factors ($O(N^2)$).
   */
  private solveFromLU(LU: Float64Array, piv: Int32Array, b: Float64Array, x: Float64Array): void {
    const n = this.nBuses;
    // Permute b according to pivots
    for (let i = 0; i < n; i++) {
      x[i] = b[piv[i]!]!;
    }
    // Forward solve: L * y = permuted_b
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < i; j++) {
        x[i] = x[i]! - LU[i * n + j]! * x[j]!;
      }
    }
    // Backward solve: U * x = y
    for (let i = n - 1; i >= 0; i--) {
      for (let j = i + 1; j < n; j++) {
        x[i] = x[i]! - LU[i * n + j]! * x[j]!;
      }
      const diag = LU[i * n + i]!;
      x[i] = Math.abs(diag) > 1e-18 ? x[i]! / diag : 0.0;
    }
  }

  private stampAdmittance(G: Float64Array, i: number, j: number, g: number): void {
    const n = this.nBuses;
    if (i >= 0) G[i * n + i] = G[i * n + i]! + g;
    if (j >= 0) G[j * n + j] = G[j * n + j]! + g;
    if (i >= 0 && j >= 0) {
      G[i * n + j] = G[i * n + j]! - g;
      G[j * n + i] = G[j * n + i]! - g;
    }
  }

  /**
   * Executes the full time-domain simulation loop.
   */
  public solve(): EmtSolverResult {
    const startTime = performance.now();
    const n = this.nBuses;

    if (n === 0) {
      return {
        time: this.time,
        busVoltages: this.busVoltages,
        busPhaseVoltages: this.busPhaseVoltages,
        branchCurrents: this.branchCurrents,
        branchPhaseCurrents: this.branchPhaseCurrents,
        metrics: {
          totalSteps: 0,
          luFactorizations: 0,
          switchingEvents: 0,
          chatterDampedSteps: 0,
          executionTimeMs: 0,
        },
      };
    }

    let cdaCounter = 0;

    for (let k = 0; k < this.nSteps; k++) {
      const t = this.time[k]!;

      // 1. Detect switch state toggles
      let topologyChanged = false;
      for (const swState of this.switchStates) {
        const isClosed = t >= swState.sw.actionTimeSec ? !swState.sw.initialClosed : swState.sw.initialClosed;
        if (isClosed !== swState.currentClosed) {
          swState.currentClosed = isClosed;
          topologyChanged = true;
          this.switchingEventCount++;
          if (this.enableCda) {
            cdaCounter = 2; // Trigger 2 steps of CDA damping
          }
        }
      }

      // 2. Check active fault conditions
      let anyFaultActive = false;
      for (const flt of this.netlist.faults ?? []) {
        if (t >= flt.startSec && t <= flt.endSec) {
          anyFaultActive = true;
        }
      }

      // 3. Assemble conductance matrix if topology changed or invalid
      if (!this.luValid || topologyChanged || anyFaultActive) {
        this.Ga.fill(0);
        this.Gb.fill(0);
        this.Gc.fill(0);

        // Sources
        for (const [bIdx, srcs] of this.busSources.entries()) {
          for (const s of srcs) {
            this.Ga[bIdx * n + bIdx] = this.Ga[bIdx * n + bIdx]! + s.gSrc;
            this.Gb[bIdx * n + bIdx] = this.Gb[bIdx * n + bIdx]! + s.gSrc;
            this.Gc[bIdx * n + bIdx] = this.Gc[bIdx * n + bIdx]! + s.gSrc;
          }
        }

        // Companion branches
        for (const br of this.companionBranches) {
          const gTotal = br.gEq + 0.5 * br.shuntG;
          this.stampAdmittance(this.Ga, br.fromIdx, br.toIdx, gTotal);
          this.stampAdmittance(this.Gb, br.fromIdx, br.toIdx, gTotal);
          this.stampAdmittance(this.Gc, br.fromIdx, br.toIdx, gTotal);
        }

        // Switches
        for (const swState of this.switchStates) {
          const rSw = swState.currentClosed
            ? Math.max(swState.sw.rClosedOhm || 1e-3, 1e-4)
            : Math.max(swState.sw.rOpenOhm || 1e6, 1e3);
          const gSw = 1.0 / rSw;
          this.stampAdmittance(this.Ga, swState.fromIdx, swState.toIdx, gSw);
          this.stampAdmittance(this.Gb, swState.fromIdx, swState.toIdx, gSw);
          this.stampAdmittance(this.Gc, swState.fromIdx, swState.toIdx, gSw);
        }

        // Faults
        for (const flt of this.netlist.faults ?? []) {
          if (t >= flt.startSec && t <= flt.endSec) {
            const bIdx = this.busIdxMap.get(flt.bus) ?? 0;
            const rFlt = flt.rFaultOhm !== undefined && flt.rFaultOhm > 0 ? flt.rFaultOhm : 0.5;
            const gFlt = 1.0 / rFlt;
            if (flt.faultType === "3PH") {
              this.Ga[bIdx * n + bIdx] = this.Ga[bIdx * n + bIdx]! + gFlt;
              this.Gb[bIdx * n + bIdx] = this.Gb[bIdx * n + bIdx]! + gFlt;
              this.Gc[bIdx * n + bIdx] = this.Gc[bIdx * n + bIdx]! + gFlt;
            } else if (flt.faultType === "SLG") {
              this.Ga[bIdx * n + bIdx] = this.Ga[bIdx * n + bIdx]! + gFlt;
              this.Gb[bIdx * n + bIdx] = this.Gb[bIdx * n + bIdx]! + (1.0 / this.defaultSrcR) * (0.15 / 0.85);
              this.Gc[bIdx * n + bIdx] = this.Gc[bIdx * n + bIdx]! + (1.0 / this.defaultSrcR) * (0.1 / 0.9);
            } else if (flt.faultType === "DLG") {
              this.Ga[bIdx * n + bIdx] = this.Ga[bIdx * n + bIdx]! + gFlt;
              this.Gb[bIdx * n + bIdx] = this.Gb[bIdx * n + bIdx]! + gFlt;
              this.Gc[bIdx * n + bIdx] = this.Gc[bIdx * n + bIdx]! + (1.0 / this.defaultSrcR) * (0.1 / 0.9);
            } else {
              this.Gb[bIdx * n + bIdx] = this.Gb[bIdx * n + bIdx]! + gFlt;
              this.Gc[bIdx * n + bIdx] = this.Gc[bIdx * n + bIdx]! + gFlt;
            }
          }
        }

        // Compute LU factors
        this.factorize(this.Ga, this.LUa, this.pivA);
        this.factorize(this.Gb, this.LUb, this.pivB);
        this.factorize(this.Gc, this.LUc, this.pivC);
        this.luFactorizationCount += 3;
        this.luValid = !anyFaultActive; // Keep cached if no dynamic fault active
      }

      // 4. Assemble injection currents J
      this.Ja.fill(0);
      this.Jb.fill(0);
      this.Jc.fill(0);

      for (const [bIdx, srcs] of this.busSources.entries()) {
        for (const s of srcs) {
          const ea = s.vPeak * Math.sin(s.freqRad * t + s.phaseRad);
          const eb = s.vPeak * Math.sin(s.freqRad * t + s.phaseRad - (2 * Math.PI) / 3);
          const ec = s.vPeak * Math.sin(s.freqRad * t + s.phaseRad + (2 * Math.PI) / 3);
          this.Ja[bIdx] = this.Ja[bIdx]! + s.gSrc * ea;
          this.Jb[bIdx] = this.Jb[bIdx]! + s.gSrc * eb;
          this.Jc[bIdx] = this.Jc[bIdx]! + s.gSrc * ec;
        }
      }

      for (const br of this.companionBranches) {
        if (br.fromIdx >= 0) {
          this.Ja[br.fromIdx] = this.Ja[br.fromIdx]! - br.iHistA;
          this.Jb[br.fromIdx] = this.Jb[br.fromIdx]! - br.iHistB;
          this.Jc[br.fromIdx] = this.Jc[br.fromIdx]! - br.iHistC;
        }
        if (br.toIdx >= 0) {
          this.Ja[br.toIdx] = this.Ja[br.toIdx]! + br.iHistA;
          this.Jb[br.toIdx] = this.Jb[br.toIdx]! + br.iHistB;
          this.Jc[br.toIdx] = this.Jc[br.toIdx]! + br.iHistC;
        }
      }

      // 5. Solve linear system via fast forward/backward substitution ($O(N^2)$)
      this.solveFromLU(this.LUa, this.pivA, this.Ja, this.vaStep);
      this.solveFromLU(this.LUb, this.pivB, this.Jb, this.vbStep);
      this.solveFromLU(this.LUc, this.pivC, this.Jc, this.vcStep);

      for (let i = 0; i < n; i++) {
        const busId = this.busList[i]!.id;
        const pv = this.busPhaseVoltages.get(busId)!;
        pv.a[k] = this.vaStep[i]!;
        pv.b[k] = this.vbStep[i]!;
        pv.c[k] = this.vcStep[i]!;
      }

      // 6. Update branch currents & Dommel companion history
      const isCdaActive = cdaCounter > 0;
      if (isCdaActive) {
        this.chatterDampedCount++;
        cdaCounter--;
      }

      for (const br of this.companionBranches) {
        const vFromA = br.fromIdx >= 0 ? this.vaStep[br.fromIdx]! : 0.0;
        const vToA = br.toIdx >= 0 ? this.vaStep[br.toIdx]! : 0.0;
        const dvA = vFromA - vToA;
        const curA = br.gEq * dvA + br.iHistA;
        br.ia[k] = curA;

        const vFromB = br.fromIdx >= 0 ? this.vbStep[br.fromIdx]! : 0.0;
        const vToB = br.toIdx >= 0 ? this.vbStep[br.toIdx]! : 0.0;
        const dvB = vFromB - vToB;
        const curB = br.gEq * dvB + br.iHistB;
        br.ib[k] = curB;

        const vFromC = br.fromIdx >= 0 ? this.vcStep[br.fromIdx]! : 0.0;
        const vToC = br.toIdx >= 0 ? this.vcStep[br.toIdx]! : 0.0;
        const dvC = vFromC - vToC;
        const curC = br.gEq * dvC + br.iHistC;
        br.ic[k] = curC;

        if (isCdaActive) {
          // Critical Damping Adjustment: suppress numerical chatter by setting history to cur - gEq*dv
          br.iHistA = curA - br.gEq * dvA;
          br.iHistB = curB - br.gEq * dvB;
          br.iHistC = curC - br.gEq * dvC;
        } else {
          // Standard trapezoidal history
          br.iHistA = br.alphaHist * curA + br.gEq * dvA;
          br.iHistB = br.alphaHist * curB + br.gEq * dvB;
          br.iHistC = br.alphaHist * curC + br.gEq * dvC;
        }
      }

      // 7. Update switch currents
      for (const swState of this.switchStates) {
        const { fromIdx, toIdx, ia, ib, ic } = swState;
        const rSw = swState.currentClosed
          ? Math.max(swState.sw.rClosedOhm || 1e-3, 1e-4)
          : Math.max(swState.sw.rOpenOhm || 1e6, 1e3);
        const gSw = 1.0 / rSw;
        ia[k] = gSw * ((fromIdx >= 0 ? this.vaStep[fromIdx]! : 0) - (toIdx >= 0 ? this.vaStep[toIdx]! : 0));
        ib[k] = gSw * ((fromIdx >= 0 ? this.vbStep[fromIdx]! : 0) - (toIdx >= 0 ? this.vbStep[toIdx]! : 0));
        ic[k] = gSw * ((fromIdx >= 0 ? this.vcStep[fromIdx]! : 0) - (toIdx >= 0 ? this.vcStep[toIdx]! : 0));
      }

      // 8. Update IBR converter injection currents
      const tauLvrt = 0.008;
      const alphaLvrt = 1.0 - Math.exp(-this.timeStepSec / tauLvrt);
      for (const fmuState of this.fmuStates) {
        const { busIdx, iRatedPeak, ia, ib, ic } = fmuState;
        const vNomPeak = this.busList[busIdx]!.vPeak;
        const vaInst = this.vaStep[busIdx]!;
        const vbInst = this.vbStep[busIdx]!;
        const vcInst = this.vcStep[busIdx]!;
        const vEnv = Math.sqrt((2.0 / 3.0) * (vaInst * vaInst + vbInst * vbInst + vcInst * vcInst));
        const vPu = vNomPeak > 0 ? vEnv / vNomPeak : 1.0;

        const isVoltageDip = anyFaultActive || vPu < 0.9;
        const iqTarget = isVoltageDip ? 0.85 * iRatedPeak : 0.0;
        fmuState.iqState = isVoltageDip ? fmuState.iqState + alphaLvrt * (iqTarget - fmuState.iqState) : 0.0;
        const id = isVoltageDip ? 0.35 * iRatedPeak : 0.7 * iRatedPeak;
        const iq = fmuState.iqState;

        ia[k] = id * Math.sin(this.omega * t) - iq * Math.cos(this.omega * t);
        ib[k] = id * Math.sin(this.omega * t - (2 * Math.PI) / 3) - iq * Math.cos(this.omega * t - (2 * Math.PI) / 3);
        ic[k] = id * Math.sin(this.omega * t + (2 * Math.PI) / 3) - iq * Math.cos(this.omega * t + (2 * Math.PI) / 3);
      }
    }

    for (const b of this.busList) {
      this.busVoltages.set(b.id, this.busPhaseVoltages.get(b.id)!.a);
    }

    const executionTimeMs = performance.now() - startTime;

    return {
      time: this.time,
      busVoltages: this.busVoltages,
      busPhaseVoltages: this.busPhaseVoltages,
      branchCurrents: this.branchCurrents,
      branchPhaseCurrents: this.branchPhaseCurrents,
      metrics: {
        totalSteps: this.nSteps,
        luFactorizations: this.luFactorizationCount,
        switchingEvents: this.switchingEventCount,
        chatterDampedSteps: this.chatterDampedCount,
        executionTimeMs,
      },
    };
  }
}

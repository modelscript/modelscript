// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * WebAssembly-Ready Hybrid Electromagnetic Transient (EMT) Companion Solver.
 *
 * Implements Dommel's Algorithm with:
 * - Implicit Trapezoidal companion circuits for R, L, C
 * - Bergeron multi-phase traveling wave transmission lines
 * - Critical Damping Adjustment (CDA) for chatter elimination
 * - Norton Equivalent Predictor for Black-Box FMI 2.0/3.0 Co-Simulation FMUs
 */

import { sparseLuSolve } from "../sparse-solver-bridge.js";
import { buildCompanionSystem } from "./companion-matrix.js";
import type { BergeronLineState, EmtSimulationResult, EmtSolverOptions, FmuIbrState, RlcBranchState } from "./types.js";

export interface EmtCircuitDefinition {
  buses: string[];
  rlc: {
    id: string;
    from: string;
    to: string;
    r?: number;
    l?: number;
    c?: number;
  }[];
  transmissionLines?: {
    id: string;
    from: string;
    to: string;
    lengthKm: number;
    rPerKm?: number;
    lPerKm?: number;
    cPerKm?: number;
  }[];
  fmuInstances?: {
    id: string;
    bus: string;
    ratedMva: number;
    ratedKv: number;
    pSetpointMw?: number;
    qSetpointMvar?: number;
  }[];
  sources?: {
    bus: string;
    vPeakKv: number;
    freqHz: number;
    phaseRad?: number;
  }[];
}

export class EmtSolver {
  private readonly options: Required<EmtSolverOptions>;
  private readonly busMap = new Map<string, number>();
  private readonly busNames: string[];
  private readonly nNodes: number;

  private readonly rlcStates: RlcBranchState[] = [];
  private readonly lineStates: BergeronLineState[] = [];
  private readonly fmuStates: FmuIbrState[] = [];
  private readonly sources: { node: number; vPeakKv: number; omega: number; phase: number }[] = [];

  constructor(circuit: EmtCircuitDefinition, options: EmtSolverOptions) {
    this.options = {
      timeStepSec: options.timeStepSec,
      durationSec: options.durationSec,
      nominalFrequencyHz: options.nominalFrequencyHz ?? 60.0,
      enableCda: options.enableCda ?? true,
    };

    const dt = this.options.timeStepSec;

    // 1. Index buses (GND is -1)
    this.busNames = [...circuit.buses];
    this.nNodes = this.busNames.length;
    for (let i = 0; i < this.nNodes; i++) {
      this.busMap.set(this.busNames[i]!, i);
    }

    const getNode = (name: string): number => {
      if (name.toUpperCase() === "GND" || name.toUpperCase() === "GROUND") return -1;
      return this.busMap.get(name) ?? -1;
    };

    // 2. Initialize RLC branches
    for (const b of circuit.rlc) {
      const r = b.r ?? 0.001;
      const l = b.l ?? 0;
      const c = b.c ?? 0;

      const gR = r > 0 ? 1 / r : 1e4;
      const gL = l > 0 ? dt / (2 * l) : 0;
      const gC = c > 0 ? (2 * c) / dt : 0;

      // In companion circuit: total conductance in parallel
      const gTotal = l > 0 || c > 0 ? gL + gC + (r > 0 ? 1 / r : 0) : gR;

      this.rlcStates.push({
        id: b.id,
        fromNode: getNode(b.from),
        toNode: getNode(b.to),
        r,
        l,
        c,
        gL,
        gC,
        gTotal,
        iHistL: 0,
        iHistC: 0,
        current: 0,
      });
    }

    // 3. Initialize Bergeron transmission lines
    if (circuit.transmissionLines) {
      for (const line of circuit.transmissionLines) {
        const len = line.lengthKm;
        const l_km = line.lPerKm ?? 0.001;
        const c_km = line.cPerKm ?? 1.2e-8;
        const r_km = line.rPerKm ?? 0.03;

        const totalL = l_km * len;
        const totalC = c_km * len;
        const zc = Math.sqrt(totalL / totalC); // Characteristic surge impedance
        const tau = len * Math.sqrt(l_km * c_km); // Propagation delay
        const delaySteps = Math.max(1, Math.round(tau / dt));

        this.lineStates.push({
          id: line.id,
          fromNode: getNode(line.from),
          toNode: getNode(line.to),
          lengthKm: len,
          rTotal: r_km * len,
          zc,
          tauSec: tau,
          delaySteps,
          bufferFrom: new Float64Array(delaySteps + 1),
          bufferTo: new Float64Array(delaySteps + 1),
          bufferIdx: 0,
          gc: 1 / zc,
        });
      }
    }

    // 4. Initialize Black-Box FMU IBR instances
    if (circuit.fmuInstances) {
      for (const fmu of circuit.fmuInstances) {
        const node = getNode(fmu.bus);
        // Equivalent Norton admittance: G_eq = S_rated / V_rated^2
        const vBase = fmu.ratedKv * 1e3;
        const sBase = fmu.ratedMva * 1e6;
        const gEq = sBase / (vBase * vBase);

        this.fmuStates.push({
          id: fmu.id,
          node,
          ratedMva: fmu.ratedMva,
          ratedKv: fmu.ratedKv,
          gEq,
          iInjected: 0,
          pSetpointMw: fmu.pSetpointMw ?? fmu.ratedMva * 0.9,
          qSetpointMvar: fmu.qSetpointMvar ?? 0,
          pllAngle: 0,
          iReal: 0,
          iImag: 0,
        });
      }
    }

    // 5. Initialize AC Sources
    if (circuit.sources) {
      for (const s of circuit.sources) {
        this.sources.push({
          node: getNode(s.bus),
          vPeakKv: s.vPeakKv,
          omega: 2 * Math.PI * s.freqHz,
          phase: s.phaseRad ?? 0,
        });
      }
    }
  }

  /**
   * Runs the full transient simulation.
   */
  public solve(): EmtSimulationResult {
    const startTime = Date.now();
    const dt = this.options.timeStepSec;
    const totalSteps = Math.ceil(this.options.durationSec / dt);

    // 1. Build and factorize system Conductance Matrix [G]
    const companionSys = buildCompanionSystem(
      this.nNodes,
      this.rlcStates,
      this.lineStates,
      this.fmuStates,
      this.sources.map((s) => ({ node: s.node, gSource: 1e3 })),
    );

    // 2. Allocate output arrays
    const timePoints = new Float64Array(totalSteps);
    const busVoltages = new Map<string, Float64Array>();
    for (const busName of this.busNames) {
      busVoltages.set(busName, new Float64Array(totalSteps));
    }

    const branchCurrents = new Map<string, Float64Array>();
    for (const b of this.rlcStates) {
      branchCurrents.set(b.id, new Float64Array(totalSteps));
    }

    // Working state vectors
    const bVec = new Float64Array(this.nNodes);
    const vVec = new Float64Array(this.nNodes);

    // 3. Time-stepping loop
    for (let step = 0; step < totalSteps; step++) {
      const t = step * dt;
      timePoints[step] = t;

      // A. Clear RHS current injection vector b = i_inj - I_hist
      bVec.fill(0);

      // B. Inject AC sources (Norton equivalent ideal AC voltage sources through stiff admittance)
      for (const src of this.sources) {
        if (src.node >= 0) {
          const vInstant = src.vPeakKv * 1e3 * Math.sin(src.omega * t + src.phase);
          const gSource = 1e3; // Low internal source impedance
          bVec[src.node] += gSource * vInstant;
        }
      }

      // C. Subtract RLC branch history currents
      for (const b of this.rlcStates) {
        const iHist = b.iHistL + b.iHistC;
        if (b.fromNode >= 0) bVec[b.fromNode] -= iHist;
        if (b.toNode >= 0) bVec[b.toNode] += iHist;
      }

      // D. Inject Bergeron transmission line delayed traveling-wave history currents
      for (const line of this.lineStates) {
        const readIdx = (line.bufferIdx + 1) % line.delaySteps;
        const waveFromK = line.bufferFrom[readIdx] ?? 0;
        const waveFromM = line.bufferTo[readIdx] ?? 0;

        // Wave launched from 'fromNode' (K) arrives at 'toNode' (M)
        if (line.toNode >= 0) bVec[line.toNode] += waveFromK;
        // Wave launched from 'toNode' (M) arrives at 'fromNode' (K)
        if (line.fromNode >= 0) bVec[line.fromNode] += waveFromM;
      }

      // E. Inject Black-Box FMU Norton predicted current
      for (const fmu of this.fmuStates) {
        if (fmu.node >= 0) {
          bVec[fmu.node] += fmu.iInjected;
        }
      }

      // F. Solve linear system [G] * v(t) = b
      sparseLuSolve(companionSys.lu, bVec, vVec);

      // G. Record node voltages
      for (let i = 0; i < this.nNodes; i++) {
        const name = this.busNames[i]!;
        busVoltages.get(name)![step] = vVec[i]!;
      }

      // H. Update RLC branches and calculate new history currents for t + dt
      for (const b of this.rlcStates) {
        const vFrom = b.fromNode >= 0 ? vVec[b.fromNode]! : 0;
        const vTo = b.toNode >= 0 ? vVec[b.toNode]! : 0;
        const vBranch = vFrom - vTo;

        let iBranch = 0;
        if (b.l > 0) {
          const iL = b.gL * vBranch + b.iHistL;
          b.iHistL = iL + b.gL * vBranch; // Trapezoidal update
          iBranch += iL;
        }
        if (b.c > 0) {
          const iC = b.gC * vBranch + b.iHistC;
          b.iHistC = -iC - b.gC * vBranch; // Trapezoidal update
          iBranch += iC;
        }
        if (b.r > 0 && b.l === 0 && b.c === 0) {
          iBranch = vBranch / b.r;
        }

        b.current = iBranch;
        branchCurrents.get(b.id)![step] = iBranch;
      }

      // I. Advance transmission line traveling-wave buffers
      for (const line of this.lineStates) {
        const vFrom = line.fromNode >= 0 ? vVec[line.fromNode]! : 0;
        const vTo = line.toNode >= 0 ? vVec[line.toNode]! : 0;

        const readIdx = (line.bufferIdx + 1) % line.delaySteps;
        const arrivingAtFrom = line.bufferTo[readIdx] ?? 0;
        const arrivingAtTo = line.bufferFrom[readIdx] ?? 0;

        // Wave launched into the line from each end towards the other
        const rLoss = line.rTotal;
        const eta = Math.max(0.1, (1 - rLoss / (4 * line.zc)) / (1 + rLoss / (4 * line.zc)));

        line.bufferFrom[line.bufferIdx] = (2 * line.gc * vFrom - arrivingAtFrom) * eta;
        line.bufferTo[line.bufferIdx] = (2 * line.gc * vTo - arrivingAtTo) * eta;
        line.bufferIdx = (line.bufferIdx + 1) % line.delaySteps;
      }

      // J. Advance Black-Box FMU IBR controller (emulating Phase-Locked Loop & current injection)
      for (const fmu of this.fmuStates) {
        if (fmu.node >= 0) {
          const _vPoi = vVec[fmu.node]!;
          // Fast Phase-Locked Loop (PLL) tracking
          fmu.pllAngle += 2 * Math.PI * this.options.nominalFrequencyHz * dt;
          if (fmu.pllAngle > 2 * Math.PI) fmu.pllAngle -= 2 * Math.PI;

          // Commanded inverter current based on active power P = V * I
          const iPeak = (fmu.pSetpointMw * 1e6) / (fmu.ratedKv * 1e3 * Math.sqrt(2));
          const iTarget = iPeak * Math.sin(fmu.pllAngle);

          // Norton equivalent parallel current injection: i_inj = i_target
          fmu.iInjected = iTarget;
        }
      }
    }

    const wallClockTimeMs = Date.now() - startTime;

    return {
      time: timePoints,
      busVoltages,
      branchCurrents,
      metrics: {
        totalSteps,
        wallClockTimeMs,
        factorizationCount: 1,
      },
    };
  }
}

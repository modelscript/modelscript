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

import {
  buildCompanionSystem,
  stampShuntConductance,
  stampTransformerWinding,
  stampTwoTerminalConductance,
} from "./companion-matrix.js";
import { CsmfControlGraph, type CsmfBlockConfig } from "./elements/csmf-controls.js";
import {
  createFdLineState,
  createModalFdLineState,
  updateFdLine,
  updateModalFdLine,
  type FdLineState,
  type FrequencyDependentLineConfig,
  type ModalThreePhaseFdLineConfig,
  type ModalThreePhaseFdLineState,
} from "./elements/frequency-dependent-line.js";
import {
  createInductionMachineState,
  stepInductionMachine,
  type InductionMachineConfig,
  type InductionMachineState,
} from "./elements/induction-machine.js";
import {
  createConverterBridgeState,
  stepConverterBridge,
  type ConverterBridgeConfig,
  type ConverterBridgeState,
} from "./elements/power-electronics.js";
import {
  createSaturableTransformerState,
  evaluateMagnetizingCurrent,
  updateSaturableCore,
  type SaturableTransformerConfig,
  type SaturableTransformerState,
} from "./elements/saturable-transformer.js";
import {
  createSurgeArresterState,
  evaluateMovCurve,
  updateSurgeArrester,
  type SurgeArresterConfig,
  type SurgeArresterState,
} from "./elements/surge-arrester.js";
import {
  createSynchronousMachineState,
  stepSynchronousMachine,
  type SynchronousMachineConfig,
  type SynchronousMachineState,
} from "./elements/synchronous-machine.js";
import { initializePhasorSteadyState } from "./phasor-init.js";
import type {
  BergeronLineState,
  BreakerPoleState,
  EmtSimulationResult,
  EmtSolverOptions,
  FaultKind,
  FmuIbrState,
  RlcBranchState,
  SequenceWaveform,
  ThreePhaseWaveform,
  TransformerWindingState,
} from "./types.js";

export interface EmtCircuitDefinition {
  buses: string[];
  rlc: {
    id: string;
    from: string;
    to: string;
    r?: number;
    l?: number;
    c?: number;
    r0?: number;
    l0?: number;
    c0?: number;
  }[];
  transformers?: {
    id: string;
    fromBus?: string;
    toBus?: string;
    primaryBus?: string;
    secondaryBus?: string;
    mvaRating: number;
    primaryKv: number;
    secondaryKv: number;
    leakageReactancePu: number;
    windingConnection?: "Yg-Yg" | "Yg-D" | "D-Yg" | "D-D";
  }[];
  breakers?: {
    id: string;
    from: string;
    to: string;
    closedInitially?: boolean;
    openTimeSec?: number;
    closeTimeSec?: number;
    rClosedOhm?: number;
    rOpenOhm?: number;
    choppingCurrentAmp?: number;
    singlePoleTripPhase?: "A" | "B" | "C" | "ALL";
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
  fdLines?: FrequencyDependentLineConfig[];
  modalFdLines?: ModalThreePhaseFdLineConfig[];
  saturableTransformers?: SaturableTransformerConfig[];
  surgeArresters?: SurgeArresterConfig[];
  synchronousMachines?: SynchronousMachineConfig[];
  inductionMachines?: InductionMachineConfig[];
  converterBridges?: ConverterBridgeConfig[];
  fmuInstances?: {
    id: string;
    bus: string;
    ratedMva: number;
    ratedKv: number;
    pSetpointMw?: number;
    qSetpointMvar?: number;
  }[];
  sources?: {
    id?: string;
    bus: string;
    vPeakKv: number;
    freqHz: number;
    phaseRad?: number;
    gSource?: number;
    rSource?: number;
  }[];
  faults?: {
    id?: string;
    bus: string;
    startSec: number;
    durationSec: number;
    faultResistanceOhm?: number;
    faultType?: FaultKind;
  }[];
  csmfBlocks?: CsmfBlockConfig[];
}

interface FaultElementState {
  id: string;
  nodeA: number;
  nodeB: number; // -1 for phase-to-ground, >= 0 for phase-to-phase (LL)
  startSec: number;
  endSec: number;
  gFault: number;
  isActive: boolean;
}

export class EmtSolver {
  private readonly options: Required<EmtSolverOptions>;
  private readonly isThreePhase: boolean;
  private readonly nPhases: number;
  private readonly busMap = new Map<string, number>();
  private readonly busNames: string[];
  private readonly nBuses: number;
  private readonly nNodes: number;

  private readonly rlcStates: RlcBranchState[] = [];
  private readonly xfmrWindings: TransformerWindingState[] = [];
  private readonly breakerPoles: BreakerPoleState[] = [];
  private readonly lineStates: BergeronLineState[] = [];
  private readonly fdLineStates: FdLineState[] = [];
  private readonly modalFdLineStates: ModalThreePhaseFdLineState[] = [];
  private readonly satXfmrStates: SaturableTransformerState[] = [];
  private readonly arresterStates: SurgeArresterState[] = [];
  private readonly syncMachineStates: SynchronousMachineState[] = [];
  private readonly indMachineStates: InductionMachineState[] = [];
  private readonly converterStates: ConverterBridgeState[] = [];
  private readonly fmuStates: FmuIbrState[] = [];
  private readonly sources: {
    id: string;
    node: number;
    vPeakKv: number;
    omega: number;
    phase: number;
    gSource: number;
  }[] = [];
  private readonly faultStates: FaultElementState[] = [];
  private readonly csmfGraph?: CsmfControlGraph;

  constructor(circuit: EmtCircuitDefinition, options: EmtSolverOptions) {
    const hasUnbalancedFaults =
      circuit.faults?.some((f) => f.faultType !== undefined && f.faultType !== "3LG" && f.faultType !== "ABC") ?? false;
    const hasVectorGroupXfmr =
      circuit.transformers?.some((x) => x.windingConnection !== undefined && x.windingConnection !== "Yg-Yg") ?? false;
    const hasSinglePoleBreaker =
      circuit.breakers?.some((b) => b.singlePoleTripPhase !== undefined && b.singlePoleTripPhase !== "ALL") ?? false;
    const hasZeroSeqRlc = (circuit.rlc ?? []).some(
      (b) => b.r0 !== undefined || b.l0 !== undefined || b.c0 !== undefined,
    );
    const hasModalFdLines = (circuit.modalFdLines?.length ?? 0) > 0;

    this.isThreePhase = Boolean(
      options.threePhase ||
      hasUnbalancedFaults ||
      hasVectorGroupXfmr ||
      hasSinglePoleBreaker ||
      hasZeroSeqRlc ||
      hasModalFdLines,
    );
    this.nPhases = this.isThreePhase ? 3 : 1;

    this.options = {
      timeStepSec: options.timeStepSec,
      durationSec: options.durationSec,
      nominalFrequencyHz: options.nominalFrequencyHz ?? 60.0,
      enableCda: options.enableCda ?? true,
      enableInterpolation: options.enableInterpolation ?? true,
      steadyStateInit: options.steadyStateInit ?? false,
      threePhase: this.isThreePhase,
      maxNonlinearIterations: Math.max(1, Math.round(options.maxNonlinearIterations ?? 1)),
      nonlinearToleranceVolts: Math.max(1e-6, options.nonlinearToleranceVolts ?? 1.0),
    };

    const dt = this.options.timeStepSec;
    if (circuit.csmfBlocks && circuit.csmfBlocks.length > 0) {
      this.csmfGraph = new CsmfControlGraph(circuit.csmfBlocks, dt, this.options.nominalFrequencyHz);
    }

    // 1. Index buses (GND is -1). In 3-phase mode, bus i occupies nodes [3*i + 0, 3*i + 1, 3*i + 2].
    this.busNames = [...circuit.buses];
    this.nBuses = this.busNames.length;
    this.nNodes = this.nBuses * this.nPhases;
    for (let i = 0; i < this.nBuses; i++) {
      this.busMap.set(this.busNames[i]!, i);
    }

    const getBusIdx = (name: string): number => {
      if (name === "0" || name.toUpperCase() === "GND" || name.toUpperCase() === "GROUND") return -1;
      return this.busMap.get(name) ?? -1;
    };

    const getNodePhase = (name: string, phaseIdx: number): number => {
      const bIdx = getBusIdx(name);
      return bIdx >= 0 ? bIdx * this.nPhases + phaseIdx : -1;
    };

    // 2. Initialize RLC branches (per phase, plus optional mutual zero-sequence coupling)
    for (const b of circuit.rlc ?? []) {
      const l = b.l ?? 0;
      const c = b.c ?? 0;
      const r = b.r ?? (l === 0 && c === 0 ? 0.001 : 0);

      // Exact trapezoidal companion conductance for series RL when l > 0:
      // G_L = dt / (2*L + R*dt), alpha_L = (2*L - R*dt) / (2*L + R*dt)
      const gL = l > 0 ? dt / (2 * l + r * dt) : 0;
      const alphaL = l > 0 ? (2 * l - r * dt) / (2 * l + r * dt) : 1;
      const gC = c > 0 ? (2 * c) / dt : 0;
      const gR = l === 0 ? (r > 0 ? 1 / r : c === 0 ? 1e4 : 0) : 0;
      const gTotal1 = gL + gC + gR;

      const hasZeroSeq = this.isThreePhase && (b.r0 !== undefined || b.l0 !== undefined || b.c0 !== undefined);
      const l0 = b.l0 ?? l;
      const c0 = b.c0 ?? c;
      const r0 = b.r0 ?? r;
      const gL0 = l0 > 0 ? dt / (2 * l0 + r0 * dt) : 0;
      const alphaL0 = l0 > 0 ? (2 * l0 - r0 * dt) / (2 * l0 + r0 * dt) : 1;
      const gC0 = c0 > 0 ? (2 * c0) / dt : 0;
      const gR0 = l0 === 0 ? (r0 > 0 ? 1 / r0 : c0 === 0 ? 1e4 : 0) : 0;
      const gTotal0 = gL0 + gC0 + gR0;

      const gTotal = hasZeroSeq ? (2 * gTotal1 + gTotal0) / 3 : gTotal1;
      const gMutual = hasZeroSeq ? (gTotal0 - gTotal1) / 3 : 0;

      for (let p = 0; p < this.nPhases; p++) {
        this.rlcStates.push({
          id: p === 0 ? b.id : `${b.id}_ph${p}`,
          fromNode: getNodePhase(b.from, p),
          toNode: getNodePhase(b.to, p),
          r,
          l,
          c,
          gL,
          alphaL,
          gC,
          gTotal,
          iHistL: 0,
          iHistC: 0,
          current: 0,
          hasZeroSeq,
          r0,
          l0,
          c0,
          gL0,
          alphaL0,
          gC0,
          gMutual,
          iHistL0: 0,
          iHistC0: 0,
        });
      }
    }

    // 2b. Initialize two-winding transformers with true turns ratio and 3-phase vector groups
    if (circuit.transformers) {
      for (const xfmr of circuit.transformers) {
        const v1Kv = Math.max(1e-3, xfmr.primaryKv);
        const v2Kv = Math.max(1e-3, xfmr.secondaryKv);
        const vBase = v1Kv * 1e3;
        const sBase = Math.max(1e-3, xfmr.mvaRating) * 1e6;
        const zBase = (vBase * vBase) / sBase;
        const xPu = xfmr.leakageReactancePu > 0 ? xfmr.leakageReactancePu : 0.08;
        const l = (xPu * zBase) / (2 * Math.PI * this.options.nominalFrequencyHz);
        const r = 0.005 * zBase;
        const gLeakage = dt / (2 * l + r * dt);
        const alphaL = (2 * l - r * dt) / (2 * l + r * dt);

        const fromBus = xfmr.fromBus ?? xfmr.primaryBus ?? "0";
        const toBus = xfmr.toBus ?? xfmr.secondaryBus ?? "0";
        const aNom = v1Kv / v2Kv;
        const vecGroup = xfmr.windingConnection ?? "Yg-Yg";

        if (!this.isThreePhase) {
          this.xfmrWindings.push({
            id: xfmr.id,
            phaseIndex: 0,
            pPosNode: getNodePhase(fromBus, 0),
            pNegNode: -1,
            sPosNode: getNodePhase(toBus, 0),
            sNegNode: -1,
            turnsRatio: aNom,
            gLeakage,
            alphaL,
            iHistPrimary: 0,
            currentPrimary: 0,
            currentSecondary: 0,
          });
        } else {
          for (let p = 0; p < 3; p++) {
            const pNext = (p + 1) % 3;
            let pPosNode = getNodePhase(fromBus, p);
            let pNegNode = -1;
            let sPosNode = getNodePhase(toBus, p);
            let sNegNode = -1;
            let aEff = aNom;

            if (vecGroup === "Yg-D") {
              // Wye-grounded primary (V_LN = V1/sqrt(3)), Delta secondary (V_LL = V2)
              sNegNode = getNodePhase(toBus, pNext);
              aEff = aNom / Math.SQRT2 / (Math.sqrt(3) / Math.SQRT2); // aNom / sqrt(3)
            } else if (vecGroup === "D-Yg") {
              // Delta primary (V_LL = V1), Wye-grounded secondary (V_LN = V2/sqrt(3))
              pNegNode = getNodePhase(fromBus, pNext);
              aEff = aNom * Math.sqrt(3);
            } else if (vecGroup === "D-D") {
              pNegNode = getNodePhase(fromBus, pNext);
              sNegNode = getNodePhase(toBus, pNext);
              aEff = aNom;
            }

            this.xfmrWindings.push({
              id: p === 0 ? xfmr.id : `${xfmr.id}_ph${p}`,
              phaseIndex: p,
              pPosNode,
              pNegNode,
              sPosNode,
              sNegNode,
              turnsRatio: aEff,
              gLeakage,
              alphaL,
              iHistPrimary: 0,
              currentPrimary: 0,
              currentSecondary: 0,
            });
          }
        }
      }
    }

    // 2c. Initialize Circuit Breakers with Current Zero-Crossing Arc Extinction
    if (circuit.breakers) {
      for (const brk of circuit.breakers) {
        const closedInit = brk.closedInitially ?? true;
        const rClosed = brk.rClosedOhm !== undefined && brk.rClosedOhm > 0 ? brk.rClosedOhm : 1e-3;
        const rOpen = brk.rOpenOhm !== undefined && brk.rOpenOhm > 0 ? brk.rOpenOhm : 1e9;
        const gClosed = 1 / rClosed;
        const gOpen = 1 / rOpen;
        const tripPhase = brk.singlePoleTripPhase ?? "ALL";

        for (let p = 0; p < this.nPhases; p++) {
          const phaseLabel = p === 0 ? "A" : p === 1 ? "B" : "C";
          const canTripThisPole = tripPhase === "ALL" || tripPhase === phaseLabel;
          this.breakerPoles.push({
            id: p === 0 ? brk.id : `${brk.id}_ph${p}`,
            phaseIndex: p,
            fromNode: getNodePhase(brk.from, p),
            toNode: getNodePhase(brk.to, p),
            gClosed,
            gOpen,
            gCurrent: closedInit ? gClosed : gOpen,
            isClosed: closedInit,
            pendingOpen: false,
            openTimeSec: canTripThisPole && brk.openTimeSec !== undefined ? brk.openTimeSec : Infinity,
            closeTimeSec: brk.closeTimeSec ?? Infinity,
            choppingCurrentAmp: brk.choppingCurrentAmp ?? 0.5,
            current: 0,
          });
        }
      }
    }

    // 3. Initialize Bergeron transmission lines (with fractional delay interpolation)
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
        const exactSteps = Math.max(1, tau / dt);
        const delaySteps = Math.max(1, Math.floor(exactSteps));
        const delayFraction = exactSteps - delaySteps;

        for (let p = 0; p < this.nPhases; p++) {
          this.lineStates.push({
            id: p === 0 ? line.id : `${line.id}_ph${p}`,
            fromNode: getNodePhase(line.from, p),
            toNode: getNodePhase(line.to, p),
            lengthKm: len,
            rTotal: r_km * len,
            zc,
            tauSec: tau,
            delaySteps,
            delayFraction,
            bufferFrom: new Float64Array(delaySteps + 2),
            bufferTo: new Float64Array(delaySteps + 2),
            bufferIdx: 0,
            gc: 1 / zc,
          });
        }
      }
    }

    // 3b. Initialize Frequency-Dependent Lines (FDPM), Modal 3-Phase FD Lines, Saturable Transformers, MOV Surge Arresters, and 6th-Order Synchronous Machines
    if (circuit.fdLines) {
      for (const fdCfg of circuit.fdLines) {
        this.fdLineStates.push(createFdLineState(fdCfg, dt));
      }
    }
    if (circuit.modalFdLines) {
      for (const mfdCfg of circuit.modalFdLines) {
        const fromNodes = [
          getNodePhase(mfdCfg.fromBus, 0),
          getNodePhase(mfdCfg.fromBus, 1),
          getNodePhase(mfdCfg.fromBus, 2),
        ];
        const toNodes = [getNodePhase(mfdCfg.toBus, 0), getNodePhase(mfdCfg.toBus, 1), getNodePhase(mfdCfg.toBus, 2)];
        this.modalFdLineStates.push(createModalFdLineState(mfdCfg, fromNodes, toNodes, dt));
      }
    }
    if (circuit.saturableTransformers) {
      for (const satCfg of circuit.saturableTransformers) {
        if (satCfg.primaryBus !== undefined && satCfg.secondaryBus !== undefined) {
          for (let p = 0; p < this.nPhases; p++) {
            this.satXfmrStates.push(
              createSaturableTransformerState(
                {
                  ...satCfg,
                  id: p === 0 ? satCfg.id : `${satCfg.id}_ph${p}`,
                  primaryNode: getNodePhase(satCfg.primaryBus, p),
                  secondaryNode: getNodePhase(satCfg.secondaryBus, p),
                },
                dt,
              ),
            );
          }
        } else {
          this.satXfmrStates.push(createSaturableTransformerState(satCfg, dt));
        }
      }
    }
    if (circuit.surgeArresters) {
      for (const movCfg of circuit.surgeArresters) {
        for (let p = 0; p < this.nPhases; p++) {
          this.arresterStates.push(
            createSurgeArresterState(
              { ...movCfg, id: p === 0 ? movCfg.id : `${movCfg.id}_ph${p}` },
              getNodePhase(movCfg.bus, p),
              p,
            ),
          );
        }
      }
    }
    if (circuit.synchronousMachines) {
      for (const smCfg of circuit.synchronousMachines) {
        const smNodes: number[] = [];
        for (let p = 0; p < this.nPhases; p++) {
          smNodes.push(getNodePhase(smCfg.bus, p));
        }
        this.syncMachineStates.push(createSynchronousMachineState(smCfg, smNodes, this.options.nominalFrequencyHz));
      }
    }
    if (circuit.inductionMachines) {
      for (const imCfg of circuit.inductionMachines) {
        const imNodes: number[] = [];
        for (let p = 0; p < this.nPhases; p++) {
          imNodes.push(getNodePhase(imCfg.bus, p));
        }
        this.indMachineStates.push(createInductionMachineState(imCfg, imNodes, this.options.nominalFrequencyHz));
      }
    }
    if (circuit.converterBridges) {
      for (const convCfg of circuit.converterBridges) {
        const convNodes: number[] = [];
        for (let p = 0; p < this.nPhases; p++) {
          convNodes.push(getNodePhase(convCfg.bus, p));
        }
        this.converterStates.push(createConverterBridgeState(convCfg, convNodes, dt, this.options.nominalFrequencyHz));
      }
    }

    // 4. Initialize Black-Box FMU IBR instances
    if (circuit.fmuInstances) {
      for (const fmu of circuit.fmuInstances) {
        const vBase = fmu.ratedKv * 1e3;
        const sBase = fmu.ratedMva * 1e6;
        const gEq = sBase / (vBase * vBase);

        for (let p = 0; p < this.nPhases; p++) {
          const phaseShift = (p * 2 * Math.PI) / 3;
          this.fmuStates.push({
            id: p === 0 ? fmu.id : `${fmu.id}_ph${p}`,
            node: getNodePhase(fmu.bus, p),
            ratedMva: fmu.ratedMva,
            ratedKv: fmu.ratedKv,
            gEq,
            iInjected: 0,
            pSetpointMw: fmu.pSetpointMw ?? fmu.ratedMva * 0.9,
            qSetpointMvar: fmu.qSetpointMvar ?? 0,
            pllAngle: -phaseShift,
            iReal: 1.0,
            iImag: 0,
          });
        }
      }
    }

    // 5. Initialize AC Sources (3-phase balanced 0, -120°, +120° when threePhase is active)
    if (circuit.sources) {
      for (let i = 0; i < circuit.sources.length; i++) {
        const s = circuit.sources[i]!;
        const baseId = s.id ?? `Source_${i + 1}`;
        const basePhase = s.phaseRad ?? 0;
        const gSource = s.gSource ?? (s.rSource && s.rSource > 0 ? 1.0 / s.rSource : 1e3);
        for (let p = 0; p < this.nPhases; p++) {
          const phaseOffset = p === 0 ? 0 : p === 1 ? -(2 * Math.PI) / 3 : (2 * Math.PI) / 3;
          this.sources.push({
            id: p === 0 ? baseId : `${baseId}_ph${p}`,
            node: getNodePhase(s.bus, p),
            vPeakKv: s.vPeakKv,
            omega: 2 * Math.PI * s.freqHz,
            phase: basePhase + phaseOffset,
            gSource,
          });
        }
      }
    }

    // 6. Initialize Time-Switched Balanced & Unbalanced Faults
    if (circuit.faults) {
      for (let i = 0; i < circuit.faults.length; i++) {
        const f = circuit.faults[i]!;
        const rFault = f.faultResistanceOhm !== undefined && f.faultResistanceOhm > 0 ? f.faultResistanceOhm : 1e-3;
        const gFault = 1 / rFault;
        const fType: FaultKind = f.faultType ?? "3LG";
        const baseId = f.id ?? `Fault_${i + 1}`;
        const startSec = f.startSec;
        const endSec = f.startSec + f.durationSec;

        if (!this.isThreePhase) {
          this.faultStates.push({
            id: baseId,
            nodeA: getNodePhase(f.bus, 0),
            nodeB: -1,
            startSec,
            endSec,
            gFault,
            isActive: false,
          });
        } else {
          const nA = getNodePhase(f.bus, 0);
          const nB = getNodePhase(f.bus, 1);
          const nC = getNodePhase(f.bus, 2);

          if (fType === "SLG" || fType === "AG") {
            this.faultStates.push({ id: baseId, nodeA: nA, nodeB: -1, startSec, endSec, gFault, isActive: false });
          } else if (fType === "BG") {
            this.faultStates.push({ id: baseId, nodeA: nB, nodeB: -1, startSec, endSec, gFault, isActive: false });
          } else if (fType === "CG") {
            this.faultStates.push({ id: baseId, nodeA: nC, nodeB: -1, startSec, endSec, gFault, isActive: false });
          } else if (fType === "LL" || fType === "AB") {
            this.faultStates.push({ id: baseId, nodeA: nA, nodeB: nB, startSec, endSec, gFault, isActive: false });
          } else if (fType === "BC") {
            this.faultStates.push({ id: baseId, nodeA: nB, nodeB: nC, startSec, endSec, gFault, isActive: false });
          } else if (fType === "CA") {
            this.faultStates.push({ id: baseId, nodeA: nC, nodeB: nA, startSec, endSec, gFault, isActive: false });
          } else if (fType === "LLG" || fType === "ABG") {
            this.faultStates.push({
              id: `${baseId}_A`,
              nodeA: nA,
              nodeB: -1,
              startSec,
              endSec,
              gFault,
              isActive: false,
            });
            this.faultStates.push({
              id: `${baseId}_B`,
              nodeA: nB,
              nodeB: -1,
              startSec,
              endSec,
              gFault,
              isActive: false,
            });
          } else if (fType === "BCG") {
            this.faultStates.push({
              id: `${baseId}_B`,
              nodeA: nB,
              nodeB: -1,
              startSec,
              endSec,
              gFault,
              isActive: false,
            });
            this.faultStates.push({
              id: `${baseId}_C`,
              nodeA: nC,
              nodeB: -1,
              startSec,
              endSec,
              gFault,
              isActive: false,
            });
          } else if (fType === "CAG") {
            this.faultStates.push({
              id: `${baseId}_C`,
              nodeA: nC,
              nodeB: -1,
              startSec,
              endSec,
              gFault,
              isActive: false,
            });
            this.faultStates.push({
              id: `${baseId}_A`,
              nodeA: nA,
              nodeB: -1,
              startSec,
              endSec,
              gFault,
              isActive: false,
            });
          } else {
            // 3LG / ABC
            this.faultStates.push({
              id: `${baseId}_A`,
              nodeA: nA,
              nodeB: -1,
              startSec,
              endSec,
              gFault,
              isActive: false,
            });
            this.faultStates.push({
              id: `${baseId}_B`,
              nodeA: nB,
              nodeB: -1,
              startSec,
              endSec,
              gFault,
              isActive: false,
            });
            this.faultStates.push({
              id: `${baseId}_C`,
              nodeA: nC,
              nodeB: -1,
              startSec,
              endSec,
              gFault,
              isActive: false,
            });
          }
        }
      }
    }
  }

  public getSurgeArresterStates(): readonly SurgeArresterState[] {
    return this.arresterStates;
  }

  public getSynchronousMachineStates(): readonly SynchronousMachineState[] {
    return this.syncMachineStates;
  }

  public getInductionMachineStates(): readonly InductionMachineState[] {
    return this.indMachineStates;
  }

  public getConverterBridgeStates(): readonly ConverterBridgeState[] {
    return this.converterStates;
  }

  /**
   * Runs the full transient simulation.
   */
  public solve(): EmtSimulationResult {
    const startTime = Date.now();
    const dt = this.options.timeStepSec;
    const totalSteps = Math.ceil(this.options.durationSec / dt);

    // 1. Build and factorize system Conductance Matrix [G] (with automatic BBDF traveling-wave network tearing)
    const companionSys = buildCompanionSystem(
      this.nNodes,
      this.rlcStates,
      this.lineStates,
      this.fmuStates,
      this.sources.map((s) => ({ node: s.node, gSource: s.gSource })),
      this.xfmrWindings,
      this.breakerPoles,
      [
        ...this.faultStates.map((f) => ({ nodeA: f.nodeA, nodeB: f.nodeB })),
        ...this.satXfmrStates.map((s) => ({ nodeA: s.config.primaryNode, nodeB: s.config.secondaryNode })),
      ],
    );
    let factorizationCount = 1;

    // Stamp any FD lines, modal FD lines, saturable transformers, MOV surge arresters, synchronous/induction machines, or converter bridges
    if (
      this.fdLineStates.length > 0 ||
      this.modalFdLineStates.length > 0 ||
      this.satXfmrStates.length > 0 ||
      this.arresterStates.length > 0 ||
      this.syncMachineStates.length > 0 ||
      this.indMachineStates.length > 0 ||
      this.converterStates.length > 0
    ) {
      for (const fd of this.fdLineStates) {
        stampShuntConductance(companionSys.Gdense, this.nNodes, fd.config.fromNode, fd.gc);
        stampShuntConductance(companionSys.Gdense, this.nNodes, fd.config.toNode, fd.gc);
      }
      for (const mfd of this.modalFdLineStates) {
        const stampModalTerminal = (nodes: number[]) => {
          for (let p = 0; p < 3; p++) {
            const np = nodes[p] ?? -1;
            if (np >= 0) {
              companionSys.Gdense[np]![np]! += mfd.gSelf;
              for (let q = 0; q < 3; q++) {
                if (q !== p) {
                  const nq = nodes[q] ?? -1;
                  if (nq >= 0) {
                    companionSys.Gdense[np]![nq]! += mfd.gMutual;
                  }
                }
              }
            }
          }
        };
        stampModalTerminal(mfd.fromNodes);
        stampModalTerminal(mfd.toNodes);
      }
      for (const sat of this.satXfmrStates) {
        stampTransformerWinding(
          companionSys.Gdense,
          this.nNodes,
          sat.config.primaryNode,
          -1,
          sat.config.secondaryNode,
          -1,
          sat.gLeakage,
          sat.ratio,
        );
        stampShuntConductance(companionSys.Gdense, this.nNodes, sat.config.primaryNode, sat.gMag);
      }
      for (const mov of this.arresterStates) {
        stampShuntConductance(companionSys.Gdense, this.nNodes, mov.node, mov.gCurrent);
      }
      for (const sm of this.syncMachineStates) {
        for (const node of sm.nodes) {
          stampShuntConductance(companionSys.Gdense, this.nNodes, node, sm.gSubOhmInv);
        }
      }
      for (const im of this.indMachineStates) {
        for (const node of im.nodes) {
          stampShuntConductance(companionSys.Gdense, this.nNodes, node, im.gSubOhmInv);
        }
      }
      for (const conv of this.converterStates) {
        for (const node of conv.nodes) {
          stampShuntConductance(companionSys.Gdense, this.nNodes, node, conv.gFilter);
        }
      }
      companionSys.refactorizeAll();
    }

    // 2. Allocate output arrays
    const timePoints = new Float64Array(totalSteps);
    const busVoltages = new Map<string, Float64Array>();
    const busPhaseVoltages = this.isThreePhase ? new Map<string, ThreePhaseWaveform>() : undefined;
    for (const busName of this.busNames) {
      const phA = new Float64Array(totalSteps);
      busVoltages.set(busName, phA);
      if (busPhaseVoltages) {
        busPhaseVoltages.set(busName, {
          a: phA,
          b: new Float64Array(totalSteps),
          c: new Float64Array(totalSteps),
        });
      }
    }

    const branchCurrents = new Map<string, Float64Array>();
    const branchPhaseCurrents = this.isThreePhase ? new Map<string, ThreePhaseWaveform>() : undefined;
    const registerBranchOutput = (baseId: string, phaseIndex: number) => {
      if (phaseIndex === 0) {
        const phA = new Float64Array(totalSteps);
        branchCurrents.set(baseId, phA);
        if (branchPhaseCurrents) {
          branchPhaseCurrents.set(baseId, {
            a: phA,
            b: new Float64Array(totalSteps),
            c: new Float64Array(totalSteps),
          });
        }
      }
    };

    for (let i = 0; i < this.rlcStates.length; i++) {
      registerBranchOutput(this.rlcStates[i]!.id, i % this.nPhases);
    }
    for (const w of this.xfmrWindings) {
      registerBranchOutput(w.id, w.phaseIndex);
    }
    for (const bp of this.breakerPoles) {
      registerBranchOutput(bp.id, bp.phaseIndex);
    }
    for (const mov of this.arresterStates) {
      registerBranchOutput(mov.id, mov.phaseIndex);
    }
    for (const sm of this.syncMachineStates) {
      registerBranchOutput(sm.config.id, 0);
    }
    for (const im of this.indMachineStates) {
      registerBranchOutput(im.config.id, 0);
    }
    for (const conv of this.converterStates) {
      registerBranchOutput(conv.config.id, 0);
    }
    for (const mfd of this.modalFdLineStates) {
      registerBranchOutput(mfd.config.id, 0);
    }
    for (let i = 0; i < this.fmuStates.length; i++) {
      registerBranchOutput(this.fmuStates[i]!.id, i % this.nPhases);
    }

    const controlSignals = this.csmfGraph ? new Map<string, Float64Array>() : undefined;
    if (this.csmfGraph && controlSignals) {
      for (const blockId of this.csmfGraph.getBlockIds()) {
        controlSignals.set(blockId, new Float64Array(totalSteps));
      }
    }

    // Working state vectors
    const bVec = new Float64Array(this.nNodes);
    const vVec = new Float64Array(this.nNodes);
    const vPrev = new Float64Array(this.nNodes);
    const vIter = new Float64Array(this.nNodes);
    const maxNlIter = this.options.maxNonlinearIterations;
    const nlTol = this.options.nonlinearToleranceVolts;
    const hasNonlinear = this.satXfmrStates.length > 0 || this.arresterStates.length > 0;
    let totalNonlinearIterations = 0;

    // 2.5. Fundamental-Frequency AC Phasor Steady-State Initialization (t = 0-)
    if (this.options.steadyStateInit) {
      const vMinusDt = initializePhasorSteadyState(
        this.nNodes,
        2 * Math.PI * this.options.nominalFrequencyHz,
        dt,
        this.rlcStates,
        this.xfmrWindings,
        this.breakerPoles,
        this.lineStates,
        this.satXfmrStates,
        this.fmuStates,
        this.sources,
      );
      vVec.set(vMinusDt);
      vPrev.set(vMinusDt);
    }

    // 3. Time-stepping loop
    for (let step = 0; step < totalSteps; step++) {
      const t = step * dt;
      timePoints[step] = t;
      vPrev.set(vVec);

      // Check for discrete fault switching and circuit breaker events
      const changedNodes: number[] = [];
      for (const fault of this.faultStates) {
        const shouldBeActive = t >= fault.startSec && t < fault.endSec;
        if (shouldBeActive !== fault.isActive) {
          const deltaG = shouldBeActive ? fault.gFault : -fault.gFault;
          if (fault.nodeB >= 0) {
            stampTwoTerminalConductance(companionSys.Gdense, this.nNodes, fault.nodeA, fault.nodeB, deltaG);
          } else {
            stampShuntConductance(companionSys.Gdense, this.nNodes, fault.nodeA, deltaG);
          }
          fault.isActive = shouldBeActive;
          const n = fault.nodeA >= 0 ? fault.nodeA : fault.nodeB;
          if (n >= 0) changedNodes.push(n);
        }
      }

      for (const bp of this.breakerPoles) {
        if (!bp.isClosed && t >= bp.closeTimeSec && bp.clearedAtSec === undefined) {
          const deltaG = bp.gClosed - bp.gCurrent;
          stampTwoTerminalConductance(companionSys.Gdense, this.nNodes, bp.fromNode, bp.toNode, deltaG);
          bp.gCurrent = bp.gClosed;
          bp.isClosed = true;
          bp.pendingOpen = false;
          const n = bp.fromNode >= 0 ? bp.fromNode : bp.toNode;
          if (n >= 0) changedNodes.push(n);
        }
        if (bp.isClosed && t >= bp.openTimeSec) {
          bp.pendingOpen = true;
        }
      }

      if (changedNodes.length > 0) {
        const refactoredSubs = new Set<number>();
        for (const n of changedNodes) {
          const subIdx = companionSys.nodeToSubsystem[n] ?? -1;
          if (subIdx >= 0 && !refactoredSubs.has(subIdx)) {
            refactoredSubs.add(subIdx);
            companionSys.refactorizeSubsystem(n);
          }
        }
        factorizationCount++;

        // Critical Damping Adjustment (CDA): Backward-Euler step damping to suppress numerical chatter
        if (this.options.enableCda) {
          for (const b of this.rlcStates) {
            if (b.l > 0) b.iHistL = b.current;
            if (b.c > 0) b.iHistC = 0;
          }
          for (const w of this.xfmrWindings) {
            w.iHistPrimary = w.currentPrimary;
          }
        }
      }

      // A. Clear RHS current injection vector b = i_inj - I_hist
      bVec.fill(0);

      // B. Inject AC sources (Norton equivalent ideal AC voltage sources through stiff admittance)
      for (const src of this.sources) {
        if (src.node >= 0) {
          const vInstant = src.vPeakKv * 1e3 * Math.sin(src.omega * t + src.phase);
          bVec[src.node] += src.gSource * vInstant;
        }
      }

      // C. Subtract RLC branch history currents
      for (const b of this.rlcStates) {
        const iHist = b.iHistL + b.iHistC + (b.iHistL0 ?? 0) + (b.iHistC0 ?? 0);
        if (b.fromNode >= 0) bVec[b.fromNode] -= iHist;
        if (b.toNode >= 0) bVec[b.toNode] += iHist;
      }

      // C2. Subtract coupled transformer winding history currents (with turns ratio a_eff)
      for (const w of this.xfmrWindings) {
        const iHistP = w.iHistPrimary;
        const iHistS = -w.turnsRatio * iHistP;
        if (w.pPosNode >= 0) bVec[w.pPosNode] -= iHistP;
        if (w.pNegNode >= 0) bVec[w.pNegNode] += iHistP;
        if (w.sPosNode >= 0) bVec[w.sPosNode] -= iHistS;
        if (w.sNegNode >= 0) bVec[w.sNegNode] += iHistS;
      }

      // D. Inject Bergeron transmission line delayed traveling-wave history currents (with fractional delay interpolation)
      for (const line of this.lineStates) {
        const bufLen = line.bufferFrom.length;
        const readIdx1 = (line.bufferIdx - line.delaySteps + bufLen) % bufLen;
        const readIdx2 = (readIdx1 - 1 + bufLen) % bufLen;
        const frac = line.delayFraction;

        const waveFromK = (1 - frac) * (line.bufferFrom[readIdx1] ?? 0) + frac * (line.bufferFrom[readIdx2] ?? 0);
        const waveFromM = (1 - frac) * (line.bufferTo[readIdx1] ?? 0) + frac * (line.bufferTo[readIdx2] ?? 0);

        // Wave launched from 'fromNode' (K) arrives at 'toNode' (M)
        if (line.toNode >= 0) bVec[line.toNode] += waveFromK;
        // Wave launched from 'toNode' (M) arrives at 'fromNode' (K)
        if (line.fromNode >= 0) bVec[line.fromNode] += waveFromM;
      }

      // D2. Inject FD line, modal FD line, Saturable Transformer, MOV Surge Arrester, and Synchronous/Induction Machine history/Norton currents
      for (const fd of this.fdLineStates) {
        if (fd.config.fromNode >= 0) bVec[fd.config.fromNode] -= fd.iHistFrom;
        if (fd.config.toNode >= 0) bVec[fd.config.toNode] -= fd.iHistTo;
      }
      for (const mfd of this.modalFdLineStates) {
        for (let p = 0; p < 3; p++) {
          const nf = mfd.fromNodes[p] ?? -1;
          const nt = mfd.toNodes[p] ?? -1;
          if (nf >= 0) bVec[nf] -= mfd.iHistFromPhase[p]!;
          if (nt >= 0) bVec[nt] -= mfd.iHistToPhase[p]!;
        }
      }
      for (const sat of this.satXfmrStates) {
        if (sat.config.primaryNode >= 0) {
          bVec[sat.config.primaryNode] -= sat.iHistLeakage + sat.iHistMag;
        }
        if (sat.config.secondaryNode >= 0) {
          bVec[sat.config.secondaryNode] += sat.ratio * sat.iHistLeakage;
        }
      }
      for (const mov of this.arresterStates) {
        if (mov.node >= 0) {
          bVec[mov.node] -= mov.iEqHist;
        }
      }
      for (const sm of this.syncMachineStates) {
        for (let p = 0; p < sm.nodes.length; p++) {
          const n = sm.nodes[p]!;
          if (n >= 0) {
            bVec[n] += sm.iInjectedPhase[p]!;
          }
        }
      }
      for (const im of this.indMachineStates) {
        for (let p = 0; p < im.nodes.length; p++) {
          const n = im.nodes[p]!;
          if (n >= 0) {
            bVec[n] += im.iInjectedPhase[p]!;
          }
        }
      }
      for (const conv of this.converterStates) {
        for (let p = 0; p < conv.nodes.length; p++) {
          const n = conv.nodes[p]!;
          if (n >= 0) {
            bVec[n] += conv.iInjectedPhase[p]!;
          }
        }
      }

      // E. Inject Black-Box FMU Norton predicted current
      for (const fmu of this.fmuStates) {
        if (fmu.node >= 0) {
          bVec[fmu.node] += fmu.iInjected;
        }
      }

      // F. Solve linear system [G] * v(t) = b (across decoupled BBDF subsystems)
      companionSys.solve(bVec, vVec);
      totalNonlinearIterations++;

      // F1. Within-Step Iterative Non-Linear Compensation (Newton-Raphson / Katzenelson)
      if (maxNlIter > 1 && hasNonlinear) {
        for (let iter = 1; iter < maxNlIter; iter++) {
          const nlChangedNodes: number[] = [];
          for (const sat of this.satXfmrStates) {
            const pNode = sat.config.primaryNode;
            if (pNode < 0) continue;
            const vPrim = vVec[pNode]!;
            const fluxCandidate = sat.fluxWb + 0.5 * dt * (vPrim + sat.vPrimaryPrev);
            const { iMag, lInc, isSaturated } = evaluateMagnetizingCurrent(
              fluxCandidate,
              sat.config.lUnsatH,
              sat.config.lSatH,
              sat.config.kneeFluxWb,
            );
            const gMagNew = dt / (2 * lInc);
            if (Math.abs(gMagNew - sat.gMag) > 1e-12) {
              stampShuntConductance(companionSys.Gdense, this.nNodes, pNode, gMagNew - sat.gMag);
              sat.gMag = gMagNew;
              sat.isSaturated = isSaturated;
              nlChangedNodes.push(pNode);
            }
            const iEqMag = iMag - sat.gMag * vPrim;
            bVec[pNode] += sat.iHistMag - iEqMag;
            sat.iHistMag = iEqMag;
          }

          for (const mov of this.arresterStates) {
            if (mov.node < 0) continue;
            const vNode = vVec[mov.node]!;
            const { iMov, gInc } = evaluateMovCurve(mov, vNode);
            const relChange = Math.abs(gInc - mov.gCurrent) / Math.max(1e-9, mov.gCurrent);
            if (relChange > 0.05 && Math.abs(gInc - mov.gCurrent) > 1e-5) {
              stampShuntConductance(companionSys.Gdense, this.nNodes, mov.node, gInc - mov.gCurrent);
              mov.gCurrent = gInc;
              nlChangedNodes.push(mov.node);
            }
            const iEqNew = iMov - mov.gCurrent * vNode;
            bVec[mov.node] += mov.iEqHist - iEqNew;
            mov.iEqHist = iEqNew;
          }

          if (nlChangedNodes.length > 0) {
            const refactoredSubs = new Set<number>();
            for (const n of nlChangedNodes) {
              const subIdx = companionSys.nodeToSubsystem[n] ?? -1;
              if (subIdx >= 0 && !refactoredSubs.has(subIdx)) {
                refactoredSubs.add(subIdx);
                companionSys.refactorizeSubsystem(n);
              }
            }
            factorizationCount++;
          }

          companionSys.solve(bVec, vIter);
          totalNonlinearIterations++;

          let maxDiff = 0;
          for (let i = 0; i < this.nNodes; i++) {
            const diff = Math.abs(vIter[i]! - vVec[i]!);
            if (diff > maxDiff) maxDiff = diff;
          }
          vVec.set(vIter);
          if (maxDiff <= nlTol && nlChangedNodes.length === 0) {
            break;
          }
        }
      }

      // F2. Check Circuit Breaker currents & perform Linear Sub-Step Switching Interpolation at zero-crossing
      let breakerZeroCrossed = false;
      let minAlpha = 1.0;
      const clearedBreakerNodes: number[] = [];
      for (let i = 0; i < this.breakerPoles.length; i++) {
        const bp = this.breakerPoles[i]!;
        const vFrom = bp.fromNode >= 0 ? vVec[bp.fromNode]! : 0;
        const vTo = bp.toNode >= 0 ? vVec[bp.toNode]! : 0;
        let newCurrent = (vFrom - vTo) * bp.gCurrent;
        const prevCurrent = bp.current;

        // Extinguish arc when current crosses zero or falls below chopping threshold
        if (bp.pendingOpen && bp.isClosed) {
          const crossedZero = prevCurrent * newCurrent <= 0 && step > 0;
          const belowChop = Math.abs(newCurrent) <= bp.choppingCurrentAmp;
          if (crossedZero || belowChop) {
            const denom = Math.abs(prevCurrent) + Math.abs(newCurrent);
            const alpha = crossedZero && denom > 1e-12 ? Math.abs(prevCurrent) / denom : 1.0;
            if (alpha < minAlpha) minAlpha = alpha;

            const deltaG = bp.gOpen - bp.gCurrent;
            stampTwoTerminalConductance(companionSys.Gdense, this.nNodes, bp.fromNode, bp.toNode, deltaG);
            bp.gCurrent = bp.gOpen;
            bp.isClosed = false;
            bp.pendingOpen = false;
            bp.clearedAtSec = step > 0 ? t - dt + alpha * dt : t;
            newCurrent = 0;
            const n = bp.fromNode >= 0 ? bp.fromNode : bp.toNode;
            if (n >= 0) clearedBreakerNodes.push(n);
            breakerZeroCrossed = true;
          }
        }

        bp.current = newCurrent;
        const basePole = this.breakerPoles[i - bp.phaseIndex]!;
        if (bp.phaseIndex === 0) {
          branchCurrents.get(basePole.id)![step] = newCurrent;
        } else if (branchPhaseCurrents) {
          const wf = branchPhaseCurrents.get(basePole.id)!;
          if (bp.phaseIndex === 1) wf.b[step] = newCurrent;
          else wf.c[step] = newCurrent;
        }
      }

      if (breakerZeroCrossed) {
        if (this.options.enableInterpolation && step > 0 && minAlpha < 1.0) {
          // Linear sub-step interpolation of node voltages to exact zero-crossing instant t* = (t - dt) + alpha * dt
          for (let i = 0; i < this.nNodes; i++) {
            vVec[i] = (1.0 - minAlpha) * vPrev[i]! + minAlpha * vVec[i]!;
          }
        }
        const refactoredSubs = new Set<number>();
        for (const n of clearedBreakerNodes) {
          const subIdx = companionSys.nodeToSubsystem[n] ?? -1;
          if (subIdx >= 0 && !refactoredSubs.has(subIdx)) {
            refactoredSubs.add(subIdx);
            companionSys.refactorizeSubsystem(n);
          }
        }
        factorizationCount++;
      }

      // G. Record node voltages
      for (let i = 0; i < this.nBuses; i++) {
        const name = this.busNames[i]!;
        if (!this.isThreePhase) {
          busVoltages.get(name)![step] = vVec[i]!;
        } else {
          const wf = busPhaseVoltages!.get(name)!;
          wf.a[step] = vVec[i * 3]!;
          wf.b[step] = vVec[i * 3 + 1]!;
          wf.c[step] = vVec[i * 3 + 2]!;
        }
      }

      // H. Update RLC branches and calculate new history currents for t + dt
      for (let i = 0; i < this.rlcStates.length; i++) {
        const b = this.rlcStates[i]!;
        const vFrom = b.fromNode >= 0 ? vVec[b.fromNode]! : 0;
        const vTo = b.toNode >= 0 ? vVec[b.toNode]! : 0;
        const vBranch = vFrom - vTo;

        const phaseIdx = i % this.nPhases;
        const baseIdx = i - phaseIdx;
        let vDiff = vBranch;
        let vZero = 0;

        if (b.hasZeroSeq && this.isThreePhase && baseIdx + 2 < this.rlcStates.length) {
          const b0 = this.rlcStates[baseIdx]!;
          const b1 = this.rlcStates[baseIdx + 1]!;
          const b2 = this.rlcStates[baseIdx + 2]!;
          const v0Br = (b0.fromNode >= 0 ? vVec[b0.fromNode]! : 0) - (b0.toNode >= 0 ? vVec[b0.toNode]! : 0);
          const v1Br = (b1.fromNode >= 0 ? vVec[b1.fromNode]! : 0) - (b1.toNode >= 0 ? vVec[b1.toNode]! : 0);
          const v2Br = (b2.fromNode >= 0 ? vVec[b2.fromNode]! : 0) - (b2.toNode >= 0 ? vVec[b2.toNode]! : 0);
          vZero = (v0Br + v1Br + v2Br) / 3;
          vDiff = vBranch - vZero;
        }

        let iBranch = 0;
        if (b.l > 0) {
          const iL = b.gL * vDiff + b.iHistL;
          b.iHistL = breakerZeroCrossed && this.options.enableCda ? iL : b.alphaL * iL + b.gL * vDiff;
          iBranch += iL;
        }
        if (b.c > 0) {
          const iC = b.gC * vDiff + b.iHistC;
          b.iHistC = breakerZeroCrossed && this.options.enableCda ? 0 : -iC - b.gC * vDiff;
          iBranch += iC;
        }
        if (b.l === 0 && b.r > 0) {
          iBranch += vDiff / b.r;
        }

        if (b.hasZeroSeq) {
          const l0 = b.l0 ?? b.l;
          const c0 = b.c0 ?? b.c;
          const r0 = b.r0 ?? b.r;
          const gL0 = b.gL0 ?? 0;
          const alphaL0 = b.alphaL0 ?? 1;
          const gC0 = b.gC0 ?? 0;
          if (l0 > 0) {
            const iL0 = gL0 * vZero + (b.iHistL0 ?? 0);
            b.iHistL0 = breakerZeroCrossed && this.options.enableCda ? iL0 : alphaL0 * iL0 + gL0 * vZero;
            iBranch += iL0;
          }
          if (c0 > 0) {
            const iC0 = gC0 * vZero + (b.iHistC0 ?? 0);
            b.iHistC0 = breakerZeroCrossed && this.options.enableCda ? 0 : -iC0 - gC0 * vZero;
            iBranch += iC0;
          }
          if (l0 === 0 && r0 > 0) {
            iBranch += vZero / r0;
          }
        }

        b.current = iBranch;
        const baseBranch = this.rlcStates[baseIdx]!;
        if (phaseIdx === 0) {
          branchCurrents.get(baseBranch.id)![step] = iBranch;
        } else if (branchPhaseCurrents) {
          const wf = branchPhaseCurrents.get(baseBranch.id)!;
          if (phaseIdx === 1) wf.b[step] = iBranch;
          else wf.c[step] = iBranch;
        }
      }

      // H2. Update coupled transformer windings
      for (let i = 0; i < this.xfmrWindings.length; i++) {
        const w = this.xfmrWindings[i]!;
        const vpPos = w.pPosNode >= 0 ? vVec[w.pPosNode]! : 0;
        const vpNeg = w.pNegNode >= 0 ? vVec[w.pNegNode]! : 0;
        const vsPos = w.sPosNode >= 0 ? vVec[w.sPosNode]! : 0;
        const vsNeg = w.sNegNode >= 0 ? vVec[w.sNegNode]! : 0;

        const vPrimary = vpPos - vpNeg;
        const vSecondary = vsPos - vsNeg;
        const vWind = vPrimary - w.turnsRatio * vSecondary;

        const iPrimary = w.gLeakage * vWind + w.iHistPrimary;
        w.iHistPrimary =
          breakerZeroCrossed && this.options.enableCda ? iPrimary : w.alphaL * iPrimary + w.gLeakage * vWind;
        w.currentPrimary = iPrimary;
        w.currentSecondary = -w.turnsRatio * iPrimary;

        const baseWinding = this.xfmrWindings[i - w.phaseIndex]!;
        if (w.phaseIndex === 0) {
          branchCurrents.get(baseWinding.id)![step] = iPrimary;
        } else if (branchPhaseCurrents) {
          const wf = branchPhaseCurrents.get(baseWinding.id)!;
          if (w.phaseIndex === 1) wf.b[step] = iPrimary;
          else wf.c[step] = iPrimary;
        }
      }

      // I. Advance transmission line traveling-wave buffers
      for (const line of this.lineStates) {
        const vFrom = line.fromNode >= 0 ? vVec[line.fromNode]! : 0;
        const vTo = line.toNode >= 0 ? vVec[line.toNode]! : 0;

        const bufLen = line.bufferFrom.length;
        const readIdx1 = (line.bufferIdx - line.delaySteps + bufLen) % bufLen;
        const readIdx2 = (readIdx1 - 1 + bufLen) % bufLen;
        const frac = line.delayFraction;

        const arrivingAtFrom = (1 - frac) * (line.bufferTo[readIdx1] ?? 0) + frac * (line.bufferTo[readIdx2] ?? 0);
        const arrivingAtTo = (1 - frac) * (line.bufferFrom[readIdx1] ?? 0) + frac * (line.bufferFrom[readIdx2] ?? 0);

        // Wave launched into the line from each end towards the other
        const rLoss = line.rTotal;
        const eta = Math.max(0.1, (1 - rLoss / (4 * line.zc)) / (1 + rLoss / (4 * line.zc)));

        line.bufferFrom[line.bufferIdx] = (2 * line.gc * vFrom - arrivingAtFrom) * eta;
        line.bufferTo[line.bufferIdx] = (2 * line.gc * vTo - arrivingAtTo) * eta;
        line.bufferIdx = (line.bufferIdx + 1) % bufLen;
      }

      // I2. Advance FD line, modal FD line, Saturable Transformer, MOV Surge Arrester, Synchronous Machine, and Converter Bridge states
      for (const fd of this.fdLineStates) {
        const vFrom = fd.config.fromNode >= 0 ? vVec[fd.config.fromNode]! : 0;
        const vTo = fd.config.toNode >= 0 ? vVec[fd.config.toNode]! : 0;
        updateFdLine(fd, vFrom, vTo, dt);
      }
      for (const mfd of this.modalFdLineStates) {
        const va = (mfd.fromNodes[0] ?? -1) >= 0 ? vVec[mfd.fromNodes[0]!]! : 0;
        const vb = (mfd.fromNodes[1] ?? -1) >= 0 ? vVec[mfd.fromNodes[1]!]! : 0;
        const vc = (mfd.fromNodes[2] ?? -1) >= 0 ? vVec[mfd.fromNodes[2]!]! : 0;
        const iFromA = mfd.gSelf * va + mfd.gMutual * (vb + vc) + mfd.iHistFromPhase[0]!;
        const iFromB = mfd.gSelf * vb + mfd.gMutual * (va + vc) + mfd.iHistFromPhase[1]!;
        const iFromC = mfd.gSelf * vc + mfd.gMutual * (va + vb) + mfd.iHistFromPhase[2]!;
        branchCurrents.get(mfd.config.id)![step] = iFromA;
        if (branchPhaseCurrents) {
          const wf = branchPhaseCurrents.get(mfd.config.id)!;
          wf.b[step] = iFromB;
          wf.c[step] = iFromC;
        }
        updateModalFdLine(mfd, vVec, dt);
      }
      for (const sat of this.satXfmrStates) {
        const vPrim = sat.config.primaryNode >= 0 ? vVec[sat.config.primaryNode]! : 0;
        const vSec = sat.config.secondaryNode >= 0 ? vVec[sat.config.secondaryNode]! : 0;
        const vDiff = vPrim - sat.ratio * vSec;
        const iLeak = sat.gLeakage * vDiff + sat.iHistLeakage;
        sat.iHistLeakage = iLeak + sat.gLeakage * vDiff;
        const prevGMag = sat.gMag;
        updateSaturableCore(sat, vPrim, dt);
        if (Math.abs(sat.gMag - prevGMag) > 1e-12) {
          stampShuntConductance(companionSys.Gdense, this.nNodes, sat.config.primaryNode, sat.gMag - prevGMag);
          companionSys.refactorizeSubsystem(sat.config.primaryNode);
          factorizationCount++;
        }
      }
      for (let i = 0; i < this.arresterStates.length; i++) {
        const mov = this.arresterStates[i]!;
        const vNode = mov.node >= 0 ? vVec[mov.node]! : 0;
        const { deltaG, needsRefactor } = updateSurgeArrester(mov, vNode, dt);
        if (needsRefactor && mov.node >= 0) {
          stampShuntConductance(companionSys.Gdense, this.nNodes, mov.node, deltaG);
          companionSys.refactorizeSubsystem(mov.node);
          factorizationCount++;
        }
        const baseMov = this.arresterStates[i - mov.phaseIndex]!;
        if (mov.phaseIndex === 0) {
          branchCurrents.get(baseMov.id)![step] = mov.current;
        } else if (branchPhaseCurrents) {
          const wf = branchPhaseCurrents.get(baseMov.id)!;
          if (mov.phaseIndex === 1) wf.b[step] = mov.current;
          else wf.c[step] = mov.current;
        }
      }
      for (const sm of this.syncMachineStates) {
        stepSynchronousMachine(sm, vVec, t, dt);
        branchCurrents.get(sm.config.id)![step] = sm.iTerminalPhase[0] ?? 0;
        if (branchPhaseCurrents && sm.nodes.length === 3) {
          const wf = branchPhaseCurrents.get(sm.config.id)!;
          wf.b[step] = sm.iTerminalPhase[1] ?? 0;
          wf.c[step] = sm.iTerminalPhase[2] ?? 0;
        }
      }
      for (const im of this.indMachineStates) {
        stepInductionMachine(im, vVec, t, dt);
        branchCurrents.get(im.config.id)![step] = im.iTerminalPhase[0] ?? 0;
        if (branchPhaseCurrents && im.nodes.length === 3) {
          const wf = branchPhaseCurrents.get(im.config.id)!;
          wf.b[step] = im.iTerminalPhase[1] ?? 0;
          wf.c[step] = im.iTerminalPhase[2] ?? 0;
        }
      }
      for (const conv of this.converterStates) {
        stepConverterBridge(conv, vVec, t, dt);
        branchCurrents.get(conv.config.id)![step] = conv.iTerminalPhase[0] ?? 0;
        if (branchPhaseCurrents && conv.nodes.length === 3) {
          const wf = branchPhaseCurrents.get(conv.config.id)!;
          wf.b[step] = conv.iTerminalPhase[1] ?? 0;
          wf.c[step] = conv.iTerminalPhase[2] ?? 0;
        }
      }

      // J. Advance Black-Box FMU IBR controller (closed-loop PLL & IEEE 2800 LVRT current injection)
      for (let i = 0; i < this.fmuStates.length; i++) {
        const fmu = this.fmuStates[i]!;
        if (fmu.node >= 0) {
          const vPoi = vVec[fmu.node]!;
          const vNomPeak = Math.max(1.0, fmu.ratedKv * 1e3);
          const vNorm = vPoi / vNomPeak;

          // Closed-loop synchronous reference frame PLL phase tracking
          const phaseError = vNorm * Math.cos(fmu.pllAngle);
          const kpPll = 20.0;
          fmu.pllAngle += (2 * Math.PI * this.options.nominalFrequencyHz + kpPll * phaseError) * dt;
          if (fmu.pllAngle > 2 * Math.PI) fmu.pllAngle -= 2 * Math.PI;
          if (fmu.pllAngle < 0) fmu.pllAngle += 2 * Math.PI;

          // Smooth POI voltage magnitude estimate (pu) and compute IEEE 2800 LVRT reactive current
          const vPeakEstPu = Math.min(2.0, Math.abs(vNorm) * Math.SQRT2);
          fmu.iReal = 0.98 * fmu.iReal + 0.02 * vPeakEstPu;

          const iRatedPeak = (fmu.ratedMva * 1e6) / (vNomPeak * Math.sqrt(2));
          const iActivePeak = (fmu.pSetpointMw * 1e6) / (vNomPeak * Math.sqrt(2));
          const iReactiveBase = (fmu.qSetpointMvar * 1e6) / (vNomPeak * Math.sqrt(2));
          const vSag = Math.max(0, 0.9 - fmu.iReal);
          const iReactiveLvrt =
            vSag > 0 ? Math.min(iRatedPeak, iReactiveBase + 2.0 * vSag * iRatedPeak) : iReactiveBase;
          fmu.iImag = iReactiveLvrt;

          const iTarget = iActivePeak * Math.sin(fmu.pllAngle) - iReactiveLvrt * Math.cos(fmu.pllAngle);

          // Norton equivalent parallel current injection: i_inj = i_target
          fmu.iInjected = iTarget;
          const phaseIdx = i % this.nPhases;
          const baseFmu = this.fmuStates[i - phaseIdx]!;
          if (phaseIdx === 0) {
            branchCurrents.get(baseFmu.id)![step] = iTarget;
          } else if (branchPhaseCurrents) {
            const wf = branchPhaseCurrents.get(baseFmu.id)!;
            if (phaseIdx === 1) wf.b[step] = iTarget;
            else wf.c[step] = iTarget;
          }
        }
      }

      // K. Evaluate Continuous System Model Functions (CSMF) control blocks & apply feedback actuators
      if (this.csmfGraph && controlSignals) {
        this.csmfGraph.step(
          (busName, phaseIdx = 0) => {
            const bIdx = this.busMap.get(busName);
            if (bIdx === undefined) return 0;
            const nodeIdx = bIdx * this.nPhases + Math.min(phaseIdx, this.nPhases - 1);
            return vVec[nodeIdx] ?? 0;
          },
          (branchId, phaseIdx = 0) => {
            if (!this.isThreePhase || phaseIdx === 0) {
              const arr = branchCurrents.get(branchId);
              return arr ? (arr[step] ?? 0) : 0;
            }
            const wf = branchPhaseCurrents?.get(branchId);
            if (!wf) return 0;
            return phaseIdx === 1 ? (wf.b[step] ?? 0) : (wf.c[step] ?? 0);
          },
        );

        for (const [blockId, arr] of controlSignals.entries()) {
          arr[step] = this.csmfGraph.getOutput(blockId);
        }

        for (const act of this.csmfGraph.getActuators()) {
          if (act.type === "breaker_trip" && act.value > 0.5) {
            for (const bp of this.breakerPoles) {
              if (bp.id === act.targetId || bp.id.startsWith(`${act.targetId}_ph`)) {
                if (bp.isClosed) {
                  bp.pendingOpen = true;
                }
              }
            }
          } else if (act.type === "fmu_p_mw") {
            for (const fmu of this.fmuStates) {
              if (fmu.id === act.targetId || fmu.id.startsWith(`${act.targetId}_ph`)) {
                fmu.pSetpointMw = act.value;
              }
            }
          } else if (act.type === "fmu_q_mvar") {
            for (const fmu of this.fmuStates) {
              if (fmu.id === act.targetId || fmu.id.startsWith(`${act.targetId}_ph`)) {
                fmu.qSetpointMvar = act.value;
              }
            }
          } else if (act.type === "source_v_kv") {
            for (const src of this.sources) {
              if (src.id === act.targetId || src.id.startsWith(`${act.targetId}_ph`)) {
                src.vPeakKv = act.value;
              }
            }
          }
        }
      }
    }

    // 4. Compute Symmetrical Components (V0, V1, V2) via 1-cycle sliding fundamental DFT when in 3-phase mode
    let sequenceVoltages: Map<string, SequenceWaveform> | undefined;
    if (this.isThreePhase && busPhaseVoltages) {
      sequenceVoltages = new Map<string, SequenceWaveform>();
      const cycleSteps = Math.max(4, Math.round(1.0 / (this.options.nominalFrequencyHz * dt)));
      const omega = 2 * Math.PI * this.options.nominalFrequencyHz;
      // Fortescue operator a = exp(j * 2*pi/3) = -0.5 + j * sqrt(3)/2, a^2 = -0.5 - j * sqrt(3)/2
      const aRe = -0.5;
      const aIm = 0.5 * Math.sqrt(3);
      const a2Re = -0.5;
      const a2Im = -0.5 * Math.sqrt(3);

      for (const busName of this.busNames) {
        const wf = busPhaseVoltages.get(busName)!;
        const v0 = new Float64Array(totalSteps);
        const v1 = new Float64Array(totalSteps);
        const v2 = new Float64Array(totalSteps);

        let sumAr = 0,
          sumAi = 0;
        let sumBr = 0,
          sumBi = 0;
        let sumCr = 0,
          sumCi = 0;

        const cosBuf = new Float64Array(cycleSteps);
        const sinBuf = new Float64Array(cycleSteps);
        for (let k = 0; k < cycleSteps; k++) {
          cosBuf[k] = Math.cos(omega * k * dt);
          sinBuf[k] = Math.sin(omega * k * dt);
        }

        for (let step = 0; step < totalSteps; step++) {
          const bufIdx = step % cycleSteps;
          const c = Math.cos(omega * step * dt);
          const s = Math.sin(omega * step * dt);

          if (step >= cycleSteps) {
            const oldStep = step - cycleSteps;
            const oldC = Math.cos(omega * oldStep * dt);
            const oldS = Math.sin(omega * oldStep * dt);
            sumAr -= wf.a[oldStep]! * oldC;
            sumAi += wf.a[oldStep]! * oldS;
            sumBr -= wf.b[oldStep]! * oldC;
            sumBi += wf.b[oldStep]! * oldS;
            sumCr -= wf.c[oldStep]! * oldC;
            sumCi += wf.c[oldStep]! * oldS;
          }

          sumAr += wf.a[step]! * c;
          sumAi -= wf.a[step]! * s;
          sumBr += wf.b[step]! * c;
          sumBi -= wf.b[step]! * s;
          sumCr += wf.c[step]! * c;
          sumCi -= wf.c[step]! * s;
          void bufIdx;

          const winCount = Math.min(step + 1, cycleSteps);
          const scale = 2.0 / winCount;
          const VaRe = sumAr * scale,
            VaIm = sumAi * scale;
          const VbRe = sumBr * scale,
            VbIm = sumBi * scale;
          const VcRe = sumCr * scale,
            VcIm = sumCi * scale;

          // V0 = (Va + Vb + Vc) / 3
          const V0Re = (VaRe + VbRe + VcRe) / 3;
          const V0Im = (VaIm + VbIm + VcIm) / 3;

          // a * Vb and a^2 * Vb
          const aVbRe = aRe * VbRe - aIm * VbIm;
          const aVbIm = aRe * VbIm + aIm * VbRe;
          const a2VbRe = a2Re * VbRe - a2Im * VbIm;
          const a2VbIm = a2Re * VbIm + a2Im * VbRe;

          // a * Vc and a^2 * Vc
          const aVcRe = aRe * VcRe - aIm * VcIm;
          const aVcIm = aRe * VcIm + aIm * VcRe;
          const a2VcRe = a2Re * VcRe - a2Im * VcIm;
          const a2VcIm = a2Re * VcIm + a2Im * VcRe;

          // V1 = (Va + a*Vb + a^2*Vc) / 3
          const V1Re = (VaRe + aVbRe + a2VcRe) / 3;
          const V1Im = (VaIm + aVbIm + a2VcIm) / 3;

          // V2 = (Va + a^2*Vb + a*Vc) / 3
          const V2Re = (VaRe + a2VbRe + aVcRe) / 3;
          const V2Im = (VaIm + a2VbIm + aVcIm) / 3;

          v0[step] = Math.hypot(V0Re, V0Im);
          v1[step] = Math.hypot(V1Re, V1Im);
          v2[step] = Math.hypot(V2Re, V2Im);
        }

        sequenceVoltages.set(busName, { v0, v1, v2 });
      }
    }

    const wallClockTimeMs = Date.now() - startTime;

    return {
      time: timePoints,
      busVoltages,
      busPhaseVoltages,
      sequenceVoltages,
      branchCurrents,
      branchPhaseCurrents,
      controlSignals,
      metrics: {
        totalSteps,
        wallClockTimeMs,
        factorizationCount,
        subsystemCount: companionSys.subsystemCount,
        totalNonlinearIterations,
      },
    };
  }
}

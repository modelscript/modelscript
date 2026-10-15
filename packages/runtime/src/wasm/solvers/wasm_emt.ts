// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Native WebAssembly EMT Companion Circuit Solver Kernel.
 *
 * Implements Dommel's companion circuit algorithm for microsecond EMT simulation
 * entirely within WebAssembly linear memory with zero GC allocations.
 *
 * Academic Citations:
 *   - Dommel, H. W. (1969). "Digital Computer Solution of Electromagnetic Transients in
 *     Single-and Multiphase Networks." IEEE Transactions on Power Apparatus and Systems,
 *     PAS-88(4), pp. 388–399. DOI: 10.1109/TPAS.1969.292452.
 */

import { atomicChunkAlloc } from "../arena";
import { UnmanagedFloat64Array, DenseMatrixView } from "../core/array";
import { luFactor, luSolve } from "./matrix";

export const EMT_BRANCH_TYPE_RESISTOR: u32 = 1;
export const EMT_BRANCH_TYPE_INDUCTOR: u32 = 2;
export const EMT_BRANCH_TYPE_CAPACITOR: u32 = 3;
export const EMT_BRANCH_TYPE_PARALLEL_RLC: u32 = 4;

export const EMT_SOURCE_TYPE_AC_VOLTAGE: u32 = 1;
export const EMT_SOURCE_TYPE_DC_VOLTAGE: u32 = 2;
export const EMT_SOURCE_TYPE_AC_CURRENT: u32 = 3;
export const EMT_SOURCE_TYPE_DC_CURRENT: u32 = 4;

@unmanaged
export class WasmEmtSolver {
  nNodes: u32;
  nBranches: u32;
  maxBranches: u32;
  nSources: u32;
  maxSources: u32;
  nLines: u32;
  maxLines: u32;
  nWindings: u32;
  maxWindings: u32;
  nFaults: u32;
  maxFaults: u32;
  nBreakers: u32;
  maxBreakers: u32;
  nSatCores: u32;
  maxSatCores: u32;
  nArresters: u32;
  maxArresters: u32;
  nMachines: u32;
  maxMachines: u32;
  nConverters: u32;
  maxConverters: u32;

  dt: f64;
  t: f64;
  stepCount: u32;
  factorizationCount: u32;
  maxNonlinearIterations: u32;
  nonlinearToleranceVolts: f64;
  totalNonlinearIterations: u32;
  enableCda: bool;

  // Conductance matrix [G] (dense nNodes * nNodes)
  gDensePtr: usize;
  // Factored LU matrix (dense nNodes * nNodes)
  luFactoredPtr: usize;
  luPivPtr: usize;       // Int32Array[nNodes]
  luScalePtr: usize;     // Float64Array[nNodes]
  luScratchPtr: usize;   // Float64Array[nNodes]
  isFactorized: bool;

  // Working state vectors
  bVecPtr: usize;        // Float64Array[nNodes] - Current RHS (i_inj - i_hist)
  bBaseVecPtr: usize;    // Float64Array[nNodes] - Linear base RHS before non-linear iteration
  vVecPtr: usize;        // Float64Array[nNodes] - Node voltages solution v(t)
  vIterPtr: usize;       // Float64Array[nNodes] - Candidate non-linear iteration voltages
  vPrevPtr: usize;       // Float64Array[nNodes] - Previous step node voltages v(t - dt)

  // Branch data
  branchFromPtr: usize;      // Int32Array[maxBranches]
  branchToPtr: usize;        // Int32Array[maxBranches]
  branchTypePtr: usize;      // Uint32Array[maxBranches]
  branchGLPtr: usize;        // Float64Array[maxBranches]
  branchAlphaLPtr: usize;    // Float64Array[maxBranches]
  branchGCPtr: usize;        // Float64Array[maxBranches]
  branchGRPtr: usize;        // Float64Array[maxBranches]
  branchGTotalPtr: usize;    // Float64Array[maxBranches]
  branchIHistLPtr: usize;    // Float64Array[maxBranches]
  branchIHistCPtr: usize;    // Float64Array[maxBranches]
  branchCurrentPtr: usize;   // Float64Array[maxBranches]

  // Source data
  sourceNodePtr: usize;      // Int32Array[maxSources]
  sourceTypePtr: usize;      // Uint32Array[maxSources]
  sourceVPeakPtr: usize;     // Float64Array[maxSources]
  sourceOmegaPtr: usize;     // Float64Array[maxSources]
  sourcePhasePtr: usize;     // Float64Array[maxSources]
  sourceGPtr: usize;         // Float64Array[maxSources]

  // Bergeron Traveling-Wave Line data
  lineFromPtr: usize;        // Int32Array[maxLines]
  lineToPtr: usize;          // Int32Array[maxLines]
  lineGcPtr: usize;          // Float64Array[maxLines]
  lineEtaPtr: usize;         // Float64Array[maxLines]
  lineDelayStepsPtr: usize;  // Int32Array[maxLines]
  lineDelayFracPtr: usize;   // Float64Array[maxLines]
  lineBufLenPtr: usize;      // Int32Array[maxLines]
  lineBufIdxPtr: usize;      // Int32Array[maxLines]
  lineBufFromPtrs: usize;    // usize[maxLines]
  lineBufToPtrs: usize;      // usize[maxLines]

  // 4-Terminal Coupled Transformer Winding data
  xfmrPPosPtr: usize;        // Int32Array[maxWindings]
  xfmrPNegPtr: usize;        // Int32Array[maxWindings]
  xfmrSPosPtr: usize;        // Int32Array[maxWindings]
  xfmrSNegPtr: usize;        // Int32Array[maxWindings]
  xfmrGLeakagePtr: usize;    // Float64Array[maxWindings]
  xfmrAlphaLPtr: usize;      // Float64Array[maxWindings]
  xfmrTurnsRatioPtr: usize;  // Float64Array[maxWindings]
  xfmrIHistPtr: usize;       // Float64Array[maxWindings]
  xfmrCurrentPPtr: usize;    // Float64Array[maxWindings]

  // Time-Switched Fault data
  faultNodeAPtr: usize;      // Int32Array[maxFaults]
  faultNodeBPtr: usize;      // Int32Array[maxFaults]
  faultStartSecPtr: usize;   // Float64Array[maxFaults]
  faultEndSecPtr: usize;     // Float64Array[maxFaults]
  faultGPtr: usize;          // Float64Array[maxFaults]
  faultActivePtr: usize;     // Uint32Array[maxFaults]

  // Circuit Breaker Pole data (with current zero-crossing & sub-step interpolation)
  brkFromPtr: usize;         // Int32Array[maxBreakers]
  brkToPtr: usize;           // Int32Array[maxBreakers]
  brkGClosedPtr: usize;      // Float64Array[maxBreakers]
  brkGOpenPtr: usize;        // Float64Array[maxBreakers]
  brkGCurrentPtr: usize;     // Float64Array[maxBreakers]
  brkOpenTimePtr: usize;     // Float64Array[maxBreakers]
  brkCloseTimePtr: usize;    // Float64Array[maxBreakers]
  brkChopAmpPtr: usize;      // Float64Array[maxBreakers]
  brkCurrentPtr: usize;      // Float64Array[maxBreakers]
  brkStatePtr: usize;        // Uint32Array[maxBreakers] (0=open, 1=closed, 2=pendingOpen, 3=cleared)

  // Non-Linear Saturable Core data
  satNodePtr: usize;         // Int32Array[maxSatCores]
  satLUnsatPtr: usize;       // Float64Array[maxSatCores]
  satLSatPtr: usize;         // Float64Array[maxSatCores]
  satKneeFluxPtr: usize;     // Float64Array[maxSatCores]
  satFluxPtr: usize;         // Float64Array[maxSatCores]
  satVPrevPtr: usize;        // Float64Array[maxSatCores]
  satGCurrentPtr: usize;     // Float64Array[maxSatCores]
  satIHistPtr: usize;        // Float64Array[maxSatCores]

  // Non-Linear MOV Surge Arrester data (IEEE Std C62.22 piecewise V-I)
  arrFromPtr: usize;         // Int32Array[maxArresters]
  arrToPtr: usize;           // Int32Array[maxArresters]
  arrVRefPtr: usize;         // Float64Array[maxArresters]
  arrGCurrentPtr: usize;     // Float64Array[maxArresters]
  arrIHistPtr: usize;        // Float64Array[maxArresters]
  arrCurrentPtr: usize;      // Float64Array[maxArresters]
  arrEnergyJPtr: usize;      // Float64Array[maxArresters]

  // 6th-Order Subtransient Park d-q Synchronous Machine data
  macNodeAPtr: usize;        // Int32Array[maxMachines]
  macNodeBPtr: usize;        // Int32Array[maxMachines]
  macNodeCPtr: usize;        // Int32Array[maxMachines]
  macVBasePeakPtr: usize;    // Float64Array[maxMachines]
  macIBasePeakPtr: usize;    // Float64Array[maxMachines]
  macOmegaSyncPtr: usize;    // Float64Array[maxMachines]
  macGSubPtr: usize;         // Float64Array[maxMachines]
  macXdPtr: usize;           // Float64Array[maxMachines]
  macXqPtr: usize;           // Float64Array[maxMachines]
  macXdPrimePtr: usize;      // Float64Array[maxMachines]
  macXqPrimePtr: usize;      // Float64Array[maxMachines]
  macXdSubPtr: usize;        // Float64Array[maxMachines]
  macTd0PrimePtr: usize;     // Float64Array[maxMachines]
  macTq0PrimePtr: usize;     // Float64Array[maxMachines]
  macTd0SubPtr: usize;       // Float64Array[maxMachines]
  macTq0SubPtr: usize;       // Float64Array[maxMachines]
  macHInertiaPtr: usize;     // Float64Array[maxMachines]
  macDampingPtr: usize;      // Float64Array[maxMachines]
  macPmPuPtr: usize;         // Float64Array[maxMachines]
  macEfPuPtr: usize;         // Float64Array[maxMachines]
  macDeltaRadPtr: usize;     // Float64Array[maxMachines]
  macOmegaPuPtr: usize;      // Float64Array[maxMachines]
  macEqPrimePtr: usize;      // Float64Array[maxMachines]
  macEdPrimePtr: usize;      // Float64Array[maxMachines]
  macEqSubPtr: usize;        // Float64Array[maxMachines]
  macEdSubPtr: usize;        // Float64Array[maxMachines]
  macTePuPtr: usize;         // Float64Array[maxMachines]

  // Power Electronics Converter Bridge data (0=vsc_pwm, 1=lcc_6pulse, 2=mmc_thevenin)
  convNodeAPtr: usize;       // Int32Array[maxConverters]
  convNodeBPtr: usize;       // Int32Array[maxConverters]
  convNodeCPtr: usize;       // Int32Array[maxConverters]
  convTopologyPtr: usize;    // Uint32Array[maxConverters]
  convVBasePeakPtr: usize;   // Float64Array[maxConverters]
  convVdcVoltsPtr: usize;    // Float64Array[maxConverters]
  convOmegaSyncPtr: usize;   // Float64Array[maxConverters]
  convGFilterPtr: usize;     // Float64Array[maxConverters]
  convCarrierFreqPtr: usize; // Float64Array[maxConverters]
  convAlphaRadPtr: usize;    // Float64Array[maxConverters]
  convModIndexPtr: usize;    // Float64Array[maxConverters]
  convNumSmPtr: usize;       // Uint32Array[maxConverters]
  convVcAvgPtr: usize;       // Float64Array[maxConverters]
  convPllThetaPtr: usize;    // Float64Array[maxConverters]
  convIInjAPtr: usize;       // Float64Array[maxConverters]
  convIInjBPtr: usize;       // Float64Array[maxConverters]
  convIInjCPtr: usize;       // Float64Array[maxConverters]

  // Trajectory recording buffer in linear memory (zero-copy streaming)
  trajectoryBufferPtr: usize;
  trajectoryCapacitySteps: u32;
  trajectoryRecordedSteps: u32;
  stridePerStep: u32;        // 1 (time) + nNodes

  init(nNodes: u32, maxBranches: u32, maxSources: u32, dt: f64): void {
    this.nNodes = nNodes;
    this.maxBranches = maxBranches > 0 ? maxBranches : 64;
    this.maxSources = maxSources > 0 ? maxSources : 16;
    this.maxLines = 32;
    this.maxWindings = 32;
    this.maxFaults = 16;
    this.maxBreakers = 32;
    this.maxSatCores = 16;
    this.maxArresters = 16;
    this.maxMachines = 8;
    this.maxConverters = 8;

    this.nBranches = 0;
    this.nSources = 0;
    this.nLines = 0;
    this.nWindings = 0;
    this.nFaults = 0;
    this.nBreakers = 0;
    this.nSatCores = 0;
    this.nArresters = 0;
    this.nMachines = 0;
    this.nConverters = 0;

    this.dt = dt;
    this.t = 0.0;
    this.stepCount = 0;
    this.factorizationCount = 0;
    this.maxNonlinearIterations = 1;
    this.nonlinearToleranceVolts = 1.0;
    this.totalNonlinearIterations = 0;
    this.enableCda = true;
    this.isFactorized = false;

    // Allocate matrix and vectors
    let matSize = nNodes * nNodes;
    this.gDensePtr = atomicChunkAlloc(matSize * sizeof<f64>());
    this.luFactoredPtr = atomicChunkAlloc(matSize * sizeof<f64>());
    this.luPivPtr = atomicChunkAlloc(nNodes * sizeof<i32>());
    this.luScalePtr = atomicChunkAlloc(nNodes * sizeof<f64>());
    this.luScratchPtr = atomicChunkAlloc(nNodes * sizeof<f64>());

    this.bVecPtr = atomicChunkAlloc(nNodes * sizeof<f64>());
    this.bBaseVecPtr = atomicChunkAlloc(nNodes * sizeof<f64>());
    this.vVecPtr = atomicChunkAlloc(nNodes * sizeof<f64>());
    this.vIterPtr = atomicChunkAlloc(nNodes * sizeof<f64>());
    this.vPrevPtr = atomicChunkAlloc(nNodes * sizeof<f64>());

    // Allocate branch buffers
    this.branchFromPtr = atomicChunkAlloc(this.maxBranches * sizeof<i32>());
    this.branchToPtr = atomicChunkAlloc(this.maxBranches * sizeof<i32>());
    this.branchTypePtr = atomicChunkAlloc(this.maxBranches * sizeof<u32>());
    this.branchGLPtr = atomicChunkAlloc(this.maxBranches * sizeof<f64>());
    this.branchAlphaLPtr = atomicChunkAlloc(this.maxBranches * sizeof<f64>());
    this.branchGCPtr = atomicChunkAlloc(this.maxBranches * sizeof<f64>());
    this.branchGRPtr = atomicChunkAlloc(this.maxBranches * sizeof<f64>());
    this.branchGTotalPtr = atomicChunkAlloc(this.maxBranches * sizeof<f64>());
    this.branchIHistLPtr = atomicChunkAlloc(this.maxBranches * sizeof<f64>());
    this.branchIHistCPtr = atomicChunkAlloc(this.maxBranches * sizeof<f64>());
    this.branchCurrentPtr = atomicChunkAlloc(this.maxBranches * sizeof<f64>());

    // Allocate source buffers
    this.sourceNodePtr = atomicChunkAlloc(this.maxSources * sizeof<i32>());
    this.sourceTypePtr = atomicChunkAlloc(this.maxSources * sizeof<u32>());
    this.sourceVPeakPtr = atomicChunkAlloc(this.maxSources * sizeof<f64>());
    this.sourceOmegaPtr = atomicChunkAlloc(this.maxSources * sizeof<f64>());
    this.sourcePhasePtr = atomicChunkAlloc(this.maxSources * sizeof<f64>());
    this.sourceGPtr = atomicChunkAlloc(this.maxSources * sizeof<f64>());

    // Allocate Bergeron line buffers
    this.lineFromPtr = atomicChunkAlloc(this.maxLines * sizeof<i32>());
    this.lineToPtr = atomicChunkAlloc(this.maxLines * sizeof<i32>());
    this.lineGcPtr = atomicChunkAlloc(this.maxLines * sizeof<f64>());
    this.lineEtaPtr = atomicChunkAlloc(this.maxLines * sizeof<f64>());
    this.lineDelayStepsPtr = atomicChunkAlloc(this.maxLines * sizeof<i32>());
    this.lineDelayFracPtr = atomicChunkAlloc(this.maxLines * sizeof<f64>());
    this.lineBufLenPtr = atomicChunkAlloc(this.lineMaxAlloc());
    this.lineBufIdxPtr = atomicChunkAlloc(this.maxLines * sizeof<i32>());
    this.lineBufFromPtrs = atomicChunkAlloc(this.maxLines * sizeof<usize>());
    this.lineBufToPtrs = atomicChunkAlloc(this.maxLines * sizeof<usize>());

    // Allocate transformer winding buffers
    this.xfmrPPosPtr = atomicChunkAlloc(this.maxWindings * sizeof<i32>());
    this.xfmrPNegPtr = atomicChunkAlloc(this.maxWindings * sizeof<i32>());
    this.xfmrSPosPtr = atomicChunkAlloc(this.maxWindings * sizeof<i32>());
    this.xfmrSNegPtr = atomicChunkAlloc(this.maxWindings * sizeof<i32>());
    this.xfmrGLeakagePtr = atomicChunkAlloc(this.maxWindings * sizeof<f64>());
    this.xfmrAlphaLPtr = atomicChunkAlloc(this.maxWindings * sizeof<f64>());
    this.xfmrTurnsRatioPtr = atomicChunkAlloc(this.maxWindings * sizeof<f64>());
    this.xfmrIHistPtr = atomicChunkAlloc(this.maxWindings * sizeof<f64>());
    this.xfmrCurrentPPtr = atomicChunkAlloc(this.maxWindings * sizeof<f64>());

    // Allocate fault buffers
    this.faultNodeAPtr = atomicChunkAlloc(this.maxFaults * sizeof<i32>());
    this.faultNodeBPtr = atomicChunkAlloc(this.maxFaults * sizeof<i32>());
    this.faultStartSecPtr = atomicChunkAlloc(this.maxFaults * sizeof<f64>());
    this.faultEndSecPtr = atomicChunkAlloc(this.maxFaults * sizeof<f64>());
    this.faultGPtr = atomicChunkAlloc(this.maxFaults * sizeof<f64>());
    this.faultActivePtr = atomicChunkAlloc(this.maxFaults * sizeof<u32>());

    // Allocate breaker buffers
    this.brkFromPtr = atomicChunkAlloc(this.maxBreakers * sizeof<i32>());
    this.brkToPtr = atomicChunkAlloc(this.maxBreakers * sizeof<i32>());
    this.brkGClosedPtr = atomicChunkAlloc(this.maxBreakers * sizeof<f64>());
    this.brkGOpenPtr = atomicChunkAlloc(this.maxBreakers * sizeof<f64>());
    this.brkGCurrentPtr = atomicChunkAlloc(this.maxBreakers * sizeof<f64>());
    this.brkOpenTimePtr = atomicChunkAlloc(this.maxBreakers * sizeof<f64>());
    this.brkCloseTimePtr = atomicChunkAlloc(this.maxBreakers * sizeof<f64>());
    this.brkChopAmpPtr = atomicChunkAlloc(this.maxBreakers * sizeof<f64>());
    this.brkCurrentPtr = atomicChunkAlloc(this.maxBreakers * sizeof<f64>());
    this.brkStatePtr = atomicChunkAlloc(this.maxBreakers * sizeof<u32>());

    // Allocate saturable core buffers
    this.satNodePtr = atomicChunkAlloc(this.maxSatCores * sizeof<i32>());
    this.satLUnsatPtr = atomicChunkAlloc(this.maxSatCores * sizeof<f64>());
    this.satLSatPtr = atomicChunkAlloc(this.maxSatCores * sizeof<f64>());
    this.satKneeFluxPtr = atomicChunkAlloc(this.maxSatCores * sizeof<f64>());
    this.satFluxPtr = atomicChunkAlloc(this.maxSatCores * sizeof<f64>());
    this.satVPrevPtr = atomicChunkAlloc(this.maxSatCores * sizeof<f64>());
    this.satGCurrentPtr = atomicChunkAlloc(this.maxSatCores * sizeof<f64>());
    this.satIHistPtr = atomicChunkAlloc(this.maxSatCores * sizeof<f64>());

    // Allocate surge arrester buffers
    this.arrFromPtr = atomicChunkAlloc(this.maxArresters * sizeof<i32>());
    this.arrToPtr = atomicChunkAlloc(this.maxArresters * sizeof<i32>());
    this.arrVRefPtr = atomicChunkAlloc(this.maxArresters * sizeof<f64>());
    this.arrGCurrentPtr = atomicChunkAlloc(this.maxArresters * sizeof<f64>());
    this.arrIHistPtr = atomicChunkAlloc(this.maxArresters * sizeof<f64>());
    this.arrCurrentPtr = atomicChunkAlloc(this.maxArresters * sizeof<f64>());
    this.arrEnergyJPtr = atomicChunkAlloc(this.maxArresters * sizeof<f64>());

    // Allocate synchronous machine buffers
    this.macNodeAPtr = atomicChunkAlloc(this.maxMachines * sizeof<i32>());
    this.macNodeBPtr = atomicChunkAlloc(this.maxMachines * sizeof<i32>());
    this.macNodeCPtr = atomicChunkAlloc(this.maxMachines * sizeof<i32>());
    this.macVBasePeakPtr = atomicChunkAlloc(this.maxMachines * sizeof<f64>());
    this.macIBasePeakPtr = atomicChunkAlloc(this.maxMachines * sizeof<f64>());
    this.macOmegaSyncPtr = atomicChunkAlloc(this.maxMachines * sizeof<f64>());
    this.macGSubPtr = atomicChunkAlloc(this.maxMachines * sizeof<f64>());
    this.macXdPtr = atomicChunkAlloc(this.maxMachines * sizeof<f64>());
    this.macXqPtr = atomicChunkAlloc(this.maxMachines * sizeof<f64>());
    this.macXdPrimePtr = atomicChunkAlloc(this.maxMachines * sizeof<f64>());
    this.macXqPrimePtr = atomicChunkAlloc(this.maxMachines * sizeof<f64>());
    this.macXdSubPtr = atomicChunkAlloc(this.maxMachines * sizeof<f64>());
    this.macTd0PrimePtr = atomicChunkAlloc(this.maxMachines * sizeof<f64>());
    this.macTq0PrimePtr = atomicChunkAlloc(this.maxMachines * sizeof<f64>());
    this.macTd0SubPtr = atomicChunkAlloc(this.maxMachines * sizeof<f64>());
    this.macTq0SubPtr = atomicChunkAlloc(this.maxMachines * sizeof<f64>());
    this.macHInertiaPtr = atomicChunkAlloc(this.maxMachines * sizeof<f64>());
    this.macDampingPtr = atomicChunkAlloc(this.maxMachines * sizeof<f64>());
    this.macPmPuPtr = atomicChunkAlloc(this.maxMachines * sizeof<f64>());
    this.macEfPuPtr = atomicChunkAlloc(this.maxMachines * sizeof<f64>());
    this.macDeltaRadPtr = atomicChunkAlloc(this.maxMachines * sizeof<f64>());
    this.macOmegaPuPtr = atomicChunkAlloc(this.maxMachines * sizeof<f64>());
    this.macEqPrimePtr = atomicChunkAlloc(this.maxMachines * sizeof<f64>());
    this.macEdPrimePtr = atomicChunkAlloc(this.maxMachines * sizeof<f64>());
    this.macEqSubPtr = atomicChunkAlloc(this.maxMachines * sizeof<f64>());
    this.macEdSubPtr = atomicChunkAlloc(this.maxMachines * sizeof<f64>());
    this.macTePuPtr = atomicChunkAlloc(this.maxMachines * sizeof<f64>());

    // Allocate converter bridge buffers
    this.convNodeAPtr = atomicChunkAlloc(this.maxConverters * sizeof<i32>());
    this.convNodeBPtr = atomicChunkAlloc(this.maxConverters * sizeof<i32>());
    this.convNodeCPtr = atomicChunkAlloc(this.maxConverters * sizeof<i32>());
    this.convTopologyPtr = atomicChunkAlloc(this.maxConverters * sizeof<u32>());
    this.convVBasePeakPtr = atomicChunkAlloc(this.maxConverters * sizeof<f64>());
    this.convVdcVoltsPtr = atomicChunkAlloc(this.maxConverters * sizeof<f64>());
    this.convOmegaSyncPtr = atomicChunkAlloc(this.maxConverters * sizeof<f64>());
    this.convGFilterPtr = atomicChunkAlloc(this.maxConverters * sizeof<f64>());
    this.convCarrierFreqPtr = atomicChunkAlloc(this.maxConverters * sizeof<f64>());
    this.convAlphaRadPtr = atomicChunkAlloc(this.maxConverters * sizeof<f64>());
    this.convModIndexPtr = atomicChunkAlloc(this.maxConverters * sizeof<f64>());
    this.convNumSmPtr = atomicChunkAlloc(this.maxConverters * sizeof<u32>());
    this.convVcAvgPtr = atomicChunkAlloc(this.maxConverters * sizeof<f64>());
    this.convPllThetaPtr = atomicChunkAlloc(this.maxConverters * sizeof<f64>());
    this.convIInjAPtr = atomicChunkAlloc(this.maxConverters * sizeof<f64>());
    this.convIInjBPtr = atomicChunkAlloc(this.maxConverters * sizeof<f64>());
    this.convIInjCPtr = atomicChunkAlloc(this.maxConverters * sizeof<f64>());

    this.trajectoryBufferPtr = 0;
    this.trajectoryCapacitySteps = 0;
    this.trajectoryRecordedSteps = 0;
    this.stridePerStep = 1 + nNodes;
  }

  @inline
  private lineMaxAlloc(): u32 {
    return this.maxLines * sizeof<i32>();
  }

  addBranch(fromNode: i32, toNode: i32, r: f64, l: f64, c: f64): i32 {
    if (this.nBranches >= this.maxBranches) return -1;
    let idx = this.nBranches++;

    let gR: f64 = r > 0.0 ? 1.0 / r : 0.0;
    let rEff: f64 = r > 0.0 ? r : 0.0;
    let gL: f64 = l > 0.0 ? this.dt / (2.0 * l + rEff * this.dt) : 0.0;
    let alphaL: f64 = l > 0.0 ? (2.0 * l - rEff * this.dt) / (2.0 * l + rEff * this.dt) : 1.0;
    let gC: f64 = c > 0.0 ? (2.0 * c) / this.dt : 0.0;
    let gTotal: f64 = l > 0.0 ? (gL + gC) : (c > 0.0 ? (gC + gR) : (r > 0.0 ? gR : 1e4));

    let type: u32 = EMT_BRANCH_TYPE_PARALLEL_RLC;
    if (l == 0.0 && c == 0.0) type = EMT_BRANCH_TYPE_RESISTOR;
    else if (r == 0.0 && c == 0.0) type = EMT_BRANCH_TYPE_INDUCTOR;
    else if (r == 0.0 && l == 0.0) type = EMT_BRANCH_TYPE_CAPACITOR;

    store<i32>(this.branchFromPtr + (((idx as usize)) << 2), fromNode);
    store<i32>(this.branchToPtr + (((idx as usize)) << 2), toNode);
    store<u32>(this.branchTypePtr + (((idx as usize)) << 2), type);
    store<f64>(this.branchGLPtr + (((idx as usize)) << 3), gL);
    store<f64>(this.branchAlphaLPtr + (((idx as usize)) << 3), alphaL);
    store<f64>(this.branchGCPtr + (((idx as usize)) << 3), gC);
    store<f64>(this.branchGRPtr + (((idx as usize)) << 3), gR);
    store<f64>(this.branchGTotalPtr + (((idx as usize)) << 3), gTotal);
    store<f64>(this.branchIHistLPtr + (((idx as usize)) << 3), 0.0);
    store<f64>(this.branchIHistCPtr + (((idx as usize)) << 3), 0.0);
    store<f64>(this.branchCurrentPtr + (((idx as usize)) << 3), 0.0);

    return idx as i32;
  }

  addSource(node: i32, vPeakKv: f64, freqHz: f64, phaseRad: f64, gSource: f64, type: u32): i32 {
    if (this.nSources >= this.maxSources) return -1;
    let idx = this.nSources++;

    let omega = 2.0 * Math.PI * freqHz;
    let vPeak = vPeakKv * 1000.0; // Convert kV to V

    store<i32>(this.sourceNodePtr + (((idx as usize)) << 2), node);
    store<u32>(this.sourceTypePtr + (((idx as usize)) << 2), type);
    store<f64>(this.sourceVPeakPtr + (((idx as usize)) << 3), vPeak);
    store<f64>(this.sourceOmegaPtr + (((idx as usize)) << 3), omega);
    store<f64>(this.sourcePhasePtr + (((idx as usize)) << 3), phaseRad);
    store<f64>(this.sourceGPtr + (((idx as usize)) << 3), gSource > 0.0 ? gSource : 1000.0);

    return idx as i32;
  }

  addBergeronLine(fromNode: i32, toNode: i32, zc: f64, tauSec: f64, rTotal: f64): i32 {
    if (this.nLines >= this.maxLines) return -1;
    let idx = this.nLines++;

    let exactSteps: f64 = tauSec / this.dt;
    if (exactSteps < 1.0) exactSteps = 1.0;
    let delaySteps: i32 = <i32>Math.floor(exactSteps);
    if (delaySteps < 1) delaySteps = 1;
    let delayFrac: f64 = exactSteps - <f64>delaySteps;
    let bufLen: i32 = delaySteps + 2;

    let gc: f64 = zc > 0.0 ? 1.0 / zc : 1.0 / 300.0;
    let ratio: f64 = rTotal / (4.0 * (zc > 0.0 ? zc : 300.0));
    let eta: f64 = (1.0 - ratio) / (1.0 + ratio);
    if (eta < 0.1) eta = 0.1;

    let bufFrom = atomicChunkAlloc((bufLen as u32) * sizeof<f64>());
    let bufTo = atomicChunkAlloc((bufLen as u32) * sizeof<f64>());
    for (let k: i32 = 0; k < bufLen; k++) {
      store<f64>(bufFrom + (((k as usize)) << 3), 0.0);
      store<f64>(bufTo + (((k as usize)) << 3), 0.0);
    }

    store<i32>(this.lineFromPtr + (((idx as usize)) << 2), fromNode);
    store<i32>(this.lineToPtr + (((idx as usize)) << 2), toNode);
    store<f64>(this.lineGcPtr + (((idx as usize)) << 3), gc);
    store<f64>(this.lineEtaPtr + (((idx as usize)) << 3), eta);
    store<i32>(this.lineDelayStepsPtr + (((idx as usize)) << 2), delaySteps);
    store<f64>(this.lineDelayFracPtr + (((idx as usize)) << 3), delayFrac);
    store<i32>(this.lineBufLenPtr + (((idx as usize)) << 2), bufLen);
    store<i32>(this.lineBufIdxPtr + (((idx as usize)) << 2), 0);
    store<usize>(this.lineBufFromPtrs + ((idx as usize) * sizeof<usize>()), bufFrom);
    store<usize>(this.lineBufToPtrs + ((idx as usize) * sizeof<usize>()), bufTo);

    return idx as i32;
  }

  addTransformerWinding(
    pPos: i32,
    pNeg: i32,
    sPos: i32,
    sNeg: i32,
    gLeakage: f64,
    alphaL: f64,
    turnsRatio: f64
  ): i32 {
    if (this.nWindings >= this.maxWindings) return -1;
    let idx = this.nWindings++;

    store<i32>(this.xfmrPPosPtr + (((idx as usize)) << 2), pPos);
    store<i32>(this.xfmrPNegPtr + (((idx as usize)) << 2), pNeg);
    store<i32>(this.xfmrSPosPtr + (((idx as usize)) << 2), sPos);
    store<i32>(this.xfmrSNegPtr + (((idx as usize)) << 2), sNeg);
    store<f64>(this.xfmrGLeakagePtr + (((idx as usize)) << 3), gLeakage);
    store<f64>(this.xfmrAlphaLPtr + (((idx as usize)) << 3), alphaL);
    store<f64>(this.xfmrTurnsRatioPtr + (((idx as usize)) << 3), turnsRatio);
    store<f64>(this.xfmrIHistPtr + (((idx as usize)) << 3), 0.0);
    store<f64>(this.xfmrCurrentPPtr + (((idx as usize)) << 3), 0.0);

    return idx as i32;
  }

  addFault(nodeA: i32, nodeB: i32, startSec: f64, endSec: f64, gFault: f64): i32 {
    if (this.nFaults >= this.maxFaults) return -1;
    let idx = this.nFaults++;

    store<i32>(this.faultNodeAPtr + (((idx as usize)) << 2), nodeA);
    store<i32>(this.faultNodeBPtr + (((idx as usize)) << 2), nodeB);
    store<f64>(this.faultStartSecPtr + (((idx as usize)) << 3), startSec);
    store<f64>(this.faultEndSecPtr + (((idx as usize)) << 3), endSec);
    store<f64>(this.faultGPtr + (((idx as usize)) << 3), gFault);
    store<u32>(this.faultActivePtr + (((idx as usize)) << 2), 0);

    return idx as i32;
  }

  addBreaker(
    fromNode: i32,
    toNode: i32,
    gClosed: f64,
    gOpen: f64,
    closedInitially: bool,
    openTimeSec: f64,
    closeTimeSec: f64,
    choppingCurrentAmp: f64
  ): i32 {
    if (this.nBreakers >= this.maxBreakers) return -1;
    let idx = this.nBreakers++;

    let gInit = closedInitially ? gClosed : gOpen;
    let stateInit: u32 = closedInitially ? 1 : 0;

    store<i32>(this.brkFromPtr + (((idx as usize)) << 2), fromNode);
    store<i32>(this.brkToPtr + (((idx as usize)) << 2), toNode);
    store<f64>(this.brkGClosedPtr + (((idx as usize)) << 3), gClosed);
    store<f64>(this.brkGOpenPtr + (((idx as usize)) << 3), gOpen);
    store<f64>(this.brkGCurrentPtr + (((idx as usize)) << 3), gInit);
    store<f64>(this.brkOpenTimePtr + (((idx as usize)) << 3), openTimeSec);
    store<f64>(this.brkCloseTimePtr + (((idx as usize)) << 3), closeTimeSec);
    store<f64>(this.brkChopAmpPtr + (((idx as usize)) << 3), choppingCurrentAmp);
    store<f64>(this.brkCurrentPtr + (((idx as usize)) << 3), 0.0);
    store<u32>(this.brkStatePtr + (((idx as usize)) << 2), stateInit);

    return idx as i32;
  }

  addSaturableCore(
    node: i32,
    lUnsatH: f64,
    lSatH: f64,
    kneeFluxWb: f64,
    remanentFluxWb: f64
  ): i32 {
    if (this.nSatCores >= this.maxSatCores) return -1;
    let idx = this.nSatCores++;

    let gInit = this.dt / (2.0 * lUnsatH);

    store<i32>(this.satNodePtr + (((idx as usize)) << 2), node);
    store<f64>(this.satLUnsatPtr + (((idx as usize)) << 3), lUnsatH);
    store<f64>(this.satLSatPtr + (((idx as usize)) << 3), lSatH);
    store<f64>(this.satKneeFluxPtr + (((idx as usize)) << 3), kneeFluxWb);
    store<f64>(this.satFluxPtr + (((idx as usize)) << 3), remanentFluxWb);
    store<f64>(this.satVPrevPtr + (((idx as usize)) << 3), 0.0);
    store<f64>(this.satGCurrentPtr + (((idx as usize)) << 3), gInit);
    store<f64>(this.satIHistPtr + (((idx as usize)) << 3), 0.0);

    return idx as i32;
  }

  addSurgeArrester(fromNode: i32, toNode: i32, vRefVolts: f64): i32 {
    if (this.nArresters >= this.maxArresters) return -1;
    let idx = this.nArresters++;

    let vRef = vRefVolts > 100.0 ? vRefVolts : 100.0;
    // Initial leakage conductance in Segment 0: (1e-3 A) / (0.85 * vRef)
    let gInit = 1e-3 / (0.85 * vRef);

    store<i32>(this.arrFromPtr + (((idx as usize)) << 2), fromNode);
    store<i32>(this.arrToPtr + (((idx as usize)) << 2), toNode);
    store<f64>(this.arrVRefPtr + (((idx as usize)) << 3), vRef);
    store<f64>(this.arrGCurrentPtr + (((idx as usize)) << 3), gInit);
    store<f64>(this.arrIHistPtr + (((idx as usize)) << 3), 0.0);
    store<f64>(this.arrCurrentPtr + (((idx as usize)) << 3), 0.0);
    store<f64>(this.arrEnergyJPtr + (((idx as usize)) << 3), 0.0);

    return idx as i32;
  }

  addSynchronousMachine(
    nodeA: i32,
    nodeB: i32,
    nodeC: i32,
    sBaseMva: f64,
    vBaseKvLL: f64,
    freqHz: f64,
    xd: f64,
    xq: f64,
    xdPrime: f64,
    xqPrime: f64,
    xdSub: f64,
    td0Prime: f64,
    tq0Prime: f64,
    td0Sub: f64,
    tq0Sub: f64,
    hInertia: f64,
    dampingD: f64,
    pmPu: f64,
    efPu: f64
  ): i32 {
    if (this.nMachines >= this.maxMachines) return -1;
    let idx = this.nMachines++;

    let vBasePeak = (vBaseKvLL * 1000.0) * Math.sqrt(2.0 / 3.0);
    let sBaseVa = sBaseMva * 1e6;
    let iBasePeak = (2.0 * sBaseVa) / (3.0 * vBasePeak);
    let zBase = (vBaseKvLL * vBaseKvLL) / Math.max(1e-3, sBaseMva);
    let xSub = xdSub > 1e-4 ? xdSub : 0.2;
    let gSub = 1.0 / Math.max(1e-4, xSub * zBase);
    let omegaSync = 2.0 * Math.PI * freqHz;

    let arg = (pmPu * xdPrime) / (efPu > 0.1 ? efPu : 0.1);
    if (arg > 0.9) arg = 0.9;
    if (arg < -0.9) arg = -0.9;
    let delta0 = Math.asin(arg);

    store<i32>(this.macNodeAPtr + (((idx as usize)) << 2), nodeA);
    store<i32>(this.macNodeBPtr + (((idx as usize)) << 2), nodeB);
    store<i32>(this.macNodeCPtr + (((idx as usize)) << 2), nodeC);
    store<f64>(this.macVBasePeakPtr + (((idx as usize)) << 3), vBasePeak);
    store<f64>(this.macIBasePeakPtr + (((idx as usize)) << 3), iBasePeak);
    store<f64>(this.macOmegaSyncPtr + (((idx as usize)) << 3), omegaSync);
    store<f64>(this.macGSubPtr + (((idx as usize)) << 3), gSub);
    store<f64>(this.macXdPtr + (((idx as usize)) << 3), xd);
    store<f64>(this.macXqPtr + (((idx as usize)) << 3), xq);
    store<f64>(this.macXdPrimePtr + (((idx as usize)) << 3), xdPrime);
    store<f64>(this.macXqPrimePtr + (((idx as usize)) << 3), xqPrime);
    store<f64>(this.macXdSubPtr + (((idx as usize)) << 3), xSub);
    store<f64>(this.macTd0PrimePtr + (((idx as usize)) << 3), td0Prime > 1e-3 ? td0Prime : 5.0);
    store<f64>(this.macTq0PrimePtr + (((idx as usize)) << 3), tq0Prime > 1e-3 ? tq0Prime : 0.8);
    store<f64>(this.macTd0SubPtr + (((idx as usize)) << 3), td0Sub > 1e-4 ? td0Sub : 0.035);
    store<f64>(this.macTq0SubPtr + (((idx as usize)) << 3), tq0Sub > 1e-4 ? tq0Sub : 0.05);
    store<f64>(this.macHInertiaPtr + (((idx as usize)) << 3), hInertia > 0.05 ? hInertia : 3.5);
    store<f64>(this.macDampingPtr + (((idx as usize)) << 3), dampingD);
    store<f64>(this.macPmPuPtr + (((idx as usize)) << 3), pmPu);
    store<f64>(this.macEfPuPtr + (((idx as usize)) << 3), efPu);
    store<f64>(this.macDeltaRadPtr + (((idx as usize)) << 3), delta0);
    store<f64>(this.macOmegaPuPtr + (((idx as usize)) << 3), 1.0);
    store<f64>(this.macEqPrimePtr + (((idx as usize)) << 3), efPu);
    store<f64>(this.macEdPrimePtr + (((idx as usize)) << 3), 0.0);
    store<f64>(this.macEqSubPtr + (((idx as usize)) << 3), efPu);
    store<f64>(this.macEdSubPtr + (((idx as usize)) << 3), 0.0);
    store<f64>(this.macTePuPtr + (((idx as usize)) << 3), pmPu);

    return idx as i32;
  }

  setNonlinearIterationOptions(maxIterations: u32, toleranceVolts: f64): void {
    this.maxNonlinearIterations = maxIterations > 1 ? maxIterations : 1;
    this.nonlinearToleranceVolts = toleranceVolts > 1e-6 ? toleranceVolts : 1.0;
  }

  addConverterBridge(
    nodeA: i32,
    nodeB: i32,
    nodeC: i32,
    topology: u32,
    sBaseMva: f64,
    vBaseKvLL: f64,
    vdcKv: f64,
    freqHz: f64,
    carrierFreqHz: f64,
    alphaDeg: f64,
    modIndex: f64,
    numSubmodules: u32
  ): i32 {
    if (this.nConverters >= this.maxConverters) return -1;
    let idx = this.nConverters++;

    let vBasePeak = vBaseKvLL * 1000.0;
    let sBaseVa = sBaseMva * 1e6;
    let zBase = (vBasePeak * vBasePeak) / Math.max(1.0, sBaseVa);
    let gFilter = 1.0 / Math.max(1e-4, 0.15 * zBase);
    let vdcVolts = (vdcKv > 0.1 ? vdcKv : vBaseKvLL * 1.8) * 1000.0;
    let omegaSync = 2.0 * Math.PI * (freqHz > 1.0 ? freqHz : 60.0);
    let alphaRad = (alphaDeg * Math.PI) / 180.0;
    let nSm: u32 = numSubmodules >= 2 ? numSubmodules : 32;
    let vcAvg = vdcVolts / <f64>nSm;
    let mEff = modIndex > 0.01 ? modIndex : 0.85;

    store<i32>(this.convNodeAPtr + (((idx as usize)) << 2), nodeA);
    store<i32>(this.convNodeBPtr + (((idx as usize)) << 2), nodeB);
    store<i32>(this.convNodeCPtr + (((idx as usize)) << 2), nodeC);
    store<u32>(this.convTopologyPtr + (((idx as usize)) << 2), topology);
    store<f64>(this.convVBasePeakPtr + (((idx as usize)) << 3), vBasePeak);
    store<f64>(this.convVdcVoltsPtr + (((idx as usize)) << 3), vdcVolts);
    store<f64>(this.convOmegaSyncPtr + (((idx as usize)) << 3), omegaSync);
    store<f64>(this.convGFilterPtr + (((idx as usize)) << 3), gFilter);
    store<f64>(this.convCarrierFreqPtr + (((idx as usize)) << 3), carrierFreqHz > 60.0 ? carrierFreqHz : 1980.0);
    store<f64>(this.convAlphaRadPtr + (((idx as usize)) << 3), alphaRad);
    store<f64>(this.convModIndexPtr + (((idx as usize)) << 3), mEff);
    store<u32>(this.convNumSmPtr + (((idx as usize)) << 2), nSm);
    store<f64>(this.convVcAvgPtr + (((idx as usize)) << 3), vcAvg);
    store<f64>(this.convPllThetaPtr + (((idx as usize)) << 3), 0.0);

    // Initialize t = 0 Norton current injections
    let ePeak = 0.5 * vdcVolts * mEff;
    store<f64>(this.convIInjAPtr + (((idx as usize)) << 3), gFilter * ePeak * Math.sin(0.08));
    store<f64>(this.convIInjBPtr + (((idx as usize)) << 3), gFilter * ePeak * Math.sin(0.08 - (2.0 * Math.PI) / 3.0));
    store<f64>(this.convIInjCPtr + (((idx as usize)) << 3), gFilter * ePeak * Math.sin(0.08 + (2.0 * Math.PI) / 3.0));

    return idx as i32;
  }

  @inline
  private addG(r: u32, c: u32, delta: f64): void {
    let ptr = this.gDensePtr + ((((r * this.nNodes + c) as usize)) << 3);
    store<f64>(ptr, load<f64>(ptr) + delta);
  }

  @inline
  private addGChecked(r: i32, c: i32, delta: f64): void {
    let n = this.nNodes;
    if (r >= 0 && (r as u32) < n && c >= 0 && (c as u32) < n) {
      this.addG(r as u32, c as u32, delta);
    }
  }

  stampConductance(i: i32, j: i32, g: f64): void {
    let n = this.nNodes;
    if (i >= 0 && (i as u32) < n) {
      this.addG(i as u32, i as u32, g);
    }
    if (j >= 0 && (j as u32) < n) {
      this.addG(j as u32, j as u32, g);
    }
    if (i >= 0 && j >= 0 && (i as u32) < n && (j as u32) < n) {
      this.addG(i as u32, j as u32, -g);
      this.addG(j as u32, i as u32, -g);
    }
  }

  stampShunt(i: i32, g: f64): void {
    let n = this.nNodes;
    if (i >= 0 && (i as u32) < n) {
      this.addG(i as u32, i as u32, g);
    }
  }

  stampTransformer(pPos: i32, pNeg: i32, sPos: i32, sNeg: i32, g: f64, a: f64): void {
    this.stampConductance(pPos, pNeg, g);
    this.stampConductance(sPos, sNeg, a * a * g);
    let ag = a * g;
    this.addGChecked(pPos, sPos, -ag);
    this.addGChecked(sPos, pPos, -ag);
    this.addGChecked(pPos, sNeg, ag);
    this.addGChecked(sNeg, pPos, ag);
    this.addGChecked(pNeg, sPos, ag);
    this.addGChecked(sPos, pNeg, ag);
    this.addGChecked(pNeg, sNeg, -ag);
    this.addGChecked(sNeg, pNeg, -ag);
  }

  factorizeCurrentG(): bool {
    let n = this.nNodes;
    let matSize = n * n;
    for (let i: u32 = 0; i < matSize; i++) {
      let offset = (i as usize) << 3;
      store<f64>(this.luFactoredPtr + offset, load<f64>(this.gDensePtr + offset));
    }
    let ok = luFactor(
      this.luFactoredPtr as u32,
      this.luPivPtr as u32,
      this.luScalePtr as u32,
      n
    );
    this.isFactorized = ok;
    if (ok) this.factorizationCount++;
    return ok;
  }

  buildAndFactorize(): bool {
    let n = this.nNodes;
    let matSize = n * n;
    for (let i: u32 = 0; i < matSize; i++) {
      store<f64>(this.gDensePtr + (((i as usize)) << 3), 0.0);
    }

    // 1. Stamp RLC branch conductances
    for (let b: u32 = 0; b < this.nBranches; b++) {
      let fromNode = load<i32>(this.branchFromPtr + (((b as usize)) << 2));
      let toNode = load<i32>(this.branchToPtr + (((b as usize)) << 2));
      let gTotal = load<f64>(this.branchGTotalPtr + (((b as usize)) << 3));
      this.stampConductance(fromNode, toNode, gTotal);
    }

    // 1b. Stamp Bergeron line surge admittances
    for (let l: u32 = 0; l < this.nLines; l++) {
      let fromNode = load<i32>(this.lineFromPtr + (((l as usize)) << 2));
      let toNode = load<i32>(this.lineToPtr + (((l as usize)) << 2));
      let gc = load<f64>(this.lineGcPtr + (((l as usize)) << 3));
      this.stampShunt(fromNode, gc);
      this.stampShunt(toNode, gc);
    }

    // 1c. Stamp 4-terminal coupled transformer windings
    for (let w: u32 = 0; w < this.nWindings; w++) {
      let pPos = load<i32>(this.xfmrPPosPtr + (((w as usize)) << 2));
      let pNeg = load<i32>(this.xfmrPNegPtr + (((w as usize)) << 2));
      let sPos = load<i32>(this.xfmrSPosPtr + (((w as usize)) << 2));
      let sNeg = load<i32>(this.xfmrSNegPtr + (((w as usize)) << 2));
      let g = load<f64>(this.xfmrGLeakagePtr + (((w as usize)) << 3));
      let a = load<f64>(this.xfmrTurnsRatioPtr + (((w as usize)) << 3));
      this.stampTransformer(pPos, pNeg, sPos, sNeg, g, a);
    }

    // 1d. Stamp circuit breakers
    for (let brk: u32 = 0; brk < this.nBreakers; brk++) {
      let fromNode = load<i32>(this.brkFromPtr + (((brk as usize)) << 2));
      let toNode = load<i32>(this.brkToPtr + (((brk as usize)) << 2));
      let gCur = load<f64>(this.brkGCurrentPtr + (((brk as usize)) << 3));
      this.stampConductance(fromNode, toNode, gCur);
    }

    // 1e. Stamp saturable cores
    for (let sc: u32 = 0; sc < this.nSatCores; sc++) {
      let node = load<i32>(this.satNodePtr + (((sc as usize)) << 2));
      let gCur = load<f64>(this.satGCurrentPtr + (((sc as usize)) << 3));
      this.stampShunt(node, gCur);
    }

    // 1f. Stamp MOV surge arresters
    for (let arr: u32 = 0; arr < this.nArresters; arr++) {
      let fromNode = load<i32>(this.arrFromPtr + (((arr as usize)) << 2));
      let toNode = load<i32>(this.arrToPtr + (((arr as usize)) << 2));
      let gCur = load<f64>(this.arrGCurrentPtr + (((arr as usize)) << 3));
      this.stampConductance(fromNode, toNode, gCur);
    }

    // 1g. Stamp synchronous machine subtransient Norton admittances
    for (let m: u32 = 0; m < this.nMachines; m++) {
      let nodeA = load<i32>(this.macNodeAPtr + (((m as usize)) << 2));
      let nodeB = load<i32>(this.macNodeBPtr + (((m as usize)) << 2));
      let nodeC = load<i32>(this.macNodeCPtr + (((m as usize)) << 2));
      let gSub = load<f64>(this.macGSubPtr + (((m as usize)) << 3));
      this.stampShunt(nodeA, gSub);
      this.stampShunt(nodeB, gSub);
      this.stampShunt(nodeC, gSub);
    }

    // 1h. Stamp power electronics converter bridge filter Norton admittances
    for (let c: u32 = 0; c < this.nConverters; c++) {
      let nodeA = load<i32>(this.convNodeAPtr + (((c as usize)) << 2));
      let nodeB = load<i32>(this.convNodeBPtr + (((c as usize)) << 2));
      let nodeC = load<i32>(this.convNodeCPtr + (((c as usize)) << 2));
      let gFilter = load<f64>(this.convGFilterPtr + (((c as usize)) << 3));
      this.stampShunt(nodeA, gFilter);
      this.stampShunt(nodeB, gFilter);
      this.stampShunt(nodeC, gFilter);
    }

    // 2. Stamp source Norton conductances
    for (let s: u32 = 0; s < this.nSources; s++) {
      let node = load<i32>(this.sourceNodePtr + (((s as usize)) << 2));
      let gSource = load<f64>(this.sourceGPtr + (((s as usize)) << 3));
      this.stampShunt(node, gSource);
    }

    // 3. Numerical ground regularizer to prevent singular matrix on floating nodes
    for (let i: u32 = 0; i < n; i++) {
      this.addG(i, i, 1e-7);
    }

    this.factorizationCount = 0;
    return this.factorizeCurrentG();
  }

  private applyCdaDamping(): void {
    if (!this.enableCda) return;
    for (let b: u32 = 0; b < this.nBranches; b++) {
      let gL = load<f64>(this.branchGLPtr + (((b as usize)) << 3));
      let gC = load<f64>(this.branchGCPtr + (((b as usize)) << 3));
      let cur = load<f64>(this.branchCurrentPtr + (((b as usize)) << 3));
      if (gL > 0.0) store<f64>(this.branchIHistLPtr + (((b as usize)) << 3), cur);
      if (gC > 0.0) store<f64>(this.branchIHistCPtr + (((b as usize)) << 3), 0.0);
    }
    for (let w: u32 = 0; w < this.nWindings; w++) {
      let curP = load<f64>(this.xfmrCurrentPPtr + (((w as usize)) << 3));
      store<f64>(this.xfmrIHistPtr + (((w as usize)) << 3), curP);
    }
  }

  reset(): void {
    this.t = 0.0;
    this.stepCount = 0;
    this.trajectoryRecordedSteps = 0;
    for (let i: u32 = 0; i < this.nNodes; i++) {
      store<f64>(this.bVecPtr + (((i as usize)) << 3), 0.0);
      store<f64>(this.vVecPtr + (((i as usize)) << 3), 0.0);
      store<f64>(this.vPrevPtr + (((i as usize)) << 3), 0.0);
    }
    for (let b: u32 = 0; b < this.nBranches; b++) {
      store<f64>(this.branchIHistLPtr + (((b as usize)) << 3), 0.0);
      store<f64>(this.branchIHistCPtr + (((b as usize)) << 3), 0.0);
      store<f64>(this.branchCurrentPtr + (((b as usize)) << 3), 0.0);
    }
    for (let w: u32 = 0; w < this.nWindings; w++) {
      store<f64>(this.xfmrIHistPtr + (((w as usize)) << 3), 0.0);
      store<f64>(this.xfmrCurrentPPtr + (((w as usize)) << 3), 0.0);
    }
    for (let l: u32 = 0; l < this.nLines; l++) {
      let bufLen = load<i32>(this.lineBufLenPtr + (((l as usize)) << 2));
      let bufFrom = load<usize>(this.lineBufFromPtrs + ((l as usize) * sizeof<usize>()));
      let bufTo = load<usize>(this.lineBufToPtrs + ((l as usize) * sizeof<usize>()));
      store<i32>(this.lineBufIdxPtr + (((l as usize)) << 2), 0);
      for (let k: i32 = 0; k < bufLen; k++) {
        store<f64>(bufFrom + (((k as usize)) << 3), 0.0);
        store<f64>(bufTo + (((k as usize)) << 3), 0.0);
      }
    }
    for (let arr: u32 = 0; arr < this.nArresters; arr++) {
      store<f64>(this.arrIHistPtr + (((arr as usize)) << 3), 0.0);
      store<f64>(this.arrCurrentPtr + (((arr as usize)) << 3), 0.0);
      store<f64>(this.arrEnergyJPtr + (((arr as usize)) << 3), 0.0);
    }
  }

  allocTrajectory(maxSteps: u32): usize {
    let totalElements = maxSteps * this.stridePerStep;
    this.trajectoryBufferPtr = atomicChunkAlloc(totalElements * sizeof<f64>());
    this.trajectoryCapacitySteps = maxSteps;
    this.trajectoryRecordedSteps = 0;
    return this.trajectoryBufferPtr;
  }

  step(): void {
    if (!this.isFactorized) return;
    let n = this.nNodes;
    let dt = this.dt;
    let t = this.t;

    let vVec = changetype<UnmanagedFloat64Array>(this.vVecPtr);

    // Save vPrev = vVec before solving step t
    for (let i: u32 = 0; i < n; i++) {
      let offset = (i as usize) << 3;
      store<f64>(this.vPrevPtr + offset, load<f64>(this.vVecPtr + offset));
    }

    // 0. Check for discrete fault or breaker switching events
    let topologyChanged: bool = false;
    for (let f: u32 = 0; f < this.nFaults; f++) {
      let startSec = load<f64>(this.faultStartSecPtr + (((f as usize)) << 3));
      let endSec = load<f64>(this.faultEndSecPtr + (((f as usize)) << 3));
      let isActive = load<u32>(this.faultActivePtr + (((f as usize)) << 2)) != 0;
      let shouldActive = t >= startSec && t < endSec;
      if (shouldActive != isActive) {
        let nodeA = load<i32>(this.faultNodeAPtr + (((f as usize)) << 2));
        let nodeB = load<i32>(this.faultNodeBPtr + (((f as usize)) << 2));
        let gFault = load<f64>(this.faultGPtr + (((f as usize)) << 3));
        let deltaG = shouldActive ? gFault : -gFault;
        if (nodeB >= 0) {
          this.stampConductance(nodeA, nodeB, deltaG);
        } else {
          this.stampShunt(nodeA, deltaG);
        }
        store<u32>(this.faultActivePtr + (((f as usize)) << 2), shouldActive ? 1 : 0);
        topologyChanged = true;
      }
    }

    for (let brk: u32 = 0; brk < this.nBreakers; brk++) {
      let state = load<u32>(this.brkStatePtr + (((brk as usize)) << 2));
      let openTime = load<f64>(this.brkOpenTimePtr + (((brk as usize)) << 3));
      let closeTime = load<f64>(this.brkCloseTimePtr + (((brk as usize)) << 3));
      if (state == 0 && t >= closeTime) {
        let fromNode = load<i32>(this.brkFromPtr + (((brk as usize)) << 2));
        let toNode = load<i32>(this.brkToPtr + (((brk as usize)) << 2));
        let gClosed = load<f64>(this.brkGClosedPtr + (((brk as usize)) << 3));
        let gCur = load<f64>(this.brkGCurrentPtr + (((brk as usize)) << 3));
        this.stampConductance(fromNode, toNode, gClosed - gCur);
        store<f64>(this.brkGCurrentPtr + (((brk as usize)) << 3), gClosed);
        store<u32>(this.brkStatePtr + (((brk as usize)) << 2), 1);
        topologyChanged = true;
      } else if (state == 1 && t >= openTime) {
        store<u32>(this.brkStatePtr + (((brk as usize)) << 2), 2); // pendingOpen
      }
    }

    if (topologyChanged) {
      this.factorizeCurrentG();
      this.applyCdaDamping();
    }

    // 1. Clear RHS current injection vector b = i_inj - I_hist
    for (let i: u32 = 0; i < n; i++) {
      store<f64>(this.bVecPtr + (((i as usize)) << 3), 0.0);
    }

    // 2. Inject sources
    for (let s: u32 = 0; s < this.nSources; s++) {
      let node = load<i32>(this.sourceNodePtr + (((s as usize)) << 2));
      if (node >= 0 && (node as u32) < n) {
        let type = load<u32>(this.sourceTypePtr + (((s as usize)) << 2));
        let vPeak = load<f64>(this.sourceVPeakPtr + (((s as usize)) << 3));
        let omega = load<f64>(this.sourceOmegaPtr + (((s as usize)) << 3));
        let phase = load<f64>(this.sourcePhasePtr + (((s as usize)) << 3));
        let gSource = load<f64>(this.sourceGPtr + (((s as usize)) << 3));

        let vInst: f64 = 0.0;
        if (type == EMT_SOURCE_TYPE_AC_VOLTAGE) {
          vInst = vPeak * Math.sin(omega * t + phase);
        } else if (type == EMT_SOURCE_TYPE_DC_VOLTAGE) {
          vInst = vPeak;
        }

        let bPtr = this.bVecPtr + (((node as usize)) << 3);
        store<f64>(bPtr, load<f64>(bPtr) + gSource * vInst);
      }
    }

    // 2b. Inject 6th-order synchronous machine subtransient Norton currents
    for (let m: u32 = 0; m < this.nMachines; m++) {
      let nodeA = load<i32>(this.macNodeAPtr + (((m as usize)) << 2));
      let nodeB = load<i32>(this.macNodeBPtr + (((m as usize)) << 2));
      let nodeC = load<i32>(this.macNodeCPtr + (((m as usize)) << 2));
      let vBasePeak = load<f64>(this.macVBasePeakPtr + (((m as usize)) << 3));
      let omegaSync = load<f64>(this.macOmegaSyncPtr + (((m as usize)) << 3));
      let gSub = load<f64>(this.macGSubPtr + (((m as usize)) << 3));
      let delta = load<f64>(this.macDeltaRadPtr + (((m as usize)) << 3));
      let edSub = load<f64>(this.macEdSubPtr + (((m as usize)) << 3));
      let eqSub = load<f64>(this.macEqSubPtr + (((m as usize)) << 3));

      let thetaA = omegaSync * t + delta;
      let thetaB = thetaA - (2.0 * Math.PI) / 3.0;
      let thetaC = thetaA + (2.0 * Math.PI) / 3.0;

      let ea = (eqSub * Math.sin(thetaA) + edSub * Math.cos(thetaA)) * vBasePeak;
      let eb = (eqSub * Math.sin(thetaB) + edSub * Math.cos(thetaB)) * vBasePeak;
      let ec = (eqSub * Math.sin(thetaC) + edSub * Math.cos(thetaC)) * vBasePeak;

      if (nodeA >= 0 && (nodeA as u32) < n) {
        let p = this.bVecPtr + (((nodeA as usize)) << 3);
        store<f64>(p, load<f64>(p) + gSub * ea);
      }
      if (nodeB >= 0 && (nodeB as u32) < n) {
        let p = this.bVecPtr + (((nodeB as usize)) << 3);
        store<f64>(p, load<f64>(p) + gSub * eb);
      }
      if (nodeC >= 0 && (nodeC as u32) < n) {
        let p = this.bVecPtr + (((nodeC as usize)) << 3);
        store<f64>(p, load<f64>(p) + gSub * ec);
      }
    }

    // 2c. Inject power electronics converter bridge Norton currents
    for (let c: u32 = 0; c < this.nConverters; c++) {
      let nodeA = load<i32>(this.convNodeAPtr + (((c as usize)) << 2));
      let nodeB = load<i32>(this.convNodeBPtr + (((c as usize)) << 2));
      let nodeC = load<i32>(this.convNodeCPtr + (((c as usize)) << 2));
      let iInjA = load<f64>(this.convIInjAPtr + (((c as usize)) << 3));
      let iInjB = load<f64>(this.convIInjBPtr + (((c as usize)) << 3));
      let iInjC = load<f64>(this.convIInjCPtr + (((c as usize)) << 3));

      if (nodeA >= 0 && (nodeA as u32) < n) {
        let p = this.bVecPtr + (((nodeA as usize)) << 3);
        store<f64>(p, load<f64>(p) + iInjA);
      }
      if (nodeB >= 0 && (nodeB as u32) < n) {
        let p = this.bVecPtr + (((nodeB as usize)) << 3);
        store<f64>(p, load<f64>(p) + iInjB);
      }
      if (nodeC >= 0 && (nodeC as u32) < n) {
        let p = this.bVecPtr + (((nodeC as usize)) << 3);
        store<f64>(p, load<f64>(p) + iInjC);
      }
    }

    // 3. Subtract RLC branch history currents
    for (let b: u32 = 0; b < this.nBranches; b++) {
      let fromNode = load<i32>(this.branchFromPtr + (((b as usize)) << 2));
      let toNode = load<i32>(this.branchToPtr + (((b as usize)) << 2));
      let iHistL = load<f64>(this.branchIHistLPtr + (((b as usize)) << 3));
      let iHistC = load<f64>(this.branchIHistCPtr + (((b as usize)) << 3));
      let iHistTotal = iHistL + iHistC;

      if (fromNode >= 0 && (fromNode as u32) < n) {
        let bPtr = this.bVecPtr + (((fromNode as usize)) << 3);
        store<f64>(bPtr, load<f64>(bPtr) - iHistTotal);
      }
      if (toNode >= 0 && (toNode as u32) < n) {
        let bPtr = this.bVecPtr + (((toNode as usize)) << 3);
        store<f64>(bPtr, load<f64>(bPtr) + iHistTotal);
      }
    }

    // 3b. Subtract coupled transformer winding history currents
    for (let w: u32 = 0; w < this.nWindings; w++) {
      let pPos = load<i32>(this.xfmrPPosPtr + (((w as usize)) << 2));
      let pNeg = load<i32>(this.xfmrPNegPtr + (((w as usize)) << 2));
      let sPos = load<i32>(this.xfmrSPosPtr + (((w as usize)) << 2));
      let sNeg = load<i32>(this.xfmrSNegPtr + (((w as usize)) << 2));
      let a = load<f64>(this.xfmrTurnsRatioPtr + (((w as usize)) << 3));
      let iHistP = load<f64>(this.xfmrIHistPtr + (((w as usize)) << 3));
      let iHistS = -a * iHistP;

      if (pPos >= 0 && (pPos as u32) < n) {
        let p = this.bVecPtr + (((pPos as usize)) << 3);
        store<f64>(p, load<f64>(p) - iHistP);
      }
      if (pNeg >= 0 && (pNeg as u32) < n) {
        let p = this.bVecPtr + (((pNeg as usize)) << 3);
        store<f64>(p, load<f64>(p) + iHistP);
      }
      if (sPos >= 0 && (sPos as u32) < n) {
        let p = this.bVecPtr + (((sPos as usize)) << 3);
        store<f64>(p, load<f64>(p) - iHistS);
      }
      if (sNeg >= 0 && (sNeg as u32) < n) {
        let p = this.bVecPtr + (((sNeg as usize)) << 3);
        store<f64>(p, load<f64>(p) + iHistS);
      }
    }

    // 3c. Inject Bergeron line delayed traveling waves (with fractional delay interpolation)
    for (let l: u32 = 0; l < this.nLines; l++) {
      let fromNode = load<i32>(this.lineFromPtr + (((l as usize)) << 2));
      let toNode = load<i32>(this.lineToPtr + (((l as usize)) << 2));
      let delaySteps = load<i32>(this.lineDelayStepsPtr + (((l as usize)) << 2));
      let frac = load<f64>(this.lineDelayFracPtr + (((l as usize)) << 3));
      let bufLen = load<i32>(this.lineBufLenPtr + (((l as usize)) << 2));
      let bufIdx = load<i32>(this.lineBufIdxPtr + (((l as usize)) << 2));
      let bufFrom = load<usize>(this.lineBufFromPtrs + ((l as usize) * sizeof<usize>()));
      let bufTo = load<usize>(this.lineBufToPtrs + ((l as usize) * sizeof<usize>()));

      let readIdx1 = (bufIdx - delaySteps + bufLen) % bufLen;
      let readIdx2 = (readIdx1 - 1 + bufLen) % bufLen;

      let waveFromK =
        (1.0 - frac) * load<f64>(bufFrom + (((readIdx1 as usize)) << 3)) +
        frac * load<f64>(bufFrom + (((readIdx2 as usize)) << 3));
      let waveFromM =
        (1.0 - frac) * load<f64>(bufTo + (((readIdx1 as usize)) << 3)) +
        frac * load<f64>(bufTo + (((readIdx2 as usize)) << 3));

      if (toNode >= 0 && (toNode as u32) < n) {
        let p = this.bVecPtr + (((toNode as usize)) << 3);
        store<f64>(p, load<f64>(p) + waveFromK);
      }
      if (fromNode >= 0 && (fromNode as u32) < n) {
        let p = this.bVecPtr + (((fromNode as usize)) << 3);
        store<f64>(p, load<f64>(p) + waveFromM);
      }
    }

    // Save linear base RHS vector before adding non-linear history currents
    for (let i: u32 = 0; i < n; i++) {
      let offset = (i as usize) << 3;
      store<f64>(this.bBaseVecPtr + offset, load<f64>(this.bVecPtr + offset));
    }

    // 3d. Subtract saturable core history currents
    for (let sc: u32 = 0; sc < this.nSatCores; sc++) {
      let node = load<i32>(this.satNodePtr + (((sc as usize)) << 2));
      let iHist = load<f64>(this.satIHistPtr + (((sc as usize)) << 3));
      if (node >= 0 && (node as u32) < n) {
        let p = this.bVecPtr + (((node as usize)) << 3);
        store<f64>(p, load<f64>(p) - iHist);
      }
    }

    // 3e. Subtract MOV surge arrester history currents
    for (let arr: u32 = 0; arr < this.nArresters; arr++) {
      let fromNode = load<i32>(this.arrFromPtr + (((arr as usize)) << 2));
      let toNode = load<i32>(this.arrToPtr + (((arr as usize)) << 2));
      let iHist = load<f64>(this.arrIHistPtr + (((arr as usize)) << 3));
      if (fromNode >= 0 && (fromNode as u32) < n) {
        let p = this.bVecPtr + (((fromNode as usize)) << 3);
        store<f64>(p, load<f64>(p) - iHist);
      }
      if (toNode >= 0 && (toNode as u32) < n) {
        let p = this.bVecPtr + (((toNode as usize)) << 3);
        store<f64>(p, load<f64>(p) + iHist);
      }
    }

    // 4. Solve [G] * v(t) = b
    luSolve(
      this.luFactoredPtr as u32,
      this.luPivPtr as u32,
      this.luScalePtr as u32,
      this.bVecPtr as u32,
      this.luScratchPtr as u32,
      n
    );
    this.totalNonlinearIterations++;

    // Copy solution to vVec
    for (let i: u32 = 0; i < n; i++) {
      let offset = (i as usize) << 3;
      store<f64>(this.vVecPtr + offset, load<f64>(this.bVecPtr + offset));
    }

    // 4a. Within-Step Iterative Non-Linear Newton-Raphson Compensation
    if (this.maxNonlinearIterations > 1 && (this.nSatCores > 0 || this.nArresters > 0)) {
      for (let iter: u32 = 1; iter < this.maxNonlinearIterations; iter++) {
        let nlChanged: bool = false;

        // Reset bVec to linear base RHS
        for (let i: u32 = 0; i < n; i++) {
          let offset = (i as usize) << 3;
          store<f64>(this.bVecPtr + offset, load<f64>(this.bBaseVecPtr + offset));
        }

        // Re-evaluate saturable core incremental slope & intercept at vVec
        for (let sc: u32 = 0; sc < this.nSatCores; sc++) {
          let node = load<i32>(this.satNodePtr + (((sc as usize)) << 2));
          if (node >= 0 && (node as u32) < n) {
            let vNode = vVec[node];
            let vPrev = load<f64>(this.satVPrevPtr + (((sc as usize)) << 3));
            let fluxCand = load<f64>(this.satFluxPtr + (((sc as usize)) << 3)) + 0.5 * dt * (vNode + vPrev);
            let lUnsat = load<f64>(this.satLUnsatPtr + (((sc as usize)) << 3));
            let lSat = load<f64>(this.satLSatPtr + (((sc as usize)) << 3));
            let kneeFlux = load<f64>(this.satKneeFluxPtr + (((sc as usize)) << 3));
            let prevG = load<f64>(this.satGCurrentPtr + (((sc as usize)) << 3));

            let absFlux = Math.abs(fluxCand);
            let sign: f64 = fluxCand >= 0.0 ? 1.0 : -1.0;
            let iMag: f64 = 0.0;
            let lInc: f64 = lUnsat;
            if (absFlux <= kneeFlux) {
              iMag = fluxCand / lUnsat;
              lInc = lUnsat;
            } else {
              iMag = sign * (kneeFlux / lUnsat + (absFlux - kneeFlux) / lSat);
              lInc = lSat;
            }
            let newG = dt / (2.0 * lInc);
            if (Math.abs(newG - prevG) > 1e-12) {
              this.stampShunt(node, newG - prevG);
              store<f64>(this.satGCurrentPtr + (((sc as usize)) << 3), newG);
              nlChanged = true;
            }
            let iEq = iMag - newG * vNode;
            let p = this.bVecPtr + (((node as usize)) << 3);
            store<f64>(p, load<f64>(p) - iEq);
          }
        }

        // Re-evaluate MOV surge arrester incremental slope & intercept at vVec
        for (let arr: u32 = 0; arr < this.nArresters; arr++) {
          let fromNode = load<i32>(this.arrFromPtr + (((arr as usize)) << 2));
          let toNode = load<i32>(this.arrToPtr + (((arr as usize)) << 2));
          let vFrom: f64 = (fromNode >= 0 && (fromNode as u32) < n) ? vVec[fromNode] : 0.0;
          let vTo: f64 = (toNode >= 0 && (toNode as u32) < n) ? vVec[toNode] : 0.0;
          let vBranch = vFrom - vTo;
          let absV = Math.abs(vBranch);
          let sign: f64 = vBranch >= 0.0 ? 1.0 : -1.0;

          let vRef = load<f64>(this.arrVRefPtr + (((arr as usize)) << 3));
          let prevG = load<f64>(this.arrGCurrentPtr + (((arr as usize)) << 3));
          let pu = absV / vRef;

          let pu0: f64 = 0.0;
          let pu1: f64 = 0.85;
          let i0: f64 = 0.0;
          let i1: f64 = 1e-3;
          if (pu > 1.42) {
            pu0 = 1.42; pu1 = 1.65; i0 = 10000.0; i1 = 40000.0;
          } else if (pu > 1.28) {
            pu0 = 1.28; pu1 = 1.42; i0 = 1000.0; i1 = 10000.0;
          } else if (pu > 1.15) {
            pu0 = 1.15; pu1 = 1.28; i0 = 100.0; i1 = 1000.0;
          } else if (pu > 1.00) {
            pu0 = 1.00; pu1 = 1.15; i0 = 1.0; i1 = 100.0;
          } else if (pu > 0.85) {
            pu0 = 0.85; pu1 = 1.00; i0 = 1e-3; i1 = 1.0;
          }

          let gSeg = (i1 - i0) / ((pu1 - pu0) * vRef);
          let iCurve = sign * (i0 + (absV - pu0 * vRef) * gSeg);
          let iIntercept = iCurve - gSeg * vBranch;

          if (Math.abs(gSeg - prevG) > 1e-12) {
            this.stampConductance(fromNode, toNode, gSeg - prevG);
            store<f64>(this.arrGCurrentPtr + (((arr as usize)) << 3), gSeg);
            nlChanged = true;
          }
          if (fromNode >= 0 && (fromNode as u32) < n) {
            let p = this.bVecPtr + (((fromNode as usize)) << 3);
            store<f64>(p, load<f64>(p) - iIntercept);
          }
          if (toNode >= 0 && (toNode as u32) < n) {
            let p = this.bVecPtr + (((toNode as usize)) << 3);
            store<f64>(p, load<f64>(p) + iIntercept);
          }
        }

        if (nlChanged) {
          this.factorizeCurrentG();
        }

        luSolve(
          this.luFactoredPtr as u32,
          this.luPivPtr as u32,
          this.luScalePtr as u32,
          this.bVecPtr as u32,
          this.luScratchPtr as u32,
          n
        );
        this.totalNonlinearIterations++;

        let maxDiff: f64 = 0.0;
        for (let i: u32 = 0; i < n; i++) {
          let offset = (i as usize) << 3;
          let vNew = load<f64>(this.bVecPtr + offset);
          let vOld = load<f64>(this.vVecPtr + offset);
          let diff = Math.abs(vNew - vOld);
          if (diff > maxDiff) maxDiff = diff;
          store<f64>(this.vVecPtr + offset, vNew);
        }

        if (maxDiff <= this.nonlinearToleranceVolts && !nlChanged) {
          break;
        }
      }
    }

    // 4b. Check circuit breaker zero-crossing with linear sub-step switching interpolation
    let breakerZeroCrossed: bool = false;
    let minAlpha: f64 = 1.0;
    for (let brk: u32 = 0; brk < this.nBreakers; brk++) {
      let fromNode = load<i32>(this.brkFromPtr + (((brk as usize)) << 2));
      let toNode = load<i32>(this.brkToPtr + (((brk as usize)) << 2));
      let vFrom: f64 = (fromNode >= 0 && (fromNode as u32) < n) ? vVec[fromNode] : 0.0;
      let vTo: f64 = (toNode >= 0 && (toNode as u32) < n) ? vVec[toNode] : 0.0;
      let gCur = load<f64>(this.brkGCurrentPtr + (((brk as usize)) << 3));
      let newCurrent = (vFrom - vTo) * gCur;
      let prevCurrent = load<f64>(this.brkCurrentPtr + (((brk as usize)) << 3));
      store<f64>(this.brkCurrentPtr + (((brk as usize)) << 3), newCurrent);

      let state = load<u32>(this.brkStatePtr + (((brk as usize)) << 2));
      if (state == 2) {
        let chopAmp = load<f64>(this.brkChopAmpPtr + (((brk as usize)) << 3));
        let crossedZero = prevCurrent * newCurrent <= 0.0 && this.stepCount > 0;
        let belowChop = Math.abs(newCurrent) <= chopAmp;
        if (crossedZero || belowChop) {
          let denom = Math.abs(prevCurrent) + Math.abs(newCurrent);
          let alpha: f64 = (crossedZero && denom > 1e-12) ? (Math.abs(prevCurrent) / denom) : 1.0;
          if (alpha < minAlpha) minAlpha = alpha;

          let gOpen = load<f64>(this.brkGOpenPtr + (((brk as usize)) << 3));
          this.stampConductance(fromNode, toNode, gOpen - gCur);
          store<f64>(this.brkGCurrentPtr + (((brk as usize)) << 3), gOpen);
          store<f64>(this.brkCurrentPtr + (((brk as usize)) << 3), 0.0);
          store<u32>(this.brkStatePtr + (((brk as usize)) << 2), 3); // cleared
          breakerZeroCrossed = true;
        }
      }
    }

    if (breakerZeroCrossed) {
      // Interpolate node voltages to the exact zero-crossing instant t* = (t - dt) + minAlpha * dt
      for (let i: u32 = 0; i < n; i++) {
        let offset = (i as usize) << 3;
        let vp = load<f64>(this.vPrevPtr + offset);
        let vc = load<f64>(this.vVecPtr + offset);
        store<f64>(this.vVecPtr + offset, (1.0 - minAlpha) * vp + minAlpha * vc);
      }
      this.factorizeCurrentG();
    }

    // 5. Update RLC branch currents and history currents for next step
    for (let b: u32 = 0; b < this.nBranches; b++) {
      let fromNode = load<i32>(this.branchFromPtr + (((b as usize)) << 2));
      let toNode = load<i32>(this.branchToPtr + (((b as usize)) << 2));
      let vFrom: f64 = (fromNode >= 0 && (fromNode as u32) < n) ? vVec[fromNode] : 0.0;
      let vTo: f64 = (toNode >= 0 && (toNode as u32) < n) ? vVec[toNode] : 0.0;
      let vBranch = vFrom - vTo;

      let gL = load<f64>(this.branchGLPtr + (((b as usize)) << 3));
      let alphaL = load<f64>(this.branchAlphaLPtr + (((b as usize)) << 3));
      let gC = load<f64>(this.branchGCPtr + (((b as usize)) << 3));
      let gR = load<f64>(this.branchGRPtr + (((b as usize)) << 3));
      let iHistL = load<f64>(this.branchIHistLPtr + (((b as usize)) << 3));
      let iHistC = load<f64>(this.branchIHistCPtr + (((b as usize)) << 3));

      let iBranch: f64 = 0.0;
      if (gL > 0.0) {
        let iL = gL * vBranch + iHistL;
        if (breakerZeroCrossed && this.enableCda) {
          store<f64>(this.branchIHistLPtr + (((b as usize)) << 3), iL);
        } else {
          store<f64>(this.branchIHistLPtr + (((b as usize)) << 3), alphaL * iL + gL * vBranch);
        }
        iBranch += iL;
      }
      if (gC > 0.0) {
        let iC = gC * vBranch + iHistC;
        if (breakerZeroCrossed && this.enableCda) {
          store<f64>(this.branchIHistCPtr + (((b as usize)) << 3), 0.0);
        } else {
          store<f64>(this.branchIHistCPtr + (((b as usize)) << 3), -iC - gC * vBranch);
        }
        iBranch += iC;
      }
      if (gR > 0.0 && gL == 0.0) {
        iBranch += vBranch * gR;
      }

      store<f64>(this.branchCurrentPtr + (((b as usize)) << 3), iBranch);
    }

    // 5b. Update coupled transformer windings
    for (let w: u32 = 0; w < this.nWindings; w++) {
      let pPos = load<i32>(this.xfmrPPosPtr + (((w as usize)) << 2));
      let pNeg = load<i32>(this.xfmrPNegPtr + (((w as usize)) << 2));
      let sPos = load<i32>(this.xfmrSPosPtr + (((w as usize)) << 2));
      let sNeg = load<i32>(this.xfmrSNegPtr + (((w as usize)) << 2));
      let vpPos: f64 = (pPos >= 0 && (pPos as u32) < n) ? vVec[pPos] : 0.0;
      let vpNeg: f64 = (pNeg >= 0 && (pNeg as u32) < n) ? vVec[pNeg] : 0.0;
      let vsPos: f64 = (sPos >= 0 && (sPos as u32) < n) ? vVec[sPos] : 0.0;
      let vsNeg: f64 = (sNeg >= 0 && (sNeg as u32) < n) ? vVec[sNeg] : 0.0;

      let a = load<f64>(this.xfmrTurnsRatioPtr + (((w as usize)) << 3));
      let g = load<f64>(this.xfmrGLeakagePtr + (((w as usize)) << 3));
      let alphaL = load<f64>(this.xfmrAlphaLPtr + (((w as usize)) << 3));
      let iHistP = load<f64>(this.xfmrIHistPtr + (((w as usize)) << 3));

      let vWind = (vpPos - vpNeg) - a * (vsPos - vsNeg);
      let iPrimary = g * vWind + iHistP;
      store<f64>(this.xfmrCurrentPPtr + (((w as usize)) << 3), iPrimary);
      if (breakerZeroCrossed && this.enableCda) {
        store<f64>(this.xfmrIHistPtr + (((w as usize)) << 3), iPrimary);
      } else {
        store<f64>(this.xfmrIHistPtr + (((w as usize)) << 3), alphaL * iPrimary + g * vWind);
      }
    }

    // 5c. Advance Bergeron transmission line circular wave buffers
    for (let l: u32 = 0; l < this.nLines; l++) {
      let fromNode = load<i32>(this.lineFromPtr + (((l as usize)) << 2));
      let toNode = load<i32>(this.lineToPtr + (((l as usize)) << 2));
      let vFrom: f64 = (fromNode >= 0 && (fromNode as u32) < n) ? vVec[fromNode] : 0.0;
      let vTo: f64 = (toNode >= 0 && (toNode as u32) < n) ? vVec[toNode] : 0.0;

      let gc = load<f64>(this.lineGcPtr + (((l as usize)) << 3));
      let eta = load<f64>(this.lineEtaPtr + (((l as usize)) << 3));
      let delaySteps = load<i32>(this.lineDelayStepsPtr + (((l as usize)) << 2));
      let frac = load<f64>(this.lineDelayFracPtr + (((l as usize)) << 3));
      let bufLen = load<i32>(this.lineBufLenPtr + (((l as usize)) << 2));
      let bufIdx = load<i32>(this.lineBufIdxPtr + (((l as usize)) << 2));
      let bufFrom = load<usize>(this.lineBufFromPtrs + ((l as usize) * sizeof<usize>()));
      let bufTo = load<usize>(this.lineBufToPtrs + ((l as usize) * sizeof<usize>()));

      let readIdx1 = (bufIdx - delaySteps + bufLen) % bufLen;
      let readIdx2 = (readIdx1 - 1 + bufLen) % bufLen;

      let arrivingAtFrom =
        (1.0 - frac) * load<f64>(bufTo + (((readIdx1 as usize)) << 3)) +
        frac * load<f64>(bufTo + (((readIdx2 as usize)) << 3));
      let arrivingAtTo =
        (1.0 - frac) * load<f64>(bufFrom + (((readIdx1 as usize)) << 3)) +
        frac * load<f64>(bufFrom + (((readIdx2 as usize)) << 3));

      store<f64>(bufFrom + (((bufIdx as usize)) << 3), (2.0 * gc * vFrom - arrivingAtFrom) * eta);
      store<f64>(bufTo + (((bufIdx as usize)) << 3), (2.0 * gc * vTo - arrivingAtTo) * eta);
      store<i32>(this.lineBufIdxPtr + (((l as usize)) << 2), (bufIdx + 1) % bufLen);
    }

    // 5d. Update piecewise-linear saturable cores
    let satChanged: bool = false;
    for (let sc: u32 = 0; sc < this.nSatCores; sc++) {
      let node = load<i32>(this.satNodePtr + (((sc as usize)) << 2));
      let vNode: f64 = (node >= 0 && (node as u32) < n) ? vVec[node] : 0.0;
      let vPrev = load<f64>(this.satVPrevPtr + (((sc as usize)) << 3));
      let flux = load<f64>(this.satFluxPtr + (((sc as usize)) << 3)) + 0.5 * dt * (vNode + vPrev);
      store<f64>(this.satFluxPtr + (((sc as usize)) << 3), flux);
      store<f64>(this.satVPrevPtr + (((sc as usize)) << 3), vNode);

      let lUnsat = load<f64>(this.satLUnsatPtr + (((sc as usize)) << 3));
      let lSat = load<f64>(this.satLSatPtr + (((sc as usize)) << 3));
      let kneeFlux = load<f64>(this.satKneeFluxPtr + (((sc as usize)) << 3));
      let prevG = load<f64>(this.satGCurrentPtr + (((sc as usize)) << 3));

      let absFlux = Math.abs(flux);
      let sign: f64 = flux >= 0.0 ? 1.0 : -1.0;
      let iMag: f64 = 0.0;
      let lInc: f64 = lUnsat;
      if (absFlux <= kneeFlux) {
        iMag = flux / lUnsat;
        lInc = lUnsat;
      } else {
        iMag = sign * (kneeFlux / lUnsat + (absFlux - kneeFlux) / lSat);
        lInc = lSat;
      }

      let newG = dt / (2.0 * lInc);
      store<f64>(this.satIHistPtr + (((sc as usize)) << 3), iMag + newG * vNode);
      if (Math.abs(newG - prevG) > 1e-12) {
        this.stampShunt(node, newG - prevG);
        store<f64>(this.satGCurrentPtr + (((sc as usize)) << 3), newG);
        satChanged = true;
      }
    }

    // 5e. Update MOV surge arresters (IEEE Std C62.22 6-segment piecewise V-I)
    for (let arr: u32 = 0; arr < this.nArresters; arr++) {
      let fromNode = load<i32>(this.arrFromPtr + (((arr as usize)) << 2));
      let toNode = load<i32>(this.arrToPtr + (((arr as usize)) << 2));
      let vFrom: f64 = (fromNode >= 0 && (fromNode as u32) < n) ? vVec[fromNode] : 0.0;
      let vTo: f64 = (toNode >= 0 && (toNode as u32) < n) ? vVec[toNode] : 0.0;
      let vBranch = vFrom - vTo;
      let absV = Math.abs(vBranch);
      let sign: f64 = vBranch >= 0.0 ? 1.0 : -1.0;

      let vRef = load<f64>(this.arrVRefPtr + (((arr as usize)) << 3));
      let prevG = load<f64>(this.arrGCurrentPtr + (((arr as usize)) << 3));
      let pu = absV / vRef;

      let pu0: f64 = 0.0;
      let pu1: f64 = 0.85;
      let i0: f64 = 0.0;
      let i1: f64 = 1e-3;

      if (pu > 1.42) {
        pu0 = 1.42; pu1 = 1.65; i0 = 10000.0; i1 = 40000.0;
      } else if (pu > 1.28) {
        pu0 = 1.28; pu1 = 1.42; i0 = 1000.0; i1 = 10000.0;
      } else if (pu > 1.15) {
        pu0 = 1.15; pu1 = 1.28; i0 = 100.0; i1 = 1000.0;
      } else if (pu > 1.00) {
        pu0 = 1.00; pu1 = 1.15; i0 = 1.0; i1 = 100.0;
      } else if (pu > 0.85) {
        pu0 = 0.85; pu1 = 1.00; i0 = 1e-3; i1 = 1.0;
      }

      let gSeg = (i1 - i0) / ((pu1 - pu0) * vRef);
      let iCurve = sign * (i0 + (absV - pu0 * vRef) * gSeg);
      let iIntercept = iCurve - gSeg * vBranch;

      let prevEnergy = load<f64>(this.arrEnergyJPtr + (((arr as usize)) << 3));
      store<f64>(this.arrEnergyJPtr + (((arr as usize)) << 3), prevEnergy + Math.abs(vBranch * iCurve) * dt);
      store<f64>(this.arrCurrentPtr + (((arr as usize)) << 3), iCurve);
      store<f64>(this.arrIHistPtr + (((arr as usize)) << 3), iIntercept);

      if (Math.abs(gSeg - prevG) > 1e-12) {
        this.stampConductance(fromNode, toNode, gSeg - prevG);
        store<f64>(this.arrGCurrentPtr + (((arr as usize)) << 3), gSeg);
        satChanged = true;
      }
    }

    // 5f. Update 6th-order synchronous machines
    for (let m: u32 = 0; m < this.nMachines; m++) {
      let nodeA = load<i32>(this.macNodeAPtr + (((m as usize)) << 2));
      let nodeB = load<i32>(this.macNodeBPtr + (((m as usize)) << 2));
      let nodeC = load<i32>(this.macNodeCPtr + (((m as usize)) << 2));
      let va: f64 = (nodeA >= 0 && (nodeA as u32) < n) ? vVec[nodeA] : 0.0;
      let vb: f64 = (nodeB >= 0 && (nodeB as u32) < n) ? vVec[nodeB] : 0.0;
      let vc: f64 = (nodeC >= 0 && (nodeC as u32) < n) ? vVec[nodeC] : 0.0;

      let vBasePeak = load<f64>(this.macVBasePeakPtr + (((m as usize)) << 3));
      let iBasePeak = load<f64>(this.macIBasePeakPtr + (((m as usize)) << 3));
      let omegaSync = load<f64>(this.macOmegaSyncPtr + (((m as usize)) << 3));
      let gSub = load<f64>(this.macGSubPtr + (((m as usize)) << 3));
      let delta = load<f64>(this.macDeltaRadPtr + (((m as usize)) << 3));
      let omegaPu = load<f64>(this.macOmegaPuPtr + (((m as usize)) << 3));
      let eqPrime = load<f64>(this.macEqPrimePtr + (((m as usize)) << 3));
      let edPrime = load<f64>(this.macEdPrimePtr + (((m as usize)) << 3));
      let eqSub = load<f64>(this.macEqSubPtr + (((m as usize)) << 3));
      let edSub = load<f64>(this.macEdSubPtr + (((m as usize)) << 3));

      let thetaA = omegaSync * t + delta;
      let thetaB = thetaA - (2.0 * Math.PI) / 3.0;
      let thetaC = thetaA + (2.0 * Math.PI) / 3.0;

      let vqPu = (2.0 / 3.0) * ((va * Math.sin(thetaA) + vb * Math.sin(thetaB) + vc * Math.sin(thetaC)) / vBasePeak);
      let vdPu = (2.0 / 3.0) * ((va * Math.cos(thetaA) + vb * Math.cos(thetaB) + vc * Math.cos(thetaC)) / vBasePeak);

      let xd = load<f64>(this.macXdPtr + (((m as usize)) << 3));
      let xq = load<f64>(this.macXqPtr + (((m as usize)) << 3));
      let xdPrime = load<f64>(this.macXdPrimePtr + (((m as usize)) << 3));
      let xqPrime = load<f64>(this.macXqPrimePtr + (((m as usize)) << 3));
      let xdSub = load<f64>(this.macXdSubPtr + (((m as usize)) << 3));
      let td0Prime = load<f64>(this.macTd0PrimePtr + (((m as usize)) << 3));
      let tq0Prime = load<f64>(this.macTq0PrimePtr + (((m as usize)) << 3));
      let td0Sub = load<f64>(this.macTd0SubPtr + (((m as usize)) << 3));
      let tq0Sub = load<f64>(this.macTq0SubPtr + (((m as usize)) << 3));
      let hInertia = load<f64>(this.macHInertiaPtr + (((m as usize)) << 3));
      let dampingD = load<f64>(this.macDampingPtr + (((m as usize)) << 3));
      let pmPu = load<f64>(this.macPmPuPtr + (((m as usize)) << 3));
      let efPu = load<f64>(this.macEfPuPtr + (((m as usize)) << 3));

      let id = Math.max(-5.0, Math.min(5.0, (eqSub - vqPu) / xdSub));
      let iq = Math.max(-5.0, Math.min(5.0, (vdPu - edSub) / xdSub + pmPu * Math.max(0.2, vqPu)));

      let dEqPrime = (efPu - eqPrime - (xd - xdPrime) * id) / td0Prime;
      let dEdPrime = (-edPrime + (xq - xqPrime) * iq) / tq0Prime;
      eqPrime += dEqPrime * dt;
      edPrime += dEdPrime * dt;

      let dEqSub = (eqPrime - eqSub - (xdPrime - xdSub) * id) / td0Sub;
      let dEdSub = (edPrime - edSub + (xqPrime - xdSub) * iq) / tq0Sub;
      eqSub += dEqSub * dt;
      edSub += dEdSub * dt;

      let tePu = eqSub * iq + edSub * id;
      let dOmega = (pmPu - tePu - dampingD * (omegaPu - 1.0)) / (2.0 * hInertia);
      omegaPu += dOmega * dt;
      delta += (omegaPu - 1.0) * omegaSync * dt;

      store<f64>(this.macDeltaRadPtr + (((m as usize)) << 3), delta);
      store<f64>(this.macOmegaPuPtr + (((m as usize)) << 3), omegaPu);
      store<f64>(this.macEqPrimePtr + (((m as usize)) << 3), eqPrime);
      store<f64>(this.macEdPrimePtr + (((m as usize)) << 3), edPrime);
      store<f64>(this.macEqSubPtr + (((m as usize)) << 3), eqSub);
      store<f64>(this.macEdSubPtr + (((m as usize)) << 3), edSub);
      store<f64>(this.macTePuPtr + (((m as usize)) << 3), tePu);
    }

    // 5g. Advance Power Electronics Converter Bridges (0=vsc_pwm, 1=lcc_6pulse, 2=mmc_thevenin)
    for (let c: u32 = 0; c < this.nConverters; c++) {
      let nodeA = load<i32>(this.convNodeAPtr + (((c as usize)) << 2));
      let nodeB = load<i32>(this.convNodeBPtr + (((c as usize)) << 2));
      let nodeC = load<i32>(this.convNodeCPtr + (((c as usize)) << 2));
      let va: f64 = (nodeA >= 0 && (nodeA as u32) < n) ? vVec[nodeA] : 0.0;

      let topology = load<u32>(this.convTopologyPtr + (((c as usize)) << 2));
      let vBasePeak = load<f64>(this.convVBasePeakPtr + (((c as usize)) << 3));
      let vdcVolts = load<f64>(this.convVdcVoltsPtr + (((c as usize)) << 3));
      let omegaSync = load<f64>(this.convOmegaSyncPtr + (((c as usize)) << 3));
      let gFilter = load<f64>(this.convGFilterPtr + (((c as usize)) << 3));
      let fc = load<f64>(this.convCarrierFreqPtr + (((c as usize)) << 3));
      let alphaRad = load<f64>(this.convAlphaRadPtr + (((c as usize)) << 3));
      let modIndex = load<f64>(this.convModIndexPtr + (((c as usize)) << 3));
      let nSm = load<u32>(this.convNumSmPtr + (((c as usize)) << 2));
      let vcAvg = load<f64>(this.convVcAvgPtr + (((c as usize)) << 3));
      let pllTheta = load<f64>(this.convPllThetaPtr + (((c as usize)) << 3));

      let vNorm = va / Math.max(1.0, vBasePeak);
      let phaseErr = vNorm * Math.cos(pllTheta);
      pllTheta += (omegaSync + 25.0 * phaseErr) * dt;
      let tNext = t + dt;

      if (topology == 2) {
        // MMC Thévenin Equivalent Arm Model: N_sm staircase quantization + circulating 2nd-harmonic suppression
        let nLevels = <f64>nSm;
        let vdcEff = vcAvg * nLevels;
        for (let p: i32 = 0; p < 3; p++) {
          let phOffset = (<f64>p * 2.0 * Math.PI) / 3.0;
          let vRefNorm = modIndex * Math.sin(pllTheta + 0.08 - phOffset);
          let nLow = Math.max(0.0, Math.min(nLevels, Math.round(0.5 * nLevels * (1.0 + vRefNorm))));
          let nUp = nLevels - nLow;
          let vConv = 0.5 * (nLow - nUp) * vcAvg;
          let iNorton = gFilter * vConv;
          if (p == 0) store<f64>(this.convIInjAPtr + (((c as usize)) << 3), iNorton);
          else if (p == 1) store<f64>(this.convIInjBPtr + (((c as usize)) << 3), iNorton);
          else store<f64>(this.convIInjCPtr + (((c as usize)) << 3), iNorton);
        }
        let targetVc = vdcVolts / nLevels;
        vcAvg += 0.05 * (targetVc - vcAvg);
        store<f64>(this.convVcAvgPtr + (((c as usize)) << 3), vcAvg);
        store<f64>(this.convVdcVoltsPtr + (((c as usize)) << 3), vdcEff);
      } else if (topology == 1) {
        // 6-Pulse Graetz LCC Thyristor Bridge
        let vdcAvg = ((3.0 * Math.SQRT2) / Math.PI) * vBasePeak * Math.cos(alphaRad);
        store<f64>(this.convVdcVoltsPtr + (((c as usize)) << 3), vdcAvg);
        let eFundPeak = 0.55 * vBasePeak;
        store<f64>(this.convIInjAPtr + (((c as usize)) << 3), gFilter * eFundPeak * Math.sin(pllTheta - alphaRad));
        store<f64>(
          this.convIInjBPtr + (((c as usize)) << 3),
          gFilter * eFundPeak * Math.sin(pllTheta - alphaRad - (2.0 * Math.PI) / 3.0)
        );
        store<f64>(
          this.convIInjCPtr + (((c as usize)) << 3),
          gFilter * eFundPeak * Math.sin(pllTheta - alphaRad + (2.0 * Math.PI) / 3.0)
        );
      } else {
        // 2-Level VSC Sinusoidal PWM with triangular carrier
        let period = 1.0 / fc;
        let u = (tNext % period) / period;
        let vTri = u < 0.5 ? -1.0 + 4.0 * u : 3.0 - 4.0 * u;
        for (let p: i32 = 0; p < 3; p++) {
          let phOffset = (<f64>p * 2.0 * Math.PI) / 3.0;
          let mRef = modIndex * Math.sin(pllTheta + 0.08 - phOffset);
          let vLeg = (mRef >= vTri ? 0.5 : -0.5) * vdcVolts;
          let iNorton = gFilter * vLeg;
          if (p == 0) store<f64>(this.convIInjAPtr + (((c as usize)) << 3), iNorton);
          else if (p == 1) store<f64>(this.convIInjBPtr + (((c as usize)) << 3), iNorton);
          else store<f64>(this.convIInjCPtr + (((c as usize)) << 3), iNorton);
        }
      }

      store<f64>(this.convPllThetaPtr + (((c as usize)) << 3), pllTheta);
    }

    if (satChanged) {
      this.factorizeCurrentG();
    }

    // 6. Record trajectory step if buffer allocated
    if (this.trajectoryBufferPtr != 0 && this.trajectoryRecordedSteps < this.trajectoryCapacitySteps) {
      let offset = (this.trajectoryRecordedSteps * this.stridePerStep) as usize;
      let ptr = this.trajectoryBufferPtr + (offset << 3);
      store<f64>(ptr, t);
      for (let i: u32 = 0; i < n; i++) {
        store<f64>(ptr + (((i + 1) as usize) << 3), vVec[i]);
      }
      this.trajectoryRecordedSteps++;
    }

    this.t = t + dt;
    this.stepCount++;
  }

  runSteps(nSteps: u32): u32 {
    for (let k: u32 = 0; k < nSteps; k++) {
      this.step();
    }
    return this.stepCount;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Flat C-ABI WebAssembly Exports
// ─────────────────────────────────────────────────────────────────────────────

const WASM_EMT_SOLVER_SIZE: u32 = 2048;

export function emt_create(nNodes: u32, maxBranches: u32, maxSources: u32, dt: f64): usize {
  let solverPtr = atomicChunkAlloc(WASM_EMT_SOLVER_SIZE);
  let solver = changetype<WasmEmtSolver>(solverPtr);
  solver.init(nNodes, maxBranches, maxSources, dt);
  return solverPtr;
}

export function emt_reset(solverPtr: usize): void {
  let solver = changetype<WasmEmtSolver>(solverPtr);
  solver.reset();
}

export function emt_add_branch(solverPtr: usize, from: i32, to: i32, r: f64, l: f64, c: f64): i32 {
  let solver = changetype<WasmEmtSolver>(solverPtr);
  return solver.addBranch(from, to, r, l, c);
}

export function emt_add_source(
  solverPtr: usize,
  node: i32,
  vPeakKv: f64,
  freqHz: f64,
  phaseRad: f64,
  gSource: f64,
  type: u32
): i32 {
  let solver = changetype<WasmEmtSolver>(solverPtr);
  return solver.addSource(node, vPeakKv, freqHz, phaseRad, gSource, type);
}

export function emt_add_bergeron_line(
  solverPtr: usize,
  fromNode: i32,
  toNode: i32,
  zc: f64,
  tauSec: f64,
  rTotal: f64
): i32 {
  let solver = changetype<WasmEmtSolver>(solverPtr);
  return solver.addBergeronLine(fromNode, toNode, zc, tauSec, rTotal);
}

export function emt_add_transformer_winding(
  solverPtr: usize,
  pPos: i32,
  pNeg: i32,
  sPos: i32,
  sNeg: i32,
  gLeakage: f64,
  alphaL: f64,
  turnsRatio: f64
): i32 {
  let solver = changetype<WasmEmtSolver>(solverPtr);
  return solver.addTransformerWinding(pPos, pNeg, sPos, sNeg, gLeakage, alphaL, turnsRatio);
}

export function emt_add_fault(
  solverPtr: usize,
  nodeA: i32,
  nodeB: i32,
  startSec: f64,
  endSec: f64,
  gFault: f64
): i32 {
  let solver = changetype<WasmEmtSolver>(solverPtr);
  return solver.addFault(nodeA, nodeB, startSec, endSec, gFault);
}

export function emt_add_breaker(
  solverPtr: usize,
  fromNode: i32,
  toNode: i32,
  gClosed: f64,
  gOpen: f64,
  closedInitially: bool,
  openTimeSec: f64,
  closeTimeSec: f64,
  choppingCurrentAmp: f64
): i32 {
  let solver = changetype<WasmEmtSolver>(solverPtr);
  return solver.addBreaker(
    fromNode,
    toNode,
    gClosed,
    gOpen,
    closedInitially,
    openTimeSec,
    closeTimeSec,
    choppingCurrentAmp
  );
}

export function emt_add_saturable_core(
  solverPtr: usize,
  node: i32,
  lUnsatH: f64,
  lSatH: f64,
  kneeFluxWb: f64,
  remanentFluxWb: f64
): i32 {
  let solver = changetype<WasmEmtSolver>(solverPtr);
  return solver.addSaturableCore(node, lUnsatH, lSatH, kneeFluxWb, remanentFluxWb);
}

export function emt_add_surge_arrester(
  solverPtr: usize,
  fromNode: i32,
  toNode: i32,
  vRefVolts: f64
): i32 {
  let solver = changetype<WasmEmtSolver>(solverPtr);
  return solver.addSurgeArrester(fromNode, toNode, vRefVolts);
}

export function emt_add_sync_machine(
  solverPtr: usize,
  nodeA: i32,
  nodeB: i32,
  nodeC: i32,
  sBaseMva: f64,
  vBaseKvLL: f64,
  freqHz: f64,
  xd: f64,
  xq: f64,
  xdPrime: f64,
  xqPrime: f64,
  xdSub: f64,
  td0Prime: f64,
  tq0Prime: f64,
  td0Sub: f64,
  tq0Sub: f64,
  hInertia: f64,
  dampingD: f64,
  pmPu: f64,
  efPu: f64
): i32 {
  let solver = changetype<WasmEmtSolver>(solverPtr);
  return solver.addSynchronousMachine(
    nodeA,
    nodeB,
    nodeC,
    sBaseMva,
    vBaseKvLL,
    freqHz,
    xd,
    xq,
    xdPrime,
    xqPrime,
    xdSub,
    td0Prime,
    tq0Prime,
    td0Sub,
    tq0Sub,
    hInertia,
    dampingD,
    pmPu,
    efPu
  );
}

export function emt_set_nonlinear_options(solverPtr: usize, maxIterations: u32, toleranceVolts: f64): void {
  let solver = changetype<WasmEmtSolver>(solverPtr);
  solver.setNonlinearIterationOptions(maxIterations, toleranceVolts);
}

export function emt_get_nonlinear_iterations(solverPtr: usize): u32 {
  let solver = changetype<WasmEmtSolver>(solverPtr);
  return solver.totalNonlinearIterations;
}

export function emt_add_converter_bridge(
  solverPtr: usize,
  nodeA: i32,
  nodeB: i32,
  nodeC: i32,
  topology: u32,
  sBaseMva: f64,
  vBaseKvLL: f64,
  vdcKv: f64,
  freqHz: f64,
  carrierFreqHz: f64,
  alphaDeg: f64,
  modIndex: f64,
  numSubmodules: u32
): i32 {
  let solver = changetype<WasmEmtSolver>(solverPtr);
  return solver.addConverterBridge(
    nodeA,
    nodeB,
    nodeC,
    topology,
    sBaseMva,
    vBaseKvLL,
    vdcKv,
    freqHz,
    carrierFreqHz,
    alphaDeg,
    modIndex,
    numSubmodules
  );
}

export function emt_get_converter_dc_voltage_kv(solverPtr: usize, convIdx: u32): f64 {
  let solver = changetype<WasmEmtSolver>(solverPtr);
  if (convIdx >= solver.nConverters) return 0.0;
  return load<f64>(solver.convVdcVoltsPtr + (((convIdx as usize)) << 3)) / 1000.0;
}

export function emt_build_and_factorize(solverPtr: usize): bool {
  let solver = changetype<WasmEmtSolver>(solverPtr);
  return solver.buildAndFactorize();
}

export function emt_step(solverPtr: usize): void {
  let solver = changetype<WasmEmtSolver>(solverPtr);
  solver.step();
}

export function emt_run_steps(solverPtr: usize, nSteps: u32): u32 {
  let solver = changetype<WasmEmtSolver>(solverPtr);
  return solver.runSteps(nSteps);
}

export function emt_alloc_trajectory(solverPtr: usize, maxSteps: u32): usize {
  let solver = changetype<WasmEmtSolver>(solverPtr);
  return solver.allocTrajectory(maxSteps);
}

export function emt_get_voltages_ptr(solverPtr: usize): usize {
  let solver = changetype<WasmEmtSolver>(solverPtr);
  return solver.vVecPtr;
}

export function emt_get_time(solverPtr: usize): f64 {
  let solver = changetype<WasmEmtSolver>(solverPtr);
  return solver.t;
}

export function emt_get_step_count(solverPtr: usize): u32 {
  let solver = changetype<WasmEmtSolver>(solverPtr);
  return solver.stepCount;
}

export function emt_get_factorization_count(solverPtr: usize): u32 {
  let solver = changetype<WasmEmtSolver>(solverPtr);
  return solver.factorizationCount;
}

export function emt_get_trajectory_ptr(solverPtr: usize): usize {
  let solver = changetype<WasmEmtSolver>(solverPtr);
  return solver.trajectoryBufferPtr;
}

export function emt_get_trajectory_count(solverPtr: usize): u32 {
  let solver = changetype<WasmEmtSolver>(solverPtr);
  return solver.trajectoryRecordedSteps;
}

export function emt_get_branch_current(solverPtr: usize, branchIdx: u32): f64 {
  let solver = changetype<WasmEmtSolver>(solverPtr);
  if (branchIdx >= solver.nBranches) return 0.0;
  return load<f64>(solver.branchCurrentPtr + (((branchIdx as usize)) << 3));
}

export function emt_get_arrester_energy(solverPtr: usize, arrIdx: u32): f64 {
  let solver = changetype<WasmEmtSolver>(solverPtr);
  if (arrIdx >= solver.nArresters) return 0.0;
  return load<f64>(solver.arrEnergyJPtr + (((arrIdx as usize)) << 3));
}

export function emt_get_machine_speed_pu(solverPtr: usize, macIdx: u32): f64 {
  let solver = changetype<WasmEmtSolver>(solverPtr);
  if (macIdx >= solver.nMachines) return 1.0;
  return load<f64>(solver.macOmegaPuPtr + (((macIdx as usize)) << 3));
}

export function emt_get_machine_angle_deg(solverPtr: usize, macIdx: u32): f64 {
  let solver = changetype<WasmEmtSolver>(solverPtr);
  if (macIdx >= solver.nMachines) return 0.0;
  return (load<f64>(solver.macDeltaRadPtr + (((macIdx as usize)) << 3)) * 180.0) / Math.PI;
}


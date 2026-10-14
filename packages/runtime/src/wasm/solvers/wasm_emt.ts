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

  dt: f64;
  t: f64;
  stepCount: u32;

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
  vVecPtr: usize;        // Float64Array[nNodes] - Node voltages solution v(t)

  // Branch data
  branchFromPtr: usize;      // Int32Array[maxBranches]
  branchToPtr: usize;        // Int32Array[maxBranches]
  branchTypePtr: usize;      // Uint32Array[maxBranches]
  branchGLPtr: usize;        // Float64Array[maxBranches]
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

  // Trajectory recording buffer in linear memory (zero-copy streaming)
  trajectoryBufferPtr: usize;
  trajectoryCapacitySteps: u32;
  trajectoryRecordedSteps: u32;
  stridePerStep: u32;        // 1 (time) + nNodes

  init(nNodes: u32, maxBranches: u32, maxSources: u32, dt: f64): void {
    this.nNodes = nNodes;
    this.maxBranches = maxBranches > 0 ? maxBranches : 64;
    this.maxSources = maxSources > 0 ? maxSources : 16;
    this.nBranches = 0;
    this.nSources = 0;
    this.dt = dt;
    this.t = 0.0;
    this.stepCount = 0;
    this.isFactorized = false;

    // Allocate matrix and vectors
    let matSize = nNodes * nNodes;
    this.gDensePtr = atomicChunkAlloc(matSize * sizeof<f64>());
    this.luFactoredPtr = atomicChunkAlloc(matSize * sizeof<f64>());
    this.luPivPtr = atomicChunkAlloc(nNodes * sizeof<i32>());
    this.luScalePtr = atomicChunkAlloc(nNodes * sizeof<f64>());
    this.luScratchPtr = atomicChunkAlloc(nNodes * sizeof<f64>());

    this.bVecPtr = atomicChunkAlloc(nNodes * sizeof<f64>());
    this.vVecPtr = atomicChunkAlloc(nNodes * sizeof<f64>());

    // Allocate branch buffers
    this.branchFromPtr = atomicChunkAlloc(this.maxBranches * sizeof<i32>());
    this.branchToPtr = atomicChunkAlloc(this.maxBranches * sizeof<i32>());
    this.branchTypePtr = atomicChunkAlloc(this.maxBranches * sizeof<u32>());
    this.branchGLPtr = atomicChunkAlloc(this.maxBranches * sizeof<f64>());
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

    this.trajectoryBufferPtr = 0;
    this.trajectoryCapacitySteps = 0;
    this.trajectoryRecordedSteps = 0;
    this.stridePerStep = 1 + nNodes;
  }

  addBranch(fromNode: i32, toNode: i32, r: f64, l: f64, c: f64): i32 {
    if (this.nBranches >= this.maxBranches) return -1;
    let idx = this.nBranches++;

    let gR: f64 = r > 0.0 ? 1.0 / r : 0.0;
    let gL: f64 = l > 0.0 ? this.dt / (2.0 * l) : 0.0;
    let gC: f64 = c > 0.0 ? (2.0 * c) / this.dt : 0.0;
    let gTotal: f64 = (l > 0.0 || c > 0.0) ? (gL + gC + gR) : (r > 0.0 ? gR : 1e4);

    let type: u32 = EMT_BRANCH_TYPE_PARALLEL_RLC;
    if (l == 0.0 && c == 0.0) type = EMT_BRANCH_TYPE_RESISTOR;
    else if (r == 0.0 && c == 0.0) type = EMT_BRANCH_TYPE_INDUCTOR;
    else if (r == 0.0 && l == 0.0) type = EMT_BRANCH_TYPE_CAPACITOR;

    store<i32>(this.branchFromPtr + (((idx as usize)) << 2), fromNode);
    store<i32>(this.branchToPtr + (((idx as usize)) << 2), toNode);
    store<u32>(this.branchTypePtr + (((idx as usize)) << 2), type);
    store<f64>(this.branchGLPtr + (((idx as usize)) << 3), gL);
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

  @inline
  private addG(r: u32, c: u32, delta: f64): void {
    let ptr = this.gDensePtr + ((((r * this.nNodes + c) as usize)) << 3);
    store<f64>(ptr, load<f64>(ptr) + delta);
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

    // 2. Stamp source Norton conductances
    for (let s: u32 = 0; s < this.nSources; s++) {
      let node = load<i32>(this.sourceNodePtr + (((s as usize)) << 2));
      let gSource = load<f64>(this.sourceGPtr + (((s as usize)) << 3));
      this.stampShunt(node, gSource);
    }

    // Copy [G] to luFactoredPtr
    for (let i: u32 = 0; i < matSize; i++) {
      let offset = (i as usize) << 3;
      store<f64>(this.luFactoredPtr + offset, load<f64>(this.gDensePtr + offset));
    }

    // Factorize LU with row equilibration and partial pivoting
    let ok = luFactor(
      this.luFactoredPtr as u32,
      this.luPivPtr as u32,
      this.luScalePtr as u32,
      n
    );
    this.isFactorized = ok;
    return ok;
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

    // 4. Solve [G] * v(t) = b
    // luSolve overwrites the RHS buffer in-place
    luSolve(
      this.luFactoredPtr as u32,
      this.luPivPtr as u32,
      this.luScalePtr as u32,
      this.bVecPtr as u32,
      this.luScratchPtr as u32,
      n
    );

    // Copy solution to vVec
    for (let i: u32 = 0; i < n; i++) {
      let offset = (i as usize) << 3;
      store<f64>(this.vVecPtr + offset, load<f64>(this.bVecPtr + offset));
    }

    // 5. Update RLC branch currents and history currents for next step
    for (let b: u32 = 0; b < this.nBranches; b++) {
      let fromNode = load<i32>(this.branchFromPtr + (((b as usize)) << 2));
      let toNode = load<i32>(this.branchToPtr + (((b as usize)) << 2));
      let vFrom: f64 = (fromNode >= 0 && (fromNode as u32) < n) ? vVec[fromNode] : 0.0;
      let vTo: f64 = (toNode >= 0 && (toNode as u32) < n) ? vVec[toNode] : 0.0;
      let vBranch = vFrom - vTo;

      let gL = load<f64>(this.branchGLPtr + (((b as usize)) << 3));
      let gC = load<f64>(this.branchGCPtr + (((b as usize)) << 3));
      let gR = load<f64>(this.branchGRPtr + (((b as usize)) << 3));
      let iHistL = load<f64>(this.branchIHistLPtr + (((b as usize)) << 3));
      let iHistC = load<f64>(this.branchIHistCPtr + (((b as usize)) << 3));

      let iBranch: f64 = 0.0;
      if (gL > 0.0) {
        let iL = gL * vBranch + iHistL;
        // Trapezoidal companion update
        store<f64>(this.branchIHistLPtr + (((b as usize)) << 3), iL + gL * vBranch);
        iBranch += iL;
      }
      if (gC > 0.0) {
        let iC = gC * vBranch + iHistC;
        // Trapezoidal companion update
        store<f64>(this.branchIHistCPtr + (((b as usize)) << 3), -iC - gC * vBranch);
        iBranch += iC;
      }
      if (gR > 0.0 && gL == 0.0 && gC == 0.0) {
        iBranch = vBranch * gR;
      }

      store<f64>(this.branchCurrentPtr + (((b as usize)) << 3), iBranch);
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

const WASM_EMT_SOLVER_SIZE: u32 = 512;

export function emt_create(nNodes: u32, maxBranches: u32, maxSources: u32, dt: f64): usize {
  let solverPtr = atomicChunkAlloc(WASM_EMT_SOLVER_SIZE);
  let solver = changetype<WasmEmtSolver>(solverPtr);
  solver.init(nNodes, maxBranches, maxSources, dt);
  return solverPtr;
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

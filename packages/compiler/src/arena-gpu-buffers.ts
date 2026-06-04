// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Arena GPU Buffer Serialization — Phase 0 of the WebGPU simulation backend.
 *
 * Serializes the flat struct-of-arrays data from ArenaDAEBuilder into
 * GPU-mappable typed arrays. Because the arena already stores data as
 * Int32Array columns with fixed strides, serialization is essentially
 * zero-cost — just typed array copies or subarray views.
 *
 * The output buffers are ready to be uploaded to GPUBuffer objects for
 * use by WGSL compute shaders.
 */

import type { ArenaBltResult } from "./arena-blt.js";
import { type ArenaDAEBuilder, Variability } from "./dae-arena.js";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** GPU-ready serialization of the arena DAE data. */
export interface GPUArenaBuffers {
  /**
   * Variable metadata: 8 × i32 per variable.
   * Layout per variable: [nameId, type, variability, causality, startHi, startLo, shapeDim, flags]
   * Direct copy from `arena.varView()`.
   */
  varBuffer: Int32Array;
  /** Number of variables. */
  varCount: number;

  /**
   * Equation metadata: 4 × i32 per equation.
   * Layout per equation: [kind, lhsExprId, rhsExprId, aux]
   * Direct copy from `arena.eqView()`.
   */
  eqBuffer: Int32Array;
  /** Number of equations. */
  eqCount: number;

  /**
   * Expression tree: 4 × i32 per expression node.
   * Layout per node: [kind, data1, left, right]
   * Direct copy from `arena.exprView()`.
   */
  exprBuffer: Int32Array;
  /** Number of expression nodes. */
  exprCount: number;

  /**
   * Variable state values, indexed by varIdx.
   * Initialized from start values and parameter evaluations.
   * This is the primary read/write buffer for the GPU simulation loop.
   */
  stateBuffer: Float32Array;

  /**
   * Name-to-variable-index lookup table.
   * Indexed by StringId, value = varIdx or -1 if no mapping.
   * Allows the GPU to resolve variable references by StringId.
   */
  nameToVarIdx: Int32Array;

  /** BLT execution plan for dispatching compute shader workgroups. */
  blockPlan: GPUBlockPlan;

  /**
   * Indices of state variables (continuous, non-removed, non-parameter).
   * These are the variables whose derivatives are computed by the ODE solver.
   */
  stateVarIndices: Uint32Array;

  /**
   * Indices of derivative variables (`der(x)`) corresponding to stateVarIndices.
   * `derivVarIndices[i]` is the varIdx for `der(stateVarNames[i])`.
   */
  derivVarIndices: Uint32Array;
}

/** BLT block execution plan, packed for GPU consumption. */
export interface GPUBlockPlan {
  /**
   * Block boundary offsets into `sortedEqs`.
   * Block `i` contains equations `sortedEqs[blockStarts[i] .. blockStarts[i+1])`.
   * Length = blockCount + 1.
   */
  blockStarts: Uint32Array;

  /** Sorted equation indices in BLT execution order. */
  sortedEqs: Uint32Array;

  /**
   * Per-block flags (bit field).
   * Bit 0: isAlgebraicLoop (block size > 1, requires Newton iteration).
   * Length = blockCount.
   */
  blockFlags: Uint32Array;

  /**
   * Per-block variable assignments.
   * `blockVars[blockVarStarts[i] .. blockVarStarts[i+1])` gives the
   * variable indices assigned to block `i` by the BLT matching.
   */
  blockVars: Uint32Array;

  /**
   * Variable assignment boundary offsets into `blockVars`.
   * Length = blockCount + 1.
   */
  blockVarStarts: Uint32Array;

  /** Total number of BLT blocks. */
  blockCount: number;

  /** Number of scalar blocks (size 1, direct assignment). */
  scalarBlockCount: number;

  /** Number of algebraic loop blocks (size > 1, Newton iteration). */
  loopBlockCount: number;

  /** Maximum block size (for GPU shared memory allocation). */
  maxBlockSize: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Serialization
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Serialize an ArenaDAEBuilder and its BLT result into GPU-mappable buffers.
 *
 * This is a compile-time operation. The returned buffers are immutable
 * descriptions of the DAE structure. The `stateBuffer` is the only
 * read/write buffer that changes during simulation.
 *
 * @param arena - The flattened DAE arena (after constant folding, alias elimination).
 * @param bltResult - BLT decomposition result from `performBltTransformationArena()`.
 * @param stateVars - Set of state variable indices (from Pantelides index reduction).
 * @returns GPU-ready buffer pack.
 */
export function serializeArenaForGPU(
  arena: ArenaDAEBuilder,
  bltResult: ArenaBltResult,
  stateVars: Set<number>,
): GPUArenaBuffers {
  // 1. Direct copy of arena struct-of-arrays views
  const varBuffer = new Int32Array(arena.varView());
  const eqBuffer = new Int32Array(arena.eqView());
  const exprBuffer = new Int32Array(arena.exprView());

  // 2. Build state buffer from start values (Emulated f64 via Double-Single vec2<f32>)
  const stateBuffer = new Float32Array(arena.varCount * 2);
  for (let i = 0; i < arena.varCount; i++) {
    const val = arena.getVarStartValue(i);
    const high = Math.fround(val);
    const low = Math.fround(val - high);
    stateBuffer[i * 2] = high;
    stateBuffer[i * 2 + 1] = low;
  }

  // 3. Build nameId → varIdx lookup table
  const nameToVarIdx = new Int32Array(Math.max(arena.interner.size + 256, 4096)).fill(-1);
  for (let i = 0; i < arena.varCount; i++) {
    if (!arena.isVarRemoved(i)) {
      nameToVarIdx[arena.getVarNameId(i)] = i;
    }
  }

  // 4. Identify state variables and their derivatives
  const stateIdxList: number[] = [];
  const derivIdList: number[] = [];
  for (const varIdx of stateVars) {
    if (arena.isVarRemoved(varIdx)) continue;
    const name = arena.getVarName(varIdx);
    const derName = `der(${name})`;
    // const derNameId = arena.interner.intern(derName);
    const derVarIdx = arena.getVarIdxByName(derName);
    stateIdxList.push(varIdx);
    if (derVarIdx >= 0) derivIdList.push(derVarIdx);
    else derivIdList.push(0); // Should theoretically not happen for valid states
  }

  // 5. Pack BLT blocks
  const blockPlan = packBlockPlan(bltResult);

  return {
    varBuffer,
    varCount: arena.varCount,
    eqBuffer,
    eqCount: arena.eqCount,
    exprBuffer,
    exprCount: arena.exprCount,
    stateBuffer,
    nameToVarIdx,
    blockPlan,
    stateVarIndices: new Uint32Array(stateIdxList),
    derivVarIndices: new Uint32Array(derivIdList),
  };
}

/**
 * Pack a BLT result into the GPU block plan format.
 *
 * The block plan is a compact, GPU-friendly representation of the BLT
 * execution order. It uses offset arrays (CSR-style) to avoid variable-
 * length structures.
 */
function packBlockPlan(blt: ArenaBltResult): GPUBlockPlan {
  const blockCount = blt.blocks.length;

  // Calculate total equation and variable counts across all blocks
  let totalEqs = 0;
  let totalVars = 0;
  let scalarBlockCount = 0;
  let loopBlockCount = 0;
  let maxBlockSize = 0;

  for (const block of blt.blocks) {
    totalEqs += block.eqIdxs.length;
    totalVars += block.vars.length;
    const size = block.eqIdxs.length;
    if (size <= 1) scalarBlockCount++;
    else loopBlockCount++;
    if (size > maxBlockSize) maxBlockSize = size;
  }

  // Pack equation indices and block boundaries
  const blockStarts = new Uint32Array(blockCount + 1);
  const sortedEqs = new Uint32Array(totalEqs);
  const blockFlags = new Uint32Array(blockCount);
  const blockVars = new Uint32Array(totalVars);
  const blockVarStarts = new Uint32Array(blockCount + 1);

  let eqOffset = 0;
  let varOffset = 0;

  for (let i = 0; i < blockCount; i++) {
    const block = blt.blocks[i];
    if (!block) continue;

    blockStarts[i] = eqOffset;
    blockVarStarts[i] = varOffset;

    // Copy equation indices
    for (const eqIdx of block.eqIdxs) {
      sortedEqs[eqOffset++] = eqIdx;
    }

    // Copy variable indices
    for (const varIdx of block.vars) {
      blockVars[varOffset++] = varIdx;
    }

    // Set flags
    blockFlags[i] = block.eqIdxs.length > 1 ? 1 : 0; // bit 0 = isAlgebraicLoop
  }

  blockStarts[blockCount] = eqOffset;
  blockVarStarts[blockCount] = varOffset;

  return {
    blockStarts,
    sortedEqs,
    blockFlags,
    blockVars,
    blockVarStarts,
    blockCount,
    scalarBlockCount,
    loopBlockCount,
    maxBlockSize,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Parameter Initialization
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Initialize the stateBuffer with parameter values from the arena.
 * Call this after `serializeArenaForGPU()` and before GPU upload.
 *
 * @param arena - The source arena.
 * @param buffers - The GPU buffer pack to update.
 * @param parameterOverrides - Optional parameter value overrides.
 */
export function initializeGPUStateBuffer(
  arena: ArenaDAEBuilder,
  buffers: GPUArenaBuffers,
  parameterOverrides?: Map<string, number>,
): void {
  // Set all parameter and constant values
  for (let i = 0; i < arena.varCount; i++) {
    if (arena.isVarRemoved(i)) continue;
    const v = arena.getVarVariability(i);
    if (v === Variability.Parameter || v === Variability.Constant) {
      buffers.stateBuffer[i] = arena.getVarStartValue(i);
    }
  }

  // Apply overrides
  if (parameterOverrides) {
    for (const [name, val] of parameterOverrides) {
      const idx = arena.getVarIdxByName(name);
      if (idx >= 0) {
        buffers.stateBuffer[idx] = val;
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Memory Estimation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Estimate the total GPU memory required for the arena buffers.
 *
 * @param buffers - The serialized GPU buffer pack.
 * @returns Estimated GPU memory in bytes.
 */
export function estimateGPUMemoryBytes(buffers: GPUArenaBuffers): number {
  return (
    buffers.varBuffer.byteLength +
    buffers.eqBuffer.byteLength +
    buffers.exprBuffer.byteLength +
    buffers.stateBuffer.byteLength +
    buffers.nameToVarIdx.byteLength +
    buffers.blockPlan.blockStarts.byteLength +
    buffers.blockPlan.sortedEqs.byteLength +
    buffers.blockPlan.blockFlags.byteLength +
    buffers.blockPlan.blockVars.byteLength +
    buffers.blockPlan.blockVarStarts.byteLength +
    buffers.stateVarIndices.byteLength +
    buffers.derivVarIndices.byteLength
  );
}

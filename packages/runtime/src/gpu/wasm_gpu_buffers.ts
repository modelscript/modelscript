// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ArenaBltResult } from "../analysis/wasm_blt.js";
import { type DAEBuilder, getDefaultWasmExports } from "../dae/wasm_dae.js";

/** GPU-ready serialization of the arena DAE data. */
export interface GPUArenaBuffers {
  varBuffer: Int32Array;
  varCount: number;
  eqBuffer: Int32Array;
  eqCount: number;
  exprBuffer: Int32Array;
  exprCount: number;
  stateBuffer: Float32Array;
  nameToVarIdx: Int32Array;
  blockPlan: GPUBlockPlan;
  stateVarIndices: Uint32Array;
  derivVarIndices: Uint32Array;
  varOffsets?: Int32Array | undefined;
  totalScalarElements?: number | undefined;
}

/** BLT block execution plan, packed for GPU consumption. */
export interface GPUBlockPlan {
  blockStarts: Uint32Array;
  sortedEqs: Uint32Array;
  blockFlags: Uint32Array;
  blockVars: Uint32Array;
  blockVarStarts: Uint32Array;
  blockCount: number;
  scalarBlockCount: number;
  loopBlockCount: number;
  maxBlockSize: number;
}

/** Direct WASM memory pointers for zero-copy WebGPU buffer uploads. */
export interface GPUArenaBufferPointers {
  stateBufPtr: number;
  stateBufByteLength: number;
  nameToVarIdxPtr: number;
  nameToVarIdxByteLength: number;
  blockStartsPtr: number;
  sortedEqsPtr: number;
  blockFlagsPtr: number;
  blockVarsPtr: number;
  blockVarStartsPtr: number;
  stateVarIndicesPtr: number;
  derivVarIndicesPtr: number;
  memoryBuffer: ArrayBuffer;
}

export interface GpuBuffersWasmExports {
  memory?: WebAssembly.Memory;
  alloc?: (size: number) => number;
  gpu_serializeBuffers?: (
    daePtr: number,
    blockCount: number,
    rawBlocksPtr: number,
    stateCount: number,
    stateVarsPtr: number,
    derivVarsPtr: number,
  ) => number;
  gpu_getStateBufferPtr?: (packPtr: number) => number;
  gpu_getStateBufferSize?: (packPtr: number) => number;
  gpu_getNameToVarIdxPtr?: (packPtr: number) => number;
  gpu_getNameToVarIdxCap?: (packPtr: number) => number;
  gpu_getBlockCount?: (packPtr: number) => number;
  gpu_getTotalEqs?: (packPtr: number) => number;
  gpu_getTotalVars?: (packPtr: number) => number;
  gpu_getScalarBlockCount?: (packPtr: number) => number;
  gpu_getLoopBlockCount?: (packPtr: number) => number;
  gpu_getMaxBlockSize?: (packPtr: number) => number;
  gpu_getBlockStartsPtr?: (packPtr: number) => number;
  gpu_getSortedEqsPtr?: (packPtr: number) => number;
  gpu_getBlockFlagsPtr?: (packPtr: number) => number;
  gpu_getBlockVarsPtr?: (packPtr: number) => number;
  gpu_getBlockVarStartsPtr?: (packPtr: number) => number;
  gpu_getStateVarIndicesPtr?: (packPtr: number) => number;
  gpu_getDerivVarIndicesPtr?: (packPtr: number) => number;
  gpu_getStateCount?: (packPtr: number) => number;
  gpu_initializeStateBuffer?: (daePtr: number, wasmBufPtr: number) => void;
}

interface ArenaInternalAccess {
  exports?: GpuBuffersWasmExports;
  memory?: WebAssembly.Memory;
  alloc?: (size: number) => number;
  ptr?: number;
}

/**
 * Serializes an DAEBuilder and its BLT result using the in-WASM GPU buffer kernel.
 * Packs double-single state vectors, CSR execution block plans, and lookup tables
 * directly in linear memory with native f32 conversion instructions.
 */
export function serializeArenaForGPUWasm(
  arena: DAEBuilder,
  bltResult: ArenaBltResult,
  stateVars: Set<number>,
  wasmExports?: GpuBuffersWasmExports,
): GPUArenaBuffers | null {
  const arenaInternal = arena as unknown as ArenaInternalAccess;
  const exports = wasmExports ?? arenaInternal.exports ?? (getDefaultWasmExports() as GpuBuffersWasmExports | null);
  if (!exports || typeof exports.gpu_serializeBuffers !== "function") {
    return null;
  }

  const memory = exports.memory ?? arenaInternal.memory;
  if (!memory || !memory.buffer) {
    return null;
  }

  const alloc = exports.alloc ?? arenaInternal.alloc;

  // 1. Pack raw BLT blocks into WASM memory
  // Layout: [b0EqCount, b0VarCount, eq0, eq1, ..., var0, var1, ..., b1EqCount, b1VarCount, ...]
  let totalInts = 0;
  for (const block of bltResult.blocks) {
    totalInts += 2 + block.eqIdxs.length + block.vars.length;
  }

  let rawBlocksPtr = 0;
  if (totalInts > 0 && alloc) {
    rawBlocksPtr = alloc(totalInts * 4);
    const rawView = new Uint32Array(memory.buffer, rawBlocksPtr, totalInts);
    let cursor = 0;
    for (const block of bltResult.blocks) {
      rawView[cursor++] = block.eqIdxs.length;
      rawView[cursor++] = block.vars.length;
      for (const eq of block.eqIdxs) rawView[cursor++] = eq;
      for (const v of block.vars) rawView[cursor++] = v;
    }
  }

  // 2. Pack stateVars and pre-resolve derivVars
  let stateVarsPtr = 0;
  let derivVarsPtr = 0;
  const stateCount = stateVars.size;
  if (stateCount > 0 && alloc) {
    stateVarsPtr = alloc(stateCount * 4);
    derivVarsPtr = alloc(stateCount * 4);
    const sView = new Uint32Array(memory.buffer, stateVarsPtr, stateCount);
    const dView = new Uint32Array(memory.buffer, derivVarsPtr, stateCount);
    let sIdx = 0;
    for (const v of stateVars) {
      sView[sIdx] = v;
      const name = arena.getVarName(v);
      const derVarIdx = name ? arena.getVarIdxByName(`der(${name})`) : -1;
      dView[sIdx] = derVarIdx >= 0 ? derVarIdx : 0;
      sIdx++;
    }
  }

  const daePtr = arenaInternal.ptr ?? 0;
  const packPtr = exports.gpu_serializeBuffers(
    daePtr,
    bltResult.blocks.length,
    rawBlocksPtr,
    stateCount,
    stateVarsPtr,
    derivVarsPtr,
  );

  if (packPtr === 0) return null;

  // 3. Read metadata and construct typed array views
  const stateBufPtr = exports.gpu_getStateBufferPtr!(packPtr);
  const stateBufSize = exports.gpu_getStateBufferSize!(packPtr);
  const nameToVarIdxPtr = exports.gpu_getNameToVarIdxPtr!(packPtr);
  const nameToVarIdxCap = exports.gpu_getNameToVarIdxCap!(packPtr);

  const blockCount = exports.gpu_getBlockCount!(packPtr);
  const totalEqs = exports.gpu_getTotalEqs!(packPtr);
  const totalVars = exports.gpu_getTotalVars!(packPtr);
  const scalarBlockCount = exports.gpu_getScalarBlockCount!(packPtr);
  const loopBlockCount = exports.gpu_getLoopBlockCount!(packPtr);
  const maxBlockSize = exports.gpu_getMaxBlockSize!(packPtr);

  const blockStartsPtr = exports.gpu_getBlockStartsPtr!(packPtr);
  const sortedEqsPtr = exports.gpu_getSortedEqsPtr!(packPtr);
  const blockFlagsPtr = exports.gpu_getBlockFlagsPtr!(packPtr);
  const blockVarsPtr = exports.gpu_getBlockVarsPtr!(packPtr);
  const blockVarStartsPtr = exports.gpu_getBlockVarStartsPtr!(packPtr);

  const sIndicesPtr = exports.gpu_getStateVarIndicesPtr!(packPtr);
  const dIndicesPtr = exports.gpu_getDerivVarIndicesPtr!(packPtr);
  const returnedStateCount = exports.gpu_getStateCount!(packPtr);

  const varBuffer = new Int32Array(arena.varView());
  const eqBuffer = new Int32Array(arena.eqView());
  const exprBuffer = new Int32Array(arena.exprView());

  const stateBuffer = new Float32Array(new Float32Array(memory.buffer, stateBufPtr, stateBufSize));
  const nameToVarIdx = new Int32Array(new Int32Array(memory.buffer, nameToVarIdxPtr, nameToVarIdxCap));

  const blockPlan: GPUBlockPlan = {
    blockStarts: new Uint32Array(new Uint32Array(memory.buffer, blockStartsPtr, blockCount + 1)),
    sortedEqs: new Uint32Array(new Uint32Array(memory.buffer, sortedEqsPtr, totalEqs)),
    blockFlags: new Uint32Array(new Uint32Array(memory.buffer, blockFlagsPtr, blockCount)),
    blockVars: new Uint32Array(new Uint32Array(memory.buffer, blockVarsPtr, totalVars)),
    blockVarStarts: new Uint32Array(new Uint32Array(memory.buffer, blockVarStartsPtr, blockCount + 1)),
    blockCount,
    scalarBlockCount,
    loopBlockCount,
    maxBlockSize,
  };

  const stateVarIndices = new Uint32Array(new Uint32Array(memory.buffer, sIndicesPtr, returnedStateCount));
  const derivVarIndices = new Uint32Array(new Uint32Array(memory.buffer, dIndicesPtr, returnedStateCount));

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
    stateVarIndices,
    derivVarIndices,
  };
}

/**
 * Direct in-WASM parameter initialization for the stateBuffer.
 */
export function initializeGPUStateBufferWasm(
  arena: DAEBuilder,
  stateBuffer: Float32Array,
  wasmExports?: GpuBuffersWasmExports,
): boolean {
  const arenaInternal = arena as unknown as ArenaInternalAccess;
  const exports = wasmExports ?? arenaInternal.exports ?? (getDefaultWasmExports() as GpuBuffersWasmExports | null);
  if (!exports || typeof exports.gpu_initializeStateBuffer !== "function") {
    return false;
  }
  const daePtr = arenaInternal.ptr ?? 0;
  const memory = exports.memory ?? arenaInternal.memory;
  if (!memory) return false;

  const alloc = exports.alloc;
  if (!alloc) return false;

  const bufBytes = stateBuffer.length * 4;
  const wasmBufPtr = alloc(bufBytes);
  new Float32Array(memory.buffer, wasmBufPtr, stateBuffer.length).set(stateBuffer);

  exports.gpu_initializeStateBuffer(daePtr, wasmBufPtr);
  stateBuffer.set(new Float32Array(memory.buffer, wasmBufPtr, stateBuffer.length));
  return true;
}

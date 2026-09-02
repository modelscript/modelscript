// SPDX-License-Identifier: AGPL-3.0-or-later
// @ts-nocheck
import {
  DaeBuilder,
  VAR_STRIDE,
  VAR_NAME,
  VAR_VARIABILITY,
  VAR_FLAGS,
  FLAG_VAR_REMOVED,
  Variability,
  EQ_STRIDE,
  EQ_LHS,
  EXPR_STRIDE,
  EXPR_KIND,
  EXPR_DATA1,
  ExprKind,
} from "./dae";
import { atomicChunkAlloc } from "./arena";

/**
 * Packed WebGPU Arena Buffers.
 * Holds linear-memory pointers and metadata for GPU-mappable data.
 */
@unmanaged
export class GpuBufferPack {
  daePtr: usize;

  // State Buffer: Float32Array (high/low vec2<f32> double-single per variable)
  stateBufferPtr: usize;
  stateBufferSize: u32; // in f32 elements (varCount * 2)

  // Name to VarIdx lookup table: Int32Array indexed by StringId
  nameToVarIdxPtr: usize;
  nameToVarIdxCap: u32;

  // Packed CSR Block Plan
  blockStartsPtr: usize;       // Uint32Array (blockCount + 1)
  sortedEqsPtr: usize;         // Uint32Array (totalEqs)
  blockFlagsPtr: usize;        // Uint32Array (blockCount)
  blockVarsPtr: usize;         // Uint32Array (totalVars)
  blockVarStartsPtr: usize;    // Uint32Array (blockCount + 1)

  blockCount: u32;
  scalarBlockCount: u32;
  loopBlockCount: u32;
  maxBlockSize: u32;
  totalEqs: u32;
  totalVars: u32;

  // State & Derivative Indices
  stateVarIndicesPtr: usize;   // Uint32Array (stateCount)
  derivVarIndicesPtr: usize;   // Uint32Array (stateCount)
  stateCount: u32;
}

/**
 * Serializes the DAE state buffer, name index table, CSR block plan,
 * and state/derivative variable indices directly in WASM linear memory.
 */
export function gpu_serializeBuffers(
  daePtr: u32,
  numBlocks: u32,
  rawBlocksPtr: u32,
  numStateVars: u32,
  stateVarsPtr: u32,
  derivVarsPtr: u32
): u32 {
  let dae = changetype<DaeBuilder>(daePtr);
  let packPtr = atomicChunkAlloc(offsetof<GpuBufferPack>() + 64);
  let pack = changetype<GpuBufferPack>(packPtr);
  pack.daePtr = daePtr as usize;

  let varCount = dae.varCount;

  // 1. Pack stateBuffer (Double-Single vec2<f32>)
  let stateSize = varCount * 2;
  let stateBytes: u32 = stateSize << 2;
  let stateBufPtr = atomicChunkAlloc(stateBytes);
  for (let i: u32 = 0; i < varCount; i++) {
    let val: f64 = dae.getVarStartValue(i);
    let high: f32 = f32(val);
    let low: f32 = f32(val - f64(high));
    let byteOffset = (i << 3) as usize;
    store<f32>(stateBufPtr + byteOffset, high);
    store<f32>(stateBufPtr + byteOffset + 4, low);
  }
  pack.stateBufferPtr = stateBufPtr as usize;
  pack.stateBufferSize = stateSize;

  // 2. Pack nameToVarIdx table
  let poolSize: u32 = dae.stringPool != null ? dae.stringPool.stringCount : 0;
  let nameCap: u32 = poolSize + 256;
  if (nameCap < 4096) nameCap = 4096;
  let nameBytes: u32 = nameCap << 2;
  let nameTablePtr = atomicChunkAlloc(nameBytes);
  memory.fill(nameTablePtr, 0xff, nameBytes as usize); // fill with -1

  for (let i: u32 = 0; i < varCount; i++) {
    if (!dae.isVarRemoved(i)) {
      let nameId = dae.getVarNameId(i);
      if (nameId < nameCap) {
        store<i32>(nameTablePtr + ((nameId as usize) << 2), i as i32);
      }
    }
  }
  pack.nameToVarIdxPtr = nameTablePtr as usize;
  pack.nameToVarIdxCap = nameCap;

  // 3. Pack BLT Block Plan
  // rawBlocksPtr layout:
  // [b0EqCount, b0VarCount, eq0, eq1, ..., var0, var1, ..., b1EqCount, b1VarCount, ...]
  let totalEqs: u32 = 0;
  let totalVars: u32 = 0;
  let scalarCount: u32 = 0;
  let loopCount: u32 = 0;
  let maxBlockSize: u32 = 0;

  if (numBlocks > 0 && rawBlocksPtr != 0) {
    let cursor: usize = rawBlocksPtr as usize;
    for (let b: u32 = 0; b < numBlocks; b++) {
      let eqLen = load<u32>(cursor);
      cursor += 4;
      let varLen = load<u32>(cursor);
      cursor += 4;

      totalEqs += eqLen;
      totalVars += varLen;

      if (eqLen <= 1) {
        scalarCount++;
      } else {
        loopCount++;
      }
      if (eqLen > maxBlockSize) {
        maxBlockSize = eqLen;
      }

      // Skip equations and variables
      cursor += ((eqLen + varLen) as usize) << 2;
    }
  }

  pack.blockCount = numBlocks;
  pack.scalarBlockCount = scalarCount;
  pack.loopBlockCount = loopCount;
  pack.maxBlockSize = maxBlockSize;
  pack.totalEqs = totalEqs;
  pack.totalVars = totalVars;

  let blockStartsPtr = atomicChunkAlloc((numBlocks + 1) << 2);
  let sortedEqsPtr = atomicChunkAlloc(totalEqs << 2);
  let blockFlagsPtr = atomicChunkAlloc(numBlocks << 2);
  let blockVarsPtr = atomicChunkAlloc(totalVars << 2);
  let blockVarStartsPtr = atomicChunkAlloc((numBlocks + 1) << 2);

  let eqOffset: u32 = 0;
  let varOffset: u32 = 0;

  if (numBlocks > 0 && rawBlocksPtr != 0) {
    let cursor: usize = rawBlocksPtr as usize;
    for (let b: u32 = 0; b < numBlocks; b++) {
      let eqLen = load<u32>(cursor);
      cursor += 4;
      let varLen = load<u32>(cursor);
      cursor += 4;

      store<u32>(blockStartsPtr + ((b as usize) << 2), eqOffset);
      store<u32>(blockVarStartsPtr + ((b as usize) << 2), varOffset);

      // Copy equations
      for (let k: u32 = 0; k < eqLen; k++) {
        let eqIdx = load<u32>(cursor);
        cursor += 4;
        store<u32>(sortedEqsPtr + (((eqOffset + k) as usize) << 2), eqIdx);
      }
      eqOffset += eqLen;

      // Copy variables
      for (let k: u32 = 0; k < varLen; k++) {
        let vIdx = load<u32>(cursor);
        cursor += 4;
        store<u32>(blockVarsPtr + (((varOffset + k) as usize) << 2), vIdx);
      }
      varOffset += varLen;

      // Set block flag: bit 0 = 1 if algebraic loop
      store<u32>(blockFlagsPtr + ((b as usize) << 2), eqLen > 1 ? 1 : 0);
    }
  }

  store<u32>(blockStartsPtr + ((numBlocks as usize) << 2), eqOffset);
  store<u32>(blockVarStartsPtr + ((numBlocks as usize) << 2), varOffset);

  pack.blockStartsPtr = blockStartsPtr as usize;
  pack.sortedEqsPtr = sortedEqsPtr as usize;
  pack.blockFlagsPtr = blockFlagsPtr as usize;
  pack.blockVarsPtr = blockVarsPtr as usize;
  pack.blockVarStartsPtr = blockVarStartsPtr as usize;

  // 4. Pack State & Derivative Indices
  pack.stateCount = numStateVars;
  if (numStateVars > 0 && stateVarsPtr != 0) {
    let stateIndicesBytes: u32 = numStateVars << 2;
    let sIndicesPtr = atomicChunkAlloc(stateIndicesBytes);
    let dIndicesPtr = atomicChunkAlloc(stateIndicesBytes);

    memory.copy(sIndicesPtr as usize, stateVarsPtr as usize, stateIndicesBytes as usize);

    if (derivVarsPtr != 0) {
      memory.copy(dIndicesPtr as usize, derivVarsPtr as usize, stateIndicesBytes as usize);
    } else {
      // Resolve derivative variable companion for each state variable
      for (let s: u32 = 0; s < numStateVars; s++) {
        let stateIdx = load<u32>((stateVarsPtr as usize) + ((s as usize) << 2));
        let derIdx: u32 = 0;

        // Check if an equation has der(stateIdx) on LHS
        let eqCount = dae.eqCount;
        let eqData = dae.getEqData();
        let exprData = dae.getExprData();
        for (let e: u32 = 0; e < eqCount; e++) {
          let lhsExpr = eqData.get(e * EQ_STRIDE + EQ_LHS);
          if (lhsExpr >= 0 && (lhsExpr as u32) < dae.exprCount) {
            let exprOffset = (lhsExpr as u32) * EXPR_STRIDE;
            if (exprData.get(exprOffset + EXPR_KIND) == ExprKind.Der) {
              let inner = exprData.get(exprOffset + EXPR_DATA1);
              if (inner == (stateIdx as i32)) {
                derIdx = e;
                break;
              }
            }
          }
        }
        store<u32>((dIndicesPtr as usize) + ((s as usize) << 2), derIdx);
      }
    }

    pack.stateVarIndicesPtr = sIndicesPtr as usize;
    pack.derivVarIndicesPtr = dIndicesPtr as usize;
  } else {
    pack.stateVarIndicesPtr = 0;
    pack.derivVarIndicesPtr = 0;
  }

  return packPtr as u32;
}

// ── Bridge Field Accessors ──

export function gpu_getStateBufferPtr(packPtr: u32): u32 {
  return changetype<GpuBufferPack>(packPtr).stateBufferPtr as u32;
}

export function gpu_getStateBufferSize(packPtr: u32): u32 {
  return changetype<GpuBufferPack>(packPtr).stateBufferSize;
}

export function gpu_getNameToVarIdxPtr(packPtr: u32): u32 {
  return changetype<GpuBufferPack>(packPtr).nameToVarIdxPtr as u32;
}

export function gpu_getNameToVarIdxCap(packPtr: u32): u32 {
  return changetype<GpuBufferPack>(packPtr).nameToVarIdxCap;
}

export function gpu_getBlockStartsPtr(packPtr: u32): u32 {
  return changetype<GpuBufferPack>(packPtr).blockStartsPtr as u32;
}

export function gpu_getSortedEqsPtr(packPtr: u32): u32 {
  return changetype<GpuBufferPack>(packPtr).sortedEqsPtr as u32;
}

export function gpu_getBlockFlagsPtr(packPtr: u32): u32 {
  return changetype<GpuBufferPack>(packPtr).blockFlagsPtr as u32;
}

export function gpu_getBlockVarsPtr(packPtr: u32): u32 {
  return changetype<GpuBufferPack>(packPtr).blockVarsPtr as u32;
}

export function gpu_getBlockVarStartsPtr(packPtr: u32): u32 {
  return changetype<GpuBufferPack>(packPtr).blockVarStartsPtr as u32;
}

export function gpu_getBlockCount(packPtr: u32): u32 {
  return changetype<GpuBufferPack>(packPtr).blockCount;
}

export function gpu_getScalarBlockCount(packPtr: u32): u32 {
  return changetype<GpuBufferPack>(packPtr).scalarBlockCount;
}

export function gpu_getLoopBlockCount(packPtr: u32): u32 {
  return changetype<GpuBufferPack>(packPtr).loopBlockCount;
}

export function gpu_getMaxBlockSize(packPtr: u32): u32 {
  return changetype<GpuBufferPack>(packPtr).maxBlockSize;
}

export function gpu_getTotalEqs(packPtr: u32): u32 {
  return changetype<GpuBufferPack>(packPtr).totalEqs;
}

export function gpu_getTotalVars(packPtr: u32): u32 {
  return changetype<GpuBufferPack>(packPtr).totalVars;
}

export function gpu_getStateVarIndicesPtr(packPtr: u32): u32 {
  return changetype<GpuBufferPack>(packPtr).stateVarIndicesPtr as u32;
}

export function gpu_getDerivVarIndicesPtr(packPtr: u32): u32 {
  return changetype<GpuBufferPack>(packPtr).derivVarIndicesPtr as u32;
}

export function gpu_getStateCount(packPtr: u32): u32 {
  return changetype<GpuBufferPack>(packPtr).stateCount;
}

/**
 * Initializes stateBuffer with parameter/constant start values in-WASM.
 */
export function gpu_initializeStateBuffer(daePtr: u32, stateBufferPtr: u32): void {
  let dae = changetype<DaeBuilder>(daePtr);
  let varCount = dae.varCount;
  let varData = dae.getVarData();

  for (let i: u32 = 0; i < varCount; i++) {
    if (dae.isVarRemoved(i)) continue;
    let variability = varData.get(i * VAR_STRIDE + VAR_VARIABILITY);
    if (variability == Variability.Parameter || variability == Variability.Constant) {
      let val = dae.getVarStartValue(i);
      let high: f32 = f32(val);
      let low: f32 = f32(val - f64(high));
      let byteOffset = (i << 3) as usize;
      store<f32>((stateBufferPtr as usize) + byteOffset, high);
      store<f32>((stateBufferPtr as usize) + byteOffset + 4, low);
    }
  }
}

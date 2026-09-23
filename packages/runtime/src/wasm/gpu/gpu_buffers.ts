// SPDX-License-Identifier: AGPL-3.0-or-later
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
} from "../dae/builder";
import { atomicChunkAlloc } from "../arena";
import { UnmanagedFloat32Array, UnmanagedUint32Array, UnmanagedInt32Array } from "../core/array";

/**
 * Packed WebGPU Arena Buffers.
 * Holds linear-memory pointers and metadata for GPU-mappable data.
 */
@unmanaged
export class GpuBufferPack {
  daePtr: usize;

  // State Buffer: Float32Array (high/low vec2<f32> double-single per variable)
  stateBuffer: UnmanagedFloat32Array;
  stateBufferSize: u32; // in f32 elements (varCount * 2)

  // Name to VarIdx lookup table: Int32Array indexed by StringId
  nameToVarIdx: UnmanagedInt32Array;
  nameToVarIdxCap: u32;

  // Packed CSR Block Plan
  blockStarts: UnmanagedUint32Array;       // Uint32Array (blockCount + 1)
  sortedEqs: UnmanagedUint32Array;         // Uint32Array (totalEqs)
  blockFlags: UnmanagedUint32Array;        // Uint32Array (blockCount)
  blockVars: UnmanagedUint32Array;         // Uint32Array (totalVars)
  blockVarStarts: UnmanagedUint32Array;    // Uint32Array (blockCount + 1)

  blockCount: u32;
  scalarBlockCount: u32;
  loopBlockCount: u32;
  maxBlockSize: u32;
  totalEqs: u32;
  totalVars: u32;

  // State & Derivative Indices
  stateVarIndices: UnmanagedUint32Array;   // Uint32Array (stateCount)
  derivVarIndices: UnmanagedUint32Array;   // Uint32Array (stateCount)
  stateCount: u32;

  @inline get stateBufferPtr(): usize { return changetype<usize>(this.stateBuffer); }
  @inline get nameToVarIdxPtr(): usize { return changetype<usize>(this.nameToVarIdx); }
  @inline get blockStartsPtr(): usize { return changetype<usize>(this.blockStarts); }
  @inline get sortedEqsPtr(): usize { return changetype<usize>(this.sortedEqs); }
  @inline get blockFlagsPtr(): usize { return changetype<usize>(this.blockFlags); }
  @inline get blockVarsPtr(): usize { return changetype<usize>(this.blockVars); }
  @inline get blockVarStartsPtr(): usize { return changetype<usize>(this.blockVarStarts); }
  @inline get stateVarIndicesPtr(): usize { return changetype<usize>(this.stateVarIndices); }
  @inline get derivVarIndicesPtr(): usize { return changetype<usize>(this.derivVarIndices); }
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
  let stateBuf = changetype<UnmanagedFloat32Array>(atomicChunkAlloc(stateBytes));
  for (let i: u32 = 0; i < varCount; i++) {
    let val: f64 = dae.getVarStartValue(i);
    let high: f32 = f32(val);
    let low: f32 = f32(val - f64(high));
    let baseIdx: u32 = i << 1;
    stateBuf[baseIdx] = high;
    stateBuf[baseIdx + 1] = low;
  }
  pack.stateBuffer = stateBuf;
  pack.stateBufferSize = stateSize;

  // 2. Pack nameToVarIdx table
  let poolSize: u32 = dae.stringPool != null ? dae.stringPool.stringCount : 0;
  let nameCap: u32 = poolSize + 256;
  if (nameCap < 4096) nameCap = 4096;
  let nameBytes: u32 = nameCap << 2;
  let nameTablePtr = atomicChunkAlloc(nameBytes);
  memory.fill(nameTablePtr, 0xff, nameBytes as usize); // fill with -1
  let nameTable = changetype<UnmanagedInt32Array>(nameTablePtr);

  for (let i: u32 = 0; i < varCount; i++) {
    if (!dae.isVarRemoved(i)) {
      let nameId = dae.getVarNameId(i);
      if (nameId < nameCap) {
        nameTable[nameId] = i as i32;
      }
    }
  }
  pack.nameToVarIdx = nameTable;
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

  let blockStarts = changetype<UnmanagedUint32Array>(atomicChunkAlloc((numBlocks + 1) << 2));
  let sortedEqs = changetype<UnmanagedUint32Array>(atomicChunkAlloc(totalEqs << 2));
  let blockFlags = changetype<UnmanagedUint32Array>(atomicChunkAlloc(numBlocks << 2));
  let blockVars = changetype<UnmanagedUint32Array>(atomicChunkAlloc(totalVars << 2));
  let blockVarStarts = changetype<UnmanagedUint32Array>(atomicChunkAlloc((numBlocks + 1) << 2));

  let eqOffset: u32 = 0;
  let varOffset: u32 = 0;

  if (numBlocks > 0 && rawBlocksPtr != 0) {
    let cursor: usize = rawBlocksPtr as usize;
    for (let b: u32 = 0; b < numBlocks; b++) {
      let eqLen = load<u32>(cursor);
      cursor += 4;
      let varLen = load<u32>(cursor);
      cursor += 4;

      blockStarts[b] = eqOffset;
      blockVarStarts[b] = varOffset;

      // Copy equations
      for (let k: u32 = 0; k < eqLen; k++) {
        let eqIdx = load<u32>(cursor);
        cursor += 4;
        sortedEqs[eqOffset + k] = eqIdx;
      }
      eqOffset += eqLen;

      // Copy variables
      for (let k: u32 = 0; k < varLen; k++) {
        let vIdx = load<u32>(cursor);
        cursor += 4;
        blockVars[varOffset + k] = vIdx;
      }
      varOffset += varLen;

      // Set block flag: bit 0 = 1 if algebraic loop
      blockFlags[b] = eqLen > 1 ? 1 : 0;
    }
  }

  blockStarts[numBlocks] = eqOffset;
  blockVarStarts[numBlocks] = varOffset;

  pack.blockStarts = blockStarts;
  pack.sortedEqs = sortedEqs;
  pack.blockFlags = blockFlags;
  pack.blockVars = blockVars;
  pack.blockVarStarts = blockVarStarts;

  // 4. Pack State & Derivative Indices
  pack.stateCount = numStateVars;
  if (numStateVars > 0 && stateVarsPtr != 0) {
    let stateIndicesBytes: u32 = numStateVars << 2;
    let sIndices = changetype<UnmanagedUint32Array>(atomicChunkAlloc(stateIndicesBytes));
    let dIndices = changetype<UnmanagedUint32Array>(atomicChunkAlloc(stateIndicesBytes));

    memory.copy(changetype<usize>(sIndices), stateVarsPtr as usize, stateIndicesBytes as usize);

    if (derivVarsPtr != 0) {
      memory.copy(changetype<usize>(dIndices), derivVarsPtr as usize, stateIndicesBytes as usize);
    } else {
      // Resolve derivative variable companion for each state variable
      let stateVars = changetype<UnmanagedUint32Array>(stateVarsPtr);
      for (let s: u32 = 0; s < numStateVars; s++) {
        let stateIdx = stateVars[s];
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
        dIndices[s] = derIdx;
      }
    }

    pack.stateVarIndices = sIndices;
    pack.derivVarIndices = dIndices;
  } else {
    pack.stateVarIndices = changetype<UnmanagedUint32Array>(0);
    pack.derivVarIndices = changetype<UnmanagedUint32Array>(0);
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
  let stateBuf = changetype<UnmanagedFloat32Array>(stateBufferPtr);

  for (let i: u32 = 0; i < varCount; i++) {
    if (dae.isVarRemoved(i)) continue;
    let variability = varData.get(i * VAR_STRIDE + VAR_VARIABILITY);
    if (variability == Variability.Parameter || variability == Variability.Constant) {
      let val = dae.getVarStartValue(i);
      let high: f32 = f32(val);
      let low: f32 = f32(val - f64(high));
      let baseIdx = i << 1;
      stateBuf[baseIdx] = high;
      stateBuf[baseIdx + 1] = low;
    }
  }
}

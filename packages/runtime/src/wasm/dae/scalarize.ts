// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  DaeBuilder,
  VarType,
  Variability,
  Causality,
  EqKind,
  ExprKind,
  BinOp,
  UnaryOp,
  VAR_STRIDE,
  VAR_NAME,
  VAR_TYPE,
  VAR_VARIABILITY,
  VAR_CAUSALITY,
  VAR_FLAGS,
  VAR_SHAPE_DIM,
  VAR_ATTR_STRIDE,
  EQ_STRIDE,
  EQ_KIND,
  EQ_LHS,
  EQ_RHS,
  EQ_AUX,
  EXPR_STRIDE,
  EXPR_KIND,
  EXPR_DATA1,
  EXPR_LEFT,
  EXPR_RIGHT,
} from "./builder";
import {
  ChunkedInt32Array,
  createChunkedInt32Array,
  UnmanagedFloat64Array,
  UnmanagedUint32Array,
  atomicChunkAlloc,
  atomicChunkFree,
} from "../core/array";

/**
 * Computes the total number of scalar elements for a given shape.
 */
@inline
export function getShapeElementCount(dae: DaeBuilder, varId: u32): u32 {
  let dimCount = dae.getVarData().get(varId * VAR_STRIDE + VAR_SHAPE_DIM) as u32;
  if (dimCount == 0) return 1;

  let total: u32 = 1;
  for (let d: u32 = 0; d < dimCount; d++) {
    let extent = dae.getVarShapeDim(varId, d);
    if (extent > 0) {
      total *= (extent as u32);
    }
  }
  return total;
}

/**
 * Computes the linearized flat 0-based offset for a multi-index tuple.
 * Example for shape [2, 3] and 1-based index (i, j): offset = (i-1)*3 + (j-1).
 */
@inline
export function computeFlatIndexOffset(
  dae: DaeBuilder,
  varId: u32,
  indicesPtr: u32,
  numIndices: u32
): u32 {
  let dimCount = dae.getVarData().get(varId * VAR_STRIDE + VAR_SHAPE_DIM) as u32;
  if (dimCount == 0 || numIndices == 0) return 0;

  let flatIdx: u32 = 0;
  let stride: u32 = 1;
  let indices = changetype<UnmanagedUint32Array>(indicesPtr);

  for (let d: i32 = (dimCount as i32) - 1; d >= 0; d--) {
    let extent = dae.getVarShapeDim(varId, d as u32) as u32;
    let idxVal: u32 = 1;
    if ((d as u32) < numIndices) {
      idxVal = indices[d as u32];
    }
    if (idxVal > 0) idxVal -= 1; // Convert 1-based to 0-based

    flatIdx += idxVal * stride;
    stride *= extent > 0 ? extent : 1;
  }

  return flatIdx;
}

/**
 * Helper to compute the element count of an expression for array equation unrolling.
 */
function getExprElementCount(srcDae: DaeBuilder, exprId: u32, varElemCounts: ChunkedInt32Array): u32 {
  if (exprId >= srcDae.exprCount) return 1;
  let offset = exprId * EXPR_STRIDE;
  let kind = srcDae.getExprData().get(offset + EXPR_KIND);
  if (kind == ExprKind.Name) {
    let varId = srcDae.getExprData().get(offset + EXPR_DATA1) as u32;
    if (varId < srcDae.varCount) {
      return varElemCounts.get(varId) as u32;
    }
  } else if (kind == ExprKind.Der) {
    let inner = srcDae.getExprData().get(offset + EXPR_DATA1) as u32;
    if (inner == 0xffffffff) inner = srcDae.getExprData().get(offset + EXPR_LEFT) as u32;
    return getExprElementCount(srcDae, inner, varElemCounts);
  } else if (kind == ExprKind.ArrayCtor || kind == ExprKind.Tuple) {
    let right = srcDae.getExprData().get(offset + EXPR_RIGHT) as u32;
    let data1 = srcDae.getExprData().get(offset + EXPR_DATA1) as u32;
    if (right > 0 && right != 0xffffffff) return right;
    if (data1 > 0 && data1 != 0xffffffff) return data1;
  }
  return 1;
}

/**
 * Deferred Batch Scalarization Engine
 * Takes an input DaeBuilder containing array-valued variables and vector equations,
 * and produces a new scalarized DaeBuilder where all tensors are unrolled into flat scalar variables.
 */
export function scalarizeDae(srcDae: DaeBuilder): DaeBuilder {
  let outPtr = atomicChunkAlloc(max<u32>(offsetof<DaeBuilder>() as u32, 512));
  let outDae = changetype<DaeBuilder>(outPtr);
  outDae.init();

  // Share srcDae's stringPool to preserve existing string IDs and intern new indexed names
  let tempSp = outDae.stringPool;
  if (changetype<usize>(tempSp) != 0) {
    if (changetype<usize>(tempSp.charBuffer) != 0) {
      tempSp.charBuffer.dispose();
      atomicChunkFree(changetype<usize>(tempSp.charBuffer));
    }
    if (changetype<usize>(tempSp.stringOffsets) != 0) {
      tempSp.stringOffsets.dispose();
      atomicChunkFree(changetype<usize>(tempSp.stringOffsets));
    }
    if (changetype<usize>(tempSp.stringLengths) != 0) {
      tempSp.stringLengths.dispose();
      atomicChunkFree(changetype<usize>(tempSp.stringLengths));
    }
    if (tempSp.stringMapPtr != 0) {
      atomicChunkFree(tempSp.stringMapPtr);
    }
    if (tempSp.pathMapPtr != 0) {
      atomicChunkFree(tempSp.pathMapPtr);
    }
    atomicChunkFree(changetype<usize>(tempSp));
  }
  outDae.stringPool = srcDae.stringPool;

  let srcVarCount = srcDae.varCount;
  let varBaseMapping = createChunkedInt32Array(srcVarCount);
  let varElemCounts = createChunkedInt32Array(srcVarCount);

  // 1. Expand Array Variables into Scalar Variables
  let indices = new StaticArray<u32>(4);
  for (let v: u32 = 0; v < srcVarCount; v++) {
    let vOffset = v * VAR_STRIDE;
    let nameId = srcDae.getVarData().get(vOffset + VAR_NAME) as u32;
    let varType = srcDae.getVarData().get(vOffset + VAR_TYPE);
    let variability = srcDae.getVarData().get(vOffset + VAR_VARIABILITY);
    let causality = srcDae.getVarData().get(vOffset + VAR_CAUSALITY);
    let flags = srcDae.getVarData().get(vOffset + VAR_FLAGS);
    let startVal = srcDae.getVarStartValue(v);

    let dimCount = srcDae.getVarData().get(vOffset + VAR_SHAPE_DIM) as u32;
    let elemCount = getShapeElementCount(srcDae, v);

    varElemCounts.push(elemCount as i32);
    let firstOutVarId = outDae.varCount;
    varBaseMapping.push(firstOutVarId as i32);

    if (dimCount > 0) {
      for (let e: u32 = 0; e < elemCount; e++) {
        let tempIdx = e;
        for (let d: i32 = (dimCount as i32) - 1; d >= 0; d--) {
          let extent = srcDae.getVarShapeDim(v, d as u32) as u32;
          if (extent == 0) extent = 1;
          indices[d] = (tempIdx % extent) + 1;
          tempIdx /= extent;
        }
        let subNameId = outDae.stringPool.internIndexedName(nameId, indices, dimCount);
        let outVar = outDae.addVariable(subNameId, varType, variability, causality, startVal, flags);

        // Copy/slice attributes for element e
        for (let a: u32 = 0; a < VAR_ATTR_STRIDE; a++) {
          let attrExpr = srcDae.getVarAttrExpr(v, a);
          if (attrExpr != 0xffffffff) {
            let clonedAttr = cloneExprScalarized(srcDae, outDae, attrExpr, varBaseMapping, varElemCounts, e, true);
            outDae.setVarAttrExpr(outVar, a, clonedAttr);
          }
        }
      }
    } else {
      let outVar = outDae.addVariable(nameId, varType, variability, causality, startVal, flags);
      for (let a: u32 = 0; a < VAR_ATTR_STRIDE; a++) {
        let attrExpr = srcDae.getVarAttrExpr(v, a);
        if (attrExpr != 0xffffffff) {
          let clonedAttr = cloneExprScalarized(srcDae, outDae, attrExpr, varBaseMapping, varElemCounts, 0, false);
          outDae.setVarAttrExpr(outVar, a, clonedAttr);
        }
      }
    }
  }

  // 2. Expand Equations
  let srcEqCount = srcDae.eqCount;
  for (let eq: u32 = 0; eq < srcEqCount; eq++) {
    let eqOffset = eq * EQ_STRIDE;
    let kind = srcDae.getEqData().get(eqOffset + EQ_KIND);
    if (kind != EqKind.Simple && kind != EqKind.Array && kind != EqKind.InitialSimple) continue;

    let lhsId = srcDae.getEqData().get(eqOffset + EQ_LHS) as u32;
    let rhsId = srcDae.getEqData().get(eqOffset + EQ_RHS) as u32;
    let auxId = srcDae.getEqData().get(eqOffset + EQ_AUX) as u32;

    let outKind = kind == EqKind.InitialSimple ? EqKind.InitialSimple : EqKind.Simple;

    // Detect if this equation operates on an array
    let maxElems: u32 = 1;
    if (kind == EqKind.Array && auxId > 1 && auxId != 0xffffffff) {
      maxElems = auxId;
    } else {
      let lCount = getExprElementCount(srcDae, lhsId, varElemCounts);
      let rCount = getExprElementCount(srcDae, rhsId, varElemCounts);
      if (lCount > maxElems) maxElems = lCount;
      if (rCount > maxElems) maxElems = rCount;
    }

    let isVec = maxElems > 1;
    for (let elem: u32 = 0; elem < maxElems; elem++) {
      let outLhs = cloneExprScalarized(srcDae, outDae, lhsId, varBaseMapping, varElemCounts, elem, isVec);
      let outRhs = cloneExprScalarized(srcDae, outDae, rhsId, varBaseMapping, varElemCounts, elem, isVec);

      // Coerce IntLiteral to RealLiteral if LHS is Real
      if (outLhs < outDae.exprCount && outRhs < outDae.exprCount) {
        let lhsKind = outDae.getExprData().get(outLhs * EXPR_STRIDE + EXPR_KIND);
        let rhsKind = outDae.getExprData().get(outRhs * EXPR_STRIDE + EXPR_KIND);
        if (lhsKind == ExprKind.Name && rhsKind == ExprKind.IntLiteral) {
          let varId = outDae.getExprData().get(outLhs * EXPR_STRIDE + EXPR_DATA1) as u32;
          if (varId < outDae.varCount && outDae.getVarData().get(varId * VAR_STRIDE + VAR_TYPE) == VarType.Real) {
            let intVal = outDae.getExprData().get(outRhs * EXPR_STRIDE + EXPR_DATA1) as i32;
            outRhs = outDae.addRealLiteral(intVal as f64);
          }
        }
      }

      outDae.addEquation(outKind, outLhs, outRhs, auxId);
    }
  }

  return outDae;
}

/**
 * Clones an expression AST into the target scalarized DAE, binding array elements to their scalar variable ID.
 */
function cloneExprScalarized(
  srcDae: DaeBuilder,
  outDae: DaeBuilder,
  exprId: u32,
  varBaseMapping: ChunkedInt32Array,
  varElemCounts: ChunkedInt32Array,
  currentElemIndex: u32,
  isVectorExpansion: bool
): u32 {
  if (exprId >= srcDae.exprCount) return 0xffffffff;

  let offset = exprId * EXPR_STRIDE;
  let kind = srcDae.getExprData().get(offset + EXPR_KIND);
  let data1 = srcDae.getExprData().get(offset + EXPR_DATA1) as u32;
  let left = srcDae.getExprData().get(offset + EXPR_LEFT) as u32;
  let right = srcDae.getExprData().get(offset + EXPR_RIGHT) as u32;

  if (kind == ExprKind.Name) {
    let srcVarId = data1;
    if (srcVarId < srcDae.varCount) {
      let baseId = varBaseMapping.get(srcVarId) as u32;
      let totalElems = varElemCounts.get(srcVarId) as u32;
      let elemOffset = (isVectorExpansion && currentElemIndex < totalElems) ? currentElemIndex : 0;
      return outDae.addName(baseId + elemOffset);
    }
    return outDae.addName(data1);
  }

  if (kind == ExprKind.RealLiteral) {
    let lo = (data1 as u64) & 0xffffffff;
    let hi = (left as u64) & 0xffffffff;
    let bits = (hi << 32) | lo;
    return outDae.addRealLiteral(f64.reinterpret_i64(bits as i64));
  }

  if (kind == ExprKind.IntLiteral) {
    return outDae.addIntLiteral(data1 as i32);
  }

  if (kind == ExprKind.BoolLiteral) {
    return outDae.addExpression(ExprKind.BoolLiteral, data1);
  }

  if (kind == ExprKind.StringLiteral) {
    return outDae.addExpression(ExprKind.StringLiteral, data1);
  }

  if (kind == ExprKind.EnumLiteral) {
    return outDae.addExpression(ExprKind.EnumLiteral, data1, left, right);
  }

  if (kind == ExprKind.Colon) {
    return outDae.addExpression(ExprKind.Colon, 0, 0, 0);
  }

  if (kind == ExprKind.Der) {
    let inner = data1 != 0xffffffff ? data1 : left;
    let clonedInner = cloneExprScalarized(srcDae, outDae, inner, varBaseMapping, varElemCounts, currentElemIndex, isVectorExpansion);
    if (clonedInner < outDae.exprCount && outDae.getExprData().get(clonedInner * EXPR_STRIDE + EXPR_KIND) == ExprKind.Name) {
      let targetVar = outDae.getExprData().get(clonedInner * EXPR_STRIDE + EXPR_DATA1) as u32;
      return outDae.addDer(targetVar);
    }
    return outDae.addExpression(ExprKind.Der, clonedInner);
  }

  if (kind == ExprKind.Pre) {
    let inner = data1 != 0 && data1 != 0xffffffff ? data1 : left;
    let clonedInner = cloneExprScalarized(srcDae, outDae, inner, varBaseMapping, varElemCounts, currentElemIndex, isVectorExpansion);
    return outDae.addExpression(ExprKind.Pre, clonedInner, 0xffffffff, 0xffffffff);
  }

  if (kind == ExprKind.Unary || kind == ExprKind.Negate) {
    let clonedLeft = cloneExprScalarized(srcDae, outDae, left, varBaseMapping, varElemCounts, currentElemIndex, isVectorExpansion);
    return outDae.addExpression(kind, data1, clonedLeft, right);
  }

  if (kind == ExprKind.Binary) {
    let clonedLeft = cloneExprScalarized(srcDae, outDae, left, varBaseMapping, varElemCounts, currentElemIndex, isVectorExpansion);
    let clonedRight = cloneExprScalarized(srcDae, outDae, right, varBaseMapping, varElemCounts, currentElemIndex, isVectorExpansion);
    return outDae.addBinaryExpr(data1 as u16, clonedLeft, clonedRight);
  }

  if (kind == ExprKind.IfElse) {
    let clonedCond = cloneExprScalarized(srcDae, outDae, data1, varBaseMapping, varElemCounts, currentElemIndex, isVectorExpansion);
    let clonedThen = cloneExprScalarized(srcDae, outDae, left, varBaseMapping, varElemCounts, currentElemIndex, isVectorExpansion);
    let clonedElse = cloneExprScalarized(srcDae, outDae, right, varBaseMapping, varElemCounts, currentElemIndex, isVectorExpansion);
    return outDae.addIfElse(clonedCond, clonedThen, clonedElse);
  }

  if (kind == ExprKind.ArrayCtor || kind == ExprKind.Tuple) {
    let count = right;
    if (count == 0 || count == 0xffffffff) count = data1;
    if (isVectorExpansion && currentElemIndex < count) {
      let elemExprId = srcDae.getCallArgExprId(exprId, currentElemIndex);
      if (elemExprId != 0xffffffff) {
        return cloneExprScalarized(srcDae, outDae, elemExprId, varBaseMapping, varElemCounts, 0, false);
      }
    }
    // Preserved container
    if (count == 0) {
      return outDae.addExpression(kind, data1, 0xffffffff, 0);
    }
    let clonedFirst = cloneExprScalarized(srcDae, outDae, left, varBaseMapping, varElemCounts, 0, false);
    let ctorId = outDae.addExpression(kind, count, clonedFirst, count);
    for (let a: u32 = 1; a < count; a++) {
      let argExprId = srcDae.getCallArgExprId(exprId, a);
      let clonedArg = cloneExprScalarized(srcDae, outDae, argExprId, varBaseMapping, varElemCounts, 0, false);
      outDae.addExpression(ExprKind.Tuple, 0, clonedArg, 0);
    }
    return ctorId;
  }

  if (kind == ExprKind.Subscript) {
    let baseExprId = data1;
    let firstSubId = left;
    if (baseExprId < srcDae.exprCount && srcDae.getExprData().get(baseExprId * EXPR_STRIDE + EXPR_KIND) == ExprKind.Name) {
      let srcVarId = srcDae.getExprData().get(baseExprId * EXPR_STRIDE + EXPR_DATA1) as u32;
      if (srcVarId < srcDae.varCount && firstSubId < srcDae.exprCount) {
        let dimCount = srcDae.getVarData().get(srcVarId * VAR_STRIDE + VAR_SHAPE_DIM) as u32;
        let subCount = right > 0 && right != 0xffffffff ? right : 1;
        let allInts = true;
        let subIndices = new StaticArray<u32>(4);
        for (let s: u32 = 0; s < subCount && s < 4; s++) {
          let sExpr = s == 0 ? firstSubId : srcDae.getCallArgExprId(exprId, s);
          if (sExpr < srcDae.exprCount && srcDae.getExprData().get(sExpr * EXPR_STRIDE + EXPR_KIND) == ExprKind.IntLiteral) {
            let v = srcDae.getExprData().get(sExpr * EXPR_STRIDE + EXPR_DATA1);
            subIndices[s] = v > 0 ? (v - 1) as u32 : 0;
          } else {
            allInts = false;
            break;
          }
        }
        if (allInts) {
          let flatIdx: u32 = 0;
          let stride: u32 = 1;
          let dims = dimCount > 0 ? dimCount : subCount;
          for (let d: i32 = (dims as i32) - 1; d >= 0; d--) {
            let extent = srcDae.getVarShapeDim(srcVarId, d as u32) as u32;
            if (extent == 0) extent = 1;
            let idxVal = (d as u32) < subCount ? subIndices[d as u32] : 0;
            flatIdx += idxVal * stride;
            stride *= extent;
          }
          let baseId = varBaseMapping.get(srcVarId) as u32;
          let totalElems = varElemCounts.get(srcVarId) as u32;
          let elemOffset = flatIdx < totalElems ? flatIdx : 0;
          return outDae.addName(baseId + elemOffset);
        }
      }
    }
    return cloneExprScalarized(srcDae, outDae, baseExprId, varBaseMapping, varElemCounts, currentElemIndex, isVectorExpansion);
  }

  if (kind == ExprKind.Range) {
    let clonedStart = cloneExprScalarized(srcDae, outDae, data1, varBaseMapping, varElemCounts, 0, false);
    let clonedStep = left != 0xffffffff ? cloneExprScalarized(srcDae, outDae, left, varBaseMapping, varElemCounts, 0, false) : 0xffffffff;
    let clonedStop = cloneExprScalarized(srcDae, outDae, right, varBaseMapping, varElemCounts, 0, false);
    return outDae.addExpression(ExprKind.Range, clonedStart, clonedStep, clonedStop);
  }

  if (kind == ExprKind.Call) {
    let argCount = right;
    let firstArg = left;
    if (argCount == 0) {
      return outDae.addCall(data1 as i32, 0xffffffff, 0);
    }
    let clonedArgs = new Array<u32>(argCount as i32);
    clonedArgs[0] = cloneExprScalarized(srcDae, outDae, firstArg, varBaseMapping, varElemCounts, currentElemIndex, false);
    for (let a: u32 = 1; a < argCount; a++) {
      let argExprId = srcDae.getCallArgExprId(exprId, a);
      clonedArgs[a as i32] = cloneExprScalarized(srcDae, outDae, argExprId, varBaseMapping, varElemCounts, currentElemIndex, false);
    }
    let callId = outDae.addCall(data1 as i32, clonedArgs[0], argCount);
    for (let a: u32 = 1; a < argCount; a++) {
      outDae.addExpression(ExprKind.Tuple, 0, clonedArgs[a as i32], 0);
    }
    return callId;
  }

  return outDae.addExpression(kind, data1, left, right);
}

/**
 * Uniform Array Parameterized Equation Block Descriptor.
 * Represents a parameterized uniform equation stencil across indices [startIdx, endIdx].
 */
@unmanaged
export class UniformArrayBlock {
  stateBaseVarId: u32;
  derBaseVarId: u32;
  startIdx: u32;
  endIdx: u32;
  stencilWidth: u32; // e.g. 3 for [i-1, i, i+1]
  coeffCenter: f64;
  coeffLeft: f64;
  coeffRight: f64;

  init(
    stateBaseVarId: u32,
    derBaseVarId: u32,
    startIdx: u32,
    endIdx: u32,
    coeffCenter: f64,
    coeffLeft: f64,
    coeffRight: f64
  ): void {
    this.stateBaseVarId = stateBaseVarId;
    this.derBaseVarId = derBaseVarId;
    this.startIdx = startIdx;
    this.endIdx = endIdx;
    this.stencilWidth = 3;
    this.coeffCenter = coeffCenter;
    this.coeffLeft = coeffLeft;
    this.coeffRight = coeffRight;
  }

  evalStencil(varValuesPtr: u32, derValuesPtr: u32): void {
    let sBase = this.stateBaseVarId;
    let dBase = this.derBaseVarId;
    let cC = this.coeffCenter;
    let cL = this.coeffLeft;
    let cR = this.coeffRight;
    let varValues = changetype<UnmanagedFloat64Array>(varValuesPtr);
    let derValues = changetype<UnmanagedFloat64Array>(derValuesPtr);

    for (let i: u32 = this.startIdx; i <= this.endIdx; i++) {
      let xCenter = varValues[sBase + i];
      let xLeft = varValues[sBase + i - 1];
      let xRight = varValues[sBase + i + 1];
      let der = cC * xCenter + cL * xLeft + cR * xRight;
      derValues[dBase + i] = der;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// C/WASM Export Wrappers
// ─────────────────────────────────────────────────────────────────────────────

export function dae_scalarize(daePtr: u32): u32 {
  if (daePtr == 0) return 0;
  let srcDae = changetype<DaeBuilder>(daePtr);
  let resDae = scalarizeDae(srcDae);
  return changetype<u32>(resDae);
}

export function dae_createUniformArrayBlock(
  stateBaseVarId: u32,
  derBaseVarId: u32,
  startIdx: u32,
  endIdx: u32,
  coeffCenter: f64,
  coeffLeft: f64,
  coeffRight: f64
): u32 {
  let ptr = atomicChunkAlloc(64);
  let block = changetype<UniformArrayBlock>(ptr);
  block.init(stateBaseVarId, derBaseVarId, startIdx, endIdx, coeffCenter, coeffLeft, coeffRight);
  return ptr as u32;
}

export function dae_evalUniformArrayBlock(blockPtr: u32, varValuesPtr: u32, derValuesPtr: u32): void {
  if (blockPtr == 0) return;
  changetype<UniformArrayBlock>(blockPtr).evalStencil(varValuesPtr, derValuesPtr);
}


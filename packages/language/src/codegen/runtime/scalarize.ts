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
} from "./dae";
import {
  ChunkedInt32Array,
  createChunkedInt32Array,
} from "./array";
import { atomicChunkAlloc } from "./arena";

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

  for (let d: i32 = (dimCount as i32) - 1; d >= 0; d--) {
    let extent = dae.getVarShapeDim(varId, d as u32) as u32;
    let idxVal: u32 = 1;
    if ((d as u32) < numIndices) {
      idxVal = load<u32>(indicesPtr + (d as u32) * 4);
    }
    if (idxVal > 0) idxVal -= 1; // Convert 1-based to 0-based

    flatIdx += idxVal * stride;
    stride *= extent > 0 ? extent : 1;
  }

  return flatIdx;
}

/**
 * Deferred Batch Scalarization Engine
 * Takes an input DaeBuilder containing array-valued variables and vector equations,
 * and produces a new scalarized DaeBuilder where all tensors are unrolled into flat scalar variables.
 */
export function scalarizeDae(srcDae: DaeBuilder): DaeBuilder {
  let outPtr = atomicChunkAlloc(sizeof<DaeBuilder>());
  let outDae = changetype<DaeBuilder>(outPtr);
  outDae.init();

  let srcVarCount = srcDae.varCount;
  let varBaseMapping = createChunkedInt32Array(srcVarCount);
  let varElemCounts = createChunkedInt32Array(srcVarCount);

  // 1. Expand Array Variables into Scalar Variables
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

    if (dimCount > 0 && elemCount > 1) {
      for (let e: u32 = 0; e < elemCount; e++) {
        let subNameId = nameId ^ (e * 0x9e3779b9 + 1); // Disambiguate multi-index hash
        outDae.addVariable(subNameId, varType, variability, causality, startVal, flags);
      }
    } else {
      outDae.addVariable(nameId, varType, variability, causality, startVal, flags);
    }
  }

  // 2. Expand Equations
  let srcEqCount = srcDae.eqCount;
  for (let eq: u32 = 0; eq < srcEqCount; eq++) {
    let eqOffset = eq * EQ_STRIDE;
    let kind = srcDae.getEqData().get(eqOffset + EQ_KIND);
    if (kind != EqKind.Simple && kind != EqKind.Array) continue;

    let lhsId = srcDae.getEqData().get(eqOffset + EQ_LHS) as u32;
    let rhsId = srcDae.getEqData().get(eqOffset + EQ_RHS) as u32;
    let auxId = srcDae.getEqData().get(eqOffset + EQ_AUX) as u32;

    // Detect if this equation operates on an array
    let maxElems: u32 = 1;
    if (lhsId < srcDae.exprCount) {
      let lKind = srcDae.getExprData().get(lhsId * EXPR_STRIDE + EXPR_KIND);
      if (lKind == ExprKind.Name) {
        let srcVarId = srcDae.getExprData().get(lhsId * EXPR_STRIDE + EXPR_DATA1) as u32;
        if (srcVarId < srcVarCount) {
          maxElems = varElemCounts.get(srcVarId) as u32;
        }
      }
    }

    for (let elem: u32 = 0; elem < maxElems; elem++) {
      let outLhs = cloneExprScalarized(srcDae, outDae, lhsId, varBaseMapping, varElemCounts, elem);
      let outRhs = cloneExprScalarized(srcDae, outDae, rhsId, varBaseMapping, varElemCounts, elem);
      outDae.addEquation(EqKind.Simple, outLhs, outRhs, auxId);
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
  currentElemIndex: u32
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
      let elemOffset = currentElemIndex < totalElems ? currentElemIndex : 0;
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

  if (kind == ExprKind.Der) {
    let inner = data1;
    let clonedInner = cloneExprScalarized(srcDae, outDae, inner, varBaseMapping, varElemCounts, currentElemIndex);
    if (clonedInner < outDae.exprCount && outDae.getExprData().get(clonedInner * EXPR_STRIDE + EXPR_KIND) == ExprKind.Name) {
      let targetVar = outDae.getExprData().get(clonedInner * EXPR_STRIDE + EXPR_DATA1) as u32;
      return outDae.addDer(targetVar);
    }
    return outDae.addExpression(ExprKind.Der, clonedInner);
  }

  if (kind == ExprKind.Unary || kind == ExprKind.Negate || kind == ExprKind.Pre) {
    let clonedLeft = cloneExprScalarized(srcDae, outDae, left, varBaseMapping, varElemCounts, currentElemIndex);
    return outDae.addExpression(kind, data1, clonedLeft, right);
  }

  if (kind == ExprKind.Binary) {
    let clonedLeft = cloneExprScalarized(srcDae, outDae, left, varBaseMapping, varElemCounts, currentElemIndex);
    let clonedRight = cloneExprScalarized(srcDae, outDae, right, varBaseMapping, varElemCounts, currentElemIndex);
    return outDae.addBinaryExpr(data1 as u16, clonedLeft, clonedRight);
  }

  if (kind == ExprKind.IfElse) {
    let clonedCond = cloneExprScalarized(srcDae, outDae, data1, varBaseMapping, varElemCounts, currentElemIndex);
    let clonedThen = cloneExprScalarized(srcDae, outDae, left, varBaseMapping, varElemCounts, currentElemIndex);
    let clonedElse = cloneExprScalarized(srcDae, outDae, right, varBaseMapping, varElemCounts, currentElemIndex);
    return outDae.addIfElse(clonedCond, clonedThen, clonedElse);
  }

  if (kind == ExprKind.Call) {
    let argCount = right;
    let firstArg = left;
    let newFirstArg = outDae.exprCount;
    for (let a: u32 = 0; a < argCount; a++) {
      cloneExprScalarized(srcDae, outDae, firstArg + a, varBaseMapping, varElemCounts, currentElemIndex);
    }
    return outDae.addCall(data1 as i32, newFirstArg, argCount);
  }

  return outDae.addExpression(kind, data1, left, right);
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

import {
  DaeBuilder,
  EQ_STRIDE,
  EQ_LHS,
  EQ_RHS,
  EXPR_STRIDE,
  EXPR_KIND,
  EXPR_DATA1,
  EXPR_LEFT,
  EXPR_RIGHT,
  ExprKind,
  BinOp,
  UnaryOp,
} from "./dae";
import { ChunkedInt32Array, createChunkedInt32Array } from "./array";
import { atomicChunkAlloc } from "./arena";
import { evalEquationResidual, evalExpr } from "./eval";
import { BuiltinMathFunc } from "./fold";

/**
 * Compressed Column Storage (CCS) Sparse Matrix Header in WASM Memory
 */
@unmanaged
export class CCSMatrix {
  colPtr: ChunkedInt32Array;
  rowIndices: ChunkedInt32Array;
  valuesPtr: usize; // Pointer to f64[nnz]
  nRows: u32;
  nCols: u32;
  nnz: u32;

  init(nRows: u32, nCols: u32): void {
    this.nRows = nRows;
    this.nCols = nCols;
    this.nnz = 0;
    this.colPtr = createChunkedInt32Array(nCols + 1);
    this.rowIndices = createChunkedInt32Array(nCols * 4);
    this.valuesPtr = 0;
  }
}

/**
 * Distance-2 Graph Coloring Result Header in WASM Memory
 */
@unmanaged
export class ColoringResult {
  colors: ChunkedInt32Array; // Color assigned to each column (0..numColors-1)
  numColors: u32;
  colorOffsets: ChunkedInt32Array; // Stride index into colorCols for each color group
  colorCols: ChunkedInt32Array; // Grouped column indices

  init(nCols: u32): void {
    this.colors = createChunkedInt32Array(nCols);
    this.numColors = 0;
    this.colorOffsets = createChunkedInt32Array(nCols + 1);
    this.colorCols = createChunkedInt32Array(nCols);
  }
}

/**
 * Helper to check if an expression references a variable.
 */
function exprHasVar(dae: DaeBuilder, exprId: u32, targetVar: u32): boolean {
  if (exprId >= dae.exprCount) return false;
  let offset = exprId * EXPR_STRIDE;
  let kind = dae.getExprData().get(offset + EXPR_KIND);

  if (kind == ExprKind.Name) {
    return (dae.getExprData().get(offset + EXPR_DATA1) as u32) == targetVar;
  }
  if (kind == ExprKind.Der) {
    let inner = dae.getExprData().get(offset + EXPR_DATA1) as u32;
    if (inner < dae.exprCount && dae.getExprData().get(inner * EXPR_STRIDE + EXPR_KIND) == ExprKind.Name) {
      return (dae.getExprData().get(inner * EXPR_STRIDE + EXPR_DATA1) as u32) == targetVar;
    }
  }
  if (kind == ExprKind.Binary || kind == ExprKind.Range) {
    let left = dae.getExprData().get(offset + EXPR_LEFT) as u32;
    let right = dae.getExprData().get(offset + EXPR_RIGHT) as u32;
    return exprHasVar(dae, left, targetVar) || exprHasVar(dae, right, targetVar);
  }
  if (kind == ExprKind.Unary || kind == ExprKind.Negate || kind == ExprKind.Pre) {
    let left = dae.getExprData().get(offset + EXPR_LEFT) as u32;
    return exprHasVar(dae, left != 0xffffffff ? left : (dae.getExprData().get(offset + EXPR_DATA1) as u32), targetVar);
  }
  if (kind == ExprKind.IfElse) {
    let cond = dae.getExprData().get(offset + EXPR_DATA1) as u32;
    let thenB = dae.getExprData().get(offset + EXPR_LEFT) as u32;
    let elseB = dae.getExprData().get(offset + EXPR_RIGHT) as u32;
    return exprHasVar(dae, cond, targetVar) || exprHasVar(dae, thenB, targetVar) || exprHasVar(dae, elseB, targetVar);
  }
  if (kind == ExprKind.Call) {
    let count = dae.getExprData().get(offset + EXPR_RIGHT) as u32;
    let first = dae.getExprData().get(offset + EXPR_LEFT) as u32;
    for (let i: u32 = 0; i < count; i++) {
      if (exprHasVar(dae, first + i, targetVar)) return true;
    }
  }
  return false;
}

/**
 * Builds the structural sparsity pattern of a Jacobian in Compressed Column Storage (CCS).
 */
export function buildJacobianSparsity(
  dae: DaeBuilder,
  eqIndicesPtr: u32,
  nRows: u32,
  varIndicesPtr: u32,
  nCols: u32
): CCSMatrix {
  let ccsPtr = atomicChunkAlloc(sizeof<CCSMatrix>());
  let ccs = changetype<CCSMatrix>(ccsPtr);
  ccs.init(nRows, nCols);

  ccs.colPtr.push(0);

  for (let c: u32 = 0; c < nCols; c++) {
    let varIdx = load<u32>(varIndicesPtr + c * 4);

    for (let r: u32 = 0; r < nRows; r++) {
      let eqIdx = load<u32>(eqIndicesPtr + r * 4);
      let eqOffset = eqIdx * EQ_STRIDE;
      let lhs = dae.getEqData().get(eqOffset + EQ_LHS) as u32;
      let rhs = dae.getEqData().get(eqOffset + EQ_RHS) as u32;

      if (exprHasVar(dae, lhs, varIdx) || exprHasVar(dae, rhs, varIdx)) {
        ccs.rowIndices.push(r as i32);
        ccs.nnz++;
      }
    }

    ccs.colPtr.push(ccs.nnz as i32);
  }

  if (ccs.nnz > 0) {
    ccs.valuesPtr = atomicChunkAlloc(ccs.nnz * 8);
  }

  return ccs;
}

/**
 * Computes Curtis-Powell-Reid Distance-2 Column Graph Coloring.
 * Colors columns such that no two columns sharing a common row have the same color.
 */
export function colorJacobianColumns(ccs: CCSMatrix): ColoringResult {
  let nCols = ccs.nCols;
  let resPtr = atomicChunkAlloc(sizeof<ColoringResult>());
  let res = changetype<ColoringResult>(resPtr);
  res.init(nCols);

  if (nCols == 0) return res;

  // Track max colors needed
  let forbiddenColor = createChunkedInt32Array(nCols + 1);
  for (let i: u32 = 0; i <= nCols; i++) forbiddenColor.push(-1);

  let maxColor: u32 = 0;

  for (let j: u32 = 0; j < nCols; j++) {
    // Find all conflicting columns k that share at least one row with column j
    let jStart = ccs.colPtr.get(j) as u32;
    let jEnd = ccs.colPtr.get(j + 1) as u32;

    for (let p: u32 = jStart; p < jEnd; p++) {
      let row = ccs.rowIndices.get(p) as u32;

      // Scan all other columns that touch this row
      for (let otherCol: u32 = 0; otherCol < j; otherCol++) {
        let oStart = ccs.colPtr.get(otherCol) as u32;
        let oEnd = ccs.colPtr.get(otherCol + 1) as u32;

        for (let op: u32 = oStart; op < oEnd; op++) {
          if ((ccs.rowIndices.get(op) as u32) == row) {
            let assigned = res.colors.get(otherCol);
            if (assigned >= 0) {
              forbiddenColor.set(assigned as u32, j as i32);
            }
            break;
          }
        }
      }
    }

    // Pick lowest available color
    let chosenColor: u32 = 0;
    while ((forbiddenColor.get(chosenColor) as i32) == (j as i32)) {
      chosenColor++;
    }

    res.colors.push(chosenColor as i32);
    if (chosenColor + 1 > maxColor) maxColor = chosenColor + 1;
  }

  res.numColors = maxColor;

  // Group columns by color for fast directional dispatch
  let groupCounts = createChunkedInt32Array(maxColor);
  for (let c: u32 = 0; c < maxColor; c++) groupCounts.push(0);

  for (let j: u32 = 0; j < nCols; j++) {
    let colColor = res.colors.get(j) as u32;
    let cnt = groupCounts.get(colColor);
    groupCounts.set(colColor, cnt + 1);
  }

  res.colorOffsets.push(0);
  let totalOffset: u32 = 0;
  for (let c: u32 = 0; c < maxColor; c++) {
    totalOffset += groupCounts.get(c) as u32;
    res.colorOffsets.push(totalOffset as i32);
  }

  // Populate colorCols
  let currentPos = createChunkedInt32Array(maxColor);
  for (let c: u32 = 0; c < maxColor; c++) {
    currentPos.push(res.colorOffsets.get(c));
  }

  for (let j: u32 = 0; j < nCols; j++) {
    let colColor = res.colors.get(j) as u32;
    let pos = currentPos.get(colColor) as u32;
    res.colorCols.set(pos, j as i32);
    currentPos.set(colColor, (pos + 1) as i32);
  }

  return res;
}

/**
 * Evaluates the analytical directional derivative d(expr) / d(targetVar) at varValues.
 */
export function evalExprDerivative(
  exprId: u32,
  dae: DaeBuilder,
  targetVar: u32,
  varValuesPtr: u32
): f64 {
  if (exprId == 0xffffffff || exprId >= dae.exprCount) return 0.0;

  let offset = exprId * EXPR_STRIDE;
  let kind = dae.getExprData().get(offset + EXPR_KIND);

  if (kind == ExprKind.IntLiteral || kind == ExprKind.RealLiteral || kind == ExprKind.BoolLiteral || kind == ExprKind.StringLiteral) {
    return 0.0;
  }

  if (kind == ExprKind.Name) {
    let vId = dae.getExprData().get(offset + EXPR_DATA1) as u32;
    return vId == targetVar ? 1.0 : 0.0;
  }

  if (kind == ExprKind.Der) {
    let inner = dae.getExprData().get(offset + EXPR_DATA1) as u32;
    if (inner < dae.exprCount && dae.getExprData().get(inner * EXPR_STRIDE + EXPR_KIND) == ExprKind.Name) {
      let vId = dae.getExprData().get(inner * EXPR_STRIDE + EXPR_DATA1) as u32;
      return vId == targetVar ? 1.0 : 0.0;
    }
    return 0.0;
  }

  if (kind == ExprKind.Negate) {
    let left = dae.getExprData().get(offset + EXPR_LEFT) as u32;
    return -evalExprDerivative(left, dae, targetVar, varValuesPtr);
  }

  if (kind == ExprKind.Unary) {
    let op = dae.getExprData().get(offset + EXPR_DATA1);
    let left = dae.getExprData().get(offset + EXPR_LEFT) as u32;
    let dLeft = evalExprDerivative(left, dae, targetVar, varValuesPtr);
    if (op == UnaryOp.Negate) return -dLeft;
    if (op == UnaryOp.Not) return 0.0;
    return dLeft;
  }

  if (kind == ExprKind.Binary) {
    let op = dae.getExprData().get(offset + EXPR_DATA1);
    let left = dae.getExprData().get(offset + EXPR_LEFT) as u32;
    let right = dae.getExprData().get(offset + EXPR_RIGHT) as u32;

    let dLeft = evalExprDerivative(left, dae, targetVar, varValuesPtr);
    let dRight = evalExprDerivative(right, dae, targetVar, varValuesPtr);

    if (op == BinOp.Add) return dLeft + dRight;
    if (op == BinOp.Sub) return dLeft - dRight;
    if (op == BinOp.Mul) {
      let u = evalExpr(left, dae, varValuesPtr);
      let v = evalExpr(right, dae, varValuesPtr);
      return dLeft * v + u * dRight;
    }
    if (op == BinOp.Div) {
      let u = evalExpr(left, dae, varValuesPtr);
      let v = evalExpr(right, dae, varValuesPtr);
      if (v == 0.0) return 0.0;
      return (dLeft * v - u * dRight) / (v * v);
    }
    if (op == BinOp.Pow) {
      let u = evalExpr(left, dae, varValuesPtr);
      let v = evalExpr(right, dae, varValuesPtr);
      if (u <= 0.0) return 0.0;
      let uv = Math.pow(u, v);
      return uv * (dRight * Math.log(u) + v * dLeft / u);
    }
  }

  if (kind == ExprKind.IfElse) {
    let cond = dae.getExprData().get(offset + EXPR_DATA1) as u32;
    let left = dae.getExprData().get(offset + EXPR_LEFT) as u32;
    let right = dae.getExprData().get(offset + EXPR_RIGHT) as u32;
    let condVal = evalExpr(cond, dae, varValuesPtr);
    return condVal != 0.0
      ? evalExprDerivative(left, dae, targetVar, varValuesPtr)
      : evalExprDerivative(right, dae, targetVar, varValuesPtr);
  }

  if (kind == ExprKind.Call) {
    let funcId = dae.getExprData().get(offset + EXPR_DATA1);
    let firstArg = dae.getExprData().get(offset + EXPR_LEFT) as u32;
    let dArg0 = evalExprDerivative(firstArg, dae, targetVar, varValuesPtr);
    let arg0 = evalExpr(firstArg, dae, varValuesPtr);

    if (funcId == BuiltinMathFunc.Sin) return Math.cos(arg0) * dArg0;
    if (funcId == BuiltinMathFunc.Cos) return -Math.sin(arg0) * dArg0;
    if (funcId == BuiltinMathFunc.Tan) {
      let cosVal = Math.cos(arg0);
      return (1.0 / (cosVal * cosVal)) * dArg0;
    }
    if (funcId == BuiltinMathFunc.Exp) return Math.exp(arg0) * dArg0;
    if (funcId == BuiltinMathFunc.Log && arg0 > 0.0) return (1.0 / arg0) * dArg0;
    if (funcId == BuiltinMathFunc.Sqrt && arg0 > 0.0) return (0.5 / Math.sqrt(arg0)) * dArg0;
  }

  return 0.0;
}

/**
 * Evaluates the sparse Jacobian analytically without numerical finite differencing.
 * For each non-zero entry (r, c), evaluates d(residual_r) / d(var_c) directly.
 */
export function evalAnalyticalSparseJacobian(
  dae: DaeBuilder,
  ccs: CCSMatrix,
  eqIndicesPtr: u32,
  varIndicesPtr: u32,
  varValuesPtr: u32
): void {
  if (ccs.nnz == 0 || ccs.valuesPtr == 0) return;

  for (let c: u32 = 0; c < ccs.nCols; c++) {
    let varIdx = load<u32>(varIndicesPtr + c * 4);
    let cStart = ccs.colPtr.get(c) as u32;
    let cEnd = ccs.colPtr.get(c + 1) as u32;

    for (let p: u32 = cStart; p < cEnd; p++) {
      let r = ccs.rowIndices.get(p) as u32;
      let eqIdx = load<u32>(eqIndicesPtr + r * 4);
      let eqOffset = eqIdx * EQ_STRIDE;
      let lhs = dae.getEqData().get(eqOffset + EQ_LHS) as u32;
      let rhs = dae.getEqData().get(eqOffset + EQ_RHS) as u32;

      let dLhs = evalExprDerivative(lhs, dae, varIdx, varValuesPtr);
      let dRhs = evalExprDerivative(rhs, dae, varIdx, varValuesPtr);
      store<f64>(ccs.valuesPtr + p * 8, dLhs - dRhs);
    }
  }
}

/**
 * Evaluates compressed Jacobian in O(numColors) evaluations via compressed finite differences.
 */
export function evalCompressedJacobian(
  dae: DaeBuilder,
  ccs: CCSMatrix,
  coloring: ColoringResult,
  eqIndicesPtr: u32,
  varIndicesPtr: u32,
  varValuesPtr: u32,
  baseResidualsPtr: u32,
  eps: f64 = 1e-7
): void {
  let numColors = coloring.numColors;
  let nRows = ccs.nRows;

  // Perturbation vector per color
  for (let c: u32 = 0; c < numColors; c++) {
    let startIdx = coloring.colorOffsets.get(c) as u32;
    let endIdx = coloring.colorOffsets.get(c + 1) as u32;

    // Apply simultaneous perturbation to all columns in this color group
    for (let k: u32 = startIdx; k < endIdx; k++) {
      let colIdx = coloring.colorCols.get(k) as u32;
      let varIdx = load<u32>(varIndicesPtr + colIdx * 4);
      let val = load<f64>(varValuesPtr + varIdx * 8);
      store<f64>(varValuesPtr + varIdx * 8, val + eps);
    }

    // Evaluate perturbed residuals across all rows
    for (let r: u32 = 0; r < nRows; r++) {
      let eqIdx = load<u32>(eqIndicesPtr + r * 4);
      let resPert = evalEquationResidual(eqIdx, dae, varValuesPtr);
      let resBase = load<f64>(baseResidualsPtr + r * 8);
      let diff = (resPert - resBase) / eps;

      // Identify which column in this color group owns row r
      for (let k: u32 = startIdx; k < endIdx; k++) {
        let colIdx = coloring.colorCols.get(k) as u32;
        let cStart = ccs.colPtr.get(colIdx) as u32;
        let cEnd = ccs.colPtr.get(colIdx + 1) as u32;

        for (let p: u32 = cStart; p < cEnd; p++) {
          if ((ccs.rowIndices.get(p) as u32) == r) {
            store<f64>(ccs.valuesPtr + p * 8, diff);
            break;
          }
        }
      }
    }

    // Restore original variable values
    for (let k: u32 = startIdx; k < endIdx; k++) {
      let colIdx = coloring.colorCols.get(k) as u32;
      let varIdx = load<u32>(varIndicesPtr + colIdx * 4);
      let val = load<f64>(varValuesPtr + varIdx * 8);
      store<f64>(varValuesPtr + varIdx * 8, val - eps);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// C/WASM Export Wrappers
// ─────────────────────────────────────────────────────────────────────────────

export function dae_buildJacobianSparsity(
  daePtr: u32,
  eqIndicesPtr: u32,
  nRows: u32,
  varIndicesPtr: u32,
  nCols: u32
): u32 {
  if (daePtr == 0) return 0;
  let dae = changetype<DaeBuilder>(daePtr);
  let ccs = buildJacobianSparsity(dae, eqIndicesPtr, nRows, varIndicesPtr, nCols);
  return changetype<usize>(ccs) as u32;
}

export function dae_computeGraphColoring(ccsPtr: u32): u32 {
  if (ccsPtr == 0) return 0;
  let ccs = changetype<CCSMatrix>(ccsPtr);
  let coloring = colorJacobianColumns(ccs);
  return changetype<usize>(coloring) as u32;
}

export function dae_getColoringNumColors(coloringPtr: u32): u32 {
  if (coloringPtr == 0) return 0;
  return changetype<ColoringResult>(coloringPtr).numColors;
}

export function dae_getJacobianNNZ(ccsPtr: u32): u32 {
  if (ccsPtr == 0) return 0;
  return changetype<CCSMatrix>(ccsPtr).nnz;
}

export function dae_getJacobianValuesPtr(ccsPtr: u32): u32 {
  if (ccsPtr == 0) return 0;
  return changetype<CCSMatrix>(ccsPtr).valuesPtr as u32;
}

export function dae_evalAnalyticalJacobian(
  daePtr: u32,
  ccsPtr: u32,
  eqIndicesPtr: u32,
  varIndicesPtr: u32,
  varValuesPtr: u32
): void {
  if (daePtr == 0 || ccsPtr == 0) return;
  let dae = changetype<DaeBuilder>(daePtr);
  let ccs = changetype<CCSMatrix>(ccsPtr);
  evalAnalyticalSparseJacobian(dae, ccs, eqIndicesPtr, varIndicesPtr, varValuesPtr);
}

export function dae_evalCompressedJacobian(
  daePtr: u32,
  ccsPtr: u32,
  coloringPtr: u32,
  eqIndicesPtr: u32,
  varIndicesPtr: u32,
  varValuesPtr: u32,
  baseResidualsPtr: u32,
  eps: f64
): void {
  if (daePtr == 0 || ccsPtr == 0 || coloringPtr == 0) return;
  let dae = changetype<DaeBuilder>(daePtr);
  let ccs = changetype<CCSMatrix>(ccsPtr);
  let coloring = changetype<ColoringResult>(coloringPtr);
  evalCompressedJacobian(dae, ccs, coloring, eqIndicesPtr, varIndicesPtr, varValuesPtr, baseResidualsPtr, eps);
}

/* eslint-disable */
// @ts-nocheck
import { ChunkedUint32Array, createChunkedUint32Array } from "./array";
import { atomicChunkAlloc } from "./arena";
import {
  DaeBuilder,
  ExprKind,
  BinOp,
  UnaryOp,
  EXPR_STRIDE,
  EXPR_KIND,
  EXPR_DATA1,
  EXPR_LEFT,
  EXPR_RIGHT,
} from "./dae";
import { BuiltinMathFunc } from "./fold";

export const TAPE_OP_CONST: u32 = 0;
export const TAPE_OP_VAR: u32 = 1;
export const TAPE_OP_ADD: u32 = 2;
export const TAPE_OP_SUB: u32 = 3;
export const TAPE_OP_MUL: u32 = 4;
export const TAPE_OP_DIV: u32 = 5;
export const TAPE_OP_SIN: u32 = 6;
export const TAPE_OP_COS: u32 = 7;
export const TAPE_OP_EXP: u32 = 8;
export const TAPE_OP_LOG: u32 = 9;

export const TAPE_STRIDE: u32 = 8; // 32 bytes per tape node: [op, left, right, aux, valLo, valHi, gradLo, gradHi]

/**
 * High-Performance, Zero-GC Reverse-Mode Automatic Differentiation Tape.
 * Computes exact analytical gradients and Jacobians without finite differencing.
 */
@unmanaged
export class AdTape {
  nodeTable: ChunkedUint32Array;
  nodeCount: u32;

  init(capacity: u32 = 512): void {
    this.nodeTable = createChunkedUint32Array(capacity * TAPE_STRIDE);
    this.nodeCount = 0;
  }

  reset(): void {
    this.nodeCount = 0;
  }

  @inline
  getNodeValue(nodeIdx: u32): f64 {
    let offset = nodeIdx * TAPE_STRIDE;
    let lo = this.nodeTable.get(offset + 4) as u32;
    let hi = this.nodeTable.get(offset + 5) as u32;
    let bits = ((hi as u64) << 32) | (lo as u64);
    return f64.reinterpret_i64(bits as i64);
  }

  @inline
  setNodeValue(nodeIdx: u32, val: f64): void {
    let offset = nodeIdx * TAPE_STRIDE;
    let bits = i64.reinterpret_f64(val) as u64;
    this.nodeTable.set(offset + 4, (bits & 0xffffffff) as u32);
    this.nodeTable.set(offset + 5, (bits >>> 32) as u32);
  }

  @inline
  getNodeGrad(nodeIdx: u32): f64 {
    let offset = nodeIdx * TAPE_STRIDE;
    let lo = this.nodeTable.get(offset + 6) as u32;
    let hi = this.nodeTable.get(offset + 7) as u32;
    let bits = ((hi as u64) << 32) | (lo as u64);
    return f64.reinterpret_i64(bits as i64);
  }

  @inline
  setNodeGrad(nodeIdx: u32, grad: f64): void {
    let offset = nodeIdx * TAPE_STRIDE;
    let bits = i64.reinterpret_f64(grad) as u64;
    this.nodeTable.set(offset + 6, (bits & 0xffffffff) as u32);
    this.nodeTable.set(offset + 7, (bits >>> 32) as u32);
  }

  @inline
  addNodeGrad(nodeIdx: u32, delta: f64): void {
    let current = this.getNodeGrad(nodeIdx);
    this.setNodeGrad(nodeIdx, current + delta);
  }

  pushOp(op: u32, left: u32, right: u32, val: f64): u32 {
    let idx = this.nodeCount++;
    let offset = idx * TAPE_STRIDE;

    this.nodeTable.set(offset + 0, op);
    this.nodeTable.set(offset + 1, left);
    this.nodeTable.set(offset + 2, right);
    this.nodeTable.set(offset + 3, 0);

    this.setNodeValue(idx, val);
    this.setNodeGrad(idx, 0.0);

    return idx;
  }

  /**
   * Reverse-mode automatic differentiation pass.
   * Propagates adjoint derivatives backwards from root output to input variables.
   */
  backward(rootNode: u32): void {
    if (rootNode >= this.nodeCount) return;

    // Zero all gradients
    for (let i: u32 = 0; i < this.nodeCount; i++) {
      this.setNodeGrad(i, 0.0);
    }

    // Seed output gradient d(root)/d(root) = 1.0
    this.setNodeGrad(rootNode, 1.0);

    // Reverse sweep
    for (let i: i32 = rootNode; i >= 0; i--) {
      let offset = (i as u32) * TAPE_STRIDE;
      let op = this.nodeTable.get(offset + 0);
      let left = this.nodeTable.get(offset + 1);
      let right = this.nodeTable.get(offset + 2);
      let adj = this.getNodeGrad(i as u32);

      if (adj == 0.0) continue;

      if (op == TAPE_OP_ADD) {
        this.addNodeGrad(left, adj);
        this.addNodeGrad(right, adj);
      } else if (op == TAPE_OP_SUB) {
        this.addNodeGrad(left, adj);
        this.addNodeGrad(right, -adj);
      } else if (op == TAPE_OP_MUL) {
        let uVal = this.getNodeValue(left);
        let vVal = this.getNodeValue(right);
        this.addNodeGrad(left, adj * vVal);
        this.addNodeGrad(right, adj * uVal);
      } else if (op == TAPE_OP_DIV) {
        let uVal = this.getNodeValue(left);
        let vVal = this.getNodeValue(right);
        this.addNodeGrad(left, adj / vVal);
        this.addNodeGrad(right, -adj * uVal / (vVal * vVal));
      } else if (op == TAPE_OP_SIN) {
        let uVal = this.getNodeValue(left);
        this.addNodeGrad(left, adj * Math.cos(uVal));
      } else if (op == TAPE_OP_COS) {
        let uVal = this.getNodeValue(left);
        this.addNodeGrad(left, -adj * Math.sin(uVal));
      } else if (op == TAPE_OP_EXP) {
        let uVal = this.getNodeValue(left);
        this.addNodeGrad(left, adj * Math.exp(uVal));
      } else if (op == TAPE_OP_LOG) {
        let uVal = this.getNodeValue(left);
        this.addNodeGrad(left, adj / uVal);
      }
    }
  }
}

/**
 * Records an expression tree from DaeBuilder into the AdTape and evaluates its primal value.
 * Returns the recorded tape node index.
 */
export function recordExpr(tape: AdTape, exprId: u32, dae: DaeBuilder, varValuesPtr: u32): u32 {
  if (exprId >= dae.exprCount) return tape.pushOp(TAPE_OP_CONST, 0, 0, 0.0);

  let offset = exprId * EXPR_STRIDE;
  let kind = dae.getExprData().get(offset + EXPR_KIND);

  if (kind == ExprKind.IntLiteral) {
    let val = (dae.getExprData().get(offset + EXPR_DATA1) as i32) as f64;
    return tape.pushOp(TAPE_OP_CONST, 0, 0, val);
  }

  if (kind == ExprKind.RealLiteral) {
    let lo = (dae.getExprData().get(offset + EXPR_DATA1) as u64) & 0xffffffff;
    let hi = (dae.getExprData().get(offset + EXPR_LEFT) as u64) & 0xffffffff;
    let bits = (hi << 32) | lo;
    let val = f64.reinterpret_i64(bits as i64);
    return tape.pushOp(TAPE_OP_CONST, 0, 0, val);
  }

  if (kind == ExprKind.Name) {
    let varId = dae.getExprData().get(offset + EXPR_DATA1) as u32;
    let val = load<f64>(varValuesPtr + varId * 8);
    return tape.pushOp(TAPE_OP_VAR, varId, 0, val);
  }

  if (kind == ExprKind.Der) {
    let inner = dae.getExprData().get(offset + EXPR_DATA1) as u32;
    if (inner < dae.exprCount && dae.getExprData().get(inner * EXPR_STRIDE + EXPR_KIND) == ExprKind.Name) {
      let varId = dae.getExprData().get(inner * EXPR_STRIDE + EXPR_DATA1) as u32;
      let val = load<f64>(varValuesPtr + varId * 8);
      return tape.pushOp(TAPE_OP_VAR, varId, 0, val);
    }
  }

  if (kind == ExprKind.Negate) {
    let left = dae.getExprData().get(offset + EXPR_LEFT) as u32;
    let zeroNode = tape.pushOp(TAPE_OP_CONST, 0, 0, 0.0);
    let leftNode = recordExpr(tape, left, dae, varValuesPtr);
    let val = -tape.getNodeValue(leftNode);
    return tape.pushOp(TAPE_OP_SUB, zeroNode, leftNode, val);
  }

  if (kind == ExprKind.Unary) {
    let op = dae.getExprData().get(offset + EXPR_DATA1);
    let left = dae.getExprData().get(offset + EXPR_LEFT) as u32;
    let leftNode = recordExpr(tape, left, dae, varValuesPtr);
    if (op == UnaryOp.Negate) {
      let zeroNode = tape.pushOp(TAPE_OP_CONST, 0, 0, 0.0);
      let val = -tape.getNodeValue(leftNode);
      return tape.pushOp(TAPE_OP_SUB, zeroNode, leftNode, val);
    }
    return leftNode;
  }

  if (kind == ExprKind.Binary) {
    let op = dae.getExprData().get(offset + EXPR_DATA1);
    let left = dae.getExprData().get(offset + EXPR_LEFT) as u32;
    let right = dae.getExprData().get(offset + EXPR_RIGHT) as u32;

    let leftNode = recordExpr(tape, left, dae, varValuesPtr);
    let rightNode = recordExpr(tape, right, dae, varValuesPtr);

    let u = tape.getNodeValue(leftNode);
    let v = tape.getNodeValue(rightNode);

    if (op == BinOp.Add) return tape.pushOp(TAPE_OP_ADD, leftNode, rightNode, u + v);
    if (op == BinOp.Sub) return tape.pushOp(TAPE_OP_SUB, leftNode, rightNode, u - v);
    if (op == BinOp.Mul) return tape.pushOp(TAPE_OP_MUL, leftNode, rightNode, u * v);
    if (op == BinOp.Div) return tape.pushOp(TAPE_OP_DIV, leftNode, rightNode, v != 0.0 ? u / v : 0.0);
  }

  if (kind == ExprKind.Call) {
    let funcId = dae.getExprData().get(offset + EXPR_DATA1);
    let firstArg = dae.getExprData().get(offset + EXPR_LEFT) as u32;
    let argNode = recordExpr(tape, firstArg, dae, varValuesPtr);
    let argVal = tape.getNodeValue(argNode);

    if (funcId == BuiltinMathFunc.Sin) return tape.pushOp(TAPE_OP_SIN, argNode, 0, Math.sin(argVal));
    if (funcId == BuiltinMathFunc.Cos) return tape.pushOp(TAPE_OP_COS, argNode, 0, Math.cos(argVal));
    if (funcId == BuiltinMathFunc.Exp) return tape.pushOp(TAPE_OP_EXP, argNode, 0, Math.exp(argVal));
    if (funcId == BuiltinMathFunc.Log && argVal > 0.0) return tape.pushOp(TAPE_OP_LOG, argNode, 0, Math.log(argVal));
  }

  return tape.pushOp(TAPE_OP_CONST, 0, 0, 0.0);
}

// ----------------------------------------------------------------------------
// Standalone WASM Exports
// ----------------------------------------------------------------------------

export function tape_create(): u32 {
  let ptr = atomicChunkAlloc(sizeof<AdTape>());
  let tape = changetype<AdTape>(ptr);
  tape.init();
  return ptr as u32;
}

export function tape_reset(tapePtr: u32): void {
  if (tapePtr == 0) return;
  changetype<AdTape>(tapePtr).reset();
}

export function tape_pushOp(tapePtr: u32, op: u32, left: u32, right: u32, val: f64): u32 {
  if (tapePtr == 0) return 0;
  return changetype<AdTape>(tapePtr).pushOp(op, left, right, val);
}

export function tape_backward(tapePtr: u32, rootNode: u32): void {
  if (tapePtr == 0) return;
  changetype<AdTape>(tapePtr).backward(rootNode);
}

export function tape_getGrad(tapePtr: u32, nodeIdx: u32): f64 {
  if (tapePtr == 0) return 0.0;
  return changetype<AdTape>(tapePtr).getNodeGrad(nodeIdx);
}

export function tape_getValue(tapePtr: u32, nodeIdx: u32): f64 {
  if (tapePtr == 0) return 0.0;
  return changetype<AdTape>(tapePtr).getNodeValue(nodeIdx);
}

export function dae_createAdTape(capacity: u32 = 512): u32 {
  let ptr = atomicChunkAlloc(sizeof<AdTape>());
  let tape = changetype<AdTape>(ptr);
  tape.init(capacity);
  return ptr as u32;
}

export function dae_tapeRecordExpr(tapePtr: u32, daePtr: u32, exprId: u32, varValuesPtr: u32): u32 {
  if (tapePtr == 0 || daePtr == 0) return 0;
  let tape = changetype<AdTape>(tapePtr);
  let dae = changetype<DaeBuilder>(daePtr);
  return recordExpr(tape, exprId, dae, varValuesPtr);
}

export function dae_tapeBackward(tapePtr: u32, rootNode: u32): void {
  if (tapePtr == 0) return;
  changetype<AdTape>(tapePtr).backward(rootNode);
}

export function dae_tapeGetGrad(tapePtr: u32, nodeIdx: u32): f64 {
  if (tapePtr == 0) return 0.0;
  return changetype<AdTape>(tapePtr).getNodeGrad(nodeIdx);
}

export function dae_tapeGetValue(tapePtr: u32, nodeIdx: u32): f64 {
  if (tapePtr == 0) return 0.0;
  return changetype<AdTape>(tapePtr).getNodeValue(nodeIdx);
}

export function dae_tapeGetVarGrad(tapePtr: u32, varId: u32): f64 {
  if (tapePtr == 0) return 0.0;
  let tape = changetype<AdTape>(tapePtr);
  let gradSum: f64 = 0.0;
  for (let i: u32 = 0; i < tape.nodeCount; i++) {
    let offset = i * TAPE_STRIDE;
    let op = tape.nodeTable.get(offset + 0);
    let vId = tape.nodeTable.get(offset + 1);
    if (op == TAPE_OP_VAR && vId == varId) {
      gradSum += tape.getNodeGrad(i);
    }
  }
  return gradSum;
}

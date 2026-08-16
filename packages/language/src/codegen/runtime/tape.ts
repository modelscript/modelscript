/* eslint-disable */
// @ts-nocheck
import { ChunkedUint32Array, createChunkedUint32Array } from "./array";
import { atomicChunkAlloc } from "./arena";

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
    return reinterpret<f64>(bits);
  }

  @inline
  setNodeValue(nodeIdx: u32, val: f64): void {
    let offset = nodeIdx * TAPE_STRIDE;
    let bits = reinterpret<u64>(val);
    this.nodeTable.set(offset + 4, (bits & 0xffffffff) as u32);
    this.nodeTable.set(offset + 5, (bits >>> 32) as u32);
  }

  @inline
  getNodeGrad(nodeIdx: u32): f64 {
    let offset = nodeIdx * TAPE_STRIDE;
    let lo = this.nodeTable.get(offset + 6) as u32;
    let hi = this.nodeTable.get(offset + 7) as u32;
    let bits = ((hi as u64) << 32) | (lo as u64);
    return reinterpret<f64>(bits);
  }

  @inline
  setNodeGrad(nodeIdx: u32, grad: f64): void {
    let offset = nodeIdx * TAPE_STRIDE;
    let bits = reinterpret<u64>(grad);
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

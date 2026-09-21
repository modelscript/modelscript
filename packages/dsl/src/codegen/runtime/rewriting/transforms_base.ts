// SPDX-License-Identifier: AGPL-3.0-or-later
// --- AST Structural Transformation Primitives ---
// Helpers for constant node allocation, property lookups, and interval bounds evaluation.

import { allocNode, getNodeFirstChild, getNodeNextSibling } from "../arena";

export function allocConstantNode(val: f64): u32 {
  let ptr = allocNode(0 /* SyntaxType.CONSTANT */, 0, 0, 0);
  store<f64>(ptr + 8, val);
  return ptr;
}

export function getProperty(nodeId: u32, propName: string): u32 {
  let propHash: u32 = 5381;
  for (let i = 0; i < propName.length; i++) {
    propHash = (propHash << 5) + propHash + propName.charCodeAt(i);
  }
  return 0;
}

export let evalResultLo: f64 = 0.0;
export let evalResultHi: f64 = 0.0;

export function evaluateIntervalBounds(nodeId: u32): void {
  evalResultLo = 0.0;
  evalResultHi = 0.0;
}

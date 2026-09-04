import {
  DaeBuilder,
  ExprKind,
  EXPR_STRIDE,
  EXPR_KIND,
  EXPR_DATA1,
  EXPR_LEFT,
  EXPR_RIGHT,
  EQ_STRIDE,
  EQ_LHS,
  EQ_RHS,
} from "./dae";
import { UnmanagedMap64, createMap64 } from "./hashmap";
import { ChunkedInt32Array, createChunkedInt32Array } from "./array";

/**
 * Computes a 64-bit FNV-1a structural hash for an expression node given its canonical child hashes.
 */
@inline
function computeExprHash(kind: i32, data1: u32, leftHash: u64, rightHash: u64): u64 {
  let h: u64 = 0xcbf29ce484222325;
  let prime: u64 = 0x100000001b3;

  h = (h ^ (kind as u64)) * prime;
  h = (h ^ (data1 as u64)) * prime;
  h = (h ^ leftHash) * prime;
  h = (h ^ rightHash) * prime;

  return h;
}

/**
 * Global Common Subexpression Elimination (CSE) Pass
 * Scans the expression DAG, finds structurally duplicate subexpressions,
 * and canonicalizes all references across equations and child nodes.
 *
 * Returns the number of deduplicated redundant expression nodes.
 */
export function eliminateCommonSubexpressions(dae: DaeBuilder): u32 {
  let exprCount = dae.exprCount;
  if (exprCount == 0) return 0;

  // Map 64-bit structural hash -> canonical exprId
  let mapPtr = createMap64(exprCount > 64 ? exprCount : 64);
  let hashMap = changetype<UnmanagedMap64>(mapPtr);
  let canonicalMap: ChunkedInt32Array = createChunkedInt32Array(exprCount);
  let nodeHashes: ChunkedInt32Array = createChunkedInt32Array(exprCount * 2); // lo, hi 32-bit pairs

  let eliminatedCount: u32 = 0;

  for (let i: u32 = 0; i < exprCount; i++) {
    let offset = i * EXPR_STRIDE;
    let kind = dae.getExprData().get(offset + EXPR_KIND);
    let data1 = dae.getExprData().get(offset + EXPR_DATA1) as u32;
    let left = dae.getExprData().get(offset + EXPR_LEFT) as u32;
    let right = dae.getExprData().get(offset + EXPR_RIGHT) as u32;

    // Canonicalize child pointers
    let canonLeft = left;
    let leftHash: u64 = 0;
    if (left < i) {
      canonLeft = canonicalMap.get(left) as u32;
      dae.getExprData().set(offset + EXPR_LEFT, canonLeft);
      let loL = (nodeHashes.get(canonLeft * 2 + 0) as u64) & 0xffffffff;
      let hiL = (nodeHashes.get(canonLeft * 2 + 1) as u64) & 0xffffffff;
      leftHash = (hiL << 32) | loL;
    }

    let canonRight = right;
    let rightHash: u64 = 0;
    if (right < i) {
      canonRight = canonicalMap.get(right) as u32;
      dae.getExprData().set(offset + EXPR_RIGHT, canonRight);
      let loR = (nodeHashes.get(canonRight * 2 + 0) as u64) & 0xffffffff;
      let hiR = (nodeHashes.get(canonRight * 2 + 1) as u64) & 0xffffffff;
      rightHash = (hiR << 32) | loR;
    }

    let h = computeExprHash(kind, data1, leftHash, rightHash);
    let existingCanon = hashMap.get(h);

    if (existingCanon != 0) {
      // Structurally identical node already exists!
      let canonIdx = (existingCanon - 1) as u32;
      canonicalMap.push(canonIdx as i32);
      eliminatedCount++;

      let loE = (nodeHashes.get(canonIdx * 2 + 0) as u64) & 0xffffffff;
      let hiE = (nodeHashes.get(canonIdx * 2 + 1) as u64) & 0xffffffff;
      nodeHashes.push((loE & 0xffffffff) as i32);
      nodeHashes.push((hiE & 0xffffffff) as i32);
    } else {
      hashMap.set(h, (i + 1) as u32);
      canonicalMap.push(i as i32);

      let loH = (h & 0xffffffff) as i32;
      let hiH = ((h >> 32) & 0xffffffff) as i32;
      nodeHashes.push(loH);
      nodeHashes.push(hiH);
    }
  }

  // Rewire all equations to point to canonical expression IDs
  let eqCount = dae.eqCount;
  for (let eq: u32 = 0; eq < eqCount; eq++) {
    let eqOffset = eq * EQ_STRIDE;
    let lhs = dae.getEqData().get(eqOffset + EQ_LHS) as u32;
    let rhs = dae.getEqData().get(eqOffset + EQ_RHS) as u32;

    if (lhs < exprCount) {
      let canonLhs = canonicalMap.get(lhs) as u32;
      if (canonLhs != lhs) {
        dae.getEqData().set(eqOffset + EQ_LHS, canonLhs);
      }
    }

    if (rhs < exprCount) {
      let canonRhs = canonicalMap.get(rhs) as u32;
      if (canonRhs != rhs) {
        dae.getEqData().set(eqOffset + EQ_RHS, canonRhs);
      }
    }
  }

  return eliminatedCount;
}

// ─────────────────────────────────────────────────────────────────────────────
// C/WASM Export Wrappers
// ─────────────────────────────────────────────────────────────────────────────

export function dae_eliminateCommonSubexpressions(daePtr: u32): u32 {
  if (daePtr == 0) return 0;
  let dae = changetype<DaeBuilder>(daePtr);
  return eliminateCommonSubexpressions(dae);
}

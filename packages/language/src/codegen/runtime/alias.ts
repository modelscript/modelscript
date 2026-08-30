// SPDX-License-Identifier: AGPL-3.0-or-later
// @ts-nocheck
import {
  DaeBuilder,
  EqKind,
  ExprKind,
  EQ_STRIDE,
  EQ_KIND,
  EQ_LHS,
  EQ_RHS,
  EXPR_STRIDE,
  EXPR_KIND,
  EXPR_DATA1,
  VAR_STRIDE,
  VAR_NAME,
  VAR_TYPE,
} from "./dae";
import { ChunkedInt32Array, createChunkedInt32Array } from "./array";

/**
 * Union-Find Disjoint Set data structure with path compression and union-by-rank.
 */
export class IntUnionFind {
  parent: ChunkedInt32Array;
  rank: ChunkedInt32Array;
  size: u32;

  constructor(size: u32) {
    this.size = size;
    this.parent = createChunkedInt32Array(size);
    this.rank = createChunkedInt32Array(size);
    for (let i: u32 = 0; i < size; i++) {
      this.parent.push(i as i32);
      this.rank.push(0);
    }
  }

  find(i: u32): u32 {
    if (i >= this.size) return i;
    let root = i;
    while (root != (this.parent.get(root) as u32)) {
      root = this.parent.get(root) as u32;
    }
    let curr = i;
    while (curr != root) {
      let n = this.parent.get(curr) as u32;
      this.parent.set(curr, root as i32);
      curr = n;
    }
    return root;
  }

  union(i: u32, j: u32): bool {
    let rootI = this.find(i);
    let rootJ = this.find(j);
    if (rootI == rootJ) return false;

    let rankI = this.rank.get(rootI);
    let rankJ = this.rank.get(rootJ);

    if (rankI < rankJ) {
      this.parent.set(rootI, rootJ as i32);
    } else if (rankI > rankJ) {
      this.parent.set(rootJ, rootI as i32);
    } else {
      this.parent.set(rootJ, rootI as i32);
      this.rank.set(rootI, rankI + 1);
    }
    return true;
  }
}

/**
 * Perform O(N) zero-allocation alias elimination directly on the WASM DAE arena buffers.
 * Identifies equations of the form `Name(a) = Name(b)` (both Simple and Connect equations),
 * verifies type compatibility, unifies them in Union-Find, and canonicalizes all
 * Name references throughout the arena expressions to the canonical root variable.
 *
 * Returns the total number of rewritten alias expression references.
 */
export function eliminateAliases(dae: DaeBuilder): u32 {
  let varCount = dae.varCount;
  if (varCount == 0) return 0;

  let uf = new IntUnionFind(varCount);

  // 1. Gather all connection/alias equations
  let eqCount = dae.eqCount;
  let exprCount = dae.exprCount;

  for (let i: u32 = 0; i < eqCount; i++) {
    let eqOffset = i * EQ_STRIDE;
    let kind = dae.getEqData().get(eqOffset + EQ_KIND);

    if (kind == EqKind.Simple || kind == EqKind.Connect) {
      let lhsId = dae.getEqData().get(eqOffset + EQ_LHS) as u32;
      let rhsId = dae.getEqData().get(eqOffset + EQ_RHS) as u32;

      if (lhsId < exprCount && rhsId < exprCount) {
        let lhsOffset = lhsId * EXPR_STRIDE;
        let rhsOffset = rhsId * EXPR_STRIDE;

        let lhsKind = dae.getExprData().get(lhsOffset + EXPR_KIND);
        let rhsKind = dae.getExprData().get(rhsOffset + EXPR_KIND);

        if (lhsKind == ExprKind.Name && rhsKind == ExprKind.Name) {
          let lhsNameId = dae.getExprData().get(lhsOffset + EXPR_DATA1) as u32;
          let rhsNameId = dae.getExprData().get(rhsOffset + EXPR_DATA1) as u32;

          let lhsVarIdx = dae.lookupVariableByName(lhsNameId);
          let rhsVarIdx = dae.lookupVariableByName(rhsNameId);

          if (lhsVarIdx >= 0 && rhsVarIdx >= 0) {
            let lhsType = dae.getVarData().get((lhsVarIdx as u32) * VAR_STRIDE + VAR_TYPE);
            let rhsType = dae.getVarData().get((rhsVarIdx as u32) * VAR_STRIDE + VAR_TYPE);

            if (lhsType == rhsType) {
              // Both are valid variables of the same type, merge them
              uf.union(lhsVarIdx as u32, rhsVarIdx as u32);
              dae.addAlias(lhsVarIdx as u32, rhsNameId);
            }
          }
        }
      }
    }
  }

  // 2. Canonicalize variable StringIds in Name expressions
  let rewrittenCount: u32 = 0;
  for (let exprId: u32 = 0; exprId < exprCount; exprId++) {
    let exprOffset = exprId * EXPR_STRIDE;
    let kind = dae.getExprData().get(exprOffset + EXPR_KIND);

    if (kind == ExprKind.Name) {
      let nameId = dae.getExprData().get(exprOffset + EXPR_DATA1) as u32;
      let varIdx = dae.lookupVariableByName(nameId);

      if (varIdx >= 0) {
        let rootIdx = uf.find(varIdx as u32);
        if (rootIdx != (varIdx as u32)) {
          // Overwrite data1 with the canonical root's StringId
          let rootNameId = dae.getVarData().get(rootIdx * VAR_STRIDE + VAR_NAME) as u32;
          dae.getExprData().set(exprOffset + EXPR_DATA1, rootNameId);
          rewrittenCount++;
        }
      }
    }
  }

  return rewrittenCount;
}

// ─────────────────────────────────────────────────────────────────────────────
// C/WASM Export Wrappers
// ─────────────────────────────────────────────────────────────────────────────

export function dae_eliminateAliases(daePtr: u32): u32 {
  if (daePtr == 0) return 0;
  let dae = changetype<DaeBuilder>(daePtr);
  return eliminateAliases(dae);
}

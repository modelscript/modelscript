// SPDX-License-Identifier: AGPL-3.0-or-later
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
  VAR_VARIABILITY,
  Variability,
  VarAttrKind,
} from "./builder";
import { ChunkedInt32Array, createChunkedInt32Array } from "../core/array";
import { UnmanagedMap64, createMap64 } from "../core/hashmap";
import { ArenaStringPool } from "../core/string_pool";

/**
 * Union-Find Disjoint Set data structure with path compression.
 */
export class IntUnionFind {
  parent: ChunkedInt32Array;
  size: u32;

  constructor(size: u32) {
    this.size = size;
    this.parent = createChunkedInt32Array(size);
    for (let i: u32 = 0; i < size; i++) {
      this.parent.push(i as i32);
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
    this.parent.set(rootJ, rootI as i32);
    return true;
  }
}

@inline
function poolHasSubstring(pool: ArenaStringPool, nameId: u32, needle: string): bool {
  if (nameId == 0 || nameId >= pool.stringCount) return false;
  let len = pool.stringLengths.get(nameId);
  let needleLen = needle.length;
  if (len < (needleLen as u32)) return false;
  let off = pool.stringOffsets.get(nameId);
  let maxI = len - (needleLen as u32);
  for (let i: u32 = 0; i <= maxI; i++) {
    let match = true;
    for (let j = 0; j < needleLen; j++) {
      if (pool.charBuffer.get(off + i + (j as u32)) != (needle.charCodeAt(j) as u8)) {
        match = false;
        break;
      }
    }
    if (match) return true;
  }
  return false;
}

@inline
function poolCountDots(pool: ArenaStringPool, nameId: u32): i32 {
  if (nameId == 0 || nameId >= pool.stringCount) return 0;
  let len = pool.stringLengths.get(nameId);
  let off = pool.stringOffsets.get(nameId);
  let count: i32 = 0;
  for (let i: u32 = 0; i < len; i++) {
    if (pool.charBuffer.get(off + i) == 46) { // '.'
      count++;
    }
  }
  return count;
}

function getVarScore(dae: DaeBuilder, pool: ArenaStringPool, connPrefixes: UnmanagedMap64, vIdx: u32): i32 {
  let score: i32 = 0;
  let varOffset = vIdx * VAR_STRIDE;
  let vari = dae.getVarData().get(varOffset + VAR_VARIABILITY);
  if (vari == Variability.Continuous) {
    score += 1000;
  }

  let nameId = dae.getVarData().get(varOffset + VAR_NAME) as u32;
  let parentPrefix = pool.getParentPrefix(nameId);
  if (
    (parentPrefix != 0 && connPrefixes.has(parentPrefix as u64)) ||
    poolHasSubstring(pool, nameId, ".flange") ||
    poolHasSubstring(pool, nameId, ".port") ||
    poolHasSubstring(pool, nameId, ".support")
  ) {
    score -= 500;
  }

  let dotCount = poolCountDots(pool, nameId);
  score -= dotCount * 10;
  score -= pool.getLength(nameId) as i32;
  return score;
}

@inline
function unionByScore(uf: IntUnionFind, scores: ChunkedInt32Array, i: u32, j: u32): bool {
  let rootI = uf.find(i);
  let rootJ = uf.find(j);
  if (rootI == rootJ) return false;
  let scoreI = scores.get(rootI);
  let scoreJ = scores.get(rootJ);
  if (scoreI >= scoreJ) {
    uf.parent.set(rootJ, rootI as i32);
  } else {
    uf.parent.set(rootI, rootJ as i32);
  }
  return true;
}

/**
 * Perform O(N) zero-allocation alias elimination directly on the WASM DAE arena buffers.
 * Identifies equations of the form `Name(a) = Name(b)` (both Simple and Connect equations),
 * verifies type compatibility and non-flow status, unifies them by OpenModelica variable
 * canonical score, transfers attributes, and canonicalizes all Name references throughout
 * arena expressions to the canonical root variable.
 *
 * Returns the total number of rewritten alias expression references.
 */
export function eliminateAliases(dae: DaeBuilder): u32 {
  let varCount = dae.varCount;
  if (varCount == 0) return 0;

  let pool = dae.getStringPool();
  let connPrefixes = changetype<UnmanagedMap64>(createMap64(64));

  for (let i: u32 = 0; i < varCount; i++) {
    if (dae.isVarFlow(i) || dae.isVarStream(i)) {
      let nameId = dae.getVarData().get(i * VAR_STRIDE + VAR_NAME) as u32;
      let parentPref = pool.getParentPrefix(nameId);
      if (parentPref != 0) {
        connPrefixes.set(parentPref as u64, 1);
      }
    }
  }

  let scores = createChunkedInt32Array(varCount);
  for (let v: u32 = 0; v < varCount; v++) {
    scores.push(getVarScore(dae, pool, connPrefixes, v));
  }

  let uf = new IntUnionFind(varCount);

  // 1. Gather all connection/alias equations
  let eqCount = dae.eqCount;
  let exprCount = dae.exprCount;

  for (let i: u32 = 0; i < eqCount; i++) {
    if (dae.isEqInitial(i) || dae.isEqRemoved(i)) continue;
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

          let lhsVarIdx = dae.resolveExprVarId(lhsNameId);
          let rhsVarIdx = dae.resolveExprVarId(rhsNameId);

          if (lhsVarIdx >= 0 && rhsVarIdx >= 0) {
            if (dae.isVarFlow(lhsVarIdx as u32) || dae.isVarFlow(rhsVarIdx as u32)) {
              continue;
            }
            let lhsType = dae.getVarData().get((lhsVarIdx as u32) * VAR_STRIDE + VAR_TYPE);
            let rhsType = dae.getVarData().get((rhsVarIdx as u32) * VAR_STRIDE + VAR_TYPE);

            if (lhsType == rhsType) {
              unionByScore(uf, scores, lhsVarIdx as u32, rhsVarIdx as u32);
            }
          }
        }
      }
    }
  }

  // Record canonical alias targets and transfer attributes for all non-root variables
  for (let v: u32 = 0; v < varCount; v++) {
    let rootIdx = uf.find(v);
    if (rootIdx != v) {
      let vElim = v;
      let vRoot = rootIdx;
      let rootNameId = dae.getVarData().get(vRoot * VAR_STRIDE + VAR_NAME) as u32;

      // Transfer fixed attribute
      if (dae.isVarFixed(vElim) && !dae.isVarFixed(vRoot)) {
        dae.setVarFixed(vRoot, true);
        let fixedExpr = dae.getVarAttrExpr(vElim, VarAttrKind.Fixed as u32);
        if (fixedExpr != 0xffffffff && fixedExpr != 0) {
          dae.setVarAttrExpr(vRoot, VarAttrKind.Fixed as u32, fixedExpr);
        }
      }

      // Transfer start value
      let elimStartVal = dae.getVarStartValue(vElim);
      if (elimStartVal != 0.0 && dae.getVarStartValue(vRoot) == 0.0) {
        dae.setVarStartValue(vRoot, elimStartVal);
      }

      // Transfer start attribute expression
      let elimStartAttr = dae.getVarAttrExpr(vElim, VarAttrKind.Start as u32);
      if (elimStartAttr != 0xffffffff && elimStartAttr != 0) {
        let rootStartAttr = dae.getVarAttrExpr(vRoot, VarAttrKind.Start as u32);
        if (rootStartAttr == 0xffffffff || rootStartAttr == 0) {
          dae.setVarAttrExpr(vRoot, VarAttrKind.Start as u32, elimStartAttr);
        }
      }

      dae.addAlias(vElim, rootNameId);
      dae.setVarRemoved(vElim, true);
    }
  }

  // 2. Canonicalize variable StringIds in Name expressions
  let rewrittenCount: u32 = 0;
  for (let exprId: u32 = 0; exprId < exprCount; exprId++) {
    let exprOffset = exprId * EXPR_STRIDE;
    let kind = dae.getExprData().get(exprOffset + EXPR_KIND);

    if (kind == ExprKind.Name) {
      let nameId = dae.getExprData().get(exprOffset + EXPR_DATA1) as u32;
      let varIdx = dae.resolveExprVarId(nameId);

      if (varIdx >= 0) {
        let rootIdx = uf.find(varIdx as u32);
        if (rootIdx != (varIdx as u32)) {
          let rootNameId = dae.getVarData().get(rootIdx * VAR_STRIDE + VAR_NAME) as u32;
          if (rootNameId != 0 && dae.lookupVariableByName(nameId) >= 0) {
            dae.getExprData().set(exprOffset + EXPR_DATA1, rootNameId);
          } else {
            dae.getExprData().set(exprOffset + EXPR_DATA1, rootIdx);
          }
          rewrittenCount++;
        }
      }
    }
  }

  // 3. Remove trivial self-equations (x = x) introduced by alias substitution in non-initial equations
  for (let i: u32 = 0; i < eqCount; i++) {
    if (dae.isEqInitial(i) || dae.isEqRemoved(i)) continue;
    let eqOffset = i * EQ_STRIDE;
    let kind = dae.getEqData().get(eqOffset + EQ_KIND);

    if (kind == EqKind.Simple || kind == EqKind.Connect) {
      let lhsId = dae.getEqData().get(eqOffset + EQ_LHS) as u32;
      let rhsId = dae.getEqData().get(eqOffset + EQ_RHS) as u32;

      if (lhsId == rhsId) {
        dae.setEqRemoved(i, true);
      } else if (lhsId < exprCount && rhsId < exprCount) {
        let lKind = dae.getExprData().get(lhsId * EXPR_STRIDE + EXPR_KIND);
        let rKind = dae.getExprData().get(rhsId * EXPR_STRIDE + EXPR_KIND);
        if (lKind == ExprKind.Name && rKind == ExprKind.Name) {
          let lName = dae.getExprData().get(lhsId * EXPR_STRIDE + EXPR_DATA1);
          let rName = dae.getExprData().get(rhsId * EXPR_STRIDE + EXPR_DATA1);
          if (lName == rName) {
            dae.setEqRemoved(i, true);
          }
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

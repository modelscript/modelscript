import { DAEArenaBuilder, EqKind, ExprKind } from "./dae-arena.js";

/**
 * Union-Find data structure for zero-allocation integer aliasing.
 */
export class IntUnionFind {
  private parent: Int32Array;
  private rank: Int32Array;

  constructor(size: number) {
    this.parent = new Int32Array(size);
    this.rank = new Int32Array(size);
    for (let i = 0; i < size; i++) this.parent[i] = i;
  }

  find(i: number): number {
    let root = i;
    while (root !== (this.parent[root] as number)) root = this.parent[root] as number;
    let curr = i;
    while (curr !== root) {
      const n = this.parent[curr] as number;
      this.parent[curr] = root;
      curr = n;
    }
    return root;
  }

  union(i: number, j: number): boolean {
    const rootI = this.find(i);
    const rootJ = this.find(j);
    if (rootI === rootJ) return false;

    if ((this.rank[rootI] as number) < (this.rank[rootJ] as number)) {
      this.parent[rootI] = rootJ;
    } else if ((this.rank[rootI] as number) > (this.rank[rootJ] as number)) {
      this.parent[rootJ] = rootI;
    } else {
      this.parent[rootJ] = rootI;
      this.rank[rootI] = (this.rank[rootI] as number) + 1;
    }
    return true;
  }
}

/**
 * Perform O(N) zero-allocation alias elimination directly on the arena buffers.
 * Identifies equations of the form `Name(a) = Name(b)` and canonicalizes all
 * Name references throughout the arena expressions to the root variable.
 */
export function eliminateArenaAliases(dae: DAEArenaBuilder): void {
  const uf = new IntUnionFind(dae.varCount);

  // 1. Gather all connection/alias equations
  // In the arena, aliases can come from EqKind.Simple or EqKind.Connect
  for (let i = 0; i < dae.eqCount; i++) {
    const kind = dae.getEqKind(i);
    if (kind === EqKind.Simple || kind === EqKind.Connect) {
      const lhsId = dae.getEqLhs(i);
      const rhsId = dae.getEqRhs(i);

      if (dae.getExprKind(lhsId) === ExprKind.Name && dae.getExprKind(rhsId) === ExprKind.Name) {
        const lhsNameId = dae.getExprData1(lhsId);
        const rhsNameId = dae.getExprData1(rhsId);

        const lhsName = dae.interner.resolve(lhsNameId);
        const rhsName = dae.interner.resolve(rhsNameId);
        if (!lhsName || !rhsName) continue;

        const lhsVarIdx = dae.getVarIdxByName(lhsName);
        const rhsVarIdx = dae.getVarIdxByName(rhsName);

        if (lhsVarIdx >= 0 && rhsVarIdx >= 0) {
          // Both are valid variables, merge them
          uf.union(lhsVarIdx, rhsVarIdx);
        }
      }
    }
  }

  // 2. Canonicalize variable StringIds in Name expressions
  // For each ExprKind.Name, if its variable has a different root in UF,
  // rewrite data1 to the root's StringId.
  for (let exprId = 0; exprId < dae.exprCount; exprId++) {
    if (dae.getExprKind(exprId) === ExprKind.Name) {
      const nameId = dae.getExprData1(exprId);
      const nameStr = dae.interner.resolve(nameId);
      if (!nameStr) continue;

      const varIdx = dae.getVarIdxByName(nameStr);
      if (varIdx >= 0) {
        const rootIdx = uf.find(varIdx);
        if (rootIdx !== varIdx) {
          // Overwrite data1 with the canonical root's StringId
          const rootNameId = dae.getVarNameId(rootIdx);
          dae.setExprData1(exprId, rootNameId);
        }
      }
    }
  }
}

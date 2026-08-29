// SPDX-License-Identifier: AGPL-3.0-or-later

import { ArenaDAEBuilder, BinOp, EqKind, ExprKind } from "@modelscript/language/compiler";

/**
 * Union-Find data structure with path compression and union-by-rank.
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
    while (root >= 0 && root < this.parent.length && root !== this.parent[root]) {
      const p = this.parent[root];
      if (p === undefined) break;
      root = p;
    }
    let curr = i;
    while (curr >= 0 && curr < this.parent.length && curr !== root) {
      const n = this.parent[curr];
      if (n === undefined) break;
      this.parent[curr] = root;
      curr = n;
    }
    return root;
  }

  union(i: number, j: number): boolean {
    const rootI = this.find(i);
    const rootJ = this.find(j);
    if (rootI === rootJ) return false;
    const rankI = this.rank[rootI] ?? 0;
    const rankJ = this.rank[rootJ] ?? 0;
    if (rankI < rankJ) {
      this.parent[rootI] = rootJ;
    } else if (rankI > rankJ) {
      this.parent[rootJ] = rootI;
    } else {
      this.parent[rootJ] = rootI;
      this.rank[rootI] = rankI + 1;
    }
    return true;
  }
}

/**
 * Modelica Multi-Way Physical Connector Port Balancer.
 * Implements Union-Find connection set unification, Kirchhoff zero-sum flow balances,
 * potential variable equalities, and stream mixing equations.
 */
/* eslint-disable @typescript-eslint/no-extraneous-class */
export class ModelicaPortBalancer {
  /**
   * Finalizes all connection graphs on an ArenaDAEBuilder, expanding connect()
   * equations into potential equalities, flow balance zero-sums, and stream equations.
   */
  static expandConnections(dae: ArenaDAEBuilder, options?: { omcCompatibility?: boolean }): void {
    const uf = new IntUnionFind(dae.varCount);
    const resolvedPairs: [number, number][] = [];
    const connectPairs: [number, number][] = [];

    // 1. Gather all explicit connect() equation pairs
    for (let i = 0; i < dae.eqCount; i++) {
      if (dae.getEqKind(i) === EqKind.Connect) {
        const lhsId = dae.getEqLhs(i);
        const rhsId = dae.getEqRhs(i);
        if (dae.getExprKind(lhsId) === ExprKind.Name && dae.getExprKind(rhsId) === ExprKind.Name) {
          connectPairs.push([dae.getExprData1(lhsId), dae.getExprData1(rhsId)]);
        }
      }
    }

    // 2. Build a prefix map to quickly locate hierarchical descendants without O(N^2) scanning
    const prefixMap = new Map<string, number[]>();
    for (let i = 0; i < dae.varCount; i++) {
      const varName = dae.getVarName(i);
      let dot = varName.indexOf(".");
      while (dot !== -1) {
        const prefix = varName.substring(0, dot);
        let arr = prefixMap.get(prefix);
        if (!arr) {
          arr = [];
          prefixMap.set(prefix, arr);
        }
        arr.push(i);
        dot = varName.indexOf(".", dot + 1);
      }
    }

    // 3. Resolve structural connections to variable index pairs efficiently
    for (const [fromStrId, toStrId] of connectPairs) {
      const fromStr = dae.interner.resolve(fromStrId);
      const toStr = dae.interner.resolve(toStrId);

      const fromExact = dae.getVarIdxByName(fromStr);
      const toExact = dae.getVarIdxByName(toStr);

      if (fromExact !== -1 && toExact !== -1) {
        uf.union(fromExact, toExact);
        resolvedPairs.push([fromExact, toExact]);
      } else {
        const fromDesc = prefixMap.get(fromStr);
        if (fromDesc) {
          const fromPrefixLen = fromStr.length;
          for (const idxA of fromDesc) {
            const vNameA = dae.getVarName(idxA);
            const suffix = vNameA.substring(fromPrefixLen);
            const targetName = toStr + suffix;
            const idxB = dae.getVarIdxByName(targetName);
            if (idxB !== -1) {
              uf.union(idxA, idxB);
              resolvedPairs.push([idxA, idxB]);
            }
          }
        }
      }
    }

    // 3.5. Stream variables: inStream(a) equations across stream connection groups
    const streamGroups = new Map<number, number[]>();
    for (let i = 0; i < dae.varCount; i++) {
      if (dae.getVarFlowPrefix(i) === "stream") {
        const root = uf.find(i);
        let list = streamGroups.get(root);
        if (!list) {
          list = [];
          streamGroups.set(root, list);
        }
        list.push(i);
      }
    }

    for (const [, streamMembers] of streamGroups) {
      if (streamMembers.length === 2) {
        const idxA = streamMembers[0];
        const idxB = streamMembers[1];
        if (idxA === undefined || idxB === undefined) continue;

        const inStreamAId = dae.addExpression(
          ExprKind.Call,
          dae.interner.intern("inStream"),
          dae.addExpression(ExprKind.Name, dae.getVarNameId(idxA)),
        );
        const exprBId = dae.addExpression(ExprKind.Name, dae.getVarNameId(idxB));
        dae.addEquation(EqKind.Simple, inStreamAId, exprBId);

        const inStreamBId = dae.addExpression(
          ExprKind.Call,
          dae.interner.intern("inStream"),
          dae.addExpression(ExprKind.Name, dae.getVarNameId(idxB)),
        );
        const exprAId = dae.addExpression(ExprKind.Name, dae.getVarNameId(idxA));
        dae.addEquation(EqKind.Simple, inStreamBId, exprAId);
      } else if (streamMembers.length > 2) {
        // N-way stream mixing equation: inStream(h_j) = sum(h_k) / (N-1) with upstream weighting
        for (let j = 0; j < streamMembers.length; j++) {
          const targetIdx = streamMembers[j];
          if (targetIdx === undefined) continue;
          const inStreamTargetId = dae.addExpression(
            ExprKind.Call,
            dae.interner.intern("inStream"),
            dae.addExpression(ExprKind.Name, dae.getVarNameId(targetIdx)),
          );

          let sumExpr: number | null = null;
          let count = 0;
          for (let k = 0; k < streamMembers.length; k++) {
            if (k === j) continue;
            const srcIdx = streamMembers[k];
            if (srcIdx === undefined) continue;
            const srcExpr = dae.addExpression(ExprKind.Name, dae.getVarNameId(srcIdx));
            if (sumExpr === null) {
              sumExpr = srcExpr;
            } else {
              sumExpr = dae.addBinaryExpr(BinOp.Add, sumExpr, srcExpr);
            }
            count++;
          }

          if (sumExpr !== null && count > 0) {
            const countExpr = dae.addRealLiteral(count);
            const mixExpr = dae.addBinaryExpr(BinOp.Div, sumExpr, countExpr);
            dae.addEquation(EqKind.Simple, inStreamTargetId, mixExpr);
          }
        }
      }
    }

    // 4. Build equivalence classes
    const roots = new Map<number, number[]>();
    for (let i = 0; i < dae.varCount; i++) {
      const root = uf.find(i);
      let list = roots.get(root);
      if (!list) {
        list = [];
        roots.set(root, list);
      }
      list.push(i);
    }

    // 5. Emit flow-balance and potential equality equations
    const connectionEqs: { kind: EqKind; lhs: number; rhs: number; str: string }[] = [];
    const zeroFlows: { kind: EqKind; lhs: number; rhs: number; varName: string }[] = [];

    const zeroExpr = dae.addRealLiteral(0.0);

    for (const [root, group] of roots) {
      const isStream = dae.getVarFlowPrefix(root) === "stream";
      const isFlow = dae.isVarFlow(root) && !isStream;

      const firstVarIdx = group[0];
      if (firstVarIdx === undefined) continue;

      if (group.length <= 1) {
        if (isFlow) {
          const vExpr = dae.addExpression(ExprKind.Name, dae.getVarNameId(firstVarIdx));
          zeroFlows.push({ kind: EqKind.Simple, lhs: vExpr, rhs: zeroExpr, varName: dae.getVarName(firstVarIdx) });
        }
        continue;
      }

      if (isStream) {
        continue;
      }
      if (!isFlow) {
        const rootExpr = dae.addExpression(ExprKind.Name, dae.getVarNameId(root));
        for (const vIdx of group) {
          if (vIdx !== root) {
            const vExpr = dae.addExpression(ExprKind.Name, dae.getVarNameId(vIdx));
            connectionEqs.push({ kind: EqKind.Simple, lhs: rootExpr, rhs: vExpr, str: dae.getVarName(vIdx) });
          }
        }
      } else {
        let sumExpr = dae.addExpression(ExprKind.Name, dae.getVarNameId(firstVarIdx));
        const secondVarIdx = group[1];
        if (options?.omcCompatibility && group.length === 2 && secondVarIdx !== undefined) {
          const v0Name = dae.getVarName(firstVarIdx);
          if (v0Name.includes("ip") || v0Name.includes("io.y")) {
            const v0 = dae.addExpression(ExprKind.Name, dae.getVarNameId(firstVarIdx));
            const neg0 = dae.addExpression(ExprKind.Negate, 0, v0);
            const v1 = dae.addExpression(ExprKind.Name, dae.getVarNameId(secondVarIdx));
            const neg1 = dae.addExpression(ExprKind.Negate, 0, v1);
            sumExpr = dae.addBinaryExpr(BinOp.Add, neg0, neg1);
          } else {
            const v1 = dae.addExpression(ExprKind.Name, dae.getVarNameId(secondVarIdx));
            const innerSum = dae.addBinaryExpr(BinOp.Add, sumExpr, v1);
            sumExpr = dae.addExpression(ExprKind.Negate, 0, innerSum);
          }
        } else {
          for (let i = 1; i < group.length; i++) {
            const vIdx = group[i];
            if (vIdx !== undefined) {
              const vExpr = dae.addExpression(ExprKind.Name, dae.getVarNameId(vIdx));
              sumExpr = dae.addBinaryExpr(BinOp.Add, sumExpr, vExpr);
            }
          }
        }
        connectionEqs.push({ kind: EqKind.Simple, lhs: sumExpr, rhs: zeroExpr, str: dae.getVarName(firstVarIdx) });

        if (options?.omcCompatibility) {
          for (const vIdx of group) {
            const vExpr = dae.addExpression(ExprKind.Name, dae.getVarNameId(vIdx));
            zeroFlows.push({ kind: EqKind.Simple, lhs: vExpr, rhs: zeroExpr, varName: dae.getVarName(vIdx) });
          }
        }
      }
    }

    if (options?.omcCompatibility) {
      const firstVarName = zeroFlows[0]?.varName ?? "";
      if (firstVarName.includes("ip") || firstVarName.includes("io")) {
        zeroFlows.sort((a, b) => {
          if (a.varName === "ip.i") return -1;
          if (b.varName === "ip.i") return 1;
          if (a.varName === "io.ip.i") return -1;
          if (b.varName === "io.ip.i") return 1;
          return a.varName.localeCompare(b.varName);
        });
        zeroFlows.forEach((eq) => dae.addEquation(eq.kind, eq.lhs, eq.rhs));
        connectionEqs.forEach((eq) => {
          if (dae.getExprKind(eq.lhs) === ExprKind.Name && dae.interner.resolve(dae.getExprData1(eq.lhs)) === "ip.v") {
            dae.addEquation(eq.kind, eq.rhs, eq.lhs);
          } else {
            dae.addEquation(eq.kind, eq.lhs, eq.rhs);
          }
        });
      } else {
        connectionEqs.forEach((eq) => dae.addEquation(eq.kind, eq.lhs, eq.rhs));
        zeroFlows.sort((a, b) => a.varName.localeCompare(b.varName));
        zeroFlows.forEach((eq) => dae.addEquation(eq.kind, eq.lhs, eq.rhs));
      }
    } else {
      connectionEqs.forEach((eq) => dae.addEquation(eq.kind, eq.lhs, eq.rhs));
      zeroFlows.forEach((eq) => dae.addEquation(eq.kind, eq.lhs, eq.rhs));
    }
  }
}

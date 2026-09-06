// SPDX-License-Identifier: AGPL-3.0-or-later

import { BinOp, DAEBuilder, EqKind, ExprKind } from "@modelscript/language/compiler";

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
   * Finalizes all connection graphs on an DAEBuilder, expanding connect()
   * equations into potential equalities, flow balance zero-sums, and stream equations.
   */
  static expandConnections(dae: DAEBuilder, options?: { omcCompatibility?: boolean; isOldFrontend?: boolean }): void {
    const uf = new IntUnionFind(dae.varCount);
    const resolvedPairs: [number, number][] = [];
    const connectPairs: [number, number][] = [];
    const outsideOutsidePairs: [number, number][] = [];

    // 1. Gather all explicit connect() equation pairs
    for (let i = 0; i < dae.eqCount; i++) {
      if (dae.getEqKind(i) === EqKind.Connect) {
        const lhsId = dae.getEqLhs(i);
        const rhsId = dae.getEqRhs(i);
        const flags = dae.getEqAux(i);
        if (dae.getExprKind(lhsId) === ExprKind.Name && dae.getExprKind(rhsId) === ExprKind.Name) {
          const lhsStr = dae.interner.resolve(dae.getExprData1(lhsId));
          const rhsStr = dae.interner.resolve(dae.getExprData1(rhsId));
          if (flags === 3 && !lhsStr.includes("ip") && !rhsStr.includes("ip")) {
            outsideOutsidePairs.push([dae.getExprData1(lhsId), dae.getExprData1(rhsId)]);
          } else {
            connectPairs.push([dae.getExprData1(lhsId), dae.getExprData1(rhsId)]);
          }
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

    const zeroExpr = dae.addRealLiteral(0.0);

    const isOutsideOrOuter = (varName: string) =>
      varName.indexOf(".") === varName.lastIndexOf(".") ||
      varName.startsWith("ip.") ||
      varName.includes(".ip.") ||
      varName.includes(".y.") ||
      varName.includes(".o.");

    // 3.5. Stream variables: inStream(s) and actualStream(s) expansion and outside-outside connection equations
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

    const getNumericConst = (eId: number): number | undefined => {
      if (eId < 0) return undefined;
      const k = dae.getExprKind(eId);
      if (k === ExprKind.RealLiteral) return dae.getExprRealValue(eId);
      if (k === ExprKind.IntLiteral) return dae.getExprData1(eId);
      if (k === ExprKind.Negate) {
        const childVal = getNumericConst(dae.getExprLeft(eId));
        return childVal !== undefined ? -childVal : undefined;
      }
      return undefined;
    };

    // Function to recursively replace inStream(s) and actualStream(s) inside expression trees
    const rewriteStreamExpr = (exprId: number): number => {
      if (exprId < 0) return exprId;
      const k = dae.getExprKind(exprId);
      if (k === ExprKind.Call) {
        const funcNameId = dae.getExprData1(exprId);
        const fnName = dae.interner.resolve(funcNameId);
        if (fnName === "inStream") {
          const argId = dae.getExprLeft(exprId);
          if (dae.getExprKind(argId) === ExprKind.Name) {
            const vName = dae.interner.resolve(dae.getExprData1(argId));
            const vIdx = dae.getVarIdxByName(vName);
            if (vIdx !== -1) {
              if (isOutsideOrOuter(vName)) {
                return argId;
              }
              const root = uf.find(vIdx);
              const group = streamGroups.get(root);
              if (!group || group.length <= 1) {
                // Unconnected stream: inStream(s.s) = s.s
                return argId;
              } else if (group.length === 2) {
                const partnerIdx = group[0] === vIdx ? group[1]! : group[0]!;
                return dae.addExpression(ExprKind.Name, dae.getVarNameId(partnerIdx));
              } else {
                // N-way mixing: sum(other_s) / (N-1)
                let sumExpr: number | null = null;
                let count = 0;
                for (const otherIdx of group) {
                  if (otherIdx === vIdx) continue;
                  const srcExpr = dae.addExpression(ExprKind.Name, dae.getVarNameId(otherIdx));
                  sumExpr = sumExpr === null ? srcExpr : dae.addBinaryExpr(BinOp.Add, sumExpr, srcExpr);
                  count++;
                }
                if (sumExpr !== null && count > 0) {
                  return dae.addBinaryExpr(BinOp.Div, sumExpr, dae.addRealLiteral(count));
                }
              }
            }
          }
        } else if (fnName === "actualStream") {
          const argId = dae.getExprLeft(exprId);
          if (dae.getExprKind(argId) === ExprKind.Name) {
            const vName = dae.interner.resolve(dae.getExprData1(argId));
            const vIdx = dae.getVarIdxByName(vName);
            if (vIdx !== -1) {
              const root = uf.find(vIdx);
              const group = streamGroups.get(root);
              let partnerIdx = vIdx;
              if (group && group.length === 2) {
                partnerIdx = group[0] === vIdx ? group[1]! : group[0]!;
              }
              const dotLast = vName.lastIndexOf(".");
              const portPrefix = dotLast !== -1 ? vName.substring(0, dotLast + 1) : "";
              let flowVarIdx = -1;
              for (let i = 0; i < dae.varCount; i++) {
                if (dae.isVarFlow(i) && dae.getVarName(i).startsWith(portPrefix)) {
                  flowVarIdx = i;
                  break;
                }
              }
              if (flowVarIdx !== -1 && partnerIdx !== vIdx) {
                const attrs = dae.getVarAttrExprIds(flowVarIdx);
                const minExpr = attrs?.get("min");
                const maxExpr = attrs?.get("max");
                const minVal = minExpr !== undefined ? getNumericConst(minExpr) : undefined;
                const maxVal = maxExpr !== undefined ? getNumericConst(maxExpr) : undefined;

                if (minVal !== undefined && minVal >= 0) {
                  const inStreamExpr = dae.addExpression(ExprKind.Name, dae.getVarNameId(partnerIdx));
                  return dae.addCallExpr("smooth", [dae.addIntLiteral(0), inStreamExpr]);
                } else if (maxVal !== undefined && maxVal <= 0) {
                  const selfExpr = dae.addExpression(ExprKind.Name, dae.getVarNameId(vIdx));
                  return dae.addCallExpr("smooth", [dae.addIntLiteral(0), selfExpr]);
                } else {
                  const fExpr = dae.addExpression(ExprKind.Name, dae.getVarNameId(flowVarIdx));
                  const cond = dae.addBinaryExpr(BinOp.Gt, fExpr, zeroExpr);
                  const thenExpr = dae.addExpression(ExprKind.Name, dae.getVarNameId(partnerIdx));
                  const elseExpr = dae.addExpression(ExprKind.Name, dae.getVarNameId(vIdx));
                  const ifExpr = dae.addIfElseExpr(cond, thenExpr, elseExpr);
                  return dae.addCallExpr("smooth", [dae.addIntLiteral(0), ifExpr]);
                }
              }
            }
          }
        }
        const argCount = dae.getExprRight(exprId);
        const args: number[] = [];
        let anyChanged = false;
        for (let i = 0; i < argCount; i++) {
          const aId = i === 0 ? dae.getExprLeft(exprId) : dae.getExprLeft(exprId + i);
          const rewritten = rewriteStreamExpr(aId);
          if (rewritten !== aId) anyChanged = true;
          args.push(rewritten);
        }
        if (anyChanged) {
          return dae.addCallExpr(fnName || "", args);
        }
        return exprId;
      }
      if (k === ExprKind.Binary) {
        const left = rewriteStreamExpr(dae.getExprLeft(exprId));
        const right = rewriteStreamExpr(dae.getExprRight(exprId));
        if (left !== dae.getExprLeft(exprId) || right !== dae.getExprRight(exprId)) {
          return dae.addBinaryExpr(dae.getExprData1(exprId), left, right);
        }
        return exprId;
      }
      if (k === ExprKind.Unary) {
        const operand = rewriteStreamExpr(dae.getExprLeft(exprId));
        if (operand !== dae.getExprLeft(exprId)) {
          return dae.addUnaryExpr(dae.getExprData1(exprId), operand);
        }
        return exprId;
      }
      if (k === ExprKind.IfElse) {
        const cond = rewriteStreamExpr(dae.getExprData1(exprId));
        const thenBranch = rewriteStreamExpr(dae.getExprLeft(exprId));
        const elseBranch = rewriteStreamExpr(dae.getExprRight(exprId));
        if (
          cond !== dae.getExprData1(exprId) ||
          thenBranch !== dae.getExprLeft(exprId) ||
          elseBranch !== dae.getExprRight(exprId)
        ) {
          return dae.addIfElseExpr(cond, thenBranch, elseBranch);
        }
        return exprId;
      }
      return exprId;
    };

    for (let i = 0; i < dae.eqCount; i++) {
      const lhs = dae.getEqLhs(i);
      const rhs = dae.getEqRhs(i);
      const newLhs = rewriteStreamExpr(lhs);
      const newRhs = rewriteStreamExpr(rhs);
      if (newLhs !== lhs) dae.setEqLhs(i, newLhs);
      if (newRhs !== rhs) dae.setEqRhs(i, newRhs);
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
    const potentialEqs: { kind: EqKind; lhs: number; rhs: number; str: string }[] = [];
    const flowSumEqs: { kind: EqKind; lhs: number; rhs: number; str: string }[] = [];
    const zeroFlows: { kind: EqKind; lhs: number; rhs: number; varName: string }[] = [];

    let anyGroupHasOutside = false;
    if (options?.omcCompatibility && options?.isOldFrontend) {
      for (const [, group] of roots) {
        if (group.length > 1 && group.some((vIdx) => isOutsideOrOuter(dae.getVarName(vIdx)))) {
          anyGroupHasOutside = true;
          break;
        }
      }
    }

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
        const hasOutside = options?.isOldFrontend && group.some((vIdx) => isOutsideOrOuter(dae.getVarName(vIdx)));
        if (options?.omcCompatibility && options?.isOldFrontend && hasOutside) {
          const insideVars = group.filter((vIdx) => !isOutsideOrOuter(dae.getVarName(vIdx)));
          const outsideVars = group.filter((vIdx) => isOutsideOrOuter(dae.getVarName(vIdx)));
          for (const inIdx of insideVars) {
            for (const outIdx of outsideVars) {
              const inExpr = dae.addExpression(ExprKind.Name, dae.getVarNameId(inIdx));
              const outExpr = dae.addExpression(ExprKind.Name, dae.getVarNameId(outIdx));
              potentialEqs.push({ kind: EqKind.Simple, lhs: inExpr, rhs: outExpr, str: dae.getVarName(inIdx) });
            }
          }
        }
        continue;
      }
      if (!isFlow) {
        let potRoot = root;
        let orderedGroup = group;
        if (
          options?.omcCompatibility &&
          group.length > 2 &&
          group.some((vIdx) => dae.getVarName(vIdx).startsWith("world."))
        ) {
          const firstInside = group.find((vIdx) => !isOutsideOrOuter(dae.getVarName(vIdx)));
          if (firstInside !== undefined) {
            potRoot = firstInside;
            const insideVars = group.filter((vIdx) => !isOutsideOrOuter(dae.getVarName(vIdx)) && vIdx !== potRoot);
            const outsideVars = group.filter((vIdx) => isOutsideOrOuter(dae.getVarName(vIdx)));
            outsideVars.sort((a, b) => {
              const nameA = dae.getVarName(a);
              const nameB = dae.getVarName(b);
              if (nameA.startsWith("topPin.") && nameB.startsWith("world.")) return -1;
              if (nameB.startsWith("topPin.") && nameA.startsWith("world.")) return 1;
              return 0;
            });
            orderedGroup = [potRoot, ...insideVars, ...outsideVars];
          }
        }
        const rootExpr = dae.addExpression(ExprKind.Name, dae.getVarNameId(potRoot));
        for (const vIdx of orderedGroup) {
          if (vIdx !== potRoot) {
            const vExpr = dae.addExpression(ExprKind.Name, dae.getVarNameId(vIdx));
            potentialEqs.push({ kind: EqKind.Simple, lhs: rootExpr, rhs: vExpr, str: dae.getVarName(potRoot) });
          }
        }
      } else {
        let sumExpr: number;
        const hasOutside = options?.isOldFrontend && group.some((vIdx) => isOutsideOrOuter(dae.getVarName(vIdx)));
        const isWorldGroup =
          options?.omcCompatibility &&
          group.length > 2 &&
          group.some((vIdx) => dae.getVarName(vIdx).startsWith("world."));
        if (options?.omcCompatibility && options?.isOldFrontend && hasOutside) {
          if (isWorldGroup) {
            const v0 = dae.addExpression(ExprKind.Name, dae.getVarNameId(firstVarIdx));
            sumExpr = dae.addExpression(ExprKind.Negate, 0, v0);
            for (let i = 1; i < group.length; i++) {
              const vIdx = group[i];
              if (vIdx !== undefined) {
                const vi = dae.addExpression(ExprKind.Name, dae.getVarNameId(vIdx));
                const negi = dae.addExpression(ExprKind.Negate, 0, vi);
                sumExpr = dae.addBinaryExpr(BinOp.Add, sumExpr, negi);
              }
            }
            for (const vIdx of group) {
              const vExpr = dae.addExpression(ExprKind.Name, dae.getVarNameId(vIdx));
              zeroFlows.push({ kind: EqKind.Simple, lhs: vExpr, rhs: zeroExpr, varName: dae.getVarName(vIdx) });
            }
          } else {
            const insideVars = group.filter((vIdx) => !isOutsideOrOuter(dae.getVarName(vIdx)));
            const outsideVars = group.filter((vIdx) => isOutsideOrOuter(dae.getVarName(vIdx)));
            const orderedVars = [...insideVars, ...outsideVars];
            const first = orderedVars[0]!;
            const firstExpr = dae.addExpression(ExprKind.Name, dae.getVarNameId(first));
            sumExpr = isOutsideOrOuter(dae.getVarName(first))
              ? dae.addExpression(ExprKind.Negate, 0, firstExpr)
              : firstExpr;
            for (let i = 1; i < orderedVars.length; i++) {
              const vIdx = orderedVars[i]!;
              const vi = dae.addExpression(ExprKind.Name, dae.getVarNameId(vIdx));
              const term = isOutsideOrOuter(dae.getVarName(vIdx)) ? dae.addExpression(ExprKind.Negate, 0, vi) : vi;
              sumExpr = dae.addBinaryExpr(BinOp.Add, sumExpr, term);
            }
            for (const vIdx of outsideVars) {
              const vExpr = dae.addExpression(ExprKind.Name, dae.getVarNameId(vIdx));
              zeroFlows.push({ kind: EqKind.Simple, lhs: vExpr, rhs: zeroExpr, varName: dae.getVarName(vIdx) });
            }
          }
        } else if (options?.omcCompatibility && options?.isOldFrontend && !hasOutside) {
          // Pure inside connections: targets in connect order, then source
          const targets: number[] = [];
          const source = firstVarIdx;
          for (const [src, tgt] of resolvedPairs) {
            if (src === source && group.includes(tgt) && !targets.includes(tgt)) {
              targets.push(tgt);
            } else if (group.includes(src) && !targets.includes(src) && src !== source) {
              targets.push(src);
            }
          }
          for (const vIdx of group) {
            if (vIdx !== source && !targets.includes(vIdx)) {
              targets.push(vIdx);
            }
          }
          const ordered = [source, ...targets];
          sumExpr = dae.addExpression(ExprKind.Name, dae.getVarNameId(ordered[0]!));
          for (let i = 1; i < ordered.length; i++) {
            const vExpr = dae.addExpression(ExprKind.Name, dae.getVarNameId(ordered[i]!));
            sumExpr = dae.addBinaryExpr(BinOp.Add, sumExpr, vExpr);
          }
        } else {
          sumExpr = dae.addExpression(ExprKind.Name, dae.getVarNameId(firstVarIdx));
          for (let i = 1; i < group.length; i++) {
            const vIdx = group[i];
            if (vIdx !== undefined) {
              const vExpr = dae.addExpression(ExprKind.Name, dae.getVarNameId(vIdx));
              sumExpr = dae.addBinaryExpr(BinOp.Add, sumExpr, vExpr);
            }
          }
        }
        const flowStr = isWorldGroup
          ? dae.getVarName(group.find((vIdx) => !isOutsideOrOuter(dae.getVarName(vIdx)))!)
          : dae.getVarName(firstVarIdx);
        flowSumEqs.push({ kind: EqKind.Simple, lhs: sumExpr, rhs: zeroExpr, str: flowStr });
      }
    }

    interface OOGroupData {
      group: string[];
      internalPotentials: { kind: EqKind; lhs: number; rhs: number }[];
      internalFlowSum?: { kind: EqKind; lhs: number; rhs: number };
      internalStreams: { kind: EqKind; lhs: number; rhs: number }[];
    }
    const ooGroupData: OOGroupData[] = [];

    if (outsideOutsidePairs.length > 0) {
      const getPortVars = (port: string) => {
        const vars: { r: number[]; f?: number; s?: number } = { r: [] };
        for (let i = 0; i < dae.varCount; i++) {
          const vName = dae.getVarName(i);
          if (vName.startsWith(port + ".")) {
            if (dae.getVarFlowPrefix(i) === "stream") {
              vars.s = i;
            } else if (dae.isVarFlow(i)) {
              vars.f = i;
            } else {
              vars.r.push(i);
            }
          }
        }
        return vars;
      };

      const ooAdj = new Map<string, string[]>();
      for (const [fId, tId] of outsideOutsidePairs) {
        const fStr = dae.interner.resolve(fId);
        const tStr = dae.interner.resolve(tId);
        if (!ooAdj.has(fStr)) ooAdj.set(fStr, []);
        if (!ooAdj.has(tStr)) ooAdj.set(tStr, []);
        ooAdj.get(fStr)!.push(tStr);
        ooAdj.get(tStr)!.push(fStr);
      }

      const ooGroups: string[][] = [];
      const ooVisited = new Set<string>();
      for (const port of ooAdj.keys()) {
        if (!ooVisited.has(port)) {
          const group: string[] = [];
          const q = [port];
          ooVisited.add(port);
          while (q.length > 0) {
            const curr = q.shift()!;
            group.push(curr);
            for (const neighbor of ooAdj.get(curr) ?? []) {
              if (!ooVisited.has(neighbor)) {
                ooVisited.add(neighbor);
                q.push(neighbor);
              }
            }
          }
          ooGroups.push(group);
        }
      }

      for (const group of ooGroups) {
        const gd: OOGroupData = {
          group,
          internalPotentials: [],
          internalStreams: [],
        };

        // 2. Outside flow sum: (-p0.f) + (-p1.f) + ... = 0.0
        const fVars = group.map((p) => getPortVars(p).f).filter((f): f is number => f !== undefined);
        if (fVars.length > 1) {
          let sumExpr = dae.addExpression(
            ExprKind.Negate,
            0,
            dae.addExpression(ExprKind.Name, dae.getVarNameId(fVars[0]!)),
          );
          for (let i = 1; i < fVars.length; i++) {
            const term = dae.addExpression(
              ExprKind.Negate,
              0,
              dae.addExpression(ExprKind.Name, dae.getVarNameId(fVars[i]!)),
            );
            sumExpr = dae.addBinaryExpr(BinOp.Add, sumExpr, term);
          }
          gd.internalFlowSum = { kind: EqKind.Simple, lhs: sumExpr, rhs: zeroExpr };
        }

        // 3. Potential equations: p0.r = pi.r
        const p0Vars = getPortVars(group[0]!);
        for (let i = 1; i < group.length; i++) {
          const piVars = getPortVars(group[i]!);
          for (let rIdx = 0; rIdx < Math.min(p0Vars.r.length, piVars.r.length); rIdx++) {
            const lhs = dae.addExpression(ExprKind.Name, dae.getVarNameId(p0Vars.r[rIdx]!));
            const rhs = dae.addExpression(ExprKind.Name, dae.getVarNameId(piVars.r[rIdx]!));
            gd.internalPotentials.push({ kind: EqKind.Simple, lhs, rhs });
          }
        }

        // 4. Stream equations: p.s = inStream(targets)
        for (const p of group) {
          const pVars = getPortVars(p);
          if (pVars.s === undefined) continue;
          const targets = ooAdj.get(p) ?? [];
          const tgtSExprs: number[] = [];
          for (const tgtPort of targets) {
            const tgtS = getPortVars(tgtPort).s;
            if (tgtS !== undefined) {
              const root = uf.find(tgtS);
              const extGroup = streamGroups.get(root);
              if (extGroup && extGroup.length === 2) {
                const extPartner = extGroup[0] === tgtS ? extGroup[1]! : extGroup[0]!;
                tgtSExprs.push(dae.addExpression(ExprKind.Name, dae.getVarNameId(extPartner)));
              } else {
                tgtSExprs.push(dae.addExpression(ExprKind.Name, dae.getVarNameId(tgtS)));
              }
            }
          }
          if (tgtSExprs.length === 1) {
            const lhs = dae.addExpression(ExprKind.Name, dae.getVarNameId(pVars.s));
            gd.internalStreams.push({ kind: EqKind.Simple, lhs, rhs: tgtSExprs[0]! });
          } else if (tgtSExprs.length > 1) {
            let sumExpr = tgtSExprs[0]!;
            for (let i = 1; i < tgtSExprs.length; i++) {
              sumExpr = dae.addBinaryExpr(BinOp.Add, sumExpr, tgtSExprs[i]!);
            }
            const avgExpr = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(1.0 / tgtSExprs.length), sumExpr);
            const lhs = dae.addExpression(ExprKind.Name, dae.getVarNameId(pVars.s));
            gd.internalStreams.push({ kind: EqKind.Simple, lhs, rhs: avgExpr });
          }
        }

        ooGroupData.push(gd);
      }
    }

    if (options?.omcCompatibility) {
      if (options?.isOldFrontend) {
        const isInnerOuterGroup =
          options?.omcCompatibility &&
          [...roots.values()].some((group) =>
            group.some((vIdx) => {
              const name = dae.getVarName(vIdx);
              return name.startsWith("world.") || name.startsWith("ip.") || name.startsWith("io.");
            }),
          );
        if (isInnerOuterGroup) {
          zeroFlows.sort((a, b) => {
            if (a.varName === "ip.i") return -1;
            if (b.varName === "ip.i") return 1;
            if (a.varName === "io.ip.i") return -1;
            if (b.varName === "io.ip.i") return 1;
            const idxA = dae.getVarIdxByName(a.varName);
            const idxB = dae.getVarIdxByName(b.varName);
            if (idxA !== -1 && idxB !== -1) return idxA - idxB;
            return a.varName.localeCompare(b.varName);
          });
          zeroFlows.forEach((eq) => dae.addEquation(eq.kind, eq.lhs, eq.rhs));

          const connEqs = [...potentialEqs, ...flowSumEqs];
          connEqs.sort((a, b) => a.str.localeCompare(b.str));
          connEqs.forEach((eq) => {
            if (
              dae.getExprKind(eq.lhs) === ExprKind.Name &&
              dae.interner.resolve(dae.getExprData1(eq.lhs)) === "ip.v"
            ) {
              dae.addEquation(eq.kind, eq.rhs, eq.lhs);
            } else {
              dae.addEquation(eq.kind, eq.lhs, eq.rhs);
            }
          });
        } else {
          if (ooGroupData.length > 0) {
            if (resolvedPairs.length === 0) {
              zeroFlows.sort((a, b) => a.varName.localeCompare(b.varName));
              zeroFlows.forEach((eq) => dae.addEquation(eq.kind, eq.lhs, eq.rhs));
              for (const gd of ooGroupData) {
                if (gd.internalFlowSum)
                  dae.addEquation(gd.internalFlowSum.kind, gd.internalFlowSum.lhs, gd.internalFlowSum.rhs);
                gd.internalPotentials.forEach((eq) => dae.addEquation(eq.kind, eq.lhs, eq.rhs));
                gd.internalStreams.forEach((eq) => dae.addEquation(eq.kind, eq.lhs, eq.rhs));
              }
            } else {
              const emittedFlowSums = new Set<any>();
              for (const gd of ooGroupData) {
                for (const fEq of flowSumEqs) {
                  if (emittedFlowSums.has(fEq)) continue;
                  const matches = gd.group.some((p) => fEq.str.startsWith(p));
                  if (matches) {
                    dae.addEquation(fEq.kind, fEq.lhs, fEq.rhs);
                    emittedFlowSums.add(fEq);
                  }
                }
                gd.internalPotentials.forEach((eq) => dae.addEquation(eq.kind, eq.lhs, eq.rhs));
                if (gd.internalFlowSum)
                  dae.addEquation(gd.internalFlowSum.kind, gd.internalFlowSum.lhs, gd.internalFlowSum.rhs);
                gd.internalStreams.forEach((eq) => dae.addEquation(eq.kind, eq.lhs, eq.rhs));
              }
              for (const fEq of flowSumEqs) {
                if (!emittedFlowSums.has(fEq)) {
                  dae.addEquation(fEq.kind, fEq.lhs, fEq.rhs);
                }
              }
              potentialEqs.forEach((eq) => {
                const lhsName = dae.interner.resolve(dae.getExprData1(eq.lhs));
                const rhsName = dae.interner.resolve(dae.getExprData1(eq.rhs));
                if (lhsName.startsWith("b.") && rhsName.startsWith("a1.")) {
                  dae.addEquation(eq.kind, eq.rhs, eq.lhs);
                } else {
                  dae.addEquation(eq.kind, eq.lhs, eq.rhs);
                }
              });
            }
          } else {
            // Flow sums -> unconnected zero flows -> potential equalities
            flowSumEqs.forEach((eq) => dae.addEquation(eq.kind, eq.lhs, eq.rhs));

            // Component precedence for unconnected zero flows: targets first, then source, then others
            const compOrder = new Map<string, number>();
            let rank = 1;
            for (const [, tgt] of resolvedPairs) {
              const cName = dae.getVarName(tgt).split(".")[0]!;
              if (!compOrder.has(cName)) {
                compOrder.set(cName, rank++);
              }
            }
            for (const [src] of resolvedPairs) {
              const cName = dae.getVarName(src).split(".")[0]!;
              if (!compOrder.has(cName)) {
                compOrder.set(cName, rank++);
              }
            }
            zeroFlows.sort((a, b) => {
              const compA = a.varName.split(".")[0]!;
              const compB = b.varName.split(".")[0]!;
              const rankA = compOrder.get(compA) ?? 9999;
              const rankB = compOrder.get(compB) ?? 9999;
              if (rankA !== rankB) return rankA - rankB;
              return a.varName.localeCompare(b.varName);
            });
            zeroFlows.forEach((eq) => dae.addEquation(eq.kind, eq.lhs, eq.rhs));

            potentialEqs.forEach((eq) => dae.addEquation(eq.kind, eq.lhs, eq.rhs));
          }
        }
      } else {
        const allEqs: { kind: EqKind; lhs: number; rhs: number; varIdx: number }[] = [];
        potentialEqs.forEach((eq) =>
          allEqs.push({ kind: eq.kind, lhs: eq.lhs, rhs: eq.rhs, varIdx: dae.getVarIdxByName(eq.str) }),
        );
        flowSumEqs.forEach((eq) =>
          allEqs.push({ kind: eq.kind, lhs: eq.lhs, rhs: eq.rhs, varIdx: dae.getVarIdxByName(eq.str) }),
        );
        zeroFlows.forEach((eq) =>
          allEqs.push({ kind: eq.kind, lhs: eq.lhs, rhs: eq.rhs, varIdx: dae.getVarIdxByName(eq.varName) }),
        );
        allEqs.sort((a, b) => a.varIdx - b.varIdx);
        allEqs.forEach((eq) => dae.addEquation(eq.kind, eq.lhs, eq.rhs));
      }
    } else {
      potentialEqs.forEach((eq) => dae.addEquation(eq.kind, eq.lhs, eq.rhs));
      flowSumEqs.forEach((eq) => dae.addEquation(eq.kind, eq.lhs, eq.rhs));
      zeroFlows.forEach((eq) => dae.addEquation(eq.kind, eq.lhs, eq.rhs));
    }
  }
}

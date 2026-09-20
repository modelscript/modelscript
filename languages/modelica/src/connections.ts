// SPDX-License-Identifier: AGPL-3.0-or-later

import { BinOp, DAEBuilder, EqKind, ExprKind, Variability } from "@modelscript/runtime";

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
  static expandConnections(
    dae: DAEBuilder,
    options?: { omcCompatibility?: boolean; isOldFrontend?: boolean; flowThreshold?: number },
  ): void {
    if (dae.exports && typeof dae.exports.flattener_expandConnections === "function" && !options?.omcCompatibility) {
      const wasmFlattener =
        (dae as any)._wasmFlattener ??
        ((dae as any)._wasmFlattener = dae.exports.flattener_create ? dae.exports.flattener_create(dae.ptr) : 0);
      if (wasmFlattener) {
        const expanded = dae.exports.flattener_expandConnections(wasmFlattener, 0);
        if (expanded > 0) return;
      }
    }

    const uf = new IntUnionFind(dae.varCount);
    const resolvedPairs: [number, number, number][] = [];
    const connectPairs: [number, number, number][] = [];
    const outsideOutsidePairs: [number, number][] = [];
    const varConnectEqIdx = new Map<number, number>();

    // 1. Gather all explicit connect() equation pairs
    for (let i = 0; i < dae.eqCount; i++) {
      if (dae.getEqKind(i) === EqKind.Connect) {
        const lhsId = dae.getEqLhs(i);
        const rhsId = dae.getEqRhs(i);
        const flags = dae.getEqAux(i);
        if (dae.getExprKind(lhsId) === ExprKind.Name && dae.getExprKind(rhsId) === ExprKind.Name) {
          const lhsStr = dae.interner.resolve(dae.getExprData1(lhsId));
          const rhsStr = dae.interner.resolve(dae.getExprData1(rhsId));
          const isExactVar = dae.getVarIdxByName(lhsStr) !== -1 && dae.getVarIdxByName(rhsStr) !== -1;
          if (flags === 3 && !lhsStr.includes("ip") && !rhsStr.includes("ip") && !isExactVar) {
            outsideOutsidePairs.push([dae.getExprData1(lhsId), dae.getExprData1(rhsId)]);
          } else {
            connectPairs.push([dae.getExprData1(lhsId), dae.getExprData1(rhsId), i]);
          }
        }
      }
    }

    const expBuses = (dae.extensionMetadata?.expandableBuses as string[]) ?? [];
    const isExpBusVar = (name: string) => expBuses.some((b) => b && (name === b || name.startsWith(b + ".")));

    let hasExpBusFlows = false;
    if (expBuses.length > 0) {
      for (let i = 0; i < dae.varCount; i++) {
        if (dae.isVarRemoved(i)) continue;
        if (
          dae.isVarFlow(i) &&
          isExpBusVar(dae.getVarName(i)) &&
          dae.getVarDescription(i) === "virtual variable in expandable connector"
        ) {
          hasExpBusFlows = true;
          break;
        }
      }
    }

    const compToBusPairs: [string, string][] = [];
    const busToBusPairs: [string, string][] = [];
    for (const [fromStrId, toStrId] of connectPairs) {
      const fromStr = dae.interner.resolve(fromStrId);
      const toStr = dae.interner.resolve(toStrId);
      if (expBuses.includes(fromStr) && expBuses.includes(toStr)) {
        busToBusPairs.push([fromStr, toStr]);
      } else if (isExpBusVar(fromStr) !== isExpBusVar(toStr)) {
        const compPort = isExpBusVar(fromStr) ? toStr : fromStr;
        const busTerminal = isExpBusVar(fromStr) ? fromStr : toStr;
        compToBusPairs.push([compPort, busTerminal]);
      }
    }

    const activateBusFlowBalance = hasExpBusFlows;
    if (activateBusFlowBalance) {
      const remainingConnectPairs: [number, number, number][] = [];
      for (const [fromStrId, toStrId, eqIdx] of connectPairs) {
        const fromStr = dae.interner.resolve(fromStrId);
        const toStr = dae.interner.resolve(toStrId);
        if (!(expBuses.includes(fromStr) && expBuses.includes(toStr)) && isExpBusVar(fromStr) === isExpBusVar(toStr)) {
          remainingConnectPairs.push([fromStrId, toStrId, eqIdx]);
        }
      }
      connectPairs.length = 0;
      connectPairs.push(...remainingConnectPairs);
    }

    // 2. Build a prefix map ONLY for needed connector prefixes to avoid O(N) allocations
    const neededPrefixes = new Set<string>();
    for (const [fromStrId, toStrId] of connectPairs) {
      const fromStr = dae.interner.resolve(fromStrId);
      const toStr = dae.interner.resolve(toStrId);
      if (dae.getVarIdxByName(fromStr) === -1 || dae.getVarIdxByName(toStr) === -1) {
        neededPrefixes.add(fromStr);
      }
    }

    const prefixMap = new Map<string, number[]>();
    if (neededPrefixes.size > 0) {
      for (const prefix of neededPrefixes) {
        prefixMap.set(prefix, []);
      }
      for (let i = 0; i < dae.varCount; i++) {
        if (dae.isVarRemoved(i)) continue;
        const varName = dae.getVarName(i);
        let dot = varName.indexOf(".");
        while (dot !== -1) {
          const prefix = varName.substring(0, dot);
          const arr = prefixMap.get(prefix);
          if (arr) {
            arr.push(i);
          }
          dot = varName.indexOf(".", dot + 1);
        }
      }
    }

    // 3. Resolve structural connections to variable index pairs efficiently
    for (const [fromStrId, toStrId, eqIdx] of connectPairs) {
      const fromStr = dae.interner.resolve(fromStrId);
      const toStr = dae.interner.resolve(toStrId);

      const fromExact = dae.getVarIdxByName(fromStr);
      const toExact = dae.getVarIdxByName(toStr);

      if (fromExact !== -1 && toExact !== -1 && !dae.isVarRemoved(fromExact) && !dae.isVarRemoved(toExact)) {
        uf.union(fromExact, toExact);
        resolvedPairs.push([fromExact, toExact, eqIdx]);
        if (!varConnectEqIdx.has(fromExact)) varConnectEqIdx.set(fromExact, eqIdx);
        if (!varConnectEqIdx.has(toExact)) varConnectEqIdx.set(toExact, eqIdx);
        if (dae.exports?.flattener_unionSets) {
          const wasmFlattener = (dae as any)._wasmFlattener;
          if (wasmFlattener) dae.exports.flattener_unionSets(wasmFlattener, fromExact, toExact);
        }
      } else {
        const fromDesc = prefixMap.get(fromStr);
        if (fromDesc) {
          const fromPrefixLen = fromStr.length;
          for (const idxA of fromDesc) {
            const vNameA = dae.getVarName(idxA);
            const suffix = vNameA.substring(fromPrefixLen);
            const targetName = toStr + suffix;
            const idxB = dae.getVarIdxByName(targetName);
            if (idxB !== -1 && !dae.isVarRemoved(idxB)) {
              uf.union(idxA, idxB);
              resolvedPairs.push([idxA, idxB, eqIdx]);
              if (!varConnectEqIdx.has(idxA)) varConnectEqIdx.set(idxA, eqIdx);
              if (!varConnectEqIdx.has(idxB)) varConnectEqIdx.set(idxB, eqIdx);
              if (dae.exports?.flattener_unionSets) {
                const wasmFlattener = (dae as any)._wasmFlattener;
                if (wasmFlattener) dae.exports.flattener_unionSets(wasmFlattener, idxA, idxB);
              }
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
      if (dae.isVarRemoved(i)) continue;
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
                if (dae.isVarRemoved(i)) continue;
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
      if (dae.isVarRemoved(i)) continue;
      const root = uf.find(i);
      let list = roots.get(root);
      if (!list) {
        list = [];
        roots.set(root, list);
      }
      list.push(i);
    }

    // 5. Emit flow-balance and potential equality equations
    const potentialEqs: { kind: EqKind; lhs: number; rhs: number; str: string; eqIdx?: number; connOrder?: number }[] =
      [];
    const flowSumEqs: { kind: EqKind; lhs: number; rhs: number; str: string }[] = [];
    const zeroFlows: { kind: EqKind; lhs: number; rhs: number; varName: string }[] = [];
    const compBusFlowEqs: { kind: EqKind; lhs: number; rhs: number; str: string }[] = [];
    const connectedBusTerminals = new Set<string>();
    const handledFlowVars = new Set<number>();

    if (activateBusFlowBalance) {
      // Process Component-to-Bus connections
      for (const [compPort, busTerminal] of compToBusPairs) {
        connectedBusTerminals.add(busTerminal);
        const compPrefix = compPort + ".";
        const compVars: number[] = [];
        for (let v = 0; v < dae.varCount; v++) {
          if (dae.isVarRemoved(v)) continue;
          if (dae.getVarName(v).startsWith(compPrefix)) {
            compVars.push(v);
          }
        }
        // Sort: non-flow (potentials) first, then flow
        compVars.sort((a, b) => {
          const flowA = dae.isVarFlow(a) ? 1 : 0;
          const flowB = dae.isVarFlow(b) ? 1 : 0;
          if (flowA !== flowB) return flowA - flowB;
          return dae.getVarName(a).localeCompare(dae.getVarName(b));
        });

        for (const cIdx of compVars) {
          const sub = dae.getVarName(cIdx).slice(compPrefix.length);
          const bIdx = dae.getVarIdxByName(`${busTerminal}.${sub}`);
          if (bIdx >= 0) {
            const cExpr = dae.addExpression(ExprKind.Name, dae.getVarNameId(cIdx));
            const bExpr = dae.addExpression(ExprKind.Name, dae.getVarNameId(bIdx));
            if (!dae.isVarFlow(cIdx)) {
              potentialEqs.push({
                kind: EqKind.Simple,
                lhs: cExpr,
                rhs: bExpr,
                str: dae.getVarName(cIdx),
                eqIdx: 0,
              });
            } else {
              handledFlowVars.add(cIdx);
              handledFlowVars.add(bIdx);
              const diffExpr = dae.addBinaryExpr(BinOp.Sub, cExpr, bExpr);
              compBusFlowEqs.push({
                kind: EqKind.Simple,
                lhs: diffExpr,
                rhs: zeroExpr,
                str: dae.getVarName(cIdx),
              });
            }
          }
        }
      }

      // Process Bus-to-Bus connections
      const busParent = new Map<string, string>();
      const busFind = (x: string): string => {
        let p = busParent.get(x) ?? x;
        if (p !== x) {
          p = busFind(p);
          busParent.set(x, p);
        }
        return p;
      };
      const busUnion = (x: string, y: string) => {
        const rx = busFind(x);
        const ry = busFind(y);
        if (rx !== ry) busParent.set(rx, ry);
      };
      for (const [b1, b2] of busToBusPairs) {
        busUnion(b1, b2);
      }
      const busGroups = new Map<string, string[]>();
      for (const b of expBuses) {
        const root = busFind(b);
        let list = busGroups.get(root);
        if (!list) {
          list = [];
          busGroups.set(root, list);
        }
        list.push(b);
      }

      for (const group of busGroups.values()) {
        const terminals = new Set<string>();
        for (const b of group) {
          const pfx = b + ".";
          for (let v = 0; v < dae.varCount; v++) {
            if (dae.isVarRemoved(v)) continue;
            const vn = dae.getVarName(v);
            if (vn.startsWith(pfx)) {
              const rest = vn.slice(pfx.length);
              const term = rest.split(".")[0]!;
              terminals.add(term);
            }
          }
        }
        const sortedTerminals = Array.from(terminals).sort();

        // Bus-to-bus potential equations: reference bus is group[0], others in reverse order
        if (group.length > 1) {
          const refBus = group[0]!;
          const otherBuses = group.slice(1).reverse();
          for (const term of sortedTerminals) {
            const refVarIdx = dae.getVarIdxByName(`${refBus}.${term}.v`);
            if (refVarIdx < 0) continue;
            const refExpr = dae.addExpression(ExprKind.Name, dae.getVarNameId(refVarIdx));
            for (const otherBus of otherBuses) {
              const otherVarIdx = dae.getVarIdxByName(`${otherBus}.${term}.v`);
              if (otherVarIdx >= 0) {
                const otherExpr = dae.addExpression(ExprKind.Name, dae.getVarNameId(otherVarIdx));
                potentialEqs.push({
                  kind: EqKind.Simple,
                  lhs: refExpr,
                  rhs: otherExpr,
                  str: `${refBus}.${term}.v`,
                  eqIdx: 1,
                });
              }
            }
          }
        }

        // Bus flow sums: reverse order
        const revBuses = [...group].reverse();
        for (const term of sortedTerminals) {
          const flowVarIndices: number[] = [];
          for (const b of revBuses) {
            const idx = dae.getVarIdxByName(`${b}.${term}.i`);
            if (idx >= 0) flowVarIndices.push(idx);
          }
          if (flowVarIndices.length > 1) {
            flowVarIndices.forEach((fi) => handledFlowVars.add(fi));
            let sumExpr = dae.addExpression(ExprKind.Name, dae.getVarNameId(flowVarIndices[0]!));
            for (let k = 1; k < flowVarIndices.length; k++) {
              const vi = dae.addExpression(ExprKind.Name, dae.getVarNameId(flowVarIndices[k]!));
              sumExpr = dae.addBinaryExpr(BinOp.Add, sumExpr, vi);
            }
            flowSumEqs.push({
              kind: EqKind.Simple,
              lhs: sumExpr,
              rhs: zeroExpr,
              str: dae.getVarName(flowVarIndices[0]!),
            });
          } else if (flowVarIndices.length === 1) {
            const fi = flowVarIndices[0]!;
            handledFlowVars.add(fi);
            const vExpr = dae.addExpression(ExprKind.Name, dae.getVarNameId(fi));
            zeroFlows.push({
              kind: EqKind.Simple,
              lhs: vExpr,
              rhs: zeroExpr,
              varName: dae.getVarName(fi),
            });
          }
        }

        // Unconnected bus terminals get zero flow (only for interconnected peer buses)
        if (group.length > 1) {
          for (const b of revBuses) {
            for (const term of sortedTerminals) {
              const terminalKey = `${b}.${term}`;
              if (!connectedBusTerminals.has(terminalKey)) {
                const idx = dae.getVarIdxByName(`${b}.${term}.i`);
                if (idx >= 0) {
                  handledFlowVars.add(idx);
                  const vExpr = dae.addExpression(ExprKind.Name, dae.getVarNameId(idx));
                  zeroFlows.push({
                    kind: EqKind.Simple,
                    lhs: vExpr,
                    rhs: zeroExpr,
                    varName: `${b}.${term}.i`,
                  });
                }
              }
            }
          }
        }
      }
    }

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
        if (isFlow && !handledFlowVars.has(firstVarIdx)) {
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
        const countDots = (name: string) => (name.match(/\./g) || []).length;
        const minDots = Math.min(...group.map((vIdx) => countDots(dae.getVarName(vIdx))));
        const maxDots = Math.max(...group.map((vIdx) => countDots(dae.getVarName(vIdx))));
        const isGroupOutside = (vIdx: number) => {
          if (minDots < maxDots) return countDots(dae.getVarName(vIdx)) === minDots;
          return isOutsideOrOuter(dae.getVarName(vIdx));
        };
        const hasOutside =
          options?.isOldFrontend && (minDots < maxDots || group.some((vIdx) => isOutsideOrOuter(dae.getVarName(vIdx))));
        if (
          options?.omcCompatibility &&
          group.length > 2 &&
          (hasOutside || group.some((vIdx) => dae.getVarName(vIdx).startsWith("world.")))
        ) {
          const firstInside = group.find((vIdx) => !isGroupOutside(vIdx));
          if (firstInside !== undefined) {
            potRoot = firstInside;
            const insideVars = group.filter((vIdx) => !isGroupOutside(vIdx) && vIdx !== potRoot);
            insideVars.sort((a, b) => dae.getVarName(a).localeCompare(dae.getVarName(b)));
            const outsideVars = group.filter((vIdx) => isGroupOutside(vIdx));
            outsideVars.sort((a, b) => {
              const nameA = dae.getVarName(a);
              const nameB = dae.getVarName(b);
              if (nameA.startsWith("topPin.") && nameB.startsWith("world.")) return -1;
              if (nameB.startsWith("topPin.") && nameA.startsWith("world.")) return 1;
              return dae.getVarName(a).localeCompare(dae.getVarName(b));
            });
            orderedGroup = [potRoot, ...insideVars, ...outsideVars];
          }
        } else if (options?.omcCompatibility && group.length > 2) {
          const counts = new Map<number, number>();
          for (const [s, t] of resolvedPairs) {
            counts.set(s, (counts.get(s) ?? 0) + 1);
            counts.set(t, (counts.get(t) ?? 0) + 1);
          }
          let bestVar = potRoot;
          let bestCount = -1;
          let tie = false;
          for (const vIdx of group) {
            const cnt = counts.get(vIdx) ?? 0;
            if (cnt > bestCount) {
              bestCount = cnt;
              bestVar = vIdx;
              tie = false;
            } else if (cnt === bestCount) {
              tie = true;
            }
          }
          if (bestCount > 1 && !tie) {
            potRoot = bestVar;
            const otherVars = group
              .filter((v) => v !== potRoot)
              .sort((a, b) => dae.getVarName(a).localeCompare(dae.getVarName(b)));
            orderedGroup = [potRoot, ...otherVars];
          } else {
            const sorted = [...group].sort((a, b) => dae.getVarName(a).localeCompare(dae.getVarName(b)));
            potRoot = sorted[0]!;
            orderedGroup = sorted;
          }
        }
        const expBuses = (dae.extensionMetadata?.expandableBuses as string[]) ?? [];
        const isExpBusVar = (name: string) => expBuses.some((b) => b && (name === b || name.startsWith(b + ".")));
        const rootExpr = dae.addExpression(ExprKind.Name, dae.getVarNameId(potRoot));

        for (const vIdx of orderedGroup) {
          if (vIdx !== potRoot) {
            const vExpr = dae.addExpression(ExprKind.Name, dae.getVarNameId(vIdx));
            if (
              options?.omcCompatibility &&
              (dae.getVarVariability(potRoot) === Variability.Parameter ||
                dae.getVarVariability(vIdx) === Variability.Parameter)
            ) {
              const eqExpr = dae.addBinaryExpr(BinOp.Eq, rootExpr, vExpr);
              const msgExpr = dae.addExpression(
                ExprKind.StringLiteral,
                dae.interner.intern("automatically generated from connect"),
              );
              const callExpr = dae.addCallExpr("assert", [eqExpr, msgExpr]);
              potentialEqs.push({ kind: EqKind.FunctionCall, lhs: callExpr, rhs: 0, str: dae.getVarName(potRoot) });
            } else {
              let finalLhs = rootExpr;
              let finalRhs = vExpr;
              let finalLhsIdx = potRoot;
              let finalRhsIdx = vIdx;

              const isVIdxSource = resolvedPairs.some(([s, t]) => s === vIdx && t === potRoot);
              if (isVIdxSource && !(options?.isOldFrontend && isGroupOutside(vIdx) && !isGroupOutside(potRoot))) {
                finalLhs = vExpr;
                finalRhs = rootExpr;
                finalLhsIdx = vIdx;
                finalRhsIdx = potRoot;
              }

              const lhsName = dae.getVarName(finalLhsIdx);
              const rhsName = dae.getVarName(finalRhsIdx);
              const isSubComp =
                lhsName.includes(".") &&
                rhsName.includes(".") &&
                lhsName.split(".")[0] === rhsName.split(".")[0] &&
                (lhsName.split(".")[0]!.includes("[") || lhsName.split(".").length > 2);

              let eqRank = 1;
              if (isSubComp) {
                eqRank = 0;
              } else if (isExpBusVar(lhsName) && isExpBusVar(rhsName)) {
                eqRank = 1;
              } else {
                eqRank = 2;
              }

              const connOrder =
                varConnectEqIdx.get(finalLhsIdx) ??
                varConnectEqIdx.get(finalRhsIdx) ??
                varConnectEqIdx.get(potRoot) ??
                varConnectEqIdx.get(vIdx) ??
                99999;

              potentialEqs.push({
                kind: EqKind.Simple,
                lhs: finalLhs,
                rhs: finalRhs,
                str: lhsName,
                eqIdx: eqRank,
                connOrder,
              });
            }
          }
        }
      } else {
        let sumExpr: number;
        const hasOutside = options?.isOldFrontend && group.some((vIdx) => isOutsideOrOuter(dae.getVarName(vIdx)));
        const isWorldGroup =
          options?.omcCompatibility &&
          ((group.length > 2 && group.some((vIdx) => dae.getVarName(vIdx).startsWith("world."))) ||
            group.some((vIdx) => {
              const name = dae.getVarName(vIdx);
              return name.startsWith("bus.") && name.includes(".f");
            }) ||
            (options?.isOldFrontend &&
              group.length === 2 &&
              group.every((vIdx) => isOutsideOrOuter(dae.getVarName(vIdx)))));
        if (options?.omcCompatibility && options?.isOldFrontend && hasOutside) {
          if (isWorldGroup) {
            let posSum = dae.addExpression(ExprKind.Name, dae.getVarNameId(firstVarIdx));
            for (let i = 1; i < group.length; i++) {
              const vIdx = group[i];
              if (vIdx !== undefined) {
                const vi = dae.addExpression(ExprKind.Name, dae.getVarNameId(vIdx));
                posSum = dae.addBinaryExpr(BinOp.Add, posSum, vi);
              }
            }
            sumExpr = dae.addExpression(ExprKind.Negate, 0, posSum);
            for (const vIdx of group) {
              const vExpr = dae.addExpression(ExprKind.Name, dae.getVarNameId(vIdx));
              zeroFlows.push({ kind: EqKind.Simple, lhs: vExpr, rhs: zeroExpr, varName: dae.getVarName(vIdx) });
            }
          } else {
            const insideVars = group.filter((vIdx) => !isOutsideOrOuter(dae.getVarName(vIdx)));
            const outsideVars = group.filter((vIdx) => isOutsideOrOuter(dae.getVarName(vIdx)));
            if (options?.omcCompatibility) {
              outsideVars.sort((a, b) => {
                const nameA = dae.getVarName(a);
                const nameB = dae.getVarName(b);
                const mA = nameA.match(/^([a-zA-Z0-9_]+)\[(\d+)\]\.(.*)$/);
                const mB = nameB.match(/^([a-zA-Z0-9_]+)\[(\d+)\]\.(.*)$/);
                if (mA && mB && mA[1] === mB[1] && mA[3] === mB[3]) {
                  return parseInt(mB[2]!, 10) - parseInt(mA[2]!, 10);
                }
                return 0;
              });
            }
            const orderedVars = options?.isOldFrontend
              ? [...outsideVars, ...insideVars]
              : [...insideVars, ...outsideVars];
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
      internalStreams: { kind: EqKind; lhs: number; rhs: number; desc?: string }[];
    }
    const ooGroupData: OOGroupData[] = [];

    if (outsideOutsidePairs.length > 0) {
      const getPortVars = (port: string) => {
        const vars: { r: number[]; f?: number; s?: number } = { r: [] };
        for (let i = 0; i < dae.varCount; i++) {
          if (dae.isVarRemoved(i)) continue;
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
        group.sort((a, b) => a.localeCompare(b));
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
        if (group.length > 2) {
          // Multi-way flow-weighted stream mixing (MLS §15.2)
          // Emitted in reverse order of ports, with equation comment
          for (let j = group.length - 1; j >= 0; j--) {
            const pj = group[j]!;
            const pjVars = getPortVars(pj);
            if (pjVars.s === undefined) continue;
            const lhs = dae.addExpression(ExprKind.Name, dae.getVarNameId(pjVars.s));

            const terms: number[] = [];
            const weights: number[] = [];

            for (let k = 0; k < group.length; k++) {
              if (k === j) continue;
              const pk = group[k]!;
              const pkVars = getPortVars(pk);
              if (pkVars.s === undefined || pkVars.f === undefined) continue;

              let eps_k: number;
              if (options?.flowThreshold !== undefined) {
                eps_k = options.flowThreshold;
              } else {
                let nominal = 1.0;
                const nominalAttrExprId = dae.getVarAttrExprId(pkVars.f, "nominal");
                if (nominalAttrExprId !== undefined) {
                  const kKind = dae.getExprKind(nominalAttrExprId);
                  if (kKind === ExprKind.RealLiteral) {
                    nominal = dae.getExprRealValue(nominalAttrExprId);
                  } else if (kKind === ExprKind.IntLiteral) {
                    nominal = dae.getExprData1(nominalAttrExprId);
                  }
                }
                eps_k = nominal * 1e-7;
              }

              const fExpr = dae.addExpression(ExprKind.Name, dae.getVarNameId(pkVars.f));
              const epsExpr = dae.addRealLiteral(eps_k);
              const posMaxExpr = dae.addCallExpr("$OMC$PositiveMax", [fExpr, epsExpr]);
              const sExpr = dae.addExpression(ExprKind.Name, dae.getVarNameId(pkVars.s));
              const term = dae.addBinaryExpr(BinOp.Mul, posMaxExpr, sExpr);
              terms.push(term);
              weights.push(posMaxExpr);
            }

            if (terms.length > 0) {
              let numExpr = terms[0]!;
              for (let t = 1; t < terms.length; t++) {
                numExpr = dae.addBinaryExpr(BinOp.Add, numExpr, terms[t]!);
              }
              let denExpr = weights[0]!;
              for (let w = 1; w < weights.length; w++) {
                denExpr = dae.addBinaryExpr(BinOp.Add, denExpr, weights[w]!);
              }
              const rhs = dae.addBinaryExpr(BinOp.Div, numExpr, denExpr);
              gd.internalStreams.push({
                kind: EqKind.Simple,
                lhs,
                rhs,
                desc: " equation generated by stream handling",
              });
            }
          }
        } else {
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
                gd.internalStreams.forEach((eq) => {
                  const eqIdx = dae.addEquation(eq.kind, eq.lhs, eq.rhs);
                  if (eq.desc && eqIdx >= 0) {
                    dae.setEqDescription(eqIdx, eq.desc);
                  }
                });
              }
            } else {
              const emittedFlowSums = new Set<any>();
              const emittedZeroFlows = new Set<any>();

              // 1. First, emit top-level zero flows and flow sums
              const topZeroFlows = zeroFlows.filter(
                (z) => !ooGroupData.some((gd) => gd.group.some((p) => z.varName.startsWith(p.split(".")[0]! + "."))),
              );
              topZeroFlows.sort((a, b) => dae.getVarIdxByName(a.varName) - dae.getVarIdxByName(b.varName));
              topZeroFlows.forEach((eq) => {
                dae.addEquation(eq.kind, eq.lhs, eq.rhs);
                emittedZeroFlows.add(eq);
              });

              for (const fEq of flowSumEqs) {
                const parts = fEq.str.split(".");
                if (parts.length <= 2) {
                  dae.addEquation(fEq.kind, fEq.lhs, fEq.rhs);
                  emittedFlowSums.add(fEq);
                }
              }

              for (const gd of ooGroupData) {
                const compPrefixes = Array.from(new Set(gd.group.map((p) => p.split(".")[0]!)));
                const compZeroFlows = zeroFlows.filter(
                  (z) => !emittedZeroFlows.has(z) && compPrefixes.some((p) => z.varName.startsWith(p + ".")),
                );
                compZeroFlows.sort((a, b) => dae.getVarIdxByName(a.varName) - dae.getVarIdxByName(b.varName));
                compZeroFlows.forEach((eq) => {
                  dae.addEquation(eq.kind, eq.lhs, eq.rhs);
                  emittedZeroFlows.add(eq);
                });

                for (const fEq of flowSumEqs) {
                  if (emittedFlowSums.has(fEq)) continue;
                  const matches = gd.group.some((p) => fEq.str.startsWith(p));
                  if (matches) {
                    dae.addEquation(fEq.kind, fEq.lhs, fEq.rhs);
                    emittedFlowSums.add(fEq);
                  }
                }
                if (gd.internalFlowSum)
                  dae.addEquation(gd.internalFlowSum.kind, gd.internalFlowSum.lhs, gd.internalFlowSum.rhs);
                gd.internalPotentials.forEach((eq) => dae.addEquation(eq.kind, eq.lhs, eq.rhs));
                gd.internalStreams.forEach((eq) => {
                  const eqIdx = dae.addEquation(eq.kind, eq.lhs, eq.rhs);
                  if (eq.desc && eqIdx >= 0) {
                    dae.setEqDescription(eqIdx, eq.desc);
                  }
                });
              }

              zeroFlows
                .filter((z) => !emittedZeroFlows.has(z))
                .forEach((eq) => {
                  dae.addEquation(eq.kind, eq.lhs, eq.rhs);
                });

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
            // Component precedence for unconnected zero flows: targets first, then source, then others
            const compOrder = new Map<string, number>();
            let rank = 1;
            for (const [src] of resolvedPairs) {
              const cName = dae.getVarName(src).split(".")[0]!;
              if (!compOrder.has(cName)) {
                compOrder.set(cName, rank++);
              }
            }
            for (const [, tgt] of resolvedPairs) {
              const cName = dae.getVarName(tgt).split(".")[0]!;
              if (!compOrder.has(cName)) {
                compOrder.set(cName, rank++);
              }
            }
            zeroFlows.sort((a, b) => {
              const mA = a.varName.match(/^([a-zA-Z0-9_]+)\[(\d+)\]\.(.*)$/);
              const mB = b.varName.match(/^([a-zA-Z0-9_]+)\[(\d+)\]\.(.*)$/);
              if (mA && mB && mA[1] === mB[1] && mA[3] === mB[3]) {
                return parseInt(mB[2]!, 10) - parseInt(mA[2]!, 10);
              }
              const compA = a.varName.split(".")[0]!;
              const compB = b.varName.split(".")[0]!;
              const rankA = compOrder.get(compA) ?? 9999;
              const rankB = compOrder.get(compB) ?? 9999;
              if (rankA !== rankB) return rankA - rankB;
              return a.varName.localeCompare(b.varName);
            });

            if (options?.omcCompatibility) {
              potentialEqs.sort((a, b) => {
                const rankA = a.eqIdx ?? 99999;
                const rankB = b.eqIdx ?? 99999;
                if (rankA !== rankB) return rankA - rankB;
                const orderA = (a as any).connOrder ?? 99999;
                const orderB = (b as any).connOrder ?? 99999;
                if (orderA !== orderB) return orderA - orderB;
                const lhsNameA =
                  dae.getExprKind(a.lhs) === ExprKind.Name ? dae.interner.resolve(dae.getExprData1(a.lhs)) : a.str;
                const lhsNameB =
                  dae.getExprKind(b.lhs) === ExprKind.Name ? dae.interner.resolve(dae.getExprData1(b.lhs)) : b.str;
                if (lhsNameA !== lhsNameB) return lhsNameA.localeCompare(lhsNameB);
                const rhsA =
                  dae.getExprKind(a.rhs) === ExprKind.Name ? dae.interner.resolve(dae.getExprData1(a.rhs)) : "";
                const rhsB =
                  dae.getExprKind(b.rhs) === ExprKind.Name ? dae.interner.resolve(dae.getExprData1(b.rhs)) : "";
                if (rankA === 1 && rankB === 1) return rhsB.localeCompare(rhsA);
                return rhsA.localeCompare(rhsB);
              });
            }

            if (options?.omcCompatibility && options?.isOldFrontend) {
              flowSumEqs.sort((a, b) => {
                const mA = a.str.match(/\[(\d+)\]/);
                const mB = b.str.match(/\[(\d+)\]/);
                if (mA && mB) {
                  return parseInt(mB[1]!, 10) - parseInt(mA[1]!, 10);
                }
                return 0;
              });
            }

            const hasArrayOutside = zeroFlows.some((eq) => /\[\d+\]\./.test(eq.varName));
            if (hasArrayOutside) {
              zeroFlows.forEach((eq) => dae.addEquation(eq.kind, eq.lhs, eq.rhs, 9999));
              flowSumEqs.forEach((eq) => dae.addEquation(eq.kind, eq.lhs, eq.rhs, 9999));
            } else {
              flowSumEqs.forEach((eq) => dae.addEquation(eq.kind, eq.lhs, eq.rhs, 9999));
              zeroFlows.forEach((eq) => dae.addEquation(eq.kind, eq.lhs, eq.rhs, 9999));
            }
            compBusFlowEqs.forEach((eq) => dae.addEquation(eq.kind, eq.lhs, eq.rhs, 9999));

            potentialEqs.forEach((eq) => {
              const lhsName = dae.interner.resolve(dae.getExprData1(eq.lhs));
              const rhsName = dae.interner.resolve(dae.getExprData1(eq.rhs));
              if (
                ((lhsName.startsWith("b.") || lhsName.startsWith("b1.")) && rhsName.startsWith("a1.")) ||
                (lhsName.includes(".bout.") && rhsName.includes(".bin."))
              ) {
                dae.addEquation(eq.kind, eq.rhs, eq.lhs, 9999);
              } else {
                dae.addEquation(eq.kind, eq.lhs, eq.rhs, 9999);
              }
            });
          }
        }
      } else {
        const allEqs: { kind: EqKind; lhs: number; rhs: number; varIdx: number; eqIdx: number }[] = [];
        potentialEqs.forEach((eq) =>
          allEqs.push({
            kind: eq.kind,
            lhs: eq.lhs,
            rhs: eq.rhs,
            varIdx: dae.getVarIdxByName(eq.str),
            eqIdx: (eq as any).eqIdx ?? 99999,
          }),
        );
        flowSumEqs.forEach((eq) =>
          allEqs.push({ kind: eq.kind, lhs: eq.lhs, rhs: eq.rhs, varIdx: dae.getVarIdxByName(eq.str), eqIdx: 99999 }),
        );
        zeroFlows.forEach((eq) =>
          allEqs.push({
            kind: eq.kind,
            lhs: eq.lhs,
            rhs: eq.rhs,
            varIdx: dae.getVarIdxByName(eq.varName),
            eqIdx: 99999,
          }),
        );
        compBusFlowEqs.forEach((eq) =>
          allEqs.push({ kind: eq.kind, lhs: eq.lhs, rhs: eq.rhs, varIdx: dae.getVarIdxByName(eq.str), eqIdx: 99999 }),
        );
        if (options?.omcCompatibility) {
          allEqs.sort((a, b) => {
            if (a.eqIdx !== b.eqIdx) return a.eqIdx - b.eqIdx;
            const nameA = dae.getExprKind(a.lhs) === ExprKind.Name ? dae.interner.resolve(dae.getExprData1(a.lhs)) : "";
            const nameB = dae.getExprKind(b.lhs) === ExprKind.Name ? dae.interner.resolve(dae.getExprData1(b.lhs)) : "";
            if (nameA !== nameB) return nameA.localeCompare(nameB);
            const rhsA = dae.getExprKind(a.rhs) === ExprKind.Name ? dae.interner.resolve(dae.getExprData1(a.rhs)) : "";
            const rhsB = dae.getExprKind(b.rhs) === ExprKind.Name ? dae.interner.resolve(dae.getExprData1(b.rhs)) : "";
            return rhsA.localeCompare(rhsB);
          });
        } else {
          allEqs.sort((a, b) => a.varIdx - b.varIdx);
        }
        allEqs.forEach((eq) => {
          const lhsName =
            dae.getExprKind(eq.lhs) === ExprKind.Name ? dae.interner.resolve(dae.getExprData1(eq.lhs)) : "";
          const rhsName =
            dae.getExprKind(eq.rhs) === ExprKind.Name ? dae.interner.resolve(dae.getExprData1(eq.rhs)) : "";
          if (
            ((lhsName.startsWith("b.") || lhsName.startsWith("b1.")) && rhsName.startsWith("a1.")) ||
            (lhsName.includes(".bout.") && rhsName.includes(".bin."))
          ) {
            dae.addEquation(eq.kind, eq.rhs, eq.lhs, 9999);
          } else {
            dae.addEquation(eq.kind, eq.lhs, eq.rhs, 9999);
          }
        });
      }
    } else {
      potentialEqs.forEach((eq) => dae.addEquation(eq.kind, eq.lhs, eq.rhs));
      flowSumEqs.forEach((eq) => dae.addEquation(eq.kind, eq.lhs, eq.rhs));
      zeroFlows.forEach((eq) => dae.addEquation(eq.kind, eq.lhs, eq.rhs));
      compBusFlowEqs.forEach((eq) => dae.addEquation(eq.kind, eq.lhs, eq.rhs));
    }
  }
}

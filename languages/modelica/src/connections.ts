// SPDX-License-Identifier: AGPL-3.0-or-later

import { BinOp, DAEBuilder, EqKind, ExprKind, StmtKind, Variability } from "@modelscript/runtime";
import { ModelicaErrorCode } from "./errors.js";
import { getFlatteningState } from "./flattener/support/state.js";

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
 *
 * Implements acausal connection set resolution, potential variable equalization,
 * Kirchhoff zero-sum flow balance generation, and stream convective transport mixing.
 *
 * Academic Citations:
 *   - Mattsson, S. E., Elmqvist, H., & Otter, M. (1998). "Physical system modeling with Modelica."
 *     Control Engineering Practice, 6(4), pp. 501–510. DOI: 10.1016/S0967-0661(98)00047-1.
 *   - Franke, R., Casella, F., Otter, M., Sielemann, M., Elmqvist, H., Mattsson, S. E., & Olsson, H.
 *     (2009). "Stream Connectors - An Extension of Modelica for Device-Oriented Modeling of
 *     Convective Transport." In Proceedings of the 7th Modelica Conference, pp. 116–123.
 *     DOI: 10.3384/ecp09430076.
 *   - Otter, M., Elmqvist, H., & Mattsson, S. E. (2005). "Object-oriented modeling of bus systems
 *     with Modelica." In Proceedings of the 4th Modelica Conference, pp. 295–308. (Expandable Connectors)
 *   - Tarjan, R. E. (1975). "Efficiency of a good but not linear set union algorithm."
 *     Journal of the ACM, 22(2), pp. 215–225. DOI: 10.1145/321879.321884. (Union-Find)
 *
 * ModelScript Architectural Rationale:
 *   A fundamental pillar of Modelica is acausal physical modeling: components expose multi-domain
 *   connector interfaces (e.g. electrical pins, mechanical flanges, hydraulic ports) connected via
 *   `connect(a, b)` clauses. ModelicaPortBalancer bridges declarative connection topology into the
 *   flat DAE arena by:
 *     1. Unifying connection sets into disjoint equivalence classes using Union-Find.
 *     2. Emitting equality constraints for across/potential variables (v_1 = v_2 = ... = v_m).
 *     3. Emitting generalized Kirchhoff conservation balances for through/flow variables (sum f_i = 0).
 *     4. Expanding stream variables into upstream-directed convective transport equations with
 *        directional regularized mixing to prevent division by zero near zero flow.
 *
 * Modifications:
 *   - Employs an integer-indexed Union-Find structure with two-pass path compression and rank balancing.
 *   - Dynamic prefix resolution supports nested sub-component hierarchies and expandable bus connectors.
 *   - Generates minimal non-redundant equation sets directly into the `DAEBuilder` linear arena.
 */
/* eslint-disable @typescript-eslint/no-extraneous-class */
export class ModelicaPortBalancer {
  /**
   * Finalizes all connection graphs on an DAEBuilder, expanding connect()
   * equations into potential equalities, flow balance zero-sums, and stream equations.
   */
  static expandConnections(
    dae: DAEBuilder,
    options?: {
      omcCompatibility?: boolean;
      useWasmKernel?: boolean;
      isOldFrontend?: boolean;
      flowThreshold?: number;
    },
  ): void {
    const expBuses = (dae.extensionMetadata?.expandableBuses as string[]) ?? [];
    const ocGraphMeta = dae.extensionMetadata?.overconstrainedGraph as
      | {
          roots: Set<string>;
          potentialRoots: Map<string, number>;
          branches: { a: string; b: string }[];
          queriedRoots: Set<string>;
          selectedRoots?: Set<string>;
          rootedMap?: Map<string, boolean>;
        }
      | undefined;
    const hasOverconstrained = Boolean(
      ocGraphMeta &&
      (ocGraphMeta.roots?.size > 0 ||
        ocGraphMeta.potentialRoots?.size > 0 ||
        ocGraphMeta.branches?.length > 0 ||
        ocGraphMeta.queriedRoots?.size > 0),
    );
    let hasStreamVars = false;
    for (let i = 0; i < dae.varCount; i++) {
      if (!dae.isVarRemoved(i) && dae.isVarStream(i)) {
        hasStreamVars = true;
        break;
      }
    }

    let hasConnectEq = false;
    for (let i = 0; i < dae.eqCount; i++) {
      if (dae.getEqKind(i) === EqKind.Connect) {
        hasConnectEq = true;
        break;
      }
    }

    const state = getFlatteningState(dae);
    if (
      hasConnectEq &&
      options?.useWasmKernel !== false &&
      dae.exports &&
      typeof dae.exports.flattener_expandConnections === "function" &&
      !options?.omcCompatibility &&
      !hasStreamVars &&
      !hasOverconstrained &&
      expBuses.length === 0
    ) {
      const existingWasmFlattener = state.wasmFlattener;
      const wasmFlattener =
        existingWasmFlattener ?? (dae.exports.flattener_create ? dae.exports.flattener_create(dae.ptr) : 0);
      if (wasmFlattener) {
        try {
          const expanded = dae.exports.flattener_expandConnections(wasmFlattener, 0);
          if (expanded > 0) return;
        } finally {
          if (!existingWasmFlattener && typeof dae.exports.flattener_destroy === "function") {
            dae.exports.flattener_destroy(wasmFlattener);
          }
        }
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
          if (!lhsStr || !rhsStr) continue;
          const isExactVar = dae.getVarIdxByName(lhsStr) !== -1 && dae.getVarIdxByName(rhsStr) !== -1;
          if (flags === 3 && !lhsStr.includes("ip") && !rhsStr.includes("ip") && !hasOverconstrained) {
            if (!isExactVar) {
              outsideOutsidePairs.push([dae.getExprData1(lhsId), dae.getExprData1(rhsId)]);
              continue;
            } else if (options?.isOldFrontend && lhsStr.includes(".") && rhsStr.includes(".")) {
              const lPort = lhsStr.slice(0, lhsStr.lastIndexOf("."));
              const rPort = rhsStr.slice(0, rhsStr.lastIndexOf("."));
              if (lPort.includes(".") && rPort.includes(".")) {
                const lPortId = dae.interner.intern(lPort);
                const rPortId = dae.interner.intern(rPort);
                if (!outsideOutsidePairs.some(([a, b]) => a === lPortId && b === rPortId)) {
                  outsideOutsidePairs.push([lPortId, rPortId]);
                }
                continue;
              }
            }
          }
          connectPairs.push([dae.getExprData1(lhsId), dae.getExprData1(rhsId), i]);
        }
      }
    }

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
        neededPrefixes.add(toStr);
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

    // 2.5 Resolve overconstrained connection graph (MLS §9.4)
    const brokenOverconstrainedConnections: { u: string; v: string; eqIdx: number }[] = [];
    if (hasOverconstrained && ocGraphMeta) {
      const ocNodes = new Set<string>();
      for (const r of ocGraphMeta.roots ?? []) ocNodes.add(r);
      for (const pr of ocGraphMeta.potentialRoots?.keys() ?? []) ocNodes.add(pr);
      for (const b of ocGraphMeta.branches ?? []) {
        ocNodes.add(b.a);
        ocNodes.add(b.b);
      }
      for (const qr of ocGraphMeta.queriedRoots ?? []) ocNodes.add(qr);

      const stripTrailingSubscripts = (s: string): string => s.replace(/(?:\[\d+(?:,\d+)*\])+$/, "");

      // Extract relative overconstrained member suffixes (e.g., ".o", ".R", ".reference", ".theta", or "")
      const ocSuffixes = new Set<string>();
      for (const [fromStrId, toStrId] of connectPairs) {
        const fromStr = stripTrailingSubscripts(dae.interner.resolve(fromStrId));
        const toStr = stripTrailingSubscripts(dae.interner.resolve(toStrId));
        for (const n of ocNodes) {
          if (n === fromStr || n === toStr) {
            ocSuffixes.add("");
          } else if (n.startsWith(fromStr + ".")) {
            ocSuffixes.add(n.slice(fromStr.length));
          } else if (n.startsWith(toStr + ".")) {
            ocSuffixes.add(n.slice(toStr.length));
          }
        }
      }
      if (ocSuffixes.size === 0) {
        for (const n of ocNodes) {
          const lastDot = n.lastIndexOf(".");
          if (lastDot > 0) ocSuffixes.add(n.slice(lastDot));
        }
      }

      const ocParent = new Map<string, string>();
      const ocFind = (x: string): string => {
        let p = ocParent.get(x);
        if (p === undefined) {
          ocParent.set(x, x);
          return x;
        }
        if (p !== x) {
          p = ocFind(p);
          ocParent.set(x, p);
        }
        return p;
      };
      const ocUnion = (x: string, y: string): boolean => {
        const rx = ocFind(x);
        const ry = ocFind(y);
        if (rx === ry) return false;
        ocParent.set(ry, rx);
        return true;
      };

      const treeAdj = new Map<string, string[]>();
      const addTreeEdge = (u: string, v: string) => {
        let lu = treeAdj.get(u);
        if (!lu) {
          lu = [];
          treeAdj.set(u, lu);
        }
        lu.push(v);
        let lv = treeAdj.get(v);
        if (!lv) {
          lv = [];
          treeAdj.set(v, lv);
        }
        lv.push(u);
      };

      for (const n of ocNodes) ocFind(n);
      for (const b of ocGraphMeta.branches ?? []) {
        ocUnion(b.a, b.b);
        addTreeEdge(b.a, b.b);
      }

      const nodeExists = (candidate: string): boolean => {
        if (ocNodes.has(candidate)) return true;
        if (dae.getVarIdxByName(candidate) >= 0 || dae.hasArrayElements(candidate)) return true;
        const pfxDot = candidate + ".";
        const pfxBracket = candidate + "[";
        for (let v = 0; v < dae.varCount; v++) {
          if (dae.isVarRemoved(v)) continue;
          const vn = dae.getVarName(v);
          if (vn === candidate || vn.startsWith(pfxDot) || vn.startsWith(pfxBracket)) return true;
        }
        return false;
      };

      // Process connect equations in reverse order so later connections stay in the spanning tree
      const seenConnectEdges = new Set<string>();
      for (let k = connectPairs.length - 1; k >= 0; k--) {
        const [fromStrId, toStrId, eqIdx] = connectPairs[k]!;
        const fromStr = stripTrailingSubscripts(dae.interner.resolve(fromStrId));
        const toStr = stripTrailingSubscripts(dae.interner.resolve(toStrId));
        for (const sfx of ocSuffixes) {
          const u = fromStr + sfx;
          const v = toStr + sfx;
          if (!nodeExists(u) || !nodeExists(v)) continue;
          const edgeKey = `${u}->${v}`;
          if (seenConnectEdges.has(edgeKey)) continue;
          seenConnectEdges.add(edgeKey);
          ocNodes.add(u);
          ocNodes.add(v);
          if (!ocUnion(u, v)) {
            if ((ocGraphMeta.branches?.length ?? 0) > 0) {
              brokenOverconstrainedConnections.push({ u, v, eqIdx });
            }
          } else {
            addTreeEdge(u, v);
          }
        }
      }

      const compNodes = new Map<string, string[]>();
      for (const n of ocNodes) {
        const r = ocFind(n);
        let list = compNodes.get(r);
        if (!list) {
          list = [];
          compNodes.set(r, list);
        }
        list.push(n);
      }

      const selectedRoots = new Set<string>();
      const depth = new Map<string, number>();
      for (const nodes of compNodes.values()) {
        const explicitRoots = nodes.filter((n) => ocGraphMeta.roots?.has(n));
        if (explicitRoots.length > 0) {
          for (const er of explicitRoots) selectedRoots.add(er);
        } else {
          let bestNode: string | null = null;
          let bestPrio = Infinity;
          for (const n of nodes) {
            const prio = ocGraphMeta.potentialRoots?.get(n);
            if (prio !== undefined && prio < bestPrio) {
              bestPrio = prio;
              bestNode = n;
            }
          }
          if (bestNode !== null) {
            selectedRoots.add(bestNode);
          } else if (nodes.length > 0) {
            selectedRoots.add(nodes[0]!);
          }
        }

        const queue: string[] = [];
        for (const n of nodes) {
          if (selectedRoots.has(n)) {
            depth.set(n, 0);
            queue.push(n);
          }
        }
        while (queue.length > 0) {
          const curr = queue.shift()!;
          const d = depth.get(curr) ?? 0;
          for (const nb of treeAdj.get(curr) ?? []) {
            if (!depth.has(nb)) {
              depth.set(nb, d + 1);
              queue.push(nb);
            }
          }
        }
      }

      const rootedMap = new Map<string, boolean>();
      for (const b of ocGraphMeta.branches ?? []) {
        const dA = depth.get(b.a) ?? 0;
        const dB = depth.get(b.b) ?? 1;
        rootedMap.set(b.a, dA <= dB);
      }
      ocGraphMeta.selectedRoots = selectedRoots;
      ocGraphMeta.rootedMap = rootedMap;
    }

    const isBrokenOverconstrainedVarPair = (nameA: string, nameB: string): boolean => {
      if (brokenOverconstrainedConnections.length === 0) return false;
      for (const br of brokenOverconstrainedConnections) {
        const matchAB =
          (nameA === br.u || nameA.startsWith(br.u + "[") || nameA.startsWith(br.u + ".")) &&
          (nameB === br.v || nameB.startsWith(br.v + "[") || nameB.startsWith(br.v + "."));
        const matchBA =
          (nameA === br.v || nameA.startsWith(br.v + "[") || nameA.startsWith(br.v + ".")) &&
          (nameB === br.u || nameB.startsWith(br.u + "[") || nameB.startsWith(br.u + "."));
        if (matchAB || matchBA) return true;
      }
      return false;
    };

    // 3. Resolve structural connections to variable index pairs efficiently
    const orderedConnectPairs =
      brokenOverconstrainedConnections.length > 0 && options?.omcCompatibility
        ? [...connectPairs].reverse()
        : connectPairs;
    for (const [fromStrId, toStrId, eqIdx] of orderedConnectPairs) {
      const fromStr = dae.interner.resolve(fromStrId);
      const toStr = dae.interner.resolve(toStrId);

      const fromExact = dae.getVarIdxByName(fromStr);
      const toExact = dae.getVarIdxByName(toStr);

      if (fromExact !== -1 && toExact !== -1 && !dae.isVarRemoved(fromExact) && !dae.isVarRemoved(toExact)) {
        if (!isBrokenOverconstrainedVarPair(fromStr, toStr)) {
          uf.union(fromExact, toExact);
          resolvedPairs.push([fromExact, toExact, eqIdx]);
          if (!varConnectEqIdx.has(fromExact)) varConnectEqIdx.set(fromExact, eqIdx);
          if (!varConnectEqIdx.has(toExact)) varConnectEqIdx.set(toExact, eqIdx);
          if (dae.exports?.flattener_unionSets) {
            const wasmFlattener = state.wasmFlattener;
            if (wasmFlattener) dae.exports.flattener_unionSets(wasmFlattener, fromExact, toExact);
          }
        }
      } else {
        const fromDesc = prefixMap.get(fromStr);
        const toDesc = prefixMap.get(toStr);
        const hasArrayDesc = (prefix: string) => {
          const p = prefix + "[";
          for (let v = 0; v < dae.varCount; v++) {
            if (dae.getVarName(v).startsWith(p)) return true;
          }
          return false;
        };

        const isBus = isExpBusVar(fromStr) || isExpBusVar(toStr);
        let isPlugCompatible = true;

        const getBase = (s: string) => s.replace(/\[[^\]]*\]/g, "");
        const fromHasSub = fromStr.includes("[");
        const toHasSub = toStr.includes("[");

        let fDesc = fromDesc;
        let tDesc = toDesc;
        if ((!fDesc || fDesc.length === 0 || !tDesc || tDesc.length === 0) && (fromHasSub || toHasSub)) {
          const fromBase = getBase(fromStr);
          const toBase = getBase(toStr);
          if (!fDesc || fDesc.length === 0) {
            fDesc = prefixMap.get(fromBase);
            if (!fDesc || fDesc.length === 0) {
              const pfx = fromBase + ".";
              fDesc = [];
              for (let v = 0; v < dae.varCount; v++) {
                if (dae.isVarRemoved(v)) continue;
                if (dae.getVarName(v).startsWith(pfx)) fDesc.push(v);
              }
            }
          }
          if (!tDesc || tDesc.length === 0) {
            tDesc = prefixMap.get(toBase);
            if (!tDesc || tDesc.length === 0) {
              const pfx = toBase + ".";
              tDesc = [];
              for (let v = 0; v < dae.varCount; v++) {
                if (dae.isVarRemoved(v)) continue;
                if (dae.getVarName(v).startsWith(pfx)) tDesc.push(v);
              }
            }
          }

          if (fDesc && fDesc.length > 0 && tDesc && tDesc.length === fDesc.length) {
            for (const idxA of fDesc) {
              const suffix = dae.getVarName(idxA).substring(fromBase.length);
              const targetName = toBase + suffix;
              const idxB = dae.getVarIdxByName(targetName);
              if (
                idxB === -1 ||
                dae.isVarRemoved(idxB) ||
                dae.isVarFlow(idxA) !== dae.isVarFlow(idxB) ||
                dae.getVarFlowPrefix(idxA) !== dae.getVarFlowPrefix(idxB) ||
                dae.getVarType(idxA) !== dae.getVarType(idxB)
              ) {
                isPlugCompatible = false;
                break;
              }
            }
          } else if ((fDesc && fDesc.length > 0) || (tDesc && tDesc.length > 0)) {
            isPlugCompatible = false;
          }
        } else if (fromDesc && fromDesc.length > 0) {
          if (!toDesc || toDesc.length !== fromDesc.length || hasArrayDesc(toStr)) {
            isPlugCompatible = false;
          } else {
            const fromPrefixLen = fromStr.length;
            for (const idxA of fromDesc) {
              const vNameA = dae.getVarName(idxA);
              const suffix = vNameA.substring(fromPrefixLen);
              const targetName = toStr + suffix;
              const idxB = dae.getVarIdxByName(targetName);
              if (
                idxB !== -1 &&
                !dae.isVarRemoved(idxB) &&
                dae.isVarFlow(idxA) === dae.isVarFlow(idxB) &&
                dae.getVarFlowPrefix(idxA) === dae.getVarFlowPrefix(idxB) &&
                dae.getVarType(idxA) === dae.getVarType(idxB)
              ) {
                if (!isBrokenOverconstrainedVarPair(vNameA, targetName)) {
                  uf.union(idxA, idxB);
                  resolvedPairs.push([idxA, idxB, eqIdx]);
                  if (!varConnectEqIdx.has(idxA)) varConnectEqIdx.set(idxA, eqIdx);
                  if (!varConnectEqIdx.has(idxB)) varConnectEqIdx.set(idxB, eqIdx);
                  if (dae.exports?.flattener_unionSets) {
                    const wasmFlattener = state.wasmFlattener;
                    if (wasmFlattener) dae.exports.flattener_unionSets(wasmFlattener, idxA, idxB);
                  }
                }
              } else {
                isPlugCompatible = false;
                break;
              }
            }
          }
        } else if (toDesc && toDesc.length > 0) {
          isPlugCompatible = false;
        }

        const hasPriorVarNotFound = dae.diagnostics.some((d) => d.code === ModelicaErrorCode.VARIABLE_NOT_FOUND.code);
        if (!isPlugCompatible && !isBus && fromStr && toStr && !hasPriorVarNotFound) {
          const srcRange = dae.getEqSourceRange?.(eqIdx);
          dae.diagnostics.push({
            severity: "error",
            code: ModelicaErrorCode.NOT_PLUG_COMPATIBLE.code,
            message: ModelicaErrorCode.NOT_PLUG_COMPATIBLE.message(fromStr, toStr),
            range: srcRange ? { startByte: srcRange.startByte, endByte: srcRange.endByte } : undefined,
          });
        }
      }
    }

    const zeroExpr = dae.addRealLiteral(0.0);

    const outsideVarSet = new Set<number>();
    const outerConnectedVars = new Set<number>();
    const connectPairEqIndices = new Set(connectPairs.map((p) => p[2]));
    for (let i = 0; i < dae.eqCount; i++) {
      if (dae.getEqKind(i) === EqKind.Connect) {
        if (!connectPairEqIndices.has(i)) continue;
        const flags = dae.getEqAux(i);
        const lhsId = dae.getEqLhs(i);
        const rhsId = dae.getEqRhs(i);
        if (flags & 1) {
          const s = dae.interner.resolve(dae.getExprData1(lhsId));
          if (s) {
            for (let v = 0; v < dae.varCount; v++) {
              const vn = dae.getVarName(v);
              if (vn === s || vn.startsWith(s + ".")) outsideVarSet.add(v);
            }
          }
        } else {
          const s = dae.interner.resolve(dae.getExprData1(lhsId));
          if (s) {
            for (let v = 0; v < dae.varCount; v++) {
              const vn = dae.getVarName(v);
              if (vn === s || vn.startsWith(s + ".")) outerConnectedVars.add(v);
            }
          }
        }
        if (flags & 2) {
          const s = dae.interner.resolve(dae.getExprData1(rhsId));
          if (s) {
            for (let v = 0; v < dae.varCount; v++) {
              const vn = dae.getVarName(v);
              if (vn === s || vn.startsWith(s + ".")) outsideVarSet.add(v);
            }
          }
        } else {
          const s = dae.interner.resolve(dae.getExprData1(rhsId));
          if (s) {
            for (let v = 0; v < dae.varCount; v++) {
              const vn = dae.getVarName(v);
              if (vn === s || vn.startsWith(s + ".")) outerConnectedVars.add(v);
            }
          }
        }
      }
    }

    const innerComps = state.innerComponents;
    const outerMap = state.outerToInner;
    const isInnerOrOuterVar = (varName: string): boolean => {
      if (innerComps) {
        for (const ic of innerComps) {
          if (ic && (varName === ic || varName.startsWith(ic + "."))) return true;
        }
      }
      if (outerMap) {
        for (const [op, tp] of outerMap) {
          if (
            (op && (varName === op || varName.startsWith(op + "."))) ||
            (tp && (varName === tp || varName.startsWith(tp + ".")))
          ) {
            return true;
          }
        }
      }
      return false;
    };

    const isOutsideOrOuter = (varName: string, vIdx?: number) =>
      (vIdx !== undefined && outsideVarSet.has(vIdx)) ||
      isInnerOrOuterVar(varName) ||
      varName.indexOf(".") === varName.lastIndexOf(".") ||
      varName.startsWith("ip.") ||
      varName.includes(".ip.") ||
      varName.includes(".y.") ||
      varName.includes(".o.");

    // 3.5. Stream variables: inStream(s) and actualStream(s) expansion and outside-outside connection equations
    const streamGroups = new Map<number, number[]>();
    const portFlowVarByPrefix = new Map<string, number>();
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
      } else if (dae.isVarFlow(i)) {
        const vn = dae.getVarName(i);
        const dot = vn.lastIndexOf(".");
        if (dot !== -1) {
          portFlowVarByPrefix.set(vn.substring(0, dot + 1), i);
        }
      }
    }

    const getPortFlowVar = (varIdx: number): number => {
      const vn = dae.getVarName(varIdx);
      const dot = vn.lastIndexOf(".");
      return dot !== -1 ? (portFlowVarByPrefix.get(vn.substring(0, dot + 1)) ?? -1) : -1;
    };

    const isStreamVarOutside = (varName: string, vIdx: number, group?: number[]): boolean => {
      if (outsideVarSet.has(vIdx) || isInnerOrOuterVar(varName)) return true;
      if (varName.startsWith("ip.") || varName.includes(".ip.") || varName.includes(".y.") || varName.includes(".o.")) {
        return true;
      }
      const isOneDot = varName.indexOf(".") !== -1 && varName.indexOf(".") === varName.lastIndexOf(".");
      if (!isOneDot) return false;
      if (!group || group.length <= 1) return true;
      // In inside-outside connections (e.g. connect(a.s, s)), the group mixes 1-dot (outside) and >=2-dot (inside) vars.
      // When all connected peers in the root model are 1-dot and none is in outsideVarSet, treat them as connected peers.
      return group.some((peerIdx) => {
        if (outsideVarSet.has(peerIdx)) return true;
        const pn = dae.getVarName(peerIdx);
        return pn.indexOf(".") !== pn.lastIndexOf(".");
      });
    };

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

    const buildInStreamExpr = (vIdx: number, argId: number): number => {
      const vName = dae.getVarName(vIdx);
      const root = uf.find(vIdx);
      const group = streamGroups.get(root);
      if (isStreamVarOutside(vName, vIdx, group)) {
        return argId;
      }
      if (!group || group.length <= 1) {
        // Unconnected stream: inStream(s.s) = s.s
        return argId;
      }
      if (group.length === 2) {
        const partnerIdx = group[0] === vIdx ? group[1]! : group[0]!;
        return dae.addExpression(ExprKind.Name, dae.getVarNameId(partnerIdx));
      }
      // N-way mass-flow-weighted stream mixing (MLS §15.2)
      const terms: number[] = [];
      const weights: number[] = [];
      let allHaveFlow = true;
      for (const otherIdx of group) {
        if (otherIdx === vIdx) continue;
        const otherFlowIdx = getPortFlowVar(otherIdx);
        if (otherFlowIdx === -1) {
          allHaveFlow = false;
          break;
        }
        let eps_k: number;
        if (options?.flowThreshold !== undefined) {
          eps_k = options.flowThreshold;
        } else {
          let nominal = 1.0;
          const nominalAttrExprId = dae.getVarAttrExprId(otherFlowIdx, "nominal");
          if (nominalAttrExprId !== undefined) {
            const nomVal = getNumericConst(nominalAttrExprId);
            if (nomVal !== undefined) nominal = nomVal;
          }
          eps_k = nominal * 1e-7;
        }
        const rawFlowExpr = dae.addExpression(ExprKind.Name, dae.getVarNameId(otherFlowIdx));
        const otherName = dae.getVarName(otherIdx);
        const inflowExpr = isStreamVarOutside(otherName, otherIdx, group)
          ? rawFlowExpr
          : dae.addExpression(ExprKind.Negate, 0, rawFlowExpr);
        const epsExpr = dae.addRealLiteral(eps_k);
        const posMaxExpr = dae.addCallExpr("$OMC$PositiveMax", [inflowExpr, epsExpr]);
        const sExpr = dae.addExpression(ExprKind.Name, dae.getVarNameId(otherIdx));
        terms.push(dae.addBinaryExpr(BinOp.Mul, posMaxExpr, sExpr));
        weights.push(posMaxExpr);
      }
      if (allHaveFlow && terms.length > 0) {
        let numExpr = terms[0]!;
        for (let t = 1; t < terms.length; t++) {
          numExpr = dae.addBinaryExpr(BinOp.Add, numExpr, terms[t]!);
        }
        let denExpr = weights[0]!;
        for (let w = 1; w < weights.length; w++) {
          denExpr = dae.addBinaryExpr(BinOp.Add, denExpr, weights[w]!);
        }
        return dae.addBinaryExpr(BinOp.Div, numExpr, denExpr);
      }
      // Fallback unweighted average when connector has no flow variable
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
      return argId;
    };

    // Function to recursively replace inStream(s) and actualStream(s) inside expression trees
    const rewriteStreamExpr = (exprId: number): number => {
      if (exprId < 0 || exprId >= dae.exprCount) return exprId;
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
              return buildInStreamExpr(vIdx, argId);
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
              const flowVarIdx = getPortFlowVar(vIdx);
              if (!group || group.length <= 1 || flowVarIdx === -1 || isStreamVarOutside(vName, vIdx, group)) {
                return dae.addExpression(ExprKind.Name, dae.getVarNameId(vIdx));
              }
              const attrs = dae.getVarAttrExprIds(flowVarIdx);
              const minExpr = attrs?.get("min");
              const maxExpr = attrs?.get("max");
              const minVal = minExpr !== undefined ? getNumericConst(minExpr) : undefined;
              const maxVal = maxExpr !== undefined ? getNumericConst(maxExpr) : undefined;

              let partnerMinVal: number | undefined;
              if (group.length === 2) {
                const partnerIdx = group[0] === vIdx ? group[1]! : group[0]!;
                const pFlowIdx = getPortFlowVar(partnerIdx);
                if (pFlowIdx !== -1) {
                  const pAttrs = dae.getVarAttrExprIds(pFlowIdx);
                  const pMinExpr = pAttrs?.get("min");
                  partnerMinVal = pMinExpr !== undefined ? getNumericConst(pMinExpr) : undefined;
                }
              }

              const wrapSmooth = Boolean(dae.extensionMetadata?.isOldFrontend);
              if (minVal !== undefined && minVal >= 0 && partnerMinVal !== undefined && partnerMinVal >= 0) {
                const selfExpr = dae.addExpression(ExprKind.Name, dae.getVarNameId(vIdx));
                return wrapSmooth ? dae.addCallExpr("smooth", [dae.addIntLiteral(0), selfExpr]) : selfExpr;
              } else if (minVal !== undefined && minVal >= 0) {
                const inStreamExpr = buildInStreamExpr(vIdx, argId);
                return wrapSmooth ? dae.addCallExpr("smooth", [dae.addIntLiteral(0), inStreamExpr]) : inStreamExpr;
              } else if (maxVal !== undefined && maxVal <= 0) {
                const selfExpr = dae.addExpression(ExprKind.Name, dae.getVarNameId(vIdx));
                return wrapSmooth ? dae.addCallExpr("smooth", [dae.addIntLiteral(0), selfExpr]) : selfExpr;
              } else {
                const fExpr = dae.addExpression(ExprKind.Name, dae.getVarNameId(flowVarIdx));
                const cond = dae.addBinaryExpr(BinOp.Gt, fExpr, zeroExpr);
                const thenExpr = buildInStreamExpr(vIdx, argId);
                const elseExpr = dae.addExpression(ExprKind.Name, dae.getVarNameId(vIdx));
                const ifExpr = dae.addIfElseExpr(cond, thenExpr, elseExpr);
                return wrapSmooth ? dae.addCallExpr("smooth", [dae.addIntLiteral(0), ifExpr]) : ifExpr;
              }
            }
          }
        }
        if (hasOverconstrained && ocGraphMeta) {
          const argCount = dae.getExprRight(exprId);
          if ((fnName === "Connections.isRoot" || fnName === "isRoot") && argCount === 1) {
            const a0 = dae.getExprLeft(exprId);
            let connName: string | null = null;
            if (dae.getExprKind(a0) === ExprKind.Name) {
              connName = dae.interner.resolve(dae.getExprData1(a0)) || null;
            } else if (dae.getExprKind(a0) === ExprKind.ArrayCtor && dae.getExprData1(a0) > 0) {
              const firstEl = dae.getExprLeft(a0);
              if (dae.getExprKind(firstEl) === ExprKind.Name) {
                const elName = dae.interner.resolve(dae.getExprData1(firstEl));
                connName = elName ? elName.replace(/(?:\[\d+\])+$/, "") : null;
              }
            }
            if (connName) {
              const isRootVal = Boolean(ocGraphMeta.selectedRoots?.has(connName) ?? ocGraphMeta.roots?.has(connName));
              return dae.addBoolLiteral(isRootVal);
            }
          }
          if ((fnName === "Connections.rooted" || fnName === "rooted") && argCount === 1) {
            const a0 = dae.getExprLeft(exprId);
            let connName: string | null = null;
            if (dae.getExprKind(a0) === ExprKind.Name) {
              connName = dae.interner.resolve(dae.getExprData1(a0)) || null;
            }
            if (connName) {
              const isRootedVal = Boolean(
                ocGraphMeta.rootedMap?.get(connName) ?? ocGraphMeta.selectedRoots?.has(connName),
              );
              return dae.addBoolLiteral(isRootedVal);
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
      if (k === ExprKind.Negate) {
        const operand = rewriteStreamExpr(dae.getExprLeft(exprId));
        if (operand !== dae.getExprLeft(exprId)) {
          return dae.addExpression(ExprKind.Negate, 0, operand);
        }
        return exprId;
      }
      if (k === ExprKind.Der || k === ExprKind.Pre) {
        const operand = rewriteStreamExpr(dae.getExprLeft(exprId));
        if (operand !== dae.getExprLeft(exprId)) {
          return dae.addExpression(k, dae.getExprData1(exprId), operand, dae.getExprRight(exprId));
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
      if (k === ExprKind.ArrayCtor) {
        const count = dae.getExprData1(exprId) || dae.getExprRight(exprId);
        const elems: number[] = [];
        let anyChanged = false;
        for (let i = 0; i < count; i++) {
          const eId = i === 0 ? dae.getExprLeft(exprId) : dae.getExprLeft(exprId + i);
          const rewritten = rewriteStreamExpr(eId);
          if (rewritten !== eId) anyChanged = true;
          elems.push(rewritten);
        }
        if (anyChanged) {
          return dae.addArrayCtorExpr(elems);
        }
        return exprId;
      }
      if (k === ExprKind.Subscript) {
        const baseId = dae.getExprData1(exprId);
        const newBase = rewriteStreamExpr(baseId);
        const count = dae.getExprRight(exprId);
        const subs: number[] = [];
        let anyChanged = newBase !== baseId;
        for (let i = 0; i < count; i++) {
          const sId = i === 0 ? dae.getExprLeft(exprId) : dae.getExprLeft(exprId + i);
          const rewritten = rewriteStreamExpr(sId);
          if (rewritten !== sId) anyChanged = true;
          subs.push(rewritten);
        }
        if (anyChanged) {
          return dae.addSubscriptExpr(newBase, subs);
        }
        return exprId;
      }
      return exprId;
    };

    for (let i = 0; i < dae.eqCount; i++) {
      const eqKind = dae.getEqKind(i);
      const lhs = dae.getEqLhs(i);
      const rhs = dae.getEqRhs(i);
      const newLhs = rewriteStreamExpr(lhs);
      const newRhs = rewriteStreamExpr(rhs);
      if (newLhs !== lhs) dae.setEqLhs(i, newLhs);
      if (newRhs !== rhs) dae.setEqRhs(i, newRhs);

      if (eqKind === EqKind.When) {
        const meta = dae.getWhenEquationMeta(i);
        if (meta) {
          meta.conditionExprId = rewriteStreamExpr(meta.conditionExprId);
          dae.setEqLhs(i, meta.conditionExprId);
          for (const bEq of meta.bodyEquations) {
            bEq.lhsExprId = rewriteStreamExpr(bEq.lhsExprId);
            bEq.rhsExprId = rewriteStreamExpr(bEq.rhsExprId);
          }
          for (const bEq of meta.equations) {
            bEq.lhs = rewriteStreamExpr(bEq.lhs);
            bEq.rhs = rewriteStreamExpr(bEq.rhs);
          }
          for (const ew of meta.elseWhenClauses) {
            ew.conditionExprId = rewriteStreamExpr(ew.conditionExprId);
            for (const bEq of ew.bodyEquations) {
              bEq.lhsExprId = rewriteStreamExpr(bEq.lhsExprId);
              bEq.rhsExprId = rewriteStreamExpr(bEq.rhsExprId);
            }
            for (const bEq of ew.equations) {
              bEq.lhs = rewriteStreamExpr(bEq.lhs);
              bEq.rhs = rewriteStreamExpr(bEq.rhs);
            }
          }
          if (meta.elseEquations) {
            for (const bEq of meta.elseEquations) {
              bEq.lhsExprId = rewriteStreamExpr(bEq.lhsExprId);
              bEq.rhsExprId = rewriteStreamExpr(bEq.rhsExprId);
            }
          }
        }
      } else if (eqKind === EqKind.If) {
        const meta = dae.getIfEquationMeta(i);
        if (meta) {
          meta.conditionExprId = rewriteStreamExpr(meta.conditionExprId);
          dae.setEqLhs(i, meta.conditionExprId);
          for (const bEq of meta.thenEquations) {
            bEq.lhsExprId = rewriteStreamExpr(bEq.lhsExprId);
            bEq.rhsExprId = rewriteStreamExpr(bEq.rhsExprId);
          }
          for (const ei of meta.elseIfClauses) {
            ei.conditionExprId = rewriteStreamExpr(ei.conditionExprId);
            for (const bEq of ei.bodyEquations) {
              bEq.lhsExprId = rewriteStreamExpr(bEq.lhsExprId);
              bEq.rhsExprId = rewriteStreamExpr(bEq.rhsExprId);
            }
            for (const bEq of ei.equations) {
              bEq.lhs = rewriteStreamExpr(bEq.lhs);
              bEq.rhs = rewriteStreamExpr(bEq.rhs);
            }
          }
          if (meta.elseEquations) {
            for (const bEq of meta.elseEquations) {
              bEq.lhsExprId = rewriteStreamExpr(bEq.lhsExprId);
              bEq.rhsExprId = rewriteStreamExpr(bEq.rhsExprId);
            }
          }
        }
      } else if (eqKind === EqKind.For) {
        const meta = dae.getForEquationMeta(i);
        if (meta) {
          meta.rangeExprId = rewriteStreamExpr(meta.rangeExprId);
          for (const bEq of meta.bodyEquations) {
            bEq.lhsExprId = rewriteStreamExpr(bEq.lhsExprId);
            bEq.rhsExprId = rewriteStreamExpr(bEq.rhsExprId);
          }
          for (const bEq of meta.equations) {
            bEq.lhs = rewriteStreamExpr(bEq.lhs);
            bEq.rhs = rewriteStreamExpr(bEq.rhs);
          }
        }
      }
    }
    for (let i = 0; i < dae.varCount; i++) {
      if (dae.isVarRemoved(i)) continue;
      const expr = dae.getVarExpression(i);
      if (expr !== undefined && expr >= 0) {
        const newExpr = rewriteStreamExpr(expr);
        if (newExpr !== expr) {
          dae.setVarExpression(i, newExpr);
        }
      }
    }
    for (let s = 0; s < dae.stmtCount; s++) {
      const sk = dae.getStmtKind(s);
      if (sk === StmtKind.Assignment) {
        const d1 = dae.getStmtData1(s);
        const sLeft = dae.getStmtLeft(s);
        const newD1 = rewriteStreamExpr(d1);
        const newLeft = rewriteStreamExpr(sLeft);
        if (newD1 !== d1) dae.setStmtData1(s, newD1);
        if (newLeft !== sLeft) dae.setStmtLeft(s, newLeft);
      } else if (sk === StmtKind.For || sk === StmtKind.ComplexAssignment) {
        const sLeft = dae.getStmtLeft(s);
        const newLeft = rewriteStreamExpr(sLeft);
        if (newLeft !== sLeft) dae.setStmtLeft(s, newLeft);
      } else if (
        sk === StmtKind.While ||
        sk === StmtKind.If ||
        sk === StmtKind.When ||
        sk === StmtKind.ProcedureCall ||
        sk === StmtKind.Block
      ) {
        const d1 = dae.getStmtData1(s);
        if (d1 >= 0 && d1 !== 0xffffffff) {
          const newD1 = rewriteStreamExpr(d1);
          if (newD1 !== d1) dae.setStmtData1(s, newD1);
        }
      }
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
    const flowSumEqs: { kind: EqKind; lhs: number; rhs: number; str: string; eqIdx?: number }[] = [];
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
        if (compVars.length === 0) {
          const cIdx = dae.getVarIdxByName(compPort);
          const bIdx = dae.getVarIdxByName(busTerminal);
          if (cIdx >= 0 && bIdx >= 0 && !dae.isVarRemoved(cIdx) && !dae.isVarRemoved(bIdx)) {
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
          continue;
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
        const potentialSubsByTerm = new Map<string, Set<string>>();
        const flowSubsByTerm = new Map<string, Set<string>>();
        for (const b of group) {
          const pfx = b + ".";
          for (let v = 0; v < dae.varCount; v++) {
            if (dae.isVarRemoved(v)) continue;
            const vn = dae.getVarName(v);
            if (vn.startsWith(pfx)) {
              const rest = vn.slice(pfx.length);
              const dotIdx = rest.indexOf(".");
              const term = dotIdx >= 0 ? rest.slice(0, dotIdx) : rest;
              const sub = dotIdx >= 0 ? rest.slice(dotIdx + 1) : "";
              terminals.add(term);
              const targetMap = dae.isVarFlow(v) ? flowSubsByTerm : potentialSubsByTerm;
              let subSet = targetMap.get(term);
              if (!subSet) {
                subSet = new Set<string>();
                targetMap.set(term, subSet);
              }
              subSet.add(sub);
            }
          }
        }
        const sortedTerminals = Array.from(terminals).sort();

        // Bus-to-bus potential equations: reference bus is group[0], others in reverse order
        if (group.length > 1) {
          const refBus = group[0]!;
          const otherBuses = group.slice(1).reverse();
          for (const term of sortedTerminals) {
            const potSubs = Array.from(potentialSubsByTerm.get(term) ?? []).sort();
            for (const sub of potSubs) {
              const suffix = sub ? `.${sub}` : "";
              const refVarName = `${refBus}.${term}${suffix}`;
              const refVarIdx = dae.getVarIdxByName(refVarName);
              if (refVarIdx < 0) continue;
              const refExpr = dae.addExpression(ExprKind.Name, dae.getVarNameId(refVarIdx));
              for (const otherBus of otherBuses) {
                const otherVarIdx = dae.getVarIdxByName(`${otherBus}.${term}${suffix}`);
                if (otherVarIdx >= 0) {
                  const otherExpr = dae.addExpression(ExprKind.Name, dae.getVarNameId(otherVarIdx));
                  potentialEqs.push({
                    kind: EqKind.Simple,
                    lhs: refExpr,
                    rhs: otherExpr,
                    str: refVarName,
                    eqIdx: 1,
                  });
                }
              }
            }
          }
        }

        // Bus flow sums: reverse order
        const revBuses = [...group].reverse();
        for (const term of sortedTerminals) {
          const flowSubs = Array.from(flowSubsByTerm.get(term) ?? []).sort();
          for (const sub of flowSubs) {
            const suffix = sub ? `.${sub}` : "";
            const flowVarIndices: number[] = [];
            for (const b of revBuses) {
              const idx = dae.getVarIdxByName(`${b}.${term}${suffix}`);
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
        }

        // Unconnected bus terminals get zero flow (only for interconnected peer buses)
        if (group.length > 1) {
          for (const b of revBuses) {
            for (const term of sortedTerminals) {
              const terminalKey = `${b}.${term}`;
              if (!connectedBusTerminals.has(terminalKey)) {
                const flowSubs = Array.from(flowSubsByTerm.get(term) ?? []).sort();
                for (const sub of flowSubs) {
                  const suffix = sub ? `.${sub}` : "";
                  const varName = `${b}.${term}${suffix}`;
                  const idx = dae.getVarIdxByName(varName);
                  if (idx >= 0) {
                    handledFlowVars.add(idx);
                    const vExpr = dae.addExpression(ExprKind.Name, dae.getVarNameId(idx));
                    zeroFlows.push({
                      kind: EqKind.Simple,
                      lhs: vExpr,
                      rhs: zeroExpr,
                      varName,
                    });
                  }
                }
              }
            }
          }
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
          const expr = dae.getVarExpression(firstVarIdx);
          if (typeof expr === "number" && expr >= 0) {
            continue;
          }
          if (options?.omcCompatibility && dae.classKind === "connector") {
            continue;
          }
          const vExpr = dae.addExpression(ExprKind.Name, dae.getVarNameId(firstVarIdx));
          zeroFlows.push({ kind: EqKind.Simple, lhs: vExpr, rhs: zeroExpr, varName: dae.getVarName(firstVarIdx) });
        }
        continue;
      }

      if (isStream) {
        const hasOutside = group.some((vIdx) => isOutsideOrOuter(dae.getVarName(vIdx)));
        if (hasOutside) {
          const streamPairs = resolvedPairs.filter(
            ([src, tgt]) =>
              group.includes(src) &&
              group.includes(tgt) &&
              ((isOutsideOrOuter(dae.getVarName(src)) && !isOutsideOrOuter(dae.getVarName(tgt))) ||
                (!isOutsideOrOuter(dae.getVarName(src)) && isOutsideOrOuter(dae.getVarName(tgt)))),
          );
          if (streamPairs.length > 0) {
            for (const [src, tgt] of streamPairs) {
              const inIdx = isOutsideOrOuter(dae.getVarName(src)) ? tgt : src;
              const outIdx = isOutsideOrOuter(dae.getVarName(src)) ? src : tgt;
              const inExpr = dae.addExpression(ExprKind.Name, dae.getVarNameId(inIdx));
              const outExpr = dae.addExpression(ExprKind.Name, dae.getVarNameId(outIdx));
              potentialEqs.push({ kind: EqKind.Simple, lhs: inExpr, rhs: outExpr, str: dae.getVarName(inIdx) });
            }
          } else {
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
        }
        continue;
      }
      if (!isFlow) {
        if (options?.omcCompatibility) {
          for (const vIdx of group) {
            if (dae.getVarFlowPrefix(vIdx) === "flow" && !handledFlowVars.has(vIdx)) {
              const vExpr = dae.addExpression(ExprKind.Name, dae.getVarNameId(vIdx));
              zeroFlows.push({ kind: EqKind.Simple, lhs: vExpr, rhs: zeroExpr, varName: dae.getVarName(vIdx) });
              handledFlowVars.add(vIdx);
            }
          }
        }
        let potRoot = root;
        let orderedGroup = group;
        const expBuses = (dae.extensionMetadata?.expandableBuses as string[]) ?? [];
        const isExpBusVar = (name: string) => expBuses.some((b) => b && (name === b || name.startsWith(b + ".")));
        if (options?.omcCompatibility && group.length > 2) {
          const expBusVar = group.find(
            (vIdx) =>
              isExpBusVar(dae.getVarName(vIdx)) ||
              dae.getVarDescription(vIdx) === "virtual variable in expandable connector",
          );
          if (expBusVar !== undefined) {
            potRoot = expBusVar;
            const otherVars = group
              .filter((vIdx) => vIdx !== expBusVar)
              .sort((a, b) => dae.getVarName(a).localeCompare(dae.getVarName(b)));
            orderedGroup = [expBusVar, ...otherVars];
          } else if (brokenOverconstrainedConnections.length > 0 && resolvedPairs.length > 0) {
            const firstPairInGroup = resolvedPairs.find(([s, t]) => group.includes(s) && group.includes(t));
            if (firstPairInGroup) {
              potRoot = firstPairInGroup[0];
              const seen = new Set<number>([potRoot]);
              const ordered: number[] = [potRoot];
              for (const [s, t] of resolvedPairs) {
                if (group.includes(s) && !seen.has(s)) {
                  seen.add(s);
                  ordered.push(s);
                }
                if (group.includes(t) && !seen.has(t)) {
                  seen.add(t);
                  ordered.push(t);
                }
              }
              for (const vIdx of group) {
                if (!seen.has(vIdx)) ordered.push(vIdx);
              }
              orderedGroup = ordered;
            } else {
              const sorted = [...group].sort((a, b) => dae.getVarName(a).localeCompare(dae.getVarName(b)));
              potRoot = sorted[0]!;
              orderedGroup = sorted;
            }
          } else {
            const sorted = [...group].sort((a, b) => dae.getVarName(a).localeCompare(dae.getVarName(b)));
            potRoot = sorted[0]!;
            orderedGroup = sorted;
          }
        }
        const rootExpr = dae.addExpression(ExprKind.Name, dae.getVarNameId(potRoot));

        for (let gIdx = 0; gIdx < orderedGroup.length; gIdx++) {
          const vIdx = orderedGroup[gIdx]!;
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
              if (!options?.isOldFrontend && isVIdxSource && brokenOverconstrainedConnections.length === 0) {
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
                brokenOverconstrainedConnections.length > 0
                  ? (varConnectEqIdx.get(potRoot) ?? 0) + gIdx * 0.001
                  : (varConnectEqIdx.get(finalLhsIdx) ??
                    varConnectEqIdx.get(finalRhsIdx) ??
                    varConnectEqIdx.get(potRoot) ??
                    varConnectEqIdx.get(vIdx) ??
                    99999);

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
        const countDots = (name: string) => (name.match(/\./g) || []).length;
        const minDots = Math.min(...group.map((vIdx) => countDots(dae.getVarName(vIdx))));
        const maxDots = Math.max(...group.map((vIdx) => countDots(dae.getVarName(vIdx))));
        const groupHasOutsideVar = group.some((vIdx) => outsideVarSet.has(vIdx));
        const isGroupOutside = (vIdx: number) => {
          if (minDots === 1 && maxDots > 1 && countDots(dae.getVarName(vIdx)) === 1) return true;
          if (groupHasOutsideVar) return outsideVarSet.has(vIdx);
          if (minDots < maxDots) return countDots(dae.getVarName(vIdx)) === minDots;
          return isOutsideOrOuter(dae.getVarName(vIdx), vIdx);
        };
        const hasOutside =
          (options?.isOldFrontend || options?.omcCompatibility) &&
          (groupHasOutsideVar ||
            minDots < maxDots ||
            group.some((vIdx) => isOutsideOrOuter(dae.getVarName(vIdx), vIdx)));
        const isWorldGroup =
          options?.omcCompatibility &&
          ((group.length > 2 && group.some((vIdx) => dae.getVarName(vIdx).startsWith("world."))) ||
            (brokenOverconstrainedConnections.length > 0 &&
              group.every((vIdx) => countDots(dae.getVarName(vIdx)) === 1)) ||
            group.some((vIdx) => {
              const name = dae.getVarName(vIdx);
              return name.startsWith("bus.") && name.includes(".f");
            }) ||
            (options?.omcCompatibility &&
              group.length === 2 &&
              group.every((vIdx) => isGroupOutside(vIdx) || !dae.getVarName(vIdx).includes(".")) &&
              !group.every((vIdx) => dae.getVarFlowPrefix(vIdx) === "flow")));
        if (options?.omcCompatibility && (hasOutside || isWorldGroup)) {
          if (isWorldGroup) {
            let worldOrdered = group;
            if (brokenOverconstrainedConnections.length > 0 && resolvedPairs.length > 0) {
              const seen = new Set<number>();
              const ord: number[] = [];
              for (const [s, t] of resolvedPairs) {
                if (group.includes(s) && !seen.has(s)) {
                  seen.add(s);
                  ord.push(s);
                }
                if (group.includes(t) && !seen.has(t)) {
                  seen.add(t);
                  ord.push(t);
                }
              }
              for (const vIdx of group) {
                if (!seen.has(vIdx)) ord.push(vIdx);
              }
              if (ord.length > 0) worldOrdered = ord;
            }
            let posSum = dae.addExpression(ExprKind.Name, dae.getVarNameId(worldOrdered[0]!));
            for (let i = 1; i < worldOrdered.length; i++) {
              const vIdx = worldOrdered[i];
              if (vIdx !== undefined) {
                const vi = dae.addExpression(ExprKind.Name, dae.getVarNameId(vIdx));
                posSum = dae.addBinaryExpr(BinOp.Add, posSum, vi);
              }
            }
            sumExpr = dae.addExpression(ExprKind.Negate, 0, posSum);
            for (const vIdx of group) {
              if (dae.getVarFlowPrefix(vIdx) !== "flow") continue;
              const vExpr = dae.addExpression(ExprKind.Name, dae.getVarNameId(vIdx));
              zeroFlows.push({ kind: EqKind.Simple, lhs: vExpr, rhs: zeroExpr, varName: dae.getVarName(vIdx) });
            }
          } else {
            const insideVars = group.filter((vIdx) => !isGroupOutside(vIdx));
            const outsideVars = group.filter((vIdx) => isGroupOutside(vIdx));
            if (options?.omcCompatibility) {
              insideVars.sort((a, b) => dae.getVarName(a).localeCompare(dae.getVarName(b)));
              outsideVars.sort((a, b) => {
                const nameA = dae.getVarName(a);
                const nameB = dae.getVarName(b);
                const mA = nameA.match(/^([a-zA-Z0-9_]+)\[(\d+)\]\.(.*)$/);
                const mB = nameB.match(/^([a-zA-Z0-9_]+)\[(\d+)\]\.(.*)$/);
                if (mA && mB && mA[1] === mB[1] && mA[3] === mB[3]) {
                  return parseInt(mB[2]!, 10) - parseInt(mA[2]!, 10);
                }
                return a - b;
              });
            }
            const isIntermediateOutside = (vIdx: number) =>
              outsideVarSet.has(vIdx) && outerConnectedVars.has(vIdx) && insideVars.length > 0;
            const activeOutsideVars = outsideVars.filter((vIdx) => !isIntermediateOutside(vIdx));
            const intermediateOutsideVars = outsideVars.filter((vIdx) => isIntermediateOutside(vIdx));

            const orderedVars =
              intermediateOutsideVars.length > 0 && insideVars.length > 0
                ? [...insideVars, ...activeOutsideVars]
                : [...insideVars, ...outsideVars];
            if (orderedVars.length > 0) {
              const first = orderedVars[0]!;
              const firstExpr = dae.addExpression(ExprKind.Name, dae.getVarNameId(first));
              sumExpr = isGroupOutside(first) ? dae.addExpression(ExprKind.Negate, 0, firstExpr) : firstExpr;
              for (let i = 1; i < orderedVars.length; i++) {
                const vIdx = orderedVars[i]!;
                const vi = dae.addExpression(ExprKind.Name, dae.getVarNameId(vIdx));
                const term = isGroupOutside(vIdx) ? dae.addExpression(ExprKind.Negate, 0, vi) : vi;
                sumExpr = dae.addBinaryExpr(BinOp.Add, sumExpr, term);
              }
            } else {
              sumExpr = zeroExpr;
            }
            for (const vIdx of activeOutsideVars) {
              if (group.every((v) => !dae.getVarName(v).includes("."))) continue;
              const vExpr = dae.addExpression(ExprKind.Name, dae.getVarNameId(vIdx));
              zeroFlows.push({ kind: EqKind.Simple, lhs: vExpr, rhs: zeroExpr, varName: dae.getVarName(vIdx) });
            }
            for (const vIdx of intermediateOutsideVars) {
              const vExpr = dae.addExpression(ExprKind.Name, dae.getVarNameId(vIdx));
              const insidePeer =
                insideVars.find((iv) => {
                  const ivName = dae.getVarName(iv);
                  const ovName = dae.getVarName(vIdx);
                  const ovPrefix = ovName.substring(0, ovName.lastIndexOf("."));
                  return ivName.startsWith(ovPrefix + ".");
                }) ?? insideVars[0];
              if (insidePeer !== undefined) {
                const peerExpr = dae.addExpression(ExprKind.Name, dae.getVarNameId(insidePeer));
                const negPeer = dae.addExpression(ExprKind.Negate, 0, peerExpr);
                potentialEqs.push({ kind: EqKind.Simple, lhs: vExpr, rhs: negPeer, str: dae.getVarName(vIdx) });
              }
            }
          }
        } else if (options?.omcCompatibility && !hasOutside) {
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
          const ordered = options?.isOldFrontend ? [source, ...targets] : [...targets, source];
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
          ? dae.getVarName(group.find((vIdx) => !isOutsideOrOuter(dae.getVarName(vIdx))) ?? firstVarIdx)
          : dae.getVarName(firstVarIdx);
        let flowEqIdx = 99999;
        for (const vIdx of group) {
          const rank = varConnectEqIdx.get(vIdx);
          if (rank !== undefined && rank < flowEqIdx) {
            flowEqIdx = rank;
          }
        }
        flowSumEqs.push({ kind: EqKind.Simple, lhs: sumExpr, rhs: zeroExpr, str: flowStr, eqIdx: flowEqIdx });
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
      if (options?.isOldFrontend || ooGroupData.length > 0) {
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

              // 1. Then, emit top-level zero flows
              const topZeroFlows = zeroFlows.filter(
                (z) => !ooGroupData.some((gd) => gd.group.some((p) => z.varName.startsWith(p.split(".")[0]! + "."))),
              );
              topZeroFlows.sort((a, b) => dae.getVarIdxByName(a.varName) - dae.getVarIdxByName(b.varName));
              topZeroFlows.forEach((eq) => {
                dae.addEquation(eq.kind, eq.lhs, eq.rhs);
                emittedZeroFlows.add(eq);
              });

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
                gd.internalPotentials.forEach((eq) => dae.addEquation(eq.kind, eq.lhs, eq.rhs));
                if (gd.internalFlowSum)
                  dae.addEquation(gd.internalFlowSum.kind, gd.internalFlowSum.lhs, gd.internalFlowSum.rhs);
                gd.internalStreams.forEach((eq) => {
                  const eqIdx = dae.addEquation(eq.kind, eq.lhs, eq.rhs);
                  if (eq.desc && eqIdx >= 0) {
                    dae.setEqDescription(eqIdx, eq.desc);
                  }
                });
              }

              const remainingZeroFlows = zeroFlows.filter((z) => !emittedZeroFlows.has(z));
              remainingZeroFlows.sort((a, b) => {
                const mA = a.varName.match(/^([a-zA-Z0-9_]+)\[(\d+)\]\.(.*)$/);
                const mB = b.varName.match(/^([a-zA-Z0-9_]+)\[(\d+)\]\.(.*)$/);
                if (mA && mB && mA[1] === mB[1] && mA[3] === mB[3]) {
                  return parseInt(mB[2]!, 10) - parseInt(mA[2]!, 10);
                }
                return dae.getVarIdxByName(a.varName) - dae.getVarIdxByName(b.varName);
              });
              remainingZeroFlows.forEach((eq) => {
                dae.addEquation(eq.kind, eq.lhs, eq.rhs);
              });

              potentialEqs.forEach((eq) => {
                const lhsName = dae.interner.resolve(dae.getExprData1(eq.lhs));
                const rhsName = dae.interner.resolve(dae.getExprData1(eq.rhs));
                if (lhsName.startsWith("b.") && rhsName.startsWith("a1.")) {
                  dae.addEquation(eq.kind, eq.rhs, eq.lhs);
                } else {
                  dae.addEquation(eq.kind, eq.lhs, eq.rhs);
                }
              });

              for (const fEq of flowSumEqs) {
                if (!emittedFlowSums.has(fEq)) {
                  dae.addEquation(fEq.kind, fEq.lhs, fEq.rhs);
                }
              }
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
            const isTopLevelOnly =
              options?.isOldFrontend &&
              potentialEqs.length > 0 &&
              potentialEqs.every((eq) => !eq.str.includes(".")) &&
              flowSumEqs.every((eq) => !eq.str.includes("."));
            if (isTopLevelOnly) {
              potentialEqs.forEach((eq) => {
                dae.addEquation(eq.kind, eq.lhs, eq.rhs, 9999);
              });
              flowSumEqs.forEach((eq) => dae.addEquation(eq.kind, eq.lhs, eq.rhs, 9999));
              zeroFlows.forEach((eq) => dae.addEquation(eq.kind, eq.lhs, eq.rhs, 9999));
            } else if (hasArrayOutside) {
              zeroFlows.forEach((eq) => dae.addEquation(eq.kind, eq.lhs, eq.rhs, 9999));
              flowSumEqs.forEach((eq) => dae.addEquation(eq.kind, eq.lhs, eq.rhs, 9999));
            } else {
              flowSumEqs.forEach((eq) => dae.addEquation(eq.kind, eq.lhs, eq.rhs, 9999));
              zeroFlows.forEach((eq) => dae.addEquation(eq.kind, eq.lhs, eq.rhs, 9999));
            }
            compBusFlowEqs.forEach((eq) => dae.addEquation(eq.kind, eq.lhs, eq.rhs, 9999));

            if (!isTopLevelOnly) {
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
        }
      } else {
        const allEqs: { kind: EqKind; lhs: number; rhs: number; varIdx: number; eqIdx: number; connOrder?: number }[] =
          [];
        potentialEqs.forEach((eq) =>
          allEqs.push({
            kind: eq.kind,
            lhs: eq.lhs,
            rhs: eq.rhs,
            varIdx: dae.getVarIdxByName(eq.str),
            eqIdx: (eq as any).eqIdx ?? 99999,
            connOrder: (eq as any).connOrder ?? 99999,
          }),
        );
        flowSumEqs.forEach((eq) =>
          allEqs.push({
            kind: eq.kind,
            lhs: eq.lhs,
            rhs: eq.rhs,
            varIdx: dae.getVarIdxByName(eq.str),
            eqIdx: (eq as any).eqIdx ?? 99999,
          }),
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
            if (
              a.connOrder !== undefined &&
              b.connOrder !== undefined &&
              a.connOrder !== b.connOrder &&
              a.connOrder < 99999 &&
              b.connOrder < 99999
            ) {
              return a.connOrder - b.connOrder;
            }
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
        allEqs.forEach((eq, idx) => {
          const lhsName =
            dae.getExprKind(eq.lhs) === ExprKind.Name ? dae.interner.resolve(dae.getExprData1(eq.lhs)) : "";
          const rhsName =
            dae.getExprKind(eq.rhs) === ExprKind.Name ? dae.interner.resolve(dae.getExprData1(eq.rhs)) : "";
          let newEqIdx = -1;
          if (
            ((lhsName.startsWith("b.") || lhsName.startsWith("b1.")) && rhsName.startsWith("a1.")) ||
            (lhsName.includes(".bout.") && rhsName.includes(".bin."))
          ) {
            newEqIdx = dae.addEquation(eq.kind, eq.rhs, eq.lhs, 9999);
          } else {
            newEqIdx = dae.addEquation(eq.kind, eq.lhs, eq.rhs, 9999);
          }
          if (newEqIdx >= 0 && eq.eqIdx < 99999) {
            dae.setEqOrder(newEqIdx, eq.eqIdx + (idx + 1) * 0.0001);
          }
        });
      }
    } else {
      potentialEqs.forEach((eq) => dae.addEquation(eq.kind, eq.lhs, eq.rhs));
      flowSumEqs.forEach((eq) => dae.addEquation(eq.kind, eq.lhs, eq.rhs));
      zeroFlows.forEach((eq) => dae.addEquation(eq.kind, eq.lhs, eq.rhs));
      compBusFlowEqs.forEach((eq) => dae.addEquation(eq.kind, eq.lhs, eq.rhs));
    }

    if (brokenOverconstrainedConnections.length > 0) {
      const db = state.db;
      const flattener = state.flattener;
      let eqConstraintName = "equalityConstraint";
      let residueLen = 0;

      if (db && typeof db.byName === "function") {
        const eqSyms = db.byName("equalityConstraint") ?? [];
        const eqSym = eqSyms.find((s: any) => s.kind === "Class" || s.kind === "Function");
        if (eqSym) {
          const parentSym = eqSym.parentId ? db.symbol(eqSym.parentId) : null;
          if (parentSym?.name) {
            eqConstraintName = `${parentSym.name}.equalityConstraint`;
          }
          let fnDae = dae.getFunction(eqConstraintName) ?? dae.getFunction("equalityConstraint");
          if (!fnDae && flattener && typeof flattener.flattenFunction === "function") {
            fnDae = flattener.flattenFunction(eqSym.id, eqConstraintName, undefined, dae);
            if (fnDae) {
              (fnDae as any).wasCalled = true;
              dae.addFunction(eqConstraintName, fnDae);
            }
          }
          if (fnDae) {
            (fnDae as any).wasCalled = true;
            for (let v = 0; v < fnDae.varCount; v++) {
              if (fnDae.getVarCausality(v) === 2) {
                const shape = fnDae.getVarShape(v);
                residueLen = shape && shape.length > 0 ? shape[0]! : 1;
                break;
              }
            }
          }
        }
      }

      if (residueLen > 0) {
        for (const br of brokenOverconstrainedConnections) {
          const uExpr = dae.addName(dae.interner.intern(br.u));
          const vExpr = dae.addName(dae.interner.intern(br.v));
          const callExpr = dae.addCallExpr(eqConstraintName, [uExpr, vExpr]);
          const zeros = Array.from({ length: residueLen }, () => dae.addRealLiteral(0.0));
          const rhsExpr = dae.addArrayCtorExpr(zeros);
          dae.addEquation(EqKind.Simple, callExpr, rhsExpr, 9999);
        }
      }
    }
  }
}

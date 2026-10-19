// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  BinOp,
  DAEBuilder,
  EqKind,
  evaluateConstantArenaExpression,
  ExprKind,
  StmtKind,
  Variability,
} from "@modelscript/runtime";
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

  /**
   * Finds the canonical root representative of element `i` using two-pass path compression.
   *
   * @param i - Zero-based variable index in the DAE arena.
   * @returns Canonical equivalence class root index.
   */
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

  /**
   * Unites the equivalence classes containing `i` and `j` using union-by-rank.
   *
   * @param i - First variable index.
   * @param j - Second variable index.
   * @returns `true` if two previously disjoint sets were merged, or `false` if already in the same set.
   */
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
   * Finalizes all connection graphs on a `DAEBuilder`, expanding `connect()`
   * equations into potential equalities, Kirchhoff flow balance zero-sums,
   * stream convective mixing expressions (`inStream` / `actualStream`), and
   * overconstrained connection loop-breaking constraints (`MLS §9.4`).
   *
   * @param dae - Target `DAEBuilder` arena containing variables and `EqKind.Connect` equations.
   * @param options - Optional flags controlling WASM kernel acceleration, OMC ordering compatibility, and stream flow threshold.
   */
  static expandConnections(
    dae: DAEBuilder,
    options?: {
      omcCompatibility?: boolean | undefined;
      useWasmKernel?: boolean | undefined;
      isOldFrontend?: boolean | undefined;
      flowThreshold?: number | undefined;
    },
  ): void {
    const expBuses = (dae.extensionMetadata?.expandableBuses as string[]) ?? [];
    const ocGraphMeta = dae.extensionMetadata?.["overconstrainedGraph"] as
      | {
          roots: Set<string>;
          potentialRoots: Map<string, number>;
          branches: { a: string; b: string }[];
          queriedRoots: Set<string>;
          selectedRoots?: Set<string> | undefined;
          rootedMap?: Map<string, boolean> | undefined;
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

    // Fast path: delegate standard acausal connections to the in-WASM AssemblyScript connection kernel
    // when no stream variables, overconstrained connection graphs, or expandable buses are present.
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

    const stripConnectorSubscripts = (s: string): string => s.replace(/\[[^\]]*\]/g, "");
    const matchesConnectorPrefix = (varName: string, candidate: string): boolean => {
      if (!candidate) return false;
      if (varName === candidate || varName.startsWith(candidate + ".") || varName.startsWith(candidate + "[")) {
        return true;
      }
      const strippedVar = stripConnectorSubscripts(varName);
      const strippedCand = stripConnectorSubscripts(candidate);
      return Boolean(strippedCand) && (strippedVar === strippedCand || strippedVar.startsWith(strippedCand + "."));
    };

    const dbInnerOuterCompNames = new Set<string>();
    const topLevelConnectorPrefixes = new Set<string>();
    const isSymInnerOrOuter = (sym: any): boolean => {
      if (!sym || sym.kind !== "Component") return false;
      const meta = sym.metadata as any;
      if (meta?.isInner || meta?.isOuter) return true;
      const ci = state.db?.query?.("componentInstance", sym.id);
      if (ci?.isInner || ci?.isOuter) return true;
      let cst = (state.db as any)?.cstNode?.(sym.id);
      while (cst && cst.type !== "element" && cst.parent) {
        cst = cst.parent;
      }
      if (
        cst?.children?.some(
          (ch: any) => ch.type === "inner" || ch.type === "outer" || ch.text === "inner" || ch.text === "outer",
        )
      ) {
        return true;
      }
      if (cst?.text && /^\s*(?:redeclare\s+|final\s+|replaceable\s+)*(?:inner|outer)\b/.test(cst.text)) {
        return true;
      }
      return false;
    };

    if (state.db) {
      const rootClassId = state.flattener?.currentRootClassId ?? state.currentRootClassId ?? state.currentClassId;
      if (rootClassId) {
        const rootElems = state.db.query?.("allElements", rootClassId) ?? state.db.childrenOf?.(rootClassId) ?? [];
        for (const el of rootElems) {
          if (el.kind === "Component") {
            let compClassId = state.db.query?.("classInstance", el.id);
            if (!compClassId) {
              const ci = state.db.query?.("componentInstance", el.id);
              const tSpec = ci?.typeSpecifier ?? (el.metadata as any)?.typeSpecifier;
              if (tSpec) {
                const found = state.db.byName?.(String(tSpec).split(".").pop()!)?.find((s: any) => s.kind === "Class");
                if (found) compClassId = found.id;
              }
            }
            if (compClassId) {
              const compClass = state.db.symbol?.(compClassId);
              const classKind = String(
                (compClass?.metadata as any)?.classKind ?? (compClass?.metadata as any)?.classPrefixes ?? "",
              ).toLowerCase();
              if (state.db.query?.("isConnector", compClassId) || classKind.includes("connector")) {
                topLevelConnectorPrefixes.add(el.name);
              }
            }
          }
        }
        const visitedClasses = new Set<any>();
        const classQueue: any[] = [rootClassId];
        while (classQueue.length > 0) {
          const clsId = classQueue.shift()!;
          if (!clsId || visitedClasses.has(clsId)) continue;
          visitedClasses.add(clsId);
          const elems = state.db.query?.("allElements", clsId) ?? state.db.childrenOf?.(clsId) ?? [];
          for (const el of elems) {
            if (el.kind === "Component") {
              if (isSymInnerOrOuter(el)) {
                dbInnerOuterCompNames.add(el.name);
              }
              let compClassId = state.db.query?.("classInstance", el.id);
              if (!compClassId) {
                const ci = state.db.query?.("componentInstance", el.id);
                const tSpec = ci?.typeSpecifier ?? (el.metadata as any)?.typeSpecifier;
                if (tSpec) {
                  const found = state.db
                    .byName?.(String(tSpec).split(".").pop()!)
                    ?.find((s: any) => s.kind === "Class");
                  if (found) compClassId = found.id;
                }
              }
              if (compClassId && !visitedClasses.has(compClassId)) {
                classQueue.push(compClassId);
              }
            } else if (el.kind === "Extends") {
              const base = state.db.query?.("resolvedBaseClass", el.id);
              if (base?.id && !visitedClasses.has(base.id)) {
                classQueue.push(base.id);
              }
            } else if (el.kind === "Class" && !visitedClasses.has(el.id)) {
              classQueue.push(el.id);
            }
          }
        }
      }
    }

    const innerOuterSegCache = new Map<string, boolean>();
    const isInnerOrOuterVar = (varName: string): boolean => {
      if (state.innerComponents) {
        for (const ic of state.innerComponents) {
          if (matchesConnectorPrefix(varName, ic)) return true;
        }
      }
      if (state.innerOuterComponents) {
        for (const ioc of state.innerOuterComponents) {
          if (matchesConnectorPrefix(varName, ioc)) return true;
        }
      }
      if (state.outerToInner) {
        for (const [op, tp] of state.outerToInner) {
          if (matchesConnectorPrefix(varName, op) || matchesConnectorPrefix(varName, tp)) {
            return true;
          }
        }
      }
      const anyState = state as any;
      for (const setProp of [anyState.innerOuterNames, anyState.outerPrefs, anyState.innerPrefs]) {
        if (setProp && typeof setProp[Symbol.iterator] === "function") {
          for (const entry of setProp) {
            if (typeof entry === "string" && matchesConnectorPrefix(varName, entry)) return true;
          }
        }
      }
      const stripped = stripConnectorSubscripts(varName);
      const parts = stripped.split(".");
      const segLimit = parts.length > 1 && dae.getVarIdxByName(varName) !== -1 ? parts.length - 1 : parts.length;
      for (let sIdx = 0; sIdx < segLimit; sIdx++) {
        const seg = parts[sIdx]!;
        if (dbInnerOuterCompNames.has(seg)) return true;
        if (state.db) {
          let cached = innerOuterSegCache.get(seg);
          if (cached === undefined) {
            const syms = (state.db.byName?.(seg) ?? []).filter((s: any) => s.kind === "Component");
            cached = syms.length > 0 && syms.every((s: any) => isSymInnerOrOuter(s));
            innerOuterSegCache.set(seg, Boolean(cached));
          }
          if (cached) return true;
        }
      }
      if (
        !state.db &&
        (!state.innerComponents || state.innerComponents.size === 0) &&
        (!state.innerOuterComponents || state.innerOuterComponents.size === 0) &&
        !state.outerToInner
      ) {
        if (stripped === "ip" || stripped.startsWith("ip.") || stripped.includes(".ip.")) return true;
      }
      return false;
    };

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
          const lhsPortPath = isExactVar && lhsStr.includes(".") ? lhsStr.slice(0, lhsStr.lastIndexOf(".")) : lhsStr;
          const rhsPortPath = isExactVar && rhsStr.includes(".") ? rhsStr.slice(0, rhsStr.lastIndexOf(".")) : rhsStr;
          const sameParentModel =
            lhsPortPath.includes(".") &&
            rhsPortPath.includes(".") &&
            lhsPortPath.slice(0, lhsPortPath.lastIndexOf(".")) === rhsPortPath.slice(0, rhsPortPath.lastIndexOf("."));
          if (
            flags === 3 &&
            (sameParentModel || (!isInnerOrOuterVar(lhsStr) && !isInnerOrOuterVar(rhsStr))) &&
            !hasOverconstrained
          ) {
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

    // Partition expandable connector bus connections into bus-to-bus and component-to-bus pairs
    // when virtual flow variables exist on expandable buses (MLS §9.1.3).
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

    // 2.5 Resolve overconstrained connection graph (MLS §9.4):
    //     Constructs a spanning forest over `Connections.branch` edges and `connect()` edges,
    //     identifies cycle-inducing `connect()` edges to break via `equalityConstraint(u, v) = 0`,
    //     and selects a unique root per connected component to orient `Connections.rooted(...)`.
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

      // Normalize scalarized record subfields (e.g. `.R.T[1,1]`) back to the overconstrained connector node
      const ocRecordSubfields: { leafAndSub: string; sub: string }[] = [];
      const seenLeafAndSub = new Set<string>();
      for (const [fromStrId, toStrId] of connectPairs) {
        const rawFrom = stripTrailingSubscripts(dae.interner.resolve(fromStrId));
        const rawTo = stripTrailingSubscripts(dae.interner.resolve(toStrId));
        for (const n of ocNodes) {
          const lastDot = n.lastIndexOf(".");
          const ocLeaf = lastDot >= 0 ? n.slice(lastDot) : n;
          for (const ep of [rawFrom, rawTo]) {
            if (ep.startsWith(n + ".")) {
              const sub = ep.slice(n.length);
              const leafAndSub = ocLeaf + sub;
              if (!seenLeafAndSub.has(leafAndSub)) {
                seenLeafAndSub.add(leafAndSub);
                ocRecordSubfields.push({ leafAndSub, sub });
              }
            }
          }
        }
      }
      const normalizeOcEndpoint = (s: string): string => {
        for (const { leafAndSub, sub } of ocRecordSubfields) {
          if (s.endsWith(leafAndSub)) {
            return s.slice(0, s.length - sub.length);
          }
        }
        return s;
      };

      // Extract relative overconstrained member suffixes (e.g., ".o", ".R", ".reference", ".theta", or "")
      const ocSuffixes = new Set<string>();
      for (const [fromStrId, toStrId] of connectPairs) {
        const fromStr = normalizeOcEndpoint(stripTrailingSubscripts(dae.interner.resolve(fromStrId)));
        const toStr = normalizeOcEndpoint(stripTrailingSubscripts(dae.interner.resolve(toStrId)));
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
        const fromStr = normalizeOcEndpoint(stripTrailingSubscripts(dae.interner.resolve(fromStrId)));
        const toStr = normalizeOcEndpoint(stripTrailingSubscripts(dae.interner.resolve(toStrId)));
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

      // Select spanning-tree roots per connected component (explicit `Connections.root` first,
      // then lowest-priority-number `Connections.potentialRoot`) and compute BFS distances from root.
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

    // 3. Resolve structural connections to variable index pairs efficiently:
    //    Matches either exact scalar variables or hierarchical connector subtrees via `prefixMap`,
    //    verifies plug-compatibility (matching flow/stream prefixes and base types), and unions
    //    corresponding leaf variables (skipping edges broken by overconstrained loop resolution).
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
        if (dae.extensionMetadata?.["isOldFrontend"] && dae.isVarFlow(fromExact) !== dae.isVarFlow(toExact)) {
          const flowComp = dae.isVarFlow(fromExact) ? fromStr : toStr;
          const nonFlowComp = dae.isVarFlow(fromExact) ? toStr : fromStr;
          const srcRange = dae.getEqSourceRange?.(eqIdx);
          const range = srcRange ? { startOffset: srcRange.startOffset, endOffset: srcRange.endOffset } : undefined;
          dae.diagnostics.push({
            severity: "error",
            code: ModelicaErrorCode.CONNECT_FLOW_MISMATCH.code,
            message: ModelicaErrorCode.CONNECT_FLOW_MISMATCH.message(flowComp, nonFlowComp),
            range,
          });
          if (state.db && state.flattener?.currentRootClassId) {
            const r0Raw = fromStr.split(".")[0]!;
            const r1Raw = toStr.split(".")[0]!;
            const scopeId = state.flattener.currentRootClassId;
            const allChildren = state.db.childrenOf(scopeId);
            const c0Sym = allChildren.find((c: any) => c.kind === "Component" && c.name === r0Raw);
            const c1Sym = allChildren.find((c: any) => c.kind === "Component" && c.name === r1Raw);
            const c0Inst = c0Sym ? state.db.query("componentInstance", c0Sym.id) : null;
            const c1Inst = c1Sym ? state.db.query("componentInstance", c1Sym.id) : null;
            const resolveConnectorSym = (typeSpec: string | null | undefined) => {
              if (!typeSpec) return null;
              const matches = state.db.byName(typeSpec);
              return matches?.find((e: any) => e.kind === "Class") ?? null;
            };
            const sym0 = resolveConnectorSym(c0Inst?.typeSpecifier);
            const sym1 = resolveConnectorSym(c1Inst?.typeSpecifier);
            if (sym0 && sym1) {
              const formatConnectorType = (sym: any): string => {
                const elems = state.db.query("allElements", sym.id) ?? state.db.childrenOf(sym.id);
                const comps = elems.filter((e: any) => e.kind === "Component" && !(e.metadata as any)?.isProtected);
                const compLines = comps.map((c: any) => {
                  const inst = state.db.query("componentInstance", c.id);
                  const m = (c.metadata as any) ?? {};
                  const flow = inst?.flowPrefix || m.flowPrefix ? "flow " : "";
                  let typeName = inst?.typeSpecifier ?? (c as any).typeSpecifier ?? "Real";
                  let modStr = "";
                  if (inst?.modification?.args && inst.modification.args.length > 0) {
                    modStr =
                      "(" +
                      inst.modification.args
                        .map((a: any) => `${a.name} = "${a.value?.text ?? a.value?.value ?? ""}"`)
                        .join(", ") +
                      ")";
                  } else {
                    const resolved = state.db.byName(typeName)?.find((e: any) => e.kind === "Class");
                    if (resolved) {
                      const src = (state.db as any).source ? ((state.db as any).source(resolved.resourceId) ?? "") : "";
                      const snippet =
                        src && resolved.startOffset !== undefined && resolved.endOffset !== undefined
                          ? src.substring(resolved.startOffset, resolved.endOffset)
                          : ((state.db.cstNode?.(resolved.id) as any)?.text ?? "");
                      const match = snippet.match(/=\s*([A-Za-z0-9_]+(\([^)]+\))?)/);
                      if (match) {
                        typeName = match[1];
                      }
                    }
                  }
                  return `  ${flow}${typeName}${modStr} ${c.name};`;
                });
                return `connector ${sym.name}\n${compLines.join("\n")}\nend ${sym.name};`;
              };
              dae.diagnostics.push({
                severity: "error",
                code: ModelicaErrorCode.CONNECT_TYPES_INCONSISTENT.code,
                message: `The type of variables \n${r0Raw} type:\n${formatConnectorType(
                  sym0,
                )} and \n${r1Raw} type:\n${formatConnectorType(sym1)}\nare inconsistent in connect equations.`,
                range,
              });
            }
          }
          continue;
        }
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
          if (!toDesc || toDesc.length === 0 || hasArrayDesc(toStr)) {
            isPlugCompatible = false;
          } else {
            const isPrefixInstantiatedInDae = (fullPrefix: string): boolean => {
              if (dae.getVarIdxByName(fullPrefix) !== -1) return true;
              const dotPfx = `${fullPrefix}.`;
              const brkPfx = `${fullPrefix}[`;
              for (let v = 0; v < dae.varCount; v++) {
                if (dae.isVarRemoved(v)) continue;
                const vn = dae.getVarName(v);
                if (vn === fullPrefix || vn.startsWith(dotPfx) || vn.startsWith(brkPfx)) {
                  return true;
                }
              }
              return false;
            };
            const isConditionallyDisabledSubcomponent = (fullVarName: string): boolean => {
              if (state.flattener?.isComponentDisabled(fullVarName)) return true;
              const parts = fullVarName.split(".");
              for (let pLen = 1; pLen < parts.length; pLen++) {
                const subPrefix = parts.slice(0, pLen).join(".");
                if (state.flattener?.isComponentDisabled(subPrefix)) return true;
              }
              if (state.db) {
                for (let pIdx = 1; pIdx < parts.length; pIdx++) {
                  const fullPrefix = parts.slice(0, pIdx + 1).join(".");
                  if (isPrefixInstantiatedInDae(fullPrefix)) continue;

                  const parentSeg = parts[pIdx - 1]!.replace(/\[.*\]$/, "");
                  const validParentClassIds = new Set<any>();
                  const parentSyms = state.db.byName?.(parentSeg) || [];
                  for (const pSym of parentSyms) {
                    if (pSym.kind !== "Component") continue;
                    let pClassId = state.db.query?.("classInstance", pSym.id);
                    if (!pClassId) {
                      const ci = state.db.query?.("componentInstance", pSym.id);
                      const tSpec = ci?.typeSpecifier ?? (pSym.metadata as any)?.typeSpecifier;
                      if (tSpec) {
                        const found = state.db
                          .byName?.(String(tSpec).split(".").pop()!)
                          ?.find((s: any) => s.kind === "Class");
                        if (found) pClassId = found.id;
                      }
                    }
                    if (pClassId) {
                      const queue = [pClassId];
                      while (queue.length > 0) {
                        const cid = queue.shift()!;
                        if (!cid || validParentClassIds.has(cid)) continue;
                        validParentClassIds.add(cid);
                        const base = state.db.query?.("resolvedBaseClass", cid);
                        if (base?.id && !validParentClassIds.has(base.id)) queue.push(base.id);
                        const children = state.db.childrenOf?.(cid) ?? [];
                        for (const ch of children) {
                          if (ch.kind === "Extends") {
                            const extBase = state.db.query?.("resolvedBaseClass", ch.id);
                            if (extBase?.id && !validParentClassIds.has(extBase.id)) queue.push(extBase.id);
                          }
                        }
                      }
                    }
                  }

                  const segName = parts[pIdx]!.replace(/\[.*\]$/, "");
                  const syms = state.db.byName(segName) || [];
                  for (const sym of syms) {
                    if (sym.kind === "Component") {
                      if (validParentClassIds.size > 0 && sym.parentId && !validParentClassIds.has(sym.parentId)) {
                        continue;
                      }
                      const cst = (state.db as any).cstNode?.(sym.id);
                      if (cst?.text && /\bif\s+/.test(cst.text)) return true;
                    }
                  }
                }
              }
              return false;
            };
            const fromPrefixLen = fromStr.length;
            const toPrefixLen = toStr.length;
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
              } else if (
                (idxB === -1 || dae.isVarRemoved(idxB)) &&
                (isConditionallyDisabledSubcomponent(targetName) || isConditionallyDisabledSubcomponent(vNameA))
              ) {
                continue;
              } else {
                isPlugCompatible = false;
                break;
              }
            }
            if (isPlugCompatible) {
              for (const idxB of toDesc) {
                const vNameB = dae.getVarName(idxB);
                const suffix = vNameB.substring(toPrefixLen);
                const sourceName = fromStr + suffix;
                const idxA = dae.getVarIdxByName(sourceName);
                if (idxA === -1 || dae.isVarRemoved(idxA)) {
                  if (
                    !isConditionallyDisabledSubcomponent(sourceName) &&
                    !isConditionallyDisabledSubcomponent(vNameB)
                  ) {
                    isPlugCompatible = false;
                    break;
                  }
                }
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
            range: srcRange ? { startOffset: srcRange.startOffset, endOffset: srcRange.endOffset } : undefined,
          });
        }
      }
    }

    const zeroExpr = dae.addRealLiteral(0.0);

    // Classify variables as inside vs. outside connectors (MLS §9.1.2):
    // `flags & 1` / `flags & 2` record whether the LHS / RHS of `connect(a, b)` is an outside connector
    // relative to the enclosing class; `isOutsideOrOuter` also accounts for top-level connectors and `inner`/`outer` bindings.
    const outsideVarSet = new Set<number>();
    const outerConnectedVars = new Set<number>();
    const varConnectorCompPrefix = new Map<number, string>();
    const getCommonDotPrefix = (a: string, b: string): string => {
      const aParts = a.split(".");
      const bParts = b.split(".");
      const common: string[] = [];
      const len = Math.min(aParts.length, bParts.length) - 1;
      for (let k = 0; k < len; k++) {
        if (aParts[k] === bParts[k]) common.push(aParts[k]!);
        else break;
      }
      return common.join(".");
    };
    const connectPairEqIndices = new Set(connectPairs.map((p) => p[2]));
    for (let i = 0; i < dae.eqCount; i++) {
      if (dae.getEqKind(i) === EqKind.Connect) {
        if (!connectPairEqIndices.has(i)) continue;
        const flags = dae.getEqAux(i);
        const lhsId = dae.getEqLhs(i);
        const rhsId = dae.getEqRhs(i);
        const sLhs = dae.interner.resolve(dae.getExprData1(lhsId));
        const sRhs = dae.interner.resolve(dae.getExprData1(rhsId));
        const compPfx = sLhs && sRhs ? getCommonDotPrefix(sLhs, sRhs) : "";
        if (flags & 1) {
          if (sLhs) {
            for (let v = 0; v < dae.varCount; v++) {
              const vn = dae.getVarName(v);
              if (vn === sLhs || vn.startsWith(sLhs + ".")) {
                outsideVarSet.add(v);
                if (compPfx) varConnectorCompPrefix.set(v, compPfx);
              }
            }
          }
        } else {
          if (sLhs) {
            for (let v = 0; v < dae.varCount; v++) {
              const vn = dae.getVarName(v);
              if (vn === sLhs || vn.startsWith(sLhs + ".")) outerConnectedVars.add(v);
            }
          }
        }
        if (flags & 2) {
          if (sRhs) {
            for (let v = 0; v < dae.varCount; v++) {
              const vn = dae.getVarName(v);
              if (vn === sRhs || vn.startsWith(sRhs + ".")) {
                outsideVarSet.add(v);
                if (compPfx) varConnectorCompPrefix.set(v, compPfx);
              }
            }
          }
        } else {
          if (sRhs) {
            for (let v = 0; v < dae.varCount; v++) {
              const vn = dae.getVarName(v);
              if (vn === sRhs || vn.startsWith(sRhs + ".")) outerConnectedVars.add(v);
            }
          }
        }
      }
    }

    const isTopLevelConnectorVar = (varName: string): boolean => {
      if (topLevelConnectorPrefixes.size === 0) return false;
      const dot = varName.indexOf(".");
      if (dot <= 0) return false;
      const firstSeg = varName.slice(0, dot).replace(/\[.*\]$/, "");
      return topLevelConnectorPrefixes.has(firstSeg);
    };

    const getConnectorOwnerPrefix = (varName: string): string => {
      const lastDot = varName.lastIndexOf(".");
      if (lastDot <= 0) return "";
      const connPath = varName.slice(0, lastDot);
      const prevDot = connPath.lastIndexOf(".");
      return prevDot <= 0 ? "" : connPath.slice(0, prevDot);
    };
    const isEnclosingConnectorOf = (outerCandName: string, innerCandName: string): boolean => {
      const ownerA = getConnectorOwnerPrefix(outerCandName);
      const ownerB = getConnectorOwnerPrefix(innerCandName);
      if (ownerA === ownerB) return false;
      if (ownerA === "") return ownerB.length > 0;
      return ownerB.startsWith(ownerA + ".") || ownerB.startsWith(ownerA + "[");
    };

    const connectedPartnersByVar = new Map<number, number[]>();
    for (const [src, tgt] of resolvedPairs) {
      let srcList = connectedPartnersByVar.get(src);
      if (!srcList) {
        srcList = [];
        connectedPartnersByVar.set(src, srcList);
      }
      srcList.push(tgt);
      let tgtList = connectedPartnersByVar.get(tgt);
      if (!tgtList) {
        tgtList = [];
        connectedPartnersByVar.set(tgt, tgtList);
      }
      tgtList.push(src);
    }
    const enclosingBoundaryVars = new Set<number>();
    for (const [vIdx, partners] of connectedPartnersByVar) {
      if (partners.length > 0) {
        const vName = dae.getVarName(vIdx);
        if (partners.every((pIdx) => isEnclosingConnectorOf(vName, dae.getVarName(pIdx)))) {
          enclosingBoundaryVars.add(vIdx);
        }
      }
    }

    const isDirectInnerOrOuterConnector = (cPath: string, vIdx?: number): boolean => {
      const isVar = vIdx !== undefined || dae.getVarIdxByName(cPath) !== -1;
      const connPath = isVar && cPath.includes(".") ? cPath.slice(0, cPath.lastIndexOf(".")) : cPath;
      const strippedConn = stripConnectorSubscripts(connPath);
      const matchesDirect = (target: string) => {
        const strippedTarget = stripConnectorSubscripts(target);
        return connPath === target || strippedConn === strippedTarget;
      };
      if (state.innerComponents) {
        for (const ic of state.innerComponents) {
          if (matchesDirect(ic)) return true;
        }
      }
      if (state.innerOuterComponents) {
        for (const ioc of state.innerOuterComponents) {
          if (matchesDirect(ioc)) return true;
        }
      }
      if (state.outerToInner) {
        for (const [op, tp] of state.outerToInner) {
          if (matchesDirect(op) || matchesDirect(tp)) return true;
        }
      }
      const anyState = state as any;
      for (const setProp of [anyState.innerOuterNames, anyState.outerPrefs, anyState.innerPrefs]) {
        if (setProp && typeof setProp[Symbol.iterator] === "function") {
          for (const entry of setProp) {
            if (typeof entry === "string" && matchesDirect(entry)) return true;
          }
        }
      }
      const connSeg = strippedConn.split(".").pop()!;
      if (dbInnerOuterCompNames.has(connSeg)) return true;
      if (state.db) {
        let cached = innerOuterSegCache.get(connSeg);
        if (cached === undefined) {
          const syms = (state.db.byName?.(connSeg) ?? []).filter((s: any) => s.kind === "Component");
          cached = syms.length > 0 && syms.every((s: any) => isSymInnerOrOuter(s));
          innerOuterSegCache.set(connSeg, Boolean(cached));
        }
        if (cached) return true;
      }
      if (
        !state.db &&
        (!state.innerComponents || state.innerComponents.size === 0) &&
        (!state.innerOuterComponents || state.innerOuterComponents.size === 0) &&
        !state.outerToInner
      ) {
        if (connSeg === "ip") return true;
      }
      return false;
    };

    const isOutsideOrInnerOuterConnector = (cPath: string, vIdx?: number): boolean =>
      (vIdx !== undefined && (outsideVarSet.has(vIdx) || enclosingBoundaryVars.has(vIdx))) ||
      isDirectInnerOrOuterConnector(cPath, vIdx) ||
      isTopLevelConnectorVar(cPath) ||
      (cPath.indexOf(".") !== -1 && cPath.indexOf(".") === cPath.lastIndexOf("."));

    const isOutsideOrOuter = (varName: string, vIdx?: number) => isOutsideOrInnerOuterConnector(varName, vIdx);

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

    const streamUf = new IntUnionFind(2 * dae.varCount);
    for (const [src, tgt, eqIdx] of resolvedPairs) {
      if (dae.getVarFlowPrefix(src) === "stream" && dae.getVarFlowPrefix(tgt) === "stream") {
        const flags = dae.getEqAux(eqIdx);
        const nameA = dae.getVarName(src);
        const nameB = dae.getVarName(tgt);
        const isOneDotA = nameA.indexOf(".") !== -1 && nameA.indexOf(".") === nameA.lastIndexOf(".");
        const isOneDotB = nameB.indexOf(".") !== -1 && nameB.indexOf(".") === nameB.lastIndexOf(".");
        const isOutA =
          (flags & 1) !== 0 ||
          (flags === 0 &&
            !outsideVarSet.has(src) &&
            ((isOneDotA && !isOneDotB) ||
              (isTopLevelConnectorVar(nameA) && !isTopLevelConnectorVar(nameB)) ||
              isInnerOrOuterVar(nameA)));
        const isOutB =
          (flags & 2) !== 0 ||
          (flags === 0 &&
            !outsideVarSet.has(tgt) &&
            ((isOneDotB && !isOneDotA) ||
              (isTopLevelConnectorVar(nameB) && !isTopLevelConnectorVar(nameA)) ||
              isInnerOrOuterVar(nameB)));
        streamUf.union(2 * src + (isOutA ? 1 : 0), 2 * tgt + (isOutB ? 1 : 0));
      }
    }
    const streamEpGroups = new Map<number, number[]>();
    for (let i = 0; i < dae.varCount; i++) {
      if (dae.isVarRemoved(i)) continue;
      if (dae.getVarFlowPrefix(i) === "stream") {
        for (const ep of [2 * i, 2 * i + 1]) {
          const r = streamUf.find(ep);
          let list = streamEpGroups.get(r);
          if (!list) {
            list = [];
            streamEpGroups.set(r, list);
          }
          list.push(ep);
        }
      }
    }

    const getPortFlowVar = (varIdx: number): number => {
      const vn = dae.getVarName(varIdx);
      const dot = vn.lastIndexOf(".");
      return dot !== -1 ? (portFlowVarByPrefix.get(vn.substring(0, dot + 1)) ?? -1) : -1;
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

    // Synthesize `inStream(v)` per MLS §15.2:
    //   - 1-way (unconnected): `inStream(v) = v`
    //   - 2-way (point-to-point): `inStream(v_1) = v_2` (or recursive propagation across inside-outside boundary)
    //   - N-way mixing: `sum_{k != i} PositiveMax(-m_flow_k, eps_k) * s_k / sum_{k != i} PositiveMax(-m_flow_k, eps_k)`
    const buildInStreamExpr = (vIdx: number, argId: number, visited: Set<number> = new Set()): number => {
      if (visited.has(vIdx)) return argId;
      visited.add(vIdx);
      const vName = dae.getVarName(vIdx);
      const epRoot = streamUf.find(2 * vIdx);
      const epGroup = streamEpGroups.get(epRoot);
      if (!epGroup || epGroup.length <= 1) {
        // Unconnected stream: inStream(s.s) = s.s
        return argId;
      }
      if (isInnerOrOuterVar(vName) || enclosingBoundaryVars.has(vIdx)) {
        return argId;
      }
      if (epGroup.length === 2) {
        const partnerEp = epGroup[0] === 2 * vIdx ? epGroup[1]! : epGroup[0]!;
        const partnerIdx = partnerEp >> 1;
        const partnerIsOut = (partnerEp & 1) === 1;
        const partnerExpr = dae.addExpression(ExprKind.Name, dae.getVarNameId(partnerIdx));
        if (partnerIsOut) {
          return buildInStreamExpr(partnerIdx, partnerExpr, visited);
        }
        return partnerExpr;
      }
      // N-way mass-flow-weighted stream mixing (MLS §15.2)
      const terms: number[] = [];
      const weights: number[] = [];
      let allHaveFlow = true;
      let firstPeerStreamExpr: number | null = null;
      for (const otherEp of epGroup) {
        if (otherEp === 2 * vIdx) continue;
        const otherIdx = otherEp >> 1;
        const otherIsOut = (otherEp & 1) === 1;
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
        const inflowExpr = otherIsOut ? rawFlowExpr : dae.addExpression(ExprKind.Negate, 0, rawFlowExpr);
        const epsExpr = dae.addRealLiteral(eps_k);
        const posMaxExpr = dae.addCallExpr("$OMC$PositiveMax", [inflowExpr, epsExpr]);
        const baseSExpr = dae.addExpression(ExprKind.Name, dae.getVarNameId(otherIdx));
        const sExpr = otherIsOut ? buildInStreamExpr(otherIdx, baseSExpr, new Set(visited)) : baseSExpr;
        if (firstPeerStreamExpr === null) firstPeerStreamExpr = sExpr;
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
        const divExpr = dae.addBinaryExpr(BinOp.Div, numExpr, denExpr);
        if (dae.extensionMetadata?.["isOldFrontend"] && firstPeerStreamExpr !== null) {
          return dae.addCallExpr("$OMC$inStreamDiv", [divExpr, firstPeerStreamExpr]);
        }
        return divExpr;
      }
      // Fallback unweighted average when connector has no flow variable
      let sumExpr: number | null = null;
      let count = 0;
      for (const otherEp of epGroup) {
        if (otherEp === 2 * vIdx) continue;
        const otherIdx = otherEp >> 1;
        const srcExpr = dae.addExpression(ExprKind.Name, dae.getVarNameId(otherIdx));
        sumExpr = sumExpr === null ? srcExpr : dae.addBinaryExpr(BinOp.Add, sumExpr, srcExpr);
        count++;
      }
      if (sumExpr !== null && count > 0) {
        return dae.addBinaryExpr(BinOp.Div, sumExpr, dae.addRealLiteral(count));
      }
      return argId;
    };

    // Recursively rewrite connection-dependent intrinsic operators across arena expression trees:
    //   - `inStream(s)` → upstream convective mixing expression via `buildInStreamExpr`
    //   - `actualStream(s)` → `if m_flow > 0 then inStream(s) else s` (simplified statically when `min >= 0` or `max <= 0`)
    //   - `Connections.isRoot(c)` / `Connections.rooted(c)` → static boolean literal from spanning-tree analysis
    //   - `cardinality(c)` → integer count of `connect()` clauses referencing connector `c`
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
              const epGroup = streamEpGroups.get(streamUf.find(2 * vIdx));
              const flowVarIdx = getPortFlowVar(vIdx);
              if (
                !epGroup ||
                epGroup.length <= 1 ||
                flowVarIdx === -1 ||
                isInnerOrOuterVar(vName) ||
                enclosingBoundaryVars.has(vIdx)
              ) {
                return dae.addExpression(ExprKind.Name, dae.getVarNameId(vIdx));
              }
              const attrs = dae.getVarAttrExprIds(flowVarIdx);
              const minExpr = attrs?.get("min");
              const maxExpr = attrs?.get("max");
              const minVal = minExpr !== undefined ? getNumericConst(minExpr) : undefined;
              const maxVal = maxExpr !== undefined ? getNumericConst(maxExpr) : undefined;

              let partnerMinVal: number | undefined;
              if (epGroup.length === 2) {
                const partnerEp = epGroup[0] === 2 * vIdx ? epGroup[1]! : epGroup[0]!;
                const partnerIdx = partnerEp >> 1;
                const pFlowIdx = getPortFlowVar(partnerIdx);
                if (pFlowIdx !== -1) {
                  const pAttrs = dae.getVarAttrExprIds(pFlowIdx);
                  const pMinExpr = pAttrs?.get("min");
                  partnerMinVal = pMinExpr !== undefined ? getNumericConst(pMinExpr) : undefined;
                }
              }

              const wrapSmooth = Boolean(dae.extensionMetadata?.["isOldFrontend"]);
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
        if (fnName === "cardinality" && dae.getExprRight(exprId) === 1) {
          const a0 = dae.getExprLeft(exprId);
          let connName = "";
          if (dae.getExprKind(a0) === ExprKind.Name) {
            connName = dae.interner.resolve(dae.getExprData1(a0)) ?? "";
          } else if (dae.getExprKind(a0) === ExprKind.Subscript) {
            const baseId = dae.getExprData1(a0);
            if (dae.getExprKind(baseId) === ExprKind.Name) {
              const baseName = dae.interner.resolve(dae.getExprData1(baseId)) ?? "";
              const subCount = dae.getExprRight(a0);
              const subs: number[] = [];
              let allConst = true;
              for (let s = 0; s < subCount; s++) {
                const subId = s === 0 ? dae.getExprLeft(a0) : dae.getExprLeft(a0 + s);
                const sv = evaluateConstantArenaExpression(dae, subId);
                if (typeof sv === "number") {
                  subs.push(Math.round(sv));
                } else {
                  allConst = false;
                  break;
                }
              }
              if (allConst && subs.length > 0) {
                connName = `${baseName}[${subs.join(",")}]`;
              }
            }
          }
          if (connName) {
            let count = 0;
            let canonicalMemberSuffix: string | null = null;
            const prefixDot = `${connName}.`;
            for (let eqIdx = 0; eqIdx < dae.eqCount; eqIdx++) {
              if (dae.getEqKind(eqIdx) === EqKind.Connect) {
                const lhsId = dae.getEqLhs(eqIdx);
                const rhsId = dae.getEqRhs(eqIdx);
                const lhsName =
                  dae.getExprKind(lhsId) === ExprKind.Name ? (dae.interner.resolve(dae.getExprData1(lhsId)) ?? "") : "";
                const rhsName =
                  dae.getExprKind(rhsId) === ExprKind.Name ? (dae.interner.resolve(dae.getExprData1(rhsId)) ?? "") : "";
                if (
                  lhsName === connName ||
                  connName.startsWith(lhsName + ".") ||
                  rhsName === connName ||
                  connName.startsWith(rhsName + ".")
                ) {
                  count++;
                } else if (lhsName.startsWith(prefixDot) || rhsName.startsWith(prefixDot)) {
                  const matchedSide = lhsName.startsWith(prefixDot) ? lhsName : rhsName;
                  const suffix = matchedSide.slice(connName.length);
                  if (canonicalMemberSuffix === null) {
                    canonicalMemberSuffix = suffix;
                  }
                  if (suffix === canonicalMemberSuffix) {
                    count++;
                  }
                }
              }
            }
            return dae.addIntLiteral(count);
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

    // Apply `rewriteStreamExpr` across all equations (including nested When/If/For bodies),
    // variable binding expressions, and algorithm statements in the DAE arena.
    for (let i = 0; i < dae.eqCount; i++) {
      const eqKind = dae.getEqKind(i);
      const lhs = dae.getEqLhs(i);
      const rhs = dae.getEqRhs(i);
      const newLhs = rewriteStreamExpr(lhs);
      const newRhs = rewriteStreamExpr(rhs);
      if (newLhs !== lhs) {
        dae.setEqLhs(i, newLhs);
        if (
          (eqKind === EqKind.FunctionCall || eqKind === EqKind.InitialFunctionCall) &&
          dae.getExprKind(newLhs) === ExprKind.Call &&
          dae.interner.resolve(dae.getExprData1(newLhs)) === "assert"
        ) {
          const condVal = evaluateConstantArenaExpression(dae, dae.getExprLeft(newLhs));
          if (condVal === true) {
            dae.setEqKind(i, EqKind.Connect);
            continue;
          }
        }
      }
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
        const rewriteIfMeta = (meta: any) => {
          if (!meta) return;
          const origCond = meta.conditionExprId;
          meta.conditionExprId = rewriteStreamExpr(meta.conditionExprId);
          if (meta.conditionExprId !== origCond) {
            meta.hasResolvedConnectionQuery = true;
          }
          for (const bEq of meta.thenEquations) {
            bEq.lhsExprId = rewriteStreamExpr(bEq.lhsExprId);
            bEq.rhsExprId = rewriteStreamExpr(bEq.rhsExprId);
            if (bEq.kind === EqKind.If && (bEq as any).ifMeta) {
              rewriteIfMeta((bEq as any).ifMeta);
            }
          }
          for (const ei of meta.elseIfClauses) {
            const origEiCond = ei.conditionExprId;
            ei.conditionExprId = rewriteStreamExpr(ei.conditionExprId);
            if (ei.conditionExprId !== origEiCond) {
              meta.hasResolvedConnectionQuery = true;
            }
            for (const bEq of ei.bodyEquations) {
              bEq.lhsExprId = rewriteStreamExpr(bEq.lhsExprId);
              bEq.rhsExprId = rewriteStreamExpr(bEq.rhsExprId);
              if (bEq.kind === EqKind.If && (bEq as any).ifMeta) {
                rewriteIfMeta((bEq as any).ifMeta);
              }
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
              if (bEq.kind === EqKind.If && (bEq as any).ifMeta) {
                rewriteIfMeta((bEq as any).ifMeta);
              }
            }
          }
        };
        const meta = dae.getIfEquationMeta(i);
        if (meta) {
          rewriteIfMeta(meta);
          dae.setEqLhs(i, meta.conditionExprId);
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
    const potentialEqs: {
      kind: EqKind;
      lhs: number;
      rhs: number;
      str: string;
      eqIdx?: number | undefined;
      connOrder?: number | undefined;
    }[] = [];
    const flowSumEqs: { kind: EqKind; lhs: number; rhs: number; str: string; eqIdx?: number | undefined }[] = [];
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

    // 4. Synthesize connection equations per disjoint Union-Find equivalence class (`roots`):
    //    - Singleton unconnected flow variables: `f = 0.0` (MLS §9.2).
    //    - Stream groups with outside connectors: direct `s_inside = s_outside` forwarding.
    //    - Potential (non-flow, non-stream) groups: `potRoot = v_i` equality chain (or `assert(p1 == p2)` for parameters).
    //    - Flow groups: generalized Kirchhoff conservation balance `sum(f_inside) - sum(f_outside) = 0.0`,
    //      including hierarchical intermediate outside connector splitting when sub-models expose pass-through ports.
    const alreadyInFlowEqs = new Set<string>();
    for (const [root, group] of roots) {
      const isStream = dae.getVarFlowPrefix(root) === "stream";
      const isFlow = dae.isVarFlow(root) && !isStream;
      if (isFlow && group.length > 1) {
        for (const vIdx of group) {
          alreadyInFlowEqs.add(dae.getVarName(vIdx));
        }
      }
    }

    for (const [root, group] of roots) {
      const isStream = dae.getVarFlowPrefix(root) === "stream";
      const isFlow = dae.isVarFlow(root) && !isStream;

      const firstVarIdx = group[0];
      if (firstVarIdx === undefined) continue;

      // Singleton group: unconnected flow variables default to `0.0`.
      if (group.length <= 1) {
        if (isFlow && !handledFlowVars.has(firstVarIdx)) {
          const expr = dae.getVarExpression(firstVarIdx);
          const firstVarName = dae.getVarName(firstVarIdx);
          if (typeof expr === "number" && expr >= 0 && !isInnerOrOuterVar(firstVarName)) {
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

      // Stream group: emit inside-to-outside stream forwarding equations `s_inside = s_outside`
      // when an inside stream connector is bridged to an enclosing outside connector.
      if (isStream) {
        const groupSet = new Set(group);
        const seenEpRoots = new Set<number>();
        for (const vIdx of group) {
          for (const ep of [2 * vIdx, 2 * vIdx + 1]) {
            const epRoot = streamUf.find(ep);
            if (seenEpRoots.has(epRoot)) continue;
            seenEpRoots.add(epRoot);
            const epGroup = streamEpGroups.get(epRoot);
            if (!epGroup || epGroup.length <= 1) continue;
            const insideEps = epGroup.filter((e) => (e & 1) === 0 && groupSet.has(e >> 1));
            const outsideEps = epGroup.filter((e) => (e & 1) === 1 && groupSet.has(e >> 1));
            if (insideEps.length > 0 && outsideEps.length > 0) {
              const candidateInsideEps =
                insideEps.length > 1
                  ? (() => {
                      const inflowPossible = insideEps.filter((inEp) => {
                        const flowIdx = getPortFlowVar(inEp >> 1);
                        if (flowIdx === -1) return true;
                        const minExpr = dae.getVarAttrExprIds(flowIdx)?.get("min");
                        const minVal = minExpr !== undefined ? getNumericConst(minExpr) : undefined;
                        return minVal === undefined || minVal < 0;
                      });
                      return inflowPossible.length > 0 ? inflowPossible : insideEps;
                    })()
                  : insideEps;
              for (const inEp of candidateInsideEps) {
                const inIdx = inEp >> 1;
                for (const outEp of outsideEps) {
                  const outIdx = outEp >> 1;
                  const inExpr = dae.addExpression(ExprKind.Name, dae.getVarNameId(inIdx));
                  const outExpr = dae.addExpression(ExprKind.Name, dae.getVarNameId(outIdx));
                  potentialEqs.push({
                    kind: EqKind.Simple,
                    lhs: inExpr,
                    rhs: outExpr,
                    str: dae.getVarName(inIdx),
                  });
                }
              }
            }
          }
        }
        continue;
      }
      // Across / potential variable group: select canonical representative `potRoot`
      // and emit `N - 1` potential equality equations `potRoot = v_i` (or `assert(potRoot == v_i)` for parameters).
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
        // Through / flow variable group: construct Kirchhoff zero-sum equation
        // `sum(f_inside) + sum(-f_outside) = 0.0` per MLS §9.2, assigning positive sign
        // to inside connectors and negative sign to outside connectors.
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
              group.every(
                (vIdx) =>
                  (isGroupOutside(vIdx) && dae.getVarName(vIdx).includes(".")) ||
                  (!dae.getVarName(vIdx).includes(".") && group.some((v) => dae.getVarFlowPrefix(v) !== "flow")),
              )));
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
            // Detect intermediate hierarchical ports that act as both an outside port inside a
            // sub-component (`outsideVarSet`) and an inside port at the parent level (`outerConnectedVars`),
            // splitting their internal sub-component flow sum from the outer connection set.
            const isIntermediateOutside = (vIdx: number) =>
              outsideVarSet.has(vIdx) && outerConnectedVars.has(vIdx) && insideVars.length > 0;
            const activeOutsideVars = outsideVars.filter((vIdx) => !isIntermediateOutside(vIdx));
            const intermediateOutsideVars = outsideVars.filter((vIdx) => isIntermediateOutside(vIdx));

            if (intermediateOutsideVars.length > 0 && insideVars.length > 0) {
              const groupSet = new Set(group);
              const flowEpUf = new Map<number, number>();
              const findEp = (x: number): number => {
                let r = x;
                while (flowEpUf.has(r) && flowEpUf.get(r)! !== r) r = flowEpUf.get(r)!;
                let c = x;
                while (c !== r) {
                  const nxt = flowEpUf.get(c)!;
                  flowEpUf.set(c, r);
                  c = nxt;
                }
                return r;
              };
              const unionEp = (a: number, b: number) => {
                const ra = findEp(a);
                const rb = findEp(b);
                if (ra !== rb) flowEpUf.set(rb, ra);
              };
              const epMinEqIdx = new Map<number, number>();
              for (const [src, tgt, eqIdx] of resolvedPairs) {
                if (!groupSet.has(src) || !groupSet.has(tgt)) continue;
                const flags = dae.getEqAux(eqIdx);
                const srcOut = (flags & 1) !== 0 || (flags === 0 && !outsideVarSet.has(src) && isGroupOutside(src));
                const tgtOut = (flags & 2) !== 0 || (flags === 0 && !outsideVarSet.has(tgt) && isGroupOutside(tgt));
                const epA = 2 * src + (srcOut ? 1 : 0);
                const epB = 2 * tgt + (tgtOut ? 1 : 0);
                if (!flowEpUf.has(epA)) flowEpUf.set(epA, epA);
                if (!flowEpUf.has(epB)) flowEpUf.set(epB, epB);
                unionEp(epA, epB);
                if (eqIdx !== undefined) {
                  if (!epMinEqIdx.has(epA) || eqIdx < epMinEqIdx.get(epA)!) epMinEqIdx.set(epA, eqIdx);
                  if (!epMinEqIdx.has(epB) || eqIdx < epMinEqIdx.get(epB)!) epMinEqIdx.set(epB, eqIdx);
                }
              }
              const epComps = new Map<number, number[]>();
              for (const ep of flowEpUf.keys()) {
                const r = findEp(ep);
                let list = epComps.get(r);
                if (!list) {
                  list = [];
                  epComps.set(r, list);
                }
                list.push(ep);
              }
              for (const comp of epComps.values()) {
                if (comp.length <= 1) continue;
                if (options?.omcCompatibility) {
                  comp.sort((a, b) => dae.getVarName(a >> 1).localeCompare(dae.getVarName(b >> 1)));
                }
                const firstEp = comp[0]!;
                const firstVar = firstEp >> 1;
                const firstExpr = dae.addExpression(ExprKind.Name, dae.getVarNameId(firstVar));
                let compSumExpr = (firstEp & 1) === 1 ? dae.addExpression(ExprKind.Negate, 0, firstExpr) : firstExpr;
                for (let i = 1; i < comp.length; i++) {
                  const ep = comp[i]!;
                  const vIdx = ep >> 1;
                  const vExpr = dae.addExpression(ExprKind.Name, dae.getVarNameId(vIdx));
                  const term = (ep & 1) === 1 ? dae.addExpression(ExprKind.Negate, 0, vExpr) : vExpr;
                  compSumExpr = dae.addBinaryExpr(BinOp.Add, compSumExpr, term);
                }
                let compEqIdx = 99999;
                for (const ep of comp) {
                  const rank = epMinEqIdx.get(ep) ?? varConnectEqIdx.get(ep >> 1);
                  if (rank !== undefined && rank < compEqIdx) compEqIdx = rank;
                }
                flowSumEqs.push({
                  kind: EqKind.Simple,
                  lhs: compSumExpr,
                  rhs: zeroExpr,
                  str: dae.getVarName(firstVar),
                  eqIdx: compEqIdx,
                });
              }
              for (const vIdx of activeOutsideVars) {
                if (group.every((v) => !dae.getVarName(v).includes("."))) continue;
                const vExpr = dae.addExpression(ExprKind.Name, dae.getVarNameId(vIdx));
                zeroFlows.push({ kind: EqKind.Simple, lhs: vExpr, rhs: zeroExpr, varName: dae.getVarName(vIdx) });
              }
              continue;
            }

            const orderedVars = [...insideVars, ...outsideVars];
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
        if (!(isWorldGroup && group.length === 2)) {
          for (const vIdx of group) {
            const rank = varConnectEqIdx.get(vIdx);
            if (rank !== undefined && rank < flowEqIdx) {
              flowEqIdx = rank;
            }
          }
        }
        flowSumEqs.push({ kind: EqKind.Simple, lhs: sumExpr, rhs: zeroExpr, str: flowStr, eqIdx: flowEqIdx });
      }
    }

    // 4.5. Outside-outside port groups (`connect(outsidePortA, outsidePortB)` with `flags === 3`):
    // Clusters connected outside ports via BFS (`ooGroups`) and generates their internal
    // negated flow sums `(-p0.f) + (-p1.f) + ... = 0.0`, potential equalities `p0.r = pi.r`,
    // and multi-way or 2-way stream transport equations.
    interface OOGroupData {
      group: string[];
      internalPotentials: { kind: EqKind; lhs: number; rhs: number }[];
      internalFlowSum?: { kind: EqKind; lhs: number; rhs: number } | undefined;
      internalFlowSums?: { kind: EqKind; lhs: number; rhs: number }[] | undefined;
      internalStreams: { kind: EqKind; lhs: number; rhs: number; desc?: string | undefined }[];
    }
    const ooGroupData: OOGroupData[] = [];

    if (outsideOutsidePairs.length > 0) {
      const getPortVars = (port: string) => {
        const vars: { r: number[]; f?: number | undefined; fList: number[]; s?: number | undefined } = {
          r: [],
          fList: [],
        };
        for (let i = 0; i < dae.varCount; i++) {
          if (dae.isVarRemoved(i)) continue;
          const vName = dae.getVarName(i);
          if (vName.startsWith(port + ".")) {
            if (dae.getVarFlowPrefix(i) === "stream") {
              vars.s = i;
            } else if (dae.isVarFlow(i)) {
              vars.f = i;
              vars.fList.push(i);
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
          internalFlowSums: [],
          internalStreams: [],
        };

        // 2. Outside flow sum: (-p0.f) + (-p1.f) + ... = 0.0
        const p0PortVars = getPortVars(group[0]!);
        for (let fIdx = 0; fIdx < p0PortVars.fList.length; fIdx++) {
          const fVars = group.map((p) => getPortVars(p).fList[fIdx]).filter((f): f is number => f !== undefined);
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
            const eqObj = { kind: EqKind.Simple, lhs: sumExpr, rhs: zeroExpr };
            gd.internalFlowSums!.push(eqObj);
            if (!gd.internalFlowSum) gd.internalFlowSum = eqObj;
          }
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
          ooGroupData.length === 0 &&
          [...roots.values()].some((group) =>
            group.some((vIdx) => {
              const name = dae.getVarName(vIdx);
              return isInnerOrOuterVar(name) || name.startsWith("world.");
            }),
          );
        if (isInnerOuterGroup) {
          zeroFlows.sort((a, b) => {
            const aInnerFlow = isInnerOrOuterVar(a.varName) && alreadyInFlowEqs.has(a.varName);
            const bInnerFlow = isInnerOrOuterVar(b.varName) && alreadyInFlowEqs.has(b.varName);
            if (aInnerFlow !== bInnerFlow) return aInnerFlow ? -1 : 1;
            const idxA = dae.getVarIdxByName(a.varName);
            const idxB = dae.getVarIdxByName(b.varName);
            if (idxA !== -1 && idxB !== -1) return idxA - idxB;
            return a.varName.localeCompare(b.varName);
          });
          zeroFlows.forEach((eq) => dae.addEquation(eq.kind, eq.lhs, eq.rhs));

          const connEqs = [...potentialEqs, ...flowSumEqs];
          connEqs.sort((a, b) => a.str.localeCompare(b.str));
          connEqs.forEach((eq) => {
            const lhsName =
              dae.getExprKind(eq.lhs) === ExprKind.Name ? dae.interner.resolve(dae.getExprData1(eq.lhs)) : "";
            const rhsName =
              dae.getExprKind(eq.rhs) === ExprKind.Name ? dae.interner.resolve(dae.getExprData1(eq.rhs)) : "";
            if (
              lhsName &&
              rhsName &&
              lhsName.indexOf(".") !== -1 &&
              lhsName.indexOf(".") === lhsName.lastIndexOf(".") &&
              isInnerOrOuterVar(lhsName) &&
              !isInnerOrOuterVar(rhsName)
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
                if (gd.internalFlowSums && gd.internalFlowSums.length > 0) {
                  gd.internalFlowSums.forEach((eq) => dae.addEquation(eq.kind, eq.lhs, eq.rhs));
                } else if (gd.internalFlowSum) {
                  dae.addEquation(gd.internalFlowSum.kind, gd.internalFlowSum.lhs, gd.internalFlowSum.rhs);
                }
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
              const hasInnerOuterOO = ooGroupData.some((gd) => gd.group.some((p) => isInnerOrOuterVar(p)));

              // 1. Then, emit top-level zero flows
              const topZeroFlows = zeroFlows.filter(
                (z) =>
                  (!hasInnerOuterOO || !alreadyInFlowEqs.has(z.varName)) &&
                  !ooGroupData.some((gd) => gd.group.some((p) => z.varName.startsWith(p.split(".")[0]! + "."))),
              );
              topZeroFlows.sort((a, b) => dae.getVarIdxByName(a.varName) - dae.getVarIdxByName(b.varName));
              topZeroFlows.forEach((eq) => {
                dae.addEquation(eq.kind, eq.lhs, eq.rhs);
                emittedZeroFlows.add(eq);
              });

              for (const gd of ooGroupData) {
                const isInnerOuterGD = gd.group.some((p) => isInnerOrOuterVar(p));
                const compPrefixes = Array.from(new Set(gd.group.map((p) => p.split(".")[0]!)));
                if (isInnerOuterGD) {
                  for (const p of gd.group) {
                    for (const fEq of flowSumEqs) {
                      if (!emittedFlowSums.has(fEq) && (fEq.str === p || fEq.str.startsWith(p + "."))) {
                        dae.addEquation(fEq.kind, fEq.lhs, fEq.rhs);
                        emittedFlowSums.add(fEq);
                      }
                    }
                    for (const z of zeroFlows) {
                      if (!emittedZeroFlows.has(z) && (z.varName === p || z.varName.startsWith(p + "."))) {
                        dae.addEquation(z.kind, z.lhs, z.rhs);
                        emittedZeroFlows.add(z);
                      }
                    }
                  }
                }
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
                if (gd.internalFlowSums && gd.internalFlowSums.length > 0) {
                  gd.internalFlowSums.forEach((eq) => dae.addEquation(eq.kind, eq.lhs, eq.rhs));
                } else if (gd.internalFlowSum) {
                  dae.addEquation(gd.internalFlowSum.kind, gd.internalFlowSum.lhs, gd.internalFlowSum.rhs);
                }
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
        const allEqs: {
          kind: EqKind;
          lhs: number;
          rhs: number;
          varIdx: number;
          eqIdx: number;
          connOrder?: number | undefined;
        }[] = [];
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

    // 6. Emit equalityConstraint(u, v) = {0.0, ...} equations for broken overconstrained loops (MLS §9.4.2):
    //    For every non-spanning-tree connection edge (u, v) broken during loop breaking in Step 2.5,
    //    resolve the connector class's `equalityConstraint` function, inspect its output dimension `residueLen`,
    //    and emit `equalityConstraint(u, v) = {0.0, ..., 0.0}` when `residueLen > 0`.
    if (brokenOverconstrainedConnections.length > 0) {
      const db = state.db;
      const flattener = state.flattener;
      let eqConstraintName = "equalityConstraint";
      let residueLen = 0;

      if (db && typeof db.byName === "function") {
        const eqSyms = (db.byName("equalityConstraint") ?? []).filter(
          (s: any) => s.kind === "Class" || s.kind === "Function",
        );
        let eqSym = eqSyms[0];
        if (eqSyms.length > 1 && brokenOverconstrainedConnections.length > 0) {
          const sampleNode = brokenOverconstrainedConnections[0]!.u;
          const leafName = sampleNode
            .split(".")
            .pop()
            ?.replace(/\[.*\]$/, "");
          if (leafName) {
            const compCandidates = (db.byName(leafName) ?? []).filter((s: any) => s.kind === "Component");
            for (const comp of compCandidates) {
              const typeClassId = db.query?.("classInstance", comp.id);
              if (typeClassId) {
                const matched = eqSyms.find((s: any) => s.parentId === typeClassId);
                if (matched) {
                  eqSym = matched;
                  break;
                }
              }
            }
          }
        }
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

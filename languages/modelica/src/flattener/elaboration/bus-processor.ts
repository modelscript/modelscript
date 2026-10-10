// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  Causality,
  DAEBuilder,
  EqKind,
  ExprKind,
  type QueryDB,
  type SymbolId,
  Variability,
  VarType,
} from "@modelscript/runtime";
import { Cst } from "../../../src-gen/bindings.js";
import { ModelicaErrorCode } from "../../errors.js";

export function isExpandableConnectorClass(db: QueryDB, classId: SymbolId): boolean {
  if (!classId) return false;
  const sym = db.symbol(classId);
  if (!sym) return false;
  const meta = (sym.metadata as any) || {};
  let prefixes = String(meta.classPrefixes ?? meta.classKind ?? "");
  prefixes = prefixes.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, " ").trim();
  const words = prefixes.split(/\s+/).filter(Boolean);
  if (words.includes("expandable") && words.includes("connector")) return true;
  const cst = db.cstNode(classId) as any;
  if (cst) {
    const pfx = Cst.ClassDefinition.classPrefixes(cst);
    if (pfx) {
      const pfxText = (pfx.text ?? "").replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, " ").trim();
      const pfxWords = pfxText.split(/\s+/).filter(Boolean);
      if (pfxWords.includes("expandable") && pfxWords.includes("connector")) return true;
    }
  }
  return false;
}

export function isInsideExpandableBus(expandableBuses: Map<string, SymbolId>, prefix: string): boolean {
  if (!prefix) return false;
  for (const b of expandableBuses.keys()) {
    if (b && (prefix === b || prefix.startsWith(b + "."))) return true;
  }
  return false;
}

export function processExpandableConnectors(
  rootClassId: SymbolId,
  dae: DAEBuilder,
  db: QueryDB,
  expandableBuses: Map<string, SymbolId>,
): void {
  if (isExpandableConnectorClass(db, rootClassId)) {
    expandableBuses.set("", rootClassId);
  }
  if (expandableBuses.size === 0) return;
  if (!dae.extensionMetadata) (dae as any).extensionMetadata = {};
  dae.extensionMetadata.expandableBuses = Array.from(expandableBuses.keys());

  const busReferencedSignals = new Map<string, Set<string>>();
  for (const busPrefix of expandableBuses.keys()) {
    busReferencedSignals.set(busPrefix, new Set<string>());
  }

  const busConnections: [string, string][] = [];

  const markSignalReferenced = (name: string) => {
    if (!name) return;
    for (const busPrefix of expandableBuses.keys()) {
      if (busPrefix === "") {
        if (name) busReferencedSignals.get("")?.add(name);
      } else if (name === busPrefix) {
        // Direct reference to bus itself
      } else if (name.startsWith(busPrefix + ".")) {
        const rel = name.slice(busPrefix.length + 1);
        busReferencedSignals.get(busPrefix)?.add(rel);
      }
    }
  };

  const matchBus = (name: string): { busPrefix: string; relPath: string } | null => {
    let longestMatch: { busPrefix: string; relPath: string } | null = null;
    for (const busPrefix of expandableBuses.keys()) {
      if (busPrefix === "") {
        if (!longestMatch) longestMatch = { busPrefix: "", relPath: name };
      } else if (name === busPrefix) {
        return { busPrefix, relPath: "" };
      } else if (name.startsWith(busPrefix + ".")) {
        const relPath = name.slice(busPrefix.length + 1);
        if (!longestMatch || busPrefix.length > longestMatch.busPrefix.length) {
          longestMatch = { busPrefix, relPath };
        }
      }
    }
    return longestMatch;
  };

  const augmentDynamicSignal = (busPrefix: string, relPath: string, otherEndpointName: string) => {
    const targetName = busPrefix ? `${busPrefix}.${relPath}` : relPath;
    if (dae.getVarIdxByName(targetName) >= 0) return;

    // Check if otherEndpointName is a single variable in dae
    const otherIdx = dae.getVarIdxByName(otherEndpointName);
    if (otherIdx >= 0) {
      const varType = dae.getVarType(otherIdx);
      const isFlow = dae.isVarFlow(otherIdx);
      const newIdx = dae.addVariable(
        dae.interner.intern(targetName),
        varType,
        Variability.Continuous,
        Causality.Local,
        0.0,
      );
      dae.setVarDescription(newIdx, "virtual variable in expandable connector");
      if (isFlow) dae.setVarFlow(newIdx, true);
      markSignalReferenced(targetName);
      return;
    }

    // Check if otherEndpointName is a composite / connector prefix in dae (e.g. ground1.p)
    const otherPrefix = otherEndpointName + ".";
    let matchedAny = false;
    const matchingSubVars: number[] = [];
    for (let v = 0; v < dae.varCount; v++) {
      if (dae.isVarRemoved(v)) continue;
      const vName = dae.getVarName(v);
      if (vName.startsWith(otherPrefix)) {
        matchingSubVars.push(v);
      }
    }
    matchingSubVars.sort((a, b) => {
      const flowA = dae.isVarFlow(a) ? 1 : 0;
      const flowB = dae.isVarFlow(b) ? 1 : 0;
      return flowB - flowA;
    });
    for (const v of matchingSubVars) {
      matchedAny = true;
      const vName = dae.getVarName(v);
      const subPath = vName.slice(otherPrefix.length);
      const subTargetName = `${targetName}.${subPath}`;
      if (dae.getVarIdxByName(subTargetName) < 0) {
        const varType = dae.getVarType(v);
        const isFlow = dae.isVarFlow(v);
        const newIdx = dae.addVariable(
          dae.interner.intern(subTargetName),
          varType,
          Variability.Continuous,
          Causality.Local,
          0.0,
        );
        dae.setVarDescription(newIdx, "virtual variable in expandable connector");
        if (isFlow) dae.setVarFlow(newIdx, true);
        markSignalReferenced(subTargetName);
      }
    }
    if (!matchedAny) {
      const newIdx = dae.addVariable(
        dae.interner.intern(targetName),
        VarType.Real,
        Variability.Continuous,
        Causality.Local,
        0.0,
      );
      dae.setVarDescription(newIdx, "virtual variable in expandable connector");
      markSignalReferenced(targetName);
    }
  };

  // Scan equations in dae
  for (let i = 0; i < dae.eqCount; i++) {
    const k = dae.getEqKind(i);
    const lhs = dae.getEqLhs(i);
    const rhs = dae.getEqRhs(i);

    if (k === EqKind.Connect) {
      const lhsName = dae.getExprKind(lhs) === ExprKind.Name ? dae.interner.resolve(dae.getExprData1(lhs)) : "";
      const rhsName = dae.getExprKind(rhs) === ExprKind.Name ? dae.interner.resolve(dae.getExprData1(rhs)) : "";

      // Check if either side connects to an array of buses (ExpandableConnector9.mo)
      const matchArrayBus = (name: string): string[] => {
        const prefixMatch = `${name}[`;
        const matches: string[] = [];
        for (const b of expandableBuses.keys()) {
          if (b.startsWith(prefixMatch)) matches.push(b);
        }
        return matches;
      };

      const arrBusesL = matchArrayBus(lhsName);
      const arrBusesR = matchArrayBus(rhsName);
      if (arrBusesL.length > 0 || arrBusesR.length > 0) {
        const arrBuses = arrBusesL.length > 0 ? arrBusesL : arrBusesR;
        const otherName = arrBusesL.length > 0 ? rhsName : lhsName;
        const baseArrName = arrBusesL.length > 0 ? lhsName : rhsName;
        for (const bKey of arrBuses) {
          const idxSuffix = bKey.slice(baseArrName.length);
          let projOther = "";
          if (otherName.includes(".")) {
            const dotIdx = otherName.indexOf(".");
            projOther = `${otherName.slice(0, dotIdx)}${idxSuffix}${otherName.slice(dotIdx)}`;
          } else {
            projOther = `${otherName}${idxSuffix}`;
          }
          const bL = arrBusesL.length > 0 ? bKey : projOther;
          const bR = arrBusesL.length > 0 ? projOther : bKey;
          busConnections.push([bL, bR]);
          const newLhsExpr = dae.addNameExpr(bL);
          const newRhsExpr = dae.addNameExpr(bR);
          dae.addEquation(EqKind.Connect, newLhsExpr, newRhsExpr);
        }
        continue;
      }

      const matchL = matchBus(lhsName);
      const matchR = matchBus(rhsName);

      // Error check: cannot connect undeclared connectors (ExpandableConnectorNonDecl1.mo)
      if (matchL && matchR && matchL.relPath !== "" && matchR.relPath !== "") {
        let lExists = dae.getVarIdxByName(lhsName) >= 0;
        let rExists = dae.getVarIdxByName(rhsName) >= 0;
        if (!lExists || !rExists) {
          for (let v = 0; v < dae.varCount; v++) {
            if (dae.isVarRemoved(v)) continue;
            const vn = dae.getVarName(v);
            if (!lExists && vn.startsWith(lhsName + ".")) lExists = true;
            if (!rExists && vn.startsWith(rhsName + ".")) rExists = true;
            if (lExists && rExists) break;
          }
        }
        if (!lExists && !rExists) {
          dae.diagnostics.push({
            severity: "error",
            code: ModelicaErrorCode.CANNOT_CONNECT_UNDECLARED_EXPANDABLE_CONNECTORS.code,
            message: ModelicaErrorCode.CANNOT_CONNECT_UNDECLARED_EXPANDABLE_CONNECTORS.message(lhsName, rhsName),
          });
          continue;
        }
      }

      // Error check: cannot augment virtual element (ExpandableConnectorNonDecl3.mo)
      const checkAugmentVirtual = (m: { busPrefix: string; relPath: string }) => {
        if (m.relPath.includes(".")) {
          const classId = expandableBuses.get(m.busPrefix);
          if (classId) {
            const seg0 = m.relPath.split(".")[0];
            const hasDecl = db.childrenOf(classId).some((c) => c.name === seg0);
            if (!hasDecl) {
              dae.diagnostics.push({
                severity: "error",
                code: ModelicaErrorCode.PARSE_ERROR.code,
                message: `Internal error Augmenting a virtual element in an expandable connector is not yet supported.`,
              });
              return true;
            }
          }
        }
        return false;
      };
      if (matchL && checkAugmentVirtual(matchL)) continue;
      if (matchR && checkAugmentVirtual(matchR)) continue;

      if (matchL && matchL.relPath === "" && matchR && matchR.relPath === "") {
        busConnections.push([matchL.busPrefix, matchR.busPrefix]);
        for (const bKey of expandableBuses.keys()) {
          if (bKey.startsWith(matchL.busPrefix + ".")) {
            const subRel = bKey.slice(matchL.busPrefix.length + 1);
            const paired = `${matchR.busPrefix}.${subRel}`;
            busConnections.push([bKey, paired]);
          } else if (bKey.startsWith(matchR.busPrefix + ".")) {
            const subRel = bKey.slice(matchR.busPrefix.length + 1);
            const paired = `${matchL.busPrefix}.${subRel}`;
            busConnections.push([paired, bKey]);
          }
        }
      } else {
        if (matchL && matchL.relPath !== "") {
          markSignalReferenced(lhsName);
          augmentDynamicSignal(matchL.busPrefix, matchL.relPath, rhsName);
        }
        if (matchR && matchR.relPath !== "") {
          markSignalReferenced(rhsName);
          augmentDynamicSignal(matchR.busPrefix, matchR.relPath, lhsName);
        }
      }
    } else {
      const recordReferencedNames = (eId: number) => {
        if (eId < 0) return;
        const ek = dae.getExprKind(eId);
        if (ek === ExprKind.Name) {
          const vName = dae.interner.resolve(dae.getExprData1(eId));
          markSignalReferenced(vName);
        } else if (ek === ExprKind.Binary) {
          recordReferencedNames(dae.getExprLeft(eId));
          recordReferencedNames(dae.getExprRight(eId));
        } else if (ek === ExprKind.Unary || ek === ExprKind.Negate) {
          recordReferencedNames(dae.getExprLeft(eId));
        } else if (ek === ExprKind.Call) {
          const count = dae.getExprRight(eId);
          for (let a = 0; a < count; a++) {
            recordReferencedNames(dae.getExprLeft(eId + a));
          }
        }
      };
      recordReferencedNames(lhs);
      recordReferencedNames(rhs);
    }
  }

  // Cross-bus pooling via DisjointSet
  if (busConnections.length > 0) {
    const parent = new Map<string, string>();
    const find = (x: string): string => {
      let p = parent.get(x) ?? x;
      if (p !== x) {
        p = find(p);
        parent.set(x, p);
      }
      return p;
    };
    const union = (x: string, y: string) => {
      const rx = find(x);
      const ry = find(y);
      if (rx !== ry) parent.set(rx, ry);
    };

    for (const [b1, b2] of busConnections) {
      union(b1, b2);
    }

    const groups = new Map<string, string[]>();
    for (const b of expandableBuses.keys()) {
      const r = find(b);
      let list = groups.get(r);
      if (!list) {
        list = [];
        groups.set(r, list);
      }
      list.push(b);
    }

    for (const group of groups.values()) {
      if (group.length <= 1) continue;
      const pooledSignals = new Map<string, { varType: VarType; isFlow: boolean; causality: Causality }>();
      for (const b of group) {
        const refSet = busReferencedSignals.get(b);
        if (!refSet) continue;
        for (const rel of refSet) {
          if (pooledSignals.has(rel)) continue;
          // Check if any bus in group has this variable in dae
          let foundVar: { varType: VarType; isFlow: boolean; causality: Causality } | null = null;
          for (const b2 of group) {
            const vName = b2 ? `${b2}.${rel}` : rel;
            const vIdx = dae.getVarIdxByName(vName);
            if (vIdx >= 0 && !dae.isVarRemoved(vIdx)) {
              foundVar = {
                varType: dae.getVarType(vIdx),
                isFlow: dae.isVarFlow(vIdx),
                causality: dae.getVarCausality(vIdx),
              };
              break;
            }
          }
          if (foundVar) {
            pooledSignals.set(rel, foundVar);
          } else {
            // Check if rel is a composite connector prefix having sub-variables in dae
            let hasSubVars = false;
            for (const b2 of group) {
              const pfx = b2 ? `${b2}.${rel}.` : `${rel}.`;
              for (let v = 0; v < dae.varCount; v++) {
                if (!dae.isVarRemoved(v) && dae.getVarName(v).startsWith(pfx)) {
                  hasSubVars = true;
                  break;
                }
              }
              if (hasSubVars) break;
            }
            if (!hasSubVars) {
              pooledSignals.set(rel, {
                varType: VarType.Real,
                isFlow: false,
                causality: Causality.Local,
              });
            }
          }
        }
      }

      const sortedPooled = Array.from(pooledSignals.entries()).sort((a, b) => {
        const segA = a[0].split(".")[0]!;
        const segB = b[0].split(".")[0]!;
        if (segA !== segB) return segA.localeCompare(segB);
        const flowA = a[1].isFlow ? 1 : 0;
        const flowB = b[1].isFlow ? 1 : 0;
        return flowB - flowA;
      });
      for (const b of group) {
        for (const [rel, info] of sortedPooled) {
          busReferencedSignals.get(b)?.add(rel);
          const targetName = b ? `${b}.${rel}` : rel;
          markSignalReferenced(targetName);
          if (dae.getVarIdxByName(targetName) < 0) {
            const newIdx = dae.addVariable(
              dae.interner.intern(targetName),
              info.varType,
              Variability.Continuous,
              info.causality ?? Causality.Local,
              0.0,
            );
            dae.setVarDescription(newIdx, "virtual variable in expandable connector");
            if (info.isFlow) dae.setVarFlow(newIdx, true);
          }
        }
      }
    }
  }

  // Prune unreferenced pre-declared variables on expandable connectors
  for (const busPrefix of expandableBuses.keys()) {
    const refSet = busReferencedSignals.get(busPrefix) ?? new Set<string>();
    const bPfx = busPrefix ? `${busPrefix}.` : "";
    for (let v = 0; v < dae.varCount; v++) {
      if (dae.isVarRemoved(v)) continue;
      const vName = dae.getVarName(v);
      if (bPfx === "") {
        if (!refSet.has(vName)) {
          dae.removeVariable(v);
        }
      } else if (vName.startsWith(bPfx)) {
        const rel = vName.slice(bPfx.length);
        const isReferenced =
          refSet.has(rel) ||
          Array.from(refSet).some(
            (s) =>
              s.startsWith(rel + ".") || s.startsWith(rel + "[") || rel.startsWith(s + ".") || rel.startsWith(s + "["),
          );
        if (!isReferenced) {
          dae.removeVariable(v);
        }
      }
    }
  }
}

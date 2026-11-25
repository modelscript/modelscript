// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Modelica Flattener - Scoped name resolution, DAE variable prefix sets, and array dimension helpers.
 */

import { DAEBuilder, Variability, type QueryDB, type SymbolEntry, type SymbolId } from "@modelscript/runtime";
import type { SyntaxNode } from "../../../../src-gen/bindings.js";
import { getShortClassSpecifierNode } from "../../../queries.js";
import { getFlatteningState, getNamedArrayShape } from "../../support/state.js";
import { getSymbolQualifiedName } from "../functions.js";
import { extractTrailingBrackets, stripArraySubscripts, stripLeadingDot } from "./text-scanning.js";
import type { CstNodeLike, RawDimEntry, SimpleNameResolver } from "./types.js";

export function getVarPrefixSet(dae: DAEBuilder): Set<string> {
  const state = getFlatteningState(dae);
  let set = state.varPrefixSet;
  let lastCount = state.varPrefixCount ?? 0;
  if (!set) {
    set = new Set<string>();
    state.varPrefixSet = set;
    lastCount = 0;
  }
  const currCount = dae.varCount;
  if (lastCount < currCount) {
    for (let i = lastCount; i < currCount; i++) {
      if (dae.isVarRemoved(i)) continue;
      const name = dae.getVarName(i);
      let dotIdx = name.indexOf(".");
      while (dotIdx >= 0) {
        const p = name.slice(0, dotIdx);
        set.add(p);
        const brkIdx = p.indexOf("[");
        if (brkIdx >= 0) {
          set.add(p.slice(0, brkIdx));
        }
        dotIdx = name.indexOf(".", dotIdx + 1);
      }
      const brkIdx = name.indexOf("[");
      if (brkIdx >= 0) {
        set.add(name.slice(0, brkIdx));
      }
    }
    state.varPrefixCount = currCount;
  }
  return set;
}

export function getDaeArrayDimSize(dae: DAEBuilder, arrName: string, resolvedName: string, dim: number): number | null {
  const namedShape = getNamedArrayShape(dae, resolvedName) ?? getNamedArrayShape(dae, arrName);
  if (namedShape && namedShape.length >= dim && namedShape[dim - 1]! >= 0) {
    return namedShape[dim - 1]!;
  }
  const varIdx =
    dae.getVarIdxByName(resolvedName) >= 0 ? dae.getVarIdxByName(resolvedName) : dae.getVarIdxByName(arrName);
  if (varIdx >= 0) {
    const shape = dae.getVarShape(varIdx);
    if (shape && shape.length >= dim && shape[dim - 1]! >= 0) {
      return shape[dim - 1]!;
    }
  }
  const prefixSet = getVarPrefixSet(dae);
  if (!prefixSet.has(resolvedName) && !prefixSet.has(arrName)) {
    return null;
  }
  let maxDim = 0;
  const target = prefixSet.has(resolvedName) ? resolvedName : arrName;
  const prefixMatch = `${target}[`;
  const elemIndices = dae.getArrayElementIndices?.(target);
  if (elemIndices && elemIndices.length > 0) {
    for (let k = 0; k < elemIndices.length; k++) {
      const i = elemIndices[k]!;
      if (dae.isVarRemoved(i)) continue;
      const vn = dae.getVarName(i);
      if (vn.startsWith(prefixMatch)) {
        const rest = vn.slice(prefixMatch.length);
        const endBracket = rest.indexOf("]");
        if (endBracket >= 0) {
          const idxList = rest.slice(0, endBracket).split(",");
          if (dim >= 1 && dim <= idxList.length) {
            const val = parseInt(idxList[dim - 1]!.trim(), 10);
            if (!isNaN(val) && val > maxDim) maxDim = val;
          }
        }
      }
    }
    if (maxDim > 0) return maxDim;
  }
  for (let i = 0; i < dae.varCount; i++) {
    if (!dae.isVarRemoved(i)) {
      const vn = dae.getVarName(i);
      if (vn.startsWith(prefixMatch)) {
        const rest = vn.slice(prefixMatch.length);
        const endBracket = rest.indexOf("]");
        if (endBracket >= 0) {
          const idxList = rest.slice(0, endBracket).split(",");
          if (dim >= 1 && dim <= idxList.length) {
            const val = parseInt(idxList[dim - 1]!.trim(), 10);
            if (!isNaN(val) && val > maxDim) maxDim = val;
          }
        }
      }
    }
  }
  return maxDim > 0 ? maxDim : null;
}

export function resolveScopedName(
  name: string,
  prefix: string,
  dae: DAEBuilder,
  innerOuterComponents?: Set<string>,
  recordDiagnostics = false,
): string {
  const state = getFlatteningState(dae);
  const remapOuter = (candidate: string): string | null => {
    if (!state.outerToInner || state.outerToInner.size === 0) return null;
    if (state.outerToInner.has(candidate)) {
      const isStateOut = !state.isInsidePrevious && state.stateOutputVars?.has(candidate);
      if (!isStateOut) return state.outerToInner.get(candidate)!;
    }
    const baseCand = stripArraySubscripts(candidate);
    if (baseCand !== candidate && state.outerToInner.has(baseCand)) {
      const isStateOut = !state.isInsidePrevious && state.stateOutputVars?.has(baseCand);
      if (!isStateOut) {
        const mapped = state.outerToInner.get(baseCand)!;
        const candTail = extractTrailingBrackets(candidate);
        if (candTail && !mapped.endsWith("]")) return mapped + candTail;
        return mapped;
      }
    }
    let dot = candidate.lastIndexOf(".");
    while (dot > 0) {
      const sub = candidate.slice(0, dot);
      const baseSub = stripArraySubscripts(sub);
      const exactMapped = state.outerToInner.get(sub);
      const baseMapped = exactMapped === undefined ? state.outerToInner.get(baseSub) : undefined;
      const mapped = exactMapped ?? baseMapped;
      if (mapped) {
        const isStateOut =
          !state.isInsidePrevious && (state.stateOutputVars?.has(sub) || state.stateOutputVars?.has(baseSub));
        if (!isStateOut) {
          const subTail = exactMapped === undefined ? extractTrailingBrackets(sub) : "";
          const effectiveMapped = subTail && !mapped.endsWith("]") ? mapped + subTail : mapped;
          return effectiveMapped + candidate.slice(dot);
        }
      }
      dot = candidate.lastIndexOf(".", dot - 1);
    }
    return null;
  };
  if (state.outerToInner) {
    const mappedName = remapOuter(name);
    if (mappedName) return mappedName;
  }
  if (state.constantAliases?.has(name)) {
    return state.constantAliases.get(name)!;
  }
  const prefixedCandidate = prefix ? `${prefix}.${name}` : name;
  if (state.constantAliases?.has(prefixedCandidate)) {
    return state.constantAliases.get(prefixedCandidate)!;
  }
  if (!prefix) return name;
  const basePrefixedCandidate = stripArraySubscripts(prefixedCandidate);
  const initialPrefixSet = getVarPrefixSet(dae);
  const prefixedExistsInDae =
    dae.getVarIdxByName(prefixedCandidate) >= 0 ||
    dae.getVarIdxByName(basePrefixedCandidate) >= 0 ||
    initialPrefixSet.has(prefixedCandidate) ||
    initialPrefixSet.has(basePrefixedCandidate) ||
    dae.hasArrayElements(prefixedCandidate);
  if (!prefixedExistsInDae) {
    if (name.startsWith(prefix + ".")) return name;

    let anc = prefix;
    while (anc) {
      if (name.startsWith(anc + ".")) return name;
      const dot = anc.lastIndexOf(".");
      if (dot < 0) break;
      anc = anc.slice(0, dot);
    }
  }
  if (state.outerToInner) {
    const mappedFull = remapOuter(prefixedCandidate);
    if (mappedFull) return mappedFull;
  }

  const rootComp = name.split(".")[0]!.split("[")[0]!;
  const fullLocalRoot = `${prefix}.${rootComp}`;
  const isStateOutput = Boolean(state.stateOutputVars?.has(fullLocalRoot));
  const isInnerOuter = innerOuterComponents?.has(fullLocalRoot) || (Boolean(state.isInsidePrevious) && isStateOutput);

  const scopeDeclaredNames: Map<string, Set<string>> | undefined = state.scopeDeclaredNames;

  let resolvedName: string | null = null;
  if (!isInnerOuter) {
    const basePrefix = stripArraySubscripts(prefix);
    if (scopeDeclaredNames?.get(prefix)?.has(rootComp) || scopeDeclaredNames?.get(basePrefix)?.has(rootComp)) {
      resolvedName = `${prefix}.${name}`;
    } else {
      const prefixed = `${prefix}.${name}`;
      if (dae.getVarIdxByName(prefixed) >= 0) {
        resolvedName = prefixed;
      } else {
        const prefixSet = getVarPrefixSet(dae);
        if (prefixSet.has(prefixed)) {
          resolvedName = prefixed;
        }
      }
    }
  }

  if (!resolvedName) {
    // Walk up enclosing scopes
    let p: string | null = prefix.includes(".") ? prefix.split(".").slice(0, -1).join(".") : "";
    while (p !== null) {
      const target = p ? `${p}.${name}` : name;
      const isStateOut = Boolean(state.isInsidePrevious && state.stateOutputVars?.has(target));
      if (!isStateOut) {
        if (!isInnerOuter) {
          const vIdx = dae.getVarIdxByName(target);
          if (vIdx >= 0 && dae.getVarVariability(vIdx) === Variability.Constant) {
            resolvedName = target;
            break;
          }
          if (vIdx < 0 && dae.hasArrayElements(target)) {
            resolvedName = target;
            break;
          }
          if (vIdx >= 0 && dae.getVarVariability(vIdx) !== Variability.Constant) {
            const flattener = state.flattener;
            const currentClassId = flattener?.currentClassId ?? state.currentClassId;
            const currentRootClassId = flattener?.currentRootClassId ?? state.currentRootClassId;
            if (
              p === "" &&
              prefix !== "" &&
              currentClassId &&
              currentRootClassId &&
              currentClassId !== currentRootClassId
            ) {
              if (recordDiagnostics) {
                if (!state.outerNonConstantAccess) {
                  state.outerNonConstantAccess = [];
                }
                const exists = state.outerNonConstantAccess.some(
                  (e) => e.compName === prefix && e.varName === name && e.target === target,
                );
                if (!exists) {
                  state.outerNonConstantAccess.push({
                    compName: prefix,
                    varName: name,
                    target,
                    p,
                  });
                }
              }
              break;
            } else {
              resolvedName = target;
              break;
            }
          }
        } else {
          const baseP = stripArraySubscripts(p);
          if (scopeDeclaredNames?.get(p)?.has(rootComp) || scopeDeclaredNames?.get(baseP)?.has(rootComp)) {
            resolvedName = target;
            break;
          }
          if (dae.getVarIdxByName(target) >= 0) {
            resolvedName = target;
            break;
          }
          const prefixSet = getVarPrefixSet(dae);
          if (prefixSet.has(target)) {
            resolvedName = target;
            break;
          }
        }
      }
      p = p.includes(".") ? p.split(".").slice(0, -1).join(".") : p === "" ? null : "";
    }
  }

  if (!resolvedName && name.includes(".")) {
    const parts = name.split(".");
    if (parts.length >= 2 && !parts[0]!.includes("[")) {
      const withIdx1 = `${prefix}.${parts[0]}[1].${parts.slice(1).join(".")}`;
      if (dae.getVarIdxByName(withIdx1) >= 0) {
        resolvedName = withIdx1;
      }
    }
  }

  return resolvedName ?? (name.includes(".") ? name : `${prefix}.${name}`);
}

export function isIntegerTypeSpec(
  typeSpec: string | null | undefined,
  db?: QueryDB,
  visited = new Set<SymbolId>(),
  scopeId?: SymbolId,
): boolean {
  if (!typeSpec) return false;
  if (typeSpec === "Integer") return true;
  if (typeSpec === "Real" || typeSpec === "Boolean" || typeSpec === "String") return false;
  if (db) {
    let resolvedSym: SymbolEntry | null = null;
    if (scopeId) {
      const resolver =
        db.query<SimpleNameResolver | null>("resolveName", scopeId) ??
        db.query<SimpleNameResolver | null>("resolveSimpleName", scopeId);
      const res = resolver?.(typeSpec);
      if (res && res.kind === "Class") resolvedSym = res;
    }
    const leaf = typeSpec.includes(".") ? typeSpec.split(".").pop()! : typeSpec;
    const matches = resolvedSym ? [resolvedSym] : db.byName(leaf);
    for (const tm of matches) {
      if (tm.kind === "Class") {
        if (visited.has(tm.id)) continue;
        visited.add(tm.id);
        const baseClass = db.query<SymbolEntry | null>("resolvedBaseClass", tm.id);
        if (baseClass && baseClass.name !== typeSpec) {
          if (isIntegerTypeSpec(baseClass.name, db, visited, tm.id)) return true;
        }
        const meta = tm.metadata as Record<string, unknown> | undefined;
        if (meta?.["baseType"] === "Integer" || meta?.["primitiveType"] === "Integer") return true;
        const isIntTypeRef = (rawType: string | null | undefined): boolean => {
          const clean = stripLeadingDot(rawType?.trim() ?? "");
          return (
            clean === "Integer" ||
            clean === "TypeInteger" ||
            clean === "Modelica.Icons.TypeInteger" ||
            clean.endsWith(".TypeInteger")
          );
        };
        const shortSpec = getShortClassSpecifierNode(db.cstNode(tm.id) as SyntaxNode | null);
        if (shortSpec && isIntTypeRef(shortSpec.childForFieldName?.("type_specifier")?.text)) return true;
        for (const extCh of db.childrenOf(tm.id) || []) {
          if (extCh.kind === "Extends") {
            const extType =
              (db.cstNode(extCh.id) as CstNodeLike | null)?.childForFieldName?.("type_specifier")?.text ?? extCh.name;
            if (isIntTypeRef(extType)) return true;
          }
        }
      }
    }
  }
  return false;
}

export function getDaeDimSize(
  prefix: string,
  partIdent: string,
  dimIdx: number,
  dae: DAEBuilder,
  db?: QueryDB | null,
): number {
  const fullIdent = prefix ? `${prefix}.${partIdent}` : partIdent;
  const namedShape = getNamedArrayShape(dae, fullIdent) ?? getNamedArrayShape(dae, partIdent);
  if (namedShape && dimIdx >= 0 && dimIdx < namedShape.length && namedShape[dimIdx]! > 0) {
    return namedShape[dimIdx]!;
  }
  const directVarIdx =
    dae.lookupVariable(fullIdent) >= 0 ? dae.lookupVariable(fullIdent) : dae.lookupVariable(partIdent);
  if (directVarIdx >= 0) {
    const varShape = dae.getVarShape(directVarIdx);
    if (varShape && dimIdx >= 0 && dimIdx < varShape.length && varShape[dimIdx]! > 0) {
      return varShape[dimIdx]!;
    }
  }
  const hasFullFast = dae.getArrayElementIndices(fullIdent).length > 0;
  const matchedFastPrefix = hasFullFast ? fullIdent : partIdent;
  const fastIndices = hasFullFast ? dae.getArrayElementIndices(fullIdent) : dae.getArrayElementIndices(partIdent);
  if (fastIndices.length > 0) {
    let fastMax = 0;
    for (const vIdx of fastIndices) {
      if (dae.isVarRemoved(vIdx)) continue;
      const vn = dae.getVarName(vIdx);
      const b1 = vn.indexOf("[", matchedFastPrefix.length);
      const b2 = vn.indexOf("]", b1);
      if (b1 >= 0 && b2 > b1) {
        const idxList = vn.slice(b1 + 1, b2).split(",");
        if (dimIdx >= 0 && dimIdx < idxList.length) {
          const val = parseInt(idxList[dimIdx]!.trim(), 10);
          if (!isNaN(val) && val > fastMax) fastMax = val;
        }
      }
    }
    if (fastMax > 0) return fastMax;
  }
  let maxDim = 0;
  const target = `${partIdent}[`;
  const fullTarget = prefix ? `${prefix}.${partIdent}[` : target;
  for (let i = 0; i < dae.varCount; i++) {
    if (!dae.isVarRemoved(i)) {
      const vn = dae.getVarName(i);
      let pos = -1;
      if (vn.startsWith(fullTarget)) {
        pos = fullTarget.length - target.length;
      } else if (!prefix && vn.startsWith(target)) {
        pos = 0;
      } else if (prefix) {
        let p = prefix;
        while (p.includes(".")) {
          p = p.split(".").slice(0, -1).join(".");
          const ancestorTarget = `${p}.${partIdent}[`;
          if (vn.startsWith(ancestorTarget)) {
            pos = ancestorTarget.length - target.length;
            break;
          }
        }
        if (pos < 0 && vn.startsWith(target)) {
          pos = 0;
        }
      }
      if (pos >= 0) {
        const rest = vn.slice(pos + target.length);
        const endB = rest.indexOf("]");
        if (endB >= 0) {
          const idxList = rest.slice(0, endB).split(",");
          if (dimIdx >= 0 && dimIdx < idxList.length) {
            const val = parseInt(idxList[dimIdx]!.trim(), 10);
            if (!isNaN(val) && val > maxDim) {
              maxDim = val;
            }
          }
        }
      }
    }
  }
  if (maxDim > 0) return maxDim;
  let matchingCount = 0;
  for (let i = 0; i < dae.varCount; i++) {
    if (!dae.isVarRemoved(i)) {
      const vn = dae.getVarName(i);
      if (vn.startsWith(fullTarget) || (!prefix && vn.startsWith(target))) matchingCount++;
    }
  }
  if (matchingCount > 0) return matchingCount;
  if (db) {
    if (partIdent.startsWith(".")) partIdent = partIdent.slice(1);
    const cleanIdent = partIdent;
    const leafIdent = cleanIdent.includes(".") ? cleanIdent.split(".").pop()! : cleanIdent;
    const syms = db.byName(leafIdent);
    for (const s of syms) {
      const qName = getSymbolQualifiedName(db, s.id);
      if (qName === cleanIdent || s.name === cleanIdent || qName.endsWith(`.${cleanIdent}`)) {
        const dims = db.query<RawDimEntry[] | null>("arrayDimensions", s.id);
        if (dims && dims.length > dimIdx) {
          const d = dims[dimIdx];
          if (typeof d === "number") return d;
          if (d && typeof d === "object" && d.kind === "literal" && typeof d.value === "number") return d.value;
        }
      }
    }
  }
  return 0;
}

export function getDaeArrayDimCount(
  prefix: string,
  partIdent: string,
  dae: DAEBuilder,
  db?: QueryDB | null,
): number | null {
  const resolved = resolveScopedName(partIdent, prefix, dae);
  const namedShape = getNamedArrayShape(dae, resolved) ?? getNamedArrayShape(dae, partIdent);
  if (namedShape && namedShape.length > 0) {
    return namedShape.length;
  }
  const elemIndices = dae.getArrayElementIndices(resolved);
  if (elemIndices.length > 0) {
    const vn = dae.getVarName(elemIndices[0]!);
    const b1 = vn.indexOf("[");
    const b2 = vn.indexOf("]");
    if (b1 >= 0 && b2 > b1) {
      return vn.slice(b1 + 1, b2).split(",").length;
    }
  }
  const elemIndicesUnscoped = dae.getArrayElementIndices(partIdent);
  if (elemIndicesUnscoped.length > 0) {
    const vn = dae.getVarName(elemIndicesUnscoped[0]!);
    const b1 = vn.indexOf("[");
    const b2 = vn.indexOf("]");
    if (b1 >= 0 && b2 > b1) {
      return vn.slice(b1 + 1, b2).split(",").length;
    }
  }
  const varIdx = dae.getVarIdxByName(resolved) >= 0 ? dae.getVarIdxByName(resolved) : dae.getVarIdxByName(partIdent);
  if (varIdx >= 0) {
    const shape = dae.getVarShape(varIdx);
    if (shape && shape.length > 0) {
      return shape.length;
    }
    const shapeExprs = dae.getVarShapeExprs(varIdx);
    if (shapeExprs && shapeExprs.length > 0) {
      return shapeExprs.length;
    }
    return 0;
  }
  if (db) {
    if (partIdent.includes(".")) {
      const dotIdx = partIdent.indexOf(".");
      const basePart = partIdent.slice(0, dotIdx);
      const restPart = partIdent.slice(dotIdx + 1);
      const baseResolved = prefix ? `${prefix}.${basePart}` : basePart;
      const baseVarIdx =
        dae.getVarIdxByName(baseResolved) >= 0 ? dae.getVarIdxByName(baseResolved) : dae.getVarIdxByName(basePart);
      if (baseVarIdx >= 0) {
        const cType = dae.getVarCustomType(baseVarIdx);
        if (cType) {
          const recLeaf = cType.split(".").pop()!;
          const recSym =
            db.byName(recLeaf).find((s) => s.kind === "Class" && getSymbolQualifiedName(db, s.id) === cType) ??
            db.byName(recLeaf).find((s) => s.kind === "Class");
          if (recSym) {
            const fieldSym = db.childrenOf(recSym.id).find((c) => c.name === restPart && c.kind === "Component");
            if (fieldSym) {
              const dims = db.query<RawDimEntry[] | null>("arrayDimensions", fieldSym.id);
              if (dims && Array.isArray(dims) && dims.length > 0) {
                return dims.length;
              }
              return 0;
            }
          }
        }
      }
    }
    const syms = db.byName(partIdent);
    for (const s of syms) {
      if (s.kind === "Component") {
        const dims = db.query<RawDimEntry[] | null>("arrayDimensions", s.id);
        if (dims && Array.isArray(dims) && dims.length > 0) {
          return dims.length;
        }
      }
    }
    if (syms.some((s) => s.kind === "Component")) {
      return 0;
    }
  }
  return null;
}

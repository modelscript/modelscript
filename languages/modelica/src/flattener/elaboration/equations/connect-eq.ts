// SPDX-License-Identifier: AGPL-3.0-or-later

import { DAEBuilder, EqKind, ExprKind, UnifiedWorkspace, type SymbolEntry, type SymbolId } from "@modelscript/runtime";
import { Cst, FieldId, type SyntaxNode } from "../../../../src-gen/bindings.js";
import { ModelicaErrorCode } from "../../../errors.js";
import { getShortClassSpecifierNode } from "../../../queries.js";
import {
  isAsciiIdentContinue,
  isAsciiIdentStart,
  stripAsciiWhitespace,
  type CstNodeLike,
} from "../../expressions/cst-utils.js";
import { generateArrayIndices, getVarPrefixSet } from "../../expressions/index.js";
import { getNamedArrayShape } from "../../support/state.js";
import type { ComponentInstanceData } from "../../types.js";
import type { DaeWithConnectorCache, EquationCstNode, EquationWalkContext, SymbolMetaLike } from "./types.js";

const connectPairCache = new Map<string, [string, string] | null>();

function parseConnectPairCst(rawConnText: string): [string, string] | null {
  const cached = connectPairCache.get(rawConnText);
  if (cached !== undefined) return cached;

  let stmt = rawConnText.trim();
  if (stmt.startsWith("break") && stmt.length > 5) {
    stmt = stmt.slice(5).trimStart();
  }
  if (!stmt.startsWith("connect")) {
    connectPairCache.set(rawConnText, null);
    return null;
  }
  const parser = UnifiedWorkspace.getGlobalParser(".mo");
  if (!parser) {
    connectPairCache.set(rawConnText, null);
    return null;
  }
  const semiStmt = stmt.endsWith(";") ? stmt : `${stmt};`;
  const tree = parser.parse(`model _M equation ${semiStmt} end _M;`);
  const rootNode = tree?.rootNode as CstNodeLike | undefined;
  const stack: CstNodeLike[] = rootNode ? [rootNode] : [];
  let result: [string, string] | null = null;
  while (stack.length > 0) {
    const cur = stack.pop();
    if (!cur) continue;
    if (cur.type === "connect_equation") {
      const lhsNode = cur.childForFieldName?.("lhs");
      const rhsNode = cur.childForFieldName?.("rhs");
      const refs =
        lhsNode && rhsNode
          ? [lhsNode, rhsNode]
          : (cur.children || []).filter(
              (c) =>
                c.type === "component_reference" ||
                c.type === "expression" ||
                c.type === "identifier" ||
                c.type === "name",
            );
      if (refs.length >= 2) {
        result = [stripAsciiWhitespace(refs[0]!.text ?? ""), stripAsciiWhitespace(refs[1]!.text ?? "")];
      }
      break;
    }
    const children = cur.children || [];
    for (let i = children.length - 1; i >= 0; i--) {
      if (children[i]) stack.push(children[i]!);
    }
  }
  tree?.delete?.();
  connectPairCache.set(rawConnText, result);
  return result;
}

export function lowerConnectEquation(
  ctx: EquationWalkContext,
  node: EquationCstNode,
  substitutions: Map<string, number | string> | undefined,
  isInitial: boolean | undefined,
): void {
  const { flattener, db, prefix, dae, curBreakContext, walk } = ctx;
  const lhsNode = Cst.ConnectEquation.lhs(node) ?? node.childForFieldId?.(FieldId.lhs);
  const rhsNode = Cst.ConnectEquation.rhs(node) ?? node.childForFieldId?.(FieldId.rhs);
  const refs =
    lhsNode && rhsNode
      ? [lhsNode, rhsNode]
      : (node.children || []).filter(
          (c: SyntaxNode) =>
            c.type === "component_reference" || c.type === "expression" || c.type === "identifier" || c.type === "name",
        );
  if (refs.length >= 2) {
    const r0Raw = stripAsciiWhitespace(refs[0]!.text ?? "");
    const r1Raw = stripAsciiWhitespace(refs[1]!.text ?? "");
    const r0Full = prefix ? `${prefix}.${r0Raw}` : r0Raw;
    const r1Full = prefix ? `${prefix}.${r1Raw}` : r1Raw;

    if (flattener.isComponentDisabled(r0Full) || flattener.isComponentDisabled(r1Full)) {
      return;
    }

    const r0Root = (r0Raw.split(".")[0] ?? "").split("[")[0] ?? "";
    const r1Root = (r1Raw.split(".")[0] ?? "").split("[")[0] ?? "";

    if (curBreakContext.brokenComponents.has(r0Root) || curBreakContext.brokenComponents.has(r1Root)) {
      return;
    }

    let isBrokenConn = false;
    let r0Sub = r0Raw;
    let r1Sub = r1Raw;
    if (substitutions && substitutions.size > 0) {
      const applySubs = (s: string) => {
        let out = "";
        let idx = 0;
        while (idx < s.length) {
          if (isAsciiIdentStart(s.charCodeAt(idx))) {
            const start = idx;
            idx++;
            while (idx < s.length && isAsciiIdentContinue(s.charCodeAt(idx))) idx++;
            const ident = s.slice(start, idx);
            const val = substitutions.get(ident);
            out += val !== undefined ? String(val) : ident;
          } else {
            out += s[idx]!;
            idx++;
          }
        }
        return out;
      };
      r0Sub = applySubs(r0Sub);
      r1Sub = applySubs(r1Sub);
    }

    for (const bConn of curBreakContext.brokenConnections) {
      const pair = parseConnectPairCst(bConn);
      if (pair) {
        const [bFrom, bTo] = pair;
        if (
          (r0Raw === bFrom && r1Raw === bTo) ||
          (r0Raw === bTo && r1Raw === bFrom) ||
          (r0Sub === bFrom && r1Sub === bTo) ||
          (r0Sub === bTo && r1Sub === bFrom)
        ) {
          isBrokenConn = true;
          break;
        }
      }
    }
    if (isBrokenConn) {
      return;
    }

    const isOwnConnectorRef = (rawRef: string): boolean => {
      if (!rawRef.includes(".")) return true;
      const firstSeg = rawRef.slice(0, rawRef.indexOf(".")).replace(/\[.*$/, "").trim();
      const scopeId = flattener.currentClassId;
      if (!firstSeg || !scopeId || !flattener.db) return false;
      const resolveSimple = flattener.db.query("resolveSimpleName", scopeId) as
        ((n: string) => SymbolEntry | null) | undefined;
      const resolveFull = flattener.db.query("resolveName", scopeId) as ((n: string) => SymbolEntry | null) | undefined;
      const compSym = resolveSimple?.(firstSeg) ?? resolveFull?.(firstSeg);
      if (!compSym || compSym.kind !== "Component") return false;
      const compClassId = flattener.db.query("classInstance", compSym.id) as SymbolId | null | undefined;
      if (!compClassId) return false;
      return Boolean(flattener.db.query("isConnector", compClassId));
    };
    const isR0Outside = prefix !== "" && isOwnConnectorRef(r0Raw);
    const isR1Outside = prefix !== "" && isOwnConnectorRef(r1Raw);
    const connFlags = (isR0Outside ? 1 : 0) | (isR1Outside ? 2 : 0);

    // Plug-compatibility check: compare connector types and dimensions
    // before lowering/expanding. Only check simple (non-dotted) connector refs
    // at the top level (no prefix), where we can look up component instances.
    if (!r0Raw.includes(".") && !r1Raw.includes(".") && !r0Raw.includes("[") && !r1Raw.includes("[")) {
      const scopeId = flattener.currentRootClassId;
      if (scopeId) {
        const allChildren = db.childrenOf(scopeId);
        const c0Sym = allChildren.find((c) => c.kind === "Component" && c.name === r0Raw);
        const c1Sym = allChildren.find((c) => c.kind === "Component" && c.name === r1Raw);
        if (c0Sym && c1Sym) {
          const c0Inst = db.query<ComponentInstanceData>("componentInstance", c0Sym.id);
          const c1Inst = db.query<ComponentInstanceData>("componentInstance", c1Sym.id);
          if (c0Inst && c1Inst) {
            let connIncompat = false;
            let sym0: SymbolEntry | null = null;
            let sym1: SymbolEntry | null = null;
            let flowMismatch: { flowComp: string; nonFlowComp: string } | null = null;
            const getPublicComps = (sym: SymbolEntry): SymbolEntry[] => {
              const elems = db.query<SymbolEntry[]>("allElements", sym.id) ?? db.childrenOf(sym.id);
              return elems.filter(
                (e) => e.kind === "Component" && !(e.metadata as SymbolMetaLike | undefined)?.isProtected,
              );
            };
            // Array dimensions check (scalar vs array)
            const d0 = c0Inst.arrayDimensions ?? [];
            const d1 = c1Inst.arrayDimensions ?? [];
            if (d0.length !== d1.length || d0.some((v, i) => v !== d1[i])) {
              connIncompat = true;
            } else if (c0Inst.typeSpecifier !== c1Inst.typeSpecifier) {
              // Different type specifiers: check structural connector compatibility
              const resolveConnectorSym = (typeSpec: string | null): SymbolEntry | null => {
                if (!typeSpec) return null;
                const resolved =
                  db.query<(n: string) => SymbolEntry | null>("resolveName", scopeId)?.(typeSpec) ?? null;
                if (resolved && (resolved.kind === "Class" || db.query<boolean>("isConnector", resolved.id))) {
                  return resolved;
                }
                const matches = db.byName(typeSpec);
                return matches?.find((e) => e.kind === "Class") ?? null;
              };
              sym0 = resolveConnectorSym(c0Inst.typeSpecifier);
              sym1 = resolveConnectorSym(c1Inst.typeSpecifier);
              if (!sym0 || !sym1) {
                connIncompat = true;
              } else {
                const isC0Exp = flattener.isExpandableConnectorClass(sym0.id);
                const isC1Exp = flattener.isExpandableConnectorClass(sym1.id);
                if (isC0Exp || isC1Exp) {
                  return;
                }
                const comps0 = getPublicComps(sym0);
                const comps1 = getPublicComps(sym1);
                if (comps0.length !== comps1.length) {
                  connIncompat = true;
                } else {
                  for (const p0 of comps0) {
                    const p1 = comps1.find((c) => c.name === p0.name);
                    if (!p1) {
                      connIncompat = true;
                      break;
                    }
                    const inst0 = db.query<ComponentInstanceData>("componentInstance", p0.id);
                    const inst1 = db.query<ComponentInstanceData>("componentInstance", p1.id);
                    const isFlow0 = Boolean(
                      inst0?.flowPrefix || (p0.metadata as SymbolMetaLike | undefined)?.flowPrefix,
                    );
                    const isFlow1 = Boolean(
                      inst1?.flowPrefix || (p1.metadata as SymbolMetaLike | undefined)?.flowPrefix,
                    );
                    if (isFlow0 !== isFlow1) {
                      flowMismatch = {
                        flowComp: isFlow0 ? `${r0Raw}.${p0.name}` : `${r1Raw}.${p1.name}`,
                        nonFlowComp: isFlow0 ? `${r1Raw}.${p1.name}` : `${r0Raw}.${p0.name}`,
                      };
                      connIncompat = true;
                      break;
                    }
                  }
                }
              }
            }
            if (connIncompat) {
              const sb = node?.startIndex ?? node?.startOffset;
              const eb = node?.endIndex ?? node?.endOffset;
              const range = sb !== undefined && eb !== undefined ? { startOffset: sb, endOffset: eb } : undefined;
              if (flowMismatch && sym0 && sym1) {
                const formatConnectorType = (sym: SymbolEntry): string => {
                  const comps = getPublicComps(sym);
                  const compLines = comps.map((c) => {
                    const inst = db.query<ComponentInstanceData>("componentInstance", c.id);
                    const m = (c.metadata as SymbolMetaLike | undefined) ?? {};
                    const flow = inst?.flowPrefix || m.flowPrefix ? "flow " : "";
                    let typeName = inst?.typeSpecifier ?? m.typeSpecifier ?? m.type_specifier ?? "Real";
                    let modStr = "";
                    if (inst?.modification?.args && inst.modification.args.length > 0) {
                      modStr =
                        "(" +
                        inst.modification.args
                          .map((a) => `${a.name} = "${a.value?.text ?? a.value?.value ?? ""}"`)
                          .join(", ") +
                        ")";
                    } else {
                      const resolved = db.byName(typeName)?.find((e) => e.kind === "Class");
                      if (resolved) {
                        const resolvedCst = db.cstNode?.(resolved.id) as CstNodeLike | null;
                        const shortSpec = getShortClassSpecifierNode(resolvedCst);
                        if (shortSpec) {
                          const typeSpecNode = (shortSpec.children || []).find(
                            (c: CstNodeLike) => c.type === "type_specifier" || c.type === "name",
                          );
                          const modNode = (shortSpec.children || []).find(
                            (c: CstNodeLike) => c.type === "class_modification",
                          );
                          if (typeSpecNode?.text) {
                            const base = typeSpecNode.text.trim();
                            typeName = modNode?.text ? `${base}${modNode.text.trim()}` : base;
                          }
                        }
                      }
                    }
                    return `  ${flow}${typeName}${modStr} ${c.name};`;
                  });
                  return `connector ${sym.name}\n${compLines.join("\n")}\nend ${sym.name};`;
                };
                dae.diagnostics.push({
                  severity: "error",
                  code: ModelicaErrorCode.CONNECT_FLOW_MISMATCH.code,
                  message: ModelicaErrorCode.CONNECT_FLOW_MISMATCH.message(
                    flowMismatch.flowComp,
                    flowMismatch.nonFlowComp,
                  ),
                  range,
                });
                dae.diagnostics.push({
                  severity: "error",
                  code: ModelicaErrorCode.CONNECT_TYPES_INCONSISTENT.code,
                  message: `The type of variables \n${r0Raw} type:\n${formatConnectorType(
                    sym0,
                  )} and \n${r1Raw} type:\n${formatConnectorType(sym1)}\nare inconsistent in connect equations.`,
                  range,
                });
              } else {
                dae.diagnostics.push({
                  severity: "error",
                  code: ModelicaErrorCode.NOT_PLUG_COMPATIBLE.code,
                  message: ModelicaErrorCode.NOT_PLUG_COMPATIBLE.message(r0Raw, r1Raw),
                  range,
                });
              }
              return;
            }
          }
        }
      }
    }

    const lhsExprId = flattener.lowerExpr(refs[0], dae, prefix, substitutions);
    if (lhsExprId < 0) return;
    const rhsExprId = flattener.lowerExpr(refs[1], dae, prefix, substitutions);
    if (rhsExprId < 0) return;
    const lhsName =
      dae.getExprKind(lhsExprId) === ExprKind.Name ? dae.interner.resolve(dae.getExprData1(lhsExprId)) : "";
    const rhsName =
      dae.getExprKind(rhsExprId) === ExprKind.Name ? dae.interner.resolve(dae.getExprData1(rhsExprId)) : "";
    const lhsExpanded = lhsName ? expandConnectorRef(lhsName, dae) : [];
    const rhsExpanded = rhsName ? expandConnectorRef(rhsName, dae) : [];
    const keepOuterOuterWhole =
      connFlags === 3 &&
      [...lhsExpanded, ...rhsExpanded].some((n) => {
        const vi = dae.getVarIdxByName(n);
        return vi >= 0 && dae.isVarStream(vi);
      });
    if (!keepOuterOuterWhole && lhsExpanded.length > 1 && lhsExpanded.length === rhsExpanded.length) {
      for (let k = 0; k < lhsExpanded.length; k++) {
        const lId = dae.addName(dae.interner.intern(lhsExpanded[k]!));
        const rId = dae.addName(dae.interner.intern(rhsExpanded[k]!));
        const eqId = dae.addEquation(EqKind.Connect, lId, rId, connFlags);
        const sb = node?.startIndex ?? node?.startOffset;
        const eb = node?.endIndex ?? node?.endOffset;
        if (sb !== undefined && eb !== undefined) {
          dae.setEqSourceRange(eqId, sb, eb);
        }
      }
      return;
    }
    const eqId = dae.addEquation(EqKind.Connect, lhsExprId, rhsExprId, connFlags);
    const sb = node?.startIndex ?? node?.startOffset;
    const eb = node?.endIndex ?? node?.endOffset;
    if (sb !== undefined && eb !== undefined) {
      dae.setEqSourceRange(eqId, sb, eb);
    }
    return;
  }
  for (const kid of (node.children || []) as EquationCstNode[]) {
    if (kid.type !== "class_definition") {
      walk(kid, substitutions, isInitial);
    }
  }
}

/**
 * Expands a connector reference string (e.g. `c` or `arr.pin`) into all concrete scalarized
 * connector endpoint paths in `dae` when the reference denotes an unsubscripted connector array.
 *
 * Resolution strategy:
 * 1. Fast path for an exact variable match in `dae`.
 * 2. Named array shape lookup via `getNamedArrayShape`, generating `[1]..[N]` suffixes.
 * 3. Prefix-set and regex scan across `dae` variables to discover intermediate subscripted prefixes.
 *
 * @param refStr - Qualified connector reference path (with or without explicit subscripts).
 * @param dae - Target `DAEBuilder` containing instantiated connector variables and shapes.
 * @returns Ordered list of scalarized connector endpoint strings (or `[refStr]` if scalar).
 */
export function expandConnectorRef(refStr: string, dae: DAEBuilder): string[] {
  const daeWithCache = dae as DaeWithConnectorCache;
  let cache = daeWithCache._expandConnectorRefCache;
  if (!cache) {
    cache = new Map<string, string[]>();
    daeWithCache._expandConnectorRefCache = cache;
  }
  const cached = cache.get(refStr);
  if (cached !== undefined) return cached;

  // 1. Direct scalar or exact variable reference
  if (dae.getVarIdxByName(refStr) >= 0) {
    const res = [refStr];
    cache.set(refStr, res);
    return res;
  }
  // 2. Direct shape lookup for array connector
  const namedShape = getNamedArrayShape(dae, refStr);
  if (namedShape && namedShape.length > 0) {
    const res = generateArrayIndices(namedShape).map((idx) => `${refStr}${idx}`);
    cache.set(refStr, res);
    return res;
  }
  // 3. Fallback: deterministic segment scan when array elements exist in prefixes
  const prefixSet = getVarPrefixSet(dae);
  const parts = refStr.split(".");
  const firstPart = parts[0]!;
  if (
    (!prefixSet.has(refStr) && !prefixSet.has(firstPart)) ||
    !parts.some((p, idx) => !p.includes("[") && dae.hasArrayElements(parts.slice(0, idx + 1).join(".")))
  ) {
    const res = [refStr];
    cache.set(refStr, res);
    return res;
  }
  const found = new Set<string>();
  for (let i = 0; i < dae.varCount; i++) {
    if (dae.isVarRemoved(i)) continue;
    const vn = dae.getVarName(i);
    const matchedPrefix = matchDottedArrayPrefix(vn, parts);
    if (matchedPrefix && matchedPrefix.includes("[")) {
      found.add(matchedPrefix);
    }
  }
  const res =
    found.size === 0 ? [refStr] : Array.from(found).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  cache.set(refStr, res);
  return res;
}

function isBracketIndexSuffix(text: string): boolean {
  if (!text.startsWith("[") || !text.endsWith("]") || text.length <= 2) return false;
  for (let i = 1; i < text.length - 1; i++) {
    const c = text[i]!;
    if ((c >= "0" && c <= "9") || c === "," || c === " " || c === "\t" || c === "\n" || c === "\r") {
      continue;
    }
    return false;
  }
  return true;
}

function matchDottedArrayPrefix(varName: string, parts: readonly string[]): string | null {
  const vnParts = varName.split(".");
  if (vnParts.length < parts.length) return null;
  for (let i = 0; i < parts.length; i++) {
    const seg = vnParts[i]!;
    const expected = parts[i]!;
    if (!seg.startsWith(expected)) return null;
    const suffix = seg.slice(expected.length);
    if (suffix !== "" && !isBracketIndexSuffix(suffix)) return null;
  }
  return vnParts.slice(0, parts.length).join(".");
}

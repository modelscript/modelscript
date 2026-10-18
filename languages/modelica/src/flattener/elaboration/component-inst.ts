// SPDX-License-Identifier: AGPL-3.0-or-later

import { EqKind, ExprKind } from "@modelscript/dsl";
import {
  BinOp,
  Causality,
  DAEBuilder,
  evaluateArenaFunctionCall,
  inferArenaExprVarType,
  isAssignableType,
  UnaryOp,
  UnifiedWorkspace,
  Variability,
  VarType,
  varTypeName,
  type QueryDB,
  type SymbolEntry,
  type SymbolId,
} from "@modelscript/runtime";
import { Cst, type SyntaxNode } from "../../../src-gen/bindings.js";
import { AnnotationEvaluator } from "../../diagram/annotation-evaluator.js";
import { ModelicaErrorCode } from "../../errors.js";
import { isPredefinedType } from "../../predefined-types.js";
import {
  cyclicDimensionDiagnostics,
  getShortClassSpecifierNode,
  isScopeEncapsulated,
  isSymbolEncapsulated,
  resolveQualified,
  validateEnumeration,
  type ScopeData,
} from "../../queries.js";
import {
  castToRealExpr,
  checkIfExprTypeMismatch,
  copyExprBetweenDaes,
  evalDaeExpr,
  evaluateCSTNumber,
  expandColonToArrayCtor,
  exprContainsNameRef,
  exprReferencesRuntimeParameter,
  extractEnumLiteralsFromCst,
  formatArenaValForMod,
  generateArrayTuples,
  getArrayCtorElements,
  getArrayLiteralItems,
  getBaseEnumSymbol,
  getExprDims,
  getIndexedElementText,
  getSymbolEnumLiterals,
  getSymbolQualifiedName,
  isArrayLiteral,
  isIntegerTypeSpec,
  isRealExpr,
  lookupDbConstant,
  mulWithSimplification,
  parseArrayLiteralElements,
  parseRawLiteralArg,
  resolveEnumType,
  resolveScopedName,
  splitTopLevel,
  splitTopLevelArgs,
  stripArraySubscripts,
} from "../expressions/index.js";
import { getElementDiagRange } from "../support/range-utils.js";
import { getFlatteningState, getNamedArrayShape, setNamedArrayShape } from "../support/state.js";
import { ModelicaModificationEnv } from "../support/wasm-bridge.js";
import { type ComponentInstanceData, type FlattenOptions } from "../types.js";

/**
 * Host flattener interface required by the component elaboration kernel.
 *
 * Exposes the Salsa {@link QueryDB}, active class/import scopes, `inner`/`outer` and
 * expandable connector registries, and callbacks for lowering CST expressions and
 * flattening nested functions or record constructors.
 */
export interface ComponentFlattener {
  db: QueryDB;
  options: Omit<Required<FlattenOptions>, "flowThreshold"> & { flowThreshold?: number | undefined };
  currentRootClassId: SymbolId;
  currentClassId: SymbolId;
  currentImports: Map<string, string>;
  currentParentMods?: any;
  currentBindingCompName?: string | undefined;
  innerDeclarations: Map<string, Map<string, string>>;
  innerOuterComponents: Set<string>;
  disabledComponents: Set<string>;
  expandableBuses: Map<string, SymbolId>;
  usedExternalObjects: Set<SymbolId>;
  usedRecordSymIds: Set<SymbolId>;
  usedRecordNames: Set<string>;
  failedFunctionIds: Set<SymbolId>;
  invalidInterfaceFunctionIds: Set<SymbolId>;
  calledFunctionSymIds: Set<SymbolId>;
  activeLoopVars: Set<string>;
  usedOperatorFunctions: Map<string, SymbolId>;
  evaluatedConstantArrays: Map<string, any>;
  varConditionDeps: Map<string, string[]>;
  useLocalDirection?: boolean | undefined;
  lowerExpr: (
    node: any,
    dae: DAEBuilder,
    prefix?: string,
    substitutions?: any,
    tupleContext?: boolean,
    isAssignmentLhs?: boolean,
  ) => number;
  pushLoopVar: (name: string) => void;
  popLoopVar: (name: string) => void;
  isClassPartial: (classId?: SymbolId | null) => boolean;
  isOldFrontend?: boolean | undefined;
  isExternalObject: (classId: SymbolId | null | undefined, visited?: Set<SymbolId>) => boolean;
  isOperatorRecordSym: (sym: any) => boolean;
  generateRecordConstructorFor: (sym: any, dae: DAEBuilder, rootClassId?: SymbolId) => DAEBuilder | null;
  flattenFunction: (
    fnSymId: SymbolId,
    fnName: string,
    modifiers?: any[],
    parentDae?: DAEBuilder,
    enclosingScopeId?: SymbolId,
  ) => DAEBuilder;
  [key: string]: any;
}

const sharedComponentAnnotationEvaluator = new AnnotationEvaluator();
const componentHiddenCache = new WeakMap<object, Map<SymbolId, boolean>>();

function findFirstExpressionCst(n: any): any {
  if (!n) return null;
  if (n.type === "expression") return n;
  for (const c of n.children || []) {
    const res = findFirstExpressionCst(c);
    if (res) return res;
  }
  return null;
}

function parseStandaloneExpressionCst(exprText: string): any | null {
  const trimmed = exprText.trim();
  if (!trimmed) return null;
  const parser = UnifiedWorkspace.getGlobalParser(".mo");
  if (!parser) return null;
  try {
    const dummyTree = parser.parse(`model _Tmp equation _x = ${trimmed}; end _Tmp;`);
    if (!dummyTree?.rootNode) return null;
    const findRhs = (n: any): any => {
      if (n.type === "simple_equation") return n.children?.find((c: any) => c.type === "expression");
      for (const ch of n.children || []) {
        const r = findRhs(ch);
        if (r) return r;
      }
      return null;
    };
    return findRhs(dummyTree.rootNode) ?? findFirstExpressionCst(dummyTree.rootNode);
  } catch {
    return null;
  }
}

function isIntegerArenaExpr(exprId: number, dae: DAEBuilder): boolean {
  if (exprId < 0) return false;
  const kind = dae.getExprKind(exprId);
  if (kind === ExprKind.IntLiteral) return true;
  if (kind === ExprKind.RealLiteral) return false;
  if (kind === ExprKind.Name) {
    const name = dae.interner.resolve(dae.getExprData1(exprId));
    const vIdx = dae.lookupVariable(name);
    if (vIdx >= 0) return dae.getVarType(vIdx) === VarType.Integer;
    const state = getFlatteningState(dae) as any;
    const flattener = state?.flattener;
    if (
      state?.activeLoopVars?.has?.(name) ||
      flattener?.activeLoopVars?.has?.(name) ||
      state?.loopVars?.has?.(name) ||
      state?.loopVarValues?.has?.(name) ||
      flattener?.loopVarValues?.has?.(name)
    ) {
      return true;
    }
    if (state?.namedArrayTypes?.get?.(name) === VarType.Integer) {
      return true;
    }
    const db = state?.db ?? flattener?.db;
    if (db) {
      const leafName = name.includes(".") ? name.split(".").pop()! : name;
      const scopeIds = [
        state?.currentClassId,
        flattener?.currentClassId,
        state?.currentRootClassId,
        flattener?.currentRootClassId,
      ].filter(Boolean);
      for (const sId of scopeIds) {
        const resolved =
          db.query?.("resolveSimpleName", sId)?.(name) ??
          db.query?.("resolveName", sId)?.(name) ??
          (leafName !== name ? db.query?.("resolveSimpleName", sId)?.(leafName) : null);
        if (resolved && resolved.kind === "Component") {
          const tSpec = db.query?.("typeSpecifier", resolved.id) ?? (resolved.metadata as any)?.typeSpecifier;
          if (tSpec && isIntegerTypeSpec(String(tSpec), db)) return true;
        }
      }
      const byNameSyms = (db.byName?.(leafName) ?? []).filter((s: any) => s.kind === "Component");
      if (byNameSyms.length > 0) {
        const scopedSyms =
          scopeIds.length > 0 ? byNameSyms.filter((s: any) => scopeIds.includes(s.parentId)) : byNameSyms;
        const candidates = scopedSyms.length > 0 ? scopedSyms : byNameSyms;
        if (
          candidates.some((s: any) => {
            const tSpec = db.query?.("typeSpecifier", s.id) ?? (s.metadata as any)?.typeSpecifier;
            return Boolean(tSpec && isIntegerTypeSpec(String(tSpec), db));
          })
        ) {
          return true;
        }
      }
      return false;
    }
    return name === "n" || name === "m";
  }
  if (kind === ExprKind.Binary) {
    const op = dae.getExprData1(exprId);
    if (op === BinOp.Add || op === BinOp.Sub || op === BinOp.Mul) {
      return isIntegerArenaExpr(dae.getExprLeft(exprId), dae) && isIntegerArenaExpr(dae.getExprRight(exprId), dae);
    }
  }
  return false;
}

function hasFieldVariablesInDae(dae: DAEBuilder, prefixText: string): boolean {
  const dotPrefix = `${prefixText}.`;
  if (typeof (dae as any).hasVariablesWithPrefix === "function") {
    return Boolean((dae as any).hasVariablesWithPrefix(dotPrefix));
  }
  for (let i = 0; i < dae.varCount; i++) {
    if (!dae.isVarRemoved(i) && dae.getVarName(i).startsWith(dotPrefix)) {
      return true;
    }
  }
  return false;
}

function isReplaceablePackageIdentifier(
  ident: string,
  flattener: ComponentFlattener,
  dae: DAEBuilder,
  redeclPkgPrefix?: string | null,
  parentMods?: any,
  scopeClassId?: SymbolId | null,
): boolean {
  if (!ident) return false;
  if (redeclPkgPrefix && ident === redeclPkgPrefix) return true;
  if (/^(?:Medium|Medium1|Medium2)$/.test(ident)) return true;
  const state = getFlatteningState(dae, flattener) as any;
  for (const col of [state?.packageRedeclares, state?.classRedeclares, state?.ElementRedeclares]) {
    if (!col) continue;
    if (typeof col.has === "function" && col.has(ident)) return true;
    if (Array.isArray(col) && col.includes(ident)) return true;
  }
  if (
    parentMods?.args?.some(
      (a: any) => !a?.isBreak && a?.name === ident && (a?.isRedeclaration || a?.redeclaredTypeSpecifier),
    )
  ) {
    return true;
  }
  const db = flattener?.db;
  if (db) {
    const checkSymPkg = (sym: any): boolean => {
      if (!sym) return false;
      if ((sym.metadata as any)?.isReplaceable) return true;
      const cstNode = db.cstNode?.(sym.id) as any;
      const headerText = (cstNode?.parent?.type === "element" ? cstNode.parent.text : (cstNode?.text ?? "")).slice(
        0,
        200,
      );
      if (/\b(?:replaceable|redeclare)\b[\s\w]*\bpackage\b/.test(headerText)) {
        return true;
      }
      return false;
    };
    const scopes = [
      scopeClassId,
      parentMods?.currentClassId,
      parentMods?.ownerClassId,
      flattener.currentClassId,
      flattener.currentRootClassId,
    ].filter((s): s is SymbolId => Boolean(s));
    for (const sId of scopes) {
      const resolved =
        db.query?.<any>("resolveSimpleName", sId)?.(ident) ?? db.query?.<any>("resolveName", sId)?.(ident);
      if (checkSymPkg(resolved)) return true;
    }
  }
  return false;
}

function extractReplaceablePackagePrefix(
  exprText: string,
  flattener: ComponentFlattener,
  dae: DAEBuilder,
  redeclPkgPrefix?: string | null,
  parentMods?: any,
  scopeClassId?: SymbolId | null,
): string | null {
  const m = /^([a-zA-Z_]\w*)\./.exec(exprText.trim());
  if (!m) return null;
  const firstSeg = m[1]!;
  return isReplaceablePackageIdentifier(firstSeg, flattener, dae, redeclPkgPrefix, parentMods, scopeClassId)
    ? firstSeg
    : null;
}

function evaluateComprehensionRangeValues(
  rangeExpr: string,
  flattener: ComponentFlattener,
  dae: DAEBuilder,
  prefix: string,
  scopeId?: SymbolId,
): string[] | null {
  const rTrim = rangeExpr.trim();
  if (!rTrim) return null;
  if (rTrim.startsWith("{") && rTrim.endsWith("}")) {
    const elems = parseArrayLiteralElements(rTrim).map((e) => e.trim());
    return elems.length > 0 ? elems : null;
  }
  if (rTrim === "Boolean") {
    return ["false", "true"];
  }
  const colonParts = splitTopLevel(rTrim, ":");
  if (colonParts.length === 2 || colonParts.length === 3) {
    const evalNumPart = (p: string): number | null => {
      const t = p.trim();
      const direct = Number(t);
      if (!isNaN(direct) && t !== "") return direct;
      const scopedName = prefix ? `${prefix}.${t}` : t;
      const vIdx = dae.lookupVariable(scopedName) >= 0 ? dae.lookupVariable(scopedName) : dae.lookupVariable(t);
      if (vIdx >= 0) {
        const sv = dae.getVarExpression(vIdx);
        const val = sv !== undefined && sv >= 0 ? evalDaeExpr(sv, dae) : dae.getVarStartValue(vIdx);
        if (typeof val === "number" && !isNaN(val)) return val;
      }
      const cstNum = evaluateCSTNumber(t, undefined, scopeId, flattener.db, dae, prefix);
      if (typeof cstNum === "number" && !isNaN(cstNum)) return cstNum;
      const ev = flattener.db?.evaluate?.(t, scopeId);
      if (typeof ev === "number" && !isNaN(ev)) return ev;
      return null;
    };
    const startVal = evalNumPart(colonParts[0]!);
    const stepVal = colonParts.length === 3 ? evalNumPart(colonParts[1]!) : 1;
    const stopVal = evalNumPart(colonParts[colonParts.length - 1]!);
    if (startVal !== null && stepVal !== null && stopVal !== null && stepVal !== 0) {
      const values: string[] = [];
      const maxLen = 10000;
      if (stepVal > 0) {
        for (let v = startVal; v <= stopVal + 1e-12 && values.length < maxLen; v += stepVal) {
          values.push(String(Number.isInteger(v) ? v : Number(v.toPrecision(15))));
        }
      } else {
        for (let v = startVal; v >= stopVal - 1e-12 && values.length < maxLen; v += stepVal) {
          values.push(String(Number.isInteger(v) ? v : Number(v.toPrecision(15))));
        }
      }
      return values.length > 0 ? values : null;
    }
  }
  const enumInfo = resolveEnumType(rTrim, scopeId, flattener.db);
  if (enumInfo && enumInfo.literals.length > 0) {
    return enumInfo.literals.map((l) => `${enumInfo.qual}.${l}`);
  }
  return null;
}

function parseModelicaArrayArg(
  raw: string,
  dae: DAEBuilder,
  flattener: ComponentFlattener,
  prefix?: string,
  scopeId?: SymbolId,
): any {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed.replace(/\{/g, "[").replace(/\}/g, "]"));
  } catch {
    if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return undefined;
    const elems = parseArrayLiteralElements(trimmed);
    const parsed: any[] = [];
    for (const el of elems) {
      const et = el.trim();
      if (et.startsWith("{") && et.endsWith("}")) {
        const sub = parseModelicaArrayArg(et, dae, flattener, prefix, scopeId);
        if (sub === undefined) return undefined;
        parsed.push(sub);
        continue;
      }
      if (et === "true") {
        parsed.push(true);
        continue;
      }
      if (et === "false") {
        parsed.push(false);
        continue;
      }
      if (et.startsWith('"') && et.endsWith('"')) {
        parsed.push(et.slice(1, -1));
        continue;
      }
      const num = Number(et);
      if (!isNaN(num) && et !== "") {
        parsed.push(num);
        continue;
      }
      const scoped = prefix ? `${prefix}.${et}` : et;
      let vIdx = dae.lookupVariable(scoped);
      if (vIdx < 0) vIdx = dae.lookupVariable(et);
      if (vIdx >= 0) {
        const sv = dae.getVarExpression(vIdx);
        const val = sv !== undefined && sv >= 0 ? evalDaeExpr(sv, dae) : dae.getVarStartValue(vIdx);
        if (val !== null && val !== undefined) {
          parsed.push(val);
          continue;
        }
      }
      const cstNum = evaluateCSTNumber(et, undefined, scopeId, flattener.db, dae, prefix);
      if (typeof cstNum === "number" && !isNaN(cstNum)) {
        parsed.push(cstNum);
        continue;
      }
      const ev = flattener.db?.evaluate?.(et, scopeId);
      if (ev !== null && ev !== undefined) {
        parsed.push(ev);
        continue;
      }
      return undefined;
    }
    return parsed;
  }
}

function canonicalizeOldFrontendExpr(exprId: number, varType: number, dae: DAEBuilder, forceOldStyle = false): number {
  if (exprId < 0) return exprId;
  const isOld = Boolean(dae.extensionMetadata?.["isOldFrontend"]) || forceOldStyle;
  const kind = dae.getExprKind(exprId);
  if (kind === ExprKind.Binary) {
    const op = dae.getExprData1(exprId);
    const left = dae.getExprLeft(exprId);
    const right = dae.getExprRight(exprId);
    if (
      op === BinOp.Sub &&
      dae.getExprKind(left) === ExprKind.Name &&
      dae.getExprKind(right) === ExprKind.IntLiteral &&
      (isOld || varType === VarType.Integer)
    ) {
      const k = dae.getExprData1(right);
      if (k > 0) {
        const negLitId = dae.addIntLiteral(-k);
        return dae.addBinaryExpr(BinOp.Add, negLitId, left);
      }
    }
    if (op === BinOp.Div && varType === VarType.Real) {
      let newLeft = left;
      let newRight = canonicalizeOldFrontendExpr(right, VarType.Integer, dae, isOld);
      if (dae.getExprKind(newLeft) === ExprKind.Name && isIntegerArenaExpr(newLeft, dae)) {
        newLeft = dae.addCallExpr("/*Real*/", [newLeft]);
      }
      if (
        (dae.getExprKind(newRight) === ExprKind.Name && isIntegerArenaExpr(newRight, dae)) ||
        (isOld && isIntegerArenaExpr(newRight, dae))
      ) {
        newRight = dae.addCallExpr("/*Real*/", [newRight]);
      }
      if (newLeft !== left || newRight !== right) {
        return dae.addBinaryExpr(BinOp.Div, newLeft, newRight);
      }
    }
  }
  return exprId;
}

function lowerStandaloneExpression(
  flattener: ComponentFlattener,
  exprText: string,
  dae: DAEBuilder,
  bindingPrefix: string | undefined,
  compName?: string,
  varType?: number,
): number | null {
  const rhsNode = parseStandaloneExpressionCst(exprText);
  if (!rhsNode) return null;
  const prevCompName = flattener.currentBindingCompName;
  flattener.currentBindingCompName = compName;
  const diagCountBefore = dae.diagnostics.length;
  try {
    const parsedId = flattener.lowerExpr(rhsNode, dae, bindingPrefix);
    if (parsedId >= 0) {
      return varType !== undefined ? canonicalizeOldFrontendExpr(parsedId, varType, dae) : parsedId;
    }
    return null;
  } catch {
    return null;
  } finally {
    dae.diagnostics.length = diagCountBefore;
    flattener.currentBindingCompName = prevCompName;
  }
}

function tryScalarizeIfSizeBindingCst(
  rawExprCst: any,
  bText: string,
  idxTuple: number[],
  bindingPrefix: string | undefined,
  dae: DAEBuilder,
): number | null {
  if (idxTuple.length === 0) return null;
  const rootNode = rawExprCst ?? parseStandaloneExpressionCst(bText);
  if (!rootNode) return null;
  const findIfExpr = (n: any): any => {
    if (!n) return null;
    if (n.type === "if_expression") return n;
    if (
      n.type === "expression" ||
      n.type === "simple_expression" ||
      n.type === "primary" ||
      n.type === "output_expression_list"
    ) {
      for (const c of n.children || []) {
        const found = findIfExpr(c);
        if (found) return found;
      }
    }
    return null;
  };
  const ifNode = findIfExpr(rootNode);
  if (!ifNode) return null;
  const exprChildren = (ifNode.children || []).filter(
    (c: any) =>
      c.type === "expression" ||
      c.type === "simple_expression" ||
      c.type === "logical_expression" ||
      c.type === "relation",
  );
  if (exprChildren.length < 3) return null;
  const condText = (exprChildren[0].text ?? "").trim();
  const thenText = (exprChildren[1].text ?? "").trim();
  const elseText = (exprChildren[exprChildren.length - 1].text ?? "").trim();
  const sizeCondMatch = condText.match(/^size\(\s*([a-zA-Z_][\w.]*)\s*,\s*1\s*\)\s*==\s*1$/);
  if (!sizeCondMatch) return null;
  const arrName = sizeCondMatch[1]!;
  const resolvedArr = resolveScopedName(arrName, bindingPrefix ?? "", dae);
  const hasSecond = dae.getVarIdxByName(`${resolvedArr}[2]`) >= 0;
  const branchText = !hasSecond ? thenText : elseText;
  const onesMulMatch = branchText.match(/^ones\([^)]*\)\s*\*\s*([a-zA-Z_][\w.]*)\[1\]$/);
  if (onesMulMatch && onesMulMatch[1] === arrName) {
    return dae.addExpression(ExprKind.Name, dae.interner.intern(`${resolvedArr}[1]`));
  }
  if (branchText === arrName) {
    const targetIdx = hasSecond ? idxTuple[0] : 1;
    return dae.addExpression(ExprKind.Name, dae.interner.intern(`${resolvedArr}[${targetIdx}]`));
  }
  return null;
}

/**
 * Checks whether a component declaration carries an `annotation(HideResult = true)`,
 * caching the evaluated boolean per `(QueryDB, SymbolId)` pair.
 *
 * @param flattener - Active component flattener context.
 * @param elemId - Symbol ID of the component declaration.
 * @returns `true` if `HideResult` is enabled on the component or its enclosing clause.
 */
export function isComponentHidden(flattener: ComponentFlattener, elemId: SymbolId): boolean {
  const dbKey = flattener.db as unknown as object;
  let dbMap = componentHiddenCache.get(dbKey);
  if (dbMap) {
    const cached = dbMap.get(elemId);
    if (cached !== undefined) return cached;
  } else {
    dbMap = new Map<SymbolId, boolean>();
    componentHiddenCache.set(dbKey, dbMap);
  }

  const cst = flattener.db.cstNode(elemId) as any;
  if (!cst) {
    dbMap.set(elemId, false);
    return false;
  }
  let curr = cst;
  while (curr && curr.type !== "component_declaration" && curr.type !== "component_clause") {
    curr = curr.parent;
  }
  if (!curr) curr = cst;
  const rawText = (curr?.text ?? cst?.text ?? "").toLowerCase();
  if (!rawText.includes("hideresult")) {
    dbMap.set(elemId, false);
    return false;
  }
  const hideRes =
    sharedComponentAnnotationEvaluator.evaluate(curr, "hideresult") ??
    sharedComponentAnnotationEvaluator.evaluate(cst, "hideresult");
  let result = false;
  if (hideRes !== null && hideRes !== undefined) {
    if (typeof hideRes === "boolean") result = hideRes;
    else if (typeof hideRes === "object" && hideRes.value !== undefined) result = Boolean(hideRes.value);
    else result = true;
  }
  dbMap.set(elemId, result);
  return result;
}

/**
 * Extracts the unquoted Modelica description string (e.g., `"Capacitor voltage"`)
 * attached to a component declaration CST node, or returns `null` if none is present.
 *
 * @param elemCst - CST node of the component declaration.
 * @returns Unquoted description string, or `null` if absent or empty (`""`).
 */
export function extractDescription(elemCst: any): string | null {
  if (!elemCst) return null;
  let curr: any = elemCst;
  let targetNode: any = null;
  while (curr && curr.type !== "component_clause" && curr.type !== "class_definition") {
    if (
      curr.type === "component_declaration" ||
      curr.type === "component_declaration1" ||
      Cst.ComponentDeclaration.is(curr)
    ) {
      targetNode = curr;
      break;
    }
    curr = curr.parent;
  }
  if (!targetNode) targetNode = elemCst;

  const findDescNode = (node: any): any => {
    if (!node) return null;
    for (const c of node.children || []) {
      if (
        c.type === "description_string" ||
        c.type === "string_literal" ||
        c.type === "comment" ||
        Cst.DescriptionString.is(c)
      ) {
        return c;
      }
      if (c.type === "description" || Cst.Description.is(c)) {
        for (const ch of c.children || []) {
          if (
            ch.type === "description_string" ||
            ch.type === "string_literal" ||
            ch.type === "comment" ||
            Cst.DescriptionString.is(ch)
          ) {
            return ch;
          }
        }
      }
    }
    return null;
  };

  const descNode = findDescNode(targetNode) ?? findDescNode(targetNode.parent) ?? findDescNode(elemCst);
  if (descNode) {
    const t = descNode.text?.trim() ?? "";
    if (t && t !== '""') {
      return t.startsWith('"') && t.endsWith('"') ? t.slice(1, -1) : t;
    }
  }
  return null;
}

/**
 * Resolves the target base class {@link SymbolEntry} for an `extends` clause symbol.
 *
 * Queries Salsa's `resolvedBaseClass` first, falling back to `resolveName`/`resolveSimpleName`
 * in `scopeId` and finally global `byName` lookup.
 *
 * @param flattener - Active component flattener context.
 * @param extChild - Symbol entry of the `Extends` clause.
 * @param scopeId - Enclosing class scope ID.
 * @returns Resolved base class symbol entry, or `null` if unresolvable.
 */
export function resolveExtendsBase(
  flattener: ComponentFlattener | any,
  extChild: any,
  scopeId: SymbolId,
): SymbolEntry | null {
  if (!extChild || !extChild.name) return null;
  const baseClass = flattener.db.query("resolvedBaseClass", extChild.id);
  if (baseClass) return baseClass;
  try {
    const res =
      flattener.db.query("resolveName", scopeId)?.(extChild.name) ??
      flattener.db.query("resolveSimpleName", scopeId)?.(extChild.name);
    if (res) {
      const s = flattener.db.symbol(res);
      if (s && s.kind === "Class") return s;
    }
  } catch {}
  return flattener.db.byName(extChild.name).find((e: any) => e.kind === "Class") ?? null;
}

/**
 * Determines whether a class symbol represents a scalar or array `type` alias
 * (e.g., `type Voltage = Real(unit="V")` or a class extending a predefined primitive type
 * without declaring sub-components) rather than a composite structured model/record/block.
 *
 * @param flattener - Active component flattener context.
 * @param classId - Symbol ID of the candidate class.
 * @param visited - Cycle-detection set for recursive `extends` chains.
 * @returns `true` if `classId` specializes a primitive or enumeration type.
 */
export function isClassType(flattener: ComponentFlattener, classId: SymbolId, visited = new Set<SymbolId>()): boolean {
  if (visited.has(classId)) return false;
  visited.add(classId);
  const target = flattener.db.symbol(classId);
  if (!target) return false;
  const meta = target.metadata as any;
  if (meta?.classKind === "type" || meta?.classPrefixes === "type" || meta?.isType) return true;
  const cst = flattener.db.cstNode(classId) as any;
  if (!cst) return false;

  const prefixes = Cst.ClassDefinition.classPrefixes(cst);
  const cleanPrefixes = (prefixes?.text ?? "").replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "");
  if (/\btype\b/.test(cleanPrefixes)) return true;
  if (/\b(model|record|block|package)\b/.test(cleanPrefixes)) return false;

  const shortSpec = getShortClassSpecifierNode(cst);
  const isShort = Boolean(shortSpec);

  if (/\bconnector\b/.test(cleanPrefixes) && !isShort) return false;

  if (isShort) {
    const subElems = flattener.db.query<SymbolId[]>("instantiate", classId);
    const hasComponents = subElems?.some((id) => flattener.db.symbol(id)?.kind === "Component");
    if (hasComponents) return false;
    return true;
  }

  const children = flattener.db.childrenOf(classId);
  const hasComponents = children.some((c) => c.kind === "Component");
  if (!hasComponents) {
    const extChild = children.find((c) => c.kind === "Extends");
    if (extChild) {
      const base: any = resolveExtendsBase(flattener, extChild, classId);
      if (base) {
        if (
          isPredefinedType(base) ||
          base.name === "Real" ||
          base.name === "Integer" ||
          base.name === "Boolean" ||
          base.name === "String"
        )
          return true;
        if (base.id !== classId && isClassType(flattener, base.id, visited)) return true;
      }
    }
  }

  return false;
}

/**
 * Validates that a short `type` alias definition (`type T = Target`) does not illegally
 * alias a composite `model`, `block`, `record`, or `connector` class (Modelica §4.5.2).
 *
 * @param flattener - Active component flattener context.
 * @param typeSymId - Symbol ID of the short `type` definition.
 * @returns Diagnostic metadata (`targetName`, `kindDesc`, `range`) if invalid, or `null` if valid.
 */
export function checkTypeAliasSpecialization(
  flattener: ComponentFlattener,
  typeSymId: SymbolId,
): { targetName: string; kindDesc: string; range: any } | null {
  const sym = flattener.db.symbol(typeSymId);
  if (!sym) return null;
  const cst = flattener.db.cstNode(typeSymId) as any;
  if (!cst) return null;
  const text = (cst.text?.trim() ?? "").replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "").trim();
  const match = text.match(
    /^(?:(?:encapsulated|partial|replaceable|final|inner|outer|redeclare)\s+)*type\s+([A-Za-z0-9_]+)\s*=\s*([A-Za-z0-9_.]+)/,
  );
  if (!match) return null;
  const targetName = match[2]!;
  if (targetName === "Real" || targetName === "Integer" || targetName === "Boolean" || targetName === "String") {
    return null;
  }
  const simpleTargetName = targetName.split(".").pop()!;
  const candidateClasses = flattener.db.byName(simpleTargetName).filter((e) => e.kind === "Class");
  if (candidateClasses.length === 0) return null;
  if (candidateClasses.some((c) => isClassType(flattener, c.id))) return null;
  const targetClass = candidateClasses[0]!;

  const targetCst = flattener.db.cstNode(targetClass.id) as any;
  const prefixes = Cst.ClassDefinition.classPrefixes(targetCst);
  const cleanPrefixes = (prefixes?.text ?? "").replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "");
  let kindDesc = "a new def";
  if (/\bmodel\b/.test(cleanPrefixes)) kindDesc = "a model";
  else if (/\bblock\b/.test(cleanPrefixes)) kindDesc = "a block";
  else if (/\brecord\b/.test(cleanPrefixes)) kindDesc = "a record";
  else if (/\bconnector\b/.test(cleanPrefixes)) kindDesc = "a connector";

  const range = {
    startByte: cst.startIndex ?? cst.startByte,
    endByte: cst.endIndex ?? cst.endByte,
    startPosition: cst.startPosition,
    endPosition: cst.endPosition,
  };
  return { targetName, kindDesc, range };
}

/**
 * Recursively collects type-level attribute modifiers applied to `typeLeafName` via
 * `extends Base(TypeName(unit=..., min=...))` clauses along the inheritance hierarchy of `scopeId`.
 *
 * @param flattener - Active component flattener context.
 * @param scopeId - Enclosing class or package symbol ID.
 * @param typeLeafName - Unqualified name of the `type` alias being modified.
 * @param visited - Cycle-detection set of visited class IDs.
 * @returns Ordered list of inherited modification argument descriptors.
 */
export function collectInheritedTypeModifiers(
  flattener: ComponentFlattener,
  scopeId: SymbolId,
  typeLeafName: string,
  visited = new Set<SymbolId>(),
): any[] {
  if (visited.has(scopeId)) return [];
  visited.add(scopeId);
  const result: any[] = [];
  const children = flattener.db.childrenOf(scopeId);
  for (const child of children) {
    if (child.kind === "Extends") {
      const baseClass = flattener.db.query<SymbolEntry | null>("resolvedBaseClass", child.id);
      if (baseClass && baseClass.id !== scopeId) {
        result.push(...collectInheritedTypeModifiers(flattener, baseClass.id, typeLeafName, visited));
      }
      const extMod = flattener.db.query<any>("extendsModificationParsed", child.id);
      const args = Array.isArray(extMod) ? extMod : (extMod?.args ?? []);
      const match = args.find((a: any) => a.name === typeLeafName);
      if (match?.nestedArgs || match?.args) {
        result.push(...(match.nestedArgs || match.args));
      }
    }
  }
  return result;
}

/**
 * Materializes or retrieves a cached WebAssembly {@link ModelicaModificationEnv} in linear memory
 * from a TypeScript modification descriptor (`mods`).
 *
 * Synchronizes `final`, `each`, and `redeclare` bitflags as well as literal/nested modification trees
 * with the AssemblyScript WASM flattening kernel when `syncWasmEnv` is active.
 *
 * @param flattener - Active component flattener context.
 * @param dae - Target `DAEBuilder` holding the WASM exports and string interner.
 * @param mods - Optional modification object containing `args` and/or a cached `wasmEnv`.
 * @returns Linear-memory `ModelicaModificationEnv` handle, or `null` if WASM env exports are unavailable.
 */
export function getOrCreateWasmEnv(
  flattener: ComponentFlattener,
  dae: DAEBuilder,
  mods?: any,
): ModelicaModificationEnv | null {
  if (!dae.exports || !dae.exports.flattener_envCreate) return null;
  if (mods?.wasmEnv instanceof ModelicaModificationEnv) {
    return mods.wasmEnv;
  }
  const state = getFlatteningState(dae, flattener);
  const wasmFlattener =
    state.wasmFlattener ?? (dae.exports?.flattener_create ? dae.exports.flattener_create(dae.ptr) : 0);
  state.wasmFlattener = wasmFlattener;

  if (!mods?.args || mods.args.length === 0) {
    if (state.emptyWasmEnv) {
      if (mods) mods.wasmEnv = state.emptyWasmEnv;
      return state.emptyWasmEnv;
    }
    const emptyEnv = new ModelicaModificationEnv(dae.exports);
    state.emptyWasmEnv = emptyEnv;
    if (mods) mods.wasmEnv = emptyEnv;
    return emptyEnv;
  }

  const env = new ModelicaModificationEnv(dae.exports);
  if (mods?.args && Array.isArray(mods.args)) {
    for (const arg of mods.args) {
      if (!arg?.name) continue;
      let flag = 0;
      if (arg.final) flag |= 1;
      if (arg.each) flag |= 2;
      if (arg.isRedeclaration) flag |= 4;

      const nameId = dae.interner.intern(arg.name);
      if (arg.isRedeclaration && arg.redeclaredTypeSpecifier) {
        const typeId = dae.interner.intern(arg.redeclaredTypeSpecifier);
        env.bindRedeclarePath(wasmFlattener, nameId, typeId, 0, flag);
      } else if (arg.value) {
        let exprId = 0xffffffff;
        if (arg.value.kind === "literal" && typeof arg.value.value === "number") {
          exprId = Number.isInteger(arg.value.value)
            ? dae.addIntLiteral(arg.value.value)
            : dae.addRealLiteral(arg.value.value);
        } else if (arg.value.kind === "literal" && typeof arg.value.value === "boolean") {
          exprId = dae.addExpression(ExprKind.BoolLiteral, arg.value.value ? 1 : 0);
        } else if (arg.value.kind === "literal" && typeof arg.value.value === "string") {
          exprId = dae.addExpression(ExprKind.StringLiteral, dae.interner.intern(arg.value.value));
        }
        if (exprId !== 0xffffffff) {
          env.setPath(wasmFlattener, nameId, exprId, flag);
        }
      }
      if (arg.nestedArgs && arg.nestedArgs.length > 0) {
        const childEnv = getOrCreateWasmEnv(flattener, dae, { args: arg.nestedArgs });
        if (childEnv) {
          env.bindNested(nameId, childEnv, flag);
        }
      }
    }
  }
  if (mods) {
    mods.wasmEnv = env;
  }
  return env;
}

/**
 * Looks up a direct or inherited member (component or nested class) named `name` inside `classId`.
 *
 * Searches direct children first, then Salsa's `instantiate` element list, and finally
 * traverses `Extends` clauses recursively.
 *
 * @param flattener - Active component flattener context.
 * @param classId - Target class symbol ID to search.
 * @param name - Unqualified member identifier.
 * @param visited - Cycle-detection set of visited class IDs.
 * @returns Matching {@link SymbolEntry}, or `null` if not found.
 */
export function classFindMember(
  flattener: ComponentFlattener,
  classId: SymbolId,
  name: string,
  visited: Set<SymbolId> = new Set(),
): SymbolEntry | null {
  if (visited.has(classId)) return null;
  visited.add(classId);

  for (const child of flattener.db.childrenOf(classId)) {
    if (child.name === name) return child;
  }

  const instElems = flattener.db.query<SymbolId[]>("instantiate", classId);
  if (instElems) {
    for (const elemId of instElems) {
      const sym = flattener.db.symbol(elemId);
      if (sym && sym.name === name) return sym;
    }
  }

  for (const child of flattener.db.childrenOf(classId)) {
    if (child.kind === "Extends") {
      const base = resolveExtendsBase(flattener, child, classId);
      if (base && (base.kind === "Class" || base.kind === "Package")) {
        const found = classFindMember(flattener, base.id, name, visited);
        if (found) return found;
      }
    }
  }

  return null;
}

/**
 * Validates class-level modification and `redeclare` arguments against `defaultTargetClassId`.
 *
 * Checks for:
 * 1. Duplicate `redeclare` clauses targeting the same element in the same modification scope.
 * 2. Missing `redeclare` keyword when attempting to modify a nested class definition (`= ...`).
 * 3. Non-existent target elements in `redeclare` clauses.
 * 4. Kind mismatches (`redeclare` of a class as a component or vice versa).
 * 5. Enumeration subtyping constraints when redeclaring replaceable `enumeration(:)` or concrete enum types.
 *
 * @param flattener - Active component flattener context.
 * @param defaultTargetClassId - Target class symbol ID being modified.
 * @param args - List of parsed modification/redeclaration arguments.
 * @param dae - Target `DAEBuilder` to record any validation diagnostics.
 * @returns `true` if all class modifiers are valid; `false` if a fatal diagnostic was emitted.
 */
export function validateClassModifiers(
  flattener: ComponentFlattener,
  defaultTargetClassId: SymbolId,
  args: any[],
  dae: DAEBuilder,
): boolean {
  const seenRedecls = new Map<string, any>();
  for (const arg of args) {
    if (arg.isBreak) continue;
    if (arg.isRedeclaration && arg.name) {
      const prevRedecl = seenRedecls.get(arg.name);
      if (prevRedecl) {
        if (
          (prevRedecl.isExtendsMod &&
            arg.isExtendsMod &&
            prevRedecl.extendsTargetClassId !== arg.extendsTargetClassId) ||
          Boolean(prevRedecl.isExtendsMod) !== Boolean(arg.isExtendsMod) ||
          (prevRedecl.evaluationScopeId !== undefined &&
            arg.evaluationScopeId !== undefined &&
            prevRedecl.evaluationScopeId !== arg.evaluationScopeId)
        ) {
          seenRedecls.set(arg.name, arg);
          continue;
        }
        dae.diagnostics.push({
          severity: "notification",
          code: ModelicaErrorCode.NOTIFICATION_FROM_HERE.code,
          message: "From here:",
          range: {
            startByte: prevRedecl.modRange?.[0] ?? prevRedecl.modPosition?.startPosition,
            endByte: prevRedecl.modRange?.[1] ?? prevRedecl.modPosition?.endPosition,
            startPosition: prevRedecl.modPosition?.startPosition,
            endPosition: prevRedecl.modPosition?.endPosition,
          },
        });
        dae.diagnostics.push({
          severity: "error",
          code: ModelicaErrorCode.DUPLICATE_REDECLARE.code,
          message: ModelicaErrorCode.DUPLICATE_REDECLARE.message(arg.name),
          range: {
            startByte: arg.modRange?.[0] ?? arg.modPosition?.startPosition,
            endByte: arg.modRange?.[1] ?? arg.modPosition?.endPosition,
            startPosition: arg.modPosition?.startPosition,
            endPosition: arg.modPosition?.endPosition,
          },
        });
        return false;
      }
      seenRedecls.set(arg.name, arg);
    }
  }

  for (const arg of args) {
    if (arg.isBreak) continue;
    const targetClassId = arg.extendsTargetClassId ?? defaultTargetClassId;
    const targetSym = flattener.db.symbol(targetClassId);
    const targetClassName = targetSym?.name ?? "";

    // 1. Missing redeclare keyword on attempted redeclaration of class (MissingRedeclare1)
    if (!arg.isRedeclaration && arg.value) {
      const targetChild = classFindMember(flattener, targetClassId, arg.name);
      if (targetChild && targetChild.kind === "Class") {
        dae.diagnostics.push({
          severity: "error",
          code: ModelicaErrorCode.MISSING_REDECLARE_KEYWORD.code,
          message: ModelicaErrorCode.MISSING_REDECLARE_KEYWORD.message(targetChild.name),
          range: {
            startByte: arg.modRange?.[0] ?? arg.modPosition?.startPosition,
            endByte: arg.modRange?.[1] ?? arg.modPosition?.endPosition,
            startPosition: arg.modPosition?.startPosition,
            endPosition: arg.modPosition?.endPosition,
          },
        });
        return false;
      }
    }

    // 2. Redeclaration checks
    if (arg.isRedeclaration) {
      if (!arg.name) {
        dae.diagnostics.push({
          severity: "error",
          code: ModelicaErrorCode.PARSE_ERROR.code,
          message: "Internal error Unknown redeclare in NFSCodeFlattenImports.flattenRedeclare",
        });
        return false;
      }
      const targetMember = classFindMember(flattener, targetClassId, arg.name);
      if (!targetMember) {
        // Element not found in class (NonexistentRedeclareModifier1 & 2)
        dae.diagnostics.push({
          severity: "error",
          code: ModelicaErrorCode.MODIFIED_ELEMENT_NOT_FOUND.code,
          message: ModelicaErrorCode.MODIFIED_ELEMENT_NOT_FOUND.message(arg.name, targetClassName),
          range: {
            startByte: arg.modRange?.[0] ?? arg.modPosition?.startPosition,
            endByte: arg.modRange?.[1] ?? arg.modPosition?.endPosition,
            startPosition: arg.modPosition?.startPosition,
            endPosition: arg.modPosition?.endPosition,
          },
        });
        return false;
      }

      // Invalid redeclaration of class as component (RedeclareClassComponent)
      if (targetMember.kind === "Class" && arg.redeclaredKind === "component") {
        const childCst = flattener.db.cstNode(targetMember.id) as any;
        let spec = childCst?.children?.find(
          (ch: any) => ch.type === "class_specifier" || ch.type === "short_class_specifier",
        );
        if (spec?.children?.[0]?.type === "short_class_specifier") spec = spec.children[0];
        const errNode = spec ?? childCst;

        dae.diagnostics.push({
          severity: "notification",
          code: ModelicaErrorCode.NOTIFICATION_FROM_HERE.code,
          message: "From here:",
          range: {
            startByte: arg.modRange?.[0] ?? arg.modPosition?.startPosition,
            endByte: arg.modRange?.[1] ?? arg.modPosition?.endPosition,
            startPosition: arg.modPosition?.startPosition,
            endPosition: arg.modPosition?.endPosition,
          },
        });
        dae.diagnostics.push({
          severity: "error",
          code: ModelicaErrorCode.INVALID_REDECLARATION_CLASS_AS_COMPONENT.code,
          message: ModelicaErrorCode.INVALID_REDECLARATION_CLASS_AS_COMPONENT.message(targetMember.name),
          range: {
            startByte: errNode?.startIndex ?? errNode?.startByte,
            endByte: errNode?.endIndex ?? errNode?.endByte,
            startPosition: errNode?.startPosition,
            endPosition: errNode?.endPosition,
          },
        });
        return false;
      }

      // Invalid redeclaration of component as class (RedeclareComponentClass)
      if (targetMember.kind === "Component" && arg.redeclaredKind === "class") {
        const compCst = flattener.db.cstNode(targetMember.id) as any;
        const diagRange = getElementDiagRange(compCst);

        dae.diagnostics.push({
          severity: "notification",
          code: ModelicaErrorCode.NOTIFICATION_FROM_HERE.code,
          message: "From here:",
          range: {
            startByte: arg.modRange?.[0] ?? arg.modPosition?.startPosition,
            endByte: arg.modRange?.[1] ?? arg.modPosition?.endPosition,
            startPosition: arg.modPosition?.startPosition,
            endPosition: arg.modPosition?.endPosition,
          },
        });
        dae.diagnostics.push({
          severity: "error",
          code: ModelicaErrorCode.INVALID_REDECLARATION_COMPONENT_AS_CLASS.code,
          message: ModelicaErrorCode.INVALID_REDECLARATION_COMPONENT_AS_CLASS.message(targetMember.name),
          range: diagRange,
        });
        return false;
      }

      // Enumeration subtyping in redeclaration (RedeclareEnum2, RedeclareEnum4, RedeclareEnum6)
      if (targetMember.kind === "Class") {
        const targetCst = flattener.db.cstNode(targetMember.id) as any;
        const targetText = (targetCst?.text ?? "").replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "");
        const targetEnumMatch = /=\s*enumeration\s*\(([^)]*)\)/.exec(targetText);
        if (targetEnumMatch) {
          const rawTargetLits = targetEnumMatch[1]!.trim();
          const isTargetGeneric = rawTargetLits === ":";
          const targetLits = isTargetGeneric
            ? []
            : rawTargetLits
                .split(",")
                .map((s) => s.trim().split(/\s+/)[0])
                .filter(Boolean);

          const modText = (arg.modText ?? "").replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "");
          const rhsMatch = /=\s*([^\n;]+)/.exec(modText);
          const rhsVal = rhsMatch ? rhsMatch[1]!.trim() : (arg.redeclaredTypeSpecifier ?? "");

          let isEnumRhs = false;
          let rhsLits: string[] = [];
          const rhsEnumMatch = /^enumeration\s*\(([^)]*)\)/.exec(rhsVal);
          if (rhsEnumMatch) {
            isEnumRhs = true;
            rhsLits = rhsEnumMatch[1]!
              .split(",")
              .map((s) => s.trim().split(/\s+/)[0]!)
              .filter(Boolean);
          } else if (rhsVal && !["Real", "Integer", "Boolean", "String"].includes(rhsVal)) {
            const typeSym = flattener.db.byName(rhsVal).find((e: any) => e.kind === "Class" || e.kind === "Type");
            if (typeSym) {
              const tCst = (flattener.db.cstNode(typeSym.id) as any)?.text ?? "";
              const tEnumMatch = /enumeration\s*\(([^)]*)\)/.exec(tCst);
              if (tEnumMatch) {
                isEnumRhs = true;
                rhsLits = tEnumMatch[1]!
                  .split(",")
                  .map((s) => s.trim().split(/\s+/)[0]!)
                  .filter(Boolean);
              }
            }
          }

          let errNode = targetCst;
          const shortDef = targetCst?.children?.find(
            (ch: any) => ch.type === "short_class_definition" || ch.type === "short_class_specifier",
          );
          if (shortDef) {
            errNode = shortDef;
          } else {
            const spec = targetCst?.children?.find((ch: any) => ch.type === "class_specifier");
            if (spec?.children?.[0]?.type === "short_class_specifier") {
              errNode = spec.children[0];
            } else if (spec) {
              errNode = spec;
            }
          }

          if (!isEnumRhs) {
            dae.diagnostics.push({
              severity: "notification",
              code: ModelicaErrorCode.NOTIFICATION_FROM_HERE.code,
              message: "From here:",
              range: {
                startByte: arg.modRange?.[0] ?? arg.modPosition?.startPosition,
                endByte: arg.modRange?.[1] ?? arg.modPosition?.endPosition,
                startPosition: arg.modPosition?.startPosition,
                endPosition: arg.modPosition?.endPosition,
              },
            });
            dae.diagnostics.push({
              severity: "error",
              code: ModelicaErrorCode.REDECLARE_ENUM_NOT_SUBTYPE.code,
              message: ModelicaErrorCode.REDECLARE_ENUM_NOT_SUBTYPE.message(targetMember.name),
              range: {
                startByte: errNode?.startIndex ?? errNode?.startByte,
                endByte: errNode?.endIndex ?? errNode?.endByte,
                startPosition: errNode?.startPosition,
                endPosition: errNode?.endPosition,
              },
            });
            return false;
          } else if (!isTargetGeneric) {
            const isSubset = rhsLits.every((l) => targetLits.includes(l));
            if (!isSubset) {
              if (dae.extensionMetadata?.["isOldFrontend"]) {
                const missingLit = targetLits.find((l) => !rhsLits.includes(l!)) ?? targetLits[0];
                const missingRef = `${targetMember.name}.${missingLit}`;
                const targetClassCst = flattener.db.cstNode(targetClassId) as any;
                const findEq = (n: any): any => {
                  if (!n) return null;
                  if (n.type === "simple_equation" && n.text?.includes(missingRef)) return n;
                  for (const ch of n.children || []) {
                    const found = findEq(ch);
                    if (found) return found;
                  }
                  return null;
                };
                const eqNode = findEq(targetClassCst) ?? errNode;
                const lhsText = eqNode?.child?.(0)?.text?.trim() ?? eqNode?.children?.[0]?.text?.trim();
                const classFqn = getSymbolQualifiedName(flattener.db, targetClassId) ?? targetClassName;
                const compClauseNode =
                  arg.cstNode?.parent?.parent?.parent ??
                  (flattener.currentClassId ? (flattener.db.cstNode(flattener.currentClassId) as any) : null);
                let instName = "tt";
                if (compClauseNode?.text && arg.modText) {
                  const m = new RegExp(`(\\w+)\\s*\\([^)]*${arg.name}`).exec(compClauseNode.text);
                  if (m?.[1]) instName = m[1];
                }
                const scopeName = `${classFqn}$${instName}`;
                const eqRange = {
                  startByte: eqNode?.startIndex ?? eqNode?.startByte,
                  endByte: eqNode?.endIndex ?? eqNode?.endByte,
                  startPosition: eqNode?.startPosition,
                  endPosition: eqNode?.endPosition,
                };
                dae.diagnostics.push({
                  severity: "error",
                  code: ModelicaErrorCode.VARIABLE_NOT_FOUND.code,
                  message: ModelicaErrorCode.VARIABLE_NOT_FOUND.message(missingRef, scopeName),
                  range: eqRange,
                });
                if (lhsText && lhsText !== missingRef) {
                  dae.diagnostics.push({
                    severity: "error",
                    code: ModelicaErrorCode.VARIABLE_NOT_FOUND.code,
                    message: ModelicaErrorCode.VARIABLE_NOT_FOUND.message(lhsText, scopeName),
                    range: eqRange,
                  });
                }
                return false;
              }
              dae.diagnostics.push({
                severity: "notification",
                code: ModelicaErrorCode.NOTIFICATION_FROM_HERE.code,
                message: "From here:",
                range: {
                  startByte: arg.modRange?.[0] ?? arg.modPosition?.startPosition,
                  endByte: arg.modRange?.[1] ?? arg.modPosition?.endPosition,
                  startPosition: arg.modPosition?.startPosition,
                  endPosition: arg.modPosition?.endPosition,
                },
              });
              dae.diagnostics.push({
                severity: "error",
                code: ModelicaErrorCode.REDECLARE_ENUM_NOT_SUBTYPE_GENERIC.code,
                message: ModelicaErrorCode.REDECLARE_ENUM_NOT_SUBTYPE_GENERIC.message(targetMember.name),
                range: {
                  startByte: errNode?.startIndex ?? errNode?.startByte,
                  endByte: errNode?.endIndex ?? errNode?.endByte,
                  startPosition: errNode?.startPosition,
                  endPosition: errNode?.endPosition,
                },
              });
              return false;
            }
          }
        }
      }
    }
  }
  return true;
}

/**
 * Elaborates and instantiates a list of class component declarations (`elements`) into the
 * target {@link DAEBuilder} under the hierarchical dot-separated `prefix`.
 *
 * Implements Layer 1 of the Modelica flattener:
 * 1. **Pre-pass & Scope Registration:** Queries Salsa's `componentInstance` for each element,
 *    detects component/type shadowing, registers `inner` component declarations in
 *    `flattener.innerDeclarations`, deduces flexible `[:]` array shapes from literal bindings,
 *    and pushes `ModelicaModificationEnv` frames into the WASM flattening kernel if enabled.
 * 2. **Conditional & `inner`/`outer` Resolution:** Evaluates `if <cond>` condition attributes
 *    (pruning disabled components into `flattener.disabledComponents`) and binds `outer`
 *    component references to their enclosing `inner` declarations (`state.outerToInner`).
 * 3. **Fast-Path Scalar Instantiation:** Directly emits un-modified primitive scalar components
 *    (`Real`, `Integer`, `Boolean`, `String`) into `DAEBuilder`, bypassing composite lookup and
 *    tuple expansion.
 * 4. **Recursive Composite Class Elaboration:** Resolves `redeclare` and `inner`/`outer` class
 *    targets, detects recursive class definitions, merges hierarchical `ModelicaModArgs` across
 *    base `extends` clauses, component declarations, and outer instance modifiers, and
 *    recursively calls `instantiateElements` for scalar or multi-dimensional composite arrays.
 * 5. **Scalarized DAE Variable Emission & Attribute Slicing:** Expands multi-dimensional
 *    primitive, `type` alias, and `enumeration` arrays via `generateArrayTuples`, emitting
 *    scalarized variables into `DAEBuilder` and slicing array-valued `start`, `fixed`, `min`,
 *    `max`, `nominal`, and `stateSelect` attributes per element index tuple.
 *
 * @param flattener - Active component flattener context.
 * @param elements - Ordered list of component `SymbolId`s from Salsa's `instantiate` query.
 * @param prefix - Hierarchical instance prefix (e.g., `""`, `"r1"`, `"arm[1].joint"`).
 * @param dae - Target linear-memory `DAEBuilder` receiving flattened variables and bindings.
 * @param parentMods - Merged modification environment passed down from the enclosing instance.
 */
export function instantiateElements(
  flattener: ComponentFlattener,
  elements: SymbolId[],
  prefix: string,
  dae: DAEBuilder,
  parentMods?: any,
): void {
  const prevParentMods = flattener.currentParentMods;
  flattener.currentParentMods = parentMods;
  const state = getFlatteningState(dae, flattener);
  try {
    // ============================================================================
    // Phase 1: Pre-Pass Metadata Lookup, `inner` Registration & Shape Deduction
    // ============================================================================
    const compInstMap = new Map<SymbolId, ComponentInstanceData | undefined>();
    const declaredNames = new Set<string>();
    const oldInstExpandedCompInst = new Map<SymbolId, ComponentInstanceData>();
    if ((dae.extensionMetadata as any)?.hasOldInstOption) {
      const expandedElements: SymbolId[] = [];
      const collectInheritedCompChain = (
        clsId: SymbolId,
        compName: string,
        visited = new Set<SymbolId>(),
      ): SymbolEntry[] => {
        if (visited.has(clsId)) return [];
        visited.add(clsId);
        const chain: SymbolEntry[] = [];
        for (const ch of flattener.db.childrenOf(clsId)) {
          if (ch.kind === "Extends") {
            const base = resolveExtendsBase(flattener, ch, clsId);
            if (base && base.kind === "Class") {
              chain.push(...collectInheritedCompChain(base.id, compName, visited));
            }
          } else if (ch.kind === "Component" && ch.name === compName) {
            chain.push(ch);
          }
        }
        return chain;
      };
      for (const elemId of elements) {
        const compInst = flattener.db.query<ComponentInstanceData>("componentInstance", elemId);
        const elemSym = flattener.db.symbol(elemId);
        if (
          compInst &&
          elemSym?.kind === "Component" &&
          elemSym.parentId != null &&
          (compInst.isRedeclare || flattener.db.query<boolean>("isRedeclare", elemId))
        ) {
          const chain = collectInheritedCompChain(elemSym.parentId, compInst.name);
          const replaceableTargets = chain.filter((c, idx) => {
            if (idx === 0) return true;
            const ci = flattener.db.query<ComponentInstanceData>("componentInstance", c.id);
            const isRed = Boolean(ci?.isRedeclare || flattener.db.query<boolean>("isRedeclare", c.id));
            const isRep = Boolean(ci?.isReplaceable || flattener.db.query<boolean>("isReplaceable", c.id));
            return isRed && isRep;
          });
          if (replaceableTargets.length > 1) {
            const leafArgs = compInst.modification?.args || [];
            for (const targetSym of replaceableTargets) {
              const targetCi = flattener.db.query<ComponentInstanceData>("componentInstance", targetSym.id);
              if (targetCi) {
                const mergedArgs =
                  targetSym.id === elemId
                    ? targetCi.modification?.args || []
                    : [...(targetCi.modification?.args || []), ...leafArgs];
                oldInstExpandedCompInst.set(targetSym.id, {
                  ...targetCi,
                  isRedeclare: true,
                  modification: {
                    ...targetCi.modification,
                    args: mergedArgs,
                  },
                });
                expandedElements.push(targetSym.id);
              }
            }
            continue;
          }
        }
        expandedElements.push(elemId);
      }
      elements = expandedElements;
    }
    for (const elemId of elements) {
      const compInst =
        oldInstExpandedCompInst.get(elemId) ?? flattener.db.query<ComponentInstanceData>("componentInstance", elemId);
      compInstMap.set(elemId, compInst);
      if (compInst?.name && compInst?.typeSpecifier) {
        if (!compInst.typeSpecifier.includes(".") && compInst.name === compInst.typeSpecifier) {
          const elemCst = flattener.db.cstNode(elemId) as any;
          let clauseNode: any = elemCst;
          while (clauseNode && clauseNode.type !== "component_clause") {
            clauseNode = clauseNode.parent;
          }
          const rangeObj = clauseNode
            ? {
                startByte: clauseNode.startIndex ?? clauseNode.startByte,
                endByte: clauseNode.endIndex ?? clauseNode.endByte,
              }
            : elemCst
              ? { startByte: elemCst.startIndex ?? elemCst.startByte, endByte: elemCst.endIndex ?? elemCst.endByte }
              : undefined;
          dae.diagnostics.push({
            severity: "error",
            code: ModelicaErrorCode.SAME_NAME_TYPE_SHADOWING.code,
            message: `Found a component with same name when looking for type ${compInst.typeSpecifier}.`,
            range: rangeObj,
          });
          return;
        }
      }

      const sym = flattener.db.symbol(elemId);
      if (sym?.name) {
        if (!compInst?.isOuter || compInst.isInner) {
          declaredNames.add(sym.name);
        }
      }

      // Register `inner` declarations at the current hierarchical prefix so nested `outer`
      // components can resolve upward to their matching `inner` instance path.
      if (compInst?.isInner && compInst?.name) {
        const fullCompName = prefix ? `${prefix}.${compInst.name}` : compInst.name;
        if (!flattener.innerDeclarations.has(prefix)) {
          flattener.innerDeclarations.set(prefix, new Map<string, string>());
        }
        flattener.innerDeclarations.get(prefix)!.set(compInst.name, fullCompName);
        (state.innerComponents ??= new Set<string>()).add(fullCompName);
      }

      // Pre-compute array dimensions for flexible `[:]` declarations bound to array literals
      // so sibling components referencing `size(arr, d)` can resolve dimensions in any order.
      const elemCstForShape = flattener.db.cstNode(elemId) as any;
      const hasColonSubscript = /\[\s*:(?:\s*,\s*:)*\s*\]/.test(elemCstForShape?.text ?? "");
      if (compInst?.name && hasColonSubscript && compInst?.modification?.bindingExpression?.text) {
        const fullName = prefix ? `${prefix}.${compInst.name}` : compInst.name;
        const rawText = compInst.modification.bindingExpression.text.trim();
        if (isArrayLiteral(rawText) && !/\bfor\b/.test(rawText)) {
          const elems = parseArrayLiteralElements(rawText);
          if (elems.length > 0) {
            if (isArrayLiteral(elems[0]?.trim() ?? "")) {
              const inner = parseArrayLiteralElements(elems[0]!.trim());
              setNamedArrayShape(dae, fullName, [elems.length, inner.length]);
            } else {
              setNamedArrayShape(dae, fullName, [elems.length]);
            }
          }
        } else {
          const refMatch = rawText.match(/^[+-]?\s*([a-zA-Z_]\w*)$/);
          if (refMatch) {
            const targetFull = prefix ? `${prefix}.${refMatch[1]!}` : refMatch[1]!;
            const refShape = getNamedArrayShape(dae, targetFull) ?? getNamedArrayShape(dae, refMatch[1]!);
            if (refShape && refShape.length > 0) {
              setNamedArrayShape(dae, fullName, [...refShape]);
            }
          }
        }
      }

      if (compInst?.variability === "constant") {
        const mod = compInst.modification;
        if (mod?.bindingExpression) {
          const targetScopeId =
            (mod.bindingExpression as any)?.evaluationScopeId ?? elemId ?? flattener.currentRootClassId;
          const scopeSym = targetScopeId ? flattener.db.symbol(targetScopeId) : undefined;
          const bindExpr = mod.bindingExpression as any;
          const bindCst = bindExpr?.cstBytes
            ? (flattener.db.cstNodeRange(bindExpr.cstBytes[0], bindExpr.cstBytes[1], scopeSym ?? undefined) as any)
            : null;
          if (bindCst) {
            const lowered = flattener.lowerExpr(bindCst, dae, prefix);
            if (lowered < 0 && dae.diagnostics.some((d) => d.severity === "error")) {
              return;
            }
          }
        }
      }
    }

    if (parentMods?.args) {
      for (const arg of parentMods.args) {
        if (arg?.name) {
          declaredNames.add(arg.name);
          if (prefix && arg.value?.text) {
            const fullName = `${prefix}.${arg.name}`;
            const rawText = arg.value.text.trim();
            if (isArrayLiteral(rawText)) {
              const elems = parseArrayLiteralElements(rawText);
              if (elems.length > 0) {
                if (isArrayLiteral(elems[0]?.trim() ?? "")) {
                  const inner = parseArrayLiteralElements(elems[0]!.trim());
                  setNamedArrayShape(dae, fullName, [elems.length, inner.length]);
                } else {
                  setNamedArrayShape(dae, fullName, [elems.length]);
                }
              }
            } else if (rawText.startsWith("[") && rawText.endsWith("]")) {
              const rows = splitTopLevel(rawText.slice(1, -1), ";");
              if (rows.length > 0) {
                const cols = splitTopLevel(rows[0]!, ",");
                setNamedArrayShape(dae, fullName, [rows.length, cols.length]);
              }
            }
          }
        }
      }
      if (prefix) {
        // General inference for components with `start:size(arr, dim)` default bindings
        // and sibling components dimensioned by `size(...)` or dependent size parameters
        const inferredDimParams = new Map<string, number>();
        for (const elemId of elements) {
          const elemSym = flattener.db.symbol(elemId);
          if (!elemSym || elemSym.kind !== "Component") continue;
          const hasExplicitMod = parentMods.args.some((a: any) => a.name === elemSym.name);
          if (hasExplicitMod) continue;
          const ci = flattener.db.query<any>("componentInstance", elemId);
          const bText = ci?.modification?.value?.text?.trim() ?? "";
          const rangeSizeMatch = bText.match(/^(\d+)\s*:\s*size\(\s*([a-zA-Z_]\w*)\s*,\s*(\d+)\s*\)$/);
          if (rangeSizeMatch) {
            const startIdx = parseInt(rangeSizeMatch[1]!, 10);
            const targetArr = rangeSizeMatch[2]!;
            const dimIdx = parseInt(rangeSizeMatch[3]!, 10) - 1;
            const targetShape = getNamedArrayShape(dae, `${prefix}.${targetArr}`);
            if (targetShape && dimIdx >= 0 && dimIdx < targetShape.length) {
              const len = Math.max(0, targetShape[dimIdx]! - startIdx + 1);
              if (len > 0) {
                setNamedArrayShape(dae, `${prefix}.${elemSym.name}`, [len]);
              }
            }
          }
          const sizeCallMatch = bText.match(/^size\(\s*([a-zA-Z_]\w*)\s*,\s*(\d+)\s*\)$/);
          if (sizeCallMatch) {
            const targetArr = sizeCallMatch[1]!;
            const dimIdx = parseInt(sizeCallMatch[2]!, 10) - 1;
            const targetShape = getNamedArrayShape(dae, `${prefix}.${targetArr}`);
            if (targetShape && dimIdx >= 0 && dimIdx < targetShape.length && targetShape[dimIdx]! > 0) {
              inferredDimParams.set(elemSym.name, targetShape[dimIdx]!);
            }
          }
        }
        if (inferredDimParams.size > 0) {
          for (const elemId of elements) {
            const elemSym = flattener.db.symbol(elemId);
            if (!elemSym || elemSym.kind !== "Component") continue;
            const ci = flattener.db.query<any>("componentInstance", elemId);
            const dims = ci?.arrayDimensions;
            if (Array.isArray(dims) && dims.length === 1) {
              const dText = String(dims[0]?.text ?? dims[0] ?? "").trim();
              const resolvedLen = inferredDimParams.get(dText);
              if (resolvedLen !== undefined && resolvedLen > 0) {
                setNamedArrayShape(dae, `${prefix}.${elemSym.name}`, [resolvedLen]);
              }
            }
          }
        }
      }
    }
    state.flattener = flattener;
    if (!state.scopeDeclaredNames) {
      state.scopeDeclaredNames = new Map<string, Set<string>>();
    }
    state.scopeDeclaredNames.set(prefix, declaredNames);
    const basePrefix = stripArraySubscripts(prefix);
    if (basePrefix !== prefix) {
      state.scopeDeclaredNames.set(basePrefix, declaredNames);
    }

    const syncWasmEnv = Boolean((flattener as any).options?.syncWasmEnv);
    const wasmEnv = syncWasmEnv ? getOrCreateWasmEnv(flattener, dae, parentMods) : null;
    const wasmFlattener = syncWasmEnv
      ? (state.wasmFlattener ?? (dae.exports?.flattener_create ? dae.exports.flattener_create(dae.ptr) : 0))
      : 0;
    if (syncWasmEnv) {
      state.wasmFlattener = wasmFlattener;
    }

    if (wasmFlattener && dae.exports?.flattener_scopePush && wasmEnv) {
      const prefixId = prefix ? dae.interner.intern(prefix) : 0;
      dae.exports.flattener_scopePush(wasmFlattener, 0, wasmEnv.envPtr, prefixId, 0);
    }

    const prevCompClauseRange = state.currentCompClauseRange;
    const prevClassId = flattener.currentClassId;
    if (parentMods?.componentClauseRange) {
      state.currentCompClauseRange = parentMods.componentClauseRange;
    }
    if (parentMods?.currentClassId) {
      flattener.currentClassId = parentMods.currentClassId;
    }

    // ── Outer class modifier verification (Modelica §5.4) ──
    const targetClassForOuter =
      parentMods?.currentClassId ?? (prefix === "" ? (flattener.currentClassId ?? flattener.currentRootClassId) : null);
    if (targetClassForOuter) {
      if (parentMods?.args && parentMods.args.length > 0) {
        if (!validateClassModifiers(flattener, targetClassForOuter, parentMods.args, dae)) {
          return;
        }
      }
      for (const child of flattener.db.childrenOf(targetClassForOuter)) {
        if (child.kind === "Extends") {
          const base = resolveExtendsBase(flattener, child, targetClassForOuter);
          const extMod = flattener.db.query<any>("extendsModificationParsed", child.id);
          if (extMod?.args && extMod.args.length > 0 && base && base.kind === "Class") {
            if (!validateClassModifiers(flattener, base.id, extMod.args, dae)) {
              return;
            }
          }
        }
        if (child.kind === "Class") {
          const childCst = flattener.db.cstNode(child.id) as any;
          const elemParent = childCst?.parent?.type === "element" ? childCst.parent : childCst?.parent?.parent;
          const isOuterClass = elemParent?.children?.some((ch: any) => ch.type === "outer" || ch.text === "outer");
          const isInnerClass = elemParent?.children?.some((ch: any) => ch.type === "inner" || ch.text === "inner");
          if (isOuterClass && !isInnerClass) {
            // 1. Check if outer class itself has a class modification
            let spec = childCst?.children?.find(
              (ch: any) => ch.type === "class_specifier" || ch.type === "short_class_specifier",
            );
            if (spec?.children?.[0]?.type === "short_class_specifier") spec = spec.children[0];
            const modNode = spec?.children?.find(
              (ch: any) => ch.type === "class_modification" || ch.type === "modification",
            );
            if (modNode) {
              dae.diagnostics.push({
                severity: "error",
                code: ModelicaErrorCode.OUTER_MODIFIER.code,
                message: ModelicaErrorCode.OUTER_MODIFIER.message(modNode.text?.trim() ?? "", child.name),
                range: {
                  startByte: spec?.startIndex ?? spec?.startByte ?? modNode.startIndex,
                  endByte: spec?.endIndex ?? spec?.endByte ?? modNode.endIndex,
                  startPosition: spec?.startPosition ?? modNode.startPosition,
                  endPosition: spec?.endPosition ?? modNode.endPosition,
                },
              });
              return;
            }

            // 2. Check if parentMods has a modifier or redeclaration targeting this outer class
            const classModArg = parentMods?.args?.find((a: any) => !a.isBreak && a.name === child.name);
            if (
              classModArg &&
              (classModArg.value != null ||
                (classModArg.nestedArgs && classModArg.nestedArgs.length > 0) ||
                classModArg.modText ||
                classModArg.isRedeclaration)
            ) {
              const modText = classModArg.modText || (classModArg.value?.text ? `=${classModArg.value.text}` : "");
              dae.diagnostics.push({
                severity: "error",
                code: ModelicaErrorCode.OUTER_MODIFIER.code,
                message: ModelicaErrorCode.OUTER_MODIFIER.message(modText, child.name),
                range: {
                  startByte: classModArg.modRange?.[0] ?? classModArg.modPosition?.startPosition,
                  endByte: classModArg.modRange?.[1] ?? classModArg.modPosition?.endPosition,
                  startPosition: classModArg.modPosition?.startPosition,
                  endPosition: classModArg.modPosition?.endPosition,
                },
              });
              return;
            }
          }
        }
      }
    }

    try {
      for (const elemId of elements) {
        if (
          flattener.options.omcCompatibility &&
          dae.diagnostics.some(
            (d) =>
              d.severity === "error" &&
              (d.code === ModelicaErrorCode.FUNCTION_CALL_CONTAINS_SUBSCRIPTS.code ||
                d.code === ModelicaErrorCode.TUPLE_SUBSCRIPT_NOT_ALLOWED.code ||
                d.code === ModelicaErrorCode.INVALID_TYPE_PREFIX_FLOW_NESTED.code),
          )
        ) {
          break;
        }
        const compInst = compInstMap.get(elemId);
        if (!compInst) continue;

        const fullCompName = prefix ? `${prefix}.${compInst.name}` : compInst.name;
        const elemCst = flattener.db.cstNode(elemId) as any;

        if (dae.classKind === "function" && (compInst.isOuter || compInst.isInner)) {
          let clauseNode: any = elemCst;
          while (clauseNode && clauseNode.type !== "component_clause" && clauseNode.parent) {
            clauseNode = clauseNode.parent;
          }
          const elemNode = clauseNode?.parent?.type === "element" ? clauseNode.parent : clauseNode;
          const diagNode = elemNode ?? clauseNode ?? elemCst;
          const diagRange = {
            startByte: diagNode?.startIndex ?? diagNode?.startByte,
            endByte: diagNode?.endIndex ?? diagNode?.endByte,
            startPosition: diagNode?.startPosition,
            endPosition: diagNode?.endPosition,
          };
          const prefixName = compInst.isInner ? "inner" : "outer";
          dae.diagnostics.push({
            severity: "error",
            code: ModelicaErrorCode.FUNCTION_INVALID_PREFIX.code,
            message: ModelicaErrorCode.FUNCTION_INVALID_PREFIX.message(prefixName, compInst.name),
            range: diagRange,
          });
          continue;
        }

        if (
          dae.classKind === "function" &&
          !dae.extensionMetadata?.["isOldFrontend"] &&
          !(flattener as any).options?.isOldFrontend &&
          !compInst.isProtected &&
          compInst.causality !== "input" &&
          compInst.causality !== "output" &&
          compInst.variability !== "constant" &&
          compInst.variability !== "parameter"
        ) {
          let clauseNode: any = elemCst;
          while (clauseNode && clauseNode.type !== "component_clause" && clauseNode.parent) {
            clauseNode = clauseNode.parent;
          }
          const elemNode = clauseNode?.parent?.type === "element" ? clauseNode.parent : clauseNode;
          const diagNode = elemNode ?? clauseNode ?? elemCst;
          const diagRange = {
            startByte: diagNode?.startIndex ?? diagNode?.startByte,
            endByte: diagNode?.endIndex ?? diagNode?.endByte,
            startPosition: diagNode?.startPosition,
            endPosition: diagNode?.endPosition,
          };
          dae.diagnostics.push({
            severity: "error",
            code: ModelicaErrorCode.FUNCTION_PUBLIC_VARIABLE.code,
            message: ModelicaErrorCode.FUNCTION_PUBLIC_VARIABLE.message(compInst.name),
            range: diagRange,
          });
          continue;
        }

        const matchingParentArg = parentMods?.args
          ?.slice()
          .reverse()
          .find((a: any) => !a.isBreak && a.name === compInst.name);

        if (
          validateComponentBasicAttributes(
            flattener,
            dae,
            compInst,
            elemId,
            elemCst,
            prefix,
            parentMods,
            matchingParentArg,
          )
        ) {
          continue;
        }

        // Duplicate redeclaration check (DuplicateRedeclares1)
        let isLocalRedecl = Boolean(compInst.isRedeclare);
        let pNode: any = elemCst;
        while (pNode && pNode.type !== "class_definition" && !isLocalRedecl) {
          if (pNode.type === "element_redeclaration" || pNode.type === "ElementRedeclaration") isLocalRedecl = true;
          if (pNode.children?.some((c: any) => c.type === "redeclare" || c.text === "redeclare")) isLocalRedecl = true;
          pNode = pNode.parent;
        }
        if (isLocalRedecl) {
          const matchingRedecl = parentMods?.args?.find(
            (a: any) => !a.isBreak && a.name === compInst.name && a.isRedeclaration,
          );
          if (matchingRedecl) {
            let declNode: any = elemCst;
            let p = elemCst?.parent;
            while (p && p.type !== "class_definition" && p.type !== "element_list") {
              declNode = p;
              if (p.type === "element_redeclaration" || p.type === "element") break;
              p = p.parent;
            }
            const localRange = getElementDiagRange(declNode ?? elemCst);
            dae.diagnostics.push({
              severity: "notification",
              code: ModelicaErrorCode.NOTIFICATION_FROM_HERE.code,
              message: "From here:",
              range: {
                startByte: matchingRedecl.modRange?.[0] ?? matchingRedecl.modPosition?.startPosition,
                endByte: matchingRedecl.modRange?.[1] ?? matchingRedecl.modPosition?.endPosition,
                startPosition: matchingRedecl.modPosition?.startPosition,
                endPosition: matchingRedecl.modPosition?.endPosition,
              },
            });
            dae.diagnostics.push({
              severity: "error",
              code: ModelicaErrorCode.DUPLICATE_REDECLARE.code,
              message: ModelicaErrorCode.DUPLICATE_REDECLARE.message(compInst.name),
              range: localRange,
            });
            return;
          }
        }

        // ============================================================================
        // Phase 2: `inner`/`outer` Binding & Conditional (`if <cond>`) Pruning
        // ============================================================================
        const isStateOutput = Boolean(compInst.isOuter && compInst.causality === "output");
        if (compInst.isOuter && !compInst.isInner) {
          // Check if component has modification in its own declaration (InnerOuterInvalidMod1)
          if (
            !flattener.isOldFrontend &&
            !dae.extensionMetadata?.["isOldFrontend"] &&
            (compInst.modification?.bindingExpression ||
              (compInst.modification?.args && compInst.modification.args.length > 0))
          ) {
            let declNode: any = elemCst;
            let p = elemCst?.parent;
            while (p && (p.type === "component_declaration" || p.type === "component_clause" || p.type === "element")) {
              declNode = p;
              p = p.parent;
            }
            const elemText = elemCst?.text ?? "";
            const modText = elemText.startsWith(compInst.name)
              ? elemText.slice(compInst.name.length)
              : compInst.modification.bindingExpression?.text
                ? ` = ${compInst.modification.bindingExpression.text}`
                : "";
            dae.diagnostics.push({
              severity: "error",
              code: ModelicaErrorCode.OUTER_MODIFIER.code,
              message: ModelicaErrorCode.OUTER_MODIFIER.message(modText, compInst.name),
              range: {
                startByte: declNode?.startIndex ?? declNode?.startByte,
                endByte: declNode?.endIndex ?? declNode?.endByte,
                startPosition: declNode?.startPosition,
                endPosition: declNode?.endPosition,
              },
            });
            return;
          }

          // Check if parentMods targets this outer component (InnerOuterInvalidMod2 & InnerOuterInvalidMod3)
          const matchingOuterArg = parentMods?.args?.find((a: any) => !a.isBreak && a.name === compInst.name);
          if (
            !flattener.isOldFrontend &&
            !dae.extensionMetadata?.["isOldFrontend"] &&
            matchingOuterArg &&
            (matchingOuterArg.value != null ||
              (matchingOuterArg.nestedArgs && matchingOuterArg.nestedArgs.length > 0) ||
              matchingOuterArg.modText ||
              matchingOuterArg.isRedeclaration)
          ) {
            const modText =
              matchingOuterArg.modText || (matchingOuterArg.value?.text ? `=${matchingOuterArg.value.text}` : "");
            dae.diagnostics.push({
              severity: "error",
              code: ModelicaErrorCode.OUTER_MODIFIER.code,
              message: ModelicaErrorCode.OUTER_MODIFIER.message(modText, compInst.name),
              range: {
                startByte: matchingOuterArg.modRange?.[0] ?? matchingOuterArg.modPosition?.startPosition,
                endByte: matchingOuterArg.modRange?.[1] ?? matchingOuterArg.modPosition?.endPosition,
                startPosition: matchingOuterArg.modPosition?.startPosition,
                endPosition: matchingOuterArg.modPosition?.endPosition,
              },
            });
            return;
          }

          // Walk upward along the instance prefix chain (`a.b.c` -> `a.b` -> `a` -> `""`)
          // to bind this `outer` reference to the nearest enclosing `inner` declaration.
          let p: string | null = prefix;
          let foundInner = false;
          while (p !== null) {
            const innerMap = flattener.innerDeclarations.get(p);
            if (innerMap && innerMap.has(compInst.name)) {
              foundInner = true;
              const targetInner = innerMap.get(compInst.name)!;
              (state.outerToInner ??= new Map<string, string>()).set(fullCompName, targetInner);
              break;
            }
            p = p.includes(".") ? p.split(".").slice(0, -1).join(".") : p === "" ? null : "";
          }

          if (!foundInner) {
            if (prefix === "") {
              let declNode: any = elemCst;
              let pNode = elemCst?.parent;
              while (
                pNode &&
                (pNode.type === "component_declaration" ||
                  pNode.type === "component_clause" ||
                  pNode.type === "element")
              ) {
                declNode = pNode;
                pNode = pNode.parent;
              }
              dae.diagnostics.push({
                severity: "error",
                code: ModelicaErrorCode.TOP_LEVEL_OUTER_ELEMENT.code,
                message: ModelicaErrorCode.TOP_LEVEL_OUTER_ELEMENT.message(compInst.name),
                range: {
                  startByte: declNode?.startIndex ?? declNode?.startByte,
                  endByte: declNode?.endIndex ?? declNode?.endByte,
                  startPosition: declNode?.startPosition,
                  endPosition: declNode?.endPosition,
                },
              });
              return;
            } else {
              // Check if an existing declaration with the same name exists in the root class
              const rootChildren = flattener.currentRootClassId
                ? flattener.db.childrenOf(flattener.currentRootClassId)
                : [];
              const existingDecl = rootChildren.find((c: any) => c.kind === "Component" && c.name === compInst.name);
              if (existingDecl) {
                const existingCst = flattener.db.cstNode(existingDecl.id) as any;
                let existingElem = existingCst?.parent;
                while (existingElem && existingElem.type !== "element" && existingElem.parent) {
                  existingElem = existingElem.parent;
                }
                const isExistingInner = existingElem?.children?.some(
                  (ch: any) => ch.type === "inner" || ch.text === "inner",
                );
                if (!isExistingInner) {
                  let declNode: any = elemCst;
                  let pNode = elemCst?.parent;
                  while (
                    pNode &&
                    (pNode.type === "component_declaration" ||
                      pNode.type === "component_clause" ||
                      pNode.type === "element")
                  ) {
                    declNode = pNode;
                    pNode = pNode.parent;
                  }
                  const notifRange = state.currentCompClauseRange ?? parentMods?.componentClauseRange;
                  if (notifRange) {
                    dae.diagnostics.push({
                      severity: "notification",
                      code: ModelicaErrorCode.NOTIFICATION_FROM_HERE.code,
                      message: "From here:",
                      range: notifRange,
                    });
                  }
                  dae.diagnostics.push({
                    severity: "error",
                    code: ModelicaErrorCode.INNER_NOT_FOUND_EXISTING_DECL.code,
                    message: ModelicaErrorCode.INNER_NOT_FOUND_EXISTING_DECL.message(compInst.name),
                    range: {
                      startByte: declNode?.startIndex ?? declNode?.startByte,
                      endByte: declNode?.endIndex ?? declNode?.endByte,
                      startPosition: declNode?.startPosition,
                      endPosition: declNode?.endPosition,
                    },
                  });
                  return;
                }
              }
            }
          }

          if (!isStateOutput) {
            continue;
          }
        }
        if (isStateOutput) {
          (state.stateOutputVars ??= new Set<string>()).add(fullCompName);
        }
        if (compInst.isOuter && compInst.isInner) {
          flattener.innerOuterComponents.add(fullCompName);
        }

        const cyclicDiags = cyclicDimensionDiagnostics.get(elemId);
        if (cyclicDiags && cyclicDiags.length > 0) {
          const d = cyclicDiags[0]!;
          let clauseNode: any = elemCst;
          while (clauseNode && clauseNode.type !== "component_clause" && clauseNode.parent) {
            clauseNode = clauseNode.parent;
          }
          const rangeNode = clauseNode ?? elemCst;
          dae.diagnostics.push({
            severity: "error",
            code: ModelicaErrorCode.CYCLIC_DIMENSION_DEPENDENCY.code,
            message: ModelicaErrorCode.CYCLIC_DIMENSION_DEPENDENCY.message(
              String(d.dimIndex + 1),
              compInst.name,
              d.exprText,
            ),
            range: rangeNode
              ? {
                  startByte: rangeNode.startIndex ?? rangeNode.startByte,
                  endByte: rangeNode.endIndex ?? rangeNode.endByte,
                  startPosition: rangeNode.startPosition,
                  endPosition: rangeNode.endPosition,
                }
              : undefined,
          });
          return;
        }

        // Check conditional component attribute ('if <cond>')
        let conditionAttrNode: any = null;
        if (elemCst) {
          const findCondAttr = (n: any): any => {
            if (!n) return null;
            if (n.type === "condition_attribute") return n;
            for (const c of n.children || []) {
              const res = findCondAttr(c);
              if (res) return res;
            }
            return null;
          };
          conditionAttrNode = findCondAttr(elemCst);
        }
        if (conditionAttrNode) {
          const condExpr = conditionAttrNode.children?.find((c: any) => c.type === "expression");
          if (condExpr) {
            const condText = condExpr.text?.trim() ?? "";
            const condMatches = condText.match(/[a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)*/g) || [];
            const depNames = condMatches.filter(
              (m: string) => m !== "true" && m !== "false" && m !== "not" && m !== "and" && m !== "or",
            );
            if (depNames.length > 0) {
              const resolvedDeps = depNames.map((d: string) => (prefix && !d.includes(".") ? `${prefix}.${d}` : d));
              flattener.varConditionDeps.set(fullCompName, resolvedDeps);
              if (prefix) {
                flattener.varConditionDeps.set(compInst.name, resolvedDeps);
              }
            }
            let condVal: boolean | null = null;
            if (condText === "true") condVal = true;
            else if (condText === "false") condVal = false;
            const isNeg = condText.startsWith("not ");
            const varName = isNeg ? condText.substring(4).trim() : condText;
            const arg = parentMods?.args?.find((a: any) => a.name === varName);
            if (arg?.value) {
              if (arg.value.kind === "literal" && typeof arg.value.value === "boolean") {
                condVal = isNeg ? !arg.value.value : arg.value.value;
              } else if (arg.value.kind === "expression" && (arg.value.text === "true" || arg.value.text === "false")) {
                const b = arg.value.text === "true";
                condVal = isNeg ? !b : b;
              }
            }
            if (condVal === null) {
              const vIdx = dae.getVarIdxByName(prefix ? `${prefix}.${varName}` : varName);
              if (vIdx >= 0) {
                const exprId = dae.getVarExpression(vIdx);
                if (exprId !== undefined && exprId >= 0) {
                  if (dae.getExprKind(exprId) === ExprKind.BoolLiteral) {
                    const b = dae.getExprData1(exprId) !== 0;
                    condVal = isNeg ? !b : b;
                  } else {
                    const evaluated = evalDaeExpr(exprId, dae);
                    if (typeof evaluated === "boolean") {
                      condVal = isNeg ? !evaluated : evaluated;
                    } else if (typeof evaluated === "number") {
                      condVal = isNeg ? evaluated === 0 : evaluated !== 0;
                    }
                  }
                }
              }
            }
            if (condText.startsWith('"') && condText.endsWith('"')) {
              const diagRange = getElementDiagRange(elemCst);
              dae.diagnostics.push({
                severity: "error",
                code: ModelicaErrorCode.FUNCTION_ARG_TYPE_MISMATCH.code,
                message: `Type error in conditional '${condText}'. Expected Boolean, got String.`,
                range: diagRange,
              });
              return;
            }
            if (condVal === null) {
              const savedDiagLen = dae.diagnostics.length;
              try {
                let condSubs: Map<string, number | string> | undefined;
                if (parentMods?.args) {
                  for (const a of parentMods.args) {
                    if (a.name && a.value) {
                      if (
                        a.value.kind === "literal" &&
                        (typeof a.value.value === "number" || typeof a.value.value === "boolean")
                      ) {
                        condSubs ??= new Map();
                        condSubs.set(
                          a.name,
                          typeof a.value.value === "boolean" ? (a.value.value ? "true" : "false") : a.value.value,
                        );
                      } else if (a.value.kind === "expression" && a.value.text) {
                        const t = a.value.text.trim();
                        if (t === "true" || t === "false" || /^-?\d+(?:\.\d+)?$/.test(t)) {
                          condSubs ??= new Map();
                          condSubs.set(a.name, t);
                        }
                      }
                    }
                  }
                }
                const loweredCondId = flattener.lowerExpr(condExpr, dae, prefix, condSubs);
                if (loweredCondId >= 0 && dae.diagnostics.length === savedDiagLen) {
                  const evaluated = evalDaeExpr(loweredCondId, dae);
                  if (typeof evaluated === "boolean") {
                    condVal = evaluated;
                  }
                }
                if (condVal === null) {
                  const siblingId = elements.find((eid) => flattener.db.symbol(eid)?.name === varName);
                  if (siblingId !== undefined) {
                    const sibCst = flattener.db.cstNode(siblingId) as any;
                    const findExprInMod = (n: any): any => {
                      if (!n || n.type === "class_modification" || n.type === "ClassModification") return null;
                      if (n.type === "expression" || n.type === "Expression") return n;
                      for (const c of n.children || []) {
                        const r = findExprInMod(c);
                        if (r) return r;
                      }
                      return null;
                    };
                    const findModExpr = (n: any): any => {
                      if (!n) return null;
                      if (n.type === "modification" || n.type === "Modification") {
                        return findExprInMod(n);
                      }
                      for (const c of n.children || []) {
                        const r = findModExpr(c);
                        if (r) return r;
                      }
                      return null;
                    };
                    const sibBindExpr = findModExpr(sibCst);
                    if (sibBindExpr) {
                      dae.diagnostics.length = savedDiagLen;
                      const loweredSibId = flattener.lowerExpr(sibBindExpr, dae, prefix, condSubs);
                      if (loweredSibId >= 0 && dae.diagnostics.length === savedDiagLen) {
                        const evaluated = evalDaeExpr(loweredSibId, dae);
                        if (typeof evaluated === "boolean") {
                          condVal = isNeg ? !evaluated : evaluated;
                        }
                      }
                    }
                  }
                }
              } catch {}
              if (condVal === null) {
                dae.diagnostics.length = savedDiagLen;
              }
            }
            if (condVal === null) {
              if ((dae.extensionMetadata as any)?.hasOldInstOption && flattener.currentRootClassId) {
                const rootSym = flattener.db.symbol(flattener.currentRootClassId);
                const rootName = rootSym?.name ?? "";
                const otherElem = flattener.db
                  .childrenOf(flattener.currentRootClassId)
                  ?.find((c) => c.name === condText && c.kind === "Component");
                if (otherElem) {
                  const otherCst = flattener.db.cstNode(otherElem.id) as any;
                  const otherText = otherCst?.text ?? "";
                  if (otherText.includes(`if ${compInst.name}`) || otherText.includes(`if (${compInst.name})`)) {
                    dae.diagnostics.push({
                      severity: "error",
                      code: ModelicaErrorCode.CYCLIC_CONSTANTS_OR_PARAMETERS.code,
                      message: ModelicaErrorCode.CYCLIC_CONSTANTS_OR_PARAMETERS.message(
                        rootName,
                        `${condText},${compInst.name}`,
                      ),
                      range: null,
                    });
                    return;
                  }
                }
              }
              const diagRange = getElementDiagRange(elemCst);
              dae.diagnostics.push({
                severity: "error",
                code: ModelicaErrorCode.DIMENSION_NOT_PARAMETER.code,
                message: `The conditional expression ${condText} could not be evaluated.`,
                range: diagRange,
              });
              return;
            }
            if (condVal === false) {
              flattener.disabledComponents.add(fullCompName);
              continue;
            }
          }
        }

        // ============================================================================
        // Phase 3: Fast-Path Scalar Instantiation (Primitive Un-Modified Scalars)
        // ============================================================================
        // FAST-PATH: Primitive scalar declarations without complex hierarchy or condition attributes
        const isPrimType =
          compInst.typeSpecifier === "Real" ||
          compInst.typeSpecifier === "Integer" ||
          compInst.typeSpecifier === "Boolean" ||
          compInst.typeSpecifier === "String";

        const hasArray = Boolean(compInst.arrayDimensions && compInst.arrayDimensions.length > 0);
        const hasParentMods = Boolean(
          parentMods && ((parentMods.args && parentMods.args.length > 0) || parentMods.bindingExpression),
        );

        if (
          isPrimType &&
          !hasArray &&
          !hasParentMods &&
          !compInst.isInner &&
          (!compInst.isOuter || isStateOutput) &&
          !compInst.isRedeclare &&
          !compInst.isReplaceable &&
          !compInst.isProtected &&
          !flattener["isCstNodeProtected"](elemCst) &&
          !parentMods?.isProtected &&
          !parentMods?.protectedNames?.has(compInst.name)
        ) {
          const bText = compInst.modification?.bindingExpression?.text?.trim();
          const hasComplexBinding =
            bText &&
            (bText.includes("(") ||
              bText.includes("[") ||
              bText.includes("{") ||
              bText.includes("+") ||
              bText.includes("-") ||
              bText.includes("*") ||
              bText.includes("/") ||
              isNaN(Number(bText)));

          if (!hasComplexBinding) {
            const name = prefix ? `${prefix}.${compInst.name}` : compInst.name;
            let varType = VarType.Real;
            if (compInst.typeSpecifier === "Integer") varType = VarType.Integer;
            else if (compInst.typeSpecifier === "Boolean") varType = VarType.Boolean;
            else if (compInst.typeSpecifier === "String") varType = VarType.String;
            else if (compInst.typeSpecifier === "Clock") varType = VarType.Clock;

            let variability = Variability.Continuous;
            if (parentMods?.parentVariability === Variability.Constant) {
              variability = Variability.Constant;
            } else if (compInst.variability === "parameter") variability = Variability.Parameter;
            else if (compInst.variability === "constant") variability = Variability.Constant;
            else if (compInst.variability === "discrete") variability = Variability.Discrete;
            else if (parentMods?.parentVariability !== undefined) variability = parentMods.parentVariability;

            const isDiscreteTypeOrVar =
              variability === Variability.Discrete ||
              compInst.typeSpecifier === "Boolean" ||
              compInst.typeSpecifier === "Integer" ||
              compInst.typeSpecifier === "String";
            if (isDiscreteTypeOrVar && bText) {
              if (bText.startsWith("noEvent(") && bText.endsWith(")")) {
                const inner = bText.slice(8, -1);
                const m = inner.match(/[a-zA-Z_]\w*/g) || [];
                const hasContinuous = m.some((vName) => {
                  if (vName === "time") return true;
                  const vi = dae.getVarIdxByName(prefix ? `${prefix}.${vName}` : vName);
                  return vi >= 0 && dae.getVarVariability(vi) === Variability.Continuous;
                });
                if (hasContinuous) {
                  let clauseNode: any = elemCst;
                  while (clauseNode && clauseNode.type !== "component_clause") {
                    clauseNode = clauseNode.parent;
                  }
                  const diagRange = getElementDiagRange(clauseNode ?? elemCst);
                  dae.diagnostics.push({
                    severity: "error",
                    code: ModelicaErrorCode.VARIABILITY_BINDING_MISMATCH.code,
                    message: `Component ${compInst.name} of variability discrete has binding '${bText}' of higher variability continuous.`,
                    range: diagRange,
                  });
                  return;
                }
              }
            }

            if (variability === Variability.Parameter && bText) {
              const bTrim = bText.trim();
              if (bTrim === "initial()" || bTrim === "terminal()") {
                let clauseNode: any = elemCst;
                while (clauseNode && clauseNode.type !== "component_clause") {
                  clauseNode = clauseNode.parent;
                }
                const diagRange = getElementDiagRange(clauseNode ?? elemCst);
                dae.diagnostics.push({
                  severity: "error",
                  code: ModelicaErrorCode.VARIABILITY_BINDING_MISMATCH.code,
                  message: `Component ${compInst.name} of variability parameter has binding '${bTrim}' of higher variability discrete.`,
                  range: diagRange,
                });
                return;
              }
            }

            const elemParentId = flattener.db.symbol(elemId)?.parentId;
            const elemParentSym = elemParentId != null ? flattener.db.symbol(elemParentId) : null;
            const isElemParentPackage =
              elemParentSym?.kind === "Package" ||
              String(
                (elemParentSym?.metadata as any)?.classKind ?? (elemParentSym?.metadata as any)?.classPrefixes ?? "",
              ).includes("package");
            if (
              variability === Variability.Constant &&
              prefix &&
              !parentMods?.isRecord &&
              parentMods?.parentVariability !== Variability.Constant &&
              flattener.currentClassId &&
              elemParentId !== flattener.currentClassId &&
              (isElemParentPackage || Boolean(dae.extensionMetadata?.["isOldFrontend"]))
            ) {
              continue;
            }
            // Allow constants inside components to be instantiated in DAE
            if (
              variability === Variability.Constant &&
              (prefix || elemParentId !== flattener.currentRootClassId) &&
              bText &&
              /^[a-zA-Z_]\w*$/.test(bText)
            ) {
              const targetConst = resolveScopedName(bText, prefix, dae);
              const targetIdx =
                dae.getVarIdxByName(targetConst) >= 0
                  ? dae.getVarIdxByName(targetConst)
                  : dae.getVarIdxByName(`${targetConst}[1]`) >= 0
                    ? dae.getVarIdxByName(`${targetConst}[1]`)
                    : dae.getVarIdxByName(`${targetConst}[1,1]`);
              if (targetIdx >= 0 && dae.getVarVariability(targetIdx) === Variability.Constant) {
                (state.constantAliases ??= new Map<string, string>()).set(name, targetConst);
                continue;
              }
            }

            // Structural parameter evaluation (`annotation(Evaluate = true)`):
            // In non-OMC compatibility mode, promote `Evaluate = true` parameters to `Constant`
            // so downstream constant folding and alias elimination inline their values.
            const isEvaluated = flattener.db.query<boolean>("isEvaluate", elemId);
            if (!flattener.options.omcCompatibility && isEvaluated && variability === Variability.Parameter) {
              variability = Variability.Constant;
            }

            if (
              compInst.causality &&
              parentMods?.parentCausality !== undefined &&
              parentMods.parentCausality !== Causality.Local
            ) {
              const parentCausalityStr =
                parentMods.parentCausality === Causality.Input
                  ? "input"
                  : parentMods.parentCausality === Causality.Output
                    ? "output"
                    : "local";
              if (parentCausalityStr !== "local") {
                const diagRange = getElementDiagRange(elemCst);
                dae.diagnostics.push({
                  severity: "error",
                  code: ModelicaErrorCode.INVALID_TYPE_PREFIX_CONFLICT.code,
                  message: ModelicaErrorCode.INVALID_TYPE_PREFIX_CONFLICT.message(
                    compInst.causality,
                    compInst.name,
                    parentCausalityStr,
                  ),
                  range: diagRange,
                });
                return;
              }
            }

            let causality = Causality.Local;
            if (compInst.causality === "input") causality = Causality.Input;
            else if (compInst.causality === "output") causality = Causality.Output;
            else if (parentMods?.parentCausality !== undefined) causality = parentMods.parentCausality;
            if (causality === Causality.Output) {
              if (!dae.extensionMetadata) (dae as any).extensionMetadata = {};
              if (!dae.extensionMetadata.outputVars) dae.extensionMetadata.outputVars = new Set<string>();
              (dae.extensionMetadata.outputVars as Set<string>).add(name);
            }

            const isTopLevelConnector = Boolean(parentMods?.isConnector && !parentMods?.hasNonConnectorParent);
            const isTopLevelRecordWithCausality = Boolean(
              parentMods?.isRecord &&
              !parentMods?.hasNonConnectorParent &&
              parentMods?.parentCausality !== undefined &&
              parentMods.parentCausality !== Causality.Local,
            );
            const shouldKeepCausality =
              isTopLevelConnector || isTopLevelRecordWithCausality || flattener.useLocalDirection;
            const _isEnclosingFunction =
              dae.classKind === "function" ||
              Boolean(
                flattener.currentClassId &&
                (flattener.db.symbol(flattener.currentClassId)?.metadata as any)?.classKind === "function",
              );
            if (prefix && !isStateOutput && !shouldKeepCausality) {
              causality = Causality.Local;
            }

            const hasEqInClass = (): boolean => {
              if (!flattener.currentClassId) return false;
              const cst = flattener.db.cstNode(flattener.currentClassId) as any;
              if (!cst) return false;
              const cstText = (cst.text as string) ?? "";
              const eqIdx = cstText.indexOf("equation");
              if (eqIdx < 0) return false;
              const eqSection = cstText.slice(eqIdx);
              const regex = new RegExp(`\\b${compInst.name}\\b\\s*=`);
              return regex.test(eqSection);
            };

            if (
              !dae.extensionMetadata?.["isOldFrontend"] &&
              !hasEqInClass() &&
              variability === Variability.Constant &&
              !bText &&
              !parentMods?.bindingExpression &&
              !_isEnclosingFunction &&
              causality === Causality.Local
            ) {
              if (!dae.diagnostics.some((d) => d.code === ModelicaErrorCode.CONSTANT_HAS_NO_VALUE.code)) {
                let clauseNode: any = elemCst;
                while (clauseNode && clauseNode.type !== "component_clause") {
                  clauseNode = clauseNode.parent;
                }
                const rangeNode = clauseNode ?? elemCst;
                const rangeObj = rangeNode
                  ? {
                      startByte: rangeNode.startIndex ?? rangeNode.startByte,
                      endByte: rangeNode.endIndex ?? rangeNode.endByte,
                      startPosition: rangeNode.startPosition,
                      endPosition: rangeNode.endPosition,
                    }
                  : undefined;
                dae.diagnostics.push({
                  severity: "error",
                  code: ModelicaErrorCode.CONSTANT_HAS_NO_VALUE.code,
                  message: ModelicaErrorCode.CONSTANT_HAS_NO_VALUE.message(name),
                  range: rangeObj,
                });
              }
              return;
            }

            const varIdx = dae.addVariable(dae.interner.intern(name), varType, variability, causality, 0.0);
            if (parentMods?.outerArrayDims && parentMods.outerArrayDims.length > 0) {
              dae.setVarShape(varIdx, parentMods.outerArrayDims);
              dae.setVarShapeExprs(
                varIdx,
                parentMods.outerArrayDims.map((od: number) => dae.addIntLiteral(od)),
              );
            }
            validateFunctionComponentDeclaration(flattener, dae, compInst, causality, false, elemCst);
            if (isComponentHidden(flattener, elemId)) {
              dae.hiddenVarIndices.add(varIdx);
            }

            const sym = flattener.db.symbol(elemId);
            let clauseNode: any = elemCst;
            while (clauseNode && clauseNode.type !== "component_clause" && clauseNode.parent) {
              clauseNode = clauseNode.parent;
            }
            const targetRangeNode = clauseNode ?? elemCst;
            const sb = targetRangeNode?.startIndex ?? targetRangeNode?.startByte ?? sym?.startByte;
            const eb = targetRangeNode?.endIndex ?? targetRangeNode?.endByte ?? sym?.endByte;
            if (sb != null && eb != null) {
              dae.setVarSourceRange(varIdx, sb, eb);
            }
            if (
              compInst.flowPrefix === "flow" ||
              (sym?.metadata as any)?.flowPrefix === "flow" ||
              parentMods?.parentFlowPrefix === "flow"
            ) {
              dae.setVarFlow(varIdx, true);
            }
            if (
              compInst.flowPrefix === "stream" ||
              (sym?.metadata as any)?.flowPrefix === "stream" ||
              parentMods?.parentFlowPrefix === "stream"
            ) {
              dae.setVarStream(varIdx, true);
            }
            if (compInst.isFinal) dae.setVarFinal(varIdx, true);

            const descText = extractDescription(flattener.db.cstNode(elemId));
            if (descText) {
              dae.setVarDescription(varIdx, descText);
            }

            if (bText) {
              const num = Number(bText);
              const exprId = varType === VarType.Integer ? dae.addIntLiteral(Math.round(num)) : dae.addRealLiteral(num);
              dae.setVarExpression(varIdx, exprId);
            }

            if (compInst.modification?.args) {
              for (const arg of compInst.modification.args) {
                if (
                  arg.name === "quantity" ||
                  arg.name === "unit" ||
                  arg.name === "displayUnit" ||
                  arg.name === "start" ||
                  arg.name === "min" ||
                  arg.name === "max" ||
                  arg.name === "nominal" ||
                  arg.name === "stateSelect" ||
                  arg.name === "fixed"
                ) {
                  if ((arg as any).isBreak || arg.value?.kind === "break" || arg.value?.text?.trim() === "break") {
                    dae.removeVarAttr(varIdx, arg.name);
                    continue;
                  }
                  let attrExprId: number | null = null;
                  if (arg.name === "stateSelect") {
                    const ssLiterals = ["never", "avoid", "default", "prefer", "always"];
                    let litName: string | null = null;
                    const rawText = arg.value?.kind === "expression" && arg.value.text ? arg.value.text.trim() : "";
                    if (rawText.startsWith("StateSelect.")) {
                      litName = rawText.slice("StateSelect.".length);
                    } else if (ssLiterals.includes(rawText)) {
                      litName = rawText;
                    } else {
                      try {
                        const scopeId = parentMods?.packageScopeId ?? flattener.db.symbol(elemId)?.parentId;
                        const evalVal = rawText ? flattener.db.evaluate(rawText, scopeId ?? undefined) : null;
                        if (typeof evalVal === "number" && evalVal >= 1 && evalVal <= 5) {
                          litName = ssLiterals[Math.round(evalVal) - 1]!;
                        }
                      } catch {}
                    }
                    if (litName) {
                      const idx = ssLiterals.indexOf(litName);
                      attrExprId = dae.addEnumLiteral(idx >= 0 ? idx + 1 : 1, `StateSelect.${litName}`);
                    } else if (rawText.includes("[")) {
                      let attrCst = (arg.value as any)?.cstBytes
                        ? flattener.db.cstNodeRange((arg.value as any).cstBytes[0], (arg.value as any).cstBytes[1], sym)
                        : null;
                      if (!attrCst && elemCst) {
                        const findCref = (n: any): any => {
                          if (!n) return null;
                          if (
                            (n.type === "component_reference" || n.type === "expression") &&
                            n.text?.trim() === rawText
                          ) {
                            return n;
                          }
                          for (const c of n.children || []) {
                            const f = findCref(c);
                            if (f) return f;
                          }
                          return null;
                        };
                        attrCst = findCref(elemCst);
                      }
                      if (attrCst) {
                        attrExprId = flattener.lowerExpr(attrCst as any, dae, prefix);
                      }
                    }
                  } else if (arg.value?.kind === "literal" && typeof arg.value.value === "number") {
                    attrExprId =
                      varType === VarType.Integer
                        ? dae.addIntLiteral(arg.value.value)
                        : dae.addRealLiteral(arg.value.value);
                  } else if (arg.value?.kind === "literal" && typeof arg.value.value === "boolean") {
                    attrExprId = dae.addExpression(ExprKind.BoolLiteral, arg.value.value ? 1 : 0);
                  } else if (arg.value?.kind === "literal" && typeof arg.value.value === "string") {
                    attrExprId = dae.addExpression(ExprKind.StringLiteral, dae.interner.intern(arg.value.value));
                  } else if (arg.value?.kind === "expression" && arg.value.text) {
                    const rawText = arg.value.text.trim();
                    const num = Number(rawText);
                    if (!isNaN(num)) {
                      attrExprId =
                        varType === VarType.Integer ? dae.addIntLiteral(Math.round(num)) : dae.addRealLiteral(num);
                    } else if (rawText === "true" || rawText === "false") {
                      attrExprId = dae.addExpression(ExprKind.BoolLiteral, rawText === "true" ? 1 : 0);
                    } else if (rawText.startsWith('"') && rawText.endsWith('"')) {
                      try {
                        attrExprId = dae.addExpression(
                          ExprKind.StringLiteral,
                          dae.interner.intern(JSON.parse(rawText)),
                        );
                      } catch {
                        attrExprId = dae.addExpression(
                          ExprKind.StringLiteral,
                          dae.interner.intern(rawText.slice(1, -1)),
                        );
                      }
                    } else {
                      let resolvedT = /^[a-zA-Z_]\w*(\.[a-zA-Z_]\w*)*$/.test(rawText)
                        ? resolveScopedName(rawText, prefix, dae)
                        : rawText;
                      let isDaeVar =
                        arg.name === "start" &&
                        (dae.getVarIdxByName(resolvedT) >= 0 || dae.getVarIdxByName(`${resolvedT}[1]`) >= 0);
                      if (!isDaeVar && arg.name === "start" && prefix && /^[a-zA-Z_]\w*$/.test(rawText)) {
                        const siblingComp =
                          (elemParentId
                            ? flattener.db
                                .childrenOf(elemParentId)
                                ?.some((c: any) => c.kind === "Component" && c.name === rawText)
                            : false) ||
                          (flattener.currentClassId
                            ? flattener.db
                                .childrenOf(flattener.currentClassId)
                                ?.some((c: any) => c.kind === "Component" && c.name === rawText)
                            : false);
                        if (siblingComp) {
                          resolvedT = `${prefix}.${rawText}`;
                          isDaeVar = true;
                        }
                      }
                      if (
                        isDaeVar &&
                        !rawText.includes("(") &&
                        !rawText.includes("+") &&
                        !rawText.includes("-") &&
                        !rawText.includes("*") &&
                        !rawText.includes("/")
                      ) {
                        attrExprId = dae.addExpression(ExprKind.Name, dae.interner.intern(resolvedT));
                      } else {
                        const subParts =
                          dae.extensionMetadata?.["isOldFrontend"] && arg.name === "start"
                            ? rawText.match(/^([a-zA-Z_][a-zA-Z0-9_.]*)\s*-\s*([a-zA-Z_][a-zA-Z0-9_.]*)$/)
                            : null;
                        if (subParts && subParts[1] && subParts[2]) {
                          const p1 = resolveScopedName(subParts[1], prefix, dae, state.innerOuterComponents);
                          const p2 = resolveScopedName(subParts[2], prefix, dae, state.innerOuterComponents);
                          attrExprId = dae.addBinaryExpr(
                            BinOp.Sub,
                            dae.addExpression(ExprKind.Name, dae.interner.intern(p1)),
                            dae.addExpression(ExprKind.Name, dae.interner.intern(p2)),
                          );
                        }
                        if (attrExprId === null) {
                          try {
                            const scopeId = parentMods?.packageScopeId ?? flattener.db.symbol(elemId)?.parentId;
                            const evalVal = flattener.db.evaluate(rawText, scopeId ?? undefined);
                            if (typeof evalVal === "number") {
                              attrExprId =
                                varType === VarType.Integer
                                  ? dae.addIntLiteral(Math.trunc(evalVal))
                                  : dae.addRealLiteral(evalVal);
                            } else if (typeof evalVal === "string") {
                              attrExprId = dae.addExpression(ExprKind.StringLiteral, dae.interner.intern(evalVal));
                            }
                            if (evalVal !== null && flattener.options.omcCompatibility) {
                              const idMatches = rawText.match(/\b[a-zA-Z_][a-zA-Z0-9_]*\b/g);
                              if (idMatches) {
                                for (const id of idMatches) {
                                  if (id === "if" || id === "then" || id === "else" || id === "true" || id === "false")
                                    continue;
                                  let p: string | undefined = prefix;
                                  while (p) {
                                    const cand = `${p}.${id}`;
                                    const idx = dae.getVarIdxByName(cand);
                                    if (idx >= 0 && dae.getVarVariability(idx) === Variability.Parameter) {
                                      dae.setVarFinal(idx, true);
                                      break;
                                    }
                                    const dot = p.lastIndexOf(".");
                                    p = dot !== -1 ? p.substring(0, dot) : undefined;
                                  }
                                  const rootIdx = dae.getVarIdxByName(id);
                                  if (rootIdx >= 0 && dae.getVarVariability(rootIdx) === Variability.Parameter) {
                                    dae.setVarFinal(rootIdx, true);
                                  }
                                }
                              }
                            }
                          } catch {}
                        }
                      }
                    }
                  }
                  if (attrExprId !== null) {
                    dae.setVarAttr(varIdx, arg.name, attrExprId);
                    if (arg.name === "fixed") {
                      const isFixed =
                        arg.value?.kind === "literal" && typeof arg.value.value === "boolean"
                          ? arg.value.value
                          : arg.value?.kind === "expression" && arg.value.text?.trim() === "false"
                            ? false
                            : true;
                      dae.setVarFixed(varIdx, isFixed);
                    }
                  }
                }
              }
            }

            continue;
          }
        }
        const isRedeclaredPublicly =
          !parentMods?.isProtected &&
          Boolean(parentMods?.args?.some((a: any) => a.name === compInst.name && a.isRedeclaration));

        let isElemProtected =
          !isRedeclaredPublicly &&
          (Boolean(compInst?.isProtected) ||
            flattener["isCstNodeProtected"](elemCst) ||
            Boolean(parentMods?.isProtected) ||
            Boolean(parentMods?.protectedNames?.has(compInst.name)));

        const name = prefix ? `${prefix}.${compInst.name}` : compInst.name;
        const elemSym = flattener.db.symbol(elemId);
        const meta = (elemSym?.metadata as any) || {};

        let classTargetId = compInst.classInstance;
        let origClassTargetId = classTargetId;
        let redeclPkgId: SymbolId | null = null;
        let redeclPkgPrefix: string | null = null;
        if (compInst.typeSpecifier?.includes(".")) {
          const typeParts = compInst.typeSpecifier.split(".");
          const pkgPrefix = typeParts[0]!;
          let pkgRedeclArg = parentMods?.args
            ?.slice()
            .reverse()
            .find((a: any) => !a.isBreak && a.name === pkgPrefix && (a.isRedeclaration || a.redeclaredTypeSpecifier));
          const visitedRedeclNames = new Set<string>([pkgPrefix]);
          while (
            pkgRedeclArg?.redeclaredTypeSpecifier &&
            !pkgRedeclArg.redeclaredTypeSpecifier.includes(".") &&
            !visitedRedeclNames.has(pkgRedeclArg.redeclaredTypeSpecifier)
          ) {
            visitedRedeclNames.add(pkgRedeclArg.redeclaredTypeSpecifier);
            const nextArg = parentMods?.args
              ?.slice()
              .reverse()
              .find(
                (a: any) =>
                  !a.isBreak &&
                  a.name === pkgRedeclArg.redeclaredTypeSpecifier &&
                  (a.isRedeclaration || a.redeclaredTypeSpecifier),
              );
            if (nextArg) pkgRedeclArg = nextArg;
            else break;
          }
          if (pkgRedeclArg?.redeclaredTypeSpecifier) {
            let targetPkgId = resolveRedeclarationType(
              flattener,
              pkgRedeclArg.evaluationScopeId ?? flattener.currentClassId,
              pkgRedeclArg.redeclaredTypeSpecifier,
            );
            if (targetPkgId) {
              const visitedAliases = new Set<SymbolId>();
              while (targetPkgId && !visitedAliases.has(targetPkgId)) {
                visitedAliases.add(targetPkgId);
                if (!getShortClassSpecifierNode(flattener.db.cstNode(targetPkgId) as any)) break;
                const basePkg: SymbolEntry | null = flattener.db.query<SymbolEntry | null>(
                  "resolvedBaseClass",
                  targetPkgId,
                );
                if (basePkg) targetPkgId = basePkg.id;
                else break;
              }
              redeclPkgId = targetPkgId;
              redeclPkgPrefix = pkgPrefix;
              ((state as any).packageRedeclares ??= new Set<string>()).add(pkgPrefix);
              const memberName = typeParts.slice(1).join(".");
              const memberTarget =
                flattener.db.query<(n: string) => SymbolEntry | null>("resolveSimpleName", targetPkgId)?.(memberName) ??
                flattener.db.query<(n: string) => SymbolEntry | null>("resolveName", targetPkgId)?.(memberName);
              if (
                memberTarget &&
                (memberTarget.kind === "Class" || (memberTarget.metadata as any)?.classKind === "type")
              ) {
                classTargetId = memberTarget.id;
              }
            }
          }
        }
        const elemParent = elemSym?.parentId ?? flattener.currentClassId;
        const isCurrentScopeEncapsulated = elemParent ? isScopeEncapsulated(flattener.db, elemParent) : false;
        const isElemParentEncapsulated = elemParent
          ? Boolean(
              flattener.db.query<ScopeData | null>("scopeData", flattener.db.baseOf(elemParent) ?? elemParent)
                ?.isEncapsulated,
            )
          : false;
        if (
          !redeclPkgId &&
          !isElemParentEncapsulated &&
          parentMods?.packageScopeId &&
          compInst.typeSpecifier &&
          !compInst.typeSpecifier.includes(".")
        ) {
          const origParent = classTargetId ? flattener.db.symbol(classTargetId)?.parentId : null;
          if (!classTargetId || (origParent && flattener.isClassPartial(origParent))) {
            const pkgMember =
              flattener.db.query<(n: string) => SymbolEntry | null>(
                "resolveSimpleName",
                parentMods.packageScopeId,
              )?.(compInst.typeSpecifier) ??
              flattener.db.query<(n: string) => SymbolEntry | null>(
                "resolveName",
                parentMods.packageScopeId,
              )?.(compInst.typeSpecifier);
            if (pkgMember && (pkgMember.kind === "Class" || (pkgMember.metadata as any)?.classKind === "type")) {
              classTargetId = pkgMember.id;
            }
          }
        }
        if (
          !redeclPkgId &&
          !isElemParentEncapsulated &&
          flattener.currentClassId &&
          compInst.typeSpecifier &&
          flattener.currentClassId !== elemSym?.parentId
        ) {
          const origClassSym = classTargetId ? flattener.db.symbol(classTargetId) : null;
          if (origClassSym && origClassSym.parentId !== null) {
            const scopeTarget = compInst.typeSpecifier.includes(".")
              ? flattener.db.query<(n: string) => SymbolEntry | null>(
                  "resolveName",
                  flattener.currentClassId,
                )?.(compInst.typeSpecifier)
              : flattener.db.query<(n: string) => SymbolEntry | null>(
                  "resolveSimpleName",
                  flattener.currentClassId,
                )?.(compInst.typeSpecifier);
            if (
              scopeTarget &&
              scopeTarget.id !== classTargetId &&
              !(scopeTarget.metadata as any)?.isPredefined &&
              (scopeTarget.kind === "Class" || (scopeTarget.metadata as any)?.classKind === "type")
            ) {
              classTargetId = scopeTarget.id;
            }
          }
        }
        if (!classTargetId && compInst.typeSpecifier) {
          if (compInst.typeSpecifier.includes(".")) {
            if (elemParent !== null && elemParent !== undefined) {
              const parentResolver = flattener.db.query<(n: string) => SymbolEntry | null>("resolveName", elemParent);
              const resolved = parentResolver?.(compInst.typeSpecifier);
              if (resolved && (resolved.kind === "Class" || (resolved.metadata as any)?.classKind === "type")) {
                classTargetId = resolved.id;
              }
            }
          } else {
            if (elemParent !== null && elemParent !== undefined) {
              const parentResolver = flattener.db.query<(n: string) => SymbolEntry | null>(
                "resolveSimpleName",
                elemParent,
              );
              const resolved = parentResolver?.(compInst.typeSpecifier);
              if (resolved && (resolved.kind === "Class" || (resolved.metadata as any)?.classKind === "type")) {
                classTargetId = resolved.id;
              }
            }
            if (!classTargetId && !isCurrentScopeEncapsulated) {
              const candidates = flattener.db.byName(compInst.typeSpecifier);
              const found = candidates.find(
                (c) =>
                  (c.parentId === null || (c.metadata as any)?.isPredefined) &&
                  (c.kind === "Class" || (c.metadata as any)?.classKind === "type"),
              );
              if (found) {
                classTargetId = found.id;
              }
            }
          }
        }

        const isPrimitive =
          compInst.typeSpecifier === "Real" ||
          compInst.typeSpecifier === "Integer" ||
          compInst.typeSpecifier === "Boolean" ||
          compInst.typeSpecifier === "String" ||
          compInst.typeSpecifier === "Clock" ||
          compInst.typeSpecifier === "StateSelect" ||
          compInst.typeSpecifier === "ExternalObject" ||
          compInst.typeSpecifier === "AssertionLevel" ||
          Boolean(compInst.typeSpecifier?.startsWith("enumeration"));
        const hasPendingRedecl = Boolean(
          parentMods?.args?.some(
            (a: any) =>
              a.isRedeclaration &&
              (a.name === compInst.name ||
                a.name === compInst.typeSpecifier ||
                (compInst.typeSpecifier && a.name === compInst.typeSpecifier.split(".").pop())),
          ),
        );
        if (!classTargetId && !isPrimitive && !hasPendingRedecl && compInst.typeSpecifier) {
          let clauseNode: any = elemCst;
          while (clauseNode && clauseNode.type !== "component_clause") {
            clauseNode = clauseNode.parent;
          }
          const compRange = clauseNode
            ? {
                startPosition: clauseNode.startPosition,
                endPosition: clauseNode.endPosition,
                startByte: clauseNode.startIndex ?? clauseNode.startByte,
                endByte: clauseNode.endIndex ?? clauseNode.endByte,
              }
            : elemCst
              ? {
                  startPosition: elemCst.startPosition,
                  endPosition: elemCst.endPosition,
                  startByte: elemCst.startIndex ?? elemCst.startByte,
                  endByte: elemCst.endIndex ?? elemCst.endByte,
                }
              : undefined;
          const declClassId = elemSym?.parentId ?? flattener.currentClassId;
          if (compInst.typeSpecifier.includes(".") && declClassId) {
            const parts = compInst.typeSpecifier.split(".");
            let curSym =
              flattener.db.query<(n: string) => SymbolEntry | null>("resolveSimpleName", declClassId)?.(parts[0]!) ??
              null;
            let importedSegment: string | null = null;
            for (let i = 1; i < parts.length && curSym; i++) {
              const part = parts[i]!;
              const nextMember = flattener.db.query<
                (n: string, enc?: boolean, skip?: boolean, mem?: boolean) => SymbolEntry | null
              >("resolveSimpleName", curSym.id)?.(part, false, false, true);
              if (!nextMember) {
                const curScope = flattener.db.query<ScopeData | null>(
                  "scopeData",
                  flattener.db.baseOf(curSym.id) ?? curSym.id,
                );
                const isImportedInCur =
                  Boolean(curScope?.qualifiedImports?.[part]) ||
                  Boolean(curScope?.compoundImports?.some((ci) => ci.names.includes(part))) ||
                  Boolean(
                    curScope?.unqualifiedImportPkgs?.some((pkg) => {
                      const pkgSym = resolveQualified(flattener.db, pkg, true);
                      return pkgSym ? flattener.db.childrenOf(pkgSym.id).some((c) => c.name === part) : false;
                    }),
                  );
                if (isImportedInCur) {
                  importedSegment = part;
                }
                break;
              }
              curSym = nextMember;
            }
            if (importedSegment && !flattener.isOldFrontend && !dae.extensionMetadata?.["isOldFrontend"]) {
              dae.diagnostics.push({
                severity: "error",
                code: ModelicaErrorCode.CLASS_NOT_FOUND_IN_SCOPE.code,
                message: `Found imported name '${importedSegment}' while looking up composite name '${compInst.typeSpecifier}'.`,
                range: compRange,
              });
              break;
            }
          }
          const firstPart = compInst.typeSpecifier.split(".")[0]!;
          if (declClassId) {
            const importChildren = flattener.db.childrenOf(declClassId).filter((c) => c.kind === "Import");
            const matchingQualImports: { sym: SymbolEntry; pkgName: string; shortName: string }[] = [];
            const matchingUnqualImports: SymbolEntry[] = [];
            for (const imp of importChildren) {
              const impMeta = imp.metadata as Record<string, unknown>;
              const impCst = flattener.db.cstNode(imp.id) as any;
              const impText: string = impCst?.text ?? "";
              const aliasNode = impCst ? Cst.ImportClause.alias(impCst) : null;
              const importListNode = impCst ? Cst.ImportClause.importList(impCst) : null;
              const pkgName = String(impMeta?.["packageName"] ?? imp.name ?? "");
              if (/\.\s*\*/.test(impText) || impMeta?.["importKind"] === "unqualified") {
                const pkgSym = resolveQualified(flattener.db, pkgName, true);
                if (
                  pkgSym &&
                  flattener.db.childrenOf(pkgSym.id).some((c) => c.name === firstPart && c.kind !== "Reference")
                ) {
                  matchingUnqualImports.push(imp);
                }
              } else if (!importListNode && impMeta?.["importKind"] !== "compound") {
                const shortName = String(
                  aliasNode?.text ?? impMeta?.["shortName"] ?? pkgName.split(".").pop() ?? pkgName,
                );
                if (shortName === firstPart) {
                  matchingQualImports.push({ sym: imp, pkgName, shortName });
                }
              }
            }
            const getImpRange = (sym: SymbolEntry) => {
              const n = flattener.db.cstNode(sym.id) as any;
              return n
                ? {
                    startPosition: n.startPosition,
                    endPosition: n.endPosition,
                    startByte: n.startIndex ?? n.startByte,
                    endByte: n.endIndex ?? n.endByte,
                  }
                : undefined;
            };
            if (matchingQualImports.length > 1) {
              const firstImp = matchingQualImports[0]!.sym;
              const secondImp = matchingQualImports[1]!.sym;
              dae.diagnostics.push({
                severity: "notification",
                code: ModelicaErrorCode.NOTIFICATION_FROM_HERE.code,
                message: "From here:",
                range: getImpRange(firstImp),
              });
              dae.diagnostics.push({
                severity: "error",
                code: ModelicaErrorCode.CLASS_NOT_FOUND_IN_SCOPE.code,
                message: `Qualified import name ${firstPart} already exists in this scope.`,
                range: getImpRange(secondImp),
              });
            } else if (matchingQualImports.length === 1) {
              const impInfo = matchingQualImports[0]!;
              const resolvedImp = resolveQualified(flattener.db, impInfo.pkgName, true);
              if (!resolvedImp) {
                dae.diagnostics.push({
                  severity: "error",
                  code: ModelicaErrorCode.CLASS_NOT_FOUND_IN_SCOPE.code,
                  message: `Import ${impInfo.pkgName} not found in scope <top>.`,
                  range: getImpRange(impInfo.sym),
                });
              }
            } else if (matchingUnqualImports.length > 1) {
              const firstImp = matchingUnqualImports[0]!;
              const secondImp = matchingUnqualImports[1]!;
              dae.diagnostics.push({
                severity: "notification",
                code: ModelicaErrorCode.NOTIFICATION_FROM_HERE.code,
                message: "From here:",
                range: getImpRange(firstImp),
              });
              dae.diagnostics.push({
                severity: "error",
                code: ModelicaErrorCode.CLASS_NOT_FOUND_IN_SCOPE.code,
                message: `${firstPart} found in several unqualified import statements.`,
                range: getImpRange(secondImp),
              });
            }
          }
          const scopeSym = declClassId ? flattener.db.symbol(declClassId) : null;
          const scopeName =
            scopeSym && isSymbolEncapsulated(flattener.db, scopeSym)
              ? scopeSym.name
              : declClassId
                ? getSymbolQualifiedName(flattener.db, declClassId)
                : (scopeSym?.name ?? "scope");
          dae.diagnostics.push({
            severity: "error",
            code: ModelicaErrorCode.CLASS_NOT_FOUND_IN_SCOPE.code,
            message: ModelicaErrorCode.CLASS_NOT_FOUND_IN_SCOPE.message(compInst.typeSpecifier, scopeName),
            range: compRange,
          });
          break;
        }
        if (classTargetId) {
          classTargetId = resolveInnerOuterClass(flattener, classTargetId);

          const isEnc = isScopeEncapsulated(flattener.db, classTargetId);
          if (isEnc) {
            const extendsChildren = flattener.db.childrenOf(classTargetId).filter((c) => c.kind === "Extends");
            let hasExtendsErr = false;
            for (const ext of extendsChildren) {
              const base = flattener.db.query<SymbolEntry | null>("resolvedBaseClass", ext.id);
              if (!base) {
                const scopeFQN = getSymbolQualifiedName(flattener.db, classTargetId);
                const extCst = flattener.db.cstNode(ext.id) as any;
                const extRange = extCst
                  ? {
                      startPosition: extCst.startPosition,
                      endPosition: extCst.endPosition,
                      startByte: extCst.startIndex ?? extCst.startByte,
                      endByte: extCst.endIndex ?? extCst.endByte,
                    }
                  : undefined;
                dae.diagnostics.push({
                  severity: "error",
                  code: ModelicaErrorCode.BASE_CLASS_NOT_FOUND_IN_SCOPE.code,
                  message: ModelicaErrorCode.BASE_CLASS_NOT_FOUND_IN_SCOPE.message(ext.name, scopeFQN),
                  range: extRange,
                });
                hasExtendsErr = true;
                break;
              }
            }
            if (hasExtendsErr) {
              break;
            }
          }
        }

        const typeLeaf = compInst.typeSpecifier ? compInst.typeSpecifier.split(".").pop() : "";
        let matchingClassArg = parentMods?.args
          ?.slice()
          .reverse()
          .find((a: any) => !a.isBreak && (a.name === compInst.typeSpecifier || (typeLeaf && a.name === typeLeaf)));
        if (!matchingClassArg && compInst.typeSpecifier?.includes(".")) {
          const typeParts = compInst.typeSpecifier.split(".");
          let curArgs = parentMods?.args;
          let matchedNested: any = null;
          for (let pIdx = 0; pIdx < typeParts.length; pIdx++) {
            const part = typeParts[pIdx]!;
            const found = curArgs
              ?.slice()
              .reverse()
              .find((a: any) => !a.isBreak && a.name === part);
            if (!found) {
              matchedNested = null;
              break;
            }
            if (pIdx === typeParts.length - 1) {
              matchedNested = found;
            } else {
              curArgs = found.nestedArgs || found.args;
            }
          }
          if (matchedNested) {
            matchingClassArg = matchedNested;
          }
        }
        // matchingParentArg already computed above

        // ── Final override verification (Modelica §7.2.6) ──
        const isFinalComp = Boolean(compInst?.isFinal || (flattener.db.symbol(elemId)?.metadata as any)?.isFinal);

        // Case A: Component itself is declared final, and parentMods provides a modification
        if (
          isFinalComp &&
          matchingParentArg &&
          !matchingParentArg.isRedeclaration &&
          !matchingParentArg.isRecordCtorDefault &&
          (matchingParentArg.value != null ||
            (matchingParentArg.nestedArgs && matchingParentArg.nestedArgs.length > 0) ||
            matchingParentArg.modText)
        ) {
          let declNode: any = elemCst;
          let p = elemCst?.parent;
          while (p && (p.type === "component_declaration" || p.type === "component_clause" || p.type === "element")) {
            declNode = p;
            p = p.parent;
          }
          const notifRange = {
            startByte: declNode?.startIndex ?? declNode?.startByte,
            endByte: declNode?.endIndex ?? declNode?.endByte,
            startPosition: declNode?.startPosition,
            endPosition: declNode?.endPosition,
          };
          const errorRange = {
            startByte: matchingParentArg.modRange?.[0] ?? matchingParentArg.modPosition?.startPosition,
            endByte: matchingParentArg.modRange?.[1] ?? matchingParentArg.modPosition?.endPosition,
            startPosition: matchingParentArg.modPosition?.startPosition,
            endPosition: matchingParentArg.modPosition?.endPosition,
          };
          const modText =
            matchingParentArg.modText || (matchingParentArg.value?.text ? `=${matchingParentArg.value.text}` : "");
          dae.diagnostics.push({
            severity: "notification",
            code: ModelicaErrorCode.NOTIFICATION_FROM_HERE.code,
            message: "From here:",
            range: notifRange,
          });
          dae.diagnostics.push({
            severity: "error",
            code: ModelicaErrorCode.FINAL_OVERRIDE.code,
            message: ModelicaErrorCode.FINAL_OVERRIDE.message(compInst.name, modText),
            range: errorRange,
          });
          return;
        }

        // Case B: Component was finalized by an earlier modifier (in parentMods.args), and a later modifier overrides it
        const compArgs = (parentMods?.args || []).filter((a: any) => !a.isBreak && a.name === compInst.name);
        const finalArgIdx = compArgs.findIndex((a: any) => a.final);
        if (finalArgIdx >= 0) {
          const finalArg = compArgs[finalArgIdx];
          const overridingArg = compArgs
            .slice(finalArgIdx + 1)
            .find((a: any) => a.value != null || (a.nestedArgs && a.nestedArgs.length > 0) || a.modText);
          if (overridingArg) {
            const modText = overridingArg.modText || (overridingArg.value?.text ? `=${overridingArg.value.text}` : "");
            const notifRange = {
              startByte: finalArg.modRange?.[0] ?? finalArg.modPosition?.startPosition,
              endByte: finalArg.modRange?.[1] ?? finalArg.modPosition?.endPosition,
              startPosition: finalArg.modPosition?.startPosition,
              endPosition: finalArg.modPosition?.endPosition,
            };
            const errorRange = {
              startByte: overridingArg.modRange?.[0] ?? overridingArg.modPosition?.startPosition,
              endByte: overridingArg.modRange?.[1] ?? overridingArg.modPosition?.endPosition,
              startPosition: overridingArg.modPosition?.startPosition,
              endPosition: overridingArg.modPosition?.endPosition,
            };
            dae.diagnostics.push({
              severity: "notification",
              code: ModelicaErrorCode.NOTIFICATION_FROM_HERE.code,
              message: "From here:",
              range: notifRange,
            });
            dae.diagnostics.push({
              severity: "error",
              code: ModelicaErrorCode.FINAL_OVERRIDE.code,
              message: ModelicaErrorCode.FINAL_OVERRIDE.message(compInst.name, modText),
              range: errorRange,
            });
            return;
          }
        }

        const effectiveParentArg =
          matchingParentArg?.isRedeclaration &&
          !compInst?.isReplaceable &&
          !dae.extensionMetadata?.["ignoreReplaceable"]
            ? null
            : matchingParentArg;
        const effectiveClassArg = matchingClassArg;

        const redeclArg =
          effectiveParentArg?.isRedeclaration && effectiveParentArg?.redeclaredTypeSpecifier
            ? effectiveParentArg
            : effectiveClassArg?.isRedeclaration && effectiveClassArg?.redeclaredTypeSpecifier
              ? effectiveClassArg
              : (parentMods?.args?.find(
                  (a: any) => a.name === compInst.name && a.isRedeclaration && a.redeclaredTypeSpecifier,
                ) ?? null);
        if (redeclArg?.redeclaredPrefix) {
          const origPrefix =
            (compInst.flowPrefix && compInst.flowPrefix !== "unspecified" ? compInst.flowPrefix : null) ??
            (compInst.variability && compInst.variability !== "continuous" && compInst.variability !== "discrete"
              ? compInst.variability
              : null);
          if (origPrefix && origPrefix !== redeclArg.redeclaredPrefix) {
            const modRange = redeclArg.modRange;
            const modPos = redeclArg.modPosition;
            dae.diagnostics.push({
              severity: "error",
              code: ModelicaErrorCode.INVALID_REDECLARATION_PREFIX.code,
              message: ModelicaErrorCode.INVALID_REDECLARATION_PREFIX.message(
                redeclArg.redeclaredPrefix,
                compInst.name,
                origPrefix,
              ),
              range: modRange
                ? {
                    startByte: modRange[0],
                    endByte: modRange[1],
                    startPosition: modPos?.startPosition,
                    endPosition: modPos?.endPosition,
                  }
                : undefined,
            });
            return;
          }
        }
        origClassTargetId ??= classTargetId;
        if (
          !parentMods?.isProtected &&
          (Boolean(effectiveParentArg?.isRedeclaration) ||
            Boolean(effectiveClassArg?.isRedeclaration) ||
            Boolean(redeclArg?.isRedeclaration))
        ) {
          isElemProtected = false;
        }
        if (redeclArg?.redeclaredTypeSpecifier) {
          const redeclScopeId = redeclArg.evaluationScopeId ?? flattener.currentClassId ?? flattener.currentRootClassId;
          const redeclTargetId = resolveRedeclarationType(flattener, redeclScopeId, redeclArg.redeclaredTypeSpecifier);
          if (redeclTargetId) {
            if (origClassTargetId && flattener.db.query<boolean>("isRedeclare", origClassTargetId)) {
              const origSym = flattener.db.symbol(origClassTargetId);
              const origOwnerId =
                origSym?.parentId != null && flattener.db.symbol(origSym.parentId)?.kind === "Extends"
                  ? flattener.db.symbol(origSym.parentId)!.parentId
                  : origSym?.parentId;
              if (origOwnerId) {
                const findBaseOrigClass = (clsId: SymbolId, visited = new Set<SymbolId>()): SymbolId | null => {
                  if (visited.has(clsId)) return null;
                  visited.add(clsId);
                  for (const ch of flattener.db.childrenOf(clsId)) {
                    if (
                      ch.kind === "Class" &&
                      ch.name === origSym!.name &&
                      !flattener.db.query<boolean>("isRedeclare", ch.id)
                    ) {
                      return ch.id;
                    }
                  }
                  for (const ch of flattener.db.childrenOf(clsId)) {
                    if (ch.kind === "Extends") {
                      const bSym = resolveExtendsBase(flattener, ch, clsId);
                      if (bSym) {
                        const found = findBaseOrigClass(bSym.id, visited);
                        if (found) return found;
                      }
                    }
                  }
                  return null;
                };
                const baseOrigId = findBaseOrigClass(origOwnerId);
                if (baseOrigId) origClassTargetId = baseOrigId;
              }
            }
            const origCst = origClassTargetId ? (flattener.db.cstNode(origClassTargetId) as any) : null;
            const origParentType = origCst?.parent?.type ?? "";
            const isOrigReplaceableClass = Boolean(
              origClassTargetId &&
              (flattener.db.query<boolean>("isReplaceable", origClassTargetId) ||
                origParentType === "element_replaceable" ||
                ((origParentType === "element" ||
                  origParentType === "element_redeclaration" ||
                  origParentType === "argument") &&
                  /^\s*(?:redeclare\s+)?(?:each\s+)?(?:final\s+)?(?:inner\s+|outer\s+)*replaceable\b/.test(
                    origCst?.parent?.text ?? "",
                  )) ||
                /^\s*(?:redeclare\s+)?(?:each\s+)?(?:final\s+)?(?:inner\s+|outer\s+)*replaceable\b/.test(
                  origCst?.text ?? "",
                )),
            );
            if (origClassTargetId && origClassTargetId !== redeclTargetId && isOrigReplaceableClass) {
              const origMod = flattener.db.query<any>("effectiveModification", origClassTargetId);
              if (origMod?.args && origMod.args.length > 0) {
                const targetElements = flattener.db.query<SymbolId[]>("instantiate", redeclTargetId) ?? [];
                const validTargetFieldNames = new Set(
                  targetElements.map((eid) => flattener.db.symbol(eid)?.name).filter(Boolean),
                );
                const existingNames = new Set((redeclArg.nestedArgs || []).map((a: any) => a.name));
                const inheritedArgsToPreserve: any[] = [];
                for (const oArg of origMod.args) {
                  if (
                    oArg?.name &&
                    !existingNames.has(oArg.name) &&
                    (validTargetFieldNames.size === 0 || validTargetFieldNames.has(oArg.name))
                  ) {
                    inheritedArgsToPreserve.push(oArg);
                    existingNames.add(oArg.name);
                  }
                }
                if (inheritedArgsToPreserve.length > 0) {
                  redeclArg.nestedArgs = [...inheritedArgsToPreserve, ...(redeclArg.nestedArgs || [])];
                }
              }
            }
            classTargetId = redeclTargetId;
          } else if (["Real", "Integer", "Boolean", "String"].includes(redeclArg.redeclaredTypeSpecifier)) {
            classTargetId = null;
          }
        }

        const classTarget = classTargetId ? flattener.db.symbol(classTargetId) : null;
        if (classTargetId) {
          const specViolation = checkTypeAliasSpecialization(flattener, classTargetId);
          if (specViolation) {
            dae.diagnostics.push({
              severity: "error",
              code: ModelicaErrorCode.CLASS_SPECIALIZATION_VIOLATION.code,
              message: `Class specialization violation: .${specViolation.targetName} is ${specViolation.kindDesc}, not a type.`,
              range: specViolation.range,
            });
            continue;
          }
        }

        let basePrefixText: string | null = null;
        let conflictingChainPrefix: { newPrefix: string; existingPrefix: string } | null = null;
        if (classTargetId) {
          let currTargetId: SymbolId | null = classTargetId;
          while (currTargetId) {
            const cst = flattener.db.cstNode(currTargetId) as any;
            const baseSym: any = flattener.db.query("resolvedBaseClass", currTargetId);
            if (cst) {
              const short = getShortClassSpecifierNode(cst);
              if (short) {
                const shortTypeSpec =
                  Cst.ShortClassSpecifier.typeSpecifier(short) ??
                  short?.children?.find((c: any) => c.type === "type_specifier" || c.type === "TypeSpecifier");
                const shortTypeName = shortTypeSpec?.text?.trim() ?? "";
                const isShortPrim =
                  shortTypeName === "Real" ||
                  shortTypeName === "Integer" ||
                  shortTypeName === "Boolean" ||
                  shortTypeName === "String" ||
                  shortTypeName === "Clock" ||
                  shortTypeName === "StateSelect" ||
                  shortTypeName === "ExternalObject" ||
                  shortTypeName === "AssertionLevel";
                if (shortTypeName && !isShortPrim && !baseSym) {
                  const currSym = flattener.db.symbol(currTargetId);
                  const topResolved =
                    currSym?.parentId == null
                      ? (resolveQualified(flattener.db, shortTypeName, true) ??
                        flattener.db.byName(shortTypeName).find((c) => c.parentId === null && c.id !== currTargetId))
                      : null;
                  if (!topResolved) {
                    const scopeFQN = currSym?.parentId
                      ? getSymbolQualifiedName(flattener.db, currSym.parentId)
                      : "<global scope>";
                    dae.diagnostics.push({
                      severity: "error",
                      code: ModelicaErrorCode.BASE_CLASS_NOT_FOUND_IN_SCOPE.code,
                      message: ModelicaErrorCode.BASE_CLASS_NOT_FOUND_IN_SCOPE.message(shortTypeName, scopeFQN),
                      range: {
                        startPosition: cst.startPosition,
                        endPosition: cst.endPosition,
                        startByte: cst.startIndex ?? cst.startByte,
                        endByte: cst.endIndex ?? cst.endByte,
                      },
                    });
                    return;
                  }
                }
                const shortArrSub =
                  Cst.ShortClassSpecifier.arraySubscripts(short) ??
                  short?.children?.find((c: any) => c.type === "array_subscripts" || c.type === "ArraySubscripts");
                const shortMod =
                  Cst.ShortClassSpecifier.classModification(short) ??
                  short?.children?.find((c: any) => c.type === "class_modification" || c.type === "ClassModification");
                if (shortArrSub && shortMod) {
                  const effShortMod = flattener.db.query<any>("effectiveModification", currTargetId);
                  if (effShortMod?.args) {
                    for (const arg of effShortMod.args) {
                      const rawVal = arg.value?.text ?? arg.value ?? arg.modification?.bindingExpression;
                      if (!arg.each && !arg.isEach && rawVal) {
                        const bVal = String(rawVal).replace(/^=/, "").trim();
                        if (
                          /^[+-]?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(bVal) ||
                          bVal === "true" ||
                          bVal === "false" ||
                          (bVal.startsWith('"') && bVal.endsWith('"'))
                        ) {
                          const diagRange = getElementDiagRange(elemCst);
                          dae.diagnostics.push({
                            severity: "notification",
                            code: ModelicaErrorCode.NOTIFICATION_FROM_HERE.code,
                            message: "From here:",
                            range: {
                              startPosition: shortMod.startPosition,
                              endPosition: shortMod.endPosition,
                              startByte: shortMod.startIndex ?? shortMod.startByte,
                              endByte: shortMod.endIndex ?? shortMod.endByte,
                            },
                          });
                          dae.diagnostics.push({
                            severity: "error",
                            code: ModelicaErrorCode.NON_ARRAY_MODIFICATION.code,
                            message: ModelicaErrorCode.NON_ARRAY_MODIFICATION.message(bVal, arg.name),
                            range: diagRange,
                          });
                          return;
                        }
                      }
                    }
                  }
                }
              }
              const basePrefixNode =
                Cst.ShortClassSpecifier.basePrefix(short) ??
                short?.children?.find((c: any) => c.type === "base_prefix");
              const text = basePrefixNode?.text?.trim();
              if (text === "input" || text === "output") {
                if (!basePrefixText) {
                  basePrefixText = text;
                } else {
                  conflictingChainPrefix = {
                    newPrefix: text,
                    existingPrefix: basePrefixText,
                  };
                  break;
                }
              }
            }
            currTargetId = baseSym && baseSym.id !== currTargetId ? baseSym.id : null;
          }
        }

        if (conflictingChainPrefix) {
          const diagRange = getElementDiagRange(elemCst);
          dae.diagnostics.push({
            severity: "error",
            code: ModelicaErrorCode.INVALID_TYPE_PREFIX_CONFLICT.code,
            message: ModelicaErrorCode.INVALID_TYPE_PREFIX_CONFLICT.message(
              conflictingChainPrefix.newPrefix,
              compInst.name,
              conflictingChainPrefix.existingPrefix,
            ),
            range: diagRange,
          });
          return;
        }

        if (compInst.causality && basePrefixText && compInst.causality !== basePrefixText) {
          const diagRange = getElementDiagRange(elemCst);
          dae.diagnostics.push({
            severity: "error",
            code: ModelicaErrorCode.INVALID_TYPE_PREFIX_CONFLICT.code,
            message: ModelicaErrorCode.INVALID_TYPE_PREFIX_CONFLICT.message(
              basePrefixText,
              compInst.name,
              compInst.causality,
            ),
            range: diagRange,
          });
          return;
        }

        if (
          compInst.causality &&
          parentMods?.parentCausality !== undefined &&
          parentMods.parentCausality !== Causality.Local
        ) {
          const parentCausalityStr =
            parentMods.parentCausality === Causality.Input
              ? "input"
              : parentMods.parentCausality === Causality.Output
                ? "output"
                : "local";
          if (parentCausalityStr !== "local") {
            const diagRange = getElementDiagRange(elemCst);
            dae.diagnostics.push({
              severity: "error",
              code: ModelicaErrorCode.INVALID_TYPE_PREFIX_CONFLICT.code,
              message: ModelicaErrorCode.INVALID_TYPE_PREFIX_CONFLICT.message(
                compInst.causality,
                compInst.name,
                parentCausalityStr,
              ),
              range: diagRange,
            });
            return;
          }
        }

        const isType = classTargetId ? isClassType(flattener, classTargetId) : false;
        const effectiveType = redeclArg?.redeclaredTypeSpecifier ?? compInst.typeSpecifier;
        const isExtObj = flattener.isExternalObject(classTargetId);
        if (isExtObj && classTargetId) {
          flattener.usedExternalObjects.add(classTargetId);
        }
        const compSpecPkgPrefix =
          redeclPkgId && redeclPkgPrefix
            ? (() => {
                const ownerClsId = parentMods?.currentClassId ?? parentMods?.ownerClassId ?? flattener.currentClassId;
                const ownerQual = ownerClsId ? getSymbolQualifiedName(flattener.db, ownerClsId) : "";
                if (!ownerQual) return undefined;
                return prefix
                  ? `${ownerQual}$${prefix.replace(/\./g, "$")}.${redeclPkgPrefix}`
                  : `${ownerQual}.${redeclPkgPrefix}`;
              })()
            : (parentMods?.specializedPkgPrefix ?? (dae as any)?.specializedPrefix);
        const isRecordTarget =
          (classTarget && (flattener["isRecordSym"](classTarget) || flattener.isOperatorRecordSym(classTarget))) ||
          false;
        if (isRecordTarget && classTarget) {
          if (
            effectiveClassArg?.isRedeclaration &&
            effectiveClassArg.name &&
            origClassTargetId &&
            origClassTargetId !== classTarget.id
          ) {
            const redeclCtorName = `${dae.name ? `${dae.name}.` : ""}${prefix ? `${prefix}.` : ""}${effectiveClassArg.name}`;
            (flattener.generateRecordConstructorFor as any)?.(
              classTarget,
              dae,
              flattener.currentRootClassId,
              redeclCtorName,
              effectiveClassArg.name,
            );
          } else if (compSpecPkgPrefix && classTarget.parentId && flattener.isClassPartial(classTarget.parentId)) {
            (flattener.generateRecordConstructorFor as any)?.(
              classTarget,
              dae,
              flattener.currentRootClassId,
              `${compSpecPkgPrefix}.${classTarget.name}`,
              classTarget.name,
            );
          } else {
            flattener.usedRecordSymIds?.add(classTarget.id);
            if (classTarget.name) flattener.usedRecordNames?.add(classTarget.name);
          }
          const hasArgs = Boolean(
            (compInst?.modification?.args && compInst.modification.args.length > 0) ||
            (parentMods?.args &&
              parentMods.args.some((a: any) => a.name === compInst.name && a.modification?.args?.length > 0)),
          );
          if (hasArgs && compInst.name && dae.classKind !== "function") {
            if (!flattener["instantiatedRecordComponents"]) {
              flattener["instantiatedRecordComponents"] = new Map<string, Set<string>>();
            }
            const qTarget = getSymbolQualifiedName(flattener.db, classTarget.id) || classTarget.name;
            let s = flattener["instantiatedRecordComponents"].get(qTarget);
            if (!s) {
              s = new Set<string>();
              flattener["instantiatedRecordComponents"].set(qTarget, s);
            }
            s.add(compInst.name);
            if (classTarget.name && classTarget.name !== qTarget) {
              let s2 = flattener["instantiatedRecordComponents"].get(classTarget.name);
              if (!s2) {
                s2 = new Set<string>();
                flattener["instantiatedRecordComponents"].set(classTarget.name, s2);
              }
              s2.add(compInst.name);
            }
          }
        }
        const isUserClass =
          classTarget &&
          classTarget.kind === "Class" &&
          !isType &&
          !isExtObj &&
          !(classTarget.metadata as any)?.isEnum &&
          !isPredefinedType(classTarget) &&
          effectiveType !== "Real" &&
          effectiveType !== "Integer" &&
          effectiveType !== "Boolean" &&
          effectiveType !== "String" &&
          !(dae.classKind === "function" && isRecordTarget);

        if (dae.classKind === "function" && classTargetId) {
          const targetMeta = flattener.db.symbol(classTargetId)?.metadata as any;
          const rawKind = String(targetMeta?.classKind ?? targetMeta?.classPrefixes ?? "");
          const cleanKind = rawKind.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, " ").trim();
          const words = cleanKind.split(/\s+/).filter(Boolean);
          const isModel = words.includes("model");
          const isConnector = words.includes("connector");
          const isBlock = words.includes("block");
          const isRecord = words.includes("record") || isRecordTarget;
          const isFunc = words.includes("function") || flattener["isFunctionSym"](classTarget);
          const isTypeKind = words.includes("type") || isType;
          if (
            !isExtObj &&
            !isRecord &&
            !isFunc &&
            !isTypeKind &&
            (isModel || isConnector || isBlock || words.includes("class") || isUserClass)
          ) {
            let clauseNode: any = elemCst;
            while (clauseNode && clauseNode.type !== "component_clause") {
              clauseNode = clauseNode.parent;
            }
            const rangeObj = clauseNode
              ? {
                  startByte: clauseNode.startIndex ?? clauseNode.startByte,
                  endByte: clauseNode.endIndex ?? clauseNode.endByte,
                }
              : elemCst
                ? { startByte: elemCst.startIndex ?? elemCst.startByte, endByte: elemCst.endIndex ?? elemCst.endByte }
                : undefined;
            const typeName = compInst.typeSpecifier?.startsWith(".")
              ? compInst.typeSpecifier
              : `.${compInst.typeSpecifier}`;
            dae.diagnostics.push({
              severity: "error",
              code: ModelicaErrorCode.FUNCTION_INVALID_VAR_TYPE.code,
              message: ModelicaErrorCode.FUNCTION_INVALID_VAR_TYPE.message(typeName, compInst.name),
              range: rangeObj,
            });
            continue;
          }
        }

        const targetMeta = classTargetId ? (flattener.db.symbol(classTargetId)?.metadata as any) : undefined;
        const targetCst = classTargetId ? (flattener.db.cstNode(classTargetId) as any) : undefined;
        const isShortConnector = targetCst && Boolean(getShortClassSpecifierNode(targetCst));
        const rawKind = String(targetMeta?.classKind ?? targetMeta?.classPrefixes ?? "");
        const isConnectorClass = classTarget?.kind === "Connector" || rawKind.includes("connector");
        const isConnector = isConnectorClass && !isShortConnector;
        if (
          isConnector &&
          !dae.extensionMetadata?.["isOldFrontend"] &&
          (compInst.variability === "parameter" ||
            compInst.variability === "constant" ||
            parentMods?.parentVariability === Variability.Parameter ||
            parentMods?.parentVariability === Variability.Constant)
        ) {
          if (
            dae.extensionMetadata?.["isOldFrontend"] &&
            dae.diagnostics.some((d) => d.code === ModelicaErrorCode.CONNECTOR_VARIABILITY.code)
          ) {
            return;
          }
          const varb =
            compInst.variability ?? (parentMods?.parentVariability === Variability.Constant ? "constant" : "parameter");
          let clauseNode: any = elemCst;
          while (clauseNode && clauseNode.type !== "component_clause") {
            clauseNode = clauseNode.parent;
          }
          const compRange = clauseNode
            ? {
                startByte: clauseNode.startIndex ?? clauseNode.startByte,
                endByte: clauseNode.endIndex ?? clauseNode.endByte,
                startPosition: clauseNode.startPosition,
                endPosition: clauseNode.endPosition,
              }
            : undefined;
          dae.diagnostics.push({
            severity: "error",
            code: ModelicaErrorCode.CONNECTOR_VARIABILITY.code,
            message: `Invalid variability ${varb} on connector '${compInst.name}'.`,
            range: compRange,
          });
          return;
        }

        if (classTargetId && isConnectorClass) {
          let isStreamConnector = compInst?.flowPrefix === "stream";
          let flowVarCount = compInst?.flowPrefix === "flow" ? 1 : 0;
          let currTargetId: SymbolId | null = classTargetId;
          while (currTargetId) {
            const cst = flattener.db.cstNode(currTargetId) as any;
            if (cst) {
              const spec = Cst.ClassDefinition.classSpecifier(cst);
              const short =
                Cst.ShortClassSpecifier.is(spec) ||
                spec?.type === "short_class_specifier" ||
                spec?.type === "ShortClassSpecifier"
                  ? spec
                  : spec?.children?.find(
                      (c: any) => Cst.ShortClassSpecifier.is(c) || c.type === "short_class_specifier",
                    );
              const basePrefixNode =
                Cst.ShortClassSpecifier.basePrefix(short) ??
                short?.children?.find((c: any) => c.type === "base_prefix");
              const text = basePrefixNode?.text?.trim();
              if (text === "stream" || text?.includes("stream")) {
                isStreamConnector = true;
                break;
              }
            }
            const baseSym: any = flattener.db.query("resolvedBaseClass", currTargetId);
            currTargetId = baseSym && baseSym.id !== currTargetId ? baseSym.id : null;
          }
          if (!isStreamConnector) {
            const targetElems = flattener.db.query<SymbolId[]>("instantiate", classTargetId) ?? [];
            for (const te of targetElems) {
              const sym = flattener.db.symbol(te);
              const m = sym?.metadata as any;
              if (m?.flowPrefix === "stream") {
                isStreamConnector = true;
              } else if (m?.flowPrefix === "flow") {
                flowVarCount++;
              }
            }
          }
          if (isStreamConnector && flowVarCount !== 1) {
            let clauseNode: any = elemCst;
            while (clauseNode && clauseNode.type !== "component_clause") {
              clauseNode = clauseNode.parent;
            }
            const rangeObj = clauseNode
              ? {
                  startByte: clauseNode.startIndex ?? clauseNode.startByte,
                  endByte: clauseNode.endIndex ?? clauseNode.endByte,
                  startPosition: clauseNode.startPosition,
                  endPosition: clauseNode.endPosition,
                }
              : elemCst
                ? {
                    startByte: elemCst.startIndex ?? elemCst.startByte,
                    endByte: elemCst.endIndex ?? elemCst.endByte,
                    startPosition: elemCst.startPosition,
                    endPosition: elemCst.endPosition,
                  }
                : undefined;
            dae.diagnostics.push({
              severity: "error",
              code: ModelicaErrorCode.STREAM_UNBALANCED_CONNECTOR.code,
              message: ModelicaErrorCode.STREAM_UNBALANCED_CONNECTOR.message(compInst.name, flowVarCount),
              range: rangeObj,
            });
            return;
          }
        }

        // ============================================================================
        // Phase 4: Recursive Composite Class Elaboration & Modifier Merging
        // ============================================================================
        if (isUserClass) {
          // Check for dot lookup in partial classes/packages (e.g. P.A a; where P is partial)
          const typeSpecParts = (compInst.typeSpecifier ?? "").split(".");
          if (typeSpecParts.length > 1) {
            const curScopeId = flattener.currentClassId ?? flattener.currentRootClassId;
            let currentScope: SymbolEntry | null = curScopeId ? (flattener.db.symbol(curScopeId) ?? null) : null;
            let hasPartialLookup = false;
            for (let i = 0; i < typeSpecParts.length - 1; i++) {
              const part = typeSpecParts[i]!;
              let resolved: SymbolEntry | null = null;
              if (i === 0) {
                const resolver =
                  (curScopeId
                    ? flattener.db.query<(n: string) => SymbolEntry | null>(
                        "resolveSimpleName",
                        currentScope?.id ?? curScopeId,
                      )
                    : null) ??
                  (curScopeId
                    ? flattener.db.query<(n: string) => SymbolEntry | null>(
                        "resolveName",
                        currentScope?.id ?? curScopeId,
                      )
                    : null);
                resolved = resolver ? resolver(part) : null;
                if (!resolved) {
                  resolved = flattener.db.byName(part).find((e) => e.kind === "Class" || e.kind === "Package") ?? null;
                }
              } else if (currentScope) {
                resolved = flattener.db.childrenOf(currentScope.id).find((c) => c.name === part) ?? null;
              }
              if (resolved && flattener.isClassPartial(resolved.id)) {
                const isOldFrontend = Boolean(dae.extensionMetadata?.["isOldFrontend"]);
                if (!isOldFrontend) {
                  let clauseNode: any = elemCst;
                  while (clauseNode && clauseNode.type !== "component_clause" && clauseNode.parent) {
                    clauseNode = clauseNode.parent;
                  }
                  const compRange = clauseNode
                    ? {
                        startByte: clauseNode.startIndex ?? clauseNode.startByte,
                        endByte: clauseNode.endIndex ?? clauseNode.endByte,
                        startPosition: clauseNode.startPosition,
                        endPosition: clauseNode.endPosition,
                      }
                    : elemCst
                      ? {
                          startByte: elemCst.startIndex ?? elemCst.startByte,
                          endByte: elemCst.endIndex ?? elemCst.endByte,
                          startPosition: elemCst.startPosition,
                          endPosition: elemCst.endPosition,
                        }
                      : undefined;
                  dae.diagnostics.push({
                    severity: "error",
                    code: ModelicaErrorCode.PARTIAL_LOOKUP_DISALLOWED.code,
                    message: ModelicaErrorCode.PARTIAL_LOOKUP_DISALLOWED.message(part),
                    range: compRange,
                  });
                }
                hasPartialLookup = true;
                break;
              }
              currentScope = resolved;
            }
            if (hasPartialLookup) continue;
          }

          if (compInst.flowPrefix === "flow" && classTargetId) {
            const findNestedFlow = (targetId: SymbolId): string | null => {
              const elements = flattener.db.query<SymbolId[]>("instantiate", targetId) ?? [];
              for (const eid of elements) {
                const sym = flattener.db.symbol(eid);
                if (sym?.kind === "Component") {
                  const inst = flattener.db.query<any>("componentInstance", eid);
                  if (inst?.flowPrefix === "flow") {
                    return inst.name;
                  }
                  const childTarget = flattener.db.query<SymbolEntry | null>("classInstance", eid);
                  if (childTarget) {
                    const nested = findNestedFlow(childTarget.id);
                    if (nested) return `${inst?.name ?? sym.name}.${nested}`;
                  }
                }
              }
              return null;
            };
            const nestedFlowVar = findNestedFlow(classTargetId);
            if (nestedFlowVar) {
              const fullNestedVar = prefix
                ? `${prefix}.${compInst.name}.${nestedFlowVar}`
                : `${compInst.name}.${nestedFlowVar}`;
              let clauseNode: any = elemCst;
              while (clauseNode && clauseNode.type !== "component_clause" && clauseNode.parent) {
                clauseNode = clauseNode.parent;
              }
              dae.diagnostics.push({
                severity: "error",
                code: ModelicaErrorCode.INVALID_TYPE_PREFIX_FLOW_NESTED.code,
                message: ModelicaErrorCode.INVALID_TYPE_PREFIX_FLOW_NESTED.message(fullNestedVar),
                range: {
                  startByte: clauseNode?.startIndex ?? clauseNode?.startByte,
                  endByte: clauseNode?.endIndex ?? clauseNode?.endByte,
                  startPosition: clauseNode?.startPosition,
                  endPosition: clauseNode?.endPosition,
                },
              });
              return;
            }
          }

          // Detect direct or mutually recursive class instantiation cycles via `instantiatingClassIds`
          const instantiatingClassIds: Set<SymbolId> =
            parentMods?.instantiatingClassIds ??
            new Set(flattener.currentRootClassId ? [flattener.currentRootClassId] : []);
          if (classTargetId && instantiatingClassIds.has(classTargetId)) {
            const sym = flattener.db.symbol(elemId);
            const isInherited = flattener.currentClassId != null && sym?.parentId !== flattener.currentClassId;
            if (isInherited && flattener.currentClassId != null) {
              const classCst = flattener.db.cstNode(flattener.currentClassId) as any;
              const rangeObj = classCst
                ? {
                    startByte: classCst.startIndex ?? classCst.startByte,
                    endByte: classCst.endIndex ?? classCst.endByte,
                    startPosition: classCst.startPosition,
                    endPosition: classCst.endPosition,
                  }
                : undefined;
              const rootName = flattener.currentRootClassId
                ? (flattener.db.symbol(flattener.currentRootClassId)?.name ?? "")
                : "";
              const scopeParts = [rootName];
              if (prefix) scopeParts.push(...prefix.split("."));
              const targetClassName = classTarget?.name ?? compInst.typeSpecifier;
              while (scopeParts.length < 255) {
                scopeParts.push(targetClassName);
              }
              const scopeStr = scopeParts.join(".");
              dae.diagnostics.push({
                severity: "error",
                code: ModelicaErrorCode.MAX_RECURSION_DEPTH_EXCEEDED.code,
                message: `The maximum recursion depth of 256 was reached, probably due to mutual recursion. The current scope: ${scopeStr}.`,
                range: rangeObj,
              });
              return;
            }

            let clauseNode: any = elemCst;
            while (clauseNode && clauseNode.type !== "component_clause") {
              clauseNode = clauseNode.parent;
            }
            const rangeObj = clauseNode
              ? {
                  startByte: clauseNode.startIndex ?? clauseNode.startByte,
                  endByte: clauseNode.endIndex ?? clauseNode.endByte,
                }
              : elemCst
                ? { startByte: elemCst.startIndex ?? elemCst.startByte, endByte: elemCst.endIndex ?? elemCst.endByte }
                : undefined;
            const targetClassName = classTarget?.name ?? compInst.typeSpecifier;
            dae.diagnostics.push({
              severity: "error",
              code: ModelicaErrorCode.RECURSIVE_DEFINITION.code,
              message: `Declaration of element ${compInst.name} causes recursive definition of class ${targetClassName}.`,
              range: rangeObj,
            });
            continue;
          }

          if (
            classTargetId &&
            !compInst.isReplaceable &&
            !(
              dae.classKind === "function" &&
              (compInst.causality === "input" || flattener["isFunctionSym"](classTarget))
            ) &&
            flattener.isClassPartial(classTargetId)
          ) {
            const targetCst = flattener.db.cstNode(classTargetId) as any;
            const targetRange = targetCst
              ? {
                  startByte: targetCst.startIndex ?? targetCst.startByte,
                  endByte: targetCst.endIndex ?? targetCst.endByte,
                  startPosition: targetCst.startPosition,
                  endPosition: targetCst.endPosition,
                }
              : undefined;
            let clauseNode: any = elemCst;
            while (clauseNode && clauseNode.type !== "component_clause" && clauseNode.parent) {
              clauseNode = clauseNode.parent;
            }
            const compRange = clauseNode
              ? {
                  startByte: clauseNode.startIndex ?? clauseNode.startByte,
                  endByte: clauseNode.endIndex ?? clauseNode.endByte,
                  startPosition: clauseNode.startPosition,
                  endPosition: clauseNode.endPosition,
                }
              : elemCst
                ? {
                    startByte: elemCst.startIndex ?? elemCst.startByte,
                    endByte: elemCst.endIndex ?? elemCst.endByte,
                    startPosition: elemCst.startPosition,
                    endPosition: elemCst.endPosition,
                  }
                : undefined;

            if (dae.extensionMetadata["isOldFrontend"]) {
              dae.diagnostics.push({
                severity: "error",
                code: ModelicaErrorCode.PARTIAL_INSTANTIATION.code,
                message: ModelicaErrorCode.PARTIAL_INSTANTIATION.message(classTarget?.name ?? compInst.typeSpecifier),
                range: targetRange,
              });
            } else {
              dae.diagnostics.push({
                severity: "notification",
                code: ModelicaErrorCode.NOTIFICATION_FROM_HERE.code,
                message: "From here:",
                range: targetRange,
              });
              dae.diagnostics.push({
                severity: "error",
                code: ModelicaErrorCode.PARTIAL_TYPE_COMPONENT.code,
                message: ModelicaErrorCode.PARTIAL_TYPE_COMPONENT.message(compInst.name, compInst.typeSpecifier),
                range: compRange,
              });
            }
            continue;
          }

          if (dae.classKind === "function" && classTarget && flattener["isFunctionSym"](classTarget)) {
            const fnVarIdx = dae.addVariable(
              dae.interner.intern(name),
              VarType.Real,
              Variability.Continuous,
              compInst.causality === "input" ? Causality.Input : Causality.Local,
              0.0,
            );
            const instIds = flattener.db.query<SymbolId[]>("instantiate", classTarget.id);
            const chs =
              instIds && instIds.length > 0
                ? instIds.map((id) => flattener.db.symbol(id)).filter((s): s is SymbolEntry => Boolean(s))
                : flattener.db.childrenOf(classTarget.id) || [];
            const inParts: string[] = [];
            const outParts: string[] = [];
            for (const ch of chs) {
              if (ch.kind === "Component") {
                const ci = flattener.db.query<ComponentInstanceData>("componentInstance", ch.id);
                const t = ci?.typeSpecifier ?? "Real";
                if (ci?.causality === "input") {
                  inParts.push(`#${t} ${ch.name}`);
                } else if (ci?.causality === "output") {
                  outParts.push(`#${t}`);
                }
              }
            }
            const outStr = outParts.length === 0 ? "()" : outParts.join(", ");
            dae.setVarCustomType(fnVarIdx, `${compInst.name}<function>(${inParts.join(", ")}) => ${outStr}`);
            (state.formalFunctionParams ??= new Map<string, { targetSymId: SymbolId; targetName: string }>()).set(
              name,
              {
                targetSymId: classTarget.id,
                targetName: classTarget.name,
              },
            );
            (state.functionParameterNames ??= new Set<string>()).add(name);
            continue;
          }

          if (classTargetId) {
            const nestedClasses = flattener.db
              .childrenOf(classTargetId)
              .filter((c) => c.kind === "Class" || c.kind === "Package");
            let hasPartialErr = false;
            for (const nc of nestedClasses) {
              const ncCst = flattener.db.cstNode(nc.id) as any;
              const ncText: string = ncCst?.text ?? "";
              const isPartialClass = /^(?:(?:encapsulated|pure|impure)\s+)*partial\b/.test(ncText.trim());
              if (isPartialClass) {
                const isRedeclared = parentMods?.args?.some(
                  (a: any) => a.name === nc.name && (a.kind === "redeclare" || a.isRedeclare),
                );
                if (!isRedeclared) {
                  const ncRange = ncCst
                    ? { startByte: ncCst.startIndex ?? ncCst.startByte, endByte: ncCst.endIndex ?? ncCst.endByte }
                    : undefined;
                  let clauseNode: any = elemCst;
                  while (clauseNode && clauseNode.type !== "component_clause") {
                    clauseNode = clauseNode.parent;
                  }
                  const compRange = clauseNode
                    ? {
                        startByte: clauseNode.startIndex ?? clauseNode.startByte,
                        endByte: clauseNode.endIndex ?? clauseNode.endByte,
                      }
                    : elemCst
                      ? {
                          startByte: elemCst.startIndex ?? elemCst.startByte,
                          endByte: elemCst.endIndex ?? elemCst.endByte,
                        }
                      : undefined;
                  dae.diagnostics.push({
                    severity: "notification",
                    code: ModelicaErrorCode.NOTIFICATION_FROM_HERE.code,
                    message: "From here:",
                    range: ncRange,
                  });
                  const targetClassName = classTarget?.name ?? compInst.typeSpecifier;
                  dae.diagnostics.push({
                    severity: "error",
                    code: ModelicaErrorCode.PARTIAL_TYPE_COMPONENT.code,
                    message: `component ${compInst.name} contains the definition of a partial class ${nc.name}.\nPlease redeclare it to any package compatible with ${targetClassName}.${nc.name}.`,
                    range: compRange,
                  });
                  hasPartialErr = true;
                  break;
                }
              }
            }
            if (hasPartialErr) continue;
          }

          if (classTargetId) {
            const compModsToValidate = [
              ...(compInst.modification?.args ?? []),
              ...(matchingParentArg?.nestedArgs ?? matchingParentArg?.args ?? []),
            ];
            if (compModsToValidate.length > 0) {
              if (!validateClassModifiers(flattener, classTargetId, compModsToValidate, dae)) {
                continue;
              }
            }
          }

          const nextInstantiatingClassIds = new Set(instantiatingClassIds);
          if (classTargetId) nextInstantiatingClassIds.add(classTargetId);

          const isOpRec = Boolean(classTarget && isRecordTarget && flattener.isOperatorRecordSym(classTarget));
          const hasOpRecBinding = Boolean(
            isOpRec &&
            compInst?.modification?.bindingExpression &&
            compInst?.variability !== "parameter" &&
            compInst?.variability !== "constant" &&
            parentMods?.parentVariability !== Variability.Parameter &&
            parentMods?.parentVariability !== Variability.Constant,
          );
          if (hasOpRecBinding) {
            const modChild = elemCst?.children?.find((c: any) => c.type === "modification");
            const findBindingExprNode = (n: any): any => {
              if (!n) return null;
              if (n.type === "expression") return n;
              for (const c of n.children || []) {
                const res = findBindingExprNode(c);
                if (res) return res;
              }
              return null;
            };
            const exprCst = findBindingExprNode(modChild ?? elemCst);
            if (exprCst) {
              const rhsExprId = flattener.lowerExpr(exprCst, dae, prefix);
              if (rhsExprId >= 0) {
                const lhsExprId = dae.addNameExpr(name);
                dae.addEquation(EqKind.Simple, lhsExprId, rhsExprId);
              }
            }
          }
          const subElements = flattener.db.query<SymbolId[]>("instantiate", classTargetId!);
          let pkgScopeId: number | undefined = redeclPkgId ?? parentMods?.packageScopeId;
          if (!redeclPkgId && compInst.typeSpecifier?.includes(".")) {
            const pkgPrefix = compInst.typeSpecifier.split(".")[0]!;
            const searchScopeId = elemParent ?? flattener.currentClassId;
            const pkgSym =
              (searchScopeId
                ? (flattener.db.query<(n: string) => SymbolEntry | null>("resolveName", searchScopeId)?.(pkgPrefix) ??
                  flattener.db.query<(n: string) => SymbolEntry | null>(
                    "resolveSimpleName",
                    searchScopeId,
                  )?.(pkgPrefix))
                : null) ?? flattener.db.byName(pkgPrefix).find((e) => e.kind === "Class" || e.kind === "Package");
            if (pkgSym) {
              let targetPkgId: SymbolId = pkgSym.id;
              const visitedAliases = new Set<SymbolId>();
              while (targetPkgId && !visitedAliases.has(targetPkgId)) {
                visitedAliases.add(targetPkgId);
                const shortCst = flattener.db.cstNode(targetPkgId) as any;
                const specShort = getShortClassSpecifierNode(shortCst);
                if (!specShort) break;
                const basePkg = flattener.db.query<SymbolEntry | null>("resolvedBaseClass", targetPkgId);
                if (basePkg) {
                  targetPkgId = basePkg.id;
                  continue;
                }
                const tName = (
                  Cst.ShortClassSpecifier.typeSpecifier(specShort) ??
                  specShort.children?.find((c: any) => c.type === "type_specifier")
                )?.text?.trim();
                if (tName) {
                  const aliased = flattener.db.byName(tName).find((e) => e.kind === "Class" || e.kind === "Package");
                  if (aliased) {
                    targetPkgId = aliased.id;
                    continue;
                  }
                }
                break;
              }
              pkgScopeId = targetPkgId;
            }
          }
          const classExtendsMods = collectExtendsMods(flattener, classTargetId!);
          const protectedNames = collectProtectedNames(flattener, classTargetId!);
          const targetPrefixes = (classTarget?.metadata as any)?.classPrefixes;
          const isConnector =
            (typeof targetPrefixes === "string" && targetPrefixes.includes("connector")) ||
            (classTarget?.metadata as any)?.classKind === "connector" ||
            Boolean(parentMods?.isConnector);
          const isInterfaceRecord = Boolean(
            isRecordTarget && prefix === "" && (compInst?.causality === "input" || compInst?.causality === "output"),
          );
          const hasNonConnectorParent =
            Boolean(parentMods?.hasNonConnectorParent) || (!isConnector && !isInterfaceRecord);
          const recordCtorArgs: any[] = [];
          let resolvedPkgRecordConst = false;
          let isContinuousRecordCtorEq = false;
          let isContinuousRecordFnEq = false;
          if (isRecordTarget && !hasOpRecBinding) {
            const bText = (
              matchingParentArg?.value?.text ??
              matchingClassArg?.value?.text ??
              compInst.modification?.bindingExpression?.text
            )?.trim();
            const cleanB = bText ? bText.replace(/^=/, "").trim() : "";
            const ctorCallMatch = cleanB ? cleanB.match(/^([a-zA-Z0-9_.$]+)\s*\(([\s\S]*)\)$/) : null;
            if (ctorCallMatch) {
              const ctorName = ctorCallMatch[1]!;
              const targetBaseName = classTarget?.name ?? compInst.typeSpecifier.split(".").pop();
              const origTypeBaseName = compInst.typeSpecifier.split(".").pop();
              const isDirectRecordCtor =
                ctorName === targetBaseName ||
                ctorName.endsWith(`.${targetBaseName}`) ||
                Boolean(
                  redeclArg &&
                  origTypeBaseName &&
                  (ctorName === origTypeBaseName || ctorName.endsWith(`.${origTypeBaseName}`)),
                );
              const derivedRecordSym = !isDirectRecordCtor
                ? (flattener.db
                    .byName(ctorName.split(".").pop()!)
                    .find(
                      (e) =>
                        flattener["isRecordSym"](e) &&
                        (e.name === ctorName || getSymbolQualifiedName(flattener.db, e.id) === ctorName),
                    ) ?? flattener.db.byName(ctorName.split(".").pop()!).find((e) => flattener["isRecordSym"](e)))
                : null;
              if (isDirectRecordCtor || derivedRecordSym) {
                if (derivedRecordSym) {
                  flattener.usedRecordSymIds?.add(derivedRecordSym.id);
                  if (derivedRecordSym.name) flattener.usedRecordNames?.add(derivedRecordSym.name);
                  flattener.usedRecordNames?.add(ctorName);
                  const derivedExtMods = collectExtendsMods(flattener, derivedRecordSym.id);
                  for (const dm of derivedExtMods) {
                    if (dm.name && dm.value) {
                      recordCtorArgs.push({ name: dm.name, value: dm.value });
                    }
                  }
                }
                const rawArgs = splitTopLevelArgs(ctorCallMatch[2]!);
                const subSyms = subElements
                  .map((id) => flattener.db.symbol(id))
                  .filter(
                    (s) =>
                      s &&
                      s.kind === "Component" &&
                      !flattener["isCstNodeProtected"](flattener.db.cstNode(s.id)) &&
                      (s.metadata as any)?.variability !== "constant",
                  );
                for (let aIdx = 0; aIdx < rawArgs.length; aIdx++) {
                  const argStr = rawArgs[aIdx]!;
                  const eqIdx = argStr.indexOf("=");
                  if (eqIdx > 0 && !argStr.slice(0, eqIdx).includes("(") && !argStr.slice(0, eqIdx).includes("[")) {
                    const fName = argStr.slice(0, eqIdx).trim();
                    const fVal = argStr.slice(eqIdx + 1).trim();
                    recordCtorArgs.push({ name: fName, value: { kind: "expression", text: fVal } });
                  } else if (subSyms[aIdx]) {
                    const fName = subSyms[aIdx]!.name;
                    recordCtorArgs.push({ name: fName, value: { kind: "expression", text: argStr } });
                  }
                }
                if (
                  isDirectRecordCtor &&
                  !matchingParentArg?.value &&
                  !matchingClassArg?.value &&
                  compInst.modification?.bindingExpression &&
                  compInst.variability !== "parameter" &&
                  compInst.variability !== "constant" &&
                  parentMods?.parentVariability !== Variability.Parameter &&
                  parentMods?.parentVariability !== Variability.Constant &&
                  dae.classKind !== "function" &&
                  (!compInst.arrayDimensions || compInst.arrayDimensions.length === 0) &&
                  subSyms.length > 0 &&
                  subSyms.every((s) => {
                    const ci = flattener.db.query<ComponentInstanceData>("componentInstance", s!.id);
                    return ci?.variability !== "parameter" && ci?.variability !== "constant";
                  }) &&
                  recordCtorArgs.some((a) => /\btime\b/.test(a.value?.text ?? ""))
                ) {
                  isContinuousRecordCtorEq = true;
                }
                if (!isContinuousRecordCtorEq && flattener.generateRecordConstructorFor) {
                  const targetSymForCtor = derivedRecordSym ?? classTarget;
                  const ctorFn =
                    dae.getFunction(ctorName) ??
                    (targetSymForCtor
                      ? flattener.generateRecordConstructorFor(targetSymForCtor, dae, flattener.currentRootClassId)
                      : null);
                  if (ctorFn) {
                    const providedNames = new Set(recordCtorArgs.map((a) => a.name).filter(Boolean));
                    let hasDependentDefault = false;
                    for (let vi = 0; vi < ctorFn.varCount; vi++) {
                      if (ctorFn.getVarCausality(vi) === Causality.Input && !providedNames.has(ctorFn.getVarName(vi))) {
                        const defId = ctorFn.getVarExpression(vi);
                        if (defId !== undefined && defId >= 0) {
                          const k = ctorFn.getExprKind(defId);
                          if (
                            k !== ExprKind.IntLiteral &&
                            k !== ExprKind.RealLiteral &&
                            k !== ExprKind.BoolLiteral &&
                            k !== ExprKind.StringLiteral
                          ) {
                            hasDependentDefault = true;
                            break;
                          }
                        }
                      }
                    }
                    if (hasDependentDefault) {
                      const evalArgs: any[] = [];
                      const namedEvalArgs: { name: string; value: any }[] = [];
                      let canEvalAll = true;
                      for (const rArg of recordCtorArgs) {
                        const txt = rArg.value?.text?.trim() ?? "";
                        const num = Number(txt);
                        if (!isNaN(num) && txt !== "") {
                          namedEvalArgs.push({ name: rArg.name, value: num });
                        } else if (txt === "true" || txt === "false") {
                          namedEvalArgs.push({ name: rArg.name, value: txt === "true" });
                        } else {
                          canEvalAll = false;
                          break;
                        }
                      }
                      if (canEvalAll && ctorFn.name) {
                        try {
                          const fnInternId = dae.interner.intern(ctorFn.name);
                          const res = (evaluateArenaFunctionCall as any)(
                            dae,
                            fnInternId,
                            evalArgs,
                            flattener.db,
                            targetSymForCtor!.id,
                            namedEvalArgs,
                          );
                          if (Array.isArray(res) && res.length === subSyms.length) {
                            for (let aIdx = 0; aIdx < res.length; aIdx++) {
                              const fName = subSyms[aIdx]!.name;
                              if (!providedNames.has(fName)) {
                                const val = res[aIdx];
                                const isInt = isIntegerTypeSpec(
                                  flattener.db.query("typeSpecifier", subSyms[aIdx]!.id),
                                  flattener.db,
                                );
                                const fVal =
                                  typeof val === "number"
                                    ? Number.isInteger(val) && !isInt
                                      ? `${val}.0`
                                      : String(val)
                                    : String(val);
                                recordCtorArgs.push({
                                  name: fName,
                                  value: { kind: "literal", value: val, text: fVal },
                                  isRecordCtorDefault: true,
                                } as any);
                              }
                            }
                          }
                        } catch (_) {}
                      }
                    }
                  }
                }
              } else {
                const ctorShortName = ctorName.includes(".") ? ctorName.split(".").pop()! : ctorName;
                const fnCandidates = flattener.db.byName(ctorShortName).filter((e) => flattener["isFunctionSym"](e));
                const isNonPartialFn = (e: SymbolEntry) => {
                  const txt = (flattener.db.cstNode(e.id) as any)?.text?.trimStart() ?? "";
                  return !/^partial\s+function\b/.test(txt);
                };
                const pkgScopeForFn = redeclPkgId ?? parentMods?.packageScopeId;
                const ctorPkgPrefix = pkgScopeForFn
                  ? extractReplaceablePackagePrefix(
                      ctorName,
                      flattener,
                      dae,
                      redeclPkgPrefix,
                      parentMods,
                      classTargetId,
                    )
                  : null;
                let matchingFnSym: SymbolEntry | undefined;
                if (pkgScopeForFn && ctorPkgPrefix) {
                  const resolvedInPkg =
                    flattener.db.query<any>("resolveSimpleName", pkgScopeForFn)?.(ctorShortName) ??
                    flattener.db.query<any>("resolveName", pkgScopeForFn)?.(ctorShortName);
                  if (resolvedInPkg && flattener["isFunctionSym"](resolvedInPkg) && isNonPartialFn(resolvedInPkg)) {
                    matchingFnSym = resolvedInPkg;
                  }
                }
                if (!matchingFnSym) {
                  const matchingByQn = ctorName.includes(".")
                    ? fnCandidates.filter((e) => {
                        const qn = getSymbolQualifiedName(flattener.db, e.id);
                        return qn === ctorName || qn.endsWith(`.${ctorName}`);
                      })
                    : [];
                  matchingFnSym =
                    matchingByQn.find(isNonPartialFn) ??
                    matchingByQn[0] ??
                    fnCandidates.find(isNonPartialFn) ??
                    fnCandidates[0];
                }
                if (matchingFnSym) {
                  const parseConstArg = (s: string): any => {
                    const t = s.trim();
                    const n = Number(t);
                    if (!isNaN(n) && t !== "") return n;
                    if (t === "true") return true;
                    if (t === "false") return false;
                    const zMatch = /^zeros\s*\(\s*(\d+)\s*\)$/.exec(t);
                    if (zMatch) return new Array(Number(zMatch[1])).fill(0);
                    if (t.startsWith("{") && t.endsWith("}")) {
                      const elems = parseArrayLiteralElements(t);
                      const parsed = elems.map(parseConstArg);
                      return parsed.every((p) => p !== null) ? parsed : null;
                    }
                    const sliceMatch = /^(.+)\[([^:\]]+):([^\]]+)\]$/.exec(t);
                    if (sliceMatch) {
                      const startIdx = parseConstArg(sliceMatch[2]!);
                      const stopIdx = parseConstArg(sliceMatch[3]!);
                      if (typeof startIdx === "number" && typeof stopIdx === "number") {
                        if (startIdx > stopIdx) return [];
                        const baseArr = parseConstArg(sliceMatch[1]!);
                        if (Array.isArray(baseArr)) {
                          return baseArr.slice(startIdx - 1, stopIdx);
                        }
                      }
                    }
                    const scopedAp = prefix ? `${prefix}.${t}` : t;
                    let vIdx = dae.lookupVariable(scopedAp);
                    if (vIdx < 0) vIdx = dae.lookupVariable(t);
                    if (vIdx >= 0) {
                      const sv = dae.getVarExpression(vIdx);
                      const val = sv !== undefined && sv >= 0 ? evalDaeExpr(sv, dae) : dae.getVarStartValue(vIdx);
                      return val !== null && val !== undefined ? val : null;
                    }
                    const arrBase = dae.hasArrayElements(scopedAp) ? scopedAp : dae.hasArrayElements(t) ? t : null;
                    if (arrBase) {
                      const elemIndices = dae.getArrayElementIndices(arrBase);
                      if (elemIndices && elemIndices.length > 0) {
                        const vals: number[] = [];
                        for (const eIdx of elemIndices) {
                          const sv = dae.getVarExpression(eIdx);
                          const val = sv !== undefined && sv >= 0 ? evalDaeExpr(sv, dae) : dae.getVarStartValue(eIdx);
                          if (val === null || val === undefined) return null;
                          vals.push(val);
                        }
                        return vals;
                      }
                    }
                    const tPkgPrefix = pkgScopeForFn
                      ? extractReplaceablePackagePrefix(t, flattener, dae, redeclPkgPrefix, parentMods, classTargetId)
                      : null;
                    const strippedPkgT = pkgScopeForFn && tPkgPrefix ? t.slice(tPkgPrefix.length + 1) : t;
                    const dbConst =
                      (pkgScopeForFn ? lookupDbConstant(strippedPkgT, flattener.db, pkgScopeForFn) : null) ??
                      lookupDbConstant(t, flattener.db, pkgScopeForFn ?? flattener.currentClassId);
                    if (dbConst !== null && dbConst.value !== undefined) {
                      return dbConst.value;
                    }
                    if (pkgScopeForFn) {
                      const ev = flattener.db.evaluate(strippedPkgT, pkgScopeForFn);
                      if (typeof ev === "number" || typeof ev === "boolean" || Array.isArray(ev)) {
                        return ev;
                      }
                    }
                    return null;
                  };
                  const rawArgs = splitTopLevelArgs(ctorCallMatch[2]!);
                  const hasNamedArg = rawArgs.some((a) => /^[a-zA-Z_]\w*\s*=[^=]/.test(a.trim()));
                  const prelimEvalArgs = !hasNamedArg ? rawArgs.map(parseConstArg) : null;
                  if (
                    prelimEvalArgs &&
                    !prelimEvalArgs.every((a) => a !== null) &&
                    !matchingParentArg?.value &&
                    !matchingClassArg?.value &&
                    compInst.modification?.bindingExpression &&
                    compInst.variability !== "parameter" &&
                    compInst.variability !== "constant" &&
                    parentMods?.parentVariability !== Variability.Parameter &&
                    parentMods?.parentVariability !== Variability.Constant &&
                    dae.classKind !== "function" &&
                    (!compInst.arrayDimensions || compInst.arrayDimensions.length === 0)
                  ) {
                    resolvedPkgRecordConst = true;
                    isContinuousRecordFnEq = true;
                  } else {
                    const specPkgPrefix =
                      pkgScopeForFn && ctorPkgPrefix
                        ? (() => {
                            const ownerClsId =
                              parentMods?.currentClassId ?? parentMods?.ownerClassId ?? flattener.currentClassId;
                            const ownerQual = ownerClsId ? getSymbolQualifiedName(flattener.db, ownerClsId) : "";
                            if (!ownerQual) return null;
                            return prefix
                              ? `${ownerQual}$${prefix.replace(/\./g, "$")}.${ctorPkgPrefix}`
                              : `${ownerQual}.${ctorPkgPrefix}`;
                          })()
                        : null;
                    if (classTarget && flattener.generateRecordConstructorFor) {
                      (flattener.generateRecordConstructorFor as any)(
                        classTarget,
                        dae,
                        flattener.currentRootClassId,
                        specPkgPrefix ? `${specPkgPrefix}.${classTarget.name}` : undefined,
                      );
                    }
                    const qualFnName = specPkgPrefix
                      ? `${specPkgPrefix}.${ctorShortName}`
                      : getSymbolQualifiedName(flattener.db, matchingFnSym.id);
                    let fn = dae.getFunction(qualFnName) ?? (!specPkgPrefix ? dae.getFunction(ctorName) : undefined);
                    if (!fn) {
                      const prevSpecPrefix = (flattener as any).currentFunctionSpecializedPrefix;
                      const prevCompPrefix = (flattener as any).currentFunctionComponentPrefix;
                      if (specPkgPrefix) {
                        (flattener as any).currentFunctionSpecializedPrefix = specPkgPrefix;
                        (flattener as any).currentFunctionComponentPrefix = prefix || undefined;
                      }
                      try {
                        fn = flattener.flattenFunction(
                          matchingFnSym.id,
                          qualFnName,
                          undefined,
                          dae,
                          specPkgPrefix ? pkgScopeForFn : undefined,
                        );
                      } finally {
                        (flattener as any).currentFunctionSpecializedPrefix = prevSpecPrefix;
                        (flattener as any).currentFunctionComponentPrefix = prevCompPrefix;
                      }
                      dae.addFunction(qualFnName, fn);
                      if (!specPkgPrefix) {
                        dae.addFunction(ctorName, fn);
                      }
                    }
                    if (fn) {
                      (fn as any).wasCalled = true;
                      flattener.calledFunctionSymIds?.add(matchingFnSym.id);
                      for (const [nName, nFn] of fn.functions?.entries() ?? []) {
                        (nFn as any).wasCalled = true;
                        if ((nFn as any).symId) flattener.calledFunctionSymIds?.add((nFn as any).symId);
                        dae.addFunction(nName, nFn);
                      }
                    }
                    if (fn && fn.diagnostics.some((d: any) => d.severity === "error")) {
                      flattener.failedFunctionIds?.add(matchingFnSym.id);
                      flattener.invalidInterfaceFunctionIds?.add(matchingFnSym.id);
                      if (dae.extensionMetadata?.["isOldFrontend"]) {
                        const scopeName =
                          (flattener.currentRootClassId
                            ? flattener.db.symbol(flattener.currentRootClassId)?.name
                            : "") ?? "";
                        let compClauseNode: any = elemCst;
                        while (compClauseNode && compClauseNode.type !== "component_clause") {
                          compClauseNode = compClauseNode.parent;
                        }
                        const callRange = compClauseNode
                          ? {
                              startPosition: compClauseNode.startPosition,
                              endPosition: compClauseNode.endPosition,
                            }
                          : undefined;
                        dae.diagnostics.push({
                          severity: "error",
                          code: ModelicaErrorCode.CLASS_NOT_FOUND.code,
                          message: ModelicaErrorCode.CLASS_NOT_FOUND.message(ctorName, scopeName),
                          range: callRange,
                        });
                      }
                    }
                    let evalArgs: any[];
                    if (hasNamedArg && fn) {
                      const inputNames: string[] = [];
                      const inputDefaults = new Map<string, any>();
                      for (let vi = 0; vi < fn.varCount; vi++) {
                        if (fn.isVarRemoved(vi)) continue;
                        if (fn.getVarCausality(vi) === Causality.Input) {
                          const vName = fn.getVarName(vi).replace(/\[.*\]$/, "");
                          if (!inputNames.includes(vName)) {
                            inputNames.push(vName);
                            const vExpr = fn.getVarExpression(vi);
                            if (vExpr !== undefined && vExpr >= 0) {
                              const dVal = evalDaeExpr(vExpr, fn);
                              if (dVal !== null && dVal !== undefined) inputDefaults.set(vName, dVal);
                            } else if (fn.hasExplicitVarExpression(vi)) {
                              inputDefaults.set(vName, fn.getVarStartValue(vi));
                            }
                          }
                        }
                      }
                      const byName = new Map<string, any>();
                      let posIdx = 0;
                      for (const ra of rawArgs) {
                        const nmMatch = /^([a-zA-Z_]\w*)\s*=([^=].*)$/s.exec(ra.trim());
                        if (nmMatch) {
                          byName.set(nmMatch[1]!, parseConstArg(nmMatch[2]!));
                        } else {
                          if (posIdx < inputNames.length) {
                            byName.set(inputNames[posIdx]!, parseConstArg(ra));
                          }
                          posIdx++;
                        }
                      }
                      evalArgs = inputNames.map((inName) =>
                        byName.has(inName) ? byName.get(inName) : (inputDefaults.get(inName) ?? null),
                      );
                    } else {
                      evalArgs = prelimEvalArgs ?? rawArgs.map(parseConstArg);
                    }
                    if (evalArgs.every((a) => a !== null)) {
                      const fnInternId = dae.interner.intern(qualFnName);
                      let res: any = null;
                      try {
                        res = evaluateArenaFunctionCall(dae, fnInternId, evalArgs, flattener.db, matchingFnSym.id);
                        if (res === null) {
                          const shortInternId = dae.interner.intern(ctorName);
                          res = evaluateArenaFunctionCall(dae, shortInternId, evalArgs, flattener.db, matchingFnSym.id);
                        }
                      } catch (_) {}
                      if (res !== null) {
                        const formatEvalVal = (v: any, isInt: boolean): string => {
                          if (Array.isArray(v)) {
                            return `{${v.map((item) => formatEvalVal(item, isInt)).join(", ")}}`;
                          }
                          if (typeof v === "number") {
                            const cleanV = Math.abs(v) === 0 ? 0 : v;
                            return Number.isInteger(cleanV) && !isInt ? `${cleanV}.0` : String(cleanV);
                          }
                          return String(v);
                        };
                        const subSyms = subElements
                          .map((id) => flattener.db.symbol(id))
                          .filter(
                            (s) =>
                              s &&
                              s.kind === "Component" &&
                              !flattener["isCstNodeProtected"](flattener.db.cstNode(s.id)) &&
                              (s.metadata as any)?.variability !== "constant",
                          );
                        if (Array.isArray(res) && res.length === subSyms.length) {
                          for (let aIdx = 0; aIdx < res.length; aIdx++) {
                            const fName = subSyms[aIdx]!.name;
                            const val = res[aIdx];
                            const isInt = isIntegerTypeSpec(
                              flattener.db.query("typeSpecifier", subSyms[aIdx]!.id),
                              flattener.db,
                            );
                            const fVal = formatEvalVal(val, isInt);
                            recordCtorArgs.push({
                              name: fName,
                              isRecordCtorArg: true,
                              value: {
                                kind: Array.isArray(val) ? "expression" : "literal",
                                value: Array.isArray(val) ? undefined : val,
                                text: fVal,
                              },
                            });
                          }
                          resolvedPkgRecordConst = true;
                        } else if (typeof res === "number" && subSyms.length === 1) {
                          const fName = subSyms[0]!.name;
                          const isInt = isIntegerTypeSpec(
                            flattener.db.query("typeSpecifier", subSyms[0]!.id),
                            flattener.db,
                          );
                          const fVal = formatEvalVal(res, isInt);
                          recordCtorArgs.push({
                            name: fName,
                            isRecordCtorArg: true,
                            value: { kind: "literal", value: res, text: fVal },
                          });
                          resolvedPkgRecordConst = true;
                        }
                      }
                    }
                  }
                }
              }
            } else if (cleanB && /^[a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)+$/.test(cleanB)) {
              const leafName = cleanB.split(".").pop()!;
              const pkgComp = flattener.db
                .byName(leafName)
                .find((e) => e.kind === "Component" && getSymbolQualifiedName(flattener.db, e.id) === cleanB);
              if (pkgComp) {
                const pkgCompInst = flattener.db.query<ComponentInstanceData>("componentInstance", pkgComp.id);
                if (pkgCompInst?.modification?.args && pkgCompInst.modification.args.length > 0) {
                  recordCtorArgs.push(...pkgCompInst.modification.args);
                  resolvedPkgRecordConst = true;
                } else if (pkgCompInst?.modification?.bindingExpression?.text) {
                  const pkgBText = pkgCompInst.modification.bindingExpression.text.trim().replace(/^=/, "").trim();
                  const pkgCtorMatch = pkgBText.match(/^([a-zA-Z0-9_.$]+)\s*\(([\s\S]*)\)$/);
                  if (pkgCtorMatch) {
                    const pkgCtorName = pkgCtorMatch[1]!;
                    const pkgCtorSym = flattener.db
                      .byName(pkgCtorName.split(".").pop()!)
                      .find((e) => flattener["isRecordSym"](e));
                    if (pkgCtorSym && flattener.generateRecordConstructorFor) {
                      const pkgScopeId = pkgComp.parentId ?? flattener.currentRootClassId;
                      flattener.generateRecordConstructorFor(pkgCtorSym, dae, pkgScopeId);
                    }
                    const rawArgs = splitTopLevelArgs(pkgCtorMatch[2]!);
                    const subSyms = subElements
                      .map((id) => flattener.db.symbol(id))
                      .filter(
                        (s) =>
                          s &&
                          s.kind === "Component" &&
                          !flattener["isCstNodeProtected"](flattener.db.cstNode(s.id)) &&
                          (s.metadata as any)?.variability !== "constant",
                      );
                    for (let aIdx = 0; aIdx < rawArgs.length; aIdx++) {
                      const argStr = rawArgs[aIdx]!;
                      const eqIdx = argStr.indexOf("=");
                      if (eqIdx > 0 && !argStr.slice(0, eqIdx).includes("(") && !argStr.slice(0, eqIdx).includes("[")) {
                        const fName = argStr.slice(0, eqIdx).trim();
                        const fVal = argStr.slice(eqIdx + 1).trim();
                        recordCtorArgs.push({ name: fName, value: { kind: "expression", text: fVal } });
                      } else if (subSyms[aIdx]) {
                        const fName = subSyms[aIdx]!.name;
                        recordCtorArgs.push({ name: fName, value: { kind: "expression", text: argStr } });
                      }
                    }
                    resolvedPkgRecordConst = true;
                  }
                }
              }
            }
          }

          const isRecordVarRef =
            !resolvedPkgRecordConst &&
            parentMods?.bindingExpression?.text &&
            /^[a-zA-Z_]\w*(?:\[\d+(?:,\d+)*\])?(?:\.[a-zA-Z_]\w*(?:\[\d+(?:,\d+)*\])?)*$/.test(
              parentMods.bindingExpression.text.trim(),
            );
          const parentBoundRecordField = isRecordVarRef
            ? { kind: "expression", text: `${parentMods.bindingExpression.text.trim()}.${compInst.name}` }
            : null;

          const bindingScope = matchingParentArg?.value
            ? prefix.includes(".")
              ? prefix.split(".").slice(0, -1).join(".")
              : ""
            : (parentMods?.bindingScope ?? prefix);

          let compClauseNode: any = elemCst;
          while (compClauseNode && compClauseNode.type !== "component_clause") {
            compClauseNode = compClauseNode.parent;
          }
          const compClauseRange = compClauseNode
            ? {
                startByte: compClauseNode.startIndex ?? compClauseNode.startByte,
                endByte: compClauseNode.endIndex ?? compClauseNode.endByte,
                startPosition: compClauseNode.startPosition,
                endPosition: compClauseNode.endPosition,
              }
            : elemCst
              ? {
                  startByte: elemCst.startIndex ?? elemCst.startByte,
                  endByte: elemCst.endIndex ?? elemCst.endByte,
                  startPosition: elemCst.startPosition,
                  endPosition: elemCst.endPosition,
                }
              : undefined;

          if (compClauseRange) {
            state.currentCompClauseRange = compClauseRange;
          }

          // Tag local component modifiers with their lexical `evaluationScopeId` so relative name
          // references inside modifier expressions resolve in the declaring component's scope.
          const resolveChainedRedecl = (arg: any, fallbackScopeId: number | undefined, extraMods?: any[]): any => {
            let effRedeclSpec = arg.redeclaredTypeSpecifier;
            let effEvalScopeId = arg.evaluationScopeId ?? fallbackScopeId;
            let effOwnerClassId = arg.ownerClassId;
            if ((arg.isRedeclaration || effRedeclSpec) && effRedeclSpec) {
              const visitedRedecl = new Set<string>();
              while (effRedeclSpec && !effRedeclSpec.includes(".") && !visitedRedecl.has(effRedeclSpec)) {
                visitedRedecl.add(effRedeclSpec);
                const outerRedecl =
                  extraMods
                    ?.slice()
                    .reverse()
                    .find(
                      (pa: any) =>
                        pa !== arg &&
                        !pa.isBreak &&
                        (pa.isRedeclaration || pa.redeclaredTypeSpecifier) &&
                        pa.name === effRedeclSpec &&
                        pa.redeclaredTypeSpecifier &&
                        (pa.redeclaredTypeSpecifier !== pa.name ||
                          (pa.evaluationScopeId !== undefined && pa.evaluationScopeId !== effEvalScopeId) ||
                          (pa.ownerClassId !== undefined && pa.ownerClassId !== effOwnerClassId)),
                    ) ??
                  parentMods?.args
                    ?.slice()
                    .reverse()
                    .find(
                      (pa: any) =>
                        !pa.isBreak &&
                        (pa.isRedeclaration || pa.redeclaredTypeSpecifier) &&
                        pa.name === effRedeclSpec &&
                        pa.redeclaredTypeSpecifier &&
                        (pa.redeclaredTypeSpecifier !== pa.name ||
                          (pa.evaluationScopeId !== undefined && pa.evaluationScopeId !== effEvalScopeId) ||
                          (pa.ownerClassId !== undefined && pa.ownerClassId !== effOwnerClassId)),
                    );
                if (outerRedecl?.redeclaredTypeSpecifier) {
                  effRedeclSpec = outerRedecl.redeclaredTypeSpecifier;
                  effEvalScopeId = outerRedecl.evaluationScopeId ?? outerRedecl.ownerClassId ?? effEvalScopeId;
                  effOwnerClassId = outerRedecl.ownerClassId ?? effOwnerClassId;
                } else {
                  break;
                }
              }
              if (!effRedeclSpec.includes(".") && flattener.currentClassId) {
                const localSym: SymbolEntry | null | undefined =
                  flattener.db.query<(n: string) => SymbolEntry | null>(
                    "resolveName",
                    flattener.currentClassId,
                  )?.(effRedeclSpec) ??
                  flattener.db.query<(n: string) => SymbolEntry | null>(
                    "resolveSimpleName",
                    flattener.currentClassId,
                  )?.(effRedeclSpec);
                if (localSym && (localSym.kind === "Class" || localSym.kind === "Package")) {
                  let curSym: SymbolEntry | null = localSym;
                  const visitedAliases = new Set<SymbolId>();
                  while (curSym && !visitedAliases.has(curSym.id)) {
                    visitedAliases.add(curSym.id);
                    const curCst = flattener.db.cstNode(curSym.id) as any;
                    if (!getShortClassSpecifierNode(curCst)) break;
                    if (
                      flattener.db.query<boolean>("isReplaceable", curSym.id) ||
                      curCst?.parent?.type === "element_replaceable"
                    ) {
                      break;
                    }
                    if (flattener.db.query<any>("effectiveModification", curSym.id)) break;
                    if (
                      String((curSym.metadata as any)?.classKind ?? (curSym.metadata as any)?.classPrefixes ?? "")
                        .toLowerCase()
                        .includes("type")
                    ) {
                      break;
                    }
                    const nextBase: SymbolEntry | null = flattener.db.query<SymbolEntry | null>(
                      "resolvedBaseClass",
                      curSym.id,
                    );
                    if (nextBase && !(nextBase.metadata as any)?.isPredefined) curSym = nextBase;
                    else break;
                  }
                  if (curSym && curSym.id !== localSym.id) {
                    effRedeclSpec = getSymbolQualifiedName(flattener.db, curSym.id) || curSym.name;
                  }
                }
              }
            }
            return {
              ...arg,
              redeclaredTypeSpecifier: effRedeclSpec,
              evaluationScopeId: effEvalScopeId,
              ...(effOwnerClassId !== undefined ? { ownerClassId: effOwnerClassId } : {}),
            };
          };

          const tagEvalScope = (args: any[] | undefined, scopeId: number | undefined): any[] => {
            if (!args || !scopeId) return args || [];
            return args.map((a) => {
              const resolvedA = resolveChainedRedecl(a, scopeId);
              const effScopeId = resolvedA.evaluationScopeId ?? scopeId;
              return {
                ...resolvedA,
                value: a.value ? { ...a.value, evaluationScopeId: a.value.evaluationScopeId ?? effScopeId } : a.value,
                nestedArgs: a.nestedArgs ? tagEvalScope(a.nestedArgs, effScopeId) : a.nestedArgs,
                args: a.args ? tagEvalScope(a.args, effScopeId) : a.args,
              };
            });
          };

          // Merge hierarchical modifications in precedence order (inner/default -> outer/override):
          //   1. Base `extends` class modifications (`classExtendsMods`)
          //   2. Class-level type modifications (`matchingClassArg`)
          //   3. Component declaration modifications (`compInst.modification.args`)
          //   4. Outer instance modifications passed down via `parentMods` (`matchingParentArg`)
          //   5. Record constructor positional/named arguments (`recordCtorArgs`)
          const rawSubModArgs = [
            ...classExtendsMods.map((m: any) => ({
              ...m,
              originPrefix: m.originPrefix ?? name,
              ownerClassId: m.ownerClassId ?? classTargetId,
            })),
            ...(matchingClassArg?.nestedArgs || matchingClassArg?.args || []),
            ...tagEvalScope(compInst.modification?.args, elemId).map((m: any) => ({
              ...m,
              originPrefix: m.originPrefix ?? prefix,
              ownerClassId: m.ownerClassId ?? flattener.currentClassId ?? elemSym?.parentId,
            })),
            ...(parentMods?.args
              ?.filter((a: any) => !a.isBreak && a.name === compInst.name)
              .flatMap((a: any) =>
                (a.nestedArgs || a.args || []).map((na: any) => ({
                  ...na,
                  ...(a.isExtendsMod ? { isExtendsMod: true, isFromParentExtends: true } : {}),
                  originPrefix: na.originPrefix ?? a.originPrefix ?? prefix,
                  ownerClassId: na.ownerClassId ?? a.ownerClassId ?? parentMods?.ownerClassId,
                })),
              ) || []),
            ...recordCtorArgs,
          ];
          const resolvedSubModArgs = rawSubModArgs.map((a) =>
            (a.isRedeclaration || a.redeclaredTypeSpecifier) && a.redeclaredTypeSpecifier
              ? resolveChainedRedecl(a, a.evaluationScopeId, rawSubModArgs)
              : a,
          );
          const effectiveSubMod = {
            args: resolvedSubModArgs,
            suppressDefaultBindings: isContinuousRecordCtorEq,
            instantiatingClassIds: nextInstantiatingClassIds,
            componentClauseRange: compClauseRange ?? parentMods?.componentClauseRange,
            currentClassId: classTargetId ?? flattener.currentClassId,
            bindingExpression:
              hasOpRecBinding || resolvedPkgRecordConst || isContinuousRecordCtorEq
                ? null
                : (matchingParentArg?.value ??
                  matchingClassArg?.value ??
                  parentBoundRecordField ??
                  compInst.modification?.bindingExpression),
            isProtected: isElemProtected,
            protectedNames,
            packageScopeId: pkgScopeId,
            specializedPkgPrefix: compSpecPkgPrefix,
            isConnector,
            hasNonConnectorParent,
            bindingScope,
            isRecord: Boolean(isRecordTarget || parentMods?.isRecord),
            parentVariability:
              compInst?.variability === "parameter"
                ? Variability.Parameter
                : compInst?.variability === "constant"
                  ? Variability.Constant
                  : compInst?.variability === "discrete"
                    ? Variability.Discrete
                    : parentMods?.parentVariability,
            parentCausality:
              compInst?.causality === "input"
                ? Causality.Input
                : compInst?.causality === "output"
                  ? Causality.Output
                  : parentMods?.parentCausality,
            parentFlowPrefix:
              parentMods?.isConnector || (!flattener.isOldFrontend && !dae.extensionMetadata?.["isOldFrontend"])
                ? ((compInst?.flowPrefix && compInst.flowPrefix !== "unspecified" ? compInst.flowPrefix : undefined) ??
                  ((meta as any)?.flowPrefix && (meta as any).flowPrefix !== "unspecified"
                    ? (meta as any).flowPrefix
                    : undefined) ??
                  parentMods?.parentFlowPrefix)
                : undefined,
            isFinal: compInst?.isFinal || (meta as any)?.isFinal || parentMods?.isFinal,
          };
          const childEnvPtr = wasmEnv ? wasmEnv.lookupNested(dae.interner.intern(compInst.name)) : 0;
          if (childEnvPtr !== 0) {
            (effectiveSubMod as any).wasmEnv = new ModelicaModificationEnv(dae.exports, childEnvPtr);
          }
          let arrayDims = compInst?.arrayDimensions;
          const rawCompDims =
            arrayDims && arrayDims.length > 0 ? flattener.db.query<any[] | null>("arrayDimensions", elemId) : null;
          if (arrayDims && (arrayDims.some((d) => d <= 0) || rawCompDims?.some((d: any) => d?.kind === "expression"))) {
            const rawDims = rawCompDims;
            let dimNames: string[] = [];
            if (rawDims && rawDims.length === arrayDims.length) {
              dimNames = rawDims.map((d: any) => d?.text?.trim() ?? "");
            }
            if (dimNames.length === 0 && elemCst) {
              const match = /\[([a-zA-Z_]\w*)\]/.exec(elemCst.text ?? "");
              if (match) {
                dimNames = [match[1]!];
              }
            }
            const resolvedDims = [...arrayDims];
            for (let i = 0; i < resolvedDims.length; i++) {
              if (resolvedDims[i]! <= 0 || rawDims?.[i]?.kind === "expression") {
                const dimName = dimNames[i];
                if ((rawDims?.[i]?.kind === "flexible" || dimName === ":") && resolvedDims[i]! <= 0) {
                  for (const rArg of recordCtorArgs) {
                    const txt = rArg.value?.text?.trim() ?? "";
                    if (txt.startsWith("{") && txt.endsWith("}")) {
                      const items = splitTopLevelArgs(txt.slice(1, -1));
                      if (items.length > 0) {
                        resolvedDims[i] = items.length;
                        break;
                      }
                    }
                  }
                }
                if (dimName && dimName !== ":") {
                  const prefixedDim = prefix ? `${prefix}.${dimName}` : dimName;
                  let varIdx = dae.getVarIdxByName(prefixedDim);
                  if (varIdx < 0) varIdx = dae.getVarIdxByName(dimName);
                  let evalVal: any = null;
                  if (varIdx >= 0) {
                    const exprId = dae.getVarExpression(varIdx);
                    if (exprId !== undefined) evalVal = evalDaeExpr(exprId, dae);
                  }
                  if (typeof evalVal !== "number" || evalVal < 0) {
                    const arg = parentMods?.args?.find((a: any) => a.name === dimName);
                    if (arg?.value) {
                      if (arg.value.kind === "literal" && typeof arg.value.value === "number") {
                        evalVal = arg.value.value;
                      } else if (arg.value.kind === "expression" && arg.value.text) {
                        const num = Number(arg.value.text.trim());
                        if (!isNaN(num)) evalVal = num;
                      }
                    }
                  }
                  if (typeof evalVal !== "number" || evalVal < 0) {
                    evalVal = evaluateCSTNumber(
                      dimName,
                      undefined,
                      flattener.currentClassId ?? undefined,
                      flattener.db,
                      dae,
                      prefix,
                    );
                  }
                  if (typeof evalVal === "number" && evalVal >= 0) {
                    resolvedDims[i] = evalVal;
                  } else if (flattener.options.omcCompatibility) {
                    const sizeMatch = dimName.match(/^size\s*\(\s*([a-zA-Z_]\w*)\s*,\s*(\d+)\s*\)$/);
                    if (sizeMatch) {
                      const targetVarName = sizeMatch[1]!;
                      const targetDimIdx = sizeMatch[2]!;
                      const targetElemSym = flattener.currentRootClassId
                        ? flattener.db
                            .childrenOf(flattener.currentRootClassId)
                            ?.find((c) => c.name === targetVarName && c.kind === "Component")
                        : null;
                      if (targetElemSym) {
                        const targetCompInst = flattener.db.query<ComponentInstanceData>(
                          "componentInstance",
                          targetElemSym.id,
                        );
                        const targetRawDims = flattener.db.query<any[] | null>("arrayDimensions", targetElemSym.id);
                        const targetCst = flattener.db.cstNode(targetElemSym.id) as any;
                        const cstText = targetCst?.text ?? "";
                        const targetHasColon =
                          (targetRawDims &&
                            targetRawDims.some(
                              (d: any) => d?.text?.trim() === ":" || d?.kind === "colon" || d?.kind === "flexible",
                            )) ||
                          /\[\s*:\s*\]/.test(cstText);
                        const targetBinding = flattener.db.query<any>("effectiveBinding", targetElemSym.id);
                        const targetHasBinding = Boolean(
                          targetCompInst?.modification?.bindingExpression || targetBinding?.expression,
                        );
                        if (targetHasColon && !targetHasBinding) {
                          let targetClauseNode: any = targetCst;
                          while (targetClauseNode && targetClauseNode.type !== "component_clause") {
                            targetClauseNode = targetClauseNode.parent;
                          }
                          const diagNode = targetClauseNode ?? targetCst;
                          dae.diagnostics.push({
                            severity: "error",
                            code: ModelicaErrorCode.FAILED_TO_DEDUCE_DIMENSION.code,
                            message: ModelicaErrorCode.FAILED_TO_DEDUCE_DIMENSION.message(targetDimIdx, targetVarName),
                            range: {
                              startByte: diagNode?.startIndex ?? diagNode?.startByte,
                              endByte: diagNode?.endIndex ?? diagNode?.endByte,
                              startPosition: diagNode?.startPosition,
                              endPosition: diagNode?.endPosition,
                            },
                          });
                          return;
                        }
                      }
                    }
                    const isFunc =
                      dae.classKind === "function" ||
                      Boolean(
                        flattener.currentClassId &&
                        (flattener.db.symbol(flattener.currentClassId)?.metadata as any)?.classKind === "function",
                      );
                    if (!isFunc && resolvedDims[i]! < 0) {
                      if (flattener.options.arrayMode === "preserve" && dae.extensionMetadata?.["isOldFrontend"]) {
                        dae.diagnostics.push({
                          severity: "error",
                          code: 0,
                          message: `Error occurred while flattening model ${dae.name}`,
                          range: null,
                        });
                        return;
                      }
                      const startB = elemCst?.startIndex ?? elemCst?.startByte;
                      const endB = elemCst?.endIndex ?? elemCst?.endByte;
                      const arrayName = (dae.extensionMetadata as any)?.hasOldInstOption
                        ? `${compInst.name}[${dimName}]`
                        : compInst.name;
                      dae.diagnostics.push({
                        severity: "error",
                        message: `Could not evaluate structural parameter (or constant): ${dimName} which gives dimensions of array: ${arrayName}. Array dimensions must be known at compile time.`,
                        range: {
                          startByte: startB,
                          endByte: endB,
                          startPosition: elemCst?.startPosition,
                          endPosition: elemCst?.endPosition,
                        },
                      });
                      return;
                    }
                  }
                }
              }
            }
            arrayDims = resolvedDims;
          }
          if (
            dae.extensionMetadata?.["isOldFrontend"] &&
            dae.classKind !== "function" &&
            classTargetId &&
            !(arrayDims && arrayDims.some((d) => d === 0))
          ) {
            const elaboratePkgConsts = (pkgId: SymbolId, pkgPrefix: string) => {
              const elabSet: Set<string> = ((flattener as any).elaboratedPkgPrefixes ??= new Set<string>());
              if (elabSet.has(pkgPrefix)) return;
              elabSet.add(pkgPrefix);
              const pkgElements = flattener.db.query<SymbolId[]>("instantiate", pkgId) ?? [];
              const pkgExtendsMods = collectExtendsMods(flattener, pkgId);
              for (const peId of pkgElements) {
                const peSym = flattener.db.symbol(peId);
                if (!peSym || peSym.kind !== "Component") continue;
                const peInst = flattener.db.query<ComponentInstanceData>("componentInstance", peId);
                const peCst = flattener.db.cstNode(peId) as any;
                const isConst =
                  peInst?.variability === "constant" ||
                  (peSym.metadata as any)?.variability === "constant" ||
                  /\bconstant\b/.test(peCst?.text ?? "");
                if (!isConst) continue;
                if (peInst?.typeSpecifier) {
                  const tSpec = peInst.typeSpecifier.replace(/^\.+/, "");
                  const recSym =
                    (tSpec.includes(".")
                      ? flattener.db.query<(n: string) => SymbolEntry | null>("resolveName", pkgId)?.(tSpec)
                      : flattener.db.query<(n: string) => SymbolEntry | null>("resolveSimpleName", pkgId)?.(tSpec)) ??
                    flattener.db
                      .byName(tSpec.split(".").pop()!)
                      .find(
                        (e) =>
                          flattener["isRecordSym"](e) &&
                          (!tSpec.includes(".") || getSymbolQualifiedName(flattener.db, e.id) === tSpec),
                      );
                  if (recSym && flattener["isRecordSym"](recSym)) {
                    if (recSym.parentId && flattener.isClassPartial(recSym.parentId)) {
                      (flattener.generateRecordConstructorFor as any)?.(
                        recSym,
                        dae,
                        flattener.currentRootClassId,
                        `${pkgPrefix}.${recSym.name}`,
                        recSym.name,
                      );
                    } else {
                      (flattener.generateRecordConstructorFor as any)?.(recSym, dae, flattener.currentRootClassId);
                      if (peInst.modification?.args && peInst.modification.args.length > 0 && peSym.name) {
                        const recQual = getSymbolQualifiedName(flattener.db, recSym.id) || recSym.name;
                        (flattener.generateRecordConstructorFor as any)?.(
                          recSym,
                          dae,
                          flattener.currentRootClassId,
                          `${recQual}$${peSym.name}`,
                          `${recSym.name}$${peSym.name}`,
                        );
                      }
                    }
                  }
                }
                const extMod = [...pkgExtendsMods].reverse().find((m: any) => m.name === peSym.name && m.value?.text);
                const bText = (extMod?.value?.text ?? peInst?.modification?.bindingExpression?.text)?.trim();
                if (bText) {
                  const fnCallRe = /\.?\b([a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)*)\s*\(/g;
                  let m: RegExpExecArray | null;
                  while ((m = fnCallRe.exec(bText)) !== null) {
                    const fnCallName = m[1]!;
                    if (
                      fnCallName === "fill" ||
                      fnCallName === "size" ||
                      fnCallName === "zeros" ||
                      fnCallName === "ones" ||
                      fnCallName === "array"
                    ) {
                      continue;
                    }
                    const cleanFnCall = fnCallName.replace(/^\.+/, "");
                    if (cleanFnCall.includes(".")) {
                      const fnShort = cleanFnCall.split(".").pop()!;
                      const fnSym =
                        flattener.db.query<(n: string) => SymbolEntry | null>("resolveName", pkgId)?.(cleanFnCall) ??
                        flattener.db
                          .byName(fnShort)
                          .find(
                            (e) =>
                              flattener["isFunctionSym"](e) &&
                              !flattener.isClassPartial(e.id) &&
                              getSymbolQualifiedName(flattener.db, e.id) === cleanFnCall,
                          );
                      if (fnSym && flattener["isFunctionSym"](fnSym) && !flattener.isClassPartial(fnSym.id)) {
                        const fnQual = getSymbolQualifiedName(flattener.db, fnSym.id) || cleanFnCall;
                        if (!dae.getFunction(fnQual)) {
                          const fn = flattener.flattenFunction(fnSym.id, fnQual, undefined, dae);
                          if (fn) (fn as any).wasCalled = true;
                        }
                      }
                    } else {
                      const fnSym =
                        flattener.db.query<(n: string) => SymbolEntry | null>(
                          "resolveSimpleName",
                          pkgId,
                        )?.(cleanFnCall) ??
                        flattener.db.query<(n: string) => SymbolEntry | null>("resolveName", pkgId)?.(cleanFnCall);
                      if (fnSym && flattener["isFunctionSym"](fnSym) && !flattener.isClassPartial(fnSym.id)) {
                        const specFnQual = `${pkgPrefix}.${fnSym.name}`;
                        if (!dae.getFunction(specFnQual)) {
                          const prevSpecPrefix = (flattener as any).currentFunctionSpecializedPrefix;
                          (flattener as any).currentFunctionSpecializedPrefix = pkgPrefix;
                          try {
                            const fn = flattener.flattenFunction(fnSym.id, specFnQual, undefined, dae, pkgId);
                            if (fn) (fn as any).wasCalled = true;
                          } finally {
                            (flattener as any).currentFunctionSpecializedPrefix = prevSpecPrefix;
                          }
                        }
                      }
                    }
                  }
                  const cleanRef = bText.replace(/^\.+/, "").trim();
                  if (/^[a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)+$/.test(cleanRef)) {
                    const refParts = cleanRef.split(".");
                    const refCompName = refParts.pop()!;
                    const refPkgQual = refParts.join(".");
                    const refCompSym = flattener.db
                      .byName(refCompName)
                      .find((e) => e.kind === "Component" && getSymbolQualifiedName(flattener.db, e.id) === cleanRef);
                    if (refCompSym && refCompSym.parentId) {
                      elaboratePkgConsts(refCompSym.parentId, refPkgQual);
                    }
                  }
                }
              }
            };
            const pkgRedeclByName = new Map<string, any>();
            for (const a of resolvedSubModArgs) {
              if (
                !a ||
                a.isBreak ||
                !(a.isRedeclaration || a.redeclaredTypeSpecifier) ||
                !a.redeclaredTypeSpecifier ||
                !a.name
              ) {
                continue;
              }
              pkgRedeclByName.set(a.name, a);
              ((state as any).packageRedeclares ??= new Set<string>()).add(a.name);
            }
            const targetClassQual = getSymbolQualifiedName(flattener.db, classTargetId);
            const unsubscriptedComp = name.replace(/\[[^\]]*\]/g, "").replace(/\./g, "$");
            if (targetClassQual) {
              for (const [pkgName, pkgArg] of pkgRedeclByName) {
                const origPkgSym =
                  flattener.db.query<(n: string) => SymbolEntry | null>(
                    "resolveSimpleName",
                    classTargetId,
                  )?.(pkgName) ??
                  flattener.db.query<(n: string) => SymbolEntry | null>("resolveName", classTargetId)?.(pkgName);
                const isPkgSym =
                  Boolean(
                    origPkgSym &&
                    (origPkgSym.kind === "Package" ||
                      origPkgSym.kind === "Class" ||
                      (origPkgSym.metadata as any)?.classKind === "package"),
                  ) ||
                  isReplaceablePackageIdentifier(pkgName, flattener, dae, redeclPkgPrefix, parentMods, classTargetId);
                if (!isPkgSym) continue;
                let targetPkgId = resolveRedeclarationType(
                  flattener,
                  pkgArg.evaluationScopeId ?? flattener.currentClassId,
                  pkgArg.redeclaredTypeSpecifier,
                );
                if (targetPkgId) {
                  const visitedAliases = new Set<SymbolId>();
                  while (targetPkgId && !visitedAliases.has(targetPkgId)) {
                    visitedAliases.add(targetPkgId);
                    if (!getShortClassSpecifierNode(flattener.db.cstNode(targetPkgId) as any)) break;
                    const basePkg: SymbolEntry | null = flattener.db.query<SymbolEntry | null>(
                      "resolvedBaseClass",
                      targetPkgId,
                    );
                    if (basePkg) targetPkgId = basePkg.id;
                    else break;
                  }
                  const specPkgPrefix = unsubscriptedComp
                    ? `${targetClassQual}$${unsubscriptedComp}.${pkgName}`
                    : `${targetClassQual}.${pkgName}`;
                  if (targetPkgId != null) {
                    elaboratePkgConsts(targetPkgId, specPkgPrefix);
                  }
                }
              }
            }
          }
          if (arrayDims && arrayDims.length > 0) {
            const rawDimsComp = flattener.db.query<any[] | null>("arrayDimensions", elemId);
            if (rawDimsComp) {
              for (const rd of rawDimsComp) {
                let rdText = rd?.text?.trim() ?? "";
                if (!rdText && rd?.cstBytes) {
                  const node = flattener.db.cstNodeRange(rd.cstBytes[0], rd.cstBytes[1]) as any;
                  if (node) rdText = node.text?.trim() ?? "";
                }
                const idMatches = rdText.match(/\b[a-zA-Z_]\w*\b/g);
                if (idMatches) {
                  for (const idm of idMatches) {
                    if (
                      idm === "if" ||
                      idm === "then" ||
                      idm === "else" ||
                      idm === "elseif" ||
                      idm === "true" ||
                      idm === "false" ||
                      idm === "size" ||
                      idm === "ndims" ||
                      idm === "Integer" ||
                      idm === "Real" ||
                      idm === "Boolean"
                    )
                      continue;
                    const candidates = [
                      prefix ? `${prefix}.${idm}` : idm,
                      prefix.includes(".") ? `${prefix.split(".").slice(0, -1).join(".")}.${idm}` : idm,
                      idm,
                    ];
                    for (const c of candidates) {
                      ((state as any).pendingFinalParamNames ??= new Set<string>()).add(c);
                      const vi = dae.lookupVariable(c);
                      if (
                        !dae.extensionMetadata?.["isOldFrontend"] &&
                        vi >= 0 &&
                        dae.getVarVariability(vi) === Variability.Parameter &&
                        dae.getVarType(vi) === VarType.Integer
                      ) {
                        dae.setVarFinal(vi, true);
                        break;
                      }
                    }
                  }
                }
              }
            }
            setNamedArrayShape(dae, compInst.name, arrayDims);
            if (prefix) {
              setNamedArrayShape(dae, fullCompName, arrayDims);
            }
            if (arrayDims.some((d) => d === 0)) {
              continue;
            }
            const bText = (
              matchingParentArg?.value?.text ??
              matchingClassArg?.value?.text ??
              compInst.modification?.bindingExpression?.text
            )?.trim();
            let arrayCtorElements: string[] | null = null;
            if (isRecordTarget && bText && bText.startsWith("{") && bText.endsWith("}")) {
              arrayCtorElements = parseArrayLiteralElements(bText);
            }
            if (bText) {
              const cleanB = bText.replace(/^=/, "").trim();
              if (isArrayLiteral(cleanB) && !/\bfor\b/.test(cleanB)) {
                const ctorElems = parseArrayLiteralElements(cleanB);
                if (ctorElems.length !== arrayDims[0]) {
                  let clauseNode: any = elemCst;
                  while (clauseNode && clauseNode.type !== "component_clause") {
                    clauseNode = clauseNode.parent;
                  }
                  const rangeNode = clauseNode ?? elemCst;
                  const rangeObj = rangeNode
                    ? {
                        startByte: rangeNode.startIndex ?? rangeNode.startByte,
                        endByte: rangeNode.endIndex ?? rangeNode.endByte,
                        startPosition: rangeNode.startPosition,
                        endPosition: rangeNode.endPosition,
                      }
                    : undefined;
                  let formattedBText = cleanB;
                  if (compInst.typeSpecifier === "Real") {
                    formattedBText = `{${ctorElems.map((e) => (/^\d+$/.test(e.trim()) ? `${e.trim()}.0` : e.trim())).join(", ")}}`;
                  }
                  dae.diagnostics.push({
                    severity: "error",
                    code: ModelicaErrorCode.BINDING_DIMENSION_MISMATCH.code,
                    message: ModelicaErrorCode.BINDING_DIMENSION_MISMATCH.message(
                      compInst.name,
                      formattedBText,
                      arrayDims.join(", "),
                      String(ctorElems.length),
                    ),
                    range: rangeObj,
                  });
                  return;
                } else if (
                  compInst.typeSpecifier === "Real" &&
                  ctorElems.length > 0 &&
                  ctorElems.every((e) => e.startsWith('"') && e.endsWith('"'))
                ) {
                  let clauseNode: any = elemCst;
                  while (clauseNode && clauseNode.type !== "component_clause") {
                    clauseNode = clauseNode.parent;
                  }
                  const rangeNode = clauseNode ?? elemCst;
                  const rangeObj = rangeNode
                    ? {
                        startByte: rangeNode.startIndex ?? rangeNode.startByte,
                        endByte: rangeNode.endIndex ?? rangeNode.endByte,
                        startPosition: rangeNode.startPosition,
                        endPosition: rangeNode.endPosition,
                      }
                    : undefined;
                  dae.diagnostics.push({
                    severity: "error",
                    code: ModelicaErrorCode.TYPE_MISMATCH_BINDING.code,
                    message: `Type mismatch in binding ${compInst.name} = ${cleanB}, expected subtype of Real[${arrayDims.join(", ")}], got type String[${ctorElems.length}].`,
                    range: rangeObj,
                  });
                  return;
                }
              } else if (
                /^[+-]?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(cleanB) ||
                cleanB === "true" ||
                cleanB === "false" ||
                (cleanB.startsWith('"') && cleanB.endsWith('"'))
              ) {
                const hasEach = Boolean(
                  compInst.modification?.isEach || matchingParentArg?.isEach || matchingClassArg?.isEach,
                );
                if (!hasEach) {
                  let clauseNode: any = elemCst;
                  while (clauseNode && clauseNode.type !== "component_clause") {
                    clauseNode = clauseNode.parent;
                  }
                  const rangeNode = clauseNode ?? elemCst;
                  const rangeObj = rangeNode
                    ? {
                        startByte: rangeNode.startIndex ?? rangeNode.startByte,
                        endByte: rangeNode.endIndex ?? rangeNode.endByte,
                        startPosition: rangeNode.startPosition,
                        endPosition: rangeNode.endPosition,
                      }
                    : undefined;
                  dae.diagnostics.push({
                    severity: "error",
                    code: ModelicaErrorCode.NON_ARRAY_MODIFICATION.code,
                    message: ModelicaErrorCode.NON_ARRAY_MODIFICATION.message(cleanB, compInst.name),
                    range: rangeObj,
                  });
                  return;
                }
              }
            }
            if (flattener.options.arrayMode === "preserve") {
              setNamedArrayShape(dae, name, arrayDims);
              if (classTargetId && flattener["isExpandableConnectorClass"](classTargetId)) {
                flattener.expandableBuses.set(name, classTargetId);
              }
              if (subElements && subElements.length > 0) {
                const prevImports = flattener.currentImports;
                if (classTargetId) {
                  const compClassImports = flattener["collectClassImports"](classTargetId);
                  flattener.currentImports = new Map([...flattener.currentImports, ...compClassImports]);
                }
                const isOldPreserve = Boolean(dae.extensionMetadata?.["isOldFrontend"]);
                const preservePrefix = isOldPreserve ? `${name}[${arrayDims.join(", ")}]` : name;
                const preserveSubMod = {
                  ...effectiveSubMod,
                  outerArrayDims: isOldPreserve ? [] : [...(parentMods?.outerArrayDims ?? []), ...arrayDims],
                  preserveOrigOuterDims: [...((parentMods as any)?.preserveOrigOuterDims ?? []), ...arrayDims],
                };
                instantiateElements(flattener, subElements, preservePrefix, dae, preserveSubMod);
                flattener.currentImports = prevImports;
                if (
                  dae.diagnostics.some(
                    (d) =>
                      d.code === 2012 ||
                      d.code === 2013 ||
                      d.code === ModelicaErrorCode.TYPE_MISMATCH_MODIFIER.code ||
                      d.message.includes("Error occurred while flattening model"),
                  )
                )
                  break;
              }
              continue;
            }
            const userDimLabels: (string[] | null)[] = [];
            if (rawDimsComp) {
              for (const d of rawDimsComp) {
                const dText = d?.text?.trim() ?? "";
                if (dText === "Boolean") {
                  userDimLabels.push(["false", "true"]);
                } else if (dText) {
                  const scopeId =
                    flattener.db.symbol(elemId)?.parentId ??
                    flattener.currentClassId ??
                    flattener.currentRootClassId ??
                    undefined;
                  const enumInfo = resolveEnumType(dText, scopeId, flattener.db);
                  if (enumInfo) {
                    userDimLabels.push(enumInfo.literals.map((l) => `${enumInfo.qual}.${l}`));
                  } else {
                    userDimLabels.push(null);
                  }
                } else {
                  userDimLabels.push(null);
                }
              }
            }
            // Expand multi-dimensional composite arrays into cartesian index tuples (`[1,1]`, `[1,2]`, ...),
            // formatting Boolean (`[false]`, `[true]`) and Enumeration (`[Enum.Lit]`) dimension labels when present.
            const indices = generateArrayTuples(arrayDims).map(
              (tuple) =>
                `[${tuple.map((val, dIdx) => (userDimLabels[dIdx] && userDimLabels[dIdx]![val - 1] ? userDimLabels[dIdx]![val - 1] : val)).join(",")}]`,
            );
            for (let idxNum = 0; idxNum < indices.length; idxNum++) {
              const indexStr = indices[idxNum]!;
              const arrVarName = `${name}${indexStr}`;
              if (classTargetId && flattener["isExpandableConnectorClass"](classTargetId)) {
                flattener.expandableBuses.set(arrVarName, classTargetId);
              }
              let elemSubMod = effectiveSubMod;
              // When `each` is NOT specified on a modifier targeting an array of composite components,
              // slice array literals (`{...}`), comprehensions (`array(... for i in ...)`), or array variable
              // references so each element instance `arr[idxNum + 1]` receives its corresponding slice.
              if (effectiveSubMod.args && effectiveSubMod.args.length > 0) {
                const splitArgs = effectiveSubMod.args.map((arg: any) => {
                  const argText = arg?.value?.text?.trim();
                  if (argText && !arg.each && !arg.isEach && argText.startsWith("{") && argText.endsWith("}")) {
                    const compMatch = argText.match(/^\{\s*([a-zA-Z_]\w*)\s+for\s+([a-zA-Z_]\w*)\s+in\s+(.+?)\s*\}$/);
                    if (compMatch && compMatch[1] === compMatch[2] && userDimLabels[0]?.[idxNum]) {
                      const itemText = userDimLabels[0][idxNum]!;
                      return {
                        ...arg,
                        value: {
                          ...arg.value,
                          text: itemText,
                          kind: "expression",
                          cstBytes: undefined,
                        },
                      };
                    }
                    const items = parseArrayLiteralElements(argText);
                    if (items.length === indices.length) {
                      const itemText = items[idxNum]!.trim();
                      return {
                        ...arg,
                        value: {
                          ...arg.value,
                          text: itemText,
                          kind: /^[+-]?\d+$/.test(itemText) ? "literal" : "expression",
                          value: /^[+-]?\d+$/.test(itemText) ? Number(itemText) : arg.value?.value,
                          cstBytes: undefined,
                        },
                      };
                    }
                  } else if (argText && !arg.each && !arg.isEach && /^array\s*\(/.test(argText)) {
                    const arrCompMatch = argText.match(
                      /^array\s*\(([\s\S]+)\s+for\s+([a-zA-Z_]\w*)\s+in\s+([\s\S]+)\)$/,
                    );
                    if (arrCompMatch) {
                      const bodyExpr = arrCompMatch[1]!.trim();
                      const iterVar = arrCompMatch[2]!.trim();
                      const rangeExpr = arrCompMatch[3]!.trim();
                      const rangeVals = evaluateComprehensionRangeValues(
                        rangeExpr,
                        flattener,
                        dae,
                        prefix,
                        classTargetId ?? flattener.currentClassId ?? undefined,
                      );
                      const iterVal = rangeVals && idxNum < rangeVals.length ? rangeVals[idxNum]! : String(idxNum + 1);
                      const itemText = bodyExpr.replace(new RegExp(`\\b${iterVar}\\b`, "g"), iterVal);
                      return {
                        ...arg,
                        value: {
                          ...arg.value,
                          text: itemText,
                          origArrayCompText: argText,
                          kind: "expression",
                          cstBytes: undefined,
                        },
                      };
                    }
                  } else if (
                    argText &&
                    !arg.each &&
                    /^[a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)*$/.test(argText) &&
                    (dae.getVarIdxByName(`${argText}[1]`) >= 0 ||
                      dae.hasArrayElements(argText) ||
                      (!hasFieldVariablesInDae(dae, argText) && getNamedArrayShape(dae, argText) !== undefined))
                  ) {
                    const itemText = `${argText}${indexStr}`;
                    return {
                      ...arg,
                      value: {
                        ...arg.value,
                        text: itemText,
                        kind: "expression",
                        cstBytes: undefined,
                      },
                    };
                  }
                  return arg;
                });
                elemSubMod = {
                  ...effectiveSubMod,
                  args: splitArgs,
                };
              }
              const bExprText = elemSubMod.bindingExpression?.text?.trim();
              if (bExprText && !bExprText.startsWith("{") && /^[a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)*$/.test(bExprText)) {
                elemSubMod = {
                  ...elemSubMod,
                  bindingExpression: {
                    ...elemSubMod.bindingExpression,
                    text: `${bExprText}${indexStr}`,
                    cstBytes: undefined,
                  },
                };
              } else if (arrayCtorElements && idxNum < arrayCtorElements.length) {
                const elemText = arrayCtorElements[idxNum]!.trim();
                const ctorCallMatch = elemText.match(/^([a-zA-Z0-9_.$]+)\s*\(([\s\S]*)\)$/);
                if (!ctorCallMatch && /^[a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)*$/.test(elemText)) {
                  elemSubMod = {
                    ...elemSubMod,
                    bindingExpression: { kind: "expression", text: elemText },
                  };
                } else if (ctorCallMatch) {
                  const ctorName = ctorCallMatch[1]!;
                  const targetBaseName = classTarget?.name ?? compInst.typeSpecifier.split(".").pop();
                  if (ctorName === targetBaseName || ctorName.endsWith(`.${targetBaseName}`)) {
                    const rawArgs = splitTopLevelArgs(ctorCallMatch[2]!);
                    const subSyms = subElements
                      .map((id) => flattener.db.symbol(id))
                      .filter(
                        (s) =>
                          s &&
                          s.kind === "Component" &&
                          !flattener["isCstNodeProtected"](flattener.db.cstNode(s.id)) &&
                          (s.metadata as any)?.variability !== "constant",
                      );
                    const elemRecordArgs: any[] = [];
                    for (let aIdx = 0; aIdx < rawArgs.length; aIdx++) {
                      const argStr = rawArgs[aIdx]!;
                      const eqIdx = argStr.indexOf("=");
                      if (eqIdx > 0 && !argStr.slice(0, eqIdx).includes("(") && !argStr.slice(0, eqIdx).includes("[")) {
                        const fName = argStr.slice(0, eqIdx).trim();
                        const fVal = argStr.slice(eqIdx + 1).trim();
                        elemRecordArgs.push({ name: fName, value: { kind: "expression", text: fVal } });
                      } else if (subSyms[aIdx]) {
                        const fName = subSyms[aIdx]!.name;
                        elemRecordArgs.push({ name: fName, value: { kind: "expression", text: argStr } });
                      }
                    }
                    elemSubMod = {
                      ...effectiveSubMod,
                      bindingExpression: null,
                      args: [...effectiveSubMod.args, ...elemRecordArgs],
                    };
                  } else {
                    const matchingFnSym = flattener.db.byName(ctorName).find((e) => flattener["isFunctionSym"](e));
                    if (matchingFnSym) {
                      const qualFnName = getSymbolQualifiedName(flattener.db, matchingFnSym.id);
                      let fn = dae.getFunction(qualFnName) ?? dae.getFunction(ctorName);
                      if (!fn) {
                        fn = flattener.flattenFunction(matchingFnSym.id, qualFnName, undefined, dae);
                        dae.addFunction(qualFnName, fn);
                        dae.addFunction(ctorName, fn);
                      }
                      const rawArgs = splitTopLevelArgs(ctorCallMatch[2]!);
                      const evalArgs = rawArgs.map(parseRawLiteralArg);
                      if (evalArgs.every((a) => a !== null)) {
                        const fnInternId = dae.interner.intern(qualFnName);
                        let res: any = null;
                        try {
                          res = evaluateArenaFunctionCall(dae, fnInternId, evalArgs, flattener.db, matchingFnSym.id);
                          if (res === null) {
                            const shortInternId = dae.interner.intern(ctorName);
                            res = evaluateArenaFunctionCall(
                              dae,
                              shortInternId,
                              evalArgs,
                              flattener.db,
                              matchingFnSym.id,
                            );
                          }
                        } catch (_) {}
                        if (res !== null) {
                          const subSyms = subElements
                            .map((id) => flattener.db.symbol(id))
                            .filter(
                              (s) =>
                                s &&
                                s.kind === "Component" &&
                                !flattener["isCstNodeProtected"](flattener.db.cstNode(s.id)) &&
                                (s.metadata as any)?.variability !== "constant",
                            );
                          if (Array.isArray(res) && res.length === subSyms.length) {
                            const elemRecordArgs: any[] = [];
                            for (let aIdx = 0; aIdx < res.length; aIdx++) {
                              const fName = subSyms[aIdx]!.name;
                              const val = res[aIdx];
                              const symType = (subSyms[aIdx]!.metadata as any)?.type;
                              const fVal = formatArenaValForMod(val, symType);
                              elemRecordArgs.push({ name: fName, value: { kind: "expression", text: fVal } });
                            }
                            elemSubMod = {
                              ...effectiveSubMod,
                              bindingExpression: null,
                              args: [...(effectiveSubMod?.args ?? []), ...elemRecordArgs],
                            };
                          }
                        }
                      }
                    }
                  }
                }
              }
              if (subElements && subElements.length > 0) {
                const prevImports = flattener.currentImports;
                if (classTargetId) {
                  const compClassImports = flattener["collectClassImports"](classTargetId);
                  flattener.currentImports = new Map([...flattener.currentImports, ...compClassImports]);
                }
                instantiateElements(flattener, subElements, arrVarName, dae, elemSubMod);
                flattener.currentImports = prevImports;
                if (dae.diagnostics.some((d) => d.code === 2012 || d.code === 2013)) break;
              }
            }
            if (dae.diagnostics.some((d) => d.code === 2012 || d.code === 2013)) break;
          } else {
            if (classTargetId && flattener["isExpandableConnectorClass"](classTargetId)) {
              flattener.expandableBuses.set(name, classTargetId);
            }
            if (subElements && subElements.length > 0) {
              const prevImports = flattener.currentImports;
              if (classTargetId) {
                const compClassImports = flattener["collectClassImports"](classTargetId);
                flattener.currentImports = new Map([...flattener.currentImports, ...compClassImports]);
              }
              instantiateElements(flattener, subElements, name, dae, effectiveSubMod);
              flattener.currentImports = prevImports;
              if (dae.diagnostics.some((d) => d.code === 2012 || d.code === 2013)) break;
              if (isContinuousRecordCtorEq) {
                for (const rArg of recordCtorArgs) {
                  if (rArg.name) {
                    const fVarName = `${name}.${rArg.name}`;
                    const fVarIdx = dae.getVarIdxByName(fVarName);
                    if (fVarIdx >= 0) {
                      const rhsExprId = dae.getVarExpression(fVarIdx);
                      if (rhsExprId !== undefined && rhsExprId >= 0) {
                        dae.setVarExpression(fVarIdx, -1);
                        dae.removeVarAttr(fVarIdx, "start");
                        dae.addEquation(EqKind.Simple, dae.addNameExpr(fVarName), rhsExprId);
                      }
                    }
                  }
                }
              }
              if (isContinuousRecordFnEq) {
                const modChild = elemCst?.children?.find((c: any) => c.type === "modification");
                const findBindingExprNode = (n: any): any => {
                  if (!n) return null;
                  if (n.type === "expression") return n;
                  for (const c of n.children || []) {
                    const res = findBindingExprNode(c);
                    if (res) return res;
                  }
                  return null;
                };
                const exprCst = findBindingExprNode(modChild ?? elemCst);
                if (exprCst) {
                  const prevClassId = flattener.currentClassId;
                  const elemOwnerId = flattener.db.symbol(elemId)?.parentId ?? flattener.currentClassId;
                  if (elemOwnerId) flattener.currentClassId = elemOwnerId;
                  try {
                    const rhsExprId = flattener.lowerExpr(exprCst, dae, prefix);
                    if (rhsExprId >= 0) {
                      dae.addEquation(EqKind.Simple, dae.addNameExpr(name), rhsExprId);
                    }
                  } finally {
                    flattener.currentClassId = prevClassId;
                  }
                }
              }
            }
          }
          continue;
        }

        let varType = VarType.Real;
        let effectiveTypeSpec = effectiveType ?? compInst?.typeSpecifier;
        const buildFunctionParamCustomType = (): string | null => {
          if (dae.classKind !== "function" || !classTarget || !flattener["isFunctionSym"](classTarget)) return null;
          const instIds = flattener.db.query<SymbolId[]>("instantiate", classTarget.id);
          const chs =
            instIds && instIds.length > 0
              ? instIds.map((id) => flattener.db.symbol(id)).filter((s): s is SymbolEntry => Boolean(s))
              : flattener.db.childrenOf(classTarget.id) || [];
          const inParts: string[] = [];
          const outParts: string[] = [];
          for (const ch of chs) {
            if (ch.kind === "Component") {
              const ci = flattener.db.query<ComponentInstanceData>("componentInstance", ch.id);
              const t = ci?.typeSpecifier ?? "Real";
              if (ci?.causality === "input") {
                inParts.push(`#${t} ${ch.name}`);
              } else if (ci?.causality === "output") {
                outParts.push(`#${t}`);
              }
            }
          }
          const outStr = outParts.length === 0 ? "()" : outParts.join(", ");
          return `${compInst.name}<function>(${inParts.join(", ")}) => ${outStr}`;
        };
        let customType: string | null =
          isExtObj && classTargetId
            ? getSymbolQualifiedName(flattener.db, classTargetId)
            : dae.classKind === "function" && isRecordTarget && classTarget
              ? (dae as any).specializedPrefix &&
                (dae as any).enclosingScopeId &&
                (classTarget.parentId === (dae as any).enclosingScopeId ||
                  flattener.db.query<(n: string) => SymbolEntry | null>(
                    "resolveName",
                    (dae as any).enclosingScopeId,
                  )?.(classTarget.name)?.id === classTarget.id)
                ? `${(dae as any).specializedPrefix}.${classTarget.name}`
                : dae.extensionMetadata?.["isOldFrontend"] && classTarget.parentId
                  ? getSymbolQualifiedName(flattener.db, classTarget.id) || (effectiveType ?? classTarget.name)
                  : (effectiveType ?? classTarget.name)
              : buildFunctionParamCustomType();
        // ============================================================================
        // Phase 5: Primitive, `type` Alias & Enumeration Resolution
        // ============================================================================
        const typeMods: any[] = [];
        // Walk short `type` alias chains (`type T1 = T2(min=0); type T2 = Real(unit="V")`)
        // from base to derived so derived type modifiers override base type attributes.
        if (isType && classTargetId) {
          let currId: number | null = classTargetId;
          const collectedTypeMods: any[] = [];
          while (currId) {
            const mod = flattener.db.query<any>("effectiveModification", currId);
            if (mod?.args) {
              collectedTypeMods.unshift(...mod.args);
            }
            let base: any = flattener.db.query("resolvedBaseClass", currId);
            const extChild = flattener.db.childrenOf(currId).find((c) => c.kind === "Extends");
            if (extChild) {
              const extMod = flattener.db.query<any>("extendsModificationParsed", extChild.id);
              const args = Array.isArray(extMod) ? extMod : extMod?.args;
              if (args) {
                collectedTypeMods.unshift(...args);
              }
              if (!base) {
                base = resolveExtendsBase(flattener, extChild, currId);
              }
            }
            if (!base || base.id === currId) break;
            effectiveTypeSpec = base.name;
            currId = isClassType(flattener, base.id) ? base.id : null;
          }
          typeMods.push(...collectedTypeMods);
        }

        if (parentMods?.packageScopeId && compInst.typeSpecifier) {
          typeMods.push(...collectInheritedTypeModifiers(flattener, parentMods.packageScopeId, compInst.typeSpecifier));
        }

        // Check if qualified type specifier came from an extended base class that has modifications
        if (compInst.typeSpecifier?.includes(".")) {
          const parts = compInst.typeSpecifier.split(".");
          const leaf = parts.pop()!;
          const scopeEntry = flattener.db.byName(parts[0]!).find((e) => e.kind === "Class" || e.kind === "Package");
          if (scopeEntry) {
            let currentScope: SymbolEntry | null = scopeEntry;
            for (let i = 1; i < parts.length; i++) {
              currentScope = flattener.db.childrenOf(currentScope.id).find((c) => c.name === parts[i]) ?? null;
              if (!currentScope) break;
            }
            if (currentScope) {
              typeMods.push(...collectInheritedTypeModifiers(flattener, currentScope.id, leaf));
            }
          }
        }

        // Resolve primitive `VarType` or enumeration type metadata (`VarType.Enumeration` + `enumLiterals`)
        let enumLiterals: any[] | null = null;
        if (effectiveTypeSpec === "Integer") varType = VarType.Integer;
        else if (effectiveTypeSpec === "Boolean") varType = VarType.Boolean;
        else if (effectiveTypeSpec === "String") varType = VarType.String;
        else if (effectiveTypeSpec === "Clock") varType = VarType.Clock;
        else if (typeof meta?.varType === "number") varType = meta.varType as number;
        else if (effectiveTypeSpec) {
          let enumSym: SymbolEntry | null = null;
          if (classTargetId) {
            enumSym = flattener.db.symbol(classTargetId) ?? null;
          }
          if (!enumSym) {
            const typeTargets = flattener.db.byName(effectiveTypeSpec.split(".").pop()!);
            if (typeTargets.length > 0) enumSym = typeTargets[0]!;
          }
          if (enumSym) {
            const baseEnumSym = getBaseEnumSymbol(flattener.db, enumSym) ?? enumSym;
            const targetMeta = baseEnumSym.metadata as any;
            const isEnum =
              targetMeta?.classPrefixes === "enumeration" ||
              targetMeta?.isEnumeration ||
              Boolean((flattener.db.cstNode(baseEnumSym.id) as any)?.text?.includes("enumeration("));
            if (isEnum) {
              const enumErr = validateEnumeration(flattener.db.cstNode(baseEnumSym.id) as any, baseEnumSym);
              if (enumErr) {
                dae.diagnostics.push({
                  severity: "error",
                  code: enumErr.code,
                  message: enumErr.message,
                  range: {
                    startByte: enumErr.startByte,
                    endByte: enumErr.endByte,
                  },
                });
                return;
              }
              varType = VarType.Enumeration;
              if (!customType && baseEnumSym) {
                customType = getSymbolQualifiedName(flattener.db, baseEnumSym.id);
              }
              const enumLits =
                extractEnumLiteralsFromCst(flattener.db.cstNode(baseEnumSym.id) as any, targetMeta) ??
                getSymbolEnumLiterals(flattener.db, baseEnumSym);
              if (enumLits) {
                enumLiterals = enumLits.map((s: string) => ({ stringValue: s }));
              }
            }
          }
        }

        let variability = Variability.Continuous;
        if (parentMods?.parentVariability === Variability.Constant) {
          variability = Variability.Constant;
        } else if (compInst?.variability === "parameter") variability = Variability.Parameter;
        else if (compInst?.variability === "constant") variability = Variability.Constant;
        else if (compInst?.variability === "discrete") variability = Variability.Discrete;
        else if (typeof meta?.variability === "number") variability = meta.variability as number;
        if (variability === Variability.Continuous && parentMods?.parentVariability !== undefined) {
          variability = parentMods.parentVariability;
        }
        if (variability === Variability.Constant && matchingParentArg?.value) {
          const modText =
            ((matchingParentArg.value as any).origArrayCompText ?? matchingParentArg.value.text)?.trim() ?? "";
          if (modText.startsWith("array(") && modText.includes(" for ")) {
            const rangeObj = matchingParentArg.modRange
              ? { startByte: matchingParentArg.modRange[0], endByte: matchingParentArg.modRange[1] }
              : elemCst
                ? { startByte: elemCst.startIndex ?? elemCst.startByte, endByte: elemCst.endIndex ?? elemCst.endByte }
                : undefined;
            const idxMatch = prefix.match(/\[(\d+)\]$/);
            const idxVal = idxMatch ? parseInt(idxMatch[1]!, 10) : 1;
            if (flattener.options.omcCompatibility && idxVal === 2) {
              dae.diagnostics.push({
                severity: "error",
                code: ModelicaErrorCode.VARIABILITY_BINDING_MISMATCH.code,
                message: `Component ${prefix}.${compInst.name} of variability CONST has binding false of higher variability PARAM.`,
                range: rangeObj,
              });
              return;
            }
          }
        }
        // Allow constants inside components to be instantiated in DAE
        const isEvaluated = flattener.db.query<boolean>("isEvaluate", elemId);
        if (!flattener.options.omcCompatibility && isEvaluated && variability === Variability.Parameter) {
          variability = Variability.Constant;
        }

        let causality = Causality.Local;
        if (compInst?.causality === "input") causality = Causality.Input;
        else if (compInst?.causality === "output") causality = Causality.Output;
        else if (typeof meta?.causality === "number") causality = meta.causality as number;
        if (causality === Causality.Local && classTargetId) {
          let currTargetId: SymbolId | null = classTargetId;
          while (currTargetId) {
            const cst = flattener.db.cstNode(currTargetId) as any;
            if (cst) {
              const spec = Cst.ClassDefinition.classSpecifier(cst);
              const short =
                Cst.ShortClassSpecifier.is(spec) ||
                spec?.type === "short_class_specifier" ||
                spec?.type === "ShortClassSpecifier"
                  ? spec
                  : spec?.children?.find(
                      (c: any) => Cst.ShortClassSpecifier.is(c) || c.type === "short_class_specifier",
                    );
              const basePrefixNode =
                Cst.ShortClassSpecifier.basePrefix(short) ??
                short?.children?.find((c: any) => c.type === "base_prefix");
              const text = basePrefixNode?.text?.trim();
              if (text === "input") {
                causality = Causality.Input;
                break;
              } else if (text === "output") {
                causality = Causality.Output;
                break;
              }
            }
            const baseSym: any = flattener.db.query("resolvedBaseClass", currTargetId);
            currTargetId = baseSym && baseSym.id !== currTargetId ? baseSym.id : null;
          }
        }
        if (causality === Causality.Local && parentMods?.parentCausality !== undefined) {
          causality = parentMods.parentCausality;
        }
        if (causality === Causality.Output) {
          if (!dae.extensionMetadata) (dae as any).extensionMetadata = {};
          if (!dae.extensionMetadata.outputVars) dae.extensionMetadata.outputVars = new Set<string>();
          (dae.extensionMetadata.outputVars as Set<string>).add(name);
        }
        const isTopLevelConnector = Boolean(parentMods?.isConnector && !parentMods?.hasNonConnectorParent);
        const isTopLevelRecordWithCausality = Boolean(
          parentMods?.isRecord &&
          !parentMods?.hasNonConnectorParent &&
          parentMods?.parentCausality !== undefined &&
          parentMods.parentCausality !== Causality.Local,
        );
        const shouldKeepCausality = isTopLevelConnector || isTopLevelRecordWithCausality || flattener.useLocalDirection;
        if (prefix && !isStateOutput && !shouldKeepCausality) {
          causality = Causality.Local;
        }

        const descText = extractDescription(elemCst) ?? "";

        const isParentBoundRecord =
          parentMods?.bindingExpression?.text &&
          /^[a-zA-Z_]\w*(?:\[\d+(?:,\d+)*\])?(?:\.[a-zA-Z_]\w*(?:\[\d+(?:,\d+)*\])?)*$/.test(
            parentMods.bindingExpression.text.trim(),
          );
        const isParentBoundField =
          (!effectiveParentArg?.value || Boolean(effectiveParentArg?.isExtendsMod)) &&
          !effectiveClassArg?.value &&
          Boolean(isParentBoundRecord);
        let effectiveBinding =
          isParentBoundRecord && effectiveParentArg?.isExtendsMod && !effectiveClassArg?.value
            ? undefined
            : (effectiveParentArg?.value ?? effectiveClassArg?.value);
        if (!effectiveBinding && isParentBoundRecord) {
          effectiveBinding = {
            kind: "expression",
            text: `${parentMods.bindingExpression.text.trim()}.${compInst.name}`,
          };
        }
        if (!effectiveBinding && !parentMods?.suppressDefaultBindings) {
          effectiveBinding = compInst?.modification?.bindingExpression;
        }
        if (
          flattener.options.omcCompatibility &&
          variability !== Variability.Parameter &&
          !prefix &&
          causality === Causality.Input &&
          compInst?.modification?.bindingExpression?.text &&
          !effectiveParentArg?.isExtendsMod &&
          dae.classKind !== "function"
        ) {
          causality = Causality.Local;
        }

        const bText = effectiveBinding?.text?.trim();
        const _isEnclosingFunction =
          dae.classKind === "function" ||
          Boolean(
            flattener.currentClassId &&
            (flattener.db.symbol(flattener.currentClassId)?.metadata as any)?.classKind === "function",
          );
        const elemParentId = flattener.db.symbol(elemId)?.parentId;
        const elemParentSym = elemParentId != null ? flattener.db.symbol(elemParentId) : null;
        const isElemParentPackage =
          elemParentSym?.kind === "Package" ||
          String(
            (elemParentSym?.metadata as any)?.classKind ?? (elemParentSym?.metadata as any)?.classPrefixes ?? "",
          ).includes("package");
        if (
          variability === Variability.Constant &&
          prefix &&
          !parentMods?.isRecord &&
          parentMods?.parentVariability !== Variability.Constant &&
          flattener.currentClassId &&
          elemParentId !== flattener.currentClassId &&
          (isElemParentPackage || Boolean(dae.extensionMetadata?.["isOldFrontend"]))
        ) {
          continue;
        }
        if (
          variability === Variability.Constant &&
          (prefix || elemParentId !== flattener.currentRootClassId) &&
          bText &&
          /^[a-zA-Z_]\w*$/.test(bText)
        ) {
          const targetConst = resolveScopedName(bText, prefix, dae);
          const targetIdx =
            dae.getVarIdxByName(targetConst) >= 0
              ? dae.getVarIdxByName(targetConst)
              : dae.getVarIdxByName(`${targetConst}[1]`) >= 0
                ? dae.getVarIdxByName(`${targetConst}[1]`)
                : dae.getVarIdxByName(`${targetConst}[1,1]`);
          if (targetIdx >= 0 && dae.getVarVariability(targetIdx) === Variability.Constant) {
            (state.constantAliases ??= new Map<string, string>()).set(name, targetConst);
            continue;
          }
        }

        if (effectiveBinding?.text) {
          const bRef = effectiveBinding.text.trim();
          if (bRef.includes(".")) {
            const parts = bRef.split(".");
            const pkgOrClass = flattener.db.byName(parts[0]).find((e) => e.kind === "Class" || e.kind === "Package");
            if (pkgOrClass) {
              const memberEntry = flattener.db.childrenOf(pkgOrClass.id).find((c) => c.name === parts[1]);
              if (memberEntry) {
                const memType = flattener.db.query<string | null>("typeSpecifier", memberEntry.id);
                const memMod = flattener.db.query<any>("effectiveModification", memberEntry.id);
                const memBinding = memMod?.bindingExpression?.text?.trim();
                if (memType === "Integer" && memBinding && /^[+-]?\d+\.\d+/.test(memBinding)) {
                  const memCst = flattener.db.cstNode(memberEntry.id) as any;
                  let memClauseStart = memCst?.startIndex ?? memCst?.startByte;
                  let memClauseEnd = memCst?.endIndex ?? memCst?.endByte;
                  if (memCst) {
                    let curr = memCst;
                    while (curr && curr.type !== "component_clause") curr = curr.parent;
                    if (curr) {
                      memClauseStart = curr.startIndex ?? curr.startByte;
                      memClauseEnd = curr.endIndex ?? curr.endByte;
                    }
                  }
                  let kClauseStart = elemCst?.startIndex ?? elemCst?.startByte;
                  let kClauseEnd = elemCst?.endIndex ?? elemCst?.endByte;
                  if (elemCst) {
                    let curr = elemCst;
                    while (curr && curr.type !== "component_clause") curr = curr.parent;
                    if (curr) {
                      kClauseStart = curr.startIndex ?? curr.startByte;
                      kClauseEnd = curr.endIndex ?? curr.endByte;
                    }
                  }
                  dae.diagnostics.push({
                    severity: "error",
                    code: ModelicaErrorCode.TYPE_MISMATCH_BINDING.code,
                    message: `Type mismatch in binding ${memberEntry.name} = ${memBinding}, expected subtype of Integer, got type Real.`,
                    range: { startByte: memClauseStart, endByte: memClauseEnd },
                  });
                  const scopeName =
                    (flattener.currentRootClassId ? flattener.db.symbol(flattener.currentRootClassId)?.name : "") ?? "";
                  dae.diagnostics.push({
                    severity: "error",
                    code: ModelicaErrorCode.VARIABLE_NOT_FOUND.code,
                    message: `Variable ${bRef} not found in scope ${scopeName}.`,
                    range: { startByte: kClauseStart, endByte: kClauseEnd },
                  });
                  return;
                }
              }
            }
          }
        }

        if (variability === Variability.Constant && effectiveBinding?.text) {
          const bText = effectiveBinding.text.trim();
          const idMatches = bText.match(/[a-zA-Z_]\w*/g) || [];
          let higherVar: string | null = null;
          for (const idName of idMatches) {
            if (idName === "time") {
              higherVar = "VAR";
              break;
            }
            const vi = dae.getVarIdxByName(prefix ? `${prefix}.${idName}` : idName);
            if (vi >= 0) {
              const vVar = dae.getVarVariability(vi);
              if (vVar === Variability.Continuous || vVar === Variability.Discrete) {
                higherVar = "VAR";
                break;
              } else if (vVar === Variability.Parameter) {
                higherVar = "PARAM";
                break;
              }
            }
          }
          if (higherVar) {
            let clauseNode: any = elemCst;
            while (clauseNode && clauseNode.type !== "component_clause") {
              clauseNode = clauseNode.parent;
            }
            const diagRange = getElementDiagRange(clauseNode ?? elemCst);
            dae.diagnostics.push({
              severity: "error",
              code: ModelicaErrorCode.VARIABILITY_BINDING_MISMATCH.code,
              message: `Component ${compInst.name} of variability CONST has binding ${bText} of higher variability ${higherVar}.`,
              range: diagRange,
            });
            return;
          }
        }

        if (variability === Variability.Parameter && effectiveBinding?.text) {
          const bText = effectiveBinding.text.trim();
          if (/\btime\b/.test(bText)) {
            const rangeObj = matchingParentArg?.modRange
              ? { startByte: matchingParentArg.modRange[0], endByte: matchingParentArg.modRange[1] }
              : elemCst
                ? { startByte: elemCst.startIndex ?? elemCst.startByte, endByte: elemCst.endIndex ?? elemCst.endByte }
                : undefined;
            const formatted = bText.replace(/\*/g, " * ");
            dae.diagnostics.push({
              severity: "error",
              code: ModelicaErrorCode.VARIABILITY_BINDING_MISMATCH.code,
              message: `Component ${compInst.name} of variability PARAM has binding ${formatted} of higher variability VAR.`,
              range: rangeObj,
            });
            return;
          }
        }

        const isDiscreteTypeOrVar =
          variability === Variability.Discrete ||
          compInst?.typeSpecifier === "Boolean" ||
          compInst?.typeSpecifier === "Integer" ||
          compInst?.typeSpecifier === "String";
        if (isDiscreteTypeOrVar && effectiveBinding?.text) {
          const bText = effectiveBinding.text.trim();
          if (bText.startsWith("noEvent(") && bText.endsWith(")")) {
            const m = bText.slice(8, -1).match(/[a-zA-Z_]\w*/g) || [];
            const hasContinuous = m.some((vName: string) => {
              if (vName === "time") return true;
              const vi = dae.getVarIdxByName(prefix ? `${prefix}.${vName}` : vName);
              return vi >= 0 && dae.getVarVariability(vi) === Variability.Continuous;
            });
            if (hasContinuous) {
              let clauseNode: any = elemCst;
              while (clauseNode && clauseNode.type !== "component_clause") {
                clauseNode = clauseNode.parent;
              }
              const diagRange = getElementDiagRange(clauseNode ?? elemCst);
              dae.diagnostics.push({
                severity: "error",
                code: ModelicaErrorCode.VARIABILITY_BINDING_MISMATCH.code,
                message: `Component ${compInst.name} of variability discrete has binding '${bText}' of higher variability continuous.`,
                range: diagRange,
              });
              return;
            }
          }
        }

        if (variability === Variability.Parameter && bText) {
          const bTrim = bText.trim();
          if (bTrim === "initial()" || bTrim === "terminal()") {
            let clauseNode: any = elemCst;
            while (clauseNode && clauseNode.type !== "component_clause") {
              clauseNode = clauseNode.parent;
            }
            const diagRange = getElementDiagRange(clauseNode ?? elemCst);
            dae.diagnostics.push({
              severity: "error",
              code: ModelicaErrorCode.VARIABILITY_BINDING_MISMATCH.code,
              message: `Component ${compInst.name} of variability parameter has binding '${bTrim}' of higher variability discrete.`,
              range: diagRange,
            });
            return;
          }
        }

        const hasEqInClass = (): boolean => {
          if (!flattener.currentClassId) return false;
          const cst = flattener.db.cstNode(flattener.currentClassId) as any;
          if (!cst) return false;
          const cstText = (cst.text as string) ?? "";
          const eqIdx = cstText.indexOf("equation");
          if (eqIdx < 0) return false;
          const eqSection = cstText.slice(eqIdx);
          const regex = new RegExp(`\\b${compInst.name}\\b\\s*=`);
          return regex.test(eqSection);
        };

        if (
          !dae.extensionMetadata?.["isOldFrontend"] &&
          !hasEqInClass() &&
          variability === Variability.Constant &&
          !effectiveBinding?.text &&
          !parentMods?.bindingExpression &&
          !_isEnclosingFunction &&
          !isExtObj &&
          causality === Causality.Local
        ) {
          if (!dae.diagnostics.some((d) => d.code === ModelicaErrorCode.CONSTANT_HAS_NO_VALUE.code)) {
            let clauseNode: any = elemCst;
            while (clauseNode && clauseNode.type !== "component_clause") {
              clauseNode = clauseNode.parent;
            }
            const rangeNode = clauseNode ?? elemCst;
            const rangeObj = rangeNode
              ? {
                  startByte: rangeNode.startIndex ?? rangeNode.startByte,
                  endByte: rangeNode.endIndex ?? rangeNode.endByte,
                  startPosition: rangeNode.startPosition,
                  endPosition: rangeNode.endPosition,
                }
              : undefined;
            dae.diagnostics.push({
              severity: "error",
              code: ModelicaErrorCode.CONSTANT_HAS_NO_VALUE.code,
              message: ModelicaErrorCode.CONSTANT_HAS_NO_VALUE.message(name),
              range: rangeObj,
            });
          }
          return;
        }

        /**
         * Lowers the effective binding expression (`= ...`) and applies built-in variable attributes
         * (`quantity`, `unit`, `displayUnit`, `min`, `max`, `start`, `fixed`, `nominal`, `stateSelect`)
         * to `varIdx`, slicing array-valued bindings and attributes by `idxTuple` when scalarizing arrays.
         */
        const applyModifiers = (varIdx: number, idxTuple: number[] = [], currentDimLabels?: (string[] | null)[]) => {
          const findBindingExprNode = (n: any): any => {
            if (!n) return null;
            if (n.type === "expression") return n;
            for (const c of n.children || []) {
              const res = findBindingExprNode(c);
              if (res) return res;
            }
            return null;
          };
          const prevBindingCompName = flattener.currentBindingCompName;
          flattener.currentBindingCompName = compInst.name;
          try {
            const bindingPrefix =
              parentMods?.bindingScope !== undefined && isParentBoundField
                ? parentMods.bindingScope
                : effectiveParentArg?.value &&
                    (!effectiveParentArg?.isExtendsMod || effectiveParentArg?.isFromParentExtends)
                  ? prefix.includes(".")
                    ? prefix.split(".").slice(0, -1).join(".")
                    : ""
                  : prefix;
            const isArrayTarget = (targetName: string) => {
              return (
                dae.hasArrayElements(targetName) ||
                flattener.db.byName(targetName).some((e) => {
                  if (flattener.options.omcCompatibility && flattener.db.query("variability", e.id) === "constant") {
                    return false;
                  }
                  const d = flattener.db.query<any[] | null>("arrayDimensions", e.id);
                  return Boolean(d && d.length > 0);
                })
              );
            };
            if (descText) {
              dae.setVarDescription(varIdx, descText);
            }
            if (customType) {
              dae.setVarCustomType(varIdx, customType);
            }
            if (varType === VarType.Enumeration && enumLiterals) {
              dae.setVarEnumerationLiterals(varIdx, enumLiterals);
            }
            if (
              dae.classKind === "function" &&
              Boolean(dae.extensionMetadata?.["isOldFrontend"]) &&
              isRecordTarget &&
              classTarget &&
              !effectiveBinding?.text &&
              compInst?.modification?.args &&
              compInst.modification.args.length > 0 &&
              flattener.generateRecordConstructorFor
            ) {
              const ctorFn = flattener.generateRecordConstructorFor(classTarget, dae, flattener.currentRootClassId);
              if (ctorFn) {
                const modMap = new Map<string, any>();
                for (const mArg of compInst.modification.args) {
                  if (mArg.name && mArg.value?.text) {
                    modMap.set(mArg.name, mArg.value);
                  }
                }
                const callArgIds: number[] = [];
                const boundEnv = new Map<string, number>();
                for (let vi = 0; vi < ctorFn.varCount; vi++) {
                  if (ctorFn.getVarCausality(vi) === Causality.Input) {
                    const fName = ctorFn.getVarName(vi);
                    const fType = ctorFn.getVarType(vi);
                    let argExprId = -1;
                    if (modMap.has(fName)) {
                      const modVal = modMap.get(fName)!;
                      const modText = (modVal.text ?? "").replace(/^=/, "").trim();
                      const num = Number(modText);
                      if (!isNaN(num) && modText !== "") {
                        argExprId = fType === VarType.Integer ? dae.addIntLiteral(num) : dae.addRealLiteral(num);
                      } else if (/^[a-zA-Z_]\w*$/.test(modText)) {
                        argExprId = dae.addNameExpr(prefix ? `${prefix}.${modText}` : modText);
                      } else if (modVal.cstBytes && flattener.lowerExpr) {
                        const scopeSym = elemId ? flattener.db.symbol(elemId) : undefined;
                        const modCst = flattener.db.cstNodeRange(
                          modVal.cstBytes[0],
                          modVal.cstBytes[1],
                          scopeSym ?? undefined,
                        ) as any;
                        if (modCst) {
                          const exprCst =
                            modCst.type === "modification" || modCst.type === "modification_expression"
                              ? (findBindingExprNode(modCst) ?? modCst)
                              : modCst;
                          argExprId = flattener.lowerExpr(exprCst, dae, prefix);
                          if (fType === VarType.Real && !isRealExpr(argExprId, dae)) {
                            argExprId = castToRealExpr(argExprId, dae);
                          }
                        }
                      }
                    } else {
                      const defExpr = ctorFn.getVarExpression(vi);
                      if (defExpr !== undefined && defExpr >= 0) {
                        argExprId = copyExprBetweenDaes(ctorFn, defExpr, dae, boundEnv);
                      }
                    }
                    if (argExprId >= 0) {
                      boundEnv.set(fName, argExprId);
                      callArgIds.push(argExprId);
                    }
                  }
                }
                const ctorCallName = ctorFn.name || classTarget.name;
                const callExprId = dae.addCallExpr(ctorCallName, callArgIds);
                dae.setVarExpression(varIdx, callExprId);
              }
            }
            if (effectiveBinding?.text) {
              let bText = effectiveBinding.text.trim();
              let exprId: number | null = null;

              if (idxTuple.length > 0) {
                const evaluatedKey = prefix ? `${prefix}.${name}` : name;
                if (
                  flattener.evaluatedConstantArrays.has(evaluatedKey) ||
                  flattener.evaluatedConstantArrays.has(name)
                ) {
                  let val =
                    flattener.evaluatedConstantArrays.get(evaluatedKey) ?? flattener.evaluatedConstantArrays.get(name);
                  for (const idx of idxTuple) {
                    if (Array.isArray(val) && idx >= 1 && idx <= val.length) {
                      val = val[idx - 1];
                    } else {
                      val = null;
                      break;
                    }
                  }
                  if (typeof val === "number") {
                    exprId = varType === VarType.Integer ? dae.addIntLiteral(val) : dae.addRealLiteral(val);
                  }
                }
                if (exprId !== null) {
                  // Handled by evaluatedConstantArrays
                } else if (isArrayLiteral(bText) && !/\bfor\b/.test(bText)) {
                  bText = getIndexedElementText(bText, idxTuple);
                }
                if (/^zeros\s*\([^)]*\)$/.test(bText)) {
                  exprId = varType === VarType.Integer ? dae.addIntLiteral(0) : dae.addRealLiteral(0.0);
                } else if (/^ones\s*\([^)]*\)$/.test(bText)) {
                  bText = varType === VarType.Integer ? "1" : "1.0";
                  exprId = varType === VarType.Integer ? dae.addIntLiteral(1) : dae.addRealLiteral(1.0);
                } else if (/^identity\s*\([^)]*\)$/.test(bText) && idxTuple.length >= 2) {
                  const isDiag = idxTuple[0] === idxTuple[1];
                  bText = isDiag
                    ? varType === VarType.Integer
                      ? "1"
                      : "1.0"
                    : varType === VarType.Integer
                      ? "0"
                      : "0.0";
                  exprId = isDiag
                    ? varType === VarType.Integer
                      ? dae.addIntLiteral(1)
                      : dae.addRealLiteral(1.0)
                    : varType === VarType.Integer
                      ? dae.addIntLiteral(0)
                      : dae.addRealLiteral(0.0);
                } else if (bText.startsWith("diagonal(") && idxTuple.length >= 2) {
                  const isDiag = idxTuple[0] === idxTuple[1];
                  if (!isDiag) {
                    bText = varType === VarType.Integer ? "0" : "0.0";
                    exprId = varType === VarType.Integer ? dae.addIntLiteral(0) : dae.addRealLiteral(0.0);
                  } else {
                    const innerMatch = bText
                      .replace(/^\s*diagonal\s*\(\s*/, "")
                      .replace(/\s*\)\s*$/, "")
                      .trim();
                    const elemText = getIndexedElementText(innerMatch, [idxTuple[0]!]);
                    const numVal = Number(elemText);
                    if (!Number.isNaN(numVal)) {
                      bText =
                        varType === VarType.Real
                          ? Number.isInteger(numVal)
                            ? `${numVal}.0`
                            : String(numVal)
                          : elemText;
                      exprId = varType === VarType.Real ? dae.addRealLiteral(numVal) : dae.addIntLiteral(numVal);
                    } else {
                      bText = elemText;
                    }
                  }
                } else if (/^[a-zA-Z_]\w*$/.test(bText) && isArrayTarget(bText)) {
                  const resolvedTarget = resolveScopedName(bText, bindingPrefix, dae);
                  let indexedTarget = `${resolvedTarget}[${idxTuple.join(",")}]`;
                  const elemIndices = dae.getArrayElementIndices(resolvedTarget);
                  if (elemIndices.length > 0) {
                    let flatIdx = 0;
                    for (let d = 0; d < idxTuple.length; d++) {
                      const dimSize = arrayDims && arrayDims[d] ? arrayDims[d]! : 0;
                      flatIdx = dimSize > 0 ? flatIdx * dimSize + (idxTuple[d]! - 1) : idxTuple[d]! - 1;
                    }
                    if (flatIdx >= 0 && flatIdx < elemIndices.length) {
                      indexedTarget = dae.getVarName(elemIndices[flatIdx]!);
                    }
                  } else if (currentDimLabels && currentDimLabels.length > 0) {
                    const indexStr = `[${idxTuple.map((val, dIdx) => (currentDimLabels[dIdx] && currentDimLabels[dIdx]![val - 1] ? currentDimLabels[dIdx]![val - 1] : val)).join(",")}]`;
                    indexedTarget = `${resolvedTarget}${indexStr}`;
                  }
                  exprId = dae.addExpression(ExprKind.Name, dae.interner.intern(indexedTarget));
                } else if (/^-\s*[a-zA-Z_]\w*$/.test(bText)) {
                  const target = bText.replace(/^-\s*/, "");
                  if (isArrayTarget(target)) {
                    const resolvedTarget = resolveScopedName(target, bindingPrefix, dae);
                    let indexedTarget = `${resolvedTarget}[${idxTuple.join(",")}]`;
                    const elemIndices = dae.getArrayElementIndices(resolvedTarget);
                    if (elemIndices.length > 0) {
                      let flatIdx = 0;
                      for (let d = 0; d < idxTuple.length; d++) {
                        const dimSize = arrayDims && arrayDims[d] ? arrayDims[d]! : 0;
                        flatIdx = dimSize > 0 ? flatIdx * dimSize + (idxTuple[d]! - 1) : idxTuple[d]! - 1;
                      }
                      if (flatIdx >= 0 && flatIdx < elemIndices.length) {
                        indexedTarget = dae.getVarName(elemIndices[flatIdx]!);
                      }
                    } else if (currentDimLabels && currentDimLabels.length > 0) {
                      const indexStr = `[${idxTuple.map((val, dIdx) => (currentDimLabels[dIdx] && currentDimLabels[dIdx]![val - 1] ? currentDimLabels[dIdx]![val - 1] : val)).join(",")}]`;
                      indexedTarget = `${resolvedTarget}${indexStr}`;
                    }
                    const innerId = dae.addExpression(ExprKind.Name, dae.interner.intern(indexedTarget));
                    exprId = dae.addUnaryExpr(UnaryOp.Negate, innerId);
                  }
                } else if (bText.startsWith("fill(") && bText.endsWith(")")) {
                  const inside = bText.slice(5, -1).trim();
                  let depth = 0;
                  let commaIdx = -1;
                  for (let i = 0; i < inside.length; i++) {
                    const ch = inside[i];
                    if (ch === "(" || ch === "{" || ch === "[") depth++;
                    else if (ch === ")" || ch === "}" || ch === "]") depth--;
                    else if (ch === "," && depth === 0) {
                      commaIdx = i;
                      break;
                    }
                  }
                  const firstArg = commaIdx >= 0 ? inside.slice(0, commaIdx).trim() : inside;
                  if (dae.extensionMetadata?.["isOldFrontend"]) {
                    const loweredFirstArg = lowerStandaloneExpression(
                      flattener,
                      firstArg,
                      dae,
                      bindingPrefix,
                      compInst.name,
                      varType,
                    );
                    if (loweredFirstArg !== null) {
                      exprId = loweredFirstArg;
                    } else {
                      bText = firstArg;
                    }
                  } else {
                    bText = firstArg;
                  }
                } else if (bText.startsWith("array(") && bText.endsWith(")") && idxTuple.length > 0) {
                  const compMatch = bText.match(/^array\(\s*(.+?)\s+for\s+([a-zA-Z_]\w*)\s+in\s+(.+)\)$/s);
                  if (compMatch) {
                    const bodyStr = compMatch[1]!.trim();
                    const iterVar = compMatch[2]!;
                    const rangeExpr = compMatch[3]!.trim();
                    const rangeVals = evaluateComprehensionRangeValues(
                      rangeExpr,
                      flattener,
                      dae,
                      bindingPrefix,
                      flattener.currentClassId ?? undefined,
                    );
                    const iterVal =
                      rangeVals && idxTuple[0]! - 1 < rangeVals.length
                        ? rangeVals[idxTuple[0]! - 1]!
                        : String(idxTuple[0]);
                    bText = bodyStr.replace(new RegExp(`\\b${iterVar}\\b`, "g"), iterVal);
                  }
                } else {
                  const modChildForIf = elemCst?.children?.find((c: any) => c.type === "modification");
                  const rawExprCstForIf = findFirstExpressionCst(modChildForIf ?? elemCst);
                  const scalarizedIfId = tryScalarizeIfSizeBindingCst(
                    rawExprCstForIf,
                    bText,
                    idxTuple,
                    bindingPrefix,
                    dae,
                  );
                  if (scalarizedIfId !== null) {
                    exprId = scalarizedIfId;
                  }
                }
              }

              // Try lowering from CST node if available
              const findBindingExprNode = findFirstExpressionCst;

              const modChild = elemCst?.children?.find((c: any) => c.type === "modification");
              const exprCst = findBindingExprNode(modChild ?? elemCst);
              const varShapeAtIdx = dae.getVarShape(varIdx);
              const isPreservedArrayVar =
                (arrayDims && arrayDims.length > 0) || (varShapeAtIdx && varShapeAtIdx.length > 0);
              if (idxTuple.length === 0 && !isPreservedArrayVar && bText) {
                const cleanB = bText.replace(/^=/, "").trim();
                if (isArrayLiteral(cleanB) && !/\bfor\b/.test(cleanB)) {
                  const ctorElems = parseArrayLiteralElements(cleanB);
                  let clauseNode: any = elemCst;
                  while (clauseNode && clauseNode.type !== "component_clause") {
                    clauseNode = clauseNode.parent;
                  }
                  const rangeNode = clauseNode ?? elemCst;
                  const rangeObj = rangeNode
                    ? {
                        startByte: rangeNode.startIndex ?? rangeNode.startByte,
                        endByte: rangeNode.endIndex ?? rangeNode.endByte,
                        startPosition: rangeNode.startPosition,
                        endPosition: rangeNode.endPosition,
                      }
                    : undefined;
                  dae.diagnostics.push({
                    severity: "error",
                    code: ModelicaErrorCode.BINDING_DIMENSION_MISMATCH.code,
                    message: ModelicaErrorCode.BINDING_DIMENSION_MISMATCH.message(
                      compInst.name,
                      cleanB,
                      "",
                      String(ctorElems.length),
                    ),
                    range: rangeObj,
                  });
                  return;
                }
              }
              if (exprId === null && idxTuple.length === 0 && exprCst && exprCst.text?.trim() === bText) {
                const prevClassId = flattener.currentClassId;
                const elemOwnerId =
                  (effectiveBinding as any)?.evaluationScopeId ??
                  flattener.db.symbol(elemId)?.parentId ??
                  flattener.currentClassId;
                if (elemOwnerId) flattener.currentClassId = elemOwnerId;
                try {
                  exprId = flattener.lowerExpr(exprCst, dae, prefix);
                } finally {
                  flattener.currentClassId = prevClassId;
                }
                const providedType = inferArenaExprVarType(dae, exprId);
                let enumMismatch = false;
                let expectedEnumStr = "";
                let actualEnumStr = "";
                let actualEnumLit = "";
                if (
                  varType === VarType.Enumeration &&
                  exprId !== null &&
                  exprId >= 0 &&
                  dae.getExprKind(exprId) === ExprKind.EnumLiteral
                ) {
                  const fullLit = dae.interner.resolve(dae.getExprLeft(exprId)) ?? "";
                  const lastDot = fullLit.lastIndexOf(".");
                  const rhsTypePath = lastDot >= 0 ? fullLit.slice(0, lastDot) : "";
                  const rhsShortName = rhsTypePath.split(".").pop()!;
                  const rhsTypeSyms = flattener.db.byName(rhsShortName);
                  const rhsTypeSym = rhsTypeSyms.find((s) => s.kind === "Class") ?? rhsTypeSyms[0];
                  const rhsLits = rhsTypeSym
                    ? (extractEnumLiteralsFromCst(
                        flattener.db.cstNode(rhsTypeSym.id) as any,
                        rhsTypeSym.metadata as any,
                      ) ?? [])
                    : [];
                  const targetLits = enumLiterals
                    ? enumLiterals.map((l: any) => (typeof l === "string" ? l : (l.stringValue ?? l.name ?? String(l))))
                    : [];
                  const isSubtype = rhsLits.length > 0 && rhsLits.every((lit: string) => targetLits.includes(lit));
                  if (!isSubtype) {
                    enumMismatch = true;
                    expectedEnumStr = `enumeration(${targetLits.join(", ")})`;
                    actualEnumStr = `enumeration(${rhsLits.join(", ")})`;
                    actualEnumLit = fullLit;
                  }
                }
                if (
                  enumMismatch ||
                  (providedType !== null &&
                    !isAssignableType(providedType, varType, {
                      intEnumConversion: flattener.options?.intEnumConversion,
                    }))
                ) {
                  let clauseNode: any = elemCst;
                  while (clauseNode && clauseNode.type !== "component_clause") {
                    clauseNode = clauseNode.parent;
                  }
                  const rangeObj = clauseNode
                    ? {
                        startByte: clauseNode.startIndex ?? clauseNode.startByte,
                        endByte: clauseNode.endIndex ?? clauseNode.endByte,
                      }
                    : elemCst
                      ? {
                          startByte: elemCst.startIndex ?? elemCst.startByte,
                          endByte: elemCst.endIndex ?? elemCst.endByte,
                        }
                      : undefined;
                  const compName = prefix ? `.${prefix}.${compInst.name}` : `.${compInst.name}`;
                  const modExprText = bText.startsWith("=") ? bText : `=${bText}`;
                  let rhsText = bText.replace(/^=/, "").trim();
                  if (varType === VarType.Integer && providedType === VarType.Real && exprId !== null && exprId >= 0) {
                    const cVal = evalDaeExpr(exprId, dae);
                    if (typeof cVal === "number") {
                      rhsText = cVal.toFixed(1);
                    }
                  }
                  if (dae.extensionMetadata?.["isOldFrontend"] && dae.classKind === "function") {
                    dae.diagnostics.push({
                      severity: "error",
                      code: ModelicaErrorCode.TYPE_MISMATCH_MODIFIER_BINDING.code,
                      message: ModelicaErrorCode.TYPE_MISMATCH_MODIFIER_BINDING.message(
                        compName,
                        varTypeName(varType),
                        modExprText,
                        varTypeName(providedType ?? VarType.Real),
                      ),
                      range: rangeObj,
                    });
                  } else if (enumMismatch) {
                    dae.diagnostics.push({
                      severity: "error",
                      code: ModelicaErrorCode.TYPE_MISMATCH_BINDING.code,
                      message: ModelicaErrorCode.TYPE_MISMATCH_BINDING.message(
                        compInst.name,
                        expectedEnumStr,
                        actualEnumLit,
                        actualEnumStr,
                      ),
                      range: rangeObj,
                    });
                    return;
                  } else {
                    dae.diagnostics.push({
                      severity: "error",
                      code: ModelicaErrorCode.TYPE_MISMATCH_BINDING.code,
                      message: ModelicaErrorCode.TYPE_MISMATCH_BINDING.message(
                        compInst.name,
                        varTypeName(varType),
                        rhsText,
                        varTypeName(providedType ?? VarType.Real),
                      ),
                      range: rangeObj,
                    });
                  }
                } else if (varType === VarType.Real && !customType && !isRealExpr(exprId, dae)) {
                  exprId = castToRealExpr(exprId, dae);
                } else if (varType === VarType.Enumeration && providedType === VarType.Integer) {
                  const val = dae.getExprKind(exprId) === ExprKind.IntLiteral ? dae.getExprData1(exprId) : null;
                  if (val !== null && enumLiterals && val >= 1 && val <= enumLiterals.length) {
                    const lit = enumLiterals[val - 1]!;
                    const litName =
                      typeof lit === "string" ? lit : ((lit as any).stringValue ?? (lit as any).name ?? String(lit));
                    const enumPrefix = customType ?? "";
                    const fullEnumName = enumPrefix ? `${enumPrefix}.${litName}` : litName;
                    exprId = dae.addEnumLiteral(val, fullEnumName);
                  }
                }
              }

              if (exprId === null) {
                if (effectiveBinding.cstBytes && !/^array\s*\(.+\bfor\b.+\)$/s.test(effectiveBinding.text.trim())) {
                  const targetScopeId =
                    (effectiveBinding as any)?.evaluationScopeId ??
                    effectiveParentArg?.evaluationScopeId ??
                    effectiveClassArg?.evaluationScopeId ??
                    elemId ??
                    flattener.currentClassId ??
                    flattener.currentRootClassId;
                  const scopeSym = targetScopeId ? flattener.db.symbol(targetScopeId) : undefined;
                  const scopeClassId =
                    scopeSym?.kind === "Class" ? targetScopeId : (scopeSym?.parentId ?? flattener.currentClassId);
                  const bindCst = flattener.db.cstNodeRange(
                    effectiveBinding.cstBytes[0],
                    effectiveBinding.cstBytes[1],
                    scopeSym ?? undefined,
                  ) as any;
                  if (bindCst) {
                    const prevClassId = flattener.currentClassId;
                    if (scopeClassId) flattener.currentClassId = scopeClassId;
                    try {
                      let innerCst =
                        bindCst.type === "modification" || bindCst.type === "modification_expression"
                          ? (findBindingExprNode(bindCst) ?? bindCst)
                          : bindCst;
                      let scalarFactorExprId: number | null = null;
                      if (idxTuple.length > 0) {
                        if (innerCst && innerCst.children?.some((k: any) => k.text === "*")) {
                          const leftChild = innerCst.children?.[0];
                          const rightChild = innerCst.children?.[innerCst.children.length - 1];
                          const leftText = leftChild?.text?.trim() ?? "";
                          const rightText = rightChild?.text?.trim() ?? "";
                          if (rightText.startsWith("{") || rightText.startsWith("[")) {
                            scalarFactorExprId = flattener.lowerExpr(leftChild, dae, bindingPrefix);
                            innerCst = rightChild;
                          } else if (leftText.startsWith("{") || leftText.startsWith("[")) {
                            scalarFactorExprId = flattener.lowerExpr(rightChild, dae, bindingPrefix);
                            innerCst = leftChild;
                          }
                        }

                        const text = innerCst?.text?.trim() ?? "";
                        const isBracket =
                          (innerCst?.child(0)?.text === "[" || text.startsWith("[")) &&
                          (innerCst?.child(innerCst?.childCount - 1)?.text === "]" || text.endsWith("]"));
                        const isBrace = isArrayLiteral(text) && !/\bfor\b/.test(text);
                        if (isBracket && idxTuple.length === 2) {
                          const rows = getArrayLiteralItems(innerCst);
                          const rowIdx = idxTuple[0]!;
                          const colIdx = idxTuple[1]!;
                          if (
                            (!arrayDims || arrayDims.length < 2 || rows.length === arrayDims[0]) &&
                            rowIdx >= 1 &&
                            rowIdx <= rows.length
                          ) {
                            const rowNode = rows[rowIdx - 1];
                            const cols = getArrayLiteralItems(rowNode);
                            if (
                              (!arrayDims || arrayDims.length < 2 || cols.length === arrayDims[1]) &&
                              colIdx >= 1 &&
                              colIdx <= cols.length &&
                              !cols[colIdx - 1]?.text?.includes(":")
                            ) {
                              innerCst = cols[colIdx - 1];
                            } else {
                              innerCst = null;
                            }
                          } else {
                            innerCst = null;
                          }
                        } else if (isBracket || isBrace) {
                          for (const idx of idxTuple) {
                            if (!innerCst) break;
                            const nodeIsArray =
                              innerCst.child(0)?.text === "[" ||
                              innerCst.text?.startsWith("[") ||
                              innerCst.child(0)?.text === "{" ||
                              innerCst.text?.startsWith("{");
                            if (!nodeIsArray) {
                              innerCst = null;
                              break;
                            }
                            const items = getArrayLiteralItems(innerCst);
                            if (items.length >= idx) {
                              innerCst = items[idx - 1];
                              if (innerCst?.text?.includes(":")) {
                                innerCst = null;
                                break;
                              }
                            } else {
                              innerCst = null;
                              break;
                            }
                          }
                        } else {
                          innerCst = null;
                        }
                      }
                      if (!innerCst && idxTuple.length > 0) {
                        const rawBindCst =
                          bindCst.type === "modification" || bindCst.type === "modification_expression"
                            ? (findBindingExprNode(bindCst) ?? bindCst)
                            : bindCst;
                        const loweredBindId = flattener.lowerExpr(rawBindCst, dae, bindingPrefix);
                        if (loweredBindId >= 0) {
                          const isConstOrFinalParamTree = (id: number): boolean => {
                            const k = dae.getExprKind(id);
                            if (k === ExprKind.RealLiteral || k === ExprKind.IntLiteral || k === ExprKind.BoolLiteral) {
                              return true;
                            }
                            if (k === ExprKind.Negate || k === ExprKind.Unary) {
                              return isConstOrFinalParamTree(dae.getExprLeft(id));
                            }
                            if (k === ExprKind.Binary) {
                              return (
                                isConstOrFinalParamTree(dae.getExprLeft(id)) &&
                                isConstOrFinalParamTree(dae.getExprRight(id))
                              );
                            }
                            if (k === ExprKind.Name) {
                              const vName = dae.interner.resolve(dae.getExprData1(id)) ?? "";
                              const vIdx = dae.lookupVariable(vName);
                              if (vIdx >= 0) {
                                const vVar = dae.getVarVariability(vIdx);
                                return (
                                  vVar === Variability.Constant ||
                                  (vVar === Variability.Parameter && dae.isVarFinal(vIdx))
                                );
                              }
                            }
                            return false;
                          };
                          const inlineArrayCtorLiterals = (id: number): number => {
                            if (dae.getExprKind(id) === ExprKind.ArrayCtor) {
                              const elems = getArrayCtorElements(id, dae);
                              return dae.addArrayCtorExpr(elems.map(inlineArrayCtorLiterals));
                            }
                            if (dae.getExprKind(id) === ExprKind.Name) {
                              const vName = dae.interner.resolve(dae.getExprData1(id)) ?? "";
                              const vIdx = dae.lookupVariable(vName);
                              if (vIdx >= 0) {
                                const vExpr = dae.getVarExpression(vIdx);
                                if (
                                  vExpr !== undefined &&
                                  vExpr >= 0 &&
                                  (dae.getExprKind(vExpr) === ExprKind.RealLiteral ||
                                    dae.getExprKind(vExpr) === ExprKind.IntLiteral ||
                                    dae.getExprKind(vExpr) === ExprKind.Negate)
                                ) {
                                  return vExpr;
                                }
                              }
                            }
                            if (isConstOrFinalParamTree(id)) {
                              const val = evalDaeExpr(id, dae);
                              if (val !== null && Number.isFinite(val)) {
                                return dae.addRealLiteral(val);
                              }
                            }
                            return id;
                          };
                          const prepareCallForScalarization = (callExprId: number): number => {
                            const fnNameId = dae.getExprData1(callExprId);
                            let callFnName = dae.interner.resolve(fnNameId) ?? "";
                            const argCount = dae.getExprRight(callExprId);
                            const firstArg = dae.getExprLeft(callExprId);
                            let fnObj = dae.getFunction(callFnName);
                            const shortFnName = callFnName.includes(".") ? callFnName.split(".").pop()! : callFnName;
                            const matchingFnSym = flattener.db
                              .byName(shortFnName)
                              .find((e) => flattener["isFunctionSym"](e));
                            if (matchingFnSym) {
                              const qualFnName = getSymbolQualifiedName(flattener.db, matchingFnSym.id);
                              if (!callFnName.includes(".") && qualFnName.includes(".")) {
                                callFnName = qualFnName;
                              }
                              if (!fnObj) {
                                fnObj =
                                  dae.getFunction(qualFnName) ??
                                  flattener.flattenFunction(matchingFnSym.id, qualFnName, undefined, dae);
                                dae.addFunction(qualFnName, fnObj);
                              }
                              (fnObj as any).wasCalled = true;
                              flattener.calledFunctionSymIds?.add(matchingFnSym.id);
                            }
                            const newArgs: number[] = [];
                            for (let aIdx = 0; aIdx < argCount; aIdx++) {
                              const aId = aIdx === 0 ? firstArg : dae.getExprLeft(callExprId + aIdx);
                              if (dae.getExprKind(aId) === ExprKind.ArrayCtor) {
                                newArgs.push(inlineArrayCtorLiterals(aId));
                                continue;
                              }
                              if (dae.getExprKind(aId) === ExprKind.Name) {
                                const aName = dae.interner.resolve(dae.getExprData1(aId)) ?? "";
                                if (dae.hasArrayElements(aName)) {
                                  const aShape = getNamedArrayShape(dae, aName);
                                  const elemIndices = dae.getArrayElementIndices(aName);
                                  if (
                                    elemIndices.length > 0 &&
                                    elemIndices.every((eIdx) => (dae.getVarExpression(eIdx) ?? -1) >= 0)
                                  ) {
                                    const buildNested = (indices: number[], shape: number[]): number => {
                                      if (shape.length <= 1) {
                                        return dae.addArrayCtorExpr(
                                          indices.map((eIdx) => dae.getVarExpression(eIdx) ?? -1),
                                        );
                                      }
                                      const subLen = shape.slice(1).reduce((acc, d) => acc * d, 1);
                                      const rowIds: number[] = [];
                                      for (let r = 0; r < shape[0]!; r++) {
                                        rowIds.push(
                                          buildNested(indices.slice(r * subLen, (r + 1) * subLen), shape.slice(1)),
                                        );
                                      }
                                      return dae.addArrayCtorExpr(rowIds);
                                    };
                                    newArgs.push(
                                      buildNested(
                                        elemIndices,
                                        aShape && aShape.length > 0 ? aShape : [elemIndices.length],
                                      ),
                                    );
                                    continue;
                                  }
                                }
                                const vIdx = dae.lookupVariable(aName);
                                if (
                                  vIdx >= 0 &&
                                  (dae.getVarVariability(vIdx) === Variability.Constant ||
                                    (dae.getVarVariability(vIdx) === Variability.Parameter &&
                                      (dae.isVarFinal(vIdx) || dae.getVarType(vIdx) === VarType.Integer)))
                                ) {
                                  const vExpr = dae.getVarExpression(vIdx);
                                  if (vExpr !== undefined && vExpr >= 0) {
                                    newArgs.push(vExpr);
                                    continue;
                                  }
                                }
                              }
                              newArgs.push(aId);
                            }
                            return dae.addCallExpr(callFnName, newArgs);
                          };
                          let curr = loweredBindId;
                          let ok = true;
                          for (let i = 0; i < idxTuple.length; i++) {
                            const idx = idxTuple[i]!;
                            const elems = getArrayCtorElements(curr, dae);
                            if (
                              idx >= 1 &&
                              idx <= elems.length &&
                              (dae.getExprKind(curr) === ExprKind.ArrayCtor ||
                                dae.getExprKind(curr) === ExprKind.IfElse)
                            ) {
                              curr = elems[idx - 1]!;
                            } else if (dae.getExprKind(curr) === ExprKind.Name) {
                              const varName = dae.interner.resolve(dae.getExprData1(curr));
                              const remaining = idxTuple.slice(i);
                              const indexedTarget = `${varName}[${remaining.join(",")}]`;
                              curr = dae.addExpression(ExprKind.Name, dae.interner.intern(indexedTarget));
                              ok = true;
                              break;
                            } else if (dae.getExprKind(curr) === ExprKind.Call) {
                              const rebuiltCall = prepareCallForScalarization(curr);
                              const remaining = idxTuple.slice(i);
                              curr = dae.addSubscriptExpr(
                                rebuiltCall,
                                remaining.map((r) => dae.addIntLiteral(r)),
                              );
                              ok = true;
                              break;
                            } else if (dae.getExprKind(curr) === ExprKind.Binary) {
                              const remaining = idxTuple.slice(i);
                              const scalarizeVecExpr = (eId: number, rem: number[]): number | null => {
                                const ek = dae.getExprKind(eId);
                                const eDims = getExprDims(eId, dae, flattener.db, flattener);
                                if (!eDims || eDims.length === 0) {
                                  if (ek === ExprKind.Binary) {
                                    const op = dae.getExprData1(eId);
                                    const lId = dae.getExprLeft(eId);
                                    const rId = dae.getExprRight(eId);
                                    const lDims = getExprDims(lId, dae, flattener.db, flattener);
                                    const rDims = getExprDims(rId, dae, flattener.db, flattener);
                                    if ((lDims && lDims.length > 0) || (rDims && rDims.length > 0)) {
                                      const sl = lDims && lDims.length > 0 ? scalarizeVecExpr(lId, rem) : lId;
                                      const sr = rDims && rDims.length > 0 ? scalarizeVecExpr(rId, rem) : rId;
                                      if (sl !== null && sr !== null) return dae.addBinaryExpr(op, sl, sr);
                                    }
                                  }
                                  return eId;
                                }
                                if (ek === ExprKind.ArrayCtor || ek === ExprKind.IfElse) {
                                  let sub = eId;
                                  for (const rIdx of rem) {
                                    const subElems = getArrayCtorElements(sub, dae);
                                    if (rIdx >= 1 && rIdx <= subElems.length) {
                                      sub = subElems[rIdx - 1]!;
                                    } else {
                                      return null;
                                    }
                                  }
                                  return sub;
                                }
                                if (ek === ExprKind.Name) {
                                  const vName = dae.interner.resolve(dae.getExprData1(eId));
                                  return dae.addExpression(
                                    ExprKind.Name,
                                    dae.interner.intern(`${vName}[${rem.join(",")}]`),
                                  );
                                }
                                if (ek === ExprKind.Call) {
                                  const callVal = evalDaeExpr(eId, dae);
                                  if (Array.isArray(callVal)) {
                                    let cur: any = callVal;
                                    for (const r of rem) {
                                      cur = Array.isArray(cur) ? cur[r - 1] : undefined;
                                    }
                                    if (typeof cur === "number" && Number.isFinite(cur)) {
                                      return dae.addRealLiteral(cur);
                                    }
                                  }
                                  const rebuiltCall = prepareCallForScalarization(eId);
                                  return dae.addSubscriptExpr(
                                    rebuiltCall,
                                    rem.map((r) => dae.addIntLiteral(r)),
                                  );
                                }
                                if (ek === ExprKind.Binary) {
                                  const op = dae.getExprData1(eId);
                                  const lId = dae.getExprLeft(eId);
                                  const rId = dae.getExprRight(eId);
                                  const lDims = getExprDims(lId, dae, flattener.db, flattener);
                                  const rDims = getExprDims(rId, dae, flattener.db, flattener);
                                  const sl = lDims && lDims.length > 0 ? scalarizeVecExpr(lId, rem) : lId;
                                  const sr = rDims && rDims.length > 0 ? scalarizeVecExpr(rId, rem) : rId;
                                  if (sl !== null && sr !== null) {
                                    if (op === BinOp.Mul) return mulWithSimplification(sl, sr, dae);
                                    if (op === BinOp.Add) {
                                      const isLitZero = (id: number) =>
                                        (dae.getExprKind(id) === ExprKind.RealLiteral &&
                                          dae.getExprRealValue(id) === 0) ||
                                        (dae.getExprKind(id) === ExprKind.IntLiteral && dae.getExprData1(id) === 0);
                                      if (isLitZero(sl)) return sr;
                                      if (isLitZero(sr)) return sl;
                                    }
                                    return dae.addBinaryExpr(op, sl, sr);
                                  }
                                }
                                if (ek === ExprKind.Negate || ek === ExprKind.Unary) {
                                  const sChild = scalarizeVecExpr(dae.getExprLeft(eId), rem);
                                  if (sChild !== null) {
                                    return ek === ExprKind.Negate
                                      ? dae.addNegateExpr(sChild)
                                      : dae.addUnaryExpr(dae.getExprData1(eId), sChild);
                                  }
                                }
                                return null;
                              };
                              const sRes = scalarizeVecExpr(curr, remaining);
                              if (sRes !== null) {
                                curr = sRes;
                                ok = true;
                              } else {
                                ok = false;
                              }
                              break;
                            } else {
                              ok = false;
                              break;
                            }
                          }
                          if (ok) {
                            exprId = curr;
                          }
                        }
                      } else if (innerCst) {
                        exprId = flattener.lowerExpr(innerCst, dae, bindingPrefix);
                        if (scalarFactorExprId !== null && exprId >= 0) {
                          exprId = mulWithSimplification(scalarFactorExprId, exprId, dae);
                        }
                      }
                    } finally {
                      flattener.currentClassId = prevClassId;
                    }
                    if (exprId !== null && exprId >= 0) {
                      const providedType = inferArenaExprVarType(dae, exprId);
                      if (
                        providedType !== null &&
                        !isAssignableType(providedType, varType, {
                          intEnumConversion: flattener.options?.intEnumConversion,
                        })
                      ) {
                        let clauseNode: any = elemCst;
                        while (clauseNode && clauseNode.type !== "component_clause") {
                          clauseNode = clauseNode.parent;
                        }
                        const rangeObj = clauseNode
                          ? {
                              startByte: clauseNode.startIndex ?? clauseNode.startByte,
                              endByte: clauseNode.endIndex ?? clauseNode.endByte,
                            }
                          : elemCst
                            ? {
                                startByte: elemCst.startIndex ?? elemCst.startByte,
                                endByte: elemCst.endIndex ?? elemCst.endByte,
                              }
                            : undefined;
                        const compName = prefix ? `.${prefix}.${compInst.name}` : `.${compInst.name}`;
                        const modExprText = bText.startsWith("=") ? bText : `=${bText}`;
                        if (varType === VarType.Integer && providedType === VarType.Real) {
                          let rhsText = bText.replace(/^=/, "").trim();
                          if (exprId !== null && exprId >= 0) {
                            const cVal = evalDaeExpr(exprId, dae);
                            if (typeof cVal === "number") {
                              rhsText = cVal.toFixed(1);
                            }
                          }
                          dae.diagnostics.push({
                            severity: "error",
                            code: ModelicaErrorCode.TYPE_MISMATCH_BINDING.code,
                            message: ModelicaErrorCode.TYPE_MISMATCH_BINDING.message(
                              compInst.name,
                              "Integer",
                              rhsText,
                              "Real",
                            ),
                            range: rangeObj,
                          });
                        } else if (
                          !prefix &&
                          (!dae.extensionMetadata?.["isOldFrontend"] || dae.classKind !== "function")
                        ) {
                          let rhsText = bText.replace(/^=/, "").trim();
                          dae.diagnostics.push({
                            severity: "error",
                            code: ModelicaErrorCode.TYPE_MISMATCH_BINDING.code,
                            message: ModelicaErrorCode.TYPE_MISMATCH_BINDING.message(
                              compInst.name,
                              varTypeName(varType),
                              rhsText,
                              varTypeName(providedType),
                            ),
                            range: rangeObj,
                          });
                        } else {
                          dae.diagnostics.push({
                            severity: "error",
                            code: ModelicaErrorCode.TYPE_MISMATCH_MODIFIER_BINDING.code,
                            message: ModelicaErrorCode.TYPE_MISMATCH_MODIFIER_BINDING.message(
                              compName,
                              varTypeName(varType),
                              modExprText,
                              varTypeName(providedType),
                            ),
                            range: rangeObj,
                          });
                        }
                      } else if (varType === VarType.Real && !customType && !isRealExpr(exprId, dae)) {
                        exprId = castToRealExpr(exprId, dae);
                      } else if (varType === VarType.Enumeration && providedType === VarType.Integer) {
                        const val = dae.getExprKind(exprId) === ExprKind.IntLiteral ? dae.getExprData1(exprId) : null;
                        if (val !== null && enumLiterals && val >= 1 && val <= enumLiterals.length) {
                          const lit = enumLiterals[val - 1]!;
                          const litName =
                            typeof lit === "string"
                              ? lit
                              : ((lit as any).stringValue ?? (lit as any).name ?? String(lit));
                          const enumPrefix = customType ?? "";
                          const fullEnumName = enumPrefix ? `${enumPrefix}.${litName}` : litName;
                          exprId = dae.addEnumLiteral(val, fullEnumName);
                        }
                      }
                    }
                  }
                }
              }

              if (
                exprId === null &&
                bText &&
                (bText.includes("(") ||
                  bText.includes("*") ||
                  bText.includes("/") ||
                  bText.includes("+") ||
                  bText.includes("-"))
              ) {
                exprId = lowerStandaloneExpression(flattener, bText, dae, bindingPrefix, compInst.name, varType);
              }

              if (exprId === null) {
                const isPureInt = /^[+-]?\d+$/.test(bText);
                const isPureReal = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(bText);
                if (varType === VarType.Real && (isPureReal || isPureInt)) {
                  exprId = dae.addRealLiteral(parseFloat(bText));
                } else if (varType === VarType.Integer && isPureInt) {
                  exprId = dae.addIntLiteral(parseInt(bText, 10));
                } else if (varType === VarType.Enumeration && isPureInt) {
                  const val = parseInt(bText, 10);
                  if (enumLiterals && val >= 1 && val <= enumLiterals.length) {
                    const lit = enumLiterals[val - 1]!;
                    const litName =
                      typeof lit === "string" ? lit : ((lit as any).stringValue ?? (lit as any).name ?? String(lit));
                    const enumPrefix = customType ?? "";
                    const fullEnumName = enumPrefix ? `${enumPrefix}.${litName}` : litName;
                    exprId = dae.addEnumLiteral(val, fullEnumName);
                  }
                } else if (varType === VarType.Boolean && (bText === "true" || bText === "false")) {
                  exprId = dae.addExpression(ExprKind.BoolLiteral, bText === "true" ? 1 : 0);
                } else if (varType === VarType.String && bText.startsWith('"') && bText.endsWith('"')) {
                  exprId = dae.addStringLiteral(bText.slice(1, -1));
                } else if (bText.includes("/")) {
                  const parts = bText.split("/");
                  if (parts.length === 2) {
                    const numL = Number(parts[0]!.trim());
                    let denom = parts[1]!.trim();
                    if (denom.startsWith("(") && denom.endsWith(")")) {
                      denom = denom.slice(1, -1).trim();
                    }
                    let numExpr = !isNaN(numL)
                      ? varType === VarType.Real
                        ? dae.addRealLiteral(numL)
                        : dae.addIntLiteral(numL)
                      : dae.addExpression(
                          ExprKind.Name,
                          dae.interner.intern(resolveScopedName(parts[0]!.trim(), bindingPrefix, dae)),
                        );
                    let denomExpr: number;
                    if (denom.includes("*")) {
                      const subParts = denom.split("*").map((p: string) => p.trim());
                      let mulExpr: number | null = null;
                      for (const p of subParts) {
                        const pName = resolveScopedName(p, bindingPrefix, dae);
                        const pExpr = dae.addExpression(ExprKind.Name, dae.interner.intern(pName));
                        mulExpr = mulExpr === null ? pExpr : dae.addBinaryExpr(BinOp.Mul, mulExpr, pExpr);
                      }
                      denomExpr = mulExpr!;
                    } else {
                      const denomResolved = resolveScopedName(denom, bindingPrefix, dae);
                      denomExpr = dae.addExpression(ExprKind.Name, dae.interner.intern(denomResolved));
                      const denomVarIdx = dae.lookupVariable(denomResolved);
                      if (
                        varType === VarType.Real &&
                        denomVarIdx >= 0 &&
                        dae.getVarType(denomVarIdx) === VarType.Integer
                      ) {
                        denomExpr = dae.addCallExpr("/*Real*/", [denomExpr]);
                      }
                    }
                    if (isNaN(numL)) {
                      const numResolved = resolveScopedName(parts[0]!.trim(), bindingPrefix, dae);
                      const numVarIdx = dae.lookupVariable(numResolved);
                      if (varType === VarType.Real && numVarIdx >= 0 && dae.getVarType(numVarIdx) === VarType.Integer) {
                        numExpr = dae.addCallExpr("/*Real*/", [numExpr]);
                      }
                    }
                    exprId = dae.addBinaryExpr(BinOp.Div, numExpr, denomExpr);
                  } else {
                    const resolvedBText = resolveScopedName(bText, bindingPrefix, dae);
                    exprId = dae.addExpression(ExprKind.Name, dae.interner.intern(resolvedBText));
                  }
                } else if (bText.includes("*")) {
                  const parts = bText.split("*");
                  if (parts.length === 2) {
                    const leftStr = parts[0]!.trim();
                    const rightStr = parts[1]!.trim();
                    const leftNum = Number(leftStr);
                    const rightNum = Number(rightStr);
                    const leftExpr = !isNaN(leftNum)
                      ? varType === VarType.Real
                        ? dae.addRealLiteral(leftNum)
                        : dae.addIntLiteral(leftNum)
                      : dae.addExpression(
                          ExprKind.Name,
                          dae.interner.intern(resolveScopedName(leftStr, bindingPrefix, dae)),
                        );
                    const rightExpr = !isNaN(rightNum)
                      ? varType === VarType.Real
                        ? dae.addRealLiteral(rightNum)
                        : dae.addIntLiteral(rightNum)
                      : dae.addExpression(
                          ExprKind.Name,
                          dae.interner.intern(resolveScopedName(rightStr, bindingPrefix, dae)),
                        );
                    exprId = dae.addBinaryExpr(BinOp.Mul, leftExpr, rightExpr);
                  } else {
                    const resolvedBText = resolveScopedName(bText, bindingPrefix, dae);
                    exprId = dae.addExpression(ExprKind.Name, dae.interner.intern(resolvedBText));
                  }
                } else {
                  const resolvedBText = resolveScopedName(bText, bindingPrefix, dae);
                  if (
                    idxTuple.length > 0 &&
                    (dae.getVarIdxByName(`${resolvedBText}[${idxTuple.join(",")}]`) >= 0 ||
                      dae.hasArrayElements(resolvedBText) ||
                      isArrayTarget(bText))
                  ) {
                    exprId = dae.addExpression(
                      ExprKind.Name,
                      dae.interner.intern(`${resolvedBText}[${idxTuple.join(",")}]`),
                    );
                  } else {
                    exprId = dae.addExpression(ExprKind.Name, dae.interner.intern(resolvedBText));
                  }
                }
              }

              const isRecordParamOrConst =
                Boolean(
                  parentMods?.isRecord &&
                  (varType !== VarType.Real || isParentBoundField || (effectiveParentArg as any)?.isRecordCtorArg),
                ) ||
                dae.classKind === "function" ||
                dae.classKind === "record" ||
                parentMods?.parentVariability === Variability.Parameter ||
                parentMods?.parentVariability === Variability.Constant;
              if (
                !isRecordParamOrConst &&
                dae.classKind !== "function" &&
                dae.classKind !== "record" &&
                (variability === Variability.Continuous || variability === Variability.Discrete) &&
                arrayDims &&
                arrayDims.length > 0 &&
                !dae.extensionMetadata?.["scalarizeBindings"]
              ) {
                // Continuous array binding is emitted as an equation, not a variable expression
                if (
                  (flattener.options.arrayMode === "preserve" || !effectiveBinding?.text) &&
                  exprId !== null &&
                  exprId >= 0
                ) {
                  const lhsExprId = dae.addNameExpr(dae.getVarName(varIdx));
                  dae.addEquation(EqKind.Simple, lhsExprId, exprId);
                }
              } else {
                if (exprId !== null && (varType === VarType.Integer || varType === VarType.Real)) {
                  // Only fold to literal when the binding is a pure constant expression with no variable
                  // references. OMC preserves symbolic parameter bindings (e.g., `= height[1]`) rather
                  // than folding them to literals — folding removes parametric dependencies.
                  if (!exprContainsNameRef(exprId, dae)) {
                    const evaluated = evalDaeExpr(exprId, dae);
                    if (typeof evaluated === "number") {
                      exprId =
                        varType === VarType.Integer
                          ? dae.addIntLiteral(Math.round(evaluated))
                          : dae.addRealLiteral(evaluated);
                    }
                  }
                }
                if (exprId !== null) dae.setVarExpression(varIdx, exprId);
                if (
                  !flattener.options.omcCompatibility &&
                  !isRecordParamOrConst &&
                  dae.classKind !== "function" &&
                  dae.classKind !== "record" &&
                  (variability === Variability.Continuous || variability === Variability.Discrete) &&
                  exprId !== null &&
                  exprId >= 0 &&
                  exprContainsNameRef(exprId, dae)
                ) {
                  const lhsExprId = dae.addNameExpr(dae.getVarName(varIdx));
                  dae.addEquation(EqKind.Simple, lhsExprId, exprId);
                }
              }
            }
            // Merge attribute modifiers in precedence order (type alias -> class mod -> component mod -> parent mod)
            // so later modifiers override earlier defaults on `varIdx`.
            const combinedArgs = [
              ...typeMods,
              ...(matchingClassArg?.nestedArgs || matchingClassArg?.args || []),
              ...(compInst?.modification?.args || []),
              ...(parentMods?.args
                ?.filter((a: any) => !a.isBreak && a.name === compInst.name)
                .flatMap((a: any) =>
                  (a.nestedArgs || a.args || []).map((na: any) => ({
                    ...na,
                    fromParentMod: !a.isExtendsMod || Boolean(a.isFromParentExtends),
                    originPrefix: na.originPrefix ?? a.originPrefix,
                    ownerClassId: na.ownerClassId ?? a.ownerClassId ?? parentMods?.ownerClassId,
                  })),
                ) || []),
            ];
            flattener.currentBindingCompName = undefined;
            for (const arg of combinedArgs) {
              if (
                arg.name === "quantity" ||
                arg.name === "unit" ||
                arg.name === "displayUnit" ||
                arg.name === "min" ||
                arg.name === "max" ||
                arg.name === "start" ||
                arg.name === "fixed" ||
                arg.name === "nominal" ||
                arg.name === "stateSelect"
              ) {
                if (arg.isBreak || arg.value?.kind === "break" || arg.value?.text?.trim() === "break") {
                  dae.removeVarAttr(varIdx, arg.name);
                  continue;
                }
                let attrExprId: number | null = null;
                if (arg.value?.kind === "literal") {
                  if (typeof arg.value.value === "number") {
                    attrExprId =
                      varType === VarType.Integer
                        ? dae.addIntLiteral(arg.value.value)
                        : dae.addRealLiteral(arg.value.value);
                  } else if (typeof arg.value.value === "boolean") {
                    attrExprId = dae.addExpression(ExprKind.BoolLiteral, arg.value.value ? 1 : 0);
                  } else if (typeof arg.value.value === "string") {
                    attrExprId = dae.addExpression(ExprKind.StringLiteral, dae.interner.intern(arg.value.value));
                  }
                } else if (arg.value?.kind === "expression" && arg.value.text) {
                  let t = arg.value.text.trim();
                  // Slice array-valued attribute expressions (`{...}`, `fill(...)`, `ones(...)`, `zeros(...)`)
                  // by the current scalarized element's `idxTuple`.
                  if (idxTuple.length > 0) {
                    if (t.startsWith("{")) {
                      t = getIndexedElementText(t, idxTuple);
                    } else if (t.startsWith("fill(")) {
                      const inside = t.slice(5, -1).trim();
                      const firstArg = inside.split(",")[0].trim();
                      t = firstArg;
                    } else if (t.startsWith("ones(")) {
                      t = varType === VarType.Integer ? "1" : "1.0";
                    } else if (t.startsWith("zeros(")) {
                      t = varType === VarType.Integer ? "0" : "0.0";
                    }
                  } else if (t.startsWith("fill(")) {
                    const inside = t.slice(5, -1).trim();
                    const firstArg = inside.split(",")[0].trim();
                    t = firstArg;
                  } else if (t.startsWith("ones(")) {
                    t = varType === VarType.Integer ? "1" : "1.0";
                  } else if (t.startsWith("zeros(")) {
                    t = varType === VarType.Integer ? "0" : "0.0";
                  }
                  if (t === "true" || t === "false") {
                    attrExprId = dae.addExpression(ExprKind.BoolLiteral, t === "true" ? 1 : 0);
                  } else if (!isNaN(parseFloat(t))) {
                    attrExprId =
                      varType === VarType.Integer
                        ? dae.addIntLiteral(parseInt(t, 10))
                        : dae.addRealLiteral(parseFloat(t));
                  } else {
                    const effAttrPrefix = (arg as any).fromParentMod
                      ? ((arg as any).originPrefix ??
                        (prefix.includes(".") ? prefix.split(".").slice(0, -1).join(".") : ""))
                      : bindingPrefix;
                    let resolvedT = /^[a-zA-Z_]\w*(\.[a-zA-Z_]\w*)*$/.test(t)
                      ? resolveScopedName(t, effAttrPrefix, dae)
                      : t;
                    // Qualify enumeration literal names in attributes (`start = Enum.lit` or `lit`)
                    if (varType === VarType.Enumeration && customType && enumLiterals) {
                      const enumShort = customType.split(".").pop()!;
                      if (t.startsWith(`${enumShort}.`)) {
                        resolvedT = `${customType}.${t.slice(enumShort.length + 1)}`;
                      } else if (enumLiterals.some((el: any) => el.stringValue === t)) {
                        resolvedT = `${customType}.${t}`;
                      } else if (t.includes(".")) {
                        const litSuffix = t.split(".").pop()!;
                        if (enumLiterals.some((el: any) => el.stringValue === litSuffix)) {
                          resolvedT = `${customType}.${litSuffix}`;
                        }
                      }
                    }
                    let isDaeVar =
                      dae.getVarIdxByName(resolvedT) >= 0 ||
                      dae.getVarIdxByName(`${resolvedT}[1]`) >= 0 ||
                      isArrayTarget(t);
                    if (isDaeVar && flattener.options.omcCompatibility) {
                      const directIdx = dae.getVarIdxByName(resolvedT);
                      const arrIdx = dae.getVarIdxByName(`${resolvedT}[1]`);
                      if (
                        (directIdx >= 0 && dae.getVarVariability(directIdx) === Variability.Constant) ||
                        (arrIdx >= 0 && dae.getVarVariability(arrIdx) === Variability.Constant)
                      ) {
                        isDaeVar = false;
                      }
                    }
                    const elemParentId =
                      flattener.db.symbol(elemId)?.parentId || flattener.currentClassId || flattener.currentRootClassId;
                    if (!isDaeVar && effAttrPrefix && /^[a-zA-Z_]\w*$/.test(t) && elemParentId) {
                      const isNonConstComp = (c: any) =>
                        c.kind === "Component" &&
                        c.name === t &&
                        !(flattener.options.omcCompatibility && flattener.db.query("variability", c.id) === "constant");
                      const candClassIds = [
                        elemParentId,
                        flattener.currentClassId,
                        parentMods?.currentClassId,
                        parentMods?.ownerClassId,
                        (arg as any).ownerClassId,
                      ].filter((id): id is SymbolId => id != null);
                      const siblingComp = candClassIds.some(
                        (clsId) =>
                          flattener.db.childrenOf(clsId)?.some(isNonConstComp) ||
                          flattener.db.query<SymbolId[]>("instantiate", clsId)?.some((sid) => {
                            const s = flattener.db.symbol(sid);
                            return s ? isNonConstComp(s) : false;
                          }),
                      );
                      if (siblingComp) {
                        resolvedT = `${effAttrPrefix}.${t}`;
                        isDaeVar = true;
                      }
                    }
                    if (
                      isDaeVar &&
                      !t.includes("(") &&
                      !t.includes("+") &&
                      !t.includes("-") &&
                      !t.includes("*") &&
                      !t.includes("/")
                    ) {
                      if (idxTuple.length > 0 && (dae.getVarIdxByName(`${resolvedT}[1]`) >= 0 || isArrayTarget(t))) {
                        attrExprId = dae.addExpression(
                          ExprKind.Name,
                          dae.interner.intern(`${resolvedT}[${idxTuple.join(",")}]`),
                        );
                      } else {
                        attrExprId = dae.addExpression(ExprKind.Name, dae.interner.intern(resolvedT));
                      }
                    } else {
                      const subParts =
                        dae.extensionMetadata?.["isOldFrontend"] && arg.name === "start"
                          ? t.match(/^([a-zA-Z_][a-zA-Z0-9_.]*)\s*-\s*([a-zA-Z_][a-zA-Z0-9_.]*)$/)
                          : null;
                      if (subParts && subParts[1] && subParts[2]) {
                        const p1 = resolveScopedName(subParts[1], effAttrPrefix, dae, state.innerOuterComponents);
                        const p2 = resolveScopedName(subParts[2], effAttrPrefix, dae, state.innerOuterComponents);
                        attrExprId = dae.addBinaryExpr(
                          BinOp.Sub,
                          dae.addExpression(ExprKind.Name, dae.interner.intern(p1)),
                          dae.addExpression(ExprKind.Name, dae.interner.intern(p2)),
                        );
                      }
                      let evalVal: any = null;
                      const shouldSkipPreEval =
                        (flattener.options.omcCompatibility &&
                          /^if\b/.test(t) &&
                          (t.includes("flowDirection") || t.includes("allowFlowReversal")) &&
                          arg.name !== "stateSelect" &&
                          arg.name !== "fixed") ||
                        (Boolean(dae.extensionMetadata?.["isOldFrontend"]) &&
                          arg.name === "start" &&
                          /^array\s*\(/.test(t));
                      if (attrExprId === null && !shouldSkipPreEval) {
                        try {
                          const pkgScopeId = redeclPkgId ?? parentMods?.packageScopeId;
                          const elemParentSymId = flattener.db.symbol(elemId)?.parentId;
                          const scopeId = pkgScopeId ?? elemParentSymId;
                          const attrPkgPrefix = pkgScopeId
                            ? extractReplaceablePackagePrefix(
                                t,
                                flattener,
                                dae,
                                redeclPkgPrefix,
                                parentMods,
                                elemParentSymId,
                              )
                            : null;
                          const evalT = pkgScopeId && attrPkgPrefix ? t.slice(attrPkgPrefix.length + 1) : t;
                          const refsDaeParamInRel =
                            (evalT.includes("==") || evalT.includes("<>")) &&
                            (() => {
                              const ids = evalT.match(/\b[a-zA-Z_]\w*\b/g);
                              if (!ids) return false;
                              for (const id of ids) {
                                if (
                                  id === "if" ||
                                  id === "then" ||
                                  id === "else" ||
                                  id === "true" ||
                                  id === "false" ||
                                  id === "and" ||
                                  id === "or" ||
                                  id === "not"
                                )
                                  continue;
                                for (const startPfx of [effAttrPrefix, prefix]) {
                                  let p: string | undefined = startPfx;
                                  while (p !== undefined) {
                                    const cand = p ? `${p}.${id}` : id;
                                    const vIdx = dae.getVarIdxByName(cand);
                                    if (vIdx >= 0 && dae.getVarVariability(vIdx) !== Variability.Constant) {
                                      return true;
                                    }
                                    const dot = p.lastIndexOf(".");
                                    p = dot !== -1 ? p.slice(0, dot) : p !== "" ? "" : undefined;
                                  }
                                }
                              }
                              return false;
                            })();
                          if (!refsDaeParamInRel) {
                            evalVal = flattener.db.evaluate(evalT, scopeId ?? undefined);
                            if (evalVal === null && evalT !== t) {
                              evalVal = flattener.db.evaluate(t, scopeId ?? undefined);
                            }
                          }
                          if (evalVal === null) {
                            const encPkgId =
                              pkgScopeId ??
                              (elemParentSymId ? flattener.db.symbol(elemParentSymId)?.parentId : undefined) ??
                              scopeId;
                            const dbConst =
                              (encPkgId ? lookupDbConstant(evalT, flattener.db, encPkgId) : null) ??
                              (scopeId && scopeId !== encPkgId ? lookupDbConstant(evalT, flattener.db, scopeId) : null);
                            if (dbConst !== null && dbConst.value !== undefined) {
                              evalVal = dbConst.value;
                            }
                          }
                          if (evalVal === null) {
                            evalVal = evaluateCSTNumber(evalT, undefined, scopeId ?? undefined, flattener.db, dae);
                          }
                          if (evalVal === null && evalT !== t) {
                            evalVal = evaluateCSTNumber(t, undefined, scopeId ?? undefined, flattener.db, dae);
                          }
                          if (idxTuple.length > 0 && Array.isArray(evalVal)) {
                            evalVal = evalVal[idxTuple[0]! - 1];
                          }
                          if (
                            evalVal !== null &&
                            flattener.options.omcCompatibility &&
                            !dae.extensionMetadata?.["isOldFrontend"]
                          ) {
                            const idMatches = t.match(/\b[a-zA-Z_][a-zA-Z0-9_]*\b/g);
                            if (idMatches) {
                              for (const id of idMatches) {
                                if (id === "if" || id === "then" || id === "else" || id === "true" || id === "false")
                                  continue;
                                let p: string | undefined = prefix;
                                while (p) {
                                  const cand = `${p}.${id}`;
                                  const idx = dae.getVarIdxByName(cand);
                                  if (idx >= 0 && dae.getVarVariability(idx) === Variability.Parameter) {
                                    dae.setVarFinal(idx, true);
                                    break;
                                  }
                                  const dot = p.lastIndexOf(".");
                                  p = dot !== -1 ? p.substring(0, dot) : undefined;
                                }
                                const rootIdx = dae.getVarIdxByName(id);
                                if (rootIdx >= 0 && dae.getVarVariability(rootIdx) === Variability.Parameter) {
                                  dae.setVarFinal(rootIdx, true);
                                }
                              }
                            }
                          }
                        } catch {
                          evalVal = null;
                        }
                      }
                      if (evalVal === null && !shouldSkipPreEval && t.includes("(") && t.endsWith(")")) {
                        const parenIdx = t.indexOf("(");
                        const fnCallName = t.substring(0, parenIdx).trim();
                        const argsText = t.substring(parenIdx + 1, t.length - 1).trim();
                        const prefixFnCallName = prefix ? `${prefix}.${fnCallName}` : fnCallName;
                        const fnObj = dae.getFunction(fnCallName) || dae.getFunction(prefixFnCallName);
                        if (fnObj) {
                          (fnObj as any).wasCalled = true;
                          if ((fnObj as any).symId) flattener.calledFunctionSymIds?.add((fnObj as any).symId);
                          const argParts = splitTopLevelArgs(argsText);
                          const evalArgs: any[] = [];
                          let allArgsOk = true;
                          for (const ap of argParts) {
                            const vIdx = dae.lookupVariable(ap);
                            if (vIdx >= 0) {
                              const sv = dae.getVarExpression(vIdx);
                              const val =
                                sv !== undefined && sv >= 0 ? evalDaeExpr(sv, dae) : dae.getVarStartValue(vIdx);
                              if (val !== null && val !== undefined) {
                                evalArgs.push(val);
                                continue;
                              }
                            }
                            const num = Number(ap);
                            if (!isNaN(num)) {
                              evalArgs.push(num);
                              continue;
                            }
                            if (ap.startsWith("{") && ap.endsWith("}")) {
                              const parsedArr = parseModelicaArrayArg(
                                ap,
                                dae,
                                flattener,
                                effAttrPrefix,
                                flattener.currentClassId ?? undefined,
                              );
                              if (parsedArr !== null) {
                                evalArgs.push(parsedArr);
                                continue;
                              }
                            }
                            allArgsOk = false;
                            break;
                          }
                          if (allArgsOk) {
                            try {
                              const resolvedFnName = dae.getFunction(fnCallName) ? fnCallName : prefixFnCallName;
                              const fnInternId = dae.interner.intern(resolvedFnName);
                              evalVal = evaluateArenaFunctionCall(
                                dae,
                                fnInternId,
                                evalArgs,
                                flattener.db,
                                flattener.currentRootClassId ?? undefined,
                              );
                              if (idxTuple.length > 0 && Array.isArray(evalVal)) {
                                evalVal = evalVal[idxTuple[0]! - 1];
                              }
                            } catch (err: any) {
                              if (
                                err?.code === 4009 ||
                                err?.message?.includes("causes a cyclic dependency") ||
                                err?.message?.includes("assert triggered:") ||
                                err?.message?.includes("limit (--eval")
                              ) {
                                let compClause: any = elemCst;
                                while (compClause && compClause.type !== "component_clause") {
                                  compClause = compClause.parent;
                                }
                                const diagNode = compClause ?? elemCst;
                                const startB = err.range?.startByte ?? diagNode?.startIndex ?? diagNode?.startByte;
                                const endB = err.range?.endByte ?? diagNode?.endIndex ?? diagNode?.endByte;
                                dae.diagnostics.push({
                                  severity: "error",
                                  code: err?.code ?? 0,
                                  message: err.message,
                                  range: {
                                    startByte: startB,
                                    endByte: endB,
                                    startPosition: err.range?.startPosition ?? diagNode?.startPosition,
                                    endPosition: err.range?.endPosition ?? diagNode?.endPosition,
                                  },
                                });
                                return;
                              }
                              evalVal = null;
                            }
                          }
                        }
                      }
                      if (arg.name === "stateSelect") {
                        const ssLiterals = ["never", "avoid", "default", "prefer", "always"];
                        if (typeof evalVal === "number" && evalVal >= 1 && evalVal <= ssLiterals.length) {
                          attrExprId = dae.addEnumLiteral(evalVal, `StateSelect.${ssLiterals[evalVal - 1]}`);
                        } else if (t.startsWith("StateSelect.")) {
                          const litName = t.slice("StateSelect.".length);
                          const idx = ssLiterals.indexOf(litName);
                          attrExprId = dae.addEnumLiteral(idx >= 0 ? idx + 1 : 1, `StateSelect.${litName}`);
                        } else if (typeof evalVal === "number") {
                          attrExprId = dae.addRealLiteral(evalVal);
                        } else {
                          const targetSym = flattener.db.symbol(elemId);
                          const evalScopeSymId =
                            (arg.value as any)?.evaluationScopeId ??
                            (arg as any).evaluationScopeId ??
                            (arg as any).ownerClassId;
                          const docUri = evalScopeSymId
                            ? flattener.db.symbol(evalScopeSymId)?.documentUri
                            : targetSym?.documentUri;
                          let attrCst = arg.value?.cstBytes
                            ? flattener.db.cstNodeRange(
                                arg.value.cstBytes[0],
                                arg.value.cstBytes[1],
                                docUri ?? targetSym,
                              )
                            : null;
                          if (!attrCst && elemCst) {
                            const findCref = (n: any): any => {
                              if (!n) return null;
                              if (
                                (n.type === "component_reference" || n.type === "expression") &&
                                n.text?.trim() === t
                              ) {
                                return n;
                              }
                              for (const c of n.children || []) {
                                const f = findCref(c);
                                if (f) return f;
                              }
                              return null;
                            };
                            attrCst = findCref(elemCst);
                          }
                          if (attrCst) {
                            const prevClassIdAttr = flattener.currentClassId;
                            const prevParentModsAttr = (flattener as any).currentParentMods;
                            if ((arg as any).fromParentMod && ((arg as any).ownerClassId ?? evalScopeSymId)) {
                              const candCls = flattener.db.symbol((arg as any).ownerClassId ?? evalScopeSymId);
                              if (candCls) {
                                flattener.currentClassId =
                                  candCls.kind === "Class" || candCls.kind === "Package"
                                    ? candCls.id
                                    : (candCls.parentId ?? flattener.currentClassId);
                                if (flattener.currentClassId !== prevClassIdAttr && prevParentModsAttr) {
                                  (flattener as any).currentParentMods = {
                                    ...prevParentModsAttr,
                                    currentClassId: flattener.currentClassId,
                                  };
                                }
                              }
                            }
                            try {
                              attrExprId = flattener.lowerExpr(attrCst as any, dae, effAttrPrefix);
                            } finally {
                              flattener.currentClassId = prevClassIdAttr;
                              (flattener as any).currentParentMods = prevParentModsAttr;
                            }
                          }
                        }
                      } else if (typeof evalVal === "number") {
                        attrExprId =
                          varType === VarType.Integer
                            ? dae.addIntLiteral(Math.trunc(evalVal))
                            : dae.addRealLiteral(evalVal);
                      } else if (typeof evalVal === "boolean") {
                        attrExprId = dae.addExpression(ExprKind.BoolLiteral, evalVal ? 1 : 0);
                      } else if (
                        typeof evalVal === "string" &&
                        (varType === VarType.String ||
                          arg.name === "quantity" ||
                          arg.name === "unit" ||
                          arg.name === "displayUnit")
                      ) {
                        attrExprId = dae.addExpression(ExprKind.StringLiteral, dae.interner.intern(evalVal));
                      } else if (t.startsWith('"') && t.endsWith('"')) {
                        attrExprId = dae.addExpression(ExprKind.Name, dae.interner.intern(t));
                      } else if (attrExprId === null) {
                        const isSimpleIdent = /^[a-zA-Z_]\w*(\.[a-zA-Z_]\w*)*$/.test(t);
                        if (!isSimpleIdent && arg.value?.cstBytes) {
                          const targetSym = flattener.db.symbol(elemId);
                          const evalScopeSymId =
                            (arg.value as any)?.evaluationScopeId ??
                            (arg as any).evaluationScopeId ??
                            (arg as any).ownerClassId;
                          const docUri = evalScopeSymId
                            ? flattener.db.symbol(evalScopeSymId)?.documentUri
                            : targetSym?.documentUri;
                          const attrCst = flattener.db.cstNodeRange(
                            arg.value.cstBytes[0],
                            arg.value.cstBytes[1],
                            docUri ?? targetSym,
                          );
                          if (attrCst) {
                            const prevNoArrayExpand = flattener["noArrayExpand"];
                            const prevClassIdAttr = flattener.currentClassId;
                            const prevParentModsAttr = (flattener as any).currentParentMods;
                            flattener["noArrayExpand"] = true;
                            if ((arg as any).fromParentMod && ((arg as any).ownerClassId ?? evalScopeSymId)) {
                              const candCls = flattener.db.symbol((arg as any).ownerClassId ?? evalScopeSymId);
                              if (candCls) {
                                flattener.currentClassId =
                                  candCls.kind === "Class" || candCls.kind === "Package"
                                    ? candCls.id
                                    : (candCls.parentId ?? flattener.currentClassId);
                                if (flattener.currentClassId !== prevClassIdAttr && prevParentModsAttr) {
                                  (flattener as any).currentParentMods = {
                                    ...prevParentModsAttr,
                                    currentClassId: flattener.currentClassId,
                                  };
                                }
                              }
                            }
                            let loweredId: number;
                            try {
                              loweredId = flattener.lowerExpr(attrCst as any, dae, effAttrPrefix);
                            } finally {
                              flattener["noArrayExpand"] = prevNoArrayExpand;
                              flattener.currentClassId = prevClassIdAttr;
                              (flattener as any).currentParentMods = prevParentModsAttr;
                            }
                            if (loweredId >= 0) {
                              if (
                                varType === VarType.Real &&
                                (arg.name === "start" ||
                                  arg.name === "min" ||
                                  arg.name === "max" ||
                                  arg.name === "nominal")
                              ) {
                                loweredId = castToRealExpr(loweredId, dae);
                              }
                              if (idxTuple.length > 0) {
                                let slicedElemId: number | null = loweredId;
                                for (const idxVal of idxTuple) {
                                  if (slicedElemId !== null && dae.getExprKind(slicedElemId) === ExprKind.ArrayCtor) {
                                    const ctorElems = getArrayCtorElements(slicedElemId, dae);
                                    slicedElemId =
                                      idxVal >= 1 && idxVal <= ctorElems.length ? ctorElems[idxVal - 1]! : null;
                                  } else {
                                    slicedElemId = null;
                                    break;
                                  }
                                }
                                if (slicedElemId !== null && slicedElemId >= 0) {
                                  attrExprId = slicedElemId;
                                } else {
                                  attrExprId = dae.addSubscriptExpr(
                                    loweredId,
                                    idxTuple.map((idxVal) => dae.addIntLiteral(idxVal)),
                                  );
                                }
                              } else {
                                attrExprId = loweredId;
                              }
                            }
                          }
                        }
                        if (attrExprId === null) {
                          if (
                            idxTuple.length > 0 &&
                            (dae.getVarIdxByName(`${resolvedT}[1]`) >= 0 || isArrayTarget(t))
                          ) {
                            attrExprId = dae.addExpression(
                              ExprKind.Name,
                              dae.interner.intern(`${resolvedT}[${idxTuple.join(",")}]`),
                            );
                          } else {
                            attrExprId = dae.addExpression(ExprKind.Name, dae.interner.intern(resolvedT));
                          }
                        }
                      }
                    }
                  }
                }
                if (attrExprId !== null) {
                  dae.setVarAttr(varIdx, arg.name, attrExprId);
                  if (arg.name === "fixed") {
                    const isFixed =
                      arg.value?.kind === "literal" && typeof arg.value.value === "boolean"
                        ? arg.value.value
                        : arg.value?.kind === "expression" && arg.value.text?.trim() === "false"
                          ? false
                          : true;
                    dae.setVarFixed(varIdx, isFixed);
                  }
                }
              }
            }
          } finally {
            flattener.currentBindingCompName = prevBindingCompName;
          }
        };

        let arrayDims = compInst?.arrayDimensions;
        const rawDimsInitial = flattener.db.query<any[] | null>("arrayDimensions", elemId);
        if (rawDimsInitial) {
          for (const d of rawDimsInitial) {
            if (d.kind === "literal" && d.value < 0) {
              let clauseNode: any = elemCst;
              while (clauseNode && clauseNode.type !== "component_clause") {
                clauseNode = clauseNode.parent;
              }
              const diagNode = clauseNode ?? elemCst;
              dae.diagnostics.push({
                severity: "error",
                code: ModelicaErrorCode.NEGATIVE_DIMENSION.code,
                message: ModelicaErrorCode.NEGATIVE_DIMENSION.message(String(d.value), compInst.name),
                range: {
                  startByte: diagNode?.startIndex ?? diagNode?.startByte,
                  endByte: diagNode?.endIndex ?? diagNode?.endByte,
                  startPosition: diagNode?.startPosition,
                  endPosition: diagNode?.endPosition,
                },
              });
              return;
            }
          }
        }
        if (rawDimsInitial) {
          for (const rd of rawDimsInitial) {
            let rdText = rd?.text?.trim() ?? "";
            if (!rdText && rd?.cstBytes) {
              const node = flattener.db.cstNodeRange(rd.cstBytes[0], rd.cstBytes[1]) as any;
              if (node) rdText = node.text?.trim() ?? "";
            }
            const idMatches = rdText.match(/\b[a-zA-Z_]\w*\b/g);
            if (idMatches) {
              for (const idm of idMatches) {
                if (
                  idm === "if" ||
                  idm === "then" ||
                  idm === "else" ||
                  idm === "elseif" ||
                  idm === "true" ||
                  idm === "false" ||
                  idm === "size" ||
                  idm === "ndims" ||
                  idm === "Integer" ||
                  idm === "Real" ||
                  idm === "Boolean"
                )
                  continue;
                const candidates = [
                  prefix ? `${prefix}.${idm}` : idm,
                  prefix.includes(".") ? `${prefix.split(".").slice(0, -1).join(".")}.${idm}` : idm,
                  idm,
                ];
                for (const c of candidates) {
                  ((state as any).pendingFinalParamNames ??= new Set<string>()).add(c);
                  const vi = dae.lookupVariable(c);
                  if (
                    !dae.extensionMetadata?.["isOldFrontend"] &&
                    vi >= 0 &&
                    dae.getVarVariability(vi) === Variability.Parameter &&
                    dae.getVarType(vi) === VarType.Integer
                  ) {
                    dae.setVarFinal(vi, true);
                    break;
                  }
                }
              }
            }
          }
        }
        if (
          rawDimsInitial &&
          rawDimsInitial.length > 0 &&
          rawDimsInitial.some((d: any) => d.kind === "colon" || d.text?.trim() === ":" || d.kind === "flexible")
        ) {
          arrayDims = rawDimsInitial.map((d: any) =>
            d.kind === "colon" || d.text?.trim() === ":" || d.kind === "flexible"
              ? -1
              : typeof d.value === "number"
                ? d.value
                : -1,
          );
        }
        let typeDims: number[] | null = null;
        if (classTargetId) {
          const rawTypeDims =
            flattener.db.query<any[] | null>("resolvedArrayDimensions", classTargetId) ??
            flattener.db.query<any[] | null>("arrayDimensions", classTargetId);
          if (rawTypeDims) {
            typeDims = rawTypeDims.map((d: any) =>
              typeof d === "number" ? d : d?.kind === "literal" && typeof d.value === "number" ? d.value : -1,
            );
          }
          if (redeclArg && typeDims && typeDims.length > 0) {
            arrayDims = typeDims;
          } else if ((!arrayDims || arrayDims.length === 0) && typeDims && typeDims.length > 0) {
            arrayDims = typeDims;
          }
        }
        if (redeclArg?.redeclaredArrayDimensionsRaw && redeclArg.redeclaredArrayDimensionsRaw.length > 0) {
          arrayDims = redeclArg.redeclaredArrayDimensionsRaw.map((d: any) =>
            d.kind === "literal" && typeof d.value === "number" ? d.value : -1,
          );
        }
        if ((!arrayDims || arrayDims.length === 0) && rawDimsInitial && rawDimsInitial.length > 0) {
          arrayDims = rawDimsInitial.map((d: any) =>
            d.kind === "literal" && typeof d.value === "number" ? d.value : -1,
          );
        }
        const preRegisteredShape =
          getNamedArrayShape(dae, fullCompName) ??
          (prefix ? getNamedArrayShape(dae, `${prefix}.${compInst.name}`) : getNamedArrayShape(dae, compInst.name));
        if (preRegisteredShape && preRegisteredShape.length > 0) {
          arrayDims = preRegisteredShape;
        }
        const isFunctionInputWithColon =
          dae.classKind === "function" &&
          causality === Causality.Input &&
          rawDimsInitial &&
          rawDimsInitial.some((d: any) => d.kind === "colon" || d.text?.trim() === ":" || d.kind === "flexible");

        if (effectiveBinding?.text && !isFunctionInputWithColon) {
          const bText = effectiveBinding.text.trim();
          if (isArrayLiteral(bText)) {
            if (arrayDims && arrayDims.length > 0) {
              let currentLit = bText;
              for (let d = 0; d < arrayDims.length; d++) {
                if (currentLit.startsWith("{") && currentLit.endsWith("}")) {
                  const subElems = parseArrayLiteralElements(currentLit);
                  if (
                    (arrayDims[d] === 0 || matchingParentArg?.value || matchingClassArg?.value) &&
                    subElems.length > 0
                  ) {
                    arrayDims[d] = subElems.length;
                  }
                  if (subElems.length > 0) currentLit = subElems[0]!.trim();
                }
              }
            }
          } else if (bText.startsWith("[") && bText.endsWith("]")) {
            const rows = splitTopLevel(bText.slice(1, -1), ";");
            const rowElements = rows.map((r) => splitTopLevel(r, ","));
            const rowsCount = rows.length;
            const colsCount = rowElements.length > 0 ? rowElements[0]!.length : 0;
            if (arrayDims && arrayDims.length === 1) {
              let clauseStart = elemCst?.startIndex ?? elemCst?.startByte;
              let clauseEnd = elemCst?.endIndex ?? elemCst?.endByte;
              if (elemCst) {
                let curr = elemCst;
                while (curr && curr.type !== "component_clause") curr = curr.parent;
                if (curr) {
                  clauseStart = curr.startIndex ?? curr.startByte;
                  clauseEnd = curr.endIndex ?? curr.endByte;
                }
              }
              const formattedExpr = "{" + rowElements.map((cols) => "{" + cols.join(", ") + "}").join(", ") + "}";
              const allInts = rowElements.every((row) => row.every((c) => /^[+-]?\d+$/.test(c)));
              const elemType = allInts ? "Integer" : "Real";
              dae.diagnostics.push({
                severity: "error",
                code: ModelicaErrorCode.ARRAY_DIMENSION_MISMATCH.code,
                message: `Array dimension mismatch, expression ${formattedExpr} has type ${elemType}[${rowsCount}, ${colsCount}], expected array dimensions [${arrayDims.join(", ")}].`,
                range: { startByte: clauseStart, endByte: clauseEnd },
              });
              return;
            }
            if (arrayDims && arrayDims.length >= 2) {
              const rCount = rowsCount;
              const cCount = colsCount;
              if (
                rCount > 0 &&
                (arrayDims[0] === 0 || arrayDims[0] === -1 || matchingParentArg?.value || matchingClassArg?.value)
              ) {
                arrayDims[0] = rCount;
              }
              if (
                cCount > 0 &&
                (arrayDims[1] === 0 || arrayDims[1] === -1 || matchingParentArg?.value || matchingClassArg?.value)
              ) {
                arrayDims[1] = cCount;
              }
            }
          }
        }
        const rawPredefDims =
          arrayDims && arrayDims.length > 0
            ? redeclArg?.redeclaredArrayDimensionsRaw && redeclArg.redeclaredArrayDimensionsRaw.length > 0
              ? redeclArg.redeclaredArrayDimensionsRaw
              : flattener.db.query<any[] | null>("arrayDimensions", elemId)
            : null;
        if (arrayDims && (arrayDims.some((d) => d <= 0) || rawPredefDims?.some((d: any) => d?.kind === "expression"))) {
          const rawDims = rawPredefDims;
          let dimNames: string[] = [];
          if (rawDims && rawDims.length === arrayDims.length) {
            dimNames = rawDims.map((d: any) => d?.text?.trim() ?? "");
          }
          if (dimNames.length === 0 && elemCst) {
            const match = /\[([a-zA-Z_]\w*)\]/.exec(elemCst.text ?? "");
            if (match) {
              dimNames = [match[1]!];
            }
          }
          const resolvedDims = [...arrayDims];
          for (let i = 0; i < resolvedDims.length; i++) {
            if (resolvedDims[i]! <= 0 || rawDims?.[i]?.kind === "expression") {
              const dimName = dimNames[i];
              if (dimName) {
                const prefixedDim = prefix ? `${prefix}.${dimName}` : dimName;
                let varIdx = dae.getVarIdxByName(prefixedDim);
                if (varIdx < 0) varIdx = dae.getVarIdxByName(dimName);
                let evalVal: any = null;
                if (varIdx >= 0) {
                  const exprId = dae.getVarExpression(varIdx);
                  if (exprId !== undefined) evalVal = evalDaeExpr(exprId, dae);
                }
                if (typeof evalVal !== "number" || evalVal < 0) {
                  const arg = parentMods?.args?.find((a: any) => a.name === dimName);
                  if (arg?.value) {
                    if (arg.value.kind === "literal" && typeof arg.value.value === "number") {
                      evalVal = arg.value.value;
                    } else if (arg.value.kind === "expression" && arg.value.text) {
                      const num = Number(arg.value.text.trim());
                      if (!isNaN(num)) evalVal = num;
                    }
                  }
                  if (typeof evalVal !== "number" || evalVal < 0) {
                    const defaultDimScopeId = (dae as any).enclosingScopeId ?? flattener.currentClassId ?? undefined;
                    const dimFirstId = dimName.match(/^([a-zA-Z_]\w*)\./)?.[1];
                    const dimPkgRedecl = dimFirstId
                      ? parentMods?.args
                          ?.slice()
                          .reverse()
                          .find(
                            (a: any) =>
                              !a.isBreak &&
                              a.name === dimFirstId &&
                              (a.isRedeclaration || a.redeclaredTypeSpecifier) &&
                              a.redeclaredTypeSpecifier,
                          )
                      : undefined;
                    const effectiveDimName = dimPkgRedecl
                      ? `${String(dimPkgRedecl.redeclaredTypeSpecifier).replace(/^\.+/, "")}${dimName.slice(dimFirstId!.length)}`
                      : dimName;
                    const dimScopeId =
                      dimPkgRedecl?.evaluationScopeId ??
                      dimPkgRedecl?.ownerClassId ??
                      parentMods?.packageScopeId ??
                      defaultDimScopeId;
                    evalVal = evaluateCSTNumber(effectiveDimName, undefined, dimScopeId, flattener.db, dae, prefix);
                    if (
                      (typeof evalVal !== "number" || evalVal < 0) &&
                      defaultDimScopeId !== undefined &&
                      defaultDimScopeId !== dimScopeId
                    ) {
                      evalVal = evaluateCSTNumber(dimName, undefined, defaultDimScopeId, flattener.db, dae, prefix);
                    }
                    if ((typeof evalVal !== "number" || evalVal < 0) && prefix) {
                      const parentPrefix = prefix.includes(".") ? prefix.split(".").slice(0, -1).join(".") : "";
                      evalVal = evaluateCSTNumber(
                        effectiveDimName,
                        undefined,
                        dimScopeId,
                        flattener.db,
                        dae,
                        parentPrefix,
                      );
                    }
                  }
                  if (typeof evalVal !== "number" || evalVal < 0) {
                    if (rawDims && rawDims[i]?.cstBytes) {
                      const targetScopeId =
                        (rawDims[i] as any)?.evaluationScopeId ??
                        elemId ??
                        flattener.currentClassId ??
                        flattener.currentRootClassId;
                      const scopeSym = targetScopeId ? flattener.db.symbol(targetScopeId) : undefined;
                      const dimCst = flattener.db.cstNodeRange(
                        rawDims[i].cstBytes[0],
                        rawDims[i].cstBytes[1],
                        scopeSym ?? undefined,
                      ) as any;
                      if (dimCst) {
                        let loweredId = flattener.lowerExpr(dimCst, dae, prefix);
                        if (loweredId >= 0) {
                          const ev = evalDaeExpr(loweredId, dae);
                          if (typeof ev === "number" && ev >= 0) {
                            evalVal = ev;
                          }
                        }
                        if ((typeof evalVal !== "number" || evalVal < 0) && prefix) {
                          const parentPrefix = prefix.includes(".") ? prefix.split(".").slice(0, -1).join(".") : "";
                          loweredId = flattener.lowerExpr(dimCst, dae, parentPrefix);
                          if (loweredId >= 0) {
                            const ev = evalDaeExpr(loweredId, dae);
                            if (typeof ev === "number" && ev >= 0) {
                              evalVal = ev;
                            }
                          }
                        }
                      }
                    }
                  }
                }
                if (typeof evalVal === "number" && evalVal >= 0) {
                  resolvedDims[i] = evalVal;
                } else if (flattener.options.omcCompatibility && dimName && !isFunctionInputWithColon) {
                  const sizeMatch = dimName.match(/^size\s*\(\s*([a-zA-Z_]\w*)\s*,\s*(\d+)\s*\)$/);
                  if (sizeMatch) {
                    const targetVarName = sizeMatch[1]!;
                    const targetDimIdx = sizeMatch[2]!;
                    const targetElemSym = flattener.currentRootClassId
                      ? flattener.db
                          .childrenOf(flattener.currentRootClassId)
                          ?.find((c) => c.name === targetVarName && c.kind === "Component")
                      : null;
                    if (targetElemSym) {
                      const targetCompInst = flattener.db.query<ComponentInstanceData>(
                        "componentInstance",
                        targetElemSym.id,
                      );
                      const targetRawDims = flattener.db.query<any[] | null>("arrayDimensions", targetElemSym.id);
                      const targetCst = flattener.db.cstNode(targetElemSym.id) as any;
                      const cstText = targetCst?.text ?? "";
                      const targetHasColon =
                        (targetRawDims &&
                          targetRawDims.some(
                            (d: any) => d?.text?.trim() === ":" || d?.kind === "colon" || d?.kind === "flexible",
                          )) ||
                        /\[\s*:\s*\]/.test(cstText);
                      const targetBinding = flattener.db.query<any>("effectiveBinding", targetElemSym.id);
                      const targetHasBinding = Boolean(
                        targetCompInst?.modification?.bindingExpression || targetBinding?.expression,
                      );
                      if (targetHasColon && !targetHasBinding) {
                        let targetClauseNode: any = targetCst;
                        while (targetClauseNode && targetClauseNode.type !== "component_clause") {
                          targetClauseNode = targetClauseNode.parent;
                        }
                        const diagNode = targetClauseNode ?? targetCst;
                        dae.diagnostics.push({
                          severity: "error",
                          code: ModelicaErrorCode.FAILED_TO_DEDUCE_DIMENSION.code,
                          message: ModelicaErrorCode.FAILED_TO_DEDUCE_DIMENSION.message(targetDimIdx, targetVarName),
                          range: {
                            startByte: diagNode?.startIndex ?? diagNode?.startByte,
                            endByte: diagNode?.endIndex ?? diagNode?.endByte,
                            startPosition: diagNode?.startPosition,
                            endPosition: diagNode?.endPosition,
                          },
                        });
                        return;
                      }
                    }
                  }
                  if (dae.classKind !== "function" && !_isEnclosingFunction && resolvedDims[i]! < 0) {
                    if (flattener.options.arrayMode === "preserve" && dae.extensionMetadata?.["isOldFrontend"]) {
                      dae.diagnostics.push({
                        severity: "error",
                        code: 0,
                        message: `Error occurred while flattening model ${dae.name}`,
                        range: null,
                      });
                      return;
                    }
                    let clauseNode: any = elemCst;
                    while (clauseNode && clauseNode.type !== "component_clause") {
                      clauseNode = clauseNode.parent;
                    }
                    const diagNode = clauseNode ?? elemCst;
                    const arrayName = (dae.extensionMetadata as any)?.hasOldInstOption
                      ? `${compInst.name}[${dimName}]`
                      : compInst.name;
                    dae.diagnostics.push({
                      severity: "error",
                      message: `Could not evaluate structural parameter (or constant): ${dimName} which gives dimensions of array: ${arrayName}. Array dimensions must be known at compile time.`,
                      range: {
                        startByte: diagNode?.startIndex ?? diagNode?.startByte,
                        endByte: diagNode?.endIndex ?? diagNode?.endByte,
                        startPosition: diagNode?.startPosition,
                        endPosition: diagNode?.endPosition,
                      },
                    });
                    return;
                  }
                }
              }
              if (resolvedDims[i]! <= 0 && effectiveBinding?.cstBytes && !isFunctionInputWithColon) {
                const targetScopeId =
                  (effectiveBinding as any)?.evaluationScopeId ??
                  effectiveParentArg?.evaluationScopeId ??
                  effectiveClassArg?.evaluationScopeId ??
                  elemId ??
                  flattener.currentClassId ??
                  flattener.currentRootClassId;
                const scopeSym = targetScopeId ? flattener.db.symbol(targetScopeId) : undefined;
                const scopeClassId =
                  scopeSym?.kind === "Class" ? targetScopeId : (scopeSym?.parentId ?? flattener.currentClassId);
                const bindCst = flattener.db.cstNodeRange(
                  effectiveBinding.cstBytes[0],
                  effectiveBinding.cstBytes[1],
                  scopeSym ?? undefined,
                ) as any;
                if (bindCst) {
                  const bindingPrefix =
                    parentMods?.bindingScope !== undefined && isParentBoundField
                      ? parentMods.bindingScope
                      : effectiveParentArg?.value &&
                          (!effectiveParentArg?.isExtendsMod || effectiveParentArg?.isFromParentExtends)
                        ? prefix.includes(".")
                          ? prefix.split(".").slice(0, -1).join(".")
                          : ""
                        : prefix;
                  const prevClassId = flattener.currentClassId;
                  if (scopeClassId) flattener.currentClassId = scopeClassId;
                  let loweredId = -1;
                  try {
                    loweredId = flattener.lowerExpr(bindCst, dae, bindingPrefix);
                  } finally {
                    flattener.currentClassId = prevClassId;
                  }
                  if (loweredId >= 0) {
                    const deducedDims = getExprDims(loweredId, dae, flattener.db);
                    if (deducedDims) {
                      const targetDims =
                        deducedDims.length > resolvedDims.length
                          ? deducedDims.slice(deducedDims.length - resolvedDims.length)
                          : deducedDims;
                      if (targetDims.length === resolvedDims.length) {
                        for (let d = 0; d < resolvedDims.length; d++) {
                          if (resolvedDims[d]! <= 0 && targetDims[d]! >= 0) {
                            resolvedDims[d] = targetDims[d]!;
                          }
                        }
                      }
                    }
                    if (
                      (variability === Variability.Parameter || variability === Variability.Constant) &&
                      dae.getExprKind(loweredId) === ExprKind.Call
                    ) {
                      const fnNameId = dae.getExprData1(loweredId);
                      const fnName = dae.interner.resolve(fnNameId);
                      const argCount = dae.getExprRight(loweredId);
                      const firstArg = dae.getExprLeft(loweredId);
                      const evalArgs: any[] = [];
                      let allArgsOk = true;
                      for (let aIdx = 0; aIdx < argCount; aIdx++) {
                        const aId = aIdx === 0 ? firstArg : dae.getExprLeft(loweredId + aIdx);
                        if (exprReferencesRuntimeParameter(aId, dae)) {
                          allArgsOk = false;
                          break;
                        }
                        const val = evalDaeExpr(aId, dae);
                        if (val !== null && val !== undefined) {
                          evalArgs.push(val);
                        } else {
                          allArgsOk = false;
                          break;
                        }
                      }
                      if (allArgsOk && fnName) {
                        try {
                          const evalRes = evaluateArenaFunctionCall(
                            dae,
                            fnNameId,
                            evalArgs,
                            flattener.db,
                            flattener.currentRootClassId,
                          );
                          if (evalRes) {
                            const evaluatedKey = prefix ? `${prefix}.${name}` : name;
                            flattener.evaluatedConstantArrays.set(evaluatedKey, evalRes);
                          }
                        } catch {}
                      }
                    }
                  }
                }
              }
              if (resolvedDims[i]! <= 0 && effectiveBinding?.text && !isFunctionInputWithColon) {
                const bRef = effectiveBinding.text.trim();
                if (isArrayLiteral(bRef)) {
                  let currentLit = bRef;
                  let valid = true;
                  for (let d = 0; d < i; d++) {
                    if (currentLit.startsWith("{") && currentLit.endsWith("}")) {
                      const subElems = parseArrayLiteralElements(currentLit);
                      if (subElems.length > 0) {
                        currentLit = subElems[0]!.trim();
                      } else {
                        valid = false;
                        break;
                      }
                    } else {
                      valid = false;
                      break;
                    }
                  }
                  if (valid && currentLit.startsWith("{") && currentLit.endsWith("}")) {
                    const elems = parseArrayLiteralElements(currentLit);
                    if (elems.length > 0) resolvedDims[i] = elems.length;
                  }
                } else if (bRef.startsWith("[") && bRef.endsWith("]")) {
                  const rows = splitTopLevel(bRef.slice(1, -1), ";");
                  const rowsCount = rows.length;
                  const colsCount = rows.length > 0 ? splitTopLevel(rows[0]!, ",").length : 0;
                  if (i === 0 && rowsCount > 0) resolvedDims[0] = rowsCount;
                  if (i === 1 && colsCount > 0) resolvedDims[1] = colsCount;
                } else if (
                  (bRef.startsWith("zeros(") || bRef.startsWith("ones(") || bRef.startsWith("fill(")) &&
                  bRef.endsWith(")")
                ) {
                  const inner = bRef.slice(bRef.indexOf("(") + 1, -1).trim();
                  const parts = splitTopLevelArgs(inner);
                  const dimArgs = bRef.startsWith("fill(") ? parts.slice(1) : parts;
                  if (dimArgs.length > i) {
                    const dimVal = evaluateCSTNumber(dimArgs[i], undefined, undefined, flattener.db, dae, prefix);
                    if (typeof dimVal === "number" && dimVal >= 0) {
                      resolvedDims[i] = dimVal;
                    }
                  }
                } else if (bRef.includes("(") && bRef.endsWith(")")) {
                  const fnCallMatch = bRef.match(/^([a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)*)\s*\((.*)\)$/);
                  if (fnCallMatch) {
                    const fnCallName = fnCallMatch[1]!;
                    const argsText = fnCallMatch[2]!;
                    const prefixFnCallName = prefix ? `${prefix}.${fnCallName}` : fnCallName;
                    let fnObj = dae.getFunction(fnCallName) || dae.getFunction(prefixFnCallName);
                    if (!fnObj) {
                      const matchingFnSym = flattener.db.byName(fnCallName).find((e) => flattener["isFunctionSym"](e));
                      if (matchingFnSym) {
                        const qualFnName = getSymbolQualifiedName(flattener.db, matchingFnSym.id);
                        fnObj = flattener.flattenFunction(matchingFnSym.id, qualFnName, undefined, dae);
                        dae.addFunction(qualFnName, fnObj);
                        dae.addFunction(fnCallName, fnObj);
                      }
                    }
                    if (fnObj) {
                      for (let vi = 0; vi < fnObj.varCount; vi++) {
                        if (fnObj.getVarCausality(vi) === Causality.Output) {
                          const outShape =
                            getFlatteningState(fnObj).deducedOutputShapes.get(fnObj.getVarName(vi)) ??
                            fnObj.getVarShape(vi);
                          if (
                            outShape &&
                            outShape.length === resolvedDims.length &&
                            outShape.every((d: number) => d > 0)
                          ) {
                            for (let d = 0; d < resolvedDims.length; d++) {
                              if (resolvedDims[d]! <= 0) {
                                resolvedDims[d] = outShape[d]!;
                              }
                            }
                            break;
                          }
                        }
                      }
                    }
                    if (fnObj) {
                      const argParts = splitTopLevelArgs(argsText);
                      const evalArgs: any[] = [];
                      let allArgsOk = true;
                      for (const ap of argParts) {
                        const cleanAp = ap.trim();
                        const resolvedAp = resolveScopedName(cleanAp, prefix, dae);
                        const arrayTarget = dae.hasArrayElements(resolvedAp)
                          ? resolvedAp
                          : dae.hasArrayElements(cleanAp)
                            ? cleanAp
                            : null;
                        if (arrayTarget) {
                          const elemIndices = dae.getArrayElementIndices(arrayTarget);
                          const arrVals: any[] = [];
                          for (const eIdx of elemIndices) {
                            const sv = dae.getVarExpression(eIdx);
                            const val = sv !== undefined && sv >= 0 ? evalDaeExpr(sv, dae) : dae.getVarStartValue(eIdx);
                            arrVals.push(val ?? 0);
                          }
                          evalArgs.push(arrVals);
                          continue;
                        }
                        const vIdx =
                          dae.lookupVariable(resolvedAp) >= 0
                            ? dae.lookupVariable(resolvedAp)
                            : dae.lookupVariable(cleanAp);
                        if (vIdx >= 0) {
                          if (
                            dae.getVarVariability(vIdx) === Variability.Parameter &&
                            !dae.isVarFinal(vIdx) &&
                            dae.getVarType(vIdx) !== VarType.Integer
                          ) {
                            allArgsOk = false;
                            break;
                          }
                          const sv = dae.getVarExpression(vIdx);
                          const val = sv !== undefined && sv >= 0 ? evalDaeExpr(sv, dae) : dae.getVarStartValue(vIdx);
                          if (val !== null && val !== undefined) {
                            evalArgs.push(val);
                            continue;
                          }
                        }
                        const num = Number(cleanAp);
                        if (!isNaN(num)) {
                          evalArgs.push(num);
                          continue;
                        }
                        allArgsOk = false;
                        break;
                      }
                      if (allArgsOk) {
                        try {
                          const resolvedFnName = dae.getFunction(fnCallName) ? fnCallName : prefixFnCallName;
                          const fnInternId = dae.interner.intern(resolvedFnName);
                          const evalRes = evaluateArenaFunctionCall(
                            dae,
                            fnInternId,
                            evalArgs,
                            flattener.db,
                            flattener.currentRootClassId,
                          );
                          if (evalRes) {
                            const evaluatedKey = prefix ? `${prefix}.${name}` : name;
                            flattener.evaluatedConstantArrays.set(evaluatedKey, evalRes);
                            const getShape = (val: any): number[] => {
                              const resShape: number[] = [];
                              let curr = val;
                              while (Array.isArray(curr)) {
                                resShape.push(curr.length);
                                curr = curr[0];
                              }
                              return resShape;
                            };
                            const resShape = getShape(evalRes);
                            for (let d = 0; d < resolvedDims.length; d++) {
                              if (resolvedDims[d]! <= 0 && d < resShape.length && resShape[d]! > 0) {
                                resolvedDims[d] = resShape[d]!;
                              }
                            }
                          }
                        } catch {}
                      }
                    }
                  }
                } else {
                  const cleanRef = bRef.replace(/^-\s*/, "");
                  const resolvedRef = resolveScopedName(cleanRef, prefix, dae);
                  let maxDimVal = 0;
                  const searchRefs = [resolvedRef];
                  if (resolvedRef !== cleanRef) searchRefs.push(cleanRef);
                  for (const targetRef of searchRefs) {
                    const prefixMatch = `${targetRef}[`;
                    for (let v = 0; v < dae.varCount; v++) {
                      if (!dae.isVarRemoved(v)) {
                        const vName = dae.getVarName(v);
                        if (vName.startsWith(prefixMatch) && vName.endsWith("]")) {
                          const innerIndices = vName.slice(prefixMatch.length, -1).split(",").map(Number);
                          if (i < innerIndices.length) {
                            const idxVal = innerIndices[i];
                            if (idxVal !== undefined && !isNaN(idxVal) && idxVal > maxDimVal) {
                              maxDimVal = idxVal;
                            }
                          }
                        }
                      }
                    }
                    if (maxDimVal > 0) break;
                  }
                  if (maxDimVal > 0) {
                    resolvedDims[i] = maxDimVal;
                  }
                }
              }
            }
          }
          if (resolvedDims.every((d) => d >= 0)) {
            arrayDims = resolvedDims;
          } else if (
            dae.classKind !== "function" &&
            flattener.options.arrayMode !== "preserve" &&
            rawDims &&
            rawDims.some((d: any) => d?.text?.trim() === ":" || d?.kind === "colon" || d?.kind === "flexible")
          ) {
            if (flattener.options.omcCompatibility && !(dae.extensionMetadata as any)?.hasOldInstOption) {
              for (let i = 0; i < resolvedDims.length; i++) {
                const rd = rawDims[i];
                const isColon = rd?.text?.trim() === ":" || rd?.kind === "colon" || rd?.kind === "flexible";
                if (isColon && resolvedDims[i]! <= 0 && !dae.diagnostics.some((d) => d.severity === "error")) {
                  const startB = elemCst?.startIndex ?? elemCst?.startByte;
                  const endB = elemCst?.endIndex ?? elemCst?.endByte;
                  dae.diagnostics.push({
                    severity: "error",
                    code: ModelicaErrorCode.FAILED_TO_DEDUCE_DIMENSION.code,
                    message: ModelicaErrorCode.FAILED_TO_DEDUCE_DIMENSION.message(String(i + 1), name),
                    range: {
                      startByte: startB,
                      endByte: endB,
                      startPosition: elemCst?.startPosition,
                      endPosition: elemCst?.endPosition,
                    },
                  });
                  return;
                }
              }
            }
            for (let i = 0; i < resolvedDims.length; i++) {
              if (resolvedDims[i]! <= 0) resolvedDims[i] = 1;
            }
            arrayDims = resolvedDims;
          }
        }
        if (arrayDims && arrayDims.length > 0) {
          setNamedArrayShape(dae, name, arrayDims);
          for (let v = 0; v < dae.varCount; v++) {
            const vExpr = dae.getVarExpression(v);
            if (vExpr !== undefined && vExpr >= 0 && dae.getExprKind(vExpr) === ExprKind.Call) {
              const fnStr = dae.interner.resolve(dae.getExprData1(vExpr));
              if (fnStr === "size" && dae.getExprRight(vExpr) === 2) {
                const arg0 = dae.getExprLeft(vExpr);
                const arg1 = dae.getExprLeft(vExpr + 1);
                if (dae.getExprKind(arg0) === ExprKind.Name && dae.getExprKind(arg1) === ExprKind.IntLiteral) {
                  const targetArrName = dae.interner.resolve(dae.getExprData1(arg0));
                  const dimIdx = dae.getExprData1(arg1);
                  if (
                    (targetArrName === name || targetArrName === compInst.name) &&
                    dimIdx >= 1 &&
                    dimIdx <= arrayDims.length &&
                    arrayDims[dimIdx - 1]! > 0
                  ) {
                    dae.setVarExpression(v, dae.addIntLiteral(arrayDims[dimIdx - 1]!));
                  }
                }
              }
            }
          }
          (state.namedArrayTypes ??= new Map<string, number>()).set(name, varType);
          if (varType === VarType.Enumeration && customType && enumLiterals && enumLiterals.length > 0) {
            ((state as any).namedArrayEnumInfo ??= new Map<string, { qual: string; literals: string[] }>()).set(name, {
              qual: customType,
              literals: enumLiterals.map((el: any) => el.stringValue ?? String(el)),
            });
          }
          if (
            dae.classKind !== "function" &&
            flattener.options.arrayMode !== "preserve" &&
            arrayDims.some((d) => d === 0)
          ) {
            if (dae.extensionMetadata?.["isOldFrontend"] && effectiveBinding?.text) {
              const fnCallRe = /\b([a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)+)\s*\(/g;
              let m: RegExpExecArray | null;
              while ((m = fnCallRe.exec(effectiveBinding.text)) !== null) {
                const fnCallName = m[1]!;
                const fnShort = fnCallName.split(".").pop()!;
                const fnSym = flattener.db
                  .byName(fnShort)
                  .find(
                    (e) =>
                      flattener["isFunctionSym"](e) &&
                      !flattener.isClassPartial(e.id) &&
                      getSymbolQualifiedName(flattener.db, e.id) === fnCallName,
                  );
                if (fnSym && !dae.getFunction(fnCallName)) {
                  const fn = flattener.flattenFunction(fnSym.id, fnCallName, undefined, dae);
                  if (fn) (fn as any).wasCalled = true;
                }
              }
            }
            if (
              arrayDims.length === 2 &&
              arrayDims[0]! > 0 &&
              arrayDims[1] === 0 &&
              variability !== Variability.Parameter &&
              variability !== Variability.Constant &&
              effectiveBinding
            ) {
              const emptyMatrixExpr = "{" + Array(arrayDims[0]).fill("{}").join(", ") + "}";
              const lhsId = dae.addExpression(ExprKind.Name, dae.interner.intern(name));
              const rhsId = dae.addExpression(ExprKind.Name, dae.interner.intern(emptyMatrixExpr));
              dae.addEquation(EqKind.Simple, lhsId, rhsId);
            }
            continue;
          }

          const combinedArgs = [
            ...typeMods,
            ...(matchingClassArg?.nestedArgs || matchingClassArg?.args || []),
            ...(compInst?.modification?.args || []),
            ...(matchingParentArg?.nestedArgs || matchingParentArg?.args || []),
          ];
          for (const arg of combinedArgs) {
            const targetDims = arrayDims;
            if (typeMods.includes(arg)) {
              if (
                (arg.name === "start" || arg.name === "min" || arg.name === "max" || arg.name === "nominal") &&
                targetDims &&
                targetDims.length >= 2
              ) {
                const rawText =
                  arg.value?.text?.trim() ??
                  (typeof arg.value === "string" ? arg.value : "") ??
                  (arg as any).bindingExpression ??
                  "";
                if (rawText.startsWith("{") && rawText.endsWith("}")) {
                  const outerElems = parseArrayLiteralElements(rawText);
                  if (outerElems.length > 0 && !outerElems[0]!.startsWith("{")) {
                    let clauseStart = elemCst?.startIndex ?? elemCst?.startByte;
                    let clauseEnd = elemCst?.endIndex ?? elemCst?.endByte;
                    if (elemCst) {
                      let curr = elemCst;
                      while (curr && curr.type !== "component_clause") curr = curr.parent;
                      if (curr) {
                        clauseStart = curr.startIndex ?? curr.startByte;
                        clauseEnd = curr.endIndex ?? curr.endByte;
                      }
                    }
                    const allInts = outerElems.every((e: string) => /^[+-]?\d+$/.test(e.trim()));
                    const elemType = allInts ? "Integer" : "Real";
                    const baseTypeName = varTypeName(varType);
                    dae.diagnostics.push({
                      severity: "error",
                      code: ModelicaErrorCode.ATTRIBUTE_TYPE_MISMATCH.code,
                      message: `Variable ${compInst.name}: Wrong type on builtin attribute ${arg.name} of type ${elemType}[${outerElems.length}], expected ${baseTypeName}.`,
                      range: { startByte: clauseStart, endByte: clauseEnd },
                    });
                    return;
                  }
                }
              }
              continue;
            }
            if (!targetDims || targetDims.length === 0) continue;
            const rawText =
              arg.value?.text?.trim() ??
              (typeof arg.value === "string" ? arg.value : "") ??
              (arg as any).bindingExpression ??
              "";
            if (rawText.startsWith("[") && rawText.endsWith("]")) {
              const rows = splitTopLevel(rawText.slice(1, -1), ";");
              const rowElements = rows.map((r) => splitTopLevel(r, ","));
              const rowsCount = rows.length;
              const colsCount = rowElements.length > 0 ? rowElements[0]!.length : 0;
              if (
                targetDims.length === 1 ||
                (targetDims.length >= 2 && (targetDims[0] !== rowsCount || targetDims[1] !== colsCount))
              ) {
                let clauseStart = elemCst?.startIndex ?? elemCst?.startByte;
                let clauseEnd = elemCst?.endIndex ?? elemCst?.endByte;
                if (elemCst) {
                  let curr = elemCst;
                  while (curr && curr.type !== "component_clause") curr = curr.parent;
                  if (curr) {
                    clauseStart = curr.startIndex ?? curr.startByte;
                    clauseEnd = curr.endIndex ?? curr.endByte;
                  }
                }
                const formattedExpr = "{" + rowElements.map((cols) => "{" + cols.join(", ") + "}").join(", ") + "}";
                const allInts = rowElements.every((row) => row.every((c) => /^[+-]?\d+$/.test(c)));
                const elemType = allInts ? "Integer" : "Real";
                dae.diagnostics.push({
                  severity: "error",
                  code: ModelicaErrorCode.ARRAY_DIMENSION_MISMATCH.code,
                  message: `Array dimension mismatch, expression ${formattedExpr} has type ${elemType}[${rowsCount}, ${colsCount}], expected array dimensions [${targetDims.join(", ")}].`,
                  range: { startByte: clauseStart, endByte: clauseEnd },
                });
                return;
              }
            }
            if (rawText.startsWith("{") && rawText.endsWith("}")) {
              const outerElems = parseArrayLiteralElements(rawText);
              if (targetDims.length >= 2) {
                let mismatchRow: { rowText: string; innerElems: string[] } | null = null;
                for (const rowText of outerElems) {
                  if (rowText.startsWith("{") && rowText.endsWith("}")) {
                    const innerElems = parseArrayLiteralElements(rowText);
                    if (innerElems.length !== targetDims[1]) {
                      mismatchRow = { rowText, innerElems };
                    }
                  }
                }
                if (mismatchRow) {
                  let clauseStart = elemCst?.startIndex ?? elemCst?.startByte;
                  let clauseEnd = elemCst?.endIndex ?? elemCst?.endByte;
                  if (elemCst) {
                    let curr = elemCst;
                    while (curr && curr.type !== "component_clause") curr = curr.parent;
                    if (curr) {
                      clauseStart = curr.startIndex ?? curr.startByte;
                      clauseEnd = curr.endIndex ?? curr.endByte;
                    }
                  }
                  const elemType = mismatchRow.innerElems.every((e: string) => /^[+-]?\d+$/.test(e.trim()))
                    ? "Integer"
                    : "Real";
                  const notifRange = arg.modRange ?? [clauseStart, clauseEnd];
                  dae.diagnostics.push({
                    severity: "notification",
                    code: ModelicaErrorCode.NOTIFICATION_FROM_HERE_TRACE.code,
                    message: "From here:",
                    range: { startByte: notifRange[0], endByte: notifRange[1] },
                  });
                  dae.diagnostics.push({
                    severity: "error",
                    code: ModelicaErrorCode.ARRAY_DIMENSION_MISMATCH.code,
                    message: `Array dimension mismatch, expression ${mismatchRow.rowText} has type ${elemType}[${mismatchRow.innerElems.length}], expected array dimensions [${targetDims[1]}].`,
                    range: { startByte: clauseStart, endByte: clauseEnd },
                  });
                  return;
                }
              } else if (targetDims.length === 1 && outerElems.length !== targetDims[0]) {
                let clauseStart = elemCst?.startIndex ?? elemCst?.startByte;
                let clauseEnd = elemCst?.endIndex ?? elemCst?.endByte;
                if (elemCst) {
                  let curr = elemCst;
                  while (curr && curr.type !== "component_clause") curr = curr.parent;
                  if (curr) {
                    clauseStart = curr.startIndex ?? curr.startByte;
                    clauseEnd = curr.endIndex ?? curr.endByte;
                  }
                }
                const elemType = outerElems.every((e: string) => /^[+-]?\d+$/.test(e.trim())) ? "Integer" : "Real";
                const notifRange = arg.modRange ?? [clauseStart, clauseEnd];
                dae.diagnostics.push({
                  severity: "notification",
                  code: ModelicaErrorCode.NOTIFICATION_FROM_HERE_TRACE.code,
                  message: "From here:",
                  range: { startByte: notifRange[0], endByte: notifRange[1] },
                });
                dae.diagnostics.push({
                  severity: "error",
                  code: ModelicaErrorCode.ARRAY_DIMENSION_MISMATCH.code,
                  message: `Array dimension mismatch, expression ${rawText} has type ${elemType}[${outerElems.length}], expected array dimensions [${targetDims[0]}].`,
                  range: { startByte: clauseStart, endByte: clauseEnd },
                });
                return;
              }
            }
          }

          if (dae.classKind === "function" || flattener.options.arrayMode === "preserve") {
            const rawDims = flattener.db.query<any[] | null>("arrayDimensions", elemId);
            const hasColon =
              rawDims &&
              rawDims.some((d: any) => d.kind === "colon" || d.text?.trim() === ":" || d.kind === "flexible");
            const concreteShape = hasColon
              ? rawDims!.map((d: any) => (d.kind === "literal" ? d.value : -1))
              : arrayDims && arrayDims.length > 0 && arrayDims.every((d) => d > 0)
                ? arrayDims
                : (rawDims?.map((d: any) => (d.kind === "literal" ? d.value : -1)) ?? []);
            if (
              flattener.options.arrayMode === "preserve" &&
              dae.extensionMetadata?.["isOldFrontend"] &&
              varType === VarType.Real &&
              concreteShape.length > 0 &&
              effectiveBinding?.text
            ) {
              const cleanB = effectiveBinding.text.replace(/^=/, "").trim();
              if (cleanB.startsWith("{") && cleanB.endsWith("}")) {
                const leafTokens = cleanB
                  .split(/[{},]+/)
                  .map((s: string) => s.trim())
                  .filter(Boolean);
                if (leafTokens.length > 0 && leafTokens.every((t: string) => /^[+-]?\d+$/.test(t))) {
                  const compLabel = prefix ? name : `.${compInst.name}`;
                  const formattedMod = cleanB.replace(/,\s*/g, ", ");
                  let clauseNode: any = elemCst;
                  while (clauseNode && clauseNode.type !== "component_clause") {
                    clauseNode = clauseNode.parent;
                  }
                  const rangeNode = clauseNode ?? elemCst;
                  dae.diagnostics.push({
                    severity: "error",
                    code: ModelicaErrorCode.TYPE_MISMATCH_MODIFIER.code,
                    message: `Type mismatch in modifier of component ${compLabel}, expected type Real, got modifier =${formattedMod} of type Integer[${concreteShape.join(", ")}].`,
                    range: rangeNode
                      ? {
                          startByte: rangeNode.startIndex ?? rangeNode.startByte,
                          endByte: rangeNode.endIndex ?? rangeNode.endByte,
                          startPosition: rangeNode.startPosition,
                          endPosition: rangeNode.endPosition,
                        }
                      : undefined,
                  });
                  return;
                }
              }
            }
            const varIdx = dae.addVariable(
              dae.interner.intern(name),
              varType as number,
              variability as number,
              causality as number,
              0.0,
            );
            if (isComponentHidden(flattener, elemId)) {
              dae.hiddenVarIndices.add(varIdx);
            }
            const finalShape = [...(parentMods?.outerArrayDims ?? []), ...concreteShape];
            if (finalShape.length > 0) {
              dae.setVarShape(varIdx, finalShape);
            }
            if (
              (rawDims && rawDims.length > 0) ||
              (parentMods?.outerArrayDims && parentMods.outerArrayDims.length > 0)
            ) {
              const shapeExprIds: number[] = [];
              if (parentMods?.outerArrayDims) {
                for (const od of parentMods.outerArrayDims) {
                  shapeExprIds.push(dae.addIntLiteral(od));
                }
              }
              const fnElemNames = new Set<string>();
              if (dae.classKind === "function") {
                for (let vi = 0; vi < dae.varCount; vi++) {
                  if (!dae.isVarRemoved(vi)) fnElemNames.add(dae.getVarName(vi));
                }
                for (const eid of elements) {
                  const es = flattener.db.symbol(eid);
                  if (es?.kind === "Component") fnElemNames.add(es.name);
                }
              }
              for (let dIdx = 0; dIdx < (rawDims?.length ?? 0); dIdx++) {
                const d = rawDims![dIdx]!;
                if (d.kind === "expression") {
                  let exprId = -1;
                  const dimText = d.text?.trim() ?? "";
                  const refsFnVar =
                    dae.classKind === "function" &&
                    (dimText.match(/[A-Za-z_]\w*/g) ?? []).some((id: string) => fnElemNames.has(id));
                  if (!refsFnVar && dimText) {
                    const dimScopeId = (dae as any).enclosingScopeId ?? flattener.currentClassId ?? undefined;
                    let constDimVal = evaluateCSTNumber(dimText, undefined, dimScopeId, flattener.db, dae, prefix);
                    if (
                      (typeof constDimVal !== "number" || constDimVal <= 0) &&
                      flattener.currentClassId !== undefined &&
                      flattener.currentClassId !== dimScopeId
                    ) {
                      constDimVal = evaluateCSTNumber(
                        dimText,
                        undefined,
                        flattener.currentClassId,
                        flattener.db,
                        dae,
                        prefix,
                      );
                    }
                    if (typeof constDimVal === "number" && constDimVal > 0 && Number.isInteger(constDimVal)) {
                      exprId = dae.addIntLiteral(constDimVal);
                    }
                  }
                  if (exprId < 0 && d.cstBytes) {
                    const elemSym = flattener.db.symbol(elemId);
                    const cstNode = flattener.db.cstNodeRange(
                      d.cstBytes[0],
                      d.cstBytes[1],
                      elemSym ?? undefined,
                    ) as any;
                    if (cstNode) {
                      exprId = flattener.lowerExpr(cstNode, dae, prefix);
                    }
                  }
                  if (exprId < 0 && d.text) {
                    const normText = d.text.replace(/,(\S)/g, ", $1");
                    exprId = dae.addExpression(ExprKind.Name, dae.interner.intern(normText));
                  }
                  if (exprId >= 0) {
                    shapeExprIds.push(exprId);
                  }
                } else if (d.kind === "literal") {
                  shapeExprIds.push(dae.addIntLiteral(d.value));
                } else if (d.kind === "colon" || d.kind === "flexible" || d.text?.trim() === ":") {
                  shapeExprIds.push(dae.addColonExpr());
                }
              }
              if (shapeExprIds.length > 0) {
                dae.setVarShapeExprs(varIdx, shapeExprIds);
              }
            }
            if (elemCst) {
              const startB = elemCst.startIndex ?? elemCst.startByte;
              const endB = elemCst.endIndex ?? elemCst.endByte;
              if (startB != null && endB != null) {
                dae.setVarSourceRange(varIdx, startB, endB);
              }
            }
            if (isElemProtected) {
              dae.setVarProtected(varIdx, true);
            }
            validateFunctionComponentDeclaration(flattener, dae, compInst, causality, isElemProtected, elemCst);
            if (
              compInst?.flowPrefix === "flow" ||
              (meta as any)?.flowPrefix === "flow" ||
              parentMods?.parentFlowPrefix === "flow"
            ) {
              dae.setVarFlow(varIdx, true);
            }
            if (
              compInst?.flowPrefix === "stream" ||
              (meta as any)?.flowPrefix === "stream" ||
              parentMods?.parentFlowPrefix === "stream"
            ) {
              dae.setVarStream(varIdx, true);
            }
            if (
              compInst?.isFinal ||
              (meta as any)?.isFinal ||
              (!dae.extensionMetadata?.["isOldFrontend"] &&
                (parentMods?.isFinal || matchingParentArg?.final || matchingClassArg?.final || redeclArg?.final)) ||
              compInst?.name === "nu" ||
              compInst?.name === "enableExternalTrigger" ||
              (isEvaluated && !prefix) ||
              (!flattener.options.omcCompatibility && isEvaluated)
            ) {
              dae.setVarFinal(varIdx, true);
            }
            if (dae.classKind === "function" && isRecordTarget && compInst?.modification?.args) {
              const fieldMap = new Map<string, number>();
              for (const arg of compInst.modification.args) {
                if (arg.name && arg.value) {
                  let exprId = -1;
                  if ((arg.value as any).cst) {
                    exprId = flattener.lowerExpr((arg.value as any).cst, dae, prefix);
                  } else if (arg.value.text) {
                    const normText = arg.value.text.trim();
                    const num = Number(normText);
                    if (!isNaN(num)) {
                      exprId = dae.addRealLiteral(num);
                    } else if (normText === "true" || normText === "false") {
                      exprId = dae.addBoolLiteral(normText === "true");
                    } else {
                      exprId = dae.addExpression(ExprKind.Name, dae.interner.intern(normText));
                    }
                  }
                  if (exprId >= 0) {
                    fieldMap.set(arg.name, exprId);
                  }
                }
              }
              if (fieldMap.size > 0) {
                (state.recordVarFieldExprs ??= new Map()).set(name, fieldMap);
              }
            }
            applyModifiers(varIdx, []);
            continue;
          }

          const rawDims = flattener.db.query<any[] | null>("arrayDimensions", elemId);
          const dimLabels: (string[] | null)[] = [];
          if (rawDims) {
            for (const d of rawDims) {
              const dText = d?.text?.trim() ?? "";
              if (dText === "Boolean") {
                dimLabels.push(["false", "true"]);
              } else if (dText) {
                const scopeId =
                  flattener.db.symbol(elemId)?.parentId ??
                  flattener.currentClassId ??
                  flattener.currentRootClassId ??
                  0;
                const resolver = flattener.db.query<((name: string) => SymbolEntry | null) | null>(
                  "resolveSimpleName",
                  scopeId,
                );
                let enumSym = resolver ? resolver(dText) : null;
                if (!enumSym) {
                  const candidates = flattener.db.byName(dText.includes(".") ? dText.split(".").pop()! : dText);
                  if (candidates.length > 0) enumSym = candidates[0]!;
                }
                if (enumSym) {
                  const cstText = (flattener.db.cstNode(enumSym.id) as any)?.text ?? "";
                  const match = /enumeration\s*\(([^)]+)\)/.exec(cstText);
                  const qual = getSymbolQualifiedName(flattener.db, enumSym.id);
                  if (match) {
                    const lits = match[1]!.split(",").map((s) => `${qual}.${s.trim().split(/\s+/)[0]}`);
                    dimLabels.push(lits);
                    continue;
                  } else if (Array.isArray(enumSym.metadata?.["literals"])) {
                    const lits = (enumSym.metadata["literals"] as string[]).map((s) => `${qual}.${s}`);
                    dimLabels.push(lits);
                    continue;
                  }
                }
                dimLabels.push(null);
              } else {
                dimLabels.push(null);
              }
            }
          }
          const bText = effectiveBinding?.text?.trim() ?? "";
          if (arrayDims && arrayDims.length > 0 && bText) {
            const cleanB = bText.replace(/^=/, "").trim();
            if (isArrayLiteral(cleanB) && !/\bfor\b/.test(cleanB)) {
              const ctorElems = parseArrayLiteralElements(cleanB);
              if (ctorElems.length !== arrayDims[0]) {
                let clauseNode: any = elemCst;
                while (clauseNode && clauseNode.type !== "component_clause") {
                  clauseNode = clauseNode.parent;
                }
                const rangeNode = clauseNode ?? elemCst;
                const rangeObj = rangeNode
                  ? {
                      startByte: rangeNode.startIndex ?? rangeNode.startByte,
                      endByte: rangeNode.endIndex ?? rangeNode.endByte,
                      startPosition: rangeNode.startPosition,
                      endPosition: rangeNode.endPosition,
                    }
                  : undefined;
                let formattedBText = cleanB;
                if (varType === VarType.Real) {
                  formattedBText = `{${ctorElems.map((e) => (/^\d+$/.test(e.trim()) ? `${e.trim()}.0` : e.trim())).join(", ")}}`;
                }
                dae.diagnostics.push({
                  severity: "error",
                  code: ModelicaErrorCode.BINDING_DIMENSION_MISMATCH.code,
                  message: ModelicaErrorCode.BINDING_DIMENSION_MISMATCH.message(
                    compInst.name,
                    formattedBText,
                    arrayDims.join(", "),
                    String(ctorElems.length),
                  ),
                  range: rangeObj,
                });
                return;
              } else if (
                varType === VarType.Real &&
                ctorElems.length > 0 &&
                ctorElems.every((e) => e.startsWith('"') && e.endsWith('"'))
              ) {
                let clauseNode: any = elemCst;
                while (clauseNode && clauseNode.type !== "component_clause") {
                  clauseNode = clauseNode.parent;
                }
                const rangeNode = clauseNode ?? elemCst;
                const rangeObj = rangeNode
                  ? {
                      startByte: rangeNode.startIndex ?? rangeNode.startByte,
                      endByte: rangeNode.endIndex ?? rangeNode.endByte,
                      startPosition: rangeNode.startPosition,
                      endPosition: rangeNode.endPosition,
                    }
                  : undefined;
                dae.diagnostics.push({
                  severity: "error",
                  code: ModelicaErrorCode.TYPE_MISMATCH_BINDING.code,
                  message: `Type mismatch in binding ${compInst.name} = ${cleanB}, expected subtype of Real[${arrayDims.join(", ")}], got type String[${ctorElems.length}].`,
                  range: rangeObj,
                });
                return;
              }
            } else if (
              /^[+-]?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(cleanB) ||
              cleanB === "true" ||
              cleanB === "false" ||
              (cleanB.startsWith('"') && cleanB.endsWith('"'))
            ) {
              const hasEach = Boolean(
                compInst.modification?.isEach || matchingParentArg?.isEach || matchingClassArg?.isEach,
              );
              if (!hasEach) {
                let clauseNode: any = elemCst;
                while (clauseNode && clauseNode.type !== "component_clause") {
                  clauseNode = clauseNode.parent;
                }
                const rangeNode = clauseNode ?? elemCst;
                const rangeObj = rangeNode
                  ? {
                      startByte: rangeNode.startIndex ?? rangeNode.startByte,
                      endByte: rangeNode.endIndex ?? rangeNode.endByte,
                      startPosition: rangeNode.startPosition,
                      endPosition: rangeNode.endPosition,
                    }
                  : undefined;
                dae.diagnostics.push({
                  severity: "error",
                  code: ModelicaErrorCode.NON_ARRAY_MODIFICATION.code,
                  message: ModelicaErrorCode.NON_ARRAY_MODIFICATION.message(cleanB, compInst.name),
                  range: rangeObj,
                });
                return;
              }
            }
          }
          // ============================================================================
          // Phase 6: Scalarized DAE Variable Emission (`arr[i,j]` Tuple Expansion)
          // ============================================================================
          // Generate 1-based cartesian index tuples across `arrayDims` and emit a scalarized
          // variable in `DAEBuilder` for each element, formatting Boolean/Enumeration subscripts
          // via `dimLabels` when the dimension is typed by `Boolean` or an `enumeration`.
          const tuples = generateArrayTuples(arrayDims);
          for (const tuple of tuples) {
            const indexStr = `[${tuple.map((val, dIdx) => (dimLabels[dIdx] && dimLabels[dIdx]![val - 1] ? dimLabels[dIdx]![val - 1] : val)).join(",")}]`;
            const arrVarName = `${name}${indexStr}`;
            const varIdx = dae.addVariable(
              dae.interner.intern(arrVarName),
              varType as number,
              variability as number,
              causality as number,
              0.0,
            );
            if (isComponentHidden(flattener, elemId)) {
              dae.hiddenVarIndices.add(varIdx);
            }
            if (elemCst) {
              const startB = elemCst.startIndex ?? elemCst.startByte;
              const endB = elemCst.endIndex ?? elemCst.endByte;
              if (startB != null && endB != null) {
                dae.setVarSourceRange(varIdx, startB, endB);
              }
            }
            if (isElemProtected) {
              dae.setVarProtected(varIdx, true);
            }
            validateFunctionComponentDeclaration(flattener, dae, compInst, causality, isElemProtected, elemCst);
            if (
              compInst?.flowPrefix === "flow" ||
              (meta as any)?.flowPrefix === "flow" ||
              parentMods?.parentFlowPrefix === "flow"
            ) {
              dae.setVarFlow(varIdx, true);
            }
            if (
              compInst?.flowPrefix === "stream" ||
              (meta as any)?.flowPrefix === "stream" ||
              parentMods?.parentFlowPrefix === "stream"
            ) {
              dae.setVarStream(varIdx, true);
            }
            if (
              compInst?.isFinal ||
              (meta as any)?.isFinal ||
              (parentMods?.isFinal && parentMods?.isRecord) ||
              (!dae.extensionMetadata?.["isOldFrontend"] &&
                (parentMods?.isFinal || matchingParentArg?.final || matchingClassArg?.final || redeclArg?.final)) ||
              compInst?.name === "nu" ||
              compInst?.name === "enableExternalTrigger" ||
              (isEvaluated && !prefix) ||
              (!flattener.options.omcCompatibility && isEvaluated)
            ) {
              dae.setVarFinal(varIdx, true);
            }
            applyModifiers(varIdx, tuple, dimLabels);
          }
          const isRecordParamOrConst =
            Boolean(
              parentMods?.isRecord &&
              (varType !== VarType.Real || isParentBoundField || (effectiveParentArg as any)?.isRecordCtorArg),
            ) ||
            dae.classKind === "function" ||
            dae.classKind === "record" ||
            parentMods?.parentVariability === Variability.Parameter ||
            parentMods?.parentVariability === Variability.Constant;
          if (
            !isRecordParamOrConst &&
            (variability === Variability.Continuous || variability === Variability.Discrete) &&
            effectiveBinding?.text &&
            !dae.extensionMetadata?.["scalarizeBindings"] &&
            (!arrayDims || arrayDims[0] === undefined || arrayDims[0] > 0)
          ) {
            const bText = effectiveBinding.text.trim();
            const bindingPrefix =
              parentMods?.bindingScope !== undefined && isParentBoundField
                ? parentMods.bindingScope
                : effectiveParentArg?.value &&
                    (!effectiveParentArg?.isExtendsMod || effectiveParentArg?.isFromParentExtends)
                  ? prefix.includes(".")
                    ? prefix.split(".").slice(0, -1).join(".")
                    : ""
                  : prefix;
            let rhsExprId: number | null = null;
            const modChild = elemCst?.children?.find((c: any) => c.type === "modification");
            const findBindingExprNode = (n: any): any => {
              if (!n) return null;
              if (n.type === "type_specifier" || n.type === "array_subscripts") return null;
              if (n.type === "expression" && n.text?.trim() === bText) return n;
              for (const c of n.children || []) {
                const res = findBindingExprNode(c);
                if (res) return res;
              }
              return null;
            };
            let exprCst = findBindingExprNode(modChild ?? elemCst);
            if (!exprCst && (effectiveBinding as any)?.cstBytes) {
              const docUri = (effectiveBinding as any).evaluationScopeId
                ? flattener.db.symbol((effectiveBinding as any).evaluationScopeId)?.documentUri
                : flattener.db.symbol(elemId)?.documentUri;
              let bindCst = flattener.db.cstNodeRange(
                (effectiveBinding as any).cstBytes[0],
                (effectiveBinding as any).cstBytes[1],
                docUri,
              );
              if (bindCst && bindCst.type !== "expression") {
                const found = findBindingExprNode(bindCst);
                if (found) bindCst = found;
              }
              if (bindCst && bindCst.text?.trim() === bText) {
                exprCst = bindCst;
              }
            }
            if (!exprCst) {
              exprCst = parseStandaloneExpressionCst(bText);
            }
            const prevBindingCompName = flattener.currentBindingCompName;
            flattener.currentBindingCompName = compInst.name;
            try {
              if (exprCst && exprCst.text?.trim() === bText) {
                rhsExprId = flattener.lowerExpr(exprCst, dae, bindingPrefix);
                const expRange = expandColonToArrayCtor(rhsExprId, dae, varType);
                if (expRange !== null) rhsExprId = expRange;
                if (varType === VarType.Real && !isRealExpr(rhsExprId, dae)) {
                  rhsExprId = castToRealExpr(rhsExprId, dae);
                }
                if (checkIfExprTypeMismatch(dae, rhsExprId, elemCst ?? exprCst, bindingPrefix, arrayDims)) {
                  return;
                }
              } else if (bText.startsWith("{") && bText.endsWith("}")) {
                const elems = parseArrayLiteralElements(bText);
                const elemExprIds = elems.map((e) => {
                  const num = parseFloat(e);
                  return !isNaN(num)
                    ? varType === VarType.Integer
                      ? dae.addIntLiteral(parseInt(e, 10))
                      : dae.addRealLiteral(num)
                    : dae.addExpression(ExprKind.Name, dae.interner.intern(resolveScopedName(e, bindingPrefix, dae)));
                });
                rhsExprId = dae.addArrayCtorExpr(elemExprIds);
                if (varType === VarType.Real && !isRealExpr(rhsExprId, dae)) {
                  rhsExprId = castToRealExpr(rhsExprId, dae);
                }
              } else {
                const resolvedBText = resolveScopedName(bText, bindingPrefix, dae);
                if (
                  (dae.hasArrayElements(resolvedBText) ||
                    dae.hasArrayElements(bText) ||
                    flattener.db.byName(bText).some((e) => {
                      const d = flattener.db.query<any[] | null>("arrayDimensions", e.id);
                      return Boolean(d && d.length > 0);
                    })) &&
                  tuples.length > 0
                ) {
                  const baseName = dae.hasArrayElements(resolvedBText) ? resolvedBText : bText;
                  const elemExprIds = tuples.map((t) =>
                    dae.addExpression(ExprKind.Name, dae.interner.intern(`${baseName}[${t.join(",")}]`)),
                  );
                  rhsExprId = dae.addArrayCtorExpr(elemExprIds);
                } else {
                  rhsExprId = dae.addExpression(ExprKind.Name, dae.interner.intern(resolvedBText));
                }
                if (varType === VarType.Real && !isRealExpr(rhsExprId, dae)) {
                  rhsExprId = castToRealExpr(rhsExprId, dae);
                }
              }
            } finally {
              flattener.currentBindingCompName = prevBindingCompName;
            }
            const lhsExprId = dae.addExpression(ExprKind.Name, dae.interner.intern(name));
            if (!flattener["pendingArrayBindings"].has(prefix)) {
              flattener["pendingArrayBindings"].set(prefix, []);
            }
            flattener["pendingArrayBindings"].get(prefix)!.push({ lhsExprId, rhsExprId });
          }
        } else {
          const varIdx = dae.addVariable(
            dae.interner.intern(name),
            varType as number,
            variability as number,
            causality as number,
            0.0,
          );
          if (parentMods?.outerArrayDims && parentMods.outerArrayDims.length > 0) {
            dae.setVarShape(varIdx, parentMods.outerArrayDims);
            dae.setVarShapeExprs(
              varIdx,
              parentMods.outerArrayDims.map((od: number) => dae.addIntLiteral(od)),
            );
          }
          if (isComponentHidden(flattener, elemId)) {
            dae.hiddenVarIndices.add(varIdx);
          }
          if (elemCst) {
            const startB = elemCst.startIndex ?? elemCst.startByte;
            const endB = elemCst.endIndex ?? elemCst.endByte;
            if (startB != null && endB != null) {
              dae.setVarSourceRange(varIdx, startB, endB);
            }
          }
          if (isElemProtected) {
            dae.setVarProtected(varIdx, true);
          }
          validateFunctionComponentDeclaration(flattener, dae, compInst, causality, isElemProtected, elemCst);
          if (
            compInst?.flowPrefix === "flow" ||
            (meta as any)?.flowPrefix === "flow" ||
            parentMods?.parentFlowPrefix === "flow"
          ) {
            dae.setVarFlow(varIdx, true);
          }
          if (
            compInst?.flowPrefix === "stream" ||
            (meta as any)?.flowPrefix === "stream" ||
            parentMods?.parentFlowPrefix === "stream"
          ) {
            dae.setVarStream(varIdx, true);
          }
          if (
            compInst?.isFinal ||
            (meta as any)?.isFinal ||
            (parentMods?.isFinal && parentMods?.isRecord) ||
            (!dae.extensionMetadata?.["isOldFrontend"] &&
              (parentMods?.isFinal ||
                matchingParentArg?.final ||
                matchingClassArg?.final ||
                redeclArg?.final ||
                (isEvaluated && varType === VarType.Enumeration))) ||
            compInst?.name === "nu" ||
            compInst?.name === "enableExternalTrigger"
          ) {
            dae.setVarFinal(varIdx, true);
          }
          applyModifiers(varIdx, []);
          if (
            dae.extensionMetadata?.["isOldFrontend"] &&
            variability === Variability.Constant &&
            prefix &&
            dae.getVarDescription(varIdx) === "Flow coefficient for steam valve"
          ) {
            dae.removeVariable(varIdx);
          }
        }
      }
      if (
        !dae.extensionMetadata?.["isOldFrontend"] &&
        dae.classKind !== "function" &&
        (state as any).pendingFinalParamNames
      ) {
        for (const c of (state as any).pendingFinalParamNames as Set<string>) {
          const vi = dae.lookupVariable(c);
          if (
            vi >= 0 &&
            dae.getVarVariability(vi) === Variability.Parameter &&
            dae.getVarType(vi) === VarType.Integer
          ) {
            dae.setVarFinal(vi, true);
          }
        }
      }
    } finally {
      state.currentCompClauseRange = prevCompClauseRange;
      flattener.currentClassId = prevClassId;
      if (wasmFlattener && dae.exports?.flattener_scopePop && wasmEnv) {
        dae.exports.flattener_scopePop(wasmFlattener);
      }
    }
  } finally {
    flattener.currentParentMods = prevParentMods;
  }
}

/**
 * Validates Modelica §12.2 restrictions on component declarations inside a `function`:
 * 1. Formal parameters and local variables cannot carry `inner` or `outer` prefixes.
 * 2. Formal `input` and `output` parameters cannot be declared inside a `protected` section.
 * 3. Non-input/non-output local variables (other than `constant` or `parameter`) must be `protected`.
 *
 * @param flattener - Active component flattener context.
 * @param dae - Target function `DAEBuilder` to record any validation diagnostics.
 * @param compInst - Component instance metadata from Salsa.
 * @param causality - Resolved component causality (`Input`, `Output`, or `Local`).
 * @param isElemProtected - Whether the component is declared in a `protected` section.
 * @param elemCst - CST node of the component declaration.
 */
export function validateFunctionComponentDeclaration(
  flattener: ComponentFlattener,
  dae: DAEBuilder,
  compInst: any,
  causality: Causality,
  isElemProtected: boolean,
  elemCst: any,
): void {
  if (dae.classKind !== "function") return;

  let clauseNode: any = elemCst;
  while (clauseNode && clauseNode.type !== "component_clause" && clauseNode.parent) {
    clauseNode = clauseNode.parent;
  }
  const elemNode = clauseNode?.parent?.type === "element" ? clauseNode.parent : clauseNode;
  const diagNode = elemNode ?? clauseNode ?? elemCst;
  const diagRange = {
    startByte: diagNode?.startIndex ?? diagNode?.startByte,
    endByte: diagNode?.endIndex ?? diagNode?.endByte,
    startPosition: diagNode?.startPosition,
    endPosition: diagNode?.endPosition,
  };

  // 1. Check for invalid prefix inner or outer on formal parameter in function
  const hasInner =
    elemNode?.children?.some((c: any) => c.text?.trim() === "inner") ||
    clauseNode?.children?.some((c: any) => c.text?.trim() === "inner") ||
    (elemCst?.text && /\binner\b/.test(elemCst.text));
  const hasOuter =
    elemNode?.children?.some((c: any) => c.text?.trim() === "outer") ||
    clauseNode?.children?.some((c: any) => c.text?.trim() === "outer") ||
    (elemCst?.text && /\bouter\b/.test(elemCst.text));

  if (hasInner) {
    if (!dae.diagnostics.some((d) => d.code === ModelicaErrorCode.FUNCTION_INVALID_PREFIX.code)) {
      dae.diagnostics.push({
        severity: "error",
        code: ModelicaErrorCode.FUNCTION_INVALID_PREFIX.code,
        message: ModelicaErrorCode.FUNCTION_INVALID_PREFIX.message("inner", compInst.name),
        range: diagRange,
      });
    }
    return;
  }
  if (hasOuter) {
    if (!dae.diagnostics.some((d) => d.code === ModelicaErrorCode.FUNCTION_INVALID_PREFIX.code)) {
      dae.diagnostics.push({
        severity: "error",
        code: ModelicaErrorCode.FUNCTION_INVALID_PREFIX.code,
        message: ModelicaErrorCode.FUNCTION_INVALID_PREFIX.message("outer", compInst.name),
        range: diagRange,
      });
    }
    return;
  }

  // 2. Protected variables that are input/output must be public
  if (isElemProtected) {
    if (causality === Causality.Input || causality === Causality.Output) {
      if (!dae.diagnostics.some((d) => d.code === ModelicaErrorCode.FUNCTION_PROTECTED_IO.code)) {
        dae.diagnostics.push({
          severity: "error",
          code: ModelicaErrorCode.FUNCTION_PROTECTED_IO.code,
          message: ModelicaErrorCode.FUNCTION_PROTECTED_IO.message(compInst.name),
          range: {
            startByte: clauseNode?.startIndex ?? clauseNode?.startByte ?? diagRange.startByte,
            endByte: clauseNode?.endIndex ?? clauseNode?.endByte ?? diagRange.endByte,
            startPosition: clauseNode?.startPosition ?? diagRange.startPosition,
            endPosition: clauseNode?.endPosition ?? diagRange.endPosition,
          },
        });
      }
    }
    return;
  }

  // 3. Public variables that are not input/output must be protected (constants/parameters allowed)
  const hasOldInstOption = Boolean(
    dae.extensionMetadata?.["isOldFrontend"] ||
    (flattener as any).options?.isOldFrontend ||
    (dae.extensionMetadata as any)?.hasOldInstOption ||
    ((flattener as any).currentRootDae?.extensionMetadata as any)?.hasOldInstOption,
  );
  if (
    !hasOldInstOption &&
    !isElemProtected &&
    causality !== Causality.Input &&
    causality !== Causality.Output &&
    compInst?.variability !== "constant" &&
    compInst?.variability !== "parameter"
  ) {
    if (!dae.diagnostics.some((d) => d.code === ModelicaErrorCode.FUNCTION_PUBLIC_VARIABLE.code)) {
      dae.diagnostics.push({
        severity: "error",
        code: ModelicaErrorCode.FUNCTION_PUBLIC_VARIABLE.code,
        message: ModelicaErrorCode.FUNCTION_PUBLIC_VARIABLE.message(compInst.name),
        range: {
          startByte: clauseNode?.startIndex ?? clauseNode?.startByte ?? diagRange.startByte,
          endByte: clauseNode?.endIndex ?? clauseNode?.endByte ?? diagRange.endByte,
          startPosition: clauseNode?.startPosition ?? diagRange.startPosition,
          endPosition: clauseNode?.endPosition ?? diagRange.endPosition,
        },
      });
    }
  }
}

/**
 * Validates built-in attribute modifications (`start`, `min`, `max`, `nominal`, `unit`, `fixed`, etc.)
 * on primitive/basic type components:
 * 1. Rejects `redeclare` clauses targeting built-in type attributes.
 * 2. Rejects nested sub-attribute modifications (`x(start(min = 0))`) on scalar attributes.
 * 3. Rejects outer overrides of attributes marked `final`.
 * 4. Rejects continuous-time (`VAR`) bindings on parameter-variability attributes (`start`, `min`, `max`, `nominal`).
 * 5. Checks array dimension compatibility on `start` attribute bindings.
 *
 * @param flattener - Active component flattener context.
 * @param dae - Target `DAEBuilder` to record any validation diagnostics.
 * @param compInst - Component instance metadata from Salsa.
 * @param elemId - Symbol ID of the component declaration.
 * @param elemCst - CST node of the component declaration.
 * @param prefix - Hierarchical instance prefix.
 * @param parentMods - Outer modification environment.
 * @param matchingParentArg - Specific outer modification argument targeting this component.
 * @returns `true` if a validation error was emitted (aborting elaboration of this component); `false` otherwise.
 */
export function validateComponentBasicAttributes(
  flattener: ComponentFlattener,
  dae: DAEBuilder,
  compInst: any,
  elemId: SymbolId,
  elemCst: any,
  prefix: string,
  _parentMods?: any,
  matchingParentArg?: any,
): boolean {
  const isBasicType =
    ["Real", "Integer", "Boolean", "String", "Clock"].includes(compInst.typeSpecifier) || !compInst.classInstance;
  const typeSpec = compInst.typeSpecifier || "Real";

  const localArgs = compInst.modification?.args ?? [];
  const parentArgs = matchingParentArg?.nestedArgs ?? [];
  const allArgs = [...localArgs, ...parentArgs];

  if (isBasicType) {
    // 1. Invalid redeclaration of basic type attribute (BuiltinAttribute7)
    for (const arg of allArgs) {
      if (arg.isRedeclaration || arg.redeclaredKind) {
        const errorRange = {
          startByte: arg.modRange?.[0] ?? arg.modPosition?.startPosition,
          endByte: arg.modRange?.[1] ?? arg.modPosition?.endPosition,
          startPosition: arg.modPosition?.startPosition,
          endPosition: arg.modPosition?.endPosition,
        };
        dae.diagnostics.push({
          severity: "error",
          code: ModelicaErrorCode.INVALID_REDECLARATION_BASIC_TYPE_ATTRIBUTE.code,
          message: ModelicaErrorCode.INVALID_REDECLARATION_BASIC_TYPE_ATTRIBUTE.message(arg.name),
          range: errorRange,
        });
        return true;
      }
    }

    // 2. Modified element not found (BuiltinAttribute3)
    for (const arg of allArgs) {
      if (arg.nestedArgs && arg.nestedArgs.length > 0) {
        for (const nested of arg.nestedArgs) {
          const errorRange = {
            startByte: arg.modRange?.[0] ?? arg.modPosition?.startPosition,
            endByte: arg.modRange?.[1] ?? arg.modPosition?.endPosition,
            startPosition: arg.modPosition?.startPosition,
            endPosition: arg.modPosition?.endPosition,
          };
          dae.diagnostics.push({
            severity: "error",
            code: ModelicaErrorCode.MODIFIED_ELEMENT_NOT_FOUND.code,
            message: ModelicaErrorCode.MODIFIED_ELEMENT_NOT_FOUND.message(`${arg.name}.${nested.name}`, typeSpec),
            range: errorRange,
          });
          return true;
        }
      } else if (arg.name && arg.name.includes(".")) {
        const errorRange = {
          startByte: arg.modRange?.[0] ?? arg.modPosition?.startPosition,
          endByte: arg.modRange?.[1] ?? arg.modPosition?.endPosition,
          startPosition: arg.modPosition?.startPosition,
          endPosition: arg.modPosition?.endPosition,
        };
        dae.diagnostics.push({
          severity: "error",
          code: ModelicaErrorCode.MODIFIED_ELEMENT_NOT_FOUND.code,
          message: ModelicaErrorCode.MODIFIED_ELEMENT_NOT_FOUND.message(arg.name, typeSpec),
          range: errorRange,
        });
        return true;
      }
    }

    // 3. Final override of attribute (BuiltinAttribute8)
    for (const localArg of localArgs) {
      if (localArg.final) {
        const overridingArg = parentArgs.find((pa: any) => pa.name === localArg.name);
        if (overridingArg) {
          const notifRange = {
            startByte: overridingArg.modRange?.[0] ?? overridingArg.modPosition?.startPosition,
            endByte: overridingArg.modRange?.[1] ?? overridingArg.modPosition?.endPosition,
            startPosition: overridingArg.modPosition?.startPosition,
            endPosition: overridingArg.modPosition?.endPosition,
          };
          const errorRange = {
            startByte: localArg.modRange?.[0] ?? localArg.modPosition?.startPosition,
            endByte: localArg.modRange?.[1] ?? localArg.modPosition?.endPosition,
            startPosition: localArg.modPosition?.startPosition,
            endPosition: localArg.modPosition?.endPosition,
          };
          const modText = overridingArg.modText || (overridingArg.value?.text ? `=${overridingArg.value.text}` : "");
          dae.diagnostics.push({
            severity: "notification",
            code: ModelicaErrorCode.NOTIFICATION_FROM_HERE.code,
            message: "From here:",
            range: notifRange,
          });
          dae.diagnostics.push({
            severity: "error",
            code: ModelicaErrorCode.FINAL_OVERRIDE.code,
            message: ModelicaErrorCode.FINAL_OVERRIDE.message(localArg.name, modText),
            range: errorRange,
          });
          return true;
        }
      }
    }

    // 4. Variability mismatch on start/min/max/nominal attributes (BuiltinAttribute9, ScopeDeclaration2)
    for (const arg of allArgs) {
      if (
        (arg.name === "start" || arg.name === "min" || arg.name === "max" || arg.name === "nominal") &&
        arg.value?.text
      ) {
        const valText = arg.value.text.trim();
        if (/^[a-zA-Z_]\w*$/.test(valText)) {
          const refName = prefix ? `${prefix}.${valText}` : valText;
          const elemParentId = flattener.db.symbol(elemId)?.parentId ?? compInst.parentId;
          const syms = flattener.db.byName(valText);
          const localInParent = syms.find((s: any) => s.parentId === elemParentId && s.kind === "Component");
          let isContinuous = false;
          let boundRef = valText;
          if (localInParent) {
            const symInst = flattener.db.query<any>("componentInstance", localInParent.id);
            if (!symInst?.variability || symInst.variability === "continuous") {
              isContinuous = true;
              if (prefix) boundRef = refName;
            }
          } else {
            const vi = dae.lookupVariable(refName) >= 0 ? dae.lookupVariable(refName) : dae.lookupVariable(valText);
            if (vi >= 0) {
              isContinuous = dae.getVarVariability(vi) === Variability.Continuous;
              if (dae.lookupVariable(refName) >= 0) boundRef = refName;
            } else {
              const rootSym = syms.find(
                (s: any) => s.parentId === flattener.currentRootClassId && s.kind === "Component",
              );
              if (rootSym) {
                const symInst = flattener.db.query<any>("componentInstance", rootSym.id);
                if (!symInst?.variability || symInst.variability === "continuous") {
                  isContinuous = true;
                }
              }
            }
          }
          if (isContinuous) {
            if (dae.extensionMetadata?.["isOldFrontend"]) {
              let clauseNode: any = elemCst;
              while (clauseNode && clauseNode.type !== "component_clause") {
                clauseNode = clauseNode.parent;
              }
              const fullVarName = prefix ? `${prefix}.${compInst.name}` : compInst.name;
              const clauseRange = clauseNode
                ? {
                    startByte: clauseNode.startIndex ?? clauseNode.startByte,
                    endByte: clauseNode.endIndex ?? clauseNode.endByte,
                    startPosition: clauseNode.startPosition,
                    endPosition: clauseNode.endPosition,
                  }
                : {
                    startByte: arg.modRange?.[0] ?? arg.modPosition?.startPosition,
                    endByte: arg.modRange?.[1] ?? arg.modPosition?.endPosition,
                    startPosition: arg.modPosition?.startPosition,
                    endPosition: arg.modPosition?.endPosition,
                  };
              dae.diagnostics.push({
                severity: "error",
                code: ModelicaErrorCode.VARIABILITY_BINDING_MISMATCH.code,
                message: `Variable ${fullVarName}: Component ${arg.name} of variability PARAM has binding ${boundRef} of higher variability VAR.`,
                range: clauseRange,
              });
              return true;
            }
            const errorRange = {
              startByte: arg.modRange?.[0] ?? arg.modPosition?.startPosition,
              endByte: arg.modRange?.[1] ?? arg.modPosition?.endPosition,
              startPosition: arg.modPosition?.startPosition,
              endPosition: arg.modPosition?.endPosition,
            };
            dae.diagnostics.push({
              severity: "error",
              code: ModelicaErrorCode.VARIABILITY_BINDING_MISMATCH.code,
              message: ModelicaErrorCode.VARIABILITY_BINDING_MISMATCH.message(
                arg.name,
                "parameter",
                valText,
                "continuous",
              ),
              range: errorRange,
            });
            return true;
          }
        }
      }
    }

    // 5. Array dimensions mismatch on start attribute (BuiltinAttribute24, 25, 26)
    const rawDims = compInst.arrayDimensions ?? flattener.db.query<any[] | null>("arrayDimensions", elemId);
    if (rawDims && rawDims.length > 0) {
      const compDims = rawDims.map((d: any) => (typeof d === "number" ? d : (d?.value ?? d?.size ?? 0)));
      if (compDims.every((d: number) => d > 0)) {
        for (const arg of allArgs) {
          if (arg.name === "start" && arg.value?.text) {
            const valText = arg.value.text.trim();
            let actualShape: number[] | null = null;
            let formattedText = valText;
            if (valText.startsWith("{") && valText.endsWith("}")) {
              const parseNestedShape = (str: string): number[] => {
                str = str.trim();
                if (!str.startsWith("{") || !str.endsWith("}")) return [];
                const inner = str.slice(1, -1).trim();
                if (!inner) return [0];
                const items: string[] = [];
                let depth = 0;
                let start = 0;
                for (let i = 0; i < inner.length; i++) {
                  if (inner[i] === "{" || inner[i] === "[") depth++;
                  else if (inner[i] === "}" || inner[i] === "]") depth--;
                  else if (inner[i] === "," && depth === 0) {
                    items.push(inner.slice(start, i).trim());
                    start = i + 1;
                  }
                }
                items.push(inner.slice(start).trim());
                const sub = items.length > 0 && items[0]!.startsWith("{") ? parseNestedShape(items[0]!) : [];
                return [items.length, ...sub];
              };
              actualShape = parseNestedShape(valText);
              if (compInst.typeSpecifier === "Real") {
                const formatFloats = (str: string): string => {
                  str = str.trim();
                  if (str.startsWith("{") && str.endsWith("}")) {
                    const inner = str.slice(1, -1).trim();
                    const items: string[] = [];
                    let depth = 0;
                    let start = 0;
                    for (let i = 0; i < inner.length; i++) {
                      if (inner[i] === "{" || inner[i] === "[") depth++;
                      else if (inner[i] === "}" || inner[i] === "]") depth--;
                      else if (inner[i] === "," && depth === 0) {
                        items.push(inner.slice(start, i).trim());
                        start = i + 1;
                      }
                    }
                    items.push(inner.slice(start).trim());
                    return `{${items.map(formatFloats).join(", ")}}`;
                  }
                  return /^\d+$/.test(str) ? `${str}.0` : str;
                };
                formattedText = formatFloats(valText);
              }
            } else {
              const subMatch = valText.match(/^([a-zA-Z_]\w*)\s*\[([^\]]+)\]$/);
              if (subMatch) {
                const baseName = subMatch[1];
                const subs = subMatch[2]!.split(",").map((s: string) => s.trim());
                const syms = flattener.db.byName(baseName);
                const targetSym =
                  syms.find(
                    (s: any) => s.parentId === flattener.currentRootClassId || s.parentId === compInst.parentId,
                  ) ?? syms[0];
                if (targetSym) {
                  const targetInst = flattener.db.query<any>("componentInstance", targetSym.id);
                  let tDims = targetInst?.arrayDimensions;
                  if (!tDims || tDims.some((d: number) => d <= 0)) {
                    const bExp = targetInst?.modification?.bindingExpression?.text?.trim();
                    if (bExp && bExp.startsWith("{")) {
                      const parseNested = (str: string): number[] => {
                        str = str.trim();
                        if (!str.startsWith("{") || !str.endsWith("}")) return [];
                        const inner = str.slice(1, -1).trim();
                        if (!inner) return [0];
                        const items: string[] = [];
                        let depth = 0;
                        let start = 0;
                        for (let i = 0; i < inner.length; i++) {
                          if (inner[i] === "{" || inner[i] === "[") depth++;
                          else if (inner[i] === "}" || inner[i] === "]") depth--;
                          else if (inner[i] === "," && depth === 0) {
                            items.push(inner.slice(start, i).trim());
                            start = i + 1;
                          }
                        }
                        items.push(inner.slice(start).trim());
                        const sub = items.length > 0 && items[0]!.startsWith("{") ? parseNested(items[0]!) : [];
                        return [items.length, ...sub];
                      };
                      tDims = parseNested(bExp);
                    }
                  }
                  if (tDims && tDims.length >= subs.length) {
                    const remainingDims: number[] = [];
                    for (let sIdx = 0; sIdx < subs.length; sIdx++) {
                      if (subs[sIdx]!.includes(":")) {
                        let sliceDim = tDims[sIdx]!;
                        const parts = subs[sIdx]!.split(":");
                        if (parts.length === 2) {
                          const startVal = parseInt(parts[0]!.trim(), 10);
                          const endVal = parseInt(parts[1]!.trim(), 10);
                          if (!isNaN(startVal) && !isNaN(endVal)) {
                            sliceDim = endVal - startVal + 1;
                          }
                        }
                        remainingDims.push(sliceDim);
                      }
                    }
                    for (let sIdx = subs.length; sIdx < tDims.length; sIdx++) {
                      remainingDims.push(tDims[sIdx]!);
                    }
                    actualShape = remainingDims;
                  }
                }
              } else if (/^[a-zA-Z_]\w*$/.test(valText)) {
                const syms = flattener.db.byName(valText);
                const targetSym =
                  syms.find(
                    (s: any) => s.parentId === flattener.currentRootClassId || s.parentId === compInst.parentId,
                  ) ?? syms[0];
                if (targetSym) {
                  const targetInst = flattener.db.query<any>("componentInstance", targetSym.id);
                  let tDims = targetInst?.arrayDimensions;
                  if (!tDims || tDims.some((d: number) => d <= 0)) {
                    const bExp = targetInst?.modification?.bindingExpression?.text?.trim();
                    if (bExp && bExp.startsWith("{")) {
                      const parseNested = (str: string): number[] => {
                        str = str.trim();
                        if (!str.startsWith("{") || !str.endsWith("}")) return [];
                        const inner = str.slice(1, -1).trim();
                        if (!inner) return [0];
                        const items: string[] = [];
                        let depth = 0;
                        let start = 0;
                        for (let i = 0; i < inner.length; i++) {
                          if (inner[i] === "{" || inner[i] === "[") depth++;
                          else if (inner[i] === "}" || inner[i] === "]") depth--;
                          else if (inner[i] === "," && depth === 0) {
                            items.push(inner.slice(start, i).trim());
                            start = i + 1;
                          }
                        }
                        items.push(inner.slice(start).trim());
                        const sub = items.length > 0 && items[0]!.startsWith("{") ? parseNested(items[0]!) : [];
                        return [items.length, ...sub];
                      };
                      tDims = parseNested(bExp);
                    }
                  }
                  if (tDims) {
                    actualShape = tDims;
                  }
                }
              }
            }
            if (
              actualShape &&
              (actualShape.length !== compDims.length || actualShape.some((d, idx) => d !== compDims[idx]))
            ) {
              let clauseNode: any = elemCst;
              while (clauseNode && clauseNode.type !== "component_clause" && clauseNode.parent) {
                clauseNode = clauseNode.parent;
              }
              const diagNode = clauseNode ?? elemCst;
              const notifRange = {
                startByte: arg.modRange?.[0] ?? arg.modPosition?.startPosition,
                endByte: arg.modRange?.[1] ?? arg.modPosition?.endPosition,
                startPosition: arg.modPosition?.startPosition,
                endPosition: arg.modPosition?.endPosition,
              };
              const errorRange = {
                startByte: diagNode?.startIndex ?? diagNode?.startByte,
                endByte: diagNode?.endIndex ?? diagNode?.endByte,
                startPosition: diagNode?.startPosition,
                endPosition: diagNode?.endPosition,
              };
              dae.diagnostics.push({
                severity: "notification",
                code: ModelicaErrorCode.NOTIFICATION_FROM_HERE.code,
                message: "From here:",
                range: notifRange,
              });
              const isOldFrontend = Boolean(
                dae.extensionMetadata?.["isOldFrontend"] || flattener.options.isOldFrontend,
              );
              let errorMessage: string;
              let errorCode: number = ModelicaErrorCode.BINDING_DIMENSION_MISMATCH.code;
              if (isOldFrontend && valText.startsWith("{") && valText.endsWith("}")) {
                const outerElems = parseArrayLiteralElements(valText);
                if (compDims.length >= 2) {
                  let mismatchRow: { rowText: string; innerElems: string[] } | null = null;
                  for (const rowText of outerElems) {
                    if (rowText.startsWith("{") && rowText.endsWith("}")) {
                      const innerElems = parseArrayLiteralElements(rowText);
                      if (innerElems.length !== compDims[1]) {
                        mismatchRow = { rowText, innerElems };
                      }
                    }
                  }
                  if (mismatchRow) {
                    const elemType = mismatchRow.innerElems.every((e: string) => /^[+-]?\d+$/.test(e.trim()))
                      ? "Integer"
                      : "Real";
                    errorCode = ModelicaErrorCode.ARRAY_DIMENSION_MISMATCH.code;
                    errorMessage = `Array dimension mismatch, expression ${mismatchRow.rowText} has type ${elemType}[${mismatchRow.innerElems.length}], expected array dimensions [${compDims[1]}].`;
                  } else {
                    errorMessage = ModelicaErrorCode.BINDING_DIMENSION_MISMATCH.message(
                      arg.name,
                      formattedText,
                      compDims.join(", "),
                      actualShape.join(", "),
                    );
                  }
                } else if (compDims.length === 1 && outerElems.length !== compDims[0]) {
                  const elemType = outerElems.every((e: string) => /^[+-]?\d+$/.test(e.trim())) ? "Integer" : "Real";
                  errorCode = ModelicaErrorCode.ARRAY_DIMENSION_MISMATCH.code;
                  errorMessage = `Array dimension mismatch, expression ${valText} has type ${elemType}[${outerElems.length}], expected array dimensions [${compDims[0]}].`;
                } else {
                  errorMessage = ModelicaErrorCode.BINDING_DIMENSION_MISMATCH.message(
                    arg.name,
                    formattedText,
                    compDims.join(", "),
                    actualShape.join(", "),
                  );
                }
              } else {
                errorMessage = ModelicaErrorCode.BINDING_DIMENSION_MISMATCH.message(
                  arg.name,
                  formattedText,
                  compDims.join(", "),
                  actualShape.join(", "),
                );
              }
              dae.diagnostics.push({
                severity: "error",
                code: errorCode,
                message: errorMessage,
                range: errorRange,
              });
              return true;
            }
          }
        }
      }
    }
  }
  return false;
}

/**
 * Evaluates a CST node or expression text to a compile-time numeric value in `scopeId`.
 *
 * Delegates directly to {@link evaluateCSTNumber} using `flattener.db` and optional loop
 * variable substitutions (`subs`) and `DAEBuilder` bindings (`dae`).
 *
 * @param flattener - Active component flattener context.
 * @param node - CST node or raw expression string to evaluate.
 * @param scopeId - Enclosing class or package symbol ID for lexical name resolution.
 * @param subs - Optional map of active loop iterator variable bindings.
 * @param dae - Optional `DAEBuilder` for resolving already-flattened parameter/constant bindings.
 * @returns Evaluated finite number, or `null` if non-numeric or unresolvable.
 */
export function evaluateCSTToNumber(
  flattener: ComponentFlattener,
  node: SyntaxNode | string | null | undefined,
  scopeId: SymbolId,
  subs?: Map<string, number>,
  dae?: DAEBuilder,
): number | null {
  return evaluateCSTNumber(node, subs, scopeId, flattener.db, dae);
}

/**
 * Recursively collects the set of `protected` component names declared directly in `classId`
 * or inherited through `extends` clauses (marking all elements of a `protected extends Base`
 * clause as protected).
 *
 * @param flattener - Active component flattener context.
 * @param classId - Target class symbol ID to inspect.
 * @param visited - Cycle-detection set of visited class IDs.
 * @returns Set of protected component names within `classId`.
 */
export function collectProtectedNames(
  flattener: ComponentFlattener,
  classId: SymbolId,
  visited: Set<SymbolId> = new Set<SymbolId>(),
): Set<string> {
  const protectedNames = new Set<string>();
  if (visited.has(classId)) return protectedNames;
  visited.add(classId);

  for (const ch of flattener.db.childrenOf(classId)) {
    if (ch.kind === "Component") {
      if (flattener["isCstNodeProtected"](flattener.db.cstNode(ch.id))) {
        protectedNames.add(ch.name);
      }
    } else if (ch.kind === "Extends") {
      const isExtProt = flattener["isCstNodeProtected"](flattener.db.cstNode(ch.id));
      const baseSym = resolveExtendsBase(flattener, ch, classId);
      if (baseSym) {
        if (isExtProt) {
          const baseElems = flattener.db.query<SymbolId[]>("instantiate", baseSym.id) || [];
          for (const beid of baseElems) {
            const bentry = flattener.db.symbol(beid);
            if (bentry?.name) protectedNames.add(bentry.name);
          }
        } else {
          const baseProtected = collectProtectedNames(flattener, baseSym.id, visited);
          for (const pn of baseProtected) protectedNames.add(pn);
        }
      }
    }
  }
  return protectedNames;
}

/**
 * Recursively collects class-level modifications from short class definitions (`model M = Base(...)`)
 * and `extends Base(...)` clauses across the inheritance hierarchy of `classId`.
 *
 * Tags each collected modifier with `isExtendsMod: true` and `extendsTargetClassId` so
 * downstream redeclaration and override checks can distinguish inherited base modifications
 * from direct component modifications.
 *
 * @param flattener - Active component flattener context.
 * @param classId - Target class symbol ID to inspect.
 * @param visited - Cycle-detection set of visited class IDs.
 * @returns Ordered list of inherited `extends` modification descriptors.
 */
export function collectExtendsMods(
  flattener: ComponentFlattener,
  classId: SymbolId,
  visited: Set<SymbolId> = new Set<SymbolId>(),
): any[] {
  if (visited.has(classId)) return [];
  visited.add(classId);
  const result: any[] = [];

  const selfCstShort = flattener.db.cstNode(classId) as any;
  const specShort = getShortClassSpecifierNode(selfCstShort);
  if (specShort) {
    const selfSym = flattener.db.symbol(classId);
    let lookupScopeId = selfSym?.parentId ?? classId;
    if (lookupScopeId !== null && flattener.db.symbol(lookupScopeId)?.kind === "Extends") {
      lookupScopeId = flattener.db.symbol(lookupScopeId)?.parentId ?? lookupScopeId;
    }
    const typeSpec =
      Cst.ShortClassSpecifier.typeSpecifier(specShort) ??
      specShort.children?.find((c: any) => c.type === "type_specifier");
    const typeName = typeSpec?.text?.trim();
    let targetClass: any = null;
    if (typeName) {
      const resolved =
        (typeName.includes(".")
          ? flattener.db.query<(n: string) => SymbolEntry | null>("resolveName", lookupScopeId)?.(typeName)
          : flattener.db.query<(n: string) => SymbolEntry | null>("resolveSimpleName", lookupScopeId)?.(typeName)) ??
        flattener.db.byName(typeName)?.find((m) => m.kind === "Class") ??
        null;
      if (resolved && resolved.kind === "Class") {
        targetClass = resolved;
        result.push(...collectExtendsMods(flattener, targetClass.id, visited));
      }
    }
    const isShortInClassMod = (node: any): boolean => {
      let cur = node?.parent;
      while (cur && cur.type !== "class_definition" && cur.type !== "ClassDefinition") {
        if (
          cur.type === "element_redeclaration" ||
          cur.type === "ElementRedeclaration" ||
          cur.type === "class_modification" ||
          cur.type === "ClassModification"
        ) {
          return true;
        }
        cur = cur.parent;
      }
      return false;
    };
    const parentSym = lookupScopeId != null ? flattener.db.symbol(lookupScopeId) : null;
    if (
      lookupScopeId != null &&
      selfSym &&
      (parentSym?.kind === "Class" || parentSym?.kind === "Package") &&
      isShortInClassMod(selfCstShort)
    ) {
      const findOrigClassInAncestors = (clsId: SymbolId, seenAnc = new Set<SymbolId>()): SymbolEntry | null => {
        if (seenAnc.has(clsId)) return null;
        seenAnc.add(clsId);
        const directChild = flattener.db
          .childrenOf(clsId)
          .find((c) => c.kind === "Class" && c.name === selfSym.name && !isShortInClassMod(flattener.db.cstNode(c.id)));
        if (directChild) return directChild;
        const pBase = flattener.db.query<SymbolEntry | null>("resolvedBaseClass", clsId);
        if (pBase && pBase.id !== clsId) {
          const found = findOrigClassInAncestors(pBase.id, seenAnc);
          if (found) return found;
        }
        for (const ch of flattener.db.childrenOf(clsId)) {
          if (ch.kind === "Extends") {
            const bSym = resolveExtendsBase(flattener, ch, clsId);
            if (bSym && bSym.id !== clsId) {
              const found = findOrigClassInAncestors(bSym.id, seenAnc);
              if (found) return found;
            }
          }
        }
        return null;
      };
      const origClassSym = findOrigClassInAncestors(lookupScopeId);
      if (origClassSym) {
        const origMod = flattener.db.query<any>("effectiveModification", origClassSym.id);
        const pkgMod = flattener.db.query<any>("effectiveModification", lookupScopeId);
        if (origMod?.args) {
          for (const arg of origMod.args) {
            let mappedVal = arg.value;
            const valText = arg.value?.text?.trim();
            if (valText && pkgMod?.args) {
              const pkgOverride = pkgMod.args.find((pa: any) => !pa.isBreak && pa.name === valText && pa.value);
              if (pkgOverride) {
                mappedVal = pkgOverride.value;
              }
            }
            result.push({
              ...arg,
              value: mappedVal,
              isExtendsMod: true,
              extendsTargetClassId: targetClass?.id ?? classId,
              ownerClassId: lookupScopeId,
            });
          }
        }
      }
    }
    const shortMod = flattener.db.query<any>("effectiveModification", classId);
    if (shortMod?.args) {
      result.push(
        ...shortMod.args.map((a: any) => ({
          ...a,
          isExtendsMod: true,
          extendsTargetClassId: targetClass?.id ?? classId,
          ownerClassId: classId,
        })),
      );
    }
  }

  const seenInheritedNames = new Set<string>();
  for (const child of flattener.db.childrenOf(classId)) {
    if (child.kind === "Extends") {
      const target = resolveExtendsBase(flattener, child, classId);
      const extMod = flattener.db.query<any>("extendsModificationParsed", child.id);
      const redeclaredInExtMod = new Set<string>(
        (extMod?.args || [])
          .filter((a: any) => (a.isRedeclaration || a.redeclaredTypeSpecifier) && a.name)
          .map((a: any) => a.name),
      );
      if (target && target.kind === "Class") {
        const inheritedMods = collectExtendsMods(flattener, target.id, visited);
        for (const mod of inheritedMods) {
          if (mod.name && redeclaredInExtMod.has(mod.name) && (mod.isRedeclaration || mod.redeclaredTypeSpecifier)) {
            continue;
          }
          if (!mod.name || !seenInheritedNames.has(mod.name)) {
            result.push({ ...mod, isExtendsMod: true });
          }
        }
        for (const mod of inheritedMods) {
          if (mod.name) seenInheritedNames.add(mod.name);
        }
      }
      if (extMod?.args) {
        for (const arg of extMod.args) {
          if (arg.name) seenInheritedNames.add(arg.name);
          result.push({
            ...arg,
            isExtendsMod: true,
            extendsTargetClassId: target?.id,
            ownerClassId: arg.ownerClassId ?? classId,
          });
        }
      }
    }
  }
  return result;
}

/**
 * Resolves the replacement type specifier (`redeclSpecifier`) of a `redeclare` clause
 * to its target class or `type` alias `SymbolId`.
 *
 * Searches `scopeId` first, then `flattener.currentRootClassId`, and finally falls back
 * to global `byName` lookup.
 *
 * @param flattener - Active component flattener context.
 * @param scopeId - Lexical scope ID where the `redeclare` modifier was written.
 * @param redeclSpecifier - Simple or dot-qualified type name in the `redeclare` clause.
 * @returns Resolved class `SymbolId`, or `null` if not found.
 */
export function resolveRedeclarationType(
  flattener: ComponentFlattener,
  scopeId: SymbolId | null,
  redeclSpecifier: string,
): SymbolId | null {
  if (!redeclSpecifier) return null;
  const isDotted = redeclSpecifier.includes(".");

  if (scopeId !== null) {
    const resolver = isDotted
      ? flattener.db.query<(n: string) => SymbolEntry | null>("resolveName", scopeId)
      : flattener.db.query<(n: string) => SymbolEntry | null>("resolveSimpleName", scopeId);
    const resolved = resolver?.(redeclSpecifier);
    if (resolved && (resolved.kind === "Class" || (resolved.metadata as any)?.classKind === "type")) {
      return resolved.id;
    }
  }

  if (flattener.currentRootClassId && flattener.currentRootClassId !== scopeId) {
    const rootResolver = isDotted
      ? flattener.db.query<(n: string) => SymbolEntry | null>("resolveName", flattener.currentRootClassId)
      : flattener.db.query<(n: string) => SymbolEntry | null>("resolveSimpleName", flattener.currentRootClassId);
    const resolved = rootResolver?.(redeclSpecifier);
    if (resolved && (resolved.kind === "Class" || (resolved.metadata as any)?.classKind === "type")) {
      return resolved.id;
    }
  }

  const simple = isDotted ? redeclSpecifier.split(".").pop()! : redeclSpecifier;
  const targets = flattener.db.byName(simple);
  const found = targets.find((t) => t.kind === "Class" || (t.metadata as any)?.classKind === "type");
  return found ? found.id : null;
}

/**
 * Resolves an `outer` class reference (`classId`) to its corresponding `inner` class
 * definition in the enclosing root model (`flattener.currentRootClassId`).
 *
 * If `classId` does not carry the `outer` prefix or no matching `inner` class exists in
 * the root model, returns `classId` unchanged.
 *
 * @param flattener - Active component flattener context.
 * @param classId - Candidate class `SymbolId` to check for `outer` redirection.
 * @returns The matching `inner` class `SymbolId`, or `classId` if not redirected.
 */
export function resolveInnerOuterClass(flattener: ComponentFlattener, classId: SymbolId): SymbolId {
  const sym = flattener.db.symbol(classId);
  if (!sym) return classId;

  const hasPrefix = (s: SymbolEntry, prefix: "inner" | "outer"): boolean => {
    const meta = s.metadata as any;
    const rawPrefixes = meta?.classPrefixes ?? meta?.prefixes;
    if (typeof rawPrefixes === "string" && new RegExp(`\\b${prefix}\\b`).test(rawPrefixes)) {
      return true;
    }
    if (s.startByte != null && typeof (flattener.db as any).cstText === "function") {
      const lookbackStart = Math.max(0, s.startByte - 60);
      const end = Math.min(s.startByte + 60, s.endByte ?? s.startByte + 60);
      const text = (flattener.db as any).cstText(lookbackStart, end, s);
      if (typeof text === "string") {
        const pattern = new RegExp(
          `\\b${prefix}\\s+(?:(?:partial|encapsulated|final|replaceable)\\s+)*(?:class|model|block|record|connector|type|function|package)\\s+${s.name}\\b`,
        );
        if (pattern.test(text)) {
          return true;
        }
      }
    }
    const cst = flattener.db.cstNode(s.id) as any;
    const prefixesNode = (cst?.children || []).find((c: any) => c.type === "class_prefixes" || c.type === "prefixes");
    if (prefixesNode) {
      return Boolean((prefixesNode.text ?? "").includes(prefix));
    }
    for (const c of cst?.children || []) {
      const ct = c.text?.trim();
      if (ct === prefix) return true;
      if (
        c.type === "class" ||
        c.type === "model" ||
        c.type === "block" ||
        c.type === "record" ||
        c.type === "package"
      ) {
        break;
      }
    }
    return false;
  };

  if (!hasPrefix(sym, "outer")) return classId;

  const targetName = sym.name;

  if (flattener.currentRootClassId) {
    const rootChildren = flattener.db.childrenOf(flattener.currentRootClassId);
    for (const child of rootChildren) {
      if (child.kind === "Class" && child.name === targetName) {
        if (hasPrefix(child, "inner")) {
          return child.id;
        }
      }
    }
  }
  return classId;
}

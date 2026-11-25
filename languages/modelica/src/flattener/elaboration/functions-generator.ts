// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  Causality,
  DAEBuilder,
  ExprKind,
  foldArenaConstants,
  type QueryDB,
  type SymbolEntry,
  type SymbolId,
  Variability,
  VarType,
  varTypeName,
} from "@modelscript/runtime";
import { Cst, type SyntaxNode } from "../../../src-gen/bindings.js";
import { BUILTIN_FUNCTIONS } from "../../builtins.js";
import { ModelicaErrorCode } from "../../errors.js";
import { getShortClassSpecifierNode, isScopeEncapsulated } from "../../queries.js";
import type { ModelicaFlattener } from "../class-flattener.js";
import {
  type CstNodeLike,
  extractFunctionCallArgExprNodesCst,
  isAsciiDigitsOnly,
  isAsciiIdentifier,
  isDottedIdentifierChain,
  parseStandaloneExpressionCst,
  stripArraySubscripts,
  stripAsciiWhitespace,
  stripLeadingDot,
  stripLeadingDots,
  stripOuterDoubleQuotes,
  tokenizeCommentStrippedWords,
} from "../expressions/cst-utils.js";
import { SCALAR_VECTORIZABLE_FUNCTIONS } from "../expressions/functions.js";
import {
  castToRealExpr,
  evalArithmeticString,
  evalDaeExpr,
  getSymbolEnumLiterals,
  getSymbolQualifiedName,
  isRealExpr,
  lookupDbConstant,
} from "../expressions/index.js";
import { getClassDiagRange } from "../support/range-utils.js";
import type { FlatteningState } from "../support/state.js";
import type { ComponentInstanceData, ComponentModArgData, FlattenerCstNode, ParentModsLike } from "../types.js";
import { collectExtendsMods } from "./component-inst.js";

type DaeDiagnosticWithOrigin = DAEBuilder["diagnostics"][number] & { fromFunction?: boolean };

interface FlattenedFunctionDae extends DAEBuilder {
  parentDae?: FlattenedFunctionDae | undefined;
  db?: QueryDB | undefined;
  symId?: SymbolId | undefined;
  flattener?: ModelicaFlattener | undefined;
  enclosingScopeId?: SymbolId | null | undefined;
  componentPrefix?: string | undefined;
  specializedPrefix?: string | undefined;
  componentParentMods?: ParentModsLike | undefined;
  isBeingFlattened?: boolean | undefined;
  fnRange?: ReturnType<typeof getClassDiagRange> | undefined;
  isShortFunc?: boolean | undefined;
  shortBaseFuncName?: string | undefined;
  isOperatorRecord?: boolean | undefined;
  wasCalled?: boolean | undefined;
  isDerivativeFunction?: boolean | undefined;
  isNestedMember?: boolean | undefined;
  isExplicitImpure?: boolean | undefined;
  isEarlyInline?: boolean | undefined;
  aliasTo?: string | undefined;
  externalInclude?: string | undefined;
  builtinFunctions?: Map<string, DAEBuilder> | undefined;
  rootClassId?: SymbolId | undefined;
  _recordConstVarIndices?: Set<number> | undefined;
}

type FlattenerWithFnRuntime = ModelicaFlattener & {
  _recordCtorCache?: Map<string, DAEBuilder>;
  _flattenedFunctionCache?: Map<string, DAEBuilder>;
  currentFunctionComponentPrefix?: string;
  currentFunctionSpecializedPrefix?: string;
  instantiatedRecordComponents?: Map<string, Set<string>>;
  state?: FlatteningState & { rootClassId?: SymbolId };
};

type SymbolWithFnCache = SymbolEntry & { _isFunction?: boolean };

interface SymbolMetaLike {
  classKind?: string;
  classPrefixes?: string;
  typeSpecifier?: string;
  variability?: string;
  isConstant?: boolean;
  varType?: VarType;
}

interface ModArgLike extends ComponentModArgData {
  isRedeclaration?: boolean;
}

interface EffectiveModLike {
  args?: ModArgLike[];
}

interface ArrayDimLike {
  kind?: string;
  value?: number;
  text?: string;
  cstBytes?: readonly [number, number];
}

type NameResolverFn = (name: string) => SymbolEntry | null | undefined;

interface OperatorConstructorEntry {
  qualifiedName: string;
  funcSymId: SymbolId;
}

type DaeWithParent = FlattenedFunctionDae;

const C_MATH_EXTERNAL_FUNCS = new Set([
  "sin",
  "cos",
  "tan",
  "asin",
  "acos",
  "atan",
  "atan2",
  "sinh",
  "cosh",
  "tanh",
  "exp",
  "log",
  "log10",
  "sqrt",
  "ceil",
  "floor",
  "fabs",
  "pow",
  "fmod",
]);

const MATH_FUNC_ALIAS_SET = new Set([
  "sin",
  "cos",
  "tan",
  "asin",
  "acos",
  "atan",
  "atan2",
  "sinh",
  "cosh",
  "tanh",
  "exp",
  "log",
  "log10",
  "sqrt",
]);

function formatCommaSpacing(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    out += ch;
    if (ch === "," && i + 1 < text.length) {
      const next = text[i + 1]!;
      if (next !== " " && next !== "\t" && next !== "\n" && next !== "\r") {
        out += " ";
      }
    }
  }
  return out;
}

function hasComponentPrefixWordCst(compCst: CstNodeLike | null | undefined, targetWord: string): boolean {
  if (!compCst) return false;
  let clause: CstNodeLike | null | undefined = compCst;
  while (clause && clause.type !== "component_clause" && clause.type !== "class_definition") {
    clause = clause.parent;
  }
  const target = clause?.type === "component_clause" ? clause : compCst;
  const tp = (target.children || []).find((c) => c.type === "type_prefix");
  if (tp) {
    return tokenizeCommentStrippedWords(tp.text ?? "").includes(targetWord);
  }
  const tokens: string[] = [];
  for (const ch of target.children || []) {
    if (ch.type === "type_specifier" || ch.type === "component_list" || ch.type === "declaration") break;
    tokens.push(...tokenizeCommentStrippedWords(ch.text ?? ""));
  }
  return tokens.includes(targetWord);
}

function hasPureFunctionPrefixCst(cst: CstNodeLike | null | undefined): boolean {
  if (!cst) return false;
  const pfx = (cst.children || []).find((c) => c.type === "class_prefixes");
  if (!pfx) return false;
  const words = tokenizeCommentStrippedWords(pfx.text ?? "");
  for (let i = 0; i + 1 < words.length; i++) {
    if (words[i] === "pure" && words[i + 1] === "function") return true;
  }
  return false;
}

function cstHasOwnAlgorithmSection(cst: CstNodeLike | null | undefined): boolean {
  if (!cst) return false;
  const stack: CstNodeLike[] = [cst];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    if (node.type === "algorithm_section") return true;
    if (node !== cst && (node.type === "class_definition" || node.type === "short_class_definition")) {
      continue;
    }
    const children = node.children || [];
    for (let i = children.length - 1; i >= 0; i--) {
      if (children[i]) stack.push(children[i]!);
    }
  }
  return false;
}

function findDirectElementModificationsCst(root: CstNodeLike | null | undefined, targetName: string): CstNodeLike[] {
  const matches: CstNodeLike[] = [];
  if (!root) return matches;
  const stack: CstNodeLike[] = [root];
  while (stack.length > 0) {
    const cur = stack.pop();
    if (!cur) continue;
    if (cur !== root && (cur.type === "class_definition" || cur.type === "short_class_definition")) {
      continue;
    }
    if (cur.type === "element_modification") {
      const nameNode =
        cur.childForFieldName?.("name") ??
        (cur.children || []).find((c) => c.type === "name" || c.type === "identifier");
      if (nameNode?.text?.trim() === targetName) {
        matches.push(cur);
      }
      continue;
    }
    const children = cur.children || [];
    for (let i = children.length - 1; i >= 0; i--) {
      if (children[i]) stack.push(children[i]!);
    }
  }
  return matches;
}

function extractModRhsNode(elemMod: CstNodeLike | null | undefined): CstNodeLike | null {
  if (!elemMod) return null;
  const modNode =
    elemMod.childForFieldName?.("modification") ?? (elemMod.children || []).find((c) => c.type === "modification");
  if (!modNode) return null;
  const ch: CstNodeLike[] = modNode.children || [];
  const eqIdx = ch.findIndex((c) => c.type === "=" || c.text?.trim() === "=");
  if (eqIdx < 0) return null;
  for (let i = eqIdx + 1; i < ch.length; i++) {
    if (ch[i]?.text?.trim()) return ch[i] ?? null;
  }
  return null;
}

function hasAnnotationBoolModificationCst(
  classCst: CstNodeLike | null | undefined,
  attrName: string,
  expected: boolean,
): boolean {
  if (!classCst) return false;
  const expectedText = expected ? "true" : "false";
  for (const ch of findDirectAnnotationClauses(classCst)) {
    for (const em of findDirectElementModificationsCst(ch, attrName)) {
      const rhs = extractModRhsNode(em);
      if (rhs?.text?.trim() === expectedText) return true;
    }
  }
  return false;
}

function findDirectAnnotationClauses(root: CstNodeLike | null | undefined): CstNodeLike[] {
  const result: CstNodeLike[] = [];
  if (!root) return result;
  const stack: CstNodeLike[] = [root];
  while (stack.length > 0) {
    const cur = stack.pop();
    if (!cur) continue;
    if (cur !== root && (cur.type === "class_definition" || cur.type === "short_class_definition")) {
      continue;
    }
    if (cur.type === "annotation_clause") {
      result.push(cur);
      continue;
    }
    const children = cur.children || [];
    for (let i = children.length - 1; i >= 0; i--) {
      if (children[i]) stack.push(children[i]!);
    }
  }
  return result;
}

function findAnnotationStringModificationCst(root: CstNodeLike | null | undefined, attrName: string): string | null {
  for (const ann of findDirectAnnotationClauses(root)) {
    for (const em of findDirectElementModificationsCst(ann, attrName)) {
      const rhs = extractModRhsNode(em);
      if (!rhs) continue;
      let strNode: CstNodeLike = rhs;
      const walk: CstNodeLike[] = [rhs];
      while (walk.length > 0) {
        const cur = walk.pop();
        if (!cur) continue;
        if (cur.type === "string_literal" || cur.type === "STRING") {
          strNode = cur;
          break;
        }
        const children = cur.children || [];
        for (let i = children.length - 1; i >= 0; i--) {
          if (children[i]) walk.push(children[i]!);
        }
      }
      const raw = strNode?.text?.trim() ?? "";
      if (raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2) {
        return raw.slice(1, -1);
      }
    }
  }
  return null;
}

function findFunctionAnnotationTargetCst(fnCst: CstNodeLike | null | undefined, attrName: string): string | null {
  for (const ann of findDirectAnnotationClauses(fnCst)) {
    for (const em of findDirectElementModificationsCst(ann, attrName)) {
      const rhs = extractModRhsNode(em);
      const raw = rhs?.text?.trim() ?? "";
      if (raw && isDottedIdentifierChain(raw)) {
        return raw;
      }
    }
  }
  return null;
}

function getExternalCallCalleeNode(extCallNode: CstNodeLike | null | undefined): CstNodeLike | null {
  if (!extCallNode?.children) return null;
  const ch: CstNodeLike[] = extCallNode.children;
  const eqIdx = ch.findIndex((c) => c.text?.trim() === "=");
  const searchSlice = eqIdx >= 0 ? ch.slice(eqIdx + 1) : ch;
  return searchSlice.find((c) => c.type === "identifier" || c.type === "component_reference") ?? null;
}

function isCallCstNode(node: CstNodeLike | null | undefined): boolean {
  if (!node) return false;
  if (node.type === "function_call") return true;
  if (node.type === "primary") {
    return (node.children || []).some((c) => c.type === "function_call_args");
  }
  return false;
}

function extractNamedTwoArgCallCst(
  node: CstNodeLike | null | undefined,
  targetFnName: string,
): [SyntaxNode, SyntaxNode] | null {
  if (!node) return null;
  let cur: CstNodeLike | null | undefined = node;
  for (let depth = 0; depth < 12 && cur; depth++) {
    if (isCallCstNode(cur)) break;
    const ch: CstNodeLike[] = cur.children || [];
    if (ch.length === 1) {
      cur = ch[0];
    } else {
      const fc = ch.find((c) => isCallCstNode(c));
      if (fc && ch.length <= 2) {
        cur = fc;
      } else {
        break;
      }
    }
  }
  if (!isCallCstNode(cur)) return null;
  const ch: CstNodeLike[] = cur!.children || [];
  const calleeNode =
    cur!.childForFieldName?.("name") ??
    cur!.childForFieldName?.("callee") ??
    ch.find((c) => c.type === "component_reference" || c.type === "name" || c.type === "identifier");
  if (calleeNode?.text?.trim() !== targetFnName) return null;
  const args = extractFunctionCallArgExprNodesCst(cur as SyntaxNode);
  return args.length === 2 ? [args[0]!, args[1]!] : null;
}

export function isFunctionSym(db: QueryDB, sym: SymbolEntry | null | undefined): boolean {
  if (!sym) return false;
  const cachedSym = sym as SymbolWithFnCache;
  if (cachedSym._isFunction !== undefined) return cachedSym._isFunction;
  const meta = (sym.metadata ?? {}) as SymbolMetaLike;
  const rawKind = String(meta.classKind ?? meta.classPrefixes ?? "");
  const words = tokenizeCommentStrippedWords(rawKind);
  if (words.includes("function")) {
    cachedSym._isFunction = true;
    return true;
  }
  if (words.length > 0 && !words.includes("function")) {
    cachedSym._isFunction = false;
    return false;
  }
  const cst = db.cstNode(sym.id) as FlattenerCstNode | null;
  if (cst) {
    for (const child of cst.children || []) {
      if (child.type === "class_prefixes") {
        const childWords = tokenizeCommentStrippedWords(child.text ?? "");
        if (childWords.includes("function")) {
          cachedSym._isFunction = true;
          return true;
        }
      }
    }
    const headerWords = tokenizeCommentStrippedWords(cst.text ?? "");
    let idx = 0;
    while (
      idx < headerWords.length &&
      (headerWords[idx] === "encapsulated" ||
        headerWords[idx] === "partial" ||
        headerWords[idx] === "replaceable" ||
        headerWords[idx] === "pure" ||
        headerWords[idx] === "impure")
    ) {
      idx++;
    }
    if (headerWords[idx] === "function") {
      cachedSym._isFunction = true;
      return true;
    }
  }
  cachedSym._isFunction = false;
  return false;
}

export function generateRecordConstructorFor(
  flattener: ModelicaFlattener,
  sym: SymbolEntry | null | undefined,
  dae: DAEBuilder,
  rootClassId?: SymbolId,
  overrideFnName?: string,
  overrideResType?: string,
): DAEBuilder | null {
  if (!sym) return null;
  const rt = flattener as FlattenerWithFnRuntime;
  const daeFn = dae as FlattenedFunctionDae;
  const db: QueryDB = flattener.db;
  const qualName = getSymbolQualifiedName(db, sym.id);
  let effParentId = sym.parentId;
  while (effParentId !== null && db.symbol(effParentId)?.kind === "Extends") {
    effParentId = db.symbol(effParentId)?.parentId ?? null;
  }
  const isDirectInCurrentRoot = Boolean(
    flattener.currentRootClassId
      ? effParentId === flattener.currentRootClassId
      : rootClassId && effParentId === rootClassId,
  );
  const isRedeclaredInRoot = Boolean(
    rootClassId &&
    sym.parentId !== rootClassId &&
    qualName &&
    (collectExtendsMods(flattener, rootClassId) as ModArgLike[]).some(
      (a) =>
        a.isRedeclaration &&
        a.name === sym.name &&
        (a.redeclaredTypeSpecifier === qualName || a.redeclaredTypeSpecifier === `.${qualName}`),
    ),
  );
  const fnName =
    overrideFnName ??
    (rootClassId &&
    (sym.parentId === rootClassId || isDirectInCurrentRoot || isRedeclaredInRoot) &&
    dae.name &&
    dae.classKind !== "function"
      ? dae.name.includes(".") || !qualName.includes(".") || isDirectInCurrentRoot || isRedeclaredInRoot
        ? `${dae.name}.${sym.name}`
        : qualName
      : qualName || sym.name);
  const bySimpleName = dae.getFunction(sym.name);
  const existing =
    dae.getFunction(fnName) ??
    (!overrideFnName
      ? fnName === sym.name || (dae.name && bySimpleName?.name === `${dae.name}.${sym.name}`)
        ? (bySimpleName ?? (qualName ? dae.getFunction(qualName) : undefined))
        : qualName
          ? dae.getFunction(qualName)
          : undefined
      : undefined);
  if (existing) return existing;

  const resTypeName = overrideResType ?? sym.name;
  const ctorCacheKey = `${sym.id}:${fnName}:${resTypeName}`;
  const cachedCtor = rt._recordCtorCache?.get(ctorCacheKey);
  if (cachedCtor && cachedCtor.interner === dae.interner) {
    dae.addFunction(fnName, cachedCtor);
    if (resTypeName && resTypeName !== fnName && !overrideFnName?.includes("$") && !dae.getFunction(resTypeName)) {
      dae.addFunction(resTypeName, cachedCtor);
    }
    if (!overrideFnName && qualName && qualName !== fnName && qualName !== sym.name)
      dae.addFunction(qualName, cachedCtor);
    const isSpeculativeFnDae = dae.classKind === "function" && !daeFn.parentDae;
    const rootModelResourceId = db.symbol(flattener.currentRootClassId ?? rootClassId)?.resourceId;
    const isCrossFileFnLocalRecord =
      dae.classKind === "function" &&
      Boolean(rootModelResourceId && sym.resourceId && sym.resourceId !== rootModelResourceId) &&
      !flattener.usedRecordSymIds?.has(sym.id);
    if (!isSpeculativeFnDae && !isCrossFileFnLocalRecord) {
      let rootDae: FlattenedFunctionDae =
        (flattener.currentRootDae as FlattenedFunctionDae | null | undefined) ?? daeFn;
      while (rootDae.parentDae) rootDae = rootDae.parentDae;
      rootDae.addFunction(fnName, cachedCtor);
      if (
        resTypeName &&
        resTypeName !== fnName &&
        !overrideFnName?.includes("$") &&
        !rootDae.getFunction(resTypeName)
      ) {
        rootDae.addFunction(resTypeName, cachedCtor);
      }
      if (!overrideFnName && qualName && qualName !== fnName && qualName !== sym.name)
        rootDae.addFunction(qualName, cachedCtor);
    }
    return cachedCtor;
  }

  const fn = (
    dae.exports ? new DAEBuilder(dae.exports, fnName, "", dae.interner) : new DAEBuilder(dae.interner, fnName, "")
  ) as FlattenedFunctionDae;
  fn.classKind = "function";
  fn.description = `Automatically generated record constructor for ${fnName}`;
  if (flattener.isOperatorRecordSym(sym)) {
    fn.isOperatorRecord = true;
    fn.extensionMetadata.isOperatorRecord = true;
  }
  const instElements = db.query<SymbolId[]>("instantiate", sym.id);
  const comps: SymbolEntry[] = [];
  if (instElements && instElements.length > 0) {
    for (const eid of instElements) {
      const entry = db.symbol(eid);
      if (entry && entry.kind === "Component") comps.push(entry);
    }
  } else {
    for (const comp of db.childrenOf(sym.id)) {
      if (comp && comp.kind === "Component") comps.push(comp);
    }
  }
  const symMod = db.query<EffectiveModLike | null>("effectiveModification", sym.id);
  const extendsMods = collectExtendsMods(flattener, sym.id) as ModArgLike[];
  const redeclArgs = [
    ...extendsMods.filter((a) => a.isRedeclaration),
    ...(symMod?.args?.filter((a) => a.isRedeclaration) ?? []),
  ];
  const redeclaredCompNames = new Set(redeclArgs.map((a) => a.name));

  if (
    !flattener.isOperatorRecordSym(sym) &&
    comps.some((c) => {
      const ci = db.query<ComponentInstanceData>("componentInstance", c.id);
      return ci?.isReplaceable && !redeclaredCompNames.has(c.name);
    })
  ) {
    return null;
  }

  const recordConstValues = new Map<string, number>();
  for (const comp of comps) {
    if (comp && comp.kind === "Component") {
      const ci = db.query<ComponentInstanceData>("componentInstance", comp.id);
      const cm = (comp.metadata ?? {}) as SymbolMetaLike;
      const cc = db.cstNode(comp.id) as CstNodeLike | null;
      const isConst =
        ci?.variability === "constant" ||
        cm.variability === "constant" ||
        cm.isConstant === true ||
        hasComponentPrefixWordCst(cc, "constant");
      if (isConst) {
        const bt = ci?.modification?.bindingExpression?.text?.trim();
        if (bt) {
          const n = Number(bt);
          if (!isNaN(n)) recordConstValues.set(comp.name, n);
        }
      }
    }
  }

  // Order inputs before protected constants so record constructor inputs come first (e.g. RecordConstructors2)
  const orderedComps = [...comps].sort((a, b) => {
    const aInst = db.query<ComponentInstanceData>("componentInstance", a.id);
    const bInst = db.query<ComponentInstanceData>("componentInstance", b.id);
    const aCst = db.cstNode(a.id) as CstNodeLike | null;
    const bCst = db.cstNode(b.id) as CstNodeLike | null;
    const aProt =
      flattener.isCstNodeProtected(aCst) ||
      aInst?.variability === "constant" ||
      hasComponentPrefixWordCst(aCst, "constant");
    const bProt =
      flattener.isCstNodeProtected(bCst) ||
      bInst?.variability === "constant" ||
      hasComponentPrefixWordCst(bCst, "constant");
    if (aProt !== bProt) return aProt ? 1 : -1;
    return 0;
  });

  for (const comp of orderedComps) {
    if (comp && comp.kind === "Component") {
      const compInst = db.query<ComponentInstanceData>("componentInstance", comp.id);
      const cMeta = (comp.metadata ?? {}) as SymbolMetaLike;
      const redeclForComp = redeclArgs.find((a) => a.name === comp.name);
      let typeSpec = redeclForComp?.redeclaredTypeSpecifier ?? compInst?.typeSpecifier ?? cMeta.typeSpecifier;
      let compTargetId: SymbolId | null = compInst?.classInstance ?? null;
      if (!compTargetId && typeSpec) {
        const simple = typeSpec.split(".").pop()!;
        const targets = db.byName(simple);
        const found = targets.find(
          (t) => t.kind === "Class" || (t.metadata as SymbolMetaLike | undefined)?.classKind === "type",
        );
        if (found) compTargetId = found.id;
      }

      const compTypeMods: ModArgLike[] = [];
      let enumLits: string[] | null = null;
      if (compTargetId) {
        const targetSym = db.symbol(compTargetId);
        if (targetSym) {
          enumLits = getSymbolEnumLiterals(db, targetSym);
        }
      }
      if (compInst?.modification?.args) {
        for (const cArg of compInst.modification.args) {
          if (cArg?.name && ["min", "max", "unit", "displayUnit", "quantity", "nominal", "start"].includes(cArg.name)) {
            compTypeMods.push(cArg);
          }
        }
      }
      if (compTargetId && flattener.isClassType(compTargetId) && !enumLits) {
        let currTypeId: SymbolId | null = compTargetId;
        while (currTypeId) {
          const mod = db.query<EffectiveModLike | null>("effectiveModification", currTypeId);
          if (mod?.args) compTypeMods.push(...mod.args);
          let base: SymbolEntry | null | undefined = db.query<SymbolEntry | null>("resolvedBaseClass", currTypeId);
          const extChild: SymbolEntry | undefined = db.childrenOf(currTypeId).find((c) => c.kind === "Extends");
          if (extChild && !base) {
            base = db.query<SymbolEntry | null>("resolvedBaseClass", extChild.id) ?? db.byName(extChild.name)[0];
          }
          if (!base || base.id === currTypeId) break;
          typeSpec = base.name;
          currTypeId = flattener.isClassType(base.id) ? base.id : null;
        }
      }

      let vType = VarType.Real;
      if (enumLits && enumLits.length > 0) vType = VarType.Enumeration;
      else if (typeSpec === "Integer" || cMeta.varType === VarType.Integer) vType = VarType.Integer;
      else if (typeSpec === "Boolean" || cMeta.varType === VarType.Boolean) vType = VarType.Boolean;
      else if (typeSpec === "String" || cMeta.varType === VarType.String) vType = VarType.String;
      else if (typeSpec === "Clock" || cMeta.varType === VarType.Clock) vType = VarType.Clock;

      const compCst = db.cstNode(comp.id) as CstNodeLike | null;
      const isInput = hasComponentPrefixWordCst(compCst, "input");
      const isOutput = hasComponentPrefixWordCst(compCst, "output");
      const isConstant =
        compInst?.variability === "constant" ||
        cMeta.variability === "constant" ||
        cMeta.isConstant === true ||
        hasComponentPrefixWordCst(compCst, "constant");
      const isCompProt = (flattener.isCstNodeProtected(compCst) || isConstant) && !isInput && !isOutput;
      const causality = isOutput ? Causality.Output : isCompProt ? Causality.Local : Causality.Input;
      const variability = Variability.Continuous;
      const varIdx = fn.addVariable(comp.name, vType, variability, causality);
      if (isConstant) {
        (fn._recordConstVarIndices ??= new Set<number>()).add(varIdx);
      }
      if (isCompProt) {
        fn.setVarProtected(varIdx, true);
      }
      if (enumLits && enumLits.length > 0) {
        fn.setVarEnumerationLiterals(
          varIdx,
          enumLits.map((s: string) => ({ stringValue: s })),
        );
      } else if (typeSpec && !["Real", "Integer", "Boolean", "String"].includes(typeSpec)) {
        let customTypeStr = typeSpec;
        if (!customTypeStr.includes(".") && compTargetId && sym.parentId && sym.parentId !== rootClassId) {
          const compTargetSym = db.symbol(compTargetId);
          if (compTargetSym && flattener.isRecordSym(compTargetSym) && compTargetSym.parentId !== rootClassId) {
            const qCompType = getSymbolQualifiedName(db, compTargetId);
            if (qCompType) customTypeStr = qCompType;
          }
        }
        fn.setVarCustomType(varIdx, customTypeStr);
      }
      const rawDims = db.query<ArrayDimLike[] | null>("arrayDimensions", comp.id);
      const evaluatedDims: number[] = [];
      if (compInst?.arrayDimensions && compInst.arrayDimensions.length > 0) {
        const effectiveShape = compInst.arrayDimensions.map((dimVal, dIdx) =>
          rawDims?.[dIdx]?.kind !== "literal" ? -1 : dimVal,
        );
        fn.setVarShape(varIdx, effectiveShape);
      }
      if (rawDims && rawDims.length > 0) {
        const shapeExprIds: number[] = [];
        for (const d of rawDims) {
          if (d.kind === "expression") {
            let exprId = -1;
            let evalDim: number | null = null;
            if (d.cstBytes) {
              const cstNode = db.cstNodeRange(d.cstBytes[0], d.cstBytes[1], comp) as SyntaxNode | null;
              if (cstNode) {
                const loweredDimId = flattener.lowerExpr(cstNode, fn, "");
                if (loweredDimId >= 0) {
                  const ev = evalDaeExpr(loweredDimId, fn);
                  if (typeof ev === "number" && !isNaN(ev) && ev >= 0) {
                    evalDim = Math.round(ev);
                  } else if (!d.text) {
                    exprId = loweredDimId;
                  }
                }
              }
            }
            if (evalDim !== null) {
              exprId = fn.addIntLiteral(evalDim);
              evaluatedDims.push(evalDim);
            } else {
              if (exprId < 0 && d.text) {
                const normText = formatCommaSpacing(d.text);
                exprId = fn.addExpression(ExprKind.Name, fn.interner.intern(normText));
              }
              evaluatedDims.push(-1);
            }
            if (exprId >= 0) {
              shapeExprIds.push(exprId);
            }
          } else if (d.kind === "literal" && d.value !== undefined) {
            shapeExprIds.push(fn.addIntLiteral(d.value));
            evaluatedDims.push(d.value);
          } else if (d.kind === "colon" || d.kind === "flexible" || d.text?.trim() === ":") {
            shapeExprIds.push(fn.addColonExpr());
            evaluatedDims.push(-1);
          }
        }
        if (evaluatedDims.length > 0) {
          fn.setVarShape(varIdx, evaluatedDims);
        }
        if (shapeExprIds.length > 0) {
          fn.setVarShapeExprs(varIdx, shapeExprIds);
        }
      }
      const seenAttrs = new Set<string>();
      for (const attr of compTypeMods) {
        if (attr.value && attr.name && !seenAttrs.has(attr.name)) {
          const val = attr.value;
          let exprId: number | null = null;
          if (val.kind === "literal") {
            if (typeof val.value === "number") {
              exprId =
                vType === VarType.Integer && (attr.name === "min" || attr.name === "max")
                  ? fn.addIntLiteral(Math.round(val.value))
                  : fn.addRealLiteral(val.value);
            } else if (typeof val.value === "string") exprId = fn.addStringLiteral(val.value);
          } else if (val.text) {
            const t = val.text.trim();
            if (t.startsWith('"') && t.endsWith('"')) {
              exprId = fn.addStringLiteral(t.slice(1, -1));
            } else {
              let num = Number(t);
              if (isNaN(num) && isDottedIdentifierChain(stripLeadingDot(t))) {
                const cRes = lookupDbConstant(t, db, sym.parentId ?? undefined);
                if (cRes && typeof cRes.value === "number") {
                  num = cRes.value;
                }
              }
              if (!isNaN(num)) {
                exprId =
                  vType === VarType.Integer && (attr.name === "min" || attr.name === "max")
                    ? fn.addIntLiteral(Math.round(num))
                    : fn.addRealLiteral(num);
              }
            }
          }
          if (exprId !== null) {
            seenAttrs.add(attr.name);
            fn.setVarAttr(varIdx, attr.name, exprId);
          }
        }
      }
      const extModForComp = [...extendsMods].reverse().find((m) => m.name === comp.name && m.value?.text);
      const bText = (extModForComp?.value?.text ?? compInst?.modification?.bindingExpression?.text)?.trim();
      if (isConstant && evaluatedDims.length > 0 && evaluatedDims.some((dim) => dim === 0)) {
        fn.setVarExpression(varIdx, fn.addArrayCtorExpr([]));
      } else if (bText) {
        const num = Number(bText);
        const arithVal = isNaN(num) ? evalArithmeticString(bText, true) : num;
        if (arithVal !== null && !isNaN(arithVal)) {
          const exprId =
            vType === VarType.Integer ? fn.addIntLiteral(Math.round(arithVal)) : fn.addRealLiteral(arithVal);
          fn.setVarExpression(varIdx, exprId);
        } else if (recordConstValues.has(bText)) {
          const cVal = recordConstValues.get(bText)!;
          const exprId = vType === VarType.Integer ? fn.addIntLiteral(Math.round(cVal)) : fn.addRealLiteral(cVal);
          fn.setVarExpression(varIdx, exprId);
        } else if (bText === "true" || bText === "false") {
          fn.setVarExpression(varIdx, fn.addBoolLiteral(bText === "true"));
        } else if (bText.startsWith('"') && bText.endsWith('"')) {
          fn.setVarExpression(varIdx, fn.addStringLiteral(bText.slice(1, -1)));
        } else {
          const findBindingExprNode = (n: CstNodeLike | null | undefined): CstNodeLike | null => {
            if (!n) return null;
            if (n.type === "expression") return n;
            for (const c of n.children || []) {
              const res = findBindingExprNode(c);
              if (res) return res;
            }
            return null;
          };
          let exprCst: CstNodeLike | null = null;
          if (extModForComp?.value?.cstBytes) {
            exprCst = db.cstNodeRange(
              extModForComp.value.cstBytes[0],
              extModForComp.value.cstBytes[1],
              sym,
            ) as CstNodeLike | null;
          }
          if (!exprCst) {
            const modChild = compCst?.children?.find((c) => c.type === "modification");
            exprCst = findBindingExprNode(modChild ?? compCst);
          }
          if (exprCst) {
            let exprId = flattener.lowerExpr(exprCst as SyntaxNode, fn, "");
            if (exprId >= 0) {
              if (isConstant) {
                const ev = evalDaeExpr(exprId, fn);
                if (typeof ev === "number" && !isNaN(ev)) {
                  exprId = vType === VarType.Integer ? fn.addIntLiteral(Math.round(ev)) : fn.addRealLiteral(ev);
                } else if (typeof ev === "boolean") {
                  exprId = fn.addBoolLiteral(ev);
                } else if (typeof ev === "string") {
                  exprId = fn.addStringLiteral(ev);
                } else if (Array.isArray(ev)) {
                  if (ev.length === 0) {
                    exprId = fn.addArrayCtorExpr([]);
                  } else if (ev.every((x): x is number => typeof x === "number" && !isNaN(x))) {
                    exprId = fn.addArrayCtorExpr(
                      ev.map((x) =>
                        vType === VarType.Integer ? fn.addIntLiteral(Math.round(x)) : fn.addRealLiteral(x),
                      ),
                    );
                  }
                }
              }
              if (vType === VarType.Real && !isRealExpr(exprId, fn)) {
                exprId = castToRealExpr(exprId, fn);
              }
              fn.setVarExpression(varIdx, exprId);
            }
          }
        }
      }
    }
  }
  const resIdx = fn.addVariable("res", VarType.Real, Variability.Continuous, Causality.Output);
  fn.setVarCustomType(resIdx, resTypeName);
  (rt._recordCtorCache ??= new Map<string, DAEBuilder>()).set(ctorCacheKey, fn);
  dae.addFunction(fnName, fn);
  if (resTypeName && resTypeName !== fnName && !overrideFnName?.includes("$") && !dae.getFunction(resTypeName)) {
    dae.addFunction(resTypeName, fn);
  }
  if (!overrideFnName && qualName && qualName !== fnName && qualName !== sym.name) dae.addFunction(qualName, fn);

  const isSpeculativeFnDae = dae.classKind === "function" && !daeFn.parentDae;
  const rootModelResourceId = db.symbol(flattener.currentRootClassId ?? rootClassId)?.resourceId;
  const isCrossFileFnLocalRecord =
    dae.classKind === "function" &&
    Boolean(rootModelResourceId && sym.resourceId && sym.resourceId !== rootModelResourceId) &&
    !flattener.usedRecordSymIds?.has(sym.id);
  if (!isSpeculativeFnDae && !isCrossFileFnLocalRecord) {
    let rootDae: FlattenedFunctionDae = (flattener.currentRootDae as FlattenedFunctionDae | null | undefined) ?? daeFn;
    while (rootDae.parentDae) rootDae = rootDae.parentDae;
    rootDae.addFunction(fnName, fn);
    if (resTypeName && resTypeName !== fnName && !overrideFnName?.includes("$") && !rootDae.getFunction(resTypeName)) {
      rootDae.addFunction(resTypeName, fn);
    }
    if (!overrideFnName && qualName && qualName !== fnName && qualName !== sym.name) rootDae.addFunction(qualName, fn);
  }

  return fn;
}

export function generateRecordConstructors(flattener: ModelicaFlattener, rootClassId: SymbolId, dae: DAEBuilder): void {
  const db: QueryDB = flattener.db;
  const daeFn = dae as FlattenedFunctionDae;
  const rootSym = db.symbol(rootClassId);
  const childEntries = db.childrenOf(rootClassId);
  const candidates: SymbolEntry[] = [];
  for (const sym of childEntries) {
    if (sym && sym.kind === "Class" && sym.id !== rootClassId) candidates.push(sym);
  }
  const fileSymbols: SymbolEntry[] = flattener.getFileSymbols(rootSym?.resourceId);
  const fileClasses = fileSymbols.filter((s) => s.kind === "Class" && s.id !== rootClassId);
  for (const fc of fileClasses) {
    if (!candidates.some((c) => c.id === fc.id)) candidates.push(fc);
  }

  const isRecordSym = (sym: SymbolEntry): boolean => {
    if (sym.id === rootClassId) return false;
    return flattener.isRecordSym(sym);
  };

  const usedRecordNames = new Set<string>();
  if (dae.classKind !== "function" && flattener.usedRecordNames) {
    for (const name of flattener.usedRecordNames) {
      usedRecordNames.add(name);
      if (name.includes(".")) usedRecordNames.add(name.split(".").pop()!);
    }
  }
  if (dae.classKind !== "function" && flattener.usedRecordSymIds) {
    for (const sid of flattener.usedRecordSymIds) {
      const s = db.symbol(sid);
      if (s) {
        if (s.name) usedRecordNames.add(s.name);
        const q = getSymbolQualifiedName(db, s.id);
        if (q) usedRecordNames.add(q);
        if (s.resourceId === rootSym?.resourceId && !candidates.some((c) => c.id === s.id)) candidates.push(s);
      }
    }
  }
  const rootElements = db.query<SymbolId[]>("instantiate", rootClassId);
  const rootComps: SymbolEntry[] = [];
  if (rootElements && rootElements.length > 0) {
    for (const eid of rootElements) {
      const entry = db.symbol(eid);
      if (entry && entry.kind === "Component") rootComps.push(entry);
    }
  } else {
    for (const comp of db.childrenOf(rootClassId) || []) {
      if (comp && comp.kind === "Component") rootComps.push(comp);
    }
  }
  const directCompRecordIds = new Set<SymbolId>();
  for (const comp of rootComps) {
    const compInst = db.query<ComponentInstanceData>("componentInstance", comp.id);
    const cMeta = (comp.metadata ?? {}) as SymbolMetaLike;
    const typeSpec = compInst?.typeSpecifier ?? cMeta.typeSpecifier;
    if (typeSpec) {
      const cleanType = typeSpec.includes(".") ? typeSpec.split(".").pop()! : typeSpec;
      usedRecordNames.add(cleanType);
      usedRecordNames.add(typeSpec);
      const rawTarget = db.query<SymbolId | SymbolEntry | null>("classInstance", comp.id);
      let compTarget: SymbolEntry | null =
        typeof rawTarget === "number" ? (db.symbol(rawTarget) ?? null) : (rawTarget ?? null);
      if (!compTarget) {
        const resolver =
          (comp.parentId ? db.query<NameResolverFn | null>("resolveName", comp.parentId) : null) ??
          (comp.parentId ? db.query<NameResolverFn | null>("resolveSimpleName", comp.parentId) : null) ??
          db.query<NameResolverFn | null>("resolveName", rootClassId);
        const resolved = resolver?.(typeSpec) ?? resolver?.(cleanType);
        if (resolved && isRecordSym(resolved)) {
          compTarget = resolved;
        } else {
          compTarget = db.byName(cleanType).find((t) => isRecordSym(t)) ?? null;
        }
      }
      if (compTarget && isRecordSym(compTarget)) {
        directCompRecordIds.add(compTarget.id);
        if (
          (dae.classKind === "function" || compTarget.resourceId === rootSym?.resourceId) &&
          !candidates.some((c) => c.id === compTarget!.id)
        ) {
          candidates.push(compTarget);
        }
      } else if (compTarget && !isRecordSym(compTarget) && dae.classKind !== "function") {
        // Recursively collect nested record-typed components (e.g. flow R r inside connector C)
        // which TS component instantiation tracks via usedRecordSymIds, but WASM mode skips.
        const visitedNested = new Set<SymbolId>([rootClassId]);
        const walkNested = (clsId: SymbolId, depth: number): void => {
          if (depth > 8 || visitedNested.has(clsId)) return;
          visitedNested.add(clsId);
          const elems = db.query<SymbolId[]>("instantiate", clsId) ?? [];
          const subComps =
            elems.length > 0
              ? elems.map((id) => db.symbol(id)).filter((s): s is SymbolEntry => Boolean(s && s.kind === "Component"))
              : (db.childrenOf(clsId) || []).filter((s) => s && s.kind === "Component");
          for (const sc of subComps) {
            const scInst = db.query<ComponentInstanceData>("componentInstance", sc.id);
            const scMeta = (sc.metadata ?? {}) as SymbolMetaLike;
            const scType = scInst?.typeSpecifier ?? scMeta.typeSpecifier;
            if (!scType) continue;
            const scClean = scType.includes(".") ? scType.split(".").pop()! : scType;
            const rawSub = db.query<SymbolId | SymbolEntry | null>("classInstance", sc.id);
            let subTarget: SymbolEntry | null =
              typeof rawSub === "number" ? (db.symbol(rawSub) ?? null) : (rawSub ?? null);
            if (!subTarget) {
              const res =
                (sc.parentId ? db.query<NameResolverFn | null>("resolveName", sc.parentId) : null) ??
                db.query<NameResolverFn | null>("resolveName", clsId);
              subTarget = res?.(scType) ?? res?.(scClean) ?? null;
            }
            if (!subTarget) continue;
            if (isRecordSym(subTarget)) {
              usedRecordNames.add(scClean);
              usedRecordNames.add(scType);
              if (subTarget.name) usedRecordNames.add(subTarget.name);
              const qSub = getSymbolQualifiedName(db, subTarget.id);
              if (qSub) usedRecordNames.add(qSub);
              directCompRecordIds.add(subTarget.id);
              if (subTarget.resourceId === rootSym?.resourceId && !candidates.some((c) => c.id === subTarget!.id)) {
                candidates.push(subTarget);
              }
            }
            walkNested(subTarget.id, depth + 1);
          }
        };
        walkNested(compTarget.id, 0);
      }
      if (
        compTarget &&
        isRecordSym(compTarget) &&
        compInst?.modification?.args &&
        compInst.modification.args.length > 0 &&
        dae.classKind !== "function" &&
        !(rootSym && isFunctionSym(db, rootSym))
      ) {
        const qTarget = getSymbolQualifiedName(db, compTarget.id) || compTarget.name;
        if (!flattener.instantiatedRecordComponents) {
          flattener.instantiatedRecordComponents = new Map<string, Set<string>>();
        }
        let s = flattener.instantiatedRecordComponents.get(qTarget);
        if (!s) {
          s = new Set<string>();
          flattener.instantiatedRecordComponents.set(qTarget, s);
        }
        s.add(comp.name);
        if (compTarget.name && compTarget.name !== qTarget) {
          let s2 = flattener.instantiatedRecordComponents.get(compTarget.name);
          if (!s2) {
            s2 = new Set<string>();
            flattener.instantiatedRecordComponents.set(compTarget.name, s2);
          }
          s2.add(comp.name);
        }
      }
    }
  }
  for (let i = 0; i < dae.varCount; i++) {
    const ct = dae.getVarCustomType(i);
    if (ct) {
      usedRecordNames.add(ct);
      if (ct.includes(".")) usedRecordNames.add(ct.split(".").pop()!);
    }
  }
  for (const [_, fn] of dae.functions) {
    const isAutoRecCtor = Boolean(fn.description?.startsWith("Automatically generated record constructor"));
    for (let i = 0; i < fn.varCount; i++) {
      if (isAutoRecCtor && fn.getVarName(i) === "res") continue;
      const ct = fn.getVarCustomType(i);
      if (ct) {
        usedRecordNames.add(ct);
        if (ct.includes(".") && !ct.includes("$")) usedRecordNames.add(ct.split(".").pop()!);
      }
    }
  }
  const rootCst = db.cstNode(rootClassId) as CstNodeLike | null;
  if (rootCst) {
    const { calledNames, referencedPaths } = collectCstFunctionRefs(rootCst);
    for (const sym of candidates) {
      if (isRecordSym(sym)) {
        const name = sym.name;
        const qName = getSymbolQualifiedName(db, sym.id);
        if (qName && calledNames.has(qName)) {
          usedRecordNames.add(name);
          usedRecordNames.add(qName);
        } else if (calledNames.has(name)) {
          usedRecordNames.add(name);
        }
      }
    }
    for (const fsym of fileSymbols) {
      if (fsym && fsym.kind === "Component" && fsym.parentId && fsym.parentId !== rootClassId) {
        if (!fsym.name) continue;
        const qCompName = getSymbolQualifiedName(db, fsym.id);
        if (qCompName && referencedPaths.has(qCompName)) {
          const compInst = db.query<ComponentInstanceData>("componentInstance", fsym.id);
          const rawTarget = db.query<SymbolId | SymbolEntry | null>("classInstance", fsym.id);
          let compTarget: SymbolEntry | null =
            typeof rawTarget === "number" ? (db.symbol(rawTarget) ?? null) : (rawTarget ?? null);
          if (!compTarget) {
            const tSpec = compInst?.typeSpecifier ?? (fsym.metadata as SymbolMetaLike | undefined)?.typeSpecifier;
            if (tSpec) {
              compTarget = db.byName(String(tSpec).split(".").pop()!).find((t) => isRecordSym(t)) ?? null;
            }
          }
          if (compTarget && isRecordSym(compTarget)) {
            usedRecordNames.add(compTarget.name);
            const qTarget = getSymbolQualifiedName(db, compTarget.id) || compTarget.name;
            if (qTarget) usedRecordNames.add(qTarget);
            const parentSym = fsym.parentId ? db.symbol(fsym.parentId) : null;
            if (
              compInst?.modification?.args &&
              compInst.modification.args.length > 0 &&
              fsym.name &&
              !(parentSym && isFunctionSym(db, parentSym))
            ) {
              if (!flattener.instantiatedRecordComponents) {
                flattener.instantiatedRecordComponents = new Map<string, Set<string>>();
              }
              let s = flattener.instantiatedRecordComponents.get(qTarget);
              if (!s) {
                s = new Set<string>();
                flattener.instantiatedRecordComponents.set(qTarget, s);
              }
              s.add(fsym.name);
              if (compTarget.name && compTarget.name !== qTarget) {
                let s2 = flattener.instantiatedRecordComponents.get(compTarget.name);
                if (!s2) {
                  s2 = new Set<string>();
                  flattener.instantiatedRecordComponents.set(compTarget.name, s2);
                }
                s2.add(fsym.name);
              }
            }
          }
        }
      }
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const sym of candidates) {
      if (isRecordSym(sym)) {
        const name = sym.name;
        const qName = getSymbolQualifiedName(db, sym.id);
        if (usedRecordNames.has(name) || (qName && usedRecordNames.has(qName))) {
          const instElements = db.query<SymbolId[]>("instantiate", sym.id);
          const comps: SymbolEntry[] = [];
          if (instElements && instElements.length > 0) {
            for (const eid of instElements) {
              const entry = db.symbol(eid);
              if (entry && entry.kind === "Component") comps.push(entry);
            }
          } else {
            for (const comp of db.childrenOf(sym.id) || []) {
              if (comp && comp.kind === "Component") comps.push(comp);
            }
          }
          for (const comp of comps) {
            const compInst = db.query<ComponentInstanceData>("componentInstance", comp.id);
            const cMeta = (comp.metadata ?? {}) as SymbolMetaLike;
            const typeSpec = compInst?.typeSpecifier ?? cMeta.typeSpecifier;
            if (typeSpec) {
              const cleanType = typeSpec.includes(".") ? typeSpec.split(".").pop()! : typeSpec;
              if (!usedRecordNames.has(cleanType)) {
                usedRecordNames.add(cleanType);
                usedRecordNames.add(typeSpec);
                changed = true;
              }
              if (dae.classKind === "function") {
                const subTarget = db.byName(cleanType).find((t) => isRecordSym(t)) ?? null;
                if (subTarget && !candidates.some((c) => c.id === subTarget.id)) {
                  candidates.push(subTarget);
                  directCompRecordIds.add(subTarget.id);
                  changed = true;
                }
              }
            }
          }
        }
      }
    }
  }

  const recordNameCounts = new Map<string, number>();
  for (const sym of candidates) {
    if (isRecordSym(sym) && sym.name) {
      recordNameCounts.set(sym.name, (recordNameCounts.get(sym.name) ?? 0) + 1);
    }
  }

  const isRecordUsed = (sym: SymbolEntry | null | undefined): boolean => {
    if (!sym || !sym.name) return false;
    const name = sym.name;
    const qName = getSymbolQualifiedName(db, sym.id);
    let effParentId = sym.parentId;
    while (effParentId !== null && db.symbol(effParentId)?.kind === "Extends") {
      effParentId = db.symbol(effParentId)?.parentId ?? null;
    }
    if (effParentId && effParentId !== rootClassId && flattener.isClassPartial?.(effParentId)) {
      if (
        (dae.classKind === "function" && directCompRecordIds.has(sym.id)) ||
        (daeFn.specializedPrefix && effParentId === daeFn.enclosingScopeId)
      ) {
        return usedRecordNames.has(name) || (Boolean(qName) && usedRecordNames.has(qName!));
      }
      return false;
    }
    if (effParentId && effParentId !== rootClassId && (recordNameCounts.get(name) ?? 0) > 1) {
      return Boolean(flattener.usedRecordSymIds?.has(sym.id)) || (Boolean(qName) && usedRecordNames.has(qName!));
    }
    return usedRecordNames.has(name) || (Boolean(qName) && usedRecordNames.has(qName!));
  };

  for (const sym of candidates) {
    if (isRecordSym(sym) && isRecordUsed(sym)) {
      const specOverrideName =
        daeFn.specializedPrefix &&
        sym.parentId &&
        sym.parentId !== rootClassId &&
        flattener.isClassPartial?.(sym.parentId)
          ? `${daeFn.specializedPrefix}.${sym.name}`
          : undefined;
      const fn = flattener.generateRecordConstructorFor(sym, dae, rootClassId, specOverrideName);
      if (fn) {
        const qualName = getSymbolQualifiedName(db, sym.id) || sym.name;
        const compNames =
          flattener.instantiatedRecordComponents?.get(qualName) ??
          flattener.instantiatedRecordComponents?.get(sym.name);
        if (compNames && compNames.size > 0) {
          for (const compName of compNames) {
            const specFnName = `${qualName}$${compName}`;
            const specSimpleName = `${sym.name}$${compName}`;
            if (!dae.functions.has(specFnName)) {
              const specFn = (
                dae.exports
                  ? new DAEBuilder(dae.exports, specFnName, "", dae.interner)
                  : new DAEBuilder(dae.interner, specFnName, "")
              ) as FlattenedFunctionDae;
              specFn.classKind = "function";
              specFn.description = `Automatically generated record constructor for ${specFnName}`;
              if (flattener.isOperatorRecordSym(sym)) {
                specFn.isOperatorRecord = true;
                specFn.extensionMetadata.isOperatorRecord = true;
              }
              for (let i = 0; i < fn.varCount; i++) {
                const vName = fn.getVarName(i);
                if (vName === "res") continue;
                const vType = fn.getVarType(i);
                const vCausality = fn.getVarCausality(i);
                const vProt = fn.isVarProtected(i);
                const vShape = fn.getVarShape(i);
                const vCustom = fn.getVarCustomType(i);
                const vExpr = fn.getVarExpression(i);
                const vEnumLits = fn.getVarEnumerationLiterals(i);
                const specVarIdx = specFn.addVariable(vName, vType, Variability.Continuous, vCausality);
                if (vProt) specFn.setVarProtected(specVarIdx, true);
                if (vCustom) specFn.setVarCustomType(specVarIdx, vCustom);
                if (vEnumLits) specFn.setVarEnumerationLiterals(specVarIdx, vEnumLits);
                if (vShape.length > 0) specFn.setVarShape(specVarIdx, vShape);
                if (vExpr !== undefined && vExpr >= 0) {
                  const ek = fn.getExprKind(vExpr);
                  if (ek === ExprKind.RealLiteral) {
                    specFn.setVarExpression(specVarIdx, specFn.addRealLiteral(fn.getExprRealValue(vExpr)));
                  } else if (ek === ExprKind.IntLiteral) {
                    specFn.setVarExpression(specVarIdx, specFn.addIntLiteral(fn.getExprData1(vExpr)));
                  } else if (ek === ExprKind.BoolLiteral) {
                    specFn.setVarExpression(specVarIdx, specFn.addBoolLiteral(fn.getExprData1(vExpr) !== 0));
                  }
                }
              }
              const specResIdx = specFn.addVariable("res", VarType.Real, Variability.Continuous, Causality.Output);
              specFn.setVarCustomType(specResIdx, specSimpleName);
              dae.addFunction(specFnName, specFn);
              if (specSimpleName !== specFnName) {
                dae.addFunction(specSimpleName, specFn);
              }
            }
          }
        }
      }
      if (dae.classKind !== "function") {
        for (const ch of db.childrenOf(sym.id) || []) {
          if (ch && ch.name === "equalityConstraint" && isFunctionSym(db, ch)) {
            const qualName = getSymbolQualifiedName(db, sym.id) || sym.name;
            const eqFnName = `${qualName}.equalityConstraint`;
            if (!dae.functions.has(eqFnName) && !flattener.activeFlatteningFunctionIds.has(ch.id)) {
              const eqFn = flattener.flattenFunction(ch.id, eqFnName, undefined, dae) as FlattenedFunctionDae;
              eqFn.wasCalled = true;
              dae.addFunction(eqFnName, eqFn);
            }
          }
        }
      }
      if (flattener.isOperatorRecordSym(sym) && dae.classKind !== "function") {
        const ctors = db.query<OperatorConstructorEntry[] | null>("operatorConstructors", sym.id);
        if (ctors && ctors.length > 0) {
          for (const ctor of ctors) {
            if (
              (flattener.usedOperatorFunctions?.has(ctor.qualifiedName) ||
                (!dae.extensionMetadata?.["isOldFrontend"] && usedRecordNames.has(sym.name))) &&
              !dae.functions.has(ctor.qualifiedName) &&
              !flattener.activeFlatteningFunctionIds.has(ctor.funcSymId)
            ) {
              const ctorFn = flattener.flattenFunction(ctor.funcSymId, ctor.qualifiedName, undefined, dae);
              dae.addFunction(ctor.qualifiedName, ctorFn);
            }
          }
        }
      }
    }
  }
}

export function flattenFunction(
  flattener: ModelicaFlattener,
  fnSymId: SymbolId,
  fnName: string,
  modifiers?: ModArgLike[],
  parentDae?: DAEBuilder,
  enclosingScopeId?: SymbolId,
): DAEBuilder {
  const rt = flattener as FlattenerWithFnRuntime;
  const parentFnDae = parentDae as FlattenedFunctionDae | undefined;
  const db: QueryDB = flattener.db;
  const cleanFnName = stripLeadingDots(fnName);
  const fnParentId = db.symbol(fnSymId)?.parentId;
  const compModsArgs = ((
    parentFnDae?.componentParentMods ?? (parentDae?.classKind !== "function" ? flattener.currentParentMods : undefined)
  )?.args ?? []) as ModArgLike[];
  const redeclSig = compModsArgs
    .filter((a) => a && !a.isBreak && (a.isRedeclaration || a.redeclaredTypeSpecifier))
    .map((a) => `${a.name}=${a.redeclaredTypeSpecifier}`)
    .join(",");
  const canCache = !modifiers || modifiers.length === 0;
  const fnCacheKey = canCache ? `${fnSymId}:${cleanFnName}:${enclosingScopeId ?? ""}:${redeclSig}` : "";
  if (fnCacheKey) {
    const cache = (rt._flattenedFunctionCache ??= new Map<string, DAEBuilder>());
    const cachedFn = cache.get(fnCacheKey) as FlattenedFunctionDae | undefined;
    if (cachedFn && !cachedFn.isBeingFlattened) {
      const parts = cleanFnName.split(".");
      const baseName = parts[parts.length - 1]!;
      if (parentDae) {
        parentDae.addFunction(cleanFnName, cachedFn);
        parentDae.addFunction(fnName, cachedFn);
        const naturalParentId = fnParentId ?? db.symbol(fnSymId)?.parentId;
        const isBuiltinName = SCALAR_VECTORIZABLE_FUNCTIONS.has(baseName) || BUILTIN_FUNCTIONS.has(baseName);
        if (
          baseName &&
          !isBuiltinName &&
          !cleanFnName.includes("$") &&
          (!enclosingScopeId || enclosingScopeId === naturalParentId)
        ) {
          parentDae.addFunction(baseName, cachedFn);
        }
        let rootDae: FlattenedFunctionDae | undefined =
          (flattener.currentRootDae as FlattenedFunctionDae | null | undefined) ?? parentFnDae;
        while (rootDae?.parentDae) rootDae = rootDae.parentDae;
        if (rootDae && rootDae !== parentDae) {
          rootDae.addFunction(cleanFnName, cachedFn);
          rootDae.addFunction(fnName, cachedFn);
        }
        if (cachedFn.functions && cachedFn.functions.size > 0) {
          for (const [nestedName, nestedFn] of cachedFn.functions.entries()) {
            if (nestedFn === cachedFn) continue;
            parentDae.addFunction(nestedName, nestedFn);
            if (rootDae) rootDae.addFunction(nestedName, nestedFn);
          }
        }
      }
      return cachedFn;
    }
  }

  const prevFnId = flattener.currentFlatteningFunctionId;
  const prevClassId = flattener.currentClassId;
  const prevEnclosingScope = flattener.currentFunctionEnclosingScope;
  const prevActiveLoopVars = flattener.activeLoopVars;
  flattener.activeLoopVars = new Set<string>();
  if (rt.state) rt.state.activeLoopVars = flattener.activeLoopVars;
  flattener.currentFlatteningFunctionId = fnSymId;
  flattener.activeFlatteningFunctionIds.add(fnSymId);
  if (enclosingScopeId !== undefined) {
    flattener.currentClassId = enclosingScopeId;
    if (fnParentId !== undefined && fnParentId !== enclosingScopeId) {
      flattener.currentFunctionEnclosingScope = enclosingScopeId;
    }
  } else if (fnParentId !== undefined && fnParentId !== null) {
    flattener.currentClassId = fnParentId;
    flattener.currentFunctionEnclosingScope = fnParentId;
  } else {
    flattener.currentFunctionEnclosingScope = null;
  }

  const fn = (
    parentDae?.exports
      ? new DAEBuilder(parentDae.exports, cleanFnName, "", parentDae.interner)
      : new DAEBuilder(parentDae ? parentDae.interner : undefined, cleanFnName, "")
  ) as FlattenedFunctionDae;
  fn.parentDae = parentFnDae;
  fn.db = db;
  fn.classKind = "function";
  fn.symId = fnSymId;
  fn.flattener = flattener;
  const resolvedEncScope = enclosingScopeId ?? fnParentId ?? db.symbol(fnSymId)?.parentId;
  fn.enclosingScopeId = resolvedEncScope;
  const sameEnclosingAsParent = resolvedEncScope !== undefined && resolvedEncScope === parentFnDae?.enclosingScopeId;
  fn.componentPrefix =
    rt.currentFunctionComponentPrefix ?? (sameEnclosingAsParent ? parentFnDae?.componentPrefix : undefined);
  fn.specializedPrefix =
    rt.currentFunctionSpecializedPrefix ?? (sameEnclosingAsParent ? parentFnDae?.specializedPrefix : undefined);
  fn.componentParentMods =
    parentFnDae?.componentParentMods ??
    (parentDae?.classKind !== "function" ? (flattener.currentParentMods ?? undefined) : undefined);
  fn.isBeingFlattened = true;
  fn.extensionMetadata["isOldFrontend"] = Boolean(
    parentDae?.extensionMetadata?.["isOldFrontend"] ?? flattener.options?.isOldFrontend,
  );
  fn.extensionMetadata["hasOldInstOption"] = Boolean(parentDae?.extensionMetadata?.["hasOldInstOption"]);

  const prevImports = flattener.currentImports;
  try {
    const parts = cleanFnName.split(".");
    const baseName = parts[parts.length - 1]!;
    const isBuiltinName = SCALAR_VECTORIZABLE_FUNCTIONS.has(baseName) || BUILTIN_FUNCTIONS.has(baseName);

    if (parentDae) {
      parentDae.addFunction(cleanFnName, fn);
      parentDae.addFunction(fnName, fn);
      const naturalParentId = fnParentId ?? db.symbol(fnSymId)?.parentId;
      if (
        baseName &&
        !isBuiltinName &&
        !cleanFnName.includes("$") &&
        (!enclosingScopeId || enclosingScopeId === naturalParentId)
      ) {
        parentDae.addFunction(baseName, fn);
      }
    }
    fn.addFunction(cleanFnName, fn);
    fn.addFunction(fnName, fn);
    if (baseName && !isBuiltinName && !cleanFnName.includes("$")) fn.addFunction(baseName, fn);

    const fnImports = flattener.collectClassImports(fnSymId);
    flattener.currentImports = new Map(
      enclosingScopeId && enclosingScopeId !== fnParentId
        ? [...flattener.collectClassImports(enclosingScopeId), ...fnImports]
        : fnImports,
    );

    const cst = db.cstNode(fnSymId) as SyntaxNode | null;
    if (cst) {
      fn.fnRange = getClassDiagRange(cst);
    }
    if (hasAnnotationBoolModificationCst(cst, "__OpenModelica_EarlyInline", true)) {
      fn.isEarlyInline = true;
    }

    let _pureDeclared = false;
    void _pureDeclared;
    let impureDeclared = false;
    if (cst) {
      for (const child of cst.children || []) {
        if (child.type === "class_prefixes") {
          const words = tokenizeCommentStrippedWords(child.text ?? "");
          if (words.includes("pure")) _pureDeclared = true;
          if (words.includes("impure")) impureDeclared = true;
        }
      }
    }

    if (impureDeclared) {
      fn.isImpure = true;
      fn.isExplicitImpure = true;
    }

    const findDesc = (node: CstNodeLike | null | undefined): string | null => {
      if (!node) return null;
      if (
        node.type === "element" ||
        node.type === "component_clause" ||
        node.type === "external_clause" ||
        node.type === "equation_section" ||
        node.type === "algorithm_section"
      )
        return null;
      if (node.type === "description_string" || node.type === "string_literal") {
        let t = node.text?.trim() ?? "";
        if (t.startsWith('"') && t.endsWith('"')) return t.slice(1, -1);
      }
      for (const child of node.children || []) {
        const d = findDesc(child);
        if (d) return d;
      }
      return null;
    };
    const fnDesc = findDesc(cst);
    if (fnDesc) fn.description = fnDesc;

    const findExternalClause = (node: CstNodeLike | null | undefined): CstNodeLike | null => {
      if (!node) return null;
      if (node.type === "external_clause") return node;
      for (const child of node.children || []) {
        const found = findExternalClause(child);
        if (found) return found;
      }
      return null;
    };
    let extClause = findExternalClause(cst);

    const shortSpec = getShortClassSpecifierNode(cst);
    if (shortSpec) {
      fn.isShortFunc = true;
    }
    let targetSymId = fnSymId;
    const combinedMods: ModArgLike[] = [...(modifiers ?? [])];

    const visitedUnwrap = new Set<SymbolId>();
    while (!visitedUnwrap.has(targetSymId)) {
      visitedUnwrap.add(targetSymId);
      const currSym = db.symbol(targetSymId);
      const currCst = db.cstNode(targetSymId) as SyntaxNode | null;
      if (!currSym || !currCst) break;

      const currParentSym = currSym.parentId != null ? db.symbol(currSym.parentId) : null;
      const isCurrInNonFuncClass = Boolean(currParentSym && !isFunctionSym(db, currParentSym));
      const compModsArgsInner = (fn.componentParentMods?.args ??
        flattener.currentParentMods?.args ??
        []) as ModArgLike[];
      const allCandidateMods = [...compModsArgsInner, ...combinedMods];
      let matchedRedecl: ModArgLike | null = null;
      let matchedRedeclTarget: SymbolEntry | null = null;
      for (let i = allCandidateMods.length - 1; i >= 0; i--) {
        const a = allCandidateMods[i];
        if (!a || a.isBreak || !(a.isRedeclaration || a.redeclaredTypeSpecifier) || a.name !== currSym.name) {
          continue;
        }
        if (isCurrInNonFuncClass && a.ownerClassId) {
          const ownerSym = db.symbol(a.ownerClassId);
          if (ownerSym && isFunctionSym(db, ownerSym)) {
            continue;
          }
        }
        const rawSpec = stripLeadingDots(String(a.redeclaredTypeSpecifier ?? ""));
        if (!rawSpec) continue;
        const lookupScope =
          a.evaluationScopeId ?? a.ownerClassId ?? currSym.parentId ?? fnParentId ?? flattener.currentRootClassId;
        const resolver =
          (lookupScope
            ? rawSpec.includes(".")
              ? db.query<NameResolverFn | null>("resolveName", lookupScope)
              : (db.query<NameResolverFn | null>("resolveSimpleName", lookupScope) ??
                db.query<NameResolverFn | null>("resolveName", lookupScope))
            : null) ??
          (flattener.currentRootClassId
            ? db.query<NameResolverFn | null>("resolveName", flattener.currentRootClassId)
            : null);
        let candSym = resolver ? resolver(rawSpec) : null;
        if (!candSym) {
          const shortR = rawSpec.includes(".") ? rawSpec.split(".").pop()! : rawSpec;
          candSym = db.byName(shortR).find((e) => {
            if (e.kind !== "Class" && e.kind !== "Function") return false;
            if (rawSpec.includes(".")) {
              const qn = getSymbolQualifiedName(db, e.id);
              return qn === rawSpec || qn.endsWith(`.${rawSpec}`);
            }
            return true;
          });
        }
        if (candSym && !visitedUnwrap.has(candSym.id)) {
          matchedRedecl = a;
          matchedRedeclTarget = candSym;
          break;
        }
      }

      if (matchedRedecl && matchedRedeclTarget) {
        const subArgs = (matchedRedecl.nestedArgs ?? matchedRedecl.args) as ModArgLike[] | undefined;
        if (subArgs && subArgs.length > 0) {
          combinedMods.unshift(
            ...subArgs.map((sa) => ({
              ...sa,
              ownerClassId: sa.ownerClassId ?? matchedRedeclTarget!.id,
              evaluationScopeId:
                sa.evaluationScopeId ??
                matchedRedecl!.evaluationScopeId ??
                matchedRedecl!.ownerClassId ??
                currSym.parentId ??
                undefined,
            })),
          );
        }
        targetSymId = matchedRedeclTarget.id;
        if (!fn.description) {
          const targetCst = db.cstNode(targetSymId) as CstNodeLike | null;
          const targetDesc = findDesc(targetCst);
          if (targetDesc) fn.description = targetDesc;
        }
        continue;
      }

      const currShortSpec = getShortClassSpecifierNode(currCst) as SyntaxNode | null;
      if (!currShortSpec) break;

      const typeSpecNode =
        Cst.ShortClassSpecifier.typeSpecifier(currShortSpec) ??
        currShortSpec.children?.find((c) => c.type === "type_specifier");
      const rawBaseName = typeSpecNode?.text?.trim() ?? "";
      const cleanBase = stripLeadingDots(rawBaseName);
      const modNode =
        Cst.ShortClassSpecifier.classModification(currShortSpec) ??
        currShortSpec.children?.find((c) => c.type === "class_modification");
      if (modNode) {
        const parsed = db.query<EffectiveModLike | null>("effectiveModification", targetSymId);
        if (parsed?.args) {
          combinedMods.unshift(
            ...parsed.args.map((pa) => ({
              ...pa,
              ownerClassId: pa.ownerClassId ?? targetSymId,
              evaluationScopeId: pa.evaluationScopeId ?? currSym.parentId ?? fnParentId ?? undefined,
            })),
          );
        }
      } else if (targetSymId === fnSymId) {
        const mathAliasCandidate = cleanBase.startsWith("Modelica.Math.")
          ? cleanBase.slice("Modelica.Math.".length)
          : cleanBase;
        if (MATH_FUNC_ALIAS_SET.has(mathAliasCandidate)) {
          fn.aliasTo = mathAliasCandidate;
        }
      }

      if (!cleanBase) break;
      const parentScopeId = currSym.parentId ?? fnParentId;
      const resolver =
        (parentScopeId ? db.query<NameResolverFn | null>("resolveName", parentScopeId) : null) ??
        db.query<NameResolverFn | null>("resolveName", targetSymId) ??
        db.query<NameResolverFn | null>("resolveSimpleName", targetSymId);
      let baseSym = resolver ? resolver(cleanBase) : null;
      if (!baseSym) {
        const shortBase = cleanBase.includes(".") ? cleanBase.split(".").pop()! : cleanBase;
        baseSym = db.byName(shortBase).find((e) => {
          if (e.kind !== "Class" && e.kind !== "Function") return false;
          if (cleanBase.includes(".")) {
            const qn = getSymbolQualifiedName(db, e.id);
            return qn === cleanBase || qn.endsWith(`.${cleanBase}`);
          }
          return true;
        });
      }
      if (!baseSym || visitedUnwrap.has(baseSym.id)) break;
      if (targetSymId === fnSymId && baseSym.parentId === currSym.parentId && !cleanBase.includes(".")) {
        fn.shortBaseFuncName = baseSym.name;
      }
      targetSymId = baseSym.id;
      if (!fn.description) {
        const targetCst = db.cstNode(baseSym.id) as CstNodeLike | null;
        const targetDesc = findDesc(targetCst);
        if (targetDesc) fn.description = targetDesc;
      }
    }

    const extMods = collectExtendsMods(flattener, targetSymId) as ModArgLike[];
    if (extMods.length > 0) {
      combinedMods.unshift(...extMods);
    }

    const elements = db.query<SymbolId[]>("instantiate", targetSymId);
    if (elements && elements.length > 0) {
      flattener.instantiateElements(elements, "", fn, { args: combinedMods, currentClassId: targetSymId });
    } else {
      const children = db.childrenOf(targetSymId);
      const childIds: SymbolId[] = [];
      for (const ch of children) {
        if (ch.kind === "Component") childIds.push(ch.id);
      }
      if (childIds.length > 0) {
        flattener.instantiateElements(childIds, "", fn, { args: combinedMods, currentClassId: targetSymId });
      }
    }

    flattener.generateRecordConstructors(targetSymId, fn);

    const childFuncs =
      targetSymId === fnSymId
        ? db.childrenOf(targetSymId).filter((c) => c.kind === "Class" && isFunctionSym(db, c))
        : [];
    for (const cf of childFuncs) {
      const nestedQualName = `${cleanFnName}.${cf.name}`;
      const nestedFn = flattener.flattenFunction(cf.id, nestedQualName, undefined, fn);
      fn.addFunction(nestedQualName, nestedFn);
      fn.addFunction(cf.name, nestedFn);
      if (parentDae) {
        parentDae.addFunction(nestedQualName, nestedFn);
      }
    }

    let inheritedExtClause: SymbolEntry | null = null;
    const ownExtClause = findExternalClause(cst);
    const hasOwnAlgo = cstHasOwnAlgorithmSection(cst);
    if (ownExtClause || hasOwnAlgo) {
      const extendsChildren = db.childrenOf(fnSymId).filter((c) => c.kind === "Extends");
      for (const ext of extendsChildren) {
        const base = db.query<SymbolEntry | null>("resolvedBaseClass", ext.id);
        if (base) {
          const baseCst = db.cstNode(base.id) as CstNodeLike | null;
          if (findExternalClause(baseCst)) {
            inheritedExtClause = ext;
            break;
          }
        }
      }
    }

    const isOldFrontend = Boolean(
      fn.extensionMetadata?.["isOldFrontend"] ||
      parentDae?.extensionMetadata?.["isOldFrontend"] ||
      flattener.options?.isOldFrontend,
    );
    if (!isOldFrontend && (ownExtClause || hasOwnAlgo) && inheritedExtClause) {
      const extCst = db.cstNode(inheritedExtClause.id) as FlattenerCstNode | null;
      const extStart = extCst?.startIndex ?? extCst?.startOffset;
      const extEnd = extCst?.endIndex ?? extCst?.endOffset;
      const notifRange =
        extCst && extStart !== undefined && extEnd !== undefined
          ? {
              startPosition: extCst.startPosition,
              endPosition: extCst.endPosition,
              startOffset: extStart,
              endOffset: extEnd,
            }
          : undefined;
      fn.diagnostics.push({
        severity: "notification",
        code: ModelicaErrorCode.NOTIFICATION_FROM_HERE.code,
        message: "From here:",
        range: notifRange,
      });
      const fnRange = cst
        ? {
            startPosition: cst.startPosition,
            endPosition: cst.endPosition,
            startOffset: cst.startIndex ?? cst.startOffset,
            endOffset: cst.endIndex ?? cst.endOffset,
          }
        : undefined;
      fn.diagnostics.push({
        severity: "error",
        code: ModelicaErrorCode.FUNCTION_MULTIPLE_ALGORITHM.code,
        message: ModelicaErrorCode.FUNCTION_MULTIPLE_ALGORITHM.message(baseName),
        range: fnRange,
      });
    }

    if (!extClause && targetSymId !== fnSymId) {
      const targetCst = db.cstNode(targetSymId) as CstNodeLike | null;
      extClause = findExternalClause(targetCst);
    }

    if (extClause) {
      const extCallNode = extClause.children?.find((c) => c.type === "external_function_call");
      const extCalleeNode = getExternalCallCalleeNode(extCallNode);
      const extCalleeName = extCalleeNode?.text?.trim() ?? "";
      const isCMath = C_MATH_EXTERNAL_FUNCS.has(extCalleeName);

      const langSpecNode = extClause.children?.find(
        (c) => c.type === "language_specification" || c.type === "string_literal",
      );
      let lang: string | null = null;
      if (langSpecNode) {
        lang = stripOuterDoubleQuotes(langSpecNode.text?.trim() ?? "");
      } else {
        const directTokens = (extClause.children || [])
          .filter((c) => c.type !== "external_function_call" && c.type !== "annotation_clause")
          .flatMap((c) => tokenizeCommentStrippedWords(c.text ?? ""));
        if (directTokens[1] === "builtin") {
          lang = "builtin";
        }
      }

      if (lang !== "builtin" && !isCMath && !hasPureFunctionPrefixCst(cst)) {
        fn.isImpure = true;
      }

      const includeVal = findAnnotationStringModificationCst(extClause, "Include");
      if (includeVal !== null) {
        fn.externalInclude = includeVal.replaceAll('\\"', '"').replaceAll("\\n", "\n");
      }

      const extParts: string[] = [];
      for (const ch of extClause.children || []) {
        if (ch.type === "annotation_clause" || ch.type === ";" || ch.text?.trim() === ";") continue;
        const t = ch.text?.trim();
        if (t) extParts.push(t);
      }
      if (!langSpecNode && lang !== "builtin" && extParts[0] === "external") {
        extParts.splice(1, 0, '"C"');
      }
      let extText = extParts.join(" ").trim();
      const hasCall = Boolean(extCallNode) || extText.includes("(");

      // 1. Language specification check
      if (
        lang &&
        lang !== "C" &&
        lang !== "FORTRAN 77" &&
        lang !== "Fortran 77" &&
        lang !== "builtin" &&
        lang !== "none"
      ) {
        const bCst = db.cstNode(targetSymId) as CstNodeLike | null;
        const rangeObj = getClassDiagRange(bCst);
        fn.diagnostics.push({
          severity: "error",
          code: ModelicaErrorCode.EXTERNAL_INVALID_LANGUAGE.code,
          message: ModelicaErrorCode.EXTERNAL_INVALID_LANGUAGE.message(lang),
          range: rangeObj,
        });
      }

      // 2. Check if external function return (explicit LHS) has array type
      let lhsVarName: string | null = null;
      if (extCallNode?.children) {
        const eqIdx = extCallNode.children.findIndex((c) => c.text?.trim() === "=");
        if (eqIdx > 0) {
          const compRef = extCallNode.children
            .slice(0, eqIdx)
            .find((c) => c.type === "component_reference" || c.type === "identifier");
          if (compRef) {
            lhsVarName = compRef.text?.trim() ?? null;
          }
        }
      }
      if (lhsVarName) {
        const vIdx = fn.getVarIdxByName(lhsVarName);
        if (vIdx >= 0) {
          const shape = fn.getVarShape(vIdx);
          if (shape && shape.length > 0) {
            const vt = fn.getVarType(vIdx);
            const vtName = varTypeName(vt);
            const shapeStr = shape.map((s) => (s > 0 ? String(s) : ":")).join(", ");
            const typeStr = `${vtName}[${shapeStr}]`;
            const bCst = db.cstNode(targetSymId) as CstNodeLike | null;
            const rangeObj = getClassDiagRange(bCst);
            fn.diagnostics.push({
              severity: "error",
              code: ModelicaErrorCode.EXTERNAL_ARRAY_RETURN_NOT_ALLOWED.code,
              message: ModelicaErrorCode.EXTERNAL_ARRAY_RETURN_NOT_ALLOWED.message(typeStr),
              range: rangeObj,
            });
          }
        }
      }

      // 3. External function call arguments validation
      const exprListNode = extCallNode?.children?.find(
        (c) => c.type === "expression_list" || c.type === "ExpressionList",
      );
      const argList: { text: string; node?: CstNodeLike }[] = [];
      if (exprListNode?.children) {
        for (const ch of exprListNode.children) {
          if (ch.type === "expression" || (ch.text && ch.text !== "," && ch.text !== "(" && ch.text !== ")")) {
            argList.push({ text: ch.text?.trim() ?? "", node: ch });
          }
        }
      } else {
        const trimmedExt = extText.trimEnd();
        const openParenIdx = trimmedExt.indexOf("(");
        if (openParenIdx >= 0 && trimmedExt.endsWith(")")) {
          const rawArgsStr = trimmedExt.slice(openParenIdx + 1, -1).trim();
          if (rawArgsStr) {
            let depth = 0,
              current = "";
            for (let i = 0; i < rawArgsStr.length; i++) {
              const ch = rawArgsStr[i];
              if (ch === "(" || ch === "{" || ch === "[") depth++;
              else if (ch === ")" || ch === "}" || ch === "]") depth--;
              if (ch === "," && depth === 0) {
                if (current.trim()) argList.push({ text: current.trim() });
                current = "";
              } else {
                current += ch;
              }
            }
            if (current.trim()) argList.push({ text: current.trim() });
          }
        }
      }

      for (const arg of argList) {
        const a = arg.text;
        const isArrayCtor =
          arg.node?.type === "array_constructor" ||
          arg.node?.children?.some((c) => c.type === "array_constructor") ||
          (a.startsWith("{") && a.endsWith("}"));
        if (isArrayCtor) {
          const bCst = db.cstNode(targetSymId) as CstNodeLike | null;
          const rangeObj = getClassDiagRange(bCst);
          fn.diagnostics.push({
            severity: "error",
            code: ModelicaErrorCode.EXTERNAL_INVALID_ARG_EXPR.code,
            message: ModelicaErrorCode.EXTERNAL_INVALID_ARG_EXPR.message(a),
            range: rangeObj,
          });
          break;
        }
        const sizeArgs = extractNamedTwoArgCallCst(arg.node ?? parseStandaloneExpressionCst(a), "size");
        if (sizeArgs && isAsciiIdentifier(sizeArgs[0]?.text?.trim() ?? "")) {
          const dimExpr = sizeArgs[1]?.text?.trim() ?? "";
          const isConstNum = isAsciiDigitsOnly(dimExpr);
          if (!isConstNum) {
            const bCst = db.cstNode(targetSymId) as CstNodeLike | null;
            const rangeObj = getClassDiagRange(bCst);
            fn.diagnostics.push({
              severity: "error",
              code: ModelicaErrorCode.EXTERNAL_INVALID_ARG_SIZE_CONST.code,
              message: ModelicaErrorCode.EXTERNAL_INVALID_ARG_SIZE_CONST.message(a),
              range: rangeObj,
            });
            break;
          }
        }
      }

      if (!hasCall) {
        // Synthesize default external call: [output =] name(inputs) per MLS §12.9.1
        const inputsWithSizes: string[] = [];
        const outputsWithSizes: string[] = [];
        const outputs: string[] = [];
        let singleOutputIsArray = false;
        for (let i = 0; i < fn.varCount; i++) {
          if (fn.isVarRemoved(i)) continue;
          const causality = fn.getVarCausality(i);
          const varName = fn.getVarName(i);
          const shape = fn.getVarShape(i);
          const shapeExprs = fn.getVarShapeExprs?.(i);
          const rank = Math.max(shape?.length ?? 0, shapeExprs?.length ?? 0);
          if (causality === Causality.Input) {
            inputsWithSizes.push(varName);
            for (let d = 1; d <= rank; d++) {
              inputsWithSizes.push(`size(${varName}, ${d})`);
            }
          } else if (causality === Causality.Output) {
            outputs.push(varName);
            if (rank > 0) singleOutputIsArray = true;
            outputsWithSizes.push(varName);
            for (let d = 1; d <= rank; d++) {
              outputsWithSizes.push(`size(${varName}, ${d})`);
            }
          }
        }
        let defaultCall: string;
        if (outputs.length === 1 && !singleOutputIsArray) {
          defaultCall = `${outputs[0]} = ${baseName}(${inputsWithSizes.join(", ")})`;
        } else {
          const allArgs = [...inputsWithSizes, ...outputsWithSizes];
          defaultCall = `${baseName}(${allArgs.join(", ")})`;
        }
        extText = `${extText} ${defaultCall}`.trim();
      }

      if (!extText.endsWith(";")) extText += ";";
      fn.externalDecl = extText;
    }

    const targetFnCst = (db.cstNode(targetSymId) as CstNodeLike | null) ?? cst;
    const derivRawName = findFunctionAnnotationTargetCst(targetFnCst, "derivative");
    if (derivRawName) {
      const scopeToSearch = fnParentId ?? enclosingScopeId ?? targetSymId;
      const resolver =
        db.query<NameResolverFn | null>("resolveName", scopeToSearch) ??
        db.query<NameResolverFn | null>("resolveSimpleName", scopeToSearch);
      const derivSym =
        (fnParentId
          ? db
              .childrenOf(fnParentId)
              ?.find((c) => c.kind === "Class" && c.name === derivRawName && isFunctionSym(db, c))
          : undefined) ??
        resolver?.(derivRawName) ??
        db.byName(derivRawName.split(".").pop()!).find((e) => e.kind === "Class" && isFunctionSym(db, e));
      if (derivSym && !flattener.activeFlatteningFunctionIds.has(derivSym.id)) {
        const derivQualName = getSymbolQualifiedName(db, derivSym.id) || derivSym.name;
        if (!parentDae?.functions.has(derivQualName) && !fn.functions.has(derivQualName)) {
          const derivFn = flattener.flattenFunction(
            derivSym.id,
            derivQualName,
            undefined,
            parentDae ?? fn,
            fnParentId ?? undefined,
          ) as FlattenedFunctionDae;
          derivFn.isDerivativeFunction = true;
          derivFn.wasCalled = true;
          fn.addFunction(derivQualName, derivFn);
          if (parentDae) {
            parentDae.addFunction(derivQualName, derivFn);
          }
          let rootDae: DaeWithParent | undefined =
            (flattener.currentRootDae as DaeWithParent | null | undefined) ?? parentFnDae;
          while (rootDae?.parentDae) rootDae = rootDae.parentDae;
          if (rootDae) {
            rootDae.addFunction(derivQualName, derivFn);
          }
        }
      }
    }

    flattener.extractClassEquations(targetSymId, "", fn, undefined, {
      args: combinedMods,
      ownerClassId: targetSymId,
    });
    const foldScope = enclosingScopeId ?? fnParentId ?? targetSymId;
    foldArenaConstants(fn, db, foldScope, true);

    flattener.checkCyclicFunctionComponents(fn, targetSymId);
    // Check if function returns an ExternalObject (and is not its constructor)
    for (let i = 0; i < fn.varCount; i++) {
      if (!fn.isVarRemoved(i) && fn.getVarCausality(i) === Causality.Output) {
        const compSym = db.childrenOf(targetSymId)?.find((c) => c.name === fn.getVarName(i));
        if (compSym) {
          const compInst = db.query<ComponentInstanceData>("componentInstance", compSym.id);
          const typeName = compInst?.typeSpecifier;
          if (typeName) {
            const resolver =
              db.query<NameResolverFn | null>("resolveName", targetSymId) ??
              db.query<NameResolverFn | null>("resolveSimpleName", targetSymId);
            const targetClass =
              resolver?.(typeName) ?? db.byName(typeName.split(".").pop()!).find((e) => e.kind === "Class");
            if (targetClass) {
              const targetChildren = db.childrenOf(targetClass.id);
              const extendsExtObj = targetChildren?.some((c) => c.kind === "Extends" && c.name === "ExternalObject");
              if (extendsExtObj) {
                const isConstructor =
                  cleanFnName.endsWith(".constructor") || (fn.name === "constructor" && fnParentId === targetClass.id);
                if (!isConstructor) {
                  const fnQName = getSymbolQualifiedName(db, targetSymId);
                  const extObjQName = getSymbolQualifiedName(db, targetClass.id);
                  const bCst = db.cstNode(targetSymId) as FlattenerCstNode | null;
                  const bStart = bCst?.startIndex ?? bCst?.startOffset;
                  const bEnd = bCst?.endIndex ?? bCst?.endOffset;
                  const rangeObj =
                    bCst && bStart !== undefined && bEnd !== undefined
                      ? {
                          startOffset: bStart,
                          endOffset: bEnd,
                          startPosition: bCst.startPosition,
                          endPosition: bCst.endPosition,
                        }
                      : undefined;
                  fn.diagnostics.push({
                    severity: "error",
                    code: ModelicaErrorCode.EXTERNAL_OBJECT_RETURN_RESTRICTION.code,
                    message: ModelicaErrorCode.EXTERNAL_OBJECT_RETURN_RESTRICTION.message(fnQName, extObjQName),
                    range: rangeObj,
                  });
                }
              }
            }
          }
        }
      }
    }

    if (fn.externalDecl && (fn.hasAlgorithmSection || fn.algorithmSections.length > 0)) {
      const bCst = db.cstNode(targetSymId) as FlattenerCstNode | null;
      const bStart = bCst?.startIndex ?? bCst?.startOffset;
      const bEnd = bCst?.endIndex ?? bCst?.endOffset;
      const rangeObj =
        bCst && bStart !== undefined && bEnd !== undefined
          ? {
              startOffset: bStart,
              endOffset: bEnd,
              startPosition: bCst.startPosition,
              endPosition: bCst.endPosition,
            }
          : undefined;
      fn.diagnostics.push({
        severity: "error",
        code: ModelicaErrorCode.EXTERNAL_WITH_ALGORITHM.code,
        message: ModelicaErrorCode.EXTERNAL_WITH_ALGORITHM.message(),
        range: rangeObj,
      });
    }

    const cleanupFrom = (targetDae: FlattenedFunctionDae | undefined) => {
      if (!targetDae) return;
      for (const k of [cleanFnName, fnName, baseName]) {
        if (!k) continue;
        targetDae.functions.delete(k);
        const id = targetDae.interner?.lookup(k);
        if (id !== undefined) targetDae.functions.delete(id);
      }
    };

    if (fn.externalDecl && fn.externalDecl.includes('"builtin"')) {
      const saveBuiltin = (targetDae: FlattenedFunctionDae | undefined) => {
        if (!targetDae) return;
        const map = (targetDae.builtinFunctions ??= new Map<string, DAEBuilder>());
        for (const k of [cleanFnName, fnName, baseName]) {
          if (k) map.set(k, fn);
        }
      };
      saveBuiltin(fn);
      saveBuiltin(parentFnDae);
      cleanupFrom(parentFnDae);
      let rootDae: FlattenedFunctionDae | undefined =
        (flattener.currentRootDae as FlattenedFunctionDae | null | undefined) ?? parentFnDae;
      while (rootDae?.parentDae) rootDae = rootDae.parentDae;
      saveBuiltin(rootDae);
      cleanupFrom(rootDae);
    }

    if (fn.diagnostics.some((d) => d.severity === "error")) {
      cleanupFrom(parentFnDae);
      let rootDae: FlattenedFunctionDae | undefined =
        (flattener.currentRootDae as FlattenedFunctionDae | null | undefined) ?? parentFnDae;
      while (rootDae?.parentDae) rootDae = rootDae.parentDae;
      cleanupFrom(rootDae);
      flattener.failedFunctionIds.add(fnSymId);
      const hasInterfaceError = fn.diagnostics.some(
        (d) =>
          d.severity === "error" &&
          d.code !== ModelicaErrorCode.CYCLIC_FUNCTION_COMPONENTS.code &&
          !d.message.includes("looking for a function or record"),
      );
      if (hasInterfaceError) {
        flattener.invalidInterfaceFunctionIds.add(fnSymId);
      }
    } else {
      if (fnCacheKey && !(fn.externalDecl && fn.externalDecl.includes('"builtin"'))) {
        const cache = (rt._flattenedFunctionCache ??= new Map<string, DAEBuilder>());
        cache.set(fnCacheKey, fn);
      }
      if (parentDae) {
        let rootDae: FlattenedFunctionDae | undefined =
          (flattener.currentRootDae as FlattenedFunctionDae | null | undefined) ?? parentFnDae;
        while (rootDae?.parentDae) rootDae = rootDae.parentDae;
        if (rootDae && rootDae !== parentDae && !(fn.externalDecl && fn.externalDecl.includes('"builtin"'))) {
          rootDae.addFunction(cleanFnName, fn);
          rootDae.addFunction(fnName, fn);
        }
        if (fn.functions && fn.functions.size > 0) {
          if (rootDae) {
            for (const [nestedName, nestedFn] of fn.functions.entries()) {
              if (nestedFn === fn) continue;
              rootDae.addFunction(nestedName, nestedFn);
            }
          }
          for (const [nestedName, nestedFn] of fn.functions.entries()) {
            if (nestedFn === fn) continue;
            parentDae.addFunction(nestedName, nestedFn);
          }
        }
      }
    }

    return fn;
  } finally {
    flattener.currentImports = prevImports;
    flattener.currentFlatteningFunctionId = prevFnId;
    flattener.currentClassId = prevClassId;
    flattener.currentFunctionEnclosingScope = prevEnclosingScope;
    flattener.activeFlatteningFunctionIds.delete(fnSymId);
    flattener.activeLoopVars = prevActiveLoopVars;
    if (rt.state) rt.state.activeLoopVars = flattener.activeLoopVars;
    fn.isBeingFlattened = false;
  }
}

export function generateOperatorFunctions(flattener: ModelicaFlattener, dae: DAEBuilder): void {
  if (!flattener.usedOperatorFunctions || flattener.usedOperatorFunctions.size === 0) return;
  const processed = new Set<string>();
  while (processed.size < flattener.usedOperatorFunctions.size) {
    const entries = Array.from(flattener.usedOperatorFunctions.entries());
    for (const [qualName, symId] of entries) {
      if (processed.has(qualName)) continue;
      processed.add(qualName);
      if (!dae.functions.has(qualName)) {
        const fn = flattener.flattenFunction(symId, qualName, undefined, dae);
        dae.addFunction(qualName, fn);
      }
    }
  }
}

export function generateFunctions(flattener: ModelicaFlattener, rootClassId: SymbolId, dae: DAEBuilder): void {
  const db: QueryDB = flattener.db;
  const rootSym = db.symbol(rootClassId);
  if (!rootSym) return;

  // 1. Member functions inside rootClassId
  const childClasses = db.childrenOf(rootClassId).filter((c) => c.kind === "Class");
  for (const cc of childClasses) {
    if (isFunctionSym(db, cc)) {
      const qualifiedName = `${dae.name}.${cc.name}`;
      const fn = flattener.flattenFunction(cc.id, qualifiedName, undefined, dae) as FlattenedFunctionDae;
      if (fn.diagnostics.some((d) => d.severity === "error")) {
        for (const d of fn.diagnostics) {
          if (!dae.diagnostics.some((existing) => existing.message === d.message)) {
            (d as DaeDiagnosticWithOrigin).fromFunction = true;
            dae.diagnostics.push(d);
          }
        }
        flattener.failedFunctionIds.add(cc.id);
      } else if (!(fn.externalDecl && fn.externalDecl.includes('"builtin"'))) {
        fn.isNestedMember = true;
        fn.symId = cc.id;
        if (flattener.calledFunctionSymIds.has(cc.id)) {
          fn.wasCalled = true;
        }
        dae.addFunction(qualifiedName, fn);
        dae.addFunction(cc.name, fn);
      }
    }
  }

  // 2. Short class specifiers or base class redeclarations on rootClassId
  const rootMod = db.query<EffectiveModLike | null>("effectiveModification", rootClassId);
  if (rootMod?.args) {
    for (const arg of rootMod.args) {
      if (arg.isRedeclaration && arg.redeclaredTypeSpecifier) {
        const target = db.byName(arg.redeclaredTypeSpecifier).find((e) => e.kind === "Class");
        if (target && isFunctionSym(db, target)) {
          const qualifiedName = `${dae.name}.${arg.name}`;
          const fn = flattener.flattenFunction(
            target.id,
            qualifiedName,
            arg.nestedArgs as ModArgLike[] | undefined,
            dae,
          ) as FlattenedFunctionDae;
          if (fn.diagnostics.some((d) => d.severity === "error")) {
            for (const d of fn.diagnostics) {
              if (!dae.diagnostics.some((existing) => existing.message === d.message)) {
                (d as DaeDiagnosticWithOrigin).fromFunction = true;
                dae.diagnostics.push(d);
              }
            }
            flattener.failedFunctionIds.add(target.id);
          } else {
            fn.symId = target.id;
            dae.addFunction(qualifiedName, fn);
            dae.addFunction(arg.name, fn);
          }
        }
      }
    }
  }

  const addFunctionsFromBase = (base: SymbolEntry) => {
    const baseFuncs = db.childrenOf(base.id).filter((c) => c.kind === "Class" && isFunctionSym(db, c));
    for (const bf of baseFuncs) {
      const matchingRedecl = rootMod?.args?.find((a) => a.isRedeclaration && a.name === bf.name);
      if (!matchingRedecl) {
        const qualifiedName = `${dae.name}.${bf.name}`;
        if (!dae.functions.has(qualifiedName)) {
          const fn = flattener.flattenFunction(bf.id, qualifiedName, undefined, dae) as FlattenedFunctionDae;
          if (fn.diagnostics.some((d) => d.severity === "error")) {
            for (const d of fn.diagnostics) {
              if (!dae.diagnostics.some((existing) => existing.message === d.message)) {
                (d as DaeDiagnosticWithOrigin).fromFunction = true;
                dae.diagnostics.push(d);
              }
            }
            flattener.failedFunctionIds.add(bf.id);
          } else {
            fn.symId = bf.id;
            dae.addFunction(qualifiedName, fn);
            dae.addFunction(bf.name, fn);
          }
        }
      }
    }
  };

  const collectBaseFunctions = (classId: SymbolId, visited: Set<SymbolId> = new Set()) => {
    if (visited.has(classId)) return;
    visited.add(classId);

    const directBase = db.query<SymbolEntry | null>("resolvedBaseClass", classId);
    if (directBase) {
      addFunctionsFromBase(directBase);
      collectBaseFunctions(directBase.id, visited);
    }

    const extendsChildren = db.childrenOf(classId).filter((c) => c.kind === "Extends");
    for (const ext of extendsChildren) {
      const base = db.query<SymbolEntry | null>("resolvedBaseClass", ext.id);
      if (base) {
        addFunctionsFromBase(base);
        collectBaseFunctions(base.id, visited);
      } else {
        const byNameBase = db.byName(ext.name).find((e) => e.kind === "Class");
        if (byNameBase) {
          addFunctionsFromBase(byNameBase);
          collectBaseFunctions(byNameBase.id, visited);
        }
      }
    }
  };

  collectBaseFunctions(rootClassId);

  // 3. Top-level functions in the same file that are referenced in rootClassId
  if (rootSym.resourceId && !isScopeEncapsulated(db, rootClassId)) {
    const fileClasses = (db.childrenOf(null) ?? []).filter(
      (s) => s.resourceId === rootSym.resourceId && s.kind === "Class" && s.id !== rootClassId,
    );
    const rootCst = db.cstNode(rootClassId) as CstNodeLike | null;
    const { calledNames, shortFuncTargets } = collectCstFunctionRefs(rootCst);
    for (const fc of fileClasses) {
      if (isFunctionSym(db, fc)) {
        const isShortFuncTarget = shortFuncTargets.has(fc.name);
        const isCalled = calledNames.has(fc.name);
        if (isCalled && !isShortFuncTarget) {
          const fn = flattener.flattenFunction(fc.id, fc.name, undefined, dae);
          if (fn.diagnostics.some((d) => d.severity === "error")) {
            for (const d of fn.diagnostics) {
              if (!dae.diagnostics.some((existing) => existing.message === d.message)) {
                (d as DaeDiagnosticWithOrigin).fromFunction = true;
                dae.diagnostics.push(d);
              }
            }
            flattener.failedFunctionIds.add(fc.id);
          } else if (!(fn.externalDecl && fn.externalDecl.includes('"builtin"'))) {
            dae.addFunction(fc.name, fn);
          }
        }
      } else {
        const childFuncs = (db.childrenOf(fc.id) ?? []).filter((c) => c.kind === "Class" && isFunctionSym(db, c));
        for (const cf of childFuncs) {
          const qualName = `${fc.name}.${cf.name}`;
          const isQualCalled = calledNames.has(qualName);
          if (isQualCalled && !dae.functions.has(qualName)) {
            const fn = flattener.flattenFunction(cf.id, qualName, undefined, dae) as FlattenedFunctionDae;
            if (
              !fn.diagnostics.some((d) => d.severity === "error") &&
              !(fn.externalDecl && fn.externalDecl.includes('"builtin"'))
            ) {
              fn.wasCalled = true;
              dae.addFunction(qualName, fn);
            }
          }
        }
      }
    }
  }
}

function addNormalizedCalleeVariants(rawCallee: string | undefined, calledNames: Set<string>): void {
  if (!rawCallee) return;
  const cleaned = stripAsciiWhitespace(rawCallee);
  if (!cleaned) return;
  const normalized = cleaned.startsWith(".") ? cleaned.slice(1) : cleaned;
  calledNames.add(normalized);
  let dotIdx = normalized.indexOf(".");
  while (dotIdx >= 0) {
    const tail = normalized.slice(dotIdx + 1);
    if (tail) calledNames.add(tail);
    dotIdx = normalized.indexOf(".", dotIdx + 1);
  }
}

function addNormalizedRefVariants(rawRef: string | undefined, referencedPaths: Set<string>): void {
  if (!rawRef) return;
  const cleaned = stripArraySubscripts(stripLeadingDots(stripAsciiWhitespace(rawRef)));
  if (!cleaned) return;
  const parts = cleaned.split(".").filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    for (let j = i + 1; j <= parts.length; j++) {
      referencedPaths.add(parts.slice(i, j).join("."));
    }
  }
}

function collectCstFunctionRefs(rootCst: CstNodeLike | null | undefined): {
  calledNames: Set<string>;
  shortFuncTargets: Set<string>;
  referencedPaths: Set<string>;
} {
  const calledNames = new Set<string>();
  const shortFuncTargets = new Set<string>();
  const referencedPaths = new Set<string>();
  if (!rootCst) return { calledNames, shortFuncTargets, referencedPaths };

  const stack: CstNodeLike[] = [rootCst];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    const t = node.type;
    const children: CstNodeLike[] = node.children || [];

    if (t === "component_reference" || t === "name" || t === "type_specifier") {
      addNormalizedRefVariants(node.text, referencedPaths);
    }

    if (t === "function_call") {
      const calleeNode =
        node.childForFieldName?.("name") ??
        node.childForFieldName?.("callee") ??
        children.find((c) => c.type === "component_reference" || c.type === "name" || c.type === "identifier");
      addNormalizedCalleeVariants(calleeNode?.text, calledNames);
    } else if (t === "external_function_call") {
      const calleeNode = children.find((c) => c.type === "identifier" || c.type === "component_reference");
      addNormalizedCalleeVariants(calleeNode?.text, calledNames);
    } else if (
      (t === "class_definition" || t === "short_class_definition") &&
      children.some(
        (c) => c.type === "class_prefixes" && tokenizeCommentStrippedWords(c.text ?? "").includes("function"),
      )
    ) {
      const shortSpec = getShortClassSpecifierNode(node as Parameters<typeof getShortClassSpecifierNode>[0]);
      if (shortSpec) {
        const typeSpec =
          Cst.ShortClassSpecifier.typeSpecifier(shortSpec as SyntaxNode) ??
          shortSpec.children?.find((c: CstNodeLike) => c.type === "type_specifier" || c.type === "name");
        const target = typeSpec?.text?.trim();
        if (target) {
          const clean = target.startsWith(".") ? target.slice(1) : target;
          shortFuncTargets.add(clean);
          const firstSeg = clean.split(".")[0]?.split("[")[0]?.trim();
          if (firstSeg) shortFuncTargets.add(firstSeg);
        }
      }
    } else if (children.length >= 2) {
      for (let i = 0; i + 1 < children.length; i++) {
        const c = children[i];
        const next = children[i + 1];
        if (
          next?.type === "function_call_args" &&
          (c?.type === "component_reference" || c?.type === "name" || c?.type === "identifier")
        ) {
          addNormalizedCalleeVariants(c.text, calledNames);
        }
      }
    }

    for (let i = children.length - 1; i >= 0; i--) {
      if (children[i]) stack.push(children[i]!);
    }
  }

  return { calledNames, shortFuncTargets, referencedPaths };
}

export function generateExternalObjectFunctions(
  flattener: ModelicaFlattener,
  dae: DAEBuilder,
  rootClassId?: SymbolId,
): void {
  const rt = flattener as FlattenerWithFnRuntime;
  const daeFn = dae as FlattenedFunctionDae;
  const db: QueryDB = flattener.db;
  // In WASM mode, ExternalObject components are lowered as Integer without customType;
  // discover them from the class hierarchy, restore customType, and register usedExternalObjects.
  const rootId = rootClassId ?? rt.state?.rootClassId ?? daeFn.rootClassId;
  const isExtObjClass = (sym: SymbolEntry): boolean =>
    db.childrenOf(sym.id).some((c) => c.kind === "Extends" && c.name === "ExternalObject");
  if (rootId) {
    const visited = new Set<string>();
    const walkExtObjComps = (clsId: SymbolId, prefix: string, depth: number): void => {
      const key = `${clsId}:${prefix}`;
      if (depth > 6 || visited.has(key)) return;
      visited.add(key);
      const elems = db.query<SymbolId[]>("instantiate", clsId) ?? [];
      const comps =
        elems.length > 0
          ? elems.map((id) => db.symbol(id)).filter((s): s is SymbolEntry => Boolean(s && s.kind === "Component"))
          : (db.childrenOf(clsId) || []).filter((s) => s && s.kind === "Component");
      for (const comp of comps) {
        const cInst = db.query<ComponentInstanceData>("componentInstance", comp.id);
        const typeSpec = cInst?.typeSpecifier ?? (comp.metadata as SymbolMetaLike | undefined)?.typeSpecifier;
        if (!typeSpec) continue;
        const cleanType = typeSpec.includes(".") ? typeSpec.split(".").pop()! : typeSpec;
        const rawTarget = db.query<SymbolId | SymbolEntry | null>("classInstance", comp.id);
        let target: SymbolEntry | null =
          typeof rawTarget === "number" ? (db.symbol(rawTarget) ?? null) : (rawTarget ?? null);
        if (!target) {
          const res =
            (comp.parentId ? db.query<NameResolverFn | null>("resolveName", comp.parentId) : null) ??
            db.query<NameResolverFn | null>("resolveName", clsId);
          target = res?.(typeSpec) ?? res?.(cleanType) ?? db.byName(cleanType).find((e) => e.kind === "Class") ?? null;
        }
        if (!target || target.kind !== "Class") continue;
        const fullVar = prefix ? `${prefix}.${comp.name}` : comp.name;
        if (isExtObjClass(target)) {
          const qual = getSymbolQualifiedName(db, target.id) || target.name;
          flattener.usedExternalObjects.add(target.id);
          let vi = dae.lookupVariable(fullVar);
          if (vi < 0) {
            for (let k = 0; k < dae.varCount; k++) {
              if (dae.getVarName(k) === fullVar) {
                vi = k;
                break;
              }
            }
          }
          if (vi >= 0) {
            dae.setVarCustomType(vi, qual);
            const bindId = dae.getVarBindingExpr(vi) ?? -1;
            if (bindId >= 0 && dae.getExprKind(bindId) === ExprKind.Call) {
              const callee = dae.interner.resolve(dae.getExprData1(bindId));
              if (callee === qual || callee === target.name) {
                const setData1 = (
                  dae.exports as { dae_setExprData1?: (ptr: number, id: number, val: number) => void } | undefined
                )?.dae_setExprData1;
                if (typeof setData1 === "function") {
                  setData1(dae.ptr, bindId, dae.interner.intern(`${qual}.constructor`));
                }
              }
            }
          }
        } else {
          walkExtObjComps(target.id, fullVar, depth + 1);
        }
      }
    };
    walkExtObjComps(rootId, "", 0);
  }
  for (let i = 0; i < dae.varCount; i++) {
    const ct = dae.getVarCustomType(i);
    if (!ct) continue;
    const baseName = ct.includes(".") ? ct.split(".").pop()! : ct;
    for (const cand of db.byName(baseName)) {
      if (cand.kind !== "Class") continue;
      const qual = getSymbolQualifiedName(db, cand.id);
      if (qual !== ct && cand.name !== ct) continue;
      if (isExtObjClass(cand)) {
        flattener.usedExternalObjects.add(cand.id);
      }
    }
  }
  for (const extObjSymId of flattener.usedExternalObjects) {
    const extObjQualName = getSymbolQualifiedName(db, extObjSymId);
    const children = db.childrenOf(extObjSymId);
    for (const child of children) {
      if (child.kind === "Class" && (child.name === "constructor" || child.name === "destructor")) {
        const fnQualName = `${extObjQualName}.${child.name}`;
        if (!dae.functions.has(fnQualName)) {
          const fn = flattener.flattenFunction(child.id, fnQualName, undefined, dae);
          fn.isImpure = true;
          foldArenaConstants(fn, db, child.id, true);
          dae.addFunction(fnQualName, fn);
        }
      }
    }
  }
}

export function propagateImpureFunctions(dae: DAEBuilder): void {
  for (const fn of dae.functions.values()) {
    for (let i = 0; i < fn.varCount; i++) {
      const ct = fn.getVarCustomType(i);
      const isExtObjType = Boolean(
        ct &&
        (ct.includes("ExternalObject") || dae.getFunction(`${ct}.constructor`) || dae.getFunction(`${ct}.destructor`)),
      );
      if (isExtObjType) {
        fn.isImpure = true;
      }
    }
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const fn of dae.functions.values()) {
      const fnTyped = fn as FlattenedFunctionDae;
      for (let i = 0; i < fn.exprCount; i++) {
        if (fn.getExprKind(i) === ExprKind.Call) {
          const calledName = fn.interner.resolve(fn.getExprData1(i));
          if (calledName) {
            const targetFn = (dae.getFunction(calledName) ??
              (calledName.includes(".") ? dae.getFunction(calledName.split(".").pop()!) : undefined)) as
              FlattenedFunctionDae | undefined;
            if (targetFn?.isImpure && !fn.isImpure) {
              fn.isImpure = true;
              changed = true;
            }
            if (targetFn?.isExplicitImpure && !fnTyped.isExplicitImpure) {
              fnTyped.isExplicitImpure = true;
              changed = true;
            }
          }
        }
      }
    }
  }
}

// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Modelica Query Flattener (TypeScript Host Bridge).
 *
 * Coordinates host-side Salsa QueryDB / SymbolIndex data with the high-performance
 * native WebAssembly Semantic Flattening Kernel (`assembly/flattener.ts`).
 */

import type { TopologyGraph } from "@modelscript/diagram";
import { EqKind, ExprKind } from "@modelscript/dsl";
import {
  Causality,
  DAEBuilder,
  eliminateArenaAliases,
  evaluateConstantArenaExpression,
  foldArenaConstants,
  type QueryDB,
  scalarizeArena,
  StmtKind,
  type SymbolEntry,
  type SymbolId,
  UnifiedWorkspace,
  Variability,
  VarType,
} from "@modelscript/runtime";
import { Cst, type SyntaxNode } from "../../src-gen/bindings.js";
import { BUILTIN_FUNCTIONS, BUILTIN_VARIABLES } from "../builtins.js";
import { ModelicaPortBalancer } from "../connections.js";
import { MODELICA_BASE_CONSTANTS, MODELICA_CONSTANTS } from "../constants.js";
import { AnnotationEvaluator } from "../diagram/annotation-evaluator.js";
import { ModelicaErrorCode } from "../errors.js";
import { getShortClassSpecifierNode, isScopeEncapsulated, validateEnumeration } from "../queries.js";
import { emitWasmBailDiagnostic, postWasmValidate } from "./post-wasm-validate.js";

import {
  checkBalance,
  checkCyclicConstantsAndParameters,
  checkCyclicFunctionComponents,
  checkTypeAliasSpecialization,
  classFindMember,
  collectExprVarNames,
  collectExtendsMods,
  collectInheritedTypeModifiers,
  collectProtectedNames,
  emitFunctionCallEquation,
  evaluateCSTToNumber,
  expandConnectorRef,
  extractClassEquations,
  extractDescription,
  extractStateMachines,
  findComponentDeclarationAt,
  findEquationNodeAt,
  flattenFunction,
  generateExternalObjectFunctions,
  generateFunctions,
  generateOperatorFunctions,
  generateRecordConstructorFor,
  generateRecordConstructors,
  getOrCreateWasmEnv,
  instantiateElements,
  isClassType,
  isComponentHidden,
  isCstNodeProtected,
  isExpandableConnectorClass,
  isFunctionSym,
  isInsideExpandableBus,
  isStaticTrueAssert,
  patchIncremental,
  processExpandableConnectors,
  propagateImpureFunctions,
  resolveInnerOuterClass,
  resolveRedeclarationType,
  validateClassModifiers,
  validateComponentBasicAttributes,
  validateFunctionComponentDeclaration,
} from "./elaboration/index.js";
import {
  cstHasError,
  extractEnumLiteralsFromCst,
  extractFunctionCallArgExprNodesCst,
  firstAsciiToken,
  getSymbolQualifiedName,
  isAsciiDigitsOnly,
  isAsciiIdentContinue,
  isAsciiIdentifier,
  isAsciiIdentStart,
  isAsciiWhitespaceCode,
  lowerCSTExpression,
  SCALAR_VECTORIZABLE_FUNCTIONS,
  stripArraySubscripts,
  stripCommentsAndStrings,
  stripLeadingDot,
  stripOuterDoubleQuotes,
  stripOuterSingleQuotes,
  tokenizeCommentStrippedWords,
} from "./expressions/index.js";
import { extractCompilerOptions } from "./support/compiler-options.js";
import { extractAndRegisterFmuMetadata, findDirectAnnotationClause } from "./support/fmu-lowering.js";
import { type DiagnosticRange, getElementDiagRange } from "./support/range-utils.js";
import { type FlatteningState, getFlatteningState } from "./support/state.js";
import {
  describeWasmBail,
  inputEncodingUnitSize,
  type WasmBailInfo,
  WasmBailReason,
} from "./support/wasm-bail-reasons.js";
import { ModelicaModificationEnv } from "./support/wasm-bridge.js";
import type { FlattenerBackend, FlattenOptions } from "./types.js";

interface CstNodeLike {
  type?: string | undefined;
  text?: string | undefined;
  startIndex?: number | undefined;
  endIndex?: number | undefined;
  startOffset?: number | undefined;
  endOffset?: number | undefined;
  startPosition?: { row: number; column: number } | undefined;
  endPosition?: { row: number; column: number } | undefined;
  children?: readonly CstNodeLike[] | null | undefined;
  parent?: CstNodeLike | null | undefined;
}

const TRIVIA_COMMENT_TYPES = new Set(["comment", "line_comment", "block_comment"]);
const PRIMITIVE_TYPE_WORDS = new Set(["Real", "Integer", "Boolean", "String"]);
const CLASS_HEADER_PREFIX_WORDS = new Set([
  "final",
  "inner",
  "outer",
  "redeclare",
  "replaceable",
  "encapsulated",
  "partial",
  "expandable",
  "pure",
  "impure",
  "operator",
  "class",
  "model",
  "record",
  "block",
  "connector",
  "type",
  "package",
  "function",
  "uniontype",
]);

function parseStandaloneMoCst(code: string): SyntaxNode | null {
  const parser = UnifiedWorkspace.getGlobalParser(".mo");
  if (!parser) return null;
  try {
    return parser.parse(code).rootNode;
  } catch {
    return null;
  }
}

function collectCstLeafTokens(
  node: CstNodeLike | null | undefined,
  options?: { skipStrings?: boolean; skipDescription?: boolean },
): CstNodeLike[] {
  const out: CstNodeLike[] = [];
  if (!node) return out;
  const skipStrings = options?.skipStrings ?? true;
  const skipDescription = options?.skipDescription ?? false;
  const visit = (n: CstNodeLike): void => {
    const t = n.type ?? "";
    if (TRIVIA_COMMENT_TYPES.has(t)) return;
    if (skipStrings && (t === "string_literal" || t === "STRING")) return;
    if (skipDescription && (t === "description" || t === "description_string" || t === "annotation_clause")) return;
    if (!Array.isArray(n.children) || n.children.length === 0) {
      if (n.text?.trim()) out.push(n);
      return;
    }
    for (const c of n.children) visit(c);
  };
  visit(node);
  return out;
}

function collectCstLeafTexts(
  node: CstNodeLike | null | undefined,
  options?: { skipStrings?: boolean; skipDescription?: boolean },
): string[] {
  return collectCstLeafTokens(node, options).map((n) => n.text!.trim());
}

function findFirstCstNode(
  node: CstNodeLike | null | undefined,
  predicate: (n: CstNodeLike) => boolean,
): CstNodeLike | null {
  if (!node) return null;
  if (predicate(node)) return node;
  if (Array.isArray(node.children)) {
    for (const c of node.children) {
      const found = findFirstCstNode(c, predicate);
      if (found) return found;
    }
  }
  return null;
}

function consumeStringOrCommentEnd(s: string, i: number): number {
  const ch = s[i];
  if (ch === '"' || ch === "'") {
    let j = i + 1;
    while (j < s.length) {
      if (s[j] === "\\") {
        j += 2;
        continue;
      }
      if (s[j] === ch) return j + 1;
      j++;
    }
    return s.length;
  }
  if (ch === "/" && s[i + 1] === "/") {
    let j = i + 2;
    while (j < s.length && s[j] !== "\n" && s[j] !== "\r") j++;
    return j;
  }
  if (ch === "/" && s[i + 1] === "*") {
    const closeIdx = s.indexOf("*/", i + 2);
    return closeIdx >= 0 ? closeIdx + 2 : s.length;
  }
  return -1;
}

function readAsciiIdentEnd(s: string, i: number): number {
  if (i >= s.length || !isAsciiIdentStart(s.charCodeAt(i))) return i;
  let j = i + 1;
  while (j < s.length && isAsciiIdentContinue(s.charCodeAt(j))) j++;
  return j;
}

function getClassHeaderWordsCst(cst: CstNodeLike | null | undefined): string[] {
  if (!cst) return [];
  if (cst.type === "class_definition" && Array.isArray(cst.children) && cst.children.length > 0) {
    const words: string[] = [];
    for (const ch of cst.children) {
      if (ch.type === "class_specifier") break;
      words.push(...tokenizeCommentStrippedWords(ch.text ?? ""));
    }
    if (words.length > 0) return words;
  }
  const pfxNode =
    Cst.ClassDefinition.classPrefixes(cst as unknown as SyntaxNode) ??
    cst.children?.find((c) => c.type === "class_prefixes");
  if (pfxNode) {
    return tokenizeCommentStrippedWords(pfxNode.text ?? "");
  }
  const leaves = collectCstLeafTexts(cst, { skipStrings: true });
  const words: string[] = [];
  for (const tok of leaves) {
    if (!CLASS_HEADER_PREFIX_WORDS.has(tok)) break;
    words.push(tok);
  }
  return words;
}

function hasClassPrefixWordCst(cst: CstNodeLike | null | undefined, word: string): boolean {
  return getClassHeaderWordsCst(cst).includes(word);
}

function hasOperatorRecordPrefixCst(cst: CstNodeLike | null | undefined): boolean {
  const words = getClassHeaderWordsCst(cst);
  return words.some((w, i) => w === "operator" && words[i + 1] === "record");
}

function cstHasUnqualifiedImportWildcard(importCst: CstNodeLike | null | undefined): boolean {
  const leaves = collectCstLeafTexts(importCst, { skipStrings: true, skipDescription: true });
  return leaves.some((t) => t === "*" || t === ".*");
}

function collectDottedPrefixRootIdentsCst(cst: CstNodeLike | null | undefined): string[] {
  const out: string[] = [];
  if (!cst) return out;
  const leaves = collectCstLeafTexts(cst, { skipStrings: true });
  for (let i = 0; i + 2 < leaves.length; i++) {
    const a = leaves[i]!;
    if (isAsciiIdentifier(a) && leaves[i + 1] === "." && isAsciiIdentifier(leaves[i + 2]!)) {
      out.push(a);
    }
  }
  return out;
}

function cstHasKeywordToken(cst: CstNodeLike | null | undefined, keyword: string): boolean {
  if (!cst) return false;
  const t = cst.type ?? "";
  if (TRIVIA_COMMENT_TYPES.has(t) || t === "string_literal" || t === "STRING") return false;
  if (!Array.isArray(cst.children) || cst.children.length === 0) {
    return cst.text?.trim() === keyword;
  }
  for (const c of cst.children) {
    if (cstHasKeywordToken(c, keyword)) return true;
  }
  return false;
}

function hasUnsupportedTypeOrConnectorAliasCst(cst: CstNodeLike | null | undefined): boolean {
  if (!cst) return false;
  let found = false;
  const visit = (n: CstNodeLike): void => {
    if (found) return;
    if (n.type === "class_definition") {
      const words = getClassHeaderWordsCst(n);
      const isTypeOrConnector = words.includes("connector") || words.includes("type");
      if (isTypeOrConnector) {
        const shortSpec = getShortClassSpecifierNode(n as unknown as SyntaxNode);
        if (shortSpec && cstHasError(shortSpec)) {
          found = true;
          return;
        }
      }
    }
    for (const c of n.children ?? []) visit(c);
  };
  visit(cst);
  return found;
}

function hasNonStandardEnumKeywordCst(cst: CstNodeLike | null | undefined): boolean {
  const leaves = collectCstLeafTexts(cst, { skipStrings: true });
  for (let i = 0; i + 2 < leaves.length; i++) {
    if (
      leaves[i] === "enum" &&
      isAsciiIdentifier(leaves[i + 1]!) &&
      (leaves[i + 2] === "(" || leaves[i + 2] === "=" || leaves[i + 2] === ";")
    ) {
      return true;
    }
  }
  return false;
}

function hasConnectionsOrEqualityConstraintCst(cst: CstNodeLike | null | undefined): boolean {
  const leaves = collectCstLeafTexts(cst, { skipStrings: true });
  for (let i = 0; i < leaves.length; i++) {
    if (leaves[i] === "equalityConstraint") return true;
    if (
      i + 2 < leaves.length &&
      leaves[i] === "Connections" &&
      leaves[i + 1] === "." &&
      isAsciiIdentifier(leaves[i + 2]!)
    ) {
      return true;
    }
  }
  return false;
}

function cstHasWholeSliceAssign(cst: CstNodeLike | null | undefined): boolean {
  const leaves = collectCstLeafTexts(cst, { skipStrings: true });
  for (let i = 0; i < leaves.length; i++) {
    if (
      i + 3 < leaves.length &&
      leaves[i] === "[" &&
      leaves[i + 1] === ":" &&
      leaves[i + 2] === "]" &&
      leaves[i + 3] === "="
    ) {
      return true;
    }
    if (i + 1 < leaves.length && leaves[i] === "[:]" && leaves[i + 1] === "=") {
      return true;
    }
  }
  return false;
}

function isDecimalFloatTokenText(s: string): boolean {
  const dotIdx = s.indexOf(".");
  if (dotIdx <= 0 || dotIdx >= s.length - 1) return false;
  const intPart = s.slice(0, dotIdx);
  if (!isAsciiDigitsOnly(intPart)) return false;
  return s.charCodeAt(dotIdx + 1) >= 48 && s.charCodeAt(dotIdx + 1) <= 57;
}

function cstHasFloatFillArg(cst: CstNodeLike | null | undefined): boolean {
  if (!cst) return false;
  let found = false;
  const visit = (n: CstNodeLike): void => {
    if (found) return;
    if (
      n.type === "function_call" ||
      (n.type === "primary" && n.children?.some((c) => c.type === "function_call_args"))
    ) {
      const callee = n.children?.find((c) => c.type === "component_reference" || c.type === "identifier");
      if (callee?.text?.trim() === "fill") {
        const argNodes = extractFunctionCallArgExprNodesCst(n as unknown as SyntaxNode);
        if (argNodes.length >= 2) {
          const arg2Leaves = collectCstLeafTexts(argNodes[1], { skipStrings: true });
          if (arg2Leaves.some((t) => isDecimalFloatTokenText(t))) {
            found = true;
            return;
          }
        }
      }
    }
    for (const c of n.children ?? []) visit(c);
  };
  visit(cst);
  if (found) return true;
  // Token-level fallback if call wasn't structured
  const leaves = collectCstLeafTexts(cst, { skipStrings: true });
  for (let i = 0; i + 4 < leaves.length; i++) {
    if (leaves[i] === "fill" && leaves[i + 1] === "(") {
      let depth = 1;
      let argIdx = 0;
      for (let j = i + 2; j < leaves.length && depth > 0; j++) {
        const t = leaves[j]!;
        if (t === "(") depth++;
        else if (t === ")") depth--;
        else if (t === "," && depth === 1) argIdx++;
        else if (depth === 1 && argIdx === 1 && isDecimalFloatTokenText(t)) return true;
      }
    }
  }
  return false;
}

function cstHasExternalLanguage(cst: CstNodeLike | null | undefined, lang: string): boolean {
  if (!cst) return false;
  const want = lang.toLowerCase();
  let found = false;
  const visit = (n: CstNodeLike): void => {
    if (found) return;
    if (n.type === "external_clause") {
      const langNode = n.children?.find(
        (c) => c.type === "language_specification" || c.type === "string_literal" || c.type === "STRING",
      );
      if (langNode && stripOuterDoubleQuotes(langNode.text?.trim() ?? "").toLowerCase() === want) {
        found = true;
        return;
      }
    }
    for (const c of n.children ?? []) visit(c);
  };
  visit(cst);
  if (found) return true;
  const leaves = collectCstLeafTexts(cst, { skipStrings: false });
  for (let i = 0; i + 1 < leaves.length; i++) {
    if (leaves[i] === "external" && leaves[i + 1]!.startsWith('"')) {
      if (stripOuterDoubleQuotes(leaves[i + 1]!).toLowerCase() === want) return true;
    }
  }
  return false;
}

function cstHasLeadingDotAfterEqOrParen(cst: CstNodeLike | null | undefined): boolean {
  const leaves = collectCstLeafTexts(cst, { skipStrings: true });
  for (let i = 0; i + 1 < leaves.length; i++) {
    if (leaves[i] !== "=" && leaves[i] !== "(") continue;
    const next = leaves[i + 1]!;
    if (next === "." && i + 2 < leaves.length && isAsciiIdentifier(leaves[i + 2]!)) {
      return true;
    }
    if (next.startsWith(".") && isAsciiIdentifier(next.slice(1))) {
      return true;
    }
  }
  return false;
}

function cstHasComponentMethodCall(cst: CstNodeLike | null | undefined, compNames: Set<string>): boolean {
  const leaves = collectCstLeafTexts(cst, { skipStrings: true });
  for (let i = 0; i + 3 < leaves.length; i++) {
    if (
      compNames.has(leaves[i]!) &&
      leaves[i + 1] === "." &&
      isAsciiIdentifier(leaves[i + 2]!) &&
      leaves[i + 3] === "("
    ) {
      return true;
    }
  }
  return false;
}

function cstHasEqualsRhsIdent(cst: CstNodeLike | null | undefined, idents: Set<string>): boolean {
  const leaves = collectCstLeafTexts(cst, { skipStrings: true });
  for (let i = 0; i + 1 < leaves.length; i++) {
    if (leaves[i] === "=" && idents.has(leaves[i + 1]!)) {
      return true;
    }
  }
  return false;
}

function cstHasExternalBuiltinOrDerivative(cst: CstNodeLike | null | undefined): boolean {
  if (!cst) return false;
  if (cstHasExternalLanguage(cst, "builtin")) return true;
  let found = false;
  const visit = (n: CstNodeLike): void => {
    if (found) return;
    if (n.type === "element_modification") {
      const nameNode = n.children?.find((c) => c.type === "name" || c.type === "identifier");
      if (nameNode?.text?.trim() === "derivative") {
        found = true;
        return;
      }
    }
    for (const c of n.children ?? []) visit(c);
  };
  visit(cst);
  return found;
}

function optStringContainsFlag(rawOpt: string, flag: string): boolean {
  const unquoted = stripOuterDoubleQuotes(rawOpt.trim());
  let start = 0;
  for (let i = 0; i <= unquoted.length; i++) {
    const ch = unquoted[i];
    if (i === unquoted.length || ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === ",") {
      if (i > start && unquoted.slice(start, i) === flag) return true;
      start = i + 1;
    }
  }
  return false;
}

function cstDirectNodeHasCommandLineFlag(node: CstNodeLike, flag: string, stopAtNestedClasses: boolean): boolean {
  const visit = (n: CstNodeLike): boolean => {
    if (stopAtNestedClasses && n !== node && n.type === "class_definition") return false;
    if (n.type === "element_modification") {
      const nameNode = n.children?.find((c) => c.type === "name" || c.type === "identifier");
      if (nameNode?.text?.trim() === "__OpenModelica_commandLineOptions") {
        const modNode = n.children?.find((c) => c.type === "modification" || c.type === "modification_expression");
        const strNode = findFirstCstNode(modNode ?? n, (c) => c.type === "string_literal" || c.type === "STRING");
        if (strNode?.text && optStringContainsFlag(strNode.text, flag)) {
          return true;
        }
      }
    }
    for (const c of n.children ?? []) {
      if (visit(c)) return true;
    }
    return false;
  };
  return visit(node);
}

function hasCommandLineFlagInCst(cst: CstNodeLike | null | undefined, flag: string): boolean {
  if (!cst) return false;
  return cstDirectNodeHasCommandLineFlag(cst, flag, true);
}

function hasNestedCommandLineFlagCst(cst: CstNodeLike | null | undefined, flag: string): boolean {
  if (!cst) return false;
  let found = false;
  const visit = (n: CstNodeLike): void => {
    if (found) return;
    if (n !== cst && n.type === "class_definition") {
      if (cstDirectNodeHasCommandLineFlag(n, flag, false)) {
        found = true;
        return;
      }
      return;
    }
    for (const c of n.children ?? []) visit(c);
  };
  visit(cst);
  return found;
}

function findRedeclareTypeSpecRangeCst(
  rootCst: CstNodeLike | null | undefined,
  name: string,
  redeclaredTypeSpecifier: string,
): DiagnosticRange | undefined {
  if (!rootCst) return undefined;
  const cleanSpec = stripLeadingDot(redeclaredTypeSpecifier);
  let matchedNode: CstNodeLike | null = null;
  const visit = (n: CstNodeLike): void => {
    if (matchedNode) return;
    if (n.type === "element_redeclaration") {
      const leaves = collectCstLeafTexts(n, { skipStrings: true });
      const redeclIdx = leaves.indexOf("redeclare");
      const typeIdx = redeclIdx >= 0 ? leaves.indexOf("type", redeclIdx + 1) : -1;
      const eqIdx = typeIdx >= 0 ? leaves.indexOf("=", typeIdx + 1) : -1;
      const nameIdx = typeIdx >= 0 ? leaves.indexOf(name, typeIdx + 1) : -1;
      const hasBlockingToken =
        typeIdx > redeclIdx &&
        leaves
          .slice(redeclIdx + 1, typeIdx)
          .some(
            (tok) =>
              tok === "=" ||
              tok === ";" ||
              tok === "function" ||
              tok === "model" ||
              tok === "block" ||
              tok === "record" ||
              tok === "connector" ||
              tok === "package",
          );
      if (!hasBlockingToken && nameIdx > typeIdx && (eqIdx < 0 || nameIdx < eqIdx)) {
        const typeNode = findFirstCstNode(n, (c) => {
          if (c.type !== "type_specifier" && c.type !== "name") return false;
          const t = stripLeadingDot(c.text?.trim() ?? "");
          return t === cleanSpec || t.endsWith(`.${cleanSpec}`);
        });
        if (typeNode) {
          matchedNode = n;
          return;
        }
      }
    }
    for (const c of n.children ?? []) visit(c);
  };
  visit(rootCst);
  return matchedNode ? getElementDiagRange(matchedNode) : undefined;
}

function findRedeclareSameNameRangeCst(
  extCst: CstNodeLike | null | undefined,
  name: string,
): DiagnosticRange | undefined {
  if (!extCst) return undefined;
  let matched: CstNodeLike | null = null;
  const visit = (n: CstNodeLike): void => {
    if (matched) return;
    if (n.type === "element_redeclaration") {
      const leaves = collectCstLeafTexts(n, { skipStrings: true });
      if (leaves.includes(name)) {
        matched = n;
        return;
      }
    }
    for (const c of n.children ?? []) visit(c);
  };
  visit(extCst);
  return getElementDiagRange(matched ?? extCst);
}

function stripTrailingSemicolon(s: string): string {
  const trimmed = s.trim();
  return trimmed.endsWith(";") ? trimmed.slice(0, -1).trimEnd() : trimmed;
}

function sliceIfMatchesNodeText(wrapped: string, node: CstNodeLike | null | undefined): [number, number] | null {
  if (!node) return null;
  const s = node.startIndex ?? node.startOffset;
  const e = node.endIndex ?? node.endOffset;
  if (typeof s !== "number" || typeof e !== "number") return null;
  if (wrapped.slice(s, e) !== (node.text ?? "")) return null;
  return [s, e];
}

function findComponentClausePartsInText(text: string): {
  wrapped: string;
  base: string;
  typeSpec: [number, number];
  typeArr: [number, number] | null;
  compIdent: [number, number];
  compArr: [number, number] | null;
} | null {
  const base = stripTrailingSemicolon(text);
  const prefix = "model _M\n  ";
  const wrapped = `${prefix}${base};\nend _M;`;
  const root = parseStandaloneMoCst(wrapped);
  if (!root) return null;
  const clause = findFirstCstNode(root, (n) => n.type === "component_clause" || n.type === "component_clause1");
  if (!clause || cstHasError(clause as unknown as SyntaxNode)) return null;
  const typeSpecNode = clause.children?.find((c) => c.type === "type_specifier");
  const typeArrNode = clause.children?.find((c) => c.type === "array_subscripts") ?? null;
  const declNode = findFirstCstNode(clause, (n) => n.type === "declaration");
  const identNode = declNode?.children?.find((c) => c.type === "identifier") ?? null;
  const compArrNode = declNode?.children?.find((c) => c.type === "array_subscripts") ?? null;
  const ts = sliceIfMatchesNodeText(wrapped, typeSpecNode);
  const ci = sliceIfMatchesNodeText(wrapped, identNode);
  if (!ts || !ci) return null;
  const ta = sliceIfMatchesNodeText(wrapped, typeArrNode);
  const ca = sliceIfMatchesNodeText(wrapped, compArrNode);
  return { wrapped, base, typeSpec: ts, typeArr: ta, compIdent: ci, compArr: ca };
}

function mergeArrayDimText(firstDim: string, secondDim: string): string {
  const a = firstDim.trim();
  const b = secondDim.trim();
  if (a.startsWith("[") && a.endsWith("]") && b.startsWith("[") && b.endsWith("]")) {
    return `[${a.slice(1, -1)}, ${b.slice(1, -1)}]`;
  }
  return `${a}${b}`;
}

function moveTypeArrayDimToCompName(text: string): string {
  const info = findComponentClausePartsInText(text);
  if (!info || !info.typeArr) return text;
  const [taS, taE] = info.typeArr;
  const [ciS, ciE] = info.compIdent;
  if (taE > ciS) return text;
  const typeDimTxt = info.wrapped.slice(taS, taE);
  const pLen = "model _M\n  ".length;
  const relTaS = taS - pLen;
  const relTaE = taE - pLen;
  const relCiE = ciE - pLen;
  if (!info.compArr) {
    const before = info.base.slice(0, relTaS).trimEnd();
    const mid = info.base.slice(relTaE, relCiE).trimStart();
    const after = info.base.slice(relCiE);
    return `${before} ${mid}${typeDimTxt}${after}`;
  }
  const [caS, caE] = info.compArr;
  const relCaS = caS - pLen;
  const relCaE = caE - pLen;
  const compDimTxt = info.wrapped.slice(caS, caE);
  const before = info.base.slice(0, relTaS).trimEnd();
  const mid = info.base.slice(relTaE, relCaS).trimStart();
  const after = info.base.slice(relCaE);
  return `${before} ${mid}${mergeArrayDimText(typeDimTxt, compDimTxt)}${after}`;
}

function moveCompArrayDimToTypeName(text: string): string {
  const info = findComponentClausePartsInText(text);
  if (!info || !info.compArr) return text;
  const [, tsE] = info.typeSpec;
  const [caS, caE] = info.compArr;
  if (tsE > caS) return text;
  const compDimTxt = info.wrapped.slice(caS, caE);
  const pLen = "model _M\n  ".length;
  const relTsE = tsE - pLen;
  const relCaS = caS - pLen;
  const relCaE = caE - pLen;
  if (!info.typeArr) {
    return `${info.base.slice(0, relTsE)}${compDimTxt}${info.base.slice(relTsE, relCaS)}${info.base.slice(relCaE)}`;
  }
  const [taS, taE] = info.typeArr;
  const relTaS = taS - pLen;
  const relTaE = taE - pLen;
  const typeDimTxt = info.wrapped.slice(taS, taE);
  return `${info.base.slice(0, relTaS)}${mergeArrayDimText(typeDimTxt, compDimTxt)}${info.base.slice(relTaE, relCaS)}${info.base.slice(relCaE)}`;
}

function replaceAliasDotPrefix(text: string, alias: string, target: string): { text: string; changed: boolean } {
  let out = "";
  let changed = false;
  let i = 0;
  while (i < text.length) {
    const skipEnd = consumeStringOrCommentEnd(text, i);
    if (skipEnd > i) {
      out += text.slice(i, skipEnd);
      i = skipEnd;
      continue;
    }
    const idEnd = readAsciiIdentEnd(text, i);
    if (idEnd > i) {
      const word = text.slice(i, idEnd);
      const prevChar = i > 0 ? text[i - 1] : "";
      if (word === alias && prevChar !== "." && text[idEnd] === ".") {
        out += target;
        changed = true;
      } else {
        out += word;
      }
      i = idEnd;
      continue;
    }
    out += text[i]!;
    i++;
  }
  return { text: changed ? out : text, changed };
}

function startsWithPrimitiveTypeWord(text: string): boolean {
  const trimmed = text.trimStart();
  const tok = firstAsciiToken(trimmed);
  return PRIMITIVE_TYPE_WORDS.has(tok) && trimmed[tok.length] !== ".";
}

function dotPrefixPrimitiveTypeWords(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const skipEnd = consumeStringOrCommentEnd(text, i);
    if (skipEnd > i) {
      out += text.slice(i, skipEnd);
      i = skipEnd;
      continue;
    }
    const idEnd = readAsciiIdentEnd(text, i);
    if (idEnd > i) {
      const word = text.slice(i, idEnd);
      const prevChar = i > 0 ? text[i - 1] : "";
      if (PRIMITIVE_TYPE_WORDS.has(word) && prevChar !== ".") {
        out += `.${word}`;
      } else {
        out += word;
      }
      i = idEnd;
      continue;
    }
    out += text[i]!;
    i++;
  }
  return out;
}

function startsWithDottedIdentifierPair(text: string): boolean {
  let i = 0;
  while (i < text.length && isAsciiWhitespaceCode(text.charCodeAt(i))) i++;
  if (i >= text.length || text[i] === ".") return false;
  const end1 = readAsciiIdentEnd(text, i);
  if (end1 === i || text[end1] !== ".") return false;
  const end2 = readAsciiIdentEnd(text, end1 + 1);
  return end2 > end1 + 1;
}

function formatParenModArgEquals(text: string): string {
  let out = "";
  let depth = 0;
  let i = 0;
  while (i < text.length) {
    const skipEnd = consumeStringOrCommentEnd(text, i);
    if (skipEnd > i) {
      out += text.slice(i, skipEnd);
      i = skipEnd;
      continue;
    }
    const ch = text[i]!;
    if (ch === "(") {
      depth++;
      out += ch;
      i++;
      continue;
    }
    if (ch === ")") {
      if (depth > 0) depth--;
      out += ch;
      i++;
      continue;
    }
    if (depth > 0 && ch === "=") {
      const prev = i > 0 ? text[i - 1]! : "";
      const next = text[i + 1] ?? "";
      if (prev !== "=" && prev !== "!" && prev !== "<" && prev !== ">" && prev !== ":" && next !== "=") {
        while (out.length > 0 && (out[out.length - 1] === " " || out[out.length - 1] === "\t")) {
          out = out.slice(0, -1);
        }
        out += " = ";
        i++;
        while (i < text.length && (text[i] === " " || text[i] === "\t")) i++;
        continue;
      }
    }
    out += ch;
    i++;
  }
  return out;
}

function parseComponentDeclTokensCst(
  rawFallback: string,
  stripDescAndAnn: boolean,
  isTrivialTrueCond: (n: CstNodeLike | null | undefined) => boolean,
): string[] | null {
  const base = stripTrailingSemicolon(rawFallback);
  if (!base) return null;
  const root = parseStandaloneMoCst(`model _M\n  ${base};\nend _M;`);
  if (!root) return null;
  const clause = findFirstCstNode(root, (n) => n.type === "component_clause" || n.type === "component_clause1");
  if (!clause || cstHasError(clause as unknown as SyntaxNode)) return null;
  const tokens: string[] = [];
  const collect = (n: CstNodeLike): void => {
    const t = n.type ?? "";
    if (TRIVIA_COMMENT_TYPES.has(t)) return;
    if (isTrivialTrueCond(n)) return;
    if (
      stripDescAndAnn &&
      (t === "comment" ||
        t === "Comment" ||
        t === "string_comment" ||
        t === "StringComment" ||
        t === "description" ||
        t === "Description" ||
        t === "description_string" ||
        t === "DescriptionString" ||
        t === "annotation" ||
        t === "Annotation" ||
        t === "annotation_clause")
    ) {
      return;
    }
    if (!Array.isArray(n.children) || n.children.length === 0) {
      const txt = n.text?.trim();
      if (txt && txt !== ";") tokens.push(txt);
      return;
    }
    for (const c of n.children) collect(c);
  };
  collect(clause);
  return tokens;
}

function extractBuiltinSinCosCalleeCst(externalDecl: string): "sin" | "cos" | null {
  const base = stripTrailingSemicolon(externalDecl);
  if (!base) return null;
  const root = parseStandaloneMoCst(`function _f\n  ${base};\nend _f;`);
  if (!root) return null;
  const ext = findFirstCstNode(root, (n) => n.type === "external_clause");
  if (!ext) return null;
  const langNode = ext.children?.find(
    (c) => c.type === "language_specification" || c.type === "string_literal" || c.type === "STRING",
  );
  if (!langNode || stripOuterDoubleQuotes(langNode.text?.trim() ?? "") !== "builtin") return null;
  const extCall = findFirstCstNode(ext, (n) => n.type === "external_function_call");
  if (!extCall) return null;
  const leaves = collectCstLeafTexts(extCall, { skipStrings: true });
  const eqIdx = leaves.indexOf("=");
  const callee = eqIdx >= 0 ? leaves[eqIdx + 1] : leaves[0];
  return callee === "sin" || callee === "cos" ? callee : null;
}

function findDeclElementModificationValueCst(
  modRoot: CstNodeLike | null | undefined,
  modName: string,
): string | undefined {
  if (!modRoot) return undefined;
  let found: string | undefined;
  const visit = (n: CstNodeLike): void => {
    if (found !== undefined) return;
    if (n !== modRoot && n.type === "class_definition") return;
    if (n.type === "element_modification" || n.type === "named_argument") {
      const nameNode = n.children?.find((c) => c.type === "name" || c.type === "identifier");
      if (nameNode?.text?.trim() === modName) {
        const modNode = n.children?.find((c) => c.type === "modification") ?? n;
        const valNode =
          modNode.children?.find(
            (c) =>
              c.type === "modification_expression" ||
              c.type === "expression" ||
              c.type === "simple_expression" ||
              c.type === "string_literal" ||
              c.type === "STRING",
          ) ??
          (() => {
            const kids = modNode.children ?? [];
            const eqIdx = kids.findIndex((c) => c.text?.trim() === "=");
            return eqIdx >= 0 ? kids.slice(eqIdx + 1).find((c) => c.type !== "comment") : undefined;
          })();
        if (valNode?.text) {
          found = valNode.text.trim();
          return;
        }
      }
    }
    for (const c of n.children ?? []) visit(c);
  };
  visit(modRoot);
  return found;
}

function extractNamedOrModArgValueCst(valText: string, fieldName: string): string | undefined {
  let trimmed = valText.trim();
  if (trimmed.startsWith("=")) trimmed = trimmed.slice(1).trim();
  if (!trimmed) return undefined;
  const identEnd = readAsciiIdentEnd(trimmed, 0);
  let afterIdent = identEnd;
  while (afterIdent < trimmed.length && isAsciiWhitespaceCode(trimmed.charCodeAt(afterIdent))) afterIdent++;
  const declSnippet = trimmed.startsWith("(")
    ? `_T _x${trimmed}`
    : identEnd > 0 && trimmed[afterIdent] === "("
      ? `_T _x = ${trimmed}`
      : `_T _x(${trimmed})`;
  const root = parseStandaloneMoCst(`model _M\n  ${declSnippet};\nend _M;`);
  if (!root) return undefined;
  const targetNode = findFirstCstNode(root, (n) => n.type === "component_clause" || n.type === "class_definition");
  return findDeclElementModificationValueCst(targetNode ?? root, fieldName);
}

function extractFirstDeclToken(text: string | undefined): string {
  if (!text) return "";
  const trimmed = text.trimStart();
  if (!trimmed) return "";
  if (trimmed.startsWith("'")) {
    const end = consumeStringOrCommentEnd(trimmed, 0);
    return trimmed.slice(0, end);
  }
  return firstAsciiToken(trimmed);
}

export class ModelicaFlattener {
  bodySnapshot: DAEBuilder | null = null;
  public db: QueryDB;
  public options: Omit<Required<FlattenOptions>, "flowThreshold"> & { flowThreshold?: number | undefined };
  public explicitArrayMode?: "scalarize" | "preserve" | undefined;
  public currentRootClassId: SymbolId = 0;
  public currentClassId: SymbolId = 0;

  public get isOldFrontend(): boolean {
    return Boolean(this.options.isOldFrontend);
  }

  private getElementDiagRange(target: any): any {
    return getElementDiagRange(target);
  }
  public innerOuterComponents = new Set<string>();
  public innerDeclarations = new Map<string, Map<string, string>>();
  public disabledComponents = new Set<string>();
  public usedExternalObjects = new Set<SymbolId>();
  public usedRecordSymIds = new Set<SymbolId>();
  public usedRecordNames = new Set<string>();
  public implicitInners: { name: string; classId: SymbolId }[] = [];
  /** Element currently being instantiated as an implicit top-level `inner` (MLS §5.4), or null. */
  public implicitInnerElem: SymbolId | null = null;
  public fmuComponents = new Map<string, SymbolId>();
  public failedFunctionIds = new Set<SymbolId>();
  public invalidInterfaceFunctionIds = new Set<SymbolId>();
  public calledFunctionSymIds = new Set<SymbolId>();
  public activeLoopVars = new Set<string>();
  private loopVarCounts = new Map<string, number>();

  public state: FlatteningState = {
    innerOuterComponents: this.innerOuterComponents,
    activeLoopVars: this.activeLoopVars,
    stmtRanges: new Map(),
    deducedOutputShapes: new Map(),
    isRealNameCache: new Map(),
  };

  public pushLoopVar(name: string): void {
    const cnt = this.loopVarCounts.get(name) ?? 0;
    this.loopVarCounts.set(name, cnt + 1);
    this.activeLoopVars.add(name);
  }

  public popLoopVar(name: string): void {
    const cnt = this.loopVarCounts.get(name) ?? 0;
    if (cnt <= 1) {
      this.loopVarCounts.delete(name);
      this.activeLoopVars.delete(name);
    } else {
      this.loopVarCounts.set(name, cnt - 1);
    }
  }
  public usedOperatorFunctions = new Map<string, SymbolId>();
  public currentFlatteningFunctionId: SymbolId | null = null;
  public activeFlatteningFunctionIds = new Set<SymbolId>();
  public currentFunctionEnclosingScope: SymbolId | null = null;
  private pendingArrayBindings = new Map<string, { lhsExprId: number; rhsExprId: number }[]>();
  currentImports = new Map<string, string>();
  public expandableBuses = new Map<string, SymbolId>();
  public evaluatedConstantArrays = new Map<string, any>();
  public varConditionDeps = new Map<string, string[]>();
  public currentParentMods?: any;
  public currentBindingCompName?: string | undefined;
  public enumTypeMap = new Map<string, string[]>();
  private nodeProtectionCache = new WeakMap<any, boolean>();
  public useLocalDirection = false;

  private _fileSymbolsCache = new Map<string, any[]>();

  private getFileSymbols(resourceId?: string): any[] {
    const cacheKey = resourceId ?? "__all__";
    const cached = this._fileSymbolsCache.get(cacheKey);
    if (cached !== undefined) return cached;
    const result: any[] = [];
    const roots = (this.db.childrenOf(null) ?? []).filter((s: any) => !resourceId || s.resourceId === resourceId);
    const queue = [...roots];
    while (queue.length > 0) {
      const sym = queue.pop()!;
      result.push(sym);
      const children = this.db.childrenOf(sym.id) ?? [];
      for (const child of children) {
        if (!resourceId || child.resourceId === resourceId) {
          queue.push(child);
        }
      }
    }
    this._fileSymbolsCache.set(cacheKey, result);
    return result;
  }

  private extractClassAnnotations(dae: DAEBuilder, classId: SymbolId): void {
    const cst = this.db.cstNode(classId) as any;
    if (!cst) return;

    const evaluator = new AnnotationEvaluator(this.db as any);

    // 1. Experiment annotation (Modelica 3.7 / MCP-0036)
    const exp = evaluator.evaluate(cst, "experiment");
    if (exp) {
      if (exp.StartTime !== undefined || exp.startTime !== undefined) {
        dae.experiment.startTime = Number(exp.StartTime ?? exp.startTime);
      }
      if (exp.StopTime !== undefined || exp.stopTime !== undefined) {
        dae.experiment.stopTime = Number(exp.StopTime ?? exp.stopTime);
      }
      if (exp.Tolerance !== undefined || exp.tolerance !== undefined) {
        dae.experiment.tolerance = Number(exp.Tolerance ?? exp.tolerance);
      }
      if (exp.Interval !== undefined || exp.interval !== undefined) {
        dae.experiment.interval = Number(exp.Interval ?? exp.interval);
      }
      if (exp.NumberOfIntervals !== undefined || exp.numberOfIntervals !== undefined) {
        dae.experiment.numberOfIntervals = Number(exp.NumberOfIntervals ?? exp.numberOfIntervals);
      }
      if (exp.Algorithm !== undefined || exp.algorithm !== undefined) {
        dae.experiment.algorithm = String(exp.Algorithm ?? exp.algorithm);
      }
      if (exp.EquidistantOutput !== undefined || exp.equidistantOutput !== undefined) {
        dae.experiment.__modelscript_equidistantOutput = Boolean(exp.EquidistantOutput ?? exp.equidistantOutput);
      }
    }

    // 2. WebGPU
    const gpu = evaluator.evaluate(cst, "webgpu");
    if (gpu) {
      dae.extensionMetadata.webgpu = {
        workgroupSize: gpu.workgroupSize ? Number(gpu.workgroupSize) : undefined,
        precision: gpu.precision ? String(gpu.precision) : undefined,
        parallelInstances: gpu.parallelInstances ? Number(gpu.parallelInstances) : undefined,
      };
    }

    // 3. AudioClock
    const audio = evaluator.evaluate(cst, "audioclock");
    if (audio) {
      dae.extensionMetadata.audioClock = {
        sampleRate: audio.sampleRate ? Number(audio.sampleRate) : undefined,
        targetHz: audio.targetHz ? Number(audio.targetHz) : undefined,
        realtimeFactor: audio.realtimeFactor ? Number(audio.realtimeFactor) : undefined,
      };
    }

    // 4. SDE
    const sde = evaluator.evaluate(cst, "sde");
    if (sde) {
      dae.extensionMetadata.sde = {
        method: sde.method ? String(sde.method) : undefined,
        ensemblePaths: sde.ensemblePaths ? Number(sde.ensemblePaths) : undefined,
        seed: sde.seed ? Number(sde.seed) : undefined,
      };
    }

    // 5. BVP
    const bvp = evaluator.evaluate(cst, "bvp");
    if (bvp) {
      dae.extensionMetadata.bvp = {
        boundaryConditions: Array.isArray(bvp.boundaryConditions) ? bvp.boundaryConditions.map(String) : undefined,
        method: bvp.method ? String(bvp.method) : undefined,
        intervals: bvp.intervals ? Number(bvp.intervals) : undefined,
      };
    }

    // 6. Surrogate
    const surrogate = evaluator.evaluate(cst, "surrogate");
    if (surrogate) {
      if (!dae.extensionMetadata.surrogate) dae.extensionMetadata.surrogate = new Map();
      dae.extensionMetadata.surrogate.set("model", {
        architecture: surrogate.architecture ? String(surrogate.architecture) : undefined,
        datasetUri: surrogate.datasetUri ? String(surrogate.datasetUri) : undefined,
        errorTolerance: surrogate.errorTolerance ? Number(surrogate.errorTolerance) : undefined,
      });
    }

    // 7. FEAMesh
    const fea = evaluator.evaluate(cst, "feamesh");
    if (fea) {
      if (!dae.extensionMetadata.feaMesh) dae.extensionMetadata.feaMesh = [];
      dae.extensionMetadata.feaMesh.push({
        cadUri: fea.cadUri ? String(fea.cadUri) : undefined,
        meshType: fea.meshType ? String(fea.meshType) : undefined,
        material: fea.material ? String(fea.material) : undefined,
        loadConnector: fea.loadConnector ? String(fea.loadConnector) : undefined,
        feedbackDeflection: fea.feedbackDeflection ? String(fea.feedbackDeflection) : undefined,
      });
    }

    // 8. CFDFlow
    const cfd = evaluator.evaluate(cst, "cfdflow");
    if (cfd) {
      if (!dae.extensionMetadata.cfdFlow) dae.extensionMetadata.cfdFlow = [];
      dae.extensionMetadata.cfdFlow.push({
        grid: Array.isArray(cfd.grid) ? cfd.grid.map(Number) : undefined,
        dx: cfd.dx ? Number(cfd.dx) : undefined,
        turbulenceModel: cfd.turbulenceModel ? String(cfd.turbulenceModel) : undefined,
        velocityVariable: cfd.velocityVariable ? String(cfd.velocityVariable) : undefined,
        dragForceVariable: cfd.dragForceVariable ? String(cfd.dragForceVariable) : undefined,
      });
    }

    // 9. MBSE / IoT (SysML, OWL, Telemetry)
    const sysml = evaluator.evaluate(cst, "sysml");
    const owl = evaluator.evaluate(cst, "owl");
    const telemetry = evaluator.evaluate(cst, "telemetry");
    if (sysml || owl || telemetry) {
      if (!dae.extensionMetadata.mbse) dae.extensionMetadata.mbse = {};
      if (sysml) {
        if (!dae.extensionMetadata.mbse.sysml) dae.extensionMetadata.mbse.sysml = [];
        dae.extensionMetadata.mbse.sysml.push(sysml);
      }
      if (owl) {
        if (!dae.extensionMetadata.mbse.owl) dae.extensionMetadata.mbse.owl = [];
        dae.extensionMetadata.mbse.owl.push(owl);
      }
      if (telemetry) {
        if (!dae.extensionMetadata.mbse.telemetry) dae.extensionMetadata.mbse.telemetry = [];
        dae.extensionMetadata.mbse.telemetry.push(telemetry);
      }
    }
  }

  public isComponentHidden(elemId: SymbolId): boolean {
    return isComponentHidden(this, elemId);
  }

  public extractDescription(elemCst: any): string | null {
    return extractDescription(elemCst);
  }

  isComponentDisabled(name: string): boolean {
    if (this.disabledComponents.has(name)) return true;
    for (const dis of this.disabledComponents) {
      if (name.startsWith(`${dis}.`) || name.startsWith(`${dis}[`)) return true;
    }
    return false;
  }

  isExternalObject(classId: SymbolId | null | undefined, visited = new Set<SymbolId>()): boolean {
    if (!classId || visited.has(classId)) return false;
    visited.add(classId);
    const sym = this.db.symbol(classId);
    if (!sym) return false;
    if (sym.name === "ExternalObject") return true;

    const extendsChildren = this.db.childrenOf(classId).filter((c) => c.kind === "Extends");
    for (const ext of extendsChildren) {
      if (ext.name === "ExternalObject" || ext.name.endsWith(".ExternalObject")) return true;
      const base = this.db.query<SymbolEntry | null>("resolvedBaseClass", ext.id);
      const scoped =
        this.db.query<any>("resolveName", classId)?.(ext.name) ??
        this.db.query<any>("resolveSimpleName", classId)?.(ext.name);
      const target = base ?? scoped ?? this.db.byName(ext.name).find((e) => e.kind === "Class");
      if (target && this.isExternalObject(target.id, visited)) {
        return true;
      }
    }
    return false;
  }

  isOperatorRecordSym(sym: any): boolean {
    if (!sym || sym.id < 0 || (sym.metadata as any)?.isPredefined) return false;
    if ((sym as any)._isOperatorRecord !== undefined) return (sym as any)._isOperatorRecord;
    const meta = (sym.metadata as any) || {};
    const rawKind = String(meta.classKind ?? meta.classPrefixes ?? "");
    const kindWords = tokenizeCommentStrippedWords(rawKind);
    if (kindWords.some((w, idx) => w === "operator" && kindWords[idx + 1] === "record")) {
      (sym as any)._isOperatorRecord = true;
      return true;
    }
    if (kindWords.length > 0 && !kindWords.includes("operator") && !kindWords.includes("record")) {
      (sym as any)._isOperatorRecord = false;
      return false;
    }
    const cst = this.db.cstNode(sym.id) as any;
    if (cst) {
      if (hasOperatorRecordPrefixCst(cst)) {
        (sym as any)._isOperatorRecord = true;
        return true;
      }
    }
    (sym as any)._isOperatorRecord = false;
    return false;
  }

  isClassPartial(classId?: SymbolId | null, visited = new Set<SymbolId>()): boolean {
    if (!classId || classId < 0 || visited.has(classId)) return false;
    visited.add(classId);
    const sym = this.db.symbol(classId);
    if (!sym || (sym.kind !== "Class" && sym.kind !== "Package" && sym.kind !== "Function")) return false;
    const meta = (sym.metadata as any) || {};
    const rawKind = String(meta.classKind ?? meta.classPrefixes ?? "");
    if (tokenizeCommentStrippedWords(rawKind).includes("partial")) return true;
    const cst = this.db.cstNode(classId) as any;
    if (cst) {
      if (hasClassPrefixWordCst(cst, "partial")) return true;
      const shortSpec = getShortClassSpecifierNode(cst);
      if (shortSpec && !(this.options as any)?.isOldFrontend) {
        const typeSpecNode = shortSpec.children?.find((c: any) => c.type === "type_specifier" || c.type === "name");
        const typeName: string = typeSpecNode?.text?.trim();
        if (typeName) {
          const resolved =
            this.db.query<(n: string) => any>("resolveName", classId)?.(typeName) ??
            this.db.query<(n: string) => any>("resolveSimpleName", classId)?.(typeName) ??
            this.db.byName(typeName)?.[0];
          if (resolved?.id) {
            return this.isClassPartial(resolved.id, visited);
          }
        }
      }
    }
    return false;
  }

  private _hasOperatorRecordsCache = new Map<SymbolId, boolean>();
  private _globalHasOperatorRecords?: boolean | undefined;

  hasOperatorRecords(rootClassId?: SymbolId | null): boolean {
    if (!rootClassId) return true;
    const cached = this._hasOperatorRecordsCache.get(rootClassId);
    if (cached !== undefined) return cached;
    const rootSym = this.db.symbol(rootClassId);
    if (rootSym?.resourceId) {
      const fileSyms = this.getFileSymbols(rootSym.resourceId);
      if (fileSyms.some((s: any) => s.kind === "Class" && this.isOperatorRecordSym(s))) {
        this._hasOperatorRecordsCache.set(rootClassId, true);
        return true;
      }
    }
    if (this._globalHasOperatorRecords === undefined) {
      const dbAny = this.db as any;
      if (dbAny._globalHasOperatorRecords !== undefined) {
        this._globalHasOperatorRecords = dbAny._globalHasOperatorRecords;
      } else {
        this._globalHasOperatorRecords = (this.db.allEntries?.() ?? []).some(
          (s: any) => s.kind === "Class" && this.isOperatorRecordSym(s),
        );
        dbAny._globalHasOperatorRecords = this._globalHasOperatorRecords;
      }
    }
    this._hasOperatorRecordsCache.set(rootClassId, this._globalHasOperatorRecords!);
    return this._globalHasOperatorRecords!;
  }

  validateOperatorRecords(dae: DAEBuilder, rootClassId: SymbolId): void {
    const rootSym = this.db.symbol(rootClassId);
    if (!rootSym || !rootSym.resourceId) return;
    const rootCst = this.db.cstNode(rootClassId) as any;
    const isOldFrontend = extractCompilerOptions(rootCst, this.options, this.db, rootSym).isOldFrontend;

    const candidates = this.getFileSymbols(rootSym.resourceId).filter(
      (s: any) => s.kind === "Class" && this.isOperatorRecordSym(s),
    );

    for (const rec of candidates) {
      const recCst = this.db.cstNode(rec.id) as any;
      const recStart = recCst?.startIndex ?? recCst?.startOffset;
      const recEnd = recCst?.endIndex ?? recCst?.endOffset;
      const recRange = recStart != null && recEnd != null ? { startOffset: recStart, endOffset: recEnd } : undefined;

      const children = this.db.childrenOf(rec.id);
      for (const child of children) {
        if (child.kind !== "Class") continue;
        const childMeta = (child.metadata as Record<string, unknown>) || {};
        const childPrefix = String(childMeta?.["classPrefixes"] ?? childMeta?.["classKind"] ?? "");
        const childCst = this.db.cstNode(child.id) as any;
        const childText = childCst?.text?.trim() ?? "";

        const isOperator =
          childPrefix.includes("operator") ||
          child.name.startsWith("'") ||
          childText.startsWith("operator") ||
          hasClassPrefixWordCst(childCst, "operator");

        if (!isOperator) continue;

        const recMeta = (rec.metadata as Record<string, unknown>) || {};
        const recPrefix = String(recMeta?.["classPrefixes"] ?? recMeta?.["classKind"] ?? "");
        const checkEncapsulated = (s: string) => {
          const words = tokenizeCommentStrippedWords(s);
          return words.includes("encapsulated") && !words.includes("non-encapsulated");
        };
        const isEncapsulated =
          checkEncapsulated(recPrefix) ||
          checkEncapsulated(childPrefix) ||
          hasClassPrefixWordCst(childCst, "encapsulated") ||
          this.db.childrenOf(child.id).some((c) => {
            if (c.kind !== "Class") return false;
            const meta = (c.metadata as any) || {};
            const pfx = String(meta.classPrefixes ?? meta.classKind ?? "");
            return checkEncapsulated(pfx);
          });

        if (!isOldFrontend && !isEncapsulated) {
          const cStart = childCst?.startIndex ?? childCst?.startOffset;
          const cEnd = childCst?.endIndex ?? childCst?.endOffset;
          const cRange = cStart != null && cEnd != null ? { startOffset: cStart, endOffset: cEnd } : undefined;
          dae.diagnostics.push({
            severity: "error",
            code: ModelicaErrorCode.NON_ENCAPSULATED_OPERATOR.code,
            message: `Operator ${rec.name}.'${stripOuterSingleQuotes(child.name)}' is not encapsulated.`,
            range: cRange,
          });
        }

        const isCtor = child.name === "'constructor'" || child.name === "constructor";
        if (isCtor) {
          const funcs =
            childPrefix.includes("operator function") || childText.startsWith("operator function")
              ? [child]
              : this.db.childrenOf(child.id).filter((c) => c.kind === "Class");

          for (const fn of funcs) {
            const comps = this.db.childrenOf(fn.id).filter((c) => c.kind === "Component");
            const outputs: SymbolEntry[] = [];
            for (const c of comps) {
              const causality = this.db.query<string | null>("causality", c.id);
              if (causality === "output") outputs.push(c);
            }

            if (outputs.length !== 1) {
              dae.diagnostics.push({
                severity: "error",
                code: ModelicaErrorCode.OPERATOR_CONSTRUCTOR_INVALID_OUTPUT_COUNT.code,
                message: `Operator ${rec.name}.'constructor' must have exactly one output.`,
                range: recRange,
              });
            } else {
              const out = outputs[0]!;
              const outType = this.db.query<string | null>("typeSpecifier", out.id);
              const cleanType = stripLeadingDot(outType ?? "");
              if (cleanType !== rec.name) {
                dae.diagnostics.push({
                  severity: "error",
                  code: ModelicaErrorCode.OPERATOR_CONSTRUCTOR_INVALID_OUTPUT_TYPE.code,
                  message: `Output '${out.name}' in operator ${rec.name}.'constructor' must be of type ${rec.name}, got type ${outType ?? "unknown"}.`,
                  range: recRange,
                });
              }
            }
          }
        }
      }
    }
  }

  isRecordSym(sym: any): boolean {
    if (!sym || sym.id < 0 || (sym.metadata as any)?.isPredefined) return false;
    if ((sym as any)._isRecord !== undefined) return (sym as any)._isRecord;
    const meta = (sym.metadata as any) || {};
    const rawKind = String(meta.classKind ?? meta.classPrefixes ?? "");
    const words = tokenizeCommentStrippedWords(rawKind);
    if (words.includes("record")) {
      (sym as any)._isRecord = true;
      return true;
    }
    if (words.length > 0 && !words.includes("record")) {
      (sym as any)._isRecord = false;
      return false;
    }
    const cst = this.db.cstNode(sym.id) as any;
    if (cst) {
      const pfx = Cst.ClassDefinition.classPrefixes(cst);
      if (pfx) {
        const pfxWords = tokenizeCommentStrippedWords(pfx.text ?? "");
        if (pfxWords.includes("record")) {
          (sym as any)._isRecord = true;
          return true;
        }
      }
      if (hasClassPrefixWordCst(cst, "record")) {
        (sym as any)._isRecord = true;
        return true;
      }
    }
    (sym as any)._isRecord = false;
    return false;
  }

  isExpandableConnectorClass(classId: SymbolId): boolean {
    return isExpandableConnectorClass(this.db, classId);
  }

  validateClassSpecializationRestrictions(dae: DAEBuilder, rootClassId: SymbolId): void {
    const rootSym = this.db.symbol(rootClassId);
    if (!rootSym) return;

    const collectClasses = (parentId: SymbolId | null): SymbolEntry[] => {
      const result: SymbolEntry[] = [];
      const children = this.db.childrenOf(parentId) ?? [];
      for (const s of children) {
        if (!rootSym.resourceId || s.resourceId === rootSym.resourceId) {
          if (s.kind === "Class" || s.kind === "Package") {
            result.push(s);
            result.push(...collectClasses(s.id));
          }
        }
      }
      return result;
    };
    const fileClasses = collectClasses(null);

    for (const cls of fileClasses) {
      const clsSym = cls;
      const rawKind = String(clsSym?.metadata?.["classKind"] ?? clsSym?.metadata?.["classPrefixes"] ?? "");
      const cleanKind = tokenizeCommentStrippedWords(rawKind).pop() ?? "";
      const cst = this.db.cstNode(cls.id) as any;
      if (!cst) continue;

      const findComposition = (node: any): any => {
        if (!node) return null;
        if (node.type === "composition") return node;
        for (const child of node.children || []) {
          const res = findComposition(child);
          if (res) return res;
        }
        return null;
      };

      const compNode = findComposition(cst);
      if (!compNode) continue;

      // 1. Equations and Algorithms in type, record, connector, package
      if (
        cleanKind === "type" ||
        cleanKind === "record" ||
        cleanKind === "connector" ||
        (cleanKind === "package" && !(dae.extensionMetadata?.["isOldFrontend"] && cls.id !== rootClassId))
      ) {
        for (const child of compNode.children || []) {
          if (child.type === "equation_section") {
            let targetNode = child;
            for (const ch of child.children || []) {
              if (ch.type === "some_equation" || ch.type === "simple_equation") {
                targetNode = ch;
                break;
              }
            }
            dae.diagnostics.push({
              severity: "error",
              code: ModelicaErrorCode.RESTRICTION_VIOLATION.code,
              message: ModelicaErrorCode.RESTRICTION_VIOLATION.message("Equations", cleanKind),
              range: {
                startOffset: targetNode.startIndex ?? targetNode.startOffset,
                endOffset: targetNode.endIndex ?? targetNode.endOffset,
                startPosition: targetNode.startPosition,
                endPosition: targetNode.endPosition,
              },
            });
          } else if (child.type === "algorithm_section") {
            let targetNode = child;
            for (const ch of child.children || []) {
              if (ch.type === "statement" || ch.type === "assignment_statement") {
                targetNode = ch;
                break;
              }
            }
            dae.diagnostics.push({
              severity: "error",
              code: ModelicaErrorCode.RESTRICTION_VIOLATION.code,
              message: ModelicaErrorCode.RESTRICTION_VIOLATION.message("Algorithm sections", cleanKind),
              range: {
                startOffset: targetNode.startIndex ?? targetNode.startOffset,
                endOffset: targetNode.endIndex ?? targetNode.endOffset,
                startPosition: targetNode.startPosition,
                endPosition: targetNode.endPosition,
              },
            });
          }
        }
      }

      // 2. Protected sections in type, record, connector
      const isOldFrontend = Boolean(dae.extensionMetadata?.["isOldFrontend"]);
      if (cleanKind === "type" || (!isOldFrontend && cleanKind === "record") || cleanKind === "connector") {
        for (let i = 0; i < (compNode.children || []).length; i++) {
          const child = compNode.children[i];
          if (child.text?.trim() === "protected" || child.type === '"protected"') {
            const nextChild = compNode.children[i + 1];
            let targetNode = child;
            if (nextChild && nextChild.children && nextChild.children.length > 0) {
              const firstElem = nextChild.children[0];
              if (cleanKind === "record" || cleanKind === "connector") {
                targetNode = firstElem;
              } else if (cleanKind === "type") {
                targetNode = {
                  startOffset: child.startIndex ?? child.startOffset,
                  endOffset: firstElem.endIndex ?? firstElem.endOffset,
                  startPosition: child.startPosition,
                  endPosition: firstElem.endPosition,
                };
              }
            }
            dae.diagnostics.push({
              severity: "error",
              code: ModelicaErrorCode.PROTECTED_IN_CONNECTOR.code,
              message: `Protected sections are not allowed in ${cleanKind}.`,
              range: {
                startOffset: targetNode.startIndex ?? targetNode.startOffset,
                endOffset: targetNode.endIndex ?? targetNode.endOffset,
                startPosition: targetNode.startPosition,
                endPosition: targetNode.endPosition,
              },
            });
          }
        }
      }

      // 3. Variable in package must be constant
      if (cleanKind === "package" && !dae.extensionMetadata?.["isOldFrontend"]) {
        const children = this.db.childrenOf(cls.id);
        for (const child of children) {
          if (child.kind === "Component") {
            const rawVar = (child.metadata as any)?.variability;
            const variability = this.db.query<any>("variability", child.id);
            const isConst = rawVar === "constant" || variability === "constant" || variability === Variability.Constant;
            if (!isConst) {
              const compCst = this.db.cstNode(child.id) as any;
              let clauseNode = compCst;
              while (clauseNode && clauseNode.type !== "component_clause" && clauseNode.parent) {
                clauseNode = clauseNode.parent;
              }
              const targetNode = clauseNode ?? compCst;
              dae.diagnostics.push({
                severity: "error",
                code: ModelicaErrorCode.PACKAGE_VARIABLE_NOT_CONSTANT.code,
                message: ModelicaErrorCode.PACKAGE_VARIABLE_NOT_CONSTANT.message(child.name, cls.name),
                range: {
                  startOffset: targetNode.startIndex ?? targetNode.startOffset,
                  endOffset: targetNode.endIndex ?? targetNode.endOffset,
                  startPosition: targetNode.startPosition,
                  endPosition: targetNode.endPosition,
                },
              });
            }
          }
        }
      }
    }
  }

  private _classImportsCache = new Map<SymbolId, Map<string, string>>();

  collectClassImports(classId: SymbolId, visited: Set<SymbolId> = new Set<SymbolId>()): Map<string, string> {
    const cached = this._classImportsCache.get(classId);
    if (cached !== undefined) return new Map(cached);
    const result = new Map<string, string>();
    if (visited.has(classId)) return result;
    visited.add(classId);

    // 1. Parent scope imports
    const sym = this.db.symbol(classId);
    if (sym && sym.parentId !== null) {
      const parentImports = this.collectClassImports(sym.parentId, visited);
      for (const [k, v] of parentImports) {
        result.set(k, v);
      }
    }

    // 2. Base class imports (via Extends) & 3. Own imports from index
    const children = this.db.childrenOf(classId);
    for (const ext of children) {
      if (ext.kind !== "Extends") continue;
      const base = this.db.query<SymbolEntry | null>("resolvedBaseClass", ext.id);
      const scoped =
        this.db.query<any>("resolveName", classId)?.(ext.name) ??
        this.db.query<any>("resolveSimpleName", classId)?.(ext.name);
      const target = base ?? scoped ?? this.db.byName(ext.name).find((e) => e.kind === "Class");
      if (target) {
        const baseImports = this.collectClassImports(target.id, visited);
        for (const [k, v] of baseImports) {
          result.set(k, v);
        }
      }
    }

    for (const child of children) {
      if (child.kind === "Import") {
        const meta = child.metadata as Record<string, unknown>;
        let importKind = meta?.["importKind"] as string | undefined;
        let pkgName = (meta?.["packageName"] ?? child.name) as string;
        let aliasName = meta?.["shortName"] as string | undefined;

        // For WASM GLR parser import_clause nodes, inspect the CST
        if (importKind === undefined && (child.ruleName === "import_clause" || child.ruleName === "ImportClause")) {
          const importCst = this.db.cstNode(child.id) as any;
          if (importCst) {
            const aliasNode = Cst.ImportClause.alias(importCst);
            const importListNode = Cst.ImportClause.importList(importCst);
            if (aliasNode) {
              aliasName = aliasNode.text;
              importKind = "simple";
            } else if (importListNode) {
              importKind = "compound";
            } else if (cstHasUnqualifiedImportWildcard(importCst)) {
              importKind = "unqualified";
            } else {
              importKind = "simple";
            }
          } else {
            importKind = "simple";
          }
        }
        if (!importKind) importKind = "simple";

        if (importKind === "simple") {
          const shortName = aliasName ?? pkgName.split(".").pop() ?? pkgName;
          result.set(shortName, pkgName);
        } else if (importKind === "unqualified") {
          // For unqualified imports, we need to resolve the package and add all children
          const pkgEntry = this.db
            .byName(pkgName.split(".")[0] ?? "")
            .find((e) => e.kind === "Package" || e.kind === "Class");
          if (pkgEntry) {
            const resolvedPkg = this.db.query<(n: string) => { id: number } | null>("resolveName", pkgEntry.id);
            const target = pkgName.includes(".") ? resolvedPkg?.(pkgName.slice(pkgName.indexOf(".") + 1)) : pkgEntry;
            if (target) {
              for (const pkgChild of this.db.childrenOf(target.id)) {
                if (pkgChild.kind !== "Reference" && pkgChild.kind !== "Import") {
                  // MLS §13.2.1.1: An imported name cannot hide a built-in operator or type keyword.
                  if (
                    BUILTIN_FUNCTIONS.has(pkgChild.name) ||
                    BUILTIN_VARIABLES.has(pkgChild.name) ||
                    SCALAR_VECTORIZABLE_FUNCTIONS.has(pkgChild.name) ||
                    pkgChild.name === "Real" ||
                    pkgChild.name === "Integer" ||
                    pkgChild.name === "Boolean" ||
                    pkgChild.name === "String"
                  ) {
                    continue;
                  }
                  result.set(pkgChild.name, `${pkgName}.${pkgChild.name}`);
                }
              }
            }
          }
        }
      }
    }

    this._classImportsCache.set(classId, new Map(result));
    return result;
  }

  public lowerExpr(
    node: SyntaxNode | null | undefined,
    dae: DAEBuilder,
    prefix = "",
    substitutions?: Map<string, number | string>,
    tupleContext?: boolean,
    isAssignmentLhs?: boolean,
  ): number {
    return lowerCSTExpression(node, dae, {
      prefix,
      substitutions,
      imports: this.currentImports,
      db: this.db,
      flattener: this,
      tupleContext,
      isAssignmentLhs,
    });
  }

  public isStaticTrueAssert(callId: number, dae: DAEBuilder): boolean {
    return isStaticTrueAssert(callId, dae);
  }

  public emitFunctionCallEquation(
    node: SyntaxNode | null | undefined,
    dae: DAEBuilder,
    prefix: string,
    substitutions?: Map<string, number | string>,
    isInitial = false,
    whenIdx = -1,
  ): void {
    emitFunctionCallEquation(this, node, dae, prefix, substitutions, isInitial, whenIdx);
  }
  private extractStateMachines(dae: DAEBuilder): void {
    extractStateMachines(dae, this.options);
  }

  public collectExprVarNames(exprId: number, dae: DAEBuilder, names: Set<string>, visited = new Set<number>()): void {
    collectExprVarNames(exprId, dae, names, visited);
  }

  private checkCyclicConstantsAndParameters(dae: DAEBuilder, rootClassId: SymbolId): void {
    checkCyclicConstantsAndParameters(dae, rootClassId, this.db, this.options, this.varConditionDeps);
  }

  public checkCyclicFunctionComponents(fn: DAEBuilder, fnSymId: SymbolId): void {
    checkCyclicFunctionComponents(fn, fnSymId, this.db);
  }

  constructor(db: QueryDB, options?: FlattenOptions) {
    this.db = db;
    const dbAny = db as any;
    if (!dbAny._fileSymbolsCache) dbAny._fileSymbolsCache = new Map<string, any[]>();
    if (!dbAny._hasOperatorRecordsCache) dbAny._hasOperatorRecordsCache = new Map<SymbolId, boolean>();
    if (!dbAny._classImportsCache) dbAny._classImportsCache = new Map<SymbolId, Map<string, string>>();
    if (!dbAny._redeclareCache) dbAny._redeclareCache = new Map<SymbolId, boolean>();
    if (!dbAny._unsupportedWasmCache) dbAny._unsupportedWasmCache = new Map<SymbolId, boolean>();
    this._fileSymbolsCache = dbAny._fileSymbolsCache;
    this._hasOperatorRecordsCache = dbAny._hasOperatorRecordsCache;
    this._classImportsCache = dbAny._classImportsCache;
    this._redeclareCache = dbAny._redeclareCache;
    this._unsupportedWasmCache = dbAny._unsupportedWasmCache;
    const omcCompatibility = options?.omcCompatibility ?? false;
    let backend: FlattenerBackend =
      options?.backend ?? (options as any)?.flattenerBackend ?? (options?.useWasmKernel ? "wasm" : "hybrid");
    this.explicitArrayMode = options?.arrayMode;
    this.options = {
      backend,
      arrayMode: options?.arrayMode ?? (omcCompatibility ? "scalarize" : "preserve"),
      functionInlining: options?.functionInlining ?? false,
      omcCompatibility,
      eliminateAliases: options?.eliminateAliases ?? false,
      useWasmKernel:
        backend === "wasm" || backend === "hybrid" || backend === "diff" || Boolean(options?.useWasmKernel),
      scalarizeBindings: options?.scalarizeBindings ?? false,
      scalarizeMinMax: options?.scalarizeMinMax ?? false,
      flowThreshold: options?.flowThreshold,
      intEnumConversion: Boolean(options?.intEnumConversion),
      isOldFrontend: options?.isOldFrontend ?? false,
    };
  }

  flatten(rootClassId: SymbolId, cachedArena?: DAEBuilder | null, options?: FlattenOptions): DAEBuilder {
    if (options) {
      const optBackend = options.backend ?? (options as any).flattenerBackend;
      if (optBackend !== undefined) {
        this.options.backend = optBackend;
        this.options.useWasmKernel = optBackend === "wasm" || optBackend === "hybrid" || optBackend === "diff";
      } else if (options.useWasmKernel !== undefined) {
        this.options.useWasmKernel = options.useWasmKernel;
        this.options.backend = options.useWasmKernel ? "wasm" : "ts";
      }
      if (options.arrayMode !== undefined) {
        this.explicitArrayMode = options.arrayMode;
        this.options.arrayMode = options.arrayMode;
      }
      if (options.functionInlining !== undefined) this.options.functionInlining = options.functionInlining;
      if (options.omcCompatibility !== undefined) {
        this.options.omcCompatibility = options.omcCompatibility;
        if (options.arrayMode === undefined && options.omcCompatibility) {
          this.options.arrayMode = "scalarize";
        }
        if (options.eliminateAliases === undefined) {
          this.options.eliminateAliases = false;
        }
      }
      if (options.eliminateAliases !== undefined) this.options.eliminateAliases = options.eliminateAliases;
      if (options.scalarizeBindings !== undefined) this.options.scalarizeBindings = options.scalarizeBindings;
      if (options.isOldFrontend !== undefined) (this.options as any).isOldFrontend = options.isOldFrontend;
    }

    const dae = this.flattenClass(rootClassId, cachedArena);
    if (
      !dae.diagnostics.some((d) => d.severity === "error") &&
      !dae.extensionMetadata?.["isOldFrontend"] &&
      dae.classKind !== "function" &&
      dae.classKind !== "package" &&
      !this.isClassPartial(rootClassId)
    ) {
      const assignedLhsNames = new Set<string>();
      const recordAssignedLhs = (exprId: number): void => {
        if (exprId < 0 || exprId === 0xffffffff) return;
        const ek = dae.getExprKind(exprId);
        if (ek === ExprKind.Name) {
          const lhsName = dae.interner.resolve(dae.getExprData1(exprId));
          if (lhsName) assignedLhsNames.add(lhsName);
        } else if (ek === ExprKind.Tuple) {
          const tCount = dae.getExprData1(exprId);
          for (let ti = 0; ti < tCount; ti++) {
            const subId = dae.getExprLeft(exprId + ti);
            if (subId >= 0 && subId !== 0xffffffff && dae.getExprKind(subId) === ExprKind.Name) {
              const lhsName = dae.interner.resolve(dae.getExprData1(subId));
              if (lhsName) assignedLhsNames.add(lhsName);
            }
          }
        }
      };
      for (let e = 0; e < dae.eqCount; e++) {
        const eqKind = dae.getEqKind(e);
        if (eqKind === EqKind.Simple || eqKind === EqKind.InitialSimple || eqKind === EqKind.Array) {
          recordAssignedLhs(dae.getEqLhs(e));
        }
      }
      for (let s = 0; s < dae.stmtCount; s++) {
        if (dae.getStmtKind(s) === StmtKind.Assignment) {
          recordAssignedLhs(dae.getStmtData1(s));
        }
      }
      const isCoveredByEquationLhs = (vName: string): boolean => {
        if (assignedLhsNames.has(vName)) return true;
        let cur = vName;
        while (cur.length > 0) {
          if (cur.endsWith("]")) {
            const lb = cur.lastIndexOf("[");
            if (lb > 0 && assignedLhsNames.has(cur.slice(0, lb))) return true;
          }
          const dotIdx = cur.lastIndexOf(".");
          if (dotIdx <= 0) break;
          cur = cur.slice(0, dotIdx);
          if (assignedLhsNames.has(cur)) return true;
        }
        return false;
      };
      const resolveNestedParamCstRange = (rootId: SymbolId, vName: string) => {
        const segs = vName.split(".").map((s) => {
          const lb = s.indexOf("[");
          return lb > 0 ? s.slice(0, lb) : s;
        });
        let curClassId: SymbolId | null = rootId;
        let lastSym: SymbolEntry | undefined;
        for (const seg of segs) {
          if (!curClassId) return undefined;
          let found: SymbolEntry | undefined = this.db
            .childrenOf(curClassId)
            .find((c) => c.name === seg && c.kind === "Component");
          if (!found) {
            const all: SymbolEntry[] = this.db.query<SymbolEntry[]>("allElements", curClassId) ?? [];
            found = all.find((c: SymbolEntry) => c.name === seg && c.kind === "Component");
          }
          if (!found) return undefined;
          lastSym = found;
          const nextCid: SymbolId | null = this.db.query<SymbolId | null>("classInstance", found.id);
          curClassId = nextCid;
        }
        if (lastSym) {
          const cst = this.db.cstNode(lastSym.id);
          if (cst) return getElementDiagRange(cst);
        }
        return undefined;
      };
      for (let i = 0; i < dae.varCount; i++) {
        if (!dae.isVarRemoved(i) && dae.getVarVariability(i) === Variability.Parameter) {
          const exprId = dae.getVarExpression(i);
          const startAttr = dae.getVarAttr(i, "start");
          const hasBindingOrStart =
            (exprId !== undefined && exprId >= 0 && exprId !== 0xffffffff) ||
            (startAttr !== undefined && startAttr >= 0 && startAttr !== 0xffffffff);
          const fixedAttr = dae.getVarAttr(i, "fixed");
          const isFixedFalse =
            fixedAttr !== undefined &&
            fixedAttr >= 0 &&
            dae.getExprKind(fixedAttr) === ExprKind.BoolLiteral &&
            dae.getExprData1(fixedAttr) === 0;
          if (!hasBindingOrStart && !isFixedFalse) {
            const vName = dae.getVarName(i);
            if (isCoveredByEquationLhs(vName)) continue;
            let range = dae.getVarSourceRange(i);
            const sym = this.db.childrenOf(rootClassId).find((c) => c.name === vName);
            if (sym) {
              const cst = this.db.cstNode(sym.id);
              if (cst) range = getElementDiagRange(cst);
            } else if (!range && vName.includes(".")) {
              range = resolveNestedParamCstRange(rootClassId, vName);
            }
            dae.diagnostics.push({
              severity: "error",
              code: ModelicaErrorCode.PARTIAL_TYPE_COMPONENT.code,
              message: `Parameter ${vName} has neither value nor start value, and is fixed during initialization (fixed=true).`,
              range,
            });
            break;
          }
        }
      }
    }
    this.bodySnapshot = typeof (dae as any).clone === "function" ? (dae as any).clone() : dae;
    return dae;
  }

  private _redeclareCache = new Map<SymbolId, boolean>();

  public classHasRedeclare(classId?: SymbolId | null, visited = new Set<SymbolId>()): boolean {
    if (!classId || visited.has(classId)) return false;
    const cached = this._redeclareCache.get(classId);
    if (cached !== undefined) return cached;
    visited.add(classId);

    const cacheAndReturn = (val: boolean): boolean => {
      this._redeclareCache.set(classId, val);
      return val;
    };

    const shortMod = this.db.query<any>("effectiveModification", classId);
    if (shortMod?.args) {
      for (const arg of shortMod.args) {
        if (arg.isRedeclaration || arg.redeclaredTypeSpecifier || arg.isReplaceable) return cacheAndReturn(true);
      }
      if (shortMod.args.length > 0) {
        const sym = this.db.symbol(classId);
        const clsCst = this.db.cstNode(classId) as any;
        if (
          sym?.kind === "Package" ||
          (sym?.metadata as any)?.classKind === "package" ||
          hasClassPrefixWordCst(clsCst, "package")
        ) {
          return cacheAndReturn(true);
        }
      }
    }

    const children = this.db.childrenOf(classId);
    for (const child of children) {
      if (this.db.query<boolean>("isRedeclare", child.id)) {
        return cacheAndReturn(true);
      }
      if (this.db.query<boolean>("isReplaceable", child.id)) {
        return cacheAndReturn(true);
      }
      if (child.kind === "Extends") {
        const extendsModParsedRaw = this.db.query<any>("extendsModificationParsed", child.id);
        const extendsModParsed: any[] = Array.isArray(extendsModParsedRaw)
          ? extendsModParsedRaw
          : (extendsModParsedRaw?.args ?? []);
        for (const arg of extendsModParsed) {
          if (arg.isRedeclaration || arg.redeclaredTypeSpecifier) return cacheAndReturn(true);
        }
        const baseClass =
          this.db.query<any>("resolvedBaseClass", child.id) ??
          (classId
            ? (this.db.query<any>("resolveName", classId)?.(child.name) ??
              this.db.query<any>("resolveSimpleName", classId)?.(child.name))
            : null) ??
          this.db.byName(child.name)?.[0];
        if (baseClass && this.classHasRedeclare(baseClass.id, visited)) return cacheAndReturn(true);
      }
      if (child.kind === "Class" || child.kind === "Package") {
        if (this.classHasRedeclare(child.id, visited)) return cacheAndReturn(true);
      }
      if (child.kind === "Component") {
        const compInst = this.db.query<any>("componentInstance", child.id);
        if (compInst?.isReplaceable) return cacheAndReturn(true);
        if (compInst?.modification?.args) {
          for (const arg of compInst.modification.args) {
            if (arg.isRedeclaration || arg.redeclaredTypeSpecifier) return cacheAndReturn(true);
          }
        }
        const compClassId = this.db.query<SymbolId | null>("classInstance", child.id);
        if (compClassId && this.classHasRedeclare(compClassId, visited)) return cacheAndReturn(true);
      }
    }

    const cst = this.db.cstNode(classId) as any;
    if (cst) {
      const prefixNames = collectDottedPrefixRootIdentsCst(cst);
      if (prefixNames.length > 0) {
        const sym = this.db.symbol(classId);
        const seenPrefixes = new Set<string>();
        for (const prefixName of prefixNames) {
          if (prefixName === "Modelica" || seenPrefixes.has(prefixName)) continue;
          seenPrefixes.add(prefixName);
          const prefixSym = this.db.byName(prefixName).find((e) => e.kind === "Class" || e.kind === "Package");
          if (
            prefixSym &&
            prefixSym.id !== classId &&
            (!sym?.resourceId || prefixSym.resourceId === sym.resourceId) &&
            this.classHasRedeclare(prefixSym.id, visited)
          ) {
            return cacheAndReturn(true);
          }
        }
      }
    }
    return cacheAndReturn(false);
  }

  public classHasConnect(classId?: SymbolId | null, visited = new Set<SymbolId>()): boolean {
    if (!classId || visited.has(classId)) return false;
    visited.add(classId);

    const cst = this.db.cstNode(classId) as any;
    if (cst?.text?.includes("connect(")) return true;

    const children = this.db.childrenOf(classId);
    for (const child of children) {
      if (child.kind === "Extends") {
        const baseClass =
          this.db.query<any>("resolvedBaseClass", child.id) ??
          (classId
            ? (this.db.query<any>("resolveName", classId)?.(child.name) ??
              this.db.query<any>("resolveSimpleName", classId)?.(child.name))
            : null) ??
          this.db.byName(child.name)?.[0];
        if (baseClass && this.classHasConnect(baseClass.id, visited)) return true;
      }
    }
    return false;
  }

  private _unsupportedWasmCache = new Map<SymbolId, boolean>();

  private static readonly UNSUPPORTED_WASM_IDENTIFIERS = new Set([
    "homotopy",
    "semiLinear",
    "outerProduct",
    "identity",
    "diagonal",
    "StateSelect",
    "Connections",
  ]);

  private cstContainsAnyIdentifier(node: any, names: Set<string>): boolean {
    if (!node) return false;
    const t = node.type;
    if (t === "identifier" || t === "IDENT" || t === "ident") {
      if (names.has(node.text?.trim() ?? "")) return true;
    }
    for (const ch of node.children || []) {
      if (this.cstContainsAnyIdentifier(ch, names)) return true;
    }
    return false;
  }

  private classHasUnsupportedWasmFeatures(classId?: SymbolId | null, visited = new Set<SymbolId>()): boolean {
    if (!classId || visited.has(classId)) return false;
    const cached = this._unsupportedWasmCache.get(classId);
    if (cached !== undefined) return cached;
    visited.add(classId);

    const sym = this.db.symbol(classId);
    if (this.options.intEnumConversion) {
      this._unsupportedWasmCache.set(classId, true);
      return true;
    }
    const cstNode = this.db.cstNode(classId) as any;
    if (cstNode && hasUnsupportedTypeOrConnectorAliasCst(cstNode)) {
      this._unsupportedWasmCache.set(classId, true);
      return true;
    }
    if (cstNode && this.cstContainsAnyIdentifier(cstNode, ModelicaFlattener.UNSUPPORTED_WASM_IDENTIFIERS)) {
      this._unsupportedWasmCache.set(classId, true);
      return true;
    }

    if (
      cstNode &&
      (hasNonStandardEnumKeywordCst(cstNode) ||
        cstHasWholeSliceAssign(cstNode) ||
        cstHasFloatFillArg(cstNode) ||
        cstHasExternalLanguage(cstNode, "FORTRAN 77") ||
        cstHasLeadingDotAfterEqOrParen(cstNode) ||
        (sym?.parentId != null && cstHasKeywordToken(cstNode, "constant")))
    ) {
      this._unsupportedWasmCache.set(classId, true);
      return true;
    }

    if (cstNode && cstHasKeywordToken(cstNode, "for")) {
      const cst = cstNode;
      if (cst) {
        const forEqs: any[] = [];
        const findForEqs = (n: any) => {
          if (!n) return;
          if (n.type === "for_equation" || n.type === "ForEquation") {
            forEqs.push(n);
            return;
          }
          for (const c of n.children || []) findForEqs(c);
        };
        findForEqs(cst);
        const collectCstIdentifiers = (n: any, out: string[]) => {
          if (!n) return;
          if (n.type === "identifier" || n.type === "IDENT") {
            const idTxt = n.text?.trim();
            if (idTxt) out.push(idTxt);
            return;
          }
          if (Array.isArray(n.children) && n.children.length > 0) {
            for (const c of n.children) collectCstIdentifiers(c, out);
          } else if (typeof n.text === "string") {
            const t = n.text.trim();
            if (t.length > 0 && t !== ":" && Number.isNaN(Number(t))) {
              out.push(t);
            }
          }
        };
        for (const fe of forEqs) {
          const fi = fe.children?.find(
            (c: any) =>
              c.type === "for_indices" || c.type === "ForIndices" || c.type === "for_index" || c.type === "ForIndex",
          );
          if (fi) {
            const expr =
              fi.children?.find((c: any) => c.type === "expression" || c.type === "Expression") ??
              fi.children
                ?.find((c: any) => c.type === "for_index" || c.type === "ForIndex")
                ?.children?.find((c: any) => c.type === "expression" || c.type === "Expression");
            if (expr) {
              const idNames: string[] = [];
              collectCstIdentifiers(expr, idNames);
              for (const idName of idNames) {
                const compSym = this.db.byName(idName)?.find((s) => s.parentId === classId && s.kind === "Component");
                if (compSym) {
                  const ci = this.db.query<any>("componentInstance", compSym.id);
                  if (ci && ci.variability !== "parameter" && ci.variability !== "constant") {
                    this._unsupportedWasmCache.set(classId, true);
                    return true;
                  }
                }
              }
            }
          }
        }
      }
    }

    const children = this.db.childrenOf(classId);
    const localCompNames = new Set(children.filter((c) => c.kind === "Component").map((c) => c.name));
    if (localCompNames.size > 0 && cstNode && cstHasComponentMethodCall(cstNode, localCompNames)) {
      this._unsupportedWasmCache.set(classId, true);
      return true;
    }
    for (const child of children) {
      if (child.kind === "Extends") {
        const baseClass =
          this.db.query<any>("resolvedBaseClass", child.id) ??
          (classId
            ? (this.db.query<any>("resolveName", classId)?.(child.name) ??
              this.db.query<any>("resolveSimpleName", classId)?.(child.name))
            : null) ??
          this.db.byName(child.name)?.[0] ??
          (child.name.includes(".") ? this.db.byName(child.name.split(".").pop()!)?.[0] : undefined);
        if (baseClass) {
          if (sym?.resourceId && baseClass.resourceId && baseClass.resourceId !== sym.resourceId) {
            this._unsupportedWasmCache.set(classId, true);
            return true;
          }
          const extModRaw = this.db.query<any>("extendsModificationParsed", child.id);
          const extModArgs: any[] = Array.isArray(extModRaw) ? extModRaw : (extModRaw?.args ?? []);
          if (extModArgs.length > 0) {
            const baseChildren = this.db.childrenOf(baseClass.id) || [];
            for (const mArg of extModArgs) {
              if (
                mArg?.name &&
                baseChildren.some((bc) => bc.name === mArg.name && (bc.kind === "Class" || bc.kind === "Package"))
              ) {
                this._unsupportedWasmCache.set(classId, true);
                return true;
              }
              const valTxt = String(mArg?.value?.text ?? mArg?.bindingExpression ?? "").trim();
              if (valTxt && localCompNames.has(valTxt)) {
                this._unsupportedWasmCache.set(classId, true);
                return true;
              }
            }
          }
          if (localCompNames.size > 0) {
            const baseElems = this.db.query<SymbolId[]>("instantiate", baseClass.id) || [];
            for (const eid of baseElems) {
              const eSym = this.db.symbol(eid);
              if (eSym && eSym.kind === "Component" && localCompNames.has(eSym.name)) {
                this._unsupportedWasmCache.set(classId, true);
                return true;
              }
            }
          }
          if (this.classHasUnsupportedWasmFeatures(baseClass.id, visited)) {
            this._unsupportedWasmCache.set(classId, true);
            return true;
          }
        }
      }
      if (
        child.kind === "Class" ||
        child.kind === "Model" ||
        child.kind === "Block" ||
        child.kind === "Connector" ||
        child.kind === "Record" ||
        this.isRecordSym(child)
      ) {
        if (this.classHasUnsupportedWasmFeatures(child.id, visited)) {
          this._unsupportedWasmCache.set(classId, true);
          return true;
        }
      }
      if (child.kind === "Component") {
        const childCst = this.db.cstNode(child.id) as CstNodeLike | null | undefined;
        const hasConditionAttr = (n: CstNodeLike | null | undefined): boolean => {
          if (!n) return false;
          if (n.type === "condition_attribute" || n.type === "ConditionAttribute") return true;
          if (n.type === "modification" || n.type === "comment" || n.type === "string_comment") return false;
          for (const c of n.children || []) {
            if (hasConditionAttr(c)) return true;
          }
          return false;
        };
        if (hasConditionAttr(childCst)) {
          this._unsupportedWasmCache.set(classId, true);
          return true;
        }
        const compInst = this.db.query<{
          typeSpecifier?: string;
          typeName?: string;
          classInstance?: SymbolId | null;
          classTargetId?: SymbolId | null;
        }>("componentInstance", child.id);
        const rawSpec = String(compInst?.typeSpecifier ?? compInst?.typeName ?? "").trim();
        if (rawSpec.includes(".")) {
          const specParts = rawSpec.split(".");
          const leafSpec = specParts[specParts.length - 1]!;
          if (specParts.slice(0, -1).includes(leafSpec)) {
            this._unsupportedWasmCache.set(classId, true);
            return true;
          }
        }
        const targetClassId =
          this.db.query<SymbolId | null>("classInstance", child.id) ??
          compInst?.classInstance ??
          compInst?.classTargetId;
        const targetClass = targetClassId
          ? this.db.symbol(targetClassId)
          : ((classId && compInst?.typeSpecifier
              ? (this.db.query<any>("resolveName", classId)?.(compInst.typeSpecifier) ??
                this.db.query<any>("resolveSimpleName", classId)?.(compInst.typeSpecifier))
              : null) ??
            this.db.byName(rawSpec)?.[0] ??
            (rawSpec.includes(".") ? this.db.byName(rawSpec.split(".").pop()!)?.[0] : undefined));
        if (
          !targetClassId &&
          rawSpec &&
          rawSpec !== "Real" &&
          rawSpec !== "Integer" &&
          rawSpec !== "Boolean" &&
          rawSpec !== "String" &&
          rawSpec !== "Clock" &&
          rawSpec !== "StateSelect" &&
          rawSpec !== "ExternalObject" &&
          rawSpec !== "AssertionLevel" &&
          !rawSpec.startsWith("enumeration") &&
          !rawSpec.startsWith("SI.") &&
          !rawSpec.startsWith("Modelica.SIunits.") &&
          !rawSpec.startsWith("Modelica.Units.SI.")
        ) {
          this._unsupportedWasmCache.set(classId, true);
          return true;
        }
        if (
          targetClass &&
          ((sym?.resourceId && targetClass.resourceId && targetClass.resourceId !== sym.resourceId) ||
            (targetClass.language && targetClass.language !== "modelica") ||
            typeof (targetClass.metadata as Record<string, unknown> | undefined)?.["lowerComponentToDae"] ===
              "function" ||
            this.isOperatorRecordSym(targetClass) ||
            targetClass.name === "Complex")
        ) {
          this._unsupportedWasmCache.set(classId, true);
          return true;
        }
        const isTypeTarget =
          targetClass &&
          (targetClass.kind === "Type" || String(targetClass.metadata?.classKind ?? "").toLowerCase() === "type");
        if (targetClass && !isTypeTarget && localCompNames.size > 0) {
          const targetCst = this.db.cstNode(targetClass.id) as any;
          if (targetCst && !cstHasKeywordToken(targetCst, "outer") && cstHasEqualsRhsIdent(targetCst, localCompNames)) {
            this._unsupportedWasmCache.set(classId, true);
            return true;
          }
        }
        if (
          targetClass &&
          !isTypeTarget &&
          (targetClass.kind === "Record" ||
            this.isRecordSym(targetClass) ||
            this.classHasUnsupportedWasmFeatures(targetClass.id, visited))
        ) {
          this._unsupportedWasmCache.set(classId, true);
          return true;
        }
      }
    }

    const seenNames = new Set<string>();
    for (const child of children) {
      if (child.name && (child.kind === "Component" || child.kind === "Class")) {
        if (seenNames.has(child.name)) {
          this._unsupportedWasmCache.set(classId, true);
          return true;
        }
        seenNames.add(child.name);
      }
    }
    {
      let fileRootCst: any = cstNode;
      while (fileRootCst?.parent) fileRootCst = fileRootCst.parent;
      if (fileRootCst && cstHasExternalBuiltinOrDerivative(fileRootCst)) {
        this._unsupportedWasmCache.set(classId, true);
        return true;
      }
      const rootChildren = this.db.childrenOf(null) ?? [];
      const topSymbols = rootChildren.filter((s: any) => !sym?.resourceId || s.resourceId === sym.resourceId);
      const topNames = new Set<string>();
      for (const s of topSymbols) {
        if (s.name === "Clock" || topNames.has(s.name)) {
          this._unsupportedWasmCache.set(classId, true);
          return true;
        }
        topNames.add(s.name);
        if (s.kind === "Function" || s.kind === "Class" || s.kind === "Package") {
          const sCst = this.db.cstNode(s.id) as any;
          if (cstHasExternalBuiltinOrDerivative(sCst)) {
            this._unsupportedWasmCache.set(classId, true);
            return true;
          }
        }
      }
    }

    this._unsupportedWasmCache.set(classId, false);
    return false;
  }

  public getUnsupportedWasmReasons(classId?: SymbolId | null, visited = new Set<SymbolId>()): string[] {
    const reasons: string[] = [];
    if (!classId || visited.has(classId)) return reasons;
    visited.add(classId);

    const sym = this.db.symbol(classId);
    const cst = this.db.cstNode(classId) as any;

    if (cst && hasUnsupportedTypeOrConnectorAliasCst(cst)) {
      reasons.push("type-or-connector-alias");
    }
    if (cst && hasNonStandardEnumKeywordCst(cst)) {
      reasons.push("enumeration");
    }
    if (cst && hasConnectionsOrEqualityConstraintCst(cst)) {
      reasons.push("overconstrained-connections");
    }

    const children = this.db.childrenOf(classId);
    for (const child of children) {
      if (child.kind === "Extends") {
        const baseClass =
          this.db.query<any>("resolvedBaseClass", child.id) ??
          (classId
            ? (this.db.query<any>("resolveName", classId)?.(child.name) ??
              this.db.query<any>("resolveSimpleName", classId)?.(child.name))
            : null) ??
          this.db.byName(child.name)?.[0];
        if (baseClass) {
          const subReasons = this.getUnsupportedWasmReasons(baseClass.id, visited);
          if (subReasons.length > 0) {
            reasons.push(`extends:${baseClass.name}(${subReasons[0]})`);
          }
        }
      }
      if (child.kind === "Class" || child.kind === "Model" || child.kind === "Block" || child.kind === "Connector") {
        const subReasons = this.getUnsupportedWasmReasons(child.id, visited);
        if (subReasons.length > 0) {
          reasons.push(`nested-class:${child.name}(${subReasons[0]})`);
        }
      }
      if (child.kind === "Component") {
        const compInst = this.db.query<any>("componentInstance", child.id);
        const targetClassId = compInst?.classInstance ?? compInst?.classTargetId;
        const targetClass = targetClassId
          ? this.db.symbol(targetClassId)
          : ((classId && compInst?.typeSpecifier
              ? (this.db.query<any>("resolveName", classId)?.(compInst.typeSpecifier) ??
                this.db.query<any>("resolveSimpleName", classId)?.(compInst.typeSpecifier))
              : null) ?? this.db.byName(compInst?.typeSpecifier ?? compInst?.typeName ?? "")?.[0]);
        const isTypeTarget =
          targetClass &&
          (targetClass.kind === "Type" || String(targetClass.metadata?.classKind ?? "").toLowerCase() === "type");
        if (targetClass && !isTypeTarget) {
          const subReasons = this.getUnsupportedWasmReasons(targetClass.id, visited);
          if (subReasons.length > 0) {
            reasons.push(`child-component:${child.name}(${subReasons[0]})`);
          }
        }
      }
    }

    const seenNames = new Set<string>();
    for (const child of children) {
      if (child.name && (child.kind === "Component" || child.kind === "Class")) {
        if (seenNames.has(child.name)) {
          reasons.push(`duplicate-name:${child.name}`);
          break;
        }
        seenNames.add(child.name);
      }
    }
    if (sym?.resourceId) {
      const allSyms = typeof (this.db as any).allEntries === "function" ? (this.db as any).allEntries() : [];
      const topSymbols = (allSyms as SymbolEntry[]).filter(
        (s: any) => s.resourceId === sym.resourceId && (s.parentId === null || s.parentId === 0),
      );
      const topNames = new Set<string>();
      for (const s of topSymbols) {
        if (s.name === "Clock" || topNames.has(s.name)) {
          reasons.push("top-clock-or-duplicate");
          break;
        }
        topNames.add(s.name);
      }
    }

    return reasons;
  }

  flattenClass(rootClassId: SymbolId, cachedArena?: DAEBuilder | null): DAEBuilder {
    this.currentRootClassId = rootClassId;
    this.currentClassId = rootClassId;
    this.innerOuterComponents.clear();
    this.innerDeclarations.clear();
    this.disabledComponents.clear();
    this.usedExternalObjects.clear();
    this.usedRecordSymIds.clear();
    this.usedRecordNames.clear();
    this.implicitInners = [];
    this.failedFunctionIds.clear();
    this.invalidInterfaceFunctionIds.clear();
    this.calledFunctionSymIds.clear();
    this.activeLoopVars.clear();
    this.loopVarCounts.clear();
    this.pendingArrayBindings.clear();
    this.usedOperatorFunctions.clear();
    this.expandableBuses.clear();
    this.evaluatedConstantArrays.clear();
    this.varConditionDeps.clear();
    this.activeFlatteningFunctionIds.clear();
    (this as any)._flattenedFunctionCache?.clear();
    this.currentFlatteningFunctionId = null;
    this.currentFunctionEnclosingScope = null;
    this.currentParentMods = undefined;
    this.bodySnapshot = null;
    this.currentImports = this.collectClassImports(rootClassId);
    const rootSym = this.db.symbol(rootClassId);
    const rootName = rootSym?.name ?? "Model";
    const classCst = this.db.cstNode(rootClassId) as any;
    const wasmExports = classCst?.tree?.facade?.exports ?? classCst?.facade?.exports;
    let dae = cachedArena ?? new DAEBuilder(wasmExports, rootName, "");
    this.state = getFlatteningState(dae, this);
    (this as any).currentRootDae = dae;
    this.state.innerOuterComponents = this.innerOuterComponents;
    this.state.activeLoopVars = this.activeLoopVars;
    this.state.db = this.db;
    this.state.flattener = this;
    this.state.currentClassId = rootClassId;
    this.state.isRealNameCache?.clear();
    this.state.varPrefixSet?.clear();
    this.state.varPrefixCount = 0;
    this.fmuComponents.clear();
    const rawKind = (rootSym?.metadata as any)?.classKind ?? (rootSym?.metadata as any)?.classPrefixes ?? "model";
    let specKind: string | null = null;
    if (typeof rawKind === "string") {
      const words = tokenizeCommentStrippedWords(rawKind);
      if (words.includes("package")) specKind = "package";
      else if (words.includes("function")) specKind = "function";
      else if (words.includes("type")) specKind = "type";
      else if (words.includes("operator") && !words.includes("record")) specKind = "operator";
    }
    dae.classKind = specKind ?? rawKind;
    const rootSymForOldInst = this.db.symbol(rootClassId);
    const compilerOpts = extractCompilerOptions(classCst, this.options, this.db, rootSymForOldInst);
    const isOldInst = compilerOpts.isOldFrontend;
    dae.extensionMetadata["isOldFrontend"] = isOldInst;
    dae.extensionMetadata["scalarizeBindings"] = compilerOpts.scalarizeBindings;
    dae.extensionMetadata["scalarizeMinMax"] = compilerOpts.scalarizeMinMax;
    dae.extensionMetadata["isGen"] = compilerOpts.isGen;
    dae.extensionMetadata["ignoreReplaceable"] = compilerOpts.ignoreReplaceable;
    dae.extensionMetadata["omcCompatibility"] = Boolean(this.options.omcCompatibility);
    (dae.extensionMetadata as any).hasOldInstOption = compilerOpts.hasOldInstAnnotation;
    // Check for non-instantiable class specializations (package, function, etc.)
    const classCstForCheck = classCst as SyntaxNode | null;
    const optIsNested = hasNestedCommandLineFlagCst(classCstForCheck, "-d=-newInst");
    const hasExtendsInPkg =
      specKind === "package" &&
      !hasCommandLineFlagInCst(classCstForCheck, "-d=-newInst") &&
      this.db.childrenOf(rootClassId).some((c) => c.kind === "Extends");
    const allowOldInstSpec = isOldInst && !(specKind === "package" && (optIsNested || hasExtendsInPkg));
    if (specKind && !((specKind === "function" || specKind === "package") && allowOldInstSpec)) {
      let startPos = classCstForCheck?.startPosition;
      let startB = classCstForCheck?.startIndex ?? (classCstForCheck as any)?.startOffset ?? 0;
      const pfxNode = classCstForCheck ? Cst.ClassDefinition.classPrefixes(classCstForCheck) : null;
      if (pfxNode?.children) {
        for (const child of pfxNode.children) {
          if (child.type !== "comment" && child.type !== "description") {
            startPos = child.startPosition ?? startPos;
            startB = child.startIndex ?? (child as any).startOffset ?? startB;
            break;
          }
        }
      }
      const range = classCstForCheck
        ? {
            startOffset: startB,
            endOffset: classCstForCheck.endIndex ?? (classCstForCheck as any).endOffset ?? 0,
            startPosition: startPos,
            endPosition: classCstForCheck.endPosition,
          }
        : undefined;
      const msg =
        specKind === "type"
          ? `In class .${rootName}, class specialization 'type' can only be derived from predefined types.`
          : `Cannot instantiate ${rootName} due to class specialization ${specKind}.`;
      dae.diagnostics.push({
        severity: "error",
        message: msg,
        range: specKind === "type" ? undefined : range,
      });
      return dae;
    }

    // Check for partial root class
    const isPartialRoot = this.isClassPartial(rootClassId) || hasClassPrefixWordCst(classCstForCheck, "partial");
    if (isPartialRoot) {
      let startPos = classCstForCheck?.startPosition;
      let startB = classCstForCheck?.startIndex ?? (classCstForCheck as any)?.startOffset ?? 0;
      const pfxNode = classCstForCheck ? Cst.ClassDefinition.classPrefixes(classCstForCheck) : null;
      if (pfxNode?.children) {
        for (const child of pfxNode.children) {
          if (child.type !== "comment" && child.type !== "description") {
            startPos = child.startPosition ?? startPos;
            startB = child.startIndex ?? (child as any).startOffset ?? startB;
            break;
          }
        }
      }
      const range = classCstForCheck
        ? {
            startOffset: startB,
            endOffset: classCstForCheck.endIndex ?? (classCstForCheck as any).endOffset ?? 0,
            startPosition: startPos,
            endPosition: classCstForCheck.endPosition,
          }
        : undefined;
      dae.diagnostics.push({
        severity: "error",
        code: ModelicaErrorCode.PARTIAL_INSTANTIATION.code,
        message: ModelicaErrorCode.PARTIAL_INSTANTIATION.message(rootName),
        range,
      });
      return dae;
    }

    this.validateOperatorRecords(dae, rootClassId);
    this.validateClassSpecializationRestrictions(dae, rootClassId);
    this.extractClassAnnotations(dae, rootClassId);

    this.expandableBuses.clear();
    let useLocalDirection = Boolean(
      (this.options as any)?.useLocalDirection ||
      classCst?.text?.includes("--useLocalDirection") ||
      classCst?.tree?.rootNode?.text?.includes("--useLocalDirection") ||
      (this.db.cstNode(rootClassId) as any)?.text?.includes("--useLocalDirection"),
    );
    if (!useLocalDirection && rootSymForOldInst?.resourceId) {
      const src = (this.db as any).source?.(rootSymForOldInst.resourceId);
      if (typeof src === "string" && src.includes("--useLocalDirection")) {
        useLocalDirection = true;
      }
    }
    this.useLocalDirection = useLocalDirection;
    if (classCst) {
      const findDesc = (n: SyntaxNode | null | undefined): SyntaxNode | null => {
        if (!n) return null;
        if (Cst.LongClassSpecifier.is(n)) return Cst.LongClassSpecifier.description(n);
        if (Cst.ShortClassSpecifier.is(n)) return Cst.ShortClassSpecifier.description(n);
        if (Cst.ClassDefinition.is(n)) {
          const spec = Cst.ClassDefinition.classSpecifier(n);
          const d = findDesc(spec);
          if (d) return d;
        }
        for (const child of n.children) {
          if (Cst.LongClassSpecifier.is(child)) return Cst.LongClassSpecifier.description(child);
          if (Cst.ShortClassSpecifier.is(child)) return Cst.ShortClassSpecifier.description(child);
        }
        return null;
      };
      const descNode = findDesc(classCst);
      if (descNode) {
        let descText = descNode.text?.trim() ?? "";
        if (descText.startsWith('"') && descText.endsWith('"')) {
          descText = descText.slice(1, -1);
          if (descText) dae.description = descText;
        }
      }
    }

    // Validate extends clauses (illegal components in path, replaceable base classes, inherited extends cycles)
    const extendsClauses = this.db.childrenOf(rootClassId).filter((c) => c.kind === "Extends");
    for (let extIdx = 0; extIdx < extendsClauses.length; extIdx++) {
      const ext = extendsClauses[extIdx]!;
      const extCst = this.db.cstNode(ext.id) as any;
      const extRange = extCst
        ? { startOffset: extCst.startIndex ?? extCst.startOffset, endOffset: extCst.endIndex ?? extCst.endOffset }
        : undefined;

      const parts = ext.name.split(".");
      let currentScope: SymbolEntry | null = this.db.symbol(rootClassId) ?? null;
      const isEncapsulatedRoot = isScopeEncapsulated(this.db, rootClassId);
      const resolvedChain: { name: string; symbol: SymbolEntry | null }[] = [];
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i]!;
        let resolved: SymbolEntry | null = null;
        if (i === 0) {
          const resolver =
            this.db.query<(n: string) => SymbolEntry | null>("resolveSimpleName", currentScope?.id ?? rootClassId) ??
            this.db.query<(n: string) => SymbolEntry | null>("resolveName", currentScope?.id ?? rootClassId);
          resolved = resolver ? resolver(part) : null;
          if (!resolved && !isEncapsulatedRoot) {
            resolved = this.db.byName(part).find((e) => e.kind === "Class" || e.kind === "Component") ?? null;
          }
        } else {
          if (currentScope) {
            resolved = this.db.childrenOf(currentScope.id).find((c) => c.name === part) ?? null;
          }
        }
        resolvedChain.push({ name: part, symbol: resolved });
        currentScope = resolved;
      }

      if (!currentScope && isEncapsulatedRoot) {
        const scopeFQN = getSymbolQualifiedName(this.db, rootClassId);
        dae.diagnostics.push({
          severity: "error",
          code: ModelicaErrorCode.BASE_CLASS_NOT_FOUND_IN_SCOPE.code,
          message: ModelicaErrorCode.BASE_CLASS_NOT_FOUND_IN_SCOPE.message(ext.name, scopeFQN),
          range: extRange,
        });
        return dae;
      }

      // Check 1: Part of base class name is a component instead of a class
      for (const item of resolvedChain) {
        if (item.symbol && item.symbol.kind === "Component") {
          const compCst = this.db.cstNode(item.symbol.id) as any;
          let clauseCst = compCst;
          while (clauseCst && clauseCst.type !== "component_clause" && clauseCst.parent) {
            clauseCst = clauseCst.parent;
          }
          const targetCst = clauseCst && clauseCst.type === "component_clause" ? clauseCst : compCst;
          const compRange = targetCst
            ? {
                startOffset: targetCst.startIndex ?? targetCst.startOffset,
                endOffset: targetCst.endIndex ?? targetCst.endOffset,
              }
            : undefined;
          dae.diagnostics.push({
            severity: "notification",
            code: ModelicaErrorCode.NOTIFICATION_FROM_HERE.code,
            message: "From here:",
            range: compRange,
          });
          dae.diagnostics.push({
            severity: "error",
            code: ModelicaErrorCode.PARTIAL_BASE_CLASS.code,
            message: `Part ${item.name} of base class name ${ext.name} is not a class.`,
            range: extRange,
          });
          return dae;
        }
      }

      // Check 1b: Part of base class name is partial, name lookup is not allowed in partial classes
      for (let i = 0; i < parts.length - 1; i++) {
        const item = resolvedChain[i];
        if (item?.symbol && this.isClassPartial(item.symbol.id)) {
          dae.diagnostics.push({
            severity: "error",
            code: ModelicaErrorCode.PARTIAL_LOOKUP_DISALLOWED.code,
            message: ModelicaErrorCode.PARTIAL_LOOKUP_DISALLOWED.message(item.name),
            range: extRange,
          });
          return dae;
        }
      }

      // Check 2: Replaceable base class or segment
      for (let i = 0; i < resolvedChain.length; i++) {
        const item = resolvedChain[i]!;
        if (item.symbol) {
          const isRep = this.db.query<boolean>("isReplaceable", item.symbol.id);
          if (isRep) {
            const repCst = this.db.cstNode(item.symbol.id) as any;
            let repParent = repCst;
            while (repParent && repParent.type !== "element") {
              if (repParent.type === "composition") break;
              repParent = repParent.parent;
            }
            const targetRepNode = repParent ?? repCst;
            const repRange = targetRepNode
              ? {
                  startOffset: targetRepNode.startIndex ?? targetRepNode.startOffset,
                  endOffset: targetRepNode.endIndex ?? targetRepNode.endOffset,
                }
              : undefined;

            const annotatedPath =
              parts.length === 1 ? parts[0] : parts.map((p, idx) => (idx === i ? `<${p}>` : p)).join(".");

            dae.diagnostics.push({
              severity: "notification",
              code: ModelicaErrorCode.NOTIFICATION_FROM_HERE.code,
              message: "From here:",
              range: repRange,
            });
            dae.diagnostics.push({
              severity: "error",
              code: ModelicaErrorCode.REPLACEABLE_BASE_CLASS.code,
              message: `Class '${item.name}' in 'extends ${annotatedPath}' is replaceable, the base class name must be transitively non-replaceable.`,
              range: extRange,
            });
            return dae;
          }
        }
      }

      // Check 3: Base class name depends on inherited elements from prior extends clauses
      const firstPart = parts[0];
      const priorMatches: { prevExt: SymbolEntry; prevBase: SymbolEntry; innerClass: SymbolEntry }[] = [];
      for (let j = 0; j < extIdx; j++) {
        const prevExt = extendsClauses[j]!;
        const prevBase =
          this.db.query<SymbolEntry | null>("resolvedBaseClass", prevExt.id) ??
          this.db.byName(prevExt.name).find((e) => e.kind === "Class");
        if (prevBase) {
          const innerClass = this.db.childrenOf(prevBase.id).find((c) => c.kind === "Class" && c.name === firstPart);
          if (innerClass) {
            priorMatches.push({ prevExt, prevBase, innerClass });
          }
        }
      }
      if (priorMatches.length > 0) {
        dae.diagnostics.push({
          severity: "error",
          code: ModelicaErrorCode.BASE_CLASS_AMBIGUOUS.code,
          message: `The base class name ${firstPart} was found in one or more base classes:`,
          range: extRange,
        });
        for (const m of priorMatches) {
          const innerCst = this.db.cstNode(m.innerClass.id) as any;
          const innerRange = innerCst
            ? {
                startOffset: innerCst.startIndex ?? innerCst.startOffset,
                endOffset: innerCst.endIndex ?? innerCst.endOffset,
              }
            : undefined;
          const prevExtCst = this.db.cstNode(m.prevExt.id) as any;
          const prevExtRange = prevExtCst
            ? {
                startOffset: prevExtCst.startIndex ?? prevExtCst.startOffset,
                endOffset: prevExtCst.endIndex ?? prevExtCst.endOffset,
              }
            : undefined;

          dae.diagnostics.push({
            severity: "notification",
            code: ModelicaErrorCode.NOTIFICATION_FROM_HERE.code,
            message: "From here:",
            range: innerRange,
          });
          dae.diagnostics.push({
            severity: "error",
            code: ModelicaErrorCode.BASE_CLASS_FOUND_IN.code,
            message: `${firstPart} was found in base class ${m.prevBase.name}.`,
            range: prevExtRange,
          });
        }
        return dae;
      }
    }

    // Check 4: Class specialization violation for short class specifiers and redeclarations
    const checkedClassSyms = new Set<SymbolId>();
    for (const child of this.db.childrenOf(rootClassId)) {
      if (child.kind === "Class") {
        checkedClassSyms.add(child.id);
        const violation = this.checkTypeAliasSpecialization(child.id);
        if (violation) {
          dae.diagnostics.push({
            severity: "error",
            code: ModelicaErrorCode.CLASS_SPECIALIZATION_VIOLATION.code,
            message: `Class specialization violation: .${violation.targetName} is ${violation.kindDesc}, not a type.`,
            range: violation.range,
          });
          return dae;
        }
      }
    }
    if (rootSym?.resourceId) {
      const fileSyms = this.getFileSymbols(rootSym.resourceId);
      for (const s of fileSyms) {
        if (s.kind === "Class" && !checkedClassSyms.has(s.id)) {
          const violation = this.checkTypeAliasSpecialization(s.id);
          if (violation) {
            dae.diagnostics.push({
              severity: "error",
              code: ModelicaErrorCode.CLASS_SPECIALIZATION_VIOLATION.code,
              message: `Class specialization violation: .${violation.targetName} is ${violation.kindDesc}, not a type.`,
              range: violation.range,
            });
            return dae;
          }
        }
      }
    }
    const rootModForSpec = this.db.query<any>("effectiveModification", rootClassId);
    if (rootModForSpec?.args) {
      for (const arg of rootModForSpec.args) {
        if (arg.isRedeclaration && arg.redeclaredTypeSpecifier) {
          const targetClass = this.db
            .byName(arg.redeclaredTypeSpecifier.split(".").pop()!)
            .find((e) => e.kind === "Class");
          if (targetClass && !this.isClassType(targetClass.id)) {
            const targetCst = this.db.cstNode(targetClass.id) as any;
            const prefixes = Cst.ClassDefinition.classPrefixes(targetCst);
            const prefixWords = tokenizeCommentStrippedWords(prefixes?.text ?? "");
            let kindDesc = "a new def";
            if (prefixWords.includes("model")) kindDesc = "a model";
            else if (prefixWords.includes("block")) kindDesc = "a block";
            else if (prefixWords.includes("record")) kindDesc = "a record";
            else if (prefixWords.includes("connector")) kindDesc = "a connector";

            const rootCst = this.db.cstNode(rootClassId) as any;
            const r = findRedeclareTypeSpecRangeCst(rootCst, arg.name, arg.redeclaredTypeSpecifier);
            if (r) {
              dae.diagnostics.push({
                severity: "error",
                code: ModelicaErrorCode.CLASS_SPECIALIZATION_VIOLATION.code,
                message: `Class specialization violation: .${arg.redeclaredTypeSpecifier} is ${kindDesc}, not a type.`,
                range: r,
              });
              return dae;
            }
          }
        }
      }
    }

    // 1. Check for duplicate top-level symbols in the same file (DoubleClassDeclaration1, ErrorMultipleClasses, Clock2)
    if (rootSym?.resourceId) {
      const topLevelSymbols = (this.db.childrenOf(null) ?? []).filter(
        (s: any) => s.resourceId === rootSym.resourceId && (s.kind === "Class" || s.kind === "Component"),
      );

      const seenTop = new Map<string, SymbolEntry>();
      for (const s of topLevelSymbols) {
        // Built-in type check for top-level classes
        if (
          s.name === "Clock" ||
          s.name === "Real" ||
          s.name === "Integer" ||
          s.name === "Boolean" ||
          s.name === "String"
        ) {
          const currCst = this.db.cstNode(s.id) as any;
          dae.diagnostics.push({
            severity: "notification",
            code: ModelicaErrorCode.NOTIFICATION_FROM_HERE.code,
            message: "From here:",
            range: undefined,
          });
          dae.diagnostics.push({
            severity: "error",
            code: ModelicaErrorCode.DUPLICATE_ELEMENT.code,
            message: ModelicaErrorCode.DUPLICATE_ELEMENT.message(s.name),
            range: this.getElementDiagRange(currCst),
          });
          return dae;
        }

        const prev = seenTop.get(s.name);
        if (prev) {
          const prevCst = this.db.cstNode(prev.id) as any;
          const currCst = this.db.cstNode(s.id) as any;
          dae.diagnostics.push({
            severity: "notification",
            code: ModelicaErrorCode.NOTIFICATION_FROM_HERE.code,
            message: "From here:",
            range: this.getElementDiagRange(prevCst),
          });
          dae.diagnostics.push({
            severity: "error",
            code: ModelicaErrorCode.DUPLICATE_ELEMENT.code,
            message: ModelicaErrorCode.DUPLICATE_ELEMENT.message(s.name),
            range: this.getElementDiagRange(currCst),
          });
          return dae;
        }
        seenTop.set(s.name, s);
      }
    }

    // 2. Check for duplicate local elements in rootClassId or any nested class (DuplicateElements1..4, DoubleClassDeclaration2, DoubleFuncDeclaration)
    const checkDuplicateScopeElements = (classId: SymbolId): boolean => {
      const localElems = this.db.childrenOf(classId).filter((c) => c.kind === "Component" || c.kind === "Class");
      const seenLocal = new Map<string, SymbolEntry>();
      for (const elem of localElems) {
        const prevElem = seenLocal.get(elem.name);
        if (prevElem) {
          const prevCst = this.db.cstNode(prevElem.id) as any;
          const currCst = this.db.cstNode(elem.id) as any;
          const isRedecl = (node: any) => {
            let curr = node;
            while (curr && curr.type !== "class_definition") {
              if (
                curr.type === "element" &&
                (curr.text?.trim().startsWith("redeclare") || curr.text?.includes("redeclare "))
              )
                return true;
              curr = curr.parent;
            }
            return false;
          };
          if (isRedecl(currCst) || isRedecl(prevCst)) {
            continue;
          }

          const prevRange = this.getElementDiagRange(prevCst);
          const currRange = this.getElementDiagRange(currCst);

          let notifRange = prevRange;
          let errorRange = currRange;
          // In OMC, if one is Class and one is Component, the Class is reported as the original (notification)
          if (elem.kind === "Component" && prevElem.kind === "Class") {
            notifRange = prevRange;
            errorRange = currRange;
          } else if (elem.kind === "Class" && prevElem.kind === "Component") {
            notifRange = currRange;
            errorRange = prevRange;
          }
          if (dae.extensionMetadata?.["isOldFrontend"] && elem.kind === "Component" && prevElem.kind === "Component") {
            const getClause = (node: any) => {
              let curr = node;
              while (curr && curr.type !== "component_clause") curr = curr.parent;
              return curr ?? node;
            };
            const prevCl = getClause(prevCst);
            const currCl = getClause(currCst);
            let prevText = stripTrailingSemicolon(prevCl?.text ?? "");
            const currText = stripTrailingSemicolon(currCl?.text ?? "");
            prevText = moveTypeArrayDimToCompName(prevText);
            const classImports = this.collectClassImports(classId);
            const resolveImportText = (txt: string) => {
              let res = txt;
              for (const [alias, target] of classImports) {
                res = replaceAliasDotPrefix(res, alias, target).text;
              }
              return res;
            };
            const resolvedPrev = resolveImportText(prevText);
            const resolvedCurr = resolveImportText(currText);
            if (resolvedPrev === resolvedCurr) {
              const fmtPrev = startsWithPrimitiveTypeWord(resolvedPrev) ? resolvedPrev : `.${resolvedPrev}`;
              dae.diagnostics.push({
                severity: "error",
                code: ModelicaErrorCode.DUPLICATE_ELEMENT.code,
                message: `Duplicate elements:\n ${fmtPrev}.`,
                range: this.getElementDiagRange(prevCl),
              });
              return true;
            }
            dae.diagnostics.push({
              severity: "notification",
              code: ModelicaErrorCode.NOTIFICATION_FROM_HERE.code,
              message: "From here:",
              range: this.getElementDiagRange(currCl),
            });
            dae.diagnostics.push({
              severity: "error",
              code: ModelicaErrorCode.DUPLICATE_INHERITED_ELEMENT_NOT_IDENTICAL.code,
              message: `Duplicate elements (due to inherited elements) not identical:\n  first element is:  ${currText}\n  second element is: ${prevText}`,
              range: this.getElementDiagRange(prevCl),
            });
            return true;
          }

          dae.diagnostics.push({
            severity: "notification",
            code: ModelicaErrorCode.NOTIFICATION_FROM_HERE.code,
            message: "From here:",
            range: notifRange,
          });
          dae.diagnostics.push({
            severity: "error",
            code: ModelicaErrorCode.DUPLICATE_ELEMENT.code,
            message: ModelicaErrorCode.DUPLICATE_ELEMENT.message(elem.name),
            range: errorRange,
          });
          return true;
        }
        seenLocal.set(elem.name, elem);
      }

      for (const elem of localElems) {
        if (elem.kind === "Class") {
          if (checkDuplicateScopeElements(elem.id)) return true;
        }
      }
      return false;
    };

    if (checkDuplicateScopeElements(rootClassId)) {
      return dae;
    }

    const localComps = this.db.childrenOf(rootClassId).filter((c) => c.kind === "Component");
    for (const comp of localComps) {
      const compCst = this.db.cstNode(comp.id) as any;
      let clauseNode: any = compCst;
      while (clauseNode && clauseNode.type !== "component_clause" && clauseNode.type !== "class_definition") {
        clauseNode = clauseNode.parent;
      }
      if (clauseNode && clauseNode.type === "component_clause") {
        const typeSpecNode = clauseNode.children?.find((c: any) => c.type === "type_specifier");
        const typeSpec = typeSpecNode?.text?.trim();
        if (typeSpec && !typeSpec.includes(".") && comp.name === typeSpec) {
          const rangeObj = {
            startOffset: clauseNode.startIndex ?? clauseNode.startOffset,
            endOffset: clauseNode.endIndex ?? clauseNode.endOffset,
            startPosition: clauseNode.startPosition,
            endPosition: clauseNode.endPosition,
          };
          dae.diagnostics.push({
            severity: "error",
            code: ModelicaErrorCode.SAME_NAME_TYPE_SHADOWING.code,
            message: `Found a component with same name when looking for type ${typeSpec}.`,
            range: rangeObj,
          });
          return dae;
        }
      }
    }

    for (const ext of extendsClauses) {
      const extCst = this.db.cstNode(ext.id) as any;
      const extendsModParsedRaw = this.db.query<any>("extendsModificationParsed", ext.id);
      const extendsModParsed: any[] = Array.isArray(extendsModParsedRaw)
        ? extendsModParsedRaw
        : (extendsModParsedRaw?.args ?? []);
      for (const arg of extendsModParsed) {
        if (arg.isRedeclaration && arg.redeclaredTypeSpecifier) {
          if (!arg.redeclaredTypeSpecifier.includes(".") && arg.name === arg.redeclaredTypeSpecifier) {
            const redeclRange = findRedeclareSameNameRangeCst(extCst, arg.name);
            dae.diagnostics.push({
              severity: "error",
              code: ModelicaErrorCode.SAME_NAME_TYPE_SHADOWING.code,
              message: `Found a component with same name when looking for type ${arg.redeclaredTypeSpecifier}.`,
              range: redeclRange,
            });
            return dae;
          }
        }
      }
    }

    // Check for duplicate elements due to inherited elements and invalid break on record components
    const checkInheritedAndBreakErrors = (targetClassId: SymbolId): boolean => {
      const targetChildren = this.db.childrenOf(targetClassId);
      const targetExtends = targetChildren.filter((c) => c.kind === "Extends");
      const targetLocalComps = targetChildren.filter((c) => c.kind === "Component");
      const targetImports = this.collectClassImports(targetClassId);
      const isOldFE = Boolean(this.options.isOldFrontend || dae.extensionMetadata?.["isOldFrontend"]);
      const seenInheritedComps = new Map<
        string,
        { elem: SymbolEntry; clause: any; range: { startOffset: number; endOffset: number }; modText: string | null }
      >();

      const getClause = (node: any) => {
        let curr = node;
        while (curr && curr.type !== "component_clause") curr = curr.parent;
        if (curr && curr.parent && curr.parent.type === "element") {
          const parentText = curr.parent.text?.trim() ?? "";
          if (parentText.startsWith("final")) {
            return curr.parent;
          }
        }
        return curr;
      };

      const toRange = (clause: any, fallbackCst: any) =>
        clause
          ? {
              startOffset: clause.startIndex ?? clause.startOffset,
              endOffset: clause.endIndex ?? clause.endOffset,
            }
          : {
              startOffset: fallbackCst?.startIndex ?? fallbackCst?.startOffset ?? 0,
              endOffset: fallbackCst?.endIndex ?? fallbackCst?.endOffset ?? 0,
            };

      const formatArrayDimBeforeName = (txt: string) => moveCompArrayDimToTypeName(txt);

      for (const ext of targetExtends) {
        const baseClass =
          this.db.query<SymbolEntry | null>("resolvedBaseClass", ext.id) ??
          (targetClassId
            ? (this.db.query<any>("resolveName", targetClassId)?.(ext.name) ??
              this.db.query<any>("resolveSimpleName", targetClassId)?.(ext.name))
            : null) ??
          this.db.byName(ext.name)[0];
        if (!baseClass) continue;

        if (targetClassId === rootClassId) {
          const innerConflict = this.db
            .childrenOf(baseClass.id)
            .find((c) => c.name === ext.name && (c.kind === "Class" || c.kind === "Package"));
          if (innerConflict) {
            const extCst = this.db.cstNode(ext.id) as any;
            const conflictCst = this.db.cstNode(innerConflict.id) as any;
            dae.diagnostics.push({
              severity: "notification",
              code: ModelicaErrorCode.NOTIFICATION_FROM_HERE.code,
              message: "From here:",
              range: {
                startOffset: extCst?.startIndex ?? extCst?.startOffset,
                endOffset: extCst?.endIndex ?? extCst?.endOffset,
                startPosition: extCst?.startPosition,
                endPosition: extCst?.endPosition,
              },
            });
            dae.diagnostics.push({
              severity: "error",
              code: ModelicaErrorCode.EXTENDS_OTHER_BASE_CLASS.code,
              message: ModelicaErrorCode.EXTENDS_OTHER_BASE_CLASS.message(ext.name),
              range: {
                startOffset: conflictCst?.startIndex ?? conflictCst?.startOffset,
                endOffset: conflictCst?.endIndex ?? conflictCst?.endOffset,
                startPosition: conflictCst?.startPosition,
                endPosition: conflictCst?.endPosition,
              },
            });
            return true;
          }
        }

        const extendsModParsedRaw = this.db.query<any>("extendsModificationParsed", ext.id);
        const extendsModParsed: any[] = Array.isArray(extendsModParsedRaw)
          ? extendsModParsedRaw
          : (extendsModParsedRaw?.args ?? []);
        const baseElements = this.db.query<SymbolId[]>("instantiate", baseClass.id) || [];
        const brokenNames = new Set<string>();
        const extCst = this.db.cstNode(ext.id) as any;

        for (const arg of extendsModParsed) {
          if ((arg.isBreak || arg.value?.kind === "break") && !arg.name.startsWith("break_connect:")) {
            brokenNames.add(arg.name);
            for (const baseElemId of baseElements) {
              const baseElem = this.db.symbol(baseElemId);
              if (baseElem && baseElem.kind === "Component" && baseElem.name === arg.name) {
                const compClassId = this.db.query<SymbolId | null>("classInstance", baseElem.id);
                const compClassSym = compClassId ? this.db.symbol(compClassId) : null;
                if (compClassSym && (compClassSym.kind === "Record" || this.isRecordSym(compClassSym))) {
                  const baseCst = this.db.cstNode(baseElem.id) as any;
                  const baseClause = getClause(baseCst);
                  const baseRange = toRange(baseClause, baseCst);
                  const notifRange = arg.nameRange
                    ? { startOffset: arg.nameRange[0], endOffset: arg.nameRange[1] }
                    : toRange(null, extCst);
                  dae.diagnostics.push({
                    severity: "notification",
                    code: ModelicaErrorCode.NOTIFICATION_FROM_HERE.code,
                    message: "From here:",
                    range: notifRange,
                  });
                  dae.diagnostics.push({
                    severity: "error",
                    code: 4099,
                    message: `Invalid use of break on component '${arg.name}', component must be a model, block, or connector.`,
                    range: baseRange,
                  });
                  return true;
                }
              }
            }
          }
        }

        for (const baseElemId of baseElements) {
          const baseElem = this.db.symbol(baseElemId);
          if (!baseElem || baseElem.kind !== "Component") continue;
          if (brokenNames.has(baseElem.name)) continue;

          const baseCst = this.db.cstNode(baseElem.id) as any;
          const baseClause = getClause(baseCst);
          const baseRange = toRange(baseClause, baseCst);

          const extModArg = extendsModParsed.find(
            (a) => !a.isBreak && a.name === baseElem.name && (a.value?.text || a.bindingExpression),
          );
          const currModVal: string | null = extModArg
            ? String(extModArg.value?.text ?? extModArg.bindingExpression).trim()
            : null;

          const prevInh = seenInheritedComps.get(baseElem.name);
          if (prevInh && prevInh.elem.id !== baseElem.id) {
            if ((prevInh.modText !== null) !== (currModVal !== null)) {
              const prevRaw = formatArrayDimBeforeName(stripTrailingSemicolon(prevInh.clause?.text ?? ""));
              const currRaw = formatArrayDimBeforeName(stripTrailingSemicolon(baseClause?.text ?? baseCst?.text ?? ""));
              const applyModBinding = (raw: string, modVal: string | null) => {
                if (!modVal) return raw;
                const eqIdx = raw.indexOf("=");
                if (eqIdx >= 0 && !raw.slice(eqIdx + 1).includes(";")) {
                  return `${raw.slice(0, eqIdx)}= ${modVal}`;
                }
                return `${raw} = ${modVal}`;
              };
              const firstText = applyModBinding(prevRaw, prevInh.modText);
              const secondText = applyModBinding(currRaw, currModVal);
              if (firstText !== secondText) {
                dae.diagnostics.push({
                  severity: "notification",
                  code: ModelicaErrorCode.NOTIFICATION_FROM_HERE.code,
                  message: "From here:",
                  range: prevInh.range,
                });
                dae.diagnostics.push({
                  severity: "error",
                  code: ModelicaErrorCode.DUPLICATE_INHERITED_ELEMENT_NOT_IDENTICAL.code,
                  message: `Duplicate elements (due to inherited elements) not identical:\n  first element is:  ${firstText}\n  second element is: ${secondText}`,
                  range: baseRange,
                });
                return true;
              }
            }
          }
          seenInheritedComps.set(baseElem.name, {
            elem: baseElem,
            clause: baseClause ?? baseCst,
            range: baseRange,
            modText: currModVal,
          });

          const matchingLocal = targetLocalComps.find((c) => c.name === baseElem.name);
          if (matchingLocal) {
            const isRedecl = this.db.query<boolean>("isRedeclare", matchingLocal.id);
            if (!isRedecl) {
              const localCst = this.db.cstNode(matchingLocal.id) as any;
              const localClause = getClause(localCst);
              const localRange = toRange(localClause, localCst);
              const extStart = extCst?.startIndex ?? extCst?.startOffset ?? 0;

              const localText = stripTrailingSemicolon(localClause?.text ?? localCst?.text ?? "");
              const baseText = stripTrailingSemicolon(baseClause?.text ?? baseCst?.text ?? "");

              let resolvedLocalText = localText;
              let usedImportAlias = false;
              for (const [alias, target] of targetImports) {
                const replaced = replaceAliasDotPrefix(resolvedLocalText, alias, target);
                if (replaced.changed) {
                  usedImportAlias = true;
                  resolvedLocalText = replaced.text;
                }
              }

              const canonicalizeDeclCst = (
                clauseNode: CstNodeLike | null | undefined,
                rawFallback: string,
                imports?: Map<string, string>,
              ): string => {
                const isTrivialTrueCond = (n: CstNodeLike | null | undefined): boolean => {
                  if (!n || (n.type !== "condition_attribute" && n.type !== "ConditionAttribute")) return false;
                  const children = (n.children || []).filter(
                    (c: CstNodeLike | null | undefined) =>
                      c?.type !== "if" && c?.text?.trim() !== "if" && c?.text?.trim() !== "",
                  );
                  if (children.length === 1 && children[0]?.text?.trim() === "true") return true;
                  const txt = (n.text ?? "").trim();
                  return txt.startsWith("if") && txt.slice(2).trim() === "true";
                };

                const tokens: string[] = [];
                const collectTokens = (n: CstNodeLike | null | undefined): void => {
                  if (!n) return;
                  if (isTrivialTrueCond(n)) return;
                  if (
                    !isOldFE &&
                    (n.type === "comment" ||
                      n.type === "Comment" ||
                      n.type === "string_comment" ||
                      n.type === "StringComment" ||
                      n.type === "description" ||
                      n.type === "Description" ||
                      n.type === "description_string" ||
                      n.type === "DescriptionString" ||
                      n.type === "annotation" ||
                      n.type === "Annotation" ||
                      n.type === "annotation_clause")
                  ) {
                    return;
                  }
                  if (Array.isArray(n.children) && n.children.length > 0) {
                    for (const ch of n.children) collectTokens(ch);
                    return;
                  }
                  const t = (n.text ?? "").trim();
                  if (t && t !== ";") tokens.push(t);
                };

                if (clauseNode && Array.isArray(clauseNode.children) && clauseNode.children.length > 0) {
                  collectTokens(clauseNode);
                } else {
                  const parsedTokens = parseComponentDeclTokensCst(rawFallback, !isOldFE, isTrivialTrueCond);
                  if (parsedTokens !== null) {
                    tokens.push(...parsedTokens);
                  } else {
                    const s = rawFallback.trim();
                    const trimmed = s.endsWith("if true") ? s.slice(0, -7).trim() : s;
                    for (const tok of trimmed.split(" ")) {
                      for (const sub of tok.split("\t")) {
                        if (sub) tokens.push(sub);
                      }
                    }
                  }
                }

                let joined = "";
                for (const tok of tokens) {
                  if (!joined) {
                    joined = tok;
                  } else if (
                    tok === "(" ||
                    tok === ")" ||
                    tok === "[" ||
                    tok === "]" ||
                    tok === "." ||
                    tok === "," ||
                    joined.endsWith("(") ||
                    joined.endsWith("[") ||
                    joined.endsWith(".")
                  ) {
                    joined += tok;
                  } else {
                    joined += ` ${tok}`;
                  }
                }
                // Normalize `ident=val` inside single-token leaves if any
                let normalized = "";
                let inQuote = false;
                for (let idx = 0; idx < joined.length; idx++) {
                  const ch = joined[idx]!;
                  if (ch === '"') inQuote = !inQuote;
                  if (!inQuote && ch === "=") {
                    const prev = normalized[normalized.length - 1];
                    if (
                      prev &&
                      prev !== " " &&
                      prev !== ":" &&
                      prev !== "<" &&
                      prev !== ">" &&
                      prev !== "=" &&
                      prev !== "/"
                    ) {
                      normalized += " ";
                    }
                    normalized += "=";
                    const next = joined[idx + 1];
                    if (next && next !== " " && next !== "=") {
                      normalized += " ";
                    }
                  } else {
                    normalized += ch;
                  }
                }
                if (imports && imports.size > 0) {
                  for (const [alias, target] of imports) {
                    const prefix = `${alias}.`;
                    if (normalized.startsWith(prefix)) {
                      normalized = `${target}.${normalized.slice(prefix.length)}`;
                    }
                    normalized = normalized.replaceAll(` ${prefix}`, ` ${target}.`);
                  }
                }
                return normalized.trim();
              };

              if (
                canonicalizeDeclCst(localClause ?? localCst, resolvedLocalText, targetImports) ===
                canonicalizeDeclCst(baseClause ?? baseCst, baseText)
              ) {
                continue;
              }

              let firstRange = localRange;
              let secondRange = baseRange;
              let firstText = localText;
              let secondText = baseText;

              if (isOldFE) {
                let localDisp = formatParenModArgEquals(resolvedLocalText);
                if (usedImportAlias && !localDisp.startsWith(".")) {
                  localDisp = `.${localDisp}`;
                }
                let baseDisp = dotPrefixPrimitiveTypeWords(formatParenModArgEquals(baseText));
                if (startsWithDottedIdentifierPair(baseDisp)) {
                  baseDisp = `.${baseDisp}`;
                }
                firstText = localDisp;
                secondText = baseDisp;
              } else {
                if (localRange.startOffset > extStart) {
                  firstRange = baseRange;
                  secondRange = localRange;
                  firstText = baseText;
                  secondText = localText;
                }
              }

              dae.diagnostics.push({
                severity: "notification",
                code: ModelicaErrorCode.NOTIFICATION_FROM_HERE.code,
                message: "From here:",
                range: firstRange,
              });
              dae.diagnostics.push({
                severity: "error",
                code: ModelicaErrorCode.DUPLICATE_INHERITED_ELEMENT_NOT_IDENTICAL.code,
                message: `Duplicate elements (due to inherited elements) not identical:\n  first element is:  ${firstText}\n  second element is: ${secondText}`,
                range: secondRange,
              });
              return true;
            }
          }
        }
      }

      for (const comp of targetLocalComps) {
        const compClassId = this.db.query<SymbolId | null>("classInstance", comp.id);
        const compInst = this.db.query<any>("componentInstance", comp.id);
        const modArgs: any[] = compInst?.modification?.args ?? [];
        if (compClassId && modArgs.length > 0) {
          for (const arg of modArgs) {
            if (arg.isBreak || !arg.name) continue;
            const nestedArgs: any[] = arg.nestedArgs ?? arg.args ?? [];
            if (nestedArgs.length === 0) continue;
            const member = classFindMember(this, compClassId, arg.name);
            if (
              member &&
              (member.kind === "Class" || member.kind === "Package") &&
              !this.db.query<boolean>("isReplaceable", member.id)
            ) {
              const memberCst = this.db.cstNode(member.id) as any;
              const isPkg =
                member.kind === "Package" ||
                String((member.metadata as any)?.classKind ?? "").toLowerCase() === "package" ||
                hasClassPrefixWordCst(memberCst, "package");
              if (isPkg) {
                for (const nestedArg of nestedArgs) {
                  if (!nestedArg?.name) continue;
                  const nestedMember = classFindMember(this, member.id, nestedArg.name);
                  if (nestedMember && nestedMember.kind === "Component") {
                    const compCst = this.db.cstNode(comp.id) as any;
                    const compClause = getClause(compCst);
                    const compRange = toRange(compClause, compCst);
                    dae.diagnostics.push({
                      severity: "error",
                      code: ModelicaErrorCode.CLASS_NOT_FOUND.code,
                      message: `Found component '${nestedArg.name}' in composite name '${comp.name}.${arg.name}.${nestedArg.name}', expected class.`,
                      range: compRange,
                    });
                    return true;
                  }
                }
              }
            }
          }
        }
      }
      return false;
    };

    if (checkInheritedAndBreakErrors(rootClassId)) {
      return dae;
    }
    for (const comp of localComps) {
      const compClassId = this.db.query<SymbolId | null>("classInstance", comp.id);
      if (compClassId && checkInheritedAndBreakErrors(compClassId)) {
        return dae;
      }
    }

    this.evaluatedConstantArrays.clear();
    if (this.options.omcCompatibility) {
      this.generateFunctions(rootClassId, dae);
    }

    let flattenedInWasm = false;
    let wasmBail: WasmBailInfo | null = null;
    const classNodePtr = classCst?.ptr ?? classCst?.id;
    const rootProgramPtr =
      classCst?.tree?.rootPtr ?? classCst?.tree?.rootNode?.ptr ?? (this.db as any)?.rootNode?.ptr ?? 0;
    const hasWasmFlattener = typeof dae.exports?.flattener_flatten === "function";
    const isStrictWasm = this.options.backend === "wasm";
    const isDiffMode = this.options.backend === "diff";
    const allowWasm =
      this.explicitArrayMode !== "preserve" &&
      (this.options.backend === "wasm" ||
        ((this.options.backend === "hybrid" || !this.options.backend) &&
          // Explicit `backend: "wasm"` runs WASM under `omcCompatibility` (via `flattener_setOmcCompatibility`),
          // whereas `hybrid` stays on TS for OMC-exact formatting parity until WASM passes the full OMC testsuite.
          !this.options.omcCompatibility &&
          Boolean(this.options.useWasmKernel) &&
          !this.useLocalDirection &&
          !this.classHasUnsupportedWasmFeatures(rootClassId)));

    let wasmDiffStats: {
      varCount: number;
      eqCount: number;
      bail?: WasmBailInfo | undefined;
      error?: string | undefined;
    } | null = null;
    if (isDiffMode && hasWasmFlattener && classNodePtr) {
      let testDae: DAEBuilder | null = null;
      let wf = 0;
      try {
        testDae = new DAEBuilder(wasmExports, rootName, "");
        wf = testDae.exports.flattener_create ? testDae.exports.flattener_create(testDae.ptr) : 0;
        if (wf) {
          const testEx = testDae.exports as unknown as {
            flattener_setOmcCompatibility?: (wf: number, flags: number) => void;
          };
          if (
            (this.options.omcCompatibility || this.useLocalDirection) &&
            typeof testEx.flattener_setOmcCompatibility === "function"
          ) {
            const omcFlags =
              (this.options.omcCompatibility ? (isOldInst ? 1 : 2) : 0) | (this.useLocalDirection ? 4 : 0);
            testEx.flattener_setOmcCompatibility(wf, omcFlags);
          }
          this.populateWasmScopeResolutions(wf, rootClassId, testDae);
          const vc = testDae.exports.flattener_flatten(wf, classNodePtr, rootProgramPtr);
          const errCode =
            typeof testDae.exports.flattener_getErrorCode === "function"
              ? testDae.exports.flattener_getErrorCode(wf)
              : 0;
          const ex = testDae.exports as any;
          const diffBail =
            errCode !== 0
              ? describeWasmBail(
                  errCode,
                  typeof ex.flattener_getErrorStartByte === "function" ? ex.flattener_getErrorStartByte(wf) : undefined,
                  typeof ex.flattener_getErrorEndByte === "function" ? ex.flattener_getErrorEndByte(wf) : undefined,
                  "ts-fallback",
                  typeof ex.lsp_isCharOffsetKernel === "function" && ex.lsp_isCharOffsetKernel()
                    ? 1
                    : inputEncodingUnitSize(
                        typeof ex.lsp_getInputEncoding === "function" ? ex.lsp_getInputEncoding() : undefined,
                      ),
                )
              : undefined;
          wasmDiffStats = { varCount: vc, eqCount: testDae.eqCount, bail: diffBail };
        }
      } catch (err: any) {
        wasmDiffStats = { varCount: 0, eqCount: 0, error: err?.message ?? String(err) };
      } finally {
        if (wf && (testDae?.exports as any)?.flattener_destroy) {
          try {
            (testDae!.exports as any).flattener_destroy(wf);
          } catch {
            // ignore
          }
        }
        if (testDae) {
          testDae.free?.();
        }
      }
      (this as any)._wasmDiffStats = wasmDiffStats;
    }

    let wasmErrStartByte = -1;
    let wasmErrEndByte = -1;
    if (!cachedArena && hasWasmFlattener && classNodePtr && allowWasm) {
      let wasmFlattener = 0;
      let trappedInWasm = false;
      try {
        wasmFlattener = dae.exports.flattener_create(dae.ptr);
        if (wasmFlattener) {
          const daeOmcEx = dae.exports as unknown as {
            flattener_setOmcCompatibility?: (wf: number, flags: number) => void;
          };
          if (
            (this.options.omcCompatibility || this.useLocalDirection) &&
            typeof daeOmcEx.flattener_setOmcCompatibility === "function"
          ) {
            const omcFlags =
              (this.options.omcCompatibility ? (isOldInst ? 1 : 2) : 0) | (this.useLocalDirection ? 4 : 0);
            daeOmcEx.flattener_setOmcCompatibility(wasmFlattener, omcFlags);
          }
          this.populateWasmScopeResolutions(wasmFlattener, rootClassId, dae);
          const varCount = dae.exports.flattener_flatten(wasmFlattener, classNodePtr, rootProgramPtr);
          const wasmErrorCode =
            typeof dae.exports.flattener_getErrorCode === "function"
              ? dae.exports.flattener_getErrorCode(wasmFlattener)
              : 0;
          this.state.wasmErrorCode = wasmErrorCode;
          // In hybrid mode, if WASM flattener set a non-zero error code, fall back to TS
          const disabledCount =
            typeof (dae.exports as any)?.flattener_getDisabledCount === "function"
              ? (dae.exports as any).flattener_getDisabledCount(wasmFlattener)
              : 0;
          if (wasmErrorCode !== 0) {
            const ex = dae.exports as any;
            wasmErrStartByte =
              typeof ex.flattener_getErrorStartByte === "function" ? ex.flattener_getErrorStartByte(wasmFlattener) : -1;
            wasmErrEndByte =
              typeof ex.flattener_getErrorEndByte === "function" ? ex.flattener_getErrorEndByte(wasmFlattener) : -1;
            wasmBail = describeWasmBail(
              wasmErrorCode,
              wasmErrStartByte >= 0 ? wasmErrStartByte : undefined,
              wasmErrEndByte >= 0 ? wasmErrEndByte : undefined,
              isStrictWasm ? "strict-partial" : "ts-fallback",
              typeof ex.lsp_isCharOffsetKernel === "function" && ex.lsp_isCharOffsetKernel()
                ? 1
                : inputEncodingUnitSize(
                    typeof ex.lsp_getInputEncoding === "function" ? ex.lsp_getInputEncoding() : undefined,
                  ),
            );
            const srcFiles = (this.state as any).wasmSourceFiles as
              | {
                  key: string;
                  text: string;
                  utf8Bytes?: Uint8Array;
                  baseUnitOffset: number;
                  unitLen: number;
                  isUtf16: boolean;
                }[]
              | undefined;
            if (wasmBail.range && srcFiles) {
              const sOff = wasmBail.range.startOffset;
              const eOff = wasmBail.range.endOffset;
              const entry = srcFiles.find((f) => sOff >= f.baseUnitOffset && sOff < f.baseUnitOffset + f.unitLen);
              if (entry) {
                const lStart = sOff - entry.baseUnitOffset;
                const lEnd = Math.min(entry.unitLen, Math.max(lStart + 1, eOff - entry.baseUnitOffset));
                const snip =
                  !entry.isUtf16 && entry.utf8Bytes
                    ? new TextDecoder().decode(entry.utf8Bytes.subarray(lStart, Math.min(lEnd, lStart + 240)))
                    : entry.text.slice(lStart, Math.min(lEnd, lStart + 240));
                (wasmBail as any).file = entry.key;
                (wasmBail as any).snippet = snip;
              }
            }
          }
          const algSectionCount: number =
            typeof (dae.exports as any).flattener_getAlgorithmSectionCount === "function"
              ? (dae.exports as any).flattener_getAlgorithmSectionCount(wasmFlattener)
              : 0;
          const hybridAlgorithmGate =
            !isStrictWasm &&
            wasmErrorCode === 0 &&
            algSectionCount > 0 &&
            Boolean((this.options as any)?.allowNonStandardModelica?.length);
          if (hybridAlgorithmGate) {
            wasmBail = describeWasmBail(WasmBailReason.HybridAlgorithmGate, undefined, undefined, "ts-fallback");
          }
          const whenRecCount: number =
            typeof (dae.exports as any).flattener_getWhenRecordCount === "function"
              ? (dae.exports as any).flattener_getWhenRecordCount(wasmFlattener)
              : 0;
          const ifRecCount: number =
            typeof (dae.exports as any).flattener_getIfRecordCount === "function"
              ? (dae.exports as any).flattener_getIfRecordCount(wasmFlattener)
              : 0;
          if ((varCount > 0 || disabledCount > 0 || isStrictWasm) && wasmErrorCode === 0 && !hybridAlgorithmGate) {
            flattenedInWasm = true;
            this.recordWasmSourceRanges(dae, rootClassId);
            if (disabledCount > 0 && typeof (dae.exports as any)?.flattener_getDisabledNameId === "function") {
              for (let d = 0; d < disabledCount; d++) {
                const nameId = (dae.exports as any).flattener_getDisabledNameId(wasmFlattener, d);
                const disabledName = nameId === 0 ? "" : dae.interner.resolve(nameId);
                if (disabledName) {
                  this.disabledComponents.add(disabledName);
                }
              }
            }
            // Ensure any user/external functions called inside WASM-instantiated subcomponents
            // (e.g., Modelica.Math.acos or TimeTable.getInterpolationCoefficients) are flattened into dae.functions.
            {
              const origExprCount = dae.exprCount;
              const isFunctionSym = (s: SymbolEntry | undefined): boolean => {
                if (!s) return false;
                if (s.kind === "Function") return true;
                if (s.kind !== "Class") return false;
                const rk = String(s.metadata?.["classKind"] ?? s.metadata?.["classPrefixes"] ?? "").toLowerCase();
                return rk.includes("function");
              };
              const resolveFnSymbol = (callName: string) => {
                if (callName.includes(".")) {
                  const parts = callName.split(".");
                  const roots = this.db.byName(parts[0]!) ?? [];
                  for (const rootSym of roots) {
                    if (rootSym.kind !== "Class" && rootSym.kind !== "Package") continue;
                    let cur: typeof rootSym | undefined = rootSym;
                    for (let p = 1; p < parts.length && cur; p++) {
                      const chs = this.db.childrenOf(cur.id);
                      cur = chs.find(
                        (c) =>
                          (c.kind === "Class" || c.kind === "Package" || c.kind === "Function") && c.name === parts[p],
                      );
                    }
                    if (cur && isFunctionSym(cur)) return cur;
                  }
                } else {
                  const cands = (this.db.byName(callName) ?? []).filter((s) => isFunctionSym(s));
                  if (cands.length === 1) return cands[0];
                }
                return undefined;
              };
              const scannedCalls = new Set<string>();
              for (let eIdx = 0; eIdx < origExprCount; eIdx++) {
                if (dae.getExprKind(eIdx) !== ExprKind.Call) continue;
                const rawCallName = dae.interner.resolve(dae.getExprData1(eIdx));
                if (!rawCallName || dae.functions.has(rawCallName) || scannedCalls.has(rawCallName)) continue;
                scannedCalls.add(rawCallName);
                const fnSym = resolveFnSymbol(rawCallName);
                if (!fnSym) continue;
                const fnQualName = getSymbolQualifiedName(this.db, fnSym.id);
                if (!dae.functions.has(fnQualName)) {
                  const fn = this.flattenFunction(fnSym.id, fnQualName, undefined, dae);
                  foldArenaConstants(fn, this.db, fnSym.id, true);
                  (fn as { wasCalled?: boolean }).wasCalled = true;
                  dae.addFunction(fnQualName, fn);
                }
                if (rawCallName !== fnQualName && !dae.functions.has(rawCallName)) {
                  const fnObj = dae.functions.get(fnQualName);
                  if (fnObj) dae.functions.set(rawCallName, fnObj);
                }
              }
            }
            // Rewrite enum-indexed array element names (e.g., e1[1] -> e1[E.AA], x[1] -> x[Color.green])
            const daeExprEx = dae.exports as unknown as {
              dae_setExprData1?: (ptr: number, idx: number, data1: number) => void;
            };
            if (typeof daeExprEx.dae_setExprData1 === "function") {
              const arrayBaseIndices = new Map<string, Array<{ fullName: string; indices: number[] }>>();
              for (let v = 0; v < dae.varCount; v++) {
                const vName = dae.getVarName(v);
                const lb = vName.lastIndexOf("[");
                if (lb <= 0 || !vName.endsWith("]")) continue;
                const subStr = vName.slice(lb + 1, -1);
                const parts = subStr.split(",");
                if (!parts.every((p) => /^\d+$/.test(p))) continue;
                const base = vName.slice(0, lb);
                let arr = arrayBaseIndices.get(base);
                if (!arr) {
                  arr = [];
                  arrayBaseIndices.set(base, arr);
                }
                arr.push({ fullName: vName, indices: parts.map((p) => Number(p)) });
              }
              if (arrayBaseIndices.size > 0) {
                const resolveClassInScope = (name: string, scId: SymbolId | null) => {
                  if (scId && !name.includes(".")) {
                    const resolver = this.db.query<((n: string) => SymbolEntry | undefined) | null>(
                      "resolveSimpleName",
                      scId,
                    );
                    const resolved = resolver?.(name);
                    if (resolved?.id) return this.db.symbol(resolved.id);
                  }
                  if (name.includes(".")) {
                    const segs = name.split(".");
                    for (const rootSym of this.db.byName(segs[0]!) ?? []) {
                      if (rootSym.kind !== "Class" && rootSym.kind !== "Package" && rootSym.kind !== "Type") continue;
                      let cur: typeof rootSym | undefined = rootSym;
                      for (let i = 1; i < segs.length && cur; i++) {
                        cur = this.db.childrenOf(cur.id).find((c) => c.name === segs[i]);
                      }
                      if (cur) return cur;
                    }
                  } else {
                    const cands = (this.db.byName(name) ?? []).filter((s) => s.kind === "Class" || s.kind === "Type");
                    if (cands.length === 1) return cands[0];
                  }
                  return undefined;
                };
                const resolveEnumTypeLiterals = (typeName: string, scopeId: SymbolId | null): string[] | null => {
                  let curSym = resolveClassInScope(typeName, scopeId);
                  for (let hop = 0; hop < 6 && curSym; hop++) {
                    const cst = this.db.cstNode(curSym.id) as CstNodeLike | null;
                    if (!cst) break;
                    const enumList = findFirstCstNode(cst, (n) => n.type === "enum_list");
                    if (enumList) {
                      const rawQualName = getSymbolQualifiedName(this.db, curSym.id);
                      const rootQNameForEnum = getSymbolQualifiedName(this.db, rootClassId);
                      const isNewInstEnum = !(this.options.isOldFrontend || dae.extensionMetadata?.["isOldFrontend"]);
                      const qualName =
                        isNewInstEnum && rootQNameForEnum && rawQualName.startsWith(`${rootQNameForEnum}.`)
                          ? rawQualName.slice(rootQNameForEnum.length + 1)
                          : rawQualName;
                      const lits: string[] = [];
                      const walkEnum = (n: CstNodeLike) => {
                        if (n.type === "enumeration_literal") {
                          const idNode = findFirstCstNode(
                            n,
                            (c) => c.type === "IDENT" || c.type === "identifier" || c.type === "IDENTIFIER",
                          );
                          const litText = (idNode?.text ?? n.text ?? "").trim();
                          if (litText) lits.push(`${qualName}.${litText}`);
                          return;
                        }
                        if (n.children) {
                          for (const c of n.children) if (c) walkEnum(c);
                        }
                      };
                      walkEnum(enumList);
                      return lits.length > 0 ? lits : null;
                    }
                    const shortSpec = findFirstCstNode(cst, (n) => n.type === "short_class_specifier");
                    const baseTypeNode = shortSpec
                      ? findFirstCstNode(shortSpec, (n) => n.type === "type_specifier" || n.type === "name")
                      : null;
                    const baseName = baseTypeNode?.text?.trim();
                    if (!baseName || baseName === curSym.name) break;
                    curSym = resolveClassInScope(baseName, curSym.parentId ?? scopeId);
                  }
                  return null;
                };
                const renameMap = new Map<string, string>();
                for (const [baseName, entries] of arrayBaseIndices) {
                  const leaf = baseName.includes(".") ? baseName.slice(baseName.lastIndexOf(".") + 1) : baseName;
                  const compSyms = (this.db.byName(leaf) ?? []).filter((s) => s.kind === "Component");
                  let dimEnums: Array<string[] | null> | null = null;
                  for (const compSym of compSyms) {
                    const cst = this.db.cstNode(compSym.id) as CstNodeLike | null;
                    if (!cst) continue;
                    let subNode = findFirstCstNode(cst, (n) => n.type === "array_subscripts");
                    let anc = cst.parent;
                    for (let hop = 0; hop < 4 && !subNode && anc; hop++, anc = anc.parent) {
                      if (
                        anc.type === "component_clause" ||
                        anc.type === "component_clause1" ||
                        anc.type === "component_declaration"
                      ) {
                        subNode = findFirstCstNode(anc, (n) => n.type === "array_subscripts");
                      }
                    }
                    if (!subNode) {
                      const typeSpec = this.db.query<string | null>("typeSpecifier", compSym.id);
                      if (typeSpec) {
                        const typeSym = resolveClassInScope(typeSpec, compSym.parentId ?? rootClassId);
                        const typeCst = typeSym ? (this.db.cstNode(typeSym.id) as CstNodeLike | null) : null;
                        if (typeCst) {
                          subNode = findFirstCstNode(typeCst, (n) => n.type === "array_subscripts");
                        }
                      }
                    }
                    if (!subNode) continue;
                    const subs: string[] = [];
                    const collectSubs = (n: CstNodeLike) => {
                      if (n.type === "subscript") {
                        subs.push((n.text ?? "").trim());
                        return;
                      }
                      if (n.children) {
                        for (const c of n.children) if (c) collectSubs(c);
                      }
                    };
                    collectSubs(subNode);
                    if (subs.length === 0) continue;
                    const resolvedDims = subs.map((s) =>
                      s === "Boolean"
                        ? ["false", "true"]
                        : s && s !== ":" && !/^\d+$/.test(s)
                          ? resolveEnumTypeLiterals(s, compSym.parentId ?? rootClassId)
                          : null,
                    );
                    if (resolvedDims.some((d) => d !== null)) {
                      dimEnums = resolvedDims;
                      break;
                    }
                  }
                  if (!dimEnums) continue;
                  for (const entry of entries) {
                    if (entry.indices.length !== dimEnums.length) continue;
                    let changed = false;
                    const newParts = entry.indices.map((idx, d) => {
                      const lits = dimEnums![d];
                      if (lits && idx >= 1 && idx <= lits.length) {
                        changed = true;
                        return lits[idx - 1]!;
                      }
                      return String(idx);
                    });
                    if (changed) {
                      renameMap.set(entry.fullName, `${baseName}[${newParts.join(",")}]`);
                    }
                  }
                }
                if (renameMap.size > 0) {
                  for (const [oldName, newName] of renameMap) {
                    dae.renameVar(oldName, newName);
                  }
                  for (let eIdx = 0; eIdx < dae.exprCount; eIdx++) {
                    if (dae.getExprKind(eIdx) !== ExprKind.Name) continue;
                    const oldName = dae.interner.resolve(dae.getExprData1(eIdx));
                    const newName = oldName ? renameMap.get(oldName) : undefined;
                    if (newName) {
                      daeExprEx.dae_setExprData1!(dae.ptr, eIdx, dae.interner.intern(newName));
                    }
                  }
                }
              }
            }
            if (typeof daeExprEx.dae_setExprData1 === "function") {
              const MATH_BUILTIN_NAMES = new Set([
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
              const origExprCount = dae.exprCount;
              for (let eIdx = 0; eIdx < origExprCount; eIdx++) {
                if (dae.getExprKind(eIdx) === ExprKind.Call) {
                  const rawCallName = dae.interner.resolve(dae.getExprData1(eIdx));
                  const fnDae = rawCallName ? dae.functions.get(rawCallName) : undefined;
                  if (!fnDae && rawCallName && rawCallName.startsWith("Modelica.Math.")) {
                    const shortName = rawCallName.slice("Modelica.Math.".length);
                    if (MATH_BUILTIN_NAMES.has(shortName)) {
                      const newId = dae.interner.intern(shortName);
                      (dae.exports as any).dae_setExprData1(dae.ptr, eIdx, newId);
                      continue;
                    }
                  }
                  if (fnDae) {
                    if (
                      rawCallName &&
                      !rawCallName.includes(".") &&
                      (BUILTIN_FUNCTIONS.has(rawCallName) || SCALAR_VECTORIZABLE_FUNCTIONS.has(rawCallName)) &&
                      fnDae.name.startsWith("Modelica.ComplexMath.")
                    ) {
                      dae.functions.delete(rawCallName);
                      continue;
                    }
                    (fnDae as { wasCalled?: boolean }).wasCalled = true;
                    let targetFnCallName =
                      fnDae.externalDecl && fnDae.externalDecl.includes('"builtin"') ? rawCallName : fnDae.name;
                    if (fnDae.externalDecl) {
                      const builtinCallee = extractBuiltinSinCosCalleeCst(fnDae.externalDecl);
                      if (builtinCallee) {
                        targetFnCallName = builtinCallee;
                      } else if (
                        fnDae.name.startsWith("Modelica.Math.") &&
                        (fnDae.externalDecl.includes('"builtin"') || fnDae.externalDecl.includes('"C"'))
                      ) {
                        const shortName = fnDae.name.slice("Modelica.Math.".length);
                        if (MATH_BUILTIN_NAMES.has(shortName)) {
                          targetFnCallName = shortName;
                        }
                      }
                    }
                    if (targetFnCallName && targetFnCallName !== rawCallName) {
                      const newId = dae.interner.intern(targetFnCallName);
                      (dae.exports as any).dae_setExprData1(dae.ptr, eIdx, newId);
                    }
                    if (typeof (dae.exports as any).flattener_setExprLeft === "function") {
                      const inputVarIndices: number[] = [];
                      for (let v = 0; v < fnDae.varCount; v++) {
                        if (fnDae.getVarCausality(v) === Causality.Input) {
                          inputVarIndices.push(v);
                        }
                      }
                      const argCount = dae.getExprRight(eIdx);
                      const limit = Math.min(argCount, inputVarIndices.length);
                      for (let argIdx = 0; argIdx < limit; argIdx++) {
                        const slotId = argIdx === 0 ? eIdx : eIdx + argIdx;
                        const argExprId = dae.getExprLeft(slotId);
                        if (argExprId === 0xffffffff || argExprId >= dae.exprCount) continue;
                        const formalVarIdx = inputVarIndices[argIdx]!;
                        const formalType = fnDae.getVarType(formalVarIdx);
                        const formalShape = fnDae.getVarShape(formalVarIdx);
                        if (
                          formalType === VarType.Real &&
                          !fnDae.getVarCustomType(formalVarIdx) &&
                          dae.getExprKind(argExprId) === ExprKind.IntLiteral
                        ) {
                          const realLitId = dae.addRealLiteral(dae.getExprData1(argExprId));
                          (dae.exports as any).flattener_setExprLeft(dae.ptr, slotId, realLitId);
                        } else if ((formalShape?.length ?? 0) === 1 && dae.getExprKind(argExprId) === ExprKind.Name) {
                          const argName = dae.interner.resolve(dae.getExprData1(argExprId));
                          if (
                            argName &&
                            dae.getVarIdxByName(argName) < 0 &&
                            dae.getVarIdxByName(`${argName}[1]`) >= 0
                          ) {
                            const elemIds: number[] = [];
                            for (let k = 1; dae.getVarIdxByName(`${argName}[${k}]`) >= 0; k++) {
                              elemIds.push(dae.addNameExpr(`${argName}[${k}]`));
                            }
                            if (elemIds.length > 0) {
                              const arrCtorId = dae.addArrayCtorExpr(elemIds);
                              (dae.exports as any).flattener_setExprLeft(dae.ptr, slotId, arrCtorId);
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
            const exAlg = dae.exports as any;
            if (typeof exAlg.flattener_getAlgorithmSectionCount === "function") {
              const secCount: number = exAlg.flattener_getAlgorithmSectionCount(wasmFlattener);
              for (let s = 0; s < secCount; s++) {
                const section = {
                  start: exAlg.flattener_getAlgorithmSectionStart(wasmFlattener, s) as number,
                  count: exAlg.flattener_getAlgorithmSectionLength(wasmFlattener, s) as number,
                };
                if (exAlg.flattener_getAlgorithmSectionIsInitial(wasmFlattener, s)) {
                  dae.initialAlgorithmSections.push(section);
                } else {
                  dae.algorithmSections.push(section);
                }
              }
              if (secCount > 0) dae.hasAlgorithmSection = true;
            }
            interface InlineEqRecord {
              kind: EqKind;
              lhsExprId: number;
              rhsExprId: number;
              thenEquations?: InlineEqRecord[] | undefined;
              elseIfClauses?:
                | {
                    conditionExprId: number;
                    bodyEquations: InlineEqRecord[];
                    equations: { kind: EqKind; lhs: number; rhs: number }[];
                  }[]
                | undefined;
              elseEquations?: InlineEqRecord[] | undefined;
            }
            interface ParsedIfRec {
              ifEqIdx: number;
              conditionExprId: number;
              thenEquations: InlineEqRecord[];
              elseIfClauses: {
                conditionExprId: number;
                bodyEquations: InlineEqRecord[];
                equations: { kind: EqKind; lhs: number; rhs: number }[];
              }[];
              elseEquations: InlineEqRecord[];
            }
            const parsedIfRecords: ParsedIfRec[] = [];
            const materializeInlineEq = (kind: EqKind, lhs: number, rhs: number): InlineEqRecord => {
              if (kind === EqKind.If && rhs >= 0 && rhs < parsedIfRecords.length) {
                const sub = parsedIfRecords[rhs]!;
                return {
                  kind: EqKind.If,
                  lhsExprId: lhs,
                  rhsExprId: -1,
                  thenEquations: sub.thenEquations,
                  elseIfClauses: sub.elseIfClauses,
                  elseEquations: sub.elseEquations.length > 0 ? sub.elseEquations : undefined,
                };
              }
              return { kind, lhsExprId: lhs, rhsExprId: rhs };
            };
            const exIf = dae.exports as unknown as {
              flattener_getIfRecordCount?: (wf: number) => number;
              flattener_getIfRecordData: (wf: number, idx: number) => number;
            };
            if (typeof exIf.flattener_getIfRecordCount === "function" && ifRecCount > 0) {
              let offset = 0;
              for (let f = 0; f < ifRecCount; f++) {
                const ifEqIdx = exIf.flattener_getIfRecordData(wasmFlattener, offset++);
                const condExprId = exIf.flattener_getIfRecordData(wasmFlattener, offset++);
                const thenEqCount = exIf.flattener_getIfRecordData(wasmFlattener, offset++);
                const thenEquations: InlineEqRecord[] = [];
                for (let k = 0; k < thenEqCount; k++) {
                  const kind = exIf.flattener_getIfRecordData(wasmFlattener, offset++) as EqKind;
                  const lhs = exIf.flattener_getIfRecordData(wasmFlattener, offset++);
                  const rhs = exIf.flattener_getIfRecordData(wasmFlattener, offset++);
                  thenEquations.push(materializeInlineEq(kind, lhs, rhs));
                }
                const elseIfBranchCount = exIf.flattener_getIfRecordData(wasmFlattener, offset++);
                const elseIfClauses: {
                  conditionExprId: number;
                  bodyEquations: InlineEqRecord[];
                  equations: { kind: EqKind; lhs: number; rhs: number }[];
                }[] = [];
                for (let b = 0; b < elseIfBranchCount; b++) {
                  const elseCondId = exIf.flattener_getIfRecordData(wasmFlattener, offset++);
                  const bEqCount = exIf.flattener_getIfRecordData(wasmFlattener, offset++);
                  const bBodyEquations: InlineEqRecord[] = [];
                  const bEquations: { kind: EqKind; lhs: number; rhs: number }[] = [];
                  for (let k = 0; k < bEqCount; k++) {
                    const kind = exIf.flattener_getIfRecordData(wasmFlattener, offset++) as EqKind;
                    const lhs = exIf.flattener_getIfRecordData(wasmFlattener, offset++);
                    const rhs = exIf.flattener_getIfRecordData(wasmFlattener, offset++);
                    const eqObj = materializeInlineEq(kind, lhs, rhs);
                    bBodyEquations.push(eqObj);
                    bEquations.push({ kind, lhs, rhs: eqObj.rhsExprId });
                  }
                  elseIfClauses.push({
                    conditionExprId: elseCondId,
                    bodyEquations: bBodyEquations,
                    equations: bEquations,
                  });
                }
                const elseEqCount = exIf.flattener_getIfRecordData(wasmFlattener, offset++);
                const elseEquations: InlineEqRecord[] = [];
                for (let k = 0; k < elseEqCount; k++) {
                  const kind = exIf.flattener_getIfRecordData(wasmFlattener, offset++) as EqKind;
                  const lhs = exIf.flattener_getIfRecordData(wasmFlattener, offset++);
                  const rhs = exIf.flattener_getIfRecordData(wasmFlattener, offset++);
                  elseEquations.push(materializeInlineEq(kind, lhs, rhs));
                }
                const rec: ParsedIfRec = {
                  ifEqIdx,
                  conditionExprId: condExprId,
                  thenEquations,
                  elseIfClauses,
                  elseEquations,
                };
                parsedIfRecords.push(rec);
                if (ifEqIdx >= 0) {
                  dae.setIfEquationMeta(ifEqIdx, {
                    conditionExprId: condExprId,
                    thenEquations,
                    elseIfClauses,
                    elseEquations: elseEquations.length > 0 ? elseEquations : undefined,
                  });
                }
              }
            }
            const exWhen = dae.exports as unknown as {
              flattener_getWhenRecordCount?: (wf: number) => number;
              flattener_getWhenRecordData: (wf: number, idx: number) => number;
            };
            if (typeof exWhen.flattener_getWhenRecordCount === "function" && whenRecCount > 0) {
              let offset = 0;
              for (let w = 0; w < whenRecCount; w++) {
                const whenEqIdx = exWhen.flattener_getWhenRecordData(wasmFlattener, offset++);
                const condExprId = exWhen.flattener_getWhenRecordData(wasmFlattener, offset++);
                const mainEqCount = exWhen.flattener_getWhenRecordData(wasmFlattener, offset++);
                const bodyEquations: InlineEqRecord[] = [];
                const equations: { kind: EqKind; lhs: number; rhs: number }[] = [];
                for (let k = 0; k < mainEqCount; k++) {
                  const kind = exWhen.flattener_getWhenRecordData(wasmFlattener, offset++) as EqKind;
                  const lhs = exWhen.flattener_getWhenRecordData(wasmFlattener, offset++);
                  const rhs = exWhen.flattener_getWhenRecordData(wasmFlattener, offset++);
                  const eqObj = materializeInlineEq(kind, lhs, rhs);
                  bodyEquations.push(eqObj);
                  equations.push({ kind, lhs, rhs: eqObj.rhsExprId });
                }
                const elseWhenBranchCount = exWhen.flattener_getWhenRecordData(wasmFlattener, offset++);
                const elseWhenClauses: {
                  conditionExprId: number;
                  bodyEquations: InlineEqRecord[];
                  equations: { kind: EqKind; lhs: number; rhs: number }[];
                }[] = [];
                for (let b = 0; b < elseWhenBranchCount; b++) {
                  const elseCondId = exWhen.flattener_getWhenRecordData(wasmFlattener, offset++);
                  const bEqCount = exWhen.flattener_getWhenRecordData(wasmFlattener, offset++);
                  const bBodyEquations: InlineEqRecord[] = [];
                  const bEquations: { kind: EqKind; lhs: number; rhs: number }[] = [];
                  for (let k = 0; k < bEqCount; k++) {
                    const kind = exWhen.flattener_getWhenRecordData(wasmFlattener, offset++) as EqKind;
                    const lhs = exWhen.flattener_getWhenRecordData(wasmFlattener, offset++);
                    const rhs = exWhen.flattener_getWhenRecordData(wasmFlattener, offset++);
                    const eqObj = materializeInlineEq(kind, lhs, rhs);
                    bBodyEquations.push(eqObj);
                    bEquations.push({ kind, lhs, rhs: eqObj.rhsExprId });
                  }
                  elseWhenClauses.push({
                    conditionExprId: elseCondId,
                    bodyEquations: bBodyEquations,
                    equations: bEquations,
                  });
                }
                dae.setWhenEquationMeta(whenEqIdx, {
                  conditionExprId: condExprId,
                  bodyEquations,
                  equations,
                  elseWhenClauses,
                  elseEquations: [],
                });
              }
            }
            const exEqDesc = dae.exports as unknown as {
              flattener_getEqDescCount?: (wf: number) => number;
              flattener_getEqDescEqIdx?: (wf: number, idx: number) => number;
              flattener_getEqDescStrId?: (wf: number, idx: number) => number;
            };
            if (
              this.options.omcCompatibility &&
              !isOldInst &&
              typeof exEqDesc.flattener_getEqDescCount === "function" &&
              typeof exEqDesc.flattener_getEqDescEqIdx === "function" &&
              typeof exEqDesc.flattener_getEqDescStrId === "function"
            ) {
              const descCount = exEqDesc.flattener_getEqDescCount(wasmFlattener);
              for (let i = 0; i < descCount; i++) {
                const eqIdx = exEqDesc.flattener_getEqDescEqIdx(wasmFlattener, i);
                const strId = exEqDesc.flattener_getEqDescStrId(wasmFlattener, i);
                const descStr = dae.interner.resolve(strId);
                if (descStr) dae.setEqDescription(eqIdx, descStr);
              }
            }
            for (let i = 0; i < dae.eqCount; i++) {
              const rhsId = dae.getEqRhs(i);
              dae.setOrigEqRhs(i, rhsId);
              if (rhsId >= 0) {
                const names = dae.collectExprVarNames(rhsId);
                for (const name of names) {
                  dae.registerParamEquationDep(name, i);
                }
              }
              const lhsId = dae.getEqLhs(i);
              if (lhsId >= 0) {
                const names = dae.collectExprVarNames(lhsId);
                for (const name of names) {
                  dae.registerParamEquationDep(name, i);
                }
              }
            }
            if (typeof (dae.exports as any)?.flattener_getExpandableBusCount === "function") {
              const busCount = (dae.exports as any).flattener_getExpandableBusCount(wasmFlattener);
              const busPrefixes: string[] = [];
              for (let b = 0; b < busCount; b++) {
                const id = (dae.exports as any).flattener_getExpandableBus(wasmFlattener, b);
                const busName = id === 0 ? "" : (dae.interner.resolve(id) ?? "");
                busPrefixes.push(busName);
                this.expandableBuses.set(busName, 0 as any);
              }
              dae.extensionMetadata.expandableBuses = busPrefixes;
            }
            if (typeof (dae.exports as any)?.flattener_getArrayCount === "function") {
              const exArr = dae.exports as any;
              const aCount = exArr.flattener_getArrayCount(wasmFlattener);
              for (let a = 0; a < aCount; a++) {
                const nameId = exArr.flattener_getArrayName(wasmFlattener, a);
                const name = dae.interner.resolve(nameId);
                if (name) {
                  const nDims = exArr.flattener_getArrayNDims(wasmFlattener, a);
                  const d1 = exArr.flattener_getArrayDim1(wasmFlattener, a);
                  const d2 = exArr.flattener_getArrayDim2(wasmFlattener, a);
                  const d3 = exArr.flattener_getArrayDim3(wasmFlattener, a);
                  const d4 =
                    typeof exArr.flattener_getArrayDim4 === "function"
                      ? exArr.flattener_getArrayDim4(wasmFlattener, a)
                      : 0;
                  const shape: number[] = [];
                  if (nDims >= 1) shape.push(d1);
                  if (nDims >= 2) shape.push(d2);
                  if (nDims >= 3) shape.push(d3);
                  if (nDims >= 4) shape.push(d4);
                  dae.setNamedArrayShape(name, shape);
                }
              }
            }
            const exIO = dae.exports as any;
            if (typeof exIO.flattener_getInnerCount === "function") {
              const innerCount = exIO.flattener_getInnerCount(wasmFlattener);
              const innerSet: Set<string> = (this.state.innerComponents ??= new Set<string>());
              for (let idx = 0; idx < innerCount; idx++) {
                const fullPathId = exIO.flattener_getInnerFullPath(wasmFlattener, idx);
                const fullPath = dae.interner.resolve(fullPathId);
                if (fullPath) {
                  innerSet.add(fullPath);
                  this.innerOuterComponents.add(fullPath);
                }
              }
            }
            if (typeof exIO.flattener_getOuterMapCount === "function") {
              const outerCount = exIO.flattener_getOuterMapCount(wasmFlattener);
              const outerMap: Map<string, string> = (this.state.outerToInner ??= new Map<string, string>());
              const innerSet: Set<string> = (this.state.innerComponents ??= new Set<string>());
              for (let idx = 0; idx < outerCount; idx++) {
                const outerId = exIO.flattener_getOuterPath(wasmFlattener, idx);
                const targetId = exIO.flattener_getTargetInnerPath(wasmFlattener, idx);
                const outerPath = dae.interner.resolve(outerId);
                const targetPath = dae.interner.resolve(targetId);
                if (outerPath && targetPath) {
                  outerMap.set(outerPath, targetPath);
                  innerSet.add(targetPath);
                  this.innerOuterComponents.add(outerPath);
                  this.innerOuterComponents.add(targetPath);
                }
              }
            }
            if (typeof exIO.flattener_getOcBranchCount === "function") {
              const ocRootCount = exIO.flattener_getOcRootCount?.(wasmFlattener) ?? 0;
              const ocPotCount = exIO.flattener_getOcPotentialRootCount?.(wasmFlattener) ?? 0;
              const ocBranchCount = exIO.flattener_getOcBranchCount(wasmFlattener) ?? 0;
              const ocQueriedCount = exIO.flattener_getOcQueriedRootCount?.(wasmFlattener) ?? 0;
              if (ocRootCount > 0 || ocPotCount > 0 || ocBranchCount > 0 || ocQueriedCount > 0) {
                const roots = new Set<string>();
                for (let idx = 0; idx < ocRootCount; idx++) {
                  const s = dae.interner.resolve(exIO.flattener_getOcRoot(wasmFlattener, idx));
                  if (s) roots.add(s);
                }
                const potentialRoots = new Map<string, number>();
                for (let idx = 0; idx < ocPotCount; idx++) {
                  const s = dae.interner.resolve(exIO.flattener_getOcPotentialRoot(wasmFlattener, idx));
                  const prio = exIO.flattener_getOcPotentialRootPrio(wasmFlattener, idx);
                  if (s) {
                    const prev = potentialRoots.get(s);
                    if (prev === undefined || prio < prev) potentialRoots.set(s, prio);
                  }
                }
                const branches: { a: string; b: string }[] = [];
                for (let idx = 0; idx < ocBranchCount; idx++) {
                  const sa = dae.interner.resolve(exIO.flattener_getOcBranchA(wasmFlattener, idx));
                  const sb = dae.interner.resolve(exIO.flattener_getOcBranchB(wasmFlattener, idx));
                  if (sa && sb) branches.push({ a: sa, b: sb });
                }
                const queriedRoots = new Set<string>();
                for (let idx = 0; idx < ocQueriedCount; idx++) {
                  const s = dae.interner.resolve(exIO.flattener_getOcQueriedRoot(wasmFlattener, idx));
                  if (s) queriedRoots.add(s);
                }
                dae.extensionMetadata["overconstrainedGraph"] = { roots, potentialRoots, branches, queriedRoots };
              }
            }
            const totalVars = dae.varCount;
            for (let v = 0; v < totalVars; v++) {
              if ((dae.getVarFlags(v) & (1 << 9)) !== 0) {
                dae.setVarDescription(v, "virtual variable in expandable connector");
              }
            }
          }
        }
      } catch (err: any) {
        trappedInWasm = true;
        flattenedInWasm = false;
        const errMsg = err instanceof Error ? err.message : String(err);
        const bail = describeWasmBail(
          WasmBailReason.KernelTrap,
          undefined,
          undefined,
          isStrictWasm ? "strict-partial" : "ts-fallback",
        );
        if (errMsg) {
          bail.description = `${bail.description}: ${errMsg}`;
        }
        wasmBail ??= bail;
      } finally {
        if (!trappedInWasm && wasmFlattener && typeof (dae.exports as any)?.flattener_destroy === "function") {
          try {
            (dae.exports as any).flattener_destroy(wasmFlattener);
          } catch {
            // ignore
          }
        }
      }
      if (!flattenedInWasm) {
        if (isStrictWasm) {
          emitWasmBailDiagnostic(
            this.db,
            dae,
            rootClassId,
            this.state.wasmErrorCode ?? 0,
            wasmErrStartByte,
            wasmErrEndByte,
          );
          if (!dae.diagnostics.some((d) => d.severity === "error" && !(d as any).fromFunction)) {
            postWasmValidate(this.db, dae, rootClassId, this.failedFunctionIds, this.invalidInterfaceFunctionIds);
          }
          if (!dae.diagnostics.some((d) => d.severity === "error")) {
            dae.diagnostics.push({
              code: ModelicaErrorCode.WASM_FLATTENER_UNSUPPORTED.code,
              rule: "wasm-flattener-unsupported",
              severity: "error",
              message: `[ModelicaFlattener] Model '${rootName}' could not be flattened using strict WASM backend.`,
              range: null,
            });
          }
          if (wasmBail) {
            this.state.wasmBail = wasmBail;
            (dae as any).wasmBail = wasmBail;
          }
          return dae;
        }
        const savedDesc = dae.description;
        const savedDiags = dae.diagnostics;
        const savedExtMeta = dae.extensionMetadata;
        const savedExperiment = dae.experiment;
        const savedFunctions = dae.functions;
        dae.free?.();
        dae = new DAEBuilder(wasmExports, rootName, "");
        dae.description = savedDesc;
        dae.diagnostics = savedDiags;
        dae.extensionMetadata = savedExtMeta;
        dae.experiment = savedExperiment;
        dae.functions = savedFunctions;
        (this as any).currentRootDae = dae;
        this.state = getFlatteningState(dae, this);
        this.state.innerOuterComponents = this.innerOuterComponents;
        this.state.activeLoopVars = this.activeLoopVars;
        this.state.db = this.db;
        this.state.flattener = this;
        this.state.currentClassId = rootClassId;
        this.currentClassId = rootClassId;
        dae.classKind = specKind ?? rawKind;
      }
    }

    let layer2EqStartIdx = dae.eqCount;
    if (!flattenedInWasm) {
      // Validate rootClassId itself if it is an enumeration
      const rootSym = this.db.symbol(rootClassId);
      const rootEnumErr = validateEnumeration(this.db.cstNode(rootClassId) as any, rootSym);
      if (rootEnumErr) {
        dae.diagnostics.push({
          severity: "error",
          code: rootEnumErr.code,
          message: rootEnumErr.message,
          range: {
            startOffset: rootEnumErr.startOffset,
            endOffset: rootEnumErr.endOffset,
          },
        });
        return dae;
      }
      // Validate inner classes of rootClassId in declaration order
      const childClasses = this.db.childrenOf(rootClassId).filter((c) => c.kind === "Class");
      for (const cc of childClasses) {
        const ccEnumErr = validateEnumeration(this.db.cstNode(cc.id) as any, cc);
        if (ccEnumErr) {
          dae.diagnostics.push({
            severity: "error",
            code: ccEnumErr.code,
            message: ccEnumErr.message,
            range: {
              startOffset: ccEnumErr.startOffset,
              endOffset: ccEnumErr.endOffset,
            },
          });
          return dae;
        }
      }

      this.currentRootClassId = rootClassId;
      // 1. Layer 1: Component instantiation
      const elements = this.db.query<SymbolId[]>("instantiate", rootClassId);

      if (elements) {
        const rootExtendsMods = this.collectExtendsMods(rootClassId);
        const rootProtectedNames = this.collectProtectedNames(rootClassId);
        const rootInstantiating = new Set<SymbolId>();
        if (rootClassId) rootInstantiating.add(rootClassId);

        this.instantiateElements(elements, "", dae, {
          args: rootExtendsMods,
          protectedNames: rootProtectedNames,
          instantiatingClassIds: rootInstantiating,
        });
      }
      const hasFatalInstantiationError = dae.diagnostics.some((d) => {
        if (d.severity !== "error") return false;
        if ((d as any).fromFunction) return false;
        if (
          d.code === ModelicaErrorCode.FUNCTION_INVALID_VAR_TYPE.code ||
          d.code === ModelicaErrorCode.FUNCTION_PROTECTED_IO.code ||
          (this.failedFunctionIds.size > 0 && d.message.includes("for function component")) ||
          (this.failedFunctionIds.size > 0 && d.message.includes("Invalid protected variable")) ||
          (this.failedFunctionIds.size > 0 && d.message.includes("in modifier of component"))
        ) {
          return false;
        }
        return true;
      });
      if (this.options.omcCompatibility && hasFatalInstantiationError) {
        return dae;
      }

      // 2. Layer 2: Direct CST Equation extraction
      layer2EqStartIdx = dae.eqCount;
      this.extractClassEquations(rootClassId, "", dae);
      if (this.implicitInners.length > 0) {
        for (const inner of this.implicitInners) {
          this.extractClassEquations(inner.classId, inner.name, dae);
        }
      }
      if (this.pendingArrayBindings.size > 0) {
        for (const items of this.pendingArrayBindings.values()) {
          for (const item of items) {
            dae.addEquation(EqKind.Array, item.lhsExprId, item.rhsExprId);
          }
        }
        this.pendingArrayBindings.clear();
      }
      for (const fn of dae.functions.values()) {
        const fnSym = (fn as any).symId;
        if (fnSym && this.calledFunctionSymIds.has(fnSym)) {
          (fn as any).wasCalled = true;
        }
      }
    }

    const isOldFrontend = compilerOpts.isOldFrontend;
    dae.extensionMetadata["isOldFrontend"] = isOldFrontend;
    const isGen = compilerOpts.isGen;
    dae.extensionMetadata["isGen"] = isGen;

    this.checkCyclicConstantsAndParameters(dae, rootClassId);

    const expandArrayConnectEquations = (builder: DAEBuilder) => {
      const origEqCount = builder.eqCount;
      for (let i = 0; i < origEqCount; i++) {
        if (builder.getEqKind(i) === EqKind.Connect) {
          const l = builder.getEqLhs(i);
          const r = builder.getEqRhs(i);
          const flags = builder.getEqAux(i);
          if (builder.getExprKind(l) === ExprKind.Name && builder.getExprKind(r) === ExprKind.Name) {
            const lName = builder.interner.resolve(builder.getExprData1(l));
            const rName = builder.interner.resolve(builder.getExprData1(r));
            if (lName && rName) {
              const lExp = this.expandConnectorRef(lName, builder);
              const rExp = this.expandConnectorRef(rName, builder);
              if (
                lExp.length >= 1 &&
                lExp.length === rExp.length &&
                (lExp.length > 1 || lExp[0] !== lName || rExp[0] !== rName)
              ) {
                const l0 = builder.addName(builder.interner.intern(lExp[0]!));
                const r0 = builder.addName(builder.interner.intern(rExp[0]!));
                builder.setEqLhs(i, l0);
                builder.setEqRhs(i, r0);
                for (let k = 1; k < lExp.length; k++) {
                  const lk = builder.addName(builder.interner.intern(lExp[k]!));
                  const rk = builder.addName(builder.interner.intern(rExp[k]!));
                  builder.addEquation(EqKind.Connect, lk, rk, flags);
                }
              }
            }
          }
        }
      }
    };

    expandArrayConnectEquations(dae);

    const pendingForeignDefaults = (dae.extensionMetadata as Record<string, unknown>)[
      "__pendingForeignInputDefaults"
    ] as Array<{ varName: string; rhsExprId: number }> | undefined;
    if (pendingForeignDefaults && pendingForeignDefaults.length > 0) {
      delete (dae.extensionMetadata as Record<string, unknown>)["__pendingForeignInputDefaults"];
      const externallyDrivenVars = new Set<string>();
      for (let eqIdx = layer2EqStartIdx; eqIdx < dae.eqCount; eqIdx++) {
        const kind = dae.getEqKind(eqIdx);
        const l = dae.getEqLhs(eqIdx);
        const r = dae.getEqRhs(eqIdx);
        if (kind === EqKind.Connect) {
          if (l >= 0 && dae.getExprKind(l) === ExprKind.Name) {
            const ln = dae.interner.resolve(dae.getExprData1(l));
            if (ln) externallyDrivenVars.add(ln);
          }
          if (r >= 0 && dae.getExprKind(r) === ExprKind.Name) {
            const rn = dae.interner.resolve(dae.getExprData1(r));
            if (rn) externallyDrivenVars.add(rn);
          }
        } else if (kind === EqKind.Simple) {
          if (l >= 0 && dae.getExprKind(l) === ExprKind.Name) {
            const ln = dae.interner.resolve(dae.getExprData1(l));
            if (ln) externallyDrivenVars.add(ln);
          }
        }
      }
      for (const def of pendingForeignDefaults) {
        if (!externallyDrivenVars.has(def.varName)) {
          dae.addEquation(EqKind.Simple, dae.addNameExpr(def.varName), def.rhsExprId);
        }
      }
    }

    const resolvedRecordValCache = new Map<string, number | null>();
    const rootComponentsMap = new Map<string, any>();
    for (const s of this.db.childrenOf(rootClassId)) {
      if (s.kind === "Component") rootComponentsMap.set(s.name, s);
    }
    if (rootSym?.resourceId) {
      for (const s of this.getFileSymbols(rootSym.resourceId)) {
        if (s.kind === "Component" && !rootComponentsMap.has(s.name)) {
          rootComponentsMap.set(s.name, s);
        }
      }
    }

    for (let vIdx = 0; vIdx < dae.varCount; vIdx++) {
      let exprId = dae.getVarExpression(vIdx);
      if (exprId === undefined || exprId < 0 || exprId === 0xffffffff) continue;
      let innerId = exprId;
      if (
        dae.getExprKind(innerId) === ExprKind.Call &&
        dae.interner.resolve(dae.getExprData1(innerId)) === "/*Real*/"
      ) {
        innerId = dae.getExprLeft(innerId);
      }
      if (innerId >= 0) {
        let refName = "";
        if (dae.getExprKind(innerId) === ExprKind.Name) {
          refName = dae.interner.resolve(dae.getExprData1(innerId)) || "";
        } else {
          const vName = dae.getVarName(vIdx);
          if (!vName.includes(".") && !vName.includes("[")) {
            const vEntry = rootComponentsMap.get(vName);
            if (vEntry) {
              const compInst = this.db.query<any>("componentInstance", vEntry.id);
              const rawVal = compInst?.modification?.value?.text?.trim();
              if (rawVal && rawVal.includes(".")) refName = rawVal;
            }
          }
        }
        if (refName && refName.includes(".")) {
          let num = resolvedRecordValCache.get(refName);
          if (num === undefined) {
            num = null;
            const parts = refName.split(".");
            if (parts.length >= 3) {
              const pkgName = parts[0]!;
              const bIdx1 = parts[1]!.indexOf("[");
              const compName = bIdx1 >= 0 ? parts[1]!.slice(0, bIdx1) : parts[1]!;
              const pkgSym = this.db.byName(pkgName).find((e) => e.kind === "Package" || e.kind === "Class");
              const compSym = pkgSym
                ? this.db.childrenOf(pkgSym.id).find((c) => c.kind === "Component" && c.name === compName)
                : null;
              if (compSym) {
                const compInst = this.db.query<any>("componentInstance", compSym.id);
                const bIdx2 = parts[2]!.indexOf("[");
                const firstField = bIdx2 >= 0 ? parts[2]!.slice(0, bIdx2) : parts[2]!;
                const arg = compInst?.modification?.args?.find((a: any) => a.name === firstField);
                let valText: string | undefined = arg?.value?.text?.trim();
                for (let pIdx = 3; pIdx < parts.length && valText; pIdx++) {
                  const bIdxSub = parts[pIdx]!.indexOf("[");
                  const subField = bIdxSub >= 0 ? parts[pIdx]!.slice(0, bIdxSub) : parts[pIdx]!;
                  valText = extractNamedOrModArgValueCst(valText, subField);
                }
                if (valText !== undefined) {
                  const parsed = Number(valText);
                  if (!Number.isNaN(parsed)) {
                    num = parsed;
                  }
                }
              }
            }
            resolvedRecordValCache.set(refName, num);
          }
          if (num !== null) {
            const vType = dae.getVarType(vIdx);
            const newExprId = vType === VarType.Integer ? dae.addIntLiteral(Math.round(num)) : dae.addRealLiteral(num);
            dae.setVarExpression(vIdx, newExprId);
          }
        }
      }
    }

    // 2.4b Propagate `final` across structural parameter dependencies & array siblings (newInst)
    // and honor `-d=evaluateAllParameters` when present on the root class annotation.
    let evalAllParams = false;
    if (flattenedInWasm && !isOldFrontend) {
      const rootCstForOpts = this.db.cstNode(rootClassId) as any;
      evalAllParams = Boolean(rootCstForOpts?.text?.includes("evaluateAllParameters"));
      if (evalAllParams) {
        dae.extensionMetadata = { ...dae.extensionMetadata, evaluateAllParameters: true };
        for (let v = 0; v < dae.varCount; v++) {
          if (dae.isVarRemoved(v)) continue;
          if (dae.getVarVariability(v) === Variability.Parameter && (dae.getVarExpression(v) ?? -1) >= 0) {
            dae.setVarFinal(v, true);
          }
        }
      } else {
        const paramByName = new Map<string, number>();
        const arrayParamsByBase = new Map<string, number[]>();
        const worklist: number[] = [];
        for (let v = 0; v < dae.varCount; v++) {
          if (dae.isVarRemoved(v) || dae.getVarVariability(v) !== Variability.Parameter) continue;
          const vName = dae.getVarName(v);
          paramByName.set(vName, v);
          const lb = vName.indexOf("[");
          if (lb > 0) {
            const base = vName.slice(0, lb);
            let list = arrayParamsByBase.get(base);
            if (!list) {
              list = [];
              arrayParamsByBase.set(base, list);
            }
            list.push(v);
          }
          if (dae.isVarEvaluate(v)) worklist.push(v);
        }
        const collectExprParamRefs = (exprId: number, depth: number) => {
          if (exprId < 0 || exprId >= dae.exprCount || depth > 24) return;
          const k = dae.getExprKind(exprId);
          if (k === ExprKind.Name) {
            const refName = dae.interner.resolve(dae.getExprData1(exprId));
            if (refName) {
              const targetIdx = paramByName.get(refName);
              if (targetIdx !== undefined && !dae.isVarFinal(targetIdx)) {
                dae.setVarFinal(targetIdx, true);
                worklist.push(targetIdx);
              }
            }
            return;
          }
          if (k === ExprKind.Binary) {
            collectExprParamRefs(dae.getExprLeft(exprId), depth + 1);
            collectExprParamRefs(dae.getExprRight(exprId), depth + 1);
          } else if (k === ExprKind.Unary || k === ExprKind.Negate) {
            collectExprParamRefs(dae.getExprLeft(exprId), depth + 1);
          } else if (k === ExprKind.IfElse) {
            collectExprParamRefs(dae.getExprData1(exprId), depth + 1);
            collectExprParamRefs(dae.getExprLeft(exprId), depth + 1);
            collectExprParamRefs(dae.getExprRight(exprId), depth + 1);
          } else if (k === ExprKind.ArrayCtor || k === ExprKind.Tuple) {
            const cnt = dae.getExprData1(exprId);
            for (let i = 0; i < cnt; i++) {
              collectExprParamRefs(dae.getExprLeft(exprId + i), depth + 1);
            }
          } else if (k === ExprKind.Call) {
            const cnt = dae.getExprRight(exprId);
            if (cnt > 0) {
              collectExprParamRefs(dae.getExprLeft(exprId), depth + 1);
              for (let i = 1; i < cnt; i++) {
                collectExprParamRefs(dae.getExprLeft(exprId + i), depth + 1);
              }
            }
          }
        };
        while (worklist.length > 0) {
          const v = worklist.pop()!;
          const bExpr = dae.getVarExpression(v) ?? -1;
          if (bExpr >= 0) collectExprParamRefs(bExpr, 0);
          const vName = dae.getVarName(v);
          const lb = vName.indexOf("[");
          if (lb > 0) {
            const siblings = arrayParamsByBase.get(vName.slice(0, lb));
            if (siblings) {
              for (const s of siblings) {
                if (!dae.isVarFinal(s)) {
                  dae.setVarFinal(s, true);
                  worklist.push(s);
                }
              }
            }
          }
        }
        const rootText: string = rootCstForOpts?.text ?? "";
        if (rootText.includes("Connections.potentialRoot")) {
          const prRe = /Connections\.potentialRoot\s*\([^,]+,\s*([A-Za-z_]\w*)\s*\)/g;
          let m: RegExpExecArray | null;
          while ((m = prRe.exec(rootText)) !== null) {
            const pIdx = paramByName.get(m[1]!);
            if (pIdx !== undefined && !dae.isVarFinal(pIdx)) {
              dae.setVarFinal(pIdx, true);
            }
          }
        }
        if (rootText.includes(":") && /\b(?:ones|zeros|identity|fill)\s*\(/.test(rootText)) {
          const acRe = /\b(ones|zeros|identity|fill)\s*\(([^)]+)\)/g;
          let m: RegExpExecArray | null;
          while ((m = acRe.exec(rootText)) !== null) {
            const fn = m[1]!;
            const args = m[2]!.split(",").map((s) => s.trim());
            const startArg = fn === "fill" ? 1 : 0;
            for (let ai = startArg; ai < args.length; ai++) {
              const pIdx = paramByName.get(args[ai]!);
              if (pIdx !== undefined && !dae.isVarFinal(pIdx)) {
                dae.setVarFinal(pIdx, true);
              }
            }
          }
        }
      }
    }

    // 2.5 Fold constants on initial DAE so parameters, dimensions, and expressions are resolved
    // Pad partial tuple LHS in equations calling multi-output user functions before folding
    // (e.g. `Z2 = f(...)` -> `(Z2, _) = f(...)` so constant folding extracts Z2 = {1.0, 2.0})
    const paddedSingleLhsMultiOutEqs = new Set<number>();
    if (flattenedInWasm && dae.functions.size > 0) {
      for (let i = 0; i < dae.eqCount; i++) {
        if (dae.isEqRemoved(i)) continue;
        const ek = dae.getEqKind(i);
        if (ek !== EqKind.Simple && ek !== EqKind.Array && ek !== EqKind.InitialSimple) continue;
        const r = dae.getEqRhs(i);
        if (dae.getExprKind(r) !== ExprKind.Call) continue;
        const fnName = dae.interner.resolve(dae.getExprData1(r));
        const fnDae = fnName ? dae.functions.get(fnName) : undefined;
        if (!fnDae) continue;
        let outCount = 0;
        for (let v = 0; v < fnDae.varCount; v++) {
          if (fnDae.getVarCausality(v) === Causality.Output) outCount++;
        }
        if (outCount <= 1) continue;
        const l = dae.getEqLhs(i);
        const lk = dae.getExprKind(l);
        if (lk === ExprKind.Name) {
          const elems: number[] = [l];
          const wcId = dae.interner.intern("_");
          while (elems.length < outCount) elems.push(dae.addName(wcId));
          dae.setEqLhs(i, dae.addTupleExpr(elems));
          paddedSingleLhsMultiOutEqs.add(i);
        } else if (lk === ExprKind.Tuple) {
          const curCount = dae.getExprData1(l);
          if (curCount > 0 && curCount < outCount) {
            const elems: number[] = [];
            for (let j = 0; j < curCount; j++) elems.push(dae.getExprLeft(l + j));
            const wcId = dae.interner.intern("_");
            while (elems.length < outCount) elems.push(dae.addName(wcId));
            dae.setEqLhs(i, dae.addTupleExpr(elems));
          }
        }
      }
    }
    const preFoldNonArrayRhs = new Set<number>();
    if (flattenedInWasm && isOldFrontend && dae.functions.size > 0) {
      for (let i = 0; i < dae.eqCount; i++) {
        const ek = dae.getEqKind(i);
        if (ek !== EqKind.Simple && ek !== EqKind.InitialSimple) continue;
        const l = dae.getEqLhs(i);
        const r = dae.getEqRhs(i);
        if (dae.getExprKind(l) === ExprKind.Name && dae.getExprKind(r) === ExprKind.Call) {
          const fnName = dae.interner.resolve(dae.getExprData1(r));
          if (fnName && dae.functions.has(fnName)) {
            preFoldNonArrayRhs.add(i);
          }
        }
      }
    }
    foldArenaConstants(dae, this.db, rootClassId, evalAllParams ? false : this.options.omcCompatibility);
    if (flattenedInWasm && !isOldFrontend && this.options.omcCompatibility && paddedSingleLhsMultiOutEqs.size > 0) {
      for (const eqIdx of paddedSingleLhsMultiOutEqs) {
        if (dae.isEqRemoved(eqIdx)) continue;
        const ek = dae.getEqKind(eqIdx);
        if (ek !== EqKind.Simple && ek !== EqKind.Array && ek !== EqKind.InitialSimple) continue;
        const curLhs = dae.getEqLhs(eqIdx);
        const curRhs = dae.getEqRhs(eqIdx);
        if (curLhs < 0 || curRhs < 0) continue;
        if (dae.getExprKind(curLhs) !== ExprKind.Tuple || dae.getExprKind(curRhs) !== ExprKind.Call) continue;
        const tcount = dae.getExprData1(curLhs);
        if (tcount < 2) continue;
        let restAllWildcard = true;
        for (let j = 1; j < tcount; j++) {
          const el = dae.getExprLeft(curLhs + j);
          if (el < 0 || dae.getExprKind(el) !== ExprKind.Name || dae.interner.resolve(dae.getExprData1(el)) !== "_") {
            restAllWildcard = false;
            break;
          }
        }
        if (!restAllWildcard) continue;
        const origLhs = dae.getExprLeft(curLhs);
        if (origLhs < 0 || dae.getExprKind(origLhs) !== ExprKind.Name) continue;
        dae.setEqLhs(eqIdx, origLhs);
        dae.setEqRhs(eqIdx, dae.addSubscriptExpr(curRhs, [dae.addIntLiteral(1)]));
      }
    }
    // Fold constant/parameter record & record-array call equations (`r = f(...)`, `sTM = f(m)`)
    // into scalarized field bindings across a fixpoint loop (handles chained Spice3 records).
    if (flattenedInWasm && this.options.omcCompatibility) {
      this.generateRecordConstructors(rootClassId, dae);
    }
    if (flattenedInWasm && dae.functions.size > 0) {
      const valueToArenaLit = (val: unknown, varType?: VarType): number => {
        if (typeof val === "number") {
          if (varType === VarType.Integer || varType === VarType.Enumeration) return dae.addIntLiteral(Math.trunc(val));
          if (varType === VarType.Boolean) return dae.addBoolLiteral(val !== 0);
          return dae.addRealLiteral(val);
        }
        if (typeof val === "boolean") return dae.addBoolLiteral(val);
        if (typeof val === "string") return dae.addStringLiteral(val);
        if (Array.isArray(val)) {
          const elems: number[] = [];
          for (const el of val) {
            const id = valueToArenaLit(el, varType);
            if (id < 0) return -1;
            elems.push(id);
          }
          return dae.addArrayCtorExpr(elems);
        }
        return -1;
      };
      const extractFieldFromEvalRes = (
        rootVal: unknown,
        relSuffix: string,
        posIdx: number,
        totalFieldCount: number,
      ): unknown => {
        if (
          Array.isArray(rootVal) &&
          !relSuffix.startsWith("[") &&
          !relSuffix.includes(".") &&
          !relSuffix.includes("[") &&
          totalFieldCount > 0 &&
          rootVal.length === totalFieldCount
        ) {
          return rootVal[posIdx];
        }
        let cur: any = rootVal;
        let path = relSuffix;
        while (path.length > 0) {
          if (path.startsWith(".")) {
            path = path.slice(1);
            continue;
          }
          if (path.startsWith("[")) {
            const closeIdx = path.indexOf("]");
            if (closeIdx < 0) return undefined;
            const idxParts = path
              .slice(1, closeIdx)
              .split(",")
              .map((s) => parseInt(s.trim(), 10));
            for (const idx1 of idxParts) {
              if (!Array.isArray(cur) || isNaN(idx1) || idx1 < 1 || idx1 > cur.length) return undefined;
              cur = cur[idx1 - 1];
            }
            path = path.slice(closeIdx + 1);
            continue;
          }
          const dotIdx = path.indexOf(".");
          const brkIdx = path.indexOf("[");
          let cutIdx = path.length;
          if (dotIdx >= 0 && dotIdx < cutIdx) cutIdx = dotIdx;
          if (brkIdx >= 0 && brkIdx < cutIdx) cutIdx = brkIdx;
          const seg = path.slice(0, cutIdx);
          path = path.slice(cutIdx);
          if (cur === null || typeof cur !== "object") return undefined;
          if (cur.__kind === "object" && cur.fields instanceof Map) {
            if (!cur.fields.has(seg)) return undefined;
            cur = cur.fields.get(seg);
          } else if (cur.__fields instanceof Map) {
            const rem = seg + path;
            if (cur.__fields.has(rem)) return cur.__fields.get(rem);
            if (!cur.__fields.has(seg)) return undefined;
            cur = cur.__fields.get(seg);
          } else if (!Array.isArray(cur)) {
            if (!(seg in cur)) return undefined;
            cur = cur[seg];
          } else {
            return undefined;
          }
        }
        return cur;
      };
      const recNameToIdx = new Map<string, number>();
      for (let v = 0; v < dae.varCount; v++) {
        if (!dae.isVarRemoved(v)) recNameToIdx.set(dae.getVarName(v), v);
      }
      const markExprParamArgsEvaluated = (exprId: number, depth = 0): void => {
        if (exprId < 0 || depth > 24) return;
        const ek = dae.getExprKind(exprId);
        if (ek === ExprKind.Name) {
          const nm = dae.interner.resolve(dae.getExprData1(exprId));
          if (!nm) return;
          const vIdx = recNameToIdx.get(nm);
          if (
            vIdx !== undefined &&
            !dae.isVarRemoved(vIdx) &&
            dae.getVarVariability(vIdx) === Variability.Parameter &&
            dae.isVarFixed(vIdx)
          ) {
            if (!dae.isVarEvaluate(vIdx)) dae.setVarEvaluate(vIdx, true);
            if (!dae.isVarFinal(vIdx)) dae.setVarFinal(vIdx, true);
          } else if (vIdx === undefined) {
            const pfx = `${nm}.`;
            for (const [k, cIdx] of recNameToIdx) {
              if (
                k.startsWith(pfx) &&
                !dae.isVarRemoved(cIdx) &&
                dae.getVarVariability(cIdx) === Variability.Parameter &&
                dae.isVarFixed(cIdx)
              ) {
                if (!dae.isVarEvaluate(cIdx)) dae.setVarEvaluate(cIdx, true);
                if (!dae.isVarFinal(cIdx)) dae.setVarFinal(cIdx, true);
              }
            }
          }
          return;
        }
        if (ek === ExprKind.Call) {
          const argc = dae.getExprRight(exprId);
          for (let ai = 0; ai < argc; ai++) markExprParamArgsEvaluated(dae.getExprLeft(exprId + ai), depth + 1);
        } else if (ek === ExprKind.Binary) {
          markExprParamArgsEvaluated(dae.getExprLeft(exprId), depth + 1);
          markExprParamArgsEvaluated(dae.getExprRight(exprId), depth + 1);
        } else if (ek === ExprKind.Unary || ek === ExprKind.Negate) {
          markExprParamArgsEvaluated(dae.getExprLeft(exprId), depth + 1);
        } else if (ek === ExprKind.IfElse) {
          markExprParamArgsEvaluated(dae.getExprData1(exprId), depth + 1);
          markExprParamArgsEvaluated(dae.getExprLeft(exprId), depth + 1);
          markExprParamArgsEvaluated(dae.getExprRight(exprId), depth + 1);
        } else if (ek === ExprKind.ArrayCtor) {
          const cnt = dae.getExprData1(exprId);
          for (let i = 0; i < cnt; i++) markExprParamArgsEvaluated(dae.getExprLeft(exprId + i), depth + 1);
        }
      };
      let anyRecordFolded = false;
      for (let pass = 0; pass < 6; pass++) {
        let foldedAny = false;
        for (let e = 0; e < dae.eqCount; e++) {
          if (dae.isEqRemoved(e)) continue;
          if (dae.getEqKind(e) !== EqKind.Simple) continue;
          const l = dae.getEqLhs(e);
          const r = dae.getEqRhs(e);
          if (l < 0 || r < 0) continue;
          const rKind = dae.getExprKind(r);
          if (dae.getExprKind(l) !== ExprKind.Name || (rKind !== ExprKind.Call && rKind !== ExprKind.ArrayCtor))
            continue;
          const recName = dae.interner.resolve(dae.getExprData1(l));
          if (!recName) continue;
          const dotPrefix = `${recName}.`;
          const arrPrefix = `${recName}[`;
          const fieldVars: { vIdx: number; relSuffix: string }[] = [];
          for (let v = 0; v < dae.varCount; v++) {
            if (dae.isVarRemoved(v)) continue;
            const vn = dae.getVarName(v);
            if (!vn.startsWith(dotPrefix) && !vn.startsWith(arrPrefix)) continue;
            const vb = dae.getVarVariability(v);
            if (vb !== Variability.Constant && vb !== Variability.Parameter) continue;
            fieldVars.push({
              vIdx: v,
              relSuffix: vn.startsWith(dotPrefix) ? vn.slice(dotPrefix.length) : vn.slice(recName.length),
            });
          }
          if (fieldVars.length === 0) continue;
          if (rKind === ExprKind.ArrayCtor && !fieldVars.some((fv) => fv.relSuffix.includes("."))) continue;
          const evalRes = evaluateConstantArenaExpression(
            dae,
            r,
            new Map(),
            recNameToIdx,
            0,
            this.db,
            rootClassId,
            false,
          );
          if (evalRes === null || evalRes === undefined) continue;
          let allOk = true;
          const litIds: number[] = [];
          const resolvedVals: unknown[] = [];
          for (let k = 0; k < fieldVars.length; k++) {
            const { vIdx, relSuffix } = fieldVars[k]!;
            const val = extractFieldFromEvalRes(evalRes, relSuffix, k, fieldVars.length);
            if (val === undefined && (dae.getVarExpression(vIdx) ?? -1) >= 0) {
              litIds.push(-1);
              resolvedVals.push(undefined);
              continue;
            }
            const litId = valueToArenaLit(val, dae.getVarType(vIdx));
            if (litId < 0) {
              allOk = false;
              break;
            }
            litIds.push(litId);
            resolvedVals.push(val);
          }
          if (allOk) {
            let hasEvaluatedField = false;
            for (let k = 0; k < fieldVars.length; k++) {
              const vIdx = fieldVars[k]!.vIdx;
              if (dae.isVarEvaluate(vIdx)) hasEvaluatedField = true;
              const lid = litIds[k]!;
              if (lid >= 0) {
                dae.setVarExpression(vIdx, lid);
                const ev = resolvedVals[k];
                if (typeof ev === "number") dae.setVarStartValue(vIdx, ev);
                else if (typeof ev === "boolean") dae.setVarStartValue(vIdx, ev ? 1.0 : 0.0);
              }
            }
            const rhsFnName =
              dae.getExprKind(r) === ExprKind.Call ? dae.interner.resolve(dae.getExprData1(r)) : undefined;
            const rhsFnDae = rhsFnName ? dae.functions.get(rhsFnName) : undefined;
            if (rhsFnDae) {
              for (let vi = 0; vi < rhsFnDae.varCount; vi++) {
                if (!rhsFnDae.isVarRemoved(vi) && rhsFnDae.getVarCausality(vi) === Causality.Output) {
                  const outCt = rhsFnDae.getVarCustomType(vi);
                  if (outCt) {
                    ((dae as any).foldedRecordTypes ??= new Map<string, string>()).set(recName, outCt);
                  }
                  break;
                }
              }
            }
            if (hasEvaluatedField && !isOldFrontend) {
              markExprParamArgsEvaluated(r);
            }
            dae.removeEquation(e);
            foldedAny = true;
            anyRecordFolded = true;
          }
        }
        if (!foldedAny) break;
      }
      if (anyRecordFolded) {
        foldArenaConstants(dae, this.db, rootClassId, evalAllParams ? false : this.options.omcCompatibility);
      }
      for (const sec of dae.algorithmSections) {
        const end = sec.start + sec.count;
        let hasFoldableTuple = false;
        for (let s = sec.start; s < end; s++) {
          const sk = dae.getStmtKind(s);
          if (sk === StmtKind.ComplexAssignment) {
            const tcount = dae.getStmtData1(s);
            const rhs = dae.getStmtLeft(s);
            if (rhs >= 0 && dae.getExprKind(rhs) === ExprKind.Call) {
              const evalRes = evaluateConstantArenaExpression(
                dae,
                rhs,
                new Map(),
                new Map(),
                0,
                this.db,
                rootClassId,
                false,
              );
              if (Array.isArray(evalRes) && evalRes.length === tcount) {
                hasFoldableTuple = true;
                break;
              }
            }
            s += tcount;
            continue;
          }
          if (sk !== StmtKind.Assignment) continue;
          const lhs = dae.getStmtData1(s);
          const rhs = dae.getStmtLeft(s);
          if (
            lhs >= 0 &&
            rhs >= 0 &&
            dae.getExprKind(lhs) === ExprKind.Tuple &&
            dae.getExprKind(rhs) === ExprKind.Call
          ) {
            const evalRes = evaluateConstantArenaExpression(
              dae,
              rhs,
              new Map(),
              new Map(),
              0,
              this.db,
              rootClassId,
              false,
            );
            if (Array.isArray(evalRes) && evalRes.length === dae.getExprData1(lhs)) {
              hasFoldableTuple = true;
              break;
            }
          }
        }
        if (!hasFoldableTuple) continue;
        const newStart = dae.stmtCount;
        let newCount = 0;
        for (let s = sec.start; s < end; s++) {
          const sk = dae.getStmtKind(s);
          const d1 = dae.getStmtData1(s);
          const sl = dae.getStmtLeft(s);
          const sr = dae.getStmtRight(s);
          if (sk === StmtKind.ComplexAssignment && sl >= 0 && dae.getExprKind(sl) === ExprKind.Call) {
            const tcount = d1;
            const evalRes = evaluateConstantArenaExpression(
              dae,
              sl,
              new Map(),
              new Map(),
              0,
              this.db,
              rootClassId,
              false,
            );
            if (Array.isArray(evalRes) && evalRes.length === tcount) {
              let expandedAny = false;
              for (let k = 0; k < tcount; k++) {
                const targetExpr = dae.getStmtData1(s + 1 + k);
                if (targetExpr < 0) continue;
                if (dae.getExprKind(targetExpr) === ExprKind.Name) {
                  const tName = dae.interner.resolve(dae.getExprData1(targetExpr));
                  if (!tName || tName === "_") continue;
                  const tVarIdx = dae.getVarIdxByName(tName);
                  const litId = valueToArenaLit(evalRes[k], tVarIdx >= 0 ? dae.getVarType(tVarIdx) : undefined);
                  if (litId >= 0) {
                    dae.addStatement(StmtKind.Assignment, targetExpr, litId);
                    newCount++;
                    expandedAny = true;
                  }
                }
              }
              if (expandedAny) {
                s += tcount;
                continue;
              }
            }
            dae.addStatement(sk, d1, sl, sr);
            newCount++;
            for (let k = 0; k < tcount; k++) {
              const ts = s + 1 + k;
              dae.addStatement(dae.getStmtKind(ts), dae.getStmtData1(ts), dae.getStmtLeft(ts), dae.getStmtRight(ts));
              newCount++;
            }
            s += tcount;
            continue;
          }
          if (
            sk === StmtKind.Assignment &&
            d1 >= 0 &&
            sl >= 0 &&
            dae.getExprKind(d1) === ExprKind.Tuple &&
            dae.getExprKind(sl) === ExprKind.Call
          ) {
            const evalRes = evaluateConstantArenaExpression(
              dae,
              sl,
              new Map(),
              new Map(),
              0,
              this.db,
              rootClassId,
              false,
            );
            const tCount = dae.getExprData1(d1);
            if (Array.isArray(evalRes) && evalRes.length === tCount) {
              let expandedAny = false;
              for (let k = 0; k < tCount; k++) {
                const targetExpr = dae.getExprLeft(d1 + k);
                if (targetExpr < 0) continue;
                if (dae.getExprKind(targetExpr) === ExprKind.Name) {
                  const tName = dae.interner.resolve(dae.getExprData1(targetExpr));
                  if (!tName || tName === "_") continue;
                  const tVarIdx = dae.getVarIdxByName(tName);
                  const litId = valueToArenaLit(evalRes[k], tVarIdx >= 0 ? dae.getVarType(tVarIdx) : undefined);
                  if (litId >= 0) {
                    dae.addStatement(StmtKind.Assignment, targetExpr, litId);
                    newCount++;
                    expandedAny = true;
                  }
                }
              }
              if (expandedAny) continue;
            }
          }
          dae.addStatement(sk, d1, sl, sr);
          newCount++;
        }
        sec.start = newStart;
        sec.count = newCount;
      }
    }
    // Pad missing trailing default arguments on calls to user-defined DAE functions (e.g. `g(1.0)` -> `g(1.0, p)`)
    if (flattenedInWasm && dae.functions.size > 0) {
      const exprRefsFormalParam = (src: DAEBuilder, exprId: number, formalNames: Set<string>, depth = 0): boolean => {
        if (exprId < 0 || depth > 16) return false;
        const k = src.getExprKind(exprId);
        if (k === ExprKind.Name) {
          const n = src.interner.resolve(src.getExprData1(exprId));
          if (!n) return false;
          const root = n.includes(".") ? n.slice(0, n.indexOf(".")) : n;
          return formalNames.has(n) || formalNames.has(root);
        }
        if (k === ExprKind.Unary) return exprRefsFormalParam(src, src.getExprLeft(exprId), formalNames, depth + 1);
        if (k === ExprKind.Binary) {
          return (
            exprRefsFormalParam(src, src.getExprLeft(exprId), formalNames, depth + 1) ||
            exprRefsFormalParam(src, src.getExprRight(exprId), formalNames, depth + 1)
          );
        }
        if (k === ExprKind.Subscript) {
          if (exprRefsFormalParam(src, src.getExprData1(exprId), formalNames, depth + 1)) return true;
          const cnt = src.getExprRight(exprId);
          for (let s = 0; s < cnt; s++) {
            if (exprRefsFormalParam(src, src.getExprLeft(exprId + s), formalNames, depth + 1)) return true;
          }
        }
        return false;
      };
      const copyExprFromFn = (src: DAEBuilder, exprId: number, depth = 0): number => {
        if (exprId < 0 || depth > 16) return -1;
        const k = src.getExprKind(exprId);
        if (k === ExprKind.RealLiteral) return dae.addRealLiteral(src.getExprRealValue(exprId));
        if (k === ExprKind.IntLiteral) return dae.addIntLiteral(src.getExprData1(exprId));
        if (k === ExprKind.BoolLiteral) return dae.addBoolLiteral(src.getExprData1(exprId) !== 0);
        if (k === ExprKind.StringLiteral) {
          const s = src.interner.resolve(src.getExprData1(exprId));
          return dae.addStringLiteral(s ?? "");
        }
        if (k === ExprKind.Name) {
          const n = src.interner.resolve(src.getExprData1(exprId));
          return n ? dae.addName(dae.interner.intern(n)) : -1;
        }
        if (k === ExprKind.Unary) {
          const sub = copyExprFromFn(src, src.getExprLeft(exprId), depth + 1);
          return sub >= 0 ? dae.addUnaryExpr(src.getExprData1(exprId), sub) : -1;
        }
        if (k === ExprKind.Binary) {
          const l = copyExprFromFn(src, src.getExprLeft(exprId), depth + 1);
          const r = copyExprFromFn(src, src.getExprRight(exprId), depth + 1);
          return l >= 0 && r >= 0 ? dae.addBinaryExpr(src.getExprData1(exprId), l, r) : -1;
        }
        return -1;
      };
      const padCallDefaultArgs = (exprId: number): number => {
        if (exprId < 0 || dae.getExprKind(exprId) !== ExprKind.Call) return exprId;
        const fnName = dae.interner.resolve(dae.getExprData1(exprId));
        const fnDae = fnName ? dae.functions.get(fnName) : undefined;
        if (!fnDae) return exprId;
        const inputVars: number[] = [];
        const formalNames = new Set<string>();
        for (let vi = 0; vi < fnDae.varCount; vi++) {
          if (!fnDae.isVarRemoved(vi) && fnDae.getVarCausality(vi) === Causality.Input) {
            inputVars.push(vi);
            formalNames.add(fnDae.getVarName(vi));
          }
        }
        const argCount = dae.getExprRight(exprId);
        if (argCount >= inputVars.length) return exprId;
        const args: number[] = [];
        for (let ai = 0; ai < argCount; ai++) {
          args.push(ai === 0 ? dae.getExprLeft(exprId) : dae.getExprLeft(exprId + ai));
        }
        for (let ai = argCount; ai < inputVars.length; ai++) {
          const defExpr = fnDae.getVarExpression(inputVars[ai]!) ?? -1;
          if (defExpr < 0) return exprId;
          if (exprRefsFormalParam(fnDae, defExpr, formalNames)) return exprId;
          const copied = copyExprFromFn(fnDae, defExpr);
          if (copied < 0) return exprId;
          args.push(copied);
        }
        return dae.addCallExpr(dae.getExprData1(exprId), args);
      };
      for (let v = 0; v < dae.varCount; v++) {
        if (dae.isVarRemoved(v)) continue;
        const b = dae.getVarExpression(v) ?? -1;
        if (b >= 0 && dae.getExprKind(b) === ExprKind.Call) {
          const padded = padCallDefaultArgs(b);
          if (padded !== b) dae.setVarExpression(v, padded);
        }
      }
      for (let e = 0; e < dae.eqCount; e++) {
        if (dae.isEqRemoved(e)) continue;
        const r = dae.getEqRhs(e);
        if (r >= 0 && dae.getExprKind(r) === ExprKind.Call) {
          const padded = padCallDefaultArgs(r);
          if (padded !== r) dae.setEqRhs(e, padded);
        }
      }
    }
    if (flattenedInWasm && isOldFrontend && preFoldNonArrayRhs.size > 0) {
      const isLiteralExpr = (eId: number): boolean => {
        const k = dae.getExprKind(eId);
        if (
          k === ExprKind.RealLiteral ||
          k === ExprKind.IntLiteral ||
          k === ExprKind.BoolLiteral ||
          k === ExprKind.StringLiteral ||
          k === ExprKind.EnumLiteral
        ) {
          return true;
        }
        if (k === ExprKind.ArrayCtor) {
          const cnt = dae.getExprData1(eId);
          for (let j = 0; j < cnt; j++) {
            if (!isLiteralExpr(dae.getExprLeft(eId + j))) return false;
          }
          return cnt > 0;
        }
        return false;
      };
      const expandFoldedArrayEq = (
        baseName: string,
        rhsExprId: number,
        targetKind: EqKind,
        flags: number,
        prefixIndices: number[],
      ): boolean => {
        if (dae.getExprKind(rhsExprId) !== ExprKind.ArrayCtor) return false;
        const n = dae.getExprData1(rhsExprId);
        if (n <= 0) return false;
        const firstElem = dae.getExprLeft(rhsExprId);
        if (dae.getExprKind(firstElem) === ExprKind.ArrayCtor) {
          for (let i = 0; i < n; i++) {
            if (
              !expandFoldedArrayEq(baseName, dae.getExprLeft(rhsExprId + i), targetKind, flags, [
                ...prefixIndices,
                i + 1,
              ])
            ) {
              return false;
            }
          }
          return true;
        }
        const firstIdxStr = [...prefixIndices, 1].join(",");
        if (dae.getVarIdxByName(`${baseName}[${firstIdxStr}]`) < 0) return false;
        for (let i = 0; i < n; i++) {
          const idxStr = [...prefixIndices, i + 1].join(",");
          const lhsId = dae.addName(dae.interner.intern(`${baseName}[${idxStr}]`));
          dae.addEquation(targetKind, lhsId, dae.getExprLeft(rhsExprId + i), flags);
        }
        return true;
      };
      for (const eqIdx of preFoldNonArrayRhs) {
        if (dae.isEqRemoved(eqIdx)) continue;
        const l = dae.getEqLhs(eqIdx);
        const r = dae.getEqRhs(eqIdx);
        if (dae.getExprKind(l) !== ExprKind.Name || dae.getExprKind(r) !== ExprKind.ArrayCtor) continue;
        if (!isLiteralExpr(r)) continue;
        const baseName = dae.interner.resolve(dae.getExprData1(l));
        if (!baseName) continue;
        const ek = dae.getEqKind(eqIdx);
        const targetKind = ek === EqKind.InitialSimple ? EqKind.InitialSimple : EqKind.Simple;
        const flags = dae.getEqAux(eqIdx);
        if (expandFoldedArrayEq(baseName, r, targetKind, flags, [])) {
          dae.removeEquation(eqIdx);
        }
      }
    }
    if (flattenedInWasm && dae.functions.size > 0) {
      const multiOutputFns = new Set<string>();
      for (const [fnKey, fnDae] of dae.functions) {
        let outCount = 0;
        for (let v = 0; v < fnDae.varCount; v++) {
          if (fnDae.getVarCausality(v) === Causality.Output) outCount++;
        }
        const fnName = typeof fnKey === "number" ? dae.interner.resolve(fnKey) : fnKey;
        if (outCount > 1 && fnName) multiOutputFns.add(fnName);
      }
      if (multiOutputFns.size > 0) {
        const wrapMultiOutputCalls = (eId: number, depth = 0): number => {
          if (eId < 0 || depth > 24) return eId;
          const k = dae.getExprKind(eId);
          if (k === ExprKind.Call) {
            const fnNameId = dae.getExprData1(eId);
            const fnName = dae.interner.resolve(fnNameId);
            const argCount = dae.getExprRight(eId);
            let argsChanged = false;
            const newArgs: number[] = [];
            for (let ai = 0; ai < argCount; ai++) {
              const a = dae.getExprLeft(eId + ai);
              const na = wrapMultiOutputCalls(a, depth + 1);
              if (na !== a) argsChanged = true;
              newArgs.push(na);
            }
            const callId = argsChanged ? dae.addCallExpr(fnNameId, newArgs) : eId;
            if (fnName && multiOutputFns.has(fnName)) {
              return dae.addSubscript(callId, dae.addIntLiteral(1));
            }
            return callId;
          }
          if (k === ExprKind.Subscript) {
            const base = dae.getExprData1(eId);
            const subCount = dae.getExprRight(eId);
            const newBase =
              dae.getExprKind(base) === ExprKind.Call &&
              multiOutputFns.has(dae.interner.resolve(dae.getExprData1(base)) ?? "")
                ? base
                : wrapMultiOutputCalls(base, depth + 1);
            let subChanged = newBase !== base;
            const newSubs: number[] = [];
            for (let si = 0; si < subCount; si++) {
              const sId = dae.getExprLeft(eId + si);
              const nsId = wrapMultiOutputCalls(sId, depth + 1);
              if (nsId !== sId) subChanged = true;
              newSubs.push(nsId);
            }
            if (subChanged) {
              return dae.addSubscriptExpr(newBase, newSubs);
            }
            return eId;
          }
          if (k === ExprKind.Unary) {
            const l = dae.getExprLeft(eId);
            const nl = wrapMultiOutputCalls(l, depth + 1);
            return nl !== l ? dae.addUnaryExpr(dae.getExprData1(eId), nl) : eId;
          }
          if (k === ExprKind.Binary) {
            const l = dae.getExprLeft(eId);
            const r = dae.getExprRight(eId);
            const nl = wrapMultiOutputCalls(l, depth + 1);
            const nr = wrapMultiOutputCalls(r, depth + 1);
            return nl !== l || nr !== r ? dae.addBinaryExpr(dae.getExprData1(eId), nl, nr) : eId;
          }
          if (k === ExprKind.ArrayCtor) {
            const cnt = dae.getExprData1(eId);
            let changed = false;
            const elems: number[] = [];
            for (let j = 0; j < cnt; j++) {
              const el = dae.getExprLeft(eId + j);
              const nel = wrapMultiOutputCalls(el, depth + 1);
              if (nel !== el) changed = true;
              elems.push(nel);
            }
            return changed ? dae.addArrayCtorExpr(elems) : eId;
          }
          if (k === ExprKind.IfElse) {
            const c = dae.getExprData1(eId);
            const t = dae.getExprLeft(eId);
            const f = dae.getExprRight(eId);
            const nc = wrapMultiOutputCalls(c, depth + 1);
            const nt = wrapMultiOutputCalls(t, depth + 1);
            const nf = wrapMultiOutputCalls(f, depth + 1);
            return nc !== c || nt !== t || nf !== f ? dae.addIfElseExpr(nc, nt, nf) : eId;
          }
          return eId;
        };
        for (let v = 0; v < dae.varCount; v++) {
          if (dae.isVarRemoved(v)) continue;
          const b = dae.getVarExpression(v) ?? -1;
          if (b >= 0) {
            const nb = wrapMultiOutputCalls(b);
            if (nb !== b) dae.setVarExpression(v, nb);
          }
        }
        for (let i = 0; i < dae.eqCount; i++) {
          if (dae.isEqRemoved(i)) continue;
          const ek = dae.getEqKind(i);
          if (ek === EqKind.Simple || ek === EqKind.InitialSimple || ek === EqKind.Array) {
            const l = dae.getEqLhs(i);
            const r = dae.getEqRhs(i);
            if (l >= 0 && r >= 0 && dae.getExprKind(l) === ExprKind.Tuple && dae.getExprKind(r) === ExprKind.Call) {
              continue;
            }
            if (l >= 0) {
              const nl = wrapMultiOutputCalls(l);
              if (nl !== l) dae.setEqLhs(i, nl);
            }
            if (r >= 0) {
              const nr = wrapMultiOutputCalls(r);
              if (nr !== r) dae.setEqRhs(i, nr);
            }
          }
        }
        const wrapIfEqList = (
          eqs: { kind: EqKind; lhsExprId: number; rhsExprId: number; auxExprId?: number | undefined }[] | undefined,
        ) => {
          if (!eqs) return;
          for (const eq of eqs) {
            if (
              eq.lhsExprId >= 0 &&
              eq.rhsExprId >= 0 &&
              dae.getExprKind(eq.lhsExprId) === ExprKind.Tuple &&
              dae.getExprKind(eq.rhsExprId) === ExprKind.Call
            ) {
              continue;
            }
            if (eq.lhsExprId >= 0) eq.lhsExprId = wrapMultiOutputCalls(eq.lhsExprId);
            if (eq.rhsExprId >= 0) eq.rhsExprId = wrapMultiOutputCalls(eq.rhsExprId);
          }
        };
        for (let i = 0; i < dae.eqCount; i++) {
          if (dae.getEqKind(i) !== EqKind.If) continue;
          const meta = dae.getIfEquationMeta(i);
          if (!meta) continue;
          if (meta.conditionExprId >= 0) meta.conditionExprId = wrapMultiOutputCalls(meta.conditionExprId);
          wrapIfEqList(meta.thenEquations);
          for (const ei of meta.elseIfClauses) {
            if (ei.conditionExprId >= 0) ei.conditionExprId = wrapMultiOutputCalls(ei.conditionExprId);
            wrapIfEqList(ei.bodyEquations);
          }
          wrapIfEqList(meta.elseEquations);
        }
        // Single-variable assignment in algorithm section from multi-output function: `a := f(...)` -> `a := f(...)[1]`
        for (const sec of dae.algorithmSections) {
          const end = sec.start + sec.count;
          for (let s = sec.start; s < end; s++) {
            if (dae.getStmtKind(s) !== StmtKind.Assignment) continue;
            const lhs = dae.getStmtData1(s);
            const rhs = dae.getStmtLeft(s);
            if (lhs < 0 || rhs < 0) continue;
            if (dae.getExprKind(lhs) === ExprKind.Tuple && dae.getExprKind(rhs) === ExprKind.Call) continue;
            const nr = wrapMultiOutputCalls(rhs);
            if (nr !== rhs) dae.setStmtLeft(s, nr);
          }
        }
      }
      // Expand 1D array variable names in folded Tuple-LHS equations in oldInst mode (e.g. `(b, z) = ({...}, 0.0)` -> `({b[1], ...}, z) = ...`)
      if (isOldFrontend) {
        for (let i = 0; i < dae.eqCount; i++) {
          if (dae.isEqRemoved(i)) continue;
          const l = dae.getEqLhs(i);
          const r = dae.getEqRhs(i);
          if (dae.getExprKind(l) !== ExprKind.Tuple || dae.getExprKind(r) !== ExprKind.Tuple) continue;
          const lCnt = dae.getExprData1(l);
          const rCnt = dae.getExprData1(r);
          if (lCnt <= 0 || lCnt !== rCnt) continue;
          let changedTuple = false;
          const newElems: number[] = [];
          for (let j = 0; j < lCnt; j++) {
            const le = dae.getExprLeft(l + j);
            const re = dae.getExprLeft(r + j);
            if (dae.getExprKind(le) === ExprKind.Name && dae.getExprKind(re) === ExprKind.ArrayCtor) {
              const baseName = dae.interner.resolve(dae.getExprData1(le));
              const arrLen = dae.getExprData1(re);
              if (
                baseName &&
                arrLen > 0 &&
                dae.getVarIdxByName(baseName) < 0 &&
                dae.getVarIdxByName(`${baseName}[1]`) >= 0 &&
                dae.getVarIdxByName(`${baseName}[${arrLen}]`) >= 0
              ) {
                const arrElems: number[] = [];
                for (let k = 1; k <= arrLen; k++) {
                  arrElems.push(dae.addName(dae.interner.intern(`${baseName}[${k}]`)));
                }
                newElems.push(dae.addArrayCtorExpr(arrElems));
                changedTuple = true;
                continue;
              }
            }
            newElems.push(le);
          }
          if (changedTuple) {
            dae.setEqLhs(i, dae.addTupleExpr(newElems));
          }
        }
      }
    }

    let shouldScalarize = this.options.arrayMode === "scalarize";
    if (!shouldScalarize) {
      for (let i = 0; i < dae.varCount; i++) {
        if (!dae.isVarRemoved(i) && dae.isVarFlow(i) && dae.getVarShape(i).length > 0) {
          shouldScalarize = true;
          break;
        }
      }
    }
    if (!shouldScalarize) {
      for (let i = 0; i < dae.eqCount; i++) {
        if (dae.getEqKind(i) === EqKind.Connect) {
          const lhsName = dae.interner.resolve(dae.getExprData1(dae.getEqLhs(i))) ?? "";
          const rhsName = dae.interner.resolve(dae.getExprData1(dae.getEqRhs(i))) ?? "";
          if (lhsName.includes("[") || rhsName.includes("[")) {
            shouldScalarize = true;
            break;
          }
        }
      }
    }

    dae.extensionMetadata.expandableBuses = Array.from(this.expandableBuses.keys());

    if (shouldScalarize) {
      (dae as any).flattener = this;
      dae = scalarizeArena(dae);
      this.state = getFlatteningState(dae, this);
      this.state.db = this.db;
      this.state.flattener = this;
      this.state.currentClassId = rootClassId;
      this.state.innerOuterComponents = this.innerOuterComponents;
      this.state.activeLoopVars = this.activeLoopVars;
      (this as any).currentRootDae = dae;
    } else if (flattenedInWasm || this.explicitArrayMode === "preserve") {
      const arrayVarNames = new Set<string>();
      for (let v = 0; v < dae.varCount; v++) {
        if (dae.isVarRemoved(v)) continue;
        const rawN = dae.getVarName(v);
        if (dae.getVarShape(v).length > 0) {
          arrayVarNames.add(rawN);
        } else if (rawN.startsWith("\0")) {
          const parts = rawN.split("\0");
          if (parts[2]) arrayVarNames.add(parts[2]);
        }
      }
      const isScalarExpr = (eId: number, depth = 0): boolean => {
        if (eId < 0 || depth > 16) return false;
        const k = dae.getExprKind(eId);
        if (
          k === ExprKind.RealLiteral ||
          k === ExprKind.IntLiteral ||
          k === ExprKind.BoolLiteral ||
          k === ExprKind.StringLiteral ||
          k === ExprKind.EnumLiteral
        ) {
          return true;
        }
        if (k === ExprKind.Name) {
          const n = dae.interner.resolve(dae.getExprData1(eId));
          return Boolean(n && !arrayVarNames.has(n));
        }
        if (k === ExprKind.Unary) return isScalarExpr(dae.getExprLeft(eId), depth + 1);
        if (k === ExprKind.Binary) {
          return isScalarExpr(dae.getExprLeft(eId), depth + 1) && isScalarExpr(dae.getExprRight(eId), depth + 1);
        }
        return false;
      };
      for (let v = 0; v < dae.varCount; v++) {
        if (dae.isVarRemoved(v)) continue;
        let dims = dae.getVarShape(v);
        if (dims.length === 0) {
          const rawN = dae.getVarName(v);
          if (rawN.startsWith("\0")) {
            const parts = rawN.split("\0");
            const dimStr = parts[1] ?? "";
            if (dimStr.startsWith("[") && dimStr.endsWith("]")) {
              const parsed = dimStr
                .slice(1, -1)
                .split(",")
                .map((s) => Number(s.trim()));
              if (parsed.length > 0 && parsed.every((n) => Number.isInteger(n) && n > 0)) {
                dims = parsed;
              }
            }
          }
        }
        if (dims.length === 0 || !dims.every((d) => d > 0)) continue;
        const exprId = dae.getVarExpression(v) ?? -1;
        if (exprId >= 0 && isScalarExpr(exprId)) {
          const fillArgs = [exprId, ...dims.map((d) => dae.addIntLiteral(d))];
          dae.setVarExpression(v, dae.addCallExpr(dae.interner.intern("fill"), fillArgs));
        }
      }
    }

    if (!isOldFrontend) {
      this.markConditionalParametersFinal(dae, rootClassId);
    }
    if (flattenedInWasm) {
      this.checkCyclicConstantsAndParameters(dae, rootClassId);
      postWasmValidate(this.db, dae, rootClassId, this.failedFunctionIds, this.invalidInterfaceFunctionIds);
    }

    const varCountBeforeConnections = dae.varCount;
    const eqCountBeforeConnections = dae.eqCount;
    const exprCountBeforeConnections = dae.exprCount;

    // 2.6 Expandable connector dynamic augmentation, cross-bus pooling, and variable pruning
    if (!flattenedInWasm) {
      this.processExpandableConnectors(rootClassId, dae);
    }

    // 3. Layer 3: Physical connector expansion & flow balance
    let flowThreshold = compilerOpts.flowThreshold;
    const connState = getFlatteningState(dae, this);
    connState.db = this.db;
    connState.flattener = this;
    connState.currentClassId = rootClassId;
    connState.currentRootClassId = rootClassId;
    ModelicaPortBalancer.expandConnections(dae, {
      omcCompatibility: this.options.omcCompatibility,
      useWasmKernel: this.options.useWasmKernel,
      isOldFrontend,
      flowThreshold,
    });

    // 4. Constant folding and alias elimination
    if (
      shouldScalarize ||
      this.expandableBuses.size > 0 ||
      dae.varCount !== varCountBeforeConnections ||
      dae.eqCount !== eqCountBeforeConnections ||
      dae.exprCount !== exprCountBeforeConnections
    ) {
      foldArenaConstants(dae, this.db, rootClassId, this.options.omcCompatibility);
    }

    if (this.options.eliminateAliases) {
      eliminateArenaAliases(dae);
    }

    if (this.options.omcCompatibility) {
      this.generateRecordConstructors(rootClassId, dae);
      this.generateOperatorFunctions(dae);
      this.generateExternalObjectFunctions(dae);
      this.propagateImpureFunctions(dae);
    }

    const attachDiffReport = (targetDae: DAEBuilder) => {
      const wasmDiff = (this as any)._wasmDiffStats as
        { varCount: number; eqCount: number; bail?: WasmBailInfo | undefined; error?: string | undefined } | undefined;
      if (wasmDiff) {
        delete (this as any)._wasmDiffStats;
        (targetDae as any).diffReport = wasmDiff;
        if (process.env["DEBUG_DIFF"] === "1") {
          if (wasmDiff.error) {
            console.warn(`[DiffFlattener] WASM flattener failed: ${wasmDiff.error}`);
          } else {
            const varMatch = wasmDiff.varCount === targetDae.varCount;
            const eqMatch = wasmDiff.eqCount === targetDae.eqCount;
            const bailSuffix = wasmDiff.bail ? ` [bail=${wasmDiff.bail.reason}(${wasmDiff.bail.code})]` : "";
            console.log(
              `[DiffFlattener] ${varMatch && eqMatch && !wasmDiff.bail ? "PARITY MATCH" : "PARITY MISMATCH"}: vars (WASM=${wasmDiff.varCount}, TS=${targetDae.varCount}), eqs (WASM=${wasmDiff.eqCount}, TS=${targetDae.eqCount})${bailSuffix}`,
            );
          }
        }
      }
    };

    this.extractStateMachines(dae);
    dae.groupEquationsForParity();
    this.checkBalance(dae, rootClassId);
    if (classCst?.text?.includes("showAnnotations") || classCst?.tree?.rootNode?.text?.includes("showAnnotations")) {
      this.populateShowAnnotations(dae, rootClassId);
    }

    attachDiffReport(dae);
    if (wasmBail) {
      // Structured metadata only: a diagnostic here would perturb tests whose
      // expected output is driven by linter diagnostics.
      this.state.wasmBail = wasmBail;
      (dae as any).wasmBail = wasmBail;
    }
    this.state.isRealNameCache?.clear();
    this.state.varPrefixSet?.clear();
    this.state.varPrefixCount = 0;
    return dae;
  }

  private populateShowAnnotations(dae: DAEBuilder, rootClassId: SymbolId): void {
    const normAnnInner = (raw: string): string => {
      let s = raw.trim();
      if (s.startsWith("annotation")) s = s.slice("annotation".length).trim();
      if (s.startsWith("(") && s.endsWith(")")) s = s.slice(1, -1).trim();
      let out = "";
      let inStr = false;
      for (let i = 0; i < s.length; i++) {
        const ch = s[i]!;
        if (ch === '"' && (i === 0 || s[i - 1] !== "\\")) inStr = !inStr;
        if (!inStr && ch === "=") {
          const prev = s[i - 1] ?? "";
          const next = s[i + 1] ?? "";
          if (prev !== "=" && prev !== "<" && prev !== ">" && prev !== ":" && next !== "=") {
            out = out.trimEnd() + " = ";
            while (i + 1 < s.length && s[i + 1] === " ") i++;
            continue;
          }
        }
        out += ch;
      }
      return out.trim();
    };

    const collectBodyAnnotations = (
      cstNode: any,
      eqAnns: string[],
      algAnns: string[],
      inAlg = false,
      isRoot = true,
    ): void => {
      if (!cstNode) return;
      if (!isRoot && cstNode.type === "class_definition") return;
      if (
        cstNode.type === "component_clause" ||
        cstNode.type === "component_declaration" ||
        cstNode.type === "extends_clause"
      ) {
        return;
      }
      if (cstNode.type === "annotation_clause") {
        const inner = normAnnInner(cstNode.text ?? "");
        if (inner) {
          if (inAlg) algAnns.push(inner);
          else eqAnns.push(inner);
        }
        return;
      }
      const nextInAlg = inAlg || cstNode.type === "algorithm_section";
      for (const child of cstNode.children || []) {
        collectBodyAnnotations(child, eqAnns, algAnns, nextInAlg, false);
      }
    };

    const findCompAnnText = (compCst: any): string | null => {
      if (!compCst) return null;
      const walk = (n: any): string | null => {
        if (!n) return null;
        if (n.type === "annotation_clause") return normAnnInner(n.text ?? "");
        for (const c of n.children || []) {
          const found = walk(c);
          if (found) return found;
        }
        return null;
      };
      return walk(compCst);
    };

    for (const fn of new Set(dae.functions.values())) {
      const fnSymId = (fn as any).symId ?? this.db.byName(fn.name.split(".").pop()!)?.[0]?.id;
      const fnCst = fnSymId ? (this.db.cstNode(fnSymId) as any) : null;
      if (!fnCst) continue;
      collectBodyAnnotations(fnCst, fn.equationAnnotations, fn.algorithmAnnotations);
      if (fn.algorithmSections.length > 0 && fn.equationAnnotations.length > 0 && fn.eqCount === 0) {
        fn.algorithmAnnotations.push(...fn.equationAnnotations);
        fn.equationAnnotations.length = 0;
      }
      const fnComps = fnSymId ? this.db.childrenOf(fnSymId).filter((c) => c.kind === "Component") : [];
      for (let i = 0; i < fn.varCount; i++) {
        const vName = fn.getVarName(i);
        const comp = fnComps.find((c) => c.name === vName);
        if (comp) {
          const ann = findCompAnnText(this.db.cstNode(comp.id));
          if (ann) fn.setVarCadAnnotation(i, `(${ann})`);
        }
      }
    }

    const rootCst = this.db.cstNode(rootClassId) as any;
    if (rootCst) {
      collectBodyAnnotations(rootCst, dae.equationAnnotations, dae.algorithmAnnotations);
    }

    const findClassComp = (cid: SymbolId, name: string): SymbolEntry | null => {
      const inst = this.db.query<SymbolId[]>("instantiate", cid) ?? [];
      for (const id of inst) {
        const s = this.db.symbol(id);
        if (s && s.kind === "Component" && s.name === name) return s;
      }
      return this.db.childrenOf(cid).find((s) => s.kind === "Component" && s.name === name) ?? null;
    };

    for (let i = 0; i < dae.varCount; i++) {
      const vName = dae.getVarName(i);
      const parts = vName.split(".");
      let currCid: SymbolId | null = rootClassId;
      let effectiveAnn: string | null = null;
      for (let p = 0; p < parts.length && currCid; p++) {
        const bIdxSeg = parts[p]!.indexOf("[");
        const seg = bIdxSeg >= 0 ? parts[p]!.slice(0, bIdxSeg) : parts[p]!;
        const comp = findClassComp(currCid, seg);
        if (!comp) break;
        const ann = findCompAnnText(this.db.cstNode(comp.id));
        if (ann) {
          const afterHide = ann.startsWith("HideResult") ? ann.slice("HideResult".length).trimStart() : "";
          const hideRhs = afterHide.startsWith("=") ? afterHide.slice(1).trim() : "";
          if (hideRhs && !hideRhs.includes("\n") && !hideRhs.includes("\r")) {
            let rhs = hideRhs;
            if (rhs !== "true" && rhs !== "false") {
              const pIdx = dae.getVarIdxByName(rhs);
              if (pIdx >= 0) {
                const exprId = dae.getVarExpression(pIdx);
                if (exprId !== undefined && exprId >= 0 && dae.getExprKind(exprId) === ExprKind.BoolLiteral) {
                  rhs = dae.getExprData1(exprId) !== 0 ? "true" : "false";
                }
              }
            }
            effectiveAnn = `HideResult = ${rhs}`;
          } else if (p === parts.length - 1) {
            effectiveAnn = ann;
          }
        }
        currCid = this.db.query<SymbolId | null>("classInstance", comp.id) ?? null;
      }
      if (effectiveAnn) {
        dae.setVarCadAnnotation(i, `(${effectiveAnn})`);
      }
    }
  }

  private markConditionalParametersFinal(dae: DAEBuilder, rootClassId: SymbolId): void {
    const condParamsByClassId = new Map<SymbolId, Set<string>>();
    const condParamsByClassName = new Map<string, Set<string>>();
    const baseClassesOf = new Map<SymbolId, SymbolId[]>();
    const visitedClasses = new Set<SymbolId>();
    const classQueue: SymbolId[] = [rootClassId];

    const extractDirectCondLeaves = (cCst: CstNodeLike | null | undefined): string[] => {
      if (!cCst) return [];
      const rawCText: string = cCst.text ?? "";
      if (!rawCText.includes("if ")) return [];
      const leaves: string[] = [];
      const IGNORED_KEYWORDS = new Set(["if", "true", "false", "not", "and", "or", "then", "else"]);

      const isIdentToken = (tok: string): boolean => {
        if (!tok || IGNORED_KEYWORDS.has(tok)) return false;
        const c0 = tok.charCodeAt(0);
        const isStart = (c0 >= 65 && c0 <= 90) || (c0 >= 97 && c0 <= 122) || c0 === 95;
        if (!isStart) return false;
        for (let i = 1; i < tok.length; i++) {
          const code = tok.charCodeAt(i);
          const ok =
            (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || (code >= 48 && code <= 57) || code === 95;
          if (!ok) return false;
        }
        return true;
      };

      const collectCondNodeIdentifiers = (condNode: CstNodeLike | null | undefined): void => {
        if (!condNode) return;
        if (condNode.type === "comment" || condNode.type === "string_comment" || condNode.type === "annotation") {
          return;
        }
        if (condNode.type === "identifier" || condNode.type === "IDENT") {
          const id = (condNode.text ?? "").trim();
          if (isIdentToken(id)) leaves.push(id);
          return;
        }
        if (Array.isArray(condNode.children) && condNode.children.length > 0) {
          for (const ch of condNode.children) {
            collectCondNodeIdentifiers(ch);
          }
          return;
        }
        const leafTxt = stripCommentsAndStrings(condNode.text ?? "").trim();
        if (isIdentToken(leafTxt)) {
          leaves.push(leafTxt);
        }
      };

      if (Array.isArray(cCst.children) && cCst.children.length > 0) {
        const walkOwnDecls = (node: CstNodeLike | null | undefined): void => {
          if (!node) return;
          if (node !== cCst && (node.type === "class_definition" || node.type === "ClassDefinition")) return;
          if (
            node.type === "equation_section" ||
            node.type === "algorithm_section" ||
            node.type === "modification" ||
            node.type === "comment" ||
            node.type === "string_comment" ||
            node.type === "annotation"
          ) {
            return;
          }
          if (node.type === "condition_attribute" || node.type === "ConditionAttribute") {
            collectCondNodeIdentifiers(node);
            return;
          }
          // Handle flat token children inside component_declaration if `condition_attribute` is unboxed
          if (
            (node.type === "component_declaration" || node.type === "component_declaration1") &&
            Array.isArray(node.children)
          ) {
            const hasExplicitCondChild = node.children.some(
              (ch: CstNodeLike | null | undefined) =>
                ch?.type === "condition_attribute" || ch?.type === "ConditionAttribute",
            );
            if (!hasExplicitCondChild) {
              let afterIf = false;
              for (const ch of node.children) {
                if (!ch) continue;
                if (ch.type === "comment" || ch.type === "string_comment" || ch.type === "annotation") break;
                if (!afterIf && (ch.type === "if" || ch.text?.trim() === "if")) {
                  afterIf = true;
                  continue;
                }
                if (afterIf) {
                  collectCondNodeIdentifiers(ch);
                }
              }
              if (afterIf) return;
            }
          }
          for (const ch of node.children || []) {
            walkOwnDecls(ch);
          }
        };
        walkOwnDecls(cCst);
      }
      return leaves;
    };

    while (classQueue.length > 0) {
      const cid = classQueue.pop()!;
      if (visitedClasses.has(cid)) continue;
      visitedClasses.add(cid);
      const cSym = this.db.symbol(cid) as any;
      let cachedInfo = cSym?._cachedCondParamInfo as
        { leaves: string[]; baseClassIds: SymbolId[]; childClassIds: SymbolId[] } | undefined;
      if (!cachedInfo || !Array.isArray(cachedInfo.baseClassIds)) {
        const leaves = extractDirectCondLeaves(this.db.cstNode(cid) as any);
        const baseClassIds: SymbolId[] = [];
        const childClassIds: SymbolId[] = [];
        for (const ch of this.db.childrenOf(cid)) {
          if (ch.kind === "Extends") {
            const baseSym =
              this.db.query<any>("resolvedBaseClass", ch.id) ??
              this.db.query<any>("extendsTarget", ch.id) ??
              this.db.byName(ch.name)?.[0];
            if (baseSym?.id) {
              baseClassIds.push(baseSym.id);
              childClassIds.push(baseSym.id);
            }
          } else if (ch.kind === "Component") {
            const targetSym = this.db.query<any>("classInstance", ch.id) ?? this.db.query<any>("resolvedType", ch.id);
            const ci = this.db.query<any>("componentInstance", ch.id);
            const tid =
              typeof targetSym === "number"
                ? targetSym
                : (targetSym?.id ??
                  (ci?.typeSpecifier ? this.db.byName(ci.typeSpecifier.split(".").pop()!)?.[0]?.id : undefined));
            if (tid) childClassIds.push(tid);
          }
        }
        cachedInfo = { leaves, baseClassIds, childClassIds };
        if (cSym) cSym._cachedCondParamInfo = cachedInfo;
      }
      condParamsByClassId.set(cid, new Set(cachedInfo.leaves));
      baseClassesOf.set(cid, cachedInfo.baseClassIds);
      for (const tid of cachedInfo.childClassIds) {
        if (!visitedClasses.has(tid)) classQueue.push(tid);
      }
    }

    // Propagate conditional parameter leaves from base classes along Extends edges
    let changed = true;
    while (changed) {
      changed = false;
      for (const [cid, bases] of baseClassesOf) {
        const targetSet = condParamsByClassId.get(cid);
        if (!targetSet) continue;
        for (const bid of bases) {
          const baseSet = condParamsByClassId.get(bid);
          if (!baseSet) continue;
          for (const leaf of baseSet) {
            if (!targetSet.has(leaf)) {
              targetSet.add(leaf);
              changed = true;
            }
          }
        }
      }
    }

    let hasAnyCondParams = false;
    for (const [cid, set] of condParamsByClassId) {
      if (set.size > 0) {
        hasAnyCondParams = true;
        const sym = this.db.symbol(cid);
        if (sym?.name) {
          let byNameSet = condParamsByClassName.get(sym.name);
          if (!byNameSet) {
            byNameSet = new Set();
            condParamsByClassName.set(sym.name, byNameSet);
          }
          for (const leaf of set) byNameSet.add(leaf);
        }
      }
    }
    if (!hasAnyCondParams) return;

    const findComponentTargetClass = (
      ownerCid: SymbolId,
      compName: string,
    ): { cid: SymbolId | null; typeName: string | null } => {
      const seen = new Set<SymbolId>();
      const queue: SymbolId[] = [ownerCid];
      while (queue.length > 0) {
        const cur = queue.pop()!;
        if (seen.has(cur)) continue;
        seen.add(cur);
        for (const ch of this.db.childrenOf(cur)) {
          if (ch.kind === "Component" && ch.name === compName) {
            const targetSym = this.db.query<any>("classInstance", ch.id) ?? this.db.query<any>("resolvedType", ch.id);
            const ci = this.db.query<any>("componentInstance", ch.id);
            const typeName = ci?.typeSpecifier ? String(ci.typeSpecifier).split(".").pop()! : null;
            const tid =
              typeof targetSym === "number"
                ? targetSym
                : (targetSym?.id ?? (typeName ? this.db.byName(typeName)?.[0]?.id : undefined) ?? null);
            return { cid: tid, typeName };
          }
          if (ch.kind === "Extends") {
            const baseSym =
              this.db.query<any>("resolvedBaseClass", ch.id) ??
              this.db.query<any>("extendsTarget", ch.id) ??
              this.db.byName(ch.name)?.[0];
            if (baseSym?.id && !seen.has(baseSym.id)) {
              queue.push(baseSym.id);
            }
          }
        }
      }
      return { cid: null, typeName: null };
    };

    const rootSet = condParamsByClassId.get(rootClassId);
    for (let i = 0; i < dae.varCount; i++) {
      if (dae.getVarVariability(i) !== Variability.Parameter) continue;
      const vName = dae.getVarName(i);
      const cleanName = stripArraySubscripts(vName);
      const parts = cleanName.split(".");
      const leaf = parts[parts.length - 1]!.split("[")[0]!;
      if (parts.length === 1) {
        if (rootSet?.has(leaf)) {
          dae.setVarFinal(i, true);
        }
      } else {
        let currCid: SymbolId | null = rootClassId;
        let lastTypeName: string | null = null;
        for (let p = 0; p < parts.length - 1; p++) {
          const bIdxSeg = parts[p]!.indexOf("[");
          const seg = bIdxSeg >= 0 ? parts[p]!.slice(0, bIdxSeg) : parts[p]!;
          if (currCid != null) {
            const resolved = findComponentTargetClass(currCid, seg);
            currCid = resolved.cid;
            lastTypeName = resolved.typeName;
          } else {
            currCid = null;
            lastTypeName = null;
            break;
          }
        }
        if (currCid != null) {
          if (condParamsByClassId.get(currCid)?.has(leaf)) {
            dae.setVarFinal(i, true);
          }
        } else if (lastTypeName != null) {
          if (condParamsByClassName.get(lastTypeName)?.has(leaf)) {
            dae.setVarFinal(i, true);
          }
        }
      }
    }
  }

  private recordWasmSourceRanges(dae: DAEBuilder, classId: SymbolId): void {
    const cst = this.db.cstNode(classId) as any;
    if (!cst) return;

    const topEqNodes: any[] = [];
    const bodyForEqNodes: any[] = [];
    let hasCompoundEq = false;
    const walkEqs = (node: any, insideCompound = false): void => {
      if (!node) return;
      if (
        (node !== cst && node.type === "class_definition") ||
        node.type === "extends_clause" ||
        node.type === "component_clause" ||
        node.type === "component_clause1" ||
        node.type === "component_declaration" ||
        node.type === "algorithm_section"
      ) {
        return;
      }

      if (node.type === "for_equation" || node.type === "if_equation" || node.type === "when_equation") {
        hasCompoundEq = true;
        for (const child of node.children || []) {
          walkEqs(child, true);
        }
        return;
      }

      if (node.type === "simple_equation" || node.type === "connect_equation" || node.type === "function_call") {
        if (insideCompound) {
          bodyForEqNodes.push(node);
        } else {
          topEqNodes.push(node);
        }
        return;
      }

      for (const child of node.children || []) {
        walkEqs(child, insideCompound);
      }
    };
    walkEqs(cst, false);

    const applyEqNodeMeta = (eqIdx: number, node: any): void => {
      const sB = node.startIndex ?? node.startOffset;
      const eB = node.endIndex ?? node.endOffset;
      if (sB != null && eB != null && eqIdx >= 0 && eqIdx < dae.getEqCount()) {
        dae.setEqSourceRange(eqIdx, sB, eB);
        for (const c of node.children || []) {
          if (c.type === "description" || c.type === "description_string" || c.type === "string_literal") {
            const t = c.text?.trim();
            if (t) dae.setEqDescription(eqIdx, t);
            break;
          }
        }
      }
    };

    const totalEqs = dae.getEqCount();
    if (!hasCompoundEq && topEqNodes.length > 0 && topEqNodes.length <= totalEqs) {
      // Root class equations are emitted after inherited/subcomponent equations in WASM flattening
      const offset = totalEqs - topEqNodes.length;
      for (let i = 0; i < topEqNodes.length; i++) {
        applyEqNodeMeta(offset + i, topEqNodes[i]);
      }
    } else if (hasCompoundEq && topEqNodes.length === 0 && bodyForEqNodes.length === 1 && totalEqs > 0) {
      // Single unrolled loop/branch body equation: propagate its source range and description
      for (let i = 0; i < totalEqs; i++) {
        applyEqNodeMeta(i, bodyForEqNodes[0]);
      }
    }

    // Pre-resolve all variable names so interner lookup succeeds in getVarIdxByName
    const varCount = dae.varCount;
    for (let i = 0; i < varCount; i++) {
      dae.getVarName(i);
    }

    const walkVars = (node: any): void => {
      if (!node) return;
      if (node !== cst && node.type === "class_definition") return;
      if (
        node.type === "component_declaration" ||
        node.type === "component_declaration1" ||
        node.type === "declaration"
      ) {
        const declNodes: any[] =
          node.type === "component_declaration" || node.type === "component_declaration1"
            ? (node.children || []).filter((c: any) => c.type === "declaration")
            : [node];
        if (declNodes.length === 0) declNodes.push(node);

        let typeSpecNode: any = null;
        let pNode = node;
        while (pNode && pNode.type !== "composition") {
          typeSpecNode = (pNode.children || []).find((c: any) => c.type === "type_specifier" || c.type === "name");
          if (typeSpecNode) break;
          pNode = pNode.parent;
        }
        const rawTypeName = typeSpecNode?.text?.trim();
        const leafTypeName = rawTypeName ? rawTypeName.split(".").pop() : undefined;

        for (const declNode of declNodes) {
          const idChild = (declNode.children || []).find((c: any) => c.type === "identifier");
          const name = idChild ? idChild.text?.trim() : extractFirstDeclToken(declNode.text);
          if (name) {
            let varIdx = dae.getVarIdxByName(name);
            if (varIdx < 0) {
              varIdx = dae.getVarIdxByName(`${name}[1]`);
            }
            const sB = declNode.startIndex ?? declNode.startOffset;
            const eB = declNode.endIndex ?? declNode.endOffset;
            if (varIdx >= 0 && sB != null && eB != null) {
              dae.setVarSourceRange(varIdx, sB, eB);
              const arrayIndices = dae.getArrayElementIndices(name);
              for (const idx of arrayIndices) {
                dae.setVarSourceRange(idx, sB, eB);
              }
            }
            const desc = extractDescription(node);
            if (desc && varIdx >= 0) {
              dae.setVarDescription(varIdx, desc);
              const arrayIndices = dae.getArrayElementIndices(name);
              for (const idx of arrayIndices) {
                dae.setVarDescription(idx, desc);
              }
            }
            let p = node.parent;
            while (p && p.type !== "element" && p.type !== "composition") {
              p = p.parent;
            }
            const isFinalElement =
              p &&
              p.type === "element" &&
              ((p.children || []).some((c: any) => c.type === "final" || c.text?.trim() === "final") ||
                tokenizeCommentStrippedWords((p.text ?? "").split("(")[0] ?? "").includes("final"));
            if (isFinalElement) {
              if (varIdx >= 0) {
                dae.setVarFinal(varIdx, true);
              }
              const arrayIndices = dae.getArrayElementIndices(name);
              for (const idx of arrayIndices) {
                dae.setVarFinal(idx, true);
              }
              for (let i = 0; i < dae.varCount; i++) {
                const vName = dae.getVarName(i);
                if (vName === name || vName.startsWith(`${name}.`) || vName.startsWith(`${name}[`)) {
                  dae.setVarFinal(i, true);
                }
              }
            }
            if (varIdx >= 0) {
              const targetModRoot = declNode ?? node;
              const qValRaw = findDeclElementModificationValueCst(targetModRoot, "quantity");
              if (qValRaw && qValRaw.startsWith('"') && qValRaw.endsWith('"')) {
                try {
                  const qStr = JSON.parse(qValRaw);
                  const qId = dae.addExpression(ExprKind.StringLiteral, dae.interner.intern(qStr));
                  dae.setVarAttr(varIdx, "quantity", qId);
                  const arrayIndices = dae.getArrayElementIndices(name);
                  for (const idx of arrayIndices) {
                    dae.setVarAttr(idx, "quantity", qId);
                  }
                } catch {
                  // Fallback for non-standard string escapes in Modelica quantity attribute
                  const qStr = qValRaw.slice(1, -1);
                  const qId = dae.addExpression(ExprKind.StringLiteral, dae.interner.intern(qStr));
                  dae.setVarAttr(varIdx, "quantity", qId);
                  const arrayIndices = dae.getArrayElementIndices(name);
                  for (const idx of arrayIndices) {
                    dae.setVarAttr(idx, "quantity", qId);
                  }
                }
              }
              const ssValRaw = findDeclElementModificationValueCst(targetModRoot, "stateSelect");
              if (ssValRaw) {
                const ssShort = ssValRaw.startsWith("StateSelect.") ? ssValRaw.slice("StateSelect.".length) : ssValRaw;
                const ssLiterals = ["never", "avoid", "default", "prefer", "always"];
                const ssIdx = ssLiterals.indexOf(ssShort);
                if (ssIdx >= 0) {
                  const enumExprId = dae.addEnumLiteral(ssIdx + 1, `StateSelect.${ssShort}`);
                  dae.setVarAttr(varIdx, "stateSelect", enumExprId);
                  const arrayIndices = dae.getArrayElementIndices(name);
                  for (const idx of arrayIndices) {
                    dae.setVarAttr(idx, "stateSelect", enumExprId);
                  }
                }
              }

              const isEnumVar =
                dae.getVarType(varIdx) === VarType.Enumeration ||
                (rawTypeName && this.enumTypeMap.has(rawTypeName)) ||
                (leafTypeName && this.enumTypeMap.has(leafTypeName));
              if (isEnumVar) {
                const lits =
                  (rawTypeName ? this.enumTypeMap.get(rawTypeName) : undefined) ??
                  (leafTypeName ? this.enumTypeMap.get(leafTypeName) : undefined);
                if (lits && lits.length > 0) {
                  const formatted = lits.map((s: string) => ({ stringValue: s }));
                  dae.setVarEnumerationLiterals(varIdx, formatted);
                  const arrayIndices = dae.getArrayElementIndices(name);
                  for (const idx of arrayIndices) {
                    dae.setVarEnumerationLiterals(idx, formatted);
                  }
                }
              }
            }
          }
        }
        if (node.type === "component_declaration" || node.type === "component_declaration1") {
          return;
        }
      }
      for (const child of node.children || []) {
        walkVars(child);
      }
    };
    walkVars(cst);

    if (!dae.extensionMetadata?.["isOldFrontend"]) {
      this.markConditionalParametersFinal(dae, classId);
    }

    for (let i = 0; i < dae.varCount; i++) {
      if (dae.getVarType(i) === VarType.Enumeration) {
        const existing = dae.getVarEnumerationLiterals(i);
        if (!existing || existing.length === 0) {
          let resolvedLits: string[] | undefined;
          const varName = dae.getVarName(i);
          const leafComp = varName.split(".").pop()!.split("[")[0]!;
          const compSyms = this.db.byName(leafComp).filter((s) => s.kind === "Component");
          for (const cs of compSyms) {
            const compInst = this.db.query<any>("componentInstance", cs.id);
            const typeSpec = compInst?.typeSpecifier;
            if (typeSpec) {
              const lits = this.enumTypeMap.get(typeSpec) ?? this.enumTypeMap.get(typeSpec.split(".").pop()!);
              if (lits && lits.length > 0) {
                resolvedLits = lits;
                break;
              }
            }
          }
          if (!resolvedLits) {
            const bindExpr = dae.getVarExpression(i) ?? -1;
            if (bindExpr >= 0 && dae.getExprKind(bindExpr) === ExprKind.EnumLiteral) {
              const litPath = dae.interner.resolve(dae.getExprLeft(bindExpr));
              if (litPath) {
                const dotIdx = litPath.lastIndexOf(".");
                if (dotIdx > 0) {
                  const enumTypePath = litPath.slice(0, dotIdx);
                  const lits =
                    this.enumTypeMap.get(enumTypePath) ?? this.enumTypeMap.get(enumTypePath.split(".").pop()!);
                  if (lits && lits.length > 0) {
                    resolvedLits = lits;
                  }
                }
              }
            }
          }
          if (!resolvedLits) {
            const rootTxt: string = (cst as any)?.text ?? "";
            if (rootTxt.includes("redeclare")) {
              for (const cs of compSyms) {
                const compInst = this.db.query<any>("componentInstance", cs.id);
                const typeSpec = compInst?.typeSpecifier;
                if (!typeSpec) continue;
                const leafT = typeSpec.split(".").pop()!;
                const re = new RegExp(
                  `\\bredeclare\\s+(?:replaceable\\s+)?type\\s+${leafT.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\s*=\\s*([A-Za-z_][\\w.]*)`,
                );
                const m = rootTxt.match(re);
                if (m) {
                  const target = m[1]!;
                  const lits = this.enumTypeMap.get(target) ?? this.enumTypeMap.get(target.split(".").pop()!);
                  if (lits && lits.length > 0) {
                    resolvedLits = lits;
                    break;
                  }
                }
              }
            }
          }
          if (resolvedLits && resolvedLits.length > 0) {
            const formatted = resolvedLits.map((s: string) => ({ stringValue: s }));
            dae.setVarEnumerationLiterals(i, formatted);
          }
        }
      }
    }
  }

  private populateWasmScopeResolutions(wasmFlattener: number, rootClassId: SymbolId, dae: DAEBuilder): void {
    interface ScopeResExports {
      flattener_registerScopeResolution?: (
        wf: number,
        scopePtr: number,
        nameId: number,
        targetPtr: number,
        globalOffset: number,
        alsoGlobal?: number,
      ) => void;
      flattener_registerEnumLiteral?: (wf: number, typeNameId: number, litNameId: number, index: number) => void;
      flattener_registerScopeConstReal?: (wf: number, scopePtr: number, nameId: number, value: number) => void;
      flattener_registerCanonicalName?: (wf: number, targetPtr: number, canonFqnId: number) => void;
      flattener_registerComplexType?: (wf: number, typeId: number) => void;
      flattener_allocSourceBuffer?: (wf: number, totalBytes: number, enc: number) => number;
      lsp_isCharOffsetKernel?: () => boolean | number;
      lsp_getInputEncoding?: () => number;
      memory?: WebAssembly.Memory;
    }
    const ex = dae.exports as unknown as ScopeResExports;
    if (typeof ex.flattener_registerScopeResolution !== "function") return;
    const register = ex.flattener_registerScopeResolution;
    const registerEnum = ex.flattener_registerEnumLiteral;
    const registerConstReal = ex.flattener_registerScopeConstReal;
    const registerCanon = ex.flattener_registerCanonicalName;
    const registerComplexType = ex.flattener_registerComplexType;
    const allocSourceBuf: ((wf: number, totalBytes: number, enc: number) => number) | undefined =
      typeof ex.flattener_allocSourceBuffer === "function" ? ex.flattener_allocSourceBuffer : undefined;
    const wasmMemory: WebAssembly.Memory | undefined = ex.memory;

    if (typeof registerConstReal === "function") {
      for (const [cKey, cVal] of Object.entries(MODELICA_CONSTANTS)) {
        if (cKey.includes(".") && typeof cVal === "number" && Number.isFinite(cVal)) {
          registerConstReal(wasmFlattener, 0, dae.interner.intern(cKey), cVal);
        }
      }
    }

    const isPackageSymEntry = (entry: SymbolEntry | null | undefined): boolean => {
      if (!entry) return false;
      if (entry.kind === "Package") return true;
      const ck = String((entry.metadata as Record<string, unknown> | undefined)?.["classKind"] ?? "").toLowerCase();
      if (ck === "package") return true;
      if (ck) return false;
      const cst = this.db.cstNode(entry.id) as { text?: string } | null;
      return Boolean(cst?.text && /^(?:encapsulated\s+)?package\b/.test(cst.text.trimStart()));
    };

    const evalConstantCompReal = (sym: SymbolEntry): number | null => {
      const cst = this.db.cstNode(sym.id) as { text?: string } | null;
      const txt = cst?.text;
      if (!txt) return null;
      const eqIdx = txt.indexOf("=");
      if (eqIdx < 0) return null;
      let rhs = txt.slice(eqIdx + 1).trim();
      const semiIdx = rhs.indexOf(";");
      if (semiIdx >= 0) rhs = rhs.slice(0, semiIdx).trim();
      const qIdx = rhs.indexOf('"');
      if (qIdx >= 0) rhs = rhs.slice(0, qIdx).trim();
      const annIdx = rhs.search(/\bannotation\b/);
      if (annIdx >= 0) rhs = rhs.slice(0, annIdx).trim();
      if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(rhs)) {
        const v = Number(rhs);
        return Number.isFinite(v) ? v : null;
      }
      const known = MODELICA_CONSTANTS[rhs];
      return typeof known === "number" && Number.isFinite(known) ? known : null;
    };

    const isCharOffset = typeof ex.lsp_isCharOffsetKernel === "function" && Boolean(ex.lsp_isCharOffsetKernel());
    const encoding = typeof ex.lsp_getInputEncoding === "function" ? ex.lsp_getInputEncoding() : undefined;
    const isUtf16 = encoding === 1 || encoding === 2 || isCharOffset;
    const unitSize = isCharOffset ? 1 : inputEncodingUnitSize(encoding);

    interface CstNodeLike {
      ptr?: number;
      type?: string;
      text?: string;
      children?: CstNodeLike[];
      _startOffset?: number;
      _cachedPad?: number;
      startIndex?: number;
      startOffset?: number;
      tree?: { sourceCode?: string; rootPtr?: number; rootNode?: { ptr?: number } };
    }
    type ResolveNameFn = (name: string) => SymbolEntry | undefined;

    // Track per-file source texts so cross-file CST nodes (libraries, MSL, multi-file workspaces)
    // share one contiguous linear-memory source buffer with root file anchored at offset 0.
    interface FileSourceEntry {
      key: string;
      text: string;
      utf8Bytes?: Uint8Array;
      baseUnitOffset: number;
      unitLen: number;
    }
    const fileEntries = new Map<string, FileSourceEntry>();
    let nextBaseUnitOffset = 0;
    let utf8Encoder: TextEncoder | null = null;

    const ensureFileSource = (
      cst: CstNodeLike | null | undefined,
      sym: SymbolEntry | null | undefined,
    ): FileSourceEntry | null => {
      const text: string | undefined = cst?.tree?.sourceCode;
      if (typeof text !== "string") return null;
      const key: string =
        sym?.resourceId ??
        (cst?.tree?.rootPtr
          ? `tree:${cst.tree.rootPtr}`
          : cst?.tree?.rootNode?.ptr
            ? `tree:${cst.tree.rootNode.ptr}`
            : "");
      if (!key) return null;
      let entry = fileEntries.get(key);
      if (!entry) {
        if (isUtf16) {
          entry = { key, text, baseUnitOffset: nextBaseUnitOffset, unitLen: text.length };
          nextBaseUnitOffset += text.length;
        } else {
          if (!utf8Encoder) utf8Encoder = new TextEncoder();
          const utf8Bytes = utf8Encoder.encode(text);
          entry = { key, text, utf8Bytes, baseUnitOffset: nextBaseUnitOffset, unitLen: utf8Bytes.length };
          nextBaseUnitOffset += utf8Bytes.length;
        }
        fileEntries.set(key, entry);
      }
      return entry;
    };

    const rootEntrySym = this.db.symbol(rootClassId);
    const rootCst = this.db.cstNode(rootClassId) as unknown as CstNodeLike | null;
    const rootFileEntry = ensureFileSource(rootCst, rootEntrySym);

    interface PendingScopeRes {
      scopePtr: number;
      nameId: number;
      targetPtr: number;
      localOffset: number;
      fileEntry: FileSourceEntry | null;
      alsoGlobal: boolean;
    }
    const pendingResolutions: PendingScopeRes[] = [];

    const computeLocalOffset = (targetCst: CstNodeLike, resolvedSym: SymbolEntry | null | undefined): number => {
      return targetCst._startOffset !== undefined
        ? targetCst._startOffset + (targetCst._cachedPad ?? 0)
        : (targetCst.startIndex ??
            targetCst.startOffset ??
            (resolvedSym as { startOffset?: number } | null | undefined)?.startOffset ??
            0) * unitSize;
    };

    const pendingCanonNames: { targetPtr: number; canonId: number }[] = [];
    const complexTypeCache = new Map<SymbolId, boolean>();
    const registeredComplexIds = new Set<number>();
    const isComplexSubtypeSym = (sym: SymbolEntry | null | undefined, depth = 0): boolean => {
      if (!sym?.id || depth > 8) return false;
      const cached = complexTypeCache.get(sym.id);
      if (cached !== undefined) return cached;
      if (sym.name === "Complex" || getSymbolQualifiedName(this.db, sym.id) === "Complex") {
        complexTypeCache.set(sym.id, true);
        return true;
      }
      const symCst = this.db.cstNode(sym.id) as { text?: string; children?: any[]; type?: string } | null;
      const findShortType = (node: any): string | undefined => {
        if (!node) return undefined;
        if (node.type === "short_class_specifier") {
          return node.children?.find((c: any) => c.type === "type_specifier" || c.type === "name")?.text?.trim();
        }
        for (const ch of node.children || []) {
          const r = findShortType(ch);
          if (r) return r;
        }
        return undefined;
      };
      const baseName = findShortType(symCst);
      if (baseName) {
        if (baseName === "Complex" || baseName === ".Complex") {
          complexTypeCache.set(sym.id, true);
          return true;
        }
        const lookupScope = sym.parentId ?? sym.id;
        const baseSym =
          this.db.query<ResolveNameFn>("resolveName", sym.id)?.(baseName) ??
          this.db.query<ResolveNameFn>("resolveSimpleName", sym.id)?.(baseName) ??
          this.db.query<ResolveNameFn>("resolveName", lookupScope)?.(baseName) ??
          this.db.query<ResolveNameFn>("resolveSimpleName", lookupScope)?.(baseName);
        if (baseSym && baseSym.id !== sym.id) {
          const res = isComplexSubtypeSym(baseSym, depth + 1);
          complexTypeCache.set(sym.id, res);
          return res;
        }
      }
      complexTypeCache.set(sym.id, false);
      return false;
    };

    const queueResolution = (
      scopePtr: number,
      name: string,
      targetCst: CstNodeLike | null | undefined,
      resolvedSym: SymbolEntry | null | undefined,
      alsoGlobal: boolean,
    ): void => {
      if (!targetCst?.ptr) return;
      const fileEntry = ensureFileSource(targetCst, resolvedSym);
      const nameId = dae.interner.intern(name);
      const localOffset = computeLocalOffset(targetCst, resolvedSym);
      pendingResolutions.push({ scopePtr, nameId, targetPtr: targetCst.ptr, localOffset, fileEntry, alsoGlobal });
      if (resolvedSym?.id) {
        const qName = getSymbolQualifiedName(this.db, resolvedSym.id);
        if (qName) {
          const canonId = dae.interner.intern(qName);
          pendingCanonNames.push({ targetPtr: targetCst.ptr, canonId });
          if (isComplexSubtypeSym(resolvedSym)) {
            registeredComplexIds.add(nameId);
            registeredComplexIds.add(canonId);
          }
        }
      }
    };

    const visited = new Set<SymbolId>();
    const queue: SymbolId[] = [rootClassId];
    this.enumTypeMap.clear();
    const builtinEnums: Array<[string, string[]]> = [
      ["AssertionLevel", ["warning", "error"]],
      ["StateSelect", ["never", "avoid", "default", "prefer", "always"]],
    ];
    for (const [bName, bLits] of builtinEnums) {
      this.enumTypeMap.set(bName, bLits);
      if (typeof registerEnum === "function") {
        for (let i = 0; i < bLits.length; i++) {
          const lit = bLits[i];
          const refId = dae.interner.intern(`${bName}.${lit}`);
          registerEnum(wasmFlattener, refId, i + 1, refId);
        }
      }
    }
    const skipCallBuiltins = new Set([
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
      "abs",
      "sign",
      "floor",
      "ceil",
      "div",
      "mod",
      "rem",
      "min",
      "max",
      "sum",
      "product",
      "integer",
      "Integer",
      "String",
      "Real",
      "Boolean",
      "fill",
      "zeros",
      "ones",
      "identity",
      "diagonal",
      "linspace",
      "cat",
      "size",
      "ndims",
      "transpose",
      "vector",
      "matrix",
      "scalar",
      "symmetric",
      "cross",
      "skew",
      "pre",
      "previous",
      "hold",
      "noEvent",
      "smooth",
      "sample",
      "superSample",
      "subSample",
      "shiftSample",
      "backSample",
      "interval",
      "noClock",
      "Clock",
      "change",
      "edge",
      "initial",
      "terminal",
      "assert",
      "terminate",
      "reinit",
      "delay",
      "spatialDistribution",
      "semiLinear",
      "getInstanceName",
      "cardinality",
      "homotopy",
      "inStream",
      "actualStream",
      "firstTick",
      "der",
      "connect",
      "Connections",
      "array",
    ]);

    while (queue.length > 0) {
      const classId = queue.pop()!;
      if (visited.has(classId)) continue;
      visited.add(classId);

      const classEntry = this.db.symbol(classId);
      const classCst = this.db.cstNode(classId) as unknown as CstNodeLike | null;
      const scopePtr: number = classCst?.ptr ?? 0;
      ensureFileSource(classCst, classEntry);

      const rootQNameForEnum = getSymbolQualifiedName(this.db, rootClassId);
      const isNewInstEnum = !(this.options.isOldFrontend || dae.extensionMetadata?.["isOldFrontend"]);
      const formatEnumDisplayName = (qName: string, fallback: string): string => {
        if (isNewInstEnum && rootQNameForEnum && qName.startsWith(`${rootQNameForEnum}.`)) {
          return qName.slice(rootQNameForEnum.length + 1);
        }
        return qName || fallback;
      };
      const registerEnumTypeAlias = (
        aliasName: string,
        aliasQName: string,
        lits: string[],
        canonDisplayName: string,
      ): void => {
        this.enumTypeMap.set(aliasName, lits);
        if (aliasQName) {
          this.enumTypeMap.set(aliasQName, lits);
          const qParts = aliasQName.split(".");
          for (let pIdx = 1; pIdx < qParts.length; pIdx++) {
            this.enumTypeMap.set(qParts.slice(pIdx).join("."), lits);
          }
        }
        if (typeof registerEnum === "function") {
          for (let i = 0; i < lits.length; i++) {
            const lit = lits[i];
            const ordinal = i + 1;
            const fullPath = `${canonDisplayName}.${lit}`;
            const fullPathId = dae.interner.intern(fullPath);
            const shortRefId = dae.interner.intern(`${aliasName}.${lit}`);
            registerEnum(wasmFlattener, shortRefId, ordinal, fullPathId);
            if (aliasQName) {
              const qRefId = dae.interner.intern(`${aliasQName}.${lit}`);
              registerEnum(wasmFlattener, qRefId, ordinal, fullPathId);
              const qParts = aliasQName.split(".");
              for (let pIdx = 1; pIdx < qParts.length; pIdx++) {
                const suffix = qParts.slice(pIdx).join(".");
                const sRefId = dae.interner.intern(`${suffix}.${lit}`);
                registerEnum(wasmFlattener, sRefId, ordinal, fullPathId);
              }
            }
          }
        }
      };

      // Check if this class definition is an enumeration
      const isEnum = (classEntry?.metadata as any)?.isEnumeration || Boolean(classCst?.text?.includes("enumeration("));
      if (isEnum && classEntry) {
        const lits = extractEnumLiteralsFromCst(classCst, classEntry.metadata);
        if (lits && lits.length > 0) {
          const qName = getSymbolQualifiedName(this.db, classId);
          const displayName = formatEnumDisplayName(qName, classEntry.name);
          registerEnumTypeAlias(classEntry.name, qName, lits, displayName);
          if (qName) queueResolution(scopePtr, qName, classCst, classEntry, true);
        }
      }

      // Check if this class definition is a short class specifier (e.g. model E = B.C(x=6) or type E2 = E1(...))
      const findShortSpec = (node: any): any => {
        if (!node) return null;
        if (node.type === "short_class_specifier") return node;
        for (const ch of node.children || []) {
          const found = findShortSpec(ch);
          if (found) return found;
        }
        return null;
      };
      const shortSpecNode = findShortSpec(classCst);
      if (shortSpecNode) {
        const typeSpecNode = shortSpecNode.children?.find((c: any) => c.type === "type_specifier" || c.type === "name");
        const typeName: string | undefined = typeSpecNode?.text?.trim();
        if (typeName) {
          const lookupScope = classEntry?.parentId ?? classId;
          const resolved =
            this.db.query<ResolveNameFn>("resolveName", classId)?.(typeName) ??
            this.db.query<ResolveNameFn>("resolveSimpleName", classId)?.(typeName) ??
            this.db.query<ResolveNameFn>("resolveName", lookupScope)?.(typeName) ??
            this.db.query<ResolveNameFn>("resolveSimpleName", lookupScope)?.(typeName);
          if (resolved && resolved.id) {
            const targetCst = this.db.cstNode(resolved.id) as unknown as CstNodeLike | null;
            queueResolution(scopePtr, typeName, targetCst, resolved, false);
            queue.push(resolved.id);

            // Chase short-class chain to see if this derived type aliases an enumeration
            if (!isEnum && classEntry) {
              let curSym: SymbolEntry | undefined = resolved;
              for (let hop = 0; hop < 8 && curSym?.id; hop++) {
                const curCst = this.db.cstNode(curSym.id) as unknown as CstNodeLike | null;
                const curIsEnum =
                  Boolean(curSym.metadata?.["isEnumeration"]) || Boolean(curCst?.text?.includes("enumeration("));
                if (curIsEnum) {
                  const baseLits = extractEnumLiteralsFromCst(curCst, curSym.metadata);
                  if (baseLits && baseLits.length > 0) {
                    const baseQName = getSymbolQualifiedName(this.db, curSym.id);
                    const canonDisplay = formatEnumDisplayName(baseQName, curSym.name);
                    const aliasQName = getSymbolQualifiedName(this.db, classId);
                    registerEnumTypeAlias(classEntry.name, aliasQName, baseLits, canonDisplay);
                    if (baseQName) queueResolution(scopePtr, baseQName, curCst, curSym, true);
                  }
                  break;
                }
                const nextShort = findShortSpec(curCst);
                const nextTypeNode = nextShort?.children?.find(
                  (c: CstNodeLike) => c.type === "type_specifier" || c.type === "name",
                );
                const nextTypeName: string | undefined = nextTypeNode?.text?.trim();
                if (!nextTypeName) break;
                const nextScope: SymbolId = curSym.parentId ?? curSym.id;
                curSym =
                  this.db.query<ResolveNameFn>("resolveName", nextScope)?.(nextTypeName) ??
                  this.db.query<ResolveNameFn>("resolveSimpleName", nextScope)?.(nextTypeName);
              }
            }
          }
        }
      }

      // Collect imports for this class and register with WASM flattener
      const classImports = this.collectClassImports(classId);
      for (const [shortName, fullPkg] of classImports) {
        const resolved =
          this.db.query<ResolveNameFn>("resolveName", classId)?.(fullPkg) ??
          this.db.query<ResolveNameFn>("resolveSimpleName", classId)?.(fullPkg) ??
          this.db
            .byName(fullPkg.split(".").pop() ?? "")
            .find((e) => e.kind === "Class" || e.kind === "Package" || e.kind === "Component");
        const knownConstVal = MODELICA_CONSTANTS[fullPkg];
        if (typeof knownConstVal === "number" && Number.isFinite(knownConstVal)) {
          const astVal = resolved?.kind === "Component" ? evalConstantCompReal(resolved) : null;
          const chosen = astVal !== null ? astVal : knownConstVal;
          if (typeof registerConstReal === "function" && scopePtr !== 0) {
            registerConstReal(wasmFlattener, scopePtr, dae.interner.intern(shortName), chosen);
          }
          continue;
        }
        if (resolved && resolved.id) {
          if (resolved.kind === "Component") {
            const cVal = evalConstantCompReal(resolved);
            if (cVal !== null && typeof registerConstReal === "function" && scopePtr !== 0) {
              registerConstReal(wasmFlattener, scopePtr, dae.interner.intern(shortName), cVal);
            }
            continue;
          }
          const targetCst = this.db.cstNode(resolved.id) as unknown as CstNodeLike | null;
          queueResolution(scopePtr, shortName, targetCst, resolved, false);
          if (!isPackageSymEntry(resolved)) {
            queue.push(resolved.id);
          } else if (
            (fullPkg === "Modelica.Constants" || fullPkg === "ModelicaServices.Machine") &&
            typeof registerConstReal === "function" &&
            scopePtr !== 0
          ) {
            for (const [cName, cVal] of Object.entries(MODELICA_BASE_CONSTANTS)) {
              registerConstReal(wasmFlattener, scopePtr, dae.interner.intern(`${shortName}.${cName}`), cVal);
            }
          }
        }
      }

      // Collect redeclare type targets AND function/record call targets inside extends/component modifications/equations of this class
      const scanRedeclareTargets = (node: CstNodeLike | null | undefined): void => {
        if (!node) return;
        const nt = node.type;
        if (nt === "class_definition" && node !== classCst) return;
        if (nt === "equation_section" || nt === "algorithm_section" || nt === "annotation_clause") return;
        if (nt === "element_redeclaration") {
          const findTypeSpecs = (sub: CstNodeLike | null | undefined): void => {
            if (!sub) return;
            if (sub.type === "type_specifier" || (sub.type === "name" && Boolean(sub.text?.includes(".")))) {
              const tName = sub.text?.trim();
              if (tName && tName !== "Real" && tName !== "Integer" && tName !== "Boolean" && tName !== "String") {
                const resolved =
                  this.db.query<ResolveNameFn>("resolveName", classId)?.(tName) ??
                  this.db.query<ResolveNameFn>("resolveSimpleName", classId)?.(tName);
                if (resolved && resolved.id) {
                  const targetCst = this.db.cstNode(resolved.id) as unknown as CstNodeLike | null;
                  queueResolution(scopePtr, tName, targetCst, resolved, true);
                  queue.push(resolved.id);
                }
              }
              return;
            }
            for (const c of sub.children || []) findTypeSpecs(c);
          };
          findTypeSpecs(node);
          return;
        }
        for (const c of node.children || []) scanRedeclareTargets(c);
      };
      scanRedeclareTargets(classCst);

      const scanCallTargets = (node: CstNodeLike | null | undefined): void => {
        if (!node) return;
        const nt = node.type;
        if (nt === "class_definition" && node !== classCst) return;
        if (nt === "annotation_clause") return;
        const isExprCall =
          (nt === "primary" || nt === "lhs_primary") &&
          Boolean(node.children?.some((c) => c.type === "function_call_args"));
        if (nt === "function_call" || isExprCall) {
          const calleeNode =
            node.children?.find(
              (c) => c.type === "component_reference" || c.type === "name" || c.type === "identifier",
            ) ?? node.children?.[0];
          const fnName = calleeNode?.text?.trim();
          if (
            fnName &&
            !fnName.includes("[") &&
            !fnName.includes("(") &&
            !/^\d/.test(fnName) &&
            !skipCallBuiltins.has(fnName)
          ) {
            const resolved =
              this.db.query<ResolveNameFn>("resolveName", classId)?.(fnName) ??
              this.db.query<ResolveNameFn>("resolveSimpleName", classId)?.(fnName);
            if (resolved && resolved.id) {
              const targetCst = this.db.cstNode(resolved.id) as unknown as CstNodeLike | null;
              queueResolution(scopePtr, fnName, targetCst, resolved, fnName.includes("."));
              const qName = getSymbolQualifiedName(this.db, resolved.id);
              if (qName && qName !== fnName) {
                queueResolution(scopePtr, qName, targetCst, resolved, true);
              }
              const isRec = Boolean(
                (resolved.metadata as Record<string, unknown> | undefined)?.["isRecord"] ||
                (typeof targetCst?.text === "string" &&
                  /^\s*(?:encapsulated\s+)?(?:partial\s+)?(?:replaceable\s+)?(?:operator\s+)?record\b/.test(
                    targetCst.text,
                  )),
              );
              if (isRec && !isPackageSymEntry(resolved)) {
                queue.push(resolved.id);
              }
            }
          }
        }
        for (const c of node.children || []) scanCallTargets(c);
      };
      scanCallTargets(classCst);

      const children = this.db.childrenOf(classId);
      const isCurrentPkg = isPackageSymEntry(classEntry);

      for (const child of children) {
        if (child.kind === "Extends") {
          const extCst = this.db.cstNode(child.id) as unknown as CstNodeLike | null;
          const typeSpecNode = extCst?.children?.find(
            (c: CstNodeLike) => c.type === "type_specifier" || c.type === "name",
          );
          const extName: string = typeSpecNode?.text?.trim() ?? child.name;
          if (extName) {
            const resolved =
              this.db.query<ResolveNameFn>("resolveName", classId)?.(extName) ??
              this.db.query<ResolveNameFn>("resolveSimpleName", classId)?.(extName) ??
              this.db.query<SymbolEntry | undefined>("resolvedBaseClass", classId);
            if (resolved && resolved.id) {
              const targetCst = this.db.cstNode(resolved.id) as unknown as CstNodeLike | null;
              queueResolution(scopePtr, extName, targetCst, resolved, true);
              queue.push(resolved.id);
            }
          }
        } else if (child.kind === "Component") {
          const compInst = this.db.query<{ typeSpecifier?: string; classInstance?: SymbolId } | undefined>(
            "componentInstance",
            child.id,
          );
          const typeSpec: string | undefined = compInst?.typeSpecifier;
          if (
            typeSpec &&
            typeSpec !== "Real" &&
            typeSpec !== "Integer" &&
            typeSpec !== "Boolean" &&
            typeSpec !== "String"
          ) {
            let targetId = compInst?.classInstance;
            if (!targetId) {
              const resolved =
                this.db.query<ResolveNameFn>("resolveName", classId)?.(typeSpec) ??
                this.db.query<ResolveNameFn>("resolveSimpleName", classId)?.(typeSpec);
              if (resolved) targetId = resolved.id;
            }
            if (targetId) {
              const targetSym = this.db.symbol(targetId);
              const targetCst = this.db.cstNode(targetId) as unknown as CstNodeLike | null;
              queueResolution(scopePtr, typeSpec, targetCst, targetSym, true);
              if (!isPackageSymEntry(targetSym)) {
                queue.push(targetId);
              }
            }
          }
        } else if (child.kind === "Class") {
          if (!isCurrentPkg && !isPackageSymEntry(child)) {
            queue.push(child.id);
          }
          const childCst = this.db.cstNode(child.id) as unknown as CstNodeLike | null;
          const isChildEnum =
            Boolean(child.metadata?.["isEnumeration"]) || Boolean(childCst?.text?.includes("enumeration("));
          if (isChildEnum) {
            const lits = extractEnumLiteralsFromCst(childCst, child.metadata);
            if (lits && lits.length > 0) {
              const qName = getSymbolQualifiedName(this.db, child.id);
              const displayName = formatEnumDisplayName(qName, child.name);
              registerEnumTypeAlias(child.name, qName, lits, displayName);
            }
          } else {
            // Check if child is a derived enum type via `extends E;` (e.g., `type E2 extends E; end E2;`)
            const childExtends = this.db.childrenOf(child.id).find((c) => c.kind === "Extends");
            const extTarget =
              (childExtends?.metadata?.["targetClass"] as string | undefined) ??
              (childExtends?.metadata?.["baseClass"] as string | undefined) ??
              childExtends?.name;
            if (extTarget) {
              const extScope = child.parentId ?? child.id;
              let curSym: SymbolEntry | undefined =
                this.db.query<ResolveNameFn>("resolveName", extScope)?.(extTarget) ??
                this.db.query<ResolveNameFn>("resolveSimpleName", extScope)?.(extTarget);
              for (let hop = 0; hop < 8 && curSym?.id; hop++) {
                const curCst = this.db.cstNode(curSym.id) as unknown as CstNodeLike | null;
                const curIsEnum =
                  Boolean(curSym.metadata?.["isEnumeration"]) || Boolean(curCst?.text?.includes("enumeration("));
                if (curIsEnum) {
                  const baseLits = extractEnumLiteralsFromCst(curCst, curSym.metadata);
                  if (baseLits && baseLits.length > 0) {
                    const baseQName = getSymbolQualifiedName(this.db, curSym.id);
                    const canonDisplay = formatEnumDisplayName(baseQName, curSym.name);
                    const aliasQName = getSymbolQualifiedName(this.db, child.id);
                    registerEnumTypeAlias(child.name, aliasQName, baseLits, canonDisplay);
                  }
                  break;
                }
                const nextExt = this.db.childrenOf(curSym.id).find((c) => c.kind === "Extends");
                const nextTgt =
                  (nextExt?.metadata?.["targetClass"] as string | undefined) ??
                  (nextExt?.metadata?.["baseClass"] as string | undefined) ??
                  nextExt?.name;
                if (!nextTgt) break;
                const nextScope: SymbolId = curSym.parentId ?? curSym.id;
                curSym =
                  this.db.query<ResolveNameFn>("resolveName", nextScope)?.(nextTgt) ??
                  this.db.query<ResolveNameFn>("resolveSimpleName", nextScope)?.(nextTgt);
              }
            }
          }
          const aliasTarget =
            (child.metadata?.["aliasTarget"] as string | undefined) ??
            (child.metadata?.["baseClass"] as string | undefined);
          if (aliasTarget) {
            const resolved =
              this.db.query<(n: string) => any>("resolveName", classId)?.(aliasTarget) ??
              this.db.query<(n: string) => any>("resolveSimpleName", classId)?.(aliasTarget);
            if (resolved) {
              const targetCst = this.db.cstNode(resolved.id) as any;
              queueResolution(scopePtr, child.name, targetCst, resolved, true);
              queue.push(resolved.id);
            }
          }
        }
      }
    }

    const complexSymCandidates = this.db.byName("Complex") ?? [];
    for (const cSym of complexSymCandidates) {
      if (cSym.kind === "Class" && (!cSym.parentId || getSymbolQualifiedName(this.db, cSym.id) === "Complex")) {
        const cCst = this.db.cstNode(cSym.id) as unknown as CstNodeLike | null;
        if (cCst?.ptr) {
          queueResolution(0, "Complex", cCst, cSym, true);
        }
        break;
      }
    }

    // Materialize contiguous multi-file source buffer in WASM linear memory when available.
    let useMultiFileOffsets = false;
    if (allocSourceBuf && wasmMemory && rootFileEntry && nextBaseUnitOffset > 0) {
      const totalBytes = isUtf16 ? nextBaseUnitOffset * 2 : nextBaseUnitOffset;
      const bufPtr = allocSourceBuf(wasmFlattener, totalBytes, isUtf16 ? 1 : 0);
      if (bufPtr !== 0) {
        // Re-read wasmMemory.buffer AFTER allocSourceBuf in case memory.grow() ran.
        if (isUtf16) {
          const u16 = new Uint16Array(wasmMemory.buffer, bufPtr, nextBaseUnitOffset);
          for (const entry of fileEntries.values()) {
            const base = entry.baseUnitOffset;
            const txt = entry.text;
            for (let i = 0; i < txt.length; i++) {
              u16[base + i] = txt.charCodeAt(i);
            }
          }
        } else {
          const u8 = new Uint8Array(wasmMemory.buffer, bufPtr, totalBytes);
          for (const entry of fileEntries.values()) {
            if (entry.utf8Bytes) {
              u8.set(entry.utf8Bytes, entry.baseUnitOffset);
            }
          }
        }
        useMultiFileOffsets = true;
      }
    }

    (this.state as any).wasmSourceFiles = Array.from(fileEntries.values()).map((e) => ({
      key: e.key,
      text: e.text,
      utf8Bytes: e.utf8Bytes,
      baseUnitOffset: e.baseUnitOffset,
      unitLen: e.unitLen,
      isUtf16,
    }));

    for (const res of pendingResolutions) {
      const baseOff = useMultiFileOffsets && res.fileEntry ? res.fileEntry.baseUnitOffset : 0;
      const targetOffset = baseOff + res.localOffset;
      register(wasmFlattener, res.scopePtr, res.nameId, res.targetPtr, targetOffset);
      if (res.alsoGlobal) {
        register(wasmFlattener, 0, res.nameId, res.targetPtr, targetOffset);
      }
    }
    if (typeof registerCanon === "function") {
      for (const cn of pendingCanonNames) {
        registerCanon(wasmFlattener, cn.targetPtr, cn.canonId);
      }
    }
    if (typeof registerComplexType === "function") {
      for (const cid of registeredComplexIds) {
        registerComplexType(wasmFlattener, cid);
      }
    }
  }

  patch(
    rootClassId: SymbolId,
    dae: DAEBuilder,
    dirtyRanges: { startOffset: number; endOffset: number }[],
    delta?: number,
  ): boolean {
    this.currentRootClassId = rootClassId;
    return patchIncremental(this, rootClassId, dae, dirtyRanges, delta);
  }

  public findEquationNodeAt(root: any, start: number, end: number): any {
    return findEquationNodeAt(root, start, end);
  }

  public findComponentDeclarationAt(root: any, start: number, end: number): any {
    return findComponentDeclarationAt(root, start, end);
  }

  public isCstNodeProtected(node: any): boolean {
    return isCstNodeProtected(node, this.nodeProtectionCache as any);
  }

  public generateRecordConstructorFor(
    sym: any,
    dae: DAEBuilder,
    rootClassId?: SymbolId,
    overrideFnName?: string,
    overrideResType?: string,
  ): DAEBuilder | null {
    return generateRecordConstructorFor(this, sym, dae, rootClassId, overrideFnName, overrideResType);
  }

  private generateRecordConstructors(rootClassId: SymbolId, dae: DAEBuilder): void {
    generateRecordConstructors(this, rootClassId, dae);
  }

  public isFunctionSym(sym: any): boolean {
    return isFunctionSym(this.db, sym);
  }

  public isInsideExpandableBus(prefix: string): boolean {
    return isInsideExpandableBus(this.expandableBuses, prefix);
  }

  private processExpandableConnectors(rootClassId: SymbolId, dae: DAEBuilder): void {
    processExpandableConnectors(rootClassId, dae, this.db, this.expandableBuses);
  }

  public flattenFunction(
    fnSymId: SymbolId,
    fnName: string,
    modifiers?: any[],
    parentDae?: DAEBuilder,
    enclosingScopeId?: SymbolId,
  ): DAEBuilder {
    return flattenFunction(this, fnSymId, fnName, modifiers, parentDae, enclosingScopeId);
  }

  private generateOperatorFunctions(dae: DAEBuilder): void {
    generateOperatorFunctions(this, dae);
  }

  private generateFunctions(rootClassId: SymbolId, dae: DAEBuilder): void {
    generateFunctions(this, rootClassId, dae);
  }

  private generateExternalObjectFunctions(dae: DAEBuilder): void {
    generateExternalObjectFunctions(this, dae);
  }

  private propagateImpureFunctions(dae: DAEBuilder): void {
    propagateImpureFunctions(dae);
  }

  flattenFromTopology(graph: TopologyGraph): DAEBuilder {
    const dae = new DAEBuilder(undefined, "HybridSystem", "");

    for (const rootId of graph.rootIds) {
      const node = graph.nodes.get(rootId);
      if (node?.targetClassId) {
        const elements = this.db.query<SymbolId[]>("instantiate", node.targetClassId);
        if (elements) {
          this.instantiateElements(elements, node.path, dae);
        }
      }
    }

    for (const edge of graph.edges) {
      const srcNode = graph.nodes.get(edge.sourceId);
      const tgtNode = graph.nodes.get(edge.targetId);
      if (srcNode && tgtNode) {
        const lhsId = dae.addExpression(ExprKind.Name, dae.interner.intern(srcNode.path));
        const rhsId = dae.addExpression(ExprKind.Name, dae.interner.intern(tgtNode.path));
        dae.addEquation(EqKind.Connect, lhsId, rhsId);
      }
    }

    const topoState = getFlatteningState(dae, this);
    topoState.db = this.db;
    topoState.flattener = this;
    ModelicaPortBalancer.expandConnections(dae, {
      omcCompatibility: this.options.omcCompatibility,
      useWasmKernel: this.options.useWasmKernel,
    });

    if (this.options.eliminateAliases) {
      eliminateArenaAliases(dae);
    }

    this.checkBalance(dae);

    return dae;
  }

  /**
   * Checks model equation/variable balance and pushes an M4004 diagnostic if unbalanced.
   * Should be called after all equation lowering is complete.
   */
  checkBalance(dae: DAEBuilder, rootClassId?: SymbolId): void {
    extractAndRegisterFmuMetadata(this, dae, rootClassId ?? this.currentRootClassId);
    checkBalance(dae, this.db, rootClassId ?? this.currentRootClassId);
  }

  public isFmuClass(classId: SymbolId): boolean {
    const cst = this.db.cstNode(classId) as any;
    if (!cst) return false;
    const ann = findDirectAnnotationClause(cst);
    if (!ann) return false;
    const text = typeof ann.text === "string" ? ann.text : "";
    return text.includes("__ModelScript_fmuPath") || text.includes("__modelscript_fmupath");
  }

  private isClassType(classId: SymbolId, visited = new Set<SymbolId>()): boolean {
    return isClassType(this, classId, visited);
  }

  private checkTypeAliasSpecialization(
    typeSymId: SymbolId,
  ): { targetName: string; kindDesc: string; range: any } | null {
    return checkTypeAliasSpecialization(this, typeSymId);
  }

  public collectInheritedTypeModifiers(scopeId: SymbolId, typeLeafName: string, visited = new Set<SymbolId>()): any[] {
    return collectInheritedTypeModifiers(this, scopeId, typeLeafName, visited);
  }

  public getOrCreateWasmEnv(dae: DAEBuilder, mods?: any): ModelicaModificationEnv | null {
    return getOrCreateWasmEnv(this, dae, mods);
  }

  public classFindMember(classId: SymbolId, name: string, visited: Set<SymbolId> = new Set()): SymbolEntry | null {
    return classFindMember(this, classId, name, visited);
  }

  public validateClassModifiers(defaultTargetClassId: SymbolId, args: any[], dae: DAEBuilder): boolean {
    return validateClassModifiers(this, defaultTargetClassId, args, dae);
  }

  private instantiateElements(elements: SymbolId[], prefix: string, dae: DAEBuilder, parentMods?: any): void {
    instantiateElements(this, elements, prefix, dae, parentMods);
  }

  public validateFunctionComponentDeclaration(
    dae: DAEBuilder,
    compInst: any,
    causality: Causality,
    isElemProtected: boolean,
    elemCst: any,
  ): void {
    validateFunctionComponentDeclaration(this, dae, compInst, causality, isElemProtected, elemCst);
  }

  public validateComponentBasicAttributes(
    dae: DAEBuilder,
    compInst: any,
    elemId: SymbolId,
    elemCst: any,
    prefix: string,
    parentMods?: any,
    matchingParentArg?: any,
  ): boolean {
    return validateComponentBasicAttributes(
      this,
      dae,
      compInst,
      elemId,
      elemCst,
      prefix,
      parentMods,
      matchingParentArg,
    );
  }

  public evaluateCSTToNumber(
    node: SyntaxNode | string | null | undefined,
    scopeId: SymbolId,
    subs?: Map<string, number>,
    dae?: DAEBuilder,
  ): number | null {
    return evaluateCSTToNumber(this, node, scopeId, subs, dae);
  }

  private collectProtectedNames(classId: SymbolId, visited: Set<SymbolId> = new Set<SymbolId>()): Set<string> {
    return collectProtectedNames(this, classId, visited);
  }

  private collectExtendsMods(classId: SymbolId, visited: Set<SymbolId> = new Set<SymbolId>()): any[] {
    return collectExtendsMods(this, classId, visited);
  }

  public resolveRedeclarationType(scopeId: SymbolId | null, redeclSpecifier: string): SymbolId | null {
    return resolveRedeclarationType(this, scopeId, redeclSpecifier);
  }

  public resolveInnerOuterClass(classId: SymbolId): SymbolId {
    return resolveInnerOuterClass(this, classId);
  }

  private extractClassEquations(
    classId: SymbolId,
    prefix: string,
    dae: DAEBuilder,
    breakContext?: {
      brokenComponents: Set<string>;
      brokenConnections: Set<string>;
    },
    parentMods?: any,
    visitedClasses?: Set<SymbolId>,
  ): void {
    extractClassEquations(this, classId, prefix, dae, breakContext, parentMods, visitedClasses);
  }

  private expandConnectorRef(refStr: string, dae: DAEBuilder): string[] {
    return expandConnectorRef(refStr, dae);
  }
}

export { ModelicaFlattener as ArenaQueryFlattener };

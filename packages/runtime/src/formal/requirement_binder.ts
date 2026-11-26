// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Formal SysML v2 Requirement & Cross-Domain Binding Engine
 *
 * Bridges formal SysML v2 `requirement def` constraints with Modelica DAE
 * state variables and the `SemanticTheoryCoordinator` via native WebAssembly
 * GLR Concrete Syntax Tree (CST) traversal (`@modelscript/dsl`).
 */

import { createWasmParserSync, type TreeSitterParser } from "@modelscript/dsl/bindings";
import type { BoundRequirement } from "../analysis/wasm_zonotope_reach.js";
import type { SymbolEntry, SymbolIndex } from "../runtime.js";
import {
  isMemberLikeSymbol,
  isRelationshipOrImportSymbol,
  isTypeLikeSymbol,
  splitQualifiedPath,
} from "../util/symbol_roles.js";
import { globalLibraryRegistry } from "../workspace/library-manifest.js";
import { NumericalInterval } from "./abstract_interpretation/interval_domain.js";
import { SemanticTheoryCoordinator } from "./theory_coordinator.js";

export interface RequirementCstNodeLike {
  readonly id: number;
  readonly type: string;
  readonly text: string;
  readonly startIndex: number;
  readonly endIndex: number;
  readonly parent: RequirementCstNodeLike | null;
  readonly children: readonly RequirementCstNodeLike[];
  readonly namedChildren: readonly RequirementCstNodeLike[];
  readonly childCount: number;
  readonly namedChildCount: number;
  readonly firstChild: RequirementCstNodeLike | null;
  readonly firstNamedChild: RequirementCstNodeLike | null;
  child(index: number): RequirementCstNodeLike | null;
  namedChild(index: number): RequirementCstNodeLike | null;
  childForFieldName(fieldName: string): RequirementCstNodeLike | null;
  childrenForFieldName(fieldName: string): RequirementCstNodeLike[];
  descendantsOfType(types: string | string[]): RequirementCstNodeLike[];
}

type SyntaxNode = RequirementCstNodeLike;

export type { BoundRequirement };

export type ConstraintExprAst =
  | { kind: "lit"; value: number }
  | { kind: "str"; value: string }
  | { kind: "var"; path: string }
  | { kind: "unary"; op: "+" | "-"; operand: ConstraintExprAst }
  | { kind: "bin"; op: "+" | "-" | "*" | "/" | "^"; left: ConstraintExprAst; right: ConstraintExprAst }
  | { kind: "call"; name: string; args: ConstraintExprAst[] };

export interface ConstraintComparisonAst {
  lhs: ConstraintExprAst;
  op: "<=" | ">=" | "<" | ">" | "==" | "!=";
  rhs: ConstraintExprAst;
  rawText?: string | undefined;
}

export interface StandardClauseRef {
  standard?: string | undefined;
  edition?: string | undefined;
  clauseId?: string | undefined;
  severity?: "error" | "warning" | "info" | undefined;
}

export interface InlineCalcDef {
  name: string;
  params: string[];
  bodyAst?: ConstraintExprAst | undefined;
  externalCalculator?: string | undefined;
}

export interface IntervalRequirementIssue {
  requirementId: string;
  clauseLabel?: string | undefined;
  severity: "definite" | "possible";
  varName: string;
  operator: "<=" | ">=" | "<" | ">" | "==" | "!=";
  lhsInterval: NumericalInterval;
  rhsInterval: NumericalInterval;
  requiredLimit?: number | undefined;
  suggestedValue?: number | undefined;
  margin?: number | undefined;
  message: string;
}

export interface SysmlRequirement {
  /** Requirement definition identifier (e.g., "FlightCeilingRequirement") */
  id: string;
  /** Short requirement identifier if declared via `<'REQ-ID'>` */
  shortId?: string | undefined;
  /** Enclosing SysML v2 package name if present */
  packageName?: string | undefined;
  /** Subject type or component name if declared via `subject x : Type;` */
  subjectName?: string | undefined;
  /** Subject instance variable name if declared via `subject x : Type;` */
  subjectVarName?: string | undefined;
  /** Constrained attribute identifier (e.g., "v_climb") */
  targetAttribute: string;
  /** Comparison operator */
  operator: "<=" | ">=" | "<" | ">";
  /** Evaluated numeric threshold (`NaN` for multi-variable symbolic constraints) */
  limitValue: number;
  /** Evaluated numeric attributes in scope for this requirement */
  attributes?: Record<string, number> | undefined;
  /** Evaluated string attributes in scope for table lookups */
  stringAttributes?: Record<string, string> | undefined;
  /** Standard clause metadata if annotated via `@StandardClause` / `@ComplianceRule` */
  standardClause?: StandardClauseRef | undefined;
  /** Full symbolic comparison AST for multi-variable / nonlinear interval proofs */
  constraintAst?: ConstraintComparisonAst | undefined;
  /** Optional `assume constraint` applicability guard ASTs */
  assumeAsts?: ConstraintComparisonAst[] | undefined;
  /** Local/imported inline calculation definitions referenced inside `constraintAst` */
  calculators?: Record<string, InlineCalcDef> | undefined;
  /** Normalized source text of the constraint clause */
  expressionText?: string | undefined;
}

let cachedSysmlParser: TreeSitterParser | null = null;
let cachedModelicaParser: TreeSitterParser | null = null;

/**
 * Registers pre-initialized WebAssembly GLR parser instances (e.g., from browser
 * async initialization) for synchronous CST requirement and annotation extraction.
 */
export function registerRequirementBinderParsers(parsers: {
  sysmlParser?: TreeSitterParser | null | undefined;
  modelicaParser?: TreeSitterParser | null | undefined;
}): void {
  if (parsers.sysmlParser) cachedSysmlParser = parsers.sysmlParser;
  if (parsers.modelicaParser) cachedModelicaParser = parsers.modelicaParser;
}

function loadWasmLanguageParserNodeSync(langDirName: "sysml2" | "modelica"): TreeSitterParser | null {
  try {
    const candidateRels = [
      `../../../../languages/${langDirName}/dist/parser.wasm`,
      `../../../../languages/${langDirName}/.cache/parser.wasm`,
      `../../../../languages/${langDirName}/parser.wasm`,
    ];
    let wasmPath = decodeURIComponent(new URL(candidateRels[0]!, import.meta.url).pathname);
    const bindingsUrl = new URL(`../../../../languages/${langDirName}/src-gen/bindings.js`, import.meta.url);
    const bindingsPath = decodeURIComponent(bindingsUrl.pathname);

    interface NodeBuiltinProcess {
      getBuiltinModule?: (id: string) => unknown;
    }
    const getBuiltin = (process as unknown as NodeBuiltinProcess).getBuiltinModule;
    if (typeof process !== "undefined" && typeof getBuiltin === "function") {
      try {
        const modMod = getBuiltin("node:module") as
          { createRequire?: (url: string) => { resolve: (id: string) => string } } | undefined;
        if (modMod && typeof modMod.createRequire === "function") {
          try {
            wasmPath = modMod.createRequire(import.meta.url).resolve(`@modelscript/${langDirName}/parser.wasm`);
          } catch {
            // Fall through to monorepo-relative path probing
          }
        }
        const fsMod = getBuiltin("node:fs") as
          { existsSync?: (p: string) => boolean; readFileSync?: (p: string, enc: string) => string } | undefined;
        if (fsMod && typeof fsMod.existsSync === "function" && !fsMod.existsSync(wasmPath)) {
          for (const rel of candidateRels) {
            const p = decodeURIComponent(new URL(rel, import.meta.url).pathname);
            if (fsMod.existsSync(p)) {
              wasmPath = p;
              break;
            }
          }
        }

        const modBuiltin = getBuiltin("node:module") as { createRequire?: (url: string) => NodeRequire } | undefined;
        if (modBuiltin && typeof modBuiltin.createRequire === "function") {
          const req = modBuiltin.createRequire(import.meta.url);
          const bindingsMod = req(bindingsPath) as {
            createWasmParserSync?: (path: string) => { parser: TreeSitterParser };
          };
          if (bindingsMod && typeof bindingsMod.createWasmParserSync === "function") {
            return bindingsMod.createWasmParserSync(wasmPath).parser;
          }
        }
      } catch {
        // Fallback to reading SYNTAX_NAMES and FIELD_NAMES from bindings.js below
      }

      const fsMod = getBuiltin("node:fs") as { readFileSync?: (p: string, enc: string) => string } | undefined;
      if (fsMod && typeof fsMod.readFileSync === "function") {
        const bindingsSrc = String(fsMod.readFileSync(bindingsPath, "utf8"));
        let syntaxNames: string[] | undefined;
        let fieldNames: Record<string, number> | undefined;

        const synAnchor = bindingsSrc.indexOf("export const SYNTAX_NAMES =");
        if (synAnchor !== -1) {
          const arrStart = bindingsSrc.indexOf("[", synAnchor);
          const arrEnd = bindingsSrc.indexOf('] !== "undefined"', arrStart);
          if (arrStart !== -1 && arrEnd !== -1) {
            syntaxNames = JSON.parse(bindingsSrc.slice(arrStart, arrEnd + 1)) as string[];
          }
        }

        const fieldAnchor = bindingsSrc.indexOf("export const FIELD_NAMES =");
        if (fieldAnchor !== -1) {
          const objStart = bindingsSrc.indexOf("{", fieldAnchor);
          const objEnd = bindingsSrc.indexOf('} !== "undefined"', objStart);
          if (objStart !== -1 && objEnd !== -1) {
            fieldNames = JSON.parse(bindingsSrc.slice(objStart, objEnd + 1)) as Record<string, number>;
          }
        }

        return createWasmParserSync(wasmPath, { syntaxNames, fieldNames }).parser;
      }
    }
  } catch {
    return null;
  }
  return null;
}

export function getSysmlWasmParser(): TreeSitterParser | null {
  if (!cachedSysmlParser) {
    cachedSysmlParser = loadWasmLanguageParserNodeSync("sysml2");
  }
  return cachedSysmlParser;
}

export function getModelicaWasmParser(): TreeSitterParser | null {
  if (!cachedModelicaParser) {
    cachedModelicaParser = loadWasmLanguageParserNodeSync("modelica");
  }
  return cachedModelicaParser;
}

function unquoteSysmlName(raw: string): string {
  const trimmed = raw.trim();
  if ((trimmed.startsWith("'") && trimmed.endsWith("'")) || (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function extractSysmlIdentification(node: SyntaxNode): {
  declaredName: string;
  declaredShortName?: string | undefined;
} {
  const shortNode = node.childForFieldName("declaredShortName");
  const nameNode = node.childForFieldName("declaredName");
  const shortText = shortNode ? unquoteSysmlName(shortNode.text) : undefined;
  const nameText = nameNode ? unquoteSysmlName(nameNode.text) : undefined;

  if (nameText) {
    return { declaredName: nameText, declaredShortName: shortText };
  }

  // Inspect direct Name children before body if field names were merged in grammar rules
  let sawShortBracket = false;
  let fallbackShort: string | undefined = shortText;
  let fallbackName = "";
  for (let i = 0; i < node.childCount; i++) {
    const ch = node.child(i);
    if (!ch) continue;
    const t = ch.type;
    if (t === "{" || t === ";" || t === "PackageBody" || t === "_RequirementBody" || t === "_DefinitionBody") {
      break;
    }
    if (t === "<" || ch.text === "<") {
      sawShortBracket = true;
      continue;
    }
    if (t === ">" || ch.text === ">") {
      sawShortBracket = false;
      continue;
    }
    if (t === "Name") {
      if (sawShortBracket && !fallbackShort) {
        fallbackShort = unquoteSysmlName(ch.text);
      } else if (!sawShortBracket && !fallbackName) {
        fallbackName = unquoteSysmlName(ch.text);
      }
    }
  }

  return {
    declaredName: fallbackName || fallbackShort || "",
    declaredShortName: fallbackShort,
  };
}

/**
 * Evaluates a numeric SysML v2 CST expression node (`LiteralReal`, `LiteralInteger`,
 * `UnaryExpression`, `AdditiveExpression`, `MultiplicativeExpression`,
 * `MeasurementExpression`, or `FeatureReferenceExpression` bound in `attrMap`).
 */
export function evaluateSysmlCstNumericExpr(
  node: SyntaxNode | null | undefined,
  attrMap: ReadonlyMap<string, number>,
): number {
  if (!node) return NaN;
  const type = node.type;

  if (
    type === "LiteralReal" ||
    type === "LiteralInteger" ||
    type === "RealValue" ||
    type === "DECIMAL_VALUE" ||
    type === "EXP_VALUE"
  ) {
    const val = Number(node.text.trim());
    return Number.isFinite(val) ? val : NaN;
  }

  if (type === "MeasurementExpression") {
    // e.g., `12.0 [mm]` — evaluate the quantity expression child before `[`
    const firstNamed = node.firstNamedChild;
    return evaluateSysmlCstNumericExpr(firstNamed, attrMap);
  }

  if (type === "UnaryExpression") {
    const opNode = node.childForFieldName("operator") ?? node.firstChild;
    const operandNode = node.childForFieldName("operand") ?? node.namedChild(node.namedChildCount - 1);
    const val = evaluateSysmlCstNumericExpr(operandNode, attrMap);
    const op = opNode?.text.trim();
    if (op === "-") return -val;
    return val;
  }

  if (type === "AdditiveExpression" || type === "MultiplicativeExpression" || type === "ExponentiationExpression") {
    const operands = node.childrenForFieldName("operand");
    const operators = node.childrenForFieldName("operator");
    if (operands.length >= 2 && operators.length >= 1) {
      let acc = evaluateSysmlCstNumericExpr(operands[0], attrMap);
      for (let i = 0; i < operators.length && i + 1 < operands.length; i++) {
        const rhs = evaluateSysmlCstNumericExpr(operands[i + 1], attrMap);
        const op = operators[i]!.text.trim();
        if (op === "+") acc += rhs;
        else if (op === "-") acc -= rhs;
        else if (op === "*") acc *= rhs;
        else if (op === "/") acc = rhs !== 0 ? acc / rhs : NaN;
        else if (op === "^" || op === "**") acc = Math.pow(acc, rhs);
      }
      return acc;
    }
  }

  if (
    type === "FeatureReferenceExpression" ||
    type === "Name" ||
    type === "QualifiedName" ||
    type === "OwnedFeatureChain"
  ) {
    const raw = unquoteSysmlName(node.text);
    const direct = attrMap.get(raw);
    if (direct !== undefined) return direct;
    const dotTail = raw.split(".").pop()?.trim();
    if (dotTail && attrMap.has(dotTail)) return attrMap.get(dotTail)!;
    const colonTail = raw.split("::").pop()?.trim();
    if (colonTail && attrMap.has(colonTail)) return attrMap.get(colonTail)!;
  }

  if (node.namedChildCount === 1) {
    const childVal = evaluateSysmlCstNumericExpr(node.firstNamedChild, attrMap);
    if (!Number.isNaN(childVal)) return childVal;
  }

  for (let i = 0; i < node.namedChildCount; i++) {
    const ch = node.namedChild(i);
    if (!ch) continue;
    if (
      ch.type === "FeatureValue" ||
      ch.type === "OwnedExpression" ||
      ch.type === "LiteralReal" ||
      ch.type === "LiteralInteger" ||
      ch.type === "UnaryExpression" ||
      ch.type === "AdditiveExpression" ||
      ch.type === "MultiplicativeExpression" ||
      ch.type === "MeasurementExpression" ||
      ch.type === "FeatureReferenceExpression"
    ) {
      const v = evaluateSysmlCstNumericExpr(ch, attrMap);
      if (!Number.isNaN(v)) return v;
    }
  }

  const fallback = Number(node.text.trim());
  return Number.isFinite(fallback) ? fallback : NaN;
}

function collectAttributeUsagesFromCst(scopeNode: SyntaxNode, attrMap: Map<string, number>, prefix?: string): void {
  const attrNodes = scopeNode.descendantsOfType(["AttributeUsage"]);
  for (const attrNode of attrNodes) {
    const { declaredName } = extractSysmlIdentification(attrNode);
    if (!declaredName) continue;
    const fvNodes = attrNode.descendantsOfType(["FeatureValue"]);
    if (fvNodes.length === 0) continue;
    const val = evaluateSysmlCstNumericExpr(fvNodes[0], attrMap);
    if (!Number.isNaN(val)) {
      attrMap.set(declaredName, val);
      if (prefix) {
        attrMap.set(`${prefix}.${declaredName}`, val);
      }
    }
  }
}

type ExprToken =
  | { kind: "num"; value: number }
  | { kind: "str"; value: string }
  | { kind: "ident"; value: string }
  | { kind: "op"; value: string }
  | { kind: "paren"; value: "(" | ")" }
  | { kind: "comma" };

function stripSysmlComments(text: string): string {
  let out = "";
  let inSingle = false;
  let inDouble = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    const next = text[i + 1];
    if (!inSingle && !inDouble) {
      if (ch === "/" && next === "/") {
        while (i < text.length && text[i] !== "\n") i++;
        continue;
      }
      if (ch === "/" && next === "*") {
        i += 2;
        while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
        i += 2;
        out += " ";
        continue;
      }
    }
    if (ch === "'" && !inDouble && text[i - 1] !== "\\") inSingle = !inSingle;
    else if (ch === '"' && !inSingle && text[i - 1] !== "\\") inDouble = !inDouble;
    out += ch;
    i++;
  }
  return out;
}

function tokenizeConstraintExpr(rawText: string): ExprToken[] | null {
  const text = stripSysmlComments(rawText);
  const tokens: ExprToken[] = [];
  let i = 0;

  while (i < text.length) {
    const ch = text[i]!;
    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    // SysML measurement unit annotation `[mm]`, `[MPa]`, `[kg/m^3]` after a value or `)`
    if (ch === "[" && tokens.length > 0) {
      const prev = tokens[tokens.length - 1]!;
      if (prev.kind === "num" || prev.kind === "ident" || (prev.kind === "paren" && prev.value === ")")) {
        const closeIdx = text.indexOf("]", i + 1);
        if (closeIdx > i + 1) {
          const inner = text.slice(i + 1, closeIdx).trim();
          if (/^[a-zA-Z%°µ]/.test(inner)) {
            i = closeIdx + 1;
            continue;
          }
        }
      }
    }

    if (ch === '"' || ch === "'") {
      const quote = ch;
      let j = i + 1;
      let val = "";
      while (j < text.length && text[j] !== quote) {
        if (text[j] === "\\" && j + 1 < text.length) {
          val += text[j + 1]!;
          j += 2;
        } else {
          val += text[j]!;
          j++;
        }
      }
      if (j >= text.length) return null;
      tokens.push({ kind: "str", value: val });
      i = j + 1;
      continue;
    }

    if (/[0-9]/.test(ch) || (ch === "." && i + 1 < text.length && /[0-9]/.test(text[i + 1]!))) {
      const numMatch = text.slice(i).match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/);
      if (!numMatch) return null;
      const num = Number(numMatch[0]);
      if (!Number.isFinite(num)) return null;
      tokens.push({ kind: "num", value: num });
      i += numMatch[0].length;
      continue;
    }

    if (/[a-zA-Z_]/.test(ch)) {
      const identMatch = text.slice(i).match(/^[a-zA-Z_][a-zA-Z0-9_]*(?:(?:\.|::)[a-zA-Z_][a-zA-Z0-9_]*)*/);
      if (!identMatch) return null;
      tokens.push({ kind: "ident", value: identMatch[0] });
      i += identMatch[0].length;
      continue;
    }

    if (ch === "*" && text[i + 1] === "*") {
      tokens.push({ kind: "op", value: "^" });
      i += 2;
      continue;
    }
    if (ch === "+" || ch === "-" || ch === "*" || ch === "/" || ch === "^") {
      tokens.push({ kind: "op", value: ch });
      i++;
      continue;
    }
    if (ch === "(" || ch === ")") {
      tokens.push({ kind: "paren", value: ch });
      i++;
      continue;
    }
    if (ch === ",") {
      tokens.push({ kind: "comma" });
      i++;
      continue;
    }

    return null;
  }

  return tokens;
}

export function parseConstraintExprAst(exprText: string): ConstraintExprAst | undefined {
  const tokens = tokenizeConstraintExpr(exprText);
  if (!tokens || tokens.length === 0) return undefined;

  let pos = 0;

  const parseAddSub = (): ConstraintExprAst | undefined => {
    let left = parseMulDiv();
    if (!left) return undefined;
    while (pos < tokens.length) {
      const tok = tokens[pos]!;
      if (tok.kind === "op" && (tok.value === "+" || tok.value === "-")) {
        pos++;
        const right = parseMulDiv();
        if (!right) return undefined;
        left = { kind: "bin", op: tok.value, left, right };
      } else {
        break;
      }
    }
    return left;
  };

  const parseMulDiv = (): ConstraintExprAst | undefined => {
    let left = parsePower();
    if (!left) return undefined;
    while (pos < tokens.length) {
      const tok = tokens[pos]!;
      if (tok.kind === "op" && (tok.value === "*" || tok.value === "/")) {
        pos++;
        const right = parsePower();
        if (!right) return undefined;
        left = { kind: "bin", op: tok.value, left, right };
      } else {
        break;
      }
    }
    return left;
  };

  const parsePower = (): ConstraintExprAst | undefined => {
    const base = parseUnary();
    if (!base) return undefined;
    if (pos < tokens.length) {
      const tok = tokens[pos]!;
      if (tok.kind === "op" && tok.value === "^") {
        pos++;
        const exp = parsePower();
        if (!exp) return undefined;
        return { kind: "bin", op: "^", left: base, right: exp };
      }
    }
    return base;
  };

  const parseUnary = (): ConstraintExprAst | undefined => {
    const tok = tokens[pos];
    if (tok && tok.kind === "op" && (tok.value === "+" || tok.value === "-")) {
      pos++;
      const operand = parseUnary();
      if (!operand) return undefined;
      return tok.value === "+" ? operand : { kind: "unary", op: "-", operand };
    }
    return parsePrimary();
  };

  const parsePrimary = (): ConstraintExprAst | undefined => {
    const tok = tokens[pos];
    if (!tok) return undefined;

    if (tok.kind === "num") {
      pos++;
      return { kind: "lit", value: tok.value };
    }
    if (tok.kind === "str") {
      pos++;
      return { kind: "str", value: tok.value };
    }
    if (tok.kind === "ident") {
      pos++;
      const next = tokens[pos];
      if (next && next.kind === "paren" && next.value === "(") {
        pos++;
        const args: ConstraintExprAst[] = [];
        if (!(tokens[pos]?.kind === "paren" && (tokens[pos] as { value: string }).value === ")")) {
          while (pos < tokens.length) {
            const arg = parseAddSub();
            if (!arg) return undefined;
            args.push(arg);
            if (tokens[pos]?.kind === "comma") {
              pos++;
              continue;
            }
            break;
          }
        }
        const closeTok = tokens[pos];
        if (!closeTok || closeTok.kind !== "paren" || closeTok.value !== ")") return undefined;
        pos++;
        return { kind: "call", name: tok.value, args };
      }
      return { kind: "var", path: tok.value };
    }
    if (tok.kind === "paren" && tok.value === "(") {
      pos++;
      const inner = parseAddSub();
      if (!inner) return undefined;
      const closeTok = tokens[pos];
      if (!closeTok || closeTok.kind !== "paren" || closeTok.value !== ")") return undefined;
      pos++;
      return inner;
    }

    return undefined;
  };

  const root = parseAddSub();
  if (!root || pos !== tokens.length) return undefined;
  return root;
}

export function splitConstraintClauses(rawText: string): string[] {
  const cleaned = stripSysmlComments(rawText);
  const clauses: string[] = [];
  let buf = "";
  let depth = 0;
  let inSingle = false;
  let inDouble = false;

  const flush = (): void => {
    const trimmed = buf.trim();
    if (trimmed) clauses.push(trimmed);
    buf = "";
  };

  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i]!;
    if (ch === "'" && !inDouble && cleaned[i - 1] !== "\\") {
      inSingle = !inSingle;
      buf += ch;
      continue;
    }
    if (ch === '"' && !inSingle && cleaned[i - 1] !== "\\") {
      inDouble = !inDouble;
      buf += ch;
      continue;
    }
    if (!inSingle && !inDouble) {
      if (ch === "(" || ch === "[" || ch === "{") depth++;
      else if ((ch === ")" || ch === "]" || ch === "}") && depth > 0) depth--;

      if (depth === 0) {
        if (ch === ";") {
          flush();
          continue;
        }
        if (ch === "&" && cleaned[i + 1] === "&") {
          flush();
          i++;
          continue;
        }
        if (
          (ch === "a" || ch === "A") &&
          cleaned.slice(i, i + 3).toLowerCase() === "and" &&
          (i === 0 || !/[a-zA-Z0-9_]/.test(cleaned[i - 1]!)) &&
          (i + 3 >= cleaned.length || !/[a-zA-Z0-9_]/.test(cleaned[i + 3]!))
        ) {
          flush();
          i += 2;
          continue;
        }
        if (ch === "\n") {
          const trimmedSoFar = buf.trim();
          const restTrimmed = cleaned.slice(i + 1).trimStart();
          const hasComparison = /(<=|>=|==|!=|<|>)/.test(trimmedSoFar);
          const endsWithOp = /[+\-*/^,(<>=!]$/.test(trimmedSoFar);
          const nextStartsWithOp = /^[+\-*/^),<>=!]/.test(restTrimmed);
          if (hasComparison && !endsWithOp && !nextStartsWithOp && trimmedSoFar.length > 0) {
            flush();
            continue;
          }
          buf += " ";
          continue;
        }
      }
    }
    buf += ch;
  }
  flush();
  return clauses;
}

export function parseConstraintComparisonAst(clauseText: string): ConstraintComparisonAst | undefined {
  const cleaned = stripSysmlComments(clauseText).trim();
  if (!cleaned) return undefined;

  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let foundOp: { op: "<=" | ">=" | "<" | ">" | "==" | "!="; start: number; len: number } | null = null;

  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i]!;
    if (ch === "'" && !inDouble && cleaned[i - 1] !== "\\") {
      inSingle = !inSingle;
      continue;
    }
    if (ch === '"' && !inSingle && cleaned[i - 1] !== "\\") {
      inDouble = !inDouble;
      continue;
    }
    if (inSingle || inDouble) continue;
    if (ch === "(" || ch === "[") depth++;
    else if ((ch === ")" || ch === "]") && depth > 0) depth--;

    if (depth === 0) {
      const two = cleaned.slice(i, i + 2);
      if (two === "<=" || two === ">=" || two === "==" || two === "!=") {
        if (foundOp) return undefined;
        foundOp = { op: two, start: i, len: 2 };
        i++;
        continue;
      }
      if (ch === "<" || ch === ">") {
        if (foundOp) return undefined;
        foundOp = { op: ch, start: i, len: 1 };
      }
    }
  }

  if (!foundOp) return undefined;
  const lhsText = cleaned.slice(0, foundOp.start).trim();
  const rhsText = cleaned.slice(foundOp.start + foundOp.len).trim();
  const lhs = parseConstraintExprAst(lhsText);
  const rhs = parseConstraintExprAst(rhsText);
  if (!lhs || !rhs) return undefined;
  return { lhs, op: foundOp.op, rhs, rawText: cleaned };
}

function collectExprVars(ast: ConstraintExprAst, out: string[] = []): string[] {
  if (ast.kind === "var") {
    out.push(ast.path);
  } else if (ast.kind === "unary") {
    collectExprVars(ast.operand, out);
  } else if (ast.kind === "bin") {
    collectExprVars(ast.left, out);
    collectExprVars(ast.right, out);
  } else if (ast.kind === "call") {
    for (const arg of ast.args) collectExprVars(arg, out);
  }
  return out;
}

function collectPrimaryAttributeName(lhs: ConstraintExprAst, rhs?: ConstraintExprAst): string {
  const lhsVars = collectExprVars(lhs);
  const targetPath = lhsVars[0] ?? (rhs ? collectExprVars(rhs)[0] : undefined) ?? "";
  if (!targetPath) return "";
  const dotLeaf = targetPath.split(".").pop() ?? targetPath;
  return dotLeaf.split("::").pop() ?? dotLeaf;
}

function evaluateScalarBuiltinCall(name: string, args: (number | string)[]): number {
  const fn = name.split("::").pop()!.split(".").pop()!.toLowerCase();
  const nums = args.map((a) => (typeof a === "number" ? a : Number(a)));
  if (fn === "abs" && nums.length >= 1) return Math.abs(nums[0]!);
  if (fn === "sqrt" && nums.length >= 1) return nums[0]! >= 0 ? Math.sqrt(nums[0]!) : NaN;
  if (fn === "min" && nums.length >= 1) return Math.min(...nums);
  if (fn === "max" && nums.length >= 1) return Math.max(...nums);
  if (fn === "sin" && nums.length >= 1) return Math.sin(nums[0]!);
  if (fn === "cos" && nums.length >= 1) return Math.cos(nums[0]!);
  if (fn === "tan" && nums.length >= 1) return Math.tan(nums[0]!);
  if (fn === "exp" && nums.length >= 1) return Math.exp(nums[0]!);
  if ((fn === "log" || fn === "ln") && nums.length >= 1) return nums[0]! > 0 ? Math.log(nums[0]!) : NaN;
  if (fn === "pow" && nums.length >= 2) return Math.pow(nums[0]!, nums[1]!);
  if (fn === "ceil" && nums.length >= 1) return Math.ceil(nums[0]!);
  if (fn === "floor" && nums.length >= 1) return Math.floor(nums[0]!);
  return NaN;
}

function resolveInlineCalc(name: string, calculators?: Record<string, InlineCalcDef>): InlineCalcDef | undefined {
  if (!calculators) return undefined;
  if (calculators[name]) return calculators[name];
  const shortName = name.split("::").pop()?.trim();
  if (shortName && calculators[shortName]) return calculators[shortName];
  for (const key of Object.keys(calculators)) {
    if (key.endsWith(`::${name}`) || (shortName && key.endsWith(`::${shortName}`))) {
      return calculators[key];
    }
  }
  return undefined;
}

function invokeExternalCalculatorValue(callName: string, args: (number | string)[], calcDef?: InlineCalcDef): number {
  const candidates: string[] = [];
  if (calcDef?.externalCalculator) candidates.push(calcDef.externalCalculator);
  candidates.push(callName);
  const short = callName.split("::").pop();
  if (short && short !== callName) candidates.push(short);

  for (const target of candidates) {
    const res = globalLibraryRegistry.invokeCalculator(target, args);
    if (typeof res === "number" && Number.isFinite(res)) return res;
    if (typeof res === "boolean") return res ? 1 : 0;
  }
  return NaN;
}

export function evaluateConstraintExprScalar(
  ast: ConstraintExprAst,
  attrMap: ReadonlyMap<string, number>,
  stringMap?: ReadonlyMap<string, string>,
  calculators?: Record<string, InlineCalcDef>,
  depth = 0,
): number {
  if (depth > 16) return NaN;
  if (ast.kind === "lit") return ast.value;
  if (ast.kind === "str") return NaN;
  if (ast.kind === "var") {
    const direct = attrMap.get(ast.path);
    if (direct !== undefined) return direct;
    const dotTail = ast.path.split(".").pop()?.trim();
    if (dotTail && attrMap.has(dotTail)) return attrMap.get(dotTail)!;
    const colonTail = ast.path.split("::").pop()?.trim();
    if (colonTail && attrMap.has(colonTail)) return attrMap.get(colonTail)!;
    return NaN;
  }
  if (ast.kind === "unary") {
    const v = evaluateConstraintExprScalar(ast.operand, attrMap, stringMap, calculators, depth + 1);
    return ast.op === "-" ? -v : v;
  }
  if (ast.kind === "bin") {
    const l = evaluateConstraintExprScalar(ast.left, attrMap, stringMap, calculators, depth + 1);
    const r = evaluateConstraintExprScalar(ast.right, attrMap, stringMap, calculators, depth + 1);
    if (Number.isNaN(l) || Number.isNaN(r)) return NaN;
    if (ast.op === "+") return l + r;
    if (ast.op === "-") return l - r;
    if (ast.op === "*") return l * r;
    if (ast.op === "/") return r !== 0 ? l / r : NaN;
    if (ast.op === "^") return Math.pow(l, r);
    return NaN;
  }
  if (ast.kind === "call") {
    const argVals: (number | string)[] = [];
    for (const arg of ast.args) {
      if (arg.kind === "str") {
        argVals.push(arg.value);
        continue;
      }
      if (arg.kind === "var" && stringMap) {
        const sVal =
          stringMap.get(arg.path) ??
          stringMap.get(arg.path.split(".").pop() ?? "") ??
          stringMap.get(arg.path.split("::").pop() ?? "");
        if (sVal !== undefined) {
          argVals.push(sVal);
          continue;
        }
      }
      const numVal = evaluateConstraintExprScalar(arg, attrMap, stringMap, calculators, depth + 1);
      if (Number.isNaN(numVal)) return NaN;
      argVals.push(numVal);
    }

    const calc = resolveInlineCalc(ast.name, calculators);
    if (calc?.bodyAst) {
      const localNum = new Map<string, number>(attrMap);
      const localStr = new Map<string, string>(stringMap ?? []);
      for (let i = 0; i < calc.params.length && i < argVals.length; i++) {
        const paramName = calc.params[i]!;
        const v = argVals[i]!;
        if (typeof v === "string") localStr.set(paramName, v);
        else localNum.set(paramName, v);
      }
      const inlineRes = evaluateConstraintExprScalar(calc.bodyAst, localNum, localStr, calculators, depth + 1);
      if (!Number.isNaN(inlineRes)) return inlineRes;
    }

    const extVal = invokeExternalCalculatorValue(ast.name, argVals, calc);
    if (!Number.isNaN(extVal)) return extVal;

    return evaluateScalarBuiltinCall(ast.name, argVals);
  }
  return NaN;
}

function evaluateSimpleSysmlArithmetic(
  expr: string,
  attrMap: Map<string, number>,
  stringMap?: Map<string, string>,
  calculators?: Record<string, InlineCalcDef>,
): number {
  const ast = parseConstraintExprAst(expr);
  if (!ast) return NaN;
  return evaluateConstraintExprScalar(ast, attrMap, stringMap, calculators);
}

function extractBalancedBraceBody(text: string, openBraceIdx: number): { body: string; endIndex: number } {
  let depth = 1;
  let inSingle = false;
  let inDouble = false;
  let endIndex = text.length;
  for (let i = openBraceIdx + 1; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === "'" && !inDouble && text[i - 1] !== "\\") inSingle = !inSingle;
    else if (ch === '"' && !inSingle && text[i - 1] !== "\\") inDouble = !inDouble;
    else if (!inSingle && !inDouble) {
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          endIndex = i;
          break;
        }
      }
    }
  }
  return { body: text.slice(openBraceIdx + 1, endIndex), endIndex };
}

function parseAnnotationProps(bodyText: string): Record<string, string> {
  const props: Record<string, string> = {};
  const propRe = /([a-zA-Z0-9_]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([a-zA-Z0-9_./:-]+))/g;
  let m: RegExpExecArray | null;
  while ((m = propRe.exec(bodyText)) !== null) {
    const key = m[1]!;
    const val = m[2] ?? m[3] ?? m[4] ?? "";
    if (key && val !== "") props[key] = val;
  }
  return props;
}

function extractStandardClauseFromText(textChunk: string): StandardClauseRef | undefined {
  const metaRe = /@(?:StandardClause|ComplianceRule|Standard)\b\s*(\{[^}]*\}|\([^)]*\))?/g;
  let m: RegExpExecArray | null;
  while ((m = metaRe.exec(textChunk)) !== null) {
    const props = m[1] ? parseAnnotationProps(m[1]) : {};
    const severityRaw = props["severity"]?.toLowerCase();
    const severity =
      severityRaw === "warning" ? "warning" : severityRaw === "info" ? "info" : props["severity"] ? "error" : undefined;
    return {
      standard: props["standard"] ?? props["code"],
      edition: props["edition"],
      clauseId: props["clauseId"] ?? props["clause"] ?? props["id"],
      severity,
    };
  }
  return undefined;
}

function isMetadataGapOnly(gap: string): boolean {
  const stripped = gap
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ")
    .replace(/@[A-Za-z_][A-Za-z0-9_:]*\s*(?:\{[^}]*\}|\([^)]*\))?/g, " ")
    .replace(/\b(?:public|private|protected|abstract)\b/g, " ")
    .trim();
  return stripped.length === 0;
}

function extractLeadingAnnotationsBeforeOffset(sysmlText: string, declStartIndex: number): string {
  const windowStart = Math.max(0, declStartIndex - 800);
  const window = sysmlText.slice(windowStart, declStartIndex);
  const headerRe = /@(?:StandardClause|ComplianceRule|Standard)\b/g;
  const candidates: { index: number; end: number }[] = [];
  let hm: RegExpExecArray | null;
  while ((hm = headerRe.exec(window)) !== null) {
    let end = hm.index + hm[0].length;
    while (end < window.length && /\s/.test(window[end]!)) end++;
    if (window[end] === "{") {
      const bal = extractBalancedBraceBody(window, end);
      end = Math.max(end + 1, bal.endIndex + 1);
    } else if (window[end] === "(") {
      const closeParen = window.indexOf(")", end + 1);
      if (closeParen >= 0) end = closeParen + 1;
    }
    candidates.push({ index: hm.index, end });
  }
  for (let i = candidates.length - 1; i >= 0; i--) {
    const cand = candidates[i]!;
    if (isMetadataGapOnly(window.slice(cand.end))) {
      return window.slice(cand.index);
    }
  }
  return "";
}

function extractInlineCalcDefsFromText(sysmlText: string, packageName?: string): Record<string, InlineCalcDef> {
  const calculators: Record<string, InlineCalcDef> = {};
  const calcStartRe = /calc\s+(?:def\s+)?(?:<['"]?([^'">]+)['"]?>\s*)?([a-zA-Z0-9_]+)\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = calcStartRe.exec(sysmlText)) !== null) {
    const calcName = m[2]!;
    const openBraceIdx = m.index + m[0].length - 1;
    const { body } = extractBalancedBraceBody(sysmlText, openBraceIdx);

    const params: string[] = [];
    const inParamRe = /\bin\s+(?:attribute\s+)?([a-zA-Z0-9_]+)\b/g;
    let pm: RegExpExecArray | null;
    while ((pm = inParamRe.exec(body)) !== null) {
      params.push(pm[1]!);
    }

    let externalCalculator: string | undefined;
    const extMetaRe = /@(?:ExternalCalculator|LookupTable)\b\s*(\{[^}]*\}|\([^)]*\))?/g;
    const em = extMetaRe.exec(body);
    if (em && em[1]) {
      const props = parseAnnotationProps(em[1]);
      externalCalculator = props["calculator"] ?? props["table"] ?? props["name"] ?? props["id"];
    }

    let bodyAst: ConstraintExprAst | undefined;
    const returnMatch = body.match(/return\b[^=;]*=\s*([\s\S]*?);/);
    if (returnMatch && returnMatch[1]) {
      bodyAst = parseConstraintExprAst(returnMatch[1]);
    } else if (!externalCalculator) {
      const cleanLines = stripSysmlComments(body)
        .split(/[;\n]/)
        .map((l) => l.trim())
        .filter(
          (l) => l && !l.startsWith("in ") && !l.startsWith("out ") && !l.startsWith("return") && !l.startsWith("@"),
        );
      for (let i = cleanLines.length - 1; i >= 0; i--) {
        const candidate = parseConstraintExprAst(cleanLines[i]!);
        if (candidate) {
          bodyAst = candidate;
          break;
        }
      }
    }

    const def: InlineCalcDef = {
      name: calcName,
      params,
      bodyAst,
      externalCalculator,
    };
    calculators[calcName] = def;
    if (packageName) {
      calculators[`${packageName}::${calcName}`] = def;
    }
  }
  return calculators;
}

function collectStringAttributesFromText(text: string, out: Map<string, string>, prefix?: string): void {
  const strAttrRe = /attribute\s+(?::>>\s*)?([a-zA-Z0-9_]+)\s*(?::\s*[^=;\n]+)?=\s*(?:"([^"]*)"|'([^']*)')\s*;/g;
  let m: RegExpExecArray | null;
  while ((m = strAttrRe.exec(text)) !== null) {
    const name = m[1]!;
    const val = m[2] ?? m[3] ?? "";
    out.set(name, val);
    if (prefix) out.set(`${prefix}.${name}`, val);
  }
}

function extractConstraintBlocksByKind(body: string, kind: "assume" | "require"): string[] {
  const results: string[] = [];
  const re = new RegExp(`\\b${kind}\\s+constraint\\b(?:\\s+[a-zA-Z0-9_<>'"]+)?\\s*\\{`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const openBraceIdx = m.index + m[0].length - 1;
    const { body: blockBody, endIndex } = extractBalancedBraceBody(body, openBraceIdx);
    results.push(blockBody);
    re.lastIndex = endIndex + 1;
  }
  return results;
}

function extractRequirementBlocksFromText(
  sysmlText: string,
): { shortId?: string | undefined; id: string; body: string; prefixText: string }[] {
  const blocks: { shortId?: string | undefined; id: string; body: string; prefixText: string }[] = [];
  const reqStartRegex = /requirement\s+(?:def\s+)?(?:<['"]?([^'">]+)['"]?>\s*)?([a-zA-Z0-9_]+)[^{};]*\{/g;
  let match: RegExpExecArray | null;
  while ((match = reqStartRegex.exec(sysmlText)) !== null) {
    const shortId = match[1];
    const id = match[2]!;
    const openBraceIdx = match.index + match[0].length - 1;
    const { body, endIndex } = extractBalancedBraceBody(sysmlText, openBraceIdx);
    const prefixText = extractLeadingAnnotationsBeforeOffset(sysmlText, match.index);
    blocks.push({ shortId, id, body, prefixText });
    reqStartRegex.lastIndex = Math.max(reqStartRegex.lastIndex, endIndex + 1);
  }
  return blocks;
}

function resolveIntervalVarFromEnv(
  varPath: string,
  req: SysmlRequirement,
  varEnv: ReadonlyMap<string, NumericalInterval>,
  twinAnnotations?: ReadonlyMap<string, string>,
): { interval: NumericalInterval; matchedVar: string } | undefined {
  const direct = varEnv.get(varPath);
  if (direct && !direct.isBottom()) return { interval: direct, matchedVar: varPath };

  const candidates: string[] = [];
  if (req.subjectVarName && varPath.startsWith(`${req.subjectVarName}.`)) {
    const stripped = varPath.slice(req.subjectVarName.length + 1);
    candidates.push(stripped);
    if (req.subjectName) candidates.push(`${req.subjectName}.${stripped}`);
  }
  const leaf = varPath.split(".").pop()?.split("::").pop()?.trim() ?? "";
  if (leaf) {
    candidates.push(leaf);
    if (req.subjectName) candidates.push(`${req.subjectName}.${leaf}`);
  }

  for (const cand of candidates) {
    const iv = varEnv.get(cand);
    if (iv && !iv.isBottom()) return { interval: iv, matchedVar: cand };
  }

  if (twinAnnotations) {
    for (const [modelVar, twinTarget] of twinAnnotations.entries()) {
      if (
        twinTarget === varPath ||
        (leaf &&
          (twinTarget === leaf ||
            twinTarget.endsWith(`.${leaf}`) ||
            twinTarget.endsWith(`${req.id}.${leaf}`) ||
            twinTarget.endsWith(`::${leaf}`)))
      ) {
        const iv = varEnv.get(modelVar);
        if (iv && !iv.isBottom()) return { interval: iv, matchedVar: modelVar };
      }
    }
  }

  if (leaf) {
    for (const [k, iv] of varEnv.entries()) {
      if (!iv.isBottom() && (k === leaf || k.endsWith(`.${leaf}`))) {
        return { interval: iv, matchedVar: k };
      }
    }
  }

  const staticNum = req.attributes?.[varPath] ?? (leaf ? req.attributes?.[leaf] : undefined);
  if (staticNum !== undefined && Number.isFinite(staticNum)) {
    return { interval: NumericalInterval.const(staticNum), matchedVar: varPath };
  }

  return undefined;
}

function resolveStringVarFromEnv(
  varPath: string,
  req: SysmlRequirement,
  stringEnv?: ReadonlyMap<string, string>,
): string | undefined {
  if (stringEnv) {
    const s = stringEnv.get(varPath);
    if (s !== undefined) return s;
    const leaf = varPath.split(".").pop()?.split("::").pop()?.trim() ?? "";
    if (leaf && stringEnv.has(leaf)) return stringEnv.get(leaf);
    for (const [k, v] of stringEnv.entries()) {
      if (k.endsWith(`.${leaf}`)) return v;
    }
  }
  const leaf = varPath.split(".").pop()?.split("::").pop()?.trim() ?? "";
  return req.stringAttributes?.[varPath] ?? (leaf ? req.stringAttributes?.[leaf] : undefined);
}

function evaluateBuiltinIntervalCall(name: string, args: NumericalInterval[]): NumericalInterval | undefined {
  const fn = name.split("::").pop()!.split(".").pop()!.toLowerCase();
  if (args.length === 0) return undefined;
  const a0 = args[0]!;
  if (fn === "abs") {
    if (a0.low >= 0) return a0;
    if (a0.high <= 0) return a0.neg();
    return new NumericalInterval(0, Math.max(-a0.low, a0.high));
  }
  if (fn === "sqrt") {
    if (a0.high < 0) return undefined;
    return new NumericalInterval(Math.sqrt(Math.max(0, a0.low)), Math.sqrt(a0.high));
  }
  if (fn === "exp") {
    return new NumericalInterval(Math.exp(a0.low), Math.exp(a0.high));
  }
  if (fn === "log" || fn === "ln") {
    if (a0.high <= 0) return undefined;
    return new NumericalInterval(a0.low > 0 ? Math.log(a0.low) : -Infinity, Math.log(a0.high));
  }
  if (fn === "min") {
    let low = a0.low;
    let high = a0.high;
    for (let i = 1; i < args.length; i++) {
      low = Math.min(low, args[i]!.low);
      high = Math.min(high, args[i]!.high);
    }
    return new NumericalInterval(low, high);
  }
  if (fn === "max") {
    let low = a0.low;
    let high = a0.high;
    for (let i = 1; i < args.length; i++) {
      low = Math.max(low, args[i]!.low);
      high = Math.max(high, args[i]!.high);
    }
    return new NumericalInterval(low, high);
  }
  if (fn === "pow" && args.length >= 2) {
    return evaluateIntervalPower(a0, args[1]!);
  }
  if (fn === "ceil") return new NumericalInterval(Math.ceil(a0.low), Math.ceil(a0.high));
  if (fn === "floor") return new NumericalInterval(Math.floor(a0.low), Math.floor(a0.high));
  return undefined;
}

function evaluateIntervalPower(base: NumericalInterval, exp: NumericalInterval): NumericalInterval | undefined {
  if (base.isBottom() || exp.isBottom()) return undefined;
  if (exp.isConstant()) {
    const e = exp.low;
    if (e === 0) return NumericalInterval.ONE;
    if (e === 1) return base;
    if (e === 2) return base.sqr();
    if (Number.isInteger(e) && e > 0) {
      if (e % 2 === 0) {
        const l = Math.pow(base.low, e);
        const h = Math.pow(base.high, e);
        return base.contains(0)
          ? new NumericalInterval(0, Math.max(l, h))
          : new NumericalInterval(Math.min(l, h), Math.max(l, h));
      }
      return new NumericalInterval(Math.pow(base.low, e), Math.pow(base.high, e));
    }
    if (base.low >= 0) {
      const a = Math.pow(base.low, e);
      const b = Math.pow(base.high, e);
      return new NumericalInterval(Math.min(a, b), Math.max(a, b));
    }
    return undefined;
  }
  if (base.low > 0) {
    const cands = [
      Math.pow(base.low, exp.low),
      Math.pow(base.low, exp.high),
      Math.pow(base.high, exp.low),
      Math.pow(base.high, exp.high),
    ].filter((v) => !Number.isNaN(v));
    if (cands.length === 4) {
      return new NumericalInterval(Math.min(...cands), Math.max(...cands));
    }
  }
  return undefined;
}

function evaluateExternalCalculatorOverIntervals(
  callName: string,
  argVals: Array<{ num?: NumericalInterval | undefined; str?: string | undefined }>,
  calcDef?: InlineCalcDef,
): NumericalInterval | undefined {
  const numDims: number[] = [];
  for (let i = 0; i < argVals.length; i++) {
    const a = argVals[i]!;
    if (a.str !== undefined) continue;
    if (!a.num) return undefined;
    if (!Number.isFinite(a.num.low) || !Number.isFinite(a.num.high)) return undefined;
    if (!a.num.isConstant()) numDims.push(i);
  }

  // Point evaluation fast path
  if (numDims.length === 0) {
    const pt = argVals.map((a) => (a.str !== undefined ? a.str : a.num!.low));
    const v = invokeExternalCalculatorValue(callName, pt, calcDef);
    return !Number.isNaN(v) ? NumericalInterval.const(v) : undefined;
  }

  if (numDims.length > 3) return undefined;
  const steps = numDims.length === 1 ? 16 : 4;
  const grids: number[][] = argVals.map((a) => {
    if (a.str !== undefined) return [];
    const lo = a.num!.low;
    const hi = a.num!.high;
    if (lo === hi) return [lo];
    const pts: number[] = [];
    for (let s = 0; s <= steps; s++) {
      pts.push(lo + ((hi - lo) * s) / steps);
    }
    return pts;
  });

  let minRes = Infinity;
  let maxRes = -Infinity;
  const currentArgs: (number | string)[] = argVals.map((a) => (a.str !== undefined ? a.str : a.num!.low));

  const recurse = (idx: number): boolean => {
    if (idx === argVals.length) {
      const v = invokeExternalCalculatorValue(callName, currentArgs, calcDef);
      if (Number.isNaN(v)) return false;
      if (v < minRes) minRes = v;
      if (v > maxRes) maxRes = v;
      return true;
    }
    if (argVals[idx]!.str !== undefined) {
      currentArgs[idx] = argVals[idx]!.str!;
      return recurse(idx + 1);
    }
    for (const pt of grids[idx]!) {
      currentArgs[idx] = pt;
      if (!recurse(idx + 1)) return false;
    }
    return true;
  };

  if (!recurse(0) || !Number.isFinite(minRes) || !Number.isFinite(maxRes)) return undefined;
  return new NumericalInterval(minRes, maxRes);
}

export function evaluateConstraintExprInterval(
  ast: ConstraintExprAst,
  req: SysmlRequirement,
  varEnv: ReadonlyMap<string, NumericalInterval>,
  twinAnnotations?: ReadonlyMap<string, string>,
  stringEnv?: ReadonlyMap<string, string>,
  depth = 0,
): { interval: NumericalInterval; primaryMatchedVar?: string | undefined } | undefined {
  if (depth > 16) return undefined;

  if (ast.kind === "lit") return { interval: NumericalInterval.const(ast.value) };
  if (ast.kind === "str") return undefined;

  if (ast.kind === "var") {
    const resolved = resolveIntervalVarFromEnv(ast.path, req, varEnv, twinAnnotations);
    if (!resolved) return undefined;
    return { interval: resolved.interval, primaryMatchedVar: resolved.matchedVar };
  }

  if (ast.kind === "unary") {
    const inner = evaluateConstraintExprInterval(ast.operand, req, varEnv, twinAnnotations, stringEnv, depth + 1);
    if (!inner) return undefined;
    return {
      interval: ast.op === "-" ? inner.interval.neg() : inner.interval,
      primaryMatchedVar: inner.primaryMatchedVar,
    };
  }

  if (ast.kind === "bin") {
    const left = evaluateConstraintExprInterval(ast.left, req, varEnv, twinAnnotations, stringEnv, depth + 1);
    const right = evaluateConstraintExprInterval(ast.right, req, varEnv, twinAnnotations, stringEnv, depth + 1);
    if (!left || !right) return undefined;
    const primaryMatchedVar = left.primaryMatchedVar ?? right.primaryMatchedVar;
    if (ast.op === "+") return { interval: left.interval.add(right.interval), primaryMatchedVar };
    if (ast.op === "-") return { interval: left.interval.sub(right.interval), primaryMatchedVar };
    if (ast.op === "*") return { interval: left.interval.mul(right.interval), primaryMatchedVar };
    if (ast.op === "/") {
      const divRes = left.interval.div(right.interval);
      if (divRes.divisionByZero === "definite" || divRes.result.isBottom()) return undefined;
      return { interval: divRes.result, primaryMatchedVar };
    }
    if (ast.op === "^") {
      const powRes = evaluateIntervalPower(left.interval, right.interval);
      return powRes ? { interval: powRes, primaryMatchedVar } : undefined;
    }
    return undefined;
  }

  if (ast.kind === "call") {
    const evalArgs: Array<{ num?: NumericalInterval | undefined; str?: string | undefined }> = [];
    let primaryMatchedVar: string | undefined;
    for (const arg of ast.args) {
      if (arg.kind === "str") {
        evalArgs.push({ str: arg.value });
        continue;
      }
      if (arg.kind === "var") {
        const sVal = resolveStringVarFromEnv(arg.path, req, stringEnv);
        if (sVal !== undefined) {
          evalArgs.push({ str: sVal });
          continue;
        }
      }
      const numEval = evaluateConstraintExprInterval(arg, req, varEnv, twinAnnotations, stringEnv, depth + 1);
      if (!numEval) return undefined;
      if (!primaryMatchedVar && numEval.primaryMatchedVar) primaryMatchedVar = numEval.primaryMatchedVar;
      evalArgs.push({ num: numEval.interval });
    }

    const calc = resolveInlineCalc(ast.name, req.calculators);
    if (calc?.bodyAst) {
      const localVarEnv = new Map<string, NumericalInterval>(varEnv);
      const localStrEnv = new Map<string, string>(stringEnv ?? []);
      const localReqAttrs: Record<string, number> = { ...(req.attributes ?? {}) };
      const localReq: SysmlRequirement = { ...req, subjectVarName: undefined, attributes: localReqAttrs };
      for (let i = 0; i < calc.params.length && i < evalArgs.length; i++) {
        const paramName = calc.params[i]!;
        const v = evalArgs[i]!;
        if (v.str !== undefined) localStrEnv.set(paramName, v.str);
        else if (v.num) localVarEnv.set(paramName, v.num);
      }
      const inlineRes = evaluateConstraintExprInterval(
        calc.bodyAst,
        localReq,
        localVarEnv,
        twinAnnotations,
        localStrEnv,
        depth + 1,
      );
      if (inlineRes) return { interval: inlineRes.interval, primaryMatchedVar };
    }

    const extRes = evaluateExternalCalculatorOverIntervals(ast.name, evalArgs, calc);
    if (extRes) return { interval: extRes, primaryMatchedVar };

    if (evalArgs.every((a) => a.num !== undefined)) {
      const builtinRes = evaluateBuiltinIntervalCall(
        ast.name,
        evalArgs.map((a) => a.num!),
      );
      if (builtinRes) return { interval: builtinRes, primaryMatchedVar };
    }
    return undefined;
  }

  return undefined;
}

export function evaluateConstraintComparisonInterval(
  comp: ConstraintComparisonAst,
  req: SysmlRequirement,
  varEnv: ReadonlyMap<string, NumericalInterval>,
  twinAnnotations?: ReadonlyMap<string, string>,
  stringEnv?: ReadonlyMap<string, string>,
):
  | {
      status: "satisfied" | "definite" | "possible";
      lhsInterval: NumericalInterval;
      rhsInterval: NumericalInterval;
      primaryMatchedVar?: string | undefined;
    }
  | undefined {
  const lhsEval = evaluateConstraintExprInterval(comp.lhs, req, varEnv, twinAnnotations, stringEnv);
  const rhsEval = evaluateConstraintExprInterval(comp.rhs, req, varEnv, twinAnnotations, stringEnv);
  if (!lhsEval || !rhsEval) return undefined;

  const L = lhsEval.interval;
  const R = rhsEval.interval;
  const primaryMatchedVar = lhsEval.primaryMatchedVar ?? rhsEval.primaryMatchedVar;

  let status: "satisfied" | "definite" | "possible" = "possible";
  switch (comp.op) {
    case "<=":
      if (L.high <= R.low) status = "satisfied";
      else if (L.low > R.high) status = "definite";
      break;
    case "<":
      if (L.high < R.low) status = "satisfied";
      else if (L.low >= R.high) status = "definite";
      break;
    case ">=":
      if (L.low >= R.high) status = "satisfied";
      else if (L.high < R.low) status = "definite";
      break;
    case ">":
      if (L.low > R.high) status = "satisfied";
      else if (L.high <= R.low) status = "definite";
      break;
    case "==":
      if (L.isConstant() && R.isConstant() && L.low === R.low) status = "satisfied";
      else if (L.high < R.low || R.high < L.low) status = "definite";
      break;
    case "!=":
      if (L.high < R.low || R.high < L.low) status = "satisfied";
      else if (L.isConstant() && R.isConstant() && L.low === R.low) status = "definite";
      break;
  }

  return { status, lhsInterval: L, rhsInterval: R, primaryMatchedVar };
}

/**
 * Evaluates full symbolic & nonlinear SysML v2 requirements (including `assume constraint`
 * guards, inline `calc def` formulas, and external table/WASM calculators) against a map of
 * Modelica DAE variable intervals.
 */
export function evaluateSysmlRequirementsOnIntervals(
  requirements: readonly SysmlRequirement[],
  varEnv: ReadonlyMap<string, NumericalInterval>,
  twinAnnotations?: ReadonlyMap<string, string>,
  stringEnv?: ReadonlyMap<string, string>,
): IntervalRequirementIssue[] {
  const issues: IntervalRequirementIssue[] = [];

  for (const req of requirements) {
    const comp: ConstraintComparisonAst = req.constraintAst ?? {
      lhs: { kind: "var", path: req.targetAttribute },
      op: req.operator,
      rhs: { kind: "lit", value: req.limitValue },
    };

    // Check `assume constraint` guards first: a definitively false assume makes the rule inapplicable.
    let assumeUncertain = false;
    if (req.assumeAsts && req.assumeAsts.length > 0) {
      let inapplicable = false;
      for (const assumeAst of req.assumeAsts) {
        const assumeRes = evaluateConstraintComparisonInterval(assumeAst, req, varEnv, twinAnnotations, stringEnv);
        if (!assumeRes) continue;
        if (assumeRes.status === "definite") {
          inapplicable = true;
          break;
        }
        if (assumeRes.status === "possible") {
          assumeUncertain = true;
        }
      }
      if (inapplicable) continue;
    }

    const res = evaluateConstraintComparisonInterval(comp, req, varEnv, twinAnnotations, stringEnv);
    if (!res || res.status === "satisfied") continue;

    const severity: "definite" | "possible" = res.status === "definite" && !assumeUncertain ? "definite" : "possible";
    const varName = res.primaryMatchedVar ?? req.targetAttribute;

    let requiredLimit: number | undefined;
    let suggestedValue: number | undefined;
    let margin: number | undefined;

    if (comp.op === "<=" || comp.op === "<") {
      if (Number.isFinite(res.rhsInterval.low)) {
        requiredLimit = res.rhsInterval.low;
        margin = res.rhsInterval.low - res.lhsInterval.high;
        suggestedValue =
          comp.op === "<="
            ? requiredLimit
            : Number((requiredLimit - Math.max(1e-6, Math.abs(requiredLimit) * 1e-4)).toFixed(6));
      }
    } else if (comp.op === ">=" || comp.op === ">") {
      if (Number.isFinite(res.rhsInterval.high)) {
        requiredLimit = res.rhsInterval.high;
        margin = res.lhsInterval.low - res.rhsInterval.high;
        suggestedValue =
          comp.op === ">="
            ? requiredLimit
            : Number((requiredLimit + Math.max(1e-6, Math.abs(requiredLimit) * 1e-4)).toFixed(6));
      }
    }

    const sc = req.standardClause;
    const clauseParts = [sc?.standard, sc?.clauseId].filter(Boolean);
    const clauseLabel = clauseParts.length > 0 ? `[${clauseParts.join(" ")}] ` : "";
    const fmt = (n: number) => (Number.isFinite(n) ? Number(n.toPrecision(6)).toString() : String(n));
    const lhsDesc = `[${fmt(res.lhsInterval.low)}, ${fmt(res.lhsInterval.high)}]`;
    const rhsDesc = `[${fmt(res.rhsInterval.low)}, ${fmt(res.rhsInterval.high)}]`;

    issues.push({
      requirementId: req.id,
      clauseLabel: clauseParts.length > 0 ? clauseParts.join(" ") : undefined,
      severity,
      varName,
      operator: comp.op,
      lhsInterval: res.lhsInterval,
      rhsInterval: res.rhsInterval,
      requiredLimit,
      suggestedValue,
      margin,
      message: `${clauseLabel}Requirement '${req.id}' violated for '${varName}': ${lhsDesc} fails constraint '${varName} ${comp.op} ${rhsDesc}'.`,
    });
  }

  return issues;
}

function parseSysmlRequirementsFallback(sysmlText: string): SysmlRequirement[] {
  const pkgMatch = sysmlText.match(/(?:library\s+)?package\s+([a-zA-Z0-9_]+)/);
  const packageName = pkgMatch ? pkgMatch[1] : undefined;
  const calculators = extractInlineCalcDefsFromText(sysmlText, packageName);

  const globalAttrs = new Map<string, number>();
  const globalStrAttrs = new Map<string, string>();
  collectStringAttributesFromText(sysmlText, globalStrAttrs);

  const attrRegex = /attribute\s+(?::>>\s*)?([a-zA-Z0-9_]+)\s*(?::\s*[^=;\n]+)?=\s*([^;\n]+);/g;
  let attrMatch: RegExpExecArray | null;
  while ((attrMatch = attrRegex.exec(sysmlText)) !== null) {
    const name = attrMatch[1]!;
    const val = evaluateSimpleSysmlArithmetic(attrMatch[2]!, globalAttrs, globalStrAttrs, calculators);
    if (!Number.isNaN(val)) {
      globalAttrs.set(name, val);
    }
  }

  const blocks = extractRequirementBlocksFromText(sysmlText);
  const results: SysmlRequirement[] = [];

  for (const block of blocks) {
    const { shortId, id: reqId, body, prefixText } = block;

    const localAttrs = new Map<string, number>(globalAttrs);
    const localStrAttrs = new Map<string, string>(globalStrAttrs);
    collectStringAttributesFromText(body, localStrAttrs);

    const localAttrRegex = /attribute\s+(?::>>\s*)?([a-zA-Z0-9_]+)\s*(?::\s*[^=;\n]+)?=\s*([^;\n]+);/g;
    let laMatch: RegExpExecArray | null;
    while ((laMatch = localAttrRegex.exec(body)) !== null) {
      const name = laMatch[1]!;
      const val = evaluateSimpleSysmlArithmetic(laMatch[2]!, localAttrs, localStrAttrs, calculators);
      if (!Number.isNaN(val)) {
        localAttrs.set(name, val);
      }
    }

    let subjectName: string | undefined;
    let subjectVarName: string | undefined;
    const subjMatch = body.match(/subject\s+([a-zA-Z0-9_]+)\s*:\s*([a-zA-Z0-9_.:]+)/);
    if (subjMatch) {
      subjectVarName = subjMatch[1];
      subjectName = subjMatch[2]?.split("::").pop();
    }

    const standardClause = extractStandardClauseFromText(body) ?? extractStandardClauseFromText(prefixText);

    const assumeAsts: ConstraintComparisonAst[] = [];
    for (const assumeBlock of extractConstraintBlocksByKind(body, "assume")) {
      for (const clause of splitConstraintClauses(assumeBlock)) {
        const compAst = parseConstraintComparisonAst(clause);
        if (compAst) assumeAsts.push(compAst);
      }
    }

    const attrObj: Record<string, number> = {};
    for (const [k, v] of localAttrs.entries()) {
      if (!k.includes(".")) attrObj[k] = v;
    }
    const strObj: Record<string, string> = {};
    for (const [k, v] of localStrAttrs.entries()) {
      if (!k.includes(".")) strObj[k] = v;
    }

    const requireBlocks = extractConstraintBlocksByKind(body, "require");
    for (const constraintText of requireBlocks) {
      for (const clause of splitConstraintClauses(constraintText)) {
        const compAst = parseConstraintComparisonAst(clause);
        if (!compAst) continue;
        if (compAst.op !== "<=" && compAst.op !== ">=" && compAst.op !== "<" && compAst.op !== ">") continue;

        const targetAttribute = collectPrimaryAttributeName(compAst.lhs, compAst.rhs);
        if (!targetAttribute) continue;

        const lhsVars = collectExprVars(compAst.lhs);
        const firstVarPath = lhsVars[0] ?? "";
        const explicitVar = firstVarPath.includes(".") ? firstVarPath.split(".")[0] : undefined;
        const limitValue = evaluateConstraintExprScalar(compAst.rhs, localAttrs, localStrAttrs, calculators);

        results.push({
          id: reqId,
          shortId,
          packageName,
          subjectName,
          subjectVarName: subjectVarName ?? explicitVar,
          targetAttribute,
          operator: compAst.op,
          limitValue,
          attributes: attrObj,
          stringAttributes: Object.keys(strObj).length > 0 ? strObj : undefined,
          standardClause,
          constraintAst: compAst,
          assumeAsts: assumeAsts.length > 0 ? assumeAsts : undefined,
          calculators: Object.keys(calculators).length > 0 ? calculators : undefined,
          expressionText: clause,
        });
      }
    }
  }

  return results;
}

/**
 * Parses formal SysML v2 `requirement def` and `requirement` blocks using the
 * native WebAssembly GLR parser (`languages/sysml2/dist/parser.wasm`) to extract
 * numerical safety and operational bounds from the Concrete Syntax Tree (CST).
 */
export function parseSysmlRequirements(sysmlText: string, cstRoot?: SyntaxNode | null): SysmlRequirement[] {
  const rootNode = cstRoot ?? getSysmlWasmParser()?.parse(sysmlText)?.rootNode ?? null;
  if (!rootNode) {
    return parseSysmlRequirementsFallback(sysmlText);
  }

  const requirements: SysmlRequirement[] = [];

  // Package name if enclosed in a top-level Package / LibraryPackage
  const pkgNodes = rootNode.descendantsOfType(["Package", "LibraryPackage"]);
  const packageName =
    pkgNodes.length > 0 ? extractSysmlIdentification(pkgNodes[0]!).declaredName || undefined : undefined;
  const calculators = extractInlineCalcDefsFromText(sysmlText, packageName);

  // Global/package-level attribute defaults (including part def attributes)
  const globalAttrMap = new Map<string, number>();
  const globalStrMap = new Map<string, string>();
  collectStringAttributesFromText(sysmlText, globalStrMap);
  const partDefNodes = rootNode.descendantsOfType(["PartDefinition", "PartUsage"]);
  for (const partNode of partDefNodes) {
    const { declaredName: partName } = extractSysmlIdentification(partNode);
    collectAttributeUsagesFromCst(partNode, globalAttrMap, partName || undefined);
  }
  collectAttributeUsagesFromCst(rootNode, globalAttrMap);

  const reqNodes = rootNode.descendantsOfType(["RequirementDefinition", "RequirementUsage"]);
  for (const reqNode of reqNodes) {
    const { declaredName: reqId, declaredShortName: shortId } = extractSysmlIdentification(reqNode);
    if (!reqId) continue;

    // Local attribute map inherits package/part attributes and overrides with requirement attributes
    const localAttrMap = new Map<string, number>(globalAttrMap);
    collectAttributeUsagesFromCst(reqNode, localAttrMap);
    const localStrMap = new Map<string, string>(globalStrMap);
    collectStringAttributesFromText(reqNode.text, localStrMap);

    // Also parse local `:>>` numeric redefinitions if CST omitted field bindings
    const redefAttrRe = /attribute\s+:>>\s*([a-zA-Z0-9_]+)\s*(?::\s*[^=;\n]+)?=\s*([^;\n]+);/g;
    let rm: RegExpExecArray | null;
    while ((rm = redefAttrRe.exec(reqNode.text)) !== null) {
      const val = evaluateSimpleSysmlArithmetic(rm[2]!, localAttrMap, localStrMap, calculators);
      if (!Number.isNaN(val)) localAttrMap.set(rm[1]!, val);
    }

    // Extract `subject <subjectVarName> : <subjectName>;` from SubjectUsage CST node
    let subjectName: string | undefined;
    let subjectVarName: string | undefined;
    const subjectNodes = reqNode.descendantsOfType(["SubjectUsage"]);
    if (subjectNodes.length > 0) {
      const subjNode = subjectNodes[0]!;
      const subjId = extractSysmlIdentification(subjNode);
      if (subjId.declaredName) {
        subjectVarName = subjId.declaredName;
      }
      const typingNodes = subjNode.descendantsOfType(["OwnedFeatureTyping", "FeatureTyping"]);
      if (typingNodes.length > 0) {
        const rawType = typingNodes[0]!.text.replace(/^:\s*/, "").trim();
        if (rawType) {
          subjectName = rawType.split("::").pop()!.trim();
        }
      }
    }

    // Standard compliance clause annotation (`@StandardClause` / `@ComplianceRule`) inside or before requirement
    const prefixText = extractLeadingAnnotationsBeforeOffset(sysmlText, reqNode.startIndex);
    const standardClause = extractStandardClauseFromText(reqNode.text) ?? extractStandardClauseFromText(prefixText);

    // Collect plain record of numeric & string attributes in scope
    const attributesRecord: Record<string, number> = {};
    for (const [k, v] of localAttrMap.entries()) {
      if (!k.includes(".")) {
        attributesRecord[k] = v;
      }
    }
    const stringAttributesRecord: Record<string, string> = {};
    for (const [k, v] of localStrMap.entries()) {
      if (!k.includes(".")) {
        stringAttributesRecord[k] = v;
      }
    }
    const strAttrsOrUndef = Object.keys(stringAttributesRecord).length > 0 ? stringAttributesRecord : undefined;
    const calcsOrUndef = Object.keys(calculators).length > 0 ? calculators : undefined;

    const constraintMembers = reqNode.descendantsOfType(["RequirementConstraintMember"]);

    // Pass 1: Collect `assume constraint` applicability guards
    const assumeAsts: ConstraintComparisonAst[] = [];
    for (const memberNode of constraintMembers) {
      const kindNode = memberNode.childForFieldName("constraintKind");
      if (kindNode && kindNode.text.trim() === "assume") {
        const mText = memberNode.text;
        const openBrace = mText.indexOf("{");
        const body = openBrace >= 0 ? extractBalancedBraceBody(mText, openBrace).body : mText;
        for (const clause of splitConstraintClauses(body)) {
          const compAst = parseConstraintComparisonAst(clause);
          if (compAst) assumeAsts.push(compAst);
        }
      }
    }
    const assumeOrUndef = assumeAsts.length > 0 ? assumeAsts : undefined;

    // Pass 2: Extract `require constraint` comparisons via full AST parser first, then CST fallback
    for (const memberNode of constraintMembers) {
      const kindNode = memberNode.childForFieldName("constraintKind");
      if (kindNode && kindNode.text.trim() === "assume") {
        continue;
      }

      let extractedAstClause = false;
      const mText = memberNode.text;
      const openBrace = mText.indexOf("{");
      if (openBrace >= 0) {
        const { body } = extractBalancedBraceBody(mText, openBrace);
        for (const clause of splitConstraintClauses(body)) {
          const compAst = parseConstraintComparisonAst(clause);
          if (!compAst) continue;
          if (compAst.op !== "<=" && compAst.op !== ">=" && compAst.op !== "<" && compAst.op !== ">") continue;

          const targetAttribute = collectPrimaryAttributeName(compAst.lhs, compAst.rhs);
          if (!targetAttribute) continue;

          const limitValue = evaluateConstraintExprScalar(compAst.rhs, localAttrMap, localStrMap, calculators);
          extractedAstClause = true;
          requirements.push({
            id: reqId,
            shortId,
            packageName,
            subjectName,
            subjectVarName,
            targetAttribute,
            operator: compAst.op,
            limitValue,
            attributes: attributesRecord,
            stringAttributes: strAttrsOrUndef,
            standardClause,
            constraintAst: compAst,
            assumeAsts: assumeOrUndef,
            calculators: calcsOrUndef,
            expressionText: clause,
          });
        }
      }

      if (extractedAstClause) continue;

      // Fallback pre-order CST traversal for shorthand/unbraced CST nodes
      const preOrderNodes: SyntaxNode[] = [];
      const walkPreOrder = (n: SyntaxNode): void => {
        preOrderNodes.push(n);
        for (let i = 0; i < n.childCount; i++) {
          const ch = n.child(i);
          if (ch) walkPreOrder(ch);
        }
      };
      walkPreOrder(memberNode);

      const consumedNodeIds = new Set<number>();

      for (let idx = 0; idx < preOrderNodes.length; idx++) {
        const cur = preOrderNodes[idx]!;
        if (consumedNodeIds.has(cur.id)) continue;

        if (cur.type === "RelationalExpression") {
          const operands = cur.childrenForFieldName("operand");
          const opNode =
            cur.childForFieldName("operator") ??
            cur.children.find(
              (c: SyntaxNode) =>
                c.type === "RelationalOperator" ||
                c.text === "<=" ||
                c.text === ">=" ||
                c.text === "<" ||
                c.text === ">",
            );
          const lhsNode = operands[0] ?? cur.namedChild(0);
          const rhsNode = operands[1] ?? cur.namedChild(cur.namedChildCount - 1);
          const opText = opNode?.text.trim();
          if (lhsNode && rhsNode && (opText === "<=" || opText === ">=" || opText === "<" || opText === ">")) {
            const lhsNames = lhsNode
              .descendantsOfType(["Name"])
              .map((n: SyntaxNode) => unquoteSysmlName(n.text))
              .filter(Boolean);
            const targetAttribute =
              lhsNames.length > 0
                ? lhsNames[lhsNames.length - 1]!
                : unquoteSysmlName(lhsNode.text.split(".").pop() ?? lhsNode.text);
            const limitValue = evaluateSysmlCstNumericExpr(rhsNode, localAttrMap);
            if (targetAttribute && !Number.isNaN(limitValue)) {
              requirements.push({
                id: reqId,
                shortId,
                packageName,
                subjectName,
                subjectVarName,
                targetAttribute,
                operator: opText,
                limitValue,
                attributes: attributesRecord,
                stringAttributes: strAttrsOrUndef,
                standardClause,
                constraintAst: parseConstraintComparisonAst(cur.text),
                assumeAsts: assumeOrUndef,
                calculators: calcsOrUndef,
                expressionText: cur.text,
              });
              for (const d of cur.descendantsOfType([
                "RelationalExpression",
                "OwnedFeatureChain",
                "FeatureReferenceExpression",
              ])) {
                consumedNodeIds.add(d.id);
              }
            }
          }
          continue;
        }

        // Handle dotted feature chains (`subject.attr <= expr`) where LR shifts `subject.attr` into OwnedFeatureChain
        if (cur.type === "OwnedFeatureChain") {
          let parentErr: SyntaxNode | null = cur.parent;
          while (parentErr && parentErr.type !== "ERROR") {
            parentErr = parentErr.parent;
          }
          if (!parentErr || parentErr.type !== "ERROR") continue;
          const opTokenNode = parentErr.children.find((c: SyntaxNode) => {
            const t = c.text.trim();
            return t === "<=" || t === ">=" || t === "<" || t === ">";
          });
          const opText = opTokenNode?.text.trim() as "<=" | ">=" | "<" | ">" | undefined;
          if (!opText) continue;

          const lhsNames = cur
            .descendantsOfType(["Name"])
            .map((n: SyntaxNode) => unquoteSysmlName(n.text))
            .filter(Boolean);
          const targetAttribute = lhsNames.length > 0 ? lhsNames[lhsNames.length - 1]! : "";
          if (!targetAttribute) continue;

          let rhsNode: SyntaxNode | null = null;
          for (let j = idx + 1; j < preOrderNodes.length; j++) {
            const cand = preOrderNodes[j]!;
            if (cand.startIndex < parentErr.endIndex) continue;
            if (
              cand.type === "AdditiveExpression" ||
              cand.type === "MultiplicativeExpression" ||
              cand.type === "UnaryExpression" ||
              cand.type === "MeasurementExpression" ||
              cand.type === "LiteralReal" ||
              cand.type === "LiteralInteger" ||
              cand.type === "FeatureReferenceExpression"
            ) {
              rhsNode = cand;
              break;
            }
          }

          if (rhsNode) {
            const limitValue = evaluateSysmlCstNumericExpr(rhsNode, localAttrMap);
            if (!Number.isNaN(limitValue)) {
              consumedNodeIds.add(cur.id);
              consumedNodeIds.add(rhsNode.id);
              requirements.push({
                id: reqId,
                shortId,
                packageName,
                subjectName,
                subjectVarName,
                targetAttribute,
                operator: opText,
                limitValue,
                attributes: attributesRecord,
                stringAttributes: strAttrsOrUndef,
                standardClause,
                assumeAsts: assumeOrUndef,
                calculators: calcsOrUndef,
              });
            }
          }
        }
      }
    }
  }

  return requirements.length > 0 ? requirements : parseSysmlRequirementsFallback(sysmlText);
}

/**
 * Extracts `annotation(twin = "...")`, `annotation(counterpart = "...")`, or
 * `annotation(implements = "...")` bindings from a Modelica model source string
 * by traversing its native WebAssembly GLR Concrete Syntax Tree (CST).
 * Returns a map from Modelica variable name -> target path.
 */
function extractTwinStringsFromModNodes(modNodes: SyntaxNode[]): string[] {
  const targets: string[] = [];
  for (const modNode of modNodes) {
    const modNameNode = modNode.childForFieldName("name") ?? modNode.firstNamedChild;
    const modKey = modNameNode?.text.trim().toLowerCase();
    if (modKey === "twin" || modKey === "counterpart" || modKey === "implements") {
      const strNodes = modNode.descendantsOfType(["string_literal"]);
      if (strNodes.length > 0) {
        const rawStr = strNodes[0]!.text.trim();
        const unquoted =
          (rawStr.startsWith('"') && rawStr.endsWith('"')) || (rawStr.startsWith("'") && rawStr.endsWith("'"))
            ? rawStr.slice(1, -1)
            : rawStr;
        if (unquoted) {
          targets.push(unquoted);
        }
      }
    }
  }
  return targets;
}

function collectClassLevelAnnotationModNodes(
  node: SyntaxNode,
  rootClassNode: SyntaxNode,
  inAnnotationClause: boolean,
  out: SyntaxNode[],
): void {
  if (
    node !== rootClassNode &&
    (node.type === "class_definition" ||
      node.type === "short_class_definition" ||
      node.type === "component_declaration" ||
      node.type === "component_declaration1")
  ) {
    return;
  }
  const nowInAnnot = inAnnotationClause || node.type === "annotation_clause";
  if (nowInAnnot && node.type === "element_modification") {
    out.push(node);
  }
  for (const child of node.namedChildren) {
    collectClassLevelAnnotationModNodes(child, rootClassNode, nowInAnnot, out);
  }
}

export function extractModelicaTwinAnnotations(moText: string, cstRoot?: SyntaxNode | null): Map<string, string> {
  const result = new Map<string, string>();
  const rootNode = cstRoot ?? getModelicaWasmParser()?.parse(moText)?.rootNode ?? null;
  if (!rootNode) {
    return result;
  }

  const classNodes = rootNode.descendantsOfType(["class_definition", "short_class_definition"]);
  for (const classNode of classNodes) {
    const specNode =
      classNode.childForFieldName("class_specifier") ??
      classNode.namedChildren.find(
        (c: SyntaxNode) => c.type === "class_specifier" || c.type === "short_class_specifier",
      );
    const innerSpec = specNode?.type === "class_specifier" ? specNode.firstNamedChild : specNode;
    const classNameNode =
      innerSpec?.childForFieldName("name") ?? innerSpec?.namedChildren.find((c: SyntaxNode) => c.type === "identifier");
    const className = classNameNode?.text.trim();
    if (!className) continue;

    const classModNodes: SyntaxNode[] = [];
    collectClassLevelAnnotationModNodes(classNode, classNode, false, classModNodes);
    for (const target of extractTwinStringsFromModNodes(classModNodes)) {
      result.set(className, target);
    }
  }

  const compNodes = rootNode.descendantsOfType(["component_declaration", "component_declaration1"]);
  for (const compNode of compNodes) {
    const declNode =
      compNode.childForFieldName("declaration") ??
      compNode.namedChildren.find((c: SyntaxNode) => c.type === "declaration");
    if (!declNode) continue;

    const nameNode = declNode.childForFieldName("name") ?? declNode.firstNamedChild;
    const varName = nameNode?.text.trim();
    if (!varName) continue;

    const modNodes = compNode.descendantsOfType(["element_modification"]);
    for (const target of extractTwinStringsFromModNodes(modNodes)) {
      result.set(varName, target);
    }
  }

  return result;
}

/**
 * Binds parsed SysML v2 requirements to a Modelica DAE's state vector indices.
 *
 * Matching strategy:
 * 1. Explicit `annotation(twin = "...RequirementId.attrName")` or `annotation(twin = "...attrName")`
 * 2. Direct state variable name match (`stateName === req.targetAttribute` or `stateName === "${req.subjectName}.${req.targetAttribute}"`)
 */
export function bindRequirementsToModelica(
  requirements: SysmlRequirement[],
  stateNames: string[],
  twinAnnotations?: Map<string, string>,
): BoundRequirement[] {
  const bound: BoundRequirement[] = [];

  for (const req of requirements) {
    if (!Number.isFinite(req.limitValue)) continue;
    if (req.assumeAsts && req.assumeAsts.length > 0) continue;
    if (req.constraintAst && req.constraintAst.lhs.kind !== "var") continue;

    let matchedIndex = -1;

    // 1. Check explicit twin annotations first
    if (twinAnnotations) {
      for (let i = 0; i < stateNames.length; i++) {
        const sName = stateNames[i]!;
        const twinTarget = twinAnnotations.get(sName);
        if (twinTarget) {
          if (
            twinTarget.endsWith(`${req.id}.${req.targetAttribute}`) ||
            twinTarget.endsWith(`::${req.targetAttribute}`) ||
            twinTarget.endsWith(`.${req.targetAttribute}`)
          ) {
            matchedIndex = i;
            break;
          }
        }
      }
    }

    // 2. Fallback to direct state name / component-qualified state name matching
    if (matchedIndex === -1) {
      for (let i = 0; i < stateNames.length; i++) {
        const sName = stateNames[i]!;
        if (
          sName === req.targetAttribute ||
          sName.endsWith(`.${req.targetAttribute}`) ||
          (req.subjectName && sName.toLowerCase() === `${req.subjectName}.${req.targetAttribute}`.toLowerCase())
        ) {
          matchedIndex = i;
          break;
        }
      }
    }

    if (matchedIndex !== -1) {
      bound.push({
        name: `${req.id}.${req.targetAttribute}`,
        stateIndex: matchedIndex,
        operator: req.operator,
        limitValue: req.limitValue,
      });
    }
  }

  return bound;
}

/**
 * Merges inline `calc def` definitions across multiple parsed SysML v2 files so requirements
 * in one document can call inline `calc def` formulas defined in another standard pack file.
 */
export function linkRequirementCalculators(requirements: readonly SysmlRequirement[]): SysmlRequirement[] {
  const merged: Record<string, InlineCalcDef> = {};
  for (const req of requirements) {
    if (req.calculators) Object.assign(merged, req.calculators);
  }
  if (Object.keys(merged).length === 0) return [...requirements];
  return requirements.map((req) => ({
    ...req,
    calculators: req.calculators ? { ...merged, ...req.calculators } : merged,
  }));
}

/**
 * Registers parsed SysML v2 requirements and Modelica twin bindings as formal
 * literal assertions inside a `SemanticTheoryCoordinator`.
 */
export function assertRequirementsToTheoryCoordinator(
  coordinator: SemanticTheoryCoordinator,
  requirements: SysmlRequirement[],
  baseLiteralId = 9000,
): void {
  let litId = baseLiteralId;
  for (const req of requirements) {
    if (!Number.isFinite(req.limitValue)) continue;
    const varName = req.subjectName ? `${req.subjectName}.${req.targetAttribute}` : req.targetAttribute;
    const bounds: [number, number] =
      req.operator === "<=" || req.operator === "<" ? [-Infinity, req.limitValue] : [req.limitValue, Infinity];

    coordinator.assertLiteral({
      id: litId++,
      predicate: "interval",
      args: [varName, bounds[0], bounds[1]],
      domain: "continuous_safety",
      sourceContext: {
        requirementId: req.id,
        operator: req.operator,
        limitValue: req.limitValue,
      },
    });
  }
}

/**
 * Normalized cross-language anchor discovered automatically from source annotations,
 * imports, typed usages, and requirements traceability edges.
 */
export interface DiscoveredCrossLanguageLink {
  sourceSymbolId: number;
  sourceName: string;
  sourceLang: string;
  sourceUri: string;
  sourceLine: number;
  sourceColumn: number;
  targetName: string;
  relationKind: "twin" | "implements" | "import" | "typed_usage" | "satisfy" | "verify" | "allocate";
  targetEntry?: SymbolEntry | undefined;
  properties?: Record<string, unknown> | undefined;
}

function offsetToOneBasedLineCol(text: string, offset: number): { line: number; column: number } {
  const safeOffset = Math.max(0, Math.min(offset, text.length));
  const slice = text.slice(0, safeOffset);
  const lastNl = slice.lastIndexOf("\n");
  if (lastNl === -1) return { line: 1, column: safeOffset + 1 };
  let line = 1;
  for (let i = 0; i < safeOffset; i++) {
    if (text.charCodeAt(i) === 10) line++;
  }
  return { line, column: safeOffset - lastNl };
}

function resolveTargetInIndex(index: SymbolIndex, rawPath: string, sourceLang: string): SymbolEntry | undefined {
  const parts = splitQualifiedPath(rawPath);
  if (parts.length === 0) return undefined;

  // Strip optional domain prefix like "SysML2::" or "Modelica::" when the prefix is a domain marker
  const firstLower = parts[0]!.toLowerCase();
  const normalizedParts =
    firstLower === "sysml2" ||
    firstLower === "sysml" ||
    firstLower === "modelica" ||
    firstLower === "psse" ||
    firstLower === "pscad"
      ? parts.slice(1)
      : parts;
  if (normalizedParts.length === 0) return undefined;

  const leaf = normalizedParts[normalizedParts.length - 1]!;
  const candidates = (index.byName.get(leaf) ?? [])
    .map((id) => index.symbols.get(id))
    .filter((e): e is SymbolEntry => Boolean(e) && !isRelationshipOrImportSymbol(e));

  if (normalizedParts.length === 1) {
    return candidates.find((c) => c.language && c.language.toLowerCase() !== sourceLang.toLowerCase());
  }

  const rootCandidates = (index.byName.get(normalizedParts[0]!) ?? [])
    .map((id) => index.symbols.get(id))
    .filter((e): e is SymbolEntry => Boolean(e));

  for (const root of rootCandidates) {
    let curr: SymbolEntry | undefined = root;
    for (let i = 1; i < normalizedParts.length && curr; i++) {
      const seg = normalizedParts[i]!;
      const childIds: number[] = index.childrenOf.get(curr.id) ?? [];
      let nextCurr: SymbolEntry | undefined;
      for (const cid of childIds) {
        const candidate = index.symbols.get(cid);
        if (candidate && candidate.name === seg && !isRelationshipOrImportSymbol(candidate)) {
          nextCurr = candidate;
          break;
        }
      }
      curr = nextCurr;
    }
    if (curr && curr.language && curr.language.toLowerCase() !== sourceLang.toLowerCase()) {
      return curr;
    }
  }

  // Qualified suffix fallback matching namePath or parent chain
  for (const cand of candidates) {
    if (!cand.language || cand.language.toLowerCase() === sourceLang.toLowerCase()) continue;
    const expectedTail = normalizedParts.join(".").toLowerCase();
    const candPath = (cand.namePath ?? cand.name).replace(/::/g, ".").toLowerCase();
    if (candPath === expectedTail || candPath.endsWith(`.${expectedTail}`)) {
      return cand;
    }
  }
  return undefined;
}

/**
 * Automatically extracts cross-language thread anchors for `uri` from:
 * 1. Explicit Modelica `annotation(twin = "...")` / `implements` bindings,
 * 2. Indexed SysML v2 `@twin` / `implements` / `satisfy` / `verify` metadata,
 * 3. Cross-language `Import` clauses and typed usages (`OwnedFeatureTyping` / `metadata.typeSpecifier`).
 */
export function extractCrossLanguageLinks(params: {
  uri: string;
  language: string;
  index: SymbolIndex;
  text: string;
  tree?: { rootNode?: RequirementCstNodeLike | null | undefined } | null | undefined;
}): DiscoveredCrossLanguageLink[] {
  const { uri, language, index, text, tree } = params;
  const normLang = language.toLowerCase();
  const links: DiscoveredCrossLanguageLink[] = [];
  const dedupeKeys = new Set<string>();

  const docIds = index.symbolsByResource?.get(uri) ?? [];
  const docSymbols: SymbolEntry[] =
    docIds.length > 0
      ? docIds.map((id) => index.symbols.get(id)).filter((e): e is SymbolEntry => Boolean(e))
      : Array.from(index.symbols.values()).filter((e) => e.resourceId === uri || e.documentUri === uri);

  const pushLink = (link: DiscoveredCrossLanguageLink) => {
    const key = `${link.relationKind}:${link.sourceSymbolId}:${link.targetName}:${link.targetEntry?.id ?? ""}`;
    if (!dedupeKeys.has(key)) {
      dedupeKeys.add(key);
      links.push(link);
    }
  };

  // 1. Explicit Modelica CST twin / implements / counterpart annotations
  if (normLang === "modelica") {
    const twinMap = extractModelicaTwinAnnotations(text, tree?.rootNode ?? null);
    for (const [varName, targetPath] of twinMap.entries()) {
      const srcSym =
        docSymbols.find((s) => s.name === varName && isMemberLikeSymbol(s)) ??
        docSymbols.find((s) => s.name === varName);
      if (!srcSym) continue;
      const pos = offsetToOneBasedLineCol(text, srcSym.startOffset);
      const targetEntry = resolveTargetInIndex(index, targetPath, normLang);
      const metaVal = srcSym.metadata?.["value"];
      const metaDefault = srcSym.metadata?.["defaultValue"];
      const valNum = typeof metaVal === "number" ? metaVal : typeof metaDefault === "number" ? metaDefault : undefined;
      pushLink({
        sourceSymbolId: srcSym.id,
        sourceName: srcSym.name,
        sourceLang: normLang,
        sourceUri: uri,
        sourceLine: pos.line,
        sourceColumn: pos.column,
        targetName: targetPath,
        relationKind: "twin",
        targetEntry,
        ...(valNum !== undefined ? { properties: { [varName]: valNum } } : {}),
      });
    }
  }

  // 2. Index-driven cross-language imports, typed usages, implements, and satisfy/verify links
  for (const sym of docSymbols) {
    const meta = (sym.metadata ?? {}) as Record<string, unknown>;
    const pos = offsetToOneBasedLineCol(text, sym.startOffset);

    const implementsPath =
      typeof meta["implements"] === "string"
        ? meta["implements"]
        : typeof meta["twin"] === "string"
          ? meta["twin"]
          : typeof meta["counterpart"] === "string"
            ? meta["counterpart"]
            : undefined;
    if (implementsPath) {
      const targetEntry = resolveTargetInIndex(index, implementsPath, normLang);
      pushLink({
        sourceSymbolId: sym.id,
        sourceName: sym.name,
        sourceLang: normLang,
        sourceUri: uri,
        sourceLine: pos.line,
        sourceColumn: pos.column,
        targetName: implementsPath,
        relationKind: meta["implements"] ? "implements" : "twin",
        targetEntry,
      });
    }

    if (sym.kind === "Import" && sym.name) {
      const targetEntry = resolveTargetInIndex(index, sym.name, normLang);
      if (targetEntry) {
        pushLink({
          sourceSymbolId: sym.id,
          sourceName: sym.name,
          sourceLang: normLang,
          sourceUri: uri,
          sourceLine: pos.line,
          sourceColumn: pos.column,
          targetName: sym.name,
          relationKind: "import",
          targetEntry,
        });
      }
      continue;
    }

    if (sym.ruleName === "SatisfyRequirementUsage" || sym.ruleName === "VerifyRequirementUsage") {
      if (sym.name) {
        const targetEntry = resolveTargetInIndex(index, sym.name, normLang);
        if (targetEntry) {
          pushLink({
            sourceSymbolId: sym.id,
            sourceName: sym.name,
            sourceLang: normLang,
            sourceUri: uri,
            sourceLine: pos.line,
            sourceColumn: pos.column,
            targetName: sym.name,
            relationKind: sym.ruleName === "VerifyRequirementUsage" ? "verify" : "satisfy",
            targetEntry,
          });
        }
      }
      continue;
    }

    const tggProj = (
      index as unknown as {
        tggProjectionTable?: { canResolveAs(lang: string, cand: SymbolEntry): unknown } | undefined;
      }
    ).tggProjectionTable;

    if (isMemberLikeSymbol(sym)) {
      const childIds = index.childrenOf.get(sym.id) ?? [];
      const typeChild = childIds
        .map((cid) => index.symbols.get(cid))
        .find(
          (c) =>
            c &&
            (c.ruleName === "OwnedFeatureTyping" ||
              c.ruleName === "ConjugatedPortTyping" ||
              c.ruleName === "FeatureTyping"),
        );
      const rawType = String(typeChild?.name ?? meta["typeSpecifier"] ?? meta["type_specifier"] ?? "").trim();
      if (rawType) {
        const targetEntry = resolveTargetInIndex(index, rawType, normLang);
        if (
          targetEntry &&
          (isTypeLikeSymbol(targetEntry) ||
            targetEntry.kind === "Module" ||
            Boolean(tggProj?.canResolveAs(normLang, targetEntry)))
        ) {
          pushLink({
            sourceSymbolId: sym.id,
            sourceName: sym.name,
            sourceLang: normLang,
            sourceUri: uri,
            sourceLine: pos.line,
            sourceColumn: pos.column,
            targetName: rawType,
            relationKind: "typed_usage",
            targetEntry,
          });
        }
      }
    }
  }

  // 3. Emit TGG-aligned cross-language correspondences discovered by UnifiedWorkspace's TggCorrespondenceIndexer
  const tggIndexer = index as unknown as {
    workspace?: { syncTggCorrespondences?(idx: SymbolIndex): unknown } | undefined;
    tggCorrespondenceIndexer?:
      | {
          slotMap: Map<number, number>;
          hypergraph: {
            getRecord(slot: number): {
              relation: number;
              isRemoved: boolean;
              domainNodes: Record<number, number>;
            } | null;
          };
        }
      | undefined;
  };
  if (tggIndexer.workspace?.syncTggCorrespondences) {
    tggIndexer.workspace.syncTggCorrespondences(index);
  }
  const corrIdx = tggIndexer.tggCorrespondenceIndexer;
  if (corrIdx && corrIdx.slotMap.size > 0) {
    for (const sym of docSymbols) {
      const slot = corrIdx.slotMap.get(sym.id);
      if (slot === undefined) continue;
      const rec = corrIdx.hypergraph.getRecord(slot);
      if (!rec || rec.isRemoved) continue;
      const pos = offsetToOneBasedLineCol(text, sym.startOffset);
      const relKind: DiscoveredCrossLanguageLink["relationKind"] =
        rec.relation === 1 ? "satisfy" : rec.relation === 3 ? "verify" : rec.relation === 7 ? "allocate" : "twin";
      for (const peerId of Object.values(rec.domainNodes)) {
        if (peerId === sym.id) continue;
        const peer = index.symbols.get(peerId);
        if (!peer || !peer.language || peer.language.toLowerCase() === normLang) continue;
        pushLink({
          sourceSymbolId: sym.id,
          sourceName: sym.name,
          sourceLang: normLang,
          sourceUri: uri,
          sourceLine: pos.line,
          sourceColumn: pos.column,
          targetName: peer.name,
          relationKind: relKind,
          targetEntry: peer,
        });
      }
    }
  }

  return links;
}

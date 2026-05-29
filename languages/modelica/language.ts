/* eslint-disable */
/**
 * examples/modelica/language.ts — Full Modelica language definition
 *
 * Faithful port of the tree-sitter-modelica grammar.js into metascript
 * combinators, covering the complete Modelica 3.6 Appendix A grammar
 * (§A.1–A.2.7). Every grammar rule is expressed here so that
 * `metascript generate` produces:
 *
 *   - grammar.js      — tree-sitter grammar
 *   - ast_classes.ts   — typed semantic node wrappers
 *   - indexer_config.ts — symbol indexer hooks
 *   - query_hooks.ts   — query / lint functions
 *   - ref_config.ts    — reference resolution hooks
 *
 * Semantic annotations include:
 *   - def() on every symbol-bearing rule
 *   - model configs for AST class generation
 *   - Salsa-memoized queries implementing the Modelica instantiation algorithm
 *   - Lint rules for common diagnostics
 *   - Cross-language adapters for SysML2 interop
 */

import {
  choice,
  def,
  error,
  field,
  info,
  language,
  optional,
  prec,
  ref,
  repeat,
  repeat1,
  seq,
  token,
  warning,
  type QueryDB,
  type Rule,
  type SymbolEntry,
  type SymbolId,
} from "@modelscript/compiler";
import { isBroken, type ModelicaModArgs } from "./modification-args.js";

function parseModArgsFromCst(node: any, scopeId: number | null = null): any {
  const args: any[] = [];
  if (!node) return { args, bindingExpression: null, evaluationScopeId: scopeId };

  const walk = (n: any) => {
    if (!n) return;
    if (n.type === "ElementModification") {
      const nameNode = n.childForFieldName("name");
      const modNode = n.childForFieldName("modification");
      const finalNode = n.children.find((c: any) => c.type === "final");
      const eachNode = n.children.find((c: any) => c.type === "each");

      const name = nameNode ? nameNode.text : "";
      const nameRange = nameNode ? ([nameNode.startIndex, nameNode.endIndex] as const) : undefined;
      const nested = parseModArgsFromCst(modNode, scopeId);

      args.push({
        name,
        nameRange,
        each: !!eachNode,
        final: !!finalNode,
        isRedeclaration: false,
        nestedArgs: nested.args,
        value: nested.bindingExpression,
        evaluationScopeId: scopeId,
      });
      return;
    } else if (n.type === "ElementRedeclaration") {
      const clause = n.childForFieldName("componentClause");
      if (clause) {
        const typeSpec = clause.childForFieldName("typeSpecifier");
        const decl1 = clause.childForFieldName("componentDeclaration");
        const decl = decl1?.childForFieldName("declaration");
        const ident = decl?.childForFieldName("identifier");
        const modNode = decl?.childForFieldName("modification");

        const name = ident ? ident.text : "";
        const nameRange = ident ? ([ident.startIndex, ident.endIndex] as const) : undefined;
        const typeName = typeSpec ? typeSpec.text : "";
        const nested = parseModArgsFromCst(modNode, scopeId);

        args.push({
          name,
          nameRange,
          each: false,
          final: false,
          isRedeclaration: true,
          redeclaredTypeSpecifier: typeName,
          nestedArgs: nested.args,
          value: nested.bindingExpression,
          evaluationScopeId: scopeId,
        });
      } else {
        const shortClass = n.childForFieldName("shortClassDefinition");
        if (shortClass) {
          const ident = shortClass.childForFieldName("identifier");
          const typeSpec = shortClass.childForFieldName("typeSpecifier");
          const name = ident ? ident.text : "";
          const typeName = typeSpec ? typeSpec.text : "";

          args.push({
            name,
            each: false,
            final: false,
            isRedeclaration: true,
            redeclaredTypeSpecifier: typeName,
            nestedArgs: [],
            value: null,
            evaluationScopeId: scopeId,
          });
        }
      }
      return;
    }
    if (n.type === "ModificationExpression") return;
    for (const child of n.children) walk(child);
  };
  walk(node);

  let bindingExpression = null;
  if (node.type === "Modification" || node.type === "ElementModification") {
    const expr = node.childForFieldName("modificationExpression");
    if (expr) bindingExpression = { kind: "expression", cstBytes: [expr.startIndex, expr.endIndex], text: expr.text };
  }

  return { args, bindingExpression, evaluationScopeId: scopeId };
}

const BUILTIN_MODELICA_NAMES = new Set([
  // Independent variable
  "time",
  // Built-in operators
  "der",
  "pre",
  "edge",
  "change",
  "reinit",
  "initial",
  "terminal",
  "sample",
  "noEvent",
  "smooth",
  "delay",
  "cardinality",
  "inStream",
  "actualStream",
  // Synchronous Language Elements
  "Clock",
  "hold",
  "previous",
  "backSample",
  "shiftSample",
  "subSample",
  "superSample",
  "noClock",
  "interval",
  "initialState",
  "activeState",
  "ticksInState",
  "timeInState",
  "transition",
  // Assertions / utilities
  "assert",
  "print",
  "terminate",
  // Mathematical functions
  "abs",
  "sign",
  "sqrt",
  "exp",
  "log",
  "log10",
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
  "floor",
  "ceil",
  "integer",
  "mod",
  "rem",
  "div",
  // Array / reduction functions
  "max",
  "min",
  "sum",
  "product",
  "ndims",
  "size",
  "zeros",
  "ones",
  "fill",
  "identity",
  "diagonal",
  "transpose",
  "cat",
  "scalar",
  "vector",
  "matrix",
  "cross",
  "skew",
  "outerProduct",
  "symmetric",
  // Type names
  "String",
  "Integer",
  "Boolean",
  "Real",
  // Modelica package
  "Modelica",
  // Enumerations
  "enumeration",
  // Scripting API
  "simulate",
]);

// ---------------------------------------------------------------------------
// Helper combinators (mirrors grammar.js utility functions)
// ---------------------------------------------------------------------------

/** Match zero or more rules delimited by a separator. */
function commaSep(rule: Rule, sep: Rule = ","): Rule {
  return optional(commaSep1(rule, sep));
}

/** Match one or more rules delimited by a separator. */
function commaSep1(rule: Rule, sep: Rule = ","): Rule {
  return seq(rule, repeat(seq(sep, rule)));
}

/** Unary expression template: operator operand. */
function unaryExp(operator: Rule, operand: Rule): Rule {
  return seq(field("operator", operator), field("operand", operand));
}

/** Binary expression template: operand1 operator operand2. */
function binaryExp(operator: Rule, operand1: Rule, operand2: Rule): Rule {
  return seq(field("operand1", operand1), field("operator", operator), field("operand2", operand2));
}

/**
 * Split a string on top-level commas (ignoring commas inside parentheses).
 * Used for parsing class modification argument lists.
 */
function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")") depth--;
    else if (text[i] === "," && depth === 0) {
      parts.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  const last = text.slice(start).trim();
  if (last) parts.push(last);
  return parts;
}

export interface ScopeData {
  directByName: Record<string, SymbolId>;
  qualifiedImports: Record<string, string>;
  unqualifiedImportPkgs: string[];
  compoundImports: Array<{ pkg: string; names: string[] }>;
  isEncapsulated: boolean;
  parentId: SymbolId | null;
  id: SymbolId;
}

export function getScopeData(db: QueryDB, self: SymbolEntry): ScopeData {
  const baseId = db.baseOf(self.id);
  const sourceId = baseId ?? self.id;
  const children = db.childrenOf(sourceId);

  const directByName: Record<string, SymbolId> = {};
  const qualifiedImports: Record<string, string> = {};
  const unqualifiedImportPkgs: string[] = [];
  const compoundImports: Array<{ pkg: string; names: string[] }> = [];

  for (const child of children) {
    if (child.kind === "Class" || child.kind === "Component") {
      directByName[child.name] = child.id;
    }

    if (child.kind === "Import") {
      const meta = child.metadata as Record<string, unknown>;
      const importKind =
        (meta?.importKind as string | undefined) ??
        (child.ruleName === "UnqualifiedImportClause"
          ? "unqualified"
          : child.ruleName === "CompoundImportClause"
            ? "compound"
            : "simple");
      const pkgName = (meta?.packageName ?? child.name) as string;

      if (importKind === "simple") {
        const shortName = (meta?.shortName as string) ?? pkgName.split(".").pop() ?? pkgName;
        qualifiedImports[shortName] = pkgName;
      } else if (importKind === "unqualified") {
        unqualifiedImportPkgs.push(pkgName);
      } else if (importKind === "compound") {
        const importNames = db
          .childrenOfField(child.id, "importName")
          .map((c) => c.name)
          .filter(Boolean);
        compoundImports.push({ pkg: pkgName, names: importNames });
      }
    }
  }

  const isEncapsulated = !!(self.metadata as Record<string, unknown>)?.encapsulated;

  return {
    directByName,
    qualifiedImports,
    unqualifiedImportPkgs,
    compoundImports,
    isEncapsulated,
    parentId: self.parentId,
    id: self.id,
  };
}

export function mergeInto(target: Record<string, SymbolId>, source: Record<string, SymbolId>) {
  for (const [key, value] of Object.entries(source)) {
    if (!(key in target)) {
      target[key] = value;
    }
  }
}

export function resolveSimpleNameHelper(
  db: QueryDB,
  classId: SymbolId,
  name: string,
  encapsulated = false,
  skipInherited = false,
): SymbolEntry | null {
  const unspecializedId = db.baseOf(classId) ?? classId;
  const scope = db.query<ScopeData | null>("scopeData", unspecializedId);
  if (!scope) return null;

  // 1. Direct elements
  const directId = scope.directByName[name];
  if (directId !== undefined) return db.symbol(directId);

  // 2. Inherited elements
  if (!skipInherited) {
    const inheritedMap = db.query<Record<string, SymbolId> | null>("inheritedSymbolsMap", unspecializedId);
    const inheritedId = inheritedMap?.[name];
    if (inheritedId !== undefined) return db.symbol(inheritedId);
  }

  // 2.5. Short class target
  if (!skipInherited) {
    const self = db.symbol(classId);
    const meta = self?.metadata as Record<string, unknown>;
    if (self && !meta?.isPredefined) {
      const cst = db.cstNode(classId) as any;
      const classSpecifier = cst?.childForFieldName?.("classSpecifier");
      if (classSpecifier?.type === "ShortClassSpecifier") {
        const typeSpec = classSpecifier.childForFieldName?.("typeSpecifier");
        const typeName = typeSpec?.text;
        if (typeName && self.parentId !== null) {
          const parentResolver = db.query<(n: string) => { id: SymbolId } | null>("resolveName", self.parentId);
          if (parentResolver) {
            const resolved = parentResolver(typeName);
            if (resolved?.id && resolved.id !== classId) {
              const found = resolveSimpleNameHelper(db, resolved.id, name, encapsulated, skipInherited);
              if (found) return found;
            }
          }
        }
      }
    }
  }

  // 3. Qualified imports
  const qualPkg = scope.qualifiedImports[name];
  if (qualPkg) {
    return resolveQualified(db, qualPkg);
  }

  // Helper to resolve an import path, respecting local aliases for the first segment
  const resolveImportPath = (pathStr: string): SymbolEntry | null => {
    const parts = pathStr.split(".");
    const first = parts[0];
    const aliasTarget = scope.qualifiedImports[first!];
    if (aliasTarget) {
      const fullPath = [aliasTarget, ...parts.slice(1)].join(".");
      return resolveQualified(db, fullPath);
    } else {
      return resolveQualified(db, pathStr);
    }
  };

  // 4. Compound imports
  for (const ci of scope.compoundImports) {
    if (ci.names.includes(name)) {
      const pkgEntry = resolveImportPath(ci.pkg);
      if (pkgEntry) {
        const foundEntry = db.childrenOf(pkgEntry.id).find((c) => c.name === name && c.kind !== "Reference");
        if (foundEntry) return foundEntry;
      }
    }
  }

  // 5. Unqualified imports
  for (const pkg of scope.unqualifiedImportPkgs) {
    const pkgEntry = resolveImportPath(pkg);
    if (pkgEntry) {
      for (const pkgChild of db.childrenOf(pkgEntry.id)) {
        if (pkgChild.name === name && pkgChild.kind !== "Reference") return pkgChild;
      }
    }
  }

  // 6. Parent scope walk (unless encapsulated)
  if (!encapsulated && !scope.isEncapsulated && scope.parentId !== null && scope.parentId !== unspecializedId) {
    const parentEntry = db.symbol(scope.parentId);
    if (parentEntry && (parentEntry.kind === "Class" || parentEntry.kind === "Package")) {
      const found = resolveSimpleNameHelper(db, parentEntry.id, name, false, skipInherited);
      if (found) return found;
    }
  }

  // 7. Predefined types fallback
  const predefined = db.byName(name);
  return predefined?.find((e) => e.kind === "Class" || e.kind === "Package" || e.kind === "Function") ?? null;
}

/**
 * Resolves a dot-separated path from the global scope.
 * Used for resolving import targets and global fallbacks.
 */
function resolveQualified(db: QueryDB, path: string): SymbolEntry | null {
  const parts = path.split(".");
  if (parts.length === 0) return null;

  // Try to find the root part (entry with no parent)
  const rootEntries = db.byName(parts[0]!);
  let current =
    rootEntries.find((e) => (e.metadata as any)?.isPredefined) ??
    rootEntries.find((e) => e.parentId === null) ??
    rootEntries[0] ??
    null;

  if (!current) return null;

  for (let i = 1; i < parts.length; i++) {
    const part = parts[i]!;
    const children = db.childrenOf(current.id);
    // Prefer non-reference entries (Class, Component) over Reference entries
    current =
      children.find((c) => c.name === part && c.kind !== "Reference") || children.find((c) => c.name === part) || null;
    if (!current) return null;
  }

  return current;
}

// Stacks for tracking dimension evaluation and queries to detect cycles
interface DimensionStackFrame {
  symbolId: SymbolId;
  dimIndex: number;
  exprText: string;
}

interface ActiveDimQuery {
  symbolId: SymbolId;
  dimIndex: number;
}

let evaluatingDimensionsStack: DimensionStackFrame[] = [];
let activeDimQueriesStack: ActiveDimQuery[] = [];
const cyclicDimensionDiagnostics = new Map<SymbolId, Array<{ dimIndex: number; exprText: string }>>();
let activeQueryDB: QueryDB | null = null;

function addCyclicDiagnostic(symbolId: SymbolId, dimIndex: number, exprText: string) {
  let list = cyclicDimensionDiagnostics.get(symbolId);
  if (!list) {
    list = [];
    cyclicDimensionDiagnostics.set(symbolId, list);
  }
  if (!list.some((d) => d.dimIndex === dimIndex)) {
    list.push({ dimIndex, exprText });
  }
}

// ---------------------------------------------------------------------------
// Dimension Expression Evaluator (for resolvedArrayDimensions Salsa query)
// ---------------------------------------------------------------------------

/**
 * Evaluate a dimension expression to a concrete integer value.
 *
 * Walks the CST node for the expression and evaluates it in the Salsa
 * query context. Supports:
 *   - Integer literals
 *   - Name references to parameters/constants (reads their binding value)
 *   - size(x, d) calls → recursively queries resolvedArrayDimensions (cycle-safe)
 *   - Basic arithmetic (+, -, *, integer(), ndims())
 *   - Enumeration type references (returns literal count)
 *
 * Returns null if the expression cannot be statically evaluated.
 */
function evaluateDimExpr(
  db: QueryDB,
  self: SymbolEntry,
  dim: { kind: "expression"; cstBytes: readonly [number, number]; text?: string },
): number | null {
  // Try to get the CST node for this expression
  const cst = db.cstNodeRange(dim.cstBytes[0], dim.cstBytes[1], self) as any;
  if (!cst) {
    // Fallback: try to parse the text directly as an integer
    if (dim.text) {
      const parsed = parseInt(dim.text, 10);
      if (!isNaN(parsed) && String(parsed) === dim.text.trim()) return parsed;
    }
    return null;
  }
  return evaluateDimCSTNode(db, self, cst);
}

/**
 * Recursively evaluate a CST node to an integer value in a Salsa context.
 */
function evaluateDimCSTNode(db: QueryDB, self: SymbolEntry, node: any): number | null {
  if (!node) return null;
  const type = node.type;

  // Integer literal
  if (type === "UNSIGNED_INTEGER") {
    return parseInt(node.text, 10);
  }

  // Parenthesized expression — unwrap
  if (type === "ParenthesizedExpression") {
    const inner = node.childForFieldName("expression");
    return evaluateDimCSTNode(db, self, inner);
  }

  // Binary expression (a + b, a * b, a - b)
  if (type === "BinaryExpression") {
    const op1 = node.childForFieldName("operand1");
    const op = node.childForFieldName("operator");
    const op2 = node.childForFieldName("operand2");
    const left = evaluateDimCSTNode(db, self, op1);
    const right = evaluateDimCSTNode(db, self, op2);
    if (left === null || right === null) return null;
    const opText = op?.text;
    if (opText === "+") return left + right;
    if (opText === "-") return left - right;
    if (opText === "*") return left * right;
    if (opText === "/") return right !== 0 ? Math.floor(left / right) : null;
    if (opText === "^") return Math.pow(left, right);
    return null;
  }

  // Unary expression (-a, +a)
  if (type === "UnaryExpression") {
    const op = node.childForFieldName("operator");
    const operand = node.childForFieldName("operand");
    const val = evaluateDimCSTNode(db, self, operand);
    if (val === null) return null;
    return op?.text === "-" ? -val : val;
  }

  // Function call — handle size(), integer(), ndims()
  if (type === "FunctionCall") {
    const funcRef = node.childForFieldName("functionReference");
    const funcName = funcRef?.text;

    if (funcName === "size") {
      return evaluateDimSizeCall(db, self, node);
    }
    if (funcName === "integer") {
      // integer(expr) — evaluate the inner expression
      const args = node.childForFieldName("functionCallArguments");
      const firstArg = args?.namedChildren?.find((c: any) => c.type !== "(" && c.type !== ")" && c.type !== ",");
      return evaluateDimCSTNode(db, self, firstArg);
    }
    if (funcName === "ndims") {
      return evaluateDimNdimsCall(db, self, node);
    }
    return null;
  }

  // Component reference — resolve to a parameter/constant value
  if (type === "ComponentReference" || type === "ComponentReferencePart") {
    const refText = node.text;
    if (!refText) return null;
    return evaluateDimNameRef(db, self, refText);
  }

  // Name — sometimes dimension expressions are just names
  if (type === "Name") {
    return evaluateDimNameRef(db, self, node.text);
  }

  // If the node is a simple text that looks like an integer
  if (node.text) {
    const parsed = parseInt(node.text, 10);
    if (!isNaN(parsed) && String(parsed) === node.text.trim()) return parsed;
  }

  return null;
}

/**
 * Helper to safely get or evaluate a single dimension index of a component.
 * If the component is already on evaluatingDimensionsStack, we evaluate only
 * the requested dimension index directly (bypassing the Salsa query for the component
 * as a whole) to avoid false-positive circular dependency detections in Salsa.
 */
function getOrEvaluateSingleDimension(db: QueryDB, resolved: SymbolEntry, idx: number): number | null {
  const isCurrentlyEvaluating = evaluatingDimensionsStack.some((f) => f.symbolId === resolved.id);
  if (!isCurrentlyEvaluating) {
    const resolvedDims = db.query<number[] | null>("resolvedArrayDimensions", resolved.id);
    return resolvedDims ? (resolvedDims[idx] ?? null) : null;
  }

  // Fallback: evaluate only the requested dimension index directly to avoid false cycles
  const rawDims = db.query<Array<
    | { kind: "literal"; value: number }
    | { kind: "flexible" }
    | { kind: "expression"; cstBytes: readonly [number, number]; text?: string }
  > | null>("arrayDimensions", resolved.id);
  if (!rawDims || idx < 0 || idx >= rawDims.length) return null;

  const dim = rawDims[idx];
  if (dim.kind === "literal") {
    return dim.value;
  } else if (dim.kind === "flexible") {
    return 0;
  } else if (dim.kind === "expression") {
    const isEvaluatingThisDim = evaluatingDimensionsStack.some((f) => f.symbolId === resolved.id && f.dimIndex === idx);
    if (isEvaluatingThisDim) {
      // Actual cycle detected! Report it.
      const frame = evaluatingDimensionsStack[evaluatingDimensionsStack.length - 1];
      if (frame) {
        addCyclicDiagnostic(frame.symbolId, frame.dimIndex, frame.exprText);
      } else {
        addCyclicDiagnostic(resolved.id, idx, dim.text ?? "?");
      }
      return null;
    }
    evaluatingDimensionsStack.push({
      symbolId: resolved.id,
      dimIndex: idx,
      exprText: dim.text ?? "?",
    });
    let value: number | null = null;
    try {
      value = evaluateDimExpr(db, resolved, dim);
    } finally {
      evaluatingDimensionsStack.pop();
    }
    return value;
  }
  return null;
}

/**
 * Helper to get the number of dimensions (ndims) of a component.
 */
function getOrEvaluateNdims(db: QueryDB, resolved: SymbolEntry): number | null {
  const rawDims = db.query<Array<
    | { kind: "literal"; value: number }
    | { kind: "flexible" }
    | { kind: "expression"; cstBytes: readonly [number, number]; text?: string }
  > | null>("arrayDimensions", resolved.id);
  return rawDims?.length ?? null;
}

/**
 * Evaluate a `size(x, d)` call in a dimension context.
 */
function evaluateDimSizeCall(db: QueryDB, self: SymbolEntry, node: any): number | null {
  const args = node.childForFieldName("functionCallArguments");
  if (!args) return null;

  // Extract the two arguments: size(arrayRef, dimIndex)
  const argNodes = args.namedChildren?.filter((c: any) => c.type !== "(" && c.type !== ")" && c.type !== ",") ?? [];

  if (argNodes.length < 2) return null;

  const arrayRefNode = argNodes[0];
  const dimArgNode = argNodes[1];
  const dimIndex = evaluateDimCSTNode(db, self, dimArgNode);
  if (dimIndex === null) return null;

  // Resolve the array reference to a symbol
  const refName = arrayRefNode?.text;
  if (!refName) return null;

  // Find the component in the parent scope
  const parentId = self.parentId;
  if (parentId === null) return null;

  const resolver = db.query<((name: string) => SymbolEntry | null) | null>("resolveSimpleName", parentId);
  if (!resolver) return null;

  // Handle dot-separated references (e.g., pkg.x)
  const parts = refName.split(".");
  let resolved = resolver(parts[0]!);
  for (let i = 1; i < parts.length && resolved; i++) {
    const subResolver = db.query<((name: string) => SymbolEntry | null) | null>("resolveSimpleName", resolved.id);
    if (!subResolver) {
      resolved = null;
      break;
    }
    resolved = subResolver(parts[i]!);
  }

  if (!resolved) return null;

  activeDimQueriesStack.push({ symbolId: resolved.id, dimIndex: dimIndex - 1 });
  try {
    return getOrEvaluateSingleDimension(db, resolved, dimIndex - 1);
  } finally {
    activeDimQueriesStack.pop();
  }
}

/**
 * Evaluate an `ndims(x)` call in a dimension context.
 */
function evaluateDimNdimsCall(db: QueryDB, self: SymbolEntry, node: any): number | null {
  const args = node.childForFieldName("functionCallArguments");
  if (!args) return null;

  const argNodes = args.namedChildren?.filter((c: any) => c.type !== "(" && c.type !== ")" && c.type !== ",") ?? [];

  if (argNodes.length < 1) return null;

  const refName = argNodes[0]?.text;
  if (!refName) return null;

  const parentId = self.parentId;
  if (parentId === null) return null;

  const resolver = db.query<((name: string) => SymbolEntry | null) | null>("resolveSimpleName", parentId);
  if (!resolver) return null;
  const resolved = resolver(refName);
  if (!resolved) return null;

  activeDimQueriesStack.push({ symbolId: resolved.id, dimIndex: 0 });
  try {
    return getOrEvaluateNdims(db, resolved);
  } finally {
    activeDimQueriesStack.pop();
  }
}

/**
 * Resolve a name reference (e.g., `n`, `N`, `pkg.n`) to an integer value.
 *
 * Looks up the symbol and reads its binding value if it's a parameter or constant.
 */
function evaluateDimNameRef(db: QueryDB, self: SymbolEntry, name: string): number | null {
  const parentId = self.parentId;
  if (parentId === null) return null;

  const resolver = db.query<((name: string) => SymbolEntry | null) | null>("resolveSimpleName", parentId);
  if (!resolver) return null;

  // Handle dot-separated names
  const parts = name.split(".");
  let resolved = resolver(parts[0]!);
  for (let i = 1; i < parts.length && resolved; i++) {
    const subResolver = db.query<((name: string) => SymbolEntry | null) | null>("resolveSimpleName", resolved.id);
    if (!subResolver) {
      resolved = null;
      break;
    }
    resolved = subResolver(parts[i]!);
  }
  if (!resolved) return null;

  // Check if it's an enumeration type (return literal count)
  if (resolved.kind === "Class") {
    const meta = resolved.metadata as Record<string, unknown>;
    const classPrefixes = meta?.classPrefixes;
    if (typeof classPrefixes === "string" && classPrefixes.includes("enumeration")) {
      const children = db.childrenOf(resolved.id);
      return children.filter((c) => c.kind === "Component").length;
    }
  }

  // Must be a parameter or constant with an integer binding
  if (resolved.kind !== "Component") return null;
  const meta = resolved.metadata as Record<string, unknown>;
  const variability = meta?.variability;
  if (variability !== "parameter" && variability !== "constant") return null;

  // Try to read the binding value from the modification
  const mod = db.query<any>("effectiveModification", resolved.id);
  if (mod?.bindingExpression?.text) {
    const val = parseInt(mod.bindingExpression.text, 10);
    if (!isNaN(val) && String(val) === mod.bindingExpression.text.trim()) return val;
    // If it's not a plain integer, try to get the CST and evaluate
    if (mod.bindingExpression.cstBytes) {
      const exprCst = db.cstNodeRange(
        mod.bindingExpression.cstBytes[0],
        mod.bindingExpression.cstBytes[1],
        resolved,
      ) as any;
      if (exprCst) {
        evaluatingDimensionsStack.push({
          symbolId: resolved.id,
          dimIndex: -1,
          exprText: mod.bindingExpression.text,
        });
        try {
          return evaluateDimCSTNode(db, resolved, exprCst);
        } finally {
          evaluatingDimensionsStack.pop();
        }
      }
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Precedence constants (matching grammar.js)
// ---------------------------------------------------------------------------

const PREC = {
  LOGICAL_OR: 4,
  LOGICAL_AND: 5,
  UNARY_NEGATION: 6,
  RELATIONAL: 7,
  ADDITIVE: 8,
  ADDITIVE_UNARY: 9,
  MULTIPLICATIVE: 10,
  EXPONENTIATION: 11,
} as const;

// ---------------------------------------------------------------------------
// Language Definition
// ---------------------------------------------------------------------------

export default language({
  name: "modelica",

  extras: ($) => [/\s/, $.BLOCK_COMMENT, $.LINE_COMMENT],

  conflicts: ($) => [
    [$.Name],
    [$.EquationSection],
    [$.ElseIfEquationClause],
    [$.ElseWhenEquationClause],
    [$.ElementSection],
    [$.InitialElementSection],
    [$.AlgorithmSection],
    [$.ConstraintSection],
    [$.Name, $.ComponentReferencePart],
  ],

  word: ($) => $.IDENT,

  rules: {
    // =====================================================================
    // §A.2.1 — Stored Definition
    // =====================================================================

    StoredDefinition: ($) =>
      seq(
        optional($.BOM),
        optional(field("withinDirective", $.WithinDirective)),
        repeat(
          choice(
            field("classDefinition", $.ClassDefinition),
            field("componentClause", $.ComponentClause),
            field("statement", $._Statement),
          ),
        ),
      ),

    WithinDirective: ($) => seq("within", optional(field("packageName", $.Name)), ";"),

    // =====================================================================
    // §A.2.2 — Class Definition
    // =====================================================================

    ClassDefinition: ($) =>
      def({
        syntax: seq(
          optional(field("redeclare", "redeclare")),
          optional(field("final", "final")),
          optional(field("inner", "inner")),
          optional(field("outer", "outer")),
          optional(field("replaceable", "replaceable")),
          optional(field("encapsulated", "encapsulated")),
          field("classPrefixes", $.ClassPrefixes),
          field("classSpecifier", $._ClassSpecifier),
          optional(field("constrainingClause", $.ConstrainingClause)),
          ";",
        ),
        i18n: {
          scope: (self) => {
            const spec = self.childForFieldName("classSpecifier");
            return spec?.childForFieldName("identifier")?.text ?? null;
          },
          extract: (db, self) => {
            const results = [];
            const spec = self.childForFieldName("classSpecifier");

            // 1. Extract class name
            const nameNode = spec?.childForFieldName("identifier");
            if (nameNode?.text) {
              results.push({ msgid: nameNode.text });
            }

            // 2. Extract description
            const descNode = spec?.childForFieldName("description");
            if (descNode) {
              const parts = [];
              for (const child of descNode.children) {
                if (child.text && child.text !== "+") {
                  parts.push(child.text);
                }
              }
              const desc = parts.map((s) => (s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s)).join(" ");
              if (desc) {
                results.push({ msgid: desc });
              }
            }

            // 3. Extract annotation Documentation(info="...", revisions="...")
            const ann = self.childForFieldName("annotationClause");
            if (ann) {
              const classMod = ann.childForFieldName("classModification");
              if (classMod) {
                for (const arg of classMod.children) {
                  if (arg.type === "ElementModification") {
                    const argName = arg.childForFieldName("name")?.text;
                    if (argName === "Documentation") {
                      const mod = arg.childForFieldName("modification")?.childForFieldName("classModification");
                      if (mod) {
                        for (const docArg of mod.children) {
                          if (docArg.type === "ElementModification") {
                            const docArgName = docArg.childForFieldName("name")?.text;
                            if (docArgName === "info" || docArgName === "revisions") {
                              const val = docArg
                                .childForFieldName("modification")
                                ?.childForFieldName("modificationExpression")
                                ?.childForFieldName("expression");
                              if (val && val.text) {
                                results.push({ msgid: val.text });
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }

            // 4. Extract enumeration literals (if ShortClassSpecifier)
            if (spec && spec.type === "ShortClassSpecifier") {
              const enumNode = spec.childForFieldName("enumeration");
              if (enumNode) {
                for (const child of spec.children) {
                  if (child.type === "EnumerationLiteral") {
                    const litName = child.childForFieldName("identifier")?.text;
                    if (litName) {
                      results.push({ msgid: litName });
                    }
                    const litDesc = child.childForFieldName("description");
                    if (litDesc) {
                      const parts = [];
                      for (const sChild of litDesc.children) {
                        if (sChild.text && sChild.text !== "+") {
                          parts.push(sChild.text);
                        }
                      }
                      const desc = parts
                        .map((s) => (s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s))
                        .join(" ");
                      if (desc) {
                        results.push({ msgid: desc });
                      }
                    }
                  }
                }
              }
            }

            return results;
          },
        },
        symbol: (self) => {
          return {
            kind: "Class",
            name: self.classSpecifier!.identifier,
            exports: self.classSpecifier?.identifier ? [self.classSpecifier.identifier] : [],
            inherits: self.classSpecifier?.identifier ? [self.classSpecifier.identifier] : [],
            attributes: {
              classPrefixes: self.classPrefixes,
              redeclare: self.redeclare,
              final: self.final,
              inner: self.inner,
              outer: self.outer,
              replaceable: self.replaceable,
              encapsulated: self.encapsulated,
              annotationClause: (self.classSpecifier as any).annotationClause,
              endIdentifier: (self as any).classSpecifier.endIdentifier,
            },
          };
        },
        queries: {
          /** All direct children of this class. */
          members: (db, self) => db.childrenOf(self.id),
          /** Extract array dimensions for ShortClassSpecifiers like type ArrayType = Real[3]; */
          arrayDimensions: (db, self) => {
            const cst = db.cstNode(self.id) as import("@modelscript/compiler/symbol-indexer").CSTNode | null;
            if (!cst) return null;
            const classSpec = cst.childForFieldName("classSpecifier");
            if (!classSpec || classSpec.type !== "ShortClassSpecifier") return null;
            const arraySubNode = classSpec.childForFieldName("arraySubscripts");
            if (!arraySubNode) return null;

            const subscripts: Array<
              | { kind: "literal"; value: number }
              | { kind: "flexible" }
              | { kind: "expression"; cstBytes: readonly [number, number]; text?: string }
            > = [];

            for (const child of arraySubNode.children) {
              if (child.type !== "Subscript") continue;
              const flexChild = child.childForFieldName("flexible");
              if (flexChild) {
                subscripts.push({ kind: "flexible" });
                continue;
              }
              const exprChild = child.childForFieldName("expression");
              if (exprChild) {
                if (exprChild.type === "UNSIGNED_INTEGER") {
                  subscripts.push({ kind: "literal", value: parseInt(exprChild.text, 10) });
                } else {
                  subscripts.push({
                    kind: "expression",
                    cstBytes: [exprChild.startIndex, exprChild.endIndex],
                    text: exprChild.text,
                  });
                }
              }
            }
            return subscripts;
          },
          /** Only nested class definitions. */
          nestedClasses: (db, self) => db.childrenOf(self.id).filter((c) => c.kind === "Class"),
          /** Only component declarations. */
          components: (db, self) => db.childrenOf(self.id).filter((c) => c.kind === "Component"),
          /** Only extends clauses. */
          extendsClasses: (db, self) => db.childrenOf(self.id).filter((c) => c.kind === "Extends"),
          /** Only import clauses. */
          imports: (db, self) => db.childrenOf(self.id).filter((c) => c.kind === "Import"),
          /** Components with causality=input. */
          inputParameters: (db, self) =>
            db
              .childrenOf(self.id)
              .filter((c) => c.kind === "Component" && (c.metadata as Record<string, unknown>)?.causality === "input"),
          /** Components with causality=output. */
          outputParameters: (db, self) =>
            db
              .childrenOf(self.id)
              .filter((c) => c.kind === "Component" && (c.metadata as Record<string, unknown>)?.causality === "output"),
          /** Components with variability=parameter. */
          parameters: (db, self) =>
            db
              .childrenOf(self.id)
              .filter(
                (c) => c.kind === "Component" && (c.metadata as Record<string, unknown>)?.variability === "parameter",
              ),
          /** Components with variability=constant. */
          constants: (db, self) =>
            db
              .childrenOf(self.id)
              .filter(
                (c) => c.kind === "Component" && (c.metadata as Record<string, unknown>)?.variability === "constant",
              ),
          /** Connect equations among children. */
          connectEquations: (db, self) => db.childrenOf(self.id).filter((c) => c.kind === "ConnectEquation"),
          /**
           * All elements including inherited members (flattened).
           *
           * Implements the core of the Modelica instantiation algorithm:
           * 1. Collect declared elements from the class body
           * 2. For each extends clause, resolve the base class and inline its elements
           * 3. Filter out elements that have been redeclared in the body
           * 4. Filter out elements removed via `break` in extends clauses
           *
           * Uses cycle recovery to handle circular extends chains.
           */
          allElements: {
            execute: (db: QueryDB, self: SymbolEntry) => {
              const visited = new Set<SymbolId>([self.id]);
              const result: SymbolEntry[] = [];

              // Collect names of body-level redeclare elements
              const redeclaredNames = new Set<string>();
              const brokenNames = new Set<string>();
              const children = db.childrenOf(self.id);

              for (const child of children) {
                if (child.kind === "Component" && (child.metadata as Record<string, unknown>)?.redeclare) {
                  redeclaredNames.add(child.name);
                }
                if (child.kind === "Class" && (child.metadata as Record<string, unknown>)?.redeclare) {
                  redeclaredNames.add(child.name);
                }
              }

              // Inline extends at their declaration order
              for (const child of children) {
                if (child.kind === "Extends") {
                  // Resolve the base class
                  const baseName = child.name;
                  const baseEntries = db.byName(baseName);
                  const baseClass = baseEntries?.[0];
                  if (baseClass && !visited.has(baseClass.id)) {
                    visited.add(baseClass.id);
                    // Recursively get all elements of the base class
                    const baseElements = db.childrenOf(baseClass.id);
                    for (const inherited of baseElements) {
                      if (inherited.name && !redeclaredNames.has(inherited.name) && !brokenNames.has(inherited.name)) {
                        result.push(inherited);
                      }
                    }
                  }
                } else {
                  result.push(child);
                }
              }

              return result;
            },
            recovery: () => [],
          },
          /**
           * Check if this class is a connector type.
           */
          isConnector: (db: QueryDB, self: SymbolEntry) => {
            const kind = (self.metadata as Record<string, unknown>)?.classPrefixes;
            return (
              kind === "connector" ||
              kind === "expandable connector" ||
              (typeof kind === "string" && kind.includes("connector"))
            );
          },
          /**
           * Check if this class is an operator record type.
           */
          isOperatorRecord: (db: QueryDB, self: SymbolEntry) => {
            const kind = (self.metadata as Record<string, unknown>)?.classPrefixes;
            return kind === "operator record";
          },
          /**
           * For an `operator record` class, collect all operator functions.
           *
           * Returns a Map from operator name (e.g. "'+'", "'-'", "'*'") to an
           * array of function overloads. Each overload describes input types
           * and the qualified function name for call emission.
           *
           * Structure of each operator class:
           *   operator record C
           *     operator '+'
           *       function self ... end self;
           *       function rightInt ... end rightInt;
           *     end '+';
           *     operator function '+' ... end '+';  // shorthand form
           *   end C;
           */
          operatorFunctions: (db: QueryDB, self: SymbolEntry) => {
            const kind = (self.metadata as Record<string, unknown>)?.classPrefixes;
            if (kind !== "operator record") return null;

            type CSTNode = import("@modelscript/compiler/symbol-indexer").CSTNode;
            const recordName = self.name;

            interface OperatorOverload {
              qualifiedName: string;
              inputTypes: string[];
              outputType: string;
              inputCount: number;
            }

            const result = new Map<string, OperatorOverload[]>();

            const children = db.childrenOf(self.id);
            console.error(`[debug] operatorFunctions for ${self.name}, children count: ${children.length}`);

            // Walk children of the operator record
            for (const child of children) {
              if (child.kind !== "Class") continue;
              const childMeta = child.metadata as Record<string, unknown>;
              const childPrefix = childMeta?.classPrefixes as string | undefined;

              console.error(`[debug] child: ${child.name}, prefix: ${childPrefix}`);

              // Case 1: `operator function '+'` (shorthand — the class IS the function)
              if (childPrefix === "operator function") {
                const opName = child.name; // e.g., "'+'"
                const inputTypes: string[] = [];
                let outputType = "";
                let inputCount = 0;

                // Extract input/output types from function children
                for (const param of db.childrenOf(child.id)) {
                  if (param.kind !== "Component") continue;
                  const pMeta = param.metadata as Record<string, unknown>;
                  const causality = pMeta?.causality as string | undefined;
                  const typeSpec = pMeta?.typeSpecifier as string | undefined;
                  if (causality === "input") {
                    inputTypes.push(typeSpec ?? "Real");
                    inputCount++;
                  } else if (causality === "output") {
                    outputType = typeSpec ?? "Real";
                  }
                }

                const overloads = result.get(opName) ?? [];
                overloads.push({
                  qualifiedName: `${recordName}.${opName}`,
                  inputTypes,
                  outputType,
                  inputCount,
                });
                result.set(opName, overloads);
                continue;
              }

              // Case 2: `operator '+'` containing function children
              if (childPrefix === "operator") {
                const opName = child.name; // e.g., "'+'"

                const funcs = db.childrenOf(child.id);
                console.error(`[debug] found operator ${opName}, funcs count: ${funcs.length}`);

                for (const func of funcs) {
                  console.error(`[debug]   func: ${func.name}, kind: ${func.kind}`);
                  if (func.kind !== "Class") continue;
                  const funcMeta = func.metadata as Record<string, unknown>;
                  const funcPrefix = funcMeta?.classPrefixes as string | undefined;
                  console.error(`[debug]   funcPrefix: ${funcPrefix}`);
                  if (funcPrefix !== "function" && funcPrefix !== "operator function") continue;

                  const inputTypes: string[] = [];
                  let outputType = "";
                  let inputCount = 0;

                  for (const param of db.childrenOf(func.id)) {
                    if (param.kind !== "Component") continue;
                    const pMeta = param.metadata as Record<string, unknown>;
                    const causality = pMeta?.causality as string | undefined;
                    const typeSpec = pMeta?.typeSpecifier as string | undefined;
                    if (causality === "input") {
                      inputTypes.push(typeSpec ?? "Real");
                      inputCount++;
                    } else if (causality === "output") {
                      outputType = typeSpec ?? "Real";
                    }
                  }

                  const overloads = result.get(opName) ?? [];
                  overloads.push({
                    qualifiedName: `${recordName}.${opName}.${func.name}`,
                    inputTypes,
                    outputType,
                    inputCount,
                  });
                  result.set(opName, overloads);
                }
                continue;
              }
            }

            console.error(`[debug] returning result size: ${result.size}`);
            return result.size > 0 ? result : null;
          },
          /**
           * Resolve a modification argument by name from the class's
           * active modification context.
           */
          resolveModification: (db: QueryDB, self: SymbolEntry) => {
            // Modification resolution is context-dependent:
            // the effective modification comes from the instantiation site
            // (outer modification merged with local declaration modifications).
            // In a Salsa query context, we return the metadata-level modification info.
            return (self.metadata as Record<string, unknown>)?.modification ?? null;
          },

          // =================================================================
          // Milestone 2: Scope Resolution (Modelica §5.3)
          // =================================================================

          /**
           * Resolve a simple name in this class's scope.
           *
           * Implements Modelica §5.3 name lookup:
           *   1. Direct elements (class defs, components)
           *   2. Inherited elements (via extends)
           *   3. Qualified imports (import A = B.C.D)
           *   4. Unqualified imports (import B.C.*)
           *   5. Compound imports (import B.C.{D, E})
           *   6. Parent scope walk (unless encapsulated)
           *   7. Predefined types fallback (via db.byName)
           *
           * Returns a resolver function that accepts a name string.
           * This is a "factory query" — it computes the scope once and
           * returns a closure that callers invoke with specific names.
           */
          scopeData: (db: QueryDB, self: SymbolEntry): ScopeData => {
            return getScopeData(db, self);
          },

          /** Precompute inherited symbols mapping (memoized). */
          inheritedSymbolsMap: {
            execute: (db: QueryDB, self: SymbolEntry): Record<string, SymbolId> => {
              const result: Record<string, SymbolId> = {};
              const baseId = db.baseOf(self.id);
              const sourceId = baseId ?? self.id;
              const children = db.childrenOf(sourceId);

              // First walk extends clauses in declaration order
              for (const child of children) {
                if (child.kind === "Extends") {
                  const baseClass = db.query<SymbolEntry | null>("resolvedBaseClass", child.id);
                  if (baseClass) {
                    const baseUnspecializedId = db.baseOf(baseClass.id) ?? baseClass.id;
                    const baseInherited =
                      db.query<Record<string, SymbolId>>("inheritedSymbolsMap", baseUnspecializedId) || {};
                    mergeInto(result, baseInherited);
                    const baseScope = db.query<ScopeData>("scopeData", baseUnspecializedId);
                    if (baseScope) {
                      mergeInto(result, baseScope.directByName);
                    }
                  }
                }
              }

              // Also handle extends in LongClassSpecifier
              const selfCst = db.cstNode(sourceId) as any;
              const spec = selfCst?.childForFieldName?.("classSpecifier");
              if (spec?.type === "LongClassSpecifier") {
                let hasExtends = false;
                for (let i = 0; i < spec.childCount; i++) {
                  if (spec.child(i).type === "extends") {
                    hasExtends = true;
                    break;
                  }
                }
                if (hasExtends) {
                  const identNode = spec.childForFieldName("identifier");
                  if (identNode?.text && self.parentId !== null) {
                    const baseName = identNode.text;
                    const resolveName = db.query<any>("resolveName", self.parentId);
                    if (resolveName) {
                      let resolved = resolveName(baseName, true);
                      if (resolved && resolved.id === self.id) {
                        resolved = null;
                        if (self.parentId !== null && self.parentId !== undefined) {
                          for (const pChild of db.childrenOf(self.parentId)) {
                            if (pChild.kind === "Extends") {
                              const pBase = db.query<any>("resolvedBaseClass", pChild.id);
                              if (pBase) {
                                const pExtResolver = db.query<any>("resolveName", pBase.id);
                                if (pExtResolver) {
                                  const found = pExtResolver(baseName);
                                  if (found && found.id !== self.parentId) {
                                    resolved = found;
                                    break;
                                  }
                                }
                              }
                            }
                          }
                        }
                      }
                      if (resolved && resolved.kind !== "Reference") {
                        const resolvedUnspecializedId = db.baseOf(resolved.id) ?? resolved.id;
                        const baseInherited =
                          db.query<Record<string, SymbolId>>("inheritedSymbolsMap", resolvedUnspecializedId) || {};
                        mergeInto(result, baseInherited);
                        const baseScope = db.query<ScopeData>("scopeData", resolvedUnspecializedId);
                        if (baseScope) {
                          mergeInto(result, baseScope.directByName);
                        }
                      }
                    }
                  }
                }
              }

              return result;
            },
            recovery: () => ({}),
          },

          resolveSimpleName: (db: QueryDB, self: SymbolEntry) => {
            return (name: string, encapsulated = false, skipInherited = false): SymbolEntry | null => {
              return resolveSimpleNameHelper(db, self.id, name, encapsulated, skipInherited);
            };
          },

          /**
           * Resolve a qualified (dot-separated) name from this class's scope.
           *
           * Uses resolveSimpleName for the first part, then navigates
           * into children for each subsequent part.
           */
          resolveName: (db: QueryDB, self: SymbolEntry) => {
            return (qualifiedName: string, skipInherited = false): SymbolEntry | null => {
              const parts = qualifiedName.split(".");
              if (parts.length === 0) return null;

              // Handle fully qualified names (e.g. .Modelica.Math.sin)
              let startIndex = 0;
              let current: SymbolEntry | null = null;
              if (parts[0] === "") {
                if (parts.length < 2) return null;
                current =
                  db
                    .byName(parts[1])
                    ?.find((e) => e.kind === "Class" || e.kind === "Package" || e.kind === "Function") ?? null;
                startIndex = 2;
              } else {
                // Resolve first part via scope resolution
                const resolver = db.query<(n: string, enc?: boolean, skip?: boolean) => SymbolEntry | null>(
                  "resolveSimpleName",
                  self.id,
                );
                current = resolver?.(parts[0]!, false, skipInherited) ?? null;
                startIndex = 1;
              }

              if (!current) return null;

              // Navigate remaining parts
              for (let i = startIndex; i < parts.length; i++) {
                const part = parts[i]!;
                const targetResolver = db.query<(n: string, enc?: boolean, skip?: boolean) => SymbolEntry | null>(
                  "resolveSimpleName",
                  current.id,
                );
                const nextPart = targetResolver?.(part, false, false);
                if (!nextPart) return null;
                current = nextPart;
              }

              return current;
            };
          },

          // =================================================================
          // Milestone 3: Instantiation Query
          // =================================================================

          /**
           * Instantiate this class: resolve all elements, expand extends,
           * and filter redeclarations.
           *
           * This is the central query that replaces ModelicaClassInstance.instantiate().
           *
           * Returns direct children, recursively inlining inherited elements
           * from extends clauses and filtering redeclared names.
           *
           * NOTE: This query no longer creates virtual (specialized) symbols.
           * All modification propagation is handled by the flattener's
           * ModificationStack during flattening. The `outerMod` path is retained
           * only for backward compatibility with semantic-model.ts `clone()`.
           *
           * Returns a list of static (non-virtual) SymbolIds.
           */
          instantiate: {
            execute: (db: QueryDB, self: SymbolEntry) => {
              // Get outer modification (if this is a specialized entry)
              const specArgs = db.argsOf<ModelicaModArgs>(self.id);
              const outerMod: ModelicaModArgs | null = specArgs?.data ?? null;

              // Determine actual children: for specialized entries,
              // use the base symbol's children
              const baseId = db.baseOf(self.id);
              const sourceId = baseId ?? self.id;

              // Handle ShortClassSpecifier aliases
              const selfCstShort = db.cstNode(sourceId) as any;
              const specShort = selfCstShort?.childForFieldName?.("classSpecifier");
              if (specShort?.type === "ShortClassSpecifier") {
                const typeSpec = specShort.childForFieldName?.("typeSpecifier");
                const typeName = typeSpec?.text;
                if (typeName && self.parentId !== null) {
                  const parentResolver = db.query<(n: string) => { id: SymbolId } | null>("resolveName", self.parentId);
                  if (parentResolver) {
                    const resolved = parentResolver(typeName);
                    if (resolved && resolved.id !== self.id) {
                      // Short class alias: instantiate the resolved target directly.
                      // Outer modifications are propagated by the flattener's ModificationStack,
                      // eliminating the need for virtual specialized entries.
                      return db.query<SymbolId[]>("instantiate", resolved.id);
                    }
                  }
                }
              }

              const children = db.childrenOf(sourceId);

              // Pre-scan for body-level redeclares
              const redeclaredNames = new Set<string>();
              for (const child of children) {
                const meta = child.metadata as Record<string, unknown>;
                if (meta?.redeclare) {
                  redeclaredNames.add(child.name);
                }
              }

              const elements: SymbolId[] = [];

              // NEW: handle extends in long class specifier!
              const selfCstExt = db.cstNode(self.id) as any;
              const specExt = selfCstExt?.childForFieldName?.("classSpecifier");
              if (specExt?.type === "LongClassSpecifier") {
                let hasExtends = false;
                for (let i = 0; i < specExt.childCount; i++) {
                  if (specExt.child(i).type === "extends") {
                    hasExtends = true;
                    break;
                  }
                }
                if (hasExtends) {
                  const identNode = specExt.childForFieldName("identifier");
                  if (identNode?.text && self.parentId !== null) {
                    const baseName = identNode.text;
                    const resolveName = db.query<any>("resolveName", self.parentId);
                    if (resolveName) {
                      let resolved = resolveName(baseName, true);
                      if (resolved && resolved.id === self.id) {
                        // Cycle detected, look in parent's inherited classes
                        resolved = null;
                        const grandParentId = db.symbol(self.parentId)?.parentId;
                        if (self.parentId !== null && self.parentId !== undefined) {
                          for (const pChild of db.childrenOf(self.parentId)) {
                            if (pChild.kind === "Extends") {
                              const pBase = db.query<any>("resolvedBaseClass", pChild.id);
                              if (pBase) {
                                const pExtResolver = db.query<any>("resolveName", pBase.id);
                                if (pExtResolver) {
                                  const found = pExtResolver(baseName);
                                  if (found && found.id !== self.parentId) {
                                    resolved = found;
                                    break;
                                  }
                                }
                              }
                            }
                          }
                        }
                      }

                      if (resolved && resolved.kind !== "Reference") {
                        // We found the base class! Let's instantiate it!
                        const baseElements = db.query<any>("instantiate", resolved.id) || [];
                        for (const eid of baseElements) {
                          const entry = db.symbol(eid);
                          if (entry && !redeclaredNames.has(entry.name)) {
                            elements.push(eid);
                          }
                        }
                      }
                    }
                  }
                }
              }

              for (const child of children) {
                if (child.kind === "Component") {
                  // Always use the static component SymbolId.
                  // Outer modifications are resolved by the flattener's ModificationStack,
                  // eliminating the need for virtual specialized component entries.
                  elements.push(child.id);
                } else if (child.kind === "Extends") {
                  // Check for break
                  if (isBroken(outerMod, child.name)) continue;

                  // Resolve the base class
                  const resolveName = db.query<(n: string) => SymbolEntry | null>("resolveName", self.id);
                  let baseClass: SymbolEntry | null | undefined = undefined;
                  if (resolveName) {
                    baseClass = resolveName(child.name);
                  }
                  if (!baseClass) {
                    baseClass = db.byName(child.name)?.find((e) => e.kind === "Class" || e.kind === "Package") ?? null;
                  }

                  if (!baseClass) {
                    // Unresolved extends — skip but still record the extends entry
                    elements.push(child.id);
                    continue;
                  }

                  // Instantiate the base class directly (unmodified).
                  // Extends modifications are propagated by the flattener's ModificationStack,
                  // eliminating the need for virtual specialized base class entries.
                  const baseElements = db.query<SymbolId[]>("instantiate", baseClass.id);

                  // Inline inherited elements, filtering redeclared names
                  for (const eid of baseElements) {
                    const entry = db.symbol(eid);
                    if (entry && !redeclaredNames.has(entry.name)) {
                      elements.push(eid);
                    }
                  }
                } else if (child.kind === "Class") {
                  // Nested class — include local redeclarations and regular classes
                  elements.push(child.id);
                } else if (child.kind === "Import") {
                  // Imports are not instantiated elements but recorded for scope
                  elements.push(child.id);
                } else if (child.kind === "Reference") {
                  // References shouldn't be instantiated as child elements
                  continue;
                } else {
                  // Other children (equations, algorithms, etc.)
                  elements.push(child.id);
                }
              }

              return elements;
            },
            recovery: (_cycle: unknown, _self: SymbolEntry) => [] as SymbolId[],
          },
        },
        model: {
          name: "ClassDefinition",
          specializable: true,
          visitable: true,
          properties: {
            diagnostics: "string[]",
            isPartial: "boolean",
            isEncapsulated: "boolean",
            isReplaceable: "boolean",
            isExpandable: "boolean",
            isFinal: "boolean",
            isRedeclare: "boolean",
          },
          queryTypes: {
            members: "SemanticNode[]",
            nestedClasses: "ClassDefinition[]",
            components: "ComponentDeclaration[]",
            extendsClasses: "ExtendsClause[]",
            imports: "SemanticNode[]",
            inputParameters: "ComponentDeclaration[]",
            outputParameters: "ComponentDeclaration[]",
            parameters: "ComponentDeclaration[]",
            constants: "ComponentDeclaration[]",
            connectEquations: "SemanticNode[]",
            allElements: "SemanticNode[]",
            isConnector: "boolean",
            resolveModification: "unknown",
            scopeData: "unknown",
            inheritedSymbolsMap: "unknown",
            resolveSimpleName: "((name: string, encapsulated?: boolean) => SemanticNode | null)",
            resolveName: "((qualifiedName: string) => SemanticNode | null)",
            instantiate: "SymbolId[]",
          },
        },
        lints: {
          /** Warn if class name starts with lowercase letter. */
          classNamingConvention: (db: QueryDB, self: SymbolEntry) => {
            if (self.name && /^[a-z]/.test(self.name)) {
              // Narrow to the class identifier token
              const cst = db.cstNode(self.id) as any;
              const identNode = cst?.childForFieldName("classSpecifier")?.childForFieldName("identifier");
              if (identNode && typeof identNode.startIndex === "number") {
                return warning(`Class '${self.name}' should start with an uppercase letter`, {
                  startByte: identNode.startIndex,
                  endByte: identNode.endIndex,
                });
              }
              return warning(`Class '${self.name}' should start with an uppercase letter`, { field: "classSpecifier" });
            }
            return null;
          },
          /** Warn if the class body is empty (no members at all). */
          emptyClass: (db: QueryDB, self: SymbolEntry) => {
            if (db.childrenOf(self.id).filter((c: any) => c.kind !== "Reference").length === 0) {
              // Narrow to the class identifier token
              const cst = db.cstNode(self.id) as any;
              const identNode = cst?.childForFieldName("classSpecifier")?.childForFieldName("identifier");
              if (identNode && typeof identNode.startIndex === "number") {
                return info(`Class '${self.name}' has no members`, {
                  startByte: identNode.startIndex,
                  endByte: identNode.endIndex,
                });
              }
              return info(`Class '${self.name}' has no members`);
            }
            return null;
          },
          /** Error if endIdentifier does not match class identifier. */
          identifierMismatch: (db: QueryDB, self: SymbolEntry) => {
            const cst = db.cstNode(self.id) as any;
            if (!cst) return null;
            const classSpec = cst.childForFieldName("classSpecifier");
            if (classSpec) {
              const startId = classSpec.childForFieldName("identifier")?.text;
              const endIdNode = classSpec.childForFieldName("endIdentifier");
              const endId = endIdNode?.text;
              if (startId && endId && startId !== endId) {
                const errors = [];
                const startIdNode = classSpec.childForFieldName("identifier");
                if (startIdNode && typeof startIdNode.startIndex === "number") {
                  errors.push(
                    error(`Class end identifier '${endId}' does not match class name '${startId}'`, {
                      startByte: startIdNode.startIndex,
                      endByte: startIdNode.endIndex,
                    }),
                  );
                }
                if (endIdNode && typeof endIdNode.startIndex === "number") {
                  errors.push(
                    error(`Class end identifier '${endId}' does not match class name '${startId}'`, {
                      startByte: endIdNode.startIndex,
                      endByte: endIdNode.endIndex,
                    }),
                  );
                }
                return errors.length > 0
                  ? errors
                  : error(`Class end identifier '${endId}' does not match class name '${startId}'`);
              }
            }
            return null;
          },
          /** Error if duplicate element names exist in this class. */
          duplicateElement: (db: QueryDB, self: SymbolEntry) => {
            const names = new Set<string>();
            const elements = db.childrenOf(self.id).filter((c: any) => c.id > 0);
            if (elements.length > 5000) return null; // Skip O(N) check for massive classes
            const duplicates = new Set<string>();
            for (const el of elements) {
              if ((el.kind !== "Class" && el.kind !== "Component") || !el.name || BUILTIN_MODELICA_NAMES.has(el.name))
                continue;
              if (names.has(el.name)) {
                duplicates.add(el.name);
              } else {
                names.add(el.name);
              }
            }
            if (duplicates.size > 0) {
              const results = [];
              for (const dup of duplicates) {
                // Narrow to the duplicate element's identifier
                const dupEl = elements.find((e) => e.name === dup && names.has(e.name));
                if (dupEl) {
                  // Try to find the identifier CST node for a narrower range
                  let startByte = dupEl.startByte;
                  let endByte = dupEl.endByte;
                  const cst = db.cstNode(dupEl.id) as any;
                  if (cst) {
                    const identNode =
                      cst.childForFieldName?.("declaration")?.childForFieldName?.("identifier") ??
                      cst.childForFieldName?.("classSpecifier")?.childForFieldName?.("identifier");
                    if (identNode && typeof identNode.startIndex === "number") {
                      startByte = identNode.startIndex;
                      endByte = identNode.endIndex;
                    }
                  }
                  results.push(
                    error(`Duplicate element '${dup}' in class '${self.name}'`, {
                      startByte,
                      endByte,
                    }),
                  );
                } else {
                  results.push(error(`Duplicate element '${dup}' in class '${self.name}'`));
                }
              }
              return results;
            }
            return null;
          },
          /** Function components must not be public unless they are input/output */
          functionPublicVariable: (db: QueryDB, self: SymbolEntry) => {
            const meta = self.metadata as Record<string, unknown>;
            if (meta?.classPrefixes !== "function" && meta?.classPrefixes !== "operator function") return null;

            const results = [];
            for (const el of db.childrenOf(self.id)) {
              if (el.kind === "Component") {
                const causality = db.query<string | null>("causality", el.id);
                const isProtected = db.query<boolean>("isProtected", el.id);
                if (!causality && !isProtected) {
                  const cst = db.cstNode(el.id) as any;
                  let identNode = cst;
                  if (cst?.type === "ComponentDeclaration") {
                    const dNode = cst.childForFieldName("declaration");
                    if (dNode) identNode = dNode.childForFieldName("identifier") || dNode;
                  }
                  // Narrow to the offending component's identifier range
                  results.push(
                    error(`Public variable '${el.name}' in function '${self.name}' must be an input or output`, {
                      startByte: identNode?.startIndex ?? el.startByte,
                      endByte: identNode?.endIndex ?? el.endByte,
                    }),
                  );
                }
              }
            }
            return results.length > 0 ? results : null;
          },
          /** External functions cannot have an algorithm section */
          externalWithAlgorithm: (db: QueryDB, self: SymbolEntry) => {
            const meta = self.metadata as Record<string, unknown>;
            if (meta?.classPrefixes !== "function" && meta?.classPrefixes !== "operator function") return null;

            const cst = db.cstNode(self.id) as any;
            if (!cst) return null;
            const classSpec = cst.childForFieldName("classSpecifier");
            if (!classSpec) return null;

            const hasExternal = !!classSpec.childForFieldName("externalFunctionClause");
            if (!hasExternal) return null;

            let algoNode: any = null;
            for (const child of classSpec.children) {
              if (child.type === "AlgorithmSection") {
                algoNode = child;
                break;
              }
            }

            if (algoNode) {
              // Narrow to the first statement inside the algorithm section, matching OMC
              let targetNode = algoNode;
              for (const c of algoNode.children || []) {
                if (c.type === "algorithm" || c.type === "initial" || c.isNamed === false) continue;
                targetNode = c;
                break;
              }
              if (typeof targetNode.startIndex === "number") {
                return error(`Function '${self.name}' cannot have both an external clause and an algorithm section`, {
                  startByte: targetNode.startIndex,
                  endByte: targetNode.endIndex,
                });
              }
              return error(`Function '${self.name}' cannot have both an external clause and an algorithm section`, {
                field: "classSpecifier",
              });
            }
            return null;
          },
          /** Functions can only contain certain types of variables */
          functionInvalidVarType: (db: QueryDB, self: SymbolEntry) => {
            const meta = self.metadata as Record<string, unknown>;
            if (meta?.classPrefixes !== "function" && meta?.classPrefixes !== "operator function") return null;

            const results = [];
            for (const el of db.childrenOf(self.id)) {
              if (el.kind === "Component") {
                const causality = db.query<string | null>("causality", el.id);
                if (causality) {
                  const typeEntry = db.query<SymbolEntry | null>("resolvedType", el.id);
                  if (typeEntry) {
                    const resMeta = typeEntry.metadata as Record<string, unknown>;
                    const prefix = resMeta?.classPrefixes as string;
                    if (
                      prefix === "model" ||
                      prefix === "block" ||
                      prefix === "connector" ||
                      prefix === "expandable connector"
                    ) {
                      const typeName = db.query<string | null>("typeSpecifier", el.id) ?? "?";
                      const cst = db.cstNode(el.id) as any;
                      let identNode = cst;
                      if (cst?.type === "ComponentDeclaration") {
                        const dNode = cst.childForFieldName("declaration");
                        if (dNode) identNode = dNode.childForFieldName("identifier") || dNode;
                      }
                      // Narrow to the offending component's identifier range
                      results.push(
                        error(
                          `Function '${self.name}' cannot have an input/output variable '${el.name}' of type '${typeName}'`,
                          {
                            startByte: identNode?.startIndex ?? el.startByte,
                            endByte: identNode?.endIndex ?? el.endByte,
                          },
                        ),
                      );
                    }
                  }
                }
              }
            }
            return results.length > 0 ? results : null;
          },
          /** Function input/output variables cannot be protected */
          functionProtectedIo: (db: QueryDB, self: SymbolEntry) => {
            const meta = self.metadata as Record<string, unknown>;
            if (meta?.classPrefixes !== "function" && meta?.classPrefixes !== "operator function") return null;

            const results = [];
            for (const el of db.childrenOf(self.id)) {
              if (el.kind === "Component") {
                const causality = db.query<string | null>("causality", el.id);
                const isProtected = db.query<boolean>("isProtected", el.id);
                if (causality && isProtected) {
                  const cst = db.cstNode(el.id) as any;
                  let identNode = cst;
                  if (cst?.type === "ComponentDeclaration") {
                    const dNode = cst.childForFieldName("declaration");
                    if (dNode) identNode = dNode.childForFieldName("identifier") || dNode;
                  }
                  // Narrow to the offending component's identifier range
                  results.push(
                    error(`Function input/output variable '${el.name}' cannot be protected`, {
                      startByte: identNode?.startIndex ?? el.startByte,
                      endByte: identNode?.endIndex ?? el.endByte,
                    }),
                  );
                }
              }
            }
            return results.length > 0 ? results : null;
          },
          /** Nested when-statements are not allowed */
          nestedWhen: (db: QueryDB, self: SymbolEntry) => {
            const cst = db.cstNode(self.id) as any;
            if (!cst) return null;
            const classSpec = cst.childForFieldName("classSpecifier");
            if (!classSpec) return null;

            const results: any[] = [];
            const walk = (node: any, inWhen: boolean) => {
              if (node.type === "WhenStatement" || node.type === "WhenEquation") {
                if (inWhen) {
                  // Narrow to the nested when-statement/equation node
                  if (typeof node.startIndex === "number") {
                    results.push(
                      error(`Nested when-statements are not allowed`, {
                        startByte: node.startIndex,
                        endByte: node.endIndex,
                      }),
                    );
                  } else {
                    results.push(error(`Nested when-statements are not allowed`, { field: "classSpecifier" }));
                  }
                } else {
                  inWhen = true;
                }
              }
              for (const child of node.children) {
                walk(child, inWhen);
              }
            };

            for (const child of classSpec.children) {
              if (child.type === "AlgorithmSection" || child.type === "EquationSection") {
                walk(child, false);
              }
            }
            return results.length > 0 ? results : null;
          },
          /** Detect literal division by zero */
          divisionByZero: (db: QueryDB, self: SymbolEntry) => {
            const cst = db.cstNode(self.id) as any;
            if (!cst) return null;

            const results: any[] = [];
            const walk = (node: any) => {
              if (node.type === "BinaryExpression") {
                if (node.childForFieldName("operator")?.text === "/") {
                  const op2 = node.childForFieldName("operand2");
                  if (op2 && op2.text && op2.text.trim() === "0") {
                    // Narrow to the binary expression (a / 0)
                    if (typeof node.startIndex === "number") {
                      results.push(
                        error(`Division by zero`, {
                          startByte: node.startIndex,
                          endByte: node.endIndex,
                        }),
                      );
                    } else {
                      results.push(error(`Division by zero`, { field: "classSpecifier" }));
                    }
                  } else if (
                    op2 &&
                    op2.type === "UnaryExpression" &&
                    op2.childForFieldName("operator")?.text === "-" &&
                    op2.childForFieldName("operand")?.text?.trim() === "0"
                  ) {
                    if (typeof node.startIndex === "number") {
                      results.push(
                        error(`Division by zero`, {
                          startByte: node.startIndex,
                          endByte: node.endIndex,
                        }),
                      );
                    } else {
                      results.push(error(`Division by zero`, { field: "classSpecifier" }));
                    }
                  }
                }
              }
              for (const child of node.children) walk(child);
            };

            if (cst) walk(cst);
            return results.length > 0 ? results : null;
          },
          /** Assignment to constant Variables */
          assignmentToConstant: (db: QueryDB, self: SymbolEntry) => {
            const cst = db.cstNode(self.id) as any;
            if (!cst) return null;

            const resolve = db.query<(name: string) => SymbolEntry | null>("resolveSimpleName", self.id);
            if (!resolve) return null;

            const results: any[] = [];
            const walk = (node: any) => {
              if (node.type === "SimpleAssignmentStatement" || node.type === "ComplexAssignmentStatement") {
                const targetNode =
                  node.childForFieldName("target") ||
                  (node.type === "ComplexAssignmentStatement" ? node.childForFieldName("outputExpressionList") : null);

                // For simple assignments checking the main identifier
                if (node.type === "SimpleAssignmentStatement" && targetNode?.type === "ComponentReference") {
                  const refName =
                    targetNode.children.find((c: any) => c.type === "IDENT")?.text ||
                    targetNode.text.split("[")[0].trim();
                  const resolved = resolve(refName);
                  if (resolved) {
                    const meta = resolved.metadata as Record<string, unknown>;
                    if (meta?.variability === "constant") {
                      // Narrow to the assignment target node
                      if (typeof targetNode.startIndex === "number") {
                        results.push(
                          error(`Cannot assign to constant '${targetNode.text}'`, {
                            startByte: targetNode.startIndex,
                            endByte: targetNode.endIndex,
                          }),
                        );
                      } else {
                        results.push(
                          error(`Cannot assign to constant '${targetNode.text}'`, { field: "classSpecifier" }),
                        );
                      }
                    }
                  }
                }
              }
              for (const child of node.children) walk(child);
            };

            for (const child of cst.childForFieldName("classSpecifier")?.children || []) {
              if (child.type === "AlgorithmSection") walk(child);
            }
            return results.length > 0 ? results : null;
          },
          /** For-loop iterator must be 1D */
          forIteratorNot1D: (db: QueryDB, self: SymbolEntry) => {
            const cst = db.cstNode(self.id) as any;
            if (!cst) return null;

            const results: any[] = [];
            const walk = (node: any) => {
              if (node.type === "ForIndex") {
                const expr = node.childForFieldName("expression");
                if (expr && expr.type === "ArrayConstructor") {
                  const list = expr.childForFieldName("expressionList");
                  if (list) {
                    const elements = list.children.filter(
                      (c: any) => c.type === "Expression" || c.type === "ArrayConstructor",
                    );
                    const hasNested = elements.some((e: any) => e.type === "ArrayConstructor");
                    if (hasNested) {
                      const outerLen = elements.length;
                      const nested = elements.find((e: any) => e.type === "ArrayConstructor");
                      const innerElements =
                        nested
                          ?.childForFieldName("expressionList")
                          ?.children.filter((c: any) => c.type === "Expression" || c.type === "ArrayConstructor") || [];
                      const innerLen = innerElements.length;
                      const shape = `Integer[${outerLen}, ${innerLen}]`;
                      const varName = node.childForFieldName("identifier")?.text || "?";
                      results.push(
                        error(
                          `For loop iterator '${varName}' must be a 1-dimensional array, got shape ${shape}`,
                          typeof expr.startIndex === "number"
                            ? {
                                startByte: expr.startIndex,
                                endByte: expr.endIndex,
                              }
                            : {
                                field: "classSpecifier",
                              },
                        ),
                      );
                    }
                  }
                }
              }
              for (const child of node.children) walk(child);
            };

            for (const child of cst.childForFieldName("classSpecifier")?.children || []) {
              if (
                child.type === "AlgorithmSection" ||
                child.type === "EquationSection" ||
                child.type === "ForEquation"
              ) {
                walk(child);
              }
            }
            return results.length > 0 ? results : null;
          },
          /** Type mismatch checks for equations, assignments, and if-branches */
          classBodyTypeChecks: (db: QueryDB, self: SymbolEntry) => {
            const cst = db.cstNode(self.id) as any;
            if (!cst) return null;

            const resolve = db.query<(name: string) => SymbolEntry | null>("resolveName", self.id);
            if (!resolve) return null;

            const results: any[] = [];

            const getType = (cstNode: any) => {
              if (cstNode.type === "ComponentReference") {
                const text = cstNode.text.split("[")[0].trim();
                const resolved = resolve(text);
                if (resolved && resolved.kind === "Component") {
                  const typeId = db.query<SymbolId | null>("resolvedType", resolved.id);
                  if (typeId) {
                    const t = db.symbol(typeId);
                    return t ? t.name : null;
                  }
                }
              } else if (
                cstNode.type === "Literal" ||
                cstNode.type === "IntegerLiteral" ||
                cstNode.type === "RealLiteral" ||
                cstNode.type === "StringLiteral" ||
                cstNode.type === "BooleanLiteral"
              ) {
                if (cstNode.type === "StringLiteral" || cstNode.text.startsWith('"')) return "String";
                if (cstNode.type === "BooleanLiteral" || cstNode.text === "true" || cstNode.text === "false")
                  return "Boolean";
                if (cstNode.type === "IntegerLiteral" || (!cstNode.text.includes(".") && !cstNode.text.includes("e")))
                  return "Integer";
                return "Real";
              }
              return null;
            };

            const walk = (node: any) => {
              if (node.type === "SimpleAssignmentStatement" || node.type === "SimpleEquation") {
                const lhs = node.childForFieldName("target") || node.childForFieldName("expression1");
                const rhs = node.childForFieldName("source") || node.childForFieldName("expression2");
                if (lhs && rhs) {
                  const t1 = getType(lhs);
                  const t2 = getType(rhs);
                  if (t1 && t2 && t1 !== t2) {
                    // Basic compatibility (Integer -> Real is ok)
                    if (t1 === "Real" && t2 === "Integer") {
                    } // allowed
                    else if (t2 === "enumeration" && t1 === "Integer") {
                    } // sometimes allowed
                    else {
                      const kind = node.type === "SimpleEquation" ? "Equation" : "Assignment";
                      // Narrow to the equation/assignment node
                      results.push(
                        error(
                          `${kind} type mismatch: '${lhs.text}' is ${t1}, but '${rhs.text}' is ${t2}`,
                          typeof node.startIndex === "number"
                            ? {
                                startByte: node.startIndex,
                                endByte: node.endIndex,
                              }
                            : {
                                field: "classSpecifier",
                              },
                        ),
                      );
                    }
                  }
                }
              } else if (
                node.type === "IfStatement" ||
                node.type === "IfEquation" ||
                node.type === "WhenStatement" ||
                node.type === "WhenEquation" ||
                node.type === "ElseIfStatementClause" ||
                node.type === "ElseIfEquationClause" ||
                node.type === "ElseWhenStatementClause" ||
                node.type === "ElseWhenEquationClause"
              ) {
                const cond = node.childForFieldName("condition");
                if (cond) {
                  const cType = getType(cond);
                  if (cType && cType !== "Boolean") {
                    // Narrow to the condition expression
                    results.push(
                      error(
                        `Condition expression must be Boolean, got ${cType} for '${cond.text}'`,
                        typeof cond.startIndex === "number"
                          ? {
                              startByte: cond.startIndex,
                              endByte: cond.endIndex,
                            }
                          : {
                              field: "classSpecifier",
                            },
                      ),
                    );
                  }
                }
              }
              for (const child of node.children) walk(child);
            };

            for (const child of cst.childForFieldName("classSpecifier")?.children || []) {
              if (child.type === "AlgorithmSection" || child.type === "EquationSection") walk(child);
            }
            return results.length > 0 ? results : null;
          },
          /** Tuple expressions can only be used in assignments/equations */
          tupleExpressionContext: (db: QueryDB, self: SymbolEntry) => {
            const cst = db.cstNode(self.id) as any;
            if (!cst) return null;

            const results: any[] = [];
            const walk = (node: any, isValidContext: boolean) => {
              if (node.type === "OutputExpressionList") {
                let count = 0;
                for (const child of node.children) {
                  if (
                    child.type === "Expression" ||
                    child.type === "ComponentReference" ||
                    child.type === "FunctionCall"
                  )
                    count++;
                }
                if (count > 1 && !isValidContext) {
                  // Narrow to the tuple expression node
                  results.push(
                    error(
                      `Tuple expression '${node.text}' can only be used in a function call assignment`,
                      typeof node.startIndex === "number"
                        ? {
                            startByte: node.startIndex,
                            endByte: node.endIndex,
                          }
                        : {
                            field: "classSpecifier",
                          },
                    ),
                  );
                }
                return; // Avoid descending into child expressions if we already handled the output list
              }

              let validForChildren = false;
              if (node.type === "ComplexAssignmentStatement") validForChildren = true;
              if (node.type === "SimpleEquation") {
                const expr2 = node.childForFieldName("expression2");
                if (expr2 && expr2.type === "FunctionCall") validForChildren = true;
              }

              for (const child of node.children) {
                walk(child, validForChildren || isValidContext);
              }
            };

            for (const child of cst.childForFieldName("classSpecifier")?.children || []) {
              if (child.type === "AlgorithmSection" || child.type === "EquationSection") walk(child, false);
            }
            return results.length > 0 ? results : null;
          },
          /** Stubs for Batch 4 and 5 remaining ClassDefinition lints */
          connectFlowMismatch: () => null,
          /**
           * Error when connect() uses a non-connector component.
           * Both arguments to connect() must be of connector type.
           */
          nonConnectorType: (db: QueryDB, self: SymbolEntry) => {
            const cst = db.cstNode(self.id) as any;
            if (!cst) return null;
            const classSpec = cst.childForFieldName("classSpecifier");
            if (!classSpec) return null;

            const resolve = db.query<(name: string) => SymbolEntry | null>("resolveSimpleName", self.id);
            if (!resolve) return null;

            const results: any[] = [];
            const walk = (node: any) => {
              if (node.type === "ConnectEquation") {
                const ref1 = node.childForFieldName("ref1");
                const ref2 = node.childForFieldName("ref2");
                for (const ref of [ref1, ref2]) {
                  if (!ref) continue;
                  const refName = ref.text.split(".")[0].split("[")[0].trim();
                  const resolved = resolve(refName);
                  if (resolved?.kind === "Component") {
                    const isConn = db.query<boolean>("isConnectorType", resolved.id);
                    if (isConn === false) {
                      if (typeof ref.startIndex === "number") {
                        results.push(
                          error(`'${refName}' is not a connector type`, {
                            startByte: ref.startIndex,
                            endByte: ref.endIndex,
                          }),
                        );
                      }
                    }
                  }
                }
              }
              for (const child of node.children || []) walk(child);
            };

            for (const child of classSpec.children) {
              if (child.type === "EquationSection") walk(child);
            }
            return results.length > 0 ? results : null;
          },
          functionArgVariability: () => null,
          functionDefaultArgCycle: () => null,
          /**
           * Warn when a function has input variables that are never referenced
           * in its algorithm body. Helps catch unused parameter bugs.
           */
          unusedInputVariable: (db: QueryDB, self: SymbolEntry) => {
            const meta = self.metadata as Record<string, unknown>;
            const prefix = meta?.classPrefixes as string | undefined;
            if (prefix !== "function") return null;

            // Collect input variable names
            const inputs: string[] = [];
            for (const child of db.childrenOf(self.id)) {
              if (child.kind !== "Component") continue;
              const causality = db.query<string | null>("causality", child.id);
              if (causality === "input") {
                inputs.push(child.name);
              }
            }
            if (inputs.length === 0) return null;

            // Scan algorithm sections for references
            const cst = db.cstNode(self.id) as any;
            if (!cst) return null;
            const classSpec = cst.childForFieldName("classSpecifier");
            if (!classSpec) return null;

            const referenced = new Set<string>();
            const walkForIdents = (node: any) => {
              if (node.type === "IDENT" || node.type === "ComponentReference") {
                const name =
                  node.type === "ComponentReference"
                    ? (node.children?.find((c: any) => c.type === "IDENT")?.text ??
                      node.text.split(".")[0].split("[")[0].trim())
                    : node.text;
                if (name) referenced.add(name);
              }
              for (const child of node.children || []) walkForIdents(child);
            };

            for (const child of classSpec.children) {
              if (child.type === "AlgorithmSection") walkForIdents(child);
              if (child.type === "EquationSection") walkForIdents(child);
            }

            const results: any[] = [];
            for (const inputName of inputs) {
              if (!referenced.has(inputName)) {
                const inputEntry = db.childrenOf(self.id).find((c) => c.name === inputName);
                if (inputEntry) {
                  const cst = db.cstNode(inputEntry.id) as any;
                  let identNode = cst;
                  if (cst?.type === "ComponentDeclaration") {
                    const dNode = cst.childForFieldName("declaration");
                    if (dNode) identNode = dNode.childForFieldName("identifier") || dNode;
                  }
                  results.push(
                    warning(`Input variable '${inputName}' is never used in the function body`, {
                      startByte: identNode?.startIndex ?? inputEntry.startByte,
                      endByte: identNode?.endIndex ?? inputEntry.endByte,
                    }),
                  );
                }
              }
            }
            return results.length > 0 ? results : null;
          },
          /**
           * Warn when a model has an equation/variable count mismatch.
           * For structurally balanced models, the number of equations
           * should equal the number of non-parameter, non-constant unknowns.
           */
          unbalancedModel: (db: QueryDB, self: SymbolEntry) => {
            const meta = self.metadata as Record<string, unknown>;
            const prefix = meta?.classPrefixes as string | undefined;
            // Only apply to models and blocks
            if (prefix !== "model" && prefix !== "block") return null;
            if (meta?.isPartial) return null;

            const children = db.childrenOf(self.id);
            if (children.length > 5000) return null; // Skip O(N) check for massive classes

            // Count unknowns: components that are not parameter, constant, or input
            let unknowns = 0;
            for (const child of children) {
              if (child.kind !== "Component") continue;
              const variability = db.query<string | null>("variability", child.id);
              const causality = db.query<string | null>("causality", child.id);
              if (variability === "parameter" || variability === "constant") continue;
              if (causality === "input") continue;
              // Count array dimensions if available
              const dims = db.query<Array<{ kind: string; value?: number }> | null>("arrayDimensions", child.id);
              if (dims && dims.length > 0) {
                let dimProduct = 1;
                for (const d of dims) {
                  if (d.kind === "literal" && d.value) dimProduct *= d.value;
                  else {
                    dimProduct = -1;
                    break;
                  }
                }
                if (dimProduct > 0) {
                  unknowns += dimProduct;
                  continue;
                }
              }
              unknowns += 1;
            }

            // Count equations from equation sections
            let equations = 0;
            const cst = db.cstNode(self.id) as any;
            if (cst) {
              const classSpec = cst.childForFieldName("classSpecifier");
              if (classSpec) {
                const countEqs = (node: any): number => {
                  let count = 0;
                  for (const child of node.children || []) {
                    if (child.type === "SimpleEquation" || child.type === "ConnectEquation") count++;
                    else if (child.type === "ForEquation") count += countEqs(child);
                    else if (child.type === "IfEquation") count += countEqs(child);
                    else if (child.type === "WhenEquation") count += countEqs(child);
                  }
                  return count;
                };
                for (const child of classSpec.children) {
                  if (child.type === "EquationSection") {
                    equations += countEqs(child);
                  }
                }
              }
            }

            if (unknowns > 0 && equations > 0 && unknowns !== equations) {
              // Narrow to the class identifier
              const identNode = cst?.childForFieldName("classSpecifier")?.childForFieldName("identifier");
              if (identNode && typeof identNode.startIndex === "number") {
                return warning(
                  `Model '${self.name}' is not balanced: ${equations} equation(s) and ${unknowns} unknown(s)`,
                  { startByte: identNode.startIndex, endByte: identNode.endIndex },
                );
              }
              return warning(
                `Model '${self.name}' is not balanced: ${equations} equation(s) and ${unknowns} unknown(s)`,
              );
            }
            return null;
          },
          missingInner: () => null,
          /**
           * Error when an identifier in an equation or algorithm body
           * cannot be resolved in the enclosing scope.
           */
          nameNotFound: (db: QueryDB, self: SymbolEntry) => {
            const cst = db.cstNode(self.id) as any;
            if (!cst) return null;
            const classSpec = cst.childForFieldName("classSpecifier");
            if (!classSpec) return null;

            const resolve = db.query<(name: string) => SymbolEntry | null>("resolveSimpleName", self.id);
            if (!resolve) return null;

            const builtins = new Set([
              "Real",
              "Integer",
              "Boolean",
              "String",
              "true",
              "false",
              "time",
              "der",
              "pre",
              "edge",
              "change",
              "initial",
              "terminal",
              "sample",
              "noEvent",
              "smooth",
              "reinit",
              "assert",
              "abs",
              "sign",
              "sqrt",
              "sin",
              "cos",
              "tan",
              "asin",
              "acos",
              "atan",
              "atan2",
              "exp",
              "log",
              "log10",
              "max",
              "min",
              "mod",
              "rem",
              "ceil",
              "floor",
              "div",
              "fill",
              "zeros",
              "ones",
              "identity",
              "linspace",
              "sum",
              "product",
              "ndims",
              "size",
              "scalar",
              "vector",
              "matrix",
              "cat",
              "diagonal",
              "transpose",
              "outerProduct",
              "symmetric",
              "cross",
              "skew",
              "delay",
              "cardinality",
              "inStream",
              "actualStream",
              "homotopy",
              "semiLinear",
              "spatialDistribution",
              "getInstanceName",
              "String",
              "Integer",
              "Modelica",
              "StateSelect",
              "end",
            ]);

            const results: any[] = [];
            const reported = new Set<string>();

            const walkForRefs = (node: any) => {
              if (node.type === "ComponentReference") {
                // Extract the root identifier (first part before dots or subscripts)
                const firstIdent = node.children?.find((c: any) => c.type === "IDENT");
                const refName = firstIdent ? firstIdent.text : node.text.split(".")[0].split("[")[0].trim();
                if (!refName || builtins.has(refName) || reported.has(refName)) return;

                // Try to resolve
                const resolved = resolve(refName);
                if (!resolved) {
                  const globals = db.byName(refName);
                  if (globals.length === 0) {
                    reported.add(refName);
                    if (typeof node.startIndex === "number") {
                      results.push(
                        error(`Variable '${refName}' not found in scope '${self.name}'`, {
                          startByte: node.startIndex,
                          endByte: node.endIndex,
                        }),
                      );
                    } else {
                      results.push(error(`Variable '${refName}' not found in scope '${self.name}'`));
                    }
                  }
                }
                return; // Don't recurse into ComponentReference children
              }
              // Skip function call names — they're resolved separately
              if (node.type === "FunctionCall") {
                // Only recurse into arguments, not the function reference
                const args = node.childForFieldName("functionCallArguments");
                if (args) walkForRefs(args);
                return;
              }
              for (const child of node.children || []) walkForRefs(child);
            };

            for (const child of classSpec.children) {
              if (child.type === "EquationSection" || child.type === "AlgorithmSection") {
                walkForRefs(child);
              }
            }
            return results.length > 0 ? results : null;
          },
          /**
           * Error when a binary operator has incompatible operand types.
           * e.g. `Boolean b = true + 1;` or `String s = "a" * 2;`
           */
          binaryOpTypeMismatch: (db: QueryDB, self: SymbolEntry) => {
            const cst = db.cstNode(self.id) as any;
            if (!cst) return null;
            const classSpec = cst.childForFieldName("classSpecifier");
            if (!classSpec) return null;

            const resolve = db.query<(name: string) => SymbolEntry | null>("resolveSimpleName", self.id);

            // Map CST literal types to Modelica types
            const literalTypes: Record<string, string> = {
              UNSIGNED_INTEGER: "Integer",
              UNSIGNED_REAL: "Real",
              BOOLEAN: "Boolean",
              STRING: "String",
            };

            const inferType = (node: any): string | null => {
              if (!node) return null;
              const lit = literalTypes[node.type];
              if (lit) return lit;
              if (node.text === "true" || node.text === "false") return "Boolean";
              if (node.type === "ComponentReference") {
                const refName = node.text.split(".")[0].split("[")[0].trim();
                if (resolve) {
                  const resolved = resolve(refName);
                  if (resolved?.kind === "Component") {
                    return ((resolved.metadata as Record<string, unknown>)?.typeSpecifier as string) ?? null;
                  }
                }
                const globals = db.byName(refName);
                if (globals.length > 0 && globals[0].kind === "Component") {
                  return ((globals[0].metadata as Record<string, unknown>)?.typeSpecifier as string) ?? null;
                }
              }
              return null;
            };

            // Arithmetic ops require numeric operands (Real/Integer)
            const arithmeticOps = new Set(["+", "-", "*", "/", "^"]);
            // Comparison ops require compatible types
            const comparisonOps = new Set(["<", ">", "<=", ">="]);
            // Logical ops require Boolean
            const logicalOps = new Set(["and", "or"]);
            const numericTypes = new Set(["Real", "Integer"]);

            const results: any[] = [];
            const walk = (node: any) => {
              if (node.type === "BinaryExpression") {
                const op = node.childForFieldName("operator")?.text;
                const lhs = node.childForFieldName("operand1");
                const rhs = node.childForFieldName("operand2");
                if (op && lhs && rhs) {
                  const t1 = inferType(lhs);
                  const t2 = inferType(rhs);
                  if (t1 && t2) {
                    let mismatch = false;
                    if (arithmeticOps.has(op)) {
                      // Both must be numeric
                      if (!numericTypes.has(t1) || !numericTypes.has(t2)) {
                        mismatch = true;
                      }
                    } else if (comparisonOps.has(op)) {
                      if (!numericTypes.has(t1) || !numericTypes.has(t2)) {
                        mismatch = true;
                      }
                    } else if (logicalOps.has(op)) {
                      if (t1 !== "Boolean" || t2 !== "Boolean") {
                        mismatch = true;
                      }
                    }
                    if (mismatch && typeof node.startIndex === "number") {
                      results.push(
                        error(`Type mismatch in '${op}': left operand is ${t1}, right operand is ${t2}`, {
                          startByte: node.startIndex,
                          endByte: node.endIndex,
                        }),
                      );
                    }
                  }
                }
              }
              for (const child of node.children || []) walk(child);
            };

            for (const child of classSpec.children) {
              if (child.type === "EquationSection" || child.type === "AlgorithmSection") walk(child);
            }
            return results.length > 0 ? results : null;
          },
          /**
           * Error when a `within` directive appears in a script-mode file.
           * Script files should not have `within` — it's only valid in package-structured files.
           */
          withinInScript: (db: QueryDB, self: SymbolEntry) => {
            const cst = db.cstNode(self.id) as any;
            if (!cst) return null;

            // Walk up to the root stored_definition
            let root = cst;
            while (root.parent) root = root.parent;

            // Check for a "within" keyword at the top level
            for (const child of root.children) {
              if (child.type === "within" || child.type === "WithinClause") {
                if (typeof child.startIndex === "number") {
                  return error("The 'within' directive is not allowed in script mode", {
                    startByte: child.startIndex,
                    endByte: child.endIndex,
                  });
                }
                return error("The 'within' directive is not allowed in script mode");
              }
            }
            return null;
          },
          /**
           * Error when an equation has mismatched array dimensions on LHS vs RHS.
           * e.g. `Real[3] x = {1,2};` at the equation level.
           */
          arrayDimensionMismatch: (db: QueryDB, self: SymbolEntry) => {
            const cst = db.cstNode(self.id) as any;
            if (!cst) return null;
            const classSpec = cst.childForFieldName("classSpecifier");
            if (!classSpec) return null;

            const resolve = db.query<(name: string) => SymbolEntry | null>("resolveSimpleName", self.id);
            if (!resolve) return null;

            const getDims = (refName: string): number[] | null => {
              const resolved = resolve(refName);
              if (!resolved || resolved.kind !== "Component") return null;
              const dims = db.query<Array<{ kind: string; value?: number }> | null>("arrayDimensions", resolved.id);
              if (!dims || dims.length === 0) return null;
              return dims.map((d) => (d.kind === "literal" && d.value ? d.value : -1));
            };

            const results: any[] = [];
            const walk = (node: any) => {
              if (node.type === "SimpleEquation") {
                const lhs = node.childForFieldName("expression1");
                const rhs = node.childForFieldName("expression2");
                if (lhs?.type === "ComponentReference" && rhs?.type === "ComponentReference") {
                  const lhsDims = getDims(lhs.text.split("[")[0].trim());
                  const rhsDims = getDims(rhs.text.split("[")[0].trim());
                  if (lhsDims && rhsDims) {
                    const lhsStr = `[${lhsDims.map((d) => (d === -1 ? ":" : d)).join(",")}]`;
                    const rhsStr = `[${rhsDims.map((d) => (d === -1 ? ":" : d)).join(",")}]`;
                    if (lhsStr !== rhsStr) {
                      if (typeof node.startIndex === "number") {
                        results.push(
                          error(
                            `Array dimension mismatch in equation: '${lhs.text}' has dimensions ${lhsStr}, '${rhs.text}' has dimensions ${rhsStr}`,
                            {
                              startByte: node.startIndex,
                              endByte: node.endIndex,
                            },
                          ),
                        );
                      }
                    }
                  }
                }
              }
              for (const child of node.children || []) walk(child);
            };

            for (const child of classSpec.children) {
              if (child.type === "EquationSection") walk(child);
            }
            return results.length > 0 ? results : null;
          },
          /**
           * Error when a variable in a package is not declared as constant.
           * Modelica spec: all variables in a package must be constant.
           * (Migrated from flattener-only M4036 package-variable-not-constant)
           */
          packageVariableNotConstant: (db: QueryDB, self: SymbolEntry) => {
            const meta = self.metadata as Record<string, unknown>;
            if (meta?.classPrefixes !== "package") return null;

            const results: any[] = [];
            for (const child of db.childrenOf(self.id)) {
              if (child.kind !== "Component") continue;
              const cMeta = child.metadata as Record<string, unknown>;
              if (cMeta?.variability !== "constant") {
                const cst = db.cstNode(child.id) as any;
                let identNode = cst;
                if (cst?.type === "ComponentDeclaration") {
                  const dNode = cst.childForFieldName("declaration");
                  if (dNode) identNode = dNode.childForFieldName("identifier") || dNode;
                }
                results.push(
                  error(`Variable '${child.name}' in package '${self.name}' is not constant.`, {
                    startByte: identNode?.startIndex ?? child.startByte,
                    endByte: identNode?.endIndex ?? child.endByte,
                  }),
                );
              }
            }
            return results.length > 0 ? results : null;
          },
          /**
           * Error when equations or algorithms appear in a restricted class kind.
           * e.g. `type`, `connector`, `record` should not have equation sections.
           * (Migrated from flattener-only M4017 restriction-violation)
           */
          restrictionViolation: (db: QueryDB, self: SymbolEntry) => {
            const cst = db.cstNode(self.id) as any;
            if (!cst) return null;
            const classSpec = cst.childForFieldName("classSpecifier");
            if (!classSpec) return null;

            const meta = self.metadata as Record<string, unknown>;
            const prefix = meta?.classPrefixes as string | undefined;
            if (!prefix) return null;

            // These class kinds cannot have equations or algorithms
            const noEquations = new Set([
              "type",
              "connector",
              "expandable connector",
              "record",
              "operator record",
              "package",
              "shape",
            ]);
            const noAlgorithms = new Set(["type", "connector", "expandable connector", "package", "shape"]);

            if (!noEquations.has(prefix) && !noAlgorithms.has(prefix)) return null;

            const results: any[] = [];
            // Helper: find the first equation/statement inside a section (skip keywords/comments)
            const firstBodyChild = (sectionNode: any): any => {
              for (const c of sectionNode.children || []) {
                if (
                  c.type === "equation" ||
                  c.type === "algorithm" ||
                  c.type === "initial" ||
                  c.type.startsWith("//") ||
                  c.type === "comment" ||
                  c.isNamed === false
                )
                  continue;
                return c;
              }
              return null;
            };
            for (const child of classSpec.children) {
              if (child.type === "EquationSection" && noEquations.has(prefix)) {
                const targetNode = firstBodyChild(child) || child;
                if (typeof targetNode.startIndex === "number") {
                  results.push(
                    error(`Equation sections are not allowed in ${prefix}.`, {
                      startByte: targetNode.startIndex,
                      endByte: targetNode.endIndex,
                    }),
                  );
                }
              }
              if (child.type === "AlgorithmSection" && noAlgorithms.has(prefix)) {
                const targetNode = firstBodyChild(child) || child;
                if (typeof targetNode.startIndex === "number") {
                  results.push(
                    error(`Algorithm sections are not allowed in ${prefix}.`, {
                      startByte: targetNode.startIndex,
                      endByte: targetNode.endIndex,
                    }),
                  );
                }
              }
            }
            return results.length > 0 ? results : null;
          },
          /**
           * Error when a component's type is declared as partial.
           * Cannot instantiate partial classes.
           * (Migrated from flattener-only M4018 partial-instantiation)
           */
          partialInstantiation: (db: QueryDB, self: SymbolEntry) => {
            const results: any[] = [];
            const selfMeta = self.metadata as Record<string, unknown>;
            const selfPrefix = selfMeta?.classPrefixes as string | undefined;
            if (selfPrefix?.includes("function") || selfPrefix?.includes("partial")) return null;

            const children = db.childrenOf(self.id);
            if (children.length > 5000) return null; // Skip O(N) check for massive classes
            for (const child of children) {
              if (child.kind !== "Component") continue;
              const cMeta = child.metadata as Record<string, unknown>;
              const typeName = cMeta?.typeSpecifier as string | undefined;
              if (!typeName) continue;

              // Resolve the type
              const typeEntries = db.byName(typeName);
              const typeEntry = typeEntries?.find((e) => e.kind === "Class");
              if (!typeEntry) continue;

              const typeMeta = typeEntry.metadata as Record<string, unknown>;
              const typePrefix = typeMeta?.classPrefixes as string | undefined;
              if (typePrefix?.includes("partial")) {
                if (db.query<boolean>("isReplaceable", child.id)) continue;
                const cst = db.cstNode(child.id) as any;
                let identNode = cst;
                if (cst?.type === "ComponentDeclaration") {
                  const dNode = cst.childForFieldName("declaration");
                  if (dNode) identNode = dNode.childForFieldName("identifier") || dNode;
                }
                results.push(
                  error(`Illegal to instantiate partial class '${typeName}'.`, {
                    startByte: identNode?.startIndex ?? child.startByte,
                    endByte: identNode?.endIndex ?? child.endByte,
                  }),
                );
              }
            }
            return results.length > 0 ? results : null;
          },
        },
        adapters: {
          sysml2: {
            target: "BlockDefinition",
            transform: (db, self) => ({
              name: (self as SymbolEntry).name,
              defKind: ((self as SymbolEntry).metadata as Record<string, unknown>)?.classPrefixes ?? "class",
              isAbstract: false,
              parts: db
                .childrenOf((self as SymbolEntry).id)
                .filter((c) => c.kind === "Component")
                .map((c) => ({
                  name: c.name,
                  typeName: (c.metadata as Record<string, unknown>)?.typeSpecifier as string | undefined,
                  direction: ((c.metadata as Record<string, unknown>)?.causality as string) ?? null,
                  isParameter: (c.metadata as Record<string, unknown>)?.variability === "parameter",
                })),
              nestedBlocks: db
                .childrenOf((self as SymbolEntry).id)
                .filter((c) => c.kind === "Class")
                .map((c) => db.project(c, "sysml2")),
            }),
          },
          owl2: {
            target: "ClassEntity",
            transform: (db, self) => {
              const s = self as SymbolEntry;
              const meta = s.metadata as Record<string, unknown>;
              const iri = `mo:${s.name}`;
              const children = db.childrenOf(s.id);
              const axioms: Record<string, unknown>[] = [];

              // Class declaration
              axioms.push({
                type: "ClassDeclaration",
                iri,
                sourceLang: "modelica",
                sourceQualifiedName: s.name,
              });

              // SubClassOf from extends clauses
              for (const c of children) {
                if (c.kind === "Extends") {
                  axioms.push({
                    type: "SubClassOf",
                    subClassIri: iri,
                    superClassIri: `mo:${c.name}`,
                    sourceLang: "modelica",
                  });
                }
              }

              // DataPropertyAssertions from parameter components
              for (const c of children) {
                if (c.kind === "Component") {
                  const cMeta = c.metadata as Record<string, unknown>;
                  if (cMeta?.variability === "parameter") {
                    axioms.push({
                      type: "DataPropertyDeclaration",
                      iri: `mo:hasParam_${c.name}`,
                      sourceLang: "modelica",
                    });
                  }
                }
              }

              // Connector type → domain classification
              const prefix = meta?.classPrefixes as string | undefined;
              if (prefix === "connector") {
                // Infer domain from package path if available
                const pkgPath = s.name;
                if (pkgPath.includes("Electrical")) {
                  axioms.push({
                    type: "SubClassOf",
                    subClassIri: iri,
                    superClassIri: "mo:ElectricalDomain",
                    sourceLang: "modelica",
                  });
                } else if (pkgPath.includes("Thermal")) {
                  axioms.push({
                    type: "SubClassOf",
                    subClassIri: iri,
                    superClassIri: "mo:ThermalDomain",
                    sourceLang: "modelica",
                  });
                } else if (pkgPath.includes("Mechanical")) {
                  axioms.push({
                    type: "SubClassOf",
                    subClassIri: iri,
                    superClassIri: "mo:MechanicalDomain",
                    sourceLang: "modelica",
                  });
                } else if (pkgPath.includes("Fluid")) {
                  axioms.push({
                    type: "SubClassOf",
                    subClassIri: iri,
                    superClassIri: "mo:FluidDomain",
                    sourceLang: "modelica",
                  });
                }
              }

              return { axioms };
            },
          },
        },
        graphics: (self) => ({
          role: "node" as const,
          node: {
            shape: "rect",
            markup: [
              { tagName: "rect", selector: "body" },
              { tagName: "text", selector: "header" },
              { tagName: "line", selector: "separator" },
              { tagName: "text", selector: "label" },
            ],
            attrs: {
              body: { fill: "#e3f2fd", stroke: "#1565c0", strokeWidth: 2, rx: 4, ry: 4 },
              header: {
                text: "{{classPrefixes}}",
                fill: "#1565c0",
                fontSize: 10,
                textAnchor: "middle",
                refX: 0.5,
                refY: 14,
              },
              separator: { x1: 0, y1: 24, x2: "100%", y2: 24, stroke: "#1565c0", strokeWidth: 1 },
              label: {
                text: "{{name}}",
                fill: "#0d47a1",
                fontSize: 14,
                fontWeight: "bold",
                textAnchor: "middle",
                refX: 0.5,
                refY: 40,
              },
            },
            size: { width: 200, height: 60 },
            ports: {
              groups: {
                in: {
                  position: "left",
                  attrs: { circle: { r: 5, fill: "#43a047", stroke: "#fff", strokeWidth: 1.5 } },
                },
                out: {
                  position: "right",
                  attrs: { circle: { r: 5, fill: "#ef6c00", stroke: "#fff", strokeWidth: 1.5 } },
                },
              },
            },
            portQuery: "components",
          },
        }),
      }),

    ClassPrefixes: () =>
      seq(
        optional(field("partial", "partial")),
        choice(
          field("class", "class"),
          field("model", "model"),
          seq(optional(field("operator", "operator")), field("record", "record")),
          field("block", "block"),
          seq(optional(field("expandable", "expandable")), field("connector", "connector")),
          field("type", "type"),
          field("package", "package"),
          seq(
            optional(field("purity", choice("pure", "impure"))),
            optional(field("operator", "operator")),
            field("function", "function"),
          ),
          field("operator", "operator"),
          field("optimization", "optimization"),
          field("shape", "shape"),
        ),
      ),

    _ClassSpecifier: ($) => choice($.LongClassSpecifier, $.ShortClassSpecifier, $.DerClassSpecifier),

    LongClassSpecifier: ($) =>
      seq(
        optional(field("extends", "extends")),
        field("identifier", $.IDENT),
        optional(field("classModification", $.ClassModification)),
        optional(field("description", $.Description)),
        optional(field("section", $.InitialElementSection)),
        repeat(field("section", choice($.ElementSection, $.EquationSection, $.AlgorithmSection, $.ConstraintSection))),
        optional(field("externalFunctionClause", $.ExternalFunctionClause)),
        optional(seq(field("annotationClause", $.AnnotationClause), ";")),
        "end",
        field("endIdentifier", $.IDENT),
      ),

    ShortClassSpecifier: ($) =>
      seq(
        field("identifier", $.IDENT),
        "=",
        choice(
          seq(
            optional(field("causality", choice("input", "output"))),
            field("typeSpecifier", $.TypeSpecifier),
            optional(field("arraySubscripts", $.ArraySubscripts)),
            optional(field("classModification", $.ClassModification)),
          ),
          seq(
            field("enumeration", "enumeration"),
            "(",
            optional(
              choice(
                commaSep1(field("enumerationLiteral", $.EnumerationLiteral)),
                field("unspecifiedEnumeration", ":"),
              ),
            ),
            ")",
          ),
        ),
        optional(field("description", $.Description)),
        optional(field("annotationClause", $.AnnotationClause)),
      ),

    DerClassSpecifier: ($) =>
      seq(
        field("identifier", $.IDENT),
        "=",
        "der",
        "(",
        field("typeSpecifier", $.TypeSpecifier),
        ",",
        commaSep1(field("input", $.IDENT)),
        ")",
        optional(field("description", $.Description)),
        optional(field("annotationClause", $.AnnotationClause)),
      ),

    EnumerationLiteral: ($) =>
      def({
        syntax: seq(
          field("identifier", $.IDENT),
          optional(field("description", $.Description)),
          optional(field("annotationClause", $.AnnotationClause)),
        ),
        symbol: (self) => ({
          kind: "EnumerationLiteral",
          name: self.identifier,
        }),
        model: {
          name: "EnumerationLiteral",
          visitable: true,
        },
      }),

    ExternalFunctionClause: ($) =>
      seq(
        "external",
        optional(field("languageSpecification", $.LanguageSpecification)),
        optional(field("externalFunctionCall", $.ExternalFunctionCall)),
        optional(field("annotationClause", $.AnnotationClause)),
        ";",
      ),

    LanguageSpecification: ($) => field("language", $.STRING),

    ExternalFunctionCall: ($) =>
      seq(
        optional(seq(field("output", $.ComponentReference), "=")),
        field("functionName", $.IDENT),
        "(",
        optional(field("arguments", $.ExpressionList)),
        ")",
      ),

    // =====================================================================
    // §A.2.2a — Element Sections
    // =====================================================================

    InitialElementSection: ($) => seq(repeat1(field("element", $._Element))),

    ElementSection: ($) =>
      seq(field("visibility", choice("protected", "public")), repeat(field("element", $._Element))),

    _Element: ($) =>
      choice($.ClassDefinition, $.ComponentClause, $.ExtendsClause, $._ImportClause, $.ElementAnnotation),

    ElementAnnotation: ($) => prec(-1, seq($.AnnotationClause, ";")),

    _ImportClause: ($) => choice($.SimpleImportClause, $.CompoundImportClause, $.UnqualifiedImportClause),

    SimpleImportClause: ($) =>
      def({
        syntax: seq(
          "import",
          optional(seq(field("shortName", $.IDENT), "=")),
          field("packageName", $.Name),
          optional(field("description", $.Description)),
          optional(field("annotationClause", $.AnnotationClause)),
          ";",
        ),
        symbol: (self) => ({
          kind: "Import",
          name: self.packageName,
          attributes: {
            shortName: self.shortName,
            packageName: self.packageName,
          },
        }),
        model: {
          name: "SimpleImportClause",
          visitable: true,
          properties: {
            importKind: '"simple"',
          },
        },
      }),

    CompoundImportClause: ($) =>
      def({
        syntax: seq(
          "import",
          field("packageName", $.Name),
          ".",
          "{",
          commaSep1(field("importName", $.IDENT)),
          "}",
          optional(field("description", $.Description)),
          optional(field("annotationClause", $.AnnotationClause)),
          ";",
        ),
        symbol: (self) => ({
          kind: "Import",
          name: self.packageName,
          attributes: {
            packageName: self.packageName,
          },
        }),
        model: {
          name: "CompoundImportClause",
          visitable: true,
          properties: {
            importKind: '"compound"',
          },
        },
      }),

    UnqualifiedImportClause: ($) =>
      def({
        syntax: seq(
          "import",
          field("packageName", $.Name),
          ".",
          "*",
          optional(field("description", $.Description)),
          optional(field("annotationClause", $.AnnotationClause)),
          ";",
        ),
        symbol: (self) => ({
          kind: "Import",
          name: self.packageName,
          attributes: {
            packageName: self.packageName,
          },
        }),
        model: {
          name: "UnqualifiedImportClause",
          visitable: true,
          properties: {
            importKind: '"unqualified"',
          },
        },
      }),

    // =====================================================================
    // §A.2.3 — Extends
    // =====================================================================

    ExtendsClause: ($) =>
      def({
        syntax: seq(
          "extends",
          field("typeSpecifier", $.TypeSpecifier),
          optional(field("classOrInheritanceModification", $.ClassOrInheritanceModification)),
          optional(field("annotationClause", $.AnnotationClause)),
          ";",
        ),
        symbol: (self) => ({
          kind: "Extends",
          name: self.typeSpecifier,
          ref: { resolve: "qualified", targetKinds: ["Class"] },
          attributes: {
            typeSpecifier: self.typeSpecifier,
          },
        }),
        queries: {
          modificationText: (db: QueryDB, self: SymbolEntry) => {
            const cst = db.cstNode(self.id) as any;
            return cst?.childForFieldName("classOrInheritanceModification")?.text ?? null;
          },
          /**
           * Resolve the base class referenced by this extends clause.
           * Returns the SymbolEntry of the resolved class, or null.
           */
          resolvedBaseClass: (db: QueryDB, self: SymbolEntry) => {
            const baseName = self.name;
            if (!baseName) return null;
            // Use resolveName from the enclosing class for proper scope resolution
            if (self.parentId !== null) {
              const resolveName = db.query<(n: string, skip?: boolean) => SymbolEntry | null>(
                "resolveName",
                self.parentId,
              );
              if (resolveName) {
                // Pass true for skipInherited to prevent cyclic lookup in extends clauses
                let resolved = resolveName(baseName, true);

                // If it resolves to the exact class that contains this extends clause,
                // this is a redeclared extends (e.g. `redeclare class extends BaseClass`).
                // We must resolve it from the parent's base classes instead.
                if (resolved && resolved.id === self.parentId) {
                  resolved = null;
                  const grandParentId = db.symbol(self.parentId)?.parentId;
                  if (grandParentId !== null && grandParentId !== undefined) {
                    const parentChildren = db.childrenOf(grandParentId);
                    for (const pChild of parentChildren) {
                      if (pChild.kind === "Extends") {
                        const pBase = db.query<SymbolEntry | null>("resolvedBaseClass", pChild.id);
                        if (pBase) {
                          const pExtResolver = db.query<
                            (n: string, enc?: boolean, skip?: boolean) => SymbolEntry | null
                          >("resolveSimpleName", pBase.id);
                          if (pExtResolver) {
                            const found = pExtResolver(baseName);
                            if (found && found.id !== self.parentId) {
                              resolved = found;
                              break;
                            }
                          }
                        }
                      }
                    }
                  }
                }

                if (resolved && resolved.kind !== "Reference") return resolved;
              }
            }
            // Fallback to global lookup, filtering out Reference entries
            const entries = db.byName(baseName);
            return entries?.find((e) => e.kind === "Class" || e.kind === "Package") ?? entries?.[0] ?? null;
          },
          /**
           * Get the merged modification for this extends clause.
           * Combines the class-or-inheritance-modification with the
           * outer modification from the enclosing class.
           */
          effectiveModification: (db: QueryDB, self: SymbolEntry) => {
            // The modification from the extends clause itself
            return (self.metadata as Record<string, unknown>)?.classOrInheritanceModification ?? null;
          },
          /**
           * Parse the extends clause's class-or-inheritance modification from the CST
           * into a structured ModelicaModArgs object.
           *
           * This is the extends-clause equivalent of the component's effectiveModification
           * query, providing the modification data needed by the flattener's ModificationStack.
           *
           * e.g., `extends Base(p = 1, redeclare type T = NewT)` →
           *   { args: [{name:"p", value:{kind:"expression",...}}, {name:"T", isRedeclaration:true, ...}], ... }
           */
          extendsModificationParsed: (db: QueryDB, self: SymbolEntry) => {
            const cst = db.cstNode(self.id) as any;
            const modNode = cst?.childForFieldName("classOrInheritanceModification");
            if (!modNode) return null;
            return parseModArgsFromCst(modNode, self.parentId) as ModelicaModArgs;
          },
        },
        model: {
          name: "ExtendsClause",
          visitable: true,
          specializable: true,
          properties: {
            visibility: "string | null",
          },
          queryTypes: {
            resolvedBaseClass: "SemanticNode | null",
            effectiveModification: "unknown",
          },
        },
        lints: {
          /**
           * Detect extends cycles (A extends B extends A).
           */
          extendsCycle: (db: QueryDB, self: SymbolEntry) => {
            const visited = new Set<string>();
            let current: SymbolEntry | undefined = self;
            while (current) {
              if (visited.has(current.name)) {
                return error(`Extends cycle detected: ${[...visited, current.name].join(" → ")}`, {
                  field: "typeSpecifier",
                });
              }
              visited.add(current.name);
              const baseEntries = db.byName(current.name);
              const baseClass = baseEntries?.[0];
              if (!baseClass) break;
              // Find extends clause in base class
              const extendsChildren = db.childrenOf(baseClass.id).filter((c) => c.kind === "Extends");
              current = extendsChildren[0];
            }
            return null;
          },
        },
        graphics: (self) => ({
          role: "edge" as const,
          edge: {
            shape: "edge",
            attrs: {
              line: {
                stroke: "#7b1fa2",
                strokeWidth: 1.5,
                strokeDasharray: "6 3",
                targetMarker: { name: "block", size: 10 },
              },
            },
            labels: [
              {
                attrs: {
                  text: { text: "??extends??", fill: "#7b1fa2", fontSize: 11 },
                  rect: { fill: "#fff", stroke: "none", rx: 3, ry: 3 },
                },
                position: { distance: 0.5, offset: 0 },
              },
            ],
            router: "manhattan",
            connector: "rounded",
          },
        }),
      }),

    ConstrainingClause: ($) =>
      seq(
        "constrainedby",
        field("typeSpecifier", $.TypeSpecifier),
        optional(field("classModification", $.ClassModification)),
        optional(field("description", $.Description)),
      ),

    ClassOrInheritanceModification: ($) =>
      seq(
        "(",
        commaSep(
          field(
            "modificationArgumentOrInheritanceModification",
            choice($._ModificationArgument, $.InheritanceModification),
          ),
        ),
        ")",
      ),

    InheritanceModification: ($) =>
      seq("break", choice(field("connectEquation", $.ConnectEquation), field("identifier", $.IDENT))),

    // =====================================================================
    // §A.2.4 — Component Clause
    // =====================================================================

    ComponentClause: ($) =>
      seq(
        optional(field("redeclare", "redeclare")),
        optional(field("final", "final")),
        optional(field("inner", "inner")),
        optional(field("outer", "outer")),
        optional(field("replaceable", "replaceable")),
        optional(field("flow", choice("flow", "stream"))),
        optional(field("variability", choice("discrete", "parameter", "constant"))),
        optional(field("causality", choice("input", "output"))),
        field("typeSpecifier", $.TypeSpecifier),
        optional(field("arraySubscripts", $.ArraySubscripts)),
        commaSep1(field("componentDeclaration", $.ComponentDeclaration)),
        optional(field("constrainingClause", $.ConstrainingClause)),
        ";",
      ),

    ComponentDeclaration: ($) =>
      def({
        syntax: seq(
          field("declaration", $.Declaration),
          optional(field("conditionAttribute", $.ConditionAttribute)),
          optional(field("description", $.Description)),
          optional(field("annotationClause", $.AnnotationClause)),
        ),
        i18n: {
          extract: (db, self) => {
            const results = [];

            // 1. Extract component name
            const decl = self.childForFieldName("declaration");
            const nameNode = decl?.childForFieldName("identifier");
            if (nameNode?.text) {
              results.push({ msgid: nameNode.text });
            }

            // 2. Extract component description
            const descNode = self.childForFieldName("description");
            if (descNode) {
              const parts = [];
              for (const child of descNode.children) {
                if (child.text && child.text !== "+") {
                  parts.push(child.text);
                }
              }
              const desc = parts.map((s) => (s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s)).join(" ");
              if (desc) {
                results.push({ msgid: desc });
              }
            }

            // 3. Extract Dialog annotation (tab, group)
            const ann = self.childForFieldName("annotationClause");
            if (ann) {
              const classMod = ann.childForFieldName("classModification");
              if (classMod) {
                for (const arg of classMod.children) {
                  if (arg.type === "ElementModification") {
                    const argName = arg.childForFieldName("name")?.text;
                    if (argName === "Dialog") {
                      const mod = arg.childForFieldName("modification")?.childForFieldName("classModification");
                      if (mod) {
                        for (const dialogArg of mod.children) {
                          if (dialogArg.type === "ElementModification") {
                            const dArgName = dialogArg.childForFieldName("name")?.text;
                            if (dArgName === "tab" || dArgName === "group") {
                              const val = dialogArg
                                .childForFieldName("modification")
                                ?.childForFieldName("modificationExpression")
                                ?.childForFieldName("expression");
                              if (val && val.text) {
                                results.push({ msgid: val.text });
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }

            return results;
          },
        },
        symbol: (self) => ({
          kind: "Component",
          name: self.declaration.identifier,
          attributes: {
            modification: self.declaration.modification,
            description: self.description,
            typeSpecifier: (self as any).parent.typeSpecifier,
            causality: (self as any).parent.causality,
            variability: (self as any).parent.variability,
          },
        }),
        queries: {
          /**
           * Get the raw type specifier name for this component.
           */
          typeSpecifier: (db: QueryDB, self: SymbolEntry) => {
            const specArgs = db.argsOf<import("./modification-args.js").ModelicaModArgs>(self.id);
            if (specArgs?.data?.isRedeclaration && specArgs.data.redeclaredTypeSpecifier) {
              return specArgs.data.redeclaredTypeSpecifier;
            }
            const cstNode = db.cstNode(self.id);
            let current = cstNode as any;
            while (current && current.type !== "ComponentClause") {
              current = current.parent;
            }
            return current?.childForFieldName("typeSpecifier")?.text ?? null;
          },

          /**
           * Resolve the type specifier to the class it references.
           */
          resolvedType: (db: QueryDB, self: SymbolEntry) => {
            const specArgs = db.argsOf<import("./modification-args.js").ModelicaModArgs>(self.id);
            let typeName = "";

            if (specArgs?.data?.isRedeclaration && specArgs.data.redeclaredTypeSpecifier) {
              typeName = specArgs.data.redeclaredTypeSpecifier;
            } else {
              const cstNode = db.cstNode(self.id);
              let current = cstNode as any;
              while (current && current.type !== "ComponentClause") {
                current = current.parent;
              }
              typeName = current?.childForFieldName("typeSpecifier")?.text ?? "";
            }

            if (!typeName || typeof typeName !== "string") return null;

            // Try qualified resolution from parent scope
            if (typeName.includes(".") && self.parentId !== null) {
              const parentEntry = db.symbol(self.parentId);
              if (parentEntry && (parentEntry.kind === "Class" || parentEntry.kind === "Package")) {
                const qualResolver = db.query<(n: string) => SymbolEntry | null>("resolveName", parentEntry.id);
                if (qualResolver) {
                  const resolved = qualResolver(typeName);
                  if (resolved) return resolved;
                }
              }
            }

            // Fallback: global lookup — try full qualified name first, then simple name
            if (typeName.includes(".")) {
              const entries = db.byName(typeName);
              const found = entries?.find((e) => e.kind === "Class" || e.kind === "Package" || e.kind === "Function");
              if (found) return found;
            }
            const simpleName = typeName.includes(".") ? typeName.split(".").pop()! : typeName;
            const entries = db.byName(simpleName);
            return (
              entries?.find((e) => (e.metadata as Record<string, unknown>)?.isPredefined && e.kind === "Class") ??
              entries?.find((e) => e.kind === "Class" || e.kind === "Package" || e.kind === "Function") ??
              null
            );
          },
          /**
           * Get the effective modification for this component as a
           * structured ModelicaModArgs object.
           *
           * Parses the raw modification metadata text into:
           * - args: nested modifications like (x=1, y=2)
           * - bindingExpression: scalar binding like = expr
           *
           * Returns null if no modification is present.
           */
          effectiveModification: (db: QueryDB, self: SymbolEntry) => {
            const cst = db.cstNode(self.id) as any;
            let current = cst;
            while (current && current.type !== "ComponentDeclaration") {
              current = current.parent;
            }
            const declNode = current?.childForFieldName("declaration");
            const modNode = declNode?.childForFieldName("modification");
            if (!modNode) return null;
            return parseModArgsFromCst(modNode, self.parentId) as ModelicaModArgs;
          },
          /**
           * Check if this component's type is a connector.
           */
          isConnectorType: (db: QueryDB, self: SymbolEntry) => {
            const cstNode = db.cstNode(self.id);
            let current = cstNode as any;
            while (current && current.type !== "ComponentClause") {
              current = current.parent;
            }
            let typeName = current?.childForFieldName("typeSpecifier")?.text;
            if (!typeName || typeof typeName !== "string") return false;

            let typeEntry: SymbolEntry | null = null;

            // Try qualified resolution from parent scope
            if (typeName.includes(".") && self.parentId !== null) {
              const parentEntry = db.symbol(self.parentId);
              if (parentEntry && (parentEntry.kind === "Class" || parentEntry.kind === "Package")) {
                const qualResolver = db.query<(n: string) => SymbolEntry | null>("resolveName", parentEntry.id);
                if (qualResolver) {
                  typeEntry = qualResolver(typeName);
                }
              }
            }

            // Fallback: global lookup — try full qualified name first
            if (!typeEntry && typeName.includes(".")) {
              const entries = db.byName(typeName);
              typeEntry =
                entries?.find((e) => e.kind === "Class" || e.kind === "Package" || e.kind === "Function") ?? null;
            }
            if (!typeEntry) {
              const simpleName = typeName.includes(".") ? typeName.split(".").pop()! : typeName;
              const entries = db.byName(simpleName);
              typeEntry =
                entries?.find((e) => (e.metadata as Record<string, unknown>)?.isPredefined && e.kind === "Class") ??
                entries?.find((e) => e.kind === "Class" || e.kind === "Package" || e.kind === "Function") ??
                null;
            }

            if (!typeEntry) return false;
            const classPrefixes = (typeEntry.metadata as Record<string, unknown>)?.classPrefixes;
            return typeof classPrefixes === "string" && classPrefixes.includes("connector");
          },

          variability: (db: QueryDB, self: SymbolEntry) => {
            let current = db.cstNode(self.id) as any;
            while (current && current.type !== "ComponentClause") current = current.parent;
            return current?.childForFieldName("variability")?.text ?? null;
          },

          causality: (db: QueryDB, self: SymbolEntry) => {
            let current = db.cstNode(self.id) as any;
            while (current && current.type !== "ComponentClause") current = current.parent;
            return current?.childForFieldName("causality")?.text ?? null;
          },

          flowPrefix: (db: QueryDB, self: SymbolEntry) => {
            let current = db.cstNode(self.id) as any;
            while (current && current.type !== "ComponentClause") current = current.parent;
            return current?.childForFieldName("flow")?.text ?? null;
          },

          isFinal: (db: QueryDB, self: SymbolEntry) => {
            let current = db.cstNode(self.id) as any;
            while (current && current.type !== "ComponentClause") current = current.parent;
            return !!current?.childForFieldName("final");
          },

          /**
           * Check if this component has annotation(Evaluate=true).
           * Per Modelica §18.3, this promotes a parameter to be evaluated at compile time.
           */
          isEvaluate: (db: QueryDB, self: SymbolEntry) => {
            const cst = db.cstNode(self.id) as any;
            let current = cst;
            while (current && current.type !== "ComponentDeclaration") current = current.parent;
            const ann = current?.childForFieldName("annotationClause");
            if (!ann) return false;
            const classMod = ann.childForFieldName?.("classModification");
            if (!classMod) return false;
            for (const arg of classMod.namedChildren ?? []) {
              if (arg.type !== "ElementModification") continue;
              const argName = arg.childForFieldName?.("name")?.text;
              if (argName === "Evaluate") {
                const modNode = arg.childForFieldName?.("modification");
                const modExpr = modNode?.childForFieldName?.("modificationExpression");
                if (modExpr?.text === "true") return true;
              }
            }
            return false;
          },

          isRedeclare: (db: QueryDB, self: SymbolEntry) => {
            let current = db.cstNode(self.id) as any;
            while (current && current.type !== "ComponentClause") current = current.parent;
            return !!current?.childForFieldName("redeclare");
          },

          isInner: (db: QueryDB, self: SymbolEntry) => {
            let current = db.cstNode(self.id) as any;
            while (current && current.type !== "ComponentClause") current = current.parent;
            return !!current?.childForFieldName("inner");
          },

          isReplaceable: (db: QueryDB, self: SymbolEntry) => {
            let current = db.cstNode(self.id) as any;
            while (current && current.type !== "ComponentClause") current = current.parent;
            return !!current?.childForFieldName("replaceable");
          },

          isProtected: (db: QueryDB, self: SymbolEntry) => {
            let current = db.cstNode(self.id) as any;
            while (current && current.type !== "ElementSection") current = current.parent;
            return current ? current.childForFieldName("visibility")?.text === "protected" : false;
          },

          isOuter: (db: QueryDB, self: SymbolEntry) => {
            let current = db.cstNode(self.id) as any;
            while (current && current.type !== "ComponentClause") current = current.parent;
            return !!current?.childForFieldName("outer");
          },

          // =================================================================
          // Milestone 3: Component Instantiation
          // =================================================================

          /**
           * Instantiate this component: resolve its type specifier
           * to a class, then specialize that class with the component's
           * effective modification.
           *
           * Returns the SymbolId of the (possibly specialized) class.
           * Returns null if the type cannot be resolved.
           *
           * This replaces ModelicaComponentInstance.classInstance.
           */
          classInstance: (db: QueryDB, self: SymbolEntry) => {
            const specArgs = db.argsOf<import("./modification-args.js").ModelicaModArgs>(self.id);
            let typeName = "";

            if (specArgs?.data?.isRedeclaration && specArgs.data.redeclaredTypeSpecifier) {
              typeName = specArgs.data.redeclaredTypeSpecifier;
            } else {
              const cstNode = db.cstNode(self.id);
              let current = cstNode as any;
              while (current && current.type !== "ComponentClause") {
                current = current.parent;
              }
              typeName = current?.childForFieldName("typeSpecifier")?.text ?? "";
            }

            if (!typeName) return null;

            let typeEntry: SymbolEntry | null = null;
            if (self.parentId !== null) {
              const parentEntry = db.symbol(self.parentId);
              if (parentEntry && (parentEntry.kind === "Class" || parentEntry.kind === "Package")) {
                // Use resolveName for qualified (dotted) names, resolveSimpleName for simple names
                if (typeName.includes(".")) {
                  const qualResolver = db.query<(n: string) => SymbolEntry | null>("resolveName", parentEntry.id);
                  if (qualResolver) {
                    typeEntry = qualResolver(typeName);
                  }
                } else {
                  const resolver = db.query<(n: string, enc?: boolean) => SymbolEntry | null>(
                    "resolveSimpleName",
                    parentEntry.id,
                  );
                  if (resolver) {
                    typeEntry = resolver(typeName);
                  }
                }
              }
            }
            // Fallback: global lookup — try full qualified name first, then simple name
            if (!typeEntry && typeName.includes(".")) {
              typeEntry = resolveQualified(db, typeName);
            }
            if (!typeEntry) {
              const simpleName = typeName.includes(".") ? typeName.split(".").pop()! : typeName;
              const entries = db.byName(simpleName);
              // Prefer predefined types (Real, Integer, etc.) and types over models
              // to avoid resolving e.g. "Temperature" to a random sensor class.
              typeEntry =
                entries?.find((e) => (e.metadata as Record<string, unknown>)?.isPredefined && e.kind === "Class") ??
                entries?.find((e) => (e.metadata as Record<string, unknown>)?.classPrefixes === "type") ??
                entries?.find((e) => e.kind === "Class" || e.kind === "Package" || e.kind === "Function") ??
                null;
            }
            if (!typeEntry) return null;

            // Return the unmodified type class ID.
            // Value modifications (e.g., R=100) are resolved by the flattener's
            // ModificationStack, eliminating the need for virtual specialized type entries.
            // Note: Redeclarations (type replacement via extends) are still handled
            // by extends specialization in the instantiate query (Phase 1b).
            return typeEntry.id;
          },

          /**
           * Get the array dimensions for this component as structured subscripts.
           *
           * Walks the actual CST ArraySubscripts → Subscript children to produce:
           *   - { kind: "literal", value: number }   — integer literal dimension
           *   - { kind: "flexible" }                  — ':' (flexible dimension)
           *   - { kind: "expression", cstBytes: [start, end] } — symbolic expression
           */
          arrayDimensions: (db: QueryDB, self: SymbolEntry) => {
            // Get the CST node for this ComponentDeclaration
            const cst = db.cstNode(self.id) as import("@modelscript/compiler/symbol-indexer").CSTNode | null;
            if (!cst) return null;

            /** Extract subscript descriptors from an ArraySubscripts CST node. */
            const extractSubscripts = (
              arraySubNode: any,
            ): Array<
              | { kind: "literal"; value: number }
              | { kind: "flexible" }
              | { kind: "expression"; cstBytes: readonly [number, number]; text?: string }
            > => {
              const subs: Array<
                | { kind: "literal"; value: number }
                | { kind: "flexible" }
                | { kind: "expression"; cstBytes: readonly [number, number]; text?: string }
              > = [];
              for (const child of arraySubNode.children) {
                if (child.type !== "Subscript") continue;
                const flexChild = child.childForFieldName("flexible");
                if (flexChild) {
                  subs.push({ kind: "flexible" });
                  continue;
                }
                const exprChild = child.childForFieldName("expression");
                if (exprChild) {
                  if (exprChild.type === "UNSIGNED_INTEGER") {
                    subs.push({ kind: "literal", value: parseInt(exprChild.text, 10) });
                  } else {
                    subs.push({
                      kind: "expression",
                      cstBytes: [exprChild.startIndex ?? exprChild.startByte, exprChild.endIndex ?? exprChild.endByte],
                      text: exprChild.text,
                    });
                  }
                  continue;
                }
              }
              return subs;
            };

            // Navigate up to the Declaration node to get component-level subscripts (e.g. x[2])
            let declNode = cst as any;
            while (declNode && declNode.type !== "Declaration") {
              declNode = declNode.parent;
            }
            const declArraySubNode = declNode?.childForFieldName("arraySubscripts");
            const declSubscripts = declArraySubNode ? extractSubscripts(declArraySubNode) : [];

            // Navigate up to the ComponentClause to get type-level subscripts (e.g. Real[3])
            let clauseNode = cst as any;
            while (clauseNode && clauseNode.type !== "ComponentClause") {
              clauseNode = clauseNode.parent;
            }
            const clauseArraySubNode = clauseNode?.childForFieldName("arraySubscripts");
            const typeSubscripts = clauseArraySubNode ? extractSubscripts(clauseArraySubNode) : [];

            // Combine: component dimensions first, then type dimensions.
            // For `Real[3] x[2]`, this produces [2, 3] matching Modelica semantics.
            const subscripts = [...declSubscripts, ...typeSubscripts];

            // Also check if the resolved type has its own array dimensions (e.g. type T = Real[3])
            const classInstanceId = db.query<SymbolId | null>("classInstance", self.id);
            if (classInstanceId !== null) {
              const typeClassDims = db.query<any[] | null>("arrayDimensions", classInstanceId);
              if (typeClassDims && typeClassDims.length > 0) {
                subscripts.push(...typeClassDims);
              }
            }

            return subscripts.length > 0 ? subscripts : null;
          },

          /**
           * Resolve array dimensions to concrete numeric values.
           *
           * For literal dimensions, returns the value directly.
           * For expression dimensions (e.g. `size(y,1)`, `n+1`), evaluates
           * the expression by walking the CST and resolving name references.
           * For flexible dimensions (`:`), returns 0 (inferred from binding later).
           *
           * Uses Salsa cycle recovery: if evaluating a dimension expression
           * triggers a cycle (e.g. `x[size(y,1)], y[size(x,1)]`), the recovery
           * function returns null, signalling an unresolvable cycle.
           */
          resolvedArrayDimensions: {
            execute: (db: QueryDB, self: SymbolEntry): number[] | null => {
              if (evaluatingDimensionsStack.length === 0) {
                cyclicDimensionDiagnostics.clear();
                activeDimQueriesStack = [];
              }
              activeQueryDB = db;

              const rawDims = db.query<Array<
                | { kind: "literal"; value: number }
                | { kind: "flexible" }
                | { kind: "expression"; cstBytes: readonly [number, number]; text?: string }
              > | null>("arrayDimensions", self.id);
              if (!rawDims || rawDims.length === 0) return null;

              const shape: number[] = [];
              for (let i = 0; i < rawDims.length; i++) {
                const dim = rawDims[i];
                if (dim.kind === "literal") {
                  shape.push(dim.value);
                } else if (dim.kind === "flexible") {
                  shape.push(0); // Inferred from binding later
                } else if (dim.kind === "expression") {
                  evaluatingDimensionsStack.push({
                    symbolId: self.id,
                    dimIndex: i,
                    exprText: dim.text ?? "?",
                  });
                  let value: number | null = null;
                  try {
                    value = evaluateDimExpr(db, self, dim);
                  } finally {
                    evaluatingDimensionsStack.pop();
                  }
                  if (value === null) return null; // Could not resolve
                  shape.push(value);
                }
              }
              return shape;
            },
            // Salsa cycle recovery: trace the circular dependency and record diagnostic
            recovery: (cycle: any, self: SymbolEntry): number[] | null => {
              if (activeQueryDB) {
                const db = activeQueryDB;
                const firstIdx = evaluatingDimensionsStack.findIndex((f) => f.symbolId === self.id);
                if (firstIdx !== -1) {
                  const requestedDimIndex = activeDimQueriesStack[activeDimQueriesStack.length - 1]?.dimIndex ?? 0;
                  const rawDims = db.query<any[] | null>("arrayDimensions", self.id);
                  const requestedExprText = rawDims?.[requestedDimIndex]?.text ?? "?";

                  const cycleStartIdx = evaluatingDimensionsStack.findIndex((frame) => {
                    const name = db.symbol(frame.symbolId)?.name;
                    if (!name) return false;
                    const regex = new RegExp(`\\b${name}\\b`);
                    return regex.test(requestedExprText);
                  });

                  const cycleFrames =
                    cycleStartIdx !== -1
                      ? evaluatingDimensionsStack.slice(cycleStartIdx)
                      : evaluatingDimensionsStack.slice(firstIdx);

                  for (const frame of cycleFrames) {
                    if (frame.dimIndex !== -1) {
                      addCyclicDiagnostic(frame.symbolId, frame.dimIndex, frame.exprText);
                    }
                  }
                  addCyclicDiagnostic(self.id, requestedDimIndex, requestedExprText);
                }
              }
              return null;
            },
          },
        },
        model: {
          name: "ComponentDeclaration",
          specializable: true,
          visitable: true,
          properties: {},
          queryTypes: {
            typeSpecifier: "string | null",
            resolvedType: "SemanticNode | null",
            effectiveModification: "unknown",
            isConnectorType: "boolean",
            classInstance: "SymbolId | null",
            arrayDimensions:
              "({ kind: 'literal'; value: number } | { kind: 'flexible' } | { kind: 'expression'; cstBytes: readonly [number, number] })[] | null",
            resolvedArrayDimensions: "number[] | null",
            variability: "string | null",
            causality: "string | null",
            isFinal: "boolean",
            isEvaluate: "boolean",
            isInner: "boolean",
            isOuter: "boolean",
            isReplaceable: "boolean",
            isProtected: "boolean",
            flowPrefix: "string | null",
            isRedeclare: "boolean",
          },
        },
        lints: {
          /** Error when a cyclic dependency is detected in array dimensions. */
          cyclicDimensionDependency: (db: QueryDB, self: SymbolEntry) => {
            // Trigger evaluation to run recovery if circular
            db.query<number[] | null>("resolvedArrayDimensions", self.id);

            const diags = cyclicDimensionDiagnostics.get(self.id);
            if (diags && diags.length > 0) {
              const diag = diags[0];
              return error(
                `Dimension ${diag.dimIndex + 1} of ${self.name}, '${diag.exprText}', could not be evaluated due to a cyclic dependency.`,
              );
            }
            return null;
          },
          /** Warn if component name starts with an uppercase letter. */
          componentNamingConvention: (db: QueryDB, self: SymbolEntry) => {
            if (self.name && /^[A-Z]/.test(self.name)) {
              // Narrow to the component identifier token
              const cst = db.cstNode(self.id) as any;
              const identNode = cst?.childForFieldName("declaration")?.childForFieldName("identifier");
              if (identNode && typeof identNode.startIndex === "number") {
                return warning(`Component '${self.name}' should start with a lowercase letter`, {
                  startByte: identNode.startIndex,
                  endByte: identNode.endIndex,
                });
              }
              return warning(`Component '${self.name}' should start with a lowercase letter`, {
                field: "declaration.identifier",
              });
            }
            return null;
          },
          /** Validates that applied modifiers match an actual attribute or element in the component's type. */
          modifierNotFound: (db: QueryDB, self: SymbolEntry) => {
            const typeClassId = db.query<SymbolId | null>("classInstance", self.id);
            if (!typeClassId) return null;
            const typeEntry = db.symbol(typeClassId);
            if (!typeEntry) return null;

            const mod = db.query<any | null>("effectiveModification", self.id);
            if (!mod || !mod.args || mod.args.length === 0) return null;

            const declaredNames = new Set<string>();
            const isBuiltin = typeEntry.metadata?.isPredefined;
            if (isBuiltin || typeEntry.metadata?.classPrefixes === "enumeration") {
              for (const k of Object.keys(typeEntry.metadata || {})) {
                if (
                  k !== "classKind" &&
                  k !== "isPredefined" &&
                  k !== "description" &&
                  k !== "isEnumeration" &&
                  k !== "literals" &&
                  k !== "classPrefixes"
                ) {
                  declaredNames.add(k);
                }
              }
              if (typeEntry.metadata?.classPrefixes === "enumeration") {
                declaredNames.add("min");
                declaredNames.add("max");
                declaredNames.add("start");
                declaredNames.add("fixed");
              }
              if (typeEntry.name === "StateSelect") declaredNames.add("default");
            } else {
              const elements = db.query<SymbolId[]>("instantiate", typeClassId) || [];
              for (const eid of elements) {
                const child = db.symbol(eid);
                if (child && child.name && child.kind !== "Reference") declaredNames.add(child.name);
              }
            }

            const results = [];
            for (const arg of mod.args) {
              if (arg.name && arg.name !== "annotation" && !declaredNames.has(arg.name)) {
                if (arg.nameRange) {
                  results.push(
                    error(`Modifier '${arg.name}' not found in type '${typeEntry.name}'`, {
                      startByte: arg.nameRange[0],
                      endByte: arg.nameRange[1],
                    }),
                  );
                } else {
                  results.push(
                    error(`Modifier '${arg.name}' not found in type '${typeEntry.name}'`, {
                      field: "declaration.modification",
                    }),
                  );
                }
              }
            }
            return results.length > 0 ? results : null;
          },
          /** Error if duplicate element names exist in classModification. */
          duplicateModification: (db: QueryDB, self: SymbolEntry) => {
            const cst = db.cstNode(self.id) as any;
            if (!cst) return null;
            let current = cst;
            while (current && current.type !== "ComponentDeclaration") current = current.parent;

            const decl = current?.childForFieldName("declaration");
            if (!decl) return null;
            const mod = decl.childForFieldName("modification");
            if (!mod) return null;
            const classMod = mod.childForFieldName("classModification");
            if (!classMod) return null;

            const paths: string[] = [];
            const results = [];

            const walkMods = (node: any, prefix: string) => {
              if (node.type === "ElementModification") {
                const nameNode = node.childForFieldName("name");
                if (nameNode) {
                  const path = prefix ? prefix + "." + nameNode.text : nameNode.text;
                  const modExpr = node.childForFieldName("modification")?.childForFieldName("modificationExpression");
                  if (modExpr) {
                    if (paths.includes(path)) {
                      results.push(
                        error(`Duplicate modification of element '${path}'`, { field: "declaration.modification" }),
                      );
                    } else {
                      paths.push(path);
                    }
                  }

                  // Check nested classModification
                  const innerClassMod = node.childForFieldName("modification")?.childForFieldName("classModification");
                  if (innerClassMod) {
                    for (const child of innerClassMod.children) walkMods(child, path);
                  }
                }
              }
            };

            for (const child of classMod.children) walkMods(child, "");
            return results.length > 0 ? results : null;
          },
          /** Error if the component specifies a SysML implements target that cannot be resolved in the SysML index. */
          implementsTargetUnresolved: (db: QueryDB, self: SymbolEntry) => {
            const cst = db.cstNode(self.id) as any;
            let current = cst;
            while (current && current.type !== "ComponentDeclaration") current = current.parent;
            const ann = current?.childForFieldName("annotationClause");
            if (!ann) return null;
            const match = ann.text.match(/SysML\s*\(\s*implements\s*=\s*"([^"]+)"\s*\)/);
            const targetName = match ? match[1] : undefined;
            if (!targetName) return null;

            // In the unified workspace, SysML parts/requirements are registered
            // under byName. We can just check the simple name.
            // Ideally, we restrict it to sysml2 language or SysML specific definitions.
            const entries = db.byName(targetName);
            const foundSysML = entries.find(
              (e) =>
                e.language === "sysml2" && (e.kind === "Part" || e.kind === "Requirement" || e.kind === "Definition"),
            );

            if (!foundSysML) {
              return error(`SysML implements target '${targetName}' could not be resolved in the workspace`, {
                field: "description",
              });
            }
            return null;
          },
          /**
           * Error when the type specifier references an undefined class.
           * e.g. `F x;` where F doesn't exist in scope.
           */
          unresolvedTypeSpecifier: (db: QueryDB, self: SymbolEntry) => {
            const typeName = db.query<string | null>("typeSpecifier", self.id);
            if (!typeName) return null;

            // Skip built-in types
            const builtins = new Set(["Real", "Integer", "Boolean", "String"]);
            if (builtins.has(typeName)) return null;

            // Try to resolve via enclosing scope
            let found = false;
            if (self.parentId !== null) {
              const parent = db.symbol(self.parentId);
              if (parent && (parent.kind === "Class" || parent.kind === "Package")) {
                const resolve = db.query<(name: string) => SymbolEntry | null>("resolveSimpleName", parent.id);
                if (resolve) {
                  const resolved = resolve(typeName);
                  if (resolved) found = true;
                }
              }
            }

            // Fallback: global lookup
            if (!found) {
              const globals = db.byName(typeName);
              if (globals.length > 0) found = true;
            }

            if (!found) {
              const scopeName = self.parentId !== null ? (db.symbol(self.parentId)?.name ?? "<unknown>") : "<global>";
              return error(`Class '${typeName}' not found in scope ${scopeName}`, { field: "typeSpecifier" });
            }

            return null;
          },
          /**
           * Error when a component's type creates a recursive definition.
           * e.g. `class A  A a; end A;` — A contains itself.
           */
          recursiveDefinition: (db: QueryDB, self: SymbolEntry) => {
            const typeName = db.query<string | null>("typeSpecifier", self.id);
            if (!typeName) return null;

            // Skip built-in types
            const builtins = new Set(["Real", "Integer", "Boolean", "String"]);
            if (builtins.has(typeName)) return null;

            // Walk up the parent chain to check if any enclosing class
            // has the same name as the type specifier
            let current = self.parentId;
            while (current !== null) {
              const parent = db.symbol(current);
              if (!parent) break;
              if (parent.kind === "Class" && parent.name === typeName) {
                return error(`Declaration of element '${self.name}' causes recursive definition of class ${typeName}`, {
                  field: "typeSpecifier",
                });
              }
              current = parent.parentId;
            }

            return null;
          },
          /**
           * Error when a scalar binding expression is assigned to a composite type.
           * e.g. `X x = 1;` where X is a record with members.
           */
          typeMismatch: (db: QueryDB, self: SymbolEntry) => {
            const typeName = db.query<string | null>("typeSpecifier", self.id);
            if (!typeName) return null;

            // Skip built-in scalar types
            const builtins = new Set(["Real", "Integer", "Boolean", "String"]);
            if (builtins.has(typeName)) return null;

            // Use the structured effectiveModification query (Salsa-memoized)
            const mod = db.query<ModelicaModArgs | null>("effectiveModification", self.id);
            if (!mod) return null;

            // Only flag when there's a scalar binding (= expr) without class modification args
            // Class modifications like (x=1) are valid for composite types
            if (!mod.bindingExpression || mod.args.length > 0) return null;

            // Resolve the type
            const typeEntries = db.byName(typeName);
            const typeEntry = typeEntries?.find((e) => e.kind === "Class");
            if (!typeEntry) return null;

            // Check if the type has members (is composite)
            const children = db.childrenOf(typeEntry.id);
            const members = children.filter((c) => c.kind === "Component");
            if (members.length === 0) return null;

            // The type is composite but has a scalar binding — this is a type error
            return error(
              `Type mismatch: '${typeName}' is a composite type with ${members.length} member(s), cannot assign a scalar value`,
              { field: "declaration.modification" },
            );
          },
          /**
           * Error when a binding expression has an incompatible type.
           * e.g. `Integer y = x;` where x is Real (Real is not subtype of Integer).
           * e.g. `Integer y = 1.5;` (Real literal assigned to Integer).
           */
          bindingTypeMismatch: (db: QueryDB, self: SymbolEntry) => {
            type CSTNode = import("@modelscript/compiler/symbol-indexer").CSTNode;

            const declaredType = db.query<string | null>("typeSpecifier", self.id);
            if (!declaredType) return null;

            // Only check scalar built-in types for now
            const builtinScalars = new Set(["Real", "Integer", "Boolean", "String"]);
            if (!builtinScalars.has(declaredType)) return null;

            // Skip array types (handled by arrayElementTypeMismatch)
            const dims = db.query<Array<{ kind: string }> | null>("arrayDimensions", self.id);
            if (dims && dims.length > 0) return null;

            // Get the CST binding expression
            const cst = db.cstNode(self.id) as CSTNode | null;
            if (!cst) return null;
            const compDecl = cst.childForFieldName("componentDeclaration");
            if (!compDecl) return null;
            const decl = compDecl.childForFieldName("declaration");
            if (!decl) return null;
            const mod = decl.childForFieldName("modification");
            if (!mod) return null;
            const modExpr = mod.childForFieldName("modificationExpression");
            if (!modExpr) return null;
            const expr = modExpr.childForFieldName("expression");
            if (!expr) return null;

            // Map CST literal types to Modelica types
            const literalTypes: Record<string, string> = {
              UNSIGNED_INTEGER: "Integer",
              UNSIGNED_REAL: "Real",
              BOOLEAN: "Boolean",
              STRING: "String",
            };

            // Type compatibility: Integer is subtype of Real, but not vice versa
            const isSubtypeOf = (actual: string, expected: string): boolean => {
              if (actual === expected) return true;
              if (expected === "Real" && actual === "Integer") return true;
              return false;
            };

            // Infer the type of the expression
            let exprType: string | null = null;

            // Case 1: literal value
            const litType = literalTypes[expr.type];
            if (litType) {
              exprType = litType;
            }

            // Case 2: variable reference — resolve to get its declared type
            if (!exprType && expr.type === "ComponentReference") {
              const refName = expr.text.trim();
              // Resolve the referenced variable
              let refEntry: SymbolEntry | null = null;
              if (self.parentId !== null) {
                const parent = db.symbol(self.parentId);
                if (parent && (parent.kind === "Class" || parent.kind === "Package")) {
                  const resolve = db.query<(name: string) => SymbolEntry | null>("resolveSimpleName", parent.id);
                  if (resolve) refEntry = resolve(refName);
                }
              }
              if (!refEntry) {
                const globals = db.byName(refName);
                if (globals.length > 0) refEntry = globals[0];
              }
              if (refEntry) {
                const refMeta = refEntry.metadata as Record<string, unknown>;
                const refType = refMeta?.typeSpecifier as string | undefined;
                if (refType && builtinScalars.has(refType)) {
                  exprType = refType;
                }

                // Check dimension mismatch — e.g. Real y = x where x is Real[2]
                const refDims = db.query<Array<{ kind: string; value?: number }> | null>(
                  "arrayDimensions",
                  refEntry.id,
                );
                const selfDims = db.query<Array<{ kind: string; value?: number }> | null>("arrayDimensions", self.id);
                const refDimStr =
                  refDims && refDims.length > 0
                    ? `[${refDims.map((d) => (d.kind === "literal" ? d.value : ":")).join(",")}]`
                    : "[]";
                const selfDimStr =
                  selfDims && selfDims.length > 0
                    ? `[${selfDims.map((d) => (d.kind === "literal" ? d.value : ":")).join(",")}]`
                    : "[]";

                if (refDimStr !== selfDimStr) {
                  return error(
                    `Type mismatch in binding '${self.name} = ${refName}', expected array dimensions ${selfDimStr}, got ${refDimStr}`,
                    { field: "declaration.modification" },
                  );
                }
              }
            }

            if (exprType && !isSubtypeOf(exprType, declaredType)) {
              return error(`Type mismatch in binding: expected subtype of ${declaredType}, got type ${exprType}`, {
                field: "declaration.modification",
              });
            }

            return null;
          },
          /**
           * Error when an array initializer has a different number of elements
           * than the declared array dimension.
           * e.g. `Real[2] x = {1,2,3};` — declared size 2 but 3 elements.
           */
          arrayShapeMismatch: (db: QueryDB, self: SymbolEntry) => {
            type CSTNode = import("@modelscript/compiler/symbol-indexer").CSTNode;

            // Get declared dimensions via query
            const dims = db.query<Array<{ kind: string; value?: number }> | null>("arrayDimensions", self.id);
            if (!dims || dims.length === 0) return null;

            // Only check the first dimension for now, and only if it's a literal
            const firstDim = dims[0];
            if (firstDim.kind !== "literal" || !firstDim.value) return null;
            const declaredSize = firstDim.value;

            // Get the CST node and find the modification expression
            const cst = db.cstNode(self.id) as CSTNode | null;
            if (!cst) return null;

            // Navigate: ComponentClause → componentDeclaration → declaration → modification
            const compDecl = cst.childForFieldName("componentDeclaration");
            if (!compDecl) return null;
            const decl = compDecl.childForFieldName("declaration");
            if (!decl) return null;
            const mod = decl.childForFieldName("modification");
            if (!mod) return null;

            // Find the modificationExpression (the '= expr' part)
            const modExpr = mod.childForFieldName("modificationExpression");
            if (!modExpr) return null;

            // Find the expression child
            const expr = modExpr.childForFieldName("expression");
            if (!expr) return null;

            // Check if the expression is an ArrayConstructor { ... }
            if (expr.type !== "ArrayConstructor") return null;

            // Count elements in the expression list
            const exprList = expr.childForFieldName("expressionList");
            if (!exprList) return null;

            let elementCount = 0;
            for (const child of exprList.children) {
              // Count named expression children (skip commas and other tokens)
              if (child.type !== ",") elementCount++;
            }

            if (elementCount !== declaredSize) {
              return error(
                `Array shape mismatch: declared size [${declaredSize}] but initializer has ${elementCount} element(s)`,
                { field: "declaration.modification" },
              );
            }

            return null;
          },
          /**
           * Error when array initializer elements don't match the declared
           * base type.
           * e.g. `Integer[2] x = {1, 2.5};` — 2.5 is Real, not Integer.
           * e.g. `B[2] b = {1, 2};` — scalars where composite expected.
           * e.g. `B[2] b = {B(1,1), C(2)};` — C is not B.
           */
          arrayElementTypeMismatch: (db: QueryDB, self: SymbolEntry) => {
            type CSTNode = import("@modelscript/compiler/symbol-indexer").CSTNode;

            const typeName = db.query<string | null>("typeSpecifier", self.id);
            if (!typeName) return null;

            // Must have array dimensions
            const dims = db.query<Array<{ kind: string; value?: number }> | null>("arrayDimensions", self.id);
            if (!dims || dims.length === 0) return null;

            // Get the CST to find the initializer expression
            const cst = db.cstNode(self.id) as CSTNode | null;
            if (!cst) return null;

            const compDecl = cst.childForFieldName("componentDeclaration");
            if (!compDecl) return null;
            const decl = compDecl.childForFieldName("declaration");
            if (!decl) return null;
            const mod = decl.childForFieldName("modification");
            if (!mod) return null;
            const modExpr = mod.childForFieldName("modificationExpression");
            if (!modExpr) return null;
            const expr = modExpr.childForFieldName("expression");
            if (!expr) return null;

            // Must be an ArrayConstructor { ... }
            if (expr.type !== "ArrayConstructor") return null;
            const exprList = expr.childForFieldName("expressionList");
            if (!exprList) return null;

            // Map CST literal node types to Modelica types
            const nodeTypeToModelica: Record<string, string> = {
              UNSIGNED_INTEGER: "Integer",
              UNSIGNED_REAL: "Real",
              BOOLEAN: "Boolean",
              STRING: "String",
            };

            // Infer the Modelica type of an expression CST node
            const inferElementType = (node: CSTNode): string | null => {
              // Literal nodes
              const literal = nodeTypeToModelica[node.type];
              if (literal) return literal;
              // FunctionCall (constructor): B(1,1) → type "B"
              if (node.type === "FunctionCall") {
                const funcRef = node.childForFieldName("functionReference");
                if (funcRef) return funcRef.text.trim();
              }
              // ComponentReference (variable)
              if (node.type === "ComponentReference") {
                return node.text.trim();
              }
              return null;
            };

            // Determine if the base type is a built-in scalar
            const builtinScalars = new Set(["Real", "Integer", "Boolean", "String"]);
            const isScalarBaseType = builtinScalars.has(typeName);

            // Type compatibility: Integer is a subtype of Real
            const isCompatible = (elementType: string, declaredType: string): boolean => {
              if (elementType === declaredType) return true;
              if (declaredType === "Real" && elementType === "Integer") return true;
              return false;
            };

            // Format dimension suffix like "[2]"
            const dimSuffix =
              dims.length > 0 ? `[${dims.map((d) => (d.kind === "literal" ? d.value : ":")).join(",")}]` : "";

            // Check each element
            let argIndex = 0;
            for (const child of exprList.children) {
              if (child.type === ",") continue;
              argIndex++;

              const elemType = inferElementType(child);
              if (!elemType) continue;

              if (!isCompatible(elemType, typeName)) {
                return error(
                  `Array type mismatch. Argument ${argIndex} (${child.text.trim()}) has type ${elemType} whereas ${typeName}${dimSuffix} expects type ${typeName}`,
                  { field: "declaration.modification" },
                );
              }
            }

            return null;
          },
          /**
           * Error when a binding expression references an undefined variable.
           * e.g. `constant Real x = y;` where y doesn't exist in scope.
           */
          unresolvedReference: (db: QueryDB, self: SymbolEntry) => {
            type CSTNode = import("@modelscript/compiler/symbol-indexer").CSTNode;

            // Get the CST node
            const cst = db.cstNode(self.id) as CSTNode | null;
            if (!cst) return null;

            // Navigate to the modification expression
            const compDecl = cst.childForFieldName("componentDeclaration");
            if (!compDecl) return null;
            const decl = compDecl.childForFieldName("declaration");
            if (!decl) return null;
            const mod = decl.childForFieldName("modification");
            if (!mod) return null;
            const modExpr = mod.childForFieldName("modificationExpression");
            if (!modExpr) return null;
            const expr = modExpr.childForFieldName("expression");
            if (!expr) return null;

            // Get the enclosing scope's resolveSimpleName function
            let resolve: ((name: string) => SymbolEntry | null) | null = null;
            if (self.parentId !== null) {
              const parent = db.symbol(self.parentId);
              if (parent && (parent.kind === "Class" || parent.kind === "Package")) {
                resolve = db.query<(name: string) => SymbolEntry | null>("resolveSimpleName", parent.id);
              }
            }

            // Collect all ComponentReference nodes in the expression
            const unresolvedRefs: string[] = [];
            const builtinScalars = new Set(["Real", "Integer", "Boolean", "String", "true", "false", "time"]);

            const walkForRefs = (node: CSTNode) => {
              if (node.type === "ComponentReference") {
                const refName = node.text.trim();
                // Skip built-in names and keywords
                if (builtinScalars.has(refName)) return;
                // Skip if it's the component's own name
                if (refName === self.name) return;

                // Try to resolve
                let found = false;
                if (resolve) {
                  const resolved = resolve(refName);
                  if (resolved) found = true;
                }
                if (!found) {
                  // Fallback: global lookup
                  const globals = db.byName(refName);
                  if (globals.length > 0) found = true;
                }
                if (!found) {
                  unresolvedRefs.push(refName);
                }
                return; // Don't recurse into ComponentReference children
              }
              // Recurse into children
              for (const child of node.children) {
                walkForRefs(child);
              }
            };

            walkForRefs(expr);

            if (unresolvedRefs.length > 0) {
              // Determine the enclosing scope name
              const scopeName = self.parentId !== null ? (db.symbol(self.parentId)?.name ?? "<unknown>") : "<global>";

              return error(`Variable '${unresolvedRefs[0]}' not found in scope ${scopeName}`, {
                field: "declaration.modification",
              });
            }

            return null;
          },
          /**
           * Error when a function call has wrong number of arguments.
           * e.g. `Real x = X(2,3);` where X takes 1 input.
           */
          functionCallMismatch: (db: QueryDB, self: SymbolEntry) => {
            type CSTNode = import("@modelscript/compiler/symbol-indexer").CSTNode;

            // Get the CST binding expression
            const cst = db.cstNode(self.id) as CSTNode | null;
            if (!cst) return null;
            const compDecl = cst.childForFieldName("componentDeclaration");
            if (!compDecl) return null;
            const decl = compDecl.childForFieldName("declaration");
            if (!decl) return null;
            const mod = decl.childForFieldName("modification");
            if (!mod) return null;
            const modExpr = mod.childForFieldName("modificationExpression");
            if (!modExpr) return null;
            const expr = modExpr.childForFieldName("expression");
            if (!expr) return null;

            // Find all FunctionCall nodes (could be nested)
            const functionCalls: CSTNode[] = [];
            const collectFunctionCalls = (node: CSTNode) => {
              if (node.type === "FunctionCall") {
                functionCalls.push(node);
              }
              for (const child of node.children) {
                collectFunctionCalls(child);
              }
            };
            collectFunctionCalls(expr);

            if (functionCalls.length === 0) return null;

            // Map literal node types for signature display
            const nodeTypeToModelica: Record<string, string> = {
              UNSIGNED_INTEGER: "Integer",
              UNSIGNED_REAL: "Real",
              BOOLEAN: "Boolean",
              STRING: "String",
            };

            // Resolve function name in scope
            let resolve: ((name: string) => SymbolEntry | null) | null = null;
            if (self.parentId !== null) {
              const parent = db.symbol(self.parentId);
              if (parent && (parent.kind === "Class" || parent.kind === "Package")) {
                resolve = db.query<(name: string) => SymbolEntry | null>("resolveSimpleName", parent.id);
              }
            }

            const scopeName = self.parentId !== null ? (db.symbol(self.parentId)?.name ?? "") : "";

            for (const call of functionCalls) {
              const funcRef = call.childForFieldName("functionReference");
              if (!funcRef) continue;
              const funcName = funcRef.text.trim();

              // Resolve the function
              let funcEntry: SymbolEntry | null = null;
              if (resolve) funcEntry = resolve(funcName);
              if (!funcEntry) {
                const globals = db.byName(funcName);
                funcEntry = globals.find((e) => e.kind === "Class") ?? null;
              }
              if (!funcEntry) continue;

              // Check if it's a function (classPrefixes contains "function")
              const funcMeta = funcEntry.metadata as Record<string, unknown>;
              const prefixes = funcMeta?.classPrefixes as string | undefined;
              if (!prefixes || !prefixes.includes("function")) continue;

              // Get input parameters
              const inputs = db.query<SymbolEntry[]>("inputParameters", funcEntry.id);
              if (!inputs) continue;

              // Count actual arguments
              const callArgs = call.childForFieldName("functionCallArguments");
              if (!callArgs) continue;

              let actualArgCount = 0;
              const actualArgTypes: string[] = [];
              const actualArgEntries: (SymbolEntry | null)[] = [];
              for (const child of callArgs.children) {
                if (child.type === "FunctionArgument") {
                  actualArgCount++;
                  // Try to infer argument type from the expression child
                  const argExpr = child.childForFieldName("expression");
                  if (argExpr) {
                    // Literal types
                    const litType = nodeTypeToModelica[argExpr.type];
                    if (litType) {
                      actualArgTypes.push(litType);
                      actualArgEntries.push(null);
                    } else if (argExpr.type === "ComponentReference") {
                      // Variable reference — resolve to get declared type
                      const refName = argExpr.text.trim();
                      let refEntry: SymbolEntry | null = null;
                      if (resolve) refEntry = resolve(refName);
                      if (!refEntry) {
                        const globals = db.byName(refName);
                        if (globals.length > 0) refEntry = globals[0];
                      }
                      if (refEntry) {
                        const refType = db.query<string | null>("typeSpecifier", refEntry.id);
                        actualArgTypes.push(refType ?? "?");
                        actualArgEntries.push(refEntry);
                      } else {
                        actualArgTypes.push("?");
                        actualArgEntries.push(null);
                      }
                    } else {
                      actualArgTypes.push("?");
                      actualArgEntries.push(null);
                    }
                  } else {
                    actualArgTypes.push("?");
                    actualArgEntries.push(null);
                  }
                } else if (child.type === "NamedArgument") {
                  actualArgCount++;
                  actualArgTypes.push("?");
                  actualArgEntries.push(null);
                }
              }

              // Type compatibility check
              const isSubtypeOf = (actual: string, expected: string): boolean => {
                if (actual === expected) return true;
                if (expected === "Real" && actual === "Integer") return true;
                return false;
              };

              // Helper to build qualified name and candidate signature
              const qualName = scopeName ? `${scopeName}.${funcName}` : funcName;
              const buildCandidateSig = () => {
                const candidateSig = inputs
                  .map((inp) => {
                    const inpType = db.query<string | null>("typeSpecifier", inp.id) ?? "?";
                    return `${inpType} ${inp.name}`;
                  })
                  .join(", ");
                const outputs = db.query<SymbolEntry[]>("outputParameters", funcEntry!.id);
                const outputType =
                  outputs && outputs.length > 0
                    ? (db.query<string | null>("typeSpecifier", outputs[0].id) ?? "?")
                    : "void";
                return { candidateSig, outputType };
              };

              if (actualArgCount !== inputs.length) {
                // Arity mismatch
                const actualSig = actualArgTypes
                  .map(
                    (t, i) =>
                      `/*${t}*/ ${callArgs.children.filter((c) => c.type === "FunctionArgument" || c.type === "NamedArgument")[i]?.text.trim() ?? "?"}`,
                  )
                  .join(", ");
                const { candidateSig, outputType } = buildCandidateSig();

                return error(
                  `No matching function found for ${qualName}(${actualSig}).\nCandidates are:\n  ${qualName}(${candidateSig}) => ${outputType}`,
                  { field: "declaration.modification" },
                );
              }

              // Arity matches — check each argument type
              for (let i = 0; i < actualArgTypes.length; i++) {
                const actualType = actualArgTypes[i];
                if (actualType === "?") continue; // Can't infer, skip

                const expectedType = db.query<string | null>("typeSpecifier", inputs[i].id);
                if (!expectedType) continue;

                if (!isSubtypeOf(actualType, expectedType)) {
                  const argNodes = callArgs.children.filter(
                    (c) => c.type === "FunctionArgument" || c.type === "NamedArgument",
                  );
                  const argText = argNodes[i]?.text.trim() ?? "?";

                  return error(
                    `Type mismatch for positional argument ${i + 1} in ${qualName}(${inputs[i].name}=${argText}). The argument has type:\n  ${actualType}\nexpected type:\n  ${expectedType}`,
                    { field: "declaration.modification" },
                  );
                }

                // Check for array/scalar dimension mismatch (vectorization)
                if (actualArgEntries[i]) {
                  const argEntry = actualArgEntries[i]!;
                  const argDims = db.query<Array<{ kind: string; value?: number }> | null>(
                    "arrayDimensions",
                    argEntry.id,
                  );
                  // Check if parameter expects scalar but argument is array
                  const paramDims = db.query<Array<{ kind: string; value?: number }> | null>(
                    "arrayDimensions",
                    inputs[i].id,
                  );
                  if (argDims && argDims.length > 0 && (!paramDims || paramDims.length === 0)) {
                    // This call would vectorize — check if declared type has matching dimensions
                    const selfDims = db.query<Array<{ kind: string; value?: number }> | null>(
                      "arrayDimensions",
                      self.id,
                    );
                    const argDimStr = `[${argDims.map((d) => (d.kind === "literal" ? d.value : ":")).join(",")}]`;
                    const selfDimStr =
                      selfDims && selfDims.length > 0
                        ? `[${selfDims.map((d) => (d.kind === "literal" ? d.value : ":")).join(",")}]`
                        : "[]";

                    if (selfDimStr !== argDimStr) {
                      const argNodes = callArgs.children.filter(
                        (c) => c.type === "FunctionArgument" || c.type === "NamedArgument",
                      );
                      const argText = argNodes[i]?.text.trim() ?? "?";
                      const vectorized = `{${qualName}(${argText}[$i1]) for $i1 in 1:${argDims[0]?.value ?? "n"}}`;
                      return error(
                        `Type mismatch in binding '${self.name} = ${vectorized}', expected array dimensions ${selfDimStr}, got ${argDimStr}`,
                        { field: "declaration.modification" },
                      );
                    }
                  }
                }
              }
            }

            return null;
          },
          evolutionCheck: (db, self, previous) => {
            if (previous) {
              const prevMeta = previous.metadata as Record<string, unknown>;
              const currMeta = self.metadata as Record<string, unknown>;
              if (prevMeta.visibility === "public" && currMeta.visibility === "protected") {
                return error("Breaking API Change: Cannot narrow visibility of an existing component.", {
                  field: "declaration.identifier",
                });
              }
            }
            return null;
          },
        },
        diff: {
          ignore: ["annotationClause", "description"],
          minor: ["visibility"],
          breaking: ["typeSpecifier", "causality", "isParameter"],
        },
        adapters: {
          sysml2: {
            target: "PartUsage",
            transform: (db, self) => ({
              name: (self as SymbolEntry).name,
              typeName: ((self as SymbolEntry).metadata as Record<string, unknown>)?.typeSpecifier as
                | string
                | undefined,
              direction: (((self as SymbolEntry).metadata as Record<string, unknown>)?.causality as string) ?? null,
              isParameter: ((self as SymbolEntry).metadata as Record<string, unknown>)?.variability === "parameter",
            }),
          },
        },
        graphics: (self) => ({
          role: "port-owner" as const,
          node: {
            shape: "rect",
            markup: [
              { tagName: "rect", selector: "body" },
              { tagName: "text", selector: "label" },
            ],
            attrs: {
              body: { fill: "#e8f5e9", stroke: "#43a047", strokeWidth: 1.5, rx: 2, ry: 2 },
              label: { text: "{{name}}", fill: "#1b5e20", fontSize: 11, textAnchor: "middle", refX: 0.5, refY: 0.5 },
            },
            size: { width: 120, height: 30 },
          },
        }),
      }),

    ConditionAttribute: ($) => seq("if", field("condition", $._Expression)),

    Declaration: ($) =>
      seq(
        field("identifier", $.IDENT),
        optional(field("arraySubscripts", $.ArraySubscripts)),
        optional(field("modification", $.Modification)),
      ),

    // =====================================================================
    // §A.2.5 — Modification
    // =====================================================================

    Modification: ($) =>
      choice(
        seq(
          field("classModification", $.ClassModification),
          optional(seq("=", field("modificationExpression", $.ModificationExpression))),
        ),
        seq("=", field("modificationExpression", $.ModificationExpression)),
      ),

    ModificationExpression: ($) => choice(field("expression", $._Expression), field("break", "break")),

    ClassModification: ($) => seq("(", commaSep(field("modificationArgument", $._ModificationArgument)), ")"),

    _ModificationArgument: ($) => choice($.ElementModification, $.ElementRedeclaration),

    ElementModification: ($) =>
      seq(
        optional(field("each", "each")),
        optional(field("final", "final")),
        field("name", $.Name),
        optional(field("modification", $.Modification)),
        optional(field("description", $.Description)),
      ),

    ElementRedeclaration: ($) =>
      seq(
        optional(field("redeclare", "redeclare")),
        optional(field("each", "each")),
        optional(field("final", "final")),
        optional(field("replaceable", "replaceable")),
        choice(field("classDefinition", $.ShortClassDefinition), field("componentClause", $.ComponentClause1)),
      ),

    ComponentClause1: ($) =>
      seq(
        optional(field("flow", choice("flow", "stream"))),
        optional(field("variability", choice("discrete", "parameter", "constant"))),
        optional(field("causality", choice("input", "output"))),
        field("typeSpecifier", $.TypeSpecifier),
        field("componentDeclaration", $.ComponentDeclaration1),
        optional(field("constrainingClause", $.ConstrainingClause)),
      ),

    ComponentDeclaration1: ($) =>
      seq(
        field("declaration", $.Declaration),
        optional(field("description", $.Description)),
        optional(field("annotationClause", $.AnnotationClause)),
      ),

    ShortClassDefinition: ($) =>
      def({
        syntax: seq(
          field("classPrefixes", $.ClassPrefixes),
          field("classSpecifier", $.ShortClassSpecifier),
          optional(field("constrainingClause", $.ConstrainingClause)),
        ),
        symbol: (self) => ({
          kind: "Class",
          name: self.classSpecifier.identifier,
          attributes: {
            classPrefixes: self.classPrefixes,
            enumeration: (self.classSpecifier as any).enumeration,
          },
        }),
        model: {
          name: "ShortClassDefinition",
          visitable: true,
          specializable: true,
        },
      }),

    // =====================================================================
    // §A.2.6 — Equations
    // =====================================================================

    EquationSection: ($) =>
      seq(
        optional(field("initial", "initial")),
        "equation",
        repeat(field("equation", $._Equation)),
        optional(seq(field("annotationClause", $.AnnotationClause), ";")),
      ),

    AlgorithmSection: ($) =>
      seq(
        optional(field("initial", "initial")),
        "algorithm",
        repeat(field("statement", $._Statement)),
        optional(seq(field("annotationClause", $.AnnotationClause), ";")),
      ),

    ConstraintSection: ($) =>
      seq(
        optional(field("initial", "initial")),
        "constraint",
        repeat(field("equation", $._Equation)),
        optional(seq(field("annotationClause", $.AnnotationClause), ";")),
      ),

    _Equation: ($) =>
      choice($.SimpleEquation, $.SpecialEquation, $.IfEquation, $.ForEquation, $.ConnectEquation, $.WhenEquation),

    _Statement: ($) =>
      choice(
        $.SimpleAssignmentStatement,
        $.ProcedureCallStatement,
        $.ComplexAssignmentStatement,
        $.BreakStatement,
        $.ReturnStatement,
        $.IfStatement,
        $.ForStatement,
        $.WhileStatement,
        $.WhenStatement,
      ),

    SimpleAssignmentStatement: ($) =>
      seq(
        field("target", $.ComponentReference),
        choice(":=", "="),
        field("source", $._Expression),
        optional(field("description", $.Description)),
        optional(field("annotationClause", $.AnnotationClause)),
        ";",
      ),

    ProcedureCallStatement: ($) =>
      seq(
        field("functionReference", $.ComponentReference),
        field("functionCallArguments", $.FunctionCallArguments),
        optional(field("description", $.Description)),
        optional(field("annotationClause", $.AnnotationClause)),
        ";",
      ),

    ComplexAssignmentStatement: ($) =>
      seq(
        field("outputExpressionList", $.OutputExpressionList),
        choice(":=", "="),
        field("functionReference", $.ComponentReference),
        field("functionCallArguments", $.FunctionCallArguments),
        optional(field("description", $.Description)),
        optional(field("annotationClause", $.AnnotationClause)),
        ";",
      ),

    SimpleEquation: ($) =>
      seq(
        field("expression1", $._SimpleExpression),
        field("operator", choice("=", "<=", ">=", "<", ">")),
        field("expression2", $._Expression),
        optional(field("description", $.Description)),
        optional(field("annotationClause", $.AnnotationClause)),
        ";",
      ),

    SpecialEquation: ($) =>
      seq(
        field("functionReference", $.ComponentReference),
        field("functionCallArguments", $.FunctionCallArguments),
        optional(field("description", $.Description)),
        optional(field("annotationClause", $.AnnotationClause)),
        ";",
      ),

    BreakStatement: ($) =>
      seq(
        "break",
        optional(field("description", $.Description)),
        optional(field("annotationClause", $.AnnotationClause)),
        ";",
      ),

    ReturnStatement: ($) =>
      seq(
        "return",
        optional(field("description", $.Description)),
        optional(field("annotationClause", $.AnnotationClause)),
        ";",
      ),

    IfEquation: ($) =>
      seq(
        "if",
        field("condition", $._Expression),
        "then",
        repeat(field("equation", $._Equation)),
        repeat(field("elseIfEquationClause", $.ElseIfEquationClause)),
        optional(seq("else", repeat(field("elseEquation", $._Equation)))),
        "end",
        "if",
        optional(field("description", $.Description)),
        optional(field("annotationClause", $.AnnotationClause)),
        ";",
      ),

    ElseIfEquationClause: ($) =>
      seq("elseif", field("condition", $._Expression), "then", repeat(field("equation", $._Equation))),

    IfStatement: ($) =>
      seq(
        "if",
        field("condition", $._Expression),
        "then",
        repeat(field("statement", $._Statement)),
        repeat(field("elseIfStatementClause", $.ElseIfStatementClause)),
        optional(seq("else", repeat(field("elseStatement", $._Statement)))),
        "end",
        "if",
        optional(field("description", $.Description)),
        optional(field("annotationClause", $.AnnotationClause)),
        ";",
      ),

    ElseIfStatementClause: ($) =>
      seq("elseif", field("condition", $._Expression), "then", repeat(field("statement", $._Statement))),

    ForEquation: ($) =>
      seq(
        "for",
        commaSep1(field("forIndex", $.ForIndex)),
        "loop",
        repeat(field("equation", $._Equation)),
        "end",
        "for",
        optional(field("description", $.Description)),
        optional(field("annotationClause", $.AnnotationClause)),
        ";",
      ),

    ForStatement: ($) =>
      seq(
        "for",
        commaSep1(field("forIndex", $.ForIndex)),
        "loop",
        repeat(field("statement", $._Statement)),
        "end",
        "for",
        optional(field("description", $.Description)),
        optional(field("annotationClause", $.AnnotationClause)),
        ";",
      ),

    ForIndex: ($) => seq(field("identifier", $.IDENT), optional(seq("in", field("expression", $._Expression)))),

    WhileStatement: ($) =>
      seq(
        "while",
        field("condition", $._Expression),
        "loop",
        repeat(field("statement", $._Statement)),
        "end",
        "while",
        optional(field("description", $.Description)),
        optional(field("annotationClause", $.AnnotationClause)),
        ";",
      ),

    WhenEquation: ($) =>
      seq(
        "when",
        field("condition", $._Expression),
        "then",
        repeat(field("equation", $._Equation)),
        repeat(field("elseWhenEquationClause", $.ElseWhenEquationClause)),
        "end",
        "when",
        optional(field("description", $.Description)),
        optional(field("annotationClause", $.AnnotationClause)),
        ";",
      ),

    ElseWhenEquationClause: ($) =>
      seq("elsewhen", field("condition", $._Expression), "then", repeat(field("equation", $._Equation))),

    WhenStatement: ($) =>
      seq(
        "when",
        field("condition", $._Expression),
        "then",
        repeat(field("statement", $._Statement)),
        repeat(field("elseWhenStatementClause", $.ElseWhenStatementClause)),
        "end",
        "when",
        optional(field("description", $.Description)),
        optional(field("annotationClause", $.AnnotationClause)),
        ";",
      ),

    ElseWhenStatementClause: ($) =>
      seq("elsewhen", field("condition", $._Expression), "then", repeat(field("statement", $._Statement))),

    ConnectEquation: ($) =>
      def({
        syntax: seq(
          "connect",
          "(",
          field("componentReference1", $.ComponentReference),
          ",",
          field("componentReference2", $.ComponentReference),
          ")",
          optional(field("description", $.Description)),
          optional(field("annotationClause", $.AnnotationClause)),
          ";",
        ),
        symbol: (self) => ({
          kind: "ConnectEquation",
          name: self.componentReference1,
          attributes: {
            ref1: self.componentReference1,
            ref2: self.componentReference2,
          },
        }),
        queries: {
          /**
           * Validate that both sides of the connect equation reference
           * connector-typed components, and that they are plug-compatible.
           */
          validateConnect: (db: QueryDB, self: SymbolEntry) => {
            const meta = self.metadata as Record<string, unknown>;
            const ref1Name = typeof meta?.ref1 === "string" ? meta.ref1 : null;
            const ref2Name = typeof meta?.ref2 === "string" ? meta.ref2 : null;
            if (!ref1Name || !ref2Name) return { valid: false, reason: "unresolved" };

            // Resolve both component references
            const ref1Entries = db.byName(ref1Name);
            const ref2Entries = db.byName(ref2Name);
            if (!ref1Entries?.length || !ref2Entries?.length) {
              return { valid: false, reason: "not found" };
            }
            return { valid: true, reason: null };
          },
        },
        model: {
          name: "ConnectEquation",
          visitable: true,
          queryTypes: {
            validateConnect: "{ valid: boolean; reason: string | null }",
          },
        },
        lints: {
          /**
           * Error when a connect argument is not a connector type.
           * e.g. `connect(x, y)` where x/y are plain Real variables.
           */
          nonConnectorType: (db: QueryDB, self: SymbolEntry) => {
            type CSTNode = import("@modelscript/compiler/symbol-indexer").CSTNode;

            const meta = self.metadata as Record<string, unknown>;
            const ref1Name = typeof meta?.ref1 === "string" ? meta.ref1 : null;
            const ref2Name = typeof meta?.ref2 === "string" ? meta.ref2 : null;

            const builtinScalars = new Set(["Real", "Integer", "Boolean", "String"]);

            // Primary: resolve via symbol index
            let resolve: ((name: string) => SymbolEntry | null) | null = null;
            if (self.parentId !== null) {
              const parent = db.symbol(self.parentId);
              if (parent && (parent.kind === "Class" || parent.kind === "Package")) {
                resolve = db.query<(name: string) => SymbolEntry | null>("resolveSimpleName", parent.id);
              }
            }

            // CST fallback: get the parent class's CST node to find component types
            const getTypeFromCST = (refName: string): string | null => {
              if (self.parentId === null) return null;
              const parentCst = db.cstNode(self.parentId) as CSTNode | null;
              if (!parentCst) return null;
              const search = (node: CSTNode): string | null => {
                if (node.type === "ComponentClause") {
                  const ts = node.childForFieldName("typeSpecifier");
                  const tn = ts?.text.trim() ?? null;
                  for (const c of node.children) {
                    if (c.type === "ComponentDeclaration") {
                      const d = c.childForFieldName("declaration");
                      const id = d?.childForFieldName("identifier");
                      if (id && id.text.trim() === refName) return tn;
                    }
                  }
                }
                for (const c of node.children) {
                  const r = search(c);
                  if (r !== null) return r;
                }
                return null;
              };
              return search(parentCst);
            };

            const checkRef = (refName: string, fieldName: string) => {
              // Try symbol-based resolution first
              let refEntry: SymbolEntry | null = null;
              if (resolve) refEntry = resolve(refName);
              if (!refEntry) {
                const entries = db.byName(refName);
                if (entries?.length) refEntry = entries[0];
              }
              if (refEntry && refEntry.kind === "Component") {
                const typeName = db.query<string | null>("typeSpecifier", refEntry.id);
                if (typeName && builtinScalars.has(typeName)) {
                  return error(`'${refName}' is not a valid connector`, { field: fieldName });
                }
                const isConnector = db.query<boolean>("isConnectorType", refEntry.id);
                if (isConnector === false) {
                  return error(`'${refName}' is not a valid connector`, { field: fieldName });
                }
                return null;
              }

              // Fallback: CST-based type lookup
              const cstType = getTypeFromCST(refName);
              if (cstType && builtinScalars.has(cstType)) {
                return error(`'${refName}' is not a valid connector`, { field: fieldName });
              }

              return null;
            };

            const diagnostics = [];
            if (ref1Name) {
              const err = checkRef(ref1Name, "componentReference1");
              if (err) diagnostics.push(err);
            }
            if (ref2Name) {
              const err = checkRef(ref2Name, "componentReference2");
              if (err) diagnostics.push(err);
            }

            return diagnostics.length > 0 ? diagnostics : null;
          },
        },
        graphics: (self) => ({
          role: "edge" as const,
          edge: {
            shape: "edge",
            source: self.componentReference1,
            target: self.componentReference2,
            attrs: {
              line: { stroke: "#c62828", strokeWidth: 2, targetMarker: "classic" },
            },
            labels: [
              {
                attrs: {
                  text: { text: "connect", fill: "#c62828", fontSize: 10 },
                  rect: { fill: "#fff", stroke: "none", rx: 3, ry: 3 },
                },
                position: { distance: 0.5, offset: 0 },
              },
            ],
            router: "manhattan",
            connector: "rounded",
          },
        }),
      }),

    _Expression: ($) => choice($.IfElseExpression, $.RangeExpression, $._SimpleExpression),

    IfElseExpression: ($) =>
      seq(
        "if",
        field("condition", $._Expression),
        "then",
        field("expression", $._Expression),
        repeat(field("elseIfExpressionClause", $.ElseIfExpressionClause)),
        "else",
        field("elseExpression", $._Expression),
      ),

    ElseIfExpressionClause: ($) =>
      seq("elseif", field("condition", $._Expression), "then", field("expression", $._Expression)),

    RangeExpression: ($) =>
      choice(
        seq(
          field("startExpression", $._SimpleExpression),
          ":",
          field("stepExpression", $._SimpleExpression),
          ":",
          field("stopExpression", $._SimpleExpression),
        ),
        seq(field("startExpression", $._SimpleExpression), ":", field("stopExpression", $._SimpleExpression)),
      ),

    _SimpleExpression: ($) => choice($.UnaryExpression, $.BinaryExpression, $._PrimaryExpression),

    UnaryExpression: ($) =>
      choice(
        prec(PREC.UNARY_NEGATION, unaryExp("not", $._SimpleExpression)),
        prec(PREC.ADDITIVE_UNARY, unaryExp("+", $._SimpleExpression)),
        prec(PREC.ADDITIVE_UNARY, unaryExp("-", $._SimpleExpression)),
        prec(PREC.ADDITIVE_UNARY, unaryExp(".+", $._SimpleExpression)),
        prec(PREC.ADDITIVE_UNARY, unaryExp(".-", $._SimpleExpression)),
      ),

    BinaryExpression: ($) =>
      choice(
        // Logical operators
        prec.left(PREC.LOGICAL_OR, binaryExp("or", $._SimpleExpression, $._SimpleExpression)),
        prec.left(PREC.LOGICAL_AND, binaryExp("and", $._SimpleExpression, $._SimpleExpression)),
        // Relational operators
        prec.right(PREC.RELATIONAL, binaryExp("<", $._SimpleExpression, $._SimpleExpression)),
        prec.right(PREC.RELATIONAL, binaryExp("<=", $._SimpleExpression, $._SimpleExpression)),
        prec.right(PREC.RELATIONAL, binaryExp(">", $._SimpleExpression, $._SimpleExpression)),
        prec.right(PREC.RELATIONAL, binaryExp(">=", $._SimpleExpression, $._SimpleExpression)),
        prec.right(PREC.RELATIONAL, binaryExp("==", $._SimpleExpression, $._SimpleExpression)),
        prec.right(PREC.RELATIONAL, binaryExp("<>", $._SimpleExpression, $._SimpleExpression)),
        // Additive operators
        prec.left(PREC.ADDITIVE, binaryExp("+", $._SimpleExpression, $._SimpleExpression)),
        prec.left(PREC.ADDITIVE, binaryExp("-", $._SimpleExpression, $._SimpleExpression)),
        prec.left(PREC.ADDITIVE, binaryExp(".+", $._SimpleExpression, $._SimpleExpression)),
        prec.left(PREC.ADDITIVE, binaryExp(".-", $._SimpleExpression, $._SimpleExpression)),
        // Multiplicative operators
        prec.left(PREC.MULTIPLICATIVE, binaryExp("*", $._SimpleExpression, $._SimpleExpression)),
        prec.left(PREC.MULTIPLICATIVE, binaryExp("/", $._SimpleExpression, $._SimpleExpression)),
        prec.left(PREC.MULTIPLICATIVE, binaryExp(".*", $._SimpleExpression, $._SimpleExpression)),
        prec.left(PREC.MULTIPLICATIVE, binaryExp("./", $._SimpleExpression, $._SimpleExpression)),
        // Exponentiation
        prec.right(PREC.EXPONENTIATION, binaryExp("^", $._PrimaryExpression, $._PrimaryExpression)),
        prec.right(PREC.EXPONENTIATION, binaryExp(".^", $._PrimaryExpression, $._PrimaryExpression)),
      ),

    _PrimaryExpression: ($) =>
      choice(
        $._Literal,
        $.FunctionCall,
        $.ComponentReference,
        $.MemberAccessExpression,
        $.OutputExpressionList,
        $.ArrayConcatenation,
        $.ArrayConstructor,
        $.EndExpression,
      ),

    EndExpression: () => "end",

    _Literal: ($) => choice($.UNSIGNED_INTEGER, $.UNSIGNED_REAL, $.BOOLEAN, $.STRING),

    TypeSpecifier: ($) =>
      ref({
        syntax: seq(optional(field("global", ".")), field("name", $.Name)),
        name: (self) => self.name,
        targetKinds: ["Class"],
        resolve: "qualified",
      }),

    Name: ($) => commaSep1(field("part", $.IDENT), "."),

    ComponentReference: ($) =>
      ref({
        syntax: seq(optional(field("global", ".")), commaSep1(field("part", $.ComponentReferencePart), ".")),
        name: (self) => self.part,
        targetKinds: ["Component", "Class"],
        resolve: "qualified",
      }),

    ComponentReferencePart: ($) =>
      seq(field("identifier", $.IDENT), optional(field("arraySubscripts", $.ArraySubscripts))),

    FunctionCall: ($) =>
      def({
        syntax: seq(
          field("functionReference", choice($.ComponentReference, "der", "initial", "pure")),
          field("functionCallArguments", $.FunctionCallArguments),
        ),
        model: {
          name: "FunctionCall",
        },
        i18n: {
          extract: (db, self) => {
            const funcRef = self.childForFieldName("functionReference");
            if (funcRef && funcRef.text === "Text") {
              const args = self.childForFieldName("functionCallArguments");
              if (args) {
                for (const child of args.children) {
                  if (child.type === "NamedArgument") {
                    const name = child.childForFieldName("identifier")?.text;
                    if (name === "textString") {
                      const val = child.childForFieldName("argument")?.childForFieldName("expression");
                      if (val && val.text) {
                        return { msgid: val.text };
                      }
                    }
                  } else if (child.type === "NamedArguments") {
                    for (const sub of child.children) {
                      if (sub.type === "NamedArgument") {
                        const name = sub.childForFieldName("identifier")?.text;
                        if (name === "textString") {
                          const val = sub.childForFieldName("argument")?.childForFieldName("expression");
                          if (val && val.text) {
                            return { msgid: val.text };
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
            return null;
          },
        },
      }),

    FunctionCallArguments: ($) =>
      seq(
        "(",
        optional(
          choice(
            field("comprehensionClause", $.ComprehensionClause),
            seq(
              commaSep1(field("argument", $.FunctionArgument)),
              optional(seq(",", commaSep1(field("namedArgument", $.NamedArgument)))),
            ),
            commaSep1(field("namedArgument", $.NamedArgument)),
          ),
        ),
        ")",
      ),

    ArrayConcatenation: ($) => seq("[", commaSep1(field("expressionList", $.ExpressionList), ";"), "]"),

    ArrayConstructor: ($) =>
      seq(
        "{",
        optional(
          choice(field("comprehensionClause", $.ComprehensionClause), field("expressionList", $.ExpressionList)),
        ),
        "}",
      ),

    ComprehensionClause: ($) =>
      seq(field("expression", $._Expression), "for", commaSep1(field("forIndex", $.ForIndex))),

    NamedArgument: ($) => seq(field("identifier", $.IDENT), "=", field("argument", $.FunctionArgument)),

    FunctionArgument: ($) =>
      choice(field("expression", $._Expression), field("functionPartialApplication", $.FunctionPartialApplication)),

    FunctionPartialApplication: ($) =>
      seq(
        "function",
        field("typeSpecifier", $.TypeSpecifier),
        "(",
        commaSep(field("namedArgument", $.NamedArgument)),
        ")",
      ),

    MemberAccessExpression: ($) =>
      seq(
        field("outputExpressionList", $.OutputExpressionList),
        choice(field("arraySubscripts", $.ArraySubscripts), seq(".", field("identifier", $.IDENT))),
      ),

    OutputExpressionList: ($) => seq("(", commaSep(optional(field("output", $._Expression)), ","), ")"),

    ExpressionList: ($) => commaSep1(field("expression", $._Expression)),

    ArraySubscripts: ($) => seq("[", commaSep1(field("subscript", $.Subscript)), "]"),

    Subscript: ($) => choice(field("flexible", ":"), field("expression", $._Expression)),

    Description: ($) => commaSep1(field("descriptionString", $.STRING), "+"),

    AnnotationClause: ($) => seq("annotation", field("classModification", $.ClassModification)),

    // =====================================================================
    // §A.1 — Lexical Conventions
    // =====================================================================

    BOOLEAN: () => choice("false", "true"),

    IDENT: () =>
      token(
        choice(
          seq(
            /[_a-zA-Z\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF\u0500-\u052F\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\u0900-\u097F\u0980-\u09FF\u0A00-\u0A7F\u0A80-\u0AFF\u0B00-\u0B7F\u0B80-\u0BFF\u0C00-\u0C7F\u0C80-\u0CFF\u0D00-\u0D7F\u0E00-\u0E7F\u0E80-\u0EFF\u1000-\u109F\u1100-\u11FF\u3040-\u309F\u30A0-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF\uFB50-\uFDFF\uFE70-\uFEFF]/,
            repeat(
              choice(
                /[0-9]/,
                /[_a-zA-Z\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF\u0500-\u052F\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\u0900-\u097F\u0980-\u09FF\u0A00-\u0A7F\u0A80-\u0AFF\u0B00-\u0B7F\u0B80-\u0BFF\u0C00-\u0C7F\u0C80-\u0CFF\u0D00-\u0D7F\u0E00-\u0E7F\u0E80-\u0EFF\u1000-\u109F\u1100-\u11FF\u3040-\u309F\u30A0-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF\uFB50-\uFDFF\uFE70-\uFEFF]/,
              ),
            ),
          ),
          // Q-IDENT: 'quoted identifier'
          seq(
            "'",
            repeat(
              choice(
                /[_a-zA-Z\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF\u0500-\u052F\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\u0900-\u097F\u0980-\u09FF\u0A00-\u0A7F\u0A80-\u0AFF\u0B00-\u0B7F\u0B80-\u0BFF\u0C00-\u0C7F\u0C80-\u0CFF\u0D00-\u0D7F\u0E00-\u0E7F\u0E80-\u0EFF\u1000-\u109F\u1100-\u11FF\u3040-\u309F\u30A0-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF\uFB50-\uFDFF\uFE70-\uFEFF]/,
                /[0-9]/,
                "!",
                "#",
                "$",
                "%",
                "&",
                "(",
                ")",
                "*",
                "+",
                ",",
                "-",
                ".",
                "/",
                ":",
                ";",
                "<",
                ">",
                "=",
                "?",
                "@",
                "[",
                "]",
                "^",
                "{",
                "}",
                "|",
                "~",
                " ",
                '"',
                seq("\\", choice("'", '"', "?", "\\", "a", "b", "f", "n", "r", "t", "v")),
              ),
            ),
            "'",
          ),
        ),
      ),
    /* eslint-enable no-control-regex */

    STRING: () =>
      token(
        seq(
          '"',
          repeat(choice(/[^"\\]/, seq("\\", choice("'", '"', "?", "\\", "a", "b", "f", "n", "r", "t", "v")))),
          '"',
        ),
      ),

    UNSIGNED_INTEGER: () => /[0-9]+/,

    UNSIGNED_REAL: () =>
      token(
        choice(
          seq(/[0-9]+/, ".", optional(/[0-9]+/)),
          seq(/[0-9]+/, optional(seq(".", optional(/[0-9]+/))), choice("e", "E"), optional(choice("+", "-")), /[0-9]+/),
          seq(".", /[0-9]+/, optional(seq(choice("e", "E"), optional(choice("+", "-")), /[0-9]+/))),
        ),
      ),

    BLOCK_COMMENT: () => token(seq("/*", /[^*]*\*+([^/*][^*]*\*+)*/, "/")),

    LINE_COMMENT: () => token(seq("//", /[^\r\n]*/)),

    BOM: () => /\u00EF\u00BB\u00BF/,
  },

  // =====================================================================
  // Top-Level Adapters (Approach C — language-wide registry)
  // =====================================================================

  adapters: {
    sysml2: {
      ClassDefinition: (db, node) => ({
        target: "BlockDefinition",
        props: {
          name: node.name,
          isAbstract: false,
          defKind: "block",
          classKind: (node.metadata as Record<string, unknown>)?.classPrefixes ?? "model",
          parts: db
            .childrenOf(node.id)
            .filter((c) => c.kind === "Component")
            .map((c) => ({
              name: c.name,
              typeName: (c.metadata as Record<string, unknown>)?.typeSpecifier as string | undefined,
              direction: ((c.metadata as Record<string, unknown>)?.causality as string) ?? null,
            })),
        },
      }),
    },
    owl2: {
      /**
       * Project a Modelica connect() clause into an OWL2 ObjectPropertyAssertion.
       * connect(a.p, b.p) → ObjectPropertyAssertion(mo:isConnectedTo, mo:a, mo:b)
       */
      ConnectClause: (_db, node) => ({
        target: "ObjectPropertyAssertionAxiom",
        props: {
          axiomType: "ObjectPropertyAssertion",
          propertyIri: "mo:isConnectedTo",
          subjectIri: `mo:${node.name?.split(".")[0] ?? node.name}`,
          objectIri: `mo:${((node.metadata as Record<string, unknown>)?.connectee as string)?.split(".")[0] ?? "unknown"}`,
          sourceLang: "modelica",
        },
      }),
      /**
       * Project a Modelica ComponentClause (variable declaration) into
       * OWL2 data/object property assertions depending on the component type.
       */
      ComponentClause: (db, node) => {
        const meta = node.metadata as Record<string, unknown> | undefined;
        const typeSpec = meta?.typeSpecifier as string | undefined;
        const variability = meta?.variability as string | undefined;
        const parentId = node.parentId;
        const parentName = parentId !== null ? db.symbol(parentId)?.name : undefined;

        if (variability === "parameter" && parentName) {
          return {
            target: "DataPropertyAssertionAxiom",
            props: {
              axiomType: "DataPropertyAssertion",
              propertyIri: `mo:hasParam_${node.name}`,
              subjectIri: `mo:${parentName}`,
              value: (meta?.defaultValue as string) ?? "",
              datatype: typeSpec === "Real" ? "xsd:double" : typeSpec === "Integer" ? "xsd:integer" : `xsd:${typeSpec}`,
              sourceLang: "modelica",
            },
          };
        }

        // Non-parameter components → object property (has-part relationship)
        if (parentName && typeSpec) {
          return {
            target: "ObjectPropertyAssertionAxiom",
            props: {
              axiomType: "ObjectPropertyAssertion",
              propertyIri: `mo:hasPart_${node.name}`,
              subjectIri: `mo:${parentName}`,
              objectIri: `mo:${typeSpec}`,
              sourceLang: "modelica",
            },
          };
        }

        return { target: "ClassEntity", props: {} };
      },
    },
  },
});

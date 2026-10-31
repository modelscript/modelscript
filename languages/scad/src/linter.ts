// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Semantic Linter for OpenSCAD (.scad).
 *
 * Performs single-pass lexical scope analysis, duplicate symbol detection,
 * undefined variable/module/function/method resolution, user-defined call
 * arity/parameter validation, constant-folded division-by-zero checks, and
 * CSG primitive dimension positivity checks — all reporting narrow, exact
 * AST token ranges.
 */

import { ScadErrorCode } from "./errors.js";
import { parseScadSource } from "./evaluator.js";
import type { ScadCstNode } from "./patcher.js";
import type { ScadWorkspaceIndex } from "./workspace-index.js";

export interface ScadLintOptions {
  workspaceIndex?: ScadWorkspaceIndex | undefined;
  uri?: string | undefined;
}

export type ScadConstValue = number | string | boolean | undefined | ScadConstValue[];

/**
 * Diagnostic emitted by the OpenSCAD semantic linter with 0-indexed byte offsets and 1-indexed line/column spans.
 */
export interface ScadDiagnostic {
  code: string;
  /** Standard ModelScript alphanumeric diagnostic code (e.g., `"K1001"`). */
  standardCode?: string | undefined;
  /** Numeric error code (e.g., `1001`). */
  numericCode?: number | undefined;
  severity: "error" | "warning" | "info";
  message: string;
  /** 0-indexed character/byte start offset in source */
  startOffset: number;
  /** 0-indexed character/byte end offset in source */
  endOffset: number;
  /** 1-indexed start line */
  line: number;
  /** 1-indexed start column */
  column: number;
  /** 1-indexed end line */
  endLine: number;
  /** 1-indexed end column */
  endColumn: number;
}

/**
 * Built-in OpenSCAD special variables and constants that are always defined in scope.
 */
const BUILTIN_VARIABLES = new Set<string>([
  "$fn",
  "$fa",
  "$fs",
  "$t",
  "$vpr",
  "$vpt",
  "$vpd",
  "$vpf",
  "$children",
  "$preview",
  "PI",
  "undef",
  "true",
  "false",
]);

/**
 * Built-in OpenSCAD mathematical, string, list, and type-predicate functions.
 */
const BUILTIN_FUNCTIONS = new Set<string>([
  "sin",
  "cos",
  "tan",
  "asin",
  "acos",
  "atan",
  "atan2",
  "sqrt",
  "pow",
  "abs",
  "min",
  "max",
  "floor",
  "ceil",
  "round",
  "ln",
  "log",
  "exp",
  "sign",
  "norm",
  "cross",
  "len",
  "concat",
  "lookup",
  "str",
  "chr",
  "ord",
  "search",
  "version",
  "version_num",
  "parent_module",
  "is_undef",
  "is_bool",
  "is_num",
  "is_string",
  "is_list",
  "is_function",
  "rands",
]);

/**
 * Built-in OpenSCAD geometric primitives, boolean operators, extrusions, and ModelScript `tag_port`.
 */
const BUILTIN_MODULES = new Set<string>([
  "cube",
  "cylinder",
  "sphere",
  "polyhedron",
  "polygon",
  "circle",
  "square",
  "text",
  "translate",
  "rotate",
  "scale",
  "resize",
  "mirror",
  "multmatrix",
  "color",
  "offset",
  "hull",
  "minkowski",
  "union",
  "difference",
  "intersection",
  "linear_extrude",
  "rotate_extrude",
  "surface",
  "projection",
  "render",
  "children",
  "echo",
  "assert",
  "import",
  "tag_port",
]);

/**
 * Supported fluent CAD transformation and feature-modeling methods on `ChainedSolid` expressions.
 */
const BUILTIN_METHODS = new Set<string>([
  "translate",
  "rotate",
  "scale",
  "mirror",
  "multmatrix",
  "color",
  "offset",
  "fillet",
  "chamfer",
]);

/**
 * Signature metadata for a user-defined OpenSCAD module or function used for call-site validation.
 */
interface CallableSignature {
  name: string;
  params: string[];
  requiredParams: Set<string>;
  defaultExprs: Map<string, ScadCstNode>;
  bodyNode: ScadCstNode | null;
  declScope: LintScope;
}

/**
 * Lexical scope frame tracking variable bindings, constant-folded values, and callable signatures during linting.
 */
class LintScope {
  public vars = new Map<string, { value: ScadConstValue; node: ScadCstNode | null }>();
  public modules = new Map<string, CallableSignature>();
  public functions = new Map<string, CallableSignature>();

  constructor(public parent: LintScope | null = null) {}

  /**
   * Checks whether `name` is a built-in variable or declared in this scope or an enclosing parent scope.
   */
  hasVar(name: string): boolean {
    if (BUILTIN_VARIABLES.has(name)) return true;
    if (this.vars.has(name)) return true;
    return this.parent ? this.parent.hasVar(name) : false;
  }

  /**
   * Retrieves the constant-folded value of `name` if statically known, or `undefined` otherwise.
   */
  getVarValue(name: string): ScadConstValue {
    if (name === "PI") return Math.PI;
    if (name === "true") return true;
    if (name === "false") return false;
    if (name === "undef") return undefined;
    if (this.vars.has(name)) return this.vars.get(name)!.value;
    return this.parent ? this.parent.getVarValue(name) : undefined;
  }

  /**
   * Looks up a user-defined module signature in the lexical scope chain.
   */
  getModule(name: string): CallableSignature | undefined {
    return this.modules.get(name) ?? (this.parent ? this.parent.getModule(name) : undefined);
  }

  /**
   * Looks up a user-defined function signature in the lexical scope chain.
   */
  getFunction(name: string): CallableSignature | undefined {
    return this.functions.get(name) ?? (this.parent ? this.parent.getFunction(name) : undefined);
  }
}

/**
 * Binary-search line-start index converting 0-indexed byte offsets into 1-indexed `(line, column)` coordinates.
 */
class LineLocator {
  private lineStarts: number[] = [0];

  constructor(private source: string) {
    for (let i = 0; i < source.length; i++) {
      if (source.charCodeAt(i) === 10) {
        this.lineStarts.push(i + 1);
      }
    }
  }

  /**
   * Converts a 0-indexed character offset to a 1-indexed `{ line, column }` position.
   */
  offsetToPos(offset: number): { line: number; column: number } {
    const clamped = Math.max(0, Math.min(offset, this.source.length));
    let low = 0;
    let high = this.lineStarts.length - 1;
    while (low <= high) {
      const mid = (low + high) >>> 1;
      if (this.lineStarts[mid]! <= clamped) {
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    const lineIdx = Math.max(0, low - 1);
    return {
      line: lineIdx + 1,
      column: clamped - this.lineStarts[lineIdx]! + 1,
    };
  }
}

/**
 * Returns the 0-indexed start byte offset of a CST node.
 */
function getNodeStart(node: ScadCstNode | null | undefined): number {
  return node?.startIndex ?? node?.startOffset ?? 0;
}

/**
 * Returns the 0-indexed end byte offset of a CST node.
 */
function getNodeEnd(node: ScadCstNode | null | undefined): number {
  return node?.endIndex ?? node?.endOffset ?? 0;
}

/**
 * Finds the first direct child of `node` whose CST type matches `targetType`.
 */
function findChildByType(node: ScadCstNode | null | undefined, targetType: string): ScadCstNode | null {
  if (!node) return null;
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (c && c.type === targetType) return c;
  }
  return null;
}

/**
 * Extracts ordered parameter names, identifier AST nodes, required parameters, and default expressions
 * from a `ParameterList` CST node.
 */
function parseParameterList(paramListNode: ScadCstNode | null | undefined): {
  params: string[];
  paramNodes: Map<string, ScadCstNode>;
  requiredParams: Set<string>;
  defaultExprs: Map<string, ScadCstNode>;
} {
  const params: string[] = [];
  const paramNodes = new Map<string, ScadCstNode>();
  const requiredParams = new Set<string>();
  const defaultExprs = new Map<string, ScadCstNode>();
  if (!paramListNode) return { params, paramNodes, requiredParams, defaultExprs };

  for (let i = 0; i < paramListNode.childCount; i++) {
    const p = paramListNode.child(i);
    if (!p || p.type !== "Parameter") continue;
    const nameNode = findChildByType(p, "IDENTIFIER");
    const defNode = findChildByType(p, "Expression");
    if (nameNode) {
      const name = nameNode.text.trim();
      params.push(name);
      paramNodes.set(name, nameNode);
      if (defNode) {
        defaultExprs.set(name, defNode);
      } else {
        requiredParams.add(name);
      }
    }
  }
  return { params, paramNodes, requiredParams, defaultExprs };
}

/**
 * Parsed positional or named argument node from a module or function call site.
 */
interface ParsedArg {
  name?: string | undefined;
  nameNode?: ScadCstNode | undefined;
  valueNode: ScadCstNode;
  argNode: ScadCstNode;
}

/**
 * Separates an `ArgumentList` CST node into positional arguments, named arguments, and the complete ordered list.
 */
function parseArgumentList(argListNode: ScadCstNode | null | undefined): {
  positional: ParsedArg[];
  named: Map<string, ParsedArg>;
  all: ParsedArg[];
} {
  const positional: ParsedArg[] = [];
  const named = new Map<string, ParsedArg>();
  const all: ParsedArg[] = [];
  if (!argListNode) return { positional, named, all };

  for (let i = 0; i < argListNode.childCount; i++) {
    const arg = argListNode.child(i);
    if (!arg || arg.type !== "Argument") continue;

    const nameNode = findChildByType(arg, "IDENTIFIER");
    const exprNode = findChildByType(arg, "Expression") ?? findChildByType(arg, "PrimaryExpression");
    if (nameNode && exprNode && arg.childCount >= 3 && arg.child(1)?.text === "=") {
      const entry: ParsedArg = {
        name: nameNode.text.trim(),
        nameNode,
        valueNode: exprNode,
        argNode: arg,
      };
      named.set(entry.name!, entry);
      all.push(entry);
    } else if (exprNode) {
      const entry: ParsedArg = {
        valueNode: exprNode,
        argNode: arg,
      };
      positional.push(entry);
      all.push(entry);
    }
  }

  return { positional, named, all };
}

/**
 * Run semantic lints on a parsed OpenSCAD CST root node.
 */
export function lintScadCst(
  rootNode: ScadCstNode | null | undefined,
  sourceText?: string,
  options?: ScadLintOptions | ScadWorkspaceIndex,
): ScadDiagnostic[] {
  if (!rootNode) return [];
  const rawText = sourceText ?? rootNode.tree?.sourceCode ?? rootNode.text ?? "";
  const locator = new LineLocator(rawText);
  const diagnostics: ScadDiagnostic[] = [];
  const workspaceIndex =
    options && "resolveDependencyInfo" in options ? options : (options as ScadLintOptions | undefined)?.workspaceIndex;
  const currentUri =
    options && !("resolveDependencyInfo" in options) ? (options as ScadLintOptions | undefined)?.uri : undefined;
  let suppressEmit = false;

  const emit = (
    node: ScadCstNode | null | undefined,
    code: string,
    severity: "error" | "warning" | "info",
    message: string,
  ) => {
    if (suppressEmit) return;
    const startOffset = getNodeStart(node);
    const endOffset = Math.max(startOffset + 1, getNodeEnd(node));
    const startPos = locator.offsetToPos(startOffset);
    const endPos = locator.offsetToPos(endOffset);
    const stdMatch = Object.values(ScadErrorCode).find((e) => e.rule === code);
    diagnostics.push({
      code,
      standardCode: stdMatch?.stdCode,
      numericCode: stdMatch?.code,
      severity,
      message,
      startOffset,
      endOffset,
      line: startPos.line,
      column: startPos.column,
      endLine: endPos.line,
      endColumn: endPos.column,
    });
  };

  /**
   * Constant-fold / evaluate an expression when possible (without side effects).
   * Returns `undefined` when the value depends on unknown/dynamic terms.
   */
  const tryEvalExpr = (exprNode: ScadCstNode | null | undefined, scope: LintScope, depth = 0): ScadConstValue => {
    if (!exprNode || depth > 16) return undefined;
    const type = exprNode.type;

    if (type === "Expression" || type === "PrimaryExpression") {
      if (exprNode.childCount === 0) {
        const text = exprNode.text.trim();
        if (/^[+-]?[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]+)?$/.test(text)) {
          return parseFloat(text);
        }
        if (text === "true") return true;
        if (text === "false") return false;
        if (text === "undef") return undefined;
        return scope.getVarValue(text);
      }
      const inner = exprNode.child(0);
      return inner ? tryEvalExpr(inner, scope, depth + 1) : undefined;
    }

    if (type === "NUMBER") return parseFloat(exprNode.text);
    if (type === "BOOLEAN") return exprNode.text.trim() === "true";
    if (type === "STRING") return exprNode.text.slice(1, -1);
    if (type === "UNDEF") return undefined;
    if (type === "IDENTIFIER") return scope.getVarValue(exprNode.text.trim());

    if (type === "LetExpression") {
      const letScope = new LintScope(scope);
      let bodyExpr: ScadCstNode | null = null;
      let inArgs = false;
      let argsDone = false;
      for (let i = 0; i < exprNode.childCount; i++) {
        const c = exprNode.child(i);
        if (!c) continue;
        if (!argsDone && c.text === "(") {
          inArgs = true;
          continue;
        }
        if (inArgs && c.text === ")") {
          inArgs = false;
          argsDone = true;
          continue;
        }
        if (c.type === "LetBinding" || (inArgs && c.type === "Argument")) {
          const nameNode = findChildByType(c, "IDENTIFIER");
          const valNode = findChildByType(c, "Expression");
          if (nameNode && valNode) {
            letScope.vars.set(nameNode.text.trim(), {
              value: tryEvalExpr(valNode, letScope, depth + 1),
              node: nameNode,
            });
          }
        } else if (c.type === "ArgumentList") {
          argsDone = true;
          for (let j = 0; j < c.childCount; j++) {
            const arg = c.child(j);
            if (arg && (arg.type === "Argument" || arg.type === "LetBinding")) {
              const nameNode = findChildByType(arg, "IDENTIFIER");
              const valNode = findChildByType(arg, "Expression");
              if (nameNode && valNode) {
                letScope.vars.set(nameNode.text.trim(), {
                  value: tryEvalExpr(valNode, letScope, depth + 1),
                  node: nameNode,
                });
              }
            }
          }
        } else if (c.type === "Expression" || c.type.endsWith("Expression")) {
          bodyExpr = c;
        }
      }
      return bodyExpr ? tryEvalExpr(bodyExpr, letScope, depth + 1) : undefined;
    }

    if (type === "ParenthesizedExpression") {
      const inner = findChildByType(exprNode, "Expression");
      return inner ? tryEvalExpr(inner, scope, depth + 1) : undefined;
    }

    if (type === "UnaryExpression") {
      const op = exprNode.child(0)?.text.trim() ?? "";
      const valNode = findChildByType(exprNode, "Expression");
      const val = valNode ? tryEvalExpr(valNode, scope, depth + 1) : undefined;
      if (val === undefined) return undefined;
      if (op === "-") return typeof val === "number" ? -val : undefined;
      if (op === "+") return typeof val === "number" ? +val : undefined;
      if (op === "!") return !val;
      return val;
    }

    if (type === "VectorLiteral") {
      const elements: ScadConstValue[] = [];
      for (let i = 0; i < exprNode.childCount; i++) {
        const c = exprNode.child(i);
        if (c && (c.type === "Expression" || c.type.endsWith("Expression"))) {
          elements.push(tryEvalExpr(c, scope, depth + 1));
        }
      }
      return elements;
    }

    if (type === "BinaryExpression") {
      const exprChildren: ScadCstNode[] = [];
      let op = "";
      for (let i = 0; i < exprNode.childCount; i++) {
        const c = exprNode.child(i);
        if (!c) continue;
        if (c.type === "Expression" || c.type.endsWith("Expression")) {
          exprChildren.push(c);
        } else if (/^(\+|-|\*|\/|%|\^|==|!=|<|<=|>|>=|&&|\|\|)$/.test(c.text.trim())) {
          op = c.text.trim();
        }
      }
      if (exprChildren.length < 2) return undefined;
      const left = tryEvalExpr(exprChildren[0], scope, depth + 1);
      const right = tryEvalExpr(exprChildren[1], scope, depth + 1);
      if (typeof left === "number" && typeof right === "number") {
        switch (op) {
          case "+":
            return left + right;
          case "-":
            return left - right;
          case "*":
            return left * right;
          case "/":
            return right !== 0 ? left / right : undefined;
          case "%":
            return right !== 0 ? left % right : undefined;
          case "^":
            return Math.pow(left, right);
          case "==":
            return left === right;
          case "!=":
            return left !== right;
          case "<":
            return left < right;
          case "<=":
            return left <= right;
          case ">":
            return left > right;
          case ">=":
            return left >= right;
        }
      }
    }

    return undefined;
  };

  /**
   * Unwrap `Expression` / `PrimaryExpression` wrappers to check if an expression is a `VectorLiteral`.
   */
  const unwrapVectorLiteral = (node: ScadCstNode | null | undefined): ScadCstNode | null => {
    let cur: ScadCstNode | null | undefined = node;
    while (cur && (cur.type === "Expression" || cur.type === "PrimaryExpression") && cur.childCount === 1) {
      cur = cur.child(0);
    }
    return cur?.type === "VectorLiteral" ? cur : null;
  };

  /**
   * Validate that a scalar or vector dimension argument is strictly positive (> 0).
   * If a VectorLiteral `[10, -5, 20]` contains a non-positive component, underlines
   * ONLY the offending component expression `-5`.
   */
  const checkPositiveDimension = (
    exprNode: ScadCstNode | null | undefined,
    scope: LintScope,
    primitiveName: string,
    paramLabel: string,
    expectedDimCount?: number,
  ) => {
    if (!exprNode) return;
    const vecNode = unwrapVectorLiteral(exprNode);
    if (vecNode) {
      const elemNodes: ScadCstNode[] = [];
      for (let i = 0; i < vecNode.childCount; i++) {
        const c = vecNode.child(i);
        if (c && (c.type === "Expression" || c.type.endsWith("Expression"))) {
          elemNodes.push(c);
        }
      }
      if (expectedDimCount !== undefined && elemNodes.length !== expectedDimCount) {
        emit(
          vecNode,
          "SCAD_INVALID_DIMENSION",
          "error",
          `Invalid '${paramLabel}' vector for '${primitiveName}': expected ${expectedDimCount} components, got ${elemNodes.length}.`,
        );
      }
      for (let i = 0; i < elemNodes.length; i++) {
        const val = tryEvalExpr(elemNodes[i], scope);
        if (typeof val === "number" && (!Number.isFinite(val) || val <= 0)) {
          emit(
            elemNodes[i],
            "SCAD_INVALID_DIMENSION",
            "error",
            `Invalid non-positive dimension (${val}) in '${primitiveName}' parameter '${paramLabel}[${i}]': dimensions must be > 0.`,
          );
        }
      }
      return;
    }

    const val = tryEvalExpr(exprNode, scope);
    if (typeof val === "number" && (!Number.isFinite(val) || val <= 0)) {
      emit(
        exprNode,
        "SCAD_INVALID_DIMENSION",
        "error",
        `Invalid non-positive dimension (${val}) in '${primitiveName}' parameter '${paramLabel}': must be > 0.`,
      );
    } else if (Array.isArray(val)) {
      for (let i = 0; i < val.length; i++) {
        const comp = val[i];
        if (typeof comp === "number" && (!Number.isFinite(comp) || comp <= 0)) {
          emit(
            exprNode,
            "SCAD_INVALID_DIMENSION",
            "error",
            `Invalid non-positive dimension (${comp}) in '${primitiveName}' parameter '${paramLabel}[${i}]': dimensions must be > 0.`,
          );
        }
      }
    }
  };

  /**
   * Check an expression tree for undefined variables, undefined function calls,
   * argument mismatches on user-defined functions, and division by zero.
   */
  const checkExpression = (exprNode: ScadCstNode | null | undefined, scope: LintScope) => {
    if (!exprNode) return;
    const type = exprNode.type;

    if (type === "IDENTIFIER") {
      const name = exprNode.text.trim();
      if (!scope.hasVar(name)) {
        emit(exprNode, "SCAD_UNDEFINED_VARIABLE", "error", `Undefined variable '${name}'.`);
      }
      return;
    }

    if (type === "Expression" || type === "PrimaryExpression") {
      if (exprNode.childCount === 0) {
        const text = exprNode.text.trim();
        if (
          text &&
          !/^[+-]?[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]+)?$/.test(text) &&
          !text.startsWith('"') &&
          !scope.hasVar(text)
        ) {
          emit(exprNode, "SCAD_UNDEFINED_VARIABLE", "error", `Undefined variable '${text}'.`);
        }
        return;
      }
      for (let i = 0; i < exprNode.childCount; i++) {
        checkExpression(exprNode.child(i), scope);
      }
      return;
    }

    if (type === "LetExpression") {
      const letScope = new LintScope(scope);
      let bodyExpr: ScadCstNode | null = null;
      let inArgs = false;
      let argsDone = false;
      for (let i = 0; i < exprNode.childCount; i++) {
        const c = exprNode.child(i);
        if (!c) continue;
        if (!argsDone && c.text === "(") {
          inArgs = true;
          continue;
        }
        if (inArgs && c.text === ")") {
          inArgs = false;
          argsDone = true;
          continue;
        }
        if (c.type === "LetBinding" || (inArgs && c.type === "Argument")) {
          const nameNode = findChildByType(c, "IDENTIFIER");
          const valNode = findChildByType(c, "Expression");
          if (valNode) checkExpression(valNode, letScope);
          if (nameNode) {
            letScope.vars.set(nameNode.text.trim(), {
              value: valNode ? tryEvalExpr(valNode, letScope) : undefined,
              node: nameNode,
            });
          }
        } else if (c.type === "ArgumentList") {
          argsDone = true;
          for (let j = 0; j < c.childCount; j++) {
            const arg = c.child(j);
            if (arg && (arg.type === "Argument" || arg.type === "LetBinding")) {
              const nameNode = findChildByType(arg, "IDENTIFIER");
              const valNode = findChildByType(arg, "Expression");
              if (valNode) checkExpression(valNode, letScope);
              if (nameNode) {
                letScope.vars.set(nameNode.text.trim(), {
                  value: valNode ? tryEvalExpr(valNode, letScope) : undefined,
                  node: nameNode,
                });
              }
            }
          }
        } else if (c.type === "Expression" || c.type.endsWith("Expression")) {
          bodyExpr = c;
        }
      }
      if (bodyExpr) checkExpression(bodyExpr, letScope);
      return;
    }

    if (type === "ListComprehension") {
      const varNode = findChildByType(exprNode, "IDENTIFIER");
      const exprs: ScadCstNode[] = [];
      for (let i = 0; i < exprNode.childCount; i++) {
        const c = exprNode.child(i);
        if (c && (c.type === "Expression" || c.type.endsWith("Expression"))) {
          exprs.push(c);
        }
      }
      const rangeNode = exprs[0];
      if (rangeNode) checkExpression(rangeNode, scope);
      const compScope = new LintScope(scope);
      if (varNode) {
        compScope.vars.set(varNode.text.trim(), { value: undefined, node: varNode });
      }
      for (let i = 1; i < exprs.length; i++) {
        checkExpression(exprs[i], compScope);
      }
      return;
    }

    if (type === "VectorLiteral") {
      const listComp = findChildByType(exprNode, "ListComprehension");
      if (listComp) {
        checkExpression(listComp, scope);
        return;
      }
    }

    if (type === "PostfixExpression") {
      const first = exprNode.child(0);
      const second = exprNode.child(1);

      if (second?.text === "(") {
        // Function call: `function(arguments)`
        // Find narrowest identifier node for the function callee
        const calleeNode = findChildByType(first, "IDENTIFIER") ?? first;
        const funcName = calleeNode ? calleeNode.text.trim() : "";
        const argListNode = findChildByType(exprNode, "ArgumentList");
        const parsedArgs = parseArgumentList(argListNode);

        // Validate argument value expressions in current scope
        for (const arg of parsedArgs.all) {
          checkExpression(arg.valueNode, scope);
        }

        if (funcName) {
          const userFunc = scope.getFunction(funcName);
          if (!userFunc && !BUILTIN_FUNCTIONS.has(funcName)) {
            emit(calleeNode, "SCAD_UNDEFINED_FUNCTION", "error", `Undefined function '${funcName}'.`);
          } else if (userFunc) {
            validateCallArguments(calleeNode, userFunc, parsedArgs, "function");
          }
        }
        return;
      }

      // Array indexing `operand[index]`
      for (let i = 0; i < exprNode.childCount; i++) {
        const c = exprNode.child(i);
        if (c && (c.type === "Expression" || c.type.endsWith("Expression"))) {
          checkExpression(c, scope);
        }
      }
      return;
    }

    if (type === "BinaryExpression") {
      const exprChildren: ScadCstNode[] = [];
      let op = "";
      for (let i = 0; i < exprNode.childCount; i++) {
        const c = exprNode.child(i);
        if (!c) continue;
        if (c.type === "Expression" || c.type.endsWith("Expression")) {
          exprChildren.push(c);
          checkExpression(c, scope);
        } else if (/^(\+|-|\*|\/|%|\^|==|!=|<|<=|>|>=|&&|\|\|)$/.test(c.text.trim())) {
          op = c.text.trim();
        }
      }
      if ((op === "/" || op === "%") && exprChildren.length >= 2) {
        const divisorNode = exprChildren[1];
        const divisorVal = tryEvalExpr(divisorNode, scope);
        if (divisorVal === 0) {
          emit(divisorNode, "SCAD_DIVISION_BY_ZERO", "error", `Division by zero in expression.`);
        }
      }
      return;
    }

    for (let i = 0; i < exprNode.childCount; i++) {
      const c = exprNode.child(i);
      if (c && (c.type === "Expression" || c.type.endsWith("Expression") || c.type === "IDENTIFIER")) {
        checkExpression(c, scope);
      }
    }
  };

  const validateCallArguments = (
    calleeNode: ScadCstNode | null | undefined,
    sig: CallableSignature,
    parsedArgs: { positional: ParsedArg[]; named: Map<string, ParsedArg>; all: ParsedArg[] },
    kindLabel: "module" | "function",
  ) => {
    // 1. Too many positional arguments: underline the first excess positional argument
    if (parsedArgs.positional.length > sig.params.length) {
      const excessArg = parsedArgs.positional[sig.params.length]!;
      emit(
        excessArg.argNode,
        "SCAD_ARGUMENT_COUNT",
        "error",
        `Too many arguments to ${kindLabel} '${sig.name}': expected at most ${sig.params.length}, got ${parsedArgs.positional.length}.`,
      );
    }

    // 2. Unknown named arguments: underline only the unknown parameter name identifier
    const paramSet = new Set(sig.params);
    for (const [argName, argInfo] of parsedArgs.named) {
      if (argName.startsWith("$")) continue; // Special OpenSCAD variables ($fn, $fa, $fs) are allowed in any call
      if (!paramSet.has(argName)) {
        emit(
          argInfo.nameNode ?? argInfo.argNode,
          "SCAD_UNKNOWN_PARAMETER",
          "error",
          `Unknown parameter '${argName}' in call to ${kindLabel} '${sig.name}'.`,
        );
      }
    }

    // 3. Missing required parameters (parameters without default values not supplied positionally or by name)
    for (let i = 0; i < sig.params.length; i++) {
      const pName = sig.params[i]!;
      if (!sig.requiredParams.has(pName)) continue;
      const suppliedPositionally = i < parsedArgs.positional.length;
      const suppliedByName = parsedArgs.named.has(pName);
      if (!suppliedPositionally && !suppliedByName) {
        emit(
          calleeNode,
          "SCAD_ARGUMENT_COUNT",
          "warning",
          `Missing required parameter '${pName}' in call to ${kindLabel} '${sig.name}'.`,
        );
      }
    }
  };

  /**
   * Pre-collect declarations in a statement list (OpenSCAD hoists declarations within a block)
   * and check for duplicate declarations in the same scope.
   */
  const hoistDeclarations = (statements: ScadCstNode[], scope: LintScope) => {
    const seenVars = new Set<string>();
    const seenModules = new Set<string>();
    const seenFunctions = new Set<string>();

    for (const rawStmt of statements) {
      const stmt = rawStmt?.type === "Statement" ? rawStmt.child(0) : rawStmt;
      if (!stmt) continue;

      if (stmt.type === "IncludeStatement" || stmt.type === "UseStatement") {
        if (!workspaceIndex) continue;
        const raw = stmt.text.trim();
        const match = raw.match(/^(?:include|use)\s*<([^>]+)>/);
        const targetPath = match?.[1]?.trim();
        if (!targetPath) continue;
        const depInfo = workspaceIndex.resolveDependencyInfo(targetPath, currentUri);
        if (!depInfo) continue;

        const isInclude = stmt.type === "IncludeStatement";
        if (depInfo.sourceText) {
          const depRoot = parseScadSource(depInfo.sourceText);
          const depScope = new LintScope(null);
          const depStmts: ScadCstNode[] = [];
          for (let i = 0; i < depRoot.childCount; i++) {
            const c = depRoot.child(i);
            if (c && c.type === "Statement") depStmts.push(c);
          }
          const prevSuppress = suppressEmit;
          suppressEmit = true;
          try {
            hoistDeclarations(depStmts, depScope);
          } finally {
            suppressEmit = prevSuppress;
          }
          for (const [modName, modSig] of depScope.modules) {
            scope.modules.set(modName, modSig);
          }
          for (const [fnName, fnSig] of depScope.functions) {
            scope.functions.set(fnName, fnSig);
          }
          if (isInclude) {
            for (const [varName, varEntry] of depScope.vars) {
              scope.vars.set(varName, varEntry);
            }
          }
        } else {
          for (const [modName] of depInfo.modules) {
            scope.modules.set(modName, {
              name: modName,
              params: [],
              requiredParams: new Set<string>(),
              defaultExprs: new Map(),
              bodyNode: null,
              declScope: scope,
            });
          }
          for (const [fnName] of depInfo.functions) {
            scope.functions.set(fnName, {
              name: fnName,
              params: [],
              requiredParams: new Set<string>(),
              defaultExprs: new Map(),
              bodyNode: null,
              declScope: scope,
            });
          }
          if (isInclude) {
            for (const [varName] of depInfo.variables) {
              scope.vars.set(varName, { value: undefined, node: null });
            }
          }
        }
        continue;
      }

      if (stmt.type === "VariableDeclaration") {
        const nameNode = findChildByType(stmt, "IDENTIFIER");
        const exprNode = findChildByType(stmt, "Expression");
        if (nameNode) {
          const name = nameNode.text.trim();
          if (seenVars.has(name) && !name.startsWith("$")) {
            emit(
              nameNode,
              "SCAD_DUPLICATE_DECLARATION",
              "warning",
              `Variable '${name}' is assigned multiple times in the same scope; the last assignment overrides earlier ones.`,
            );
          }
          seenVars.add(name);
          const val = exprNode ? tryEvalExpr(exprNode, scope) : undefined;
          scope.vars.set(name, { value: val, node: nameNode });
        }
      } else if (stmt.type === "ModuleDeclaration") {
        const nameNode = findChildByType(stmt, "IDENTIFIER");
        const paramListNode = findChildByType(stmt, "ParameterList");
        const bodyNode = findChildByType(stmt, "Statement") ?? findChildByType(stmt, "BlockStatement");
        if (nameNode) {
          const name = nameNode.text.trim();
          if (seenModules.has(name)) {
            emit(
              nameNode,
              "SCAD_DUPLICATE_DECLARATION",
              "error",
              `Duplicate module declaration '${name}' in the same scope.`,
            );
          }
          seenModules.add(name);
          const { params, paramNodes, requiredParams, defaultExprs } = parseParameterList(paramListNode);
          // Check duplicate parameter names
          const seenParams = new Set<string>();
          for (const p of params) {
            if (seenParams.has(p)) {
              emit(
                paramNodes.get(p) ?? nameNode,
                "SCAD_DUPLICATE_DECLARATION",
                "error",
                `Duplicate parameter '${p}' in module '${name}'.`,
              );
            }
            seenParams.add(p);
          }
          scope.modules.set(name, {
            name,
            params,
            requiredParams,
            defaultExprs,
            bodyNode,
            declScope: scope,
          });
        }
      } else if (stmt.type === "FunctionDeclaration") {
        const nameNode = findChildByType(stmt, "IDENTIFIER");
        const paramListNode = findChildByType(stmt, "ParameterList");
        const bodyNode = findChildByType(stmt, "Expression");
        if (nameNode) {
          const name = nameNode.text.trim();
          if (seenFunctions.has(name)) {
            emit(
              nameNode,
              "SCAD_DUPLICATE_DECLARATION",
              "error",
              `Duplicate function declaration '${name}' in the same scope.`,
            );
          }
          seenFunctions.add(name);
          const { params, paramNodes, requiredParams, defaultExprs } = parseParameterList(paramListNode);
          const seenParams = new Set<string>();
          for (const p of params) {
            if (seenParams.has(p)) {
              emit(
                paramNodes.get(p) ?? nameNode,
                "SCAD_DUPLICATE_DECLARATION",
                "error",
                `Duplicate parameter '${p}' in function '${name}'.`,
              );
            }
            seenParams.add(p);
          }
          scope.functions.set(name, {
            name,
            params,
            requiredParams,
            defaultExprs,
            bodyNode,
            declScope: scope,
          });
        }
      }
    }
  };

  const checkPrimarySolid = (solidNode: ScadCstNode | null | undefined, scope: LintScope) => {
    if (!solidNode) return;
    const inner = solidNode.type === "PrimarySolid" ? solidNode.child(0) : solidNode;
    if (!inner) return;
    const type = inner.type;

    const argListNode = findChildByType(inner, "ArgumentList");
    const parsedArgs = parseArgumentList(argListNode);
    for (const arg of parsedArgs.all) {
      checkExpression(arg.valueNode, scope);
    }

    if (type === "CubePrimitive") {
      const sizeArg = parsedArgs.positional[0] ?? parsedArgs.named.get("size");
      if (sizeArg) {
        checkPositiveDimension(sizeArg.valueNode, scope, "cube", "size", 3);
      }
      return;
    }

    if (type === "CylinderPrimitive") {
      const hArg = parsedArgs.named.get("h") ?? parsedArgs.positional[0];
      if (hArg) {
        checkPositiveDimension(hArg.valueNode, scope, "cylinder", "h");
      }
      const rArg = parsedArgs.named.get("r") ?? parsedArgs.positional[1];
      if (rArg) {
        checkPositiveDimension(rArg.valueNode, scope, "cylinder", "r");
      }
      const r1Arg = parsedArgs.named.get("r1");
      if (r1Arg) {
        const val = tryEvalExpr(r1Arg.valueNode, scope);
        if (typeof val === "number" && val < 0) {
          emit(
            r1Arg.valueNode,
            "SCAD_INVALID_DIMENSION",
            "error",
            `Invalid negative radius (${val}) in 'cylinder' parameter 'r1': must be >= 0.`,
          );
        }
      }
      const r2Arg = parsedArgs.named.get("r2");
      if (r2Arg) {
        const val = tryEvalExpr(r2Arg.valueNode, scope);
        if (typeof val === "number" && val < 0) {
          emit(
            r2Arg.valueNode,
            "SCAD_INVALID_DIMENSION",
            "error",
            `Invalid negative radius (${val}) in 'cylinder' parameter 'r2': must be >= 0.`,
          );
        }
      }
      const dArg = parsedArgs.named.get("d");
      if (dArg) {
        checkPositiveDimension(dArg.valueNode, scope, "cylinder", "d");
      }
      return;
    }

    if (type === "SpherePrimitive") {
      const rArg = parsedArgs.named.get("r") ?? parsedArgs.positional[0];
      if (rArg) {
        checkPositiveDimension(rArg.valueNode, scope, "sphere", "r");
      }
      const dArg = parsedArgs.named.get("d");
      if (dArg) {
        checkPositiveDimension(dArg.valueNode, scope, "sphere", "d");
      }
      return;
    }

    if (type === "CirclePrimitive") {
      const rArg = parsedArgs.named.get("r") ?? parsedArgs.positional[0];
      if (rArg) {
        checkPositiveDimension(rArg.valueNode, scope, "circle", "r");
      }
      const dArg = parsedArgs.named.get("d");
      if (dArg) {
        checkPositiveDimension(dArg.valueNode, scope, "circle", "d");
      }
      return;
    }

    if (type === "SquarePrimitive") {
      const sizeArg = parsedArgs.positional[0] ?? parsedArgs.named.get("size");
      if (sizeArg) {
        checkPositiveDimension(sizeArg.valueNode, scope, "square", "size", 2);
      }
      return;
    }

    if (type === "ModuleInstantiation") {
      const nameNode = findChildByType(inner, "IDENTIFIER");
      if (!nameNode) return;
      const modName = nameNode.text.trim();
      const userMod = scope.getModule(modName);
      if (!userMod && !BUILTIN_MODULES.has(modName)) {
        emit(nameNode, "SCAD_UNDEFINED_MODULE", "error", `Undefined module '${modName}'.`);
      } else if (userMod) {
        validateCallArguments(nameNode, userMod, parsedArgs, "module");
      }
    }
  };

  const checkStatement = (rawStmt: ScadCstNode | null | undefined, scope: LintScope) => {
    if (!rawStmt) return;
    const stmt = rawStmt.type === "Statement" || rawStmt.type === "OperatorChildStatement" ? rawStmt.child(0) : rawStmt;
    if (!stmt) return;
    const type = stmt.type;

    if (type === "IncludeStatement" || type === "UseStatement") {
      return;
    }

    if (type === "VariableDeclaration") {
      const nameNode = findChildByType(stmt, "IDENTIFIER");
      const exprNode = findChildByType(stmt, "Expression");
      if (exprNode) {
        checkExpression(exprNode, scope);
        if (nameNode) {
          scope.vars.set(nameNode.text.trim(), { value: tryEvalExpr(exprNode, scope), node: nameNode });
        }
      }
      return;
    }

    if (type === "ModuleDeclaration") {
      const paramListNode = findChildByType(stmt, "ParameterList");
      const { params, defaultExprs } = parseParameterList(paramListNode);
      for (const [, defExpr] of defaultExprs) {
        checkExpression(defExpr, scope);
      }
      const modScope = new LintScope(scope);
      for (const p of params) {
        const defExpr = defaultExprs.get(p);
        modScope.vars.set(p, { value: defExpr ? tryEvalExpr(defExpr, scope) : undefined, node: paramListNode });
      }
      const bodyNode = findChildByType(stmt, "Statement") ?? findChildByType(stmt, "BlockStatement");
      if (bodyNode) {
        checkStatement(bodyNode, modScope);
      }
      return;
    }

    if (type === "FunctionDeclaration") {
      const paramListNode = findChildByType(stmt, "ParameterList");
      const { params, defaultExprs } = parseParameterList(paramListNode);
      for (const [, defExpr] of defaultExprs) {
        checkExpression(defExpr, scope);
      }
      const fnScope = new LintScope(scope);
      for (const p of params) {
        const defExpr = defaultExprs.get(p);
        fnScope.vars.set(p, { value: defExpr ? tryEvalExpr(defExpr, scope) : undefined, node: paramListNode });
      }
      const bodyNode = findChildByType(stmt, "Expression");
      if (bodyNode) {
        checkExpression(bodyNode, fnScope);
      }
      return;
    }

    if (type === "BlockStatement") {
      const blockScope = new LintScope(scope);
      const childStmts: ScadCstNode[] = [];
      for (let i = 0; i < stmt.childCount; i++) {
        const c = stmt.child(i);
        if (c && c.type === "Statement") childStmts.push(c);
      }
      hoistDeclarations(childStmts, blockScope);
      for (const c of childStmts) {
        checkStatement(c, blockScope);
      }
      return;
    }

    if (type === "IfStatement") {
      const exprNode = findChildByType(stmt, "Expression");
      if (exprNode) checkExpression(exprNode, scope);
      for (let i = 0; i < stmt.childCount; i++) {
        const c = stmt.child(i);
        if (c && (c.type === "Statement" || c.type === "BlockStatement")) {
          checkStatement(c, new LintScope(scope));
        }
      }
      return;
    }

    if (type === "ForStatement") {
      const varNode = findChildByType(stmt, "IDENTIFIER");
      const rangeNode = findChildByType(stmt, "Expression");
      if (rangeNode) checkExpression(rangeNode, scope);
      const loopScope = new LintScope(scope);
      if (varNode) {
        loopScope.vars.set(varNode.text.trim(), { value: undefined, node: varNode });
      }
      const bodyNode = findChildByType(stmt, "Statement") ?? findChildByType(stmt, "BlockStatement");
      if (bodyNode) checkStatement(bodyNode, loopScope);
      return;
    }

    if (type === "PrefixSolid") {
      const opNode =
        findChildByType(stmt, "TransformOp") ??
        findChildByType(stmt, "LinearExtrudeOp") ??
        findChildByType(stmt, "BooleanOp") ??
        findChildByType(stmt, "TagPortOp") ??
        findChildByType(stmt, "ModuleInstantiation");
      if (opNode) {
        if (opNode.type === "ModuleInstantiation") {
          checkPrimarySolid(opNode, scope);
        } else {
          const argListNode = findChildByType(opNode, "ArgumentList");
          const parsedArgs = parseArgumentList(argListNode);
          for (const arg of parsedArgs.all) {
            checkExpression(arg.valueNode, scope);
          }
          if (opNode.type === "LinearExtrudeOp" && opNode.text.trim().startsWith("linear_extrude")) {
            const heightArg = parsedArgs.positional[0] ?? parsedArgs.named.get("height");
            if (heightArg) {
              checkPositiveDimension(heightArg.valueNode, scope, "linear_extrude", "height");
            }
          }
        }
      }
      const childStmt =
        findChildByType(stmt, "OperatorChildStatement") ??
        findChildByType(stmt, "Statement") ??
        findChildByType(stmt, "BlockStatement");
      if (childStmt) checkStatement(childStmt, scope);
      return;
    }

    if (type === "ChainedSolidStatement" || type === "ChainedSolid") {
      const chainedNode = type === "ChainedSolidStatement" ? findChildByType(stmt, "ChainedSolid") : stmt;
      if (!chainedNode) return;
      const primaryNode = findChildByType(chainedNode, "PrimarySolid");
      if (primaryNode) checkPrimarySolid(primaryNode, scope);

      for (let i = 0; i < chainedNode.childCount; i++) {
        const c = chainedNode.child(i);
        if (!c || c.type !== "MethodCall") continue;
        const methodNameNode = findChildByType(c, "MethodName") ?? findChildByType(c, "IDENTIFIER");
        const methodName = methodNameNode ? methodNameNode.text.trim() : "";
        if (methodName && !BUILTIN_METHODS.has(methodName)) {
          emit(
            methodNameNode,
            "SCAD_UNKNOWN_METHOD",
            "error",
            `Unknown CAD transform method '.${methodName}()'. Supported methods: translate, rotate, scale, mirror, color, fillet, chamfer.`,
          );
        }
        const argListNode = findChildByType(c, "ArgumentList");
        const parsedArgs = parseArgumentList(argListNode);
        for (const arg of parsedArgs.all) {
          checkExpression(arg.valueNode, scope);
        }
        if (methodName === "fillet") {
          const rArg = parsedArgs.positional[0] ?? parsedArgs.named.get("r");
          if (rArg) checkPositiveDimension(rArg.valueNode, scope, "fillet", "r");
        } else if (methodName === "chamfer") {
          const dArg = parsedArgs.positional[0] ?? parsedArgs.named.get("d");
          if (dArg) checkPositiveDimension(dArg.valueNode, scope, "chamfer", "d");
        }
      }
    }
  };

  const rootScope = new LintScope(null);
  const topStmts: ScadCstNode[] = [];
  for (let i = 0; i < rootNode.childCount; i++) {
    const c = rootNode.child(i);
    if (c && c.type === "Statement") topStmts.push(c);
  }

  hoistDeclarations(topStmts, rootScope);
  for (const s of topStmts) {
    checkStatement(s, rootScope);
  }

  return diagnostics;
}

// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  CdclSatSolver,
  DpllTSolver,
  Interval,
  TseitinEncoder,
  type ExprNode,
  type LitId,
  type NonlinearConstraint,
  type PropExpr,
  type QueryDB,
  type SymbolEntry,
} from "@modelscript/runtime";
import {
  collapseWhitespace,
  collectCstLeaves,
  parseSysmlSource,
  readDottedChainFromLeaves,
  sliceBetweenLeaves,
  type CstLeaf,
} from "./cst-utils.js";
import { formatSysML2Expr, parseSysML2Expression, type SysML2ExprAst } from "./evaluator.js";
import { findFirstDescendant, type SysmlCstNode } from "./flattener/cst-lowerer.js";
import { getSysmlParser } from "./sysml2-dae-lowerer.js";

/**
 * Diagnostic emitted when a state machine transition hazard is identified.
 */
export interface StateDeterminismDiagnostic {
  /** Hazard category: overlapping transition guards (`nondeterminism`) or uncovered guard range (`deadlock`). */
  type: "nondeterminism" | "deadlock";
  /** Name of the source state exhibiting the transition hazard. */
  stateName: string;
  /** First conflicting outgoing transition name when `type === "nondeterminism"`. */
  transitionA?: string | undefined;
  /** Second conflicting outgoing transition name when `type === "nondeterminism"`. */
  transitionB?: string | undefined;
  /** Guard condition string of `transitionA`. */
  guardA?: string | undefined;
  /** Guard condition string of `transitionB`. */
  guardB?: string | undefined;
  /** Human-readable explanation of the overlapping witness interval or unhandled domain gap. */
  message: string;
  /** Interval notation describing the uncovered variable range when `type === "deadlock"`. */
  unhandledRange?: string | undefined;
}

/**
 * Full result of state machine determinism and completeness verification.
 */
export interface StateDeterminismResult {
  /** True if all pairwise outgoing transition guards from every verified state are mutually exclusive. */
  isDeterministic: boolean;
  /** True if every verified state with guarded transitions covers the entire real domain (or has an unguarded fallback). */
  isComplete: boolean;
  /** List of nondeterminism and deadlock diagnostics discovered across verified states. */
  diagnostics: StateDeterminismDiagnostic[];
}

/**
 * Normalized representation of a single comparison constraint.
 */
export interface GuardConstraint {
  /** Canonical variable identifier referenced by the comparison (or primary variable for nonlinear constraints). */
  variable: string;
  /** Relational comparison operator. */
  operator: "<=" | "<" | ">=" | ">" | "==" | "!=";
  /** Numeric right-hand side constant threshold. */
  value: number;
  /** Optional AST-backed nonlinear constraint payload for DPLL(T) + HC4 interval contractor solving. */
  nonlinear?: NonlinearConstraint | undefined;
}

/**
 * Recursively extracts all variable names referenced in an arithmetic expression DAG.
 */
export function extractVariables(node: ExprNode, out: Set<string>): void {
  switch (node.kind) {
    case "var":
      out.add(node.name);
      break;
    case "const":
      break;
    case "neg":
    case "sqr":
    case "sqrt":
    case "sin":
    case "cos":
      extractVariables(node.child, out);
      break;
    case "add":
    case "sub":
    case "mul":
    case "div":
    case "pow":
      extractVariables(node.left, out);
      extractVariables(node.right, out);
      break;
    case "call":
      for (const arg of node.args) {
        extractVariables(arg, out);
      }
      break;
  }
}

function extractMaxAbsConstant(node: ExprNode): number {
  switch (node.kind) {
    case "const":
      return Number.isFinite(node.value) ? Math.abs(node.value) : 0;
    case "var":
      return 0;
    case "neg":
    case "sqr":
    case "sqrt":
    case "sin":
    case "cos":
      return extractMaxAbsConstant(node.child);
    case "add":
    case "sub":
    case "mul":
    case "div":
    case "pow":
      return Math.max(extractMaxAbsConstant(node.left), extractMaxAbsConstant(node.right));
    case "call": {
      let m = 0;
      for (const arg of node.args) m = Math.max(m, extractMaxAbsConstant(arg));
      return m;
    }
  }
}

function serializeExprNode(node: ExprNode): string {
  switch (node.kind) {
    case "var":
      return `v:${node.name}`;
    case "const":
      return `c:${node.value}`;
    case "neg":
    case "sqr":
    case "sqrt":
    case "sin":
    case "cos":
      return `${node.kind}(${serializeExprNode(node.child)})`;
    case "add":
    case "mul": {
      const a = serializeExprNode(node.left);
      const b = serializeExprNode(node.right);
      return a <= b ? `${node.kind}(${a},${b})` : `${node.kind}(${b},${a})`;
    }
    case "sub":
    case "div":
    case "pow":
      return `${node.kind}(${serializeExprNode(node.left)},${serializeExprNode(node.right)})`;
    case "call":
      return `call:${node.fn}(${node.args.map(serializeExprNode).join(",")})`;
  }
}

function isNumericLiteral(s: string): boolean {
  if (!s) return false;
  let hasDot = false;
  let start = 0;
  if (s[0] === "-" || s[0] === "+") start = 1;
  if (start >= s.length) return false;
  for (let i = start; i < s.length; i++) {
    const c = s[i]!;
    if (c >= "0" && c <= "9") continue;
    if (c === "." && !hasDot) {
      hasDot = true;
      continue;
    }
    return false;
  }
  return true;
}

function isIdentifier(s: string): boolean {
  if (!s) return false;
  const first = s[0]!;
  if (!((first >= "a" && first <= "z") || (first >= "A" && first <= "Z") || first === "_")) return false;
  for (let i = 1; i < s.length; i++) {
    const c = s[i]!;
    if (!((c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || (c >= "0" && c <= "9") || c === "_" || c === ".")) {
      return false;
    }
  }
  return true;
}

/**
 * Converts a CST expression node into an ExprNode for formal solvers (DPLL(T) / HC4-Revise).
 */
function cstToExprNode(node: SysmlCstNode | null | undefined): ExprNode | undefined {
  if (!node) return undefined;
  while (
    node.type === "OwnedExpression" ||
    node.type === "SequenceExpression" ||
    node.type === "ResultExpressionMember" ||
    node.type === "_Expression" ||
    node.type === "_BaseExpression"
  ) {
    const inner: SysmlCstNode | null | undefined =
      node.childForFieldName?.("ownedRelatedElement") ||
      ((node.childCount ?? 0) > 0 ? (node.child ? node.child(0) : node.children?.[0]) : null);
    if (inner && inner !== node) {
      node = inner;
    } else {
      break;
    }
  }

  const count = node.childCount ?? 0;

  // Parenthesized: ( expr )
  if (count >= 3) {
    const first = node.child ? node.child(0) : node.children?.[0];
    const last = node.child ? node.child(count - 1) : node.children?.[count - 1];
    if (first?.text === "(" && last?.text === ")") {
      const inner = node.child ? node.child(1) : node.children?.[1];
      return cstToExprNode(inner);
    }
  }

  // Number literal
  if (isNumericLiteral(node.text)) {
    return { kind: "const", value: parseFloat(node.text) };
  }

  // CST InvocationExpression: sin(x), cos(x), sqrt(x), sqr(x)
  if (node.type === "InvocationExpression") {
    const fnNameNode = findFirstDescendant(node, "ID") || node.childForFieldName?.("type");
    const fnName = fnNameNode?.text?.trim()?.toLowerCase();
    const argNode = findFirstDescendant(node, "Argument") || findFirstDescendant(node, "FeatureReferenceExpression");
    if (argNode && fnName) {
      const arg = cstToExprNode(argNode);
      if (arg) {
        if (fnName === "sin") return { kind: "sin", child: arg };
        if (fnName === "cos") return { kind: "cos", child: arg };
        if (fnName === "sqrt") return { kind: "sqrt", child: arg };
        if (fnName === "sqr") return { kind: "sqr", child: arg };
      }
    }
  }

  // Function calls: sin(x), cos(x), sqrt(x), sqr(x)
  if (count >= 3 && (node.child ? node.child(1)?.text === "(" : node.children?.[1]?.text === "(")) {
    const fnName = (node.child ? node.child(0)?.text : node.children?.[0]?.text)?.toLowerCase();
    const arg = cstToExprNode(node.child ? node.child(2) : node.children?.[2]);
    if (arg) {
      if (fnName === "sin") return { kind: "sin", child: arg };
      if (fnName === "cos") return { kind: "cos", child: arg };
      if (fnName === "sqrt") return { kind: "sqrt", child: arg };
      if (fnName === "sqr") return { kind: "sqr", child: arg };
    }
  }

  // Field-based AdditiveExpression or MultiplicativeExpression
  if (node.type === "AdditiveExpression" || node.type === "MultiplicativeExpression") {
    const operands: SysmlCstNode[] = node.childrenForFieldName ? node.childrenForFieldName("operand") : [];
    const operators: string[] = node.childrenForFieldName
      ? node.childrenForFieldName("operator").map((c: SysmlCstNode) => c.text?.trim() || "+")
      : [];
    if (operands.length >= 2 && operators.length >= 1) {
      let current = cstToExprNode(operands[0]);
      for (let i = 0; i < operators.length && i + 1 < operands.length; i++) {
        const next = cstToExprNode(operands[i + 1]);
        if (!current || !next) return undefined;
        const op = operators[i];
        if (op === "+") current = { kind: "add", left: current, right: next };
        else if (op === "-") current = { kind: "sub", left: current, right: next };
        else if (op === "*") current = { kind: "mul", left: current, right: next };
        else if (op === "/") current = { kind: "div", left: current, right: next };
      }
      if (current) return current;
    }
  }

  // Binary expression
  if (count >= 3) {
    const op = node.child ? node.child(1)?.text : node.children?.[1]?.text;
    const left = cstToExprNode(node.child ? node.child(0) : node.children?.[0]);
    const right = cstToExprNode(node.child ? node.child(2) : node.children?.[2]);
    if (left && right && op) {
      if (op === "+") return { kind: "add", left, right };
      if (op === "-") return { kind: "sub", left, right };
      if (op === "*") return { kind: "mul", left, right };
      if (op === "/") return { kind: "div", left, right };
      if (op === "^" || op === "**") {
        if (right.kind === "const") {
          if (right.value === 2) return { kind: "sqr", child: left };
          if (right.value === 3) return { kind: "mul", left, right: { kind: "sqr", child: left } };
          if (right.value === 4) return { kind: "sqr", child: { kind: "sqr", child: left } };
          if (right.value === 0.5) return { kind: "sqrt", child: left };
        }
      }
    }
  }

  // Unary expression
  if (count === 2) {
    const op = node.child ? node.child(0)?.text : node.children?.[0]?.text;
    const operand = cstToExprNode(node.child ? node.child(1) : node.children?.[1]);
    if (op === "-" && operand) {
      if (operand.kind === "const") return { kind: "const", value: -operand.value };
      return { kind: "neg", child: operand };
    }
    if (op === "+" && operand) return operand;
  }

  // Variable identifier
  if (isIdentifier(node.text)) {
    return { kind: "var", name: node.text };
  }

  return undefined;
}

/**
 * Parses an arithmetic expression supporting +, -, *, /, ^2, sin, cos, sqrt.
 */
function parseArithmeticExpression(str: string): ExprNode | undefined {
  const trimmed = str.trim();
  // Fast-path: Native WASM GLR parser
  const parser = getSysmlParser();
  if (parser) {
    try {
      const tree = parser.parse(`calc def __E { return ${trimmed}; }`);
      if (tree?.rootNode && !tree.rootNode.hasError) {
        const retNode =
          findFirstDescendant(tree.rootNode, "ReturnStatement") ||
          findFirstDescendant(tree.rootNode, "ResultExpressionMember");
        if (retNode) {
          const exprChild =
            (retNode.childCount ?? 0) > 1
              ? retNode.child
                ? retNode.child(1)
                : retNode.children?.[1]
              : retNode.child
                ? retNode.child(0)
                : retNode.children?.[0];
          const node = cstToExprNode(exprChild);
          if (node) return node;
        }
      }
    } catch {
      // Fallback to legacy tokenizer
    }
  }

  const tokens: string[] = [];
  let idx = 0;
  const sLen = str.length;
  while (idx < sLen) {
    const ch = str[idx]!;
    if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
      idx++;
      continue;
    }
    if (ch === "+" || ch === "-" || ch === "*" || ch === "/" || ch === "^" || ch === "(" || ch === ")") {
      tokens.push(ch);
      idx++;
      continue;
    }
    if (ch >= "0" && ch <= "9") {
      const numStart = idx;
      idx++;
      let hasDot = false;
      while (idx < sLen) {
        const c = str[idx]!;
        if (c >= "0" && c <= "9") {
          idx++;
        } else if (c === "." && !hasDot && idx + 1 < sLen && str[idx + 1]! >= "0" && str[idx + 1]! <= "9") {
          hasDot = true;
          idx++;
        } else {
          break;
        }
      }
      tokens.push(str.slice(numStart, idx));
      continue;
    }
    if ((ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_") {
      const idStart = idx;
      idx++;
      while (idx < sLen) {
        const c = str[idx]!;
        if ((c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || (c >= "0" && c <= "9") || c === "_" || c === ".") {
          idx++;
        } else {
          break;
        }
      }
      tokens.push(str.slice(idStart, idx));
      continue;
    }
    return undefined;
  }
  if (tokens.length === 0) return undefined;

  let pos = 0;
  const peek = () => tokens[pos];
  const consume = () => tokens[pos++];

  function parseExpr(): ExprNode | undefined {
    return parseAdditive();
  }

  function parseAdditive(): ExprNode | undefined {
    let node = parseMultiplicative();
    if (!node) return undefined;

    while (peek() === "+" || peek() === "-") {
      const op = consume();
      const right = parseMultiplicative();
      if (!right) return undefined;
      node = op === "+" ? { kind: "add", left: node, right } : { kind: "sub", left: node, right };
    }
    return node;
  }

  function parseMultiplicative(): ExprNode | undefined {
    let node = parsePower();
    if (!node) return undefined;

    while (peek() === "*" || peek() === "/") {
      const op = consume();
      const right = parsePower();
      if (!right) return undefined;
      node = op === "*" ? { kind: "mul", left: node, right } : { kind: "div", left: node, right };
    }
    return node;
  }

  function parsePower(): ExprNode | undefined {
    let node = parseUnary();
    if (!node) return undefined;

    if (peek() === "^") {
      consume();
      const right = parseUnary();
      if (!right) return undefined;
      if (right.kind === "const" && right.value === 2) {
        node = { kind: "sqr", child: node };
      } else {
        return undefined;
      }
    }
    return node;
  }

  function parseUnary(): ExprNode | undefined {
    if (peek() === "-") {
      consume();
      const child = parseUnary();
      if (!child) return undefined;
      if (child.kind === "const") {
        return { kind: "const", value: -child.value };
      }
      return { kind: "neg", child };
    }
    if (peek() === "+") {
      consume();
      return parseUnary();
    }
    return parsePrimary();
  }

  function parsePrimary(): ExprNode | undefined {
    const t = peek();
    if (!t) return undefined;

    if (t === "(") {
      consume();
      const inner = parseExpr();
      if (!inner || consume() !== ")") return undefined;
      return inner;
    }

    if (isNumericLiteral(t)) {
      consume();
      return { kind: "const", value: parseFloat(t) };
    }

    // Function call: sin(x), cos(x), sqrt(x), sqr(x)
    if (tokens[pos + 1] === "(") {
      const fn = consume();
      consume(); // '('
      const arg = parseExpr();
      if (!arg || consume() !== ")") return undefined;
      const lower = fn!.toLowerCase();
      if (lower === "sin") return { kind: "sin", child: arg };
      if (lower === "cos") return { kind: "cos", child: arg };
      if (lower === "sqrt") return { kind: "sqrt", child: arg };
      if (lower === "sqr") return { kind: "sqr", child: arg };
      return undefined;
    }

    // Variable identifier
    if (isIdentifier(t)) {
      consume();
      return { kind: "var", name: t };
    }

    return undefined;
  }

  const result = parseExpr();
  if (pos !== tokens.length) return undefined;
  return result;
}

function invertRelationalOp(op: GuardConstraint["operator"]): GuardConstraint["operator"] {
  switch (op) {
    case "<":
      return ">";
    case "<=":
      return ">=";
    case ">":
      return "<";
    case ">=":
      return "<=";
    case "==":
      return "==";
    case "!=":
      return "!=";
  }
}

function negateRelationalOp(op: GuardConstraint["operator"]): GuardConstraint["operator"] {
  switch (op) {
    case "<":
      return ">=";
    case "<=":
      return ">";
    case ">":
      return "<=";
    case ">=":
      return "<";
    case "==":
      return "!=";
    case "!=":
      return "==";
  }
}

/**
 * Attempts to parse a nonlinear comparison constraint (e.g., "x^2 + y^2 <= 1", "sin(x) > 0.8").
 */
export function parseNonlinearGuardConstraint(token: string): GuardConstraint | undefined {
  const ops: GuardConstraint["operator"][] = ["<=", ">=", "==", "!=", "<", ">"];
  let opIdx = -1;
  let matchedOp: GuardConstraint["operator"] | undefined = undefined;
  for (const o of ops) {
    const idx = token.indexOf(o);
    if (idx !== -1 && (opIdx === -1 || idx < opIdx)) {
      opIdx = idx;
      matchedOp = o;
    }
  }
  if (opIdx === -1 || !matchedOp) return undefined;

  const lhsStr = token.substring(0, opIdx).trim();
  const rhsStr = token.substring(opIdx + matchedOp.length).trim();

  const lhsNode = parseArithmeticExpression(lhsStr);
  const rhsNode = parseArithmeticExpression(rhsStr);
  if (!lhsNode || !rhsNode) return undefined;

  let expr: ExprNode;
  let rhsVal: number;
  let effectiveOp: GuardConstraint["operator"] = matchedOp;

  if (rhsNode.kind === "const") {
    expr = lhsNode;
    rhsVal = rhsNode.value;
  } else if (lhsNode.kind === "const") {
    expr = rhsNode;
    rhsVal = lhsNode.value;
    effectiveOp = invertRelationalOp(matchedOp);
  } else {
    expr = { kind: "sub", left: lhsNode, right: rhsNode };
    rhsVal = 0;
  }

  const varNames = new Set<string>();
  extractVariables(expr, varNames);
  const primaryVar = Array.from(varNames)[0] || "$nl";

  return {
    variable: primaryVar,
    operator: effectiveOp,
    value: rhsVal,
    nonlinear: {
      expr,
      rel: effectiveOp,
      rhs: rhsVal,
    },
  };
}

/**
 * Parses a textual guard expression into a list of atomic constraints.
 * Supports conjunctions (`&&`, `and`) of simple numeric comparisons.
 */
export function parseGuardConstraints(guardText: string): GuardConstraint[] {
  const constraints: GuardConstraint[] = [];
  // Strip outer brackets if any: e.g. "[x >= 0]"
  let cleaned = guardText.trim();
  if (cleaned.startsWith("[") && cleaned.endsWith("]")) {
    cleaned = cleaned.substring(1, cleaned.length - 1).trim();
  }
  if (cleaned.startsWith("(") && cleaned.endsWith(")")) {
    // Only strip outer parens when balanced across the entire expression
    let depth = 0;
    let balancedOuter = true;
    for (let i = 0; i < cleaned.length; i++) {
      if (cleaned[i] === "(") depth++;
      else if (cleaned[i] === ")") {
        depth--;
        if (depth === 0 && i < cleaned.length - 1) {
          balancedOuter = false;
          break;
        }
      }
    }
    if (balancedOuter && depth === 0) {
      cleaned = cleaned.substring(1, cleaned.length - 1).trim();
    }
  }

  // Split on "&&" or "and" at top-level
  const tokens: string[] = [];
  let depth = 0;
  let current = "";
  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i]!;
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;

    if (depth === 0) {
      if (cleaned.substring(i, i + 2) === "&&") {
        tokens.push(current.trim());
        current = "";
        i += 1;
        continue;
      }
      if (cleaned.substring(i, i + 5).toLowerCase() === " and " && i > 0) {
        tokens.push(current.trim());
        current = "";
        i += 4;
        continue;
      }
    }
    current += ch;
  }
  if (current.trim()) {
    tokens.push(current.trim());
  }

  for (const token of tokens) {
    const trimmed = token.trim();
    if (!trimmed) continue;

    // Check simple comparison: variable op value or value op variable
    const ops: GuardConstraint["operator"][] = ["<=", ">=", "==", "!=", "<", ">"];
    let opIdx = -1;
    let matchedOp: GuardConstraint["operator"] | undefined = undefined;
    for (const o of ops) {
      const idx = trimmed.indexOf(o);
      if (idx !== -1 && (opIdx === -1 || idx < opIdx)) {
        opIdx = idx;
        matchedOp = o;
      }
    }

    if (opIdx !== -1 && matchedOp) {
      const lhs = trimmed.substring(0, opIdx).trim();
      const rhs = trimmed.substring(opIdx + matchedOp.length).trim();
      if (isIdentifier(lhs) && isNumericLiteral(rhs)) {
        constraints.push({
          variable: lhs,
          operator: matchedOp,
          value: parseFloat(rhs),
        });
        continue;
      } else if (isNumericLiteral(lhs) && isIdentifier(rhs)) {
        const val = parseFloat(lhs);
        constraints.push({
          variable: rhs,
          operator: invertRelationalOp(matchedOp),
          value: val,
        });
        continue;
      }
    }

    // Fall back to nonlinear expression parser
    const nlConstraint = parseNonlinearGuardConstraint(trimmed);
    if (nlConstraint) {
      constraints.push(nlConstraint);
    }
  }

  return constraints;
}

/**
 * Represents a guard in Disjunctive Normal Form (DNF):
 * a list of conjunctive clauses, where the guard is satisfied if ANY clause is satisfied.
 */
export type GuardDNF = GuardConstraint[][];

/**
 * Parses a guard expression supporting both conjunctions (`&&`, `and`)
 * and disjunctions (`||`, `or`) into Disjunctive Normal Form (DNF).
 *
 * @returns Array of conjunctive clauses (DNF). Empty array if unparseable.
 */
export function parseGuardDNF(guardText: string): GuardDNF {
  let cleaned = guardText.trim();
  if (cleaned.startsWith("[") && cleaned.endsWith("]")) {
    cleaned = cleaned.substring(1, cleaned.length - 1).trim();
  }

  // Split on "||" or " or " at top-level (respecting parenthesized groups)
  const disjuncts: string[] = [];
  let depth = 0;
  let current = "";

  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i]!;
    if (ch === "(") depth++;
    else if (ch === ")") depth--;

    if (depth === 0) {
      if (cleaned.substring(i, i + 2) === "||") {
        disjuncts.push(current.trim());
        current = "";
        i += 1;
        continue;
      }
      if (cleaned.substring(i, i + 4).toLowerCase() === " or " && i > 0) {
        disjuncts.push(current.trim());
        current = "";
        i += 3;
        continue;
      }
    }

    current += ch;
  }
  if (current.trim()) {
    disjuncts.push(current.trim());
  }

  const dnf: GuardDNF = [];
  for (const disj of disjuncts) {
    const conj = parseGuardConstraints(disj);
    if (conj.length > 0) {
      dnf.push(conj);
    }
  }

  return dnf;
}

interface RealBound {
  lower: number;
  lowerStrict: boolean;
  upper: number;
  upperStrict: boolean;
  notEquals: Set<number>;
}

function applyBoundConstraint(b: RealBound, op: NonlinearConstraint["rel"], val: number): boolean {
  switch (op) {
    case "<=":
      if (val < b.upper) {
        b.upper = val;
        b.upperStrict = false;
      }
      break;
    case "<":
      if (val < b.upper || (val === b.upper && !b.upperStrict)) {
        b.upper = val;
        b.upperStrict = true;
      }
      break;
    case ">=":
      if (val > b.lower) {
        b.lower = val;
        b.lowerStrict = false;
      }
      break;
    case ">":
      if (val > b.lower || (val === b.lower && !b.lowerStrict)) {
        b.lower = val;
        b.lowerStrict = true;
      }
      break;
    case "==":
      if (val > b.lower) {
        b.lower = val;
        b.lowerStrict = false;
      }
      if (val < b.upper) {
        b.upper = val;
        b.upperStrict = false;
      }
      break;
    case "!=":
      b.notEquals.add(val);
      break;
  }

  return !(
    b.lower > b.upper ||
    (b.lower === b.upper && (b.lowerStrict || b.upperStrict)) ||
    (b.lower === b.upper && b.notEquals.has(b.lower))
  );
}

/**
 * Checks a single pair of conjunctive constraints for mutual exclusion using intervals / DPLL(T) + HC4.
 */
function checkConjunctPairMutuallyExclusive(
  conjA: GuardConstraint[],
  conjB: GuardConstraint[],
): { mutuallyExclusive: boolean; overlap?: string | undefined } {
  const allConstraints = [...conjA, ...conjB];
  const hasNonlinear = allConstraints.some((c) => c.nonlinear !== undefined);

  if (hasNonlinear) {
    // --- Route to delta-complete DPLL(T) + HC4 contractor ---
    const theoryLiterals = new Map<number, NonlinearConstraint>();
    const clauses: number[][] = [];
    const allVarNames = new Set<string>();
    const exprBoundMap = new Map<string, RealBound>();
    let maxAbsConst = 0;

    let litId = 1;
    for (const c of allConstraints) {
      let nl: NonlinearConstraint;
      if (c.nonlinear) {
        nl = c.nonlinear;
      } else {
        nl = {
          expr: { kind: "var", name: c.variable },
          rel: c.operator,
          rhs: c.value,
        };
      }
      if (Number.isFinite(nl.rhs)) {
        maxAbsConst = Math.max(maxAbsConst, Math.abs(nl.rhs));
      }
      maxAbsConst = Math.max(maxAbsConst, extractMaxAbsConstant(nl.expr));

      // Structural contradiction check on identical expressions (handles == vs !=, <= vs >, etc. exactly)
      const exprKey = serializeExprNode(nl.expr);
      let eb = exprBoundMap.get(exprKey);
      if (!eb) {
        eb = { lower: -Infinity, lowerStrict: false, upper: Infinity, upperStrict: false, notEquals: new Set() };
        exprBoundMap.set(exprKey, eb);
      }
      if (!applyBoundConstraint(eb, nl.rel, nl.rhs)) {
        return { mutuallyExclusive: true };
      }

      extractVariables(nl.expr, allVarNames);
      theoryLiterals.set(litId, nl);
      clauses.push([litId]); // Conjunction: all constraints must hold
      litId++;
    }

    const boxRadius = Math.max(1000, 10 * maxAbsConst);
    const initialBox = new Map<string, Interval>();
    for (const vName of allVarNames) {
      initialBox.set(vName, new Interval(-boxRadius, boxRadius));
    }

    // Direct bounds propagation from linear atomic constraints
    for (const c of allConstraints) {
      if (!c.nonlinear && initialBox.has(c.variable)) {
        const cur = initialBox.get(c.variable)!;
        let nextLo = cur.lo;
        let nextHi = cur.hi;
        if (c.operator === ">=") {
          nextLo = Math.max(cur.lo, c.value);
        } else if (c.operator === ">") {
          nextLo = Math.max(cur.lo, c.value + 1e-9);
        } else if (c.operator === "<=") {
          nextHi = Math.min(cur.hi, c.value);
        } else if (c.operator === "<") {
          nextHi = Math.min(cur.hi, c.value - 1e-9);
        } else if (c.operator === "==") {
          nextLo = Math.max(cur.lo, c.value);
          nextHi = Math.min(cur.hi, c.value);
        } else if (c.operator === "!=") {
          if (cur.lo === c.value && cur.hi === c.value) {
            return { mutuallyExclusive: true };
          }
        }
        if (nextLo > nextHi) {
          return { mutuallyExclusive: true };
        }
        initialBox.set(c.variable, new Interval(nextLo, nextHi));
      }
    }

    const solver = new DpllTSolver({
      clauses,
      theoryLiterals,
      initialBox,
      delta: 1e-3,
      maxSubdivisions: 1500,
    });

    const res = solver.solve(initialBox);

    if (res.status === "UNSAT") {
      return { mutuallyExclusive: true };
    }

    const parts: string[] = [];
    if (res.solutionBox) {
      for (const [name, inv] of res.solutionBox.entries()) {
        parts.push(`${name} ∈ [${inv.lo.toFixed(3)}, ${inv.hi.toFixed(3)}]`);
      }
    }

    return {
      mutuallyExclusive: false,
      overlap: parts.length > 0 ? parts.join(", ") : "satisfiable nonlinear overlap",
    };
  }

  // Fast-path for purely univariate linear comparisons: intersect strict/non-strict intervals per variable
  const boundMap = new Map<string, RealBound>();
  const getBound = (v: string): RealBound => {
    let b = boundMap.get(v);
    if (!b) {
      b = { lower: -Infinity, lowerStrict: false, upper: Infinity, upperStrict: false, notEquals: new Set() };
      boundMap.set(v, b);
    }
    return b;
  };

  for (const c of allConstraints) {
    const b = getBound(c.variable);
    if (!applyBoundConstraint(b, c.operator, c.value)) {
      return { mutuallyExclusive: true };
    }
  }

  // Construct overlapping witness interval
  const parts: string[] = [];
  for (const [name, b] of boundMap) {
    const loStr = b.lower <= -100000 ? "-∞" : b.lower.toString();
    const hiStr = b.upper >= 100000 ? "∞" : b.upper.toString();
    parts.push(`${name} ∈ [${loStr}, ${hiStr}]`);
  }

  return {
    mutuallyExclusive: false,
    overlap: parts.join(", "),
  };
}

function stripOuterGuardBrackets(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function isPureNumericGuardText(guardText: string, dnf: GuardDNF): boolean {
  if (dnf.length === 0) return false;
  const cleaned = stripOuterGuardBrackets(guardText);
  if (!cleaned) return false;
  if (cleaned.includes("::") || cleaned.includes('"') || cleaned.includes("'")) return false;

  // Reject negation `!` (not `!=`) or logical keywords (`not`, `implies`, `xor`, `true`, `false`)
  for (let i = 0; i < cleaned.length; i++) {
    if (cleaned[i] === "!" && cleaned[i + 1] !== "=") return false;
  }
  const leaves = collectCstLeaves(parseSysmlSource(cleaned));
  for (const lf of leaves) {
    const low = lf.text.toLowerCase();
    if (low === "not" || low === "implies" || low === "xor" || low === "true" || low === "false" || low === "if") {
      return false;
    }
  }

  // Verify every atomic conjunct across all disjuncts produced a numeric/nonlinear GuardConstraint
  let depth = 0;
  let expectedAtoms = 1;
  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i]!;
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
    else if (depth === 0) {
      if (cleaned.slice(i, i + 2) === "&&" || cleaned.slice(i, i + 2) === "||") {
        expectedAtoms++;
        i += 1;
      } else if (cleaned.slice(i, i + 5).toLowerCase() === " and " && i > 0) {
        expectedAtoms++;
        i += 4;
      } else if (cleaned.slice(i, i + 4).toLowerCase() === " or " && i > 0) {
        expectedAtoms++;
        i += 3;
      }
    }
  }
  let parsedAtoms = 0;
  for (const conj of dnf) parsedAtoms += conj.length;
  return parsedAtoms === expectedAtoms;
}

function getDistinctConstantTag(ast: SysML2ExprAst): string | null {
  if (ast.kind === "NumberLiteral") return `num:${ast.value}`;
  if (ast.kind === "UnaryExpr" && (ast.op === "-" || ast.op === "+") && ast.operand.kind === "NumberLiteral") {
    return `num:${ast.op === "-" ? -ast.operand.value : ast.operand.value}`;
  }
  if (ast.kind === "BooleanLiteral") return `bool:${ast.value}`;
  if (ast.kind === "StringLiteral") return `str:${ast.value}`;
  if (ast.kind === "Identifier" && ast.name.includes("::")) return `enum:${ast.name}`;
  return null;
}

function negateSingleGuardConstraint(c: GuardConstraint): GuardConstraint {
  const negOp = negateRelationalOp(c.operator);
  if (c.nonlinear) {
    return {
      variable: c.variable,
      operator: negOp,
      value: c.value,
      nonlinear: {
        expr: c.nonlinear.expr,
        rel: negOp,
        rhs: c.nonlinear.rhs,
      },
    };
  }
  return {
    variable: c.variable,
    operator: negOp,
    value: c.value,
  };
}

function checkGuardsMutuallyExclusiveSat(
  guardA: string,
  guardB: string,
): { mutuallyExclusive: boolean; overlap?: string | undefined } {
  const cleanA = stripOuterGuardBrackets(guardA);
  const cleanB = stripOuterGuardBrackets(guardB);
  if (!cleanA || !cleanB) {
    return { mutuallyExclusive: false, overlap: "unguarded condition" };
  }

  const leavesA = collectCstLeaves(parseSysmlSource(cleanA));
  const leavesB = collectCstLeaves(parseSysmlSource(cleanB));
  if (leavesA.length === 0 || leavesB.length === 0) {
    return { mutuallyExclusive: false, overlap: "non-numeric or complex condition" };
  }

  let astA: SysML2ExprAst;
  let astB: SysML2ExprAst;
  try {
    astA = parseSysML2Expression(cleanA);
    astB = parseSysML2Expression(cleanB);
  } catch {
    return { mutuallyExclusive: false, overlap: "non-numeric or complex condition" };
  }

  const encoder = new TseitinEncoder();
  const theoryVarConstraints = new Map<number, { pos: GuardConstraint; neg: GuardConstraint }>();
  const displayLabels = new Map<number, { posLabel: string; negLabel: string }>();
  const constAssignmentsByTarget = new Map<string, Map<string, LitId>>();

  const recordConstantAssignment = (targetCanon: string, constTag: string, lit: LitId) => {
    let byConst = constAssignmentsByTarget.get(targetCanon);
    if (!byConst) {
      byConst = new Map();
      constAssignmentsByTarget.set(targetCanon, byConst);
    }
    if (!byConst.has(constTag)) {
      byConst.set(constTag, lit);
    }
  };

  const astToProp = (node: SysML2ExprAst): PropExpr => {
    switch (node.kind) {
      case "BooleanLiteral":
        return { op: "const", value: node.value };
      case "NumberLiteral":
        return { op: "const", value: node.value !== 0 };
      case "StringLiteral": {
        const v = encoder.getOrCreateVar(`str:${node.value}`);
        displayLabels.set(v, { posLabel: `"${node.value}"`, negLabel: `not "${node.value}"` });
        return { op: "var", id: v };
      }
      case "Identifier": {
        const v = encoder.getOrCreateVar(`bool:${node.name}`);
        displayLabels.set(v, { posLabel: `${node.name} = true`, negLabel: `${node.name} = false` });
        return { op: "var", id: v };
      }
      case "UnaryExpr": {
        if (node.op === "not") {
          return { op: "not", child: astToProp(node.operand) };
        }
        const txt = formatSysML2Expr(node);
        const v = encoder.getOrCreateVar(`expr:${txt}`);
        displayLabels.set(v, { posLabel: txt, negLabel: `not (${txt})` });
        return { op: "var", id: v };
      }
      case "ConditionalExpr": {
        // if c then t else e  <=>  (c -> t) /\ (~c -> e)
        const c = astToProp(node.condition);
        const t = astToProp(node.thenExpr);
        const e = astToProp(node.elseExpr);
        return {
          op: "and",
          children: [
            { op: "implies", left: c, right: t },
            { op: "implies", left: { op: "not", child: c }, right: e },
          ],
        };
      }
      case "CallExpr": {
        const txt = formatSysML2Expr(node);
        const v = encoder.getOrCreateVar(`call:${txt}`);
        displayLabels.set(v, { posLabel: txt, negLabel: `not ${txt}` });
        return { op: "var", id: v };
      }
      case "BinaryExpr": {
        if (node.op === "and") {
          return { op: "and", children: [astToProp(node.left), astToProp(node.right)] };
        }
        if (node.op === "or") {
          return { op: "or", children: [astToProp(node.left), astToProp(node.right)] };
        }
        if (node.op === "implies") {
          return { op: "implies", left: astToProp(node.left), right: astToProp(node.right) };
        }
        if (node.op === "xor") {
          return { op: "xor", left: astToProp(node.left), right: astToProp(node.right) };
        }

        if (
          node.op === "==" ||
          node.op === "!=" ||
          node.op === "<=" ||
          node.op === ">=" ||
          node.op === "<" ||
          node.op === ">"
        ) {
          // Normalize boolean comparisons: x == true, x == false, x != true, x != false
          if ((node.op === "==" || node.op === "!=") && node.right.kind === "BooleanLiteral") {
            const positive = (node.op === "==") === node.right.value;
            return positive ? astToProp(node.left) : { op: "not", child: astToProp(node.left) };
          }
          if ((node.op === "==" || node.op === "!=") && node.left.kind === "BooleanLiteral") {
            const positive = (node.op === "==") === node.left.value;
            return positive ? astToProp(node.right) : { op: "not", child: astToProp(node.right) };
          }

          const atomText = `${formatSysML2Expr(node.left)} ${node.op} ${formatSysML2Expr(node.right)}`;
          const parsedNum = parseGuardConstraints(atomText);
          if (parsedNum.length === 1) {
            const gc = parsedNum[0]!;
            // Canonicalize `expr == k` vs `expr != k` to share the same propositional variable
            const exprId = gc.nonlinear ? serializeExprNode(gc.nonlinear.expr) : `v:${gc.variable}`;
            if (gc.operator === "==" || gc.operator === "!=") {
              const eqVar = encoder.getOrCreateVar(`num_eq:${exprId}:${gc.value}`);
              const posGc: GuardConstraint = gc.nonlinear
                ? { ...gc, operator: "==", nonlinear: { ...gc.nonlinear, rel: "==" } }
                : { ...gc, operator: "==" };
              theoryVarConstraints.set(eqVar, { pos: posGc, neg: negateSingleGuardConstraint(posGc) });
              displayLabels.set(eqVar, {
                posLabel: `${gc.variable} == ${gc.value}`,
                negLabel: `${gc.variable} != ${gc.value}`,
              });
              recordConstantAssignment(exprId, `num:${gc.value}`, eqVar);
              return gc.operator === "==" ? { op: "var", id: eqVar } : { op: "not", child: { op: "var", id: eqVar } };
            }

            const relVar = encoder.getOrCreateVar(`num_rel:${exprId}:${gc.operator}:${gc.value}`);
            theoryVarConstraints.set(relVar, { pos: gc, neg: negateSingleGuardConstraint(gc) });
            displayLabels.set(relVar, {
              posLabel: atomText,
              negLabel: `${gc.variable} ${negateRelationalOp(gc.operator)} ${gc.value}`,
            });
            return { op: "var", id: relVar };
          }

          // Symbolic / enum / string equality & disequality (e.g. mode == Mode::Auto, a == b, a != b)
          const leftCanon = formatSysML2Expr(node.left);
          const rightCanon = formatSysML2Expr(node.right);
          if (node.op === "==" || node.op === "!=") {
            // Trivial syntactic identity: x == x is true, x != x is false
            if (leftCanon === rightCanon) {
              return { op: "const", value: node.op === "==" };
            }
            const leftConst = getDistinctConstantTag(node.left);
            const rightConst = getDistinctConstantTag(node.right);
            if (leftConst && rightConst) {
              return { op: "const", value: node.op === "==" ? leftConst === rightConst : leftConst !== rightConst };
            }

            const pairKey = leftCanon <= rightCanon ? `${leftCanon}==${rightCanon}` : `${rightCanon}==${leftCanon}`;
            const eqVar = encoder.getOrCreateVar(`sym_eq:${pairKey}`);
            displayLabels.set(eqVar, {
              posLabel: `${leftCanon} == ${rightCanon}`,
              negLabel: `${leftCanon} != ${rightCanon}`,
            });

            if (rightConst && !leftConst) {
              recordConstantAssignment(`sym:${leftCanon}`, rightConst, eqVar);
            } else if (leftConst && !rightConst) {
              recordConstantAssignment(`sym:${rightCanon}`, leftConst, eqVar);
            }

            return node.op === "==" ? { op: "var", id: eqVar } : { op: "not", child: { op: "var", id: eqVar } };
          }

          // Symbolic strict inequality: x < x or x > x is false
          if ((node.op === "<" || node.op === ">") && leftCanon === rightCanon) {
            return { op: "const", value: false };
          }
          if ((node.op === "<=" || node.op === ">=") && leftCanon === rightCanon) {
            return { op: "const", value: true };
          }

          const symVar = encoder.getOrCreateVar(`sym_rel:${atomText}`);
          displayLabels.set(symVar, { posLabel: atomText, negLabel: `not (${atomText})` });
          return { op: "var", id: symVar };
        }

        const fallbackTxt = formatSysML2Expr(node);
        const fbVar = encoder.getOrCreateVar(`expr:${fallbackTxt}`);
        displayLabels.set(fbVar, { posLabel: fallbackTxt, negLabel: `not (${fallbackTxt})` });
        return { op: "var", id: fbVar };
      }
    }
  };

  const rootLit = encoder.encode({
    op: "and",
    children: [astToProp(astA), astToProp(astB)],
  });
  encoder.clauses.push([rootLit]);

  // Mutual exclusion of distinct constant / enum values assigned to the same expression
  for (const [, byConst] of constAssignmentsByTarget) {
    if (byConst.size >= 2) {
      encoder.encodeAtMostK(Array.from(byConst.values()), 1);
    }
  }

  const sat = new CdclSatSolver();
  for (const clause of encoder.clauses) {
    if (!sat.addClause(clause)) {
      return { mutuallyExclusive: true };
    }
  }

  for (let iter = 0; iter < 64; iter++) {
    const satRes = sat.solve();
    if (satRes.status === "UNSAT") {
      return { mutuallyExclusive: true };
    }
    if (!satRes.model) {
      return { mutuallyExclusive: false, overlap: "non-numeric or complex condition" };
    }

    const activeTheoryConstraints: GuardConstraint[] = [];
    const activeTheoryLits: LitId[] = [];
    for (const [varId, pair] of theoryVarConstraints) {
      const val = satRes.model.get(varId);
      if (val === true) {
        activeTheoryConstraints.push(pair.pos);
        activeTheoryLits.push(varId);
      } else if (val === false) {
        activeTheoryConstraints.push(pair.neg);
        activeTheoryLits.push(-varId);
      }
    }

    if (activeTheoryConstraints.length > 0) {
      const tRes = checkConjunctPairMutuallyExclusive(activeTheoryConstraints, []);
      if (tRes.mutuallyExclusive) {
        if (!sat.addClause(activeTheoryLits.map((l) => -l))) {
          return { mutuallyExclusive: true };
        }
        continue;
      }
      const boolParts: string[] = [];
      for (const [varId, labels] of displayLabels) {
        if (theoryVarConstraints.has(varId)) continue;
        const val = satRes.model.get(varId);
        if (val === true) boolParts.push(labels.posLabel);
        else if (val === false) boolParts.push(labels.negLabel);
      }
      if (tRes.overlap) boolParts.push(tRes.overlap);
      return {
        mutuallyExclusive: false,
        overlap: boolParts.join(", ") || "overlap",
      };
    }

    const witnessParts: string[] = [];
    for (const [varId, labels] of displayLabels) {
      const val = satRes.model.get(varId);
      if (val === true) witnessParts.push(labels.posLabel);
      else if (val === false) witnessParts.push(labels.negLabel);
    }
    return {
      mutuallyExclusive: false,
      overlap: witnessParts.length > 0 ? witnessParts.join(", ") : "non-numeric or complex condition",
    };
  }

  return { mutuallyExclusive: false, overlap: "non-numeric or complex condition" };
}

/**
 * Checks whether two guard conditions are mutually exclusive or can overlap.
 * Supports simple conjunctive guards, DNF guards with disjunctions, boolean logic
 * with negation (`CdclSatSolver`), enum/identifier equality atoms, and nonlinear real constraints.
 */
export function checkGuardsMutuallyExclusive(
  guardA: string,
  guardB: string,
): { mutuallyExclusive: boolean; overlap?: string | undefined } {
  // Fast-path for purely numeric/nonlinear DNF guards
  const dnfA = parseGuardDNF(guardA);
  const dnfB = parseGuardDNF(guardB);

  if (isPureNumericGuardText(guardA, dnfA) && isPureNumericGuardText(guardB, dnfB)) {
    for (const conjA of dnfA) {
      for (const conjB of dnfB) {
        const res = checkConjunctPairMutuallyExclusive(conjA, conjB);
        if (!res.mutuallyExclusive) {
          return {
            mutuallyExclusive: false,
            overlap: res.overlap,
          };
        }
      }
    }
    return { mutuallyExclusive: true };
  }

  return checkGuardsMutuallyExclusiveSat(guardA, guardB);
}

/**
 * Checks whether a set of guards on a single variable collectively cover all values (-∞, ∞).
 */
export function checkSingleVarExhaustive(
  variable: string,
  constraintsList: GuardConstraint[][],
): { exhaustive: boolean; unhandledRange?: string | undefined } {
  // Collect intervals [lo, hi] permitted by each transition
  interface IntervalItem {
    lo: number;
    hi: number;
  }
  const intervals: IntervalItem[] = [];

  for (const cList of constraintsList) {
    let lo = -Infinity;
    let hi = Infinity;
    for (const c of cList) {
      if (c.variable !== variable) continue;
      if (c.operator === ">=" || c.operator === ">") {
        lo = Math.max(lo, c.value);
      } else if (c.operator === "<=" || c.operator === "<") {
        hi = Math.min(hi, c.value);
      } else if (c.operator === "==") {
        lo = Math.max(lo, c.value);
        hi = Math.min(hi, c.value);
      }
    }
    if (lo <= hi) {
      intervals.push({ lo, hi });
    }
  }

  if (intervals.length === 0) {
    if (constraintsList.length > 0) {
      return { exhaustive: false, unhandledRange: `${variable} ∈ (-∞, ∞)` };
    }
    return { exhaustive: true };
  }

  // Sort intervals by lower bound
  intervals.sort((a, b) => a.lo - b.lo);

  // Sweep-line coverage check from -∞ to +∞ across sorted guard intervals
  let currentCoverage = -Infinity;
  for (const interval of intervals) {
    if (interval.lo > currentCoverage) {
      // Gap detected!
      const loStr = currentCoverage === -Infinity ? "-∞" : currentCoverage.toString();
      const hiStr = interval.lo === Infinity ? "∞" : interval.lo.toString();
      return {
        exhaustive: false,
        unhandledRange: `${variable} ∈ (${loStr}, ${hiStr})`,
      };
    }
    currentCoverage = Math.max(currentCoverage, interval.hi);
  }

  if (currentCoverage < Infinity) {
    return {
      exhaustive: false,
      unhandledRange: `${variable} ∈ (${currentCoverage}, ∞)`,
    };
  }

  return { exhaustive: true };
}

/**
 * Descriptor for a state machine transition extracted from the symbol table or CST.
 */
export interface TransitionDescriptor {
  /** Unique symbol ID or synthetic identifier for the transition. */
  id: string | number;
  /** Transition usage name (or synthesized fallback name). */
  name: string;
  /** Name of the source state from which this transition originates. */
  source: string;
  /** Optional name of the destination target state. */
  target?: string | undefined;
  /** Optional trigger event specification (`accept <trigger>`). */
  trigger?: string | undefined;
  /** Optional symbol ID of the enclosing state machine (`StateDefinition` or composite `StateUsage`). */
  stateMachineId?: number | undefined;
  /** Optional guard expression string (`if <guardText>`) governing transition firing. */
  guardText?: string | undefined;
  /** Optional raw CST source slice for the transition declaration. */
  cstText?: string | undefined;
}

function normalizeTriggerKey(trigger: string | undefined): string {
  if (!trigger) return "";
  const collapsed = collapseWhitespace(trigger.trim());
  if (!collapsed) return "";
  // Normalize `accept payloadName : EventType` to `EventType` so differently-named payload bindings on the same event match
  const leaves = collectCstLeaves(parseSysmlSource(collapsed));
  if (leaves.length >= 3 && leaves[1]?.text === ":") {
    const first = leaves[0]?.text;
    const typeChain = readDottedChainFromLeaves(leaves, 2);
    if (first && isIdentifier(first) && typeChain && typeChain.nextIdx === leaves.length) {
      return typeChain.text;
    }
  }
  return collapsed;
}

function verifyTransitionsInternal(
  stateName: string,
  transitions: TransitionDescriptor[],
  minCompletionTransitionsForExhaustiveness: number,
): StateDeterminismResult {
  const diagnostics: StateDeterminismDiagnostic[] = [];
  let isDeterministic = true;
  let isComplete = true;

  // 1. Pairwise mutual exclusion check (Nondeterminism) grouped by normalized trigger
  const byTrigger = new Map<string, TransitionDescriptor[]>();
  for (const t of transitions) {
    const trigKey = normalizeTriggerKey(t.trigger);
    let group = byTrigger.get(trigKey);
    if (!group) {
      group = [];
      byTrigger.set(trigKey, group);
    }
    group.push(t);
  }

  for (const [, group] of byTrigger) {
    const guarded = group.filter((t) => t.guardText && t.guardText.trim().length > 0);
    for (let i = 0; i < guarded.length; i++) {
      for (let j = i + 1; j < guarded.length; j++) {
        const t1 = guarded[i]!;
        const t2 = guarded[j]!;
        const check = checkGuardsMutuallyExclusive(t1.guardText!, t2.guardText!);

        if (!check.mutuallyExclusive) {
          isDeterministic = false;
          diagnostics.push({
            type: "nondeterminism",
            stateName,
            transitionA: t1.name,
            transitionB: t2.name,
            guardA: t1.guardText,
            guardB: t2.guardText,
            message: `Non-deterministic transitions from state '${stateName}': guards '${t1.guardText}' and '${t2.guardText}' can both be satisfied simultaneously under input condition [${check.overlap || "overlap"}].`,
          });
        }
      }
    }
  }

  // 2. Completeness check (Deadlock freedom) on untriggered completion transitions
  const completionTransitions = transitions.filter((t) => normalizeTriggerKey(t.trigger) === "");
  if (completionTransitions.length >= minCompletionTransitionsForExhaustiveness) {
    const hasUnguarded = completionTransitions.some((t) => !t.guardText || t.guardText.trim().length === 0);
    const guardedCompletion = completionTransitions.filter((t) => t.guardText && t.guardText.trim().length > 0);
    if (!hasUnguarded && guardedCompletion.length >= minCompletionTransitionsForExhaustiveness) {
      const parsedGuards = guardedCompletion.map((t) => parseGuardConstraints(t.guardText!));
      const vars = new Set<string>();
      for (const clist of parsedGuards) {
        for (const c of clist) vars.add(c.variable);
      }

      for (const v of vars) {
        const exhaust = checkSingleVarExhaustive(v, parsedGuards);
        if (!exhaust.exhaustive) {
          isComplete = false;
          diagnostics.push({
            type: "deadlock",
            stateName,
            message: `Potential deadlock in state '${stateName}': transition guards do not cover all possible values of '${v}' (unhandled range: ${exhaust.unhandledRange}).`,
            unhandledRange: exhaust.unhandledRange,
          });
        }
      }
    }
  }

  return {
    isDeterministic,
    isComplete,
    diagnostics,
  };
}

/**
 * Verifies all transitions leaving a specified state for determinism and completeness.
 */
export function verifyStateTransitions(stateName: string, transitions: TransitionDescriptor[]): StateDeterminismResult {
  return verifyTransitionsInternal(stateName, transitions, 1);
}

const TRANSITION_CLAUSE_KEYWORDS = new Set(["accept", "if", "do", "then", "via"]);

function extractTransitionFromCst(
  db: QueryDB,
  trans: SymbolEntry,
  siblingStateNames: ReadonlySet<string>,
  enclosingStateMachineId: number,
  implicitParentStateName?: string,
): TransitionDescriptor | null {
  const rawText = db.cstText(trans.startOffset, trans.endOffset, trans) || "";
  const allLeaves: CstLeaf[] = rawText ? collectCstLeaves(parseSysmlSource(rawText)) : [];

  // Restrict to header leaves before `{` or `;` at top level
  const headerLeaves: CstLeaf[] = [];
  let delimDepth = 0;
  for (const lf of allLeaves) {
    if (lf.text === "(" || lf.text === "[") delimDepth++;
    else if (lf.text === ")" || lf.text === "]") delimDepth = Math.max(0, delimDepth - 1);
    else if (delimDepth === 0 && (lf.text === "{" || lf.text === ";")) break;
    headerLeaves.push(lf);
  }

  let source = "";
  let trigger: string | undefined;
  let guardText: string | undefined;
  let target: string | undefined;

  let idx = 0;
  if (
    headerLeaves[idx]?.text === "public" ||
    headerLeaves[idx]?.text === "private" ||
    headerLeaves[idx]?.text === "protected"
  ) {
    idx++;
  }

  if (headerLeaves[idx]?.text === "transition" || headerLeaves[idx]?.text === "succession") {
    idx++;
    if (headerLeaves[idx]?.text === "first") {
      const src = readDottedChainFromLeaves(headerLeaves, idx + 1);
      if (src) {
        source = src.text;
        idx = src.nextIdx;
      }
    } else if (idx < headerLeaves.length && !TRANSITION_CLAUSE_KEYWORDS.has(headerLeaves[idx]!.text)) {
      const c1 = readDottedChainFromLeaves(headerLeaves, idx);
      if (c1) {
        const afterC1 = headerLeaves[c1.nextIdx]?.text;
        if (afterC1 === "first") {
          const src = readDottedChainFromLeaves(headerLeaves, c1.nextIdx + 1);
          if (src) {
            source = src.text;
            idx = src.nextIdx;
          } else {
            idx = c1.nextIdx + 1;
          }
        } else if (afterC1 && TRANSITION_CLAUSE_KEYWORDS.has(afterC1)) {
          const rootSeg = c1.text.split(".")[0]!;
          if (
            c1.text.includes(".") ||
            siblingStateNames.has(c1.text) ||
            siblingStateNames.has(rootSeg) ||
            !implicitParentStateName
          ) {
            source = c1.text;
          } else {
            source = implicitParentStateName;
          }
          idx = c1.nextIdx;
        }
      }
    }
  } else if (headerLeaves[idx]?.text === "first") {
    const src = readDottedChainFromLeaves(headerLeaves, idx + 1);
    if (src) {
      source = src.text;
      idx = src.nextIdx;
    }
  } else if (idx < headerLeaves.length && !TRANSITION_CLAUSE_KEYWORDS.has(headerLeaves[idx]!.text)) {
    const src = readDottedChainFromLeaves(headerLeaves, idx);
    if (src && headerLeaves[src.nextIdx]?.text === "then") {
      source = src.text;
      idx = src.nextIdx;
    }
  }

  // Scan top-level `accept`, `if`, and `then` clauses across headerLeaves
  let depth = 0;
  for (let i = idx; i < headerLeaves.length; i++) {
    const tok = headerLeaves[i]!.text;
    if (tok === "(" || tok === "[") {
      depth++;
      continue;
    }
    if (tok === ")" || tok === "]") {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth > 0) continue;

    if (tok === "accept" && trigger === undefined) {
      let endIdx = headerLeaves.length;
      let innerDepth = 0;
      for (let j = i + 1; j < headerLeaves.length; j++) {
        const jt = headerLeaves[j]!.text;
        if (jt === "(" || jt === "[") innerDepth++;
        else if (jt === ")" || jt === "]") innerDepth = Math.max(0, innerDepth - 1);
        else if (innerDepth === 0 && (jt === "if" || jt === "do" || jt === "then")) {
          endIdx = j;
          break;
        }
      }
      if (endIdx > i + 1) {
        const rawTrig =
          endIdx < headerLeaves.length
            ? sliceBetweenLeaves(rawText, headerLeaves[i]!, headerLeaves[endIdx]!)
            : rawText.slice(headerLeaves[i]!.end, headerLeaves[headerLeaves.length - 1]!.end).trim();
        if (rawTrig) trigger = collapseWhitespace(rawTrig);
      }
    } else if (tok === "if" && guardText === undefined) {
      let endIdx = headerLeaves.length;
      let innerDepth = 0;
      for (let j = i + 1; j < headerLeaves.length; j++) {
        const jt = headerLeaves[j]!.text;
        if (jt === "(" || jt === "[") innerDepth++;
        else if (jt === ")" || jt === "]") innerDepth = Math.max(0, innerDepth - 1);
        else if (innerDepth === 0 && (jt === "do" || jt === "then")) {
          endIdx = j;
          break;
        }
      }
      if (endIdx > i + 1) {
        const rawGuard =
          endIdx < headerLeaves.length
            ? sliceBetweenLeaves(rawText, headerLeaves[i]!, headerLeaves[endIdx]!)
            : rawText.slice(headerLeaves[i]!.end, headerLeaves[headerLeaves.length - 1]!.end).trim();
        if (rawGuard) guardText = rawGuard;
      }
    } else if (tok === "then" && target === undefined) {
      const tgt = readDottedChainFromLeaves(headerLeaves, i + 1);
      if (tgt) target = tgt.text;
    }
  }

  // Metadata fallbacks when CST slice is unavailable (e.g. unit-test mock DBs)
  if (!source && typeof trans.metadata?.["source"] === "string") {
    source = trans.metadata["source"].trim();
  }
  if (!source && implicitParentStateName) {
    source = implicitParentStateName;
  }
  if (trigger === undefined && typeof trans.metadata?.["trigger"] === "string" && trans.metadata["trigger"].trim()) {
    trigger = collapseWhitespace(trans.metadata["trigger"].trim());
  }
  if (guardText === undefined && typeof trans.metadata?.["guard"] === "string" && trans.metadata["guard"].trim()) {
    guardText = trans.metadata["guard"].trim();
  }
  if (target === undefined && typeof trans.metadata?.["target"] === "string" && trans.metadata["target"].trim()) {
    target = trans.metadata["target"].trim();
  }

  if (!source) return null;

  return {
    id: trans.id,
    name: trans.name && trans.name !== "<anonymous>" ? trans.name : `transition_${trans.id}`,
    source,
    target,
    trigger,
    stateMachineId: enclosingStateMachineId,
    guardText,
    cstText: rawText || undefined,
  };
}

function isStateEntry(e: SymbolEntry): boolean {
  return (
    (e.ruleName === "StateDefinition" || e.ruleName === "StateUsage" || e.ruleName === "ExhibitStateUsage") &&
    Boolean(e.name)
  );
}

function matchesScopeFilter(db: QueryDB, state: SymbolEntry, filter: string): boolean {
  if (state.name === filter) return true;
  if (filter.includes("::")) {
    const segments: string[] = [state.name];
    let cur = state.parentId;
    while (cur !== null) {
      const p = db.symbol(cur);
      if (!p) break;
      if (p.name) segments.unshift(p.name);
      cur = p.parentId;
    }
    const fqn = segments.join("::");
    if (fqn === filter || fqn.endsWith(`::${filter}`)) return true;
  }
  let curParentId = state.parentId;
  while (curParentId !== null) {
    const parentSym = db.symbol(curParentId);
    if (!parentSym) break;
    if (parentSym.name === filter) return true;
    curParentId = parentSym.parentId;
  }
  return false;
}

function verifyMachineContainer(
  db: QueryDB,
  containerId: number,
  children: readonly SymbolEntry[],
  getChildren: (id: number) => readonly SymbolEntry[],
  onlyStateId: number | undefined,
  stringFilter: string | undefined,
  outDiagnostics: StateDeterminismDiagnostic[],
): { isDeterministic: boolean; isComplete: boolean } {
  let isDeterministic = true;
  let isComplete = true;

  const childStates = children.filter(isStateEntry);
  if (childStates.length === 0) {
    return { isDeterministic, isComplete };
  }

  const siblingStateNames = new Set<string>(childStates.map((s) => s.name));
  const descriptorsBySource = new Map<string, TransitionDescriptor[]>();

  const pushDesc = (desc: TransitionDescriptor | null) => {
    if (!desc) return;
    let list = descriptorsBySource.get(desc.source);
    if (!list) {
      list = [];
      descriptorsBySource.set(desc.source, list);
    }
    list.push(desc);
  };

  // 1. Direct TransitionUsage children of the enclosing state machine container
  for (const c of children) {
    if (c.ruleName === "TransitionUsage") {
      pushDesc(extractTransitionFromCst(db, c, siblingStateNames, containerId));
    }
  }

  // 2. Source-less outgoing TransitionUsages nested directly inside a leaf child state (`state S { transition accept E then T; }`)
  for (const st of childStates) {
    const grandChildren = getChildren(st.id);
    const hasSubStates = grandChildren.some(isStateEntry);
    if (!hasSubStates) {
      for (const gc of grandChildren) {
        if (gc.ruleName === "TransitionUsage") {
          pushDesc(extractTransitionFromCst(db, gc, siblingStateNames, containerId, st.name));
        }
      }
    }
  }

  for (const state of childStates) {
    if (onlyStateId !== undefined && state.id !== onlyStateId) continue;
    if (stringFilter && !matchesScopeFilter(db, state, stringFilter)) continue;

    // Collect transitions matching `state.name` (or dotted sub-reference starting with `state.name.`)
    const outgoing = descriptorsBySource.get(state.name) ?? [];
    if (outgoing.length >= 1) {
      // Only check guard exhaustiveness when a state has >= 2 untriggered completion transitions
      const res = verifyTransitionsInternal(state.name, outgoing, 2);
      if (!res.isDeterministic) isDeterministic = false;
      if (!res.isComplete) isComplete = false;
      outDiagnostics.push(...res.diagnostics);
    }
  }

  return { isDeterministic, isComplete };
}

/**
 * Analyzes a QueryDB (or specific state machine / state symbol ID or scope name) to verify
 * state machine transitions for determinism and completeness.
 */
export function verifyAllStateMachineTransitions(
  db: QueryDB,
  stateOrMachineFilter?: string | number,
): StateDeterminismResult {
  const allDiagnostics: StateDeterminismDiagnostic[] = [];
  let overallDeterministic = true;
  let overallComplete = true;

  // Fast O(children) path when a numeric symbol ID is supplied (no db.allEntries() scan)
  if (typeof stateOrMachineFilter === "number") {
    const targetSym = db.symbol(stateOrMachineFilter);
    if (!targetSym) {
      return { isDeterministic: true, isComplete: true, diagnostics: [] };
    }

    const directChildren = db.childrenOf(targetSym.id);
    const hasSubStates = directChildren.some(isStateEntry);
    const hasDirectTransitions = directChildren.some((c) => c.ruleName === "TransitionUsage");

    // Leaf StateUsage with transitions declared on its parent state machine
    if (!hasSubStates && isStateEntry(targetSym) && targetSym.parentId !== null) {
      const parentChildren = db.childrenOf(targetSym.parentId);
      const res = verifyMachineContainer(
        db,
        targetSym.parentId,
        parentChildren,
        (id) => (id === targetSym.id ? directChildren : db.childrenOf(id)),
        targetSym.id,
        undefined,
        allDiagnostics,
      );
      return {
        isDeterministic: res.isDeterministic,
        isComplete: res.isComplete,
        diagnostics: allDiagnostics,
      };
    }

    // Walk container subtree using db.childrenOf in O(subtree)
    const visitedContainers = new Set<number>();
    const visitSubtree = (symId: number, symChildren: readonly SymbolEntry[]) => {
      if (visitedContainers.has(symId)) return;
      visitedContainers.add(symId);

      if (symChildren.some(isStateEntry) || symChildren.some((c) => c.ruleName === "TransitionUsage")) {
        const res = verifyMachineContainer(
          db,
          symId,
          symChildren,
          (id) => db.childrenOf(id),
          undefined,
          undefined,
          allDiagnostics,
        );
        if (!res.isDeterministic) overallDeterministic = false;
        if (!res.isComplete) overallComplete = false;
      }

      for (const ch of symChildren) {
        if (
          ch.kind === "Definition" ||
          ch.kind === "Package" ||
          ch.ruleName === "StateUsage" ||
          ch.ruleName === "ExhibitStateUsage" ||
          ch.ruleName === "PartUsage"
        ) {
          const grand = db.childrenOf(ch.id);
          if (grand.length > 0) visitSubtree(ch.id, grand);
        }
      }
    };

    if (hasSubStates || hasDirectTransitions || targetSym.kind === "Package" || targetSym.kind === "Definition") {
      visitSubtree(targetSym.id, directChildren);
    }

    return {
      isDeterministic: overallDeterministic,
      isComplete: overallComplete,
      diagnostics: allDiagnostics,
    };
  }

  // String or omitted filter: group strictly per enclosing state machine container (parentId)
  const allEntries = db.allEntries();
  const childrenByParent = new Map<number | null, SymbolEntry[]>();
  for (const entry of allEntries) {
    let list = childrenByParent.get(entry.parentId);
    if (!list) {
      list = [];
      childrenByParent.set(entry.parentId, list);
    }
    list.push(entry);
  }

  for (const [parentId, children] of childrenByParent) {
    if (parentId === null) continue;
    if (!children.some(isStateEntry)) continue;

    const res = verifyMachineContainer(
      db,
      parentId,
      children,
      (id) => childrenByParent.get(id) ?? [],
      undefined,
      stateOrMachineFilter,
      allDiagnostics,
    );
    if (!res.isDeterministic) overallDeterministic = false;
    if (!res.isComplete) overallComplete = false;
  }

  // Also check top-level states with parentId === null if any exist
  const rootChildren = childrenByParent.get(null);
  if (rootChildren && rootChildren.some(isStateEntry)) {
    const res = verifyMachineContainer(
      db,
      -1,
      rootChildren,
      (id) => childrenByParent.get(id) ?? [],
      undefined,
      stateOrMachineFilter,
      allDiagnostics,
    );
    if (!res.isDeterministic) overallDeterministic = false;
    if (!res.isComplete) overallComplete = false;
  }

  return {
    isDeterministic: overallDeterministic,
    isComplete: overallComplete,
    diagnostics: allDiagnostics,
  };
}

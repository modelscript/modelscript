// SPDX-License-Identifier: AGPL-3.0-or-later

import { DpllTSolver, Interval, type ExprNode, type NonlinearConstraint, type QueryDB } from "@modelscript/runtime";
import { findFirstDescendant } from "./flattener/cst-lowerer.js";
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
      extractVariables(node.left, out);
      extractVariables(node.right, out);
      break;
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
function cstToExprNode(node: any): ExprNode | undefined {
  if (!node) return undefined;
  while (
    node &&
    (node.type === "OwnedExpression" ||
      node.type === "SequenceExpression" ||
      node.type === "ResultExpressionMember" ||
      node.type === "_Expression" ||
      node.type === "_BaseExpression")
  ) {
    const inner =
      node.childForFieldName?.("ownedRelatedElement") ||
      (node.childCount > 0 ? (node.child ? node.child(0) : node.children[0]) : null);
    if (inner && inner !== node) {
      node = inner;
    } else {
      break;
    }
  }

  // Parenthesized: ( expr )
  if (node.childCount >= 3) {
    const first = node.child ? node.child(0) : node.children[0];
    const last = node.child ? node.child(node.childCount - 1) : node.children[node.childCount - 1];
    if (first?.text === "(" && last?.text === ")") {
      const inner = node.child ? node.child(1) : node.children[1];
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
  if (node.childCount >= 3 && (node.child ? node.child(1)?.text === "(" : node.children[1]?.text === "(")) {
    const fnName = (node.child ? node.child(0)?.text : node.children[0]?.text)?.toLowerCase();
    const arg = cstToExprNode(node.child ? node.child(2) : node.children[2]);
    if (arg) {
      if (fnName === "sin") return { kind: "sin", child: arg };
      if (fnName === "cos") return { kind: "cos", child: arg };
      if (fnName === "sqrt") return { kind: "sqrt", child: arg };
      if (fnName === "sqr") return { kind: "sqr", child: arg };
    }
  }

  // Field-based AdditiveExpression or MultiplicativeExpression
  if (node.type === "AdditiveExpression" || node.type === "MultiplicativeExpression") {
    const operands: any[] = node.childrenForFieldName ? node.childrenForFieldName("operand") : [];
    const operators: string[] = node.childrenForFieldName
      ? node.childrenForFieldName("operator").map((c: any) => c.text?.trim() || "+")
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
  if (node.childCount >= 3) {
    const op = node.child ? node.child(1)?.text : node.children[1]?.text;
    const left = cstToExprNode(node.child ? node.child(0) : node.children[0]);
    const right = cstToExprNode(node.child ? node.child(2) : node.children[2]);
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
  if (node.childCount === 2) {
    const op = node.child ? node.child(0)?.text : node.children[0]?.text;
    const operand = cstToExprNode(node.child ? node.child(1) : node.children[1]);
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
      if (tree?.rootNode && !tree.rootNode.hasError?.()) {
        const retNode =
          findFirstDescendant(tree.rootNode, "ReturnStatement") ||
          findFirstDescendant(tree.rootNode, "ResultExpressionMember");
        if (retNode) {
          const exprChild =
            retNode.childCount > 1
              ? retNode.child
                ? retNode.child(1)
                : retNode.children[1]
              : retNode.child
                ? retNode.child(0)
                : retNode.children[0];
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

  const op = matchedOp;
  const lhsStr = token.substring(0, opIdx).trim();
  const rhsStr = token.substring(opIdx + matchedOp.length).trim();

  const lhsNode = parseArithmeticExpression(lhsStr);
  const rhsNode = parseArithmeticExpression(rhsStr);
  if (!lhsNode || !rhsNode) return undefined;

  let expr: ExprNode;
  let rhsVal: number;

  if (rhsNode.kind === "const") {
    expr = lhsNode;
    rhsVal = rhsNode.value;
  } else if (lhsNode.kind === "const") {
    expr = rhsNode;
    rhsVal = lhsNode.value;
  } else {
    expr = { kind: "sub", left: lhsNode, right: rhsNode };
    rhsVal = 0;
  }

  const varNames = new Set<string>();
  extractVariables(expr, varNames);
  const primaryVar = Array.from(varNames)[0] || "$nl";

  const rel: "<=" | ">=" | "==" = op === "<=" || op === "<" ? "<=" : op === ">=" || op === ">" ? ">=" : "==";

  return {
    variable: primaryVar,
    operator: op,
    value: rhsVal,
    nonlinear: {
      expr,
      rel,
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
    cleaned = cleaned.substring(1, cleaned.length - 1).trim();
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
        let invertedOp: GuardConstraint["operator"];
        switch (matchedOp) {
          case "<":
            invertedOp = ">";
            break;
          case "<=":
            invertedOp = ">=";
            break;
          case ">":
            invertedOp = "<";
            break;
          case ">=":
            invertedOp = "<=";
            break;
          default:
            invertedOp = matchedOp;
        }
        constraints.push({
          variable: rhs,
          operator: invertedOp,
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

/**
 * Checks a single pair of conjunctive constraints for mutual exclusion using the Octagon DBM.
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

    let litId = 1;
    for (const c of allConstraints) {
      let nl: NonlinearConstraint;
      if (c.nonlinear) {
        nl = c.nonlinear;
      } else {
        const rel =
          c.operator === "<=" || c.operator === "<" ? "<=" : c.operator === ">=" || c.operator === ">" ? ">=" : "==";
        nl = {
          expr: { kind: "var", name: c.variable },
          rel,
          rhs: c.value,
        };
      }
      extractVariables(nl.expr, allVarNames);
      theoryLiterals.set(litId, nl);
      clauses.push([litId]); // Conjunction: all constraints must hold
      litId++;
    }

    const initialBox = new Map<string, Interval>();
    for (const vName of allVarNames) {
      initialBox.set(vName, new Interval(-1000, 1000));
    }

    // Direct bounds propagation from linear atomic constraints
    for (const c of allConstraints) {
      if (!c.nonlinear && initialBox.has(c.variable)) {
        const cur = initialBox.get(c.variable)!;
        if (c.operator === ">=" || c.operator === ">") {
          initialBox.set(c.variable, new Interval(Math.max(cur.lo, c.value), cur.hi));
        } else if (c.operator === "<=" || c.operator === "<") {
          initialBox.set(c.variable, new Interval(cur.lo, Math.min(cur.hi, c.value)));
        } else if (c.operator === "==") {
          initialBox.set(c.variable, new Interval(c.value, c.value));
        }
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
  interface RealBound {
    lower: number;
    lowerStrict: boolean;
    upper: number;
    upperStrict: boolean;
    notEquals: Set<number>;
  }

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
    switch (c.operator) {
      case "<=":
        if (c.value < b.upper) {
          b.upper = c.value;
          b.upperStrict = false;
        }
        break;
      case "<":
        if (c.value < b.upper || (c.value === b.upper && !b.upperStrict)) {
          b.upper = c.value;
          b.upperStrict = true;
        }
        break;
      case ">=":
        if (c.value > b.lower) {
          b.lower = c.value;
          b.lowerStrict = false;
        }
        break;
      case ">":
        if (c.value > b.lower || (c.value === b.lower && !b.lowerStrict)) {
          b.lower = c.value;
          b.lowerStrict = true;
        }
        break;
      case "==":
        if (c.value > b.lower) {
          b.lower = c.value;
          b.lowerStrict = false;
        }
        if (c.value < b.upper) {
          b.upper = c.value;
          b.upperStrict = false;
        }
        break;
      case "!=":
        b.notEquals.add(c.value);
        break;
    }

    // Empty intersection check: lower > upper, degenerate open interval (x < c && x > c), or point excluded by `!=`
    if (
      b.lower > b.upper ||
      (b.lower === b.upper && (b.lowerStrict || b.upperStrict)) ||
      (b.lower === b.upper && b.notEquals.has(b.lower))
    ) {
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

/**
 * Checks whether two guard conditions are mutually exclusive or can overlap.
 * Supports both simple conjunctive guards and DNF guards with disjunctions.
 * Uses an Octagon DBM to determine feasibility of guardA && guardB.
 */
export function checkGuardsMutuallyExclusive(
  guardA: string,
  guardB: string,
): { mutuallyExclusive: boolean; overlap?: string | undefined } {
  // Try DNF parsing first (handles both simple and disjunctive guards)
  const dnfA = parseGuardDNF(guardA);
  const dnfB = parseGuardDNF(guardB);

  // If either guard cannot be parsed, fall back
  if (dnfA.length === 0 || dnfB.length === 0) {
    return { mutuallyExclusive: false, overlap: "non-numeric or complex condition" };
  }

  // Two DNF guards overlap iff ∃ a clause from A and a clause from B
  // whose conjunction is satisfiable in the Octagon DBM
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
  /** Optional guard expression string (`if <guardText>`) governing transition firing. */
  guardText?: string | undefined;
  /** Optional raw CST source slice for the transition declaration. */
  cstText?: string | undefined;
}

/**
 * Verifies all transitions leaving a specified state for determinism and completeness.
 */
export function verifyStateTransitions(stateName: string, transitions: TransitionDescriptor[]): StateDeterminismResult {
  const diagnostics: StateDeterminismDiagnostic[] = [];
  let isDeterministic = true;
  let isComplete = true;

  const guarded = transitions.filter((t) => t.guardText && t.guardText.trim().length > 0);

  // 1. Pairwise mutual exclusion check (Nondeterminism)
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

  // 2. Completeness check (Deadlock freedom)
  // If there is an unguarded transition, the state has a default fallback (always complete)
  const hasUnguarded = transitions.some((t) => !t.guardText || t.guardText.trim().length === 0);
  if (!hasUnguarded && guarded.length > 0) {
    const parsedGuards = guarded.map((t) => parseGuardConstraints(t.guardText!));
    // Find variables involved in guards
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

  return {
    isDeterministic,
    isComplete,
    diagnostics,
  };
}

/**
 * Analyzes an entire QueryDB to find and verify all state definitions and their transitions.
 */
export function verifyAllStateMachineTransitions(db: QueryDB, scopeFilter?: string): StateDeterminismResult {
  const allEntries = db.allEntries();
  const allDiagnostics: StateDeterminismDiagnostic[] = [];
  let overallDeterministic = true;
  let overallComplete = true;

  // Find all state symbols
  const stateEntries = allEntries.filter(
    (e) => (e.ruleName === "StateDefinition" || e.ruleName === "StateUsage") && e.name,
  );

  // Group transitions by source state
  const transitionEntries = allEntries.filter((e) => e.ruleName === "TransitionUsage");

  for (const state of stateEntries) {
    if (scopeFilter) {
      let inScope = state.name === scopeFilter || state.name.includes(scopeFilter);
      if (!inScope) {
        let curParentId = state.parentId;
        while (curParentId !== null) {
          const parentSym = db.symbol(curParentId);
          if (!parentSym) break;
          if (parentSym.name === scopeFilter) {
            inScope = true;
            break;
          }
          curParentId = parentSym.parentId;
        }
      }
      if (!inScope) {
        continue;
      }
    }

    const stateName = state.name;
    // Transitions whose source matches this state
    const outgoing: TransitionDescriptor[] = [];

    for (const t of transitionEntries) {
      const metaSource = t.metadata?.["source"];
      let matches = metaSource === stateName;

      // Also check CST text if metadata isn't fully resolved
      if (!matches) {
        const text = db.cstText(t.startOffset, t.endOffset, t);
        if (text && (text.includes(`first ${stateName}`) || text.includes(`transition ${stateName}`))) {
          matches = true;
        }
      }

      if (matches) {
        let guardText = t.metadata?.["guard"];
        if (!guardText) {
          // Extract "if <guard>" from CST
          const cstText = db.cstText(t.startOffset, t.endOffset, t);
          if (cstText) {
            const ifIdx = cstText.indexOf("if ");
            if (ifIdx !== -1) {
              const afterIf = cstText.substring(ifIdx + 3).trim();
              let endIdx = afterIf.length;
              for (const term of [";", "{", " do", " then"]) {
                const ti = afterIf.indexOf(term);
                if (ti !== -1 && ti < endIdx) {
                  endIdx = ti;
                }
              }
              guardText = afterIf.substring(0, endIdx).trim();
            }
          }
        }

        outgoing.push({
          id: t.id,
          name: t.name || `transition_${t.id}`,
          source: stateName,
          target: typeof t.metadata?.["target"] === "string" ? t.metadata["target"] : undefined,
          guardText: typeof guardText === "string" ? guardText : undefined,
        });
      }
    }

    if (outgoing.length >= 1) {
      const res = verifyStateTransitions(stateName, outgoing);
      if (!res.isDeterministic) overallDeterministic = false;
      if (!res.isComplete) overallComplete = false;
      allDiagnostics.push(...res.diagnostics);
    }
  }

  return {
    isDeterministic: overallDeterministic,
    isComplete: overallComplete,
    diagnostics: allDiagnostics,
  };
}

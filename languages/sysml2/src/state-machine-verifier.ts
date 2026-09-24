import { DpllTSolver, Interval, type ExprNode, type NonlinearConstraint, type QueryDB } from "@modelscript/runtime";
import { SmtOctagonDBM } from "./smt-bridge.js";

/**
 * Diagnostic emitted when a state machine transition hazard is identified.
 */
export interface StateDeterminismDiagnostic {
  type: "nondeterminism" | "deadlock";
  stateName: string;
  transitionA?: string;
  transitionB?: string;
  guardA?: string;
  guardB?: string;
  message: string;
  unhandledRange?: string;
}

/**
 * Full result of state machine determinism and completeness verification.
 */
export interface StateDeterminismResult {
  isDeterministic: boolean;
  isComplete: boolean;
  diagnostics: StateDeterminismDiagnostic[];
}

/**
 * Normalized representation of a single comparison constraint.
 */
export interface GuardConstraint {
  variable: string;
  operator: "<=" | "<" | ">=" | ">" | "==" | "!=";
  value: number;
  nonlinear?: NonlinearConstraint;
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

/**
 * Parses an arithmetic expression supporting +, -, *, /, ^2, sin, cos, sqrt.
 */
function parseArithmeticExpression(str: string): ExprNode | undefined {
  const tokens: string[] = [];
  const regex = /\s*([a-zA-Z_][a-zA-Z0-9_.]*|\d+(?:\.\d+)?|\+|-|\*|\/|\^|\(|\))\s*/g;
  let match: RegExpExecArray | null;
  let lastIndex = 0;
  while ((match = regex.exec(str)) !== null) {
    if (match.index !== lastIndex) {
      return undefined;
    }
    tokens.push(match[1]!);
    lastIndex = regex.lastIndex;
  }
  if (lastIndex !== str.length && str.substring(lastIndex).trim().length > 0) {
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

    if (/^\d+(?:\.\d+)?$/.test(t)) {
      consume();
      return { kind: "const", value: parseFloat(t) };
    }

    // Function call: sin(x), cos(x), sqrt(x), sqr(x)
    if (tokens[pos + 1] === "(") {
      const fn = consume();
      consume(); // '('
      const arg = parseExpr();
      if (!arg || consume() !== ")") return undefined;
      const lower = fn.toLowerCase();
      if (lower === "sin") return { kind: "sin", child: arg };
      if (lower === "cos") return { kind: "cos", child: arg };
      if (lower === "sqrt") return { kind: "sqrt", child: arg };
      if (lower === "sqr") return { kind: "sqr", child: arg };
      return undefined;
    }

    // Variable identifier
    if (/^[a-zA-Z_][a-zA-Z0-9_.]*$/.test(t)) {
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
  const opMatch = token.match(/(<=|>=|==|!=|<|>)/);
  if (!opMatch || opMatch.index === undefined) return undefined;

  const op = opMatch[1] as GuardConstraint["operator"];
  const lhsStr = token.substring(0, opMatch.index).trim();
  const rhsStr = token.substring(opMatch.index + op.length).trim();

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

  // Split on "&&" or "and"
  const tokens = cleaned.split(/&&|\band\b/i);

  for (const token of tokens) {
    const trimmed = token.trim();
    if (!trimmed) continue;

    // Pattern: variable op value e.g. "fuelLevel > 0", "x <= 15.5", "v == 100"
    const match = trimmed.match(/^([a-zA-Z_][a-zA-Z0-9_.]*)\s*(<=|>=|==|!=|<|>)\s*(-?[0-9]+(?:\.[0-9]+)?)$/);
    if (match) {
      constraints.push({
        variable: match[1],
        operator: match[2] as GuardConstraint["operator"],
        value: parseFloat(match[3]),
      });
      continue;
    }

    // Pattern: value op variable e.g. "0 < fuelLevel", "10 >= x"
    const revMatch = trimmed.match(/^(-?[0-9]+(?:\.[0-9]+)?)\s*(<=|>=|==|!=|<|>)\s*([a-zA-Z_][a-zA-Z0-9_.]*)$/);
    if (revMatch) {
      const val = parseFloat(revMatch[1]);
      const op = revMatch[2];
      const variable = revMatch[3];
      let invertedOp: GuardConstraint["operator"];
      switch (op) {
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
          invertedOp = op as GuardConstraint["operator"];
      }
      constraints.push({
        variable,
        operator: invertedOp,
        value: val,
      });
      continue;
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
): { mutuallyExclusive: boolean; overlap?: string } {
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

  const varMap = new Map<string, number>();
  let nextId = 0;
  for (const c of allConstraints) {
    if (!varMap.has(c.variable)) {
      varMap.set(c.variable, nextId++);
    }
  }

  const numVars = Math.max(nextId, 1);
  const dbm = new SmtOctagonDBM(numVars);

  for (const c of allConstraints) {
    const v = varMap.get(c.variable)!;
    const curLo = dbm.getLowerBound(v);
    const curHi = dbm.getUpperBound(v);

    switch (c.operator) {
      case "<=":
        dbm.assumeInterval(v, curLo, Math.floor(c.value));
        break;
      case "<":
        dbm.assumeInterval(v, curLo, Math.floor(c.value - 1e-6));
        break;
      case ">=":
        dbm.assumeInterval(v, Math.ceil(c.value), curHi);
        break;
      case ">":
        dbm.assumeInterval(v, Math.ceil(c.value + 1e-6), curHi);
        break;
      case "==":
        dbm.assumeInterval(v, Math.round(c.value), Math.round(c.value));
        break;
      case "!=":
        // In DBM, != is non-convex; skip or treat conservatively
        break;
    }
    if (dbm.hasNegativeCycle() || dbm.getLowerBound(v) > dbm.getUpperBound(v)) {
      return { mutuallyExclusive: true };
    }
  }

  for (const [name, id] of varMap) {
    const lo = dbm.getLowerBound(id);
    const hi = dbm.getUpperBound(id);
    if (lo > hi) {
      return { mutuallyExclusive: true };
    }
  }

  // Construct overlapping witness interval
  const parts: string[] = [];
  for (const [name, id] of varMap) {
    const lo = dbm.getLowerBound(id);
    const hi = dbm.getUpperBound(id);
    const loStr = lo <= -100000 ? "-∞" : lo.toString();
    const hiStr = hi >= 100000 ? "∞" : hi.toString();
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
): { mutuallyExclusive: boolean; overlap?: string } {
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
): { exhaustive: boolean; unhandledRange?: string } {
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

  if (intervals.length === 0) return { exhaustive: true };

  // Sort intervals by lower bound
  intervals.sort((a, b) => a.lo - b.lo);

  // Check coverage
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

export interface TransitionDescriptor {
  id: string | number;
  name: string;
  source: string;
  target?: string;
  guardText?: string;
  cstText?: string;
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
    if (scopeFilter && state.name !== scopeFilter && !state.name.includes(scopeFilter)) {
      continue;
    }

    const stateName = state.name;
    // Transitions whose source matches this state
    const outgoing: TransitionDescriptor[] = [];

    for (const t of transitionEntries) {
      const metaSource = t.metadata?.source;
      let matches = metaSource === stateName;

      // Also check CST text if metadata isn't fully resolved
      if (!matches) {
        const text = db.cstText(t.startByte, t.endByte, t);
        if (text && (text.includes(`first ${stateName}`) || text.includes(`transition ${stateName}`))) {
          matches = true;
        }
      }

      if (matches) {
        let guardText = t.metadata?.guard;
        if (!guardText) {
          // Extract "if <guard>" from CST
          const cstText = db.cstText(t.startByte, t.endByte, t);
          if (cstText) {
            const ifMatch = cstText.match(/\bif\s+([^{;do]+?)(?:\s+do|\s+then|[;{]|$)/);
            if (ifMatch) guardText = ifMatch[1].trim();
          }
        }

        outgoing.push({
          id: t.id,
          name: t.name || `transition_${t.id}`,
          source: stateName,
          target: typeof t.metadata?.target === "string" ? t.metadata.target : undefined,
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

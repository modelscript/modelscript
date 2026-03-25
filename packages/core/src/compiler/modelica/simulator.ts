// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  ExpressionEvaluator,
  ModelicaBinaryExpression,
  ModelicaBooleanVariable,
  type ModelicaDAE,
  ModelicaDAEVisitor,
  ModelicaEnumerationVariable,
  type ModelicaEquation,
  type ModelicaExpression,
  ModelicaFunctionCallEquation,
  ModelicaFunctionCallExpression,
  ModelicaIfElseExpression,
  ModelicaIfEquation,
  ModelicaIntegerLiteral,
  ModelicaIntegerVariable,
  ModelicaNameExpression,
  ModelicaRealLiteral,
  ModelicaRealVariable,
  ModelicaSimpleEquation,
  ModelicaUnaryExpression,
  ModelicaVariable,
  ModelicaWhenEquation,
  pantelidesIndexReduction,
} from "./dae.js";
import { DualExpressionEvaluator } from "./dual-evaluator.js";
import { Dual } from "./dual.js";
import { ReverseExpressionEvaluator } from "./reverse-evaluator.js";
import { ModelicaBinaryOperator, ModelicaUnaryOperator, ModelicaVariability } from "./syntax.js";
import { Tape, type TapeNode } from "./tape.js";

/** Describes a single action inside a when-clause body. */
interface WhenAction {
  type: "reinit" | "assign";
  /** Variable name to reinitialize or assign. */
  target: string;
  /** Right-hand side expression to evaluate when the clause fires. */
  expr: ModelicaExpression;
}

/**
 * Zero-crossing direction: the sign change that triggers the event.
 * - `negative`: fires when g goes from positive → negative (e.g. `h < 0`)
 * - `positive`: fires when g goes from negative → positive (e.g. `x > 0`)
 * - `either`: fires on any sign change
 */
type ZeroCrossingDirection = "negative" | "positive" | "either";

/** An execution block for algebraic evaluation. Can be a single assignment or a non-linear system loop. */
export type ExecutionBlock =
  | { type: "single"; eq: { target: string; expr: ModelicaExpression; isDerivative: boolean } }
  | { type: "system"; vars: string[]; eqs: { target: string; expr: ModelicaExpression; isDerivative: boolean }[] };

/** A when-clause ready for evaluation during simulation. */
interface WhenClause {
  /** Condition expression (evaluated as boolean: nonzero = true). */
  condition: ModelicaExpression;
  /** Actions to execute when the condition fires (rising edge). */
  actions: WhenAction[];
  /** Tracks whether the condition was active at the previous time step. */
  wasActive: boolean;
  /**
   * If the condition is a relational comparison (e.g. `h < 0`), this evaluates
   * the continuous zero-crossing function `g(t,y)` whose sign change triggers
   * the event.  For `h < 0`, g = LHS - RHS = h - 0 = h.
   * Returns null when the condition cannot be decomposed into a zero-crossing.
   */
  zeroCrossingFn: ((evaluator: ExpressionEvaluator) => number | null) | null;
  /** Which direction of sign change triggers this event. */
  zeroCrossingDirection: ZeroCrossingDirection;
  /** Previous value of the zero-crossing function. */
  gPrev: number;
}

/** Maximum events processed per integration step to prevent chattering loops. */
const MAX_EVENTS_PER_STEP = 10;
/** Bisection tolerance for locating zero-crossing time. */
const BISECT_TOL = 1e-10;
/** Maximum bisection iterations. */
const BISECT_MAX_ITER = 50;

// ── SDIRK2 implicit solver constants ──
/** SDIRK2 parameter: γ = 1 - √2/2 ≈ 0.2929 (L-stable, order 2). */
const SDIRK_GAMMA = 1 - Math.SQRT2 / 2;
/** Maximum Newton iterations per implicit stage solve. */
const NEWTON_MAX_ITER = 8;
/** Newton convergence tolerance (relative to step size). */
const NEWTON_TOL = 1e-10;
/** Stiffness probe: max relative RK4-vs-SDIRK2 difference that triggers implicit solver. */
const STIFFNESS_PROBE_THRESHOLD = 10;

// ── Dense LU decomposition with partial pivoting ──

/** LU factorization result for a dense n×n matrix with row equilibration. */
export interface LUFactorization {
  /** LU-combined matrix (lower triangle is L with unit diagonal, upper is U). */
  lu: Float64Array[];
  /** Pivot permutation indices. */
  piv: Int32Array;
  /** Row scaling factors (1/max|row|) applied before factorization. */
  rowScale: Float64Array;
  /** Matrix dimension. */
  n: number;
}

/** Factor a dense n×n matrix (given as array of Float64Array rows) into PA = LU
 *  with row equilibration for numerical stability. */
export function luFactor(A: Float64Array[], n: number): LUFactorization {
  // Copy matrix
  const lu = A.map((row) => new Float64Array(row));
  const piv = new Int32Array(n);
  for (let i = 0; i < n; i++) piv[i] = i;

  // Row equilibration: scale each row by 1/max|entry|
  const rowScale = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const row = lu[i];
    if (!row) continue;
    let maxVal = 0;
    for (let j = 0; j < n; j++) {
      maxVal = Math.max(maxVal, Math.abs(row[j] ?? 0));
    }
    const s = maxVal > 1e-30 ? 1.0 / maxVal : 1.0;
    rowScale[i] = s;
    for (let j = 0; j < n; j++) {
      row[j] = (row[j] ?? 0) * s;
    }
  }

  for (let k = 0; k < n; k++) {
    const luK = lu[k];
    if (!luK) continue;
    // Find pivot
    let maxVal = Math.abs(luK[k] ?? 0);
    let maxIdx = k;
    for (let i = k + 1; i < n; i++) {
      const luI = lu[i];
      if (!luI) continue;
      const val = Math.abs(luI[k] ?? 0);
      if (val > maxVal) {
        maxVal = val;
        maxIdx = i;
      }
    }
    // Swap rows
    if (maxIdx !== k) {
      const rowK = lu[k];
      const rowMax = lu[maxIdx];
      if (rowK && rowMax) {
        lu[k] = rowMax;
        lu[maxIdx] = rowK;
      }
      const tmpP = piv[k] ?? k;
      piv[k] = piv[maxIdx] ?? maxIdx;
      piv[maxIdx] = tmpP;
      // Also swap rowScale entries
      const tmpS = rowScale[k] ?? 1;
      rowScale[k] = rowScale[maxIdx] ?? 1;
      rowScale[maxIdx] = tmpS;
    }
    const luKSwapped = lu[k];
    if (!luKSwapped) continue;
    const diagVal = luKSwapped[k] ?? 0;
    if (Math.abs(diagVal) < 1e-30) continue; // Near-singular — skip
    // Eliminate below
    for (let i = k + 1; i < n; i++) {
      const luI = lu[i];
      if (!luI) continue;
      const factor = (luI[k] ?? 0) / diagVal;
      luI[k] = factor; // Store L
      for (let j = k + 1; j < n; j++) {
        luI[j] = (luI[j] ?? 0) - factor * (luKSwapped[j] ?? 0);
      }
    }
  }
  return { lu, piv, rowScale, n };
}

/** Solve LU·x = b (in-place, overwrites b with x).
 *  Accounts for row equilibration applied during factorization. */
export function luSolve(fact: LUFactorization, b: Float64Array): void {
  const { lu, piv, rowScale, n } = fact;
  // Apply permutation, then row scaling to RHS
  // After pivoting, rowScale[i] = original scale for the row now at position i
  const pb = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const pi = piv[i] ?? i;
    pb[i] = (b[pi] ?? 0) * (rowScale[i] ?? 1);
  }
  // Forward substitution (L·z = pb)
  for (let i = 1; i < n; i++) {
    const luI = lu[i];
    if (!luI) continue;
    for (let j = 0; j < i; j++) {
      pb[i] = (pb[i] ?? 0) - (luI[j] ?? 0) * (pb[j] ?? 0);
    }
  }
  // Back substitution (U·x = z)
  for (let i = n - 1; i >= 0; i--) {
    const luI = lu[i];
    if (!luI) continue;
    for (let j = i + 1; j < n; j++) {
      pb[i] = (pb[i] ?? 0) - (luI[j] ?? 0) * (pb[j] ?? 0);
    }
    const diag = luI[i] ?? 0;
    pb[i] = Math.abs(diag) > 1e-30 ? (pb[i] ?? 0) / diag : 0;
  }
  // Copy result back
  for (let i = 0; i < n; i++) b[i] = pb[i] ?? 0;
}

function extractDerName(expr: unknown): string | null {
  if (expr && typeof expr === "object" && "functionName" in expr && "args" in expr) {
    const funcExpr = expr as { functionName: string; args: unknown[] };
    if (funcExpr.functionName === "der" && funcExpr.args.length === 1) {
      const arg0 = funcExpr.args[0];
      if (arg0 && typeof arg0 === "object" && "name" in arg0) {
        const nameVal = (arg0 as { name: unknown }).name;
        if (typeof nameVal === "string") return nameVal;
      }
    }
  }

  if (expr && typeof expr === "object" && "name" in expr) {
    const nameVal = (expr as { name: unknown }).name;
    if (typeof nameVal === "string" && nameVal.startsWith("der(") && nameVal.endsWith(")")) {
      return nameVal.substring(4, nameVal.length - 1);
    }
  }

  return null;
}

// Extract variables used in an expression
class DependencyVisitor extends ModelicaDAEVisitor<Set<string>> {
  override visitNameExpression(expr: ModelicaNameExpression, deps?: Set<string>): void {
    if (deps) {
      deps.add(expr.name);
    }
  }
  override visitRealVariable(node: ModelicaRealVariable, deps?: Set<string>): void {
    if (deps) deps.add(node.name);
  }
  override visitIntegerVariable(node: ModelicaIntegerVariable, deps?: Set<string>): void {
    if (deps) deps.add(node.name);
  }
}

/** Extract a variable name from a DAE expression. */
function extractVarName(expr: ModelicaExpression): string | null {
  if (expr instanceof ModelicaVariable) return expr.name;
  if (expr instanceof ModelicaNameExpression) return expr.name;
  return null;
}

/**
 * Build a zero-crossing function from a relational condition expression.
 *
 * For `LHS < RHS`  or `LHS <= RHS`:  g = LHS - RHS, direction = negative
 * For `LHS > RHS`  or `LHS >= RHS`:  g = LHS - RHS, direction = positive
 *
 * Returns null if the condition is not a simple relational expression.
 */
function buildZeroCrossing(condition: ModelicaExpression): {
  fn: (evaluator: ExpressionEvaluator) => number | null;
  direction: ZeroCrossingDirection;
} | null {
  if (!(condition instanceof ModelicaBinaryExpression)) return null;

  const op = condition.operator;
  let direction: ZeroCrossingDirection;

  switch (op) {
    case ModelicaBinaryOperator.LESS_THAN:
    case ModelicaBinaryOperator.LESS_THAN_OR_EQUAL:
      direction = "negative";
      break;
    case ModelicaBinaryOperator.GREATER_THAN:
    case ModelicaBinaryOperator.GREATER_THAN_OR_EQUAL:
      direction = "positive";
      break;
    default:
      return null; // Not a relational operator we can bisect on
  }

  const lhs = condition.operand1;
  const rhs = condition.operand2;

  const fn = (evaluator: ExpressionEvaluator): number | null => {
    const lVal = evaluator.evaluate(lhs);
    const rVal = evaluator.evaluate(rhs);
    if (lVal === null || rVal === null) return null;
    return lVal - rVal; // g = LHS - RHS
  };

  return { fn, direction };
}

/** Check if an expression is a zero literal (0 or 0.0). */
function isZeroLiteral(expr: ModelicaExpression): boolean {
  if (expr instanceof ModelicaRealLiteral) return expr.value === 0;
  if (expr instanceof ModelicaIntegerLiteral) return expr.value === 0;
  return false;
}

/**
 * Find `der(x)` inside a multiplication expression and return the state
 * variable name and the coefficient expression.
 *
 * Handles patterns like:
 *   `coeff * der(x)`  →  { varName: x, coeff: coeff }
 *   `der(x) * coeff`  →  { varName: x, coeff: coeff }
 *
 * Returns null if der() is not found in a simple multiplicative position.
 */
function findDerInMultiplication(expr: ModelicaExpression): { varName: string; coeff: ModelicaExpression } | null {
  if (!(expr instanceof ModelicaBinaryExpression)) return null;
  if (
    expr.operator !== ModelicaBinaryOperator.MULTIPLICATION &&
    expr.operator !== ModelicaBinaryOperator.ELEMENTWISE_MULTIPLICATION
  )
    return null;

  // Check operand1 for der()
  const lhsDer = extractDerName(expr.operand1);
  if (lhsDer) return { varName: lhsDer, coeff: expr.operand2 };

  // Check operand2 for der()
  const rhsDer = extractDerName(expr.operand2);
  if (rhsDer) return { varName: rhsDer, coeff: expr.operand1 };

  return null;
}

/**
 * Given a sum expression (a + b) or (a + b + c + ...) represented as a nested
 * binary addition tree, find a "solvable" variable and return it with a negated
 * expression for the remaining terms.
 *
 * @param expr  The sum expression
 * @param skip  Set of variable names to skip (already defined)
 *
 * This handles multi-connector flow balance equations:
 *   `0 = a.n.f + b.p.f + c.p.f + d.p.f`
 * If a.n.f is already defined (in skip), it finds b.p.f instead:
 *   `b.p.f = -(a.n.f + c.p.f + d.p.f)`
 */
function tryExtractSolvableVar(
  expr: ModelicaExpression,
  skip?: Set<string>,
): { target: string; rhs: ModelicaExpression } | null {
  // Simple case: expr is just a name — `0 = x` → `x = 0`
  const directName = extractVarName(expr);
  if (directName && (!skip || !skip.has(directName))) {
    return { target: directName, rhs: new ModelicaRealLiteral(0) };
  }

  // Flatten nested additions into a list of terms
  const terms: ModelicaExpression[] = [];
  const flattenAdd = (e: ModelicaExpression) => {
    if (
      e instanceof ModelicaBinaryExpression &&
      (e.operator === ModelicaBinaryOperator.ADDITION || e.operator === ModelicaBinaryOperator.ELEMENTWISE_ADDITION)
    ) {
      flattenAdd(e.operand1);
      flattenAdd(e.operand2);
    } else {
      terms.push(e);
    }
  };
  flattenAdd(expr);

  // Helper: build the "rest" expression from all terms except index i,
  // then solve for the variable at index i.
  const buildResult = (
    i: number,
    name: string,
    negated: boolean,
  ): { target: string; rhs: ModelicaExpression } | null => {
    const rest = terms.filter((_, idx) => idx !== i);
    if (rest.length === 0) {
      return { target: name, rhs: new ModelicaRealLiteral(0) };
    }
    let restExpr: ModelicaExpression | undefined = rest[0];
    if (!restExpr) return null;
    for (let j = 1; j < rest.length; j++) {
      const nextTerm = rest[j];
      if (!nextTerm) continue;
      restExpr = new ModelicaBinaryExpression(ModelicaBinaryOperator.ADDITION, restExpr, nextTerm);
    }
    if (negated) {
      // -(target) + rest = 0 → target = rest
      return { target: name, rhs: restExpr };
    }
    return {
      target: name,
      rhs: new ModelicaUnaryExpression(ModelicaUnaryOperator.UNARY_MINUS, restExpr),
    };
  };

  // Pass 1: direct (non-negated) variables — preferred
  for (let i = 0; i < terms.length; i++) {
    const term = terms[i];
    if (!term) continue;
    const name = extractVarName(term);
    if (name && (!skip || !skip.has(name))) {
      return buildResult(i, name, false);
    }
  }

  // Pass 2: negated variables — fallback for flow-substituted balance equation terms
  for (let i = 0; i < terms.length; i++) {
    const term = terms[i];
    if (!term) continue;
    if (term instanceof ModelicaUnaryExpression && term.operator === ModelicaUnaryOperator.UNARY_MINUS) {
      const name = extractVarName(term.operand);
      if (name && (!skip || !skip.has(name))) {
        return buildResult(i, name, true);
      }
    }
  }

  return null;
}

/** Rich metadata about a single parameter variable for the UI. */
export interface ParameterInfo {
  name: string;
  type: "real" | "integer" | "boolean" | "enumeration";
  defaultValue: number;
  min?: number;
  max?: number;
  step: number;
  unit?: string;
  enumLiterals?: { ordinal: number; label: string }[];
}

export class ModelicaSimulator {
  dae: ModelicaDAE;
  stateVars = new Set<string>();
  algebraicVars = new Set<string>();
  /** Parameter/constant values extracted from dae.variables. */
  private parameters = new Map<string, number>();
  private executionBlocks: ExecutionBlock[] = [];
  /** When-clauses extracted from the DAE. */
  whenClauses: WhenClause[] = [];
  /** Whether to use the implicit SDIRK2 solver instead of RK4 (set after divergence detection). */
  private useImplicitSolver = false;
  /** Cached LU factorization of (I - γ·h·J) for the implicit solver. */
  private cachedW: LUFactorization | null = null;
  /** Step size for which the cached W was computed. */
  private cachedWStepSize = 0;
  /** Warm start values for algebraic variables in the implicit solver. */
  private algWarmStart = new Map<string, number>();
  /** Alias map: non-canonical variable name → canonical name (e.g., C1.p.v → C1.v). */
  private aliasMap = new Map<string, string>();
  /** Negated alias map: variable → canonical name where variable = -canonical (e.g., C1.n.i = -C1.i). */
  private negatedAliasMap = new Map<string, string>();

  constructor(dae: ModelicaDAE) {
    this.dae = dae;
  }

  public prepare(): void {
    const assignments: { target: string; expr: ModelicaExpression; isDerivative: boolean }[] = [];
    const definedVars = new Set<string>();

    this.resolveParameters();

    // ── Alias elimination via union-find ──
    // Connection equations of the form `A = B` (where both sides are simple variable names)
    // create alias relationships. We build a union-find to canonicalize names, then
    // substitute canonical names in all other equations.
    const aliasParent = new Map<string, string>();

    function aliasFind(name: string): string {
      let root = name;
      let next = aliasParent.get(root);
      while (next !== undefined && next !== root) {
        root = next;
        next = aliasParent.get(root);
      }
      // Path compression
      let current = name;
      while (current !== root) {
        const parent = aliasParent.get(current) ?? current;
        aliasParent.set(current, root);
        current = parent;
      }
      return root;
    }

    function aliasUnion(a: string, b: string): void {
      const rootA = aliasFind(a);
      const rootB = aliasFind(b);
      if (rootA !== rootB) {
        // Prefer shorter names or state variables as canonical
        aliasParent.set(rootB, rootA);
      }
    }

    // ── Pre-process: flatten if-equations into conditional simple equations ──
    // An if-equation like:
    //   if cond then x = e1; elseif cond2 then x = e2; else x = e3; end if;
    // becomes:
    //   x = if cond then e1 elseif cond2 then e2 else e3;
    const flattenedEquations: ModelicaEquation[] = [];
    for (const eq of this.dae.equations) {
      if (eq instanceof ModelicaIfEquation) {
        const ifEqs = eq.equations.filter((e): e is ModelicaSimpleEquation => e instanceof ModelicaSimpleEquation);
        const elseEqs = eq.elseEquations.filter(
          (e): e is ModelicaSimpleEquation => e instanceof ModelicaSimpleEquation,
        );
        const elseIfBranches = eq.elseIfClauses.map((c) => ({
          condition: c.condition,
          equations: c.equations.filter((e): e is ModelicaSimpleEquation => e instanceof ModelicaSimpleEquation),
        }));

        // Pair equations by position across branches
        const maxLen = Math.max(ifEqs.length, elseEqs.length, ...elseIfBranches.map((b) => b.equations.length));
        for (let i = 0; i < maxLen; i++) {
          const ifEq = ifEqs[i];
          const elseEq = elseEqs[i];
          if (!ifEq) continue;

          // Build the LHS: use the if-branch's LHS
          const lhs = ifEq.expression1;
          // Build the conditional RHS
          const thenExpr = ifEq.expression2;
          const elseIfClauses = elseIfBranches.map((b) => ({
            condition: b.condition,
            expression: b.equations[i]?.expression2 ?? new ModelicaRealLiteral(0),
          }));
          const elseExpr = elseEq?.expression2 ?? new ModelicaRealLiteral(0);

          const conditionalRhs = new ModelicaIfElseExpression(eq.condition, thenExpr, elseIfClauses, elseExpr);
          flattenedEquations.push(new ModelicaSimpleEquation(lhs, conditionalRhs));
        }
      } else {
        flattenedEquations.push(eq);
      }
    }

    // First pass: identify alias equations (A = B) and build union-find.
    // Connection equations produce voltage equalities (e.g., L1.p.v = C2.p.v)
    // and flow identities (e.g., C1.i = C1.p.i). All simple A = B equations
    // are valid aliases — they represent the same physical quantity.
    const nonAliasEquations: ModelicaSimpleEquation[] = [];
    const negatedAliasPairs: [string, string][] = []; // [a, b] meaning a = -b
    for (const eq of flattenedEquations) {
      if (eq instanceof ModelicaWhenEquation || eq instanceof ModelicaFunctionCallEquation) {
        continue;
      }
      if (eq instanceof ModelicaSimpleEquation) {
        const lhsName = extractVarName(eq.expression1);
        const rhsName = extractVarName(eq.expression2);
        if (lhsName && rhsName) {
          // This is an alias equation: A = B
          aliasUnion(lhsName, rhsName);
        } else {
          // Check for negated alias: A + B = 0  or  0 = A + B  →  A = -B
          // These are collected for the simulation output (to show .n.i variables)
          // but the equation is still processed normally for matching.
          const sumExpr =
            eq.expression1 instanceof ModelicaBinaryExpression
              ? eq.expression1
              : eq.expression2 instanceof ModelicaBinaryExpression
                ? eq.expression2
                : null;
          const otherExpr = sumExpr === eq.expression1 ? eq.expression2 : eq.expression1;
          if (
            sumExpr &&
            (sumExpr.operator === ModelicaBinaryOperator.ADDITION ||
              sumExpr.operator === ModelicaBinaryOperator.ELEMENTWISE_ADDITION)
          ) {
            const op1Name = extractVarName(sumExpr.operand1);
            const op2Name = extractVarName(sumExpr.operand2);
            const otherZero =
              (otherExpr instanceof ModelicaRealLiteral && otherExpr.value === 0) ||
              (otherExpr instanceof ModelicaIntegerLiteral && otherExpr.value === 0);
            if (op1Name && op2Name && otherZero) {
              negatedAliasPairs.push([op1Name, op2Name]);
            }
          }
          nonAliasEquations.push(eq);
        }
      }
    }

    // Build the substitution map: for each aliased variable, map to its canonical name
    this.aliasMap = new Map<string, string>();
    for (const name of aliasParent.keys()) {
      const canonical = aliasFind(name);
      if (canonical !== name) {
        this.aliasMap.set(name, canonical);
      }
    }
    const aliasMap = this.aliasMap;

    // Build negated alias map from A + B = 0 pairs (flow balance equations).
    // After canonicalization, if one name is already canonical (state/algebraic),
    // the other is its negated alias.
    this.negatedAliasMap = new Map<string, string>();
    for (const [a, b] of negatedAliasPairs) {
      const ca = aliasMap.get(a) ?? a;
      const cb = aliasMap.get(b) ?? b;
      // Map both original names to each other's canonical
      if (ca !== cb) {
        this.negatedAliasMap.set(b, ca);
        this.negatedAliasMap.set(a, cb);
      }
    }

    // Helper: substitute aliased names in an expression
    const substituteAliases = (expr: ModelicaExpression): ModelicaExpression => {
      if (expr instanceof ModelicaNameExpression) {
        const canonical = aliasMap.get(expr.name);
        if (canonical) return new ModelicaNameExpression(canonical);
        return expr;
      }
      if (expr instanceof ModelicaRealVariable || expr instanceof ModelicaIntegerVariable) {
        const canonical = aliasMap.get(expr.name);
        if (canonical) return new ModelicaNameExpression(canonical);
        return expr;
      }
      if (expr instanceof ModelicaBinaryExpression) {
        const newOp1 = substituteAliases(expr.operand1);
        const newOp2 = substituteAliases(expr.operand2);
        if (newOp1 !== expr.operand1 || newOp2 !== expr.operand2) {
          return new ModelicaBinaryExpression(expr.operator, newOp1, newOp2);
        }
        return expr;
      }
      if (expr instanceof ModelicaUnaryExpression) {
        const newOp = substituteAliases(expr.operand);
        if (newOp !== expr.operand) {
          return new ModelicaUnaryExpression(expr.operator, newOp);
        }
        return expr;
      }
      if (expr instanceof ModelicaFunctionCallExpression) {
        const newArgs = expr.args.map((arg: ModelicaExpression) => substituteAliases(arg));
        const anyChanged = newArgs.some((arg: ModelicaExpression, idx: number) => arg !== expr.args[idx]);
        if (anyChanged) return new ModelicaFunctionCallExpression(expr.functionName, newArgs);
        return expr;
      }
      if (expr instanceof ModelicaIfElseExpression) {
        const newCond = substituteAliases(expr.condition);
        const newThen = substituteAliases(expr.thenExpression);
        const newElseIfs = expr.elseIfClauses.map((c) => ({
          condition: substituteAliases(c.condition),
          expression: substituteAliases(c.expression),
        }));
        const newElse = substituteAliases(expr.elseExpression);
        const anyChanged =
          newCond !== expr.condition ||
          newThen !== expr.thenExpression ||
          newElse !== expr.elseExpression ||
          newElseIfs.some(
            (c, i) =>
              c.condition !== expr.elseIfClauses[i]?.condition || c.expression !== expr.elseIfClauses[i]?.expression,
          );
        if (anyChanged) return new ModelicaIfElseExpression(newCond, newThen, newElseIfs, newElse);
        return expr;
      }
      // Literals, etc. — return as-is
      return expr;
    };

    // Canonicalize the target name via alias map
    const canonicalize = (name: string): string => aliasMap.get(name) ?? name;

    // Second pass: process non-alias equations with alias substitution

    // Alias-substitute all equations and split into derivative vs non-derivative
    const substitutedEquations: { lhs: ModelicaExpression; rhs: ModelicaExpression }[] = [];
    for (const eq of nonAliasEquations) {
      substitutedEquations.push({
        lhs: substituteAliases(eq.expression1),
        rhs: substituteAliases(eq.expression2),
      });
    }

    // ── Pass A: Identify ALL state variables from derivative equations ──
    // Process explicit `der(x) = expr` and implicit `coeff * der(x) = expr` first,
    // so that all state variables are known before processing algebraic equations.
    const algebraicEquations: { lhs: ModelicaExpression; rhs: ModelicaExpression }[] = [];

    for (const { lhs, rhs } of substitutedEquations) {
      // ── Case 1: der(x) appears directly as LHS or RHS ──
      const lhsDer = extractDerName(lhs);
      const rhsDer = extractDerName(rhs);

      if (lhsDer) {
        const target = canonicalize(lhsDer);
        assignments.push({ target, expr: rhs, isDerivative: true });
        this.stateVars.add(target);
        definedVars.add(`der(${target})`);
        definedVars.add(target); // state var is defined by ODE integration
        continue;
      }
      if (rhsDer) {
        const target = canonicalize(rhsDer);
        assignments.push({ target, expr: lhs, isDerivative: true });
        this.stateVars.add(target);
        definedVars.add(`der(${target})`);
        definedVars.add(target);
        continue;
      }

      // ── Case 2: Implicit derivative — coeff * der(x) on one side ──
      const lhsImplicit = findDerInMultiplication(lhs);
      const rhsImplicit = findDerInMultiplication(rhs);

      if (rhsImplicit) {
        const target = canonicalize(rhsImplicit.varName);
        const divExpr = new ModelicaBinaryExpression(ModelicaBinaryOperator.DIVISION, lhs, rhsImplicit.coeff);
        assignments.push({ target, expr: divExpr, isDerivative: true });
        this.stateVars.add(target);
        definedVars.add(`der(${target})`);
        definedVars.add(target);
        continue;
      }
      if (lhsImplicit) {
        const target = canonicalize(lhsImplicit.varName);
        const divExpr = new ModelicaBinaryExpression(ModelicaBinaryOperator.DIVISION, rhs, lhsImplicit.coeff);
        assignments.push({ target, expr: divExpr, isDerivative: true });
        this.stateVars.add(target);
        definedVars.add(`der(${target})`);
        definedVars.add(target);
        continue;
      }

      // Not a derivative equation — process in the algebraic pass
      algebraicEquations.push({ lhs, rhs });
    }

    // ── Connector flow variable elimination ──
    // The alias pass already handled `X.f = X.p.f` identities (merging X.p.f → X.f).
    // Remaining connector flow equations are internal flow balance: `0 = X.f + X.n.f`
    // (or equivalently `-(X.f + X.n.f) = 0`). These give us X.n.f = -(X.f).
    // Substitute into all other equations to eliminate connector flow variables.

    const pinSubstitutions = new Map<string, ModelicaExpression>();
    const consumedIndices = new Set<number>();

    // Find internal flow balance equations: 0 = a + b (sum of two connector flow vars)
    for (let idx = 0; idx < algebraicEquations.length; idx++) {
      const eq = algebraicEquations[idx];
      if (!eq) continue;

      // Detect 0 = a + b  or  -(a + b) = 0
      let body: ModelicaExpression | null = null;
      if (
        isZeroLiteral(eq.lhs) &&
        eq.rhs instanceof ModelicaBinaryExpression &&
        (eq.rhs.operator === ModelicaBinaryOperator.ADDITION ||
          eq.rhs.operator === ModelicaBinaryOperator.ELEMENTWISE_ADDITION)
      ) {
        body = eq.rhs;
      } else if (isZeroLiteral(eq.rhs)) {
        let b: ModelicaExpression = eq.lhs;
        if (b instanceof ModelicaUnaryExpression && b.operator === ModelicaUnaryOperator.UNARY_MINUS) {
          b = b.operand;
        }
        if (
          b instanceof ModelicaBinaryExpression &&
          (b.operator === ModelicaBinaryOperator.ADDITION || b.operator === ModelicaBinaryOperator.ELEMENTWISE_ADDITION)
        ) {
          body = b;
        }
      }

      if (!body || !(body instanceof ModelicaBinaryExpression)) continue;
      const aName = extractVarName(body.operand1);
      const bName = extractVarName(body.operand2);
      if (!aName || !bName) continue;

      // Check if this is an internal flow balance: X.f + X.n.f = 0
      // Pattern: one var is X.f, other is X.n.f or X.p.f (same base component)
      const aCanon = canonicalize(aName);
      const bCanon = canonicalize(bName);
      const aParts = aCanon.split(".");
      const bParts = bCanon.split(".");

      if (aParts.length >= 2 && bParts.length >= 3) {
        // a = X.f, b = X.n.f  (a is component flow, b is connector flow)
        const aBase = aParts.slice(0, -1).join(".");
        const bBase = bParts.slice(0, -2).join(".");
        const aLast = aParts[aParts.length - 1];
        const bPin = bParts[bParts.length - 2];
        const bLast = bParts[bParts.length - 1];
        if (aBase === bBase && aLast === bLast && (bPin === "p" || bPin === "n")) {
          // b = -(a): X.n.i = -(X.i)
          pinSubstitutions.set(bCanon, new ModelicaUnaryExpression(ModelicaUnaryOperator.UNARY_MINUS, body.operand1));
          consumedIndices.add(idx);
        }
      }
      if (bParts.length >= 2 && aParts.length >= 3) {
        // b = X.i, a = X.n.i
        const bBase = bParts.slice(0, -1).join(".");
        const aBase = aParts.slice(0, -2).join(".");
        const bLast = bParts[bParts.length - 1];
        const aPin = aParts[aParts.length - 2];
        const aLast = aParts[aParts.length - 1];
        if (aBase === bBase && aLast === bLast && (aPin === "p" || aPin === "n")) {
          // a = -(b): X.n.i = -(X.i)
          pinSubstitutions.set(aCanon, new ModelicaUnaryExpression(ModelicaUnaryOperator.UNARY_MINUS, body.operand2));
          consumedIndices.add(idx);
        }
      }
    }

    // Apply substitutions to all remaining equations
    if (pinSubstitutions.size > 0) {
      const substituteInExpr = (expr: ModelicaExpression): ModelicaExpression => {
        const varName = extractVarName(expr);
        if (varName) {
          const canon = canonicalize(varName);
          const sub = pinSubstitutions.get(canon);
          if (sub) return sub;
          return expr;
        }
        if (expr instanceof ModelicaBinaryExpression) {
          const newOp1 = substituteInExpr(expr.operand1);
          const newOp2 = substituteInExpr(expr.operand2);
          if (newOp1 !== expr.operand1 || newOp2 !== expr.operand2) {
            return new ModelicaBinaryExpression(expr.operator, newOp1, newOp2);
          }
          return expr;
        }
        if (expr instanceof ModelicaUnaryExpression) {
          const newOp = substituteInExpr(expr.operand);
          if (newOp !== expr.operand) {
            return new ModelicaUnaryExpression(expr.operator, newOp);
          }
          return expr;
        }
        if (expr instanceof ModelicaFunctionCallExpression) {
          const newArgs = expr.args.map((a) => substituteInExpr(a));
          const changed = newArgs.some((a, i) => a !== expr.args[i]);
          if (changed) {
            return new ModelicaFunctionCallExpression(expr.functionName, newArgs);
          }
          return expr;
        }
        if (expr instanceof ModelicaIfElseExpression) {
          const newCond = substituteInExpr(expr.condition);
          const newThen = substituteInExpr(expr.thenExpression);
          const newElseIfs = expr.elseIfClauses.map((c) => ({
            condition: substituteInExpr(c.condition),
            expression: substituteInExpr(c.expression),
          }));
          const newElse = substituteInExpr(expr.elseExpression);
          const anyChanged =
            newCond !== expr.condition ||
            newThen !== expr.thenExpression ||
            newElse !== expr.elseExpression ||
            newElseIfs.some(
              (c, i) =>
                c.condition !== expr.elseIfClauses[i]?.condition || c.expression !== expr.elseIfClauses[i]?.expression,
            );
          if (anyChanged) return new ModelicaIfElseExpression(newCond, newThen, newElseIfs, newElse);
          return expr;
        }
        return expr;
      };

      const filteredEquations: typeof algebraicEquations = [];
      for (let idx = 0; idx < algebraicEquations.length; idx++) {
        if (consumedIndices.has(idx)) continue;
        const eq = algebraicEquations[idx];
        if (!eq) continue;
        filteredEquations.push({
          lhs: substituteInExpr(eq.lhs),
          rhs: substituteInExpr(eq.rhs),
        });
      }
      algebraicEquations.length = 0;
      algebraicEquations.push(...filteredEquations);
    }

    // ── Pass B: Readiness-based iterative algebraic equation matching ──
    // Process algebraic equations iteratively until convergence.
    // An equation is "ready" when all its RHS variables are already defined.
    // This ensures proper causalization: V.v = f(time,...) gets assigned first,
    // then R1.p.v = V.v + V.n.v, then R1.v = R1.p.v - R1.n.v (KVL), then
    // R1.i = R1.v / R1.R_actual (reversed Ohm's law), etc.

    // Helper: collect all variable names referenced in an expression
    const collectExprVars = (expr: ModelicaExpression): Set<string> => {
      const vars = new Set<string>();
      const visitor = new DependencyVisitor();
      expr.accept(visitor, vars);
      return vars;
    };

    // Collect variables that appear as dependencies of derivative equations.
    // These variables are critical and should be prioritized when extracting
    // variables from flow balance sums, ensuring they get proper definitions.
    const derDeps = new Set<string>();
    for (const a of assignments) {
      if (a.isDerivative) {
        const vars = collectExprVars(a.expr);
        for (const v of vars) {
          const canon = canonicalize(v);
          if (!definedVars.has(canon) && !this.parameters.has(canon)) {
            derDeps.add(canon);
          }
        }
      }
    }

    // Helper: count undefined variables in an expression (using canonical names)
    const countUndefined = (expr: ModelicaExpression): number => {
      const vars = collectExprVars(expr);
      let count = 0;
      for (const v of vars) {
        const canon = canonicalize(v);
        if (!definedVars.has(canon) && !this.parameters.has(canon) && canon !== "time") {
          count++;
        }
      }
      return count;
    };

    let unmatchedEquations = [...algebraicEquations];
    let matchingChanged = true;
    while (matchingChanged) {
      matchingChanged = false;
      // Sort: subtraction-form (potential constraints) before multiplication-form.
      // This ensures potential constraints claim component variables before constitutive
      // equations, while readiness checking still lets source equations (all-param deps) win.
      unmatchedEquations.sort((a, b) => {
        const isSubRHS = (e: { rhs: ModelicaExpression }) =>
          e.rhs instanceof ModelicaBinaryExpression &&
          (e.rhs.operator === ModelicaBinaryOperator.SUBTRACTION ||
            e.rhs.operator === ModelicaBinaryOperator.ELEMENTWISE_SUBTRACTION);
        const aS = isSubRHS(a) ? 0 : 1;
        const bS = isSubRHS(b) ? 0 : 1;
        return aS - bS;
      });
      const nextUnmatched: { lhs: ModelicaExpression; rhs: ModelicaExpression }[] = [];

      for (const { lhs, rhs } of unmatchedEquations) {
        let matched = false;

        // ── Case 3: LHS is a variable name — simple algebraic assignment ──
        const lhsName = extractVarName(lhs);
        if (lhsName) {
          const target = canonicalize(lhsName);
          if (!definedVars.has(target)) {
            // Only assign when ALL RHS variables are already defined (readiness check)
            const undefinedCount = countUndefined(rhs);
            if (undefinedCount === 0) {
              assignments.push({ target, expr: rhs, isDerivative: false });
              this.algebraicVars.add(target);
              definedVars.add(target);
              matchingChanged = true;
              matched = true;
            }
            // If undefinedCount > 0, defer to next iteration (don't match yet)
          } else {
            // Target already defined — try to reverse the equation to define an RHS variable
            // Only reverse when exactly 1 RHS variable is undefined
            const rhsVarName = extractVarName(rhs);
            if (rhsVarName) {
              const rhsCanon = canonicalize(rhsVarName);
              if (!definedVars.has(rhsCanon)) {
                assignments.push({ target: rhsCanon, expr: lhs, isDerivative: false });
                this.algebraicVars.add(rhsCanon);
                definedVars.add(rhsCanon);
                matchingChanged = true;
                matched = true;
              }
            }

            if (!matched && rhs instanceof ModelicaBinaryExpression) {
              const op1Name = extractVarName(rhs.operand1);
              const op2Name = extractVarName(rhs.operand2);
              const op1Canon = op1Name ? canonicalize(op1Name) : null;
              const op2Canon = op2Name ? canonicalize(op2Name) : null;
              const op1Defined = !op1Canon || definedVars.has(op1Canon);
              const op2Defined = !op2Canon || definedVars.has(op2Canon);

              // Only reverse when exactly one operand is undefined
              if (op1Defined !== op2Defined) {
                if (
                  rhs.operator === ModelicaBinaryOperator.SUBTRACTION ||
                  rhs.operator === ModelicaBinaryOperator.ELEMENTWISE_SUBTRACTION
                ) {
                  if (!op1Defined && op1Canon) {
                    const expr = new ModelicaBinaryExpression(ModelicaBinaryOperator.ADDITION, lhs, rhs.operand2);
                    assignments.push({ target: op1Canon, expr, isDerivative: false });
                    this.algebraicVars.add(op1Canon);
                    definedVars.add(op1Canon);
                    matchingChanged = true;
                    matched = true;
                  } else if (!op2Defined && op2Canon) {
                    const expr = new ModelicaBinaryExpression(ModelicaBinaryOperator.SUBTRACTION, rhs.operand1, lhs);
                    assignments.push({ target: op2Canon, expr, isDerivative: false });
                    this.algebraicVars.add(op2Canon);
                    definedVars.add(op2Canon);
                    matchingChanged = true;
                    matched = true;
                  }
                } else if (
                  rhs.operator === ModelicaBinaryOperator.ADDITION ||
                  rhs.operator === ModelicaBinaryOperator.ELEMENTWISE_ADDITION
                ) {
                  if (!op1Defined && op1Canon) {
                    const expr = new ModelicaBinaryExpression(ModelicaBinaryOperator.SUBTRACTION, lhs, rhs.operand2);
                    assignments.push({ target: op1Canon, expr, isDerivative: false });
                    this.algebraicVars.add(op1Canon);
                    definedVars.add(op1Canon);
                    matchingChanged = true;
                    matched = true;
                  } else if (!op2Defined && op2Canon) {
                    const expr = new ModelicaBinaryExpression(ModelicaBinaryOperator.SUBTRACTION, lhs, rhs.operand1);
                    assignments.push({ target: op2Canon, expr, isDerivative: false });
                    this.algebraicVars.add(op2Canon);
                    definedVars.add(op2Canon);
                    matchingChanged = true;
                    matched = true;
                  }
                } else if (
                  rhs.operator === ModelicaBinaryOperator.MULTIPLICATION ||
                  rhs.operator === ModelicaBinaryOperator.ELEMENTWISE_MULTIPLICATION
                ) {
                  if (!op1Defined && op1Canon) {
                    const expr = new ModelicaBinaryExpression(ModelicaBinaryOperator.DIVISION, lhs, rhs.operand2);
                    assignments.push({ target: op1Canon, expr, isDerivative: false });
                    this.algebraicVars.add(op1Canon);
                    definedVars.add(op1Canon);
                    matchingChanged = true;
                    matched = true;
                  } else if (!op2Defined && op2Canon) {
                    const expr = new ModelicaBinaryExpression(ModelicaBinaryOperator.DIVISION, lhs, rhs.operand1);
                    assignments.push({ target: op2Canon, expr, isDerivative: false });
                    this.algebraicVars.add(op2Canon);
                    definedVars.add(op2Canon);
                    matchingChanged = true;
                    matched = true;
                  }
                }
              }
            }
          }
        }

        if (!matched && !lhsName) {
          // ── Case 4: LHS is zero — solve for ONE undetermined variable in RHS ──
          if (isZeroLiteral(lhs)) {
            const solved = tryExtractSolvableVar(rhs, definedVars);
            if (solved) {
              const target = canonicalize(solved.target);
              if (!definedVars.has(target)) {
                // Only match if all OTHER vars in the sum are defined
                const rhsUndefined = countUndefined(rhs);
                if (rhsUndefined <= 1) {
                  assignments.push({ target, expr: solved.rhs, isDerivative: false });
                  this.algebraicVars.add(target);
                  definedVars.add(target);
                  matchingChanged = true;
                  matched = true;
                }
              }
            }
          }

          // ── Case 5: RHS is zero — solve for ONE undetermined variable in LHS ──
          if (!matched && isZeroLiteral(rhs)) {
            let body = lhs;
            if (body instanceof ModelicaUnaryExpression && body.operator === ModelicaUnaryOperator.UNARY_MINUS) {
              body = body.operand;
            }
            const solved = tryExtractSolvableVar(body, definedVars);
            if (solved) {
              const target = canonicalize(solved.target);
              if (!definedVars.has(target)) {
                // Only match if all OTHER vars in the sum are defined
                const bodyUndefined = countUndefined(body);
                if (bodyUndefined <= 1) {
                  assignments.push({ target, expr: solved.rhs, isDerivative: false });
                  this.algebraicVars.add(target);
                  definedVars.add(target);
                  matchingChanged = true;
                  matched = true;
                }
              }
            }
          }
        }

        if (!matched) {
          nextUnmatched.push({ lhs, rhs });
        }
      }

      unmatchedEquations = nextUnmatched;
    }

    // ── Phase 2: Relaxed matching for remaining equations ──
    // After strict readiness converges, process remaining equations with relaxed
    // readiness (no dep check). This defines flow variables whose deps form
    // chains that strict readiness can't resolve. The topological sort ensures
    // correct evaluation order regardless.
    let relaxedChanged = true;
    while (relaxedChanged) {
      relaxedChanged = false;
      const stillUnmatched: { lhs: ModelicaExpression; rhs: ModelicaExpression }[] = [];

      // Sort by fewest undefined deps first. This ensures equations with
      // all-parameter deps (like R1.R_actual = R1.R * 1) are processed before
      // equations with variable deps (like R1.i = -(R1.n.i)), enabling Ohm's
      // law reversal (R1.i = R1.v / R1.R_actual) before R1.i gets claimed.
      unmatchedEquations.sort((a, b) => {
        const aUndefined = countUndefined(a.rhs) + countUndefined(a.lhs);
        const bUndefined = countUndefined(b.rhs) + countUndefined(b.lhs);
        return aUndefined - bUndefined;
      });

      for (const { lhs, rhs } of unmatchedEquations) {
        let matched = false;
        const lhsName = extractVarName(lhs);

        if (lhsName) {
          const target = canonicalize(lhsName);
          if (!definedVars.has(target)) {
            // Relaxed: assign even if RHS deps are undefined
            assignments.push({ target, expr: rhs, isDerivative: false });
            this.algebraicVars.add(target);
            definedVars.add(target);
            relaxedChanged = true;
            matched = true;
          } else {
            // Target already defined — try reversal (same as Phase 1)
            const rhsVarName = extractVarName(rhs);
            if (rhsVarName) {
              const rhsCanon = canonicalize(rhsVarName);
              if (!definedVars.has(rhsCanon)) {
                assignments.push({ target: rhsCanon, expr: lhs, isDerivative: false });
                this.algebraicVars.add(rhsCanon);
                definedVars.add(rhsCanon);
                relaxedChanged = true;
                matched = true;
              }
            }
            if (!matched && rhs instanceof ModelicaBinaryExpression) {
              const op1Name = extractVarName(rhs.operand1);
              const op2Name = extractVarName(rhs.operand2);
              const op1Canon = op1Name ? canonicalize(op1Name) : null;
              const op2Canon = op2Name ? canonicalize(op2Name) : null;

              if (
                rhs.operator === ModelicaBinaryOperator.SUBTRACTION ||
                rhs.operator === ModelicaBinaryOperator.ELEMENTWISE_SUBTRACTION
              ) {
                if (op1Canon && !definedVars.has(op1Canon)) {
                  const expr = new ModelicaBinaryExpression(ModelicaBinaryOperator.ADDITION, lhs, rhs.operand2);
                  assignments.push({ target: op1Canon, expr, isDerivative: false });
                  this.algebraicVars.add(op1Canon);
                  definedVars.add(op1Canon);
                  relaxedChanged = true;
                  matched = true;
                } else if (op2Canon && !definedVars.has(op2Canon)) {
                  const expr = new ModelicaBinaryExpression(ModelicaBinaryOperator.SUBTRACTION, rhs.operand1, lhs);
                  assignments.push({ target: op2Canon, expr, isDerivative: false });
                  this.algebraicVars.add(op2Canon);
                  definedVars.add(op2Canon);
                  relaxedChanged = true;
                  matched = true;
                }
              } else if (
                rhs.operator === ModelicaBinaryOperator.MULTIPLICATION ||
                rhs.operator === ModelicaBinaryOperator.ELEMENTWISE_MULTIPLICATION
              ) {
                // For multiplication reversal, require the OTHER operand to be defined
                // (division needs a defined divisor). Only reverse a*b=c to a=c/b when b is defined.
                const op1Defined = op1Canon ? definedVars.has(op1Canon) : true;
                const op2Defined = op2Canon ? definedVars.has(op2Canon) : true;
                if (op1Canon && !op1Defined && op2Defined) {
                  const expr = new ModelicaBinaryExpression(ModelicaBinaryOperator.DIVISION, lhs, rhs.operand2);
                  assignments.push({ target: op1Canon, expr, isDerivative: false });
                  this.algebraicVars.add(op1Canon);
                  definedVars.add(op1Canon);
                  relaxedChanged = true;
                  matched = true;
                } else if (op2Canon && !op2Defined && op1Defined) {
                  const expr = new ModelicaBinaryExpression(ModelicaBinaryOperator.DIVISION, lhs, rhs.operand1);
                  assignments.push({ target: op2Canon, expr, isDerivative: false });
                  this.algebraicVars.add(op2Canon);
                  definedVars.add(op2Canon);
                  relaxedChanged = true;
                  matched = true;
                }
              } else if (
                rhs.operator === ModelicaBinaryOperator.ADDITION ||
                rhs.operator === ModelicaBinaryOperator.ELEMENTWISE_ADDITION
              ) {
                if (op1Canon && !definedVars.has(op1Canon)) {
                  const expr = new ModelicaBinaryExpression(ModelicaBinaryOperator.SUBTRACTION, lhs, rhs.operand2);
                  assignments.push({ target: op1Canon, expr, isDerivative: false });
                  this.algebraicVars.add(op1Canon);
                  definedVars.add(op1Canon);
                  relaxedChanged = true;
                  matched = true;
                } else if (op2Canon && !definedVars.has(op2Canon)) {
                  const expr = new ModelicaBinaryExpression(ModelicaBinaryOperator.SUBTRACTION, lhs, rhs.operand1);
                  assignments.push({ target: op2Canon, expr, isDerivative: false });
                  this.algebraicVars.add(op2Canon);
                  definedVars.add(op2Canon);
                  relaxedChanged = true;
                  matched = true;
                }
              }
            }
          }
        }

        if (!matched && !lhsName) {
          // Cases 4 & 5: zero on one side — solve for first solvable var (relaxed)
          if (isZeroLiteral(lhs)) {
            const solved = tryExtractSolvableVar(rhs, definedVars);
            if (solved) {
              const target = canonicalize(solved.target);
              if (!definedVars.has(target)) {
                assignments.push({ target, expr: solved.rhs, isDerivative: false });
                this.algebraicVars.add(target);
                definedVars.add(target);
                relaxedChanged = true;
                matched = true;
              }
            }
          }
          if (!matched && isZeroLiteral(rhs)) {
            let body = lhs;
            if (body instanceof ModelicaUnaryExpression && body.operator === ModelicaUnaryOperator.UNARY_MINUS) {
              body = body.operand;
            }
            const solved = tryExtractSolvableVar(body, definedVars);
            if (solved) {
              const target = canonicalize(solved.target);
              if (!definedVars.has(target)) {
                assignments.push({ target, expr: solved.rhs, isDerivative: false });
                this.algebraicVars.add(target);
                definedVars.add(target);
                relaxedChanged = true;
                matched = true;
              }
            }
          }
        }

        if (!matched) {
          stillUnmatched.push({ lhs, rhs });
        }
      }

      unmatchedEquations = stillUnmatched;
    }

    // ── Phase 2.5: Fix undefined derivative dependencies ──
    // After all matching phases, some variables needed by derivative equations
    // (e.g. C2.i in der(C2.v) = C2.i / C2.C) may still be undefined because
    // the flow balance equation that contains them chose a different variable as its target.
    // For each missing derDeps variable, find a matched assignment whose expression
    // references it, and create a companion assignment solving for the missing var.
    for (const missing of derDeps) {
      if (definedVars.has(missing)) continue;

      // Find an assignment from a DIFFERENT flow balance equation than the one that
      // originally defined a variable in the same balance sum.
      // Heuristic: in balance sums after connector flow substitution, a variable
      // appears NON-NEGATED at its own node and NEGATED at other nodes.
      // To avoid tautological same-equation companions, prefer assignments
      // where `missing` appears NEGATED (i.e., from a different balance equation).
      const findNegatedInExpr = (expr: ModelicaExpression, name: string): boolean => {
        if (expr instanceof ModelicaUnaryExpression && expr.operator === ModelicaUnaryOperator.UNARY_MINUS) {
          const inner = extractVarName(expr.operand);
          if (inner === name) return true;
          // Also recurse into the operand
          return findNegatedInExpr(expr.operand, name);
        }
        if (expr instanceof ModelicaBinaryExpression) {
          return findNegatedInExpr(expr.operand1, name) || findNegatedInExpr(expr.operand2, name);
        }
        return false;
      };

      for (const a of assignments) {
        if (a.isDerivative) continue;
        const exprVars = collectExprVars(a.expr);
        const exprVarsCanonicalized = new Set<string>();
        for (const v of exprVars) exprVarsCanonicalized.add(canonicalize(v));
        if (!exprVarsCanonicalized.has(missing)) continue;

        // Only use assignments where `missing` appears NEGATED in the expression.
        // This indicates the variable came from a different flow balance node via
        // connector flow substitution (X.n.f → -(X.f)), avoiding same-equation tautology.
        if (!findNegatedInExpr(a.expr, missing)) continue;

        // Reconstruct the original equation as a sum for re-solving.
        let otherSide: ModelicaExpression;
        if (a.expr instanceof ModelicaUnaryExpression && a.expr.operator === ModelicaUnaryOperator.UNARY_MINUS) {
          otherSide = a.expr.operand;
        } else {
          otherSide = new ModelicaUnaryExpression(ModelicaUnaryOperator.UNARY_MINUS, a.expr);
        }
        const sum = new ModelicaBinaryExpression(
          ModelicaBinaryOperator.ADDITION,
          new ModelicaNameExpression(a.target),
          otherSide,
        );
        // Skip all defined vars except `missing`
        const skipForMissing = new Set(definedVars);
        skipForMissing.delete(missing);
        const solved = tryExtractSolvableVar(sum, skipForMissing);
        if (solved && canonicalize(solved.target) === missing) {
          assignments.push({ target: missing, expr: solved.rhs, isDerivative: false });
          this.algebraicVars.add(missing);
          definedVars.add(missing);
          break;
        }
      }
    }

    // ── Phase 2.7: Pantelides index reduction ──
    // Detect hidden algebraic constraints between state variables in unmatched
    // equations. For each constrained state, demote it to algebraic, differentiate
    // the constraint symbolically, and back-compute dependent variables.
    //
    // Before running Pantelides, perform transitive substitution of already-defined
    // algebraic variables into unmatched equations. This exposes hidden multi-state
    // constraints. For example, `C2.v = L1.p.v - L1.n.v` only has one state var
    // (C2.v) because L1.p.v and L1.n.v are algebraic. But after substituting
    // L1.p.v = C1.v + V.n.v and L1.n.v = C3.v + V.n.v, we get
    // C2.v = C1.v - C3.v, exposing a 3-state constraint.
    const algSubstMap = new Map<string, ModelicaExpression>();
    for (const a of assignments) {
      if (!a.isDerivative && !this.stateVars.has(a.target)) {
        algSubstMap.set(a.target, a.expr);
      }
    }

    const substituteAlgebraic = (expr: ModelicaExpression, depth: number): ModelicaExpression => {
      if (depth > 10) return expr; // guard against circular substitution
      if (
        expr instanceof ModelicaNameExpression ||
        expr instanceof ModelicaRealVariable ||
        expr instanceof ModelicaIntegerVariable
      ) {
        const name = expr instanceof ModelicaNameExpression ? expr.name : (expr as ModelicaVariable).name;
        const sub = algSubstMap.get(name);
        if (sub && !this.stateVars.has(name) && !this.parameters.has(name)) {
          return substituteAlgebraic(sub, depth + 1);
        }
        return expr;
      }
      if (expr instanceof ModelicaBinaryExpression) {
        const newOp1 = substituteAlgebraic(expr.operand1, depth);
        const newOp2 = substituteAlgebraic(expr.operand2, depth);
        if (newOp1 !== expr.operand1 || newOp2 !== expr.operand2) {
          return new ModelicaBinaryExpression(expr.operator, newOp1, newOp2);
        }
        return expr;
      }
      if (expr instanceof ModelicaUnaryExpression) {
        const newOp = substituteAlgebraic(expr.operand, depth);
        if (newOp !== expr.operand) return new ModelicaUnaryExpression(expr.operator, newOp);
        return expr;
      }
      if (expr instanceof ModelicaFunctionCallExpression) {
        const newArgs = expr.args.map((a: ModelicaExpression) => substituteAlgebraic(a, depth));
        const changed = newArgs.some((a: ModelicaExpression, i: number) => a !== expr.args[i]);
        if (changed) return new ModelicaFunctionCallExpression(expr.functionName, newArgs);
        return expr;
      }
      return expr;
    };

    const substitutedUnmatched = unmatchedEquations.map((eq) => ({
      lhs: substituteAlgebraic(eq.lhs, 0),
      rhs: substituteAlgebraic(eq.rhs, 0),
    }));

    const phase27Corrections: typeof assignments = [];
    const pantelidesResult = pantelidesIndexReduction(
      substitutedUnmatched,
      this.stateVars,
      this.parameters,
      definedVars,
    );
    for (const dummy of pantelidesResult.dummyDerivatives) {
      this.stateVars.delete(dummy);
      this.algebraicVars.add(dummy);
      definedVars.add(dummy);
    }
    for (const ca of pantelidesResult.constraintAssignments) {
      phase27Corrections.push(ca);
      if (!ca.isDerivative) {
        this.algebraicVars.add(ca.target);
        definedVars.add(ca.target);
      }
    }

    // ── Phase 3: Collect reversed equations from redundant constraints ──
    // For unmatched equations where LHS is defined (e.g. Ohm's law R1.v = R1.R_actual * R1.i
    // where R1.v is from KVL), collect reversed forms. These will be appended
    // AFTER the topological sort so they execute last during iterative evaluation,
    // overriding earlier (potentially degenerate) definitions.
    const phase3Reversals: typeof assignments = [];
    for (const { lhs, rhs } of unmatchedEquations) {
      const lhsName = extractVarName(lhs);
      if (!lhsName) continue;
      const lhsCanon = canonicalize(lhsName);
      if (!definedVars.has(lhsCanon)) continue;

      if (rhs instanceof ModelicaBinaryExpression) {
        const op1Name = extractVarName(rhs.operand1);
        const op2Name = extractVarName(rhs.operand2);
        const op1Canon = op1Name ? canonicalize(op1Name) : null;
        const op2Canon = op2Name ? canonicalize(op2Name) : null;

        if (
          rhs.operator === ModelicaBinaryOperator.MULTIPLICATION ||
          rhs.operator === ModelicaBinaryOperator.ELEMENTWISE_MULTIPLICATION
        ) {
          // Use trial evaluation to determine which operand to override.
          // The operand whose current expression evaluates to null or 0
          // (degenerate) gets overridden with the constitutive equation reversal.
          if (op1Canon && definedVars.has(op1Canon) && op2Canon && definedVars.has(op2Canon)) {
            const idx1 = assignments.findIndex((a) => a.target === op1Canon);
            const idx2 = assignments.findIndex((a) => a.target === op2Canon);
            const a1 = idx1 >= 0 ? assignments[idx1] : undefined;
            const a2 = idx2 >= 0 ? assignments[idx2] : undefined;

            // Trial-evaluate both current expressions
            const trialEval = new ExpressionEvaluator();
            for (const [name, value] of this.parameters) {
              trialEval.env.set(name, value);
            }
            for (const v of this.dae.variables) {
              if (!trialEval.env.has(v.name)) trialEval.env.set(v.name, 0);
            }
            const val1 = a1 ? trialEval.evaluate(a1.expr) : 1;
            const val2 = a2 ? trialEval.evaluate(a2.expr) : 1;

            // Override the degenerate one (null or 0)
            const degenerate1 = val1 === null || val1 === 0;
            const degenerate2 = val2 === null || val2 === 0;

            if (degenerate2 && !degenerate1) {
              // op2 is degenerate — override it
              const expr = new ModelicaBinaryExpression(ModelicaBinaryOperator.DIVISION, lhs, rhs.operand1);
              phase3Reversals.push({ target: op2Canon, expr, isDerivative: false });
            } else if (degenerate1 && !degenerate2) {
              // op1 is degenerate — override it
              const expr = new ModelicaBinaryExpression(ModelicaBinaryOperator.DIVISION, lhs, rhs.operand2);
              phase3Reversals.push({ target: op1Canon, expr, isDerivative: false });
            }
            // If both degenerate or both valid, skip override
          } else if (op1Canon && definedVars.has(op1Canon) && op2Canon) {
            const expr = new ModelicaBinaryExpression(ModelicaBinaryOperator.DIVISION, lhs, rhs.operand1);
            phase3Reversals.push({ target: op2Canon, expr, isDerivative: false });
          } else if (op2Canon && definedVars.has(op2Canon) && op1Canon) {
            const expr = new ModelicaBinaryExpression(ModelicaBinaryOperator.DIVISION, lhs, rhs.operand2);
            phase3Reversals.push({ target: op1Canon, expr, isDerivative: false });
          }
        }
      }
    }

    for (const s of this.stateVars) {
      this.algebraicVars.delete(s);
    }

    const dependencyMap = new Map<string, Set<string>>();
    const visitor = new DependencyVisitor();

    // Map targets to their assignments for easy lookup
    const assignMap = new Map<string, (typeof assignments)[number]>();
    // Collect phase 3/2.7 corrections first to avoid duplicating equations targeting same var
    const supplementalAssigns = [...phase3Reversals, ...phase27Corrections];

    for (const assign of [...assignments, ...supplementalAssigns]) {
      const targetCanonical = assign.isDerivative ? `der(${assign.target})` : assign.target;
      // If a Phase 2.7/3 override targets the same var, it comes later in the array and overwrites the primary
      assignMap.set(targetCanonical, assign);
      const deps = new Set<string>();
      assign.expr.accept(visitor, deps);
      dependencyMap.set(targetCanonical, deps);
    }

    // Tarjan's Strongly Connected Components algorithm
    const index = new Map<string, number>();
    const lowlink = new Map<string, number>();
    const onStack = new Set<string>();
    const stack: string[] = [];
    let currentIndex = 0;
    const blocks: ExecutionBlock[] = [];

    const strongconnect = (v: string) => {
      index.set(v, currentIndex);
      lowlink.set(v, currentIndex);
      currentIndex++;
      stack.push(v);
      onStack.add(v);

      const deps = dependencyMap.get(v) || new Set();
      for (const dep of deps) {
        if (assignMap.has(dep)) {
          // Only traverse edges to computed vars
          if (!index.has(dep)) {
            strongconnect(dep);
            lowlink.set(v, Math.min(lowlink.get(v) ?? currentIndex, lowlink.get(dep) ?? currentIndex));
          } else if (onStack.has(dep)) {
            lowlink.set(v, Math.min(lowlink.get(v) ?? currentIndex, index.get(dep) ?? currentIndex));
          }
        }
      }

      if (lowlink.get(v) === index.get(v)) {
        const scc: string[] = [];
        let w: string | undefined;
        do {
          w = stack.pop();
          if (w === undefined) break;
          onStack.delete(w);
          scc.push(w);
        } while (w !== v);

        // Filter valid assignments
        const sccEqs: typeof assignments = scc
          .map((n) => assignMap.get(n))
          .filter((x): x is (typeof assignments)[number] => x !== undefined);

        const eq0 = sccEqs[0];
        if (sccEqs.length === 1 && eq0 && !sccSelfLoops(eq0)) {
          blocks.push({ type: "single", eq: eq0 });
        } else if (sccEqs.length > 0) {
          blocks.push({
            type: "system",
            vars: scc,
            eqs: sccEqs,
          });
        }
      }
    };

    // Helper: checks if a 1-var SCC has a self-loop (u depends on u)
    const sccSelfLoops = (eq: (typeof assignments)[number]) => {
      const target = eq.isDerivative ? `der(${eq.target})` : eq.target;
      return (dependencyMap.get(target) || new Set()).has(target);
    };

    for (const v of assignMap.keys()) {
      if (!index.has(v)) {
        strongconnect(v);
      }
    }

    this.executionBlocks = blocks;

    // Extract when-clauses
    this.whenClauses = [];
    for (const eq of this.dae.equations) {
      if (eq instanceof ModelicaWhenEquation) {
        const mainClause = this.buildWhenClause(eq.condition, eq.equations);
        if (mainClause) this.whenClauses.push(mainClause);
        for (const elseWhen of eq.elseWhenClauses) {
          const clause = this.buildWhenClause(elseWhen.condition, elseWhen.equations);
          if (clause) this.whenClauses.push(clause);
        }
      }
    }
  }

  // ──────────────────────────────────────────────────────────────────
  //  Multi-pass parameter resolution.
  //  Parameters may reference each other (e.g., `V.signalSource.height = V.signalSource.V`).
  //  Iterates until no new parameters can be resolved, using suffix-based
  //  alias matching to resolve component-scoped references.
  // ──────────────────────────────────────────────────────────────────
  private resolveParameters(): void {
    this.parameters.clear();
    const evaluator = new ExpressionEvaluator();
    const unresolved: { name: string; expr: ModelicaExpression }[] = [];

    // First pass: resolve all directly evaluable parameters
    for (const v of this.dae.variables) {
      if (v.variability === ModelicaVariability.PARAMETER || v.variability === ModelicaVariability.CONSTANT) {
        if (v.expression) {
          const val = evaluator.evaluate(v.expression);
          if (val !== null) {
            this.parameters.set(v.name, val);
            evaluator.env.set(v.name, val);
          } else {
            unresolved.push({ name: v.name, expr: v.expression });
          }
        }
      }
    }

    // Iterative passes: resolve parameters that reference other parameters
    let changed = true;
    while (changed && unresolved.length > 0) {
      changed = false;

      // Populate env with suffix-based alias matches for unresolved NameExpression bindings
      for (const p of unresolved) {
        if (p.expr instanceof ModelicaNameExpression) {
          const refName = p.expr.name;
          if (!evaluator.env.has(refName)) {
            let resolved = false;
            let dotIdx = refName.indexOf(".");
            while (dotIdx > 0 && !resolved) {
              const suffix = refName.substring(dotIdx + 1);
              const direct = evaluator.env.get(suffix);
              if (direct !== undefined) {
                evaluator.env.set(refName, direct);
                changed = true;
                resolved = true;
                break;
              }
              for (const [pName, pVal] of evaluator.env) {
                if (pName.endsWith("." + suffix) || pName === suffix) {
                  evaluator.env.set(refName, pVal);
                  changed = true;
                  resolved = true;
                  break;
                }
              }
              dotIdx = refName.indexOf(".", dotIdx + 1);
            }
          }
        }
      }

      // Try to evaluate remaining unresolved parameters
      for (let i = unresolved.length - 1; i >= 0; i--) {
        const p = unresolved[i];
        if (!p) continue;
        const val = evaluator.evaluate(p.expr);
        if (val !== null) {
          this.parameters.set(p.name, val);
          evaluator.env.set(p.name, val);
          unresolved.splice(i, 1);
          changed = true;
        }
      }
    }
  }

  /** Build a WhenClause from a condition and body equations. */
  private buildWhenClause(condition: ModelicaExpression, equations: ModelicaEquation[]): WhenClause | null {
    const actions: WhenAction[] = [];
    for (const bodyEq of equations) {
      if (bodyEq instanceof ModelicaFunctionCallEquation) {
        const call = bodyEq.call;
        if (call.functionName === "reinit" && call.args.length >= 2) {
          const reinitTarget = call.args[0];
          const reinitExpr = call.args[1];
          if (reinitTarget && reinitExpr) {
            const targetName = extractVarName(reinitTarget);
            if (targetName) {
              actions.push({ type: "reinit", target: targetName, expr: reinitExpr });
            }
          }
        }
      } else if (bodyEq instanceof ModelicaSimpleEquation) {
        const targetName = extractVarName(bodyEq.expression1);
        if (targetName) {
          actions.push({ type: "assign", target: targetName, expr: bodyEq.expression2 });
        }
      }
    }
    if (actions.length === 0) return null;

    // Try to extract a zero-crossing function from the condition
    const zc = buildZeroCrossing(condition);

    return {
      condition,
      actions,
      wasActive: false,
      zeroCrossingFn: zc?.fn ?? null,
      zeroCrossingDirection: zc?.direction ?? "either",
      gPrev: 0,
    };
  }

  /** Metadata about a single parameter variable for the UI. */
  public getParameterInfo(): ParameterInfo[] {
    const evaluator = new ExpressionEvaluator(new Map(this.parameters));
    const infos: ParameterInfo[] = [];
    for (const v of this.dae.variables) {
      if (v.variability !== ModelicaVariability.PARAMETER) continue;
      const defaultValue = this.parameters.get(v.name);
      if (defaultValue === undefined) continue;

      let type: ParameterInfo["type"] = "real";
      let step = 0.1;
      let min: number | undefined;
      let max: number | undefined;
      let enumLiterals: { ordinal: number; label: string }[] | undefined;

      if (v instanceof ModelicaBooleanVariable) {
        type = "boolean";
        step = 1;
      } else if (v instanceof ModelicaIntegerVariable) {
        type = "integer";
        step = 1;
        const minExpr = v.min;
        const maxExpr = v.max;
        if (minExpr) {
          const val = evaluator.evaluate(minExpr);
          if (val !== null) min = val;
        }
        if (maxExpr) {
          const val = evaluator.evaluate(maxExpr);
          if (val !== null) max = val;
        }
      } else if (v instanceof ModelicaEnumerationVariable) {
        type = "enumeration";
        step = 1;
        enumLiterals = v.enumerationLiterals.map((lit) => ({
          ordinal: lit.ordinalValue,
          label: lit.stringValue,
        }));
      } else if (v instanceof ModelicaRealVariable) {
        type = "real";
        step = 0.1;
        const minExpr = v.min;
        const maxExpr = v.max;
        if (minExpr) {
          const val = evaluator.evaluate(minExpr);
          if (val !== null) min = val;
        }
        if (maxExpr) {
          const val = evaluator.evaluate(maxExpr);
          if (val !== null) max = val;
        }
      }

      const info: ParameterInfo = { name: v.name, type, defaultValue, step };
      if (min !== undefined) info.min = min;
      if (max !== undefined) info.max = max;
      if (enumLiterals !== undefined) info.enumLiterals = enumLiterals;

      // Extract unit string from Real variables
      if (v instanceof ModelicaRealVariable && v.unit) {
        const raw = v.unit.toJSON?.toString?.()?.replace(/^"|"$/g, "");
        if (raw) info.unit = raw;
      }

      infos.push(info);
    }
    return infos;
  }

  /**
   * Evaluate the ODE right-hand side f(x, u, t) at a single point.
   * Used by the optimal control direct collocation to evaluate dynamics constraints.
   *
   * @param time         Current time value
   * @param stateValues  Map from state variable name → current value
   * @param controlValues Map from control variable name → current value
   * @returns Map from state variable name → derivative value (dx/dt)
   */
  public evaluateRHS(
    time: number,
    stateValues: Map<string, number>,
    controlValues?: Map<string, number>,
  ): Map<string, number> {
    const evaluator = new ExpressionEvaluator();

    // Load parameters
    for (const [name, value] of this.parameters) {
      evaluator.env.set(name, value);
    }

    // Load state values
    for (const [name, value] of stateValues) {
      evaluator.env.set(name, value);
    }

    // Load control values (overriding any parameters with matching names)
    if (controlValues) {
      for (const [name, value] of controlValues) {
        evaluator.env.set(name, value);
      }
    }

    evaluator.env.set("time", time);

    // Pre-populate all DAE variables with 0 to avoid null cascades
    for (const v of this.dae.variables) {
      if (!evaluator.env.has(v.name)) {
        evaluator.env.set(v.name, 0);
      }
    }

    // Evaluate algebraic equations (execution blocks) to compute intermediate values
    for (const block of this.executionBlocks) {
      if (block.type === "single") {
        const val = evaluator.evaluate(block.eq.expr);
        if (val !== null) {
          if (block.eq.isDerivative) {
            evaluator.env.set(`der(${block.eq.target})`, val);
          } else {
            evaluator.env.set(block.eq.target, val);
          }
        }
      } else {
        // System block: iterate Newton-like until convergence
        for (let iter = 0; iter < 5; iter++) {
          for (const eq of block.eqs) {
            const val = evaluator.evaluate(eq.expr);
            if (val !== null) {
              if (eq.isDerivative) {
                evaluator.env.set(`der(${eq.target})`, val);
              } else {
                evaluator.env.set(eq.target, val);
              }
            }
          }
        }
      }
    }

    // Extract derivatives
    const derivatives = new Map<string, number>();
    for (const state of this.stateVars) {
      const derVal = evaluator.env.get(`der(${state})`);
      derivatives.set(state, derVal ?? 0);
    }
    return derivatives;
  }

  /**
   * Evaluate f(x,u,t) AND its Jacobian ∂f/∂[x,u] at a single point using forward-mode AD.
   *
   * For each seed variable z_i, sets its dual part to 1 (all others 0),
   * then evaluates the execution blocks with DualExpressionEvaluator.
   * This gives exact derivatives via the chain rule.
   *
   * @param time          Current time value
   * @param stateValues   Map from state variable name → current value
   * @param controlValues Map from control variable name → current value
   * @param seedVars      Which variables to differentiate with respect to
   * @returns { f: state→derivative value, J: state→{ seedVar→∂f/∂seedVar } }
   */
  public evaluateRHSWithJacobian(
    time: number,
    stateValues: Map<string, number>,
    controlValues?: Map<string, number>,
    seedVars?: string[],
  ): { f: Map<string, number>; J: Map<string, Map<string, number>> } {
    // All variables that participate as seed candidates
    const allSeedVars = seedVars ?? [
      ...Array.from(stateValues.keys()),
      ...(controlValues ? Array.from(controlValues.keys()) : []),
    ];

    // Build base numeric values map
    const baseValues = new Map<string, number>();
    for (const [name, value] of this.parameters) baseValues.set(name, value);
    for (const [name, value] of stateValues) baseValues.set(name, value);
    if (controlValues) {
      for (const [name, value] of controlValues) baseValues.set(name, value);
    }
    baseValues.set("time", time);
    for (const v of this.dae.variables) {
      if (!baseValues.has(v.name)) baseValues.set(v.name, 0);
    }

    // First pass: compute f values (reuse evaluateRHS for the function values)
    const f = this.evaluateRHS(time, stateValues, controlValues);

    // Compute Jacobian columns via forward-mode AD
    const J = new Map<string, Map<string, number>>();
    for (const state of this.stateVars) {
      J.set(state, new Map());
    }

    for (const seedVar of allSeedVars) {
      // Build dual environment: seed variable gets dot=1, all others dot=0
      const dualEval = new DualExpressionEvaluator();
      for (const [name, value] of baseValues) {
        dualEval.env.set(name, name === seedVar ? new Dual(value, 1) : Dual.constant(value));
      }

      // Walk execution blocks with dual evaluator
      for (const block of this.executionBlocks) {
        if (block.type === "single") {
          const val = dualEval.evaluate(block.eq.expr);
          if (val !== null) {
            if (block.eq.isDerivative) {
              dualEval.env.set(`der(${block.eq.target})`, val);
            } else {
              dualEval.env.set(block.eq.target, val);
            }
          }
        } else {
          // System block: iterate
          for (let iter = 0; iter < 5; iter++) {
            for (const eq of block.eqs) {
              const val = dualEval.evaluate(eq.expr);
              if (val !== null) {
                if (eq.isDerivative) {
                  dualEval.env.set(`der(${eq.target})`, val);
                } else {
                  dualEval.env.set(eq.target, val);
                }
              }
            }
          }
        }
      }

      // Extract derivative parts: ∂f_state/∂seedVar
      for (const state of this.stateVars) {
        const derDual = dualEval.env.get(`der(${state})`);
        const partialDeriv = derDual?.dot ?? 0;
        J.get(state)!.set(seedVar, partialDeriv); // eslint-disable-line @typescript-eslint/no-non-null-assertion
      }
    }

    return { f, J };
  }

  /**
   * Evaluate f(x,u,t) using a computation tape for reverse-mode AD.
   *
   * Records the full forward evaluation on a Tape. After calling this,
   * use `tape.backward(derivativeNode)` to get all ∂(der(state))/∂inputs
   * in a single backward pass.
   *
   * @returns tape, leaf TapeNodes (for reading adjoints), derivative TapeNodes
   */
  public evaluateRHSReverse(
    time: number,
    stateValues: Map<string, number>,
    controlValues?: Map<string, number>,
  ): {
    tape: Tape;
    leaves: Map<string, TapeNode>;
    derivatives: Map<string, TapeNode>;
  } {
    const tape = new Tape();
    const revEval = new ReverseExpressionEvaluator(tape);
    const leaves = new Map<string, TapeNode>();

    // Create tracked leaf nodes for parameters
    for (const [name, value] of this.parameters) {
      const node = tape.constant(value);
      revEval.env.set(name, node);
    }

    // Create tracked leaf nodes for states
    for (const [name, value] of stateValues) {
      const node = tape.variable(value);
      revEval.env.set(name, node);
      leaves.set(name, node);
    }

    // Create tracked leaf nodes for controls
    if (controlValues) {
      for (const [name, value] of controlValues) {
        const node = tape.variable(value);
        revEval.env.set(name, node);
        leaves.set(name, node);
      }
    }

    revEval.env.set("time", tape.constant(time));

    // Pre-populate all DAE variables with 0
    for (const v of this.dae.variables) {
      if (!revEval.env.has(v.name)) {
        revEval.env.set(v.name, tape.constant(0));
      }
    }

    // Evaluate execution blocks on the tape
    for (const block of this.executionBlocks) {
      if (block.type === "single") {
        const val = revEval.evaluate(block.eq.expr);
        if (val !== null) {
          if (block.eq.isDerivative) {
            revEval.env.set(`der(${block.eq.target})`, val);
          } else {
            revEval.env.set(block.eq.target, val);
          }
        }
      } else {
        for (let iter = 0; iter < 5; iter++) {
          for (const eq of block.eqs) {
            const val = revEval.evaluate(eq.expr);
            if (val !== null) {
              if (eq.isDerivative) {
                revEval.env.set(`der(${eq.target})`, val);
              } else {
                revEval.env.set(eq.target, val);
              }
            }
          }
        }
      }
    }

    // Extract derivative TapeNodes
    const derivatives = new Map<string, TapeNode>();
    for (const state of this.stateVars) {
      const derNode = revEval.env.get(`der(${state})`);
      if (derNode) derivatives.set(state, derNode);
    }

    return { tape, leaves, derivatives };
  }

  public simulate(
    startTime: number,
    stopTime: number,
    step: number,
    options?: { signal?: AbortSignal; parameterOverrides?: Map<string, number> },
  ): { t: number[]; y: number[][]; states: string[] } {
    this.prepare();

    // Reset solver state for this simulation run
    this.useImplicitSolver = false;
    this.cachedW = null;
    this.cachedWStepSize = 0;

    // Apply user-supplied parameter overrides (without re-flattening)
    if (options?.parameterOverrides) {
      for (const [name, value] of options.parameterOverrides) {
        if (this.parameters.has(name)) {
          this.parameters.set(name, value);
        }
      }
    }

    const stateVarsArr = Array.from(this.stateVars);
    const algebraicVarsArr = Array.from(this.algebraicVars);
    // Only ODE states go into the RK4 integration vector.
    // Algebraic vars are re-evaluated from sorted equations at each timestep.
    const stateList = stateVarsArr;

    // Resolve initial values: check initial equations first, then variable start attributes
    const paramEnv = new Map(this.parameters);
    const initialValues = stateList.map((state) => {
      // 1. Check initial equations (evaluate RHS with parameter env)
      for (const eq of this.dae.initialEquations) {
        if (eq instanceof ModelicaSimpleEquation) {
          const lhsName = extractVarName(eq.expression1);
          if (lhsName === state) {
            const initEval = new ExpressionEvaluator(new Map(paramEnv));
            const val = initEval.evaluate(eq.expression2);
            if (val !== null) return val;
          }
        }
      }
      // 2. Check variable start attributes
      for (const v of this.dae.variables) {
        if (v.name === state) {
          // Try binding expression first (for non-parameter vars with bindings)
          if (v.expression) {
            if (v.expression instanceof ModelicaRealLiteral) return v.expression.value;
            if (v.expression instanceof ModelicaIntegerLiteral) return v.expression.value;
          }
          // Try start attribute
          const startAttr = v.attributes.get("start");
          if (startAttr) {
            if (startAttr instanceof ModelicaRealLiteral) return startAttr.value;
            if (startAttr instanceof ModelicaIntegerLiteral) return startAttr.value;
            // Try evaluating the start expression
            const evalResult = new ExpressionEvaluator(new Map(this.parameters)).evaluate(startAttr);
            if (evalResult !== null) return evalResult;
          }
          break;
        }
      }
      return 0.0;
    });

    // Map from state name → index for fast reinit lookups
    const stateIndexMap = new Map<string, number>();
    for (let i = 0; i < stateList.length; i++) {
      const name = stateList[i];
      if (name) stateIndexMap.set(name, i);
    }

    // Create the evaluator
    const evaluator = new ExpressionEvaluator();
    evaluator.stepSize = step;

    // Initialize pre-values with initial values
    for (let i = 0; i < stateList.length; i++) {
      const name = stateList[i];
      if (name) evaluator.preValues.set(name, initialValues[i] ?? 0);
    }

    // Load parameter/constant values into the evaluator environment
    for (const [name, value] of this.parameters) {
      evaluator.env.set(name, value);
    }

    // Pre-populate all DAE continuous variables with 0 default.
    // This ensures that variables not computed by any equation (e.g. T_heatPort,
    // Modelica.Constants.eps, ground pin current) don't cause null cascades.
    for (const v of this.dae.variables) {
      if (!evaluator.env.has(v.name)) {
        evaluator.env.set(v.name, 0);
      }
    }

    // Also initialize algebraic variables added by the equation sorter
    // (e.g. C2.i from Phase 2.7) that may not appear in dae.variables.
    for (const av of this.algebraicVars) {
      if (!evaluator.env.has(av)) {
        evaluator.env.set(av, 0);
      }
    }

    // Build the environment from current state
    const populateEnv = (t: number, y: number[]) => {
      evaluator.env.set("time", t);
      for (let i = 0; i < stateList.length; i++) {
        const name = stateList[i];
        if (name) evaluator.env.set(name, y[i] ?? 0.0);
      }
    };

    // Evaluate the derivative function f(t, y) → dy/dt
    const f = (t: number, y: number[]): number[] => {
      if (options?.signal?.aborted) {
        throw new Error("Simulation aborted");
      }

      populateEnv(t, y);

      // Reset all algebraic and derivative variables to ensure idempotent
      // evaluation. Without this, the evaluator retains stale values from
      // previous calls, causing the Jacobian computation (which calls f()
      // with different perturbations) to produce inconsistent derivatives.
      for (const av of this.algebraicVars) {
        evaluator.env.set(av, this.algWarmStart.get(av) ?? 0);
      }
      for (const s of stateList) {
        if (s) evaluator.env.set(`der(${s})`, 0);
      }

      // Evaluate execution blocks sequentially
      for (const block of this.executionBlocks) {
        if (block.type === "single") {
          const value = evaluator.evaluate(block.eq.expr);
          if (value !== null && isFinite(value)) {
            const key = block.eq.isDerivative ? `der(${block.eq.target})` : block.eq.target;
            evaluator.env.set(key, value);
            if (!block.eq.isDerivative) {
              this.algWarmStart.set(key, value);
            }
          }
        } else {
          // Newton-Raphson solver for non-linear/linear algebraic system
          this.solveNewtonBlock(block, evaluator, t);
        }
      }

      return stateList.map((state) => evaluator.env.get(`der(${state})`) ?? 0.0);
    };

    const res = this.rk4WithEvents(
      f,
      startTime,
      stopTime,
      initialValues,
      step,
      stateList,
      stateIndexMap,
      evaluator,
      options?.signal,
    );

    // Build complete result with ODE states + algebraic vars + derivatives.
    // For each timestep, re-evaluate algebraic equations to get current values.
    const derNames = stateVarsArr.map((s) => `der(${s})`);
    const coreStates = [...stateList, ...algebraicVarsArr, ...derNames];

    // Build reverse alias map: for each canonical variable, collect its aliases
    // so that pin variables (e.g. C1.p.v, C1.n.i) appear in the output.
    const coreStateSet = new Set(coreStates);
    interface AliasEntry {
      alias: string;
      canonicalIdx: number;
      canonical: string;
      sign: number;
    }
    const extraEntries: AliasEntry[] = [];

    // Regular aliases (sign = +1)
    for (const [alias, canonical] of this.aliasMap) {
      if (coreStateSet.has(alias)) continue;
      const idx = coreStates.indexOf(canonical);
      extraEntries.push({ alias, canonicalIdx: idx, canonical, sign: 1 });
    }
    // Negated aliases (sign = -1)
    for (const [alias, canonical] of this.negatedAliasMap) {
      if (coreStateSet.has(alias) || extraEntries.some((e) => e.alias === alias)) continue;
      const idx = coreStates.indexOf(canonical);
      extraEntries.push({ alias, canonicalIdx: idx, canonical, sign: -1 });
    }

    const allStates = [...coreStates, ...extraEntries.map((e) => e.alias)];

    const allY = res.y.map((row, idx) => {
      // Re-evaluate to get algebraic values and derivatives at this timestep
      const derivs = f(res.t[idx] ?? 0, row);
      // Snapshot algebraic variable values from the evaluator env
      const algValues = algebraicVarsArr.map((name) => evaluator.env.get(name) ?? 0);
      const coreRow = [...row, ...algValues, ...derivs.slice(0, stateVarsArr.length)];
      // Append alias/negated alias variable values
      for (const entry of extraEntries) {
        // Fast path: canonical is in coreStates (use indexed lookup)
        // Fallback: read from evaluator env (for vars computed inside f() but not in coreStates)
        const val =
          entry.canonicalIdx >= 0 ? (coreRow[entry.canonicalIdx] ?? 0) : (evaluator.env.get(entry.canonical) ?? 0);
        coreRow.push(entry.sign * val);
      }
      return coreRow;
    });

    return { t: res.t, y: allY, states: allStates };
  }

  // ──────────────────────────────────────────────────────────────────
  //  Newton-Raphson solver for a system of algebraic equations.
  //  Solves: x_i = expr_i(x_0, ..., x_{m-1}) for all i in [0, m).
  //  Uses finite-difference Jacobian and LU factorization.
  // ──────────────────────────────────────────────────────────────────
  private solveNewtonBlock(
    block: Extract<ExecutionBlock, { type: "system" }>,
    evaluator: ExpressionEvaluator,
    t: number,
  ): void {
    const m = block.vars.length;
    const x = new Float64Array(m);
    const R = new Float64Array(m);
    const negR = new Float64Array(m);

    // Initialize from current evaluator environment
    for (let i = 0; i < m; i++) {
      x[i] = evaluator.env.get(block.vars[i] ?? "") ?? 0;
    }

    // Pre-allocate Jacobian rows (reused across iterations)
    const J: Float64Array[] = new Array(m);
    for (let i = 0; i < m; i++) J[i] = new Float64Array(m);

    const MAX_ITER = 20;
    const TOL = 1e-10;
    const SQRT_EPS = 1.4901161193847656e-8;
    let converged = false;

    for (let iter = 0; iter < MAX_ITER; iter++) {
      // Set current values into the evaluator
      for (let i = 0; i < m; i++) evaluator.env.set(block.vars[i] ?? "", x[i] ?? 0);

      // Evaluate residuals: R_i = x_i - expr_i
      let maxR = 0;
      for (let i = 0; i < m; i++) {
        const eq = block.eqs[i];
        if (!eq) continue;
        const exprVal = evaluator.evaluate(eq.expr);
        const val = exprVal !== null && isFinite(exprVal) ? exprVal : 0;
        R[i] = (x[i] ?? 0) - val;
        maxR = Math.max(maxR, Math.abs(R[i] ?? 0));
      }

      if (maxR < TOL) {
        converged = true;
        break;
      }

      // Compute Jacobian J = I - d(expr)/dx via finite differences
      for (let i = 0; i < m; i++) (J[i] as Float64Array).fill(0);

      for (let j = 0; j < m; j++) {
        const varJ = block.vars[j] ?? "";
        const xj = x[j] ?? 0;
        const eps = SQRT_EPS * Math.max(Math.abs(xj), 1.0);
        evaluator.env.set(varJ, xj + eps);

        for (let i = 0; i < m; i++) {
          const eq = block.eqs[i];
          if (!eq) continue;
          const exprVal = evaluator.evaluate(eq.expr);
          const val = exprVal !== null && isFinite(exprVal) ? exprVal : 0;
          const R_perturbed = (i === j ? xj + eps : (x[i] ?? 0)) - val;
          const Ji = J[i];
          if (Ji) Ji[j] = (R_perturbed - (R[i] ?? 0)) / eps;
        }
        evaluator.env.set(varJ, xj); // restore
      }

      // Solve J · Δx = -R via LU factorization
      try {
        const fact = luFactor(J, m);
        for (let i = 0; i < m; i++) negR[i] = -(R[i] ?? 0);
        luSolve(fact, negR);
        for (let i = 0; i < m; i++) {
          const nx = (x[i] ?? 0) + (negR[i] ?? 0);
          x[i] = nx;
          evaluator.env.set(block.vars[i] ?? "", nx);
        }
      } catch {
        throw new Error(`Algebraic loop singular Jacobian at t=${t}. System vars: ${block.vars.join(", ")}`);
      }
    }

    if (!converged) {
      throw new Error(
        `Algebraic loop Newton solver failed to converge at t=${t}. System vars: ${block.vars.join(", ")}`,
      );
    }

    // Write converged values back to the evaluator and warm-start cache
    for (let i = 0; i < m; i++) {
      const eq = block.eqs[i];
      if (!eq) continue;
      const key = eq.isDerivative ? `der(${eq.target})` : eq.target;
      evaluator.env.set(key, x[i] ?? 0);
      if (!eq.isDerivative) {
        this.algWarmStart.set(key, x[i] ?? 0);
      }
    }
  }

  // ──────────────────────────────────────────────────────────────────
  //  RK4 step helper — integrates a single step from (t, y) to (t+h, y_new)
  // ──────────────────────────────────────────────────────────────────
  private rk4Step(
    f: (t: number, y: number[]) => number[],
    t: number,
    y: number[],
    h: number,
    n: number,
  ): { y_new: number[]; err: null; converged: boolean } {
    const k1 = f(t, y);
    const y_k2 = new Array(n);
    for (let i = 0; i < n; i++) y_k2[i] = (y[i] ?? 0) + 0.5 * h * (k1[i] ?? 0);

    const k2 = f(t + 0.5 * h, y_k2);
    const y_k3 = new Array(n);
    for (let i = 0; i < n; i++) y_k3[i] = (y[i] ?? 0) + 0.5 * h * (k2[i] ?? 0);

    const k3 = f(t + 0.5 * h, y_k3);
    const y_k4 = new Array(n);
    for (let i = 0; i < n; i++) y_k4[i] = (y[i] ?? 0) + h * (k3[i] ?? 0);

    const k4 = f(t + h, y_k4);

    const y_new = new Array(n);
    for (let i = 0; i < n; i++) {
      y_new[i] = (y[i] ?? 0) + (h / 6.0) * ((k1[i] ?? 0) + 2 * (k2[i] ?? 0) + 2 * (k3[i] ?? 0) + (k4[i] ?? 0));
    }
    return { y_new, err: null, converged: true };
  }

  // ──────────────────────────────────────────────────────────────────
  //  Numerical Jacobian approximation via forward finite differences
  // ──────────────────────────────────────────────────────────────────
  private computeJacobian(
    f: (t: number, y: number[]) => number[],
    t: number,
    y: number[],
    f0: number[],
    n: number,
  ): Float64Array[] {
    this.algWarmStart.clear();

    const sqrtEps = 1.4901161193847656e-8; // √(2.22e-16)
    const J: Float64Array[] = [];
    for (let i = 0; i < n; i++) J.push(new Float64Array(n));

    const yPerturbed = new Array<number>(n);
    for (let j = 0; j < n; j++) {
      const yj = y[j] ?? 0;
      const eps = sqrtEps * Math.max(Math.abs(yj), 1.0);
      for (let i = 0; i < n; i++) yPerturbed[i] = y[i] ?? 0;
      yPerturbed[j] = yj + eps;
      const fPerturbed = f(t, yPerturbed);
      const invEps = 1.0 / eps;
      for (let i = 0; i < n; i++) {
        const col = J[i];
        if (col) col[j] = ((fPerturbed[i] ?? 0) - (f0[i] ?? 0)) * invEps;
      }
    }
    return J;
  }

  // ──────────────────────────────────────────────────────────────────
  //  Build and cache the iteration matrix W = I - γ·h·J
  // ──────────────────────────────────────────────────────────────────
  private getOrBuildW(
    f: (t: number, y: number[]) => number[],
    t: number,
    y: number[],
    f0: number[],
    h: number,
    n: number,
  ): LUFactorization {
    // Always recompute the Jacobian at the current point (t, y).
    // The Jacobian depends on both time (e.g. signal onset) and state,
    // so a step-size-only cache key is insufficient.

    const J = this.computeJacobian(f, t, y, f0, n);
    const ghJ = SDIRK_GAMMA * h;

    // W = I - γ·h·J
    const W: Float64Array[] = [];
    for (let i = 0; i < n; i++) {
      const row = new Float64Array(n);
      const jRow = J[i];
      if (jRow) {
        for (let j = 0; j < n; j++) {
          row[j] = (i === j ? 1.0 : 0.0) - ghJ * (jRow[j] ?? 0);
        }
      }
      W.push(row);
    }

    this.cachedW = luFactor(W, n);
    this.cachedWStepSize = h;
    return this.cachedW;
  }

  // ──────────────────────────────────────────────────────────────────
  //  SDIRK2 step — 2-stage singly diagonally implicit Runge-Kutta
  //  (L-stable, order 2, γ = 1 - √2/2)
  //
  //  Stage 1: find k₁ s.t. k₁ = f(t + γh, y + γh·k₁)
  //  Stage 2: find k₂ s.t. k₂ = f(t + h, y + (1-γ)h·k₁ + γh·k₂)
  //  y_new = y + h·((1-γ)·k₁ + γ·k₂)
  // ──────────────────────────────────────────────────────────────────
  private sdirk2Step(
    f: (t: number, y: number[]) => number[],
    t: number,
    y: number[],
    h: number,
    n: number,
  ): { y_new: number[]; err: number[]; converged: boolean } {
    const gamma = SDIRK_GAMMA;
    const gh = gamma * h;
    const omg = 1.0 - gamma; // 1 - γ

    // ── Stage 1: solve for k₁ s.t. k₁ = f(t + γh, y + γh·k₁) ──
    const k1 = new Array<number>(n);

    // Evaluate f at the first stage point for initial guess AND Jacobian
    const tStage1 = t + gh;
    const f0 = f(tStage1, y); // f(t+γh, y) — Jacobian evaluation point
    for (let i = 0; i < n; i++) k1[i] = f0[i] ?? 0; // Initial guess

    // Build W = LU(I - γ·h·J) using the stage point where dynamics are active
    const W = this.getOrBuildW(f, tStage1, y, f0, h, n);

    const yStage = new Array<number>(n);
    let stage1Converged = false;
    for (let iter = 0; iter < NEWTON_MAX_ITER; iter++) {
      // y_stage = y + γ·h·k1
      for (let i = 0; i < n; i++) yStage[i] = (y[i] ?? 0) + gh * (k1[i] ?? 0);
      const fVal = f(tStage1, yStage);

      // Residual: r = f(t + γh, y + γh·k1) - k1
      const r = new Float64Array(n);
      let maxR = 0;
      for (let i = 0; i < n; i++) {
        r[i] = (fVal[i] ?? 0) - (k1[i] ?? 0);
        maxR = Math.max(maxR, Math.abs(r[i] ?? 0));
      }
      if (maxR < NEWTON_TOL) {
        stage1Converged = true;
        break;
      }

      // Solve W · Δk = r
      luSolve(W, r);
      for (let i = 0; i < n; i++) k1[i] = (k1[i] ?? 0) + (r[i] ?? 0);
    }

    if (!stage1Converged) {
      return { y_new: [], err: [], converged: false };
    }

    // ── Stage 2: solve for k₂ s.t. k₂ = f(t + h, y + (1-γ)h·k₁ + γh·k₂) ──
    const k2 = new Array<number>(n);
    for (let i = 0; i < n; i++) k2[i] = k1[i] ?? 0; // Initial guess

    let stage2Converged = false;
    for (let iter = 0; iter < NEWTON_MAX_ITER; iter++) {
      // y_stage = y + (1-γ)·h·k1 + γ·h·k2
      for (let i = 0; i < n; i++) {
        yStage[i] = (y[i] ?? 0) + omg * h * (k1[i] ?? 0) + gh * (k2[i] ?? 0);
      }
      const fVal = f(t + h, yStage);

      // Residual: r = f(t + h, y + ...) - k2
      const r = new Float64Array(n);
      let maxR = 0;
      for (let i = 0; i < n; i++) {
        r[i] = (fVal[i] ?? 0) - (k2[i] ?? 0);
        maxR = Math.max(maxR, Math.abs(r[i] ?? 0));
      }
      if (maxR < NEWTON_TOL) {
        stage2Converged = true;
        break;
      }

      luSolve(W, r);
      for (let i = 0; i < n; i++) k2[i] = (k2[i] ?? 0) + (r[i] ?? 0);
    }

    if (!stage2Converged) {
      return { y_new: [], err: [], converged: false };
    }

    // ── Assemble solution ──
    // y_new = y + h · ((1-γ)·k₁ + γ·k₂)
    const y_new = new Array<number>(n);
    const err = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      const k1_i = k1[i] ?? 0;
      const k2_i = k2[i] ?? 0;
      y_new[i] = (y[i] ?? 0) + h * (omg * k1_i + gamma * k2_i);
      // Embedded order-1 error estimate: h * gamma * (k2 - k1)
      err[i] = h * gamma * (k2_i - k1_i);
    }
    return { y_new, err, converged: true };
  }

  // ──────────────────────────────────────────────────────────────────
  //  Generic step dispatcher — routes to RK4 or SDIRK2
  // ──────────────────────────────────────────────────────────────────
  private step(
    f: (t: number, y: number[]) => number[],
    t: number,
    y: number[],
    h: number,
    n: number,
  ): { y_new: number[]; err: number[] | null; converged: boolean } {
    if (this.useImplicitSolver) {
      return this.sdirk2Step(f, t, y, h, n);
    }
    return this.rk4Step(f, t, y, h, n);
  }

  // ──────────────────────────────────────────────────────────────────
  //  Evaluate zero-crossing functions for all when-clauses
  // ──────────────────────────────────────────────────────────────────
  private evaluateZeroCrossings(evaluator: ExpressionEvaluator, t: number, y: number[], states: string[]): number[] {
    evaluator.env.set("time", t);
    for (let i = 0; i < states.length; i++) {
      const name = states[i];
      if (name) evaluator.env.set(name, y[i] ?? 0);
    }
    return this.whenClauses.map((clause) => {
      if (clause.zeroCrossingFn) {
        return clause.zeroCrossingFn(evaluator) ?? 0;
      }
      // For non-decomposable conditions, fall back to boolean
      const condVal = evaluator.evaluate(clause.condition);
      // Map boolean to a continuous-ish value: true → -1, false → +1
      return condVal !== null && condVal !== 0 ? -1 : 1;
    });
  }

  // ──────────────────────────────────────────────────────────────────
  //  Detect which when-clause had a triggering sign change
  // ──────────────────────────────────────────────────────────────────
  private detectTriggeredClause(gPre: number[], gPost: number[]): number {
    for (let i = 0; i < this.whenClauses.length; i++) {
      const clause = this.whenClauses[i];
      if (!clause) continue;
      const pre = gPre[i] ?? 0;
      const post = gPost[i] ?? 0;

      if (clause.zeroCrossingDirection === "negative") {
        // Fires when g goes from > 0 to <= 0
        if (pre > 0 && post <= 0) return i;
      } else if (clause.zeroCrossingDirection === "positive") {
        // Fires when g goes from < 0 to >= 0
        if (pre < 0 && post >= 0) return i;
      } else {
        // "either" — any sign change
        if ((pre > 0 && post <= 0) || (pre < 0 && post >= 0)) return i;
      }
    }
    return -1;
  }

  // ──────────────────────────────────────────────────────────────────
  //  Bisect to find the exact zero-crossing time using Illinois method
  // ──────────────────────────────────────────────────────────────────
  private bisectEvent(
    f: (t: number, y: number[]) => number[],
    tA: number,
    yA: number[],
    gA: number,
    tB: number,
    gB: number,
    n: number,
    clauseIdx: number,
    evaluator: ExpressionEvaluator,
    states: string[],
  ): { t: number; y: number[] } {
    let tLo = tA;
    let tHi = tB;
    let yLo = yA;
    let gLo = gA;
    let gHi = gB;

    for (let iter = 0; iter < BISECT_MAX_ITER; iter++) {
      if (Math.abs(tHi - tLo) < BISECT_TOL) break;

      // Illinois method: use regula falsi with Illinois modification
      let tMid: number;
      const denom = gHi - gLo;
      if (Math.abs(denom) < 1e-15) {
        tMid = (tLo + tHi) / 2;
      } else {
        tMid = tLo - (gLo * (tHi - tLo)) / denom;
        // Clamp to stay within bounds
        tMid = Math.max(tLo + BISECT_TOL, Math.min(tHi - BISECT_TOL, tMid));
      }

      const dt = tMid - tLo;
      const yMid = this.step(f, tLo, yLo, dt, n).y_new;

      // Evaluate zero-crossing at midpoint
      const gAll = this.evaluateZeroCrossings(evaluator, tMid, yMid, states);
      const gMid = gAll[clauseIdx] ?? 0;

      if (gMid * gLo <= 0) {
        // Root is in [tLo, tMid]
        tHi = tMid;
        gHi = gMid;
      } else {
        // Root is in [tMid, tHi]
        tLo = tMid;
        yLo = yMid;
        gLo = gMid;
        // Illinois modification: halve gHi to ensure convergence
        gHi = gHi / 2;
      }
    }

    // Final integration to the located time
    if (Math.abs(tLo - tA) > BISECT_TOL) {
      return { t: tLo, y: yLo };
    }
    const dtFinal = tLo - tA;
    const yFinal = dtFinal > BISECT_TOL ? this.step(f, tA, yA, dtFinal, n).y_new : [...yA];
    return { t: tLo, y: yFinal };
  }

  /** RK4 integrator with zero-crossing event detection, bisection, and restart. */
  private rk4WithEvents(
    f: (t: number, y: number[]) => number[],
    t0: number,
    t1: number,
    y0: number[],
    h: number,
    states: string[],
    stateIndexMap: Map<string, number>,
    evaluator: ExpressionEvaluator,
    signal?: AbortSignal,
  ) {
    const t: number[] = [];
    const y: number[][] = [];

    let current_t = t0;
    let current_y = [...y0];

    const n = states.length;

    // Evaluate when-conditions at initial time to set wasActive flags and gPrev
    evaluator.isInitial = true;
    evaluator.isTerminal = false;

    const gInit = this.evaluateZeroCrossings(evaluator, current_t, current_y, states);
    for (let i = 0; i < this.whenClauses.length; i++) {
      const clause = this.whenClauses[i];
      if (!clause) continue;
      clause.gPrev = gInit[i] ?? 0;
      const condVal = evaluator.evaluate(clause.condition);
      const isActive = condVal !== null && condVal !== 0;
      if (isActive) {
        this.fireWhenActions(clause, evaluator, current_y, stateIndexMap);
      }
      clause.wasActive = isActive;
    }
    evaluator.isInitial = false;

    t.push(current_t);
    y.push([...current_y]);

    let eventsThisStep = 0;
    let t_last_event = current_t;
    let stiffnessProbeCount = 0;
    let loopCounter = 0;

    let stepH = h; // Active step size

    const ADAPT_ATOL = this.dae.experiment?.tolerance ?? 1e-6;
    const ADAPT_RTOL = 1e-4;

    while (current_t < t1) {
      if (signal?.aborted) {
        throw new Error("Simulation aborted");
      }

      loopCounter++;
      if (loopCounter > 1_000_000) {
        throw new Error(`Simulation runaway detected: exceeded 1,000,000 evaluation steps around t=${current_t}.`);
      }

      // Reset event counter if we've moved forward appreciably
      if (current_t > t_last_event + h * 0.1) {
        eventsThisStep = 0;
      }

      let isLastStep = false;
      if (current_t + stepH >= t1) {
        stepH = t1 - current_t;
        isLastStep = true;
      }

      // 1. Evaluate zero-crossings at the start of the step
      const gPre = this.evaluateZeroCrossings(evaluator, current_t, current_y, states);

      // 2. Take a tentative integration step
      let stepResult = this.step(f, current_t, current_y, stepH, n);
      let y_tentative = stepResult.y_new;
      let stepErr = stepResult.err;
      const t_tentative = current_t + stepH;

      // 2b. Proactive stiffness detection: compare RK4 vs SDIRK2 for the first
      //     several non-trivial steps. Stiffness in LC circuits manifests only
      //     when fast eigenvalues are excited (e.g. at step signal onset), which
      //     may not be the very first non-zero-derivative step.
      if (!this.useImplicitSolver && stiffnessProbeCount < 10) {
        // Check if this step has non-trivial change
        let maxDelta = 0;
        for (let i = 0; i < n; i++) {
          maxDelta = Math.max(maxDelta, Math.abs((y_tentative[i] ?? 0) - (current_y[i] ?? 0)));
        }
        if (maxDelta > 1e-10) {
          stiffnessProbeCount++;
          // Take an SDIRK2 step from the same state for comparison
          const sdirkRes = this.sdirk2Step(f, current_t, current_y, stepH, n);
          const y_implicit = sdirkRes.y_new;
          // Compare: if max relative difference exceeds threshold, system is stiff
          let maxRelDiff = 0;
          for (let i = 0; i < n; i++) {
            const yR = y_tentative[i] ?? 0;
            const yI = y_implicit[i] ?? 0;
            const diff = Math.abs(yR - yI);
            // Scale by the smaller magnitude: if one solver diverges and the
            // other doesn't, the ratio should be huge, not ~1.
            const scale = Math.max(Math.min(Math.abs(yR), Math.abs(yI)), 1e-10);
            maxRelDiff = Math.max(maxRelDiff, diff / scale);
          }
          if (maxRelDiff > STIFFNESS_PROBE_THRESHOLD) {
            this.useImplicitSolver = true;
            this.cachedW = null;
            y_tentative = y_implicit; // Use the SDIRK2 result
            stepErr = sdirkRes.err;
          }
        }
      }

      // 2c. Fallback: also check for NaN/Inf in case detection missed it
      if (!this.useImplicitSolver) {
        let diverged = false;
        for (let i = 0; i < n; i++) {
          const v = y_tentative[i] ?? 0;
          if (!isFinite(v)) {
            diverged = true;
            break;
          }
        }
        if (diverged) {
          this.useImplicitSolver = true;
          this.cachedW = null;
          stepResult = this.step(f, current_t, current_y, stepH, n);
          y_tentative = stepResult.y_new;
          stepErr = stepResult.err;
        }
      }

      // 2d. Adaptive step size control via embedded error estimate
      if (this.useImplicitSolver) {
        let errNorm = 0;
        if (!stepResult.converged) {
          errNorm = Infinity; // Force step rejection
        } else if (stepErr) {
          for (let i = 0; i < n; i++) {
            const ymax = Math.max(Math.abs(current_y[i] ?? 0), Math.abs(y_tentative[i] ?? 0));
            const scale = ADAPT_ATOL + ADAPT_RTOL * ymax;
            errNorm = Math.max(errNorm, Math.abs(stepErr[i] ?? 0) / scale);
          }
        }

        if (errNorm > 1.0) {
          // Reject step
          stepH = stepH * Math.max(0.1, 0.9 / Math.sqrt(errNorm));
          if (stepH < 1e-15) {
            throw new Error(`Step size vanished below precision at t=${current_t}.`);
          }
          continue; // Try again!
        } else if (!isLastStep) {
          // Accept step and grow stepH for the NEXT step, up to nominal h
          const growthFn = Math.min(5.0, 0.9 / Math.sqrt(Math.max(errNorm, 1e-10)));
          stepH = Math.min(h, stepH * growthFn);
        }
      }

      // 3. Evaluate zero-crossings at the end of the step
      const gPost = this.evaluateZeroCrossings(evaluator, t_tentative, y_tentative, states);

      // 4. Check for a triggering sign change
      const triggeredIdx = this.detectTriggeredClause(gPre, gPost);

      const clause = triggeredIdx >= 0 ? this.whenClauses[triggeredIdx] : undefined;

      if (clause && eventsThisStep < MAX_EVENTS_PER_STEP) {
        eventsThisStep++;
        t_last_event = current_t;

        // Event detected! Bisect to find the exact event time.
        const gA = gPre[triggeredIdx] ?? 0;
        const gB = gPost[triggeredIdx] ?? 0;

        const event = this.bisectEvent(
          f,
          current_t,
          current_y,
          gA,
          t_tentative,
          gB,
          n,
          triggeredIdx,
          evaluator,
          states,
        );

        // Record the pre-event state at event time
        t.push(event.t);
        y.push([...event.y]);

        // Update pre-values to the state just before the event
        for (let i = 0; i < states.length; i++) {
          const name = states[i];
          if (name) evaluator.preValues.set(name, event.y[i] ?? 0);
        }

        // Fire the when-clause actions (reinit, assign)
        evaluator.env.set("time", event.t);
        for (let i = 0; i < states.length; i++) {
          const name = states[i];
          if (name) evaluator.env.set(name, event.y[i] ?? 0);
        }
        this.fireWhenActions(clause, evaluator, event.y, stateIndexMap);
        clause.wasActive = true;

        // Record the post-event state at the same time (discontinuity)
        t.push(event.t);
        y.push([...event.y]);

        // Restart integration from the event time with the new state
        current_t = event.t;
        current_y = [...event.y];

        // Re-evaluate zero-crossings after the event to update gPrev
        const gAfter = this.evaluateZeroCrossings(evaluator, current_t, current_y, states);
        for (let i = 0; i < this.whenClauses.length; i++) {
          const c = this.whenClauses[i];
          if (c) c.gPrev = gAfter[i] ?? 0;
        }
      } else {
        // No event — accept the step normally
        current_t = t_tentative;
        current_y = y_tentative;

        // Update when-clause state
        evaluator.isTerminal = current_t >= t1 - h * 0.01;
        evaluator.env.set("time", current_t);
        for (let i = 0; i < states.length; i++) {
          const name = states[i];
          if (name) evaluator.env.set(name, current_y[i] ?? 0);
        }
        for (let i = 0; i < this.whenClauses.length; i++) {
          const clause = this.whenClauses[i];
          if (!clause) continue;
          const condVal = evaluator.evaluate(clause.condition);
          const isActive = condVal !== null && condVal !== 0;
          clause.wasActive = isActive;
          clause.gPrev = gPost[i] ?? 0;
        }

        // Update pre-values for the next step
        for (let i = 0; i < states.length; i++) {
          const name = states[i];
          if (name) evaluator.preValues.set(name, current_y[i] ?? 0);
        }

        t.push(current_t);
        y.push([...current_y]);
      }
    }

    return { t, y, states };
  }

  /** Execute the actions of a triggered when-clause (reinit, assign). */
  private fireWhenActions(
    clause: WhenClause,
    evaluator: ExpressionEvaluator,
    current_y: number[],
    stateIndexMap: Map<string, number>,
  ): void {
    for (const action of clause.actions) {
      const value = evaluator.evaluate(action.expr);
      if (value === null || isNaN(value)) continue;

      const idx = stateIndexMap.get(action.target);
      if (idx !== undefined) {
        current_y[idx] = value;
        // Also update the environment so subsequent actions see the new value
        evaluator.env.set(action.target, value);
      }
    }
  }
}

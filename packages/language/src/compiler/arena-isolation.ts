import { collectArenaExprDeps } from "./arena-blt.js";
import type { ArenaExecutionBlock } from "./arena-execution.js";
import { ArenaDAEBuilder, BinOp, EqKind, ExprKind, UnaryOp } from "./dae-arena.js";
import { Polynomial, Term, computeGroebnerBasis } from "./symbolics/algebra/groebner.js";

/**
 * Checks if the arena equation is explicitly solvable for the target variable.
 * An equation is explicitly solvable if it's of the form `Var = Expr` or `Expr = Var`
 * and `Var` does not appear in `Expr`.
 *
 * @returns The ExprId of the isolated expression, or -1 if not explicitly solvable.
 */
export function isExplicitlySolvableArena(arena: ArenaDAEBuilder, eqIdx: number, targetVarIdx: number): number {
  const left = arena.getEqLhs(eqIdx);
  const right = arena.getEqRhs(eqIdx);

  if (isTargetVar(arena, left, targetVarIdx)) {
    if (!containsVar(arena, right, targetVarIdx)) return right;
  }
  if (isTargetVar(arena, right, targetVarIdx)) {
    if (!containsVar(arena, left, targetVarIdx)) return left;
  }

  return -1;
}

/**
 * Attempts to symbolically isolate the target variable in the equation.
 * Supports:
 *   1. Explicit form: `x = expr` or `expr = x`
 *   2. Linear isolation: `A*x + B = 0` → `x = -B/A`
 *   3. Single-occurrence inversion: recursive peeling of `f(g(x)) = val`
 *
 * @returns ExprId of the isolated RHS, or -1 if isolation fails.
 */
export function isolateSymbolicallyArena(arena: ArenaDAEBuilder, eqIdx: number, targetVarIdx: number): number {
  // Strategy 0: Explicit form
  const explicitRhs = isExplicitlySolvableArena(arena, eqIdx, targetVarIdx);
  if (explicitRhs !== -1) return explicitRhs;

  const lhs = arena.getEqLhs(eqIdx);
  const rhs = arena.getEqRhs(eqIdx);

  // Strategy 1: Linear isolation on residual (lhs - rhs)
  // Build residual = lhs - rhs symbolically
  const residualId = arena.addBinaryExpr(BinOp.Sub, lhs, rhs);
  const linear = extractLinearCoeffsArena(arena, residualId, targetVarIdx);
  if (linear) {
    const { aId, bId } = linear;
    // x = -B / A
    const negB = arena.addBinaryExpr(BinOp.Mul, arena.addRealLiteral(-1), bId);
    return arena.addBinaryExpr(BinOp.Div, negB, aId);
  }

  // Strategy 2: Single-occurrence inversion
  const lhsCount = countOccurrences(arena, lhs, targetVarIdx);
  const rhsCount = countOccurrences(arena, rhs, targetVarIdx);

  if (lhsCount === 1 && rhsCount === 0) {
    const result = invertSingleOccurrence(arena, lhs, targetVarIdx, rhs);
    if (result !== -1) return result;
  }
  if (rhsCount === 1 && lhsCount === 0) {
    const result = invertSingleOccurrence(arena, rhs, targetVarIdx, lhs);
    if (result !== -1) return result;
  }

  // Also try on residual = 0
  const totalCount = countOccurrences(arena, residualId, targetVarIdx);
  if (totalCount === 1) {
    const zeroId = arena.addRealLiteral(0);
    const result = invertSingleOccurrence(arena, residualId, targetVarIdx, zeroId);
    if (result !== -1) return result;
  }

  return -1;
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

/** Check if exprId is a reference to the target variable (or der(target)). */
function isTargetVar(arena: ArenaDAEBuilder, exprId: number, targetVarIdx: number): boolean {
  if (exprId < 0) return false;
  const kind = arena.getExprKind(exprId);
  if (kind === ExprKind.Name) {
    return arena.getVarNameId(targetVarIdx) === arena.getExprData1(exprId);
  }
  if (kind === ExprKind.Der) {
    const argId = arena.getExprData1(exprId);
    if (arena.getExprKind(argId) === ExprKind.Name) {
      const innerNameId = arena.getExprData1(argId);
      const innerName = arena.interner.resolve(innerNameId);
      const targetName = arena.getVarName(targetVarIdx);
      if (targetName === `der(${innerName})`) return true;
    }
  }
  return false;
}

/** Check if the expression tree contains a reference to the target variable. */
function containsVar(arena: ArenaDAEBuilder, exprId: number, targetVarIdx: number): boolean {
  if (exprId < 0) return false;
  if (isTargetVar(arena, exprId, targetVarIdx)) return true;

  const kind = arena.getExprKind(exprId);
  switch (kind) {
    case ExprKind.Binary:
      return (
        containsVar(arena, arena.getExprLeft(exprId), targetVarIdx) ||
        containsVar(arena, arena.getExprRight(exprId), targetVarIdx)
      );
    case ExprKind.Unary:
    case ExprKind.Negate:
    case ExprKind.Der:
    case ExprKind.Pre:
      return containsVar(
        arena,
        arena.getExprLeft(exprId) >= 0 ? arena.getExprLeft(exprId) : arena.getExprData1(exprId),
        targetVarIdx,
      );
    case ExprKind.Call: {
      const count = arena.getExprRight(exprId);
      const first = arena.getExprLeft(exprId);
      for (let i = 0; i < count; i++) {
        if (containsVar(arena, first + i, targetVarIdx)) return true;
      }
      return false;
    }
    case ExprKind.IfElse:
      return (
        containsVar(arena, arena.getExprData1(exprId), targetVarIdx) ||
        containsVar(arena, arena.getExprLeft(exprId), targetVarIdx) ||
        containsVar(arena, arena.getExprRight(exprId), targetVarIdx)
      );
    default:
      return false;
  }
}

/** Count occurrences of the target variable in the expression tree. */
function countOccurrences(arena: ArenaDAEBuilder, exprId: number, targetVarIdx: number): number {
  if (exprId < 0) return 0;
  if (isTargetVar(arena, exprId, targetVarIdx)) return 1;

  const kind = arena.getExprKind(exprId);
  switch (kind) {
    case ExprKind.Binary:
      return (
        countOccurrences(arena, arena.getExprLeft(exprId), targetVarIdx) +
        countOccurrences(arena, arena.getExprRight(exprId), targetVarIdx)
      );
    case ExprKind.Unary:
    case ExprKind.Negate:
    case ExprKind.Der:
    case ExprKind.Pre:
      return countOccurrences(
        arena,
        arena.getExprLeft(exprId) >= 0 ? arena.getExprLeft(exprId) : arena.getExprData1(exprId),
        targetVarIdx,
      );
    case ExprKind.Call: {
      const count = arena.getExprRight(exprId);
      const first = arena.getExprLeft(exprId);
      let total = 0;
      for (let i = 0; i < count; i++) {
        total += countOccurrences(arena, first + i, targetVarIdx);
      }
      return total;
    }
    case ExprKind.IfElse:
      return (
        countOccurrences(arena, arena.getExprData1(exprId), targetVarIdx) +
        countOccurrences(arena, arena.getExprLeft(exprId), targetVarIdx) +
        countOccurrences(arena, arena.getExprRight(exprId), targetVarIdx)
      );
    default:
      return 0;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Linear Coefficient Extraction
// ─────────────────────────────────────────────────────────────────────

/**
 * Extract linear coefficients A, B such that `expr = A*x + B`.
 * Returns {aId, bId} as ExprIds, or null if expr is not linear in x.
 */
function extractLinearCoeffsArena(
  arena: ArenaDAEBuilder,
  exprId: number,
  targetVarIdx: number,
): { aId: number; bId: number } | null {
  if (exprId < 0) return null;

  // If expr doesn't contain x, it's a constant: A=0, B=expr
  if (!containsVar(arena, exprId, targetVarIdx)) {
    return { aId: arena.addRealLiteral(0), bId: exprId };
  }

  // If expr IS x, then A=1, B=0
  if (isTargetVar(arena, exprId, targetVarIdx)) {
    return { aId: arena.addRealLiteral(1), bId: arena.addRealLiteral(0) };
  }

  const kind = arena.getExprKind(exprId);

  if (kind === ExprKind.Negate) {
    const inner = extractLinearCoeffsArena(
      arena,
      arena.getExprLeft(exprId) >= 0 ? arena.getExprLeft(exprId) : arena.getExprData1(exprId),
      targetVarIdx,
    );
    if (!inner) return null;
    return {
      aId: arena.addBinaryExpr(BinOp.Mul, arena.addRealLiteral(-1), inner.aId),
      bId: arena.addBinaryExpr(BinOp.Mul, arena.addRealLiteral(-1), inner.bId),
    };
  }

  if (kind === ExprKind.Binary) {
    const op = arena.getExprData1(exprId) as BinOp;
    const leftId = arena.getExprLeft(exprId);
    const rightId = arena.getExprRight(exprId);
    const leftHasVar = containsVar(arena, leftId, targetVarIdx);
    const rightHasVar = containsVar(arena, rightId, targetVarIdx);

    if (op === BinOp.Add || op === BinOp.ElemAdd) {
      const lc = extractLinearCoeffsArena(arena, leftId, targetVarIdx);
      const rc = extractLinearCoeffsArena(arena, rightId, targetVarIdx);
      if (!lc || !rc) return null;
      return {
        aId: arena.addBinaryExpr(BinOp.Add, lc.aId, rc.aId),
        bId: arena.addBinaryExpr(BinOp.Add, lc.bId, rc.bId),
      };
    }

    if (op === BinOp.Sub || op === BinOp.ElemSub) {
      const lc = extractLinearCoeffsArena(arena, leftId, targetVarIdx);
      const rc = extractLinearCoeffsArena(arena, rightId, targetVarIdx);
      if (!lc || !rc) return null;
      return {
        aId: arena.addBinaryExpr(BinOp.Sub, lc.aId, rc.aId),
        bId: arena.addBinaryExpr(BinOp.Sub, lc.bId, rc.bId),
      };
    }

    if (op === BinOp.Mul || op === BinOp.ElemMul) {
      // Only handle: const * linear(x) or linear(x) * const
      if (!leftHasVar) {
        const rc = extractLinearCoeffsArena(arena, rightId, targetVarIdx);
        if (!rc) return null;
        return {
          aId: arena.addBinaryExpr(BinOp.Mul, leftId, rc.aId),
          bId: arena.addBinaryExpr(BinOp.Mul, leftId, rc.bId),
        };
      }
      if (!rightHasVar) {
        const lc = extractLinearCoeffsArena(arena, leftId, targetVarIdx);
        if (!lc) return null;
        return {
          aId: arena.addBinaryExpr(BinOp.Mul, lc.aId, rightId),
          bId: arena.addBinaryExpr(BinOp.Mul, lc.bId, rightId),
        };
      }
      return null; // Both sides contain x → non-linear
    }

    if (op === BinOp.Div || op === BinOp.ElemDiv) {
      // Only handle: linear(x) / const
      if (!rightHasVar) {
        const lc = extractLinearCoeffsArena(arena, leftId, targetVarIdx);
        if (!lc) return null;
        return {
          aId: arena.addBinaryExpr(BinOp.Div, lc.aId, rightId),
          bId: arena.addBinaryExpr(BinOp.Div, lc.bId, rightId),
        };
      }
      return null;
    }
  }

  return null; // Non-linear or unsupported
}

// ─────────────────────────────────────────────────────────────────────
// Single-Occurrence Inversion
// ─────────────────────────────────────────────────────────────────────

/**
 * Given `expr` containing the target variable exactly once, and `valueId`
 * such that `expr = value`, recursively invert to yield `x = f(value)`.
 *
 * @returns ExprId of the isolated expression, or -1 on failure.
 */
function invertSingleOccurrence(arena: ArenaDAEBuilder, exprId: number, targetVarIdx: number, valueId: number): number {
  if (exprId < 0) return -1;

  // Base case: expr IS the variable
  if (isTargetVar(arena, exprId, targetVarIdx)) return valueId;

  const kind = arena.getExprKind(exprId);

  // Negate: -f(x) = value → f(x) = -value
  if (kind === ExprKind.Negate) {
    const operand = arena.getExprLeft(exprId) >= 0 ? arena.getExprLeft(exprId) : arena.getExprData1(exprId);
    const negValue = arena.addBinaryExpr(BinOp.Mul, arena.addRealLiteral(-1), valueId);
    return invertSingleOccurrence(arena, operand, targetVarIdx, negValue);
  }

  // Binary operations
  if (kind === ExprKind.Binary) {
    const op = arena.getExprData1(exprId) as BinOp;
    const leftId = arena.getExprLeft(exprId);
    const rightId = arena.getExprRight(exprId);
    const leftHas = containsVar(arena, leftId, targetVarIdx);
    const rightHas = containsVar(arena, rightId, targetVarIdx);

    if (leftHas && rightHas) return -1; // Both sides → can't invert single occurrence
    if (!leftHas && !rightHas) return -1;

    const varSide = leftHas ? leftId : rightId;
    const otherSide = leftHas ? rightId : leftId;
    const varOnLeft = leftHas;

    switch (op) {
      // f(x) + b = val → f(x) = val - b
      case BinOp.Add:
      case BinOp.ElemAdd:
        return invertSingleOccurrence(arena, varSide, targetVarIdx, arena.addBinaryExpr(BinOp.Sub, valueId, otherSide));

      // f(x) - b = val → f(x) = val + b;  a - f(x) = val → f(x) = a - val
      case BinOp.Sub:
      case BinOp.ElemSub:
        if (varOnLeft) {
          return invertSingleOccurrence(
            arena,
            varSide,
            targetVarIdx,
            arena.addBinaryExpr(BinOp.Add, valueId, otherSide),
          );
        }
        return invertSingleOccurrence(arena, varSide, targetVarIdx, arena.addBinaryExpr(BinOp.Sub, otherSide, valueId));

      // f(x) * b = val → f(x) = val / b
      case BinOp.Mul:
      case BinOp.ElemMul:
        return invertSingleOccurrence(arena, varSide, targetVarIdx, arena.addBinaryExpr(BinOp.Div, valueId, otherSide));

      // f(x) / b = val → f(x) = val * b;  a / f(x) = val → f(x) = a / val
      case BinOp.Div:
      case BinOp.ElemDiv:
        if (varOnLeft) {
          return invertSingleOccurrence(
            arena,
            varSide,
            targetVarIdx,
            arena.addBinaryExpr(BinOp.Mul, valueId, otherSide),
          );
        }
        return invertSingleOccurrence(arena, varSide, targetVarIdx, arena.addBinaryExpr(BinOp.Div, otherSide, valueId));

      // f(x) ^ n = val → f(x) = val ^ (1/n) (constant exponent only)
      case BinOp.Pow:
      case BinOp.ElemPow:
        if (varOnLeft) {
          // Check if exponent is a constant
          const expKind = arena.getExprKind(otherSide);
          if (expKind === ExprKind.RealLiteral || expKind === ExprKind.IntLiteral) {
            const invExp = arena.addBinaryExpr(BinOp.Div, arena.addRealLiteral(1), otherSide);
            return invertSingleOccurrence(
              arena,
              varSide,
              targetVarIdx,
              arena.addBinaryExpr(BinOp.Pow, valueId, invExp),
            );
          }
        } else {
          // b ^ f(x) = val → f(x) = log(val) / log(b)
          const logVal = arena.addCallExpr("log", [valueId]);
          const logBase = arena.addCallExpr("log", [otherSide]);
          return invertSingleOccurrence(arena, varSide, targetVarIdx, arena.addBinaryExpr(BinOp.Div, logVal, logBase));
        }
        return -1;

      default:
        return -1;
    }
  }

  // Function calls: f(g(x)) = val → g(x) = f⁻¹(val)
  if (kind === ExprKind.Call) {
    const argCount = arena.getExprRight(exprId);
    if (argCount !== 1) return -1; // Only invert single-arg functions

    const argId = arena.getExprLeft(exprId);
    if (!containsVar(arena, argId, targetVarIdx)) return -1;

    const funcNameId = arena.getExprData1(exprId);
    const funcName = arena.interner.resolve(funcNameId) ?? "";
    const inverseValueId = getInverseFunctionArena(arena, funcName, valueId);
    if (inverseValueId === -1) return -1;

    return invertSingleOccurrence(arena, argId, targetVarIdx, inverseValueId);
  }

  return -1;
}

/**
 * Get the inverse function expression for common math functions.
 * @returns ExprId of f⁻¹(value), or -1 if unknown.
 */
function getInverseFunctionArena(arena: ArenaDAEBuilder, funcName: string, valueId: number): number {
  switch (funcName) {
    case "sin":
    case "Modelica.Math.sin":
      return arena.addCallExpr("asin", [valueId]);
    case "cos":
    case "Modelica.Math.cos":
      return arena.addCallExpr("acos", [valueId]);
    case "tan":
    case "Modelica.Math.tan":
      return arena.addCallExpr("atan", [valueId]);
    case "asin":
    case "Modelica.Math.asin":
      return arena.addCallExpr("sin", [valueId]);
    case "acos":
    case "Modelica.Math.acos":
      return arena.addCallExpr("cos", [valueId]);
    case "atan":
    case "Modelica.Math.atan":
      return arena.addCallExpr("tan", [valueId]);
    case "exp":
    case "Modelica.Math.exp":
      return arena.addCallExpr("log", [valueId]);
    case "log":
    case "Modelica.Math.log":
      return arena.addCallExpr("exp", [valueId]);
    case "sqrt":
      return arena.addBinaryExpr(BinOp.Mul, valueId, valueId);
    case "sinh":
    case "Modelica.Math.sinh": {
      // sinh(u)=v → u = log(v + sqrt(v²+1))
      const vSq = arena.addBinaryExpr(BinOp.Mul, valueId, valueId);
      const vSqP1 = arena.addBinaryExpr(BinOp.Add, vSq, arena.addRealLiteral(1));
      const sqrtTerm = arena.addCallExpr("sqrt", [vSqP1]);
      return arena.addCallExpr("log", [arena.addBinaryExpr(BinOp.Add, valueId, sqrtTerm)]);
    }
    case "cosh":
    case "Modelica.Math.cosh": {
      // cosh(u)=v → u = log(v + sqrt(v²-1))
      const vSq = arena.addBinaryExpr(BinOp.Mul, valueId, valueId);
      const vSqM1 = arena.addBinaryExpr(BinOp.Sub, vSq, arena.addRealLiteral(1));
      const sqrtTerm = arena.addCallExpr("sqrt", [vSqM1]);
      return arena.addCallExpr("log", [arena.addBinaryExpr(BinOp.Add, valueId, sqrtTerm)]);
    }
    case "tanh":
    case "Modelica.Math.tanh": {
      // tanh(u)=v → u = 0.5 * log((1+v)/(1-v))
      const one = arena.addRealLiteral(1);
      const num = arena.addBinaryExpr(BinOp.Add, one, valueId);
      const den = arena.addBinaryExpr(BinOp.Sub, arena.addRealLiteral(1), valueId);
      const ratio = arena.addBinaryExpr(BinOp.Div, num, den);
      const logTerm = arena.addCallExpr("log", [ratio]);
      return arena.addBinaryExpr(BinOp.Mul, arena.addRealLiteral(0.5), logTerm);
    }
    default:
      return -1;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Gröbner Loop Optimization & Polynomial Converters
// ─────────────────────────────────────────────────────────────────────

/**
 * Parses an arena expression into a Polynomial over ring variables.
 * Returns null if the expression contains non-polynomial terms.
 */
export function arenaExprToPolynomial(arena: ArenaDAEBuilder, exprId: number, vars: string[]): Polynomial | null {
  if (exprId < 0) return null;
  const kind = arena.getExprKind(exprId);

  switch (kind) {
    case ExprKind.RealLiteral: {
      const val = arena.getExprRealValue(exprId);
      return new Polynomial([new Term(val, new Map())], vars);
    }
    case ExprKind.IntLiteral: {
      const val = arena.getExprData1(exprId);
      return new Polynomial([new Term(val, new Map())], vars);
    }
    case ExprKind.BoolLiteral: {
      const val = arena.getExprData1(exprId) !== 0 ? 1 : 0;
      return new Polynomial([new Term(val, new Map())], vars);
    }
    case ExprKind.Name: {
      const nameId = arena.getExprData1(exprId);
      const name = arena.interner.resolve(nameId);
      if (!name) return null;
      if (!vars.includes(name)) return null;
      return new Polynomial([new Term(1, new Map([[name, 1]]))], vars);
    }
    case ExprKind.Negate: {
      const childId = arena.getExprLeft(exprId) >= 0 ? arena.getExprLeft(exprId) : arena.getExprData1(exprId);
      const childPoly = arenaExprToPolynomial(arena, childId, vars);
      if (!childPoly) return null;
      return childPoly.multiplyTerm(new Term(-1, new Map()));
    }
    case ExprKind.Unary: {
      const op = arena.getExprData1(exprId) as UnaryOp;
      const childId = arena.getExprLeft(exprId);
      if (op === UnaryOp.Negate) {
        const childPoly = arenaExprToPolynomial(arena, childId, vars);
        if (!childPoly) return null;
        return childPoly.multiplyTerm(new Term(-1, new Map()));
      }
      return null;
    }
    case ExprKind.Binary: {
      const op = arena.getExprData1(exprId) as BinOp;
      const leftId = arena.getExprLeft(exprId);
      const rightId = arena.getExprRight(exprId);

      const leftPoly = arenaExprToPolynomial(arena, leftId, vars);
      if (!leftPoly) return null;
      const rightPoly = arenaExprToPolynomial(arena, rightId, vars);

      if (op === BinOp.Add || op === BinOp.ElemAdd) {
        if (!rightPoly) return null;
        return leftPoly.add(rightPoly);
      }
      if (op === BinOp.Sub || op === BinOp.ElemSub) {
        if (!rightPoly) return null;
        return leftPoly.sub(rightPoly);
      }
      if (op === BinOp.Mul || op === BinOp.ElemMul) {
        if (!rightPoly) return null;
        const terms: Term[] = [];
        for (const ta of leftPoly.terms) {
          for (const tb of rightPoly.terms) {
            terms.push(ta.multiply(tb));
          }
        }
        return new Polynomial(terms, vars);
      }
      if (op === BinOp.Div || op === BinOp.ElemDiv) {
        if (rightPoly && rightPoly.terms.length === 1 && rightPoly.terms[0]?.totalDegree() === 0) {
          const coeff = rightPoly.terms[0].coefficient;
          if (Math.abs(coeff) > 1e-30) {
            return leftPoly.multiplyTerm(new Term(1 / coeff, new Map()));
          }
        }
        return null;
      }
      if (op === BinOp.Pow || op === BinOp.ElemPow) {
        if (rightPoly && rightPoly.terms.length === 1 && rightPoly.terms[0]?.totalDegree() === 0) {
          const exp = rightPoly.terms[0].coefficient;
          if (Number.isInteger(exp) && exp >= 0) {
            if (exp === 0) {
              return new Polynomial([new Term(1, new Map())], vars);
            }
            let res = leftPoly;
            for (let i = 1; i < exp; i++) {
              const terms: Term[] = [];
              for (const ta of res.terms) {
                for (const tb of leftPoly.terms) {
                  terms.push(ta.multiply(tb));
                }
              }
              res = new Polynomial(terms, vars);
            }
            return res;
          }
        }
        return null;
      }
      return null;
    }
    default:
      return null;
  }
}

/**
 * Converts a Polynomial back into an arena expression.
 */
export function polynomialToArenaExpr(arena: ArenaDAEBuilder, poly: Polynomial): number {
  if (poly.isZero()) {
    return arena.addRealLiteral(0);
  }

  let totalExprId = -1;

  for (const term of poly.terms) {
    let termExprId = -1;

    // Build variables product
    for (const [varName, deg] of term.degrees.entries()) {
      if (deg <= 0) continue;
      let varExprId = arena.addNameExpr(varName);
      if (deg > 1) {
        varExprId = arena.addBinaryExpr(BinOp.Pow, varExprId, arena.addIntLiteral(deg));
      }

      if (termExprId === -1) {
        termExprId = varExprId;
      } else {
        termExprId = arena.addBinaryExpr(BinOp.Mul, termExprId, varExprId);
      }
    }

    // Multiply by coefficient
    if (termExprId === -1) {
      termExprId = arena.addRealLiteral(term.coefficient);
    } else if (Math.abs(term.coefficient - 1) > 1e-12) {
      if (Math.abs(term.coefficient + 1) < 1e-12) {
        termExprId = arena.addUnaryExpr(UnaryOp.Negate, termExprId);
      } else {
        termExprId = arena.addBinaryExpr(BinOp.Mul, arena.addRealLiteral(term.coefficient), termExprId);
      }
    }

    // Add to total expression
    if (totalExprId === -1) {
      totalExprId = termExprId;
    } else {
      totalExprId = arena.addBinaryExpr(BinOp.Add, totalExprId, termExprId);
    }
  }

  return totalExprId === -1 ? arena.addRealLiteral(0) : totalExprId;
}

function getLoopVarsInPoly(poly: Polynomial, loopVarNames: string[]): string[] {
  const found = new Set<string>();
  for (const term of poly.terms) {
    for (const v of term.degrees.keys()) {
      if (loopVarNames.includes(v)) {
        found.add(v);
      }
    }
  }
  return Array.from(found);
}

function autoreduceBasis(basis: Polynomial[]): Polynomial[] {
  const monicBasis = basis.map((p) => {
    const lt = p.LT();
    if (!lt || Math.abs(lt.coefficient) < 1e-12) return p;
    const coeff = lt.coefficient;
    return p.multiplyTerm(new Term(1 / coeff, new Map()));
  });

  // 1. Minimalization: filter out elements whose leading term is divisible by the leading term of another element
  const minimalBasis: Polynomial[] = [];
  for (let i = 0; i < monicBasis.length; i++) {
    const p = monicBasis[i];
    if (!p || p.isZero()) continue;
    const lt_p = p.LT();
    if (!lt_p) continue;

    let divisible = false;
    for (let j = 0; j < monicBasis.length; j++) {
      if (i === j) continue;
      const q = monicBasis[j];
      if (!q || q.isZero()) continue;
      const lt_q = q.LT();
      if (!lt_q) continue;

      if (lt_q.divides(lt_p)) {
        if (lt_p.matchesMonomial(lt_q) && i < j) {
          // Keep the one with smaller index to break ties
          continue;
        }
        divisible = true;
        break;
      }
    }
    if (!divisible) {
      minimalBasis.push(p);
    }
  }

  // 2. Reduction: reduce each element modulo all other elements
  const reduced: Polynomial[] = [];
  for (let i = 0; i < minimalBasis.length; i++) {
    const p = minimalBasis[i];
    if (!p) continue;
    const others = minimalBasis.filter((_, idx) => idx !== i);
    const { remainder } = p.divide(others);

    const lt = remainder.LT();
    if (lt && Math.abs(lt.coefficient) > 1e-12) {
      reduced.push(remainder.multiplyTerm(new Term(1 / lt.coefficient, new Map())));
    }
  }

  return reduced;
}

/**
 * Attempts to triangularize / optimize an algebraic loop using Gröbner Bases.
 * Returns a list of sequential execution blocks if successful, or null on failure.
 */
export function tryOptimizeLoopWithGroebner(
  arena: ArenaDAEBuilder,
  eqIdxs: number[],
  vars: number[],
): ArenaExecutionBlock[] | null {
  const loopVars = new Set<number>(vars);
  const allDeps = new Set<number>();
  for (const eqIdx of eqIdxs) {
    collectArenaExprDeps(arena, arena.getEqLhs(eqIdx), allDeps, true);
    collectArenaExprDeps(arena, arena.getEqRhs(eqIdx), allDeps, true);
  }

  const loopVarIdxs = vars;
  const paramVarIdxs: number[] = [];
  for (const d of allDeps) {
    if (!loopVars.has(d)) {
      paramVarIdxs.push(d);
    }
  }

  const loopVarNames = loopVarIdxs.map((v) => arena.getVarName(v));
  const paramVarNames = paramVarIdxs.map((v) => arena.getVarName(v));

  const ringVars = [...loopVarNames, ...paramVarNames];

  const polys: Polynomial[] = [];
  for (const eqIdx of eqIdxs) {
    const lhsId = arena.getEqLhs(eqIdx);
    const rhsId = arena.getEqRhs(eqIdx);

    const lhsPoly = arenaExprToPolynomial(arena, lhsId, ringVars);
    if (!lhsPoly) return null;

    const rhsPoly = arenaExprToPolynomial(arena, rhsId, ringVars);
    if (!rhsPoly) return null;

    polys.push(lhsPoly.sub(rhsPoly));
  }

  let basis: Polynomial[];
  try {
    basis = computeGroebnerBasis(polys, ringVars);
  } catch {
    return null;
  }

  basis = autoreduceBasis(basis).filter((p) => !p.isZero());

  const unsolvedVars = [...loopVarIdxs];
  const remainingPolys = [...basis];
  const blocks: ArenaExecutionBlock[] = [];

  while (unsolvedVars.length > 0) {
    let foundStep = false;

    for (let i = 0; i < remainingPolys.length; i++) {
      const p = remainingPolys[i];
      if (!p) continue;
      const loopVarsInPoly = getLoopVarsInPoly(p, loopVarNames);

      const unsolvedInPoly = loopVarsInPoly.filter((vName) => {
        const vIdx = arena.getVarIdxByName(vName);
        return unsolvedVars.includes(vIdx);
      });

      if (unsolvedInPoly.length === 1) {
        const targetVarName = unsolvedInPoly[0];
        if (targetVarName === undefined) continue;
        const targetVarIdx = arena.getVarIdxByName(targetVarName);

        remainingPolys.splice(i, 1);
        const idxInUnsolved = unsolvedVars.indexOf(targetVarIdx);
        if (idxInUnsolved !== -1) {
          unsolvedVars.splice(idxInUnsolved, 1);
        }

        const pExprId = polynomialToArenaExpr(arena, p);
        const zeroId = arena.addRealLiteral(0);
        const eqIdx = arena.addEquation(EqKind.Simple, pExprId, zeroId);

        const isolatedExprId = isolateSymbolicallyArena(arena, eqIdx, targetVarIdx);
        if (isolatedExprId !== -1) {
          blocks.push({ type: "single", varIdx: targetVarIdx, exprId: isolatedExprId });
        } else {
          blocks.push({ type: "system", eqIdxs: [eqIdx], vars: [targetVarIdx] });
        }

        foundStep = true;
        break;
      }
    }

    if (!foundStep) {
      const eqIdxs: number[] = [];
      for (const p of remainingPolys) {
        const pExprId = polynomialToArenaExpr(arena, p);
        const zeroId = arena.addRealLiteral(0);
        const eqIdx = arena.addEquation(EqKind.Simple, pExprId, zeroId);
        eqIdxs.push(eqIdx);
      }

      blocks.push({ type: "system", eqIdxs, vars: [...unsolvedVars] });
      break;
    }
  }

  return blocks;
}

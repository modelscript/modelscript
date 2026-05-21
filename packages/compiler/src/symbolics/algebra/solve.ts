// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Arena-native symbolic equation solver.
 *
 * Solves single-variable polynomial equations up to degree 4 using
 * analytical formulas (quadratic, Cardano's cubic, Ferrari's quartic).
 *
 * All operations work on ArenaDAEBuilder expression IDs (numbers),
 * not on the legacy ModelicaExpression AST objects.
 */

import { ArenaDAEBuilder, BinOp, ExprKind, UnaryOp } from "../../dae-arena.js";
import { add, call, div, mul, negate, simplifyArenaExpr, sub, ZERO } from "../calculus/derivative.js";
import { egraphSimplify } from "../simplify/egraph.js";

// ─────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────

/**
 * Solve `exprId = 0` for the variable named `varName`.
 *
 * Returns an array of solution expression IDs (may be empty if no
 * closed-form solution is found). Each solution is an expression for varName.
 *
 * Tries polynomial solving (degree 1–4) first.
 *
 * @param arena  The ArenaDAEBuilder containing the expression.
 * @param exprId The expression ID representing the equation LHS (= 0).
 * @param varName The variable name to solve for.
 * @returns Array of expression IDs representing solutions.
 */
export function solveForVariableArena(arena: ArenaDAEBuilder, exprId: number, varName: string): number[] {
  const terms = collectArenaTerms(arena, exprId, varName);
  const maxDegree = Math.max(0, ...terms.keys());

  switch (maxDegree) {
    case 0:
      return []; // No variable — can't solve
    case 1:
      return solveLinear(arena, terms);
    case 2:
      return solveQuadratic(arena, terms);
    case 3:
      return solveCubic(arena, terms);
    case 4:
      return solveQuartic(arena, terms);
    default:
      return []; // Degree too high for closed-form
  }
}

// ─────────────────────────────────────────────────────────────────────
// Term Collection (arena-native expandExpr + collectTerms)
// ─────────────────────────────────────────────────────────────────────

/**
 * Collect polynomial terms by power of `varName` from an arena expression.
 *
 * Returns a map from degree → coefficient expression ID.
 * E.g. for `3*x^2 + 2*x + 1`: Map { 2 → id(3), 1 → id(2), 0 → id(1) }
 */
export function collectArenaTerms(arena: ArenaDAEBuilder, exprId: number, varName: string): Map<number, number> {
  const terms = new Map<number, number>();

  function addTerm(degree: number, coeff: number): void {
    const existing = terms.get(degree);
    if (existing !== undefined) {
      terms.set(degree, add(arena, existing, coeff));
    } else {
      terms.set(degree, coeff);
    }
  }

  function collect(eId: number): void {
    const kind = arena.getExprKind(eId);

    // Addition: collect each side
    if (kind === ExprKind.Binary) {
      const op = arena.getExprData1(eId) as BinOp;
      const left = arena.getExprLeft(eId);
      const right = arena.getExprRight(eId);

      if (op === BinOp.Add || op === BinOp.ElemAdd) {
        collect(left);
        collect(right);
        return;
      }

      if (op === BinOp.Sub || op === BinOp.ElemSub) {
        collect(left);
        collectNegated(right);
        return;
      }
    }

    // Negation: collect inner negated
    if (kind === ExprKind.Negate || (kind === ExprKind.Unary && arena.getExprData1(eId) === UnaryOp.Negate)) {
      collectNegated(arena.getExprLeft(eId));
      return;
    }

    // Extract degree and coefficient for this atomic term
    const { degree, coeff } = extractDegreeAndCoeff(arena, eId, varName);
    addTerm(degree, coeff);
  }

  function collectNegated(eId: number): void {
    const kind = arena.getExprKind(eId);

    if (kind === ExprKind.Binary) {
      const op = arena.getExprData1(eId) as BinOp;
      const left = arena.getExprLeft(eId);
      const right = arena.getExprRight(eId);

      if (op === BinOp.Add || op === BinOp.ElemAdd) {
        collectNegated(left);
        collectNegated(right);
        return;
      }

      if (op === BinOp.Sub || op === BinOp.ElemSub) {
        collectNegated(left);
        collect(right);
        return;
      }
    }

    if (kind === ExprKind.Negate || (kind === ExprKind.Unary && arena.getExprData1(eId) === UnaryOp.Negate)) {
      collect(arena.getExprLeft(eId));
      return;
    }

    const { degree, coeff } = extractDegreeAndCoeff(arena, eId, varName);
    addTerm(degree, negate(arena, coeff));
  }

  collect(exprId);
  return terms;
}

/**
 * Extract the degree and coefficient of a single term with respect to varName.
 */
function extractDegreeAndCoeff(
  arena: ArenaDAEBuilder,
  exprId: number,
  varName: string,
): { degree: number; coeff: number } {
  const kind = arena.getExprKind(exprId);

  // Variable itself: degree 1, coefficient 1
  if (kind === ExprKind.Name) {
    const name = arena.interner.resolve(arena.getExprData1(exprId));
    if (name === varName) {
      return { degree: 1, coeff: arena.addRealLiteral(1.0) };
    }
    // Other variable or constant: degree 0
    return { degree: 0, coeff: exprId };
  }

  // Literals: degree 0
  if (
    kind === ExprKind.RealLiteral ||
    kind === ExprKind.IntLiteral ||
    kind === ExprKind.BoolLiteral ||
    kind === ExprKind.StringLiteral ||
    kind === ExprKind.EnumLiteral
  ) {
    return { degree: 0, coeff: exprId };
  }

  // Doesn't contain the variable: degree 0
  if (!containsVar(arena, exprId, varName)) {
    return { degree: 0, coeff: exprId };
  }

  if (kind === ExprKind.Binary) {
    const op = arena.getExprData1(exprId) as BinOp;
    const left = arena.getExprLeft(exprId);
    const right = arena.getExprRight(exprId);

    // x^n
    if (op === BinOp.Pow || op === BinOp.ElemPow) {
      if (arena.getExprKind(left) === ExprKind.Name) {
        const name = arena.interner.resolve(arena.getExprData1(left));
        if (name === varName) {
          const n = getArenaLiteralValue(arena, right);
          if (n !== null && Number.isInteger(n)) {
            return { degree: n, coeff: arena.addRealLiteral(1.0) };
          }
        }
      }
    }

    // a * b: split based on which side contains the variable
    if (op === BinOp.Mul || op === BinOp.ElemMul) {
      const leftHasVar = containsVar(arena, left, varName);
      const rightHasVar = containsVar(arena, right, varName);

      if (leftHasVar && !rightHasVar) {
        const inner = extractDegreeAndCoeff(arena, left, varName);
        return { degree: inner.degree, coeff: mul(arena, inner.coeff, right) };
      }
      if (!leftHasVar && rightHasVar) {
        const inner = extractDegreeAndCoeff(arena, right, varName);
        return { degree: inner.degree, coeff: mul(arena, left, inner.coeff) };
      }
      // Both sides contain the variable — multiply degrees
      if (leftHasVar && rightHasVar) {
        const leftDC = extractDegreeAndCoeff(arena, left, varName);
        const rightDC = extractDegreeAndCoeff(arena, right, varName);
        return {
          degree: leftDC.degree + rightDC.degree,
          coeff: mul(arena, leftDC.coeff, rightDC.coeff),
        };
      }
    }
  }

  // Negation
  if (kind === ExprKind.Negate || (kind === ExprKind.Unary && arena.getExprData1(exprId) === UnaryOp.Negate)) {
    const inner = extractDegreeAndCoeff(arena, arena.getExprLeft(exprId), varName);
    return {
      degree: inner.degree,
      coeff: negate(arena, inner.coeff),
    };
  }

  // Default fallback: treat as opaque degree 0 (safe but conservative)
  return { degree: 0, coeff: exprId };
}

/**
 * Check if an arena expression contains a reference to a variable by name.
 */
function containsVar(arena: ArenaDAEBuilder, exprId: number, varName: string): boolean {
  if (exprId < 0) return false;
  const kind = arena.getExprKind(exprId);

  if (kind === ExprKind.Name) {
    return arena.interner.resolve(arena.getExprData1(exprId)) === varName;
  }
  if (
    kind === ExprKind.RealLiteral ||
    kind === ExprKind.IntLiteral ||
    kind === ExprKind.BoolLiteral ||
    kind === ExprKind.StringLiteral ||
    kind === ExprKind.EnumLiteral
  ) {
    return false;
  }
  if (kind === ExprKind.Negate || kind === ExprKind.Unary) {
    return containsVar(arena, arena.getExprLeft(exprId), varName);
  }
  if (kind === ExprKind.Binary) {
    return (
      containsVar(arena, arena.getExprLeft(exprId), varName) || containsVar(arena, arena.getExprRight(exprId), varName)
    );
  }
  if (kind === ExprKind.Call) {
    const argCount = arena.getExprRight(exprId);
    const firstArg = arena.getExprLeft(exprId);
    if (argCount > 0 && containsVar(arena, firstArg, varName)) return true;
    for (let i = 1; i < argCount; i++) {
      if (containsVar(arena, arena.getExprLeft(exprId + i), varName)) return true;
    }
    return false;
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────
// Numeric Literal Extraction
// ─────────────────────────────────────────────────────────────────────

/**
 * Extract a numeric value from an arena literal expression.
 * Handles negation of literals: -(5.0) → -5.0
 * Returns null if the expression is not a (possibly negated) numeric literal.
 */
export function getArenaLiteralValue(arena: ArenaDAEBuilder, exprId: number): number | null {
  if (exprId < 0) return null;
  const kind = arena.getExprKind(exprId);
  if (kind === ExprKind.RealLiteral) return arena.getExprRealValue(exprId);
  if (kind === ExprKind.IntLiteral) return arena.getExprData1(exprId);
  if (kind === ExprKind.Negate || (kind === ExprKind.Unary && arena.getExprData1(exprId) === UnaryOp.Negate)) {
    const inner = getArenaLiteralValue(arena, arena.getExprLeft(exprId));
    return inner !== null ? -inner : null;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────
// Linear: ax + b = 0 → x = -b/a
// ─────────────────────────────────────────────────────────────────────

function solveLinear(arena: ArenaDAEBuilder, terms: Map<number, number>): number[] {
  const a = terms.get(1);
  const b = terms.get(0) ?? ZERO(arena);
  if (a === undefined) return [];

  // Try numeric evaluation first
  const aS = simplifyArenaExpr(arena, a);
  const bS = simplifyArenaExpr(arena, b);
  const aVal = getArenaLiteralValue(arena, aS);
  const bVal = getArenaLiteralValue(arena, bS);
  if (aVal !== null && bVal !== null && aVal !== 0) {
    return [arena.addRealLiteral(-bVal / aVal)];
  }

  // x = -b/a
  const solution = egraphSimplify(arena, div(arena, negate(arena, bS), aS));
  return [solution];
}

// ─────────────────────────────────────────────────────────────────────
// Quadratic: ax² + bx + c = 0 → x = (-b ± √(b²-4ac)) / 2a
// ─────────────────────────────────────────────────────────────────────

function solveQuadratic(arena: ArenaDAEBuilder, terms: Map<number, number>): number[] {
  const a = terms.get(2);
  const b = terms.get(1) ?? ZERO(arena);
  const c = terms.get(0) ?? ZERO(arena);
  if (a === undefined) return solveLinear(arena, terms);

  // Simplify coefficients and try numeric evaluation for cleaner results
  const aVal = getArenaLiteralValue(arena, simplifyArenaExpr(arena, a));
  const bVal = getArenaLiteralValue(arena, simplifyArenaExpr(arena, b));
  const cVal = getArenaLiteralValue(arena, simplifyArenaExpr(arena, c));

  if (aVal !== null && bVal !== null && cVal !== null) {
    const disc = bVal * bVal - 4 * aVal * cVal;
    if (disc < 0) return []; // Complex roots
    const sqrtD = Math.sqrt(disc);
    const r1 = (-bVal + sqrtD) / (2 * aVal);
    const r2 = (-bVal - sqrtD) / (2 * aVal);
    const solutions = [arena.addRealLiteral(r1)];
    if (Math.abs(r1 - r2) > 1e-12) {
      solutions.push(arena.addRealLiteral(r2));
    }
    return solutions;
  }

  // Symbolic: (-b ± sqrt(b²-4ac)) / (2a)
  const four = arena.addRealLiteral(4.0);
  const two = arena.addRealLiteral(2.0);
  const disc = sub(arena, mul(arena, b, b), mul(arena, four, mul(arena, a, c)));
  const sqrtD = call(arena, "sqrt", [disc]);
  const twoA = mul(arena, two, a);
  const negB = negate(arena, b);

  return [
    egraphSimplify(arena, div(arena, add(arena, negB, sqrtD), twoA)),
    egraphSimplify(arena, div(arena, sub(arena, negB, sqrtD), twoA)),
  ];
}

// ─────────────────────────────────────────────────────────────────────
// Cubic: ax³ + bx² + cx + d = 0 (Cardano's formula)
// ─────────────────────────────────────────────────────────────────────

function solveCubic(arena: ArenaDAEBuilder, terms: Map<number, number>): number[] {
  const a = terms.get(3);
  const b = terms.get(2) ?? ZERO(arena);
  const c = terms.get(1) ?? ZERO(arena);
  const d = terms.get(0) ?? ZERO(arena);
  if (a === undefined) return solveQuadratic(arena, terms);

  // Simplify and try numeric evaluation
  const aVal = getArenaLiteralValue(arena, simplifyArenaExpr(arena, a));
  const bVal = getArenaLiteralValue(arena, simplifyArenaExpr(arena, b));
  const cVal = getArenaLiteralValue(arena, simplifyArenaExpr(arena, c));
  const dVal = getArenaLiteralValue(arena, simplifyArenaExpr(arena, d));

  if (aVal !== null && bVal !== null && cVal !== null && dVal !== null && aVal !== 0) {
    const roots = solveCubicNumeric(aVal, bVal, cVal, dVal);
    return roots.map((r) => arena.addRealLiteral(r));
  }

  // Symbolic cubic is very complex; return empty for non-numeric
  return [];
}

/**
 * Solve ax³ + bx² + cx + d = 0 numerically using Cardano's method.
 */
function solveCubicNumeric(a: number, b: number, c: number, d: number): number[] {
  // Normalize: x³ + px + q = 0 via substitution x = t - b/(3a)
  const p0 = b / a;
  const p1 = c / a;
  const p2 = d / a;

  const p = p1 - (p0 * p0) / 3;
  const q = p2 - (p0 * p1) / 3 + (2 * p0 * p0 * p0) / 27;

  const disc = (q * q) / 4 + (p * p * p) / 27;

  const shift = -p0 / 3;

  if (disc > 1e-12) {
    // One real root
    const sqrtD = Math.sqrt(disc);
    const u = Math.cbrt(-q / 2 + sqrtD);
    const v = Math.cbrt(-q / 2 - sqrtD);
    return [u + v + shift];
  } else if (disc < -1e-12) {
    // Three real roots (casus irreducibilis)
    const r = Math.sqrt((-p * p * p) / 27);
    const theta = Math.acos(-q / 2 / r);
    const m = 2 * Math.cbrt(r);
    return [
      m * Math.cos(theta / 3) + shift,
      m * Math.cos((theta + 2 * Math.PI) / 3) + shift,
      m * Math.cos((theta + 4 * Math.PI) / 3) + shift,
    ];
  } else {
    // Repeated root
    const u = Math.cbrt(-q / 2);
    return [2 * u + shift, -u + shift];
  }
}

// ─────────────────────────────────────────────────────────────────────
// Quartic: ax⁴ + bx³ + cx² + dx + e = 0 (Ferrari's method)
// ─────────────────────────────────────────────────────────────────────

function solveQuartic(arena: ArenaDAEBuilder, terms: Map<number, number>): number[] {
  const a = terms.get(4);
  const b = terms.get(3) ?? ZERO(arena);
  const c = terms.get(2) ?? ZERO(arena);
  const d = terms.get(1) ?? ZERO(arena);
  const e = terms.get(0) ?? ZERO(arena);
  if (a === undefined) return solveCubic(arena, terms);

  const aVal = getArenaLiteralValue(arena, simplifyArenaExpr(arena, a));
  const bVal = getArenaLiteralValue(arena, simplifyArenaExpr(arena, b));
  const cVal = getArenaLiteralValue(arena, simplifyArenaExpr(arena, c));
  const dVal = getArenaLiteralValue(arena, simplifyArenaExpr(arena, d));
  const eVal = getArenaLiteralValue(arena, simplifyArenaExpr(arena, e));

  if (aVal !== null && bVal !== null && cVal !== null && dVal !== null && eVal !== null && aVal !== 0) {
    const roots = solveQuarticNumeric(aVal, bVal, cVal, dVal, eVal);
    return roots.map((r) => arena.addRealLiteral(r));
  }

  return [];
}

/**
 * Solve ax⁴ + bx³ + cx² + dx + e = 0 numerically using Ferrari's method.
 */
function solveQuarticNumeric(a: number, b: number, c: number, d: number, e: number): number[] {
  // Normalize: x⁴ + px³ + qx² + rx + s = 0
  const p = b / a;
  const q = c / a;
  const r = d / a;
  const s = e / a;

  // Depressed quartic via x = t - p/4: t⁴ + αt² + βt + γ = 0
  const alpha = q - (3 * p * p) / 8;
  const beta = r - (p * q) / 2 + (p * p * p) / 8;
  const gamma = s - (p * r) / 4 + (p * p * q) / 16 - (3 * p * p * p * p) / 256;

  const shift = -p / 4;

  if (Math.abs(beta) < 1e-12) {
    // Biquadratic: t⁴ + αt² + γ = 0
    const disc = alpha * alpha - 4 * gamma;
    if (disc < 0) return [];
    const sqrtD = Math.sqrt(disc);
    const u1 = (-alpha + sqrtD) / 2;
    const u2 = (-alpha - sqrtD) / 2;
    const roots: number[] = [];
    if (u1 >= 0) {
      roots.push(Math.sqrt(u1) + shift, -Math.sqrt(u1) + shift);
    }
    if (u2 >= 0 && Math.abs(u1 - u2) > 1e-12) {
      roots.push(Math.sqrt(u2) + shift, -Math.sqrt(u2) + shift);
    }
    return roots;
  }

  // Solve resolvent cubic: 8y³ + (−4α)y² + (−8γ)y + (4αγ − β²) = 0
  const cubicRoots = solveCubicNumeric(8, -4 * alpha, -8 * gamma, 4 * alpha * gamma - beta * beta);
  if (cubicRoots.length === 0) return [];

  // Pick a root y such that 2y - α > 0
  let y: number | null = null;
  for (const root of cubicRoots) {
    if (2 * root - alpha > 1e-12) {
      y = root;
      break;
    }
  }
  if (y === null) return [];

  const sqrtM = Math.sqrt(2 * y - alpha);
  const roots: number[] = [];

  // Two quadratics: t² ± sqrtM·t + (y ∓ β/(2·sqrtM)) = 0
  const disc1 = -(2 * y + alpha) + beta / sqrtM;
  const disc2 = -(2 * y + alpha) - beta / sqrtM;

  if (disc1 >= 0) {
    const s1 = Math.sqrt(disc1);
    roots.push((sqrtM + s1) / 2 + shift, (sqrtM - s1) / 2 + shift);
  }
  if (disc2 >= 0) {
    const s2 = Math.sqrt(disc2);
    roots.push((-sqrtM + s2) / 2 + shift, (-sqrtM - s2) / 2 + shift);
  }

  return roots;
}

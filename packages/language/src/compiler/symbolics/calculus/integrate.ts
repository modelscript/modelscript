// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Symbolic integration (anti-differentiation) engine on the Arena DAE representation.
 *
 * Provides pattern-matching-based symbolic integration, Taylor series
 * expansion, and basic limit evaluation.
 */

import { evaluateArenaExpression } from "../../arena-eval.js";
import { ArenaDAEBuilder, BinOp, ExprKind, UnaryOp } from "../../dae-arena.js";
import {
  add,
  call,
  differentiateArenaExpr,
  div,
  isOne,
  mul,
  negate,
  ONE,
  pow,
  simplifyArenaExpr,
  sub,
  ZERO,
} from "./derivative.js";

function getSequenceElements(
  arena: ArenaDAEBuilder,
  baseExprId: number,
  count: number,
  firstElement: number,
): number[] {
  if (count <= 0) return [];
  const elements = [firstElement];
  for (let i = 1; i < count; i++) {
    const tupleId = baseExprId + i;
    elements.push(arena.getExprLeft(tupleId));
  }
  return elements;
}

function varRef(arena: ArenaDAEBuilder, name: string): number {
  return arena.addNameExpr(name);
}

function lit(arena: ArenaDAEBuilder, n: number): number {
  return arena.addRealLiteral(n);
}

/**
 * Symbolically integrate an expression in the arena with respect to a variable.
 */
export function integrateArenaExpr(arena: ArenaDAEBuilder, exprId: number, varName: string): number | null {
  const kind = arena.getExprKind(exprId);

  // ── Constants: ∫c dx = cx ──
  if (kind === ExprKind.RealLiteral || kind === ExprKind.IntLiteral) {
    return mul(arena, exprId, varRef(arena, varName));
  }

  if (kind === ExprKind.Name) {
    const name = arena.interner.resolve(arena.getExprData1(exprId));
    if (name === varName) {
      // ∫x dx = x²/2
      return div(arena, pow(arena, varRef(arena, varName), lit(arena, 2)), lit(arena, 2));
    }
    // ∫c dx = cx
    return mul(arena, exprId, varRef(arena, varName));
  }

  // ── Unary negation: ∫(-f) = -∫f ──
  if (kind === ExprKind.Negate || (kind === ExprKind.Unary && arena.getExprData1(exprId) === UnaryOp.Negate)) {
    const operand = arena.getExprLeft(exprId);
    const inner = integrateArenaExpr(arena, operand, varName);
    if (inner === null) return null;
    return negate(arena, inner);
  }

  // ── Binary expressions ──
  if (kind === ExprKind.Binary) {
    return integrateBinary(arena, exprId, varName);
  }

  // ── Function calls ──
  if (kind === ExprKind.Call) {
    return integrateFunctionCall(arena, exprId, varName);
  }

  return null;
}

/**
 * Compute the Taylor series expansion of an expression around a point in the arena.
 */
export function taylorSeriesArena(
  arena: ArenaDAEBuilder,
  exprId: number,
  varName: string,
  point: number,
  order: number,
): number {
  const x = varRef(arena, varName);
  const a = lit(arena, point);
  let result: number = ZERO(arena);
  let currentExpr = exprId;
  let factorial = 1;

  for (let n = 0; n < order; n++) {
    // Evaluate currentExpr at x = point
    const coeff = evaluateArenaAt(arena, currentExpr, varName, point);
    if (coeff === null) break; // Can't evaluate — stop

    const coeffExpr = lit(arena, coeff / factorial);
    const term = n === 0 ? coeffExpr : mul(arena, coeffExpr, pow(arena, sub(arena, x, a), lit(arena, n)));
    result = add(arena, result, term);

    // Differentiate for next term
    currentExpr = simplifyArenaExpr(arena, differentiateArenaExpr(arena, currentExpr, varName));
    factorial *= n + 1;
  }

  return simplifyArenaExpr(arena, result);
}

/**
 * Evaluate a basic limit of expr as varName → point in the arena.
 */
export function limitArena(
  arena: ArenaDAEBuilder,
  exprId: number,
  varName: string,
  point: number,
  maxIterations = 5,
): number | null {
  // Direct substitution
  const direct = evaluateArenaAt(arena, exprId, varName, point);
  if (direct !== null && Number.isFinite(direct)) return direct;

  // Check for 0/0 (L'Hôpital's rule)
  const kind = arena.getExprKind(exprId);
  if (kind === ExprKind.Binary && arena.getExprData1(exprId) === BinOp.Div) {
    let num = arena.getExprLeft(exprId);
    let den = arena.getExprRight(exprId);

    for (let i = 0; i < maxIterations; i++) {
      const numVal = evaluateArenaAt(arena, num, varName, point);
      const denVal = evaluateArenaAt(arena, den, varName, point);

      if (numVal === null || denVal === null) return null;

      if (Math.abs(denVal) > 1e-12) {
        return numVal / denVal;
      }

      if (Math.abs(numVal) > 1e-12) {
        return null; // c/0 → ±∞
      }

      // 0/0 → apply L'Hôpital
      num = simplifyArenaExpr(arena, differentiateArenaExpr(arena, num, varName));
      den = simplifyArenaExpr(arena, differentiateArenaExpr(arena, den, varName));
    }
  }

  return null;
}

/**
 * Compute the nth derivative of an expression in the arena.
 */
export function nthDerivativeArena(arena: ArenaDAEBuilder, exprId: number, varName: string, n: number): number {
  let result = exprId;
  for (let i = 0; i < n; i++) {
    result = simplifyArenaExpr(arena, differentiateArenaExpr(arena, result, varName));
  }
  return simplifyArenaExpr(arena, result);
}

// ── Binary Integration ──

function integrateBinary(arena: ArenaDAEBuilder, exprId: number, varName: string): number | null {
  const op = arena.getExprData1(exprId) as BinOp;
  const left = arena.getExprLeft(exprId);
  const right = arena.getExprRight(exprId);

  // ── Sum/Difference rule: ∫(f ± g) = ∫f ± ∫g ──
  if (op === BinOp.Add || op === BinOp.ElemAdd) {
    const fInt = integrateArenaExpr(arena, left, varName);
    const gInt = integrateArenaExpr(arena, right, varName);
    if (fInt !== null && gInt !== null) {
      return simplifyArenaExpr(arena, add(arena, fInt, gInt));
    }
    return null;
  }

  if (op === BinOp.Sub || op === BinOp.ElemSub) {
    const fInt = integrateArenaExpr(arena, left, varName);
    const gInt = integrateArenaExpr(arena, right, varName);
    if (fInt !== null && gInt !== null) {
      return simplifyArenaExpr(arena, sub(arena, fInt, gInt));
    }
    return null;
  }

  // ── Constant multiple: ∫(c·f) = c·∫f ──
  if (op === BinOp.Mul || op === BinOp.ElemMul) {
    if (!containsVar(arena, left, varName)) {
      const fInt = integrateArenaExpr(arena, right, varName);
      if (fInt !== null) return simplifyArenaExpr(arena, mul(arena, left, fInt));
    }
    if (!containsVar(arena, right, varName)) {
      const fInt = integrateArenaExpr(arena, left, varName);
      if (fInt !== null) return simplifyArenaExpr(arena, mul(arena, right, fInt));
    }
    return null;
  }

  // ── Division by constant: ∫(f/c) = (1/c)·∫f ──
  if (op === BinOp.Div || op === BinOp.ElemDiv) {
    if (!containsVar(arena, right, varName)) {
      const fInt = integrateArenaExpr(arena, left, varName);
      if (fInt !== null) return simplifyArenaExpr(arena, div(arena, fInt, right));
    }
    // ∫(1/x) = ln|x|
    if (isOne(arena, left) && arena.getExprKind(right) === ExprKind.Name) {
      const name = arena.interner.resolve(arena.getExprData1(right));
      if (name === varName) {
        return call(arena, "log", [call(arena, "abs", [varRef(arena, varName)])]);
      }
    }
    return null;
  }

  // ── Power rule: ∫xⁿ dx = xⁿ⁺¹/(n+1), n ≠ -1 ──
  if (op === BinOp.Pow || op === BinOp.ElemPow) {
    if (arena.getExprKind(left) === ExprKind.Name) {
      const name = arena.interner.resolve(arena.getExprData1(left));
      if (name === varName && !containsVar(arena, right, varName)) {
        const n = getLiteralValue(arena, right);
        if (n !== null && n !== -1) {
          return simplifyArenaExpr(
            arena,
            div(arena, pow(arena, varRef(arena, varName), lit(arena, n + 1)), lit(arena, n + 1)),
          );
        }
        if (n === -1) {
          // ∫x⁻¹ = ln|x|
          return call(arena, "log", [call(arena, "abs", [varRef(arena, varName)])]);
        }
        // Symbolic exponent: ∫x^a = x^(a+1)/(a+1)
        const np1 = add(arena, right, ONE(arena));
        return simplifyArenaExpr(arena, div(arena, pow(arena, varRef(arena, varName), np1), np1));
      }
    }
    // ∫e^x = e^x, ∫a^x = a^x/ln(a) — handled for constant base
    if (!containsVar(arena, left, varName) && arena.getExprKind(right) === ExprKind.Name) {
      const name = arena.interner.resolve(arena.getExprData1(right));
      if (name === varName) {
        // ∫a^x dx = a^x / ln(a)
        return simplifyArenaExpr(arena, div(arena, exprId, call(arena, "log", [left])));
      }
    }
    return null;
  }

  return null;
}

// ── Function Call Integration ──

function integrateFunctionCall(arena: ArenaDAEBuilder, exprId: number, varName: string): number | null {
  const fname = arena.interner.resolve(arena.getExprData1(exprId));
  if (!fname) return null;

  const argCount = arena.getExprRight(exprId);
  const firstArg = arena.getExprLeft(exprId);
  const args = getSequenceElements(arena, exprId, argCount, firstArg);

  if (args.length !== 1) return null;
  const arg = args[0];
  if (arg === undefined) return null;

  // Check for linear substitution: f(ax+b) where a,b are constants
  const linCoeffs = extractLinearArg(arena, arg, varName);
  if (!linCoeffs) return null;
  const { a: aCoeff, isSimple } = linCoeffs;

  const x = varRef(arena, varName);
  let antiderivative: number | null = null;

  switch (fname) {
    case "sin":
    case "Modelica.Math.sin":
      // ∫sin(u) = -cos(u)
      antiderivative = negate(arena, call(arena, "cos", [arg]));
      break;

    case "cos":
    case "Modelica.Math.cos":
      // ∫cos(u) = sin(u)
      antiderivative = call(arena, "sin", [arg]);
      break;

    case "exp":
    case "Modelica.Math.exp":
      // ∫exp(u) = exp(u)
      antiderivative = call(arena, "exp", [arg]);
      break;

    case "tan":
    case "Modelica.Math.tan":
      // ∫tan(u) = -ln|cos(u)|
      antiderivative = negate(arena, call(arena, "log", [call(arena, "abs", [call(arena, "cos", [arg])])]));
      break;

    case "sinh":
    case "Modelica.Math.sinh":
      // ∫sinh(u) = cosh(u)
      antiderivative = call(arena, "cosh", [arg]);
      break;

    case "cosh":
    case "Modelica.Math.cosh":
      // ∫cosh(u) = sinh(u)
      antiderivative = call(arena, "sinh", [arg]);
      break;

    case "sqrt":
      // ∫√x dx = (2/3)x^(3/2)
      if (isSimple) {
        antiderivative = mul(arena, div(arena, lit(arena, 2), lit(arena, 3)), pow(arena, x, lit(arena, 1.5)));
      }
      break;

    default:
      return null;
  }

  if (antiderivative === null) return null;

  // Apply linear substitution correction: divide by 'a'
  if (!isSimple) {
    antiderivative = div(arena, antiderivative, aCoeff);
  }

  return simplifyArenaExpr(arena, antiderivative);
}

// ── Utilities ──

function containsVar(arena: ArenaDAEBuilder, exprId: number, varName: string): boolean {
  if (exprId < 0) return false;
  const kind = arena.getExprKind(exprId);
  switch (kind) {
    case ExprKind.Name: {
      const name = arena.interner.resolve(arena.getExprData1(exprId));
      return name === varName;
    }
    case ExprKind.Unary:
    case ExprKind.Negate:
      return containsVar(arena, arena.getExprLeft(exprId), varName);
    case ExprKind.Binary:
      return (
        containsVar(arena, arena.getExprLeft(exprId), varName) ||
        containsVar(arena, arena.getExprRight(exprId), varName)
      );
    case ExprKind.Call: {
      const count = arena.getExprRight(exprId);
      const firstArg = arena.getExprLeft(exprId);
      const argIds = getSequenceElements(arena, exprId, count, firstArg);
      return argIds.some((id) => containsVar(arena, id, varName));
    }
    case ExprKind.Der:
    case ExprKind.Pre:
      return containsVar(arena, arena.getExprData1(exprId), varName);
    case ExprKind.IfElse:
      return (
        containsVar(arena, arena.getExprData1(exprId), varName) ||
        containsVar(arena, arena.getExprLeft(exprId), varName) ||
        containsVar(arena, arena.getExprRight(exprId), varName)
      );
  }
  return false;
}

function getLiteralValue(arena: ArenaDAEBuilder, exprId: number): number | null {
  const kind = arena.getExprKind(exprId);
  if (kind === ExprKind.RealLiteral) return arena.getExprRealValue(exprId);
  if (kind === ExprKind.IntLiteral) return arena.getExprData1(exprId);
  return null;
}

/**
 * Evaluate an expression at varName = value by substitution using evaluateArenaExpression.
 * Returns null if the expression can't be fully evaluated to a number.
 */
function evaluateArenaAt(arena: ArenaDAEBuilder, exprId: number, varName: string, value: number): number | null {
  const params = new Map<string, number>([[varName, value]]);
  const res = evaluateArenaExpression(arena, exprId, params);
  return typeof res === "number" ? res : null;
}

/**
 * Check if arg = a*varName + b (linear in varName).
 * Returns { a, b, isSimple } where isSimple means arg is just varName (a=1, b=0).
 */
function extractLinearArg(
  arena: ArenaDAEBuilder,
  arg: number,
  varName: string,
): { a: number; b: number; isSimple: boolean } | null {
  const kind = arena.getExprKind(arg);

  // arg is just x
  if (kind === ExprKind.Name) {
    const name = arena.interner.resolve(arena.getExprData1(arg));
    if (name === varName) {
      return { a: ONE(arena), b: ZERO(arena), isSimple: true };
    }
  }

  // Not containing the variable — not a valid integrand in terms of varName
  if (!containsVar(arena, arg, varName)) return null;

  // a*x: check for multiplication
  if (
    kind === ExprKind.Binary &&
    (arena.getExprData1(arg) === BinOp.Mul || arena.getExprData1(arg) === BinOp.ElemMul)
  ) {
    const left = arena.getExprLeft(arg);
    const right = arena.getExprRight(arg);

    if (
      arena.getExprKind(left) === ExprKind.Name &&
      arena.interner.resolve(arena.getExprData1(left)) === varName &&
      !containsVar(arena, right, varName)
    ) {
      return { a: right, b: ZERO(arena), isSimple: false };
    }
    if (
      arena.getExprKind(right) === ExprKind.Name &&
      arena.interner.resolve(arena.getExprData1(right)) === varName &&
      !containsVar(arena, left, varName)
    ) {
      return { a: left, b: ZERO(arena), isSimple: false };
    }
  }

  // a*x + b: check for addition
  if (
    kind === ExprKind.Binary &&
    (arena.getExprData1(arg) === BinOp.Add || arena.getExprData1(arg) === BinOp.ElemAdd)
  ) {
    const left = arena.getExprLeft(arg);
    const right = arena.getExprRight(arg);

    const leftLin = extractLinearArg(arena, left, varName);
    if (leftLin && !containsVar(arena, right, varName)) {
      return { a: leftLin.a, b: add(arena, leftLin.b, right), isSimple: false };
    }
    const rightLin = extractLinearArg(arena, right, varName);
    if (rightLin && !containsVar(arena, left, varName)) {
      return { a: rightLin.a, b: add(arena, left, rightLin.b), isSimple: false };
    }
  }

  return null;
}

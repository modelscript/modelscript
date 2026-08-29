// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Symbolic differentiation of Modelica DAE expressions on the Arena DAE representation.
 *
 * Given an expression ID `exprId` and a variable name `varName`,
 * computes ∂expr/∂varName as a new expression ID in the same ArenaDAEBuilder.
 */

import { ArenaDAEBuilder, BinOp, ExprKind, UnaryOp } from "../../dae-arena.js";

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

/**
 * Symbolically differentiate an expression in the arena with respect to a variable.
 */
export function differentiateArenaExpr(arena: ArenaDAEBuilder, exprId: number, varName: string): number {
  const kind = arena.getExprKind(exprId);

  // ── Literals: d(const)/dx = 0 ──
  if (
    kind === ExprKind.RealLiteral ||
    kind === ExprKind.IntLiteral ||
    kind === ExprKind.BoolLiteral ||
    kind === ExprKind.StringLiteral ||
    kind === ExprKind.EnumLiteral
  ) {
    return ZERO(arena);
  }

  // ── Variable reference: d(x)/dx = 1, d(y)/dx = 0 ──
  if (kind === ExprKind.Name) {
    const name = arena.interner.resolve(arena.getExprData1(exprId));
    return name === varName ? ONE(arena) : ZERO(arena);
  }

  // ── Unary expression ──
  if (kind === ExprKind.Negate || kind === ExprKind.Unary) {
    const op = arena.getExprData1(exprId) as UnaryOp;
    const operand = arena.getExprLeft(exprId);
    const dOp = differentiateArenaExpr(arena, operand, varName);

    if (kind === ExprKind.Negate || op === UnaryOp.Negate) {
      // d(-f)/dx = -(df/dx)
      if (isZero(arena, dOp)) return ZERO(arena);
      return arena.addExpression(ExprKind.Negate, 0, dOp);
    }
    // Logical NOT — not differentiable
    return ZERO(arena);
  }

  // ── Binary expression ──
  if (kind === ExprKind.Binary) {
    return differentiateBinary(arena, exprId, varName);
  }

  // ── Function call: chain rule ──
  if (kind === ExprKind.Call) {
    return differentiateFunctionCall(arena, exprId, varName);
  }

  // ── If-else expression: differentiate each branch ──
  if (kind === ExprKind.IfElse) {
    const cond = arena.getExprData1(exprId);
    const thenExpr = arena.getExprLeft(exprId);
    const elseExpr = arena.getExprRight(exprId);
    const dThen = differentiateArenaExpr(arena, thenExpr, varName);
    const dElse = differentiateArenaExpr(arena, elseExpr, varName);
    return arena.addIfElseExpr(cond, dThen, dElse);
  }

  // Unknown expression type — return 0 (conservative)
  return ZERO(arena);
}

// ── Constants ──
export const ZERO = (arena: ArenaDAEBuilder) => arena.addRealLiteral(0.0);
export const ONE = (arena: ArenaDAEBuilder) => arena.addRealLiteral(1.0);
export const TWO = (arena: ArenaDAEBuilder) => arena.addRealLiteral(2.0);
export const HALF = (arena: ArenaDAEBuilder) => arena.addRealLiteral(0.5);
export const NEG_ONE = (arena: ArenaDAEBuilder) => arena.addRealLiteral(-1.0);

// ── Helpers ──

/** Check if an expression is the constant zero. */
export function isZero(arena: ArenaDAEBuilder, exprId: number): boolean {
  const kind = arena.getExprKind(exprId);
  if (kind === ExprKind.RealLiteral) return arena.getExprRealValue(exprId) === 0;
  if (kind === ExprKind.IntLiteral) return arena.getExprData1(exprId) === 0;
  return false;
}

/** Check if an expression is the constant one. */
export function isOne(arena: ArenaDAEBuilder, exprId: number): boolean {
  const kind = arena.getExprKind(exprId);
  if (kind === ExprKind.RealLiteral) return arena.getExprRealValue(exprId) === 1;
  if (kind === ExprKind.IntLiteral) return arena.getExprData1(exprId) === 1;
  return false;
}

/** Simplified addition: skip adding zero. */
export function add(arena: ArenaDAEBuilder, a: number, b: number): number {
  if (isZero(arena, a)) return b;
  if (isZero(arena, b)) return a;
  return arena.addBinaryExpr(BinOp.Add, a, b);
}

/** Simplified subtraction: skip subtracting zero. */
export function sub(arena: ArenaDAEBuilder, a: number, b: number): number {
  if (isZero(arena, b)) return a;
  if (isZero(arena, a)) return negate(arena, b);
  return arena.addBinaryExpr(BinOp.Sub, a, b);
}

/** Simplified multiplication: skip multiplying by 0 or 1. */
export function mul(arena: ArenaDAEBuilder, a: number, b: number): number {
  if (isZero(arena, a) || isZero(arena, b)) return ZERO(arena);
  if (isOne(arena, a)) return b;
  if (isOne(arena, b)) return a;
  return arena.addBinaryExpr(BinOp.Mul, a, b);
}

/** Simplified division. */
export function div(arena: ArenaDAEBuilder, a: number, b: number): number {
  if (isZero(arena, a)) return ZERO(arena);
  if (isOne(arena, b)) return a;
  return arena.addBinaryExpr(BinOp.Div, a, b);
}

/** Build a power expression. */
export function pow(arena: ArenaDAEBuilder, base: number, exp: number): number {
  if (isZero(arena, exp)) return ONE(arena);
  if (isOne(arena, exp)) return base;
  return arena.addBinaryExpr(BinOp.Pow, base, exp);
}

/** Build a function call expression. */
export function call(arena: ArenaDAEBuilder, name: string, args: number[]): number {
  return arena.addCallExpr(name, args);
}

/** Negate an expression. */
export function negate(arena: ArenaDAEBuilder, exprId: number): number {
  if (isZero(arena, exprId)) return ZERO(arena);
  const kind = arena.getExprKind(exprId);
  if (kind === ExprKind.Negate) {
    return arena.getExprLeft(exprId);
  }
  return arena.addExpression(ExprKind.Negate, 0, exprId);
}

// ── Binary differentiation ──

function differentiateBinary(arena: ArenaDAEBuilder, exprId: number, varName: string): number {
  const op = arena.getExprData1(exprId) as BinOp;
  const u = arena.getExprLeft(exprId);
  const v = arena.getExprRight(exprId);
  const du = differentiateArenaExpr(arena, u, varName);
  const dv = differentiateArenaExpr(arena, v, varName);

  switch (op) {
    // d(u + v)/dx = du/dx + dv/dx
    case BinOp.Add:
    case BinOp.ElemAdd:
      return add(arena, du, dv);

    // d(u - v)/dx = du/dx - dv/dx
    case BinOp.Sub:
    case BinOp.ElemSub:
      return sub(arena, du, dv);

    // Product rule: d(u * v)/dx = u * dv/dx + du/dx * v
    case BinOp.Mul:
    case BinOp.ElemMul:
      return add(arena, mul(arena, u, dv), mul(arena, du, v));

    // Quotient rule: d(u / v)/dx = (du/dx * v - u * dv/dx) / v²
    case BinOp.Div:
    case BinOp.ElemDiv: {
      const num = sub(arena, mul(arena, du, v), mul(arena, u, dv));
      const den = mul(arena, v, v);
      return div(arena, num, den);
    }

    // Power rule: d(u^v)/dx
    // General case: u^v * (v' * ln(u) + v * u'/u)
    // Special case when v is constant: v * u^(v-1) * u'
    case BinOp.Pow:
    case BinOp.ElemPow: {
      if (isZero(arena, dv)) {
        // v is constant: d(u^n)/dx = n * u^(n-1) * du/dx
        const n = v;
        const nMinus1 = sub(arena, n, ONE(arena));
        return mul(arena, mul(arena, n, pow(arena, u, nMinus1)), du);
      }
      if (isZero(arena, du)) {
        // u is constant: d(c^v)/dx = c^v * ln(c) * dv/dx
        return mul(arena, mul(arena, exprId, call(arena, "log", [u])), dv);
      }
      // General case: u^v * (dv * ln(u) + v * du / u)
      return mul(arena, exprId, add(arena, mul(arena, dv, call(arena, "log", [u])), div(arena, mul(arena, v, du), u)));
    }

    // Relational/logical operators — not differentiable, return 0
    default:
      return ZERO(arena);
  }
}

// ── Function call differentiation (chain rule) ──

function differentiateFunctionCall(arena: ArenaDAEBuilder, exprId: number, varName: string): number {
  const fname = arena.interner.resolve(arena.getExprData1(exprId));
  if (!fname) return ZERO(arena);

  const argCount = arena.getExprRight(exprId);
  const firstArg = arena.getExprLeft(exprId);
  const args = getSequenceElements(arena, exprId, argCount, firstArg);

  // Most math functions are f(g(x)), so d/dx = f'(g(x)) * g'(x)
  if (args.length === 1) {
    const u = args[0];
    if (u === undefined) return ZERO(arena);
    const du = differentiateArenaExpr(arena, u, varName);

    if (isZero(arena, du)) return ZERO(arena);

    let outerDerivative: number;

    switch (fname) {
      // d(sin(u))/dx = cos(u) * du/dx
      case "sin":
      case "Modelica.Math.sin":
        outerDerivative = call(arena, "cos", [u]);
        break;

      // d(cos(u))/dx = -sin(u) * du/dx
      case "cos":
      case "Modelica.Math.cos":
        outerDerivative = negate(arena, call(arena, "sin", [u]));
        break;

      // d(tan(u))/dx = (1 / cos²(u)) * du/dx
      case "tan":
      case "Modelica.Math.tan": {
        const cosU = call(arena, "cos", [u]);
        outerDerivative = div(arena, ONE(arena), mul(arena, cosU, cosU));
        break;
      }

      // d(asin(u))/dx = 1/√(1-u²) * du/dx
      case "asin":
      case "Modelica.Math.asin": {
        const oneMinusUSq = sub(arena, ONE(arena), mul(arena, u, u));
        outerDerivative = div(arena, ONE(arena), call(arena, "sqrt", [oneMinusUSq]));
        break;
      }

      // d(acos(u))/dx = -1/√(1-u²) * du/dx
      case "acos":
      case "Modelica.Math.acos": {
        const oneMinusUSq = sub(arena, ONE(arena), mul(arena, u, u));
        outerDerivative = negate(arena, div(arena, ONE(arena), call(arena, "sqrt", [oneMinusUSq])));
        break;
      }

      // d(atan(u))/dx = 1/(1+u²) * du/dx
      case "atan":
      case "Modelica.Math.atan": {
        const onePlusUSq = add(arena, ONE(arena), mul(arena, u, u));
        outerDerivative = div(arena, ONE(arena), onePlusUSq);
        break;
      }

      // d(exp(u))/dx = exp(u) * du/dx
      case "exp":
      case "Modelica.Math.exp":
        outerDerivative = call(arena, "exp", [u]);
        break;

      // d(log(u))/dx = (1/u) * du/dx
      case "log":
      case "Modelica.Math.log":
        outerDerivative = div(arena, ONE(arena), u);
        break;

      // d(log10(u))/dx = 1/(u * ln(10)) * du/dx
      case "log10":
      case "Modelica.Math.log10":
        outerDerivative = div(arena, ONE(arena), mul(arena, u, arena.addRealLiteral(Math.LN10)));
        break;

      // d(sqrt(u))/dx = 1/(2*sqrt(u)) * du/dx
      case "sqrt":
        outerDerivative = div(arena, HALF(arena), call(arena, "sqrt", [u]));
        break;

      // d(abs(u))/dx = sign(u) * du/dx  (not differentiable at 0, but useful approximation)
      case "abs":
        outerDerivative = call(arena, "sign", [u]);
        break;

      // d(sinh(u))/dx = cosh(u) * du/dx
      case "sinh":
      case "Modelica.Math.sinh":
        outerDerivative = call(arena, "cosh", [u]);
        break;

      // d(cosh(u))/dx = sinh(u) * du/dx
      case "cosh":
      case "Modelica.Math.cosh":
        outerDerivative = call(arena, "sinh", [u]);
        break;

      // d(tanh(u))/dx = (1 - tanh²(u)) * du/dx
      case "tanh":
      case "Modelica.Math.tanh": {
        const tanhU = call(arena, "tanh", [u]);
        outerDerivative = sub(arena, ONE(arena), mul(arena, tanhU, tanhU));
        break;
      }

      // d(sign(u))/dx = 0 (piecewise constant)
      case "sign":
        return ZERO(arena);

      // d(floor(u))/dx = 0 (piecewise constant)
      case "floor":
      case "ceil":
      case "integer":
        return ZERO(arena);

      default:
        // Unknown function — return 0 (conservative)
        return ZERO(arena);
    }

    return mul(arena, outerDerivative, du);
  }

  // Two-argument functions
  if (args.length === 2) {
    const u = args[0];
    const v = args[1];
    if (u === undefined || v === undefined) return ZERO(arena);
    const du = differentiateArenaExpr(arena, u, varName);
    const dv = differentiateArenaExpr(arena, v, varName);

    switch (fname) {
      // d(atan2(u, v))/dx = (v*du - u*dv) / (u² + v²)
      case "atan2":
      case "Modelica.Math.atan2": {
        const num = sub(arena, mul(arena, v, du), mul(arena, u, dv));
        const den = add(arena, mul(arena, u, u), mul(arena, v, v));
        return div(arena, num, den);
      }

      // d(max(u, v))/dx ≈ if u > v then du else dv
      case "max": {
        const cond = arena.addBinaryExpr(BinOp.Gt, u, v);
        return arena.addIfElseExpr(cond, du, dv);
      }

      // d(min(u, v))/dx ≈ if u < v then du else dv
      case "min": {
        const cond = arena.addBinaryExpr(BinOp.Lt, u, v);
        return arena.addIfElseExpr(cond, du, dv);
      }

      default:
        return ZERO(arena);
    }
  }

  return ZERO(arena);
}

/**
 * Simplify an expression by applying constant folding and algebraic identities.
 * Applied after differentiation to reduce expression complexity.
 */
export function simplifyArenaExpr(arena: ArenaDAEBuilder, exprId: number): number {
  const kind = arena.getExprKind(exprId);

  if (kind === ExprKind.Negate || (kind === ExprKind.Unary && arena.getExprData1(exprId) === UnaryOp.Negate)) {
    const op = simplifyArenaExpr(arena, arena.getExprLeft(exprId));
    const opKind = arena.getExprKind(op);
    // --x → x
    if (opKind === ExprKind.Negate || (opKind === ExprKind.Unary && arena.getExprData1(op) === UnaryOp.Negate)) {
      return arena.getExprLeft(op);
    }
    // -0 → 0
    if (isZero(arena, op)) return ZERO(arena);
    // -literal → literal
    if (opKind === ExprKind.RealLiteral) {
      return arena.addRealLiteral(-arena.getExprRealValue(op));
    }
    if (opKind === ExprKind.IntLiteral) {
      return arena.addIntLiteral(-arena.getExprData1(op));
    }
    if (op === arena.getExprLeft(exprId)) return exprId;
    return arena.addExpression(ExprKind.Negate, 0, op);
  }

  const toNum = (e: number): number | null => {
    const k = arena.getExprKind(e);
    if (k === ExprKind.RealLiteral) return arena.getExprRealValue(e);
    if (k === ExprKind.IntLiteral) return arena.getExprData1(e);
    return null;
  };

  if (kind === ExprKind.Binary) {
    const op = arena.getExprData1(exprId) as BinOp;
    const l = simplifyArenaExpr(arena, arena.getExprLeft(exprId));
    const r = simplifyArenaExpr(arena, arena.getExprRight(exprId));

    const lKind = arena.getExprKind(l);
    const rKind = arena.getExprKind(r);

    // Constant folding
    const ln = toNum(l);
    const rn = toNum(r);

    if (ln !== null && rn !== null) {
      const isInt = lKind === ExprKind.IntLiteral && rKind === ExprKind.IntLiteral;
      switch (op) {
        case BinOp.Add:
          return isInt ? arena.addIntLiteral(ln + rn) : arena.addRealLiteral(ln + rn);
        case BinOp.Sub:
          return isInt ? arena.addIntLiteral(ln - rn) : arena.addRealLiteral(ln - rn);
        case BinOp.Mul:
          return isInt ? arena.addIntLiteral(ln * rn) : arena.addRealLiteral(ln * rn);
        case BinOp.Div:
          if (rn !== 0) return arena.addRealLiteral(ln / rn);
          break;
        case BinOp.Pow:
          return isInt && rn >= 0 ? arena.addIntLiteral(Math.pow(ln, rn)) : arena.addRealLiteral(Math.pow(ln, rn));
      }
    }

    // Algebraic identities
    switch (op) {
      case BinOp.Add:
      case BinOp.ElemAdd:
        if (isZero(arena, l)) return r;
        if (isZero(arena, r)) return l;
        break;
      case BinOp.Sub:
      case BinOp.ElemSub:
        if (isZero(arena, r)) return l;
        if (isZero(arena, l)) return negate(arena, r);
        break;
      case BinOp.Mul:
      case BinOp.ElemMul:
        if (isZero(arena, l) || isZero(arena, r)) return ZERO(arena);
        if (isOne(arena, l)) return r;
        if (isOne(arena, r)) return l;
        break;
      case BinOp.Div:
      case BinOp.ElemDiv:
        if (isZero(arena, l)) return ZERO(arena);
        if (isOne(arena, r)) return l;
        break;
      case BinOp.Pow:
      case BinOp.ElemPow:
        if (isZero(arena, r)) return ONE(arena);
        if (isOne(arena, r)) return l;
        break;
    }

    if (l === arena.getExprLeft(exprId) && r === arena.getExprRight(exprId)) return exprId;
    return arena.addBinaryExpr(op, l, r);
  }

  if (kind === ExprKind.Call) {
    const fname = arena.interner.resolve(arena.getExprData1(exprId));
    if (!fname) return exprId;

    const argCount = arena.getExprRight(exprId);
    const firstArg = arena.getExprLeft(exprId);
    const args = getSequenceElements(arena, exprId, argCount, firstArg).map((a) => simplifyArenaExpr(arena, a));

    // Constant folding for functions
    if (args.length === 1) {
      const firstArgVal = args[0] !== undefined ? toNum(args[0]) : null;
      if (firstArgVal !== null) {
        if (fname === "sqrt" || fname === "Modelica.Math.sqrt") {
          if (firstArgVal >= 0) return arena.addRealLiteral(Math.sqrt(firstArgVal));
        } else if (fname === "sin" || fname === "Modelica.Math.sin") return arena.addRealLiteral(Math.sin(firstArgVal));
        else if (fname === "cos" || fname === "Modelica.Math.cos") return arena.addRealLiteral(Math.cos(firstArgVal));
        else if (fname === "tan" || fname === "Modelica.Math.tan") return arena.addRealLiteral(Math.tan(firstArgVal));
        else if (fname === "asin" || fname === "Modelica.Math.asin")
          return arena.addRealLiteral(Math.asin(firstArgVal));
        else if (fname === "acos" || fname === "Modelica.Math.acos")
          return arena.addRealLiteral(Math.acos(firstArgVal));
        else if (fname === "atan" || fname === "Modelica.Math.atan")
          return arena.addRealLiteral(Math.atan(firstArgVal));
        else if (fname === "exp" || fname === "Modelica.Math.exp") return arena.addRealLiteral(Math.exp(firstArgVal));
        else if (fname === "log" || fname === "Modelica.Math.log") return arena.addRealLiteral(Math.log(firstArgVal));
        else if (fname === "log10" || fname === "Modelica.Math.log10")
          return arena.addRealLiteral(Math.log10(firstArgVal));
        else if (fname === "abs" || fname === "Modelica.Math.abs") {
          const firstArgNode = args[0];
          const isInt = firstArgNode !== undefined && arena.getExprKind(firstArgNode) === ExprKind.IntLiteral;
          return isInt ? arena.addIntLiteral(Math.abs(firstArgVal)) : arena.addRealLiteral(Math.abs(firstArgVal));
        }
      }
    } else if (args.length === 2 && (fname === "atan2" || fname === "Modelica.Math.atan2")) {
      const y = args[0] !== undefined ? toNum(args[0]) : null;
      const x = args[1] !== undefined ? toNum(args[1]) : null;
      if (y !== null && x !== null) return arena.addRealLiteral(Math.atan2(y, x));
    }

    return arena.addCallExpr(fname, args);
  }

  if (kind === ExprKind.IfElse) {
    const cond = arena.getExprData1(exprId);
    const thenExpr = arena.getExprLeft(exprId);
    const elseExpr = arena.getExprRight(exprId);
    return arena.addIfElseExpr(cond, simplifyArenaExpr(arena, thenExpr), simplifyArenaExpr(arena, elseExpr));
  }

  return exprId;
}

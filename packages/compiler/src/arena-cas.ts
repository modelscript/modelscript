// SPDX-License-Identifier: AGPL-3.0-or-later

import { BinOp, DAEArenaBuilder, ExprKind } from "./dae-arena.js";
import type { StringId } from "./interner.js";

/**
 * Symbolically differentiates an expression with respect to time.
 * @param arena The DAEArenaBuilder containing the expressions.
 * @param exprId The ID of the expression to differentiate.
 * @param stateVars The set of state variables (StringIds) that are functions of time.
 * @returns The ExprId of the differentiated expression.
 */
export function differentiateArenaExpression(arena: DAEArenaBuilder, exprId: number, stateVars: Set<StringId>): number {
  const kind = arena.getExprKind(exprId);

  switch (kind) {
    case ExprKind.RealLiteral:
    case ExprKind.IntLiteral:
    case ExprKind.BoolLiteral:
    case ExprKind.StringLiteral:
    case ExprKind.EnumLiteral:
      // d/dt (constant) = 0
      return arena.addRealLiteral(0.0);

    case ExprKind.Name: {
      const nameId = arena.getExprData1(exprId);
      // If it's a state variable, d/dt x = der(x)
      if (stateVars.has(nameId)) {
        return arena.addDerExpr(exprId);
      }
      // If it's an algebraic variable or parameter, assume 0 for now
      // (Pantelides index reduction typically only differentiates constraints involving states)
      return arena.addRealLiteral(0.0);
    }

    case ExprKind.Der: {
      // d/dt der(x) = der(der(x))
      return arena.addDerExpr(exprId);
    }

    case ExprKind.Negate: {
      const operand = arena.getExprLeft(exprId);
      return arena.addExpression(ExprKind.Negate, 0, differentiateArenaExpression(arena, operand, stateVars));
    }

    case ExprKind.Binary: {
      const op = arena.getExprData1(exprId) as BinOp;
      const left = arena.getExprLeft(exprId);
      const right = arena.getExprRight(exprId);

      switch (op) {
        case BinOp.Add:
        case BinOp.Sub: {
          // d/dt (u +/- v) = du/dt +/- dv/dt
          const dLeft = differentiateArenaExpression(arena, left, stateVars);
          const dRight = differentiateArenaExpression(arena, right, stateVars);
          return arena.addBinaryExpr(op, dLeft, dRight);
        }
        case BinOp.Mul: {
          // Product rule: d/dt (u * v) = u * dv/dt + v * du/dt
          const dLeft = differentiateArenaExpression(arena, left, stateVars);
          const dRight = differentiateArenaExpression(arena, right, stateVars);
          const u_dv = arena.addBinaryExpr(BinOp.Mul, left, dRight);
          const v_du = arena.addBinaryExpr(BinOp.Mul, right, dLeft);
          return arena.addBinaryExpr(BinOp.Add, u_dv, v_du);
        }
        case BinOp.Div: {
          // Quotient rule: d/dt (u / v) = (v * du/dt - u * dv/dt) / (v * v)
          const dLeft = differentiateArenaExpression(arena, left, stateVars);
          const dRight = differentiateArenaExpression(arena, right, stateVars);
          const v_du = arena.addBinaryExpr(BinOp.Mul, right, dLeft);
          const u_dv = arena.addBinaryExpr(BinOp.Mul, left, dRight);
          const num = arena.addBinaryExpr(BinOp.Sub, v_du, u_dv);
          const den = arena.addBinaryExpr(BinOp.Mul, right, right);
          return arena.addBinaryExpr(BinOp.Div, num, den);
        }
        // Exponentiation would require chain rule with log, ignoring for now as constraints are mostly linear
        default:
          return arena.addRealLiteral(0.0);
      }
    }

    case ExprKind.Call: {
      // d/dt f(g(x)) = f'(g(x)) * g'(x)
      // For now, support minimal built-ins if encountered
      return arena.addRealLiteral(0.0);
    }

    default:
      return arena.addRealLiteral(0.0);
  }
}

/**
 * Simplifies an arena expression (constant folding and algebraic identities).
 */
export function simplifyArenaExpression(arena: DAEArenaBuilder, exprId: number): number {
  const kind = arena.getExprKind(exprId);

  if (kind === ExprKind.Negate) {
    const operand = simplifyArenaExpression(arena, arena.getExprLeft(exprId));
    if (arena.getExprKind(operand) === ExprKind.RealLiteral) {
      return arena.addRealLiteral(-arena.getExprRealValue(operand));
    }
    return arena.addExpression(ExprKind.Negate, 0, operand);
  }

  if (kind === ExprKind.Binary) {
    const op = arena.getExprData1(exprId) as BinOp;
    const left = simplifyArenaExpression(arena, arena.getExprLeft(exprId));
    const right = simplifyArenaExpression(arena, arena.getExprRight(exprId));

    const leftIsReal = arena.getExprKind(left) === ExprKind.RealLiteral;
    const rightIsReal = arena.getExprKind(right) === ExprKind.RealLiteral;
    const leftVal = leftIsReal ? arena.getExprRealValue(left) : 0;
    const rightVal = rightIsReal ? arena.getExprRealValue(right) : 0;

    if (leftIsReal && rightIsReal) {
      switch (op) {
        case BinOp.Add:
          return arena.addRealLiteral(leftVal + rightVal);
        case BinOp.Sub:
          return arena.addRealLiteral(leftVal - rightVal);
        case BinOp.Mul:
          return arena.addRealLiteral(leftVal * rightVal);
        case BinOp.Div:
          return arena.addRealLiteral(leftVal / rightVal);
      }
    }

    // Identities
    if (op === BinOp.Add) {
      if (leftIsReal && leftVal === 0) return right;
      if (rightIsReal && rightVal === 0) return left;
    } else if (op === BinOp.Sub) {
      if (rightIsReal && rightVal === 0) return left;
      if (left === right) return arena.addRealLiteral(0.0);
    } else if (op === BinOp.Mul) {
      if ((leftIsReal && leftVal === 0) || (rightIsReal && rightVal === 0)) return arena.addRealLiteral(0.0);
      if (leftIsReal && leftVal === 1) return right;
      if (rightIsReal && rightVal === 1) return left;
      if (leftIsReal && leftVal === -1) return arena.addExpression(ExprKind.Negate, 0, right);
      if (rightIsReal && rightVal === -1) return arena.addExpression(ExprKind.Negate, 0, left);
    } else if (op === BinOp.Div) {
      if (leftIsReal && leftVal === 0) return arena.addRealLiteral(0.0);
      if (rightIsReal && rightVal === 1) return left;
      if (left === right) return arena.addRealLiteral(1.0);
    }

    return arena.addBinaryExpr(op, left, right);
  }

  return exprId;
}

/**
 * Symbolically computes the partial derivative of an expression with respect to a specific variable.
 * Used for building analytical Jacobians.
 *
 * @param arena The DAEArenaBuilder.
 * @param exprId The ID of the expression to differentiate.
 * @param wrtVarId The StringId of the variable to differentiate with respect to.
 * @returns The ExprId of the differentiated expression.
 */
export function differentiateArenaExpressionWrt(arena: DAEArenaBuilder, exprId: number, wrtVarId: StringId): number {
  if (exprId < 0) return arena.addRealLiteral(0.0);

  const kind = arena.getExprKind(exprId);

  switch (kind) {
    case ExprKind.RealLiteral:
    case ExprKind.IntLiteral:
    case ExprKind.BoolLiteral:
    case ExprKind.StringLiteral:
    case ExprKind.EnumLiteral:
      return arena.addRealLiteral(0.0);

    case ExprKind.Name: {
      const nameId = arena.getExprData1(exprId);
      if (nameId === wrtVarId) {
        return arena.addRealLiteral(1.0);
      }
      return arena.addRealLiteral(0.0);
    }

    case ExprKind.Der: {
      // In initialization and Jacobians, der(x) is treated as an independent variable.
      // E.g. we might take derivative wrt der(x).
      // We assume der(x) is just tracked as a StringId like "der(x)" and it's resolved during evaluation.
      // But ExprKind.Der wraps an inner variable.
      // Let's resolve the full string ID of the der(x).
      const argId = arena.getExprData1(exprId);
      if (arena.getExprKind(argId) === ExprKind.Name) {
        const innerName = arena.interner.resolve(arena.getExprData1(argId));
        const fullDerNameId = arena.interner.intern(`der(${innerName})`);
        if (fullDerNameId === wrtVarId) {
          return arena.addRealLiteral(1.0);
        }
      }
      return arena.addRealLiteral(0.0);
    }

    case ExprKind.Negate: {
      const operand = arena.getExprLeft(exprId);
      return arena.addExpression(ExprKind.Negate, 0, differentiateArenaExpressionWrt(arena, operand, wrtVarId));
    }

    case ExprKind.Binary: {
      const op = arena.getExprData1(exprId) as BinOp;
      const left = arena.getExprLeft(exprId);
      const right = arena.getExprRight(exprId);

      switch (op) {
        case BinOp.Add:
        case BinOp.Sub: {
          const dLeft = differentiateArenaExpressionWrt(arena, left, wrtVarId);
          const dRight = differentiateArenaExpressionWrt(arena, right, wrtVarId);
          return arena.addBinaryExpr(op, dLeft, dRight);
        }
        case BinOp.Mul: {
          const dLeft = differentiateArenaExpressionWrt(arena, left, wrtVarId);
          const dRight = differentiateArenaExpressionWrt(arena, right, wrtVarId);
          const u_dv = arena.addBinaryExpr(BinOp.Mul, left, dRight);
          const v_du = arena.addBinaryExpr(BinOp.Mul, right, dLeft);
          return arena.addBinaryExpr(BinOp.Add, u_dv, v_du);
        }
        case BinOp.Div: {
          const dLeft = differentiateArenaExpressionWrt(arena, left, wrtVarId);
          const dRight = differentiateArenaExpressionWrt(arena, right, wrtVarId);
          const v_du = arena.addBinaryExpr(BinOp.Mul, right, dLeft);
          const u_dv = arena.addBinaryExpr(BinOp.Mul, left, dRight);
          const num = arena.addBinaryExpr(BinOp.Sub, v_du, u_dv);
          const den = arena.addBinaryExpr(BinOp.Mul, right, right);
          return arena.addBinaryExpr(BinOp.Div, num, den);
        }
        case BinOp.Pow: {
          // d(u^v)/dx = v * u^(v-1) * du/dx + u^v * ln(u) * dv/dx
          // Simplification for v = constant (dv/dx = 0)
          const dLeft = differentiateArenaExpressionWrt(arena, left, wrtVarId);
          // const dRight = differentiateArenaExpressionWrt(arena, right, wrtVarId);

          // Assuming right is constant for simplicity (most common case in Modelica equations)
          const v_minus_1 = arena.addBinaryExpr(BinOp.Sub, right, arena.addRealLiteral(1.0));
          const u_pow_v_minus_1 = arena.addBinaryExpr(BinOp.Pow, left, v_minus_1);
          const v_mul_u_pow = arena.addBinaryExpr(BinOp.Mul, right, u_pow_v_minus_1);
          return arena.addBinaryExpr(BinOp.Mul, v_mul_u_pow, dLeft);
        }
        default:
          return arena.addRealLiteral(0.0);
      }
    }

    default:
      return arena.addRealLiteral(0.0);
  }
}

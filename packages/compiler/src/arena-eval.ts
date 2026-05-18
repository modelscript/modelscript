import { BinOp, DAEArenaBuilder, ExprKind, UnaryOp } from "./dae-arena.js";

/**
 * Evaluates an expression tree stored in a `DAEArenaBuilder` and attempts
 * to reduce it to a constant value (number, boolean, string).
 *
 * This effectively replaces the legacy AST-based `ExpressionEvaluator` and
 * operates strictly on the DoD `ExprKind` integer buffers.
 *
 * @param dae The arena containing the expressions.
 * @param exprId The integer ID of the expression to evaluate.
 * @param parameters An optional map of parameter names to resolved values.
 * @returns The primitive evaluated value, or null if it cannot be fully evaluated (e.g. contains variables).
 */
export function evaluateArenaExpression(
  dae: DAEArenaBuilder,
  exprId: number,
  parameters = new Map<string, number>(),
): number | boolean | string | null {
  if (exprId < 0) return null;

  const kind = dae.getExprKind(exprId);

  switch (kind) {
    case ExprKind.RealLiteral:
      return dae.getExprRealValue(exprId);

    case ExprKind.IntLiteral:
      return dae.getExprData1(exprId);

    case ExprKind.BoolLiteral:
      return dae.getExprData1(exprId) !== 0;

    case ExprKind.StringLiteral:
      return dae.interner.resolve(dae.getExprData1(exprId)) ?? "";

    case ExprKind.Name: {
      const name = dae.interner.resolve(dae.getExprData1(exprId));
      if (!name) return null;
      if (parameters.has(name)) return parameters.get(name) as number;
      // You can also resolve from start values in the arena if it's a fixed parameter
      const vIdx = dae.getVarIdxByName(name);
      if (vIdx >= 0 && dae.isVarFixed(vIdx)) {
        return dae.getVarStartValue(vIdx);
      }
      return null;
    }

    case ExprKind.Unary: {
      const op = dae.getExprData1(exprId) as UnaryOp;
      const operand = evaluateArenaExpression(dae, dae.getExprLeft(exprId), parameters);
      if (operand === null) return null;

      if (op === UnaryOp.Negate && typeof operand === "number") return -operand;
      if (op === UnaryOp.Not && typeof operand === "boolean") return !operand;
      return null;
    }

    case ExprKind.Binary: {
      const op = dae.getExprData1(exprId) as BinOp;
      const left = evaluateArenaExpression(dae, dae.getExprLeft(exprId), parameters);
      const right = evaluateArenaExpression(dae, dae.getExprRight(exprId), parameters);
      if (left === null || right === null) return null;

      if (typeof left === "number" && typeof right === "number") {
        switch (op) {
          case BinOp.Add:
            return left + right;
          case BinOp.Sub:
            return left - right;
          case BinOp.Mul:
            return left * right;
          case BinOp.Div:
            return left / right;
          case BinOp.Pow:
            return Math.pow(left, right);
          case BinOp.Eq:
            return left === right;
          case BinOp.Neq:
            return left !== right;
          case BinOp.Lt:
            return left < right;
          case BinOp.Lte:
            return left <= right;
          case BinOp.Gt:
            return left > right;
          case BinOp.Gte:
            return left >= right;
        }
      }

      if (typeof left === "boolean" && typeof right === "boolean") {
        switch (op) {
          case BinOp.And:
            return left && right;
          case BinOp.Or:
            return left || right;
          case BinOp.Eq:
            return left === right;
          case BinOp.Neq:
            return left !== right;
        }
      }
      return null;
    }

    case ExprKind.IfElse: {
      const cond = evaluateArenaExpression(dae, dae.getExprData1(exprId), parameters);
      if (typeof cond === "boolean") {
        return cond
          ? evaluateArenaExpression(dae, dae.getExprLeft(exprId), parameters)
          : evaluateArenaExpression(dae, dae.getExprRight(exprId), parameters);
      }
      return null;
    }
  }

  return null;
}

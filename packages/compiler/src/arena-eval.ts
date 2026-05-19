import { ArenaDAEBuilder, BinOp, ExprKind, UnaryOp } from "./dae-arena.js";

/**
 * Evaluates an expression tree stored in a `ArenaDAEBuilder` and attempts
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
export type ArenaValue = number | boolean | string | ArenaValue[];

function getSequenceElements(dae: ArenaDAEBuilder, baseExprId: number, count: number, firstElement: number): number[] {
  if (count === 0) return [];
  const elements = [firstElement];
  for (let i = 1; i < count; i++) {
    const tupleId = baseExprId + i;
    elements.push(dae.getExprLeft(tupleId));
  }
  return elements;
}

export function evaluateArenaExpression(
  dae: ArenaDAEBuilder,
  exprId: number,
  parameters = new Map<string, number>(),
): ArenaValue | null {
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

    case ExprKind.EnumLiteral:
      // Return the string value or ordinal? Modelica enum values are often treated as their string/ordinal.
      // Usually, enum literal returns its ordinal in numeric contexts. Let's return the ordinal.
      return dae.getExprData1(exprId);

    case ExprKind.Name: {
      const name = dae.interner.resolve(dae.getExprData1(exprId));
      if (!name) return null;
      if (parameters.has(name)) return parameters.get(name) as number;
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

    case ExprKind.Call: {
      const funcName = dae.interner.resolve(dae.getExprData1(exprId));
      if (!funcName) return null;
      const argCount = dae.getExprRight(exprId);
      const firstArg = dae.getExprLeft(exprId);
      const argIds = getSequenceElements(dae, exprId, argCount, firstArg);

      const args = argIds.map((id) => evaluateArenaExpression(dae, id, parameters));
      if (args.some((a) => a === null)) return null;

      if (funcName === "sin" && typeof args[0] === "number") return Math.sin(args[0]);
      if (funcName === "cos" && typeof args[0] === "number") return Math.cos(args[0]);
      if (funcName === "tan" && typeof args[0] === "number") return Math.tan(args[0]);
      if (funcName === "asin" && typeof args[0] === "number") return Math.asin(args[0]);
      if (funcName === "acos" && typeof args[0] === "number") return Math.acos(args[0]);
      if (funcName === "atan" && typeof args[0] === "number") return Math.atan(args[0]);
      if (funcName === "atan2" && typeof args[0] === "number" && typeof args[1] === "number")
        return Math.atan2(args[0], args[1]);
      if (funcName === "sinh" && typeof args[0] === "number") return Math.sinh(args[0]);
      if (funcName === "cosh" && typeof args[0] === "number") return Math.cosh(args[0]);
      if (funcName === "tanh" && typeof args[0] === "number") return Math.tanh(args[0]);
      if (funcName === "exp" && typeof args[0] === "number") return Math.exp(args[0]);
      if (funcName === "log" && typeof args[0] === "number") return Math.log(args[0]);
      if (funcName === "log10" && typeof args[0] === "number") return Math.log10(args[0]);
      if (funcName === "abs" && typeof args[0] === "number") return Math.abs(args[0]);
      if (funcName === "sqrt" && typeof args[0] === "number") return Math.sqrt(args[0]);
      if (funcName === "sign" && typeof args[0] === "number") return Math.sign(args[0]);
      if (funcName === "mod" && typeof args[0] === "number" && typeof args[1] === "number") return args[0] % args[1];
      if (funcName === "rem" && typeof args[0] === "number" && typeof args[1] === "number") return args[0] % args[1];
      if (funcName === "min") return Math.min(...(args as number[]));
      if (funcName === "max") return Math.max(...(args as number[]));
      if (funcName === "String") return String(args[0]);

      return null;
    }

    case ExprKind.Der:
      // Cannot statically evaluate a derivative
      return null;

    case ExprKind.Pre:
      // Cannot statically evaluate a previous value
      return null;

    case ExprKind.ArrayCtor: {
      const count = dae.getExprData1(exprId);
      const firstElem = dae.getExprLeft(exprId);
      const elemIds = getSequenceElements(dae, exprId, count, firstElem);
      const elements = elemIds.map((id) => evaluateArenaExpression(dae, id, parameters));
      if (elements.some((e) => e === null)) return null;
      return elements as ArenaValue[];
    }

    case ExprKind.Range: {
      const start = evaluateArenaExpression(dae, dae.getExprData1(exprId), parameters);
      const stepId = dae.getExprLeft(exprId);
      const step = stepId >= 0 ? evaluateArenaExpression(dae, stepId, parameters) : 1;
      const stop = evaluateArenaExpression(dae, dae.getExprRight(exprId), parameters);

      if (typeof start === "number" && typeof step === "number" && typeof stop === "number") {
        const arr: number[] = [];
        if (step > 0) {
          for (let i = start; i <= stop; i += step) arr.push(i);
        } else if (step < 0) {
          for (let i = start; i >= stop; i += step) arr.push(i);
        }
        return arr;
      }
      return null;
    }

    case ExprKind.Subscript: {
      const baseId = dae.getExprData1(exprId);
      const base = evaluateArenaExpression(dae, baseId, parameters);
      if (!Array.isArray(base)) return null;

      const idxCount = dae.getExprRight(exprId);
      const firstIdx = dae.getExprLeft(exprId);
      const idxIds = getSequenceElements(dae, exprId, idxCount, firstIdx);

      let current: ArenaValue = base;
      for (const id of idxIds) {
        if (!Array.isArray(current)) return null;
        const idx = evaluateArenaExpression(dae, id, parameters);
        // Modelica arrays are 1-indexed
        if (typeof idx !== "number" || idx < 1 || idx > current.length) return null;
        current = current[idx - 1] as ArenaValue;
      }
      return current;
    }
  }

  return null;
}

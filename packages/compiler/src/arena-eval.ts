import { evaluateArenaFunctionCall } from "./arena-ceval.js";
import { evaluateArrayBuiltin } from "./arena-eval-builtins.js";
import { ArenaDAEBuilder, BinOp, ExprKind, UnaryOp, Variability } from "./dae-arena.js";
import type { QueryDB, SymbolEntry, SymbolId } from "./runtime.js";

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

/** A record/object value produced by evaluating an ExprKind.Object expression. */
export interface ArenaObjectValue {
  readonly __kind: "object";
  readonly fields: Map<string, ArenaValue>;
}

export type ArenaValue = number | boolean | string | ArenaValue[] | ArenaObjectValue;

/** Type guard: is this ArenaValue a record/object? */
export function isArenaObject(v: ArenaValue): v is ArenaObjectValue {
  return typeof v === "object" && v !== null && !Array.isArray(v) && (v as ArenaObjectValue).__kind === "object";
}

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
  parameters = new Map<string, ArenaValue>(),
  db?: QueryDB,
  scopeId?: SymbolId,
  visitedVars = new Set<number>(),
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
      const paramVal = parameters.get(name);
      if (paramVal !== undefined) return paramVal;

      // Dotted member access: "a.b.c" → look up "a" in parameters and traverse fields
      const dotIdx = name.indexOf(".");
      if (dotIdx > 0) {
        const root = name.substring(0, dotIdx);
        const rest = name.substring(dotIdx + 1);
        let obj: ArenaValue | null = parameters.get(root) ?? null;
        if (obj === null) {
          // Try variable lookup for the root
          const rootIdx = dae.getVarIdxByName(root);
          if (rootIdx >= 0) {
            const bindExpr = dae.getVarExpression(rootIdx);
            if (typeof bindExpr === "number" && bindExpr >= 0) {
              if (visitedVars.has(rootIdx)) return null;
              visitedVars.add(rootIdx);
              try {
                obj = evaluateArenaExpression(dae, bindExpr, parameters, db, scopeId, visitedVars);
              } finally {
                visitedVars.delete(rootIdx);
              }
            }
          }
        }
        if (obj !== null && isArenaObject(obj)) {
          // Traverse dotted segments
          const segments = rest.split(".");
          let current: ArenaValue | undefined = obj;
          for (const seg of segments) {
            if (!isArenaObject(current)) return null;
            current = current.fields.get(seg);
            if (current === undefined) return null;
          }
          return current ?? null;
        }
      }

      const vIdx = dae.getVarIdxByName(name);
      if (vIdx >= 0) {
        if (dae.isVarFixed(vIdx)) {
          return dae.getVarStartValue(vIdx);
        }
        // For parameter/constant variables, try to evaluate the binding expression
        const variability = dae.getVarVariability(vIdx);
        if (variability === Variability.Parameter || variability === Variability.Constant) {
          const bindingExprId = dae.getVarExpression(vIdx);
          if (typeof bindingExprId === "number" && bindingExprId >= 0) {
            if (visitedVars.has(vIdx)) return null;
            visitedVars.add(vIdx);
            try {
              return evaluateArenaExpression(dae, bindingExprId, parameters, db, scopeId, visitedVars);
            } finally {
              visitedVars.delete(vIdx);
            }
          }
          // Fallback: use start value for parameters without binding expressions
          return dae.getVarStartValue(vIdx);
        }
      }

      // External resolution fallback via Salsa database for CSV virtual components and other constants
      if (db && scopeId !== undefined) {
        const resolveName = db.query<(q: string) => SymbolEntry | null>("resolveName", scopeId);
        if (resolveName) {
          const resolved = resolveName(name);
          if (resolved) {
            if (resolved.kind === "Component") {
              if (resolved.metadata) {
                const csvValue = resolved.metadata.csvValue;
                if (csvValue !== undefined) {
                  return csvValue as ArenaValue;
                }
              }
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const mod = db.query<any | null>("effectiveModification", resolved.id);
              if (mod && mod.bindingExpression) {
                const val = db.evaluate(mod.bindingExpression, resolved.parentId);
                if (val !== null && val !== undefined) {
                  return val as ArenaValue;
                }
              }
            }
          }
        }
      }

      return null;
    }

    case ExprKind.Unary: {
      const op = dae.getExprData1(exprId) as UnaryOp;
      const operand = evaluateArenaExpression(dae, dae.getExprLeft(exprId), parameters, db, scopeId, visitedVars);
      if (operand === null) return null;

      if (op === UnaryOp.Negate && typeof operand === "number") return -operand;
      if (op === UnaryOp.Not && typeof operand === "boolean") return !operand;
      return null;
    }

    case ExprKind.Binary: {
      const op = dae.getExprData1(exprId) as BinOp;
      const left = evaluateArenaExpression(dae, dae.getExprLeft(exprId), parameters, db, scopeId, visitedVars);
      const right = evaluateArenaExpression(dae, dae.getExprRight(exprId), parameters, db, scopeId, visitedVars);
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
      const cond = evaluateArenaExpression(dae, dae.getExprData1(exprId), parameters, db, scopeId, visitedVars);
      if (typeof cond === "boolean") {
        return cond
          ? evaluateArenaExpression(dae, dae.getExprLeft(exprId), parameters, db, scopeId, visitedVars)
          : evaluateArenaExpression(dae, dae.getExprRight(exprId), parameters, db, scopeId, visitedVars);
      }
      return null;
    }

    case ExprKind.Call: {
      const funcName = dae.interner.resolve(dae.getExprData1(exprId));
      if (!funcName) return null;
      const argCount = dae.getExprRight(exprId);
      const firstArg = dae.getExprLeft(exprId);
      const argIds = getSequenceElements(dae, exprId, argCount, firstArg);

      const args = argIds.map((id) => evaluateArenaExpression(dae, id, parameters, db, scopeId, visitedVars));
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
      if (funcName === "floor" && typeof args[0] === "number") return Math.floor(args[0]);
      if (funcName === "ceil" && typeof args[0] === "number") return Math.ceil(args[0]);
      if (funcName === "integer" && typeof args[0] === "number") return Math.floor(args[0]);
      if (funcName === "mod" && typeof args[0] === "number" && typeof args[1] === "number") {
        const b = args[1];
        return b !== 0 ? args[0] - Math.floor(args[0] / b) * b : null;
      }
      if (funcName === "rem" && typeof args[0] === "number" && typeof args[1] === "number") {
        const b = args[1];
        return b !== 0 ? args[0] - Math.trunc(args[0] / b) * b : null;
      }
      if (funcName === "div" && typeof args[0] === "number" && typeof args[1] === "number") {
        return args[1] !== 0 ? Math.trunc(args[0] / args[1]) : null;
      }
      if (funcName === "String") return String(args[0]);
      if (funcName === "noEvent" && args.length === 1) return args[0];
      if (funcName === "Real" && typeof args[0] === "number") return args[0];
      if (funcName === "Integer" && typeof args[0] === "number") return Math.floor(args[0]);
      if (funcName === "homotopy" && args.length >= 1) return args[0];
      if (funcName === "smooth" && args.length >= 2) return args[1];

      // Array and reduction built-in functions
      const arrayResult = evaluateArrayBuiltin(funcName, args as ArenaValue[]);
      if (arrayResult !== undefined) return arrayResult;

      // Fallback: User-defined compile-time function execution
      const funcNameId = dae.getExprData1(exprId);
      const userFuncResult = evaluateArenaFunctionCall(dae, funcNameId, args as ArenaValue[]);
      if (userFuncResult !== null) return userFuncResult;

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
      const elements = elemIds.map((id) => evaluateArenaExpression(dae, id, parameters, db, scopeId, visitedVars));
      if (elements.some((e) => e === null)) return null;
      return elements as ArenaValue[];
    }

    case ExprKind.Range: {
      const start = evaluateArenaExpression(dae, dae.getExprData1(exprId), parameters, db, scopeId, visitedVars);
      const stepId = dae.getExprLeft(exprId);
      const step = stepId >= 0 ? evaluateArenaExpression(dae, stepId, parameters, db, scopeId, visitedVars) : 1;
      const stop = evaluateArenaExpression(dae, dae.getExprRight(exprId), parameters, db, scopeId, visitedVars);

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
      const base = evaluateArenaExpression(dae, baseId, parameters, db, scopeId, visitedVars);
      if (!Array.isArray(base)) return null;

      const idxCount = dae.getExprRight(exprId);
      const firstIdx = dae.getExprLeft(exprId);
      const idxIds = getSequenceElements(dae, exprId, idxCount, firstIdx);

      let current: ArenaValue = base;
      for (const id of idxIds) {
        if (!Array.isArray(current)) return null;
        const idx = evaluateArenaExpression(dae, id, parameters, db, scopeId, visitedVars);
        // Modelica arrays are 1-indexed
        if (typeof idx !== "number" || idx < 1 || idx > current.length) return null;
        current = current[idx - 1] as ArenaValue;
      }
      return current;
    }

    case ExprKind.Object: {
      const fieldCount = dae.getExprData1(exprId);
      const fields = new Map<string, ArenaValue>();
      if (fieldCount > 0) {
        // First field: name StringId in right, value ExprId in left
        const firstName = dae.interner.resolve(dae.getExprRight(exprId));
        const firstVal = evaluateArenaExpression(dae, dae.getExprLeft(exprId), parameters, db, scopeId, visitedVars);
        if (firstName && firstVal !== null) fields.set(firstName, firstVal);
        // Subsequent fields via Tuple entries: name StringId in data1, value ExprId in left
        for (let i = 1; i < fieldCount; i++) {
          const fieldName = dae.interner.resolve(dae.getExprData1(exprId + i));
          const fieldVal = evaluateArenaExpression(
            dae,
            dae.getExprLeft(exprId + i),
            parameters,
            db,
            scopeId,
            visitedVars,
          );
          if (fieldName && fieldVal !== null) fields.set(fieldName, fieldVal);
        }
      }
      return { __kind: "object" as const, fields };
    }
  }

  return null;
}

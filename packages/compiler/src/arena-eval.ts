import { evaluateArrayBuiltin, evaluateBuiltinMathFunction } from "./arena-eval-builtins.js";
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

export function getSequenceElements(
  dae: ArenaDAEBuilder,
  baseExprId: number,
  count: number,
  firstElement: number,
): number[] {
  if (count === 0) return [];
  const elements = [firstElement];
  const kind = dae.getExprKind(baseExprId);
  const redirect = dae.getExprRight(baseExprId);
  // Only Call, Range, and ArrayCtor use redirect in 'right'
  const usesRedirect = kind === ExprKind.Call || kind === ExprKind.Range || kind === ExprKind.ArrayCtor;
  const actualBase = usesRedirect && redirect >= 0 ? redirect : baseExprId;
  for (let i = 1; i < count; i++) {
    const tupleId = actualBase + i;
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
  onlyConstants = false,
  functionLookup?: (funcNameId: number, args: ArenaValue[]) => ArenaValue | null,
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

      // Handle array subscripting where the name is e.g. "x[1]" and "x" is in parameters
      const match = name.match(/^([^[\]]+)\[([\d,]+)\]$/);
      if (match && match[1] && match[2]) {
        const root = match[1];
        const indices = match[2].split(",").map(Number);
        const rootVal = parameters.get(root);
        if (rootVal !== undefined && Array.isArray(rootVal)) {
          let current: ArenaValue = rootVal;
          let ok = true;
          for (const idx of indices) {
            if (Array.isArray(current) && idx >= 1 && idx <= current.length) {
              current = current[idx - 1] as ArenaValue;
            } else {
              ok = false;
              break;
            }
          }
          if (ok) return current;
        }
      }

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
                obj = evaluateArenaExpression(dae, bindExpr, parameters, db, scopeId, visitedVars, onlyConstants);
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
      if (vIdx < 0 && dae.hasArrayElements(name)) {
        const elements = dae.getArrayElementIndices(name);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result: any[] = [];
        for (const idx of elements) {
          if (dae.isVarFixed(idx)) {
            result.push(dae.getVarStartValue(idx));
          } else {
            const variability = dae.getVarVariability(idx);
            if (variability === Variability.Constant || (!onlyConstants && variability === Variability.Parameter)) {
              const bindingExprId = dae.getVarExpression(idx);
              if (typeof bindingExprId === "number" && bindingExprId >= 0) {
                if (!visitedVars.has(idx)) {
                  visitedVars.add(idx);
                  try {
                    result.push(
                      evaluateArenaExpression(
                        dae,
                        bindingExprId,
                        parameters,
                        db,
                        scopeId,
                        visitedVars,
                        onlyConstants,
                        functionLookup,
                      ),
                    );
                  } finally {
                    visitedVars.delete(idx);
                  }
                } else {
                  result.push(null);
                }
              } else {
                result.push(dae.getVarStartValue(idx));
              }
            } else {
              result.push(null);
            }
          }
        }
        return result;
      }

      if (vIdx >= 0) {
        if (dae.isVarFixed(vIdx)) {
          return dae.getVarStartValue(vIdx);
        }
        // For parameter/constant variables, try to evaluate the binding expression
        const variability = dae.getVarVariability(vIdx);
        if (variability === Variability.Constant || (!onlyConstants && variability === Variability.Parameter)) {
          const bindingExprId = dae.getVarExpression(vIdx);
          if (typeof bindingExprId === "number" && bindingExprId >= 0) {
            if (visitedVars.has(vIdx)) return null;
            visitedVars.add(vIdx);
            try {
              return evaluateArenaExpression(
                dae,
                bindingExprId,
                parameters,
                db,
                scopeId,
                visitedVars,
                onlyConstants,
                functionLookup,
              );
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
                const variability = resolved.metadata?.variability;
                if (variability === "constant" || (!onlyConstants && variability === "parameter")) {
                  const val = db.evaluate(mod.bindingExpression, resolved.parentId);
                  if (val !== null && val !== undefined) {
                    return val as ArenaValue;
                  }
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
      const operand = evaluateArenaExpression(
        dae,
        dae.getExprLeft(exprId),
        parameters,
        db,
        scopeId,
        visitedVars,
        onlyConstants,
      );
      if (operand === null) return null;

      if (op === UnaryOp.Negate && typeof operand === "number") return -operand;
      if (op === UnaryOp.Not && typeof operand === "boolean") return !operand;
      return null;
    }

    case ExprKind.Binary: {
      const op = dae.getExprData1(exprId) as BinOp;
      const left = evaluateArenaExpression(
        dae,
        dae.getExprLeft(exprId),
        parameters,
        db,
        scopeId,
        visitedVars,
        onlyConstants,
        functionLookup,
      );
      const right = evaluateArenaExpression(
        dae,
        dae.getExprRight(exprId),
        parameters,
        db,
        scopeId,
        visitedVars,
        onlyConstants,
        functionLookup,
      );
      if (left === null || right === null) return null;

      if (Array.isArray(left) || Array.isArray(right) || (typeof left === "number" && typeof right === "number")) {
        const applyBinOp = (a: ArenaValue, b: ArenaValue, op: BinOp): ArenaValue | null => {
          if (Array.isArray(a) && Array.isArray(b)) {
            if (a.length !== b.length) return null;
            const res = a.map((val, idx) => {
              const bVal = b[idx];
              if (bVal === undefined) return null;
              return applyBinOp(val, bVal, op);
            });
            if (res.includes(null)) return null;
            return res as ArenaValue;
          } else if (Array.isArray(a)) {
            const res = a.map((val) => applyBinOp(val, b, op));
            if (res.includes(null)) return null;
            return res as ArenaValue;
          } else if (Array.isArray(b)) {
            const res = b.map((val) => applyBinOp(a, val, op));
            if (res.includes(null)) return null;
            return res as ArenaValue;
          }

          if (typeof a === "number" && typeof b === "number") {
            switch (op) {
              case BinOp.Add:
              case BinOp.ElemAdd:
                return a + b;
              case BinOp.Sub:
              case BinOp.ElemSub:
                return a - b;
              case BinOp.Mul:
              case BinOp.ElemMul:
                return a * b;
              case BinOp.Div:
              case BinOp.ElemDiv:
                return a / b;
              case BinOp.Pow:
              case BinOp.ElemPow:
                return Math.pow(a, b);
              case BinOp.Eq:
                return a === b;
              case BinOp.Neq:
                return a !== b;
              case BinOp.Lt:
                return a < b;
              case BinOp.Lte:
                return a <= b;
              case BinOp.Gt:
                return a > b;
              case BinOp.Gte:
                return a >= b;
            }
          }
          return null;
        };
        const res = applyBinOp(left, right, op);
        if (res !== null) return res;
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
      const cond = evaluateArenaExpression(
        dae,
        dae.getExprData1(exprId),
        parameters,
        db,
        scopeId,
        visitedVars,
        onlyConstants,
        functionLookup,
      );
      if (typeof cond === "boolean") {
        return cond
          ? evaluateArenaExpression(
              dae,
              dae.getExprLeft(exprId),
              parameters,
              db,
              scopeId,
              visitedVars,
              onlyConstants,
              functionLookup,
            )
          : evaluateArenaExpression(
              dae,
              dae.getExprRight(exprId),
              parameters,
              db,
              scopeId,
              visitedVars,
              onlyConstants,
              functionLookup,
            );
      }
      return null;
    }

    case ExprKind.Call: {
      const funcName = dae.interner.resolve(dae.getExprData1(exprId));
      if (!funcName) return null;
      const argCount = dae.getExprRight(exprId);
      const firstArg = dae.getExprLeft(exprId);
      const argIds = getSequenceElements(dae, exprId, argCount, firstArg);

      // Special case for /*Real*/ / /*Integer*/ which are internal AST markers
      if ((funcName === "/*Real*/" || funcName === "/*Integer*/") && argCount === 1) {
        const firstArgId = argIds[0];
        if (firstArgId !== undefined) {
          return evaluateArenaExpression(
            dae,
            firstArgId,
            parameters,
            db,
            scopeId,
            visitedVars,
            onlyConstants,
            functionLookup,
          );
        }
      }

      // Special case for 'size' and 'ndims': we only need the shape of the array, not its value.
      // If the argument is a variable name, we can inspect the DAE for its array dimensions.
      if ((funcName === "size" || funcName === "ndims") && argCount >= 1) {
        const firstArgId = argIds[0];
        if (firstArgId !== undefined && dae.getExprKind(firstArgId) === ExprKind.Name) {
          const varName = dae.interner.resolve(dae.getExprData1(firstArgId));
          if (varName) {
            let shape: number[] | null = null;
            const varIdx = dae.getVarIdxByName(varName);
            if (varIdx >= 0) {
              const varShape = dae.getVarShape(varIdx);
              if (varShape && varShape.length > 0 && !varShape.includes(0)) shape = varShape;
            } else if (dae.hasArrayElements(varName)) {
              const elements = dae.getArrayElementIndices(varName);
              if (elements.length > 0) {
                const lastIdx = elements[elements.length - 1];
                if (lastIdx !== undefined) {
                  const lastElemName = dae.getVarName(lastIdx);
                  const match = lastElemName.match(/\[([\d,]+)\]$/);
                  if (match && match[1]) {
                    shape = match[1].split(",").map(Number);
                  }
                }
              }
            }
            if (shape && shape.length > 0 && !shape.includes(0)) {
              if (funcName === "ndims") return shape.length;
              if (funcName === "size") {
                if (argCount === 1) return shape;
                const dimArgId = argIds[1];
                if (dimArgId !== undefined) {
                  const dim = evaluateArenaExpression(
                    dae,
                    dimArgId,
                    parameters,
                    db,
                    scopeId,
                    visitedVars,
                    onlyConstants,
                    functionLookup,
                  );
                  if (typeof dim === "number" && dim >= 1 && dim <= shape.length) {
                    return shape[dim - 1] ?? null;
                  }
                }
              }
            }
          }
        } else if (firstArgId !== undefined && dae.getExprKind(firstArgId) === ExprKind.Call) {
          const callFuncNameId = dae.getExprData1(firstArgId);
          const fnDae = dae.functions.get(callFuncNameId);
          if (fnDae) {
            let shapeExprs: number[] | undefined;
            let shape: number[] | null = null;
            for (let i = 0; i < fnDae.varCount; i++) {
              if (fnDae.getVarCausality(i) === 2 /* Output */) {
                const varShape = fnDae.getVarShape(i);
                if (varShape && varShape.length > 0 && !varShape.includes(0)) shape = varShape;
                else shapeExprs = fnDae.getVarShapeExprs(i);
                break;
              }
            }
            if (shape && shape.length > 0 && !shape.includes(0)) {
              if (funcName === "ndims") return shape.length;
              if (funcName === "size") {
                if (argCount === 1) return shape;
                const dimArgId = argIds[1];
                if (dimArgId !== undefined) {
                  const dim = evaluateArenaExpression(
                    dae,
                    dimArgId,
                    parameters,
                    db,
                    scopeId,
                    visitedVars,
                    onlyConstants,
                    functionLookup,
                  );
                  if (typeof dim === "number" && dim >= 1 && dim <= shape.length) {
                    return shape[dim - 1] ?? null;
                  }
                }
              }
            }
            if (shapeExprs && shapeExprs.length > 0) {
              // we will implement it later if needed
            }
          }
        } else if (firstArgId !== undefined && dae.getExprKind(firstArgId) === ExprKind.ArrayCtor) {
          const elementsCount = dae.getExprData1(firstArgId);
          const shape = [elementsCount];
          const firstElementId = dae.getExprLeft(firstArgId);
          if (firstElementId >= 0 && dae.getExprKind(firstElementId) === ExprKind.ArrayCtor) {
            shape.push(dae.getExprData1(firstElementId));
          }
          if (funcName === "ndims") return shape.length;
          if (funcName === "size") {
            if (argCount === 1) return shape;
            const dimArgId = argIds[1];
            if (dimArgId !== undefined) {
              const dim = evaluateArenaExpression(
                dae,
                dimArgId,
                parameters,
                db,
                scopeId,
                visitedVars,
                onlyConstants,
                functionLookup,
              );
              if (typeof dim === "number" && dim >= 1 && dim <= shape.length) {
                return shape[dim - 1] ?? null;
              }
            }
          }
        }
      }

      const args = argIds.map((id) =>
        evaluateArenaExpression(dae, id, parameters, db, scopeId, visitedVars, onlyConstants, functionLookup),
      );
      if (args.some((a) => a === null)) return null;

      const mathRes = evaluateBuiltinMathFunction(funcName, args as ArenaValue[]);
      if (mathRes !== undefined) return mathRes;
      if (funcName === "rem" && typeof args[0] === "number" && typeof args[1] === "number") {
        const b = args[1];
        return b !== 0 ? args[0] - Math.trunc(args[0] / b) * b : null;
      }
      if (funcName === "div" && typeof args[0] === "number" && typeof args[1] === "number") {
        return args[1] !== 0 ? Math.trunc(args[0] / args[1]) : null;
      }
      if (funcName === "String") return String(args[0]);
      if (funcName === "noEvent" && args.length === 1) return args[0];
      if (funcName === "Real" && args.length === 1) return args[0];
      if (funcName === "Integer" && args.length === 1) {
        if (typeof args[0] === "number") return Math.floor(args[0]);
        // For array, technically we should floor recursively, but for simplicity we return as is
        // since JS numbers are the same.
        return args[0];
      }
      if (funcName === "homotopy" && args.length >= 1) return args[0];
      if (funcName === "smooth" && args.length >= 2) return args[1];

      // Array and reduction built-in functions
      const arrayResult = evaluateArrayBuiltin(funcName, args as ArenaValue[]);
      if (arrayResult !== undefined) return arrayResult;

      // Fallback: User-defined compile-time function execution
      if (functionLookup) {
        const funcNameId = dae.getExprData1(exprId);
        const userFuncResult = functionLookup(funcNameId, args as ArenaValue[]);
        if (userFuncResult !== null) {
          // If the function returns multiple outputs, evaluateArenaFunctionCall returns an array of them.
          // In Modelica, when a multi-output function is called in an expression, only the first result is returned.
          const fnDae = dae.functions.get(funcNameId);
          if (fnDae && Array.isArray(userFuncResult)) {
            let outCount = 0;
            for (let i = 0; i < fnDae.varCount; i++) {
              if (fnDae.getVarCausality(i) === 2 /* Output */) outCount++;
            }
            if (outCount > 1 && userFuncResult.length > 0) {
              return userFuncResult[0] as ArenaValue;
            }
          }
          return userFuncResult;
        }
      }

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
      const elements = elemIds.map((id) =>
        evaluateArenaExpression(dae, id, parameters, db, scopeId, visitedVars, onlyConstants, functionLookup),
      );
      if (elements.some((e) => e === null)) return null;
      return elements as ArenaValue[];
    }

    case ExprKind.Range: {
      const start = evaluateArenaExpression(
        dae,
        dae.getExprData1(exprId),
        parameters,
        db,
        scopeId,
        visitedVars,
        onlyConstants,
        functionLookup,
      );
      const stepId = dae.getExprLeft(exprId);
      const step =
        stepId >= 0 ? evaluateArenaExpression(dae, stepId, parameters, db, scopeId, visitedVars, onlyConstants) : 1;
      const stop = evaluateArenaExpression(
        dae,
        dae.getExprRight(exprId),
        parameters,
        db,
        scopeId,
        visitedVars,
        onlyConstants,
      );

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
      const base = evaluateArenaExpression(dae, baseId, parameters, db, scopeId, visitedVars, onlyConstants);
      if (!Array.isArray(base)) {
        // console.error(`[DEBUG SUBSCRIPT FAIL 1] baseId=${baseId} base=${JSON.stringify(base)}`);
        return null;
      }

      const idxCount = dae.getExprRight(exprId);
      const firstIdx = dae.getExprLeft(exprId);
      const idxIds = getSequenceElements(dae, exprId, idxCount, firstIdx);

      let current: ArenaValue = base;
      for (const id of idxIds) {
        if (!Array.isArray(current)) {
          // console.error(`[DEBUG SUBSCRIPT FAIL 2] current=${JSON.stringify(current)}`);
          return null;
        }
        const idx = evaluateArenaExpression(dae, id, parameters, db, scopeId, visitedVars, onlyConstants);
        // Modelica arrays are 1-indexed
        if (typeof idx !== "number" || idx < 1 || idx > current.length) {
          // console.error(`[DEBUG SUBSCRIPT FAIL 3] idx=${idx} current.length=${current.length}`);
          return null;
        }
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
        const firstVal = evaluateArenaExpression(
          dae,
          dae.getExprLeft(exprId),
          parameters,
          db,
          scopeId,
          visitedVars,
          onlyConstants,
        );
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
            onlyConstants,
          );
          if (fieldName && fieldVal !== null) fields.set(fieldName, fieldVal);
        }
      }
      return { __kind: "object" as const, fields };
    }
  }

  // console.error(`[DEBUG EVAL FAIL] exprId=${exprId} kind=${kind} returned null!`);
  return null;
}

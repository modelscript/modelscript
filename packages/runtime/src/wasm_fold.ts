// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Generic WASM Constant Folding & Algebraic Reduction Framework.
 * Operates directly on DAEBuilder and WebAssembly memory buffers.
 */

import type { QueryDB, SymbolEntry, SymbolId } from "./runtime.js";
import { BinOp, DAEBuilder, EqKind, ExprKind, StmtKind, UnaryOp, Variability, VarType } from "./wasm_dae.js";
import { evaluateArenaFunctionCall } from "./wasm_statement_executor.js";

export type ArenaConstantValue = number | boolean | string | ArenaConstantValue[];

/**
 * Evaluates an elementary math function on constant real inputs.
 */
function evalMathBuiltin(funcName: string, arg1: number, arg2: number): number | null {
  switch (funcName.toLowerCase()) {
    case "sin":
      return Math.sin(arg1);
    case "cos":
      return Math.cos(arg1);
    case "tan":
      return Math.tan(arg1);
    case "asin":
      return Math.asin(arg1);
    case "acos":
      return Math.acos(arg1);
    case "atan":
      return Math.atan(arg1);
    case "atan2":
      return Math.atan2(arg1, arg2);
    case "sinh":
      return Math.sinh(arg1);
    case "cosh":
      return Math.cosh(arg1);
    case "tanh":
      return Math.tanh(arg1);
    case "exp":
      return Math.exp(arg1);
    case "log":
      return arg1 > 0 ? Math.log(arg1) : 0.0;
    case "log10":
      return arg1 > 0 ? Math.log10(arg1) : 0.0;
    case "sqrt":
      return arg1 >= 0 ? Math.sqrt(arg1) : 0.0;
    case "abs":
      return Math.abs(arg1);
    case "sign":
      return arg1 > 0 ? 1.0 : arg1 < 0 ? -1.0 : 0.0;
    case "min":
      return Math.min(arg1, arg2);
    case "max":
      return Math.max(arg1, arg2);
    case "floor":
      return Math.floor(arg1);
    case "ceil":
      return Math.ceil(arg1);
    case "pow":
      return Math.pow(arg1, arg2);
    default:
      return null;
  }
}

/**
 * Evaluates an expression node in DAEBuilder to a scalar constant if possible.
 */
export function evaluateConstantArenaExpression(
  arena: DAEBuilder,
  exprId: number,
  paramMap?: Map<string, number>,
  nameToIdx?: Map<string, number>,
  visitedDepth = 0,
  db?: QueryDB,
  scopeId?: SymbolId,
): number | boolean | number[] | null {
  if (exprId < 0 || exprId >= arena.exprCount || visitedDepth > 100) {
    return null;
  }

  const kind = arena.getExprKind(exprId);

  if (kind === ExprKind.RealLiteral) {
    return arena.getExprRealValue(exprId);
  }

  if (kind === ExprKind.IntLiteral) {
    return arena.getExprData1(exprId);
  }

  if (kind === ExprKind.BoolLiteral) {
    return arena.getExprData1(exprId) !== 0;
  }

  if (kind === ExprKind.Name) {
    const nameId = arena.getExprData1(exprId);
    const varName = arena.interner.resolve(nameId);
    if (paramMap) {
      if (paramMap.has(varName)) {
        return paramMap.get(varName) ?? null;
      }
    }
    const varIdx = nameToIdx ? nameToIdx.get(varName) : arena.getVarIdxByName(varName);
    if (varIdx !== undefined && varIdx >= 0 && !arena.isVarRemoved(varIdx)) {
      const variability = arena.getVarVariability(varIdx);
      if (variability !== Variability.Constant && variability !== Variability.Parameter) {
        return null;
      }
      const bindExpr = arena.getVarExpression(varIdx);
      if (bindExpr !== undefined && bindExpr >= 0 && bindExpr !== exprId) {
        const val = evaluateConstantArenaExpression(
          arena,
          bindExpr,
          paramMap,
          nameToIdx,
          visitedDepth + 1,
          db,
          scopeId,
        );
        if (val !== null) return val;
      }
      return arena.getVarStartValue(varIdx);
    }
    if (db && scopeId !== undefined) {
      const resolveName = db.query<(q: string) => SymbolEntry | null>("resolveName", scopeId);
      if (resolveName) {
        const resolved = resolveName(varName);
        if (resolved) {
          if (resolved.kind === "Component") {
            if (resolved.metadata) {
              const csvValue = (resolved.metadata as any).csvValue;
              if (csvValue !== undefined) {
                return csvValue;
              }
            }
            const variability =
              (resolved.metadata as any)?.variability ?? db.query<string | null>("variability", resolved.id);
            if (variability === "constant" || variability === "parameter") {
              const mod = db.query<any | null>("effectiveModification", resolved.id);
              if (mod?.bindingExpression) {
                try {
                  const evalVal = db.evaluate(mod.bindingExpression, resolved.parentId);
                  if (typeof evalVal === "number" || typeof evalVal === "boolean") {
                    return evalVal;
                  }
                  if (Array.isArray(evalVal)) {
                    return evalVal;
                  }
                } catch {
                  // ignore evaluation failure
                }
              }
            }
          }
        } else if (varName.includes("[") || varName.includes(".")) {
          try {
            const evalVal = db.evaluate(varName, scopeId);
            if (typeof evalVal === "number" || typeof evalVal === "boolean") {
              return evalVal;
            }
            if (Array.isArray(evalVal)) {
              return evalVal;
            }
          } catch {
            // ignore evaluation failure
          }
        }
      }
    }
    return null;
  }

  if (kind === ExprKind.Negate) {
    const childId = arena.getExprLeft(exprId);
    const childVal = evaluateConstantArenaExpression(
      arena,
      childId,
      paramMap,
      nameToIdx,
      visitedDepth + 1,
      db,
      scopeId,
    );
    if (typeof childVal === "number") return -childVal;
    return null;
  }

  if (kind === ExprKind.ArrayCtor) {
    const count = arena.getExprData1(exprId);
    if (count === 0) return [];
    const elements: any[] = [];
    for (let i = 0; i < count; i++) {
      const elemExprId = i === 0 ? arena.getExprLeft(exprId) : arena.getExprLeft(exprId + i);
      const val = evaluateConstantArenaExpression(
        arena,
        elemExprId,
        paramMap,
        nameToIdx,
        visitedDepth + 1,
        db,
        scopeId,
      );
      if (val === null) return null;
      elements.push(val);
    }
    return elements;
  }

  if (kind === ExprKind.Unary) {
    const op = arena.getExprData1(exprId);
    const childId = arena.getExprLeft(exprId);
    const childVal = evaluateConstantArenaExpression(
      arena,
      childId,
      paramMap,
      nameToIdx,
      visitedDepth + 1,
      db,
      scopeId,
    );
    if (childVal === null) return null;

    if (op === UnaryOp.Not) {
      if (typeof childVal === "boolean") return !childVal;
      if (typeof childVal === "number") return childVal === 0;
    } else if (op === UnaryOp.Negate) {
      if (typeof childVal === "number") return -childVal;
    }
    return null;
  }

  if (kind === ExprKind.Binary) {
    const op = arena.getExprData1(exprId);
    const leftId = arena.getExprLeft(exprId);
    const rightId = arena.getExprRight(exprId);

    const lVal = evaluateConstantArenaExpression(arena, leftId, paramMap, nameToIdx, visitedDepth + 1, db, scopeId);
    const rVal = evaluateConstantArenaExpression(arena, rightId, paramMap, nameToIdx, visitedDepth + 1, db, scopeId);

    if (lVal === null || rVal === null) return null;

    const lNum = typeof lVal === "boolean" ? (lVal ? 1 : 0) : typeof lVal === "number" ? lVal : null;
    const rNum = typeof rVal === "boolean" ? (rVal ? 1 : 0) : typeof rVal === "number" ? rVal : null;
    if (lNum === null || rNum === null) return null;

    switch (op) {
      case BinOp.Add:
        return lNum + rNum;
      case BinOp.Sub:
        return lNum - rNum;
      case BinOp.Mul:
        return lNum * rNum;
      case BinOp.Div:
        return rNum !== 0 ? lNum / rNum : 0;
      case BinOp.Pow:
        return Math.pow(lNum, rNum);
      case BinOp.Eq:
        return lNum === rNum;
      case BinOp.Neq:
        return lNum !== rNum;
      case BinOp.Lt:
        return lNum < rNum;
      case BinOp.Lte:
        return lNum <= rNum;
      case BinOp.Gt:
        return lNum > rNum;
      case BinOp.Gte:
        return lNum >= rNum;
      case BinOp.And:
        return lVal !== false && lVal !== 0 && rVal !== false && rVal !== 0;
      case BinOp.Or:
        return (lVal !== false && lVal !== 0) || (rVal !== false && rVal !== 0);
    }
  }

  if (kind === ExprKind.IfElse) {
    const condId = arena.getExprData1(exprId);
    const condVal = evaluateConstantArenaExpression(arena, condId, paramMap, nameToIdx, visitedDepth + 1, db, scopeId);
    if (condVal !== null) {
      const isTrue = typeof condVal === "boolean" ? condVal : condVal !== 0;
      const branchId = isTrue ? arena.getExprLeft(exprId) : arena.getExprRight(exprId);
      return evaluateConstantArenaExpression(arena, branchId, paramMap, nameToIdx, visitedDepth + 1, db, scopeId);
    }
  }

  if (kind === ExprKind.Call) {
    const funcName = arena.interner.resolve(arena.getExprData1(exprId));
    if (
      funcName === "sample" ||
      funcName === "edge" ||
      funcName === "change" ||
      funcName === "initial" ||
      funcName === "terminal" ||
      funcName === "pre" ||
      funcName === "der"
    ) {
      return null;
    }
    const argCount = arena.getExprRight(exprId);
    const getCallArg = (i: number): number => {
      return i === 0 ? arena.getExprLeft(exprId) : arena.getExprLeft(exprId + i);
    };

    if (funcName === "linspace" && argCount >= 3) {
      const a1 = evaluateConstantArenaExpression(
        arena,
        getCallArg(0),
        paramMap,
        nameToIdx,
        visitedDepth + 1,
        db,
        scopeId,
      );
      const a2 = evaluateConstantArenaExpression(
        arena,
        getCallArg(1),
        paramMap,
        nameToIdx,
        visitedDepth + 1,
        db,
        scopeId,
      );
      const a3 = evaluateConstantArenaExpression(
        arena,
        getCallArg(2),
        paramMap,
        nameToIdx,
        visitedDepth + 1,
        db,
        scopeId,
      );
      if (typeof a1 === "number" && typeof a2 === "number" && typeof a3 === "number") {
        const n = Math.trunc(a3);
        if (n >= 2) {
          const result: number[] = [];
          const step = (a2 - a1) / (n - 1);
          for (let i = 0; i < n; i++) {
            result.push(i === 0 ? a1 : i === n - 1 ? a2 : a1 + i * step);
          }
          return result;
        }
      }
      return null;
    }

    if (funcName === "/*Real*/" || funcName === "Real") {
      const val = evaluateConstantArenaExpression(
        arena,
        getCallArg(0),
        paramMap,
        nameToIdx,
        visitedDepth + 1,
        db,
        scopeId,
      );
      if (typeof val === "number") return val;
      if (typeof val === "boolean") return val ? 1.0 : 0.0;
      if (Array.isArray(val)) return val.map((v) => (typeof v === "number" ? v : Number(v)));
      return null;
    }

    if (funcName === "fill" && argCount >= 2) {
      const val = evaluateConstantArenaExpression(
        arena,
        getCallArg(0),
        paramMap,
        nameToIdx,
        visitedDepth + 1,
        db,
        scopeId,
      );
      const count = evaluateConstantArenaExpression(
        arena,
        getCallArg(1),
        paramMap,
        nameToIdx,
        visitedDepth + 1,
        db,
        scopeId,
      );
      if (val !== null && typeof count === "number") {
        const n = Math.trunc(count);
        if (n >= 0) {
          const result: any[] = [];
          for (let i = 0; i < n; i++) result.push(val);
          return result;
        }
      }
      return null;
    }

    if (funcName === "size" && argCount >= 1) {
      const arrArg = getCallArg(0);
      let dim = 1;
      if (argCount >= 2) {
        const dimVal = evaluateConstantArenaExpression(
          arena,
          getCallArg(1),
          paramMap,
          nameToIdx,
          visitedDepth + 1,
          db,
          scopeId,
        );
        if (typeof dimVal === "number") dim = Math.trunc(dimVal);
      }
      if (arrArg >= 0) {
        const arrKind = arena.getExprKind(arrArg);
        if (arrKind === ExprKind.ArrayCtor) {
          if (dim === 1) {
            return arena.getExprData1(arrArg);
          }
          let cur = arrArg;
          for (let d = 1; d < dim; d++) {
            if (arena.getExprKind(cur) === ExprKind.ArrayCtor && arena.getExprData1(cur) > 0) {
              cur = arena.getExprLeft(cur);
            } else {
              break;
            }
          }
          if (arena.getExprKind(cur) === ExprKind.ArrayCtor) {
            return arena.getExprData1(cur);
          }
        }
        if (arrKind === ExprKind.Name) {
          const name = arena.interner.resolve(arena.getExprData1(arrArg));
          if (name) {
            const vIdx = nameToIdx ? nameToIdx.get(name) : arena.getVarIdxByName(name);
            if (vIdx !== undefined && vIdx >= 0) {
              const shape = arena.getVarShape(vIdx);
              if (shape && shape.length >= dim) {
                return shape[dim - 1];
              }
            }
            let maxDim = 0;
            const prefixMatch = `${name}[`;
            for (let i = 0; i < arena.varCount; i++) {
              if (!arena.isVarRemoved(i)) {
                const vn = arena.getVarName(i);
                if (vn.startsWith(prefixMatch)) {
                  const rest = vn.slice(prefixMatch.length);
                  const endBracket = rest.indexOf("]");
                  if (endBracket >= 0) {
                    const idxList = rest.slice(0, endBracket).split(",");
                    if (dim >= 1 && dim <= idxList.length) {
                      const val = parseInt(idxList[dim - 1]!.trim(), 10);
                      if (!isNaN(val) && val > maxDim) {
                        maxDim = val;
                      }
                    }
                  }
                }
              }
            }
            if (maxDim > 0) return maxDim;
            let count = 0;
            while (arena.getVarIdxByName(`${name}[${count + 1}]`) >= 0) count++;
            if (count > 0 && dim === 1) return count;
          }
        }
        if (arrKind === ExprKind.Call) {
          const innerFn = arena.interner.resolve(arena.getExprData1(arrArg));
          if (innerFn === "fill") {
            const fillCount = evaluateConstantArenaExpression(
              arena,
              arena.getExprLeft(arrArg + 1),
              paramMap,
              nameToIdx,
              visitedDepth + 1,
              db,
              scopeId,
            );
            if (typeof fillCount === "number" && dim === 1) return Math.trunc(fillCount);
          }
        }
      }
      return null;
    }

    if (argCount >= 1 && getCallArg(0) >= 0) {
      const arg1 = evaluateConstantArenaExpression(
        arena,
        getCallArg(0),
        paramMap,
        nameToIdx,
        visitedDepth + 1,
        db,
        scopeId,
      );
      if (Array.isArray(arg1) && argCount === 1) {
        const flat = (arg1 as any[]).flat(Infinity) as number[];
        if (flat.length === 0) return null;
        if (funcName === "max") return Math.max(...flat);
        if (funcName === "min") return Math.min(...flat);
        if (funcName === "sum") return flat.reduce((a, b) => a + b, 0);
        if (funcName === "product") return flat.reduce((a, b) => a * b, 1);
      }
      if (typeof arg1 === "number") {
        let arg2 = 0.0;
        if (argCount >= 2) {
          const arg2Val = evaluateConstantArenaExpression(
            arena,
            getCallArg(1),
            paramMap,
            nameToIdx,
            visitedDepth + 1,
            db,
            scopeId,
          );
          if (typeof arg2Val !== "number") return null;
          arg2 = arg2Val;
        }
        if (argCount <= 2) {
          return evalMathBuiltin(funcName, arg1, arg2);
        }
      }

      const fnBridge = arena.getFunction(funcName);
      if (fnBridge) {
        const args: any[] = [];
        let allOk = true;
        for (let i = 0; i < argCount; i++) {
          const val = evaluateConstantArenaExpression(
            arena,
            getCallArg(i),
            paramMap,
            nameToIdx,
            visitedDepth + 1,
            db,
            scopeId,
          );
          if (val === null) {
            allOk = false;
            break;
          }
          args.push(val);
        }
        if (allOk) {
          const fnInternId = arena.interner.intern(funcName);
          const res = evaluateArenaFunctionCall(arena, fnInternId, args, db, scopeId);
          if (res !== null) return res as any;
        }
      }
    }
  }

  return null;
}

/**
 * Simplifies an expression by resolving IfElse branches whose condition evaluates to constant.
 */
export function simplifyArenaIfElse(
  arena: DAEBuilder,
  exprId: number,
  paramMap?: Map<string, number>,
  nameToIdx?: Map<string, number>,
): number {
  if (exprId < 0) return exprId;
  const kind = arena.getExprKind(exprId);
  if (kind === ExprKind.IfElse) {
    const condId = arena.getExprData1(exprId);
    const condVal = evaluateConstantArenaExpression(arena, condId, paramMap, nameToIdx);
    if (condVal !== null) {
      const isTrue = typeof condVal === "boolean" ? condVal : condVal !== 0;
      const branchId = isTrue ? arena.getExprLeft(exprId) : arena.getExprRight(exprId);
      return simplifyArenaIfElse(arena, branchId, paramMap, nameToIdx);
    }
  }
  return exprId;
}

/**
 * Recursively substitute known constant variables in an expression with their literal values.
 */
export function substituteArenaConstants(
  arena: DAEBuilder,
  exprId: number,
  constMap: Map<string, number>,
  nameToIdx?: Map<string, number>,
): number {
  if (exprId < 0 || exprId >= arena.exprCount || constMap.size === 0) return exprId;
  const kind = arena.getExprKind(exprId);
  switch (kind) {
    case ExprKind.Name: {
      const nameId = arena.getExprData1(exprId);
      const varName = arena.interner.resolve(nameId);
      if (constMap.has(varName)) {
        const val = constMap.get(varName)!;
        const varIdx = nameToIdx?.get(varName);
        const varType = varIdx !== undefined ? arena.getVarType(varIdx) : VarType.Real;
        if (varType === VarType.Integer) {
          return arena.addIntLiteral(Math.trunc(val));
        } else if (varType === VarType.Boolean) {
          return arena.addBoolLiteral(Boolean(val));
        } else {
          return arena.addRealLiteral(val);
        }
      }
      return exprId;
    }
    case ExprKind.Binary: {
      const op = arena.getExprData1(exprId);
      const left = substituteArenaConstants(arena, arena.getExprLeft(exprId), constMap, nameToIdx);
      const right = substituteArenaConstants(arena, arena.getExprRight(exprId), constMap, nameToIdx);
      const newBinId =
        left !== arena.getExprLeft(exprId) || right !== arena.getExprRight(exprId)
          ? arena.addBinaryExpr(op, left, right)
          : exprId;
      if (op !== BinOp.Colon) {
        const folded = evaluateConstantArenaExpression(arena, newBinId, constMap, nameToIdx, 0);
        if (typeof folded === "number") {
          if (op === BinOp.Div) {
            return arena.addRealLiteral(folded);
          }
          return Number.isInteger(folded) ? arena.addIntLiteral(folded) : arena.addRealLiteral(folded);
        }
        if (typeof folded === "boolean") {
          return arena.addBoolLiteral(folded);
        }
      }
      return newBinId;
    }
    case ExprKind.Unary: {
      const op = arena.getExprData1(exprId);
      const left = substituteArenaConstants(arena, arena.getExprLeft(exprId), constMap, nameToIdx);
      if (left !== arena.getExprLeft(exprId)) {
        return arena.addUnaryExpr(op, left);
      }
      return exprId;
    }
    case ExprKind.Negate: {
      const left = substituteArenaConstants(arena, arena.getExprLeft(exprId), constMap, nameToIdx);
      const newNegId = left !== arena.getExprLeft(exprId) ? arena.addExpression(ExprKind.Negate, 0, left) : exprId;
      const folded = evaluateConstantArenaExpression(arena, newNegId, constMap, nameToIdx, 0);
      if (typeof folded === "number") {
        return Number.isInteger(folded) ? arena.addIntLiteral(folded) : arena.addRealLiteral(folded);
      }
      return newNegId;
    }
    case ExprKind.Der: {
      const data1 = substituteArenaConstants(arena, arena.getExprData1(exprId), constMap, nameToIdx);
      if (data1 !== arena.getExprData1(exprId)) {
        return arena.addDerExpr(data1);
      }
      return exprId;
    }
    case ExprKind.Pre: {
      const data1 = substituteArenaConstants(arena, arena.getExprData1(exprId), constMap, nameToIdx);
      if (data1 !== arena.getExprData1(exprId)) {
        return arena.addPreExpr(data1);
      }
      return exprId;
    }
    case ExprKind.IfElse: {
      const cond = substituteArenaConstants(arena, arena.getExprData1(exprId), constMap, nameToIdx);
      const left = substituteArenaConstants(arena, arena.getExprLeft(exprId), constMap, nameToIdx);
      const right = substituteArenaConstants(arena, arena.getExprRight(exprId), constMap, nameToIdx);
      const condKind = arena.getExprKind(cond);
      if (condKind === ExprKind.BoolLiteral) {
        return arena.getExprData1(cond) !== 0 ? left : right;
      }
      if (condKind === ExprKind.IntLiteral) {
        return arena.getExprData1(cond) !== 0 ? left : right;
      }
      if (
        cond !== arena.getExprData1(exprId) ||
        left !== arena.getExprLeft(exprId) ||
        right !== arena.getExprRight(exprId)
      ) {
        return arena.addIfElseExpr(cond, left, right);
      }
      return exprId;
    }
    case ExprKind.Call: {
      const funcNameId = arena.getExprData1(exprId);
      const argCount = arena.getExprRight(exprId);
      let anyChanged = false;
      const args: number[] = [];
      for (let i = 0; i < argCount; i++) {
        const argExprId = i === 0 ? arena.getExprLeft(exprId) : arena.getExprLeft(exprId + i);
        const newArg = substituteArenaConstants(arena, argExprId, constMap, nameToIdx);
        args.push(newArg);
        if (newArg !== argExprId) anyChanged = true;
      }
      const fnName = arena.interner.resolve(funcNameId) || "";
      const callId = anyChanged ? arena.addCallExpr(fnName, args) : exprId;
      const folded = evaluateConstantArenaExpression(arena, callId, constMap, nameToIdx, 0);
      if (typeof folded === "number") {
        if (fnName === "/*Real*/" || fnName === "Real") {
          return arena.addRealLiteral(folded);
        }
        return Number.isInteger(folded) ? arena.addIntLiteral(folded) : arena.addRealLiteral(folded);
      }
      if (typeof folded === "boolean") {
        return arena.addBoolLiteral(folded);
      }
      return callId;
    }
    case ExprKind.ArrayCtor: {
      const count = arena.getExprData1(exprId);
      let anyChanged = false;
      const elements: number[] = [];
      for (let i = 0; i < count; i++) {
        const elemId = i === 0 ? arena.getExprLeft(exprId) : arena.getExprLeft(exprId + i);
        const newElem = substituteArenaConstants(arena, elemId, constMap, nameToIdx);
        elements.push(newElem);
        if (newElem !== elemId) anyChanged = true;
      }
      if (anyChanged) {
        return arena.addArrayCtorExpr(elements);
      }
      return exprId;
    }
    default:
      return exprId;
  }
}

function arrayValueToArenaExpr(arena: DAEBuilder, val: any, varType: VarType): number {
  if (Array.isArray(val)) {
    const elemIds = val.map((item) => arrayValueToArenaExpr(arena, item, varType));
    return arena.addArrayCtorExpr(elemIds);
  }
  if (typeof val === "number") {
    return varType === VarType.Integer ? arena.addIntLiteral(Math.trunc(val)) : arena.addRealLiteral(val);
  }
  if (typeof val === "boolean") {
    return arena.addBoolLiteral(val);
  }
  if (typeof val === "string") {
    return arena.addStringLiteral(val);
  }
  return arena.addRealLiteral(Number(val));
}

/**
 * In-place constant fold for a single equation in the arena.
 */
export function foldSingleArenaEquation(
  arena: DAEBuilder,
  eq: number,
  db?: QueryDB,
  scopeId?: SymbolId,
  omcCompatibility = false,
  paramMap?: Map<string, number>,
): boolean {
  if (eq < 0 || eq >= arena.eqCount) return false;
  const nameToIdx = new Map<string, number>();
  if (!paramMap) {
    paramMap = new Map<string, number>();
    for (let i = 0; i < arena.varCount; i++) {
      if (!arena.isVarRemoved(i)) {
        const v = arena.getVarVariability(i);
        const name = arena.getVarName(i);
        nameToIdx.set(name, i);
        if (v === Variability.Constant || v === Variability.Parameter) {
          paramMap.set(name, arena.getVarStartValue(i));
        }
      }
    }
  }

  const eqKind = arena.getEqKind(eq);
  if (eqKind === EqKind.Simple || eqKind === EqKind.InitialSimple) {
    let lhsExpr = arena.getEqLhs(eq);
    const origRhs = (arena as any).getOrigEqRhs ? (arena as any).getOrigEqRhs(eq) : arena.getEqRhs(eq);
    let rhsExpr = origRhs >= 0 ? origRhs : arena.getEqRhs(eq);
    if (rhsExpr >= 0) {
      const foldedRhs = evaluateConstantArenaExpression(arena, rhsExpr, paramMap, nameToIdx, 0, db, scopeId);
      if (foldedRhs !== null) {
        let varType = VarType.Real;
        if (arena.getExprKind(lhsExpr) === ExprKind.Name) {
          const varName = arena.interner.resolve(arena.getExprData1(lhsExpr));
          const varIdx = nameToIdx.get(varName);
          if (varIdx !== undefined) varType = arena.getVarType(varIdx);
        }
        let newRhs: number;
        if (Array.isArray(foldedRhs)) {
          newRhs = arrayValueToArenaExpr(arena, foldedRhs, varType);
        } else if (varType === VarType.Boolean && typeof foldedRhs === "boolean") {
          newRhs = arena.addBoolLiteral(foldedRhs);
        } else if (varType === VarType.Integer && typeof foldedRhs === "number") {
          newRhs = arena.addIntLiteral(Math.trunc(foldedRhs));
        } else if (typeof foldedRhs === "number") {
          newRhs = arena.addRealLiteral(foldedRhs);
        } else {
          newRhs = rhsExpr;
        }
        if (newRhs !== rhsExpr) {
          arena.setEqRhs(eq, newRhs);
          rhsExpr = newRhs;
        }
      }

      const simplifiedRhs = simplifyArenaIfElse(arena, rhsExpr, paramMap, nameToIdx);
      if (simplifiedRhs !== rhsExpr) {
        arena.setEqRhs(eq, simplifiedRhs);
        rhsExpr = simplifiedRhs;
      }
      const constMap = new Map<string, number>();
      for (let i = 0; i < arena.varCount; i++) {
        if (!arena.isVarRemoved(i) && arena.getVarVariability(i) === Variability.Constant) {
          constMap.set(arena.getVarName(i), arena.getVarStartValue(i));
        }
      }
      const constSubRhs = substituteArenaConstants(arena, rhsExpr, constMap, nameToIdx);
      if (constSubRhs !== rhsExpr) arena.setEqRhs(eq, constSubRhs);
      const simplifiedLhs = simplifyArenaIfElse(arena, lhsExpr, paramMap, nameToIdx);
      if (simplifiedLhs !== lhsExpr) arena.setEqLhs(eq, simplifiedLhs);
      const constSubLhs = substituteArenaConstants(arena, lhsExpr, constMap, nameToIdx);
      if (constSubLhs !== lhsExpr) arena.setEqLhs(eq, constSubLhs);
      return true;
    }
  }
  return false;
}

/**
 * In-place constant fold targeting only equations that reference a specific parameter.
 */
export function foldTargetedParamEquations(
  arena: DAEBuilder,
  paramName: string,
  db?: QueryDB,
  scopeId?: SymbolId,
  omcCompatibility = false,
): void {
  const paramMap = new Map<string, number>();
  for (let i = 0; i < arena.varCount; i++) {
    if (!arena.isVarRemoved(i)) {
      const v = arena.getVarVariability(i);
      if (v === Variability.Constant || v === Variability.Parameter) {
        paramMap.set(arena.getVarName(i), arena.getVarStartValue(i));
      }
    }
  }

  // Update dependent parameters that reference paramName
  for (let i = 0; i < arena.varCount; i++) {
    if (arena.isVarRemoved(i)) continue;
    const v = arena.getVarVariability(i);
    if (v === Variability.Constant || v === Variability.Parameter) {
      const name = arena.getVarName(i);
      if (name === paramName) continue;
      const exprId = arena.getVarExpression(i);
      if (typeof exprId === "number" && exprId >= 0) {
        if ((arena as any).exprReferencesName?.(exprId, paramName)) {
          const evalVal = evaluateConstantArenaExpression(arena, exprId, paramMap, undefined, 0, db, scopeId);
          if (evalVal !== null && typeof evalVal === "number") {
            arena.setVarStartValue(i, evalVal);
            paramMap.set(name, evalVal);
          }
        }
      }
    }
  }

  const affectedEqs = (arena as any).getEquationsReferencingParam
    ? (arena as any).getEquationsReferencingParam(paramName)
    : [];
  for (const eqIdx of affectedEqs) {
    foldSingleArenaEquation(arena, eqIdx, db, scopeId, omcCompatibility, paramMap);
  }
}

/**
 * Fold constant and parameter expressions in the arena to literal values
 * where possible. This is done iteratively until fixed point or maxIterations.
 */
export function foldArenaConstants(
  arena: DAEBuilder,
  db?: QueryDB,
  scopeId?: SymbolId,
  omcCompatibility = false,
  maxIterations = 100,
): number {
  const nameToIdx = new Map<string, number>();
  for (let i = 0; i < arena.varCount; i++) {
    if (!arena.isVarRemoved(i)) {
      nameToIdx.set(arena.getVarName(i), i);
    }
  }

  const paramMap = new Map<string, number>();
  const constMap = new Map<string, number>();
  const finalParamOrConstMap = new Map<string, number>();

  let changed = true;
  let iterations = 0;

  while (changed && iterations < maxIterations) {
    changed = false;
    iterations++;

    // 1. Update parameter map from current constant and parameter variables
    paramMap.clear();
    constMap.clear();
    finalParamOrConstMap.clear();
    for (let i = 0; i < arena.varCount; i++) {
      if (arena.isVarRemoved(i)) continue;
      const v = arena.getVarVariability(i);
      if (v === Variability.Constant || v === Variability.Parameter) {
        const name = arena.getVarName(i);
        const exprId = arena.getVarExpression(i);
        if (typeof exprId === "number" && exprId >= 0) {
          const evalVal = evaluateConstantArenaExpression(arena, exprId, paramMap, nameToIdx, 0, db, scopeId);
          if (evalVal !== null) {
            let foldedValue: number | boolean | number[] | null = evalVal;
            const match = name.match(/\[([\d,]+)\]$/);
            if (match && Array.isArray(foldedValue)) {
              const indices = match[1].split(",").map(Number);
              let current: any = foldedValue;
              for (const idx of indices) {
                if (Array.isArray(current) && idx >= 1 && idx <= current.length) {
                  current = current[idx - 1];
                } else {
                  foldedValue = null;
                  break;
                }
              }
              if (foldedValue !== null) {
                foldedValue = current;
              }
            }
            if (typeof foldedValue === "number") {
              paramMap.set(name, foldedValue);
              if (v === Variability.Constant) constMap.set(name, foldedValue);
              if (v === Variability.Constant || (v === Variability.Parameter && arena.isVarFinal(i))) {
                finalParamOrConstMap.set(name, foldedValue);
              }
              if (arena.getVarStartValue(i) !== foldedValue) {
                arena.setVarStartValue(i, foldedValue);
                changed = true;
              }
              continue;
            } else if (typeof foldedValue === "boolean") {
              const numVal = foldedValue ? 1.0 : 0.0;
              paramMap.set(name, numVal);
              if (v === Variability.Constant) constMap.set(name, numVal);
              if (v === Variability.Constant || (v === Variability.Parameter && arena.isVarFinal(i))) {
                finalParamOrConstMap.set(name, numVal);
              }
              if (arena.getVarStartValue(i) !== numVal) {
                arena.setVarStartValue(i, numVal);
                changed = true;
              }
              continue;
            }
          }
        }
        if (v === Variability.Constant) {
          paramMap.set(name, arena.getVarStartValue(i));
          constMap.set(name, arena.getVarStartValue(i));
          finalParamOrConstMap.set(name, arena.getVarStartValue(i));
        } else if (v === Variability.Parameter && arena.isVarFinal(i)) {
          finalParamOrConstMap.set(name, arena.getVarStartValue(i));
        }
      }
    }

    // 2. Fold variable binding expressions
    for (let i = 0; i < arena.varCount; i++) {
      if (arena.isVarRemoved(i)) continue;
      const v = arena.getVarVariability(i);
      if (v !== Variability.Constant && v !== Variability.Parameter && !omcCompatibility) continue;

      const exprId = (arena as any).getExplicitVarExpression
        ? (arena as any).getExplicitVarExpression(i)
        : arena.getVarExpression(i);
      if (exprId >= 0) {
        const evalVal = evaluateConstantArenaExpression(
          arena,
          exprId,
          omcCompatibility ? constMap : paramMap,
          nameToIdx,
          0,
          db,
          scopeId,
        );
        if (evalVal !== null) {
          let foldedValue: number | boolean | number[] | null = evalVal;
          const match = arena.getVarName(i).match(/\[([\d,]+)\]$/);
          if (match && Array.isArray(foldedValue)) {
            const indices = match[1].split(",").map(Number);
            let current: any = foldedValue;
            for (const idx of indices) {
              if (Array.isArray(current) && idx >= 1 && idx <= current.length) {
                current = current[idx - 1];
              } else {
                foldedValue = null;
                break;
              }
            }
            if (foldedValue !== null) {
              foldedValue = current;
            }
          }
          if (typeof foldedValue === "number") {
            const litId =
              arena.getVarType(i) === VarType.Integer
                ? arena.addIntLiteral(foldedValue)
                : arena.addRealLiteral(foldedValue);
            arena.setVarExpression(i, litId);
            paramMap.set(arena.getVarName(i), foldedValue);
            if (v === Variability.Constant) constMap.set(arena.getVarName(i), foldedValue);
            if (v === Variability.Constant || (v === Variability.Parameter && arena.isVarFinal(i))) {
              finalParamOrConstMap.set(arena.getVarName(i), foldedValue);
            }
          } else if (typeof foldedValue === "boolean") {
            const litId = arena.addExpression(ExprKind.BoolLiteral, foldedValue ? 1 : 0);
            arena.setVarExpression(i, litId);
            paramMap.set(arena.getVarName(i), foldedValue ? 1.0 : 0.0);
            if (v === Variability.Constant) constMap.set(arena.getVarName(i), foldedValue ? 1.0 : 0.0);
            if (v === Variability.Constant || (v === Variability.Parameter && arena.isVarFinal(i))) {
              finalParamOrConstMap.set(arena.getVarName(i), foldedValue ? 1.0 : 0.0);
            }
          }
        }
      }
    }

    // 3. Fold equations (LHS == RHS, When bodies, If bodies)
    const eqFoldMap = omcCompatibility ? constMap : paramMap;
    const ifElseFoldMap = omcCompatibility ? finalParamOrConstMap : paramMap;
    for (let eq = 0; eq < arena.eqCount; eq++) {
      const eqKind = arena.getEqKind(eq);
      if (eqKind === EqKind.Simple || eqKind === EqKind.InitialSimple) {
        let lhsExpr = arena.getEqLhs(eq);
        let rhsExpr = arena.getEqRhs(eq);
        if (rhsExpr >= 0) {
          let foldedRhs = evaluateConstantArenaExpression(arena, rhsExpr, eqFoldMap, nameToIdx, 0, db, scopeId);
          if (foldedRhs !== null) {
            let varType = VarType.Real;
            if (arena.getExprKind(lhsExpr) === ExprKind.Name) {
              const varName = arena.interner.resolve(arena.getExprData1(lhsExpr));
              const varIdx = nameToIdx.get(varName);
              if (varIdx !== undefined) {
                varType = arena.getVarType(varIdx);
              }
            }

            let newRhs: number;
            if (Array.isArray(foldedRhs)) {
              newRhs = arrayValueToArenaExpr(arena, foldedRhs, varType);
            } else if (varType === VarType.Boolean && typeof foldedRhs === "boolean") {
              newRhs = arena.addBoolLiteral(foldedRhs);
            } else if (varType === VarType.Integer && typeof foldedRhs === "number") {
              newRhs = arena.addIntLiteral(Math.trunc(foldedRhs));
            } else if (typeof foldedRhs === "number") {
              newRhs = arena.addRealLiteral(foldedRhs);
            } else {
              newRhs = arena.addRealLiteral(Number(foldedRhs));
            }

            if (newRhs !== rhsExpr) {
              arena.setEqRhs(eq, newRhs);
              changed = true;
              rhsExpr = newRhs;
            }
          }

          const simplifiedRhs = simplifyArenaIfElse(arena, rhsExpr, ifElseFoldMap, nameToIdx);
          if (simplifiedRhs !== rhsExpr) {
            arena.setEqRhs(eq, simplifiedRhs);
            changed = true;
            rhsExpr = simplifiedRhs;
          }
          const constSubRhs = substituteArenaConstants(arena, rhsExpr, constMap, nameToIdx);
          if (constSubRhs !== rhsExpr) {
            arena.setEqRhs(eq, constSubRhs);
            changed = true;
          }
          const simplifiedLhs = simplifyArenaIfElse(arena, lhsExpr, ifElseFoldMap, nameToIdx);
          if (simplifiedLhs !== lhsExpr) {
            arena.setEqLhs(eq, simplifiedLhs);
            changed = true;
            lhsExpr = simplifiedLhs;
          }
          const constSubLhs = substituteArenaConstants(arena, lhsExpr, constMap, nameToIdx);
          if (constSubLhs !== lhsExpr) {
            arena.setEqLhs(eq, constSubLhs);
            changed = true;
          }
        }
      } else if (eqKind === EqKind.When) {
        const meta = arena.getWhenEquationMeta(eq);
        if (meta) {
          for (const bodyEq of meta.bodyEquations) {
            if (bodyEq.kind !== EqKind.Simple) continue;
            if (bodyEq.rhsExprId >= 0) {
              let foldedRhs = evaluateConstantArenaExpression(
                arena,
                bodyEq.rhsExprId,
                eqFoldMap,
                nameToIdx,
                0,
                db,
                scopeId,
              );

              if (foldedRhs !== null) {
                let varType = VarType.Real;
                if (arena.getExprKind(bodyEq.lhsExprId) === ExprKind.Name) {
                  const varName = arena.interner.resolve(arena.getExprData1(bodyEq.lhsExprId));
                  const varIdx = nameToIdx.get(varName);
                  if (varIdx !== undefined) {
                    varType = arena.getVarType(varIdx);
                  }
                }

                let newRhs: number;
                if (Array.isArray(foldedRhs)) {
                  newRhs = arrayValueToArenaExpr(arena, foldedRhs, varType);
                } else if (varType === VarType.Boolean && typeof foldedRhs === "boolean") {
                  newRhs = arena.addBoolLiteral(foldedRhs);
                } else if (varType === VarType.Integer && typeof foldedRhs === "number") {
                  newRhs = arena.addIntLiteral(Math.trunc(foldedRhs));
                } else if (typeof foldedRhs === "number") {
                  newRhs = arena.addRealLiteral(foldedRhs);
                } else {
                  newRhs = arena.addRealLiteral(Number(foldedRhs));
                }

                if (newRhs !== bodyEq.rhsExprId) {
                  bodyEq.rhsExprId = newRhs;
                  changed = true;
                }
              }

              const simplifiedRhs = simplifyArenaIfElse(arena, bodyEq.rhsExprId, ifElseFoldMap, nameToIdx);
              if (simplifiedRhs !== bodyEq.rhsExprId) {
                bodyEq.rhsExprId = simplifiedRhs;
                changed = true;
              }
              const constSub = substituteArenaConstants(arena, bodyEq.rhsExprId, constMap, nameToIdx);
              if (constSub !== bodyEq.rhsExprId) {
                bodyEq.rhsExprId = constSub;
                changed = true;
              }
            }
          }
        }
      } else if (eqKind === EqKind.If) {
        const meta = arena.getIfEquationMeta(eq);
        if (meta) {
          const foldEqList = (list: { kind: EqKind; lhsExprId: number; rhsExprId: number }[]) => {
            for (const bodyEq of list) {
              if (bodyEq.kind !== EqKind.Simple) continue;
              if (bodyEq.rhsExprId >= 0) {
                let foldedRhs = evaluateConstantArenaExpression(
                  arena,
                  bodyEq.rhsExprId,
                  eqFoldMap,
                  nameToIdx,
                  0,
                  db,
                  scopeId,
                );

                if (foldedRhs !== null) {
                  let varType = VarType.Real;
                  if (arena.getExprKind(bodyEq.lhsExprId) === ExprKind.Name) {
                    const varName = arena.interner.resolve(arena.getExprData1(bodyEq.lhsExprId));
                    const varIdx = nameToIdx.get(varName);
                    if (varIdx !== undefined) {
                      varType = arena.getVarType(varIdx);
                    }
                  }

                  let newRhs: number;
                  if (Array.isArray(foldedRhs)) {
                    newRhs = arrayValueToArenaExpr(arena, foldedRhs, varType);
                  } else if (varType === VarType.Boolean && typeof foldedRhs === "boolean") {
                    newRhs = arena.addBoolLiteral(foldedRhs);
                  } else if (varType === VarType.Integer && typeof foldedRhs === "number") {
                    newRhs = arena.addIntLiteral(Math.trunc(foldedRhs));
                  } else if (typeof foldedRhs === "number") {
                    newRhs = arena.addRealLiteral(foldedRhs);
                  } else {
                    newRhs = arena.addRealLiteral(Number(foldedRhs));
                  }

                  if (newRhs !== bodyEq.rhsExprId) {
                    bodyEq.rhsExprId = newRhs;
                    changed = true;
                  }
                }

                const simplifiedRhs = simplifyArenaIfElse(arena, bodyEq.rhsExprId, ifElseFoldMap, nameToIdx);
                if (simplifiedRhs !== bodyEq.rhsExprId) {
                  bodyEq.rhsExprId = simplifiedRhs;
                  changed = true;
                }
                const constSub = substituteArenaConstants(arena, bodyEq.rhsExprId, constMap, nameToIdx);
                if (constSub !== bodyEq.rhsExprId) {
                  bodyEq.rhsExprId = constSub;
                  changed = true;
                }
              }
            }
          };
          foldEqList(meta.thenEquations);
          for (const clause of meta.elseIfClauses) {
            foldEqList(clause.bodyEquations);
          }
          if (meta.elseEquations) {
            foldEqList(meta.elseEquations);
          }
        }
      }
    }
  }

  return iterations;
}

/**
 * Generates all multi-dimensional 1-based indices for a given shape.
 * Example: shape [2, 3] -> [[1,1], [1,2], [1,3], [2,1], [2,2], [2,3]]
 */
function generateIndices(shape: number[]): number[][] {
  if (shape.length === 0) return [];
  const result: number[][] = [];
  const current: number[] = new Array(shape.length).fill(1);

  while (true) {
    result.push([...current]);
    let i = shape.length - 1;
    while (i >= 0) {
      current[i]++;
      if (current[i]! <= shape[i]!) break;
      current[i] = 1;
      i--;
    }
    if (i < 0) break;
  }
  return result;
}

/**
 * Helper to extract an element from a multi-dimensional or 1D ArrayCtor expression.
 * Returns -1 if index is invalid or expression is not an ArrayCtor.
 */
function getArrayCtorElement(dae: DAEBuilder, ctorId: number, idx: number[]): number {
  let depth = 0;
  let probe = ctorId;
  while (probe >= 0 && dae.getExprKind(probe) === ExprKind.ArrayCtor) {
    depth++;
    probe = dae.getExprLeft(probe);
  }
  const effectiveIdx = depth > 0 && depth < idx.length ? idx.slice(idx.length - depth) : idx;
  let curr = ctorId;
  for (const index of effectiveIdx) {
    const k = index - 1; // 1-based index to 0-based
    if (dae.getExprKind(curr) !== ExprKind.ArrayCtor) {
      return -1;
    }
    const count = dae.getExprData1(curr);
    if (k < 0 || k >= count) return -1;
    curr = k === 0 ? dae.getExprLeft(curr) : dae.getExprLeft(curr + k);
  }
  return curr;
}

/**
 * Checks if the DAE contains any array or record equations that need to be scalarized.
 */
export function hasArrayEquations(dae: DAEBuilder): boolean {
  const isComposite = (exprId: number): boolean => {
    if (exprId < 0) return false;
    const k = dae.getExprKind(exprId);
    if (k === ExprKind.ArrayCtor) return true;
    if (k === ExprKind.Name) {
      const name = dae.interner.resolve(dae.getExprData1(exprId));
      if (name) {
        if (dae.getVarIdxByName(`${name}[1]`) >= 0) return true;
        if (dae.getVarIdxByName(name) < 0) {
          const prefix = `${name}.`;
          for (let i = 0; i < dae.varCount; i++) {
            if (!dae.isVarRemoved(i) && dae.getVarName(i).startsWith(prefix)) {
              return true;
            }
          }
        }
      }
    }
    if (k === ExprKind.Der || k === ExprKind.Pre) {
      return isComposite(dae.getExprData1(exprId));
    }
    return false;
  };

  for (let i = 0; i < dae.eqCount; i++) {
    const kind = dae.getEqKind(i);
    if (kind === EqKind.Simple || kind === EqKind.InitialSimple) {
      const lhs = dae.getEqLhs(i);
      const rhs = dae.getEqRhs(i);
      if (isComposite(lhs) || isComposite(rhs)) return true;
    } else if (kind === EqKind.If) {
      const meta = dae.getIfEquationMeta(i);
      if (meta) {
        for (const eq of meta.thenEquations) {
          if (isComposite(eq.lhsExprId) || isComposite(eq.rhsExprId)) return true;
        }
        for (const clause of meta.elseIfClauses) {
          for (const eq of clause.bodyEquations) {
            if (isComposite(eq.lhsExprId) || isComposite(eq.rhsExprId)) return true;
          }
        }
        if (meta.elseEquations) {
          for (const eq of meta.elseEquations) {
            if (isComposite(eq.lhsExprId) || isComposite(eq.rhsExprId)) return true;
          }
        }
      }
    } else if (kind === EqKind.When) {
      const meta = dae.getWhenEquationMeta(i);
      if (meta) {
        for (const eq of meta.bodyEquations) {
          if (isComposite(eq.lhsExprId) || isComposite(eq.rhsExprId)) return true;
        }
      }
    }
  }
  return false;
}

function getArrayElements(dae: DAEBuilder, exprId: number): number[] | null {
  if (exprId < 0) return null;
  const kind = dae.getExprKind(exprId);
  if (kind === ExprKind.ArrayCtor) {
    const count = dae.getExprData1(exprId);
    const elements: number[] = [];
    for (let i = 0; i < count; i++) {
      elements.push(i === 0 ? dae.getExprLeft(exprId) : dae.getExprLeft(exprId + i));
    }
    let hasNested = false;
    for (const e of elements) {
      if (dae.getExprKind(e) === ExprKind.ArrayCtor || getArrayElements(dae, e) !== null) {
        hasNested = true;
        break;
      }
    }
    if (hasNested) {
      const flattened: number[] = [];
      for (const e of elements) {
        const sub = getArrayElements(dae, e);
        if (sub) flattened.push(...sub);
        else flattened.push(e);
      }
      return flattened;
    }
    return elements;
  }
  if (kind === ExprKind.Name) {
    const name = dae.interner.resolve(dae.getExprData1(exprId));
    if (name) {
      const vIdx = dae.getVarIdxByName(name);
      if (vIdx >= 0) {
        const shape = dae.getVarShape(vIdx);
        if (shape.length > 0) {
          const indices = generateIndices(shape);
          const elements: number[] = [];
          for (const idx of indices) {
            elements.push(dae.addExpression(ExprKind.Name, dae.interner.intern(`${name}[${idx.join(",")}]`)));
          }
          return elements;
        }
      }
      if (dae.getVarIdxByName(`${name}[1,1]`) >= 0) {
        let rows = 0;
        while (dae.getVarIdxByName(`${name}[${rows + 1},1]`) >= 0) rows++;
        let cols = 0;
        while (dae.getVarIdxByName(`${name}[1,${cols + 1}]`) >= 0) cols++;
        const elements: number[] = [];
        for (let r = 1; r <= rows; r++) {
          for (let c = 1; c <= cols; c++) {
            elements.push(dae.addExpression(ExprKind.Name, dae.interner.intern(`${name}[${r},${c}]`)));
          }
        }
        return elements;
      }
      if (dae.getVarIdxByName(`${name}[1]`) >= 0) {
        const elements: number[] = [];
        let k = 1;
        while (dae.getVarIdxByName(`${name}[${k}]`) >= 0) {
          elements.push(dae.addExpression(ExprKind.Name, dae.interner.intern(`${name}[${k}]`)));
          k++;
        }
        return elements;
      }
      const prefixMatch = `${name}[`;
      const elements: number[] = [];
      for (let v = 0; v < dae.varCount; v++) {
        if (dae.isVarRemoved(v)) continue;
        const vName = dae.getVarName(v);
        if (vName.startsWith(prefixMatch) && vName.endsWith("]")) {
          elements.push(dae.addExpression(ExprKind.Name, dae.interner.intern(vName)));
        }
      }
      if (elements.length > 0) return elements;
    }
  }
  if (kind === ExprKind.Der) {
    const inner = dae.getExprData1(exprId);
    const innerElems = getArrayElements(dae, inner);
    if (innerElems) {
      return innerElems.map((e) => dae.addDerExpr(e));
    }
  }
  if (kind === ExprKind.Pre) {
    const inner = dae.getExprData1(exprId);
    const innerElems = getArrayElements(dae, inner);
    if (innerElems) {
      return innerElems.map((e) => dae.addPreExpr(e));
    }
  }
  if (kind === ExprKind.Unary) {
    const op = dae.getExprData1(exprId);
    const inner = dae.getExprLeft(exprId);
    const innerElems = getArrayElements(dae, inner);
    if (innerElems) {
      return innerElems.map((e) => dae.addUnaryExpr(op, e));
    }
  }
  return null;
}

function getRecordFields(dae: DAEBuilder, exprId: number): string[] | null {
  if (exprId < 0) return null;
  const kind = dae.getExprKind(exprId);
  if (kind === ExprKind.Name) {
    const name = dae.interner.resolve(dae.getExprData1(exprId));
    if (name && dae.getVarIdxByName(name) < 0) {
      const prefix = `${name}.`;
      const fields: string[] = [];
      for (let i = 0; i < dae.varCount; i++) {
        if (dae.isVarRemoved(i)) continue;
        const vName = dae.getVarName(i);
        if (vName.startsWith(prefix)) {
          fields.push(vName.slice(prefix.length));
        }
      }
      if (fields.length > 0) return fields;
    }
  }
  if (kind === ExprKind.IfElse) {
    return getRecordFields(dae, dae.getExprLeft(exprId)) || getRecordFields(dae, dae.getExprRight(exprId));
  }
  return null;
}

function getFieldExpr(dae: DAEBuilder, out: DAEBuilder, exprId: number, field: string): number {
  if (exprId < 0) return exprId;
  const kind = dae.getExprKind(exprId);
  switch (kind) {
    case ExprKind.Name: {
      const name = dae.interner.resolve(dae.getExprData1(exprId));
      return out.addNameExpr(`${name}.${field}`);
    }
    case ExprKind.IfElse: {
      const cond = dae.getExprData1(exprId);
      const thenBranch = getFieldExpr(dae, out, dae.getExprLeft(exprId), field);
      const elseBranch = getFieldExpr(dae, out, dae.getExprRight(exprId), field);
      return out.addIfElseExpr(cond, thenBranch, elseBranch);
    }
    case ExprKind.Der: {
      const inner = getFieldExpr(dae, out, dae.getExprData1(exprId), field);
      return out.addDerExpr(inner);
    }
    case ExprKind.Unary: {
      const op = dae.getExprData1(exprId);
      const inner = getFieldExpr(dae, out, dae.getExprLeft(exprId), field);
      return out.addUnaryExpr(op, inner);
    }
    default:
      return exprId;
  }
}

function evalConstantNum(dae: DAEBuilder, exprId: number): number | null {
  const val = evaluateConstantArenaExpression(dae, exprId);
  if (typeof val === "number") return val;
  return null;
}

export function getMatrixDimensions(
  dae: DAEBuilder,
  exprId: number,
  isInnerRow = false,
): { rows: number; cols: number } | null {
  if (exprId < 0) return null;
  const kind = dae.getExprKind(exprId);
  switch (kind) {
    case ExprKind.Name: {
      const name = dae.interner.resolve(dae.getExprData1(exprId));
      if (!name) return null;
      if (dae.getVarIdxByName(`${name}[1,1]`) >= 0) {
        let rows = 0;
        while (dae.getVarIdxByName(`${name}[${rows + 1},1]`) >= 0) rows++;
        let cols = 0;
        while (dae.getVarIdxByName(`${name}[1,${cols + 1}]`) >= 0) cols++;
        if (rows > 0 && cols > 0) return { rows, cols };
      }
      const vIdx = dae.getVarIdxByName(name);
      if (vIdx >= 0) {
        const shape = dae.getVarShape(vIdx);
        if (shape.length === 2) return { rows: shape[0]!, cols: shape[1]! };
        if (shape.length === 1) return { rows: shape[0]!, cols: 1 };
      }
      if (dae.getVarIdxByName(`${name}[1]`) >= 0) {
        let count = 0;
        while (dae.getVarIdxByName(`${name}[${count + 1}]`) >= 0) count++;
        if (count > 0) return { rows: count, cols: 1 };
      }
      return null;
    }
    case ExprKind.Call: {
      const fnName = dae.interner.resolve(dae.getExprData1(exprId));
      if (fnName === "/*Real*/" || fnName === "Real") {
        return getMatrixDimensions(dae, dae.getExprLeft(exprId), isInnerRow);
      }
      if (fnName === "transpose") {
        const inner = dae.getExprLeft(exprId);
        const innerDims = getMatrixDimensions(dae, inner, false);
        if (innerDims) {
          return { rows: innerDims.cols, cols: innerDims.rows };
        }
        return null;
      }
      if (fnName === "zeros" || fnName === "ones") {
        const argCount = dae.getExprRight(exprId);
        if (argCount >= 2) {
          const r = evalConstantNum(dae, dae.getExprLeft(exprId));
          const c = evalConstantNum(dae, dae.getExprLeft(exprId + 1));
          if (r !== null && c !== null && r > 0 && c > 0) {
            return { rows: Math.trunc(r), cols: Math.trunc(c) };
          }
        } else if (argCount === 1) {
          const n = evalConstantNum(dae, dae.getExprLeft(exprId));
          if (n !== null && n > 0) {
            return { rows: Math.trunc(n), cols: 1 };
          }
        }
      }
      return null;
    }
    case ExprKind.ArrayCtor: {
      const count = dae.getExprData1(exprId);
      if (count <= 0) return null;
      const elems = getArrayElements(dae, exprId);
      if (!elems || elems.length === 0) return null;

      if (isInnerRow) {
        return { rows: 1, cols: count };
      }

      const hasArrayOrMatrixChild = elems.some((e) => {
        const k = dae.getExprKind(e);
        if (k === ExprKind.ArrayCtor) return true;
        if (k === ExprKind.Call) {
          const fn = dae.interner.resolve(dae.getExprData1(e));
          if (fn === "zeros" || fn === "ones" || fn === "transpose" || fn === "/*Real*/" || fn === "Real") return true;
        }
        return false;
      });

      if (hasArrayOrMatrixChild) {
        let totalRows = 0;
        let maxCols = 1;
        for (const elem of elems) {
          const d = getMatrixDimensions(dae, elem, true);
          if (d) {
            totalRows += d.rows;
            if (d.cols > maxCols) maxCols = d.cols;
          } else {
            totalRows += 1;
          }
        }
        return { rows: totalRows, cols: maxCols };
      }

      return { rows: count, cols: 1 };
    }
    default:
      return null;
  }
}

export function getMatrixElement(
  dae: DAEBuilder,
  exprId: number,
  row: number,
  col: number,
  isInnerRow = false,
): number | null {
  if (exprId < 0) return null;
  const kind = dae.getExprKind(exprId);
  switch (kind) {
    case ExprKind.Name: {
      const name = dae.interner.resolve(dae.getExprData1(exprId));
      if (!name) return null;
      if (dae.getVarIdxByName(`${name}[1,1]`) >= 0) {
        return dae.addExpression(ExprKind.Name, dae.interner.intern(`${name}[${row},${col}]`));
      }
      const vIdx = dae.getVarIdxByName(name);
      if (vIdx >= 0) {
        const shape = dae.getVarShape(vIdx);
        if (shape.length === 2) {
          return dae.addExpression(ExprKind.Name, dae.interner.intern(`${name}[${row},${col}]`));
        }
        if (shape.length === 1 && col === 1) {
          return dae.addExpression(ExprKind.Name, dae.interner.intern(`${name}[${row}]`));
        }
      }
      if (col === 1 && dae.getVarIdxByName(`${name}[${row}]`) >= 0) {
        return dae.addExpression(ExprKind.Name, dae.interner.intern(`${name}[${row}]`));
      }
      return null;
    }
    case ExprKind.Call: {
      const fnName = dae.interner.resolve(dae.getExprData1(exprId));
      if (fnName === "/*Real*/" || fnName === "Real") {
        return getMatrixElement(dae, dae.getExprLeft(exprId), row, col, isInnerRow);
      }
      if (fnName === "transpose") {
        const inner = dae.getExprLeft(exprId);
        return getMatrixElement(dae, inner, col, row, false);
      }
      if (fnName === "zeros" || fnName === "ones") {
        return dae.addRealLiteral(fnName === "zeros" ? 0.0 : 1.0);
      }
      return null;
    }
    case ExprKind.ArrayCtor: {
      const elems = getArrayElements(dae, exprId);
      if (!elems || elems.length === 0) return null;

      if (isInnerRow) {
        if (row === 1 && col >= 1 && col <= elems.length) {
          return elems[col - 1]!;
        }
        return null;
      }

      const hasArrayOrMatrixChild = elems.some((e) => {
        const k = dae.getExprKind(e);
        if (k === ExprKind.ArrayCtor) return true;
        if (k === ExprKind.Call) {
          const fn = dae.interner.resolve(dae.getExprData1(e));
          if (fn === "zeros" || fn === "ones" || fn === "transpose" || fn === "/*Real*/" || fn === "Real") return true;
        }
        return false;
      });

      if (hasArrayOrMatrixChild) {
        let currentRow = 1;
        for (const elem of elems) {
          const d = getMatrixDimensions(dae, elem, true);
          const elemRows = d ? d.rows : 1;
          if (row >= currentRow && row < currentRow + elemRows) {
            const subRow = row - currentRow + 1;
            if (d) {
              return getMatrixElement(dae, elem, subRow, col, true);
            } else {
              if (col === 1) return elem;
              return null;
            }
          }
          currentRow += elemRows;
        }
        return null;
      }

      if (col === 1 && row >= 1 && row <= elems.length) {
        return elems[row - 1]!;
      }
      return null;
    }
    default:
      if (row === 1 && col === 1) return exprId;
      return null;
  }
}

function isLiteralZero(dae: DAEBuilder, exprId: number): boolean {
  if (exprId < 0) return false;
  const k = dae.getExprKind(exprId);
  if (k === ExprKind.RealLiteral && dae.getExprRealValue(exprId) === 0) return true;
  if (k === ExprKind.IntLiteral && dae.getExprData1(exprId) === 0) return true;
  return false;
}

export function isArrayOfLength(dae: DAEBuilder, exprId: number, n: number): boolean {
  if (exprId < 0) return false;
  const kind = dae.getExprKind(exprId);
  if (kind === ExprKind.ArrayCtor || kind === ExprKind.Tuple) {
    return dae.getExprData1(exprId) === n;
  }
  if (kind === ExprKind.Der || kind === ExprKind.Pre) {
    return isArrayOfLength(dae, dae.getExprData1(exprId), n);
  }
  if (kind === ExprKind.Unary || kind === ExprKind.Negate) {
    return isArrayOfLength(dae, dae.getExprLeft(exprId), n);
  }
  if (kind === ExprKind.Binary) {
    const op = dae.getExprData1(exprId);
    if (op === BinOp.Mul) {
      const l = dae.getExprLeft(exprId);
      const matDim = getMatrixDimensions(dae, l);
      if (matDim && matDim.rows === n) return true;
    }
    return isArrayOfLength(dae, dae.getExprLeft(exprId), n) || isArrayOfLength(dae, dae.getExprRight(exprId), n);
  }
  if (kind === ExprKind.Name) {
    const name = dae.interner.resolve(dae.getExprData1(exprId));
    if (name) {
      const vIdx = dae.getVarIdxByName(name);
      if (vIdx >= 0) {
        const shape = dae.getVarShape(vIdx);
        if (shape.length === 1) return shape[0] === n;
        if (shape.length > 1) {
          const total = shape.reduce((a, b) => a * b, 1);
          return total === n;
        }
      }
      if (dae.getVarIdxByName(`${name}[1,1]`) >= 0) {
        let rows = 0;
        while (dae.getVarIdxByName(`${name}[${rows + 1},1]`) >= 0) rows++;
        let cols = 0;
        while (dae.getVarIdxByName(`${name}[1,${cols + 1}]`) >= 0) cols++;
        return rows * cols === n;
      }
      return dae.getVarIdxByName(`${name}[${n}]`) >= 0 && dae.getVarIdxByName(`${name}[${n + 1}]`) < 0;
    }
  }
  if (kind === ExprKind.Call) {
    const fnName = dae.interner.resolve(dae.getExprData1(exprId));
    if (fnName === "fill" && dae.getExprRight(exprId) >= 2) {
      const countExpr = dae.getExprLeft(exprId + 1);
      const countVal = evaluateConstantArenaExpression(dae, countExpr);
      if (typeof countVal === "number" && Math.trunc(countVal) === n) return true;
    }
    const argCount = dae.getExprRight(exprId);
    for (let i = 0; i < argCount; i++) {
      const argExprId = i === 0 ? dae.getExprLeft(exprId) : dae.getExprLeft(exprId + i);
      if (isArrayOfLength(dae, argExprId, n)) return true;
    }
  }
  return false;
}

export function getNthExpr(dae: DAEBuilder, exprId: number, k: number, n: number): number {
  if (exprId < 0) return exprId;
  const kind = dae.getExprKind(exprId);
  switch (kind) {
    case ExprKind.ArrayCtor: {
      let res = exprId;
      const count = dae.getExprData1(exprId);
      if (count === n) {
        res = k === 0 ? dae.getExprLeft(exprId) : dae.getExprLeft(exprId + k);
      } else {
        const elems = getArrayElements(dae, exprId);
        if (elems && elems.length === n) {
          res = elems[k]!;
        }
      }
      if (res !== exprId && res >= 0) {
        while (
          (dae.getExprKind(res) === ExprKind.ArrayCtor || dae.getExprKind(res) === ExprKind.Tuple) &&
          dae.getExprData1(res) === 1
        ) {
          res = dae.getExprLeft(res);
        }
        return res;
      }
      return exprId;
    }
    case ExprKind.Tuple: {
      const count = dae.getExprData1(exprId);
      if (count === n) {
        let res = k === 0 ? dae.getExprLeft(exprId) : dae.getExprLeft(exprId + k);
        while (
          (dae.getExprKind(res) === ExprKind.ArrayCtor || dae.getExprKind(res) === ExprKind.Tuple) &&
          dae.getExprData1(res) === 1
        ) {
          res = dae.getExprLeft(res);
        }
        return res;
      }
      return exprId;
    }
    case ExprKind.Der: {
      const inner = dae.getExprData1(exprId);
      const innerElem = getNthExpr(dae, inner, k, n);
      return dae.addDerExpr(innerElem);
    }
    case ExprKind.Pre: {
      const inner = dae.getExprData1(exprId);
      const innerElem = getNthExpr(dae, inner, k, n);
      return dae.addPreExpr(innerElem);
    }
    case ExprKind.Negate: {
      const inner = dae.getExprLeft(exprId);
      const innerElem = getNthExpr(dae, inner, k, n);
      return dae.addExpression(ExprKind.Negate, 0, innerElem);
    }
    case ExprKind.Unary: {
      const op = dae.getExprData1(exprId);
      const operand = dae.getExprLeft(exprId);
      const opElem = getNthExpr(dae, operand, k, n);
      return dae.addUnaryExpr(op, opElem);
    }
    case ExprKind.Binary: {
      const op = dae.getExprData1(exprId);
      const left = dae.getExprLeft(exprId);
      const right = dae.getExprRight(exprId);

      // Check for matrix-vector multiplication: M * v where M has rows=n
      if (op === BinOp.Mul) {
        const matDim = getMatrixDimensions(dae, left);
        if (matDim && matDim.rows === n && matDim.cols > 0) {
          let rowSum: number | null = null;
          for (let j = 0; j < matDim.cols; j++) {
            const matElem = getMatrixElement(dae, left, k + 1, j + 1);
            if (matElem === null) continue;
            if (isLiteralZero(dae, matElem)) continue;
            const vecElem = getNthExpr(dae, right, j, matDim.cols);
            if (isLiteralZero(dae, vecElem)) continue;
            const prod = dae.addBinaryExpr(BinOp.Mul, matElem, vecElem);
            rowSum = rowSum === null ? prod : dae.addBinaryExpr(BinOp.Add, rowSum, prod);
          }
          if (rowSum !== null) return rowSum;
          return dae.addRealLiteral(0.0);
        }
      }

      const leftIsArr = isArrayOfLength(dae, left, n);
      const rightIsArr = isArrayOfLength(dae, right, n);
      const leftElem = leftIsArr ? getNthExpr(dae, left, k, n) : left;
      const rightElem = rightIsArr ? getNthExpr(dae, right, k, n) : right;
      return dae.addBinaryExpr(op, leftElem, rightElem);
    }
    case ExprKind.Call: {
      const funcNameId = dae.getExprData1(exprId);
      const fnName = dae.interner.resolve(funcNameId) || "";
      const argCount = dae.getExprRight(exprId);
      if (fnName === "/*Real*/" || fnName === "Real") {
        const inner = dae.getExprLeft(exprId);
        const innerElem = getNthExpr(dae, inner, k, n);
        if (dae.getExprKind(innerElem) === ExprKind.RealLiteral) {
          return innerElem;
        }
        if (dae.getExprKind(innerElem) === ExprKind.IntLiteral) {
          return dae.addRealLiteral(dae.getExprData1(innerElem));
        }
        return dae.addCallExpr(fnName, [innerElem]);
      }
      if (fnName === "linspace" && argCount >= 2) {
        const startExpr = dae.getExprLeft(exprId);
        const stopExpr = dae.getExprLeft(exprId + 1);
        const evalNum = (id: number): number | null => {
          const knd = dae.getExprKind(id);
          if (knd === ExprKind.IntLiteral) return dae.getExprData1(id);
          if (knd === ExprKind.RealLiteral) return dae.getExprRealValue(id);
          if (knd === ExprKind.Negate) {
            const v = evalNum(dae.getExprLeft(id));
            return v !== null ? -v : null;
          }
          if (knd === ExprKind.Name) {
            const nm = dae.interner.resolve(dae.getExprData1(id));
            if (nm) {
              const vi = dae.getVarIdxByName(nm);
              if (vi >= 0) {
                const bx = dae.getVarExpression(vi);
                if (bx >= 0) return evalNum(bx);
                const sv = dae.getVarStartValue(vi);
                if (sv !== 0) return sv;
              }
            }
          }
          return null;
        };
        const sVal = evalNum(startExpr);
        const eVal = evalNum(stopExpr);
        let nVal = n;
        if (argCount >= 3) {
          const argN = evalNum(dae.getExprLeft(exprId + 2));
          if (argN !== null && argN >= 2) nVal = Math.trunc(argN);
        }
        if (sVal !== null && eVal !== null && nVal >= 2) {
          const step = (eVal - sVal) / (nVal - 1);
          const val = k === 0 ? sVal : k === nVal - 1 ? eVal : sVal + k * step;
          return dae.addRealLiteral(val);
        }
      }
      if (fnName === "fill" && argCount >= 2) {
        const valExprId = dae.getExprLeft(exprId);
        if (argCount === 2) {
          return valExprId;
        } else {
          const remainingArgs: number[] = [valExprId];
          for (let i = 2; i < argCount; i++) {
            remainingArgs.push(dae.getExprLeft(exprId + i));
          }
          return dae.addCallExpr("fill", remainingArgs);
        }
      }
      const nthArgs: number[] = [];
      for (let i = 0; i < argCount; i++) {
        const argExprId = i === 0 ? dae.getExprLeft(exprId) : dae.getExprLeft(exprId + i);
        if (isArrayOfLength(dae, argExprId, n)) {
          nthArgs.push(getNthExpr(dae, argExprId, k, n));
        } else {
          nthArgs.push(argExprId);
        }
      }
      return dae.addCallExpr(fnName, nthArgs);
    }
    case ExprKind.IfElse: {
      const cond = dae.getExprData1(exprId);
      const thenBranch = dae.getExprLeft(exprId);
      const elseBranch = dae.getExprRight(exprId);
      const thenElem = getNthExpr(dae, thenBranch, k, n);
      const elseElem = getNthExpr(dae, elseBranch, k, n);
      return dae.addIfElseExpr(cond, thenElem, elseElem);
    }
    case ExprKind.Name: {
      const name = dae.interner.resolve(dae.getExprData1(exprId));
      if (name) {
        const vIdx = dae.getVarIdxByName(name);
        if (vIdx >= 0) {
          const shape = dae.getVarShape(vIdx);
          if (shape.length > 1) {
            const indices = generateIndices(shape);
            if (k < indices.length) {
              const multiIdx = indices[k]!.join(",");
              return dae.addExpression(ExprKind.Name, dae.interner.intern(`${name}[${multiIdx}]`));
            }
          }
        }
        if (dae.getVarIdxByName(`${name}[1,1]`) >= 0) {
          let rows = 0;
          while (dae.getVarIdxByName(`${name}[${rows + 1},1]`) >= 0) rows++;
          let cols = 0;
          while (dae.getVarIdxByName(`${name}[1,${cols + 1}]`) >= 0) cols++;
          if (rows > 0 && cols > 0 && n === rows * cols) {
            const r = Math.floor(k / cols) + 1;
            const c = (k % cols) + 1;
            return dae.addExpression(ExprKind.Name, dae.interner.intern(`${name}[${r},${c}]`));
          }
        }
        const indexedName = `${name}[${k + 1}]`;
        if (dae.getVarIdxByName(indexedName) >= 0) {
          return dae.addExpression(ExprKind.Name, dae.interner.intern(indexedName));
        }
      }
      return exprId;
    }
    default:
      return exprId;
  }
}

function isRealType(dae: DAEBuilder, exprId: number): boolean {
  if (exprId < 0) return false;
  const kind = dae.getExprKind(exprId);
  if (kind === ExprKind.RealLiteral) return true;
  if (kind === ExprKind.Der) {
    return isRealType(dae, dae.getExprData1(exprId));
  }
  if (kind === ExprKind.Name) {
    const name = dae.interner.resolve(dae.getExprData1(exprId));
    if (name) {
      let vIdx = dae.getVarIdxByName(name);
      if (vIdx < 0 && name.includes("[")) {
        vIdx = dae.getVarIdxByName(name.split("[")[0]);
      }
      if (vIdx >= 0) return dae.getVarType(vIdx) === VarType.Real;
    }
  }
  return false;
}

/**
 * Deferred Batch Scalarization Pass.
 * Takes an DAEBuilder where array variables and equations have been preserved,
 * and scalarizes them into a flat DAE of individual scalar variables and equations.
 */
export function scalarizeArena(dae: DAEBuilder): DAEBuilder {
  const out = new DAEBuilder(dae.interner);
  out.name = dae.name;
  out.classKind = dae.classKind;
  out.description = dae.description;
  out.isImpure = dae.isImpure;
  for (const [k, v] of dae.functions) {
    out.functions.set(k, v);
  }
  out.diagnostics.push(...dae.diagnostics);
  out.equationAnnotations = [...dae.equationAnnotations];
  out.algorithmAnnotations = [...dae.algorithmAnnotations];
  const arrayShapes = new Map<string, number[]>();

  for (let i = 0; i < dae.varCount; i++) {
    if (dae.isVarRemoved(i)) continue;
    const shape = dae.getVarShape(i);
    if (shape.length > 0) {
      arrayShapes.set(dae.getVarName(i), shape);
    }
  }

  const cloneExpr = (exprId: number, indexSuffix: string, currentShape: number[] | null): number => {
    if (exprId < 0) return exprId;
    const kind = dae.getExprKind(exprId);

    switch (kind) {
      case ExprKind.Name: {
        const nameId = dae.getExprData1(exprId);
        const name = dae.interner.resolve(nameId);
        if (name && arrayShapes.has(name)) {
          const shape = arrayShapes.get(name)!;
          if (currentShape && shape.join(",") === currentShape.join(",")) {
            return out.addNameExpr(`${name}${indexSuffix}`);
          }
        }
        return out.addNameExpr(name || "");
      }
      case ExprKind.IntLiteral:
        return out.addIntLiteral(dae.getExprData1(exprId));
      case ExprKind.RealLiteral:
        return out.addRealLiteral(dae.getExprRealValue(exprId));
      case ExprKind.BoolLiteral:
        return out.addBoolLiteral(dae.getExprData1(exprId) !== 0);
      case ExprKind.StringLiteral: {
        const strId = dae.getExprData1(exprId);
        const str = dae.interner.resolve(strId);
        return out.addStringLiteral(str || "");
      }
      case ExprKind.Binary: {
        const op = dae.getExprData1(exprId);
        const origLeft = dae.getExprLeft(exprId);
        const origRight = dae.getExprRight(exprId);
        const left = cloneExpr(origLeft, indexSuffix, currentShape);
        const right = cloneExpr(origRight, indexSuffix, currentShape);
        if (op === BinOp.Mul) {
          const leftName =
            dae.getExprKind(origLeft) === ExprKind.Name ? dae.interner.resolve(dae.getExprData1(origLeft)) : null;
          const rightName =
            dae.getExprKind(origRight) === ExprKind.Name ? dae.interner.resolve(dae.getExprData1(origRight)) : null;
          const leftIsArray = Boolean(leftName && arrayShapes.has(leftName));
          const rightIsArray = Boolean(rightName && arrayShapes.has(rightName));
          if (!leftIsArray && rightIsArray) {
            return out.addBinaryExpr(op, right, left);
          }
        }
        return out.addBinaryExpr(op, left, right);
      }
      case ExprKind.Unary: {
        const op = dae.getExprData1(exprId);
        const operand = cloneExpr(dae.getExprLeft(exprId), indexSuffix, currentShape);
        return out.addUnaryExpr(op, operand);
      }
      case ExprKind.Negate: {
        const operand = cloneExpr(dae.getExprLeft(exprId), indexSuffix, currentShape);
        return out.addExpression(ExprKind.Negate, 0, operand);
      }
      case ExprKind.Range: {
        const start = cloneExpr(dae.getExprData1(exprId), indexSuffix, currentShape);
        const stepRaw = dae.getExprLeft(exprId);
        const step = stepRaw >= 0 ? cloneExpr(stepRaw, indexSuffix, currentShape) : -1;
        const stop = cloneExpr(dae.getExprRight(exprId), indexSuffix, currentShape);
        return out.addExpression(ExprKind.Range, start, step, stop);
      }
      case ExprKind.Colon:
        return out.addColonExpr();
      case ExprKind.Comprehension: {
        const cfn = dae.interner.resolve(dae.getExprData1(exprId));
        const inner = cloneExpr(dae.getExprLeft(exprId), indexSuffix, currentShape);
        return out.addExpression(ExprKind.Comprehension, out.interner.intern(cfn || ""), inner);
      }
      case ExprKind.Der: {
        const arg = cloneExpr(dae.getExprData1(exprId), indexSuffix, currentShape);
        return out.addDerExpr(arg);
      }
      case ExprKind.Pre: {
        const arg = cloneExpr(dae.getExprData1(exprId), indexSuffix, currentShape);
        return out.addPreExpr(arg);
      }
      case ExprKind.Call: {
        const funcNameId = dae.getExprData1(exprId);
        const argCount = dae.getExprRight(exprId);
        const args: number[] = [];
        for (let i = 0; i < argCount; i++) {
          const argExprId = i === 0 ? dae.getExprLeft(exprId) : dae.getExprLeft(exprId + i);
          args.push(cloneExpr(argExprId, indexSuffix, currentShape));
        }
        return out.addCallExpr(dae.interner.resolve(funcNameId) || "", args);
      }
      case ExprKind.Tuple: {
        const count = dae.getExprData1(exprId);
        const elems: number[] = [];
        for (let i = 0; i < count; i++) {
          const elemId = i === 0 ? dae.getExprLeft(exprId) : dae.getExprLeft(exprId + i);
          elems.push(cloneExpr(elemId, indexSuffix, currentShape));
        }
        return out.addTupleExpr(elems);
      }
      case ExprKind.ArrayCtor: {
        const count = dae.getExprData1(exprId);
        const elements: number[] = [];
        for (let i = 0; i < count; i++) {
          const elemId = i === 0 ? dae.getExprLeft(exprId) : dae.getExprLeft(exprId + i);
          elements.push(cloneExpr(elemId, indexSuffix, currentShape));
        }
        return out.addArrayCtorExpr(elements);
      }
      case ExprKind.IfElse: {
        const cond = cloneExpr(dae.getExprData1(exprId), indexSuffix, currentShape);
        const thenBranch = cloneExpr(dae.getExprLeft(exprId), indexSuffix, currentShape);
        const elseBranch = cloneExpr(dae.getExprRight(exprId), indexSuffix, currentShape);
        return out.addIfElseExpr(cond, thenBranch, elseBranch);
      }
      case ExprKind.Subscript: {
        const baseId = dae.getExprData1(exprId);
        const subCount = dae.getExprRight(exprId);
        const subIds: number[] = [];
        for (let i = 0; i < subCount; i++) {
          const sId = i === 0 ? dae.getExprLeft(exprId) : dae.getExprLeft(exprId + i);
          subIds.push(cloneExpr(sId, indexSuffix, currentShape));
        }
        const clonedBase = cloneExpr(baseId, indexSuffix, currentShape);
        return out.addSubscriptExpr(clonedBase, subIds);
      }
      case ExprKind.EnumLiteral: {
        const ordinal = dae.getExprData1(exprId);
        const pathId = dae.getExprLeft(exprId);
        const pathStr = dae.interner.resolve(pathId) || "";
        return out.addEnumLiteral(ordinal, pathStr);
      }
      default:
        return exprId;
    }
  };

  // Emit variables
  for (let i = 0; i < dae.varCount; i++) {
    if (dae.isVarRemoved(i)) continue;

    const name = dae.getVarName(i);
    const shape = dae.getVarShape(i);
    const type = dae.getVarType(i);
    const variability = dae.getVarVariability(i);
    const causality = dae.getVarCausality(i);
    const start = dae.getVarStartValue(i);
    const flags = dae.getVarFlags(i);
    const desc = dae.getVarDescription(i);
    const expr = (dae as any).getExplicitVarExpression
      ? (dae as any).getExplicitVarExpression(i)
      : dae.getVarExpression(i);
    const attrs = dae.getVarAttrExprIds(i);
    const customType = dae.getVarCustomType(i);
    const enumLits = dae.getVarEnumerationLiterals(i);
    const cad = dae.getVarCadAnnotation(i);

    if (shape.length > 0) {
      const indices = generateIndices(shape);
      for (const idx of indices) {
        const scalarName = `${name}[${idx.join(",")}]`;
        const scalarIdx = out.addVariable(scalarName, type, variability, causality, start, flags);
        if (desc) out.setVarDescription(scalarIdx, desc);
        if (customType) out.setVarCustomType(scalarIdx, customType);
        if (enumLits) out.setVarEnumerationLiterals(scalarIdx, enumLits);
        if (cad) out.setVarCadAnnotation(scalarIdx, cad);

        if (expr != null && expr >= 0) {
          if (dae.getExprKind(expr) === ExprKind.ArrayCtor) {
            const elemExpr = getArrayCtorElement(dae, expr, idx);
            if (elemExpr >= 0) {
              let cloned: number;
              if (type === VarType.Real && dae.getExprKind(elemExpr) === ExprKind.IntLiteral) {
                cloned = out.addRealLiteral(dae.getExprData1(elemExpr));
              } else {
                cloned = cloneExpr(elemExpr, "", null);
              }
              out.setVarExpression(scalarIdx, cloned);
            }
          } else {
            out.setVarExpression(scalarIdx, cloneExpr(expr, `[${idx.join(",")}]`, shape));
          }
        }

        if (attrs) {
          for (const [attrName, attrExprId] of attrs.entries()) {
            if (attrName === "start" && dae.getExprKind(attrExprId) === ExprKind.ArrayCtor) {
              const elemExpr = getArrayCtorElement(dae, attrExprId, idx);
              if (elemExpr >= 0) {
                let cloned: number;
                if (type === VarType.Real && dae.getExprKind(elemExpr) === ExprKind.IntLiteral) {
                  cloned = out.addRealLiteral(dae.getExprData1(elemExpr));
                } else {
                  cloned = cloneExpr(elemExpr, "", null);
                }
                out.setVarAttr(scalarIdx, "start", cloned);
              }
            } else {
              out.setVarAttr(scalarIdx, attrName, cloneExpr(attrExprId, "", null));
            }
          }
        }
      }
    } else {
      const scalarIdx = out.addVariable(name, type, variability, causality, start, flags);
      if (desc) out.setVarDescription(scalarIdx, desc);
      if (customType) out.setVarCustomType(scalarIdx, customType);
      if (enumLits) out.setVarEnumerationLiterals(scalarIdx, enumLits);
      if (cad) out.setVarCadAnnotation(scalarIdx, cad);
      if (expr != null && expr >= 0) {
        out.setVarExpression(scalarIdx, cloneExpr(expr, "", null));
      }
      if (attrs) {
        for (const [attrName, attrExprId] of attrs.entries()) {
          out.setVarAttr(scalarIdx, attrName, cloneExpr(attrExprId, "", null));
        }
      }
    }
  }

  const checkShape = (id: number) => {
    if (id < 0) return null;
    const kind = dae.getExprKind(id);
    if (kind === ExprKind.Name) {
      const name = dae.interner.resolve(dae.getExprData1(id));
      const idx = dae.lookupVariable(name);
      if (idx >= 0) {
        const s = dae.getVarShape(idx);
        return s.length > 0 ? s : null;
      }
    }
    return null;
  };

  const emitEquation = (
    kind: EqKind,
    lhsId: number,
    rhsId: number,
    eqFlags: number,
    targetList?: { kind: EqKind; lhsExprId: number; rhsExprId: number }[],
    origEqIdx?: number,
  ) => {
    const recordEqMeta = (newEqIdx: number) => {
      if (origEqIdx !== undefined) {
        const desc = dae.getEqDescription?.(origEqIdx);
        if (desc) out.setEqDescription(newEqIdx, desc);
        const range = dae.getEqSourceRange?.(origEqIdx);
        if (range) out.setEqSourceRange(newEqIdx, range.startByte, range.endByte);
      }
    };

    if (kind === EqKind.Array) {
      const newLhs = cloneExpr(lhsId, "", null);
      const newRhs = cloneExpr(rhsId, "", null);
      if (targetList) {
        targetList.push({ kind, lhsExprId: newLhs, rhsExprId: newRhs });
      } else {
        out.addEquation(kind, newLhs, newRhs, eqFlags);
        recordEqMeta(out.eqCount - 1);
      }
      return;
    }

    const lhsElements = getArrayElements(dae, lhsId);
    const rhsElements = getArrayElements(dae, rhsId);
    if (lhsElements && lhsElements.length > 0) {
      const N = lhsElements.length;
      for (let k = 0; k < N; k++) {
        const newLhs = cloneExpr(lhsElements[k], "", null);
        const rk_raw = rhsElements && rhsElements.length === N ? rhsElements[k] : getNthExpr(dae, rhsId, k, N);
        let newRhs = cloneExpr(rk_raw, "", null);
        if (isRealType(dae, lhsElements[k])) {
          if (dae.getExprKind(rk_raw) === ExprKind.IntLiteral) {
            newRhs = out.addRealLiteral(dae.getExprData1(rk_raw));
          } else if (dae.getExprKind(rk_raw) === ExprKind.Negate) {
            const inner = dae.getExprLeft(rk_raw);
            if (dae.getExprKind(inner) === ExprKind.IntLiteral) {
              const realLit = out.addRealLiteral(dae.getExprData1(inner));
              newRhs = out.addExpression(ExprKind.Negate, 0, realLit);
            }
          }
        }
        if (targetList) {
          targetList.push({ kind, lhsExprId: newLhs, rhsExprId: newRhs });
        } else {
          out.addEquation(kind, newLhs, newRhs, eqFlags);
          recordEqMeta(out.eqCount - 1);
        }
      }
      return;
    }

    if (rhsElements && rhsElements.length > 0) {
      const N = rhsElements.length;
      for (let k = 0; k < N; k++) {
        const newRhs = cloneExpr(rhsElements[k], "", null);
        const lk_raw = getNthExpr(dae, lhsId, k, N);
        let newLhs = cloneExpr(lk_raw, "", null);
        if (isRealType(dae, rhsElements[k])) {
          if (dae.getExprKind(lk_raw) === ExprKind.IntLiteral) {
            newLhs = out.addRealLiteral(dae.getExprData1(lk_raw));
          } else if (dae.getExprKind(lk_raw) === ExprKind.Negate) {
            const inner = dae.getExprLeft(lk_raw);
            if (dae.getExprKind(inner) === ExprKind.IntLiteral) {
              const realLit = out.addRealLiteral(dae.getExprData1(inner));
              newLhs = out.addExpression(ExprKind.Negate, 0, realLit);
            }
          }
        }
        if (targetList) {
          targetList.push({ kind, lhsExprId: newLhs, rhsExprId: newRhs });
        } else {
          out.addEquation(kind, newLhs, newRhs, eqFlags);
          recordEqMeta(out.eqCount - 1);
        }
      }
      return;
    }

    const lhsRec = getRecordFields(dae, lhsId);
    const rhsRec = getRecordFields(dae, rhsId);
    const recFields = lhsRec || rhsRec;
    if (recFields && recFields.length > 0) {
      for (const field of recFields) {
        const newLhs = getFieldExpr(dae, out, lhsId, field);
        const newRhs = getFieldExpr(dae, out, rhsId, field);
        if (targetList) {
          targetList.push({ kind, lhsExprId: newLhs, rhsExprId: newRhs });
        } else {
          out.addEquation(kind, newLhs, newRhs, eqFlags);
          recordEqMeta(out.eqCount - 1);
        }
      }
      return;
    }

    const shape = checkShape(lhsId) || checkShape(rhsId);
    if (shape && shape.length > 0) {
      const indices = generateIndices(shape);
      for (const idx of indices) {
        const indexSuffix = `[${idx.join(",")}]`;
        const newLhs = cloneExpr(lhsId, indexSuffix, shape);
        const newRhs = cloneExpr(rhsId, indexSuffix, shape);
        if (targetList) {
          targetList.push({ kind, lhsExprId: newLhs, rhsExprId: newRhs });
        } else {
          out.addEquation(kind, newLhs, newRhs, eqFlags);
          recordEqMeta(out.eqCount - 1);
        }
      }
    } else {
      const newLhs = cloneExpr(lhsId, "", null);
      const newRhs = cloneExpr(rhsId, "", null);
      if (targetList) {
        targetList.push({ kind, lhsExprId: newLhs, rhsExprId: newRhs });
      } else {
        out.addEquation(kind, newLhs, newRhs, eqFlags);
        recordEqMeta(out.eqCount - 1);
      }
    }
  };

  // Emit equations
  for (let i = 0; i < dae.eqCount; i++) {
    const kind = dae.getEqKind(i);
    const lhsId = dae.getEqLhs(i);
    const rhsId = dae.getEqRhs(i);
    const eqFlags = dae.getEqFlags(i);

    if (kind === EqKind.If) {
      const meta = dae.getIfEquationMeta(i);
      if (meta) {
        const condId = cloneExpr(meta.conditionExprId, "", null);
        const ifIdx = out.addIfEquation(condId);
        const ifRange = dae.getEqSourceRange?.(i);
        if (ifRange) out.setEqSourceRange(ifIdx, ifRange.startByte, ifRange.endByte);
        const outMeta = out.getIfEquationMeta(ifIdx);
        if (outMeta) {
          for (const eq of meta.thenEquations) {
            emitEquation(eq.kind, eq.lhsExprId, eq.rhsExprId, 0, outMeta.thenEquations);
          }
          for (const clause of meta.elseIfClauses) {
            const clauseCond = cloneExpr(clause.conditionExprId, "", null);
            const clauseEqs: { kind: EqKind; lhsExprId: number; rhsExprId: number }[] = [];
            for (const eq of clause.bodyEquations) {
              emitEquation(eq.kind, eq.lhsExprId, eq.rhsExprId, 0, clauseEqs);
            }
            outMeta.elseIfClauses.push({ conditionExprId: clauseCond, bodyEquations: clauseEqs, equations: [] });
          }
          if (meta.elseEquations) {
            for (const eq of meta.elseEquations) {
              emitEquation(eq.kind, eq.lhsExprId, eq.rhsExprId, 0, outMeta.elseEquations);
            }
          }
        }
        continue;
      }
    }

    if (kind === EqKind.When) {
      const meta = dae.getWhenEquationMeta(i);
      if (meta) {
        const condId = cloneExpr(meta.conditionExprId, "", null);
        const whenIdx = out.addWhenEquation(condId);
        const whenRange = dae.getEqSourceRange?.(i);
        if (whenRange) out.setEqSourceRange(whenIdx, whenRange.startByte, whenRange.endByte);
        const outMeta = out.getWhenEquationMeta(whenIdx);
        if (outMeta) {
          for (const eq of meta.bodyEquations) {
            emitEquation(eq.kind, eq.lhsExprId, eq.rhsExprId, 0, outMeta.bodyEquations);
          }
          if (meta.elseWhenClauses) {
            for (const clause of meta.elseWhenClauses) {
              const clauseCond = cloneExpr(clause.conditionExprId, "", null);
              const clauseEqs: { kind: EqKind; lhsExprId: number; rhsExprId: number }[] = [];
              for (const eq of clause.bodyEquations) {
                emitEquation(eq.kind, eq.lhsExprId, eq.rhsExprId, 0, clauseEqs);
              }
              outMeta.elseWhenClauses.push({ conditionExprId: clauseCond, bodyEquations: clauseEqs, equations: [] });
            }
          }
        }
        continue;
      }
    }

    emitEquation(kind, lhsId, rhsId, eqFlags, undefined, i);
  }

  for (const node of dae.boundaryNodes) {
    out.boundaryNodes.push({ ...node });
  }

  const stmtOffset = out.stmtCount;
  for (let i = 0; i < dae.stmtCount; i++) {
    const k = dae.getStmtKind(i);
    switch (k) {
      case StmtKind.Assignment: {
        const target = cloneExpr(dae.getStmtData1(i), "", null);
        const val = cloneExpr(dae.getStmtLeft(i), "", null);
        out.addStatement(StmtKind.Assignment, target, val);
        break;
      }
      case StmtKind.For: {
        const iterName = dae.interner.resolve(dae.getStmtData1(i)) || "";
        const range = cloneExpr(dae.getStmtLeft(i), "", null);
        out.addStatement(StmtKind.For, out.interner.intern(iterName), range, dae.getStmtRight(i));
        break;
      }
      case StmtKind.While: {
        const cond = cloneExpr(dae.getStmtData1(i), "", null);
        out.addStatement(StmtKind.While, cond, dae.getStmtLeft(i));
        break;
      }
      case StmtKind.If: {
        const cond = cloneExpr(dae.getStmtData1(i), "", null);
        out.addStatement(StmtKind.If, cond, dae.getStmtLeft(i), dae.getStmtRight(i));
        break;
      }
      case StmtKind.When: {
        const cond = cloneExpr(dae.getStmtData1(i), "", null);
        out.addStatement(StmtKind.When, cond, dae.getStmtLeft(i), dae.getStmtRight(i));
        break;
      }
      case StmtKind.Block: {
        const rawCond = dae.getStmtData1(i);
        const cond = rawCond >= 0 ? cloneExpr(rawCond, "", null) : -1;
        out.addStatement(StmtKind.Block, cond, dae.getStmtLeft(i));
        break;
      }
      case StmtKind.Return:
        out.addStatement(StmtKind.Return);
        break;
      case StmtKind.Break:
        out.addStatement(StmtKind.Break);
        break;
      case StmtKind.ProcedureCall: {
        const call = cloneExpr(dae.getStmtData1(i), "", null);
        out.addStatement(StmtKind.ProcedureCall, call);
        break;
      }
      case StmtKind.ComplexAssignment: {
        const val = cloneExpr(dae.getStmtLeft(i), "", null);
        out.addStatement(StmtKind.ComplexAssignment, dae.getStmtData1(i), val);
        break;
      }
      default:
        out.addStatement(k, dae.getStmtData1(i), dae.getStmtLeft(i), dae.getStmtRight(i));
        break;
    }
  }

  for (const algo of dae.algorithmSections) {
    out.addAlgorithmSection(stmtOffset + algo.start, algo.count);
  }

  for (const algo of dae.initialAlgorithmSections) {
    out.addInitialAlgorithmSection(stmtOffset + algo.start, algo.count);
  }

  out.isImpure = dae.isImpure;
  out.descriptionId = dae.descriptionId;
  out.name = dae.name;
  out.classKind = dae.classKind;
  out.description = dae.description;
  out.equationAnnotations = [...dae.equationAnnotations];

  return out;
}

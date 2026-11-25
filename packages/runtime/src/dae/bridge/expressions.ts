// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Expression and algorithm statement arena operations for `WasmDaeBridge`.
 */

import { WasmDaeCore } from "./core.js";
import { type BinOp, ExprKind, StmtKind, TensorReduceOp, type UnaryOp } from "./types.js";

export class WasmDaeExpressions extends WasmDaeCore {
  // ── Expression Operations ──

  /**
   * Appends a raw expression node (`kind`, `data1`, `left`, `right`) to the WASM expression arena.
   */
  addExpression(kind: ExprKind, data1 = 0, left = 0xffffffff, right = 0xffffffff): number {
    if (kind === ExprKind.IntLiteral && (data1 > 2147483647 || data1 < -2147483648)) {
      return this.addRealLiteral(data1);
    }
    if (!this.exports?.dae_addExpression) return -1;
    const exprId = this.exports.dae_addExpression(this.ptr, kind, data1, left, right);
    if (kind === ExprKind.Name && exprId >= 0) {
      this.nameExprIndices.push(exprId);
    }
    return exprId;
  }

  /**
   * Appends a binary operator expression (`left op right`) to the arena.
   */
  addBinaryExpr(op: BinOp, left: number, right: number): number {
    if (this.exports?.dae_addBinaryExpr) {
      return this.exports.dae_addBinaryExpr(this.ptr, op, left, right);
    }
    return this.addExpression(ExprKind.Binary, op, left, right);
  }

  /**
   * Appends a unary operator expression (`op operand`) to the arena.
   */
  addUnaryExpr(op: UnaryOp, operand: number): number {
    return this.addExpression(ExprKind.Unary, op, operand);
  }

  /**
   * Appends a 64-bit IEEE-754 floating-point literal expression (`ExprKind.RealLiteral`) to the arena.
   */
  addRealLiteral(value: number): number {
    if (this.exports?.dae_addRealLiteral) {
      return this.exports.dae_addRealLiteral(this.ptr, value);
    }
    const buf = new ArrayBuffer(8);
    const f64 = new Float64Array(buf);
    const i32 = new Int32Array(buf);
    f64[0] = value;
    const lo = i32[0]!;
    const hi = i32[1]!;
    return this.addExpression(ExprKind.RealLiteral, lo, hi, 0);
  }

  /**
   * Appends a 32-bit signed integer literal expression (`ExprKind.IntLiteral`) to the arena.
   */
  addIntLiteral(value: number): number {
    if (value > 2147483647 || value < -2147483648) {
      return this.addRealLiteral(value);
    }
    if (this.exports?.dae_addIntLiteral) {
      return this.exports.dae_addIntLiteral(this.ptr, value);
    }
    return this.addExpression(ExprKind.IntLiteral, value, 0, 0);
  }

  /**
   * Appends a boolean literal expression (`ExprKind.BoolLiteral`) to the arena.
   */
  addBoolLiteral(value: boolean): number {
    return this.addExpression(ExprKind.BoolLiteral, value ? 1 : 0);
  }

  /**
   * Appends a string literal expression (`ExprKind.StringLiteral`) to the arena.
   */
  addStringLiteral(value: string | number): number {
    const sId = typeof value === "string" ? this.interner.intern(value) : value;
    return this.addExpression(ExprKind.StringLiteral, sId);
  }

  /**
   * Interns `name` and appends a variable reference expression (`ExprKind.Name`) to the arena.
   */
  addNameExpr(name: string): number {
    const sId = this.interner.intern(name);
    return this.addExpression(ExprKind.Name, sId, 0, 0);
  }

  /**
   * Appends a `der(varId)` time-derivative expression to the arena.
   */
  addDer(varId: number): number {
    if (this.exports?.dae_addDer) {
      return this.exports.dae_addDer(this.ptr, varId);
    }
    return this.addExpression(ExprKind.Der, varId, 0, 0);
  }

  /**
   * Appends a `der(operand)` expression node to the arena.
   */
  addDerExpr(operand: number): number {
    return this.addExpression(ExprKind.Der, operand);
  }

  /**
   * Appends a `pre(operand)` previous-value expression node to the arena.
   */
  addPreExpr(operand: number): number {
    return this.addExpression(ExprKind.Pre, operand);
  }

  /**
   * Appends a function call expression (`funcNameOrId(args...)`) and its contiguous argument tuple slots to the arena.
   */
  addCallExpr(funcNameOrId: string | number, args: number[]): number {
    const nameId = typeof funcNameOrId === "string" ? this.interner.intern(funcNameOrId) : funcNameOrId;
    if (args.length === 0) {
      return this.addExpression(ExprKind.Call, nameId, 0xffffffff, 0);
    }
    const callId = this.addExpression(ExprKind.Call, nameId, args[0]!, args.length);
    for (let i = 1; i < args.length; i++) {
      this.addExpression(ExprKind.Tuple, 0, args[i]!, 0);
    }
    const fnName = typeof funcNameOrId === "string" ? funcNameOrId : this.interner.resolve(nameId);
    if (
      fnName === "delay" &&
      args.length >= 2 &&
      this.ptr &&
      typeof this.exports?.dae_delay_addChannel === "function"
    ) {
      this.delays.addChannel(args[0]!, args[1]!);
    }
    return callId;
  }

  /**
   * Appends a tuple expression (`(e1, e2, ...)`) and its contiguous element slots to the arena.
   */
  addTupleExpr(elements: number[]): number {
    if (elements.length === 0) return this.addExpression(ExprKind.Tuple, 0, 0xffffffff, -1);
    const tupleId = this.addExpression(ExprKind.Tuple, elements.length, elements[0]!, -1);
    for (let i = 1; i < elements.length; i++) {
      this.addExpression(ExprKind.Tuple, 0, elements[i]!, 0);
    }
    return tupleId;
  }

  /**
   * Appends an arithmetic negation expression (`-operand`) to the arena.
   */
  addNegateExpr(operand: number): number {
    return this.addExpression(ExprKind.Negate, 0, operand);
  }

  /**
   * Appends an array constructor expression (`{e1, e2, ...}`) and its contiguous element slots to the arena.
   */
  addArrayCtorExpr(elements: number[]): number {
    if (elements.length === 0) return this.addExpression(ExprKind.ArrayCtor, 0, 0xffffffff, -1);
    const ctorId = this.addExpression(ExprKind.ArrayCtor, elements.length, elements[0]!, -1);
    for (let i = 1; i < elements.length; i++) {
      this.addExpression(ExprKind.Tuple, 0, elements[i]!, 0);
    }
    return ctorId;
  }

  /**
   * Appends a whole-dimension slice colon (`:`) expression to the arena.
   */
  addColonExpr(): number {
    return this.addExpression(ExprKind.Colon);
  }

  /**
   * Appends a multi-dimensional array subscript expression (`baseExpr[subIds...]`) to the arena.
   */
  addSubscriptExpr(baseExpr: number, subIds: number[]): number {
    if (subIds.length === 0) return baseExpr;
    const subId = this.addExpression(ExprKind.Subscript, baseExpr, subIds[0]!, subIds.length);
    for (let i = 1; i < subIds.length; i++) {
      this.addExpression(ExprKind.Tuple, 0, subIds[i]!, 0);
    }
    return subId;
  }

  /**
   * Appends an enumeration literal expression (`EnumType.Literal`) with its 1-based ordinal to the arena.
   */
  addEnumLiteral(ordinal: number, pathOrValue: string): number {
    const sId = this.interner.intern(pathOrValue);
    return this.addExpression(ExprKind.EnumLiteral, ordinal, sId);
  }

  /**
   * Appends a 2-argument (`start:stop`) or 3-argument (`start:step:stop`) range expression to the arena.
   */
  addRangeExpr(startId: number, arg2: number, arg3 = -1): number {
    if (arg3 !== -1 && arg3 !== 0xffffffff) {
      // 3-arg syntax: start, step, stop
      return this.addRange(startId, arg3, arg2);
    }
    // 2-arg syntax: start, stop
    return this.addRange(startId, arg2, -1);
  }

  /**
   * Appends an array comprehension or reduction expression (`{body for i in range}`) to the arena.
   */
  addComprehensionExpr(
    funcName: string,
    bodyId: number,
    iterators: { name: string; rangeId: number }[] | number,
  ): number {
    const sId = this.interner.intern(funcName);
    if (typeof iterators === "number") {
      return this.addExpression(ExprKind.Comprehension, sId, bodyId, iterators);
    }
    const compId = this.addExpression(ExprKind.Comprehension, sId, bodyId, iterators.length);
    for (const iter of iterators) {
      const varId = this.interner.intern(iter.name);
      this.addExpression(ExprKind.Tuple, varId, iter.rangeId, 0);
    }
    return compId;
  }

  /**
   * Appends a partial function application expression (`function funcName(argIds...)`) to the arena.
   */
  addPartialFuncExpr(funcName: string, argIds: number[]): number {
    const sId = this.interner.intern(funcName);
    if (argIds.length === 0) return this.addExpression(ExprKind.PartialFunc, sId, -1, 0);
    const pfId = this.addExpression(ExprKind.PartialFunc, sId, argIds[0]!, argIds.length);
    for (let i = 1; i < argIds.length; i++) {
      this.addExpression(ExprKind.Tuple, 0, argIds[i]!, 0);
    }
    return pfId;
  }

  /**
   * Alias for {@link addIfElse}.
   */
  addIfElseExpr(condExpr: number, trueExpr: number, falseExpr: number): number {
    return this.addIfElse(condExpr, trueExpr, falseExpr);
  }

  /**
   * Sets the tensor shape dimensions for expression at `exprId`.
   */
  setExprTensorShape(exprId: number, shape: number[]): void {
    this.exprTensorShapes.set(exprId, [...shape]);
  }

  /**
   * Returns the tensor shape dimensions for expression at `exprId`, if set.
   */
  getExprTensorShape(exprId: number): number[] | undefined {
    return this.exprTensorShapes.get(exprId);
  }

  /**
   * Returns the shape dimensions for preserved array equation at `eqIdx`, if set.
   */
  getEquationShape(eqIdx: number): number[] | undefined {
    return this.equationShapes.get(eqIdx);
  }

  /**
   * Appends a multidimensional tensor slice expression (`baseExpr[sliceExpr]` along `axis`) to the arena.
   */
  addTensorSlice(baseExpr: number, sliceExpr: number, axis = 0): number {
    return this.addExpression(ExprKind.TensorSlice, baseExpr, sliceExpr, axis);
  }

  /**
   * Appends a tensor broadcast expression (broadcasting `operandExpr` to `targetShape`) to the arena.
   */
  addTensorBroadcast(operandExpr: number, targetShape: number[], axis = 0): number {
    const exprId = this.addExpression(ExprKind.TensorBroadcast, axis, operandExpr, targetShape.length);
    this.setExprTensorShape(exprId, targetShape);
    return exprId;
  }

  /**
   * Appends a tensor contraction / matrix multiplication expression (`lhs %*% rhs`) to the arena.
   */
  addTensorMatMul(lhsExpr: number, rhsExpr: number, flags = 0): number {
    return this.addExpression(ExprKind.TensorMatMul, flags, lhsExpr, rhsExpr);
  }

  /**
   * Appends a tensor reduction expression (sum, product, max, min, mean along `axis`) to the arena.
   */
  addTensorReduce(operandExpr: number, op: TensorReduceOp = TensorReduceOp.Sum, axis = -1): number {
    return this.addExpression(ExprKind.TensorReduce, op, operandExpr, axis);
  }

  /**
   * Appends an elementwise tensor mapping or unary transformation to the arena.
   */
  addTensorMap(operandExpr: number, opId: number, aux = 0): number {
    return this.addExpression(ExprKind.TensorMap, opId, operandExpr, aux);
  }

  /**
   * Appends a variable reference expression (`ExprKind.Name`) by interned `StringId`.
   */
  addName(varId: number): number {
    if (this.exports?.dae_addName) {
      const exprId = this.exports.dae_addName(this.ptr, varId);
      if (exprId >= 0) {
        this.nameExprIndices.push(exprId);
      }
      return exprId;
    }
    return this.addExpression(ExprKind.Name, varId, 0, 0);
  }

  /**
   * Appends a conditional expression (`if condExpr then trueExpr else falseExpr`) to the arena.
   */
  addIfElse(condExpr: number, trueExpr: number, falseExpr: number): number {
    if (this.exports?.dae_addIfElse) {
      return this.exports.dae_addIfElse(this.ptr, condExpr, trueExpr, falseExpr);
    }
    return this.addExpression(ExprKind.IfElse, condExpr, trueExpr, falseExpr);
  }

  /**
   * Appends a low-level function call expression node (`funcId`, `firstArg`, `argCount`) to the arena.
   */
  addCall(funcId: number, firstArg: number, argCount: number): number {
    if (this.exports?.dae_addCall) {
      return this.exports.dae_addCall(this.ptr, funcId, firstArg, argCount);
    }
    return this.addExpression(ExprKind.Call, funcId, firstArg, argCount);
  }

  /**
   * Appends a range expression (`start:step:stop` or `start:stop`) to the arena.
   */
  addRange(start: number, stop: number, step = -1): number {
    return this.addExpression(ExprKind.Range, start, step, stop);
  }

  /**
   * Appends a single-dimension array subscript expression (`baseExpr[subExpr]`) to the arena.
   */
  addSubscript(baseExpr: number, subExpr: number): number {
    return this.addSubscriptExpr(baseExpr, [subExpr]);
  }

  /**
   * Appends a raw `ExprKind.ArrayCtor` header node (`count`, `firstElem`) to the arena.
   */
  addArrayCtor(firstElem: number, count: number): number {
    return this.addExpression(ExprKind.ArrayCtor, count, firstElem);
  }

  /**
   * Appends a raw `ExprKind.Tuple` header node (`count`, `firstElem`) to the arena.
   */
  addTuple(firstElem: number, count: number): number {
    return this.addExpression(ExprKind.Tuple, count, firstElem);
  }

  /**
   * Returns the {@link ExprKind} of expression `exprId`.
   */
  getExprKind(exprId: number): ExprKind {
    return this.exports?.dae_getExprKind ? (this.exports.dae_getExprKind(this.ptr, exprId) as ExprKind) : ExprKind.Name;
  }

  /**
   * Returns the `data1` 32-bit integer column of expression `exprId`.
   */
  getExprData1(exprId: number): number {
    return this.exports?.dae_getExprData1 ? this.exports.dae_getExprData1(this.ptr, exprId) : 0;
  }

  /**
   * Returns the `left` 32-bit integer column of expression `exprId`.
   */
  getExprLeft(exprId: number): number {
    return this.exports?.dae_getExprLeft ? this.exports.dae_getExprLeft(this.ptr, exprId) : -1;
  }

  /**
   * Returns the `right` 32-bit integer column of expression `exprId`.
   */
  getExprRight(exprId: number): number {
    return this.exports?.dae_getExprRight ? this.exports.dae_getExprRight(this.ptr, exprId) : -1;
  }

  /**
   * Reconstructs the 64-bit IEEE-754 floating-point value of an `ExprKind.RealLiteral` node at `exprId`.
   */
  getExprRealValue(exprId: number): number {
    if (this.exports?.dae_getExprRealValue) {
      return this.exports.dae_getExprRealValue(this.ptr, exprId);
    }
    const lo = this.getExprData1(exprId);
    const hi = this.getExprLeft(exprId);
    const buf = new ArrayBuffer(8);
    const i32 = new Int32Array(buf);
    const f64 = new Float64Array(buf);
    i32[0] = lo;
    i32[1] = hi;
    return f64[0]!;
  }

  /**
   * Resolves the function name of an `ExprKind.Call` node at `exprId`, mapping built-in math
   * function IDs when necessary.
   */
  getExprFuncName(exprId: number): string {
    const funcNameId = this.getExprData1(exprId);
    const resolved = this.interner.resolve(funcNameId) ?? "";
    const BUILTIN_NAMES = [
      "sin",
      "cos",
      "tan",
      "asin",
      "acos",
      "atan",
      "atan2",
      "sinh",
      "cosh",
      "tanh",
      "exp",
      "log",
      "log10",
      "sqrt",
      "abs",
      "sign",
      "min",
      "max",
      "floor",
      "ceil",
      "mod",
      "pow",
      "noEvent",
      "smooth",
      "homotopy",
      "semiLinear",
    ];
    const PREDEFINED_NON_FUNC_KEYWORDS = new Set([
      "parameter",
      "constant",
      "discrete",
      "continuous",
      "input",
      "output",
      "model",
      "record",
      "block",
      "connector",
      "type",
      "package",
      "function",
      "equation",
      "algorithm",
      "initial equation",
      "initial algorithm",
      "public",
      "protected",
      "encapsulated",
      "partial",
    ]);
    if (funcNameId >= 0 && funcNameId < BUILTIN_NAMES.length) {
      if (!resolved || resolved === "<invalid>" || PREDEFINED_NON_FUNC_KEYWORDS.has(resolved)) {
        return BUILTIN_NAMES[funcNameId]!;
      }
      return resolved;
    }
    if ((!resolved || resolved === "<invalid>") && funcNameId >= 56 && funcNameId < 56 + BUILTIN_NAMES.length) {
      return BUILTIN_NAMES[funcNameId - 56]!;
    }
    return resolved;
  }

  /**
   * Recursively checks whether the expression tree rooted at `exprId` references
   * the variable or array base name `name`.
   */
  exprReferencesName(exprId: number, name: string): boolean {
    if (exprId < 0) return false;
    const kind = this.getExprKind(exprId);
    if (kind === ExprKind.Name) {
      const varName = this.interner.resolve(this.getExprData1(exprId));
      return varName === name || varName.startsWith(`${name}[`);
    }
    if (kind === ExprKind.Unary || kind === ExprKind.Negate) {
      return this.exprReferencesName(this.getExprLeft(exprId), name);
    }
    if (kind === ExprKind.Der || kind === ExprKind.Pre) {
      return this.exprReferencesName(this.getExprData1(exprId), name);
    }
    if (kind === ExprKind.Binary) {
      return (
        this.exprReferencesName(this.getExprLeft(exprId), name) ||
        this.exprReferencesName(this.getExprRight(exprId), name)
      );
    }
    if (kind === ExprKind.IfElse) {
      return (
        this.exprReferencesName(this.getExprData1(exprId), name) ||
        this.exprReferencesName(this.getExprLeft(exprId), name) ||
        this.exprReferencesName(this.getExprRight(exprId), name)
      );
    }
    if (kind === ExprKind.Subscript) {
      if (this.exprReferencesName(this.getExprData1(exprId), name)) return true;
      const subCount = this.getExprRight(exprId);
      if (subCount > 0) {
        if (this.exprReferencesName(this.getExprLeft(exprId), name)) return true;
        for (let i = 1; i < subCount; i++) {
          if (this.exprReferencesName(this.getExprLeft(exprId + i), name)) return true;
        }
      } else {
        const subId = this.getExprLeft(exprId);
        if (subId >= 0 && subId !== 0xffffffff && this.exprReferencesName(subId, name)) return true;
      }
      return false;
    }
    if (kind === ExprKind.Range) {
      if (this.exprReferencesName(this.getExprData1(exprId), name)) return true;
      const stepId = this.getExprLeft(exprId);
      if (stepId >= 0 && stepId !== 0xffffffff && this.exprReferencesName(stepId, name)) return true;
      const stopId = this.getExprRight(exprId);
      if (stopId >= 0 && stopId !== 0xffffffff && this.exprReferencesName(stopId, name)) return true;
      return false;
    }
    if (kind === ExprKind.Call) {
      const argCount = this.getExprRight(exprId);
      if (argCount > 0) {
        if (this.exprReferencesName(this.getExprLeft(exprId), name)) return true;
        for (let i = 1; i < argCount; i++) {
          if (this.exprReferencesName(this.getExprLeft(exprId + i), name)) return true;
        }
      }
      return false;
    }
    if (kind === ExprKind.ArrayCtor) {
      const count = this.getExprData1(exprId);
      if (count > 0) {
        const redirect = this.getExprRight(exprId);
        const baseId = redirect >= 0 && redirect !== 0xffffffff ? redirect : exprId;
        if (this.exprReferencesName(this.getExprLeft(exprId), name)) return true;
        for (let i = 1; i < count; i++) {
          if (this.exprReferencesName(this.getExprLeft(baseId + i), name)) return true;
        }
      }
      return false;
    }
    if (kind === ExprKind.Tuple) {
      const count = this.getExprData1(exprId);
      if (count > 0) {
        if (this.exprReferencesName(this.getExprLeft(exprId), name)) return true;
        for (let i = 1; i < count; i++) {
          if (this.exprReferencesName(this.getExprLeft(exprId + i), name)) return true;
        }
      }
      return false;
    }
    if (kind === ExprKind.Comprehension) {
      const bodyId = this.getExprLeft(exprId);
      const iterCount = this.getExprRight(exprId);
      if (this.exprReferencesName(bodyId, name)) return true;
      for (let i = 0; i < iterCount; i++) {
        if (this.exprReferencesName(this.getExprLeft(exprId + 1 + i), name)) return true;
      }
      return false;
    }
    return false;
  }

  /**
   * Collects all variable names referenced within the expression tree rooted at `exprId`.
   */
  collectExprVarNames(
    exprId: number,
    out: Set<string> = new Set<string>(),
    visited: Set<number> = new Set<number>(),
  ): Set<string> {
    if (exprId < 0 || visited.has(exprId)) return out;
    visited.add(exprId);
    const kind = this.getExprKind(exprId);
    if (kind === ExprKind.Name) {
      const name = this.interner.resolve(this.getExprData1(exprId));
      if (name) {
        const bracketIdx = name.indexOf("[");
        if (bracketIdx > 0) {
          out.add(name.slice(0, bracketIdx));
        } else {
          out.add(name);
        }
      }
      return out;
    }
    if (kind === ExprKind.Unary || kind === ExprKind.Negate) {
      this.collectExprVarNames(this.getExprLeft(exprId), out, visited);
    } else if (kind === ExprKind.Der || kind === ExprKind.Pre) {
      this.collectExprVarNames(this.getExprData1(exprId), out, visited);
    } else if (kind === ExprKind.Binary) {
      this.collectExprVarNames(this.getExprLeft(exprId), out, visited);
      this.collectExprVarNames(this.getExprRight(exprId), out, visited);
    } else if (kind === ExprKind.IfElse) {
      this.collectExprVarNames(this.getExprData1(exprId), out, visited);
      this.collectExprVarNames(this.getExprLeft(exprId), out, visited);
      this.collectExprVarNames(this.getExprRight(exprId), out, visited);
    } else if (kind === ExprKind.Subscript) {
      this.collectExprVarNames(this.getExprData1(exprId), out, visited);
      const subCount = this.getExprRight(exprId);
      if (subCount > 0) {
        this.collectExprVarNames(this.getExprLeft(exprId), out, visited);
        for (let i = 1; i < subCount; i++) {
          this.collectExprVarNames(this.getExprLeft(exprId + i), out, visited);
        }
      } else {
        const subId = this.getExprLeft(exprId);
        if (subId >= 0 && subId !== 0xffffffff) {
          this.collectExprVarNames(subId, out, visited);
        }
      }
    } else if (kind === ExprKind.Range) {
      this.collectExprVarNames(this.getExprData1(exprId), out, visited);
      const stepId = this.getExprLeft(exprId);
      if (stepId >= 0 && stepId !== 0xffffffff) {
        this.collectExprVarNames(stepId, out, visited);
      }
      const stopId = this.getExprRight(exprId);
      if (stopId >= 0 && stopId !== 0xffffffff) {
        this.collectExprVarNames(stopId, out, visited);
      }
    } else if (kind === ExprKind.Call) {
      const argCount = this.getExprRight(exprId);
      if (argCount > 0) {
        this.collectExprVarNames(this.getExprLeft(exprId), out, visited);
        for (let i = 1; i < argCount; i++) {
          this.collectExprVarNames(this.getExprLeft(exprId + i), out, visited);
        }
      }
    } else if (kind === ExprKind.ArrayCtor) {
      const count = this.getExprData1(exprId);
      if (count > 0) {
        const redirect = this.getExprRight(exprId);
        const baseId = redirect >= 0 && redirect !== 0xffffffff ? redirect : exprId;
        const firstLeft = this.getExprLeft(exprId);
        if (firstLeft >= 0) {
          const firstKind = this.getExprKind(firstLeft);
          if (
            firstKind === ExprKind.RealLiteral ||
            firstKind === ExprKind.IntLiteral ||
            firstKind === ExprKind.BoolLiteral
          ) {
            return out;
          }
          this.collectExprVarNames(firstLeft, out, visited);
        }
        let stableCount = 0;
        let lastSize = out.size;
        for (let i = 1; i < count; i++) {
          this.collectExprVarNames(this.getExprLeft(baseId + i), out, visited);
          if (count > 64) {
            if (out.size === lastSize) {
              stableCount++;
              if (stableCount >= 16) {
                break;
              }
            } else {
              stableCount = 0;
              lastSize = out.size;
            }
          }
        }
      }
    } else if (kind === ExprKind.Tuple) {
      const count = this.getExprData1(exprId);
      if (count > 0) {
        this.collectExprVarNames(this.getExprLeft(exprId), out, visited);
        for (let i = 1; i < count; i++) {
          this.collectExprVarNames(this.getExprLeft(exprId + i), out, visited);
        }
      }
    } else if (kind === ExprKind.Comprehension) {
      const bodyId = this.getExprLeft(exprId);
      const iterCount = this.getExprRight(exprId);
      this.collectExprVarNames(bodyId, out, visited);
      for (let i = 0; i < iterCount; i++) {
        this.collectExprVarNames(this.getExprLeft(exprId + 1 + i), out, visited);
      }
    }
    return out;
  }

  // ── Statement Operations ──

  /**
   * Appends a raw algorithm statement node (`kind`, `data1`, `left`, `right`) to the WASM statement arena.
   */
  addStatement(kind: StmtKind, data1 = 0, left = 0xffffffff, right = 0xffffffff): number {
    if (!this.exports?.dae_addStatement) return -1;
    return this.exports.dae_addStatement(this.ptr, kind, data1, left, right);
  }

  /**
   * Appends a scalar/array assignment statement (`targetExpr := valueExpr;`) to the arena.
   */
  addAssignmentStmt(targetExpr: number, valueExpr: number): number {
    return this.addStatement(StmtKind.Assignment, targetExpr, valueExpr);
  }

  /**
   * Appends an `if` algorithm statement header to the arena.
   */
  addIfStmt(condExpr: number, bodyCount: number, elseCount = 0): number {
    return this.addStatement(StmtKind.If, condExpr, bodyCount, elseCount);
  }

  /**
   * Appends a `for` loop algorithm statement header to the arena.
   */
  addForStmt(iteratorNameId: number, rangeExpr: number, bodyCount: number): number {
    return this.addStatement(StmtKind.For, iteratorNameId, rangeExpr, bodyCount);
  }

  /**
   * Appends a `while` loop algorithm statement header to the arena.
   */
  addWhileStmt(condExpr: number, bodyCount: number): number {
    return this.addStatement(StmtKind.While, condExpr, bodyCount);
  }

  /**
   * Appends a `when` algorithm statement header to the arena.
   */
  addWhenStmt(condExpr: number, bodyCount: number, elseCount = 0): number {
    return this.addStatement(StmtKind.When, condExpr, bodyCount, elseCount);
  }

  /**
   * Appends a `return;` statement to the arena.
   */
  addReturnStmt(): number {
    return this.addStatement(StmtKind.Return);
  }

  /**
   * Appends a `break;` statement to the arena.
   */
  addBreakStmt(): number {
    return this.addStatement(StmtKind.Break);
  }

  /**
   * Returns the {@link StmtKind} of statement `stmtId`.
   */
  getStmtKind(stmtId: number): StmtKind {
    return this.exports?.dae_getStmtKind
      ? (this.exports.dae_getStmtKind(this.ptr, stmtId) as StmtKind)
      : StmtKind.Assignment;
  }

  /**
   * Returns the `data1` 32-bit integer column of statement `stmtId`.
   */
  getStmtData1(stmtId: number): number {
    const ov = this.stmtData1Overrides.get(stmtId);
    if (ov !== undefined) return ov;
    return this.exports?.dae_getStmtData1 ? this.exports.dae_getStmtData1(this.ptr, stmtId) : 0;
  }

  /**
   * Returns the `left` 32-bit integer column of statement `stmtId`.
   */
  getStmtLeft(stmtId: number): number {
    const ov = this.stmtLeftOverrides.get(stmtId);
    if (ov !== undefined) return ov;
    return this.exports?.dae_getStmtLeft ? this.exports.dae_getStmtLeft(this.ptr, stmtId) : -1;
  }

  /**
   * Returns the `right` 32-bit integer column of statement `stmtId`.
   */
  getStmtRight(stmtId: number): number {
    return this.exports?.dae_getStmtRight ? this.exports.dae_getStmtRight(this.ptr, stmtId) : -1;
  }

  /**
   * Updates the `data1` column of statement `stmtId`.
   */
  setStmtData1(stmtId: number, data1: number): void {
    this.stmtData1Overrides.set(stmtId, data1);
    if (this.exports?.dae_setStmtData1) {
      this.exports.dae_setStmtData1(this.ptr, stmtId, data1);
    }
  }

  /**
   * Updates the `left` column of statement `stmtId`.
   */
  setStmtLeft(stmtId: number, left: number): void {
    this.stmtLeftOverrides.set(stmtId, left);
    if (this.exports?.dae_setStmtLeft) {
      this.exports.dae_setStmtLeft(this.ptr, stmtId, left);
    }
  }

  /**
   * Materializes an array of summary objects for all algorithm statements in the arena.
   */
  getStatements(): { kind: StmtKind; data1: number; left: number; right: number }[] {
    const list = [];
    for (let i = 0; i < this.stmtCount; i++) {
      list.push({
        kind: this.getStmtKind(i),
        data1: this.getStmtData1(i),
        left: this.getStmtLeft(i),
        right: this.getStmtRight(i),
      });
    }
    return list;
  }

  /**
   * Exports all expression columns into a flat packed `Int32Array` (`4` 32-bit words per expression: `kind`, `data1`, `left`, `right`).
   */
  exprView(): Int32Array {
    const count = this.getExprCount();
    const arr = new Int32Array(count * 4);
    for (let i = 0; i < count; i++) {
      const offset = i * 4;
      arr[offset + 0] = this.getExprKind(i);
      arr[offset + 1] = this.getExprData1(i);
      arr[offset + 2] = this.getExprLeft(i);
      arr[offset + 3] = this.getExprRight(i);
    }
    return arr;
  }

  /**
   * Exports all statement columns into a flat packed `Int32Array` (`4` 32-bit words per statement: `kind`, `data1`, `left`, `right`).
   */
  stmtView(): Int32Array {
    const count = this.getStmtCount();
    const arr = new Int32Array(count * 4);
    for (let i = 0; i < count; i++) {
      const offset = i * 4;
      arr[offset + 0] = this.getStmtKind(i);
      arr[offset + 1] = this.getStmtData1(i);
      arr[offset + 2] = this.getStmtLeft(i);
      arr[offset + 3] = this.getStmtRight(i);
    }
    return arr;
  }
}

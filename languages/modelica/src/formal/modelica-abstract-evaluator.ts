// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  ArraySegmentState,
  NumericalInterval as Interval,
  ReducedProductState,
  type CFGInstruction,
  type RTECheckResult,
} from "@modelscript/runtime";

export interface EvaluatorContext {
  instId: number;
  astNodeId?: number;
  startByte?: number;
  endByte?: number;
  initializedVars?: Set<string>;
  declaredVars?: Set<string>;
}

export class ModelicaAbstractEvaluator {
  /**
   * Evaluates an arithmetic, relational, or function call expression over the abstract state.
   */
  static evalExpr(
    expr: string,
    state: ReducedProductState,
    collectRTE: (c: RTECheckResult) => void,
    ctx?: EvaluatorContext,
  ): Interval {
    const trimmed = expr.trim();
    if (!trimmed) return Interval.TOP;

    // 1. Literal number
    if (/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(trimmed)) {
      return Interval.const(Number(trimmed));
    }

    // 2. Boolean literals
    if (trimmed === "true") return Interval.const(1);
    if (trimmed === "false") return Interval.const(0);

    // 3. Array indexing: arr[idxExpr] or arr[idx1, idx2]
    const arrayMatch = /^([a-zA-Z_][a-zA-Z0-9_]*)\[(.*)\]$/.exec(trimmed);
    if (arrayMatch) {
      const arrName = arrayMatch[1]!;
      const innerIdx = arrayMatch[2]!;

      // Handle comma-separated indices if multi-dimensional
      const idxParts = innerIdx.split(",").map((s) => s.trim());
      const firstIdxStr = idxParts[0]!;
      const idxIval = this.evalExpr(firstIdxStr, state, collectRTE, ctx);

      const arrState = state.arraySegments.get(arrName);
      if (arrState) {
        const check = arrState.checkInBounds(idxIval);
        const verdict =
          check.inBounds === "safe"
            ? "proven_safe"
            : check.inBounds === "out_of_bounds"
              ? "definite_bug"
              : "potential_bug";

        collectRTE({
          instId: ctx?.instId ?? 0,
          category: "array_out_of_bounds",
          verdict,
          description: `Array subscript '${arrName}[${innerIdx}]' evaluated with index ${idxIval.toString()} against declared size ${arrState.length.toString()}`,
          astNodeId: ctx?.astNodeId,
          startByte: ctx?.startByte,
          endByte: ctx?.endByte,
          witnessValues: { index: idxIval.toString(), arrayLength: arrState.length.toString() },
        });

        return arrState.universalSummary;
      }
      return Interval.TOP;
    }

    // 4. Built-in Math and Array Functions
    const funcMatch = /^([a-zA-Z_][a-zA-Z0-9_]*)\((.*)\)$/.exec(trimmed);
    if (funcMatch) {
      const fnName = funcMatch[1]!;
      const rawArgs = funcMatch[2] ? funcMatch[2].split(",").map((s) => s.trim()) : [];

      // 4.1 sqrt(x)
      if (fnName === "sqrt" && rawArgs[0]) {
        const argIval = this.evalExpr(rawArgs[0], state, collectRTE, ctx);
        const res = argIval.sqrt();
        const verdict =
          res.domainViolation === "never"
            ? "proven_safe"
            : res.domainViolation === "definite"
              ? "definite_bug"
              : "potential_bug";

        collectRTE({
          instId: ctx?.instId ?? 0,
          category: "math_domain",
          verdict,
          description: `sqrt(${rawArgs[0]}) evaluated on domain ${argIval.toString()}`,
          astNodeId: ctx?.astNodeId,
          startByte: ctx?.startByte,
          endByte: ctx?.endByte,
          witnessValues: { arg: argIval.toString() },
        });
        return res.result;
      }

      // 4.2 log(x) and log10(x)
      if ((fnName === "log" || fnName === "log10") && rawArgs[0]) {
        const argIval = this.evalExpr(rawArgs[0], state, collectRTE, ctx);
        const verdict = argIval.high <= 0 ? "definite_bug" : argIval.low <= 0 ? "potential_bug" : "proven_safe";

        collectRTE({
          instId: ctx?.instId ?? 0,
          category: "math_domain",
          verdict,
          description: `${fnName}(${rawArgs[0]}) evaluated on domain ${argIval.toString()}`,
          astNodeId: ctx?.astNodeId,
          startByte: ctx?.startByte,
          endByte: ctx?.endByte,
          witnessValues: { arg: argIval.toString() },
        });

        if (argIval.isBottom() || argIval.high <= 0) return Interval.BOTTOM;
        const safeLow = Math.max(1e-15, argIval.low);
        const base = fnName === "log10" ? Math.LN10 : 1;
        return new Interval(Math.log(safeLow) / base, Math.log(argIval.high) / base);
      }

      // 4.3 exp(x)
      if (fnName === "exp" && rawArgs[0]) {
        const argIval = this.evalExpr(rawArgs[0], state, collectRTE, ctx);
        if (argIval.isBottom()) return Interval.BOTTOM;
        const lowExp = Math.exp(Math.max(-700, argIval.low));
        const highExp = argIval.high > 709 ? Infinity : Math.exp(argIval.high);

        collectRTE({
          instId: ctx?.instId ?? 0,
          category: "math_domain",
          verdict: "proven_safe",
          description: `exp(${rawArgs[0]}) safe across real domain with result [${lowExp}, ${highExp}]`,
          astNodeId: ctx?.astNodeId,
          startByte: ctx?.startByte,
          endByte: ctx?.endByte,
        });
        return new Interval(lowExp, highExp);
      }

      // 4.4 asin(x), acos(x)
      if ((fnName === "asin" || fnName === "acos") && rawArgs[0]) {
        const argIval = this.evalExpr(rawArgs[0], state, collectRTE, ctx);
        const verdict =
          argIval.low < -1 || argIval.high > 1
            ? argIval.high < -1 || argIval.low > 1
              ? "definite_bug"
              : "potential_bug"
            : "proven_safe";

        collectRTE({
          instId: ctx?.instId ?? 0,
          category: "math_domain",
          verdict,
          description: `${fnName}(${rawArgs[0]}) domain check on argument ${argIval.toString()}`,
          astNodeId: ctx?.astNodeId,
          startByte: ctx?.startByte,
          endByte: ctx?.endByte,
          witnessValues: { arg: argIval.toString() },
        });
        return new Interval(-Math.PI, Math.PI);
      }

      // 4.5 atan(x), sin(x), cos(x), tan(x)
      if (fnName === "atan") {
        return new Interval(-Math.PI / 2, Math.PI / 2);
      }
      if (fnName === "sin" || fnName === "cos") {
        return new Interval(-1, 1);
      }
      if (fnName === "tan" && rawArgs[0]) {
        const argIval = this.evalExpr(rawArgs[0], state, collectRTE, ctx);
        return Interval.TOP;
      }

      // 4.6 abs(x), sign(x)
      if (fnName === "abs" && rawArgs[0]) {
        const argIval = this.evalExpr(rawArgs[0], state, collectRTE, ctx);
        return argIval.abs();
      }
      if (fnName === "sign" && rawArgs[0]) {
        const argIval = this.evalExpr(rawArgs[0], state, collectRTE, ctx);
        if (argIval.low > 0) return Interval.ONE;
        if (argIval.high < 0) return Interval.const(-1);
        return new Interval(-1, 1);
      }

      // 4.7 mod(x, y), rem(x, y)
      if ((fnName === "mod" || fnName === "rem") && rawArgs.length >= 2) {
        const xIval = this.evalExpr(rawArgs[0]!, state, collectRTE, ctx);
        const yIval = this.evalExpr(rawArgs[1]!, state, collectRTE, ctx);

        const verdict = yIval.isDefiniteZero() ? "definite_bug" : yIval.canBeZero() ? "potential_bug" : "proven_safe";

        collectRTE({
          instId: ctx?.instId ?? 0,
          category: "division_by_zero",
          verdict,
          description: `${fnName}(${rawArgs[0]}, ${rawArgs[1]}) with denominator ${yIval.toString()}`,
          astNodeId: ctx?.astNodeId,
          startByte: ctx?.startByte,
          endByte: ctx?.endByte,
          witnessValues: { numerator: xIval.toString(), denominator: yIval.toString() },
        });

        if (yIval.low > 0) {
          return new Interval(0, yIval.high);
        }
        return Interval.TOP;
      }

      // 4.8 Standard Array Reducers: sum(arr), min(arr), max(arr), size(arr)
      if (fnName === "sum" && rawArgs[0]) {
        const arr = state.arraySegments.get(rawArgs[0]);
        if (arr) {
          const u = arr.universalSummary;
          const len = arr.length;
          return u.mul(len);
        }
      }
      if ((fnName === "min" || fnName === "max") && rawArgs[0]) {
        const arr = state.arraySegments.get(rawArgs[0]);
        if (arr) {
          return arr.universalSummary;
        }
      }
      if (fnName === "size" && rawArgs[0]) {
        const arr = state.arraySegments.get(rawArgs[0]);
        if (arr) {
          return arr.length;
        }
      }
    }

    // 5. Binary operations: + - * / ^
    let opIdx = -1;
    let depth = 0;
    for (let i = trimmed.length - 1; i >= 0; i--) {
      const ch = trimmed[i];
      if (ch === ")") depth++;
      else if (ch === "(") depth--;
      else if (depth === 0 && (ch === "+" || ch === "-") && i > 0) {
        opIdx = i;
        break;
      }
    }
    if (opIdx === -1) {
      depth = 0;
      for (let i = trimmed.length - 1; i >= 0; i--) {
        const ch = trimmed[i];
        if (ch === ")") depth++;
        else if (ch === "(") depth--;
        else if (depth === 0 && (ch === "*" || ch === "/" || ch === "^")) {
          opIdx = i;
          break;
        }
      }
    }
    if (opIdx !== -1) {
      const leftStr = trimmed.slice(0, opIdx).trim();
      const op = trimmed[opIdx]!;
      const rightStr = trimmed.slice(opIdx + 1).trim();

      const leftIval = this.evalExpr(leftStr, state, collectRTE, ctx);
      const rightIval = this.evalExpr(rightStr, state, collectRTE, ctx);

      switch (op) {
        case "+":
          return leftIval.add(rightIval);
        case "-":
          return leftIval.sub(rightIval);
        case "*":
          return leftIval.mul(rightIval);
        case "/": {
          const divRes = leftIval.div(rightIval);
          const verdict =
            divRes.divisionByZero === "never"
              ? "proven_safe"
              : divRes.divisionByZero === "definite"
                ? "definite_bug"
                : "potential_bug";

          collectRTE({
            instId: ctx?.instId ?? 0,
            category: "division_by_zero",
            verdict,
            description: `Division '${leftStr} / ${rightStr}' with denominator domain ${rightIval.toString()}`,
            astNodeId: ctx?.astNodeId,
            startByte: ctx?.startByte,
            endByte: ctx?.endByte,
            witnessValues: { numerator: leftIval.toString(), denominator: rightIval.toString() },
          });

          return divRes.result;
        }
        case "^": {
          if (rightIval.isConstant() && rightIval.low === 2) {
            return leftIval.mul(leftIval);
          }
          return Interval.TOP;
        }
      }
    }

    // 6. Simple Variable Lookup (with Uninitialized Variable Verification)
    if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(trimmed)) {
      if (ctx?.declaredVars?.has(trimmed) && ctx.initializedVars && !ctx.initializedVars.has(trimmed)) {
        collectRTE({
          instId: ctx.instId,
          category: "uninitialized_read",
          verdict: "definite_bug",
          description: `Variable '${trimmed}' is read before being initialized or assigned.`,
          astNodeId: ctx.astNodeId,
          startByte: ctx.startByte,
          endByte: ctx.endByte,
          witnessValues: { variable: trimmed },
        });
      }

      return state.intervals.get(trimmed);
    }

    return Interval.TOP;
  }

  /**
   * Transfer function handling an individual CFGInstruction in the Abstract Fixpoint Solver.
   */
  static transfer(
    inst: CFGInstruction,
    inState: ReducedProductState,
    collectRTE: (c: RTECheckResult) => void,
    initializedVars?: Set<string>,
    declaredVars?: Set<string>,
  ): ReducedProductState {
    if (inState.isBottom()) return inState;

    let env = inState.intervals;
    const oct = inState.octagon;
    const indices = inState.varIndices;
    const arrays = inState.arraySegments;

    const ctx: EvaluatorContext = {
      instId: inst.id,
      astNodeId: inst.astNodeId,
      startByte: inst.startByte,
      endByte: inst.endByte,
      initializedVars,
      declaredVars,
    };

    switch (inst.op) {
      case "ASSIGN": {
        const target = inst.targetVar;
        const expr = inst.operands?.[0];
        if (!target || !expr) return inState;

        const exprStr = String(expr).trim();

        // 1. Array builder functions: zeros(n), ones(n), fill(val, n), linspace(x1, x2, n), identity(n)
        const builderMatch = /^([a-zA-Z_][a-zA-Z0-9_]*)\((.*)\)$/.exec(exprStr);
        if (builderMatch) {
          const fnName = builderMatch[1]!;
          const args = builderMatch[2] ? builderMatch[2].split(",").map((s) => s.trim()) : [];

          if (fnName === "zeros" && args[0]) {
            const lenIval = this.evalExpr(args[0], inState, collectRTE, ctx);
            arrays.set(target, new ArraySegmentState(lenIval, Interval.ZERO));
            initializedVars?.add(target);
            return new ReducedProductState(env, oct, indices, arrays, false);
          }

          if (fnName === "ones" && args[0]) {
            const lenIval = this.evalExpr(args[0], inState, collectRTE, ctx);
            arrays.set(target, new ArraySegmentState(lenIval, Interval.ONE));
            initializedVars?.add(target);
            return new ReducedProductState(env, oct, indices, arrays, false);
          }

          if (fnName === "fill" && args.length >= 2) {
            const valIval = this.evalExpr(args[0]!, inState, collectRTE, ctx);
            const lenIval = this.evalExpr(args[1]!, inState, collectRTE, ctx);
            arrays.set(target, new ArraySegmentState(lenIval, valIval));
            initializedVars?.add(target);
            return new ReducedProductState(env, oct, indices, arrays, false);
          }

          if (fnName === "linspace" && args.length >= 3) {
            const x1 = this.evalExpr(args[0]!, inState, collectRTE, ctx);
            const x2 = this.evalExpr(args[1]!, inState, collectRTE, ctx);
            const lenIval = this.evalExpr(args[2]!, inState, collectRTE, ctx);
            const spanIval = new Interval(Math.min(x1.low, x2.low), Math.max(x1.high, x2.high));
            arrays.set(target, new ArraySegmentState(lenIval, spanIval));
            initializedVars?.add(target);
            return new ReducedProductState(env, oct, indices, arrays, false);
          }

          if (fnName === "identity" && args[0]) {
            const lenIval = this.evalExpr(args[0], inState, collectRTE, ctx);
            arrays.set(target, new ArraySegmentState(lenIval, new Interval(0, 1)));
            initializedVars?.add(target);
            return new ReducedProductState(env, oct, indices, arrays, false);
          }
        }

        // 2. Scalar variable assignment
        let valIval = this.evalExpr(exprStr, inState, collectRTE, ctx);
        if (valIval.isBottom()) {
          valIval = Interval.TOP;
        }
        env = env.set(target, valIval);
        initializedVars?.add(target);

        // Check for relational assignments: y := x + c
        const relMatch = /^([a-zA-Z_][a-zA-Z0-9_]*)\s*([+-])\s*(\d+(?:\.\d+)?)$/.exec(exprStr);
        if (relMatch) {
          const srcVar = relMatch[1]!;
          const sign = relMatch[2]!;
          const c = Number(relMatch[3]!);
          const offset = sign === "+" ? c : -c;

          const tIdx = inState.getVarIndex(target);
          const sIdx = inState.getVarIndex(srcVar);
          oct.setDifference(tIdx, sIdx, offset);
          oct.setDifference(sIdx, tIdx, -offset);
        }

        return new ReducedProductState(env, oct, indices, arrays, false).reduce();
      }

      case "ASSIGN_ARRAY": {
        const arrName = inst.targetVar;
        const idxExpr = inst.operands?.[0];
        const valExpr = inst.operands?.[1];
        if (!arrName || idxExpr === undefined || valExpr === undefined) return inState;

        const idxIval = this.evalExpr(String(idxExpr), inState, collectRTE, ctx);
        const valIval = this.evalExpr(String(valExpr), inState, collectRTE, ctx);

        const arrState = arrays.get(arrName);
        if (arrState) {
          const check = arrState.checkInBounds(idxIval);
          const verdict =
            check.inBounds === "safe"
              ? "proven_safe"
              : check.inBounds === "out_of_bounds"
                ? "definite_bug"
                : "potential_bug";

          collectRTE({
            instId: ctx.instId,
            category: "array_out_of_bounds",
            verdict,
            description: `Array element assignment '${arrName}[${idxExpr}] := ${valExpr}' with index ${idxIval.toString()} against declared size ${arrState.length.toString()}`,
            astNodeId: ctx.astNodeId,
            startByte: ctx.startByte,
            endByte: ctx.endByte,
            witnessValues: { index: idxIval.toString(), arrayLength: arrState.length.toString() },
          });

          arrays.set(arrName, arrState.updateElement(valIval));
          initializedVars?.add(arrName);
        }

        return new ReducedProductState(env, oct, indices, arrays, false);
      }

      case "CALL": {
        return inState;
      }

      default: {
        return inState;
      }
    }
  }
}

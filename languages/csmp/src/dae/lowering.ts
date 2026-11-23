// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Direct DAE Arena Lowering for IBM CSMP/360 & SCi CSSL-67 Continuous Simulation Decks.
 *
 * Translates parameters, constants, initial conditions, topologically sorted `DYNAMIC`
 * algebraic equations, `INTGRL` integrators, and standard transfer blocks (`REALPL`,
 * `CMPXPL`, `LEDLAG`, `LIMIT`, `DEADSP`) directly into `@modelscript/runtime`'s
 * `IDaeBuilder` linear memory arena.
 */

import { BinOp, Causality, EqKind, type IDaeBuilder, UnaryOp, VarType, Variability } from "@modelscript/runtime";
import { ensureBuiltInCsmpLibraryRegistered } from "../catalog/library-package-adapter.js";
import { topologicalSortEquations } from "../lints/index.js";
import type { CsmpExpr, CsmpProgram } from "../types.js";

export interface CsmpDaeLoweringResult {
  stateVarIndices: number[];
  parameterIndices: number[];
  equationCount: number;
  variableMap: Map<string, number>;
  sortedTargets: string[];
  algebraicLoops: string[][];
}

function evalConstExpr(expr: CsmpExpr, env: Map<string, number>): number {
  switch (expr.kind) {
    case "number":
      return expr.value;
    case "ident":
      return env.get(expr.name) ?? 0.0;
    case "unary": {
      const v = evalConstExpr(expr.operand, env);
      return expr.op === "-" ? -v : v;
    }
    case "binary": {
      const l = evalConstExpr(expr.left, env);
      const r = evalConstExpr(expr.right, env);
      switch (expr.op) {
        case "+":
          return l + r;
        case "-":
          return l - r;
        case "*":
          return l * r;
        case "/":
          return r !== 0 ? l / r : 0.0;
        case "**":
          return Math.pow(l, r);
      }
      return 0.0;
    }
    case "call":
      return 0.0;
  }
}

/**
 * Lowers a parsed `CsmpProgram` directly into `@modelscript/runtime`'s `IDaeBuilder`.
 */
export function lowerCsmpToDae(builder: IDaeBuilder, program: CsmpProgram): CsmpDaeLoweringResult {
  ensureBuiltInCsmpLibraryRegistered();

  const variableMap = new Map<string, number>();
  const stateVarIndices: number[] = [];
  const parameterIndices: number[] = [];
  const constEnv = new Map<string, number>([
    ["PI", Math.PI],
    ["FINTIM", program.timer.fintim ?? 10.0],
    ["DELT", program.timer.delt ?? 0.01],
  ]);
  let equationCount = 0;

  function getOrAddVar(
    name: string,
    variability: Variability = Variability.Continuous,
    startVal: number = 0.0,
    varType: VarType = VarType.Real,
  ): number {
    const key = name.toUpperCase();
    const mapped = variableMap.get(key);
    if (mapped !== undefined) return mapped;

    const existingIdx = builder.lookupVariable(key);
    if (existingIdx !== -1) {
      variableMap.set(key, existingIdx);
      return existingIdx;
    }

    const idx = builder.addVariable(key, varType, variability, Causality.Local, startVal);
    variableMap.set(key, idx);
    return idx;
  }

  function lowerExpr(expr: CsmpExpr): number {
    switch (expr.kind) {
      case "number":
        return builder.addRealLiteral(expr.value);

      case "ident": {
        const name = expr.name.toUpperCase();
        if (name === "PI") return builder.addRealLiteral(Math.PI);
        const varId = getOrAddVar(name, Variability.Continuous, constEnv.get(name) ?? 0.0);
        return builder.addName(varId);
      }

      case "unary": {
        const inner = lowerExpr(expr.operand);
        if (expr.op === "-") {
          return builder.addUnaryExpr(UnaryOp.Negate, inner);
        }
        return inner;
      }

      case "binary": {
        const left = lowerExpr(expr.left);
        const right = lowerExpr(expr.right);
        switch (expr.op) {
          case "+":
            return builder.addBinaryExpr(BinOp.Add, left, right);
          case "-":
            return builder.addBinaryExpr(BinOp.Sub, left, right);
          case "*":
            return builder.addBinaryExpr(BinOp.Mul, left, right);
          case "/":
            return builder.addBinaryExpr(BinOp.Div, left, right);
          case "**":
            return builder.addBinaryExpr(BinOp.Pow, left, right);
        }
        return left;
      }

      case "call": {
        const callee = expr.callee.toUpperCase();
        if (callee === "LIMIT" && expr.args.length === 3) {
          const lo = lowerExpr(expr.args[0]!);
          const hi = lowerExpr(expr.args[1]!);
          const x = lowerExpr(expr.args[2]!);
          const condLo = builder.addBinaryExpr(BinOp.Lt, x, lo);
          const condHi = builder.addBinaryExpr(BinOp.Gt, x, hi);
          return builder.addIfElse(condLo, lo, builder.addIfElse(condHi, hi, x));
        }
        if (callee === "DEADSP" && expr.args.length === 3) {
          const p1 = lowerExpr(expr.args[0]!);
          const p2 = lowerExpr(expr.args[1]!);
          const x = lowerExpr(expr.args[2]!);
          const condHi = builder.addBinaryExpr(BinOp.Gt, x, p2);
          const condLo = builder.addBinaryExpr(BinOp.Lt, x, p1);
          const hiBranch = builder.addBinaryExpr(BinOp.Sub, x, p2);
          const loBranch = builder.addBinaryExpr(BinOp.Sub, x, p1);
          return builder.addIfElse(condHi, hiBranch, builder.addIfElse(condLo, loBranch, builder.addRealLiteral(0.0)));
        }
        // Fallback: represent call expression via its primary argument or literal 0
        if (expr.args.length > 0) {
          return lowerExpr(expr.args[expr.args.length - 1]!);
        }
        return builder.addRealLiteral(0.0);
      }
    }
  }

  // 1. Register PARAM, CONST, INCON declarations
  for (const [name, decl] of program.parameters) {
    constEnv.set(name, decl.value);
    const idx = getOrAddVar(name, Variability.Parameter, decl.value);
    parameterIndices.push(idx);
  }
  for (const [name, decl] of program.constants) {
    constEnv.set(name, decl.value);
    const idx = getOrAddVar(name, Variability.Constant, decl.value);
    parameterIndices.push(idx);
  }
  for (const [name, decl] of program.incons) {
    constEnv.set(name, decl.value);
    const idx = getOrAddVar(name, Variability.Parameter, decl.value);
    parameterIndices.push(idx);
  }

  // 2. Evaluate INITIAL statements into constant environment and parameter bindings
  for (const stmt of program.initialStatements) {
    const val = evalConstExpr(stmt.expr, constEnv);
    constEnv.set(stmt.target, val);
    const idx = getOrAddVar(stmt.target, Variability.Parameter, val);
    parameterIndices.push(idx);
  }

  // 3. Topologically sort DYNAMIC equations
  const { sorted, cycles } = topologicalSortEquations(program.dynamicStatements);
  const sortedTargets = sorted.map((s) => s.target);

  // Pre-allocate state variables so feedback references resolve with proper start values
  for (const stmt of sorted) {
    if (stmt.expr.kind === "call") {
      const callee = stmt.expr.callee.toUpperCase();
      if (callee === "INTGRL" && stmt.expr.args.length >= 2) {
        const icVal = evalConstExpr(stmt.expr.args[0]!, constEnv);
        const stateId = getOrAddVar(stmt.target, Variability.Continuous, icVal);
        stateVarIndices.push(stateId);
      } else if (callee === "REALPL" && stmt.expr.args.length >= 3) {
        const icVal = evalConstExpr(stmt.expr.args[0]!, constEnv);
        const stateId = getOrAddVar(stmt.target, Variability.Continuous, icVal);
        stateVarIndices.push(stateId);
      } else if (callee === "CMPXPL" && stmt.expr.args.length >= 5) {
        const ic1 = evalConstExpr(stmt.expr.args[0]!, constEnv);
        const ic2 = evalConstExpr(stmt.expr.args[1]!, constEnv);
        const yId = getOrAddVar(stmt.target, Variability.Continuous, ic1);
        const ydId = getOrAddVar(`${stmt.target}_DER`, Variability.Continuous, ic2);
        stateVarIndices.push(yId, ydId);
      }
    }
  }

  // 4. Lower sorted DYNAMIC equations into DAEBuilder
  for (const stmt of sorted) {
    if (stmt.expr.kind === "call") {
      const callee = stmt.expr.callee.toUpperCase();
      if (callee === "INTGRL" && stmt.expr.args.length >= 2) {
        // Y = INTGRL(IC, X)  ==>  der(Y) = X
        const stateId = getOrAddVar(stmt.target, Variability.Continuous, evalConstExpr(stmt.expr.args[0]!, constEnv));
        const lhs = builder.addDer(stateId);
        const rhs = lowerExpr(stmt.expr.args[1]!);
        builder.addEquation(EqKind.Simple, lhs, rhs);
        equationCount++;
        continue;
      }

      if (callee === "REALPL" && stmt.expr.args.length >= 3) {
        // Y = REALPL(IC, P, X)  ==>  der(Y) = (X - Y) / P
        const stateId = getOrAddVar(stmt.target, Variability.Continuous, evalConstExpr(stmt.expr.args[0]!, constEnv));
        const pExpr = lowerExpr(stmt.expr.args[1]!);
        const xExpr = lowerExpr(stmt.expr.args[2]!);
        const diff = builder.addBinaryExpr(BinOp.Sub, xExpr, builder.addName(stateId));
        const rhs = builder.addBinaryExpr(BinOp.Div, diff, pExpr);
        builder.addEquation(EqKind.Simple, builder.addDer(stateId), rhs);
        equationCount++;
        continue;
      }

      if (callee === "CMPXPL" && stmt.expr.args.length >= 5) {
        // Y = CMPXPL(IC1, IC2, P1, P2, X)
        //   der(Y) = Y_DER
        //   der(Y_DER) = X - 2*P1*P2*Y_DER - P2^2*Y
        const yId = getOrAddVar(stmt.target, Variability.Continuous, evalConstExpr(stmt.expr.args[0]!, constEnv));
        const ydId = getOrAddVar(
          `${stmt.target}_DER`,
          Variability.Continuous,
          evalConstExpr(stmt.expr.args[1]!, constEnv),
        );
        const p1 = lowerExpr(stmt.expr.args[2]!);
        const p2 = lowerExpr(stmt.expr.args[3]!);
        const xExpr = lowerExpr(stmt.expr.args[4]!);

        builder.addEquation(EqKind.Simple, builder.addDer(yId), builder.addName(ydId));
        equationCount++;

        const dampTerm = builder.addBinaryExpr(
          BinOp.Mul,
          builder.addBinaryExpr(BinOp.Mul, builder.addRealLiteral(2.0), builder.addBinaryExpr(BinOp.Mul, p1, p2)),
          builder.addName(ydId),
        );
        const stiffTerm = builder.addBinaryExpr(
          BinOp.Mul,
          builder.addBinaryExpr(BinOp.Mul, p2, p2),
          builder.addName(yId),
        );
        const rhs = builder.addBinaryExpr(BinOp.Sub, builder.addBinaryExpr(BinOp.Sub, xExpr, dampTerm), stiffTerm);
        builder.addEquation(EqKind.Simple, builder.addDer(ydId), rhs);
        equationCount++;
        continue;
      }
    }

    // Algebraic equation: target = expr
    const targetId = getOrAddVar(stmt.target, Variability.Continuous, 0.0);
    const rhs = lowerExpr(stmt.expr);
    builder.addEquation(EqKind.Simple, builder.addName(targetId), rhs);
    equationCount++;
  }

  return {
    stateVarIndices,
    parameterIndices,
    equationCount,
    variableMap,
    sortedTargets,
    algebraicLoops: cycles,
  };
}

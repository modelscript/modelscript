// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Direct Clocked DAE Arena Lowering for Lustre Synchronous Dataflow Nodes.
 *
 * Lowers Lustre streams (`pre`, `->`, `when`, `current`, `merge`) directly into
 * `@modelscript/runtime`'s `IDaeBuilder` linear memory representation without
 * intermediate AST wrapper allocations.
 */

import {
  BinOp,
  Causality,
  EqKind,
  ExprKind,
  type IDaeBuilder,
  UnaryOp,
  VarType,
  Variability,
} from "@modelscript/runtime";
import { ensureBuiltInLustreLibraryRegistered } from "../catalog/library-package-adapter.js";
import type { LustreExpr, LustreNodeDecl, LustreProgram, LustreType } from "../types.js";

export interface LustreDaeLoweringOptions {
  /** Target node name to lower (defaults to the last node in the program). */
  nodeName?: string;
  /** Base synchronous sample period in seconds (default 0.01 s). */
  samplePeriod?: number;
}

export interface LustreDaeLoweringResult {
  nodeName: string;
  samplePeriod: number;
  stateVarIndices: number[];
  clockVarIndices: number[];
  equationCount: number;
  initialEquationCount: number;
  variableMap: Map<string, number>;
  clockMap: Map<string, number>;
}

function mapLustreVarType(t: LustreType): VarType {
  if (t.kind === "base") {
    if (t.name === "bool") return VarType.Boolean;
    if (t.name === "int") return VarType.Integer;
    return VarType.Real;
  }
  return VarType.Real;
}

function mapBinOp(op: string): BinOp | null {
  switch (op) {
    case "+":
      return BinOp.Add;
    case "-":
      return BinOp.Sub;
    case "*":
      return BinOp.Mul;
    case "/":
    case "div":
      return BinOp.Div;
    case "and":
      return BinOp.And;
    case "or":
      return BinOp.Or;
    case "=":
      return BinOp.Eq;
    case "<>":
      return BinOp.Neq;
    case "<":
      return BinOp.Lt;
    case "<=":
      return BinOp.Lte;
    case ">":
      return BinOp.Gt;
    case ">=":
      return BinOp.Gte;
    default:
      return null;
  }
}

/**
 * Lowers a Lustre node directly into `@modelscript/runtime`'s `IDaeBuilder` linear memory.
 */
export function lowerLustreToDae(
  builder: IDaeBuilder,
  program: LustreProgram,
  options: LustreDaeLoweringOptions = {},
): LustreDaeLoweringResult {
  ensureBuiltInLustreLibraryRegistered();

  const samplePeriod = options.samplePeriod ?? 0.01;
  const node: LustreNodeDecl | undefined = options.nodeName
    ? program.nodes.find((n) => n.name === options.nodeName)
    : program.nodes[program.nodes.length - 1];

  const variableMap = new Map<string, number>();
  const clockMap = new Map<string, number>();
  const stateVarIndices: number[] = [];
  const clockVarIndices: number[] = [];
  let equationCount = 0;
  let initialEquationCount = 0;

  if (!node) {
    return {
      nodeName: options.nodeName ?? "",
      samplePeriod,
      stateVarIndices,
      clockVarIndices,
      equationCount,
      initialEquationCount,
      variableMap,
      clockMap,
    };
  }

  const getOrAddVar = (
    name: string,
    varType: VarType,
    variability: Variability,
    causality: Causality,
    startVal = 0.0,
  ): number => {
    const existing = variableMap.get(name);
    if (existing !== undefined) return existing;
    const looked = builder.lookupVariable(name);
    if (looked !== -1) {
      variableMap.set(name, looked);
      return looked;
    }
    const idx = builder.addVariable(name, varType, variability, causality, startVal);
    variableMap.set(name, idx);
    return idx;
  };

  // 1. Register base synchronous clock and first-tick indicator
  const baseClkIdx = getOrAddVar("_clk_base", VarType.Clock, Variability.Discrete, Causality.Local, samplePeriod);
  clockMap.set("base", baseClkIdx);
  clockVarIndices.push(baseClkIdx);

  const firstTickIdx = getOrAddVar("_first_tick", VarType.Boolean, Variability.Discrete, Causality.Local, 1.0);
  // Initial equation: _first_tick = true; clocked transition: _first_tick = false
  builder.addEquation(EqKind.InitialSimple, builder.addName(firstTickIdx), builder.addBoolLiteral(true));
  initialEquationCount++;

  // 2. Register top-level constants
  for (const c of program.consts) {
    const vt = c.type
      ? mapLustreVarType(c.type)
      : c.value?.kind === "bool"
        ? VarType.Boolean
        : c.value?.kind === "int"
          ? VarType.Integer
          : VarType.Real;
    let startVal = 0;
    if (c.value?.kind === "int" || c.value?.kind === "real") startVal = c.value.value;
    else if (c.value?.kind === "bool") startVal = c.value.value ? 1 : 0;
    getOrAddVar(c.name, vt, Variability.Constant, Causality.Local, startVal);
  }

  // 3. Register inputs, outputs, and locals
  for (const v of node.inputs) {
    getOrAddVar(v.name, mapLustreVarType(v.type), Variability.Discrete, Causality.Input, 0.0);
  }
  for (const v of node.outputs) {
    getOrAddVar(v.name, mapLustreVarType(v.type), Variability.Discrete, Causality.Output, 0.0);
  }
  for (const v of node.locals) {
    getOrAddVar(v.name, mapLustreVarType(v.type), Variability.Discrete, Causality.Local, 0.0);
  }

  const getOrAddSubClock = (clockVar: string, negated: boolean): number => {
    const key = negated ? `not_${clockVar}` : clockVar;
    const existing = clockMap.get(key);
    if (existing !== undefined) return existing;
    const idx = getOrAddVar(`_clk_${key}`, VarType.Clock, Variability.Discrete, Causality.Local, samplePeriod);
    clockMap.set(key, idx);
    clockVarIndices.push(idx);
    return idx;
  };

  // Lower Lustre expression directly into DAE arena ExprId
  const lowerExpr = (expr: LustreExpr): number => {
    switch (expr.kind) {
      case "bool":
        return builder.addBoolLiteral(expr.value);
      case "int":
        return builder.addIntLiteral(expr.value);
      case "real":
        return builder.addRealLiteral(expr.value);
      case "var": {
        const idx = getOrAddVar(expr.name, VarType.Real, Variability.Discrete, Causality.Local, 0.0);
        return builder.addName(idx);
      }
      case "unary": {
        if (expr.op === "pre") {
          const innerId = lowerExpr(expr.operand);
          if (expr.operand.kind === "var") {
            const vIdx = variableMap.get(expr.operand.name);
            if (vIdx !== undefined && !stateVarIndices.includes(vIdx)) {
              stateVarIndices.push(vIdx);
            }
          }
          return builder.addExpression(ExprKind.Pre, innerId);
        }
        if (expr.op === "current") {
          // `current(e)` projects a sub-clocked stream to its parent clock via hold semantics
          return lowerExpr(expr.operand);
        }
        if (expr.op === "not") {
          return builder.addUnaryExpr(UnaryOp.Not, lowerExpr(expr.operand));
        }
        return builder.addUnaryExpr(UnaryOp.Negate, lowerExpr(expr.operand));
      }
      case "binary": {
        if (expr.op === "->") {
          const initId = lowerExpr(expr.left);
          const stepId = lowerExpr(expr.right);
          return builder.addIfElse(builder.addName(firstTickIdx), initId, stepId);
        }
        if (expr.op === "when") {
          let clkName = "c";
          let negated = false;
          if (expr.right.kind === "var") {
            clkName = expr.right.name;
          } else if (expr.right.kind === "unary" && expr.right.op === "not" && expr.right.operand.kind === "var") {
            clkName = expr.right.operand.name;
            negated = true;
          }
          getOrAddSubClock(clkName, negated);
          const valId = lowerExpr(expr.left);
          const condId = lowerExpr(expr.right);
          // Sub-sampled stream holds its previous value when clock is false
          return builder.addIfElse(condId, valId, builder.addExpression(ExprKind.Pre, valId));
        }
        if (expr.op === "=>") {
          // a => b  ===  (not a) or b
          return builder.addBinaryExpr(
            BinOp.Or,
            builder.addUnaryExpr(UnaryOp.Not, lowerExpr(expr.left)),
            lowerExpr(expr.right),
          );
        }
        if (expr.op === "xor") {
          return builder.addBinaryExpr(BinOp.Neq, lowerExpr(expr.left), lowerExpr(expr.right));
        }
        if (expr.op === "mod") {
          // a mod b === a - (a / b) * b (approximated via binary sub/div/mul in arena)
          const l = lowerExpr(expr.left);
          const r = lowerExpr(expr.right);
          const q = builder.addBinaryExpr(BinOp.Div, l, r);
          return builder.addBinaryExpr(BinOp.Sub, l, builder.addBinaryExpr(BinOp.Mul, q, r));
        }
        const binOp = mapBinOp(expr.op);
        const leftId = lowerExpr(expr.left);
        const rightId = lowerExpr(expr.right);
        return builder.addBinaryExpr(binOp ?? BinOp.Add, leftId, rightId);
      }
      case "if":
        return builder.addIfElse(lowerExpr(expr.cond), lowerExpr(expr.thenExpr), lowerExpr(expr.elseExpr));
      case "merge": {
        const clkIdx = getOrAddVar(expr.clockVar, VarType.Boolean, Variability.Discrete, Causality.Local, 0.0);
        return builder.addIfElse(builder.addName(clkIdx), lowerExpr(expr.trueExpr), lowerExpr(expr.falseExpr));
      }
      case "call": {
        const argIds = expr.args.map((a) => lowerExpr(a));
        const fnIdx = getOrAddVar(`_fn_${expr.callee}`, VarType.Real, Variability.Parameter, Causality.Local, 0.0);
        return builder.addCall(fnIdx, argIds[0] ?? 0, argIds.length);
      }
      case "tuple":
        return expr.elements.length > 0 ? lowerExpr(expr.elements[0]!) : builder.addRealLiteral(0.0);
      case "array":
        return expr.elements.length > 0 ? lowerExpr(expr.elements[0]!) : builder.addRealLiteral(0.0);
      case "index":
        return lowerExpr(expr.array);
    }
  };

  // 4. Lower each equation directly into the DAE arena
  for (const eq of node.equations) {
    if (eq.lhs.length === 0) continue;
    const lhsName = eq.lhs[0]!;
    const lhsIdx = getOrAddVar(lhsName, VarType.Real, Variability.Discrete, Causality.Local, 0.0);
    const lhsExprId = builder.addName(lhsIdx);

    // Emit initial equation if top-level RHS is `init -> step`
    if (eq.rhs.kind === "binary" && eq.rhs.op === "->") {
      const initExprId = lowerExpr(eq.rhs.left);
      builder.addEquation(EqKind.InitialSimple, lhsExprId, initExprId);
      initialEquationCount++;
    }

    // Emit clocked `when` equation if top-level RHS is `val when cond`
    if (eq.rhs.kind === "binary" && eq.rhs.op === "when") {
      const rhsExprId = lowerExpr(eq.rhs);
      builder.addEquation(EqKind.When, lhsExprId, rhsExprId, baseClkIdx);
      equationCount++;
    } else {
      const rhsExprId = lowerExpr(eq.rhs);
      builder.addEquation(EqKind.Simple, lhsExprId, rhsExprId, baseClkIdx);
      equationCount++;
    }
  }

  return {
    nodeName: node.name,
    samplePeriod,
    stateVarIndices,
    clockVarIndices,
    equationCount,
    initialEquationCount,
    variableMap,
    clockMap,
  };
}

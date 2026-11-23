// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Direct DAE Arena Lowering for ESA ESL models.
 *
 * Translates ESL declarations, `INITIAL`, `DYNAMIC`, `SUBMODEL`, `IF`, and `WHEN`
 * statements directly into `@modelscript/runtime`'s `IDaeBuilder` linear memory arena
 * without intermediate AST wrapper allocations.
 */

import { BinOp, Causality, EqKind, type IDaeBuilder, UnaryOp, VarType, Variability } from "@modelscript/runtime";
import { ensureBuiltInEslLibraryRegistered } from "../catalog/library-package-adapter.js";
import type { EslBinaryOp, EslBlock, EslDataType, EslExpr, EslProgram, EslStatement } from "../types.js";

export interface EslDaeLoweringResult {
  stateVarIndices: number[];
  equationCount: number;
  whenCount: number;
  variableMap: Map<string, number>;
}

function mapDataType(dt: EslDataType): VarType {
  switch (dt) {
    case "INTEGER":
      return VarType.Integer;
    case "LOGICAL":
      return VarType.Boolean;
    case "REAL":
    case "CONSTANT":
    default:
      return VarType.Real;
  }
}

function mapBinOp(op: EslBinaryOp): BinOp {
  switch (op) {
    case "+":
      return BinOp.Add;
    case "-":
      return BinOp.Sub;
    case "*":
      return BinOp.Mul;
    case "/":
      return BinOp.Div;
    case "**":
    case "^":
      return BinOp.Pow;
    case "=":
    case "==":
      return BinOp.Eq;
    case "/=":
    case "<>":
    case "!=":
      return BinOp.Neq;
    case "<":
      return BinOp.Lt;
    case "<=":
      return BinOp.Lte;
    case ">":
      return BinOp.Gt;
    case ">=":
      return BinOp.Gte;
    case "AND":
      return BinOp.And;
    case "OR":
      return BinOp.Or;
  }
}

function tryEvalConstExpr(expr: EslExpr, constVals: Map<string, number>): number | undefined {
  switch (expr.kind) {
    case "number":
      return expr.value;
    case "boolean":
      return expr.value ? 1 : 0;
    case "identifier":
      return constVals.get(expr.name.toUpperCase());
    case "unary": {
      const v = tryEvalConstExpr(expr.operand, constVals);
      if (v === undefined) return undefined;
      if (expr.op === "-") return -v;
      if (expr.op === "+") return v;
      return v === 0 ? 1 : 0;
    }
    case "binary": {
      const l = tryEvalConstExpr(expr.left, constVals);
      const r = tryEvalConstExpr(expr.right, constVals);
      if (l === undefined || r === undefined) return undefined;
      switch (expr.op) {
        case "+":
          return l + r;
        case "-":
          return l - r;
        case "*":
          return l * r;
        case "/":
          return r !== 0 ? l / r : undefined;
        case "**":
        case "^":
          return Math.pow(l, r);
        default:
          return undefined;
      }
    }
    default:
      return undefined;
  }
}

/**
 * Lowers a parsed `EslProgram` directly into an `IDaeBuilder` linear memory arena.
 */
export function lowerEslToDae(builder: IDaeBuilder, program: EslProgram, modelName?: string): EslDaeLoweringResult {
  ensureBuiltInEslLibraryRegistered();
  const variableMap = new Map<string, number>();
  const stateVarSet = new Set<number>();
  const constVals = new Map<string, number>([
    ["PI", Math.PI],
    ["E", Math.E],
  ]);
  let equationCount = 0;
  let whenCount = 0;

  // Submodel map (case-insensitive)
  const submodelMap = new Map<string, EslBlock>();
  for (const [name, sm] of program.submodels) {
    submodelMap.set(name.toUpperCase(), sm);
  }

  function getOrAddVar(
    name: string,
    varType: VarType = VarType.Real,
    variability: Variability = Variability.Continuous,
    startVal = 0.0,
    causality: Causality = Causality.Local,
  ): number {
    const key = name.toUpperCase();
    const existing = variableMap.get(key);
    if (existing !== undefined) return existing;

    const lookedUp = builder.lookupVariable(name);
    if (lookedUp !== -1) {
      variableMap.set(key, lookedUp);
      return lookedUp;
    }

    const idx = builder.addVariable(name, varType, variability, causality, startVal);
    variableMap.set(key, idx);
    return idx;
  }

  function lowerExpr(expr: EslExpr, subst?: Map<string, EslExpr>): number {
    switch (expr.kind) {
      case "number":
        return builder.addRealLiteral(expr.value);
      case "boolean":
        return builder.addBoolLiteral(expr.value);
      case "string":
        return builder.addStringLiteral(expr.value);
      case "identifier": {
        const key = expr.name.toUpperCase();
        const sub = subst?.get(key);
        if (sub) return lowerExpr(sub);
        const varId = getOrAddVar(expr.name, VarType.Real, Variability.Continuous, 0.0);
        return builder.addName(varId);
      }
      case "derivative": {
        const varId = getOrAddVar(expr.target, VarType.Real, Variability.Continuous, 0.0);
        stateVarSet.add(varId);
        return builder.addDer(varId);
      }
      case "unary": {
        const operandId = lowerExpr(expr.operand, subst);
        if (expr.op === "+") return operandId;
        const op = expr.op === "-" ? UnaryOp.Negate : UnaryOp.Not;
        return builder.addUnaryExpr(op, operandId);
      }
      case "binary": {
        const leftId = lowerExpr(expr.left, subst);
        const rightId = lowerExpr(expr.right, subst);
        return builder.addBinaryExpr(mapBinOp(expr.op), leftId, rightId);
      }
      case "conditional": {
        const condId = lowerExpr(expr.condition, subst);
        const thenId = lowerExpr(expr.thenExpr, subst);
        const elseId = lowerExpr(expr.elseExpr, subst);
        return builder.addIfElse(condId, thenId, elseId);
      }
      case "call": {
        const argIds = expr.args.map((a) => lowerExpr(a, subst));
        // Lower common functions directly when expressible, otherwise emit Call expression
        const fnVar = getOrAddVar(`__fn_${expr.callee}`, VarType.Real, Variability.Parameter, 0.0);
        return builder.addCall(fnVar, argIds[0] ?? 0, argIds.length);
      }
    }
  }

  function lowerStatements(stmts: EslStatement[], isInitial: boolean, subst?: Map<string, EslExpr>): void {
    for (const stmt of stmts) {
      switch (stmt.kind) {
        case "assign": {
          const rhsId = lowerExpr(stmt.value, subst);
          if (stmt.isDerivative) {
            const targetId = getOrAddVar(stmt.target, VarType.Real, Variability.Continuous, 0.0);
            stateVarSet.add(targetId);
            const lhsId = builder.addDer(targetId);
            builder.addEquation(EqKind.Simple, lhsId, rhsId);
            equationCount++;
          } else {
            const key = stmt.target.toUpperCase();
            const subTarget = subst?.get(key);
            const targetName = subTarget?.kind === "identifier" ? subTarget.name : stmt.target;
            const targetId = getOrAddVar(targetName, VarType.Real, Variability.Continuous, 0.0);
            const lhsId = builder.addName(targetId);
            builder.addEquation(isInitial ? EqKind.InitialSimple : EqKind.Simple, lhsId, rhsId);
            equationCount++;
          }
          break;
        }
        case "when": {
          const condId = lowerExpr(stmt.condition, subst);
          // Emit WHEN equation node for each body assignment
          if (stmt.body.length === 0) {
            builder.addEquation(EqKind.When, condId, builder.addRealLiteral(0.0));
            equationCount++;
          } else {
            for (const bodyStmt of stmt.body) {
              if (bodyStmt.kind === "assign") {
                const targetId = getOrAddVar(bodyStmt.target, VarType.Real, Variability.Continuous, 0.0);
                const rhsId = lowerExpr(bodyStmt.value, subst);
                const assignExpr = builder.addBinaryExpr(BinOp.Eq, builder.addName(targetId), rhsId);
                builder.addEquation(EqKind.When, condId, assignExpr);
                equationCount++;
              }
            }
          }
          whenCount++;
          break;
        }
        case "if": {
          const condId = lowerExpr(stmt.condition, subst);
          // Match simple IF-THEN-ELSE assignments to the same target into addIfElse
          const thenAssigns = stmt.thenBody.filter(
            (s): s is Extract<EslStatement, { kind: "assign" }> => s.kind === "assign",
          );
          const elseAssigns = stmt.elseBody.filter(
            (s): s is Extract<EslStatement, { kind: "assign" }> => s.kind === "assign",
          );
          const elseByTarget = new Map<string, Extract<EslStatement, { kind: "assign" }>>();
          for (const ea of elseAssigns) {
            elseByTarget.set(ea.target.toUpperCase(), ea);
          }

          for (const ta of thenAssigns) {
            const ea = elseByTarget.get(ta.target.toUpperCase());
            const thenRhs = lowerExpr(ta.value, subst);
            const elseRhs = ea ? lowerExpr(ea.value, subst) : builder.addRealLiteral(0.0);
            const ifExpr = builder.addIfElse(condId, thenRhs, elseRhs);
            const targetId = getOrAddVar(ta.target, VarType.Real, Variability.Continuous, 0.0);
            const lhsId = ta.isDerivative ? builder.addDer(targetId) : builder.addName(targetId);
            if (ta.isDerivative) stateVarSet.add(targetId);
            builder.addEquation(isInitial ? EqKind.InitialSimple : EqKind.Simple, lhsId, ifExpr);
            equationCount++;
          }
          break;
        }
        case "submodel_call": {
          const sm = submodelMap.get(stmt.callee.toUpperCase());
          if (sm) {
            const callSubst = new Map<string, EslExpr>(subst);
            for (let i = 0; i < sm.parameters.length; i++) {
              const param = sm.parameters[i]!;
              const arg = stmt.args[i];
              if (arg) {
                callSubst.set(param.name.toUpperCase(), arg);
              }
            }
            for (const decl of sm.declarations) {
              const initVal = decl.initialValue ? (tryEvalConstExpr(decl.initialValue, constVals) ?? 0.0) : 0.0;
              getOrAddVar(
                `${sm.name}_${decl.name}`,
                mapDataType(decl.dataType),
                decl.isConstant ? Variability.Parameter : Variability.Continuous,
                initVal,
              );
            }
            lowerStatements(sm.dynamicStatements, isInitial, callSubst);
          }
          break;
        }
        case "terminate":
        case "prepare":
        case "plot":
        case "print":
          break;
      }
    }
  }

  // Register package constants first
  for (const pkg of program.packages.values()) {
    for (const decl of pkg.declarations) {
      const initVal = decl.initialValue ? (tryEvalConstExpr(decl.initialValue, constVals) ?? 0.0) : 0.0;
      if (decl.isConstant) constVals.set(decl.name.toUpperCase(), initVal);
      getOrAddVar(
        decl.name,
        mapDataType(decl.dataType),
        decl.isConstant ? Variability.Constant : Variability.Parameter,
        initVal,
      );
    }
  }

  // Pick target block(s) to lower
  let targetBlocks: EslBlock[] = [];
  if (modelName) {
    const found = program.models.get(modelName) ?? program.segments.get(modelName);
    if (found) targetBlocks = [found];
  }
  if (targetBlocks.length === 0) {
    if (program.models.size > 0) {
      targetBlocks = Array.from(program.models.values());
    } else if (program.studies.length > 0) {
      targetBlocks = program.studies;
    } else {
      targetBlocks = program.blocks.filter((b) => b.kind !== "SUBMODEL" && b.kind !== "PACKAGE");
    }
  }

  for (const block of targetBlocks) {
    // 1. Register declarations with start values
    // Collect constant initial assignments from INITIAL section for start values
    const initialAssignVals = new Map<string, number>();
    for (const s of block.initialStatements) {
      if (s.kind === "assign" && !s.isDerivative) {
        const v = tryEvalConstExpr(s.value, constVals);
        if (v !== undefined) initialAssignVals.set(s.target.toUpperCase(), v);
      }
    }

    for (const decl of block.declarations) {
      let initVal = decl.initialValue ? (tryEvalConstExpr(decl.initialValue, constVals) ?? 0.0) : 0.0;
      const fromInitial = initialAssignVals.get(decl.name.toUpperCase());
      if (fromInitial !== undefined) initVal = fromInitial;
      if (decl.isConstant) constVals.set(decl.name.toUpperCase(), initVal);

      getOrAddVar(
        decl.name,
        mapDataType(decl.dataType),
        decl.isConstant ? Variability.Parameter : Variability.Continuous,
        initVal,
      );
    }

    // 2. Lower INITIAL, DYNAMIC, STEP sections
    lowerStatements(block.initialStatements, true);
    lowerStatements(block.dynamicStatements, false);
    lowerStatements(block.stepStatements, false);
  }

  return {
    stateVarIndices: Array.from(stateVarSet),
    equationCount,
    whenCount,
    variableMap,
  };
}

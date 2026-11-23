// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/gams — Direct Linear-Memory DAE Arena Lowering (`DAEBuilder`).
 *
 * Compiles instantiated GAMS LP / MILP / NLP optimization problems directly into
 * ModelScript's zero-GC WebAssembly `DAEBuilder` struct-of-arrays arena.
 */

import { BinOp, Causality, DAEBuilder, EqKind, Variability, VarType } from "@modelscript/runtime";
import type { GamsModel, InstantiatedGamsProblem } from "../types.js";
import { instantiateGams } from "./instantiator.js";

export interface GamsDaeOptions {
  builder?: DAEBuilder | undefined;
}

/**
 * Lowers an instantiated GAMS problem (or raw GAMS source/AST) directly into `DAEBuilder`.
 */
export function lowerGamsToDae(
  input: string | GamsModel | InstantiatedGamsProblem,
  options?: GamsDaeOptions,
): DAEBuilder {
  const problem: InstantiatedGamsProblem =
    typeof input === "string" || "equationDefs" in input ? instantiateGams(input) : input;

  const safeName = (problem.name || "GamsModel").replace(/[^a-zA-Z0-9_]/g, "_");
  const dae = options?.builder ?? new DAEBuilder(undefined, safeName);

  // 1. Declare all decision variables in the DAE arena
  const daeVarIds = new Map<number, number>();
  for (const v of problem.variables) {
    const varType = v.varKind === "integer" || v.varKind === "binary" ? VarType.Integer : VarType.Real;
    const cleanName = v.name.replace(/[^a-zA-Z0-9_]/g, "_");
    const vId = dae.addVariable(cleanName, varType, Variability.Continuous, Causality.Local, v.initVal);
    daeVarIds.set(v.id, vId);
  }

  // 2. Declare objective shadow variable: _obj = sum(c_i * x_i) + c0
  const objVarId = dae.addVariable(
    `_obj_${problem.objectiveVarName.replace(/[^a-zA-Z0-9_]/g, "_")}`,
    VarType.Real,
    Variability.Continuous,
    Causality.Local,
    0.0,
  );
  let objExprId = dae.addRealLiteral(problem.objectiveConstant);
  for (const term of problem.objectiveTerms) {
    const vId = daeVarIds.get(term.varId);
    if (vId !== undefined) {
      const termExpr = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(term.coeff), dae.addName(vId));
      objExprId = dae.addBinaryExpr(BinOp.Add, objExprId, termExpr);
    }
  }
  dae.addEquation(EqKind.Simple, dae.addName(objVarId), objExprId);

  // 3. Lower each instantiated constraint into DAE equations (introducing slack variables for inequalities)
  for (const con of problem.constraints) {
    let lhsExprId = dae.addRealLiteral(0.0);
    for (const term of con.terms) {
      const vId = daeVarIds.get(term.varId);
      if (vId !== undefined) {
        const termExpr = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(term.coeff), dae.addName(vId));
        lhsExprId = dae.addBinaryExpr(BinOp.Add, lhsExprId, termExpr);
      }
    }

    if (con.sense === "=") {
      dae.addEquation(EqKind.Simple, lhsExprId, dae.addRealLiteral(con.rhs));
    } else {
      const slackName = `_slack_${con.name.replace(/[^a-zA-Z0-9_]/g, "_")}`;
      const slackVarId = dae.addVariable(slackName, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
      const op = con.sense === "<=" ? BinOp.Add : BinOp.Sub;
      const withSlack = dae.addBinaryExpr(op, lhsExprId, dae.addName(slackVarId));
      dae.addEquation(EqKind.Simple, withSlack, dae.addRealLiteral(con.rhs));
    }
  }

  return dae;
}

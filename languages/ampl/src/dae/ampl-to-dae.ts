// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/ampl — Direct Linear-Memory DAE Arena Lowering for AMPL Models.
 *
 * Compiles instantiated optimization variables and equality/optimality constraint equations
 * directly into ModelScript's zero-GC WebAssembly DAEBuilder struct-of-arrays arena.
 */

import { BinOp, Causality, DAEBuilder, EqKind, Variability, VarType } from "@modelscript/runtime";
import type { InstantiatedProblem } from "../types.js";

export interface AmplDaeOptions {
  builder?: DAEBuilder | undefined;
}

export function lowerAmplToDae(problem: InstantiatedProblem, options?: AmplDaeOptions): DAEBuilder {
  const safeName = (problem.name || "AmplModel").replace(/[^a-zA-Z0-9_]/g, "_");
  const dae = options?.builder ?? new DAEBuilder(undefined, safeName);

  // 1. Declare Variables in DAE Arena
  const daeVarIds = new Map<number, number>();
  for (const v of problem.variables) {
    const varType = v.type === "integer" || v.type === "binary" ? VarType.Integer : VarType.Real;
    const vId = dae.addVariable(
      v.name,
      varType,
      Variability.Continuous,
      Causality.Local,
      v.initVal ?? 0.0,
    );
    daeVarIds.set(v.id, vId);
  }

  // 2. Add Objective as variable: obj = f(x)
  const objVarId = dae.addVariable(
    `_obj_${problem.objective.name}`,
    VarType.Real,
    Variability.Continuous,
    Causality.Local,
    0.0,
  );

  let objExprId = dae.addRealLiteral(problem.objective.expr.constant);
  for (const term of problem.objective.expr.linearTerms) {
    const vId = daeVarIds.get(term.varId);
    if (vId !== undefined) {
      const termExpr = dae.addBinaryExpr(
        BinOp.Mul,
        dae.addRealLiteral(term.coeff),
        dae.addName(vId),
      );
      objExprId = dae.addBinaryExpr(BinOp.Add, objExprId, termExpr);
    }
  }
  dae.addEquation(EqKind.Simple, dae.addName(objVarId), objExprId);

  // 3. Lower Constraints
  for (const con of problem.constraints) {
    // Check if equality constraint: lb == ub
    const isEq =
      Number.isFinite(con.lb) &&
      Number.isFinite(con.ub) &&
      Math.abs(con.lb - con.ub) < 1e-9;

    let exprId = dae.addRealLiteral(con.expr.constant);
    for (const term of con.expr.linearTerms) {
      const vId = daeVarIds.get(term.varId);
      if (vId !== undefined) {
        const termExpr = dae.addBinaryExpr(
          BinOp.Mul,
          dae.addRealLiteral(term.coeff),
          dae.addName(vId),
        );
        exprId = dae.addBinaryExpr(BinOp.Add, exprId, termExpr);
      }
    }

    if (isEq) {
      // Equality: expr == lb
      dae.addEquation(EqKind.Simple, exprId, dae.addRealLiteral(con.lb));
    } else {
      // Create slack variable for inequality: expr + slack == ub
      const slackVarId = dae.addVariable(
        `_slack_${con.name}`,
        VarType.Real,
        Variability.Continuous,
        Causality.Local,
        0.0,
      );
      const withSlack = dae.addBinaryExpr(BinOp.Add, exprId, dae.addName(slackVarId));
      dae.addEquation(
        EqKind.Simple,
        withSlack,
        dae.addRealLiteral(Number.isFinite(con.ub) ? con.ub : con.lb),
      );
    }
  }

  return dae;
}

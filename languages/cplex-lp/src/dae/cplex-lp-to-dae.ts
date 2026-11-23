// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Direct linear-memory DAE arena lowering for CPLEX LP and LINDO models.
 *
 * Compiles decision variables, linear/quadratic objective functions, and
 * equality/inequality constraints directly into `@modelscript/runtime`'s `DAEBuilder`.
 */

import { BinOp, Causality, DAEBuilder, EqKind, Variability, VarType } from "@modelscript/runtime";
import type { CplexLpModel, LinearTerm, QuadraticExpression } from "../types.js";

export interface CplexLpDaeOptions {
  builder?: DAEBuilder | undefined;
  modelName?: string | undefined;
}

export interface CplexLpDaeResult {
  builder: DAEBuilder;
  variableIds: Map<string, number>;
  objectiveVarId?: number | undefined;
  slackVarIds: Map<string, number>;
  equationCount: number;
  quadraticTermCount: number;
}

function buildLinearExpr(dae: DAEBuilder, terms: LinearTerm[], constant: number, varIds: Map<string, number>): number {
  let exprId: number | null = null;

  for (const term of terms) {
    const vId = varIds.get(term.variable);
    if (vId === undefined) continue;
    const varRef = dae.addName(vId);
    const termExpr = term.coeff === 1 ? varRef : dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(term.coeff), varRef);
    exprId = exprId === null ? termExpr : dae.addBinaryExpr(BinOp.Add, exprId, termExpr);
  }

  if (constant !== 0 || exprId === null) {
    const constExpr = dae.addRealLiteral(constant);
    exprId = exprId === null ? constExpr : dae.addBinaryExpr(BinOp.Add, exprId, constExpr);
  }

  return exprId;
}

function appendQuadraticExpr(
  dae: DAEBuilder,
  baseExprId: number,
  quadratic: QuadraticExpression | undefined,
  varIds: Map<string, number>,
): { exprId: number; count: number } {
  if (!quadratic || quadratic.terms.length === 0) {
    return { exprId: baseExprId, count: 0 };
  }

  const invDiv = quadratic.divisor !== 0 ? 1 / quadratic.divisor : 1;
  let exprId = baseExprId;
  let count = 0;

  for (const qt of quadratic.terms) {
    const v1 = varIds.get(qt.var1);
    const v2 = varIds.get(qt.var2);
    if (v1 === undefined || v2 === undefined) continue;
    const effCoeff = qt.coeff * invDiv;
    const prod = dae.addBinaryExpr(BinOp.Mul, dae.addName(v1), dae.addName(v2));
    const termExpr = effCoeff === 1 ? prod : dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(effCoeff), prod);
    exprId = dae.addBinaryExpr(BinOp.Add, exprId, termExpr);
    count++;
  }

  return { exprId, count };
}

/**
 * Lowers a parsed `CplexLpModel` directly into a `DAEBuilder` linear-memory arena.
 */
export function lowerCplexLpToDae(model: CplexLpModel, options?: CplexLpDaeOptions): CplexLpDaeResult {
  const safeName = (options?.modelName || model.name || "CplexLpModel").replace(/[^A-Za-z0-9_]/g, "_");
  const dae = options?.builder ?? new DAEBuilder(undefined, safeName);

  const variableIds = new Map<string, number>();
  const slackVarIds = new Map<string, number>();
  let equationCount = 0;
  let quadraticTermCount = 0;

  // 1. Declare decision variables
  for (const varName of model.variableOrder) {
    const info = model.variables.get(varName);
    const varType = info && (info.domain === "general" || info.domain === "binary") ? VarType.Integer : VarType.Real;
    const initVal = info && Number.isFinite(info.lower) && info.lower > 0 ? info.lower : 0.0;
    const vId = dae.addVariable(varName, varType, Variability.Continuous, Causality.Local, initVal);
    variableIds.set(varName, vId);
  }

  // 2. Lower objective function: `_obj_<name> = linear + quadratic`
  let objectiveVarId: number | undefined;
  if (model.objective) {
    const objName = `_obj_${(model.objective.name || model.objective.sense).replace(/[^A-Za-z0-9_]/g, "_")}`;
    objectiveVarId = dae.addVariable(objName, VarType.Real, Variability.Continuous, Causality.Local, 0.0);

    const linExpr = buildLinearExpr(dae, model.objective.linearTerms, model.objective.constant, variableIds);
    const quadRes = appendQuadraticExpr(dae, linExpr, model.objective.quadratic, variableIds);
    quadraticTermCount += quadRes.count;

    dae.addEquation(EqKind.Simple, dae.addName(objectiveVarId), quadRes.exprId);
    equationCount++;
  }

  // 3. Lower constraints
  for (let i = 0; i < model.constraints.length; i++) {
    const con = model.constraints[i]!;
    const linExpr = buildLinearExpr(dae, con.linearTerms, 0, variableIds);
    const quadRes = appendQuadraticExpr(dae, linExpr, con.quadratic, variableIds);
    quadraticTermCount += quadRes.count;
    const rhsExpr = dae.addRealLiteral(con.rhs);

    if (con.sense === "=") {
      dae.addEquation(EqKind.Simple, quadRes.exprId, rhsExpr);
      equationCount++;
    } else if (con.sense === "<=") {
      const slackName = `_slack_${con.name.replace(/[^A-Za-z0-9_]/g, "_")}_${i}`;
      const slackId = dae.addVariable(slackName, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
      slackVarIds.set(con.name, slackId);
      const lhsWithSlack = dae.addBinaryExpr(BinOp.Add, quadRes.exprId, dae.addName(slackId));
      dae.addEquation(EqKind.Simple, lhsWithSlack, rhsExpr);
      equationCount++;
    } else {
      // ">=": lhs - surplus = rhs
      const surplusName = `_surplus_${con.name.replace(/[^A-Za-z0-9_]/g, "_")}_${i}`;
      const surplusId = dae.addVariable(surplusName, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
      slackVarIds.set(con.name, surplusId);
      const lhsWithSurplus = dae.addBinaryExpr(BinOp.Sub, quadRes.exprId, dae.addName(surplusId));
      dae.addEquation(EqKind.Simple, lhsWithSurplus, rhsExpr);
      equationCount++;
    }
  }

  return {
    builder: dae,
    variableIds,
    objectiveVarId,
    slackVarIds,
    equationCount,
    quadraticTermCount,
  };
}

/**
 * Convenience wrapper returning the populated `DAEBuilder`.
 */
export function cplexLpToDae(model: CplexLpModel, options?: CplexLpDaeOptions): DAEBuilder {
  return lowerCplexLpToDae(model, options).builder;
}

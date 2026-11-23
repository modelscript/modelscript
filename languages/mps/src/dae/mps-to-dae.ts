// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/mps — Direct Linear-Memory DAE Arena Lowering.
 *
 * Lowers sparse LP/MILP/QP MPS matrices directly into @modelscript/runtime's
 * DAEBuilder without allocating intermediate AST wrapper objects:
 *   - Decision variables (Real for continuous, Integer for integer/binary)
 *   - Objective variable `obj` = c^T x + (1/2) x^T Q x
 *   - Equality constraints `sum_j a_{ij} x_j = b_i`
 *   - Inequality/ranged constraints via explicit non-negative slack variables
 *     (`L`: sum a_ij x_j + s_i = b_i; `G`: sum a_ij x_j - s_i = b_i)
 */

import { BinOp, Causality, DAEBuilder, EqKind, type IDaeBuilder, VarType, Variability } from "@modelscript/runtime";
import { parseMps } from "../parser/mps-parser.js";
import type { MpsModel } from "../types.js";

export interface MpsToDaeOptions {
  modelName?: string | undefined;
}

export interface MpsDaeLoweringResult {
  variableCount: number;
  slackCount: number;
  equationCount: number;
  objectiveVarId: number;
  variableMap: Map<string, number>;
  slackMap: Map<string, number>;
}

/**
 * Lowers a parsed MpsModel directly into an IDaeBuilder linear-memory arena.
 */
export function lowerMpsToDae(builder: IDaeBuilder, model: MpsModel): MpsDaeLoweringResult {
  const variableMap = new Map<string, number>();
  const slackMap = new Map<string, number>();
  let equationCount = 0;

  // 1. Register decision variables in arena
  for (const col of model.columns.values()) {
    const varType = col.varType === "continuous" ? VarType.Real : VarType.Integer;
    const variability = col.varType === "continuous" ? Variability.Continuous : Variability.Discrete;
    const startVal =
      Number.isFinite(col.lb) && col.lb > 0 ? col.lb : Number.isFinite(col.ub) && col.ub < 0 ? col.ub : 0;
    const varId = builder.addVariable(col.name, varType, variability, Causality.Local, startVal);
    variableMap.set(col.name, varId);
  }

  // Build row -> (varId, coeff) adjacency directly without heavy wrappers
  const rowTerms = new Map<string, Array<{ varId: number; coeff: number }>>();
  for (const rowName of model.rows.keys()) {
    rowTerms.set(rowName, []);
  }
  for (const col of model.columns.values()) {
    const varId = variableMap.get(col.name);
    if (varId === undefined) continue;
    for (const entry of col.entries) {
      if (Math.abs(entry.coeff) <= 1e-15) continue;
      const list = rowTerms.get(entry.rowName);
      if (list) {
        list.push({ varId, coeff: entry.coeff });
      }
    }
  }

  function buildLinearExpr(terms: Array<{ varId: number; coeff: number }>): number {
    if (terms.length === 0) {
      return builder.addRealLiteral(0);
    }
    let acc = -1;
    for (const t of terms) {
      const varRef = builder.addName(t.varId);
      const termExpr =
        Math.abs(t.coeff - 1) <= 1e-15
          ? varRef
          : builder.addBinaryExpr(BinOp.Mul, builder.addRealLiteral(t.coeff), varRef);
      acc = acc === -1 ? termExpr : builder.addBinaryExpr(BinOp.Add, acc, termExpr);
    }
    return acc;
  }

  // 2. Objective variable and equation: obj = c^T x + 0.5 * x^T Q x
  const objName = model.objectiveRow ?? "obj";
  const objVarName = variableMap.has(objName) ? `__mps_${objName}` : objName;
  const objectiveVarId = builder.addVariable(objVarName, VarType.Real, Variability.Continuous, Causality.Output, 0);

  const objLinearTerms = model.objectiveRow ? (rowTerms.get(model.objectiveRow) ?? []) : [];
  let objExpr = buildLinearExpr(objLinearTerms);

  // Add quadratic objective terms: (1/2) * Q_{ii} * x_i^2 or Q_{ij} * x_i * x_j
  if (model.quadObj.length > 0) {
    for (const q of model.quadObj) {
      const id1 = variableMap.get(q.col1);
      const id2 = variableMap.get(q.col2);
      if (id1 === undefined || id2 === undefined || Math.abs(q.coeff) <= 1e-15) continue;

      const factor = q.col1 === q.col2 ? 0.5 * q.coeff : q.coeff;
      const prod = builder.addBinaryExpr(BinOp.Mul, builder.addName(id1), builder.addName(id2));
      const qTerm = builder.addBinaryExpr(BinOp.Mul, builder.addRealLiteral(factor), prod);
      objExpr =
        objLinearTerms.length === 0 && objExpr === builder.addRealLiteral(0)
          ? qTerm
          : builder.addBinaryExpr(BinOp.Add, objExpr, qTerm);
    }
  }

  builder.addEquation(EqKind.Simple, builder.addName(objectiveVarId), objExpr);
  equationCount++;

  // 3. Constraint rows
  for (const row of model.rows.values()) {
    if (row.type === "N") continue;
    const terms = rowTerms.get(row.name) ?? [];
    const lhsBase = buildLinearExpr(terms);
    const rhsExpr = builder.addRealLiteral(row.rhs);

    if (row.type === "E" && (row.range === undefined || Math.abs(row.range) <= 1e-15)) {
      builder.addEquation(EqKind.Simple, lhsBase, rhsExpr);
      equationCount++;
    } else if (row.type === "L") {
      // sum a_ij x_j + slack = rhs
      const slackName = `slack_${row.name}`;
      const slackId = builder.addVariable(slackName, VarType.Real, Variability.Continuous, Causality.Local, 0);
      slackMap.set(row.name, slackId);
      const lhsWithSlack = builder.addBinaryExpr(BinOp.Add, lhsBase, builder.addName(slackId));
      builder.addEquation(EqKind.Simple, lhsWithSlack, rhsExpr);
      equationCount++;
    } else if (row.type === "G") {
      // sum a_ij x_j - slack = rhs
      const slackName = `slack_${row.name}`;
      const slackId = builder.addVariable(slackName, VarType.Real, Variability.Continuous, Causality.Local, 0);
      slackMap.set(row.name, slackId);
      const lhsWithSlack = builder.addBinaryExpr(BinOp.Sub, lhsBase, builder.addName(slackId));
      builder.addEquation(EqKind.Simple, lhsWithSlack, rhsExpr);
      equationCount++;
    } else {
      // Ranged equality row: rhs <= a^T x <= rhs + r (if r > 0) or rhs + r <= a^T x <= rhs (if r < 0)
      const slackName = `slack_${row.name}`;
      const slackId = builder.addVariable(slackName, VarType.Real, Variability.Continuous, Causality.Local, 0);
      slackMap.set(row.name, slackId);
      const op = (row.range ?? 0) >= 0 ? BinOp.Sub : BinOp.Add;
      const lhsWithSlack = builder.addBinaryExpr(op, lhsBase, builder.addName(slackId));
      builder.addEquation(EqKind.Simple, lhsWithSlack, rhsExpr);
      equationCount++;
    }
  }

  return {
    variableCount: variableMap.size,
    slackCount: slackMap.size,
    equationCount,
    objectiveVarId,
    variableMap,
    slackMap,
  };
}

/**
 * Convenience entry point: creates a DAEBuilder and lowers an MpsModel or MPS source string.
 */
export function mpsToDae(input: MpsModel | string, options?: MpsToDaeOptions): DAEBuilder {
  const model = typeof input === "string" ? parseMps(input) : input;
  const modelName = (options?.modelName || model.name || "MpsModel").replace(/[^A-Za-z0-9_]/g, "_");
  const builder = new DAEBuilder(undefined, modelName);
  lowerMpsToDae(builder, model);
  return builder;
}

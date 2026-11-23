// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/ampl — Direct Linear-Memory DAE Arena Lowering for AMPL Models.
 *
 * Compiles instantiated optimization variables, multi-objectives (preserving min/max sense),
 * bounded equality/inequality constraints, and complementarity constraints directly into
 * ModelScript's zero-GC WebAssembly DAEBuilder optimization side-tables.
 */

import {
  BinOp,
  Causality,
  ConstraintKind,
  DAEBuilder,
  DaeObjectiveSense,
  FLAG_VAR_BINARY,
  Variability,
  VarType,
} from "@modelscript/runtime";
import { ensureBuiltInAmplLibraryRegistered, lookupAmplModelSchema } from "../catalog/library-package-adapter.js";
import type { FlatExpression, InstantiatedProblem } from "../types.js";

export interface AmplDaeOptions {
  builder?: DAEBuilder | undefined;
}

/**
 * Resolves parameter defaults for an AMPL model from `@modelscript/ampl-std-lib`,
 * merging any user-specified named overrides over the cleanroom schema defaults.
 */
export function resolveAmplSchemaParamDefaults(
  modelName: string,
  overrides: Record<string, number> = {},
): Record<string, number> {
  ensureBuiltInAmplLibraryRegistered();
  const resolved: Record<string, number> = {};
  const schema = lookupAmplModelSchema(modelName);
  if (schema) {
    for (const p of schema.parameters) {
      if (typeof p.defaultValue === "number" && Number.isFinite(p.defaultValue)) {
        resolved[p.key] = p.defaultValue;
      }
    }
  }
  for (const [k, v] of Object.entries(overrides)) {
    if (Number.isFinite(v)) {
      resolved[k] = v;
    }
  }
  return resolved;
}

function lowerFlatExpr(dae: DAEBuilder, expr: FlatExpression, daeVarIds: Map<number, number>): number {
  let accId = dae.addRealLiteral(expr.constant);
  for (const term of expr.linearTerms) {
    const vId = daeVarIds.get(term.varId);
    if (vId !== undefined) {
      const termExpr = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(term.coeff), dae.addName(vId));
      accId = dae.addBinaryExpr(BinOp.Add, accId, termExpr);
    }
  }
  if (expr.quadraticTerms) {
    for (const qt of expr.quadraticTerms) {
      const v1 = daeVarIds.get(qt.var1Id);
      const v2 = daeVarIds.get(qt.var2Id);
      if (v1 !== undefined && v2 !== undefined) {
        const prod = dae.addBinaryExpr(BinOp.Mul, dae.addName(v1), dae.addName(v2));
        const scaled = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(qt.coeff), prod);
        accId = dae.addBinaryExpr(BinOp.Add, accId, scaled);
      }
    }
  }
  return accId;
}

export function lowerAmplToDae(problem: InstantiatedProblem, options?: AmplDaeOptions): DAEBuilder {
  ensureBuiltInAmplLibraryRegistered();
  const safeName = (problem.name || "AmplModel").replace(/[^a-zA-Z0-9_]/g, "_");
  const dae = options?.builder ?? new DAEBuilder(undefined, safeName);

  // 1. Declare Variables in DAE Arena (with exact types, binary flag, and min/max bounds)
  const daeVarIds = new Map<number, number>();
  for (const v of problem.variables) {
    const varType = v.type === "integer" || v.type === "binary" ? VarType.Integer : VarType.Real;
    const flags = v.type === "binary" ? FLAG_VAR_BINARY : 0;
    const vId = dae.addVariable(v.name, varType, Variability.Continuous, Causality.Local, v.initVal ?? 0.0, flags);
    if (Number.isFinite(v.lb)) {
      dae.setVarAttr(vId, "min", dae.addRealLiteral(v.lb));
    }
    if (Number.isFinite(v.ub)) {
      dae.setVarAttr(vId, "max", dae.addRealLiteral(v.ub));
    }
    daeVarIds.set(v.id, vId);
  }

  // 2. Lower Objectives directly into WASM optimization side-table (preserving min/max sense)
  const objectives = problem.objectives && problem.objectives.length > 0 ? problem.objectives : [problem.objective];
  for (const obj of objectives) {
    const objExprId = lowerFlatExpr(dae, obj.expr, daeVarIds);
    const sense = obj.direction === "maximize" ? DaeObjectiveSense.Maximize : DaeObjectiveSense.Minimize;
    dae.optimization.addObjective(objExprId, -1, sense);
  }

  // 3. Lower Constraints directly into WASM optimization side-table (no fake _slack_* variables)
  for (const con of problem.constraints) {
    if (con.dropped) continue;
    const exprId = lowerFlatExpr(dae, con.expr, daeVarIds);
    dae.optimization.addConstraint(exprId, con.lb, con.ub, ConstraintKind.Algebraic);

    if (con.complements) {
      const compExprId = lowerFlatExpr(dae, con.complements.expr, daeVarIds);
      dae.optimization.addComplementarity(exprId, compExprId);
    }
  }

  return dae;
}

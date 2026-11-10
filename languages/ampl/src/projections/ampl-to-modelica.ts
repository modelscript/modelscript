// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/ampl — Projection of AMPL Models to Acausal Modelica.
 */

import type { InstantiatedProblem } from "../types.js";

export interface AmplToModelicaOptions {
  modelName?: string | undefined;
}

/**
 * Lowers an instantiated AMPL mathematical programming problem to an equivalent
 * acausal Modelica optimization model.
 */
export function amplToModelica(problem: InstantiatedProblem, options?: AmplToModelicaOptions): string {
  const modelName = (options?.modelName ?? problem.name ?? "AmplOptimizationModel").replace(/[^a-zA-Z0-9_]/g, "_");
  const lines: string[] = [];

  lines.push(`model ${modelName}`);
  lines.push(`  "Acausal Modelica optimization model generated from AMPL"`);
  lines.push("");

  // 1. Decision Variables
  lines.push("  // Decision Variables");
  for (const v of problem.variables) {
    const isInt = v.type === "integer" || v.type === "binary";
    const typeName = isInt ? "Integer" : "Real";
    const attrs: string[] = [];
    if (Number.isFinite(v.lb) && v.lb !== -Infinity) {
      attrs.push(`min = ${v.lb}`);
    }
    if (Number.isFinite(v.ub) && v.ub !== Infinity) {
      attrs.push(`max = ${v.ub}`);
    }
    if (v.initVal !== undefined && Number.isFinite(v.initVal)) {
      attrs.push(`start = ${v.initVal}`);
    }
    const attrStr = attrs.length > 0 ? `(${attrs.join(", ")})` : "";
    const safeVarName = v.name.replace(/\[/g, "_").replace(/\]/g, "").replace(/,/g, "_");
    lines.push(`  ${typeName} ${safeVarName}${attrStr} "AMPL var ${v.name}";`);
  }
  lines.push("");

  // 2. Objective variable
  const safeObjName = `_obj_${problem.objective.name}`;
  lines.push("  // Objective Variable");
  lines.push(`  Real ${safeObjName} "AMPL ${problem.objective.direction} objective";`);
  lines.push("");

  // 3. Equations & Constraints
  lines.push("equation");

  const formatLinearExpr = (terms: typeof problem.objective.expr.linearTerms, constant: number) => {
    const parts: string[] = [];
    if (constant !== 0) {
      parts.push(`${constant}`);
    }
    for (const t of terms) {
      const v = problem.variables.find((x) => x.id === t.varId);
      const safeVName = v ? v.name.replace(/\[/g, "_").replace(/\]/g, "").replace(/,/g, "_") : `v${t.varId}`;
      if (t.coeff === 1) {
        parts.push(safeVName);
      } else if (t.coeff === -1) {
        parts.push(`-${safeVName}`);
      } else {
        parts.push(`${t.coeff} * ${safeVName}`);
      }
    }
    if (parts.length === 0) return "0";
    return parts.join(" + ").replace(/\+\s+-/g, "- ");
  };

  // Objective equation
  const objExprStr = formatLinearExpr(problem.objective.expr.linearTerms, problem.objective.expr.constant);
  lines.push(`  ${safeObjName} = ${objExprStr};`);
  lines.push("");

  // Constraints
  lines.push("  // Constraints");
  for (const c of problem.constraints) {
    const exprStr = formatLinearExpr(c.expr.linearTerms, c.expr.constant);
    const isEq = Number.isFinite(c.lb) && Number.isFinite(c.ub) && Math.abs(c.lb - c.ub) < 1e-9;
    if (isEq) {
      lines.push(`  ${exprStr} = ${c.lb}; // ${c.name}`);
    } else {
      const hasLb = Number.isFinite(c.lb) && c.lb !== -Infinity;
      const hasUb = Number.isFinite(c.ub) && c.ub !== Infinity;
      if (hasLb && hasUb) {
        lines.push(`  ${c.lb} <= ${exprStr}; // ${c.name} (lower bound)`);
        lines.push(`  ${exprStr} <= ${c.ub}; // ${c.name} (upper bound)`);
      } else if (hasUb) {
        lines.push(`  ${exprStr} <= ${c.ub}; // ${c.name}`);
      } else if (hasLb) {
        lines.push(`  ${exprStr} >= ${c.lb}; // ${c.name}`);
      }
    }
  }

  lines.push("");
  lines.push(`end ${modelName};`);
  lines.push("");

  return lines.join("\n");
}

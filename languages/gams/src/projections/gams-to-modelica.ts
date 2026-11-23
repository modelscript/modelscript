// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/gams — Projection to Modelica (.mo).
 */

import { instantiateGams } from "../dae/instantiator.js";
import type { GamsModel, InstantiatedGamsProblem } from "../types.js";

function moIdent(raw: string): string {
  const s = raw
    .replace(/[^A-Za-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  return /^[0-9]/.test(s) ? `v_${s}` : s || "v";
}

/**
 * Projects an instantiated GAMS problem into a flat Modelica `model` with decision variables,
 * bounds annotations, slack variables for inequalities, and algebraic equations.
 */
export function gamsToModelica(input: string | GamsModel | InstantiatedGamsProblem): string {
  const problem: InstantiatedGamsProblem =
    typeof input === "string" || "equationDefs" in input ? instantiateGams(input) : input;

  const modelName = moIdent(problem.name || "GamsModel");
  const lines: string[] = [];
  lines.push(
    `model ${modelName} "Projected from GAMS (${problem.solverType.toUpperCase()}, ${problem.sense} ${problem.objectiveVarName})"`,
  );

  const varNames = problem.variables.map((v) => moIdent(v.name));

  for (let j = 0; j < problem.variables.length; j++) {
    const v = problem.variables[j]!;
    const vType = v.varKind === "binary" || v.varKind === "integer" ? "Integer" : "Real";
    const mods: string[] = [];
    if (Number.isFinite(v.lb)) mods.push(`min=${v.lb}`);
    if (Number.isFinite(v.ub)) mods.push(`max=${v.ub}`);
    if (v.initVal !== 0) mods.push(`start=${v.initVal}`);
    const modStr = mods.length > 0 ? `(${mods.join(", ")})` : "";
    lines.push(`  ${vType} ${varNames[j]!}${modStr};`);
  }

  // Slack variables for inequality constraints
  const slackNames = new Map<number, string>();
  for (const con of problem.constraints) {
    if (con.sense !== "=") {
      const sName = `slack_${moIdent(con.name)}`;
      slackNames.set(con.id, sName);
      lines.push(`  Real ${sName}(min=0.0);`);
    }
  }

  lines.push("equation");
  for (const con of problem.constraints) {
    const termStrs = con.terms.map((t) => `${t.coeff} * ${varNames[t.varId]!}`);
    let lhs = termStrs.length > 0 ? termStrs.join(" + ") : "0.0";
    const sName = slackNames.get(con.id);
    if (sName) {
      lhs += con.sense === "<=" ? ` + ${sName}` : ` - ${sName}`;
    }
    lines.push(`  ${lhs} = ${con.rhs}; // ${con.name}`);
  }

  lines.push(`end ${modelName};`);
  return lines.join("\n") + "\n";
}

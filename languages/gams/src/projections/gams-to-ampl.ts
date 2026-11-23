// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/gams — Projection to AMPL (.mod + .dat).
 */

import { parseGams } from "../parser/gams-parser.js";
import type { GamsExpr, GamsModel } from "../types.js";

export interface AmplProjectionResult {
  mod: string;
  dat: string;
}

function exprToAmpl(expr: GamsExpr): string {
  switch (expr.kind) {
    case "number":
      return String(expr.value);
    case "string":
      return `'${expr.value}'`;
    case "unary":
      return `${expr.op === "not" ? "!" : expr.op}(${exprToAmpl(expr.operand)})`;
    case "binary": {
      const opMap: Record<string, string> = {
        "**": "^",
        lt: "<",
        le: "<=",
        gt: ">",
        ge: ">=",
        eq: "==",
        ne: "!=",
        "<>": "!=",
      };
      const op = opMap[expr.op] ?? expr.op;
      return `(${exprToAmpl(expr.left)} ${op} ${exprToAmpl(expr.right)})`;
    }
    case "dollar":
      return `(if (${exprToAmpl(expr.condition)}) then (${exprToAmpl(expr.expr)}) else 0)`;
    case "indexedOp": {
      const op = expr.op === "smin" ? "min" : expr.op === "smax" ? "max" : expr.op;
      const doms = expr.domains.map((d) => `${d.index} in ${d.setName ?? d.index}`).join(", ");
      const cond = expr.condition ? `: ${exprToAmpl(expr.condition)}` : "";
      return `${op}{${doms}${cond}} (${exprToAmpl(expr.body)})`;
    }
    case "call":
      return `${expr.name}(${expr.args.map(exprToAmpl).join(", ")})`;
    case "ref": {
      if (expr.indices.length === 0) return expr.name;
      return `${expr.name}[${expr.indices.map(exprToAmpl).join(", ")}]`;
    }
  }
}

/**
 * Projects a GAMS model into idiomatic AMPL `.mod` and `.dat` text.
 */
export function gamsToAmpl(input: string | GamsModel): AmplProjectionResult {
  const model = typeof input === "string" ? parseGams(input) : input;
  const modLines: string[] = [];
  const datLines: string[] = [];

  if (model.title) {
    modLines.push(`# Projected from GAMS: ${model.title}`);
  }

  // Sets
  for (const s of model.sets) {
    modLines.push(`set ${s.name};`);
    if (s.elements.length > 0) {
      datLines.push(`set ${s.name} := ${s.elements.map((e) => `'${e}'`).join(" ")};`);
    }
  }

  // Parameters
  for (const p of model.parameters) {
    const dom = p.domain.length > 0 ? `{${p.domain.join(", ")}}` : "";
    modLines.push(`param ${p.name}${dom};`);
    const entries = Object.entries(p.values);
    if (entries.length > 0) {
      if (p.domain.length === 0) {
        datLines.push(`param ${p.name} := ${entries[0]![1]};`);
      } else {
        datLines.push(`param ${p.name} :=`);
        for (const [k, v] of entries) {
          const parts = k
            .split(".")
            .map((x) => `'${x}'`)
            .join(" ");
          datLines.push(`  ${parts} ${v}`);
        }
        datLines.push(";");
      }
    }
  }

  // Variables
  for (const v of model.variables) {
    const dom = v.domain.length > 0 ? `{${v.domain.join(", ")}}` : "";
    let qual = "";
    if (v.varKind === "positive") qual = " >= 0";
    else if (v.varKind === "negative") qual = " <= 0";
    else if (v.varKind === "binary") qual = " binary";
    else if (v.varKind === "integer") qual = " integer >= 0";
    modLines.push(`var ${v.name}${dom}${qual};`);
  }

  // Objective
  const solve = model.solves[model.solves.length - 1];
  if (solve) {
    const dir = solve.sense === "maximizing" ? "maximize" : "minimize";
    modLines.push(`${dir} Objective: ${solve.objectiveVar};`);
  }

  // Constraints
  for (const eq of model.equationDefs) {
    const dom = eq.domain.length > 0 ? `{${eq.domain.map((d) => `${d} in ${d}`).join(", ")}}` : "";
    const rel = eq.relation === "=l=" ? "<=" : eq.relation === "=g=" ? ">=" : "=";
    modLines.push(`subject to ${eq.name}${dom}: ${exprToAmpl(eq.lhs)} ${rel} ${exprToAmpl(eq.rhs)};`);
  }

  return {
    mod: modLines.join("\n") + "\n",
    dat: datLines.join("\n") + "\n",
  };
}

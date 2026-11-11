// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/mlxtran — Modelica 3.x Continuous PK/PD Projection.
 *
 * Generates an equation-oriented Modelica model representing the MLXTRAN system.
 */

import type { MlxtranDocument } from "../types.js";

export function mlxtranToModelica(doc: MlxtranDocument, modelName?: string): string {
  const model = doc.model;
  const name = (modelName ?? model.name ?? "MlxtranPkModel").replace(/[^a-zA-Z0-9_]/g, "_");

  const lines: string[] = [];
  lines.push(`model ${name} "Modelica 3.x projection of Monolix MLXTRAN pharmacokinetic model"`);

  // Parameters
  if (model.inputs.length > 0) {
    lines.push("  // Parameters");
    for (const inp of model.inputs) {
      const initVal = inp.init ?? (inp.min !== undefined && inp.min > 0 ? inp.min : 1.0);
      lines.push(`  parameter Real ${inp.name} = ${initVal.toFixed(4)};`);
    }
  }

  // Discover states and algebraics
  const states = new Set<string>();
  const algebraics = new Set<string>();

  for (const eq of model.equations) {
    if (eq.isDerivative && eq.stateName) {
      states.add(eq.stateName);
    } else {
      algebraics.add(eq.lhs);
    }
  }

  // States
  if (states.size > 0) {
    lines.push("");
    lines.push("  // Continuous State Variables");
    for (const st of states) {
      const isDepot =
        st.toLowerCase().includes("depot") || st.toLowerCase().includes("ad") || st.toLowerCase() === "a1";
      const startVal = isDepot ? "100.0" : "0.0";
      lines.push(`  Real ${st}(start = ${startVal}, fixed = true);`);
    }
  }

  // Algebraics
  if (algebraics.size > 0) {
    lines.push("");
    lines.push("  // Algebraic Variables");
    for (const alg of algebraics) {
      lines.push(`  Real ${alg};`);
    }
  }

  lines.push("");
  lines.push("equation");

  // Equations
  for (const eq of model.equations) {
    if (eq.isDerivative && eq.stateName) {
      lines.push(`  der(${eq.stateName}) = ${eq.rhs};`);
    } else {
      lines.push(`  ${eq.lhs} = ${eq.rhs};`);
    }
  }

  lines.push(`end ${name};`);
  return lines.join("\n");
}

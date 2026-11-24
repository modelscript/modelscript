// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Bidirectional Triple Graph Grammar (TGG) bridge between 20-sim (SIDOPS/Bond Graph) and Modelica.
 */

import { parseTwentySim } from "../parser/emx-parser.js";
import { twentySimToModelica } from "../projections/modelica-projection.js";
import type { TwentySimModel } from "../types.js";

export { twentySimToModelica };

export interface TwentySimTggResult {
  sidops: string;
  model: TwentySimModel;
}

/**
 * Backward TGG rule: translates a flat acausal Modelica model into 20-sim SIDOPS source and IR.
 */
export function modelicaToTwentySim(modelicaSource: string): TwentySimTggResult {
  const nameMatch = modelicaSource.match(/\bmodel\s+([A-Za-z_][A-Za-z0-9_]*)/);
  const modelName = nameMatch?.[1] ?? "ImportedModel";

  const parameters: string[] = [];
  const variables: string[] = [];
  const equations: string[] = [];

  let inEquationSection = false;
  for (const rawLine of modelicaSource.split(/\r?\n/)) {
    const line = rawLine.replace(/\/\/.*$/, "").trim();
    if (!line || line.startsWith("model ") || line.startsWith("end ")) continue;
    if (line === "equation" || line === "initial equation") {
      inEquationSection = true;
      continue;
    }

    if (!inEquationSection) {
      const paramMatch = line.match(
        /^(?:parameter|constant)\s+(?:Real|Integer|Boolean)\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s*=\s*([^;]+))?;/,
      );
      if (paramMatch) {
        const val = paramMatch[2] ? ` = ${paramMatch[2].trim()}` : " = 1.0";
        parameters.push(`    real ${paramMatch[1]}${val};`);
        continue;
      }
      const varMatch = line.match(
        /^(?:Real|Integer|Boolean)\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s*\(\s*start\s*=\s*([^)]+)\))?;/,
      );
      if (varMatch) {
        const init = varMatch[2] ? ` = ${varMatch[2].trim()}` : "";
        variables.push(`    real ${varMatch[1]}${init};`);
        continue;
      }
    } else if (line.includes("=")) {
      const sidEq = line.replace(/\bder\s*\(/g, "ddt(");
      equations.push(`    ${sidEq.endsWith(";") ? sidEq : `${sidEq};`}`);
    }
  }

  const sections: string[] = [`model ${modelName}`];
  if (parameters.length > 0) sections.push("  parameters", ...parameters);
  if (variables.length > 0) sections.push("  variables", ...variables);
  if (equations.length > 0) sections.push("  equations", ...equations);
  sections.push(`end ${modelName};`, "");

  const sidops = sections.join("\n");
  return { sidops, model: parseTwentySim(sidops, modelName) };
}

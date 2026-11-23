// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/gams — Projection to Standard MPS Format (LP / MILP).
 */

import { instantiateGams } from "../dae/instantiator.js";
import type { GamsModel, InstantiatedGamsProblem } from "../types.js";

function mpsName(raw: string): string {
  return (
    raw
      .replace(/[^A-Za-z0-9_]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "") || "V"
  );
}

/**
 * Projects a GAMS model or instantiated problem into standard fixed/free MPS format.
 */
export function gamsToMps(input: string | GamsModel | InstantiatedGamsProblem): string {
  const problem: InstantiatedGamsProblem =
    typeof input === "string" || "equationDefs" in input ? instantiateGams(input) : input;

  const lines: string[] = [];
  const modelName = mpsName(problem.name);
  const objRowName = "OBJ";
  const signObj = problem.sense === "maximizing" ? -1 : 1;

  lines.push(`NAME          ${modelName}`);
  lines.push("OBJSENSE");
  lines.push(` ${problem.sense === "maximizing" ? "MAX" : "MIN"}`);

  // ROWS section
  lines.push("ROWS");
  lines.push(` N  ${objRowName}`);
  const rowNames = problem.constraints.map((c, idx) => `${mpsName(c.name)}_${idx}`);
  for (let i = 0; i < problem.constraints.length; i++) {
    const c = problem.constraints[i]!;
    const code = c.sense === "<=" ? "L" : c.sense === ">=" ? "G" : "E";
    lines.push(` ${code}  ${rowNames[i]!}`);
  }

  // Build column map: varId -> Array<{ rowName, coeff }>
  const colEntries = new Map<number, Array<{ row: string; coeff: number }>>();
  for (const v of problem.variables) {
    colEntries.set(v.id, []);
  }
  for (const t of problem.objectiveTerms) {
    colEntries.get(t.varId)?.push({ row: objRowName, coeff: signObj * t.coeff });
  }
  for (let i = 0; i < problem.constraints.length; i++) {
    const c = problem.constraints[i]!;
    const rName = rowNames[i]!;
    for (const t of c.terms) {
      colEntries.get(t.varId)?.push({ row: rName, coeff: t.coeff });
    }
  }

  // COLUMNS section
  lines.push("COLUMNS");
  const colNames = problem.variables.map((v, idx) => `${mpsName(v.name)}_${idx}`);
  let inIntBlock = false;
  let intMarkerIdx = 0;

  for (let j = 0; j < problem.variables.length; j++) {
    const v = problem.variables[j]!;
    const isInt = v.varKind === "binary" || v.varKind === "integer";
    if (isInt && !inIntBlock) {
      lines.push(`    MARK${intMarkerIdx++}  'MARKER'  'INTORG'`);
      inIntBlock = true;
    } else if (!isInt && inIntBlock) {
      lines.push(`    MARK${intMarkerIdx++}  'MARKER'  'INTEND'`);
      inIntBlock = false;
    }
    const cName = colNames[j]!;
    const entries = colEntries.get(v.id) ?? [];
    for (const e of entries) {
      lines.push(`    ${cName}  ${e.row}  ${e.coeff}`);
    }
  }
  if (inIntBlock) {
    lines.push(`    MARK${intMarkerIdx++}  'MARKER'  'INTEND'`);
  }

  // RHS section
  lines.push("RHS");
  for (let i = 0; i < problem.constraints.length; i++) {
    const c = problem.constraints[i]!;
    if (Math.abs(c.rhs) > 1e-15) {
      lines.push(`    RHS1  ${rowNames[i]!}  ${c.rhs}`);
    }
  }

  // BOUNDS section
  lines.push("BOUNDS");
  for (let j = 0; j < problem.variables.length; j++) {
    const v = problem.variables[j]!;
    const cName = colNames[j]!;
    if (v.varKind === "binary") {
      lines.push(` BV BND1  ${cName}`);
    } else if (!Number.isFinite(v.lb) && !Number.isFinite(v.ub)) {
      lines.push(` FR BND1  ${cName}`);
    } else if (Number.isFinite(v.lb) && Number.isFinite(v.ub) && Math.abs(v.lb - v.ub) < 1e-12) {
      lines.push(` FX BND1  ${cName}  ${v.lb}`);
    } else {
      if (Number.isFinite(v.lb) && v.lb !== 0) {
        lines.push(` LO BND1  ${cName}  ${v.lb}`);
      } else if (!Number.isFinite(v.lb)) {
        lines.push(` MI BND1  ${cName}`);
      }
      if (Number.isFinite(v.ub)) {
        lines.push(` UP BND1  ${cName}  ${v.ub}`);
      }
    }
  }

  lines.push("ENDATA");
  return lines.join("\n") + "\n";
}

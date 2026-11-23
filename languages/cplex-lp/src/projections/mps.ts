// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Projects a parsed `CplexLpModel` to standard MPS (Mathematical Programming System) format.
 *
 * Emits:
 * - `NAME` & `OBJSENSE`
 * - `ROWS` (`N`, `L`, `G`, `E`)
 * - `COLUMNS` (grouped by column with `INTORG`/`INTEND` markers for integer/binary variables)
 * - `RHS`
 * - `BOUNDS` (`BV`, `FR`, `FX`, `LO`, `UP`, `MI`, `PL`, `SC`)
 * - `QUADOBJ` (for quadratic objective terms)
 * - `SOS` (for SOS1/SOS2 sets)
 * - `ENDATA`
 */

import type { CplexLpModel } from "../types.js";

function fmtNum(n: number): string {
  if (Object.is(n, -0)) return "0";
  return Number.isInteger(n) ? String(n) : String(Number(n.toPrecision(12)));
}

/**
 * Converts a `CplexLpModel` into an MPS format string.
 */
export function cplexLpToMps(model: CplexLpModel): string {
  const lines: string[] = [];
  const safeModelName = (model.name || "LPMODEL").replace(/\s+/g, "_");
  const objRowName = (model.objective?.name || "OBJ").replace(/\s+/g, "_");

  lines.push(`NAME          ${safeModelName}`);
  if (model.objective) {
    lines.push("OBJSENSE");
    lines.push(model.objective.sense === "maximize" ? " MAX" : " MIN");
  }

  // ROWS
  lines.push("ROWS");
  lines.push(` N  ${objRowName}`);
  for (const con of model.constraints) {
    const rowType = con.sense === "<=" ? "L" : con.sense === ">=" ? "G" : "E";
    lines.push(` ${rowType}  ${con.name}`);
  }

  // Build column-major coefficient map: varName -> Array<[rowName, coeff]>
  const colEntries = new Map<string, Array<[string, number]>>();
  for (const varName of model.variableOrder) {
    colEntries.set(varName, []);
  }

  if (model.objective) {
    // Combine duplicate variable terms in objective
    const objAcc = new Map<string, number>();
    for (const t of model.objective.linearTerms) {
      objAcc.set(t.variable, (objAcc.get(t.variable) ?? 0) + t.coeff);
    }
    for (const [v, c] of objAcc) {
      if (Math.abs(c) > 0) {
        const arr = colEntries.get(v) ?? [];
        arr.push([objRowName, c]);
        colEntries.set(v, arr);
      }
    }
  }

  for (const con of model.constraints) {
    const conAcc = new Map<string, number>();
    for (const t of con.linearTerms) {
      conAcc.set(t.variable, (conAcc.get(t.variable) ?? 0) + t.coeff);
    }
    for (const [v, c] of conAcc) {
      if (Math.abs(c) > 0) {
        const arr = colEntries.get(v) ?? [];
        arr.push([con.name, c]);
        colEntries.set(v, arr);
      }
    }
  }

  // COLUMNS (continuous first, then integer/binary wrapped in INTORG/INTEND)
  lines.push("COLUMNS");
  const contVars: string[] = [];
  const intVars: string[] = [];
  for (const v of model.variableOrder) {
    const info = model.variables.get(v);
    if (info && (info.domain === "general" || info.domain === "binary")) {
      intVars.push(v);
    } else {
      contVars.push(v);
    }
  }

  const emitColumn = (v: string): void => {
    const entries = colEntries.get(v) ?? [];
    if (entries.length === 0) {
      lines.push(`    ${v.padEnd(10)} ${objRowName.padEnd(10)} 0`);
      return;
    }
    for (const [rowName, coeff] of entries) {
      lines.push(`    ${v.padEnd(10)} ${rowName.padEnd(10)} ${fmtNum(coeff)}`);
    }
  };

  for (const v of contVars) {
    emitColumn(v);
  }
  if (intVars.length > 0) {
    lines.push("    MARK0000  'MARKER'                 'INTORG'");
    for (const v of intVars) {
      emitColumn(v);
    }
    lines.push("    MARK0001  'MARKER'                 'INTEND'");
  }

  // RHS
  lines.push("RHS");
  for (const con of model.constraints) {
    if (con.rhs !== 0) {
      lines.push(`    RHS1       ${con.name.padEnd(10)} ${fmtNum(con.rhs)}`);
    }
  }

  // BOUNDS
  const boundLines: string[] = [];
  for (const v of model.variableOrder) {
    const info = model.variables.get(v);
    if (!info) continue;

    if (info.domain === "binary") {
      boundLines.push(` BV BND1       ${v}`);
      continue;
    }
    if (info.isFree || (info.lower === -Infinity && info.upper === Infinity)) {
      boundLines.push(` FR BND1       ${v}`);
      continue;
    }
    if (Number.isFinite(info.lower) && Number.isFinite(info.upper) && info.lower === info.upper) {
      boundLines.push(` FX BND1       ${v.padEnd(10)} ${fmtNum(info.lower)}`);
      continue;
    }
    if (info.domain === "semi-continuous") {
      if (Number.isFinite(info.lower) && info.lower !== 0) {
        boundLines.push(` LO BND1       ${v.padEnd(10)} ${fmtNum(info.lower)}`);
      }
      if (Number.isFinite(info.upper)) {
        boundLines.push(` SC BND1       ${v.padEnd(10)} ${fmtNum(info.upper)}`);
      }
      continue;
    }
    if (info.lower === -Infinity) {
      boundLines.push(` MI BND1       ${v}`);
    } else if (info.lower !== 0) {
      boundLines.push(` LO BND1       ${v.padEnd(10)} ${fmtNum(info.lower)}`);
    }
    if (Number.isFinite(info.upper)) {
      boundLines.push(` UP BND1       ${v.padEnd(10)} ${fmtNum(info.upper)}`);
    }
  }

  if (boundLines.length > 0) {
    lines.push("BOUNDS");
    lines.push(...boundLines);
  }

  // QUADOBJ
  if (model.objective?.quadratic && model.objective.quadratic.terms.length > 0) {
    lines.push("QUADOBJ");
    // In MPS QUADOBJ, objective is 0.5 * x^T Q x; CPLEX LP `[ ... ] / 2` stores Q directly when divisor == 2
    const scale = 2 / (model.objective.quadratic.divisor || 2);
    for (const qt of model.objective.quadratic.terms) {
      const qVal = qt.coeff * scale;
      lines.push(`    ${qt.var1.padEnd(10)} ${qt.var2.padEnd(10)} ${fmtNum(qVal)}`);
    }
  }

  // SOS
  if (model.sos.length > 0) {
    lines.push("SOS");
    for (const s of model.sos) {
      lines.push(` ${s.type} ${s.name}`);
      for (const e of s.entries) {
        lines.push(`    ${e.variable.padEnd(10)} ${fmtNum(e.weight)}`);
      }
    }
  }

  lines.push("ENDATA");
  return `${lines.join("\n")}\n`;
}

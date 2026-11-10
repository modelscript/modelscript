// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/ampl — MPS (Mathematical Programming System) Format Writer.
 *
 * Emits standard Free/Fixed MPS files for LP and MILP optimization problems.
 * Compatible with CPLEX, Gurobi, HiGHS, CBC, SCIP, Xpress, and GLPK.
 */

import type { InstantiatedProblem } from "../types.js";

export interface MpsWriterOptions {
  /** Problem name to write in the NAME card. Defaults to problem.name. */
  name?: string | undefined;
  /** Whether to format with fixed column spacing (traditional MPS) or free spacing. Default: false (free/aligned). */
  fixedFormat?: boolean | undefined;
  /** Objective row name. Default: "OBJ". */
  objectiveName?: string | undefined;
}

export function writeMpsProblem(problem: InstantiatedProblem, options?: MpsWriterOptions): string {
  const probName = (options?.name || problem.name || "MODEL").replace(/\s+/g, "_");
  const objName = (options?.objectiveName || problem.objective.name || "OBJ").replace(/\s+/g, "_");

  const lines: string[] = [];

  // 1. NAME card
  lines.push(`NAME          ${probName}`);

  // 2. OBJSENSE card (standard modern extension supported by all solvers)
  const isMax = problem.objective.direction === "maximize";
  lines.push("OBJSENSE");
  lines.push(`  ${isMax ? "MAX" : "MIN"}`);

  // 3. ROWS section
  lines.push("ROWS");
  lines.push(` N  ${objName}`);

  // Map constraint IDs to row types and names
  interface RowMeta {
    name: string;
    type: "E" | "L" | "G" | "N";
    rhs: number;
    hasRhs: boolean;
    range?: number | undefined;
  }

  const rows: RowMeta[] = [];
  for (const c of problem.constraints) {
    const rawName = (c.name || `C${c.id}`).replace(/\s+/g, "_");
    const constOffset = c.expr.constant;
    const hasLB = Number.isFinite(c.lb) && c.lb > -1e15;
    const hasUB = Number.isFinite(c.ub) && c.ub < 1e15;

    if (hasLB && hasUB && Math.abs(c.lb - c.ub) < 1e-9) {
      // Equality: sum a_ij x_j = ub - constant
      const rhsVal = c.ub - constOffset;
      rows.push({
        name: rawName,
        type: "E",
        rhs: rhsVal,
        hasRhs: Math.abs(rhsVal) > 1e-12,
      });
      lines.push(` E  ${rawName}`);
    } else if (hasLB && hasUB) {
      // Range constraint: lb - constant <= sum a_ij x_j <= ub - constant
      const rhsVal = c.ub - constOffset;
      const rangeVal = c.ub - c.lb;
      rows.push({
        name: rawName,
        type: "E",
        rhs: rhsVal,
        hasRhs: true,
        range: rangeVal,
      });
      lines.push(` E  ${rawName}`);
    } else if (hasUB) {
      // Less-than or equal: sum a_ij x_j <= ub - constant
      const rhsVal = c.ub - constOffset;
      rows.push({
        name: rawName,
        type: "L",
        rhs: rhsVal,
        hasRhs: Math.abs(rhsVal) > 1e-12,
      });
      lines.push(` L  ${rawName}`);
    } else if (hasLB) {
      // Greater-than or equal: sum a_ij x_j >= lb - constant
      const rhsVal = c.lb - constOffset;
      rows.push({
        name: rawName,
        type: "G",
        rhs: rhsVal,
        hasRhs: Math.abs(rhsVal) > 1e-12,
      });
      lines.push(` G  ${rawName}`);
    } else {
      // Non-constraining row
      rows.push({
        name: rawName,
        type: "N",
        rhs: 0,
        hasRhs: false,
      });
      lines.push(` N  ${rawName}`);
    }
  }

  // 4. COLUMNS section
  lines.push("COLUMNS");

  // Collect coefficients per variable
  const varCols: Map<number, { rowName: string; coeff: number }[]> = new Map();
  for (const v of problem.variables) {
    varCols.set(v.id, []);
  }

  // Objective terms
  for (const term of problem.objective.expr.linearTerms) {
    const list = varCols.get(term.varId);
    if (list && Math.abs(term.coeff) > 1e-15) {
      list.push({ rowName: objName, coeff: term.coeff });
    }
  }

  // Constraint terms
  for (let i = 0; i < problem.constraints.length; i++) {
    const c = problem.constraints[i]!;
    const rowMeta = rows[i]!;
    for (const term of c.expr.linearTerms) {
      const list = varCols.get(term.varId);
      if (list && Math.abs(term.coeff) > 1e-15) {
        list.push({ rowName: rowMeta.name, coeff: term.coeff });
      }
    }
  }

  let inIntegerBlock = false;
  let markerCount = 1;

  for (const v of problem.variables) {
    const isDiscrete = v.type === "integer" || v.type === "binary";
    if (isDiscrete && !inIntegerBlock) {
      const mName = `MARK${String(markerCount++).padStart(4, "0")}`;
      lines.push(`    ${mName.padEnd(8)}  'MARKER'                 'INTORG'`);
      inIntegerBlock = true;
    } else if (!isDiscrete && inIntegerBlock) {
      const mName = `MARK${String(markerCount++).padStart(4, "0")}`;
      lines.push(`    ${mName.padEnd(8)}  'MARKER'                 'INTEND'`);
      inIntegerBlock = false;
    }

    const varName = (v.name || `X${v.id}`).replace(/\s+/g, "_");
    const terms = varCols.get(v.id) ?? [];

    for (let k = 0; k < terms.length; k += 2) {
      const t1 = terms[k]!;
      const t2 = terms[k + 1];
      if (t2) {
        lines.push(
          `    ${varName.padEnd(10)}  ${t1.rowName.padEnd(10)}  ${formatNum(t1.coeff).padEnd(12)}  ${t2.rowName.padEnd(10)}  ${formatNum(t2.coeff)}`,
        );
      } else {
        lines.push(`    ${varName.padEnd(10)}  ${t1.rowName.padEnd(10)}  ${formatNum(t1.coeff)}`);
      }
    }
  }

  if (inIntegerBlock) {
    const mName = `MARK${String(markerCount++).padStart(4, "0")}`;
    lines.push(`    ${mName.padEnd(8)}  'MARKER'                 'INTEND'`);
  }

  // 5. RHS section
  lines.push("RHS");
  const rhsEntries = rows.filter((r) => r.hasRhs);
  for (let k = 0; k < rhsEntries.length; k += 2) {
    const r1 = rhsEntries[k]!;
    const r2 = rhsEntries[k + 1];
    if (r2) {
      lines.push(
        `    RHS1        ${r1.name.padEnd(10)}  ${formatNum(r1.rhs).padEnd(12)}  ${r2.name.padEnd(10)}  ${formatNum(r2.rhs)}`,
      );
    } else {
      lines.push(`    RHS1        ${r1.name.padEnd(10)}  ${formatNum(r1.rhs)}`);
    }
  }

  // 6. RANGES section (if any range constraints)
  const rangeEntries = rows.filter((r) => r.range !== undefined && r.range > 1e-12);
  if (rangeEntries.length > 0) {
    lines.push("RANGES");
    for (const r of rangeEntries) {
      lines.push(`    RHS1        ${r.name.padEnd(10)}  ${formatNum(r.range!)}`);
    }
  }

  // 7. BOUNDS section
  lines.push("BOUNDS");
  for (const v of problem.variables) {
    const varName = (v.name || `X${v.id}`).replace(/\s+/g, "_");
    const hasLB = Number.isFinite(v.lb) && v.lb > -1e15;
    const hasUB = Number.isFinite(v.ub) && v.ub < 1e15;

    if (v.type === "binary") {
      lines.push(` BV BND1        ${varName}`);
    } else if (v.type === "integer") {
      if (hasLB && hasUB && Math.abs(v.lb - v.ub) < 1e-9) {
        lines.push(` FX BND1        ${varName.padEnd(10)}  ${formatNum(v.lb)}`);
      } else {
        if (hasLB && Math.abs(v.lb) > 1e-12) {
          lines.push(` LO BND1        ${varName.padEnd(10)}  ${formatNum(v.lb)}`);
        }
        if (hasUB) {
          lines.push(` UI BND1        ${varName.padEnd(10)}  ${formatNum(v.ub)}`);
        }
      }
    } else {
      // Continuous
      if (hasLB && hasUB && Math.abs(v.lb - v.ub) < 1e-9) {
        lines.push(` FX BND1        ${varName.padEnd(10)}  ${formatNum(v.lb)}`);
      } else if (!hasLB && !hasUB) {
        lines.push(` FR BND1        ${varName}`);
      } else if (!hasLB && hasUB && Math.abs(v.ub) < 1e-12) {
        lines.push(` MI BND1        ${varName}`);
      } else {
        if (hasLB && Math.abs(v.lb) > 1e-12) {
          lines.push(` LO BND1        ${varName.padEnd(10)}  ${formatNum(v.lb)}`);
        } else if (!hasLB) {
          lines.push(` FR BND1        ${varName}`);
        }
        if (hasUB) {
          lines.push(` UP BND1        ${varName.padEnd(10)}  ${formatNum(v.ub)}`);
        }
      }
    }
  }

  // 8. SOS section (if any SOS1 / SOS2 sets)
  if (problem.sosSets && problem.sosSets.length > 0) {
    lines.push("SOS");
    for (const s of problem.sosSets) {
      lines.push(` S${s.type} ${s.name}`);
      for (const m of s.members) {
        const mv = problem.variables[m.varId];
        if (mv) {
          const vName = (mv.name || `X${mv.id}`).replace(/\s+/g, "_");
          lines.push(`    ${vName.padEnd(10)}  ${formatNum(m.weight)}`);
        }
      }
    }
  }

  // 9. QUADOBJ section (if objective has quadratic terms)
  if (problem.objective.expr.quadraticTerms && problem.objective.expr.quadraticTerms.length > 0) {
    lines.push("QUADOBJ");
    for (const q of problem.objective.expr.quadraticTerms) {
      const v1 = problem.variables[q.var1Id];
      const v2 = problem.variables[q.var2Id];
      if (!v1 || !v2) continue;
      const name1 = (v1.name || `X${v1.id}`).replace(/\s+/g, "_");
      const name2 = (v2.name || `X${v2.id}`).replace(/\s+/g, "_");
      const coeff = q.var1Id === q.var2Id ? 2 * q.coeff : q.coeff;
      lines.push(`    ${name1.padEnd(10)}  ${name2.padEnd(10)}  ${formatNum(coeff)}`);
    }
  }

  // 10. ENDATA
  lines.push("ENDATA");
  lines.push("");

  return lines.join("\n");
}

function formatNum(n: number): string {
  if (Number.isInteger(n)) return String(n);
  // Keep up to 10 significant digits, avoiding scientific notation when possible
  const s = n.toFixed(8);
  const trimmed = s.replace(/\.?0+$/, "");
  return trimmed === "-0" ? "0" : trimmed;
}

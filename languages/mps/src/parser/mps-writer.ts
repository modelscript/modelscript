// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/mps — Fixed-Column (80-col) and Free-Format IBM MPS Writer.
 */

import type { MpsModel, MpsWriteOptions } from "../types.js";

function formatNumber(n: number, maxWidth?: number): string {
  if (Object.is(n, -0)) n = 0;
  let str: string;
  if (Number.isInteger(n) && Math.abs(n) < 1e12) {
    str = String(n);
  } else {
    str = Number(n.toPrecision(10)).toString();
  }
  if (maxWidth && str.length > maxWidth) {
    str = n.toExponential(Math.max(1, maxWidth - 7));
  }
  return str;
}

function padField(value: string, width: number, fixed: boolean): string {
  if (fixed) {
    return value.slice(0, width).padEnd(width, " ");
  }
  return value.padEnd(width, " ");
}

/**
 * Serializes an MpsModel to standard Free or 80-column Fixed IBM MPS format.
 */
export function writeMps(model: MpsModel, options?: MpsWriteOptions): string {
  const fixed = options?.fixedFormat ?? false;
  const includeObjSense = options?.includeObjSense ?? true;
  const probName = options?.name ?? model.name ?? "MPS_MODEL";
  const lines: string[] = [];

  // 1. NAME card (Field 3 starts at col 15, i.e., 14 chars prefix "NAME          ")
  lines.push(`NAME          ${fixed ? probName.slice(0, 8) : probName}`);

  // 2. OBJSENSE card
  if (includeObjSense) {
    lines.push("OBJSENSE");
    lines.push(`  ${model.sense}`);
  }

  // 3. ROWS section
  lines.push("ROWS");
  for (const row of model.rows.values()) {
    lines.push(` ${row.type}  ${fixed ? row.name.slice(0, 8) : row.name}`);
  }

  // 4. COLUMNS section
  lines.push("COLUMNS");
  let inIntBlock = false;
  let markerIdx = 1;

  for (const col of model.columns.values()) {
    const isDiscrete = col.varType === "integer" || col.varType === "binary";
    if (isDiscrete && !inIntBlock) {
      const mName = `MARK${String(markerIdx++).padStart(4, "0")}`;
      if (fixed) {
        lines.push(
          `    ${padField(mName, 8, true)}  ${padField("'MARKER'", 8, true)}  ${"".padEnd(12, " ")}   'INTORG'`,
        );
      } else {
        lines.push(`    ${mName}  'MARKER'  'INTORG'`);
      }
      inIntBlock = true;
    } else if (!isDiscrete && inIntBlock) {
      const mName = `MARK${String(markerIdx++).padStart(4, "0")}`;
      if (fixed) {
        lines.push(
          `    ${padField(mName, 8, true)}  ${padField("'MARKER'", 8, true)}  ${"".padEnd(12, " ")}   'INTEND'`,
        );
      } else {
        lines.push(`    ${mName}  'MARKER'  'INTEND'`);
      }
      inIntBlock = false;
    }

    const colName = fixed ? col.name.slice(0, 8) : col.name;
    const entries = col.entries.filter((e) => Math.abs(e.coeff) > 1e-15);

    // Emit at least a 0 entry on the objective row if column has no nonzero entries so column is preserved
    if (entries.length === 0) {
      const fallbackRow = model.objectiveRow ?? model.rows.keys().next().value;
      if (fallbackRow) {
        if (fixed) {
          lines.push(
            `    ${padField(colName, 8, true)}  ${padField(fallbackRow, 8, true)}  ${padField("0", 12, true)}`,
          );
        } else {
          lines.push(`    ${colName.padEnd(10)}  ${fallbackRow.padEnd(10)}  0`);
        }
      }
      continue;
    }

    for (let k = 0; k < entries.length; k += 2) {
      const e1 = entries[k]!;
      const e2 = entries[k + 1];
      if (fixed) {
        const f2 = padField(colName, 8, true);
        const f3 = padField(e1.rowName, 8, true);
        const f4 = padField(formatNumber(e1.coeff, 12), 12, true);
        if (e2) {
          const f5 = padField(e2.rowName, 8, true);
          const f6 = padField(formatNumber(e2.coeff, 12), 12, true);
          lines.push(`    ${f2}  ${f3}  ${f4}   ${f5}  ${f6}`);
        } else {
          lines.push(`    ${f2}  ${f3}  ${f4}`);
        }
      } else {
        const v1 = formatNumber(e1.coeff);
        if (e2) {
          const v2 = formatNumber(e2.coeff);
          lines.push(
            `    ${colName.padEnd(10)}  ${e1.rowName.padEnd(10)}  ${v1.padEnd(12)}  ${e2.rowName.padEnd(10)}  ${v2}`,
          );
        } else {
          lines.push(`    ${colName.padEnd(10)}  ${e1.rowName.padEnd(10)}  ${v1}`);
        }
      }
    }
  }

  if (inIntBlock) {
    const mName = `MARK${String(markerIdx++).padStart(4, "0")}`;
    if (fixed) {
      lines.push(`    ${padField(mName, 8, true)}  ${padField("'MARKER'", 8, true)}  ${"".padEnd(12, " ")}   'INTEND'`);
    } else {
      lines.push(`    ${mName}  'MARKER'  'INTEND'`);
    }
  }

  // 5. RHS section
  const rhsVec = (model.rhsName || "RHS1").slice(0, fixed ? 8 : 64);
  const rhsRows = [...model.rows.values()].filter((r) => r.type !== "N" && Math.abs(r.rhs) > 1e-15);
  lines.push("RHS");
  for (let k = 0; k < rhsRows.length; k += 2) {
    const r1 = rhsRows[k]!;
    const r2 = rhsRows[k + 1];
    if (fixed) {
      const f2 = padField(rhsVec, 8, true);
      const f3 = padField(r1.name, 8, true);
      const f4 = padField(formatNumber(r1.rhs, 12), 12, true);
      if (r2) {
        const f5 = padField(r2.name, 8, true);
        const f6 = padField(formatNumber(r2.rhs, 12), 12, true);
        lines.push(`    ${f2}  ${f3}  ${f4}   ${f5}  ${f6}`);
      } else {
        lines.push(`    ${f2}  ${f3}  ${f4}`);
      }
    } else {
      const v1 = formatNumber(r1.rhs);
      if (r2) {
        const v2 = formatNumber(r2.rhs);
        lines.push(`    ${rhsVec.padEnd(10)}  ${r1.name.padEnd(10)}  ${v1.padEnd(12)}  ${r2.name.padEnd(10)}  ${v2}`);
      } else {
        lines.push(`    ${rhsVec.padEnd(10)}  ${r1.name.padEnd(10)}  ${v1}`);
      }
    }
  }

  // 6. RANGES section
  const rangeRows = [...model.rows.values()].filter((r) => r.range !== undefined && Math.abs(r.range) > 1e-15);
  if (rangeRows.length > 0) {
    const rngVec = (model.rangesName || "RNG1").slice(0, fixed ? 8 : 64);
    lines.push("RANGES");
    for (const r of rangeRows) {
      if (fixed) {
        lines.push(
          `    ${padField(rngVec, 8, true)}  ${padField(r.name, 8, true)}  ${padField(formatNumber(r.range!, 12), 12, true)}`,
        );
      } else {
        lines.push(`    ${rngVec.padEnd(10)}  ${r.name.padEnd(10)}  ${formatNumber(r.range!)}`);
      }
    }
  }

  // 7. BOUNDS section
  const bndVec = (model.boundsName || "BND1").slice(0, fixed ? 8 : 64);
  const boundLines: string[] = [];

  const emitBound = (code: string, colName: string, val?: number) => {
    const cName = fixed ? colName.slice(0, 8) : colName;
    if (fixed) {
      if (val === undefined) {
        boundLines.push(` ${code} ${padField(bndVec, 8, true)}  ${padField(cName, 8, true)}`);
      } else {
        boundLines.push(
          ` ${code} ${padField(bndVec, 8, true)}  ${padField(cName, 8, true)}  ${padField(formatNumber(val, 12), 12, true)}`,
        );
      }
    } else {
      if (val === undefined) {
        boundLines.push(` ${code} ${bndVec.padEnd(10)}  ${cName}`);
      } else {
        boundLines.push(` ${code} ${bndVec.padEnd(10)}  ${cName.padEnd(10)}  ${formatNumber(val)}`);
      }
    }
  };

  for (const col of model.columns.values()) {
    const hasLb = Number.isFinite(col.lb);
    const hasUb = Number.isFinite(col.ub);

    if (col.varType === "binary") {
      emitBound("BV", col.name);
      continue;
    }

    if (hasLb && hasUb && Math.abs(col.lb - col.ub) < 1e-12) {
      emitBound("FX", col.name, col.lb);
      continue;
    }

    if (!hasLb && !hasUb) {
      emitBound("FR", col.name);
      continue;
    }

    if (!hasLb && hasUb && Math.abs(col.ub) < 1e-12) {
      emitBound("MI", col.name);
      continue;
    }

    if (col.varType === "integer") {
      if (hasLb && Math.abs(col.lb) > 1e-12) {
        emitBound("LI", col.name, col.lb);
      } else if (!hasLb) {
        emitBound("MI", col.name);
      }
      if (hasUb) {
        emitBound("UI", col.name, col.ub);
      }
      continue;
    }

    // Continuous
    if (!hasLb) {
      emitBound("MI", col.name);
      if (hasUb) emitBound("UP", col.name, col.ub);
    } else {
      if (Math.abs(col.lb) > 1e-12) {
        emitBound("LO", col.name, col.lb);
      }
      if (hasUb) {
        emitBound("UP", col.name, col.ub);
      }
    }
  }

  if (boundLines.length > 0) {
    lines.push("BOUNDS");
    lines.push(...boundLines);
  }

  // 8. QUADOBJ section
  if (model.quadObj.length > 0) {
    lines.push("QUADOBJ");
    for (const q of model.quadObj) {
      if (fixed) {
        lines.push(
          `    ${padField(q.col1, 8, true)}  ${padField(q.col2, 8, true)}  ${padField(formatNumber(q.coeff, 12), 12, true)}`,
        );
      } else {
        lines.push(`    ${q.col1.padEnd(10)}  ${q.col2.padEnd(10)}  ${formatNumber(q.coeff)}`);
      }
    }
  }

  // 9. ENDATA card
  lines.push("ENDATA");
  lines.push("");

  return lines.join("\n");
}

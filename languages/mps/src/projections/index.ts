// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/mps — Polyglot Projections (CPLEX LP, Modelica, AMPL).
 */

import { parseMps } from "../parser/mps-parser.js";
import type { MpsModel } from "../types.js";

function sanitizeIdent(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9_]/g, "_");
  return /^[0-9]/.test(cleaned) ? `v_${cleaned}` : cleaned || "v";
}

function fmtNum(n: number): string {
  if (Object.is(n, -0)) return "0";
  return Number.isInteger(n) ? String(n) : Number(n.toPrecision(10)).toString();
}

function collectRowTerms(model: MpsModel): Map<string, Array<{ colName: string; coeff: number }>> {
  const map = new Map<string, Array<{ colName: string; coeff: number }>>();
  for (const rName of model.rows.keys()) map.set(rName, []);
  for (const col of model.columns.values()) {
    for (const e of col.entries) {
      if (Math.abs(e.coeff) <= 1e-15) continue;
      map.get(e.rowName)?.push({ colName: col.name, coeff: e.coeff });
    }
  }
  return map;
}

function formatLinearTerms(
  terms: Array<{ colName: string; coeff: number }>,
  mulOp: string,
  sanitize: (n: string) => string,
): string {
  if (terms.length === 0) return "0";
  const parts: string[] = [];
  for (let i = 0; i < terms.length; i++) {
    const t = terms[i]!;
    const v = sanitize(t.colName);
    const absC = Math.abs(t.coeff);
    const coeffStr = Math.abs(absC - 1) <= 1e-15 ? v : `${fmtNum(absC)}${mulOp}${v}`;
    if (i === 0) {
      parts.push(t.coeff < 0 ? `- ${coeffStr}` : coeffStr);
    } else {
      parts.push(t.coeff < 0 ? `- ${coeffStr}` : `+ ${coeffStr}`);
    }
  }
  return parts.join(" ");
}

/**
 * Projects an MpsModel to standard CPLEX LP format.
 */
export function mpsToCplexLp(input: MpsModel | string): string {
  const model = typeof input === "string" ? parseMps(input) : input;
  const rowTerms = collectRowTerms(model);
  const lines: string[] = [];

  lines.push(`\\ Problem: ${model.name}`);
  lines.push(model.sense === "MAX" ? "Maximize" : "Minimize");

  const objRow = model.objectiveRow;
  const objLinear = objRow ? formatLinearTerms(rowTerms.get(objRow) ?? [], " ", (n) => n) : "0";
  if (model.quadObj.length > 0) {
    const qParts: string[] = [];
    for (let i = 0; i < model.quadObj.length; i++) {
      const q = model.quadObj[i]!;
      const val = q.col1 === q.col2 ? q.coeff : 2 * q.coeff;
      const absV = Math.abs(val);
      const term = q.col1 === q.col2 ? `${fmtNum(absV)} ${q.col1} ^ 2` : `${fmtNum(absV)} ${q.col1} * ${q.col2}`;
      if (i === 0) qParts.push(val < 0 ? `- ${term}` : term);
      else qParts.push(val < 0 ? `- ${term}` : `+ ${term}`);
    }
    lines.push(` ${objRow ?? "obj"}: ${objLinear} + [ ${qParts.join(" ")} ] / 2`);
  } else {
    lines.push(` ${objRow ?? "obj"}: ${objLinear}`);
  }

  lines.push("Subject To");
  for (const row of model.rows.values()) {
    if (row.type === "N") continue;
    const expr = formatLinearTerms(rowTerms.get(row.name) ?? [], " ", (n) => n);
    if (row.type === "E") {
      if (row.range !== undefined && Math.abs(row.range) > 1e-12) {
        const lo = row.range > 0 ? row.rhs : row.rhs + row.range;
        const hi = row.range > 0 ? row.rhs + row.range : row.rhs;
        lines.push(` ${row.name}_lo: ${expr} >= ${fmtNum(lo)}`);
        lines.push(` ${row.name}_hi: ${expr} <= ${fmtNum(hi)}`);
      } else {
        lines.push(` ${row.name}: ${expr} = ${fmtNum(row.rhs)}`);
      }
    } else if (row.type === "L") {
      lines.push(` ${row.name}: ${expr} <= ${fmtNum(row.rhs)}`);
      if (row.range !== undefined && Math.abs(row.range) > 1e-12) {
        lines.push(` ${row.name}_rng: ${expr} >= ${fmtNum(row.rhs - Math.abs(row.range))}`);
      }
    } else if (row.type === "G") {
      lines.push(` ${row.name}: ${expr} >= ${fmtNum(row.rhs)}`);
      if (row.range !== undefined && Math.abs(row.range) > 1e-12) {
        lines.push(` ${row.name}_rng: ${expr} <= ${fmtNum(row.rhs + Math.abs(row.range))}`);
      }
    }
  }

  const boundLines: string[] = [];
  const generals: string[] = [];
  const binaries: string[] = [];

  for (const col of model.columns.values()) {
    if (col.varType === "binary") {
      binaries.push(col.name);
      continue;
    }
    if (col.varType === "integer") {
      generals.push(col.name);
    }
    const hasLb = Number.isFinite(col.lb);
    const hasUb = Number.isFinite(col.ub);
    if (!hasLb && !hasUb) {
      boundLines.push(` ${col.name} free`);
    } else if (hasLb && hasUb && Math.abs(col.lb - col.ub) < 1e-12) {
      boundLines.push(` ${col.name} = ${fmtNum(col.lb)}`);
    } else if (hasLb && hasUb) {
      boundLines.push(` ${fmtNum(col.lb)} <= ${col.name} <= ${fmtNum(col.ub)}`);
    } else if (!hasLb && hasUb) {
      boundLines.push(` -inf <= ${col.name} <= ${fmtNum(col.ub)}`);
    } else if (hasLb && Math.abs(col.lb) > 1e-12) {
      boundLines.push(` ${col.name} >= ${fmtNum(col.lb)}`);
    }
  }

  if (boundLines.length > 0) {
    lines.push("Bounds");
    lines.push(...boundLines);
  }
  if (generals.length > 0) {
    lines.push("Generals");
    lines.push(` ${generals.join(" ")}`);
  }
  if (binaries.length > 0) {
    lines.push("Binaries");
    lines.push(` ${binaries.join(" ")}`);
  }

  lines.push("End");
  lines.push("");
  return lines.join("\n");
}

/**
 * Projects an MpsModel to a Modelica model representation.
 */
export function mpsToModelica(input: MpsModel | string): string {
  const model = typeof input === "string" ? parseMps(input) : input;
  const rowTerms = collectRowTerms(model);
  const modelName = sanitizeIdent(model.name);
  const lines: string[] = [];

  lines.push(`model ${modelName} "Projected from IBM MPS (${model.problemClass}, ${model.sense})"`);

  // Decision variables
  for (const col of model.columns.values()) {
    const vName = sanitizeIdent(col.name);
    const moType = col.varType === "continuous" ? "Real" : "Integer";
    const attrs: string[] = [];
    if (Number.isFinite(col.lb)) attrs.push(`min = ${fmtNum(col.lb)}`);
    if (Number.isFinite(col.ub)) attrs.push(`max = ${fmtNum(col.ub)}`);
    const attrStr = attrs.length > 0 ? `(${attrs.join(", ")})` : "";
    lines.push(`  ${moType} ${vName}${attrStr};`);
  }

  const objVar = sanitizeIdent(model.objectiveRow ?? "obj");
  lines.push(`  output Real ${objVar} "Objective (${model.sense})";`);

  // Slack variables for inequality constraints
  for (const row of model.rows.values()) {
    if (row.type === "L" || row.type === "G" || (row.type === "E" && row.range !== undefined)) {
      const sName = `slack_${sanitizeIdent(row.name)}`;
      lines.push(`  Real ${sName}(min = 0);`);
    }
  }

  lines.push("equation");
  const objLinear = model.objectiveRow
    ? formatLinearTerms(rowTerms.get(model.objectiveRow) ?? [], " * ", sanitizeIdent)
    : "0";
  if (model.quadObj.length > 0) {
    const qTerms = model.quadObj.map((q) => {
      const f = q.col1 === q.col2 ? 0.5 * q.coeff : q.coeff;
      return `${fmtNum(f)} * ${sanitizeIdent(q.col1)} * ${sanitizeIdent(q.col2)}`;
    });
    lines.push(`  ${objVar} = ${objLinear} + ${qTerms.join(" + ")};`);
  } else {
    lines.push(`  ${objVar} = ${objLinear};`);
  }

  for (const row of model.rows.values()) {
    if (row.type === "N") continue;
    const lhs = formatLinearTerms(rowTerms.get(row.name) ?? [], " * ", sanitizeIdent);
    const sName = `slack_${sanitizeIdent(row.name)}`;
    if (row.type === "E" && (row.range === undefined || Math.abs(row.range) <= 1e-15)) {
      lines.push(`  ${lhs} = ${fmtNum(row.rhs)};`);
    } else if (row.type === "L") {
      lines.push(`  ${lhs} + ${sName} = ${fmtNum(row.rhs)};`);
    } else if (row.type === "G") {
      lines.push(`  ${lhs} - ${sName} = ${fmtNum(row.rhs)};`);
    } else {
      lines.push(`  ${lhs} - ${sName} = ${fmtNum(row.rhs)};`);
    }
  }

  lines.push(`end ${modelName};`);
  lines.push("");
  return lines.join("\n");
}

/**
 * Projects an MpsModel to an AMPL model (.mod) representation.
 */
export function mpsToAmpl(input: MpsModel | string): string {
  const model = typeof input === "string" ? parseMps(input) : input;
  const rowTerms = collectRowTerms(model);
  const lines: string[] = [];

  lines.push(`# Projected from IBM MPS problem '${model.name}' (${model.problemClass})`);
  lines.push("");

  for (const col of model.columns.values()) {
    const vName = sanitizeIdent(col.name);
    const parts: string[] = [`var ${vName}`];
    if (col.varType === "binary") {
      parts.push("binary");
    } else {
      if (col.varType === "integer") parts.push("integer");
      if (Number.isFinite(col.lb)) parts.push(`>= ${fmtNum(col.lb)}`);
      if (Number.isFinite(col.ub)) parts.push(`<= ${fmtNum(col.ub)}`);
    }
    lines.push(`${parts.join(" ")};`);
  }

  lines.push("");
  const objKw = model.sense === "MAX" ? "maximize" : "minimize";
  const objName = sanitizeIdent(model.objectiveRow ?? "obj");
  const objLinear = model.objectiveRow
    ? formatLinearTerms(rowTerms.get(model.objectiveRow) ?? [], " * ", sanitizeIdent)
    : "0";
  if (model.quadObj.length > 0) {
    const qTerms = model.quadObj.map((q) => {
      const f = q.col1 === q.col2 ? 0.5 * q.coeff : q.coeff;
      return `${fmtNum(f)} * ${sanitizeIdent(q.col1)} * ${sanitizeIdent(q.col2)}`;
    });
    lines.push(`${objKw} ${objName}: ${objLinear} + ${qTerms.join(" + ")};`);
  } else {
    lines.push(`${objKw} ${objName}: ${objLinear};`);
  }

  lines.push("");
  for (const row of model.rows.values()) {
    if (row.type === "N") continue;
    const rName = sanitizeIdent(row.name);
    const expr = formatLinearTerms(rowTerms.get(row.name) ?? [], " * ", sanitizeIdent);
    if (row.type === "E") {
      if (row.range !== undefined && Math.abs(row.range) > 1e-12) {
        const lo = row.range > 0 ? row.rhs : row.rhs + row.range;
        const hi = row.range > 0 ? row.rhs + row.range : row.rhs;
        lines.push(`subject to ${rName}: ${fmtNum(lo)} <= ${expr} <= ${fmtNum(hi)};`);
      } else {
        lines.push(`subject to ${rName}: ${expr} = ${fmtNum(row.rhs)};`);
      }
    } else if (row.type === "L") {
      if (row.range !== undefined && Math.abs(row.range) > 1e-12) {
        lines.push(`subject to ${rName}: ${fmtNum(row.rhs - Math.abs(row.range))} <= ${expr} <= ${fmtNum(row.rhs)};`);
      } else {
        lines.push(`subject to ${rName}: ${expr} <= ${fmtNum(row.rhs)};`);
      }
    } else if (row.type === "G") {
      if (row.range !== undefined && Math.abs(row.range) > 1e-12) {
        lines.push(`subject to ${rName}: ${fmtNum(row.rhs)} <= ${expr} <= ${fmtNum(row.rhs + Math.abs(row.range))};`);
      } else {
        lines.push(`subject to ${rName}: ${expr} >= ${fmtNum(row.rhs)};`);
      }
    }
  }

  lines.push("");
  return lines.join("\n");
}

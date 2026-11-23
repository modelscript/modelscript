// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Projects a parsed `CplexLpModel` to Modelica algebraic optimization model source.
 */

import type { CplexLpModel, LinearTerm, QuadraticExpression } from "../types.js";

export interface ModelicaProjectionOptions {
  modelName?: string | undefined;
}

function sanitizeIdent(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9_]/g, "_");
  return /^[A-Za-z_]/.test(cleaned) ? cleaned : `v_${cleaned}`;
}

function formatLinearTerms(terms: LinearTerm[], constant = 0): string {
  const parts: string[] = [];
  for (const t of terms) {
    const v = sanitizeIdent(t.variable);
    if (parts.length === 0) {
      if (t.coeff === 1) parts.push(v);
      else if (t.coeff === -1) parts.push(`-${v}`);
      else parts.push(`${t.coeff} * ${v}`);
    } else {
      const absC = Math.abs(t.coeff);
      const sign = t.coeff < 0 ? "-" : "+";
      if (absC === 1) parts.push(`${sign} ${v}`);
      else parts.push(`${sign} ${absC} * ${v}`);
    }
  }
  if (constant !== 0 || parts.length === 0) {
    if (parts.length === 0) {
      parts.push(String(constant));
    } else if (constant > 0) {
      parts.push(`+ ${constant}`);
    } else {
      parts.push(`- ${Math.abs(constant)}`);
    }
  }
  return parts.join(" ");
}

function formatQuadraticTerms(quad: QuadraticExpression | undefined): string {
  if (!quad || quad.terms.length === 0) return "";
  const invDiv = quad.divisor !== 0 ? 1 / quad.divisor : 1;
  const parts: string[] = [];
  for (const qt of quad.terms) {
    const coeff = qt.coeff * invDiv;
    const sign = coeff < 0 ? "-" : "+";
    const absC = Math.abs(coeff);
    const v1 = sanitizeIdent(qt.var1);
    const v2 = sanitizeIdent(qt.var2);
    const prod = v1 === v2 ? `${v1}^2` : `${v1} * ${v2}`;
    parts.push(`${sign} ${absC} * ${prod}`);
  }
  return parts.join(" ");
}

/**
 * Converts a `CplexLpModel` into a Modelica model string.
 */
export function cplexLpToModelica(model: CplexLpModel, options?: ModelicaProjectionOptions): string {
  const modelName = sanitizeIdent(options?.modelName || model.name || "CplexLpOptimization");
  const lines: string[] = [];

  lines.push(`model ${modelName}`);
  lines.push(`  // Generated from @modelscript/cplex-lp (${model.dialect})`);
  if (model.objective) {
    lines.push(`  // Objective sense: ${model.objective.sense}`);
  }
  lines.push("");

  // Decision variable declarations
  for (const varName of model.variableOrder) {
    const info = model.variables.get(varName);
    const safeVar = sanitizeIdent(varName);
    const moType = info && (info.domain === "general" || info.domain === "binary") ? "Integer" : "Real";
    const attrs: string[] = [];
    if (info) {
      if (Number.isFinite(info.lower)) attrs.push(`min = ${info.lower}`);
      if (Number.isFinite(info.upper)) attrs.push(`max = ${info.upper}`);
      const startVal = Number.isFinite(info.lower) && info.lower > 0 ? info.lower : 0;
      attrs.push(`start = ${startVal}`);
    }
    const attrStr = attrs.length > 0 ? `(${attrs.join(", ")})` : "";
    const comment = info ? ` "${info.domain} variable ${varName}"` : "";
    lines.push(`  ${moType} ${safeVar}${attrStr}${comment};`);
  }

  // Objective variable
  if (model.objective) {
    const objVar = sanitizeIdent(model.objective.name || "objective");
    lines.push(`  Real ${objVar} "Objective (${model.objective.sense})";`);
  }

  // Slack/surplus variables for inequalities
  for (let i = 0; i < model.constraints.length; i++) {
    const con = model.constraints[i]!;
    if (con.sense === "<=") {
      lines.push(`  Real _slack_${sanitizeIdent(con.name)}_${i}(min = 0, start = 0);`);
    } else if (con.sense === ">=") {
      lines.push(`  Real _surplus_${sanitizeIdent(con.name)}_${i}(min = 0, start = 0);`);
    }
  }

  lines.push("equation");

  // Objective equation
  if (model.objective) {
    const objVar = sanitizeIdent(model.objective.name || "objective");
    const lin = formatLinearTerms(model.objective.linearTerms, model.objective.constant);
    const quad = formatQuadraticTerms(model.objective.quadratic);
    const rhs = quad ? `${lin} ${quad}` : lin;
    lines.push(`  ${objVar} = ${rhs};`);
  }

  // Constraint equations
  for (let i = 0; i < model.constraints.length; i++) {
    const con = model.constraints[i]!;
    const lin = formatLinearTerms(con.linearTerms, 0);
    const quad = formatQuadraticTerms(con.quadratic);
    const lhs = quad ? `${lin} ${quad}` : lin;
    if (con.sense === "=") {
      lines.push(`  ${lhs} = ${con.rhs}; // ${con.name}`);
    } else if (con.sense === "<=") {
      lines.push(`  ${lhs} + _slack_${sanitizeIdent(con.name)}_${i} = ${con.rhs}; // ${con.name}`);
    } else {
      lines.push(`  ${lhs} - _surplus_${sanitizeIdent(con.name)}_${i} = ${con.rhs}; // ${con.name}`);
    }
  }

  lines.push(`end ${modelName};`);
  return `${lines.join("\n")}\n`;
}

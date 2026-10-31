// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/verilog-a — Modelica 3.x Acausal Projection.
 *
 * Translates a Verilog-A compact device model into an acausal Modelica 3.x component
 * utilizing standard Modelica.Electrical.Analog.Interfaces (PositivePin, NegativePin)
 * and continuous differential equations (der).
 */

import type { VerilogAExpr, VerilogAModule, VerilogAStatement } from "../types.js";

export function verilogAToModelica(mod: VerilogAModule): string {
  const lines: string[] = [];

  lines.push(`model ${mod.name}`);
  lines.push("  import Modelica.Electrical.Analog.Interfaces.PositivePin;");
  lines.push("  import Modelica.Electrical.Analog.Interfaces.NegativePin;");
  lines.push("  import Modelica.SIunits.Voltage;");
  lines.push("  import Modelica.SIunits.Current;");
  lines.push("");

  // Parameters
  if (mod.parameters.length > 0) {
    lines.push("  // Parameters");
    for (const p of mod.parameters) {
      const typeStr = p.type === "integer" ? "Integer" : "Real";
      lines.push(`  parameter ${typeStr} ${p.name} = ${p.defaultValue};`);
    }
    lines.push("");
  }

  // Pins / Ports
  lines.push("  // Connectors");
  for (let i = 0; i < mod.ports.length; i++) {
    const port = mod.ports[i];
    if (!port) continue;
    const pinType = i % 2 === 0 ? "PositivePin" : "NegativePin";
    lines.push(`  ${pinType} ${port.name};`);
  }
  lines.push("");

  // Internal Variables
  lines.push("  // Internal Variables & Potentials");
  for (const v of mod.variables) {
    lines.push(`  Real ${v.name};`);
  }
  for (const p of mod.ports) {
    lines.push(`  Voltage v_${p.name};`);
  }
  for (const n of mod.internalNodes) {
    lines.push(`  Voltage v_${n};`);
  }
  lines.push("");

  // Equations
  lines.push("equation");

  // Bind port pins to voltages
  for (const p of mod.ports) {
    lines.push(`  v_${p.name} = ${p.name}.v;`);
  }

  if (mod.analogBlock) {
    emitModelicaStatementList(mod.analogBlock.statements, lines, "  ");
  }

  lines.push(`end ${mod.name};`);
  return lines.join("\n");
}

function flattenStatements(stmts: VerilogAStatement[]): VerilogAStatement[] {
  const out: VerilogAStatement[] = [];
  for (const s of stmts) {
    if (s.kind === "block") {
      out.push(...flattenStatements(s.statements));
    } else {
      out.push(s);
    }
  }
  return out;
}

function emitModelicaStatementList(stmts: VerilogAStatement[], lines: string[], indent: string): void {
  const flat = flattenStatements(stmts);
  const flowBranches = new Map<string, { n1: string; n2: string; terms: string[] }>();
  const potBranches = new Map<string, { n1: string; n2: string; terms: string[] }>();

  for (const stmt of flat) {
    if (stmt.kind === "assignment") {
      const rhsStr = exprToModelica(stmt.rhs);
      lines.push(`${indent}${stmt.variable} = ${rhsStr};`);
      continue;
    }

    if (stmt.kind === "if") {
      const condStr = exprToModelica(stmt.condition);
      lines.push(`${indent}if ${condStr} then`);
      emitModelicaStatementList(stmt.thenBranch, lines, indent + "  ");
      if (stmt.elseBranch && stmt.elseBranch.length > 0) {
        lines.push(`${indent}else`);
        emitModelicaStatementList(stmt.elseBranch, lines, indent + "  ");
      }
      lines.push(`${indent}end if;`);
      continue;
    }

    if (stmt.kind === "contribution") {
      const { lhs, rhs } = stmt;
      const rhsStr = exprToModelica(rhs);
      const n1 = lhs.node1;
      const n2 = lhs.node2 ?? "0";
      const key = `${n1}:${n2}`;

      if (lhs.nature === "I" || lhs.nature === "Flow") {
        const entry = flowBranches.get(key) ?? { n1, n2, terms: [] };
        entry.terms.push(rhsStr);
        flowBranches.set(key, entry);
      } else if (lhs.nature === "V" || lhs.nature === "Potential") {
        const entry = potBranches.get(key) ?? { n1, n2, terms: [] };
        entry.terms.push(rhsStr);
        potBranches.set(key, entry);
      }
    }
  }

  for (const { n1, n2, terms } of flowBranches.values()) {
    const sumStr = terms.length === 1 ? (terms[0] ?? "") : terms.map((t) => `(${t})`).join(" + ");
    lines.push(`${indent}// Current branch ${n1} -> ${n2}`);
    lines.push(`${indent}${n1}.i = ${sumStr};`);
    if (n2 !== "0" && n2 !== "gnd") {
      lines.push(`${indent}${n2}.i = -(${sumStr});`);
    }
  }

  for (const { n1, n2, terms } of potBranches.values()) {
    const sumStr = terms.length === 1 ? (terms[0] ?? "") : terms.map((t) => `(${t})`).join(" + ");
    const v2Str = n2 === "0" || n2 === "gnd" ? "0.0" : `v_${n2}`;
    lines.push(`${indent}v_${n1} - ${v2Str} = ${sumStr};`);
  }
}

function exprToModelica(expr: VerilogAExpr): string {
  switch (expr.kind) {
    case "number":
      return String(expr.value);
    case "identifier":
      if (expr.name === "$vt") return "0.02585";
      if (expr.name === "$temperature") return "300.15";
      return expr.name;
    case "branch_access": {
      if (expr.nature === "I" || expr.nature === "Flow") {
        return `${expr.node1}.i`;
      }
      const v1 = `v_${expr.node1}`;
      const v2 = expr.node2 ? `v_${expr.node2}` : "0.0";
      return `(${v1} - ${v2})`;
    }
    case "binary": {
      const mOp = expr.op === "**" ? "^" : expr.op;
      return `(${exprToModelica(expr.left)} ${mOp} ${exprToModelica(expr.right)})`;
    }
    case "unary":
      return `(${expr.op}${exprToModelica(expr.argument)})`;
    case "ternary":
      return `(if ${exprToModelica(expr.condition)} then ${exprToModelica(expr.consequent)} else ${exprToModelica(expr.alternate)})`;
    case "call": {
      const firstArg = expr.args[0];
      if (expr.func === "ddt" && firstArg) {
        return `der(${exprToModelica(firstArg)})`;
      }
      if ((expr.func === "limexp" || expr.func === "exp") && firstArg) {
        return `Modelica.Math.exp(${exprToModelica(firstArg)})`;
      }
      return `${expr.func}(${expr.args.map(exprToModelica).join(", ")})`;
    }
  }
}

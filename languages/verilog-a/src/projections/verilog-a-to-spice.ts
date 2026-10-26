// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/verilog-a — SPICE Netlist Projection.
 *
 * Translates a Verilog-A compact device model into a standard SPICE behavioral
 * subcircuit (.SUBCKT) with non-linear dependent B-sources (Bxxxx).
 */

import type { VerilogAExpr, VerilogAModule, VerilogAStatement } from "../types.js";

export function verilogAToSpice(mod: VerilogAModule): string {
  const lines: string[] = [];

  const portList = mod.ports.map((p) => p.name).join(" ");
  lines.push(`* SPICE Subcircuit generated from Verilog-A module '${mod.name}'`);
  lines.push(`.SUBCKT ${mod.name} ${portList}`);

  // Parameters
  for (const p of mod.parameters) {
    lines.push(`.PARAM ${p.name}=${p.defaultValue}`);
  }

  // Behavioral Sources from Analog Block
  if (mod.analogBlock) {
    let sourceIdx = 1;
    for (const stmt of mod.analogBlock.statements) {
      emitSpiceStatement(stmt, lines, sourceIdx++);
    }
  }

  lines.push(`.ENDS ${mod.name}`);
  return lines.join("\n");
}

function emitSpiceStatement(stmt: VerilogAStatement, lines: string[], idx: number): void {
  if (stmt.kind === "block") {
    let subIdx = idx;
    for (const s of stmt.statements) {
      emitSpiceStatement(s, lines, subIdx++);
    }
    return;
  }

  if (stmt.kind === "contribution") {
    const { lhs, rhs } = stmt;
    const rhsStr = exprToSpice(rhs);
    const n1 = lhs.node1;
    const n2 = lhs.node2 ?? "0";

    if (lhs.nature === "I" || lhs.nature === "Flow") {
      lines.push(`B${idx} ${n1} ${n2} I=${rhsStr}`);
    } else if (lhs.nature === "V" || lhs.nature === "Potential") {
      lines.push(`B${idx} ${n1} ${n2} V=${rhsStr}`);
    }
  }
}

function exprToSpice(expr: VerilogAExpr): string {
  switch (expr.kind) {
    case "number":
      return String(expr.value);
    case "identifier":
      if (expr.name === "$vt") return "0.02585";
      if (expr.name === "$temperature") return "300.15";
      return expr.name;
    case "branch_access": {
      const n1 = expr.node1;
      const n2 = expr.node2 ?? "0";
      return `V(${n1}, ${n2})`;
    }
    case "binary":
      return `(${exprToSpice(expr.left)} ${expr.op} ${exprToSpice(expr.right)})`;
    case "unary":
      return `(${expr.op}${exprToSpice(expr.argument)})`;
    case "call": {
      const firstArg = expr.args[0];
      if (expr.func === "ddt" && firstArg) {
        return `ddt(${exprToSpice(firstArg)})`;
      }
      if ((expr.func === "limexp" || expr.func === "exp") && firstArg) {
        return `exp(${exprToSpice(firstArg)})`;
      }
      return `${expr.func}(${expr.args.map(exprToSpice).join(", ")})`;
    }
  }
}

// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Projects IEEE 1364 Verilog RTL modules to Modelica 3.6 synchronous clock models
 * (`Clock`, `previous`, `when`, discrete `Integer`/`Boolean` signals).
 */

import type { VerilogDesign, VerilogExpr, VerilogModule, VerilogStmt } from "../types.js";

export interface ModelicaProjectionOptions {
  clockPeriodSec?: number | undefined;
}

function exprToModelica(expr: VerilogExpr): string {
  switch (expr.kind) {
    case "number":
      return String(expr.numericValue ?? 0);
    case "identifier":
      return expr.name;
    case "index":
      return `${exprToModelica(expr.target)}[${exprToModelica(expr.index)} + 1]`;
    case "slice":
      return `${exprToModelica(expr.target)}[${exprToModelica(expr.lsb)} + 1:${exprToModelica(expr.msb)} + 1]`;
    case "unary": {
      const inner = exprToModelica(expr.operand);
      if (expr.op === "!" || expr.op === "~") return `(1 - ${inner})`;
      if (expr.op === "-") return `(-(${inner}))`;
      return inner;
    }
    case "binary": {
      const l = exprToModelica(expr.left);
      const r = exprToModelica(expr.right);
      switch (expr.op) {
        case "==":
        case "===":
          return `(${l} == ${r})`;
        case "!=":
        case "!==":
          return `(${l} <> ${r})`;
        case "&&":
          return `(${l} and ${r})`;
        case "||":
          return `(${l} or ${r})`;
        case "&":
          return `(${l} * ${r})`;
        case "|":
          return `(${l} + ${r} - ${l} * ${r})`;
        case "^":
          return `mod(${l} + ${r}, 2)`;
        case "<<":
        case "<<<":
          return `(${l} * 2^${r})`;
        case ">>":
        case ">>>":
          return `div(${l}, 2^${r})`;
        case "%":
          return `mod(${l}, ${r})`;
        default:
          return `(${l} ${expr.op} ${r})`;
      }
    }
    case "ternary":
      return `(if ${exprToModelica(expr.condition)} <> 0 then ${exprToModelica(expr.consequent)} else ${exprToModelica(expr.alternate)})`;
    case "concat":
      return `{${expr.elements.map(exprToModelica).join(", ")}}`;
    case "replicate":
      return `fill(${expr.elements.map(exprToModelica).join(", ")}, ${exprToModelica(expr.count)})`;
  }
}

function stmtToModelicaLines(stmt: VerilogStmt, indent: string, usePrevious: boolean): string[] {
  const wrapRhs = (expr: VerilogExpr): string => {
    const s = exprToModelica(expr);
    if (!usePrevious) return s;
    return s;
  };

  switch (stmt.kind) {
    case "empty":
      return [];
    case "block":
      return stmt.statements.flatMap((s) => stmtToModelicaLines(s, indent, usePrevious));
    case "blocking_assign":
    case "nonblocking_assign":
      return [`${indent}${exprToModelica(stmt.lhs)} = ${wrapRhs(stmt.rhs)};`];
    case "if": {
      const lines: string[] = [];
      lines.push(`${indent}if ${exprToModelica(stmt.condition)} <> 0 then`);
      lines.push(...stmtToModelicaLines(stmt.consequent, `${indent}  `, usePrevious));
      if (stmt.alternate) {
        lines.push(`${indent}else`);
        lines.push(...stmtToModelicaLines(stmt.alternate, `${indent}  `, usePrevious));
      }
      lines.push(`${indent}end if;`);
      return lines;
    }
    case "case": {
      const lines: string[] = [];
      const sel = exprToModelica(stmt.expression);
      let first = true;
      for (const ci of stmt.items) {
        if (ci.isDefault) {
          lines.push(`${indent}else`);
        } else {
          const cond = ci.patterns.map((p) => `(${sel} == ${exprToModelica(p)})`).join(" or ");
          lines.push(`${indent}${first ? "if" : "elseif"} ${cond} then`);
          first = false;
        }
        lines.push(...stmtToModelicaLines(ci.statement, `${indent}  `, usePrevious));
      }
      lines.push(`${indent}end if;`);
      return lines;
    }
  }
}

function projectModuleToModelica(mod: VerilogModule, options?: ModelicaProjectionOptions): string {
  const period = options?.clockPeriodSec ?? 1e-6;
  const lines: string[] = [];
  lines.push(`model ${mod.name}`);
  lines.push(`  // Auto-projected from IEEE 1364 Verilog module '${mod.name}'`);
  lines.push(`  Clock clk_sync = Clock(${period});`);

  for (const [pName, pDecl] of mod.parameters) {
    lines.push(`  parameter Integer ${pName} = ${exprToModelica(pDecl.value)};`);
  }

  for (const [pName, pDecl] of mod.ports) {
    const dir = pDecl.direction === "input" ? "input" : pDecl.direction === "output" ? "output" : "";
    const prefix = dir ? `${dir} ` : "";
    lines.push(`  ${prefix}discrete Integer ${pName}(start = 0);`);
  }

  for (const [nName, nDecl] of mod.nets) {
    if (mod.ports.has(nName)) continue;
    const start = nDecl.initialValue ? exprToModelica(nDecl.initialValue) : "0";
    lines.push(`  discrete Integer ${nName}(start = ${start});`);
  }

  lines.push("equation");

  for (const item of mod.items) {
    if (item.kind === "assign") {
      lines.push(`  ${exprToModelica(item.lhs)} = ${exprToModelica(item.rhs)};`);
    } else if (item.kind === "gate") {
      const out = item.ports[0];
      const ins = item.ports.slice(1);
      if (out && ins.length > 0) {
        const args = ins.map(exprToModelica).join(", ");
        lines.push(`  // Gate primitive: ${item.gateType}`);
        lines.push(`  ${exprToModelica(out)} = ${item.gateType}_gate(${args});`);
      }
    } else if (item.kind === "always") {
      const isSeq = item.sensitivity.some((s) => s.kind === "posedge" || s.kind === "negedge");
      if (isSeq) {
        const edgeDesc = item.sensitivity
          .map((s) => (s.kind === "wildcard" ? "*" : `${s.kind} ${s.signal}`))
          .join(" or ");
        lines.push(`  // Synchronous clocked block (${edgeDesc})`);
        lines.push(`  when clk_sync then`);
        const bodyLines = stmtToModelicaLines(item.body, "    ", true);
        if (bodyLines.length > 0) {
          lines.push(...bodyLines);
        } else {
          lines.push(`    // empty sequential body`);
        }
        lines.push(`  end when;`);
      } else {
        lines.push(...stmtToModelicaLines(item.body, "  ", false));
      }
    }
  }

  lines.push(`end ${mod.name};`);
  return lines.join("\n");
}

/**
 * Projects a `VerilogDesign` or single `VerilogModule` to Modelica 3.6 synchronous clock code.
 */
export function verilogToModelica(
  designOrModule: VerilogDesign | VerilogModule,
  options?: ModelicaProjectionOptions,
): string {
  if ("modules" in designOrModule) {
    return designOrModule.modules.map((m) => projectModuleToModelica(m, options)).join("\n\n");
  }
  return projectModuleToModelica(designOrModule, options);
}

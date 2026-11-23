// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Projects IEEE 1364 Verilog RTL modules to IEEE 1076 VHDL (`entity`/`architecture`,
 * `std_logic`, `std_logic_vector`, `rising_edge`, `falling_edge`).
 */

import type { BitRange, VerilogDesign, VerilogExpr, VerilogModule, VerilogStmt } from "../types.js";

function vhdlType(range?: BitRange): string {
  if (!range) return "std_logic";
  const dir = range.msb >= range.lsb ? "downto" : "to";
  return `std_logic_vector(${range.msb} ${dir} ${range.lsb})`;
}

function exprToVhdl(expr: VerilogExpr): string {
  switch (expr.kind) {
    case "number": {
      if (expr.width === 1) {
        const bit =
          expr.digits
            .toUpperCase()
            .replace(/[^01XZ]/g, "0")
            .slice(-1) || "0";
        return `'${bit}'`;
      }
      if (expr.width !== undefined && expr.base === "b") {
        const padded = expr.digits.toUpperCase().padStart(expr.width, "0").slice(-expr.width);
        return `"${padded}"`;
      }
      if (expr.width !== undefined && expr.base === "h") {
        return `x"${expr.digits.toUpperCase()}"`;
      }
      return String(expr.numericValue ?? 0);
    }
    case "identifier":
      return expr.name;
    case "index":
      return `${exprToVhdl(expr.target)}(${exprToVhdl(expr.index)})`;
    case "slice":
      return `${exprToVhdl(expr.target)}(${exprToVhdl(expr.msb)} downto ${exprToVhdl(expr.lsb)})`;
    case "unary": {
      const inner = exprToVhdl(expr.operand);
      if (expr.op === "~" || expr.op === "!") return `(not ${inner})`;
      if (expr.op === "-") return `(-${inner})`;
      return inner;
    }
    case "binary": {
      const l = exprToVhdl(expr.left);
      const r = exprToVhdl(expr.right);
      switch (expr.op) {
        case "&":
        case "&&":
          return `(${l} and ${r})`;
        case "|":
        case "||":
          return `(${l} or ${r})`;
        case "^":
          return `(${l} xor ${r})`;
        case "~^":
        case "^~":
          return `(${l} xnor ${r})`;
        case "==":
        case "===":
          return `(${l} = ${r})`;
        case "!=":
        case "!==":
          return `(${l} /= ${r})`;
        case "<<":
        case "<<<":
          return `shift_left(${l}, ${r})`;
        case ">>":
        case ">>>":
          return `shift_right(${l}, ${r})`;
        default:
          return `(${l} ${expr.op} ${r})`;
      }
    }
    case "ternary":
      return `${exprToVhdl(expr.consequent)} when ${exprToVhdl(expr.condition)} = '1' else ${exprToVhdl(expr.alternate)}`;
    case "concat":
      return `(${expr.elements.map(exprToVhdl).join(" & ")})`;
    case "replicate":
      return `(others => ${expr.elements.length > 0 ? exprToVhdl(expr.elements[0]!) : "'0'"})`;
  }
}

function stmtToVhdlLines(stmt: VerilogStmt, indent: string): string[] {
  switch (stmt.kind) {
    case "empty":
      return [`${indent}null;`];
    case "block":
      return stmt.statements.flatMap((s) => stmtToVhdlLines(s, indent));
    case "blocking_assign":
    case "nonblocking_assign":
      return [`${indent}${exprToVhdl(stmt.lhs)} <= ${exprToVhdl(stmt.rhs)};`];
    case "if": {
      const lines: string[] = [];
      const condStr =
        stmt.condition.kind === "binary" &&
        (stmt.condition.op === "==" ||
          stmt.condition.op === "!=" ||
          stmt.condition.op === "<" ||
          stmt.condition.op === "<=" ||
          stmt.condition.op === ">" ||
          stmt.condition.op === ">=")
          ? exprToVhdl(stmt.condition)
          : `${exprToVhdl(stmt.condition)} = '1'`;
      lines.push(`${indent}if ${condStr} then`);
      lines.push(...stmtToVhdlLines(stmt.consequent, `${indent}  `));
      if (stmt.alternate) {
        lines.push(`${indent}else`);
        lines.push(...stmtToVhdlLines(stmt.alternate, `${indent}  `));
      }
      lines.push(`${indent}end if;`);
      return lines;
    }
    case "case": {
      const lines: string[] = [];
      lines.push(`${indent}case ${exprToVhdl(stmt.expression)} is`);
      for (const ci of stmt.items) {
        if (ci.isDefault) {
          lines.push(`${indent}  when others =>`);
        } else {
          lines.push(`${indent}  when ${ci.patterns.map(exprToVhdl).join(" | ")} =>`);
        }
        lines.push(...stmtToVhdlLines(ci.statement, `${indent}    `));
      }
      lines.push(`${indent}end case;`);
      return lines;
    }
  }
}

function projectModuleToVhdl(mod: VerilogModule): string {
  const lines: string[] = [];
  lines.push("library ieee;");
  lines.push("use ieee.std_logic_1164.all;");
  lines.push("use ieee.numeric_std.all;");
  lines.push("");
  lines.push(`entity ${mod.name} is`);

  const params = Array.from(mod.parameters.values()).filter((p) => !p.isLocal);
  if (params.length > 0) {
    lines.push("  generic (");
    params.forEach((p, idx) => {
      const sep = idx < params.length - 1 ? ";" : "";
      lines.push(`    ${p.name} : integer := ${exprToVhdl(p.value)}${sep}`);
    });
    lines.push("  );");
  }

  const ports = mod.portOrder.map((n) => mod.ports.get(n)).filter((p): p is NonNullable<typeof p> => Boolean(p));
  if (ports.length > 0) {
    lines.push("  port (");
    ports.forEach((p, idx) => {
      const dir = p.direction === "input" ? "in" : p.direction === "output" ? "out" : "inout";
      const sep = idx < ports.length - 1 ? ";" : "";
      lines.push(`    ${p.name} : ${dir} ${vhdlType(p.range)}${sep}`);
    });
    lines.push("  );");
  }

  lines.push(`end entity ${mod.name};`);
  lines.push("");
  lines.push(`architecture rtl of ${mod.name} is`);

  for (const [nName, nDecl] of mod.nets) {
    if (mod.ports.has(nName)) continue;
    lines.push(`  signal ${nName} : ${vhdlType(nDecl.range)};`);
  }

  lines.push("begin");

  let procIdx = 0;
  for (const item of mod.items) {
    if (item.kind === "assign") {
      lines.push(`  ${exprToVhdl(item.lhs)} <= ${exprToVhdl(item.rhs)};`);
    } else if (item.kind === "gate") {
      const out = item.ports[0];
      const ins = item.ports.slice(1);
      if (!out || ins.length === 0) continue;
      const inExprs = ins.map(exprToVhdl);
      if (item.gateType === "buf") {
        lines.push(`  ${exprToVhdl(out)} <= ${inExprs[0]!};`);
      } else if (item.gateType === "not") {
        lines.push(`  ${exprToVhdl(out)} <= not ${inExprs[0]!};`);
      } else if (item.gateType === "bufif1") {
        lines.push(`  ${exprToVhdl(out)} <= ${inExprs[0]!} when ${inExprs[1] ?? "'1'"} = '1' else 'Z';`);
      } else if (item.gateType === "bufif0") {
        lines.push(`  ${exprToVhdl(out)} <= ${inExprs[0]!} when ${inExprs[1] ?? "'0'"} = '0' else 'Z';`);
      } else {
        const opMap: Record<string, string> = {
          and: "and",
          nand: "nand",
          or: "or",
          nor: "nor",
          xor: "xor",
          xnor: "xnor",
        };
        const op = opMap[item.gateType] ?? "and";
        lines.push(`  ${exprToVhdl(out)} <= ${inExprs.join(` ${op} `)};`);
      }
    } else if (item.kind === "always") {
      procIdx++;
      const edgeItems = item.sensitivity.filter((s) => s.kind === "posedge" || s.kind === "negedge");
      if (edgeItems.length > 0) {
        const sensSignals = edgeItems.map((e) => e.signal);
        lines.push(`  p_seq_${procIdx} : process(${sensSignals.join(", ")})`);
        lines.push("  begin");
        const primaryEdge = edgeItems[0]!;
        if (primaryEdge.kind === "posedge") {
          lines.push(`    if rising_edge(${primaryEdge.signal}) then`);
        } else if (primaryEdge.kind === "negedge") {
          lines.push(`    if falling_edge(${primaryEdge.signal}) then`);
        }
        lines.push(...stmtToVhdlLines(item.body, "      "));
        lines.push("    end if;");
        lines.push("  end process;");
      } else {
        lines.push(`  p_comb_${procIdx} : process(all)`);
        lines.push("  begin");
        lines.push(...stmtToVhdlLines(item.body, "    "));
        lines.push("  end process;");
      }
    }
  }

  lines.push("end architecture rtl;");
  return lines.join("\n");
}

/**
 * Projects a `VerilogDesign` or single `VerilogModule` to IEEE 1076 VHDL.
 */
export function verilogToVhdl(designOrModule: VerilogDesign | VerilogModule): string {
  if ("modules" in designOrModule) {
    return designOrModule.modules.map(projectModuleToVhdl).join("\n\n");
  }
  return projectModuleToVhdl(designOrModule);
}

// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Projection from VHDL (IEEE 1076) to synthesizable IEEE 1364 Verilog.
 */

import { computeRangeWidth, parseVhdl } from "../parser/vhdl-parser.js";
import type { VhdlDesignFile, VhdlExpr, VhdlSeqStmt, VhdlTypeRef } from "../types.js";

function verilogRange(t: VhdlTypeRef): string {
  if (!t.range) return "";
  const w = t.width ?? computeRangeWidth(t.range);
  if (w !== undefined && w > 1) return `[${w - 1}:0] `;
  return "";
}

function exprToVerilog(expr: VhdlExpr): string {
  switch (expr.kind) {
    case "ident":
      return expr.name;
    case "intLiteral":
      return String(expr.value);
    case "realLiteral":
      return String(expr.value);
    case "boolLiteral":
      return expr.value ? "1'b1" : "1'b0";
    case "charLiteral":
      return `1'b${expr.value.toLowerCase()}`;
    case "bitString": {
      const base = (expr.base ?? "B").toLowerCase();
      const width = base === "x" ? expr.value.length * 4 : base === "o" ? expr.value.length * 3 : expr.value.length;
      return `${width}'${base}${expr.value}`;
    }
    case "others":
      return `{32{${exprToVerilog(expr.value)}}}`;
    case "index":
      return `${expr.target}[${exprToVerilog(expr.index)}]`;
    case "slice":
      return `${expr.target}[${exprToVerilog(expr.range.left)}:${exprToVerilog(expr.range.right)}]`;
    case "call": {
      const fn = expr.name.toLowerCase();
      if ((fn === "unsigned" || fn === "signed" || fn === "std_logic_vector" || fn === "to_integer") && expr.args[0]) {
        return exprToVerilog(expr.args[0]);
      }
      if ((fn === "to_unsigned" || fn === "to_signed") && expr.args[0]) {
        return exprToVerilog(expr.args[0]);
      }
      return `${expr.name}(${expr.args.map(exprToVerilog).join(", ")})`;
    }
    case "unary":
      if (expr.op === "not") return `~(${exprToVerilog(expr.operand)})`;
      return `${expr.op}(${exprToVerilog(expr.operand)})`;
    case "binary": {
      const l = exprToVerilog(expr.left);
      const r = exprToVerilog(expr.right);
      if (expr.op === "and") return `(${l} & ${r})`;
      if (expr.op === "or") return `(${l} | ${r})`;
      if (expr.op === "xor") return `(${l} ^ ${r})`;
      if (expr.op === "nand") return `~(${l} & ${r})`;
      if (expr.op === "nor") return `~(${l} | ${r})`;
      if (expr.op === "xnor") return `~(${l} ^ ${r})`;
      if (expr.op === "=") return `(${l} == ${r})`;
      if (expr.op === "/=") return `(${l} != ${r})`;
      if (expr.op === "&") return `{${l}, ${r}}`;
      return `(${l} ${expr.op} ${r})`;
    }
    default:
      return "1'b0";
  }
}

function detectClockEdge(expr: VhdlExpr): { clk: string; edge: "posedge" | "negedge" } | undefined {
  if (expr.kind === "call") {
    const fn = expr.name.toLowerCase();
    if (fn === "rising_edge" && expr.args[0]?.kind === "ident") return { clk: expr.args[0].name, edge: "posedge" };
    if (fn === "falling_edge" && expr.args[0]?.kind === "ident") return { clk: expr.args[0].name, edge: "negedge" };
  }
  if (expr.kind === "binary" && expr.op === "and") {
    if (expr.left.kind === "attribute" && expr.left.attr.toLowerCase() === "event") {
      const isLow =
        expr.right.kind === "binary" && expr.right.right.kind === "charLiteral" && expr.right.right.value === "0";
      return { clk: expr.left.target, edge: isLow ? "negedge" : "posedge" };
    }
    return detectClockEdge(expr.left) ?? detectClockEdge(expr.right);
  }
  return undefined;
}

function emitSeqVerilog(stmts: VhdlSeqStmt[], indent: string, nonBlocking: boolean, out: string[]): void {
  const assignOp = nonBlocking ? "<=" : "=";
  for (const s of stmts) {
    if (s.kind === "signalAssign" || s.kind === "varAssign") {
      const op = s.kind === "varAssign" ? "=" : assignOp;
      const target = s.target.index ? `${s.target.name}[${exprToVerilog(s.target.index)}]` : s.target.name;
      out.push(`${indent}${target} ${op} ${exprToVerilog(s.value)};`);
    } else if (s.kind === "if") {
      const edge = detectClockEdge(s.condition);
      if (edge) {
        emitSeqVerilog(s.thenBranch, indent, true, out);
      } else {
        out.push(`${indent}if (${exprToVerilog(s.condition)}) begin`);
        emitSeqVerilog(s.thenBranch, indent + "  ", nonBlocking, out);
        out.push(`${indent}end`);
        for (const ei of s.elsifs) {
          const eiEdge = detectClockEdge(ei.condition);
          if (eiEdge) {
            out.push(`${indent}else begin`);
            emitSeqVerilog(ei.body, indent + "  ", true, out);
            out.push(`${indent}end`);
          } else {
            out.push(`${indent}else if (${exprToVerilog(ei.condition)}) begin`);
            emitSeqVerilog(ei.body, indent + "  ", nonBlocking, out);
            out.push(`${indent}end`);
          }
        }
        if (s.elseBranch) {
          out.push(`${indent}else begin`);
          emitSeqVerilog(s.elseBranch, indent + "  ", nonBlocking, out);
          out.push(`${indent}end`);
        }
      }
    } else if (s.kind === "case") {
      out.push(`${indent}case (${exprToVerilog(s.expr)})`);
      for (const alt of s.alternatives) {
        const isOthers = alt.choices.some((c) => c.toLowerCase() === "others");
        const label = isOthers
          ? "default"
          : alt.choices
              .map((c) => {
                const raw = c.replace(/^['"]|['"]$/g, "");
                return /^[01]+$/.test(raw) ? `${raw.length}'b${raw}` : raw;
              })
              .join(", ");
        out.push(`${indent}  ${label}: begin`);
        emitSeqVerilog(alt.body, indent + "    ", nonBlocking, out);
        out.push(`${indent}  end`);
      }
      out.push(`${indent}endcase`);
    }
  }
}

/**
 * Projects a VHDL design file (or source text) to synthesizable IEEE 1364 Verilog.
 */
export function vhdlToVerilog(input: VhdlDesignFile | string, entityName?: string): string {
  const design = typeof input === "string" ? parseVhdl(input) : input;
  const entity = entityName
    ? design.entities.find((e) => e.name.toLowerCase() === entityName.toLowerCase())
    : design.entities[design.entities.length - 1];

  if (!entity) {
    throw new Error(`vhdlToVerilog: entity${entityName ? ` '${entityName}'` : ""} not found.`);
  }

  const arch = design.architectures.find((a) => a.entityName.toLowerCase() === entity.name.toLowerCase());
  const out: string[] = [];

  // Identify signals/ports driven inside processes (must be `reg` in Verilog)
  const procDriven = new Set<string>();
  const collectDriven = (stmts: VhdlSeqStmt[]): void => {
    for (const s of stmts) {
      if (s.kind === "signalAssign") procDriven.add(s.target.name.toLowerCase());
      else if (s.kind === "if") {
        collectDriven(s.thenBranch);
        for (const ei of s.elsifs) collectDriven(ei.body);
        if (s.elseBranch) collectDriven(s.elseBranch);
      } else if (s.kind === "case") {
        for (const a of s.alternatives) collectDriven(a.body);
      }
    }
  };
  if (arch) {
    for (const stmt of arch.statements) {
      if (stmt.kind === "process") collectDriven(stmt.body);
    }
  }

  const paramHeader =
    entity.generics.length > 0
      ? ` #(\n${entity.generics
          .map((g) => `  parameter ${g.name} = ${g.defaultValue ? exprToVerilog(g.defaultValue) : "0"}`)
          .join(",\n")}\n)`
      : "";

  out.push(`module ${entity.name}${paramHeader} (`);
  entity.ports.forEach((p, idx) => {
    const dir = p.direction === "in" ? "input" : p.direction === "inout" ? "inout" : "output";
    const regKw = dir === "output" && procDriven.has(p.name.toLowerCase()) ? "reg " : "wire ";
    const comma = idx < entity.ports.length - 1 ? "," : "";
    out.push(`  ${dir} ${regKw}${verilogRange(p.type)}${p.name}${comma}`);
  });
  out.push(`);`);

  if (arch) {
    // Enum localparams
    for (const t of arch.types) {
      if (t.kind === "enum" && t.enumLiterals) {
        t.enumLiterals.forEach((lit, idx) => {
          out.push(`  localparam ${lit} = ${idx};`);
        });
      }
    }

    // Internal signals
    for (const s of arch.signals) {
      const kind = procDriven.has(s.name.toLowerCase()) ? "reg" : "wire";
      const range = s.type.range
        ? verilogRange(s.type)
        : arch.types.some((t) => t.name.toLowerCase() === s.type.name.toLowerCase())
          ? "[3:0] "
          : "";
      out.push(`  ${kind} ${range}${s.name};`);
    }

    // Concurrent statements
    for (const stmt of arch.statements) {
      if (stmt.kind === "condSignalAssign") {
        let rhs = exprToVerilog(stmt.branches[stmt.branches.length - 1]!.value);
        for (let i = stmt.branches.length - 2; i >= 0; i--) {
          const br = stmt.branches[i]!;
          const cond = br.condition ? exprToVerilog(br.condition) : "1'b1";
          rhs = `(${cond} ? ${exprToVerilog(br.value)} : ${rhs})`;
        }
        out.push(`  assign ${stmt.target.name} = ${rhs};`);
      } else if (stmt.kind === "selectedSignalAssign") {
        let rhs = exprToVerilog(stmt.alternatives[stmt.alternatives.length - 1]!.value);
        for (let i = stmt.alternatives.length - 2; i >= 0; i--) {
          const alt = stmt.alternatives[i]!;
          const raw = alt.choice.replace(/^['"]|['"]$/g, "");
          const lit = /^[01]+$/.test(raw) ? `${raw.length}'b${raw}` : raw;
          rhs = `((${exprToVerilog(stmt.selector)} == ${lit}) ? ${exprToVerilog(alt.value)} : ${rhs})`;
        }
        out.push(`  assign ${stmt.target.name} = ${rhs};`);
      } else if (stmt.kind === "componentInst") {
        const ports = stmt.portMap
          .map((m) => (m.formal ? `.${m.formal}(${exprToVerilog(m.actual)})` : exprToVerilog(m.actual)))
          .join(", ");
        out.push(`  ${stmt.componentName} ${stmt.label} (${ports});`);
      } else if (stmt.kind === "process") {
        let clockEdge: { clk: string; edge: "posedge" | "negedge" } | undefined;
        for (const s of stmt.body) {
          if (s.kind === "if") {
            clockEdge = detectClockEdge(s.condition);
            if (!clockEdge) {
              for (const ei of s.elsifs) {
                clockEdge = detectClockEdge(ei.condition);
                if (clockEdge) break;
              }
            }
          }
          if (clockEdge) break;
        }
        if (clockEdge) {
          out.push(`  always @(${clockEdge.edge} ${clockEdge.clk}) begin`);
          emitSeqVerilog(stmt.body, "    ", true, out);
          out.push(`  end`);
        } else {
          out.push(`  always @(*) begin`);
          emitSeqVerilog(stmt.body, "    ", false, out);
          out.push(`  end`);
        }
      }
    }
  }

  out.push(`endmodule`);
  return out.join("\n") + "\n";
}

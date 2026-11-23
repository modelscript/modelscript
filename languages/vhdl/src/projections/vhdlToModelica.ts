// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Projection from VHDL (IEEE 1076) to Modelica 3.3+ Synchronous Clocks.
 */

import { parseVhdl } from "../parser/vhdl-parser.js";
import { bitsToUnsigned, expandBitString } from "../solver/std-logic.js";
import type { VhdlDesignFile, VhdlExpr, VhdlSeqStmt, VhdlTypeRef } from "../types.js";

function mapTypeToModelica(t: VhdlTypeRef): string {
  const lower = t.name.toLowerCase();
  if (lower === "boolean" || ((lower === "std_logic" || lower === "std_ulogic" || lower === "bit") && !t.range)) {
    return "Boolean";
  }
  return "Integer";
}

function exprToModelica(expr: VhdlExpr): string {
  switch (expr.kind) {
    case "ident":
      return expr.name;
    case "intLiteral":
      return String(expr.value);
    case "realLiteral":
      return String(expr.value);
    case "boolLiteral":
      return expr.value ? "true" : "false";
    case "charLiteral":
      return expr.value === "1" || expr.value === "H" ? "true" : "false";
    case "bitString":
      return String(bitsToUnsigned(expandBitString(expr.value, expr.base ?? "B")));
    case "others":
      return exprToModelica(expr.value);
    case "index":
      return `${expr.target}[${exprToModelica(expr.index)} + 1]`;
    case "call": {
      const fn = expr.name.toLowerCase();
      if (fn === "rising_edge" && expr.args[0]) {
        return `edge(${exprToModelica(expr.args[0])})`;
      }
      if (fn === "falling_edge" && expr.args[0]) {
        return `edge(not ${exprToModelica(expr.args[0])})`;
      }
      if ((fn === "unsigned" || fn === "signed" || fn === "std_logic_vector" || fn === "to_integer") && expr.args[0]) {
        return exprToModelica(expr.args[0]);
      }
      if ((fn === "to_unsigned" || fn === "to_signed") && expr.args[0]) {
        return exprToModelica(expr.args[0]);
      }
      return `${expr.name}(${expr.args.map(exprToModelica).join(", ")})`;
    }
    case "unary":
      if (expr.op === "not") return `(not ${exprToModelica(expr.operand)})`;
      return `(${expr.op}${exprToModelica(expr.operand)})`;
    case "binary": {
      const l = exprToModelica(expr.left);
      const r = exprToModelica(expr.right);
      if (expr.op === "=") return `(${l} == ${r})`;
      if (expr.op === "/=") return `(${l} <> ${r})`;
      if (expr.op === "and") return `(${l} and ${r})`;
      if (expr.op === "or") return `(${l} or ${r})`;
      if (expr.op === "xor") return `(${l} <> ${r})`;
      if (expr.op === "nand") return `(not (${l} and ${r}))`;
      if (expr.op === "nor") return `(not (${l} or ${r}))`;
      if (expr.op === "xnor") return `(${l} == ${r})`;
      return `(${l} ${expr.op} ${r})`;
    }
    default:
      return "0";
  }
}

function isClockCond(expr: VhdlExpr): string | undefined {
  if (
    expr.kind === "call" &&
    (expr.name.toLowerCase() === "rising_edge" || expr.name.toLowerCase() === "falling_edge")
  ) {
    return expr.args[0]?.kind === "ident" ? expr.args[0].name : "clk";
  }
  if (expr.kind === "attribute" && expr.attr.toLowerCase() === "event") return expr.target;
  if (expr.kind === "binary" && expr.op === "and") return isClockCond(expr.left) ?? isClockCond(expr.right);
  return undefined;
}

function emitSeqModelica(stmts: VhdlSeqStmt[], indent: string, out: string[]): void {
  for (const s of stmts) {
    if (s.kind === "signalAssign" || s.kind === "varAssign") {
      out.push(`${indent}${s.target.name} := ${exprToModelica(s.value)};`);
    } else if (s.kind === "if") {
      const clk = isClockCond(s.condition);
      if (clk) {
        out.push(`${indent}when sample(0, clkPeriod) then`);
        emitSeqModelica(s.thenBranch, indent + "  ", out);
        out.push(`${indent}end when;`);
      } else {
        out.push(`${indent}if ${exprToModelica(s.condition)} then`);
        emitSeqModelica(s.thenBranch, indent + "  ", out);
        for (const ei of s.elsifs) {
          const eiClk = isClockCond(ei.condition);
          if (eiClk) {
            out.push(`${indent}elseif edge(${eiClk}) then`);
          } else {
            out.push(`${indent}elseif ${exprToModelica(ei.condition)} then`);
          }
          emitSeqModelica(ei.body, indent + "  ", out);
        }
        if (s.elseBranch) {
          out.push(`${indent}else`);
          emitSeqModelica(s.elseBranch, indent + "  ", out);
        }
        out.push(`${indent}end if;`);
      }
    } else if (s.kind === "case") {
      s.alternatives.forEach((alt, idx) => {
        const isOthers = alt.choices.some((c) => c.toLowerCase() === "others");
        if (isOthers) {
          out.push(`${indent}else`);
        } else {
          const kw = idx === 0 ? "if" : "elseif";
          const cond = alt.choices
            .map((c) => `${exprToModelica(s.expr)} == ${c.replace(/^['"]|['"]$/g, "")}`)
            .join(" or ");
          out.push(`${indent}${kw} ${cond} then`);
        }
        emitSeqModelica(alt.body, indent + "  ", out);
      });
      out.push(`${indent}end if;`);
    }
  }
}

/**
 * Projects a VHDL design file (or source text) to Modelica 3.3+ synchronous clock code.
 */
export function vhdlToModelica(input: VhdlDesignFile | string, entityName?: string): string {
  const design = typeof input === "string" ? parseVhdl(input) : input;
  const entity = entityName
    ? design.entities.find((e) => e.name.toLowerCase() === entityName.toLowerCase())
    : design.entities[design.entities.length - 1];

  if (!entity) {
    throw new Error(`vhdlToModelica: entity${entityName ? ` '${entityName}'` : ""} not found.`);
  }

  const arch = design.architectures.find((a) => a.entityName.toLowerCase() === entity.name.toLowerCase());
  const out: string[] = [];

  out.push(`model ${entity.name}`);
  out.push(`  parameter Real clkPeriod = 1e-8 "Clock period (100 MHz default)";`);
  out.push(`  Clock clk_sync = Clock(clkPeriod);`);

  for (const g of entity.generics) {
    const def = g.defaultValue ? ` = ${exprToModelica(g.defaultValue)}` : "";
    out.push(`  parameter Integer ${g.name}${def};`);
  }

  for (const p of entity.ports) {
    const causality =
      p.direction === "in" ? "input " : p.direction === "out" || p.direction === "buffer" ? "output " : "";
    const moType = mapTypeToModelica(p.type);
    out.push(`  ${causality}discrete ${moType} ${p.name};`);
  }

  if (arch) {
    for (const t of arch.types) {
      if (t.kind === "enum" && t.enumLiterals) {
        out.push(`  type ${t.name} = enumeration(${t.enumLiterals.join(", ")});`);
      }
    }
    for (const s of arch.signals) {
      const moType = arch.types.some((t) => t.name.toLowerCase() === s.type.name.toLowerCase())
        ? s.type.name
        : mapTypeToModelica(s.type);
      out.push(`  discrete ${moType} ${s.name};`);
    }

    const eqLines: string[] = [];
    const algLines: string[] = [];

    for (const stmt of arch.statements) {
      if (stmt.kind === "condSignalAssign") {
        let rhs = exprToModelica(stmt.branches[stmt.branches.length - 1]!.value);
        for (let i = stmt.branches.length - 2; i >= 0; i--) {
          const br = stmt.branches[i]!;
          const cond = br.condition ? exprToModelica(br.condition) : "true";
          rhs = `if ${cond} then ${exprToModelica(br.value)} else ${rhs}`;
        }
        eqLines.push(`  ${stmt.target.name} = ${rhs};`);
      } else if (stmt.kind === "selectedSignalAssign") {
        let rhs = exprToModelica(stmt.alternatives[stmt.alternatives.length - 1]!.value);
        for (let i = stmt.alternatives.length - 2; i >= 0; i--) {
          const alt = stmt.alternatives[i]!;
          const ch = alt.choice.replace(/^['"]|['"]$/g, "");
          rhs = `if ${exprToModelica(stmt.selector)} == ${ch} then ${exprToModelica(alt.value)} else ${rhs}`;
        }
        eqLines.push(`  ${stmt.target.name} = ${rhs};`);
      } else if (stmt.kind === "process") {
        emitSeqModelica(stmt.body, "  ", algLines);
      }
    }

    if (eqLines.length > 0) {
      out.push("equation");
      out.push(...eqLines);
    }
    if (algLines.length > 0) {
      out.push("algorithm");
      out.push(...algLines);
    }
  }

  out.push(`end ${entity.name};`);
  return out.join("\n") + "\n";
}

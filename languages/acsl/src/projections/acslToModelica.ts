// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Projection from ACSL (Advanced Continuous Simulation Language) to Modelica.
 */

import { parseAcsl } from "../parser/acsl-parser.js";
import type { AcslExpr, AcslProgram } from "../types.js";

function emitExpr(expr: AcslExpr): string {
  switch (expr.kind) {
    case "number": {
      const s = String(expr.value);
      return s.includes(".") || s.includes("e") || s.includes("E") ? s : `${s}.0`;
    }
    case "boolean":
      return expr.value ? "true" : "false";
    case "string":
      return `"${expr.value.replace(/"/g, '\\"')}"`;
    case "ident": {
      const up = expr.name.toUpperCase();
      if (up === "T" || up === "TIME") return "time";
      return expr.name;
    }
    case "unary": {
      const inner = emitExpr(expr.operand);
      if (expr.op === ".NOT.") return `(not ${inner})`;
      return `(${expr.op}${inner})`;
    }
    case "binary": {
      const l = emitExpr(expr.left);
      const r = emitExpr(expr.right);
      const opMap: Record<string, string> = {
        "+": "+",
        "-": "-",
        "*": "*",
        "/": "/",
        "**": "^",
        ".EQ.": "==",
        "==": "==",
        ".NE.": "<>",
        "/=": "<>",
        ".LT.": "<",
        "<": "<",
        ".LE.": "<=",
        "<=": "<=",
        ".GT.": ">",
        ">": ">",
        ".GE.": ">=",
        ">=": ">=",
        ".AND.": "and",
        ".OR.": "or",
      };
      return `(${l} ${opMap[expr.op] ?? expr.op} ${r})`;
    }
    case "call": {
      const fn = expr.callee.toUpperCase();
      const args = expr.args.map(emitExpr);
      if (fn === "STEP") return `(if time >= ${args[0] ?? "0.0"} then 1.0 else 0.0)`;
      if (fn === "RAMP") return `(if time > ${args[0] ?? "0.0"} then time - (${args[0] ?? "0.0"}) else 0.0)`;
      if (fn === "BOUND") return `min(${args[1] ?? "1.0"}, max(${args[0] ?? "-1.0"}, ${args[2] ?? "0.0"}))`;
      if (fn === "SW" || fn === "RSW")
        return `(if (${args[0] ?? "0.0"}) > 0.0 then (${args[1] ?? "0.0"}) else (${args[2] ?? "0.0"}))`;
      if (fn === "ALOG") return `log(${args[0] ?? "1.0"})`;
      if (fn === "ALOG10") return `log10(${args[0] ?? "1.0"})`;
      return `${fn.toLowerCase()}(${args.join(", ")})`;
    }
  }
}

/**
 * Projects an ACSL program (parsed or source string) into an equivalent Modelica model string.
 */
export function acslToModelica(programOrSource: AcslProgram | string): string {
  const program = typeof programOrSource === "string" ? parseAcsl(programOrSource) : programOrSource;
  const modelName = (program.name || "AcslModel").replace(/[^A-Za-z0-9_]/g, "_");

  const lines: string[] = [];
  lines.push(`model ${modelName}`);
  lines.push(`  "Projected from ACSL program ${program.name}"`);

  const declared = new Set<string>();
  const stateMap = new Map<string, AcslExpr | undefined>();

  for (const integ of program.integrators) {
    stateMap.set(integ.stateVar.toUpperCase(), integ.initialCondExpr);
  }

  // Parameters and declarations
  for (const decl of program.declarations) {
    const key = decl.name.toUpperCase();
    if (declared.has(key)) continue;
    declared.add(key);
    const moType = decl.kind === "INTEGER" ? "Integer" : decl.kind === "LOGICAL" ? "Boolean" : "Real";
    const prefix = decl.kind === "CONSTANT" ? "parameter " : "";
    const initStr = decl.initialValue ? ` = ${emitExpr(decl.initialValue)}` : "";
    lines.push(`  ${prefix}${moType} ${decl.name}${initStr};`);
  }

  // Continuous states
  for (const integ of program.integrators) {
    const key = integ.stateVar.toUpperCase();
    if (declared.has(key)) continue;
    declared.add(key);
    const startStr = integ.initialCondExpr ? `(start = ${emitExpr(integ.initialCondExpr)}, fixed = true)` : "";
    lines.push(`  Real ${integ.stateVar}${startStr};`);
  }

  // Algebraic & discrete variables
  for (const assign of program.assignments) {
    const key = assign.target.toUpperCase();
    if (declared.has(key)) continue;
    declared.add(key);
    const prefix = assign.section === "DISCRETE" ? "discrete " : "";
    lines.push(`  ${prefix}Real ${assign.target};`);
  }

  // Initial equations
  const initialAssigns = program.assignments.filter((a) => a.section === "INITIAL");
  if (initialAssigns.length > 0) {
    lines.push("initial equation");
    for (const a of initialAssigns) {
      lines.push(`  ${a.target} = ${emitExpr(a.expr)};`);
    }
  }

  // Continuous & discrete equations
  lines.push("equation");
  for (const integ of program.integrators) {
    lines.push(`  der(${integ.stateVar}) = ${emitExpr(integ.derivativeExpr)};`);
  }

  for (const assign of program.assignments) {
    if (assign.section !== "DERIVATIVE" && assign.section !== "DYNAMIC") continue;
    if (stateMap.has(assign.target.toUpperCase())) continue;

    if (assign.expr.kind === "call" && assign.expr.callee === "REALPL" && assign.expr.args.length >= 2) {
      const tau = emitExpr(assign.expr.args[0]!);
      const u = emitExpr(assign.expr.args[1]!);
      lines.push(`  ${tau} * der(${assign.target}) + ${assign.target} = ${u};`);
      continue;
    }

    lines.push(`  ${assign.target} = ${emitExpr(assign.expr)};`);
  }

  for (const disc of program.discreteBlocks) {
    const samplePeriod = disc.intervalExpr ? emitExpr(disc.intervalExpr) : "0.1";
    lines.push(`  when sample(0.0, ${samplePeriod}) then`);
    for (const a of disc.assignments) {
      lines.push(`    ${a.target} = ${emitExpr(a.expr)};`);
    }
    lines.push("  end when;");
  }

  for (const termt of program.termts) {
    const msg = termt.message ?? "ACSL TERMT condition reached";
    lines.push(`  when ${emitExpr(termt.condition)} then`);
    lines.push(`    terminate("${msg.replace(/"/g, '\\"')}");`);
    lines.push("  end when;");
  }

  lines.push(`end ${modelName};`);
  return lines.join("\n") + "\n";
}

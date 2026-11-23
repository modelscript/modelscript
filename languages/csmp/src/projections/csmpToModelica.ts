// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Projection from IBM CSMP/360 & SCi CSSL-67 programs to Modelica 3.6 source code.
 */

import { topologicalSortEquations } from "../lints/index.js";
import type { CsmpExpr, CsmpProgram } from "../types.js";

function sanitizeModelicaIdent(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9_]/g, "_").replace(/^_+/, "");
  if (!cleaned) return "CsmpModel";
  return /^[0-9]/.test(cleaned) ? `M_${cleaned}` : cleaned;
}

function exprToModelica(expr: CsmpExpr): string {
  switch (expr.kind) {
    case "number": {
      const s = String(expr.value);
      return s.includes(".") || s.includes("e") || s.includes("E") ? s : `${s}.0`;
    }
    case "ident": {
      const upper = expr.name.toUpperCase();
      if (upper === "TIME") return "time";
      if (upper === "PI") return "Modelica.Constants.pi";
      return expr.name;
    }
    case "unary":
      return `(${expr.op}${exprToModelica(expr.operand)})`;
    case "binary": {
      const op = expr.op === "**" ? "^" : expr.op;
      return `(${exprToModelica(expr.left)} ${op} ${exprToModelica(expr.right)})`;
    }
    case "call": {
      const fn = expr.callee.toUpperCase();
      const args = expr.args.map(exprToModelica);
      switch (fn) {
        case "SIN":
        case "COS":
        case "TAN":
        case "ASIN":
        case "ACOS":
        case "ATAN":
        case "ATAN2":
        case "SINH":
        case "COSH":
        case "TANH":
        case "EXP":
        case "SQRT":
        case "ABS":
          return `${fn.toLowerCase()}(${args.join(", ")})`;
        case "ALOG":
        case "LOG":
          return `log(${args.join(", ")})`;
        case "ALOG10":
        case "LOG10":
          return `log10(${args.join(", ")})`;
        case "AMAX1":
        case "MAX":
          return `max(${args.join(", ")})`;
        case "AMIN1":
        case "MIN":
          return `min(${args.join(", ")})`;
        case "STEP":
          return `(if time >= ${args[0] ?? "0.0"} then 1.0 else 0.0)`;
        case "RAMP":
          return `(if time >= ${args[0] ?? "0.0"} then time - ${args[0] ?? "0.0"} else 0.0)`;
        case "LIMIT":
          return `min(${args[1] ?? "1.0"}, max(${args[0] ?? "-1.0"}, ${args[2] ?? "0.0"}))`;
        case "DEADSP": {
          const p1 = args[0] ?? "-1.0";
          const p2 = args[1] ?? "1.0";
          const x = args[2] ?? "0.0";
          return `(if ${x} > ${p2} then ${x} - ${p2} elseif ${x} < ${p1} then ${x} - ${p1} else 0.0)`;
        }
        case "INSW":
          return `(if ${args[0] ?? "0.0"} < 0.0 then ${args[1] ?? "0.0"} else ${args[2] ?? "0.0"})`;
        default:
          return `${fn}(${args.join(", ")})`;
      }
    }
  }
}

/**
 * Projects a parsed `CsmpProgram` into a complete, valid Modelica model string.
 */
export function csmpToModelica(program: CsmpProgram): string {
  const modelName = sanitizeModelicaIdent(program.title);
  const lines: string[] = [];

  lines.push(`model ${modelName}`);
  lines.push(`  "Projected from IBM CSMP/360 & CSSL-67: ${program.title.replace(/"/g, "'")}"`);
  lines.push("");

  // Parameters, constants, initial conditions
  for (const [name, decl] of program.constants) {
    lines.push(`  constant Real ${name} = ${decl.value};`);
  }
  for (const [name, decl] of program.parameters) {
    lines.push(`  parameter Real ${name} = ${decl.value};`);
  }
  for (const [name, decl] of program.incons) {
    lines.push(`  parameter Real ${name} = ${decl.value};`);
  }

  // Initial section parameters
  for (const stmt of program.initialStatements) {
    lines.push(`  parameter Real ${stmt.target} = ${exprToModelica(stmt.expr)};`);
  }

  const { sorted } = topologicalSortEquations(program.dynamicStatements);
  const declaredVars = new Set<string>([
    ...program.constants.keys(),
    ...program.parameters.keys(),
    ...program.incons.keys(),
    ...program.initialStatements.map((s) => s.target),
  ]);

  const initialEqs: string[] = [];
  const dynamicEqs: string[] = [];

  // Continuous & algebraic variables
  for (const stmt of sorted) {
    if (!declaredVars.has(stmt.target)) {
      declaredVars.add(stmt.target);
      if (stmt.expr.kind === "call" && stmt.expr.callee.toUpperCase() === "INTGRL" && stmt.expr.args.length >= 2) {
        const icExpr = exprToModelica(stmt.expr.args[0]!);
        lines.push(`  Real ${stmt.target}(start = ${icExpr}, fixed = true);`);
        initialEqs.push(`  ${stmt.target} = ${icExpr};`);
        dynamicEqs.push(`  der(${stmt.target}) = ${exprToModelica(stmt.expr.args[1]!)};`);
        continue;
      }
      if (stmt.expr.kind === "call" && stmt.expr.callee.toUpperCase() === "REALPL" && stmt.expr.args.length >= 3) {
        const icExpr = exprToModelica(stmt.expr.args[0]!);
        const pExpr = exprToModelica(stmt.expr.args[1]!);
        const xExpr = exprToModelica(stmt.expr.args[2]!);
        lines.push(`  Real ${stmt.target}(start = ${icExpr}, fixed = true);`);
        initialEqs.push(`  ${stmt.target} = ${icExpr};`);
        dynamicEqs.push(`  der(${stmt.target}) = (${xExpr} - ${stmt.target}) / ${pExpr};`);
        continue;
      }
      if (stmt.expr.kind === "call" && stmt.expr.callee.toUpperCase() === "CMPXPL" && stmt.expr.args.length >= 5) {
        const ic1 = exprToModelica(stmt.expr.args[0]!);
        const ic2 = exprToModelica(stmt.expr.args[1]!);
        const p1 = exprToModelica(stmt.expr.args[2]!);
        const p2 = exprToModelica(stmt.expr.args[3]!);
        const xExpr = exprToModelica(stmt.expr.args[4]!);
        lines.push(`  Real ${stmt.target}(start = ${ic1}, fixed = true);`);
        lines.push(`  Real ${stmt.target}_der(start = ${ic2}, fixed = true);`);
        initialEqs.push(`  ${stmt.target} = ${ic1};`);
        initialEqs.push(`  ${stmt.target}_der = ${ic2};`);
        dynamicEqs.push(`  der(${stmt.target}) = ${stmt.target}_der;`);
        dynamicEqs.push(
          `  der(${stmt.target}_der) = ${xExpr} - 2.0 * ${p1} * ${p2} * ${stmt.target}_der - (${p2}^2) * ${stmt.target};`,
        );
        continue;
      }
      lines.push(`  Real ${stmt.target};`);
    }
    dynamicEqs.push(`  ${stmt.target} = ${exprToModelica(stmt.expr)};`);
  }

  if (initialEqs.length > 0) {
    lines.push("");
    lines.push("initial equation");
    lines.push(...initialEqs);
  }

  lines.push("");
  lines.push("equation");
  lines.push(...dynamicEqs);

  const stopTime = program.timer.fintim ?? 10.0;
  const interval = program.timer.prdel ?? program.timer.delt ?? 0.01;
  lines.push(`  annotation(experiment(StopTime = ${stopTime}, Interval = ${interval}));`);
  lines.push(`end ${modelName};`);
  lines.push("");

  return lines.join("\n");
}

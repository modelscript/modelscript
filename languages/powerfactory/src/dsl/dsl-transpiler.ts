// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * DIgSILENT Simulation Language (DSL) Transpiler.
 *
 * Translates parsed DSL block ASTs into OpenIPSL-compatible Modelica equations
 * and direct DAE differential-algebraic equations.
 */

import type { DslBlock } from "../types.js";

/**
 * Transpiles a DslBlock AST into an executable Modelica block.
 */
export function transpileDslToModelica(block: DslBlock): string {
  const lines: string[] = [
    `// SPDX-License-Identifier: AGPL-3.0-or-later`,
    `// Auto-transpiled from DIgSILENT Simulation Language (DSL) by ModelScript`,
    `block ${block.name}`,
    `  extends Modelica.Blocks.Icons.Block;`,
    ``,
    `  // ── Inputs ──`,
  ];

  for (const input of block.inputs) {
    lines.push(`  Modelica.Blocks.Interfaces.RealInput ${input};`);
  }

  lines.push(``, `  // ── Outputs ──`);
  for (const output of block.outputs) {
    lines.push(`  Modelica.Blocks.Interfaces.RealOutput ${output};`);
  }

  lines.push(``, `  // ── Parameters ──`);
  for (const [pName, pVal] of block.parameters) {
    lines.push(`  parameter Real ${pName} = ${pVal};`);
  }

  lines.push(``, `  // ── Internal States & Algebraic Variables ──`);
  for (const internal of block.internals) {
    lines.push(`  Real ${internal};`);
  }

  // Also declare any LHS of differential equations that are not yet in internals/outputs
  const declared = new Set([...block.inputs, ...block.outputs, ...block.parameters.keys(), ...block.internals]);
  for (const eq of block.equations) {
    if (!declared.has(eq.lhs)) {
      lines.push(`  Real ${eq.lhs};`);
      declared.add(eq.lhs);
    }
  }

  lines.push(``, `equation`);

  for (const eq of block.equations) {
    if (eq.kind === "differential") {
      lines.push(`  der(${eq.lhs}) = ${eq.rhs};`);
    } else if (eq.kind === "algebraic") {
      lines.push(`  ${eq.lhs} = ${eq.rhs};`);
    } else if (eq.kind === "macro") {
      const args = eq.macroArgs ?? [];
      switch (eq.macroType) {
        case "INT": {
          const u = args[0] ?? "0";
          const t = args[1] ?? "1.0";
          lines.push(`  der(${eq.lhs}) = (${u}) / (${t});`);
          break;
        }
        case "INT_L": {
          const u = args[0] ?? "0";
          const t = args[1] ?? "1.0";
          const min = args[2] ?? "-1e6";
          const max = args[3] ?? "1e6";
          lines.push(
            `  der(${eq.lhs}) = if ${eq.lhs} >= (${max}) and (${u}) > 0 then 0 ` +
              `else if ${eq.lhs} <= (${min}) and (${u}) < 0 then 0 else (${u}) / (${t});`,
          );
          break;
        }
        case "LIM": {
          const x = args[0] ?? "0";
          const min = args[1] ?? "-1e6";
          const max = args[2] ?? "1e6";
          lines.push(`  ${eq.lhs} = smooth(0, if (${x}) > (${max}) then (${max}) else if (${x}) < (${min}) then (${min}) else (${x}));`);
          break;
        }
        case "LAG": {
          const u = args[0] ?? "0";
          const t = args[1] ?? "1.0";
          lines.push(`  der(${eq.lhs}) = ((${u}) - ${eq.lhs}) / (${t});`);
          break;
        }
        case "LEAD_LAG": {
          const u = args[0] ?? "0";
          const t1 = args[1] ?? "1.0";
          const t2 = args[2] ?? "1.0";
          lines.push(`  der(${eq.lhs}) = ((${t1} / ${t2}) * der(${u}) + (${u} - ${eq.lhs})) / (${t2});`);
          break;
        }
        case "WASHOUT": {
          const u = args[0] ?? "0";
          const tw = args[1] ?? "1.0";
          lines.push(`  der(${eq.lhs}) = der(${u}) - (${eq.lhs}) / (${tw});`);
          break;
        }
        case "PIC": {
          const u = args[0] ?? "0";
          const kp = args[1] ?? "1.0";
          const ti = args[2] ?? "1.0";
          lines.push(`  der(${eq.lhs}) = (${kp}) * (der(${u}) + (${u}) / (${ti}));`);
          break;
        }
        default: {
          lines.push(`  ${eq.lhs} = ${eq.rhs};`);
          break;
        }
      }
    }
  }

  lines.push(`end ${block.name};`, ``);
  return lines.join("\n");
}

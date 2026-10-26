// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/touchstone — Modelica 3.x Analog N-Port Projection.
 *
 * Synthesizes a standard Modelica 3.x electrical model containing:
 * - Positive and Negative electrical pins (p[N], n[N])
 * - Differential equations for internal pole-residue states: der(x_k)
 * - Output constitutive equations for port currents and voltages
 */

import { fitStateSpaceModel } from "../solvers/vector-fitting.js";
import type { TouchstoneDeck } from "../types.js";

export function touchstoneToModelica(deck: TouchstoneDeck, modelName?: string): string {
  const name = (modelName ?? "TouchstoneNPort").replace(/[^a-zA-Z0-9_]/g, "_");
  const numPorts = deck.numPorts;
  const ss = fitStateSpaceModel(deck, 2);
  const totalStates = ss.order * numPorts;
  const z0 = deck.options.referenceResistance || 50.0;

  const lines: string[] = [];
  lines.push(`model ${name} "Synthesized Touchstone ${numPorts}-Port Analog Macromodel"`);
  lines.push(`  import Modelica.Electrical.Analog.Interfaces.PositivePin;`);
  lines.push(`  import Modelica.Electrical.Analog.Interfaces.NegativePin;`);
  lines.push(``);
  lines.push(`  // Parameter definitions`);
  lines.push(`  parameter Modelica.Units.SI.Resistance R_ref = ${z0.toFixed(2)} "Reference characteristic impedance";`);
  lines.push(``);
  lines.push(`  // Electrical Pin Connectors`);
  lines.push(`  PositivePin p[${numPorts}] "Positive terminal pins";`);
  lines.push(`  NegativePin n[${numPorts}] "Negative terminal pins";`);
  lines.push(``);
  lines.push(`  // State and Port Variables`);
  lines.push(`  Real v[${numPorts}] "Port terminal voltages (V)";`);
  lines.push(`  Real i[${numPorts}] "Port terminal currents (A)";`);
  lines.push(`  Real x[${totalStates}] "Internal rational state variables";`);
  lines.push(``);
  lines.push(`equation`);
  lines.push(`  // Pin voltage and current relations`);
  lines.push(`  for j in 1:${numPorts} loop`);
  lines.push(`    v[j] = p[j].v - n[j].v;`);
  lines.push(`    p[j].i = i[j];`);
  lines.push(`    n[j].i = -i[j];`);
  lines.push(`  end for;`);
  lines.push(``);
  lines.push(`  // State differential equations der(x) = A*x + B*v`);
  for (let s = 0; s < totalStates; s++) {
    const portIdx = Math.floor(s / ss.order) + 1;
    const aVal = ss.A[s]![s]!;
    const bVal = ss.B[s]![portIdx - 1]!;
    lines.push(
      `  der(x[${s + 1}]) = (${aVal.toExponential(4)}) * x[${s + 1}] + (${bVal.toExponential(4)}) * v[${portIdx}];`,
    );
  }
  lines.push(``);
  lines.push(`  // Port output current equations i = C*x + D*v`);
  for (let p = 0; p < numPorts; p++) {
    const portNum = p + 1;
    const terms: string[] = [];
    const dVal = ss.D[p]?.[p] ?? 0.0;
    terms.push(`(${dVal.toExponential(4)}) * v[${portNum}]`);

    for (let s = 0; s < totalStates; s++) {
      const cVal = ss.C[p]![s]!;
      if (Math.abs(cVal) > 1e-12) {
        terms.push(`(${cVal.toExponential(4)}) * x[${s + 1}]`);
      }
    }
    lines.push(`  i[${portNum}] = ${terms.join(" + ")};`);
  }

  lines.push(`end ${name};`);
  return lines.join("\n") + "\n";
}

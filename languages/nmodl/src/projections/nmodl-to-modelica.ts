// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/nmodl — Modelica 3.x Electrophysiology Channel Projection.
 *
 * Generates an equation-oriented Modelica model representing the NMODL channel dynamics.
 */

import type { NmodlDocument } from "../types.js";

export function nmodlToModelica(doc: NmodlDocument, modelName?: string): string {
  const model = doc.model;
  const base = modelName ?? (model.suffix ? `Nmodl_${model.suffix}` : "NmodlChannel");
  const name = base.replace(/[^a-zA-Z0-9_]/g, "_");

  const lines: string[] = [];
  lines.push(`model ${name} "Modelica 3.x projection of NEURON NMODL channel mechanism"`);

  // Parameters
  if (model.parameters.length > 0) {
    lines.push("  // Parameters & Reversal Potentials");
    for (const p of model.parameters) {
      const u = p.units ? ` "${p.units}"` : "";
      lines.push(`  parameter Real ${p.name} = ${p.val.toFixed(4)}${u};`);
    }
    lines.push(`  parameter Real Cm = 1.0 "Membrane Capacitance [uF/cm2]";`);
    lines.push(`  parameter Real iStim = 0.0 "Injected Current [uA/cm2]";`);
  }

  // Continuous States
  lines.push("");
  lines.push("  // Continuous State Variables");
  lines.push(`  Real v(start = -65.0) "Membrane Potential [mV]";`);
  for (const s of model.states) {
    lines.push(`  Real ${s.name}(start = 0.1, min = 0.0, max = 1.0) "Gating Probability";`);
  }

  // Assigned Variables
  if (model.assigned.length > 0) {
    lines.push("");
    lines.push("  // Assigned Ionic Currents & Conductances");
    for (const a of model.assigned) {
      const u = a.units ? ` "${a.units}"` : "";
      lines.push(`  Real ${a.name}${u};`);
    }
  }

  lines.push("");
  lines.push("equation");

  // Derivative Equations
  for (const eq of model.derivativeEquations) {
    if (eq.isDerivative && eq.stateName) {
      lines.push(`  der(${eq.stateName}) = ${eq.rhs};`);
    }
  }

  // Breakpoint Equations
  for (const eq of model.breakpointEquations) {
    lines.push(`  ${eq.lhs} = ${eq.rhs};`);
  }

  // Cell Membrane Capacitor Equation
  const writeCurrents: string[] = [];
  for (const ion of model.ions) {
    for (const w of ion.write) writeCurrents.push(w);
  }
  const curSum = writeCurrents.length > 0 ? writeCurrents.join(" + ") : "0.0";
  lines.push(`  der(v) = (-(${curSum}) + iStim) / Cm;`);

  lines.push(`end ${name};`);
  return lines.join("\n");
}

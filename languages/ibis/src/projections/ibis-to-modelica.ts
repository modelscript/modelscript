// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/ibis — Modelica 3.x Analog Buffer Projection.
 *
 * Synthesizes standard Modelica 3.x electrical models incorporating package parasitics
 * (R_pkg, L_pkg, C_pkg), die capacitance (C_comp), and switching driver characteristics.
 */

import { calculateOutputResistance } from "../solvers/buffer-solver.js";
import type { IbisDeck, IbisModel } from "../types.js";

export function ibisToModelica(deck: IbisDeck, modelName?: string): string {
  const name = (modelName ?? (deck.models.keys().next().value || "IbisBuffer")).replace(/[^a-zA-Z0-9_]/g, "_");
  const firstModel: IbisModel = deck.models.get(name) ??
    deck.models.values().next().value ?? {
      name,
      modelType: "I/O",
      cComp: { typ: 2.0e-12, min: 1.5e-12, max: 3.0e-12 },
      voltageRange: { typ: 3.3, min: 3.0, max: 3.6 },
      line: 1,
    };

  const comp = deck.components.values().next().value;
  const rPkg = comp?.package.rPkg.typ || 0.1;
  const lPkg = comp?.package.lPkg.typ || 2.5e-9;
  const cComp = firstModel.cComp.typ || 2.0e-12;
  const vcc = firstModel.voltageRange.typ || 3.3;
  const { rOnLow } = calculateOutputResistance(firstModel);
  const rEff = Math.max(1.0, rOnLow);

  const lines: string[] = [];
  lines.push(`model ${name} "Synthesized IBIS ${firstModel.modelType} Buffer Model"`);
  lines.push(`  import Modelica.Electrical.Analog.Interfaces.PositivePin;`);
  lines.push(`  import Modelica.Electrical.Analog.Interfaces.NegativePin;`);
  lines.push(``);
  lines.push(`  // Package & Die Parameters`);
  lines.push(`  parameter Modelica.Units.SI.Resistance R_pkg = ${rPkg.toFixed(4)} "Package lead resistance";`);
  lines.push(
    `  parameter Modelica.Units.SI.Inductance L_pkg = ${lPkg.toExponential(4)} "Package bondwire inductance";`,
  );
  lines.push(`  parameter Modelica.Units.SI.Capacitance C_comp = ${cComp.toExponential(4)} "Die pad capacitance";`);
  lines.push(`  parameter Modelica.Units.SI.Voltage Vcc = ${vcc.toFixed(2)} "Supply voltage";`);
  lines.push(`  parameter Modelica.Units.SI.Resistance R_on = ${rEff.toFixed(2)} "Nominal driver on-resistance";`);
  lines.push(``);
  lines.push(`  // External Pin Connectors`);
  lines.push(`  PositivePin pad "External IC package pin";`);
  lines.push(`  NegativePin gnd "Ground reference pin";`);
  lines.push(``);
  lines.push(`  // Internal Voltages and Currents`);
  lines.push(`  Real v_pad "Terminal voltage at pad";`);
  lines.push(`  Real v_die "Internal die pad voltage";`);
  lines.push(`  Real i_pkg "Current through package lead";`);
  lines.push(`  Real i_driver "Current through driver pullup/pulldown";`);
  lines.push(``);
  lines.push(`equation`);
  lines.push(`  v_pad = pad.v - gnd.v;`);
  lines.push(`  pad.i = i_pkg;`);
  lines.push(`  gnd.i = -i_pkg;`);
  lines.push(``);
  lines.push(`  // Package bondwire dynamic equation`);
  lines.push(`  L_pkg * der(i_pkg) = v_pad - v_die - R_pkg * i_pkg;`);
  lines.push(``);
  lines.push(`  // Die pad capacitance dynamic equation`);
  lines.push(`  C_comp * der(v_die) = i_pkg - i_driver;`);
  lines.push(``);
  lines.push(`  // Constitutive driver current equation`);
  lines.push(`  i_driver = v_die / R_on;`);
  lines.push(`end ${name};`);

  return lines.join("\n") + "\n";
}

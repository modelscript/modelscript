// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Projects a NASA ROCETS liquid propulsion deck into clean, executable Modelica 3.x code.
 */

import type { RocetsEngineModel } from "../types.js";

export function rocetsToModelica(model: RocetsEngineModel): string {
  const modelName = model.name.replace(/[^A-Za-z0-9_]/g, "_");
  const lines: string[] = [];

  lines.push(`// Modelica projection generated from NASA ROCETS engine model: ${model.name}`);
  if (model.title) {
    lines.push(`// Title: ${model.title}`);
  }
  lines.push(`model ${modelName}`);

  // Component instances
  lines.push("  // Propulsion Components");
  for (const [compId, comp] of model.components) {
    const t = comp.type.toUpperCase();
    switch (t) {
      case "CHAMBER":
      case "TC":
      case "COMBUSTOR": {
        const pc0 = comp.initialStates["PC"] ?? comp.parameters["PC"] ?? 7.0e6;
        lines.push(`  // Thrust Chamber: ${compId}`);
        lines.push(`  Real ${compId}_Pc(start = ${pc0});`);
        lines.push(`  Real ${compId}_mdot_ox;`);
        lines.push(`  Real ${compId}_mdot_fuel;`);
        lines.push(`  Real ${compId}_mdot_gas;`);
        break;
      }

      case "PUMP": {
        lines.push(`  // Turbopump: ${compId}`);
        lines.push(`  Real ${compId}_P_in;`);
        lines.push(`  Real ${compId}_P_out;`);
        lines.push(`  Real ${compId}_mdot;`);
        lines.push(`  Real ${compId}_power;`);
        break;
      }

      case "TURBINE": {
        lines.push(`  // Turbine: ${compId}`);
        lines.push(`  Real ${compId}_P_in;`);
        lines.push(`  Real ${compId}_P_out;`);
        lines.push(`  Real ${compId}_mdot;`);
        lines.push(`  Real ${compId}_power;`);
        break;
      }

      case "SHAFT": {
        const rpm0 = comp.initialStates["SPEED_RPM"] ?? comp.parameters["SPEED_RPM"] ?? 32000.0;
        const omega0 = (Number(rpm0) * 2.0 * Math.PI) / 60.0;
        lines.push(`  // Rotating Shaft: ${compId}`);
        lines.push(`  Real ${compId}_omega(start = ${omega0});`);
        lines.push(`  Real ${compId}_tau_turb;`);
        lines.push(`  Real ${compId}_tau_pump;`);
        break;
      }

      case "VALVE":
      case "ORIFICE": {
        lines.push(`  // Valve: ${compId}`);
        lines.push(`  Real ${compId}_P_in;`);
        lines.push(`  Real ${compId}_P_out;`);
        lines.push(`  Real ${compId}_mdot;`);
        break;
      }

      default: {
        lines.push(`  // Generic Module: ${compId}`);
        for (const port of Object.keys(comp.ports)) {
          lines.push(`  Real ${compId}_${port};`);
        }
        break;
      }
    }
  }

  lines.push("");
  lines.push("equation");

  // Physics Equations
  for (const [compId, comp] of model.components) {
    const t = comp.type.toUpperCase();
    switch (t) {
      case "CHAMBER":
      case "TC":
      case "COMBUSTOR": {
        const vc = comp.parameters["VC"] ?? 0.01;
        const at = comp.parameters["AT"] ?? 0.005;
        const cstar = comp.parameters["CSTAR"] ?? 1780.0;
        lines.push(`  ${compId}_mdot_gas = ${compId}_Pc * ${at} / ${cstar};`);
        lines.push(
          `  der(${compId}_Pc) = (1.2 * 360 * 3000 / ${vc}) * (${compId}_mdot_ox + ${compId}_mdot_fuel - ${compId}_mdot_gas);`,
        );
        break;
      }

      case "PUMP": {
        const dp = comp.parameters["DELTA_P"] ?? 10.0e6;
        const eta = comp.parameters["ETA"] ?? 0.76;
        const rho = comp.parameters["RHO"] ?? 1140.0;
        lines.push(`  ${compId}_P_out = ${compId}_P_in + ${dp};`);
        lines.push(`  ${compId}_power = ${compId}_mdot * ${dp} / (${rho} * ${eta});`);
        break;
      }

      case "TURBINE": {
        const pr = comp.parameters["PR"] ?? 1.6;
        const eta = comp.parameters["ETA"] ?? 0.72;
        lines.push(`  ${compId}_P_out = ${compId}_P_in / ${pr};`);
        lines.push(`  ${compId}_power = ${compId}_mdot * 2400.0 * 950.0 * ${eta} * (1.0 - (1.0 / ${pr})^0.285);`);
        break;
      }

      case "SHAFT": {
        const j = comp.parameters["INERTIA"] ?? 0.08;
        lines.push(`  ${j} * der(${compId}_omega) = ${compId}_tau_turb - ${compId}_tau_pump;`);
        break;
      }

      case "VALVE":
      case "ORIFICE": {
        const cv = comp.parameters["CV"] ?? 0.002;
        const pos = comp.parameters["POSITION"] ?? 1.0;
        lines.push(`  ${compId}_P_out = ${compId}_P_in - (1.0 / (${cv} * ${pos} * 100.0)) * ${compId}_mdot;`);
        break;
      }
    }
  }

  // Inter-component connections
  lines.push("");
  lines.push("  // Flow Connections");
  for (const conn of model.connections) {
    const fromVar = `${conn.fromComponent}_${conn.fromPort}`;
    const toVar = `${conn.toComponent}_${conn.toPort}`;
    lines.push(`  ${toVar} = ${fromVar};`);
  }

  lines.push(`end ${modelName};`);
  return lines.join("\n");
}

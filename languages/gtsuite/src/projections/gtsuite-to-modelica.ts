// SPDX-License-Identifier: AGPL-3.0-or-later

import type { GtCylinderComponent, GtModel } from "../types.js";

/**
 * Projects a GT-SUITE / GT-POWER engine model into clean, executable Modelica 3.x code.
 */
export function gtsuiteToModelica(model: GtModel): string {
  const modelName = model.name.replace(/[^A-Za-z0-9_]/g, "_");
  const cylinders = model.components.filter((c) => c.kind === "cylinder") as GtCylinderComponent[];
  const mainCyl = cylinders[0];

  const lines: string[] = [];

  lines.push(`// Modelica projection generated from GT-SUITE engine model: ${model.name}`);
  lines.push(`model ${modelName}`);
  lines.push(`  // Global Parameters`);
  lines.push(`  parameter Real engineSpeedRpm = ${model.simulationSettings.engineSpeedRpm || 3000.0};`);
  lines.push(`  parameter Real lambda = ${model.simulationSettings.airFuelRatioLambda || 1.0};`);
  if (mainCyl) {
    lines.push(`  parameter Real bore = ${mainCyl.boreM};`);
    lines.push(`  parameter Real stroke = ${mainCyl.strokeM};`);
    lines.push(`  parameter Real compressionRatio = ${mainCyl.compressionRatio};`);
  }
  lines.push(``);

  lines.push(`  // Continuous State Variables`);
  lines.push(`  Real P_intake_manifold(start = 140000.0);`);
  lines.push(`  Real P_exhaust_manifold(start = 125000.0);`);
  lines.push(`  Real omega_turbo(start = 11000.0);`);
  lines.push(`  Real engineBrakeTorque;`);
  lines.push(`  Real engineBrakePowerKw;`);
  lines.push(`  Real airMassFlow;`);
  lines.push(`  Real fuelMassFlow;`);
  lines.push(`  Real bsfc;`);
  lines.push(``);

  lines.push(`  // Component Declarations`);
  for (const comp of model.components) {
    const id = comp.id.replace(/[^A-Za-z0-9_]/g, "_");
    lines.push(`  // Component: ${id} (${comp.kind})`);
    lines.push(`  Real ${id}_pressure;`);
    lines.push(`  Real ${id}_massFlow;`);
  }
  lines.push(``);

  lines.push(`equation`);
  lines.push(`  // Engine airflow and torque equations`);
  lines.push(`  airMassFlow = 0.045 * (P_intake_manifold / 100000.0) * (engineSpeedRpm / 3000.0);`);
  lines.push(`  fuelMassFlow = airMassFlow / (14.7 * lambda);`);
  lines.push(`  engineBrakeTorque = 280.0 * (P_intake_manifold / 140000.0);`);
  lines.push(`  engineBrakePowerKw = engineBrakeTorque * (engineSpeedRpm * 2 * 3.14159 / 60.0) / 1000.0;`);
  lines.push(`  bsfc = (fuelMassFlow * 3.6e6) / max(1.0, engineBrakePowerKw);`);
  lines.push(``);

  lines.push(`  // Manifold filling dynamics`);
  lines.push(`  der(P_intake_manifold) = 15000.0 * (omega_turbo / 12000.0) - airMassFlow * 1e5;`);
  lines.push(`  der(P_exhaust_manifold) = (airMassFlow + fuelMassFlow) * 8e4 - 1.2 * P_exhaust_manifold;`);
  lines.push(`  der(omega_turbo) = (engineBrakePowerKw * 100.0 - 0.05 * omega_turbo);`);
  lines.push(``);

  // Inter-component connections
  for (const conn of model.connections) {
    const from = conn.fromComponent.replace(/[^A-Za-z0-9_]/g, "_");
    const to = conn.toComponent.replace(/[^A-Za-z0-9_]/g, "_");
    lines.push(`  ${from}_pressure = ${to}_pressure;`);
    lines.push(`  ${from}_massFlow = ${to}_massFlow;`);
  }

  lines.push(`end ${modelName};`);
  return lines.join("\n");
}

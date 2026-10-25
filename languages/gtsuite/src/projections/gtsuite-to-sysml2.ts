// SPDX-License-Identifier: AGPL-3.0-or-later

import type { GtCylinderComponent, GtModel } from "../types.js";

/**
 * Projects a GT-SUITE / GT-POWER engine model into formal SysML v2 textual syntax.
 */
export function gtsuiteToSysml2(model: GtModel): string {
  const modelName = model.name.replace(/[^A-Za-z0-9_]/g, "_");
  const cylinders = model.components.filter((c) => c.kind === "cylinder") as GtCylinderComponent[];
  const numCyls = Math.max(1, cylinders.length);
  const mainCyl = cylinders[0];

  const lines: string[] = [];

  lines.push(`// SysML v2 architectural projection generated from GT-SUITE engine model: ${model.name}`);
  lines.push(`package ${modelName}PowertrainSystem {`);
  lines.push(`  private import ScalarValues::*;`);
  lines.push(`  private import ISQ::*;`);
  lines.push(``);

  // Port definitions
  lines.push(`  // 1. Domain Fluid & Mechanical Ports`);
  lines.push(`  port def AirIntakePort {`);
  lines.push(`    out pressure : Pressure;`);
  lines.push(`    out temperature : Temperature;`);
  lines.push(`    out massFlowRate : MassFlowRate;`);
  lines.push(`  }`);
  lines.push(``);
  lines.push(`  port def ExhaustGasPort {`);
  lines.push(`    in pressure : Pressure;`);
  lines.push(`    in temperature : Temperature;`);
  lines.push(`    in massFlowRate : MassFlowRate;`);
  lines.push(`  }`);
  lines.push(``);
  lines.push(`  port def MechanicalShaftPort {`);
  lines.push(`    out rotationalSpeed : AngularVelocity;`);
  lines.push(`    out torque : Torque;`);
  lines.push(`  }`);
  lines.push(``);

  // Requirements
  lines.push(`  // 2. Formal Powertrain & Emissions Requirements`);
  lines.push(`  requirement def BrakeSpecificFuelConsumptionRequirement {`);
  lines.push(`    doc /* Maximum allowable brake specific fuel consumption under rated load */`);
  lines.push(`    attribute maxBsfc : Real = 230.0; // g/kWh`);
  lines.push(`  }`);
  lines.push(``);
  lines.push(`  requirement def MaxManifoldBoostPressureRequirement {`);
  lines.push(`    doc /* Structural limit on intake manifold absolute boost pressure */`);
  lines.push(`    attribute maxBoostBar : Real = 2.8; // bar`);
  lines.push(`  }`);
  lines.push(``);
  lines.push(`  requirement def Euro7TailpipeNoxCeilingRequirement {`);
  lines.push(`    doc /* Maximum engine-out NOx emissions ceiling before aftertreatment */`);
  lines.push(`    attribute maxNoxPpm : Real = 60.0; // ppm`);
  lines.push(`  }`);
  lines.push(``);

  // System part definition
  lines.push(`  // 3. Powertrain System Architecture`);
  lines.push(`  part def ${modelName}System {`);
  if (mainCyl) {
    lines.push(`    attribute cylinderCount : Integer = ${numCyls};`);
    lines.push(`    attribute boreM : Real = ${mainCyl.boreM};`);
    lines.push(`    attribute strokeM : Real = ${mainCyl.strokeM};`);
    lines.push(`    attribute compressionRatio : Real = ${mainCyl.compressionRatio};`);
  }
  lines.push(`    attribute ratedSpeedRpm : Real = ${model.simulationSettings.engineSpeedRpm || 3000.0};`);
  lines.push(``);

  // Components as sub-parts
  lines.push(`    // Subsystem Components`);
  for (const comp of model.components) {
    const compId = comp.id.replace(/[^A-Za-z0-9_]/g, "_");
    lines.push(`    part ${compId} {`);
    lines.push(`      doc /* GT-SUITE component: kind=${comp.kind} */`);
    lines.push(`    }`);
  }
  lines.push(``);

  // Connections
  if (model.connections.length > 0) {
    lines.push(`    // Inter-Component Fluid & Mechanical Connections`);
    for (const conn of model.connections) {
      const from = conn.fromComponent.replace(/[^A-Za-z0-9_]/g, "_");
      const to = conn.toComponent.replace(/[^A-Za-z0-9_]/g, "_");
      lines.push(`    connect ${from}.${conn.fromPort} to ${to}.${conn.toPort};`);
    }
  }
  lines.push(`  }`);
  lines.push(`}`);

  return lines.join("\n");
}

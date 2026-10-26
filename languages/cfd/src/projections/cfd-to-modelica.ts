// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CfdModelData } from "../types.js";

/**
 * Projects a CFD aerodynamic configuration into a native Modelica 3.x acausal component.
 */
export function cfdToModelica(model: CfdModelData, className?: string): string {
  const modelName = (className ?? model.mathProblem ?? "CfdAerodynamics").replace(/[^a-zA-Z0-9_]/g, "_");
  const mach = model.machNumber ?? 0.8;
  const reynolds = model.reynoldsNumber ?? 6.5e6;
  const aoa = model.aoa ?? 2.0;
  const refArea = parseFloat(model.directives.get("REF_AREA") ?? "1.0") || 1.0;
  const refLength = parseFloat(model.directives.get("REF_LENGTH") ?? "1.0") || 1.0;

  const lines: string[] = [
    `model ${modelName} "Modelica 3.x Aerodynamic Surface & Fluid Domain Model"`,
    `  // Aerodynamic Reference Parameters`,
    `  parameter Real Mach = ${mach} "Freestream Mach number";`,
    `  parameter Real Reynolds = ${reynolds} "Freestream Reynolds number";`,
    `  parameter Real AoA = ${aoa} "Angle of Attack [deg]";`,
    `  parameter Real refArea = ${refArea} "Aerodynamic reference wing area [m2]";`,
    `  parameter Real refLength = ${refLength} "Reference chord length [m]";`,
    `  parameter Real rhoInf = 1.225 "Freestream air density [kg/m3]";`,
    `  parameter Real soundSpeed = 340.29 "Speed of sound [m/s]";`,
    ``,
    `  // Dynamic States & Aerodynamic Forces`,
    `  Real vInf "Freestream velocity [m/s]";`,
    `  Real qInf "Dynamic pressure [Pa]";`,
    `  Real C_L "Lift coefficient";`,
    `  Real C_D "Drag coefficient";`,
    `  Real Lift "Aerodynamic Lift force [N]";`,
    `  Real Drag "Aerodynamic Drag force [N]";`,
    `  Real PitchMoment "Aerodynamic Pitching Moment [N.m]";`,
  ];

  // Inlets and Outlets
  for (const marker of model.markers.values()) {
    const kind = marker.type.toUpperCase();
    if (kind.includes("INLET")) {
      lines.push(`  Real ${marker.name}_P(start=101325.0) "Inlet total pressure [Pa]";`);
      lines.push(`  Real ${marker.name}_m_flow(start=10.0) "Inlet mass flow rate [kg/s]";`);
    } else if (kind.includes("OUTLET")) {
      lines.push(`  Real ${marker.name}_P(start=101325.0) "Outlet backpressure [Pa]";`);
      lines.push(`  Real ${marker.name}_m_flow(start=10.0) "Outlet mass flow rate [kg/s]";`);
    }
  }

  lines.push(
    ``,
    `equation`,
    `  vInf = Mach * soundSpeed;`,
    `  qInf = 0.5 * rhoInf * vInf^2;`,
    `  C_L = 2 * 3.1415926535 * (AoA * 3.1415926535 / 180.0);`,
    `  C_D = 0.02 + 0.05 * C_L^2;`,
    `  Lift = qInf * refArea * C_L;`,
    `  Drag = qInf * refArea * C_D;`,
    `  PitchMoment = qInf * refArea * refLength * (-0.05 * C_L);`,
  );

  for (const marker of model.markers.values()) {
    const kind = marker.type.toUpperCase();
    if (kind.includes("INLET")) {
      lines.push(`  ${marker.name}_P = 101325.0 * (1.0 + 0.2 * Mach^2)^3.5;`);
    } else if (kind.includes("OUTLET")) {
      lines.push(`  ${marker.name}_P = 101325.0;`);
    }
  }

  lines.push(`end ${modelName};`, ``);
  return lines.join("\n");
}

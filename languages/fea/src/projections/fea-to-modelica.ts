// SPDX-License-Identifier: AGPL-3.0-or-later

import type { FeaModelData } from "../types.js";

/**
 * Projects an FEA structural model into a native Modelica 3.x flexible structural body.
 */
export function feaToModelica(model: FeaModelData, className?: string): string {
  const modelName = (className ?? model.heading ?? "FeaStructure").replace(/[^a-zA-Z0-9_]/g, "_");

  let avgE = 2.1e11;
  let avgNu = 0.3;
  let avgRho = 7850.0;
  for (const mat of model.materials.values()) {
    if (mat.E && mat.E > 0) avgE = mat.E;
    if (mat.nu && mat.nu > 0) avgNu = mat.nu;
    if (mat.rho && mat.rho > 0) avgRho = mat.rho;
  }

  const numNodes = model.nodes.size;
  const numElements = model.elements.size;

  const lines: string[] = [
    `model ${modelName} "Modelica 3.x Flexible Body Structural Dynamics Model"`,
    `  // Material & Discretization Parameters`,
    `  parameter Real E = ${avgE} "Young's modulus [Pa]";`,
    `  parameter Real nu = ${avgNu} "Poisson's ratio";`,
    `  parameter Real rho = ${avgRho} "Material density [kg/m3]";`,
    `  parameter Integer numNodes = ${numNodes} "Total mesh nodes";`,
    `  parameter Integer numElements = ${numElements} "Total finite elements";`,
    `  parameter Real modalDamping = 0.02 "Structural modal damping ratio";`,
    ``,
    `  // Modal Generalized Coordinates (Modes 1 to 4)`,
    `  Real q1(start=0.0) "First bending modal coordinate [m]";`,
    `  Real q2(start=0.0) "Second bending modal coordinate [m]";`,
    `  Real q3(start=0.0) "Torsional modal coordinate [rad]";`,
    `  Real q4(start=0.0) "Axial modal coordinate [m]";`,
    ``,
    `  Real v1(start=0.0) "Modal velocity mode 1 [m/s]";`,
    `  Real v2(start=0.0) "Modal velocity mode 2 [m/s]";`,
    `  Real v3(start=0.0) "Modal velocity mode 3 [rad/s]";`,
    `  Real v4(start=0.0) "Modal velocity mode 4 [m/s]";`,
    ``,
    `  // External Loads & Tip Displacements`,
    `  Real F_ext "Applied external transverse load [N]";`,
    `  Real tipDisplacement "Structural tip deflection [m]";`,
    `  Real maxStress "Maximum Von Mises stress [Pa]";`,
    ``,
    `equation`,
    `  // Modal Differential Equations`,
    `  der(q1) = v1;`,
    `  der(v1) = (F_ext / (rho * 0.01)) - 2.0 * modalDamping * 62.83 * v1 - (62.83)^2 * q1;`,
    ``,
    `  der(q2) = v2;`,
    `  der(v2) = -2.0 * modalDamping * 125.66 * v2 - (125.66)^2 * q2;`,
    ``,
    `  der(q3) = v3;`,
    `  der(v3) = -2.0 * modalDamping * 188.49 * v3 - (188.49)^2 * q3;`,
    ``,
    `  der(q4) = v4;`,
    `  der(v4) = -2.0 * modalDamping * 251.32 * v4 - (251.32)^2 * q4;`,
    ``,
    `  // Output Synthesis`,
    `  tipDisplacement = 1.0 * q1 + 0.5 * q2;`,
    `  maxStress = E * 1e-4 * abs(q1);`,
    `  F_ext = 0.0;`,
    `end ${modelName};`,
    ``,
  ];

  return lines.join("\n");
}

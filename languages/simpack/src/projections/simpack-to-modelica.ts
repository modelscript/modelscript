// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SimpackModel } from "../types.js";

/**
 * Projects a SIMPACK multibody model to Modelica MultiBody components.
 */
export function simpackToModelica(model: SimpackModel): string {
  const lines: string[] = [];
  lines.push(`model ${model.name}`);
  lines.push("  import Modelica.Mechanics.MultiBody.Parts.Body;");
  lines.push("  import Modelica.Mechanics.MultiBody.Joints.Revolute;");

  for (const [id, body] of model.bodies.entries()) {
    lines.push(
      `  Body ${id}(m=${body.mass}, I_11=${body.inertia.ixx}, I_22=${body.inertia.iyy}, I_33=${body.inertia.izz});`,
    );
  }

  lines.push("equation");
  lines.push(`end ${model.name};`);
  return lines.join("\n");
}

// SPDX-License-Identifier: AGPL-3.0-or-later

import type { GensysModel } from "../types.js";

/**
 * Projects a GENSYS vehicle model into Modelica using standard Modelica.Mechanics.MultiBody components.
 */
export function gensysToModelica(model: GensysModel): string {
  const lines: string[] = [];
  lines.push(`model ${model.name}`);
  lines.push("  import Modelica.Mechanics.MultiBody.Parts.Body;");
  lines.push("  import Modelica.Mechanics.MultiBody.Forces.SpringDamperParallel;");

  for (const [name, body] of model.bodies.entries()) {
    lines.push(
      `  Body ${name}(m=${body.mass}, I_11=${body.inertia.jx}, I_22=${body.inertia.jy}, I_33=${body.inertia.jz});`,
    );
  }

  for (const [name, s] of model.couplings.entries()) {
    if (s.body1 !== "ground" && s.body2 !== "ground") {
      lines.push(`  SpringDamperParallel ${name}(c=${s.stiffness.z}, d=${s.damping.z});`);
    }
  }

  lines.push("equation");
  for (const [name, s] of model.couplings.entries()) {
    if (s.body1 !== "ground" && s.body2 !== "ground") {
      lines.push(`  connect(${s.body1}.frame_b, ${name}.frame_a);`);
      lines.push(`  connect(${name}.frame_b, ${s.body2}.frame_a);`);
    }
  }

  lines.push(`end ${model.name};`);
  return lines.join("\n");
}

// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Modelica Projection for PSCAD Netlists.
 *
 * Translates electrical branches, transformers, and lines from an EmtNetlist
 * into a native Modelica block model using standard Modelica.Electrical.Analog components.
 */

import { extractEmtNetlist } from "../netlist/emt-netlist.js";
import type { PscxProject } from "../types.js";

/**
 * Translates a PSCAD project into native Modelica source code.
 */
export function pscadToModelica(project: PscxProject): string {
  const netlist = extractEmtNetlist(project);
  const modelName = project.name.replace(/[^a-zA-Z0-9_]/g, "_");

  const declarations: string[] = [];
  const equations: string[] = [];

  declarations.push(`  Modelica.Electrical.Analog.Basic.Ground ground;`);

  // 1. Declare RLC Branches
  for (const b of netlist.branches) {
    const id = b.id.replace(/[^a-zA-Z0-9_]/g, "_");
    if (b.resistanceOhm > 0 && b.inductanceH === 0 && b.capacitanceF === 0) {
      declarations.push(`  Modelica.Electrical.Analog.Basic.Resistor ${id}(R = ${b.resistanceOhm});`);
    } else if (b.inductanceH > 0) {
      declarations.push(`  Modelica.Electrical.Analog.Basic.Inductor ${id}(L = ${b.inductanceH});`);
    } else if (b.capacitanceF > 0) {
      declarations.push(`  Modelica.Electrical.Analog.Basic.Capacitor ${id}(C = ${b.capacitanceF});`);
    }
  }

  // 2. Declare Transformers as Two-Port Impedances
  for (const xfmr of netlist.transformers) {
    const id = xfmr.id.replace(/[^a-zA-Z0-9_]/g, "_");
    // Leakage inductance L = X_pu * (V_base^2 / S_base) / (2*pi*f)
    const zBase = Math.pow(xfmr.primaryKv * 1e3, 2) / (xfmr.mvaRating * 1e6);
    const xOhm = xfmr.leakageReactancePu * zBase;
    const lH = xOhm / (2 * Math.PI * netlist.nominalFrequencyHz);

    declarations.push(
      `  // Transformer ${xfmr.id}: ${xfmr.primaryKv}kV -> ${xfmr.secondaryKv}kV, ${xfmr.mvaRating} MVA`,
    );
    declarations.push(`  Modelica.Electrical.Analog.Basic.Inductor ${id}_leakage(L = ${lH.toExponential(4)});`);
  }

  // 3. Declare Transmission Lines (Pi-Model equivalent)
  for (const line of netlist.transmissionLines) {
    const id = line.id.replace(/[^a-zA-Z0-9_]/g, "_");
    const rTot = line.rPerKm * line.lengthKm;
    const lTot = line.lPerKm * line.lengthKm;
    const cHalf = (line.cPerKm * line.lengthKm) / 2;

    declarations.push(`  // Transmission Line ${line.id}: ${line.lengthKm} km`);
    declarations.push(`  Modelica.Electrical.Analog.Basic.Resistor ${id}_R(R = ${rTot.toFixed(4)});`);
    declarations.push(`  Modelica.Electrical.Analog.Basic.Inductor ${id}_L(L = ${lTot.toExponential(4)});`);
    declarations.push(`  Modelica.Electrical.Analog.Basic.Capacitor ${id}_C1(C = ${cHalf.toExponential(4)});`);
    declarations.push(`  Modelica.Electrical.Analog.Basic.Capacitor ${id}_C2(C = ${cHalf.toExponential(4)});`);

    equations.push(`  connect(${id}_R.n, ${id}_L.p);`);
    equations.push(`  connect(${id}_C1.n, ground.p);`);
    equations.push(`  connect(${id}_C2.n, ground.p);`);
  }

  // 4. Grounding references
  equations.push(`  // Ground references`);

  return `// SPDX-License-Identifier: AGPL-3.0-or-later
// Generated automatically by ModelScript PSCAD-to-Modelica Projection

model ${modelName}
  "Translated electrical network from PSCAD project ${project.name}"

${declarations.join("\n")}

equation
${equations.length > 0 ? equations.join("\n") : "  // No custom loop equations"}

end ${modelName};
`;
}

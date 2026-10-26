// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/sbml — Bidirectional Modelica 3.x Projection for Biochemical Networks.
 *
 * Emits rigorous Modelica physical models for enzymatic cascades, metabolic pathways,
 * stoichiometric matrix ODEs, and mass-action / Michaelis-Menten rate laws.
 */

import type { SbmlDocument } from "../types.js";

export function sbmlToModelica(doc: SbmlDocument, modelName = "BiochemicalPathway"): string {
  const model = doc.model;
  const safeModelName = modelName.replace(/[^a-zA-Z0-9_]/g, "_");
  const lines: string[] = [];

  lines.push(`model ${safeModelName}`);
  lines.push(`  "SBML Biochemical Reaction Network: ${model.name || model.id}"`);
  lines.push(``);

  // 1. Compartments
  lines.push(`  // --- Compartments ---`);
  for (const [id, c] of model.compartments) {
    lines.push(`  parameter Real V_${id} = ${c.size.toFixed(4)} "Volume of compartment ${c.name || id}";`);
  }
  lines.push(``);

  // 2. Global Parameters
  if (model.parameters.size > 0) {
    lines.push(`  // --- Global Parameters ---`);
    for (const [id, p] of model.parameters) {
      lines.push(`  parameter Real param_${id} = ${p.value.toExponential(4)} "Parameter ${p.name || id}";`);
    }
    lines.push(``);
  }

  // 3. Species Concentration State Variables
  lines.push(`  // --- Species Concentrations ---`);
  for (const [id, s] of model.species) {
    const cSize = model.compartments.get(s.compartment)?.size ?? 1.0;
    let initialConc = s.initialConcentration;
    if (initialConc === undefined && s.initialAmount !== undefined) {
      initialConc = s.initialAmount / Math.max(1e-9, cSize);
    }
    const val = initialConc ?? 0.0;
    lines.push(`  Real S_${id}(start = ${val.toExponential(4)}) "Concentration of ${s.name || id} [mol/L]";`);
  }
  lines.push(``);

  // 4. Reaction Flux Variables
  lines.push(`  // --- Reaction Fluxes ---`);
  for (const [id, r] of model.reactions) {
    lines.push(`  Real v_${id} "Reaction flux of ${r.name || id}";`);
  }
  lines.push(``);

  lines.push(`equation`);

  // 5. Reaction Flux Equations
  for (const [id, r] of model.reactions) {
    if (r.kineticLaw && r.kineticLaw.formula.trim().length > 0) {
      // Infix formula: prefix species with S_, parameters with param_
      let formula = r.kineticLaw.formula;
      for (const sId of model.species.keys()) {
        const re = new RegExp(`\\b${sId}\\b`, "g");
        formula = formula.replace(re, `S_${sId}`);
      }
      for (const pId of model.parameters.keys()) {
        const re = new RegExp(`\\b${pId}\\b`, "g");
        formula = formula.replace(re, `param_${pId}`);
      }
      for (const [lpId, lp] of r.kineticLaw.parameters) {
        const re = new RegExp(`\\b${lpId}\\b`, "g");
        formula = formula.replace(re, `${lp.value}`);
      }
      lines.push(`  v_${id} = ${formula};`);
    } else {
      // Mass action
      const reactTerms = r.reactants.map((ref) => `S_${ref.species}`);
      const rateStr = reactTerms.length > 0 ? reactTerms.join(" * ") : "1.0";
      lines.push(`  v_${id} = ${rateStr};`);
    }
  }
  lines.push(``);

  // 6. Species Differential Equations: der(S_i) = net_flux / V_comp
  for (const [id, s] of model.species) {
    if (s.constant || s.boundaryCondition) {
      lines.push(`  der(S_${id}) = 0.0;`);
      continue;
    }

    const netTerms: string[] = [];

    for (const [rId, r] of model.reactions) {
      for (const ref of r.reactants) {
        if (ref.species === id) {
          const stoich = ref.stoichiometry === 1.0 ? "" : `${ref.stoichiometry} * `;
          netTerms.push(`- ${stoich}v_${rId}`);
        }
      }
      for (const ref of r.products) {
        if (ref.species === id) {
          const stoich = ref.stoichiometry === 1.0 ? "" : `${ref.stoichiometry} * `;
          netTerms.push(`+ ${stoich}v_${rId}`);
        }
      }
    }

    const rhs = netTerms.length > 0 ? netTerms.join(" ") : "0.0";
    lines.push(`  der(S_${id}) = (${rhs}) / V_${s.compartment};`);
  }

  lines.push(`end ${safeModelName};`);
  return lines.join("\n");
}

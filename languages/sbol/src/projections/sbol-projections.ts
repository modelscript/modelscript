// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/sbol — Modelica 3.x and SBML Level 3 Projections for Synthetic Genetic Circuits.
 *
 * Translates SBOL3 genetic circuit topologies and transcriptional regulatory networks into:
 * 1. Standalone Modelica 3.x ODE models (`sbolToModelica`)
 * 2. SBML Level 3 Version 2 Core XML biochemical reaction networks (`sbolToSbmlXml` / `sbolToSbml`)
 */

import { extractRegulatoryNetwork } from "../solvers/genetic-circuit-solver.js";
import type { SbolDocument } from "../types.js";

export function sbolToModelica(doc: SbolDocument, modelName = "SyntheticGeneticCircuit"): string {
  const safeModelName = modelName.replace(/[^a-zA-Z0-9_]/g, "_");
  const network = extractRegulatoryNetwork(doc);
  const lines: string[] = [];

  lines.push(`model ${safeModelName}`);
  lines.push(`  "SBOL3 Synthetic Genetic Circuit (${network.length} regulated species)"`);
  lines.push(``);

  lines.push(`  // --- Kinetic Parameters ---`);
  for (const s of network) {
    lines.push(`  parameter Real alpha0_${s.id} = ${s.alpha0} "Basal expression rate of ${s.name}";`);
    lines.push(`  parameter Real alpha_${s.id} = ${s.alpha} "Maximal expression rate of ${s.name}";`);
    lines.push(`  parameter Real gamma_${s.id} = ${s.gamma} "Degradation rate of ${s.name}";`);
    for (let idx = 0; idx < s.regulators.length; idx++) {
      const reg = s.regulators[idx]!;
      lines.push(
        `  parameter Real K_${s.id}_${reg.regulatorId}_${idx} = ${reg.K} "Hill threshold for ${reg.regulatorId} -> ${s.id}";`,
      );
      lines.push(
        `  parameter Real n_${s.id}_${reg.regulatorId}_${idx} = ${reg.n} "Hill cooperativity for ${reg.regulatorId} -> ${s.id}";`,
      );
    }
  }
  lines.push(``);

  lines.push(`  // --- Protein Concentrations ---`);
  for (const s of network) {
    lines.push(`  Real P_${s.id}(start = ${s.initialConcentration}) "Concentration of ${s.name}";`);
  }
  lines.push(``);

  lines.push(`  // --- Transcriptional Synthesis Fluxes ---`);
  for (const s of network) {
    lines.push(`  Real v_synth_${s.id} "Synthesis rate of ${s.name}";`);
  }
  lines.push(``);

  lines.push(`equation`);
  for (const s of network) {
    const hillTerms: string[] = [];
    for (let idx = 0; idx < s.regulators.length; idx++) {
      const reg = s.regulators[idx]!;
      const kParam = `K_${s.id}_${reg.regulatorId}_${idx}`;
      const nParam = `n_${s.id}_${reg.regulatorId}_${idx}`;
      const pVar = `P_${reg.regulatorId}`;
      if (reg.role === "activator") {
        hillTerms.push(`((${pVar} ^ ${nParam}) / ((${kParam} ^ ${nParam}) + (${pVar} ^ ${nParam})))`);
      } else {
        hillTerms.push(`((${kParam} ^ ${nParam}) / ((${kParam} ^ ${nParam}) + (${pVar} ^ ${nParam})))`);
      }
    }

    const factorStr = hillTerms.length > 0 ? ` * ${hillTerms.join(" * ")}` : "";
    lines.push(`  v_synth_${s.id} = alpha0_${s.id} + alpha_${s.id}${factorStr};`);
    lines.push(`  der(P_${s.id}) = v_synth_${s.id} - gamma_${s.id} * P_${s.id};`);
  }

  lines.push(`end ${safeModelName};`);
  return lines.join("\n");
}

export function sbolToSbmlXml(doc: SbolDocument, modelId = "SbolGeneticCircuit"): string {
  const safeId = modelId.replace(/[^a-zA-Z0-9_]/g, "_");
  const network = extractRegulatoryNetwork(doc);
  const lines: string[] = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<sbml xmlns="http://www.sbml.org/sbml/level3/version2/core" level="3" version="2">`,
    `  <model id="${safeId}" name="SBOL3 Genetic Circuit (${safeId})">`,
    `    <listOfCompartments>`,
    `      <compartment id="cell" size="1.0" spatialDimensions="3" constant="true"/>`,
    `    </listOfCompartments>`,
    `    <listOfSpecies>`,
  ];

  for (const s of network) {
    lines.push(
      `      <species id="${s.id}" name="${s.name}" compartment="cell" initialConcentration="${s.initialConcentration}" hasOnlySubstanceUnits="false" boundaryCondition="false" constant="false"/>`,
    );
  }
  lines.push(`    </listOfSpecies>`);

  lines.push(`    <listOfParameters>`);
  for (const s of network) {
    lines.push(`      <parameter id="alpha0_${s.id}" value="${s.alpha0}" constant="true"/>`);
    lines.push(`      <parameter id="alpha_${s.id}" value="${s.alpha}" constant="true"/>`);
    lines.push(`      <parameter id="gamma_${s.id}" value="${s.gamma}" constant="true"/>`);
    for (let idx = 0; idx < s.regulators.length; idx++) {
      const reg = s.regulators[idx]!;
      lines.push(`      <parameter id="K_${s.id}_${reg.regulatorId}_${idx}" value="${reg.K}" constant="true"/>`);
      lines.push(`      <parameter id="n_${s.id}_${reg.regulatorId}_${idx}" value="${reg.n}" constant="true"/>`);
    }
  }
  lines.push(`    </listOfParameters>`);

  lines.push(`    <listOfReactions>`);
  for (const s of network) {
    const hillTerms: string[] = [];
    const modifierSpecies = new Set<string>();
    for (let idx = 0; idx < s.regulators.length; idx++) {
      const reg = s.regulators[idx]!;
      modifierSpecies.add(reg.regulatorId);
      const kParam = `K_${s.id}_${reg.regulatorId}_${idx}`;
      const nParam = `n_${s.id}_${reg.regulatorId}_${idx}`;
      const pVar = reg.regulatorId;
      if (reg.role === "activator") {
        hillTerms.push(`((${pVar} ^ ${nParam}) / ((${kParam} ^ ${nParam}) + (${pVar} ^ ${nParam})))`);
      } else {
        hillTerms.push(`((${kParam} ^ ${nParam}) / ((${kParam} ^ ${nParam}) + (${pVar} ^ ${nParam})))`);
      }
    }

    const factorStr = hillTerms.length > 0 ? ` * ${hillTerms.join(" * ")}` : "";
    const synthFormula = `alpha0_${s.id} + alpha_${s.id}${factorStr}`;

    lines.push(`      <reaction id="synth_${s.id}" reversible="false">`);
    lines.push(`        <listOfProducts>`);
    lines.push(`          <speciesReference species="${s.id}" stoichiometry="1" constant="true"/>`);
    lines.push(`        </listOfProducts>`);
    if (modifierSpecies.size > 0) {
      lines.push(`        <listOfModifiers>`);
      for (const modId of modifierSpecies) {
        lines.push(`          <modifierSpeciesReference species="${modId}"/>`);
      }
      lines.push(`        </listOfModifiers>`);
    }
    lines.push(`        <kineticLaw formula="${synthFormula}"/>`);
    lines.push(`      </reaction>`);

    lines.push(`      <reaction id="deg_${s.id}" reversible="false">`);
    lines.push(`        <listOfReactants>`);
    lines.push(`          <speciesReference species="${s.id}" stoichiometry="1" constant="true"/>`);
    lines.push(`        </listOfReactants>`);
    lines.push(`        <kineticLaw formula="gamma_${s.id} * ${s.id}"/>`);
    lines.push(`      </reaction>`);
  }
  lines.push(`    </listOfReactions>`);
  lines.push(`  </model>`);
  lines.push(`</sbml>`);

  return lines.join("\n");
}

export const sbolToSbml = sbolToSbmlXml;

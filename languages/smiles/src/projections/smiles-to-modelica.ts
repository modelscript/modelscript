// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/smiles — Modelica 3.x & Aspen Plus Thermophysical Component Projections.
 *
 * Emits:
 * 1. Modelica 3.x thermodynamic species property models (`smilesToModelica`)
 * 2. Aspen Plus process simulator property cards (`smilesToAspenDeck`, `smilesToAspenComponent`)
 */

import { estimateThermophysicalProperties } from "../solvers/property-estimator.js";
import type { AntoineCoefficients, MolecularGraph, SmilesDocument } from "../types.js";

export interface AspenEstimatedComponent {
  id: string;
  name: string;
  formula: string;
  smiles: string;
  molecularWeight: number;
  Tb: number;
  Tc: number;
  Pc: number;
  Vc: number;
  acentricFactor: number;
  enthalpyOfFormation298K: number;
  idealGasCpCoeffs: [number, number, number, number];
  antoineCoeffs: AntoineCoefficients;
}

function sanitizeIdentifier(raw: string): string {
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]!;
    const code = ch.charCodeAt(0);
    const isAlnum =
      (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || (code >= 48 && code <= 57) || ch === "_";
    out += isAlnum ? ch : "_";
  }
  if (out.length === 0) return "Species";
  const firstCode = out.charCodeAt(0);
  if (firstCode >= 48 && firstCode <= 57) return `S_${out}`;
  return out;
}

export function smilesToAspenComponent(mol: MolecularGraph): AspenEstimatedComponent {
  const est = estimateThermophysicalProperties(mol);
  const id = sanitizeIdentifier(mol.name || mol.id)
    .toUpperCase()
    .slice(0, 8);
  return {
    id,
    name: mol.name || mol.id,
    formula: est.formula,
    smiles: mol.smiles,
    molecularWeight: est.molecularWeight,
    Tb: est.Tb,
    Tc: est.Tc,
    Pc: est.Pc,
    Vc: est.Vc,
    acentricFactor: est.acentricFactor,
    enthalpyOfFormation298K: est.enthalpyOfFormation298K,
    idealGasCpCoeffs: est.idealGasCpCoeffs,
    antoineCoeffs: est.antoineCoeffs,
  };
}

function isSmilesDocument(input: SmilesDocument | MolecularGraph): input is SmilesDocument {
  return "molecules" in input && Array.isArray(input.molecules);
}

export function smilesToModelica(
  input: SmilesDocument | MolecularGraph,
  modelName = "ChemicalSpeciesProperties",
): string {
  const molecules: MolecularGraph[] = isSmilesDocument(input) ? input.molecules : [input];

  const safeModelName = sanitizeIdentifier(modelName);
  const lines: string[] = [];

  lines.push(`model ${safeModelName}`);
  lines.push(`  "Thermophysical & Cheminformatics Species Property Model (${molecules.length} species)"`);
  lines.push(``);
  lines.push(`  // --- System State ---`);
  lines.push(`  parameter Real T(unit = "K") = 298.15 "System temperature";`);
  lines.push(`  parameter Real P(unit = "bar") = 1.01325 "System pressure";`);
  lines.push(``);

  const estimates = molecules.map((m, idx) => ({
    mol: m,
    id: sanitizeIdentifier(m.name || m.id || `Species_${idx + 1}`),
    est: estimateThermophysicalProperties(m),
  }));

  lines.push(`  // --- Joback-Reid Critical & Molecular Parameters ---`);
  for (const { mol, id, est } of estimates) {
    const [cpA, cpB, cpC, cpD] = est.idealGasCpCoeffs;
    lines.push(`  // Species: ${mol.name} (${est.formula}, SMILES: ${mol.smiles})`);
    lines.push(
      `  parameter Real MW_${id}(unit = "g/mol") = ${est.molecularWeight.toFixed(3)} "Molecular weight of ${mol.name}";`,
    );
    lines.push(`  parameter Real Tb_${id}(unit = "K") = ${est.Tb.toFixed(2)} "Normal boiling point of ${mol.name}";`);
    lines.push(`  parameter Real Tc_${id}(unit = "K") = ${est.Tc.toFixed(2)} "Critical temperature of ${mol.name}";`);
    lines.push(`  parameter Real Pc_${id}(unit = "bar") = ${est.Pc.toFixed(2)} "Critical pressure of ${mol.name}";`);
    lines.push(
      `  parameter Real Vc_${id}(unit = "cm3/mol") = ${est.Vc.toFixed(2)} "Critical molar volume of ${mol.name}";`,
    );
    lines.push(
      `  parameter Real omega_${id} = ${est.acentricFactor.toFixed(4)} "Lee-Kesler acentric factor of ${mol.name}";`,
    );
    lines.push(
      `  parameter Real Hf298_${id}(unit = "kJ/mol") = ${est.enthalpyOfFormation298K.toFixed(2)} "Standard enthalpy of formation of ${mol.name}";`,
    );
    lines.push(
      `  parameter Real logP_${id} = ${est.logP.toFixed(3)} "Wildman-Crippen octanol-water logP of ${mol.name}";`,
    );
    lines.push(
      `  parameter Real TPSA_${id}(unit = "angstrom2") = ${est.tpsa.toFixed(2)} "Topological polar surface area of ${mol.name}";`,
    );
    lines.push(`  parameter Real cp_a_${id} = ${cpA.toExponential(4)};`);
    lines.push(`  parameter Real cp_b_${id} = ${cpB.toExponential(4)};`);
    lines.push(`  parameter Real cp_c_${id} = ${cpC.toExponential(4)};`);
    lines.push(`  parameter Real cp_d_${id} = ${cpD.toExponential(4)};`);
    lines.push(`  Real Cp_${id}(unit = "J/(mol.K)") "Ideal-gas molar heat capacity of ${mol.name}";`);
    lines.push(`  Real Psat_${id}(unit = "bar") "Saturation vapor pressure of ${mol.name}";`);
    lines.push(`  Real K_${id} "Vapor-liquid equilibrium K-value of ${mol.name}";`);
    lines.push(``);
  }

  lines.push(`equation`);
  for (const { id, est } of estimates) {
    const { A, B, C } = est.antoineCoeffs;
    lines.push(`  Cp_${id} = cp_a_${id} + cp_b_${id} * T + cp_c_${id} * T ^ 2 + cp_d_${id} * T ^ 3;`);
    lines.push(`  Psat_${id} = 10 ^ (${A.toFixed(4)} - ${B.toFixed(2)} / (T + (${C.toFixed(2)})));`);
    lines.push(`  K_${id} = Psat_${id} / P;`);
  }

  lines.push(`end ${safeModelName};`);
  return lines.join("\n");
}

export function smilesToAspenDeck(
  input: SmilesDocument | MolecularGraph,
  title = "Joback Group-Contribution Property Deck",
): string {
  const molecules: MolecularGraph[] = isSmilesDocument(input) ? input.molecules : [input];

  const lines: string[] = [];
  lines.push(`TITLE "${title}"`);
  lines.push(`IN-UNITS MET PRESSURE=bar TEMPERATURE=K`);
  lines.push(``);
  lines.push(`COMPONENTS`);

  const compEntries = molecules.map((m) => smilesToAspenComponent(m));
  for (const c of compEntries) {
    lines.push(`  ${c.id} ${c.formula} "${c.name}"`);
  }
  lines.push(``);
  lines.push(`PROPERTIES PENG-ROB`);
  lines.push(``);
  lines.push(`* --- Joback & Reid (1987) Pure-Component Scalar Properties ---`);
  for (const c of compEntries) {
    const [cpA, cpB, cpC, cpD] = c.idealGasCpCoeffs;
    lines.push(`PROP-DATA ${c.id}-SCALAR`);
    lines.push(`  IN-UNITS MET TEMPERATURE=K PRESSURE=bar`);
    lines.push(`  PROP-LIST MW / TB / TC / PC / VC / OMEGA / DHFORM`);
    lines.push(
      `  PVAL ${c.id} ${c.molecularWeight.toFixed(3)} ${c.Tb.toFixed(2)} ${c.Tc.toFixed(2)} ${c.Pc.toFixed(2)} ${c.Vc.toFixed(2)} ${c.acentricFactor.toFixed(4)} ${c.enthalpyOfFormation298K.toFixed(2)}`,
    );
    lines.push(`PROP-DATA ${c.id}-CPIG`);
    lines.push(`  PROP-LIST CPIG`);
    lines.push(
      `  PVAL ${c.id} ${cpA.toExponential(4)} ${cpB.toExponential(4)} ${cpC.toExponential(4)} ${cpD.toExponential(4)}`,
    );
  }

  return lines.join("\n");
}

// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/pdb — Modelica 3.x Coarse-Grained C_alpha Elastic Network Multibody/Oscillator Projection.
 *
 * Synthesizes a Modelica 3.x dynamical model representing the Bahar-Atilgan Gaussian Network Model (GNM)
 * / Anisotropic Network Model (ANM) harmonic spring network of a protein structure.
 */

import { parsePdb } from "../parser/pdb-parser.js";
import { solveProteinBiophysics } from "../solvers/protein-biophysics-solver.js";
import type { PdbDocument, PdbStructure } from "../types.js";

function sanitizeIdentifier(raw: string): string {
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]!;
    const code = ch.charCodeAt(0);
    const isAlnum =
      (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || (code >= 48 && code <= 57) || ch === "_";
    out += isAlnum ? ch : "_";
  }
  if (out.length === 0) return "ProteinElasticNetwork";
  const firstCode = out.charCodeAt(0);
  if (firstCode >= 48 && firstCode <= 57) return `P_${out}`;
  return out;
}

/**
 * Generates a Modelica 3.x coarse-grained elastic network multibody/oscillator model from a PDB or mmCIF structure.
 */
export function pdbToModelica(input: PdbStructure | PdbDocument | string, modelName?: string): string {
  const structure: PdbStructure = typeof input === "string" ? parsePdb(input) : input;
  const bio = solveProteinBiophysics(structure);
  const safeModelName = sanitizeIdentifier(
    modelName ?? (structure.id && structure.id !== "XXXX" ? `Protein_${structure.id}` : "ProteinElasticNetwork"),
  );

  const lines: string[] = [];
  lines.push(`model ${safeModelName}`);
  lines.push(
    `  "Coarse-Grained C_alpha Elastic Network Oscillator Model for ${structure.id} (${bio.caAtoms.length} residues, ${bio.contacts.length} harmonic contacts)"`,
  );
  lines.push(``);
  lines.push(`  // --- Global Biophysical & Thermodynamic Parameters ---`);
  lines.push(`  parameter Real MW(unit = "Da") = ${bio.molecularWeightDa.toFixed(3)} "Total macromolecular weight";`);
  lines.push(`  parameter Real Rg(unit = "angstrom") = ${bio.radiusOfGyration.toFixed(4)} "Radius of gyration";`);
  lines.push(
    `  parameter Real rc(unit = "angstrom") = ${bio.cutoffDistance.toFixed(2)} "GNM C_alpha contact cutoff distance";`,
  );
  lines.push(`  parameter Real T(unit = "K") = 300.0 "System temperature";`);
  lines.push(`  parameter Real gamma = ${bio.springConstant.toFixed(4)} "Harmonic spring constant [kcal/(mol.A^2)]";`);
  lines.push(`  parameter Real damping = 0.5 "Langevin viscous damping coefficient [ps^-1]";`);
  lines.push(``);

  const n = bio.caAtoms.length;
  const tags: string[] = [];

  lines.push(`  // --- C_alpha Residue Equilibrium Coordinates & Dynamic States ---`);
  for (let i = 0; i < n; i++) {
    const atom = bio.caAtoms[i]!;
    const tag = sanitizeIdentifier(`${atom.chainId}_${atom.resName}${atom.resSeq}_${i + 1}`);
    tags.push(tag);
    const bPred = bio.predictedBFactors[i] ?? 0.0;
    const initDisp = i === 0 ? "0.05" : "0.0";

    lines.push(
      `  // Residue ${i + 1}: ${atom.chainId}:${atom.resName}${atom.resSeq} (Coordination = ${bio.contactNumbers[i] ?? 0}, B_pred = ${bPred.toFixed(2)} A^2)`,
    );
    lines.push(`  parameter Real x0_${tag}(unit = "angstrom") = ${atom.x.toFixed(3)};`);
    lines.push(`  parameter Real y0_${tag}(unit = "angstrom") = ${atom.y.toFixed(3)};`);
    lines.push(`  parameter Real z0_${tag}(unit = "angstrom") = ${atom.z.toFixed(3)};`);
    lines.push(`  parameter Real B_pred_${tag}(unit = "angstrom2") = ${bPred.toFixed(4)};`);
    lines.push(`  Real ux_${tag}(start = ${initDisp}, fixed = true, unit = "angstrom");`);
    lines.push(`  Real uy_${tag}(start = 0.0, fixed = true, unit = "angstrom");`);
    lines.push(`  Real uz_${tag}(start = 0.0, fixed = true, unit = "angstrom");`);
    lines.push(`  Real vx_${tag}(start = 0.0, fixed = true);`);
    lines.push(`  Real vy_${tag}(start = 0.0, fixed = true);`);
    lines.push(`  Real vz_${tag}(start = 0.0, fixed = true);`);
    lines.push(`  Real Fx_${tag};`);
    lines.push(`  Real Fy_${tag};`);
    lines.push(`  Real Fz_${tag};`);
  }

  lines.push(``);
  lines.push(`equation`);
  for (let i = 0; i < n; i++) {
    const tag = tags[i]!;
    const row = bio.kirchhoffMatrix[i]!;
    const gii = row[i] ?? 0.0;

    const neighborTermsX: string[] = [];
    const neighborTermsY: string[] = [];
    const neighborTermsZ: string[] = [];

    for (let j = 0; j < n; j++) {
      if (j !== i && (row[j] ?? 0.0) < 0.0) {
        const nTag = tags[j]!;
        neighborTermsX.push(`ux_${nTag}`);
        neighborTermsY.push(`uy_${nTag}`);
        neighborTermsZ.push(`uz_${nTag}`);
      }
    }

    const sumX = neighborTermsX.length > 0 ? neighborTermsX.join(" + ") : "0.0";
    const sumY = neighborTermsY.length > 0 ? neighborTermsY.join(" + ") : "0.0";
    const sumZ = neighborTermsZ.length > 0 ? neighborTermsZ.join(" + ") : "0.0";

    lines.push(`  // Dynamics for residue ${tag}`);
    lines.push(`  der(ux_${tag}) = vx_${tag};`);
    lines.push(`  der(uy_${tag}) = vy_${tag};`);
    lines.push(`  der(uz_${tag}) = vz_${tag};`);
    lines.push(`  Fx_${tag} = gamma * ((${sumX}) - ${gii.toFixed(1)} * ux_${tag});`);
    lines.push(`  Fy_${tag} = gamma * ((${sumY}) - ${gii.toFixed(1)} * uy_${tag});`);
    lines.push(`  Fz_${tag} = gamma * ((${sumZ}) - ${gii.toFixed(1)} * uz_${tag});`);
    lines.push(`  der(vx_${tag}) = Fx_${tag} - damping * vx_${tag};`);
    lines.push(`  der(vy_${tag}) = Fy_${tag} - damping * vy_${tag};`);
    lines.push(`  der(vz_${tag}) = Fz_${tag} - damping * vz_${tag};`);
  }

  lines.push(`end ${safeModelName};`);
  return lines.join("\n");
}

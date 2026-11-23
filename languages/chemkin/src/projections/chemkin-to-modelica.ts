// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  GAS_CONSTANT_R,
  STANDARD_PRESSURE_PA,
  convertAToSI,
  convertEaToJPerMol,
  evaluateNasa7,
  resolveSpeciesMolecularWeightKgPerMol,
  resolveSpeciesThermo,
} from "../solver/thermo.js";
import type { ChemkinDocument } from "../types.js";

export interface ChemkinModelicaOptions {
  modelName?: string | undefined;
  mode?: "constant-volume" | "constant-pressure" | undefined;
  temperature?: number | undefined;
  pressure?: number | undefined;
}

function sanitizeId(name: string): string {
  return name.replace(/[^A-Za-z0-9_]/g, "_").replace(/^(\d)/, "_$1") || "ChemkinReactor";
}

function fmt(v: number): string {
  if (v === 0) return "0.0";
  const abs = Math.abs(v);
  if (abs >= 1e5 || abs < 1e-3) return v.toExponential(6);
  return Number.isInteger(v) ? `${v}.0` : String(v);
}

/**
 * Projects a parsed `ChemkinDocument` into a standalone Modelica 0D chemical reactor model.
 */
export function chemkinToModelica(doc: ChemkinDocument, options?: ChemkinModelicaOptions): string {
  const mech = doc.mechanism;
  const modelName = sanitizeId(options?.modelName ?? mech.name);
  const mode = options?.mode ?? "constant-pressure";
  const T0 = options?.temperature ?? 1000.0;
  const P0 = options?.pressure ?? STANDARD_PRESSURE_PA;

  const species = Array.from(mech.species.keys());
  const lines: string[] = [];

  lines.push(`model ${modelName}`);
  lines.push(`  "Projected from CHEMKIN mechanism '${mech.name}' (${mode} 0D reactor)"`);
  lines.push(`  constant Real R_gas = ${GAS_CONSTANT_R} "Universal gas constant [J/(mol.K)]";`);
  if (mode === "constant-pressure") {
    lines.push(`  parameter Real P = ${fmt(P0)} "Reactor pressure [Pa]";`);
  } else {
    lines.push(`  Real P(start = ${fmt(P0)}) "Reactor pressure [Pa]";`);
  }
  lines.push(`  Real T(start = ${fmt(T0)}) "Reactor temperature [K]";`);
  lines.push(`  Real rho(start = 1.0) "Mixture density [kg/m3]";`);
  lines.push("");

  // Species declarations
  for (const sp of species) {
    const id = sanitizeId(sp);
    const mw = resolveSpeciesMolecularWeightKgPerMol(mech, sp);
    const y0 = 1.0 / Math.max(1, species.length);
    lines.push(`  parameter Real W_${id} = ${fmt(mw)} "Molecular weight of ${sp} [kg/mol]";`);
    lines.push(`  Real Y_${id}(start = ${fmt(y0)}) "Mass fraction of ${sp}";`);
    lines.push(`  Real C_${id} "Molar concentration of ${sp} [mol/m3]";`);
    lines.push(`  Real omega_${id} "Molar production rate of ${sp} [mol/(m3.s)]";`);
  }
  lines.push("");

  // Reaction variables
  for (let i = 0; i < mech.reactions.length; i++) {
    const rxn = mech.reactions[i]!;
    const rId = sanitizeId(rxn.id || `R${i + 1}`);
    lines.push(`  Real kf_${rId} "Forward rate constant for ${rxn.equation}";`);
    lines.push(`  Real q_${rId} "Net rate of progress for ${rxn.equation} [mol/(m3.s)]";`);
  }

  lines.push("equation");

  // Equation of state & concentrations
  const invWTerms = species.map((sp) => `Y_${sanitizeId(sp)} / W_${sanitizeId(sp)}`);
  if (invWTerms.length > 0) {
    if (mode === "constant-pressure") {
      lines.push(`  rho = P / (R_gas * T * (${invWTerms.join(" + ")}));`);
    } else {
      lines.push(`  P = rho * R_gas * T * (${invWTerms.join(" + ")});`);
    }
  }
  for (const sp of species) {
    const id = sanitizeId(sp);
    lines.push(`  C_${id} = rho * Y_${id} / W_${id};`);
  }
  lines.push("");

  // Reaction rate equations
  for (let i = 0; i < mech.reactions.length; i++) {
    const rxn = mech.reactions[i]!;
    const rId = sanitizeId(rxn.id || `R${i + 1}`);
    const order = rxn.reactants.reduce((s, r) => s + r.stoichiometry, 0) + (rxn.thirdBody ? 1 : 0);
    const aSI = convertAToSI(rxn.rate.A, order, mech.quantityUnits);
    const eaSI = convertEaToJPerMol(rxn.rate.Ea, mech.energyUnits);

    let kfExpr = fmt(aSI);
    if (rxn.rate.b !== 0) kfExpr += ` * (T ^ (${fmt(rxn.rate.b)}))`;
    if (eaSI !== 0) kfExpr += ` * exp((${fmt(-eaSI)}) / (R_gas * T))`;
    lines.push(`  kf_${rId} = ${kfExpr};`);

    const reactTerms = rxn.reactants.map((r) => {
      const cName = `C_${sanitizeId(r.species)}`;
      return r.stoichiometry === 1 ? cName : `(${cName} ^ ${fmt(r.stoichiometry)})`;
    });
    const rhsTerms = [`kf_${rId}`, ...reactTerms];
    lines.push(`  q_${rId} = ${rhsTerms.join(" * ")};`);
  }
  lines.push("");

  // Species ODEs
  for (const sp of species) {
    const id = sanitizeId(sp);
    const terms: string[] = [];
    for (let i = 0; i < mech.reactions.length; i++) {
      const rxn = mech.reactions[i]!;
      const rId = sanitizeId(rxn.id || `R${i + 1}`);
      let net = 0;
      for (const r of rxn.reactants) if (r.species === sp) net -= r.stoichiometry;
      for (const p of rxn.products) if (p.species === sp) net += p.stoichiometry;
      if (net === 0) continue;
      if (net === 1) terms.push(`q_${rId}`);
      else if (net === -1) terms.push(`(-q_${rId})`);
      else terms.push(`(${fmt(net)} * q_${rId})`);
    }
    lines.push(`  omega_${id} = ${terms.length > 0 ? terms.join(" + ") : "0.0"};`);
    lines.push(`  der(Y_${id}) = omega_${id} * W_${id} / rho;`);
  }

  // Energy equation
  if (species.length > 0) {
    const heatTerms: string[] = [];
    const capTerms: string[] = [];
    for (const sp of species) {
      const id = sanitizeId(sp);
      const rec = resolveSpeciesThermo(mech, sp);
      const th = rec ? evaluateNasa7(rec, T0) : null;
      const eVal = th ? (mode === "constant-volume" ? th.uMolar : th.hMolar) : 0.0;
      const cVal = th
        ? mode === "constant-volume"
          ? th.cvMolar
          : th.cpMolar
        : (mode === "constant-volume" ? 2.5 : 3.5) * GAS_CONSTANT_R;
      heatTerms.push(`(omega_${id} * (${fmt(eVal)}))`);
      capTerms.push(`(C_${id} * (${fmt(cVal)}))`);
    }
    lines.push(`  der(T) = -(${heatTerms.join(" + ")}) / (${capTerms.join(" + ")});`);
  } else {
    lines.push("  der(T) = 0.0;");
  }

  lines.push(`end ${modelName};`);
  lines.push("");
  return lines.join("\n");
}

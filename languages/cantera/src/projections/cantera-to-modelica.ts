// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/cantera — Modelica 3.x Projection for Gas-Phase Chemical Kinetics Mechanisms.
 *
 * Emits standalone Modelica 3.x models for combustion, pyrolysis, and catalysis mechanisms
 * with modified Arrhenius rate laws and stoichiometric molar production balances.
 */

import { GAS_CONSTANT_R, STANDARD_PRESSURE_PA } from "../solvers/kinetics-solver.js";
import type { CanteraDocument } from "../types.js";

function sanitizeModelicaIdent(name: string): string {
  let out = "";
  for (let i = 0; i < name.length; i++) {
    const ch = name[i] ?? "";
    const code = ch.charCodeAt(0);
    const isAlnum = (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
    if (isAlnum || ch === "_") {
      out += ch;
    } else if (ch === "+") {
      out += "_plus";
    } else if (ch === "-") {
      out += "_minus";
    } else {
      out += "_";
    }
  }
  return out.length > 0 ? out : "CanteraMechanism";
}

export function canteraToModelica(doc: CanteraDocument, modelName = "CanteraChemicalMechanism"): string {
  const mech = doc.mechanism;
  const firstPhase = mech.phases.values().next().value;
  const safeModelName = sanitizeModelicaIdent(modelName || mech.name);
  const lines: string[] = [];

  const T0 = firstPhase?.state?.T ?? 1000.0;
  const P0 = firstPhase?.state?.P ?? STANDARD_PRESSURE_PA;

  lines.push(`model ${safeModelName}`);
  lines.push(`  "Cantera Gas-Phase Chemical Kinetics Mechanism: ${mech.description || mech.name}"`);
  lines.push(``);

  // 1. Thermodynamic Parameters
  lines.push(`  // --- Thermodynamic State & Constants ---`);
  lines.push(`  parameter Real R_gas = ${GAS_CONSTANT_R} "Universal gas constant [J/(mol.K)]";`);
  lines.push(`  parameter Real T = ${T0.toFixed(2)} "Reactor temperature [K]";`);
  lines.push(`  parameter Real P = ${P0.toFixed(2)} "Reactor pressure [Pa]";`);
  lines.push(``);

  // 2. Species Concentrations
  const speciesList =
    firstPhase && firstPhase.species.length > 0 ? [...firstPhase.species] : Array.from(mech.species.keys());
  for (const spName of mech.species.keys()) {
    if (!speciesList.includes(spName)) {
      speciesList.push(spName);
    }
  }

  const totalC0 = P0 / (GAS_CONSTANT_R * T0);
  const rawX = firstPhase?.state?.X;
  let sumX = 0;
  if (rawX) {
    for (const val of Object.values(rawX)) {
      sumX += Math.max(0, val);
    }
  }

  lines.push(`  // --- Species Molar Concentrations [mol/m3] ---`);
  for (const spName of speciesList) {
    let initC = totalC0 / Math.max(1, speciesList.length);
    if (rawX && sumX > 0) {
      initC = (Math.max(0, rawX[spName] ?? 0) / sumX) * totalC0;
    }
    const safeSp = sanitizeModelicaIdent(spName);
    lines.push(`  Real C_${safeSp}(start = ${initC.toExponential(4)}) "Molar concentration of ${spName} [mol/m3]";`);
  }
  lines.push(``);

  // 3. Reaction Rate Variables
  lines.push(`  // --- Reaction Rate Constants & Rates of Progress ---`);
  for (let i = 0; i < mech.reactions.length; i++) {
    const rxn = mech.reactions[i]!;
    const rId = sanitizeModelicaIdent(rxn.id || `R${i + 1}`);
    lines.push(`  Real kf_${rId} "Forward rate constant for ${rxn.equation}";`);
    lines.push(`  Real q_${rId} "Rate of progress for ${rxn.equation} [mol/(m3.s)]";`);
  }
  lines.push(``);

  lines.push(`equation`);

  // 4. Reaction Rate Equations
  for (let i = 0; i < mech.reactions.length; i++) {
    const rxn = mech.reactions[i]!;
    const rId = sanitizeModelicaIdent(rxn.id || `R${i + 1}`);
    const { A, b, Ea } = rxn.rateConstant;

    const bTerm = b !== 0 ? ` * (T ^ (${b}))` : "";
    const eaTerm = Ea !== 0 ? ` * exp(-(${Ea}) / (R_gas * T))` : "";
    lines.push(`  kf_${rId} = ${A.toExponential(4)}${bTerm}${eaTerm};`);

    const reactFactors: string[] = [`kf_${rId}`];
    for (const react of rxn.reactants) {
      const safeSp = sanitizeModelicaIdent(react.species);
      const order = rxn.orders?.[react.species] ?? react.stoichiometry;
      reactFactors.push(order === 1 ? `C_${safeSp}` : `(C_${safeSp} ^ ${order})`);
    }
    lines.push(`  q_${rId} = ${reactFactors.join(" * ")};`);
  }
  lines.push(``);

  // 5. Species Differential Equations
  for (const spName of speciesList) {
    const safeSp = sanitizeModelicaIdent(spName);
    const netTerms: string[] = [];

    for (let i = 0; i < mech.reactions.length; i++) {
      const rxn = mech.reactions[i]!;
      const rId = sanitizeModelicaIdent(rxn.id || `R${i + 1}`);

      for (const react of rxn.reactants) {
        if (react.species === spName) {
          const coeff = react.stoichiometry === 1 ? "" : `${react.stoichiometry} * `;
          netTerms.push(`- ${coeff}q_${rId}`);
        }
      }
      for (const prod of rxn.products) {
        if (prod.species === spName) {
          const coeff = prod.stoichiometry === 1 ? "" : `${prod.stoichiometry} * `;
          netTerms.push(`+ ${coeff}q_${rId}`);
        }
      }
    }

    const rhs = netTerms.length > 0 ? netTerms.join(" ") : "0.0";
    lines.push(`  der(C_${safeSp}) = ${rhs};`);
  }

  lines.push(`end ${safeModelName};`);
  return lines.join("\n");
}

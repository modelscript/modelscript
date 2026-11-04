// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/phreeqc — Modelica 3.x Projection for USGS PHREEQC Aqueous Geochemistry & Reactive Transport.
 *
 * Synthesizes standalone Modelica 3.x physical chemistry models containing Davies activity
 * coefficients, carbonate equilibria, mineral saturation indices, and kinetic dissolution ODEs.
 */

import {
  KNOWN_MASTER_SPECIES,
  STANDARD_MINERAL_PHASES,
  computeDebyeHuckelA,
  computeTemperatureLogK,
  solvePhreeqcSpeciation,
} from "../solvers/speciation-solver.js";
import type { PhreeqcDocument } from "../types.js";

function sanitizeModelicaId(raw: string): string {
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]!;
    const code = ch.charCodeAt(0);
    const isAlphaNum = (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
    if (isAlphaNum || ch === "_") {
      out += ch;
    } else {
      out += "_";
    }
  }
  if (out.length === 0) return "AqueousGeochemistry";
  const firstCode = out.charCodeAt(0);
  if (firstCode >= 48 && firstCode <= 57) {
    out = `M_${out}`;
  }
  return out;
}

export function phreeqcToModelica(doc: PhreeqcDocument, modelName?: string): string {
  const safeModelName = sanitizeModelicaId(modelName ?? doc.title ?? "PhreeqcAqueousGeochemistry");
  const spec = solvePhreeqcSpeciation(doc);
  const tempC = spec.temperatureC;
  const debyeA = computeDebyeHuckelA(tempC);
  const Kw = Math.pow(10, computeTemperatureLogK(-14.0, 55.84, tempC));
  const K1 = Math.pow(10, computeTemperatureLogK(-6.352, 9.15, tempC));
  const K2 = Math.pow(10, computeTemperatureLogK(-10.329, 14.9, tempC));

  const lines: string[] = [];
  lines.push(`model ${safeModelName}`);
  lines.push(`  "USGS PHREEQC Aqueous Geochemistry & Speciation Model: ${doc.title ?? safeModelName}"`);
  lines.push(``);

  // 1. Thermodynamic Parameters
  lines.push(`  // --- Thermodynamic & Solution Parameters ---`);
  lines.push(`  parameter Real T_C = ${tempC.toFixed(4)} "Solution temperature [degC]";`);
  lines.push(`  parameter Real pH = ${spec.pH.toFixed(4)} "Aqueous pH [-]";`);
  lines.push(`  parameter Real pe = ${spec.pe.toFixed(4)} "Redox potential pe [-]";`);
  lines.push(`  parameter Real A_DH = ${debyeA.toFixed(6)} "Debye-Huckel parameter A [(kg/mol)^0.5]";`);
  lines.push(`  parameter Real K_w = ${Kw.toExponential(6)} "Water dissociation constant";`);
  lines.push(`  parameter Real K_1 = ${K1.toExponential(6)} "First carbonic acid dissociation constant";`);
  lines.push(`  parameter Real K_2 = ${K2.toExponential(6)} "Second carbonic acid dissociation constant";`);
  lines.push(``);

  // Collect active ions
  const ionList: Array<{ spName: string; varName: string; charge: number; initVal: number }> = [];
  const ionMap = new Map<string, { spName: string; varName: string; charge: number; initVal: number }>();

  const registerIon = (spName: string, charge: number, initVal: number) => {
    if (ionMap.has(spName)) return;
    let baseName = spName;
    for (let i = 0; i < spName.length; i++) {
      if (spName[i] === "+" || spName[i] === "-") {
        baseName = spName.slice(0, i);
        break;
      }
    }
    const varName = `m_${sanitizeModelicaId(baseName)}`;
    const entry = { spName, varName, charge, initVal };
    ionMap.set(spName, entry);
    ionList.push(entry);
  };

  for (const [spName, molality] of Object.entries(spec.speciesMolalities)) {
    if (spName === "H+" || spName === "OH-" || spName === "H2CO3" || spName === "HCO3-" || spName === "CO3-2") {
      continue;
    }
    let charge = 0;
    for (const meta of KNOWN_MASTER_SPECIES.values()) {
      if (meta.aqueousSpecies === spName) {
        charge = meta.charge;
        break;
      }
    }
    registerIon(spName, charge, molality);
  }

  // Collect active minerals
  const activeMinerals = new Set<string>();
  for (const ep of doc.equilibriumPhases) {
    if (STANDARD_MINERAL_PHASES.has(ep.name)) activeMinerals.add(ep.name);
  }
  for (const kin of doc.kinetics) {
    if (STANDARD_MINERAL_PHASES.has(kin.name)) activeMinerals.add(kin.name);
  }
  if (activeMinerals.size === 0 && ionMap.has("Ca+2") && spec.carbonateSpeciation.totalCarbon > 0) {
    activeMinerals.add("Calcite");
  }

  for (const minName of activeMinerals) {
    const minMeta = STANDARD_MINERAL_PHASES.get(minName);
    if (!minMeta) continue;
    for (const ion of minMeta.ions) {
      if (ion.species === "CO3-2") continue;
      let charge = 2;
      for (const meta of KNOWN_MASTER_SPECIES.values()) {
        if (meta.aqueousSpecies === ion.species) {
          charge = meta.charge;
          break;
        }
      }
      registerIon(ion.species, charge, spec.speciesMolalities[ion.species] ?? 1.0e-6);
    }
  }

  // Mineral solubility parameters
  if (activeMinerals.size > 0) {
    lines.push(`  // --- Mineral Solubility Constants ---`);
    for (const minName of activeMinerals) {
      const minMeta = STANDARD_MINERAL_PHASES.get(minName)!;
      const logKsp = computeTemperatureLogK(minMeta.logKsp25, minMeta.deltaHkJ, tempC);
      const ksp = Math.pow(10, logKsp);
      lines.push(
        `  parameter Real Ksp_${minName} = ${ksp.toExponential(6)} "Solubility product of ${minName} (${minMeta.formula})";`,
      );
    }
    lines.push(``);
  }

  // 2. Aqueous Species & Ionic Strength State Variables
  lines.push(`  // --- Aqueous Speciation & Activity Variables ---`);
  lines.push(`  Real I(start = ${Math.max(1.0e-7, spec.ionicStrength).toExponential(4)}) "Ionic strength [mol/kgw]";`);
  lines.push(
    `  Real gamma_1(start = ${(spec.activityCoefficients["HCO3-"] ?? 1.0).toFixed(4)}) "Monovalent Davies activity coefficient [-]";`,
  );
  lines.push(
    `  Real gamma_2(start = ${(spec.activityCoefficients["CO3-2"] ?? 1.0).toFixed(4)}) "Divalent Davies activity coefficient [-]";`,
  );
  lines.push(
    `  Real m_H(start = ${(spec.speciesMolalities["H+"] ?? 1.0e-7).toExponential(4)}) "Proton molality [mol/kgw]";`,
  );
  lines.push(
    `  Real m_OH(start = ${(spec.speciesMolalities["OH-"] ?? 1.0e-7).toExponential(4)}) "Hydroxide molality [mol/kgw]";`,
  );
  lines.push(
    `  Real C_tot(start = ${spec.carbonateSpeciation.totalCarbon.toExponential(4)}) "Total dissolved inorganic carbon [mol/kgw]";`,
  );
  lines.push(
    `  Real m_H2CO3(start = ${spec.carbonateSpeciation.h2co3.toExponential(4)}) "Dissolved CO2 / H2CO3* molality [mol/kgw]";`,
  );
  lines.push(
    `  Real m_HCO3(start = ${spec.carbonateSpeciation.hco3.toExponential(4)}) "Bicarbonate HCO3- molality [mol/kgw]";`,
  );
  lines.push(
    `  Real m_CO3(start = ${spec.carbonateSpeciation.co3.toExponential(4)}) "Carbonate CO3-2 molality [mol/kgw]";`,
  );

  for (const ion of ionList) {
    lines.push(`  Real ${ion.varName}(start = ${ion.initVal.toExponential(4)}) "Molality of ${ion.spName} [mol/kgw]";`);
  }
  lines.push(``);

  // 3. Mineral Saturation & Kinetic Variables
  if (activeMinerals.size > 0) {
    lines.push(`  // --- Mineral Saturation Indices ---`);
    for (const minName of activeMinerals) {
      const sat = spec.saturationIndices[minName];
      lines.push(
        `  Real IAP_${minName}(start = ${(sat?.iap ?? 1.0e-9).toExponential(4)}) "Ion Activity Product of ${minName}";`,
      );
      lines.push(`  Real SI_${minName}(start = ${(sat?.si ?? 0.0).toFixed(4)}) "Saturation Index of ${minName}";`);
    }
    lines.push(``);
  }

  if (doc.kinetics.length > 0) {
    lines.push(`  // --- Kinetic Mineral Dissolution / Precipitation ---`);
    for (const kin of doc.kinetics) {
      const safeName = sanitizeModelicaId(kin.name);
      lines.push(`  Real M_${safeName}(start = ${kin.m0.toExponential(4)}) "Solid moles of ${kin.name} [mol]";`);
      lines.push(`  Real rate_${safeName}(start = 0.0) "Dissolution rate of ${kin.name} [mol/s]";`);
    }
    lines.push(``);
  }

  lines.push(`equation`);

  // Davies activity equations
  lines.push(`  // Davies activity coefficients and water dissociation`);
  lines.push(`  gamma_1 = 10.0 ^ (-A_DH * (sqrt(I) / (1.0 + sqrt(I)) - 0.3 * I));`);
  lines.push(`  gamma_2 = 10.0 ^ (-4.0 * A_DH * (sqrt(I) / (1.0 + sqrt(I)) - 0.3 * I));`);
  lines.push(`  m_H = (10.0 ^ (-pH)) / gamma_1;`);
  lines.push(`  m_OH = K_w / ((10.0 ^ (-pH)) * gamma_1);`);
  lines.push(``);

  // Carbonate speciation equations
  lines.push(`  // Carbonate equilibrium speciation`);
  lines.push(
    `  m_H2CO3 = C_tot / (1.0 + K_1 / ((10.0 ^ (-pH)) * gamma_1) + (K_1 * K_2) / (((10.0 ^ (-pH)) ^ 2) * gamma_2));`,
  );
  lines.push(`  m_HCO3 = (K_1 * m_H2CO3) / ((10.0 ^ (-pH)) * gamma_1);`);
  lines.push(`  m_CO3 = (K_2 * gamma_1 * m_HCO3) / ((10.0 ^ (-pH)) * gamma_2);`);
  lines.push(``);

  // Ionic strength equation
  const iTerms: string[] = ["m_H", "m_OH", "m_HCO3", "4.0 * m_CO3"];
  for (const ion of ionList) {
    const z2 = ion.charge * ion.charge;
    if (z2 === 1) iTerms.push(ion.varName);
    else if (z2 > 1) iTerms.push(`${z2.toFixed(1)} * ${ion.varName}`);
  }
  lines.push(`  // Ionic strength`);
  lines.push(`  I = 0.5 * (${iTerms.join(" + ")});`);
  lines.push(``);

  // Mineral IAP and SI equations
  if (activeMinerals.size > 0) {
    lines.push(`  // Mineral Ion Activity Products and Saturation Indices`);
    for (const minName of activeMinerals) {
      const minMeta = STANDARD_MINERAL_PHASES.get(minName)!;
      const factors: string[] = [];
      for (const ion of minMeta.ions) {
        let actStr: string;
        if (ion.species === "CO3-2") {
          actStr = "(m_CO3 * gamma_2)";
        } else {
          const info = ionMap.get(ion.species);
          const vName = info?.varName ?? "1.0e-6";
          const absZ = Math.abs(info?.charge ?? 2);
          const gName = absZ === 1 ? "gamma_1" : "gamma_2";
          actStr = `(${vName} * ${gName})`;
        }
        factors.push(ion.stoich === 1 ? actStr : `(${actStr} ^ ${ion.stoich})`);
      }
      lines.push(`  IAP_${minName} = ${factors.join(" * ")};`);
      lines.push(`  SI_${minName} = Modelica.Math.log10(IAP_${minName} / Ksp_${minName});`);
    }
    lines.push(``);
  }

  // Kinetic rate equations and mass balance ODEs
  const ionFluxTerms = new Map<string, string[]>();
  const carbonFluxTerms: string[] = [];

  if (doc.kinetics.length > 0) {
    lines.push(`  // Kinetic mineral dissolution rates`);
    for (const kin of doc.kinetics) {
      const safeName = sanitizeModelicaId(kin.name);
      const kA = (kin.rateConstant * kin.surfaceArea).toExponential(6);
      if (activeMinerals.has(kin.name)) {
        lines.push(`  rate_${safeName} = ${kA} * (1.0 - IAP_${kin.name} / Ksp_${kin.name});`);
      } else {
        lines.push(`  rate_${safeName} = ${kA} * M_${safeName};`);
      }
      lines.push(`  der(M_${safeName}) = -rate_${safeName};`);

      const minMeta = STANDARD_MINERAL_PHASES.get(kin.name);
      if (minMeta) {
        for (const ion of minMeta.ions) {
          const termStr = ion.stoich === 1 ? `rate_${safeName}` : `${ion.stoich} * rate_${safeName}`;
          if (ion.species === "CO3-2") {
            carbonFluxTerms.push(termStr);
          } else {
            const list = ionFluxTerms.get(ion.species) ?? [];
            list.push(termStr);
            ionFluxTerms.set(ion.species, list);
          }
        }
      }
    }
    lines.push(``);
  }

  lines.push(`  // Aqueous species conservation ODEs`);
  lines.push(`  der(C_tot) = ${carbonFluxTerms.length > 0 ? carbonFluxTerms.join(" + ") : "0.0"};`);
  for (const ion of ionList) {
    const terms = ionFluxTerms.get(ion.spName);
    lines.push(`  der(${ion.varName}) = ${terms && terms.length > 0 ? terms.join(" + ") : "0.0"};`);
  }

  lines.push(`end ${safeModelName};`);
  return lines.join("\n");
}

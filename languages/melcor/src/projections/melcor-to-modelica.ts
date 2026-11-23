// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/melcor — Cross-Language Projection to Modelica 3.x.
 */

import type { MelcorDeck } from "../types.js";

function sanitizeIdentifier(name: string, fallback: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9_]/g, "_").replace(/^[0-9]+/, "");
  return cleaned.length > 0 ? cleaned : fallback;
}

export function melcorToModelica(deck: MelcorDeck, modelName?: string): string {
  const clsName = sanitizeIdentifier(modelName ?? deck.title, "MelcorSevereAccident");
  const lines: string[] = [];

  lines.push(`model ${clsName}`);
  lines.push(`  "Projected from Sandia MELCOR deck: ${deck.title.replace(/"/g, "'")}"`);
  lines.push(`  constant Real R_gas = 461.52 "Specific gas constant [J/(kg*K)]";`);
  lines.push(`  constant Real cv_gas = 1500.0 "Isochoric specific heat [J/(kg*K)]";`);
  lines.push(`  constant Real cp_gas = cv_gas + R_gas "Isobaric specific heat [J/(kg*K)]";`);
  lines.push("");

  // CVH Control Volumes
  for (const cv of deck.controlVolumes.values()) {
    const vol = Math.max(1e-4, cv.volume);
    const m0 = (cv.pressure * vol) / (461.52 * Math.max(10.0, cv.temperature));
    const u0 = m0 * 1500.0 * cv.temperature;
    lines.push(`  // CVH Control Volume ${cv.id}: ${cv.name}`);
    lines.push(`  parameter Real V_cv_${cv.id} = ${vol};`);
    lines.push(`  Real m_cv_${cv.id}(start = ${m0.toPrecision(8)}, fixed = true);`);
    lines.push(`  Real U_cv_${cv.id}(start = ${u0.toPrecision(8)}, fixed = true);`);
    lines.push(`  Real P_cv_${cv.id}(start = ${cv.pressure});`);
    lines.push(`  Real T_cv_${cv.id}(start = ${cv.temperature});`);
  }

  // FL Flow Paths
  for (const fl of deck.flowPaths.values()) {
    lines.push(`  // FL Flow Path ${fl.id}: ${fl.name} (${fl.fromCv} -> ${fl.toCv})`);
    lines.push(`  parameter Real A_fl_${fl.id} = ${fl.area};`);
    lines.push(`  parameter Real L_fl_${fl.id} = ${fl.length};`);
    lines.push(`  parameter Real K_fl_${fl.id} = ${fl.forwardLoss};`);
    lines.push(`  Real mdot_fl_${fl.id}(start = ${fl.initialFlow}, fixed = true);`);
  }

  // HS Heat Structures
  for (const hs of deck.heatStructures.values()) {
    lines.push(`  // HS Heat Structure ${hs.id}: ${hs.name}`);
    lines.push(`  parameter Real C_hs_${hs.id} = ${hs.mass * hs.specificHeat};`);
    lines.push(`  Real T_hs_${hs.id}(start = ${hs.initialTemperature}, fixed = true);`);
  }

  // COR Core Package
  if (deck.core?.present) {
    lines.push(`  // COR Core Degradation & Decay Heat`);
    lines.push(`  parameter Real m_cor = ${deck.core.coreMassKg};`);
    lines.push(`  parameter Real cp_cor = ${deck.core.coreSpecificHeatJkgK};`);
    lines.push(`  parameter Real Q_decay = ${deck.core.decayHeatW};`);
    lines.push(`  Real T_cor(start = ${deck.core.initialTemperatureK}, fixed = true);`);
    if (deck.core.oxidationEnabled) {
      lines.push(`  parameter Real A_clad = ${deck.core.cladAreaM2};`);
      lines.push(`  Real w2_ox(start = 0.0, fixed = true);`);
      lines.push(`  Real m_H2(start = 0.0);`);
    }
  }

  lines.push("equation");

  // CVH Equations
  for (const cv of deck.controlVolumes.values()) {
    if (cv.cvType === "TIME_INDEPENDENT") {
      lines.push(`  der(m_cv_${cv.id}) = 0.0;`);
      lines.push(`  der(U_cv_${cv.id}) = 0.0;`);
      lines.push(`  P_cv_${cv.id} = ${cv.pressure};`);
      lines.push(`  T_cv_${cv.id} = ${cv.temperature};`);
      continue;
    }

    const massTerms: string[] = [];
    const energyTerms: string[] = [];
    for (const fl of deck.flowPaths.values()) {
      if (fl.toCv === cv.id) {
        massTerms.push(`+ mdot_fl_${fl.id}`);
        energyTerms.push(`+ mdot_fl_${fl.id} * cp_gas * T_cv_${fl.fromCv}`);
      }
      if (fl.fromCv === cv.id) {
        massTerms.push(`- mdot_fl_${fl.id}`);
        energyTerms.push(`- mdot_fl_${fl.id} * cp_gas * T_cv_${cv.id}`);
      }
    }
    for (const hs of deck.heatStructures.values()) {
      if (hs.leftBoundaryCv === cv.id && hs.leftHtc > 0) {
        energyTerms.push(`+ ${hs.leftHtc * hs.surfaceArea} * (T_hs_${hs.id} - T_cv_${cv.id})`);
      }
      if (hs.rightBoundaryCv === cv.id && hs.rightHtc > 0) {
        energyTerms.push(`+ ${hs.rightHtc * hs.surfaceArea} * (T_hs_${hs.id} - T_cv_${cv.id})`);
      }
    }
    lines.push(`  der(m_cv_${cv.id}) = ${massTerms.length > 0 ? massTerms.join(" ") : "0.0"};`);
    lines.push(`  der(U_cv_${cv.id}) = ${energyTerms.length > 0 ? energyTerms.join(" ") : "0.0"};`);
    lines.push(`  U_cv_${cv.id} = m_cv_${cv.id} * cv_gas * T_cv_${cv.id};`);
    lines.push(`  P_cv_${cv.id} * V_cv_${cv.id} = m_cv_${cv.id} * R_gas * T_cv_${cv.id};`);
  }

  // FL Momentum Equations
  for (const fl of deck.flowPaths.values()) {
    if (deck.controlVolumes.has(fl.fromCv) && deck.controlVolumes.has(fl.toCv)) {
      lines.push(
        `  der(mdot_fl_${fl.id}) = (A_fl_${fl.id} / L_fl_${fl.id}) * (P_cv_${fl.fromCv} - P_cv_${fl.toCv}) - (K_fl_${fl.id} / L_fl_${fl.id}) * mdot_fl_${fl.id};`,
      );
    } else {
      lines.push(`  der(mdot_fl_${fl.id}) = 0.0;`);
    }
  }

  // HS Equations
  for (const hs of deck.heatStructures.values()) {
    const terms: string[] = [`${hs.heatSourceW}`];
    if (hs.leftBoundaryCv !== undefined && deck.controlVolumes.has(hs.leftBoundaryCv)) {
      terms.push(`- ${hs.leftHtc * hs.surfaceArea} * (T_hs_${hs.id} - T_cv_${hs.leftBoundaryCv})`);
    }
    if (hs.rightBoundaryCv !== undefined && deck.controlVolumes.has(hs.rightBoundaryCv)) {
      terms.push(`- ${hs.rightHtc * hs.surfaceArea} * (T_hs_${hs.id} - T_cv_${hs.rightBoundaryCv})`);
    }
    lines.push(`  C_hs_${hs.id} * der(T_hs_${hs.id}) = ${terms.join(" ")};`);
  }

  // COR Equations
  if (deck.core?.present) {
    lines.push(`  m_cor * cp_cor * der(T_cor) = Q_decay;`);
    if (deck.core.oxidationEnabled) {
      lines.push(`  der(w2_ox) = 29.6 * exp(-16820.0 / max(300.0, T_cor));`);
      lines.push(`  m_H2 = A_clad * sqrt(max(0.0, w2_ox)) * 0.04419626;`);
    }
  }

  lines.push(`end ${clsName};`);
  return lines.join("\n") + "\n";
}

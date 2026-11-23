// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/cea — Polyglot Projections (Cantera YAML, Modelica, NASA ROCETS).
 */

import { prepareReactantMixture, solveCeaDeck } from "../solver/index.js";
import type { CeaDeck, CeaSolveResult } from "../types.js";

function sanitizeModelName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9_]/g, "_");
  return cleaned.length > 0 && /^[A-Za-z_]/.test(cleaned) ? cleaned : `Cea_${cleaned}`;
}

/**
 * Projects a NASA CEA problem deck (and optional equilibrium solution) into a Cantera YAML mechanism.
 */
export function ceaToCanteraYaml(deck: CeaDeck, solveResult?: CeaSolveResult): string {
  const mix = prepareReactantMixture(deck);
  const res = solveResult ?? solveCeaDeck(deck);
  const eq = res.equilibrium;
  const phaseName = sanitizeModelName(deck.name);

  const lines: string[] = [
    `# Auto-generated Cantera YAML mechanism from @modelscript/cea (${deck.name})`,
    `description: >-`,
    `  NASA CEA ${res.problemType.toUpperCase()} equilibrium projection (O/F=${mix.ofRatio.toFixed(4)}, phi=${mix.phi.toFixed(4)})`,
    ``,
    `units: { length: cm, time: s, quantity: mol, activation-energy: cal/mol }`,
    ``,
    `phases:`,
    `  - name: ${phaseName}`,
    `    thermo: ideal-gas`,
    `    elements: [${mix.elements.join(", ")}]`,
    `    species: [${mix.species.map((s) => s.name).join(", ")}]`,
    `    state:`,
    `      T: ${(eq?.temperatureK ?? 298.15).toFixed(2)}`,
    `      P: ${(eq?.pressurePa ?? 101325.0).toFixed(2)}`,
  ];

  if (eq) {
    const xEntries = Object.entries(eq.moleFractions)
      .filter(([, x]) => x >= 1e-6)
      .map(([sp, x]) => `${sp}: ${x.toExponential(4)}`);
    if (xEntries.length > 0) {
      lines.push(`      X: { ${xEntries.join(", ")} }`);
    }
  }

  lines.push(``, `species:`);
  for (const sp of mix.species) {
    const comp = Object.entries(sp.formula)
      .map(([el, cnt]) => `${el}: ${cnt}`)
      .join(", ");
    lines.push(
      `  - name: ${sp.name}`,
      `    composition: { ${comp} }`,
      `    thermo:`,
      `      model: NASA7`,
      `      temperature-ranges: [${sp.nasa7.tLow}, ${sp.nasa7.tMid}, ${sp.nasa7.tHigh}]`,
      `      data:`,
      `        - [${sp.nasa7.low.map((c) => c.toExponential(7)).join(", ")}]`,
      `        - [${sp.nasa7.high.map((c) => c.toExponential(7)).join(", ")}]`,
    );
  }

  return lines.join("\n") + "\n";
}

/**
 * Projects a NASA CEA problem deck and solved thermochemical performance into a Modelica model.
 */
export function ceaToModelica(deck: CeaDeck, solveResult?: CeaSolveResult): string {
  const res = solveResult ?? solveCeaDeck(deck);
  const eq = res.equilibrium;
  const rocket = res.rocket;
  const modelName = sanitizeModelName(deck.name);

  const lines: string[] = [
    `// Auto-generated Modelica model from @modelscript/cea (${deck.name})`,
    `model ${modelName}`,
    `  constant Real R_u = 8.31446261815324 "Universal gas constant [J/(mol.K)]";`,
    `  constant Real g0 = 9.80665 "Standard gravity [m/s2]";`,
    `  parameter Real P_c = ${(eq?.pressurePa ?? 101325.0).toFixed(2)} "Chamber pressure [Pa]";`,
    `  parameter Real T_c = ${(eq?.temperatureK ?? 3000.0).toFixed(4)} "Chamber equilibrium temperature [K]";`,
    `  parameter Real M_w = ${(eq?.molarMassKgMol ?? 0.018).toFixed(6)} "Mean molar mass [kg/mol]";`,
    `  parameter Real gamma = ${(eq?.gamma ?? 1.2).toFixed(6)} "Isentropic exponent [-]";`,
    `  Real rho_c "Chamber gas density [kg/m3]";`,
  ];

  if (rocket) {
    const exit = rocket.exits[rocket.exits.length - 1] ?? rocket.throat;
    lines.push(
      `  parameter Real c_star = ${rocket.cStarMS.toFixed(4)} "Characteristic velocity [m/s]";`,
      `  parameter Real C_F = ${rocket.cf.toFixed(6)} "Nozzle thrust coefficient [-]";`,
      `  parameter Real C_F_vac = ${rocket.cfVac.toFixed(6)} "Vacuum thrust coefficient [-]";`,
      `  parameter Real epsilon = ${exit.areaRatio.toFixed(4)} "Nozzle expansion ratio [-]";`,
      `  Real I_sp_vac "Vacuum specific impulse [s]";`,
      `  Real v_exit "Nozzle exit velocity [m/s]";`,
    );
  }

  lines.push(`equation`, `  P_c = rho_c * (R_u / M_w) * T_c;`);

  if (rocket) {
    lines.push(`  v_exit = C_F * c_star;`, `  I_sp_vac = (C_F_vac * c_star) / g0;`);
  }

  lines.push(`end ${modelName};`);
  return lines.join("\n") + "\n";
}

/**
 * Projects a NASA CEA rocket equilibrium solution into a NASA ROCETS propulsion deck snippet.
 */
export function ceaToRocets(deck: CeaDeck, solveResult?: CeaSolveResult): string {
  const res = solveResult ?? solveCeaDeck(deck);
  const eq = res.equilibrium;
  const rocket = res.rocket;
  const engineName = sanitizeModelName(deck.name).toUpperCase();
  const exit = rocket?.exits[rocket.exits.length - 1];

  const pcPa = eq?.pressurePa ?? 1e7;
  const tcK = eq?.temperatureK ?? 3500.0;
  const gamma = eq?.gamma ?? 1.2;
  const cStar = rocket?.cStarMS ?? 2200.0;
  const ofRatio = rocket?.ofRatio ?? deck.problem.ofRatios[0] ?? 6.0;
  const areaRatio = exit?.areaRatio ?? deck.problem.supar[0] ?? 40.0;

  return [
    `# Auto-generated NASA ROCETS propulsion deck from @modelscript/cea (${deck.name})`,
    `ENGINE: ${engineName}`,
    ``,
    `COMPONENTS:`,
    `  MCC TYPE=CHAMBER`,
    `    PARAMS:`,
    `      P_c = ${pcPa.toFixed(2)}`,
    `      T_c = ${tcK.toFixed(2)}`,
    `      gamma = ${gamma.toFixed(5)}`,
    `      c_star = ${cStar.toFixed(2)}`,
    `      OF = ${ofRatio.toFixed(4)}`,
    `  NOZ TYPE=NOZZLE`,
    `    PARAMS:`,
    `      area_ratio = ${areaRatio.toFixed(4)}`,
    `      gamma = ${gamma.toFixed(5)}`,
    `      C_F_vac = ${(rocket?.cfVac ?? 1.8).toFixed(5)}`,
    `      Isp_vac = ${(rocket?.ispVacS ?? 420.0).toFixed(2)}`,
    ``,
    `CONNECTIONS:`,
    `  MCC.out -> NOZ.in FLUID=COMBUSTION_GAS`,
    ``,
  ].join("\n");
}

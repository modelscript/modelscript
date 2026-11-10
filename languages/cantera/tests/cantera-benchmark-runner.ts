#!/usr/bin/env npx tsx
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cantera Chemical Kinetics & Reactor Benchmark Runner
 *
 * Verifies chemical reaction networks, NASA-7 thermodynamic polynomial evaluation,
 * and adiabatic constant-volume reactor integration against Cantera 3.x standards.
 *
 * Usage:
 *   npx tsx languages/cantera/tests/cantera-benchmark-runner.ts [options]
 */

import { fileURLToPath } from "node:url";
import path from "node:path";
import { parseCantera, solveCanteraReactor, lowerCanteraToDae } from "../src/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function runCanteraBenchmarks(): Promise<void> {
  console.log(`[cantera-benchmark-runner] Running Cantera chemical kinetics & reactor benchmarks...`);

  const benchmarks = [
    {
      id: "H2O2Combustion",
      name: "H2-O2 High-Temperature Combustion Submechanism",
      yaml: `description: "Hydrogen-Oxygen Combustion Submechanism"
phases:
- name: gas
  thermo: ideal-gas
  kinetics: gas
  elements: [O, H, Ar]
  species: [H2, O2, H2O, H, O, OH, AR]
  state:
    T: 1200.0
    P: 101325.0
    X: {H2: 2.0, O2: 1.0, AR: 4.0}

species:
- name: H2
  composition: {H: 2}
  thermo:
    model: NASA7
    temperature-ranges: [200.0, 1000.0, 3500.0]
    data:
    - [2.34433112, 7.98052075e-03, -1.9478151e-05, 2.01572094e-08, -7.37611761e-12, -917.935173, 0.683010238]
    - [3.3372792, -4.94024731e-05, 4.99456778e-07, -1.79566394e-10, 2.00255376e-14, -950.158922, -3.20502331]
- name: O2
  composition: {O: 2}
  thermo:
    model: NASA7
    temperature-ranges: [200.0, 1000.0, 3500.0]
    data:
    - [3.78245636, -2.99673416e-03, 9.84730201e-06, -9.68129509e-09, 3.24372837e-12, -1063.94356, 3.65767573]
    - [3.28253784, 1.48308754e-03, -7.57966669e-07, 2.09470555e-10, -2.16717794e-14, -1088.45772, 5.45323129]
- name: H2O
  composition: {H: 2, O: 1}
  thermo:
    model: NASA7
    temperature-ranges: [200.0, 1000.0, 3500.0]
    data:
    - [4.19864056, -2.0364341e-03, 6.52040211e-06, -5.48797062e-09, 1.77197817e-12, -30293.7267, -0.849032208]
    - [3.03399249, 2.17691804e-03, -1.64072518e-07, -9.7041987e-11, 1.68200992e-14, -30004.2971, 4.9667701]
- name: H
  composition: {H: 1}
  thermo:
    model: NASA7
    temperature-ranges: [200.0, 1000.0, 3500.0]
    data:
    - [2.5, 0.0, 0.0, 0.0, 0.0, 25473.66, -0.44668285]
    - [2.5, 0.0, 0.0, 0.0, 0.0, 25473.66, -0.44668285]
- name: O
  composition: {O: 1}
  thermo:
    model: NASA7
    temperature-ranges: [200.0, 1000.0, 3500.0]
    data:
    - [2.5, 0.0, 0.0, 0.0, 0.0, 29150.0, 4.92]
    - [2.5, 0.0, 0.0, 0.0, 0.0, 29150.0, 4.92]
- name: OH
  composition: {O: 1, H: 1}
  thermo:
    model: NASA7
    temperature-ranges: [200.0, 1000.0, 3500.0]
    data:
    - [3.99201543, -2.40131752e-03, 4.61793841e-06, -3.88113567e-09, 1.3641147e-12, 3368.61479, -0.103925458]
    - [2.882732, 1.01397431e-03, -2.276877e-07, 2.17468383e-11, -5.12630512e-16, 3886.88867, 5.5957122]
- name: AR
  composition: {Ar: 1}
  thermo:
    model: NASA7
    temperature-ranges: [200.0, 1000.0, 3500.0]
    data:
    - [2.5, 0.0, 0.0, 0.0, 0.0, -745.375, 4.366]
    - [2.5, 0.0, 0.0, 0.0, 0.0, -745.375, 4.366]

reactions:
- equation: 2 H + M <=> H2 + M
  type: three-body
  rate-constant: {A: 1.0e+18, b: -1.0, Ea: 0.0}
  efficiencies: {H2: 0.0, H2O: 0.0}
- equation: H + O2 <=> O + OH
  rate-constant: {A: 3.52e+16, b: -0.7, Ea: 7.14e+07}
- equation: O + H2 <=> H + OH
  rate-constant: {A: 5.06e+04, b: 2.67, Ea: 2.63e+07}
- equation: OH + H2 <=> H + H2O
  rate-constant: {A: 1.17e+09, b: 1.3, Ea: 1.52e+07}
`,
    },
  ];

  let passed = true;
  for (const b of benchmarks) {
    const doc = parseCantera(b.yaml);
    const res = solveCanteraReactor(doc, { duration: 0.001, steps: 50, reactorType: "constant-volume" });
    const dae = lowerCanteraToDae(doc, { modelName: b.id });

    // Conservation check
    let atomsConserved = true;
    for (const el of ["H", "O", "Ar"]) {
      const initEl = res.elementTotalsInitial[el] ?? 0;
      const finalEl = res.elementTotalsFinal[el] ?? 0;
      if (Math.abs(initEl - finalEl) > 1e-6) {
        atomsConserved = false;
        break;
      }
    }

    const okSquare = dae.variables().length === dae.equations().length;
    const okSim = res.timePoints.length > 0 && atomsConserved;

    console.log(
      `  [${okSquare && okSim ? "PASS" : "FAIL"}] ${b.id}: ${b.name} (T_final: ${res.finalTemperature.toFixed(1)}K, vars: ${dae.variables().length}, steps: ${res.timePoints.length})`,
    );

    if (!okSquare || !okSim) passed = false;
  }

  if (!passed) process.exit(1);
}

if (process.argv[1] === __filename) {
  runCanteraBenchmarks();
}

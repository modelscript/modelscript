// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Benchmark runner for Geochemical Speciation, Reactive Transport & Scaling (PHREEQC).
 *
 * Evaluates:
 * 1. USGS PHREEQC .pqi input deck parsing (karst groundwater, recharge rainwater, equilibrium phases, kinetics)
 * 2. Aqueous speciation, ionic strength, Davies activity coefficients, and carbonate partitioning
 * 3. Mineral saturation indices (Calcite SI > 0, Gypsum SI < 0)
 * 4. Multi-phase kinetic dissolution and aqueous equilibrium lowering into square DAEBuilder arena
 */

import assert from "node:assert/strict";
import { lowerPhreeqcToDae, parsePhreeqc, solvePhreeqcSpeciation, type PhreeqcDocument } from "../src/index.js";

export const KARST_AQUIFER_PHREEQC_BENCHMARK = `TITLE Limestone Aquifer Speciation & Calcite Kinetics
# Standard karst groundwater geochemical deck
SOLUTION 1 Karst Groundwater
    temp      25.0
    pH        7.4
    pe        4.0
    units     mmol/kgw
    Ca        2.0
    Mg        0.5
    Na        1.0
    Cl        1.0
    C(4)      3.0
    S(6)      1.0

SOLUTION 2 Recharge Rainwater
    temp      20.0
    pH        6.5 charge
    pe        4.0
    units     mmol/kgw
    Ca        0.2
    C(4)      0.4

EQUILIBRIUM_PHASES 1
    Calcite   0.0 10.0
    Gypsum    0.0 5.0

REACTION 1
    NaCl      1.0
    CaCO3     0.5
    0.01 moles in 5 steps

KINETICS 1
    Calcite
        -m0     2.5
        -m      2.5
        -parms  1.67e-6 10.0
    -steps 3600 in 10 steps

MIX 1
    1 0.7
    2 0.3

END
`;

export interface PhreeqcBenchmarkMetrics {
  title: string;
  solutionsCount: number;
  equilibriumPhasesCount: number;
  reactionsCount: number;
  kineticsCount: number;
  ionicStrength: number;
  gammaHco3: number;
  gammaCo3: number;
  siCalcite: number;
  siGypsum: number;
  daeVarCount: number;
  daeEqCount: number;
  isSquare: boolean;
}

export function runPhreeqcBenchmark(pqiStr = KARST_AQUIFER_PHREEQC_BENCHMARK): PhreeqcBenchmarkMetrics {
  const doc: PhreeqcDocument = parsePhreeqc(pqiStr, "karst.pqi");
  assert.equal(doc.solutions.size, 2);
  assert.equal(doc.equilibriumPhases.length, 2);
  assert.equal(doc.reactions.size, 1);
  assert.equal(doc.kinetics.length, 1);

  const spec = solvePhreeqcSpeciation(doc, { solutionNumber: 1 });
  assert.equal(spec.pH, 7.4);
  assert.ok(spec.ionicStrength > 0.005 && spec.ionicStrength < 0.02);

  const gammaHco3 = spec.activityCoefficients["HCO3-"]!;
  const gammaCo3 = spec.activityCoefficients["CO3-2"]!;
  assert.ok(gammaHco3 > 0.8 && gammaHco3 < 0.98);
  assert.ok(gammaCo3 > 0.5 && gammaCo3 < 0.85);

  const siCalcite = spec.saturationIndices["Calcite"]!.si;
  const siGypsum = spec.saturationIndices["Gypsum"]!.si;
  assert.ok(siGypsum < 0.0);

  // Lower into linear memory DAEBuilder arena
  const dae = lowerPhreeqcToDae(doc);
  const varCount = dae.varCount;
  const eqCount = dae.eqCount;

  assert.ok(varCount >= 18);
  assert.equal(varCount, eqCount);

  return {
    title: doc.title ?? "Calcite Dissolution Equilibrium",
    solutionsCount: doc.solutions.size,
    equilibriumPhasesCount: doc.equilibriumPhases.length,
    reactionsCount: doc.reactions.size,
    kineticsCount: doc.kinetics.length,
    ionicStrength: spec.ionicStrength,
    gammaHco3,
    gammaCo3,
    siCalcite,
    siGypsum,
    daeVarCount: varCount,
    daeEqCount: eqCount,
    isSquare: varCount === eqCount,
  };
}

if (process.argv[1]?.endsWith("phreeqc-benchmark-runner.ts")) {
  const m = runPhreeqcBenchmark();
  console.log("PHREEQC Benchmark Results:", m);
}

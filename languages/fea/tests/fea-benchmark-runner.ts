// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Benchmark runner for Finite Element Analysis (FEA).
 *
 * Evaluates:
 * 1. Abaqus / CalculiX solid cantilever beam model (C3D8R hex elements, fixed root BCs)
 * 2. Material elastic tensor and density (Structural Steel: E = 210 GPa, nu = 0.3, rho = 7850 kg/m^3)
 * 3. Analytical Euler-Bernoulli deflection and fundamental modal frequency
 * 4. Multi-mode dynamic state-space lowering into DAEBuilder linear memory arena
 */

import assert from "node:assert/strict";
import {
  feaToDae,
  getFeaDialect,
  type FeaModelData,
} from "../src/index.js";

export const CANTILEVER_BEAM_INP_BENCHMARK = `*HEADING
Cantilever Solid Beam Structural Benchmark
*NODE
1, 0.0, 0.0, 0.0
2, 0.0, 0.1, 0.0
3, 0.0, 0.1, 0.2
4, 0.0, 0.0, 0.2
5, 1.0, 0.0, 0.0
6, 1.0, 0.1, 0.0
7, 1.0, 0.1, 0.2
8, 1.0, 0.0, 0.2
9, 2.0, 0.0, 0.0
10, 2.0, 0.1, 0.0
11, 2.0, 0.1, 0.2
12, 2.0, 0.0, 0.2
*ELEMENT, TYPE=C3D8R, ELSET=BEAM_ROOT
1, 1, 2, 3, 4, 5, 6, 7, 8
*ELEMENT, TYPE=C3D8R, ELSET=BEAM_TIP
2, 5, 6, 7, 8, 9, 10, 11, 12
*MATERIAL, NAME=STRUCTURAL_STEEL
*ELASTIC
210000000000.0, 0.3
*DENSITY
7850.0
*BOUNDARY
1, 1, 3
2, 1, 3
3, 1, 3
4, 1, 3
*STEP, NAME=STATIC_TIP_LOAD
*STATIC
*CLOAD
11, 3, -5000.0
12, 3, -5000.0
*END STEP
*STEP, NAME=MODAL_FREQUENCY
*FREQUENCY
5
*END STEP
`;

export interface FeaBenchmarkMetrics {
  dialect: string;
  nodesCount: number;
  elementsCount: number;
  materialsCount: number;
  stepsCount: number;
  materialName: string;
  youngsModulusPa: number;
  youngsModulusGPa: number;
  densityKgM3: number;
  tipDeflectionM: number;
  analyticalDeflectionMm: number;
  fundamentalFrequencyHz: number;
  fundamentalFreqHz: number;
  daeVarCount: number;
  daeEqCount: number;
}

export function runFeaBenchmark(
  deckStr = CANTILEVER_BEAM_INP_BENCHMARK,
): FeaBenchmarkMetrics {
  const dialect = getFeaDialect("inp");
  const model: FeaModelData = dialect.parse(deckStr);

  assert.equal(model.nodes.size, 12);
  assert.equal(model.elements.size, 2);
  assert.equal(model.materials.size, 1);
  assert.equal(model.steps.length, 2);

  const mat = model.materials.get("STRUCTURAL_STEEL")!;
  assert.ok(mat);
  assert.equal(mat.E, 2.1e11);
  assert.equal(mat.rho, 7850.0);

  // Analytical Beam Properties: L = 2.0 m, b = 0.1 m, h = 0.2 m
  // I = b * h^3 / 12 = 0.1 * 0.008 / 12 = 6.667e-5 m^4
  // A = b * h = 0.02 m^2
  // P = -10,000 N (5000 N per tip node)
  const L = 2.0;
  const b = 0.1;
  const h = 0.2;
  const I = (b * Math.pow(h, 3)) / 12.0;
  const A = b * h;
  const P = 10000.0;
  const E = mat.E;
  const rho = mat.rho;

  // delta = P * L^3 / (3 * E * I)
  const delta = (P * Math.pow(L, 3)) / (3.0 * E * I);
  // f_1 = (3.516 / (2*pi)) * sqrt(E * I / (rho * A * L^4))
  const f1 = (3.516 / (2 * Math.PI)) * Math.sqrt((E * I) / (rho * A * Math.pow(L, 4)));

  assert.ok(delta > 0 && delta < 0.01, `Deflection ${delta} m within expected structural range`);
  assert.ok(f1 > 20 && f1 < 200, `Fundamental frequency ${f1} Hz within expected range`);

  // Lower to DAEBuilder linear arena
  const dae = feaToDae(model, { numModes: 4 });
  const varCount = dae.varCount;
  const eqCount = dae.eqCount;

  // 2 global vars (StrainEnergy, MaxVonMises) + 4 modes * 3 (q, v, Q) + 10 nodes * 3 (ux, uy, uz) = 44 vars
  // 4 modes * 2 (derQ, derV) + 10 nodes * 3 + 2 (energy, stress) = 40 eqs
  assert.ok(varCount >= 40);
  assert.ok(eqCount >= 38);

  return {
    dialect: "abaqus",
    nodesCount: model.nodes.size,
    elementsCount: model.elements.size,
    materialsCount: model.materials.size,
    stepsCount: model.steps.length,
    materialName: "STRUCTURAL_STEEL",
    youngsModulusPa: E,
    youngsModulusGPa: E / 1e9,
    densityKgM3: rho,
    tipDeflectionM: delta,
    analyticalDeflectionMm: delta * 1000.0,
    fundamentalFrequencyHz: f1,
    fundamentalFreqHz: f1,
    daeVarCount: varCount,
    daeEqCount: eqCount,
  };
}

if (process.argv[1]?.endsWith("fea-benchmark-runner.ts")) {
  const m = runFeaBenchmark();
  console.log("FEA Benchmark Results:", m);
}

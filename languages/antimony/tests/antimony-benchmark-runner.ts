// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Benchmark runner for libAntimony / Tellurium (Modular Systems Biology & Biochemical Networks).
 *
 * Evaluates:
 * 1. Kholodenko 2000 MAPK (Mitogen-Activated Protein Kinase) Signaling Cascade with Negative Feedback
 * 2. Multi-tier phosphorylation-dephosphorylation enzymatic kinetics (Huang & Ferrell / Kholodenko)
 * 3. Numerical ODE integration and conserved stoichiometric pool verification
 * 4. Structurally square DAE linear memory arena compilation
 * 5. Turnkey SBML Level 3 and Modelica 3.x projections
 */

import assert from "node:assert/strict";
import {
  antimonyToModelica,
  antimonyToSbmlXml,
  lowerAntimonyToDae,
  parseAntimony,
  solveAntimony,
  type AntimonyDocument,
} from "../src/index.js";

export const ANTIMONY_MAPK_BENCHMARK = `
// Kholodenko (2000) MAPK Signaling Cascade Benchmark with Ultra-sensitivity and Negative Feedback
function MM_Rate(Vmax, Sub, Km)
  (Vmax * Sub) / (Km + Sub);
end

function NonCompetitiveInhib(Vmax, Sub, Km, Inhib, Ki)
  (Vmax * Sub) / ((Km + Sub) * (1.0 + Inhib / Ki));
end

model KholodenkoMapkCascade()
  // Compartment
  compartment cell = 1.0;

  // Level 1: MKKK (Raf)
  species MKKK in cell = 100.0;
  species MKKK_P in cell = 0.0;

  // Level 2: MKK (MEK)
  species MKK in cell = 300.0;
  species MKK_P in cell = 0.0;
  species MKK_PP in cell = 0.0;

  // Level 3: MAPK (ERK)
  species MAPK in cell = 300.0;
  species MAPK_P in cell = 0.0;
  species MAPK_PP in cell = 0.0;

  // Kinetic parameters
  const V1 = 2.5, Ki = 9.0, n_h = 1.0, K1 = 10.0;
  const V2 = 0.25, K2 = 8.0;
  const k3 = 0.025, K3 = 15.0;
  const k4 = 0.025, K4 = 15.0;
  const V5 = 0.75, K5 = 15.0;
  const V6 = 0.75, K6 = 15.0;
  const k7 = 0.025, K7 = 15.0;
  const k8 = 0.025, K8 = 15.0;
  const V9 = 0.5, K9 = 15.0;
  const V10 = 0.5, K10 = 15.0;

  // Total conserved pool assignment rules
  var TotalMKKK = 100.0;
  var TotalMKK = 300.0;
  var TotalMAPK = 300.0;

  TotalMKKK := MKKK + MKKK_P;
  TotalMKK := MKK + MKK_P + MKK_PP;
  TotalMAPK := MAPK + MAPK_P + MAPK_PP;

  // Tier 1: MKKK activation by external stimulus with negative feedback from MAPK_PP
  J1: MKKK => MKKK_P; NonCompetitiveInhib(V1, MKKK, K1, MAPK_PP, Ki);
  J2: MKKK_P => MKKK; MM_Rate(V2, MKKK_P, K2);

  // Tier 2: MKK dual phosphorylation by MKKK_P
  J3: MKK => MKK_P; (k3 * MKKK_P * MKK) / (K3 + MKK);
  J4: MKK_P => MKK_PP; (k4 * MKKK_P * MKK_P) / (K4 + MKK_P);
  J5: MKK_PP => MKK_P; MM_Rate(V5, MKK_PP, K5);
  J6: MKK_P => MKK; MM_Rate(V6, MKK_P, K6);

  // Tier 3: MAPK dual phosphorylation by MKK_PP
  J7: MAPK => MAPK_P; (k7 * MKK_PP * MAPK) / (K7 + MAPK);
  J8: MAPK_P => MAPK_PP; (k8 * MKK_PP * MAPK_P) / (K8 + MAPK_P);
  J9: MAPK_PP => MAPK_P; MM_Rate(V9, MAPK_PP, K9);
  J10: MAPK_P => MAPK; MM_Rate(V10, MAPK_P, K10);

  // Auxiliary reporter variable
  ActiveKinaseFraction := (MAPK_PP + MKK_PP) / (TotalMAPK + TotalMKK);

  MKKK is "Raf Kinase";
  MAPK_PP is "Dually Phosphorylated ERK";
end
`;

export interface AntimonyBenchmarkMetrics {
  speciesCount: number;
  reactionsCount: number;
  compartmentsCount: number;
  rulesCount: number;
  stepsCount: number;
  totalMkkkConserved: boolean;
  totalMkkConserved: boolean;
  totalMapkConserved: boolean;
  finalActiveMapkPp: number;
  daeVarCount: number;
  daeEqCount: number;
  isSquare: boolean;
  modelicaLines: number;
  sbmlXmlLength: number;
}

export function runAntimonyBenchmark(
  modelText = ANTIMONY_MAPK_BENCHMARK,
): AntimonyBenchmarkMetrics {
  const doc: AntimonyDocument = parseAntimony(modelText, "mapk_benchmark.ant");
  const mod = doc.mainModule;

  assert.equal(mod.id, "KholodenkoMapkCascade");
  assert.equal(mod.compartments.size, 1);
  assert.equal(mod.species.size, 8, "Expected 8 species across 3 cascade levels");
  assert.equal(mod.reactions.size, 10, "Expected 10 enzymatic reactions");
  assert.ok(mod.rules.length >= 3, "Expected at least 3 total pool assignment rules");

  // 1. Solve biochemical reaction network
  const sim = solveAntimony(doc, { duration: 15.0, timeStep: 0.05 });
  assert.ok(sim.stepsCount >= 300, "Expected >= 300 numerical integration steps");

  const conc = sim.finalConcentrations;
  const totMkkk = (conc["MKKK"] ?? 0) + (conc["MKKK_P"] ?? 0);
  const totMkk = (conc["MKK"] ?? 0) + (conc["MKK_P"] ?? 0) + (conc["MKK_PP"] ?? 0);
  const totMapk = (conc["MAPK"] ?? 0) + (conc["MAPK_P"] ?? 0) + (conc["MAPK_PP"] ?? 0);

  const mkkkConserved = Math.abs(totMkkk - 100.0) < 0.5;
  const mkkConserved = Math.abs(totMkk - 300.0) < 1.0;
  const mapkConserved = Math.abs(totMapk - 300.0) < 1.0;

  assert.ok(mkkkConserved, `MKKK pool conservation violated: ${totMkkk} vs 100.0`);
  assert.ok(mkkConserved, `MKK pool conservation violated: ${totMkk} vs 300.0`);
  assert.ok(mapkConserved, `MAPK pool conservation violated: ${totMapk} vs 300.0`);

  const activeMapk = conc["MAPK_PP"] ?? 0;
  assert.ok(activeMapk > 0, "Expected active dually-phosphorylated MAPK_PP to be produced");

  // 2. Lower to DAE arena and verify structurally square formulation
  const dae = lowerAntimonyToDae(doc);
  const varCount = dae.variables().length;
  const eqCount = dae.equations().length;
  assert.ok(varCount >= 20, "Expected >= 20 DAE variables (species, fluxes, volumes, rules)");
  assert.equal(varCount, eqCount, "DAE arena must be structurally square (N_vars == N_eqs)");

  // 3. Project to Modelica and SBML
  const mo = antimonyToModelica(doc, "KholodenkoMapkBenchmark");
  assert.ok(mo.includes("model KholodenkoMapkBenchmark"));
  assert.ok(mo.includes("Real S_MAPK_PP"));
  assert.ok(mo.includes("der(S_MAPK_PP)"));

  const sbml = antimonyToSbmlXml(doc);
  assert.ok(sbml.includes("<sbml"));
  assert.ok(sbml.includes('id="KholodenkoMapkCascade"'));
  assert.ok(sbml.includes('id="J10"'));

  return {
    speciesCount: mod.species.size,
    reactionsCount: mod.reactions.size,
    compartmentsCount: mod.compartments.size,
    rulesCount: mod.rules.length,
    stepsCount: sim.stepsCount,
    totalMkkkConserved: mkkkConserved,
    totalMkkConserved: mkkConserved,
    totalMapkConserved: mapkConserved,
    finalActiveMapkPp: activeMapk,
    daeVarCount: varCount,
    daeEqCount: eqCount,
    isSquare: varCount === eqCount,
    modelicaLines: mo.split("\n").length,
    sbmlXmlLength: sbml.length,
  };
}

// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Benchmark runner for BioNetGen (BNGL) Rule-Based Reaction Modeling.
 *
 * Evaluates:
 * 1. Receptor Tyrosine Kinase (RTK / EGFR) signaling pathway with multi-site phosphorylation
 * 2. Rule network expansion from seed species and reaction rules into elementary ODEs
 * 3. Numerical integration with mass conservation of receptor and ligand pools
 * 4. Lowering to structurally square DAEBuilder linear memory arena
 * 5. Projections to Modelica 3.x and SBML Level 3 XML
 */

import assert from "node:assert/strict";
import {
  bnglToModelica,
  bnglToSbmlXml,
  generateBnglNetwork,
  lowerBnglToDae,
  parseBngl,
  solveBngl,
  type BnglDocument,
} from "../src/index.js";

export const BNGL_EGFR_SIGNALING_BENCHMARK = `
begin model EGFR_Signaling_Cascade
begin parameters
  # Initial concentrations (nM)
  EGF_init 50.0
  EGFR_init 100.0
  Grb2_init 80.0
  Sos_init 40.0

  # Kinetic rate constants (s^-1, nM^-1 s^-1)
  kp_lig 0.005
  km_lig 0.08
  kp_dim 0.015
  km_dim 0.12
  k_transphos 0.8
  k_dephos 0.1
  kp_grb2 0.02
  km_grb2 0.2
  kp_sos 0.01
  km_sos 0.05
end parameters

begin compartments
  plasma_membrane 2 1.0
  cytosol 3 10.0
end compartments

begin molecule types
  EGF(r)
  EGFR(l,d,Y1068~U~P)
  Grb2(sh2,sh3)
  Sos(pr)
end molecule types

begin seed species
  EGF(r) EGF_init
  EGFR(l,d,Y1068~U) EGFR_init
  Grb2(sh2,sh3) Grb2_init
  Sos(pr) Sos_init
end seed species

begin observables
  Molecules FreeEGF EGF(r)
  Molecules BoundReceptor EGFR(l!1).EGF(r!1)
  Molecules PhosphoEGFR EGFR(Y1068~P)
  Molecules ActiveDimers EGFR(d!1).EGFR(d!1,Y1068~P)
  Molecules Grb2Recruited EGFR(Y1068~P!1).Grb2(sh2!1)
  Molecules ActiveSos Complex Grb2(sh3!1).Sos(pr!1)
  Molecules TotalEGFR EGFR()
  Molecules TotalGrb2 Grb2()
  Molecules TotalSos Sos()
end observables

begin reaction rules
  # Ligand binding: EGF + EGFR <-> EGF.EGFR
  EgfBinding: EGF(r) + EGFR(l) <-> EGF(r!1).EGFR(l!1) kp_lig, km_lig

  # Receptor dimerization: 2 EGF.EGFR <-> (EGF.EGFR)_2
  ReceptorDim: EGFR(l!+,d) + EGFR(l!+,d) <-> EGFR(l!+,d!1).EGFR(l!+,d!1) kp_dim, km_dim

  # Trans-phosphorylation within dimer
  TransPhos: EGFR(d!+,Y1068~U) -> EGFR(d!+,Y1068~P) k_transphos

  # Tyrosine dephosphorylation
  DePhos: EGFR(Y1068~P) -> EGFR(Y1068~U) k_dephos

  # Adaptor recruitment: Grb2 binds phospho-EGFR via SH2 domain
  Grb2Bind: EGFR(Y1068~P) + Grb2(sh2) <-> EGFR(Y1068~P!1).Grb2(sh2!1) kp_grb2, km_grb2

  # Guanine exchange factor recruitment: Sos binds Grb2 via SH3 domain
  SosBind: Grb2(sh3) + Sos(pr) <-> Grb2(sh3!1).Sos(pr!1) kp_sos, km_sos
end reaction rules
end model

generate_network({overwrite=>1,max_iter=>15})
simulate({method=>"ode",t_end=>20.0,n_steps=>400})
`;

export interface BnglBenchmarkMetrics {
  parametersCount: number;
  moleculeTypesCount: number;
  seedSpeciesCount: number;
  reactionRulesCount: number;
  expandedSpeciesCount: number;
  expandedReactionsCount: number;
  initialTotalEgfr: number;
  finalTotalEgfr: number;
  egfrConservationError: number;
  finalPhosphoEgfr: number;
  finalGrb2Recruited: number;
  daeVarCount: number;
  daeEqCount: number;
  isSquare: boolean;
  modelicaLines: number;
  sbmlXmlBytes: number;
}

export function runBnglBenchmark(
  content = BNGL_EGFR_SIGNALING_BENCHMARK,
): BnglBenchmarkMetrics {
  const doc: BnglDocument = parseBngl(content, "egfr_signaling.bngl");
  const m = doc.model;

  assert.equal(m.parameters.size, 14);
  assert.equal(m.moleculeTypes.size, 4);
  assert.equal(m.seedSpecies.length, 4);
  assert.equal(m.reactionRules.size, 6);

  // 1. Generate reaction network
  const net = generateBnglNetwork(doc);
  assert.ok(net.species.length >= 8, `Expected >= 8 expanded species, got ${net.species.length}`);
  assert.ok(net.reactions.length >= 10, `Expected >= 10 expanded reactions, got ${net.reactions.length}`);

  // 2. Numerical integration & conservation check
  const sim = solveBngl(doc, { duration: 20.0, timeStep: 0.05 });
  assert.ok(sim.stepsCount >= 300);

  const initTotalEgfr = sim.initialObservables["TotalEGFR"] ?? 100.0;
  const finalTotalEgfr = sim.finalObservables["TotalEGFR"] ?? 0;
  const egfrConservationError = Math.abs(finalTotalEgfr - initTotalEgfr);

  assert.ok(
    egfrConservationError < 1e-4,
    `EGFR conservation error too high: ${egfrConservationError} (init: ${initTotalEgfr}, final: ${finalTotalEgfr})`,
  );

  const finalPhospho = sim.finalObservables["PhosphoEGFR"] ?? 0;
  const finalGrb2 = sim.finalObservables["Grb2Recruited"] ?? 0;
  assert.ok(finalPhospho > 5.0, `Expected significant EGFR phosphorylation, got ${finalPhospho}`);
  assert.ok(finalGrb2 > 1.0, `Expected Grb2 recruitment to phospho-EGFR, got ${finalGrb2}`);

  // 3. Lower to DAEBuilder linear memory arena
  const dae = lowerBnglToDae(doc);
  const vars = dae.variables();
  const eqs = dae.equations();

  assert.ok(vars.length >= 20, `Expected >= 20 DAE variables, got ${vars.length}`);
  assert.equal(vars.length, eqs.length, `Expected square DAE: vars=${vars.length}, eqs=${eqs.length}`);

  // 4. Projections
  const mo = bnglToModelica(doc, "EgfrSignalingPathway");
  assert.ok(mo.includes("model EgfrSignalingPathway"));
  assert.ok(mo.includes("obs_PhosphoEGFR"));

  const xml = bnglToSbmlXml(doc);
  assert.ok(xml.includes("<sbml"));
  assert.ok(xml.includes("EGFR_Signaling_Cascade"));

  return {
    parametersCount: m.parameters.size,
    moleculeTypesCount: m.moleculeTypes.size,
    seedSpeciesCount: m.seedSpecies.length,
    reactionRulesCount: m.reactionRules.size,
    expandedSpeciesCount: net.species.length,
    expandedReactionsCount: net.reactions.length,
    initialTotalEgfr: initTotalEgfr,
    finalTotalEgfr: finalTotalEgfr,
    egfrConservationError,
    finalPhosphoEgfr: finalPhospho,
    finalGrb2Recruited: finalGrb2,
    daeVarCount: vars.length,
    daeEqCount: eqs.length,
    isSquare: vars.length === eqs.length,
    modelicaLines: mo.split("\n").length,
    sbmlXmlBytes: xml.length,
  };
}

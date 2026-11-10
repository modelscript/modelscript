// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Benchmark runner for Cheminformatics & Thermophysical Property Estimation (SMILES).
 *
 * Evaluates:
 * 1. High-complexity polycyclic natural product (Paclitaxel / Taxol, C47H51NO14, MW = 853.9 g/mol)
 * 2. Topological graph analysis (62 heavy atoms, 68 bonds, 7 rings, 4 H-donors, 15 H-acceptors)
 * 3. Polar surface area (TPSA = 221.3 Å²) and Joback-Reid critical properties (Tb, Tc, Pc)
 * 4. Equation-of-state compilation into structurally square DAEBuilder linear memory arena
 */

import assert from "node:assert/strict";
import {
  parseSmiles,
  estimateThermophysicalProperties,
  lowerSmilesToDae,
  type ThermophysicalEstimate,
} from "../src/index.js";

export const TAXOL_SMILES_BENCHMARK =
  "CC1=C2C(C(=O)C3(C(CC4C(C3C(C(C2(C)C)(CC1OC(=O)C(C(C5=CC=CC=C5)NC(=O)C6=CC=CC=C6)O)O)OC(=O)C7=CC=CC=C7)(CO4)OC(=O)C)O)C)OC(=O)C";

export interface SmilesBenchmarkMetrics {
  name: string;
  formula: string;
  molecularWeight: number;
  heavyAtomCount: number;
  ringCount: number;
  hBondDonors: number;
  hBondAcceptors: number;
  tpsa: number;
  Tb: number;
  Tc: number;
  Pc: number;
  daeVarCount: number;
  daeEqCount: number;
  isSquare: boolean;
}

export function runSmilesBenchmark(smilesStr = TAXOL_SMILES_BENCHMARK): SmilesBenchmarkMetrics {
  const mol = parseSmiles(smilesStr, "Taxol");
  assert.equal(mol.atoms.length, 62);
  assert.equal(mol.bonds.length, 68);

  const props: ThermophysicalEstimate = estimateThermophysicalProperties(mol);
  assert.equal(props.formula, "C47H51NO14");
  assert.ok(Math.abs(props.molecularWeight - 853.918) < 0.05);
  assert.equal(props.heavyAtomCount, 62);
  assert.equal(props.ringCount, 7);
  assert.equal(props.hBondDonors, 4);
  assert.equal(props.hBondAcceptors, 15);
  assert.ok(props.tpsa > 200.0 && props.tpsa < 250.0);
  assert.ok(props.Tb > 1500.0 && props.Tc > props.Tb);
  assert.ok(props.Pc > 1.0 && props.Pc < 20.0);

  // Lower into linear memory DAEBuilder arena
  const dae = lowerSmilesToDae(mol, { temperature: 310.15, pressure: 1.0 });
  const varCount = dae.varCount;
  const eqCount = dae.eqCount;

  assert.equal(varCount, 13);
  assert.equal(eqCount, 13);
  assert.equal(varCount, eqCount);

  return {
    name: "Taxol",
    formula: props.formula,
    molecularWeight: props.molecularWeight,
    heavyAtomCount: props.heavyAtomCount,
    ringCount: props.ringCount,
    hBondDonors: props.hBondDonors,
    hBondAcceptors: props.hBondAcceptors,
    tpsa: props.tpsa,
    Tb: props.Tb,
    Tc: props.Tc,
    Pc: props.Pc,
    daeVarCount: varCount,
    daeEqCount: eqCount,
    isSquare: varCount === eqCount,
  };
}

if (process.argv[1]?.endsWith("smiles-benchmark-runner.ts")) {
  const m = runSmilesBenchmark();
  console.log("SMILES Benchmark Results:", m);
}

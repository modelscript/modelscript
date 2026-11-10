// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { parseSmiles, estimateThermophysicalProperties, solveMolecularProperties } from "../src/index.js";

test("SMILES Solver: exact molecular formula and Joback thermophysical estimation for Aspirin & Caffeine", () => {
  const aspirin = parseSmiles("CC(=O)Oc1ccccc1C(=O)O", "Aspirin");
  const aspProps = estimateThermophysicalProperties(aspirin);
  assert.equal(aspProps.formula, "C9H8O4");
  assert.ok(Math.abs(aspProps.molecularWeight - 180.159) < 0.02);
  assert.equal(aspProps.heavyAtomCount, 13);
  assert.equal(aspProps.ringCount, 1);
  assert.equal(aspProps.hBondDonors, 1);
  assert.equal(aspProps.hBondAcceptors, 4);
  assert.ok(Math.abs(aspProps.tpsa - 63.6) < 0.1);

  const caffeine = parseSmiles("Cn1cnc2c1c(=O)n(C)c(=O)n2C", "Caffeine");
  const cafProps = estimateThermophysicalProperties(caffeine);
  assert.equal(cafProps.formula, "C8H10N4O2");
  assert.ok(Math.abs(cafProps.molecularWeight - 194.194) < 0.02);
  assert.equal(cafProps.heavyAtomCount, 14);
  assert.equal(cafProps.ringCount, 2);
  assert.equal(cafProps.hBondDonors, 0);
  assert.equal(cafProps.hBondAcceptors, 6);
  assert.ok(Math.abs(cafProps.tpsa - 61.82) < 0.1);
});

test("SMILES Solver: solveMolecularProperties handles multi-line inputs", () => {
  const sol = solveMolecularProperties("CCO Ethanol\nCC Ethane");
  assert.equal(sol.molecules.length, 2);
  assert.equal(sol.primary.formula, "C2H6O");
  assert.equal(sol.molecules[1]?.formula, "C2H6");
});

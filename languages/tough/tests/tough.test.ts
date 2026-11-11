// SPDX-License-Identifier: AGPL-3.0-or-later

import { UnifiedWorkspace } from "@modelscript/runtime";
import assert from "node:assert/strict";
import test from "node:test";
import { lintTough, lowerToughToDae, parseTough, solveGeothermalWells, toughLanguage } from "../src/index.js";

const SAMPLE_TOUGH_DECK = `
Geothermal Reservoir Model
ROCKS
GRAN1  2600.0  0.10  1.0e-14  1.0e-14  1.0e-14  2.5  1000.0

ELEME
EL101  GRAN1  1000.0
EL102  GRAN1  1000.0

CONNE
EL101  EL102  50.0  50.0  100.0  0.0

GENER
EL101  WELL1  MASS  -20.0  1200000.0

INCON
EL101  1.0e7  240.0
EL102  1.0e7  240.0
`;

test("TOUGH Parser — parses ROCKS, ELEME, CONNE, GENER, INCON", () => {
  const deck = parseTough(SAMPLE_TOUGH_DECK);
  assert.strictEqual(deck.rocks.length, 1);
  assert.strictEqual(deck.rocks[0]?.name, "GRAN1");
  assert.strictEqual(deck.rocks[0]?.porosity, 0.1);
  assert.strictEqual(deck.elements.length, 2);
  assert.strictEqual(deck.connections.length, 1);
  assert.strictEqual(deck.generators.length, 1);
  assert.strictEqual(deck.inconds.length, 2);
});

test("TOUGH Linter — checks rock properties and element references", () => {
  const deck = parseTough(SAMPLE_TOUGH_DECK);
  const diags = lintTough(deck);
  assert.strictEqual(diags.length, 0);
});

test("TOUGH Solver — computes geothermal well power and steam fraction", () => {
  const deck = parseTough(SAMPLE_TOUGH_DECK);
  const wells = solveGeothermalWells(deck);
  assert.strictEqual(wells.length, 1);
  assert.strictEqual(wells[0]?.wellName, "WELL1");
  assert.ok(wells[0]!.thermalPowerMW > 0);
  assert.ok(wells[0]!.steamFraction > 0);
});

test("TOUGH DAE Lowering — compiles grid blocks into DAEBuilder arena", () => {
  const deck = parseTough(SAMPLE_TOUGH_DECK);
  const dae = lowerToughToDae(deck);
  assert.ok(dae.variables().length >= 4);
});

test("TOUGH UnifiedWorkspace — indexes deck into symbol table", () => {
  const ws = new UnifiedWorkspace(toughLanguage);
  ws.setDocument("file:///model.dat", SAMPLE_TOUGH_DECK);
  const idx = ws.getIndex();
  assert.ok(idx.symbols.size > 0);
});
